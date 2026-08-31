-- Cal Beta Dues Desk — schema for the app's own Supabase project.
-- Money is integer cents everywhere. Raw facts only: no stored balances, no
-- "paid" flag on a member. A balance is charges − opportunity fund − payments,
-- derived at read time (lib/ledger.ts and the member_balances view below).
--
-- Auth model, same as ../points-app: any authenticated user IS exec. Accounts
-- are created by hand in the dashboard; members never log in. Everything below
-- is therefore "authenticated = full access, anon = nothing", with one
-- deliberate exception: the public read-only balances view.

create extension if not exists pgcrypto;

/* ─────────────────────────── roster ─────────────────────────── */

create table if not exists members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- Learned bank-name variants, denormalized from name_aliases for fast reads.
  aka        text[] not null default '{}',
  photo_url  text,
  -- On financial aid. A flag and nothing more: the charge stands, the balance
  -- stands, the money math is untouched. All it does is keep them off the
  -- follow-up list, so nobody chases a brother the chapter already knows about.
  -- Reducing what someone owes is a separate deliberate act — an adjustments row
  -- — so "collected" never quietly changes meaning.
  financial_aid boolean not null default false,
  created_at timestamptz not null default now()
);

/* ─────────────────────────── terms and charges ─────────────────────────── */

create table if not exists terms (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  is_current boolean not null default false,
  -- Null until an exec sets the term's dues amount. The matcher treats a null
  -- dues amount as "no amount signal available" rather than guessing.
  dues_cents integer check (dues_cents is null or dues_cents > 0),
  -- First day of the term. Orders terms honestly (creation order is not the same
  -- thing) and gives the bank connection a sensible date to start reading from.
  starts_on  date,
  -- Whether the bank sync may apply its own certain matches. Per-term, because
  -- that's the right granularity for widening it after watching a term of real
  -- data; persisted rather than a checkbox, because cron runs unattended.
  auto_apply boolean not null default true,
  created_at timestamptz not null default now()
);

-- At most one current term.
create unique index if not exists terms_one_current on terms (is_current) where is_current;

