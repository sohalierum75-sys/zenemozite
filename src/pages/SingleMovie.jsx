import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Download, Star, Clock, Calendar, ChevronLeft, Loader2, AlertCircle, ExternalLink, Video, X, Search, MessageSquare, Sparkles, Server, Film } from 'lucide-react';
import ReportBrokenLink from '../components/ReportBrokenLink';
import DownloadButton from '../components/DownloadButton';
import DirectStreamButton from '../components/DirectStreamButton';
import TelegramQualityDownloads from '../components/TelegramQualityDownloads';
import { useLocale } from '../context/LocaleContext';

import { API_BASE_URL, buildDownloadUrl } from '../config/api';

const DEFAULT_POSTER = 'https://via.placeholder.com/400x600/1a1d29/8b94a6?text=No+Poster';
const DEFAULT_BACKDROP = 'https://via.placeholder.com/1920x1080/0f1115/8b94a6?text=No+Image';

/**
 * Styling helper for quality badges and buttons
 */
const getQualityStyle = (quality = '') => {
  const q = String(quality).toLowerCase();
  if (q.includes('4k') || q.includes('2160')) {
    return {
      gradient: 'from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500',
      badge: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
      shadow: 'hover:shadow-[0_0_25px_rgba(236,72,153,0.45)]',
      label: '4K Ultra HD',
    };
  }
  if (q.includes('1080')) {
    return {
      gradient: 'from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:via-purple-500 hover:to-pink-500',
      badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      shadow: 'hover:shadow-[0_0_25px_rgba(99,102,241,0.45)]',
      label: '1080p Full HD',
    };
  }
  if (q.includes('720')) {
    return {
      gradient: 'from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500',
      badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      shadow: 'hover:shadow-[0_0_25px_rgba(14,165,233,0.45)]',
      label: '720p HD',
    };
  }
  return {
    gradient: 'from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    shadow: 'hover:shadow-[0_0_25px_rgba(245,158,11,0.45)]',
    label: '480p SD',
  };
};

