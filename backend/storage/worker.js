// ==============================================================================
// Telegram Invisible CDN — background worker
// Picks up movies with status='queued' and a magnetLink, downloads the
// torrent via WebTorrent, then hands the file to the chunker for upload.
// Every step logs to the terminal with a consistent [CDN_WORKER] prefix.
//
// RELIABILITY CONTRACT:
//   1. The worker starts at Express boot and loops over 'queued' movies
//      forever — a failure in ONE item can never stop the loop or the API.
//   2. Every torrent is wrapped in try/catch: failures are logged with the
//      exact error, the DB row is marked 'failed' with a clean message, and
//      the loop moves on to the next item.
//   3. Stuck torrents are detected (metadata timeout + stall watchdog) and
//      ALWAYS destroyed, so "Try Again" can immediately re-initiate a fresh
//      download instead of hanging on WebTorrent's infoHash dedupe.
// ==============================================================================
import os from 'os';
import path from 'path';
import prisma from '../prisma/client.js';
import { config, formatBytes } from './config.js';
import { splitAndUpload } from './chunker.js';

const POLL_INTERVAL_MS = 30_000;            // queue poll cadence
const MAX_CONCURRENT = Math.max(1, Number(process.env.CDN_MAX_CONCURRENT || 1)); // max simultaneous torrent jobs (1 = low-RAM safe)
const TORRENT_TIMEOUT_MS = 30 * 60_000;     // hard cap per torrent (30 min)
const METADATA_TIMEOUT_MS = 5 * 60_000;     // magnet must yield metadata in 5 min
const STALL_TIMEOUT_MS = 5 * 60_000;        // no bytes for 5 min -> stalled
const SWEEP_EVERY_TICKS = 5;                // orphan sweep cadence (~2.5 min)

// The WebTorrent client is created LAZILY via dynamic import: its native
// dependency (node-datachannel) can fail to load on some hosts, and a static
// top-level import would crash the whole Express server at boot.
let clientPromise = null;
const pendingTorrents = new Map(); // magnetUri -> torrent instance (tracked from add, not done)
const processingIds = new Map();   // movieId -> claimedAt(ms) for jobs owned by this worker
let pollTick = 0;
let started = false;

/**
 * Lazily create the shared WebTorrent client. A failed init clears the
 * cached promise so the NEXT job retries instead of poisoning the worker.
 */
async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const mod = await import('webtorrent');
        const WebTorrent = mod.default || mod;
        const client = new WebTorrent({
          // Fewer peer connections = fewer per-peer socket + buffer allocations.
          maxConns: Math.max(10, Number(process.env.TORRENT_MAX_CONNS || 25)),
        });
        client.on('error', (err) => console.error('[CDN_WORKER] WebTorrent client error:', err && err.message));
        console.log('[CDN_WORKER] WebTorrent client initialized');
        return client;
      } catch (err) {
        clientPromise = null;
        throw new Error(`WebTorrent client failed to initialize: ${err && err.message}`);
      }
    })();
  }
  return clientPromise;
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
    console.error('[CDN_WORKER] Failed to recover stale jobs:', err && err.message);
  }
}

/**
 * Requeue 'caching' rows that no live job in THIS worker instance owns.
 * recoverStaleJobs() handles restarts at boot; this catches jobs whose
 * processing promise died mid-run, so a movie can never be stranded in
 * 'caching' until the next deploy.
 * (Race-safe: processingIds.set() always happens BEFORE the queued->caching
 * DB claim, so a row mid-claim is still 'queued' during the gap.)
 */
async function sweepOrphanedCachingJobs() {
  try {
    const rows = await prisma.movie.findMany({
      where: { status: 'caching' },
      select: { id: true, title: true },
    });
    const orphans = rows.filter((m) => !processingIds.has(m.id));
    if (orphans.length === 0) return;

    console.warn(`[CDN_WORKER] Sweep: ${orphans.length} 'caching' job(s) with no active worker — requeueing: ${orphans.map((m) => `"${m.title}"`).join(', ')}`);
    await prisma.movie.updateMany({
      where: { id: { in: orphans.map((m) => m.id) }, status: 'caching' },
      data: { status: 'queued' },
    });
  } catch (err) {
    console.error('[CDN_WORKER] Sweep failed (non-fatal):', err && err.message);
  }
}

