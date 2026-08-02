-- PREPARED BUT NOT DEPLOYED.
-- Daily device snapshots only. Never add titles, URLs, or readable session labels.

begin;

create table if not exists public.tracker_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'beta')),
  pro_expires_at timestamptz,
  entitlement_version bigint not null default 1 check (entitlement_version > 0),
  data_generation bigint not null default 1 check (data_generation > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tracker_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 8 and 128),
  generation bigint not null default 1 check (generation > 0),
  device_label text check (device_label is null or char_length(device_label) <= 80),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table if not exists public.tracker_daily_totals (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  generation bigint not null check (generation > 0),
  date_key date not null,
  language_code text not null check (
    char_length(language_code) between 2 and 24 and
    language_code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'
  ),
  source text not null check (char_length(source) between 1 and 40),
  active_seconds bigint not null default 0 check (active_seconds >= 0),
  passive_seconds bigint not null default 0 check (passive_seconds >= 0),
  session_count integer not null default 0 check (session_count >= 0),
  revision bigint not null default 0 check (revision >= 0),
  contract_version integer not null default 1 check (contract_version = 1),
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, generation, date_key, language_code, source),
  foreign key (user_id, device_id) references public.tracker_devices(user_id, device_id) on delete cascade
);

create index if not exists tracker_daily_totals_user_date_idx
  on public.tracker_daily_totals (user_id, generation, date_key desc);
create index if not exists tracker_daily_totals_user_language_date_idx
  on public.tracker_daily_totals (user_id, generation, language_code, date_key desc);

create or replace function public.tracker_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tracker_profiles_updated_at on public.tracker_profiles;
create trigger tracker_profiles_updated_at before update on public.tracker_profiles
for each row execute function public.tracker_set_updated_at();

drop trigger if exists tracker_daily_totals_updated_at on public.tracker_daily_totals;
create trigger tracker_daily_totals_updated_at before update on public.tracker_daily_totals
for each row execute function public.tracker_set_updated_at();

create or replace function public.tracker_create_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tracker_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tracker_auth_user_created on auth.users;
create trigger tracker_auth_user_created after insert on auth.users
for each row execute function public.tracker_create_profile();

alter table public.tracker_profiles enable row level security;
alter table public.tracker_devices enable row level security;
alter table public.tracker_daily_totals enable row level security;
alter table public.tracker_profiles force row level security;
alter table public.tracker_devices force row level security;
alter table public.tracker_daily_totals force row level security;

drop policy if exists tracker_profiles_select_own on public.tracker_profiles;
create policy tracker_profiles_select_own on public.tracker_profiles
for select to authenticated using (auth.uid() = user_id);

drop policy if exists tracker_devices_select_own on public.tracker_devices;
create policy tracker_devices_select_own on public.tracker_devices
for select to authenticated using (auth.uid() = user_id);

drop policy if exists tracker_devices_insert_own on public.tracker_devices;
create policy tracker_devices_insert_own on public.tracker_devices
for insert to authenticated with check (
  auth.uid() = user_id and
  generation = (select data_generation from public.tracker_profiles where user_id = auth.uid())
);

drop policy if exists tracker_devices_update_own on public.tracker_devices;
create policy tracker_devices_update_own on public.tracker_devices
for update to authenticated using (auth.uid() = user_id) with check (
  auth.uid() = user_id and
  generation = (select data_generation from public.tracker_profiles where user_id = auth.uid())
);

drop policy if exists tracker_devices_delete_own on public.tracker_devices;
create policy tracker_devices_delete_own on public.tracker_devices
for delete to authenticated using (auth.uid() = user_id);

drop policy if exists tracker_daily_totals_select_own on public.tracker_daily_totals;
create policy tracker_daily_totals_select_own on public.tracker_daily_totals
for select to authenticated using (
  auth.uid() = user_id and
  generation = (select data_generation from public.tracker_profiles where user_id = auth.uid())
);

drop policy if exists tracker_daily_totals_insert_own on public.tracker_daily_totals;
create policy tracker_daily_totals_insert_own on public.tracker_daily_totals
for insert to authenticated with check (
  auth.uid() = user_id and
  generation = (select data_generation from public.tracker_profiles where user_id = auth.uid()) and
  exists (
    select 1 from public.tracker_devices d
    where d.user_id = auth.uid() and d.device_id = tracker_daily_totals.device_id
      and d.generation = tracker_daily_totals.generation and d.disabled_at is null
  )
);

drop policy if exists tracker_daily_totals_update_own on public.tracker_daily_totals;
create policy tracker_daily_totals_update_own on public.tracker_daily_totals
for update to authenticated using (auth.uid() = user_id) with check (
  auth.uid() = user_id and
  generation = (select data_generation from public.tracker_profiles where user_id = auth.uid()) and
  exists (
    select 1 from public.tracker_devices d
    where d.user_id = auth.uid() and d.device_id = tracker_daily_totals.device_id
      and d.generation = tracker_daily_totals.generation and d.disabled_at is null
  )
);

drop policy if exists tracker_daily_totals_delete_own on public.tracker_daily_totals;
create policy tracker_daily_totals_delete_own on public.tracker_daily_totals
for delete to authenticated using (auth.uid() = user_id);

create or replace function public.tracker_reset_my_data()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_generation bigint;
begin
  update public.tracker_profiles
    set data_generation = data_generation + 1
    where user_id = auth.uid()
    returning data_generation into next_generation;
  if next_generation is null then raise exception 'tracker profile not found'; end if;
  delete from public.tracker_daily_totals where user_id = auth.uid();
  update public.tracker_devices
    set generation = next_generation, disabled_at = null, last_seen_at = now()
    where user_id = auth.uid();
  return next_generation;
end;
$$;

revoke all on public.tracker_profiles from anon, authenticated;
revoke all on public.tracker_devices from anon, authenticated;
revoke all on public.tracker_daily_totals from anon, authenticated;
grant select on public.tracker_profiles to authenticated;
grant select, insert, update, delete on public.tracker_devices to authenticated;
grant select, insert, update, delete on public.tracker_daily_totals to authenticated;
revoke all on function public.tracker_reset_my_data() from public, anon;
grant execute on function public.tracker_reset_my_data() to authenticated;

commit;
