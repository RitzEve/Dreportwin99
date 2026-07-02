-- ============================================================================
-- Migration 011 — let anyone set their OWN nationality
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
-- (Needs migration-010 first — it adds the profiles.nationality column.)
--
-- A master can already set a manager/staff nationality, but no one could set
-- their OWN (a manager isn't allowed to edit their own profile row by the normal
-- rules). This adds a small function so ANY signed-in account can change ONLY its
-- own nationality — nothing else — without widening the profiles update policy
-- (which would risk letting someone change their own role).
-- ============================================================================

create or replace function public.set_own_nationality(new_nat text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  clean text;
begin
  -- Empty clears it; otherwise store the trimmed value (max 40 chars).
  clean := nullif(left(trim(coalesce(new_nat, '')), 40), '');
  update public.profiles
     set nationality = clean
   where id = auth.uid();
end;
$$;

grant execute on function public.set_own_nationality(text) to authenticated;
