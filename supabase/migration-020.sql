-- ============================================================================
-- Migration 020 — Sub-provider role, and a real month-by-month rental log
-- ============================================================================
-- Run the SAME way as always: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
-- ============================================================================


-- ============================================================================
-- PART 1 — "Sub-provider": a second admin login with one restriction
-- ============================================================================
-- WHY: the provider account can do everything. A sub-provider can do
-- everything EXCEPT delete a company. Rule of thumb used everywhere below:
-- a sub-provider can freely manage companies, masters, managers, staff and
-- owners — but can never touch (create, edit, deactivate, delete, or reset
-- the password of) another provider or sub-provider login. That last part
-- isn't something you asked for explicitly, but it's the same "can only
-- manage roles below you" rule this app already uses for master/manager —
-- without it, a sub-provider could reset the real provider's password and
-- lock everyone else out, which clearly isn't the intent of "one restriction."

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('provider','sub-provider','master','manager','staff','owner'));

-- Shorthand used across the policies below: true for provider AND sub-provider.
create or replace function public.is_provider_tier()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('provider','sub-provider')
$$;
grant execute on function public.is_provider_tier() to authenticated;
revoke execute on function public.is_provider_tier() from public, anon;

-- ---- Company management: full provider-tier access, EXCEPT delete ----------
alter policy companies_select on public.companies
using (
  public.is_provider_tier()
  or id = public.my_company()
  or exists (
    select 1 from public.company_owners co
    where co.company_id = companies.id and co.owner_id = (select auth.uid())
  )
);
alter policy companies_insert on public.companies
with check ( public.is_provider_tier() );
alter policy companies_update on public.companies
using ( public.is_provider_tier() ) with check ( public.is_provider_tier() );
-- companies_delete is DELIBERATELY left untouched — still my_role()='provider' only.

-- ---- Owner-login management: full provider-tier access ---------------------
alter policy company_owners_select on public.company_owners
using ( public.is_provider_tier() or owner_id = (select auth.uid()) );
alter policy company_owners_insert on public.company_owners
with check ( public.is_provider_tier() );
alter policy company_owners_delete on public.company_owners
using ( public.is_provider_tier() );

-- ---- Rental-fee billing: full provider-tier access --------------------------
alter policy company_billing_select on public.company_billing
using ( public.is_provider_tier() );
alter policy company_billing_insert on public.company_billing
with check ( public.is_provider_tier() );
alter policy company_billing_update on public.company_billing
using ( public.is_provider_tier() ) with check ( public.is_provider_tier() );
alter policy company_billing_delete on public.company_billing
using ( public.is_provider_tier() );

-- ---- Company financial data: full provider-tier read access ----------------
alter policy app_data_select on public.app_data
using (
  (company_id = public.my_company())
  or public.is_provider_tier()
  or exists (
    select 1 from public.company_owners co
    where co.company_id = app_data.company_id and co.owner_id = (select auth.uid())
  )
);

-- ---- Account management: provider-tier, EXCEPT touching provider-tier rows -
-- Reading the list of accounts is low-risk either way, so SELECT stays a
-- simple provider-tier check. Creating/editing/deactivating/deleting is where
-- the guard matters — a sub-provider's branch excludes role='provider' and
-- role='sub-provider' as a TARGET, both for what it can INSERT and what
-- existing rows it can touch. A full provider is unrestricted, exactly as
-- before this migration.
alter policy profiles_select on public.profiles
using (
  public.is_provider_tier()
  or company_id = public.my_company()
  or id = (select auth.uid())
  or exists (
    select 1 from public.company_owners co
    where co.company_id = profiles.company_id and co.owner_id = (select auth.uid())
  )
);
alter policy profiles_insert on public.profiles
with check (
  (my_role() = 'provider')
  or (my_role() = 'sub-provider' and role not in ('provider','sub-provider'))
  or (my_role() = 'master' and company_id = my_company() and role in ('manager','staff'))
  or (my_role() = 'manager' and company_id = my_company() and role = 'staff')
);
alter policy profiles_update on public.profiles
using (
  (my_role() = 'provider')
  or (my_role() = 'sub-provider' and role not in ('provider','sub-provider'))
  or (my_role() = 'master' and company_id = my_company() and role in ('manager','staff'))
  or (my_role() = 'manager' and company_id = my_company() and role = 'staff')
)
with check (
  (my_role() = 'provider')
  or (my_role() = 'sub-provider' and role not in ('provider','sub-provider'))
  or (my_role() = 'master' and company_id = my_company() and role in ('manager','staff'))
  or (my_role() = 'manager' and company_id = my_company() and role = 'staff')
);
alter policy profiles_delete on public.profiles
using (
  (my_role() = 'provider')
  or (my_role() = 'sub-provider' and role not in ('provider','sub-provider'))
  or (my_role() = 'master' and company_id = my_company() and role in ('manager','staff'))
  or (my_role() = 'manager' and company_id = my_company() and role = 'staff')
);

