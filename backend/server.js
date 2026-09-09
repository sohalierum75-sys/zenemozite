import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import TorrentSearchApi from 'torrent-search-api';
import hybridCacheRoutes, { downloadRouter } from './storage/routes.js';
import { fetchAndCacheMovies, createTMDBListFetcher } from './listCache.js';
import { startWorker } from './storage/worker.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Torrent Search API with multiple providers
const enabledProviders = [];

// Enable TorrentGalaxy (great for Indian/regional content)
try {
  TorrentSearchApi.enableProvider('TorrentGalaxy');
  enabledProviders.push('TorrentGalaxy');
} catch (e) {
  console.log('[TORRENT_SEARCH] TorrentGalaxy not available:', e.message);
}

// Enable 1337x (reliable general tracker)
try {
  TorrentSearchApi.enableProvider('1337x');
  enabledProviders.push('1337x');
} catch (e) {
  console.log('[TORRENT_SEARCH] 1337x not available:', e.message);
}

// Enable ThePirateBay (fallback)
try {
  TorrentSearchApi.enableProvider('ThePirateBay');
  enabledProviders.push('ThePirateBay');
} catch (e) {
  console.log('[TORRENT_SEARCH] ThePirateBay not available:', e.message);
}

console.log(`[MULTI_SOURCE] Enabled scraper providers: ${enabledProviders.join(', ')}`);

// Initialize Prisma Client for persistent database storage
const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

// Graceful Prisma shutdown
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Disconnecting Prisma...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] Disconnecting Prisma...');
  await prisma.$disconnect();
  process.exit(0);
});

// DUAL IN-MEMORY CACHE SYSTEM
// Separate caches for movies/lists and torrents to prevent Apibay rate limiting
const movieCache = new Map();
const torrentCache = new Map();

// Cache TTL Configuration (milliseconds)
const CACHE_TTL = {
  SINGLE_MOVIE_WITH_TORRENTS: 24 * 60 * 60 * 1000,  // 24 hours
  SINGLE_MOVIE_NO_TORRENTS: 5 * 60 * 1000,           // 5 minutes (retry soon)
  MOVIE_LIST: 6 * 60 * 60 * 1000,                    // 6 hours
  TV_SHOWS_LIST: 6 * 60 * 60 * 1000,                 // 6 hours
  TORRENT_FOUND: 24 * 60 * 60 * 1000,                // 24 hours (stable)
  TORRENT_NOT_FOUND: 2 * 60 * 60 * 1000              // 2 hours (retry later)
};

// Cache Statistics
let cacheStats = {
  hits: 0,
  misses: 0,
  torrentHits: 0,
  torrentMisses: 0,
  apibayRequestsSaved: 0,
  lastReset: new Date().toISOString()
};

/**
 * Get from movie cache if not expired
 */
function getFromMovieCache(key) {
  const cached = movieCache.get(key);
  if (!cached) {
    cacheStats.misses++;
    return null;
  }
  
  const now = Date.now();
  if (now > cached.expiresAt) {
    movieCache.delete(key);
    console.log(`[MOVIE_CACHE] Expired: ${key}`);
    cacheStats.misses++;
    return null;
  }
  
  const ttlRemaining = Math.round((cached.expiresAt - now) / 1000);
  console.log(`[MOVIE_CACHE] HIT: ${key} (TTL: ${ttlRemaining}s)`);
  cacheStats.hits++;
  
  return cached.data;
}

/**
 * Get from torrent cache if not expired
 * This prevents repeated Apibay requests for the same movie
 */
function getFromTorrentCache(title, year) {
  const cacheKey = `${title}_${year}`.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const cached = torrentCache.get(cacheKey);
  
  if (!cached) {
    cacheStats.torrentMisses++;
    return null;
  }
  
  const now = Date.now();
  if (now > cached.expiresAt) {
    torrentCache.delete(cacheKey);
    console.log(`[TORRENT_CACHE] Expired: ${title} (${year})`);
    cacheStats.torrentMisses++;
    return null;
  }
  
  const ttlRemaining = Math.round((cached.expiresAt - now) / 1000);
  console.log(`[TORRENT_CACHE] HIT: ${title} (${year}) - ${cached.data.length} torrents (TTL: ${ttlRemaining}s)`);
  cacheStats.torrentHits++;
  cacheStats.apibayRequestsSaved++;
  
  return cached.data;
}

/**
 * Set movie cache with smart TTL
 */
function setMovieCache(key, data, customTTL = null) {
  let ttl = customTTL;
  
  // Smart TTL based on content type
  if (!customTTL) {
    if (key.startsWith('movie_')) {
      const hasTorrents = data?.data?.torrents && data.data.torrents.length > 0;
      ttl = hasTorrents ? CACHE_TTL.SINGLE_MOVIE_WITH_TORRENTS : CACHE_TTL.SINGLE_MOVIE_NO_TORRENTS;
      console.log(`[MOVIE_CACHE] SET: ${key} - ${hasTorrents ? '24h' : '5min'} TTL`);
    } else if (key.startsWith('movies_') || key.startsWith('tamil_')) {
      ttl = CACHE_TTL.MOVIE_LIST;
      console.log(`[MOVIE_CACHE] SET: ${key} - 6h TTL (list)`);
    } else if (key.startsWith('tv_')) {
      ttl = CACHE_TTL.TV_SHOWS_LIST;
      console.log(`[MOVIE_CACHE] SET: ${key} - 6h TTL (TV list)`);
    } else {
      ttl = CACHE_TTL.MOVIE_LIST;
    }
  }
  
  movieCache.set(key, {
    data: data,
    expiresAt: Date.now() + ttl,
    cachedAt: new Date().toISOString()
  });
}

/**
 * Set torrent cache - prevents duplicate Apibay requests
 * This is the KEY function that prevents rate limiting
 */
function setTorrentCache(title, year, torrents) {
  const cacheKey = `${title}_${year}`.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const hasTorrents = torrents && torrents.length > 0;
  const ttl = hasTorrents ? CACHE_TTL.TORRENT_FOUND : CACHE_TTL.TORRENT_NOT_FOUND;
  
  torrentCache.set(cacheKey, {
    data: torrents,
    expiresAt: Date.now() + ttl,
    cachedAt: new Date().toISOString()
  });
  
  const ttlHours = Math.round(ttl / (60 * 60 * 1000));
  console.log(`[TORRENT_CACHE] SET: ${title} (${year}) - ${torrents.length} torrents - ${ttlHours}h TTL`);
}

/**
 * Clear all caches
 */
function clearAllCaches() {
  const movieSize = movieCache.size;
  const torrentSize = torrentCache.size;
  
  movieCache.clear();
  torrentCache.clear();
  
  console.log(`[CACHE] Cleared ${movieSize} movie entries and ${torrentSize} torrent entries`);
  
  // Reset stats
  cacheStats = {
    hits: 0,
    misses: 0,
    torrentHits: 0,
    torrentMisses: 0,
    apibayRequestsSaved: 0,
    lastReset: new Date().toISOString()
  };
  
  return { movieSize, torrentSize };
}

/**
 * Clear only expired entries (memory optimization)
 */
function clearExpiredCaches() {
  const now = Date.now();
  let movieExpired = 0;
  let torrentExpired = 0;
  
  // Clean movie cache
  for (const [key, value] of movieCache.entries()) {
    if (now > value.expiresAt) {
      movieCache.delete(key);
      movieExpired++;
    }
  }
  
  // Clean torrent cache
  for (const [key, value] of torrentCache.entries()) {
    if (now > value.expiresAt) {
      torrentCache.delete(key);
      torrentExpired++;
    }
  }
  
  console.log(`[CACHE] Cleanup: Removed ${movieExpired} expired movies, ${torrentExpired} expired torrents`);
  return { movieExpired, torrentExpired };
}

/**
 * Get comprehensive cache statistics
 */
function getCacheStats() {
  const now = Date.now();
  const movieEntries = [];
  const torrentEntries = [];
  
  // Movie cache entries
  movieCache.forEach((value, key) => {
    const ttlRemaining = Math.round((value.expiresAt - now) / 1000);
    movieEntries.push({
      key: key,
      cachedAt: value.cachedAt,
      ttlRemaining: ttlRemaining > 0 ? `${ttlRemaining}s` : 'expired',
      size: JSON.stringify(value.data).length
    });
  });
  
  // Torrent cache entries
  torrentCache.forEach((value, key) => {
    const ttlRemaining = Math.round((value.expiresAt - now) / 1000);
    torrentEntries.push({
      key: key,
      torrents: value.data.length,
      cachedAt: value.cachedAt,
      ttlRemaining: ttlRemaining > 0 ? `${ttlRemaining}s` : 'expired'
    });
  });
  
  const hitRate = cacheStats.hits + cacheStats.misses > 0 
    ? ((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(2) + '%'
    : '0%';
  
  const torrentHitRate = cacheStats.torrentHits + cacheStats.torrentMisses > 0
    ? ((cacheStats.torrentHits / (cacheStats.torrentHits + cacheStats.torrentMisses)) * 100).toFixed(2) + '%'
    : '0%';
  
  return {
    movieCache: {
      totalEntries: movieCache.size,
      entries: movieEntries
    },
    torrentCache: {
      totalEntries: torrentCache.size,
      entries: torrentEntries
    },
    performance: {
      movieCacheHitRate: hitRate,
      torrentCacheHitRate: torrentHitRate,
      apibayRequestsSaved: cacheStats.apibayRequestsSaved,
      totalHits: cacheStats.hits,
      totalMisses: cacheStats.misses,
      torrentHits: cacheStats.torrentHits,
      torrentMisses: cacheStats.torrentMisses,
      statsStartedAt: cacheStats.lastReset
    }
  };
}

// Automatic cache cleanup every 30 minutes
setInterval(() => {
  console.log('\n[CACHE] Running automatic cleanup...');
  clearExpiredCaches();
}, 30 * 60 * 1000);

// Legacy compatibility functions
function getFromCache(key) {
  return getFromMovieCache(key);
}

function setCache(key, data, customTTL = null) {
  setMovieCache(key, data, customTTL);
}

function clearCache() {
  const result = clearAllCaches();
  return result.movieSize + result.torrentSize;
}

// TMDB Configuration
const TMDB_API_KEY = '8a68f9cbe2f314d0cdab27cc8d58216b';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/original';

// YTS API Configuration (Primary source for Movies)
const YTS_BASE_URL = 'https://yts.mx/api/v2';

// YTS circuit breaker: when yts.mx is unreachable (DNS failure, timeout, etc.)
// skip it entirely for this window so requests fall back to Multi-Tracker /
// Apibay IMMEDIATELY instead of waiting for another 10s timeout per request.
const YTS_RETRY_AFTER_MS = 5 * 60 * 1000; // retry YTS every 5 minutes
let ytsUnavailableUntil = 0;

// Network/DNS error codes that mean "the host itself is unreachable"
const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED',
  'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPROTO',
]);

function isYtsUnavailable() {
  return Date.now() < ytsUnavailableUntil;
}

function markYtsUnavailable(error) {
  const code = error?.code || 'UNKNOWN';
  if (NETWORK_ERROR_CODES.has(code)) {
    ytsUnavailableUntil = Date.now() + YTS_RETRY_AFTER_MS;
    console.error(`[YTS ERROR] yts.mx unreachable (${code}) — skipping YTS and relying solely on Multi-Tracker / Apibay for the next ${YTS_RETRY_AFTER_MS / 60000} minutes`);
  }
}

// EZTV API Configuration (Primary source for TV Shows)
const EZTV_BASE_URL = 'https://eztvx.to/api';

// Apibay (The Pirate Bay) Configuration (Fallback)
const APIBAY_BASE_URL = 'https://apibay.org';

// Middleware
app.use(cors());
app.use(express.json());

// Hybrid Storage Cache — Telegram (<= 2GB) / Google Drive (> 2GB) + LRU cleanup
app.use('/api/hybrid-cache', hybridCacheRoutes);
// Direct download endpoint for the frontend DownloadButton (GET /api/download/:movieId)
app.use('/api/download', downloadRouter);

// Serve static files from React app in production
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Mock Movies - Only used if TMDB completely fails
const MOCK_MOVIES = [
  {
    id: 1,
    imdb_id: 'tt0111161',
    title: 'The Shawshank Redemption',
    year: 1994,
    rating: 9.3,
    runtime: 142,
    poster: 'https://m.media-amazon.com/images/M/MV5BNDE3ODcxYzMtY2YzZC00NmNlLWJiNDMtZDViZWM2MzIxZDYwXkEyXkFqcGdeQXVyNjAwNDUxODI@._V1_SX300.jpg',
    backdrop: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=1920&h=1080&fit=crop',
    plot: 'Two imprisoned men bond over a number of years, finding solace and eventual redemption through acts of common decency.',
    genres: ['Drama', 'Crime'],
    yt_trailer_code: 'NmzuHjWmXOc',
    torrents: []
  },
  {
    id: 2,
    imdb_id: 'tt0068646',
    title: 'The Godfather',
    year: 1972,
    rating: 9.2,
    runtime: 175,
    poster: 'https://m.media-amazon.com/images/M/MV5BM2MyNjYxNmUtYTAwNi00MTYxLWJmNWYtYzZlODY3ZTk3OTFlXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_SX300.jpg',
    backdrop: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&h=1080&fit=crop',
    plot: 'The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son.',
    genres: ['Crime', 'Drama'],
    yt_trailer_code: 'UaVTIH8mujA',
    torrents: []
  },
  {
    id: 3,
    imdb_id: 'tt0468569',
    title: 'The Dark Knight',
    year: 2008,
    rating: 9.0,
    runtime: 152,
    poster: 'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_SX300.jpg',
    backdrop: 'https://images.unsplash.com/photo-1509347528160-9a9e33742cdb?w=1920&h=1080&fit=crop',
    plot: 'When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests.',
    genres: ['Action', 'Crime', 'Drama'],
    yt_trailer_code: 'EXeTwQWrcwY',
    torrents: []
  }
];

