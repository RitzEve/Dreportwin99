-- ============================================================================
-- Migration 005 — let a MASTER change their own company's time zone
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
-- (Needs migration-004 first — it adds the companies.timezone column.)
--
-- The provider can already change any company's time zone. This adds a small
-- function so a MASTER can change ONLY their own company's time zone (nothing
-- else), without granting them broader access to the companies table.
-- ============================================================================

create or replace function public.set_company_timezone(new_tz text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  caller_role    text;
  caller_company uuid;
begin
  select role, company_id into caller_role, caller_company
    from public.profiles where id = auth.uid();

  if caller_role = 'master' and caller_company is not null then
    update public.companies
       set timezone = coalesce(nullif(trim(new_tz), ''), 'Australia/Sydney')
     where id = caller_company;
  else
    raise exception 'Not authorised.';
  end if;
end;
$$;

grant execute on function public.set_company_timezone(text) to authenticated;
