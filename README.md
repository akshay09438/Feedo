# Feedo

A collaborative video review platform — upload videos, leave timestamped comments, draw annotations on frames, manage versions, and share reviews with your team.

![Node.js](https://img.shields.io/badge/Node.js-Express-green) ![SQLite](https://img.shields.io/badge/Database-SQLite-blue) ![Vanilla JS](https://img.shields.io/badge/Frontend-Vanilla%20JS-yellow) ![Railway](https://img.shields.io/badge/Deployed-Railway-purple)

---

## Features

- **Video Upload & Playback** — Upload videos up to 4GB with full seek support (HTTP range requests)
- **Timestamped Comments** — Pause the video and drop comments at any frame; click to jump back
- **Annotations** — Draw freehand strokes or place text boxes on video frames, linked to comments
- **Versioning** — Upload new cuts of a video; all versions share comments and live under a single version group
- **Projects** — Organize videos into projects with editable names
- **Sharing** — Generate a shareable link (edit or view-only) with no login required for recipients
- **Attachments** — Attach files (images, docs) to comments, up to 500MB each (20 files per comment)
- **Comment Threads** — Nested replies on any comment
- **Resolve / Reopen** — Mark comments resolved; filter by Open or Resolved
- **Activity History** — Full audit log per video (uploads, comments, annotations, deletions)
- **No external DB** — Runs entirely on SQLite via sql.js; no database server required

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Server | Express |
| Database | sql.js (SQLite, persisted to `data.db`) |
| File Uploads | Multer |
| Frontend | Vanilla JS, HTML, CSS |
| Deployment | Railway |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/akshay09438/Feedo.git
cd Feedo
npm install
```

### Run (development)

```bash
npm run dev
```

### Run (production)

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) and log in with the default credentials:

```
Username: admin
Password: banana
```

The database (`data.db`) and uploads directory are created automatically on first run.

---

## Configuration

All configuration is via environment variables. Everything has a default, so none are required for local use.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the server listens on |
| `ADMIN_USERNAME` | `admin` | Login username |
| `ADMIN_PASSWORD` | `banana` | Login password |
| `DB_PATH` | `./data.db` | Path to the SQLite database file |
| `UPLOADS_DIR` | `./uploads` | Directory for uploaded videos and attachments |

Create a `.env` file at the project root to override any of these:

```env
ADMIN_USERNAME=yourname
ADMIN_PASSWORD=yourpassword
PORT=8080
```

---

## Project Structure

```
Feedo/
├── server.js              # Express server, all API routes, database logic
├── data.db                # SQLite database (auto-created)
├── uploads/               # Uploaded videos and attachments (auto-created)
├── railway.toml           # Railway deployment config
└── public/
    ├── index.html         # Dashboard
    ├── video.html         # Video review page
    ├── share.html         # Public share link page
    ├── project.html       # Project page
    ├── login.html         # Login
    ├── style.css          # All styles
    ├── dashboard.js
    ├── video.js
    ├── share.js
    ├── project.js
    ├── sidebar.js
    ├── annotation-canvas.js
    ├── annotation-composer.js
    ├── annotation-toolbar.js
    ├── video-annotator.js
    └── utils.js
```

---

## API Reference

All `/api/videos/*`, `/api/projects/*`, and `/api/comments/*` routes require authentication. Share routes are public.

### Auth

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/auth/login` | Log in |
| `POST` | `/api/auth/logout` | Log out |
| `GET` | `/api/auth/status` | Check session |
| `POST` | `/api/auth/name` | Set display name |

### Projects

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create project |
| `PATCH` | `/api/projects/:id` | Rename project |
| `DELETE` | `/api/projects/:id` | Delete project |
| `GET` | `/api/projects/:id/history` | Project activity log |

### Videos

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/videos` | List all videos |
| `POST` | `/api/videos` | Upload video |
| `GET` | `/api/videos/:id` | Get video metadata |
| `PATCH` | `/api/videos/:id` | Update name / settings |
| `DELETE` | `/api/videos/:id` | Delete video |
| `GET` | `/api/videos/:id/stream` | Stream video (HTTP range) |
| `GET` | `/api/videos/:id/comments` | List comments |
| `POST` | `/api/videos/:id/comments` | Post comment |
| `GET` | `/api/videos/:id/annotations` | List annotations |
| `POST` | `/api/videos/:id/annotations` | Save annotation |
| `GET` | `/api/videos/:id/versions` | List versions |
| `POST` | `/api/videos/:id/versions` | Upload new version |
| `GET` | `/api/videos/:id/history` | Video activity log |

### Comments

| Method | Route | Description |
|--------|-------|-------------|
| `PUT` | `/api/comments/:id` | Edit comment |
| `DELETE` | `/api/comments/:id` | Delete comment |
| `PATCH` | `/api/comments/:id/resolve` | Resolve / reopen |
| `POST` | `/api/comments/:id/attachments` | Attach file |

### Share (no auth required)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/share/:token` | Load video + comments via token |
| `POST` | `/api/share/:token/comments` | Post comment (edit token only) |
| `GET` | `/api/share/:token/annotations` | Load annotations |
| `POST` | `/api/share/:token/annotations` | Save annotation (edit token only) |
| `GET` | `/api/share/:token/stream` | Stream video (no auth) |

---

## Sharing

Each video gets two tokens on upload:

- **Share token** — full access: can comment, annotate, and reply
- **View token** — read-only: watch and read comments, no posting

Share links look like:

```
https://your-domain.com/share/<token>
```

You can toggle whether comments are allowed on a per-video basis from the video page.

---

## Deployment

The project is pre-configured for [Railway](https://railway.app).

```toml
# railway.toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "node server.js"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

Set your environment variables in the Railway dashboard (especially `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DB_PATH`, and `UPLOADS_DIR` if you're using a Railway volume for persistence).

Live instance: [feedo-production.up.railway.app](https://feedo-production.up.railway.app)

---

## Limits

| Resource | Limit |
|----------|-------|
| Video file size | 4 GB |
| Attachment file size | 500 MB |
| Attachments per comment | 20 |
| Session duration | 7 days |

---

## License

MIT
