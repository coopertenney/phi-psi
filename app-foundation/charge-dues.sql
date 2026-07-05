-- ───────────────────────────────────────────────────────────────────────────
-- Charge current-term dues to every active member, so the live Finances view
-- shows real numbers instead of $0 across the board.
--
-- Run in the Supabase SQL editor. Idempotent (re-running won't double-charge)
-- and reversible (see the UNDO block at the bottom).
--
-- Pre-set to a small $5 TEST charge (real Spring dues are $300, Fall/Winter
-- $537). Bump `v_amount` to 30000 when you want the real Spring figure.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  v_chapter uuid;
  v_term    uuid;
  v_amount  int := 500;     -- ← $5.00 test charge (real Spring dues are $300). Keep it small while testing.
begin
  select id into v_chapter from chapters limit 1;

  -- Ensure there's a current term carrying the dues amount.
  select id into v_term from terms where chapter_id = v_chapter and is_current limit 1;
  if v_term is null then
    insert into terms (chapter_id, name, dues_cents, starts_on, ends_on, is_current)
    values (v_chapter, 'Spring Term 2026', v_amount, '2026-04-01', '2026-06-15', true)
    returning id into v_term;
  else
    update terms set dues_cents = v_amount where id = v_term;
  end if;

  -- Charge every active member for this term, skipping anyone already charged
  -- for it (so this is safe to re-run).
  insert into dues_charges (membership_id, term_id, amount_cents, description)
  select m.id, v_term, v_amount, 'Spring Term 2026 dues'
  from memberships m
  where m.chapter_id = v_chapter
    and m.status <> 'inactive'
    and not exists (
      select 1 from dues_charges d
      where d.membership_id = m.id and d.term_id = v_term
    );
end $$;

-- Verify — expect charged_members ≈ 90, total = 90 × your amount.
select count(*) as charged_members, sum(amount_cents) / 100.0 as total_charged_dollars
from dues_charges;


-- ───────────────────────────────────────────────────────────────────────────
-- UNDO (run this block on its own to wipe the test charges + any test payments
-- for the current term and return the Finances screen to the $0 empty state).
-- The Stripe webhook writes payments with membership_id but no dues_charge_id,
-- so match test payments by the members charged this term, not by charge id:
--
--   delete from payments where membership_id in (
--     select d.membership_id from dues_charges d
--     join terms t on t.id = d.term_id where t.is_current);
--   delete from dues_charges where term_id in (select id from terms where is_current);
-- ───────────────────────────────────────────────────────────────────────────
