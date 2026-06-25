import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { env } from "../config/env.js";
import { jobStore } from "./jobStore.js";
import { assertAllowedDomain } from "../services/domain.js";
import { resolveSelectedFormat } from "../services/ytdlp.js";
import { AppError, mapYtDlpError } from "../utils/errors.js";
import { ensureDir, findFirstFile, removeDir } from "../utils/fs.js";
import { sanitizeFileName } from "../utils/filename.js";

export async function processDownloadJob(jobId: string) {
  const job = jobStore.getInternal(jobId);
  if (!job || job.status === "cancelled") return;

  try {
    assertAllowedDomain(job.url);
    const selected = resolveSelectedFormat(job.formatId);
    await ensureDir(job.jobDir);

    const outputTemplate = path.join(job.jobDir, `${job.id}.%(ext)s`);
    const args = [
      "--newline",
      "--no-playlist",
      "--no-warnings",
      "--restrict-filenames",
      ...selected.args,
      "-o",
      outputTemplate,
      job.url,
    ];

    const child = spawn("yt-dlp", args, { windowsHide: true });
    const timeout = setTimeout(() => {
      failJob(jobId, new AppError("TIMEOUT", "The download timed out before it could finish.", 408));
      child.kill("SIGTERM");
    }, env.JOB_TIMEOUT_MINUTES * 60 * 1000);

    jobStore.update(jobId, {
      status: "processing",
      process: child,
      timeout,
      progress: 0,
      speedKbps: null,
      etaSeconds: null,
      error: null,
    });

    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      parseProgress(String(chunk), jobId);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      failJob(jobId, new AppError("INTERNAL_ERROR", `Unable to start yt-dlp: ${error.message}`, 500));
    });
    child.on("close", async (code) => {
      clearTimeout(timeout);
      const latest = jobStore.getInternal(jobId);
      if (!latest || latest.status === "cancelled" || latest.status === "failed") return;

      if (code !== 0) {
        await failJob(jobId, mapYtDlpError(stderr));
        return;
      }

      const filePath = await findFirstFile(latest.jobDir);
      if (!filePath) {
        await failJob(jobId, new AppError("DOWNLOAD_FAILED", "The download finished but no output file was created.", 500));
        return;
      }

      const stats = await fs.stat(filePath);
      const sizeMb = stats.size / 1024 / 1024;
      if (sizeMb > env.MAX_FILE_SIZE_MB) {
        await failJob(jobId, new AppError("TOO_LARGE", `The generated file exceeds the ${env.MAX_FILE_SIZE_MB} MB limit.`, 413));
        return;
      }

      const extension = path.extname(filePath) || `.${selected.outputExtension}`;
      const fileName = `${sanitizeFileName(latest.fileName ?? "download")}${extension}`;
      jobStore.update(jobId, {
        status: "completed",
        progress: 100,
        speedKbps: null,
        etaSeconds: null,
        totalSizeMb: Math.round(sizeMb * 10) / 10,
        downloadedMb: Math.round(sizeMb * 10) / 10,
        filePath,
        fileName,
        process: undefined,
        timeout: undefined,
        finishedAt: Date.now(),
      });
    });
  } catch (error) {
    await failJob(
      jobId,
      error instanceof AppError
        ? error
        : new AppError("DOWNLOAD_FAILED", "The download could not be started.", 500),
    );
  }
}

export async function cancelDownloadJob(jobId: string) {
  const job = jobStore.getInternal(jobId);
  if (!job) throw new AppError("JOB_NOT_FOUND", "Download job not found.", 404);
  if (job.timeout) clearTimeout(job.timeout);
  if (job.process && !job.process.killed) job.process.kill("SIGTERM");
  await removeDir(job.jobDir);
  return jobStore.update(jobId, {
    status: "cancelled",
    process: undefined,
    timeout: undefined,
    finishedAt: Date.now(),
    error: null,
    filePath: null,
  });
}

export async function cleanupJobFiles(jobId: string) {
  const job = jobStore.getInternal(jobId);
  if (!job) return;
  await removeDir(job.jobDir);
  jobStore.update(jobId, { filePath: null });
}

async function failJob(jobId: string, error: AppError) {
  const job = jobStore.getInternal(jobId);
  if (!job) return;
  if (job.timeout) clearTimeout(job.timeout);
  if (job.process && !job.process.killed) job.process.kill("SIGTERM");
  await removeDir(job.jobDir);
  jobStore.update(jobId, {
    status: "failed",
    progress: job.progress,
    process: undefined,
    timeout: undefined,
    finishedAt: Date.now(),
    error: error.message,
    filePath: null,
  });
}

function parseProgress(output: string, jobId: string) {
  for (const line of output.split(/\r?\n/)) {
    const progressMatch = /\[download]\s+([\d.]+)%/.exec(line);
    const totalMatch = /of\s+~?([\d.]+)(KiB|MiB|GiB)/i.exec(line);
    const speedMatch = /at\s+([\d.]+)(KiB|MiB|GiB)\/s/i.exec(line);
    const etaMatch = /ETA\s+(\d+:)?(\d{1,2}):(\d{2})/.exec(line);

    const patch: Record<string, number | null> = {};
    if (progressMatch) patch.progress = Number(progressMatch[1]);
    if (totalMatch) patch.totalSizeMb = toMb(Number(totalMatch[1]), totalMatch[2]);
    if (speedMatch) patch.speedKbps = toKbps(Number(speedMatch[1]), speedMatch[2]);
    if (etaMatch) {
      const hours = etaMatch[1] ? Number(etaMatch[1].replace(":", "")) : 0;
      patch.etaSeconds = hours * 3600 + Number(etaMatch[2]) * 60 + Number(etaMatch[3]);
    }

    if (Object.keys(patch).length > 0) {
      const current = jobStore.getInternal(jobId);
      if (current?.status === "processing") {
        const downloadedMb = patch.totalSizeMb && patch.progress
          ? (Number(patch.totalSizeMb) * Number(patch.progress)) / 100
          : current.downloadedMb;
        jobStore.update(jobId, {
          ...patch,
          downloadedMb: Math.round(downloadedMb * 10) / 10,
        });
      }
    }
  }
}

function toMb(value: number, unit: string) {
  if (/kib/i.test(unit)) return value / 1024;
  if (/gib/i.test(unit)) return value * 1024;
  return value;
}

function toKbps(value: number, unit: string) {
  if (/kib/i.test(unit)) return value;
  if (/mib/i.test(unit)) return value * 1024;
  if (/gib/i.test(unit)) return value * 1024 * 1024;
  return value;
}
