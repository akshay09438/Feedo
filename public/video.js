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
  const versionTabs       = document.getElementById('version-tabs');
  const versionFileInput  = document.getElementById('version-file-input');
  const historyPanelHeader = document.getElementById('history-panel-header');
  const historyPanelBody  = document.getElementById('history-panel-body');
  const historyList       = document.getElementById('history-list');

  // ── State ─────────────────────────────────────────────────────────────────
  let video            = null;
  let comments         = [];
  let versions         = [];
  let annotations      = [];
  let pendingAnnotation = null;
  let capturedTimestamp = 0;
  let pinnedAnnotTime  = null; // exact timestamp for annotation rendering (survives keyframe snaps)
  let selectedFiles    = [];
  let player           = null;
  let commentFilter    = 'all';
  let historyOpen      = false;

  // ── Per-author sequential color assignment ────────────────────────────────
  const authorColorMap   = new Map();
  const colorPalette     = ['#f59e0b','#10b981','#8b5cf6','#ef4444','#f97316','#06b6d4','#ec4899','#84cc16','#a78bfa','#fb923c'];
  function getAuthorColor(author) {
    if (!authorColorMap.has(author)) {
      authorColorMap.set(author, colorPalette[authorColorMap.size % colorPalette.length]);
    }
    return authorColorMap.get(author);
  }

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

    // Back link
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
      commentsGetter: () => comments,
      onPause: () => {
        // Auto-focus comment box on pause
        setTimeout(() => { if (videoEl.paused) commentText.focus(); }, 50);
      },
      onManualSeek: () => {
        // User scrubbed or used arrow keys — release the pinned annotation time
        pinnedAnnotTime = null;
      }
    });

    // Init sidebar — pass version_group_id so all versions of this file stay highlighted
    initSidebar(video.project_id, videoId, video.version_group_id);

    // Load comments, versions, annotations
    await Promise.all([loadComments(), loadVersions(), loadAnnotations()]);

    // Ask for display name if not set
    if (!localStorage.getItem('feedo_display_name')) {
      showAdminNameGate();
    }

    // Setup everything
    setupCommentForm();
    setupShareButton();
    setupDeleteButton();
    setupCommentFilters();
    setupHistoryPanel();
    setupVersionBar();
    setupResizeHandle();
    setupAnnotations();
    startCommentPolling();

    // Expose a hook so VideoAnnotator can inject annotation comments
    window._feedo = {
      addComment(c) {
        comments.push(c);
        comments.sort((a, b) => a.timestamp - b.timestamp);
        renderComments();
        if (player) player.renderMarkers();
        // Scroll to the new card
        const newCard = document.querySelector(`.comment-card[data-id="${c.id}"]`);
        if (newCard) {
          newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          newCard.classList.add('active-comment');
          setTimeout(() => newCard.classList.remove('active-comment'), 1500);
        }
      }
    };
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

  // ── Load Annotations ──────────────────────────────────────────────────────
  async function loadAnnotations() {
    try {
      const res = await fetch(`/api/videos/${videoId}/annotations`);
      if (res.ok) annotations = await res.json();
    } catch(e) { /* non-critical */ }
  }

  // ── Load Versions ─────────────────────────────────────────────────────────
  async function loadVersions() {
    try {
      const res = await fetch(`/api/videos/${videoId}/versions`);
      if (!res.ok) return;
      versions = await res.json();
      renderVersionTabs();
    } catch (e) {
      // non-critical
    }
  }

  // ── Comment Filters ───────────────────────────────────────────────────────
  function setupCommentFilters() {
    document.getElementById('comment-filter-row').addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      commentFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderComments();
    });
  }

  // ── Render Comments ───────────────────────────────────────────────────────
  function renderComments() {
    const topLevel = comments.filter(c => !c.parent_id);
    const filtered = topLevel.filter(c => {
      if (commentFilter === 'open') return !c.resolved;
      if (commentFilter === 'resolved') return !!c.resolved;
      return true;
    });

    commentCountBadge.textContent = topLevel.length;

    if (filtered.length === 0) {
      commentsList.innerHTML = `
        <div class="no-comments">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <p>${topLevel.length === 0
            ? 'No comments yet. Click in the video to pause and add a comment.'
            : `No ${commentFilter === 'resolved' ? 'resolved' : 'open'} comments.`}</p>
        </div>`;
      return;
    }

    // Seed color map in chronological order so colors are stable
    comments.forEach(c => getAuthorColor(c.author || 'admin'));

    commentsList.innerHTML = '';
    filtered.forEach(c => commentsList.appendChild(buildCommentCard(c)));
  }

  function buildCommentCard(comment) {
    const card = document.createElement('div');
    card.className = 'comment-card' + (comment.resolved ? ' comment-resolved' : '');
    card.dataset.id = comment.id;

    const date = timeAgo(comment.created_at);

    const author = comment.author || 'admin';
    const isAdmin = !author.startsWith('guest:');
    const displayAuthor = author.startsWith('guest:') ? 'Guest' : author;
    const pillColor = getAuthorColor(author);

    // Check for annotation visual data (canvas drawing)
    let annotData = null;
    try { annotData = JSON.parse(localStorage.getItem('annot_' + comment.id)); } catch(e) {}
    const annotBadge = annotData ? `<span style="font-size:11px; color:var(--text-secondary); margin-left:4px;">🎨 Drawing</span>` : '';
    const annotThumb = annotData && annotData.thumbnailDataUrl ? `
      <div style="margin:6px 0;">
        <img src="${annotData.thumbnailDataUrl}"
          style="width:100%; max-height:90px; object-fit:cover; border-radius:6px; display:block; border:1px solid var(--border);"
          alt="annotation preview" />
      </div>` : '';

    card.innerHTML = `
      <div class="comment-main-row">
        <button class="comment-resolve-btn${comment.resolved ? ' resolved' : ''}" data-id="${comment.id}" title="${comment.resolved ? 'Mark as open' : 'Mark as resolved'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
        <div class="comment-body">
          <div class="comment-header">
            <span class="timestamp-pill" data-ts="${comment.timestamp}" style="background:${pillColor}22; border-color:${pillColor}44; color:${pillColor};">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
              ${formatTime(comment.timestamp)}
            </span>
            <span class="comment-author-label">${escapeHtml(displayAuthor)}</span>
            ${annotBadge}
            <div class="comment-actions" data-id="${comment.id}">
              ${isAdmin ? `
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
              ` : ''}
            </div>
          </div>
          ${annotThumb}
          <div class="comment-text" id="comment-text-${comment.id}">${escapeHtml(comment.text)}</div>
          <div class="comment-edit-form" id="comment-edit-form-${comment.id}" style="display:none;">
            <textarea class="comment-edit-textarea" id="comment-edit-input-${comment.id}">${escapeHtml(comment.text)}</textarea>
            <div class="comment-edit-actions">
              <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;" data-id="${comment.id}" id="comment-edit-cancel-${comment.id}">Cancel</button>
              <button class="btn btn-primary" style="font-size:12px;padding:4px 10px;" data-id="${comment.id}" id="comment-edit-save-${comment.id}">Save</button>
            </div>
          </div>
          <div class="comment-date">${date}</div>
          <div class="comment-attachments" id="att-${comment.id}"></div>
          <div class="replies-list" id="replies-list-${comment.id}"></div>
          <div class="reply-thread-actions">
            <button class="reply-btn">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>
              </svg>
              Reply
            </button>
            <div class="reply-form-wrap" id="reply-form-${comment.id}" style="display:none;">
              <textarea class="comment-textarea reply-textarea" placeholder="Write a reply…" rows="2" style="min-height:60px;"></textarea>
              <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px;">
                <button class="btn btn-secondary reply-cancel-btn" style="font-size:12px;padding:4px 10px;">Cancel</button>
                <button class="btn btn-primary reply-submit-btn" style="font-size:12px;padding:4px 10px;">Post Reply</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Click anywhere on card to seek and pin annotation time
    card.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('.comment-edit-form')) return;
      pinnedAnnotTime = comment.timestamp;
      // Suppress the pause event that seekTo fires so _startAnnotating doesn't
      // flash the draw toolbar or clear the canvas before _onCommentClick loads.
      if (annotData && window._videoAnnotator) {
        window._videoAnnotator._suppressPause = true;
      }
      player.seekTo(comment.timestamp);
      // If this comment has annotation drawing data, replay it on the canvas
      if (annotData && window._videoAnnotator) {
        window._videoAnnotator._onCommentClick({
          timestamp: comment.timestamp,
          strokes: annotData.strokes || [],
          textBoxes: annotData.textBoxes || [],
          thumbnailDataUrl: annotData.thumbnailDataUrl
        });
      }
    });

    // Resolve checkbox
    card.querySelector('.comment-resolve-btn').addEventListener('click', e => {
      e.stopPropagation();
      toggleResolve(comment.id);
    });

    // Edit/Delete (admin only)
    if (isAdmin) {
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
      // Enter to save edit
      card.querySelector(`#comment-edit-input-${comment.id}`).addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveEditComment(comment.id);
        }
        if (e.key === 'Escape') cancelEditComment(comment.id);
      });
    }

    if (comment.attachments && comment.attachments.length > 0) {
      const attContainer = card.querySelector(`#att-${comment.id}`);
      comment.attachments.forEach(att => {
        attContainer.appendChild(buildAttachmentEl(att, `/api/attachments/${att.filename}`));
      });
    }

    // Render existing replies
    const repliesList = card.querySelector(`#replies-list-${comment.id}`);
    if (repliesList) {
      comments.filter(r => r.parent_id === comment.id)
        .forEach(r => repliesList.appendChild(buildAdminReplyCard(r)));
    }

    // Reply form listeners
    const replyBtn = card.querySelector('.reply-btn');
    const replyFormWrap = card.querySelector(`#reply-form-${comment.id}`);
    if (replyBtn && replyFormWrap) {
      replyBtn.addEventListener('click', e => {
        e.stopPropagation();
        const visible = replyFormWrap.style.display !== 'none';
        replyFormWrap.style.display = visible ? 'none' : 'block';
        if (!visible) replyFormWrap.querySelector('.reply-textarea').focus();
      });
      replyFormWrap.querySelector('.reply-cancel-btn').addEventListener('click', e => {
        e.stopPropagation();
        replyFormWrap.style.display = 'none';
      });
      const doSubmitReply = () => submitAdminReply(comment.id, card);
      replyFormWrap.querySelector('.reply-submit-btn').addEventListener('click', e => {
        e.stopPropagation();
        doSubmitReply();
      });
      replyFormWrap.querySelector('.reply-textarea').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSubmitReply(); }
      });
    }

    return card;
  }

  // ── Admin Reply Card ───────────────────────────────────────────────────────
  function buildAdminReplyCard(reply) {
    const card = document.createElement('div');
    card.className = 'reply-card';
    card.dataset.id = reply.id;

    const authorRaw = reply.author || 'guest';
    const displayAuthor = authorRaw.startsWith('guest:') ? 'Guest' : authorRaw;
    const pillColor = getAuthorColor(authorRaw);
    const date = timeAgo(reply.created_at);

    card.innerHTML = `
      <div class="reply-header">
        <span class="timestamp-pill reply-timestamp-pill" data-ts="${reply.timestamp}" style="background:${pillColor}22; border-color:${pillColor}44; color:${pillColor};">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
          ${formatTime(reply.timestamp)}
        </span>
        <span class="comment-author-label" style="font-size:12px;">${escapeHtml(displayAuthor)}</span>
        <span class="reply-date">${date}</span>
        <div class="comment-actions">
          <button class="reply-delete-btn" data-id="${reply.id}" title="Delete">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="reply-text">${escapeHtml(reply.text)}</div>
    `;

    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      player.seekTo(reply.timestamp);
    });

    card.querySelector('.reply-delete-btn').addEventListener('click', async e => {
      e.stopPropagation();
      try {
        const res = await fetch(`/api/comments/${reply.id}`, { method: 'DELETE' });
        if (!res.ok) { const err = await res.json(); showToast(err.error || 'Failed', 'error'); return; }
        comments = comments.filter(c => c.id !== reply.id);
        card.remove();
        showToast('Reply deleted', 'success');
      } catch(e) { showToast('Network error', 'error'); }
    });

    return card;
  }

  // ── Submit Admin Reply ─────────────────────────────────────────────────────
  async function submitAdminReply(parentId, commentCard) {
    const replyFormWrap = commentCard.querySelector(`#reply-form-${parentId}`);
    if (!replyFormWrap) return;
    const textarea  = replyFormWrap.querySelector('.reply-textarea');
    const submitBtn = replyFormWrap.querySelector('.reply-submit-btn');
    const text = textarea.value.trim();
    if (!text) { textarea.focus(); showToast('Please enter a reply', 'error'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting…';
    try {
      const res = await fetch(`/api/videos/${videoId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, parent_id: parentId })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || 'Failed', 'error'); return; }
      const newReply = await res.json();
      newReply.attachments = [];
      comments.push(newReply);

      const repliesList = commentCard.querySelector(`#replies-list-${parentId}`);
      if (repliesList) repliesList.appendChild(buildAdminReplyCard(newReply));

      textarea.value = '';
      replyFormWrap.style.display = 'none';
      showToast('Reply posted', 'success');
    } catch(e) {
      showToast('Network error', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Post Reply';
    }
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
    // Restore original text
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
      const res = await fetch(`/api/comments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to edit comment', 'error');
        return;
      }
      const updated = await res.json();
      const idx = comments.findIndex(c => c.id === id);
      if (idx !== -1) comments[idx] = { ...comments[idx], text: updated.text };
      // Targeted update — avoids destroying open reply forms
      const textEl = document.getElementById(`comment-text-${id}`);
      if (textEl) textEl.textContent = updated.text;
      cancelEditComment(id);
      showToast('Comment updated', 'success');
    } catch (e) {
      showToast('Network error', 'error');
    }
  }

  // ── Resolve Comment ───────────────────────────────────────────────────────
  async function toggleResolve(id) {
    try {
      const res = await fetch(`/api/comments/${id}/resolve`, { method: 'PATCH' });
      if (!res.ok) { showToast('Failed to update', 'error'); return; }
      const updated = await res.json();
      const idx = comments.findIndex(c => c.id === id);
      if (idx !== -1) comments[idx] = { ...comments[idx], resolved: updated.resolved };
      // Targeted DOM update — preserve open reply forms
      const card = document.querySelector(`.comment-card[data-id="${id}"]`);
      if (card) {
        card.classList.toggle('comment-resolved', !!updated.resolved);
        const btn = card.querySelector('.comment-resolve-btn');
        if (btn) {
          btn.classList.toggle('resolved', !!updated.resolved);
          btn.title = updated.resolved ? 'Mark as open' : 'Mark as resolved';
        }
      } else {
        renderComments();
      }
      if (player) player.renderMarkers();
    } catch (e) {
      showToast('Network error', 'error');
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
      comments = comments.filter(c => c.id !== id && c.parent_id !== id);
      localStorage.removeItem('annot_' + id);
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

  // ── Admin name gate ────────────────────────────────────────────────────────
  function showAdminNameGate() {
    const addArea = document.querySelector('.add-comment-area');
    if (!addArea) return;

    const gate = document.createElement('div');
    gate.id = 'admin-name-gate';
    gate.className = 'name-gate';
    gate.innerHTML = `
      <p class="name-gate-label">Enter your name to start commenting</p>
      <div class="name-gate-row">
        <input type="text" id="admin-name-input" class="form-input" placeholder="Your name…" autocomplete="off" />
        <button class="btn btn-primary" id="admin-name-confirm">Continue →</button>
      </div>
    `;
    addArea.parentNode.insertBefore(gate, addArea);
    addArea.style.display = 'none';

    const input = gate.querySelector('#admin-name-input');
    const btn   = gate.querySelector('#admin-name-confirm');

    function confirm() {
      const name = input.value.trim();
      if (!name) { input.classList.add('input-error'); input.focus(); return; }
      input.classList.remove('input-error');
      localStorage.setItem('feedo_display_name', name);
      gate.remove();
      addArea.style.display = '';
    }

    btn.addEventListener('click', confirm);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
    setTimeout(() => input.focus(), 100);
  }

  // ── Comment Form ──────────────────────────────────────────────────────────
  function setupCommentForm() {
    // Auto-focus on pause (from player callback) — also focus on explicit focus events
    commentText.addEventListener('focus', () => {
      player.pause();
      // Don't overwrite timestamp if an annotation is pending (it has its own timestamp)
      if (!pendingAnnotation) {
        capturedTimestamp = videoEl.currentTime;
        commentAtTime.textContent = formatTime(capturedTimestamp);
        commentAtBadge.style.display = 'inline-flex';
      }
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

    // Enter to submit (not Shift+Enter)
    commentText.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
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

    const displayName = localStorage.getItem('feedo_display_name') || 'Admin';

    try {
      const res = await fetch(`/api/videos/${videoId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: capturedTimestamp, text, display_name: displayName })
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

      // Annotation was already saved in postAnnotation() — just clear the flag
      pendingAnnotation = null;

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

  // ── Version Bar ───────────────────────────────────────────────────────────
  function renderVersionTabs() {
    versionTabs.innerHTML = '';

    versions.forEach(v => {
      const tab = document.createElement('div');
      tab.className = 'version-tab' + (String(v.id) === String(videoId) ? ' active' : '');
      tab.dataset.id = v.id;

      const label = document.createElement('span');
      label.className = 'version-tab-label';
      label.textContent = v.version_name || `V${v.version_number}`;
      label.title = 'Click to rename';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'version-tab-delete';
      deleteBtn.title = `Delete ${v.version_name || `V${v.version_number}`}`;
      deleteBtn.innerHTML = '&times;';

      tab.appendChild(label);
      tab.appendChild(deleteBtn);
      versionTabs.appendChild(tab);

      // Click tab to navigate
      tab.addEventListener('click', e => {
        if (e.target.closest('.version-tab-delete')) return;
        if (e.target === label && tab.classList.contains('active')) {
          startVersionRename(tab, label, v);
          return;
        }
        if (!tab.classList.contains('active')) {
          window.location.href = `/video/${v.id}`;
        }
      });

      // Double-click to rename
      label.addEventListener('dblclick', e => {
        e.stopPropagation();
        startVersionRename(tab, label, v);
      });

      // Delete version
      deleteBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const vname = v.version_name || `V${v.version_number}`;
        if (!confirm(`Delete ${vname}? This will permanently remove this version and its comments.`)) return;

        deleteBtn.disabled = true;
        try {
          const res = await fetch(`/api/videos/${v.id}`, { method: 'DELETE' });
          if (!res.ok) {
            const err = await res.json();
            showToast(err.error || 'Failed to delete version', 'error');
            deleteBtn.disabled = false;
            return;
          }

          showToast(`${vname} deleted`, 'success');

          if (versions.length === 1) {
            // Last version — go home or project
            window.location.href = video.project_id ? `/project/${video.project_id}` : '/';
          } else if (String(v.id) === String(videoId)) {
            // Deleting current version — navigate to another
            const next = versions.find(vv => String(vv.id) !== String(v.id));
            window.location.href = `/video/${next.id}`;
          } else {
            // Deleting a non-active version — just refresh tabs
            versions = versions.filter(vv => vv.id !== v.id);
            renderVersionTabs();
          }
        } catch (err) {
          showToast('Network error', 'error');
          deleteBtn.disabled = false;
        }
      });
    });

    // Add "+" button right after the last tab
    const addBtn = document.createElement('button');
    addBtn.className = 'version-add-btn';
    addBtn.id = 'version-add-btn';
    addBtn.title = 'Add new version';
    addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    addBtn.addEventListener('click', () => versionFileInput.click());
    versionTabs.appendChild(addBtn);
  }

  function startVersionRename(tab, label, version) {
    if (tab.querySelector('.version-tab-input')) return;
    const input = document.createElement('input');
    input.className = 'version-tab-input';
    input.value = label.textContent;
    input.style.width = Math.max(40, label.textContent.length * 8 + 16) + 'px';
    label.style.display = 'none';
    tab.insertBefore(input, label);
    input.focus();
    input.select();

    async function saveRename() {
      const newName = input.value.trim();
      if (newName && newName !== version.version_name) {
        try {
          const res = await fetch(`/api/versions/${version.id}/name`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
          });
          if (res.ok) {
            version.version_name = newName;
            label.textContent = newName;
            showToast('Version renamed', 'success');
          } else {
            showToast('Failed to rename', 'error');
          }
        } catch (e) {
          showToast('Network error', 'error');
        }
      } else {
        label.textContent = version.version_name || `V${version.version_number}`;
      }
      input.remove();
      label.style.display = '';
    }

    input.addEventListener('blur', saveRename);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
      if (e.key === 'Escape') { input.remove(); label.style.display = ''; }
    });
  }

  function setupVersionBar() {
    versionFileInput.addEventListener('change', async () => {
      if (!versionFileInput.files.length) return;
      const file = versionFileInput.files[0];
      versionFileInput.value = '';

      const formData = new FormData();
      formData.append('video', file);

      const addBtn = document.getElementById('version-add-btn');
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div>`;
      }

      const beforeUnloadHandler = e => {
        e.preventDefault();
        e.returnValue = 'Video is still uploading. Do not close this tab before the upload is complete.';
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);

      try {
        const res = await fetch(`/api/videos/${videoId}/versions`, {
          method: 'POST',
          body: formData
        });

        if (!res.ok) {
          const err = await res.json();
          showToast(err.error || 'Failed to upload version', 'error');
          return;
        }

        const newVersion = await res.json();
        showToast(`${newVersion.version_name} uploaded! Navigating…`, 'success');
        setTimeout(() => { window.location.href = `/video/${newVersion.id}`; }, 1000);
      } catch (e) {
        showToast('Network error', 'error');
      } finally {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
        if (addBtn) {
          addBtn.disabled = false;
          addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        }
      }
    });
  }

  // ── History Panel ─────────────────────────────────────────────────────────
  function setupHistoryPanel() {
    historyPanelHeader.addEventListener('click', async () => {
      historyOpen = !historyOpen;
      historyPanelBody.style.display = historyOpen ? 'block' : 'none';
      document.getElementById('history-chevron').style.transform = historyOpen ? 'rotate(90deg)' : '';

      if (historyOpen) {
        await loadHistory();
      }
    });
  }

  async function loadHistory() {
    historyList.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-secondary); font-size:12px;"><div class="spinner" style="margin:0 auto 8px;width:16px;height:16px;border-width:2px;"></div></div>`;

    try {
      const res = await fetch(`/api/videos/${videoId}/history`);
      if (!res.ok) { historyList.innerHTML = `<div style="padding:12px; font-size:12px; color:var(--danger);">Failed to load history.</div>`; return; }
      const rows = await res.json();

      // Only show version-related events (not comments — those are in the comments panel)
      const versionRows = rows.filter(r => r.action && r.action.startsWith('version_'));

      if (versionRows.length === 0) {
        historyList.innerHTML = `<div style="padding:12px; font-size:12px; color:var(--text-muted); text-align:center;">No version history yet.</div>`;
        return;
      }

      historyList.innerHTML = '';
      versionRows.forEach(row => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const dt = new Date(row.created_at).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        item.innerHTML = `
          <div class="history-item-meta">
            <span class="history-actor">${escapeHtml(row.actor || 'admin')}</span>
            <span class="history-time">${dt}</span>
          </div>
          <div class="history-detail">${escapeHtml(row.detail || row.action)}</div>
        `;
        historyList.appendChild(item);
      });
    } catch (e) {
      historyList.innerHTML = `<div style="padding:12px; font-size:12px; color:var(--danger);">Failed to load history.</div>`;
    }
  }

  // ── Share Button ──────────────────────────────────────────────────────────
  function setupShareButton() {
    shareBtn.addEventListener('click', () => showShareModal());
  }

  function showShareModal() {
    const editUrl = `${location.origin}/share/${video.share_token}`;
    const viewUrl = video.view_token ? `${location.origin}/share/${video.view_token}` : null;

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Share Video</span>
        <button class="modal-close" id="share-close">&times;</button>
      </div>
      <p style="font-size:13px; color:var(--text-secondary); margin-bottom:16px;">
        Share these links with your client or team to get feedback.
      </p>

      <div style="margin-bottom:14px;">
        <div style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.05em;">
          ✏️ Can Comment &amp; Annotate
        </div>
        <div class="share-url-row">
          <input type="text" value="${escapeHtml(editUrl)}" readonly id="share-edit-url" />
          <button id="copy-edit-btn">Copy</button>
        </div>
        <p style="font-size:11px; color:var(--text-secondary); margin-top:5px;">Viewers can add comments, drawings, and text annotations.</p>
      </div>

      ${viewUrl ? `
      <div>
        <div style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.05em;">
          👁 View Only
        </div>
        <div class="share-url-row">
          <input type="text" value="${escapeHtml(viewUrl)}" readonly id="share-view-url" />
          <button id="copy-view-btn">Copy</button>
        </div>
        <p style="font-size:11px; color:var(--text-secondary); margin-top:5px;">Viewers can only watch the video and read comments.</p>
      </div>` : ''}
    `;

    const modal = showModal(content);
    content.querySelector('#share-close').addEventListener('click', () => modal.close());
    content.querySelector('#copy-edit-btn').addEventListener('click', async () => {
      await copyToClipboard(editUrl);
    });
    if (viewUrl) {
      content.querySelector('#copy-view-btn').addEventListener('click', async () => {
        await copyToClipboard(viewUrl);
      });
    }
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

  // ── Real-time Comment Polling ─────────────────────────────────────────────
  function startCommentPolling() {
    setInterval(async () => {
      // Skip polling when tab is hidden or user is actively interacting
      if (document.hidden) return;
      if (submitComment.disabled) return;
      const activeEl = document.activeElement;
      if (activeEl && (activeEl === commentText || activeEl.classList.contains('comment-edit-textarea') || activeEl.classList.contains('reply-textarea'))) return;
      // Don't poll if an inline edit or reply form is currently open
      if (document.querySelector('.comment-edit-form[style*="block"]')) return;
      if (document.querySelector('.reply-form-wrap[style*="block"]')) return;

      try {
        const res = await fetch(`/api/videos/${videoId}/comments`);
        if (!res.ok) return;
        const fresh = await res.json();

        // O(1) lookup diff using a Map — handles reordering correctly
        const existingMap = new Map(comments.map(c => [c.id, c]));
        const changed =
          fresh.length !== comments.length ||
          fresh.some(c => {
            const existing = existingMap.get(c.id);
            return !existing || c.resolved !== existing.resolved || c.text !== existing.text;
          });

        if (changed) {
          comments = fresh;
          renderComments();
          if (player) player.renderMarkers();
        }
      } catch (e) {
        // silent — don't disrupt the user
      }
    }, 8000);
  }

  // ── Resize Handle ─────────────────────────────────────────────────────────
  function setupResizeHandle() {
    const handle = document.getElementById('panel-resize-handle');
    const commentsPanel = document.getElementById('comments-panel');
    const layout = document.querySelector('.video-layout');
    if (!handle || !commentsPanel || !layout) return;

    let isResizing = false;

    handle.addEventListener('mousedown', e => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!isResizing) return;
      const rect = layout.getBoundingClientRect();
      const newCommentsWidth = rect.right - e.clientX;
      if (newCommentsWidth < 220 || newCommentsWidth > rect.width - 320) return;
      commentsPanel.style.width = newCommentsWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // ── Annotations ───────────────────────────────────────────────────────────
  function setupAnnotations() {
    const annotCanvas = document.getElementById('annot-canvas');
    const drawCanvas  = document.getElementById('draw-canvas');
    const textOverlay = document.getElementById('text-overlay');
    const actionBar   = document.getElementById('annot-action-bar');
    const postBtn     = document.getElementById('annot-post-btn');
    const cancelBtn   = document.getElementById('annot-cancel-btn');
    const undoBtn     = document.getElementById('annot-undo-btn');
    const textBtn     = document.getElementById('annot-text-btn');
    const drawBtn     = document.getElementById('annot-draw-btn');

    if (!annotCanvas || !postBtn) return;

    const annotCtx = annotCanvas.getContext('2d');
    const DRAW_COLOR = '#ef4444';
    const WINDOW = 0.25;
    let mode = null;
    let strokes = [], currentStroke = [], drawing = false;

    // ── Canvas sizing: cover the entire video-wrapper ─────────────────────
    function sizeCanvases() {
      const wrapper = videoEl.parentElement;
      const w = wrapper.clientWidth  || 640;
      const h = wrapper.clientHeight || 360;
      for (const el of [annotCanvas, drawCanvas, textOverlay]) {
        el.style.left = '0px'; el.style.top = '0px';
        el.style.width = w + 'px'; el.style.height = h + 'px';
      }
      annotCanvas.width = w; annotCanvas.height = h;
      drawCanvas.width  = w; drawCanvas.height  = h;
    }

    ['loadedmetadata','loadeddata','canplay'].forEach(ev => videoEl.addEventListener(ev, sizeCanvases));
    window.addEventListener('resize', sizeCanvases);
    setTimeout(sizeCanvases, 200); setTimeout(sizeCanvases, 800);

    // ── Draw saved + pending annotations on the read-only canvas ──────────
    function drawAnnotOnCtx(ctx, type, data, color, w, h) {
      if (type === 'draw') {
        (data.strokes || []).forEach(strk => {
          if (!strk.points || strk.points.length < 2) return;
          ctx.beginPath();
          ctx.strokeStyle = color || DRAW_COLOR;
          ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          strk.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x*w, p.y*h) : ctx.lineTo(p.x*w, p.y*h));
          ctx.stroke();
        });
      } else if (type === 'text') {
        const fontSize = 18;
        ctx.font = `bold ${fontSize}px 'Times New Roman', Times, serif`;
        const tx = data.x * w, ty = data.y * h;
        const txt = data.text || '';
        const pad = 6;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(tx - pad, ty - fontSize, tw + pad * 2, fontSize + pad * 1.5);
        ctx.fillStyle = color || '#ffffff';
        ctx.fillText(txt, tx, ty);
      }
    }

    function renderAnnotationsAtTime(t) {
      const w = annotCanvas.width, h = annotCanvas.height;
      annotCtx.clearRect(0, 0, w, h);
      annotations.filter(a => Math.abs(a.timestamp - t) <= WINDOW)
        .forEach(a => drawAnnotOnCtx(annotCtx, a.type, a.data, a.color, w, h));
    }

    let _lastAnnotTime = -1;
    let _lastAnnotCount = 0;

    // Clear pinned time when video plays (user moved on)
    videoEl.addEventListener('play', () => { pinnedAnnotTime = null; });

    (function rafLoop() {
      if (!document.hidden && !mode) {
        // Use pinned time (exact annotation timestamp), fall back to currentTime
        const t = pinnedAnnotTime !== null ? pinnedAnnotTime : videoEl.currentTime;
        // When paused, always render — guarantees annotations stay visible on screen.
        // When playing, only re-render when time or annotation count changes (perf).
        const needsRender = videoEl.paused
          || t !== _lastAnnotTime
          || annotations.length !== _lastAnnotCount;
        if (needsRender) {
          _lastAnnotTime = t;
          _lastAnnotCount = annotations.length;
          renderAnnotationsAtTime(t);
        }
      }
      requestAnimationFrame(rafLoop);
    })();

    // ── Cancel ────────────────────────────────────────────────────────────
    function cancelAnnotation() {
      mode = null; strokes = []; currentStroke = []; drawing = false;
      drawCanvas.style.display = 'none';
      drawCanvas.onmousedown = drawCanvas.onmousemove = drawCanvas.onmouseup = drawCanvas.onmouseleave = null;
      textOverlay.style.display = 'none'; textOverlay.onclick = null; textOverlay.innerHTML = '';
      actionBar.style.display = 'none';
      textBtn.classList.remove('active'); drawBtn.classList.remove('active');
      // Clear comment box if only auto-label remains
      const v = commentText.value.trim();
      if (v === '[Drawing]' || v.startsWith('[Text] ')) {
        commentText.value = ''; commentAtBadge.style.display = 'none';
      }
      pendingAnnotation = null;
    }

    cancelBtn.addEventListener('click', cancelAnnotation);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && mode) cancelAnnotation(); });

    // ── Undo ──────────────────────────────────────────────────────────────
    if (undoBtn) undoBtn.addEventListener('click', () => {
      if (mode === 'draw') {
        if (strokes.length === 0) return;
        strokes.pop();
        const drawCtx = drawCanvas.getContext('2d');
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        strokes.forEach(strk => {
          if (strk.points.length < 2) return;
          drawCtx.beginPath();
          drawCtx.strokeStyle = DRAW_COLOR; drawCtx.lineWidth = 3;
          drawCtx.lineCap = 'round'; drawCtx.lineJoin = 'round';
          strk.points.forEach((p, i) => i === 0 ? drawCtx.moveTo(p.x, p.y) : drawCtx.lineTo(p.x, p.y));
          drawCtx.stroke();
        });
      } else if (mode === 'text') {
        const inp = textOverlay.querySelector('.annot-text-input-overlay');
        if (inp) { inp.value = ''; inp.focus(); }
      }
    });

    // ── Post: save annotation + funnel into comment box ───────────────────
    async function postAnnotation() {
      if (!mode) return;
      let data;
      if (mode === 'draw') {
        if (strokes.length === 0) { showToast('Draw something first', 'error'); return; }
        const w = drawCanvas.width || 1, h = drawCanvas.height || 1;
        data = { strokes: strokes.map(strk => ({ points: strk.points.map(p => ({ x: p.x/w, y: p.y/h })) })) };
      } else if (mode === 'text') {
        const inp = textOverlay.querySelector('.annot-text-input-overlay');
        const txt = inp ? inp.value.trim() : '';
        if (!txt) { showToast('Type something first', 'error'); inp && inp.focus(); return; }
        const tw = textOverlay.clientWidth  || 1;
        const th = textOverlay.clientHeight || 1;
        data = { text: txt, x: parseFloat(inp.style.left) / tw,
                             y: parseFloat(inp.style.top)  / th };
      }

      const ts = videoEl.currentTime;
      const displayName = localStorage.getItem('feedo_display_name') || 'Admin';

      postBtn.disabled = true; postBtn.textContent = '…';
      try {
        const res = await fetch(`/api/videos/${videoId}/annotations`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp: ts, type: mode, data, author: displayName,
            color: mode === 'draw' ? DRAW_COLOR : '#ffffff' })
        });
        if (!res.ok) { const e = await res.json(); showToast(e.error || 'Failed', 'error'); return; }
        const { annotation } = await res.json();
        annotations.push(annotation);

        // Pin annotation render time to this exact timestamp
        pinnedAnnotTime = ts;

        // Force the render loop to redraw immediately
        _lastAnnotTime = -1;
        renderAnnotationsAtTime(ts);

        // Store pending so comment box submit also saves the visual
        pendingAnnotation = { type: mode, data };
        capturedTimestamp = ts;

        // Pre-fill comment box
        const label = mode === 'text' ? `[Text] ${data.text}` : '[Drawing]';
        commentText.value = label;
        commentAtTime.textContent = formatTime(ts);
        commentAtBadge.style.display = 'inline-flex';

        // Hide overlay
        const savedMode = mode;
        mode = null; strokes = []; currentStroke = []; drawing = false;
        drawCanvas.style.display = 'none';
        drawCanvas.onmousedown = drawCanvas.onmousemove = drawCanvas.onmouseup = drawCanvas.onmouseleave = null;
        textOverlay.style.display = 'none'; textOverlay.onclick = null; textOverlay.innerHTML = '';
        actionBar.style.display = 'none';
        textBtn.classList.remove('active'); drawBtn.classList.remove('active');

        commentText.focus();
        commentText.setSelectionRange(commentText.value.length, commentText.value.length);
        showToast(savedMode === 'draw' ? 'Drawing saved — add your comment' : 'Text saved — add your comment', 'success');
      } catch(e) {
        showToast('Network error', 'error');
      } finally {
        postBtn.disabled = false; postBtn.textContent = '✓ Post';
      }
    }

    postBtn.addEventListener('click', postAnnotation);

    // ── Draw mode ─────────────────────────────────────────────────────────
    drawBtn.addEventListener('click', () => {
      if (mode === 'draw') { cancelAnnotation(); return; }
      if (!videoEl.paused) videoEl.pause();
      if (player) player.clearIntendedSeekTime();
      sizeCanvases();
      mode = 'draw'; strokes = [];
      drawBtn.classList.add('active'); textBtn.classList.remove('active');
      textOverlay.style.display = 'none'; textOverlay.innerHTML = '';
      actionBar.style.display = 'flex';

      const drawCtx = drawCanvas.getContext('2d');
      drawCanvas.style.display = 'block';
      drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

      drawCanvas.onmousedown = e => {
        drawing = true; currentStroke = [];
        const pt = { x: e.offsetX, y: e.offsetY };
        currentStroke.push(pt);
        drawCtx.beginPath();
        drawCtx.strokeStyle = DRAW_COLOR; drawCtx.lineWidth = 3;
        drawCtx.lineCap = 'round'; drawCtx.lineJoin = 'round';
        drawCtx.moveTo(pt.x, pt.y);
      };
      drawCanvas.onmousemove = e => {
        if (!drawing) return;
        const pt = { x: e.offsetX, y: e.offsetY };
        currentStroke.push(pt);
        drawCtx.lineTo(pt.x, pt.y); drawCtx.stroke();
      };
      const finishStroke = () => {
        if (!drawing) return; drawing = false;
        if (currentStroke.length > 1) strokes.push({ points: [...currentStroke] });
        currentStroke = [];
      };
      drawCanvas.onmouseup = finishStroke;
      drawCanvas.onmouseleave = finishStroke;
    });

    // ── Text mode ─────────────────────────────────────────────────────────
    textBtn.addEventListener('click', () => {
      if (mode === 'text') { cancelAnnotation(); return; }
      if (!videoEl.paused) videoEl.pause();
      if (player) player.clearIntendedSeekTime();
      sizeCanvases();
      mode = 'text';
      textBtn.classList.add('active'); drawBtn.classList.remove('active');
      drawCanvas.style.display = 'none';
      drawCanvas.onmousedown = drawCanvas.onmousemove = drawCanvas.onmouseup = drawCanvas.onmouseleave = null;
      actionBar.style.display = 'flex';

      textOverlay.innerHTML = '<div style="position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;font-size:12px;padding:5px 14px;border-radius:20px;pointer-events:none;white-space:nowrap;">Click anywhere to place your text</div>';
      textOverlay.style.display = 'block';

      textOverlay.onclick = e => {
        if (e.target.closest('.annot-text-input-overlay')) return;
        const existing = textOverlay.querySelector('.annot-text-input-overlay');
        if (existing) { existing.focus(); return; }
        textOverlay.querySelector('div')?.remove();

        const x = Math.max(0, e.offsetX);
        const y = Math.max(20, e.offsetY);

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'annot-text-input-overlay';
        inp.placeholder = 'Type here…';
        inp.style.left = x + 'px';
        inp.style.top  = y + 'px';
        textOverlay.appendChild(inp);
        setTimeout(() => inp.focus(), 10);

        // Drag handle: hold and drag to move
        let dragPending = false, dragging = false, ox = 0, oy = 0, startX = 0, startY = 0;
        inp.addEventListener('mousedown', e2 => {
          if (e2.target !== inp) return;
          dragPending = true; dragging = false;
          ox = e2.offsetX; oy = e2.offsetY;
          startX = e2.clientX; startY = e2.clientY;
          e2.preventDefault(); // prevent text cursor on drag
        });
        window.addEventListener('mousemove', e2 => {
          if (!dragPending) return;
          if (!dragging && (Math.abs(e2.clientX - startX) > 4 || Math.abs(e2.clientY - startY) > 4))
            dragging = true;
          if (!dragging) return;
          const r = textOverlay.getBoundingClientRect();
          inp.style.left = Math.max(0, e2.clientX - r.left - ox) + 'px';
          inp.style.top  = Math.max(0, e2.clientY - r.top  - oy) + 'px';
        });
        window.addEventListener('mouseup', () => {
          if (dragPending) { dragPending = false; if (!dragging) inp.focus(); dragging = false; }
        });

        inp.addEventListener('keydown', e2 => {
          if (e2.key === 'Escape') { e2.stopPropagation(); cancelAnnotation(); }
        });
      };
    });
  }

  // Init
  init();
})();
