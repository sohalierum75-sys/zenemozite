import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Play, Download, Star, Clock, Calendar, ChevronLeft, Loader2, AlertCircle, ExternalLink, Video, X, ChevronDown, MessageSquare } from 'lucide-react';
import { useLocale } from '../context/LocaleContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const DEFAULT_POSTER = 'https://via.placeholder.com/400x600/1a1d29/8b94a6?text=No+Poster';
const DEFAULT_BACKDROP = 'https://via.placeholder.com/1920x1080/0f1115/8b94a6?text=No+Image';
const DEFAULT_EPISODE_STILL = 'https://via.placeholder.com/533x300/1a1d29/8b94a6?text=No+Image';

const SingleTV = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isLk } = useLocale();
  const [tvShow, setTVShow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  
  // Season/Episode state
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [episodes, setEpisodes] = useState([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState(null);
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);

  useEffect(() => {
    if (id) {
      fetchTVShow();
    }
  }, [id]);

  useEffect(() => {
    if (tvShow && selectedSeason) {
      fetchSeasonEpisodes(selectedSeason);
    }
  }, [selectedSeason, tvShow]);

  const fetchTVShow = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log(`[TV] Fetching TV show ID: ${id}`);
      
      // FIXED: Use /api/tv/:id endpoint instead of /api/movies/:id
      const response = await fetch(`${API_BASE_URL}/tv/${id}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      let tvShowData = null;
      
      if (result?.success && result?.data) {
        tvShowData = result.data;
      } else if (result?.data) {
        tvShowData = result.data;
      } else if (result && typeof result === 'object' && result.id) {
        tvShowData = result;
      } else {
        throw new Error('Invalid response structure');
      }

      if (tvShowData && tvShowData.id) {
        setTVShow(tvShowData);
        setError(null);
        console.log('[TV] Successfully loaded TV show:', tvShowData.title);
      } else {
        setError('TV show not found');
        setTVShow(null);
      }
    } catch (err) {
      console.error('[TV] API Fetch Error:', err);
      setError(err.message || 'Unable to connect to server');
      setTVShow(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchSeasonEpisodes = async (seasonNumber) => {
    try {
      setEpisodesLoading(true);
      setEpisodesError(null);
      
      console.log(`[TV] Fetching episodes for season ${seasonNumber}...`);
      
      const response = await fetch(`${API_BASE_URL}/tv/${id}/season/${seasonNumber}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.data && result.data.episodes) {
        setEpisodes(result.data.episodes);
        console.log(`[TV] Loaded ${result.data.episodes.length} episodes for season ${seasonNumber}`);
      } else {
        setEpisodes([]);
        setEpisodesError('No episodes found for this season');
      }
    } catch (err) {
      console.error('[TV] Episode fetch error:', err);
      setEpisodesError(err.message || 'Failed to load episodes');
      setEpisodes([]);
    } finally {
      setEpisodesLoading(false);
    }
  };

  const handleSeasonChange = (seasonNumber) => {
    setSelectedSeason(seasonNumber);
    setSeasonDropdownOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f1115]">
        <div className="text-center">
          <div className="h-16 w-16 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)] mx-auto mb-4" />
          <p className="text-white text-xl font-semibold">Loading TV show details...</p>
          {isLk && <p className="text-[#8b94a6] text-sm mt-2">විස්තර ලබා ගනිමින් පවතී...</p>}
        </div>
      </div>
    );
  }

  if (error || !tvShow) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-[#0f1115]">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-[var(--accent)] mx-auto mb-4" />
          <h2 className="text-2xl font-extrabold text-white mb-2">TV Show Not Found</h2>
          {isLk && <h3 className="text-xl text-[#8b94a6] mb-4">කතාමාලාව හමු නොවිණි</h3>}
          <p className="text-[#8b94a6] mb-6">
            {error || 'The TV show you are looking for is not available.'}
          </p>
          <Link 
            to="/tv-shows" 
            className="inline-block bg-[var(--accent)] text-[#0f1115] font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-[var(--accent)]/20 active:scale-95"
          >
            Browse TV Shows{isLk ? ' | කතාමාලා බලන්න' : ''}
          </Link>
        </div>
      </div>
    );
  }

  // Determine number of seasons (fallback to 1 if not specified)
  const totalSeasons = tvShow.number_of_seasons || 5;

  return (
    <div className="min-h-screen bg-[#0f1115]">
      {/* Back Button */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fadeInUp">
        <button 
          onClick={() => navigate(-1)} 
          className="inline-flex items-center space-x-2 text-[#8b94a6] hover:text-[var(--accent)] transition-accent"
        >
          <ChevronLeft className="w-5 h-5" />
          <span>{isLk ? 'Back | ආපසු' : 'Back'}</span>
        </button>
      </div>

      {/* TV Show Title */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6 animate-fadeInUp stagger-1">
        <h1 className="text-hero font-extrabold text-white mb-2 tracking-tight">
          {tvShow?.title || 'Unknown Title'}
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-[#8b94a6]">
          {tvShow?.year && (
            <div className="flex items-center space-x-2">
              <Calendar className="w-5 h-5 text-[var(--accent)] transition-accent" />
              <span>{tvShow.year}</span>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <Star className="w-5 h-5 text-[var(--accent)] fill-current transition-accent" />
            <span className="text-white font-semibold">
              {tvShow?.rating ? Number(tvShow.rating).toFixed(1) : 'N/A'}
            </span>
          </div>
          <span className="bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)] px-3 py-1 rounded-full text-sm font-bold transition-accent">
            TV SERIES
          </span>
        </div>
      </div>

      {/* Vidsrc Player */}
      {tvShow?.imdb_id && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8 animate-fadeInUp stagger-2">
          <div className="glass-card rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-white flex items-center space-x-2">
                <Play className="w-7 h-7 text-[var(--accent)] transition-accent" />
                <span>Watch TV Show Online</span>
              </h2>
              <span className="bg-[var(--accent)] text-[#0f1115] px-3 py-1 rounded-full text-sm font-bold shadow-lg shadow-[var(--accent)]/20 transition-accent">
                FREE STREAMING
              </span>
            </div>
            
            <iframe
              src={`https://vidsrc.me/embed/tv?tmdb=${tvShow?.id || ''}&season=${selectedSeason}&episode=1`}
              width="100%"
              height="500px"
              allowFullScreen
              className="w-full h-[500px] rounded-xl border border-white/5 mb-4 shadow-lg"
              title={`Watch ${tvShow?.title || 'TV Show'}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            />
            
            <p className="text-[#8b94a6] text-sm text-center">
              Streaming Season {selectedSeason}, Episode 1. Navigate to other episodes using the player controls or download specific episodes below.
            </p>
          </div>
        </div>
      )}

      {/* TV Show Details */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Poster & Info */}
          <div className="lg:col-span-1 animate-fadeInUp stagger-3">
            <div className="sticky top-24">
              <img
                src={tvShow?.poster || DEFAULT_POSTER}
                alt={tvShow?.title || 'TV Show Poster'}
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
                    {tvShow?.rating ? Number(tvShow.rating).toFixed(1) : 'N/A'}
                  </span>
                  <span className="text-[#8b94a6]">/10</span>
                </div>
                <p className="text-[#8b94a6] text-sm">IMDb Rating</p>
                {tvShow?.imdb_id && (
                  <a
                    href={`https://www.imdb.com/title/${tvShow.imdb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 text-[var(--accent)] hover:text-[var(--accent-soft)] text-sm mt-2 transition-accent"
                  >
                    <span>View on IMDb</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* TV Show Info Box */}
              <div className="mt-4 glass-card rounded-2xl p-4">
                <div className="space-y-3 text-sm">
                  {tvShow?.year && (
                    <div className="flex justify-between">
                      <span className="text-[#8b94a6]">First Aired:</span>
                      <span className="text-white font-semibold">{tvShow.year}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#8b94a6]">Type:</span>
                    <span className="text-white font-semibold">TV Series</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8b94a6]">Seasons:</span>
                    <span className="text-white font-semibold">{totalSeasons}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Details, Seasons, Episodes */}
          <div className="lg:col-span-2 animate-fadeInUp stagger-4">
            
            {/* Genres */}
            {tvShow?.genres && Array.isArray(tvShow.genres) && tvShow.genres.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {tvShow.genres.map((genre, index) => (
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
                {tvShow?.plot || 'No description available.'}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-4 mb-8">
              {tvShow?.yt_trailer_code && (
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

              {tvShow?.imdb_id && (
                <a
                  href={`https://www.imdb.com/title/${tvShow.imdb_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white/5 backdrop-blur-md hover:bg-white/10 text-white font-bold px-6 py-3 rounded-xl flex items-center space-x-2 transition-all duration-300 border border-white/10 hover:border-white/20 active:scale-95"
                >
                  <ExternalLink className="w-5 h-5" />
                  <span>View on IMDb</span>
                </a>
              )}
            </div>

            {/* Trailer Section */}
            {showTrailer && tvShow?.yt_trailer_code && (
              <div className="glass-card border-2 border-[var(--accent)]/30 rounded-2xl p-6 mb-8 animate-fadeInUp transition-accent">
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
                
                <iframe
                  src={`https://www.youtube.com/embed/${tvShow.yt_trailer_code}`}
                  width="100%"
                  height="400px"
                  allowFullScreen
                  className="w-full rounded-xl shadow-lg"
                  title={`${tvShow?.title || 'TV Show'} Trailer`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
              </div>
            )}

            {/* Season Selector & Episodes Section */}
            <div className="glass-card rounded-2xl p-6 mb-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-white">Episodes</h3>
                
                {/* Season Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setSeasonDropdownOpen(!seasonDropdownOpen)}
                    className="bg-white/5 backdrop-blur-md hover:bg-white/10 text-white font-bold px-6 py-3 rounded-xl flex items-center space-x-2 transition-all duration-300 border border-white/10 hover:border-[var(--accent)]/30"
                  >
                    <span>Season {selectedSeason}</span>
                    <ChevronDown className={`w-5 h-5 transition-transform ${seasonDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {seasonDropdownOpen && (
                    <div className="absolute right-0 top-full mt-2 bg-[#1a1c23]/95 backdrop-blur-lg border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 min-w-[200px]">
                      <div className="max-h-64 overflow-y-auto">
                        {[...Array(totalSeasons)].map((_, index) => {
                          const seasonNum = index + 1;
                          return (
                            <button
                              key={seasonNum}
                              onClick={() => handleSeasonChange(seasonNum)}
                              className={`w-full px-6 py-3 text-left transition-all duration-200 ${
                                selectedSeason === seasonNum
                                  ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-bold'
                                  : 'text-white hover:bg-white/5'
                              }`}
                            >
                              Season {seasonNum}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Sinhala Subtitles Search Button — only rendered for visitors in Sri Lanka (LK).
                  All other countries (and geo-detection failures) get the English-only UI. */}
              {isLk && (
              <div className="mb-6">
                <a
                  href={`https://www.baiscope.lk/?s=${encodeURIComponent(tvShow?.title || '')}+S${selectedSeason.toString().padStart(2, '0')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white font-bold py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] flex items-center justify-center space-x-3 shadow-lg shadow-orange-500/30 active:scale-95"
                >
                  <MessageSquare className="w-6 h-6" />
                  <span>Sinhala Subtitles for Season {selectedSeason} | සිංහල උපසිරැසි</span>
                </a>
              </div>
              )}

              {/* Episodes List */}
              {episodesLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
                      <div className="flex gap-4">
                        <div className="w-40 h-24 bg-white/5 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-white/5 rounded w-3/4" />
                          <div className="h-3 bg-white/5 rounded w-1/2" />
                          <div className="h-3 bg-white/5 rounded w-full" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : episodesError ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-[#8b94a6] mx-auto mb-4" />
                  <p className="text-[#8b94a6]">{episodesError}</p>
                </div>
              ) : episodes.length > 0 ? (
                <div className="space-y-4">
                  {episodes.map((episode, index) => (
                    <div
                      key={`episode-${episode.id}-${index}`}
                      className="glass-card rounded-xl p-4 hover:bg-[#1a1c23]/90 transition-all duration-300"
                    >
                      <div className="flex flex-col md:flex-row gap-4">
                        {/* Episode Thumbnail */}
                        <div className="relative w-full md:w-48 h-28 flex-shrink-0 rounded-lg overflow-hidden bg-[#0f1115]">
                          <img
                            src={episode.still_path || DEFAULT_EPISODE_STILL}
                            alt={episode.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.src = DEFAULT_EPISODE_STILL;
                            }}
                          />
                          {episode.vote_average > 0 && (
                            <div className="absolute top-2 right-2 bg-[var(--accent)] text-[#0f1115] px-2 py-1 rounded-lg flex items-center space-x-1 text-xs font-bold shadow-lg transition-accent">
                              <Star className="w-3 h-3 fill-current" />
                              <span>{episode.vote_average.toFixed(1)}</span>
                            </div>
                          )}
                          <div className="absolute bottom-2 left-2 bg-[#0f1115]/80 backdrop-blur-sm text-white px-2 py-1 rounded text-xs font-bold">
                            E{episode.episode_number}
                          </div>
                        </div>

                        {/* Episode Details */}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-white font-bold text-lg mb-1">
                            {episode.episode_number}. {episode.name}
                          </h4>
                          
                          <div className="flex items-center space-x-3 text-sm text-[#8b94a6] mb-2">
                            {episode.air_date && (
                              <span className="flex items-center space-x-1">
                                <Calendar className="w-4 h-4" />
                                <span>{new Date(episode.air_date).toLocaleDateString()}</span>
                              </span>
                            )}
                            {episode.runtime && (
                              <span className="flex items-center space-x-1">
                                <Clock className="w-4 h-4" />
                                <span>{episode.runtime}min</span>
                              </span>
                            )}
                          </div>

                          <p className="text-[#8b94a6] text-sm mb-4 line-clamp-2">
                            {episode.overview || 'No description available.'}
                          </p>

                          {/* Episode Download Buttons - 3 Button System */}
                          {episode.torrents && episode.torrents.length > 0 ? (
                            <div className="space-y-3">
                              {episode.torrents.map((torrent, tIndex) => (
                                <div key={`torrent-${tIndex}`} className="glass-card rounded-lg p-3">
                                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                                    <p className="text-white font-semibold text-sm">
                                      Link {tIndex + 1}: {torrent.quality} - {torrent.size}
                                      {torrent.isSeasonPack && (
                                        <span className="ml-2 text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">
                                          Season Pack
                                        </span>
                                      )}
                                    </p>
                                    {torrent.provider && (
                                      <span className="bg-[var(--accent)]/20 border border-[var(--accent)]/30 text-[var(--accent)] px-2 py-1 rounded-full text-xs font-bold">
                                        {torrent.provider}
                                      </span>
                                    )}
                                  </div>
                                  {torrent.seasonPackNote && (
                                    <p className="text-[#8b94a6] text-xs mb-2">{torrent.seasonPackNote}</p>
                                  )}
                                  {torrent.seeders !== undefined && (
                                    <p className="text-[#8b94a6] text-xs mb-2">
                                      Seeders: {torrent.seeders} | Leechers: {torrent.leechers || 0}
                                    </p>
                                  )}
                                  
                                  {/* Download - opens webtor.io in a NEW tab with the magnet link.
                                      A fire-and-forget onClick ALSO queues the episode in the
                                      backend Telegram CDN worker (VPS keeps caching regardless). */}
                                  <div className="mt-3">
                                    <a
                                      href={`https://webtor.io/${torrent.url}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={() => {
                                        // Backend Telegram backup (fire-and-forget) — never blocks navigation
                                        const queueUrl = `${API_BASE_URL}/download/${encodeURIComponent(`${tvShow?.title || 'Show'} - ${episode?.name || 'Episode'}`)}?magnet=${encodeURIComponent(torrent.url)}`;
                                        fetch(queueUrl).catch(() => {});
                                      }}
                                      className="w-full bg-[#ff9900] text-[#0f1115] font-medium py-2 px-4 rounded-lg transition-all duration-300 flex items-center justify-center space-x-2 hover:shadow-[0_0_15px_rgba(255,153,0,0.4)] text-sm active:scale-95"
                                    >
                                      <Download className="w-4 h-4" />
                                      <span>{isLk ? 'Download | බාගත කරන්න' : 'Download'}</span>
                                    </a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="glass-card rounded-lg p-4 border border-white/5">
                              <div className="flex items-center space-x-3 mb-3">
                                <AlertCircle className="w-5 h-5 text-[#8b94a6] flex-shrink-0" />
                                <div>
                                  <p className="text-white font-semibold text-sm">Links Not Available (0 Seeders)</p>
                                  {isLk && <p className="text-[#8b94a6] text-xs">දැනට ලින්ක්ස් නොමැත</p>}
                                </div>
                              </div>
                              
                              {/* Disabled Button State */}
                              <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                  disabled
                                  className="flex-1 bg-[#1a1c23]/50 backdrop-blur-md border border-white/5 text-[#4a5568] font-medium py-2 px-4 rounded-lg flex items-center justify-center space-x-2 text-sm cursor-not-allowed opacity-50"
                                >
                                  <Play className="w-4 h-4" />
                                  <span>Watch Online</span>
                                </button>
                                
                                <button
                                  disabled
                                  className="flex-1 border border-white/5 text-[#4a5568] font-medium py-2 px-4 rounded-lg flex items-center justify-center space-x-2 text-sm cursor-not-allowed opacity-50"
                                >
                                  <Download className="w-4 h-4" />
                                  <span>Download</span>
                                </button>
                              </div>
                              
                              <p className="text-[#8b94a6] text-xs mt-3 text-center">
                                This episode has no active seeders on the torrent network. Try again later or search manually.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-[#8b94a6]">No episodes found for Season {selectedSeason}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default SingleTV;