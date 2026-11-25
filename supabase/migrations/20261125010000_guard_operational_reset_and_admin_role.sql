drop policy if exists "admins can update staff" on public.staff;

create policy "admins can update staff"
  on public.staff for update to authenticated
  using (public.current_staff_role() = 'admin')
  with check (
    public.current_staff_role() = 'admin'
    and (
      email <> lower(coalesce(auth.jwt() ->> 'email', ''))
      or role = 'admin'
    )
  );

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

  delete from public.redemptions where transaction_id is not null;
  get diagnostics v_redemptions = row_count;

  delete from public.participants where participant_id is not null;
  get diagnostics v_participants = row_count;

  delete from public.reserve_tokens where token is not null;
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
