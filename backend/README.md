# MovieStream Backend API

**Version 11.0 - Dual-Cache System for High Traffic**

Automated Node.js backend powered by TMDB for metadata and Apibay for torrents. Features a robust dual-cache architecture designed to prevent rate limiting during traffic spikes.

## 🚀 Features

- **Dual-Cache System**: Separate caches for API responses and torrent searches prevent rate limiting
- **Rate Limit Protection**: 90-99% reduction in Apibay API calls during traffic spikes
- **Real-time Torrent Fetching**: On-demand torrent search from Apibay (The Pirate Bay)
- **TMDB Integration**: Rich movie metadata with posters, ratings, and trailers
- **Smart TTL Strategy**: Adaptive cache expiration based on content availability
- **Automatic Cleanup**: Memory-efficient with auto-expiring cache entries
- **Performance Monitoring**: Built-in cache statistics and hit rate tracking
- **Zero External Dependencies**: Pure JavaScript Map-based caching (no Redis needed)

## 📦 Installation

```bash
cd backend
npm install
```

## 🎬 Usage

### Start the Server

```bash
npm start
```

Or with auto-reload during development (Node 18+):

```bash
npm run dev
```

The server will start on `http://localhost:5000`

## 💾 Caching System

The backend uses a **dual-cache architecture** to handle high traffic:

### Architecture
- **movieCache**: Stores complete API responses (lists, single movies)
- **torrentCache**: Stores torrent search results by title+year

### Why Dual-Cache?

**Problem:** During traffic spikes, hundreds of users requesting the same movie causes hundreds of duplicate Apibay requests → rate limiting → server IP blocked.

**Solution:** The torrent cache stores results by title+year, meaning even if 1000 users request the same movie, Apibay is only called ONCE. All other requests use cached torrents.

### Performance Impact

**Without cache:** 1000 users → 1000 Apibay requests → **RATE LIMIT**  
**With dual-cache:** 1000 users → 1 Apibay request → **NO RATE LIMIT**

### Cache Documentation

- **[CACHE_QUICKREF.md](CACHE_QUICKREF.md)** - Quick reference guide
- **[CACHING.md](CACHING.md)** - Complete architecture documentation
- **[CACHE_TESTING.md](CACHE_TESTING.md)** - Testing and monitoring guide
- **[CHANGELOG_v11.md](CHANGELOG_v11.md)** - Version 11.0 changes

## 📡 API Endpoints

### Movies

### Get All Movies
```
GET http://localhost:5000/api/movies
```

Returns all cached movies with metadata.

### Get Movie by ID
```
GET http://localhost:5000/api/movies/:id
```

Example: `http://localhost:5000/api/movies/550` (Fight Club)

Returns TMDB metadata + on-demand torrent search from Apibay.

### Get Tamil & Malayalam Movies
```
GET http://localhost:5000/api/movies/tamil?page=1
```

Returns Tamil and Malayalam movies with torrents.

### Get TV Shows
```
GET http://localhost:5000/api/tv?page=1
```

Returns TV shows with season pack torrents.

### Server Status
```
GET http://localhost:5000/api/status
```

Returns server status, cache statistics, and feature info.

### Cache Management

#### Get Cache Statistics
```
GET http://localhost:5000/api/cache/stats
```

Returns detailed cache performance metrics:
- Movie cache entries
- Torrent cache entries
- Hit rates
- API requests saved

#### Clear Expired Cache Entries
```
POST http://localhost:5000/api/cache/cleanup
```

Removes only expired entries (recommended for maintenance).

#### Clear All Cache
```
POST http://localhost:5000/api/cache/clear
```

Completely clears both caches (use for testing or forcing fresh data).

## 💡 Cache Management

### Monitoring Cache Performance

Check if cache is working:
```bash
curl http://localhost:5000/api/status | jq .cache
```

Get detailed statistics:
```bash
curl http://localhost:5000/api/cache/stats | jq
```

### Expected Behavior

**First request for a movie:**
- Calls TMDB for metadata
- Calls Apibay for torrents
- Caches both responses

**Subsequent requests:**
- Returns cached data immediately
- No API calls made
- **Instant response**

**Different movie, same title:**
- Calls TMDB for new metadata
- **Reuses cached torrents** (no Apibay call)
- Combines and returns

### Cache TTL (Time To Live)

