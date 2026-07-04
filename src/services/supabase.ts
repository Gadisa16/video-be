import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

export function hasSupabase() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function requireSupabase() {
  if (!hasSupabase()) {
    throw new AppError("DATABASE_UNAVAILABLE", "Supabase is not configured on the backend.", 503);
  }
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}) {
  requireSupabase();
  const url = `${env.SUPABASE_URL.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AppError("DATABASE_UNAVAILABLE", `Supabase request failed (${res.status}). ${text}`.trim(), 503);
  }

  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export async function selectRows<T>(table: string, query = "select=*") {
  return supabaseFetch<T[]>(`/rest/v1/${table}?${query}`);
}

export async function insertRows<T>(table: string, rows: unknown, onConflict?: string) {
  const conflict = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  return supabaseFetch<T[]>(`/rest/v1/${table}${conflict}`, {
    method: "POST",
    headers: { Prefer: onConflict ? "resolution=merge-duplicates,return=representation" : "return=representation" },
    body: JSON.stringify(rows),
  });
}

export async function updateRows<T>(table: string, query: string, patch: unknown) {
  return supabaseFetch<T[]>(`/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

export async function deleteRows(table: string, query: string) {
  return supabaseFetch<null>(`/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function getAuthUser(accessToken: string) {
  if (!hasSupabase()) return null;
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    id: string;
    email?: string;
    user_metadata?: { avatar_url?: string; picture?: string; name?: string; user_name?: string; preferred_username?: string; username?: string; full_name?: string };
    created_at?: string;
  };
}

