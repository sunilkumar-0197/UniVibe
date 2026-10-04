/**
 * UniVibe Feed Controller
 * Fetches and displays real posts and events from Supabase in reverse chronological order.
 * Manages Home feed, Events page view, and upcoming events widget.
 */

const UniVibeFeed = (() => {
  let posts = [];
  let events = [];
  let clubs = [];
  let isLoading = false;
  let isClubsLoading = false;
  let fetchError = null;
  let activeFilter = 'all';
  let activeClubId = null;
  let activePostId = null;
  let activeEventId = null;
  let activeComments = [];
  let isCommentsLoading = false;
  let activeEventComments = [];
  let isEventCommentsLoading = false;
  let eventInterestsMap = {};
  let stagedAvatarFile = null;
  let stagedAvatarRemoved = false;
  let clubMembersMap = {};
  let isClubMembersLoadingMap = {};
  let editStagedLogoFile = null;
  let editStagedLogoRemoved = false;
  let editStagedLogoDataUrl = null;

  function getInitials(name) {
    if (!name) return 'UV';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatTimeAgo(dateString) {
    if (!dateString) return 'Just now';
    const now = new Date();
    const past = new Date(dateString);
    const diffMs = now - past;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return past.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatEventDateTime(dateStr, timeStr) {
    try {
      if (!dateStr) return 'Upcoming Date';
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dateFormatted = `${dayNames[d.getDay()]}, ${monthNames[d.getMonth()]} ${d.getDate()}`;

      if (!timeStr) return dateFormatted;

      const [hoursStr, minsStr] = timeStr.split(':');
      let hours = parseInt(hoursStr, 10);
      const mins = minsStr || '00';
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const timeFormatted = `${hours}:${mins} ${ampm}`;

      return `${dateFormatted} · ${timeFormatted}`;
    } catch (e) {
      return `${dateStr} ${timeStr || ''}`.trim();
    }
  }

  function formatEventDateShort(dateStr) {
    try {
      if (!dateStr) return { month: 'EVT', day: '--' };
      const [year, month, day] = dateStr.split('-').map(Number);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return {
        month: monthNames[month - 1] || 'EVT',
        day: String(day)
      };
    } catch (e) {
      return { month: 'EVT', day: '--' };
    }
  }

  function formatEventDateDetail(dateStr) {
    try {
      if (!dateStr) return 'Date TBA';
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return `${dayNames[d.getDay()]}, ${monthNames[d.getMonth()]} ${d.getDate()}, ${year}`;
    } catch (e) {
      return dateStr || 'Date TBA';
    }
  }

  function formatEventTimeDetail(timeStr) {
    try {
      if (!timeStr) return 'Time TBA';
      const [hoursStr, minsStr] = timeStr.split(':');
      let hours = parseInt(hoursStr, 10);
      const mins = minsStr || '00';
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${hours}:${mins} ${ampm}`;
    } catch (e) {
      return timeStr || 'Time TBA';
    }
  }

  function linkifyText(rawText) {
    if (!rawText) return '';
    const escaped = escapeHtml(rawText);
    const urlPattern = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
    return escaped.replace(urlPattern, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="content-link event-text-link">${url}</a>`;
    });
  }

  function renderAvatarHtml(name, avatarUrl, extraClass = '', extraStyle = '') {
    const initials = getInitials(name);
    if (avatarUrl) {
      return `<div class="author-avatar avatar-badge has-avatar-img ${extraClass}" style="${extraStyle}" aria-label="${escapeHtml(name)}">
        <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" class="avatar-photo-img" onerror="this.onerror=null; this.parentElement.classList.remove('has-avatar-img'); this.parentElement.textContent='${escapeHtml(initials)}';">
      </div>`;
    }
    return `<div class="author-avatar avatar-badge ${extraClass}" style="${extraStyle}" aria-label="${escapeHtml(name)}">${initials}</div>`;
  }

  function renderClubAvatarHtml(club, size = 48, fontRem = 1.1, extraClass = '') {
    const initials = getInitials(club ? club.name : '');
    const safeName = club ? escapeHtml(club.name) : 'Club';
    if (club && club.logoUrl) {
      return `<div class="author-avatar avatar-badge has-avatar-img ${extraClass}" style="width: ${size}px; height: ${size}px; flex-shrink: 0; border-radius: var(--radius-md); overflow: hidden;" aria-label="${safeName}">
        <img src="${escapeHtml(club.logoUrl)}" alt="${safeName}" class="avatar-photo-img" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;" onerror="this.onerror=null; this.parentElement.classList.remove('has-avatar-img'); this.parentElement.textContent='${escapeHtml(initials)}';">
      </div>`;
    }
    return `<div class="author-avatar avatar-badge ${extraClass}" style="width: ${size}px; height: ${size}px; font-size: ${fontRem}rem; font-weight: 750; background-color: var(--accent-soft); color: var(--accent-primary); border-radius: var(--radius-md); flex-shrink: 0;" aria-label="${safeName}">${initials}</div>`;
  }

  function renderMediaGridHtml(images) {
    if (!images || !Array.isArray(images) || images.length === 0) return '';
    const validImages = images.filter(Boolean);
    const count = validImages.length;
    if (count === 0) return '';
    const displayCount = Math.min(count, 4);
    const displayImages = validImages.slice(0, displayCount);

    return `
      <div class="post-media-grid media-${displayCount}">
        ${displayImages.map((src, idx) => `
          <div class="post-media-item" data-action="open-lightbox" data-img-src="${escapeHtml(src)}" data-index="${idx}">
            <img src="${escapeHtml(src)}" alt="Photo ${idx + 1}" loading="lazy" class="post-media-img" />
          </div>
        `).join('')}
      </div>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function init() {
    try {
      localStorage.removeItem('univibe_user_posts');
      localStorage.removeItem('univibe_user_events');
    } catch (e) {}

    try {
      const hash = window.location.hash;
      if (hash.startsWith('#post/')) {
        activePostId = hash.replace('#post/', '');
        activeFilter = 'post-detail';
      } else if (hash.startsWith('#event/')) {
        activeEventId = hash.replace('#event/', '');
        activeFilter = 'event-detail';
      } else if (hash.startsWith('#club/')) {
        activeClubId = hash.replace('#club/', '');
        activeFilter = 'club-community';
      } else if (hash.startsWith('#club-')) {
        activeClubId = hash.replace('#club-', '');
        activeFilter = 'club-community';
      } else if (hash === '#events') {
        activeFilter = 'event';
      } else if (hash === '#clubs') {
        activeFilter = 'clubs';
      } else if (hash === '#profile') {
        activeFilter = 'profile';
      }
      const urlFilter = (new URLSearchParams(window.location.search)).get('filter');
      if (urlFilter) activeFilter = urlFilter;
    } catch (e) {}

    window.addEventListener('hashchange', () => {
      const hash = window.location.hash;
      if (hash.startsWith('#post/')) {
        const pId = hash.replace('#post/', '');
        navigateToPost(pId, false);
      } else if (hash.startsWith('#event/')) {
        const eId = hash.replace('#event/', '');
        navigateToEvent(eId, false);
      } else if (hash.startsWith('#club/')) {
        const cId = hash.replace('#club/', '');
        navigateToClub(cId, false);
      } else if (hash.startsWith('#club-')) {
        const cId = hash.replace('#club-', '');
        navigateToClub(cId, false);
      } else if (hash === '#clubs') {
        setFilter('clubs');
      } else if (hash === '#events') {
        setFilter('event');
      } else if (hash === '#profile') {
        setFilter('profile');
      } else if (hash === '#home' || !hash) {
        setFilter('all');
      }
    });

    attachFeedEvents();
    attachFilterEvents();
    setupEditProfileAvatar();

    try {
      if (window.UniVibeSupabase) {
        await window.UniVibeSupabase.init();
        const supabase = window.UniVibeSupabase.getClient();
        if (supabase && supabase.auth) {
          supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
              await Promise.all([fetchPosts(), fetchEvents(), fetchClubs()]);
              if (activeEventId) {
                fetchCommentsForEvent(activeEventId);
              }
            }
          });
        }
      }
    } catch (authHookErr) {
      console.warn('[UniVibe Feed] Notice attaching auth listener:', authHookErr);
    }

    await Promise.all([fetchPosts(), fetchEvents(), fetchClubs()]);
    if (activePostId) {
      fetchCommentsForPost(activePostId);
    }
    if (activeEventId) {
      fetchCommentsForEvent(activeEventId);
    }
  }

  async function fetchPosts() {
    isLoading = true;
    fetchError = null;
    renderFeed();

    try {
      if (window.UniVibeSupabase) {
        await window.UniVibeSupabase.init();
      }

      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (!supabase) {
        posts = [];
        isLoading = false;
        renderFeed();
        return;
      }

      // Query real posts from Supabase ordered newest first
      const { data: postsData, error: postsErr } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false });

      if (postsErr) {
        console.warn('[UniVibe Feed] Error fetching posts from Supabase:', postsErr);
        fetchError = postsErr;
        posts = [];
        isLoading = false;
        renderFeed();
        return;
      }

      if (!postsData || postsData.length === 0) {
        posts = [];
        isLoading = false;
        renderFeed();
        return;
      }

      // Fetch corresponding user profiles for author display
      const userIds = [...new Set(postsData.map(p => p.user_id).filter(Boolean))];
      let profilesMap = {};

      if (userIds.length > 0) {
        try {
          const res = await supabase
            .from('profiles')
            .select('id, name, handle, email, avatar_url')
            .in('id', userIds);
          let profilesData = res.data;
          if (res.error && res.error.message && res.error.message.includes('avatar_url')) {
            const fallbackRes = await supabase
              .from('profiles')
              .select('id, name, handle, email')
              .in('id', userIds);
            profilesData = fallbackRes.data;
          }
          if (profilesData) {
            profilesData.forEach(p => {
              profilesMap[p.id] = p;
            });
          }
        } catch (profErr) {
          console.warn('[UniVibe Feed] Error fetching author profiles:', profErr);
        }
      }

      // Query comment counts for all posts
      let commentCounts = {};
      try {
        const { data: commentsMeta, error: commErr } = await supabase
          .from('comments')
          .select('id, post_id');
        if (!commErr && commentsMeta) {
          commentsMeta.forEach(c => {
            if (c.post_id) {
              commentCounts[c.post_id] = (commentCounts[c.post_id] || 0) + 1;
            }
          });
        }
      } catch (cErr) {
        console.warn('[UniVibe Feed] Notice reading comments count:', cErr);
      }

      // Query relational media from post_images table
      let postImagesMap = {};
      try {
        const { data: piData, error: piErr } = await supabase
          .from('post_images')
          .select('post_id, url, display_order')
          .order('display_order', { ascending: true });
        if (!piErr && Array.isArray(piData)) {
          piData.forEach(row => {
            if (row.post_id && row.url) {
              if (!postImagesMap[row.post_id]) {
                postImagesMap[row.post_id] = [];
              }
              postImagesMap[row.post_id].push(row.url);
            }
          });
        }
      } catch (piErr) {
        console.warn('[UniVibe Feed] Notice querying post_images table:', piErr);
      }

      const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;

      posts = postsData.map(p => {
        const prof = profilesMap[p.user_id];
        let authorName = '';
        let authorHandle = '';

        if (prof && prof.name) {
          authorName = prof.name;
          authorHandle = prof.handle ? prof.handle.replace(/^@/, '') : prof.name.toLowerCase().replace(/\s+/g, '');
        } else if (currentUser && currentUser.id === p.user_id) {
          authorName = currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Campus Member');
          authorHandle = currentUser.handle ? currentUser.handle.replace(/^@/, '') : (currentUser.email ? currentUser.email.split('@')[0].toLowerCase() : `user_${p.user_id.slice(0, 6)}`);
        } else {
          authorName = 'Campus Member';
          authorHandle = `user_${p.user_id ? p.user_id.slice(0, 6) : 'anon'}`;
        }

        let postTags = [];
        if (Array.isArray(p.tags)) {
          postTags = p.tags;
        } else if (typeof p.tags === 'string' && p.tags.trim()) {
          postTags = p.tags.split(/\s+/).filter(Boolean).map(t => t.startsWith('#') ? t : `#${t}`);
        }

        const authorAvatar = (prof && prof.avatar_url) || (currentUser && currentUser.id === p.user_id ? currentUser.avatarUrl : null) || null;
        
        const existingImages = (Array.isArray(p.images) && p.images.length > 0) ? p.images.filter(Boolean) : [];
        const relationalImages = postImagesMap[p.id] || [];
        const localImages = (window.UniVibeLocalMedia && window.UniVibeLocalMedia[p.id]) ? window.UniVibeLocalMedia[p.id] : [];

        // Priority: posts.images -> post_images -> in-memory fallback
        let postImages = [];
        if (existingImages.length > 0) {
          postImages = existingImages;
        } else if (relationalImages.length > 0) {
          postImages = relationalImages;
          // Self-heal only the affected post's images column when empty and persisted post_images exist
          try {
            supabase
              .from('posts')
              .update({ images: relationalImages })
              .eq('id', p.id)
              .then(({ error: healErr }) => {
                if (!healErr) {
                  p.images = relationalImages;
                }
              });
          } catch (healEx) {}
        } else if (localImages.length > 0) {
          postImages = localImages;
        }

        return {
          id: p.id,
          userId: p.user_id,
          type: 'post',
          title: p.title || null,
          content: p.content,
          tags: postTags,
          images: postImages,
          clubId: p.club_id || null,
          createdAt: p.created_at,
          timeAgo: formatTimeAgo(p.created_at),
          commentCount: commentCounts[p.id] || 0,
          author: {
            name: authorName,
            handle: authorHandle,
            avatarUrl: authorAvatar
          }
        };
      });
    } catch (err) {
      console.error('[UniVibe Feed] Exception fetching posts:', err);
      fetchError = err;
      posts = [];
    } finally {
      isLoading = false;
      renderFeed();
    }
  }

  async function fetchEvents() {
    try {
      if (window.UniVibeSupabase) {
        await window.UniVibeSupabase.init();
      }

      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (!supabase) {
        events = [];
        updateSidebarEventsWidget();
        return;
      }

      // Query real events from Supabase ordered upcoming first (date, then time)
      const { data: eventsData, error: eventsErr } = await supabase
        .from('events')
        .select('*')
        .order('event_date', { ascending: true })
        .order('event_time', { ascending: true });

      if (eventsErr) {
        console.warn('[UniVibe Feed] Error fetching events from Supabase:', eventsErr);
        events = [];
        updateSidebarEventsWidget();
        renderFeed();
        return;
      }

      // Fetch user's event interests if authenticated
      const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
      if (currentUser && currentUser.id) {
        try {
          const { data: interestsData, error: intErr } = await supabase
            .from('event_interests')
            .select('event_id, status')
            .eq('user_id', currentUser.id);

          if (!intErr && Array.isArray(interestsData)) {
            eventInterestsMap = {};
            interestsData.forEach(row => {
              eventInterestsMap[row.event_id] = row.status;
            });
          }
        } catch (intErr) {
          console.warn('[UniVibe Feed] Notice loading event interests:', intErr);
        }
      } else {
        eventInterestsMap = {};
      }

      if (!eventsData || eventsData.length === 0) {
        events = [];
        updateSidebarEventsWidget();
        renderFeed();
        return;
      }

      const userIds = [...new Set(eventsData.map(e => e.user_id).filter(Boolean))];
      let profilesMap = {};

      if (userIds.length > 0) {
        try {
          const res = await supabase
            .from('profiles')
            .select('id, name, handle, email, avatar_url')
            .in('id', userIds);
          let profilesData = res.data;
          if (res.error && res.error.message && res.error.message.includes('avatar_url')) {
            const fallbackRes = await supabase
              .from('profiles')
              .select('id, name, handle, email')
              .in('id', userIds);
            profilesData = fallbackRes.data;
          }
          if (profilesData) {
            profilesData.forEach(p => {
              profilesMap[p.id] = p;
            });
          }
        } catch (profErr) {
          console.warn('[UniVibe Feed] Error fetching event creator profiles:', profErr);
        }
      }

      // Query comment counts for all events
      let eventCommentCounts = {};
      try {
        const { data: commentsMeta, error: commErr } = await supabase
          .from('event_comments')
          .select('id, event_id');
        if (!commErr && commentsMeta) {
          commentsMeta.forEach(c => {
            if (c.event_id) {
              eventCommentCounts[c.event_id] = (eventCommentCounts[c.event_id] || 0) + 1;
            }
          });
        }
      } catch (cErr) {
        // Table may not exist yet in SQL Editor
      }

      // Query relational media from post_images table for events
      let eventImagesMap = {};
      try {
        const { data: eiData, error: eiErr } = await supabase
          .from('post_images')
          .select('event_id, url, display_order')
          .order('display_order', { ascending: true });
        if (!eiErr && Array.isArray(eiData)) {
          eiData.forEach(row => {
            if (row.event_id && row.url) {
              if (!eventImagesMap[row.event_id]) {
                eventImagesMap[row.event_id] = [];
              }
              eventImagesMap[row.event_id].push(row.url);
            }
          });
        }
      } catch (eiErr) {
        console.warn('[UniVibe Feed] Notice querying post_images for events:', eiErr);
      }

      events = eventsData.map(ev => {
        const prof = profilesMap[ev.user_id];
        let creatorName = '';
        let creatorHandle = '';

        if (prof && (prof.display_name || prof.name)) {
          creatorName = prof.display_name || prof.name;
          creatorHandle = prof.handle ? prof.handle.replace(/^@/, '') : creatorName.toLowerCase().replace(/\s+/g, '');
        } else if (currentUser && currentUser.id === ev.user_id) {
          creatorName = currentUser.display_name || currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Campus Member');
          creatorHandle = currentUser.handle ? currentUser.handle.replace(/^@/, '') : (currentUser.email ? currentUser.email.split('@')[0].toLowerCase() : `user_${ev.user_id.slice(0, 6)}`);
        } else {
          creatorName = 'Campus Member';
          creatorHandle = `user_${ev.user_id ? ev.user_id.slice(0, 6) : 'anon'}`;
        }

        const creatorAvatar = (prof && prof.avatar_url) || (currentUser && currentUser.id === ev.user_id ? currentUser.avatarUrl : null) || null;
        
        const existingEventImages = (Array.isArray(ev.images) && ev.images.length > 0) ? ev.images.filter(Boolean) : [];
        const relationalEventImages = eventImagesMap[ev.id] || [];
        const localEventImages = (window.UniVibeLocalMedia && window.UniVibeLocalMedia[ev.id]) ? window.UniVibeLocalMedia[ev.id] : [];

        // Priority: events.images -> post_images -> in-memory fallback
        let eventImages = [];
        if (existingEventImages.length > 0) {
          eventImages = existingEventImages;
        } else if (relationalEventImages.length > 0) {
          eventImages = relationalEventImages;
          // Self-heal only the affected event's images column when empty and persisted post_images exist
          try {
            supabase
              .from('events')
              .update({ images: relationalEventImages })
              .eq('id', ev.id)
              .then(({ error: healErr }) => {
                if (!healErr) {
                  ev.images = relationalEventImages;
                }
              });
          } catch (healEx) {}
        } else if (localEventImages.length > 0) {
          eventImages = localEventImages;
        }

        return {
          id: ev.id,
          userId: ev.user_id,
          type: 'event',
          title: ev.title,
          description: ev.description,
          eventDate: ev.event_date,
          eventTime: ev.event_time,
          location: ev.location,
          images: eventImages,
          createdAt: ev.created_at,
          timeAgo: formatTimeAgo(ev.created_at),
          commentCount: eventCommentCounts[ev.id] || 0,
          creator: {
            name: creatorName,
            displayName: creatorName,
            handle: creatorHandle,
            avatarUrl: creatorAvatar
          }
        };
      });

      updateSidebarEventsWidget();
      renderFeed();
    } catch (err) {
      console.error('[UniVibe Feed] Exception fetching events:', err);
      events = [];
    }
  }

  function updateSidebarEventsWidget() {
    const widgetList = document.getElementById('widget-event-list');
    if (!widgetList) return;

    // Personalized: Show events the current user has marked 'interested'
    const interestedEvents = events.filter(ev => eventInterestsMap[ev.id] === 'interested');

    if (interestedEvents.length === 0) {
      widgetList.innerHTML = `
        <li class="widget-empty-sub">
          No interested events yet.<br>
          <span style="font-size: 0.75rem; opacity: 0.85;">Explore Events to mark what you'd like to attend.</span>
        </li>
      `;
      return;
    }

    widgetList.innerHTML = interestedEvents.slice(0, 4).map(ev => {
      const dateParts = formatEventDateShort(ev.eventDate);
      return `
        <li class="widget-event-item">
          <div class="event-date-badge">
            <span class="event-month">${escapeHtml(dateParts.month)}</span>
            <span class="event-day">${escapeHtml(dateParts.day)}</span>
          </div>
          <div class="event-widget-info">
            <h4 class="event-widget-title">${escapeHtml(ev.title)}</h4>
            <span class="event-widget-sub">${escapeHtml(ev.location)}</span>
          </div>
        </li>
      `;
    }).join('');
  }

  async function toggleEventInterest(eventId, targetStatus) {
    if (!eventId || !targetStatus) return;

    // Guests must be prompted to sign in
    if (!window.UniVibeAuth || window.UniVibeAuth.isGuest()) {
      if (window.UniVibeAuth && typeof window.UniVibeAuth.promptSignIn === 'function') {
        window.UniVibeAuth.promptSignIn();
      }
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth && typeof window.UniVibeAuth.promptSignIn === 'function') {
        window.UniVibeAuth.promptSignIn();
      }
      return;
    }

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    const currentStatus = eventInterestsMap[eventId];

    if (currentStatus === targetStatus) {
      // Toggle off / Return to neutral state
      delete eventInterestsMap[eventId];
      updateSidebarEventsWidget();
      renderFeed();

      try {
        const { error } = await supabase
          .from('event_interests')
          .delete()
          .eq('event_id', eventId)
          .eq('user_id', currentUser.id);

        if (error) {
          console.warn('[UniVibe Feed] Error removing event interest in Supabase:', error);
        }
      } catch (err) {
        console.error('[UniVibe Feed] Exception removing event interest:', err);
      }
    } else {
      // Set to new preference ('interested' or 'not_interested')
      eventInterestsMap[eventId] = targetStatus;
      updateSidebarEventsWidget();
      renderFeed();

      try {
        const { error } = await supabase
          .from('event_interests')
          .upsert({
            event_id: eventId,
            user_id: currentUser.id,
            status: targetStatus,
            updated_at: new Date().toISOString()
          }, { onConflict: 'event_id,user_id' });

        if (error) {
          console.warn('[UniVibe Feed] Error saving event interest in Supabase:', error);
        }
      } catch (err) {
        console.error('[UniVibe Feed] Exception saving event interest:', err);
      }
    }
  }

  async function fetchClubs() {
    isClubsLoading = true;
    try {
      if (window.UniVibeSupabase) {
        await window.UniVibeSupabase.init();
      }

      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (!supabase) {
        clubs = [];
        updateSidebarClubsWidget();
        return;
      }

      const { data: clubsData, error: clubsErr } = await supabase
        .from('clubs')
        .select('*')
        .order('created_at', { ascending: false });

      if (clubsErr) {
        console.warn('[UniVibe Feed] Error fetching clubs from Supabase:', clubsErr);
        clubs = [];
        updateSidebarClubsWidget();
        renderFeed();
        return;
      }

      if (!clubsData || clubsData.length === 0) {
        clubs = [];
        updateSidebarClubsWidget();
        updatePostClubSelect();
        renderFeed();
        return;
      }

      // Query memberships from public.club_members
      let membersData = [];
      try {
        const { data: mData, error: mErr } = await supabase
          .from('club_members')
          .select('*');
        if (!mErr && mData) {
          membersData = mData;
        }
      } catch (mErr) {
        console.warn('[UniVibe Feed] Notice reading club_members:', mErr);
      }

      const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
      const currentUserId = currentUser ? currentUser.id : null;

      clubs = clubsData.map(c => {
        const clubMemberList = membersData.filter(m => m.club_id === c.id);
        const isJoined = currentUserId ? clubMemberList.some(m => m.user_id === currentUserId) : false;
        const memberLimit = (c.member_limit !== null && c.member_limit !== undefined) ? Number(c.member_limit) : null;
        const isFull = memberLimit ? (clubMemberList.length >= memberLimit) : false;
        const localClubLogo = (window.UniVibeLocalMedia && (window.UniVibeLocalMedia['club_' + c.id] || window.UniVibeLocalMedia[c.id])) || null;
        const resolvedLogoUrl = (c.logo_url && typeof c.logo_url === 'string' && c.logo_url.trim()) ? c.logo_url.trim() : localClubLogo;
        return {
          id: c.id,
          name: c.name,
          description: c.description,
          createdBy: c.created_by,
          createdAt: c.created_at,
          timeAgo: formatTimeAgo(c.created_at),
          memberCount: clubMemberList.length,
          memberLimit: memberLimit,
          isFull: isFull,
          isJoined: isJoined,
          logoUrl: resolvedLogoUrl || null
        };
      });

      updateSidebarClubsWidget();
      updatePostClubSelect();
      renderFeed();
    } catch (err) {
      console.error('[UniVibe Feed] Exception fetching clubs:', err);
      clubs = [];
    } finally {
      isClubsLoading = false;
    }
  }

  function updateSidebarClubsWidget() {
    const widgetList = document.getElementById('widget-club-list');
    if (!widgetList) return;

    if (clubs.length === 0) {
      widgetList.innerHTML = `<li class="widget-empty-sub">No active clubs yet.</li>`;
      return;
    }

    widgetList.innerHTML = clubs.slice(0, 4).map(club => {
      const avatarHtml = renderClubAvatarHtml(club, 30, 0.8, 'club-avatar');
      const membersLabel = club.memberLimit ? `${club.memberCount}/${club.memberLimit} members` : `${club.memberCount} ${club.memberCount === 1 ? 'member' : 'members'}`;
      let joinBtnHtml = '';
      if (club.isJoined) {
        joinBtnHtml = `<button class="club-join-btn joined" data-action="toggle-club-join" data-club-id="${escapeHtml(club.id)}">Joined</button>`;
      } else if (club.isFull) {
        joinBtnHtml = `<button class="club-join-btn full" disabled title="Club is full">Full</button>`;
      } else {
        joinBtnHtml = `<button class="club-join-btn" data-action="toggle-club-join" data-club-id="${escapeHtml(club.id)}">Join</button>`;
      }

      return `
        <li class="widget-club-item" style="padding: 4px 0; border-bottom: 1px solid var(--border-subtle);">
          <div class="club-item-left" style="cursor: pointer;" data-action="open-club-community" data-club-id="${escapeHtml(club.id)}">
            ${avatarHtml}
            <div style="min-width: 0;">
              <h4 class="club-name" title="${escapeHtml(club.name)}">${escapeHtml(club.name)}</h4>
              <span class="club-members">${membersLabel}</span>
            </div>
          </div>
          ${joinBtnHtml}
        </li>
      `;
    }).join('');
  }

  function updatePostClubSelect() {
    const select = document.getElementById('post-club-select');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = `<option value="general">🌍 General Campus</option>` +
      clubs.map(c => `<option value="${escapeHtml(c.id)}">👥 ${escapeHtml(c.name)}</option>`).join('');
    if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
      select.value = currentVal;
    }
  }

  function renderClubCard(club) {
    const avatarHtml = renderClubAvatarHtml(club, 48, 1.1);
    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    const isClubOwner = currentUser && currentUser.id && club.createdBy === currentUser.id;
    const membersLabel = club.memberLimit ? `${club.memberCount} / ${club.memberLimit} members` : `${club.memberCount} ${club.memberCount === 1 ? 'member' : 'members'}`;
    const isFull = Boolean(club.isFull);

    return `
      <article class="post-card club-card" id="club-${escapeHtml(club.id)}" data-club-id="${escapeHtml(club.id)}" style="cursor: pointer;" data-action="open-club-community">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md);">
          <div style="display: flex; align-items: center; gap: var(--space-md); cursor: pointer;" data-action="open-club-community" data-club-id="${escapeHtml(club.id)}">
            ${avatarHtml}
            <div>
              <h3 class="club-title-main" style="font-family: var(--font-display); font-size: 1.25rem; font-weight: 750; color: var(--text-primary); margin: 0;">
                ${escapeHtml(club.name)}
              </h3>
              <span class="club-meta" style="font-size: 0.8rem; color: var(--text-secondary);">
                ${membersLabel} ${isFull && !club.isJoined ? '<span style="color: var(--danger-primary, #ef4444); font-weight: 700; margin-left: 4px;">· Club Full</span>' : ''} · Created ${escapeHtml(club.timeAgo)}
              </span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${club.isJoined ? `
              <button class="club-join-btn joined" data-action="toggle-club-join" data-club-id="${escapeHtml(club.id)}">
                Joined ✓
              </button>
            ` : isFull ? `
              <button class="club-join-btn full" disabled title="This club has reached its member limit">
                Club Full
              </button>
            ` : `
              <button class="club-join-btn" data-action="toggle-club-join" data-club-id="${escapeHtml(club.id)}">
                Join Club
              </button>
            `}
            ${isClubOwner ? `
              <button class="btn-secondary" data-action="open-club-edit" data-club-id="${escapeHtml(club.id)}" style="padding: 5px 10px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;" title="Edit Club Settings">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Edit</span>
              </button>
              <button class="card-delete-btn club-card-delete-btn" data-action="delete-club" data-club-id="${escapeHtml(club.id)}" title="Delete club" aria-label="Delete club">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete</span>
              </button>
            ` : ''}
          </div>
        </div>

        <p class="post-caption" style="margin-top: var(--space-sm); cursor: pointer;" data-action="open-club-community" data-club-id="${escapeHtml(club.id)}">
          ${escapeHtml(club.description)}
        </p>
      </article>
    `;
  }

  async function toggleClubJoin(clubId) {
    if (!window.UniVibeAuth || window.UniVibeAuth.isGuest()) {
      if (window.UniVibeAuth) {
        window.UniVibeAuth.promptSignIn();
      }
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth) {
        window.UniVibeAuth.promptSignIn();
      }
      return;
    }

    const club = clubs.find(c => c.id === clubId);
    if (!club) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    const willJoin = !club.isJoined;

    // Check member limit client-side before attempting join
    if (willJoin && club.memberLimit && club.memberCount >= club.memberLimit) {
      if (window.UniVibeToast) {
        window.UniVibeToast.show('Cannot join: This club has reached its maximum member limit.');
      }
      return;
    }

    try {
      if (willJoin) {
        const { error } = await supabase
          .from('club_members')
          .insert([{ club_id: clubId, user_id: currentUser.id }]);
        if (error) {
          if (error.message && (error.message.includes('full') || error.message.includes('limit') || error.code === '23514')) {
            if (window.UniVibeToast) window.UniVibeToast.show('Cannot join: This club has reached its member limit.');
            await fetchClubs();
            return;
          }
          throw error;
        }
        if (window.UniVibeToast) window.UniVibeToast.show(`Joined ${club.name}! 🎉`);
      } else {
        const { error } = await supabase
          .from('club_members')
          .delete()
          .eq('club_id', clubId)
          .eq('user_id', currentUser.id);
        if (error) throw error;
        if (window.UniVibeToast) window.UniVibeToast.show(`Left ${club.name}.`);
      }

      delete clubMembersMap[clubId];
      await fetchClubs();

      // If viewing the community page for this club, immediately update UI and members
      if (activeFilter === 'club-community' && activeClubId === clubId) {
        await fetchClubMembers(clubId);
        renderFeed();
      }

      const modal = document.getElementById('club-detail-modal');
      if (modal && modal.style.display !== 'none' && modal.dataset.currentClubId === clubId) {
        openClubDetail(clubId);
      }
    } catch (err) {
      console.error('[UniVibe Feed] Error toggling club membership:', err);
      if (window.UniVibeToast) {
        window.UniVibeToast.show(err.message || 'Failed to update club membership.');
      }
    }
  }

  function navigateToClub(clubId, updateHash = true) {
    if (!clubId) return;
    activeClubId = clubId;
    activeFilter = 'club-community';

    if (updateHash && window.location.hash !== `#club/${clubId}`) {
      window.location.hash = `#club/${clubId}`;
    }

    // Keep Clubs item highlighted in left navigation
    const navItems = document.querySelectorAll('.nav-item-link, .bottom-nav-item');
    navItems.forEach(item => {
      const href = item.getAttribute('href');
      if (href === '#clubs') {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Fetch members for this club
    fetchClubMembers(clubId);

    renderFeed();
  }

  async function fetchClubMembers(clubId) {
    if (!clubId) return [];
    isClubMembersLoadingMap[clubId] = true;
    try {
      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (!supabase) return [];

      const { data: members, error: mErr } = await supabase
        .from('club_members')
        .select('user_id')
        .eq('club_id', clubId);

      if (mErr) {
        console.warn('[UniVibe Feed] Error fetching club members:', mErr);
        clubMembersMap[clubId] = [];
        return [];
      }

      if (!members || members.length === 0) {
        clubMembersMap[clubId] = [];
        return [];
      }

      const userIds = members.map(m => m.user_id).filter(Boolean);
      if (userIds.length === 0) {
        clubMembersMap[clubId] = [];
        return [];
      }

      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, name, handle, avatar_url')
        .in('id', userIds);

      if (pErr) {
        console.warn('[UniVibe Feed] Error fetching member profiles:', pErr);
        clubMembersMap[clubId] = [];
        return [];
      }

      const club = clubs.find(c => c.id === clubId);
      const ownerId = club ? club.createdBy : null;

      const profileList = (profiles || []).map(p => ({
        id: p.id,
        name: p.name || 'UniVibe Member',
        handle: (p.handle || 'member').replace(/^@/, ''),
        avatarUrl: p.avatar_url || null,
        isOwner: p.id === ownerId
      })).sort((a, b) => {
        if (a.isOwner) return -1;
        if (b.isOwner) return 1;
        return a.name.localeCompare(b.name);
      });

      clubMembersMap[clubId] = profileList;
      return profileList;
    } catch (err) {
      console.error('[UniVibe Feed] Exception fetching club members:', err);
      clubMembersMap[clubId] = [];
      return [];
    } finally {
      isClubMembersLoadingMap[clubId] = false;
      updateClubMembersSection(clubId);
    }
  }

  function renderClubMembersSectionHtml(clubId) {
    const club = clubs.find(c => c.id === clubId);
    const members = clubMembersMap[clubId];
    const isLoading = Boolean(isClubMembersLoadingMap[clubId]);

    let membersContentHtml = '';

    if (isLoading && (!members || members.length === 0)) {
      membersContentHtml = `
        <div style="padding: 16px; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">
          Loading members...
        </div>
      `;
    } else if (!members || members.length === 0) {
      membersContentHtml = `
        <div style="padding: 14px 16px; background-color: var(--bg-surface-secondary); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 0.85rem;">
          No members yet. Be the first to join!
        </div>
      `;
    } else {
      membersContentHtml = `
        <div class="club-members-grid">
          ${members.map(m => {
            const initials = getInitials(m.name);
            const avatarHtml = m.avatarUrl
              ? `<div class="author-avatar avatar-badge has-avatar-img" style="width: 36px; height: 36px; flex-shrink: 0; border-radius: var(--radius-full); overflow: hidden;">
                   <img src="${escapeHtml(m.avatarUrl)}" alt="${escapeHtml(m.name)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.classList.remove('has-avatar-img'); this.parentElement.textContent='${escapeHtml(initials)}';">
                 </div>`
              : `<div class="author-avatar avatar-badge" style="width: 36px; height: 36px; font-size: 0.85rem; font-weight: 700; background-color: var(--accent-soft); color: var(--accent-primary); border-radius: var(--radius-full); flex-shrink: 0;">${initials}</div>`;

            return `
              <div class="club-member-card" id="member-${escapeHtml(m.id)}">
                ${avatarHtml}
                <div class="club-member-info" style="min-width: 0; flex: 1;">
                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <strong style="font-size: 0.875rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px;" title="${escapeHtml(m.name)}">
                      ${escapeHtml(m.name)}
                    </strong>
                    ${m.isOwner ? `<span class="club-owner-badge">Owner</span>` : ''}
                  </div>
                  <span style="font-size: 0.775rem; color: var(--text-tertiary); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(m.handle.replace(/^@/, ''))}
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const countDisplay = members ? `(${members.length})` : '';

    return `
      <section class="club-members-section" style="background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: var(--space-lg); margin-bottom: var(--space-lg); box-shadow: var(--shadow-xs);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <h3 style="font-family: var(--font-display); font-size: 1.05rem; font-weight: 750; color: var(--text-primary); margin: 0;">
              Club Members <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);">${countDisplay}</span>
            </h3>
          </div>
          ${club && club.memberLimit ? `
            <span style="font-size: 0.775rem; font-weight: 650; color: ${club.isFull ? 'var(--danger-primary, #ef4444)' : 'var(--text-secondary)'};">
              Limit: ${club.memberCount} / ${club.memberLimit}
            </span>
          ` : ''}
        </div>
        <div id="club-members-list-container-${escapeHtml(clubId)}">
          ${membersContentHtml}
        </div>
      </section>
    `;
  }

  function updateClubMembersSection(clubId) {
    const listContainer = document.getElementById(`club-members-list-container-${clubId}`);
    if (!listContainer) return;
    const club = clubs.find(c => c.id === clubId);
    const members = clubMembersMap[clubId];
    if (!members || members.length === 0) {
      listContainer.innerHTML = `
        <div style="padding: 14px 16px; background-color: var(--bg-surface-secondary); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 0.85rem;">
          No members yet. Be the first to join!
        </div>
      `;
      return;
    }

    listContainer.innerHTML = `
      <div class="club-members-grid">
        ${members.map(m => {
          const initials = getInitials(m.name);
          const avatarHtml = m.avatarUrl
            ? `<div class="author-avatar avatar-badge has-avatar-img" style="width: 36px; height: 36px; flex-shrink: 0; border-radius: var(--radius-full); overflow: hidden;">
                 <img src="${escapeHtml(m.avatarUrl)}" alt="${escapeHtml(m.name)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.classList.remove('has-avatar-img'); this.parentElement.textContent='${escapeHtml(initials)}';">
               </div>`
            : `<div class="author-avatar avatar-badge" style="width: 36px; height: 36px; font-size: 0.85rem; font-weight: 700; background-color: var(--accent-soft); color: var(--accent-primary); border-radius: var(--radius-full); flex-shrink: 0;">${initials}</div>`;

          return `
            <div class="club-member-card" id="member-${escapeHtml(m.id)}">
              ${avatarHtml}
              <div class="club-member-info" style="min-width: 0; flex: 1;">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <strong style="font-size: 0.875rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px;" title="${escapeHtml(m.name)}">
                    ${escapeHtml(m.name)}
                  </strong>
                  ${m.isOwner ? `<span class="club-owner-badge">Owner</span>` : ''}
                </div>
                <span style="font-size: 0.775rem; color: var(--text-tertiary); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(m.handle.replace(/^@/, ''))}
                </span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderClubCommunityView(container, clubId) {
    const club = clubs.find(c => c.id === clubId);
    if (!club) {
      if (isLoading || isClubsLoading) {
        container.innerHTML = `
          <div class="feed-empty-state" style="opacity: 0.7;">
            <p class="empty-state-subtitle">Loading club community...</p>
          </div>
        `;
        return;
      }
      container.innerHTML = `
        <div class="feed-empty-state">
          <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h3 class="empty-state-title">Club not found</h3>
          <p class="empty-state-subtitle">This club may have been removed or does not exist.</p>
          <button class="btn-primary" style="margin-top: 14px;" onclick="UniVibeFeed.setFilter('clubs')">
            Back to Clubs Directory
          </button>
        </div>
      `;
      return;
    }

    const avatarHtml = renderClubAvatarHtml(club, 58, 1.35);
    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    const isGuest = !window.UniVibeAuth || window.UniVibeAuth.isGuest();
    const isMember = Boolean(club.isJoined);
    const isClubOwner = currentUser && currentUser.id && club.createdBy === currentUser.id;
    const userInitials = currentUser && currentUser.name ? getInitials(currentUser.name) : 'G';
    const membersCountLabel = club.memberLimit ? `${club.memberCount} / ${club.memberLimit} members` : `${club.memberCount} ${club.memberCount === 1 ? 'member' : 'members'}`;
    const isFull = Boolean(club.isFull);

    // Filter posts strictly belonging to this club
    const clubPosts = posts
      .filter(p => p.clubId === club.id)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Composer block: Member has inline creator trigger; Non-member has Join prompt; Guest has Sign-in prompt
    let composerHtml = '';
    if (isGuest) {
      composerHtml = `
        <div class="club-guest-join-box" style="background-color: var(--bg-surface); border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); padding: var(--space-md); margin-bottom: var(--space-lg); display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.35rem;">👋</span>
            <div>
              <strong style="color: var(--text-primary); font-size: 0.95rem; display: block;">Join the ${escapeHtml(club.name)} Community</strong>
              <span style="color: var(--text-secondary); font-size: 0.825rem;">Sign in to become a member and share posts in this club.</span>
            </div>
          </div>
          <button class="btn-primary" style="font-size: 0.85rem; padding: 7px 18px;" onclick="UniVibeAuth.promptSignIn()">
            Sign In to Join
          </button>
        </div>
      `;
    } else if (!isMember) {
      composerHtml = `
        <div class="club-nonmember-box" style="background-color: var(--bg-surface); border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); padding: var(--space-md); margin-bottom: var(--space-lg); display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.35rem;">🔒</span>
            <div>
              <strong style="color: var(--text-primary); font-size: 0.95rem; display: block;">Members-Only Discussion</strong>
              <span style="color: var(--text-secondary); font-size: 0.825rem;">Join ${escapeHtml(club.name)} to share posts with this community.</span>
            </div>
          </div>
          ${isFull ? `
            <button class="club-join-btn full" disabled style="font-size: 0.85rem; padding: 7px 18px;" title="This club has reached its member limit">
              Club Full
            </button>
          ` : `
            <button class="btn-primary" style="font-size: 0.85rem; padding: 7px 18px;" data-action="toggle-club-join" data-club-id="${escapeHtml(club.id)}">
              Join Club to Post
            </button>
          `}
        </div>
      `;
    } else {
      composerHtml = `
        <div class="quick-share-card club-composer-card" style="margin-bottom: var(--space-lg);">
          <div class="user-avatar-sm user-avatar-badge composer-user-avatar" aria-hidden="true">${userInitials}</div>
          <button class="composer-trigger-btn" data-action="open-create-club-post" data-club-id="${escapeHtml(club.id)}">
            Post in ${escapeHtml(club.name)}... Share a question, project, or vibe...
          </button>
          <button class="btn-primary" data-action="open-create-club-post" data-club-id="${escapeHtml(club.id)}" style="font-size: 0.85rem; padding: 7px 16px; white-space: nowrap;">
            Create Post
          </button>
        </div>
      `;
    }

    let postsListHtml = '';
    if (clubPosts.length === 0) {
      postsListHtml = `
        <div class="feed-empty-state">
          <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <h3 class="empty-state-title">No posts in ${escapeHtml(club.name)} yet.</h3>
          <p class="empty-state-subtitle">Be the first member to start a discussion in this club!</p>
          ${isMember ? `
            <button class="btn-primary" style="margin-top: 14px;" data-action="open-create-club-post" data-club-id="${escapeHtml(club.id)}">
              Create First Post
            </button>
          ` : ''}
        </div>
      `;
    } else {
      postsListHtml = `
        <div class="club-feed-label" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); padding: 0 4px;">
          <h3 style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">
            Community Posts (${clubPosts.length})
          </h3>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">Newest first</span>
        </div>
        <div class="club-posts-stream">
          ${clubPosts.map(p => renderSocialCard(p)).join('')}
        </div>
      `;
    }

    container.innerHTML = `
      <!-- Back to Clubs Navigation -->
      <div class="club-nav-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md);">
        <button class="btn-back-clubs" onclick="UniVibeFeed.setFilter('clubs')" style="display: inline-flex; align-items: center; gap: 8px; background: transparent; border: 1px solid var(--border-subtle); color: var(--text-primary); padding: 7px 14px; border-radius: var(--radius-full); font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all var(--transition-fast);">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Back to Clubs Directory</span>
        </button>
        <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">Club Community</span>
      </div>

      <!-- Club Banner / Hero Card -->
      <section class="club-hero-card" style="background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: var(--space-lg); margin-bottom: var(--space-lg); box-shadow: var(--shadow-xs);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md); flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: var(--space-md); min-width: 0;">
            ${avatarHtml}
            <div style="min-width: 0;">
              <h1 class="club-community-title" style="font-family: var(--font-display); font-size: 1.45rem; font-weight: 800; color: var(--text-primary); margin: 0; line-height: 1.25;">
                ${escapeHtml(club.name)}
              </h1>
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 0.85rem; color: var(--text-secondary); flex-wrap: wrap;">
                <span style="font-weight: 650; color: var(--accent-primary);">
                  👥 ${membersCountLabel}${isFull && !club.isJoined ? ' · <span style="color: var(--danger-primary, #ef4444); font-weight: 700;">Club Full</span>' : ''}
                </span>
                <span>·</span>
                <span>Created ${escapeHtml(club.timeAgo)}</span>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${club.isJoined ? `
              <button class="club-join-btn joined" style="padding: 8px 22px; font-size: 0.9rem;" data-action="toggle-club-join" data-club-id="${escapeHtml(club.id)}">
                Joined ✓
              </button>
            ` : isFull ? `
              <button class="club-join-btn full" disabled style="padding: 8px 22px; font-size: 0.9rem;" title="This club has reached its member limit">
                Club Full
              </button>
            ` : `
              <button class="club-join-btn" style="padding: 8px 22px; font-size: 0.9rem;" data-action="toggle-club-join" data-club-id="${escapeHtml(club.id)}">
                Join Club
              </button>
            `}
            ${isClubOwner ? `
              <button class="btn-secondary" data-action="open-club-edit" data-club-id="${escapeHtml(club.id)}" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; font-size: 0.85rem;" title="Edit Club Settings">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Edit Club</span>
              </button>
              <button class="detail-delete-btn" data-action="delete-club" data-club-id="${escapeHtml(club.id)}" title="Delete club" aria-label="Delete club">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete Club</span>
              </button>
            ` : ''}
          </div>
        </div>

        <div style="margin-top: var(--space-md); padding-top: var(--space-md); border-top: 1px solid var(--border-subtle);">
          <p class="club-community-desc" style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); margin: 0; white-space: pre-wrap;">
            ${escapeHtml(club.description)}
          </p>
        </div>
      </section>

      <!-- Real Club Members Section INSIDE Club Community View -->
      ${renderClubMembersSectionHtml(club.id)}

      <!-- Post Composer or Prompt -->
      ${composerHtml}

      <!-- Club Posts Feed -->
      ${postsListHtml}
    `;
  }

  function openClubDetail(clubId) {
    // Navigate straight to the dedicated Club Community page
    navigateToClub(clubId);
  }

  function closeClubDetail() {
    const modal = document.getElementById('club-detail-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  function renderFeed() {
    const feedContainer = document.getElementById('feed-stream');
    if (!feedContainer) return;

    // Toggle main feed welcome header visibility (shown strictly on Home / Campus Stories)
    const mainFeedHeader = document.getElementById('main-feed-header');
    if (mainFeedHeader) {
      mainFeedHeader.style.display = (activeFilter === 'all' || activeFilter === 'campus-stories') ? '' : 'none';
    }

    if (isLoading && posts.length === 0 && events.length === 0 && clubs.length === 0) {
      feedContainer.innerHTML = `
        <div class="feed-empty-state" style="opacity: 0.7;">
          <p class="empty-state-subtitle">Loading vibes from campus...</p>
        </div>
      `;
      return;
    }

    // View: Dedicated Post Detail View
    if (activeFilter === 'post-detail' && activePostId) {
      renderPostDetailView(feedContainer, activePostId);
      return;
    }

    // View: Dedicated Event Detail View & Community Discussion Page
    if (activeFilter === 'event-detail' && activeEventId) {
      renderEventDetailView(feedContainer, activeEventId);
      return;
    }

    // View: Dedicated Club Community Page
    if (activeFilter === 'club-community' && activeClubId) {
      renderClubCommunityView(feedContainer, activeClubId);
      return;
    }

    // View: Dedicated Profile Page & My Posts
    if (activeFilter === 'profile') {
      renderProfileView(feedContainer);
      return;
    }

    // Handle database connection error on posts
    if (fetchError && activeFilter !== 'event' && activeFilter !== 'profile' && activeFilter !== 'event-detail') {
      const isMissingTable = fetchError.code === 'PGRST205' || (fetchError.message && fetchError.message.includes('public.posts'));
      if (isMissingTable) {
        feedContainer.innerHTML = `
          <div class="feed-empty-state">
            <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
            </div>
            <h3 class="empty-state-title">Database Setup Needed</h3>
            <p class="empty-state-subtitle">Please run <code>schema.sql</code> in your Supabase SQL Editor.</p>
          </div>
        `;
        return;
      }
    }

    // View: Events Page
    if (activeFilter === 'event' || activeFilter === 'club-events') {
      const eventsHeaderHtml = `
        <div class="events-directory-header">
          <div>
            <h2 class="events-directory-title">Campus Events</h2>
            <p class="events-directory-sub">Discover meetups, workshops, and campus happenings.</p>
          </div>
          <button class="btn-primary" data-action="open-create" data-tab="event" style="display: inline-flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>Host Event</span>
          </button>
        </div>
      `;

      if (events.length === 0) {
        feedContainer.innerHTML = `
          ${eventsHeaderHtml}
          <div class="feed-empty-state">
            <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <h3 class="empty-state-title">No upcoming events yet.</h3>
            <p class="empty-state-subtitle">Be the first to host a campus event.</p>
            <button class="btn-primary" style="margin-top: 14px;" data-action="open-create" data-tab="event">
              Host an Event
            </button>
          </div>
        `;
        return;
      }

      feedContainer.innerHTML = `
        ${eventsHeaderHtml}
        ${events.map(renderEventCard).join('')}
      `;
      return;
    }

    // View: Clubs Directory
    if (activeFilter === 'clubs') {
      if (clubs.length === 0) {
        feedContainer.innerHTML = `
          <div class="clubs-directory-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); flex-wrap: wrap; gap: var(--space-sm);">
            <div>
              <h2 style="font-family: var(--font-display); font-size: 1.35rem; font-weight: 750; color: var(--text-primary); margin: 0;">Campus Clubs</h2>
              <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 2px 0 0 0;">Find your crew, explore shared interests, and get involved.</p>
            </div>
            <button class="btn-primary" data-action="open-create" data-tab="club" style="display: inline-flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>Create Club</span>
            </button>
          </div>
          <div class="feed-empty-state">
            <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <h3 class="empty-state-title">No active clubs yet.</h3>
            <p class="empty-state-subtitle">Be the first to start a campus club.</p>
            <button class="btn-primary" style="margin-top: 14px;" data-action="open-create" data-tab="club">
              Start a Club
            </button>
          </div>
        `;
        return;
      }

      feedContainer.innerHTML = `
        <div class="clubs-directory-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); flex-wrap: wrap; gap: var(--space-sm);">
          <div>
            <h2 style="font-family: var(--font-display); font-size: 1.35rem; font-weight: 750; color: var(--text-primary); margin: 0;">Campus Clubs</h2>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 2px 0 0 0;">Find your crew, explore shared interests, and get involved.</p>
          </div>
          <button class="btn-primary" data-action="open-create" data-tab="club" style="display: inline-flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>Create Club</span>
          </button>
        </div>
        ${clubs.map(renderClubCard).join('')}
      `;
      return;
    }

    // Filter campus-wide posts (club_id is NULL) for Home (Campus Stories)
    const campusPosts = posts.filter(p => !p.clubId);

    // View: Home (Dedicated Campus Stories feed - NO events or club posts mixed in!)
    if (campusPosts.length === 0) {
      feedContainer.innerHTML = `
        <div class="feed-empty-state">
          <div class="empty-state-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h3 class="empty-state-title">No campus stories yet.</h3>
          <p class="empty-state-subtitle">Be the first to share a moment, question, or discussion with campus.</p>
          <button class="btn-primary" data-action="open-create" data-tab="post">
            Share a Vibe
          </button>
        </div>
      `;
      return;
    }

    feedContainer.innerHTML = campusPosts.map(renderSocialCard).join('');
  }

  function renderSocialCard(post) {
    const initials = getInitials(post.author.name);
    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    const isPostOwner = currentUser && currentUser.id && post.userId === currentUser.id;
    const titleHtml = post.title ? `<h3 class="post-title">${escapeHtml(post.title)}</h3>` : '';
    const tagsHtml = (post.tags && post.tags.length > 0)
      ? `<div class="post-tags-row">${post.tags.map(t => `<span class="post-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    const count = post.commentCount || 0;
    const commentLabel = count === 1 ? '1 comment' : `${count} comments`;

    let clubPill = '';
    if (post.clubId && activeFilter !== 'club-community') {
      const club = clubs.find(c => c.id === post.clubId);
      if (club) {
        clubPill = `<span class="post-club-badge" style="font-size: 0.75rem; font-weight: 650; background: var(--accent-soft); color: var(--accent-primary); padding: 3px 10px; border-radius: var(--radius-full);">👥 ${escapeHtml(club.name)}</span>`;
      }
    }

    return `
      <article class="post-card social-card" id="${escapeHtml(post.id)}" data-action="open-post" data-post-id="${escapeHtml(post.id)}">
        <!-- Author Header -->
        <header class="post-header">
          <div class="author-block">
            ${renderAvatarHtml(post.author.name, post.author.avatarUrl)}
            <div class="author-meta">
              <div class="author-name-row">
                <span class="author-name">${escapeHtml(post.author.name)}</span>
              </div>
              <span class="author-sub">
                ${escapeHtml((post.author.handle || '').replace(/^@/, ''))} <span class="meta-dot">·</span> ${escapeHtml(post.timeAgo)}
              </span>
            </div>
          </div>
          <div class="post-header-actions" style="display: flex; align-items: center; gap: 8px;">
            ${clubPill}
            ${isPostOwner ? `
              <button class="card-delete-btn" data-action="delete-post" data-post-id="${escapeHtml(post.id)}" title="Delete post" aria-label="Delete post">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete</span>
              </button>
            ` : ''}
          </div>
        </header>

        <!-- Post Title -->
        ${titleHtml}

        <!-- Caption / Content / Short Body Preview with Links -->
        <p class="post-caption post-preview-caption">${linkifyText(post.content)}</p>

        <!-- Media Grid (1-4 Photos) -->
        ${renderMediaGridHtml(post.images)}

        <!-- Tags -->
        ${tagsHtml}

        <!-- Post Footer with Comment Trigger -->
        <footer class="post-card-footer">
          <button class="post-comment-trigger" data-action="open-post" data-post-id="${escapeHtml(post.id)}" aria-label="View discussion (${commentLabel})">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span class="comment-trigger-text">${commentLabel}</span>
          </button>
        </footer>
      </article>
    `;
  }

  function renderEventCard(ev) {
    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    const isEventOwner = currentUser && currentUser.id && ev.userId === currentUser.id;
    const formattedDateTime = formatEventDateTime(ev.eventDate, ev.eventTime);
    const currentStatus = eventInterestsMap[ev.id];
    const isInterested = currentStatus === 'interested';
    const isNotInterested = currentStatus === 'not_interested';

    let statusPill = '';
    if (isInterested) {
      statusPill = `<span class="event-interest-status status-interested">✓ You're interested</span>`;
    } else if (isNotInterested) {
      statusPill = `<span class="event-interest-status status-not-interested">✕ Marked not interested</span>`;
    }

    // Short summary for discovery card (capped at 160 characters)
    let shortSummary = ev.description || 'No description provided.';
    if (shortSummary.length > 160) {
      shortSummary = shortSummary.slice(0, 160).trim() + '...';
    }

    const hostHandle = (ev.creator.handle || `user_${ev.userId ? ev.userId.slice(0, 6) : 'host'}`).replace(/^@/, '');
    const hostDisplayName = (ev.creator && (ev.creator.displayName || ev.creator.name) && (ev.creator.displayName || ev.creator.name) !== 'Campus Member')
      ? (ev.creator.displayName || ev.creator.name)
      : (ev.creator && (ev.creator.displayName || ev.creator.name)) || hostHandle;

    return `
      <article class="post-card event-card event-discovery-card" id="event-${escapeHtml(ev.id)}" data-action="open-event" data-event-id="${escapeHtml(ev.id)}">
        <!-- Event Top Row -->
        <div class="event-card-top-row">
          <div class="event-banner-chip">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span>Upcoming Event</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="event-card-timeago">${escapeHtml(ev.timeAgo)}</span>
            ${isEventOwner ? `
              <button class="card-delete-btn event-card-delete-btn" data-action="delete-event" data-event-id="${escapeHtml(ev.id)}" title="Delete event" aria-label="Delete event">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete</span>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- 1. EVENT TITLE -->
        <h2 class="event-discovery-title">${escapeHtml(ev.title)}</h2>

        <!-- 2. Short summary with linkification -->
        <p class="event-discovery-summary">${linkifyText(shortSummary)}</p>

        <!-- Media Grid (1-4 Photos) -->
        ${renderMediaGridHtml(ev.images)}

        <!-- 3. Date · Time, Location, Hosted by Display Name -->
        <div class="event-discovery-meta-list">
          <div class="event-meta-item">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>${escapeHtml(formattedDateTime)}</span>
          </div>
          <div class="event-meta-item">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span>${escapeHtml(ev.location)}</span>
          </div>
          <div class="event-meta-item event-host-item">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            </svg>
            <span>Hosted by <strong class="event-host-handle">${escapeHtml(hostDisplayName)}</strong></span>
          </div>
        </div>

        <!-- 4. [ ✓ Interested ] [ ✕ Not Interested ] Controls -->
        <footer class="event-card-footer">
          <div class="event-interest-actions" role="group" aria-label="Event attendance interest">
            <button 
              type="button" 
              class="event-interest-btn btn-interested ${isInterested ? 'active-interested' : ''}" 
              data-action="toggle-interest" 
              data-event-id="${escapeHtml(ev.id)}" 
              data-status="interested"
              aria-pressed="${isInterested ? 'true' : 'false'}"
              title="${isInterested ? 'Remove from interested' : 'Mark as interested'}">
              <span class="interest-icon" aria-hidden="true">✓</span>
              <span>Interested</span>
            </button>
            <button 
              type="button" 
              class="event-interest-btn btn-not-interested ${isNotInterested ? 'active-not-interested' : ''}" 
              data-action="toggle-interest" 
              data-event-id="${escapeHtml(ev.id)}" 
              data-status="not_interested"
              aria-pressed="${isNotInterested ? 'true' : 'false'}"
              title="${isNotInterested ? 'Remove from not interested' : 'Mark as not interested'}">
              <span class="interest-icon" aria-hidden="true">✕</span>
              <span>Not Interested</span>
            </button>
          </div>
          <div class="event-footer-extra">
            ${statusPill}
            <div class="event-discussion-badge" title="View community discussion">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              <span>${ev.commentCount > 0 ? `${ev.commentCount} comments` : 'Discussion'}</span>
              <span class="event-open-arrow">→</span>
            </div>
          </div>
        </footer>
      </article>
    `;
  }

  // ==============================================================================
  // Threaded Replies Tree & Composer Engine (Reddit-Style)
  // ==============================================================================

  function buildCommentTree(flatComments) {
    if (!Array.isArray(flatComments) || flatComments.length === 0) return [];
    const map = new Map();
    const roots = [];

    // First pass: index all comments with an empty children array
    flatComments.forEach(c => {
      map.set(c.id, { ...c, children: [] });
    });

    // Second pass: attach child comments to their parent or mark as root
    flatComments.forEach(c => {
      const node = map.get(c.id);
      if (c.parentId && map.has(c.parentId)) {
        const parentNode = map.get(c.parentId);
        node.parentAuthor = parentNode.author ? parentNode.author.name : null;
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  function renderCommentTreeNode(node, currentUserId, type = 'post', depth = 0) {
    const cInitials = getInitials(node.author ? node.author.name : 'U');
    const isAuthor = currentUserId && node.userId === currentUserId;
    const cardId = type === 'event' ? `event-comment-${escapeHtml(node.id)}` : `comment-${escapeHtml(node.id)}`;
    const replyAction = type === 'event' ? 'open-event-reply' : 'open-post-reply';
    const deleteAction = type === 'event' ? 'delete-event-comment' : 'delete-comment';
    const authorName = node.author ? node.author.name : 'Campus Member';
    const authorHandle = (node.author && node.author.handle ? node.author.handle : 'user').replace(/^@/, '');

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const isReply = depth > 0;
    const visualDepth = Math.min(depth, 3);
    const isCapped = depth >= 3;

    return `
      <div class="comment-item-card ${isReply ? 'comment-reply-item' : 'comment-root-card'} depth-${visualDepth} ${isCapped ? 'comment-depth-capped' : ''}" id="${cardId}" data-comment-id="${escapeHtml(node.id)}" data-depth="${depth}">
        ${renderAvatarHtml(authorName, node.author ? node.author.avatarUrl : null, 'comment-item-avatar')}
        <div class="comment-item-content">
          <div class="comment-item-header">
            <div class="comment-item-author">
              <strong class="comment-author-name">${escapeHtml(authorName)}</strong>
              <span class="comment-author-handle">${escapeHtml(authorHandle)}</span>
              ${depth >= 4 && node.parentAuthor ? `
                <span class="comment-reply-to-badge" title="Replying to ${escapeHtml(node.parentAuthor)}">
                  <span class="reply-to-arrow">↳</span>
                  <span class="reply-to-label">to</span>
                  <strong class="reply-to-name">${escapeHtml(node.parentAuthor)}</strong>
                </span>
              ` : ''}
              <span class="comment-meta-dot">·</span>
              <span class="comment-time">${escapeHtml(node.timeAgo || '')}</span>
            </div>
            ${isAuthor ? `
              <button class="comment-item-delete-btn" data-action="${deleteAction}" data-comment-id="${escapeHtml(node.id)}" title="Delete your ${depth > 0 ? 'reply' : 'comment'}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete</span>
              </button>
            ` : ''}
          </div>
          <p class="comment-item-body">${linkifyText(node.content)}</p>
          <div class="comment-actions-toolbar">
            <button class="comment-reply-trigger-btn" data-action="${replyAction}" data-comment-id="${escapeHtml(node.id)}" data-author-name="${escapeHtml(authorName)}" title="Reply to ${escapeHtml(authorName)}">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 17 4 12 9 7"></polyline>
                <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
              </svg>
              <span>Reply</span>
            </button>
          </div>
          <div class="inline-reply-slot" id="reply-slot-${escapeHtml(node.id)}"></div>
          ${hasChildren ? `
            <div class="comment-replies-branch ${depth >= 3 ? 'branch-capped' : ''}">
              ${node.children.map(child => renderCommentTreeNode(child, currentUserId, type, depth + 1)).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderCommentTreeHtml(flatComments, currentUserId, type = 'post') {
    if (!Array.isArray(flatComments) || flatComments.length === 0) return '';
    const tree = buildCommentTree(flatComments);
    return tree.map(rootNode => renderCommentTreeNode(rootNode, currentUserId, type, 0)).join('');
  }

  function openInlineReplyComposer(commentId, authorName, type = 'post') {
    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    // Close any other open reply slots to keep interface clean
    const allSlots = document.querySelectorAll('.inline-reply-slot');
    allSlots.forEach(s => {
      if (s.id !== `reply-slot-${commentId}`) {
        s.innerHTML = '';
      }
    });

    const slot = document.getElementById(`reply-slot-${commentId}`);
    if (!slot) return;

    // If already open, focus it
    const existingTextarea = document.getElementById(`reply-input-${commentId}`);
    if (existingTextarea) {
      existingTextarea.focus();
      return;
    }

    slot.innerHTML = `
      <div class="inline-reply-box" id="active-reply-box-${escapeHtml(commentId)}">
        <div class="inline-reply-header">
          <span class="inline-reply-title">Replying to <strong>${escapeHtml(authorName)}</strong></span>
        </div>
        <form class="inline-reply-form" id="reply-form-${escapeHtml(commentId)}">
          <textarea
            id="reply-input-${escapeHtml(commentId)}"
            class="inline-reply-textarea"
            placeholder="Write your reply... (Enter to post, Shift+Enter for newline)"
            rows="2"
            required
            maxlength="2000"
          ></textarea>
          <div class="inline-reply-actions">
            <button type="button" class="btn-cancel-reply" data-action="cancel-reply" data-comment-id="${escapeHtml(commentId)}">Cancel</button>
            <button type="submit" class="btn-primary inline-reply-submit-btn" id="reply-submit-btn-${escapeHtml(commentId)}">Reply</button>
          </div>
        </form>
      </div>
    `;

    const textarea = document.getElementById(`reply-input-${commentId}`);
    const form = document.getElementById(`reply-form-${commentId}`);

    if (textarea) {
      textarea.focus();
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleReplySubmit(commentId, type);
        }
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handleReplySubmit(commentId, type);
      });
    }
  }

  function closeInlineReplyComposer(commentId) {
    const slot = document.getElementById(`reply-slot-${commentId}`);
    if (slot) {
      slot.innerHTML = '';
    }
  }

  async function handleReplySubmit(parentId, type = 'post') {
    if (!parentId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const input = document.getElementById(`reply-input-${parentId}`);
    const submitBtn = document.getElementById(`reply-submit-btn-${parentId}`);
    if (!input) return;

    const content = input.value.trim();
    if (!content) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Replying...';
      }

      if (type === 'event') {
        if (!activeEventId) return;
        const { data, error } = await supabase
          .from('event_comments')
          .insert([{
            event_id: activeEventId,
            user_id: currentUser.id,
            content: content,
            parent_id: parentId
          }])
          .select();

        if (error) {
          console.error('[UniVibe Feed] Error inserting event reply:', error);
          if (error.code === '42703' || error.code === 'PGRST204' || (error.message && error.message.includes('parent_id'))) {
            if (window.UniVibeToast) {
              window.UniVibeToast.show('Database setup required: Please run schema_threaded_replies.sql in Supabase.');
            }
          } else {
            if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to post reply.');
          }
          return;
        }

        closeInlineReplyComposer(parentId);
        if (window.UniVibeToast) {
          window.UniVibeToast.show('Reply posted! 💬');
        }
        await fetchCommentsForEvent(activeEventId);
      } else {
        if (!activePostId) return;
        const { data, error } = await supabase
          .from('comments')
          .insert([{
            post_id: activePostId,
            user_id: currentUser.id,
            content: content,
            parent_id: parentId
          }])
          .select();

        if (error) {
          console.error('[UniVibe Feed] Error inserting post reply:', error);
          if (error.code === '42703' || error.code === 'PGRST204' || (error.message && error.message.includes('parent_id'))) {
            if (window.UniVibeToast) {
              window.UniVibeToast.show('Database setup required: Please run schema_threaded_replies.sql in Supabase.');
            }
          } else {
            if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to post reply.');
          }
          return;
        }

        closeInlineReplyComposer(parentId);
        if (window.UniVibeToast) {
          window.UniVibeToast.show('Reply posted! 💬');
        }
        await fetchCommentsForPost(activePostId);
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception posting reply:', err);
      if (window.UniVibeToast) window.UniVibeToast.show('Failed to post reply.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reply';
      }
    }
  }

  // ==============================================================================
  // Dedicated Event Community Page & Discussion Controller
  // ==============================================================================

  function navigateToEvent(eventId, updateHash = true) {
    if (!eventId) return;
    activeEventId = eventId;
    activeFilter = 'event-detail';

    if (updateHash && window.location.hash !== `#event/${eventId}`) {
      window.location.hash = `#event/${eventId}`;
    }

    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {}

    // Keep Events navigation item active
    const navItems = document.querySelectorAll('.nav-item-link, .bottom-nav-item');
    navItems.forEach(item => {
      const href = item.getAttribute('href');
      if (href === '#events') {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    renderFeed();
    fetchCommentsForEvent(eventId);
  }

  function renderEventDetailView(container, eventId) {
    const ev = events.find(e => e.id === eventId);
    if (!ev) {
      if (isLoading) {
        container.innerHTML = `
          <div class="feed-empty-state" style="opacity: 0.7;">
            <p class="empty-state-subtitle">Loading event details...</p>
          </div>
        `;
        return;
      }
      container.innerHTML = `
        <div class="feed-empty-state">
          <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h3 class="empty-state-title">Event not found</h3>
          <p class="empty-state-subtitle">This event may have concluded or does not exist.</p>
          <button class="btn-primary" style="margin-top: 14px;" onclick="UniVibeFeed.setFilter('event')">
            Back to Events
          </button>
        </div>
      `;
      return;
    }

    const currentStatus = eventInterestsMap[ev.id];
    const isInterested = currentStatus === 'interested';
    const isNotInterested = currentStatus === 'not_interested';

    let statusPill = '';
    if (isInterested) {
      statusPill = `<span class="event-interest-status status-interested">✓ You're interested in attending</span>`;
    } else if (isNotInterested) {
      statusPill = `<span class="event-interest-status status-not-interested">✕ Marked not interested</span>`;
    }

    const hostHandle = (ev.creator.handle || `user_${ev.userId ? ev.userId.slice(0, 6) : 'host'}`).replace(/^@/, '');
    const hostDisplayName = (ev.creator && (ev.creator.displayName || ev.creator.name) && (ev.creator.displayName || ev.creator.name) !== 'Campus Member')
      ? (ev.creator.displayName || ev.creator.name)
      : (ev.creator && (ev.creator.displayName || ev.creator.name)) || hostHandle;

    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    const currentUserId = currentUser ? currentUser.id : null;
    const isEventOwner = currentUserId && ev.userId === currentUserId;
    const isGuest = !window.UniVibeAuth || window.UniVibeAuth.isGuest();
    const userInitials = currentUser && currentUser.name ? getInitials(currentUser.name) : 'U';

    const dateFormatted = formatEventDateDetail(ev.eventDate);
    const timeFormatted = formatEventTimeDetail(ev.eventTime);

    // Format full description with clickable links
    const descriptionHtml = ev.description
      ? linkifyText(ev.description)
      : '<p class="event-no-desc">No additional details provided for this event.</p>';

    // Render event comments stream
    let commentsStreamHtml = '';
    if (isEventCommentsLoading) {
      commentsStreamHtml = `
        <div class="comments-empty-state" style="opacity: 0.7;">
          <p>Loading discussion...</p>
        </div>
      `;
    } else if (activeEventComments.length === 0) {
      commentsStreamHtml = `
        <div class="comments-empty-state">
          <div class="comments-empty-icon" aria-hidden="true">💬</div>
          <h4>No comments yet</h4>
          <p>Be the first to ask a question, share info, or coordinate meetup details!</p>
        </div>
      `;
    } else {
      commentsStreamHtml = renderCommentTreeHtml(activeEventComments, currentUserId, 'event');
    }

    // Composer / Guest prompt HTML
    let composerHtml = '';
    if (isGuest) {
      composerHtml = `
        <div class="post-comment-guest-prompt">
          <div class="guest-prompt-text">
            <span class="guest-prompt-icon">🔒</span>
            <div>
              <strong>Sign in to join the event discussion</strong>
              <p>Guests can read event discussions. Sign in with your campus account to comment.</p>
            </div>
          </div>
          <button class="btn-primary" onclick="UniVibeAuth.promptSignIn()">
            Sign In to Comment
          </button>
        </div>
      `;
    } else {
      composerHtml = `
        <form class="post-comment-form" id="event-detail-comment-form">
          ${renderAvatarHtml(currentUser && currentUser.name ? currentUser.name : 'U', currentUser ? currentUser.avatarUrl : null, 'comment-form-avatar')}
          <div class="comment-form-input-wrap">
            <textarea
              id="event-detail-comment-input"
              class="comment-form-textarea"
              placeholder="Write something about this event... (Enter to post, Shift+Enter for newline)"
              rows="2"
              required
              maxlength="2000"
            ></textarea>
            <div class="comment-form-actions">
              <button type="submit" class="btn-primary comment-form-submit-btn" id="event-detail-comment-submit">
                Comment
              </button>
            </div>
          </div>
        </form>
      `;
    }

    container.innerHTML = `
      <div class="dedicated-event-view" id="dedicated-event-view">
        <!-- Top Back Navigation Bar -->
        <div class="event-detail-nav-header">
          <button class="btn-back-nav" data-action="back-from-event" aria-label="Back to Events">
            <span class="btn-back-arrow" aria-hidden="true">←</span>
            <span>Back to Events</span>
          </button>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="event-detail-type-pill">📅 Campus Event</span>
            ${isEventOwner ? `
              <button class="detail-delete-btn" data-action="delete-event" data-event-id="${escapeHtml(ev.id)}" title="Delete event" aria-label="Delete event">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete Event</span>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Main Event Card -->
        <article class="event-detail-hero-card">
          <!-- EVENT TITLE & Host -->
          <div class="event-detail-header-block">
            <h1 class="event-detail-main-title">${escapeHtml(ev.title)}</h1>
            <div class="event-detail-host-line" style="display: flex; align-items: center; gap: 8px;">
              ${renderAvatarHtml(ev.creator.name || 'Campus Member', ev.creator.avatarUrl, 'event-host-avatar', 'width: 24px; height: 24px; font-size: 0.7rem;')}
              <span class="event-host-label">Hosted by</span>
              <span class="event-host-name-highlight">${escapeHtml(hostDisplayName)}</span>
            </div>
          </div>

          <!-- Date, Time, Location -->
          <div class="event-detail-meta-grid">
            <div class="event-detail-meta-card">
              <div class="meta-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div class="meta-card-content">
                <span class="meta-card-label">Date</span>
                <span class="meta-card-value">${escapeHtml(dateFormatted)}</span>
              </div>
            </div>

            <div class="event-detail-meta-card">
              <div class="meta-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div class="meta-card-content">
                <span class="meta-card-label">Time</span>
                <span class="meta-card-value">${escapeHtml(timeFormatted)}</span>
              </div>
            </div>

            <div class="event-detail-meta-card">
              <div class="meta-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div class="meta-card-content">
                <span class="meta-card-label">Location</span>
                <span class="meta-card-value">${escapeHtml(ev.location)}</span>
              </div>
            </div>
          </div>

          <!-- Interest Actions Bar -->
          <div class="event-detail-actions-row">
            <div class="event-interest-actions" role="group" aria-label="Event attendance interest">
              <button 
                type="button" 
                class="event-interest-btn btn-interested ${isInterested ? 'active-interested' : ''}" 
                data-action="toggle-interest" 
                data-event-id="${escapeHtml(ev.id)}" 
                data-status="interested"
                aria-pressed="${isInterested ? 'true' : 'false'}"
                title="${isInterested ? 'Remove from interested' : 'Mark as interested'}">
                <span class="interest-icon" aria-hidden="true">✓</span>
                <span>Interested</span>
              </button>
              <button 
                type="button" 
                class="event-interest-btn btn-not-interested ${isNotInterested ? 'active-not-interested' : ''}" 
                data-action="toggle-interest" 
                data-event-id="${escapeHtml(ev.id)}" 
                data-status="not_interested"
                aria-pressed="${isNotInterested ? 'true' : 'false'}"
                title="${isNotInterested ? 'Remove from not interested' : 'Mark as not interested'}">
                <span class="interest-icon" aria-hidden="true">✕</span>
                <span>Not Interested</span>
              </button>
            </div>
            ${statusPill}
          </div>

          <!-- ABOUT THIS EVENT Section -->
          <div class="event-about-card">
            <h2 class="event-about-heading">ABOUT THIS EVENT</h2>
            <div class="event-about-body">
              ${descriptionHtml}
              ${renderMediaGridHtml(ev.images)}
            </div>
          </div>
        </article>

        <!-- DISCUSSION Section -->
        <section class="post-comments-section event-discussion-section" id="event-comments-section">
          <div class="comments-section-header">
            <h3 class="comments-section-title">
              DISCUSSION
              <span class="comments-count-pill" id="event-detail-comments-badge">${activeEventComments.length}</span>
            </h3>
            <span class="comments-sort-hint">Chronological · Oldest to newest</span>
          </div>

          <div class="comments-stream-list" id="event-comments-stream">
            ${commentsStreamHtml}
          </div>

          <div class="post-comment-composer-box" id="event-comment-composer-box">
            ${composerHtml}
          </div>
        </section>
      </div>
    `;

    // Attach textarea auto-expand and Enter key submission
    const commentInput = document.getElementById('event-detail-comment-input');
    const commentForm = document.getElementById('event-detail-comment-form');
    if (commentInput && commentForm) {
      commentInput.addEventListener('input', () => {
        commentInput.style.height = 'auto';
        commentInput.style.height = Math.min(commentInput.scrollHeight, 200) + 'px';
      });

      commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commentForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      });

      commentForm.addEventListener('submit', handleEventCommentSubmit);
    }
  }

  async function fetchCommentsForEvent(eventId) {
    if (!eventId) return;
    const event = events.find(e => e.id === eventId);

    isEventCommentsLoading = true;
    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) {
      isEventCommentsLoading = false;
      refreshEventCommentsUI(event);
      return;
    }

    try {
      const { data: commentsData, error: commErr } = await supabase
        .from('event_comments')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

      if (commErr) {
        console.warn('[UniVibe Feed] Error fetching event comments:', commErr);
        activeEventComments = [];
        isEventCommentsLoading = false;
        refreshEventCommentsUI(event);
        return;
      }

      if (!commentsData || commentsData.length === 0) {
        activeEventComments = [];
        isEventCommentsLoading = false;
        if (event) event.commentCount = 0;
        refreshEventCommentsUI(event);
        return;
      }

      // Fetch profiles for comment authors
      const userIds = [...new Set(commentsData.map(c => c.user_id).filter(Boolean))];
      let profilesMap = {};
      if (userIds.length > 0) {
        try {
          const res = await supabase
            .from('profiles')
            .select('id, name, handle, avatar_url')
            .in('id', userIds);
          let profs = res.data;
          if (res.error && res.error.message && res.error.message.includes('avatar_url')) {
            const fallbackRes = await supabase
              .from('profiles')
              .select('id, name, handle')
              .in('id', userIds);
            profs = fallbackRes.data;
          }
          if (profs) {
            profs.forEach(p => { profilesMap[p.id] = p; });
          }
        } catch (e) {}
      }

      const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;

      activeEventComments = commentsData.map(c => {
        const prof = profilesMap[c.user_id];
        let name = '';
        let handle = '';

        if (prof && prof.name) {
          name = prof.name;
          handle = prof.handle ? prof.handle.replace(/^@/, '') : prof.name.toLowerCase().replace(/\s+/g, '');
        } else if (currentUser && currentUser.id === c.user_id) {
          name = currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Campus Member');
          handle = currentUser.handle ? currentUser.handle.replace(/^@/, '') : (currentUser.email ? currentUser.email.split('@')[0].toLowerCase() : `user_${c.user_id.slice(0, 6)}`);
        } else {
          name = 'Campus Member';
          handle = `user_${c.user_id ? c.user_id.slice(0, 6) : 'anon'}`;
        }

        const authorAvatar = (prof && prof.avatar_url) || (currentUser && currentUser.id === c.user_id ? currentUser.avatarUrl : null) || null;

        return {
          id: c.id,
          eventId: c.event_id,
          userId: c.user_id,
          parentId: c.parent_id || null,
          content: c.content,
          createdAt: c.created_at,
          timeAgo: formatTimeAgo(c.created_at),
          author: {
            name,
            handle,
            avatarUrl: authorAvatar
          }
        };
      });

      if (event) {
        event.commentCount = activeEventComments.length;
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception fetching event comments:', err);
    } finally {
      isEventCommentsLoading = false;
      refreshEventCommentsUI(event);
    }
  }

  function refreshEventCommentsUI(event) {
    if (activeFilter === 'event-detail' && activeEventId) {
      const streamElem = document.getElementById('event-comments-stream');
      const badgeElem = document.getElementById('event-detail-comments-badge');

      if (badgeElem) badgeElem.textContent = activeEventComments.length;

      if (streamElem) {
        if (isEventCommentsLoading) {
          streamElem.innerHTML = `<div class="comments-empty-state" style="opacity: 0.7;"><p>Loading discussion...</p></div>`;
          return;
        }

        if (activeEventComments.length === 0) {
          streamElem.innerHTML = `
            <div class="comments-empty-state">
              <div class="comments-empty-icon" aria-hidden="true">💬</div>
              <h4>No comments yet</h4>
              <p>Be the first to ask a question, share info, or coordinate meetup details!</p>
            </div>
          `;
          return;
        }

        const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
        const currentUserId = currentUser ? currentUser.id : null;

        streamElem.innerHTML = renderCommentTreeHtml(activeEventComments, currentUserId, 'event');
      }
    }
  }

  async function handleEventCommentSubmit(e) {
    if (e) e.preventDefault();
    if (!activeEventId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const input = document.getElementById('event-detail-comment-input');
    const submitBtn = document.getElementById('event-detail-comment-submit');
    if (!input) return;

    const content = input.value.trim();
    if (!content) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Posting...';
      }

      const { data, error } = await supabase
        .from('event_comments')
        .insert([{
          event_id: activeEventId,
          user_id: currentUser.id,
          content: content
        }])
        .select();

      if (error) {
        console.error('[UniVibe Feed] Error inserting event comment:', error);
        const isMissingTable = error.code === 'PGRST205' ||
          (error.message && (error.message.includes('relation "public.event_comments" does not exist') || error.message.includes('relation "event_comments" does not exist')));
        if (isMissingTable) {
          if (window.UniVibeToast) {
            window.UniVibeToast.show('Event comments table setup required in Supabase.');
          }
        } else {
          if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to post comment.');
        }
        return;
      }

      input.value = '';
      input.style.height = 'auto';

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Comment posted! 💬');
      }

      await fetchCommentsForEvent(activeEventId);

      const commentsSection = document.getElementById('event-comments-section');
      if (commentsSection) {
        commentsSection.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception posting event comment:', err);
      if (window.UniVibeToast) window.UniVibeToast.show('Failed to post comment.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Comment';
      }
    }
  }

  async function handleEventCommentDelete(commentId) {
    if (!commentId || !activeEventId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) return;

    const confirmed = window.confirm('Are you sure you want to permanently delete this comment? This action cannot be undone.');
    if (!confirmed) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('event_comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', currentUser.id);

      if (error) {
        console.error('[UniVibe Feed] Error deleting event comment:', error);
        if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to delete comment.');
        return;
      }

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Comment deleted.');
      }

      await fetchCommentsForEvent(activeEventId);
    } catch (err) {
      console.error('[UniVibe Feed] Exception deleting event comment:', err);
    }
  }

  // ==============================================================================
  // Dedicated Post Detail View & Discussion Controller
  // ==============================================================================

  function navigateToPost(postId, updateHash = true) {
    if (!postId) return;
    activePostId = postId;
    activeFilter = 'post-detail';

    if (updateHash && window.location.hash !== `#post/${postId}`) {
      window.location.hash = `#post/${postId}`;
    }

    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {}

    const post = posts.find(p => p.id === postId);
    const navItems = document.querySelectorAll('.nav-item-link, .bottom-nav-item');
    navItems.forEach(item => {
      const href = item.getAttribute('href');
      if (post && post.clubId) {
        if (href === '#clubs') item.classList.add('active');
        else item.classList.remove('active');
      } else {
        if (href === '#home' || !href) item.classList.add('active');
        else item.classList.remove('active');
      }
    });

    renderFeed();
    fetchCommentsForPost(postId);
  }

  function renderPostDetailView(container, postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) {
      if (isLoading) {
        container.innerHTML = `
          <div class="feed-empty-state" style="opacity: 0.7;">
            <p class="empty-state-subtitle">Loading vibe...</p>
          </div>
        `;
        return;
      }
      container.innerHTML = `
        <div class="feed-empty-state">
          <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <h3 class="empty-state-title">Post not found</h3>
          <p class="empty-state-subtitle">This post may have been removed or does not exist.</p>
          <button class="btn-primary" style="margin-top: 14px;" onclick="UniVibeFeed.setFilter('all')">
            Back to Campus Feed
          </button>
        </div>
      `;
      return;
    }

    const initials = getInitials(post.author.name);
    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    const currentUserId = currentUser ? currentUser.id : null;
    const isPostOwner = currentUserId && post.userId === currentUserId;
    const isGuest = !window.UniVibeAuth || window.UniVibeAuth.isGuest();
    const userInitials = currentUser && currentUser.name ? getInitials(currentUser.name) : 'U';

    let backBtnHtml = '';
    let locationBadgeHtml = '';
    let clubBadgeHtml = '';

    if (post.clubId) {
      const club = clubs.find(c => c.id === post.clubId);
      const clubName = club ? club.name : 'Club';
      backBtnHtml = `
        <button class="btn-back-nav" data-action="back-from-post" data-club-id="${escapeHtml(post.clubId)}" aria-label="Back to ${escapeHtml(clubName)}">
          <span class="btn-back-arrow" aria-hidden="true">←</span>
          <span>Back to ${escapeHtml(clubName)}</span>
        </button>
      `;
      locationBadgeHtml = `<span class="post-detail-location-badge">👥 ${escapeHtml(clubName)}</span>`;
      clubBadgeHtml = `
        <span class="post-detail-club-pill" data-action="open-club-community" data-club-id="${escapeHtml(post.clubId)}">
          👥 ${escapeHtml(clubName)}
        </span>
      `;
    } else {
      backBtnHtml = `
        <button class="btn-back-nav" data-action="back-from-post" aria-label="Back to Campus Feed">
          <span class="btn-back-arrow" aria-hidden="true">←</span>
          <span>Back to Campus Feed</span>
        </button>
      `;
      locationBadgeHtml = `<span class="post-detail-location-badge">🌍 Campus Vibe</span>`;
    }

    const titleHtml = post.title
      ? `<h1 class="post-detail-title">${escapeHtml(post.title)}</h1>`
      : '';

    const tagsHtml = (post.tags && post.tags.length > 0)
      ? `<div class="post-detail-tags">${post.tags.map(t => `<span class="post-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    // Render comments stream
    let commentsStreamHtml = '';
    if (isCommentsLoading) {
      commentsStreamHtml = `
        <div class="comments-empty-state" style="opacity: 0.7;">
          <p>Loading comments...</p>
        </div>
      `;
    } else if (activeComments.length === 0) {
      commentsStreamHtml = `
        <div class="comments-empty-state">
          <div class="comments-empty-icon" aria-hidden="true">💬</div>
          <h4>No comments yet</h4>
          <p>Be the first to share your thoughts in this discussion!</p>
        </div>
      `;
    } else {
      commentsStreamHtml = renderCommentTreeHtml(activeComments, currentUserId, 'post');
    }

    // Composer / Guest prompt HTML
    let composerHtml = '';
    if (isGuest) {
      composerHtml = `
        <div class="post-comment-guest-prompt">
          <div class="guest-prompt-text">
            <span class="guest-prompt-icon">🔒</span>
            <div>
              <strong>Sign in to join the discussion</strong>
              <p>Guests can read all comments. Sign in with your campus account to participate.</p>
            </div>
          </div>
          <button class="btn-primary" onclick="UniVibeAuth.promptSignIn()">
            Sign In to Comment
          </button>
        </div>
      `;
    } else {
      composerHtml = `
        <form class="post-comment-form" id="post-detail-comment-form">
          ${renderAvatarHtml(currentUser && currentUser.name ? currentUser.name : 'U', currentUser ? currentUser.avatarUrl : null, 'comment-form-avatar')}
          <div class="comment-form-input-wrap">
            <textarea
              id="post-detail-comment-input"
              class="comment-form-textarea"
              placeholder="What are your thoughts? Press Enter to post, Shift+Enter for newline..."
              rows="2"
              required
              maxlength="2000"
            ></textarea>
            <div class="comment-form-actions">
              <button type="submit" class="btn-primary comment-form-submit-btn" id="post-detail-comment-submit">
                Comment
              </button>
            </div>
          </div>
        </form>
      `;
    }

    container.innerHTML = `
      <div class="dedicated-post-view" id="dedicated-post-view">
        <!-- Top Back Navigation -->
        <div class="post-detail-nav-header">
          ${backBtnHtml}
          <div style="display: flex; align-items: center; gap: 10px;">
            ${locationBadgeHtml}
            ${isPostOwner ? `
              <button class="detail-delete-btn" data-action="delete-post" data-post-id="${escapeHtml(post.id)}" title="Delete post" aria-label="Delete post">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Delete Post</span>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Main Post Card -->
        <article class="post-detail-main-card">
          <header class="post-detail-header">
            <div class="post-detail-author-block">
              ${renderAvatarHtml(post.author.name, post.author.avatarUrl, 'post-detail-avatar')}
              <div class="author-meta">
                <div class="author-name-row">
                  <span class="author-name post-detail-author-name">${escapeHtml(post.author.name)}</span>
                </div>
                <span class="author-sub">
                  ${escapeHtml((post.author.handle || '').replace(/^@/, ''))} <span class="meta-dot">·</span> ${escapeHtml(post.timeAgo)}
                </span>
              </div>
            </div>
            ${clubBadgeHtml}
          </header>

          ${titleHtml}

          <div class="post-detail-body">
            <p class="post-detail-text">${linkifyText(post.content)}</p>
            ${renderMediaGridHtml(post.images)}
          </div>

          ${tagsHtml}

          <footer class="post-detail-footer">
            <div class="post-detail-stat-pill">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              <span id="post-detail-comment-stat">${post.commentCount === 1 ? '1 comment' : `${post.commentCount || 0} comments`}</span>
            </div>
          </footer>
        </article>

        <!-- Discussion / Comments Section underneath Post -->
        <section class="post-comments-section" id="post-comments-section">
          <div class="comments-section-header">
            <h3 class="comments-section-title">
              Discussion
              <span class="comments-count-pill" id="post-detail-comments-badge">${post.commentCount || 0}</span>
            </h3>
            <span class="comments-sort-hint">Chronological · Oldest to newest</span>
          </div>

          <div class="comments-stream-list" id="post-comments-stream">
            ${commentsStreamHtml}
          </div>

          <div class="post-comment-composer-box" id="post-comment-composer-box">
            ${composerHtml}
          </div>
        </section>
      </div>
    `;

    // Attach textarea auto-expand and Enter key submission
    const commentInput = document.getElementById('post-detail-comment-input');
    const commentForm = document.getElementById('post-detail-comment-form');
    if (commentInput && commentForm) {
      commentInput.addEventListener('input', () => {
        commentInput.style.height = 'auto';
        commentInput.style.height = Math.min(commentInput.scrollHeight, 200) + 'px';
      });

      commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commentForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      });

      commentForm.addEventListener('submit', handleCommentSubmit);
    }
  }

  async function fetchCommentsForPost(postId) {
    if (!postId) return;
    const post = posts.find(p => p.id === postId);

    isCommentsLoading = true;
    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) {
      isCommentsLoading = false;
      refreshCommentsUI(post);
      return;
    }

    try {
      const { data: commentsData, error: commErr } = await supabase
        .from('comments')
        .select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (commErr) {
        console.warn('[UniVibe Feed] Error fetching comments:', commErr);
        activeComments = [];
        isCommentsLoading = false;
        refreshCommentsUI(post);
        return;
      }

      if (!commentsData || commentsData.length === 0) {
        activeComments = [];
        isCommentsLoading = false;
        if (post) post.commentCount = 0;
        refreshCommentsUI(post);
        return;
      }

      // Fetch profiles for comment authors
      const userIds = [...new Set(commentsData.map(c => c.user_id).filter(Boolean))];
      let profilesMap = {};
      if (userIds.length > 0) {
        try {
          const res = await supabase
            .from('profiles')
            .select('id, name, handle, avatar_url')
            .in('id', userIds);
          let profs = res.data;
          if (res.error && res.error.message && res.error.message.includes('avatar_url')) {
            const fallbackRes = await supabase
              .from('profiles')
              .select('id, name, handle')
              .in('id', userIds);
            profs = fallbackRes.data;
          }
          if (profs) {
            profs.forEach(p => { profilesMap[p.id] = p; });
          }
        } catch (e) {}
      }

      const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;

      activeComments = commentsData.map(c => {
        const prof = profilesMap[c.user_id];
        let name = '';
        let handle = '';
        if (prof && prof.name) {
          name = prof.name;
          handle = prof.handle ? prof.handle.replace(/^@/, '') : prof.name.toLowerCase().replace(/\s+/g, '');
        } else if (currentUser && currentUser.id === c.user_id) {
          name = currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Campus Member');
          handle = currentUser.handle ? currentUser.handle.replace(/^@/, '') : (currentUser.email ? currentUser.email.split('@')[0].toLowerCase() : `user_${c.user_id.slice(0, 6)}`);
        } else {
          name = 'Campus Member';
          handle = `user_${c.user_id ? c.user_id.slice(0, 6) : 'anon'}`;
        }

        const authorAvatar = (prof && prof.avatar_url) || (currentUser && currentUser.id === c.user_id ? currentUser.avatarUrl : null) || null;

        return {
          id: c.id,
          postId: c.post_id,
          userId: c.user_id,
          parentId: c.parent_id || null,
          content: c.content,
          createdAt: c.created_at,
          timeAgo: formatTimeAgo(c.created_at),
          author: {
            name,
            handle,
            avatarUrl: authorAvatar
          }
        };
      });

      if (post) {
        post.commentCount = activeComments.length;
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception fetching comments:', err);
    } finally {
      isCommentsLoading = false;
      refreshCommentsUI(post);
    }
  }

  function refreshCommentsUI(post) {
    if (activeFilter === 'post-detail' && activePostId) {
      const currentPost = post || posts.find(p => p.id === activePostId);
      const streamElem = document.getElementById('post-comments-stream');
      const statElem = document.getElementById('post-detail-comment-stat');
      const badgeElem = document.getElementById('post-detail-comments-badge');

      if (currentPost) {
        const count = currentPost.commentCount || 0;
        if (statElem) statElem.textContent = count === 1 ? '1 comment' : `${count} comments`;
        if (badgeElem) badgeElem.textContent = count;
      }

      if (streamElem) {
        if (isCommentsLoading) {
          streamElem.innerHTML = `<div class="comments-empty-state" style="opacity: 0.7;"><p>Loading comments...</p></div>`;
          return;
        }

        if (activeComments.length === 0) {
          streamElem.innerHTML = `
            <div class="comments-empty-state">
              <div class="comments-empty-icon" aria-hidden="true">💬</div>
              <h4>No comments yet</h4>
              <p>Be the first to share your thoughts in this discussion!</p>
            </div>
          `;
          return;
        }

        const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
        const currentUserId = currentUser ? currentUser.id : null;

        streamElem.innerHTML = renderCommentTreeHtml(activeComments, currentUserId, 'post');
      }
    }
  }

  async function handleCommentSubmit(e) {
    if (e) e.preventDefault();
    if (!activePostId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const input = document.getElementById('post-detail-comment-input');
    const submitBtn = document.getElementById('post-detail-comment-submit');
    if (!input) return;

    const content = input.value.trim();
    if (!content) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Posting...';
      }

      const { data, error } = await supabase
        .from('comments')
        .insert([{
          post_id: activePostId,
          user_id: currentUser.id,
          content: content
        }])
        .select();

      if (error) {
        console.error('[UniVibe Feed] Error inserting comment:', error);
        const isMissingTable = error.code === 'PGRST205' ||
          (error.message && (error.message.includes('relation "public.comments" does not exist') || error.message.includes('relation "comments" does not exist')));
        if (isMissingTable) {
          if (window.UniVibeToast) {
            window.UniVibeToast.show('Comments table setup required in Supabase.');
          }
        } else {
          if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to post comment.');
        }
        return;
      }

      input.value = '';
      input.style.height = 'auto';

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Comment posted! 💬');
      }

      await fetchCommentsForPost(activePostId);

      const commentsSection = document.getElementById('post-comments-section');
      if (commentsSection) {
        commentsSection.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception posting comment:', err);
      if (window.UniVibeToast) window.UniVibeToast.show('Failed to post comment.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Comment';
      }
    }
  }

  async function handleCommentDelete(commentId) {
    if (!commentId || !activePostId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) return;

    const confirmed = window.confirm('Are you sure you want to permanently delete this comment? This action cannot be undone.');
    if (!confirmed) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', currentUser.id);

      if (error) {
        console.error('[UniVibe Feed] Error deleting comment:', error);
        if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to delete comment.');
        return;
      }

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Comment deleted.');
      }

      await fetchCommentsForPost(activePostId);
    } catch (err) {
      console.error('[UniVibe Feed] Exception deleting comment:', err);
    }
  }

  // ==============================================================================
  // Dedicated Profile & My Posts Controller
  // ==============================================================================

  async function renderProfileView(container) {
    const isAuthed = window.UniVibeAuth && window.UniVibeAuth.isAuthenticated();
    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;

    if (!isAuthed || !currentUser || !currentUser.id) {
      container.innerHTML = `
        <div class="profile-page-wrapper">
          <div class="feed-empty-state">
            <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
              <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <h3 class="empty-state-title">Sign in to view your profile</h3>
            <p class="empty-state-subtitle">Customize your campus bio, view your posts, and track joined clubs and events.</p>
            <button class="btn-primary" style="margin-top: 14px;" onclick="UniVibeAuth.promptSignIn()">
              Sign In or Register
            </button>
          </div>
        </div>
      `;
      return;
    }

    const initials = getInitials(currentUser.name);
    const bioText = currentUser.bio ? escapeHtml(currentUser.bio) : '';

    // Filter campus-wide posts belonging to current user (club_id IS NULL)
    const myCampusPosts = posts.filter(p => p.userId === currentUser.id && !p.clubId);

    // Initial render of profile structure with current stats
    container.innerHTML = `
      <div class="profile-page-wrapper" id="profile-page-wrapper">
        <!-- Profile Header Card -->
        <section class="profile-hero-card">
          <div class="profile-header-main">
            <!-- Avatar Area with Profile Picture -->
            <div class="profile-avatar-wrap">
              <div class="profile-avatar-container">
                <div class="profile-avatar avatar-badge ${currentUser.avatarUrl ? 'has-avatar-img' : ''}" id="profile-main-avatar">
                  ${currentUser.avatarUrl 
                    ? `<img src="${escapeHtml(currentUser.avatarUrl)}" alt="${escapeHtml(currentUser.name)}" class="avatar-photo-img" onerror="this.onerror=null; this.parentElement.classList.remove('has-avatar-img'); this.parentElement.textContent='${escapeHtml(initials)}';">` 
                    : initials}
                </div>
                <div class="profile-avatar-upload-affordance" data-action="open-edit-profile" onclick="UniVibeFeed.openEditProfile(event)" title="Change profile picture" aria-label="Change profile picture" style="cursor: pointer;">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </div>
              </div>
            </div>

            <!-- Identity and Actions -->
            <div class="profile-details-wrap">
              <div class="profile-identity-top">
                <div class="profile-names-group">
                  <h1 class="profile-display-name" id="profile-display-name">${escapeHtml(currentUser.name)}</h1>
                  <span class="profile-display-handle" id="profile-display-handle">${escapeHtml((currentUser.handle || '').replace(/^@/, ''))}</span>
                </div>
                <button class="btn-edit-profile" data-action="open-edit-profile" onclick="UniVibeFeed.openEditProfile(event)" aria-label="Edit Profile">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  <span>Edit Profile</span>
                </button>
              </div>

              <!-- Bio -->
              <p class="profile-display-bio ${bioText ? '' : 'profile-bio-placeholder'}" id="profile-display-bio">
                ${bioText || 'No bio added yet.'}
              </p>
            </div>
          </div>

          <!-- Profile Stats Row -->
          <div class="profile-stats-row">
            <div class="profile-stat-card">
              <span class="profile-stat-number" id="profile-stat-posts">${myCampusPosts.length}</span>
              <span class="profile-stat-label">Posts</span>
            </div>
            <div class="profile-stat-card">
              <span class="profile-stat-number" id="profile-stat-clubs">...</span>
              <span class="profile-stat-label">Clubs</span>
            </div>
            <div class="profile-stat-card">
              <span class="profile-stat-number" id="profile-stat-events">...</span>
              <span class="profile-stat-label">Interested Events</span>
            </div>
          </div>
        </section>

        <!-- My Posts Section -->
        <section class="profile-my-posts-section">
          <div class="profile-my-posts-header">
            <div class="profile-my-posts-title-wrap">
              <h2 class="profile-my-posts-title">My Posts</h2>
              <span class="profile-posts-count-badge" id="profile-my-posts-count">${myCampusPosts.length}</span>
            </div>
            <button class="btn-primary" data-action="open-create" data-tab="post" style="padding: 6px 14px; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Share a Vibe</span>
            </button>
          </div>

          <div class="profile-my-posts-list" id="profile-my-posts-list">
            ${myCampusPosts.length === 0 ? `
              <div class="profile-posts-empty">
                <div class="empty-state-icon" aria-hidden="true" style="color: var(--accent-primary);">
                  <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                    <path d="M2 2l7.586 7.586"/>
                    <circle cx="11" cy="11" r="2"/>
                  </svg>
                </div>
                <h4 class="empty-state-title" style="font-family: var(--font-display); font-size: 1.1rem; font-weight: 700; margin: 10px 0 4px 0; color: var(--text-primary);">No posts yet.</h4>
                <p class="empty-state-subtitle" style="font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 14px 0;">Share your first campus vibe, question, or story with everyone.</p>
                <button class="btn-primary" style="margin-top: 4px;" data-action="open-create" data-tab="post">
                  Share a Vibe
                </button>
              </div>
            ` : myCampusPosts.map(renderSocialCard).join('')}
          </div>
        </section>
      </div>
    `;

    // Asynchronously update exact counts from Supabase
    fetchAndDisplayProfileStats(currentUser.id);
  }

  async function fetchAndDisplayProfileStats(userId) {
    const postsEl = document.getElementById('profile-stat-posts');
    const clubsEl = document.getElementById('profile-stat-clubs');
    const eventsEl = document.getElementById('profile-stat-events');
    const countBadge = document.getElementById('profile-my-posts-count');

    // Posts count: number of posts created by the current user
    let postsCount = posts.filter(p => p.userId === userId).length;
    let clubsCount = clubs.filter(c => c.isJoined).length;
    let eventsCount = Object.values(eventInterestsMap).filter(s => s === 'interested').length;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (supabase) {
      try {
        const [postsRes, clubsRes, eventsRes] = await Promise.all([
          supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', userId),
          supabase.from('club_members').select('*', { count: 'exact', head: true }).eq('user_id', userId),
          supabase.from('event_interests').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'interested')
        ]);

        if (postsRes && typeof postsRes.count === 'number') postsCount = postsRes.count;
        if (clubsRes && typeof clubsRes.count === 'number') clubsCount = clubsRes.count;
        if (eventsRes && typeof eventsRes.count === 'number') eventsCount = eventsRes.count;
      } catch (err) {
        console.warn('[UniVibe Feed] Error fetching exact profile stats from Supabase:', err);
      }
    }

    if (postsEl) postsEl.textContent = String(postsCount);
    if (clubsEl) clubsEl.textContent = String(clubsCount);
    if (eventsEl) eventsEl.textContent = String(eventsCount);
    if (countBadge) {
      const myCampusPostsCount = posts.filter(p => p.userId === userId && !p.clubId).length;
      countBadge.textContent = String(myCampusPostsCount);
    }
  }

  function setupEditProfileAvatar() {
    const uploadBtn = document.getElementById('btn-avatar-upload') || document.querySelector('.btn-avatar-upload');
    const avatarFileInput = document.getElementById('edit-profile-avatar-file');
    const avatarRemoveBtn = document.getElementById('btn-avatar-remove');
    const avatarPreview = document.getElementById('edit-profile-avatar-preview');

    if (uploadBtn && avatarFileInput) {
      uploadBtn.onclick = (e) => {
        e.preventDefault();
        avatarFileInput.value = '';
        avatarFileInput.click();
      };
    }

    if (avatarFileInput) {
      avatarFileInput.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const fileType = (file.type || '').toLowerCase();
        const fileName = (file.name || '').toLowerCase();
        const isImage = fileType.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(fileName);

        if (fileType.startsWith('video/')) {
          if (window.UniVibeToast) window.UniVibeToast.show('Video files are not allowed. Please choose a photo.');
          avatarFileInput.value = '';
          return;
        }

        if (!isImage) {
          if (window.UniVibeToast) window.UniVibeToast.show('Only image files (JPEG, PNG, WebP, GIF) are supported.');
          avatarFileInput.value = '';
          return;
        }

        try {
          let compressed;
          if (window.UniVibeMedia && typeof window.UniVibeMedia.compressImage === 'function') {
            compressed = await window.UniVibeMedia.compressImage(file, {
              maxWidth: 512,
              maxHeight: 512,
              quality: 0.85
            });
          } else {
            compressed = { blob: file, dataUrl: URL.createObjectURL(file) };
          }

          stagedAvatarFile = compressed.blob || file;
          stagedAvatarRemoved = false;

          if (avatarPreview) {
            avatarPreview.classList.add('has-avatar-img');
            avatarPreview.innerHTML = `<img src="${compressed.dataUrl}" alt="Avatar preview" class="avatar-photo-img" />`;
          }
          if (avatarRemoveBtn) {
            avatarRemoveBtn.style.display = 'inline-flex';
          }
        } catch (err) {
          console.error('[UniVibe Profile] Image processing notice:', err);
          try {
            const fallbackUrl = URL.createObjectURL(file);
            stagedAvatarFile = file;
            stagedAvatarRemoved = false;
            if (avatarPreview) {
              avatarPreview.classList.add('has-avatar-img');
              avatarPreview.innerHTML = `<img src="${fallbackUrl}" alt="Avatar preview" class="avatar-photo-img" />`;
            }
            if (avatarRemoveBtn) {
              avatarRemoveBtn.style.display = 'inline-flex';
            }
          } catch (fallbackErr) {
            if (window.UniVibeToast) window.UniVibeToast.show(err.message || 'Error processing image.');
          }
        } finally {
          avatarFileInput.value = '';
        }
      };
    }

    if (avatarRemoveBtn) {
      avatarRemoveBtn.onclick = (e) => {
        e.preventDefault();
        stagedAvatarFile = null;
        stagedAvatarRemoved = true;
        if (avatarFileInput) avatarFileInput.value = '';
        const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
        const initials = getInitials(currentUser ? currentUser.name : 'UV');
        if (avatarPreview) {
          avatarPreview.classList.remove('has-avatar-img');
          avatarPreview.textContent = initials;
        }
        avatarRemoveBtn.style.display = 'none';
      };
    }
  }

  function openEditProfileModal(e) {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const modal = document.getElementById('edit-profile-modal');
    if (!modal) return;
    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    if (!currentUser || currentUser.isGuest) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const nameInput = document.getElementById('edit-profile-name');
    const handleInput = document.getElementById('edit-profile-handle');
    const bioInput = document.getElementById('edit-profile-bio');
    const errBanner = document.getElementById('edit-profile-error');
    const bioCounter = document.getElementById('edit-profile-bio-counter');

    stagedAvatarFile = null;
    stagedAvatarRemoved = false;
    const avatarPreview = document.getElementById('edit-profile-avatar-preview');
    const avatarRemoveBtn = document.getElementById('btn-avatar-remove');
    const avatarFileInput = document.getElementById('edit-profile-avatar-file');
    if (avatarFileInput) avatarFileInput.value = '';

    setupEditProfileAvatar();

    if (avatarPreview) {
      if (currentUser.avatarUrl) {
        avatarPreview.classList.add('has-avatar-img');
        avatarPreview.innerHTML = `<img src="${escapeHtml(currentUser.avatarUrl)}" alt="Avatar preview" class="avatar-photo-img" onerror="this.onerror=null; this.parentElement.classList.remove('has-avatar-img'); this.parentElement.textContent='${escapeHtml(getInitials(currentUser.name))}';">`;
        if (avatarRemoveBtn) avatarRemoveBtn.style.display = 'inline-flex';
      } else {
        avatarPreview.classList.remove('has-avatar-img');
        avatarPreview.textContent = getInitials(currentUser.name);
        if (avatarRemoveBtn) avatarRemoveBtn.style.display = 'none';
      }
    }

    if (errBanner) {
      errBanner.style.display = 'none';
      errBanner.textContent = '';
    }

    if (nameInput) nameInput.value = currentUser.name || '';
    if (handleInput) handleInput.value = (currentUser.handle || '').replace(/^@/, '');
    if (bioInput) {
      bioInput.value = currentUser.bio || '';
      if (bioCounter) bioCounter.textContent = `${bioInput.value.length} / 250`;
    }

    modal.classList.add('open');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (nameInput) nameInput.focus();
  }

  function closeEditProfileModal() {
    const modal = document.getElementById('edit-profile-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  function onProfileUpdated(userId, name, handle, bio, avatarUrl) {
    const cleanHandle = (handle || '').replace(/^@/, '');
    posts.forEach(p => {
      if (p.userId === userId) {
        p.author.name = name;
        p.author.handle = cleanHandle;
        if (avatarUrl !== undefined) {
          p.author.avatarUrl = avatarUrl;
        }
      }
    });
    events.forEach(ev => {
      if (ev.userId === userId) {
        ev.creator.name = name;
        ev.creator.displayName = name;
        ev.creator.handle = cleanHandle;
        if (avatarUrl !== undefined) {
          ev.creator.avatarUrl = avatarUrl;
        }
      }
    });
    activeComments.forEach(c => {
      if (c.userId === userId) {
        c.author.name = name;
        c.author.handle = cleanHandle;
        if (avatarUrl !== undefined) {
          c.author.avatarUrl = avatarUrl;
        }
      }
    });
    activeEventComments.forEach(c => {
      if (c.userId === userId) {
        c.author.name = name;
        c.author.handle = cleanHandle;
        if (avatarUrl !== undefined) {
          c.author.avatarUrl = avatarUrl;
        }
      }
    });
    renderFeed();
  }

  // ==============================================================================
  // Ownership Deletion Handlers
  // ==============================================================================

  async function handlePostDelete(postId) {
    if (!postId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const post = posts.find(p => p.id === postId);
    if (!post) return;

    if (post.userId !== currentUser.id) {
      if (window.UniVibeToast) window.UniVibeToast.show('You can only delete posts you created.');
      return;
    }

    const confirmed = window.confirm('Are you sure you want to permanently delete this post? This action cannot be undone.');
    if (!confirmed) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('posts')
        .delete()
        .eq('id', postId)
        .eq('user_id', currentUser.id);

      if (error) {
        console.error('[UniVibe Feed] Error deleting post:', error);
        if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to delete post.');
        return;
      }

      const wasViewing = (activeFilter === 'post-detail' && activePostId === postId);
      const postClubId = post.clubId;
      posts = posts.filter(p => p.id !== postId);

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Post deleted.');
      }

      if (wasViewing) {
        if (postClubId) {
          navigateToClub(postClubId);
        } else {
          setFilter('all');
        }
      } else {
        renderFeed();
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception deleting post:', err);
      if (window.UniVibeToast) window.UniVibeToast.show('Failed to delete post.');
    }
  }

  async function handleEventDelete(eventId) {
    if (!eventId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const event = events.find(e => e.id === eventId);
    if (!event) return;

    if (event.userId !== currentUser.id) {
      if (window.UniVibeToast) window.UniVibeToast.show('You can only delete events you created.');
      return;
    }

    const confirmed = window.confirm('Are you sure you want to permanently delete this event? This action cannot be undone.');
    if (!confirmed) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', eventId)
        .eq('user_id', currentUser.id);

      if (error) {
        console.error('[UniVibe Feed] Error deleting event:', error);
        if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to delete event.');
        return;
      }

      const wasViewing = (activeFilter === 'event-detail' && activeEventId === eventId);
      events = events.filter(e => e.id !== eventId);
      delete eventInterestsMap[eventId];

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Event deleted.');
      }

      if (wasViewing) {
        setFilter('event');
      } else {
        renderFeed();
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception deleting event:', err);
      if (window.UniVibeToast) window.UniVibeToast.show('Failed to delete event.');
    }
  }

  async function handleClubDelete(clubId) {
    if (!clubId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const club = clubs.find(c => c.id === clubId);
    if (!club) return;

    if (club.createdBy !== currentUser.id) {
      if (window.UniVibeToast) window.UniVibeToast.show('You can only delete clubs you created.');
      return;
    }

    const confirmed = window.confirm('Are you sure you want to permanently delete this club? All posts and memberships in this club will also be deleted. This cannot be undone.');
    if (!confirmed) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('clubs')
        .delete()
        .eq('id', clubId)
        .eq('created_by', currentUser.id);

      if (error) {
        console.error('[UniVibe Feed] Error deleting club:', error);
        if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to delete club.');
        return;
      }

      const wasViewingClub = (activeFilter === 'club-community' && activeClubId === clubId);
      const wasViewingClubPost = (activeFilter === 'post-detail' && activePostId && posts.find(p => p.id === activePostId && p.clubId === clubId));

      clubs = clubs.filter(c => c.id !== clubId);
      posts = posts.filter(p => p.clubId !== clubId);
      updatePostClubSelect();

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Club deleted.');
      }

      if (wasViewingClub || wasViewingClubPost) {
        setFilter('clubs');
      } else {
        renderFeed();
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception deleting club:', err);
      if (window.UniVibeToast) window.UniVibeToast.show('Failed to delete club.');
    }
  }

  // ==============================================================================
  // Club Settings & Customisation (Owner Only)
  // ==============================================================================

  function openClubEdit(clubId) {
    if (!clubId) return;
    const club = clubs.find(c => c.id === clubId);
    if (!club) return;

    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    if (!currentUser || !currentUser.id || club.createdBy !== currentUser.id) {
      if (window.UniVibeToast) window.UniVibeToast.show('Only the club creator can edit club settings.');
      return;
    }

    const modal = document.getElementById('club-edit-modal');
    if (!modal) return;

    const idInput = document.getElementById('edit-club-id');
    const nameInput = document.getElementById('edit-club-name-input');
    const limitInput = document.getElementById('edit-club-limit-input');
    const countHint = document.getElementById('edit-club-current-count-hint');
    const logoPreview = document.getElementById('edit-club-logo-preview');
    const removeLogoBtn = document.getElementById('btn-edit-club-remove-logo');
    const fileInput = document.getElementById('edit-club-logo-input');

    if (idInput) idInput.value = club.id;
    if (nameInput) nameInput.value = club.name || '';
    if (limitInput) {
      limitInput.value = (club.memberLimit !== null && club.memberLimit !== undefined) ? club.memberLimit : '';
      limitInput.min = Math.max(1, club.memberCount || 1);
    }
    if (countHint) {
      countHint.textContent = `Current members: ${club.memberCount}`;
    }

    editStagedLogoFile = null;
    editStagedLogoRemoved = false;
    editStagedLogoDataUrl = null;
    if (fileInput) fileInput.value = '';

    const initials = getInitials(club.name);
    if (logoPreview) {
      if (club.logoUrl) {
        logoPreview.innerHTML = `<img src="${escapeHtml(club.logoUrl)}" style="width: 100%; height: 100%; object-fit: cover;" alt="${escapeHtml(club.name)}">`;
        if (removeLogoBtn) removeLogoBtn.style.display = 'inline-block';
      } else {
        logoPreview.innerHTML = `<span style="color: var(--accent-primary);">${initials}</span>`;
        if (removeLogoBtn) removeLogoBtn.style.display = 'none';
      }
    }

    modal.style.display = 'flex';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (nameInput) nameInput.focus();
  }

  function closeClubEdit() {
    const modal = document.getElementById('club-edit-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
    document.body.style.overflow = '';

    editStagedLogoFile = null;
    editStagedLogoRemoved = false;
    editStagedLogoDataUrl = null;
    const fileInput = document.getElementById('edit-club-logo-input');
    if (fileInput) fileInput.value = '';
  }

  let isClubEditHandlersBound = false;
  function setupClubEditHandlers() {
    if (isClubEditHandlersBound) return;
    isClubEditHandlersBound = true;

    const uploadBtn = document.getElementById('btn-edit-club-upload-logo');
    const removeBtn = document.getElementById('btn-edit-club-remove-logo');
    const fileInput = document.getElementById('edit-club-logo-input');
    const editForm = document.getElementById('form-edit-club');
    const logoPreview = document.getElementById('edit-club-logo-preview');
    const nameInput = document.getElementById('edit-club-name-input');

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => {
        fileInput.click();
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          if (window.UniVibeToast) window.UniVibeToast.show('Please select a valid image file (PNG, JPG, WebP).');
          fileInput.value = '';
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          if (window.UniVibeToast) window.UniVibeToast.show('Logo image must be under 10MB.');
          fileInput.value = '';
          return;
        }

        try {
          let processedBlob = file;
          if (window.UniVibeMedia && typeof window.UniVibeMedia.compressImage === 'function') {
            processedBlob = await window.UniVibeMedia.compressImage(file, { maxWidth: 600, maxHeight: 600, quality: 0.85 });
          }

          const reader = new FileReader();
          reader.onload = (ev) => {
            editStagedLogoFile = processedBlob;
            editStagedLogoDataUrl = ev.target.result;
            editStagedLogoRemoved = false;
            if (logoPreview) {
              logoPreview.innerHTML = `<img src="${ev.target.result}" style="width: 100%; height: 100%; object-fit: cover;" alt="Logo preview">`;
            }
            if (removeBtn) removeBtn.style.display = 'inline-block';
          };
          reader.readAsDataURL(processedBlob);
        } catch (err) {
          console.warn('[UniVibe Feed] Error processing club logo:', err);
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        editStagedLogoFile = null;
        editStagedLogoDataUrl = null;
        editStagedLogoRemoved = true;
        if (fileInput) fileInput.value = '';
        if (removeBtn) removeBtn.style.display = 'none';

        const clubId = document.getElementById('edit-club-id')?.value;
        const club = clubs.find(c => c.id === clubId);
        const nameVal = nameInput ? nameInput.value : (club ? club.name : '');
        const initials = getInitials(nameVal);
        if (logoPreview) {
          logoPreview.innerHTML = `<span style="color: var(--accent-primary);">${initials}</span>`;
        }
      });
    }

    if (editForm) {
      editForm.addEventListener('submit', handleClubEditSubmit);
    }
  }

  async function handleClubEditSubmit(e) {
    if (e) e.preventDefault();

    const saveBtn = document.getElementById('btn-save-club-edit');
    const clubIdInput = document.getElementById('edit-club-id');
    const nameInput = document.getElementById('edit-club-name-input');
    const limitInput = document.getElementById('edit-club-limit-input');

    const clubId = clubIdInput ? clubIdInput.value : null;
    if (!clubId) return;

    const club = clubs.find(c => c.id === clubId);
    if (!club) return;

    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    if (!currentUser || !currentUser.id || club.createdBy !== currentUser.id) {
      if (window.UniVibeToast) window.UniVibeToast.show('Only the club creator can edit club settings.');
      return;
    }

    const newName = (nameInput ? nameInput.value : '').trim();
    if (!newName) {
      if (window.UniVibeToast) window.UniVibeToast.show('Please enter a club name.');
      return;
    }

    const limitValStr = (limitInput ? limitInput.value : '').trim();
    let parsedLimit = null;
    if (limitValStr !== '') {
      parsedLimit = parseInt(limitValStr, 10);
      if (isNaN(parsedLimit) || parsedLimit <= 0) {
        if (window.UniVibeToast) window.UniVibeToast.show('Member limit must be a positive number greater than 0.');
        return;
      }
      if (parsedLimit < club.memberCount) {
        if (window.UniVibeToast) {
          window.UniVibeToast.show(`Member limit cannot be less than current member count (${club.memberCount}).`);
        }
        return;
      }
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
      return;
    }

    try {
      let updatedLogoUrl = club.logoUrl;

      if (editStagedLogoRemoved) {
        updatedLogoUrl = null;
      } else if (editStagedLogoFile) {
        if (saveBtn) saveBtn.textContent = 'Uploading logo...';
        try {
          if (window.UniVibeMedia && typeof window.UniVibeMedia.uploadMedia === 'function') {
            updatedLogoUrl = await window.UniVibeMedia.uploadMedia(currentUser.id, editStagedLogoFile, 'club_logo');
          } else if (editStagedLogoDataUrl) {
            updatedLogoUrl = editStagedLogoDataUrl;
          }
        } catch (uploadErr) {
          console.error('[UniVibe Feed] Error uploading club logo:', uploadErr);
          if (window.UniVibeToast) window.UniVibeToast.show('Failed to upload club logo. Please try again.');
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
          }
          return;
        }
      }

      const updatePayload = {
        name: newName,
        member_limit: parsedLimit,
        logo_url: updatedLogoUrl
      };

      const { error: updateErr } = await supabase
        .from('clubs')
        .update(updatePayload)
        .eq('id', clubId);

      if (updateErr) {
        console.error('[UniVibe Feed] Error updating club:', updateErr);
        if (window.UniVibeToast) {
          window.UniVibeToast.show(updateErr.message || 'Failed to update club settings.');
        }
        return;
      }

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Club updated successfully! ✨');
      }

      if (updatedLogoUrl) {
        window.UniVibeLocalMedia = window.UniVibeLocalMedia || {};
        window.UniVibeLocalMedia['club_' + clubId] = updatedLogoUrl;
        window.UniVibeLocalMedia[clubId] = updatedLogoUrl;
      } else if (editStagedLogoRemoved) {
        if (window.UniVibeLocalMedia) {
          delete window.UniVibeLocalMedia['club_' + clubId];
          delete window.UniVibeLocalMedia[clubId];
        }
      }

      closeClubEdit();
      await fetchClubs();

      if (activeFilter === 'club-community' && activeClubId === clubId) {
        await fetchClubMembers(clubId);
        renderFeed();
      }
    } catch (err) {
      console.error('[UniVibe Feed] Exception updating club:', err);
      if (window.UniVibeToast) {
        window.UniVibeToast.show('Failed to update club settings.');
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    }
  }

  function attachFeedEvents() {
    const feedContainer = document.getElementById('feed-stream');
    if (!feedContainer) return;

    feedContainer.addEventListener('click', (e) => {
      const likeBtn = e.target.closest('.btn-like');
      if (likeBtn) {
        if (window.UniVibeAuth && window.UniVibeAuth.isGuest()) {
          window.UniVibeAuth.promptSignIn();
        }
      }
    });

    document.addEventListener('click', (e) => {
      // Delete Post
      const deletePostBtn = e.target.closest('[data-action="delete-post"]');
      if (deletePostBtn) {
        e.preventDefault();
        e.stopPropagation();
        const postId = deletePostBtn.getAttribute('data-post-id');
        if (postId) {
          handlePostDelete(postId);
        }
        return;
      }

      // Delete Event
      const deleteEventBtn = e.target.closest('[data-action="delete-event"]');
      if (deleteEventBtn) {
        e.preventDefault();
        e.stopPropagation();
        const eventId = deleteEventBtn.getAttribute('data-event-id');
        if (eventId) {
          handleEventDelete(eventId);
        }
        return;
      }

      // Delete Club
      const deleteClubBtn = e.target.closest('[data-action="delete-club"]');
      if (deleteClubBtn) {
        e.preventDefault();
        e.stopPropagation();
        const clubId = deleteClubBtn.getAttribute('data-club-id');
        if (clubId) {
          handleClubDelete(clubId);
        }
        return;
      }

      // Open Club Edit Modal
      const openClubEditBtn = e.target.closest('[data-action="open-club-edit"]');
      if (openClubEditBtn) {
        e.preventDefault();
        e.stopPropagation();
        const clubId = openClubEditBtn.getAttribute('data-club-id') || activeClubId;
        if (clubId) {
          openClubEdit(clubId);
        }
        return;
      }

      // Close Club Edit Modal
      const closeClubEditBtn = e.target.closest('[data-action="close-club-edit"]');
      if (closeClubEditBtn) {
        e.preventDefault();
        closeClubEdit();
        return;
      }

      const clubEditModal = document.getElementById('club-edit-modal');
      if (clubEditModal && e.target === clubEditModal) {
        closeClubEdit();
        return;
      }

      const joinBtn = e.target.closest('[data-action="toggle-club-join"]');
      if (joinBtn) {
        e.preventDefault();
        e.stopPropagation();
        const clubId = joinBtn.getAttribute('data-club-id');
        toggleClubJoin(clubId);
        return;
      }

      const createClubPostBtn = e.target.closest('[data-action="open-create-club-post"]');
      if (createClubPostBtn) {
        e.preventDefault();
        const clubId = createClubPostBtn.getAttribute('data-club-id') || activeClubId;
        if (window.UniVibeAuth && window.UniVibeAuth.isGuest()) {
          window.UniVibeAuth.promptSignIn();
          return;
        }
        if (window.UniVibeCreate) {
          window.UniVibeCreate.openModal('post', clubId);
        }
        return;
      }

      const communityTrigger = e.target.closest('[data-action="open-club-community"], [data-action="open-club-detail"], .club-item-left');
      if (communityTrigger && !e.target.closest('[data-action="toggle-club-join"], [data-action="delete-club"], [data-action="open-club-edit"]')) {
        e.preventDefault();
        const clubId = communityTrigger.getAttribute('data-club-id') || (communityTrigger.closest('[data-club-id]') && communityTrigger.closest('[data-club-id]').getAttribute('data-club-id'));
        if (clubId) {
          navigateToClub(clubId);
          return;
        }
      }

      const clubCard = e.target.closest('.club-card');
      if (clubCard && !e.target.closest('button')) {
        e.preventDefault();
        const clubId = clubCard.getAttribute('data-club-id');
        if (clubId) {
          navigateToClub(clubId);
          return;
        }
      }

      const closeDetailBtn = e.target.closest('[data-action="close-club-detail"]');
      if (closeDetailBtn) {
        e.preventDefault();
        closeClubDetail();
        return;
      }

      const clubDetailModal = document.getElementById('club-detail-modal');
      if (clubDetailModal && e.target === clubDetailModal) {
        closeClubDetail();
        return;
      }

      // Event interest action (Interested / Not Interested)
      const interestBtn = e.target.closest('[data-action="toggle-interest"]');
      if (interestBtn) {
        e.preventDefault();
        e.stopPropagation();
        const eventId = interestBtn.getAttribute('data-event-id');
        const status = interestBtn.getAttribute('data-status');
        if (eventId && status) {
          toggleEventInterest(eventId, status);
        }
        return;
      }

      // Event Detail Navigation (Discovery Card Click)
      const openEventTrigger = e.target.closest('[data-action="open-event"], .event-discovery-card');
      if (openEventTrigger && !e.target.closest('[data-action="toggle-interest"], button')) {
        e.preventDefault();
        const eventId = openEventTrigger.getAttribute('data-event-id') || openEventTrigger.id.replace('event-', '');
        if (eventId) {
          navigateToEvent(eventId);
          return;
        }
      }

      // Back navigation from event view
      const backFromEventBtn = e.target.closest('[data-action="back-from-event"]');
      if (backFromEventBtn) {
        e.preventDefault();
        setFilter('event');
        return;
      }

      // Event comment deletion
      const deleteEventCommentBtn = e.target.closest('[data-action="delete-event-comment"]');
      if (deleteEventCommentBtn) {
        e.preventDefault();
        e.stopPropagation();
        const commentId = deleteEventCommentBtn.getAttribute('data-comment-id');
        if (commentId) {
          handleEventCommentDelete(commentId);
        }
        return;
      }

      // Post Detail Navigation & Triggers
      const openPostTrigger = e.target.closest('[data-action="open-post"], .post-card.social-card');
      if (openPostTrigger && !e.target.closest('button.btn-like, [data-action="toggle-club-join"], [data-action="toggle-interest"], [data-action="delete-post"], [data-action="delete-event"], [data-action="delete-club"], [data-action="open-club-edit"]')) {
        e.preventDefault();
        const postId = openPostTrigger.getAttribute('data-post-id') || openPostTrigger.id;
        if (postId) {
          navigateToPost(postId);
          return;
        }
      }

      // Back navigation from post view
      const backFromPostBtn = e.target.closest('[data-action="back-from-post"]');
      if (backFromPostBtn) {
        e.preventDefault();
        const clubId = backFromPostBtn.getAttribute('data-club-id');
        if (clubId) {
          navigateToClub(clubId);
        } else {
          setFilter('all');
        }
        return;
      }

      // Comment deletion
      const deleteCommentBtn = e.target.closest('[data-action="delete-comment"]');
      if (deleteCommentBtn) {
        e.preventDefault();
        e.stopPropagation();
        const commentId = deleteCommentBtn.getAttribute('data-comment-id');
        if (commentId) {
          handleCommentDelete(commentId);
        }
        return;
      }

      // Open reply composer for post comment
      const openPostReplyBtn = e.target.closest('[data-action="open-post-reply"]');
      if (openPostReplyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const commentId = openPostReplyBtn.getAttribute('data-comment-id');
        const authorName = openPostReplyBtn.getAttribute('data-author-name') || 'Commenter';
        if (commentId) {
          openInlineReplyComposer(commentId, authorName, 'post');
        }
        return;
      }

      // Open reply composer for event comment
      const openEventReplyBtn = e.target.closest('[data-action="open-event-reply"]');
      if (openEventReplyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const commentId = openEventReplyBtn.getAttribute('data-comment-id');
        const authorName = openEventReplyBtn.getAttribute('data-author-name') || 'Commenter';
        if (commentId) {
          openInlineReplyComposer(commentId, authorName, 'event');
        }
        return;
      }

      // Cancel inline reply
      const cancelReplyBtn = e.target.closest('[data-action="cancel-reply"]');
      if (cancelReplyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const commentId = cancelReplyBtn.getAttribute('data-comment-id');
        if (commentId) {
          closeInlineReplyComposer(commentId);
        }
        return;
      }

      // Open / Close Edit Profile
      const openEditProfileBtn = e.target.closest('[data-action="open-edit-profile"]');
      if (openEditProfileBtn) {
        e.preventDefault();
        openEditProfileModal();
        return;
      }

      const closeEditProfileBtn = e.target.closest('[data-action="close-edit-profile"]');
      if (closeEditProfileBtn) {
        e.preventDefault();
        closeEditProfileModal();
        return;
      }

      const editProfileModal = document.getElementById('edit-profile-modal');
      if (editProfileModal && e.target === editProfileModal) {
        closeEditProfileModal();
        return;
      }
    });

    // Bio character counter
    const editBioInput = document.getElementById('edit-profile-bio');
    const editBioCounter = document.getElementById('edit-profile-bio-counter');
    if (editBioInput && editBioCounter) {
      editBioInput.addEventListener('input', () => {
        editBioCounter.textContent = `${editBioInput.value.length} / 250`;
      });
    }

    // Setup Edit Profile Avatar management
    setupEditProfileAvatar();

    // Setup Edit Club Settings & Logo management
    setupClubEditHandlers();

    // Edit Profile form submission
    const editProfileForm = document.getElementById('form-edit-profile');
    if (editProfileForm) {
      editProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveBtn = document.getElementById('btn-save-profile');
        const errBanner = document.getElementById('edit-profile-error');
        const nameInput = document.getElementById('edit-profile-name');
        const handleInput = document.getElementById('edit-profile-handle');
        const bioInput = document.getElementById('edit-profile-bio');

        if (errBanner) {
          errBanner.style.display = 'none';
          errBanner.textContent = '';
        }

        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
        }

        try {
          const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
          let newAvatarUrl = undefined;

          if (stagedAvatarRemoved) {
            newAvatarUrl = null;
          } else if (stagedAvatarFile && currentUser && currentUser.id) {
            if (saveBtn) saveBtn.textContent = 'Uploading picture...';
            if (window.UniVibeMedia && typeof window.UniVibeMedia.uploadAvatar === 'function') {
              newAvatarUrl = await window.UniVibeMedia.uploadAvatar(currentUser.id, stagedAvatarFile);
            }
          }

          await window.UniVibeAuth.updateProfile({
            name: nameInput ? nameInput.value : '',
            handle: handleInput ? handleInput.value : '',
            bio: bioInput ? bioInput.value : '',
            ...(newAvatarUrl !== undefined ? { avatarUrl: newAvatarUrl } : {})
          });

          stagedAvatarFile = null;
          stagedAvatarRemoved = false;

          closeEditProfileModal();
          if (window.UniVibeToast) window.UniVibeToast.show('Profile updated! ✨');

          if (activeFilter === 'profile') {
            renderFeed();
          }
        } catch (err) {
          console.error('[UniVibe Feed] Error updating profile:', err);
          if (errBanner) {
            errBanner.textContent = err.message || 'Failed to update profile. Please try again.';
            errBanner.style.display = 'block';
          }
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
          }
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const clubDetailModal = document.getElementById('club-detail-modal');
        if (clubDetailModal && clubDetailModal.classList.contains('open')) {
          closeClubDetail();
        }
        const clubEditModal = document.getElementById('club-edit-modal');
        if (clubEditModal && clubEditModal.classList.contains('open')) {
          closeClubEdit();
        }
        const editProfileModal = document.getElementById('edit-profile-modal');
        if (editProfileModal && editProfileModal.classList.contains('open')) {
          closeEditProfileModal();
        }
        if (activeFilter === 'post-detail' && activePostId) {
          const post = posts.find(p => p.id === activePostId);
          if (post && post.clubId) {
            navigateToClub(post.clubId);
          } else {
            setFilter('all');
          }
        }
        if (activeFilter === 'event-detail') {
          setFilter('event');
        }
      }
    });
  }

  function attachFilterEvents() {
    const filterButtons = document.querySelectorAll('[data-filter]');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.getAttribute('data-filter');
        activeClubId = null;
        activeEventId = null;
        renderFeed();
      });
    });
  }

  function setFilter(filterName) {
    if (filterName !== 'club-community') {
      activeClubId = null;
    }
    if (filterName !== 'post-detail') {
      activePostId = null;
    }
    if (filterName !== 'event-detail') {
      activeEventId = null;
    }
    activeFilter = filterName;

    if (filterName === 'clubs' && window.location.hash !== '#clubs') {
      window.location.hash = '#clubs';
    } else if (filterName === 'event' && window.location.hash !== '#events') {
      window.location.hash = '#events';
    } else if (filterName === 'profile' && window.location.hash !== '#profile') {
      window.location.hash = '#profile';
    } else if (filterName === 'all' && window.location.hash && window.location.hash !== '#home') {
      window.location.hash = '#home';
    }

    const filterButtons = document.querySelectorAll('[data-filter]');
    filterButtons.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-filter') === filterName);
    });

    const navItems = document.querySelectorAll('.nav-item-link, .bottom-nav-item');
    navItems.forEach(item => {
      const href = item.getAttribute('href');
      if ((filterName === 'event' || filterName === 'event-detail') && href === '#events') {
        item.classList.add('active');
      } else if ((filterName === 'clubs' || filterName === 'club-community') && href === '#clubs') {
        item.classList.add('active');
      } else if (filterName === 'profile' && href === '#profile') {
        item.classList.add('active');
      } else if (filterName === 'all' && (href === '#home' || !href)) {
        item.classList.add('active');
      } else if (href === `#${filterName}`) {
        item.classList.add('active');
      } else if (href === '#home' || href === '#events' || href === '#clubs' || href === '#profile') {
        item.classList.remove('active');
      }
    });

    renderFeed();
  }

  return {
    init,
    fetchPosts,
    fetchEvents,
    fetchClubs,
    setFilter,
    navigateToClub,
    navigateToPost,
    navigateToEvent,
    getActiveClubId: () => activeClubId,
    getActivePostId: () => activePostId,
    getActiveEventId: () => activeEventId,
    toggleClubJoin,
    openClubDetail,
    closeClubDetail,
    openClubEdit,
    closeClubEdit,
    fetchClubMembers,
    openDiscussion: (postId) => navigateToPost(postId),
    closeDiscussion: () => {
      const post = posts.find(p => p.id === activePostId);
      if (post && post.clubId) {
        navigateToClub(post.clubId);
      } else {
        setFilter('all');
      }
    },
    fetchPosts,
    fetchEvents,
    fetchCommentsForPost,
    fetchCommentsForEvent,
    toggleEventInterest,
    getEventInterests: () => eventInterestsMap,
    getPosts: () => posts,
    getEvents: () => events,
    getClubs: () => clubs,
    getInitials,
    renderEventCard,
    renderSocialCard,
    renderProfileView,
    openEditProfile: openEditProfileModal,
    closeEditProfile: closeEditProfileModal,
    onProfileUpdated,
    handlePostDelete,
    handleEventDelete,
    handleClubDelete,
    handleCommentDelete,
    handleEventCommentDelete,
    buildCommentTree,
    renderCommentTreeHtml,
    openInlineReplyComposer,
    closeInlineReplyComposer,
    handleReplySubmit
  };
})();

window.UniVibeFeed = UniVibeFeed;
window.UniVibeDiscussion = {
  open: (postId) => UniVibeFeed.navigateToPost(postId),
  close: () => UniVibeFeed.closeDiscussion()
};
window.UniVibeEventDiscussion = {
  open: (eventId) => UniVibeFeed.navigateToEvent(eventId),
  close: () => UniVibeFeed.setFilter('event')
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', UniVibeFeed.init);
} else {
  UniVibeFeed.init();
}
