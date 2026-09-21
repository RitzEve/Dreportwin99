-- =====================================================================
-- migration-038 — fix the refusal format from migration-037
-- =====================================================================
-- migration-037's checkpoint raised its refusal with DETAIL = {"status": 403}.
-- This project's PostgREST rejects that: its DETAIL object must carry BOTH
-- 'status' and 'headers' (PGRST121 "Could not parse JSON in the RAISE SQLSTATE
-- 'PGRST' error"). Supabase's docs show both forms; only this one works here.
--
-- So between 037 and 038 a deactivated account's requests came back as HTTP 500
-- PGRST121 instead of 403 account_deactivated. Still REFUSED — the raise aborts
-- the request before any query, so no data was exposed — but the app could not
-- recognise it and would not send the person back to the login page. No account
-- was deactivated during that window (verified: 0 of 31).
--
-- Caught by an end-to-end test through the real @supabase/supabase-js client
-- against a throwaway function raising the identical error (dropped afterwards):
--   before: HTTP 500  code PGRST121
--   after : HTTP 403  code account_deactivated  message "This account has been deactivated."
-- A SQL-level dry run cannot catch this — the raise itself succeeds; it is
-- PostgREST's translation of it that failed.
--
-- Only the DETAIL changes. The db_pre_request setting from 037 stays as it is.
-- ROLLBACK for the whole checkpoint, as before:
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
      -- 'headers' is obligatory in this PostgREST version, even when empty.
      detail  = json_build_object('status', 403, 'headers', json_build_object())::text;
  end if;
end;
$$;

-- VERIFY: a signed-in deactivated caller now gets HTTP 403 {"code":"account_deactivated",...}.
