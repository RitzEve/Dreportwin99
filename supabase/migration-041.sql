-- =====================================================================
-- migration-041 — save only what changed (app_data_merge_delta)
-- =====================================================================
-- THE PROBLEM (2026-10-17 → 2026-10-27, five database crash-restarts):
-- every save sent the screen's WHOLE company record to app_data_merge, which
-- unpacked both copies (24,652 entries, 9 MB for the biggest company), grouped,
-- joined and re-packed them, then sent all 9 MB back. A save took 4 s (10 s for
-- 1 in 10); a few overlapping ones queued on the row for 30–80 s, timed out, were
-- retried by the app, and the pile-up ran the 1 GB server out of memory.
--
-- THE FIX: a second save function that receives only the rows the screen changed
-- ({ transactions:[…], banks:[…], members:[…], offDays:[…], nextId }), finds those
-- rows in the stored record by the same keys the full merge uses, merges each one
-- by the same rules, appends the new ones, and returns only the merged rows plus
-- the row's updated_at before and after. Untouched rows are never unpacked or
-- regrouped, and nothing large travels either way.
--
-- SAME RULES AS app_data_merge (migration-040), row by row:
--   transactions, offDays  key uid → '#'||id → md5; incoming fields win; deleted if
--                          EITHER side is deleted
--   banks                  key id → md5; the newer updatedAt wins, taken whole
--   members                key id → md5; newer updatedAt (plain whole number) wins the
--                          fields, else newer lastActivity; lastActivity = the later of
--                          the two; deleted if either side is deleted
--   nextId                 the higher of the two
-- A row the client leaves out is kept as stored — exactly what the full merge does
-- with a row that only one side has. So for a screen whose data equals the stored
-- record plus its changes, both functions produce the same record (tested on a copy
-- of the biggest company's record before applying).
--
-- If nothing would change (a repeated send), the record is not rewritten and
-- updated_at does not move.
--
-- app_data_merge stays as it is: screens still running the previous version keep
-- using it until they reload, and the app falls back to it if this function is
-- missing.
--
-- Undo: drop function public.app_data_merge_delta(uuid, jsonb);
--       (the app then falls back to app_data_merge by itself)
-- =====================================================================

create or replace function public.app_data_merge_delta(p_company_id uuid, p_delta jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
set statement_timeout to '20s'
set lock_timeout to '20s'
as $function$
declare
  v_data    jsonb;
  v_prev    timestamptz;
  v_now     timestamptz;
  v_rows    jsonb := '{}'::jsonb;   -- merged versions of the rows we touched, per collection
  v_changed boolean := false;
  v_arr     jsonb;
  v_inc     jsonb;                  -- incoming rows of one collection, key -> row
  v_hits    jsonb;                  -- array position (1-based, as text) -> merged row
  v_hit_keys text[];
  v_touched jsonb;
  v_fresh   jsonb;
  v_diff    boolean;
  v_next    bigint;
begin
  if p_company_id is distinct from public.my_company() then
    raise exception 'not authorized for this company';
  end if;
  if p_delta is null then p_delta := '{}'::jsonb; end if;

  insert into public.app_data (company_id, data, updated_at)
    values (p_company_id, '{}'::jsonb, now())
    on conflict (company_id) do nothing;

  select data, updated_at into v_data, v_prev
    from public.app_data where company_id = p_company_id for update;
  v_data := coalesce(v_data, '{}'::jsonb);

  -- ---------------- transactions + offDays (same rules) ----------------
  declare
    c text;
  begin
    foreach c in array array['transactions','offDays'] loop
      if jsonb_typeof(p_delta->c) = 'array' and jsonb_array_length(p_delta->c) > 0 then
        -- incoming, one row per key; deleted = OR within the side (as the full merge)
        select coalesce(jsonb_object_agg(k, t), '{}'::jsonb) into v_inc from (
          select k, (array_agg(t))[1] || jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean,false))) t
          from (select coalesce(value->>'uid','#'||(value->>'id'),md5(value::text)) k, value t
                  from jsonb_array_elements(p_delta->c)) z group by k) s;

        v_arr := coalesce(v_data->c, '[]'::jsonb);
        select coalesce(jsonb_object_agg(e.ord::text, m.t), '{}'::jsonb),
               coalesce(array_agg(m.k), '{}'),
               coalesce(jsonb_agg(m.t), '[]'::jsonb),
               coalesce(bool_or(m.t is distinct from e.value), false)
          into v_hits, v_hit_keys, v_touched, v_diff
          from jsonb_array_elements(v_arr) with ordinality e(value, ord)
          cross join lateral (select coalesce(e.value->>'uid','#'||(e.value->>'id'),md5(e.value::text)) k) kk
          cross join lateral (select kk.k,
                   (e.value || (v_inc->kk.k))
                   || jsonb_build_object('deleted',
                        coalesce((e.value->>'deleted')::boolean,false)
                        or coalesce(((v_inc->kk.k)->>'deleted')::boolean,false)) t) m
          where v_inc ? kk.k;

        if v_hits <> '{}'::jsonb then
          select coalesce(jsonb_agg(coalesce(v_hits->(e.ord::text), e.value) order by e.ord), '[]'::jsonb)
            into v_arr from jsonb_array_elements(v_arr) with ordinality e(value, ord);
        end if;

        select coalesce(jsonb_agg(i.value), '[]'::jsonb) into v_fresh
          from jsonb_each(v_inc) i where not (i.key = any(v_hit_keys));

        if v_diff or jsonb_array_length(v_fresh) > 0 then
          v_changed := true;
          v_data := jsonb_set(v_data, array[c], v_arr || v_fresh, true);
        end if;
        v_rows := v_rows || jsonb_build_object(c, v_touched || v_fresh);
      end if;
    end loop;
  end;

  -- ---------------- banks ----------------
  if jsonb_typeof(p_delta->'banks') = 'array' and jsonb_array_length(p_delta->'banks') > 0 then
    select coalesce(jsonb_object_agg(k, t), '{}'::jsonb) into v_inc from (
      select k, (array_agg(t order by coalesce((t->>'updatedAt')::bigint,0) desc))[1] t
      from (select coalesce(value->>'id',md5(value::text)) k, value t
              from jsonb_array_elements(p_delta->'banks')) z group by k) s;

    v_arr := coalesce(v_data->'banks', '[]'::jsonb);
    select coalesce(jsonb_object_agg(e.ord::text, m.t), '{}'::jsonb),
           coalesce(array_agg(m.k), '{}'),
           coalesce(jsonb_agg(m.t), '[]'::jsonb),
           coalesce(bool_or(m.t is distinct from e.value), false)
      into v_hits, v_hit_keys, v_touched, v_diff
      from jsonb_array_elements(v_arr) with ordinality e(value, ord)
      cross join lateral (select coalesce(e.value->>'id',md5(e.value::text)) k) kk
      cross join lateral (select kk.k,
               case when coalesce(((v_inc->kk.k)->>'updatedAt')::bigint,0) >= coalesce((e.value->>'updatedAt')::bigint,0)
                    then v_inc->kk.k else e.value end t) m
      where v_inc ? kk.k;

    if v_hits <> '{}'::jsonb then
      select coalesce(jsonb_agg(coalesce(v_hits->(e.ord::text), e.value) order by e.ord), '[]'::jsonb)
        into v_arr from jsonb_array_elements(v_arr) with ordinality e(value, ord);
    end if;
    select coalesce(jsonb_agg(i.value), '[]'::jsonb) into v_fresh
      from jsonb_each(v_inc) i where not (i.key = any(v_hit_keys));
    if v_diff or jsonb_array_length(v_fresh) > 0 then
      v_changed := true;
      v_data := jsonb_set(v_data, '{banks}', v_arr || v_fresh, true);
    end if;
    v_rows := v_rows || jsonb_build_object('banks', v_touched || v_fresh);
  end if;

  -- ---------------- members ----------------
  if jsonb_typeof(p_delta->'members') = 'array' and jsonb_array_length(p_delta->'members') > 0 then
    select coalesce(jsonb_object_agg(k, t), '{}'::jsonb) into v_inc from (
      select k, (array_agg(t order by coalesce(t->>'lastActivity','') desc))[1]
               || jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean,false))) t
      from (select coalesce(value->>'id',md5(value::text)) k, value t
              from jsonb_array_elements(p_delta->'members')) z group by k) s;

    v_arr := coalesce(v_data->'members', '[]'::jsonb);
    select coalesce(jsonb_object_agg(e.ord::text, m.t), '{}'::jsonb),
           coalesce(array_agg(m.k), '{}'),
           coalesce(jsonb_agg(m.t), '[]'::jsonb),
           coalesce(bool_or(m.t is distinct from e.value), false)
      into v_hits, v_hit_keys, v_touched, v_diff
      from jsonb_array_elements(v_arr) with ordinality e(value, ord)
      cross join lateral (select coalesce(e.value->>'id',md5(e.value::text)) k) kk
      cross join lateral (select v_inc->kk.k as i, e.value as c) p
      cross join lateral (select
          case when p.i->>'updatedAt' ~ '^[0-9]{1,15}$' then (p.i->>'updatedAt')::bigint else 0 end as iu,
          case when p.c->>'updatedAt' ~ '^[0-9]{1,15}$' then (p.c->>'updatedAt')::bigint else 0 end as cu,
          greatest(nullif(p.i->>'lastActivity',''), nullif(p.c->>'lastActivity','')) as la) x
      cross join lateral (select kk.k,
               (case
                  when x.iu > x.cu then p.c || p.i
                  when x.iu < x.cu then p.i || p.c
                  when coalesce(p.i->>'lastActivity','') >= coalesce(p.c->>'lastActivity','') then p.c || p.i
                  else p.i || p.c
                end)
               || case when x.la is null then '{}'::jsonb else jsonb_build_object('lastActivity', x.la) end
               || jsonb_build_object('deleted',
                    coalesce((p.c->>'deleted')::boolean,false) or coalesce((p.i->>'deleted')::boolean,false)) t) m
      where v_inc ? kk.k;

    if v_hits <> '{}'::jsonb then
      select coalesce(jsonb_agg(coalesce(v_hits->(e.ord::text), e.value) order by e.ord), '[]'::jsonb)
        into v_arr from jsonb_array_elements(v_arr) with ordinality e(value, ord);
    end if;
    select coalesce(jsonb_agg(i.value), '[]'::jsonb) into v_fresh
      from jsonb_each(v_inc) i where not (i.key = any(v_hit_keys));
    if v_diff or jsonb_array_length(v_fresh) > 0 then
      v_changed := true;
      v_data := jsonb_set(v_data, '{members}', v_arr || v_fresh, true);
    end if;
    v_rows := v_rows || jsonb_build_object('members', v_touched || v_fresh);
  end if;

  -- ---------------- nextId: the higher of the two ----------------
  v_next := greatest(coalesce((v_data->>'nextId')::bigint,0), coalesce((p_delta->>'nextId')::bigint,0));
  if v_data->'nextId' is null or (v_data->>'nextId')::bigint is distinct from v_next then
    v_changed := true;
    v_data := jsonb_set(v_data, '{nextId}', to_jsonb(v_next), true);
  end if;

  if v_changed then
    update public.app_data set data = v_data, updated_at = now()
      where company_id = p_company_id returning updated_at into v_now;
  else
    v_now := v_prev;
  end if;

  return jsonb_build_object(
    'updatedAt', v_now,
    'prevUpdatedAt', v_prev,
    'changed', v_changed,
    'rows', v_rows,
    'nextId', v_next);
end;
$function$;

revoke all on function public.app_data_merge_delta(uuid, jsonb) from public, anon;
grant execute on function public.app_data_merge_delta(uuid, jsonb) to authenticated;

-- VERIFY:
--   select array_to_string(proconfig, ', '), prosecdef, proacl::text
--     from pg_proc where proname = 'app_data_merge_delta';
--   -- expect: search_path=public, statement_timeout=20s, lock_timeout=20s | false |
--   --         no anon entry, authenticated=X