/**
 * Fetch movies from TMDB by language
 */
async function fetchMoviesFromTMDB(language = 'en', page = 1) {
  try {
    const languageName = language === 'ta|ml' ? 'Tamil & Malayalam' : language === 'ta' ? 'Tamil' : 'English';
    console.log(`[TMDB] Fetching ${languageName} movies (page ${page})...`);
    
    const response = await axios.get(`${TMDB_BASE_URL}/discover/movie`, {
      params: {
        api_key: TMDB_API_KEY,
        with_original_language: language,
        sort_by: language === 'en' ? 'popularity.desc' : 'release_date.desc',
        page: page,
        'vote_count.gte': 50,
        'vote_average.gte': 6
      },
      timeout: 15000
    });

    if (response.data && response.data.results) {
      console.log(`[TMDB] Successfully found ${response.data.results.length} movies`);
      return response.data.results;
    }

    console.log('[TMDB] Invalid response structure');
    return [];
  } catch (error) {
    console.error(`[TMDB ERROR] Failed to fetch ${language} movies:`, error.message);
    console.error('[TMDB ERROR] Response:', error.response?.data || 'No response data');
    return [];
  }
}

/**
 * Get IMDb ID and additional details from TMDB movie ID
 */
async function getMovieDetails(tmdbId) {
  try {
    const [externalIds, details, videos] = await Promise.allSettled([
      axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}/external_ids`, {
        params: { api_key: TMDB_API_KEY },
        timeout: 5000
      }),
      axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
        params: { api_key: TMDB_API_KEY },
        timeout: 5000
      }),
      axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}/videos`, {
        params: { api_key: TMDB_API_KEY },
        timeout: 5000
      })
    ]);

    const imdbId = externalIds.status === 'fulfilled' ? externalIds.value.data?.imdb_id : '';
    const runtime = details.status === 'fulfilled' ? details.value.data?.runtime : null;
    
    let trailerCode = '';
    if (videos.status === 'fulfilled' && videos.value.data?.results) {
      const trailer = videos.value.data.results.find(
        v => v.type === 'Trailer' && v.site === 'YouTube'
      );
      trailerCode = trailer?.key || '';
    }

    return { imdbId, runtime, trailerCode };
  } catch (error) {
    console.log(`[TMDB] Failed to get details for movie ${tmdbId}:`, error.message);
    return { imdbId: '', runtime: null, trailerCode: '' };
  }
}

/**
 * Extract quality from torrent name using regex
 */
function extractQuality(name) {
  const qualityMatch = name.match(/(2160p|4k|uhd|1080p|720p|480p|cam)/i);
  if (qualityMatch) {
    const quality = qualityMatch[1].toLowerCase();
    if (quality === '4k' || quality === 'uhd') return '2160p';
    if (quality === 'cam') return 'CAM';
    return quality;
  }
  return 'Unknown';
}

/**
 * Convert bytes to human-readable size
 */
function formatFileSize(bytes) {
  const gb = bytes / 1073741824;
  const mb = bytes / 1048576;
  
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  } else {
    return `${mb.toFixed(2)} MB`;
  }
}

/**
 * Clean title for Apibay search queries
 * Removes special characters that cause search failures
 */
