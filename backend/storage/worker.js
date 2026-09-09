// ==============================================================================
// Telegram Invisible CDN — background worker
// Picks up movies with status='queued' and a magnetLink, downloads the
// torrent via WebTorrent, then hands the file to the chunker for upload.
// Every step logs to the terminal with a consistent [WORKER] prefix.
// ==============================================================================
import os from 'os';
import path from 'path';
import prisma from '../prisma/client.js';
import { config, formatBytes } from './config.js';
import { splitAndUpload } from './chunker.js';
import WebTorrent from 'webtorrent';

const POLL_INTERVAL_MS = 30_000;
const MAX_CONCURRENT = 2;
const TORRENT_TIMEOUT_MS = 30 * 60_000; // 30 min

let client = null;
const pendingTorrents = new Map(); // magnetUri -> torrent instance

function getClient() {
  if (!client) {
    client = new WebTorrent({ maxConns: 55 });
    client.on('error', (err) => console.error('[WORKER] WebTorrent client error:', err.message));
  }
  return client;
}

/** Start the polling loop (called once from server.js) */
export function startWorker() {
  if (!config.telegram.configured) {
    console.warn('[WORKER] Telegram not configured — worker disabled.');
    return;
  }
  console.log(`[WORKER] Background worker started (poll every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT} concurrent)`);
  pollAndProcess().catch((e) => console.error('[WORKER] Startup poll error:', e.message));
  setInterval(() => pollAndProcess().catch((e) => console.error('[WORKER] Poll error:', e.message)), POLL_INTERVAL_MS);
}

async function pollAndProcess() {
  const queued = await prisma.movie
    .findMany({
      where: { status: 'queued', magnetLink: { not: null } },
      take: MAX_CONCURRENT,
      orderBy: { lastDownloadedAt: 'asc' },
    })
    .catch((e) => {
      console.error('[WORKER] DB poll failed:', e.message);
      return [];
    });

  if (queued.length === 0) return;
  console.log(`[WORKER] Found ${queued.length} queued movie(s)`);

  for (const movie of queued) {
    processOne(movie).catch((err) => {
      console.error(`[WORKER] Unexpected crash for "${movie.title}":`, err.message, err.stack);
    });
  }
}

function log(id, title, msg) {
  console.log(`[WORKER] [${(id || '?').slice(0, 8)}] "${title}" | ${msg}`);
}

/**
 * Full pipeline for ONE movie: torrent download → chunked Telegram upload.
 * Every step is logged and wrapped in try/catch. Any failure marks the
 * movie as 'failed' in the DB so the frontend stops polling.
 */
async function processOne(movie) {
  const { id, title, magnetLink } = movie;
  const tag = `"${title}" (${id.slice(0, 8)})`;
  const startedAt = Date.now();

  console.log(`[WORKER] ▶ Starting pipeline for ${tag}`);

  try {
    // ---- STEP 1: Mark as 'caching'
    await prisma.movie.update({ where: { id }, data: { status: 'caching' } });
    log(id, title, 'Status updated: caching');

    // ---- STEP 2: Download the torrent
    log(id, title, 'Starting torrent download...');
    const filePath = await downloadTorrent(magnetLink, id, title);
    log(id, title, `Torrent downloaded -> ${filePath}`);

    // ---- STEP 3: Chunk and upload to Telegram
    log(id, title, 'Starting chunked upload to Telegram...');
    const { chunkCount, totalSize } = await splitAndUpload(filePath, {
      movieId: id,
      title,
      fileName: path.basename(filePath),
    });

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[WORKER] ✓ DONE ${tag}: ${chunkCount} chunks, ${formatBytes(totalSize)}, ${elapsed}s`);

    // ---- STEP 4: Destroy torrent + free disk space
    destroyTorrentByMagnet(magnetLink);
  } catch (err) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(`[WORKER] ✗ FAILED ${tag} after ${elapsed}s`);
    console.error(`[WORKER]   Error: ${err.message}`);
    if (err.stack) console.error(`[WORKER]   Stack: ${err.stack.split('\n').slice(0, 3).join('\n')}`);

    await prisma.movie
      .update({ where: { id }, data: { status: 'failed' } })
      .catch((dbErr) => console.error(`[WORKER] Failed to update status:`, dbErr.message));
  }
}

/**
 * Download a torrent via WebTorrent and resolve with the largest video
 * file's path on disk. Logs progress every 10s. Rejects on timeout/error.
 */
function downloadTorrent(magnetUri, movieId, title) {
  return new Promise((resolve, reject) => {
    const wt = getClient();
    let torrent = null;
    let progressInterval = null;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      log(movieId, title, `TIMEOUT after 30 min — destroying torrent`);
      if (torrent) torrent.destroy();
      reject(new Error(`Torrent download timed out after 30 minutes for "${title}"`));
    }, TORRENT_TIMEOUT_MS);

    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (progressInterval) clearInterval(progressInterval);
      fn(val);
    };

    log(movieId, title, `Adding magnet: ${magnetUri.slice(0, 80)}...`);

    torrent = wt.add(magnetUri, { path: os.tmpdir() }, (t) => {
      if (settled) return;
      const files = t.files.map((f) => f.name).join(', ');
      log(movieId, title, `Metadata received. Files: ${files}`);

      const videoExt = /\.(mp4|mkv|avi|webm|mov|m4v)$/i;
      const videoFile = t.files.filter((f) => videoExt.test(f.name)).sort((a, b) => b.length - a.length)[0];
      const target = videoFile || (t.files.length === 1 ? t.files[0] : null);

      if (!target) {
        clearTimeout(timeout);
        t.destroy();
        return done(reject, new Error(`No video file found in torrent for "${title}". Files: ${files}`));
      }

      log(movieId, title, `Selected: "${target.name}" (${formatBytes(target.length)})`);

      let lastLogged = -1;
      progressInterval = setInterval(() => {
        const pct = Math.round(t.progress * 100);
        if (pct !== lastLogged && pct > 0) {
          lastLogged = pct;
          log(movieId, title, `Progress: ${pct}% (${formatBytes(t.downloaded)} / ${formatBytes(t.length)}) | peers: ${t.numPeers} | ${formatBytes(t.downloadSpeed)}/s`);
        }
      }, 10_000);

      t.once('done', () => {
        const fullPath = path.join(t.path, target.path);
        log(movieId, title, `Torrent download complete: ${fullPath}`);
        pendingTorrents.set(magnetUri, t);
        done(resolve, fullPath);
      });
    });

    torrent.once('error', (err) => {
      done(reject, new Error(`WebTorrent error: ${err.message}`));
    });
  });
}

function destroyTorrentByMagnet(magnetUri) {
  const t = pendingTorrents.get(magnetUri);
  if (t) {
    t.destroy({ destroyStore: true });
    pendingTorrents.delete(magnetUri);
    console.log(`[WORKER] Torrent destroyed (disk space freed)`);
  }
}

// __PART3__