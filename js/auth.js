/**
 * UniVibe Authentication & Toast Notification Controller
 * Powered by Supabase Auth with persistent sessions, real credential verification,
 * and user profile foundation.
 */

// Toast notification component mounted on window.UniVibeToast
const UniVibeToast = (() => {
  let container = null;

  function getContainer() {
    if (!container) {
      container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
      }
    }
    return container;
  }

  function show(message, duration = 4000) {
    if (!message) return;
    const cont = getContainer();
    const toast = document.createElement('div');
    toast.className = 'univibe-toast';
    toast.textContent = message;
    cont.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);
  }

  return { show };
})();
window.UniVibeToast = UniVibeToast;

const UniVibeAuth = (() => {
  let authenticatedUser = null;
  let isGuestActive = false;
  let authInitPromise = null;
  let authedAutoTimer = null;

  /**
   * Initializes Supabase Auth state, sets up session listeners,
   * and cleans legacy fake localStorage items.
   */
  async function init() {
    // 1. Remove obsolete simulated auth item so it cannot be used as a source of truth
    try {
      localStorage.removeItem('univibe_current_user');
    } catch (e) {}

    // 2. Initialize events and wire UI
    setupStartupAuthEvents();
    setupGuestPromptEvents();
    setupGlobalInterceptors();

    // 3. Initialize Supabase client and restore active session
    authInitPromise = restoreSession();
    await authInitPromise;

    updateUserUI();
  }

  /**
   * Restores active Supabase session if present.
   */
  async function restoreSession() {
    try {
      if (!window.UniVibeSupabase) return null;
      await window.UniVibeSupabase.init();

      const supabase = window.UniVibeSupabase.getClient();
      if (!supabase) return null;

      // Listen for runtime auth state changes
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (session && session.user) {
          await loadUserProfile(session.user);
        } else if (event === 'SIGNED_OUT') {
          authenticatedUser = null;
          isGuestActive = false;
          updateUserUI();
        }
      });

      // Query active session stored by Supabase SDK
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.warn('[UniVibe Auth] Error retrieving session:', error.message);
        return null;
      }

      if (session && session.user) {
        await loadUserProfile(session.user);
        return session.user;
      }
    } catch (err) {
      console.warn('[UniVibe Auth] Session restoration error:', err);
    }
    return null;
  }

  /**
   * Loads or creates the user's profile from the `profiles` table.
   */
  async function loadUserProfile(user) {
    if (!user) {
      authenticatedUser = null;
      return null;
    }

    const metadata = user.user_metadata || {};
    const fallbackName = metadata.name || (user.email ? user.email.split('@')[0] : 'Campus Member');
    const fallbackHandle = metadata.handle ? metadata.handle.replace(/^@/, '') : (user.email ? user.email.split('@')[0].toLowerCase() : `user_${user.id.slice(0, 6)}`);
    const fallbackBio = metadata.bio || '';
    const fallbackAvatar = metadata.avatar_url || null;

    let profileData = {
      id: user.id,
      name: fallbackName,
      handle: fallbackHandle,
      bio: fallbackBio,
      email: user.email || '',
      avatarUrl: fallbackAvatar
    };

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (supabase) {
      try {
        let profile = null;
        let queryErr = null;

        try {
          const res = await supabase
            .from('profiles')
            .select('id, name, handle, bio, email, avatar_url')
            .eq('id', user.id)
            .maybeSingle();
          profile = res.data;
          queryErr = res.error;
        } catch (e) {
          queryErr = e;
        }

        // Graceful fallback if avatar_url column does not exist yet
        if (queryErr && queryErr.message && queryErr.message.includes('avatar_url')) {
          const fallbackRes = await supabase
            .from('profiles')
            .select('id, name, handle, bio, email')
            .eq('id', user.id)
            .maybeSingle();
          profile = fallbackRes.data;
          queryErr = fallbackRes.error;
        }

        if (!queryErr && profile) {
          profileData = {
            id: profile.id,
            name: profile.name || fallbackName,
            handle: profile.handle ? profile.handle.replace(/^@/, '') : fallbackHandle,
            bio: profile.bio !== undefined && profile.bio !== null ? profile.bio : fallbackBio,
            email: profile.email || user.email || '',
            avatarUrl: profile.avatar_url || fallbackAvatar
          };
        } else if (!queryErr && !profile) {
          // Upsert baseline profile if not yet created and table exists
          try {
            await supabase.from('profiles').upsert({
              id: user.id,
              name: profileData.name,
              handle: profileData.handle,
              bio: profileData.bio,
              email: profileData.email,
              updated_at: new Date().toISOString()
            });
          } catch (upsertErr) {
            console.warn('[UniVibe Auth] Could not upsert profile:', upsertErr);
          }
        }
      } catch (e) {
        console.warn('[UniVibe Auth] Profiles query error, falling back to metadata:', e);
      }
    }

    authenticatedUser = profileData;
    isGuestActive = false;
    updateUserUI();
    return authenticatedUser;
  }

  function isAuthenticated() {
    return Boolean(authenticatedUser && authenticatedUser.id);
  }

  function isGuest() {
    return !isAuthenticated();
  }

  function getCurrentUser() {
    if (isAuthenticated()) {
      return {
        id: authenticatedUser.id,
        name: authenticatedUser.name || (authenticatedUser.email ? authenticatedUser.email.split('@')[0] : 'Campus Member'),
        handle: authenticatedUser.handle ? authenticatedUser.handle.replace(/^@/, '') : (authenticatedUser.email ? authenticatedUser.email.split('@')[0].toLowerCase() : `user_${authenticatedUser.id.slice(0, 6)}`),
        bio: authenticatedUser.bio || '',
        email: authenticatedUser.email || '',
        avatarUrl: authenticatedUser.avatarUrl || null,
        isGuest: false
      };
    }
    return {
      id: null,
      name: 'Guest',
      handle: 'Exploring UniVibe',
      bio: '',
      email: '',
      avatarUrl: null,
      isGuest: true
    };
  }

  /**
   * Updates the current authenticated user's profile in Supabase (profiles table + auth user_metadata)
   */
  async function updateProfile({ name, handle, bio, avatarUrl }) {
    const cur = getCurrentUser();
    if (!cur || cur.isGuest || !cur.id) {
      throw new Error('You must be signed in to edit your profile.');
    }

    const cleanName = (name || '').trim();
    let cleanHandle = (handle || '').trim();
    const cleanBio = (bio || '').trim();

    if (!cleanName) {
      throw new Error('Name cannot be empty.');
    }

    if (!cleanHandle) {
      throw new Error('Handle cannot be empty.');
    }

    // Validate handle format (letters, numbers, spaces, underscores, dots, brackets, parentheses; 2-30 chars)
    const handleRegex = /^[a-zA-Z0-9_. \[\]()]{2,30}$/;
    if (!handleRegex.test(cleanHandle)) {
      throw new Error('Handle must be 2–30 characters and can only contain letters, numbers, spaces, underscores, dots, brackets, and parentheses.');
    }

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) {
      throw new Error('Database connection unavailable.');
    }

    const userId = cur.id;

    // 1. Update public.profiles table
    const profilePayload = {
      id: userId,
      name: cleanName,
      handle: cleanHandle,
      bio: cleanBio,
      email: cur.email || '',
      updated_at: new Date().toISOString()
    };

    if (avatarUrl !== undefined) {
      profilePayload.avatar_url = avatarUrl;
    }

    try {
      let { error: profileErr } = await supabase
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' });

      // Fallback if avatar_url column does not exist yet
      if (profileErr && profileErr.message && profileErr.message.includes('avatar_url')) {
        console.warn('[UniVibe Auth] avatar_url column missing, falling back to base profile columns:', profileErr);
        delete profilePayload.avatar_url;
        const retryResult = await supabase
          .from('profiles')
          .upsert(profilePayload, { onConflict: 'id' });
        profileErr = retryResult.error;
      }

      if (profileErr) {
        console.error('[UniVibe Auth] Error updating profiles table:', profileErr);
        throw new Error(profileErr.message || 'Failed to save profile changes to database.');
      }
    } catch (tblErr) {
      console.error('[UniVibe Auth] Exception updating profiles table:', tblErr);
      throw tblErr;
    }

    // 2. Also update auth.users metadata so active session holds latest info
    try {
      if (supabase.auth && typeof supabase.auth.updateUser === 'function') {
        const metaPayload = {
          name: cleanName,
          handle: cleanHandle,
          bio: cleanBio
        };
        if (avatarUrl !== undefined) {
          metaPayload.avatar_url = avatarUrl;
        }
        await supabase.auth.updateUser({
          data: metaPayload
        });
      }
    } catch (authUpdateErr) {
      console.warn('[UniVibe Auth] Notice updating auth user_metadata:', authUpdateErr);
    }

    // 3. Update in-memory state
    if (!authenticatedUser) {
      authenticatedUser = { id: userId, email: cur.email || '' };
    }
    authenticatedUser.name = cleanName;
    authenticatedUser.handle = cleanHandle;
    authenticatedUser.bio = cleanBio;
    if (avatarUrl !== undefined) {
      authenticatedUser.avatarUrl = avatarUrl;
    }

    // 4. Update UI throughout app
    updateUserUI();

    // 5. Notify feed to update any loaded posts by this user
    if (window.UniVibeFeed && typeof window.UniVibeFeed.onProfileUpdated === 'function') {
      window.UniVibeFeed.onProfileUpdated(userId, cleanName, cleanHandle, cleanBio, authenticatedUser.avatarUrl);
    }

    return authenticatedUser;
  }

  function getInitials(name) {
    if (!name) return 'UV';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /**
   * Inline Form Error Display
   * Renders a clean, accessible, persistent alert box inside the active form.
   */
  function setAuthError(bannerId, title, message, hint = '') {
    const banner = document.getElementById(bannerId);
    if (!banner) return;
    banner.innerHTML = `
      <svg class="auth-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <div class="auth-error-content">
        <strong class="auth-error-title">${title}</strong>
        <div>${message}</div>
        ${hint ? `<span class="auth-error-hint">${hint}</span>` : ''}
      </div>
    `;
    banner.style.display = 'flex';
  }

  function clearAuthError(bannerId) {
    const banner = document.getElementById(bannerId);
    if (banner) {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
  }

  function clearAllAuthErrors() {
    clearAuthError('login-error-banner');
    clearAuthError('signup-error-banner');
    clearAuthError('modal-login-error-banner');
    clearAuthError('modal-signup-error-banner');
  }

  /**
   * Real Supabase Log In (Email + Password)
   * Also supports typing campus handle (looks up email in profiles table).
   */
  async function login(identifier, password, triggerSource = 'startup') {
    const bannerId = triggerSource === 'startup' ? 'login-error-banner' : 'modal-login-error-banner';
    clearAuthError(bannerId);

    const trimmedId = (identifier || '').trim();
    const trimmedPass = (password || '').trim();

    if (!trimmedId || !trimmedPass) {
      setAuthError(bannerId, 'Missing Credentials', 'Please enter both your email/handle and password.');
      showToast('Please enter both your email/handle and password.');
      return;
    }

    // Ensure client initialization is complete
    if (window.UniVibeSupabase) {
      await window.UniVibeSupabase.init();
    }

    if (!window.UniVibeSupabase || !window.UniVibeSupabase.isConfigured()) {
      setAuthError(bannerId, 'Configuration Error', 'Supabase is not configured yet. Please check your settings.');
      showToast('Supabase is not configured yet. Please check your .env settings.');
      return;
    }

    const supabase = window.UniVibeSupabase.getClient();
    if (!supabase) {
      setAuthError(bannerId, 'Connection Error', 'Could not access Supabase client.');
      showToast('Could not access Supabase client.');
      return;
    }

    const submitBtn = triggerSource === 'startup'
      ? document.querySelector('#form-login button[type="submit"]')
      : document.querySelector('#form-modal-login button[type="submit"]');

    const originalBtnText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';
    }

    try {
      let resolvedEmail = null;

      // Handle vs Email Resolution
      const isEmail = trimmedId.includes('@') && trimmedId.includes('.') && !trimmedId.startsWith('@');

      if (isEmail) {
        resolvedEmail = trimmedId.toLowerCase();
      } else {
        // User typed a campus handle (e.g. @alex or alex)
        const handleQuery = trimmedId.startsWith('@') ? trimmedId : ('@' + trimmedId);
        try {
          const { data: profileMatch, error: pError } = await supabase
            .from('profiles')
            .select('email')
            .ilike('handle', handleQuery)
            .maybeSingle();

          if (!pError && profileMatch && profileMatch.email) {
            resolvedEmail = profileMatch.email.trim().toLowerCase();
          }
        } catch (err) {
          console.warn('[UniVibe Auth] Error resolving handle:', err);
        }

        if (!resolvedEmail) {
          if (trimmedId.includes('@') && trimmedId.includes('.')) {
            resolvedEmail = trimmedId.toLowerCase();
          } else {
            const handleMsg = 'Could not find an account with that campus handle. Please enter your email address to log in.';
            setAuthError(bannerId, 'Account Not Found', handleMsg);
            showToast(handleMsg);
            return;
          }
        }
      }

      // Real Supabase Auth call with exact normalized credentials
      const { data, error } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password: trimmedPass
      });

      if (error) {
        console.warn('[UniVibe Auth] signInWithPassword error:', error);
        let errorTitle = 'Login Failed';
        let errorMsg = error.message || 'Invalid email or password.';
        let errorHint = '';

        const msgLower = (error.message || '').toLowerCase();
        if (msgLower.includes('invalid login credentials')) {
          errorTitle = 'Invalid Credentials';
          errorMsg = 'Incorrect email or password.';
          errorHint = 'If you recently signed up, your account may be unconfirmed, or verify your email and password.';
        } else if (msgLower.includes('email not confirmed')) {
          errorTitle = 'Email Not Confirmed';
          errorMsg = 'This account has not been confirmed yet.';
          errorHint = 'Turn OFF "Confirm email" in Supabase Dashboard (Authentication → Providers → Email) or run schema_auth_autoconfirm.sql in SQL Editor.';
        } else if (error.status === 400) {
          errorTitle = 'Invalid Credentials';
          errorMsg = error.message || 'Incorrect email or password.';
        }

        setAuthError(bannerId, errorTitle, errorMsg, errorHint);
        showToast(errorMsg);
        return;
      }

      if (data && data.user) {
        clearAuthError(bannerId);
        await loadUserProfile(data.user);

        // Hide auth views
        hideStartupAuth();
        closeGuestAuthModal();

        // Clear input fields
        const loginForm = document.getElementById('form-login');
        const modalLoginForm = document.getElementById('form-modal-login');
        if (loginForm) loginForm.reset();
        if (modalLoginForm) modalLoginForm.reset();

        // Smooth transition to Welcome screen and reveal Home
        showWelcomeTransition(() => {
          revealHome();
          showToast(`Welcome back, ${authenticatedUser.name}! ✨`);
        });
      }
    } catch (err) {
      console.error('[UniVibe Auth] Login exception:', err);
      setAuthError(bannerId, 'Unexpected Error', err.message || 'An unexpected error occurred during login.');
      showToast(err.message || 'An unexpected error occurred during login.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    }
  }

  /**
   * Real Supabase Sign Up (Email, Name, Handle, Password)
   * Inserts the baseline user record into `profiles` and auto-logs in.
   */
  async function signup(name, email, handle, password, triggerSource = 'startup') {
    const bannerId = triggerSource === 'startup' ? 'signup-error-banner' : 'modal-signup-error-banner';
    clearAuthError(bannerId);

    const trimmedName = (name || '').trim();
    const trimmedEmail = (email || '').trim().toLowerCase();
    const trimmedHandle = (handle || '').trim();
    const trimmedPass = (password || '').trim();

    if (!trimmedName) {
      setAuthError(bannerId, 'Name Required', 'Please enter your full name.');
      showToast('Please enter your full name.');
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setAuthError(bannerId, 'Invalid Email', 'Please provide a valid university email address.');
      showToast('Please provide a valid email address.');
      return;
    }
    if (!trimmedHandle) {
      setAuthError(bannerId, 'Handle Required', 'Please choose a campus handle (e.g. @alex).');
      showToast('Please choose a campus handle.');
      return;
    }
    if (!trimmedPass || trimmedPass.length < 6) {
      setAuthError(bannerId, 'Password Too Short', 'Password must be at least 6 characters long.');
      showToast('Password must be at least 6 characters long.');
      return;
    }

    if (window.UniVibeSupabase) {
      await window.UniVibeSupabase.init();
    }

    if (!window.UniVibeSupabase || !window.UniVibeSupabase.isConfigured()) {
      setAuthError(bannerId, 'Configuration Error', 'Supabase is not configured yet. Please check your settings.');
      showToast('Supabase is not configured yet. Please check your .env settings.');
      return;
    }

    const supabase = window.UniVibeSupabase.getClient();
    if (!supabase) {
      setAuthError(bannerId, 'Connection Error', 'Could not access Supabase client.');
      showToast('Could not access Supabase client.');
      return;
    }

    const formattedHandle = trimmedHandle.startsWith('@') ? trimmedHandle : ('@' + trimmedHandle);

    const submitBtn = triggerSource === 'startup'
      ? document.querySelector('#form-signup button[type="submit"]')
      : document.querySelector('#form-modal-signup button[type="submit"]');

    const originalBtnText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account...';
    }

    try {
      // 1. Supabase Auth registration
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: trimmedPass,
        options: {
          data: {
            name: trimmedName,
            handle: formattedHandle
          }
        }
      });

      if (error) {
        console.warn('[UniVibe Auth] signUp error:', error);
        let errTitle = 'Sign Up Failed';
        let errMsg = error.message || 'Error signing up.';
        let errHint = '';

        const msgLower = (error.message || '').toLowerCase();
        if (error.status === 429 || msgLower.includes('rate limit')) {
          errTitle = 'Email Rate Limit Reached';
          errMsg = 'Supabase built-in email rate limit exceeded (~3 emails/hr).';
          errHint = 'Turn OFF "Confirm email" in Supabase Dashboard (Authentication → Providers → Email) or run schema_auth_autoconfirm.sql in SQL Editor.';
        } else if (msgLower.includes('already registered') || msgLower.includes('already exists')) {
          errTitle = 'Account Exists';
          errMsg = 'An account with this email already exists.';
          errHint = 'Switch to Log In with this email or reset your password.';
        }

        setAuthError(bannerId, errTitle, errMsg, errHint);
        showToast(errMsg, 5000);
        return;
      }

      // Check for user enumeration protection (empty identities array)
      if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setAuthError(bannerId, 'Account Exists', 'An account with this email already exists.', 'Please switch to Log In with your existing password.');
        showToast('An account with this email already exists. Please log in.');
        return;
      }

      if (!data || !data.user) {
        setAuthError(bannerId, 'Registration Failed', 'Unable to create account. Please try again.');
        showToast('Unable to create account. Please try again.');
        return;
      }

      clearAuthError(bannerId);

      // Case A: Supabase returned a session immediately (email confirmation turned OFF in dashboard)
      if (data.session && data.user) {
        try {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            name: trimmedName,
            handle: formattedHandle,
            email: trimmedEmail,
            updated_at: new Date().toISOString()
          });
        } catch (pErr) {
          console.warn('[UniVibe Auth] Could not write to profiles table:', pErr);
        }

        await loadUserProfile(data.user);

        hideStartupAuth();
        closeGuestAuthModal();

        const signupForm = document.getElementById('form-signup');
        const modalSignupForm = document.getElementById('form-modal-signup');
        if (signupForm) signupForm.reset();
        if (modalSignupForm) modalSignupForm.reset();

        showWelcomeTransition(() => {
          revealHome();
          showToast(`Account created! Welcome to UniVibe, ${trimmedName} ✨`);
        });
        return;
      }

      // Case B: No session returned in signUp response (e.g. project has "Confirm email" active)
      // Attempt immediate signInWithPassword in case the database auto-confirm trigger confirmed the user:
      try {
        const autoLogin = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPass
        });

        if (!autoLogin.error && autoLogin.data && autoLogin.data.user) {
          try {
            await supabase.from('profiles').upsert({
              id: autoLogin.data.user.id,
              name: trimmedName,
              handle: formattedHandle,
              email: trimmedEmail,
              updated_at: new Date().toISOString()
            });
          } catch (pErr) {}

          await loadUserProfile(autoLogin.data.user);
          hideStartupAuth();
          closeGuestAuthModal();

          const signupForm = document.getElementById('form-signup');
          const modalSignupForm = document.getElementById('form-modal-signup');
          if (signupForm) signupForm.reset();
          if (modalSignupForm) modalSignupForm.reset();

          showWelcomeTransition(() => {
            revealHome();
            showToast(`Account created! Welcome to UniVibe, ${trimmedName} ✨`);
          });
          return;
        }
      } catch (loginErr) {
        console.warn('[UniVibe Auth] Auto-login attempt failed:', loginErr);
      }

      // Case C: User is unconfirmed and cannot be logged in yet
      const loginBannerId = triggerSource === 'startup' ? 'login-error-banner' : 'modal-login-error-banner';
      setAuthError(
        loginBannerId,
        'Email Confirmation Required',
        `Account created for ${trimmedEmail}. Supabase requires email confirmation before logging in.`,
        'To allow immediate login: Disable "Confirm email" in Supabase Dashboard (Authentication → Providers → Email) or run schema_auth_autoconfirm.sql.'
      );
      showToast('Account created! Supabase requires confirmation before logging in.', 6000);

      // Pre-fill login identifier and switch to login view
      const loginInput = document.getElementById(triggerSource === 'startup' ? 'login-identifier' : 'modal-login-identifier');
      if (loginInput) loginInput.value = trimmedEmail;
      showAuthView('login');

    } catch (err) {
      console.error('[UniVibe Auth] Signup exception:', err);
      setAuthError(bannerId, 'Unexpected Error', err.message || 'An unexpected error occurred during signup.');
      showToast(err.message || 'An unexpected error occurred during signup.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    }
  }

  /**
   * Real Supabase Log Out
   * Terminates active session and returns smoothly to the startup auth choice screen.
   */
  async function logout() {
    if (authedAutoTimer) {
      clearTimeout(authedAutoTimer);
      authedAutoTimer = null;
    }

    try {
      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.warn('[UniVibe Auth] Sign out error:', e);
    }

    authenticatedUser = null;
    isGuestActive = false;
    updateUserUI();

    showToast('Logged out of UniVibe.');

    // Return smoothly to Startup Auth Screen
    const appShell = document.querySelector('.app-shell');
    if (appShell) {
      appShell.classList.remove('app-shell-visible');
      setTimeout(() => {
        appShell.style.display = 'none';
      }, 350);
    }

    setTimeout(() => {
      showStartupAuth();
    }, 300);
  }

  /**
   * Continue without login (Guest Mode)
   */
  function continueAsGuest() {
    isGuestActive = true;
    authenticatedUser = null;
    updateUserUI();

    hideStartupAuth();
    closeGuestAuthModal();

    showWelcomeTransition(() => {
      revealHome();
      showToast('Browsing UniVibe in Guest mode 🌿');
    });
  }

  let isWelcomeTransitioning = false;

  /**
   * Welcome Transition Animation:
   * Continuous, deliberate, elegant transition:
   * 1. Displays "Welcome."
   * 2. Remains comfortably visible for ~0.85s (0.5–1s window)
   * 3. Smoothly transitions / reveals "Welcome to UniVibe." via subtle fade & slight movement (650ms easing)
   * 4. "Welcome to UniVibe." remains settled and comfortably visible (~0.8s)
   * 5. Smoothly transitions into Home (.app-shell) with banner reveal
   */
  function showWelcomeTransition(callback) {
    const welcomeEl = document.getElementById('welcome-screen');
    if (!welcomeEl) {
      if (callback) callback();
      return;
    }

    if (isWelcomeTransitioning) {
      if (callback) callback();
      return;
    }
    isWelcomeTransitioning = true;

    const morph1 = welcomeEl.querySelector('.welcome-morph-1');
    const morph2 = welcomeEl.querySelector('.welcome-morph-2');

    // 1. Initial State: "Welcome." visible, "Welcome to UniVibe." hidden
    if (morph1) morph1.classList.remove('morph-out');
    if (morph2) morph2.classList.remove('morph-in');

    welcomeEl.classList.remove('welcome-hidden', 'welcome-leaving');
    void welcomeEl.offsetWidth;
    welcomeEl.classList.add('welcome-visible');

    // 2. Keep "Welcome." visible for ~0.85s
    setTimeout(() => {
      // 3. Smooth continuous reveal: morph into "Welcome to UniVibe."
      if (morph1) morph1.classList.add('morph-out');
      if (morph2) morph2.classList.add('morph-in');

      // 4. After "Welcome to UniVibe." appears and settles (~650ms morph + ~800ms settled = 1450ms)
      setTimeout(() => {
        // 5. Smoothly transition into Home
        welcomeEl.classList.add('welcome-leaving');
        if (callback) callback();

        const banner = document.querySelector('.feed-welcome-banner');
        if (banner) {
          banner.classList.remove('banner-reveal');
          void banner.offsetWidth;
          banner.classList.add('banner-reveal');
        }

        setTimeout(() => {
          welcomeEl.classList.remove('welcome-visible', 'welcome-leaving');
          welcomeEl.classList.add('welcome-hidden');
          if (morph1) morph1.classList.remove('morph-out');
          if (morph2) morph2.classList.remove('morph-in');
          isWelcomeTransitioning = false;
        }, 650);
      }, 1450);
    }, 850);
  }

  function revealHome() {
    const appShell = document.querySelector('.app-shell');
    if (appShell) {
      appShell.style.display = 'flex';
      void appShell.offsetWidth;
      appShell.classList.add('app-shell-visible');
    }
    if (window.UniVibeFeed) {
      if (typeof window.UniVibeFeed.fetchPosts === 'function') {
        window.UniVibeFeed.fetchPosts();
      }
      if (typeof window.UniVibeFeed.fetchEvents === 'function') {
        window.UniVibeFeed.fetchEvents();
      }
      if (typeof window.UniVibeFeed.fetchClubs === 'function') {
        window.UniVibeFeed.fetchClubs();
      }
    }
  }

  /**
   * Called by intro.js when opening sequence finishes.
   * - If already authenticated: Checks session silently in background, NO auth card/email flash,
   *   directly triggers Welcome → Home.
   * - If unauthenticated: Shows choice view (Log In, Sign Up, Continue without login).
   */
  async function showStartupAuth() {
    const authScreen = document.getElementById('auth-startup-screen');

    if (authedAutoTimer) {
      clearTimeout(authedAutoTimer);
      authedAutoTimer = null;
    }

    // Ensure session detection has finished silently in background
    if (authInitPromise) {
      await authInitPromise;
    }

    const isAuthed = isAuthenticated();

    if (isAuthed) {
      // Already authenticated:
      // Strictly keep auth screen hidden. No email, status screen, or intermediate UI.
      if (authScreen) {
        authScreen.classList.remove('auth-visible', 'auth-leaving');
        authScreen.classList.add('auth-hidden');
      }

      // Immediately continue: Intro → Welcome. → Welcome transition → Home
      showWelcomeTransition(() => {
        revealHome();
      });
    } else {
      // Logged-out user:
      // Reveal Authentication screen (Log In / Sign Up / Continue without login)
      if (authScreen) {
        showAuthView('choice');
        authScreen.classList.remove('auth-hidden', 'auth-leaving');
        void authScreen.offsetWidth;
        authScreen.classList.add('auth-visible');
      }
    }
  }

  function hideStartupAuth() {
    const authScreen = document.getElementById('auth-startup-screen');
    if (!authScreen) return;
    authScreen.classList.add('auth-leaving');
    setTimeout(() => {
      authScreen.classList.remove('auth-visible', 'auth-leaving');
      authScreen.classList.add('auth-hidden');
    }, 450);
  }

  function showAuthView(viewName) {
    const choiceView = document.getElementById('auth-choice-view');
    const loginView = document.getElementById('auth-login-view');
    const signupView = document.getElementById('auth-signup-view');
    const authedView = document.getElementById('auth-authed-view');

    if (choiceView) choiceView.style.display = viewName === 'choice' ? 'flex' : 'none';
    if (loginView) loginView.style.display = viewName === 'login' ? 'block' : 'none';
    if (signupView) signupView.style.display = viewName === 'signup' ? 'block' : 'none';
    if (authedView) authedView.style.display = viewName === 'authed' ? 'flex' : 'none';
  }

  function setupStartupAuthEvents() {
    const btnChoiceLogin = document.getElementById('btn-choice-login');
    const btnChoiceSignup = document.getElementById('btn-choice-signup');
    const btnChoiceGuest = document.getElementById('btn-choice-guest');

    if (btnChoiceLogin) {
      btnChoiceLogin.addEventListener('click', () => {
        clearAllAuthErrors();
        showAuthView('login');
      });
    }
    if (btnChoiceSignup) {
      btnChoiceSignup.addEventListener('click', () => {
        clearAllAuthErrors();
        showAuthView('signup');
      });
    }
    if (btnChoiceGuest) {
      btnChoiceGuest.addEventListener('click', () => continueAsGuest());
    }

    const btnAuthedSwitch = document.getElementById('btn-authed-switch');
    if (btnAuthedSwitch) {
      btnAuthedSwitch.addEventListener('click', (e) => {
        e.preventDefault();
        if (authedAutoTimer) {
          clearTimeout(authedAutoTimer);
          authedAutoTimer = null;
        }
        clearAllAuthErrors();
        showAuthView('choice');
      });
    }

    const btnLoginBack = document.getElementById('btn-login-back');
    const btnSignupBack = document.getElementById('btn-signup-back');
    if (btnLoginBack) {
      btnLoginBack.addEventListener('click', () => {
        clearAllAuthErrors();
        showAuthView('choice');
      });
    }
    if (btnSignupBack) {
      btnSignupBack.addEventListener('click', () => {
        clearAllAuthErrors();
        showAuthView('choice');
      });
    }

    const linkSwitchSignup = document.getElementById('link-switch-signup');
    const linkSwitchLogin = document.getElementById('link-switch-login');
    const linkLoginGuest = document.getElementById('link-login-guest');
    const linkSignupGuest = document.getElementById('link-signup-guest');

    if (linkSwitchSignup) {
      linkSwitchSignup.addEventListener('click', (e) => {
        e.preventDefault();
        clearAllAuthErrors();
        showAuthView('signup');
      });
    }
    if (linkSwitchLogin) {
      linkSwitchLogin.addEventListener('click', (e) => {
        e.preventDefault();
        clearAllAuthErrors();
        showAuthView('login');
      });
    }
    if (linkLoginGuest) {
      linkLoginGuest.addEventListener('click', (e) => {
        e.preventDefault();
        continueAsGuest();
      });
    }
    if (linkSignupGuest) {
      linkSignupGuest.addEventListener('click', (e) => {
        e.preventDefault();
        continueAsGuest();
      });
    }

    // Clear error banners when user starts typing
    ['login-identifier', 'login-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => clearAuthError('login-error-banner'));
    });

    ['signup-name', 'signup-email', 'signup-handle', 'signup-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => clearAuthError('signup-error-banner'));
    });

    const formLogin = document.getElementById('form-login');
    if (formLogin) {
      formLogin.addEventListener('submit', (e) => {
        e.preventDefault();
        const idInput = document.getElementById('login-identifier');
        const passInput = document.getElementById('login-password');
        login(idInput ? idInput.value : '', passInput ? passInput.value : '', 'startup');
      });
    }

    const formSignup = document.getElementById('form-signup');
    if (formSignup) {
      formSignup.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('signup-name');
        const emailInput = document.getElementById('signup-email');
        const handleInput = document.getElementById('signup-handle');
        const passInput = document.getElementById('signup-password');

        signup(
          nameInput ? nameInput.value : '',
          emailInput ? emailInput.value : '',
          handleInput ? handleInput.value : '',
          passInput ? passInput.value : '',
          'startup'
        );
      });
    }
  }

  function promptSignIn() {
    clearAllAuthErrors();
    openGuestAuthModal('prompt');
    showToast('Sign in to do this.');
  }

  function openGuestAuthModal(initialView = 'prompt') {
    const modal = document.getElementById('guest-auth-modal');
    if (!modal) return;

    clearAllAuthErrors();

    const promptView = document.getElementById('prompt-choice-view');
    const modalLoginView = document.getElementById('prompt-login-view');
    const modalSignupView = document.getElementById('prompt-signup-view');

    if (promptView) promptView.style.display = initialView === 'prompt' ? 'block' : 'none';
    if (modalLoginView) modalLoginView.style.display = initialView === 'login' ? 'block' : 'none';
    if (modalSignupView) modalSignupView.style.display = initialView === 'signup' ? 'block' : 'none';

    modal.style.display = 'flex';
    modal.classList.add('open');
  }

  function closeGuestAuthModal() {
    const modal = document.getElementById('guest-auth-modal');
    if (!modal) return;
    clearAllAuthErrors();
    modal.classList.remove('open');
    modal.style.display = 'none';
  }

  function setupGuestPromptEvents() {
    const modal = document.getElementById('guest-auth-modal');
    if (!modal) return;

    const btnDismiss = document.getElementById('btn-prompt-dismiss');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', closeGuestAuthModal);
    }

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeGuestAuthModal();
      }
    });

    const btnPromptLogin = document.getElementById('btn-prompt-login');
    const btnPromptSignup = document.getElementById('btn-prompt-signup');

    if (btnPromptLogin) {
      btnPromptLogin.addEventListener('click', () => {
        clearAllAuthErrors();
        const promptView = document.getElementById('prompt-choice-view');
        const modalLoginView = document.getElementById('prompt-login-view');
        if (promptView) promptView.style.display = 'none';
        if (modalLoginView) modalLoginView.style.display = 'block';
      });
    }

    if (btnPromptSignup) {
      btnPromptSignup.addEventListener('click', () => {
        clearAllAuthErrors();
        const promptView = document.getElementById('prompt-choice-view');
        const modalSignupView = document.getElementById('prompt-signup-view');
        if (promptView) promptView.style.display = 'none';
        if (modalSignupView) modalSignupView.style.display = 'block';
      });
    }

    const btnModalLoginBack = document.getElementById('btn-modal-login-back');
    const btnModalSignupBack = document.getElementById('btn-modal-signup-back');

    if (btnModalLoginBack) {
      btnModalLoginBack.addEventListener('click', () => {
        clearAllAuthErrors();
        const promptView = document.getElementById('prompt-choice-view');
        const modalLoginView = document.getElementById('prompt-login-view');
        if (promptView) promptView.style.display = 'block';
        if (modalLoginView) modalLoginView.style.display = 'none';
      });
    }

    if (btnModalSignupBack) {
      btnModalSignupBack.addEventListener('click', () => {
        clearAllAuthErrors();
        const promptView = document.getElementById('prompt-choice-view');
        const modalSignupView = document.getElementById('prompt-signup-view');
        if (promptView) promptView.style.display = 'block';
        if (modalSignupView) modalSignupView.style.display = 'none';
      });
    }

    // Clear error banners when typing in modal forms
    ['modal-login-identifier', 'modal-login-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => clearAuthError('modal-login-error-banner'));
    });

    ['modal-signup-name', 'modal-signup-email', 'modal-signup-handle', 'modal-signup-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => clearAuthError('modal-signup-error-banner'));
    });

    const formModalLogin = document.getElementById('form-modal-login');
    if (formModalLogin) {
      formModalLogin.addEventListener('submit', (e) => {
        e.preventDefault();
        const idInput = document.getElementById('modal-login-identifier');
        const passInput = document.getElementById('modal-login-password');
        login(idInput ? idInput.value : '', passInput ? passInput.value : '', 'modal');
      });
    }

    const formModalSignup = document.getElementById('form-modal-signup');
    if (formModalSignup) {
      formModalSignup.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('modal-signup-name');
        const emailInput = document.getElementById('modal-signup-email');
        const handleInput = document.getElementById('modal-signup-handle');
        const passInput = document.getElementById('modal-signup-password');

        signup(
          nameInput ? nameInput.value : '',
          emailInput ? emailInput.value : '',
          handleInput ? handleInput.value : '',
          passInput ? passInput.value : '',
          'modal'
        );
      });
    }
  }

  function setupGlobalInterceptors() {
    document.addEventListener('click', (e) => {
      const logoutBtn = e.target.closest('[data-action="logout-action"]');
      if (logoutBtn) {
        e.preventDefault();
        logout();
        return;
      }

      const authBtn = e.target.closest('[data-action="auth-action"]');
      if (authBtn) {
        e.preventDefault();
        if (isAuthenticated()) {
          logout();
        } else {
          promptSignIn();
        }
        return;
      }

      // Intercept any restricted actions for guests
      const restrictedCreate = e.target.closest('[data-action="open-create"]');
      if (restrictedCreate && isGuest()) {
        e.preventDefault();
        e.stopPropagation();
        promptSignIn();
      }
    }, true);
  }

  function updateUserUI() {
    const user = getCurrentUser();
    const isAuthed = isAuthenticated();

    // Sidebar user card
    const nameEl = document.getElementById('sidebar-user-name');
    const handleEl = document.getElementById('sidebar-user-handle');
    const avatarEl = document.getElementById('sidebar-user-avatar');
    const authBtnLabel = document.getElementById('label-sidebar-auth');
    const authBtn = document.getElementById('btn-sidebar-auth');

    if (nameEl) nameEl.textContent = user.name;
    if (handleEl) handleEl.textContent = (user.handle || '').replace(/^@/, '');
    if (avatarEl) {
      if (user.avatarUrl) {
        avatarEl.classList.add('has-avatar-img');
        avatarEl.innerHTML = `<img src="${user.avatarUrl}" alt="${user.name}" class="avatar-photo-img" onerror="this.onerror=null; this.parentElement.classList.remove('has-avatar-img'); this.parentElement.textContent='${getInitials(user.name)}';">`;
      } else {
        avatarEl.classList.remove('has-avatar-img');
        avatarEl.textContent = getInitials(user.name);
      }
    }

    const mobileAuthBtn = document.getElementById('btn-mobile-auth');

    if (authBtn) {
      if (isAuthed) {
        authBtn.style.display = 'inline-flex';
        authBtn.title = 'Sign out of UniVibe';
        if (authBtnLabel) authBtnLabel.textContent = 'Log Out';
      } else {
        authBtn.style.display = 'none';
      }
    }

    if (mobileAuthBtn) {
      mobileAuthBtn.style.display = isAuthed ? 'inline-flex' : 'none';
    }

    // Modal / Composer avatar & author name
    const composerAvatar = document.querySelector('.composer-user-avatar');
    if (composerAvatar) {
      if (user.avatarUrl) {
        composerAvatar.classList.add('has-avatar-img');
        composerAvatar.innerHTML = `<img src="${user.avatarUrl}" alt="${user.name}" class="avatar-photo-img" onerror="this.onerror=null; this.parentElement.classList.remove('has-avatar-img'); this.parentElement.textContent='${getInitials(user.name)}';">`;
      } else {
        composerAvatar.classList.remove('has-avatar-img');
        composerAvatar.textContent = getInitials(user.name);
      }
    }
    const composerName = document.getElementById('composer-author-name');
    if (composerName) {
      composerName.textContent = user.name;
    }
  }

  function showToast(message) {
    if (window.UniVibeToast && typeof window.UniVibeToast.show === 'function') {
      window.UniVibeToast.show(message);
    } else {
      console.log(`[UniVibe Toast] ${message}`);
    }
  }

  return {
    init,
    isAuthenticated,
    isGuest,
    getCurrentUser,
    getInitials,
    login,
    signup,
    continueAsGuest,
    logout,
    showStartupAuth,
    showWelcomeTransition,
    promptSignIn,
    updateUserUI,
    updateProfile,
    loadUserProfile,
    setAuthenticatedUser: (user) => { authenticatedUser = user; updateUserUI(); }
  };
})();

// Explicitly bind to window for global access across scripts
window.UniVibeAuth = UniVibeAuth;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', UniVibeAuth.init);
} else {
  UniVibeAuth.init();
}
