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

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

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

  // Create tables with new schema (project_id nullable)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      timestamp REAL NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  saveDb();
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
  secret: 'frame-review-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(ROOT, 'public')));

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
           v.share_token, v.allow_comments, v.created_at,
           COUNT(c.id) AS comment_count
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
    // Videos with this project_id will have project_id set to NULL (ON DELETE SET NULL)
    // But we still need to handle the project deletion cleanly
    runDb('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// ── Video routes ──────────────────────────────────────────────────────────────

// GET /api/videos — all videos with optional ?project_id=X filter
app.get('/api/videos', requireAuth, (req, res) => {
  try {
    let sql, params;
    if (req.query.project_id !== undefined) {
      if (req.query.project_id === 'null' || req.query.project_id === '') {
        sql = `
          SELECT v.id, v.project_id, v.name, v.filename, v.original_name, v.mime_type,
                 v.share_token, v.allow_comments, v.created_at,
                 COUNT(c.id) AS comment_count,
                 NULL AS project_name
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
                 v.share_token, v.allow_comments, v.created_at,
                 COUNT(c.id) AS comment_count,
                 p.name AS project_name
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
               v.share_token, v.allow_comments, v.created_at,
               COUNT(c.id) AS comment_count,
               p.name AS project_name
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

// POST /api/videos — standalone video upload (project_id optional)
app.post('/api/videos', requireAuth, (req, res) => {
  uploadVideo.single('video')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

    const name = (req.body.name && req.body.name.trim()) || req.file.originalname.replace(/\.[^.]+$/, '');
    const shareToken = uuidv4();
    const projectId = (req.body.project_id && req.body.project_id !== '' && req.body.project_id !== 'null')
      ? req.body.project_id
      : null;

    try {
      const id = insertDb(
        `INSERT INTO videos (project_id, name, filename, original_name, mime_type, share_token) VALUES (?, ?, ?, ?, ?, ?)`,
        [projectId, name, req.file.filename, req.file.originalname, req.file.mimetype || 'video/mp4', shareToken]
      );
      const video = getDb(`
        SELECT v.*, 0 AS comment_count, p.name AS project_name
        FROM videos v
        LEFT JOIN projects p ON p.id = v.project_id
        WHERE v.id = ?
      `, [id]);
      res.status(201).json(video);
    } catch (e) {
      res.status(500).json({ error: 'Database error: ' + e.message });
    }
  });
});

// POST /api/projects/:id/videos — upload to specific project
app.post('/api/projects/:id/videos', requireAuth, (req, res) => {
  const project = getDb('SELECT id FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  uploadVideo.single('video')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

    const name = (req.body.name && req.body.name.trim()) || req.file.originalname.replace(/\.[^.]+$/, '');
    const shareToken = uuidv4();

    try {
      const id = insertDb(
        `INSERT INTO videos (project_id, name, filename, original_name, mime_type, share_token) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.params.id, name, req.file.filename, req.file.originalname, req.file.mimetype || 'video/mp4', shareToken]
      );
      const video = getDb('SELECT *, 0 AS comment_count FROM videos WHERE id = ?', [id]);
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
    // Delete attachment files
    const videoComments = allDb('SELECT id FROM comments WHERE video_id = ?', [req.params.id]);
    for (const comment of videoComments) {
      const attachments = allDb('SELECT filename FROM attachments WHERE comment_id = ?', [comment.id]);
      for (const att of attachments) {
        const attPath = path.join(ATTACHMENTS_DIR, att.filename);
        if (fs.existsSync(attPath)) fs.unlinkSync(attPath);
      }
    }

    // Delete video file
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
  const video = getDb('SELECT id FROM videos WHERE id = ?', [req.params.id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const { timestamp, text } = req.body;
  if (timestamp === undefined || timestamp === null) return res.status(400).json({ error: 'timestamp required' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    const id = insertDb(
      'INSERT INTO comments (video_id, timestamp, text) VALUES (?, ?, ?)',
      [req.params.id, parseFloat(timestamp), text.trim()]
    );
    const comment = getDb('SELECT * FROM comments WHERE id = ?', [id]);
    res.status(201).json({ ...comment, attachments: [] });
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

// ── Comment routes ────────────────────────────────────────────────────────────
app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = getDb('SELECT * FROM comments WHERE id = ?', [req.params.id]);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const attachments = allDb('SELECT filename FROM attachments WHERE comment_id = ?', [req.params.id]);
  for (const att of attachments) {
    const attPath = path.join(ATTACHMENTS_DIR, att.filename);
    if (fs.existsSync(attPath)) fs.unlinkSync(attPath);
  }

  runDb('DELETE FROM attachments WHERE comment_id = ?', [req.params.id]);
  runDb('DELETE FROM comments WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
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
app.get('/api/share/:token', (req, res) => {
  const video = getDb('SELECT * FROM videos WHERE share_token = ?', [req.params.token]);
  if (!video) return res.status(404).json({ error: 'Share link not found' });

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

  res.json({ video, project, comments: commentsWithAttachments, allow_comments: video.allow_comments });
});

app.post('/api/share/:token/comments', (req, res) => {
  const video = getDb('SELECT * FROM videos WHERE share_token = ?', [req.params.token]);
  if (!video) return res.status(404).json({ error: 'Share link not found' });
  if (!video.allow_comments) return res.status(403).json({ error: 'Comments are disabled for this video' });

  const { timestamp, text } = req.body;
  if (timestamp === undefined || timestamp === null) return res.status(400).json({ error: 'timestamp required' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    const id = insertDb(
      'INSERT INTO comments (video_id, timestamp, text) VALUES (?, ?, ?)',
      [video.id, parseFloat(timestamp), text.trim()]
    );
    const comment = getDb('SELECT * FROM comments WHERE id = ?', [id]);
    res.status(201).json({ ...comment, attachments: [] });
  } catch (e) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

app.get('/api/share/:token/stream', (req, res) => {
  const video = getDb('SELECT * FROM videos WHERE share_token = ?', [req.params.token]);
  if (!video) return res.status(404).json({ error: 'Share link not found' });
  streamFile(req, res, path.join(VIDEOS_DIR, video.filename), video.mime_type);
});

app.get('/api/share/:token/attachments/:filename', (req, res) => {
  const video = getDb('SELECT * FROM videos WHERE share_token = ?', [req.params.token]);
  if (!video) return res.status(404).json({ error: 'Share link not found' });

  const att = getDb('SELECT * FROM attachments WHERE filename = ?', [req.params.filename]);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  const comment = getDb(
    'SELECT * FROM comments WHERE id = ? AND video_id = ?',
    [att.comment_id, video.id]
  );
  if (!comment) return res.status(403).json({ error: 'Forbidden' });

  streamFile(req, res, path.join(ATTACHMENTS_DIR, att.filename), att.mime_type);
});

// ── HTML page routes ──────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'login.html'));
});

app.get('/project/:id', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'project.html'));
});

app.get('/video/:id', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'video.html'));
});

app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'share.html'));
});

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
