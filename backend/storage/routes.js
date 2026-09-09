// ==============================================================================
// Telegram Invisible CDN — Express routes
//   POST /api/hybrid-cache/initiate    -> start caching (chunked upload, 202)
//   GET  /api/hybrid-cache/status/:id  -> cache state of a movie
//   GET  /api/hybrid-cache/stats       -> cache counters
//   GET  /api/download/:id             -> frontend DownloadButton endpoint
//                                         (also mounted standalone at /api/download/:id)
//
// The download endpoint has two modes:
//   Default:  JSON { success, downloadUrl: "/api/download/:id?dl=1", ... }
//   ?dl=1:    streams all chunks sequentially as one continuous file
//             with Content-Disposition: attachment — Telegram is invisible.
// ==============================================================================
import { pipeline } from 'stream/promises';
import express from 'express';
import prisma from '../prisma/client.js';
import { startCacheJob, peekCacheEntry, getCacheStats, cacheMovie, resetMovieForRetry } from './hybridCache.js';
import { createChunkStream } from './chunker.js';
import { formatBytes } from './config.js';

const router = express.Router();

const httpStatus = (err, fallback = 500) =>
  err && Number.isInteger(err.statusCode) ? err.statusCode : fallback;

// ---------------------------------------------------------------------------
// POST /initiate — start the chunked caching pipeline
// Body: { movieId?, title, size, fileName?, mimeType?, filePath?, stream? }
// ---------------------------------------------------------------------------
router.post('/initiate', async (req, res) => {
  try {
    const result = await startCacheJob(req.body || {});
    if (result.promise) result.promise.catch(() => {});

    const { movie, state } = result;
    const cached = state === 'already-cached';

    return res.status(cached ? 200 : 202).json({
      success: true,
      data: {
        movieId: movie.id,
        title: movie.title,
        sizeBytes: movie.sizeBytes,
        sizeReadable: formatBytes(movie.sizeBytes),
        state,
        cached,
        statusUrl: `/api/hybrid-cache/status/${movie.id}`,
      },
    });
  } catch (err) {
    const status = httpStatus(err, /required|does not exist/i.test(err.message || '') ? 400 : 500);
    console.error(`[CDN_API] POST /initiate failed (${status}):`, err.message);
    return res.status(status).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /download/:idOrTitle — frontend DownloadButton endpoint
//   Default: JSON metadata with downloadUrl pointing at the ?dl=1 stream
//   ?dl=1:   sequential chunk streaming with attachment headers
// ---------------------------------------------------------------------------
async function handleDownload(req, res) {
  try {
    const { idOrTitle } = req.params;
    const magnetLink = req.query.magnet || null;
    const title = req.query.title || null;
    const isStreamMode = req.query.dl === '1';

    const entry = await peekCacheEntry(idOrTitle);

    // ---- Not in DB at all: queue if magnet provided, otherwise 404
    if (!entry) {
      if (!magnetLink && !title) {
        return res.status(404).json({
          success: false,
          message: 'Movie not found. Provide ?magnet= (and optionally ?title=) to queue it for caching.',
        });
      }
      console.log(`[CDN_API] Queueing new download request: key="${idOrTitle}" | ?title="${title || 'none'}" | magnet=${magnetLink ? 'present' : 'none'}`);
      const movie = await cacheMovie({ title, magnetLink, fallbackTitle: idOrTitle });
      return res.status(202).json({
        success: true,
        cached: false,
        downloadUrl: null,
        state: 'queued',
        movieId: movie.id,
        title: movie.title,
        message: 'Movie queued for caching. Poll this endpoint — downloadUrl appears once cached.',
      });
    }

    const { movie } = entry;

    // ---- FORCE RESET ON RETRY: a failed, stuck-queued, or never-started
    // ('pending') movie must requeue immediately when the user clicks
    // "Try Again" — otherwise the endpoint would keep returning the same
    // stuck state forever. ('pending' rows are NEVER picked up by the worker,
    // which only scans 'queued' — without this they hang indefinitely.)
    if (['failed', 'queued', 'pending'].includes(movie.status)) {
      const previousError = movie.lastError || null;
      const reset = await resetMovieForRetry({ movieId: movie.id, title, magnetLink, fallbackTitle: idOrTitle });
      if (reset) {
        return res.status(202).json({
          success: true,
          cached: false,
          downloadUrl: null,
          state: 'queued',
          movieId: reset.id,
          title: reset.title,
          message: previousError
            ? `Previous attempt failed (${previousError}). A fresh download has been queued — retrying now.`
            : 'Download re-queued — a fresh attempt is starting now. Poll this endpoint.',
        });
      }
      // reset returned null (row vanished) — fall through and queue fresh below
      console.log(`[CDN_API] Reset found no row for key="${idOrTitle}" — queueing fresh`);
      const fresh = await cacheMovie({ title, magnetLink, fallbackTitle: idOrTitle });
      return res.status(202).json({
        success: true,
        cached: false,
        downloadUrl: null,
        state: 'queued',
        movieId: fresh.id,
        title: fresh.title,
        message: 'Movie queued for caching. Poll this endpoint — downloadUrl appears once cached.',
      });
    }

    // ---- Actively downloading: keep the queue priority untouched and let the
    // client keep polling. (Touching lastDownloadedAt here would demote the
    // movie to the back of the worker's oldest-first queue.)
    if (!entry.cached) {
      return res.status(202).json({
        success: true,
        cached: false,
        downloadUrl: null,
        state: movie.status,
        movieId: movie.id,
        title: movie.title,
        message: 'Caching in progress. Poll again shortly.',
      });
    }

    // ---- Movie is READY
    // Touch the download timestamp (only for real downloads — this keeps the
    // worker's oldest-first queue ordering meaningful)
    await prisma.movie.update({
      where: { id: movie.id },
      data: { lastDownloadedAt: new Date() },
    });

    const fileName = movie.fileName || `${movie.title}.mp4`;

    if (isStreamMode) {
      // ---- STREAM MODE: pipe all chunks sequentially into the response
      const chunks = await prisma.movieChunk.findMany({
        where: { movieId: movie.id },
        orderBy: { chunkIndex: 'asc' },
      });

      if (chunks.length === 0) {
        return res.status(409).json({ success: false, message: 'No chunks found for this movie.' });
      }

      const totalSize = chunks.reduce((sum, c) => sum + c.chunkSize, 0);

      res.setHeader('Content-Type', movie.mimeType || 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\w.\- ]/g, '_')}"`);
      res.setHeader('Content-Length', String(totalSize));

      console.log(`[CDN_API] Streaming "${movie.title}" (${chunks.length} chunks, ${formatBytes(totalSize)})`);

      const source = createChunkStream(chunks);
      await pipeline(source, res);
      console.log(`[CDN_API] Stream complete for "${movie.title}"`);
      return;
    }

    // ---- JSON MODE: return metadata with the streaming URL
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost';

    return res.json({
      success: true,
      cached: true,
      downloadUrl: `${proto}://${host}/api/download/${movie.id}?dl=1`,
      movieId: movie.id,
      title: movie.title,
      fileName,
      sizeBytes: movie.sizeBytes,
      sizeReadable: formatBytes(movie.sizeBytes),
      lastDownloadedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (res.headersSent) {
      console.error('[CDN_API] Stream error after headers sent — destroying connection');
      res.destroy();
      return;
    }
    const status = httpStatus(err);
    console.error(`[CDN_API] GET /download failed (${status}):`, err.message);
    return res.status(status).json({ success: false, message: err.message });
  }
}

router.get('/download/:idOrTitle', handleDownload);

// ---------------------------------------------------------------------------
// GET /status/:idOrTitle — cache state (does NOT touch the download timestamp)
// ---------------------------------------------------------------------------
router.get('/status/:idOrTitle', async (req, res) => {
  try {
    const entry = await peekCacheEntry(req.params.idOrTitle);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Movie not found in the cache database.' });
    }
    return res.json({
      success: true,
      data: {
        movieId: entry.movie.id,
        title: entry.movie.title,
        sizeBytes: entry.movie.sizeBytes,
        sizeReadable: formatBytes(entry.movie.sizeBytes),
        status: entry.movie.status,
        cached: entry.cached,
        lastDownloadedAt: entry.movie.lastDownloadedAt,
        createdAt: entry.movie.createdAt,
      },
    });
  } catch (err) {
    console.error('[CDN_API] GET /status failed:', err.message);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /stats — cache counters
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const stats = await getCacheStats();
    return res.json({ success: true, data: stats });
  } catch (err) {
    console.error('[CDN_API] GET /stats failed:', err.message);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Standalone router: mounted at /api/download in server.js
// ---------------------------------------------------------------------------
const downloadRouter = express.Router();
downloadRouter.get('/:idOrTitle', handleDownload);

export { downloadRouter };
export default router;