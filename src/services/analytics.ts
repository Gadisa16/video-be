import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { getContext } from "../middleware/requestContext.js";
import type { DownloadJob } from "../types/video.js";
import { hasSupabase, insertRows } from "./supabase.js";
import { describeVideoUrl } from "../utils/privacy.js";

export type AnalyticsEventType =
  | "page_view"
  | "video_info_request"
  | "download_started"
  | "download_completed"
  | "download_failed"
  | "download_cancelled"
  | "guest_limit_reached"
  | "user_registration"
  | "user_login"
  | "feedback_submission";

export async function trackEvent(
  req: Request,
  res: Response,
  eventType: AnalyticsEventType,
  options: { videoUrl?: string; path?: string; metadata?: Record<string, unknown> } = {},
) {
  if (!env.ANALYTICS_ENABLED || !hasSupabase()) return;
  const context = getContext(res);
  const video = options.videoUrl ? describeVideoUrl(options.videoUrl) : null;
  await insertRows("analytics_events", {
    event_type: eventType,
    user_id: context.user?.id ?? null,
    guest_id: context.user ? null : context.guestId,
    ip_hash: context.ipHash,
    user_agent_hash: context.userAgentHash,
    url_path: options.path ?? req.path,
    video_host: video?.videoHost ?? null,
    video_hash: video?.urlHash ?? null,
    platform: video?.platform ?? null,
    country: context.country,
    device_type: context.deviceType,
    browser: context.browser,
    metadata: options.metadata ?? {},
  }).catch((error) => {
    req.log?.warn({ error }, "analytics event could not be stored");
  });
}

export async function trackJobEvent(job: DownloadJob, eventType: AnalyticsEventType, metadata: Record<string, unknown> = {}) {
  if (!env.ANALYTICS_ENABLED || !hasSupabase()) return;
  const video = describeVideoUrl(job.url);
  await insertRows("analytics_events", {
    event_type: eventType,
    user_id: job.userId ?? null,
    guest_id: job.userId ? null : (job.guestId ?? null),
    ip_hash: job.ipHash ?? null,
    user_agent_hash: job.userAgentHash ?? null,
    url_path: "/api/downloads",
    video_host: video.videoHost,
    video_hash: video.urlHash,
    platform: video.platform,
    country: job.country ?? "Unknown",
    device_type: job.deviceType ?? "Unknown",
    browser: job.browser ?? "Unknown",
    metadata,
  }).catch(() => null);
}
