-- =====================================================================
-- migration-043 — row storage, step 2 of 2: the switch
-- =====================================================================
-- Runs after migration-042 and after every company has been copied with
-- `select public.fin_copy_company(<id>)` (one company per call). Since 042, every save has
-- been written into both the old record and the rows.
--
-- One short transaction:
--   1. lock app_data (saves in progress finish; new ones wait a moment)
--   2. check every company: its rows must equal its record row for row, and nextId must
--      match. Any company that differs (or was never copied) is copied again right here,
--      with its own row-for-row check (its change number keeps going up, never back to 1).
--      Old screens keep the same "last changed" stamp.
--   3. app_data -> app_data_legacy (frozen by a trigger, kept as the backup copy);
--      a view named app_data shows old screens the same columns, built from the rows
--   4. app_data_merge (V2.9.2) and app_data_merge_delta (V2.9.3) now save into the rows
--      only, with the same answers as before; the owner dashboard reads the rows
-- A save that was queued behind the lock and still aims at the old table hits the freeze
-- trigger and fails; the app retries it a few seconds later through the new path.
--
-- Undo: supabase/migration-043-rollback.sql (puts the record back from the rows).
-- =====================================================================

lock table public.app_data in access exclusive mode;

-- A company's change number (rev) must only ever go up: V2.9.4 screens ask "what changed after
-- number N?". So copying a company again continues its numbering instead of restarting at 1 —
-- every copied row gets the next number and an open screen simply receives all of them.
create or replace function public.fin_copy_company(p_company uuid) returns jsonb
language plpgsql set search_path to 'public' set lock_timeout to '10s' as $function$
declare
  v_data jsonb;
  v_at   timestamptz;
  v_rows bigint;
  v_bad  integer;
  v_rev  bigint;
begin
  select data, updated_at into v_data, v_at from public.app_data where company_id = p_company for update;
  if not found then return jsonb_build_object('company', left(p_company::text, 8), 'skipped', 'no record'); end if;
  select coalesce(max(s.rev), 0) + 1 into v_rev from public.company_sync s where s.company_id = p_company;
  delete from public.company_rows where company_id = p_company;
  delete from public.company_sync where company_id = p_company;
  insert into public.company_rows (company_id, kind, key, row, rev, updated_at)
  select p_company, k.kind, public.fin_row_key(k.kind, e.value), e.value, v_rev, coalesce(v_at, now())
  from unnest(array['transactions','banks','members','offDays']) k(kind)
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(v_data->k.kind) = 'array' then v_data->k.kind else '[]'::jsonb end) e(value)
  on conflict (company_id, kind, key) do nothing;
  get diagnostics v_rows = row_count;
  v_bad := public.fin_company_diff(p_company, v_data);
  if v_bad <> 0 then
    raise exception 'copy check failed for company %: % rows differ', left(p_company::text, 8), v_bad;
  end if;
  insert into public.company_sync (company_id, next_id, rev, updated_at)
    values (p_company, coalesce((v_data->>'nextId')::bigint, 0), v_rev, coalesce(v_at, now()));
  return jsonb_build_object('company', left(p_company::text, 8), 'rows', v_rows, 'rev', v_rev);
end;
$function$;
revoke all on function public.fin_copy_company(uuid) from public, anon, authenticated;

do $sync$
declare
  r        record;
  recopied text[] := '{}';
begin
  for r in select a.company_id from public.app_data a loop
    if not exists (select 1 from public.company_sync s where s.company_id = r.company_id)
       or public.fin_company_diff(r.company_id, (select a.data from public.app_data a where a.company_id = r.company_id)) <> 0
       or (select s.next_id from public.company_sync s where s.company_id = r.company_id)
          is distinct from (select coalesce((a.data->>'nextId')::bigint, 0) from public.app_data a where a.company_id = r.company_id)
    then
      perform public.fin_copy_company(r.company_id);
      recopied := recopied || left(r.company_id::text, 8);
    end if;
  end loop;
  -- old screens compare this stamp with the one they last saw: keep it unchanged
  update public.company_sync s set updated_at = a.updated_at
    from public.app_data a where a.company_id = s.company_id and a.updated_at is not null;
  if (select count(*) from public.app_data) <> (select count(*) from public.company_sync s
                                                where s.company_id in (select company_id from public.app_data)) then
    raise exception 'switch check failed — not every company has rows';
  end if;
  raise notice 'switch: companies copied again = %', recopied;
