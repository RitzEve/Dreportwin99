-- ============================================================================
-- Migration 002 — login by Name/ID, and admin password reset
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---- 1) Name/ID (username) for login --------------------------------------

alter table public.profiles add column if not exists username text;

-- Backfill any existing accounts: use the name they were given, else the email.
update public.profiles set username = nullif(trim(name), '') where username is null;
update public.profiles
   set username = lower(split_part(email, '@', 1))
 where username is null and email is not null;

-- Name/ID must be unique across the whole portal (login has no company picker).
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username)) where username is not null;

-- ---- 2) Resolve a Name/ID OR email to the login email (used before login) --
-- Callable by anonymous visitors because it runs before sign-in.
create or replace function public.email_for_login(identifier text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare e text;
begin
  if position('@' in identifier) > 0 then
    return lower(trim(identifier));
  end if;
  select p.email into e
    from public.profiles p
   where lower(p.username) = lower(trim(identifier))
   limit 1;
  return e;
end;
$$;
grant execute on function public.email_for_login(text) to anon, authenticated;

-- ---- 3) Admin password reset (role hierarchy enforced) ---------------------
-- provider -> anyone; master -> manager/staff in own company; manager -> staff.
create or replace function public.admin_set_password(target_id uuid, new_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  caller_role    text;
  caller_company uuid;
  t_role         text;
  t_company      uuid;
begin
  if length(coalesce(new_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

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
    update auth.users
       set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
           updated_at = now()
     where id = target_id;
  else
    raise exception 'Not authorised.';
  end if;
end;
$$;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
