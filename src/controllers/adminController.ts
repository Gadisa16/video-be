import { asyncHandler } from "../utils/errors.js";
import { selectRows } from "../services/supabase.js";
import { env } from "../config/env.js";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export const getAdminDashboard = asyncHandler(async (_req, res) => {
  const [events, profiles, guests, downloads, feedback] = await Promise.all([
    selectRows<Record<string, any>>("analytics_events", "select=*&order=created_at.desc&limit=5000"),
    selectRows<Record<string, any>>("profiles", "select=*&order=created_at.desc&limit=1000"),
    selectRows<Record<string, any>>("guest_usage", "select=*&order=last_seen_at.desc&limit=1000"),
    selectRows<Record<string, any>>("download_logs", "select=*&order=started_at.desc&limit=5000"),
    selectRows<Record<string, any>>("feedback", "select=*&order=created_at.desc&limit=1000"),
  ]);

  const today = startOfToday();
  const seven = daysAgo(7);
  const thirty = daysAgo(30);
  const completed = downloads.filter((d) => d.status === "completed");
  const failed = downloads.filter((d) => d.status === "failed");
  const startedToday = downloads.filter((d) => new Date(d.started_at) >= today);
  const downloads7d = downloads.filter((d) => new Date(d.started_at) >= seven);
  const downloads30d = downloads.filter((d) => new Date(d.started_at) >= thirty);
  const registeredUserIds = new Set(profiles.map((p) => p.id));
  const guestConverted = new Set(events.filter((e) => e.event_type === "user_registration" && e.guest_id).map((e) => e.guest_id)).size;

  res.json({
    totals: {
      visitors: new Set(events.map((e) => e.user_id || e.guest_id || e.ip_hash)).size,
      guests: guests.length,
      registeredUsers: registeredUserIds.size,
      newUsersToday: profiles.filter((p) => new Date(p.created_at) >= today).length,
      downloadsToday: startedToday.length,
      downloads7d: downloads7d.length,
      downloads30d: downloads30d.length,
      successRate: rate(completed.length, completed.length + failed.length),
      failureRate: rate(failed.length, completed.length + failed.length),
      guestToUserConversionRate: rate(guestConverted, Math.max(guests.length, 1)),
      unreadFeedback: feedback.filter((item) => !item.is_read).length,
    },
    breakdowns: {
      topPlatforms: top(downloads, "platform"),
      topCountries: top(events, "country"),
      devices: top(events, "device_type"),
      browsers: top(events, "browser"),
    },
    charts: {
      dailyTraffic: daily(events, "created_at"),
      downloads: daily(downloads, "started_at"),
    },
    recentEvents: events.slice(0, 30),
    recentUsers: profiles.slice(0, 20),
    suspicious: suspicious(guests, downloads),
    feedback: feedback.slice(0, 200),
  });
});

function rate(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function top(rows: Record<string, any>[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key] || "Unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function daily(rows: Record<string, any>[], key: string) {
  const counts = new Map<string, number>();
  for (let i = 13; i >= 0; i -= 1) {
    counts.set(daysAgo(i).toISOString().slice(0, 10), 0);
  }
  for (const row of rows) {
    const raw = row[key];
    if (!raw) continue;
    const day = new Date(raw).toISOString().slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([date, value]) => ({ date, value }));
}

function suspicious(guests: Record<string, any>[], downloads: Record<string, any>[]) {
  const byIp = top(downloads, "ip_hash").filter((item) => item.value >= env.ABUSE_MAX_DOWNLOADS_PER_IP_DAY);
  const byDevice = top(downloads, "user_agent_hash").filter((item) => item.value >= env.ABUSE_MAX_DOWNLOADS_PER_DEVICE_DAY);
  const guestLimit = guests
    .filter((guest) => Number(guest.completed_downloads ?? 0) >= env.GUEST_DOWNLOAD_LIMIT)
    .slice(0, 20)
    .map((guest) => ({ type: "guest_limit", guest_id: guest.guest_id, value: guest.completed_downloads }));
  return [...guestLimit, ...byIp.map((item) => ({ type: "ip_downloads", ...item })), ...byDevice.map((item) => ({ type: "device_downloads", ...item }))];
}
