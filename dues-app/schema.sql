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
  posted_on       date not null,
  -- Negative for a returned/reversed credit.
  amount_cents    integer not null check (amount_cents <> 0),
  raw_description text not null,
  -- Provisional: seen, not settled. Only settled credits mark a member paid.
  pending         boolean not null default false,
  -- The feed reported this transaction removed; its payments must be reversed.
  removed_at      timestamptz,
  source          text not null default 'manual' check (source in ('manual', 'plaid')),
  status          text not null default 'queued' check (status in ('queued', 'applied', 'set_aside')),
  entered_by      text not null default '',
  created_at      timestamptz not null default now()
);

create index if not exists bank_txns_status_idx on bank_txns (status, posted_on);

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  bank_txn_id  uuid not null references bank_txns(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
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

-- Phase 2. No policies at all, deliberately: only the service role touches it,
-- so an access token can't be read with the anon key or by a signed-in exec.
create table if not exists sync_state (
  id           integer primary key default 1 check (id = 1),
  cursor       text,
  item_id      text,
  access_token text,
  synced_at    timestamptz
);

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
  coalesce(c.amount_cents, 0) - coalesce(adj.total, 0)                        as owed_cents,
  coalesce(pay.total, 0)                                                      as paid_cents,
  coalesce(c.amount_cents, 0) - coalesce(adj.total, 0) - coalesce(pay.total, 0) as balance_cents,
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
  where p.member_id = m.id
) pay on true;

/* ─────────────────────────── RLS ─────────────────────────── */

alter table members      enable row level security;
alter table terms        enable row level security;
alter table dues_charges enable row level security;
alter table adjustments  enable row level security;
alter table bank_txns    enable row level security;
alter table payments     enable row level security;
alter table name_aliases enable row level security;
alter table sync_state   enable row level security;

-- Exec (any authenticated user) reads and writes everything.
do $$
declare tbl text;
begin
  foreach tbl in array array['members','terms','dues_charges','adjustments','bank_txns','payments','name_aliases']
  loop
    execute format('drop policy if exists exec_all on %I', tbl);
    execute format(
      'create policy exec_all on %I for all to authenticated using (true) with check (true)', tbl);
  end loop;
end $$;

-- anon gets no table access at all — only the view.
revoke all on member_balances from anon;
grant select on member_balances to anon, authenticated;
