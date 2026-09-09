// ==============================================================================
// Local DB first → TMDB fallback + Auto-save
//
// Reusable utility that ALL movie-list routes use:
//   1. Check ListCache (persistent Prisma cache) → instant if fresh
//   2. If stale/missing → call the provided fetchFn (TMDB or TMDB+torrents)
//   3. Upsert each movie into the Movie table (enriches the CDN catalog)
//   4. Save the full response to ListCache (survives server restarts)
//   5. Return the data
// ==============================================================================
import axios from 'axios';
import prisma from './prisma/client.js';

const DEFAULT_TTL_HOURS = 6;

/**
 * Reusable list-caching utility. Wraps ANY fetch function with a persistent
 * Prisma cache layer. Use it for /popular, /trending, /category/:id, etc.
 *
 * @param {{ cacheKey: string, fetchFn: () => Promise<object>, ttlHours?: number }} opts
 *   cacheKey  — unique identifier, e.g. "popular_page1", "trending_week1"
 *   fetchFn   — async function that fetches the list when cache is stale
 *               (e.g. () => fetchMoviesWithTorrents('en', 1))
 *   ttlHours  — how long the cached data stays fresh (default 6h)
 *
 * @returns {Promise<{ success: boolean, source: string, data: Array }>}
 */
export async function fetchAndCacheMovies({ cacheKey, fetchFn, ttlHours = DEFAULT_TTL_HOURS }) {
  // ---- STEP 1: Check the persistent Prisma ListCache
  const cached = await prisma.listCache
    .findUnique({ where: { cacheKey } })
    .catch(() => null);

  if (cached && cached.expiresAt > new Date()) {
    console.log(`[LIST_CACHE] HIT: ${cacheKey} (expires ${cached.expiresAt.toISOString()})`);
    const data = JSON.parse(cached.data);
    return { ...data, source: 'Prisma Cache (instant)' };
  }

  // ---- STEP 2: Cache miss or stale — fetch from the source (TMDB)
  console.log(`[LIST_CACHE] MISS: ${cacheKey} — fetching from TMDB`);
  const fresh = await fetchFn();

  if (!fresh?.data || !Array.isArray(fresh.data) || fresh.data.length === 0) {
    console.warn(`[LIST_CACHE] Skipping cache save — empty or invalid data for ${cacheKey}`);
    return fresh;
  }

  // ---- STEP 3: Upsert each movie into the Movie table (enriches the catalog)
  upsertMoviesFromList(fresh.data).catch((err) =>
    console.error(`[LIST_CACHE] Movie upsert failed (non-fatal) for ${cacheKey}:`, err.message)
  );

  // ---- STEP 4: Save the full response to ListCache (persistent)
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await prisma.listCache
    .upsert({
      where: { cacheKey },
      update: { data: JSON.stringify(fresh), lastUpdated: new Date(), expiresAt },
      create: { cacheKey, data: JSON.stringify(fresh), lastUpdated: new Date(), expiresAt },
    })
    .catch((err) =>
      console.error(`[LIST_CACHE] Cache save failed for ${cacheKey}:`, err.message)
    );

  console.log(`[LIST_CACHE] SAVED: ${cacheKey} (${fresh.data.length} items, TTL ${ttlHours}h)`);
  return { ...fresh, source: 'TMDB (fresh fetch)' };
}

/**
 * Upsert TMDB movie metadata into the Movie table (matched by tmdbId).
 * This enriches the CDN catalog — the download pipeline can later attach
 * magnetLink and chunks to these records.
 */
async function upsertMoviesFromList(movies) {
  for (const m of movies) {
    if (!m?.id) continue; // skip entries without a TMDB id

    const genreIds = m.genre_ids ? JSON.stringify(m.genre_ids) : null;

    await prisma.movie.upsert({
      where: { tmdbId: m.id },
      update: {
        title: m.title || undefined,
        posterPath: m.poster || undefined,
        backdropPath: m.backdrop || undefined,
        voteAverage: m.rating || undefined,
        releaseDate: m.year ? String(m.year) : undefined,
        popularity: m.popularity || undefined,
        genreIds: genreIds || undefined,
      },
      create: {
        tmdbId: m.id,
        title: m.title || 'Unknown',
        posterPath: m.poster || null,
        backdropPath: m.backdrop || null,
        voteAverage: m.rating || null,
        releaseDate: m.year ? String(m.year) : null,
        popularity: m.popularity || null,
        genreIds,
        status: 'pending',
      },
    });
  }
}

/**
 * Simple TMDB fetcher for browse-only routes (popular, trending, category).
 * Returns movies in the same shape as fetchMoviesWithTorrents but WITHOUT
 * torrent enrichment (fast — no Apibay/YTS calls). Torrent data is added
 * on-demand via the magnet queue when the user clicks download.
 */
export function createTMDBListFetcher(tmdbPath, baseParams = {}, tmdbConfig = {}) {
  const { TMDB_BASE_URL, TMDB_API_KEY, TMDB_IMAGE_BASE, TMDB_BACKDROP_BASE } = tmdbConfig;

  return async (page = 1) => {
    const response = await axios.get(`${TMDB_BASE_URL}${tmdbPath}`, {
      params: { api_key: TMDB_API_KEY, page, ...baseParams },
      timeout: 15000,
    });

    if (!response.data?.results || !Array.isArray(response.data.results)) {
      return { success: true, source: 'TMDB', data: [] };
    }

    const movies = response.data.results.map((m) => ({
      id: m.id,
      title: m.title || m.name || 'Untitled',
      poster: m.poster_path ? `${TMDB_IMAGE_BASE}${m.poster_path}` : '',
      backdrop: m.backdrop_path ? `${TMDB_BACKDROP_BASE}${m.backdrop_path}` : '',
      rating: m.vote_average || 0,
      year: (m.release_date || m.first_air_date || '').split('-')[0],
      popularity: m.popularity || 0,
      genre_ids: m.genre_ids || [],
      torrents: [], // enriched on-demand via the magnet queue
    }));

    return { success: true, source: 'TMDB', data: movies };
  };
}