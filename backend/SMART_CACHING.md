# Smart Caching System with Adaptive TTL

## Problem Solved

Previously, when Apibay timed out or failed for a movie, the empty torrent array `torrents: []` was cached for 24 hours. This meant users would permanently see "Links not available" for that movie until the cache expired, even if Apibay recovered or new torrents became available.

## Solution: Adaptive TTL Based on Torrent Availability

The caching system now uses intelligent TTL (Time-To-Live) rules that adapt based on whether torrents were found or not.

---

## Cache TTL Rules

### Single Movies (`/api/movies/:id`)

**Scenario 1: Torrents Found**
- **TTL:** 24 hours
- **Reason:** Torrents are stable. No need to re-fetch frequently.
- **Example:** Movie has 3 torrent links → cached for 24 hours

**Scenario 2: No Torrents Found**
- **TTL:** 5 minutes
- **Reason:** Apibay might have timed out or torrents not yet indexed. Retry soon.
- **Example:** Movie has 0 torrent links → cached for only 5 minutes

### Movie Lists (`/api/movies`, `/api/movies/tamil`)

**TTL:** 1 hour (reduced from 6 hours)
- **Reason:** Balances server load with content freshness
- **Benefit:** New torrents appear faster on home page

### TV Show Lists (`/api/tv`)

**TTL:** 1 hour
- **Reason:** Same as movie lists - balanced freshness

---

## How It Works

### Cache Key Generation

```javascript
// Single movie
const cacheKey = `movie_${movieId}`;  // e.g., "movie_123"

// Movie lists
const cacheKey = `movies_en_page${page}`;  // e.g., "movies_en_page1"
const cacheKey = `tamil_page${page}`;      // e.g., "tamil_page1"

// TV shows
const cacheKey = `tv_page${page}`;         // e.g., "tv_page1"
```

### Smart TTL Logic

```javascript
function setCache(key, data, customTTL = null) {
  let ttl = customTTL;
  
  if (!customTTL) {
    if (key.startsWith('movie_')) {
      // Single movie: check if it has torrents
      const hasTorrents = data?.data?.torrents && data.data.torrents.length > 0;
      ttl = hasTorrents ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000;
      // 24 hours vs 5 minutes
    } else if (key.startsWith('movies_') || key.startsWith('tamil_')) {
      ttl = 1 * 60 * 60 * 1000;  // 1 hour
    } else if (key.startsWith('tv_')) {
      ttl = 1 * 60 * 60 * 1000;  // 1 hour
    }
  }
  
  cache.set(key, {
    data: data,
    expiresAt: Date.now() + ttl,
    cachedAt: new Date().toISOString()
  });
}
```

### Cache Retrieval

```javascript
function getFromCache(key) {
  const cached = cache.get(key);
  if (!cached) return null;
  
  const now = Date.now();
  if (now > cached.expiresAt) {
    cache.delete(key);  // Auto-cleanup expired entries
    return null;
  }
  
  return cached.data;
}
```

---

## API Flow Examples

### Example 1: Movie with Torrents

**Request:** `GET /api/movies/550` (Fight Club)

1. Check cache: `movie_550` → MISS
2. Fetch from TMDB + Apibay
3. Apibay returns 3 torrents
4. Cache result with **24h TTL**
5. Return to user

**Subsequent Request (within 24 hours):**
1. Check cache: `movie_550` → HIT
2. Return cached data immediately (no API calls)

### Example 2: Movie without Torrents

**Request:** `GET /api/movies/12345` (Newly released movie)

1. Check cache: `movie_12345` → MISS
2. Fetch from TMDB + Apibay
3. Apibay times out or returns empty array
4. Cache result with **5min TTL** (not 24h!)
5. Return to user with empty torrents

**Subsequent Request (after 3 minutes):**
1. Check cache: `movie_12345` → HIT (still within 5min)
2. Return cached empty result

**Subsequent Request (after 6 minutes):**
1. Check cache: `movie_12345` → MISS (expired)
2. Re-fetch from Apibay (torrents might be available now)
3. If found, cache with 24h TTL
4. If still empty, cache with 5min TTL again

### Example 3: Movie List

**Request:** `GET /api/movies?page=1`

1. Check cache: `movies_en_page1` → MISS
2. Fetch 20 movies from TMDB + Apibay
3. Cache entire list with **1h TTL**
4. Return to user

**Subsequent Request (within 1 hour):**
1. Check cache: `movies_en_page1` → HIT
2. Return cached list immediately

---

## Cache Management Endpoints

### Get Cache Statistics

```bash
GET /api/cache/stats
```

**Response:**
```json
{
  "success": true,
  "cache": {
    "totalEntries": 15,
    "entries": [
      {
        "key": "movie_550",
        "cachedAt": "2026-08-26T01:30:00.000Z",
        "ttlRemaining": "86340s",
        "hasTorrents": true
      },
      {
        "key": "movie_12345",
        "cachedAt": "2026-08-26T01:35:00.000Z",
        "ttlRemaining": "285s",
        "hasTorrents": false
      }
    ]
  },
  "ttlConfig": {
    "singleMovieWithTorrents": "24 hours",
    "singleMovieNoTorrents": "5 minutes",
    "movieList": "1 hour",
    "tvShowsList": "1 hour"
  }
}
```

