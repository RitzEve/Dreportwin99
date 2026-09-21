-- =====================================================================
-- migration-039 — give the company-record save more time (stopgap)
-- =====================================================================
-- 2026-09-21, 15:54:42 UTC: one of OP-005's Megabet26 saves failed with
-- "canceling statement due to statement timeout" (57014). Every save calls
-- app_data_merge, which unions the WHOLE company record (17,882 transactions,
-- 6.5 MB for Megabet26) with what the browser sends. Tonight's saves took
-- 2.5-4.7 s; that one ran 11.7 s against the 8 s limit signed-in users get.
--
-- This gives ONLY app_data_merge 20 s, instead of raising the limit for every
-- query. A per-function timeout is honoured by PostgREST when the app calls it
-- (https://supabase.com/docs/guides/database/postgres/timeouts#function-level),
-- verified end-to-end first: a throwaway anon function sleeping 4 s with its own
-- 10 s limit returned HTTP 200 through supabase-js, past anon's normal 3 s.
--
-- lock_timeout too: the merge takes the company row FOR UPDATE, so a second
-- save that arrives while a slow one is running waits for it — and that wait is
-- capped at 8 s by the authenticator role today, which would fail the second save.
--
-- This is headroom, not a cure. The real fix is to stop sending, merging and
-- returning the whole record on every save; save time grows with the data.
-- Undo: alter function public.app_data_merge(uuid, jsonb) reset statement_timeout;
--       alter function public.app_data_merge(uuid, jsonb) reset lock_timeout;
-- =====================================================================

alter function public.app_data_merge(uuid, jsonb) set statement_timeout = '20s';
alter function public.app_data_merge(uuid, jsonb) set lock_timeout = '20s';

-- VERIFY:
--   select array_to_string(proconfig, ', ') from pg_proc where proname = 'app_data_merge';
--   -- expect: search_path=public, statement_timeout=20s, lock_timeout=20s
