// ==============================================================================
// Hybrid Storage Cache — configuration
// Telegram (Local Bot API) for files <= 2GB, Google Drive for files > 2GB.
// All values come from environment variables; everything degrades gracefully
// when a subsystem is not configured (routes respond 503 with a clear message).
// ==============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GIB = 1024 ** 3;

/**
 * Parse the Google Drive service accounts from the environment.
 * Supported sources (can be combined):
 *   - GDRIVE_CREDENTIALS_JSON: a JSON array of service-account key objects (or a single object)
 *   - GDRIVE_CREDENTIALS_DIR:  a folder containing *.json key files
 * Returns entries: { email, raw, parsed } where `raw` is what gets stored in the
 * DriveAccount.credentials column (stringified JSON, or the key-file path).
 */
function parseDriveAccounts() {
  const entries = [];

  const rawJson = (process.env.GDRIVE_CREDENTIALS_JSON || '').trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      list.forEach((creds) => {
        entries.push({ email: creds.client_email || null, raw: JSON.stringify(creds), parsed: creds });
      });
    } catch (err) {
      console.error('[HYBRID_CONFIG] GDRIVE_CREDENTIALS_JSON is not valid JSON:', err.message);
    }
  }

  const dir = (process.env.GDRIVE_CREDENTIALS_DIR || '').trim();
  if (dir) {
    const absDir = path.isAbsolute(dir) ? dir : path.resolve(__dirname, '..', dir);
    try {
      for (const file of fs.readdirSync(absDir).filter((f) => f.endsWith('.json'))) {
        const filePath = path.join(absDir, file);
        try {
          const creds = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          entries.push({ email: creds.client_email || null, raw: filePath, parsed: creds });
        } catch (err) {
          console.error(`[HYBRID_CONFIG] Skipping invalid key file ${file}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[HYBRID_CONFIG] Cannot read GDRIVE_CREDENTIALS_DIR:', err.message);
    }
  }

  return entries;
}

const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';

export const config = {
  telegram: {
    botToken: telegramToken,
    chatId: telegramChatId,
    localApiUrl: (process.env.TELEGRAM_LOCAL_API_URL || 'http://localhost:8081').replace(/\/+$/, ''),
    // Local Bot API supports up to 2GB uploads (cloud API bots are capped at 50MB)
    maxSizeBytes: Number(process.env.TELEGRAM_MAX_GB || 2) * GIB,
    get configured() {
      return Boolean(telegramToken && telegramChatId);
    },
  },
  gdrive: {
    entries: parseDriveAccounts(),
    folderId: process.env.GDRIVE_FOLDER_ID || null,
    defaultAccountBytes: Number(process.env.GDRIVE_ACCOUNT_LIMIT_GB || 15) * GIB,
    freeSpaceBufferBytes: Number(process.env.GDRIVE_FREE_BUFFER_MB || 100) * 1024 * 1024,
    get configured() {
      return this.entries.length > 0;
    },
  },
  lru: {
    maxEvictionsPerRequest: Number(process.env.LRU_MAX_EVICTIONS || 50),
    // Google's quota counters can lag a few seconds after a delete
    quotaSettleMs: Number(process.env.LRU_QUOTA_SETTLE_MS || 3000),
  },
};

/** Human-readable byte formatter for logs and API responses */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= GIB) return `${(value / GIB).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}

export default config;