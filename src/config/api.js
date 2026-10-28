/**
 * Public-facing API Configuration
 *
 * Ensures all API calls and download links use relative paths (/api) or
 * the configured public URL (NEXT_PUBLIC_API_URL / VITE_API_BASE_URL).
 * NEVER hardcodes or falls back to 'localhost' in client code, preventing
 * "Site wasn't available" network errors on remote clients.
 */

export const getApiBaseUrl = () => {
  const envUrl =
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.NEXT_PUBLIC_API_URL ||
    import.meta.env.VITE_PUBLIC_API_URL;

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    // Strictly reject internal Docker container names, localhost, or private daemon ports
    const isInternal =
      trimmed.includes('localhost') ||
      trimmed.includes('127.0.0.1') ||
      trimmed.includes('telegram-api') ||
      trimmed.includes('zenemozite') ||
      trimmed.includes(':8081') ||
      trimmed.includes(':5000');

    if (!isInternal && (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/'))) {
      return trimmed;
    }
  }

  // Default to relative /api which works universally in all browsers on any domain or port
  return '/api';
};

export const API_BASE_URL = getApiBaseUrl();

/**
 * Builds a public-facing direct download URL for a file
 * @param {string} fileId - Telegram file_id or message ID
 * @param {string} title - Optional movie title for naming
 * @returns {string} Relative public download URL (e.g. /api/download/123?title=...)
 */
export const buildDownloadUrl = (fileId, title = '') => {
  const base = getApiBaseUrl();
  const safeTitle = (title || 'movie').trim();
  const query = safeTitle ? `?title=${encodeURIComponent(safeTitle)}` : '';
  return `${base}/download/${encodeURIComponent(fileId)}${query}`;
};
