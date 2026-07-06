-- ============================================================================
-- Migration 017 — stop anonymous visitors from even reaching the admin functions
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHY THIS IS NEEDED: admin_delete_account, admin_delete_company,
-- admin_purge_orphan_logins, admin_set_email and admin_set_password were only
-- ever GRANTed to `authenticated`, but Postgres also grants EXECUTE to the
-- built-in PUBLIC role by default unless it's explicitly revoked — and the
-- anonymous `anon` role inherits whatever PUBLIC has. Each function already
-- checks the caller's own identity internally (via auth.uid()) and correctly
-- refuses an anonymous caller, so this was never actually exploitable — but it
-- was one bug away from being one, since there was no second layer of
-- protection. This revokes PUBLIC/anon access outright, so an anonymous
-- request is rejected before it ever reaches the function.
-- ============================================================================

revoke execute on function public.admin_delete_account(uuid)     from public, anon;
revoke execute on function public.admin_delete_company(uuid)     from public, anon;
revoke execute on function public.admin_purge_orphan_logins()    from public, anon;
revoke execute on function public.admin_set_email(uuid, text)    from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;

-- Signed-in accounts keep using these exactly as before — each function still
-- checks the caller's own role/company internally before doing anything.
grant execute on function public.admin_delete_account(uuid)     to authenticated;
grant execute on function public.admin_delete_company(uuid)     to authenticated;
grant execute on function public.admin_purge_orphan_logins()    to authenticated;
grant execute on function public.admin_set_email(uuid, text)    to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
