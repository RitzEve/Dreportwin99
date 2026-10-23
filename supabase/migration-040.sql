-- =====================================================================
-- migration-040 — a member's edited name or phone stops reverting
-- =====================================================================
-- THE BUG (reported 2026-10-23): edit a member's name on the Members page, and the
-- next deposit for that member puts the old name back.
--
-- Members merge by id, and the copy with the newer `lastActivity` won the fields.
-- An edit doesn't change lastActivity. So every OTHER open screen kept its old-name
-- copy (equal lastActivity -> its own copy wins on the 20 s refresh), and the moment
-- one of them recorded a deposit for that member, the deposit bumped lastActivity on
-- that old-name copy and the save sent it back as the "newer" one -- overwriting the
-- edit for everyone, including the screen that made it.
--
-- THE FIX
-- The app now stamps `updatedAt` (ms) on a member when it is edited -- the same way
-- banks already work -- and both merges (this function and src/lib/mergeData.js) let
-- the newer edit win the member's details. lastActivity is kept as the later of the
-- two dates, whichever copy wins.
--
-- SAFE + BACKWARD COMPATIBLE. Only the `members` block changed; transactions, banks,
-- offDays and nextId are what migration-031 installed, and the two time limits from
-- migration-039 are restated (create-or-replace would otherwise drop them). Members
-- with no updatedAt -- every member until it is next edited, and everything an older
-- copy of the app sends -- merge exactly as before. Apply this BEFORE deploying the
-- app change, so no edit is ever made that the server can't honour.
--
-- Undo: re-run the `create or replace function` from migration-031, then migration-039.
-- =====================================================================

create or replace function public.app_data_merge(p_company_id uuid, p_incoming jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
set statement_timeout to '20s'
set lock_timeout to '20s'
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

  -- members: key = id (fallback content hash). `deleted` is OR-ed across both sides
  -- (migration-031). NEW in 040: a member edited on the Members page carries `updatedAt`
  -- (ms), and the side with the newer updatedAt wins the member's fields. Before this,
  -- lastActivity decided, and an edit doesn't move lastActivity -- so a device still
  -- holding the old name sent it back with its next deposit (which bumps lastActivity)
  -- and the edit was lost. Members with no updatedAt on either side merge exactly as
  -- before (newer lastActivity wins). lastActivity itself is always the later of the two.
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
             else (case
                     when x.iu > x.cu then c.t || i.t
                     when x.iu < x.cu then i.t || c.t
                     when coalesce(i.t->>'lastActivity','') >= coalesce(c.t->>'lastActivity','') then c.t || i.t
                     else i.t || c.t
                   end)
                  || case when x.la is null then '{}'::jsonb else jsonb_build_object('lastActivity', x.la) end
           end
           || jsonb_build_object('deleted',
                coalesce((c.t->>'deleted')::boolean,false) or coalesce((i.t->>'deleted')::boolean,false)) as t
    from cur c full outer join inc i on c.k = i.k
    -- updatedAt is only trusted when it is a plain whole number, so an odd value can never
    -- make the cast fail and stop every save.
    cross join lateral (select
        case when i.t->>'updatedAt' ~ '^[0-9]{1,15}$' then (i.t->>'updatedAt')::bigint else 0 end as iu,
        case when c.t->>'updatedAt' ~ '^[0-9]{1,15}$' then (c.t->>'updatedAt')::bigint else 0 end as cu,
        greatest(nullif(i.t->>'lastActivity',''), nullif(c.t->>'lastActivity','')) as la) x
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

-- VERIFY:
--   select array_to_string(proconfig, ', ') from pg_proc where proname = 'app_data_merge';
--   -- expect: search_path=public, statement_timeout=20s, lock_timeout=20s
--   select position('x.iu > x.cu' in prosrc) > 0 from pg_proc where proname = 'app_data_merge';
--   -- expect: true
