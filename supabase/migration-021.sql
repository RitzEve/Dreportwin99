-- ============================================================================
-- Migration 021 — Bank Details: master/manager-only drop-account records
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS: a new bank_details table for recording drop-account info
-- (phone/SIM, bank login, card, VPN, OTP link, etc.) — separate from the
-- `banks` array used for live transaction entry (which lives in app_data,
-- not a real table). Visible and editable ONLY by master/manager of the
-- OWNING company. Staff never receives this data at all — unlike a hidden
-- nav item, RLS means the row never leaves the database for a staff session,
-- not even over the network. That's the real gate, not the UI.
-- ============================================================================

create table if not exists public.bank_details (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete cascade,
  phone_model               text,
  bank_name                 text,
  holder_name               text,
  date_of_birth             date,
  phone_number              text,
  email                     text,
  email_password            text,
  card_last4                text,
  card_pin                  text,
  login_pin                 text,
  customer_login_id         text,
  internet_password         text,
  vpn                       text,
  otp_link                  text,
  bsb                       text,
  account_number            text,
  payid                     text,
  open_date                 date,
  agent                     text,
  others                    text,
  remarks                   text,
  frozen                    boolean not null default false,
  added_to_bank_accounts_at timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_bank_details_company_id on public.bank_details(company_id);

alter table public.bank_details enable row level security;

drop policy if exists bank_details_select on public.bank_details;
create policy bank_details_select on public.bank_details for select to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists bank_details_insert on public.bank_details;
create policy bank_details_insert on public.bank_details for insert to authenticated
  with check ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists bank_details_update on public.bank_details;
create policy bank_details_update on public.bank_details for update to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') )
  with check ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists bank_details_delete on public.bank_details;
create policy bank_details_delete on public.bank_details for delete to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

grant select, insert, update, delete on public.bank_details to authenticated;
