import axios from 'axios';
import prisma from '../prisma/client.js';

// Configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY || '8a68f9cbe2f314d0cdab27cc8d58216b';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/original';

// Public Movie APIs / Mirrors
const YTS_BASE_URLS = [
  'https://yts.mx/api/v2',
  'https://yts.am/api/v2',
  'https://yts.pm/api/v2',
  'https://yts.rs/api/v2',
  'https://yts.lt/api/v2'
];

// Automation Run State
let lastSyncResult = {
  lastRun: null,
  status: 'idle', // 'idle' | 'running' | 'success' | 'error'
  moviesProcessed: 0,
  moviesSaved: 0,
  linksSaved: 0,
  sourceUsed: null,
  errors: [],
  durationMs: 0
};

let isSyncRunning = false;

/**
 * 1. FETCH API SERVICE:
 * Fetch latest movies from public Movie APIs (YTS API list_movies.json).
 * Automatically tries available mirrors and falls back gracefully to TMDB + Torrent scrapers
 * if all YTS mirrors are blocked by local ISP / DNS.
 *
 * @param {object} options
 * @param {number} options.limit - Number of movies to fetch (default: 50)
 * @param {number} options.page - Page number to fetch (default: 1)
 * @param {string} options.sortBy - Sort criteria: 'date_added', 'download_count', 'rating'
 * @returns {Promise<{ movies: Array, source: string }>}
 */
