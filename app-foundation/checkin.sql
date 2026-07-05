-- ============================================================================
-- Phi Kappa Psi — rotating room-code check-in (2026-07-05)
-- Run ONCE (idempotent). Lets members self-check-in to a chapter meeting by
-- typing a 6-digit code that rotates every 30s on the exec's screen.
--
-- Security model (mirrors set_my_avatar): attendance stays exec-only at the RLS
-- layer; the ONLY member self-write path is the SECURITY DEFINER `self_check_in_code`
-- RPC, which (a) derives the caller's membership from auth.uid() — never a
-- parameter, so A can't check in B — (b) requires the meeting's check-in to be
-- open, and (c) verifies the code server-side. The code is derived from a
-- per-meeting secret + 30s time step, so exec display and server verification
-- agree without the secret ever reaching a member.
-- ============================================================================

begin;

-- 1. Per-meeting check-in state.
alter table meetings add column if not exists checkin_open   boolean not null default false;
alter table meetings add column if not exists checkin_secret uuid;   -- set while open; the code seed

-- 2. Deterministic 6-digit code from (secret, time-step). md5 is built-in — no
--    cross-language hashing needed since only the server ever computes it.
create or replace function checkin_code(p_secret uuid, p_step bigint)
returns text language sql immutable as $$
  select lpad(
    (('x' || substr(md5(p_secret::text || ':' || p_step::text), 1, 8))::bit(32)::bigint % 1000000)::text,
    6, '0');
$$;

-- 3. Exec opens/closes check-in. Opening (re)uses a secret; a fresh open after a
--    close gets a new secret so old codes die.
create or replace function set_meeting_checkin(p_meeting uuid, p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_chapter uuid;
begin
  select chapter_id into v_chapter from meetings where id = p_meeting;
  if v_chapter is null then raise exception 'Meeting not found'; end if;
  if not is_chapter_exec(v_chapter) then raise exception 'Only exec can manage check-in'; end if;
  if p_open then
    update meetings set checkin_open = true, checkin_secret = gen_random_uuid() where id = p_meeting;
  else
    update meetings set checkin_open = false, checkin_secret = null where id = p_meeting;
  end if;
end $$;
grant execute on function set_meeting_checkin(uuid, boolean) to authenticated;

-- 4. Current code for the exec's screen (exec-only — members never fetch it,
--    they read it off the projected screen).
create or replace function current_checkin_code(p_meeting uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select chapter_id, checkin_open, checkin_secret into m from meetings where id = p_meeting;
  if m.chapter_id is null then raise exception 'Meeting not found'; end if;
  if not is_chapter_exec(m.chapter_id) then raise exception 'Only exec can view the code'; end if;
  if not m.checkin_open or m.checkin_secret is null then return null; end if;
  return checkin_code(m.checkin_secret, floor(extract(epoch from now()) / 30)::bigint);
end $$;
grant execute on function current_checkin_code(uuid) to authenticated;

-- 5. Member self-check-in. Membership derived from auth.uid(); accepts the
--    current OR previous 30s step (typing lag / clock skew). Marks present.
create or replace function self_check_in_code(p_meeting uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare m record; v_membership uuid; v_step bigint;
begin
  select chapter_id, checkin_open, checkin_secret into m from meetings where id = p_meeting;
  if m.chapter_id is null then raise exception 'Meeting not found'; end if;
  select mem.id into v_membership
    from memberships mem join profiles p on p.id = mem.profile_id
    where p.auth_user_id = auth.uid() and mem.chapter_id = m.chapter_id;
  if v_membership is null then raise exception 'You are not on this chapter roster'; end if;
  if not m.checkin_open or m.checkin_secret is null then raise exception 'Check-in is not open'; end if;
  v_step := floor(extract(epoch from now()) / 30)::bigint;
  if p_code is null
     or (p_code <> checkin_code(m.checkin_secret, v_step)
         and p_code <> checkin_code(m.checkin_secret, v_step - 1)) then
    raise exception 'That code is wrong or expired — check the screen and try again.';
  end if;
  insert into attendance (meeting_id, membership_id, state)
    values (p_meeting, v_membership, 'present')
    on conflict (meeting_id, membership_id) do update set state = 'present';
  return 'present';
end $$;
grant execute on function self_check_in_code(uuid, text) to authenticated;

commit;

-- Verify.
select 'checkin cols' as check,
       (select count(*) from information_schema.columns
        where table_name='meetings' and column_name in ('checkin_open','checkin_secret'))::text as detail;
