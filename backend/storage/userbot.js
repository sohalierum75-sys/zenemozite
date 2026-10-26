// ==============================================================================
// Telegram Userbot & Direct MTProto Streaming Engine (GramJS)
//
// Features:
// 1. Converts GramJS async iterator into standard Node.js Readable stream via
//    Readable.from() before piping to the Express response.
// 2. Full HTTP 206 Partial Content & Range request support for seeking.
// 3. ZERO-RAM approach: chunks flow sequentially through Node streams with native
//    backpressure handling — never accumulated in memory.
// 4. ZERO-DISK approach: streamed in-flight without saving anything to the VPS disk.
// 5. Force Download: Always sets Content-Disposition: attachment; filename="download.mp4"
//    so the browser triggers a native file download.
// 6. Robust error catching: Client cancellations / socket closures are trapped
//    safely so the Node process never crashes.
// ==============================================================================
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import bigInt from 'big-integer';
import axios from 'axios';
import { config, formatBytes } from './config.js';
import { getFilePath, getFileInfo, resolveLocalDiskPath } from './telegramStore.js';

let clientInstance = null;
let clientInitPromise = null;
let savedSessionString = config.telegram.stringSession || '';

/**
 * Get or initialize the Telegram MTProto Client singleton.
 */
export async function getUserbotClient() {
  if (clientInstance) {
    if (clientInstance.connected) {
      return clientInstance;
    }
    try {
      console.log('[USERBOT] Reconnecting Telegram MTProto client...');
      await clientInstance.connect();
      return clientInstance;
    } catch (reconnectErr) {
      console.warn('[USERBOT] Reconnection failed, creating fresh client:', reconnectErr.message);
      clientInstance = null;
    }
  }

  if (clientInitPromise) {
    return clientInitPromise;
  }

  clientInitPromise = (async () => {
    const apiId = config.telegram.apiId;
    const apiHash = config.telegram.apiHash;
    const botToken = config.telegram.botToken;

    if (!apiId || !apiHash) {
      console.warn('[USERBOT] Telegram API_ID or API_HASH missing — MTProto direct streaming disabled.');
      return null;
    }

    try {
      console.log(`[USERBOT] Initializing GramJS MTProto client (API ID: ${apiId})...`);
      const session = new StringSession(savedSessionString || '');
      const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false,
        timeout: 30000,
        autoReconnect: true,
      });

      if (savedSessionString) {
        console.log('[USERBOT] Connecting via cached StringSession...');
        await client.connect();
        console.log('[USERBOT] Successfully connected to Telegram MTProto via StringSession!');
      } else if (botToken) {
        console.log('[USERBOT] No StringSession found. Connecting via Bot Token...');
        await client.start({
          botAuthToken: botToken,
        });
        savedSessionString = client.session.save();
        console.log('[USERBOT] Successfully signed in and cached MTProto session!');
      } else {
        console.warn('[USERBOT] Neither TELEGRAM_STRING_SESSION nor TELEGRAM_BOT_TOKEN provided.');
        return null;
      }

      clientInstance = client;
      return clientInstance;
    } catch (err) {
      console.error('[USERBOT] Failed to initialize GramJS MTProto client:', err.message);
      clientInstance = null;
      return null;
    } finally {
      clientInitPromise = null;
    }
  })();

  return clientInitPromise;
}

/**
 * Resolve a Telegram MTProto Document object from a channel message ID or file_id.
 */