function cleanTitleForSearch(title) {
  if (!title) return '';
  
  return title
    .replace(/'/g, '')                    // Remove apostrophes: "Marvel's" -> "Marvels"
    .replace(/:/g, ' ')                   // Replace colons: "Avengers: Endgame" -> "Avengers Endgame"
    .replace(/-/g, ' ')                   // Replace hyphens: "Spider-Man" -> "Spider Man"
    .replace(/&/g, 'and')                 // Replace ampersands: "Fast & Furious" -> "Fast and Furious"
    .replace(/[^\w\s]/g, ' ')             // Remove remaining special characters
    .replace(/\s+/g, ' ')                 // Replace multiple spaces with single space
    .trim();                              // Remove leading/trailing spaces
}

/**
 * Advanced TV title sanitization for Apibay searches
 * Specifically designed for TV show episode and season pack queries
 */
function sanitizeTvTitle(title) {
  if (!title) return '';
  
  return title
    .replace(/\s*\(\d{4}\)\s*/g, ' ')     // Remove years in parentheses: "Show (2024)" -> "Show"
    .replace(/'/g, '')                     // Remove apostrophes: "Grey's Anatomy" -> "Greys Anatomy"
    .replace(/:/g, ' ')                    // Replace colons: "Show: Subtitle" -> "Show Subtitle"
    .replace(/-/g, ' ')                    // Replace hyphens: "Spider-Man" -> "Spider Man"
    .replace(/&/g, 'and')                  // Replace ampersands: "Fast & Furious" -> "Fast and Furious"
    .replace(/[^\w\s]/g, ' ')              // Remove remaining special characters
    .replace(/\s+/g, ' ')                  // Replace multiple spaces with single space
    .trim();                               // Remove leading/trailing spaces
}

/**
 * Search YTS API for movie torrents (PRIMARY SOURCE FOR MOVIES)
 * Returns high-quality movie torrents with proper metadata
 */
async function searchMovieTorrentsYTS(movieTitle, year, imdbId = null) {
  // Circuit breaker: if yts.mx recently failed at the network level, skip it
  // immediately (no 10s timeout wait) and let the caller use its fallbacks.
  if (isYtsUnavailable()) {
    console.log(`[YTS] Skipped (unreachable in recent attempts, circuit breaker active) — using Multi-Tracker / Apibay for "${movieTitle}"`);
    return [];
  }

  try {
    const cleanedTitle = cleanTitleForSearch(movieTitle);
    console.log(`[YTS] Searching for movie: "${cleanedTitle}" (${year})`);
    
    const params = {
      limit: 1,
      quality: 'All',
      sort_by: 'seeds'
    };
    
    // Prefer IMDb ID for accurate results
    if (imdbId && imdbId.startsWith('tt')) {
      params.query_term = imdbId;
      console.log(`[YTS] Using IMDb ID: ${imdbId}`);
    } else if (year) {
      params.query_term = `${cleanedTitle} ${year}`;
    } else {
      params.query_term = cleanedTitle;
    }
    
    const response = await axios.get(`${YTS_BASE_URL}/list_movies.json`, {
      params: params,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.data?.data?.movies || response.data.data.movies.length === 0) {
      console.log(`[YTS] No movies found for: ${movieTitle}`);
      return [];
    }
    
    const movie = response.data.data.movies[0];
    
    if (!movie.torrents || movie.torrents.length === 0) {
      console.log(`[YTS] No torrents found for: ${movie.title}`);
      return [];
    }
    
    // Map YTS torrents to standardized format
    const torrents = movie.torrents
      .filter(t => t.hash && t.url)
      .map(torrent => {
        // Construct magnet link from hash
        const magnetLink = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title_long)}&tr=udp://open.demonii.com:1337/announce&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.coppersurfer.tk:6969&tr=udp://glotorrents.pw:6969/announce&tr=udp://tracker.opentrackr.org:1337/announce`;
        
        return {
          url: magnetLink,
          quality: torrent.quality || 'Unknown',
          size: torrent.size || 'Unknown',
          type: 'magnet',
          seeders: parseInt(torrent.seeds) || 0,
          leechers: parseInt(torrent.peers) || 0,
          name: `${movie.title} (${movie.year}) [${torrent.quality}]`,
          provider: 'YTS'
        };
      })
      .filter(t => t.seeders > 0)
      .sort((a, b) => b.seeders - a.seeders);
    
    if (torrents.length > 0) {
      console.log(`[YTS] Found ${torrents.length} torrents for "${movie.title}" (${movie.year})`);
      torrents.forEach((t, i) => {
        console.log(`  ${i + 1}. [YTS] ${t.quality} - ${t.size} - ${t.seeders} seeders`);
      });
    }
    
    return torrents;
  } catch (error) {
    // DNS/network-level failures (getaddrinfo ENOTFOUND, timeouts, ...) must
    // NEVER propagate as unhandled exceptions — log them, trip the circuit
    // breaker so subsequent requests skip YTS instantly, and return [] so the
    // unified search falls straight through to Multi-Tracker / Apibay.
    if (error?.code && NETWORK_ERROR_CODES.has(error.code)) {
      markYtsUnavailable(error);
    } else {
      console.error(`[YTS ERROR] Failed to search "${movieTitle}":`, error.message);
    }
    return [];
  }
}

/**
 * Search EZTV API for TV show torrents (PRIMARY SOURCE FOR TV SHOWS)
 * Returns episode-specific torrents and season packs
 */
async function searchTVShowTorrentsEZTV(showTitle, season = null, episode = null, imdbId = null) {
  try {
    const cleanedTitle = sanitizeTvTitle(showTitle);
    console.log(`[EZTV] Searching for TV show: "${cleanedTitle}" S${season}${episode ? `E${episode}` : ''}`);
    
    const params = {
      limit: 100,
      page: 0
    };
    
    // Prefer IMDb ID for accurate results
    if (imdbId && /^\d+$/.test(imdbId.replace('tt', ''))) {
      params.imdb_id = imdbId.replace('tt', '');
      console.log(`[EZTV] Using IMDb ID: ${imdbId}`);
    }
    
    const response = await axios.get(`${EZTV_BASE_URL}/get-torrents`, {
      params: params,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.data?.torrents || response.data.torrents.length === 0) {
      console.log(`[EZTV] No torrents found for: ${showTitle}`);
      return [];
    }
    
    let torrents = response.data.torrents;
    
    // Filter by show title if IMDb ID not provided
    if (!imdbId) {
      torrents = torrents.filter(t => {
        const torrentTitle = (t.title || '').toLowerCase();
        const searchTitle = cleanedTitle.toLowerCase();
        return torrentTitle.includes(searchTitle);
      });
    }
    
    // Filter by season and episode if specified
    if (season !== null) {
      const seasonStr = `s${String(season).padStart(2, '0')}`;
      torrents = torrents.filter(t => {
        const title = (t.title || '').toLowerCase();
        return title.includes(seasonStr);
      });
      
      if (episode !== null) {
        const episodeStr = `e${String(episode).padStart(2, '0')}`;
        torrents = torrents.filter(t => {
          const title = (t.title || '').toLowerCase();
          return title.includes(episodeStr);
        });
      }
    }
    
    // Map EZTV torrents to standardized format
    const mappedTorrents = torrents
      .filter(t => t.hash && t.magnet_url)
      .slice(0, 5)
      .map(torrent => {
        // Extract quality from title
        const quality = extractQuality(torrent.title);
        
        // Parse size
        let size = 'Unknown';
        if (torrent.size_bytes) {
          size = formatFileSize(parseInt(torrent.size_bytes));
        }
        
        return {
          url: torrent.magnet_url,
          quality: quality,
          size: size,
          type: 'magnet',
          seeders: parseInt(torrent.seeds) || 0,
          leechers: parseInt(torrent.peers) || 0,
          name: torrent.title,
          provider: 'EZTV'
        };
      })
      .filter(t => t.seeders > 0)
      .sort((a, b) => b.seeders - a.seeders);
    
    if (mappedTorrents.length > 0) {
      console.log(`[EZTV] Found ${mappedTorrents.length} torrents for "${showTitle}"`);
      mappedTorrents.forEach((t, i) => {
        console.log(`  ${i + 1}. [EZTV] ${t.quality} - ${t.size} - ${t.seeders} seeders`);
      });
    }
    
    return mappedTorrents;
  } catch (error) {
    console.error(`[EZTV ERROR] Failed to search "${showTitle}":`, error.message);
    return [];
  }
}

/**
 * Multi-Tracker Scraper Fallback using torrent-search-api
 * Uses TorrentGalaxy, 1337x, ThePirateBay as fallback sources
 */
async function searchMultiTrackerFallback(title, year = '', category = 'Video', limit = 5) {
  const cleanedTitle = cleanTitleForSearch(title);
  const searchQuery = year ? `${cleanedTitle} ${year}` : cleanedTitle;
  
  console.log(`[MULTI_TRACKER] Fallback search: "${searchQuery}"`);
  
  try {
    // Search across all enabled providers using static method
    const results = await TorrentSearchApi.search(searchQuery, category, limit);
    
    if (!results || results.length === 0) {
      console.log(`[MULTI_TRACKER] No results found`);
      return [];
    }
    
    console.log(`[MULTI_TRACKER] Found ${results.length} results from aggregated sources`);
    
    // Get magnet links for each result
    const torrentsWithMagnets = await Promise.all(
      results.map(async (result, index) => {
        try {
          // Add delay to prevent rate limiting
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Use static method to get magnet link
          const magnetLink = await TorrentSearchApi.getMagnet(result);
          
          if (!magnetLink) {
            return null;
          }
          
          // Parse seeders and leechers
          const seeders = parseInt(result.seeds) || parseInt(result.seeders) || 0;
          const leechers = parseInt(result.peers) || parseInt(result.leechers) || 0;
          
          // Filter out dead torrents
          if (seeders === 0) {
            return null;
          }
          
          // Extract quality from title
          const quality = extractQuality(result.title);
          
          // Parse size
          let size = result.size || 'Unknown';
          if (typeof size === 'number') {
            size = formatFileSize(size);
          }
          
          return {
            url: magnetLink,
            quality: quality,
            size: size,
            type: 'magnet',
            seeders: seeders,
            leechers: leechers,
            name: result.title,
            provider: result.provider || 'Multi-Tracker'
          };
        } catch (magnetError) {
          console.error(`[MULTI_TRACKER] Failed to get magnet for result:`, magnetError.message);
          return null;
        }
      })
    );
    
    // Filter out nulls and dead torrents, then sort by seeders
    const validTorrents = torrentsWithMagnets
      .filter(Boolean)
      .filter(t => t.seeders > 0)
      .sort((a, b) => b.seeders - a.seeders)
      .slice(0, 4);
    
    if (validTorrents.length > 0) {
      console.log(`[MULTI_TRACKER] Returning ${validTorrents.length} active torrents (sorted by seeders)`);
      validTorrents.forEach((t, i) => {
        console.log(`  ${i + 1}. [${t.provider}] ${t.quality} - ${t.size} - ${t.seeders} seeders`);
      });
      return validTorrents;
    } else {
      console.log(`[MULTI_TRACKER] All results had 0 seeders`);
      return [];
    }
    
  } catch (error) {
    console.error(`[MULTI_TRACKER] Search failed:`, error.message);
    return [];
  }
}
/**
 * ============================================================================
 * AUTOMATED REPORT & FIX BROKEN LINK SYSTEM
 * ============================================================================
 * When a user reports a broken download link:
 *   1. Searches MULTIPLE torrent providers SIMULTANEOUSLY (1337x, ThePirateBay,
 *      TorrentGalaxy*, KickassTorrents, Limetorrents, TorrentProject) via
 *      torrent-search-api   (* when available on the installed version)
 *   2. Aggregates every result and picks the one with the HIGHEST seeders
 *   3. Saves the new magnet link into the Prisma database (MediaCache)
 *   4. Invalidates the in-memory caches so the fix is served instantly
 * NOTE: No torrent/video files are ever saved on the VPS - magnet links only.
 * ============================================================================
 */

// Extra providers used only by the broken-link recovery search
const REPORT_EXTRA_PROVIDERS = ['KickassTorrents', 'Limetorrents', 'TorrentProject'];

// Each provider uses its own category vocabulary
const REPORT_PROVIDER_CATEGORIES = {
  ThePirateBay: { movie: 'Video', tv: 'Video' },
  '1337x': { movie: 'Movies', tv: 'TV' },
  TorrentGalaxy: { movie: 'Movies', tv: 'TV' },
  KickassTorrents: { movie: 'Movies', tv: 'TV' },
  Limetorrents: { movie: 'Movies', tv: 'TV' },
  TorrentProject: { movie: 'All', tv: 'All' }
};

/**
 * Make sure every report provider is active before searching.
 * Returns the active list + the providers we enabled ourselves (they are
 * restored afterwards so the rest of the app keeps its original config).
 */
function activateReportProviders() {
  const active = [];
  const newlyEnabled = [];

  for (const provider of [...enabledProviders, ...REPORT_EXTRA_PROVIDERS]) {
    try {
      if (!TorrentSearchApi.isProviderActive(provider)) {
        TorrentSearchApi.enableProvider(provider);
        newlyEnabled.push(provider);
      }
      active.push(provider);
    } catch (e) {
      console.log(`[BROKEN_LINK_FIX] Provider "${provider}" unavailable: ${e.message}`);
    }
  }

  console.log(`[BROKEN_LINK_FIX] Providers to search simultaneously: ${active.join(', ')}`);
  return { active, newlyEnabled };
}

/**
 * Restore the provider configuration that existed before the report search
 */
function restoreReportProviders(newlyEnabled) {
  for (const provider of newlyEnabled || []) {
    try {
      TorrentSearchApi.disableProvider(provider);
    } catch (e) {
      /* ignore */
    }
  }
}

/**
 * Invalidate the in-memory caches for a title so the fixed magnet
 * is served on the very next request (no stale 24h cache)
 */
function invalidateCachesForMedia(title, tmdbId) {
  try {
    if (tmdbId) {
      movieCache.delete(`movie_${tmdbId}`);
    }
    const baseSlug = String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
    for (const key of Array.from(torrentCache.keys())) {
      if (key.startsWith(baseSlug)) {
        torrentCache.delete(key);
      }
    }
    console.log(`[BROKEN_LINK_FIX] In-memory caches invalidated for "${title}"`);
  } catch (e) {
    console.log(`[BROKEN_LINK_FIX] Cache invalidation warning: ${e.message}`);
  }
}

/**
 * Persist the replacement torrent in the database (Prisma MediaCache).
 * The new magnet is placed at the TOP of the torrent list.
 */
async function persistReplacementTorrent({ movieId, title, year, imdbId, mediaType, torrent }) {
  // STEP 1: Locate the cached record - by TMDB id, then IMDb id, then title
  let record = null;

  if (movieId) {
    record = await prisma.mediaCache.findUnique({ where: { tmdbId: String(movieId) } });
  }
  if (!record && imdbId) {
    record = await prisma.mediaCache.findFirst({ where: { imdbId } });
  }
  if (!record && title) {
    record = await prisma.mediaCache.findFirst({
      where: {
        title: { contains: title },
        ...(year ? { year: String(year) } : {})
      }
    });
  }

  const newInfoHash = extractInfoHash(torrent.url);

  // STEP 2: Merge - new magnet first, dropping duplicates of the same info hash
  let existingTorrents = [];
  if (record?.torrents) {
    try {
      existingTorrents = JSON.parse(record.torrents) || [];
    } catch (e) {
      existingTorrents = [];
    }
  }

  const deduped = existingTorrents.filter((t) => {
    const hash = extractInfoHash(t?.url);
    return !newInfoHash || !hash || hash !== newInfoHash;
  });

  const updatedTorrents = [torrent, ...deduped];

  // STEP 3: Update the existing record, or create one if this media was never cached
  if (record) {
    const updated = await prisma.mediaCache.update({
      where: { id: record.id },
      data: {
        torrents: JSON.stringify(updatedTorrents),
        lastUpdated: new Date()
      }
    });
    console.log(`[BROKEN_LINK_FIX] Database updated for "${record.title}" (new torrent placed first, ${updatedTorrents.length} total)`);
    invalidateCachesForMedia(record.title, record.tmdbId);
    return updated;
  }

  // Strict title validation — never persist "Unknown Title".
  // Fallback chain: reported title -> torrent release name -> imdb id -> info hash.
  const candidateTitles = [
    title,
    typeof torrent?.name === 'string'
      ? torrent.name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[.\-_]+/g, ' ').replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
      : null,
    imdbId ? `Media ${imdbId}` : null,
    newInfoHash ? `Torrent ${newInfoHash.slice(0, 12)}` : null,
  ];
  const resolvedTitle = candidateTitles.find(
    (t) => typeof t === 'string' && t.trim() && !['unknown', 'unknown title', 'null', 'undefined'].includes(t.trim().toLowerCase())
  ) || 'Uncategorized Download';

  const created = await prisma.mediaCache.create({
    data: {
      tmdbId: movieId ? String(movieId) : `report_${newInfoHash || Date.now()}`,
      mediaType: mediaType === 'tv' ? 'tv' : 'movie',
      imdbId: imdbId || null,
      title: resolvedTitle,
      year: year ? String(year) : null,
      torrents: JSON.stringify([torrent])
    }
  });
  console.log(`[BROKEN_LINK_FIX] Created database record for "${created.title}" (title source: ${resolvedTitle === title ? 'reported' : 'fallback'}) with the new magnet`);
  invalidateCachesForMedia(created.title, created.tmdbId);
  return created;
}

/**
 * Search a single provider with a hard timeout - never throws
 */
async function searchReportProvider(provider, query, category, limit, timeoutMs = 15000) {
  let timeoutId = null;
  try {
    const results = await Promise.race([
      TorrentSearchApi.search([provider], query, category, limit),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          console.log(`[BROKEN_LINK_FIX] Provider "${provider}" timed out after ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs);
      })
    ]);
    return Array.isArray(results) ? results : [];
  } catch (e) {
    console.log(`[BROKEN_LINK_FIX] Provider "${provider}" search failed: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve the magnet link of a raw provider result with a hard timeout
 */
async function getReportMagnet(rawTorrent, timeoutMs = 10000) {
  let timeoutId = null;
  try {
    const magnet = await Promise.race([
      TorrentSearchApi.getMagnet(rawTorrent),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
    if (magnet && typeof magnet === 'string' && /^magnet:\?xt=urn:btih:[0-9a-zA-Z]{32,40}/.test(magnet)) {
      return magnet;
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract the info hash (btih) from a magnet link
 */
function extractInfoHash(magnet) {
  const match = String(magnet || '').match(/btih:([0-9a-zA-Z]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * BROKEN LINK RECOVERY SEARCH
 * Fires every provider at the same time, aggregates all results,
 * and returns the torrent with the HIGHEST number of seeders.
 */
async function findReplacementTorrent(title, year = '', imdbId = null, mediaType = 'movie') {
  const cleanedTitle = cleanTitleForSearch(title);
  if (!cleanedTitle && !imdbId) return null;

  // Try "title year" first, then the plain title as a fallback query
  const queries = [];
  if (cleanedTitle && year) queries.push(`${cleanedTitle} ${year}`);
  if (cleanedTitle) queries.push(cleanedTitle);

  const { active: providers, newlyEnabled } = activateReportProviders();

  try {
    for (const query of queries) {
      console.log(`[BROKEN_LINK_FIX] Query: "${query}"`);

      // STEP 1: Search ALL providers simultaneously
      const outcomes = await Promise.allSettled(
        providers.map((provider) => {
          const categoryMap = REPORT_PROVIDER_CATEGORIES[provider] || { movie: 'All', tv: 'All' };
          const category = mediaType === 'tv' ? categoryMap.tv : categoryMap.movie;
          return searchReportProvider(provider, query, category, 10);
        })
      );

      // STEP 2: Aggregate every alive torrent from every provider (deduped)
      const aggregated = [];
      const seen = new Set();

      outcomes.forEach((outcome, index) => {
        if (outcome.status !== 'fulfilled' || !Array.isArray(outcome.value)) return;
        const provider = providers[index];
        let aliveCount = 0;

        for (const result of outcome.value) {
          if (!result) continue;

          const seeders = parseInt(result.seeds) || parseInt(result.seeders) || 0;
          if (seeders <= 0) continue; // Dead torrent - skip it

          const dedupeKey = `${provider}:${result.desc || result.link || result.title}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          aggregated.push({ ...result, provider, seeders });
          aliveCount++;
        }

        console.log(`[BROKEN_LINK_FIX]   ${provider}: ${aliveCount} alive torrents`);
      });

      if (aggregated.length === 0) {
        console.log('[BROKEN_LINK_FIX] No alive torrents for this query, trying the next query...');
        continue;
      }

      // STEP 3: Sort by seeders - highest first - and take the top candidates
      aggregated.sort((a, b) => b.seeders - a.seeders);
      const candidates = aggregated.slice(0, 6);
      console.log(`[BROKEN_LINK_FIX] ${aggregated.length} alive torrents aggregated. Resolving magnets for the top ${candidates.length}...`);

      // STEP 4: Resolve magnet links top-down (staggered to avoid rate limiting).
      // The list is sorted by seeders, so the FIRST candidate that yields a
      // valid magnet IS the highest-seeded torrent - stop immediately.
      for (let i = 0; i < candidates.length; i++) {
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        const magnet = await getReportMagnet(candidates[i]);
        if (!magnet) continue;

        const best = candidates[i];
        console.log(`[BROKEN_LINK_FIX] WINNER: [${best.provider}] "${best.title}" - ${best.seeders} seeders`);

        return {
          url: magnet,
          quality: extractQuality(best.title || ''),
          size: typeof best.size === 'number' ? formatFileSize(best.size) : (best.size || 'Unknown'),
          type: 'magnet',
          seeders: best.seeders,
          leechers: parseInt(best.peers) || parseInt(best.leechers) || 0,
          name: best.title || 'Unknown',
          provider: best.provider || 'Multi-Tracker'
        };
      }

      console.log('[BROKEN_LINK_FIX] Could not resolve any magnet, trying the next query...');
      continue;
    }

    console.log('[BROKEN_LINK_FIX] No replacement torrent found on any provider');
    return null;
  } finally {
    // Put the global provider configuration back the way we found it
    restoreReportProviders(newlyEnabled);
  }
}

/**
 * UNIFIED SEARCH MEDIA FUNCTION
 * Implements multi-source fallback system:
 * - Movies: YTS -> TorrentGalaxy -> 1337x -> Apibay
 * - TV Shows: EZTV -> TorrentGalaxy -> 1337x -> Apibay
 */
async function searchMedia(title, type, year = '', imdbId = null, season = null, episode = null) {
  console.log(`\n[UNIFIED_SEARCH] Starting search for ${type}: "${title}" (${year})`);
  
  // Check torrent cache first
  const cacheKey = season !== null 
    ? `${title}_${year}_S${season}${episode !== null ? `E${episode}` : ''}`
    : `${title}_${year}`;
  const cachedTorrents = getFromTorrentCache(cacheKey, year || 'any');
  
  if (cachedTorrents !== null) {
    console.log(`[UNIFIED_SEARCH] Cache hit: ${cachedTorrents.length} torrents`);
    return cachedTorrents;
  }
  
  let torrents = [];
  
  if (type === 'movie') {
    // MOVIES: YTS -> Multi-Tracker -> Apibay
    console.log('[UNIFIED_SEARCH] Strategy: YTS -> Multi-Tracker -> Apibay');
    
    // Step 1: Try YTS API (primary source for movies)
    try {
      torrents = await searchMovieTorrentsYTS(title, year, imdbId);
      if (torrents.length > 0) {
        console.log(`[UNIFIED_SEARCH] SUCCESS from YTS: ${torrents.length} torrents`);
        setTorrentCache(cacheKey, year || 'any', torrents);
        return torrents;
      }
    } catch (error) {
      console.error('[UNIFIED_SEARCH] YTS failed:', error.message);
    }
    
    // Step 2: Fallback to Multi-Tracker (TorrentGalaxy, 1337x, TPB)
    try {
      torrents = await searchMultiTrackerFallback(title, year, 'Video', 5);
      if (torrents.length > 0) {
        console.log(`[UNIFIED_SEARCH] SUCCESS from Multi-Tracker: ${torrents.length} torrents`);
        setTorrentCache(cacheKey, year || 'any', torrents);
        return torrents;
      }
    } catch (error) {
      console.error('[UNIFIED_SEARCH] Multi-Tracker failed:', error.message);
    }
    
    // Step 3: Final fallback to Apibay
    try {
      torrents = await searchTorrentsApibay(title, year);
      if (torrents.length > 0) {
        console.log(`[UNIFIED_SEARCH] SUCCESS from Apibay: ${torrents.length} torrents`);
        setTorrentCache(cacheKey, year || 'any', torrents);
        return torrents;
      }
    } catch (error) {
      console.error('[UNIFIED_SEARCH] Apibay failed:', error.message);
    }
    
  } else if (type === 'tv') {
    // TV SHOWS: EZTV -> Multi-Tracker -> Apibay
    console.log('[UNIFIED_SEARCH] Strategy: EZTV -> Multi-Tracker -> Apibay');
    
    // Step 1: Try EZTV API (primary source for TV shows)
    try {
      torrents = await searchTVShowTorrentsEZTV(title, season, episode, imdbId);
      if (torrents.length > 0) {
        console.log(`[UNIFIED_SEARCH] SUCCESS from EZTV: ${torrents.length} torrents`);
        setTorrentCache(cacheKey, year || 'any', torrents);
        return torrents;
      }
    } catch (error) {
      console.error('[UNIFIED_SEARCH] EZTV failed:', error.message);
    }
    
    // Step 2: Fallback to Multi-Tracker with episode formatting
    try {
      let searchQuery = title;
      if (season !== null) {
        const paddedSeason = String(season).padStart(2, '0');
        if (episode !== null) {
          const paddedEpisode = String(episode).padStart(2, '0');
          searchQuery = `${title} S${paddedSeason}E${paddedEpisode}`;
        } else {
          searchQuery = `${title} S${paddedSeason}`;
        }
      }
      
      torrents = await searchMultiTrackerFallback(searchQuery, '', 'Video', 5);
      if (torrents.length > 0) {
        console.log(`[UNIFIED_SEARCH] SUCCESS from Multi-Tracker: ${torrents.length} torrents`);
        setTorrentCache(cacheKey, year || 'any', torrents);
        return torrents;
      }
    } catch (error) {
      console.error('[UNIFIED_SEARCH] Multi-Tracker failed:', error.message);
    }
    
    // Step 3: Final fallback to Apibay with season pack search
    try {
      const paddedSeason = season !== null ? String(season).padStart(2, '0') : '01';
      const tvSearchQuery = `${title} S${paddedSeason}`;
      torrents = await searchSeasonPacksApibay(tvSearchQuery, year);
      if (torrents.length > 0) {
        console.log(`[UNIFIED_SEARCH] SUCCESS from Apibay: ${torrents.length} torrents`);
        setTorrentCache(cacheKey, year || 'any', torrents);
        return torrents;
      }
    } catch (error) {
      console.error('[UNIFIED_SEARCH] Apibay failed:', error.message);
    }
  }
  
  console.log(`[UNIFIED_SEARCH] FAILED: No torrents found from any source for "${title}"`);
  setTorrentCache(cacheKey, year || 'any', []);
  return [];
}

/**
 * Search Apibay (The Pirate Bay API) for torrents
 * WITH TORRENT CACHE - Prevents duplicate requests during traffic spikes
 */
async function searchTorrentsApibay(movieTitle, year) {
  // CRITICAL: Check torrent cache first to avoid rate limiting
  const cachedTorrents = getFromTorrentCache(movieTitle, year);
  if (cachedTorrents !== null) {
    return cachedTorrents;
  }
  
  try {
    // Clean the title for better search results
    const cleanedTitle = cleanTitleForSearch(movieTitle);
    const searchQuery = `${cleanedTitle} ${year}`;
    const encodedQuery = encodeURIComponent(searchQuery);
    const apiUrl = `${APIBAY_BASE_URL}/q.php?q=${encodedQuery}`;
    
    console.log(`[APIBAY] API REQUEST: "${searchQuery}" (original: "${movieTitle}")`);
    
    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.data || !Array.isArray(response.data)) {
      console.log('[APIBAY] Invalid response format for:', movieTitle);
      return [];
    }

    // Filter out bad results and map to torrents
    const allValidTorrents = response.data
      .filter(torrent => {
        // Filter out invalid entries
        if (!torrent || torrent.id === '0' || torrent.id === 0) {
          return false;
        }
        
        // Check for valid info_hash
        if (!torrent.info_hash || torrent.info_hash.length < 40) {
          return false;
        }
        
        // Filter for video category (201 = Movies, 207 = HD Movies)
        const category = parseInt(torrent.category);
        if (category !== 201 && category !== 207) {
          return false;
        }
        
        // CRITICAL: Filter out dead torrents (0 seeders) to prevent Webtor magnetizing issues
        const seeders = parseInt(torrent.seeders) || 0;
        if (seeders === 0) {
          return false;
        }
        
        return true;
      })
      .map(torrent => {
        try {
          // Construct magnet link
          const magnetLink = `magnet:?xt=urn:btih:${torrent.info_hash}&dn=${encodeURIComponent(torrent.name)}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce`;
          
          // Convert size and extract quality using regex
          const size = formatFileSize(parseInt(torrent.size));
          const quality = extractQuality(torrent.name);
          
          return {
            url: magnetLink,
            quality: quality,
            size: size,
            type: 'magnet',
            seeders: parseInt(torrent.seeders) || 0,
            leechers: parseInt(torrent.leechers) || 0,
            name: torrent.name
          };
        } catch (mapError) {
          console.error('[APIBAY] Error mapping torrent:', mapError.message);
          return null;
        }
      })
      .filter(Boolean); // Remove any null entries from mapping errors

    // Group by quality and pick the most seeded torrent for each quality
    const qualityGroups = {};
    allValidTorrents.forEach(torrent => {
      const quality = torrent.quality;
      if (!qualityGroups[quality] || torrent.seeders > qualityGroups[quality].seeders) {
        qualityGroups[quality] = torrent;
      }
    });

    // Convert back to array and sort by quality preference (2160p > 1080p > 720p > 480p > CAM > Unknown)
    const qualityOrder = { '2160p': 1, '1080p': 2, '720p': 3, '480p': 4, 'CAM': 5, 'Unknown': 6 };
    const validTorrents = Object.values(qualityGroups)
      .sort((a, b) => (qualityOrder[a.quality] || 99) - (qualityOrder[b.quality] || 99))
      .slice(0, 4); // Return up to 4 unique qualities

    if (validTorrents.length > 0) {
      console.log(`[APIBAY] Found ${validTorrents.length} torrents for "${movieTitle}" (${year})`);
      validTorrents.forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.quality} - ${t.size} - ${t.seeders} seeders`);
      });
    } else {
      console.log(`[APIBAY] No valid torrents found for "${movieTitle}" (${year})`);
    }

    // CRITICAL: Cache the result (even if empty) to prevent repeated requests
    setTorrentCache(movieTitle, year, validTorrents);
    
    return validTorrents;
  } catch (error) {
    console.error(`[APIBAY ERROR] Failed to search "${movieTitle}":`, error.message);
    
    // Cache empty result for 2 hours to prevent hammering on errors
    setTorrentCache(movieTitle, year, []);
    
    return [];
  }
}

/**
 * Fetch torrents with timeout
 */
async function fetchTorrentsWithTimeout(movieTitle, year, timeoutMs = 5000) {
  return Promise.race([
    searchTorrentsApibay(movieTitle, year),
    new Promise((resolve) => setTimeout(() => {
      console.log(`[APIBAY] Timeout for "${movieTitle}" after ${timeoutMs}ms`);
      resolve([]);
    }, timeoutMs))
  ]);
}

/**
 * Fetch torrents with extended timeout (10 seconds)
 */
async function fetchTorrentsWithExtendedTimeout(movieTitle, year, timeoutMs = 10000) {
  return Promise.race([
    searchTorrentsApibay(movieTitle, year),
    new Promise((resolve) => setTimeout(() => {
      console.log(`[APIBAY] Timeout for "${movieTitle}" after ${timeoutMs}ms`);
      resolve([]);
    }, timeoutMs))
  ]);
}

/**
 * Fetch TV Shows from TMDB with season pack torrents
 */
async function fetchTVShowsWithTorrents(page = 1) {
  console.log(`\n[FETCH] Starting TV Shows fetch (page ${page})...`);
  
  try {
    // Step 1: Get TV shows from TMDB
    console.log(`[TMDB] Fetching TV shows (page ${page})...`);
    const response = await axios.get(`${TMDB_BASE_URL}/discover/tv`, {
      params: {
        api_key: TMDB_API_KEY,
        sort_by: 'popularity.desc',
        page: page,
        'vote_count.gte': 50,
        'vote_average.gte': 6
      },
      timeout: 15000
    });

    if (!response.data || !response.data.results || response.data.results.length === 0) {
      console.log('[TMDB] No TV shows found');
      return {
        success: true,
        source: 'TMDB (No results)',
        data: []
      };
    }

    const tmdbShows = response.data.results;
    console.log(`[TMDB] Successfully found ${tmdbShows.length} TV shows`);

    // Step 2: Fetch additional details and torrents for each show with STAGGERED DELAYS
    console.log(`[FETCH] Fetching details and torrents for ${tmdbShows.length} TV shows with staggered delays...`);
    
    const showPromises = tmdbShows.map(async (show, index) => {
      // STAGGERED DELAY: Prevent Apibay rate limiting by spacing requests 800ms apart
      const delay = index * 800;
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const year = show.first_air_date ? new Date(show.first_air_date).getFullYear() : '';
      const title = show.name || show.original_name;

      try {
        // Fetch IMDb ID and additional details
        const details = await getTVShowDetails(show.id).catch(err => {
          console.error(`[TMDB DETAILS] Failed for: ${title} - ${err.message}`);
          return { imdbId: '', trailerCode: '' };
        });

        // Fetch season pack torrents separately using unified search (EZTV -> Multi-Tracker -> Apibay)
        let showTorrents = [];
        try {
          showTorrents = await searchMedia(title, 'tv', year, details.imdbId, 1, null);
        } catch (torrentError) {
          console.error(`[UNIFIED_SEARCH] Failed for: ${title} (${year}) - ${torrentError.message}`);
          showTorrents = [];
        }

        // Map genres
        const genreMap = {
          10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
          18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News',
          10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk',
          10768: 'War & Politics', 37: 'Western'
        };
        const genres = (show.genre_ids || []).map(id => genreMap[id]).filter(Boolean);

        return {
          id: show.id,
          imdb_id: details.imdbId,
          title: title,
          year: year,
          rating: show.vote_average || 0,
          poster: show.poster_path ? `${TMDB_IMAGE_BASE}${show.poster_path}` : '',
          backdrop: show.backdrop_path ? `${TMDB_BACKDROP_BASE}${show.backdrop_path}` : '',
          plot: show.overview || 'No plot available.',
          genres: genres,
          yt_trailer_code: details.trailerCode,
          torrents: showTorrents,
          is_tv: true
        };
      } catch (showError) {
        console.error(`[TV SHOW ERROR] Failed to process: ${title} (${year}) -`, showError.message);
        
        return {
          id: show.id,
          imdb_id: '',
          title: title,
          year: year,
          rating: show.vote_average || 0,
          poster: show.poster_path ? `${TMDB_IMAGE_BASE}${show.poster_path}` : '',
          backdrop: show.backdrop_path ? `${TMDB_BACKDROP_BASE}${show.backdrop_path}` : '',
          plot: show.overview || 'No plot available.',
          genres: [],
          yt_trailer_code: '',
          torrents: [],
          is_tv: true
        };
      }
    });

    const results = await Promise.allSettled(showPromises);
    const successfulShows = results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value)
      .filter(show => show && show.id);

    const showsWithTorrents = successfulShows.filter(s => s.torrents && s.torrents.length > 0).length;
    const showsWithoutTorrents = successfulShows.filter(s => !s.torrents || s.torrents.length === 0).length;

    console.log(`[FETCH] Successfully processed ${successfulShows.length} TV shows`);
    console.log(`[FETCH] Shows with torrents: ${showsWithTorrents}`);
    console.log(`[FETCH] Shows without torrents: ${showsWithoutTorrents}`);

    return {
      success: true,
      source: 'TMDB + 1337x Season Packs',
      data: successfulShows,
      stats: {
        total: successfulShows.length,
        withTorrents: showsWithTorrents,
        withoutTorrents: showsWithoutTorrents
      }
    };
  } catch (error) {
    console.error('[FETCH ERROR] TV shows fetch failed:', error.message);
    return {
      success: false,
      source: 'Error',
      data: [],
      error: error.message
    };
  }
}

/**
 * Get TV show IMDb ID and trailer from TMDB
 */
async function getTVShowDetails(tmdbId) {
  try {
    const [externalIds, videos] = await Promise.allSettled([
      axios.get(`${TMDB_BASE_URL}/tv/${tmdbId}/external_ids`, {
        params: { api_key: TMDB_API_KEY },
        timeout: 5000
      }),
      axios.get(`${TMDB_BASE_URL}/tv/${tmdbId}/videos`, {
        params: { api_key: TMDB_API_KEY },
        timeout: 5000
      })
    ]);

    const imdbId = externalIds.status === 'fulfilled' ? externalIds.value.data?.imdb_id : '';
    
    let trailerCode = '';
    if (videos.status === 'fulfilled' && videos.value.data?.results) {
      const trailer = videos.value.data.results.find(
        v => v.type === 'Trailer' && v.site === 'YouTube'
      );
      trailerCode = trailer?.key || '';
    }

    return { imdbId, trailerCode };
  } catch (error) {
    console.log(`[TMDB] Failed to get TV show details for ${tmdbId}:`, error.message);
    return { imdbId: '', trailerCode: '' };
  }
}

/**
 * Fetch season pack torrents from Apibay for TV shows
 */
async function fetchSeasonPackTorrents(showTitle, year, timeoutMs = 10000) {
  return Promise.race([
    searchSeasonPacksApibay(showTitle, year),
    new Promise((resolve) => setTimeout(() => {
      console.log(`[APIBAY] Timeout for TV show "${showTitle}" after ${timeoutMs}ms`);
      resolve([]);
    }, timeoutMs))
  ]);
}

/**
 * Search Apibay for TV show season packs
 * WITH TORRENT CACHE - Prevents duplicate requests
 */
async function searchSeasonPacksApibay(showTitle, year) {
  // Check cache first
  const cachedTorrents = getFromTorrentCache(showTitle, year);
  if (cachedTorrents !== null) {
    return cachedTorrents;
  }
  
  try {
    // Clean the title for better search results
    const cleanedTitle = cleanTitleForSearch(showTitle);
    
    // Try different search queries for better results
    const queries = [
      `${cleanedTitle} season 1 complete`,
      `${cleanedTitle} S01 complete`,
      `${cleanedTitle} ${year}`
    ];

    console.log(`[APIBAY] API REQUEST (TV): "${cleanedTitle}" (original: "${showTitle}")`);
    
    // Try the first query
    const searchQuery = queries[0];
    const encodedQuery = encodeURIComponent(searchQuery);
    const apiUrl = `${APIBAY_BASE_URL}/q.php?q=${encodedQuery}`;
    
    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.data || !Array.isArray(response.data)) {
      console.log('[APIBAY] Invalid response format for TV show:', showTitle);
      return [];
    }

    // Filter for TV show torrents
    const validTorrents = response.data
      .filter(torrent => {
        if (!torrent || torrent.id === '0' || torrent.id === 0) {
          return false;
        }
        
        if (!torrent.info_hash || torrent.info_hash.length < 40) {
          return false;
        }
        
        // Filter for video category (205 = TV shows, 208 = HD TV shows)
        const category = parseInt(torrent.category);
        if (category !== 205 && category !== 208 && category !== 201 && category !== 207) {
          return false;
        }
        
        // CRITICAL: Filter out dead torrents (0 seeders) to prevent Webtor magnetizing issues
        const seeders = parseInt(torrent.seeders) || 0;
        if (seeders === 0) {
          return false;
        }
        
        return true;
      })
      .slice(0, 3)
      .map(torrent => {
        try {
          const magnetLink = `magnet:?xt=urn:btih:${torrent.info_hash}&dn=${encodeURIComponent(torrent.name)}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce`;
          
          const size = formatFileSize(parseInt(torrent.size));
          const quality = extractQuality(torrent.name);
          
          return {
            url: magnetLink,
            quality: quality,
            size: size,
            type: 'magnet',
            seeders: parseInt(torrent.seeders) || 0,
            leechers: parseInt(torrent.leechers) || 0,
            name: torrent.name
          };
        } catch (mapError) {
          console.error('[APIBAY] Error mapping TV show torrent:', mapError.message);
          return null;
        }
      })
      .filter(Boolean);

    if (validTorrents.length > 0) {
      console.log(`[APIBAY] Found ${validTorrents.length} season packs for "${showTitle}"`);
    } else {
      console.log(`[APIBAY] No season packs found for "${showTitle}"`);
    }

    // Cache result to prevent repeated requests
    setTorrentCache(showTitle, year, validTorrents);
    
    return validTorrents;
  } catch (error) {
    console.error(`[APIBAY ERROR] Failed to search TV show "${showTitle}":`, error.message);
    
    // Cache empty result
    setTorrentCache(showTitle, year, []);
    
    return [];
  }
}

/**
 * Combine TMDB + Apibay data
 */
async function fetchMoviesWithTorrents(language = 'en', page = 1) {
  const languageName = language === 'ta|ml' ? 'Tamil & Malayalam' : language === 'ta' ? 'Tamil' : 'English';
  console.log(`\n[FETCH] Starting ${languageName} movies fetch (page ${page})...`);
  
  // Step 1: Get movies from TMDB
  const tmdbMovies = await fetchMoviesFromTMDB(language, page);
  
  if (tmdbMovies.length === 0) {
    console.log(`[FETCH] No ${languageName} movies from TMDB`);
    
    if (language === 'en') {
      console.log('[FETCH] Returning mock data as last resort');
      return {
        success: true,
        source: 'Mock Data (TMDB failed)',
        data: MOCK_MOVIES
      };
    }
    
    return {
      success: true,
      source: 'TMDB (No results)',
      data: []
    };
  }

  // Step 2: Fetch additional details and torrents for each movie with STAGGERED DELAYS
  console.log(`[FETCH] Fetching details and torrents for ${tmdbMovies.length} movies with staggered delays...`);
  
  const moviePromises = tmdbMovies.map(async (movie, index) => {
    // STAGGERED DELAY: Prevent Apibay rate limiting by spacing requests 800ms apart
    const delay = index * 800;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    const year = movie.release_date ? new Date(movie.release_date).getFullYear() : '';
    const title = movie.title || movie.original_title;

    // Isolated error handling - each movie processed independently
    try {
      // Fetch IMDb ID, runtime, trailer first (fast API)
      const details = await getMovieDetails(movie.id).catch(err => {
        console.error(`[TMDB DETAILS] Failed for: ${title} - ${err.message}`);
        return { imdbId: '', runtime: null, trailerCode: '' };
      });

      // Fetch torrents using unified search (YTS -> Multi-Tracker -> Apibay)
      let movieTorrents = [];
      try {
        movieTorrents = await searchMedia(title, 'movie', year, details.imdbId);
      } catch (torrentError) {
        console.error(`[UNIFIED_SEARCH] Failed for: ${title} (${year}) - ${torrentError.message}`);
        movieTorrents = [];
      }

      // Map genres
      const genreMap = {
        28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
        99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
        27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
        10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western'
      };
      const genres = (movie.genre_ids || []).map(id => genreMap[id]).filter(Boolean);

      return {
        id: movie.id,
        imdb_id: details.imdbId,
        title: title,
        year: year,
        rating: movie.vote_average || 0,
        runtime: details.runtime,
        poster: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : '',
        backdrop: movie.backdrop_path ? `${TMDB_BACKDROP_BASE}${movie.backdrop_path}` : '',
        plot: movie.overview || 'No plot available.',
        genres: genres,
        yt_trailer_code: details.trailerCode,
        torrents: movieTorrents
      };
    } catch (movieError) {
      // If processing this specific movie fails, log and return with empty torrents
      console.error(`[MOVIE ERROR] Failed to process: ${title} (${year}) -`, movieError.message);
      
      // Return movie with minimal data and no torrents
      return {
        id: movie.id,
        imdb_id: '',
        title: title,
        year: year,
        rating: movie.vote_average || 0,
        runtime: null,
        poster: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : '',
        backdrop: movie.backdrop_path ? `${TMDB_BACKDROP_BASE}${movie.backdrop_path}` : '',
        plot: movie.overview || 'No plot available.',
        genres: [],
        yt_trailer_code: '',
        torrents: []
      };
    }
  });

  const results = await Promise.allSettled(moviePromises);
  const successfulMovies = results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .filter(movie => movie && movie.id); // Extra safety check

  const moviesWithTorrents = successfulMovies.filter(m => m.torrents && m.torrents.length > 0).length;
  const moviesWithoutTorrents = successfulMovies.filter(m => !m.torrents || m.torrents.length === 0).length;

  console.log(`[FETCH] Successfully processed ${successfulMovies.length} ${languageName} movies`);
  console.log(`[FETCH] Movies with torrents: ${moviesWithTorrents}`);
  console.log(`[FETCH] Movies without torrents: ${moviesWithoutTorrents}`);

  return {
    success: true,
    source: 'TMDB + Apibay',
    data: successfulMovies,
    stats: {
      total: successfulMovies.length,
      withTorrents: moviesWithTorrents,
      withoutTorrents: moviesWithoutTorrents
    }
  };
}

/**
 * Express Routes
 */

// Get English/Hollywood movies (TMDB + Apibay) with Torrent-Aware Caching
app.get('/api/movies', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const cacheKey = `movies_en_page${page}`;
  
  console.log(`\n[API] GET /api/movies (English, page: ${page})`);
  
  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    return res.json(cached);
  }
  
  try {
    const result = await fetchMoviesWithTorrents('en', page);
    
    // CRITICAL: Only cache long-term if we have actual data
    if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
      // Check if AT LEAST ONE movie has torrents
      const hasValidTorrents = result.data.some(movie => 
        movie.torrents && Array.isArray(movie.torrents) && movie.torrents.length > 0
      );
      
      if (hasValidTorrents) {
        const moviesWithTorrents = result.data.filter(m => m.torrents && m.torrents.length > 0).length;
        console.log(`[CACHE] SUCCESS - Caching ${result.data.length} English movies (${moviesWithTorrents} with torrents) for 6 hours`);
        setCache(cacheKey, result, CACHE_TTL.MOVIE_LIST);
      } else {
        console.warn(`[CACHE] APIBAY FAILED - ${result.data.length} movies but ZERO have torrents. Caching for only 30 seconds to retry soon.`);
        setCache(cacheKey, result, 30000);
      }
    } else {
      console.warn(`[CACHE] NO DATA - Skipping long-term cache (success: ${result?.success}, data length: ${result?.data?.length || 0})`);
      setCache(cacheKey, result, 30000);
    }
    
    res.json(result);
  } catch (error) {
    console.error('[API ERROR] English movies endpoint crashed:', error);
    console.error('[API ERROR] Stack:', error.stack);
    
    // DO NOT CACHE ERRORS - Return mock data without caching
    res.json({
      success: true,
      source: 'Mock Data (endpoint error)',
      data: MOCK_MOVIES
    });
  }
});

// ==============================================================================
// TMDB List Cache — Popular, Trending, Top Rated, Category
// Uses the reusable fetchAndCacheMovies() from listCache.js:
//   Local Prisma DB first → TMDB fallback → auto-save to Movie + ListCache
// ==============================================================================

const tmdbConfig = {
  TMDB_BASE_URL,
  TMDB_API_KEY,
  TMDB_IMAGE_BASE,
  TMDB_BACKDROP_BASE,
};

const fetchPopular = createTMDBListFetcher('/discover/movie',
  { sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  tmdbConfig
);

const fetchTrending = createTMDBListFetcher('/trending/movie/week', {}, tmdbConfig);

const fetchTopRated = createTMDBListFetcher('/discover/movie',
  { sort_by: 'vote_average.desc', 'vote_count.gte': 100 },
  tmdbConfig
);

// GET /api/movies/popular
app.get('/api/movies/popular', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const result = await fetchAndCacheMovies({
      cacheKey: `popular_page${page}`,
      fetchFn: () => fetchPopular(page),
      ttlHours: 6,
    });
    res.json(result);
  } catch (err) {
    console.error('[API ERROR] Popular movies:', err.message);
    res.json({ success: true, source: 'Error', data: [] });
  }
});

// GET /api/movies/trending
app.get('/api/movies/trending', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const result = await fetchAndCacheMovies({
      cacheKey: `trending_page${page}`,
      fetchFn: () => fetchTrending(page),
      ttlHours: 4, // trending changes faster
    });
    res.json(result);
  } catch (err) {
    console.error('[API ERROR] Trending movies:', err.message);
    res.json({ success: true, source: 'Error', data: [] });
  }
});

// GET /api/movies/top-rated
app.get('/api/movies/top-rated', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const result = await fetchAndCacheMovies({
      cacheKey: `top_rated_page${page}`,
      fetchFn: () => fetchTopRated(page),
      ttlHours: 12, // top rated changes slowly
    });
    res.json(result);
  } catch (err) {
    console.error('[API ERROR] Top rated movies:', err.message);
    res.json({ success: true, source: 'Error', data: [] });
  }
});

// GET /api/movies/category/:id — TMDB genre browse (e.g. 28=Action, 35=Comedy)
app.get('/api/movies/category/:id', async (req, res) => {
  const genreId = req.params.id;
  const page = parseInt(req.query.page) || 1;
  try {
    const fetchCategory = createTMDBListFetcher('/discover/movie',
      { with_genres: genreId, sort_by: 'popularity.desc', 'vote_count.gte': 20 },
      tmdbConfig
    );
    const result = await fetchAndCacheMovies({
      cacheKey: `category_${genreId}_page${page}`,
      fetchFn: () => fetchCategory(page),
      ttlHours: 6,
    });
    res.json(result);
  } catch (err) {
    console.error(`[API ERROR] Category ${genreId} movies:`, err.message);
    res.json({ success: true, source: 'Error', data: [] });
  }
});

// Get Tamil & Malayalam movies (TMDB + Apibay) with Torrent-Aware Caching
app.get('/api/movies/tamil', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const cacheKey = `tamil_page${page}`;
  
  console.log(`\n[API] GET /api/movies/tamil (Tamil & Malayalam, page: ${page})`);
  
  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    return res.json(cached);
  }
  
  try {
    const result = await fetchMoviesWithTorrents('ta|ml', page);
    
    // CRITICAL: Only cache long-term if we have actual data
    if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
      // Check if AT LEAST ONE movie has torrents
      const hasValidTorrents = result.data.some(movie => 
        movie.torrents && Array.isArray(movie.torrents) && movie.torrents.length > 0
      );
      
      if (hasValidTorrents) {
        const moviesWithTorrents = result.data.filter(m => m.torrents && m.torrents.length > 0).length;
        console.log(`[CACHE] SUCCESS - Caching ${result.data.length} Tamil/Malayalam movies (${moviesWithTorrents} with torrents) for 6 hours`);
        setCache(cacheKey, result, CACHE_TTL.MOVIE_LIST);
      } else {
        console.warn(`[CACHE] APIBAY FAILED - ${result.data.length} movies but ZERO have torrents. Caching for only 30 seconds to retry soon.`);
        setCache(cacheKey, result, 30000);
      }
    } else {
      console.warn(`[CACHE] NO DATA - Skipping long-term cache (success: ${result?.success}, data length: ${result?.data?.length || 0})`);
      setCache(cacheKey, result, 30000);
    }
    
    res.json(result);
  } catch (error) {
    console.error('[API ERROR] Tamil & Malayalam movies endpoint crashed:', error.message);
    console.error('[TMDB ERROR] Details:', error.response?.data || error.stack);
    
    // DO NOT CACHE ERRORS - Return error response without caching
    res.json({
      success: false,
      source: 'Error',
      error: error.message,
      data: []
    });
  }
});

// Get TV Shows (TMDB + Apibay Season Packs) with Torrent-Aware Caching
app.get('/api/tv', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const cacheKey = `tv_page${page}`;
  
  console.log(`\n[API] GET /api/tv (page: ${page})`);
  
  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    return res.json(cached);
  }
  
  try {
    const result = await fetchTVShowsWithTorrents(page);
    
    // CRITICAL: Only cache long-term if we have actual data
    if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
      // Check if AT LEAST ONE show has torrents
      const hasValidTorrents = result.data.some(show => 
        show.torrents && Array.isArray(show.torrents) && show.torrents.length > 0
      );
      
      if (hasValidTorrents) {
        const showsWithTorrents = result.data.filter(s => s.torrents && s.torrents.length > 0).length;
        console.log(`[CACHE] SUCCESS - Caching ${result.data.length} TV shows (${showsWithTorrents} with torrents) for 6 hours`);
        setCache(cacheKey, result, CACHE_TTL.TV_SHOWS_LIST);
      } else {
        console.warn(`[CACHE] APIBAY FAILED - ${result.data.length} TV shows but ZERO have torrents. Caching for only 30 seconds to retry soon.`);
        setCache(cacheKey, result, 30000);
      }
    } else {
      console.warn(`[CACHE] NO DATA - Skipping long-term cache (success: ${result?.success}, data length: ${result?.data?.length || 0})`);
      setCache(cacheKey, result, 30000);
    }
    
    res.json(result);
  } catch (error) {
    console.error('[API ERROR] TV shows endpoint crashed:', error.message);
    console.error('[TMDB ERROR] Details:', error.response?.data || error.stack);
    
    // DO NOT CACHE ERRORS - Return error response without caching
    res.json({
      success: false,
      source: 'Error',
      error: error.message,
      data: []
    });
  }
});

