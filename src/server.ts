import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { startKeepAlive, stopKeepAlive } from "./jobs/keepAlive.js";
import { cleanDirectory, ensureDir } from "./utils/fs.js";

await ensureDir(env.DOWNLOAD_DIR);
await cleanDirectory(env.DOWNLOAD_DIR);

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`video-be listening on http://localhost:${env.PORT}`);
});

// Self-hosted scheduler that pings Supabase so the free-tier project
// doesn't get paused after 7 days of inactivity. See src/jobs/keepAlive.ts.
startKeepAlive();

function shutdown(signal: NodeJS.Signals) {
  console.log(`[server] received ${signal}, shutting down`);
  stopKeepAlive();
  server.close(() => process.exit(0));
  // Hard exit if close hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