/** Start the polling loop (called once from server.js at boot) */
export function startWorker() {
  if (started) {
    console.log('[CDN_WORKER] startWorker called again — already running, ignoring');
    return;
  }
  started = true;

  console.log('[CDN_WORKER] Starting background queue consumer at server boot...');

  if (!config.telegram.configured) {
    // The worker MUST still run: it picks up queued items and marks them
    // FAILED immediately with a clear reason, so nothing hangs in 'queued'
    // forever and the frontend polling stops cleanly.
    console.error('[CDN_WORKER] WARNING: Telegram CDN is NOT configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing).');
    console.error('[CDN_WORKER] The worker will keep running, but every queued movie will be marked FAILED until Telegram is configured.');
  }

  // Recover stale jobs first, then poll immediately (a retry clicked before
  // the restart is picked up right away — not 30s later).
  recoverStaleJobs()
    .catch((err) => console.error('[CDN_WORKER] recoverStaleJobs crashed (non-fatal):', err && err.message))
    .finally(() => {
      pollAndProcess().catch((e) => console.error('[CDN_WORKER] Startup poll error:', e && e.message));
    });

  console.log(`[CDN_WORKER] Queue consumer active — polling every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT} concurrent jobs`);

  setInterval(() => {
    pollTick += 1;
    if (pollTick % 20 === 0) { // heartbeat every ~10 min proves liveness in Docker logs
      console.log(`[CDN_WORKER] Heartbeat: poll loop alive (tick ${pollTick}), ${processingIds.size} job(s) in progress, heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)}MB, free RAM ${(os.freemem() / 1048576).toFixed(0)}MB`);
    }
    if (pollTick % SWEEP_EVERY_TICKS === 0) sweepOrphanedCachingJobs();
    pollAndProcess().catch((e) => console.error('[CDN_WORKER] Poll error:', e && e.message));
  }, POLL_INTERVAL_MS);
}

// ---- LOW-RAM MEMORY GUARD ----------------------------------------------------
// On a 1-2GB VPS the kernel OOM killer murders the whole container (users see
// Cloudflare Error 521) when a new torrent is claimed while RAM is already
// exhausted by an in-flight upload. Before claiming NEW work we check free
// system RAM and the Node heap, and defer to the next poll if either is under
// pressure. Already-running jobs are never interrupted — only new claims.
const MIN_FREE_SYS_MB = Math.max(0, Number(process.env.CDN_MIN_FREE_MB || 150));
const MAX_HEAP_MB = Math.max(0, Number(process.env.CDN_MAX_HEAP_MB || 512));

function systemHasHeadroom() {
  try {
    const freeSysMb = os.freemem() / (1024 * 1024);
    const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);
    if (freeSysMb < MIN_FREE_SYS_MB) {
      console.warn(`[CDN_WORKER] Memory guard: only ${freeSysMb.toFixed(0)}MB system RAM free (< ${MIN_FREE_SYS_MB}MB) — deferring new jobs to the next poll`);
      return false;
    }
    if (MAX_HEAP_MB > 0 && heapMb > MAX_HEAP_MB) {
      console.warn(`[CDN_WORKER] Memory guard: Node heap at ${heapMb.toFixed(0)}MB (> ${MAX_HEAP_MB}MB) — deferring new jobs to the next poll`);
      return false;
    }
    return true;
  } catch {
    return true; // the guard must never itself block the queue
  }
}

