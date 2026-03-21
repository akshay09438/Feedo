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

  _onCommentSubmit(commentText) {
    const author = localStorage.getItem('feedo_display_name') || 'user';
    const ann = createAnnotation(
      generateId(),
      this.videoId,
      this.currentTimestamp,
      [...this.canvas.strokes],
      [...this.canvas.textBoxes],
      this.canvas.getSnapshot(),
      commentText,
      author
    );

    this.annotations.push(ann);
    saveAnnotations(this.videoId, this.annotations);

    // Prepend to list
    const item = createCommentItem(ann, a => this._onCommentClick(a));
    this.commentListEl.insertBefore(item, this.commentListEl.firstChild);

    this.composer.hide();
    this.canvas.clearAll();
    this.stage = 'idle';
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

    // Suppress the pause event that seekTo+pause will fire
    this._suppressPause = true;
    this.stage = 'idle';

    this.videoEl.currentTime = annotation.timestamp;
    this.videoEl.pause();

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
