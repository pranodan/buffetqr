alter table public.participants
  add column if not exists dinner_eligible boolean not null default true,
  add column if not exists dinner_redeemed boolean not null default false,
  add column if not exists dinner_redeemed_at timestamptz,
  add column if not exists dinner_scan_reset_at timestamptz,
  add column if not exists dinner_scan_generation uuid;

alter table public.redemptions
  drop constraint if exists redemptions_session_check;

alter table public.redemptions
  add constraint redemptions_session_check
  check (session in ('day1', 'day2', 'dinner'));

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
          when 'dinner' then p.dinner_scan_generation is not distinct from public.redemptions.scan_generation
          else false
        end
    )
  );

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
  if p_session is null or p_session not in ('day1', 'day2', 'dinner') then
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
  elsif p_session = 'day2' then
    update public.participants
    set day2_redeemed = false,
        day2_redeemed_at = null,
        day2_scan_reset_at = v_reset_at,
        day2_scan_generation = p_generation,
        last_modified = v_reset_at
    where participant_id = p_participant_id;
  else
    update public.participants
    set dinner_redeemed = false,
        dinner_redeemed_at = null,
        dinner_scan_reset_at = v_reset_at,
        dinner_scan_generation = p_generation,
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
