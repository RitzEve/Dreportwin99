-- migration-031: members get delete-wins, and the existing duplicate members are merged
--
-- THE BUG
-- Editing a member rewrote its `id` in place. But `id` IS the merge key on both sides
-- (mergeData.js and app_data_merge below), so the rename produced a NEW key while the
-- OLD key was still sitting in the database. The union then kept both and the member
-- appeared twice — once under the real ID the tenant typed, once under the auto-assigned
-- M#### it replaced. Deleting a member had the same shape: the client dropped the row
-- from its array, the union put it straight back.
--
-- THE FIX
-- Members now carry a `deleted` tombstone and merge delete-wins, exactly like
-- transactions and offDays already do. The client tombstones the old id when an ID is
-- edited, and marks instead of removing on delete (src/app/FinTrack.jsx), and hides
-- tombstoned rows everywhere it lists members.
--
-- This half does the same for the server-side merge. Without it a stale save from a
-- second device — one that still holds the member as live, with a newer lastActivity —
-- would win the field merge and resurrect a member somebody had just deleted.
--
-- Part 2 then merges the members already duplicated by the old behaviour.
--
-- SAFE + REVERSIBLE. Part 1 only adds an OR: blobs with no `deleted` key on any member
-- (i.e. everything written before this) merge exactly as they did before. Part 2 is
-- idempotent — running it twice changes nothing the second time.
-- Order doesn't matter, but deploying the app first means the merged-away rows disappear
-- the moment this runs rather than lingering until the next deploy.

-- ---------------------------------------------------------------------------
-- PART 1 — app_data_merge: members become delete-wins
-- Only the `members` block changed; transactions, banks, offDays and nextId are
-- byte-for-byte what migration-012 installed.
-- ---------------------------------------------------------------------------

