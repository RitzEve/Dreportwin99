#!/usr/bin/env node
// ============================================================================
//  XMEN9 -> DRW deposit puller
// ============================================================================
//
//  XMEN9's platform has no webhook. It offers a read API instead, so instead of
//  it telling us about a deposit, we ask. This script asks.
//
//  DRY RUN IS THE DEFAULT. Without --live it touches nothing: it reads from
//  XMEN9, prints what it found, and tells you exactly what it WOULD have
//  written. Run it that way until the numbers look right.
//
//  It writes into public.gateway_events (see migration-033) and never into
//  app_data -- that table is one 5 MB jsonb blob per company and appending to
//  it per deposit would cost ~10 MB of traffic a time and lose payments to
//  write races. Deposits land in the inbox; importing into FinTrack stays a
//  separate, human-confirmed step.
//
//  ------------------------------------------------------------------------
//  SETUP (one time)
//
//  1. XMEN9 backend -> MANAGE API -> ADD
//       - Untick "Check/Uncheck All", then tick ONLY
//         /transactions/getAllTransactions
//         (the form pre-ticks all 22 modules, and that list includes
//          /member/setScore, which MOVES CREDITS. Never grant it here.)
//       - Tick "Show Bank Account" only if you need bank details to match.
//       - Submit, then copy the Access ID and Token.
//
//  2. Create a file called .env in the project root (it is gitignored):
//
//       XMEN9_ACCESS_ID=12345
//       XMEN9_ACCESS_TOKEN=the-token-you-copied
//       XMEN9_MERCHANT_ID=10001
//       DRW_COMPANY_ID=<uuid of the company in DRW>
//       DRW_GATEWAY_ID=<uuid of the payment_gateways row to file these under>
//       # only needed for --live:
//       SUPABASE_URL=https://vveydcmdsmucaoqitnch.supabase.co
//       SUPABASE_SERVICE_ROLE_KEY=<service role key>
//
//  3. Run it (the --env-file flag is built into Node, no packages needed):
//
//       node --env-file=.env scripts/xmen9-pull-deposits.mjs --days=7
//
//  ------------------------------------------------------------------------
//  THE FIRST THING TO CHECK
//
//  XMEN9's transaction screen has four kinds of deposit -- DEPOSIT, STAFF
//  DEPOSIT, STAFF MANUAL DEPOSIT and AUTOPAY DEPOSIT -- but the API's `type`
//  filter only documents "DEPOSIT". Nobody knows yet whether that one value
//  covers all four. If it does not, a naive importer silently misses most
//  automated payments.
//
//  So run this FIRST:
//
//       node --env-file=.env scripts/xmen9-pull-deposits.mjs --survey --days=30
//
//  It fetches with no type filter and prints a breakdown of every `type` value
//  XMEN9 actually returned. That tells you what the API really gives you
//  before you rely on it.
// ============================================================================

const DEFAULTS = {
  apiUrl: process.env.XMEN9_API_URL || 'https://bkxm9.ns1469.com/api/v1/index.php',
  module: '/transactions/getAllTransactions',
  maxPages: 50,          // safety stop, so a bad filter cannot page forever
  pageDelayMs: 250,      // be polite to their server
};

// ---- tiny arg parser -------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  }),
);

const LIVE    = args.live === true;
const SURVEY  = args.survey === true;
const DAYS    = Number(args.days ?? 1);
const TYPE    = SURVEY ? null : (args.type ?? 'DEPOSIT');
const STATUS  = args.status ?? (SURVEY ? null : 'COMPLETED');
const VERBOSE = args.verbose === true;

// ---- helpers ---------------------------------------------------------------
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const money = (n) => Number(n || 0).toFixed(2);

function fail(message, hint) {
  console.error('\n  ' + message);
  if (hint) console.error('  ' + hint);
  console.error('');
  process.exit(1);
}

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    fail(
      'Missing from your .env: ' + missing.join(', '),
      'See the SETUP notes at the top of this file. Did you remember --env-file=.env ?',
    );
  }
}

function dateRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  return {
    sDate: args.from ? String(args.from) : fmt(start),
    eDate: args.to ? String(args.to) : fmt(end),
  };
}

// ---- the XMEN9 call --------------------------------------------------------
async function fetchPage(pageIndex, range) {
  const form = new FormData();
  form.append('module', DEFAULTS.module);
  form.append('accessId', process.env.XMEN9_ACCESS_ID);
  form.append('accessToken', process.env.XMEN9_ACCESS_TOKEN);
  form.append('merchantId', process.env.XMEN9_MERCHANT_ID);
  form.append('pageIndex', String(pageIndex));
  form.append('sDate', range.sDate);
  form.append('eDate', range.eDate);
  if (TYPE) form.append('type', TYPE);
  if (STATUS) form.append('status', STATUS);

  const res = await fetch(DEFAULTS.apiUrl, { method: 'POST', body: form });

  if (!res.ok) {
    fail(
      `XMEN9 answered HTTP ${res.status} on page ${pageIndex}.`,
      res.status === 403
        ? 'Often an IP whitelist problem: the key may be locked to an IP this machine is not using.'
        : 'Check the Access ID / Token, and that the key is ACTIVE.',
    );
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    fail('XMEN9 did not return JSON.', 'First 300 chars: ' + text.slice(0, 300));
  }

  if (json.status && json.status !== 'SUCCESS') {
    fail(
      'XMEN9 refused the request: ' + JSON.stringify(json).slice(0, 400),
      'If it mentions the module, the API key probably does not have '
        + '/transactions/getAllTransactions ticked.',
    );
  }

  return json.data ?? {};
}

async function fetchAll(range) {
  const all = [];
  let page = 1;
  let totalPage = 1;

  do {
    const data = await fetchPage(page, range);
    const rows = data.transactions ?? [];
    all.push(...rows);
    totalPage = Number(data.totalPage ?? 1);

    console.log(
      `  page ${page}/${totalPage}  ->  ${rows.length} rows`
      + (page === 1 && data.totalCount ? `   (totalCount ${data.totalCount})` : ''),
    );

    if (page >= totalPage || page >= DEFAULTS.maxPages) break;
    page++;
    await new Promise((r) => setTimeout(r, DEFAULTS.pageDelayMs));
  } while (true);

  if (page >= DEFAULTS.maxPages && page < totalPage) {
    console.log(`  (stopped at the ${DEFAULTS.maxPages}-page safety limit)`);
  }
  return all;
}

// ---- reporting -------------------------------------------------------------
function surveyReport(rows) {
  console.log('\n=== WHAT XMEN9 ACTUALLY RETURNED ===\n');

  const byType = {};
  const byStatus = {};
  for (const t of rows) {
    byType[t.type ?? '(none)'] = (byType[t.type ?? '(none)'] || 0) + 1;
    byStatus[t.status ?? '(none)'] = (byStatus[t.status ?? '(none)'] || 0) + 1;
  }

  console.log('  type values seen:');
  for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(k, 26)} ${String(v).padStart(6)}`);
  }
  console.log('\n  status values seen:');
  for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(k, 26)} ${String(v).padStart(6)}`);
  }

  console.log(`
  READ THIS CAREFULLY:
  The backend's transaction screen offers DEPOSIT, STAFF DEPOSIT,
  STAFF MANUAL DEPOSIT and AUTOPAY DEPOSIT as separate kinds.
  Compare that list against the type values above.

    - If the deposit-ish rows all come back as plain "DEPOSIT", then
      type=DEPOSIT is enough and the puller is safe as written.
    - If you see AUTOPAY DEPOSIT (or others) as their own values, then
      filtering on type=DEPOSIT WOULD MISS THEM. Tell me which values
      appeared and I will widen the filter.
`);
}

