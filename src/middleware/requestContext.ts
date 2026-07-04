import type { NextFunction, Request, Response } from "express";
import { getAuthUser, selectRows } from "../services/supabase.js";
import { getClientIp, getCountry, hashSensitive, parseUserAgent } from "../utils/privacy.js";

type Profile = {
  id: string;
  username: string | null;
  email: string;
  avatar: string | null;
  created_at: string;
};

export type RequestContext = {
  guestId: string | null;
  ipHash: string;
  userAgentHash: string;
  country: string;
  deviceType: string;
  browser: string;
  user: { id: string; email: string; avatar: string | null; username: string | null } | null;
  profile: Profile | null;
};

export async function attachRequestContext(req: Request, res: Response, next: NextFunction) {
  try {
    const userAgent = req.headers["user-agent"];
    const parsedUa = parseUserAgent(typeof userAgent === "string" ? userAgent : undefined);
    const token = parseBearerToken(req.headers.authorization);
    const authUser = token ? await getAuthUser(token) : null;
    const profile = authUser ? await loadProfile(authUser.id) : null;
    const metadata = authUser?.user_metadata ?? {};

    res.locals.context = {
      guestId: sanitizeGuestId(req.headers["x-guest-id"]),
      ipHash: hashSensitive(getClientIp(req)),
      userAgentHash: hashSensitive(typeof userAgent === "string" ? userAgent : "unknown"),
      country: getCountry(req),
      deviceType: parsedUa.deviceType,
      browser: parsedUa.browser,
      user: authUser
        ? {
            id: authUser.id,
            email: authUser.email ?? "",
            avatar: metadata.avatar_url ?? metadata.picture ?? null,
            username: sanitizeUsername(metadata.username ?? metadata.user_name ?? metadata.preferred_username),
          }
        : null,
      profile,
    } satisfies RequestContext;
    next();
  } catch (error) {
    next(error);
  }
}

export function getContext(res: Response): RequestContext {
  return res.locals.context as RequestContext;
}

function parseBearerToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function sanitizeGuestId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(trimmed) ? trimmed : null;
}

function sanitizeUsername(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_]{3,30}$/.test(trimmed) ? trimmed : null;
}

async function loadProfile(userId: string) {
  const rows = await selectRows<Profile>("profiles", `select=*&id=eq.${encodeURIComponent(userId)}&limit=1`).catch(() => []);
  return rows[0] ?? null;
}