const SingleMovie = () => {
  const { id } = useParams();
  const { isLk } = useLocale();
  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState(null);

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

      if (movieData) {
        // Normalize downloadLinks and download_links to ensure both keys are populated arrays
        const rawLinks =
          movieData.download_links ||
          movieData.downloadLinks ||
          movieData.data?.download_links ||
          movieData.data?.downloadLinks ||
          result?.data?.download_links ||
          result?.data?.downloadLinks ||
          [];

        let linksArray = [];
        if (Array.isArray(rawLinks)) {
          linksArray = rawLinks;
        } else if (typeof rawLinks === 'string') {
          try {
            const parsed = JSON.parse(rawLinks);
            if (Array.isArray(parsed)) linksArray = parsed;
          } catch { }
        }
        movieData.download_links = linksArray;
        movieData.downloadLinks = linksArray;

        // Normalize telegram_files and telegramFiles to ensure populated arrays
        const rawTg =
          movieData.telegram_files ||
          movieData.telegramFiles ||
          movieData.data?.telegram_files ||
          movieData.data?.telegramFiles ||
          result?.data?.telegram_files ||
          result?.data?.telegramFiles ||
          [];

        let tgArray = [];
        if (Array.isArray(rawTg)) {
          tgArray = rawTg;
        } else if (typeof rawTg === 'string') {
          try {
            const parsed = JSON.parse(rawTg);
            if (Array.isArray(parsed)) tgArray = parsed;
          } catch { }
        }
        movieData.telegram_files = tgArray;
        movieData.telegramFiles = tgArray;

        setMovie(movieData);
        setError(null);
        console.log('[MOVIE] Successfully set movie:', movieData.title, 'links:', linksArray.length, 'tg_files:', tgArray.length);
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

  // Called by ReportBrokenLink once the backend finds a replacement magnet.
  // Updates the torrent list AND automatically resumes the direct download
  // generation with the new magnet - no refresh or extra clicks needed.
  const handleLinkReplaced = (newTorrent) => {
    if (!newTorrent || !newTorrent.url) return;

    console.log('[MOVIE] Broken link replaced - resuming download with new magnet');

    // Put the fresh, high-seeded torrent at the top of the list
    setMovie((prev) =>
      prev
        ? { ...prev, torrents: [newTorrent, ...(prev.torrents || [])] }
        : prev
    );
  };

  // 1. Add Console Log to inspect state
  console.log("Movie Data State:", movie);

  // Extract Telegram files array safely
  const candidateTgList = [
    movie?.telegram_files,
    movie?.telegramFiles,
    movie?.data?.telegram_files,
    movie?.data?.telegramFiles
  ];
  let rawTgFiles = candidateTgList.find(c => Array.isArray(c) && c.length > 0);
  if (!rawTgFiles) {
    for (const c of candidateTgList) {
      if (typeof c === 'string' && c.trim().length > 2 && c.trim() !== '[]') {
        try {
          const parsed = JSON.parse(c);
          if (Array.isArray(parsed) && parsed.length > 0) {
            rawTgFiles = parsed;
            break;
          }
        } catch { }
      }
    }
  }

  const telegramFiles = Array.isArray(rawTgFiles) ? rawTgFiles : [];
  const hasTelegramFiles = telegramFiles.length > 0;
  const telegramSync = movie?.telegram_sync || movie?.telegramSync || null;
  const syncStatus = telegramSync?.status || (hasTelegramFiles ? 'ready' : 'none');
  const syncError = telegramSync?.message || movie?.telegram_sync_error || null;

  // Handler for direct browser download from /api/download/:file_id
  const handleTelegramDownload = (file) => {
    if (!file?.file_id) return;
    const fileId = file.file_id;
    setDownloadingFileId(fileId);

    const downloadUrl = buildDownloadUrl(fileId, movie?.title);
    console.log(`[TELEGRAM_DOWNLOAD] Triggering download for file ${fileId} (${file.quality}):`, downloadUrl);

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `${(movie?.title || 'movie').replace(/[^\w.\- ]/g, '_')}_${file.quality || 'video'}.mp4`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setDownloadingFileId(null);
    }, 2500);
  };

  // 1. Extract the Links Safely: Create a variable before the return statement that checks all possible paths to the links array
  const candidateList = [
    movie?.download_links,
    movie?.downloadLinks,
    movie?.data?.download_links,
    movie?.data?.downloadLinks,
  ];

  let activeStateLinks = candidateList.find(c => Array.isArray(c) && c.length > 0);
  if (!activeStateLinks) {
    for (const c of candidateList) {
      if (typeof c === 'string' && c.trim().length > 2 && c.trim() !== '[]') {
        try {
          const parsed = JSON.parse(c);
          if (Array.isArray(parsed) && parsed.length > 0) {
            activeStateLinks = parsed;
            break;
          }
        } catch { }
      }
    }
  }

  const linksArray = activeStateLinks || movie?.download_links || movie?.downloadLinks || movie?.data?.download_links || movie?.data?.downloadLinks || [];
  // If it's stored as a stringified JSON by mistake, parse it:
  let parsedLinks = linksArray;
  try {
    parsedLinks = typeof linksArray === 'string' ? JSON.parse(linksArray) : linksArray;
  } catch (err) {
    console.error("Failed to parse linksArray JSON:", err);
    parsedLinks = [];
  }

  const directLinks = Array.isArray(parsedLinks) ? parsedLinks : [];

  const hasTorrents = (movie?.torrents || movie?.data?.torrents) &&
    Array.isArray(movie?.torrents || movie?.data?.torrents) &&
    (movie?.torrents || movie?.data?.torrents).length > 0;
  const hasDirectLinks = directLinks.length > 0;
  const hasDownloadOptions = hasTelegramFiles || hasDirectLinks || hasTorrents;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f1115]">
        <div className="text-center">
          <div className="h-16 w-16 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)] mx-auto mb-4" />
          <p className="text-white text-xl font-semibold">Loading movie details...</p>
          {isLk && <p className="text-[#8b94a6] text-sm mt-2">විස්තර ලබා ගනිමින් පවතී...</p>}
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
          {isLk && <h3 className="text-xl text-[#8b94a6] mb-4">චිත්‍රපටය හමු නොවිණි</h3>}
          <p className="text-[#8b94a6] mb-6">
            {error || 'The movie you are looking for is not available.'}
          </p>
          <Link
            to="/"
            className="inline-block bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20 active:scale-95"
          >
            Return to Home{isLk ? ' | මුල් පිටුවට යන්න' : ''}
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
          {isLk && <h3 className="text-xl text-[#8b94a6] mb-4">වලංගු නොවන දත්ත</h3>}
          <p className="text-[#8b94a6] mb-6">
            The movie data is incomplete or invalid.
          </p>
          <Link
            to="/"
            className="inline-block bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20 active:scale-95"
          >
            Return to Home{isLk ? ' | මුල් පිටුවට යන්න' : ''}
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
                {isLk && (movie?.is_tv ? 'කතාමාලා බාගත කරන්න' : 'චිත්‍රපටය බාගත කරන්න')}
              </h4>

              {/* Sinhala Subtitles Search Button */}
              {isLk && (
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
              )}

              {/* 1. Direct Cloud Downloads Section (Google Drive, Mega, Pixeldrain, YTS Direct) */}
              {hasDirectLinks && (
                <div className="glass-card rounded-2xl p-6 mb-6 border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-black/40 to-black/60 shadow-xl relative z-30 focus-within:z-50">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-5 h-5 text-emerald-400" />
                      <h4 className="text-white font-bold text-lg">
                        {isLk ? 'සෘජු බාගත කිරීම් (DDL)' : 'Direct Cloud Downloads (DDL)'}
                      </h4>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                      {directLinks.length} Link{directLinks.length > 1 ? 's' : ''} Available
                    </span>
                  </div>
                  <p className="text-[#8b94a6] text-sm mb-4">
                    {isLk
                      ? 'Google Drive, Mega, Pixeldrain, සහ YTS වෙතින් සෘජු බාගත කිරීමේ සබැඳි.'
                      : 'High-speed direct file downloads from Google Drive, Mega, Pixeldrain, and direct CDNs.'}
                  </p>
                  <div className="flex flex-col sm:flex-row items-stretch gap-3 max-w-xl relative z-30 focus-within:z-50">
                    <DownloadButton
                      movieId={movie?.id || movie?.title}
                      title={movie?.title}
                      downloadLinks={directLinks}
                      movie={movie}
                      label={isLk ? 'Download File (DDL) | සෘජු බාගත කිරීම' : 'Download File (DDL)'}
                      className="w-full sm:w-auto flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:-translate-y-0.5"
                    />
                    {movie?.torrents?.[0]?.url && (
                      <DirectStreamButton
                        movieId={movie?.id || movie?.title}
                        title={movie?.title}
                        magnetLink={movie?.torrents?.[0]?.url}
                        label={isLk ? 'Direct Download | සෘජු බාගත කිරීම' : 'Direct Download'}
                        className="w-full sm:w-auto flex-1"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* 2. Automated Multi-Quality Telegram Downloads (480p, 720p, 1080p, 4K) */}
              {hasTelegramFiles && (
                <TelegramQualityDownloads
                  movie={movie}
                  files={telegramFiles}
                  isLk={isLk}
                  className="mb-6"
                />
              )}

              {/* 3. Non-blocking Telegram Sync Indicator (Only when sync is actively in progress) */}
              {!hasTelegramFiles && syncStatus === 'syncing' && (
                <div className="glass-card rounded-2xl p-4 text-center mb-6 border border-blue-500/20 bg-blue-500/5">
                  <div className="flex items-center justify-center space-x-2 text-blue-300 text-xs font-semibold">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    <span>
                      {isLk
                        ? 'ටෙලිග්‍රෑම් ගුණාත්මක විකල්ප පසුබිමේ සකස් වෙමින් පවතී (ඉහත සෘජු බාගත කිරීම් භාවිත කළ හැක).'
                        : 'Telegram multi-quality variants synchronizing in background (Direct downloads above remain available).'}
                    </span>
                  </div>
                </div>
              )}

              {/* 4. Webtor & Torrent Streaming / Download Section */}
              {hasTorrents && (
                <div className="glass-card rounded-2xl p-6 mb-6 border border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-black/40 to-black/60 shadow-xl relative z-10">
                  <div className="flex items-center justify-between flex-wrap gap-3 pb-4 mb-5 border-b border-white/10">
                    <div className="flex items-center space-x-3">
                      <div className="p-2.5 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-500/20">
                        <Server className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                          <span>Torrent & Magnet Downloads</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-semibold">
                            Torrent Sources
                          </span>
                        </h3>
                        <p className="text-xs text-[#8b94a6] mt-0.5">
                          Download options for high-speed torrent and magnet files
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-white/10 text-white/90 border border-white/15">
                      {(movie?.torrents || []).length} {(movie?.torrents || []).length === 1 ? 'Source' : 'Sources'} Available
                    </span>
                  </div>

                  {/* Torrents List */}
                  <div className="space-y-4">
                    {movie?.torrents?.map((torrent, index) => {
                      if (!torrent || !torrent.url) return null;

                      return (
                        <div key={`torrent-${index}-${torrent.quality || index}`} className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-md p-4 transition-all duration-300 hover:border-white/20">
                          {/* Quality Header with Provider Badge */}
                          <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                            <h4 className="text-white font-bold text-base flex items-center gap-2">
                              <span>Source {index + 1}: {torrent.quality || 'Standard Quality'}</span>
                              {torrent.size && (
                                <span className="text-[#8b94a6] text-xs font-normal">
                                  ({torrent.size})
                                </span>
                              )}
                            </h4>
                            <div className="flex items-center gap-2">
                              {torrent.provider && (
                                <span className="bg-[var(--accent)]/20 border border-[var(--accent)]/30 text-[var(--accent)] px-2.5 py-0.5 rounded-full text-xs font-bold">
                                  {torrent.provider}
                                </span>
                              )}
                              {torrent.seeders !== undefined && (
                                <span className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                                  {torrent.seeders} seeders
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons: BOTH Download Options and Direct Download restored side-by-side */}
                          <div className="mt-3 flex flex-col sm:flex-row items-stretch gap-3 relative z-10 focus-within:z-50">
                            <DownloadButton
                              movieId={movie?.title}
                              title={movie?.title}
                              magnetLink={torrent.url}
                              downloadLinks={directLinks}
                              movie={movie}
                              label={isLk ? 'Download Options | බාගත විකල්ප' : 'Download Options'}
                              className="w-full sm:w-auto flex-1 bg-[#ff9900] text-[#0f1115] hover:shadow-[0_0_15px_rgba(255,153,0,0.4)] hover:-translate-y-0.5"
                            />
                            <DirectStreamButton
                              movieId={movie?.title}
                              title={movie?.title}
                              magnetLink={torrent.url}
                              label={isLk ? 'Direct Download | සෘජු බාගත කිරීම' : 'Direct Download'}
                              className="w-full sm:w-auto flex-1"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {hasDownloadOptions ? (
                <div className="relative z-10">
                  {/* Automated Report & Fix Broken Link */}
                  <ReportBrokenLink
                    title={movie?.title}
                    year={movie?.year}
                    imdbId={movie?.imdb_id}
                    movieId={movie?.id}
                    mediaType={movie?.type || 'movie'}
                    onLinkReplaced={handleLinkReplaced}
                  />

                  {/* Info Box */}
                  <div className="mt-6 glass-card rounded-xl p-4">
                    <p className="text-[#8b94a6] text-sm leading-relaxed">
                      <strong className="text-white">Download Options:</strong><br />
                      • <strong className="text-[#a855f7]">Telegram Direct:</strong> Click any quality button (<strong className="text-[#6366f1]">1080p</strong>, <strong className="text-[#0ea5e9]">720p</strong>, or <strong className="text-[#f59e0b]">480p</strong>) for instant high-speed browser downloads.<br />
                      • <strong className="text-[#f97316]">Torrent & Cloud Downloads:</strong> Click "Download Options" to choose between direct cloud links, torrent magnets, or streaming options.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="glass-card rounded-xl p-8 text-center">
                  <AlertCircle className="w-16 h-16 text-[#8b94a6] mx-auto mb-4" />
                  <h4 className="text-xl font-bold text-white mb-2">{isLk ? 'බාගත කිරීම් දැනට නොමැත' : 'No downloads available'}</h4>
                  {isLk && <h5 className="text-lg font-bold text-[#8b94a6] mb-4">දැනට බාගත කිරීමේ පහසුකම් නොමැත</h5>}
                  <p className="text-[#8b94a6] mb-6">
                    Please check back later or search manually.
                  </p>

                  {/* Automated Report & Fix Broken Link */}
                  <div className="max-w-md mx-auto text-left">
                    <ReportBrokenLink
                      title={movie?.title}
                      year={movie?.year}
                      imdbId={movie?.imdb_id}
                      movieId={movie?.id}
                      mediaType={movie?.type || 'movie'}
                      onLinkReplaced={handleLinkReplaced}
                    />
                  </div>
                  <a
                    href={`https://1377x.to/search/${encodeURIComponent(movie?.title || 'movie')}/1/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-2 bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-[var(--accent)]/20 active:scale-95"
                  >
                    <Search className="w-5 h-5" />
                    <span>{isLk ? 'Search Manually | අතින් සොයන්න' : 'Search Manually'}</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Spacing */}
      <div className="h-20" />
    </div>
  );
};

export default SingleMovie;