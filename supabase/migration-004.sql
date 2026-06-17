-- ============================================================================
-- Migration 004 — per-company time zone
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- Adds a `timezone` column to companies. Each company's transaction date/time
-- is stamped in this zone. Existing + new companies default to Sydney time.
-- ============================================================================

alter table public.companies
  add column if not exists timezone text not null default 'Australia/Sydney';
