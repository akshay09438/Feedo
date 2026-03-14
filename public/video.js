/* ── video.js — video review page ──────────────────────────────────────────── */
(function () {
  'use strict';

  const pathParts = window.location.pathname.split('/');
  const videoId = pathParts[pathParts.indexOf('video') + 1];

  if (!videoId) {
    document.body.innerHTML = `<div class="error-page"><h1>Invalid Video</h1><p>No video ID found in URL.</p><a href="/" class="btn btn-secondary" style="margin-top:12px;">Go Home</a></div>`;
    throw new Error('No video ID');
  }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const videoEl           = document.getElementById('video-el');
  const videoNameEl       = document.getElementById('video-name');
  const backLink          = document.getElementById('back-link');
  const shareBtn          = document.getElementById('share-btn');
  const deleteVideoBtn    = document.getElementById('delete-video-btn');
  const commentsList      = document.getElementById('comments-list');
  const commentCountBadge = document.getElementById('comment-count-badge');
  const commentText       = document.getElementById('comment-text');
  const submitComment     = document.getElementById('submit-comment');
  const attachBtn         = document.getElementById('attach-btn');
  const attachmentInput   = document.getElementById('attachment-input');
  const selectedFilesList = document.getElementById('selected-files-list');
  const commentAtBadge    = document.getElementById('comment-at-badge');
  const commentAtTime     = document.getElementById('comment-at-time');

  // ── State ─────────────────────────────────────────────────────────────────
  let video            = null;
  let comments         = [];
  let capturedTimestamp = 0;
  let selectedFiles    = [];
  let player           = null;

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    initTheme();

    // Auth check
    try {
      const authRes = await fetch('/api/auth/status');
      const authData = await authRes.json();
      if (!authData.authenticated) { window.location.href = '/login'; return; }
    } catch (e) {
      window.location.href = '/login';
      return;
    }

    // Load video
    try {
      const res = await fetch(`/api/videos/${videoId}`);
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (res.status === 404) {
        document.body.innerHTML = `<div class="error-page"><h1>Video Not Found</h1><p>This video may have been deleted.</p><a href="/" class="btn btn-secondary" style="margin-top:12px;">Go Home</a></div>`;
        return;
      }
      video = await res.json();
    } catch (e) {
      document.body.innerHTML = `<div class="error-page"><h1>Load Error</h1><p>Could not load video.</p><a href="/" class="btn btn-secondary" style="margin-top:12px;">Go Home</a></div>`;
      return;
    }

    document.title = `${video.name} — Feedo`;
    videoNameEl.textContent = video.name;

    // Back link: go to project if has one, otherwise home
    if (video.project_id) {
      backLink.href = `/project/${video.project_id}`;
      backLink.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back to Project
      `;
    } else {
      backLink.href = '/';
      backLink.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        All Videos
      `;
    }
    backLink.className = 'video-header-back';

    // Set video source
    videoEl.src = `/api/videos/${videoId}/stream`;

    // Init player
    player = createVideoPlayer(videoEl, {
      commentsGetter: () => comments
    });

    // Init sidebar
    initSidebar(video.project_id, videoId);

    // Load comments
    await loadComments();

    // Setup form & share & delete
    setupCommentForm();
    setupShareButton();
    setupDeleteButton();
  }

  // ── Load Comments ─────────────────────────────────────────────────────────
  async function loadComments() {
    try {
      const res = await fetch(`/api/videos/${videoId}/comments`);
      if (res.status === 401) { window.location.href = '/login'; return; }
      comments = await res.json();
      renderComments();
      if (player) player.renderMarkers();
    } catch (e) {
      commentsList.innerHTML = `<div style="text-align:center; padding:40px; color:var(--danger); font-size:13px;">Failed to load comments.</div>`;
    }
  }

  // ── Render Comments ───────────────────────────────────────────────────────
  function renderComments() {
    commentCountBadge.textContent = comments.length;

    if (comments.length === 0) {
      commentsList.innerHTML = `
        <div class="no-comments">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <p>No comments yet. Click in the video to pause and add a comment.</p>
        </div>`;
      return;
    }

    commentsList.innerHTML = '';
    comments.forEach(c => commentsList.appendChild(buildCommentCard(c)));
  }

  function buildCommentCard(comment) {
    const card = document.createElement('div');
    card.className = 'comment-card';
    card.dataset.id = comment.id;

    const date = new Date(comment.created_at).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });

    card.innerHTML = `
      <div class="comment-header">
        <span class="timestamp-pill" data-ts="${comment.timestamp}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
          ${formatTime(comment.timestamp)}
        </span>
        <button class="comment-delete-btn" data-id="${comment.id}" title="Delete comment">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </div>
      <div class="comment-text">${escapeHtml(comment.text)}</div>
      <div class="comment-date">${date}</div>
      <div class="comment-attachments" id="att-${comment.id}"></div>
    `;

    card.querySelector('.timestamp-pill').addEventListener('click', () => {
      player.seekTo(comment.timestamp);
    });

    card.querySelector('.comment-delete-btn').addEventListener('click', () => {
      deleteComment(comment.id);
    });

    if (comment.attachments && comment.attachments.length > 0) {
      const attContainer = card.querySelector(`#att-${comment.id}`);
      comment.attachments.forEach(att => {
        attContainer.appendChild(buildAttachmentEl(att, `/api/attachments/${att.filename}`));
      });
    }

    return card;
  }

  function buildAttachmentEl(att, srcUrl) {
    if (att.mime_type.startsWith('image/')) {
      const el = document.createElement('div');
      el.className = 'att-thumb';
      el.title = att.original_name;
      const img = document.createElement('img');
      img.src = srcUrl;
      img.alt = att.original_name;
      img.loading = 'lazy';
      el.appendChild(img);
      el.addEventListener('click', () => showAttachment(att, srcUrl));
      return el;
    } else if (att.mime_type.startsWith('video/')) {
      const el = document.createElement('div');
      el.className = 'att-video-thumb';
      el.title = att.original_name;
      el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
      el.addEventListener('click', () => showAttachment(att, srcUrl));
      return el;
    } else {
      const el = document.createElement('div');
      el.className = 'att-chip';
      el.title = att.original_name;
      el.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
        </svg>
        <span>${escapeHtml(att.original_name)}</span>`;
      el.addEventListener('click', () => showAttachment(att, srcUrl));
      return el;
    }
  }

  // ── Delete Comment ────────────────────────────────────────────────────────
  async function deleteComment(id) {
    try {
      const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to delete comment', 'error');
        return;
      }
      comments = comments.filter(c => c.id !== id);
      renderComments();
      if (player) player.renderMarkers();
      showToast('Comment deleted', 'success');
    } catch (e) {
      showToast('Network error', 'error');
    }
  }

  // ── Comment Form ──────────────────────────────────────────────────────────
  function setupCommentForm() {
    commentText.addEventListener('focus', () => {
      player.pause();
      capturedTimestamp = videoEl.currentTime;
      commentAtTime.textContent = formatTime(capturedTimestamp);
      commentAtBadge.style.display = 'inline-flex';
    });

    attachBtn.addEventListener('click', () => attachmentInput.click());

    attachmentInput.addEventListener('change', () => {
      const newFiles = Array.from(attachmentInput.files);
      newFiles.forEach(f => {
        const exists = selectedFiles.some(e => e.name === f.name && e.size === f.size);
        if (!exists) selectedFiles.push(f);
      });
      renderSelectedFiles();
      attachmentInput.value = '';
    });

    submitComment.addEventListener('click', submitNewComment);
    commentText.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        submitNewComment();
      }
    });
  }

  function renderSelectedFiles() {
    selectedFilesList.innerHTML = '';
    selectedFiles.forEach((f, i) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = `
        <span>${escapeHtml(f.name)}</span>
        <button class="file-chip-remove" data-index="${i}" title="Remove">&times;</button>`;
      chip.querySelector('.file-chip-remove').addEventListener('click', () => {
        selectedFiles.splice(i, 1);
        renderSelectedFiles();
      });
      selectedFilesList.appendChild(chip);
    });
  }

  async function submitNewComment() {
    const text = commentText.value.trim();
    if (!text) {
      commentText.focus();
      showToast('Please enter a comment', 'error');
      return;
    }

    submitComment.disabled = true;
    submitComment.textContent = 'Posting…';

    try {
      const res = await fetch(`/api/videos/${videoId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: capturedTimestamp, text })
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to post comment', 'error');
        return;
      }

      const newComment = await res.json();

      if (selectedFiles.length > 0) {
        const formData = new FormData();
        selectedFiles.forEach(f => formData.append('files', f));
        const attRes = await fetch(`/api/comments/${newComment.id}/attachments`, {
          method: 'POST',
          body: formData
        });
        if (attRes.ok) {
          newComment.attachments = await attRes.json();
        } else {
          showToast('Comment posted but attachments failed to upload', 'info');
          newComment.attachments = [];
        }
      }

      comments.push(newComment);
      comments.sort((a, b) => a.timestamp - b.timestamp);

      commentText.value = '';
      selectedFiles = [];
      renderSelectedFiles();
      commentAtBadge.style.display = 'none';

      renderComments();
      if (player) player.renderMarkers();

      const newCard = document.querySelector(`.comment-card[data-id="${newComment.id}"]`);
      if (newCard) {
        newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        newCard.classList.add('active-comment');
        setTimeout(() => newCard.classList.remove('active-comment'), 1500);
      }

      showToast('Comment added', 'success');
    } catch (e) {
      showToast('Network error', 'error');
    } finally {
      submitComment.disabled = false;
      submitComment.textContent = 'Add Comment';
    }
  }

  // ── Share Button ──────────────────────────────────────────────────────────
  function setupShareButton() {
    shareBtn.addEventListener('click', () => showShareModal());
  }

  function showShareModal() {
    const shareUrl = `${location.origin}/share/${video.share_token}`;

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Share Video</span>
        <button class="modal-close" id="share-close">&times;</button>
      </div>
      <p style="font-size:13px; color:var(--text-secondary); margin-bottom:14px;">
        Share this link with your client or team to get feedback.
      </p>
      <div class="share-url-row">
        <input type="text" value="${escapeHtml(shareUrl)}" readonly id="share-url-input" />
        <button id="copy-share-btn">Copy</button>
      </div>
      <div class="share-permission">
        <label class="toggle-label">
          <input type="checkbox" id="allow-comments-toggle" ${video.allow_comments ? 'checked' : ''} />
          <span class="toggle-switch"></span>
          Allow viewers to add comments
        </label>
        <p class="help-text">When enabled, anyone with the link can add timestamped comments</p>
      </div>
      <div class="share-permission-info" id="share-perm-info">
        ${video.allow_comments
          ? '✅ Viewers can add comments'
          : '👁 View only — no comments allowed'}
      </div>
    `;

    const modal = showModal(content);
    content.querySelector('#share-close').addEventListener('click', () => modal.close());

    content.querySelector('#copy-share-btn').addEventListener('click', async () => {
      await copyToClipboard(shareUrl);
    });

    content.querySelector('#allow-comments-toggle').addEventListener('change', async (e) => {
      const allowed = e.target.checked ? 1 : 0;
      try {
        await fetch(`/api/videos/${videoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allow_comments: allowed })
        });
        video.allow_comments = allowed;
        content.querySelector('#share-perm-info').textContent =
          allowed ? '✅ Viewers can add comments' : '👁 View only — no comments allowed';
        showToast(allowed ? 'Comments enabled' : 'Comments disabled', 'info');
      } catch (err) {
        showToast('Failed to update permission', 'error');
        e.target.checked = !e.target.checked;
      }
    });
  }

  // ── Delete Video Button ───────────────────────────────────────────────────
  function setupDeleteButton() {
    deleteVideoBtn.addEventListener('click', () => {
      const content = document.createElement('div');
      content.innerHTML = `
        <div class="modal-header">
          <span class="modal-title">Delete Video</span>
          <button class="modal-close" id="modal-close-btn">&times;</button>
        </div>
        <p style="color:var(--text-secondary); font-size:14px; margin-bottom:20px; line-height:1.6;">
          Are you sure you want to delete <strong style="color:var(--text-primary);">${escapeHtml(video.name)}</strong>?
          This will permanently delete the video, all comments, and attachments. This cannot be undone.
        </p>
        <div class="modal-footer" style="margin-top:0;">
          <button class="btn btn-secondary" id="cancel-delete">Cancel</button>
          <button class="btn btn-primary" id="confirm-delete" style="background:var(--danger);">Delete Video</button>
        </div>
      `;

      const modal = showModal(content);
      content.querySelector('#modal-close-btn').addEventListener('click', () => modal.close());
      content.querySelector('#cancel-delete').addEventListener('click', () => modal.close());
      content.querySelector('#confirm-delete').addEventListener('click', async () => {
        const btn = content.querySelector('#confirm-delete');
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        try {
          const res = await fetch(`/api/videos/${videoId}`, { method: 'DELETE' });
          if (res.ok) {
            modal.close();
            showToast('Video deleted', 'success');
            // Redirect back
            if (video.project_id) {
              window.location.href = `/project/${video.project_id}`;
            } else {
              window.location.href = '/';
            }
          } else {
            const err = await res.json();
            showToast(err.error || 'Failed to delete video', 'error');
            btn.disabled = false;
            btn.textContent = 'Delete Video';
          }
        } catch (e) {
          showToast('Network error', 'error');
          btn.disabled = false;
          btn.textContent = 'Delete Video';
        }
      });
    });
  }

  // Init
  init();
})();
