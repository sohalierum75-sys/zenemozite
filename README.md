# MovieStream - Fully Automated Movie Streaming Platform

A complete, production-ready movie streaming and downloading platform with **full automation**. The system automatically fetches movies from YTS API, provides auto-streaming via Vidsrc, and offers direct torrent downloads. **Zero manual data entry required!**

## 🌟 Key Features

### 🤖 Backend Automation (Node.js + Express)
- **Automatic Data Fetching**: Cron job runs every 12 hours to fetch latest movies from YTS
- **RESTful API**: Clean Express endpoints serve movie data to frontend
- **Local Caching**: JSON file-based storage for fast access
- **50+ Movies**: Automatically fetches top-rated movies (configurable)
- **IMDb Integration**: Full IMDb codes for streaming and metadata

### 🎬 Frontend Features (React + Vite)
- **Auto-Streaming**: Embeds movies automatically using Vidsrc with IMDb codes
- **Automated Downloads**: Maps YTS torrent links (720p, 1080p, 2160p) to buttons
- **Premium Dark UI**: Sleek black theme with warm gold accents
- **Fully Responsive**: Mobile-first design, works on all devices
- **Real-time Updates**: Fetches from backend API automatically
- **Smart Search**: Search bar ready for implementation

## 🚀 Quick Start

### Automated Setup (Windows)
```bash
# Run the setup script
setup.bat
```

### Automated Setup (Linux/Mac)
```bash
# Make script executable and run
chmod +x setup.sh
./setup.sh
```

### Manual Setup

**1. Backend:**
```bash
cd backend
npm install
npm start
```
Server starts on `http://localhost:5000` and automatically fetches movies.

**2. Frontend (new terminal):**
```bash
npm install
npm run dev
```
Frontend starts on `http://localhost:5173`

**3. Open Browser:**
```
http://localhost:5173
```

## 📊 How It Works

### Data Flow
```
YTS API → Backend (Cron Job) → JSON Cache → Express API → React Frontend
                                    ↓
                            Vidsrc Streaming + Torrent Downloads
```

1. **Backend fetches** movies from YTS every 12 hours
2. **Stores** data in `movies-data.json` 
3. **Serves** via Express API endpoints
4. **Frontend displays** movies automatically
5. **Auto-embeds** streaming via Vidsrc using IMDb codes
6. **Auto-generates** download buttons from torrent data

## 🎨 Design Theme

- **Deep Black**: `#050505` - Main background
- **Black Blue**: `#080D14` - Secondary background/sections
- **Dark Navy**: `#0D1722` - Movie cards/cards
- **Warm Gold**: `#F5B942` - Primary accent (buttons/badges)
- **Soft Gold**: `#FFD166` - Hover accent
- **White Text**: `#F8FAFC` - Main text
- **Cool Gray**: `#94A3B8` - Secondary text/details
- **Subtle Blue**: `#172333` - Borders/dividers

## 🎯 Technology Stack

### Backend
- **Node.js** - Runtime environment
- **Express** - Web framework
- **Axios** - HTTP client for YTS API
- **Node-cron** - Automated scheduling
- **CORS** - Cross-origin resource sharing

### Frontend
- **React 18** - UI library
- **Vite** - Build tool
- **React Router DOM** - Routing
- **Tailwind CSS** - Styling
- **Lucide React** - Icons

### APIs & Services
- **YTS API** - Movie data and torrent links
- **Vidsrc** - Auto-streaming embed service
- **IMDb** - Movie identification and metadata

## 📦 Installation

1. **Install dependencies**:
```bash
npm install
```

2. **Start development server**:
```bash
npm run dev
```

3. **Build for production**:
```bash
npm run build
```

4. **Preview production build**:
```bash
npm run preview
```

## 📁 Project Structure

