-- =====================================================================
-- migration-043-rollback — undo the switch (NOT applied; kept ready)
-- =====================================================================
-- Puts each company's record back into the app_data TABLE, built from the rows (the rows
-- are the up-to-date data after the switch), and returns to the 042 state: saves write the
-- record AND the rows again, the owner dashboard reads the record. The new app functions
-- company_load / company_changes / company_save are removed, so a V2.9.4 screen falls back
-- to the V2.9.3 way of saving by itself.
-- =====================================================================

lock table public.company_sync in exclusive mode;   -- holds row saves while the record is rebuilt

drop view public.app_data;
drop trigger app_data_legacy_frozen on public.app_data_legacy;
drop function public.fin_legacy_frozen();

update public.app_data_legacy l
   set data = public.fin_build_blob(l.company_id), updated_at = s.updated_at
  from public.company_sync s
 where s.company_id = l.company_id;
insert into public.app_data_legacy (company_id, data, updated_at)
select s.company_id, public.fin_build_blob(s.company_id), s.updated_at
from public.company_sync s
where not exists (select 1 from public.app_data_legacy l where l.company_id = s.company_id);

alter table public.app_data_legacy rename to app_data;

-- saves go into both storages again (the 042 wrappers)
create or replace function public.app_data_merge(p_company_id uuid, p_incoming jsonb)
returns jsonb language plpgsql
set search_path to 'public' set statement_timeout to '20s' set lock_timeout to '20s'
as $function$
declare r jsonb;
begin
  r := public.app_data_merge_blob(p_company_id, p_incoming);
  perform public.fin_mirror(p_company_id, p_incoming);
  return r;
end;
$function$;

create or replace function public.app_data_merge_delta(p_company_id uuid, p_delta jsonb)
returns jsonb language plpgsql
set search_path to 'public' set statement_timeout to '20s' set lock_timeout to '20s'
as $function$
declare r jsonb;
begin
  r := public.app_data_merge_delta_blob(p_company_id, p_delta);
  if coalesce((r->>'changed')::boolean, false) then
    perform public.fin_mirror(p_company_id, p_delta);
  end if;
  return r;
end;
$function$;

-- the owner dashboard reads the record again (pre-043 body)
create or replace function public.owner_company_summaries(p_date text default null::text)
returns table(company_id uuid, name text, logo text, timezone text, as_of_date text,
              deposits_count integer, deposits_amount numeric, withdrawals_count integer,
              withdrawals_amount numeric, store_count_today integer, store_balance numeric,
              store_yesterday numeric, updated_at timestamp with time zone)
language plpgsql stable security definer set search_path to 'public'
as $function$
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
    where (t->>'type') = 'Regular Deposit' and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false and (t->>'date') = d.v_date
  ) dep on true
  left join lateral (
    select count(*)::integer cnt, coalesce(sum((t->>'amount')::numeric), 0) amt
    from jsonb_array_elements(coalesce(ad.data->'transactions', '[]'::jsonb)) t
    where (t->>'type') = 'Regular Withdrawal' and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false and (t->>'date') = d.v_date
  ) wd on true
  left join lateral (
    select
      count(*) filter (where (t->>'date') = d.v_date)::integer as day_cnt,
      coalesce(sum((t->>'amount')::numeric) filter (where (t->>'date') <= d.v_date), 0) as closing_amt,
      coalesce(sum((t->>'amount')::numeric) filter (
        where (t->>'date') <= to_char(d.v_date::date - interval '1 day', 'YYYY-MM-DD')
      ), 0) as prior_amt
    from jsonb_array_elements(coalesce(ad.data->'transactions', '[]'::jsonb)) t
    where (t->>'type') = 'Store' and coalesce((t->>'deleted')::boolean, false) = false
      and coalesce((t->>'fundLeg')::boolean, false) = false
  ) st on true
  where co.owner_id = auth.uid()
  order by c.name;
end;
$function$;

drop function public.company_load(uuid);
drop function public.company_changes(uuid, bigint);
drop function public.company_save(uuid, jsonb);

-- VERIFY:
--   select relkind from pg_class where oid = 'public.app_data'::regclass;    -- 'r' (table)
--   select count(*) from public.app_data;                                     -- = companies
