import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Wrench, RotateCcw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// Rotating status messages shown while the backend scrapes multiple providers
const LOADING_STAGES = [
  'Searching 1337x, ThePirateBay, TorrentGalaxy & more...',
  'Aggregating results across all providers...',
  'Verifying seeders and picking the healthiest torrent...',
  'Updating database with the new magnet link...'
];

/**
 * Automated "Report & Fix Broken Link" component.
 *
 * 1. Sends the movie title/year (or IMDb ID) to POST /api/report-broken-link
 * 2. Backend scrapes MULTIPLE torrent providers simultaneously, picks the
 *    highest-seeded torrent, saves the magnet to the database and returns it.
 * 3. Shows a loading state while that runs; once the new magnet arrives it is
 *    handed to `onLinkReplaced` so the parent can automatically resume the
 *    direct download generation - no refresh or extra clicks required.
 */
const ReportBrokenLink = ({
  title,
  year,
  imdbId,
  movieId,
  mediaType = 'movie',
  onLinkReplaced
}) => {
  const [status, setStatus] = useState('idle'); // idle | reporting | success | error
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState(null);
  const [newTorrent, setNewTorrent] = useState(null);
  const stageTimerRef = useRef(null);

  // Rotate the loading stage messages while the report is running
  useEffect(() => {
    if (status === 'reporting') {
      setStageIndex(0);
      stageTimerRef.current = setInterval(() => {
        setStageIndex((prev) => (prev + 1) % LOADING_STAGES.length);
      }, 4000);
    }

    return () => {
      if (stageTimerRef.current) {
        clearInterval(stageTimerRef.current);
        stageTimerRef.current = null;
      }
    };
  }, [status]);

  const handleReport = async () => {
    setStatus('reporting');
    setError(null);
    setNewTorrent(null);

    try {
      console.log('[REPORT] Reporting broken link:', { movieId, title, year, imdbId, mediaType });

      const response = await fetch(`${API_BASE_URL}/report-broken-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movieId, title, year, imdbId, mediaType })
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success || !result?.data?.magnet) {
        throw new Error(result?.message || `Request failed (HTTP ${response.status})`);
      }

      console.log('[REPORT] New magnet received:', result.data.magnet);

      setNewTorrent(result.data.torrent);
      setStatus('success');

      // AUTO-RESUME: hand the new magnet straight to the parent so the direct
      // download generation restarts immediately - no refresh, no extra clicks.
      if (onLinkReplaced && result.data.torrent) {
        onLinkReplaced(result.data.torrent);
      }
    } catch (err) {
      console.error('[REPORT] Failed to fix broken link:', err);
      setError(err.message || 'Failed to find a replacement link.');
      setStatus('error');
    }
  };

  // ---------------------------------------------- IDLE: report button
  if (status === 'idle') {
    return (
      <div className="mt-6 glass-card rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-center sm:text-left">
          <p className="text-white font-bold">Link not working?</p>
          <p className="text-[#8b94a6] text-sm">
            Report it and we will automatically find a new, highly-seeded link for you.
          </p>
        </div>
        <button
          onClick={handleReport}
          className="flex-shrink-0 w-full sm:w-auto bg-[#252833]/80 backdrop-blur-md border border-white/10 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 flex items-center justify-center space-x-2 hover:bg-[#323644]/80 hover:border-[var(--accent)]/40 hover:-translate-y-1 active:scale-95"
        >
          <Wrench className="w-5 h-5" />
          <span>Report Broken Link | කැඩුණු සබැඳිය වාර්තා කරන්න</span>
        </button>
      </div>
    );
  }

  // ---------------------------------------------- REPORTING: loading state
  if (status === 'reporting') {
    return (
      <div className="mt-6 glass-card rounded-xl p-8 text-center">
        <Loader2 className="w-12 h-12 text-[var(--accent)] animate-spin mx-auto mb-4" />
        <h4 className="text-xl font-bold text-white mb-2">
          Fixing your link... | සබැඳිය නිවැරදි කරමින්...
        </h4>
        <p className="text-[#8b94a6]">{LOADING_STAGES[stageIndex]}</p>
        <p className="text-[#8b94a6] text-xs mt-4">
          This usually takes 10-30 seconds. Please keep this page open.
        </p>
      </div>
    );
  }

  // ---------------------------------------------- SUCCESS: new link received
  if (status === 'success') {
    return (
      <div className="mt-6 glass-card rounded-xl p-6 border-l-4 border-green-500">
        <div className="flex items-start space-x-3">
          <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-bold">New link found! Your download is starting...</p>
            <p className="text-[#8b94a6] text-sm mt-1">
              Replacement source: {newTorrent?.provider || 'Multi-Tracker'} with{' '}
              {newTorrent?.seeders ?? 0} seeders. The broken link has been replaced in our database.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------- ERROR: allow retry
  return (
    <div className="mt-6 glass-card rounded-xl p-6 border-l-4 border-red-500">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-start space-x-3 text-center sm:text-left">
          <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-bold">Could not find a replacement link</p>
            <p className="text-[#8b94a6] text-sm mt-1">{error}</p>
          </div>
        </div>
        <button
          onClick={handleReport}
          className="flex-shrink-0 w-full sm:w-auto bg-[#252833]/80 backdrop-blur-md border border-white/10 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 flex items-center justify-center space-x-2 hover:bg-[#323644]/80 hover:border-[var(--accent)]/40 active:scale-95"
        >
          <RotateCcw className="w-5 h-5" />
          <span>Try Again | නැවත උත්සාහ කරන්න</span>
        </button>
      </div>
    </div>
  );
};

export default ReportBrokenLink;