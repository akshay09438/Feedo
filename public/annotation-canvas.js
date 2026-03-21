/* annotation-canvas.js — canvas overlay for drawing + text annotations */

class AnnotationCanvas {
  constructor(videoEl) {
    this.videoEl   = videoEl;
    this.canvas    = document.createElement('canvas');
    this.ctx       = this.canvas.getContext('2d');
    this.strokes   = [];
    this.textBoxes = [];
    this._history  = []; // { type: 'stroke'|'textBox', item }
    this.activeTool    = null;
    this._drawing      = false;
    this._currentStroke = null;

    this.onStrokeComplete  = null;
    this.onTextBoxComplete = null;

    Object.assign(this.canvas.style, {
      position:      'absolute',
      top:           '0',
      left:          '0',
      width:         '100%',
      height:        '100%',
      zIndex:        '10',
      pointerEvents: 'none',
    });

    // Insert canvas right after the video element inside the wrapper
    videoEl.insertAdjacentElement('afterend', this.canvas);

    this._bindEvents();

    // Size canvas once layout is ready
    this._syncSize();
    setTimeout(() => this._syncSize(), 100);
    setTimeout(() => this._syncSize(), 500);

    videoEl.addEventListener('loadedmetadata', () => this._syncSize());
    window.addEventListener('resize', () => { this._syncSize(); this.redraw(); });
  }

  // ── sizing ────────────────────────────────────────────────────────────────
  _syncSize() {
    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;
    if (w > 0 && h > 0) {
      this.canvas.width  = w;
      this.canvas.height = h;
      this.redraw();
    }
  }

  // ── tool control ──────────────────────────────────────────────────────────
  setTool(tool) {
    this.activeTool = tool;
    this.canvas.style.pointerEvents = tool ? 'auto' : 'none';
  }

