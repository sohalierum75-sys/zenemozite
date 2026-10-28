import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import prisma from '../prisma/client.js';

const execAsync = promisify(exec);

const TMDB_API_KEY = process.env.TMDB_API_KEY || '8a68f9cbe2f314d0cdab27cc8d58216b';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/**
 * Common video codecs, formats, release tags, and audio terms to strip/detect
 */
const QUALITY_REGEX = /\b(2160p|4k|uhd|1080p|1080i|720p|720i|480p|480i|360p|576p)\b/i;
const CODEC_REGEX = /\b(x264|x265|h\.?264|h\.?265|hevc|avc|av1|xvid|divx|10bit|8bit)\b/i;
const SOURCE_REGEX = /\b(bluray|blu-ray|bdrip|brrip|web-?dl|web-?rip|web|hdtv|hdrip|dvdrip|telesync|camrip|hdcam)\b/i;
const AUDIO_LANG_REGEX = /\b(english|tamil|hindi|telugu|malayalam|kannada|sinhala|dual(?:\s*audio)?|multi(?:\s*audio)?)\b/i;
const SUBTITLE_REGEX = /\b(esubs?|msubs?|softsubs?|hardsubs?|subbed)\b/i;
const YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/;

/**
 * Format bytes to human readable format (e.g. 1.4 GB)
 */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return null;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1).replace(/\.0$/, '')} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

/**
 * Normalizes title for database indexing and comparison
 * e.g. "Spider-Man: No Way Home" -> "spiderman no way home"
 */
