/* ── login.js — login page logic ─────────────────────────────────────────────── */
(function () {
  'use strict';

  initTheme();

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
        window.location.href = '/';
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