// Get single movie by ID (TMDB) with Prisma Database Caching
app.get('/api/movies/:id', async (req, res) => {
  const movieId = req.params.id;
  const cacheKey = `movie_${movieId}`;
  
  console.log(`\n[API] GET /api/movies/${movieId}`);
  
  // STEP 1: Check in-memory cache first (fastest)
  const memCached = getFromCache(cacheKey);
  if (memCached) {
    console.log(`[CACHE] Memory cache HIT for movie ${movieId}`);
    return res.json(memCached);
  }
  
  // STEP 2: Check Prisma database (persistent cache)
  try {
    const dbCached = await prisma.mediaCache.findUnique({
      where: { tmdbId: movieId }
    });
    
    if (dbCached) {
      const ageInHours = (Date.now() - new Date(dbCached.lastUpdated).getTime()) / (1000 * 60 * 60);
      
      // If cache is fresh (less than 24 hours old), return it
      if (ageInHours < 24) {
        console.log(`[PRISMA] Database cache HIT for movie ${movieId} (${ageInHours.toFixed(1)}h old)`);
        
        const responseData = {
          id: parseInt(movieId),
          imdb_id: dbCached.imdbId,
          title: dbCached.title,
          year: dbCached.year,
          rating: dbCached.rating,
          runtime: dbCached.runtime,
          poster: dbCached.poster,
          backdrop: dbCached.backdrop,
          plot: dbCached.plot,
          genres: dbCached.genres ? JSON.parse(dbCached.genres) : [],
          yt_trailer_code: dbCached.ytTrailerCode,
          torrents: dbCached.torrents ? JSON.parse(dbCached.torrents) : [],
          is_tv: dbCached.mediaType === 'tv',
          type: dbCached.mediaType
        };
        
        const response = {
          success: true,
          data: responseData,
          source: 'Prisma Database Cache'
        };
        
        // Also update memory cache for faster subsequent requests
        setCache(cacheKey, response);
        
        return res.json(response);
      } else {
        console.log(`[PRISMA] Database cache EXPIRED for movie ${movieId} (${ageInHours.toFixed(1)}h old) - refetching`);
      }
    } else {
      console.log(`[PRISMA] Database cache MISS for movie ${movieId} - fetching from TMDB`);
    }
  } catch (prismaError) {
    console.error(`[PRISMA ERROR] Failed to query database:`, prismaError.message);
  }
  
  // STEP 3: Fetch from TMDB and Apibay (cache miss or expired)
  try {
    let movieData = null;
    let isTVShow = false;
    
    try {
      console.log(`[TMDB] Fetching movie details for ID: ${movieId}`);
      const movieResponse = await axios.get(`${TMDB_BASE_URL}/movie/${movieId}`, {
        params: {
          api_key: TMDB_API_KEY,
          append_to_response: 'external_ids,videos'
        },
        timeout: 15000
      });
      movieData = movieResponse.data;
      isTVShow = false;
      console.log(`[TMDB] Successfully fetched movie: ${movieData.title}`);
    } catch (movieError) {
      if (movieError.response?.status === 404) {
        console.log(`[TMDB] Not a movie, trying TV show...`);
        try {
          const tvResponse = await axios.get(`${TMDB_BASE_URL}/tv/${movieId}`, {
            params: {
              api_key: TMDB_API_KEY,
              append_to_response: 'external_ids,videos'
            },
            timeout: 15000
          });
          movieData = tvResponse.data;
          isTVShow = true;
          console.log(`[TMDB] Successfully fetched TV show: ${movieData.name}`);
        } catch (tvError) {
          console.error(`[TMDB] Failed to fetch as TV show:`, tvError.message);
          throw new Error('Content not found');
        }
      } else {
        throw movieError;
      }
    }

    if (!movieData) {
      return res.status(404).json({
        success: false,
        message: 'Movie not found'
      });
    }

    // Extract data
    const title = movieData.title || movieData.name;
    const year = movieData.release_date 
      ? new Date(movieData.release_date).getFullYear().toString()
      : movieData.first_air_date 
      ? new Date(movieData.first_air_date).getFullYear().toString()
      : '';
    
    const imdbId = movieData.external_ids?.imdb_id || movieData.imdb_id || '';
    
    // Extract trailer
    let trailerCode = '';
    if (movieData.videos && movieData.videos.results) {
      const trailer = movieData.videos.results.find(
        v => v.type === 'Trailer' && v.site === 'YouTube'
      );
      trailerCode = trailer?.key || '';
    }

    // Fetch torrents using unified search
    let torrents = [];
    try {
      if (isTVShow) {
        console.log(`[UNIFIED_SEARCH] Searching TV show season pack: ${title}`);
        torrents = await searchMedia(title, 'tv', year, imdbId, 1, null);
        console.log(`[UNIFIED_SEARCH] Found ${torrents.length} season pack torrents for TV show`);
      } else {
        console.log(`[UNIFIED_SEARCH] Searching movie torrents: ${title} (${year})`);
        torrents = await searchMedia(title, 'movie', year, imdbId);
        console.log(`[UNIFIED_SEARCH] Found ${torrents.length} torrents for movie`);
      }
    } catch (torrentError) {
      console.error(`[UNIFIED_SEARCH] Failed to fetch torrents for ${title}:`, torrentError.message);
      torrents = [];
    }

    // Build response data
    const responseData = {
      id: parseInt(movieId),
      imdb_id: imdbId,
      title: title,
      year: year,
      rating: movieData.vote_average || 0,
      runtime: movieData.runtime || movieData.episode_run_time?.[0] || null,
      poster: movieData.poster_path ? `${TMDB_IMAGE_BASE}${movieData.poster_path}` : '',
      backdrop: movieData.backdrop_path ? `${TMDB_BACKDROP_BASE}${movieData.backdrop_path}` : '',
      plot: movieData.overview || 'No plot available.',
      genres: movieData.genres?.map(g => g.name) || [],
      yt_trailer_code: trailerCode,
      torrents: torrents,
      is_tv: isTVShow,
      type: isTVShow ? 'tv' : 'movie'
    };

    const response = {
      success: true,
      data: responseData,
      source: 'TMDB + Apibay (Fresh Fetch)'
    };

    // STEP 4: Save to Prisma database for persistent caching
    try {
      await prisma.mediaCache.upsert({
        where: { tmdbId: movieId },
        update: {
          imdbId: imdbId || null,
          title: title,
          year: year || null,
          rating: responseData.rating,
          runtime: responseData.runtime,
          poster: responseData.poster || null,
          backdrop: responseData.backdrop || null,
          plot: responseData.plot || null,
          genres: JSON.stringify(responseData.genres),
          ytTrailerCode: trailerCode || null,
          torrents: JSON.stringify(torrents),
          lastUpdated: new Date()
        },
        create: {
          tmdbId: movieId,
          mediaType: isTVShow ? 'tv' : 'movie',
          imdbId: imdbId || null,
          title: title,
          year: year || null,
          rating: responseData.rating,
          runtime: responseData.runtime,
          poster: responseData.poster || null,
          backdrop: responseData.backdrop || null,
          plot: responseData.plot || null,
          genres: JSON.stringify(responseData.genres),
          ytTrailerCode: trailerCode || null,
          torrents: JSON.stringify(torrents)
        }
      });
      
      console.log(`[PRISMA] Successfully saved/updated movie ${movieId} in database`);
    } catch (prismaError) {
      console.error(`[PRISMA ERROR] Failed to save to database:`, prismaError.message);
    }

    // STEP 5: Also update memory cache
    setCache(cacheKey, response);

    console.log(`[API] Successfully returning single ${isTVShow ? 'TV show' : 'movie'}: ${title}`);
    console.log(`[API] Media Type: ${isTVShow ? 'TV Show' : 'Movie'}`);
    console.log(`[API] IMDb ID: ${imdbId}, Torrents: ${torrents.length}`);

    res.json(response);
    
  } catch (error) {
    console.error('[API ERROR] Single movie endpoint crashed:', error.message);
    console.error('[TMDB ERROR] Details:', error.response?.data || error.stack);
    
    res.status(404).json({
      success: false,
      message: 'Movie not found',
      error: error.message
    });
  }
});