end
$sync$;

-- ---------------------------------------------------------------- freeze the old table
alter table public.app_data rename to app_data_legacy;

create function public.fin_legacy_frozen() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'app_data moved to company_rows (migration-043) — the app retries this save by itself';
end
$$;
create trigger app_data_legacy_frozen before insert or update on public.app_data_legacy
  for each row execute function public.fin_legacy_frozen();
revoke all on function public.fin_legacy_frozen() from public, anon, authenticated;

-- ---------------------------------------------------------------- what old screens read
create view public.app_data with (security_invoker = true) as
  select s.company_id, public.fin_build_blob(s.company_id) as data, s.updated_at
  from public.company_sync s;
revoke all on public.app_data from anon, authenticated;
grant select on public.app_data to authenticated;

-- ---------------------------------------------------------------- what old screens save
-- V2.9.2: the whole record in, the whole merged record back (as before).
create or replace function public.app_data_merge(p_company_id uuid, p_incoming jsonb)
returns jsonb language plpgsql
set search_path to 'public' set statement_timeout to '20s' set lock_timeout to '20s'
as $function$
begin
  perform public.fin_apply(p_company_id, p_incoming);
  return public.fin_build_blob(p_company_id);
end;
$function$;

-- V2.9.3: changed rows in, the same answer as migration-041.
create or replace function public.app_data_merge_delta(p_company_id uuid, p_delta jsonb)
returns jsonb language plpgsql
set search_path to 'public' set statement_timeout to '20s' set lock_timeout to '20s'
as $function$
declare r jsonb;
begin
  r := public.fin_apply(p_company_id, p_delta);
  return jsonb_build_object('updatedAt', r->'updatedAt', 'prevUpdatedAt', r->'prevUpdatedAt',
                            'changed', r->'changed', 'rows', r->'rows', 'nextId', r->'nextId');
end;
$function$;

-- ---------------------------------------------------------------- owner dashboard
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
    s.updated_at
  from public.company_owners co
  join public.companies c on c.id = co.company_id
  left join public.company_sync s on s.company_id = c.id
  cross join lateral (
    select coalesce(p_date, to_char(now() at time zone coalesce(c.timezone,'Australia/Sydney'), 'YYYY-MM-DD')) as v_date
  ) d
  left join lateral (
    select count(*)::integer cnt, coalesce(sum((r.row->>'amount')::numeric), 0) amt
    from public.company_rows r
    where r.company_id = c.id and r.kind = 'transactions'
      and (r.row->>'type') = 'Regular Deposit' and coalesce((r.row->>'deleted')::boolean, false) = false
      and coalesce((r.row->>'fundLeg')::boolean, false) = false and (r.row->>'date') = d.v_date
  ) dep on true
  left join lateral (
    select count(*)::integer cnt, coalesce(sum((r.row->>'amount')::numeric), 0) amt
    from public.company_rows r
    where r.company_id = c.id and r.kind = 'transactions'
      and (r.row->>'type') = 'Regular Withdrawal' and coalesce((r.row->>'deleted')::boolean, false) = false
      and coalesce((r.row->>'fundLeg')::boolean, false) = false and (r.row->>'date') = d.v_date
  ) wd on true
  left join lateral (
    select
      count(*) filter (where (r.row->>'date') = d.v_date)::integer as day_cnt,
      coalesce(sum((r.row->>'amount')::numeric) filter (where (r.row->>'date') <= d.v_date), 0) as closing_amt,
      coalesce(sum((r.row->>'amount')::numeric) filter (
        where (r.row->>'date') <= to_char(d.v_date::date - interval '1 day', 'YYYY-MM-DD')
      ), 0) as prior_amt
    from public.company_rows r
    where r.company_id = c.id and r.kind = 'transactions'
      and (r.row->>'type') = 'Store' and coalesce((r.row->>'deleted')::boolean, false) = false
      and coalesce((r.row->>'fundLeg')::boolean, false) = false
  ) st on true
  where co.owner_id = auth.uid()
  order by c.name;
end;
$function$;

-- VERIFY:
--   select relkind from pg_class where oid = 'public.app_data'::regclass;   -- 'v' (view)
--   select count(*) from public.company_sync;                               -- = companies with a record
--   select tgname from pg_trigger where tgrelid = 'public.app_data_legacy'::regclass and not tgisinternal;
