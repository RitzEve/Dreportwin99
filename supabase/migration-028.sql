-- ============================================================================
-- Migration 028 — make RLS read policies evaluate their helpers ONCE per query
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS CHANGES: nothing about WHO can see WHAT. Every policy below keeps
-- exactly the same logic — the only difference is that each call to
-- auth.uid() / my_company() / my_role() / my_country() / is_provider_tier() is
-- wrapped in (select ...).
--
-- WHY THAT MATTERS: written bare, Postgres re-runs those functions for EVERY
-- row it checks. my_company() and my_country() aren't free — they each join
-- profiles to companies — so on the 3,441-row blacklist that was thousands of
-- repeated lookups to answer one question whose answer never changes mid-query.
-- Wrapping them in (select ...) turns each into an InitPlan: evaluated once,
-- then reused. This is Supabase's own documented fix for the "Auth RLS
-- Initialization Plan" linter warning.
--
-- SCOPE — SELECT policies only, deliberately. Read policies are tested against
-- every row of a result set, so that's where the repetition costs something.
-- Insert/update/delete policies are checked against the handful of rows being
-- written, where the saving is nil and there's no reason to disturb a working
-- security rule.
--
-- Some policies (app_data, companies, profiles, company_owners) already had
-- auth.uid() wrapped from an earlier migration; they're rewritten here anyway
-- so every read policy ends up in one consistent, verifiable state, and their
-- remaining bare helper calls get the same treatment.
-- ============================================================================

-- ---- app_data ---------------------------------------------------------------
drop policy if exists app_data_select on public.app_data;
create policy app_data_select on public.app_data for select to authenticated
  using (
    company_id = (select public.my_company())
    or (select public.is_provider_tier())
    or exists (
      select 1 from public.company_owners co
       where co.company_id = app_data.company_id and co.owner_id = (select auth.uid())
    )
  );

-- ---- companies --------------------------------------------------------------
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (
    (select public.is_provider_tier())
    or id = (select public.my_company())
    or exists (
      select 1 from public.company_owners co
       where co.company_id = companies.id and co.owner_id = (select auth.uid())
    )
  );

-- ---- profiles ---------------------------------------------------------------
-- The most load-bearing policy in the app: getCurrentUser() reads this on every
-- page load, so a mistake here locks everyone out. Logic is byte-for-byte the
-- original, only the call sites are wrapped.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    (select public.is_provider_tier())
    or company_id = (select public.my_company())
    or id = (select auth.uid())
    or exists (
      select 1 from public.company_owners co
       where co.company_id = profiles.company_id and co.owner_id = (select auth.uid())
    )
  );

-- ---- company_owners ---------------------------------------------------------
drop policy if exists company_owners_select on public.company_owners;
create policy company_owners_select on public.company_owners for select to authenticated
  using ( (select public.is_provider_tier()) or owner_id = (select auth.uid()) );

-- ---- bank_details -----------------------------------------------------------
drop policy if exists bank_details_select on public.bank_details;
create policy bank_details_select on public.bank_details for select to authenticated
  using (
    (company_id = (select public.my_company()) and (select public.my_role()) in ('master','manager'))
    or exists (
      select 1 from public.company_owners co
       where co.company_id = bank_details.company_id and co.owner_id = (select auth.uid())
    )
  );

-- ---- company_credentials ----------------------------------------------------
drop policy if exists company_credentials_select on public.company_credentials;
create policy company_credentials_select on public.company_credentials for select to authenticated
  using (
    (company_id = (select public.my_company()) and (select public.my_role()) in ('master','manager'))
    or exists (
      select 1 from public.company_owners co
       where co.company_id = company_credentials.company_id and co.owner_id = (select auth.uid())
    )
  );

-- ---- payment_gateways -------------------------------------------------------
drop policy if exists payment_gateways_select on public.payment_gateways;
create policy payment_gateways_select on public.payment_gateways for select to authenticated
  using (
    (company_id = (select public.my_company()) and (select public.my_role()) in ('master','manager'))
    or exists (
      select 1 from public.company_owners co
       where co.company_id = payment_gateways.company_id and co.owner_id = (select auth.uid())
    )
  );

-- ---- kiosk_details ----------------------------------------------------------
drop policy if exists kiosk_details_select on public.kiosk_details;
create policy kiosk_details_select on public.kiosk_details for select to authenticated
  using (
    company_id = (select public.my_company())
    or exists (
      select 1 from public.company_owners co
       where co.company_id = kiosk_details.company_id and co.owner_id = (select auth.uid())
    )
  );

-- ---- blacklist_members ------------------------------------------------------
-- The one that actually prompted this: thousands of rows, and my_country()
-- was being re-derived for each of them.
drop policy if exists blacklist_members_select on public.blacklist_members;
create policy blacklist_members_select on public.blacklist_members for select to authenticated
  using (
    country = (select public.my_country())
    or exists (
      select 1
        from public.company_owners co
        join public.companies c on c.id = co.company_id
       where co.owner_id = (select auth.uid()) and c.country = blacklist_members.country
    )
  );

-- ---- user_presence ----------------------------------------------------------
drop policy if exists user_presence_select on public.user_presence;
create policy user_presence_select on public.user_presence for select to authenticated
  using (
    company_id = (select public.my_company())
    and (select public.my_role()) in ('master','manager')
  );

-- ---- billing (provider-only reads) ------------------------------------------
drop policy if exists company_billing_select on public.company_billing;
create policy company_billing_select on public.company_billing for select to authenticated
  using ( (select public.is_provider_tier()) );

drop policy if exists company_billing_payments_select on public.company_billing_payments;
create policy company_billing_payments_select on public.company_billing_payments for select to authenticated
  using ( (select public.is_provider_tier()) );

-- ---- the two foreign keys the performance linter flagged as unindexed -------
create index if not exists idx_blacklist_members_added_by_company
  on public.blacklist_members(added_by_company_id);
create index if not exists idx_blacklist_members_added_by_user
  on public.blacklist_members(added_by_user_id);
create index if not exists idx_company_billing_payments_recorded_by
  on public.company_billing_payments(recorded_by);
