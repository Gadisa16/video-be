import type { Response } from "express";
import { env } from "../config/env.js";
import { getContext, type RequestContext } from "../middleware/requestContext.js";
import type { DownloadJob } from "../types/video.js";
import { AppError } from "../utils/errors.js";
import { describeVideoUrl } from "../utils/privacy.js";
import { hasSupabase, insertRows, selectRows, updateRows } from "./supabase.js";

type CounterRow = Record<string, number | string | null>;

export async function assertDownloadAllowed(res: Response) {
  const context = getContext(res);
  if (!hasSupabase()) return;
  if (context.user) {
    await enforceUserAbuseLimits(context);
    return;
  }

  if (!context.guestId) {
    throw new AppError("BAD_REQUEST", "Guest tracking is required before downloading.", 400);
  }

  const guest = await ensureGuestUsage(context);
  const completed = Number(guest.completed_downloads ?? 0);
  if (completed >= env.GUEST_DOWNLOAD_LIMIT) {
    throw new AppError("GUEST_LIMIT_REACHED", "You have used your 3 free downloads. Sign in with Google to keep downloading.", 403);
  }
  await enforceGuestAbuseLimits(context);
}

export async function recordVideoInfoRequest(res: Response) {
  const context = getContext(res);
  if (!hasSupabase()) return;
  if (context.user) {
    await incrementUserUsage(context, "info_requests");
  } else if (context.guestId) {
    const guest = await ensureGuestUsage(context);
    await updateRows("guest_usage", `guest_id=eq.${encodeURIComponent(context.guestId)}`, {
      info_requests: Number(guest.info_requests ?? 0) + 1,
      ip_hash: context.ipHash,
      user_agent_hash: context.userAgentHash,
      last_seen_at: new Date().toISOString(),
    }).catch(() => null);
  }
}

export async function recordDownloadStarted(job: DownloadJob) {
  if (!hasSupabase()) return;
  const video = describeVideoUrl(job.url);
  await insertRows(
    "download_logs",
    {
      job_id: job.id,
      user_id: job.userId ?? null,
      guest_id: job.userId ? null : (job.guestId ?? null),
      ip_hash: job.ipHash ?? null,
      user_agent_hash: job.userAgentHash ?? null,
      video_hash: video.urlHash,
      video_host: video.videoHost,
      platform: video.platform,
      country: job.country ?? "Unknown",
      device_type: job.deviceType ?? "Unknown",
      browser: job.browser ?? "Unknown",
      format_id: job.formatId,
      status: "started",
      started_at: new Date(job.startedAt).toISOString(),
    },
    "job_id",
  ).catch(() => null);

  if (job.userId) await incrementUserUsageFromJob(job, "downloads_started");
}

export async function recordDownloadTerminal(job: DownloadJob) {
  if (!hasSupabase() || !job.finishedAt) return;
  const status = job.status === "completed" ? "completed" : job.status === "cancelled" ? "cancelled" : "failed";
  await updateRows("download_logs", `job_id=eq.${encodeURIComponent(job.id)}`, {
    status,
    file_size_mb: job.totalSizeMb,
    completed_at: new Date(job.finishedAt).toISOString(),
    error_code: job.error ? status : null,
  }).catch(() => null);

  if (job.userId) {
    const field = status === "completed" ? "downloads_completed" : status === "cancelled" ? "downloads_cancelled" : "downloads_failed";
    await incrementUserUsageFromJob(job, field);
  } else if (job.guestId && status === "completed") {
    const rows = await selectRows<CounterRow>("guest_usage", `select=*&guest_id=eq.${encodeURIComponent(job.guestId)}&limit=1`).catch(() => []);
    const row = rows[0];
    await updateRows("guest_usage", `guest_id=eq.${encodeURIComponent(job.guestId)}`, {
      completed_downloads: Number(row?.completed_downloads ?? 0) + 1,
      last_seen_at: new Date().toISOString(),
    }).catch(() => null);
  }
}

