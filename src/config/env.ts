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
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173,http://localhost:8080"),
  ALLOWED_DOMAINS: z.string().default("youtube.com,youtu.be,tiktok.com,instagram.com,facebook.com"),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(500),
  MAX_DURATION_SECONDS: z.coerce.number().positive().default(3600),
  JOB_TIMEOUT_MINUTES: z.coerce.number().positive().default(15),
  MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  DOWNLOAD_DIR: z.string().default("./tmp"),
  SUPABASE_URL: z.string().url().optional().or(z.literal("")).default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  ADMIN_EMAIL: z.string().email().optional().or(z.literal("")).default(""),
  ADMIN_PASSWORD: z.string().min(8).optional().or(z.literal("")).default(""),
  PRIVACY_HASH_SECRET: z.string().min(16).optional().default("change-me-in-production"),
  ANALYTICS_ENABLED: z.coerce.boolean().default(true),
  GUEST_DOWNLOAD_LIMIT: z.coerce.number().int().nonnegative().default(3),
  ABUSE_PROTECTION_ENABLED: z.coerce.boolean().default(true),
  ABUSE_MAX_ACCOUNTS_PER_DEVICE: z.coerce.number().int().positive().default(5),
  ABUSE_MAX_DOWNLOADS_PER_DEVICE_DAY: z.coerce.number().int().positive().default(20),
  ABUSE_MAX_DOWNLOADS_PER_IP_DAY: z.coerce.number().int().positive().default(50),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  AUTH_RATE_LIMIT_PER_15_MIN: z.coerce.number().int().positive().default(20),
  FEEDBACK_RATE_LIMIT_PER_15_MIN: z.coerce.number().int().positive().default(10),
  PUBLIC_RATE_LIMIT_PER_15_MIN: z.coerce.number().int().positive().default(100),
});

const parsed = envSchema.parse(process.env);
const downloadDir = path.isAbsolute(parsed.DOWNLOAD_DIR)
  ? parsed.DOWNLOAD_DIR
  : path.resolve(projectRoot, parsed.DOWNLOAD_DIR);

function normalizeOrigin(origin: string) {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, "");
  }
}

export const env = {
  ...parsed,
  PROJECT_ROOT: projectRoot,
  DOWNLOAD_DIR: downloadDir,
  FRONTEND_ORIGINS_LIST: parsed.FRONTEND_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin),
  ALLOWED_DOMAINS_LIST: parsed.ALLOWED_DOMAINS.split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean),
};
