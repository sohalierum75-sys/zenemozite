import React, { useState } from 'react';
import { Download, Loader2, CheckCircle2 } from 'lucide-react';

import { API_BASE_URL } from '../config/api';

/**
 * DirectStreamButton Component
 *
 * Triggers a real, direct browser file download via the backend streaming endpoint
 * (/api/stream/:file_id) using Telegram MTProto Userbot or direct on-the-fly stream.
 * Sends Content-Disposition: attachment so the browser immediately downloads the file.
 */
const DirectStreamButton = ({
  movieId,
  magnetLink,
  title,
  label = 'Direct Download',
  className = '',
}) => {
  const [downloading, setDownloading] = useState(false);
  const [downloadStarted, setDownloadStarted] = useState(false);

  const identifier = movieId || title;

  const handleDirectDownload = () => {
    if (!identifier && !magnetLink) return;

    setDownloading(true);
    setDownloadStarted(true);

    // Build the direct streaming endpoint URL with force download flag
    const params = new URLSearchParams();
    if (magnetLink) params.append('magnet', magnetLink);
    if (title) params.append('title', title);
    params.append('dl', '1');

    const downloadUrl = `${API_BASE_URL}/stream/${encodeURIComponent(identifier)}?${params.toString()}`;

    console.log('[DirectDownload] Triggering direct file download from:', downloadUrl);

    // Create a temporary hidden anchor to trigger browser download
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `${(title || 'movie').replace(/[^\w.\- ]/g, '_')}.mp4`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Provide visual feedback for 3 seconds then return to normal
    setTimeout(() => {
      setDownloading(false);
    }, 2500);

    setTimeout(() => {
      setDownloadStarted(false);
    }, 6000);
  };

  return (
    <div className="flex-1 flex flex-col items-stretch gap-1">
      <button
        onClick={handleDirectDownload}
        disabled={(!movieId && !magnetLink) || downloading}
        className={`inline-flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-xl transition-all duration-300 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-to-r from-[#7928ca] to-[#ff0080] text-white hover:shadow-[0_0_20px_rgba(255,0,128,0.5)] hover:-translate-y-1 ${className}`}
        title="Direct Browser Download via High-Speed Stream"
      >
        {downloading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Connecting Stream...</span>
          </>
        ) : (
          <>
            <Download className="w-5 h-5" />
            <span>{label}</span>
          </>
        )}
      </button>

      {downloadStarted && (
        <span className="inline-flex items-center justify-center space-x-1 text-xs text-[#00df8f] transition-opacity">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Direct download started in browser</span>
        </span>
      )}
    </div>
  );
};

export default DirectStreamButton;
