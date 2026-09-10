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
    // LOW-RAM SAFETY: default 0.5GB (was 1.9GB). Smaller byte-range chunks
    // keep upload buffers and HTTP multipart overhead small, preventing OOM
    // crashes (Error 521) on 1-2GB VPSes. Hard-clamped to 2GB no matter what
    // the env says, because the Local Bot API rejects anything larger.
    chunkSizeBytes: Math.min(Number(process.env.TELEGRAM_CHUNK_GB || 0.5), 2) * GIB,
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