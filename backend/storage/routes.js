// ==============================================================================
// Telegram Invisible CDN — Express routes
//   POST /api/hybrid-cache/initiate    -> start caching (chunked upload, 202)
//   GET  /api/hybrid-cache/status/:id  -> cache state of a movie
//   GET  /api/hybrid-cache/stats       -> cache counters
//   GET  /api/download/:id             -> frontend DownloadButton endpoint
//                                         (also mounted standalone at /api/download/:id)
//
// The download endpoint has two modes:
//   Default:  JSON { success, downloadUrl, parts?, telegramFileIds, ... }
//             — for multi-part movies, `parts` lists every Telegram part
//             with its own downloadUrl (…?dl=1&part=N) so the frontend can
//             render "Download Part 1", "Download Part 2", … buttons.
//   ?dl=1:    streams chunks as attachment(s) — ALL parts concatenated into
//             one continuous file by default, or a single part with ?part=N.
//             Telegram is invisible either way.
// ==============================================================================
import { pipeline } from 'stream/promises';
import express from 'express';
import prisma from '../prisma/client.js';
import { startCacheJob, peekCacheEntry, getCacheStats, cacheMovie, resetMovieForRetry } from './hybridCache.js';
import { createChunkStream, buildPartFileName } from './chunker.js';
import { formatBytes } from './config.js';
import { resolveTelegramMedia, streamMediaToResponse } from './userbot.js';
import { streamTorrentFile } from './torrentStream.js';
import {
  generateSignedDownloadToken,
  verifySignedDownloadToken,
  handleDirectStreaming,
} from '../services/downloadService.js';

const router = express.Router();

