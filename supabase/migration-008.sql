-- migration-008.sql
-- Bulletproof concurrent saves: merge a company's FinTrack data ATOMICALLY in the DB.
--
-- Why: the app keeps ONE app_data row per company. The client used to overwrite that
-- whole row on every save, so when several operators/devices saved at nearly the same
-- time the last write won and the other entries were lost (they "reverted to nothing").
-- v1.6.17 added a client-side merge, which helps but still has a tiny read-modify-write
-- window. This function closes it completely: it LOCKS the company's row and merges
-- INSIDE the database, so simultaneous saves run one-at-a-time and nothing is clobbered.
--
-- Security: SECURITY INVOKER (runs as the calling user) + an explicit my_company()
-- check, so a user can only ever merge their OWN company's data. Row-Level Security on
-- app_data still applies to every read/write inside the function.
--
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
  v_merged  jsonb;
begin
  -- Only ever merge your OWN company's data.
  if p_company_id is distinct from public.my_company() then
    raise exception 'not authorized for this company';
  end if;
  if p_incoming is null then p_incoming := '{}'::jsonb; end if;

  -- Make sure the row exists, then lock it so concurrent merges serialize.
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

  -- banks: union by id; whichever side has the newer updatedAt wins. This lets an
  -- active/inactive toggle (or any bank edit) made on one device reach the others
  -- instead of being overwritten by another device's stale copy of the bank.
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_banks from (
    select case
             when c.t is null then i.t
             when i.t is null then c.t
             -- newer updatedAt wins, taken WHOLE (not c.t||i.t) so a stale deleted/active flag
             -- on the losing side can't leak onto the winner.
             when coalesce((i.t->>'updatedAt')::bigint,0) >= coalesce((c.t->>'updatedAt')::bigint,0) then i.t
             else c.t
           end as t
    from (select value->>'id' k, value t from jsonb_array_elements(coalesce(v_current->'banks','[]'::jsonb))) c
    full outer join (select value->>'id' k, value t from jsonb_array_elements(coalesce(p_incoming->'banks','[]'::jsonb))) i
      on c.k = i.k
  ) s;

  -- members: union by id; whichever side has the newer lastActivity wins.
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

  v_merged := jsonb_build_object(
    'transactions', v_tx,
    'banks',        v_banks,
    'members',      v_members,
    'nextId',       greatest(coalesce((v_current->>'nextId')::bigint,0), coalesce((p_incoming->>'nextId')::bigint,0))
  );

  update public.app_data set data = v_merged, updated_at = now() where company_id = p_company_id;
  return v_merged;
end;
$$;

grant execute on function public.app_data_merge(uuid, jsonb) to authenticated;