function dryRunReport(rows, range) {
  console.log('\n=== DRY RUN - nothing was written ===\n');
  console.log(`  window : ${range.sDate}  ->  ${range.eDate}`);
  console.log(`  filter : type=${TYPE ?? '(any)'}  status=${STATUS ?? '(any)'}`);
  console.log(`  found  : ${rows.length} transactions\n`);

  if (!rows.length) {
    console.log('  Nothing in that window. Try a wider --days=N.\n');
    return;
  }

  const show = VERBOSE ? rows : rows.slice(0, 15);
  console.log(
    '  ' + pad('id', 10) + pad('type', 22) + pad('status', 12)
    + pad('amount', 12) + pad('when', 22) + 'bank / method',
  );
  console.log('  ' + '-'.repeat(100));

  for (const t of show) {
    let detail = '';
    try {
      const d = typeof t.details === 'string' ? JSON.parse(t.details) : (t.details || {});
      detail = [d.bank, d.method].filter(Boolean).join(' / ');
    } catch { detail = String(t.details ?? '').slice(0, 30); }

    console.log(
      '  ' + pad(t.id, 10) + pad(t.type, 22) + pad(t.status, 12)
      + pad(money(t.cash), 12) + pad((t.createdDateTime || '').slice(0, 19), 22) + detail,
    );
  }
  if (!VERBOSE && rows.length > show.length) {
    console.log(`  ... and ${rows.length - show.length} more (add --verbose to list all)`);
  }

  const total = rows.reduce((s, t) => s + Number(t.cash || 0), 0);
  console.log('\n  ' + '-'.repeat(100));
  console.log(`  total value: ${money(total)}`);
  console.log(`\n  WOULD insert ${rows.length} rows into gateway_events (status 'pending').`);
  console.log('  Re-run with --live once these numbers look right.\n');
}

// ---- the live write --------------------------------------------------------
async function writeToInbox(rows) {
  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DRW_COMPANY_ID', 'DRW_GATEWAY_ID']);
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const payloadRows = rows.map((t) => ({
    gateway_id: process.env.DRW_GATEWAY_ID,
    company_id: process.env.DRW_COMPANY_ID,
    event_id: `xmen9:${t.id}`,       // namespaced: XMEN9's id can never collide with a real gateway's
    payload: t,
  }));

  // One call, not one per row. ignoreDuplicates leans on the unique index from
  // migration-033 -- re-running this script is harmless by construction.
  let written = 0;
  for (let i = 0; i < payloadRows.length; i += 500) {
    const chunk = payloadRows.slice(i, i + 500);
    const { data, error } = await db
      .from('gateway_events')
      .upsert(chunk, { onConflict: 'gateway_id,event_id', ignoreDuplicates: true })
      .select('id');
    if (error) fail('Insert failed: ' + error.message);
    written += (data ?? []).length;
  }

  console.log(`\n=== LIVE ===\n`);
  console.log(`  ${rows.length} fetched, ${written} newly inserted, `
    + `${rows.length - written} already present (skipped).`);
  console.log(`  They are sitting in gateway_events with status 'pending'.\n`);
}

// ---- main ------------------------------------------------------------------
(async () => {
  requireEnv(['XMEN9_ACCESS_ID', 'XMEN9_ACCESS_TOKEN', 'XMEN9_MERCHANT_ID']);

  const range = dateRange(DAYS);

  console.log('');
  console.log(`  ${SURVEY ? 'SURVEY' : LIVE ? 'LIVE' : 'DRY RUN'}  -  XMEN9 deposit puller`);
  console.log(`  ${DEFAULTS.apiUrl}`);
  console.log(`  window ${range.sDate} -> ${range.eDate}\n`);

  const rows = await fetchAll(range);

  if (SURVEY) return surveyReport(rows);
  if (!LIVE)  return dryRunReport(rows, range);

  if (!rows.length) {
    console.log('\n  Nothing to write.\n');
    return;
  }
  await writeToInbox(rows);
})().catch((e) => fail('Unexpected error: ' + e.message, e.stack?.split('\n')[1]?.trim()));