export async function resolveTelegramMedia({ messageId, fileId, title } = {}) {
  const client = await getUserbotClient();
  const chatId = config.telegram.chatId;

  if (client && chatId) {
    // 1. Try resolving directly by message ID
    if (messageId && Number.isInteger(Number(messageId))) {
      try {
        console.log(`[USERBOT] Resolving message ${messageId} from chat ${chatId}...`);
        const messages = await client.getMessages(chatId, { ids: [Number(messageId)] });
        const msg = messages?.[0];
        if (msg && msg.media) {
          const doc = msg.media.document || msg.media;
          if (doc) {
            let docName = `${title || 'download'}.mp4`;
            if (Array.isArray(doc.attributes)) {
              const fileNameAttr = doc.attributes.find((a) => a.fileName || a.className === 'DocumentAttributeFilename');
              if (fileNameAttr?.fileName) docName = fileNameAttr.fileName;
            }
            console.log(`[USERBOT] Resolved MTProto document "${docName}" (${doc.size} bytes) from msg ${messageId}`);
            return {
              document: doc,
              fileSize: Number(doc.size || 0),
              mimeType: doc.mimeType || 'video/mp4',
              fileName: docName,
              messageId: msg.id,
            };
          }
        }
      } catch (err) {
        console.warn(`[USERBOT] Failed to fetch message ${messageId} via MTProto:`, err.message);
      }
    }

    // 2. Channel search ONLY when running as full Userbot (bots get BOT_METHOD_INVALID on GetHistory)
    if (title && config.telegram.stringSession) {
      try {
        const cleanTitle = title.replace(/[^\w\s]/g, ' ').trim().slice(0, 30);
        console.log(`[USERBOT] Searching channel for "${cleanTitle}"...`);
        for await (const msg of client.iterMessages(chatId, { search: cleanTitle, limit: 10 })) {
          if (msg.media && (msg.media.document || msg.media)) {
            const doc = msg.media.document || msg.media;
            let docName = `${title || 'download'}.mp4`;
            if (Array.isArray(doc.attributes)) {
              const fileNameAttr = doc.attributes.find((a) => a.fileName || a.className === 'DocumentAttributeFilename');
              if (fileNameAttr?.fileName) docName = fileNameAttr.fileName;
            }
            console.log(`[USERBOT] Found document "${docName}" via channel search (msg ${msg.id})`);
            return {
              document: doc,
              fileSize: Number(doc.size || 0),
              mimeType: doc.mimeType || 'video/mp4',
              fileName: docName,
              messageId: msg.id,
            };
          }
        }
      } catch (err) {
        console.warn(`[USERBOT] Channel search for "${title}" failed:`, err.message);
      }
    }
  }

  // 3. Fallback: If MTProto document object not found, resolve local Bot API file_path
  if (fileId && config.telegram.configured) {
    try {
      console.log(`[USERBOT] Resolving file_id "${fileId}" via Telegram Bot API...`);
      const info = await getFileInfo(fileId);
      console.log(`[USERBOT] Resolved Bot API file_path: ${info.filePath} (${info.fileSize ? formatBytes(info.fileSize) : 'unknown size'})`);
      return {
        document: null,
        localFilePath: info.filePath,
        fileSize: info.fileSize,
        mimeType: 'video/mp4',
        fileName: `${title || 'download'}.mp4`,
      };
    } catch (err) {
      console.warn(`[USERBOT] Local Bot API getFileInfo failed for ${fileId}:`, err.message);
    }
  }

  return null;
}

/**
 * Helper to slice GramJS chunks to exact ranged byte boundaries.
 */
async function* sliceRangedGenerator(iter, totalBytesToStream, onCancel) {
  let bytesSent = 0;
  try {
    for await (const chunk of iter) {
      if (onCancel && onCancel()) {
        break;
      }
      const remaining = totalBytesToStream - bytesSent;
      if (remaining <= 0) break;

      const toSend = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      bytesSent += toSend.length;
      yield toSend;

      if (bytesSent >= totalBytesToStream) break;
    }
  } catch (err) {
    if (onCancel && onCancel()) {
      return; // cancellation
    }
    throw err;
  }
}

/**
 * Stream a Telegram media file directly to an Express HTTP response.
 * Uses Readable.from() to convert GramJS async iterable to a standard Node.js stream.
 * Sets Content-Disposition: attachment for browser download and traps cancellation errors safely.
 */
