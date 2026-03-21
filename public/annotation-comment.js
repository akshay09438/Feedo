/* annotation-comment.js — renders a single annotation comment list item */

function createCommentItem(annotation, onClick) {
  const item = document.createElement('div');
  Object.assign(item.style, {
    display:      'flex',
    gap:          '12px',
    padding:      '12px',
    borderRadius: '8px',
    cursor:       'pointer',
    transition:   'background 0.15s',
  });

  item.addEventListener('mouseenter', () => { item.style.background = '#f9fafb'; });
  item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });

  // Thumbnail
  const img = document.createElement('img');
  img.src = annotation.thumbnailDataUrl;
  Object.assign(img.style, {
    width:       '80px',
    height:      '52px',
    borderRadius:'6px',
    objectFit:   'cover',
    flexShrink:  '0',
    background:  '#f3f4f6',
  });

  // Right column: timestamp + comment text
  const right = document.createElement('div');
  Object.assign(right.style, {
    display:       'flex',
    flexDirection: 'column',
    gap:           '4px',
    minWidth:      '0',
  });

  const ts = document.createElement('span');
  ts.textContent = formatTimestamp(annotation.timestamp);
  Object.assign(ts.style, {
    fontWeight: '700',
    fontSize:   '12px',
    color:      '#FF3B30',
  });

  const text = document.createElement('p');
  text.textContent = annotation.commentText;
  Object.assign(text.style, {
    margin:     '0',
    color:      '#374151',
    fontSize:   '13px',
    lineHeight: '1.4',
    overflow:   'hidden',
    display:    '-webkit-box',
    webkitLineClamp: '2',
    webkitBoxOrient:'vertical',
  });

  right.appendChild(ts);
  right.appendChild(text);

  item.appendChild(img);
  item.appendChild(right);

  item.addEventListener('click', () => onClick(annotation));

  return item;
}