export function attachContextToJob(job: DownloadJob, res: Response) {
  const context = getContext(res);
  return {
    ...job,
    userId: context.user?.id ?? null,
    guestId: context.user ? null : context.guestId,
    ipHash: context.ipHash,
    userAgentHash: context.userAgentHash,
    country: context.country,
    deviceType: context.deviceType,
    browser: context.browser,
  } satisfies DownloadJob;
}

async function ensureGuestUsage(context: RequestContext) {
  const rows = await insertRows<CounterRow>(
    "guest_usage",
    {
      guest_id: context.guestId,
      ip_hash: context.ipHash,
      user_agent_hash: context.userAgentHash,
      last_seen_at: new Date().toISOString(),
    },
    "guest_id",
  );
  return rows[0] ?? {};
}

async function enforceGuestAbuseLimits(context: RequestContext) {
  if (!env.ABUSE_PROTECTION_ENABLED) return;
  await enforceDailyLimits(context);
}

async function enforceUserAbuseLimits(context: RequestContext) {
  if (!env.ABUSE_PROTECTION_ENABLED) return;
  await incrementUserUsage(context, "last_seen_only");
  await enforceDailyLimits(context);
  const rows = await selectRows<{ user_id: string }>(
    "user_usage",
    `select=user_id&user_agent_hash=eq.${context.userAgentHash}&user_id=not.is.null`,
  ).catch(() => []);
  const distinctUsers = new Set(rows.map((row) => row.user_id)).size;
  if (distinctUsers > env.ABUSE_MAX_ACCOUNTS_PER_DEVICE) {
    throw new AppError("ABUSE_LIMITED", "Too many accounts have been used from this device. Try again later.", 429);
  }
}

async function enforceDailyLimits(context: RequestContext) {
  const since = encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const [byDevice, byIp] = await Promise.all([
    selectRows("download_logs", `select=job_id&user_agent_hash=eq.${context.userAgentHash}&started_at=gte.${since}`).catch(() => []),
    selectRows("download_logs", `select=job_id&ip_hash=eq.${context.ipHash}&started_at=gte.${since}`).catch(() => []),
  ]);
  if (byDevice.length >= env.ABUSE_MAX_DOWNLOADS_PER_DEVICE_DAY || byIp.length >= env.ABUSE_MAX_DOWNLOADS_PER_IP_DAY) {
    throw new AppError("ABUSE_LIMITED", "Download activity from this device or network is unusually high. Try again later.", 429);
  }
}

async function incrementUserUsage(context: RequestContext, field: string) {
  if (!context.user) return;
  const rows = await selectRows<CounterRow>("user_usage", `select=*&user_id=eq.${context.user.id}&limit=1`).catch(() => []);
  const row = rows[0];
  const patch: Record<string, unknown> = {
    user_id: context.user.id,
    ip_hash: context.ipHash,
    user_agent_hash: context.userAgentHash,
    last_seen_at: new Date().toISOString(),
  };
  if (field !== "last_seen_only") patch[field] = Number(row?.[field] ?? 0) + 1;
  if (row) await updateRows("user_usage", `user_id=eq.${context.user.id}`, patch).catch(() => null);
  else await insertRows("user_usage", patch, "user_id").catch(() => null);
}

async function incrementUserUsageFromJob(job: DownloadJob, field: string) {
  if (!job.userId) return;
  const rows = await selectRows<CounterRow>("user_usage", `select=*&user_id=eq.${job.userId}&limit=1`).catch(() => []);
  const row = rows[0];
  const patch = {
    user_id: job.userId,
    ip_hash: job.ipHash ?? null,
    user_agent_hash: job.userAgentHash ?? null,
    last_seen_at: new Date().toISOString(),
    [field]: Number(row?.[field] ?? 0) + 1,
  };
  if (row) await updateRows("user_usage", `user_id=eq.${job.userId}`, patch).catch(() => null);
  else await insertRows("user_usage", patch, "user_id").catch(() => null);
}
