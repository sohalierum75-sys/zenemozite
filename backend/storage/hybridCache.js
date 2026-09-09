// ==============================================================================
// Telegram Invisible CDN — orchestrator
// Movies are split into byte-range chunks and uploaded to a private Telegram
// channel. The download route streams all chunks sequentially so users get
// one continuous file — Telegram is never exposed.
// ==============================================================================
import fs from 'fs';
import prisma from '../prisma/client.js';
import { config, formatBytes } from './config.js';
import * as telegramStore from './telegramStore.js';
import { splitAndUpload, spoolToTemp } from './chunker.js';
import { destroyTorrentByMagnet } from './worker.js';

// Movie ids that currently have an upload in flight (prevents duplicate jobs)
const processing = new Set();

// Values that must NEVER be persisted as a movie title
const INVALID_TITLE_VALUES = new Set(['', 'unknown', 'unknown title', 'null', 'undefined', 'n/a', 'na']);

/** Extract the `dn=` (display/release name) parameter from a magnet link, if present. */
function extractMagnetDn(magnetLink) {
  if (!magnetLink || typeof magnetLink !== 'string') return null;
  try {
    const dnMatch = magnetLink.match(/[?&]dn=([^&]+)/);
    if (dnMatch && dnMatch[1]) {
      const dn = decodeURIComponent(dnMatch[1].replace(/\+/g, ' ')).trim();
      if (dn) return dn;
    }
  } catch {
    // malformed magnet — ignore, caller will use its own fallback
  }
  return null;
}

/** Derive a readable label from the magnet info hash, e.g. "Torrent a1b2c3d4e5f6". */
function extractMagnetHashLabel(magnetLink) {
  if (!magnetLink || typeof magnetLink !== 'string') return null;
  const hashMatch = magnetLink.match(/xt=urn:btih:([a-fA-F0-9]{8,64})/);
  return hashMatch ? `Torrent ${hashMatch[1].slice(0, 12)}` : null;
}

/**
 * Strictly validate a title for the CDN queue. Falls back through:
 *   explicit title -> magnet display name (dn=) -> caller-provided fallback
 *   (search query / idOrTitle) -> magnet info-hash label
 * and guarantees the stored title is NEVER empty or "Unknown Title".
 * Returns { title, source } so the caller can log where the title came from.
 */
function resolveQueueTitle({ title, magnetLink, fallbackTitle } = {}) {
  const candidates = [
    { value: title, source: 'query' },
    { value: extractMagnetDn(magnetLink), source: 'magnet-dn' },
    { value: fallbackTitle, source: 'fallback' },
    { value: extractMagnetHashLabel(magnetLink), source: 'hash' },
  ];

  for (const candidate of candidates) {
    if (typeof candidate.value !== 'string') continue;
    const cleaned = candidate.value.replace(/\s+/g, ' ').trim();
    if (!INVALID_TITLE_VALUES.has(cleaned.toLowerCase())) {
      return { title: cleaned, source: candidate.source };
    }
  }

  // Absolute last resort — still a real, non-"Unknown" identifier
  return { title: 'Uncategorized Download', source: 'none' };
}

function assertConfigured() {
  if (!config.telegram.configured) {
    throw Object.assign(
      new Error('Telegram storage is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).'),
      { statusCode: 503 }
    );
  }
}

/**
 * Queue a movie for caching from its magnet link (NON-BLOCKING).
 * Creates (or updates) the Movie row and stores the magnet so the
 * torrent-to-stream pipeline can pick the job up.
 */
