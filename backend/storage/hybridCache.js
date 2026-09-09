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

// Movie ids that currently have an upload in flight (prevents duplicate jobs)
const processing = new Set();

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
export async function cacheMovie({ movieId, title, magnetLink, size, fileName } = {}) {
  if (!movieId && !title && !magnetLink) {
    throw Object.assign(
      new Error('cacheMovie requires at least one of: movieId, title, magnetLink'),
      { statusCode: 400 }
    );
  }

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
        title: title || 'Unknown Title',
        sizeBytes: Number(size) || null,
        fileName: fileName || null,
        magnetLink: magnetLink || null,
        status: 'queued',
      },
    });
    console.log(`[CDN] Queued "${movie.title}" for caching (movieId ${movie.id})`);
    return movie;
  }

  const updates = {};
  if (magnetLink && movie.magnetLink !== magnetLink) updates.magnetLink = magnetLink;
  if (movie.status === 'pending') updates.status = 'queued';
  if (Object.keys(updates).length > 0) {
    movie = await prisma.movie.update({ where: { id: movie.id }, data: updates });
  }
  return movie;
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