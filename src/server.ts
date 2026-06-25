import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { cleanDirectory, ensureDir } from "./utils/fs.js";

await ensureDir(env.DOWNLOAD_DIR);
await cleanDirectory(env.DOWNLOAD_DIR);

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`video-be listening on http://localhost:${env.PORT}`);
});
