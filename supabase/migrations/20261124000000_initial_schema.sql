create table public.staff (
  email text primary key check (email = lower(btrim(email))),
  display_name text not null default '',
  role text not null check (role in ('admin', 'registration', 'buffet')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participants (
  participant_id text primary key,
  full_name text not null,
  category text not null default 'Participant',
  institution text not null default '',
  designation text not null default '',
  email text not null default '',
  phone text not null default '',
  qr_token text not null unique,
  day1_eligible boolean not null default true,
  day2_eligible boolean not null default true,
  day1_redeemed boolean not null default false,
  day2_redeemed boolean not null default false,
  day1_redeemed_at timestamptz,
  day2_redeemed_at timestamptz,
  registration_source text not null default 'PRE_REGISTERED'
    check (registration_source in ('PRE_REGISTERED', 'SPOT_REGISTERED', 'MANUALLY_ADDED')),
  registration_timestamp timestamptz not null default now(),
  registered_by text not null default '',
  token_status text not null default 'ACTIVE' check (token_status in ('ACTIVE', 'REVOKED')),
  last_modified timestamptz not null default now(),
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.redemptions (
  transaction_id text primary key,
  participant_id text not null,
  participant_name text not null default '',
  qr_token text not null default '',
  session text not null check (session in ('day1', 'day2')),
  device_id text not null default '',
  operator text not null default '',
  timestamp timestamptz not null default now(),
  type text not null default 'SCAN' check (type in ('SCAN', 'MANUAL_EXCEPTION')),
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (participant_id, session)
);

create table public.audit_logs (
  event_id text primary key,
  event_type text not null,
  participant_id text not null default '',
  device_id text not null default '',
  actor text not null default '',
  timestamp timestamptz not null default now(),
  session text not null default '',
  outcome text not null default '',
  reason text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table public.reserve_tokens (
  token text primary key,
  status text not null check (status in ('UNUSED', 'ASSIGNED', 'REVOKED')),
  batch text not null default '',
  assigned_participant_id text not null default '',
  assigned_at timestamptz,
  assigned_by text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table public.devices (
  device_id text primary key,
  name text not null default '',
  role text not null default 'registration' check (role in ('admin', 'registration', 'buffet')),
  operator text not null default '',
  last_pull_at timestamptz,
  last_push_at timestamptz,
  participants_count integer not null default 0 check (participants_count >= 0),
  app_version text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role
  from public.staff
  where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

revoke all on function public.current_staff_role() from public, anon;
grant execute on function public.current_staff_role() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger staff_set_updated_at before update on public.staff
for each row execute function public.set_updated_at();
create trigger participants_set_updated_at before update on public.participants
for each row execute function public.set_updated_at();
create trigger reserve_tokens_set_updated_at before update on public.reserve_tokens
for each row execute function public.set_updated_at();
create trigger app_settings_set_updated_at before update on public.app_settings
for each row execute function public.set_updated_at();
create trigger devices_set_updated_at before update on public.devices
for each row execute function public.set_updated_at();

alter table public.staff enable row level security;
alter table public.participants enable row level security;
alter table public.redemptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.reserve_tokens enable row level security;
alter table public.app_settings enable row level security;
alter table public.devices enable row level security;

grant select, insert, update, delete on public.staff to authenticated;
grant select, insert, update, delete on public.participants to authenticated;
grant select, insert, delete on public.redemptions to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant select, insert, update, delete on public.reserve_tokens to authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;
grant select, insert, update, delete on public.devices to authenticated;

create policy "staff can read their own role or admins can read all"
  on public.staff for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.current_staff_role() = 'admin');
create policy "admins can add staff"
  on public.staff for insert to authenticated
  with check (public.current_staff_role() = 'admin');
create policy "admins can update staff"
  on public.staff for update to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');
create policy "admins can remove staff"
  on public.staff for delete to authenticated
  using (public.current_staff_role() = 'admin');

create policy "staff can read participants"
  on public.participants for select to authenticated
  using (public.current_staff_role() in ('admin', 'registration', 'buffet'));
create policy "staff can add participants"
  on public.participants for insert to authenticated
  with check (public.current_staff_role() in ('admin', 'registration', 'buffet'));
create policy "staff can update participants"
  on public.participants for update to authenticated
  using (public.current_staff_role() in ('admin', 'registration', 'buffet'))
  with check (public.current_staff_role() in ('admin', 'registration', 'buffet'));
create policy "admins can remove participants"
  on public.participants for delete to authenticated
  using (public.current_staff_role() = 'admin');

create policy "staff can read redemptions"
  on public.redemptions for select to authenticated
  using (public.current_staff_role() in ('admin', 'registration', 'buffet'));
create policy "staff can add redemptions"
  on public.redemptions for insert to authenticated
  with check (public.current_staff_role() in ('admin', 'registration', 'buffet'));

create policy "admins can read audit logs"
  on public.audit_logs for select to authenticated
  using (public.current_staff_role() = 'admin');
create policy "staff can add audit logs"
  on public.audit_logs for insert to authenticated
  with check (public.current_staff_role() in ('admin', 'registration', 'buffet'));

create policy "admins can read reserve tokens"
  on public.reserve_tokens for select to authenticated
  using (public.current_staff_role() = 'admin');
create policy "admins can add reserve tokens"
  on public.reserve_tokens for insert to authenticated
  with check (public.current_staff_role() = 'admin');
create policy "admins can update reserve tokens"
  on public.reserve_tokens for update to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');
create policy "admins can remove reserve tokens"
  on public.reserve_tokens for delete to authenticated
  using (public.current_staff_role() = 'admin');

create policy "staff can read app settings"
  on public.app_settings for select to authenticated
  using (public.current_staff_role() in ('admin', 'registration', 'buffet'));
create policy "admins can add app settings"
  on public.app_settings for insert to authenticated
  with check (public.current_staff_role() = 'admin');
create policy "admins can update app settings"
  on public.app_settings for update to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');
create policy "admins can remove app settings"
  on public.app_settings for delete to authenticated
  using (public.current_staff_role() = 'admin');

create policy "staff can read devices"
  on public.devices for select to authenticated
  using (public.current_staff_role() in ('admin', 'registration', 'buffet'));
create policy "staff can add devices"
  on public.devices for insert to authenticated
  with check (public.current_staff_role() in ('admin', 'registration', 'buffet'));
create policy "staff can update devices"
  on public.devices for update to authenticated
  using (public.current_staff_role() in ('admin', 'registration', 'buffet'))
  with check (public.current_staff_role() in ('admin', 'registration', 'buffet'));
create policy "admins can remove devices"
  on public.devices for delete to authenticated
  using (public.current_staff_role() = 'admin');
