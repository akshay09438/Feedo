/* video-annotator.js — main controller / state machine */

class VideoAnnotator {
  constructor(videoEl, commentListEl, videoId) {
    this.videoEl       = videoEl;
    this.commentListEl = commentListEl;
    this.videoId       = videoId;

    // State machine: 'idle' | 'annotating' | 'composing'
    this.stage            = 'idle';
    this.currentTimestamp = null;
    this._replayTimer     = null;
    this._suppressPause   = false; // prevent replay-pause from opening toolbar
    this._hasPlayed       = false; // don't open toolbar before first play
    this._pendingThumbnail = null; // thumbnail captured in _onPost(), used in _onCommentSubmit()
    this._activeAnnotationId = null;    // annotation pinned by card click — makes it "sticky"
    this._activeAnnotationTimestamp = null;

    const wrapper = videoEl.parentElement; // .video-wrapper

    // ── Instantiate components ─────────────────────────────────────────────
    this.canvas  = new AnnotationCanvas(videoEl);
    this.toolbar = new AnnotationToolbar(wrapper);

    // Composer goes right after the video wrapper in the DOM
    const composerWrap = document.createElement('div');
    composerWrap.style.padding = '0 4px';
    wrapper.insertAdjacentElement('afterend', composerWrap);
    this.composer = new AnnotationComposer(composerWrap);

    // ── Load + render saved annotation data ────────────────────────────────
    this.annotations = loadAnnotations(videoId);
    // Legacy: annotations were previously rendered as DOM cards here.
    // Now handled by video.js renderComments() — just load data silently.

    // ── Wire canvas callbacks ──────────────────────────────────────────────
    this.canvas.onStrokeComplete  = s  => this._onStrokeComplete(s);
    this.canvas.onTextBoxComplete = tb => this._onTextBoxComplete(tb);

    // ── Wire toolbar callbacks ─────────────────────────────────────────────
    this.toolbar.onDraw = () => {
      this.canvas.setTool('draw');
      this.toolbar.setActiveTool('draw');
    };
    this.toolbar.onText = () => {
      this.canvas.setTool('text');
      this.toolbar.setActiveTool('text');
    };
    this.toolbar.onUndo   = () => this._onUndo();
    this.toolbar.onPost   = () => this._onPost();
    this.toolbar.onCancel = () => this._cancel();

    // ── Wire composer callbacks ────────────────────────────────────────────
    this.composer.onSubmit = text => this._onCommentSubmit(text);
    this.composer.onCancel = () => this._cancel();

    // ── Video events ───────────────────────────────────────────────────────
    videoEl.addEventListener('play', () => {
      this._hasPlayed = true;
      this._cancel();
    });

    videoEl.addEventListener('pause', () => {
      if (this._suppressPause) { this._suppressPause = false; return; }
      if (!this._hasPlayed)    return; // ignore initial pause before first play
      if (this.stage === 'idle') this._startAnnotating(videoEl.currentTime);
    });
  }

  // ── State transitions ──────────────────────────────────────────────────────

  _startAnnotating(timestamp) {
    this.stage            = 'annotating';
    this.currentTimestamp = timestamp;
    // Clear "sticky" active annotation so the RAF loop uses normal WIN filtering
    this._activeAnnotationId = null;
    this._activeAnnotationTimestamp = null;
    document.dispatchEvent(new CustomEvent('feedo:annotationDeactivated'));
    this.canvas.clearAll();
    this.canvas.setTool(null);      // no tool active — cursor stays normal
    this.toolbar.setActiveTool(null); // no button highlighted until user picks one
    this.toolbar.setPostEnabled(false);
    this.toolbar.show();
  }

  // Called by video.js after a comment card is clicked — pins the annotation "sticky"
  setActiveAnnotation(id, timestamp) {
    this._activeAnnotationId = id;
    this._activeAnnotationTimestamp = timestamp;
    document.dispatchEvent(new CustomEvent('feedo:annotationActivated', {
      detail: { id, timestamp }
    }));
  }

  _onStrokeComplete() {
    this.toolbar.setPostEnabled(true);
  }

  _onTextBoxComplete() {
    this.toolbar.setPostEnabled(true);
  }

  _onUndo() {
    this.canvas.undo();
    const hasContent = this.canvas.strokes.length > 0 || this.canvas.textBoxes.length > 0;
    this.toolbar.setPostEnabled(hasContent);
  }

  _onPost() {
    this.toolbar.hide();
    const thumbnail = this.canvas.getSnapshot();
    this.composer.show(thumbnail, this.currentTimestamp);
  }