```
moviestream/
├── backend/
│   ├── server.js              # Express server with YTS integration & cron
│   ├── package.json           # Backend dependencies
│   ├── movies-data.json       # Auto-generated cache (created on first run)
│   └── README.md              # Backend documentation
├── src/
│   ├── components/
│   │   ├── Navbar.jsx         # Navigation with search
│   │   ├── Footer.jsx         # Footer with links
│   │   ├── MovieCard.jsx      # Reusable movie card (backend data)
│   │   └── MovieCarousel.jsx  # Scrollable movie carousel
│   ├── pages/
│   │   ├── Home.jsx           # Home page (fetches from backend API)
│   │   └── SingleMovie.jsx    # Movie details + Vidsrc + torrents
│   ├── data/
│   │   └── moviesData.js      # (Legacy - not used)
│   ├── App.jsx                # Main app with routing
│   ├── main.jsx               # React entry point
│   └── index.css              # Global styles + Tailwind
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── setup.sh                   # Linux/Mac setup script
├── setup.bat                  # Windows setup script
├── SETUP.md                   # Detailed setup guide
└── README.md
```

## 🔌 Backend API

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/movies` | Get all cached movies |
| GET | `/api/movies/:id` | Get movie by ID |
| GET | `/api/movies/imdb/:code` | Get movie by IMDb code |
| POST | `/api/movies/refresh` | Manually trigger data fetch |
| GET | `/api/status` | Server and database status |

### Example Response

```json
{
  "success": true,
  "data": [
    {
      "id": 12345,
      "imdb_code": "tt1375666",
      "title": "Inception",
      "year": 2010,
      "rating": 8.8,
      "runtime": 148,
      "genres": ["Action", "Sci-Fi"],
      "summary": "Movie description...",
      "poster": "URL",
      "backdrop": "URL",
      "torrents": [
        {
          "url": "magnet:...",
          "quality": "1080p",
          "size": "2.1GB"
        }
      ]
    }
  ],
  "lastUpdated": "2026-08-24T01:30:00.000Z",
  "totalMovies": 50
}
```

## 🎬 Streaming Integration

### Vidsrc Auto-Embedding

Movies are automatically streamed using Vidsrc:

```javascript
const vidsrcUrl = `https://vidsrc.me/embed/movie?imdb=${movie.imdb_code}`;
```

**Features:**
- No API key required
- Works with IMDb codes
- Auto-selects best quality
- Built-in player controls
- Subtitle support

## 📥 Download Integration

### YTS Torrent System

Download buttons are automatically generated from YTS torrent data:

```javascript
movie.torrents.map(torrent => (
  <button onClick={() => window.open(torrent.url)}>
    Download {torrent.quality} - {torrent.size}
  </button>
))
```

**Supported Qualities:**
- 720p (HD)
- 1080p (Full HD)
- 2160p (4K)

**User Requirements:**
- Torrent client (qBittorrent, uTorrent, Transmission)

## ⏰ Automation

### Cron Job Schedule

The backend automatically fetches new movies:

- **Frequency**: Every 12 hours
- **Schedule**: 00:00 and 12:00 daily
- **Timezone**: Asia/Kolkata (configurable)
- **Source**: YTS API
- **Storage**: `backend/movies-data.json`

**Manual Trigger:**
```bash
curl -X POST http://localhost:5000/api/movies/refresh
```

## 🎯 Key Components

### Backend (server.js)
- **Express Server**: RESTful API with CORS
- **YTS Integration**: Fetches movie data automatically
- **Cron Scheduler**: Updates database every 12 hours
- **File Storage**: JSON-based caching system
- **Error Handling**: Comprehensive logging and error management

### Frontend Components

#### Navbar
- Sticky navigation with search
- Mobile-responsive hamburger menu
- Warm gold focus effects

#### Home Page
- Hero section with featured movie
- Latest Releases carousel
- Trending Movies carousel (sorted by rating)
- Automatic data fetching from backend
- Loading and error states

#### MovieCard
- Hover effects with scale transformation
- IMDb rating badge
- Genre tags
- Runtime display
- Responsive aspect ratio

#### SingleMovie Page
- **Auto-Streaming**: Vidsrc iframe embed with IMDb code
- **Automated Downloads**: Torrent buttons from YTS data
- Quality-based color coding
- Movie metadata (plot, cast, rating, runtime)
- IMDb and YouTube trailer links
- Loading and error states

## 🛠️ Customization

### Colors
Edit `tailwind.config.js` to modify the color scheme:

```javascript
colors: {
  'deep-black': '#050505',
  'warm-gold': '#F5B942',
  // ... modify as needed
}
```

### Fonts
The project uses **Inter** from Google Fonts. Change in `index.html` and `tailwind.config.js`.

### Backend Configuration
Edit `backend/server.js`:

```javascript
// Change fetch limit
const FETCH_LIMIT = 50; // Increase to 100 for more movies

