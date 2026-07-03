-- ============================================================================
-- Phi Kappa Psi — profile pictures
-- Run ONCE (idempotent). Adds member profile photos:
--   1. profiles.avatar_url (public URL of the uploaded image, nullable)
--   2. exposes it on member_standings so the roster/topbar can read it
--   3. a public 'avatars' storage bucket + RLS: anyone in the app can view,
--      but a member may only write files under their OWN auth-uid folder
--   4. set_my_avatar(url) — a SECURITY DEFINER RPC so a member can set only
--      their own avatar_url without a broad UPDATE grant on profiles
-- ============================================================================

begin;

-- 1. Column.
alter table profiles add column if not exists avatar_url text;

-- 2. Re-expose member_standings with avatar_url appended (append-only keeps the
--    create-or-replace legal). Mirrors points-approval.sql (approved-only points).
create or replace view member_standings
  with (security_invoker = on) as
select
  m.id              as membership_id,
  m.chapter_id,
  p.full_name,
  m.position,
  m.status,
  m.class_year,
  m.committee,
  coalesce(pts.total_points, 0)   as points,
  coalesce(att.attendance_pct, 0) as attendance_pct,
  p.avatar_url
from memberships m
join profiles p on p.id = m.profile_id
left join (
  select membership_id, sum(points) as total_points
  from points_entries where status = 'approved' group by membership_id
) pts on pts.membership_id = m.id
left join (
  select a.membership_id,
         round(100.0 * count(*) filter (where a.state = 'present') / nullif(count(*),0)) as attendance_pct
  from attendance a group by a.membership_id
) att on att.membership_id = m.id;

-- 3. Public avatars bucket + storage RLS.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists avatars_read   on storage.objects;
drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;
-- Read: anyone (bucket is public; avatars aren't sensitive).
create policy avatars_read on storage.objects for select
  using (bucket_id = 'avatars');
-- Write/replace/remove: only within your own uid-named folder (avatars/<uid>/…).
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Scoped setter so a member can update only their own avatar_url.
create or replace function set_my_avatar(p_url text)
returns void language sql security definer
set search_path = public as $$
  update profiles set avatar_url = p_url where auth_user_id = auth.uid();
$$;
grant execute on function set_my_avatar(text) to authenticated;

commit;

-- Verify.
select count(*) as profiles_with_avatar from profiles where avatar_url is not null;
