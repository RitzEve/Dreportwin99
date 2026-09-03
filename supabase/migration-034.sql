-- migration-034: atomic rate-limit check for the gateway webhook
--
-- Companion to migration-033. Kept as its own migration because 033 was already
-- applied when this need surfaced, and rewriting an applied migration hides
-- what actually ran against the database.
--
-- WHY A DATABASE FUNCTION AND NOT EDGE-FUNCTION CODE
--
-- The obvious version -- read the counter, add one, write it back -- is the
-- same read-modify-write race described at the top of migration-033. Two
-- webhooks arriving in the same millisecond both read count=99, both write 100,
-- and the limit never trips. Doing it in one INSERT ... ON CONFLICT DO UPDATE
-- makes the whole check a single atomic statement: Postgres serialises the two
-- callers on the row lock and the second one genuinely sees 100.
--
-- Returns the request count inside the current window. The caller refuses the
-- request when that number goes above its limit.
--
-- Window: 1 minute, rolling per gateway.

create or replace function public.bump_gateway_webhook_rate(p_gateway_id uuid)
returns integer
language sql
security definer
set search_path = public
as $fn$
  insert into public._gateway_webhook_ratelimit as r (gateway_id, window_start, count)
  values (p_gateway_id, now(), 1)
  on conflict (gateway_id) do update
     set window_start = case
           when r.window_start < now() - interval '1 minute' then now()
           else r.window_start
         end,
         count = case
           when r.window_start < now() - interval '1 minute' then 1
           else r.count + 1
         end
  returning count;
$fn$;

-- Only the service role (the edge function) may call this. Nobody signed into
-- the app has any business touching the rate limiter.
revoke all on function public.bump_gateway_webhook_rate(uuid) from public, anon, authenticated;

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- drop function if exists public.bump_gateway_webhook_rate(uuid);
-- ============================================================================
