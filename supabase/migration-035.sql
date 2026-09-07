-- migration-035: split one fused blacklist phone entry into three searchable rows
--
-- Found during the 2026-09-07 health check. A single imported row stored three
-- separate Australian mobiles joined by dashes:
--     61466129508-61481908396-61468593648
-- phone_digits was empty, so the blacklist warning matched NONE of the three.
-- Confirmed by query: no other row made any of them findable either.
--
-- Why it was empty: lib/phone.js extractNumbers() splits on / \ , ; and
-- deliberately NOT on spaces or dashes, because a dash is normally written
-- INSIDE one number ("0412-345-678") and splitting there would shred a valid
-- entry into fragments too short to keep. That design is right; this row is the
-- lone outlier where dashes join whole numbers. One row in 3,471 does not
-- justify loosening the parser -- fix the data, leave the code alone.
--
-- phone_digits holds the NORMALISED subscriber part (normalizePhone strips the
-- 61 country code and any trunk zero), which is why these are 9 digits, not 11.
-- Writing the 11-digit form here would have looked fixed and matched nothing.

begin;

-- 1. Keep the primary number on the original row. It is the number the entry's
--    PayID (466129508) already corresponds to, so the bank details stay with it.
update public.blacklist_members
   set phone = '61466129508', phone_digits = '466129508'
 where id = 'ed274b72-8b87-4060-a661-90abbe02a0f8'
   and phone = '61466129508-61481908396-61468593648';

-- 2. The other two numbers become their own rows: same person, same reason,
--    same reporter, same original date. Bank details are NOT copied -- payid and
--    (bsb, account_no) each carry a unique index, and the product rule is that one
--    account or PayID appears on the list exactly once. Guarded so a re-run is a
--    no-op rather than a duplicate.
insert into public.blacklist_members
      (country, name, phone, phone_digits, reason,
       added_by_company_id, added_by_company, added_by_user_id, added_by_name, created_at)
select b.country, b.name, v.phone, v.digits, b.reason,
       b.added_by_company_id, b.added_by_company, b.added_by_user_id, b.added_by_name, b.created_at
  from public.blacklist_members b
 cross join (values ('61481908396','481908396'),
                    ('61468593648','468593648')) v(phone, digits)
 where b.id = 'ed274b72-8b87-4060-a661-90abbe02a0f8'
   and not exists (select 1 from public.blacklist_members x
                    where x.country = b.country and x.phone_digits = v.digits);

commit;