// Get single TV show by ID (TMDB) with Prisma Database Caching
app.get('/api/tv/:id', async (req, res) => {
  const tvShowId = req.params.id;
  const cacheKey = `tv_${tvShowId}`;
  
  console.log(`\n[API] GET /api/tv/${tvShowId}`);
  
  // STEP 1: Check in-memory cache first (fastest)
  const memCached = getFromCache(cacheKey);
  if (memCached) {
    console.log(`[CACHE] Memory cache HIT for TV show ${tvShowId}`);
    return res.json(memCached);
  }
  
  // STEP 2: Check Prisma database (persistent cache)
  try {
    const dbCached = await prisma.mediaCache.findUnique({
      where: { tmdbId: tvShowId }
    });
    
    if (dbCached && dbCached.mediaType === 'tv') {
      const ageInHours = (Date.now() - new Date(dbCached.lastUpdated).getTime()) / (1000 * 60 * 60);
      
      // If cache is fresh (less than 24 hours old), return it
      if (ageInHours < 24) {
        console.log(`[PRISMA] Database cache HIT for TV show ${tvShowId} (${ageInHours.toFixed(1)}h old)`);
        
        const responseData = {
          id: parseInt(tvShowId),
          imdb_id: dbCached.imdbId,
          title: dbCached.title,
          year: dbCached.year,
          rating: dbCached.rating,
          poster: dbCached.poster,
          backdrop: dbCached.backdrop,
          plot: dbCached.plot,
          genres: dbCached.genres ? JSON.parse(dbCached.genres) : [],
          yt_trailer_code: dbCached.ytTrailerCode,
          torrents: dbCached.torrents ? JSON.parse(dbCached.torrents) : [],
          is_tv: true,
          type: 'tv',
          number_of_seasons: dbCached.numberOfSeasons || 1
        };
        
        const response = {
          success: true,
          data: responseData,
          source: 'Prisma Database Cache'
        };
        
        // Also update memory cache for faster subsequent requests
        setCache(cacheKey, response);
        
        return res.json(response);
      } else {
        console.log(`[PRISMA] Database cache EXPIRED for TV show ${tvShowId} (${ageInHours.toFixed(1)}h old) - refetching`);
      }
    } else {
      console.log(`[PRISMA] Database cache MISS for TV show ${tvShowId} - fetching from TMDB`);
    }
  } catch (prismaError) {
    console.error(`[PRISMA ERROR] Failed to query database:`, prismaError.message);
  }
  
  // STEP 3: Fetch from TMDB /tv/ endpoint (cache miss or expired)
  try {
    console.log(`[TMDB] Fetching TV show details for ID: ${tvShowId}`);
    const tvResponse = await axios.get(`${TMDB_BASE_URL}/tv/${tvShowId}`, {
      params: {
        api_key: TMDB_API_KEY,
        append_to_response: 'external_ids,videos'
      },
      timeout: 15000
    });
    
    const tvData = tvResponse.data;
    
    if (!tvData) {
      return res.status(404).json({
        success: false,
        message: 'TV show not found'
      });
    }

    const title = tvData.name || tvData.original_name;
    const year = tvData.first_air_date 
      ? new Date(tvData.first_air_date).getFullYear().toString()
      : '';
    
    const imdbId = tvData.external_ids?.imdb_id || '';
    const numberOfSeasons = tvData.number_of_seasons || 1;
    
    // Extract trailer
    let trailerCode = '';
    if (tvData.videos && tvData.videos.results) {
      const trailer = tvData.videos.results.find(
        v => v.type === 'Trailer' && v.site === 'YouTube'
      );
      trailerCode = trailer?.key || '';
    }

    // Fetch season pack torrents using unified search
    let torrents = [];
    try {
      console.log(`[UNIFIED_SEARCH] Searching TV show season pack: ${title}`);
      torrents = await searchMedia(title, 'tv', year, imdbId, 1, null);
      console.log(`[UNIFIED_SEARCH] Found ${torrents.length} season pack torrents for TV show`);
    } catch (torrentError) {
      console.error(`[UNIFIED_SEARCH] Failed to fetch torrents for ${title}:`, torrentError.message);
      torrents = [];
    }

    // Build response data
    const responseData = {
      id: parseInt(tvShowId),
      imdb_id: imdbId,
      title: title,
      year: year,
      rating: tvData.vote_average || 0,
      poster: tvData.poster_path ? `${TMDB_IMAGE_BASE}${tvData.poster_path}` : '',
      backdrop: tvData.backdrop_path ? `${TMDB_BACKDROP_BASE}${tvData.backdrop_path}` : '',
      plot: tvData.overview || 'No plot available.',
      genres: tvData.genres?.map(g => g.name) || [],
      yt_trailer_code: trailerCode,
      torrents: torrents,
      is_tv: true,
      type: 'tv',
      number_of_seasons: numberOfSeasons
    };

    const response = {
      success: true,
      data: responseData,
      source: 'TMDB + Apibay (Fresh Fetch)'
    };

    // STEP 4: Save to Prisma database for persistent caching
    try {
      await prisma.mediaCache.upsert({
        where: { tmdbId: tvShowId },
        update: {
          imdbId: imdbId || null,
          title: title,
          year: year || null,
          rating: responseData.rating,
          poster: responseData.poster || null,
          backdrop: responseData.backdrop || null,
          plot: responseData.plot || null,
          genres: JSON.stringify(responseData.genres),
          ytTrailerCode: trailerCode || null,
          torrents: JSON.stringify(torrents),
          numberOfSeasons: numberOfSeasons,
          lastUpdated: new Date()
        },
        create: {
          tmdbId: tvShowId,
          mediaType: 'tv',
          imdbId: imdbId || null,
          title: title,
          year: year || null,
          rating: responseData.rating,
          poster: responseData.poster || null,
          backdrop: responseData.backdrop || null,
          plot: responseData.plot || null,
          genres: JSON.stringify(responseData.genres),
          ytTrailerCode: trailerCode || null,
          torrents: JSON.stringify(torrents),
          numberOfSeasons: numberOfSeasons
        }
      });
      
      console.log(`[PRISMA] Successfully saved/updated TV show ${tvShowId} in database`);
    } catch (prismaError) {
      console.error(`[PRISMA ERROR] Failed to save to database:`, prismaError.message);
    }

    // STEP 5: Also update memory cache
    setCache(cacheKey, response);

    console.log(`[API] Successfully returning TV show: ${title}`);
    console.log(`[API] IMDb ID: ${imdbId}, Torrents: ${torrents.length}, Seasons: ${numberOfSeasons}`);

    res.json(response);
    
  } catch (error) {
    console.error('[API ERROR] Single TV show endpoint crashed:', error.message);
    console.error('[TMDB ERROR] Details:', error.response?.data || error.stack);
    
    res.status(404).json({
      success: false,
      message: 'TV show not found',
      error: error.message
    });
  }
});

