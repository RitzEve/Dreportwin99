-- ============================================================================
-- Migration 003 — let an admin change another account's LOGIN EMAIL safely
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHY THIS IS NEEDED: an account's email lives in TWO places — the profiles
-- table (what the app shows + uses to find the login) AND Supabase's protected
-- auth.users table (the actual login credential). They must always match. This
-- function updates BOTH together, with the same role rules as password reset:
--   provider -> anyone; master -> manager/staff in own company; manager -> staff.
-- ============================================================================

create or replace function public.admin_set_email(target_id uuid, new_email text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  caller_role    text;
  caller_company uuid;
  t_role         text;
  t_company      uuid;
  norm_email     text;
begin
  norm_email := lower(trim(new_email));

  -- basic shape check (a@b.c)
  if norm_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email.';
  end if;

  select role, company_id into caller_role, caller_company
    from public.profiles where id = auth.uid();
  select role, company_id into t_role, t_company
    from public.profiles where id = target_id;

  if t_role is null then
    raise exception 'Account not found.';
  end if;

  -- don't collide with a different existing login
  if exists (select 1 from auth.users where lower(email) = norm_email and id <> target_id) then
    raise exception 'That email is already in use.';
  end if;

  if caller_role = 'provider'
     or (caller_role = 'master'  and t_company = caller_company and t_role in ('manager','staff'))
     or (caller_role = 'manager' and t_company = caller_company and t_role = 'staff')
  then
    -- 1) the real login credential
    update auth.users
       set email = norm_email,
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = target_id;
    -- 2) the copy the app displays / uses to resolve Name/ID -> email
    update public.profiles
       set email = norm_email
     where id = target_id;
  else
    raise exception 'Not authorised.';
  end if;
end;
$$;

grant execute on function public.admin_set_email(uuid, text) to authenticated;
