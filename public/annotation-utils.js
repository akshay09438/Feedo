/* annotation-utils.js — shared helpers */

function formatTimestamp(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return m + ':' + s;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}
