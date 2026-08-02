-- ============================================================================
-- Migration 026 — who's online, and from which IP (Console team list)
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS: a small presence record per user so the master/manager
-- Console can show a green "Online" dot next to whoever is signed in right
-- now, plus the IP address they're connected from.
--
-- WHY ITS OWN TABLE, not two more columns on `profiles`: profiles_select lets
-- ANY signed-in member of a company read every profile row in that company
-- (staff included — the app needs it for the shift roster). Parking an IP
-- column there would mean a staff account could read their colleagues' and
-- their manager's IP with a direct API call, even though the Console UI never
-- shows it to them. A separate table gets its own policy, so master/manager is
-- a real boundary rather than just a hidden button.
--
-- HOW THE IP IS CAPTURED: server-side, inside touch_presence(), out of the API
-- gateway's own request headers. It is never accepted as a function argument,
-- so a signed-in user cannot report a false address for themselves. If the
-- header isn't available the column is simply left as-is and the Console shows
-- the online dot with no IP — nothing breaks.
-- ============================================================================

create table if not exists public.user_presence (
  user_id    uuid primary key references public.profiles(id)  on delete cascade,
  company_id uuid not null    references public.companies(id) on delete cascade,
  last_seen  timestamptz,           -- null = signed out (set by clear_presence)
  last_ip    text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_presence_company_id on public.user_presence(company_id);

alter table public.user_presence enable row level security;

-- ---- Read: master/manager of the owning company only ------------------------
-- Staff deliberately get NOTHING here, not even their own row: they have no
-- Console screen to show it, and leaving it unreadable keeps the whole feature
-- invisible to them.
drop policy if exists user_presence_select on public.user_presence;
create policy user_presence_select on public.user_presence for select to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

-- ---- Write: nobody, directly -----------------------------------------------
-- There is deliberately NO insert/update/delete policy. Every write goes
-- through the two SECURITY DEFINER functions below, which bypass RLS but hard-
-- scope themselves to auth.uid() — so a user can only ever stamp their OWN
-- presence, and can't fake being someone else or clear a colleague's dot.
grant select on public.user_presence to authenticated;

-- ---- Heartbeat: "I'm still here", called every couple of minutes -----------
create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip      text;
  v_company uuid;
begin
  if auth.uid() is null then return; end if;

  -- Only stamp presence for a user who actually belongs to a company
  -- (provider and owner logins have a null company_id and no Console row).
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then return; end if;

  -- Client address as the API gateway saw it. x-forwarded-for can be a chain
  -- ("client, proxy1, proxy2") — the left-most entry is the original client.
  -- Wrapped in its own block so a missing/!json header can never break the
  -- heartbeat; worst case the IP stays whatever it was.
  begin
    v_ip := split_part(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      ',', 1);
  exception when others then
    v_ip := null;
  end;

  insert into public.user_presence (user_id, company_id, last_seen, last_ip, updated_at)
  values (auth.uid(), v_company, now(), nullif(btrim(coalesce(v_ip, '')), ''), now())
  on conflict (user_id) do update
    set last_seen  = now(),
        updated_at = now(),
        company_id = excluded.company_id,
        -- keep the previous address if this particular call couldn't read one
        last_ip    = coalesce(excluded.last_ip, public.user_presence.last_ip);
end $$;

-- ---- Sign-out: drop the dot immediately, don't wait for it to go stale -----
create or replace function public.clear_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.user_presence
     set last_seen = null, updated_at = now()
   where user_id = auth.uid();
end $$;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.clear_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.clear_presence() to authenticated;