// Get TV Show Season Episodes with Torrents
app.get('/api/tv/:id/season/:seasonNumber', async (req, res) => {
  const tvShowId = req.params.id;
  const seasonNumber = parseInt(req.params.seasonNumber);
  const cacheKey = `tv_${tvShowId}_season_${seasonNumber}`;
  
  console.log(`\n[API] GET /api/tv/${tvShowId}/season/${seasonNumber}`);
  
  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`[CACHE] HIT for TV season ${tvShowId} S${seasonNumber}`);
    return res.json(cached);
  }
  
  try {
    // Step 1: Get TV show details for the name
    console.log(`[TMDB] Fetching TV show details for ID: ${tvShowId}`);
    const tvShowResponse = await axios.get(`${TMDB_BASE_URL}/tv/${tvShowId}`, {
      params: { api_key: TMDB_API_KEY },
      timeout: 15000
    });
    
    if (!tvShowResponse.data) {
      return res.status(404).json({
        success: false,
        message: 'TV show not found'
      });
    }
    
    const tvShowName = tvShowResponse.data.name || tvShowResponse.data.original_name;
    const tvShowYear = tvShowResponse.data.first_air_date ? new Date(tvShowResponse.data.first_air_date).getFullYear() : '';
    console.log(`[TMDB] TV Show Name: ${tvShowName} (${tvShowYear})`);
    
    // Step 2: Get season details with episodes
    console.log(`[TMDB] Fetching season ${seasonNumber} episodes...`);
    const seasonResponse = await axios.get(`${TMDB_BASE_URL}/tv/${tvShowId}/season/${seasonNumber}`, {
      params: { api_key: TMDB_API_KEY },
      timeout: 15000
    });
    
    if (!seasonResponse.data || !seasonResponse.data.episodes) {
      return res.status(404).json({
        success: false,
        message: 'Season not found'
      });
    }
    
    const episodes = seasonResponse.data.episodes;
    console.log(`[TMDB] Found ${episodes.length} episodes in season ${seasonNumber}`);
    
    // Step 3: Sanitize TV show title once for all queries
    const sanitizedShowName = sanitizeTvTitle(tvShowName);
    const paddedSeason = String(seasonNumber).padStart(2, '0');
    console.log(`[SANITIZE] Original: "${tvShowName}" -> Sanitized: "${sanitizedShowName}"`);
    
    // Step 4: Fetch season pack as fallback (do this once for all episodes)
    let seasonPackTorrents = [];
    try {
      console.log(`[UNIFIED_SEARCH] Fetching season pack fallback for S${paddedSeason}`);
      seasonPackTorrents = await searchMedia(sanitizedShowName, 'tv', tvShowYear, null, seasonNumber, null);
      console.log(`[UNIFIED_SEARCH] Found ${seasonPackTorrents.length} season pack torrents as fallback`);
    } catch (seasonPackError) {
      console.error(`[UNIFIED_SEARCH] Failed to fetch season pack:`, seasonPackError.message);
      seasonPackTorrents = [];
    }
    
    // Step 5: Fetch torrents for each episode with staggered delays
    console.log(`[UNIFIED_SEARCH] Fetching torrents for ${episodes.length} episodes with 1s stagger...`);
    
    const episodesWithTorrents = await Promise.all(
      episodes.map(async (episode, index) => {
        // Stagger requests by 1 second each to avoid rate limiting
        const delay = index * 1000;
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const episodeNumber = episode.episode_number;
        const paddedEpisode = String(episodeNumber).padStart(2, '0');
        
        console.log(`[UNIFIED_SEARCH] Searching episode: S${paddedSeason}E${paddedEpisode}`);
        
        let episodeTorrents = [];
        try {
          episodeTorrents = await searchMedia(sanitizedShowName, 'tv', tvShowYear, null, seasonNumber, episodeNumber);
          console.log(`[UNIFIED_SEARCH] Found ${episodeTorrents.length} episode-specific torrents`);
          
          // FALLBACK: If no episode-specific torrents found, use season pack
          if (episodeTorrents.length === 0 && seasonPackTorrents.length > 0) {
            console.log(`[FALLBACK] No episode torrents found for E${paddedEpisode}, using season pack (${seasonPackTorrents.length} torrents)`);
            episodeTorrents = seasonPackTorrents.map(torrent => ({
              ...torrent,
              isSeasonPack: true,
              seasonPackNote: `Full Season ${seasonNumber} - Contains all episodes`
            }));
          }
          
        } catch (torrentError) {
          console.error(`[UNIFIED_SEARCH] Failed for episode E${paddedEpisode}:`, torrentError.message);
          
          // Even on error, try to use season pack as fallback
          if (seasonPackTorrents.length > 0) {
            console.log(`[FALLBACK] Error fetching episode torrents, using season pack (${seasonPackTorrents.length} torrents)`);
            episodeTorrents = seasonPackTorrents.map(torrent => ({
              ...torrent,
              isSeasonPack: true,
              seasonPackNote: `Full Season ${seasonNumber} - Contains all episodes`
            }));
          } else {
            episodeTorrents = [];
          }
        }
        
        return {
          id: episode.id,
          episode_number: episodeNumber,
          name: episode.name || `Episode ${episodeNumber}`,
          overview: episode.overview || 'No description available.',
          air_date: episode.air_date,
          still_path: episode.still_path ? `${TMDB_IMAGE_BASE}${episode.still_path}` : null,
          runtime: episode.runtime || null,
          vote_average: episode.vote_average || 0,
          torrents: episodeTorrents
        };
      })
    );
    
    // Statistics
    const episodesWithSpecificTorrents = episodesWithTorrents.filter(e => 
      e.torrents.length > 0 && !e.torrents[0]?.isSeasonPack
    ).length;
    const episodesWithSeasonPackFallback = episodesWithTorrents.filter(e => 
      e.torrents.length > 0 && e.torrents[0]?.isSeasonPack
    ).length;
    const episodesWithNoTorrents = episodesWithTorrents.filter(e => e.torrents.length === 0).length;
    
    console.log(`[STATS] Episode-specific torrents: ${episodesWithSpecificTorrents}`);
    console.log(`[STATS] Season pack fallback: ${episodesWithSeasonPackFallback}`);
    console.log(`[STATS] No torrents: ${episodesWithNoTorrents}`);
    
    const response = {
      success: true,
      data: {
        season_number: seasonNumber,
        episode_count: episodesWithTorrents.length,
        episodes: episodesWithTorrents,
        tv_show_name: tvShowName,
        tv_show_id: parseInt(tvShowId),
        sanitized_name: sanitizedShowName,
        statistics: {
          episodeSpecificTorrents: episodesWithSpecificTorrents,
          seasonPackFallback: episodesWithSeasonPackFallback,
          noTorrents: episodesWithNoTorrents
        }
      }
    };
    
    // Cache for 24 hours
    setCache(cacheKey, response, CACHE_TTL.SINGLE_MOVIE_WITH_TORRENTS);
    console.log(`[API] Successfully returning ${episodesWithTorrents.length} episodes for ${tvShowName} S${seasonNumber}`);
    
    res.json(response);
    
  } catch (error) {
    console.error('[API ERROR] TV season endpoint crashed:', error.message);
    console.error('[TMDB ERROR] Details:', error.response?.data || error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch TV season episodes',
      error: error.message
    });
  }
});

