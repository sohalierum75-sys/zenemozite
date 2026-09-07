import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, ChevronLeft } from 'lucide-react';
import MoviePlayer from '../components/MoviePlayer';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const VIDSRC_BASE_URL = 'https://vidsrc.me/embed/movie';

const WatchMovie = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMovie();
  }, [id]);

  const fetchMovie = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/movies/${id}`);
      const result = await response.json();
      
      if (result.success) {
        setMovie(result.data);
        setError(null);
      } else {
        setError('Movie not found');
      }
    } catch (err) {
      console.error('Error fetching movie:', err);
      setError('Unable to load movie');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    navigate(`/movie/${id}`);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50">
        <div className="text-center">
          <Loader2 className="w-16 h-16 text-orange-500 animate-spin mx-auto mb-4" />
          <p className="text-white text-xl">Loading movie player...</p>
        </div>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50">
        <div className="text-center max-w-md mx-4">
          <AlertCircle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Unable to Load Movie</h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold px-6 py-3 rounded-lg transition-all duration-300 inline-flex items-center space-x-2"
          >
            <ChevronLeft className="w-5 h-5" />
            <span>Back to Home</span>
          </button>
        </div>
      </div>
    );
  }

  // Construct video URL (using Vidsrc with IMDb code)
  // YTS provides imdb_code or imdb_id field
  const imdbCode = movie.imdb_code || movie.imdb_id;
  const videoUrl = imdbCode ? `${VIDSRC_BASE_URL}?imdb=${imdbCode}` : null;

  if (!videoUrl) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50">
        <div className="text-center max-w-md mx-4">
          <AlertCircle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">IMDb Code Not Available</h2>
          <p className="text-slate-400 mb-6">This movie doesn't have an IMDb code for streaming.</p>
          <button
            onClick={() => navigate(`/movie/${id}`)}
            className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold px-6 py-3 rounded-lg transition-all duration-300 inline-flex items-center space-x-2"
          >
            <ChevronLeft className="w-5 h-5" />
            <span>Back to Movie Details</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <MoviePlayer
      videoUrl={videoUrl}
      posterUrl={movie.backdrop || movie.poster_large || movie.poster}
      title={movie.title}
      imdbCode={imdbCode}
      onClose={handleClose}
    />
  );
};

export default WatchMovie;


