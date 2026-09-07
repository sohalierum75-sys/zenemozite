import React, { useState, useEffect, useRef } from 'react';
import { X, Download, AlertCircle, Loader2, Play, Pause, Volume2, VolumeX, Maximize, RefreshCw } from 'lucide-react';

const LocalPlayer = ({ magnetLink, onClose, title = 'Video Player' }) => {
  const [status, setStatus] = useState('initializing');
  const [progress, setProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [peers, setPeers] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [downloadReady, setDownloadReady] = useState(false);
  const [fileName, setFileName] = useState('');
  const [webTorrentLoaded, setWebTorrentLoaded] = useState(false);
  
  const clientRef = useRef(null);
  const torrentRef = useRef(null);
  const videoRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    loadWebTorrentScript();

    return () => {
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (webTorrentLoaded && magnetLink) {
      initializeWebTorrent();
    }
  }, [webTorrentLoaded, magnetLink]);

  const loadWebTorrentScript = () => {
    if (window.WebTorrent) {
      console.log('[WebTorrent] Already loaded');
      setWebTorrentLoaded(true);
      return;
    }

    const existingScript = document.getElementById('webtorrent-script');
    if (existingScript) {
      existingScript.onload = () => {
        console.log('[WebTorrent] Script loaded from cache');
        setWebTorrentLoaded(true);
      };
      return;
    }

    console.log('[WebTorrent] Loading script from CDN...');
    const script = document.createElement('script');
    script.id = 'webtorrent-script';
    script.src = 'https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js';
    script.async = true;
    
    script.onload = () => {
      console.log('[WebTorrent] Script loaded successfully');
      setWebTorrentLoaded(true);
    };
    
    script.onerror = () => {
      console.error('[WebTorrent] Failed to load script');
      setError('Failed to load WebTorrent library');
      setStatus('error');
    };

    document.head.appendChild(script);
  };

  const initializeWebTorrent = () => {
    if (!window.WebTorrent) {
      setError('WebTorrent library not available');
      setStatus('error');
      return;
    }

    try {
      setStatus('initializing');
      setError(null);

      const client = new window.WebTorrent();
      clientRef.current = client;

      console.log('[WebTorrent] Client initialized');
      console.log('[WebTorrent] Adding magnet:', magnetLink);

      client.add(magnetLink, (torrent) => {
        console.log('[WebTorrent] Torrent metadata received');
        torrentRef.current = torrent;
        setStatus('fetching');
        setTotalSize(torrent.length);

        const videoFile = torrent.files.find(file => {
          const ext = file.name.split('.').pop().toLowerCase();
          return ['mp4', 'mkv', 'avi', 'webm', 'mov', 'flv', 'm4v'].includes(ext);
        }) || torrent.files.reduce((largest, file) => 
          file.length > largest.length ? file : largest
        , torrent.files[0]);

        if (!videoFile) {
          setError('No video file found in torrent');
          setStatus('error');
          return;
        }

        setFileName(videoFile.name);
        console.log('[WebTorrent] Selected video file:', videoFile.name);

        videoFile.renderTo(videoRef.current, {
          autoplay: true,
          controls: false
        }, (err) => {
          if (err) {
            console.error('[WebTorrent] Render error:', err);
            setError('Failed to render video: ' + err.message);
            setStatus('error');
            return;
          }
          
          console.log('[WebTorrent] Video rendering started');
          setStatus('ready');
          setIsPlaying(true);
          setDownloadReady(true);
        });

        intervalRef.current = setInterval(() => {
          setProgress(Math.round((torrent.progress || 0) * 100));
          setDownloadSpeed(torrent.downloadSpeed || 0);
          setUploadSpeed(torrent.uploadSpeed || 0);
          setPeers(torrent.numPeers || 0);
          setDownloaded(torrent.downloaded || 0);
        }, 1000);

        torrent.on('done', () => {
          console.log('[WebTorrent] Download complete');
          setProgress(100);
        });

        torrent.on('error', (err) => {
          console.error('[WebTorrent] Torrent error:', err);
          setError('Torrent error: ' + err.message);
          setStatus('error');
        });
      });

      client.on('error', (err) => {
        console.error('[WebTorrent] Client error:', err);
        setError('WebTorrent error: ' + err.message);
        setStatus('error');
      });

    } catch (err) {
      console.error('[WebTorrent] Initialization error:', err);
      setError('Failed to initialize: ' + err.message);
      setStatus('error');
    }
  };

  const cleanup = () => {
    console.log('[WebTorrent] Cleaning up...');
    
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    if (torrentRef.current) {
      torrentRef.current.destroy();
    }

    if (clientRef.current) {
      clientRef.current.destroy();
    }
  };

  const handleDirectDownload = () => {
    if (!torrentRef.current) {
      alert('Torrent not ready for download');
      return;
    }

    try {
      const videoFile = torrentRef.current.files.find(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        return ['mp4', 'mkv', 'avi', 'webm', 'mov', 'flv', 'm4v'].includes(ext);
      }) || torrentRef.current.files[0];

      if (!videoFile) {
        alert('No video file found');
        return;
      }

      videoFile.getBlob((err, blob) => {
        if (err) {
          console.error('[WebTorrent] Blob error:', err);
          alert('Failed to prepare download: ' + err.message);
          return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = videoFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('[WebTorrent] Download triggered:', videoFile.name);
      });
    } catch (err) {
      console.error('[WebTorrent] Download error:', err);
      alert('Failed to download: ' + err.message);
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;

    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;

    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const toggleFullscreen = () => {
    if (!videoRef.current) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoRef.current.requestFullscreen();
    }
  };

  const handleRetry = () => {
    cleanup();
    setStatus('initializing');
    setError(null);
    setProgress(0);
    setDownloadSpeed(0);
    setUploadSpeed(0);
    setPeers(0);
    setDownloaded(0);
    setDownloadReady(false);
    
    setTimeout(() => {
      initializeWebTorrent();
    }, 500);
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond) => {
    return formatBytes(bytesPerSecond) + '/s';
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0f1115]/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-7xl h-[90vh] glass-card rounded-2xl overflow-hidden shadow-2xl flex flex-col">
        
        <div className="glass-navbar border-b border-white/5 p-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            <Play className="w-6 h-6 text-[#ff9900] flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-bold text-white truncate">{title}</h3>
              {fileName && (
                <p className="text-[#8b94a6] text-sm truncate">{fileName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-400 hover:to-pink-400 text-white p-2 rounded-lg transition-all duration-300 transform hover:scale-110 shadow-lg active:scale-95 flex-shrink-0 ml-4"
            aria-label="Close Player"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center bg-black relative overflow-hidden">
          
          {status !== 'ready' && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0f1115]/90 backdrop-blur-sm z-10">
              <div className="text-center max-w-md mx-4">
                {status === 'initializing' && (
                  <>
                    <Loader2 className="w-16 h-16 text-[#ff9900] animate-spin mx-auto mb-4" />
                    <h4 className="text-2xl font-bold text-white mb-2">Initializing WebTorrent</h4>
                    <p className="text-[#8b94a6]">Setting up peer-to-peer connection...</p>
                  </>
                )}

                {status === 'fetching' && (
                  <>
                    <Loader2 className="w-16 h-16 text-[#ff9900] animate-spin mx-auto mb-4" />
                    <h4 className="text-2xl font-bold text-white mb-2">Loading Video</h4>
                    <p className="text-[#8b94a6] mb-4">Connecting to {peers} peers...</p>
                    
                    <div className="w-full bg-white/10 rounded-full h-3 mb-2 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-[#ff9900] to-[#ffb84d] h-full rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-white text-sm font-semibold mb-4">{progress}% buffered</p>

                    {downloadSpeed > 0 && (
                      <div className="glass-card rounded-xl p-4 text-left">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-[#8b94a6]">Download Speed:</p>
                            <p className="text-white font-bold">{formatSpeed(downloadSpeed)}</p>
                          </div>
                          <div>
                            <p className="text-[#8b94a6]">Downloaded:</p>
                            <p className="text-white font-bold">{formatBytes(downloaded)}</p>
                          </div>
                          <div>
                            <p className="text-[#8b94a6]">Upload Speed:</p>
                            <p className="text-white font-bold">{formatSpeed(uploadSpeed)}</p>
                          </div>
                          <div>
                            <p className="text-[#8b94a6]">Peers:</p>
                            <p className="text-white font-bold">{peers}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {status === 'error' && (
                  <>
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h4 className="text-2xl font-bold text-white mb-2">Playback Error</h4>
                    <p className="text-[#8b94a6] mb-6">{error || 'Failed to load video'}</p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <button
                        onClick={handleRetry}
                        className="bg-[#ff9900] text-[#0f1115] font-bold px-6 py-3 rounded-xl flex items-center justify-center space-x-2 transition-all duration-300 hover:scale-105 shadow-lg shadow-[#ff9900]/20 active:scale-95"
                      >
                        <RefreshCw className="w-5 h-5" />
                        <span>Retry</span>
                      </button>
                      <button
                        onClick={onClose}
                        className="bg-white/5 backdrop-blur-md hover:bg-white/10 text-white font-bold px-6 py-3 rounded-xl transition-all duration-300 border border-white/10 hover:border-white/20 active:scale-95"
                      >
                        Close
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onClick={togglePlayPause}
          />

          {status === 'ready' && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-6">
              <div className="flex items-center justify-between gap-4">
                <button
                  onClick={togglePlayPause}
                  className="bg-[#ff9900] text-[#0f1115] p-3 rounded-full hover:scale-110 transition-all duration-300 shadow-lg active:scale-95"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6" />
                  ) : (
                    <Play className="w-6 h-6" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-sm text-white mb-2">
                    <span>{progress}% buffered</span>
                    <span>{peers} peers</span>
                  </div>
                  <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-[#ff9900] h-full rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <button
                  onClick={toggleMute}
                  className="bg-white/10 backdrop-blur-md hover:bg-white/20 text-white p-3 rounded-full transition-all duration-300 active:scale-95"
                >
                  {isMuted ? (
                    <VolumeX className="w-6 h-6" />
                  ) : (
                    <Volume2 className="w-6 h-6" />
                  )}
                </button>

                <button
                  onClick={toggleFullscreen}
                  className="bg-white/10 backdrop-blur-md hover:bg-white/20 text-white p-3 rounded-full transition-all duration-300 active:scale-95"
                >
                  <Maximize className="w-6 h-6" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="glass-navbar border-t border-white/5 p-4 flex-shrink-0">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            
            <div className="flex flex-wrap items-center gap-4 text-sm text-[#8b94a6]">
              <div className="flex items-center space-x-2">
                <span className="text-white font-semibold">Download:</span>
                <span>{formatSpeed(downloadSpeed)}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-white font-semibold">Upload:</span>
                <span>{formatSpeed(uploadSpeed)}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-white font-semibold">Progress:</span>
                <span>{progress}%</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-white font-semibold">Size:</span>
                <span>{formatBytes(totalSize)}</span>
              </div>
            </div>

            <button
              onClick={handleDirectDownload}
              disabled={!downloadReady || status === 'error'}
              className={`${
                downloadReady && status !== 'error'
                  ? 'bg-[#ff9900] hover:shadow-[0_0_15px_rgba(255,153,0,0.4)] hover:scale-105'
                  : 'bg-[#8b94a6]/20 cursor-not-allowed'
              } text-[#0f1115] font-bold px-6 py-3 rounded-xl flex items-center space-x-2 transition-all duration-300 shadow-lg active:scale-95`}
            >
              <Download className="w-5 h-5" />
              <span>Download to Device</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocalPlayer;
