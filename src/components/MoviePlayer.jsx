import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Loader2, AlertCircle, X } from 'lucide-react';

// Get player ad URL from environment (optional)
const PLAYER_AD_URL = import.meta.env.VITE_PLAYER_AD_URL || '';

const MoviePlayer = ({ videoUrl, posterUrl, title, imdbCode, onClose }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const [adCompleted, setAdCompleted] = useState(!PLAYER_AD_URL);
  const [showAdContinue, setShowAdContinue] = useState(false);
  
  const playerRef = useRef(null);
  const videoRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const iframeRef = useRef(null);

  // Determine if using iframe (external) or HTML5 video
  const isIframeMode = videoUrl && (videoUrl.includes('vidsrc') || videoUrl.includes('iframe') || videoUrl.includes('embed'));

  // Handle ad flow
  const handleStartWithAd = () => {
    if (PLAYER_AD_URL && !adCompleted) {
      // Open ad URL in new tab
      window.open(PLAYER_AD_URL, '_blank');
      // Show continue button
      setShowAdContinue(true);
    } else {
      setAdCompleted(true);
    }
  };

  const handleContinueAfterAd = () => {
    setAdCompleted(true);
    setShowAdContinue(false);
  };

  // Auto-hide controls
  useEffect(() => {
    const resetControlsTimeout = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      if (isPlaying) {
        controlsTimeoutRef.current = setTimeout(() => {
          setShowControls(false);
        }, 3000);
      }
    };

    resetControlsTimeout();

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying]);

  // Format time
  const formatTime = (time) => {
    if (isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Toggle play/pause
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Toggle mute
  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  // Handle volume change
  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setIsMuted(newVolume === 0);
    }
  };

  // Handle progress change
  const handleProgressChange = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      playerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!adCompleted) return;
      
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          toggleMute();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isPlaying, adCompleted]);

  // Ad gate screen
  if (!adCompleted) {
    return (
      <div className="fixed inset-0 bg-slate-950 z-50 flex items-center justify-center">
        <div className="max-w-2xl w-full mx-4">
          <div className="backdrop-blur-md bg-slate-900/50 border-2 border-white/10 rounded-lg p-8 text-center">
            <div className="mb-6">
              {posterUrl && (
                <img
                  src={posterUrl}
                  alt={title}
                  className="w-48 h-72 object-cover rounded-lg mx-auto border-2 border-orange-500 shadow-2xl"
                />
              )}
            </div>
            
            <h2 className="text-3xl font-bold text-white mb-4">{title}</h2>
            
            {!showAdContinue ? (
              <div>
                <p className="text-slate-400 mb-6">
                  Click below to proceed, then return here to start watching.
                </p>
                <button
                  onClick={handleStartWithAd}
                  className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold px-8 py-4 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg shadow-orange-500/20"
                >
                  <Play className="w-5 h-5 inline mr-2" />
                  Proceed to Watch
                </button>
              </div>
            ) : (
              <div>
                <p className="text-orange-500 mb-6 text-lg">
                  Ready to watch! Click below to start streaming.
                </p>
                <button
                  onClick={handleContinueAfterAd}
                  className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold px-8 py-4 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg shadow-orange-500/20"
                >
                  <Play className="w-5 h-5 inline mr-2 fill-current" />
                  Continue Watching
                </button>
              </div>
            )}
            
            {onClose && (
              <button
                onClick={onClose}
                className="mt-6 text-slate-400 hover:text-orange-500 transition-all duration-300"
              >
                ← Back to Movie Details
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main player UI
  return (
    <div 
      ref={playerRef}
      className="fixed inset-0 bg-slate-950 z-50 flex flex-col"
      onMouseMove={() => setShowControls(true)}
    >
      {/* Close Button */}
      {onClose && (
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 z-50 backdrop-blur-md bg-slate-900/50 hover:bg-slate-800 text-white p-2 rounded-full transition-all duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <X className="w-6 h-6" />
        </button>
      )}

      {/* Video Container */}
      <div className="flex-1 relative flex items-center justify-center bg-slate-950">
        {isIframeMode ? (
          /* MODE B: External iframe source */
          <iframe
            ref={iframeRef}
            src={videoUrl}
            title={title}
            className="w-full h-full"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="origin"
            onLoad={() => setIsLoading(false)}
          />
        ) : (
          /* MODE A: HTML5 video with custom controls */
          <video
            ref={videoRef}
            src={videoUrl}
            poster={posterUrl}
            className="w-full h-full object-contain"
            onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
            onLoadedMetadata={(e) => {
              setDuration(e.target.duration);
              setIsLoading(false);
            }}
            onEnded={() => setIsPlaying(false)}
            onError={() => {
              setError('Failed to load video');
              setIsLoading(false);
            }}
            onClick={togglePlay}
          />
        )}

        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950 bg-opacity-80">
            <div className="text-center">
              <Loader2 className="w-16 h-16 text-orange-500 animate-spin mx-auto mb-4" />
              <p className="text-white text-xl">Loading {title}...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950 bg-opacity-90">
            <div className="text-center max-w-md">
              <AlertCircle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-white mb-2">Playback Error</h3>
              <p className="text-slate-400 mb-6">{error}</p>
              {onClose && (
                <button
                  onClick={onClose}
                  className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold px-6 py-3 rounded-lg transition-all duration-300"
                >
                  Back to Movie Details
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Custom Controls (Only for HTML5 mode) */}
      {!isIframeMode && (
        <div
          className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent p-6 transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Progress Bar */}
          <div className="mb-4">
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime}
              onChange={handleProgressChange}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
              style={{
              background: `linear-gradient(to right, #ff9900 0%, #ff9900 ${(currentTime / duration) * 100}%, rgb(30 41 59) ${(currentTime / duration) * 100}%, rgb(30 41 59) 100%)`
              }}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            {/* Left Controls */}
            <div className="flex items-center space-x-4">
              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white p-3 rounded-full transition-all duration-300"
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current" />
                )}
              </button>

              {/* Volume */}
              <div className="flex items-center space-x-2">
                <button onClick={toggleMute} className="text-white hover:text-orange-500 transition-all duration-300">
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-5 h-5" />
                  ) : (
                    <Volume2 className="w-5 h-5" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
              </div>

              {/* Time */}
              <div className="text-white text-sm">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center space-x-4">
              {/* Title */}
              <div className="text-white font-semibold hidden md:block">
                {title}
              </div>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="text-white hover:text-orange-500 transition-all duration-300"
              >
                {isFullscreen ? (
                  <Minimize className="w-5 h-5" />
                ) : (
                  <Maximize className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Movie Info Overlay (for iframe mode) */}
      {isIframeMode && (
        <div
          className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-slate-950 via-slate-950/80 to-transparent p-6 transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <p className="text-slate-400 text-sm mt-1">Streaming via external provider</p>
        </div>
      )}

      {/* Keyboard Shortcuts Info */}
      {!isIframeMode && showControls && (
        <div className="absolute top-4 left-4 backdrop-blur-md bg-slate-900/50 bg-opacity-80 text-slate-400 text-xs p-3 rounded-lg">
          <p><kbd className="bg-slate-800 px-2 py-1 rounded">Space</kbd> Play/Pause</p>
          <p><kbd className="bg-slate-800 px-2 py-1 rounded">F</kbd> Fullscreen</p>
          <p><kbd className="bg-slate-800 px-2 py-1 rounded">M</kbd> Mute</p>
        </div>
      )}
    </div>
  );
};

export default MoviePlayer;