export async function cacheMovie({ movieId, title, magnetLink, size, fileName, fallbackTitle } = {}) {
  if (!movieId && !title && !magnetLink) {
    throw Object.assign(
      new Error('cacheMovie requires at least one of: movieId, title, magnetLink'),
      { statusCode: 400 }
    );
  }

  // STRICT TITLE VALIDATION — never persist "Unknown Title".
  // Falls back to the magnet display name (dn=), then the caller-provided
  // search query / idOrTitle, and logs exactly what is being queued.
  const resolved = resolveQueueTitle({ title, magnetLink, fallbackTitle });
  title = resolved.title;

  console.log(`[CDN_QUEUE] Queuing movie for caching:`);
  console.log(`[CDN_QUEUE]   title  = "${title}" (source: ${resolved.source})`);
  console.log(`[CDN_QUEUE]   magnet = ${magnetLink ? 'present' : 'none'} | explicit movieId = ${movieId || 'none'}`);

  let movie = null;
  if (movieId) {
    movie = await prisma.movie.findUnique({ where: { id: movieId } }).catch(() => null);
  }
  if (!movie && title) {
    movie = await prisma.movie.findFirst({ where: { title } });
  }

  if (!movie) {
    movie = await prisma.movie.create({
      data: {
        title,
        sizeBytes: Number(size) || null,
        fileName: fileName || null,
        magnetLink: magnetLink || null,
        status: 'queued',
      },
    });
    console.log(`[CDN_QUEUE] Created Movie row "${movie.title}" (status: queued, id: ${movie.id})`);
    return movie;
  }

  // Existing row: repair a previously bad title (e.g. legacy "Unknown Title")
  // when we now have a real one, and keep the magnet fresh.
  const updates = {};
  if (magnetLink && movie.magnetLink !== magnetLink) updates.magnetLink = magnetLink;
  if (title && movie.title !== title && INVALID_TITLE_VALUES.has((movie.title || '').toLowerCase())) {
    updates.title = title;
  }
  if (movie.status === 'pending') updates.status = 'queued';
  if (Object.keys(updates).length > 0) {
    movie = await prisma.movie.update({ where: { id: movie.id }, data: updates });
  }
  console.log(`[CDN_QUEUE] Re-queued existing Movie row "${movie.title}" (status: ${movie.status}, id: ${movie.id})`);
  return movie;
}

/**
 * FORCE RESET for "Try Again": clear a stuck/failed download so a fresh one
 * can start immediately.
 *   - destroys any live/stuck torrent instance for this movie's magnet
 *   - resets status to 'queued' (from 'failed' or stuck 'queued')
 *   - stores/refreshes the magnet link and clears the last error
 *   - sets lastDownloadedAt to the epoch so the worker's poll
 *     (orderBy lastDownloadedAt asc) picks this movie up FIRST
 * Returns the updated movie, or null if no row exists yet (caller should
 * fall through to the normal queue path).
 */
export async function resetMovieForRetry({ movieId, title, magnetLink, fallbackTitle } = {}) {
  const resolved = resolveQueueTitle({ title, magnetLink, fallbackTitle });

  let movie = null;
  if (movieId) {
    movie = await prisma.movie.findUnique({ where: { id: movieId } }).catch(() => null);
  }
  if (!movie && resolved.title) {
    movie = await prisma.movie.findFirst({ where: { title: resolved.title } });
  }
  if (!movie) return null;

  console.log(`[CDN_RETRY] Force reset requested for "${movie.title}" (current status: ${movie.status})`);

  // 1. Kill any stuck torrent instance so the retry starts from scratch.
  //    CRITICAL: WebTorrent dedupes client.add() by infoHash, so a live
  //    stuck instance left over from a failed attempt would silently
  //    swallow the retry download and "Try Again" would appear to do
  //    nothing. Destroying it first guarantees a fresh download.
  const magnet = magnetLink || movie.magnetLink;
  if (magnet) {
    const killed = destroyTorrentByMagnet(magnet);
    console.log(`[CDN_RETRY]   stuck torrent instance: ${killed ? 'destroyed' : 'none was live'}`);
  }

  // 2. Re-read the row: "Try Again" can race with the worker finishing the
  //    job. NEVER clobber a row that is now 'ready' (download just completed)
  //    or actively 'caching' (download in progress) — resetting those would
  //    throw away a finished/working download.
  const fresh = await prisma.movie.findUnique({ where: { id: movie.id } });
  if (!fresh || fresh.status === 'ready' || fresh.status === 'caching') {
    console.log(`[CDN_RETRY]   row is now '${fresh ? fresh.status : 'deleted'}' — leaving it untouched`);
    return fresh || null;
  }

  // 3. Reset ONLY retryable states ('failed' | 'queued' | 'pending') via a
  //    conditional updateMany — a second race-safe guard against clobbering
  //    a state that changed between the read above and this write.
  const updated = await prisma.movie.updateMany({
    where: { id: movie.id, status: { in: ['failed', 'queued', 'pending'] } },
    data: {
      status: 'queued',
      lastError: null,
      ...(magnet ? { magnetLink: magnet } : {}),
      lastDownloadedAt: new Date(0), // epoch -> worker poll picks this movie FIRST
    },
  });

  if (updated.count === 0) {
    console.log(`[CDN_RETRY]   status changed mid-reset — re-reading row without modifying it`);
    return prisma.movie.findUnique({ where: { id: movie.id } });
  }

  const resetMovie = await prisma.movie.findUnique({ where: { id: movie.id } });
  console.log(`[CDN_RETRY]   status reset to 'queued' — worker will pick it up on the next poll (≤30s)`);
  return resetMovie;
}

