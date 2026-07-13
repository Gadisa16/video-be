import { env } from "../config/env.js";
import { hasSupabase, insertRows } from "../services/supabase.js";

/**
 * Supabase pauses free-tier projects after ~7 days of inactivity.
 * This job pings Supabase on a schedule so the project is never idle.
 *
 * Each tick inserts a synthetic `analytics_events` row, which:
 *   - counts as real activity for Supabase's inactivity detector, and
 *   - doubles as a heartbeat you can grep for in your dashboard.
 *
 * The job is opt-out via KEEPALIVE_ENABLED=false. When Supabase env vars
 * are missing, the scheduler silently disables itself (nothing to ping).
 */

export type KeepAliveStatus = {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
  totalRuns: number;
  totalFailures: number;
};

const state: {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  nextRunAt: Date | null;
  totalRuns: number;
  totalFailures: number;
} = {
  timer: null,
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  nextRunAt: null,
  totalRuns: 0,
  totalFailures: 0,
};

function computeIntervalMs(): number {
  const minutes = env.KEEPALIVE_INTERVAL_HOURS * 60 + env.KEEPALIVE_INTERVAL_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 24 * 60 * 60 * 1000; // safety: default to 24h
  }
  return minutes * 60 * 1000;
}

function pickJitterMs(): number {
  const jitter = env.KEEPALIVE_JITTER_MINUTES;
  if (!jitter || jitter <= 0) return 0;
  // Symmetric jitter in [-jitter, +jitter] minutes, so multiple replicas
  // don't all hit Supabase at the exact same second.
  return (Math.random() * 2 - 1) * jitter * 60 * 1000;
}

export async function pingSupabase(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabase()) {
    return { ok: false, error: "Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)." };
  }
  const startedAt = Date.now();
  try {
    await insertRows(
      "analytics_events",
      {
        event_type: "keepalive_ping",
        url_path: "/_keepalive",
        metadata: {
          source: "backend-keepalive",
          node_env: env.NODE_ENV,
          started_at: new Date(startedAt).toISOString(),
        },
      },
      // No natural unique key on analytics_events, so this is just an insert.
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function tick(): Promise<void> {
  if (state.running) return; // never overlap with ourselves
  state.running = true;
  state.lastRunAt = new Date();
  state.totalRuns += 1;
  try {
    const result = await pingSupabase();
    if (result.ok) {
      state.lastSuccessAt = new Date();
      state.lastError = null;
      // eslint-disable-next-line no-console
      console.log(`[keepalive] supabase ping ok at ${state.lastSuccessAt.toISOString()}`);
    } else {
      state.lastError = result.error;
      state.totalFailures += 1;
      // eslint-disable-next-line no-console
      console.warn(`[keepalive] supabase ping failed: ${result.error}`);
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    state.totalFailures += 1;
    // eslint-disable-next-line no-console
    console.warn(`[keepalive] unexpected error: ${state.lastError}`);
  } finally {
    state.running = false;
    scheduleNext();
  }
}

function scheduleNext(): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (!env.KEEPALIVE_ENABLED || !hasSupabase()) return;
  const base = computeIntervalMs();
  const jitter = pickJitterMs();
  const next = Math.max(60_000, base + jitter); // never schedule faster than 1 minute
  state.nextRunAt = new Date(Date.now() + next);
  state.timer = setTimeout(() => {
    void tick();
  }, next);
  // Don't keep the event loop alive just for the keep-alive tick.
  state.timer.unref?.();
}

export function startKeepAlive(): void {
  if (state.timer) return; // already running
  if (!env.KEEPALIVE_ENABLED) {
    // eslint-disable-next-line no-console
    console.log("[keepalive] disabled via KEEPALIVE_ENABLED=false");
    return;
  }
  if (!hasSupabase()) {
    // eslint-disable-next-line no-console
    console.log("[keepalive] no Supabase credentials configured; scheduler is dormant");
    return;
  }
  if (env.KEEPALIVE_RUN_ON_BOOT) {
    // Fire and forget — first tick happens immediately so an idle project
    // gets touched on deploy/restart without waiting a full interval.
    void tick();
  } else {
    scheduleNext();
  }
  // eslint-disable-next-line no-console
  console.log(
    `[keepalive] started — interval=${env.KEEPALIVE_INTERVAL_HOURS}h${env.KEEPALIVE_INTERVAL_MINUTES}m, ` +
      `jitter=±${env.KEEPALIVE_JITTER_MINUTES}m, runOnBoot=${env.KEEPALIVE_RUN_ON_BOOT}`,
  );
}

export function stopKeepAlive(): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

export function getKeepAliveStatus(): KeepAliveStatus {
  const intervalMs = computeIntervalMs();
  return {
    enabled: env.KEEPALIVE_ENABLED,
    configured: hasSupabase(),
    running: state.timer !== null,
    intervalMs,
    lastRunAt: state.lastRunAt ? state.lastRunAt.toISOString() : null,
    lastSuccessAt: state.lastSuccessAt ? state.lastSuccessAt.toISOString() : null,
    lastError: state.lastError,
    nextRunAt: state.nextRunAt ? state.nextRunAt.toISOString() : null,
    totalRuns: state.totalRuns,
    totalFailures: state.totalFailures,
  };
}