-- migration-032: managers may set their company's logo, and the logo gets a size cap
--
-- WHY
-- The Company logo card in the console was master-only, enforced here in
-- set_company_logo (the real gate) and again by the render condition in
-- src/screens/Console.jsx. Managers already administer the things that matter far
-- more than branding — Bank Details, company credentials, payment gateways, the team
-- list — so withholding the logo from them was an inconsistency, not a safeguard.
--
-- WHAT CHANGED
-- 1. `caller_role = 'master'`  ->  `caller_role in ('master','manager')`.
--    Company isolation is untouched: the update is still pinned to the caller's OWN
--    company_id, which comes from their profile row and can't be passed in. A manager
--    still cannot reach any other company's logo, and staff/owner remain locked out.
--
-- 2. A 512 kB ceiling on the stored value — NEW, not a port of existing behaviour.
--    The logo is a base64 data-URL held inline on the companies row and read on every
--    session load, so an oversized one is a permanent per-login cost for that tenant.
--    LogoManager.jsx already downscales to 256px (real logos land at 15-31 kB), but
--    that is a client-side courtesy: this RPC is reachable directly and had no limit
--    at all. Widening who may call it is the right moment to add one. 512 kB is far
--    above anything the picker can produce, so no legitimate upload is affected.
--
-- Deploy order: run this BEFORE shipping the client change. This half alone is
-- invisible (managers gain the permission but have no button yet); the reverse order
-- would show managers a button that errors.
--
-- SAFE + REVERSIBLE — see the rollback at the end.

create or replace function public.set_company_logo(new_logo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller_role    text;
  caller_company uuid;
  cleaned        text;
begin
  select role, company_id into caller_role, caller_company
    from public.profiles where id = auth.uid();

  if caller_role not in ('master','manager') or caller_company is null then
    raise exception 'Not authorised.';
  end if;

  cleaned := nullif(trim(coalesce(new_logo, '')), '');

  -- Stored inline on the company row and fetched on every session load, so cap it.
  -- Clearing the logo (null/'') always passes.
  if cleaned is not null and octet_length(cleaned) > 524288 then
    raise exception 'That logo is too large (max 512 kB after processing).';
  end if;

  update public.companies
     set logo = cleaned
   where id = caller_company;
end;
$function$;

-- VERIFY — expect: manager+master allowed, cap present. Should return one 'PASS' row.
select case
         when pg_get_functiondef(p.oid) like '%in (''master'',''manager'')%'
          and pg_get_functiondef(p.oid) like '%524288%'
         then 'PASS — managers allowed and the 512 kB cap is in place'
         else 'FAIL — function body is not what this migration installs'
       end as verdict
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_company_logo';

-- Rollback (restores migration-006's master-only behaviour, without the size cap):
--   create or replace function public.set_company_logo(new_logo text)
--   returns void language plpgsql security definer set search_path to 'public'
--   as $$
--   declare caller_role text; caller_company uuid;
--   begin
--     select role, company_id into caller_role, caller_company
--       from public.profiles where id = auth.uid();
--     if caller_role = 'master' and caller_company is not null then
--       update public.companies
--          set logo = nullif(trim(coalesce(new_logo, '')), '')
--        where id = caller_company;
--     else
--       raise exception 'Not authorised.';
--     end if;
--   end;
--   $$;
