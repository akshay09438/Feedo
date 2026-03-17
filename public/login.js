/* ── login.js — login page logic ─────────────────────────────────────────────── */
(function () {
  'use strict';

  initTheme();

  function showNamePrompt() {
    // Build a simple modal overlay
    let backdrop = document.getElementById('modal-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'modal-backdrop';
      document.body.appendChild(backdrop);
    }

    backdrop.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'modal-box';
    box.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">What's your name?</span>
      </div>
      <p style="font-size:13px; color:var(--text-secondary); margin-bottom:14px;">
        This name will appear on comments you leave.
      </p>
      <input type="text" id="name-prompt-input" class="form-input" placeholder="Enter your name…" style="width:100%; margin-bottom:14px;" />
      <div class="modal-footer" style="margin-top:0;">
        <button class="btn btn-primary" id="name-prompt-confirm" style="width:100%; justify-content:center;">Continue</button>
      </div>
    `;
    backdrop.appendChild(box);
    requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('open')));

    const input = box.querySelector('#name-prompt-input');
    const confirmBtn = box.querySelector('#name-prompt-confirm');

    function confirmName() {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      localStorage.setItem('feedo_display_name', name);
      fetch('/api/auth/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      }).catch(() => {});
      window.location.href = '/';
    }

    confirmBtn.addEventListener('click', confirmName);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); });
    setTimeout(() => input.focus(), 50);
  }

  const loginForm     = document.getElementById('login-form');
  const usernameInput = document.getElementById('username-input');
  const passwordInput = document.getElementById('password-input');
  const loginError    = document.getElementById('login-error');

  // If already authenticated, redirect to home
  fetch('/api/auth/status').then(r => r.json()).then(data => {
    if (data.authenticated) window.location.href = '/';
  }).catch(() => {});

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      loginError.textContent = 'Please enter both username and password.';
      loginError.classList.add('visible');
      return;
    }

    loginError.classList.remove('visible');
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        const existingName = localStorage.getItem('feedo_display_name');
        if (!existingName || !existingName.trim()) {
          showNamePrompt();
        } else {
          window.location.href = '/';
        }
      } else {
        loginError.textContent = data.error || 'Incorrect username or password. Please try again.';
        loginError.classList.add('visible');
        passwordInput.value = '';
        passwordInput.focus();
      }
    } catch (err) {
      loginError.textContent = 'Connection error. Please try again.';
      loginError.classList.add('visible');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
})();