| Content Type | TTL | Why |
|--------------|-----|-----|
| Movie with torrents | 24 hours | Stable data |
| Movie without torrents | 5 minutes | Retry soon |
| Movie lists | 6 hours | Balanced freshness |
| Torrents found | 24 hours | Stable results |
| Torrents not found | 2 hours | Retry later |

### Automatic Cleanup

The cache automatically removes expired entries every **30 minutes**.

### Manual Management

**Remove expired entries:**
```bash
curl -X POST http://localhost:5000/api/cache/cleanup
```

**Force cache clear (for testing):**
```bash
curl -X POST http://localhost:5000/api/cache/clear
```

## ⏰ No More Cron Jobs

## 📊 Data Structure

The backend now fetches data **on-demand** from TMDB (metadata) and Apibay (torrents). No more static JSON files or cron jobs!

### API Response Format

```javascript
{
  success: true,
  source: "TMDB + Apibay",
  data: [
    {
      id: 550,
      imdb_id: "tt0137523",
      title: "Fight Club",
      year: 1999,
      rating: 8.4,
      runtime: 139,
      genres: ["Drama", "Thriller"],
      plot: "An insomniac office worker and a devil-may-care soap maker...",
      poster: "https://image.tmdb.org/t/p/w500/...",
      backdrop: "https://image.tmdb.org/t/p/original/...",
      yt_trailer_code: "BdJKm16Co6M",
      torrents: [
        {
          url: "magnet:?xt=urn:btih:...",
          quality: "1080p",
          size: "2.1 GB",
          type: "magnet",
          seeders: 42,
          leechers: 5,
          name: "Fight.Club.1999.1080p.BluRay.x264"
        }
      ]
    }
  ],
  stats: {
    total: 20,
    withTorrents: 18,
    withoutTorrents: 2
  }
}
```

### Single Movie Response

```javascript
{
  success: true,
  data: {
    id: 550,
    imdb_id: "tt0137523",
    title: "Fight Club",
    year: 1999,
    rating: 8.4,
    runtime: 139,
    genres: ["Drama", "Thriller"],
    plot: "Movie description...",
    poster: "https://image.tmdb.org/t/p/w500/...",
    backdrop: "https://image.tmdb.org/t/p/original/...",
    yt_trailer_code: "BdJKm16Co6M",
    torrents: [
      // Array of magnet links with quality, size, seeders
    ],
    type: "movie" // or "tv" for TV shows
  }
}
```

## 🔧 Configuration

### Adjust Cache TTL

Edit `CACHE_TTL` in `server.js`:

```javascript
const CACHE_TTL = {
  SINGLE_MOVIE_WITH_TORRENTS: 24 * 60 * 60 * 1000,  // 24 hours
  SINGLE_MOVIE_NO_TORRENTS: 5 * 60 * 1000,           // 5 minutes
  MOVIE_LIST: 6 * 60 * 60 * 1000,                    // 6 hours
  TV_SHOWS_LIST: 6 * 60 * 60 * 1000,                 // 6 hours
  TORRENT_FOUND: 24 * 60 * 60 * 1000,                // 24 hours
  TORRENT_NOT_FOUND: 2 * 60 * 60 * 1000              // 2 hours
};
```

**For high traffic:** Increase TTL to reduce API load  
**For fresh content:** Decrease TTL for more frequent updates

### Change Automatic Cleanup Interval

Default: Every 30 minutes

```javascript
// In server.js
setInterval(() => {
  clearExpiredCaches();
}, 30 * 60 * 1000); // Change to desired interval
```

### TMDB Configuration

The TMDB API key is already configured in `server.js`:

```javascript
const TMDB_API_KEY = '8a68f9cbe2f314d0cdab27cc8d58216b';
```

To use your own key, replace with your TMDB API key from https://www.themoviedb.org/settings/api

## 🚨 Troubleshooting

### Cache Not Working

**Check if enabled:**
```bash
curl http://localhost:5000/api/status | jq .cache.enabled
```

**Check cache stats:**
```bash
curl http://localhost:5000/api/cache/stats
```

**Expected:** Hit rates >80%, apibayRequestsSaved increasing

### Rate Limiting Issues

**Symptoms:** "Failed to fetch torrents" errors in logs

