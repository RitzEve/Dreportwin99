-- ============================================================================
-- Migration 016 — provider-only company billing: start date + rental fees
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS: a new company_billing table, one row per company — visible
-- and editable ONLY by the provider account. No master/manager/staff login,
-- and no owner login, can ever read or write this table; it never appears on
-- any page other than the Provider page. Tracks when a company started using
-- the app, what their rental fee is, and whether they've currently paid it.
-- ============================================================================

create table if not exists public.company_billing (
  company_id     uuid primary key references public.companies(id) on delete cascade,
  started_at     date,
  rental_fee     numeric,
  rental_paid    boolean not null default false,
  rental_paid_at timestamptz,
  updated_at     timestamptz not null default now()
);

alter table public.company_billing enable row level security;

drop policy if exists company_billing_select on public.company_billing;
create policy company_billing_select on public.company_billing for select to authenticated
  using ( public.my_role() = 'provider' );

drop policy if exists company_billing_insert on public.company_billing;
create policy company_billing_insert on public.company_billing for insert to authenticated
  with check ( public.my_role() = 'provider' );

drop policy if exists company_billing_update on public.company_billing;
create policy company_billing_update on public.company_billing for update to authenticated
  using ( public.my_role() = 'provider' ) with check ( public.my_role() = 'provider' );

drop policy if exists company_billing_delete on public.company_billing;
create policy company_billing_delete on public.company_billing for delete to authenticated
  using ( public.my_role() = 'provider' );

-- Backfill: give every existing company a billing row, defaulting its start
-- date to when its record was first created here — correct it per company
-- afterwards from the Provider page if the real start date was earlier.
insert into public.company_billing (company_id, started_at)
select id, created_at::date from public.companies
on conflict (company_id) do nothing;

grant select, insert, update, delete on public.company_billing to authenticated;
