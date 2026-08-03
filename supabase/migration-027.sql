-- ============================================================================
-- Migration 027 — company Country + the shared Blacklist Member list
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS
--   1. companies.country  — which country a company operates in.
--   2. blacklist_members  — a shared list of problem customers, pooled by
--      COUNTRY rather than by company.
--
-- READ THIS BIT, IT'S DIFFERENT FROM EVERY OTHER TABLE HERE:
-- Every other table in this database is walled off per company — bank_details,
-- company_credentials, payment_gateways, kiosk_details and app_data are all
-- gated on `company_id = my_company()`. This one deliberately is NOT. Any
-- company in the same country reads, and contributes to, the same pool. That
-- is the whole point of the feature, but it does mean a blacklist entry added
-- by one company is visible to every other company in that country — including
-- any company added later. Worth knowing before more tenants are onboarded.
--
-- WHY COUNTRY AND NOT TIMEZONE: Perth and Sydney are one country but two
-- timezones, so timezone alone would split them. Reading the country out of
-- the timezone text doesn't work either — Australia/Perth and Australia/Sydney
-- both say "Australia", but Malaysia is Asia/Kuala_Lumpur, which says "Asia"
-- and would pool Malaysia with every other Asian timezone. Hence a real field.
--
-- NO EDITING, DELETE IS MASTER-ONLY: there is no update policy at all, so an
-- entry's details can never be altered after the fact — a shared accusation
-- list that anyone could quietly rewrite would be worth little to the others
-- relying on it. Deleting is allowed, but only for a master, so a wrong or
-- malicious entry can be withdrawn without leaving the whole list editable.
--
-- NOTE ON THE DELETE SCOPE: a master can delete ANY entry in their country's
-- pool, including ones reported by a different company. That follows from it
-- being one shared list rather than a stack of per-company lists. If that's too
-- broad, add `and added_by_company_id = public.my_company()` to the delete
-- policy below and a master will only be able to withdraw their own company's
-- entries.
-- ============================================================================

-- ---- 1) Which country each company operates in ------------------------------

alter table public.companies add column if not exists country text;

-- Backfill: every company that exists today is on an Australian timezone.
-- Only fills blanks, so re-running never overwrites a country set by hand.
update public.companies
   set country = 'Australia'
 where country is null
   and timezone like 'Australia/%';

-- ---- 2) The caller's country, for RLS --------------------------------------
-- Mirrors the existing my_company() / my_role() helpers. Returns null for
-- provider and owner logins (they belong to no company), which is what keeps
-- them out of the insert policy below.

create or replace function public.my_country()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.country
    from public.profiles p
    join public.companies c on c.id = p.company_id
   where p.id = auth.uid();
$$;

revoke all on function public.my_country() from public, anon;
grant execute on function public.my_country() to authenticated;

-- ---- 3) The shared list -----------------------------------------------------

create table if not exists public.blacklist_members (
  id                 uuid primary key default gen_random_uuid(),
  country            text not null,          -- the sharing key
  name               text not null,
  phone              text,
  phone_digits       text,                   -- digits only, for reliable matching
  payid              text,
  bsb                text,
  account_no         text,
  reason             text,
  -- Who put this on the list. Kept because nobody can delete or edit an entry,
  -- so every row needs to be traceable back to a company and a person.
  added_by_company_id uuid references public.companies(id) on delete set null,
  added_by_company    text,
  added_by_user_id    uuid references public.profiles(id)  on delete set null,
  added_by_name       text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_blacklist_members_country on public.blacklist_members(country);
create index if not exists idx_blacklist_members_phone   on public.blacklist_members(phone_digits);
create index if not exists idx_blacklist_members_name    on public.blacklist_members(lower(name));

alter table public.blacklist_members enable row level security;

-- Read: anyone signed in at a company in the same country. Owners additionally
-- read the pool for any country they have a linked company in, matching how
-- migration-025 lets them see the vault pages of companies they oversee.
drop policy if exists blacklist_members_select on public.blacklist_members;
create policy blacklist_members_select on public.blacklist_members for select to authenticated
  using (
    country = public.my_country()
    or exists (
      select 1
        from public.company_owners co
        join public.companies c on c.id = co.company_id
       where co.owner_id = auth.uid()
         and c.country = blacklist_members.country
    )
  );

-- Add: every company role (master, manager AND staff) may add, but only into
-- their OWN country's pool and only stamped as their own company — so nobody
-- can plant an entry in another country or forge who reported it. Owners have
-- no company, so my_country()/my_company() are null for them and this check can
-- never pass: their drill-in stays read-only, same as everywhere else.
drop policy if exists blacklist_members_insert on public.blacklist_members;
create policy blacklist_members_insert on public.blacklist_members for insert to authenticated
  with check (
    country = public.my_country()
    and added_by_company_id = public.my_company()
  );

-- Withdraw: master only, within their own country's pool. There is still NO
-- update policy — an entry can be removed, never rewritten, so nobody can
-- change what an existing entry says about someone.
drop policy if exists blacklist_members_delete on public.blacklist_members;
create policy blacklist_members_delete on public.blacklist_members for delete to authenticated
  using (
    country = public.my_country()
    and public.my_role() = 'master'
  );

grant select, insert, delete on public.blacklist_members to authenticated;
