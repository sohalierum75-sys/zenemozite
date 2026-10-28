// ==============================================================================
// Telegram Metadata Parser
// Automatically extracts video quality (1080p, 720p, 480p, 4K) and file size
// from Telegram file_name and message caption using Regex.
// ==============================================================================

/**
 * Format bytes into clean human-readable size string (e.g. "1.5GB", "800MB").
 * @param {number} bytes
 * @returns {string|null}
 */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return null;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    const formatted = gb.toFixed(1).replace(/\.0$/, '');
    return `${formatted}GB`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    const formatted = mb.toFixed(0);
    return `${formatted}MB`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(0)}KB`;
}

/**
 * Parse file size string or number into standardized format (e.g. "1.5GB", "800MB").
 * Checks text using Regex for patterns like "1.5GB", "800MB", "Size: 1.2 GB", "[700MB]".
 *
 * @param {string} [text] - Text to inspect (filename or caption)
 * @param {number} [byteSize] - Exact numeric byte size if available
 * @returns {string|null}
 */
export function extractSize(text = '', byteSize = null) {
  // 1. If explicit byte size is provided, format directly
  if (typeof byteSize === 'number' && byteSize > 0) {
    return formatBytes(byteSize);
  }

  if (!text || typeof text !== 'string') return null;

  // 2. Regex to detect size representations in filename or caption
  // Matches: "1.5GB", "1.5 GB", "800MB", "800 MB", "2.1GiB", "750MiB", "Size: 1.4 GB"
  const sizeRegex = /(?:size\s*:?\s*)?(\d+(?:\.\d+)?)\s*(GB|MB|GiB|MiB|KB|KiB)\b/i;
  const match = text.match(sizeRegex);
  if (match) {
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase().replace('GIB', 'GB').replace('MIB', 'MB').replace('KIB', 'KB');
    return `${num}${unit}`;
  }

  return null;
}

/**
 * Detect video quality from text (file_name, caption) using Regex.
 * Extracts standard resolutions: "1080p", "720p", "480p", "4K", "360p".
 *
 * @param {string} [text] - file_name, caption, or combined metadata
 * @returns {string|null} - e.g. "1080p", "720p", "480p", "4K", etc.
 */
export function extractQuality(text = '') {
  if (!text || typeof text !== 'string') return null;

  // 1. 4K / 2160p / UHD
  if (/(?:^|\b|_|\W)(?:2160p?|4k|uhd)(?:$|\b|_|\W)/i.test(text)) {
    return '4K';
  }

  // 2. Standard "1080p", "720p", "480p", "360p" tags
  const standardMatch = text.match(/(?:^|\b|_|\W)(1080p|720p|480p|360p)(?:$|\b|_|\W)/i);
  if (standardMatch) {
    return standardMatch[1].toLowerCase();
  }

  // 3. Resolution dimension syntax: 1920x1080, 1280x720, 854x480, 640x480, 3840x2160
  if (/1920\s*[x×]\s*1080/i.test(text)) return '1080p';
  if (/1280\s*[x×]\s*720/i.test(text)) return '720p';
  if (/(?:854|640)\s*[x×]\s*480/i.test(text)) return '480p';
  if (/3840\s*[x×]\s*2160/i.test(text)) return '4K';

  // 4. Standalone resolution numbers: 1080, 720, 480, 360
  // Note: ensure not a random year (e.g. 1999, 2024)
  const standaloneMatch = text.match(/(?:^|\b|_|\W)(1080|720|480|360)(?:$|\b|_|\W)/i);
  if (standaloneMatch) {
    return `${standaloneMatch[1]}p`;
  }

  // 5. HD / FHD / SD keyword cues
  if (/(?:^|\b|_|\W)(?:fhd|full[\s._-]?hd)(?:$|\b|_|\W)/i.test(text)) return '1080p';
  if (/(?:^|\b|_|\W)(?:hd)(?:$|\b|_|\W)/i.test(text)) return '720p';
  if (/(?:^|\b|_|\W)(?:sd)(?:$|\b|_|\W)/i.test(text)) return '480p';

  return null;
}

/**
 * Quality sorting priority score (higher is higher quality)
 */
const QUALITY_PRIORITY = {
  '4K': 5,
  '2160p': 5,
  '1080p': 4,
  '720p': 3,
  '480p': 2,
  '360p': 1
};

/**
 * Parse an individual Telegram file / message metadata into a normalized object:
 * { file_id: "...", quality: "1080p", size: "1.5GB" }
 *
 * @param {object} item
 * @param {string} [item.file_id] - Telegram file_id or message_id
 * @param {string} [item.fileId]
 * @param {string} [item.file_name] - Original Telegram file name
 * @param {string} [item.fileName]
 * @param {string} [item.caption] - Telegram message caption
 * @param {string} [item.text]
 * @param {number|string} [item.size] - File size in bytes or formatted string
 * @param {number} [item.fileSize]
 * @param {string} [item.quality] - Existing quality tag if already known
 * @returns {{ file_id: string, quality: string, size: string }}
 */
export function parseTelegramFileMetadata(item = {}) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const fileId = String(item.file_id || item.fileId || item.id || '').trim();
  const fileName = String(item.file_name || item.fileName || '').trim();
  const caption = String(item.caption || item.text || '').trim();
  const numericBytes = typeof item.fileSize === 'number'
    ? item.fileSize
    : (typeof item.size === 'number' ? item.size : null);

  const combinedText = `${fileName} ${caption}`.trim();

  // 1. Detect quality:
  // Use explicit quality property if given (e.g. "1080p"), else run regex on filename then caption
  let quality = null;
  if (item.quality && typeof item.quality === 'string' && /^(4k|2160p|1080p|720p|480p|360p)$/i.test(item.quality.trim())) {
    quality = item.quality.trim();
    if (quality.toLowerCase() === '4k') quality = '4K';
    else quality = quality.toLowerCase();
  } else {
    quality = extractQuality(fileName) || extractQuality(caption) || extractQuality(combinedText) || '1080p';
  }

  // 2. Detect size:
  // If item.size is already a string like "1.5GB", format it, otherwise parse from bytes or text regex
  let size = null;
  if (typeof item.size === 'string' && /^\d+(?:\.\d+)?\s*(?:GB|MB|KB)$/i.test(item.size.trim())) {
    size = item.size.trim().toUpperCase();
  } else {
    size = extractSize(combinedText, numericBytes);
  }

  if (!size && numericBytes) {
    size = formatBytes(numericBytes);
  }

  return {
    file_id: fileId,
    quality: quality || '1080p',
    size: size || 'Unknown'
  };
}

/**
 * Parse an array or JSON string of Telegram files into normalized:
 * [{ file_id: "...", quality: "1080p", size: "1.5GB" }, ...]
 *
 * @param {Array|string} input - Array of file objects or JSON string
 * @returns {Array<{ file_id: string, quality: string, size: string }>}
 */
export function parseTelegramFiles(input) {
  if (!input) return [];

  let rawList = input;
  if (typeof input === 'string') {
    try {
      rawList = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(rawList)) {
    if (rawList && typeof rawList === 'object') {
      rawList = [rawList];
    } else {
      return [];
    }
  }

  const results = [];
  const seenFileIds = new Set();

  for (const item of rawList) {
    if (!item) continue;
    const parsed = parseTelegramFileMetadata(item);
    if (parsed && parsed.file_id && !seenFileIds.has(parsed.file_id)) {
      seenFileIds.add(parsed.file_id);
      results.push(parsed);
    }
  }

  // Sort descending by quality priority: 4K -> 1080p -> 720p -> 480p -> 360p
  results.sort((a, b) => {
    const prioA = QUALITY_PRIORITY[a.quality] || 0;
    const prioB = QUALITY_PRIORITY[b.quality] || 0;
    return prioB - prioA;
  });

  return results;
}

export default {
  extractQuality,
  extractSize,
  formatBytes,
  parseTelegramFileMetadata,
  parseTelegramFiles
};
