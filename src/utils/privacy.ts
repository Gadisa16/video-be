import crypto from "node:crypto";
import type { Request } from "express";
import { env } from "../config/env.js";
import type { SourcePlatform } from "../types/video.js";

export function hashSensitive(value: string | null | undefined) {
  const normalized = (value ?? "unknown").trim().toLowerCase();
  return crypto.createHmac("sha256", env.PRIVACY_HASH_SECRET).update(normalized).digest("hex");
}

export function getClientIp(req: Request) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  const cfIp = String(req.headers["cf-connecting-ip"] ?? "").trim();
  return forwarded || cfIp || req.ip || req.socket.remoteAddress || "unknown";
}

export function getCountry(req: Request) {
  const country = String(req.headers["cf-ipcountry"] ?? req.headers["x-vercel-ip-country"] ?? "").trim().toUpperCase();
  return country && country !== "XX" ? country.slice(0, 2) : "Unknown";
}

export function parseUserAgent(userAgent: string | undefined) {
  const ua = userAgent ?? "";
  const deviceType = /mobile|iphone|android/i.test(ua)
    ? "Mobile"
    : /tablet|ipad/i.test(ua)
      ? "Tablet"
      : "Desktop";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /firefox|fxios/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : "Other";
  return { deviceType, browser };
}

export function describeVideoUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const urlHash = hashSensitive(`${host}${url.pathname}`);
  return {
    videoHost: host,
    urlHash,
    platform: platformFromHost(host),
  };
}

export function platformFromHost(host: string): SourcePlatform {
  if (host.includes("youtube") || host === "youtu.be") return "YouTube";
  if (host.includes("tiktok")) return "TikTok";
  if (host.includes("facebook") || host === "fb.watch") return "Facebook";
  if (host.includes("instagram")) return "Instagram";
  if (host.includes("vimeo")) return "Vimeo";
  if (host.includes("twitter") || host.includes("x.com")) return "Twitter";
  return "Generic";
}