-- ---- The 5 admin SECURITY DEFINER functions (bypass RLS — their own internal
-- checks are the real gate, same hierarchy rule applied) --------------------

create or replace function public.admin_delete_account(target_id uuid)
returns void language plpgsql security definer set search_path to 'public', 'auth' as $function$
declare
  caller_role text; caller_company uuid; t_role text; t_company uuid;
begin
  select role, company_id into caller_role, caller_company from public.profiles where id = auth.uid();
  select role, company_id into t_role, t_company from public.profiles where id = target_id;
  if t_role is null then raise exception 'Account not found.'; end if;
  if caller_role = 'provider'
     or (caller_role = 'sub-provider' and t_role not in ('provider','sub-provider'))
     or (caller_role = 'master'  and t_company = caller_company and t_role in ('manager','staff'))
     or (caller_role = 'manager' and t_company = caller_company and t_role = 'staff')
  then
    delete from auth.users where id = target_id;
  else
    raise exception 'Not authorised.';
  end if;
end;
$function$;

create or replace function public.admin_purge_orphan_logins()
returns integer language plpgsql security definer set search_path to 'public', 'auth' as $function$
declare
  caller_role text; n integer;
begin
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role not in ('provider','sub-provider') then
    raise exception 'Not authorised.';
  end if;
  with deleted as (
    delete from auth.users
     where not exists (select 1 from public.profiles where profiles.id = auth.users.id)
     returning 1
  )
  select count(*) into n from deleted;
  return n;
end;
$function$;

create or replace function public.admin_set_email(target_id uuid, new_email text)
returns void language plpgsql security definer set search_path to 'public', 'auth', 'extensions' as $function$
declare
  caller_role text; caller_company uuid; t_role text; t_company uuid; norm_email text;
begin
  norm_email := lower(trim(new_email));
  if norm_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email.';
  end if;
  select role, company_id into caller_role, caller_company from public.profiles where id = auth.uid();
  select role, company_id into t_role, t_company from public.profiles where id = target_id;
  if t_role is null then raise exception 'Account not found.'; end if;
  if exists (select 1 from auth.users where lower(email) = norm_email and id <> target_id) then
    raise exception 'That email is already in use.';
  end if;
  if caller_role = 'provider'
     or (caller_role = 'sub-provider' and t_role not in ('provider','sub-provider'))
     or (caller_role = 'master'  and t_company = caller_company and t_role in ('manager','staff'))
     or (caller_role = 'manager' and t_company = caller_company and t_role = 'staff')
  then
    update auth.users set email = norm_email,
      email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = target_id;
    update public.profiles set email = norm_email where id = target_id;
  else raise exception 'Not authorised.'; end if;
end; $function$;

create or replace function public.admin_set_password(target_id uuid, new_password text)
returns void language plpgsql security definer set search_path to 'public', 'auth', 'extensions' as $function$
declare
  caller_role text; caller_company uuid; t_role text; t_company uuid;
