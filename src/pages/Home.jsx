import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, Star, Film, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import HeroBanner from '../components/HeroBanner';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// Cursor-Aware Card Component
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

  return (
    <Link
      to={`/movie/${movie.id}`}
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
          {movie.rating && (
            <div className="absolute top-3 right-3 bg-[var(--accent)] text-[#0f1115] px-2 py-1 rounded-lg flex items-center space-x-1 font-bold text-sm shadow-lg shadow-[var(--accent)]/20 transition-accent">
              <Star className="w-4 h-4 fill-current" />
              <span>{movie.rating}</span>
            </div>
          )}
        </div>

        {/* Movie Info */}
        <div className="p-3 backdrop-blur-md bg-[#1a1c23]/50">
          <h3 className="text-white font-bold text-sm md:text-base mb-1 truncate group-hover:text-[var(--accent)] transition-accent">
            {movie.title}
          </h3>
          
          <div className="flex items-center justify-between text-xs md:text-sm">
            <span className="text-[#8b94a6]">{movie.year}</span>
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

const Home = () => {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchMovies(1, false);
  }, []);

  const fetchMovies = async (pageNum = 1, append = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      
      console.log('[FRONTEND] Fetching from:', `${API_BASE_URL}/movies?page=${pageNum}`);
      
      const response = await fetch(`${API_BASE_URL}/movies?page=${pageNum}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      console.log('[FRONTEND] API Response:', result);
      
      if (result.success && Array.isArray(result.data)) {
        if (append) {
          setMovies(prevMovies => [...prevMovies, ...result.data]);
        } else {
          setMovies(result.data);
        }
      } else if (Array.isArray(result)) {
        if (append) {
          setMovies(prevMovies => [...prevMovies, ...result]);
        } else {
          setMovies(result);
        }
      } else if (result.data && Array.isArray(result.data)) {
        if (append) {
          setMovies(prevMovies => [...prevMovies, ...result.data]);
        } else {
          setMovies(result.data);
        }
      } else {
        setError('Invalid data format from server');
      }
    } catch (err) {
      console.error('[FRONTEND] Error fetching movies:', err);
      setError('Unable to connect to server. Please make sure the backend is running on http://localhost:5000');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchMovies(nextPage, true);
  };

  if (loading && movies.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="h-16 w-16 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)] mx-auto mb-4" />
          <p className="text-white text-xl font-semibold animate-fadeInUp">Loading movies...</p>
          <p className="text-[#8b94a6] text-sm mt-2 animate-fadeInUp stagger-1">චිත්‍රපට ලබා ගනිමින් පවතී...</p>
        </div>
      </div>
    );
  }

  if (error && movies.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-[var(--accent)] mx-auto mb-4 animate-fadeInUp" />
          <h2 className="text-2xl font-extrabold text-white mb-2 animate-fadeInUp stagger-1">Unable to Load Movies</h2>
          <h3 className="text-xl text-[#8b94a6] mb-4 animate-fadeInUp stagger-2">චිත්‍රපට පූරණය කළ නොහැකි විය</h3>
          <p className="text-[#8b94a6] mb-6 animate-fadeInUp stagger-3">Please check your connection and try again.</p>
          <button
            onClick={() => fetchMovies(1, false)}
            className="bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20 animate-fadeInUp stagger-4"
          >
            Try Again | නැවත උත්සාහ කරන්න
          </button>
        </div>
      </div>
    );
  }

  if (movies.length === 0 && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-xl mb-2 animate-fadeInUp">No movies available right now.</p>
          <p className="text-[#8b94a6] text-lg mb-6 animate-fadeInUp stagger-1">දැනට චිත්‍රපට නොමැත.</p>
          <button
            onClick={() => fetchMovies(1, false)}
            className="bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20 animate-fadeInUp stagger-2"
          >
            Refresh | නැවුම් කරන්න
          </button>
        </div>
      </div>
    );
  }

  const featuredMovie = movies[0];

  return (
    <div className="min-h-screen">
      {/* Hero Section with Featured Movie */}
      <HeroBanner media={featuredMovie} mediaType="movie" />

      {/* Latest Releases Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Section Heading - Kinetic Typography */}
        <div className="mb-12">
          <h2 className="text-section font-extrabold text-white flex items-center space-x-3 mb-2 tracking-tight animate-fadeInUp">
            <Film className="w-10 h-10 text-[#ff9900]" />
            <span>Latest Movies</span>
          </h2>
          <h3 className="text-3xl md:text-4xl font-extrabold text-[#8b94a6] mb-3 animate-fadeInUp stagger-1">අලුත්ම චිත්‍රපට</h3>
          <p className="text-[#8b94a6] text-lg animate-fadeInUp stagger-2">
            Watch and download the newest movies
          </p>
        </div>

        {/* Responsive Movie Grid with Premium Skeleton */}
        {loading && movies.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4 md:gap-6">
            {[...Array(12)].map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        ) : movies && movies.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4 md:gap-6">
            {movies.map((movie, index) => (
              <MovieCard key={movie.id} movie={movie} index={index} />
            ))}
          </div>
        ) : (
          <div className="col-span-full text-center py-12">
            <AlertCircle className="w-16 h-16 text-[#8b94a6] mx-auto mb-4" />
            <p className="text-white text-xl">No movies found</p>
          </div>
        )}

        {/* Total Movies Counter */}
        {movies && movies.length > 0 && (
          <div className="mt-12 text-center animate-fadeInUp">
            <p className="text-[#8b94a6]">
              Showing <span className="text-[#ff9900] font-bold">{movies.length}</span> latest releases
            </p>
          </div>
        )}

        {/* Load More Button */}
        {movies.length > 0 && (
          <div className="flex justify-center mt-8 animate-fadeInUp">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="bg-white/5 backdrop-blur-md hover:bg-white/10 border border-white/10 hover:border-white/20 text-white font-bold px-8 py-4 rounded-xl transition-all duration-300 transform hover:scale-105 flex items-center space-x-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-lg"
            >
              {loadingMore ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-[#ff9900]" />
                  <span>Loading... | ලබා ගනිමින්...</span>
                </>
              ) : (
                <>
                  <ChevronRight className="w-5 h-5" />
                  <span>Load More Movies | තවත් චිත්‍රපට</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;