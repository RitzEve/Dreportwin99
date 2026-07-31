-- ============================================================================
-- Migration 025 — let an OWNER read the four "Details" vault pages
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS: read access, for an owner, to the Details pages of every
-- company that owner is linked to — Bank Details, {Company} Details, Payment
-- Gateway Details and Game Kiosk Details.
--
-- WHY IT'S NEEDED: an owner's profiles.company_id is always NULL (same as a
-- provider), so public.my_company() returns NULL for them. Every one of these
-- four SELECT policies was gated on `company_id = my_company()`, which can
-- never be true for an owner — so an owner drilling into a company saw the
-- page but zero rows. This adds ONE extra OR clause to each SELECT policy,
-- scoped through company_owners, exactly the same shape migration-013 already
-- used for companies_select / profiles_select / app_data_select.
--
-- STILL READ-ONLY: the insert/update/delete policies on all four tables are
-- deliberately NOT touched here. They stay gated on `company_id =
-- my_company()`, which is never true for an owner — so an owner physically
-- cannot add, change or delete any of these records, enforced by the database
-- itself and not by hidden buttons. Same guarantee that already makes the
-- owner's FinTrack drill-in read-only.
-- ============================================================================

-- ---- 1) Bank Details -------------------------------------------------------

drop policy if exists bank_details_select on public.bank_details;
create policy bank_details_select on public.bank_details for select to authenticated
  using (
    (company_id = public.my_company() and public.my_role() in ('master','manager'))
    or exists (
      select 1 from public.company_owners co
      where co.company_id = bank_details.company_id and co.owner_id = auth.uid()
    )
  );

-- ---- 2) {Company name} Details (company_credentials) -----------------------

drop policy if exists company_credentials_select on public.company_credentials;
create policy company_credentials_select on public.company_credentials for select to authenticated
  using (
    (company_id = public.my_company() and public.my_role() in ('master','manager'))
    or exists (
      select 1 from public.company_owners co
      where co.company_id = company_credentials.company_id and co.owner_id = auth.uid()
    )
  );

-- ---- 3) Payment Gateway Details --------------------------------------------

drop policy if exists payment_gateways_select on public.payment_gateways;
create policy payment_gateways_select on public.payment_gateways for select to authenticated
  using (
    (company_id = public.my_company() and public.my_role() in ('master','manager'))
    or exists (
      select 1 from public.company_owners co
      where co.company_id = payment_gateways.company_id and co.owner_id = auth.uid()
    )
  );

-- ---- 4) Game Kiosk Details -------------------------------------------------
-- Note this one has NO role check to preserve — it's open to every role of the
-- owning company (migration-024), so only the owner clause is added.

drop policy if exists kiosk_details_select on public.kiosk_details;
create policy kiosk_details_select on public.kiosk_details for select to authenticated
  using (
    company_id = public.my_company()
    or exists (
      select 1 from public.company_owners co
      where co.company_id = kiosk_details.company_id and co.owner_id = auth.uid()
    )
  );
