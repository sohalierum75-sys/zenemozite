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

/**
 * Upload any Readable stream as a document to the private channel.
 * This is the core upload — whole-file uploads and byte-range chunk uploads
 * both go through here.
 * @returns {{ fileId: string, messageId: number, fileSize: number }}
 */
export async function uploadStream(stream, { fileName, caption } = {}) {
  assertConfigured();

  const form = new FormData();
  form.append('chat_id', config.telegram.chatId);
  if (caption) form.append('caption', String(caption).slice(0, 1024));
  form.append('document', stream, { filename: fileName || 'file.bin' });

  const res = await axios.post(`${apiBase()}/sendDocument`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 0,
  });

  if (!res.data?.ok) {
    throw new Error(`Telegram sendDocument failed: ${res.data?.description || 'unknown error'}`);
  }

  const doc = res.data.result.document;
  console.log(`[TELEGRAM_CDN] Uploaded "${doc.file_name}" (${doc.file_size} bytes) -> file_id ${doc.file_id}`);
  return {
    fileId: doc.file_id,
    messageId: res.data.result.message_id,
    fileSize: doc.file_size,
  };
}

/** Convenience: upload a file from disk */
export async function uploadFile(filePath, options = {}) {
  return uploadStream(fs.createReadStream(filePath), {
    fileName: options.fileName || path.basename(filePath),
    caption: options.caption,
  });
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

export default { uploadFile, uploadStream, getFilePath, openFileStream, getChunkStream };