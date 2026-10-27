-- =====================================================================
-- migration-042 — row storage, step 1 of 2: prepare + save into both
-- =====================================================================
-- WHY: each company's whole history lived in ONE jsonb value (app_data.data): 24,670
-- entries and 9 MB for the biggest company. V2.9.3 made saves *send* only what changed,
-- but the server still rewrote the whole value on every save, and every other open
-- screen downloaded the whole value whenever anyone saved. Both costs grew with every
-- entry ever recorded (and the whole-record saves crashed the database five times,
-- 17–27 Oct 2026).
--
-- THE MOVE, in gentle steps (a one-shot locked switch was tried in a rehearsal on
-- 2026-10-27 and the database restarted under the load — so nothing here holds a
-- table-wide lock, and nothing large is done in one go):
--   042 (this)   create the row tables and functions; the two existing save functions
--                ALSO apply every save to the rows of any company already copied (if
--                that ever fails, the save still succeeds; 043's check copies that
--                company again)
--   copy         select public.fin_copy_company(id) — one company per call/transaction;
--                only that company's saves wait, for a second or two
--   043          the switch: short lock, check every company (re-copy any that differ),
--                then app_data becomes a view and the save functions write rows only
--
-- WHAT this step adds:
--   company_rows   one row per entry/member/bank/off-day: (company, kind, key) -> row,
--                  stamped with the company's change number (rev) when it last changed
--   company_sync   one row per company: rev, nextId, updated_at (no row = not copied yet)
--   fin_merge_row  the merge rules of migrations 040/041, for ONE row — the only copy,
--                  used by every way of saving from now on
--   company_load / company_changes / company_save — what V2.9.4 will use
--
-- Undo: supabase/migration-042-rollback.sql
-- =====================================================================

-- ---------------------------------------------------------------- tables
create table public.company_rows (
  company_id uuid        not null references public.companies(id) on delete cascade,
  kind       text        not null check (kind in ('transactions','banks','members','offDays')),
  key        text        not null,
  row        jsonb       not null,
  rev        bigint      not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, kind, key)
);
create index company_rows_company_rev on public.company_rows (company_id, rev);

