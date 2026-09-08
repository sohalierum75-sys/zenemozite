import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, NavLink, useLocation } from 'react-router-dom';
import { Film, Search, Home, Tv, Menu, X } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const Navbar = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef(null);
  const suggestionsRef = useRef(null);
  
  // Fixed accent color (Hollywood Orange)
  const accentColor = '#ff9900';

  // Determine active tab based on current path
  const isHollywoodActive = location.pathname === '/' || 
    (location.pathname.startsWith('/movie/') && !location.pathname.includes('/tamil'));
  const isTamilActive = location.pathname.startsWith('/tamil');
  const isTVShowsActive = location.pathname.startsWith('/tv-shows') || location.pathname.startsWith('/tv/');

  // Debounce search query
  useEffect(() => {
    const delayTimer = setTimeout(() => {
      if (searchQuery.trim().length > 2) {
        fetchSuggestions(searchQuery);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(delayTimer);
  }, [searchQuery]);

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSuggestions = async (query) => {
    try {
      setIsSearching(true);
      console.log('[SEARCH] Fetching suggestions for:', query);

      const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
      const result = await response.json();

      console.log('[SEARCH] Suggestions received:', result);

      if (result.success && result.data) {
        setSuggestions(result.data);
        setShowSuggestions(result.data.length > 0);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error('[SEARCH] Error fetching suggestions:', error);
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      console.log('[SEARCH] Navigating to search results:', searchQuery);
      navigate(`/search/${encodeURIComponent(searchQuery)}`);
      setShowSuggestions(false);
      setSearchQuery('');
    }
  };

  const handleSuggestionClick = (id, mediaType) => {
    console.log('[SEARCH] Navigating to:', mediaType, id);
    
    // CRITICAL: Route based on media_type to prevent loading wrong content
    if (mediaType === 'tv') {
      navigate(`/tv/${id}`);
    } else if (mediaType === 'movie') {
      navigate(`/movie/${id}`);
    } else {
      // Fallback: assume movie if media_type is missing
      console.warn('[SEARCH] media_type missing, defaulting to movie');
      navigate(`/movie/${id}`);
    }
    
    setShowSuggestions(false);
    setSearchQuery('');
    setIsMobileMenuOpen(false);
  };

  const handleSearchFocus = () => {
    setIsSearchFocused(true);
    if (searchQuery.trim().length > 2 && suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };

  const handleSearchBlur = () => {
    setIsSearchFocused(false);
  };

  return (
    <nav className="glass-navbar sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2 group">
            <img 
              src="/logo.jpeg" 
              alt="Zinemo Logo" 
              className="w-8 h-8 rounded-lg object-cover transition-all duration-350 group-hover:scale-110" 
            />
            <span 
              className="text-2xl font-bold transition-all duration-350"
              style={{ color: accentColor }}
            >
              Zinemo
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <Link 
              to="/" 
              className={`flex items-center space-x-1 font-medium transition-accent ${
                isHollywoodActive ? 'text-[#ff9900]' : 'text-white/80 hover:text-white'
              }`}
            >
              <Home className="w-4 h-4" />
              <span>Hollywood | ඉංග්‍රීසි</span>
            </Link>
            <Link 
              to="/tamil" 
              className={`flex items-center space-x-1 font-medium transition-accent ${
                isTamilActive ? 'text-[#ff9900]' : 'text-white/80 hover:text-white'
              }`}
            >
              <Film className="w-4 h-4" />
              <span>Tamil & Malayalam | දකුණු ඉන්දීය</span>
            </Link>
            <Link 
              to="/tv-shows" 
              className={`flex items-center space-x-1 font-medium transition-accent ${
                isTVShowsActive ? 'text-[#ff9900]' : 'text-white/80 hover:text-white'
              }`}
            >
              <Tv className="w-4 h-4" />
              <span>TV Shows | ටීවී කතාමාලා</span>
            </Link>
          </div>

          {/* Desktop Search Bar with Auto-Suggest */}
          <div className="hidden md:block relative" ref={searchRef}>
            <form onSubmit={handleSearch}>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search movies, TV shows..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={handleSearchFocus}
                  onBlur={handleSearchBlur}
                  className={`bg-white/5 backdrop-blur-md text-white pl-10 pr-4 py-2 rounded-xl w-64 focus:outline-none transition-all duration-300 border ${
                    isSearchFocused ? 'border-[var(--accent)]/30 bg-white/10' : 'border-white/5'
                  }`}
                />
                <Search 
                  className={`w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 transition-accent ${
                    isSearching ? 'animate-pulse' : ''
                  }`}
                  style={isSearchFocused ? { color: 'var(--accent)' } : { color: '#8b94a6' }}
                />
              </div>
            </form>

            {/* Auto-Suggest Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div 
                ref={suggestionsRef}
                className="absolute top-full mt-2 w-96 bg-[#1a1c23]/90 backdrop-blur-lg border border-white/10 rounded-lg shadow-2xl overflow-hidden z-50"
              >
                <div className="max-h-96 overflow-y-auto">
                  {suggestions
                    .filter(item => item.media_type !== 'person')
                    .map((item) => (
                    <div
                      key={`${item.id}-${item.media_type}`}
                      onClick={() => handleSuggestionClick(item.id, item.media_type)}
                      className="flex items-center space-x-3 p-3 hover:bg-[var(--accent)]/10 cursor-pointer transition-all duration-200 border-b border-white/5 last:border-b-0"
                    >
                      {/* Poster Thumbnail */}
                      <div className="flex-shrink-0 w-12 h-16 bg-[#0f1115] rounded overflow-hidden">
                        {item.poster ? (
                          <img
                            src={item.poster}
                            alt={item.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.src = 'https://via.placeholder.com/48x64/1a1d29/8b94a6?text=No+Poster';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#8b94a6] text-xs">
                            No Image
                          </div>
                        )}
                      </div>

                      {/* Title and Details */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate hover:text-[var(--accent)] transition-accent">
                          {item.title}
                        </p>
                        <div className="flex items-center space-x-2 text-sm text-[#8b94a6]">
                          {item.year && <span>{item.year}</span>}
                          {item.year && item.media_type && <span>•</span>}
                          {item.media_type && (
                            <span className="capitalize">{item.media_type === 'tv' ? 'TV Show' : 'Movie'}</span>
                          )}
                          {item.rating > 0 && (
                            <>
                              <span>•</span>
                              <span>{item.rating.toFixed(1)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* View All Results Footer */}
                <div
                  onClick={() => {
                    navigate(`/search/${encodeURIComponent(searchQuery)}`);
                    setShowSuggestions(false);
                    setSearchQuery('');
                  }}
                  className="p-3 bg-[#0f1115]/50 hover:bg-[var(--accent)]/10 cursor-pointer transition-all duration-200 text-center border-t border-white/10"
                >
                  <p className="text-[var(--accent)] font-medium text-sm transition-accent">
                    View all results for "{searchQuery}"
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden text-white transition-all duration-350 hover:text-[#ff9900]"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-[#1a1c23]/70 backdrop-blur-md border-t border-white/5">
          <div className="px-4 pt-2 pb-4 space-y-3">
            {/* Mobile Search */}
            <form onSubmit={handleSearch}>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search movies, TV shows..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={handleSearchFocus}
                  className="bg-white/5 backdrop-blur-md text-white pl-10 pr-4 py-2 rounded-xl w-full focus:outline-none border border-white/5 focus:border-[var(--accent)]/30 focus:bg-white/10 transition-all duration-300"
                />
                <Search 
                  className={`w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 ${
                    isSearching ? 'animate-pulse' : ''
                  }`}
                  style={{ color: '#8b94a6' }}
                />
              </div>
            </form>

            {/* Mobile Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="bg-[#1a1c23]/90 backdrop-blur-lg border border-white/10 rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  {suggestions
                    .filter(item => item.media_type !== 'person')
                    .map((item) => (
                    <div
                      key={`${item.id}-${item.media_type}`}
                      onClick={() => handleSuggestionClick(item.id, item.media_type)}
                      className="flex items-center space-x-3 p-3 hover:bg-[var(--accent)]/10 cursor-pointer transition-all duration-200 border-b border-white/5 last:border-b-0"
                    >
                      <div className="flex-shrink-0 w-10 h-14 bg-[#0f1115] rounded overflow-hidden">
                        {item.poster ? (
                          <img
                            src={item.poster}
                            alt={item.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.src = 'https://via.placeholder.com/40x56/1a1d29/8b94a6?text=No';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#8b94a6] text-xs">
                            No
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm truncate">{item.title}</p>
                        <p className="text-xs text-[#8b94a6]">
                          {item.year} • {item.media_type === 'tv' ? 'TV' : 'Movie'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mobile Links */}
            <NavLink
              to="/"
              end
              className={({ isActive }) => 
                `flex items-center space-x-2 py-2 rounded-lg px-3 transition-colors ${
                  isActive ? 'bg-[#ff9900]/10 text-[#ff9900]' : 'text-white hover:bg-white/5'
                }`
              }
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <Home className="w-5 h-5" />
              <span>Hollywood | ඉංග්‍රීසි</span>
            </NavLink>
            <NavLink
              to="/tamil"
              className={({ isActive }) => 
                `flex items-center space-x-2 py-2 rounded-lg px-3 transition-colors ${
                  isActive ? 'bg-[#ff9900]/10 text-[#ff9900]' : 'text-white hover:bg-white/5'
                }`
              }
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <Film className="w-5 h-5" />
              <span>Tamil & Malayalam | දකුණු ඉන්දීය</span>
            </NavLink>
            <NavLink
              to="/tv-shows"
              className={({ isActive }) => 
                `flex items-center space-x-2 py-2 rounded-lg px-3 transition-colors ${
                  isActive ? 'bg-[#ff9900]/10 text-[#ff9900]' : 'text-white hover:bg-white/5'
                }`
              }
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <Tv className="w-5 h-5" />
              <span>TV Shows | ටීවී කතාමාලා</span>
            </NavLink>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;