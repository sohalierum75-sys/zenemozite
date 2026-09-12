import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Tv, Star, Clock, Calendar, Loader2, AlertCircle, ChevronRight } from 'lucide-react';
import HeroBanner from '../components/HeroBanner';
import { useLocale } from '../context/LocaleContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const TVShows = () => {
  const { isLk } = useLocale();
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    fetchTVShows();
  }, []);

  const fetchTVShows = async (pageNum = 1, append = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      console.log(`Fetching TV shows (page ${pageNum})...`);
      const response = await fetch(`${API_BASE_URL}/tv?page=${pageNum}`);
      const result = await response.json();
      
      console.log('TV Shows API Response:', result);

      if (result.success && result.data && result.data.length > 0) {
        if (append) {
          setShows(prevShows => [...prevShows, ...result.data]);
        } else {
          setShows(result.data);
        }
        setError(null);
      } else if (result.data && result.data.length === 0 && !append) {
        setError('No TV shows found');
        setShows([]);
      }
    } catch (err) {
      console.error('Error fetching TV shows:', err);
      setError('Unable to connect to server. Please ensure the backend is running.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchTVShows(nextPage, true);
  };

  if (loading && shows.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-16 h-16 text-orange-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-200 text-xl">Loading TV shows...</p>
          {isLk && <p className="text-slate-400 text-sm mt-2">ටීවී කතාමාලා පූරණය වෙමින්...</p>}
        </div>
      </div>
    );
  }

  if (error && shows.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-200 mb-2">Connection Error</h2>
          {isLk && <h3 className="text-xl text-slate-300 mb-4">සම්බන්ධතා ගැටලුවක්</h3>}
          <p className="text-slate-400 mb-6">{error}</p>
          <button 
            onClick={() => fetchTVShows(1, false)}
            className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold px-6 py-3 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg"
          >
            Try Again{isLk ? ' | නැවත උත්සාහ කරන්න' : ''}
          </button>
        </div>
      </div>
    );
  }

  const featuredShow = shows.length > 0 ? shows[0] : null;

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Hero Banner with Featured TV Show */}
      {featuredShow && <HeroBanner media={featuredShow} mediaType="tv" />}

      {/* TV Shows Grid Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* Section Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">Popular Series</h2>
            {isLk && <p className="text-slate-400">ජනප්‍රිය කතාමාලා</p>}
          </div>
          <div className="backdrop-blur-md bg-slate-900/50 border border-slate-700/50 px-4 py-2 rounded-lg">
            <p className="text-orange-500 font-bold">{shows.length} Shows</p>
          </div>
        </div>

        {/* TV Shows Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 mb-12">
          {shows.map((show) => (
            <Link
              key={show.id}
              to={`/tv/${show.id}`}
              className="group relative rounded-xl overflow-hidden backdrop-blur-md bg-slate-900/50 border border-slate-700/50 hover:border-orange-500 transition-all duration-300 transform hover:scale-105 hover:shadow-2xl hover:shadow-orange-500/20"
            >
              {/* TV Show Poster */}
              <div className="aspect-[2/3] relative overflow-hidden">
                <img
                  src={show.poster}
                  alt={show.title}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                  onError={(e) => {
                    e.target.src = 'https://via.placeholder.com/300x450?text=No+Poster';
                  }}
                />
                
                {/* Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300" />
                
                {/* Play Icon Overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                  <div className="bg-orange-500/90 rounded-full p-4 transform scale-0 group-hover:scale-100 transition-transform duration-300">
                    <ChevronRight className="w-8 h-8 text-white" />
                  </div>
                </div>
                
                {/* Rating Badge */}
                <div className="absolute top-2 right-2 backdrop-blur-md bg-black/60 px-2 py-1 rounded-lg flex items-center space-x-1 border border-orange-500/30">
                  <Star className="w-3 h-3 text-orange-500 fill-current" />
                  <span className="text-white text-xs font-bold">{show.rating?.toFixed(1) || 'N/A'}</span>
                </div>

                {/* TV Badge */}
                <div className="absolute top-2 left-2 backdrop-blur-md bg-orange-500/80 px-2 py-1 rounded-lg text-xs font-bold text-white border border-orange-400/50 flex items-center space-x-1">
                  <Tv className="w-3 h-3" />
                  <span>TV</span>
                </div>

                {/* Torrent Badge */}
                {show.torrents && show.torrents.length > 0 && (
                  <div className="absolute bottom-2 left-2 backdrop-blur-md bg-green-500/80 px-2 py-1 rounded-lg text-xs font-bold text-white border border-green-400/50">
                    {show.torrents.length} Packs
                  </div>
                )}
              </div>

              {/* TV Show Info */}
              <div className="p-3">
                <h3 className="text-white font-semibold text-sm mb-2 line-clamp-2 group-hover:text-orange-500 transition-all duration-300">
                  {show.title}
                </h3>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span className="flex items-center space-x-1">
                    <Calendar className="w-3 h-3" />
                    <span>{show.year}</span>
                  </span>
                  <span className="text-orange-400 font-semibold">Series</span>
                </div>

                {/* Genres */}
                {show.genres && show.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {show.genres.slice(0, 2).map((genre, idx) => (
                      <span
                        key={idx}
                        className="text-xs backdrop-blur-md bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded-full border border-orange-500/20"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* Empty State */}
        {shows.length === 0 && !loading && (
          <div className="text-center py-20 backdrop-blur-md bg-slate-900/50 border border-slate-700/50 rounded-2xl">
            <Tv className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-400 mb-2">No TV shows found</h3>
            <p className="text-slate-500 mb-6">{isLk ? 'ටීවී කතාමාලා හමු නොවිණි' : ''}</p>
            <button
              onClick={() => fetchTVShows(1, false)}
              className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold px-6 py-3 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg"
            >
              Refresh{isLk ? ' | නැවුම් කරන්න' : ''}
            </button>
          </div>
        )}

        {/* Load More Button */}
        {shows.length > 0 && (
          <div className="flex justify-center mt-12">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="backdrop-blur-md bg-slate-900/50 hover:bg-slate-800/50 border border-slate-700/50 hover:border-orange-500 text-white font-bold px-8 py-4 rounded-lg transition-all duration-300 transform hover:scale-105 flex items-center space-x-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-lg hover:shadow-orange-500/20"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading more...</span>
                </>
              ) : (
                <>
                  <ChevronRight className="w-5 h-5" />
                  <span>{isLk ? 'Load More Shows | තවත් කතාමාලා' : 'Load More Shows'}</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-12 backdrop-blur-md bg-gradient-to-r from-orange-900/20 to-orange-800/20 border border-orange-400/30 rounded-2xl p-6">
          <div className="flex items-start space-x-4">
            <AlertCircle className="w-6 h-6 text-orange-400 flex-shrink-0 mt-1" />
            <div>
              <h3 className="text-white font-bold text-lg mb-2">About TV Shows Streaming</h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Stream popular TV series directly in your browser using Vidsrc. The player defaults to Season 1, Episode 1, 
                but you can navigate to other seasons and episodes within the embedded player. Season pack torrents are available 
                for download when found.{isLk ? ' Use the Sinhala subtitle search button on each show page to find subtitles.' : ''}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TVShows;