create table if not exists dues_charges (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members(id) on delete cascade,
  term_id      uuid not null references terms(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  description  text not null default '',
  created_at   timestamptz not null default now(),
  unique (member_id, term_id)
);

-- The chapter's opportunity fund covering dues for a brother on financial aid.
-- Deliberately not a payment: it reduces what's owed without inflating
-- "collected", which must keep meaning "money actually in the account".
-- A brother the chapter decided not to charge this term — studying abroad.
-- Per term, because being abroad in Winter says nothing about Spring. It is the
-- ABSENCE of a charge rather than a charge that was waived: he reads as 'exempt'
-- instead of 'paid', and never appears as money owed.
create table if not exists exemptions (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references members(id) on delete cascade,
  term_id    uuid not null references terms(id) on delete cascade,
  reason     text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (member_id, term_id)
);

create table if not exists adjustments (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members(id) on delete cascade,
  term_id      uuid not null references terms(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  kind         text not null default 'opp_fund' check (kind in ('opp_fund')),
  reason       text not null default '',
  created_by   text not null default '',
  created_at   timestamptz not null default now()
);

/* ─────────────────────────── the bank feed ─────────────────────────── */

create table if not exists bank_txns (
  id              uuid primary key default gen_random_uuid(),
  -- The aggregator's transaction id. Unique so a re-sync of an overlapping
  -- window can never insert the same credit twice. Null for hand-entered rows.
  provider_txn_id text unique,
  -- Set on a posted row: the pending txn id it replaced. Two jobs — it proves a
  -- promotion happened, and it makes the feed's later `removed` for that pending
  -- id a recognized no-op instead of an erasure that reverses a real payment.
  pending_txn_id  text,
  account_id      text,
  posted_on       date not null,
  -- Negative for a returned/reversed credit.
  amount_cents    integer not null check (amount_cents <> 0),
  raw_description text not null,
  -- Provisional: seen, not settled. Only settled credits mark a member paid.
  pending         boolean not null default false,
  -- The feed reported this transaction removed; its payments must be reversed.
  removed_at      timestamptz,
  -- The feed changed this credit's amount after it had already been applied,
  -- which breaks the invariant applyCredit enforces (allocations sum exactly to
  -- the credit). Surfaced on the desk rather than silently reconciled.
  amount_changed_at timestamptz,
  source          text not null default 'manual' check (source in ('manual', 'plaid')),
  status          text not null default 'queued' check (status in ('queued', 'applied', 'set_aside')),
  entered_by      text not null default '',
  created_at      timestamptz not null default now()
);

create index if not exists bank_txns_status_idx on bank_txns (status, posted_on);
create index if not exists bank_txns_pending_idx on bank_txns (pending_txn_id)
  where pending_txn_id is not null;
create index if not exists bank_txns_removed_idx on bank_txns (removed_at)
  where removed_at is not null;

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  bank_txn_id  uuid not null references bank_txns(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
  -- Which term this money paid. Charges are term-scoped, so payments must be
  -- too, or last term's payments settle this term's charges and the whole
  -- chapter reads "paid" the day a new term becomes current.
  term_id      uuid not null references terms(id) on delete cascade,
  charge_id    uuid references dues_charges(id) on delete set null,
  -- Negative when reversing a returned credit: history is appended, never deleted.
  amount_cents integer not null check (amount_cents <> 0),
  applied_by   text not null default '',
  -- Why the app credited this member — the audit trail the UI shows.
  reason       text not null default '',
  created_at   timestamptz not null default now(),
  -- Idempotency. CLAUDE.md called for unique(bank_txn_id); it has to be
  -- (bank_txn_id, member_id) instead, because one credit legitimately splits
  -- across two brothers. Same guarantee where it matters: a single credit can
  -- never be applied to the same member twice.
  unique (bank_txn_id, member_id)
);

create table if not exists name_aliases (
  id          uuid primary key default gen_random_uuid(),
  bank_name   text not null,
  -- Upper-cased, punctuation-stripped form; unique so one sender string can
  -- only ever point at one brother.
  normalized  text not null unique,
  member_id   uuid not null references members(id) on delete cascade,
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);

-- Secrets and machine state ONLY. No policies at all, deliberately: the access
-- token is a bearer credential for read access to the chapter's entire bank
-- account, and nothing in the product needs a human to see it. Anything an exec
-- is allowed to know lives in bank_connection / sync_runs below.
create table if not exists sync_state (
  id           integer primary key default 1 check (id = 1),
  cursor       text,
  item_id      text,
  access_token text,
  -- Which account of the Item is the dues account. Until it is set the sync
  -- refuses to run: a second depository account would pipe internal
  -- checking↔savings transfers in as "credits" and the matcher would rank them
  -- as dues.
  account_id   text,
  -- Credits older than this are dropped. The ledger starts at zero, so anything
  -- before go-live has no charge to match and would arrive as an unclear queue
  -- item the treasurer has to set aside by hand.
  ingest_from  date,
  -- Advisory lock: the daily cron and a treasurer pressing the button seconds
  -- apart is a real collision.
  locked_at    timestamptz,
  lock_id      uuid,
  synced_at    timestamptz
);

-- The lock is a conditional UPDATE, and an UPDATE against a missing row affects
-- zero rows — which reads as "someone else holds the lock". Without this seed
-- the very first sync reports "already running" forever.
insert into sync_state (id) values (1) on conflict (id) do nothing;
insert into bank_connection (id) values (1) on conflict (id) do nothing;

-- What an exec may see about the connection. Written by the service role,
-- readable by execs — deliberately NOT part of the exec_all loop below, because
-- an exec must not be able to forge a sync history.
create table if not exists bank_connection (
  id               integer primary key default 1 check (id = 1),
  institution_name text,
  item_id          text,
  account_name     text,
  account_mask     text,
  connected_at     timestamptz,
  last_synced_at   timestamptz,
  needs_reauth     boolean not null default false,
  last_error       text
);

-- One row per sync. A reversal that happens at 7am with nobody watching is not
-- an audit trail unless it is written down.
create table if not exists sync_runs (
  id                         uuid primary key default gen_random_uuid(),
  trigger                    text not null
    check (trigger in ('manual', 'cron', 'webhook', 'first_connect')),
  started_at                 timestamptz not null default now(),
  finished_at                timestamptz,
  added_count                integer not null default 0,
  settled_count              integer not null default 0,
  modified_count             integer not null default 0,
  removed_count              integer not null default 0,
  reversed_count             integer not null default 0,
  -- Counts only. The descriptors of the chapter's rent, vendors and payroll are
  -- not ours to keep.
  dropped_debit_count        integer not null default 0,
  dropped_before_floor_count integer not null default 0,
  auto_applied_count         integer not null default 0,
  status                     text not null default 'running'
    check (status in ('running','ok','error','busy','not_connected','account_not_selected','needs_reauth')),
  error                      text
);

create index if not exists sync_runs_started_idx on sync_runs (started_at desc);

/* ─────────────────────────── the public balances view ─────────────────────────── */

-- Members get a read-only "what do I owe" page with no login. They must NOT
-- see bank_txns (raw descriptors carry senders' and parents' names), so the
-- anon key reaches this view and nothing else. Views run with the owner's
-- rights, so anon reading it never touches the base tables' RLS.
create or replace view member_balances as
select
  m.id                                            as member_id,
  m.name                                          as name,
  coalesce(c.amount_cents, 0)                     as charged_cents,
  coalesce(adj.total, 0)                          as opp_fund_cents,
  -- greatest(...) mirrors Math.min(oppFund, charged) in lib/ledger.ts. Without
  -- it an over-granted adjustment makes owed_cents negative, and 0 >= -100 reads
  -- as "paid" on the member-facing page for someone who has paid nothing —
  -- while the exec ledger correctly shows them owing. The two screens must agree.
  greatest(coalesce(c.amount_cents, 0) - coalesce(adj.total, 0), 0)            as owed_cents,
  coalesce(pay.total, 0)                                                      as paid_cents,
  greatest(coalesce(c.amount_cents, 0) - coalesce(adj.total, 0), 0) - coalesce(pay.total, 0) as balance_cents,
  t.label                                         as term_label
from members m
cross join lateral (select id, label from terms where is_current limit 1) t
left join dues_charges c on c.member_id = m.id and c.term_id = t.id
left join lateral (
  select sum(a.amount_cents) as total from adjustments a
  where a.member_id = m.id and a.term_id = t.id
) adj on true
left join lateral (
  select sum(p.amount_cents) as total from payments p
  where p.member_id = m.id and p.term_id = t.id
) pay on true;

/* ─────────────────────────── RLS ─────────────────────────── */

alter table members      enable row level security;
alter table terms        enable row level security;
alter table dues_charges enable row level security;
alter table adjustments  enable row level security;
alter table exemptions   enable row level security;
alter table bank_txns    enable row level security;
alter table payments     enable row level security;
alter table name_aliases enable row level security;
alter table sync_state      enable row level security;
alter table bank_connection enable row level security;
alter table sync_runs       enable row level security;

-- Exec (any authenticated user) reads and writes everything.
do $$
declare tbl text;
begin
  foreach tbl in array array['members','terms','dues_charges','adjustments','exemptions','bank_txns','payments','name_aliases']
  loop
    execute format('drop policy if exists exec_all on %I', tbl);
    execute format(
      'create policy exec_all on %I for all to authenticated using (true) with check (true)', tbl);
  end loop;
end $$;

-- Exec reads, service role writes. RLS blocks rows; the revoke below blocks the
-- table itself, so even an accidental future policy can't open sync_state.
drop policy if exists exec_read on bank_connection;
create policy exec_read on bank_connection for select to authenticated using (true);
drop policy if exists exec_read on sync_runs;
create policy exec_read on sync_runs for select to authenticated using (true);

revoke all on sync_state from anon, authenticated;

-- anon gets no table access at all — only the view.
revoke all on member_balances from anon;
grant select on member_balances to anon, authenticated;
