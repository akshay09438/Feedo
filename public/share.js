/* ── share.js — public shared view ──────────────────────────────────────────── */
(function () {
  'use strict';

  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.indexOf('share') + 1];

  if (!token) {
    document.body.innerHTML = `<div class="error-page"><h1>Invalid Share Link</h1><p>This link appears to be malformed.</p></div>`;
    throw new Error('No share token');
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

  // ── State ─────────────────────────────────────────────────────────────────
  let comments       = [];
  let player         = null;
  let allowComments  = false;
  let capturedTimestamp = 0;

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
      allowComments = !!data.allow_comments;

      document.title = `${video.name} — Feedo`;
      videoNameEl.textContent = video.name;
      projectBreadcrumb.textContent = project ? project.name : 'Feedo';

      // Set video source
      videoEl.src = `/api/share/${token}/stream`;

      // Init player
      player = createVideoPlayer(videoEl, {
        commentsGetter: () => comments
      });

      // Show/hide comment form
      if (allowComments) {
        addCommentArea.style.display = 'block';
        viewOnlyNote.style.display = 'none';
        setupCommentForm();
      } else {
        addCommentArea.style.display = 'none';
        viewOnlyNote.style.display = 'block';
      }

      renderComments();
    } catch (e) {
      document.body.innerHTML = `<div class="error-page"><h1>Load Error</h1><p>Could not load this shared video. Please try again.</p></div>`;
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
          <p>${allowComments ? 'No comments yet. Add the first one!' : 'No comments on this video yet.'}</p>
        </div>`;
      return;
    }

    commentsList.innerHTML = '';
    comments.forEach(c => commentsList.appendChild(buildCommentCard(c)));

    if (player) player.renderMarkers();
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
      </div>
      <div class="comment-text">${escapeHtml(comment.text)}</div>
      <div class="comment-date">${date}</div>
      <div class="comment-attachments" id="att-${comment.id}"></div>
    `;

    card.querySelector('.timestamp-pill').addEventListener('click', () => {
      if (player) player.seekTo(comment.timestamp);
    });

    if (comment.attachments && comment.attachments.length > 0) {
      const attContainer = card.querySelector(`#att-${comment.id}`);
      comment.attachments.forEach(att => {
        const srcUrl = `/api/share/${token}/attachments/${att.filename}`;
        attContainer.appendChild(buildAttachmentEl(att, srcUrl));
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
    commentText.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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
        body: JSON.stringify({ timestamp: capturedTimestamp, text })
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
