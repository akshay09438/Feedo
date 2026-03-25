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
    // Always show the gate — addCommentArea is already hidden in HTML by default
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

  // Direct annotation renderer — set by setupAnnotationRenderer, called from click handlers
  // to force annotation display independent of video events.
  let _directRenderAnnot = null;

  // ── Per-author color assignment (hash-based — deterministic per name) ───────
  const authorColorMap  = new Map();
  const shareColorPalette = ['#f59e0b','#10b981','#8b5cf6','#ef4444','#f97316','#06b6d4','#ec4899','#84cc16','#a78bfa','#fb923c'];
  function getAuthorColor(author) {
    if (!authorColorMap.has(author)) {
      let h = 0;
      for (let i = 0; i < author.length; i++) h = (h * 31 + author.charCodeAt(i)) >>> 0;
      authorColorMap.set(author, shareColorPalette[h % shareColorPalette.length]);
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
        // Show filter row so view-only users can filter by All/Open/Resolved
        filterRow.style.display = 'flex';
        setupCommentFilters();
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
        <button class="comment-resolve-btn${comment.resolved ? ' resolved' : ''}" data-id="${comment.id}"
          title="${comment.resolved ? 'Resolved' : 'Open'}"
          ${!allowComments ? 'style="pointer-events:none;cursor:default;" disabled' : ''}>
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

    // Click anywhere on card to seek and show annotation.
    // _directRenderAnnot is called first so suppressPause is set before seekTo fires
    // the pause event (prevents the draw toolbar from flashing open).
    card.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('.comment-edit-form')) return;
      if (_directRenderAnnot) _directRenderAnnot(comment.timestamp);
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
      if (_directRenderAnnot) _directRenderAnnot(reply.timestamp);
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
    const displayName = getDisplayName() || 'Guest';

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

  // ── Annotations ──────────────────────────────────────────────────────────
  function setupAnnotationRenderer() {
    const annotCanvas = document.getElementById('annot-canvas');
    if (!annotCanvas) return;
    const annotCtx = annotCanvas.getContext('2d');

    // _pinTime: when set, the rAF loop locks the annotation display to this exact
    // timestamp regardless of where the video is. Set after comment-card click or
    // after posting an annotation.
    let _pinTime = null;

    // Immediately draws all annotations matching timestamp t onto annot-canvas.
    // Called synchronously (no rAF delay) so the annotation appears instantly.
    function renderPin(t) {
      _pinTime = t;
      annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
      annotations
        .filter(a => Math.abs(a.timestamp - t) <= 0.5)
        .forEach(a => drawAnnot(annotCtx, a));
    }

    // Release pin when video plays — loop then tracks currentTime directly.
    videoEl.addEventListener('play', () => { _pinTime = null; });

    // Called from comment/reply card click handlers (module-level var).
    _directRenderAnnot = (t) => { renderPin(t); };

    // ── Size all overlay elements ──────────────────────────────────────────
    function sizeAll() {
      const wrapper = videoEl.parentElement;
      const w = wrapper.clientWidth || 640;
      const h = wrapper.clientHeight || 360;
      for (const id of ['annot-canvas', 'draw-canvas', 'text-overlay']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.left = '0'; el.style.top = '0';
        el.style.width = w + 'px'; el.style.height = h + 'px';
        // Only set canvas buffer size when it actually changes — setting .width
        // always clears the canvas even if the value is identical.
        if (el.tagName === 'CANVAS' && (el.width !== w || el.height !== h)) {
          el.width = w; el.height = h;
        }
      }
    }
    ['loadedmetadata', 'loadeddata', 'canplay'].forEach(ev => videoEl.addEventListener(ev, sizeAll));
    window.addEventListener('resize', sizeAll);
    setTimeout(sizeAll, 100); setTimeout(sizeAll, 600);

    // ── Draw one annotation onto a canvas context ──────────────────────────
    function drawAnnot(ctx, annot) {
      const w = annotCanvas.width, h = annotCanvas.height;
      if (!w || !h) return;
      if (annot.type === 'draw') {
        (annot.data.strokes || []).forEach(strk => {
          if (!strk.points || strk.points.length < 2) return;
          ctx.beginPath();
          ctx.strokeStyle = annot.color || '#ef4444';
          ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          strk.points.forEach((p, i) =>
            i === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h)
          );
          ctx.stroke();
        });
      } else if (annot.type === 'text') {
        const fontSize = 18;
        ctx.font = `bold ${fontSize}px 'Times New Roman', Times, serif`;
        const tx = annot.data.x * w, ty = annot.data.y * h;
        const txt = annot.data.text || '';
        const pad = 6, tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(tx - pad, ty - fontSize, tw + pad * 2, fontSize + pad * 1.5);
        ctx.fillStyle = annot.color || '#ffffff';
        ctx.fillText(txt, tx, ty);
      }
    }

    // ── Always-on render loop ──────────────────────────────────────────────
    // pinned  → show annotations near _pinTime (comment-card click / seek)
    // paused  → show annotations within 2 s of current time (stays while at timestamp)
    // playing → show annotations within 1 frame (brief flash at exact timestamp)
    (function loop() {
      annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
      let t, win;
      if (_pinTime !== null) {
        t = _pinTime;            win = 0.5;
      } else if (videoEl.paused) {
        t = videoEl.currentTime; win = 0.5;
      } else {
        t = videoEl.currentTime; win = 1 / 30;
      }
      annotations
        .filter(a => Math.abs(a.timestamp - t) <= win)
        .forEach(a => drawAnnot(annotCtx, a));
      requestAnimationFrame(loop);
    })();

    async function loadAnnotations() {
      try {
        const res = await fetch(`/api/share/${token}/annotations`);
        if (res.ok) annotations = await res.json();
      } catch(e) { /* non-critical */ }
    }
    loadAnnotations();

    if (!allowComments) return;

    setupShareAnnotator();
  }

  function setupShareAnnotator() {
    const wrapper = videoEl.parentElement; // .video-wrapper

    // AnnotationCanvas inserts its own canvas after videoEl (z-index 10, above annot-canvas at 9)
    const annotCanvas = new AnnotationCanvas(videoEl);
    const toolbar     = new AnnotationToolbar(wrapper);

    // Composer sits below the video wrapper in the layout
    const composerWrap = document.createElement('div');
    composerWrap.style.padding = '0 4px';
    wrapper.insertAdjacentElement('afterend', composerWrap);
    const composer = new AnnotationComposer(composerWrap);

    let stage            = 'idle';
    let currentTimestamp = null;
    let hasPlayed        = false;
    let suppressPause    = false;

    function startAnnotating(ts) {
      stage            = 'annotating';
      currentTimestamp = ts;
      annotCanvas.clearAll();
      annotCanvas.setTool('draw');
      toolbar.setActiveTool('draw');
      toolbar.setPostEnabled(false);
      toolbar.show();
    }

    function cancel() {
      toolbar.hide();
      composer.hide();
      annotCanvas.clearAll();
      annotCanvas.setTool(null);
      stage = 'idle';
    }

    annotCanvas.onStrokeComplete  = () => toolbar.setPostEnabled(true);
    annotCanvas.onTextBoxComplete = () => toolbar.setPostEnabled(true);

    toolbar.onDraw = () => { annotCanvas.setTool('draw'); toolbar.setActiveTool('draw'); };
    toolbar.onText = () => { annotCanvas.setTool('text'); toolbar.setActiveTool('text'); };
    toolbar.onUndo = () => {
      annotCanvas.undo();
      toolbar.setPostEnabled(annotCanvas.strokes.length > 0 || annotCanvas.textBoxes.length > 0);
    };
    toolbar.onPost = () => {
      stage = 'composing';
      toolbar.hide();
      annotCanvas.setTool(null);
      composer.show(annotCanvas.getSnapshot(), currentTimestamp);
    };
    toolbar.onCancel = () => cancel();
    composer.onCancel = () => cancel();

    composer.onSubmit = async (commentText) => {
      const displayName  = getDisplayName() || 'Guest';
      const strokes      = [...annotCanvas.strokes];
      const textBoxes    = [...annotCanvas.textBoxes];
      const thumbnail    = annotCanvas.getSnapshot();

      composer.hide();
      annotCanvas.clearAll();
      stage = 'idle';

      // Show annotation immediately so user sees it without waiting for server
      annotCanvas.loadAnnotation({ strokes, textBoxes });
      annotCanvas.setTool(null);
      const clearTimer = setTimeout(() => { annotCanvas.clearAll(); }, 4000);

      try {
        // Save drawing data to server
        if (strokes.length > 0) {
          const normalized = strokes.map(s => ({
            points: s.points.map(p => ({ x: p.x / 100, y: p.y / 100 }))
          }));
          await fetch(`/api/share/${token}/annotations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp: currentTimestamp, type: 'draw',
              data: { strokes: normalized }, author: displayName, color: '#FF3B30' })
          }).then(async r => {
            if (r.ok) { const { annotation } = await r.json(); if (annotation) annotations.push(annotation); }
          }).catch(() => {});
        }
        for (const tb of textBoxes) {
          await fetch(`/api/share/${token}/annotations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp: currentTimestamp, type: 'text',
              data: { text: tb.text, x: tb.x / 100, y: tb.y / 100 },
              author: displayName, color: '#ffffff' })
          }).then(async r => {
            if (r.ok) { const { annotation } = await r.json(); if (annotation) annotations.push(annotation); }
          }).catch(() => {});
        }

        // Post comment
        const res = await fetch(`/api/share/${token}/comments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp: currentTimestamp, text: commentText,
            guest_id: GUEST_ID, display_name: displayName })
        });
        if (!res.ok) { showToast('Failed to post comment', 'error'); return; }

        const newComment = await res.json();
        newComment.attachments = [];

        // Save drawing locally for replay when clicking comment
        localStorage.setItem('annot_' + newComment.id, JSON.stringify({ strokes, textBoxes, thumbnailDataUrl: thumbnail }));

        comments.push(newComment);
        comments.sort((a, b) => a.timestamp - b.timestamp);
        renderComments();
        const newCard = document.querySelector(`.comment-card[data-id="${newComment.id}"]`);
        if (newCard) {
          newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          newCard.classList.add('active-comment');
          setTimeout(() => newCard.classList.remove('active-comment'), 1500);
        }

        showToast('Annotation posted', 'success');
      } catch(e) {
        console.error('[Share] composer.onSubmit error:', e);
        clearTimeout(clearTimer);
        annotCanvas.clearAll();
        showToast('Failed to post comment', 'error');
      }
    };

    videoEl.addEventListener('play',  () => { hasPlayed = true; cancel(); });
    videoEl.addEventListener('pause', () => {
      if (suppressPause) { suppressPause = false; return; }
      if (!hasPlayed)    return;
      if (stage === 'idle') startAnnotating(videoEl.currentTime);
    });

    // Suppress the pause that fires when clicking a comment timestamp
    const origDirectRender = _directRenderAnnot;
    _directRenderAnnot = (t) => {
      suppressPause = true;
      if (origDirectRender) origDirectRender(t);
    };
  }

  // Init
  init();
})();
