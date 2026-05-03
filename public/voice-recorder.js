/* voice-recorder.js — MediaRecorder-based voice feedback */

class VoiceRecorder {
  constructor(onRecordingComplete) {
    this.onRecordingComplete = onRecordingComplete; // callback(blob, duration)
    this.recorder    = null;
    this.stream      = null;
    this.chunks      = [];
    this.startTime   = null;
    this.timerInterval = null;
    this.state       = 'idle'; // 'idle' | 'recording'
  }

  async _getStream() {
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    return this.stream;
  }

  async start() {
    if (this.state === 'recording') return;
    this.chunks = [];

    const stream = await this._getStream();
    this.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    this.recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: 'audio/webm' });
      const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
      this.chunks = [];
      this.startTime = null;
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      if (this.onRecordingComplete) this.onRecordingComplete(blob, duration);
    };

    this.recorder.start(100); // collect data every 100ms
    this.startTime = Date.now();
    this.state = 'recording';
  }

  stop() {
    if (this.state !== 'recording' || !this.recorder) return;
    this.recorder.stop();
    this.state = 'idle';
  }

  toggle() {
    if (this.state === 'recording') this.stop();
    else this.start();
  }

  // Call this when tearing down the component / page
  destroy() {
    this.stop();
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    clearInterval(this.timerInterval);
  }
}

// ── UI: Record button + inline recorder ─────────────────────────────────────

function createVoiceRecorderUI(containerEl, onComplete) {
  const recorder = new VoiceRecorder((blob, duration) => {
    onComplete(blob, duration);
    hide();
  });

  // Icon SVGs
  const micIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
  const stopIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;
  const closeIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  const btn = document.createElement('button');
  btn.className = 'voice-record-btn';
  btn.title = 'Record voice feedback';
  btn.innerHTML = micIcon;
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 5px;
    background: none; border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 10px; cursor: pointer; color: var(--text-secondary);
    font-size: 12px; transition: all 0.15s;
  `;

  let panel = null;
  let durationEl = null;
  let cancelBtn = null;

  function showPanel() {
    if (panel) { panel.remove(); panel = null; }

    panel = document.createElement('div');
    panel.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      background: var(--surface-2); border: 1px solid var(--border);
      border-radius: 8px; padding: 8px 12px; margin-top: 6px;
    `;

    const recordingDot = document.createElement('span');
    recordingDot.style.cssText = `
      width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
      animation: voicePulse 1s ease-in-out infinite;
    `;

    const style = document.createElement('style');
    style.textContent = `@keyframes voicePulse{0%,100%{opacity:1}50%{opacity:0.3}}`;
    document.head.appendChild(style);

    const timeEl = document.createElement('span');
    timeEl.style.cssText = 'font-size:12px; color:var(--text-secondary); font-variant-numeric:tabular-nums; min-width:36px;';
    timeEl.textContent = '0:00';
    durationEl = timeEl;

    cancelBtn = document.createElement('button');
    cancelBtn.innerHTML = closeIcon;
    cancelBtn.title = 'Cancel recording';
    cancelBtn.style.cssText = 'background:none; border:none; cursor:pointer; color:var(--text-secondary); padding:2px; display:flex; align-items:center;';
    cancelBtn.addEventListener('click', () => {
      recorder.destroy();
      hide();
    });

    panel.appendChild(recordingDot);
    panel.appendChild(timeEl);
    panel.appendChild(cancelBtn);
    containerEl.appendChild(panel);

    // Timer
    recorder.timerInterval = setInterval(() => {
      if (recorder.startTime && durationEl) {
        const secs = Math.floor((Date.now() - recorder.startTime) / 1000);
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        durationEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      }
    }, 500);
  }

  function hide() {
    if (panel) { panel.remove(); panel = null; }
    clearInterval(recorder.timerInterval);
    btn.innerHTML = micIcon;
    btn.style.color = 'var(--text-secondary)';
    btn.style.borderColor = 'var(--border)';
    recorder.state = 'idle';
    recorder.chunks = [];
  }

  btn.addEventListener('click', () => {
    if (recorder.state === 'idle') {
      recorder.start();
      btn.innerHTML = stopIcon;
      btn.style.color = '#ef4444';
      btn.style.borderColor = '#ef4444';
      showPanel();
    } else {
      recorder.stop();
      hide();
    }
  });

  containerEl.appendChild(btn);

  return {
    btn,
    recorder,
    destroy() {
      recorder.destroy();
      if (panel) panel.remove();
    }
  };
}