-- ============================================================================
-- Migration 015 — cap runtime on the public login-lookup function
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS CHANGES: email_for_login() (added in migration-002.sql) is the one
-- database function anonymous visitors can call before they've signed in — it
-- turns a Name/ID into the matching login email. It's a simple, fast lookup,
-- but because it's reachable by anyone (not just signed-in accounts), this
-- adds a hard 3-second cap on how long any single call is allowed to run, so
-- it can never be used to tie up database resources no matter how it's
-- hammered. The function's behaviour is otherwise unchanged — same input,
-- same result.
-- ============================================================================

create or replace function public.email_for_login(identifier text)
returns text
language plpgsql stable security definer
set search_path = public
set statement_timeout = '3s'
as $$
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