// Get movie by IMDb ID
app.get('/api/movies/imdb/:code', async (req, res) => {
  const imdbCode = req.params.code;
  console.log(`\n[API] GET /api/movies/imdb/${imdbCode}`);
  
  try {
    const result = await fetchMoviesWithTorrents('en', 1);
    
    if (result.data && result.data.length > 0) {
      const movie = result.data.find(m => m.imdb_id === imdbCode);
      
      if (movie) {
        return res.json({
          success: true,
          data: movie
        });
      }
    }

    res.status(404).json({
      success: false,
      message: 'Movie not found'
    });
  } catch (error) {
    console.error('[API ERROR] IMDb movie endpoint crashed:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Search endpoint for auto-suggest and search results page
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  const cacheKey = `search_${query}`.toLowerCase().replace(/[^a-z0-9]/g, '_');
  
  console.log(`\n[API] GET /api/search?q=${query}`);
  
  if (!query || query.trim().length === 0) {
    return res.json({
      success: false,
      message: 'Query parameter is required',
      data: []
    });
  }
  
  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    return res.json(cached);
  }
  
  try {
    console.log(`[TMDB] Searching for: ${query}`);
    
    const response = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
      params: {
        api_key: TMDB_API_KEY,
        query: query,
        page: 1
      },
      timeout: 10000
    });
    
    if (!response.data || !response.data.results) {
      console.log('[TMDB] No results found');
      return res.json({
        success: true,
        source: 'TMDB Search',
        data: []
      });
    }
    
    // Filter out people, only keep movies and TV shows
    const filteredResults = response.data.results
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .slice(0, 10)
      .map(item => {
        const title = item.title || item.name;
        const year = item.release_date 
          ? new Date(item.release_date).getFullYear() 
          : item.first_air_date 
          ? new Date(item.first_air_date).getFullYear() 
          : '';
        
        return {
          id: item.id,
          title: title,
          year: year,
          poster: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : '',
          backdrop: item.backdrop_path ? `${TMDB_BACKDROP_BASE}${item.backdrop_path}` : '',
          media_type: item.media_type,
          rating: item.vote_average || 0,
          plot: item.overview || 'No description available.',
          genres: []
        };
      });
    
    console.log(`[TMDB] Found ${filteredResults.length} results for "${query}"`);
    
    const result = {
      success: true,
      source: 'TMDB Search',
      data: filteredResults,
      total: filteredResults.length,
      query: query
    };
    
    // Cache search results for 1 hour
    setCache(cacheKey, result, 60 * 60 * 1000);
    
    res.json(result);
    
  } catch (error) {
    console.error('[API ERROR] Search endpoint crashed:', error.message);
    console.error('[TMDB ERROR] Details:', error.response?.data || error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: error.message,
      data: []
    });
  }
});