create table public.company_sync (
  company_id uuid        primary key references public.companies(id) on delete cascade,
  next_id    bigint      not null default 0,
  rev        bigint      not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.company_rows enable row level security;
alter table public.company_sync enable row level security;

-- Same reach as app_data: read = own company, provider tier, or an owner of the company;
-- write = own company only; no delete (rows go only with their company).
create policy company_rows_select on public.company_rows for select to authenticated using (
  company_id = (select public.my_company())
  or (select public.is_provider_tier())
  or company_id in (select co.company_id from public.company_owners co where co.owner_id = (select auth.uid())));
create policy company_rows_insert on public.company_rows for insert to authenticated
  with check (company_id = (select public.my_company()));
create policy company_rows_update on public.company_rows for update to authenticated
  using (company_id = (select public.my_company())) with check (company_id = (select public.my_company()));

create policy company_sync_select on public.company_sync for select to authenticated using (
  company_id = (select public.my_company())
  or (select public.is_provider_tier())
  or company_id in (select co.company_id from public.company_owners co where co.owner_id = (select auth.uid())));
create policy company_sync_insert on public.company_sync for insert to authenticated
  with check (company_id = (select public.my_company()));
create policy company_sync_update on public.company_sync for update to authenticated
  using (company_id = (select public.my_company())) with check (company_id = (select public.my_company()));

revoke all on public.company_rows, public.company_sync from anon, authenticated;
grant select, insert, update on public.company_rows, public.company_sync to authenticated;

-- ---------------------------------------------------------------- one row's rules
-- The key a row merges by (same as the client's txKey/idKey and 040/041).
create function public.fin_row_key(p_kind text, p_row jsonb) returns text
language sql immutable set search_path to 'public' as $$
  select case when p_kind in ('transactions','offDays')
              then coalesce(p_row->>'uid', '#'||(p_row->>'id'), md5(p_row::text))
              else coalesce(p_row->>'id', md5(p_row::text)) end
$$;

-- Merge the stored copy of a row (null = new row) with an incoming copy — migration
-- 040/041's expressions, unchanged:
--   transactions, offDays  incoming fields win; deleted if EITHER side is deleted
--   banks                  the newer updatedAt wins, taken whole
--   members                newer updatedAt (plain whole number) wins the fields, else newer
--                          lastActivity; lastActivity = the later of the two; deleted if either
create function public.fin_merge_row(p_kind text, p_cur jsonb, p_inc jsonb) returns jsonb
language sql immutable set search_path to 'public' as $$
  select case
    when p_kind in ('transactions','offDays') then
      (coalesce(p_cur, '{}'::jsonb) || p_inc)
      || jsonb_build_object('deleted',
           coalesce((p_cur->>'deleted')::boolean, false) or coalesce((p_inc->>'deleted')::boolean, false))
    when p_kind = 'banks' then
      case when p_cur is null then p_inc
           when coalesce((p_inc->>'updatedAt')::bigint, 0) >= coalesce((p_cur->>'updatedAt')::bigint, 0) then p_inc
           else p_cur end
    else
      (case when p_cur is null then p_inc
            else (case
                    when x.iu > x.cu then p_cur || p_inc
                    when x.iu < x.cu then p_inc || p_cur
                    when coalesce(p_inc->>'lastActivity','') >= coalesce(p_cur->>'lastActivity','') then p_cur || p_inc
                    else p_inc || p_cur
                  end)
                 || case when x.la is null then '{}'::jsonb else jsonb_build_object('lastActivity', x.la) end
       end)
      || jsonb_build_object('deleted',
           coalesce((p_cur->>'deleted')::boolean, false) or coalesce((p_inc->>'deleted')::boolean, false))
  end
  from (select
      case when p_inc->>'updatedAt' ~ '^[0-9]{1,15}$' then (p_inc->>'updatedAt')::bigint else 0 end as iu,
      case when p_cur->>'updatedAt' ~ '^[0-9]{1,15}$' then (p_cur->>'updatedAt')::bigint else 0 end as cu,
      greatest(nullif(p_inc->>'lastActivity',''), nullif(p_cur->>'lastActivity','')) as la) x
$$;

-- A company's whole record, in the shape app_data.data had.
create function public.fin_build_blob(p_company uuid) returns jsonb
language sql stable set search_path to 'public' as $$
  select jsonb_build_object(
    'transactions', coalesce((select jsonb_agg(r.row) from public.company_rows r where r.company_id = p_company and r.kind = 'transactions'), '[]'::jsonb),
    'banks',        coalesce((select jsonb_agg(r.row) from public.company_rows r where r.company_id = p_company and r.kind = 'banks'), '[]'::jsonb),
    'members',      coalesce((select jsonb_agg(r.row) from public.company_rows r where r.company_id = p_company and r.kind = 'members'), '[]'::jsonb),
    'offDays',      coalesce((select jsonb_agg(r.row) from public.company_rows r where r.company_id = p_company and r.kind = 'offDays'), '[]'::jsonb),
    'nextId',       coalesce((select s.next_id from public.company_sync s where s.company_id = p_company), 0))
$$;

-- May the caller read this company? (own company, provider tier, or an owner of it)
create function public.fin_can_read(p_company uuid) returns boolean
language sql stable set search_path to 'public' as $$
  select p_company = public.my_company()
      or coalesce(public.is_provider_tier(), false)
      or exists (select 1 from public.company_owners co where co.company_id = p_company and co.owner_id = auth.uid())
$$;

-- How many rows differ between a company's stored rows and a whole record (0 = identical).
create function public.fin_company_diff(p_company uuid, p_record jsonb) returns integer
language sql stable set search_path to 'public' as $$
  with rec as (
    select k.kind, public.fin_row_key(k.kind, e.value) as key, e.value as row
    from unnest(array['transactions','banks','members','offDays']) k(kind)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p_record->k.kind) = 'array' then p_record->k.kind else '[]'::jsonb end) e(value)
  ), stored as (
    select r.kind, r.key, r.row from public.company_rows r where r.company_id = p_company
  )
  select count(*)::integer from (
    (select * from stored except all select * from rec)
    union all
    (select * from rec except all select * from stored)) z
$$;

-- ---------------------------------------------------------------- the one write path
-- Merge rows into a company. p_delta = { transactions?, banks?, members?, offDays?, nextId }
-- (a whole record is just a delta with every row). Saves of one company take turns on its
-- company_sync row, so the change number is bumped exactly once per save that changes
-- something; rows whose merged value equals the stored one are not written.
create function public.fin_apply(p_company uuid, p_delta jsonb) returns jsonb
language plpgsql set search_path to 'public' as $function$
declare
  v_rev      bigint;
  v_prev_at  timestamptz;
  v_next     bigint;
  v_new_rev  bigint;
  v_new_next bigint;
  v_now      timestamptz;
  v_changed  boolean;
  v_rows     jsonb;