/** Safely parse the Movie.telegramFileIds JSON column into an array of strings. */
function parseTelegramFileIds(json) {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

const httpStatus = (err, fallback = 500) =>
  err && Number.isInteger(err.statusCode) ? err.statusCode : fallback;

// ---------------------------------------------------------------------------
// POST /initiate — start the chunked caching pipeline
// Body: { movieId?, title, size, fileName?, mimeType?, filePath?, stream? }
// ---------------------------------------------------------------------------
router.post('/initiate', async (req, res) => {
  try {
    const result = await startCacheJob(req.body || {});
    if (result.promise) result.promise.catch(() => { });

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
// Strict Direct Download Handler (Pass-Through Streaming)
// GET /api/download/:file_id (and alias GET /api/stream/:file_id)
//
// 1. Checks Telegram message IDs, chunk IDs, and direct Telegram Bot API file_ids.
// 2. Checks Movie cache DB: if cached in Telegram, pipes file directly via HTTP
//    pass-through from Local Bot API URL without saving to VPS disk first (Zero-Storage).
// 3. Sets Content-Disposition: attachment; filename="movie.mp4" and
//    Content-Type: application/octet-stream to strictly force direct downloads.
// 4. Starts downloading immediately to the browser with zero wait time.
// 5. If ?info=1 is explicitly requested, returns cache metadata JSON.
// ---------------------------------------------------------------------------
export async function handleDownload(req, res) {
  try {
    const file_id = req.params.file_id || req.params.idOrTitle;
    const magnetLink = req.query.magnet || null;
    const title = req.query.title || null;
    const wantsJsonInfo = req.query.info === '1';
    const partNumber = parseInt(req.query.part, 10);
    const safeTitle = (title || 'movie').replace(/[^\w.\- ]/g, '_');

    // Ensure CORS headers allow downloads and expose content-disposition
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // 1. Direct Telegram channel message ID (e.g. /api/download/12345 or msg_12345)
    const isNumericMsg = /^\d+$/.test(file_id);
    const isMsgPrefixed = /^msg_(\d+)$/.test(file_id);
    if (isNumericMsg || isMsgPrefixed) {
      const msgId = isNumericMsg ? parseInt(file_id, 10) : parseInt(file_id.slice(4), 10);
      let media = null;
      try {
        media = await resolveTelegramMedia({ messageId: msgId, title });
      } catch (mErr) {
        console.warn(`[PASS_THROUGH_DOWNLOAD] resolveTelegramMedia error for msg ${msgId}:`, mErr.message);
      }

      if (!media) {
        return res.status(404).json({
          success: false,
          message: `Telegram message ${msgId} could not be resolved or file is not found (404).`,
        });
      }

      return await streamMediaToResponse({
        req,
        res,
        document: media.document,
        localFilePath: media.localFilePath,
        fileSize: media.fileSize,
        mimeType: 'application/octet-stream',
        fileName: media.fileName || `${safeTitle}.mp4`,
      });
    }

    // 2. Check if file_id is a MovieChunk id or telegramFileId
    let chunk = await prisma.movieChunk.findFirst({
      where: {
        OR: [
          { id: file_id },
          { telegramFileId: file_id },
        ],
      },
      include: { movie: true },
    }).catch(() => null);

    if (chunk) {
      const movie = chunk.movie;
      const partIdx = chunk.chunkIndex;
      const outFileName = movie?.fileName
        ? buildPartFileName(movie.fileName, partIdx, 1)
        : `${movie?.title || 'movie'}.mp4`;
      let media = null;
      try {
        media = await resolveTelegramMedia({
          messageId: chunk.telegramMessageId,
          fileId: chunk.telegramFileId,
          title: movie?.title,
        });
      } catch (err) {
        console.warn(`[PASS_THROUGH_DOWNLOAD] Error resolving chunk media:`, err.message);
      }

      if (!media) {
        return res.status(404).json({
          success: false,
          message: 'Telegram media for chunk could not be resolved or is not yet available (404).',
        });
      }

      return await streamMediaToResponse({
        req,
        res,
        document: media.document,
        localFilePath: media.localFilePath,
        fileSize: chunk.chunkSize || media.fileSize,
        mimeType: 'application/octet-stream',
        fileName: outFileName,
      });
    }

    // 3. Direct Telegram Bot API file_id (Pass-through stream from Local Bot API)
    if (config.telegram.configured && (file_id.length > 20 || file_id.startsWith('BAA') || file_id.startsWith('BQAC'))) {
      try {
        const directMedia = await resolveTelegramMedia({ fileId: file_id, title: title || 'movie' });
        if (directMedia && (directMedia.document || directMedia.localFilePath)) {
          console.log(`[PASS_THROUGH_DOWNLOAD] Direct Telegram file_id resolved: ${file_id}`);
          return await streamMediaToResponse({
            req,
            res,
            document: directMedia.document,
            localFilePath: directMedia.localFilePath,
            fileSize: directMedia.fileSize,
            mimeType: 'application/octet-stream',
            fileName: directMedia.fileName || `${safeTitle}.mp4`,
          });
        }
      } catch (directErr) {
        console.warn(`[PASS_THROUGH_DOWNLOAD] Direct file_id resolution failed for "${file_id}":`, directErr.message);
      }
    }

    // 3.5 Check if file_id exists in any Movie.telegram_files
    try {
      const movieWithTgFile = await prisma.movie.findFirst({
        where: {
          telegram_files: {
            contains: file_id,
          },
        },
      }).catch(() => null);

      if (movieWithTgFile?.telegram_files) {
        let tgList = [];
        try {
          tgList = JSON.parse(movieWithTgFile.telegram_files);
        } catch {}

        const matched = Array.isArray(tgList) && tgList.find((f) => f.file_id === file_id);
        if (matched) {
          let directMedia = null;
          try {
            directMedia = await resolveTelegramMedia({
              fileId: file_id,
              messageId: /^\d+$/.test(file_id) ? parseInt(file_id, 10) : undefined,
              title: movieWithTgFile.title,
            });
          } catch (mErr) {
            console.warn(`[PASS_THROUGH_DOWNLOAD] resolveTelegramMedia error for matched file ${file_id}:`, mErr.message);
          }

          if (directMedia && (directMedia.document || directMedia.localFilePath)) {
            const outName = `${movieWithTgFile.title} - ${matched.quality || '1080p'}.mp4`.replace(/[^\w.\- ]/g, '_');
            return await streamMediaToResponse({
              req,
              res,
              document: directMedia.document,
              localFilePath: directMedia.localFilePath,
              fileSize: directMedia.fileSize,
              mimeType: 'application/octet-stream',
              fileName: outName,
            });
          } else {
            return res.status(404).json({
              success: false,
              message: `Telegram download for "${movieWithTgFile.title}" (${matched.quality || '1080p'}) has not finished syncing or is not available on Telegram storage server (404).`,
              fileId: file_id,
            });
          }
        }
      }
    } catch (tgLookupErr) {
      console.warn(`[PASS_THROUGH_DOWNLOAD] telegram_files lookup check failed for "${file_id}":`, tgLookupErr.message);
    }

    // 4. Check if file_id is a Movie ID or Movie Title in the cache database
    const entry = await peekCacheEntry(file_id).catch(() => null);
    const activeMagnet = magnetLink || entry?.movie?.magnetLink || null;
    const movieTitle = entry?.movie?.title || title || file_id;
    const movieFileName = entry?.movie?.fileName || `${(movieTitle || 'movie').replace(/[^\w.\- ]/g, '_')}.mp4`;

    // ---- Not in DB at all:
    if (!entry) {
      if (activeMagnet && !wantsJsonInfo) {
        console.log(`[PASS_THROUGH_DOWNLOAD] Streaming direct torrent download for un-cached movie "${movieTitle}"`);
        cacheMovie({ title: movieTitle, magnetLink: activeMagnet, fallbackTitle: file_id }).catch(() => {});
        return await streamTorrentFile({
          magnetLink: activeMagnet,
          req,
          res,
          fileName: movieFileName,
        });
      }

      return res.status(404).json({
        success: false,
        message: `Requested download target "${file_id}" was not found or Telegram file has not been synced yet (404).`,
      });
    }

    const { movie } = entry;

    // ---- FORCE RESET ON RETRY if failed/queued/pending
    if (['failed', 'queued', 'pending'].includes(movie.status)) {
      if (activeMagnet && !wantsJsonInfo) {
        console.log(`[PASS_THROUGH_DOWNLOAD] Streaming direct torrent download while background retrying: "${movieTitle}"`);
        resetMovieForRetry({ movieId: movie.id, title, magnetLink: activeMagnet, fallbackTitle: file_id }).catch(() => {});
        return await streamTorrentFile({
          magnetLink: activeMagnet,
          req,
          res,
          fileName: movieFileName,
        });
      }

      const previousError = movie.lastError || null;
      const reset = await resetMovieForRetry({ movieId: movie.id, title, magnetLink: activeMagnet, fallbackTitle: file_id });
      return res.status(202).json({
        success: true,
        cached: false,
        downloadUrl: null,
        state: 'queued',
        movieId: reset ? reset.id : movie.id,
        title: reset ? reset.title : movie.title,
        message: previousError
          ? `Previous attempt failed (${previousError}). A fresh download has been queued — retrying now.`
          : 'Download re-queued — a fresh attempt is starting now.',
      });
    }

    // ---- Actively downloading / not yet cached
    if (!entry.cached) {
      if (activeMagnet && !wantsJsonInfo) {
        console.log(`[PASS_THROUGH_DOWNLOAD] In-flight cache: streaming direct torrent download for "${movieTitle}"`);
        return await streamTorrentFile({
          magnetLink: activeMagnet,
          req,
          res,
          fileName: movieFileName,
        });
      }
      return res.status(202).json({
        success: true,
        cached: false,
        downloadUrl: null,
        state: movie.status,
        movieId: movie.id,
        title: movie.title,
        message: 'Caching in progress. Direct download will start once ready.',
      });
    }

    // ---- Movie is READY in DB
    await prisma.movie.update({
      where: { id: movie.id },
      data: { lastDownloadedAt: new Date() },
    });

    const fileName = movie.fileName || `${movie.title}.mp4`;
    const chunks = await prisma.movieChunk.findMany({
      where: { movieId: movie.id },
      orderBy: { chunkIndex: 'asc' },
    });

    if (chunks.length === 0) {
      if (activeMagnet) {
        return await streamTorrentFile({ magnetLink: activeMagnet, req, res, fileName: movieFileName });
      }
      return res.status(409).json({ success: false, message: 'No chunks found for this movie.' });
    }

    // JSON info mode (only if explicitly requested with ?info=1)
    if (wantsJsonInfo) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost';
      const parts = chunks.map((chunk, idx) => ({
        part: idx + 1,
        fileName: buildPartFileName(fileName, idx, chunks.length),
        sizeBytes: chunk.chunkSize,
        sizeReadable: formatBytes(chunk.chunkSize),
        fileId: chunk.telegramFileId,
        messageId: chunk.telegramMessageId,
        downloadUrl: `${proto}://${host}/api/download/${movie.id}?part=${idx + 1}`,
      }));

      const persistedFileIds = parseTelegramFileIds(movie.telegramFileIds);
      const telegramFileIds = persistedFileIds.length > 0
        ? persistedFileIds
        : chunks.map((c) => c.telegramFileId);

      return res.json({
        success: true,
        cached: true,
        downloadUrl: `${proto}://${host}/api/download/${movie.id}`,
        parts,
        chunkCount: chunks.length,
        telegramFileIds,
        movieId: movie.id,
        title: movie.title,
        fileName,
        sizeBytes: movie.sizeBytes,
        sizeReadable: formatBytes(movie.sizeBytes),
        lastDownloadedAt: new Date().toISOString(),
      });
    }

    // DIRECT PASS-THROUGH DOWNLOAD STREAM
    const wantsSinglePart = Number.isInteger(partNumber) && partNumber >= 1;
    if (wantsSinglePart && partNumber > chunks.length) {
      return res.status(404).json({
        success: false,
        message: `Part ${partNumber} does not exist — this movie has ${chunks.length} part(s).`,
      });
    }

    const targetIdx = wantsSinglePart ? partNumber - 1 : 0;
    const targetChunk = chunks[targetIdx];
    const outFileName = wantsSinglePart
      ? buildPartFileName(fileName, partNumber - 1, chunks.length)
      : (chunks.length > 1 ? buildPartFileName(fileName, 0, chunks.length) : fileName);

    // Try resolving directly from Telegram API URL / GramJS
    const media = await resolveTelegramMedia({
      messageId: targetChunk.telegramMessageId,
      fileId: targetChunk.telegramFileId,
      title: movieTitle,
    });

    if (media) {
      return await streamMediaToResponse({
        req,
        res,
        document: media.document,
        localFilePath: media.localFilePath,
        fileSize: targetChunk.chunkSize || media.fileSize,
        mimeType: 'application/octet-stream',
        fileName: outFileName,
      });
    }

    // Fallback: chunk pass-through stream concatenation
    const streamChunks = wantsSinglePart ? [chunks[partNumber - 1]] : chunks;
    const totalSize = streamChunks.reduce((sum, c) => sum + c.chunkSize, 0);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${outFileName.replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('Content-Length', String(totalSize));

    console.log(
      `[PASS_THROUGH_DOWNLOAD] Streaming pass-through download for "${movie.title}"` +
        (wantsSinglePart ? ` part ${partNumber}/${chunks.length}` : ` (${chunks.length} part(s) concatenated)`) +
        ` (${formatBytes(totalSize)})`
    );

    const source = createChunkStream(streamChunks);
    await pipeline(source, res);
    console.log(`[PASS_THROUGH_DOWNLOAD] Download complete for "${movie.title}"`);
    return;
  } catch (err) {
    if (res.headersSent) {
      console.error('[PASS_THROUGH_DOWNLOAD] Stream error after headers sent:', err.message);
      res.end();
      return;
    }
    const status = httpStatus(err, 500);
    console.error(`[PASS_THROUGH_DOWNLOAD] GET /download failed (${status}):`, err.message);
    return res.status(status).json({ success: false, message: err.message });
  }
}

router.get('/download/:file_id', handleDownload);

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
// GET /stream/:file_id — Direct Download Alias (Pass-Through Streaming)
// Directs all /api/stream/:file_id requests to the direct download handler
// ---------------------------------------------------------------------------
export const handleStream = handleDownload;

router.get('/stream/:file_id', handleDownload);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Standalone routers: mounted at /api/download and /api/stream in server.js
// ---------------------------------------------------------------------------
const downloadRouter = express.Router();

// 1. Generate cryptographically signed download URL
downloadRouter.get('/token/:targetId', (req, res) => {
  try {
    const { targetId } = req.params;
    const { quality, ttl } = req.query;
    const ttlSeconds = parseInt(ttl, 10) || 86400;
    const result = generateSignedDownloadToken({
      variantId: targetId,
      quality: quality || '1080p',
      ttlSeconds,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Direct streaming with signed token verification & range requests
downloadRouter.get('/direct', async (req, res) => {
  const { token, quality } = req.query;
  const verified = verifySignedDownloadToken(token);
  if (!verified.valid) {
    return res.status(401).json({ success: false, error: verified.error });
  }
  return handleDirectStreaming({
    req,
    res,
    targetId: verified.targetId,
    requestedQuality: verified.quality || quality,
  });
});

downloadRouter.get('/:file_id', handleDownload);
downloadRouter.get('/:idOrTitle', handleDownload);

const streamRouter = express.Router();
streamRouter.get('/:file_id', handleDownload);

export { downloadRouter, streamRouter };
export default router;