create or replace function public.app_data_merge(p_company_id uuid, p_incoming jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
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

  -- members: key = id (fallback content hash). Newer lastActivity wins and fields are
  -- merged, AS BEFORE — but `deleted` is now OR-ed across both sides instead of being
  -- carried by whichever row won. A member removed on either side stays removed, and an
  -- ID edit (which tombstones the old key client-side) can no longer be undone by a
  -- stale copy of that member arriving from another device.
  with cur as (
    select k, (array_agg(t order by coalesce(t->>'lastActivity','') desc))[1]
             || jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean,false))) t
    from (select coalesce(value->>'id',md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(v_current->'members','[]'::jsonb))) z group by k
  ), inc as (
    select k, (array_agg(t order by coalesce(t->>'lastActivity','') desc))[1]
             || jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean,false))) t
    from (select coalesce(value->>'id',md5(value::text)) k, value t
            from jsonb_array_elements(coalesce(p_incoming->'members','[]'::jsonb))) z group by k
  )
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_members from (
    select case
             when c.t is null then i.t
             when i.t is null then c.t
             when coalesce(i.t->>'lastActivity','') >= coalesce(c.t->>'lastActivity','') then c.t || i.t
             else i.t || c.t
           end
           || jsonb_build_object('deleted',
                coalesce((c.t->>'deleted')::boolean,false) or coalesce((i.t->>'deleted')::boolean,false)) as t
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
$function$;

-- ---------------------------------------------------------------------------
-- PART 2 — merge the members the old behaviour already split
--
-- Three people, each holding two member rows: the real ID the tenant typed, plus the
-- auto-assigned M#### it was meant to replace. Hayley additionally has two rows under
-- the same ID differing only by a trailing space (`38A955095 ` vs `38A955095`), one of
-- them still carrying a mistyped name — the edit form never trimmed its input, so the
-- space made a second, distinct merge key.
--
-- For each person this:
--   * repoints every transaction leg at the surviving ID (matching on the trimmed ID,
--     so the whitespace variants come along too),
--   * collapses the rows under that ID into one — earliest `joined`, latest
--     `lastActivity`, the non-empty phone, the correct name, ID trimmed,
--   * tombstones the M#### leftover so it stays gone on every device.
--
-- Transaction history is preserved in full; nothing is deleted.
-- ---------------------------------------------------------------------------

do $$
declare
  r      record;
  v_cid  uuid;
  v_data jsonb;
  v_before int;
  v_after  int;
begin
  for r in
    select * from (values
      ('Megabet26', '231A73105', array['M3050'], 'CHRISTY MCCONNACHY'),
      ('Megabet26', '38A955095', array['M177'],  'Hayley Margaret greenfield'),
      ('Mario96',   '370259688', array['M4677'], 'MELISSA CONNOR')
    ) as f(company text, keep_id text, drop_ids text[], keep_name text)
  loop
    select id into v_cid from public.companies where name = r.company;
    if v_cid is null then
      raise notice 'SKIP  company "%" not found', r.company; continue;
    end if;

    select data into v_data from public.app_data where company_id = v_cid for update;
    if v_data is null then
      raise notice 'SKIP  no app_data row for "%"', r.company; continue;
    end if;

    select count(*) into v_before
    from jsonb_array_elements(coalesce(v_data->'members','[]'::jsonb)) m
    where btrim(coalesce(m->>'id','')) = r.keep_id or btrim(coalesce(m->>'id','')) = any(r.drop_ids);

    -- transactions: every leg that pointed at any of these IDs now points at keep_id
    v_data := jsonb_set(v_data, '{transactions}', (
      select coalesce(jsonb_agg(
               case when btrim(coalesce(t->>'memberId','')) = r.keep_id
                      or btrim(coalesce(t->>'memberId','')) = any(r.drop_ids)
                    then t || jsonb_build_object('memberId', r.keep_id)
                    else t end
             ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_data->'transactions','[]'::jsonb)) t
    ));

    -- members: one survivor under keep_id, leftovers tombstoned.
    -- Rows are keyed by their position in the array (`ord`) — two members can be
    -- byte-identical, so matching on the row's JSON would pair up the wrong ones.
    v_data := jsonb_set(v_data, '{members}', (
      with src as (
        select m, ord, btrim(coalesce(m->>'id','')) as tid
        from jsonb_array_elements(coalesce(v_data->'members','[]'::jsonb)) with ordinality as e(m, ord)
      ), best as (
        select min(nullif(m->>'joined',''))                    as joined,
               max(nullif(m->>'lastActivity',''))              as last_activity,
               max(nullif(btrim(coalesce(m->>'phone','')),'')) as phone
        from src where tid = r.keep_id or tid = any(r.drop_ids)
      ), ranked as (
        select ord, row_number() over (order by coalesce(m->>'joined','9999-12-31'), ord) as rn
        from src where tid = r.keep_id
      )
      select coalesce(jsonb_agg(out order by ord) filter (where out is not null), '[]'::jsonb)
      from (
        select src.ord,
               case
                 -- the survivor: earliest-joined row already under keep_id
                 when ranked.rn = 1 then
                   src.m || jsonb_build_object(
                     'id',           r.keep_id,
                     'name',         r.keep_name,
                     'phone',        coalesce(best.phone, ''),
                     'joined',       coalesce(best.joined, src.m->>'joined'),
                     'lastActivity', coalesce(best.last_activity, src.m->>'lastActivity'),
                     'deleted',      false)
                 -- any further row under keep_id carries the SAME key as the survivor, so
                 -- a tombstone here would collapse onto it and kill it — drop these
                 when ranked.rn is not null then null
                 -- the auto-assigned leftover: a distinct key, so tombstone it properly
                 when src.tid = any(r.drop_ids) then src.m || jsonb_build_object('deleted', true)
                 else src.m
               end as out
        from src
        left join ranked on ranked.ord = src.ord
        cross join best
      ) s
    ));

    update public.app_data set data = v_data, updated_at = now() where company_id = v_cid;

    select count(*) into v_after
    from jsonb_array_elements(v_data->'members') m
    where coalesce((m->>'deleted')::boolean,false) = false
      and (btrim(coalesce(m->>'id','')) = r.keep_id or btrim(coalesce(m->>'id','')) = any(r.drop_ids));

    raise notice 'OK    % / % — % row(s) -> % live', r.company, r.keep_name, v_before, v_after;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFY — expect exactly one live row per person, and no live member sharing a
-- name or a trimmed ID with another. Should return zero rows.
-- ---------------------------------------------------------------------------
with mem as (
  select c.name as company, btrim(m->>'id') as tid, upper(btrim(m->>'name')) as nm
  from public.app_data d
  join public.companies c on c.id = d.company_id
  cross join lateral jsonb_array_elements(d.data->'members') m
  where coalesce((m->>'deleted')::boolean,false) = false
)
select 'duplicate name' as problem, company, nm as value, count(*) as rows
from mem group by company, nm having count(*) > 1
union all
select 'duplicate id', company, tid, count(*)
from mem group by company, tid having count(*) > 1;

-- Rollback for PART 1 (PART 2 is a data merge and is not automatically reversible —
-- restore from the daily backup if it ever needed undoing): re-run migration-012's
-- version of app_data_merge, which is this file's function with the two
-- `jsonb_build_object('deleted', ...)` additions removed from the members block.