export async function fetchLatestMovies({ limit = 50, page = 1, sortBy = 'date_added' } = {}) {
  console.log(`\n[MOVIE_AUTOMATION] Fetching latest movies (limit: ${limit}, page: ${page}, sort: ${sortBy})...`);

  // Try each YTS API mirror in sequence
  for (const baseUrl of YTS_BASE_URLS) {
    try {
      console.log(`[MOVIE_AUTOMATION] Calling YTS API: ${baseUrl}/list_movies.json`);
      const response = await axios.get(`${baseUrl}/list_movies.json`, {
        params: {
          limit,
          page,
          sort_by: sortBy,
          order_by: 'desc',
          with_rt_ratings: true
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (response.data?.status === 'ok' && response.data?.data?.movies?.length > 0) {
        const movies = response.data.data.movies;
        console.log(`[MOVIE_AUTOMATION] Successfully fetched ${movies.length} movies from YTS (${baseUrl})`);
        return { movies, source: 'YTS API' };
      }
    } catch (err) {
      console.warn(`[MOVIE_AUTOMATION] YTS mirror ${baseUrl} unreachable: ${err.message}`);
    }
  }

  // Fallback: If YTS is network-blocked on the host, fetch trending/popular from TMDB
  console.warn('[MOVIE_AUTOMATION] All YTS mirrors unreachable. Engaging TMDB fallback fetcher...');
  try {
    const tmdbResponse = await axios.get(`${TMDB_BASE_URL}/movie/now_playing`, {
      params: {
        api_key: TMDB_API_KEY,
        page,
        language: 'en-US'
      },
      timeout: 10000
    });

    const tmdbResults = tmdbResponse.data?.results || [];
    console.log(`[MOVIE_AUTOMATION] Fallback: Fetched ${tmdbResults.length} movies from TMDB now_playing`);

    // Transform TMDB format to compatible movie structure
    const fallbackMovies = tmdbResults.map(m => ({
      id: m.id,
      tmdb_id: m.id,
      title: m.title,
      year: m.release_date ? parseInt(m.release_date.slice(0, 4), 10) : null,
      rating: m.vote_average,
      poster_path: m.poster_path,
      backdrop_path: m.backdrop_path,
      release_date: m.release_date,
      summary: m.overview,
      torrents: [] // will be resolved or populated
    }));

    return { movies: fallbackMovies, source: 'TMDB Fallback' };
  } catch (tmdbErr) {
    console.error('[MOVIE_AUTOMATION] Both YTS and TMDB fallbacks failed:', tmdbErr.message);
    throw new Error(`Failed to fetch movies from any provider: ${tmdbErr.message}`);
  }
}

/**
 * 2. FORMAT LINKS:
 * Extract available qualities (720p, 1080p, 2160p/4K, 3D, etc.) and construct
 * standardized Direct Download Link (DDL) and torrent objects.
 *
 * @param {Array} torrents - Raw torrents array from YTS / tracker
 * @param {object} movie - Movie metadata object
 * @returns {Array<{ provider: string, quality: string, url: string, size: string }>}
 */
export function formatMovieLinks(torrents = [], movie = {}) {
  if (!Array.isArray(torrents) || torrents.length === 0) {
    return [];
  }

  const links = [];
  const titleLong = movie.title_long || `${movie.title || 'Movie'} (${movie.year || ''})`;

  // Standard trackers for magnet fallback construction
  const trackers = [
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.coppersurfer.tk:6969',
    'udp://glotorrents.pw:6969/announce',
    'udp://tracker.opentrackr.org:1337/announce'
  ].map(t => `&tr=${encodeURIComponent(t)}`).join('');

  for (const t of torrents) {
    // Quality tag (normalize to e.g. 720p, 1080p, 2160p, 4K)
    let quality = (t.quality || '1080p').toUpperCase();
    if (quality === '2160P') quality = '4K (2160p)';
    else if (quality === '1080P') quality = '1080p Full HD';
    else if (quality === '720P') quality = '720p HD';

    const size = t.size || (t.size_bytes ? `${(t.size_bytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : null);

    // Primary direct .torrent download URL provided by YTS
    if (t.url) {
      links.push({
        provider: 'YTS Direct',
        quality: quality,
        url: t.url,
        size: size
      });
    }

    // Secondary Magnet Link (instant streaming & fallback)
    if (t.hash) {
      const magnetUri = `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(titleLong)}${trackers}`;
      links.push({
        provider: 'Torrent Magnet',
        quality: quality,
        url: magnetUri,
        size: size
      });
    }
  }

  // Deduplicate and prioritize links: keep unique provider + quality pairs
  const seen = new Set();
  const deduped = [];
  for (const link of links) {
    const key = `${link.provider}_${link.quality}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(link);
    }
  }

  // Sort: 4K first, then 1080p, then 720p
  return deduped.sort((a, b) => {
    const rank = q => (q.includes('4K') || q.includes('2160') ? 3 : q.includes('1080') ? 2 : q.includes('720') ? 1 : 0);
    return rank(b.quality) - rank(a.quality);
  });
}

/**
 * Resolve TMDB ID and enriched metadata using IMDb code or movie title
 */
async function resolveTMDBMetadata(movie) {
  try {
    // Strategy 1: Find by IMDb Code (Most accurate, e.g. "tt0111161")
    if (movie.imdb_code) {
      const findRes = await axios.get(`${TMDB_BASE_URL}/find/${movie.imdb_code}`, {
        params: {
          api_key: TMDB_API_KEY,
          external_source: 'imdb_id'
        },
        timeout: 5000
      });

      const match = findRes.data?.movie_results?.[0];
      if (match?.id) {
        return {
          tmdbId: match.id,
          title: match.title || movie.title,
          posterPath: match.poster_path ? `${TMDB_IMAGE_BASE}${match.poster_path}` : movie.large_cover_image || movie.medium_cover_image || null,
          backdropPath: match.backdrop_path ? `${TMDB_BACKDROP_BASE}${match.backdrop_path}` : movie.background_image_original || null,
          voteAverage: match.vote_average || movie.rating || null,
          releaseDate: match.release_date || (movie.year ? String(movie.year) : null),
          overview: match.overview || movie.summary || null,
          genreIds: match.genre_ids ? JSON.stringify(match.genre_ids) : null
        };
      }
    }

    // Strategy 2: If tmdb_id was already supplied (TMDB fallback source)
    if (movie.tmdb_id) {
      return {
        tmdbId: movie.tmdb_id,
        title: movie.title,
        posterPath: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
        backdropPath: movie.backdrop_path ? `${TMDB_BACKDROP_BASE}${movie.backdrop_path}` : null,
        voteAverage: movie.rating || null,
        releaseDate: movie.release_date || (movie.year ? String(movie.year) : null),
        overview: movie.summary || null,
        genreIds: null
      };
    }

    // Strategy 3: Search TMDB by title + year
    if (movie.title) {
      const searchRes = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
        params: {
          api_key: TMDB_API_KEY,
          query: movie.title,
          year: movie.year || undefined
        },
        timeout: 5000
      });

      const match = searchRes.data?.results?.[0];
      if (match?.id) {
        return {
          tmdbId: match.id,
          title: match.title,
          posterPath: match.poster_path ? `${TMDB_IMAGE_BASE}${match.poster_path}` : movie.large_cover_image || null,
          backdropPath: match.backdrop_path ? `${TMDB_BACKDROP_BASE}${match.backdrop_path}` : movie.background_image_original || null,
          voteAverage: match.vote_average || movie.rating || null,
          releaseDate: match.release_date || (movie.year ? String(movie.year) : null),
          overview: match.overview || movie.summary || null,
          genreIds: match.genre_ids ? JSON.stringify(match.genre_ids) : null
        };
      }
    }
  } catch (err) {
    console.warn(`[MOVIE_AUTOMATION] TMDB metadata lookup error for "${movie.title}":`, err.message);
  }

  // Default fallback if TMDB lookup fails
  return {
    tmdbId: typeof movie.id === 'number' ? movie.id : null,
    title: movie.title || 'Unknown Title',
    posterPath: movie.large_cover_image || movie.medium_cover_image || null,
    backdropPath: movie.background_image_original || null,
    voteAverage: movie.rating || null,
    releaseDate: movie.year ? String(movie.year) : null,
    overview: movie.summary || null,
    genreIds: null
  };
}