begin
  if length(coalesce(new_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;
  select role, company_id into caller_role, caller_company from public.profiles where id = auth.uid();
  select role, company_id into t_role, t_company from public.profiles where id = target_id;
  if t_role is null then raise exception 'Account not found.'; end if;
  if caller_role = 'provider'
     or (caller_role = 'sub-provider' and t_role not in ('provider','sub-provider'))
     or (caller_role = 'master'  and t_company = caller_company and t_role in ('manager','staff'))
     or (caller_role = 'manager' and t_company = caller_company and t_role = 'staff')
  then
    update auth.users
       set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
           updated_at = now()
     where id = target_id;
  else
    raise exception 'Not authorised.';
  end if;
end;
$function$;

-- admin_delete_company is DELIBERATELY left untouched — still provider-only.
-- (No statement here on purpose — nothing to change.)

grant execute on function public.admin_delete_account(uuid)     to authenticated;
grant execute on function public.admin_purge_orphan_logins()    to authenticated;
grant execute on function public.admin_set_email(uuid, text)    to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
revoke execute on function public.admin_delete_account(uuid)     from public, anon;
revoke execute on function public.admin_purge_orphan_logins()    from public, anon;
revoke execute on function public.admin_set_email(uuid, text)    from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;


-- ============================================================================
-- PART 2 — A real month-by-month rental-payment log
-- ============================================================================
-- WHY: the old company_billing table only ever stored ONE "currently paid?"
-- flag per company, which got silently overwritten every time it changed —
-- there was no way to know what was paid last month, or the month before.
-- This adds a proper log: one row per company per month, so "paid this
-- month" is a real fact you can check, and past months stay on record
-- forever instead of being overwritten.

create table if not exists public.company_billing_payments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  period       text not null,             -- 'YYYY-MM' — the month this payment covers
  amount       numeric,
  paid_at      timestamptz not null default now(),
  recorded_by  uuid references auth.users(id) on delete set null,
  constraint company_billing_payments_period_format check (period ~ '^\d{4}-\d{2}$'),
  constraint company_billing_payments_company_period_key unique (company_id, period)
);
create index if not exists idx_company_billing_payments_company on public.company_billing_payments(company_id);

alter table public.company_billing_payments enable row level security;

drop policy if exists company_billing_payments_select on public.company_billing_payments;
create policy company_billing_payments_select on public.company_billing_payments for select to authenticated
  using ( public.is_provider_tier() );

drop policy if exists company_billing_payments_insert on public.company_billing_payments;
create policy company_billing_payments_insert on public.company_billing_payments for insert to authenticated
  with check ( public.is_provider_tier() );

drop policy if exists company_billing_payments_update on public.company_billing_payments;
create policy company_billing_payments_update on public.company_billing_payments for update to authenticated
  using ( public.is_provider_tier() ) with check ( public.is_provider_tier() );

drop policy if exists company_billing_payments_delete on public.company_billing_payments;
create policy company_billing_payments_delete on public.company_billing_payments for delete to authenticated
  using ( public.is_provider_tier() );

grant select, insert, update, delete on public.company_billing_payments to authenticated;

-- Bulk "mark paid / unpaid" — SECURITY INVOKER (runs as the caller, not a
-- bypass): the RLS policies above are the real gate, same as app_data_merge
-- elsewhere in this app. Each company's OWN configured rental_fee is used
-- automatically — nobody has to type an amount when marking several
-- companies paid at once. Pass an array even for a single company.

create or replace function public.mark_rent_paid(company_ids uuid[])
returns setof public.company_billing_payments
language plpgsql security invoker set search_path = public as $$
declare
  v_period text := to_char(now(), 'YYYY-MM');
begin
  if not public.is_provider_tier() then
    raise exception 'Not authorised.';
  end if;
  -- LEFT JOIN on purpose: a brand-new company might not have a company_billing
  -- row yet (only created the first time someone edits its Started/Rent
  -- fields) — this must still record a payment for it (amount NULL until a
  -- rent amount is set), not silently insert nothing.
  return query
  insert into public.company_billing_payments (company_id, period, amount, paid_at, recorded_by)
  select c.id, v_period, cb.rental_fee, now(), auth.uid()
  from public.companies c
  left join public.company_billing cb on cb.company_id = c.id
  where c.id = any(company_ids)
  on conflict (company_id, period) do update
    set amount = excluded.amount, paid_at = excluded.paid_at, recorded_by = excluded.recorded_by
  returning *;
end;
$$;

create or replace function public.mark_rent_unpaid(company_ids uuid[])
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_period text := to_char(now(), 'YYYY-MM');
begin
  if not public.is_provider_tier() then
    raise exception 'Not authorised.';
  end if;
  delete from public.company_billing_payments
  where company_id = any(company_ids) and period = v_period;
end;
$$;

-- New Postgres functions grant EXECUTE to PUBLIC by default unless revoked —
-- the exact gap migration-017 closed for the other admin functions. Same fix
-- here from day one rather than leaving it to a future audit to catch.
grant execute on function public.mark_rent_paid(uuid[])   to authenticated;
grant execute on function public.mark_rent_unpaid(uuid[]) to authenticated;
revoke execute on function public.mark_rent_paid(uuid[])   from public, anon;
revoke execute on function public.mark_rent_unpaid(uuid[]) from public, anon;

-- Backfill: any company currently marked paid keeps that as THIS month's
-- payment record, so nobody's current status silently resets to "unpaid"
-- the moment this ships.
insert into public.company_billing_payments (company_id, period, amount, paid_at)
select company_id, to_char(now(), 'YYYY-MM'), rental_fee, coalesce(rental_paid_at, now())
from public.company_billing
where rental_paid = true
on conflict (company_id, period) do nothing;

-- The old single sticky flag is now fully replaced by the log above.
alter table public.company_billing drop column if exists rental_paid;
alter table public.company_billing drop column if exists rental_paid_at;
