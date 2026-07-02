-- ============================================================================
-- Phi Kappa Psi — add LINK support to Files
-- Run ONCE in the Supabase SQL editor, after files-live.sql.
--
-- Adds a `url` column to the files table so an item can be an external link
-- (kind = 'link') pointing at a Google Drive folder, a Doc/Sheet, or any web
-- URL — instead of an uploaded file in Storage. Links live in the same folder
-- tree as uploads (storage_path stays null for them). `kind` is already a free
-- text column, so 'link' needs no enum change. RLS/grants are inherited from
-- files-live.sql. Idempotent.
-- ============================================================================

alter table files add column if not exists url text;   -- set for kind 'link'; null otherwise

notify pgrst, 'reload schema';