begin
  if p_company is distinct from public.my_company() then
    raise exception 'not authorized for this company';
  end if;
  if p_delta is null then p_delta := '{}'::jsonb; end if;

  insert into public.company_sync (company_id, next_id, rev, updated_at)
    values (p_company, 0, 0, now()) on conflict (company_id) do nothing;
  select rev, updated_at, next_id into v_rev, v_prev_at, v_next
    from public.company_sync where company_id = p_company for update;
  v_new_rev := v_rev + 1;

  with inc_raw as (
    select k.kind, e.value as t, e.ord
    from unnest(array['transactions','banks','members','offDays']) k(kind)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p_delta->k.kind) = 'array' then p_delta->k.kind else '[]'::jsonb end
    ) with ordinality e(value, ord)
  ), inc as (
    -- one row per key, picked like 040/041's pre-reduce (banks: newest updatedAt; members:
    -- latest lastActivity; others: first sent); deleted OR-ed except for banks
    select kind, key,
           (array_agg(t order by sn desc, st desc, ord))[1]
           || case when kind = 'banks' then '{}'::jsonb
                   else jsonb_build_object('deleted', bool_or(coalesce((t->>'deleted')::boolean, false))) end as t
    from (select kind, public.fin_row_key(kind, t) as key, t, ord,
                 case when kind = 'banks' then coalesce((t->>'updatedAt')::bigint, 0) else 0 end as sn,
                 case when kind = 'members' then coalesce(t->>'lastActivity', '') else '' end as st
          from inc_raw) z
    group by kind, key
  ), merged as (
    select i.kind, i.key, public.fin_merge_row(i.kind, r.row, i.t) as row, r.row as old
    from inc i
    left join public.company_rows r on r.company_id = p_company and r.kind = i.kind and r.key = i.key
  ), written as (
    insert into public.company_rows as cr (company_id, kind, key, row, rev, updated_at)
    select p_company, m.kind, m.key, m.row, v_new_rev, now() from merged m
    where m.old is distinct from m.row
    on conflict (company_id, kind, key) do update
      set row = excluded.row, rev = excluded.rev, updated_at = excluded.updated_at
    returning 1
  )
  select (select count(*) from written) > 0,
         coalesce((select jsonb_object_agg(g.kind, g.rows)
                   from (select m.kind, jsonb_agg(m.row) as rows from merged m group by m.kind) g), '{}'::jsonb)
    into v_changed, v_rows;

  v_new_next := greatest(v_next, coalesce((p_delta->>'nextId')::bigint, 0));
  if v_changed or v_new_next <> v_next then
    update public.company_sync set rev = v_new_rev, next_id = v_new_next, updated_at = now()
      where company_id = p_company returning updated_at into v_now;
    v_changed := true;
  else
    v_new_rev := v_rev;
    v_now := v_prev_at;
  end if;

  return jsonb_build_object(
    'rev', v_new_rev, 'prevRev', v_rev, 'changed', v_changed, 'rows', v_rows,
    'nextId', v_new_next, 'updatedAt', v_now, 'prevUpdatedAt', v_prev_at);
end;
$function$;

-- Used by the two save functions while both storages are kept: apply the same save to the
-- rows of a company that has been copied (company_sync row exists). Never lets that fail the
-- save: an error is only logged as a warning — 043 checks every company's rows against its
-- record before switching and copies again any that differ.
create function public.fin_mirror(p_company uuid, p_delta jsonb) returns void
language plpgsql set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.company_sync s where s.company_id = p_company) then return; end if;
  begin
    perform public.fin_apply(p_company, p_delta);
  exception when others then
    raise warning 'fin_mirror skipped for company %: %', left(p_company::text, 8), sqlerrm;
  end;
end;
$function$;

-- ---------------------------------------------------------------- copy one company
-- Run by me, one company per call (each call is its own short transaction). Locks only that
-- company's record, so only its saves wait. Rebuilds its rows from the record and checks them
-- row for row before marking it copied (company_sync row). Not callable from the app.
create function public.fin_copy_company(p_company uuid) returns jsonb
language plpgsql set search_path to 'public' set lock_timeout to '10s' as $function$
declare
  v_data jsonb;
  v_at   timestamptz;
  v_rows bigint;
  v_bad  integer;
