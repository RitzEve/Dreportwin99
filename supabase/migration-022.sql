-- ============================================================================
-- Migration 022 — Company Credentials: master/manager-only login/credential vault
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS: a new company_credentials table for recording general login
-- credentials (Google account, VPNs, admin consoles, etc.) — visible and
-- editable ONLY by master/manager of the OWNING company. Same isolation as
-- bank_details (migration-021): RLS means the row never leaves the database
-- for a staff session, not even over the network — not just a hidden nav item.
-- ============================================================================

create table if not exists public.company_credentials (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  category      text,
  username      text,
  email         text,
  password      text,
  link          text,
  custom_fields jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_company_credentials_company_id on public.company_credentials(company_id);

alter table public.company_credentials enable row level security;

drop policy if exists company_credentials_select on public.company_credentials;
create policy company_credentials_select on public.company_credentials for select to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists company_credentials_insert on public.company_credentials;
create policy company_credentials_insert on public.company_credentials for insert to authenticated
  with check ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists company_credentials_update on public.company_credentials;
create policy company_credentials_update on public.company_credentials for update to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') )
  with check ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists company_credentials_delete on public.company_credentials;
create policy company_credentials_delete on public.company_credentials for delete to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

grant select, insert, update, delete on public.company_credentials to authenticated;
