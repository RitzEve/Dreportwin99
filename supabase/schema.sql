-- ============================================================================
-- Company Portal — Supabase database setup
-- ============================================================================
-- HOW TO RUN:
--   Supabase dashboard → SQL Editor → New query → paste ALL of this → Run.
--   Safe to run more than once (uses IF NOT EXISTS / OR REPLACE / DROP POLICY).
--
-- Before running, also do these in the dashboard (one time):
--   Authentication → Sign In / Providers → Email:
--      • turn OFF  "Confirm email"   (so new accounts work immediately, no email)
--      • make sure "Allow new users to sign up" is ON
--
-- After running, create your PROVIDER login (see the bottom of this file).
-- ============================================================================

-- ---- Tables ----------------------------------------------------------------

create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete cascade,
  role        text not null check (role in ('provider','master','manager','staff')),
  name        text not null default '',
  operator_id text,
  email       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One JSON blob of FinTrack data per company (banks / members / transactions).
create table if not exists public.app_data (
  company_id uuid primary key references public.companies(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---- Helper functions (read the caller's role/company without RLS recursion) -

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid()
$$;

grant execute on function public.my_role()    to authenticated;
grant execute on function public.my_company() to authenticated;

-- ---- Enable Row-Level Security ---------------------------------------------

alter table public.companies enable row level security;
alter table public.profiles  enable row level security;
alter table public.app_data  enable row level security;

-- ---- Policies: companies ---------------------------------------------------

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using ( public.my_role() = 'provider' or id = public.my_company() );

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert to authenticated
  with check ( public.my_role() = 'provider' );

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using ( public.my_role() = 'provider' ) with check ( public.my_role() = 'provider' );

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete to authenticated
  using ( public.my_role() = 'provider' );

-- ---- Policies: profiles ----------------------------------------------------

-- Read: provider sees all; everyone else sees their own company + their own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    public.my_role() = 'provider'
    or company_id = public.my_company()
    or id = auth.uid()
  );

-- Create: provider any; master -> manager/staff in own company; manager -> staff.
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (
    public.my_role() = 'provider'
    or ( public.my_role() = 'master'  and company_id = public.my_company() and role in ('manager','staff') )
    or ( public.my_role() = 'manager' and company_id = public.my_company() and role = 'staff' )
  );

-- Manage (rename / activate / change role): same authority as create.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (
    public.my_role() = 'provider'
    or ( public.my_role() = 'master'  and company_id = public.my_company() and role in ('manager','staff') )
    or ( public.my_role() = 'manager' and company_id = public.my_company() and role = 'staff' )
  )
  with check (
    public.my_role() = 'provider'
    or ( public.my_role() = 'master'  and company_id = public.my_company() and role in ('manager','staff') )
    or ( public.my_role() = 'manager' and company_id = public.my_company() and role = 'staff' )
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (
    public.my_role() = 'provider'
    or ( public.my_role() = 'master'  and company_id = public.my_company() and role in ('manager','staff') )
    or ( public.my_role() = 'manager' and company_id = public.my_company() and role = 'staff' )
  );

-- ---- Policies: app_data (company members + provider) ------------------------

drop policy if exists app_data_select on public.app_data;
create policy app_data_select on public.app_data for select to authenticated
  using ( company_id = public.my_company() or public.my_role() = 'provider' );

drop policy if exists app_data_insert on public.app_data;
create policy app_data_insert on public.app_data for insert to authenticated
  with check ( company_id = public.my_company() );

drop policy if exists app_data_update on public.app_data;
create policy app_data_update on public.app_data for update to authenticated
  using ( company_id = public.my_company() ) with check ( company_id = public.my_company() );

-- ---- Seed the two companies (no master yet — you'll add masters in the app) -

insert into public.companies (name)
select 'Megabet26' where not exists (select 1 from public.companies where name = 'Megabet26');
insert into public.companies (name)
select 'Mario96'   where not exists (select 1 from public.companies where name = 'Mario96');

-- ============================================================================
-- CREATE YOUR PROVIDER LOGIN  (do this AFTER the script above has run)
-- ============================================================================
-- 1. Dashboard → Authentication → Users → "Add user":
--       Email:    <your provider email>
--       Password: <a password only you know>
--       ✅ tick "Auto Confirm User"
--    Click "Create user".
--
-- 2. Come back to the SQL Editor, put YOUR provider email in the line below,
--    and run just this statement to mark that account as the provider:
--
-- insert into public.profiles (id, company_id, role, name, active, email)
-- select id, null, 'provider', 'Portal Admin', true, email
--   from auth.users
--  where email = lower('PUT_YOUR_PROVIDER_EMAIL_HERE')
-- on conflict (id) do update set role = 'provider', active = true;
-- ============================================================================
