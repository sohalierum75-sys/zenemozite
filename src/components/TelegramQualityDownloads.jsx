import React, { useState } from 'react';
import axios from 'axios';
import {
  Download,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  Loader2,
  Film,
  Volume2,
  Subtitles,
  ShieldCheck,
  FileVideo,
} from 'lucide-react';
import { API_BASE_URL } from '../config/api';

/**
 * Visual styling configuration for each video quality tier
 */
const QUALITY_THEMES = {
  '4k': {
    label: '4K Ultra HD',
    short: '4K',
    gradient: 'from-amber-500 via-rose-500 to-purple-600',
    buttonGrad: 'from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500',
    border: 'border-fuchsia-500/40 hover:border-fuchsia-400',
    glow: 'shadow-[0_0_30px_rgba(217,70,239,0.25)]',
    badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
    badgeText: 'Ultra High Definition',
  },
  '2160p': {
    label: '4K Ultra HD',
    short: '4K',
    gradient: 'from-amber-500 via-rose-500 to-purple-600',
    buttonGrad: 'from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500',
    border: 'border-fuchsia-500/40 hover:border-fuchsia-400',
    glow: 'shadow-[0_0_30px_rgba(217,70,239,0.25)]',
    badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
    badgeText: 'Ultra High Definition',
  },
  '1080p': {
    label: '1080p Full HD',
    short: '1080p',
    gradient: 'from-blue-600 via-indigo-600 to-purple-600',
    buttonGrad: 'from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:via-purple-500 hover:to-pink-500',
    border: 'border-indigo-500/40 hover:border-indigo-400',
    glow: 'shadow-[0_0_30px_rgba(99,102,241,0.25)]',
    badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    badgeText: 'Full High Definition',
  },
  '720p': {
    label: '720p HD',
    short: '720p',
    gradient: 'from-cyan-500 to-blue-600',
    buttonGrad: 'from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500',
    border: 'border-sky-500/40 hover:border-sky-400',
    glow: 'shadow-[0_0_30px_rgba(14,165,233,0.25)]',
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    badgeText: 'High Definition',
  },
  '480p': {
    label: '480p SD',
    short: '480p',
    gradient: 'from-emerald-600 to-teal-600',
    buttonGrad: 'from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500',
    border: 'border-emerald-500/40 hover:border-emerald-400',
    glow: 'shadow-[0_0_30px_rgba(16,185,129,0.25)]',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    badgeText: 'Standard Definition (Data Saver)',
  },
};

/**
 * Returns theme configuration for a quality string
 */
function getQualityTheme(quality = '') {
  const key = String(quality || '').toLowerCase().trim();
  return (
    QUALITY_THEMES[key] || {
      label: `${quality} Standard`,
      short: quality,
      gradient: 'from-slate-600 to-slate-800',
      buttonGrad: 'from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700',
      border: 'border-white/10 hover:border-white/20',
      glow: 'shadow-lg',
      badge: 'bg-white/10 text-white border-white/20',
      badgeText: 'Standard Format',
    }
  );
}

/**
 * Format quality download button text:
 * "Download 480p — File Size"
 * "Download 720p HD — File Size"
 * "Download 1080p Full HD — File Size"
 */
function formatQualityButtonLabel(quality = '', size = '', isLk = false) {
  const q = String(quality || '').toLowerCase().trim();
  const sizePart = size && size !== 'Unknown' ? ` — ${size}` : '';

  if (isLk) {
    if (q === '480p') return `බාගත කරන්න 480p${sizePart}`;
    if (q === '720p') return `බාගත කරන්න 720p HD${sizePart}`;
    if (q === '1080p') return `බාගත කරන්න 1080p Full HD${sizePart}`;
    if (q === '4k' || q === '2160p') return `බාගත කරන්න 4K Ultra HD${sizePart}`;
    return `බාගත කරන්න ${quality}${sizePart}`;
  }

  if (q === '480p') return `Download 480p${sizePart}`;
  if (q === '720p') return `Download 720p HD${sizePart}`;
  if (q === '1080p') return `Download 1080p Full HD${sizePart}`;
  if (q === '4k' || q === '2160p') return `Download 4K Ultra HD${sizePart}`;
  return `Download ${quality}${sizePart}`;
}

