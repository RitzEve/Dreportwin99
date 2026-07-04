-- ============================================================================
-- Migration 013 — "Owner" accounts: one login, stats for every company they own
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS:
--   1. A new role, "owner" — a login that belongs to NO single company (like
--      provider) but is linked to one or more companies via a small new table,
--      company_owners. Only the provider can link/unlink companies to an owner.
--   2. owner_company_summaries() — a read-only function an owner account calls
--      to get TODAY's deposits/withdrawals and the Store balance for every
--      company it's linked to, computed INSIDE the database and returned as a
--      handful of small numbers per company, never each company's full
--      transaction history. This is deliberate: shipping every linked company's
--      full data blob to the browser on one overview page is exactly the kind
--      of thing that has caused Supabase egress/disk-space problems here before
--      (see the app_data_merge incidents in migration-012.sql) — this function
--      avoids that entirely.
--   3. Read-only access for an owner to view one company's REAL, full dashboard
--      on demand (drilling into a card) — same data a master would see. This is
--      deliberately READ-ONLY: every existing write policy in this file (insert/
--      update on app_data and profiles) is gated on `company_id = my_company()`,
--      and an owner's own company_id is always NULL (like provider's), so those
--      checks can never pass for an owner. Only the SELECT policies below are
--      extended — no insert/update policy is touched, so an owner cannot
--      create/edit anything in a company it views, by construction, not just by
--      convention.
--
-- Existing master/manager/staff logins and permissions are completely
-- unchanged. Nothing here removes or narrows any existing access.
-- ============================================================================

-- ---- 1) Allow the new 'owner' role on profiles -----------------------------

do $$
declare
  con record;
begin
  for con in
    select pgc.conname
    from pg_constraint pgc
    join pg_class rel on rel.oid = pgc.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'profiles' and pgc.contype = 'c'
      and pg_get_constraintdef(pgc.oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check check (role in ('provider','master','manager','staff','owner'));

-- ---- 2) Which companies each owner can see ---------------------------------

create table if not exists public.company_owners (
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, company_id)
);

alter table public.company_owners enable row level security;

drop policy if exists company_owners_select on public.company_owners;
create policy company_owners_select on public.company_owners for select to authenticated
  using ( public.my_role() = 'provider' or owner_id = auth.uid() );

drop policy if exists company_owners_insert on public.company_owners;
create policy company_owners_insert on public.company_owners for insert to authenticated
  with check ( public.my_role() = 'provider' );

drop policy if exists company_owners_delete on public.company_owners;
create policy company_owners_delete on public.company_owners for delete to authenticated
  using ( public.my_role() = 'provider' );

-- ---- 3) Read access for an owner into companies it's linked to -------------
-- (adds one more OR clause to each existing SELECT policy; nothing removed)

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (
    public.my_role() = 'provider'
    or id = public.my_company()
    or exists (
      select 1 from public.company_owners co
      where co.company_id = companies.id and co.owner_id = auth.uid()
    )
  );

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    public.my_role() = 'provider'
    or company_id = public.my_company()
    or id = auth.uid()
    or exists (
      select 1 from public.company_owners co
      where co.company_id = profiles.company_id and co.owner_id = auth.uid()
    )
  );

drop policy if exists app_data_select on public.app_data;
create policy app_data_select on public.app_data for select to authenticated
  using (
    company_id = public.my_company()
    or public.my_role() = 'provider'
    or exists (
      select 1 from public.company_owners co
      where co.company_id = app_data.company_id and co.owner_id = auth.uid()
    )
  );

-- (app_data_insert / app_data_update / profiles_insert / profiles_update /
-- profiles_delete are untouched — still gated on company_id = my_company(),
-- which is never true for an owner. This is what keeps the drill-in read-only.)

-- ---- 4) Today's key numbers for every company an owner is linked to -------
-- Store is a running BALANCE (not a daily flow — see FinTrack.jsx), so it
-- reports today's entry COUNT alongside the all-time balance and yesterday's
-- close, matching exactly what the Store stat card shows inside the app.
--
-- Postgres refuses to CREATE OR REPLACE a function whose return columns
-- changed ("cannot change return type of existing function") — it has to be
-- dropped first. Harmless if it doesn't exist yet (first-ever run).
drop function if exists public.owner_company_summaries();

create or replace function public.owner_company_summaries()
returns table (
  company_id          uuid,
  name                text,
  logo                text,
  timezone            text,
  as_of_date          text,
  deposits_count      integer,
  deposits_amount     numeric,
  withdrawals_count   integer,
  withdrawals_amount  numeric,
  store_count_today   integer,
  store_balance       numeric,
  store_yesterday     numeric,
  updated_at          timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then
    raise exception 'Not authorised.';
  end if;

  return query
  select
    c.id, c.name, c.logo, c.timezone,
    to_char(now() at time zone coalesce(c.timezone,'Australia/Sydney'), 'YYYY-MM-DD') as as_of_date,
    coalesce(dep.cnt, 0)::integer, coalesce(dep.amt, 0)::numeric,
    coalesce(wd.cnt, 0)::integer, coalesce(wd.amt, 0)::numeric,
    coalesce(st.today_cnt, 0)::integer, coalesce(st.all_amt, 0)::numeric, coalesce(st.yest_amt, 0)::numeric,
    ad.updated_at
  from public.company_owners co
  join public.companies c on c.id = co.company_id
  left join public.app_data ad on ad.company_id = c.id
  left join lateral (
    select count(*)::integer cnt, coalesce(sum((t->>'amount')::numeric), 0) amt
    from jsonb_array_elements(coalesce(ad.data->'transactions', '[]'::jsonb)) t
    where (t->>'type') = 'Regular Deposit'
      and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false
      and (t->>'date') = to_char(now() at time zone coalesce(c.timezone,'Australia/Sydney'), 'YYYY-MM-DD')
  ) dep on true
  left join lateral (
    select count(*)::integer cnt, coalesce(sum((t->>'amount')::numeric), 0) amt
    from jsonb_array_elements(coalesce(ad.data->'transactions', '[]'::jsonb)) t
    where (t->>'type') = 'Regular Withdrawal'
      and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false
      and (t->>'date') = to_char(now() at time zone coalesce(c.timezone,'Australia/Sydney'), 'YYYY-MM-DD')
  ) wd on true
  left join lateral (
    select
      count(*) filter (
        where (t->>'date') = to_char(now() at time zone coalesce(c.timezone,'Australia/Sydney'), 'YYYY-MM-DD')
      )::integer as today_cnt,
      coalesce(sum((t->>'amount')::numeric), 0) as all_amt,
      coalesce(sum((t->>'amount')::numeric) filter (
        where (t->>'date') <= to_char((now() at time zone coalesce(c.timezone,'Australia/Sydney')) - interval '1 day', 'YYYY-MM-DD')
      ), 0) as yest_amt
    from jsonb_array_elements(coalesce(ad.data->'transactions', '[]'::jsonb)) t
    where (t->>'type') = 'Store'
      and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false
  ) st on true
  where co.owner_id = auth.uid()
  order by c.name;
end;
$$;

grant execute on function public.owner_company_summaries() to authenticated;
