/* annotation-comment.js — renders an annotation comment styled like a regular comment card */

// Same palette as the main comment system
const _annotColorPalette = ['#f59e0b','#10b981','#8b5cf6','#ef4444','#f97316','#06b6d4','#ec4899','#84cc16','#a78bfa','#fb923c'];
const _annotColorMap = new Map();

function _getAnnotAuthorColor(author) {
  if (!_annotColorMap.has(author)) {
    _annotColorMap.set(author, _annotColorPalette[_annotColorMap.size % _annotColorPalette.length]);
  }
  return _annotColorMap.get(author);
}

function createCommentItem(annotation, onClick) {
  const author = annotation.authorId || 'user';
  const pillColor = _getAnnotAuthorColor(author);
  const displayAuthor = author === 'user'
    ? (localStorage.getItem('feedo_display_name') || 'You')
    : author;

  const card = document.createElement('div');
  card.className = 'comment-card';
  card.style.cursor = 'pointer';

  card.innerHTML = `
    <div class="comment-main-row">
      <div class="comment-body" style="width:100%;">
        <div class="comment-header">
          <span class="timestamp-pill" style="background:${pillColor}22; border-color:${pillColor}44; color:${pillColor};">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
            ${formatTimestamp(annotation.timestamp)}
          </span>
          <span class="comment-author-label">${escapeHtml(displayAuthor)}</span>
          <span style="font-size:11px; color:var(--text-secondary); margin-left:auto; padding-right:4px;">🎨 Drawing</span>
        </div>

        ${annotation.thumbnailDataUrl ? `
          <div style="margin:6px 0;">
            <img src="${annotation.thumbnailDataUrl}"
              style="width:100%; max-height:90px; object-fit:cover; border-radius:6px; display:block; border:1px solid var(--border);"
              alt="annotation preview" />
          </div>
        ` : ''}

        <div class="comment-text">${escapeHtml(annotation.commentText)}</div>
        <div class="comment-date">just now</div>
      </div>
    </div>
  `;

  card.addEventListener('click', () => onClick(annotation));

  return card;
}
