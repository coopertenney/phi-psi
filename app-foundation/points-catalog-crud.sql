-- ---------------------------------------------------------------------------
-- Points catalog CRUD (Phase 1 of admin-customizable points)
--
-- The catalog (point_items) already carries label / points / kind /
-- discretionary / sort_order, and point_items_cud is already `for all` to exec,
-- so add / edit / reorder need no new schema or policy. The only gap is DELETE:
-- points_entries.item_id is `on delete set null`, so a hard delete makes past
-- ledger rows render as "(deleted item)". We soft-delete instead — an `archived`
-- flag hides an item from the pickers while keeping the join (and history) intact.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

alter table point_items
  add column if not exists archived boolean not null default false;

-- Active-catalog lookups (the Log-points / self-log pickers) skip archived rows.
create index if not exists point_items_active_idx
  on point_items (chapter_id, sort_order) where not archived;
