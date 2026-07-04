create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  email text not null,
  avatar text,
  created_at timestamptz not null default now()
);

create table if not exists public.guest_usage (
  guest_id text primary key,
  ip_hash text not null,
  user_agent_hash text not null,
  completed_downloads integer not null default 0,
  info_requests integer not null default 0,
  abuse_score integer not null default 0,
  blocked_until timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.user_usage (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ip_hash text,
  user_agent_hash text,
  info_requests integer not null default 0,
  downloads_started integer not null default 0,
  downloads_completed integer not null default 0,
  downloads_failed integer not null default 0,
  downloads_cancelled integer not null default 0,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.download_logs (
  job_id uuid primary key,
  user_id uuid references public.profiles(id) on delete set null,
  guest_id text references public.guest_usage(guest_id) on delete set null,
  ip_hash text,
  user_agent_hash text,
  video_hash text not null,
  video_host text,
  platform text,
  country text,
  device_type text,
  browser text,
  format_id text,
  status text not null check (status in ('started', 'completed', 'failed', 'cancelled')),
  file_size_mb numeric,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid references public.profiles(id) on delete set null,
  guest_id text references public.guest_usage(guest_id) on delete set null,
  ip_hash text,
  user_agent_hash text,
  url_path text,
  video_host text,
  video_hash text,
  platform text,
  country text,
  device_type text,
  browser text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  email text,
  feeling text not null check (feeling in ('Happy', 'Sad', 'Bug Report', 'Feature Request', 'Suggestion', 'Question', 'Other')),
  message text not null,
  is_read boolean not null default false,
  is_resolved boolean not null default false,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_created_at on public.profiles(created_at desc);
create index if not exists idx_guest_usage_hashes on public.guest_usage(ip_hash, user_agent_hash);
create index if not exists idx_user_usage_hashes on public.user_usage(ip_hash, user_agent_hash);
create index if not exists idx_download_logs_started_at on public.download_logs(started_at desc);
create index if not exists idx_download_logs_status on public.download_logs(status);
create index if not exists idx_download_logs_platform_country on public.download_logs(platform, country);
create index if not exists idx_download_logs_hashes on public.download_logs(ip_hash, user_agent_hash);
create index if not exists idx_analytics_events_created_at on public.analytics_events(created_at desc);
create index if not exists idx_analytics_events_type on public.analytics_events(event_type);
create index if not exists idx_analytics_events_platform_country on public.analytics_events(platform, country);
create index if not exists idx_feedback_created_at on public.feedback(created_at desc);
create index if not exists idx_feedback_flags on public.feedback(is_read, is_resolved);
create index if not exists idx_feedback_feeling on public.feedback(feeling);

alter table public.profiles enable row level security;
alter table public.guest_usage enable row level security;
alter table public.user_usage enable row level security;
alter table public.download_logs enable row level security;
alter table public.analytics_events enable row level security;
alter table public.feedback enable row level security;

drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "feedback insert public" on public.feedback;
create policy "feedback insert public" on public.feedback for insert with check (true);
drop policy if exists "feedback select own" on public.feedback;
create policy "feedback select own" on public.feedback for select using (auth.uid() = user_id);

-- Server-side service role bypasses RLS for analytics, usage, admin dashboard, and moderation operations.
