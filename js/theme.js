/**
 * UniVibe Theme Detection & Management
 * Requirement: Automatically detect OS/browser color preference on load.
 * If light: Light Mode.
 * If dark: Dark Mode.
 * Do NOT initially show a theme selection screen.
 */

const UniVibeTheme = (() => {
  const STORAGE_KEY = 'univibe_theme_override';
  const htmlEl = document.documentElement;

  // Detect system color preference
  function getSystemPreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  // Get active theme (query parameter override, stored override, or system preference default)
  function getActiveTheme() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlTheme = urlParams.get('theme');
      if (urlTheme === 'light' || urlTheme === 'dark') {
        return urlTheme;
      }
    } catch (e) {}

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    return getSystemPreference();
  }

  // Apply theme to DOM
  function applyTheme(theme) {
    htmlEl.setAttribute('data-theme', theme);

    // Update meta theme-color for browser frame on mobile/desktop
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.name = 'theme-color';
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.content = theme === 'dark' ? '#191716' : '#FAF7F2';

    // Update any theme toggles in UI
    updateToggleButtons(theme);
  }

  function updateToggleButtons(theme) {
    const buttons = document.querySelectorAll('[data-action="toggle-theme"]');
    buttons.forEach(btn => {
      const icon = btn.querySelector('.theme-icon-indicator');
      const label = btn.querySelector('.theme-label-indicator');
      if (theme === 'dark') {
        if (icon) icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
        if (label) label.textContent = 'Light Mode';
        btn.setAttribute('aria-label', 'Switch to light mode');
      } else {
        if (icon) icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
        if (label) label.textContent = 'Dark Mode';
        btn.setAttribute('aria-label', 'Switch to dark mode');
      }
    });
  }

  // Toggle theme manually (provided for easy developer & user inspection)
  function toggleTheme() {
    const current = htmlEl.getAttribute('data-theme') || getActiveTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    return next;
  }

  // Initialize
  function init() {
    const initialTheme = getActiveTheme();
    applyTheme(initialTheme);

    // Listen for OS/browser color preference changes in real-time
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e) => {
        // Only automatically follow system if user has not explicitly chosen an override
        if (!localStorage.getItem(STORAGE_KEY)) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      };
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleChange);
      }
    }

    // Attach click listeners to all theme toggle buttons
    document.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('[data-action="toggle-theme"]');
      if (toggleBtn) {
        e.preventDefault();
        toggleTheme();
      }
    });
  }

  return {
    init,
    applyTheme,
    toggleTheme,
    getActiveTheme,
    getSystemPreference
  };
})();

window.UniVibeTheme = UniVibeTheme;

// Auto-run early to prevent flash of wrong theme
UniVibeTheme.init();
