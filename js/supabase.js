/**
 * UniVibe Supabase Client Manager
 * Initializes the official Supabase JS client using environment variables.
 * Keys are loaded from window.__ENV__ (or fetched from .env at runtime), never hardcoded.
 */

const UniVibeSupabase = (() => {
  let client = null;
  let isReady = false;
  let supabaseUrl = '';
  let supabaseAnonKey = '';
  let initPromise = null;

  function parseEnvString(text) {
    if (!text) return;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();

      // Strip surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      if (key === 'SUPABASE_URL' || key === 'VITE_SUPABASE_URL' || key === 'NEXT_PUBLIC_SUPABASE_URL') {
        if (!supabaseUrl && val) supabaseUrl = val;
      } else if (key === 'SUPABASE_ANON_KEY' || key === 'VITE_SUPABASE_ANON_KEY' || key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
        if (!supabaseAnonKey && val) supabaseAnonKey = val;
      }
    }
  }

  async function loadConfig() {
    // 1. Check window.__ENV__ first (from optional env.js)
    if (window.__ENV__) {
      if (window.__ENV__.SUPABASE_URL) supabaseUrl = window.__ENV__.SUPABASE_URL;
      if (window.__ENV__.SUPABASE_ANON_KEY) supabaseAnonKey = window.__ENV__.SUPABASE_ANON_KEY;
    }

    // 2. If not found in window.__ENV__, attempt fetching /.env from the local server
    if (!supabaseUrl || !supabaseAnonKey) {
      try {
        const response = await fetch('/.env');
        if (response.ok) {
          const content = await response.text();
          parseEnvString(content);
        }
      } catch (err) {
        // Fallback gracefully if fetch is blocked or file not found
      }
    }

    // 3. Validate credentials
    const isPlaceholder = (val) => !val || val.includes('your-project') || val.includes('your-anon-key');
    if (!supabaseUrl || !supabaseAnonKey || isPlaceholder(supabaseUrl) || isPlaceholder(supabaseAnonKey)) {
      console.warn(
        '[UniVibe] Supabase is not configured yet.\n' +
        'Please add your SUPABASE_URL and SUPABASE_ANON_KEY to your .env file or env.js.\n' +
        'See .env.example for reference.'
      );
      isReady = false;
      return null;
    }

    // 4. Initialize official Supabase client (with retry in case CDN script loads asynchronously)
    for (let attempt = 0; attempt < 5; attempt++) {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        try {
          client = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
              storage: window.localStorage
            }
          });
          isReady = true;
          return client;
        } catch (e) {
          console.error('[UniVibe] Error initializing Supabase client:', e);
          isReady = false;
          return null;
        }
      }
      // Wait 100ms before retrying
      await new Promise(r => setTimeout(r, 100));
    }

    console.error('[UniVibe] Supabase JS SDK not loaded on window.supabase. Ensure @supabase/supabase-js is included.');
    isReady = false;
    return null;
  }

  function init() {
    if (!initPromise) {
      initPromise = loadConfig();
    }
    return initPromise;
  }

  function getClient() {
    return client;
  }

  function isConfigured() {
    return isReady && client !== null;
  }

  function getConfig() {
    return {
      url: supabaseUrl,
      hasKey: Boolean(supabaseAnonKey)
    };
  }

  // Auto-start initialization
  init();

  return {
    init,
    getClient,
    isConfigured,
    getConfig
  };
})();

// Explicitly bind to window for global access across scripts
window.UniVibeSupabase = UniVibeSupabase;
