-- ============================================================================
-- Migration 024 — Game Kiosk Details: all-roles kiosk credential vault
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS: a new kiosk_details table for recording each kiosk's backend
-- link, login ID, password, and merchant code. Unlike Bank Details / Company
-- Credentials / Payment Gateway Details, this one is intentionally open to
-- EVERY role (master/manager/staff) — full add/edit/delete for anyone signed
-- into the company, not just master/manager. RLS still isolates by company:
-- a session can never see or touch another company's kiosk rows, but within a
-- company there is no role restriction at all.
-- ============================================================================

create table if not exists public.kiosk_details (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  backend_link  text,
  login_id      text,
  password      text,
  merchant_code text,
  custom_fields jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_kiosk_details_company_id on public.kiosk_details(company_id);

alter table public.kiosk_details enable row level security;

drop policy if exists kiosk_details_select on public.kiosk_details;
create policy kiosk_details_select on public.kiosk_details for select to authenticated
  using ( company_id = public.my_company() );

drop policy if exists kiosk_details_insert on public.kiosk_details;
create policy kiosk_details_insert on public.kiosk_details for insert to authenticated
  with check ( company_id = public.my_company() );

drop policy if exists kiosk_details_update on public.kiosk_details;
create policy kiosk_details_update on public.kiosk_details for update to authenticated
  using ( company_id = public.my_company() )
  with check ( company_id = public.my_company() );

drop policy if exists kiosk_details_delete on public.kiosk_details;
create policy kiosk_details_delete on public.kiosk_details for delete to authenticated
  using ( company_id = public.my_company() );

grant select, insert, update, delete on public.kiosk_details to authenticated;