// Change cron schedule
cron.schedule('0 0,12 * * *', ...); // Every 12 hours
cron.schedule('0 */6 * * *', ...);  // Every 6 hours

// Change minimum rating
minimum_rating: 6 // Only movies rated 6.0 or higher
```

## 📱 Responsive Breakpoints

- **Mobile**: < 640px
- **Tablet**: 640px - 1024px
- **Desktop**: > 1024px

## 🛡️ Troubleshooting

### Backend Issues

**"Failed to fetch movies from YTS"**
- YTS API might be temporarily down
- Try using a VPN
- Wait and retry later

**"Port 5000 already in use"**
```javascript
// Change port in server.js
const PORT = 5001;
```

### Frontend Issues

**"Unable to connect to server"**
- Ensure backend is running on `http://localhost:5000`
- Check browser console for CORS errors
- Verify both terminals are running

**Movies not loading**
1. Check if backend has data: `http://localhost:5000/api/status`
2. Manually trigger fetch: `POST http://localhost:5000/api/movies/refresh`
3. Check browser console for errors

## ⚡ Performance Tips

1. **Backend Caching**: Movies are cached in JSON file for fast access
2. **Image Optimization**: Use WebP format for movie posters (automatic from YTS)
3. **Lazy Loading**: Images use `loading="lazy"` attribute
4. **Code Splitting**: Leverage React.lazy() for route-based splitting
5. **Cron Scheduling**: Adjusts fetch frequency to reduce API load

## 🚀 Deployment

### Backend Deployment (Railway/Render/Heroku)

1. Push `backend/` folder to your service
2. Set environment variables:
   ```
   PORT=5000
   NODE_ENV=production
   ```
3. Install dependencies and start: `npm install && npm start`
4. Note your backend URL (e.g., `https://your-backend.railway.app`)

### Frontend Deployment (Vercel/Netlify)

1. Update API URLs in `src/pages/Home.jsx` and `src/pages/SingleMovie.jsx`:
   ```javascript
   const API_BASE_URL = 'https://your-backend.railway.app/api';
   ```

2. Build and deploy:
   ```bash
   npm run build
   # Deploy 'dist' folder to Vercel/Netlify
   ```

### Environment Variables

Backend `.env` (optional):
```env
PORT=5000
FETCH_LIMIT=50
MINIMUM_RATING=6
CRON_SCHEDULE=0 0,12 * * *
```

## 📊 API Documentation

Full API documentation available in `backend/README.md`

Quick reference:
- `GET /api/movies` - All movies
- `GET /api/movies/:id` - Single movie
- `GET /api/movies/imdb/:code` - Movie by IMDb
- `POST /api/movies/refresh` - Force update
- `GET /api/status` - Server status

## 🎓 Resources

- **YTS API**: https://yts.mx/api
- **Vidsrc**: https://vidsrc.me
- **Node-cron**: https://www.npmjs.com/package/node-cron
- **Express**: https://expressjs.com
- **React Router**: https://reactrouter.com
- **Tailwind CSS**: https://tailwindcss.com

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🤝 Contributing

Contributions are welcome! Areas to improve:

- [ ] Add search functionality
- [ ] Implement user favorites/watchlist
- [ ] Add TV show support
- [ ] Multiple streaming sources
- [ ] Subtitles integration
- [ ] User authentication
- [ ] Admin dashboard

## 📧 Support

For questions or issues:
1. Check `SETUP.md` for detailed setup guide
2. Review backend logs (terminal running backend)
3. Check browser console (F12 → Console)
4. Verify both servers are running

## ✅ Success Checklist

- [x] Backend server running on port 5000
- [x] Frontend running on port 5173
- [x] Movies automatically fetched from YTS
- [x] Cron job scheduled for auto-updates
- [x] Vidsrc streaming working
- [x] Torrent download buttons functional
- [x] Premium dark UI with gold accents
- [x] Fully responsive design
- [x] Error handling and loading states

---

**Built with ❤️ using React, Node.js, Express, Tailwind CSS, YTS API, and Vidsrc**

**⭐ Star this repo if you found it useful!**