/**
 * Professional Telegram Quality Downloads Component
 */
const TelegramQualityDownloads = ({
  movie,
  files = [],
  isLk = false,
  className = '',
}) => {
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  // Normalize list of quality variants
  let rawList = files;
  if (!rawList || rawList.length === 0) {
    const candidate = movie?.telegram_files || movie?.telegramFiles;
    if (typeof candidate === 'string') {
      try {
        rawList = JSON.parse(candidate);
      } catch {
        rawList = [];
      }
    } else if (Array.isArray(candidate)) {
      rawList = candidate;
    }
  }

  const qualityFiles = Array.isArray(rawList) ? rawList : [];

  if (qualityFiles.length === 0) {
    return null;
  }

  /**
   * Request signed token and trigger direct secure file download
   */
  const handleDownload = async (file) => {
    const fileId = file.file_id || file.telegramFileId;
    if (!fileId) return;

    setDownloadingId(fileId);
    setDownloadError(null);

    try {
      console.log(`[DOWNLOAD] Requesting secure signed download token for ${fileId}...`);

      // 1. Request cryptographically signed token
      const tokenUrl = `${API_BASE_URL}/download/token/${encodeURIComponent(fileId)}?quality=${encodeURIComponent(file.quality || '1080p')}`;
      const tokenRes = await axios.get(tokenUrl, { timeout: 10000 });

      let directUrl = '';
      if (tokenRes.data?.downloadUrl) {
        directUrl = tokenRes.data.downloadUrl;
      } else {
        // Fallback to direct /api/download/:file_id
        directUrl = `${API_BASE_URL}/download/${encodeURIComponent(fileId)}?title=${encodeURIComponent(movie?.title || 'movie')}`;
      }

      console.log(`[DOWNLOAD] Initializing browser download stream: ${directUrl}`);

      // 2. Trigger instant browser download with proper filename
      const safeTitle = (movie?.title || 'movie').replace(/[^\w.\- ]/g, '_');
      const cleanFileName = `${safeTitle} [${file.quality || 'video'}].mp4`;

      const link = document.createElement('a');
      link.href = directUrl;
      link.setAttribute('download', cleanFileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Brief UI reset
      setTimeout(() => {
        setDownloadingId(null);
      }, 2500);
    } catch (err) {
      console.error('[DOWNLOAD] Direct download failed:', err);
      const errMsg = err.response?.data?.error || err.response?.data?.message || err.message || 'Download server connection failed';
      setDownloadError(`Failed to start download: ${errMsg}`);
      setDownloadingId(null);
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#161a23] via-[#0f1219] to-[#0a0c10] p-6 sm:p-8 shadow-2xl backdrop-blur-2xl ${className}`}
    >
      {/* Ambient background glow */}
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-br from-purple-600/10 to-pink-600/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-gradient-to-tr from-blue-600/10 to-teal-600/10 blur-3xl pointer-events-none" />

      {/* Header section */}
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 mb-6 border-b border-white/10">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/25">
            <Download className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <span className="text-xs font-black tracking-widest uppercase bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Direct Cloud CDN
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <ShieldCheck className="w-3 h-3 mr-1" />
                Verified Rights
              </span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
              {isLk ? 'බාගත කිරීමේ ගුණාත්මකභාවය තෝරන්න' : 'SELECT DOWNLOAD QUALITY'}
            </h3>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-white/5 text-[#8b94a6] border border-white/10">
            {qualityFiles.length} {qualityFiles.length === 1 ? 'Variant' : 'Variants'} Ready
          </span>
        </div>
      </div>

      {/* Error alert if download failed */}
      {downloadError && (
        <div className="mb-6 p-4 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300 flex items-center space-x-3 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400" />
          <span className="flex-1">{downloadError}</span>
          <button
            onClick={() => setDownloadError(null)}
            className="text-xs underline text-red-200 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Quality Cards Grid */}
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {qualityFiles.map((file, idx) => {
          const quality = file.quality || '1080p';
          const size = file.size || (file.fileSizeBytes ? `${(file.fileSizeBytes / (1024 ** 3)).toFixed(1)} GB` : 'Direct Stream');
          const theme = getQualityTheme(quality);
          const fileId = file.file_id || file.telegramFileId;
          const isDownloading = downloadingId === fileId;
          const isVerified = Boolean(file.verified || file.verifiedResolution);

          return (
            <div
              key={fileId || `quality-${idx}`}
              className={`group relative flex flex-col justify-between rounded-2xl border bg-black/40 backdrop-blur-md p-5 transition-all duration-300 hover:-translate-y-1 ${theme.border} ${theme.glow}`}
            >
              {/* Quality Header & Badges */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <span className={`text-xs font-extrabold px-3 py-1 rounded-xl border ${theme.badge}`}>
                      {theme.short}
                    </span>
                    {isVerified && (
                      <span className="inline-flex items-center text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20" title="Resolution verified via FFprobe">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Verified
                      </span>
                    )}
                  </div>

                  {size && size !== 'Unknown' && (
                    <span className="text-xs font-bold text-white bg-white/10 px-2.5 py-1 rounded-lg">
                      {size}
                    </span>
                  )}
                </div>

                <h4 className="text-base font-bold text-white group-hover:text-purple-300 transition-colors">
                  {theme.label}
                </h4>
                <p className="text-[11px] text-[#8b94a6] mt-0.5 mb-4">
                  {theme.badgeText}
                </p>

                {/* Metadata Pills: Audio, Subtitle, Codec, Format */}
                <div className="flex flex-wrap gap-1.5 mb-5">
                  <span className="inline-flex items-center text-[10px] font-medium text-[#8b94a6] bg-white/5 px-2 py-0.5 rounded-md">
                    <FileVideo className="w-3 h-3 mr-1 text-purple-400" />
                    MP4 / MKV
                  </span>

                  {file.audioLanguage && (
                    <span className="inline-flex items-center text-[10px] font-medium text-[#8b94a6] bg-white/5 px-2 py-0.5 rounded-md">
                      <Volume2 className="w-3 h-3 mr-1 text-blue-400" />
                      {file.audioLanguage}
                    </span>
                  )}

                  {file.subtitleInfo && (
                    <span className="inline-flex items-center text-[10px] font-medium text-[#8b94a6] bg-white/5 px-2 py-0.5 rounded-md">
                      <Subtitles className="w-3 h-3 mr-1 text-amber-400" />
                      {file.subtitleInfo}
                    </span>
                  )}
                </div>
              </div>

              {/* Direct Download Button */}
              <button
                type="button"
                onClick={() => handleDownload(file)}
                disabled={isDownloading}
                className={`w-full py-3.5 px-4 rounded-xl font-extrabold text-sm text-white shadow-md transition-all duration-300 flex items-center justify-center space-x-2 active:scale-95 disabled:opacity-75 cursor-pointer bg-gradient-to-r ${theme.buttonGrad}`}
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting Secure Stream...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 transition-transform group-hover:translate-y-0.5" />
                    <span>
                      {formatQualityButtonLabel(quality, size, isLk)}
                    </span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer reassurance note */}
      <div className="relative z-10 flex items-center justify-between flex-wrap gap-2 pt-6 mt-6 border-t border-white/5 text-xs text-[#8b94a6]">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span>Direct high-speed browser downloads with HTTP Range & resume support. No redirect to Telegram.</span>
        </div>
        <div className="flex items-center space-x-1.5 text-[11px] text-[#5b6477]">
          <span>Zinemo Automated Multi-Quality Engine v14.0</span>
        </div>
      </div>
    </div>
  );
};

export default TelegramQualityDownloads;