/**
 * Start the full caching pipeline: split the file into byte-range chunks and
 * upload each to Telegram. Accepts either a filePath (torrent downloaded to
 * disk) or a Readable stream (spooled to temp first).
 */
export async function startCacheJob(input = {}) {
  const { movieId, title, size, fileName, filePath, mimeType, stream: sourceStream } = input;
  const parsedSize = Number(size);

  if (!title) throw Object.assign(new Error('title is required'), { statusCode: 400 });
  if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
    throw Object.assign(new Error('size (bytes) is required and must be > 0'), { statusCode: 400 });
  }

  let sourcePath = null;
  let tempPath = null;

  if (sourceStream) {
    // Live stream input — spool to temp file so we can do ranged reads
    tempPath = await spoolToTemp(sourceStream);
    sourcePath = tempPath;
  } else if (filePath) {
    if (!fs.existsSync(filePath)) {
      throw Object.assign(new Error(`filePath does not exist on the server: ${filePath}`), { statusCode: 400 });
    }
    sourcePath = filePath;
  } else {
    throw Object.assign(new Error('filePath or stream is required'), { statusCode: 400 });
  }

  assertConfigured();

  // Find or create the Movie record
  let movie = null;
  if (movieId) {
    movie = await prisma.movie.findUnique({ where: { id: movieId } }).catch(() => null);
  }
  if (!movie && title) {
    movie = await prisma.movie.findFirst({ where: { title } });
  }

  if (movie && movie.status === 'ready') {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
    return { movie, state: 'already-cached', promise: null };
  }

  if (!movie) {
    movie = await prisma.movie.create({
      data: {
        title,
        sizeBytes: parsedSize,
        fileName: fileName || null,
        mimeType: mimeType || null,
        status: 'caching',
      },
    });
  } else {
    movie = await prisma.movie.update({
      where: { id: movie.id },
      data: { status: 'caching', sizeBytes: parsedSize, fileName: fileName || movie.fileName, mimeType: mimeType || movie.mimeType },
    });
  }

  if (processing.has(movie.id)) {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
    return { movie, state: 'already-processing', promise: null };
  }

  processing.add(movie.id);
  const promise = processCacheJob(movie.id, { sourcePath, tempPath, fileName, mimeType })
    .finally(() => {
      processing.delete(movie.id);
      if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
    });

  return { movie, state: 'started', promise };
}

async function processCacheJob(movieId, { sourcePath, fileName, mimeType }) {
  try {
    const movie = await prisma.movie.findUnique({ where: { id: movieId } });
    if (!movie) return;

    console.log(`[CDN] Caching "${movie.title}" -> Telegram chunked`);
    const { chunkCount, totalSize } = await splitAndUpload(sourcePath, {
      movieId,
      title: movie.title,
      fileName: fileName || movie.fileName,
      mimeType: mimeType || movie.mimeType,
    });

    await prisma.movie.update({
      where: { id: movieId },
      data: { status: 'ready', sizeBytes: totalSize, fileName: fileName || movie.fileName, mimeType: mimeType || movie.mimeType },
    });

    console.log(`[CDN] DONE: ${chunkCount} chunks stored for "${movie.title}"`);
  } catch (err) {
    console.error(`[CDN] Job failed for movie ${movieId}:`, err.message);
    await prisma.movie.update({ where: { id: movieId }, data: { status: 'failed' } }).catch(() => {});
    throw err;
  }
}

/** Look up a cache entry WITHOUT touching the download timestamp */
export async function peekCacheEntry(idOrTitle) {
  if (!idOrTitle) return null;
  let movie = await prisma.movie.findUnique({ where: { id: idOrTitle } });
  if (!movie) movie = await prisma.movie.findFirst({ where: { title: idOrTitle } });
  if (!movie) return null;
  return { movie, cached: movie.status === 'ready' };
}

/** Stats overview for /stats */
export async function getCacheStats() {
  const [readyCount, cachingCount, pendingCount, failedCount, totalChunks] = await Promise.all([
    prisma.movie.count({ where: { status: 'ready' } }),
    prisma.movie.count({ where: { status: 'caching' } }),
    prisma.movie.count({ where: { status: { in: ['pending', 'queued'] } } }),
    prisma.movie.count({ where: { status: 'failed' } }),
    prisma.movieChunk.count(),
  ]);

  return {
    telegram: {
      configured: config.telegram.configured,
      localApiUrl: config.telegram.localApiUrl,
      chunkSizeBytes: config.telegram.chunkSizeBytes,
      maxUploadBytes: config.telegram.maxSizeBytes,
    },
    movies: { ready: readyCount, caching: cachingCount, pending: pendingCount, failed: failedCount },
    totalChunks,
    processingNow: [...processing],
  };
}