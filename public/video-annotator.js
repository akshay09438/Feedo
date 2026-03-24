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

    const wrapper = videoEl.parentElement; // .video-wrapper

    // ── Instantiate components ─────────────────────────────────────────────
    this.canvas  = new AnnotationCanvas(videoEl);
    this.toolbar = new AnnotationToolbar(wrapper);

    // Composer goes right after the video wrapper in the DOM
    const composerWrap = document.createElement('div');
    composerWrap.style.padding = '0 4px';
    wrapper.insertAdjacentElement('afterend', composerWrap);
    this.composer = new AnnotationComposer(composerWrap);

    // ── Load + render saved annotation comments ────────────────────────────
    this.annotations = loadAnnotations(videoId);
    this.annotations.forEach(ann => {
      this.commentListEl.appendChild(
        createCommentItem(ann, a => this._onCommentClick(a))
      );
    });

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
    this.canvas.clearAll();
    this.canvas.setTool('draw');
    this.toolbar.setActiveTool('draw');
    this.toolbar.setPostEnabled(false);
    this.toolbar.show();
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
    this.stage = 'composing';
    this.toolbar.hide();
    this.canvas.setTool(null);
    const thumbnail = this.canvas.getSnapshot();
    this.composer.show(thumbnail, this.currentTimestamp);
  }

  async _onCommentSubmit(commentText) {
    const author = localStorage.getItem('feedo_display_name') || 'Admin';
    const strokes    = [...this.canvas.strokes];
    const textBoxes  = [...this.canvas.textBoxes];
    const thumbnail  = this.canvas.getSnapshot();

    this.composer.hide();
    this.canvas.clearAll();
    this.stage = 'idle';

    // Show annotation immediately (before server responds) so the user
    // sees their drawing stay on screen. Cleared after 4 s or on play.
    this.canvas.loadAnnotation({ strokes, textBoxes });
    this.canvas.setTool(null);
    if (this._replayTimer) clearTimeout(this._replayTimer);
    this._replayTimer = setTimeout(() => {
      this.canvas.clearAll();
      this._replayTimer = null;
    }, 4000);

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
        console.error('Annotation comment post failed', res.status);
        return;
      }

      const newComment = await res.json();
      newComment.attachments = [];

      // Save the visual drawing data locally, keyed by server comment ID
      localStorage.setItem('annot_' + newComment.id, JSON.stringify({
        strokes,
        textBoxes,
        thumbnailDataUrl: thumbnail
      }));

      // Save drawing data to server so share users can see it on canvas.
      // Strokes/textBox coords are stored as 0-100 percent; server expects 0-1 normalized.
      if (strokes.length > 0) {
        const normalizedStrokes = strokes.map(s => ({
          points: s.points.map(p => ({ x: p.x / 100, y: p.y / 100 }))
        }));
        await fetch(`/api/videos/${this.videoId}/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: this.currentTimestamp,
            type: 'draw',
            data: { strokes: normalizedStrokes },
            color: '#FF3B30'
          })
        }).catch(() => {});
      }
      for (const tb of textBoxes) {
        await fetch(`/api/videos/${this.videoId}/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: this.currentTimestamp,
            type: 'text',
            data: { text: tb.text, x: tb.x / 100, y: tb.y / 100 },
            color: '#ffffff'
          })
        }).catch(() => {});
      }

      // Push into the existing comment system (edit/delete/reply all work)
      if (window._feedo) window._feedo.addComment(newComment);

    } catch (e) {
      console.error('Annotation comment network error', e);
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

    this.stage = 'idle';
    this.videoEl.currentTime = annotation.timestamp;

    this.toolbar.hide();
    this.composer.hide();
    this.canvas.loadAnnotation(annotation);
    this.canvas.setTool(null); // display-only

    // Clear overlay after 4 s (or immediately on play via _cancel)
    this._replayTimer = setTimeout(() => {
      this.canvas.clearAll();
      this._replayTimer = null;
    }, 4000);
  }
}
