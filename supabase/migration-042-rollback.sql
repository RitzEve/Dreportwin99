-- =====================================================================
-- migration-042-rollback — undo step 1 (NOT applied; kept ready)
-- =====================================================================
-- Only while 043 is not in place (or after migration-043-rollback). The record in app_data
-- is still the full, up-to-date data at that point, so the rows can simply be dropped.
-- Puts the two save functions back exactly as migrations 040/041 left them.
-- =====================================================================

drop function public.app_data_merge(uuid, jsonb);
drop function public.app_data_merge_delta(uuid, jsonb);
alter function public.app_data_merge_blob(uuid, jsonb) rename to app_data_merge;
alter function public.app_data_merge_delta_blob(uuid, jsonb) rename to app_data_merge_delta;
-- the rights they had before 042
grant execute on function public.app_data_merge(uuid, jsonb) to public, anon, authenticated;
revoke all on function public.app_data_merge_delta(uuid, jsonb) from public, anon;
grant execute on function public.app_data_merge_delta(uuid, jsonb) to authenticated;

drop function if exists public.company_load(uuid);
drop function if exists public.company_changes(uuid, bigint);
drop function if exists public.company_save(uuid, jsonb);
drop function public.fin_copy_company(uuid);
drop function public.fin_mirror(uuid, jsonb);
drop function public.fin_apply(uuid, jsonb);
drop function public.fin_company_diff(uuid, jsonb);
drop function public.fin_can_read(uuid);
drop function public.fin_build_blob(uuid);
drop function public.fin_merge_row(text, jsonb, jsonb);
drop function public.fin_row_key(text, jsonb);
drop table public.company_rows;
drop table public.company_sync;

-- VERIFY:
--   select to_regclass('public.company_rows');                    -- null
--   select proname from pg_proc where proname like 'app\_data\_merge%';   -- app_data_merge, app_data_merge_delta
