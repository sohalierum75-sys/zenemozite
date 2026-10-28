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
import { parseTelegramFileMetadata, parseTelegramFiles } from './telegramParser.js';

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
            const caption = msg.message || '';
            const meta = parseTelegramFileMetadata({
              file_id: String(msg.id),
              file_name: docName,
              caption,
              fileSize: Number(doc.size || 0),
            });
            console.log(`[USERBOT] Resolved MTProto document "${docName}" (${doc.size} bytes, quality: ${meta.quality}, size: ${meta.size}) from msg ${messageId}`);
            return {
              document: doc,
              fileSize: Number(doc.size || 0),
              mimeType: doc.mimeType || 'video/mp4',
              fileName: docName,
              messageId: msg.id,
              quality: meta.quality,
              size: meta.size,
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
            const caption = msg.message || '';
            const meta = parseTelegramFileMetadata({
              file_id: String(msg.id),
              file_name: docName,
              caption,
              fileSize: Number(doc.size || 0),
            });
            console.log(`[USERBOT] Found document "${docName}" via channel search (msg ${msg.id}, quality: ${meta.quality}, size: ${meta.size})`);
            return {
              document: doc,
              fileSize: Number(doc.size || 0),
              mimeType: doc.mimeType || 'video/mp4',
              fileName: docName,
              messageId: msg.id,
              quality: meta.quality,
              size: meta.size,
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
      const meta = parseTelegramFileMetadata({
        file_id: String(fileId),
        file_name: info.filePath ? path.basename(info.filePath) : `${title || 'download'}.mp4`,
        fileSize: info.fileSize,
      });
      console.log(`[USERBOT] Resolved Bot API file_path: ${info.filePath} (${info.fileSize ? formatBytes(info.fileSize) : 'unknown size'}, quality: ${meta.quality})`);
      return {
        document: null,
        localFilePath: info.filePath,
        fileSize: info.fileSize,
        mimeType: 'video/mp4',
        fileName: `${title || 'download'}.mp4`,
        quality: meta.quality,
        size: meta.size,
      };
    } catch (err) {
      console.warn(`[USERBOT] Local Bot API getFileInfo failed for ${fileId}:`, err.message);
    }
  }

  return null;
}

/**
 * Fetch and parse all Telegram files for a movie title from the Telegram channel.
 * Parses file_name and caption with Regex to extract quality (1080p, 720p, 480p) and file size.
 *
 * @param {string} title - Movie title to search in Telegram channel
 * @returns {Promise<Array<{ file_id: string, quality: string, size: string }>>}
 */
