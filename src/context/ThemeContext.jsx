import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// Category theme definitions
const CATEGORY_THEMES = {
  hollywood: {
    name: 'Hollywood',
    accent: '#ff9900',        // Neon Orange
    accentSoft: '#ffb84d',    // Lighter orange for hovers
    accentGlow: 'rgba(255, 153, 0, 0.1)',  // For shadows
  },
  tamil: {
    name: 'Tamil & Malayalam',
    accent: '#ff3b5c',        // Crimson Red
    accentSoft: '#ff6b85',    // Lighter red for hovers
    accentGlow: 'rgba(255, 59, 92, 0.1)',  // For shadows
  },
  tvshows: {
    name: 'TV Shows',
    accent: '#a855f7',        // Royal Violet
    accentSoft: '#c084fc',    // Lighter violet for hovers
    accentGlow: 'rgba(168, 85, 247, 0.1)', // For shadows
  },
};

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const location = useLocation();
  const [currentTheme, setCurrentTheme] = useState(CATEGORY_THEMES.hollywood);

  useEffect(() => {
    // Detect category from current route
    const path = location.pathname;
    
    let theme;
    if (path.startsWith('/tamil')) {
      theme = CATEGORY_THEMES.tamil;
    } else if (path.startsWith('/tv-shows')) {
      theme = CATEGORY_THEMES.tvshows;
    } else {
      // Default to Hollywood (home, single movie pages, etc.)
      theme = CATEGORY_THEMES.hollywood;
    }

    setCurrentTheme(theme);

    // Set CSS custom properties on document root
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.documentElement.style.setProperty('--accent-soft', theme.accentSoft);
    document.documentElement.style.setProperty('--accent-glow', theme.accentGlow);
  }, [location.pathname]);

  return (
    <ThemeContext.Provider value={currentTheme}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to access current theme
export const useCategoryTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useCategoryTheme must be used within ThemeProvider');
  }
  return context;
};

// Helper hook for inline styles (when Tailwind arbitrary values don't work)
export const useAccentStyles = () => {
  const theme = useCategoryTheme();
  
  return {
    accentText: { color: theme.accent },
    accentBg: { backgroundColor: theme.accent },
    accentBorder: { borderColor: theme.accent },
    accentShadow: { boxShadow: `0 10px 30px ${theme.accentGlow}` },
    accentShadowLg: { boxShadow: `0 20px 60px ${theme.accentGlow}, 0 10px 30px ${theme.accentGlow}` },
  };
};