  async _onCommentSubmit(commentText) {
    const author   = localStorage.getItem('feedo_display_name') || 'Admin';
    const strokes   = [...this.canvas.strokes];
    const textBoxes = [...this.canvas.textBoxes];
    const thumbnail = this._pendingThumbnail;
    this._pendingThumbnail = null;

    this.composer.hide();

    // getSnapshot() ends with this.redraw(), so the drawing is already visible.
    // Don't clearAll()+loadAnnotation() — that sequence can leave a blank canvas
    // if _syncSize() reads offsetWidth=0 during the brief layout-pending window.
    // Just disable interaction and let the RAF leave the canvas alone (stage≠idle).
    this.canvas.setTool(null);
    this.stage = 'idle'; // back to idle so the RAF loop controls visibility based on currentTime
    if (this._replayTimer) { clearTimeout(this._replayTimer); this._replayTimer = null; }

    try {
      const res = await fetch(`/api/videos/${this.videoId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp:    this.currentTimestamp,
          text:         commentText,
          display_name: author
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (typeof showToast === 'function') showToast(errData.error || 'Failed to post comment (' + res.status + ')', 'error');
        else console.error('Annotation comment post failed', res.status, errData);
        this._cancel();
        return;
      }

      const newComment = await res.json();
      newComment.attachments = [];
      newComment.isAnnotation = true; // prevents buildCommentCard from rendering a duplicate card
      newComment.author = author;      // same value buildCommentCard uses → same color

      // Compute author color using same hash as video.js getAuthorColor()
      let h = 0;
      for (let i = 0; i < author.length; i++) h = (h * 31 + author.charCodeAt(i)) >>> 0;
      const pillColor = ['#f59e0b','#10b981','#8b5cf6','#ef4444','#f97316','#06b6d4','#ec4899','#84cc16','#a78bfa','#fb923c'][h % 10];

      // Dispatch so video.js picks it up — it will call renderComments() which
      // renders the card as a regular comment with Drawing badge + thumbnail.
      document.dispatchEvent(new CustomEvent('feedo:commentAdded', { detail: newComment }));
      if (typeof showToast === 'function') showToast('Comment added', 'success');

      // Persist drawing data locally — no thumbnail (too large, risks QuotaExceededError)
      try {
        localStorage.setItem('annot_' + newComment.id, JSON.stringify({ strokes, textBoxes }));
      } catch (e) { /* localStorage full — drawing data not cached locally, no big deal */ }

      // Save drawing data to server in background so share users can see it.
      // Strokes/textBox coords stored as 0-100 percent; server expects 0-1 normalized.
      if (strokes.length > 0) {
        const normalizedStrokes = strokes.map(s => ({
          points: s.points.map(p => ({ x: p.x / 100, y: p.y / 100 }))
        }));
        fetch(`/api/videos/${this.videoId}/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: this.currentTimestamp,
            type: 'draw',
            data: { strokes: normalizedStrokes },
            color: '#FF3B30'
          })
        }).then(async r => {
          if (r.ok) {
            const { annotation } = await r.json();
            if (annotation) {
              document.dispatchEvent(new CustomEvent('feedo:annotationSaved', { detail: annotation }));
            }
          }
        }).catch(() => {});
      }
      for (const tb of textBoxes) {
        fetch(`/api/videos/${this.videoId}/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: this.currentTimestamp,
            type: 'text',
            data: { text: tb.text, x: tb.x / 100, y: tb.y / 100 },
            color: '#ffffff'
          })
        }).then(async r => {
          if (r.ok) {
            const { annotation } = await r.json();
            if (annotation) {
              document.dispatchEvent(new CustomEvent('feedo:annotationSaved', { detail: annotation }));
            }
          }
        }).catch(() => {});
      }

    } catch (e) {
      console.error('Annotation comment network error', e);
      if (typeof showToast === 'function') showToast('Network error — comment not saved', 'error');
      this._cancel();
    }
  }

  _cancel() {
    if (this._replayTimer) { clearTimeout(this._replayTimer); this._replayTimer = null; }
    this.toolbar.hide();
    this.composer.hide();
    this.canvas.clearAll();
    this.canvas.setTool(null);
    this.stage = 'idle';
  }

  _onCommentClick(annotation) {
    if (this._replayTimer) { clearTimeout(this._replayTimer); this._replayTimer = null; }

    // Suppress any pause event the currentTime seek might fire so _startAnnotating
    // doesn't clear the canvas before (or after) loadAnnotation runs.
    this._suppressPause = true;
    this.stage = 'idle'; // RAF loop controls visibility based on currentTime
    this.videoEl.currentTime = annotation.timestamp;

    this.toolbar.hide();
    this.composer.hide();
    this.canvas.loadAnnotation(annotation);
    this.canvas.setTool(null); // display-only

    // Pin this annotation as "active" so the RAF loop shows it persistently
    this.setActiveAnnotation(annotation.id, annotation.timestamp);
  }
}
