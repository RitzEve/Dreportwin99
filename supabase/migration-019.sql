-- ============================================================================
-- Migration 019 — scale-proofing found while checking the Supabase Memory/
-- Disk IO usage screenshot (2026-07-07). Not a bug fix — a "make this stay
-- fast as more companies join" fix.
-- ============================================================================
-- Run the SAME way as always: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
-- ============================================================================

-- ---- 1) Stop 4 security checks from re-running themselves per row ----------
-- WHY: every row-level security rule on app_data/companies/company_owners/
-- profiles asks "is this the signed-in user?" (auth.uid()) as part of
-- deciding which rows you're allowed to see. Right now Postgres re-asks that
-- question separately for every single row it looks at. With only a handful
-- of companies today that's unnoticeable. But it's a per-row cost, so it
-- grows directly with how many companies/staff/owners exist — the more this
-- app succeeds, the more this specific cost adds up, on every single load of
-- the dashboard, team list, or owner overview. The fix doesn't change WHO can
-- see WHAT at all (identical rules, same access) — it just tells Postgres to
-- answer "who is signed in?" ONCE per request and reuse that answer, instead
-- of asking again for every row. This is Supabase's own documented fix for
-- this exact situation.

alter policy app_data_select on public.app_data
using (
  (company_id = my_company())
  or (my_role() = 'provider'::text)
  or (exists (
    select 1 from public.company_owners co
    where co.company_id = app_data.company_id
      and co.owner_id = (select auth.uid())
  ))
);

alter policy companies_select on public.companies
using (
  (my_role() = 'provider'::text)
  or (id = my_company())
  or (exists (
    select 1 from public.company_owners co
    where co.company_id = companies.id
      and co.owner_id = (select auth.uid())
  ))
);

alter policy company_owners_select on public.company_owners
using (
  (my_role() = 'provider'::text)
  or (owner_id = (select auth.uid()))
);

alter policy profiles_select on public.profiles
using (
  (my_role() = 'provider'::text)
  or (company_id = my_company())
  or (id = (select auth.uid()))
  or (exists (
    select 1 from public.company_owners co
    where co.company_id = profiles.company_id
      and co.owner_id = (select auth.uid())
  ))
);

-- ---- 2) Add the missing index the checks above actually rely on ------------
-- WHY: all 4 rules above look things up in company_owners by company_id (the
-- "is this owner linked to this company?" check). There's currently no index
-- for that lookup, so Postgres has to scan the whole table every time. Tiny
-- table today = no visible slowdown; as more owners/companies are added this
-- is exactly the kind of thing that gets slower in a way that's invisible
-- until it suddenly isn't. One index fixes it permanently.
create index if not exists idx_company_owners_company_id
  on public.company_owners (company_id);

-- ============================================================================
-- Not a SQL fix — a for-later note:
-- The advisor also flagged that your project's Auth service is capped at a
-- fixed 10 database connections rather than "a percentage of whatever the
-- compute size is." That's fine at your current (Micro) size. It only
-- matters the day you upgrade to a bigger compute instance for more
-- capacity — on that day, also switch this to percentage-based in Supabase
-- dashboard → Settings → Database → Connection pooling, or the bigger
-- instance you're paying more for won't actually give Auth more headroom.
-- Nothing to do about this today.
-- ============================================================================