// Cache Management Endpoints

// Get comprehensive cache statistics
app.get('/api/cache/stats', (req, res) => {
  console.log('[API] GET /api/cache/stats');
  const stats = getCacheStats();
  
  res.json({
    success: true,
    cache: stats,
    ttlConfig: {
      singleMovieWithTorrents: '24 hours',
      singleMovieNoTorrents: '5 minutes',
      movieList: '6 hours',
      tvShowsList: '6 hours',
      torrentFound: '24 hours',
      torrentNotFound: '2 hours'
    },
    rateLimitProtection: {
      enabled: true,
      strategy: 'Dual-cache system with separate torrent cache',
      apibayRequestsSaved: stats.performance.apibayRequestsSaved,
      torrentCacheHitRate: stats.performance.torrentCacheHitRate
    }
  });
});

// Clear all caches
app.post('/api/cache/clear', (req, res) => {
  console.log('[API] POST /api/cache/clear');
  const result = clearAllCaches();
  res.json({
    success: true,
    message: `Cache cleared successfully`,
    details: {
      movieCacheCleared: result.movieSize,
      torrentCacheCleared: result.torrentSize,
      totalCleared: result.movieSize + result.torrentSize
    }
  });
});

// Clear only expired cache entries
app.post('/api/cache/cleanup', (req, res) => {
  console.log('[API] POST /api/cache/cleanup');
  const result = clearExpiredCaches();
  res.json({
    success: true,
    message: `Cleanup completed`,
    details: {
      expiredMoviesRemoved: result.movieExpired,
      expiredTorrentsRemoved: result.torrentExpired,
      totalRemoved: result.movieExpired + result.torrentExpired
    }
  });
});

// Server status
app.get('/api/status', (req, res) => {
  const cacheStats = getCacheStats();
  
  res.json({
    success: true,
    server: 'running',
    port: PORT,
    version: '11.0 - Dual-Cache System for High Traffic',
    cache: {
      enabled: true,
      strategy: 'Dual in-memory cache (movies + torrents)',
      movieCacheEntries: cacheStats.movieCache.totalEntries,
      torrentCacheEntries: cacheStats.torrentCache.totalEntries,
      totalCacheEntries: cacheStats.movieCache.totalEntries + cacheStats.torrentCache.totalEntries,
      performance: {
        movieCacheHitRate: cacheStats.performance.movieCacheHitRate,
        torrentCacheHitRate: cacheStats.performance.torrentCacheHitRate,
        apibayRequestsSaved: cacheStats.performance.apibayRequestsSaved
      },
      ttl: {
        singleMovieWithTorrents: '24h',
        singleMovieNoTorrents: '5min',
        lists: '6h',
        torrentFound: '24h',
        torrentNotFound: '2h'
      }
    },
    endpoints: {
      englishMovies: '/api/movies?page=1',
      tamilMovies: '/api/movies/tamil?page=1',
      tvShows: '/api/tv?page=1',
      singleMovie: '/api/movies/:id',
      cacheStats: '/api/cache/stats',
      cacheClear: '/api/cache/clear (POST)',
      cacheCleanup: '/api/cache/cleanup (POST)'
    },
    dataSources: {
      metadata: 'TMDB API',
      movieTorrents: 'YTS API (Primary) -> TorrentGalaxy/1337x (Fallback) -> Apibay (Final Fallback)',
      tvShowTorrents: 'EZTV API (Primary) -> TorrentGalaxy/1337x (Fallback) -> Apibay (Final Fallback)',
      fallbackScrapers: 'TorrentGalaxy, 1337x, ThePirateBay'
    },
    features: {
      tmdbApiConfigured: TMDB_API_KEY !== 'your_api_key_here',
      ytsApi: !isYtsUnavailable(),
      ytsCircuitBreakerActive: isYtsUnavailable(),
      eztvApi: true,
      multiSourceFallback: true,
      torrentGalaxy: enabledProviders.includes('TorrentGalaxy'),
      provider1337x: enabledProviders.includes('1337x'),
      thePirateBay: enabledProviders.includes('ThePirateBay'),
      apibayFallback: true,
      magnetLinks: true,
      englishMovies: true,
      tamilMovies: true,
      tvShows: true,
      dualCacheSystem: true,
      rateLimitProtection: true,
      automaticCacheCleanup: true,
      staggeredFetching: true,
      seasonPacks: true,
      unifiedSearch: true
    }
  });
});


// ============================================================================
// AUTOMATED REPORT & FIX BROKEN LINK ENDPOINT
// The frontend sends { movieId, title, year, imdbId, mediaType } and receives
// a fresh, highly-seeded magnet link that has already been saved to the DB.
// ============================================================================
app.post('/api/report-broken-link', async (req, res) => {
  const { movieId, title, year, imdbId, mediaType } = req.body || {};

  console.log(`\n[API] POST /api/report-broken-link`);
  console.log(`[BROKEN_LINK_REPORT] Report: "${title || 'n/a'}" (${year || 'n/a'}) | IMDb: ${imdbId || 'n/a'} | TMDB: ${movieId || 'n/a'}`);

  // STEP 1: Validate - we need something to search with
  if (!title && !imdbId) {
    return res.status(400).json({
      success: false,
      message: 'Please provide at least a title or an IMDb ID with your report.'
    });
  }

  try {
    // STEP 2: Search MULTIPLE providers simultaneously and pick the highest-seeded torrent
    const torrent = await findReplacementTorrent(title, year, imdbId, mediaType);

    if (!torrent) {
      console.log('[BROKEN_LINK_REPORT] No replacement torrent found');
      return res.status(404).json({
        success: false,
        message: 'No active torrent was found on any provider. Please try again later.'
      });
    }

    // STEP 3: Update the database with the new magnet link
    let dbRecord = null;
    try {
      dbRecord = await persistReplacementTorrent({ movieId, title, year, imdbId, mediaType, torrent });
    } catch (dbError) {
      console.error('[BROKEN_LINK_REPORT] Database update failed:', dbError.message);
    }

    console.log(`[BROKEN_LINK_REPORT] FIXED - new magnet from [${torrent.provider}] with ${torrent.seeders} seeders`);

    // STEP 4: Return the new magnet link to the frontend
    res.json({
      success: true,
      message: 'A new, highly-seeded magnet link was found and saved.',
      data: {
        magnet: torrent.url,
        torrent: torrent,
        dbUpdated: Boolean(dbRecord),
        dbRecordId: dbRecord?.id || null
      },
      source: 'Broken-Link Recovery (Multi-Provider)'
    });
  } catch (error) {
    console.error('[BROKEN_LINK_REPORT] Endpoint crashed:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to process the broken link report.',
      error: error.message
    });
  }
});

// SPA Fallback: Serve index.html for all non-API routes
// This must be AFTER all API routes
app.get('*', (req, res) => {
  // Only serve index.html for non-API routes
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

/**
 * Server Initialization
 */

// Start the Telegram CDN background worker (picks up queued movies, downloads
// torrents via WebTorrent, chunks + uploads to Telegram). Guarded: a broken
// CDN/torrent stack must never prevent the HTTP server from listening.
try {
  startWorker();
} catch (err) {
  console.error('[SERVER] CDN background worker failed to start (API server continues):', err && err.message);
}

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('MovieStream Backend Server v12.0');
  console.log('Multi-Source Fallback System');
  console.log('========================================');
  console.log(`[SERVER] Running on http://localhost:${PORT}`);
  console.log(`[SERVER] English Movies: http://localhost:${PORT}/api/movies`);
  console.log(`[SERVER] Tamil & Malayalam: http://localhost:${PORT}/api/movies/tamil`);
  console.log(`[SERVER] TV Shows: http://localhost:${PORT}/api/tv`);
  console.log(`[SERVER] Status: http://localhost:${PORT}/api/status`);
  console.log(`[SERVER] Cache Stats: http://localhost:${PORT}/api/cache/stats`);
  console.log('[SERVER] TMDB API:', TMDB_API_KEY !== 'your_api_key_here' ? 'Configured' : 'NOT CONFIGURED');
  console.log('[SERVER] Multi-Source Architecture:');
  console.log('  Movies: YTS API -> TorrentGalaxy/1337x -> Apibay');
  console.log('  TV Shows: EZTV API -> TorrentGalaxy/1337x -> Apibay');
  console.log(`[SERVER] Enabled Scrapers: ${enabledProviders.join(', ')}`);
  console.log('[SERVER] Cache Architecture: Dual in-memory (movieCache + torrentCache)');
  console.log('[SERVER] Rate Limit Protection: Torrent cache prevents duplicate API calls');
  console.log('[SERVER] Auto Cleanup: Every 30 minutes');
  console.log('[SERVER] Features: Movies, TV Shows, Season Packs, Unified Search');
  console.log('[SERVER] Streaming: Vidsrc (Movies use IMDb ID, TV uses TMDB ID)');
  console.log('========================================\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Server closing...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[SHUTDOWN] Server closing...');
  process.exit(0);
});