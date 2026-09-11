import React, { useState } from 'react';
import axios from 'axios';
import { Download, ExternalLink } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const WEBTOR_URL = 'https://webtor.io/';

/**
 * Download Button — SPLIT WORKFLOW
 *
 * 1. FRONTEND (user action): clicking opens a NEW TAB at https://webtor.io/
 *    with the movie's magnet link (or .torrent URL) appended, so webtor.io
 *    processes the torrent directly for the user:
 *        https://webtor.io/?magnet=<url-encoded magnet URI>
 *        https://webtor.io/?torrent=<url-encoded .torrent URL>
 *
 * 2. BACKEND (Telegram backup — untouched): the same click fires a
 *    fire-and-forget request to GET /api/download/:idOrTitle?magnet=...,
 *    which queues the movie in the backend's Telegram CDN worker. The VPS
 *    still downloads the torrent and uploads it in chunks to the private
 *    Telegram channel, regardless of the user going to webtor.io.
 */
const DownloadButton = ({ movieId, magnetLink, title, label = 'Download', className = '' }) => {
  const [opened, setOpened] = useState(false);

  /**
   * webtor.io deep link — the OFFICIAL format, taken from webtor.io's own
   * open-source frontend (github.com/webtor-io/web-ui, MIT):
   *
   *   handlers/resource/handler.go:  GET /:resource_id -> if the path starts
   *                                  with "magnet", the magnet-loading flow runs
   *   handlers/resource/post.go:     query = TrimPrefix(path, "/") + RawQuery
   *                                  (doc comment shows "/magnet:?xt=...")
   *
   * So the magnet URI is appended to the site root VERBATIM:
   *
   *   https://webtor.io/magnet:?xt=urn:btih:...&dn=...&tr=...
   *
   * The magnet's own "?" becomes the URL query separator, letting the server
   * reassemble the exact magnet and start searching/loading it instantly.
   * DO NOT encodeURIComponent the whole magnet here — encoding "?" and "&"
   * would keep them inside the path and break the server-side reconstruction.
   * A valid magnet URI is already percent-encoded per the magnet spec.
   */
  const buildWebtorUrl = () => {
    if (!magnetLink) return WEBTOR_URL;
    if (magnetLink.startsWith('magnet:')) return `${WEBTOR_URL}${magnetLink}`;
    // Non-magnet targets (.torrent URLs) have no direct deep link on
    // webtor.io's public frontend — fall back to the home page.
    return WEBTOR_URL;
  };

  /**
   * Fire-and-forget: queue the movie in the backend Telegram CDN worker so
   * the VPS keeps caching to Telegram even though the user is sent to
   * webtor.io. Backend hiccups must NEVER block the user-facing download.
   */
  const queueBackendTelegramBackup = () => {
    if (!movieId) return;
    const params = new URLSearchParams();
    if (magnetLink) params.append('magnet', magnetLink);
    if (title) params.append('title', title);
    const url = `${API_BASE_URL}/download/${encodeURIComponent(movieId)}${params.toString() ? `?${params}` : ''}`;
    axios.get(url, { timeout: 20000 }).catch((err) => {
      console.warn('[DownloadButton] Could not queue backend Telegram caching:', err?.message);
    });
  };

  const handleClick = () => {
    // 1) Keep the backend Telegram backup pipeline running (fire-and-forget)
    queueBackendTelegramBackup();
    // 2) Send the user to webtor.io in a NEW tab
    window.open(buildWebtorUrl(), '_blank', 'noopener,noreferrer');
    setOpened(true);
  };

  return (
    <div className="flex-1 flex flex-col items-stretch gap-2">
      <button
        onClick={handleClick}
        disabled={!movieId && !magnetLink}
        className={`inline-flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-xl transition-all duration-300 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <Download className="w-5 h-5" />
        <span>{label}</span>
      </button>

      {opened && (
        <a
          href={buildWebtorUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center space-x-1.5 text-xs text-[#8b94a6] hover:text-white transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Opened webtor.io in a new tab — click to reopen</span>
        </a>
      )}
    </div>
  );
};

export default DownloadButton;
