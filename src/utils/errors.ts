import type { NextFunction, Request, Response } from "express";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "UNSUPPORTED_DOMAIN"
  | "UNSUPPORTED_URL"
  | "PRIVATE_OR_RESTRICTED"
  | "DRM_PROTECTED"
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
