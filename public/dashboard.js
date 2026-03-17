/* ── dashboard.js — main dashboard (projects + all videos) ─────────────────── */
(function () {
  'use strict';

  const appLayout    = document.getElementById('app-layout');
  const projectsGrid = document.getElementById('projects-grid');
  const videosGrid   = document.getElementById('videos-grid');
  const videoCount   = document.getElementById('video-count');
  const projectCount = document.getElementById('project-count');
  const newVideoBtn  = document.getElementById('new-video-btn');
  const newProjectBtn = document.getElementById('new-project-btn');
  const logoutBtn    = document.getElementById('logout-btn');
  const fileInput    = document.getElementById('file-input');

  let videos   = [];
  let projects = [];

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    initTheme();
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      if (!data.authenticated) {
        window.location.href = '/login';
        return;
      }
    } catch (e) {
      window.location.href = '/login';
      return;
    }

    appLayout.style.display = 'flex';
    await Promise.all([loadProjects(), loadVideos()]);
    initSidebar(null, null);

    newVideoBtn.addEventListener('click', openUploadModal);
    newProjectBtn.addEventListener('click', openNewProjectModal);
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  // ── Load Projects ─────────────────────────────────────────────────────────
  async function loadProjects() {
    try {
      const res = await fetch('/api/projects');
      if (res.status === 401) { window.location.href = '/login'; return; }
      projects = await res.json();
      renderProjects();
    } catch (e) {
      projectsGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--danger);">Failed to load projects.</div>`;
    }
  }

  // ── Load Videos ───────────────────────────────────────────────────────────
  async function loadVideos() {
    try {
      const res = await fetch('/api/videos');
      if (res.status === 401) { window.location.href = '/login'; return; }
      videos = await res.json();
      renderVideos();
    } catch (e) {
      videosGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--danger);">Failed to load videos.</div>`;
    }
  }

  // ── Render Projects Grid ──────────────────────────────────────────────────
  function renderProjects() {
    const count = projects.length;
    projectCount.textContent = count === 0 ? '' : `${count} project${count !== 1 ? 's' : ''}`;

    if (count === 0) {
      projectsGrid.innerHTML = `
        <div class="empty-state" style="padding:40px 24px;">
          <div class="empty-icon">📁</div>
          <div class="empty-title">No projects yet</div>
          <div class="empty-sub">Create a project to organise your videos.</div>
          <button class="btn btn-secondary" id="empty-new-project-btn" style="margin-top:12px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Project
          </button>
        </div>`;
      const btn = document.getElementById('empty-new-project-btn');
      if (btn) btn.addEventListener('click', openNewProjectModal);
      return;
    }

    projectsGrid.innerHTML = '';
    projects.forEach(p => projectsGrid.appendChild(createProjectCard(p)));
  }

  function createProjectCard(project) {
    const card = document.createElement('div');
    card.className = 'card project-card';
    card.dataset.id = project.id;

    const gradient = getProjectGradient(project.name);
    const videoCount = project.video_count || 0;
    const date = formatDate(project.created_at);
    const initials = project.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    card.innerHTML = `
      <div class="card-thumbnail" style="background: ${gradient}">
        <div class="card-initials">${escapeHtml(initials)}</div>
        <div class="card-video-count-badge">${videoCount} video${videoCount !== 1 ? 's' : ''}</div>
        <div class="card-thumb-actions">
          <button class="card-thumb-btn danger delete-project-btn" title="Delete project" data-id="${project.id}" data-name="${escapeHtml(project.name)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(project.name)}</div>
        <div class="card-meta">
          <span>${date}</span>
          <span style="font-size:12px; color:var(--text-muted);">${videoCount} video${videoCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="card-actions-row">
          <button class="btn-icon delete-project-btn" data-id="${project.id}" data-name="${escapeHtml(project.name)}" title="Delete project">🗑</button>
        </div>
      </div>
    `;

    card.addEventListener('click', e => {
      if (e.target.closest('.delete-project-btn') || e.target.closest('.card-thumb-btn')) return;
      window.location.href = `/project/${project.id}`;
    });

    card.querySelectorAll('.delete-project-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        confirmDeleteProject(btn.dataset.id, btn.dataset.name);
      });
    });

    return card;
  }

  // ── Render Videos Grid ────────────────────────────────────────────────────
  function renderVideos() {
    const count = videos.length;
    videoCount.textContent = count === 0 ? '' : `${count} video${count !== 1 ? 's' : ''}`;

    if (count === 0) {
      videosGrid.innerHTML = `
        <div class="empty-state" style="padding:40px 24px;">
          <div class="empty-icon">🎬</div>
          <div class="empty-title">No videos yet</div>
          <div class="empty-sub">Upload your first video to start getting frame-accurate feedback.</div>
          <button class="btn btn-primary" id="empty-upload-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Upload First Video
          </button>
        </div>`;
      const emptyBtn = document.getElementById('empty-upload-btn');
      if (emptyBtn) emptyBtn.addEventListener('click', openUploadModal);
      return;
    }

    videosGrid.innerHTML = '';
    videos.forEach(v => {
      videosGrid.appendChild(createVideoCard(v));
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
      <div class="card-thumbnail" style="background: ${gradient}" id="dash-thumb-${video.id}">
        <div class="card-thumb-icon">🎬</div>
        <div class="card-thumb-actions">
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
          ${video.project_name ? `<span class="project-badge">📁 ${escapeHtml(video.project_name)}</span>` : '<span style="color:var(--text-muted); font-size:11px;">Standalone</span>'}
          <span>${date}</span>
          <span>💬 ${commentCount}</span>
        </div>
        <div class="card-actions-row">
          <button class="btn-icon share-video-btn" data-id="${video.id}" data-token="${video.share_token}" data-allow="${video.allow_comments}" title="Share">🔗</button>
          <button class="btn-icon delete-video-btn" data-id="${video.id}" data-name="${escapeHtml(video.name)}" title="Delete">🗑</button>
        </div>
      </div>
    `;

    // Navigate on card click
    card.addEventListener('click', e => {
      if (e.target.closest('.delete-video-btn') || e.target.closest('.share-video-btn') || e.target.closest('.card-thumb-btn')) return;
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
        confirmDeleteVideo(btn.dataset.id, btn.dataset.name);
      });
    });

    return card;
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

  // ── Delete Project ────────────────────────────────────────────────────────
  function confirmDeleteProject(id, name) {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Delete Project</span>
        <button class="modal-close" id="modal-close-btn">&times;</button>
      </div>
      <p style="color:var(--text-secondary); font-size:14px; margin-bottom:20px; line-height:1.6;">
        Are you sure you want to delete the project <strong style="color:var(--text-primary);">${escapeHtml(name)}</strong>?
        Videos in this project will become standalone. This cannot be undone.
      </p>
      <div class="modal-footer" style="margin-top:0;">
        <button class="btn btn-secondary" id="cancel-delete">Cancel</button>
        <button class="btn btn-primary" id="confirm-delete" style="background:var(--danger);">Delete Project</button>
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
        const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
        if (res.ok) {
          modal.close();
          showToast('Project deleted', 'success');
          projects = projects.filter(p => String(p.id) !== String(id));
          // Update any videos that belonged to this project to show as standalone
          videos.forEach(v => {
            if (String(v.project_id) === String(id)) {
              v.project_id = null;
              v.project_name = null;
            }
          });
          renderProjects();
          renderVideos();
          window.dispatchEvent(new CustomEvent('feedo:project-deleted', { detail: { id: String(id) } }));
        } else {
          const err = await res.json();
          showToast(err.error || 'Failed to delete project', 'error');
          btn.disabled = false;
          btn.textContent = 'Delete Project';
        }
      } catch (e) {
        showToast('Network error', 'error');
        btn.disabled = false;
        btn.textContent = 'Delete Project';
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
          window.dispatchEvent(new CustomEvent('feedo:video-deleted', { detail: { id: String(id) } }));
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
  }

  // ── New Project Modal ─────────────────────────────────────────────────────
  function openNewProjectModal() {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">New Project</span>
        <button class="modal-close" id="proj-close">&times;</button>
      </div>
      <div class="form-group" style="margin-bottom:20px;">
        <label class="form-label">Project Name</label>
        <input class="form-input" type="text" id="proj-name-input" placeholder="Enter project name…" autofocus />
      </div>
      <div class="modal-footer" style="margin-top:0;">
        <button class="btn btn-secondary" id="proj-cancel">Cancel</button>
        <button class="btn btn-primary" id="proj-submit">Create Project</button>
      </div>
    `;

    const modal = showModal(content);
    const input = content.querySelector('#proj-name-input');
    setTimeout(() => input.focus(), 50);

    content.querySelector('#proj-close').addEventListener('click', () => modal.close());
    content.querySelector('#proj-cancel').addEventListener('click', () => modal.close());

    async function doCreate() {
      const name = input.value.trim();
      if (!name) { input.focus(); showToast('Please enter a project name', 'error'); return; }
      const btn = content.querySelector('#proj-submit');
      btn.disabled = true;
      btn.textContent = 'Creating…';
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        if (res.ok) {
          const project = await res.json();
          modal.close();
          showToast('Project created', 'success');
          window.location.href = `/project/${project.id}`;
        } else {
          const err = await res.json();
          showToast(err.error || 'Failed to create project', 'error');
          btn.disabled = false;
          btn.textContent = 'Create Project';
        }
      } catch (e) {
        showToast('Network error', 'error');
        btn.disabled = false;
        btn.textContent = 'Create Project';
      }
    }

    content.querySelector('#proj-submit').addEventListener('click', doCreate);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') doCreate();
      if (e.key === 'Escape') modal.close();
    });
  }

  // ── Upload Modal (New Video) ───────────────────────────────────────────────
  async function openUploadModal() {
    // Refresh projects for dropdown
    try {
      const res = await fetch('/api/projects');
      if (res.ok) projects = await res.json();
    } catch (e) { /* ignore */ }

    let selectedFile = null;

    const projectOptions = projects.map(p =>
      `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">Upload Video</span>
        <button class="modal-close" id="upload-close">&times;</button>
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">Video Name (optional)</label>
        <input class="form-input" type="text" id="video-name-input" placeholder="Leave blank to use filename…" />
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">Project (optional)</label>
        <select class="form-input" id="project-select" style="cursor:pointer;">
          <option value="">No project (standalone)</option>
          ${projectOptions}
        </select>
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
    const dropzone          = content.querySelector('#dropzone');
    const browseLink        = content.querySelector('#browse-link');
    const fileSelectedDisplay = content.querySelector('#file-selected-display');
    const videoNameInput    = content.querySelector('#video-name-input');
    const projectSelect     = content.querySelector('#project-select');
    const uploadSubmit      = content.querySelector('#upload-submit');
    const progressWrap      = content.querySelector('#upload-progress-wrap');
    const progressFill      = content.querySelector('#upload-progress-fill');
    const progressLabel     = content.querySelector('#upload-progress-label');

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
      const projectId = projectSelect.value;
      if (projectId) formData.append('project_id', projectId);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/videos');

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
          videos.unshift(video);
          renderVideos();
          window.dispatchEvent(new CustomEvent('feedo:video-added', { detail: { video } }));
          // If assigned to a project, update project video count
          if (video.project_id) {
            const proj = projects.find(p => String(p.id) === String(video.project_id));
            if (proj) {
              proj.video_count = (proj.video_count || 0) + 1;
              renderProjects();
            }
          }
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

  // Expose openUploadModal globally so sidebar.js "New Video" button can call it
  window.openUploadModal = openUploadModal;

  // ── Sync with sidebar deletions ──────────────────────────────────────────
  window.addEventListener('feedo:video-deleted', e => {
    const id = e.detail.id;
    if (videos.some(v => String(v.id) === String(id))) {
      videos = videos.filter(v => String(v.id) !== String(id));
      renderVideos();
    }
  });

  window.addEventListener('feedo:project-deleted', e => {
    const id = e.detail.id;
    if (projects.some(p => String(p.id) === String(id))) {
      projects = projects.filter(p => String(p.id) !== String(id));
      videos.forEach(v => { if (String(v.project_id) === String(id)) { v.project_id = null; v.project_name = null; } });
      renderProjects();
      renderVideos();
    }
  });

  // Init
  init();
})();
