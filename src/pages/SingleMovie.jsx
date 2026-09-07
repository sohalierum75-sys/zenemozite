import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Download, Star, Clock, Calendar, ChevronLeft, Loader2, AlertCircle, ExternalLink, Video, X, Search, MessageSquare } from 'lucide-react';
import WebtorModal from '../components/WebtorModal';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const DEFAULT_POSTER = 'https://via.placeholder.com/400x600/1a1d29/8b94a6?text=No+Poster';
const DEFAULT_BACKDROP = 'https://via.placeholder.com/1920x1080/0f1115/8b94a6?text=No+Image';

const SingleMovie = () => {
  const { id } = useParams();
  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [activeWebtorMagnet, setActiveWebtorMagnet] = useState(null);

  useEffect(() => {
    if (id) {
      fetchMovie();
    }
  }, [id]);

  const fetchMovie = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log(`[MOVIE] Fetching movie ID: ${id}`);
      
      const response = await fetch(`${API_BASE_URL}/movies/${id}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      console.log('[MOVIE] API Response:', result);
      console.log('[MOVIE] Response type:', typeof result);
      console.log('[MOVIE] Result.data type:', typeof result?.data);
      console.log('[MOVIE] Result.success:', result?.success);
      
      // SAFE DATA EXTRACTION - Handle both wrapped and direct response
      let movieData = null;
      
      if (result?.success && result?.data) {
        // New structure: { success: true, data: {...} }
        movieData = result.data;
        console.log('[MOVIE] Extracted from result.data (new structure)');
      } else if (result?.data) {
        // Fallback: { data: {...} }
        movieData = result.data;
        console.log('[MOVIE] Extracted from result.data (fallback)');
      } else if (result && typeof result === 'object' && result.id) {
        // Old structure: direct object with id
        movieData = result;
        console.log('[MOVIE] Using result directly (old structure)');
      } else {
        console.warn('[MOVIE] Unexpected response structure:', result);
        throw new Error('Invalid response structure');
      }

      console.log('[MOVIE] Movie data:', movieData);
      console.log('[MOVIE] Movie title:', movieData?.title);
      console.log('[MOVIE] Torrents:', movieData?.torrents);

      if (movieData && movieData.id) {
        setMovie(movieData);
        setError(null);
        console.log('[MOVIE] Successfully set movie:', movieData.title);
      } else {
        console.error('[MOVIE] Invalid movie data:', movieData);
        setError('Movie not found');
        setMovie(null);
      }
    } catch (err) {
      console.error('[MOVIE] API Fetch Error:', err);
      console.error('[MOVIE] Error name:', err.name);
      console.error('[MOVIE] Error message:', err.message);
      console.error('[MOVIE] Error stack:', err.stack);
      
      setError(err.message || 'Unable to connect to server');
      setMovie(null);
    } finally {
      setLoading(false);
    }
  };

  const hasTorrents = movie?.torrents && Array.isArray(movie.torrents) && movie.torrents.length > 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f1115]">
        <div className="text-center">
          <div className="h-16 w-16 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)] mx-auto mb-4" />
          <p className="text-white text-xl font-semibold">Loading movie details...</p>
          <p className="text-[#8b94a6] text-sm mt-2">විස්තර ලබා ගනිමින් පවතී...</p>
        </div>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-[#0f1115]">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-[var(--accent)] mx-auto mb-4" />
          <h2 className="text-2xl font-extrabold text-white mb-2">Movie Not Found</h2>
          <h3 className="text-xl text-[#8b94a6] mb-4">චිත්‍රපටය හමු නොවිණි</h3>
          <p className="text-[#8b94a6] mb-6">
            {error || 'The movie you are looking for is not available.'}
          </p>
          <Link 
            to="/" 
            className="inline-block bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20 active:scale-95"
          >
            Return to Home | මුල් පිටුවට යන්න
          </Link>
        </div>
      </div>
    );
  }

  // ADDITIONAL SAFETY CHECK - Ensure movie object has required properties
  if (!movie?.id) {
    console.error('[MOVIE] Movie object missing required id:', movie);
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-[#0f1115]">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-[var(--accent)] mx-auto mb-4" />
          <h2 className="text-2xl font-extrabold text-white mb-2">Invalid Movie Data</h2>
          <h3 className="text-xl text-[#8b94a6] mb-4">වලංගු නොවන දත්ත</h3>
          <p className="text-[#8b94a6] mb-6">
            The movie data is incomplete or invalid.
          </p>
          <Link 
            to="/" 
            className="inline-block bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20 active:scale-95"
          >
            Return to Home | මුල් පිටුවට යන්න
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1115]">
      {/* Back Button */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fadeInUp">
        <Link 
          to="/" 
          className="inline-flex items-center space-x-2 text-[#8b94a6] hover:text-[var(--accent)] transition-accent"
        >
          <ChevronLeft className="w-5 h-5" />
          <span>Back to Home</span>
        </Link>
      </div>

      {/* Movie Title - Above Player */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6 animate-fadeInUp stagger-1">
        <h1 className="text-hero font-extrabold text-white mb-2 tracking-tight">
          {movie?.title || 'Unknown Title'}
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-[#8b94a6]">
          {movie?.year && (
            <div className="flex items-center space-x-2">
              <Calendar className="w-5 h-5 text-[var(--accent)] transition-accent" />
              <span>{movie.year}</span>
            </div>
          )}
          {movie?.runtime && (
            <div className="flex items-center space-x-2">
              <Clock className="w-5 h-5 text-[var(--accent)] transition-accent" />
              <span>{movie.runtime} min</span>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <Star className="w-5 h-5 text-[var(--accent)] fill-current transition-accent" />
            <span className="text-white font-semibold">
              {movie?.rating ? Number(movie.rating).toFixed(1) : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* FULL MOVIE/TV PLAYER - VIDSRC - TOP AND CENTER */}
      {movie?.imdb_id && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8 animate-fadeInUp stagger-2">
          <div className="glass-card rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-white flex items-center space-x-2">
                <Play className="w-7 h-7 text-[var(--accent)] transition-accent" />
                <span>{movie?.is_tv ? 'Watch TV Show Online' : 'Watch Full Movie Online'}</span>
              </h2>
              <span className="bg-[var(--accent)] text-[#0f1115] px-3 py-1 rounded-full text-sm font-bold shadow-lg shadow-[var(--accent)]/20 transition-accent">
                FREE STREAMING
              </span>
            </div>
            
            {/* VIDSRC EMBED - MOVIE OR TV SHOW */}
            <iframe
              src={
                movie?.is_tv 
                  ? `https://vidsrc.me/embed/tv?tmdb=${movie?.id || ''}&season=1&episode=1`
                  : `https://vidsrc.me/embed/movie?imdb=${movie?.imdb_id || ''}`
              }
              width="100%"
              height="500px"
              allowFullScreen
              className="w-full h-[500px] rounded-xl border border-white/5 mb-4 shadow-lg"
              title={`Watch ${movie?.title || 'Movie'}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            />
            
            <p className="text-[#8b94a6] text-sm text-center">
              {movie?.is_tv 
                ? `Streaming ${movie?.title || 'TV Show'} - Season 1, Episode 1. More episodes available in player.`
                : `Stream ${movie?.title || 'Movie'} in HD quality directly in your browser`
              }
            </p>
          </div>
        </div>
      )}

      {/* Movie Details Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Poster & Info */}
          <div className="lg:col-span-1 animate-fadeInUp stagger-3">
            <div className="sticky top-24">
              <img
                src={movie?.poster || DEFAULT_POSTER}
                alt={movie?.title || 'Movie Poster'}
                className="w-full rounded-2xl shadow-2xl border border-white/5"
                onError={(e) => {
                  e.target.src = DEFAULT_POSTER;
                }}
              />
              
              {/* IMDb Rating Box */}
              <div className="mt-4 glass-card rounded-2xl p-4 text-center">
                <div className="flex items-center justify-center space-x-2 mb-2">
                  <Star className="w-6 h-6 text-[var(--accent)] fill-current transition-accent" />
                  <span className="text-3xl font-bold text-[var(--accent)] transition-accent">
                    {movie?.rating ? Number(movie.rating).toFixed(1) : 'N/A'}
                  </span>
                  <span className="text-[#8b94a6]">/10</span>
                </div>
                <p className="text-[#8b94a6] text-sm">IMDb Rating</p>
                {movie?.imdb_id && (
                  <a
                    href={`https://www.imdb.com/title/${movie.imdb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 text-[var(--accent)] hover:text-[var(--accent-soft)] text-sm mt-2 transition-accent"
                  >
                    <span>View on IMDb</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* Movie Info Box */}
              <div className="mt-4 glass-card rounded-2xl p-4">
                <div className="space-y-3 text-sm">
                  {movie?.year && (
                    <div className="flex justify-between">
                      <span className="text-[#8b94a6]">Year:</span>
                      <span className="text-white font-semibold">{movie.year}</span>
                    </div>
                  )}
                  {movie?.runtime && (
                    <div className="flex justify-between">
                      <span className="text-[#8b94a6]">Runtime:</span>
                      <span className="text-white font-semibold">{movie.runtime} min</span>
                    </div>
                  )}
                  {movie?.type && (
                    <div className="flex justify-between">
                      <span className="text-[#8b94a6]">Type:</span>
                      <span className="text-white font-semibold capitalize">{movie.type}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Details, Trailer Button, Downloads */}
          <div className="lg:col-span-2 animate-fadeInUp stagger-4">
            
            {/* Genres */}
            {movie?.genres && Array.isArray(movie.genres) && movie.genres.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {movie.genres.map((genre, index) => (
                  <span
                    key={`genre-${index}-${genre}`}
                    className="bg-white/5 backdrop-blur-md text-[var(--accent)] px-4 py-2 rounded-full text-sm font-medium border border-white/10 transition-accent"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {/* Plot Summary */}
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-white mb-3">Plot Summary</h3>
              <p className="text-[#8b94a6] leading-relaxed text-lg">
                {movie?.plot || 'No description available.'}
              </p>
            </div>

            {/* Action Buttons Section */}
            <div className="flex flex-wrap gap-4 mb-8">
              {/* Watch Trailer Button - Conditional */}
              {movie?.yt_trailer_code && (
                <button
                  onClick={() => setShowTrailer(!showTrailer)}
                  className="bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl flex items-center space-x-2 transition-all duration-300 shadow-lg shadow-[var(--accent)]/20 hover:scale-105 active:scale-95"
                >
                  {showTrailer ? (
                    <>
                      <X className="w-5 h-5" />
                      <span>Close Trailer</span>
                    </>
                  ) : (
                    <>
                      <Video className="w-5 h-5" />
                      <span>Watch Trailer</span>
                    </>
                  )}
                </button>
              )}

              {/* IMDb Link Button */}
              {movie?.imdb_id && (
                <a
                  href={`https://www.imdb.com/title/${movie.imdb_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white/5 backdrop-blur-md hover:bg-white/10 text-white font-bold px-6 py-3 rounded-xl flex items-center space-x-2 transition-all duration-300 border border-white/10 hover:border-white/20 active:scale-95"
                >
                  <ExternalLink className="w-5 h-5" />
                  <span>View on IMDb</span>
                </a>
              )}
            </div>

            {/* Trailer Section - Conditionally Rendered */}
            {showTrailer && movie?.yt_trailer_code && (
              <div className="glass-card border-2 border-[var(--accent)]/30 rounded-2xl p-6 mb-8 animate-fadeInUp">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-2xl font-bold text-white flex items-center space-x-2">
                    <Video className="w-6 h-6 text-[var(--accent)] transition-accent" />
                    <span>Official Trailer</span>
                  </h3>
                  <button
                    onClick={() => setShowTrailer(false)}
                    className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                {/* YouTube Trailer Embed */}
                <iframe
                  src={`https://www.youtube.com/embed/${movie.yt_trailer_code}`}
                  width="100%"
                  height="400px"
                  allowFullScreen
                  className="w-full rounded-xl shadow-lg"
                  title={`${movie?.title || 'Movie'} Trailer`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
              </div>
            )}

            {/* Download Section */}
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-2xl font-bold text-white mb-1 flex items-center space-x-2">
                <Download className="w-6 h-6 text-[var(--accent)] transition-accent" />
                <span>{movie?.is_tv ? 'Download Season Packs' : 'Download Movie'}</span>
              </h3>
              <h4 className="text-xl font-bold text-[#8b94a6] mb-4">
                {movie?.is_tv ? 'කතාමාලා බාගත කරන්න' : 'චිත්‍රපටය බාගත කරන්න'}
              </h4>

              {/* Sinhala Subtitles Search Button */}
              <div className="mb-6">
                <a
                  href={`https://www.baiscope.lk/?s=${encodeURIComponent(movie?.title || '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white font-bold py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] flex items-center justify-center space-x-3 shadow-lg shadow-orange-500/30 active:scale-95"
                >
                  <MessageSquare className="w-6 h-6" />
                  <span>Sinhala Subtitles | සිංහල උපසිරැසි</span>
                </a>
                <p className="text-[#8b94a6] text-sm mt-2 text-center">
                  Search for Sinhala subtitles on Baiscope
                </p>
              </div>

              {hasTorrents ? (
                <div>
                  {/* Warning Message */}
                  <div className="bg-[var(--accent)]/10 border-l-4 border-[var(--accent)] rounded-lg p-4 mb-6 transition-accent">
                    <p className="text-[var(--accent)] text-sm font-medium flex items-start space-x-2 transition-accent">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <span>
                        Download option requires a torrent application installed on your device.
                      </span>
                    </p>
                  </div>

                  {/* Download Buttons - 3 Button System Per Quality */}
                  <div className="space-y-4">
                    {movie?.torrents?.map((torrent, index) => {
                      if (!torrent || !torrent.url) return null;
                      
                      return (
                        <div key={`torrent-${index}-${torrent.quality || index}`} className="glass-card rounded-xl p-4">
                          {/* Quality Header with Provider Badge */}
                          <div className="mb-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <h4 className="text-white font-bold text-lg">
                                Download Link {index + 1}: {torrent.quality || 'Unknown Quality'}
                                {torrent.size && (
                                  <span className="text-[#8b94a6] text-sm font-normal ml-2">
                                    ({torrent.size})
                                  </span>
                                )}
                              </h4>
                              {torrent.provider && (
                                <span className="bg-[var(--accent)]/20 border border-[var(--accent)]/30 text-[var(--accent)] px-3 py-1 rounded-full text-xs font-bold">
                                  {torrent.provider}
                                </span>
                              )}
                            </div>
                            {torrent.seeders !== undefined && (
                              <p className="text-[#8b94a6] text-xs mt-1">
                                Seeders: {torrent.seeders} | Leechers: {torrent.leechers || 0}
                              </p>
                            )}
                          </div>

                          {/* 2 Button Group - Both use WebtorModal */}
                          <div className="flex flex-col sm:flex-row gap-3 mt-4">
                            {/* 1. Watch Online - Dark Glassmorphism */}
                            <button
                              onClick={() => setActiveWebtorMagnet(torrent.url)}
                              className="flex-1 bg-[#252833]/80 backdrop-blur-md border border-white/10 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 flex items-center justify-center space-x-2 hover:bg-[#323644]/80 hover:border-white/20 hover:-translate-y-1 active:scale-95"
                            >
                              <Play className="w-5 h-5" />
                              <span>Watch Online | ඔන්ලයින් නරඹන්න</span>
                            </button>

                            {/* 2. Download - Solid Neon Orange */}
                            <button
                              onClick={() => setActiveWebtorMagnet(torrent.url)}
                              className="flex-1 bg-[#ff9900] text-[#0f1115] font-bold py-3 px-6 rounded-xl transition-all duration-300 flex items-center justify-center space-x-2 hover:shadow-[0_0_15px_rgba(255,153,0,0.4)] hover:-translate-y-1 active:scale-95"
                            >
                              <Download className="w-5 h-5" />
                              <span>Download | බාගත කරන්න</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Info Box */}
                  <div className="mt-6 glass-card rounded-xl p-4">
                    <p className="text-[#8b94a6] text-sm leading-relaxed">
                      <strong className="text-white">How It Works:</strong><br />
                      • Both buttons open Webtor.io player in a modal without leaving the site.<br />
                      • <strong className="text-white">Watch Online:</strong> Stream directly in your browser.<br />
                      • <strong className="text-[#ff9900]">Download:</strong> Download files through Webtor.io gateway.<br />
                      • Press <kbd className="bg-white/10 px-2 py-1 rounded text-white">ESC</kbd> or click the X button to close the player.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="glass-card rounded-xl p-8 text-center">
                  <AlertCircle className="w-16 h-16 text-[#8b94a6] mx-auto mb-4" />
                  <h4 className="text-xl font-bold text-white mb-2">Links not available right now</h4>
                  <h5 className="text-lg font-bold text-[#8b94a6] mb-4">දැනට බාගත කිරීමේ පහසුකම් නොමැත</h5>
                  <p className="text-[#8b94a6] mb-6">
                    Please check back later or search manually.
                  </p>
                  <a
                    href={`https://1377x.to/search/${encodeURIComponent(movie?.title || 'movie')}/1/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-2 bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-[var(--accent)]/20 active:scale-95"
                  >
                    <Search className="w-5 h-5" />
                    <span>Search Manually | අතින් සොයන්න</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Spacing */}
      <div className="h-20" />

      {/* WebtorModal - Webtor.io Iframe Player */}
      <WebtorModal
        isOpen={activeWebtorMagnet !== null}
        onClose={() => setActiveWebtorMagnet(null)}
        magnetLink={activeWebtorMagnet || ''}
        title={movie?.title || 'Movie Player'}
      />
    </div>
  );
};

export default SingleMovie;