  // ── event binding ─────────────────────────────────────────────────────────
  _bindEvents() {
    // Mouse
    this.canvas.addEventListener('mousedown',  e => this._onDown(e.offsetX, e.offsetY));
    this.canvas.addEventListener('mousemove',  e => this._onMove(e.offsetX, e.offsetY));
    this.canvas.addEventListener('mouseup',    ()  => this._onUp());
    this.canvas.addEventListener('mouseleave', ()  => this._onUp());
    this.canvas.addEventListener('click',      e => this._onClick(e));

    // Touch
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const r   = this.canvas.getBoundingClientRect();
      const t   = e.touches[0];
      this._onDown(t.clientX - r.left, t.clientY - r.top);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const t = e.touches[0];
      this._onMove(t.clientX - r.left, t.clientY - r.top);
    }, { passive: false });

    this.canvas.addEventListener('touchend', e => {
      e.preventDefault();
      this._onUp();
    }, { passive: false });
  }

  // ── coordinate helpers ────────────────────────────────────────────────────
  _toPercent(px, py) {
    return {
      x: px / this.canvas.offsetWidth  * 100,
      y: py / this.canvas.offsetHeight * 100,
    };
  }

  _toPixel(xPct, yPct) {
    return {
      x: xPct / 100 * this.canvas.width,
      y: yPct / 100 * this.canvas.height,
    };
  }

  // ── draw mode handlers ────────────────────────────────────────────────────
  _onDown(px, py) {
    if (this.activeTool !== 'draw') return;
    this._drawing = true;
    const pt = this._toPercent(px, py);
    this._currentStroke = { id: generateId(), points: [pt], color: '#FF3B30', width: 3 };

    this.ctx.beginPath();
    this.ctx.strokeStyle = '#FF3B30';
    this.ctx.lineWidth   = 3;
    this.ctx.lineCap     = 'round';
    this.ctx.lineJoin    = 'round';
    this.ctx.moveTo(px, py);
  }

  _onMove(px, py) {
    if (this.activeTool !== 'draw' || !this._drawing) return;
    this._currentStroke.points.push(this._toPercent(px, py));
    this.ctx.lineTo(px, py);
    this.ctx.stroke();
  }

  _onUp() {
    if (this.activeTool !== 'draw' || !this._drawing) return;
    this._drawing = false;
    if (this._currentStroke && this._currentStroke.points.length > 1) {
      this.strokes.push(this._currentStroke);
      this._history.push({ type: 'stroke', item: this._currentStroke });
      if (this.onStrokeComplete) this.onStrokeComplete(this._currentStroke);
    }
    this._currentStroke = null;
  }

  // ── text mode handler ─────────────────────────────────────────────────────
  _onClick(e) {
    if (this.activeTool !== 'text') return;

    const wrapper = this.videoEl.parentElement;
    const wRect   = wrapper.getBoundingClientRect();
    const left    = e.clientX - wRect.left;
    const top     = e.clientY - wRect.top;

    const textarea = document.createElement('textarea');
    Object.assign(textarea.style, {
      position:   'absolute',
      left:       left + 'px',
      top:        top  + 'px',
      background: 'transparent',
      border:     '1px dashed rgba(255,59,48,0.5)',
      outline:    'none',
      color:      '#FF3B30',
      fontSize:   '16px',
      fontFamily: 'sans-serif',
      lineHeight: '1.4',
      minWidth:   '120px',
      minHeight:  '32px',
      resize:     'both',
      zIndex:     '30',
      padding:    '2px 4px',
    });

    wrapper.appendChild(textarea);
    setTimeout(() => textarea.focus(), 10);

    let finalised = false;
    const finalise = () => {
      if (finalised) return;
      finalised = true;
      const text = textarea.value.trim();
      if (text) {
        const ww  = wrapper.offsetWidth;
        const wh  = wrapper.offsetHeight;
        const tb  = createTextBox(
          generateId(),
          left / ww * 100,
          top  / wh * 100,
          textarea.offsetWidth / ww * 100,
          text,
          16
        );
        this.textBoxes.push(tb);
        this._history.push({ type: 'textBox', item: tb });
        if (this.onTextBoxComplete) this.onTextBoxComplete(tb);
        this.redraw();
      }
      if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
    };

    textarea.addEventListener('blur', finalise);
    textarea.addEventListener('keydown', e2 => {
      if (e2.key === 'Enter' && !e2.shiftKey) { e2.preventDefault(); textarea.blur(); }
      if (e2.key === 'Escape') {
        finalised = true; // skip saving
        if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
      }
    });
  }

  // ── redraw all ────────────────────────────────────────────────────────────
  redraw() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!w || !h) return;
    this.ctx.clearRect(0, 0, w, h);

    for (const stroke of this.strokes) {
      if (stroke.points.length < 2) continue;
      this.ctx.beginPath();
      this.ctx.strokeStyle = stroke.color || '#FF3B30';
      this.ctx.lineWidth   = stroke.width || 3;
      this.ctx.lineCap     = 'round';
      this.ctx.lineJoin    = 'round';
      stroke.points.forEach((pt, i) => {
        const { x, y } = this._toPixel(pt.x, pt.y);
        i === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y);
      });
      this.ctx.stroke();
    }

    for (const tb of this.textBoxes) {
      const { x, y } = this._toPixel(tb.x, tb.y);
      this.ctx.font      = `${tb.fontSize || 16}px sans-serif`;
      this.ctx.fillStyle = '#FF3B30';
      this.ctx.fillText(tb.text, x, y + (tb.fontSize || 16));
    }
  }

  // ── load saved annotation (replay) ────────────────────────────────────────
  loadAnnotation(annotation) {
    this.strokes   = annotation.strokes   ? [...annotation.strokes]   : [];
    this.textBoxes = annotation.textBoxes ? [...annotation.textBoxes] : [];
    this._history  = [];
    this._syncSize();
    this.redraw();
  }

  // ── clear everything ──────────────────────────────────────────────────────
  clearAll() {
    this.strokes        = [];
    this.textBoxes      = [];
    this._history       = [];
    this._drawing       = false;
    this._currentStroke = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ── undo last action ──────────────────────────────────────────────────────
  undo() {
    if (!this._history.length) return;
    const last = this._history.pop();
    if (last.type === 'stroke') {
      const idx = this.strokes.indexOf(last.item);
      if (idx !== -1) this.strokes.splice(idx, 1);
    } else {
      const idx = this.textBoxes.indexOf(last.item);
      if (idx !== -1) this.textBoxes.splice(idx, 1);
    }
    this.redraw();
  }

  // ── snapshot (video frame + annotations) ──────────────────────────────────
  getSnapshot() {
    const vw = this.videoEl.videoWidth  || this.canvas.offsetWidth;
    const vh = this.videoEl.videoHeight || this.canvas.offsetHeight;

    // Render at native video resolution
    const temp    = document.createElement('canvas');
    temp.width    = vw;
    temp.height   = vh;
    const tempCtx = temp.getContext('2d');

    // Draw video frame
    try { tempCtx.drawImage(this.videoEl, 0, 0, vw, vh); } catch (e) { /* CORS */ }

    // Draw annotations scaled to native res
    const saved = { w: this.canvas.width, h: this.canvas.height };
    this.canvas.width  = vw;
    this.canvas.height = vh;
    this.redraw();
    tempCtx.drawImage(this.canvas, 0, 0);

    // Restore canvas
    this.canvas.width  = saved.w;
    this.canvas.height = saved.h;
    this.redraw();

    return temp.toDataURL('image/jpeg', 0.85);
  }
}
