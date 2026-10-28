import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import prisma from '../prisma/client.js';
import { config, formatBytes } from '../storage/config.js';
import { getFileInfo, resolveLocalDiskPath, openFileStream } from '../storage/telegramStore.js';

// Signing secret for generating secure HMAC tokens
export const SIGNING_SECRET = (
  process.env.DOWNLOAD_SIGNING_SECRET ||
  process.env.JWT_SECRET ||
  'zinemo_download_secure_signing_secret_2026'
).trim();

// Concurrency limits per client IP (default max 4 simultaneous downloads)
const MAX_CONCURRENT_DOWNLOADS_PER_IP = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '4', 10);
const activeDownloadsPerIp = new Map();

/**
 * Generate a cryptographically signed download token
 *
 * @param {object} params
 * @param {string} params.variantId - MovieFileVariant ID or file_id
 * @param {string} params.movieId
 * @param {string} [params.quality] - e.g. "1080p"
 * @param {number} [params.ttlSeconds] - Valid duration in seconds (default 24h)
 * @returns {{ token: string, expiresAt: number, downloadUrl: string }}
 */
export function generateSignedDownloadToken({ variantId, movieId, quality = '1080p', ttlSeconds = 86400 } = {}) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const targetId = String(variantId || '').trim();

  // Payload: targetId:expiresAt:quality
  const payload = `${targetId}:${expiresAt}:${quality}`;
  const signature = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('hex');

  const token = Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');

  return {
    token,
    expiresAt,
    downloadUrl: `/api/download/direct?token=${encodeURIComponent(token)}`,
  };
}

/**
 * Verify a signed download token
 *
 * @param {string} token
 * @returns {{ valid: boolean, targetId?: string, quality?: string, error?: string }}
 */
export function verifySignedDownloadToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing download token' };
  }

  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const { payload, signature } = JSON.parse(raw);

    if (!payload || !signature) {
      return { valid: false, error: 'Malformed token payload' };
    }

    const expectedSignature = crypto
      .createHmac('sha256', SIGNING_SECRET)
      .update(payload)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
      return { valid: false, error: 'Invalid token signature' };
    }

    const [targetId, expiresAtStr, quality] = payload.split(':');
    const expiresAt = parseInt(expiresAtStr, 10);

    if (Date.now() / 1000 > expiresAt) {
      return { valid: false, error: 'Download link has expired. Please refresh the page.' };
    }

    return {
      valid: true,
      targetId,
      quality: quality || '1080p',
    };
  } catch (err) {
    return { valid: false, error: 'Invalid or corrupted token' };
  }
}

/**
 * Track IP concurrency
 */
function acquireDownloadSlot(ip) {
  const current = activeDownloadsPerIp.get(ip) || 0;
  if (current >= MAX_CONCURRENT_DOWNLOADS_PER_IP) {
    return false;
  }
  activeDownloadsPerIp.set(ip, current + 1);
  return true;
}

function releaseDownloadSlot(ip) {
  const current = activeDownloadsPerIp.get(ip) || 0;
  if (current <= 1) {
    activeDownloadsPerIp.delete(ip);
  } else {
    activeDownloadsPerIp.set(ip, current - 1);
  }
}

/**
 * Sanitize filename for HTTP Content-Disposition headers (RFC 5987 safe)
 */
