import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Download, Loader2, AlertCircle, RotateCcw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 15 * 60 * 1000; // 15 min (generous for multi-chunk uploads)

/**
 * Hybrid CDN Download Button with polling.
 *
 * Click -> GET /api/download/:movieId (with ?magnet= to queue uncached movies)
 *   cached (downloadUrl present)  -> redirect via window.location.href
 *   state: "queued" or "caching"  -> "Downloading to server..." + poll every 5s
 *   state: "failed"               -> error immediately, stop polling
 *   error / timeout               -> error with Try Again
 */
const DownloadButton = ({ movieId, magnetLink, label = 'Download', className = '' }) => {
  const [status, setStatus] = useState('idle'); // idle | processing | error
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState(''); // elapsed time / status line
  const pollTimerRef = useRef(null);
  const startedAtRef = useRef(0);
  const abortedRef = useRef(false);

  useEffect(() => {
    return () => {
      abortedRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (magnetLink) params.append('magnet', magnetLink);
    return `${API_BASE_URL}/download/${encodeURIComponent(movieId)}${params.toString() ? `?${params}` : ''}`;
  };

  const fail = (msg) => {
    if (abortedRef.current) return;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setStatus('error');
    setMessage(msg);
  };

  const redirect = (url) => {
    if (abortedRef.current) return;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    window.location.href = url;
  };

  const formatElapsed = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
  };

    // ---- Poll: called immediately on click, then every POLL_INTERVAL_MS
  const handlePoll = async () => {
    if (abortedRef.current) return;

    const elapsed = Date.now() - startedAtRef.current;
    const elapsedStr = formatElapsed(elapsed);

    if (elapsed > MAX_WAIT_MS) {
      fail(`Caching timed out after ${formatElapsed(MAX_WAIT_MS)}. Please try again later.`);
      return;
    }

    try {
      const { data } = await axios.get(buildUrl(), { timeout: 30000 });

      if (!data?.success) {
        throw new Error(data?.message || 'The backend rejected the request.');
      }

      // ---- CACHED: downloadUrl present -> redirect (requirement 5)
      if (data.downloadUrl) {
        redirect(data.downloadUrl);
        return;
      }

      // ---- FAILED: stop polling immediately (requirement 6)
      if (data.state === 'failed') {
        fail('Caching failed on the server. Click Try Again to re-initiate.');
        return;
      }

      // ---- IN PROGRESS: queued or caching -> update UI + poll again (requirement 3)
      if (data.state === 'caching') {
        setMessage('Downloading to server...');
        setDetail(`Splitting & uploading to CDN · ${elapsedStr}`);
      } else if (data.state === 'queued') {
        setMessage('Queued for caching...');
        setDetail(`Waiting for a slot · ${elapsedStr}`);
      } else {
        setMessage('Preparing your download...');
        setDetail(`Elapsed ${elapsedStr}`);
      }

      pollTimerRef.current = setTimeout(handlePoll, POLL_INTERVAL_MS);
    } catch (err) {
      if (abortedRef.current) return;
      fail(err?.response?.data?.message || err?.message || 'Failed to reach the download server.');
    }
  };

  const handleClick = () => {
    if (!movieId || status === 'processing') return;
    abortedRef.current = false;
    setStatus('processing');
    setMessage('Processing...');
    setDetail('');
    startedAtRef.current = Date.now();
    handlePoll();
  };

    // ---- Render: IDLE
  if (status === 'idle') {
    return (
      <button
        onClick={handleClick}
        disabled={!movieId}
        className={`flex-1 inline-flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-xl transition-all duration-300 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <Download className="w-5 h-5" />
        <span>{label}</span>
      </button>
    );
  }

  // ---- Render: PROCESSING (with progress detail line)
  if (status === 'processing') {
    return (
      <div className="flex-1 flex flex-col items-stretch">
        <div className="inline-flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-xl bg-[#252833]/80 border border-white/10 text-white">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
          <span className="truncate">{message || 'Processing...'}</span>
        </div>
        {detail && (
          <p className="text-[#8b94a6] text-xs mt-1.5 text-center">{detail}</p>
        )}
      </div>
    );
  }

  // ---- Render: ERROR (with Try Again)
  return (
    <div className="flex-1 flex flex-col items-stretch gap-2">
      <div className="inline-flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span className="truncate text-sm">{message}</span>
      </div>
      <button
        onClick={handleClick}
        className="inline-flex items-center justify-center space-x-2 text-sm text-[#8b94a6] hover:text-white transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
        <span>Try Again</span>
      </button>
    </div>
  );
};

export default DownloadButton;