-- ============================================================================
-- Migration 010 — nationality on team accounts (master/manager/staff)
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- Adds a `nationality` column to profiles (Malaysia / Indonesia / Philippine /
-- Cambodia / Others, or blank if never set). Shown as a short code (MY/ID/PH/CA/
-- Other) in the Console team list and in the Off-day counts table.
-- ============================================================================

alter table public.profiles
  add column if not exists nationality text;
