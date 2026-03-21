/* annotation.js — data model + localStorage helpers */

function createStroke(id, points) {
  return { id, points, color: '#FF3B30', width: 3 };
}

function createTextBox(id, x, y, width, text, fontSize) {
  return { id, x, y, width, text, fontSize };
}

function createAnnotation(id, videoId, timestamp, strokes, textBoxes, thumbnailDataUrl, commentText, authorId) {
  return {
    id,
    videoId,
    timestamp,
    strokes,
    textBoxes,
    thumbnailDataUrl,
    commentText,
    authorId,
    createdAt: new Date().toISOString(),
  };
}

function saveAnnotations(videoId, annotations) {
  try {
    localStorage.setItem('annotations_' + videoId, JSON.stringify(annotations));
  } catch (e) { /* storage full or private mode */ }
}

function loadAnnotations(videoId) {
  try {
    return JSON.parse(localStorage.getItem('annotations_' + videoId)) || [];
  } catch (e) {
    return [];
  }
}