export function normalizeTitle(title = '') {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/[''""`]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract clean metadata from a filename and optional caption text
 * e.g. "Inception.2010.1080p.BluRay.x264.English-ESub.mkv"
 *
 * @param {string} rawFileName - The filename or document name
 * @param {string} [caption] - Optional message caption from Telegram
 * @param {number} [fileSize] - File size in bytes
 * @returns {object} Extracted metadata
 */
export function extractMetadataFromText(rawFileName = '', caption = '', fileSize = null) {
  const fileName = String(rawFileName || '').trim();
  const captionText = String(caption || '').trim();
  const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();

  // Strip file extension from filename for inspection
  const baseName = fileName ? path.basename(fileName, path.extname(fileName)) : '';
  const combined = `${baseName} ${captionText}`.trim();

  // 1. Resolution / Quality detection
  let quality = null;
  const qualityMatch = combined.match(QUALITY_REGEX);
  if (qualityMatch) {
    const rawQ = qualityMatch[1].toLowerCase();
    if (rawQ === '2160p' || rawQ === '4k' || rawQ === 'uhd') {
      quality = '4K';
    } else if (rawQ === '1080p' || rawQ === '1080i') {
      quality = '1080p';
    } else if (rawQ === '720p' || rawQ === '720i') {
      quality = '720p';
    } else if (rawQ === '480p' || rawQ === '480i' || rawQ === '576p' || rawQ === '360p') {
      quality = '480p';
    }
  }

  // Dimension fallback (e.g. 1920x1080)
  if (!quality) {
    if (/1920\s*[x×]\s*1080/i.test(combined)) quality = '1080p';
    else if (/1280\s*[x×]\s*720/i.test(combined)) quality = '720p';
    else if (/(?:854|640)\s*[x×]\s*480/i.test(combined)) quality = '480p';
    else if (/3840\s*[x×]\s*2160/i.test(combined)) quality = '4K';
    else if (/fhd|full[\s._-]?hd/i.test(combined)) quality = '1080p';
    else if (/\bhd\b/i.test(combined)) quality = '720p';
    else if (/\bsd\b/i.test(combined)) quality = '480p';
  }

  // 2. Year detection
  let year = null;
  const yearMatch = combined.match(YEAR_REGEX);
  if (yearMatch) {
    const parsedYear = parseInt(yearMatch[1], 10);
    const currentYear = new Date().getFullYear();
    if (parsedYear >= 1920 && parsedYear <= currentYear + 3) {
      year = String(parsedYear);
    }
  }

  // 3. Codec detection
  let codec = null;
  const codecMatch = combined.match(CODEC_REGEX);
  if (codecMatch) {
    codec = codecMatch[1].toLowerCase().replace('.', '');
    if (codec === 'x264' || codec === 'h264' || codec === 'avc') codec = 'H.264';
    if (codec === 'x265' || codec === 'h265' || codec === 'hevc') codec = 'HEVC';
    if (codec === 'av1') codec = 'AV1';
  }

  // 4. Audio language detection
  let audioLanguage = null;
  if (/dual(?:\s*audio)?/i.test(combined)) {
    audioLanguage = 'Dual Audio';
  } else if (/multi(?:\s*audio)?/i.test(combined)) {
    audioLanguage = 'Multi Audio';
  } else {
    const audioMatch = combined.match(AUDIO_LANG_REGEX);
    if (audioMatch) {
      const rawAudio = audioMatch[1].toLowerCase();
      audioLanguage = rawAudio.charAt(0).toUpperCase() + rawAudio.slice(1);
    }
  }

  // 5. Subtitle detection
  let subtitleInfo = null;
  const subMatch = combined.match(SUBTITLE_REGEX);
  if (subMatch) {
    subtitleInfo = subMatch[1].toUpperCase();
  }

  // 6. Clean Title extraction
  // Split baseName by separators (. , _ - [ ] ( ))
  let titleCandidate = baseName
    .replace(/[._]/g, ' ')
    .replace(/\[.*?\]|\(.*?\)/g, ' '); // remove contents inside brackets

  // Cut off everything from the year or quality tag onwards
  const cutOffTokens = [
    ...(year ? [year] : []),
    '2160p', '4k', 'uhd', '1080p', '1080i', '720p', '720i', '480p', '360p',
    'bluray', 'blu-ray', 'bdrip', 'brrip', 'web-dl', 'webrip', 'web', 'hdtv', 'hdrip', 'dvdrip',
    'x264', 'x265', 'hevc', 'h264', 'h265', '10bit', 'aac', 'dd5.1', 'dts', 'atmos'
  ];

  const lowerTitle = titleCandidate.toLowerCase();
  let firstCutIndex = titleCandidate.length;

  for (const token of cutOffTokens) {
    const idx = lowerTitle.search(new RegExp(`\\b${token}\\b`, 'i'));
    if (idx !== -1 && idx > 0 && idx < firstCutIndex) {
      firstCutIndex = idx;
    }
  }

  titleCandidate = titleCandidate.slice(0, firstCutIndex).trim();
  // Remove leading/trailing non-alphanumeric (like hyphens, colons)
  titleCandidate = titleCandidate.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').trim();

  // If title became empty, fall back to caption line 1 or baseName
  if (!titleCandidate && captionText) {
    const firstLine = captionText.split('\n')[0].replace(/[._]/g, ' ').trim();
    titleCandidate = firstLine.slice(0, 80);
  }
  if (!titleCandidate) {
    titleCandidate = baseName || 'Untitled Movie';
  }

  return {
    rawFileName: fileName,
    title: titleCandidate,
    normalizedTitle: normalizeTitle(titleCandidate),
    year: year || null,
    quality: quality || '1080p',
    codec: codec || null,
    audioLanguage: audioLanguage || null,
    subtitleInfo: subtitleInfo || null,
    fileType: ext || 'mp4',
    fileSizeBytes: fileSize ? Number(fileSize) : null,
    fileSizeFormatted: fileSize ? formatBytes(fileSize) : null,
  };
}

/**
 * Uses FFprobe to inspect video stream resolution & codec directly from disk
 * Verifies that 1080p is truly 1080p, etc.
 *
 * @param {string} localFilePath - Path to file on VPS/server
 * @returns {Promise<{ verified: boolean, width: number, height: number, quality: string, codec: string }>}
 */
export async function verifyResolutionWithFFprobe(localFilePath) {
  if (!localFilePath || typeof localFilePath !== 'string') {
    return { verified: false, quality: null };
  }

  // Ensure file exists
  if (!fs.existsSync(localFilePath)) {
    return { verified: false, quality: null };
  }

  try {
    const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -of json "${localFilePath.replace(/"/g, '\\"')}"`;
    const { stdout } = await execAsync(command, { timeout: 15000 });
    const parsed = JSON.parse(stdout);
    const videoStream = parsed?.streams?.[0];

    if (!videoStream || !videoStream.width || !videoStream.height) {
      return { verified: false, quality: null };
    }

    const width = parseInt(videoStream.width, 10);
    const height = parseInt(videoStream.height, 10);
    const codec = videoStream.codec_name ? String(videoStream.codec_name).toUpperCase() : null;

    let detectedQuality = '480p';
    if (height >= 1440 || width >= 3000) {
      detectedQuality = '4K';
    } else if (height >= 900 || width >= 1800) {
      detectedQuality = '1080p';
    } else if (height >= 600 || width >= 1200) {
      detectedQuality = '720p';
    } else {
      detectedQuality = '480p';
    }

    return {
      verified: true,
      width,
      height,
      quality: detectedQuality,
      codec,
    };
  } catch (err) {
    // ffprobe might not be installed in all dev environments or file is partially downloaded
    console.warn(`[FFPROBE] Resolution verification skipped for "${localFilePath}":`, err.message);
    return { verified: false, quality: null };
  }
}

