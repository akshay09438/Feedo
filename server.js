'use strict';

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Credentials
const CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'banana'
};

// ── Directories ───────────────────────────────────────────────────────────────
const ROOT = process.env.UPLOADS_DIR ? path.dirname(process.env.UPLOADS_DIR) : __dirname;
const UPLOADS_BASE = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const VIDEOS_DIR = path.join(UPLOADS_BASE, 'videos');
const ATTACHMENTS_DIR = path.join(UPLOADS_BASE, 'attachments');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

[VIDEOS_DIR, ATTACHMENTS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Database (sql.js — pure WASM, no native build required) ──────────────────
let db;

// Debounced write — batches rapid successive writes into one disk flush
let _saveTimer = null;
function saveDb() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch(e) { console.error('saveDb error:', e); }
  }, 300);
}
// Immediate flush used on process exit
function saveDbNow() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch(e) { console.error('saveDbNow error:', e); }
}
process.on('SIGTERM', () => { saveDbNow(); process.exit(0); });
process.on('SIGINT',  () => { saveDbNow(); process.exit(0); });

function runDb(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function getDb(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

function allDb(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function insertDb(sql, params = []) {
  db.run(sql, params);
  const row = getDb('SELECT last_insert_rowid() AS id');
  saveDb();
  return row ? row.id : null;
}

async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'video/mp4',
      share_token TEXT UNIQUE NOT NULL,
      allow_comments INTEGER NOT NULL DEFAULT 1,
      version_group_id TEXT,
      version_number INTEGER NOT NULL DEFAULT 1,
      version_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add version columns to existing videos table if they don't exist
  try { db.run(`ALTER TABLE videos ADD COLUMN version_group_id TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE videos ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1`); } catch(e) {}
  try { db.run(`ALTER TABLE videos ADD COLUMN version_name TEXT`); } catch(e) {}
  // Add view_token for separate view-only share links
  try { db.run(`ALTER TABLE videos ADD COLUMN view_token TEXT`); } catch(e) {}
  // Backfill view_token for existing videos
  (() => {
    const missing = allDb('SELECT id FROM videos WHERE view_token IS NULL');
    for (const v of missing) {
      runDb('UPDATE videos SET view_token = ? WHERE id = ?', [uuidv4(), v.id]);
    }
  })();

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      timestamp REAL NOT NULL,
      text TEXT NOT NULL,
      author TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add author and resolved columns to existing comments table if they don't exist
  try { db.run(`ALTER TABLE comments ADD COLUMN author TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE comments ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE`); } catch(e) {}
  try { db.run(`ALTER TABLE comments ADD COLUMN guest_id TEXT`); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      timestamp REAL NOT NULL,
      type TEXT NOT NULL DEFAULT 'draw',
      data TEXT NOT NULL,
      author TEXT,
      color TEXT NOT NULL DEFAULT '#ef4444',
      comment_id INTEGER REFERENCES comments(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      actor TEXT NOT NULL DEFAULT 'admin',
      action TEXT NOT NULL,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDb();
}

// ── Helper: log history ───────────────────────────────────────────────────────
function logHistory(videoId, projectId, actor, action, detail) {
  try {
    insertDb(
      'INSERT INTO history (video_id, project_id, actor, action, detail) VALUES (?, ?, ?, ?, ?)',
      [videoId || null, projectId || null, actor || 'admin', action, detail || null]
    );
  } catch(e) {
    // non-critical
  }
}

// ── Multer ────────────────────────────────────────────────────────────────────
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEOS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ATTACHMENTS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }
});

const uploadAttachments = multer({
  storage: attachmentStorage,
  limits: { fileSize: 500 * 1024 * 1024, files: 20 }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'feedo-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(ROOT, 'public'), {
  index: false,
  extensions: []
}));

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Helper: stream file with HTTP range support ───────────────────────────────
function streamFile(req, res, filePath, mimeType) {
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Incorrect username or password' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

app.post('/api/auth/name', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  req.session.displayName = name.trim();
  res.json({ ok: true, name: req.session.displayName });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    name: req.session.displayName || null,
    email: null
  });
});

