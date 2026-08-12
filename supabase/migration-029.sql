-- ============================================================================
-- Migration 029 — stop the same payment details being blacklisted twice
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS DOES
--   1. Removes exact double-entries (every identifying field identical).
--   2. Makes PayID unique per country.
--   3. Makes BSB + account number unique per country.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   NAME is not unique. One person is often listed under several spellings and
--   aliases, and two unrelated people genuinely share common names.
--
--   PHONE is not unique either, and that is a considered decision rather than
--   an oversight. 76 numbers in the current list appear on more than one entry.
--   Some are plain repeats, but others are one scammer under several aliases —
--   Kamal Erdlon / Paodel Angiit / Taylor Phillop J all sit on one number. A
--   hard rule would stop staff recording the next alias they catch, which is
--   precisely the intelligence the list exists to hold. The app warns about a
--   repeated number in the add form instead, and lets the person decide.
--
--   BSB ALONE is not unique and must never be: it identifies a bank BRANCH, not
--   a person. 173 rows share BSB 063097 and 172 share 067872. It only points at
--   one account when paired with the account number, which is why the second
--   index below covers both columns together.
--
-- WHY PARTIAL INDEXES ("where ... <> ''")
--   Rows with a blank PayID or blank account number are skipped. Without that,
--   the second entry that left the field empty would collide with the first and
--   be rejected — a rule that punishes missing data rather than duplicate data.
-- ============================================================================

-- ---- 1. remove exact double-entries -----------------------------------------
-- Only rows where the country, name, every phone number, PayID, BSB and account
-- number are ALL identical to an earlier row. Anything differing in even one of
-- those is a distinct report and is kept. The earliest row survives, so the
-- original report date is the one preserved.
with ranked as (
  select id,
         row_number() over (
           partition by country,
                        lower(trim(coalesce(name, ''))),
                        coalesce(trim(phone_digits), ''),
                        lower(trim(coalesce(payid, ''))),
                        coalesce(trim(bsb), ''),
                        coalesce(trim(account_no), '')
           order by created_at, id
         ) as rn
    from public.blacklist_members
)
delete from public.blacklist_members b
 using ranked r
 where b.id = r.id
   and r.rn > 1;

-- ---- 2. one PayID, one entry, per country -----------------------------------
-- Case-insensitive and trimmed, because a PayID is usually an email or phone
-- number and "Kelly@x.com" and "kelly@x.com " are the same destination.
create unique index if not exists blacklist_members_payid_uniq
  on public.blacklist_members (country, lower(trim(payid)))
  where coalesce(trim(payid), '') <> '';

-- ---- 3. one bank account, one entry, per country ----------------------------
create unique index if not exists blacklist_members_account_uniq
  on public.blacklist_members (country, trim(bsb), trim(account_no))
  where coalesce(trim(account_no), '') <> '';

-- ---- 4. what the app searches the list by -----------------------------------
-- The add form now checks a typed PayID and account number against the list
-- before saving, so the person adding sees the clash in the form rather than
-- only as a rejection after pressing save. That check runs client-side against
-- the already-loaded list, so it costs no extra queries — these indexes exist
-- for the uniqueness rules above, and serve that lookup for free.
