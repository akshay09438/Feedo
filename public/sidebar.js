/* ── sidebar.js — shared sidebar component (ChatGPT/Claude style) ─────────────── */

/**
 * Initialize sidebar into #sidebar-container element.
 * @param {number|null} activeProjectId
 * @param {number|null} activeVideoId
 */
async function initSidebar(activeProjectId, activeVideoId, activeVersionGroupId) {
  const container = document.getElementById('sidebar-container');
  if (!container) return;

  let projects = [];
  let allVideos = [];

  // Fetch projects and all videos in parallel
  try {
    const [projRes, vidRes] = await Promise.all([
      fetch('/api/projects'),
      fetch('/api/videos')
    ]);
    if (projRes.ok) projects = await projRes.json();
    if (vidRes.ok) allVideos = await vidRes.json();
  } catch (e) {
    // sidebar still renders, just empty
  }

  // Build sidebar HTML
  const sidebar = document.createElement('div');
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo" id="sidebar-logo-home" style="cursor:pointer;" title="Go to home">
        <img src="/logo.png" alt="Feedo" class="sidebar-logo-img" />
        <span class="sidebar-logo-text">Feedo</span>
      </div>
    </div>

    <div class="sidebar-new-video-wrap">
      <button class="sidebar-new-video-btn" id="sidebar-new-video-btn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Video
      </button>
    </div>

    <div class="sidebar-search">
      <div class="sidebar-search-wrap">
        <svg class="sidebar-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" placeholder="Search…" id="sidebar-search-input" autocomplete="off" />
      </div>
    </div>

    <div class="sidebar-nav">
      <!-- Projects section (collapsible) -->
      <div class="sidebar-section">
        <div class="sidebar-section-header" id="projects-section-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          </svg>
          <span class="sidebar-section-title">Projects</span>
          <svg class="sidebar-section-chevron" id="projects-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
        <div class="sidebar-section-content" id="projects-section-content" style="display:none;">
          <div id="sidebar-projects-list"></div>
          <button class="sidebar-create-project-btn" id="sidebar-create-project-btn">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Project
          </button>
          <div id="sidebar-create-project-inline" style="display:none;">
            <div class="sidebar-create-input-row">
              <input type="text" id="sidebar-new-project-input" placeholder="Project name…" autocomplete="off" />
              <button id="sidebar-new-project-confirm">Create</button>
              <button class="cancel-btn" id="sidebar-new-project-cancel">✕</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Videos section -->
      <div class="sidebar-section">
        <div class="sidebar-section-header sidebar-section-header-plain">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
            <line x1="7" y1="2" x2="7" y2="22"/>
            <line x1="17" y1="2" x2="17" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <line x1="2" y1="7" x2="7" y2="7"/>
            <line x1="2" y1="17" x2="7" y2="17"/>
            <line x1="17" y1="17" x2="22" y2="17"/>
            <line x1="17" y1="7" x2="22" y2="7"/>
          </svg>
          <span class="sidebar-section-title">Videos</span>
        </div>
        <div id="sidebar-videos-list" class="sidebar-videos-list"></div>
      </div>
    </div>

    <div class="sidebar-footer">
      <button class="sidebar-theme-text-btn" id="sidebar-theme-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="theme-icon">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
        <span id="theme-label">Dark Mode</span>
      </button>
      <button class="sidebar-logout-btn" id="sidebar-logout-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Sign Out
      </button>
    </div>
  `;

  container.appendChild(sidebar);

  // Sidebar collapse toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'sidebar-toggle-btn';
  toggleBtn.title = 'Collapse sidebar';
  toggleBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  container.appendChild(toggleBtn);

  toggleBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    toggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggleBtn.innerHTML = collapsed
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    // Fire resize events throughout the CSS transition so video re-fits in real time
    const start = performance.now();
    (function fireResize() {
      window.dispatchEvent(new Event('resize'));
      if (performance.now() - start < 250) requestAnimationFrame(fireResize);
    })();
  });

  const searchInput          = sidebar.querySelector('#sidebar-search-input');
  const projectsSectionHeader = sidebar.querySelector('#projects-section-header');
  const projectsSectionContent = sidebar.querySelector('#projects-section-content');
  const projectsChevron      = sidebar.querySelector('#projects-chevron');
  const projectsList         = sidebar.querySelector('#sidebar-projects-list');
  const videosList           = sidebar.querySelector('#sidebar-videos-list');
  const createProjectBtn     = sidebar.querySelector('#sidebar-create-project-btn');
  const createProjectInline  = sidebar.querySelector('#sidebar-create-project-inline');
  const newProjectInput      = sidebar.querySelector('#sidebar-new-project-input');
  const newProjectConfirm    = sidebar.querySelector('#sidebar-new-project-confirm');
  const newProjectCancel     = sidebar.querySelector('#sidebar-new-project-cancel');
  const themeBtn             = sidebar.querySelector('#sidebar-theme-btn');
  const logoutBtn            = sidebar.querySelector('#sidebar-logout-btn');
  const newVideoBtn          = sidebar.querySelector('#sidebar-new-video-btn');

  // ── Logo → home ──────────────────────────────────────────────────────────
  const logoHome = sidebar.querySelector('#sidebar-logo-home');
  if (logoHome) logoHome.addEventListener('click', () => { window.location.href = '/'; });

  // ── Theme button ────────────────────────────────────────────────────────
  const themeLabel = sidebar.querySelector('#theme-label');
  const themeIcon  = sidebar.querySelector('#theme-icon');
  function updateThemeBtn() {
    const t = getTheme();
    if (t === 'light') {
      themeLabel.textContent = 'Dark Mode';
      themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>`;
    } else {
      themeLabel.textContent = 'Light Mode';
      themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
    }
  }
  updateThemeBtn();
  themeBtn.addEventListener('click', () => { toggleTheme(); updateThemeBtn(); });

  // ── Logout ───────────────────────────────────────────────────────────────
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // ── New Video button ─────────────────────────────────────────────────────
  newVideoBtn.addEventListener('click', () => {
    // Trigger the dashboard upload modal if available, otherwise navigate home
    if (typeof openUploadModal === 'function') {
      openUploadModal();
    } else {
      window.location.href = '/';
    }
  });

  // ── Projects section toggle ──────────────────────────────────────────────
  let projectsOpen = false;
  projectsSectionHeader.addEventListener('click', () => {
    projectsOpen = !projectsOpen;
    projectsSectionContent.style.display = projectsOpen ? 'block' : 'none';
    projectsChevron.style.transform = projectsOpen ? 'rotate(90deg)' : 'rotate(0deg)';
  });

  // ── Render projects ──────────────────────────────────────────────────────
  function renderProjects(filterText) {
    const q = (filterText || '').toLowerCase().trim();
    projectsList.innerHTML = '';

    const filtered = q
      ? projects.filter(p => p.name.toLowerCase().includes(q))
      : projects;

    if (filtered.length === 0) {
      projectsList.innerHTML = `<div style="padding:4px 12px 4px 28px; font-size:12px; color:var(--text-muted); font-style:italic;">No projects</div>`;
      return;
    }

    filtered.forEach(project => {
      const isActive = activeProjectId && String(project.id) === String(activeProjectId);
      const item = document.createElement('div');
      item.className = 'sidebar-project-item' + (isActive ? ' active' : '');
      item.dataset.projectId = project.id;

      // Get one video per version group for this project
      const projGroupMap = {};
      allVideos.filter(v => v.project_id && String(v.project_id) === String(project.id))
        .forEach(v => {
          const gid = v.version_group_id || ('solo_' + v.id);
          if (!projGroupMap[gid] || (v.version_number || 1) < (projGroupMap[gid].version_number || 1)) {
            projGroupMap[gid] = v;
          }
        });
      const projectVideos = Object.values(projGroupMap);

      item.innerHTML = `
        <div class="sidebar-project-row">
          <svg class="sidebar-project-expand" data-pid="${project.id}" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.15s ease;flex-shrink:0;">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span class="sidebar-project-name-text">${escapeHtml(project.name)}</span>
          <button class="sidebar-delete-btn" data-id="${project.id}" data-name="${escapeHtml(project.name)}" title="Delete project">🗑</button>
        </div>
        <div class="sidebar-project-children" style="display:none;">
          ${projectVideos.length > 0
            ? projectVideos.map(v => `
              <div class="sidebar-video-item${activeVideoId && (String(v.id) === String(activeVideoId) || (activeVersionGroupId && v.version_group_id && v.version_group_id === activeVersionGroupId)) ? ' active' : ''}" data-video-id="${v.id}">
                <span class="sidebar-video-item-icon">└</span>
                <span class="sidebar-video-item-name">${escapeHtml(v.name)}</span>
                <button class="sidebar-delete-btn sidebar-delete-video-btn" data-id="${v.id}" data-name="${escapeHtml(v.name)}" title="Delete video">🗑</button>
              </div>`).join('')
            : `<div style="padding:3px 8px 3px 36px; font-size:11px; color:var(--text-muted); font-style:italic;">No videos</div>`
          }
        </div>
      `;

      // Expand/collapse project children
      const expandBtn = item.querySelector('.sidebar-project-expand');
      const children  = item.querySelector('.sidebar-project-children');
      let open = isActive;
      if (open) { children.style.display = 'block'; expandBtn.style.transform = 'rotate(90deg)'; }

      expandBtn.addEventListener('click', e => {
        e.stopPropagation();
        open = !open;
        children.style.display = open ? 'block' : 'none';
        expandBtn.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
      });

      // Navigate to project on name click
      const nameEl = item.querySelector('.sidebar-project-name-text');
      nameEl.addEventListener('click', e => {
        e.stopPropagation();
        window.location.href = `/project/${project.id}`;
      });

      // Delete project
      const deleteProjectBtn = item.querySelector('.sidebar-project-row .sidebar-delete-btn');
      deleteProjectBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Delete project "${project.name}"? Videos in this project will become standalone.`)) {
          fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
            .then(r => {
              if (r.ok) {
                showToast('Project deleted', 'success');
                // Update project_id to null for affected videos
                allVideos.forEach(v => {
                  if (String(v.project_id) === String(project.id)) {
                    v.project_id = null;
                    v.project_name = null;
                  }
                });
                projects = projects.filter(p => String(p.id) !== String(project.id));
                renderProjects(searchInput.value);
                renderVideos(searchInput.value);
                window.dispatchEvent(new CustomEvent('feedo:project-deleted', { detail: { id: String(project.id) } }));
                if (String(activeProjectId) === String(project.id)) {
                  window.location.href = '/';
                }
              } else {
                showToast('Failed to delete project', 'error');
              }
            }).catch(() => showToast('Network error', 'error'));
        }
      });

      // Delete video buttons inside project
      item.querySelectorAll('.sidebar-delete-video-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const vid = btn.dataset.id;
          const vname = btn.dataset.name;
          if (confirm(`Delete video "${vname}"?`)) {
            fetch(`/api/videos/${vid}`, { method: 'DELETE' })
              .then(r => {
                if (r.ok) {
                  showToast('Video deleted', 'success');
                  allVideos = allVideos.filter(v => String(v.id) !== String(vid));
                  renderProjects(searchInput.value);
                  renderVideos(searchInput.value);
                  window.dispatchEvent(new CustomEvent('feedo:video-deleted', { detail: { id: String(vid) } }));
                  if (String(activeVideoId) === String(vid)) {
                    window.location.href = '/';
                  }
                } else {
                  showToast('Failed to delete video', 'error');
                }
              }).catch(() => showToast('Network error', 'error'));
          }
        });
      });

      // Video item navigation
      item.querySelectorAll('.sidebar-video-item').forEach(vi => {
        vi.addEventListener('click', e => {
          if (e.target.closest('.sidebar-delete-btn')) return;
          e.stopPropagation();
          window.location.href = `/video/${vi.dataset.videoId}`;
        });
      });

      projectsList.appendChild(item);
    });
  }

  // ── Render recent videos ─────────────────────────────────────────────────
  function renderVideos(filterText) {
    const q = (filterText || '').toLowerCase().trim();
    videosList.innerHTML = '';

    // Show one entry per version group (the lowest version number), so all videos appear
    const groupMap = {};
    allVideos.forEach(v => {
      const gid = v.version_group_id || ('solo_' + v.id);
      if (!groupMap[gid] || (v.version_number || 1) < (groupMap[gid].version_number || 1)) {
        groupMap[gid] = v;
      }
    });
    const primaryVideos = Object.values(groupMap);
    const filtered = q
      ? primaryVideos.filter(v => v.name.toLowerCase().includes(q))
      : primaryVideos;

    if (filtered.length === 0) {
      videosList.innerHTML = `<div style="padding:6px 12px; font-size:12px; color:var(--text-muted); font-style:italic;">No videos</div>`;
      return;
    }

    filtered.forEach(v => {
      const isActive = activeVideoId && (
        String(v.id) === String(activeVideoId) ||
        (activeVersionGroupId && v.version_group_id && v.version_group_id === activeVersionGroupId)
      );
      const item = document.createElement('div');
      item.className = 'sidebar-video-list-item' + (isActive ? ' active' : '');
      item.dataset.videoId = v.id;
      item.innerHTML = `
        <span class="sidebar-video-list-icon">🎬</span>
        <span class="sidebar-video-list-name">${escapeHtml(v.name)}</span>
        <button class="sidebar-delete-btn" data-id="${v.id}" data-name="${escapeHtml(v.name)}" title="Delete video">🗑</button>
      `;

      item.addEventListener('click', e => {
        if (e.target.closest('.sidebar-delete-btn')) return;
        window.location.href = `/video/${v.id}`;
      });

      item.querySelector('.sidebar-delete-btn').addEventListener('click', e => {
        e.stopPropagation();
        const vid = e.currentTarget.dataset.id;
        const vname = e.currentTarget.dataset.name;
        if (confirm(`Delete video "${vname}"?`)) {
          fetch(`/api/videos/${vid}`, { method: 'DELETE' })
            .then(r => {
              if (r.ok) {
                showToast('Video deleted', 'success');
                allVideos = allVideos.filter(vv => String(vv.id) !== String(vid));
                renderVideos(searchInput.value);
                renderProjects(searchInput.value);
                window.dispatchEvent(new CustomEvent('feedo:video-deleted', { detail: { id: String(vid) } }));
                if (String(activeVideoId) === String(vid)) {
                  window.location.href = '/';
                }
              } else {
                showToast('Failed to delete video', 'error');
              }
            }).catch(() => showToast('Network error', 'error'));
        }
      });

      videosList.appendChild(item);
    });
  }

  renderProjects('');
  renderVideos('');

  // ── Sync with dashboard/other panels ────────────────────────────────────
  window.addEventListener('feedo:video-added', e => {
    const v = e.detail.video;
    if (!allVideos.some(existing => String(existing.id) === String(v.id))) {
      allVideos.unshift(v);
    }
    renderVideos(searchInput.value);
    renderProjects(searchInput.value);
  });

  window.addEventListener('feedo:video-deleted', e => {
    const id = e.detail.id;
    allVideos = allVideos.filter(v => String(v.id) !== String(id));
    renderVideos(searchInput.value);
    renderProjects(searchInput.value);
  });

  window.addEventListener('feedo:project-deleted', e => {
    const id = e.detail.id;
    allVideos.forEach(v => { if (String(v.project_id) === String(id)) { v.project_id = null; v.project_name = null; } });
    projects = projects.filter(p => String(p.id) !== String(id));
    renderProjects(searchInput.value);
    renderVideos(searchInput.value);
  });

  // ── Search ───────────────────────────────────────────────────────────────
  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    renderProjects(q);
    renderVideos(q);
    // Auto-expand projects section if searching
    if (q && !projectsOpen) {
      projectsOpen = true;
      projectsSectionContent.style.display = 'block';
      projectsChevron.textContent = '▼';
    }
  });

  // ── Create project ───────────────────────────────────────────────────────
  createProjectBtn.addEventListener('click', () => {
    createProjectBtn.style.display = 'none';
    createProjectInline.style.display = 'block';
    setTimeout(() => newProjectInput.focus(), 50);
  });

  function hideCreateInline() {
    createProjectInline.style.display = 'none';
    createProjectBtn.style.display = '';
    newProjectInput.value = '';
  }

  newProjectCancel.addEventListener('click', hideCreateInline);

  async function doCreateProject() {
    const name = newProjectInput.value.trim();
    if (!name) { newProjectInput.focus(); return; }

    newProjectConfirm.disabled = true;
    newProjectConfirm.textContent = '…';

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      if (res.ok) {
        const project = await res.json();
        projects.unshift(project);
        hideCreateInline();
        renderProjects(searchInput.value);
        showToast('Project created', 'success');
        window.location.href = `/project/${project.id}`;
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to create project', 'error');
      }
    } catch (e) {
      showToast('Network error', 'error');
    } finally {
      newProjectConfirm.disabled = false;
      newProjectConfirm.textContent = 'Create';
    }
  }

  newProjectConfirm.addEventListener('click', doCreateProject);
  newProjectInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doCreateProject();
    if (e.key === 'Escape') hideCreateInline();
  });
}