// ── Project routes ────────────────────────────────────────────────────────────
app.get('/api/projects', requireAuth, (req, res) => {
  try {
    const projects = allDb(`
      SELECT p.id, p.name, p.created_at,
             COUNT(v.id) AS video_count
      FROM projects p
      LEFT JOIN videos v ON v.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(projects);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

  try {
    const id = insertDb('INSERT INTO projects (name) VALUES (?)', [name.trim()]);
    const project = getDb('SELECT p.id, p.name, p.created_at, 0 AS video_count FROM projects p WHERE p.id = ?', [id]);
    logHistory(null, id, 'admin', 'project_created', `Project "${name.trim()}" created`);
    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const project = getDb('SELECT p.id, p.name, p.created_at FROM projects p WHERE p.id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const videos = allDb(`
    SELECT v.id, v.project_id, v.name, v.filename, v.original_name, v.mime_type,
           v.share_token, v.view_token, v.allow_comments, v.version_group_id, v.version_number, v.version_name,
           v.created_at, COUNT(c.id) AS comment_count
    FROM videos v
    LEFT JOIN comments c ON c.video_id = v.id
    WHERE v.project_id = ?
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `, [req.params.id]);

  res.json({ ...project, videos });
});

app.patch('/api/projects/:id', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

  const project = getDb('SELECT id FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    runDb('UPDATE projects SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    const updated = getDb('SELECT p.id, p.name, p.created_at FROM projects p WHERE p.id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const project = getDb('SELECT id FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    runDb('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// ── Project history ───────────────────────────────────────────────────────────
app.get('/api/projects/:id/history', requireAuth, (req, res) => {
  const project = getDb('SELECT id FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const rows = allDb(
      'SELECT * FROM history WHERE project_id = ? ORDER BY created_at DESC LIMIT 200',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// ── Video routes ──────────────────────────────────────────────────────────────

app.get('/api/videos', requireAuth, (req, res) => {
  try {
    let sql, params;
    if (req.query.project_id !== undefined) {
      if (req.query.project_id === 'null' || req.query.project_id === '') {
        sql = `
          SELECT v.id, v.project_id, v.name, v.filename, v.original_name, v.mime_type,
                 v.share_token, v.view_token, v.allow_comments, v.version_group_id, v.version_number, v.version_name,
                 v.created_at, COUNT(c.id) AS comment_count, NULL AS project_name
          FROM videos v
          LEFT JOIN comments c ON c.video_id = v.id
          WHERE v.project_id IS NULL
          GROUP BY v.id
          ORDER BY v.created_at DESC
        `;
        params = [];
      } else {
        sql = `
          SELECT v.id, v.project_id, v.name, v.filename, v.original_name, v.mime_type,
                 v.share_token, v.view_token, v.allow_comments, v.version_group_id, v.version_number, v.version_name,
                 v.created_at, COUNT(c.id) AS comment_count, p.name AS project_name
          FROM videos v
          LEFT JOIN comments c ON c.video_id = v.id
          LEFT JOIN projects p ON p.id = v.project_id
          WHERE v.project_id = ?
          GROUP BY v.id
          ORDER BY v.created_at DESC
        `;
        params = [req.query.project_id];
      }
    } else {
      sql = `
        SELECT v.id, v.project_id, v.name, v.filename, v.original_name, v.mime_type,
               v.share_token, v.view_token, v.allow_comments, v.version_group_id, v.version_number, v.version_name,
               v.created_at, COUNT(c.id) AS comment_count, p.name AS project_name
        FROM videos v
        LEFT JOIN comments c ON c.video_id = v.id
        LEFT JOIN projects p ON p.id = v.project_id
        GROUP BY v.id
        ORDER BY v.created_at DESC
      `;
      params = [];
    }
    const videos = allDb(sql, params);
    res.json(videos);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.post('/api/videos', requireAuth, (req, res) => {
  uploadVideo.single('video')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

    const name = (req.body.name && req.body.name.trim()) || req.file.originalname.replace(/\.[^.]+$/, '');
    const shareToken = uuidv4();
    const viewToken = uuidv4();
    const projectId = (req.body.project_id && req.body.project_id !== '' && req.body.project_id !== 'null')
      ? req.body.project_id
      : null;
    const versionGroupId = uuidv4();

    try {
      const id = insertDb(
        `INSERT INTO videos (project_id, name, filename, original_name, mime_type, share_token, view_token, version_group_id, version_number, version_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, name, req.file.filename, req.file.originalname, req.file.mimetype || 'video/mp4', shareToken, viewToken, versionGroupId, 1, 'V1']
      );
      const video = getDb(`
        SELECT v.*, 0 AS comment_count, p.name AS project_name
        FROM videos v
        LEFT JOIN projects p ON p.id = v.project_id
        WHERE v.id = ?
      `, [id]);
      logHistory(id, projectId, 'admin', 'video_uploaded', `Video "${name}" uploaded as V1`);
      res.status(201).json(video);
    } catch (e) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
});

