-- ============================================================================
-- Migration 014 — Owner overview: pick a date, not just "today"
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS CHANGES: owner_company_summaries() (added in migration-013.sql) gets
-- one new optional parameter, p_date. Pass a date (as 'YYYY-MM-DD' text) to see
-- that day's deposits/withdrawals and the Store balance as it stood at the end of
-- that day; pass nothing (or null) and it behaves exactly as before — each
-- company's own "today", per its own time zone.
--
-- Adding a parameter changes the function's signature, which (like the return-
-- column change in migration-013) Postgres won't let CREATE OR REPLACE do in
-- place — the old zero-argument version has to be dropped first.
-- ============================================================================

drop function if exists public.owner_company_summaries();

create or replace function public.owner_company_summaries(p_date text default null)
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
    d.v_date, -- the date every number below is scoped to (today, per company's own time zone, if none was picked)
    coalesce(dep.cnt, 0)::integer, coalesce(dep.amt, 0)::numeric,
    coalesce(wd.cnt, 0)::integer, coalesce(wd.amt, 0)::numeric,
    coalesce(st.day_cnt, 0)::integer, coalesce(st.closing_amt, 0)::numeric, coalesce(st.prior_amt, 0)::numeric,
    ad.updated_at
  from public.company_owners co
  join public.companies c on c.id = co.company_id
  left join public.app_data ad on ad.company_id = c.id
  cross join lateral (
    select coalesce(p_date, to_char(now() at time zone coalesce(c.timezone,'Australia/Sydney'), 'YYYY-MM-DD')) as v_date
  ) d
  left join lateral (
    select count(*)::integer cnt, coalesce(sum((t->>'amount')::numeric), 0) amt
    from jsonb_array_elements(coalesce(ad.data->'transactions', '[]'::jsonb)) t
    where (t->>'type') = 'Regular Deposit'
      and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false
      and (t->>'date') = d.v_date
  ) dep on true
  left join lateral (
    select count(*)::integer cnt, coalesce(sum((t->>'amount')::numeric), 0) amt
    from jsonb_array_elements(coalesce(ad.data->'transactions', '[]'::jsonb)) t
    where (t->>'type') = 'Regular Withdrawal'
      and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false
      and (t->>'date') = d.v_date
  ) wd on true
  left join lateral (
    -- Store is a running BALANCE (see FinTrack.jsx), not a daily flow: the "closing"
    -- amount is every Store entry dated on-or-before the chosen date (matches exactly
    -- what FinTrack's own Store card shows when you view a past date), and "prior" is
    -- the same thing one day earlier — the picked date's own "yesterday".
    select
      count(*) filter (where (t->>'date') = d.v_date)::integer as day_cnt,
      coalesce(sum((t->>'amount')::numeric) filter (where (t->>'date') <= d.v_date), 0) as closing_amt,
      coalesce(sum((t->>'amount')::numeric) filter (
        where (t->>'date') <= to_char(d.v_date::date - interval '1 day', 'YYYY-MM-DD')
      ), 0) as prior_amt
    from jsonb_array_elements(coalesce(ad.data->'transactions', '[]'::jsonb)) t
    where (t->>'type') = 'Store'
      and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false
  ) st on true
  where co.owner_id = auth.uid()
  order by c.name;
end;
$$;

grant execute on function public.owner_company_summaries(text) to authenticated;
