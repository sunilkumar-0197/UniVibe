/**
 * UniVibe Create Flow (Modal, Tab Switching, Real Post & Event Publishing)
 * Protected for authenticated users; guests are prompted to sign in.
 */

const UniVibeCreate = (() => {
  let modalBackdrop = null;
  let activeTab = 'post'; // 'post' | 'event' | 'club'
  let postAttachedFiles = []; // Array of { id, file, blob, dataUrl }
  let eventAttachedFiles = []; // Array of { id, file, blob, dataUrl }
  let stagedClubLogo = null; // { file, blob, dataUrl }

  function init() {
    modalBackdrop = document.getElementById('create-modal');
    if (!modalBackdrop) return;

    // Attach trigger buttons (FAB, sidebar button, inline composer trigger)
    document.addEventListener('click', (e) => {
      const openBtn = e.target.closest('[data-action="open-create"]');
      if (openBtn) {
        e.preventDefault();
        e.stopPropagation();

        // Check if authenticated
        if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
          if (window.UniVibeAuth) {
            window.UniVibeAuth.promptSignIn();
          }
          return;
        }

        const tabHint = openBtn.getAttribute('data-tab') || 'post';
        const clubHint = openBtn.getAttribute('data-club-id') || (window.UniVibeFeed && window.UniVibeFeed.getActiveClubId ? window.UniVibeFeed.getActiveClubId() : null);
        openModal(tabHint, clubHint);
      }
    });

    // Close button
    const closeBtn = modalBackdrop.querySelector('.modal-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    const cancelBtn = modalBackdrop.querySelector('[data-action="cancel-create"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeModal);
    }

    // Backdrop click close
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeModal();
      }
    });

    // Keyboard ESC close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalBackdrop.classList.contains('open')) {
        closeModal();
      }
    });

    // Tab buttons switch
    const tabButtons = modalBackdrop.querySelectorAll('.modal-tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });

    // Form submissions
    const postForm = document.getElementById('form-create-post');
    if (postForm) {
      postForm.addEventListener('submit', handlePostSubmit);
    }

    const eventForm = document.getElementById('form-create-event');
    if (eventForm) {
      eventForm.addEventListener('submit', handleEventSubmit);
    }

    const clubForm = document.getElementById('form-create-club');
    if (clubForm) {
      clubForm.addEventListener('submit', handleClubSubmit);
    }

    const clubSelect = document.getElementById('post-club-select');
    if (clubSelect) {
      clubSelect.addEventListener('change', updatePostSubmitButtonLabel);
    }

    setupMediaAttachmentPickers();
  }

  function setupMediaAttachmentPickers() {
    // Post photos button & input
    const btnPostAttach = document.getElementById('btn-post-attach-photos');
    const inputPostPhotos = document.getElementById('post-photos-input');
    if (btnPostAttach && inputPostPhotos) {
      btnPostAttach.addEventListener('click', () => {
        if (postAttachedFiles.length >= 4) {
          if (window.UniVibeToast) window.UniVibeToast.show('Maximum of 4 photos reached.');
          return;
        }
        inputPostPhotos.click();
      });
      inputPostPhotos.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        await handleFilesSelected(files, 'post');
        inputPostPhotos.value = '';
      });
    }

    // Event photos button & input
    const btnEventAttach = document.getElementById('btn-event-attach-photos');
    const inputEventPhotos = document.getElementById('event-photos-input');
    if (btnEventAttach && inputEventPhotos) {
      btnEventAttach.addEventListener('click', () => {
        if (eventAttachedFiles.length >= 4) {
          if (window.UniVibeToast) window.UniVibeToast.show('Maximum of 4 photos reached.');
          return;
        }
        inputEventPhotos.click();
      });
      inputEventPhotos.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        await handleFilesSelected(files, 'event');
        inputEventPhotos.value = '';
      });
    }

    // Club logo button, input & remove
    const btnClubAttachLogo = document.getElementById('btn-club-attach-logo');
    const inputClubLogo = document.getElementById('club-logo-input');
    const btnClubRemoveLogo = document.getElementById('btn-club-remove-logo');
    const clubLogoPreview = document.getElementById('create-club-logo-preview');

    if (btnClubAttachLogo && inputClubLogo) {
      btnClubAttachLogo.addEventListener('click', () => {
        inputClubLogo.click();
      });

      inputClubLogo.addEventListener('change', async (e) => {
        const file = (e.target.files || [])[0];
        if (!file) return;

        const fileType = (file.type || '').toLowerCase();
        const fileName = (file.name || '').toLowerCase();
        const isImg = fileType.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(fileName);
        if (!isImg) {
          if (window.UniVibeToast) window.UniVibeToast.show('Only image files (JPEG, PNG, WebP) are supported for club logos.');
          inputClubLogo.value = '';
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

          stagedClubLogo = {
            file,
            blob: compressed.blob,
            dataUrl: compressed.dataUrl
          };

          if (clubLogoPreview) {
            clubLogoPreview.innerHTML = `<img src="${compressed.dataUrl}" alt="Club logo preview" style="width: 100%; height: 100%; object-fit: cover;">`;
          }
          if (btnClubRemoveLogo) {
            btnClubRemoveLogo.style.display = 'inline-block';
          }
          if (btnClubAttachLogo) {
            btnClubAttachLogo.textContent = 'Change Logo';
          }
        } catch (err) {
          console.warn('[UniVibe Create] Club logo compression error:', err);
          if (window.UniVibeToast) window.UniVibeToast.show('Error processing logo image.');
        }
        inputClubLogo.value = '';
      });
    }

    if (btnClubRemoveLogo) {
      btnClubRemoveLogo.addEventListener('click', () => {
        stagedClubLogo = null;
        if (clubLogoPreview) clubLogoPreview.innerHTML = '📷';
        btnClubRemoveLogo.style.display = 'none';
        if (btnClubAttachLogo) btnClubAttachLogo.textContent = 'Upload Logo';
        if (inputClubLogo) inputClubLogo.value = '';
      });
    }
  }

  async function handleFilesSelected(files, target) {
    const currentList = target === 'post' ? postAttachedFiles : eventAttachedFiles;
    const remainingSlots = 4 - currentList.length;

    if (remainingSlots <= 0) {
      if (window.UniVibeToast) window.UniVibeToast.show('Maximum of 4 photos allowed.');
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    if (files.length > remainingSlots && window.UniVibeToast) {
      window.UniVibeToast.show(`Only ${remainingSlots} more photo${remainingSlots > 1 ? 's' : ''} can be attached.`);
    }

    for (const file of filesToProcess) {
      const fileType = (file.type || '').toLowerCase();
      const fileName = (file.name || '').toLowerCase();
      const isImg = fileType.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(fileName);

      // Validate: no video files
      if (fileType.startsWith('video/')) {
        if (window.UniVibeToast) window.UniVibeToast.show('Video uploads are not allowed. Please choose photos.');
        continue;
      }
      if (!isImg) {
        if (window.UniVibeToast) window.UniVibeToast.show('Only image files (JPEG, PNG, WebP) are supported.');
        continue;
      }

      try {
        let compressed;
        if (window.UniVibeMedia && typeof window.UniVibeMedia.compressImage === 'function') {
          compressed = await window.UniVibeMedia.compressImage(file, {
            maxWidth: 1600,
            maxHeight: 1600,
            quality: 0.82
          });
        } else {
          compressed = { blob: file, dataUrl: URL.createObjectURL(file) };
        }

        const item = {
          id: 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          file: file,
          blob: compressed.blob,
          dataUrl: compressed.dataUrl
        };

        if (target === 'post') {
          postAttachedFiles.push(item);
        } else {
          eventAttachedFiles.push(item);
        }
      } catch (compErr) {
        console.warn('[UniVibe Create] Compression error:', compErr);
        if (window.UniVibeToast) window.UniVibeToast.show(compErr.message || 'Error processing image.');
      }
    }

    if (target === 'post') {
      renderMediaPreviews('post');
    } else {
      renderMediaPreviews('event');
    }
  }

  function renderMediaPreviews(target) {
    const list = target === 'post' ? postAttachedFiles : eventAttachedFiles;
    const container = document.getElementById(`${target}-media-preview-list`);
    const counter = document.getElementById(`${target}-photos-counter`);
    const addBtn = document.getElementById(`btn-${target}-attach-photos`);

    if (counter) {
      counter.textContent = `${list.length} / 4`;
    }

    if (addBtn) {
      addBtn.style.display = list.length >= 4 ? 'none' : 'inline-flex';
    }

    if (!container) return;

    if (list.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = list.map((item, idx) => `
      <div class="composer-media-thumbnail" data-index="${idx}">
        <img src="${item.dataUrl}" alt="Photo preview ${idx + 1}" />
        <button type="button" class="composer-media-remove-btn" data-action="remove-${target}-photo" data-index="${idx}" title="Remove photo" aria-label="Remove photo">✕</button>
      </div>
    `).join('');

    container.querySelectorAll(`[data-action="remove-${target}-photo"]`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          if (target === 'post') {
            postAttachedFiles.splice(idx, 1);
            renderMediaPreviews('post');
          } else {
            eventAttachedFiles.splice(idx, 1);
            renderMediaPreviews('event');
          }
        }
      });
    });
  }

  function resetAllMedia() {
    postAttachedFiles = [];
    eventAttachedFiles = [];
    renderMediaPreviews('post');
    renderMediaPreviews('event');
    const pInput = document.getElementById('post-photos-input');
    if (pInput) pInput.value = '';
    const eInput = document.getElementById('event-photos-input');
    if (eInput) eInput.value = '';

    stagedClubLogo = null;
    const clubLogoPreview = document.getElementById('create-club-logo-preview');
    if (clubLogoPreview) clubLogoPreview.innerHTML = '📷';
    const btnClubRemoveLogo = document.getElementById('btn-club-remove-logo');
    if (btnClubRemoveLogo) btnClubRemoveLogo.style.display = 'none';
    const btnClubAttachLogo = document.getElementById('btn-club-attach-logo');
    if (btnClubAttachLogo) btnClubAttachLogo.textContent = 'Upload Logo';
    const clubLogoInput = document.getElementById('club-logo-input');
    if (clubLogoInput) clubLogoInput.value = '';
    const clubLimitInput = document.getElementById('club-limit-input');
    if (clubLimitInput) clubLimitInput.value = '';
  }

  function updatePostSubmitButtonLabel() {
    const postForm = document.getElementById('form-create-post');
    if (!postForm) return;
    const submitBtn = postForm.querySelector('button[type="submit"]');
    if (!submitBtn) return;
    const clubSelect = document.getElementById('post-club-select');
    if (clubSelect && clubSelect.value && clubSelect.value !== 'general') {
      const selectedOption = clubSelect.options[clubSelect.selectedIndex];
      const clubName = selectedOption ? selectedOption.textContent.replace(/^[^\w\s]+/, '').trim() : 'Club';
      submitBtn.textContent = `Post to ${clubName}`;
    } else {
      submitBtn.textContent = 'Share to Campus';
    }
  }

  function openModal(tab = 'post', contextClubId = null) {
    if (!modalBackdrop) return;

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) {
        window.UniVibeAuth.promptSignIn();
      }
      return;
    }

    resetAllMedia();

    // Update composer author display to match current authenticated user
    const currentUser = window.UniVibeAuth ? window.UniVibeAuth.getCurrentUser() : null;
    const authorNameEl = document.getElementById('composer-author-name');
    if (authorNameEl && currentUser) {
      authorNameEl.textContent = currentUser.name;
    }
    const composerAvatar = document.querySelector('.composer-user-avatar');
    if (composerAvatar && currentUser) {
      if (currentUser.avatarUrl) {
        composerAvatar.classList.add('has-avatar-img');
        composerAvatar.innerHTML = `<img src="${currentUser.avatarUrl}" alt="${currentUser.name}" class="avatar-photo-img">`;
      } else {
        const getInitials = window.UniVibeFeed && window.UniVibeFeed.getInitials ? window.UniVibeFeed.getInitials : name => name.slice(0, 2).toUpperCase();
        composerAvatar.classList.remove('has-avatar-img');
        composerAvatar.textContent = getInitials(currentUser.name);
      }
    }

    switchTab(tab);

    // Pre-select club in audience selector if inside a club
    const effectiveClubId = contextClubId || (window.UniVibeFeed && window.UniVibeFeed.getActiveClubId ? window.UniVibeFeed.getActiveClubId() : null);
    const clubSelect = document.getElementById('post-club-select');
    if (clubSelect) {
      if (effectiveClubId && clubSelect.querySelector(`option[value="${effectiveClubId}"]`)) {
        clubSelect.value = effectiveClubId;
      } else if (!effectiveClubId) {
        clubSelect.value = 'general';
      }
      updatePostSubmitButtonLabel();
    }

    modalBackdrop.style.display = 'flex';
    modalBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Focus primary input
    setTimeout(() => {
      if (tab === 'post') {
        const titleInput = document.getElementById('post-title-input');
        if (titleInput) {
          titleInput.focus();
        } else {
          const textarea = document.getElementById('post-caption-input');
          if (textarea) textarea.focus();
        }
      } else if (tab === 'event') {
        const titleInput = document.getElementById('event-title-input');
        if (titleInput) titleInput.focus();
      } else if (tab === 'club') {
        const nameInput = document.getElementById('club-name-input');
        if (nameInput) nameInput.focus();
      }
    }, 150);
  }

  function closeModal() {
    if (!modalBackdrop) return;
    resetAllMedia();
    modalBackdrop.classList.remove('open');
    modalBackdrop.style.display = 'none';
    document.body.style.overflow = '';
  }

  function switchTab(tab) {
    activeTab = tab;
    const tabButtons = modalBackdrop.querySelectorAll('.modal-tab-btn');
    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });

    const postForm = document.getElementById('form-create-post');
    const eventForm = document.getElementById('form-create-event');
    const clubForm = document.getElementById('form-create-club');

    if (postForm) postForm.style.display = tab === 'post' ? 'flex' : 'none';
    if (eventForm) eventForm.style.display = tab === 'event' ? 'flex' : 'none';
    if (clubForm) clubForm.style.display = tab === 'club' ? 'flex' : 'none';
  }

  async function handlePostSubmit(e) {
    e.preventDefault();

    // 1. Block guests and prompt sign in
    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) {
        window.UniVibeAuth.promptSignIn();
      }
      closeModal();
      return;
    }

    const titleInput = document.getElementById('post-title-input');
    const captionInput = document.getElementById('post-caption-input');
    const tagsInput = document.getElementById('post-tags-input');

    const title = titleInput ? titleInput.value.trim() : '';
    const content = captionInput ? captionInput.value.trim() : '';
    const rawTags = tagsInput ? tagsInput.value.trim() : '';

    if (!title) {
      if (window.UniVibeToast) {
        window.UniVibeToast.show('Please enter a title for your post.');
      }
      if (titleInput) titleInput.focus();
      return;
    }

    if (!content) {
      if (window.UniVibeToast) {
        window.UniVibeToast.show('Please enter your vibe or description.');
      }
      if (captionInput) captionInput.focus();
      return;
    }

    const tags = rawTags
      ? rawTags.split(/\s+/).filter(t => t.length > 0).map(t => t.startsWith('#') ? t : `#${t}`)
      : [];

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : 'Share to Campus';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sharing...';
    }

    try {
      if (window.UniVibeSupabase) {
        await window.UniVibeSupabase.init();
      }

      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (!supabase) {
        if (window.UniVibeToast) {
          window.UniVibeToast.show('Database is not connected. Please check configuration.');
        }
        return;
      }

      const currentUser = window.UniVibeAuth.getCurrentUser();
      if (!currentUser || !currentUser.id) {
        if (window.UniVibeToast) {
          window.UniVibeToast.show('You must be signed in to create a post.');
        }
        return;
      }

      const clubSelect = document.getElementById('post-club-select');
      const selectedClubId = (clubSelect && clubSelect.value && clubSelect.value !== 'general')
        ? clubSelect.value
        : null;

      // Verify club membership before posting
      if (selectedClubId && window.UniVibeFeed) {
        const clubs = window.UniVibeFeed.getClubs();
        const targetClub = clubs.find(c => c.id === selectedClubId);
        if (targetClub && !targetClub.isJoined) {
          if (window.UniVibeToast) {
            window.UniVibeToast.show(`You must join ${targetClub.name} to post in it.`);
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
          }
          return;
        }
      }

      // Upload attached photos if any
      let uploadedPostImages = [];
      if (postAttachedFiles.length > 0) {
        if (submitBtn) submitBtn.textContent = 'Uploading photos...';
        for (let i = 0; i < postAttachedFiles.length; i++) {
          const item = postAttachedFiles[i];
          try {
            if (window.UniVibeMedia && typeof window.UniVibeMedia.uploadMedia === 'function') {
              const url = await window.UniVibeMedia.uploadMedia(currentUser.id, item.blob || item.file, 'post', i);
              if (url) uploadedPostImages.push(url);
            } else if (item.dataUrl) {
              uploadedPostImages.push(item.dataUrl);
            }
          } catch (uploadErr) {
            console.warn('[UniVibe Create] Photo upload warning:', uploadErr);
            if (item.dataUrl) uploadedPostImages.push(item.dataUrl);
          }
        }
      }

      // 2. Real Supabase insert into `posts` table with title, content, user_id, club_id, tags, and images
      const postPayload = {
        user_id: currentUser.id,
        title: title,
        content: content
      };

      if (selectedClubId) {
        postPayload.club_id = selectedClubId;
      }

      if (tags.length > 0) {
        postPayload.tags = tags;
      }

      if (uploadedPostImages.length > 0) {
        postPayload.images = uploadedPostImages;
      }

      let { data, error } = await supabase
        .from('posts')
        .insert([postPayload])
        .select()
        .single();

      // Graceful fallback if optional columns (tags) do not exist yet in database
      if (error && postPayload.tags) {
        console.warn('[UniVibe Create] tags column missing in Supabase, retrying without tags field:', error);
        delete postPayload.tags;
        const retryResult = await supabase
          .from('posts')
          .insert([postPayload])
          .select()
          .single();
        data = retryResult.data;
        error = retryResult.error;
      }

      // Record media for session and insert normalized post_images records if supported
      if (data && data.id && uploadedPostImages.length > 0) {
        window.UniVibeLocalMedia = window.UniVibeLocalMedia || {};
        window.UniVibeLocalMedia[data.id] = uploadedPostImages;

        // Explicitly persist uploaded image URLs to posts.images after successful post creation
        try {
          await supabase
            .from('posts')
            .update({ images: uploadedPostImages })
            .eq('id', data.id);
        } catch (imgUpdateErr) {
          console.warn('[UniVibe Create] Notice updating posts.images column:', imgUpdateErr);
        }

        try {
          const postImageRows = uploadedPostImages.map((imgUrl, orderIdx) => ({
            post_id: data.id,
            user_id: currentUser.id,
            url: imgUrl,
            display_order: orderIdx
          }));
          await supabase.from('post_images').insert(postImageRows);
        } catch (postImgErr) {
          // Graceful fallback if table not yet migrated
        }
      }

      if (error) {
        console.error('[UniVibe Create] Error saving post to Supabase:', error);
        if (window.UniVibeToast) {
          window.UniVibeToast.show(error.message || 'Failed to create post. Please try again.');
        }
        return;
      }

      // 3. Clear inputs & close modal
      if (titleInput) titleInput.value = '';
      if (captionInput) captionInput.value = '';
      if (tagsInput) tagsInput.value = '';
      closeModal();

      // 4. Update the feed immediately so the new post appears
      if (window.UniVibeFeed && typeof window.UniVibeFeed.fetchPosts === 'function') {
        await window.UniVibeFeed.fetchPosts();
      }

      // 5. Success feedback
      if (window.UniVibeToast) {
        if (selectedClubId) {
          const clubs = window.UniVibeFeed ? window.UniVibeFeed.getClubs() : [];
          const targetClub = clubs.find(c => c.id === selectedClubId);
          window.UniVibeToast.show(`Posted to ${targetClub ? targetClub.name : 'club'}! 👥`);
        } else {
          window.UniVibeToast.show('Shared your vibe with the campus! ✨');
        }
      }
    } catch (err) {
      console.error('[UniVibe Create] Post exception:', err);
      if (window.UniVibeToast) {
        window.UniVibeToast.show(err.message || 'An unexpected error occurred.');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        updatePostSubmitButtonLabel();
      }
    }
  }

  async function handleEventSubmit(e) {
    e.preventDefault();

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) {
        window.UniVibeAuth.promptSignIn();
      }
      closeModal();
      return;
    }

    const titleInput = document.getElementById('event-title-input');
    const dateInput = document.getElementById('event-date-input');
    const timeInput = document.getElementById('event-time-input');
    const locationInput = document.getElementById('event-location-input');
    const descInput = document.getElementById('event-desc-input');

    const title = titleInput ? titleInput.value.trim() : '';
    const eventDate = dateInput ? dateInput.value.trim() : '';
    const eventTime = timeInput ? timeInput.value.trim() : '';
    const location = locationInput ? locationInput.value.trim() : '';
    const description = descInput ? descInput.value.trim() : '';

    if (!title) {
      if (window.UniVibeToast) window.UniVibeToast.show('Please enter an event title.');
      if (titleInput) titleInput.focus();
      return;
    }
    if (!eventDate) {
      if (window.UniVibeToast) window.UniVibeToast.show('Please select an event date.');
      if (dateInput) dateInput.focus();
      return;
    }
    if (!eventTime) {
      if (window.UniVibeToast) window.UniVibeToast.show('Please select an event time.');
      if (timeInput) timeInput.focus();
      return;
    }
    if (!location) {
      if (window.UniVibeToast) window.UniVibeToast.show('Please enter a location for the event.');
      if (locationInput) locationInput.focus();
      return;
    }
    if (!description) {
      if (window.UniVibeToast) window.UniVibeToast.show('Please enter a description for the event.');
      if (descInput) descInput.focus();
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : 'Publish Event';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Publishing...';
    }

    try {
      if (window.UniVibeSupabase) {
        await window.UniVibeSupabase.init();
      }

      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (!supabase) {
        if (window.UniVibeToast) {
          window.UniVibeToast.show('Database is not connected. Please check configuration.');
        }
        return;
      }

      const currentUser = window.UniVibeAuth.getCurrentUser();
      if (!currentUser || !currentUser.id) {
        if (window.UniVibeToast) {
          window.UniVibeToast.show('You must be signed in to create an event.');
        }
        return;
      }

      // Upload attached photos if any
      let uploadedEventImages = [];
      if (eventAttachedFiles.length > 0) {
        if (submitBtn) submitBtn.textContent = 'Uploading photos...';
        for (let i = 0; i < eventAttachedFiles.length; i++) {
          const item = eventAttachedFiles[i];
          try {
            if (window.UniVibeMedia && typeof window.UniVibeMedia.uploadMedia === 'function') {
              const url = await window.UniVibeMedia.uploadMedia(currentUser.id, item.blob || item.file, 'event', i);
              if (url) uploadedEventImages.push(url);
            } else if (item.dataUrl) {
              uploadedEventImages.push(item.dataUrl);
            }
          } catch (uploadErr) {
            console.warn('[UniVibe Create] Event photo upload warning:', uploadErr);
            if (item.dataUrl) uploadedEventImages.push(item.dataUrl);
          }
        }
      }

      // Real Supabase insert into `events` table
      const eventPayload = {
        user_id: currentUser.id,
        title: title,
        description: description,
        event_date: eventDate,
        event_time: eventTime,
        location: location
      };

      if (uploadedEventImages.length > 0) {
        eventPayload.images = uploadedEventImages;
      }

      let { data, error } = await supabase
        .from('events')
        .insert([eventPayload])
        .select()
        .single();

      if (error && (eventPayload.images || (error.message && error.message.toLowerCase().includes('images')))) {
        console.warn('[UniVibe Create] images column missing on events table, retrying:', error);
        delete eventPayload.images;
        const retryRes = await supabase
          .from('events')
          .insert([eventPayload])
          .select()
          .single();
        data = retryRes.data;
        error = retryRes.error;
      }

      // Record media for session and insert normalized post_images records if supported
      if (data && data.id && uploadedEventImages.length > 0) {
        window.UniVibeLocalMedia = window.UniVibeLocalMedia || {};
        window.UniVibeLocalMedia[data.id] = uploadedEventImages;

        try {
          const eventImageRows = uploadedEventImages.map((imgUrl, orderIdx) => ({
            event_id: data.id,
            user_id: currentUser.id,
            url: imgUrl,
            display_order: orderIdx
          }));
          await supabase.from('post_images').insert(eventImageRows);
        } catch (eventImgErr) {
          // Graceful fallback
        }
      }

      if (error) {
        console.error('[UniVibe Create] Error saving event to Supabase:', error);
        if (window.UniVibeToast) {
          window.UniVibeToast.show(error.message || 'Failed to create event. Please try again.');
        }
        return;
      }

      // Reset form
      if (titleInput) titleInput.value = '';
      if (dateInput) dateInput.value = '';
      if (timeInput) timeInput.value = '';
      if (locationInput) locationInput.value = '';
      if (descInput) descInput.value = '';
      closeModal();

      // Refresh events and feed immediately
      if (window.UniVibeFeed) {
        if (typeof window.UniVibeFeed.fetchEvents === 'function') {
          await window.UniVibeFeed.fetchEvents();
        }
        if (typeof window.UniVibeFeed.fetchPosts === 'function') {
          await window.UniVibeFeed.fetchPosts();
        }
      }

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Campus event published! 📅');
      }

      // Navigate to the newly created event's dedicated page
      if (data && data.id && window.UniVibeFeed && typeof window.UniVibeFeed.navigateToEvent === 'function') {
        window.UniVibeFeed.navigateToEvent(data.id);
      } else if (window.UniVibeFeed && typeof window.UniVibeFeed.setFilter === 'function') {
        window.UniVibeFeed.setFilter('event');
      }
    } catch (err) {
      console.error('[UniVibe Create] Event exception:', err);
      if (window.UniVibeToast) {
        window.UniVibeToast.show(err.message || 'An unexpected error occurred.');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    }
  }

  async function handleClubSubmit(e) {
    e.preventDefault();

    if (!window.UniVibeAuth || !window.UniVibeAuth.isAuthenticated()) {
      if (window.UniVibeAuth) {
        window.UniVibeAuth.promptSignIn();
      }
      closeModal();
      return;
    }

    const nameInput = document.getElementById('club-name-input');
    const descInput = document.getElementById('club-desc-input');
    const limitInput = document.getElementById('club-limit-input');

    const name = nameInput ? nameInput.value.trim() : '';
    const description = descInput ? descInput.value.trim() : '';

    if (!name) {
      if (window.UniVibeToast) window.UniVibeToast.show('Please enter a club name.');
      if (nameInput) nameInput.focus();
      return;
    }
    if (!description) {
      if (window.UniVibeToast) window.UniVibeToast.show('Please enter a club description.');
      if (descInput) descInput.focus();
      return;
    }

    let memberLimitVal = null;
    if (limitInput && limitInput.value.trim()) {
      const parsed = parseInt(limitInput.value.trim(), 10);
      if (isNaN(parsed) || parsed <= 0) {
        if (window.UniVibeToast) window.UniVibeToast.show('Member limit must be a positive number.');
        if (limitInput) limitInput.focus();
        return;
      }
      memberLimitVal = parsed;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : 'Create Club';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';
    }

    try {
      if (window.UniVibeSupabase) {
        await window.UniVibeSupabase.init();
      }

      const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
      if (!supabase) {
        if (window.UniVibeToast) {
          window.UniVibeToast.show('Database is not connected. Please check configuration.');
        }
        return;
      }

      const currentUser = window.UniVibeAuth.getCurrentUser();
      if (!currentUser || !currentUser.id) {
        if (window.UniVibeToast) {
          window.UniVibeToast.show('You must be signed in to create a club.');
        }
        return;
      }

      // Upload club logo if selected
      let uploadedLogoUrl = null;
      if (stagedClubLogo) {
        if (submitBtn) submitBtn.textContent = 'Uploading logo...';
        try {
          if (window.UniVibeMedia && typeof window.UniVibeMedia.uploadMedia === 'function') {
            uploadedLogoUrl = await window.UniVibeMedia.uploadMedia(currentUser.id, stagedClubLogo.blob || stagedClubLogo.file, 'club_logo');
          } else if (stagedClubLogo.dataUrl) {
            uploadedLogoUrl = stagedClubLogo.dataUrl;
          }
        } catch (logoErr) {
          console.warn('[UniVibe Create] Club logo upload warning:', logoErr);
          if (stagedClubLogo.dataUrl) uploadedLogoUrl = stagedClubLogo.dataUrl;
        }
      }

      // Real Supabase insert into `public.clubs` table
      const clubPayload = {
        name: name,
        description: description,
        created_by: currentUser.id,
        logo_url: uploadedLogoUrl || null,
        member_limit: memberLimitVal
      };

      const { data: newClub, error } = await supabase
        .from('clubs')
        .insert([clubPayload])
        .select()
        .single();

      if (error) {
        console.error('[UniVibe Create] Error saving club to Supabase:', error);
        if (window.UniVibeToast) {
          window.UniVibeToast.show(error.message || 'Failed to create club. Please try again.');
        }
        return;
      }

      // Automatically join the creator to the club
      if (newClub && newClub.id) {
        if (uploadedLogoUrl) {
          window.UniVibeLocalMedia = window.UniVibeLocalMedia || {};
          window.UniVibeLocalMedia['club_' + newClub.id] = uploadedLogoUrl;
          window.UniVibeLocalMedia[newClub.id] = uploadedLogoUrl;
        }

        try {
          await supabase
            .from('club_members')
            .insert([{ club_id: newClub.id, user_id: currentUser.id }]);
        } catch (mErr) {
          console.warn('[UniVibe Create] Creator membership insert notice:', mErr);
        }
      }

      // Reset form & close modal
      if (nameInput) nameInput.value = '';
      if (descInput) descInput.value = '';
      if (limitInput) limitInput.value = '';
      closeModal();

      // Refresh clubs and switch to Clubs directory view
      if (window.UniVibeFeed) {
        if (typeof window.UniVibeFeed.fetchClubs === 'function') {
          await window.UniVibeFeed.fetchClubs();
        }
        if (typeof window.UniVibeFeed.setFilter === 'function') {
          window.UniVibeFeed.setFilter('clubs');
        }
      }

      if (window.UniVibeToast) {
        window.UniVibeToast.show('Campus club created! 👥');
      }
    } catch (err) {
      console.error('[UniVibe Create] Club exception:', err);
      if (window.UniVibeToast) {
        window.UniVibeToast.show(err.message || 'An unexpected error occurred.');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    }
  }

  return {
    init,
    openModal,
    closeModal,
    switchTab
  };
})();

window.UniVibeCreate = UniVibeCreate;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', UniVibeCreate.init);
} else {
  UniVibeCreate.init();
}