export async function fetchTelegramFilesForMovie(title) {
  if (!title) return [];
  const client = await getUserbotClient();
  const chatId = config.telegram.chatId;

  if (!client || !chatId || !config.telegram.stringSession) {
    return [];
  }

  try {
    const cleanTitle = title.replace(/[^\w\s]/g, ' ').trim().slice(0, 30);
    console.log(`[USERBOT] Scanning Telegram channel files for "${cleanTitle}"...`);
    const foundFiles = [];

    for await (const msg of client.iterMessages(chatId, { search: cleanTitle, limit: 30 })) {
      if (msg.media && (msg.media.document || msg.media)) {
        const doc = msg.media.document || msg.media;
        let docName = `${title}.mp4`;
        if (Array.isArray(doc.attributes)) {
          const fileNameAttr = doc.attributes.find((a) => a.fileName || a.className === 'DocumentAttributeFilename');
          if (fileNameAttr?.fileName) docName = fileNameAttr.fileName;
        }

        const caption = msg.message || '';
        const parsed = parseTelegramFileMetadata({
          file_id: String(msg.id),
          file_name: docName,
          caption,
          fileSize: Number(doc.size || 0),
        });

        if (parsed && parsed.file_id) {
          foundFiles.push(parsed);
        }
      }
    }

    const normalized = parseTelegramFiles(foundFiles);
    console.log(`[USERBOT] Found ${normalized.length} Telegram file(s) for "${title}":`, normalized);
    return normalized;
  } catch (err) {
    console.warn(`[USERBOT] Error fetching Telegram files for "${title}":`, err.message);
    return [];
  }
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

  // Set permissive CORS headers on download stream
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
          return res.status(500).json({ success: false, message: `Telegram download failed: ${streamErr.message}` });
        }
        res.end();
        return;
      } finally {
        req.removeListener('close', onReqClose);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Direct HTTP Stream Piping (Pass-through from Local Telegram API)
  // ---------------------------------------------------------------------------
  if (localFilePath) {
    // Check if the file is already available directly on local disk
    let diskPath = null;
    try {
      diskPath = resolveLocalDiskPath(localFilePath);
    } catch {
      diskPath = null;
    }

    if (diskPath && fs.existsSync(diskPath)) {
      try {
        const stat = fs.statSync(diskPath);
        const actualSize = stat.size;
        let start = 0;
        let end = actualSize - 1;
        let statusCode = 200;

        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const rawStart = parseInt(parts[0], 10);
          const rawEnd = parts[1] ? parseInt(parts[1], 10) : actualSize - 1;
          start = !isNaN(rawStart) ? Math.max(0, rawStart) : 0;
          end = !isNaN(rawEnd) ? Math.min(rawEnd, actualSize - 1) : actualSize - 1;

          if (start >= actualSize || start > end) {
            res.status(416).setHeader('Content-Range', `bytes */${actualSize}`);
            return res.end();
          }

          statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${actualSize}`);
        }

        const contentLength = end - start + 1;
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(contentLength));
        res.setHeader('Accept-Ranges', 'bytes');
        res.status(statusCode);

        const readStream = fs.createReadStream(diskPath, { start, end });
        await pipeline(readStream, res);
        return;
      } catch (diskErr) {
        if (diskErr.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
        console.error('[LOCAL_DISK_STREAM] Failed to stream from local disk:', diskErr.message);
        if (!res.headersSent) {
          return res.status(500).json({ success: false, message: `Failed to stream file from disk: ${diskErr.message}` });
        }
        res.end();
        return;
      }
    }

    const streamUrl = `${config.telegram.localApiUrl}/file/bot${config.telegram.botToken}/${localFilePath}`;
    const headers = {};
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    try {
      console.log(`[PASS_THROUGH_STREAM] Piping direct from Telegram API URL: ${streamUrl}`);
      const response = await axios.get(streamUrl, {
        headers,
        responseType: 'stream',
        timeout: 15000,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      // Force direct download headers
      res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      } else if (fileSize) {
        res.setHeader('Content-Length', String(fileSize));
      }
      if (response.headers['content-range']) {
        res.setHeader('Content-Range', response.headers['content-range']);
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.status(response.status || 200);

      // Handle client cancellation / disconnect
      let clientClosed = false;
      const onClientClose = () => {
        clientClosed = true;
        if (response.data && response.data.destroy) {
          response.data.destroy();
        }
      };
      req.once('close', onClientClose);

      // Zero-Storage cleanup: if Local Bot API cached a copy in tg-api-data, purge it
      const cleanupDisk = () => {
        setTimeout(() => {
          try {
            const diskPath = resolveLocalDiskPath(localFilePath);
            if (diskPath && fs.existsSync(diskPath)) {
              fs.unlinkSync(diskPath);
              console.log(`[ZERO_STORAGE] Purged cached file from local volume: "${diskPath}"`);
            }
          } catch (e) {
            // ignore
          }
        }, 1500);
      };

      res.once('finish', cleanupDisk);
      req.once('close', cleanupDisk);

      // Directly pipe Telegram HTTP stream into Express response
      try {
        await pipeline(response.data, res);
        console.log(`[PASS_THROUGH_STREAM] Completed streaming "${safeFileName}" to client`);
        return;
      } catch (pipeErr) {
        if (clientClosed || pipeErr.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          console.log(`[PASS_THROUGH_STREAM] Client closed download for "${safeFileName}"`);
          return;
        }
        throw pipeErr;
      } finally {
        req.removeListener('close', onClientClose);
      }
    } catch (err) {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
        console.log(`[PASS_THROUGH_STREAM] Download cancelled by user for "${safeFileName}"`);
        return;
      }
      console.error('[PASS_THROUGH_STREAM] Direct HTTP stream piping failed:', err.message);
      if (!res.headersSent) {
        const isNotFound = err.response?.status === 404;
        const isConnRefused = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT';
        const statusCode = isNotFound ? 404 : (isConnRefused ? 503 : 500);
        return res.status(statusCode).json({
          success: false,
          message: isNotFound
            ? 'The requested file was not found on Telegram Local API server or has not finished downloading yet (404).'
            : (isConnRefused
                ? 'Telegram Local API server is unreachable. Please verify the storage service.'
                : `Telegram stream error: ${err.message}`),
        });
      }
      res.end();
      return;
    }
  }

  if (!res.headersSent) {
    return res.status(404).json({
      success: false,
      message: 'No valid Telegram MTProto document or file path available to stream (404).',
    });
  }
  res.end();
}

/**
 * Zero-Download Media Forwarding
 * Uses Telegram's cloud servers to forward or copy media directly from a source channel
 * to our target Telegram channel.
 *
 * NEVER downloads media files to VPS disk or RAM.
 *
 * @param {object} params
 * @param {string|number} params.sourceChannelId
 * @param {number} params.messageId
 * @returns {Promise<{ success: boolean, targetMessageId?: number, targetFileId?: string, document?: any, reason?: string }>}
 */
export async function forwardMediaToTargetChannel({ sourceChannelId, messageId }) {
  const targetChatId = config.telegram.chatId;
  if (!targetChatId) {
    return { success: false, reason: 'TELEGRAM_CHAT_ID is not configured' };
  }

  // 1. Try GramJS Userbot client first (if stringSession is available)
  try {
    const client = await getUserbotClient();
    if (client && config.telegram.stringSession) {
      console.log(`[USERBOT_FORWARD] Cloud-forwarding msg #${messageId} from ${sourceChannelId} to ${targetChatId}...`);
      const result = await client.forwardMessages(targetChatId, {
        messages: [Number(messageId)],
        fromPeer: sourceChannelId,
      });

      const forwardedMsg = Array.isArray(result) ? result[0] : result;
      if (forwardedMsg?.id) {
        const doc = forwardedMsg.media?.document || forwardedMsg.media;
        const fileId = doc?.id ? String(doc.id) : String(forwardedMsg.id);
        console.log(`[USERBOT_FORWARD] Successfully forwarded via MTProto. Target msg #${forwardedMsg.id}`);
        return {
          success: true,
          targetMessageId: forwardedMsg.id,
          targetFileId: fileId,
          document: doc,
        };
      }
    }
  } catch (mtprotoErr) {
    console.warn(`[USERBOT_FORWARD] MTProto forwardMessages notice: ${mtprotoErr.message}. Falling back to Bot API...`);
  }

  // 2. Cloud forward via Telegram Bot API (cloud-to-cloud execution, zero VPS storage)
  const apiBaseUrl = `${config.telegram.localApiUrl}/bot${config.telegram.botToken}`;
  try {
    console.log(`[BOT_FORWARD] Cloud-forwarding msg #${messageId} from ${sourceChannelId} to ${targetChatId}...`);
    const fwdRes = await axios.post(`${apiBaseUrl}/forwardMessage`, {
      chat_id: targetChatId,
      from_chat_id: sourceChannelId,
      message_id: Number(messageId),
    }, { timeout: 15000 });

    if (fwdRes.data?.ok && fwdRes.data.result) {
      const msg = fwdRes.data.result;
      const doc = msg.document || msg.video || msg.audio;
      console.log(`[BOT_FORWARD] Successfully forwarded via Bot API. Target msg #${msg.message_id}, fileId: ${doc?.file_id || 'N/A'}`);
      return {
        success: true,
        targetMessageId: msg.message_id,
        targetFileId: doc?.file_id || null,
        document: doc,
      };
    }
  } catch (fwdErr) {
    console.warn(`[BOT_FORWARD] forwardMessage notice: ${fwdErr.message}. Falling back to copyMessage...`);
    try {
      const res = await axios.post(`${apiBaseUrl}/copyMessage`, {
        chat_id: targetChatId,
        from_chat_id: sourceChannelId,
        message_id: Number(messageId),
      }, { timeout: 15000 });

      if (res.data?.ok && res.data.result?.message_id) {
        console.log(`[BOT_COPY] Successfully copied via Bot API. Target msg #${res.data.result.message_id}`);
        return {
          success: true,
          targetMessageId: res.data.result.message_id,
          targetFileId: null,
        };
      }
    } catch (copyErr) {
      console.warn(`[BOT_COPY] copyMessage notice: ${copyErr.message}`);
    }
  }

  return { success: false, reason: 'Cloud forward could not be completed' };
}