async function pollAndProcess() {
  // LOW-RAM MEMORY GUARD: defer claiming new jobs while RAM is under pressure
  if (!systemHasHeadroom()) return;

  // Respect the concurrency cap — only claim as many items as there are
  // free slots, so the loop can never oversubscribe the torrent client.
  const freeSlots = MAX_CONCURRENT - processingIds.size;
  if (freeSlots <= 0) return;

  const queued = await prisma.movie
    .findMany({
      where: { status: 'queued', magnetLink: { not: null } },
      take: freeSlots,
      orderBy: { lastDownloadedAt: 'asc' }, // epoch-stamped retries go FIRST
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

  // Fire-and-forget per item: a crash in one movie must never prevent the
  // other items in this batch (or any future poll) from being processed.
  for (const movie of claimable) {
    processOne(movie).catch((err) => {
      console.error(`[CDN_WORKER] Unexpected crash while processing "${movie.title}":`, err && err.message, err && err.stack);
      processingIds.delete(movie.id);
    });
  }
}

function log(id, title, msg) {
  console.log(`[CDN_WORKER] [${(id || '?').slice(0, 8)}] "${title}" | ${msg}`);
}
/**
 * Full pipeline for ONE movie: torrent download -> chunked Telegram upload.
 * Every step — including torrent/client initialization — is wrapped in
 * try/catch. Any failure marks the movie 'failed' (with a clean error
 * message) and the loop moves on to the next item instead of hanging.
 */
async function processOne(movie) {
  const { id, title, magnetLink } = movie;
  const tag = `"${title}" (${(id || '?').slice(0, 8)})`;
  const startedAt = Date.now();

  // Re-entrancy guard: skip if this worker instance already claimed the movie
  if (processingIds.has(id)) return;
  processingIds.set(id, Date.now());

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
      log(id, title, 'Skipped — status changed while waiting in the poll queue (e.g. re-queued by "Try Again")');
      return;
    }
    log(id, title, 'Status updated: caching');

    // ---- STEP 2: pre-flight — fail fast (and loudly) if the CDN is unusable
    if (!config.telegram.configured) {
      throw new Error('Telegram CDN not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing) — cannot cache this movie');
    }

    // ---- STEP 3: Download the torrent (all failure modes throw -> catch)
    log(id, title, 'Starting torrent download...');
    const filePath = await downloadTorrent(magnetLink, id, title);
    log(id, title, `Torrent downloaded -> ${filePath}`);

    // ---- STEP 4: Chunk and upload to Telegram (splitAndUpload sets 'ready')
    log(id, title, 'Starting chunked upload to Telegram...');
    const { chunkCount, totalSize } = await splitAndUpload(filePath, {
      movieId: id,
      title,
      fileName: path.basename(filePath),
    });

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[CDN_WORKER] DONE ${tag}: ${chunkCount} chunks, ${formatBytes(totalSize)}, ${elapsed}s`);

    // ---- STEP 5: Destroy torrent + free disk space
    destroyTorrentByMagnet(magnetLink);
  } catch (err) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    // ---- ROBUST ERROR HANDLING: log the EXACT error, then persist a clean
    // message on the row so the frontend stops polling and "Try Again" can
    // show the reason. Never leave items hanging.
    console.error(`[CDN_WORKER] FAILED ${tag} after ${elapsed}s`);
    console.error(`[CDN_WORKER]   Reason: ${err && err.message}`);
    if (err && err.stack) console.error(`[CDN_WORKER]   Stack: ${err.stack.split('\n').slice(0, 3).join('\n')}`);

    // Only fail while still 'caching': if the user hit "Try Again" mid-run,
    // the row is already 'queued' again and the retry must survive.
    await prisma.movie
      .updateMany({
        where: { id, status: 'caching' },
        data: { status: 'failed', lastError: String((err && err.message) || 'Unknown caching error').slice(0, 500) },
      })
      .catch((dbErr) => console.error('[CDN_WORKER] Failed to update status:', dbErr && dbErr.message));

    // Free any torrent instance this movie left behind so a retry starts clean
    destroyTorrentByMagnet(magnetLink);
  } finally {
    processingIds.delete(id); // free the claim so the item can be retried later
  }
}

/**
 * Download a torrent via WebTorrent and resolve with the largest video
 * file's path on disk. Logs progress every 10s.
 *
 * Reliability guarantees:
 *   - Any previous torrent instance for this magnet is destroyed FIRST.
 *     WebTorrent dedupes client.add() by infoHash — without this, a stuck
 *     instance from a failed attempt would be silently handed back and the
 *     retry would hang forever ("Try Again" did nothing).
 *   - The torrent is tracked in pendingTorrents the moment it is added (not
 *     only on completion), so destroyTorrentByMagnet() can ALWAYS clean up.
 *   - Metadata timeout + stall watchdog: a dead torrent fails clean after
 *     ~5 min instead of squatting on a concurrency slot for 30 min.
 *   - Every rejection destroys the torrent and frees the slot.
 */
async function downloadTorrent(magnetUri, movieId, title) {
  let wt;
  try {
    wt = await getClient();
  } catch (err) {
    throw new Error(`Torrent failed to initialize for "${title}": ${err && err.message}`);
  }

  return new Promise((resolve, reject) => {
    let torrent = null;
    let settled = false;
    let progressInterval = null;
    let metadataTimeout = null;
    let hardTimeout = null;
    let lastDownloaded = 0;
    let lastProgressAt = Date.now();

    const clearTimers = () => {
      if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
      if (metadataTimeout) { clearTimeout(metadataTimeout); metadataTimeout = null; }
      if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null; }
    };

    // Success: keep the torrent registered so the post-upload cleanup
    // (destroyTorrentByMagnet in processOne) can free disk + connections.
    const finish = (fullPath) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(fullPath);
    };

    // Failure: destroy the torrent, unregister it, reject with a clean msg.
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (torrent) {
        try { torrent.destroy({ destroyStore: true }); } catch { /* already gone */ }
        if (pendingTorrents.get(magnetUri) === torrent) pendingTorrents.delete(magnetUri);
      }
      reject(new Error(message));
    };

    // ---- CRITICAL: destroy any previous instance for this magnet BEFORE
    // adding, so the retry always gets a FRESH torrent object.
    destroyTorrentByMagnet(magnetUri);

    log(movieId, title, `Adding magnet: ${String(magnetUri).slice(0, 80)}...`);

    function onMetadata(t) {
      if (settled) return;
      torrent = t;
      if (metadataTimeout) { clearTimeout(metadataTimeout); metadataTimeout = null; }

      const files = t.files.map((f) => f.name).join(', ');
      log(movieId, title, `Metadata received. Files: ${files}`);

      const videoExt = /\.(mp4|mkv|avi|webm|mov|m4v)$/i;
      const videoFile = t.files.filter((f) => videoExt.test(f.name)).sort((a, b) => b.length - a.length)[0];
      const target = videoFile || (t.files.length === 1 ? t.files[0] : null);

      if (!target) {
        fail(`No video file found in torrent for "${title}". Files: ${files}`);
        return;
      }

      log(movieId, title, `Selected: "${target.name}" (${formatBytes(target.length)})`);

      let lastLogged = -1;
      lastProgressAt = Date.now();
      progressInterval = setInterval(() => {
        if (settled) return;
        // Stall watchdog: any byte counts as progress; silence fails the job
        if (t.downloaded > lastDownloaded) {
          lastDownloaded = t.downloaded;
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
          log(movieId, title, `STALL: no download progress for ${STALL_TIMEOUT_MS / 60000} min (peers: ${t.numPeers}) — aborting`);
          fail(`Torrent stalled for "${title}" — no data received for ${STALL_TIMEOUT_MS / 60000} minutes (peers: ${t.numPeers}). Try a different torrent source.`);
          return;
        }
        const pct = Math.round(t.progress * 100);
        if (pct !== lastLogged && pct > 0) {
          lastLogged = pct;
          log(movieId, title, `Progress: ${pct}% (${formatBytes(t.downloaded)} / ${formatBytes(t.length)}) | peers: ${t.numPeers} | ${formatBytes(t.downloadSpeed)}/s`);
        }
      }, 10_000);

      t.once('done', () => {
        const fullPath = path.join(t.path, target.path);
        log(movieId, title, `Torrent download complete: ${fullPath}`);
        finish(fullPath);
      });
    }

    // ---- Torrent/client initialization: catch synchronously-thrown errors
    // (invalid magnet, WebTorrent init failure) so a single bad magnet can
    // never hang or crash the whole queue loop.
    try {
      torrent = wt.add(magnetUri, { path: os.tmpdir() }, onMetadata);
    } catch (err) {
      fail(`Torrent failed to initialize for "${title}": ${err && err.message}`);
      return;
    }

    if (!torrent || typeof torrent.once !== 'function') {
      fail(`WebTorrent did not return a usable torrent instance for "${title}"`);
      return;
    }

    // Track the torrent IMMEDIATELY — not only on completion — so
    // destroyTorrentByMagnet() can always find and kill a stuck instance.
    pendingTorrents.set(magnetUri, torrent);

    // ---- Metadata watchdog: dead magnets / zero-peer torrents must fail
    // fast instead of squatting on a concurrency slot for 30 minutes.
    metadataTimeout = setTimeout(() => {
      fail(`No torrent metadata received for "${title}" after ${METADATA_TIMEOUT_MS / 60000} minutes (dead magnet or 0 peers) — try a different torrent`);
    }, METADATA_TIMEOUT_MS);

    // ---- Hard cap on the entire download
    hardTimeout = setTimeout(() => {
      fail(`Torrent download timed out after ${TORRENT_TIMEOUT_MS / 60000} minutes for "${title}"`);
    }, TORRENT_TIMEOUT_MS);

    torrent.once('error', (err) => {
      fail(`WebTorrent error: ${err && err.message}`);
    });
  });
}

/** Destroy the live torrent instance for a magnet (retry/cleanup helper). */
export function destroyTorrentByMagnet(magnetUri) {
  const t = magnetUri ? pendingTorrents.get(magnetUri) : null;
  if (!t) return false;
  pendingTorrents.delete(magnetUri);
  try {
    t.destroy({ destroyStore: true });
    console.log('[CDN_WORKER] Torrent destroyed (disk space freed)');
  } catch (err) {
    console.error('[CDN_WORKER] Failed to destroy torrent instance:', err && err.message);
  }
  return true;
}