-- migration-009.sql
-- Adds "offDays" (employee day-off records) to the atomic company merge, so they sync
-- across devices exactly like transactions. Union by uid (older rows fall back to '#'||id),
-- incoming fields win, and a record deleted on EITHER side stays deleted. Everything else
-- (transactions, banks, members, nextId) is unchanged from migration-008.
--
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to run more than once.

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

  -- transactions: union by uid (older rows fall back to '#'||id); incoming fields win;
  -- an entry deleted on EITHER side stays deleted.
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_tx from (
    select (coalesce(c.t,'{}'::jsonb) || coalesce(i.t,'{}'::jsonb))
             || jsonb_build_object('deleted',
                  coalesce((c.t->>'deleted')::boolean,false) or coalesce((i.t->>'deleted')::boolean,false)) as t
    from (select coalesce(value->>'uid','#'||(value->>'id')) k, value t
            from jsonb_array_elements(coalesce(v_current->'transactions','[]'::jsonb))) c
    full outer join (select coalesce(value->>'uid','#'||(value->>'id')) k, value t
            from jsonb_array_elements(coalesce(p_incoming->'transactions','[]'::jsonb))) i
      on c.k = i.k
  ) s;

  -- banks: union by id; newer updatedAt wins, taken whole.
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_banks from (
    select case
             when c.t is null then i.t
             when i.t is null then c.t
             when coalesce((i.t->>'updatedAt')::bigint,0) >= coalesce((c.t->>'updatedAt')::bigint,0) then i.t
             else c.t
           end as t
    from (select value->>'id' k, value t from jsonb_array_elements(coalesce(v_current->'banks','[]'::jsonb))) c
    full outer join (select value->>'id' k, value t from jsonb_array_elements(coalesce(p_incoming->'banks','[]'::jsonb))) i
      on c.k = i.k
  ) s;

  -- members: union by id; newer lastActivity wins.
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_members from (
    select case
             when c.t is null then i.t
             when i.t is null then c.t
             when coalesce(i.t->>'lastActivity','') >= coalesce(c.t->>'lastActivity','') then c.t || i.t
             else i.t || c.t
           end as t
    from (select value->>'id' k, value t from jsonb_array_elements(coalesce(v_current->'members','[]'::jsonb))) c
    full outer join (select value->>'id' k, value t from jsonb_array_elements(coalesce(p_incoming->'members','[]'::jsonb))) i
      on c.k = i.k
  ) s;

  -- offDays: union by uid (fallback '#'||id); incoming fields win; deleted on EITHER side stays deleted.
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_offdays from (
    select (coalesce(c.t,'{}'::jsonb) || coalesce(i.t,'{}'::jsonb))
             || jsonb_build_object('deleted',
                  coalesce((c.t->>'deleted')::boolean,false) or coalesce((i.t->>'deleted')::boolean,false)) as t
    from (select coalesce(value->>'uid','#'||(value->>'id')) k, value t
            from jsonb_array_elements(coalesce(v_current->'offDays','[]'::jsonb))) c
    full outer join (select coalesce(value->>'uid','#'||(value->>'id')) k, value t
            from jsonb_array_elements(coalesce(p_incoming->'offDays','[]'::jsonb))) i
      on c.k = i.k
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
