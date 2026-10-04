/**
 * UniVibe Opening & Intro Experience
 * Sequence:
 * 1. Intro plays on EVERY full page refresh.
 * 2. UniVibe wordmark begins larger than final size, smoothly scales down & settles.
 * 3. Tagline reveals smoothly underneath: "A space full of goooood vibes."
 * 4. When finished:
 *    - If authenticated: Intro → Welcome ("Welcome." 0.8–1.2s) → Home
 *    - If unauthenticated: Intro → Login / Sign Up / Continue without login
 */

const UniVibeIntro = (() => {
  let introEl = null;
  let isTransitioning = false;
  let introTimer = null;
  let typewriterTimer = null;
  let typewriterInterval = null;

  function init() {
    introEl = document.getElementById('intro-screen');
    if (!introEl) return;

    prepareTagline();

    // Intro plays on every full page refresh
    playIntroSequence();

    // Skip button affordance inside intro screen
    const skipBtn = document.getElementById('intro-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        cleanupTypewriter();
        if (introTimer) clearTimeout(introTimer);
        finishIntro();
      });
    }
  }

  function prepareTagline() {
    const tagline = introEl.querySelector('.intro-tagline');
    if (!tagline) return;

    // If typewriter character spans already exist, keep them
    if (tagline.querySelector('.typewriter-char')) return;

    const fullText = tagline.textContent.trim();
    tagline.setAttribute('aria-label', fullText);

    const stretchEl = tagline.querySelector('.vibe-stretch');
    const stretchWord = stretchEl ? stretchEl.textContent : 'goooood';

    const beforeText = "A space full of ";
    const afterText = " vibes.";

    tagline.innerHTML = '';

    function appendChars(text, parent) {
      for (let i = 0; i < text.length; i++) {
        const span = document.createElement('span');
        span.className = 'typewriter-char';
        span.textContent = text[i];
        parent.appendChild(span);
      }
    }

    appendChars(beforeText, tagline);

    const spanStretch = document.createElement('span');
    spanStretch.className = 'vibe-stretch';
    appendChars(stretchWord, spanStretch);
    tagline.appendChild(spanStretch);

    appendChars(afterText, tagline);
  }

  function cleanupTypewriter() {
    if (typewriterTimer) {
      clearTimeout(typewriterTimer);
      typewriterTimer = null;
    }
    if (typewriterInterval) {
      clearInterval(typewriterInterval);
      typewriterInterval = null;
    }
  }

  function playIntroSequence() {
    isTransitioning = true;
    introEl.classList.remove('intro-hidden', 'intro-leaving');

    const appShellEl = document.querySelector('.app-shell');
    if (appShellEl) {
      appShellEl.style.display = 'none';
      appShellEl.classList.remove('app-shell-visible');
    }

    // Reset typewriter chars to initial hidden state
    const chars = introEl.querySelectorAll('.typewriter-char');
    chars.forEach(c => c.classList.remove('is-typed'));

    cleanupTypewriter();

    // Exact sequence:
    // 1. UniVibe wordmark settles normally (1.1s + 0.25s delay in CSS = ~1.35s)
    // 2. Short pause (200ms) → start typing at 1.55s
    // 3. Characters type in sequentially from left to right (~35ms per character)
    // 4. Typing completes at ~2.60s
    // 5. Short pause (~650ms) to admire completed slogan
    // 6. Existing intro transition continues at 3.25s
    typewriterTimer = setTimeout(() => {
      let charIndex = 0;
      typewriterInterval = setInterval(() => {
        if (!isTransitioning || charIndex >= chars.length) {
          clearInterval(typewriterInterval);
          typewriterInterval = null;
          return;
        }
        chars[charIndex].classList.add('is-typed');
        charIndex++;
      }, 35);
    }, 1550);

    introTimer = setTimeout(() => {
      if (isTransitioning) {
        finishIntro();
      }
    }, 3250);
  }

  function finishIntro() {
    if (!introEl) return;
    cleanupTypewriter();
    isTransitioning = false;

    // Ensure all characters are visible upon finishing or skipping
    const chars = introEl.querySelectorAll('.typewriter-char');
    chars.forEach(c => c.classList.add('is-typed'));

    introEl.classList.add('intro-leaving');

    setTimeout(() => {
      introEl.classList.add('intro-hidden');
    }, 450);

    // Startup flow: Every refresh → Intro → Authentication screen → Home
    if (window.UniVibeAuth) {
      window.UniVibeAuth.showStartupAuth();
    } else {
      const appShellEl = document.querySelector('.app-shell');
      if (appShellEl) {
        appShellEl.classList.add('app-shell-visible');
      }
    }
  }

  return {
    init,
    finishIntro
  };
})();

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', UniVibeIntro.init);
} else {
  UniVibeIntro.init();
}
