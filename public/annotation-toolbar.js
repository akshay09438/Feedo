/* annotation-toolbar.js — floating pill toolbar */

class AnnotationToolbar {
  constructor(container) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position:     'absolute',
      bottom:       '16px',
      left:         '50%',
      transform:    'translateX(-50%)',
      zIndex:       '20',
      background:   '#ffffff',
      borderRadius: '9999px',
      padding:      '8px 16px',
      display:      'none',
      flexDirection:'row',
      gap:          '8px',
      alignItems:   'center',
      boxShadow:    '0 2px 12px rgba(0,0,0,0.18)',
      whiteSpace:   'nowrap',
      userSelect:   'none',
    });

    this._drawBtn   = this._makeBtn('✏ Draw');
    this._textBtn   = this._makeBtn('T Text');
    this._div1      = this._makeDivider();
    this._undoBtn   = this._makeBtn('↩ Undo');
    this._div2      = this._makeDivider();
    this._postBtn   = this._makeBtn('Post');
    this._cancelBtn = this._makeBtn('Cancel');

    // Style Post distinctively
    Object.assign(this._postBtn.style, {
      background:   '#FF3B30',
      color:        '#ffffff',
      fontWeight:   '600',
    });

    [
      this._drawBtn, this._textBtn,
      this._div1, this._undoBtn,
      this._div2, this._postBtn, this._cancelBtn,
    ].forEach(el => this.el.appendChild(el));

    container.appendChild(this.el);

    // Callbacks
    this.onDraw   = null;
    this.onText   = null;
    this.onUndo   = null;
    this.onPost   = null;
    this.onCancel = null;

    this._drawBtn.addEventListener('click',   () => this.onDraw   && this.onDraw());
    this._textBtn.addEventListener('click',   () => this.onText   && this.onText());
    this._undoBtn.addEventListener('click',   () => this.onUndo   && this.onUndo());
    this._postBtn.addEventListener('click',   () => this.onPost   && this.onPost());
    this._cancelBtn.addEventListener('click', () => this.onCancel && this.onCancel());

    this.setPostEnabled(false);
  }

  _makeBtn(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      background:   'none',
      border:       'none',
      cursor:       'pointer',
      padding:      '6px 12px',
      borderRadius: '6px',
      fontSize:     '13px',
      fontWeight:   '500',
      color:        '#374151',
      transition:   'background 0.15s, color 0.15s',
    });
    return btn;
  }

  _makeDivider() {
    const d = document.createElement('div');
    Object.assign(d.style, {
      width:      '1px',
      height:     '20px',
      background: '#e5e7eb',
      flexShrink: '0',
    });
    return d;
  }

  show() { this.el.style.display = 'flex'; }
  hide() { this.el.style.display = 'none'; }

  setActiveTool(tool) {
    [this._drawBtn, this._textBtn].forEach(btn => {
      btn.style.background = 'none';
      btn.style.color      = '#374151';
    });
    if (tool === 'draw') {
      this._drawBtn.style.background = '#FF3B30';
      this._drawBtn.style.color      = '#ffffff';
    } else if (tool === 'text') {
      this._textBtn.style.background = '#FF3B30';
      this._textBtn.style.color      = '#ffffff';
    }
  }

  setPostEnabled(enabled) {
    this._postBtn.style.opacity       = enabled ? '1' : '0.35';
    this._postBtn.style.pointerEvents = enabled ? 'auto' : 'none';
    this._postBtn.disabled            = !enabled;
  }
}