begin
  select data, updated_at into v_data, v_at from public.app_data where company_id = p_company for update;
  if not found then return jsonb_build_object('company', left(p_company::text, 8), 'skipped', 'no record'); end if;
  delete from public.company_rows where company_id = p_company;
  delete from public.company_sync where company_id = p_company;
  insert into public.company_rows (company_id, kind, key, row, rev, updated_at)
  select p_company, k.kind, public.fin_row_key(k.kind, e.value), e.value, 1, coalesce(v_at, now())
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
    values (p_company, coalesce((v_data->>'nextId')::bigint, 0), 1, coalesce(v_at, now()));
  return jsonb_build_object('company', left(p_company::text, 8), 'rows', v_rows);
end;
$function$;

-- ---------------------------------------------------------------- what V2.9.4 will use
create function public.company_load(p_company uuid) returns jsonb
language plpgsql stable set search_path to 'public' as $function$
begin
  if not public.fin_can_read(p_company) then raise exception 'not authorized for this company'; end if;
  return public.fin_build_blob(p_company)
         || jsonb_build_object('rev', coalesce((select s.rev from public.company_sync s where s.company_id = p_company), 0));
end;
$function$;

create function public.company_changes(p_company uuid, p_since bigint) returns jsonb
language plpgsql stable set search_path to 'public' as $function$
begin
  if not public.fin_can_read(p_company) then raise exception 'not authorized for this company'; end if;
  return jsonb_build_object(
    'rev',    coalesce((select s.rev from public.company_sync s where s.company_id = p_company), 0),
    'nextId', coalesce((select s.next_id from public.company_sync s where s.company_id = p_company), 0),
    'rows',   coalesce((select jsonb_object_agg(g.kind, g.rows)
                        from (select r.kind, jsonb_agg(r.row) as rows from public.company_rows r
                              where r.company_id = p_company and r.rev > coalesce(p_since, 0)
                              group by r.kind) g), '{}'::jsonb));
end;
$function$;

create function public.company_save(p_company uuid, p_delta jsonb) returns jsonb
language plpgsql
set search_path to 'public' set statement_timeout to '20s' set lock_timeout to '20s'
as $function$
begin
  return public.fin_apply(p_company, p_delta);
end;
$function$;

-- ---------------------------------------------------------------- save into both (until 043)
-- The two save functions keep working exactly as before (renamed, bodies untouched) behind a
-- small wrapper with the old name that also mirrors the save into the rows (fin_mirror).
alter function public.app_data_merge(uuid, jsonb) rename to app_data_merge_blob;
alter function public.app_data_merge_delta(uuid, jsonb) rename to app_data_merge_delta_blob;

create function public.app_data_merge(p_company_id uuid, p_incoming jsonb)
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

create function public.app_data_merge_delta(p_company_id uuid, p_delta jsonb)
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

-- ---------------------------------------------------------------- who may call what
revoke all on function public.fin_row_key(text, jsonb), public.fin_merge_row(text, jsonb, jsonb),
  public.fin_build_blob(uuid), public.fin_can_read(uuid), public.fin_company_diff(uuid, jsonb),
  public.fin_apply(uuid, jsonb), public.fin_mirror(uuid, jsonb), public.fin_copy_company(uuid),
  public.company_load(uuid), public.company_changes(uuid, bigint), public.company_save(uuid, jsonb),
  public.app_data_merge(uuid, jsonb), public.app_data_merge_delta(uuid, jsonb),
  public.app_data_merge_blob(uuid, jsonb), public.app_data_merge_delta_blob(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fin_row_key(text, jsonb), public.fin_merge_row(text, jsonb, jsonb),
  public.fin_build_blob(uuid), public.fin_can_read(uuid), public.fin_apply(uuid, jsonb), public.fin_mirror(uuid, jsonb),
  public.company_load(uuid), public.company_changes(uuid, bigint), public.company_save(uuid, jsonb),
  public.app_data_merge(uuid, jsonb), public.app_data_merge_delta(uuid, jsonb),
  public.app_data_merge_blob(uuid, jsonb), public.app_data_merge_delta_blob(uuid, jsonb)
  to authenticated;
-- fin_copy_company and fin_company_diff: not granted — run by me only.

-- VERIFY:
--   select count(*) from public.company_rows;     -- 0 until companies are copied
--   select proname from pg_proc where proname like 'fin\_%' or proname like 'company\_%' or proname like 'app\_data\_merge%';
