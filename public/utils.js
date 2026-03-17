/* ── utils.js — shared helpers ──────────────────────────────────────────────── */

/**
 * Format seconds into "M:SS" or "H:MM:SS"
 */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Show a temporary toast notification
 */
function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

/**
 * Show a generic modal
 */
function showModal(content, onClose) {
  let backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'modal-backdrop';
    document.body.appendChild(backdrop);
  }

  backdrop.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'modal-box';

  if (typeof content === 'string') {
    box.innerHTML = content;
  } else {
    box.appendChild(content);
  }

  backdrop.appendChild(box);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => backdrop.classList.add('open'));
  });

  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => { backdrop.innerHTML = ''; }, 200);
    if (onClose) onClose();
  };

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close();
  });

  const onKey = e => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  return { close };
}

/** Hide the modal */
function hideModal() {
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) {
    backdrop.classList.remove('open');
    setTimeout(() => { backdrop.innerHTML = ''; }, 200);
  }
}

/**
 * Show a lightbox with image, video, or trigger download
 */
function showAttachment(att, srcUrl) {
  const isImage = att.mime_type.startsWith('image/');
  const isVideo = att.mime_type.startsWith('video/');

  if (!isImage && !isVideo) {
    const a = document.createElement('a');
    a.href = srcUrl;
    a.download = att.original_name;
    a.click();
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'modal-box lightbox-modal';

  const header = document.createElement('div');
  header.className = 'lightbox-header';

  const name = document.createElement('span');
  name.textContent = att.original_name;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';

  header.appendChild(name);
  header.appendChild(closeBtn);
  wrap.appendChild(header);

  if (isImage) {
    const img = document.createElement('img');
    img.src = srcUrl;
    img.alt = att.original_name;
    wrap.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.src = srcUrl;
    video.controls = true;
    video.autoplay = true;
    wrap.appendChild(video);
  }

  let backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'modal-backdrop';
    document.body.appendChild(backdrop);
  }

  backdrop.innerHTML = '';
  backdrop.appendChild(wrap);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => backdrop.classList.add('open'));
  });

  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => { backdrop.innerHTML = ''; }, 200);
    document.removeEventListener('keydown', onKey);
  };

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}

/**
 * Copy text to clipboard with fallback
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard!', 'success');
      return;
    } catch (e) { /* fallback */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  showToast('Copied to clipboard!', 'success');
}

/**
 * Format a date string into a human-readable format
 */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format file size in bytes to readable string
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Get theme — reads localStorage, falls back to 'dark'
 */
function getTheme() {
  return localStorage.getItem('theme') || 'dark';
}

/**
 * Set theme — writes localStorage and applies data-theme to <html>
 */
