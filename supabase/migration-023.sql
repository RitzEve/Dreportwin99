-- ============================================================================
-- Migration 023 — Payment Gateway Details: master/manager-only payment gateway vault
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS: a new payment_gateways table for recording payment gateway
-- credentials (backend link, login ID, password, API key, merchant key,
-- merchant code) — visible and editable ONLY by master/manager of the OWNING
-- company. Same isolation as bank_details / company_credentials: RLS means the
-- row never leaves the database for a staff session, not even over the
-- network — not just a hidden nav item.
-- ============================================================================

create table if not exists public.payment_gateways (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  backend_link  text,
  login_id      text,
  password      text,
  api_key       text,
  merchant_key  text,
  merchant_code text,
  custom_fields jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_payment_gateways_company_id on public.payment_gateways(company_id);

alter table public.payment_gateways enable row level security;

drop policy if exists payment_gateways_select on public.payment_gateways;
create policy payment_gateways_select on public.payment_gateways for select to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists payment_gateways_insert on public.payment_gateways;
create policy payment_gateways_insert on public.payment_gateways for insert to authenticated
  with check ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists payment_gateways_update on public.payment_gateways;
create policy payment_gateways_update on public.payment_gateways for update to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') )
  with check ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists payment_gateways_delete on public.payment_gateways;
create policy payment_gateways_delete on public.payment_gateways for delete to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

grant select, insert, update, delete on public.payment_gateways to authenticated;
