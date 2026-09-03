-- migration-033: an inbox for incoming payment-gateway webhooks
--
-- WHY THIS SHAPE (the important part)
--
-- FinTrack keeps every transaction inside ONE jsonb blob per company in
-- public.app_data. Megabet26's blob is currently 5.35 MB (14,265 transactions);
-- Mario96's is 3.0 MB. pg_stat_user_tables shows app_data has taken 17,459
-- updates across its 5 live rows -- each one rewriting a multi-megabyte row,
-- because Postgres writes a whole new row version on every UPDATE.
--
-- So the obvious implementation of "a webhook that records a payment" --
-- read the blob, append one transaction, write the blob back -- would be a
-- disaster here on three separate counts:
--
--   1. EGRESS. Read 5.35 MB + write 5.35 MB per payment. At only 200 payments
--      a day that is ~2.1 GB/day of traffic for maybe 40 kB of actual data.
--   2. WRITE AMPLIFICATION. Every call rewrites the entire row and leaves a
--      5 MB dead tuple behind for autovacuum. On top of 17,459 existing updates.
--   3. LOST MONEY. Read-modify-write races. Two webhooks landing together, or
--      a webhook landing while a staff member saves in the UI, and one write
--      silently overwrites the other. In a financial app that is a lost payment
--      with no error message anywhere.
--
-- Therefore the webhook NEVER touches app_data. It appends one small row to
-- this table and nothing else. Importing into FinTrack stays a separate,
-- deliberate step -- which is also the right answer for money entering the
-- books: a human confirms it.
--
-- Reversible: see the rollback block at the bottom.

-- ---- 1. Per-gateway webhook settings ---------------------------------------
-- The secret is the shared password used to prove a POST really came from the
-- gateway (HMAC-SHA256 over the raw body). Disabled by default: a gateway does
-- nothing until someone deliberately turns it on and sets a secret.

alter table public.payment_gateways
  add column if not exists webhook_secret  text,
  add column if not exists webhook_enabled boolean not null default false;

-- ---- 2. The inbox ----------------------------------------------------------

create table if not exists public.gateway_events (
  id          uuid primary key default gen_random_uuid(),
  gateway_id  uuid not null references public.payment_gateways(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,

  -- The gateway's OWN id for this event. This is what makes retries safe.
  event_id    text not null,

  -- The raw body of one payment. Small by design; the edge function refuses
  -- anything over 16 kB before it ever gets here, so no one can fill the disk
  -- by POSTing giant bodies at us.
  payload     jsonb not null,

  status      text not null default 'pending'
              check (status in ('pending','imported','rejected')),

  received_at timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid references auth.users(id) on delete set null
);

-- ---- 3. Idempotency, enforced by the DATABASE ------------------------------
-- Gateways retry when they do not get a 200. Rather than trusting application
-- code to remember what it has seen, the same (gateway, event_id) simply
-- cannot exist twice. The edge function catches the unique violation and
-- answers 200 "already have it" -- the retry stops, nothing is double-counted.

create unique index if not exists gateway_events_dedupe
  on public.gateway_events (gateway_id, event_id);

-- Backs the "show me what is waiting" screen, and the retention sweep below.
create index if not exists gateway_events_company_status
  on public.gateway_events (company_id, status, received_at desc);

-- FK index: Postgres does not create these automatically, and without it
-- deleting a payment gateway sequentially scans this whole table.
create index if not exists gateway_events_gateway
  on public.gateway_events (gateway_id);

-- ---- 4. Flood protection ---------------------------------------------------
-- Mirrors the existing public._login_lookup_ratelimit pattern, but per gateway.
-- A gateway stuck in a retry loop (or someone hammering the public URL) gets
-- refused cheaply instead of writing rows until the disk fills.

create table if not exists public._gateway_webhook_ratelimit (
  gateway_id   uuid primary key references public.payment_gateways(id) on delete cascade,
  window_start timestamptz not null default now(),
  count        integer     not null default 0
);

-- ---- 5. RLS ----------------------------------------------------------------
-- Nobody signed into the app may INSERT here -- only the edge function, which
-- uses the service role and bypasses RLS. Reading follows the same rule as
-- payment_gateways: master/manager of that company, plus the company's owner.
-- Helper calls are wrapped as (select ...) so they run ONCE per query instead
-- of once per row (see migration-028: 74.6ms -> 1.8ms on 3.4k rows).

alter table public.gateway_events             enable row level security;
alter table public._gateway_webhook_ratelimit enable row level security;

drop policy if exists gateway_events_select on public.gateway_events;
create policy gateway_events_select on public.gateway_events
  for select to authenticated
  using (
    ( company_id = (select public.my_company())
      and (select public.my_role()) = any (array['master','manager']) )
    or exists (
      select 1 from public.company_owners co
       where co.company_id = gateway_events.company_id
         and co.owner_id = (select auth.uid())
    )
  );

-- Marking an event imported/rejected is done by the same people who can read it.
drop policy if exists gateway_events_update on public.gateway_events;
create policy gateway_events_update on public.gateway_events
  for update to authenticated
  using (
    ( company_id = (select public.my_company())
      and (select public.my_role()) = any (array['master','manager']) )
    or exists (
      select 1 from public.company_owners co
       where co.company_id = gateway_events.company_id
         and co.owner_id = (select auth.uid())
    )
  )
  with check (
    ( company_id = (select public.my_company())
      and (select public.my_role()) = any (array['master','manager']) )
    or exists (
      select 1 from public.company_owners co
       where co.company_id = gateway_events.company_id
         and co.owner_id = (select auth.uid())
    )
  );

-- No policies at all on the rate-limit table: RLS on with zero policies means
-- authenticated users can neither read nor write it. Only the service role can.

-- ---- 6. Retention ----------------------------------------------------------
-- This table only ever grows, and "grows forever" is how a database runs out of
-- disk. Handled events older than 90 days are no longer useful -- the payment is
-- in FinTrack by then. Call this from a scheduled job, or by hand.

create or replace function public.prune_gateway_events(older_than interval default '90 days')
returns integer language plpgsql security definer set search_path = public as $fn$
declare removed integer;
begin
  delete from public.gateway_events
   where status in ('imported','rejected')
     and received_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end $fn$;

revoke all on function public.prune_gateway_events(interval) from public, anon, authenticated;

-- ============================================================================
-- ROLLBACK (paste into the SQL editor to undo this migration completely)
-- ============================================================================
-- drop function if exists public.prune_gateway_events(interval);
-- drop table if exists public._gateway_webhook_ratelimit;
-- drop table if exists public.gateway_events;
-- alter table public.payment_gateways
--   drop column if exists webhook_secret,
--   drop column if exists webhook_enabled;
-- ============================================================================
