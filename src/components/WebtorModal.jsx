import React, { useEffect } from 'react';
import { X } from 'lucide-react';

const WebtorModal = ({ isOpen, onClose, magnetLink, title = 'Webtor Player' }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const webtorUrl = `https://webtor.io/show?magnet=${encodeURIComponent(magnetLink)}`;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" />
      
      <div 
        className="relative w-full max-w-7xl h-[90vh] glass-card rounded-2xl overflow-hidden shadow-2xl shadow-[#ff9900]/20 animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="glass-navbar border-b border-white/5 p-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-white truncate">{title}</h3>
            <p className="text-sm text-[#8b94a6]">Powered by Webtor.io</p>
          </div>
          
          <button
            onClick={onClose}
            className="flex-shrink-0 ml-4 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-400 hover:to-pink-400 text-white p-2 rounded-lg transition-all duration-300 transform hover:scale-110 shadow-lg active:scale-95"
            aria-label="Close Modal"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="relative w-full h-[calc(100%-4rem)] bg-black">
          <iframe
            src={webtorUrl}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="Webtor Player"
          />
        </div>
      </div>
    </div>
  );
};

export default WebtorModal;
