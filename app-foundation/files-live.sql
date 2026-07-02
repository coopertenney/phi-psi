-- ============================================================================
-- Phi Kappa Psi — take FILES (Drive) live
-- Run ONCE in the Supabase SQL editor, after the roster is loaded.
--   1. `files` metadata table (the folder tree) + RLS
--   2. a private Storage bucket `chapter-files` for the actual file bytes
--   3. Storage policies so signed-in members can read/upload
-- After this, folders + uploads in the app persist. RLS: read = any member
-- (officers-only rows hidden from members) · create/upload/delete = exec.
-- ============================================================================

begin;

-- 1. Metadata table. A flat list; parent_id builds the tree (null = top level).
create table if not exists files (
  id           uuid primary key default gen_random_uuid(),
  chapter_id   uuid not null references chapters (id) on delete cascade,
  parent_id    uuid references files (id) on delete cascade,   -- folder tree
  kind         text not null,                                  -- 'folder' | 'pdf' | ...
  name         text not null,
  audience     text not null default 'all',                    -- 'all' | 'officers'
  owner_id     uuid references memberships (id) on delete set null,
  owner_name   text,                                           -- denormalized for display
  storage_path text,                                           -- null for folders
  size_bytes   bigint,                                         -- null for folders
  created_at   timestamptz not null default now()
);
create index if not exists files_chapter_parent on files (chapter_id, parent_id);

grant select, insert, update, delete on files to authenticated;
alter table files enable row level security;

-- Read: any chapter member; officers-only rows visible only to exec.
drop policy if exists files_read on files;
create policy files_read on files for select using (
  is_chapter_member(chapter_id) and (audience = 'all' or is_chapter_exec(chapter_id))
);
-- Create / edit / delete: exec only.
drop policy if exists files_write on files;
create policy files_write on files for all
  using (is_chapter_exec(chapter_id)) with check (is_chapter_exec(chapter_id));

-- 2. Private Storage bucket for the bytes.
insert into storage.buckets (id, name, public)
  values ('chapter-files', 'chapter-files', false)
  on conflict (id) do nothing;

-- 3. Storage object policies — any signed-in member (all logins are chapter
--    members) may read/upload/delete objects in this bucket. Listing is gated by
--    the files table above; paths are opaque UUIDs.
drop policy if exists "chapter-files read"   on storage.objects;
drop policy if exists "chapter-files write"  on storage.objects;
drop policy if exists "chapter-files delete" on storage.objects;
create policy "chapter-files read"   on storage.objects for select
  using (bucket_id = 'chapter-files' and auth.role() = 'authenticated');
create policy "chapter-files write"  on storage.objects for insert
  with check (bucket_id = 'chapter-files' and auth.role() = 'authenticated');
create policy "chapter-files delete" on storage.objects for delete
  using (bucket_id = 'chapter-files' and auth.role() = 'authenticated');

commit;

-- Verify: 0 files (clean slate), and the bucket exists.
select count(*) as files_now from files;
select id, public from storage.buckets where id = 'chapter-files';
