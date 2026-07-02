-- ============================================================================
-- Migration 012 — CRITICAL: stop app_data_merge from exploding a company's data
-- ============================================================================
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to run more than once.
--
-- THE BUG: app_data_merge unions each array with a FULL OUTER JOIN on a key
-- (members/banks by id, transactions/offDays by uid). A SQL join is NOT a dedupe —
-- if the SAME key appears on BOTH sides, the join emits one row PER PAIR (N x M).
-- The client loads whatever is stored and sends it straight back, so once a blob
-- picked up a duplicate key it doubled/squared on every save until the merge hit
-- the 8-second statement timeout (SQLSTATE 57014). After that EVERY save failed
-- silently, so new entries "vanished" on refresh.
--
-- THE FIX: reduce each side to ONE row per key BEFORE the join, so the join can no
-- longer multiply. The key falls back to a hash of the row's own content, so
-- identical duplicate rows (what the explosion produced) collapse, while genuinely
-- distinct rows are kept. Each block keeps its original merge rules. Then a one-time
-- pass collapses any bloat already sitting in every company's stored data.
-- ============================================================================

create or replace function public.app_data_merge(p_company_id uuid, p_incoming jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current jsonb;
  v_tx      jsonb;
  v_banks   jsonb;
  v_members jsonb;
  v_offdays jsonb;
  v_merged  jsonb;
begin
  if p_company_id is distinct from public.my_company() then
    raise exception 'not authorized for this company';
  end if;
  if p_incoming is null then p_incoming := '{}'::jsonb; end if;

  insert into public.app_data (company_id, data, updated_at)
    values (p_company_id, '{}'::jsonb, now())
    on conflict (company_id) do nothing;

  select data into v_current from public.app_data where company_id = p_company_id for update;
  v_current := coalesce(v_current, '{}'::jsonb);

  -- transactions: key = uid (fallback '#'||id, then content hash so identical dupes
  -- collapse). Each side pre-reduced to one row per key (deleted = OR within side),
  -- then merged: incoming fields win; deleted stays true if EITHER side has it.
  with cur as (
    select k, (array_agg(t))[1] || jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean,false))) t
    from (select coalesce(value->>'uid','#'||(value->>'id'),md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(v_current->'transactions','[]'::jsonb))) z group by k
  ), inc as (
    select k, (array_agg(t))[1] || jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean,false))) t
    from (select coalesce(value->>'uid','#'||(value->>'id'),md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(p_incoming->'transactions','[]'::jsonb))) z group by k
  )
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_tx from (
    select (coalesce(c.t,'{}'::jsonb) || coalesce(i.t,'{}'::jsonb))
             || jsonb_build_object('deleted',
                  coalesce((c.t->>'deleted')::boolean,false) or coalesce((i.t->>'deleted')::boolean,false)) as t
    from cur c full outer join inc i on c.k = i.k
  ) s;

  -- banks: key = id (fallback content hash). Newer updatedAt wins, taken WHOLE.
  with cur as (
    select k, (array_agg(t order by coalesce((t->>'updatedAt')::bigint,0) desc))[1] t
    from (select coalesce(value->>'id',md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(v_current->'banks','[]'::jsonb))) z group by k
  ), inc as (
    select k, (array_agg(t order by coalesce((t->>'updatedAt')::bigint,0) desc))[1] t
    from (select coalesce(value->>'id',md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(p_incoming->'banks','[]'::jsonb))) z group by k
  )
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_banks from (
    select case
             when c.t is null then i.t
             when i.t is null then c.t
             when coalesce((i.t->>'updatedAt')::bigint,0) >= coalesce((c.t->>'updatedAt')::bigint,0) then i.t
             else c.t
           end as t
    from cur c full outer join inc i on c.k = i.k
  ) s;

  -- members: key = id (fallback content hash). Newer lastActivity wins; fields merged.
  with cur as (
    select k, (array_agg(t order by coalesce(t->>'lastActivity','') desc))[1] t
    from (select coalesce(value->>'id',md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(v_current->'members','[]'::jsonb))) z group by k
  ), inc as (
    select k, (array_agg(t order by coalesce(t->>'lastActivity','') desc))[1] t
    from (select coalesce(value->>'id',md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(p_incoming->'members','[]'::jsonb))) z group by k
  )
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_members from (
    select case
             when c.t is null then i.t
             when i.t is null then c.t
             when coalesce(i.t->>'lastActivity','') >= coalesce(c.t->>'lastActivity','') then c.t || i.t
             else i.t || c.t
           end as t
    from cur c full outer join inc i on c.k = i.k
  ) s;

  -- offDays: same rules as transactions (key by uid; deleted = OR; incoming wins).
  with cur as (
    select k, (array_agg(t))[1] || jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean,false))) t
    from (select coalesce(value->>'uid','#'||(value->>'id'),md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(v_current->'offDays','[]'::jsonb))) z group by k
  ), inc as (
    select k, (array_agg(t))[1] || jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean,false))) t
    from (select coalesce(value->>'uid','#'||(value->>'id'),md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(p_incoming->'offDays','[]'::jsonb))) z group by k
  )
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_offdays from (
    select (coalesce(c.t,'{}'::jsonb) || coalesce(i.t,'{}'::jsonb))
             || jsonb_build_object('deleted',
                  coalesce((c.t->>'deleted')::boolean,false) or coalesce((i.t->>'deleted')::boolean,false)) as t
    from cur c full outer join inc i on c.k = i.k
  ) s;

  v_merged := jsonb_build_object(
    'transactions', v_tx,
    'banks',        v_banks,
    'members',      v_members,
    'offDays',      v_offdays,
    'nextId',       greatest(coalesce((v_current->>'nextId')::bigint,0), coalesce((p_incoming->>'nextId')::bigint,0))
  );

  update public.app_data set data = v_merged, updated_at = now() where company_id = p_company_id;
  return v_merged;
end;
$$;

grant execute on function public.app_data_merge(uuid, jsonb) to authenticated;

-- ---- one-time heal: collapse any bloat already stored ----------------------
-- Dedupe an array to one row per key, keeping the FIRST occurrence and its order
-- (so a healthy company's data is returned unchanged — this is a no-op for them).
create or replace function public._dd(arr jsonb, use_uid boolean)
returns jsonb language sql as $$
  with e as (
    select val, ord,
      case when use_uid
           then coalesce(val->>'uid','#'||(val->>'id'),md5(val::text))
           else coalesce(val->>'id',md5(val::text)) end as k
    from jsonb_array_elements(coalesce(arr,'[]'::jsonb)) with ordinality as x(val, ord)
  ), firsts as (
    select distinct on (k) k, val, ord from e order by k, ord
  )
  select coalesce(jsonb_agg(val order by ord), '[]'::jsonb) from firsts;
$$;

update public.app_data set
  data = data || jsonb_build_object(
    'transactions', public._dd(data->'transactions', true),
    'banks',        public._dd(data->'banks', false),
    'members',      public._dd(data->'members', false),
    'offDays',      public._dd(data->'offDays', true)
  ),
  updated_at = now()
where jsonb_typeof(data) = 'object';

drop function public._dd(jsonb, boolean);