export function sanitizeFileName(name = 'movie.mp4') {
  return String(name)
    .replace(/[^\w.\- ()[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * High-Performance Direct Streaming Handler
 * Handles HTTP Range requests, X-Accel-Redirect, resume support, and rights checking.
 *
 * @param {object} options
 * @param {import('express').Request} options.req
 * @param {import('express').Response} options.res
 * @param {string} options.targetId - Variant ID, Movie ID, or Telegram file_id
 * @param {string} [options.requestedQuality]
 */
export async function handleDirectStreaming({ req, res, targetId, requestedQuality } = {}) {
  const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

  // Check concurrency limit
  if (!acquireDownloadSlot(clientIp)) {
    return res.status(429).json({
      success: false,
      message: `Too many concurrent downloads from your IP. Limit is ${MAX_CONCURRENT_DOWNLOADS_PER_IP}. Please wait for active downloads to finish.`,
    });
  }

  // Ensure slot is freed when response ends or client disconnects
  let slotReleased = false;
  const freeSlot = () => {
    if (!slotReleased) {
      slotReleased = true;
      releaseDownloadSlot(clientIp);
    }
  };
  res.on('finish', freeSlot);
  res.on('close', freeSlot);

  try {
    // 1. Locate MovieFileVariant or Movie record
    let variant = await prisma.movieFileVariant.findFirst({
      where: {
        OR: [
          { id: targetId },
          { telegramFileId: targetId },
          ...(requestedQuality ? [{ movieId: targetId, quality: requestedQuality }] : [{ movieId: targetId }]),
        ],
      },
      include: {
        movie: {
          include: { rights: true },
        },
      },
    }).catch(() => null);

    let movie = variant?.movie;

    // Fallback: If not found in MovieFileVariant, check Movie table directly
    if (!variant) {
      movie = await prisma.movie.findFirst({
        where: {
          OR: [
            { id: targetId },
            { telegramFileIds: { contains: targetId } },
            { telegram_files: { contains: targetId } },
          ],
        },
        include: { rights: true, variants: true },
      }).catch(() => null);

      if (movie?.variants && movie.variants.length > 0) {
        variant = requestedQuality
          ? movie.variants.find((v) => v.quality.toLowerCase() === requestedQuality.toLowerCase()) || movie.variants[0]
          : movie.variants[0];
      }
    }

    // 2. Access Control: Enforce Redistribution Rights
    // If rights for this movie are expired or revoked, immediately block download (403 Forbidden)
    if (movie?.rights && movie.rights.length > 0) {
      const activeRight = movie.rights[0];
      if (activeRight.verificationStatus === 'revoked' || activeRight.verificationStatus === 'expired') {
        console.warn(`[DOWNLOAD_SECURITY] BLOCKED: Rights status for "${movie.title}" is "${activeRight.verificationStatus}".`);
        return res.status(403).json({
          success: false,
          error: 'Content unavailable: Redistribution rights for this title have expired or been revoked.',
        });
      }
    }

    // 3. Resolve Telegram file details
    const telegramFileId = variant?.telegramFileId || targetId;
    const movieTitle = movie?.title || 'movie';
    const qualityLabel = variant?.quality || requestedQuality || '1080p';
    const outFileName = sanitizeFileName(`${movieTitle} [${qualityLabel}].mp4`);

    console.log(`[DOWNLOAD_STREAM] Request from ${clientIp} for "${movieTitle}" (${qualityLabel}) - fileId: ${telegramFileId}`);

    // Resolve file info via Local Bot API
    const fileInfo = await getFileInfo(telegramFileId).catch((err) => {
      console.warn(`[DOWNLOAD_STREAM] getFileInfo failed for ${telegramFileId}:`, err.message);
      return null;
    });

    if (!fileInfo || !fileInfo.filePath) {
      return res.status(404).json({
        success: false,
        error: `Telegram file could not be resolved or has expired on the Telegram storage server (404).`,
      });
    }

    const totalSize = variant?.fileSizeBytes || fileInfo.fileSize || null;
    const localDiskPath = resolveLocalDiskPath(fileInfo.filePath);

    // 4. Check for Nginx X-Accel-Redirect Optimization
    const useXAccel = process.env.USE_X_ACCEL_REDIRECT === 'true' || req.headers['x-accel-support'] === '1';
    if (useXAccel && localDiskPath && fs.existsSync(localDiskPath)) {
      console.log(`[DOWNLOAD_STREAM] Offloading to Nginx X-Accel-Redirect: ${localDiskPath}`);
      const relativePath = path.relative('/var/lib/telegram-bot-api', localDiskPath).replace(/\\/g, '/');

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${outFileName}"`);
      res.setHeader('X-Accel-Redirect', `/protected_downloads/${relativePath}`);
      return res.status(200).end();
    }

    // 5. Parse HTTP Range Request Headers (for resume support and seeking)
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = totalSize ? totalSize - 1 : undefined;

    if (rangeHeader && totalSize) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const parsedStart = parseInt(parts[0], 10);
      const parsedEnd = parts[1] ? parseInt(parts[1], 10) : end;

      if (!isNaN(parsedStart)) start = parsedStart;
      if (!isNaN(parsedEnd) && parsedEnd < totalSize) end = parsedEnd;

      if (start > end || start >= totalSize) {
        res.setHeader('Content-Range', `bytes */${totalSize}`);
        return res.status(416).send('Requested Range Not Satisfiable');
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      res.setHeader('Content-Length', chunkSize);
    } else {
      res.status(200);
      if (totalSize) {
        res.setHeader('Content-Length', totalSize);
      }
    }

    // Standard Download Headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${outFileName}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Content-Disposition, Accept-Ranges');

    // 6. Stream Data with Zero-RAM overhead
    let dataStream = null;

    if (localDiskPath && fs.existsSync(localDiskPath)) {
      // Stream directly from VPS disk via fs.createReadStream
      console.log(`[DOWNLOAD_STREAM] Streaming from local disk (bytes ${start}-${end}): ${localDiskPath}`);
      dataStream = fs.createReadStream(localDiskPath, {
        start,
        end: end !== undefined ? end : undefined,
        highWaterMark: 1024 * 1024 * 2, // 2MB buffers
      });
    } else {
      // Pass-through HTTP stream directly from Local Bot API
      console.log(`[DOWNLOAD_STREAM] Pass-through HTTP stream from Local Bot API: ${fileInfo.filePath}`);
      dataStream = await openFileStream(fileInfo.filePath, { start, end });
    }

    // Pipe stream to Express response
    dataStream.pipe(res);

    dataStream.on('error', (err) => {
      console.warn(`[DOWNLOAD_STREAM] Stream error (${outFileName}):`, err.message);
      if (!res.headersSent) {
        res.status(500).end('Streaming error');
      }
    });

    req.on('close', () => {
      if (dataStream && typeof dataStream.destroy === 'function' && !dataStream.destroyed) {
        dataStream.destroy();
      }
    });

    // 7. Asynchronous Download Analytics Tracking
    if (start === 0) {
      if (variant?.id) {
        prisma.movieFileVariant.update({
          where: { id: variant.id },
          data: { downloadCount: { increment: 1 } },
        }).catch(() => {});
      }

      prisma.movieDownload.create({
        data: {
          variantId: variant?.id || null,
          movieId: movie?.id || null,
          quality: qualityLabel,
          ipAddress: clientIp,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
          bytesDownloaded: totalSize ? Number(totalSize) : 0,
          completed: false,
        },
      }).catch(() => {});
    }

  } catch (err) {
    console.error(`[DOWNLOAD_STREAM] Unhandled stream exception:`, err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Internal streaming error' });
    }
  }
}

export default {
  generateSignedDownloadToken,
  verifySignedDownloadToken,
  handleDirectStreaming,
  sanitizeFileName,
};
