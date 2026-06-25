# Video Downloader Backend

TypeScript Express backend for permitted public media downloads. It validates URLs, rejects unsupported domains before invoking tools, retrieves metadata with `yt-dlp`, and runs asynchronous download jobs with temporary files.

## Prerequisites

- Node.js 20 or newer
- FFmpeg available on `PATH`
- yt-dlp available on `PATH`

Windows install options:

```powershell
winget install Gyan.FFmpeg
winget install yt-dlp.yt-dlp
```

## Installation

```bash
npm install
```

## Environment

Copy `.env.example` to `.env` and adjust values as needed:

```bash
PORT=4000
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
ALLOWED_DOMAINS=youtube.com,youtu.be,tiktok.com,instagram.com,facebook.com
MAX_FILE_SIZE_MB=500
MAX_DURATION_SECONDS=3600
JOB_TIMEOUT_MINUTES=15
MAX_CONCURRENT_JOBS=2
DOWNLOAD_DIR=./tmp
```

## Run

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## Endpoints

- `GET /health`
- `POST /api/video-info` with `{ "url": "https://example.com/video" }`
- `POST /api/downloads` with `{ "url": "...", "formatId": "mp4-720p" }`
- `GET /api/downloads/:jobId`
- `POST /api/downloads/:jobId/cancel`
- `GET /api/downloads/:jobId/file`

Errors use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation"
  }
}
```

## MVP limitations

- Jobs are stored in memory and disappear when the process restarts.
- Concurrent processing is limited per process only.
- History remains a frontend localStorage feature.
- The current worker is designed so the in-memory store can later be replaced with Redis and BullMQ.
- Only allowlisted public URLs are processed. Private, login-protected, restricted, DRM-protected, unavailable, or unsupported media is rejected.
