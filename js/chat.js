/**
 * UniVibe: General Campus Chat Controller
 * Manages message fetching, real-time updates via Supabase Realtime,
 * message creation, deletion, and responsive UI rendering.
 */

const UniVibeChat = (() => {
  let messages = [];
  let isLoading = false;
  let fetchError = null;
  let realtimeChannel = null;
  let containerRef = null;
  let isNearBottom = true;
  let profileCache = {};
  const knownMessageIds = new Set();
  let hasPendingRealtimeBelow = false;

  /**
   * Escape HTML to prevent XSS injection
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Generates 1-2 character uppercase initials from a name
   */
  function getInitials(name) {
    if (!name || typeof name !== 'string') return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  /**
   * Formats ISO timestamp to local readable time (e.g. "10:42 AM")
   */
  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  /**
   * Formats ISO timestamp to calendar date label for separators (e.g. "Today", "Yesterday", "Oct 4")
   */
  function formatDaySeparator(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);

      if (d.toDateString() === today.toDateString()) {
        return 'Today';
      }
      if (d.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
    } catch (e) {
      return '';
    }
  }

  /**
   * Renders the avatar element (photo or styled initials)
   */
  function renderAvatarHtml(name, avatarUrl) {
    const initials = getInitials(name);
    if (avatarUrl) {
      return `
        <div class="chat-msg-avatar">
          <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" onerror="this.onerror=null; this.parentElement.textContent='${escapeHtml(initials)}';">
        </div>
      `;
    }
    return `<div class="chat-msg-avatar">${escapeHtml(initials)}</div>`;
  }

  /**
   * Resolves a user's profile from cache or queries the profiles table
   */
  async function resolveUserProfile(userId) {
    if (!userId) return null;
    if (profileCache[userId]) return profileCache[userId];

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, handle, avatar_url')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        profileCache[userId] = {
          name: data.name || 'Campus Member',
          handle: data.handle ? data.handle.replace(/^@/, '') : 'member',
          avatarUrl: data.avatar_url || null
        };
        return profileCache[userId];
      }
    } catch (err) {
      console.warn('[UniVibe Chat] Error resolving profile for user:', userId, err);
    }

    const fallback = { name: 'Campus Member', handle: 'member', avatarUrl: null };
    profileCache[userId] = fallback;
    return fallback;
  }

  /**
   * Fetches the 100 most recent general chat messages ordered oldest -> newest
   */
  async function fetchMessages() {
    if (messages.length === 0) {
      isLoading = true;
    }
    fetchError = null;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) {
      isLoading = false;
      return;
    }

    try {
      // 1. Attempt relational join with profiles
      let res = await supabase
        .from('chat_messages')
        .select('id, user_id, room, content, created_at, profiles(id, name, handle, avatar_url)')
        .eq('room', 'general')
        .order('created_at', { ascending: true })
        .limit(100);

      // 2. Fallback to basic query if foreign key join is not yet linked
      if (res.error && (res.error.code === 'PGRST200' || res.error.message.includes('relationship'))) {
        res = await supabase
          .from('chat_messages')
          .select('id, user_id, room, content, created_at')
          .eq('room', 'general')
          .order('created_at', { ascending: true })
          .limit(100);
      }

      if (res.error) {
        fetchError = res.error;
        console.warn('[UniVibe Chat] Notice fetching messages:', res.error);
        messages = [];
        return;
      }

      const rows = res.data || [];
      knownMessageIds.clear();

      // Collect user_ids needing profile lookups if not joined
      const missingUserIds = [];
      rows.forEach(r => {
        knownMessageIds.add(r.id);
        if (r.profiles) {
          profileCache[r.user_id] = {
            name: r.profiles.name || 'Campus Member',
            handle: r.profiles.handle ? r.profiles.handle.replace(/^@/, '') : 'member',
            avatarUrl: r.profiles.avatar_url || null
          };
        } else if (!profileCache[r.user_id]) {
          missingUserIds.push(r.user_id);
        }
      });

      // Batch query missing profiles
      if (missingUserIds.length > 0) {
        try {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, name, handle, avatar_url')
            .in('id', [...new Set(missingUserIds)]);

          if (profs) {
            profs.forEach(p => {
              profileCache[p.id] = {
                name: p.name || 'Campus Member',
                handle: p.handle ? p.handle.replace(/^@/, '') : 'member',
                avatarUrl: p.avatar_url || null
              };
            });
          }
        } catch (e) {
          console.warn('[UniVibe Chat] Batch profile fetch note:', e);
        }
      }

      // Map rows to normalized message objects
      messages = rows.map(r => {
        const author = profileCache[r.user_id] || {
          name: 'Campus Member',
          handle: 'member',
          avatarUrl: null
        };
        return {
          id: r.id,
          userId: r.user_id,
          room: r.room,
          content: r.content,
          createdAt: r.created_at,
          author: author
        };
      });
    } catch (err) {
      console.error('[UniVibe Chat] Exception fetching messages:', err);
      fetchError = err;
    } finally {
      isLoading = false;
    }
  }

  /**
   * Subscribes to Supabase Realtime for INSERT and DELETE events
   */
  function subscribeRealtime() {
    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    // Teardown existing channel if any
    if (realtimeChannel) {
      try {
        supabase.removeChannel(realtimeChannel);
      } catch (e) {}
      realtimeChannel = null;
    }

    const dotElem = document.getElementById('chat-live-dot');
    const statusTextElem = document.getElementById('chat-status-text');

    realtimeChannel = supabase.channel('univibe-general-chat-room')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: 'room=eq.general'
      }, async (payload) => {
        const newRow = payload.new;
        if (!newRow || !newRow.id) return;

        // Skip if message was already handled (e.g. from local optimistic insert)
        if (knownMessageIds.has(newRow.id)) return;
        knownMessageIds.add(newRow.id);

        const author = await resolveUserProfile(newRow.user_id);
        const newMsg = {
          id: newRow.id,
          userId: newRow.user_id,
          room: newRow.room,
          content: newRow.content,
          createdAt: newRow.created_at,
          author: author || { name: 'Campus Member', handle: 'member', avatarUrl: null }
        };

        messages.push(newMsg);
        appendMessageToDom(newMsg);
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'chat_messages'
      }, (payload) => {
        const deletedId = payload.old ? payload.old.id : null;
        if (!deletedId) return;

        knownMessageIds.delete(deletedId);
        messages = messages.filter(m => m.id !== deletedId);
        removeMessageFromDom(deletedId);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (dotElem) {
            dotElem.className = 'chat-live-dot';
            dotElem.title = 'Live Realtime Connected';
          }
          if (statusTextElem) {
            statusTextElem.textContent = 'Live campus stream';
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (dotElem) {
            dotElem.className = 'chat-live-dot error';
            dotElem.title = 'Connection interrupted';
          }
          if (statusTextElem) {
            statusTextElem.textContent = 'Reconnecting...';
          }
        } else {
          if (dotElem) {
            dotElem.className = 'chat-live-dot connecting';
          }
          if (statusTextElem) {
            statusTextElem.textContent = 'Connecting...';
          }
        }
      });
  }

  /**
   * Unsubscribes from Realtime channel on cleanup
   */
  function cleanup() {
    if (realtimeChannel) {
      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (supabase) {
        try {
          supabase.removeChannel(realtimeChannel);
        } catch (e) {}
      }
      realtimeChannel = null;
    }
    containerRef = null;
    hasPendingRealtimeBelow = false;
  }

  /**
   * Appends a newly arrived message to the DOM stream
   */
  function appendMessageToDom(msg) {
    const stream = document.getElementById('chat-messages-stream');
    if (!stream) return;

    // Remove empty state if present
    const emptyState = stream.querySelector('.chat-empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    const isOwn = Boolean(currentUser && currentUser.id && msg.userId === currentUser.id);

    // Check if we need a day separator
    const lastMsgElem = stream.querySelector('.chat-msg-row:last-of-type');
    const lastTime = lastMsgElem ? lastMsgElem.getAttribute('data-created-at') : null;
    const currentDay = formatDaySeparator(msg.createdAt);
    const lastDay = lastTime ? formatDaySeparator(lastTime) : null;

    if (currentDay && currentDay !== lastDay) {
      const sep = document.createElement('div');
      sep.className = 'chat-date-separator';
      sep.innerHTML = `<span>${escapeHtml(currentDay)}</span>`;
      stream.appendChild(sep);
    }

    const row = document.createElement('div');
    row.className = `chat-msg-row ${isOwn ? 'chat-msg-own' : 'chat-msg-other'}`;
    row.id = `chat-msg-${escapeHtml(msg.id)}`;
    row.setAttribute('data-msg-id', msg.id);
    row.setAttribute('data-created-at', msg.createdAt);

    const authorName = msg.author?.name || 'Campus Member';
    const authorHandle = msg.author?.handle ? msg.author.handle.replace(/^@/, '') : '';
    const avatarHtml = renderAvatarHtml(authorName, msg.author?.avatarUrl);
    const timeStr = formatTime(msg.createdAt);

    row.innerHTML = `
      ${!isOwn ? avatarHtml : ''}
      <div class="chat-msg-bubble-wrap">
        <div class="chat-msg-meta">
          ${!isOwn ? `<strong class="chat-msg-author">${escapeHtml(authorName)}</strong>` : ''}
          ${!isOwn && authorHandle ? `<span class="chat-msg-handle">${escapeHtml(authorHandle)}</span>` : ''}
          <span class="chat-msg-time">${escapeHtml(timeStr)}</span>
        </div>
        <div class="chat-msg-bubble">
          <div class="chat-msg-text">${escapeHtml(msg.content)}</div>
          ${isOwn ? `
            <button type="button" class="chat-msg-delete-btn" data-action="delete-chat-msg" data-msg-id="${escapeHtml(msg.id)}" title="Delete message" aria-label="Delete message">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          ` : ''}
        </div>
      </div>
      ${isOwn ? avatarHtml : ''}
    `;

    stream.appendChild(row);

    // Scroll to bottom if near bottom; otherwise show "New messages" pill
    if (isNearBottom || isOwn) {
      scrollToBottom(true);
    } else {
      showNewMessagesPill();
    }
  }

  /**
   * Removes a deleted message from the DOM
   */
  function removeMessageFromDom(messageId) {
    const row = document.getElementById(`chat-msg-${messageId}`);
    if (row) {
      row.style.transition = 'opacity 0.2s, transform 0.2s';
      row.style.opacity = '0';
      row.style.transform = 'translateY(4px)';
      setTimeout(() => {
        if (row.parentNode) row.parentNode.removeChild(row);
        // If stream is now empty, re-render empty state
        const stream = document.getElementById('chat-messages-stream');
        if (stream && stream.querySelectorAll('.chat-msg-row').length === 0) {
          renderMessagesList(stream);
        }
      }, 200);
    }
  }

  /**
   * Scrolls the message stream to the bottom
   */
  function scrollToBottom(smooth = false) {
    const stream = document.getElementById('chat-messages-stream');
    if (!stream) return;
    if (smooth) {
      stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' });
    } else {
      stream.scrollTop = stream.scrollHeight;
    }
    hideNewMessagesPill();
  }

  /**
   * Shows the floating "New messages ↓" button
   */
  function showNewMessagesPill() {
    hasPendingRealtimeBelow = true;
    const pill = document.getElementById('chat-new-messages-pill');
    if (pill) {
      pill.style.display = 'inline-flex';
    }
  }

  /**
   * Hides the floating "New messages ↓" button
   */
  function hideNewMessagesPill() {
    hasPendingRealtimeBelow = false;
    const pill = document.getElementById('chat-new-messages-pill');
    if (pill) {
      pill.style.display = 'none';
    }
  }

  /**
   * Handles scroll position tracking in the messages container
   */
  function handleStreamScroll() {
    const stream = document.getElementById('chat-messages-stream');
    if (!stream) return;
    const threshold = 80;
    const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    isNearBottom = distanceFromBottom <= threshold;

    if (isNearBottom && hasPendingRealtimeBelow) {
      hideNewMessagesPill();
    }
  }

  /**
   * Sends a message via Supabase
   */
  async function sendMessage(content) {
    if (!content || !content.trim()) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      if (window.UniVibeAuth) window.UniVibeAuth.promptSignIn();
      return;
    }

    const trimmed = content.trim();
    if (trimmed.length > 1000) {
      if (window.UniVibeToast) window.UniVibeToast.show('Message must be 1,000 characters or fewer.');
      return;
    }

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    const textarea = document.getElementById('chat-input-textarea');
    const sendBtn = document.getElementById('chat-send-btn');

    if (sendBtn) sendBtn.disabled = true;

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert([{
          user_id: currentUser.id,
          room: 'general',
          content: trimmed
        }])
        .select('id, user_id, room, content, created_at')
        .single();

      if (error) {
        console.error('[UniVibe Chat] Error inserting message:', error);
        const isMissingTable = error.code === 'PGRST205' ||
          (error.message && (error.message.includes('chat_messages') || error.message.includes('relation "public.chat_messages"')));
        if (isMissingTable) {
          if (window.UniVibeToast) {
            window.UniVibeToast.show('Chat database setup required. Please run schema_chat.sql in Supabase.');
          }
        } else {
          if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to send message.');
        }
        return;
      }

      if (data) {
        knownMessageIds.add(data.id);
        const newMsg = {
          id: data.id,
          userId: data.user_id,
          room: data.room,
          content: data.content,
          createdAt: data.created_at,
          author: {
            name: currentUser.name || 'Campus Member',
            handle: currentUser.handle ? currentUser.handle.replace(/^@/, '') : 'member',
            avatarUrl: currentUser.avatarUrl || null
          }
        };

        messages.push(newMsg);
        appendMessageToDom(newMsg);

        if (textarea) {
          textarea.value = '';
          textarea.style.height = 'auto';
          textarea.focus();
        }
      }
    } catch (err) {
      console.error('[UniVibe Chat] Exception sending message:', err);
      if (window.UniVibeToast) window.UniVibeToast.show('Failed to send message.');
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  /**
   * Deletes a user's own message
   */
  async function deleteMessage(messageId) {
    if (!messageId) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      return;
    }

    const currentUser = window.UniVibeAuth.getCurrentUser();
    if (!currentUser || !currentUser.id) return;

    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.userId !== currentUser.id) {
      if (window.UniVibeToast) window.UniVibeToast.show('You can only delete your own messages.');
      return;
    }

    const confirmed = window.confirm('Delete this message?');
    if (!confirmed) return;

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('id', messageId)
        .eq('user_id', currentUser.id);

      if (error) {
        console.error('[UniVibe Chat] Error deleting message:', error);
        if (window.UniVibeToast) window.UniVibeToast.show(error.message || 'Failed to delete message.');
        return;
      }

      knownMessageIds.delete(messageId);
      messages = messages.filter(m => m.id !== messageId);
      removeMessageFromDom(messageId);

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Message deleted.');
      }
    } catch (err) {
      console.error('[UniVibe Chat] Exception deleting message:', err);
    }
  }

  /**
   * Renders the messages list HTML
   */
  function renderMessagesList(streamContainer) {
    if (!streamContainer) return;

    if (isLoading && messages.length === 0) {
      streamContainer.innerHTML = `
        <div class="chat-empty-state" style="opacity: 0.7;">
          <div class="chat-empty-icon" aria-hidden="true">💬</div>
          <h3>Connecting to General Chat...</h3>
          <p>Loading the latest campus vibes.</p>
        </div>
      `;
      return;
    }

    if (fetchError && messages.length === 0) {
      const isMissingTable = fetchError.code === 'PGRST205' ||
        (fetchError.message && (fetchError.message.includes('chat_messages') || fetchError.message.includes('relation "public.chat_messages"')));
      if (isMissingTable) {
        streamContainer.innerHTML = `
          <div class="chat-empty-state">
            <div class="chat-empty-icon" aria-hidden="true" style="color: var(--accent-primary);">⚠️</div>
            <h3>Chat Database Setup Required</h3>
            <p>Please run <code>schema_chat.sql</code> in your Supabase SQL Editor to enable live campus chat.</p>
          </div>
        `;
        return;
      }

      streamContainer.innerHTML = `
        <div class="chat-empty-state">
          <div class="chat-empty-icon" aria-hidden="true">💬</div>
          <h3>Could not load messages</h3>
          <p>${escapeHtml(fetchError.message || 'Please check your connection and try again.')}</p>
          <button class="btn-secondary" style="margin-top: 12px;" onclick="UniVibeChat.refresh()">Try Again</button>
        </div>
      `;
      return;
    }

    if (messages.length === 0) {
      streamContainer.innerHTML = `
        <div class="chat-empty-state">
          <div class="chat-empty-icon" aria-hidden="true">💬</div>
          <h3>Welcome to General Chat!</h3>
          <p>This is the campus-wide room for all students. Say hello, ask questions, or share what's happening around campus.</p>
        </div>
      `;
      return;
    }

    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    let html = '';
    let lastDay = null;

    messages.forEach(msg => {
      const isOwn = Boolean(currentUser && currentUser.id && msg.userId === currentUser.id);
      const currentDay = formatDaySeparator(msg.createdAt);

      if (currentDay && currentDay !== lastDay) {
        html += `
          <div class="chat-date-separator">
            <span>${escapeHtml(currentDay)}</span>
          </div>
        `;
        lastDay = currentDay;
      }

      const authorName = msg.author?.name || 'Campus Member';
      const authorHandle = msg.author?.handle ? msg.author.handle.replace(/^@/, '') : '';
      const avatarHtml = renderAvatarHtml(authorName, msg.author?.avatarUrl);
      const timeStr = formatTime(msg.createdAt);

      html += `
        <div class="chat-msg-row ${isOwn ? 'chat-msg-own' : 'chat-msg-other'}" id="chat-msg-${escapeHtml(msg.id)}" data-msg-id="${escapeHtml(msg.id)}" data-created-at="${escapeHtml(msg.createdAt)}">
          ${!isOwn ? avatarHtml : ''}
          <div class="chat-msg-bubble-wrap">
            <div class="chat-msg-meta">
              ${!isOwn ? `<strong class="chat-msg-author">${escapeHtml(authorName)}</strong>` : ''}
              ${!isOwn && authorHandle ? `<span class="chat-msg-handle">${escapeHtml(authorHandle)}</span>` : ''}
              <span class="chat-msg-time">${escapeHtml(timeStr)}</span>
            </div>
            <div class="chat-msg-bubble">
              <div class="chat-msg-text">${escapeHtml(msg.content)}</div>
              ${isOwn ? `
                <button type="button" class="chat-msg-delete-btn" data-action="delete-chat-msg" data-msg-id="${escapeHtml(msg.id)}" title="Delete message" aria-label="Delete message">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              ` : ''}
            </div>
          </div>
          ${isOwn ? avatarHtml : ''}
        </div>
      `;
    });

    streamContainer.innerHTML = html;
  }

  /**
   * Renders the chat footer (authenticated composer or guest sign-in banner)
   */
  function renderFooterHtml() {
    const isAuthed = window.UniVibeAuth && window.UniVibeAuth.isAuthenticated();

    if (!isAuthed) {
      return `
        <div class="chat-guest-prompt">
          <div class="chat-guest-prompt-content">
            <div class="chat-guest-prompt-icon" aria-hidden="true">🔒</div>
            <div class="chat-guest-prompt-text">
              <strong>Sign in to chat</strong>
              <p>Guests can view the live campus stream. Sign in with your campus account to send messages.</p>
            </div>
          </div>
          <button type="button" class="btn-primary btn-chat-login" onclick="UniVibeAuth.promptSignIn()">Log In</button>
        </div>
      `;
    }

    return `
      <form class="chat-composer-form" id="chat-composer-form">
        <div class="chat-textarea-wrap">
          <textarea
            id="chat-input-textarea"
            class="chat-textarea"
            placeholder="Message #general... (Enter to send, Shift+Enter for newline)"
            rows="1"
            maxlength="1000"
            required
          ></textarea>
        </div>
        <button type="submit" class="btn-primary chat-send-btn" id="chat-send-btn" aria-label="Send message">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
          <span>Send</span>
        </button>
      </form>
    `;
  }

  /**
   * Attaches interactive event listeners to the Chat view
   */
  function attachChatEvents() {
    const stream = document.getElementById('chat-messages-stream');
    if (stream) {
      stream.addEventListener('scroll', handleStreamScroll, { passive: true });
    }

    const pill = document.getElementById('chat-new-messages-pill');
    if (pill) {
      pill.addEventListener('click', () => {
        scrollToBottom(true);
      });
    }

    const form = document.getElementById('chat-composer-form');
    const textarea = document.getElementById('chat-input-textarea');

    if (form && textarea) {
      // Auto-expand textarea as user types
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      });

      // Enter to send, Shift+Enter for newline
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = textarea.value;
        if (val && val.trim()) {
          sendMessage(val);
        }
      });
    }

    // Event delegation for delete buttons
    if (stream) {
      stream.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-action="delete-chat-msg"]');
        if (delBtn) {
          e.preventDefault();
          e.stopPropagation();
          const msgId = delBtn.getAttribute('data-msg-id');
          if (msgId) {
            deleteMessage(msgId);
          }
        }
      });
    }
  }

  /**
   * Main entry point to render the Chat view in the application
   */
  async function renderChatView(container) {
    if (!container) return;
    containerRef = container;

    // Ensure session detection has finished before deciding guest vs authenticated
    if (window.UniVibeAuth && typeof window.UniVibeAuth.waitForAuth === 'function') {
      try {
        await window.UniVibeAuth.waitForAuth();
      } catch (e) {}
    }

    const existingChatContainer = container.querySelector('#chat-view-container');
    if (existingChatContainer) {
      // Chat view already mounted in DOM. Simply update footer in case auth state changed
      const footer = document.getElementById('chat-footer');
      if (footer) {
        footer.innerHTML = renderFooterHtml();
        attachChatEvents();
      }
      return;
    }

    // Base skeleton layout
    container.innerHTML = `
      <div class="chat-view-container" id="chat-view-container">
        <!-- Header -->
        <header class="chat-header">
          <div class="chat-header-info">
            <div class="chat-title-row">
              <h1 class="chat-title">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                General Chat
              </h1>
              <span class="chat-room-badge">Campus</span>
            </div>
            <p class="chat-subtitle">
              <span class="chat-live-dot" id="chat-live-dot" title="Live stream"></span>
              <span id="chat-status-text">Connecting to campus stream...</span>
            </p>
          </div>
        </header>

        <!-- Message List Container -->
        <div class="chat-messages-wrap" id="chat-messages-wrap">
          <div class="chat-messages-stream" id="chat-messages-stream" role="log" aria-live="polite">
            <div class="chat-empty-state" style="opacity: 0.7;">
              <div class="chat-empty-icon" aria-hidden="true">💬</div>
              <h3>Loading General Chat...</h3>
              <p>Fetching conversations from campus.</p>
            </div>
          </div>
          <button type="button" class="chat-new-messages-pill" id="chat-new-messages-pill" style="display: none;" aria-label="Jump to newest messages">
            <span>New messages</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>

        <!-- Footer / Composer -->
        <footer class="chat-footer" id="chat-footer">
          ${renderFooterHtml()}
        </footer>
      </div>
    `;

    attachChatEvents();

    const stream = document.getElementById('chat-messages-stream');
    // If cached messages exist, render immediately to prevent any empty flash
    if (messages.length > 0) {
      renderMessagesList(stream);
      scrollToBottom(false);
    }

    // Fetch latest messages from Supabase and subscribe to Realtime
    await fetchMessages();

    renderMessagesList(stream);
    scrollToBottom(false);

    subscribeRealtime();
  }

  return {
    renderChatView,
    fetchMessages,
    sendMessage,
    deleteMessage,
    cleanup,
    refresh: async () => {
      await fetchMessages();
      const stream = document.getElementById('chat-messages-stream');
      renderMessagesList(stream);
      scrollToBottom(false);
    }
  };
})();

window.UniVibeChat = UniVibeChat;