export async function streamMediaToResponse({
  req,
  res,
  document,
  localFilePath,
  fileSize,
  mimeType = 'video/mp4',
  fileName = 'download.mp4',
}) {
  const safeFileName = (fileName || 'download.mp4').replace(/[^\w.\- ]/g, '_');
  const totalSize = Number(fileSize) || 0;
  const rangeHeader = req.headers.range;

  // ---------------------------------------------------------------------------
  // 1. GramJS MTProto Direct Streaming (Readable.from conversion)
  // ---------------------------------------------------------------------------
  if (document && totalSize > 0) {
    const client = await getUserbotClient();
    if (client) {
      let start = 0;
      let end = totalSize - 1;
      let statusCode = 200;

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const rawStart = parseInt(parts[0], 10);
        const rawEnd = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

        start = !isNaN(rawStart) ? Math.max(0, rawStart) : 0;
        end = !isNaN(rawEnd) ? Math.min(rawEnd, totalSize - 1) : totalSize - 1;

        if (start >= totalSize || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${totalSize}`);
          return res.end();
        }

        statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      }

      const contentLength = end - start + 1;

      // Proper Download Headers: Content-Disposition attachment ensures real browser download
      res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
      res.setHeader('Content-Type', mimeType || 'video/mp4');
      res.setHeader('Content-Length', String(contentLength));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(statusCode);

      console.log(
        `[USERBOT_STREAM] Streaming "${safeFileName}" (status ${statusCode}, bytes ${start}-${end}/${totalSize}, size ${formatBytes(contentLength)}) via Readable.from()`
      );

      let clientAborted = false;
      const onReqClose = () => {
        clientAborted = true;
      };
      req.once('close', onReqClose);

      try {
        const CHUNK_SIZE = 512 * 1024; // 512KB chunks
        const iter = client.iterDownload({
          file: document,
          offset: bigInt(start),
          requestSize: CHUNK_SIZE,
          chunkSize: CHUNK_SIZE,
        });

        // Convert the async iterable to standard Node.js Readable stream
        const rangedGenerator = sliceRangedGenerator(iter, contentLength, () => clientAborted);
        const readableStream = Readable.from(rangedGenerator);

        req.once('close', () => {
          if (!readableStream.destroyed) readableStream.destroy();
        });

        await pipeline(readableStream, res);
        console.log(`[USERBOT_STREAM] Completed streaming "${safeFileName}"`);
        return;
      } catch (streamErr) {
        if (clientAborted || streamErr.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          console.log(`[USERBOT_STREAM] Download cancelled by user for "${safeFileName}"`);
          return;
        }
        console.error(`[USERBOT_STREAM] Stream error for "${safeFileName}":`, streamErr.message);
        if (!res.headersSent) {
          return res.status(500).json({ success: false, message: streamErr.message });
        }
        res.destroy();
        return;
      } finally {
        req.removeListener('close', onReqClose);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Direct Disk Stream from Local Bot API mapped volume (fs.createReadStream)
  // ---------------------------------------------------------------------------
  if (localFilePath) {
    const diskPath = resolveLocalDiskPath(localFilePath);
    if (diskPath && fs.existsSync(diskPath)) {
      try {
        const stats = fs.statSync(diskPath);
        const totalSize = stats.size || fileSize;
        const contentType = mimeType || 'video/mp4';

        console.log(`[LOCAL_DISK_STREAM] Streaming directly from mapped volume: "${diskPath}" (${formatBytes(totalSize)})`);

        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', isDownload ? `attachment; filename="${safeFileName}"` : `inline; filename="${safeFileName}"`);

        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

            if (start >= totalSize || end >= totalSize) {
              res.setHeader('Content-Range', `bytes */${totalSize}`);
              return res.status(416).json({ success: false, message: 'Requested range not satisfiable' });
            }

            const contentLength = end - start + 1;
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
            res.setHeader('Content-Length', contentLength);

            const fileStream = fs.createReadStream(diskPath, { start, end });
            req.once('close', () => {
              if (!fileStream.destroyed) fileStream.destroy();
            });

            await pipeline(fileStream, res);
            console.log(`[LOCAL_DISK_STREAM] Completed range stream: ${start}-${end}/${totalSize} for "${safeFileName}"`);
            return;
          }
        }

        // Full file stream (no range)
        res.status(200);
        res.setHeader('Content-Length', totalSize);

        const fileStream = fs.createReadStream(diskPath);
        req.once('close', () => {
          if (!fileStream.destroyed) fileStream.destroy();
        });

        await pipeline(fileStream, res);
        console.log(`[LOCAL_DISK_STREAM] Completed full stream for "${safeFileName}"`);
        return;
      } catch (err) {
        if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          console.log(`[LOCAL_DISK_STREAM] Stream cancelled by client for "${safeFileName}"`);
          return;
        }
        console.error('[LOCAL_DISK_STREAM] Disk stream failed:', err.message);
        if (!res.headersSent) {
          return res.status(500).json({ success: false, message: err.message });
        }
        res.destroy();
        return;
      }
    }

    // ---------------------------------------------------------------------------
    // 3. Fallback: Local Bot API HTTP Stream (when volume mount is not direct)
    // ---------------------------------------------------------------------------
    const streamUrl = `${config.telegram.localApiUrl}/file/bot${config.telegram.botToken}/${localFilePath}`;
    const headers = {};
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    try {
      console.log(`[USERBOT_STREAM] Fallback: Streaming from Local Bot API HTTP: ${streamUrl}`);
      const response = await axios.get(streamUrl, {
        headers,
        responseType: 'stream',
        timeout: 0,
      });

      res.setHeader('Content-Disposition', isDownload ? `attachment; filename="${safeFileName}"` : `inline; filename="${safeFileName}"`);
      res.setHeader('Content-Type', mimeType || 'video/mp4');
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      if (response.headers['content-range']) {
        res.setHeader('Content-Range', response.headers['content-range']);
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.status(response.status);

      req.once('close', () => {
        if (response.data?.destroy) response.data.destroy();
      });

      await pipeline(response.data, res);
      return;
    } catch (err) {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
        console.log(`[USERBOT_STREAM] Fallback download cancelled by user for "${safeFileName}"`);
        return;
      }
      console.error('[USERBOT_STREAM] Fallback Local Bot API stream failed:', err.message);
      if (!res.headersSent) {
        return res.status(502).json({ success: false, message: 'Stream failed from Telegram source.' });
      }
      res.destroy();
      return;
    }
  }

  throw new Error('No valid Telegram MTProto document or file path available to stream.');
}
