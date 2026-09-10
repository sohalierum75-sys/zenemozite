// ==============================================================================
// Telegram Invisible CDN — configuration
// Files are split into chunks (<= ~1.9GB) and uploaded to a private Telegram
// channel via the Local Bot API. All values come from environment variables;
// routes degrade gracefully (503) when Telegram is not configured.
// ==============================================================================
const GIB = 1024 ** 3;

const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';

export const config = {
  telegram: {
    botToken: telegramToken,
    chatId: telegramChatId,
    localApiUrl: (process.env.TELEGRAM_LOCAL_API_URL || 'http://telegram-api:8081').replace(/\/+$/, ''),
    // Hard per-upload limit: the Local Bot API accepts up to 2GB
    maxSizeBytes: Number(process.env.TELEGRAM_MAX_GB || 2) * GIB,
    // Target chunk size for splitting large files (must be < maxSizeBytes).
    // STRICT LIMIT: hard-clamped to 1GB — Telegram's Local API rejects
    // ~2GB single parts with "Bad Request: FILE_PARTS_INVALID", and huge
    // parts caused OOM crashes on the VPS. 0.5GB default; the clamp makes
    // even a stale TELEGRAM_CHUNK_GB=1.9 in an old .env safe.
    chunkSizeBytes: Math.min(Number(process.env.TELEGRAM_CHUNK_GB || 0.5), 1) * GIB,
    // RAM cap for the multipart upload reader: the fs.ReadStream holds at
    // most this much in memory at any instant while streaming to Telegram.
    // 4MB is plenty for throughput; the file itself NEVER enters RAM.
    uploadHighWaterMarkBytes: Math.round(
      Math.min(Math.max(Number(process.env.TELEGRAM_HWM_MB || 4), 0.25), 16) * 1024 * 1024
    ),
    // Shared directory mounted into BOTH this container and the telegram-api
    // container (see docker-compose `telegram-shared` volume). When set,
    // uploads use the Local Bot API's file:// shortcut: the API server reads
    // the file from ITS OWN disk, so zero file bytes flow through this Node
    // process and HTTP upload timeouts disappear.
    sharedDir: (process.env.TELEGRAM_SHARED_DIR || '').trim(),
    get configured() {
      return Boolean(telegramToken && telegramChatId);
    },
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