/* annotation-composer.js — comment card shown after clicking Post */

class AnnotationComposer {
  constructor(container) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      background:    '#ffffff',
      border:        '1px solid #e5e7eb',
      borderRadius:  '12px',
      padding:       '16px',
      display:       'none',
      flexDirection: 'column',
      gap:           '12px',
      marginTop:     '12px',
    });

    // ── header row: thumbnail + timestamp ─────────────────────────────────
    const header = document.createElement('div');
    Object.assign(header.style, {
      display:    'flex',
      gap:        '12px',
      alignItems: 'center',
    });

    this._img = document.createElement('img');
    Object.assign(this._img.style, {
      width:       '120px',
      height:      '72px',
      borderRadius:'8px',
      objectFit:   'cover',
      flexShrink:  '0',
      background:  '#f3f4f6',
    });

    this._tsLabel = document.createElement('span');
    Object.assign(this._tsLabel.style, {
      fontSize:   '14px',
      fontWeight: '600',
      color:      '#374151',
    });

    header.appendChild(this._img);
    header.appendChild(this._tsLabel);

    // ── textarea ──────────────────────────────────────────────────────────
    this._textarea = document.createElement('textarea');
    this._textarea.placeholder = 'Add a comment…';
    this._textarea.rows = 3;
    Object.assign(this._textarea.style, {
      width:       '100%',
      padding:     '8px 10px',
      border:      '1px solid #e5e7eb',
      borderRadius:'8px',
      fontSize:    '14px',
      fontFamily:  'inherit',
      resize:      'vertical',
      outline:     'none',
      boxSizing:   'border-box',
      color:       '#111827',
    });

    // ── button row ────────────────────────────────────────────────────────
    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      display:        'flex',
      gap:            '8px',
      justifyContent: 'flex-end',
    });

    this._cancelBtn = this._makeBtn('Cancel', false);
    this._submitBtn = this._makeBtn('Submit', true);

    btnRow.appendChild(this._cancelBtn);
    btnRow.appendChild(this._submitBtn);

    this.el.appendChild(header);
    this.el.appendChild(this._textarea);
    this.el.appendChild(btnRow);

    container.appendChild(this.el);

    // Callbacks
    this.onSubmit = null;
    this.onCancel = null;

    this._submitBtn.addEventListener('click', () => {
      const text = this._textarea.value.trim();
      if (!text) { this._textarea.focus(); return; }
      if (this.onSubmit) this.onSubmit(text);
    });

    this._cancelBtn.addEventListener('click', () => {
      if (this.onCancel) this.onCancel();
    });

    // Enter to submit
    this._textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submitBtn.click(); }
    });
  }

  _makeBtn(label, primary) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      padding:      '8px 18px',
      borderRadius: '6px',
      fontSize:     '13px',
      fontWeight:   '500',
      cursor:       'pointer',
      border:       primary ? 'none' : '1px solid #e5e7eb',
      background:   primary ? '#FF3B30' : 'transparent',
      color:        primary ? '#ffffff' : '#374151',
    });
    return btn;
  }

  show(thumbnailDataUrl, timestamp) {
    this._img.src         = thumbnailDataUrl;
    this._tsLabel.textContent = formatTimestamp(timestamp);
    this._textarea.value  = '';
    this.el.style.display = 'flex';
    setTimeout(() => this._textarea.focus(), 50);
  }

  hide() {
    this.el.style.display = 'none';
    this._textarea.value  = '';
  }
}
