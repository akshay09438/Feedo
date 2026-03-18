/* ── project.js — project detail page (video list) ──────────────────────────── */
(function () {
  'use strict';

  const pathParts = window.location.pathname.split('/');
  const projectId = pathParts[pathParts.indexOf('project') + 1];

  if (!projectId) {
    document.body.innerHTML = `<div class="error-page"><h1>Invalid Project</h1><p>No project ID in URL.</p><a href="/" class="btn btn-secondary" style="margin-top:12px;">Go Home</a></div>`;
    throw new Error('No project ID');
  }

  const projectNameEl = document.getElementById('project-name');
  const videosGrid    = document.getElementById('videos-grid');
  const addVideoBtn   = document.getElementById('add-video-btn');
  const fileInput     = document.getElementById('file-input');

  let project = null;
  let videos  = [];

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    initTheme();

    // Check auth
    try {
      const authRes = await fetch('/api/auth/status');
      const authData = await authRes.json();
      if (!authData.authenticated) { window.location.href = '/login'; return; }
    } catch (e) {
      window.location.href = '/login';
      return;
    }

    // Load project + videos
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (res.status === 404) {
        document.body.innerHTML = `<div class="error-page"><h1>Project Not Found</h1><p>This project may have been deleted.</p><a href="/" class="btn btn-secondary" style="margin-top:12px;">Go Home</a></div>`;
        return;
      }
      project = await res.json();
      videos  = project.videos || [];
    } catch (e) {
      document.body.innerHTML = `<div class="error-page"><h1>Load Error</h1><p>Could not load project.</p><a href="/" class="btn btn-secondary" style="margin-top:12px;">Go Home</a></div>`;
      return;
    }

    document.title = `${project.name} — Feedo`;
    projectNameEl.textContent = project.name;

    initSidebar(projectId, null);
    renderVideos();
    setupProjectName();
    setupAddVideo();
  }

  // ── Render Videos Grid ────────────────────────────────────────────────────
  function renderVideos() {
    if (videos.length === 0) {
      videosGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎬</div>
          <div class="empty-title">No videos yet</div>
          <div class="empty-sub">Upload your first video to start getting frame-accurate feedback.</div>
          <button class="btn btn-primary" id="empty-add-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add First Video
          </button>
        </div>`;
      const btn = document.getElementById('empty-add-btn');
      if (btn) btn.addEventListener('click', () => addVideoBtn.click());
      return;
    }

    videosGrid.innerHTML = '';
    videos.forEach(v => {
      const card = createVideoCard(v);
      videosGrid.appendChild(card);
    });
  }

  function createVideoCard(video) {
    const card = document.createElement('div');
    card.className = 'card video-card';
    card.dataset.id = video.id;

    const gradient = getProjectGradient(video.name);
    const commentCount = video.comment_count || 0;
    const date = formatDate(video.created_at);

    card.innerHTML = `
      <div class="card-thumbnail" style="background: ${gradient}" id="thumb-${video.id}">
        <div class="card-film-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" opacity="0.6">
            <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
          </svg>
        </div>
        <div class="card-thumb-actions">
          <button class="card-thumb-btn share-video-btn" title="Share video" data-id="${video.id}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
          <button class="card-thumb-btn danger delete-video-btn" title="Delete video" data-id="${video.id}" data-name="${escapeHtml(video.name)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(video.name)}</div>
        <div class="card-meta">
          <span>${date}</span>
          <span style="font-size:12px; color:var(--text-muted);">
            ${commentCount} comment${commentCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div class="card-actions-row">
          <button class="btn-icon share-video-btn" data-id="${video.id}" title="Share">🔗</button>
          <button class="btn-icon delete-video-btn" data-id="${video.id}" data-name="${escapeHtml(video.name)}" title="Delete">🗑</button>
        </div>
      </div>
    `;

    // Generate thumbnail from video frame
    setTimeout(() => {
      const thumbEl = document.getElementById(`thumb-${video.id}`);
      if (thumbEl) generateVideoThumbnail(`/api/videos/${video.id}/stream`, thumbEl);
    }, 0);

    // Navigate to video review page
    card.addEventListener('click', e => {
      if (e.target.closest('.card-thumb-btn') || e.target.closest('.btn-icon')) return;
      window.location.href = `/video/${video.id}`;
    });

    // Share buttons
    card.querySelectorAll('.share-video-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showShareModal(video);
      });
    });

    // Delete buttons
    card.querySelectorAll('.delete-video-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        confirmDeleteVideo(video.id, video.name);
      });
    });

    // Generate thumbnail
    generateVideoThumbnail(`/api/videos/${video.id}/stream`, dataUrl => {
      if (dataUrl) {
        const thumbEl = card.querySelector(`#thumb-${video.id}`);
        if (thumbEl) {
          const img = document.createElement('img');
          img.src = dataUrl;
          thumbEl.style.background = '';
          const icon = thumbEl.querySelector('.card-film-icon');
          if (icon) icon.remove();
          thumbEl.insertBefore(img, thumbEl.firstChild);
        }
      }
    });

    return card;
  }

  function generateVideoThumbnail(videoSrc, callback) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = videoSrc;
    video.muted = true;
    video.preload = 'metadata';

    let called = false;
    const done = (result) => {
      if (!called) { called = true; callback(result); }
    };

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(2, video.duration * 0.1 || 2);
    });

    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.7));
      } catch (e) { done(null); }
    });

    video.addEventListener('error', () => done(null));
    setTimeout(() => done(null), 8000);
  }

  // ── Share Modal ───────────────────────────────────────────────────────────
  function showShareModal(video) {
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
        ${video.allow_comments ? '✅ Viewers can add comments' : '👁 View only — no comments allowed'}
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
        await fetch(`/api/videos/${video.id}`, {
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

  // ── Delete Video ──────────────────────────────────────────────────────────
  function confirmDeleteVideo(id, name) {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Delete Video</span>
        <button class="modal-close" id="modal-close-btn">&times;</button>
      </div>
      <p style="color:var(--text-secondary); font-size:14px; margin-bottom:20px; line-height:1.6;">
        Are you sure you want to delete <strong style="color:var(--text-primary);">${escapeHtml(name)}</strong>?
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
        const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
        if (res.ok) {
          modal.close();
          showToast('Video deleted', 'success');
          videos = videos.filter(v => String(v.id) !== String(id));
          renderVideos();
        } else {
          const err = await res.json();
          showToast(err.error || 'Failed to delete', 'error');
          btn.disabled = false;
          btn.textContent = 'Delete Video';
        }
      } catch (e) {
        showToast('Network error', 'error');
        btn.disabled = false;
        btn.textContent = 'Delete Video';
      }
    });
  }

  // ── Editable project name ─────────────────────────────────────────────────
  function setupProjectName() {
    let originalName = project.name;

    async function saveName() {
      const newName = projectNameEl.textContent.trim();
      if (!newName || newName === originalName) {
        projectNameEl.textContent = originalName;
        return;
      }

      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        });

        if (res.ok) {
          originalName = newName;
          document.title = `${newName} — Feedo`;
          showToast('Project renamed', 'success');
        } else {
          projectNameEl.textContent = originalName;
          showToast('Failed to rename project', 'error');
        }
      } catch (e) {
        projectNameEl.textContent = originalName;
        showToast('Network error', 'error');
      }
    }

    projectNameEl.addEventListener('blur', saveName);
    projectNameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); projectNameEl.blur(); }
      if (e.key === 'Escape') { projectNameEl.textContent = originalName; projectNameEl.blur(); }
    });
  }

  // ── Add Video / Upload ────────────────────────────────────────────────────
  function setupAddVideo() {
    addVideoBtn.addEventListener('click', openUploadModal);
  }

  function openUploadModal() {
    let selectedFile = null;

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Add Video</span>
        <button class="modal-close" id="upload-close">&times;</button>
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">Video Name (optional)</label>
        <input class="form-input" type="text" id="video-name-input" placeholder="Leave blank to use filename…" />
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">Video File</label>
        <div class="upload-dropzone" id="dropzone">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 16 12 12 8 16"/>
            <line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
          </svg>
          <div class="upload-dropzone-title">Drop your video here</div>
          <div class="upload-dropzone-sub">or <span class="upload-dropzone-link" id="browse-link">browse to upload</span></div>
          <div style="font-size:12px; color:var(--text-muted);">MP4, MOV, WebM — up to 4 GB</div>
        </div>
        <div id="file-selected-display" style="display:none;"></div>
      </div>

      <div id="upload-progress-wrap" style="display:none; margin-bottom:8px;">
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" id="upload-progress-fill"></div>
        </div>
        <div class="progress-label" id="upload-progress-label">0%</div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" id="upload-cancel">Cancel</button>
        <button class="btn btn-primary" id="upload-submit" disabled>Upload</button>
      </div>
    `;

    const modal = showModal(content);
    const dropzone            = content.querySelector('#dropzone');
    const browseLink          = content.querySelector('#browse-link');
    const fileSelectedDisplay = content.querySelector('#file-selected-display');
    const videoNameInput      = content.querySelector('#video-name-input');
    const uploadSubmit        = content.querySelector('#upload-submit');
    const progressWrap        = content.querySelector('#upload-progress-wrap');
    const progressFill        = content.querySelector('#upload-progress-fill');
    const progressLabel       = content.querySelector('#upload-progress-label');

    content.querySelector('#upload-close').addEventListener('click', () => modal.close());
    content.querySelector('#upload-cancel').addEventListener('click', () => modal.close());

    function setFile(file) {
      if (!file) return;
      selectedFile = file;
      dropzone.style.display = 'none';
      fileSelectedDisplay.style.display = 'flex';
      fileSelectedDisplay.innerHTML = `
        <div class="upload-file-selected">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
          <span class="upload-file-name">${escapeHtml(file.name)}</span>
          <span class="upload-file-size">${formatFileSize(file.size)}</span>
          <button class="btn-ghost" id="remove-file" style="margin-left:4px; padding:4px 6px;">✕</button>
        </div>`;
      fileSelectedDisplay.querySelector('#remove-file').addEventListener('click', () => {
        selectedFile = null;
        fileSelectedDisplay.style.display = 'none';
        dropzone.style.display = 'flex';
        uploadSubmit.disabled = true;
      });
      uploadSubmit.disabled = false;
      if (!videoNameInput.value.trim()) {
        videoNameInput.value = file.name.replace(/\.[^.]+$/, '');
      }
    }

    browseLink.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) setFile(fileInput.files[0]);
      fileInput.value = '';
    });

    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
    });

    uploadSubmit.addEventListener('click', () => {
      if (!selectedFile) return;
      uploadSubmit.disabled = true;
      content.querySelector('#upload-cancel').disabled = true;
      content.querySelector('#upload-close').disabled = true;
      progressWrap.style.display = 'block';

      const formData = new FormData();
      formData.append('video', selectedFile);
      const name = videoNameInput.value.trim();
      if (name) formData.append('name', name);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/projects/${projectId}/videos`);

      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          progressFill.style.width = pct + '%';
          progressLabel.textContent = pct + '%';
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 201) {
          const video = JSON.parse(xhr.responseText);
          modal.close();
          showToast('Video uploaded!', 'success');
          videos.unshift({ ...video, comment_count: 0 });
          renderVideos();
        } else {
          let msg = 'Upload failed';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch (e) {}
          showToast(msg, 'error');
          uploadSubmit.disabled = false;
          content.querySelector('#upload-cancel').disabled = false;
          content.querySelector('#upload-close').disabled = false;
          progressWrap.style.display = 'none';
          progressFill.style.width = '0%';
        }
      });

      xhr.addEventListener('error', () => {
        showToast('Network error during upload', 'error');
        uploadSubmit.disabled = false;
        content.querySelector('#upload-cancel').disabled = false;
        content.querySelector('#upload-close').disabled = false;
        progressWrap.style.display = 'none';
      });

      xhr.send(formData);
    });
  }

  // Init
  init();
})();
