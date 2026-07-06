-- ============================================================================
-- Migration 018 — close the two remaining audit findings that are fixable here
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- The third finding from the audit — Supabase's "Leaked password protection"
-- being off — is a project SETTING, not something a SQL migration can change.
-- Turn it on yourself: Supabase dashboard → Authentication → look for
-- "Leaked password protection" (under Policies/Providers depending on your
-- dashboard version) → enable it. One toggle, nothing else needed.
-- ============================================================================

-- ---- 1) Rate-limit the public Name/ID -> email lookup -----------------------
-- WHY: email_for_login() has to stay callable by anyone, signed in or not (it
-- runs before sign-in) and has to keep returning the real email (the app needs
-- it to complete sign-in) — so calling it directly, bypassing the app's own
-- generic "incorrect Name/ID or password" message, can reveal whether a given
-- Name/ID exists and what email it's tied to. This can't be fully closed
-- without a much bigger redesign (a server-side login endpoint that never
-- hands the client an email at all), but a simple global rate limit meaningfully
-- blocks the realistic version of this risk — a fast automated sweep through
-- many Name/IDs — without touching how a real person logging in behaves.
--
-- A single counter row, reset every 60 seconds: once more than 30 lookups have
-- happened system-wide in the current window, every call just returns "not
-- found" for the rest of that window, no matter what was typed in. 30/minute
-- is far above what real login traffic on this app ever looks like.

create table if not exists public._login_lookup_ratelimit (
  id           boolean primary key default true,
  window_start timestamptz not null default now(),
  count        integer not null default 0,
  constraint _login_lookup_ratelimit_singleton check (id)
);
insert into public._login_lookup_ratelimit (id) values (true) on conflict (id) do nothing;

-- RLS on with zero policies: nobody can read or write this row directly via
-- the REST API. It's only ever touched from inside email_for_login() below,
-- which runs as SECURITY DEFINER and bypasses RLS.
alter table public._login_lookup_ratelimit enable row level security;

create or replace function public.email_for_login(identifier text)
returns text
language plpgsql security definer
set search_path = public
set statement_timeout = '3s'
as $$
declare
  e text;
  v_count integer;
begin
  update public._login_lookup_ratelimit
     set count        = case when now() - window_start > interval '60 seconds' then 1 else count + 1 end,
         window_start = case when now() - window_start > interval '60 seconds' then now() else window_start end
   where id = true
  returning count into v_count;

  if v_count > 30 then
    return null;
  end if;

  if position('@' in identifier) > 0 then
    return lower(trim(identifier));
  end if;
  select p.email into e
    from public.profiles p
   where lower(p.username) = lower(trim(identifier))
   limit 1;
  return e;
end;
$$;
grant execute on function public.email_for_login(text) to anon, authenticated;

-- ---- 2) Fix a logic gap in owner_company_summaries()'s authorisation check --
-- WHY: `if public.my_role() <> 'owner' then raise exception ...; end if;` has
-- no ELSE. For a caller with no profile at all (including an anonymous
-- request), my_role() returns NULL, and `NULL <> 'owner'` is itself NULL —
-- PL/pgSQL treats a NULL IF-condition as false, so the exception silently does
-- NOT fire, and execution falls through to the query below. This was never
-- actually exploitable: the query's own `where co.owner_id = auth.uid()` also
-- evaluates to NULL (so zero rows) for the same NULL-uid caller — but the
-- intended gate wasn't doing what it looked like it did. Switching to
-- `is distinct from` makes the comparison itself NULL-safe, so the check
-- actually raises for a NULL role too, giving this its own real gate instead
-- of leaning entirely on the query's incidental protection.
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
  if public.my_role() is distinct from 'owner' then
    raise exception 'Not authorised.';
  end if;

  return query
  select
    c.id, c.name, c.logo, c.timezone,
    d.v_date,
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
