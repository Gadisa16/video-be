import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

export function parsePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("BAD_REQUEST", "Please provide a valid HTTP or HTTPS URL.", 400);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError("BAD_REQUEST", "Only HTTP and HTTPS URLs are supported.", 400);
  }

  return url;
}

export function assertAllowedDomain(value: string): URL {
  const url = parsePublicUrl(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const allowed = env.ALLOWED_DOMAINS_LIST.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );

  if (!allowed) {
    throw new AppError(
      "UNSUPPORTED_DOMAIN",
      "This domain is not supported. Only configured public platforms can be processed.",
      422,
    );
  }

  return url;
}

export function detectPlatform(hostname: string) {
  const host = hostname.toLowerCase();
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube";
  if (host.includes("tiktok.com")) return "TikTok";
  if (host.includes("instagram.com")) return "Instagram";
  if (host.includes("facebook.com") || host.includes("fb.watch")) return "Facebook";
  if (host.includes("twitter.com") || host.includes("x.com")) return "Twitter";
  if (host.includes("vimeo.com")) return "Vimeo";
  return "Generic";
}
