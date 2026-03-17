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
  let capturedTimestamp = 0;
  let selectedFiles    = [];
  let player           = null;
  let commentFilter    = 'all'; // 'all' | 'open' | 'resolved'
  let historyOpen      = false;

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
      }
    });

    // Init sidebar — pass version_group_id so all versions of this file stay highlighted
    initSidebar(video.project_id, videoId, video.version_group_id);

    // Load comments, versions
    await Promise.all([loadComments(), loadVersions()]);

    // Setup everything
    setupCommentForm();
    setupShareButton();
    setupDeleteButton();
    setupCommentFilters();
    setupHistoryPanel();
    setupVersionBar();
    setupResizeHandle();
    startCommentPolling();
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
            ? 'No comments yet. Click in the video to pause and add a comment.'
            : `No ${commentFilter === 'resolved' ? 'resolved' : 'open'} comments.`}</p>
        </div>`;
      return;
    }

    commentsList.innerHTML = '';
    filtered.forEach(c => commentsList.appendChild(buildCommentCard(c)));
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

    const author = comment.author || 'admin';
    const isAdmin = !author.startsWith('guest:');
    const displayAuthor = author.startsWith('guest:') ? author.slice(6) : author;
    const pillColor = getUserColor(author);

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
        </div>
      </div>
    `;

    // Resolve checkbox
    card.querySelector('.comment-resolve-btn').addEventListener('click', () => {
      toggleResolve(comment.id);
    });

    // Timestamp seek
    card.querySelector('.timestamp-pill').addEventListener('click', () => {
      player.seekTo(comment.timestamp);
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
      if (idx !== -1) {
        comments[idx] = { ...comments[idx], text: updated.text };
      }
      renderComments();
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
      renderComments();
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
    // Auto-focus on pause (from player callback) — also focus on explicit focus events
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
          Allow viewers to add &amp; edit comments
        </label>
        <p class="help-text">When enabled, viewers can add, edit, and delete their own comments</p>
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
      try {
        const res = await fetch(`/api/videos/${videoId}/comments`);
        if (!res.ok) return;
        const fresh = await res.json();

        // Only re-render if something changed (count or content)
        const changed =
          fresh.length !== comments.length ||
          fresh.some((c, i) => {
            const existing = comments[i];
            return !existing || c.id !== existing.id || c.resolved !== existing.resolved || c.text !== existing.text;
          });

        if (changed) {
          comments = fresh;
          renderComments();
          if (player) player.renderMarkers();
        }
      } catch (e) {
        // silent — don't disrupt the user
      }
    }, 5000);
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

  // Init
  init();
})();