### Clear Cache (Force Refresh All)

```bash
POST /api/cache/clear
```

**Response:**
```json
{
  "success": true,
  "message": "Cache cleared. Removed 15 entries."
}
```

**Use Case:** If Apibay was down for a while and many movies cached with empty torrents, you can clear cache to force re-fetch all.

---

## Benefits

### 1. Prevents Permanent "No Links" State
- Movies without torrents are retried every 5 minutes
- If Apibay recovers, links appear within 5 minutes

### 2. Reduces Apibay Load
- Movies with torrents cached for 24 hours (fewer requests)
- Movies without torrents still wait 5 minutes between retries (not spamming)

### 3. Faster Content Updates
- Movie lists refresh every 1 hour (vs 6 hours before)
- New torrents appear sooner on homepage

### 4. Smart Resource Usage
- Memory-efficient: expired entries auto-deleted on access
- No database required: pure in-memory Map

### 5. Transparent Operation
- Console logs show cache hits/misses
- `/api/cache/stats` reveals what's cached and for how long

---

## Console Log Examples

### Cache MISS (First Request)

```
[API] GET /api/movies/550
[CACHE] MISS: movie_550 (not in cache)
[TMDB] Fetching movie details for ID: 550
[APIBAY] Searching torrents for: "Fight Club" (1999)
[APIBAY] Found 3 torrents for single movie
[CACHE] SET: movie_550 with 24h TTL (has torrents)
```

### Cache HIT (Subsequent Request)

```
[API] GET /api/movies/550
[CACHE] HIT: movie_550 (TTL: 85320s)
```

### Cache Expired

```
[API] GET /api/movies/12345
[CACHE] Expired and removed: movie_12345
[TMDB] Fetching movie details for ID: 12345
[APIBAY] Timeout for single movie "New Movie" after 10000ms
[CACHE] SET: movie_12345 with 5min TTL (no torrents)
```

---

## Configuration

### Adjust TTL Values

Edit `backend/server.js`:

```javascript
const CACHE_TTL = {
  SINGLE_MOVIE_WITH_TORRENTS: 24 * 60 * 60 * 1000, // 24 hours
  SINGLE_MOVIE_NO_TORRENTS: 5 * 60 * 1000,          // 5 minutes
  MOVIE_LIST: 1 * 60 * 60 * 1000,                   // 1 hour
  TV_SHOWS_LIST: 1 * 60 * 60 * 1000                 // 1 hour
};
```

**Example Adjustments:**

- **More aggressive retries:** Change `SINGLE_MOVIE_NO_TORRENTS` to `2 * 60 * 1000` (2 minutes)
- **Longer list cache:** Change `MOVIE_LIST` to `2 * 60 * 60 * 1000` (2 hours)
- **Shorter single movie cache:** Change `SINGLE_MOVIE_WITH_TORRENTS` to `12 * 60 * 60 * 1000` (12 hours)

---

## Technical Implementation

### Data Structure

```javascript
// Map-based cache
const cache = new Map();

// Cache entry structure
{
  data: { /* API response */ },
  expiresAt: 1724635800000,      // Unix timestamp
  cachedAt: "2026-08-26T01:30:00.000Z"
}
```

### Key Methods

1. **`getFromCache(key)`** - Retrieve with auto-expiration
2. **`setCache(key, data, customTTL)`** - Store with smart TTL
3. **`clearCache()`** - Remove all entries
4. **`getCacheStats()`** - Inspect cache state

### Memory Management

- Cache size grows with unique pages/movies accessed
- Expired entries auto-deleted on access (lazy cleanup)
- No manual cleanup needed (Map is efficient for small datasets)
- For production with high traffic, consider:
  - Periodic cache sweep (delete all expired every N minutes)
  - Max cache size limit (LRU eviction)
  - External cache (Redis) for multi-server deployments

---

## Testing the Cache

### Test 1: Verify Smart TTL

```bash
# Visit movie with torrents
curl http://localhost:5000/api/movies/550

# Check cache (should show 24h TTL)
curl http://localhost:5000/api/cache/stats

# Visit movie without torrents (new release)
curl http://localhost:5000/api/movies/999999

# Check cache (should show 5min TTL)
curl http://localhost:5000/api/cache/stats
```

### Test 2: Verify Auto-Expiration

```bash
# Visit a movie
curl http://localhost:5000/api/movies/550

# Wait 2 minutes, visit again (should hit cache)
curl http://localhost:5000/api/movies/550

# For 5min TTL, wait 6 minutes, visit again (should re-fetch)
curl http://localhost:5000/api/movies/999999
```

### Test 3: Manual Cache Clear

```bash
# Clear all cache
curl -X POST http://localhost:5000/api/cache/clear

# Verify empty
curl http://localhost:5000/api/cache/stats
```

---

## Status: Production Ready

✅ Smart TTL prevents permanent "no links" state  
✅ Reduces Apibay load while maintaining freshness  
✅ Auto-expiration and lazy cleanup  
✅ Cache management endpoints for debugging  
✅ Console logging for transparency  
✅ Zero dependencies (uses native Map)  
✅ Memory-efficient for typical use cases  

**Deployed in:** Backend Server v10.0  
**Date:** August 26, 2026
