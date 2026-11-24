alter table public.participants
  add column if not exists day1_scan_reset_at timestamptz,
  add column if not exists day2_scan_reset_at timestamptz,
  add column if not exists day1_scan_generation uuid,
  add column if not exists day2_scan_generation uuid;

alter table public.redemptions
  add column if not exists scan_generation uuid;

drop policy if exists "admins can read reserve tokens" on public.reserve_tokens;
drop policy if exists "admins and registration can read reserve tokens" on public.reserve_tokens;

create policy "admins and registration can read reserve tokens"
  on public.reserve_tokens for select to authenticated
  using (public.current_staff_role() in ('admin', 'registration'));

drop policy if exists "staff can add redemptions" on public.redemptions;
drop policy if exists "staff can add redemptions after the last scan reset" on public.redemptions;

create policy "staff can add redemptions after the last scan reset"
  on public.redemptions for insert to authenticated
  with check (
    public.current_staff_role() in ('admin', 'registration', 'buffet')
    and exists (
      select 1
      from public.participants p
      where p.participant_id = public.redemptions.participant_id
        and case public.redemptions.session
          when 'day1' then p.day1_scan_generation is not distinct from public.redemptions.scan_generation
          when 'day2' then p.day2_scan_generation is not distinct from public.redemptions.scan_generation
          else false
        end
    )
  );

create or replace function public.assign_reserve_token(p_token text, p_participant_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_staff_role();
  v_assigned_to text;
begin
  if v_role is null or v_role not in ('admin', 'registration') then
    raise exception 'Not authorized to assign reserve passes' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.participants where participant_id = p_participant_id
  ) then
    raise exception 'Participant not found' using errcode = 'P0002';
  end if;

  update public.reserve_tokens
  set status = 'ASSIGNED',
      assigned_participant_id = p_participant_id,
      assigned_at = now(),
      assigned_by = lower(coalesce(auth.jwt() ->> 'email', ''))
  where token = p_token and status = 'UNUSED';

  if found then
    return;
  end if;

  select assigned_participant_id
    into v_assigned_to
  from public.reserve_tokens
  where token = p_token and status = 'ASSIGNED';

  if v_assigned_to = p_participant_id then
    return;
  end if;

  raise exception 'Reserve pass is missing or already assigned' using errcode = '23505';
end;
$$;

revoke all on function public.assign_reserve_token(text, text) from public, anon;
grant execute on function public.assign_reserve_token(text, text) to authenticated;

create or replace function public.reset_participant_scan(
  p_participant_id text,
  p_session text,
  p_generation uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reset_at timestamptz := clock_timestamp();
begin
  if public.current_staff_role() is distinct from 'admin' then
    raise exception 'Only a super admin can reset a participant scan' using errcode = '42501';
  end if;
  if p_session is null or p_session not in ('day1', 'day2') then
    raise exception 'Invalid buffet session' using errcode = '22023';
  end if;
  if p_generation is null then
    raise exception 'Scan generation is required' using errcode = '22023';
  end if;

  if p_session = 'day1' then
    update public.participants
    set day1_redeemed = false,
        day1_redeemed_at = null,
        day1_scan_reset_at = v_reset_at,
    day1_scan_generation = p_generation,
        last_modified = v_reset_at
    where participant_id = p_participant_id;
  else
    update public.participants
    set day2_redeemed = false,
        day2_redeemed_at = null,
        day2_scan_reset_at = v_reset_at,
    day2_scan_generation = p_generation,
        last_modified = v_reset_at
    where participant_id = p_participant_id;
  end if;

  if not found then
    raise exception 'Participant not found' using errcode = 'P0002';
  end if;

  delete from public.redemptions
  where participant_id = p_participant_id and session = p_session;
end;
$$;

revoke all on function public.reset_participant_scan(text, text, uuid) from public, anon;
grant execute on function public.reset_participant_scan(text, text, uuid) to authenticated;

create or replace function public.reset_operational_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_reset_at timestamptz := clock_timestamp();
  v_amr jsonb := coalesce(auth.jwt() -> 'amr', '[]'::jsonb);
  v_participants bigint;
  v_redemptions bigint;
  v_reserve_tokens bigint;
  v_event_id text := 'ev_' || gen_random_uuid()::text;
begin
  if public.current_staff_role() is distinct from 'admin' then
    raise exception 'Only a super admin can reset operational data' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(v_amr) = 'array' then v_amr else '[]'::jsonb end
    ) as method
    where method ->> 'method' = 'password'
      and case
        when coalesce(method ->> 'timestamp', '') ~ '^[0-9]+$'
          then (method ->> 'timestamp')::bigint
        else 0
      end >= floor(extract(epoch from v_reset_at) - 300)
  ) then
    raise exception 'Confirm your password again before resetting data' using errcode = '42501';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' and exists (
    select 1
    from auth.mfa_factors
    where user_id = auth.uid() and status = 'verified'
  ) then
    raise exception 'Complete multi-factor authentication before resetting data' using errcode = '42501';
  end if;

  delete from public.redemptions;
  get diagnostics v_redemptions = row_count;

  delete from public.participants;
  get diagnostics v_participants = row_count;

  delete from public.reserve_tokens;
  get diagnostics v_reserve_tokens = row_count;

  insert into public.app_settings (key, value, updated_by, updated_at)
  values (
    'operational_reset_at',
    to_char(v_reset_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    v_email,
    v_reset_at
  )
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_logs (
    event_id, event_type, actor, timestamp, outcome, detail
  )
  values (
    v_event_id,
    'OPERATIONAL_DATA_RESET',
    v_email,
    v_reset_at,
    'SUCCESS',
    format(
      'Deleted %s participants, %s redemptions, and %s reserve passes',
      v_participants, v_redemptions, v_reserve_tokens
    )
  );

  return jsonb_build_object(
    'reset_at', to_char(v_reset_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'event_id', v_event_id,
    'actor', v_email,
    'participants', v_participants,
    'redemptions', v_redemptions,
    'reserve_tokens', v_reserve_tokens
  );
end;
$$;

revoke all on function public.reset_operational_data() from public, anon;
grant execute on function public.reset_operational_data() to authenticated;
