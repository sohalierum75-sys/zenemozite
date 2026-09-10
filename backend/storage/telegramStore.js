// ==============================================================================
// Telegram Invisible CDN — Local Bot API client
// Uploads (whole files or chunk streams) to a private channel and reads them
// back as streams for the sequential download pipeline. Users never see
// Telegram — all URLs point at our own backend.
// ==============================================================================
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { config } from './config.js';

const apiBase = () => `${config.telegram.localApiUrl}/bot${config.telegram.botToken}`;

function assertConfigured() {
  if (!config.telegram.configured) {
    throw Object.assign(
      new Error('Telegram storage is not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).'),
      { statusCode: 503 }
    );
  }
}

// The only data ever buffered in RAM during an upload: the API's JSON reply
// (a few KB). Anything bigger is aborted instead of buffered.
const MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * POST a multipart form to the Local Bot API via form.submit() (raw Node
 * http request). The response is consumed in small chunks with a hard 1MB
 * cap and released immediately — the ONLY data this helper ever holds in RAM.
 */
function submitForm(form) {
  return new Promise((resolve, reject) => {
    form.submit(`${apiBase()}/sendDocument`, (err, response) => {
      if (err) return reject(err);
      const chunks = [];
      let size = 0;
      response.on('data', (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy();
          reject(new Error('Telegram API response exceeded 1MB — aborted (refusing to buffer)'));
          return;
        }
        chunks.push(c);
      });
      response.once('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        chunks.length = 0; // release the response buffers immediately
        resolve({ statusCode: response.statusCode, body });
      });
      response.once('error', reject);
    });
  });
}

/**
 * Upload any Readable stream as a document to the private channel.
 * This is the core upload — whole-file uploads and byte-range chunk uploads
 * both go through here.
 *
 * STREAMING GUARANTEE: uses form.submit() (raw Node http request with the
 * form as the body). The ReadStream flows straight into the socket in
 * highWaterMark-sized pieces and is NEVER accumulated into a RAM buffer.
 * The stream is destroyed in `finally`, so file handles and buffers are
 * released even when the upload fails.
 *
 * @param {import('stream').Readable} stream
 * @param {{ fileName?: string, caption?: string, knownLength?: number }} opts
 * @returns {{ fileId: string, messageId: number, fileSize: number }}
 */
