import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Search, AlertCircle, Star, ArrowLeft, Film, Tv } from 'lucide-react';
import { useLocale } from '../context/LocaleContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// Cursor-Aware Card Component with Media Type Routing
const MovieCard = ({ movie, className = '', index = 0 }) => {
  const cardRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    cardRef.current.style.setProperty('--x', `${x}%`);
    cardRef.current.style.setProperty('--y', `${y}%`);
  };

  // CRITICAL: Determine correct route based on media_type
  const getRouteUrl = () => {
    if (movie.media_type === 'tv') {
      return `/tv/${movie.id}`;
    } else if (movie.media_type === 'movie') {
      return `/movie/${movie.id}`;
    } else {
      // Fallback: assume movie if media_type is missing
      console.warn('[SEARCH] media_type missing for:', movie.title, '- defaulting to movie');
      return `/movie/${movie.id}`;
    }
  };

  return (
    <Link
      to={getRouteUrl()}
      ref={cardRef}
      onMouseMove={handleMouseMove}
      className={`group block cursor-glow animate-fadeInUp ${className}`}
      style={{ animationDelay: `${40 + (index * 40)}ms` }}
    >
      <div className="glass-card rounded-2xl overflow-hidden hover:bg-[#1a1c23]/90 hover:border-white/10 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[var(--accent)]/10 transition-all duration-300">
        {/* Poster Image */}
        <div className="relative overflow-hidden aspect-[2/3]">
          <img
            src={movie.poster}
            alt={movie.title}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            loading="lazy"
            onError={(e) => {
              e.target.src = 'https://via.placeholder.com/300x450?text=No+Poster';
            }}
          />
          
          {/* Overlay on Hover */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f1115] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          
          {/* IMDb Rating Badge */}
          {movie.rating > 0 && (
            <div className="absolute top-3 right-3 bg-[var(--accent)] text-[#0f1115] px-2 py-1 rounded-lg flex items-center space-x-1 font-bold text-sm shadow-lg shadow-[var(--accent)]/20 transition-accent">
              <Star className="w-4 h-4 fill-current" />
              <span>{movie.rating.toFixed(1)}</span>
            </div>
          )}

          {/* Media Type Badge */}
          {movie.media_type && (
            <div className="absolute top-3 left-3 bg-[#0f1115]/80 backdrop-blur-sm text-white px-2 py-1 rounded-lg flex items-center space-x-1 font-medium text-xs border border-white/10">
              {movie.media_type === 'tv' ? (
                <>
                  <Tv className="w-3 h-3" />
                  <span>TV Show</span>
                </>
              ) : (
                <>
                  <Film className="w-3 h-3" />
                  <span>Movie</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Movie Info */}
        <div className="p-3 backdrop-blur-md bg-[#1a1c23]/50">
          <h3 className="text-white font-bold text-sm md:text-base mb-1 truncate group-hover:text-[var(--accent)] transition-accent">
            {movie.title}
          </h3>
          
          <div className="flex items-center justify-between text-xs md:text-sm">
            <span className="text-[#8b94a6]">{movie.year || 'N/A'}</span>
          </div>
        </div>
      </div>
    </Link>
  );
};

// Premium Skeleton Card
const SkeletonCard = ({ index = 0 }) => (
  <div 
    className="skeleton rounded-2xl overflow-hidden animate-fadeInUp" 
    style={{ animationDelay: `${40 + (index * 40)}ms` }}
  >
    <div className="aspect-[2/3] bg-[#1a1c23]/40" />
    <div className="p-3">
      <div className="h-4 bg-white/5 rounded mb-2 w-3/4" />
      <div className="h-3 bg-white/5 rounded w-1/2" />
    </div>
  </div>
);

const SearchResults = () => {
  const { query } = useParams();
  const navigate = useNavigate();
  const { isLk } = useLocale();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (query) {
      fetchSearchResults(query);
    }
  }, [query]);

  const fetchSearchResults = async (searchQuery) => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[SEARCH] Fetching results for:', searchQuery);
      console.log('[SEARCH] URL:', `${API_BASE_URL}/search?q=${encodeURIComponent(searchQuery)}`);
      
      const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(searchQuery)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      console.log('[SEARCH] API Response:', result);
      
      if (result.success && Array.isArray(result.data)) {
        setResults(result.data);
      } else if (Array.isArray(result)) {
        setResults(result);
      } else {
        setError('Invalid data format from server');
      }
    } catch (err) {
      console.error('[SEARCH] Error fetching results:', err);
      setError('Unable to connect to server. Please make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="h-16 w-16 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)] mx-auto mb-4" />
          <p className="text-white text-xl font-semibold animate-fadeInUp">Searching...</p>
          {isLk && <p className="text-[#8b94a6] text-sm mt-2 animate-fadeInUp stagger-1">සොයමින් පවතී...</p>}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-[var(--accent)] mx-auto mb-4 animate-fadeInUp" />
          <h2 className="text-2xl font-extrabold text-white mb-2 animate-fadeInUp stagger-1">Search Failed</h2>
          {isLk && <h3 className="text-xl text-[#8b94a6] mb-4 animate-fadeInUp stagger-2">සෙවීම අසාර්ථක විය</h3>}
          <p className="text-[#8b94a6] mb-6 animate-fadeInUp stagger-3">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20 animate-fadeInUp stagger-4"
          >
            Back to Home{isLk ? ' | ආපසු' : ''}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Search Header Section */}
      <div className="bg-gradient-to-b from-[#1a1c23]/50 to-transparent py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Back Button */}
          <button
            onClick={() => navigate(-1)}
            className="flex items-center space-x-2 text-[#8b94a6] hover:text-[var(--accent)] transition-accent mb-6 animate-fadeInUp"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>{isLk ? 'Back | ආපසු' : 'Back'}</span>
          </button>

          {/* Search Title */}
          <div className="mb-8">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2 tracking-tight animate-fadeInUp stagger-1">
              Search Results
            </h1>
            {isLk && (
              <h2 className="text-2xl md:text-3xl font-extrabold text-[#8b94a6] mb-4 animate-fadeInUp stagger-2">
                සෙවුම් ප්‍රතිඵල
              </h2>
            )}
            <div className="flex items-center space-x-3 animate-fadeInUp stagger-3">
              <Search className="w-6 h-6 text-[var(--accent)] transition-accent" />
              <p className="text-white text-xl">
                Results for: <span className="text-[var(--accent)] font-bold transition-accent">"{decodeURIComponent(query)}"</span>
              </p>
            </div>
          </div>

          {/* Results Count */}
          {results.length > 0 && (
            <p className="text-[#8b94a6] animate-fadeInUp stagger-4">
              Found <span className="text-[var(--accent)] font-bold transition-accent">{results.length}</span> result{results.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Results Grid Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4 md:gap-6">
            {[...Array(12)].map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4 md:gap-6">
            {results
              .filter(item => item.media_type !== 'person')
              .map((item, index) => (
              <MovieCard key={`${item.id}-${item.media_type}`} movie={item} index={index} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="glass-card max-w-md mx-auto p-12 rounded-2xl">
              <Search className="w-20 h-20 text-[#8b94a6] mx-auto mb-6 opacity-50" />
              <h2 className="text-2xl font-bold text-white mb-2">No Results Found</h2>
              {isLk && <h3 className="text-xl text-[#8b94a6] mb-4">ප්‍රතිඵල හමු නොවීය</h3>}
              <p className="text-[#8b94a6] mb-8">
                We couldn't find any movies or TV shows matching "<span className="text-white font-semibold">{decodeURIComponent(query)}</span>".
              </p>
              <div className="space-y-3">
                <p className="text-sm text-[#8b94a6]">Try:</p>
                <ul className="text-sm text-[#8b94a6] space-y-1">
                  <li>• Checking your spelling</li>
                  <li>• Using different keywords</li>
                  <li>• Searching for a different title</li>
                </ul>
              </div>
              <button
                onClick={() => navigate('/')}
                className="mt-8 bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20"
              >
                Browse All Movies{isLk ? ' | සියලුම චිත්‍රපට' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchResults;
