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

  // ── Display name ──────────────────────────────────────────────────────────
  function getDisplayName() {
    return localStorage.getItem('feedo_display_name') || '';
  }

  // ── Name gate (always shown first — comment form hidden until confirmed) ───
  function showNameGate() {
    // Auto-skip for returning users who already have a name saved
    if (getDisplayName()) { showCommentForm(); return; }

    // Hide everything in the comment area until name is confirmed
    addCommentArea.style.display = 'none';
    filterRow.style.display = 'none';

    const gate = document.createElement('div');
    gate.id = 'name-gate';
    gate.className = 'name-gate';
    gate.innerHTML = `
      <p class="name-gate-label">Enter your name to start commenting</p>
      <div class="name-gate-row">
        <input type="text" id="name-gate-input" class="form-input"
          placeholder="Your name…"
          value="${escapeHtml(getDisplayName())}"
          autocomplete="off" />
        <button class="btn btn-primary" id="name-gate-confirm">Continue →</button>
      </div>
    `;
    // Insert gate where the comment area is
    addCommentArea.parentNode.insertBefore(gate, addCommentArea);

    const input = gate.querySelector('#name-gate-input');
    const btn   = gate.querySelector('#name-gate-confirm');

    function confirm() {
      const name = input.value.trim();
      if (!name) { input.classList.add('input-error'); input.focus(); return; }
      input.classList.remove('input-error');
      localStorage.setItem('feedo_display_name', name);
      gate.remove();
      showCommentForm();
    }

    btn.addEventListener('click', confirm);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
    setTimeout(() => input.focus(), 100);
  }

  // ── Activate comment form (after name is known) ───────────────────────────
  function showCommentForm() {
    addCommentArea.style.display = 'block';
    filterRow.style.display = 'flex';
    const toolbar = document.getElementById('annotation-toolbar');
    if (toolbar) toolbar.style.display = 'flex';
    injectNameField(addCommentArea);
    setupCommentForm();
    setupCommentFilters();
  }

  function injectNameField(addArea) {
    if (document.getElementById('share-name-row')) return;
    const existing = getDisplayName();
    const row = document.createElement('div');
    row.id = 'share-name-row';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    row.innerHTML = `
      <input type="text" id="share-name-input" class="form-input"
        placeholder="Your name…"
        value="${escapeHtml(existing)}"
        style="flex:1;font-size:12px;padding:5px 9px;" />
    `;
    addArea.insertBefore(row, addArea.firstChild);
    const inp = row.querySelector('#share-name-input');
    inp.addEventListener('blur', () => {
      const v = inp.value.trim();
      if (v) localStorage.setItem('feedo_display_name', v);
    });
  }

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
  const selectedFilesList = document.getElementById('selected-files-list');
  const attachBtn         = document.getElementById('attach-btn');
  const attachmentInput   = document.getElementById('attachment-input');

  // ── State ─────────────────────────────────────────────────────────────────
  let comments          = [];
  let versions          = [];
  let annotations       = [];
  let selectedFiles     = [];
  let player            = null;
  let allowComments     = false;
  let capturedTimestamp = 0;
  let pendingAnnotation = null;
  let commentFilter     = 'all';

  // ── Per-author color assignment (sequential, deterministic by comment order) ─
  const authorColorMap  = new Map();
  const shareColorPalette = ['#f59e0b','#10b981','#8b5cf6','#ef4444','#f97316','#06b6d4','#ec4899','#84cc16','#a78bfa','#fb923c'];
  function getAuthorColor(author) {
    if (!authorColorMap.has(author)) {
      authorColorMap.set(author, shareColorPalette[authorColorMap.size % shareColorPalette.length]);
    }
    return authorColorMap.get(author);
  }

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

      document.title = `${video.name} — Feedo`;
      videoNameEl.textContent = video.name;
      projectBreadcrumb.textContent = project ? project.name : 'Feedo';
      shareBadge.textContent = allowComments ? 'Shared · Can Comment' : 'View Only';

      videoEl.src = `/api/share/${token}/stream`;

      player = createVideoPlayer(videoEl, {
        commentsGetter: () => comments,
        onPause: () => {
          if (allowComments && commentText && !pendingAnnotation) {
            setTimeout(() => { if (videoEl.paused) commentText.focus(); }, 50);
          }
        }
      });

      if (allowComments) {
        viewOnlyNote.style.display = 'none';
        showNameGate();
      } else {
        addCommentArea.style.display = 'none';
        viewOnlyNote.style.display = 'block';
      }

      if (versions.length > 1) {
        versionBar.style.display = 'flex';
        renderVersionTabs(video.id);
      }

      renderComments();
      setupPanelResize();
      setupAnnotationRenderer();

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
        // Use same link type (edit vs view-only) when switching versions
        const targetToken = allowComments ? v.share_token : (v.view_token || v.share_token);
        tab.addEventListener('click', () => { window.location.href = `/share/${targetToken}`; });
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
            ? (allowComments ? 'No comments yet. Add the first one!' : 'No comments on this video yet.')
            : `No ${commentFilter === 'resolved' ? 'resolved' : 'open'} comments.`}</p>
        </div>`;
      if (player) player.renderMarkers();
      return;
    }

    // Seed color map in chronological order so colors are stable across renders
    comments.forEach(c => getAuthorColor(c.author || 'guest'));

    commentsList.innerHTML = '';
    filtered.forEach(c => commentsList.appendChild(buildCommentCard(c)));
    if (player) player.renderMarkers();
  }

  function buildCommentCard(comment) {
    const card = document.createElement('div');
    card.className = 'comment-card' + (comment.resolved ? ' comment-resolved' : '');
    card.dataset.id = comment.id;

    const date = timeAgo(comment.created_at);

    // Author is stored as display_name (or legacy "guest:<id>" for old comments).
    // A comment belongs to the current guest if the stored author matches their display_name
    // OR matches the legacy guest:<id> format.
    const legacyKey = `guest:${GUEST_ID}`;
    const isMyComment = allowComments && (
      (comment.guest_id && comment.guest_id === GUEST_ID) ||
      comment.author === legacyKey
    );
    const authorRaw = comment.author || 'guest';
    // Legacy "guest:<uuid>" → show as "Guest"; display_name stored directly → show as-is
    const displayAuthor = authorRaw.startsWith('guest:') ? 'Guest' : authorRaw;
    const pillColor = getAuthorColor(authorRaw);

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
            <span class="timestamp-pill" data-ts="${comment.timestamp}" style="background:${pillColor}22; border-color:${pillColor}44; color:${pillColor};">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
              ${formatTime(comment.timestamp)}
            </span>
            <span class="comment-author-label">${isMyComment ? 'You' : escapeHtml(displayAuthor)}</span>
            ${isMyComment ? `
            <div class="comment-actions">
              <button class="comment-edit-btn" data-id="${comment.id}" title="Edit">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="comment-delete-btn" data-id="${comment.id}" title="Delete">
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
          <div class="replies-list" id="replies-list-${comment.id}"></div>
          ${allowComments ? `
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
          </div>` : ''}
        </div>
      </div>
    `;

    // Click anywhere on card to seek (except buttons/edit form)
    card.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('.comment-edit-form')) return;
      if (player) player.seekTo(comment.timestamp);
    });

    if (allowComments) {
      card.querySelector('.comment-resolve-btn').addEventListener('click', e => {
        e.stopPropagation();
        toggleResolve(comment.id);
      });
    }

    if (isMyComment) {
      card.querySelector('.comment-edit-btn').addEventListener('click', () => startEditComment(comment.id));
      card.querySelector('.comment-delete-btn').addEventListener('click', () => deleteComment(comment.id));
      card.querySelector(`#comment-edit-cancel-${comment.id}`).addEventListener('click', () => cancelEditComment(comment.id));
      card.querySelector(`#comment-edit-save-${comment.id}`).addEventListener('click', () => saveEditComment(comment.id));
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

    // Render existing replies
    const repliesList = card.querySelector(`#replies-list-${comment.id}`);
    if (repliesList) {
      comments.filter(r => r.parent_id === comment.id)
        .forEach(r => repliesList.appendChild(buildReplyCard(r)));
    }

    // Reply form listeners
    if (allowComments) {
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
        replyFormWrap.querySelector('.reply-submit-btn').addEventListener('click', e => {
          e.stopPropagation();
          submitReply(comment.id, card);
        });
        replyFormWrap.querySelector('.reply-textarea').addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(comment.id, card); }
        });
      }
    }

    return card;
  }

  // ── Edit Comment ──────────────────────────────────────────────────────────
  function startEditComment(id) {
    document.getElementById(`comment-text-${id}`).style.display = 'none';
    document.getElementById(`comment-edit-form-${id}`).style.display = 'block';
    const input = document.getElementById(`comment-edit-input-${id}`);
    if (input) { input.focus(); input.select(); }
  }
  function cancelEditComment(id) {
    document.getElementById(`comment-text-${id}`).style.display = '';
    document.getElementById(`comment-edit-form-${id}`).style.display = 'none';
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
      const displayName = getDisplayName();
      const res = await fetch(`/api/share/${token}/comments/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, guest_id: GUEST_ID, display_name: displayName })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || 'Failed', 'error'); return; }
      const updated = await res.json();
      const idx = comments.findIndex(c => c.id === id);
      if (idx !== -1) comments[idx] = { ...comments[idx], text: updated.text };
      // Targeted DOM update — avoid full re-render which destroys open reply forms
      const textEl = document.getElementById(`comment-text-${id}`);
      if (textEl) textEl.textContent = updated.text;
      cancelEditComment(id);
      showToast('Comment updated', 'success');
    } catch(e) { showToast('Network error', 'error'); }
  }

  // ── Resolve ───────────────────────────────────────────────────────────────
  async function toggleResolve(id) {
    try {
      const res = await fetch(`/api/share/${token}/comments/${id}/resolve`, { method: 'PATCH' });
      if (!res.ok) { showToast('Failed to update', 'error'); return; }
      const updated = await res.json();
      const idx = comments.findIndex(c => c.id === id);
      if (idx !== -1) comments[idx] = { ...comments[idx], resolved: updated.resolved };
      // Targeted DOM update — toggle classes without destroying open reply forms
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
    } catch(e) { showToast('Network error', 'error'); }
  }

  // ── Delete Comment ────────────────────────────────────────────────────────
  async function deleteComment(id) {
    try {
      const displayName = getDisplayName();
      const params = new URLSearchParams({ guest_id: GUEST_ID });
      if (displayName) params.set('display_name', displayName);
      const res = await fetch(`/api/share/${token}/comments/${id}?${params.toString()}`, { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); showToast(err.error || 'Failed', 'error'); return; }
      comments = comments.filter(c => c.id !== id && c.parent_id !== id);
      renderComments();
      if (player) player.renderMarkers();
      showToast('Comment deleted', 'success');
    } catch(e) { showToast('Network error', 'error'); }
  }

  // ── Reply Card ────────────────────────────────────────────────────────────
  function buildReplyCard(reply) {
    const card = document.createElement('div');
    card.className = 'reply-card';
    card.dataset.id = reply.id;

    const date = timeAgo(reply.created_at);
    const legacyKey = `guest:${GUEST_ID}`;
    const isMyReply = allowComments && (
      (reply.guest_id && reply.guest_id === GUEST_ID) ||
      reply.author === legacyKey
    );
    const authorRaw = reply.author || 'guest';
    const displayAuthor = authorRaw.startsWith('guest:') ? 'Guest' : authorRaw;
    const pillColor = getAuthorColor(authorRaw);

    card.innerHTML = `
      <div class="reply-header">
        <span class="timestamp-pill reply-timestamp-pill" data-ts="${reply.timestamp}" style="background:${pillColor}22; border-color:${pillColor}44; color:${pillColor};">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
          ${formatTime(reply.timestamp)}
        </span>
        <span class="comment-author-label" style="font-size:12px;">${isMyReply ? 'You' : escapeHtml(displayAuthor)}</span>
        <span class="reply-date">${date}</span>
        ${isMyReply ? `
        <div class="comment-actions">
          <button class="reply-edit-btn" data-id="${reply.id}" title="Edit">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>` : ''}
      </div>
      <div class="reply-text" id="reply-text-${reply.id}">${escapeHtml(reply.text)}</div>
      ${isMyReply ? `
      <div class="comment-edit-form" id="reply-edit-form-${reply.id}" style="display:none;">
        <textarea class="comment-edit-textarea" id="reply-edit-input-${reply.id}">${escapeHtml(reply.text)}</textarea>
        <div class="comment-edit-actions">
          <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;" id="reply-edit-cancel-${reply.id}">Cancel</button>
          <button class="btn btn-primary" style="font-size:12px;padding:4px 10px;" id="reply-edit-save-${reply.id}">Save</button>
        </div>
      </div>` : ''}
    `;

    card.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('.comment-edit-form')) return;
      if (player) player.seekTo(reply.timestamp);
    });

    if (isMyReply) {
      // Use card.querySelector throughout — card may not be in the document yet
      const textEl   = card.querySelector(`#reply-text-${reply.id}`);
      const formEl   = card.querySelector(`#reply-edit-form-${reply.id}`);
      const inputEl  = card.querySelector(`#reply-edit-input-${reply.id}`);
      const cancelEl = card.querySelector(`#reply-edit-cancel-${reply.id}`);
      const saveEl   = card.querySelector(`#reply-edit-save-${reply.id}`);

      card.querySelector(`.reply-edit-btn[data-id="${reply.id}"]`).addEventListener('click', e => {
        e.stopPropagation();
        textEl.style.display = 'none';
        formEl.style.display = 'block';
        if (inputEl) { inputEl.focus(); inputEl.select(); }
      });

      cancelEl.addEventListener('click', () => {
        textEl.style.display = '';
        formEl.style.display = 'none';
        const r = comments.find(c => c.id === reply.id);
        if (r && inputEl) inputEl.value = r.text;
      });

      saveEl.addEventListener('click', async () => {
        if (!inputEl) return;
        const text = inputEl.value.trim();
        if (!text) { showToast('Reply cannot be empty', 'error'); return; }
        try {
          const displayName = getDisplayName();
          const res = await fetch(`/api/share/${token}/comments/${reply.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, guest_id: GUEST_ID, display_name: displayName })
          });
          if (!res.ok) { const err = await res.json(); showToast(err.error || 'Failed', 'error'); return; }
          const updated = await res.json();
          const idx = comments.findIndex(c => c.id === reply.id);
          if (idx !== -1) comments[idx] = { ...comments[idx], text: updated.text };
          textEl.textContent = updated.text;
          textEl.style.display = '';
          formEl.style.display = 'none';
          showToast('Reply updated', 'success');
        } catch(e) { showToast('Network error', 'error'); }
      });

      inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEl.click(); }
        if (e.key === 'Escape') cancelEl.click();
      });
    }

    return card;
  }

  // ── Submit Reply ──────────────────────────────────────────────────────────
  async function submitReply(parentId, commentCard) {
    const replyFormWrap = commentCard.querySelector(`#reply-form-${parentId}`);
    if (!replyFormWrap) return;
    const textarea  = replyFormWrap.querySelector('.reply-textarea');
    const submitBtn = replyFormWrap.querySelector('.reply-submit-btn');

    const text = textarea.value.trim();
    if (!text) { textarea.focus(); showToast('Please enter a reply', 'error'); return; }

    const displayName = getDisplayName() || 'Guest';

    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting…';
    try {
      const res = await fetch(`/api/share/${token}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, guest_id: GUEST_ID, display_name: displayName, parent_id: parentId })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || 'Failed', 'error'); return; }
      const newReply = await res.json();
      newReply.attachments = [];
      comments.push(newReply);

      const repliesList = commentCard.querySelector(`#replies-list-${parentId}`);
      if (repliesList) repliesList.appendChild(buildReplyCard(newReply));

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

  // ── Attachment display ────────────────────────────────────────────────────
  function buildAttachmentEl(att, srcUrl) {
    if (att.mime_type.startsWith('image/')) {
      const el = document.createElement('div');
      el.className = 'att-thumb'; el.title = att.original_name;
      const img = document.createElement('img');
      img.src = srcUrl; img.alt = att.original_name; img.loading = 'lazy';
      el.appendChild(img);
      el.addEventListener('click', () => showAttachment(att, srcUrl));
      return el;
    } else if (att.mime_type.startsWith('video/')) {
      const el = document.createElement('div');
      el.className = 'att-video-thumb'; el.title = att.original_name;
      el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
      el.addEventListener('click', () => showAttachment(att, srcUrl));
      return el;
    } else {
      const el = document.createElement('div');
      el.className = 'att-chip'; el.title = att.original_name;
      el.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
        </svg>
        <span>${escapeHtml(att.original_name)}</span>`;
      el.addEventListener('click', () => showAttachment(att, srcUrl));
      return el;
    }
  }

  // ── Selected files display ─────────────────────────────────────────────────
  function renderSelectedFiles() {
    if (!selectedFilesList) return;
    selectedFilesList.innerHTML = '';
    selectedFiles.forEach((f, i) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = `<span>${escapeHtml(f.name)}</span><button class="file-chip-remove" data-index="${i}" title="Remove">&times;</button>`;
      chip.querySelector('.file-chip-remove').addEventListener('click', () => {
        selectedFiles.splice(i, 1); renderSelectedFiles();
      });
      selectedFilesList.appendChild(chip);
    });
  }

  // ── Comment Form ──────────────────────────────────────────────────────────
  function setupCommentForm() {
    if (!commentText || !submitComment) return;

    commentText.addEventListener('focus', () => {
      if (player) player.pause();
      if (!pendingAnnotation) {
        capturedTimestamp = videoEl.currentTime;
        commentAtTime.textContent = formatTime(capturedTimestamp);
        commentAtBadge.style.display = 'inline-flex';
      }
    });

    submitComment.addEventListener('click', submitNewComment);
    commentText.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNewComment(); }
    });

    if (attachBtn && attachmentInput) {
      attachBtn.addEventListener('click', () => attachmentInput.click());
      attachmentInput.addEventListener('change', () => {
        selectedFiles = [...selectedFiles, ...Array.from(attachmentInput.files)];
        attachmentInput.value = '';
        renderSelectedFiles();
      });
    }
  }

  async function submitNewComment() {
    const text = commentText.value.trim();
    if (!text) { commentText.focus(); showToast('Please enter a comment', 'error'); return; }

    submitComment.disabled = true;
    submitComment.textContent = 'Posting…';
    // Read name from inline field, save it, fall back to "Guest"
    const nameInp = document.getElementById('share-name-input');
    const typedName = nameInp ? nameInp.value.trim() : '';
    if (typedName) localStorage.setItem('feedo_display_name', typedName);
    const displayName = typedName || localStorage.getItem('feedo_display_name') || 'Guest';

    try {
      const res = await fetch(`/api/share/${token}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: capturedTimestamp, text, guest_id: GUEST_ID, display_name: displayName })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || 'Failed', 'error'); return; }

      const newComment = await res.json();

      // Upload attachments if any
      if (selectedFiles.length > 0) {
        const formData = new FormData();
        selectedFiles.forEach(f => formData.append('files', f));
        const attRes = await fetch(`/api/share/${token}/comments/${newComment.id}/attachments`, {
          method: 'POST', body: formData
        });
        if (attRes.ok) {
          newComment.attachments = await attRes.json();
        } else {
          showToast('Comment posted but attachments failed', 'info');
          newComment.attachments = [];
        }
      } else {
        newComment.attachments = [];
      }

      // Clear pending annotation flag (already saved in postAnnotation)
      pendingAnnotation = null;

      comments.push(newComment);
      comments.sort((a, b) => a.timestamp - b.timestamp);
      commentText.value = '';
      selectedFiles = [];
      renderSelectedFiles();
      commentAtBadge.style.display = 'none';
      renderComments();

      const newCard = document.querySelector(`.comment-card[data-id="${newComment.id}"]`);
      if (newCard) {
        newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        newCard.classList.add('active-comment');
        setTimeout(() => newCard.classList.remove('active-comment'), 1500);
      }
      showToast('Comment added', 'success');
    } catch(e) {
      showToast('Network error', 'error');
    } finally {
      submitComment.disabled = false;
      submitComment.textContent = 'Add Comment';
    }
  }

  // ── Panel Resize ──────────────────────────────────────────────────────────
  function setupPanelResize() {
    const handle = document.getElementById('panel-resize-handle');
    const panel  = document.getElementById('comments-panel');
    if (!handle || !panel) return;

    let dragging = false, startX = 0, startW = 0;
    handle.addEventListener('mousedown', e => {
      dragging = true; startX = e.clientX; startW = panel.offsetWidth;
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const delta = startX - e.clientX;
      panel.style.width = Math.max(240, Math.min(600, startW + delta)) + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; }
    });
  }

  // ── Annotations (read + write) ────────────────────────────────────────────
  function setupAnnotationRenderer() {
    const annotCanvas = document.getElementById('annot-canvas');
    if (!annotCanvas) return;
    const annotCtx = annotCanvas.getContext('2d');
    const WINDOW = 1 / 30;

    async function loadAnnotations() {
      try {
        const res = await fetch(`/api/share/${token}/annotations`);
        if (res.ok) annotations = await res.json();
      } catch(e) { /* non-critical */ }
    }

    function sizeCanvases() {
      const wrapper = videoEl.parentElement;
      const w = wrapper.clientWidth  || 640;
      const h = wrapper.clientHeight || 360;
      for (const id of ['annot-canvas','draw-canvas','text-overlay']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.left = '0px'; el.style.top = '0px';
        el.style.width = w + 'px'; el.style.height = h + 'px';
        if (el.tagName === 'CANVAS') { el.width = w; el.height = h; }
      }
    }

    ['loadedmetadata','loadeddata','canplay'].forEach(ev => videoEl.addEventListener(ev, sizeCanvases));
    window.addEventListener('resize', sizeCanvases);
    setTimeout(sizeCanvases, 200); setTimeout(sizeCanvases, 800);

    function drawAnnotOnCtx(ctx, type, data, color) {
      const w = annotCanvas.width, h = annotCanvas.height;
      if (type === 'draw') {
        (data.strokes || []).forEach(strk => {
          if (!strk.points || strk.points.length < 2) return;
          ctx.beginPath();
          ctx.strokeStyle = color || '#ef4444';
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

    function renderAtTime(t) {
      annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
      annotations.filter(a => Math.abs(a.timestamp - t) <= WINDOW)
        .forEach(a => drawAnnotOnCtx(annotCtx, a.type, a.data, a.color));
    }

    // Only redraw when currentTime actually changes — avoids 60fps canvas
    // clear+draw while paused (which was killing video decode performance)
    let _lastAnnotTime = -1;
    (function rafLoop() {
      if (!document.hidden) {
        const t = videoEl.currentTime;
        if (t !== _lastAnnotTime) {
          _lastAnnotTime = t;
          renderAtTime(t);
        }
      }
      requestAnimationFrame(rafLoop);
    })();

    loadAnnotations();

    // Drawing tools only if allowComments
    if (!allowComments) return;
    setupDrawingTools(sizeCanvases, drawAnnotOnCtx);
  }

  function setupDrawingTools(sizeCanvases, drawAnnotOnCtx) {
    const drawCanvas = document.getElementById('draw-canvas');
    const textOverlay = document.getElementById('text-overlay');
    const actionBar  = document.getElementById('annot-action-bar');
    const postBtn    = document.getElementById('annot-post-btn');
    const cancelBtn  = document.getElementById('annot-cancel-btn');
    const undoBtn    = document.getElementById('annot-undo-btn');
    const textBtn    = document.getElementById('annot-text-btn');
    const drawBtn    = document.getElementById('annot-draw-btn');
    if (!drawCanvas || !postBtn) return;

    const DRAW_COLOR = '#ef4444';
    let mode = null, strokes = [], currentStroke = [], drawing = false;

    function cancelAnnotation() {
      mode = null; strokes = []; currentStroke = []; drawing = false;
      drawCanvas.style.display = 'none';
      drawCanvas.onmousedown = drawCanvas.onmousemove = drawCanvas.onmouseup = drawCanvas.onmouseleave = null;
      textOverlay.style.display = 'none'; textOverlay.onclick = null; textOverlay.innerHTML = '';
      actionBar.style.display = 'none';
      textBtn.classList.remove('active'); drawBtn.classList.remove('active');
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
        data = { text: txt, x: parseFloat(inp.style.left) / tw, y: parseFloat(inp.style.top) / th };
      }

      const ts = videoEl.currentTime;
      const nameInp2 = document.getElementById('share-name-input');
      const n2 = nameInp2 ? nameInp2.value.trim() : '';
      if (n2) localStorage.setItem('feedo_display_name', n2);
      const displayName = n2 || localStorage.getItem('feedo_display_name') || 'Guest';

      postBtn.disabled = true; postBtn.textContent = '…';
      try {
        const res = await fetch(`/api/share/${token}/annotations`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp: ts, type: mode, data, author: displayName,
            color: mode === 'draw' ? DRAW_COLOR : '#ffffff' })
        });
        if (!res.ok) { const e = await res.json(); showToast(e.error || 'Failed', 'error'); return; }
        const { annotation } = await res.json();
        annotations.push(annotation);

        pendingAnnotation = { type: mode, data };
        capturedTimestamp = ts;

        const label = mode === 'text' ? `[Text] ${data.text}` : '[Drawing]';
        commentText.value = label;
        commentAtTime.textContent = formatTime(ts);
        commentAtBadge.style.display = 'inline-flex';

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

    // Draw mode
    drawBtn.addEventListener('click', () => {
      if (mode === 'draw') { cancelAnnotation(); return; }
      if (!videoEl.paused) videoEl.pause();
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

    // Text mode
    textBtn.addEventListener('click', () => {
      if (mode === 'text') { cancelAnnotation(); return; }
      if (!videoEl.paused) videoEl.pause();
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

        let dragPending = false, dragging = false, ox = 0, oy = 0, startX = 0, startY = 0;
        inp.addEventListener('mousedown', e2 => {
          if (e2.target !== inp) return;
          dragPending = true; dragging = false;
          ox = e2.offsetX; oy = e2.offsetY;
          startX = e2.clientX; startY = e2.clientY;
          e2.preventDefault();
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
