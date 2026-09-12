import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

/**
 * LocaleContext — Geo-IP based localization.
 *
 * Detects the visitor's country once on app load and exposes it to the whole
 * tree. Sinhala (si) content is ONLY rendered when the visitor is confirmed to
 * be in Sri Lanka ('LK'). Every other country — and any failure of the geo API
 * (blocked by an adblocker, offline, timeout, etc.) — safely falls back to the
 * English-only UI.
 */

const GEO_API_URL = 'https://get.geojs.io/v1/ip/country.json';
const STORAGE_KEY = 'zinemo_geo_country';
const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Re-check the API once a week
const FETCH_TIMEOUT_MS = 5000;

const LocaleContext = createContext(null);

/** Read a previously detected country from localStorage (with TTL). */
const readCachedCountry = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.country !== 'string') return null;
    if (Date.now() - (parsed.timestamp || 0) > STORAGE_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.country;
  } catch {
    return null;
  }
};

const cacheCountry = (country) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ country, timestamp: Date.now() }));
  } catch {
    // localStorage unavailable (private mode etc.) — detection still works per visit
  }
};

/**
 * Resolve the visitor's country code.
 * Priority:
 *   1. Cloudflare edge injection — `window.CF_IPCOUNTRY` or a
 *      `data-cf-ipcountry` attribute on <html> (set by a Cloudflare
 *      Worker/Pages function that forwards the CF-IPCountry header).
 *   2. Free IP geolocation API (geojs.io) with a hard timeout so a blocked
 *      request can never hang the UI.
 * Returns null when detection fails (caller falls back to English-only).
 */
const detectCountry = async () => {
  // 1. Cloudflare-injected country (zero extra network round-trip)
  if (typeof window !== 'undefined' && window.CF_IPCOUNTRY) {
    return window.CF_IPCOUNTRY;
  }
  const cfAttr = document.documentElement?.getAttribute?.('data-cf-ipcountry');
  if (cfAttr) {
    return cfAttr;
  }

  // 2. Geo IP API
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(GEO_API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Geo API responded with HTTP ${response.status}`);
    }
    const data = await response.json();
    return data?.country || null;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const LocaleProvider = ({ children }) => {
  // English is the safe default everywhere until 'LK' is CONFIRMED.
  const [country, setCountry] = useState(null);
  const [language, setLanguage] = useState('en');
  const [isLk, setIsLk] = useState(false);
  const [geoLoading, setGeoLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const applyCountry = (code) => {
      setCountry(code);
      const lk = code === 'LK';
      setIsLk(lk);
      setLanguage(lk ? 'si' : 'en'); // Default site language
      document.documentElement.lang = lk ? 'si' : 'en';
    };

    const cached = readCachedCountry();
    if (cached) {
      applyCountry(cached);
      setGeoLoading(false);
      return () => {
        cancelled = true;
      };
    }

    detectCountry()
      .then((code) => {
        if (cancelled) return;
        if (code) cacheCountry(code);
        applyCountry(code); // null => English-only fallback
      })
      .catch(() => {
        // API failed / blocked by adblocker / timeout — default to English UI
        if (!cancelled) applyCountry(null);
      })
      .finally(() => {
        if (!cancelled) setGeoLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Translate helper: returns the Sinhala string only for LK visitors. */
  const t = useCallback(
    (english, sinhala) => (language === 'si' && sinhala ? sinhala : english),
    [language]
  );

  return (
    <LocaleContext.Provider value={{ country, language, isLk, geoLoading, t }}>
      {children}
    </LocaleContext.Provider>
  );
};

// Custom hook to access the current locale state
export const useLocale = () => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return context;
};