/**
 * 3. DATABASE INSERTION (PRISMA):
 * Insert or update a movie and its extracted download links into:
 *   - Movie table (upsert by tmdbId, with download_links JSON array)
 *   - DownloadLink table (relational records with provider, quality, url, size)
 *   - MediaCache table (sync cached response for /api/movies/:id)
 *
 * @param {object} movieData - Movie metadata
 * @param {Array} formattedLinks - Extracted download links
 * @param {Array} rawTorrents - Raw torrent list
 * @returns {Promise<{ movie: object, linksCount: number }>}
 */
export async function saveMovieWithLinks(movieData, formattedLinks = [], rawTorrents = []) {
  // Resolve enriched TMDB metadata
  const meta = await resolveTMDBMetadata(movieData);
  const tmdbIdInt = meta.tmdbId ? parseInt(meta.tmdbId, 10) : null;
  const linksJson = JSON.stringify(formattedLinks);

  // 1. Upsert Movie record
  let savedMovie = null;
  if (tmdbIdInt) {
    savedMovie = await prisma.movie.upsert({
      where: { tmdbId: tmdbIdInt },
      update: {
        title: meta.title,
        posterPath: meta.posterPath || undefined,
        backdropPath: meta.backdropPath || undefined,
        releaseDate: meta.releaseDate || undefined,
        voteAverage: meta.voteAverage || undefined,
        download_links: linksJson,
        status: 'ready'
      },
      create: {
        tmdbId: tmdbIdInt,
        title: meta.title,
        posterPath: meta.posterPath,
        backdropPath: meta.backdropPath,
        releaseDate: meta.releaseDate,
        voteAverage: meta.voteAverage,
        download_links: linksJson,
        status: 'ready'
      }
    });
  } else {
    // If no tmdbId, create or find by title
    const existing = await prisma.movie.findFirst({
      where: { title: meta.title }
    });

    if (existing) {
      savedMovie = await prisma.movie.update({
        where: { id: existing.id },
        data: {
          download_links: linksJson,
          status: 'ready'
        }
      });
    } else {
      savedMovie = await prisma.movie.create({
        data: {
          title: meta.title,
          posterPath: meta.posterPath,
          backdropPath: meta.backdropPath,
          releaseDate: meta.releaseDate,
          voteAverage: meta.voteAverage,
          download_links: linksJson,
          status: 'ready'
        }
      });
    }
  }

  // 2. Map and save links into the DownloadLink relational table
  if (formattedLinks.length > 0) {
    // Clean up existing links for this movie to avoid duplicates
    await prisma.downloadLink.deleteMany({
      where: {
        OR: [
          { movieId: savedMovie.id },
          ...(tmdbIdInt ? [{ tmdbId: String(tmdbIdInt) }] : [])
        ]
      }
    });

    // Bulk insert new download links
    for (const link of formattedLinks) {
      if (link.url) {
        await prisma.downloadLink.create({
          data: {
            movieId: savedMovie.id,
            tmdbId: tmdbIdInt ? String(tmdbIdInt) : null,
            provider: link.provider || 'Direct',
            quality: link.quality || '1080p',
            url: link.url,
            size: link.size || null
          }
        });
      }
    }
  }

  // 3. Synchronize MediaCache (so /api/movies/:id immediately serves the links)
  if (tmdbIdInt) {
    const torrentsJson = JSON.stringify(rawTorrents || []);
    await prisma.mediaCache.upsert({
      where: { tmdbId: String(tmdbIdInt) },
      update: {
        title: meta.title,
        download_links: linksJson,
        torrents: rawTorrents.length > 0 ? torrentsJson : undefined,
        lastUpdated: new Date()
      },
      create: {
        tmdbId: String(tmdbIdInt),
        mediaType: 'movie',
        imdbId: movieData.imdb_code || null,
        title: meta.title,
        year: meta.releaseDate ? meta.releaseDate.slice(0, 4) : null,
        rating: meta.voteAverage,
        poster: meta.posterPath,
        backdrop: meta.backdropPath,
        plot: meta.overview,
        download_links: linksJson,
        torrents: torrentsJson,
        lastUpdated: new Date()
      }
    }).catch(err => {
      console.warn(`[MOVIE_AUTOMATION] MediaCache sync skipped for TMDB ${tmdbIdInt}:`, err.message);
    });
  }

  return { movie: savedMovie, linksCount: formattedLinks.length };
}

