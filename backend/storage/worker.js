// ==============================================================================
// Telegram Invisible CDN — background worker
// Picks up movies with status='queued' and a magnetLink, downloads the
// torrent via WebTorrent, then hands the file to the chunker for upload.
// Every step logs to the terminal with a consistent [CDN_WORKER] prefix.
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
const processingIds = new Set();   // movies claimed by this worker instance
let pollTick = 0;

function getClient() {
  if (!client) {
    try {
      client = new WebTorrent({ maxConns: 55 });
      client.on('error', (err) => console.error('[CDN_WORKER] WebTorrent client error:', err.message));
      console.log('[CDN_WORKER] WebTorrent client initialized');
    } catch (err) {
      client = null;
      throw new Error(`WebTorrent client failed to initialize: ${err.message}`);
    }
  }
  return client;
}

/**
 * Reset jobs left in 'caching' by a previous container run (crash / restart).
 * Without this, a movie interrupted mid-download stays 'caching' forever.
 */
async function recoverStaleJobs() {
  try {
    const stale = await prisma.movie.updateMany({
      where: { status: 'caching' },
      data: { status: 'queued' },
    });
    if (stale.count > 0) {
      console.log(`[CDN_WORKER] Recovered ${stale.count} stale 'caching' job(s) from a previous run — reset to 'queued'`);
    }
  } catch (err) {
    console.error('[CDN_WORKER] Failed to recover stale jobs:', err.message);
  }
}

/** Start the polling loop (called once from server.js at boot) */
export function startWorker() {
  console.log('[CDN_WORKER] Starting background queue consumer at server boot...');

  if (!config.telegram.configured) {
    // The worker MUST still run: it picks up queued items and marks them
    // FAILED immediately with a clear reason, so nothing hangs in 'queued'
    // forever and the frontend polling stops cleanly.
    console.error('[CDN_WORKER] WARNING: Telegram CDN is NOT configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing).');
    console.error('[CDN_WORKER] The worker will keep running, but every queued movie will be marked FAILED until Telegram is configured.');
  }

  recoverStaleJobs();

  console.log(`[CDN_WORKER] Queue consumer active — polling every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT} concurrent jobs`);

  pollAndProcess().catch((e) => console.error('[CDN_WORKER] Startup poll error:', e.message));
  setInterval(() => {
    pollTick += 1;
    if (pollTick % 20 === 0) { // heartbeat every ~10 min proves liveness in Docker logs
      console.log(`[CDN_WORKER] Heartbeat: poll loop alive (tick ${pollTick}), ${processingIds.size} job(s) in progress`);
    }
    pollAndProcess().catch((e) => console.error('[CDN_WORKER] Poll error:', e.message));
  }, POLL_INTERVAL_MS);
}

async function pollAndProcess() {
  const queued = await prisma.movie
    .findMany({
      where: { status: 'queued', magnetLink: { not: null } },
      take: MAX_CONCURRENT,
      orderBy: { lastDownloadedAt: 'asc' },
    })
    .catch((e) => {
      console.error('[CDN_WORKER] DB poll failed:', e.message);
      return [];
    });

  if (queued.length === 0) return;

  // Claim guard: never re-process a movie this worker instance is already on
  const claimable = queued.filter((m) => !processingIds.has(m.id));
  if (claimable.length === 0) return;

  console.log(`[CDN_WORKER] Poll found ${queued.length} queued item(s), claiming ${claimable.length}: ${claimable.map((m) => `"${m.title}"`).join(', ')}`);

  for (const movie of claimable) {
    processOne(movie).catch((err) => {
      console.error(`[CDN_WORKER] Unexpected crash while processing "${movie.title}":`, err.message, err.stack);
      processingIds.delete(movie.id);
    });
  }
}

function log(id, title, msg) {
  console.log(`[CDN_WORKER] [${(id || '?').slice(0, 8)}] "${title}" | ${msg}`);
}

/**
 * Full pipeline for ONE movie: torrent download → chunked Telegram upload.
 * Every step — including torrent/client initialization — is wrapped in
 * try/catch. Any failure marks the movie 'failed' and the loop moves on to
 * the next item instead of hanging the whole queue.
 */
async function processOne(movie) {
  const { id, title, magnetLink } = movie;
  const tag = `"${title}" (${(id || '?').slice(0, 8)})`;
  const startedAt = Date.now();

  // Re-entrancy guard: skip if this worker instance already claimed the movie
  if (processingIds.has(id)) return;
  processingIds.add(id);

  console.log(`[CDN_WORKER] Processing movie: ${tag}`);

  try {
    // ---- STEP 1: atomically claim the item ('queued' -> 'caching').
    // updateMany with a status filter guarantees we never double-process a
    // movie that another poll/instance already claimed. Must happen BEFORE
    // any failure-prone step so the catch handler can always transition the
    // row to 'failed'.
    const claimed = await prisma.movie.updateMany({
      where: { id, status: 'queued' },
      data: { status: 'caching' },
    });
    if (claimed.count === 0) {
      log(id, title, 'Skipped — status changed while waiting in the poll queue');
      return;
    }
    log(id, title, 'Status updated: caching');

    // ---- STEP 2: pre-flight — fail fast (and loudly) if the CDN is unusable
    if (!config.telegram.configured) {
      throw new Error('Telegram CDN not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing) — cannot cache this movie');
    }

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
    console.log(`[CDN_WORKER] DONE ${tag}: ${chunkCount} chunks, ${formatBytes(totalSize)}, ${elapsed}s`);

    // ---- STEP 4: Destroy torrent + free disk space
    destroyTorrentByMagnet(magnetLink);
  } catch (err) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(`[CDN_WORKER] FAILED ${tag} after ${elapsed}s`);
    console.error(`[CDN_WORKER]   Reason: ${err.message}`);
    if (err.stack) console.error(`[CDN_WORKER]   Stack: ${err.stack.split('\n').slice(0, 3).join('\n')}`);

    // Mark 'failed' so the frontend stops polling; never leave items hanging.
    // Only fail while still 'caching' so a concurrently re-queued item survives.
    await prisma.movie
      .updateMany({ where: { id, status: 'caching' }, data: { status: 'failed' } })
      .catch((dbErr) => console.error(`[CDN_WORKER] Failed to update status:`, dbErr.message));
  } finally {
    processingIds.delete(id); // free the claim so the item can be retried later
  }
}

/**
 * Download a torrent via WebTorrent and resolve with the largest video
 * file's path on disk. Logs progress every 10s. Rejects on timeout/error.
 */
function downloadTorrent(magnetUri, movieId, title) {
  return new Promise((resolve, reject) => {
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

    // ---- Torrent/client initialization: catch synchronously-thrown errors
    // (invalid magnet, WebTorrent/node-datachannel init failure) so a single
    // bad magnet can never hang or crash the whole queue loop.
    try {
      const wt = getClient();
      torrent = wt.add(magnetUri, { path: os.tmpdir() }, (t) => {
        if (settled) return;
        const files = t.files.map((f) => f.name).join(', ');
        log(movieId, title, `Metadata received. Files: ${files}`);

        const videoExt = /\.(mp4|mkv|avi|webm|mov|m4v)$/i;
        const videoFile = t.files.filter((f) => videoExt.test(f.name)).sort((a, b) => b.length - a.length)[0];
        const target = videoFile || (t.files.length === 1 ? t.files[0] : null);

        if (!target) {
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
    } catch (err) {
      return done(reject, new Error(`Torrent failed to initialize for "${title}": ${err.message}`));
    }

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
    console.log(`[CDN_WORKER] Torrent destroyed (disk space freed)`);
  }
}