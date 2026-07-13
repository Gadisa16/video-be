# Video Downloader Backend

TypeScript Express backend for permitted public media downloads. It validates URLs, rejects unsupported domains before invoking tools, retrieves metadata with `yt-dlp`, and runs asynchronous download jobs with temporary files. The backend also owns privacy-safe auth/profile sync, guest limits, analytics, admin dashboard APIs, and feedback management.

## Prerequisites

- Node.js 20 or newer
- FFmpeg available on `PATH`
- yt-dlp available on `PATH`
- A Supabase project with Auth enabled. Enable Google provider and/or email confirmations as needed.

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

Copy `.env.example` to `.env` and adjust values:

```bash
PORT=4000
FRONTEND_ORIGIN=http://localhost:5173,http://localhost:8080
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PRIVACY_HASH_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-password
GUEST_DOWNLOAD_LIMIT=3
```

`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, and `PRIVACY_HASH_SECRET` must never be exposed to the frontend.

## Database

Run the migration in `supabase/migrations/202606300001_auth_usage_analytics_feedback.sql` against Supabase. It creates:

- `profiles`
- `guest_usage`
- `user_usage`
- `download_logs`
- `analytics_events`
- `feedback`

RLS is enabled. Browser users can read/update their own profile and insert feedback; server-side admin and analytics operations use the service role from this backend.

## Run

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```
## Deployment troubleshooting

If the Vercel frontend shows that a public YouTube URL is private or restricted, check the backend first:

- Confirm `GET /health` on the Render API returns `{ "status": "ok" }`. A Render free service can briefly return `502 Bad Gateway` while waking up.
- Redeploy the backend image to install the latest `yt-dlp`; the Dockerfile installs `yt-dlp` during image build.
- Check Render logs for `yt-dlp metadata failed` or `yt-dlp download failed`. `errorCode: "PLATFORM_BLOCKED"` means the source platform is blocking requests from the hosted server, often with a bot-check or rate-limit response.
- Do not add user cookies, bypass private/login-protected media, or bypass DRM. For reliable access to your own content, use platform-approved APIs or a backend environment/IP that the platform allows.

## Endpoints

- `GET /health`
- `GET /health/keepalive` — Supabase keep-alive scheduler status (see below)
- `POST /api/auth/sync`
- `PATCH /api/auth/profile`
- `GET /api/me`
- `POST /api/analytics/page-view`
- `POST /api/feedback`
- `POST /api/admin/login`
- `GET /api/admin/dashboard`
- `GET /api/admin/feedback`
- `PATCH /api/admin/feedback/:id`
- `DELETE /api/admin/feedback/:id`
- `POST /api/video-info`
- `POST /api/downloads`
- `GET /api/downloads/:jobId`
- `POST /api/downloads/:jobId/cancel`
- `GET /api/downloads/:jobId/file`

## Supabase keep-alive (prevents auto-pause)

Supabase pauses free-tier projects after ~7 days of inactivity. The backend runs an in-process scheduler (`src/jobs/keepAlive.ts`) that pings your Supabase project on a timer so it never goes idle. Each tick writes a synthetic row to `analytics_events`, which counts as real activity for Supabase's inactivity detector and gives you a heartbeat you can grep for in your dashboard.

Defaults (see `.env.example` for the full list):

| Variable                  | Default | Purpose                                                                |
| ------------------------- | ------- | ---------------------------------------------------------------------- |
| `KEEPALIVE_ENABLED`       | `true`  | Set to `false` to disable the scheduler entirely.                      |
| `KEEPALIVE_INTERVAL_HOURS`| `24`    | Hours between pings. 24h is well inside the 7-day pause window.        |
| `KEEPALIVE_INTERVAL_MINUTES` | `0`  | Extra minutes added to the interval (use `H=0 M=6` for a 6-minute loop).|
| `KEEPALIVE_JITTER_MINUTES`| `15`    | Random ± window so multiple replicas don't ping at the same second.    |
| `KEEPALIVE_RUN_ON_BOOT`   | `true`  | If `true`, the first tick fires immediately on startup/restart.        |

Check status at any time:

```bash
curl https://your-api.onrender.com/health/keepalive
```

Notes:

- The scheduler is a no-op if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing — safe to leave enabled in environments without Supabase.
- It runs in the Render backend process. If your Render free service spins down, pings pause with it; consider an external uptime cron-job.org ping too if Render is also frequently idle.
- The synthetic row is tagged `event_type = 'keepalive_ping'` so it's trivial to filter out of real analytics.

## Privacy and abuse controls

- Raw IP addresses and full video URLs are never stored.
- IP and User-Agent values are HMAC-SHA256 hashed with `PRIVACY_HASH_SECRET`.
- Video analytics store host and a URL fingerprint, not the original URL.
- Guests are limited by completed downloads using `guest_id`, hashed IP, and hashed User-Agent.
- Abuse thresholds are configurable through `ABUSE_*` environment variables.
- Public, auth, and feedback endpoints are rate-limited.
