-- Optional, consent-based product analytics. Anonymous by design: no
-- user_id, no device_id, no session identifier of any kind, so an event can
-- never be linked back to an account, a device, or another event from the
-- same install. Never add titles, URLs, searches, subtitles, page text, or
-- manual-entry descriptions here - see PRIVACY.md "Optional product
-- analytics" for the exact allowed field list.

begin;

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  target_language text not null check (
    char_length(target_language) between 2 and 24 and
    target_language ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'
  ),
  platform text not null check (char_length(platform) between 1 and 40),
  content_type text not null check (char_length(content_type) between 1 and 40),
  active_seconds bigint not null default 0 check (active_seconds >= 0),
  passive_seconds bigint not null default 0 check (passive_seconds >= 0),
  event_date date not null,
  extension_version text not null check (extension_version ~ '^\d+\.\d+\.\d+$'),
  received_at timestamptz not null default now()
);

-- No indexes on anything resembling an identifier - only what an analyst
-- would actually group by. received_at is enough to prune old rows later
-- without needing a per-event key.
create index if not exists analytics_events_event_date_idx on public.analytics_events (event_date);
create index if not exists analytics_events_received_at_idx on public.analytics_events (received_at);

alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;

-- Write-only for everyone, including the extension itself: insert is all
-- the client ever needs, and not granting select means a leaked anon key
-- can't be used to read other users' events back out.
drop policy if exists analytics_events_insert_anon on public.analytics_events;
create policy analytics_events_insert_anon on public.analytics_events
for insert to anon, authenticated with check (true);

revoke all on public.analytics_events from anon, authenticated;
revoke all on public.analytics_events from public;
grant insert on public.analytics_events to anon, authenticated;
-- The identity column needs its sequence usable by the inserting roles.
grant usage on sequence analytics_events_id_seq to anon, authenticated;

commit;
