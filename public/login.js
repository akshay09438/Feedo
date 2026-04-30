/* ── login.js — login page logic ─────────────────────────────────────────────── */
(function () {
  'use strict';

  initTheme();

  function showNamePrompt() {
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

  // ── Tab switching ─────────────────────────────────────────────────────────────
  const tabSignin  = document.getElementById('tab-signin');
  const tabSignup  = document.getElementById('tab-signup');
  const loginForm  = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');

  function showTab(tab) {
    if (tab === 'signin') {
      tabSignin.classList.add('active');
      tabSignup.classList.remove('active');
      loginForm.style.display = '';
      signupForm.style.display = 'none';
      document.getElementById('login-error').classList.remove('visible');
    } else {
      tabSignup.classList.add('active');
      tabSignin.classList.remove('active');
      signupForm.style.display = '';
      loginForm.style.display = 'none';
      document.getElementById('signup-error').classList.remove('visible');
    }
  }

  tabSignin.addEventListener('click', () => showTab('signin'));
  tabSignup.addEventListener('click', () => showTab('signup'));

  // ── Auth status check ─────────────────────────────────────────────────────────
  fetch('/api/auth/status').then(r => r.json()).then(data => {
    if (data.authenticated) window.location.href = '/';
  }).catch(() => {});

  // ── Sign In ───────────────────────────────────────────────────────────────────
  const usernameInput = document.getElementById('username-input');
  const passwordInput = document.getElementById('password-input');
  const loginError    = document.getElementById('login-error');

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      loginError.textContent = 'Please enter both email and password.';
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
        loginError.textContent = data.error || 'Incorrect email or password. Please try again.';
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

  // ── Sign Up ───────────────────────────────────────────────────────────────────
  const signupError    = document.getElementById('signup-error');
  const signupName     = document.getElementById('signup-name-input');
  const signupEmail    = document.getElementById('signup-email-input');
  const signupPassword = document.getElementById('signup-password-input');
  const signupConfirm  = document.getElementById('signup-confirm-input');

  signupForm.addEventListener('submit', async e => {
    e.preventDefault();

    const name     = signupName.value.trim();
    const email    = signupEmail.value.trim();
    const password = signupPassword.value;
    const confirm  = signupConfirm.value;

    if (!email) {
      signupError.textContent = 'Please enter your email.';
      signupError.classList.add('visible');
      signupEmail.focus();
      return;
    }
    if (!password || password.length < 8) {
      signupError.textContent = 'Password must be at least 8 characters.';
      signupError.classList.add('visible');
      signupPassword.focus();
      return;
    }
    if (password !== confirm) {
      signupError.textContent = 'Passwords do not match.';
      signupError.classList.add('visible');
      signupConfirm.focus();
      return;
    }

    signupError.classList.remove('visible');
    const submitBtn = signupForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, display_name: name || null })
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        if (name) localStorage.setItem('feedo_display_name', name);
        window.location.href = '/';
      } else {
        signupError.textContent = data.error || 'Failed to create account. Please try again.';
        signupError.classList.add('visible');
      }
    } catch (err) {
      signupError.textContent = 'Connection error. Please try again.';
      signupError.classList.add('visible');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  });
})();
