/* ── share.js — public shared view ──────────────────────────────────────────── */
(function () {
  'use strict';

  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.indexOf('share') + 1];

  if (!token) {
    document.body.innerHTML = `<div class="error-page"><h1>Invalid Share Link</h1><p>This link appears to be malformed.</p></div>`;
    throw new Error('No share token');
  }

  // ── Guest identity (persisted in localStorage) ────────────────────────────
  function getGuestId() {
    let id = localStorage.getItem('feedo_guest_id');
    if (!id) {
      id = 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('feedo_guest_id', id);
    }
    return id;
  }
  const GUEST_ID = getGuestId();

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const videoEl           = document.getElementById('video-el');
  const projectBreadcrumb = document.getElementById('project-breadcrumb');
  const videoNameEl       = document.getElementById('video-name');
  const commentsList      = document.getElementById('comments-list');
  const commentCountBadge = document.getElementById('comment-count-badge');
  const addCommentArea    = document.getElementById('add-comment-area');
  const viewOnlyNote      = document.getElementById('view-only-note');
  const commentText       = document.getElementById('comment-text');
  const submitComment     = document.getElementById('submit-comment');
  const commentAtBadge    = document.getElementById('comment-at-badge');
  const commentAtTime     = document.getElementById('comment-at-time');
  const versionBar        = document.getElementById('version-bar');
  const versionTabs       = document.getElementById('version-tabs');
  const shareBadge        = document.getElementById('share-badge');
  const filterRow         = document.getElementById('comment-filter-row');

  // ── State ─────────────────────────────────────────────────────────────────
  let comments       = [];
  let versions       = [];
  let player         = null;
  let allowComments  = false;
  let capturedTimestamp = 0;
  let commentFilter  = 'all';
  let currentVideoData = null;

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    initTheme();

    try {
      const res = await fetch(`/api/share/${token}`);
      if (res.status === 404) {
        document.body.innerHTML = `<div class="error-page"><h1>Share Link Not Found</h1><p>This share link may have expired or been deleted.</p></div>`;
        return;
      }
      if (!res.ok) {
        document.body.innerHTML = `<div class="error-page"><h1>Error Loading</h1><p>Could not load this shared video.</p></div>`;
        return;
      }

      const data = await res.json();
      const video = data.video;
      const project = data.project;
      comments = data.comments || [];
      versions = data.versions || [];
      allowComments = !!data.allow_comments;
      currentVideoData = video;

      document.title = `${video.name} — Feedo`;
      videoNameEl.textContent = video.name;
      projectBreadcrumb.textContent = project ? project.name : 'Feedo';

      if (allowComments) {
        shareBadge.textContent = 'Shared · Can Comment';
      } else {
        shareBadge.textContent = 'View Only';
      }

      // Set video source
      videoEl.src = `/api/share/${token}/stream`;

      // Init player
      player = createVideoPlayer(videoEl, {
        commentsGetter: () => comments,
        onPause: () => {
          if (allowComments && commentText) {
            setTimeout(() => { if (videoEl.paused) commentText.focus(); }, 50);
          }
        }
      });

      // Show/hide comment form
      if (allowComments) {
        addCommentArea.style.display = 'block';
        viewOnlyNote.style.display = 'none';
        filterRow.style.display = 'flex';
        setupCommentForm();
        setupCommentFilters();
      } else {
        addCommentArea.style.display = 'none';
        viewOnlyNote.style.display = 'block';
      }

      // Render versions bar
      if (versions.length > 1) {
        versionBar.style.display = 'flex';
        renderVersionTabs(video.id);
      }

      renderComments();
    } catch (e) {
      document.body.innerHTML = `<div class="error-page"><h1>Load Error</h1><p>Could not load this shared video. Please try again.</p></div>`;
    }
  }

  // ── Version Bar ───────────────────────────────────────────────────────────
  function renderVersionTabs(activeVideoId) {
    versionTabs.innerHTML = '';
    versions.forEach(v => {
      const tab = document.createElement('div');
      tab.className = 'version-tab' + (String(v.id) === String(activeVideoId) ? ' active' : '');

      const label = document.createElement('span');
      label.className = 'version-tab-label';
      label.textContent = v.version_name || `V${v.version_number}`;
      tab.appendChild(label);
      versionTabs.appendChild(tab);

      if (!tab.classList.contains('active')) {
        tab.addEventListener('click', () => {
          window.location.href = `/share/${v.share_token}`;
        });
      }
    });
  }

  // ── Comment Filters ───────────────────────────────────────────────────────
  function setupCommentFilters() {
    filterRow.addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      commentFilter = btn.dataset.filter;
      filterRow.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderComments();
    });
  }

  // ── Render Comments ───────────────────────────────────────────────────────
  function renderComments() {
    const filtered = comments.filter(c => {
      if (commentFilter === 'open') return !c.resolved;
      if (commentFilter === 'resolved') return !!c.resolved;
      return true;
    });

    commentCountBadge.textContent = comments.length;

    if (filtered.length === 0) {
      commentsList.innerHTML = `
        <div class="no-comments">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <p>${comments.length === 0
            ? (allowComments ? 'No comments yet. Add the first one!' : 'No comments on this video yet.')
            : `No ${commentFilter === 'resolved' ? 'resolved' : 'open'} comments.`}</p>
        </div>`;
      if (player) player.renderMarkers();
      return;
    }

    commentsList.innerHTML = '';
    filtered.forEach(c => commentsList.appendChild(buildCommentCard(c)));

    if (player) player.renderMarkers();
  }

  function buildCommentCard(comment) {
    const card = document.createElement('div');
    card.className = 'comment-card' + (comment.resolved ? ' comment-resolved' : '');
    card.dataset.id = comment.id;

    const rawTs = comment.created_at || '';
    const ts = rawTs.includes('T') || rawTs.endsWith('Z') ? rawTs : rawTs.replace(' ', 'T') + 'Z';
    const date = new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });

    // Determine if this guest can edit/delete this comment
    const isMyComment = allowComments && comment.author === `guest:${GUEST_ID}`;
    const isAdminComment = comment.author === 'admin';

    card.innerHTML = `
      <div class="comment-main-row">
        ${allowComments ? `
        <button class="comment-resolve-btn${comment.resolved ? ' resolved' : ''}" data-id="${comment.id}" title="${comment.resolved ? 'Mark as open' : 'Mark as resolved'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>` : '<div style="width:22px;flex-shrink:0;"></div>'}
        <div class="comment-body">
          <div class="comment-header">
            <span class="timestamp-pill" data-ts="${comment.timestamp}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
              ${formatTime(comment.timestamp)}
            </span>
            <span class="comment-author-label">${isAdminComment ? 'Admin' : (isMyComment ? 'You' : 'Guest')}</span>
            ${isMyComment ? `
            <div class="comment-actions">
              <button class="comment-edit-btn" data-id="${comment.id}" title="Edit comment">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="comment-delete-btn" data-id="${comment.id}" title="Delete comment">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                </svg>
              </button>
            </div>` : ''}
          </div>
          <div class="comment-text" id="comment-text-${comment.id}">${escapeHtml(comment.text)}</div>
          ${isMyComment ? `
          <div class="comment-edit-form" id="comment-edit-form-${comment.id}" style="display:none;">
            <textarea class="comment-edit-textarea" id="comment-edit-input-${comment.id}">${escapeHtml(comment.text)}</textarea>
            <div class="comment-edit-actions">
              <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;" id="comment-edit-cancel-${comment.id}">Cancel</button>
              <button class="btn btn-primary" style="font-size:12px;padding:4px 10px;" id="comment-edit-save-${comment.id}">Save</button>
            </div>
          </div>` : ''}
          <div class="comment-date">${date}</div>
          <div class="comment-attachments" id="att-${comment.id}"></div>
        </div>
      </div>
    `;

    // Seek on timestamp
    card.querySelector('.timestamp-pill').addEventListener('click', () => {
      if (player) player.seekTo(comment.timestamp);
    });

    // Resolve toggle
    if (allowComments) {
      card.querySelector('.comment-resolve-btn').addEventListener('click', () => {
        toggleResolve(comment.id);
      });
    }

    // Edit/Delete (only for own guest comments)
    if (isMyComment) {
      card.querySelector('.comment-edit-btn').addEventListener('click', () => {
        startEditComment(comment.id);
      });
      card.querySelector('.comment-delete-btn').addEventListener('click', () => {
        deleteComment(comment.id);
      });
      card.querySelector(`#comment-edit-cancel-${comment.id}`).addEventListener('click', () => {
        cancelEditComment(comment.id);
      });
      card.querySelector(`#comment-edit-save-${comment.id}`).addEventListener('click', () => {
        saveEditComment(comment.id);
      });
      card.querySelector(`#comment-edit-input-${comment.id}`).addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditComment(comment.id); }
        if (e.key === 'Escape') cancelEditComment(comment.id);
      });
    }

    if (comment.attachments && comment.attachments.length > 0) {
      const attContainer = card.querySelector(`#att-${comment.id}`);
      comment.attachments.forEach(att => {
        const srcUrl = `/api/share/${token}/attachments/${att.filename}`;
        attContainer.appendChild(buildAttachmentEl(att, srcUrl));
      });
    }

    return card;
  }

  // ── Edit Comment ──────────────────────────────────────────────────────────
  function startEditComment(id) {
    const textEl = document.getElementById(`comment-text-${id}`);
    const formEl = document.getElementById(`comment-edit-form-${id}`);
    if (!textEl || !formEl) return;
    textEl.style.display = 'none';
    formEl.style.display = 'block';
    const input = document.getElementById(`comment-edit-input-${id}`);
    if (input) { input.focus(); input.select(); }
  }

  function cancelEditComment(id) {
    const textEl = document.getElementById(`comment-text-${id}`);
    const formEl = document.getElementById(`comment-edit-form-${id}`);
    if (textEl) textEl.style.display = '';
    if (formEl) formEl.style.display = 'none';
    const c = comments.find(c => c.id === id);
    const input = document.getElementById(`comment-edit-input-${id}`);
    if (c && input) input.value = c.text;
  }

  async function saveEditComment(id) {
    const input = document.getElementById(`comment-edit-input-${id}`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) { showToast('Comment cannot be empty', 'error'); return; }

    try {
      const res = await fetch(`/api/share/${token}/comments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, guest_id: GUEST_ID })
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to edit comment', 'error');
        return;
      }
      const updated = await res.json();
      const idx = comments.findIndex(c => c.id === id);
      if (idx !== -1) comments[idx] = { ...comments[idx], text: updated.text };
      renderComments();
      showToast('Comment updated', 'success');
    } catch (e) {
      showToast('Network error', 'error');
    }
  }

  // ── Resolve ───────────────────────────────────────────────────────────────
  async function toggleResolve(id) {
    try {
      const res = await fetch(`/api/share/${token}/comments/${id}/resolve`, { method: 'PATCH' });
      if (!res.ok) { showToast('Failed to update', 'error'); return; }
      const updated = await res.json();
      const idx = comments.findIndex(c => c.id === id);
      if (idx !== -1) comments[idx] = { ...comments[idx], resolved: updated.resolved };
      renderComments();
      if (player) player.renderMarkers();
    } catch (e) {
      showToast('Network error', 'error');
    }
  }

  // ── Delete Comment ────────────────────────────────────────────────────────
  async function deleteComment(id) {
    try {
      const res = await fetch(`/api/share/${token}/comments/${id}?guest_id=${encodeURIComponent(GUEST_ID)}`, {
        method: 'DELETE'
      });
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

  // ── Comment Form ──────────────────────────────────────────────────────────
  function setupCommentForm() {
    if (!commentText || !submitComment) return;

    commentText.addEventListener('focus', () => {
      if (player) player.pause();
      capturedTimestamp = videoEl.currentTime;
      commentAtTime.textContent = formatTime(capturedTimestamp);
      commentAtBadge.style.display = 'inline-flex';
    });

    submitComment.addEventListener('click', submitNewComment);

    // Enter to submit (not Shift+Enter)
    commentText.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitNewComment();
      }
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
      const res = await fetch(`/api/share/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: capturedTimestamp, text, guest_id: GUEST_ID })
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to post comment', 'error');
        return;
      }

      const newComment = await res.json();
      newComment.attachments = [];
      comments.push(newComment);
      comments.sort((a, b) => a.timestamp - b.timestamp);

      commentText.value = '';
      commentAtBadge.style.display = 'none';

      renderComments();

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

  // Init
  init();
})();
