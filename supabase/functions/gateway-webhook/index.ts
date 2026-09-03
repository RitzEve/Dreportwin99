// ============================================================================
//  gateway-webhook — the portal's public inbox for payment gateways
// ============================================================================
//
//  URL:  https://vveydcmdsmucaoqitnch.supabase.co/functions/v1/gateway-webhook/<gateway_id>
//
//  <gateway_id> is the uuid of a row in public.payment_gateways. Give a gateway
//  its own URL, set its webhook_secret, flip webhook_enabled to true, done.
//
//  WHAT THIS DELIBERATELY DOES NOT DO
//
//  It never reads or writes public.app_data. That table holds one 5 MB jsonb
//  blob per company; appending to it per payment would cost ~10 MB of traffic
//  a time and would silently lose payments to read-modify-write races. See the
//  header comment in supabase/migration-033.sql for the numbers. This function
//  appends one small row to public.gateway_events and stops there. Getting
//  those rows into FinTrack is a separate, deliberate, human-confirmed step.
//
//  WHY verify_jwt IS OFF
//
//  A payment gateway cannot send a Supabase JWT — it has never heard of
//  Supabase. So this function does its own authentication instead: an
//  HMAC-SHA256 signature over the raw body, checked against a per-gateway
//  secret. That check is the ONLY thing standing between this URL and the
//  database, which is why it happens before anything else touches the DB.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// A single payment is a few hundred bytes. 16 kB is generous and stops anyone
// filling the disk by POSTing giant bodies at a public URL.
const MAX_BODY_BYTES = 16 * 1024;

// Per gateway, per rolling minute. A healthy gateway sends far fewer; a gateway
// stuck in a retry loop gets refused cheaply instead of writing rows forever.
const MAX_PER_MINUTE = 120;

// Different gateways name this header differently. Accept the common spellings
// rather than making the owner care which one theirs uses.
const SIGNATURE_HEADERS = [
  'x-signature',
  'x-webhook-signature',
  'x-hub-signature-256',
  'signature',
];

// Likewise for the event's own id — the field that makes retries safe.
const EVENT_ID_FIELDS = [
  'event_id', 'eventId', 'id', 'transaction_id', 'transactionId',
  'order_id', 'orderId', 'reference', 'ref',
];

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

/** Constant-time HMAC check. crypto.subtle.verify does not leak timing. */
async function signatureIsValid(secret: string, body: string, given: string) {
  // Some gateways prefix the hex with "sha256=" (GitHub style). Tolerate it.
  const hex = given.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const sigBytes = new Uint8Array(
    hex.match(/../g)!.map((byte) => parseInt(byte, 16)),
  );

  return await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    new TextEncoder().encode(body),
  );
}

function pickEventId(payload: Record<string, unknown>): string | null {
  for (const field of EVENT_ID_FIELDS) {
    const value = payload[field];
    if (typeof value === 'string' && value.length > 0 && value.length <= 200) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function reply(status: number, message: string) {
  return new Response(message + '\n', {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

Deno.serve(async (req) => {
  // ---- 1. POST only -------------------------------------------------------
  if (req.method !== 'POST') {
    return reply(405, 'method not allowed');
  }

  // ---- 2. Which gateway is this? ------------------------------------------
  // Last path segment. The uuid is unguessable, but it is an identifier and
  // not a password — the secret below is what actually authenticates.
  const gatewayId = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!isUuid.test(gatewayId)) {
    return reply(404, 'not found');
  }

  // ---- 3. Refuse oversized bodies BEFORE reading them ---------------------
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return reply(413, 'body too large');
  }

  const raw = await req.text();
  // content-length can lie, so check what actually arrived too.
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return reply(413, 'body too large');
  }

  // ---- 4. Look up the gateway ---------------------------------------------
  // Narrow select: never `select('*')` on a table holding gateway passwords
  // and API keys. We need exactly three columns.
  const { data: gateway, error: lookupError } = await admin
    .from('payment_gateways')
    .select('company_id, webhook_secret, webhook_enabled')
    .eq('id', gatewayId)
    .maybeSingle();

  if (lookupError) {
    console.error('gateway lookup failed', lookupError.message);
    return reply(500, 'lookup failed');   // non-2xx => the gateway will retry
  }

  // Unknown, disabled and unconfigured all answer the same 404. Never confirm
  // to a stranger that a given id exists.
  if (!gateway || !gateway.webhook_enabled || !gateway.webhook_secret) {
    return reply(404, 'not found');
  }

  // ---- 5. Rate limit ------------------------------------------------------
  // Atomic, in one statement — see migration-034 for why it is not done here.
  const { data: hits, error: rateError } = await admin
    .rpc('bump_gateway_webhook_rate', { p_gateway_id: gatewayId });

  if (rateError) {
    console.error('rate limit check failed', rateError.message);
    return reply(500, 'rate check failed');
  }
  if ((hits ?? 0) > MAX_PER_MINUTE) {
    // 429 is a "slow down", not a "give up" — well-behaved senders back off.
    return reply(429, 'too many requests');
  }

  // ---- 6. THE SECURITY GATE ------------------------------------------------
  const given = SIGNATURE_HEADERS
    .map((header) => req.headers.get(header))
    .find((value) => value) ?? '';

  if (!given || !(await signatureIsValid(gateway.webhook_secret, raw, given))) {
    console.warn('rejected bad signature for gateway', gatewayId);
    return reply(401, 'bad signature');
  }

  // ---- 7. Parse, now that we know who sent it -----------------------------
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return reply(400, 'body is not valid json');
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return reply(400, 'body must be a json object');
  }

  const eventId = pickEventId(payload);
  if (!eventId) {
    // 400 not 500: retrying will not help, and we do not want the gateway
    // hammering us forever over a payload shape we cannot deduplicate.
    return reply(400, 'no usable event id in payload');
  }

  // ---- 8. Store it. ONE small row. Never app_data. ------------------------
  const { error: insertError } = await admin
    .from('gateway_events')
    .insert({
      gateway_id: gatewayId,
      company_id: gateway.company_id,
      event_id: eventId,
      payload,
    });

  if (insertError) {
    // 23505 = unique violation on (gateway_id, event_id) = we already have it.
    // This is a RETRY, not a problem. Answer 200 so the gateway stops resending.
    if (insertError.code === '23505') {
      return reply(200, 'ok (already received)');
    }
    console.error('insert failed', insertError.message);
    return reply(500, 'could not store event');  // genuine failure => retry us
  }

  // ---- 9. 200, fast --------------------------------------------------------
  return reply(200, 'ok');
});
