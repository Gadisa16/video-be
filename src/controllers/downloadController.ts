import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { jobStore } from "../jobs/jobStore.js";
import { cancelDownloadJob, cleanupJobFiles, processDownloadJob } from "../jobs/downloadWorker.js";
import { assertAllowedDomain } from "../services/domain.js";
import { resolveSelectedFormat } from "../services/ytdlp.js";
import { AppError, asyncHandler } from "../utils/errors.js";
import { sanitizeFileName } from "../utils/filename.js";

const createDownloadSchema = z.object({
  url: z.string().url(),
  formatId: z.string().min(1).max(80),
  fileName: z.string().max(160).optional(),
});

export const createDownload = asyncHandler(async (req, res) => {
  const { url, formatId, fileName } = createDownloadSchema.parse(req.body);
  assertAllowedDomain(url);
  resolveSelectedFormat(formatId);

  if (jobStore.activeCount() >= env.MAX_CONCURRENT_JOBS) {
    throw new AppError("TOO_MANY_ACTIVE_JOBS", "Too many downloads are already running. Try again shortly.", 429);
  }

  const id = randomUUID();
  const safeBaseName = sanitizeFileName(fileName ?? "download");
  const job = jobStore.create({
    id,
    url,
    formatId,
    status: "queued",
    progress: 0,
    speedKbps: null,
    etaSeconds: null,
    totalSizeMb: null,
    downloadedMb: 0,
    startedAt: Date.now(),
    error: null,
    fileName: safeBaseName,
    filePath: null,
    jobDir: path.join(env.DOWNLOAD_DIR, id),
  });

  setImmediate(() => {
    void processDownloadJob(id);
  });

  res.status(202).json({
    jobId: job.id,
    status: job.status,
  });
});

export const getDownload = asyncHandler(async (req, res) => {
  const jobId = String(req.params.jobId);
  const job = jobStore.get(jobId);
  if (!job) throw new AppError("JOB_NOT_FOUND", "Download job not found.", 404);
  res.json(toStatusResponse(job));
});

export const cancelDownload = asyncHandler(async (req, res) => {
  const jobId = String(req.params.jobId);
  const job = await cancelDownloadJob(jobId);
  if (!job) throw new AppError("JOB_NOT_FOUND", "Download job not found.", 404);
  res.json(toStatusResponse(job));
});

export const downloadFile = asyncHandler(async (req, res) => {
  const jobId = String(req.params.jobId);
  const job = jobStore.getInternal(jobId);
  if (!job) throw new AppError("JOB_NOT_FOUND", "Download job not found.", 404);
  if (job.status !== "completed" || !job.filePath || !job.fileName) {
    throw new AppError("JOB_NOT_READY", "This download is not ready yet.", 409);
  }
  if (!fs.existsSync(job.filePath)) {
    throw new AppError("UNAVAILABLE", "The completed file is no longer available.", 404);
  }

  const ext = path.extname(job.fileName).toLowerCase();
  const contentType = ext === ".mp3" ? "audio/mpeg" : ext === ".webm" ? "video/webm" : "video/mp4";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(job.fileName)}"`);

  res.download(job.filePath, job.fileName, (error) => {
    void cleanupJobFiles(job.id);
    if (error && !res.headersSent) {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to stream the completed file." } });
    }
  });
});

function toStatusResponse(job: ReturnType<typeof jobStore.get> extends infer T ? NonNullable<T> : never) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    speed: job.speedKbps,
    eta: job.etaSeconds,
    speedKbps: job.speedKbps,
    etaSeconds: job.etaSeconds,
    totalSizeMb: job.totalSizeMb,
    downloadedMb: job.downloadedMb,
    error: job.error ?? null,
    fileName: job.fileName ?? null,
    downloadUrl: job.status === "completed" ? `/api/downloads/${job.id}/file` : null,
  };
}

