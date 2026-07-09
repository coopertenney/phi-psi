-- ============================================================================
-- Phi Kappa Psi — add Partiful invite links to socials
-- Run ONCE in the Supabase SQL editor (safe to re-run; idempotent).
-- Adds an optional Partiful URL column to events. The app stores a normalized
-- absolute https URL here (or null); read/write RLS is unchanged (events_read /
-- events_cud from events-live.sql already cover the new column).
-- ============================================================================

alter table events add column if not exists partiful_url text;
