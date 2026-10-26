import React, { useState, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Download, ExternalLink, ChevronDown, ChevronUp, Server, HardDrive, Sparkles, X, CheckCircle2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const WEBTOR_URL = 'https://webtor.io/';

/**
 * Helper to get distinctive color accents for popular cloud storage providers
 */
function getProviderStyle(provider = '') {
  const p = provider.toLowerCase();
  if (p.includes('google') || p.includes('gdrive') || p.includes('drive')) {
    return {
      bg: 'bg-blue-500/10 hover:bg-blue-500/20',
      border: 'border-blue-500/30 hover:border-blue-500/60',
      text: 'text-blue-400',
      badge: 'bg-blue-500/20 text-blue-300'
    };
  }
  if (p.includes('mega')) {
    return {
      bg: 'bg-red-500/10 hover:bg-red-500/20',
      border: 'border-red-500/30 hover:border-red-500/60',
      text: 'text-red-400',
      badge: 'bg-red-500/20 text-red-300'
    };
  }
  if (p.includes('pixel') || p.includes('pixeldrain')) {
    return {
      bg: 'bg-purple-500/10 hover:bg-purple-500/20',
      border: 'border-purple-500/30 hover:border-purple-500/60',
      text: 'text-purple-400',
      badge: 'bg-purple-500/20 text-purple-300'
    };
  }
  if (p.includes('mediafire')) {
    return {
      bg: 'bg-cyan-500/10 hover:bg-cyan-500/20',
      border: 'border-cyan-500/30 hover:border-cyan-500/60',
      text: 'text-cyan-400',
      badge: 'bg-cyan-500/20 text-cyan-300'
    };
  }
  // Default direct link style
  return {
    bg: 'bg-emerald-500/10 hover:bg-emerald-500/20',
    border: 'border-emerald-500/30 hover:border-emerald-500/60',
    text: 'text-emerald-400',
    badge: 'bg-emerald-500/20 text-emerald-300'
  };
}

/**
 * Helper for quality tag colors
 */
function getQualityBadge(quality = '') {
  const q = quality.toLowerCase();
  if (q.includes('4k') || q.includes('2160')) {
    return 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-sm';
  }
  if (q.includes('1080')) {
    return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  }
  if (q.includes('720')) {
    return 'bg-sky-500/20 text-sky-300 border border-sky-500/30';
  }
  return 'bg-slate-700/50 text-slate-300 border border-slate-600/30';
}

/**
 * DownloadButton Component with Dropdown Menu
 *
 * Supports multiple Direct Download Links (DDL) from the database:
 * - Clicking the main button toggles a styled dropdown menu.
 * - Maps through download_links array (provider, quality, url, size).
 * - Clicking an individual link opens the external URL in a new tab.
 * - Handles outside clicks and Escape key to close smoothly.
 * - Retains optional fallback torrent / webtor processing if magnetLink is provided.
 */
const DownloadButton = ({
  movieId,
  title,
  magnetLink,
  downloadLinks,
  download_links,
  movie,
  label = 'Download',
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [lastClickedUrl, setLastClickedUrl] = useState(null);
  const dropdownRef = useRef(null);

  // 1. Add Console Log to inspect state
  console.log("Movie Data State:", movie);

  // 1. Extract the Links Safely: Create a variable before the return statement that checks all possible paths to the links array
  // We check for actual non-empty arrays first to avoid JS [] truthy short-circuiting
  const candidates = [
    downloadLinks,
    download_links,
    movie?.download_links,
    movie?.downloadLinks,
    movie?.data?.download_links,
    movie?.data?.downloadLinks
  ];

  let rawLinks = candidates.find(c => Array.isArray(c) && c.length > 0);
  if (!rawLinks) {
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 2 && c.trim() !== '[]') {
        try {
          const parsed = JSON.parse(c);
          if (Array.isArray(parsed) && parsed.length > 0) {
            rawLinks = parsed;
            break;
          }
        } catch {}
      }
    }
  }

  // Exact fallback structure requested:
  const linksArray = rawLinks || movie?.download_links || movie?.downloadLinks || movie?.data?.download_links || movie?.data?.downloadLinks || downloadLinks || download_links || [];
  // If it's stored as a stringified JSON by mistake, parse it:
  let parsedLinks = linksArray;
  try {
    parsedLinks = typeof linksArray === 'string' ? JSON.parse(linksArray) : linksArray;
  } catch (err) {
    console.error("Failed to parse linksArray JSON:", err);
    parsedLinks = [];
  }

  const linksList = Array.isArray(parsedLinks) ? parsedLinks : [];

  // Close dropdown on outside click or Touch
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    setIsOpen((prev) => !prev);
  };

  const handleLinkClick = (url) => {
    if (!url) return;
    setLastClickedUrl(url);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Webtor fallback link builder
  const buildWebtorUrl = () => {
    if (!magnetLink) return WEBTOR_URL;
    if (magnetLink.startsWith('magnet:')) return `${WEBTOR_URL}${magnetLink}`;
    return WEBTOR_URL;
  };

  const handleWebtorClick = () => {
    if (movieId) {
      const params = new URLSearchParams();
      if (magnetLink) params.append('magnet', magnetLink);
      if (title) params.append('title', title);
      const url = `${API_BASE_URL}/download/${encodeURIComponent(movieId)}${params.toString() ? `?${params}` : ''}`;
      axios.get(url, { timeout: 20000 }).catch(() => {});
    }
    window.open(buildWebtorUrl(), '_blank', 'noopener,noreferrer');
  };

  // 2. Conditional Rendering: Check if array exists and has items
  const hasDirectLinks = Boolean(linksList && linksList.length > 0);
  const hasTorrent = Boolean(magnetLink);

  return (
    <div
      ref={dropdownRef}
      className={`relative flex-1 flex flex-col items-stretch ${isOpen ? 'z-[100]' : 'z-20'}`}
    >
      {/* Main Trigger Button */}
      <button
        type="button"
        onClick={toggleDropdown}
        disabled={!hasDirectLinks && !hasTorrent}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={`inline-flex items-center justify-center space-x-2 font-bold py-3 px-6 rounded-xl transition-all duration-300 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-md cursor-pointer ${className}`}
      >
        <Download className="w-5 h-5 transition-transform duration-300 group-hover:translate-y-0.5" />
        <span>{label}</span>
        {hasDirectLinks && (
          <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-black/30 font-semibold">
            {linksList.length}
          </span>
        )}
        {isOpen ? (
          <ChevronUp className="w-4 h-4 ml-1 transition-transform" />
        ) : (
          <ChevronDown className="w-4 h-4 ml-1 transition-transform" />
        )}
      </button>

      {/* Styled Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          className="absolute z-[100] top-full mt-2 left-0 right-0 sm:left-0 sm:right-auto sm:w-80 rounded-2xl bg-[#141822] backdrop-blur-2xl border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.85)] p-3.5 space-y-2.5 animate-in fade-in zoom-in-95 duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-2 pb-2 border-b border-white/10">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                Download Options
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[#8b94a6] hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
              title="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 3. Map the Array: Render buttons by mapping over this array inside dropdown UI */}
          {hasDirectLinks ? (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
              <div className="text-[11px] font-semibold text-[#8b94a6] px-2 uppercase tracking-wider flex items-center justify-between">
                <span>Direct Cloud Links (DDL)</span>
                <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  {linksList.length} available
                </span>
              </div>
              {linksList.map((rawLink, idx) => {
                const link = typeof rawLink === 'string' ? { url: rawLink, quality: '1080p', provider: 'Direct Cloud' } : (rawLink || {});
                const linkUrl = link.url || link.link || (typeof rawLink === 'string' ? rawLink : '');
                const style = getProviderStyle(link.provider);
                const qualityBadge = getQualityBadge(link.quality);
                const isSelected = lastClickedUrl === linkUrl;

                return (
                  <button
                    key={link.id || `ddl-${idx}-${linkUrl || link.quality || idx}`}
                    onClick={() => handleLinkClick(linkUrl)}
                    className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center justify-between group active:scale-[0.98] cursor-pointer ${style.bg} ${style.border}`}
                  >
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <div className={`p-2 rounded-lg bg-black/40 ${style.text}`}>
                        <HardDrive className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-bold text-white group-hover:text-[var(--accent)] transition-colors truncate">
                            {link.provider || 'Direct Download'}
                          </span>
                        </div>
                        {link.size && (
                          <div className="text-xs text-[#8b94a6] mt-0.5">
                            {link.size}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${qualityBadge}`}>
                        {link.quality || '1080p'}
                      </span>
                      {isSelected ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <ExternalLink className="w-4 h-4 text-[#8b94a6] group-hover:text-white transition-colors" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-3 text-center rounded-xl bg-white/5 border border-white/5">
              <p className="text-xs text-[#8b94a6]">No direct cloud links added yet.</p>
            </div>
          )}

          {/* Torrent / Webtor fallback section */}
          {hasTorrent && (
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <div className="text-[11px] font-semibold text-[#8b94a6] px-2 uppercase tracking-wider">
                Torrent Engine
              </div>
              <button
                onClick={handleWebtorClick}
                className="w-full text-left p-3 rounded-xl border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 hover:border-orange-500/50 transition-all duration-200 flex items-center justify-between group active:scale-[0.98]"
              >
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-black/40 text-orange-400">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-white group-hover:text-orange-400 transition-colors">
                      WebTorrent (webtor.io)
                    </span>
                    <p className="text-[11px] text-[#8b94a6]">Stream & download via peer-to-peer</p>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-[#8b94a6] group-hover:text-white transition-colors flex-shrink-0 ml-2" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DownloadButton;
