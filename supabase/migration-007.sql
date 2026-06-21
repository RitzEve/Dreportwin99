-- ============================================================================
-- Migration 007 — FREE the email/ID when an account or company is deleted
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHY THIS IS NEEDED: every login's email lives in TWO places — the profiles
-- table (what the app shows) AND Supabase's protected auth.users table (the
-- real login credential). Deleting a profile (or a whole company) did NOT remove
-- the auth.users row, so the email + ID stayed "taken" and you could not create a
-- new account with the same email/ID afterwards.
--
-- These two functions delete the real login (auth.users) as well, which frees the
-- email + ID for reuse. They keep the SAME role rules already used for password
-- reset and email change:
--   provider -> anyone; master -> manager/staff in own company; manager -> staff.
--
-- Note: deleting an auth.users row automatically cascades and removes that user's
-- profile row (because profiles.id references auth.users(id) on delete cascade).
-- ============================================================================

-- ---- Delete ONE account (used by master/manager team console) ---------------
create or replace function public.admin_delete_account(target_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  caller_role    text;
  caller_company uuid;
  t_role         text;
  t_company      uuid;
begin
  select role, company_id into caller_role, caller_company
    from public.profiles where id = auth.uid();
  select role, company_id into t_role, t_company
    from public.profiles where id = target_id;

  if t_role is null then
    raise exception 'Account not found.';
  end if;

  if caller_role = 'provider'
     or (caller_role = 'master'  and t_company = caller_company and t_role in ('manager','staff'))
     or (caller_role = 'manager' and t_company = caller_company and t_role = 'staff')
  then
    -- delete the real login (frees its email + ID); cascades the profile row away.
    delete from auth.users where id = target_id;
  else
    raise exception 'Not authorised.';
  end if;
end;
$$;

grant execute on function public.admin_delete_account(uuid) to authenticated;

-- ---- Delete a WHOLE company (provider only) ---------------------------------
create or replace function public.admin_delete_company(target_company uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  caller_role text;
begin
  select role into caller_role from public.profiles where id = auth.uid();

  if caller_role <> 'provider' then
    raise exception 'Not authorised.';
  end if;

  -- 1) delete the login of EVERY account in this company (frees all their emails
  --    + IDs); each delete cascades that user's profile row away.
  delete from auth.users
   where id in (select id from public.profiles where company_id = target_company);

  -- 2) delete the company itself (cascades its app_data + any leftover profiles).
  delete from public.companies where id = target_company;
end;
$$;

grant execute on function public.admin_delete_company(uuid) to authenticated;