**Solutions:**
1. Check cache is working (see above)
2. Increase torrent cache TTL
3. Clear cache and retry: `curl -X POST http://localhost:5000/api/cache/clear`
4. Wait 1-2 hours (rate limit cooldown)

### High Memory Usage

**Check cache size:**
```bash
curl http://localhost:5000/api/cache/stats | jq '{movies: .movieCache.totalEntries, torrents: .torrentCache.totalEntries}'
```

**Solutions:**
1. Run cleanup: `curl -X POST http://localhost:5000/api/cache/cleanup`
2. Decrease cache TTL
3. Clear cache: `curl -X POST http://localhost:5000/api/cache/clear`

### Stale Data

**Symptoms:** Old torrents or outdated movie lists

**Solutions:**
1. Clear cache: `curl -X POST http://localhost:5000/api/cache/clear`
2. Decrease TTL for affected content type
3. Wait for automatic expiration

## 📈 Performance Optimization

### For Production

1. **Increase cache TTL** during traffic spikes
2. **Monitor cache stats** regularly
3. **Use automatic cleanup** (already enabled)
4. **Track apibayRequestsSaved** metric

### Target Metrics

- **Movie cache hit rate:** >80%
- **Torrent cache hit rate:** >90%
- **API requests saved:** >1000 per day (high traffic)

### Load Testing

See [CACHE_TESTING.md](CACHE_TESTING.md) for comprehensive testing procedures.

## 📚 Documentation

- **[CACHE_QUICKREF.md](CACHE_QUICKREF.md)** - Quick reference card
- **[CACHING.md](CACHING.md)** - Complete architecture and usage
- **[CACHE_TESTING.md](CACHE_TESTING.md)** - Testing procedures
- **[CHANGELOG_v11.md](CHANGELOG_v11.md)** - What's new in v11.0

## 🔑 Key Changes from v10.0

### Before (v10.0)
- Single cache Map
- YTS API dependency (deprecated)
- Cron jobs for data fetching
- Static JSON file storage

### After (v11.0)
- **Dual-cache system** (movieCache + torrentCache)
- **TMDB + Apibay** (reliable, maintained APIs)
- **On-demand fetching** (no cron jobs needed)
- **In-memory caching** (no file I/O)
- **Rate limit protection** (90-99% reduction in API calls)
- **Smart TTL** (adaptive expiration)
- **Automatic cleanup** (memory efficient)
- **Performance tracking** (hit rates, requests saved)

## 🎯 Success Indicators

Your backend is working correctly if:

✅ Server starts without errors  
✅ `/api/status` shows dual-cache enabled  
✅ First request logs `[APIBAY] API REQUEST`  
✅ Second request logs `[CACHE] HIT`  
✅ Cache hit rate >80%  
✅ No rate limit errors  
✅ Fast response times  

## 💻 Tech Stack

- **Node.js** - Runtime
- **Express** - Web framework
- **Axios** - HTTP client
- **CORS** - Cross-origin support

**APIs:**
- **TMDB** - Movie metadata, posters, trailers
- **Apibay** - Torrent magnet links (The Pirate Bay)

**Caching:**
- **JavaScript Map** - Zero-dependency in-memory cache
- **Smart TTL** - Adaptive expiration strategy
- **Automatic cleanup** - Memory management

Edit the cron pattern in `server.js`:

```javascript
// Current: Every 12 hours
cron.schedule('0 0,12 * * *', ...);

// Examples:
// Every hour: '0 * * * *'
// Every 6 hours: '0 */6 * * *'
// Daily at 3 AM: '0 3 * * *'
```

### Change Timezone

```javascript
cron.schedule('0 0,12 * * *', () => {
  updateMovieDatabase();
}, {
  timezone: "America/New_York" // Change timezone
});
```

## 🛡️ Error Handling

The server includes comprehensive error handling:
- API timeout (10 seconds)
- File system errors
- Invalid API responses
- Graceful shutdown on SIGINT

## 📝 Logs

The server provides detailed console logs:
- 🎬 Fetching movies
- ✅ Success messages
- ❌ Error messages
- ⏰ Cron job triggers
- 💾 Data storage operations

## 🌐 CORS

CORS is enabled for all origins. To restrict:

```javascript
app.use(cors({
  origin: 'http://localhost:5173' // Your frontend URL
}));
```

## 📄 License

MIT