/**
 * Searches TMDB for rich movie metadata by title and release year
 *
 * @param {string} title
 * @param {string|number} [year]
 * @returns {Promise<object|null>} TMDB movie details
 */
export async function searchTMDBMovie(title, year = null) {
  if (!title) return null;

  try {
    const params = {
      api_key: TMDB_API_KEY,
      query: title,
      include_adult: false,
    };
    if (year) {
      params.year = parseInt(year, 10);
      params.primary_release_year = parseInt(year, 10);
    }

    const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
      params,
      timeout: 8000,
    });

    const results = response.data?.results;
    if (Array.isArray(results) && results.length > 0) {
      // Pick the first/best match
      const movie = results[0];
      return {
        tmdbId: movie.id,
        title: movie.title || movie.original_title,
        overview: movie.overview,
        posterPath: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        backdropPath: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
        releaseDate: movie.release_date ? movie.release_date.slice(0, 4) : (year ? String(year) : null),
        voteAverage: movie.vote_average || 0,
        popularity: movie.popularity || 0,
        genreIds: Array.isArray(movie.genre_ids) ? JSON.stringify(movie.genre_ids) : '[]',
      };
    }
  } catch (err) {
    console.warn(`[TMDB_SEARCH] Failed searching TMDB for "${title}" (${year}):`, err.message);
  }

  return null;
}

/**
 * Match a detected movie against existing database records deterministically.
 * Prevents duplicate movie pages when 720p and 1080p versions arrive separately.
 *
 * @param {object} parsedMeta - Metadata from extractMetadataFromText
 * @param {object} [tmdbMeta] - Optional metadata from searchTMDBMovie
 * @returns {Promise<{ movie: object|null, isExisting: boolean, confidence: string }>}
 */
export async function matchExistingMovie(parsedMeta, tmdbMeta = null) {
  const normTitle = parsedMeta.normalizedTitle;
  const year = parsedMeta.year;
  const tmdbId = tmdbMeta?.tmdbId || null;

  // 1. Try matching by TMDB ID (Highest confidence: 100%)
  if (tmdbId) {
    const existingByTmdb = await prisma.movie.findUnique({
      where: { tmdbId: parseInt(tmdbId, 10) },
      include: { variants: true },
    });
    if (existingByTmdb) {
      return { movie: existingByTmdb, isExisting: true, confidence: 'exact_tmdb' };
    }
  }

  // 2. Try matching by normalizedTitle and year
  if (normTitle) {
    const candidates = await prisma.movie.findMany({
      where: {
        OR: [
          { normalizedTitle: normTitle },
          { title: { contains: parsedMeta.title } },
        ],
      },
      include: { variants: true },
      take: 5,
    });

    if (candidates.length > 0) {
      // Find exact year match first
      if (year) {
        const exactYearMatch = candidates.find(
          (m) => m.releaseDate && m.releaseDate.includes(String(year))
        );
        if (exactYearMatch) {
          return { movie: exactYearMatch, isExisting: true, confidence: 'title_and_year' };
        }
      }

      // If only 1 candidate found with high title match
      if (candidates.length === 1) {
        return { movie: candidates[0], isExisting: true, confidence: 'single_title_match' };
      }
    }
  }

  // No confident existing match found
  return { movie: null, isExisting: false, confidence: 'new' };
}

export default {
  extractMetadataFromText,
  verifyResolutionWithFFprobe,
  searchTMDBMovie,
  matchExistingMovie,
  normalizeTitle,
  formatBytes,
};
