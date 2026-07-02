-- ============================================================================
-- Phi Kappa Psi — self-serve login auto-link
-- Run ONCE in the Supabase SQL editor. Safe to re-run (create or replace).
--
-- WHAT IT DOES: when a member signs up and logs in, the app calls this function.
-- It links their new login to the roster row whose email matches THEIR OWN
-- verified email — and only if that row isn't already claimed.
--
-- WHY IT'S SAFE: it runs security-definer (so it can update `profiles` past
-- RLS), but the WHERE clause pins it to `auth.email()` — the email baked into
-- the caller's own login token. A user can therefore only ever claim the record
-- for the address they actually control, and can't hijack one already linked.
-- ============================================================================

create or replace function public.link_current_user()
returns uuid                       -- the linked profile id, or null if no match
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_id uuid;
begin
  -- Claim my roster row by email, but only if it isn't already claimed.
  update profiles p
  set auth_user_id = auth.uid()
  where lower(p.email) = lower(auth.email())
    and p.auth_user_id is null;

  -- Return the row now linked to me — whether that just happened or was already
  -- true (returning user). Null only if my email genuinely isn't on the roster.
  select p.id into linked_id
  from profiles p
  where p.auth_user_id = auth.uid()
  limit 1;

  return linked_id;
end;
$$;

-- Only logged-in users may call it (anon cannot).
revoke all on function public.link_current_user() from public, anon;
grant execute on function public.link_current_user() to authenticated;
