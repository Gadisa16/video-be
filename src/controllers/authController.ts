import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { getContext } from "../middleware/requestContext.js";
import { trackEvent } from "../services/analytics.js";
import { insertRows, selectRows, updateRows } from "../services/supabase.js";
import { AppError, asyncHandler } from "../utils/errors.js";

const completeProfileSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(30, "Username must be 30 characters or less.")
    .regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only."),
});

export const syncAuthProfile = asyncHandler(async (req, res) => {
  const context = getContext(res);
  if (!context.user) throw new AppError("UNAUTHENTICATED", "Sign in is required.", 401);

  const payload: Record<string, unknown> = {
    id: context.user.id,
    email: context.user.email,
    avatar: context.user.avatar,
  };
  if (!context.profile?.username && context.user.username) payload.username = context.user.username;

  let profile = null;
  try {
    const rows = await insertRows("profiles", payload, "id");
    profile = rows[0] ?? null;
  } catch (error) {
    if (!payload.username) throw error;
    const rows = await insertRows("profiles", { id: context.user.id, email: context.user.email, avatar: context.user.avatar }, "id");
    profile = rows[0] ?? null;
  }

  await trackEvent(req, res, context.profile ? "user_login" : "user_registration");
  res.json({ profile });
});

export const completeProfile = asyncHandler(async (_req, res) => {
  const context = getContext(res);
  if (!context.user) throw new AppError("UNAUTHENTICATED", "Sign in is required.", 401);
  const { username } = completeProfileSchema.parse(_req.body);

  const rows = await updateRows("profiles", `id=eq.${context.user.id}`, { username });
  if (!rows[0]) throw new AppError("DATABASE_UNAVAILABLE", "Unable to update your profile.", 503);
  res.json({ profile: rows[0] });
});

export const getMe = asyncHandler(async (_req, res) => {
  const context = getContext(res);
  if (!context.user) {
    res.json({ user: null, profile: null, usage: null });
    return;
  }
  const usage = await selectRows("user_usage", `select=*&user_id=eq.${context.user.id}&limit=1`).catch(() => []);
  res.json({ user: context.user, profile: context.profile, usage: usage[0] ?? null });
});

const adminSessions = new Map<string, number>();
const adminLoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = adminLoginSchema.parse(req.body);
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new AppError("DATABASE_UNAVAILABLE", "Admin credentials are not configured.", 503);
  }
  if (!constantEqual(email, env.ADMIN_EMAIL) || !constantEqual(password, env.ADMIN_PASSWORD)) {
    throw new AppError("UNAUTHENTICATED", "Invalid admin credentials.", 401);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000;
  adminSessions.set(token, expiresAt);
  res.json({ token, expiresAt });
});

export function requireAdmin(req: { headers: { authorization?: string } }, _res: unknown, next: (error?: unknown) => void) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : "";
  const expiresAt = token ? adminSessions.get(token) : undefined;
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) adminSessions.delete(token);
    next(new AppError("FORBIDDEN", "Admin authentication is required.", 403));
    return;
  }
  next();
}

function constantEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
