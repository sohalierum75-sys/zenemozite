// ==============================================================================
// Hybrid Storage Cache — Express routes
//   POST /api/hybrid-cache/initiate        -> start caching a movie (202 + background upload)
//   GET  /api/hybrid-cache/status/:id      -> cache state of a movie (no LRU touch)
//   GET  /api/hybrid-cache/link/:id        -> direct download link + LRU timestamp update
//   GET  /api/hybrid-cache/stats           -> per-account free space + cache counts
//   POST /api/hybrid-cache/accounts/sync   -> seed DriveAccount rows from env credentials
// ==============================================================================
import express from 'express';
import { startCacheJob, peekCacheEntry, getDownloadLink, getCacheStats, syncDriveAccounts } from './hybridCache.js';
import { formatBytes } from './config.js';

const router = express.Router();

const httpStatus = (err, fallback = 500) =>
  err && Number.isInteger(err.statusCode) ? err.statusCode : fallback;

// ---------------------------------------------------------------------------
// POST /initiate — requirement 1 & 2: size-based routing + background caching
// Body: { movieId?, title, size, fileName?, mimeType?, filePath }
//   movieId : optional existing Movie.id (else matched by title, else created)
//   size    : bytes of the largest file in the torrent (from your torrent metadata)
//   filePath: server-local path of the downloaded file (your torrent-to-stream logic)
// ---------------------------------------------------------------------------
router.post('/initiate', async (req, res) => {
  try {
    const result = await startCacheJob(req.body || {});

    // Background job: never let an upload rejection become an unhandled rejection.
    // Failures are logged and the movie simply stays uncached / re-initiable.
    if (result.promise) result.promise.catch(() => {});

    const { movie, state, route } = result;
    const cached = state === 'already-cached';

    return res.status(cached ? 200 : 202).json({
      success: true,
      data: {
        movieId: movie.id,
        title: movie.title,
        size: movie.size,
        sizeReadable: formatBytes(movie.size),
        storageType: route,
        state, // started | already-processing | already-cached
        cached,
        statusUrl: `/api/hybrid-cache/status/${movie.id}`,
        linkUrl: `/api/hybrid-cache/link/${movie.id}`,
      },
    });
  } catch (err) {
    const status = httpStatus(err, /required|does not exist|Invalid/i.test(err.message || '') ? 400 : 500);
    console.error(`[HYBRID_API] POST /initiate failed (${status}):`, err.message);
    return res.status(status).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /status/:idOrTitle — current cache state (does NOT touch the LRU clock)
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
        size: entry.movie.size,
        sizeReadable: formatBytes(entry.movie.size),
        storageType: entry.storageType,
        cached: entry.cached,
        telegramFileId: entry.movie.telegramFileId || null,
        driveFileId: entry.movie.driveFileId || null,
        lastDownloadedAt: entry.movie.lastDownloadedAt,
        cachedAt: entry.movie.cachedAt,
      },
    });
  } catch (err) {
    console.error('[HYBRID_API] GET /status failed:', err.message);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /link/:idOrTitle — requirement 5: direct link + lastDownloadedAt update
// Works for BOTH storage types; the timestamp is touched on every call.
// ---------------------------------------------------------------------------
router.get('/link/:idOrTitle', async (req, res) => {
  try {
    const result = await getDownloadLink(req.params.idOrTitle);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Movie not found in the cache database.' });
    }

    if (!result.directLink) {
      return res.status(200).json({
        success: true,
        data: {
          cached: false,
          movieId: result.movie.id,
          title: result.movie.title,
          message: 'Movie is registered but not cached yet. POST /api/hybrid-cache/initiate first.',
        },
      });
    }

    return res.json({
      success: true,
      data: {
        cached: true,
        movieId: result.movie.id,
        title: result.movie.title,
        storageType: result.storageType,
        directLink: result.directLink,
        fileName: result.movie.fileName,
        size: result.movie.size,
        sizeReadable: formatBytes(result.movie.size),
        lastDownloadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const status = httpStatus(err);
    console.error(`[HYBRID_API] GET /link failed (${status}):`, err.message);
    return res.status(status).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /stats — DriveAccount free space overview + cache counters
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const stats = await getCacheStats();
    return res.json({ success: true, data: stats });
  } catch (err) {
    console.error('[HYBRID_API] GET /stats failed:', err.message);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /accounts/sync — seed DriveAccount rows from the configured credentials
// (idempotent, matched by email). Run once per new account.
// ---------------------------------------------------------------------------
router.post('/accounts/sync', async (req, res) => {
  try {
    const result = await syncDriveAccounts();
    return res.json({ success: true, data: result });
  } catch (err) {
    const status = httpStatus(err);
    console.error(`[HYBRID_API] POST /accounts/sync failed (${status}):`, err.message);
    return res.status(status).json({ success: false, message: err.message });
  }
});

export default router;