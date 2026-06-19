-- ============================================================================
-- Migration 006 — company logo (an image shown instead of the company name)
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- 1) Adds a "logo" column to companies. It holds a small image (stored as text).
--    Empty/absent = no logo, so the app just shows the company name as before.
-- 2) Adds a small function so a MASTER can set/clear ONLY their own company's
--    logo (the provider can already update any company directly).
-- ============================================================================

alter table public.companies add column if not exists logo text;

create or replace function public.set_company_logo(new_logo text)
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
       set logo = nullif(trim(coalesce(new_logo, '')), '')
     where id = caller_company;
  else
    raise exception 'Not authorised.';
  end if;
end;
$$;

grant execute on function public.set_company_logo(text) to authenticated;
