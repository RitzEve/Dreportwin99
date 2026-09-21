-- =====================================================================
-- migration-037 — a deactivated account is refused on EVERY request
-- =====================================================================
-- The gap (found 2026-09-21): deactivating an account only took effect the
-- next time the app reloaded that person's details. Until then the database
-- kept serving them, because nothing on the database side ever looked at
-- profiles.active:
--   * my_company() / my_role() / my_country() ignore it, so every security
--     rule (RLS policy) built on them still let a deactivated user through;
--   * 13 privileged functions look the caller up themselves — including
--     admin_delete_account, admin_delete_company, admin_set_password and
--     admin_set_email — so a deactivated master could still delete staff or
--     the whole company from a tab that was already open.
--
-- Patching all of those one by one would be 25 separate edits, easy to get one
-- wrong, and every future function would have to remember the rule. Instead this
-- installs ONE checkpoint that PostgREST (Supabase's Data API) runs before every
-- single request — tables, views and RPC functions alike:
--   https://supabase.com/docs/guides/api/securing-your-api
-- If the signed-in caller's profile is deactivated, the request is refused with
-- HTTP 403 and code "account_deactivated" before any query runs.
--
-- Deliberately let through:
--   * signed-out requests (auth.uid() is null) — the login page needs them;
--   * callers with no profile row (service role, half-created logins) — RLS
--     already governs those exactly as before.
-- The app uses no Realtime or Storage, which this checkpoint would not cover.
--
-- Cost: one primary-key lookup on profiles (31 rows) per request.
-- SECURITY DEFINER so it always sees the real flag even if profile read rules
-- change later (a checkpoint that silently fails open would be worse than none).
-- search_path is pinned empty and every name is schema-qualified.
--
-- ROLLBACK (instant, if anything ever goes wrong):
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';
-- =====================================================================

create or replace function public.reject_deactivated_accounts()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active = false
  ) then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code',    'account_deactivated',
        'message', 'This account has been deactivated.',
        'hint',    'Contact your administrator.')::text,
      detail  = json_build_object('status', 403)::text;
  end if;
end;
$$;

comment on function public.reject_deactivated_accounts() is
  'PostgREST pre-request checkpoint (migration-037): refuses every Data API request from a deactivated account with 403 account_deactivated. Signed-out callers pass through.';

-- PostgREST calls the checkpoint in the caller's own role, so BOTH roles must be
-- able to run it — revoking it from anon would break the login page for everyone.
grant execute on function public.reject_deactivated_accounts() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.reject_deactivated_accounts';
notify pgrst, 'reload config';

-- VERIFY (run after applying):
--   select array_to_string(rolconfig, ' | ') from pg_roles where rolname = 'authenticator';
--   -- expect: ... | pgrst.db_pre_request=public.reject_deactivated_accounts
