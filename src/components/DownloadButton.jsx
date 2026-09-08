import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Download, Loader2, AlertCircle, RotateCcw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// While the backend caches the movie (Telegram / Google Drive) we poll this often
const POLL_INTERVAL_MS = 5000;
// Give up waiting after 10 minutes and show an error with a retry button
const MAX_WAIT_MS = 10 * 60 * 1000;

/**
 * Hybrid-cache Download Button.
 *
 * Flow (GET /api/download/:movieId):
 *   1. Movie already cached  -> { success: true, downloadUrl }  -> auto-redirect via
 *      window.location.href - no extra clicks.
 *   2. Movie not cached yet  -> { success: true, cached: false } -> keeps a
 *      "Processing..." state and polls the same endpoint every 5s until the
 *      backend finishes caching, then redirects.
 *   3. Anything fails        -> inline red error with a Try Again button.
 *
 * Props:
 *   movieId    (required) Movie.id from the cache database, or any title the DB knows.
 *   magnetLink (optional) magnet of the movie - lets the backend queue caching
 *              on demand the first time an uncached movie is requested.
 *   label      (optional) button text.
 *   className  (optional) extra Tailwind classes for the button.
 */
const DownloadButton = ({ movieId, magnetLink, label = 'Download', className = '' }) => {
  const [status, setStatus] = useState('idle'); // idle | processing | error
  const [message, setMessage] = useState('');
  const pollTimerRef = useRef(null);
  const startedAtRef = useRef(0);
  const abortedRef = useRef(false);

  // Clean up any running poll timer when the component unmounts
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

  const requestLink = async () => {
    const { data } = await axios.get(buildUrl(), { timeout: 30000 });
    return data;
  };

  // Requirement: once the backend returns downloadUrl, auto-redirect
  const redirect = (url) => {
    if (abortedRef.current) return;
    console.log('[DownloadButton] Redirecting to', url);
    window.location.href = url;
  };

  const handlePoll = async () => {
    if (abortedRef.current) return;

    // Give up after MAX_WAIT_MS
    if (Date.now() - startedAtRef.current > MAX_WAIT_MS) {
      setStatus('error');
      setMessage('Caching is taking too long. Please try again later.');
      return;
    }

    try {
      const data = await requestLink();

      if (!data?.success) {
        throw new Error(data?.message || 'The backend rejected the request.');
      }

      // Cached -> redirect immediately
      if (data.downloadUrl) {
        redirect(data.downloadUrl);
        return;
      }

      // Still caching -> schedule the next poll
      setMessage(data.message || 'Preparing your download...');
      pollTimerRef.current = setTimeout(handlePoll, POLL_INTERVAL_MS);
    } catch (err) {
      if (abortedRef.current) return;
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Failed to reach the download server.';
      setStatus('error');
      setMessage(msg);
    }
  };

  const handleClick = async () => {
    if (!movieId || status === 'processing') return;

    abortedRef.current = false;
    setStatus('processing');
    setMessage('Processing...');
    startedAtRef.current = Date.now();

    // Kick off the first request immediately (no initial delay)
    await handlePoll();
  };

  const handleRetry = () => handleClick();

  // ----------------- IDLE -----------------
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

  // ----------------- PROCESSING -----------------
  if (status === 'processing') {
    return (
      <div className="flex-1 inline-flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-xl bg-[#252833]/80 border border-white/10 text-white">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
        <span className="truncate">{message || 'Processing...'}</span>
      </div>
    );
  }

  // ----------------- ERROR -----------------
  return (
    <div className="flex-1 flex flex-col items-stretch gap-2">
      <div className="inline-flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span className="truncate text-sm">{message}</span>
      </div>
      <button
        onClick={handleRetry}
        className="inline-flex items-center justify-center space-x-2 text-sm text-[#8b94a6] hover:text-white transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
        <span>Try Again</span>
      </button>
    </div>
  );
};

export default DownloadButton;