-- migration-036: correct migration-035 -- consolidate back to ONE row, house convention
--
-- 035 made the three fused numbers searchable, but in the wrong SHAPE. I designed
-- it before checking how the lookup consumes phone_digits. It does this
-- (FinTrack.jsx blacklistIndex):
--
--     const nums = String(b.phoneDigits||"").trim()
--       ? String(b.phoneDigits).trim().split(/\s+/)
--       : extractNumbers(b.phone);
--
-- So the convention is ONE row per reported person, with EVERY number for that
-- person space-separated in phone_digits -- the lookup splits on whitespace and
-- indexes each one. Three other rows in the table already look exactly like this
-- (13 numbers on one of them). 035's three-row split worked, but left the only
-- entry in the list that shows one person three times.
--
-- This restores the single row: raw reported text back in `phone` (unaltered, as
-- the other multi-number rows keep it), all three numbers in phone_digits, bank
-- details and original 2024-02-29 date untouched. 035 is left in the history
-- as applied rather than rewritten -- it is what actually ran.

begin;

-- Drop the two rows 035 inserted. Bank columns were never copied to them, so
-- nothing unique is lost.
delete from public.blacklist_members
 where name = 'Stevens Jazmin Lee'
   and id <> 'ed274b72-8b87-4060-a661-90abbe02a0f8';

update public.blacklist_members
   set phone        = '61466129508-61481908396-61468593648',
       phone_digits = '466129508 481908396 468593648'
 where id = 'ed274b72-8b87-4060-a661-90abbe02a0f8';

commit;