export async function uploadStream(stream, { fileName, caption, knownLength } = {}) {
  assertConfigured();

  const form = new FormData();
  form.append('chat_id', config.telegram.chatId);
  if (caption) form.append('caption', String(caption).slice(0, 1024));
  // knownLength = exact byte count of the (ranged) ReadStream. form-data
  // otherwise stats stream.path (full file size, ignoring `end`) and would
  // send a WRONG Content-Length for middle chunks; passing it explicitly is
  // both correct and lets the socket avoid any length-probing of the stream.
  form.append('document', stream, {
    filename: fileName || 'file.bin',
    ...(Number.isFinite(knownLength) && knownLength > 0 ? { knownLength } : {}),
  });

  let statusCode = null;
  let body = '';
  try {
    // form.submit() pipes the ReadStream straight into the HTTP socket —
    // the file body is NEVER accumulated in RAM. Backpressure is handled by
    // the pipe: if the socket is slow, the fs.ReadStream is paused and its
    // buffers stay capped at highWaterMark.
    ({ statusCode, body } = await submitForm(form));
  } finally {
    // ALWAYS release the file handle + any buffered window, even on failure —
    // a leaked paused stream holds its highWaterMark buffer in RAM forever.
    if (stream && typeof stream.destroy === 'function' && !stream.destroyed) {
      stream.destroy();
    }
  }

  if (statusCode >= 400) {
    throw new Error(`Telegram sendDocument HTTP ${statusCode}: ${String(body).slice(0, 300)}`);
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Telegram sendDocument returned non-JSON response: ${String(body).slice(0, 200)}`);
  }
  body = ''; // release the raw response text

  if (!json?.ok) {
    throw new Error(`Telegram sendDocument failed: ${json?.description || 'unknown error'}`);
  }

  const doc = json.result.document;
  console.log(`[TELEGRAM_CDN] Uploaded "${doc.file_name}" (${doc.file_size} bytes) -> file_id ${doc.file_id}`);
  return {
    fileId: doc.file_id,
    messageId: json.result.message_id,
    fileSize: doc.file_size,
  };
}

/**
 * TRUE zero-RAM upload: hands the file to the Local Bot API by file:// URI.
 * The Local Bot API server reads the file from ITS OWN disk, so no file
 * bytes ever cross this Node process (also immune to HTTP upload timeouts).
 *
 * Only possible when the file lives in TELEGRAM_SHARED_DIR — a Docker volume
 * mounted into BOTH the backend and the telegram-api containers. Falls back
 * to a streaming upload when the path is outside the shared dir or the
 * shortcut is rejected by the server.
 */
export async function uploadFileFromDisk(filePath, { fileName, caption } = {}) {
  assertConfigured();

  if (config.telegram.sharedDir && isInsideSharedDir(filePath)) {
    const form = new FormData();
    form.append('chat_id', config.telegram.chatId);
    if (caption) form.append('caption', String(caption).slice(0, 1024));
    // The whole "upload" is this tiny URI string — the API server does the
    // disk read itself.
    form.append('document', `file://${path.resolve(filePath)}`);
    try {
      const { statusCode, body } = await submitForm(form);
      if (statusCode >= 400) throw new Error(`HTTP ${statusCode}: ${String(body).slice(0, 200)}`);
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        throw new Error(`non-JSON response: ${String(body).slice(0, 200)}`);
      }
      if (!json?.ok) throw new Error(json?.description || 'unknown error');
      const doc = json.result.document;
      console.log(`[TELEGRAM_CDN] Uploaded via file:// (zero-RAM) "${doc.file_name}" (${doc.file_size} bytes) -> file_id ${doc.file_id}`);
      return { fileId: doc.file_id, messageId: json.result.message_id, fileSize: doc.file_size };
    } catch (err) {
      // Never let a misconfigured shared volume break the pipeline — retry
      // the same file through the (still low-RAM) streaming path.
      console.warn(`[TELEGRAM_CDN] file:// upload failed (${err && err.message}) — falling back to streaming upload`);
    }
  }

  return uploadStream(
    fs.createReadStream(filePath, { highWaterMark: config.telegram.uploadHighWaterMarkBytes }),
    { fileName: fileName || path.basename(filePath), caption }
  );
}

/** True when `p` lives inside the shared telegram-api volume (file:// usable). */
function isInsideSharedDir(p) {
  if (!config.telegram.sharedDir) return false;
  const rel = path.relative(path.resolve(config.telegram.sharedDir), path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Convenience: upload a file from disk (file:// when possible, else stream) */
export async function uploadFile(filePath, options = {}) {
  return uploadFileFromDisk(filePath, options);
}

/**
 * Step 1 of reading a file back: resolve the server-side file_path
 * that the Local Bot API uses to serve file content.
 */
export async function getFilePath(fileId) {
  const res = await axios.get(`${apiBase()}/getFile`, {
    params: { file_id: fileId },
    timeout: 15000,
  });
  if (!res.data?.ok || !res.data.result?.file_path) {
    throw new Error(`Telegram getFile failed: ${res.data?.description || 'no file_path returned'}`);
  }
  return res.data.result.file_path;
}

/**
 * Step 2 of reading a file back: open a Readable stream of the file content
 * from the Local Bot API's built-in file server.
 * @param {string} filePath — the value returned by getFilePath()
 * @returns {import('stream').Readable}
 */
export function openFileStream(filePath) {
  const url = `${config.telegram.localApiUrl}/file/bot${config.telegram.botToken}/${filePath}`;
  return axios
    .get(url, { responseType: 'stream', timeout: 0 })
    .then((res) => res.data);
}

/**
 * Convenience: resolve + open in one call (used for single-file reads).
 * For multi-chunk sequential streaming, use getFilePath + openFileStream
 * separately so all paths can be resolved in parallel before streaming starts.
 */
export async function getChunkStream(fileId) {
  const filePath = await getFilePath(fileId);
  return openFileStream(filePath);
}

export default { uploadFile, uploadFileFromDisk, uploadStream, getFilePath, openFileStream, getChunkStream };