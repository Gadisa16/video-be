import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  ALLOWED_DOMAINS: z.string().default("youtube.com,youtu.be,tiktok.com,instagram.com,facebook.com"),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(500),
  MAX_DURATION_SECONDS: z.coerce.number().positive().default(3600),
  JOB_TIMEOUT_MINUTES: z.coerce.number().positive().default(15),
  MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  DOWNLOAD_DIR: z.string().default("./tmp"),
});

const parsed = envSchema.parse(process.env);
const downloadDir = path.isAbsolute(parsed.DOWNLOAD_DIR)
  ? parsed.DOWNLOAD_DIR
  : path.resolve(projectRoot, parsed.DOWNLOAD_DIR);

export const env = {
  ...parsed,
  PROJECT_ROOT: projectRoot,
  DOWNLOAD_DIR: downloadDir,
  ALLOWED_DOMAINS_LIST: parsed.ALLOWED_DOMAINS.split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean),
};
