import type { NextFunction, Request, Response } from "express";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "UNSUPPORTED_DOMAIN"
  | "UNSUPPORTED_URL"
  | "PRIVATE_OR_RESTRICTED"
  | "DRM_PROTECTED"
  | "PLATFORM_BLOCKED"
  | "UNAVAILABLE"
  | "TOO_LARGE"
  | "TOO_LONG"
  | "TOO_MANY_ACTIVE_JOBS"
  | "GUEST_LIMIT_REACHED"
  | "ABUSE_LIMITED"
  | "DATABASE_UNAVAILABLE"
  | "JOB_NOT_FOUND"
  | "JOB_NOT_READY"
  | "JOB_CANCELLED"
  | "DOWNLOAD_FAILED"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  code: ErrorCode;
  statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function sendError(res: Response, error: AppError) {
  res.status(error.statusCode).json({
    error: {
      code: error.code,
      message: error.message,
    },
  });
}

export function asyncHandler<TReq extends Request = Request>(
  handler: (req: TReq, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: TReq, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

export function mapYtDlpError(stderr: string): AppError {
  const text = stderr.toLowerCase();
  if (isPlatformBlockingRequest(text)) {
    return new AppError(
      "PLATFORM_BLOCKED",
      "The source platform is blocking requests from this server right now. This often happens on hosted servers when the platform asks automated tools to confirm they are not a bot. Try again later or check the backend deployment.",
      429,
    );
  }
  if (text.includes("drm") || text.includes("protected")) {
    return new AppError("DRM_PROTECTED", "This media appears to be DRM-protected or restricted and cannot be processed.", 422);
  }
  if (
    text.includes("private") ||
    text.includes("login") ||
    text.includes("sign in") ||
    text.includes("cookies") ||
    text.includes("authentication")
  ) {
    return new AppError("PRIVATE_OR_RESTRICTED", "This media is private, login-protected, or restricted. Only public authorized URLs are supported.", 422);
  }
  if (text.includes("unavailable") || text.includes("removed") || text.includes("not found")) {
    return new AppError("UNAVAILABLE", "This media is unavailable or could not be found.", 404);
  }
  if (text.includes("unsupported url") || text.includes("no suitable extractor")) {
    return new AppError("UNSUPPORTED_URL", "This URL is not supported by the downloader.", 422);
  }
  return new AppError("DOWNLOAD_FAILED", "The media could not be processed. Confirm it is public and you are authorized to download it.", 422);
}

export function sanitizeYtDlpStderr(stderr: string) {
  return stderr
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function isPlatformBlockingRequest(text: string) {
  return (
    text.includes("not a bot") ||
    text.includes("unusual traffic") ||
    text.includes("too many requests") ||
    text.includes("http error 429") ||
    text.includes("429: too many requests") ||
    text.includes("request blocked") ||
    text.includes("blocked by") ||
    (text.includes("sign in") && text.includes("bot")) ||
    (text.includes("confirm") && text.includes("bot"))
  );
}
