import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, sendError } from "../utils/errors.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  void next;

  if (err instanceof AppError) {
    sendError(res, err);
    return;
  }

  if (err instanceof ZodError) {
    sendError(res, new AppError("BAD_REQUEST", err.errors[0]?.message ?? "Invalid request body.", 400));
    return;
  }

  sendError(res, new AppError("INTERNAL_ERROR", "An unexpected server error occurred.", 500));
};