/**
 * 4. COMPLETE AUTOMATION PIPELINE RUNNER:
 * Fetches the latest movies, extracts all qualities, and stores them in Prisma.
 *
 * @param {object} options
 * @returns {Promise<object>} Run summary statistics
 */
export async function runMovieAutomation(options = {}) {
  if (isSyncRunning) {
    console.log('[MOVIE_AUTOMATION] Sync is already in progress, skipping duplicate invocation.');
    return { ...lastSyncResult, message: 'Sync already in progress' };
  }

  isSyncRunning = true;
  const startTime = Date.now();
  lastSyncResult = {
    lastRun: new Date().toISOString(),
    status: 'running',
    moviesProcessed: 0,
    moviesSaved: 0,
    linksSaved: 0,
    sourceUsed: null,
    errors: [],
    durationMs: 0
  };

  console.log('====================================================');
  console.log(`[MOVIE_AUTOMATION] Starting Movie Automation Job at ${lastSyncResult.lastRun}`);
  console.log('====================================================');

  try {
    // STEP 1: Fetch latest movies from API
    const { movies, source } = await fetchLatestMovies(options);
    lastSyncResult.sourceUsed = source;
    lastSyncResult.moviesProcessed = movies.length;

    console.log(`[MOVIE_AUTOMATION] Processing ${movies.length} movies from ${source}...`);

    let savedCount = 0;
    let totalLinksSaved = 0;

    // STEP 2 & 3: Format links and insert into database
    for (let i = 0; i < movies.length; i++) {
      const movie = movies[i];
      try {
        // Format available qualities & URLs
        const formattedLinks = formatMovieLinks(movie.torrents, movie);

        // Save into Prisma (Movie + DownloadLink + MediaCache)
        const result = await saveMovieWithLinks(movie, formattedLinks, movie.torrents || []);

        savedCount++;
        totalLinksSaved += result.linksCount;

        console.log(`[MOVIE_AUTOMATION] [${i + 1}/${movies.length}] Saved: "${result.movie.title}" with ${result.linksCount} links`);
      } catch (itemErr) {
        console.error(`[MOVIE_AUTOMATION] Error saving movie "${movie?.title || 'Unknown'}":`, itemErr.message);
        lastSyncResult.errors.push({
          title: movie?.title || 'Unknown',
          error: itemErr.message
        });
      }
    }

    lastSyncResult.status = 'success';
    lastSyncResult.moviesSaved = savedCount;
    lastSyncResult.linksSaved = totalLinksSaved;
    lastSyncResult.durationMs = Date.now() - startTime;

    console.log('====================================================');
    console.log(`[MOVIE_AUTOMATION] Sync completed successfully in ${lastSyncResult.durationMs}ms`);
    console.log(`[MOVIE_AUTOMATION] Movies saved: ${savedCount}, Total links saved: ${totalLinksSaved}`);
    console.log('====================================================\n');

    return lastSyncResult;
  } catch (error) {
    lastSyncResult.status = 'error';
    lastSyncResult.durationMs = Date.now() - startTime;
    lastSyncResult.errors.push({ global: error.message });
    console.error('[MOVIE_AUTOMATION] Job failed with error:', error);
    return lastSyncResult;
  } finally {
    isSyncRunning = false;
  }
}

/**
 * Get the current automation runner status and last run stats
 */
export function getAutomationStatus() {
  return {
    ...lastSyncResult,
    isSyncRunning
  };
}
