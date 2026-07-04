import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { env } from "../config/env.js";
import { jobStore } from "./jobStore.js";
import { assertAllowedDomain } from "../services/domain.js";
import { trackJobEvent } from "../services/analytics.js";
import { recordDownloadTerminal } from "../services/usage.js";
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
      "--progress",
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
      void failJob(jobId, new AppError("TIMEOUT", "The download timed out before it could finish.", 408));
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
    child.stdout.on("data", (chunk) => parseProgress(String(chunk), jobId));
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      parseProgress(String(chunk), jobId);
    });
    child.on("error", (error) => {
      void failJob(jobId, new AppError("INTERNAL_ERROR", `Unable to start yt-dlp: ${error.message}`, 500));
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

      const roundedSizeMb = Math.round(sizeMb * 10) / 10;
      const extension = path.extname(filePath) || `.${selected.outputExtension}`;
      const fileName = `${sanitizeFileName(latest.fileName ?? "download")}${extension}`;
      jobStore.update(jobId, {
        status: "completed",
        progress: 100,
        speedKbps: latest.speedKbps ?? calculateAverageSpeedKbps(sizeMb, latest.startedAt),
        etaSeconds: 0,
        totalSizeMb: roundedSizeMb,
        downloadedMb: roundedSizeMb,
        filePath,
        fileName,
        process: undefined,
        timeout: undefined,
        finishedAt: Date.now(),
      });
      const completedJob = jobStore.getInternal(jobId);
      if (completedJob) {
        await recordDownloadTerminal(completedJob);
        await trackJobEvent(completedJob, "download_completed", { formatId: completedJob.formatId });
      }
    });
  } catch (error) {
    await failJob(jobId, error instanceof AppError ? error : new AppError("DOWNLOAD_FAILED", "The download could not be started.", 500));
  }
}

export async function cancelDownloadJob(jobId: string) {
  const job = jobStore.getInternal(jobId);
  if (!job) throw new AppError("JOB_NOT_FOUND", "Download job not found.", 404);
  if (job.timeout) clearTimeout(job.timeout);
  if (job.process && !job.process.killed) job.process.kill("SIGTERM");
  await removeDir(job.jobDir);
  jobStore.update(jobId, {
    status: "cancelled",
    process: undefined,
    timeout: undefined,
    finishedAt: Date.now(),
    error: null,
    filePath: null,
  });
  const cancelledJob = jobStore.getInternal(jobId);
  if (cancelledJob) {
    await recordDownloadTerminal(cancelledJob);
    await trackJobEvent(cancelledJob, "download_cancelled", { formatId: cancelledJob.formatId });
  }
  return jobStore.get(jobId);
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
    etaSeconds: null,
    filePath: null,
  });
  const failedJob = jobStore.getInternal(jobId);
  if (failedJob) {
    await recordDownloadTerminal(failedJob);
    await trackJobEvent(failedJob, "download_failed", { formatId: failedJob.formatId });
  }
}

function parseProgress(output: string, jobId: string) {
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("[download]")) continue;

    const progressMatch = /\[download\]\s+([\d.]+)%/.exec(line);
    const totalMatch = /of\s+~?([\d.]+)\s*([KMG]?i?B)/i.exec(line);
    const downloadedMatch = /\[download\]\s+([\d.]+)\s*([KMG]?i?B)\s+of/i.exec(line);
    const speedMatch = /at\s+([\d.]+)\s*([KMG]?i?B)\/s/i.exec(line);
    const etaMatch = /ETA\s+(?:(\d+):)?(\d{1,2}):(\d{2})/.exec(line);

    const current = jobStore.getInternal(jobId);
    if (current?.status !== "processing") continue;

    const progress = progressMatch ? Number(progressMatch[1]) : current.progress;
    const totalSizeMb = totalMatch ? toMb(Number(totalMatch[1]), totalMatch[2]) : current.totalSizeMb;
    const downloadedMb = getDownloadedMb({ downloadedMatch, totalSizeMb, progress, currentDownloadedMb: current.downloadedMb });
    const parsedSpeedKbps = speedMatch ? toKbps(Number(speedMatch[1]), speedMatch[2]) : null;
    const speedKbps = parsedSpeedKbps ?? calculateAverageSpeedKbps(downloadedMb, current.startedAt);
    const etaSeconds = etaMatch ? parseEtaSeconds(etaMatch) : estimateEtaSeconds(totalSizeMb, downloadedMb, speedKbps);

    jobStore.update(jobId, {
      progress,
      totalSizeMb: totalSizeMb ? Math.round(totalSizeMb * 10) / 10 : current.totalSizeMb,
      downloadedMb: Math.round(downloadedMb * 10) / 10,
      speedKbps,
      etaSeconds,
    });
  }
}

function getDownloadedMb({ downloadedMatch, totalSizeMb, progress, currentDownloadedMb }: { downloadedMatch: RegExpExecArray | null; totalSizeMb: number | null; progress: number; currentDownloadedMb: number }) {
  if (downloadedMatch) return toMb(Number(downloadedMatch[1]), downloadedMatch[2]);
  if (totalSizeMb && progress > 0) return (totalSizeMb * progress) / 100;
  return currentDownloadedMb;
}

function parseEtaSeconds(match: RegExpExecArray) {
  const hours = match[1] ? Number(match[1]) : 0;
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function estimateEtaSeconds(totalSizeMb: number | null, downloadedMb: number, speedKbps: number | null) {
  if (!totalSizeMb || !speedKbps || speedKbps <= 0 || downloadedMb <= 0) return null;
  const remainingMb = Math.max(totalSizeMb - downloadedMb, 0);
  return Math.ceil((remainingMb * 1024) / speedKbps);
}

function calculateAverageSpeedKbps(downloadedMb: number, startedAt: number) {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.25);
  if (downloadedMb <= 0) return null;
  return Math.round((downloadedMb * 1024) / elapsedSeconds);
}

function toMb(value: number, unit: string) {
  if (/^b$/i.test(unit)) return value / 1024 / 1024;
  if (/^k/i.test(unit)) return value / 1024;
  if (/^g/i.test(unit)) return value * 1024;
  return value;
}

function toKbps(value: number, unit: string) {
  if (/^b$/i.test(unit)) return value / 1024;
  if (/^k/i.test(unit)) return value;
  if (/^m/i.test(unit)) return value * 1024;
  if (/^g/i.test(unit)) return value * 1024 * 1024;
  return value;
}
