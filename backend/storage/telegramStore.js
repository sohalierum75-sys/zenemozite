// ==============================================================================
// Hybrid Storage Cache — Telegram route (files <= 2GB)
// Uploads stream to a private channel through the LOCAL Telegram Bot API
// (https://github.com/tdlib/telegram-bot-api), which is what lifts the 50MB
// cloud-bot limit to 2GB. Telegram retention is unlimited -> no cleanup here.
// ==============================================================================
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { config } from './config.js';

const apiBase = () => `${config.telegram.localApiUrl}/bot${config.telegram.botToken}`;

/**
 * Stream a file from disk into the private Telegram channel as a document.
 * @returns {{ fileId: string, messageId: number, fileSize: number }}
 */
export async function uploadFile(filePath, { title, fileName } = {}) {
  if (!config.telegram.configured) {
    throw Object.assign(
      new Error('Telegram storage is not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).'),
      { statusCode: 503 }
    );
  }

  const form = new FormData();
  form.append('chat_id', config.telegram.chatId);
  if (title) form.append('caption', String(title).slice(0, 1024));
  form.append('document', fs.createReadStream(filePath), {
    filename: fileName || path.basename(filePath),
  });

  const res = await axios.post(`${apiBase()}/sendDocument`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity, // large uploads
    maxContentLength: Infinity,
    timeout: 0,
  });

  if (!res.data?.ok) {
    throw new Error(`Telegram sendDocument failed: ${res.data?.description || 'unknown error'}`);
  }

  const doc = res.data.result.document;
  console.log(`[HYBRID_TG] Uploaded "${doc.file_name}" (${doc.file_size} bytes) -> file_id ${doc.file_id}`);
  return {
    fileId: doc.file_id,
    messageId: res.data.result.message_id,
    fileSize: doc.file_size,
  };
}

/**
 * Generate a direct download link for a previously uploaded file.
 * The Local Bot API exposes stored files at /file/bot<token>/<file_path>.
 */
export async function getDirectLink(fileId) {
  const res = await axios.get(`${apiBase()}/getFile`, {
    params: { file_id: fileId },
    timeout: 15000,
  });

  if (!res.data?.ok || !res.data.result?.file_path) {
    throw new Error(`Telegram getFile failed: ${res.data?.description || 'no file_path returned'}`);
  }

  return `${config.telegram.localApiUrl}/file/bot${config.telegram.botToken}/${res.data.result.file_path}`;
}

export default { uploadFile, getDirectLink };