function setTheme(theme) {
  localStorage.setItem('theme', theme);
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/**
 * Init theme on page load
 */
function initTheme() {
  setTheme(getTheme());
}

/**
 * Toggle theme between dark and light
 */
function toggleTheme() {
  const current = getTheme();
  setTheme(current === 'dark' ? 'light' : 'dark');
}

/**
 * Get a deterministic color for a user based on their name
 */
function getUserColor(name) {
  const palette = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f97316', '#06b6d4', '#ec4899'];
  if (!name) return palette[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

/**
 * Get a gradient for a project/item based on its name
 */
function getProjectGradient(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${h},55%,28%) 0%, hsl(${(h + 45) % 360},50%,18%) 100%)`;
}

/**
 * Build a custom video player controller
 */
function createVideoPlayer(videoEl, opts = {}) {
  const { commentsGetter, onTimeUpdate, onPause } = opts;

  const container = videoEl.closest('.video-side') || videoEl.parentElement;
  const progressTrack = container.querySelector('.progress-track');
  const progressFill = container.querySelector('.progress-track-fill');
  const progressHandle = container.querySelector('.progress-track-handle');
  const markersContainer = container.querySelector('.progress-track-bg');
  const playBtn = container.querySelector('.play-btn');
  const timeDisplay = container.querySelector('.time-display');
  const volSlider = container.querySelector('.vol-slider');
  const fullscreenBtn = container.querySelector('.fullscreen-btn');
  const muteBtn = container.querySelector('.mute-btn');

  let isDragging = false;
  let prevVol = 1;

  function togglePlay() {
    if (videoEl.paused) {
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
  }

  function updatePlayBtn() {
    if (!playBtn) return;
    if (videoEl.paused) {
      playBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      playBtn.title = 'Play';
    } else {
      playBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
      playBtn.title = 'Pause';
    }
  }

  function updateMuteBtn() {
    if (!muteBtn) return;
    if (videoEl.muted || videoEl.volume === 0) {
      muteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
    } else {
      muteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;
    }
  }

  function updateProgress() {
    if (!progressFill || !progressHandle || videoEl.duration === 0 || isNaN(videoEl.duration)) return;
    const pct = (videoEl.currentTime / videoEl.duration) * 100;
    progressFill.style.width = pct + '%';
    progressHandle.style.left = pct + '%';
  }

  function updateTime() {
    if (!timeDisplay) return;
    const cur = formatTime(videoEl.currentTime);
    const dur = isNaN(videoEl.duration) ? '--:--' : formatTime(videoEl.duration);
    timeDisplay.innerHTML = `<span class="current">${cur}</span> / ${dur}`;
  }

  function renderMarkers() {
    if (!markersContainer || !videoEl.duration || isNaN(videoEl.duration)) return;
    markersContainer.querySelectorAll('.progress-marker').forEach(m => m.remove());

    const comments = commentsGetter ? commentsGetter() : [];
    const duration = videoEl.duration;

    comments.forEach(comment => {
      const pct = Math.max(0, Math.min(100, (comment.timestamp / duration) * 100));
      const marker = document.createElement('div');
      marker.className = 'progress-marker';
      marker.style.left = pct + '%';
      marker.dataset.commentId = comment.id;

      const tooltip = document.createElement('div');
      tooltip.className = 'marker-tooltip';
      tooltip.textContent = formatTime(comment.timestamp) + ' — ' + comment.text;
      marker.appendChild(tooltip);

      marker.addEventListener('click', e => {
        e.stopPropagation();
        videoEl.currentTime = comment.timestamp;
        const card = document.querySelector(`.comment-card[data-id="${comment.id}"]`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          card.classList.add('active-comment');
          setTimeout(() => card.classList.remove('active-comment'), 1500);
        }
      });

      markersContainer.appendChild(marker);
    });
  }

  function getPositionFromEvent(e) {
    const rect = progressTrack.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function seekToPosition(pos) {
    if (!isNaN(videoEl.duration)) {
      videoEl.currentTime = pos * videoEl.duration;
    }
  }

  if (progressTrack) {
    progressTrack.addEventListener('mousedown', e => {
      isDragging = true;
      seekToPosition(getPositionFromEvent(e));
      e.preventDefault();
    });

    progressTrack.addEventListener('click', e => {
      seekToPosition(getPositionFromEvent(e));
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      seekToPosition(getPositionFromEvent(e));
    });

    document.addEventListener('mouseup', () => { isDragging = false; });

    progressTrack.addEventListener('touchstart', e => {
      isDragging = true;
      seekToPosition(getPositionFromEvent(e));
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      if (!isDragging) return;
      seekToPosition(getPositionFromEvent(e));
    }, { passive: true });

    document.addEventListener('touchend', () => { isDragging = false; });
  }

  videoEl.addEventListener('play', updatePlayBtn);
  videoEl.addEventListener('pause', () => {
    updatePlayBtn();
    if (onPause) onPause();
  });
  videoEl.addEventListener('ended', updatePlayBtn);
  videoEl.addEventListener('timeupdate', () => {
    if (!isDragging) updateProgress();
    updateTime();
    if (onTimeUpdate) onTimeUpdate(videoEl.currentTime);
  });
  function fitVideo() {
    const wrapper = videoEl.parentElement;
    if (!wrapper || !videoEl.videoWidth || !videoEl.videoHeight) return;
    const ww = wrapper.clientWidth;
    const wh = wrapper.clientHeight;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!ww || !wh) return;
    if (vh > vw) {
      // Portrait: fill full height, auto width
      const newH = wh;
      const newW = Math.round(newH * vw / vh);
      videoEl.style.height = newH + 'px';
      videoEl.style.width = newW + 'px';
    } else {
      // Landscape: fill full width, auto height
      const newW = ww;
      const newH = Math.round(newW * vh / vw);
      videoEl.style.width = newW + 'px';
      videoEl.style.height = newH + 'px';
    }
  }

  videoEl.addEventListener('loadedmetadata', () => {
    fitVideo();
    updateTime();
    renderMarkers();
  });

  window.addEventListener('resize', fitVideo);
  videoEl.addEventListener('durationchange', () => {
    updateTime();
    renderMarkers();
  });

  videoEl.addEventListener('click', togglePlay);
  if (playBtn) playBtn.addEventListener('click', togglePlay);

  if (volSlider) {
    volSlider.value = 1;
    volSlider.addEventListener('input', () => {
      videoEl.volume = parseFloat(volSlider.value);
      videoEl.muted = videoEl.volume === 0;
      updateMuteBtn();
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (videoEl.muted) {
        videoEl.muted = false;
        videoEl.volume = prevVol || 0.8;
        if (volSlider) volSlider.value = videoEl.volume;
      } else {
        prevVol = videoEl.volume;
        videoEl.muted = true;
        if (volSlider) volSlider.value = 0;
      }
      updateMuteBtn();
    });
    updateMuteBtn();
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      const target = videoEl.closest('.video-side') || videoEl;
      if (!document.fullscreenElement) {
        target.requestFullscreen && target.requestFullscreen();
      } else {
        document.exitFullscreen && document.exitFullscreen();
      }
    });
  }

  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      videoEl.currentTime = Math.max(0, videoEl.currentTime - 5);
    } else if (e.key === 'ArrowRight') {
      videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 5);
    } else if (e.key === 'm' || e.key === 'M') {
      videoEl.muted = !videoEl.muted;
      updateMuteBtn();
    }
  });

  return {
    seekTo(t) { videoEl.currentTime = t; },
    getCurrentTime() { return videoEl.currentTime; },
    pause() { videoEl.pause(); },
    play() { videoEl.play().catch(() => {}); },
    renderMarkers
  };
}

/**
 * Escape HTML special chars
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