app.post('/api/projects/:id/videos', requireAuth, (req, res) => {
  const project = getDb('SELECT id FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  uploadVideo.single('video')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

    const name = (req.body.name && req.body.name.trim()) || req.file.originalname.replace(/\.[^.]+$/, '');
    const shareToken = uuidv4();
    const viewToken = uuidv4();
    const versionGroupId = uuidv4();

    try {
      const id = insertDb(
        `INSERT INTO videos (project_id, name, filename, original_name, mime_type, share_token, view_token, version_group_id, version_number, version_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.params.id, name, req.file.filename, req.file.originalname, req.file.mimetype || 'video/mp4', shareToken, viewToken, versionGroupId, 1, 'V1']
      );
      const video = getDb('SELECT *, 0 AS comment_count FROM videos WHERE id = ?', [id]);
      logHistory(id, req.params.id, 'admin', 'video_uploaded', `Video "${name}" uploaded to project`);
      res.status(201).json(video);
    } catch (e) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
});

app.get('/api/videos/:id', requireAuth, (req, res) => {
  const video = getDb(`
    SELECT v.*, COUNT(c.id) AS comment_count, p.name AS project_name
    FROM videos v
    LEFT JOIN comments c ON c.video_id = v.id
    LEFT JOIN projects p ON p.id = v.project_id
    WHERE v.id = ?
    GROUP BY v.id
  `, [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json(video);
});

app.patch('/api/videos/:id', requireAuth, (req, res) => {
  const video = getDb('SELECT id FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const updates = [];
  const params = [];

  if (req.body.name !== undefined) {
    updates.push('name = ?');
    params.push(req.body.name.trim());
  }
  if (req.body.allow_comments !== undefined) {
    updates.push('allow_comments = ?');
    params.push(req.body.allow_comments ? 1 : 0);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);

  try {
    runDb(`UPDATE videos SET ${updates.join(', ')} WHERE id = ?`, params);
    const updated = getDb('SELECT * FROM videos WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.delete('/api/videos/:id', requireAuth, (req, res) => {
  const video = getDb('SELECT * FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  try {
    const videoComments = allDb('SELECT id FROM comments WHERE video_id = ?', [req.params.id]);
    for (const comment of videoComments) {
      const attachments = allDb('SELECT filename FROM attachments WHERE comment_id = ?', [comment.id]);
      for (const att of attachments) {
        const attPath = path.join(ATTACHMENTS_DIR, att.filename);
        if (fs.existsSync(attPath)) fs.unlinkSync(attPath);
      }
    }

    const videoPath = path.join(VIDEOS_DIR, video.filename);
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    runDb('DELETE FROM videos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.get('/api/videos/:id/stream', requireAuth, (req, res) => {
  const video = getDb('SELECT * FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  streamFile(req, res, path.join(VIDEOS_DIR, video.filename), video.mime_type);
});

app.get('/api/videos/:id/comments', requireAuth, (req, res) => {
  const video = getDb('SELECT id FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const comments = allDb(
    'SELECT * FROM comments WHERE video_id = ? ORDER BY timestamp ASC',
    [req.params.id]
  );

  const result = comments.map(c => ({
    ...c,
    attachments: allDb('SELECT * FROM attachments WHERE comment_id = ? ORDER BY created_at ASC', [c.id])
  }));

  res.json(result);
});

app.post('/api/videos/:id/comments', requireAuth, (req, res) => {
  uploadAttachments.single('attachment')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    _handleVideoComment(req, res);
  });
});

function _handleVideoComment(req, res) {
  const video = getDb('SELECT id FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const { timestamp, text, display_name, parent_id } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    let ts;
    if (parent_id) {
      const parent = getDb('SELECT timestamp FROM comments WHERE id = ? AND video_id = ?', [parent_id, req.params.id]);
      if (!parent) return res.status(404).json({ error: 'Parent comment not found' });
      ts = parent.timestamp;
    } else {
      if (timestamp === undefined || timestamp === null) return res.status(400).json({ error: 'timestamp required' });
      ts = parseFloat(timestamp);
    }

    const author = (display_name && display_name.trim()) ? display_name.trim() : 'admin';
    const id = insertDb(
      'INSERT INTO comments (video_id, timestamp, text, author, parent_id) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, ts, text.trim(), author, parent_id || null]
    );
    const comment = getDb('SELECT * FROM comments WHERE id = ?', [id]);
    logHistory(req.params.id, null, author, parent_id ? 'reply_added' : 'comment_added', `Comment at ${ts.toFixed(1)}s`);

    // Handle single attachment (for annotation tool)
    if (req.file) {
      insertDb(
        'INSERT INTO attachments (comment_id, filename, original_name, mime_type) VALUES (?, ?, ?, ?)',
        [id, req.file.filename, req.file.originalname, req.file.mimetype || 'image/png']
      );
      const attachments = allDb('SELECT * FROM attachments WHERE comment_id = ? ORDER BY created_at ASC', [id]);
      return res.status(201).json({ ...comment, attachments });
    }

    res.status(201).json({ ...comment, attachments: [] });
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
}

// ── Annotations ───────────────────────────────────────────────────────────────
app.get('/api/videos/:id/annotations', requireAuth, (req, res) => {
  const video = getDb('SELECT id FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  try {
    const rows = allDb('SELECT * FROM annotations WHERE video_id = ? ORDER BY timestamp ASC', [req.params.id]);
    res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/videos/:id/annotations', requireAuth, (req, res) => {
  const video = getDb('SELECT id FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const { timestamp, type, data, author, color } = req.body;
  if (timestamp === undefined || !data) return res.status(400).json({ error: 'timestamp and data required' });

  try {
    const safeAuthor = (author && author.trim()) ? author.trim() : 'admin';
    const safeColor = color || '#ef4444';
    const safeType = type || 'draw';

    const annotId = insertDb(
      'INSERT INTO annotations (video_id, timestamp, type, data, author, color) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, parseFloat(timestamp), safeType, JSON.stringify(data), safeAuthor, safeColor]
    );

    const annot = getDb('SELECT * FROM annotations WHERE id = ?', [annotId]);
    res.status(201).json({ annotation: { ...annot, data: JSON.parse(annot.data) } });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/annotations/:id', requireAuth, (req, res) => {
  const annot = getDb('SELECT * FROM annotations WHERE id = ?', [req.params.id]);
  if (!annot) return res.status(404).json({ error: 'Annotation not found' });
  try {
    runDb('DELETE FROM annotations WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Video versions ────────────────────────────────────────────────────────────
app.get('/api/videos/:id/versions', requireAuth, (req, res) => {
  const video = getDb('SELECT * FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  try {
    let versions;
    if (video.version_group_id) {
      versions = allDb(
        'SELECT * FROM videos WHERE version_group_id = ? ORDER BY version_number ASC',
        [video.version_group_id]
      );
    } else {
      versions = [video];
    }
    res.json(versions);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.post('/api/videos/:id/versions', requireAuth, (req, res) => {
  const parentVideo = getDb('SELECT * FROM videos WHERE id = ?', [req.params.id]);
  if (!parentVideo) return res.status(404).json({ error: 'Video not found' });

  uploadVideo.single('video')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

    try {
      // Get the current max version number in this group
      const versionGroupId = parentVideo.version_group_id || uuidv4();

      // If parent has no version_group_id yet, assign one to it
      if (!parentVideo.version_group_id) {
        runDb('UPDATE videos SET version_group_id = ?, version_number = 1, version_name = ? WHERE id = ?',
          [versionGroupId, 'V1', parentVideo.id]);
      }

      const maxRow = getDb(
        'SELECT MAX(version_number) AS max_ver FROM videos WHERE version_group_id = ?',
        [versionGroupId]
      );
      const newVersionNumber = (maxRow && maxRow.max_ver ? maxRow.max_ver : 1) + 1;
      const newVersionName = `V${newVersionNumber}`;

      const name = (req.body.name && req.body.name.trim()) || parentVideo.name;
      const shareToken = uuidv4();
      const viewToken = uuidv4();

      const id = insertDb(
        `INSERT INTO videos (project_id, name, filename, original_name, mime_type, share_token, view_token, version_group_id, version_number, version_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [parentVideo.project_id, name, req.file.filename, req.file.originalname, req.file.mimetype || 'video/mp4', shareToken, viewToken, versionGroupId, newVersionNumber, newVersionName]
      );

      const newVideo = getDb('SELECT * FROM videos WHERE id = ?', [id]);
      logHistory(id, parentVideo.project_id, 'admin', 'version_created', `${newVersionName} created for "${name}"`);
      res.status(201).json(newVideo);
    } catch (e) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
});

app.patch('/api/versions/:id/name', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

  const video = getDb('SELECT * FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Version not found' });

  try {
    runDb('UPDATE videos SET version_name = ? WHERE id = ?', [name.trim(), req.params.id]);
    const updated = getDb('SELECT * FROM videos WHERE id = ?', [req.params.id]);
    logHistory(req.params.id, video.project_id, 'admin', 'version_renamed', `Version renamed to "${name.trim()}"`);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// ── Video history ─────────────────────────────────────────────────────────────
app.get('/api/videos/:id/history', requireAuth, (req, res) => {
  const video = getDb('SELECT * FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  try {
    // Get history for all videos in same version group
    let rows;
    if (video.version_group_id) {
      const vids = allDb('SELECT id FROM videos WHERE version_group_id = ?', [video.version_group_id]);
      const vidIds = vids.map(v => v.id);
      if (vidIds.length > 0) {
        const placeholders = vidIds.map(() => '?').join(',');
        rows = allDb(
          `SELECT * FROM history WHERE video_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 200`,
          vidIds
        );
      } else {
        rows = [];
      }
    } else {
      rows = allDb(
        'SELECT * FROM history WHERE video_id = ? ORDER BY created_at DESC LIMIT 200',
        [req.params.id]
      );
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// ── Comment routes ────────────────────────────────────────────────────────────
app.put('/api/comments/:id', requireAuth, (req, res) => {
  const comment = getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  // Only admin (logged-in user) can edit
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    runDb('UPDATE comments SET text = ? WHERE id = ?', [text.trim(), req.params.id]);
    const updated = getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  // Delete child replies and their attachments first
  const childIds = allDb('SELECT id FROM comments WHERE parent_id = ?', [req.params.id]).map(r => r.id);
  for (const childId of childIds) {
    const childAtts = allDb('SELECT filename FROM attachments WHERE comment_id = ?', [childId]);
    for (const att of childAtts) {
      const attPath = path.join(ATTACHMENTS_DIR, att.filename);
      if (fs.existsSync(attPath)) fs.unlinkSync(attPath);
    }
    runDb('DELETE FROM attachments WHERE comment_id = ?', [childId]);
  }
  if (childIds.length > 0) runDb('DELETE FROM comments WHERE parent_id = ?', [req.params.id]);

  const attachments = allDb('SELECT filename FROM attachments WHERE comment_id = ?', [req.params.id]);
  for (const att of attachments) {
    const attPath = path.join(ATTACHMENTS_DIR, att.filename);
    if (fs.existsSync(attPath)) fs.unlinkSync(attPath);
  }

  runDb('DELETE FROM attachments WHERE comment_id = ?', [req.params.id]);
  runDb('DELETE FROM comments WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.patch('/api/comments/:id/resolve', requireAuth, (req, res) => {
  const comment = getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  try {
    const newResolved = comment.resolved ? 0 : 1;
    runDb('UPDATE comments SET resolved = ? WHERE id = ?', [newResolved, req.params.id]);
    const updated = getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// ── Attachment routes ─────────────────────────────────────────────────────────
app.post('/api/comments/:id/attachments', requireAuth, (req, res) => {
  const comment = getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  uploadAttachments.array('files', 20)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    try {
      const inserted = [];
      for (const file of req.files) {
        const id = insertDb(
          'INSERT INTO attachments (comment_id, filename, original_name, mime_type) VALUES (?, ?, ?, ?)',
          [req.params.id, file.filename, file.originalname, file.mimetype || 'application/octet-stream']
        );
        inserted.push(getDb('SELECT * FROM attachments WHERE id = ?', [id]));
      }
      res.status(201).json(inserted);
    } catch (e) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
});

app.get('/api/attachments/:filename', requireAuth, (req, res) => {
  const att = getDb('SELECT * FROM attachments WHERE filename = ?', [req.params.filename]);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  streamFile(req, res, path.join(ATTACHMENTS_DIR, att.filename), att.mime_type);
});

// ── Share routes (public) ─────────────────────────────────────────────────────
// Helper: resolve a token to a video + permission level
function resolveShareToken(token) {
  let video = getDb('SELECT * FROM videos WHERE share_token = ?', [token]);
  if (video) return { video, allowComments: true };
  video = getDb('SELECT * FROM videos WHERE view_token = ?', [token]);
  if (video) return { video, allowComments: false };
  return null;
}

app.get('/api/share/:token', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video, allowComments } = resolved;

  const project = video.project_id
    ? getDb('SELECT id, name FROM projects WHERE id = ?', [video.project_id])
    : null;

  const comments = allDb(
    'SELECT * FROM comments WHERE video_id = ? ORDER BY timestamp ASC',
    [video.id]
  );

  const commentsWithAttachments = comments.map(c => ({
    ...c,
    attachments: allDb('SELECT * FROM attachments WHERE comment_id = ? ORDER BY created_at ASC', [c.id])
  }));

  // Get versions in same group
  let versions = [];
  if (video.version_group_id) {
    versions = allDb(
      'SELECT id, version_number, version_name, share_token, view_token FROM videos WHERE version_group_id = ? ORDER BY version_number ASC',
      [video.version_group_id]
    );
  }

  res.json({ video, project, comments: commentsWithAttachments, allow_comments: allowComments, versions });
});

app.post('/api/share/:token/comments', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video, allowComments } = resolved;
  if (!allowComments) return res.status(403).json({ error: 'Comments are disabled for this video' });

  const { timestamp, text, guest_id, display_name, parent_id } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    let ts;
    if (parent_id) {
      const parent = getDb('SELECT timestamp FROM comments WHERE id = ? AND video_id = ?', [parent_id, video.id]);
      if (!parent) return res.status(404).json({ error: 'Parent comment not found' });
      ts = parent.timestamp;
    } else {
      if (timestamp === undefined || timestamp === null) return res.status(400).json({ error: 'timestamp required' });
      ts = parseFloat(timestamp);
    }
    const author = (display_name && display_name.trim()) ? display_name.trim() : (guest_id ? `guest:${guest_id}` : 'guest');
    const id = insertDb(
      'INSERT INTO comments (video_id, timestamp, text, author, guest_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
      [video.id, ts, text.trim(), author, guest_id || null, parent_id || null]
    );
    const comment = getDb('SELECT * FROM comments WHERE id = ?', [id]);
    res.status(201).json({ ...comment, attachments: [] });
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.put('/api/share/:token/comments/:id', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video, allowComments } = resolved;
  if (!allowComments) return res.status(403).json({ error: 'Edit not allowed' });

  const comment = getDb('SELECT * FROM comments WHERE id = ? AND video_id = ?', [req.params.id, video.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const { text, guest_id, display_name } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  if (!guest_id) return res.status(403).json({ error: 'No guest identity' });

  // Author may be stored as "guest:<id>" (legacy) or as display_name (current behaviour)
  const legacyAuthor = `guest:${guest_id}`;
  const authorMatch  = (guest_id && comment.guest_id === guest_id) || comment.author === legacyAuthor;
  if (!authorMatch) return res.status(403).json({ error: 'Cannot edit this comment' });

  try {
    runDb('UPDATE comments SET text = ? WHERE id = ?', [text.trim(), req.params.id]);
    res.json(getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]));
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.delete('/api/share/:token/comments/:id', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video, allowComments } = resolved;
  if (!allowComments) return res.status(403).json({ error: 'Edit not allowed' });

  const comment = getDb('SELECT * FROM comments WHERE id = ? AND video_id = ?', [req.params.id, video.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const { guest_id } = req.query;
  if (!guest_id) return res.status(403).json({ error: 'No guest identity' });

  const legacyAuthor = `guest:${guest_id}`;
  const authorMatch  = (guest_id && comment.guest_id === guest_id) || comment.author === legacyAuthor;
  if (!authorMatch) return res.status(403).json({ error: 'Cannot delete this comment' });

  try {
    // Cascade-delete any replies (SQLite ALTER TABLE FKs are not enforced)
    runDb('DELETE FROM comments WHERE parent_id = ?', [req.params.id]);
    runDb('DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.patch('/api/share/:token/comments/:id/resolve', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video, allowComments } = resolved;
  if (!allowComments) return res.status(403).json({ error: 'Edit not allowed' });

  const comment = getDb('SELECT * FROM comments WHERE id = ? AND video_id = ?', [req.params.id, video.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  try {
    const newResolved = comment.resolved ? 0 : 1;
    runDb('UPDATE comments SET resolved = ? WHERE id = ?', [newResolved, req.params.id]);
    res.json(getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]));
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.get('/api/share/:token/annotations', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  try {
    const rows = allDb('SELECT * FROM annotations WHERE video_id = ? ORDER BY timestamp ASC', [resolved.video.id]);
    res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/share/:token/annotations', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video, allowComments } = resolved;
  if (!allowComments) return res.status(403).json({ error: 'Annotations not allowed' });
  const { timestamp, type, data, author, color } = req.body;
  if (timestamp === undefined || !data) return res.status(400).json({ error: 'timestamp and data required' });
  try {
    const safeAuthor = (author && author.trim()) ? author.trim() : 'guest';
    const safeColor = color || '#ef4444';
    const safeType = type || 'draw';
    const annotId = insertDb(
      'INSERT INTO annotations (video_id, timestamp, type, data, author, color) VALUES (?, ?, ?, ?, ?, ?)',
      [video.id, parseFloat(timestamp), safeType, JSON.stringify(data), safeAuthor, safeColor]
    );
    const annot = getDb('SELECT * FROM annotations WHERE id = ?', [annotId]);
    res.status(201).json({ annotation: { ...annot, data: JSON.parse(annot.data) } });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/share/:token/comments/:id/attachments', uploadAttachments.array('files', 10), (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video, allowComments } = resolved;
  if (!allowComments) return res.status(403).json({ error: 'Comments not allowed' });
  const comment = getDb('SELECT * FROM comments WHERE id = ? AND video_id = ?', [req.params.id, video.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  try {
    const inserted = [];
    for (const file of req.files) {
      const filename = file.filename;
      const id = insertDb(
        'INSERT INTO attachments (comment_id, filename, original_name, mime_type) VALUES (?, ?, ?, ?)',
        [comment.id, filename, file.originalname, file.mimetype || 'application/octet-stream']
      );
      inserted.push(getDb('SELECT * FROM attachments WHERE id = ?', [id]));
    }
    res.status(201).json(inserted);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/share/:token/stream', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video } = resolved;
  res.setHeader('Cache-Control', 'private, max-age=3600');
  streamFile(req, res, path.join(VIDEOS_DIR, video.filename), video.mime_type);
});

app.get('/api/share/:token/attachments/:filename', (req, res) => {
  const resolved = resolveShareToken(req.params.token);
  if (!resolved) return res.status(404).json({ error: 'Share link not found' });
  const { video } = resolved;

  const att = getDb('SELECT * FROM attachments WHERE filename = ?', [req.params.filename]);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  const comment = getDb('SELECT * FROM comments WHERE id = ? AND video_id = ?', [att.comment_id, video.id]);
  if (!comment) return res.status(403).json({ error: 'Forbidden' });

  streamFile(req, res, path.join(ATTACHMENTS_DIR, att.filename), att.mime_type);
});

// ── HTML page routes ──────────────────────────────────────────────────────────
function requireAuthPage(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(ROOT, 'public', 'login.html'));
});

app.get('/', requireAuthPage, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.get('/project/:id', requireAuthPage, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'project.html'));
});

app.get('/video/:id', requireAuthPage, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'video.html'));
});

app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'share.html'));
});

app.get('/dashboard', (req, res) => res.redirect('/'));

// ── 404 handlers ─────────────────────────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.status(404).sendFile(path.join(ROOT, 'public', 'login.html')));

// ── Boot: init DB then start server ──────────────────────────────────────────
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Feedo running at http://localhost:${PORT}`);
    console.log(`Username: admin  Password: banana`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
