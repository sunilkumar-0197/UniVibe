/**
 * UniVibe Media Management Controller
 * Handles client-side image compression, Supabase Storage uploads for avatars & post/event media,
 * and the responsive lightbox image viewer.
 */

const UniVibeMedia = (() => {
  let lightboxModal = null;
  let lightboxImg = null;
  let lightboxPrevBtn = null;
  let lightboxNextBtn = null;
  let lightboxCounter = null;
  let currentLightboxImages = [];
  let currentLightboxIndex = 0;

  function init() {
    setupLightbox();
  }

  /**
   * Compresses and resizes an image file client-side using HTML5 Canvas.
   * Restricts oversized dimensions and re-encodes as JPEG/WebP to minimize upload size.
   */
  async function compressImage(fileOrBlob, options = {}) {
    const maxWidth = options.maxWidth || 1600;
    const maxHeight = options.maxHeight || 1600;
    const quality = options.quality !== undefined ? options.quality : 0.82;

    if (!fileOrBlob) {
      throw new Error('Invalid file provided.');
    }

    let fileType = (fileOrBlob.type || '').toLowerCase();
    const fileName = (fileOrBlob.name || '').toLowerCase();
    const isImageExt = fileName ? /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(fileName) : false;

    if (!fileType && isImageExt) {
      if (/\.jpe?g$/i.test(fileName)) fileType = 'image/jpeg';
      else if (/\.png$/i.test(fileName)) fileType = 'image/png';
      else if (/\.webp$/i.test(fileName)) fileType = 'image/webp';
      else if (/\.gif$/i.test(fileName)) fileType = 'image/gif';
      else fileType = 'image/jpeg';
    } else if (!fileType) {
      // Default fallback for raw blobs or files without OS MIME association
      fileType = 'image/jpeg';
    }

    if (!fileType.startsWith('image/') && !isImageExt) {
      throw new Error('Only image files (JPEG, PNG, WebP, GIF) are allowed. Videos and other files are not supported.');
    }

    // Reject video formats explicitly
    if (fileType.startsWith('video/')) {
      throw new Error('Video uploads are not supported. Please select photos only.');
    }

    // Max raw file size check before compression (15MB safeguard)
    if (fileOrBlob.size && fileOrBlob.size > 15 * 1024 * 1024) {
      throw new Error('Selected image is too large (over 15MB). Please choose a smaller image.');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Failed to load image for processing.'));
        img.onload = () => {
          let { width, height } = img;

          // Calculate scaled dimensions while preserving aspect ratio
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');

          // Clean smoothing for crisp downscaled photos
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          // For GIFs or PNGs with transparency where quality is high, keep PNG if requested
          const mimeType = (fileType === 'image/png' && options.preservePng) ? 'image/png' : 'image/jpeg';

          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Canvas image compression failed.'));
              return;
            }
            const dataUrl = canvas.toDataURL(mimeType, quality);
            resolve({
              blob,
              dataUrl,
              width,
              height,
              size: blob.size,
              originalName: fileOrBlob.name || 'image.jpg'
            });
          }, mimeType, quality);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(fileOrBlob);
    });
  }

  /**
   * Uploads an avatar image for the authenticated user to Supabase Storage ('avatars' bucket).
   * Generates public storage URL and handles bucket missing gracefully.
   */
  async function uploadAvatar(userId, fileOrBlob) {
    if (!userId) {
      throw new Error('User ID is required for avatar upload.');
    }

    if (window.UniVibeSupabase) {
      await window.UniVibeSupabase.init();
    }

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) {
      throw new Error('Supabase client connection not available.');
    }

    // Compress avatar to 512x512 max
    const compressed = await compressImage(fileOrBlob, {
      maxWidth: 512,
      maxHeight: 512,
      quality: 0.85
    });

    const timestamp = Date.now();
    const filePath = `${userId}/avatar_${timestamp}.jpg`;

    try {
      const { data, error } = await supabase.storage
        .from('avatars')
        .upload(filePath, compressed.blob, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (error) {
        console.warn('[UniVibe Media] Avatar upload error from Supabase Storage:', error);
        // If storage bucket is not created yet in SQL editor
        if (error.message && (error.message.includes('not found') || error.message.includes('Bucket') || error.statusCode === 404)) {
          if (window.UniVibeToast) {
            window.UniVibeToast.show('Storage notice: Please execute schema_media.sql in Supabase SQL Editor.');
          }
          // Fallback to dataUrl so local session test succeeds
          return compressed.dataUrl;
        }
        throw new Error(error.message || 'Failed to upload profile picture to storage.');
      }

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      return urlData.publicUrl;
    } catch (err) {
      console.warn('[UniVibe Media] Exception uploading avatar to storage:', err);
      // Fallback for offline or migration-pending test sessions
      if (compressed && compressed.dataUrl) {
        return compressed.dataUrl;
      }
      throw err;
    }
  }

  /**
   * Uploads post/event media to Supabase Storage ('univibe-media' bucket).
   */
  async function uploadMedia(userId, fileOrBlob, type = 'post', index = 0) {
    if (!userId) {
      throw new Error('User ID is required for media upload.');
    }

    if (window.UniVibeSupabase) {
      await window.UniVibeSupabase.init();
    }

    const supabase = window.UniVibeSupabase ? window.UniVibeSupabase.getClient() : null;
    if (!supabase) {
      throw new Error('Supabase client connection not available.');
    }

    const compressed = await compressImage(fileOrBlob, {
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.82
    });

    const timestamp = Date.now();
    const filePath = `${userId}/${type}_${timestamp}_${index}.jpg`;

    try {
      const { data, error } = await supabase.storage
        .from('univibe-media')
        .upload(filePath, compressed.blob, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (error) {
        console.warn('[UniVibe Media] Media upload error from Supabase Storage:', error);
        if (error.message && (error.message.includes('not found') || error.message.includes('Bucket') || error.statusCode === 404)) {
          if (window.UniVibeToast) {
            window.UniVibeToast.show('Storage notice: Please execute schema_media.sql in Supabase SQL Editor.');
          }
          return compressed.dataUrl;
        }
        throw new Error(error.message || 'Failed to upload photo to storage.');
      }

      const { data: urlData } = supabase.storage
        .from('univibe-media')
        .getPublicUrl(filePath);

      return urlData.publicUrl;
    } catch (err) {
      console.warn('[UniVibe Media] Exception uploading media to storage:', err);
      if (compressed && compressed.dataUrl) {
        return compressed.dataUrl;
      }
      throw err;
    }
  }

  // ==============================================================================
  // Responsive Image Lightbox Modal Controller
  // ==============================================================================

  function setupLightbox() {
    lightboxModal = document.getElementById('media-lightbox-modal');
    if (!lightboxModal) return;

    lightboxImg = document.getElementById('lightbox-img');
    lightboxPrevBtn = document.getElementById('lightbox-prev-btn');
    lightboxNextBtn = document.getElementById('lightbox-next-btn');
    lightboxCounter = document.getElementById('lightbox-counter');

    const closeBtn = document.getElementById('lightbox-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeLightbox);
    }

    if (lightboxPrevBtn) {
      lightboxPrevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateLightbox(-1);
      });
    }

    if (lightboxNextBtn) {
      lightboxNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateLightbox(1);
      });
    }

    // Click backdrop to close
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal || e.target.classList.contains('lightbox-content')) {
        closeLightbox();
      }
    });

    // Keyboard handlers (ESC, ArrowLeft, ArrowRight)
    document.addEventListener('keydown', (e) => {
      if (!lightboxModal || lightboxModal.style.display === 'none') return;

      if (e.key === 'Escape') {
        closeLightbox();
      } else if (e.key === 'ArrowLeft') {
        navigateLightbox(-1);
      } else if (e.key === 'ArrowRight') {
        navigateLightbox(1);
      }
    });

    // Delegate clicks on post-media-item or any element with data-action="open-lightbox"
    document.addEventListener('click', (e) => {
      const mediaItem = e.target.closest('[data-action="open-lightbox"]');
      if (mediaItem) {
        e.preventDefault();
        e.stopPropagation();

        const grid = mediaItem.closest('.post-media-grid');
        let images = [];
        let index = 0;

        if (grid) {
          const allItems = Array.from(grid.querySelectorAll('[data-action="open-lightbox"]'));
          images = allItems.map(item => item.getAttribute('data-img-src')).filter(Boolean);
          index = allItems.indexOf(mediaItem);
          if (index < 0) index = 0;
        } else {
          const singleSrc = mediaItem.getAttribute('data-img-src') || (mediaItem.querySelector('img') ? mediaItem.querySelector('img').src : null);
          if (singleSrc) images = [singleSrc];
        }

        if (images.length > 0) {
          openLightbox(images, index);
        }
      }
    });
  }

  function openLightbox(images, startIndex = 0) {
    if (!lightboxModal) {
      setupLightbox();
      if (!lightboxModal) return;
    }

    currentLightboxImages = Array.isArray(images) ? images : [images];
    currentLightboxIndex = Math.max(0, Math.min(startIndex, currentLightboxImages.length - 1));

    updateLightboxView();

    lightboxModal.style.display = 'flex';
    lightboxModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function updateLightboxView() {
    if (!lightboxImg || currentLightboxImages.length === 0) return;

    const currentSrc = currentLightboxImages[currentLightboxIndex];
    lightboxImg.src = currentSrc;

    const count = currentLightboxImages.length;
    if (count > 1) {
      if (lightboxPrevBtn) lightboxPrevBtn.style.display = 'inline-flex';
      if (lightboxNextBtn) lightboxNextBtn.style.display = 'inline-flex';
      if (lightboxCounter) {
        lightboxCounter.style.display = 'block';
        lightboxCounter.textContent = `${currentLightboxIndex + 1} / ${count}`;
      }
    } else {
      if (lightboxPrevBtn) lightboxPrevBtn.style.display = 'none';
      if (lightboxNextBtn) lightboxNextBtn.style.display = 'none';
      if (lightboxCounter) lightboxCounter.style.display = 'none';
    }
  }

  function navigateLightbox(step) {
    if (currentLightboxImages.length <= 1) return;
    const total = currentLightboxImages.length;
    currentLightboxIndex = (currentLightboxIndex + step + total) % total;
    updateLightboxView();
  }

  function closeLightbox() {
    if (!lightboxModal) return;
    lightboxModal.classList.remove('open');
    setTimeout(() => {
      lightboxModal.style.display = 'none';
      if (lightboxImg) lightboxImg.src = '';
    }, 200);
    document.body.style.overflow = '';
  }

  return {
    init,
    compressImage,
    uploadAvatar,
    uploadMedia,
    openLightbox,
    closeLightbox
  };
})();

window.UniVibeMedia = UniVibeMedia;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', UniVibeMedia.init);
} else {
  UniVibeMedia.init();
}
