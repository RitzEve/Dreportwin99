#!/usr/bin/env node
// ============================================================================
//  Casino -> DRW deposit puller
// ============================================================================
//
//  The casino platform has no webhook. It offers a read API instead, so rather
//  than it telling us about a deposit, we ask. This script asks.
//
//  DRY RUN IS THE DEFAULT. Without --live it touches nothing: it reads from the
//  casino, prints what it found, and says exactly what it WOULD have written.
//
//  It writes into public.gateway_events (migration-033) and never into
//  app_data -- that table is one 5 MB jsonb blob per company, and appending to
//  it per deposit would cost ~10 MB of traffic a time and lose payments to
//  write races. Deposits land in the inbox as 'pending'; importing them into
//  FinTrack stays a separate, human-confirmed step.
//
//  This script can ONLY read from the casino. It sends exactly one module,
//  /transactions/getAllTransactions. Its only write anywhere is the upsert
//  into DRW's own database.
//
//  ------------------------------------------------------------------------
//  USAGE
//
//    node --env-file=.env scripts/casino-pull-deposits.mjs --brand=megabet --survey --days=30
//    node --env-file=.env scripts/casino-pull-deposits.mjs --brand=megabet --days=7
//    node --env-file=.env scripts/casino-pull-deposits.mjs --brand=megabet --days=7 --live
//
//  RUN --survey FIRST. The backend's transaction screen has four kinds of
//  deposit -- DEPOSIT, STAFF DEPOSIT, STAFF MANUAL DEPOSIT and AUTOPAY DEPOSIT
//  -- but the API documents only "DEPOSIT". Nobody knows yet whether that one
//  value covers all four. --survey drops the type filter and prints every type
//  value the casino actually returned, so you can see before you rely on it.
//
//  ------------------------------------------------------------------------
//  CREDENTIALS
//
//  Create your own key in the casino backend: MANAGE API -> ADD.
//  Untick "Check/Uncheck All", then tick ONLY /transactions/getAllTransactions.
//  The form pre-ticks all 22 modules and that list includes /member/setScore,
//  which transfers credits between users. Never grant that to an importer.
//  Leave the "Show ... mobile / bank account / email" boxes off unless you
//  actually need those fields to match a deposit.
//
//  Put the values in .env (gitignored). The per-brand variable wins and the
//  plain one is the fallback, so one .env can hold several brands. The brand
//  name goes FIRST -- for --brand=megabet:
//
//    MEGABET_CASINO_ACCESS_ID     / CASINO_ACCESS_ID
//    MEGABET_CASINO_ACCESS_TOKEN  / CASINO_ACCESS_TOKEN
//    MEGABET_CASINO_MERCHANT_ID   / CASINO_MERCHANT_ID  (profile default if unset)
//    MEGABET_CASINO_API_URL       / CASINO_API_URL      (profile default if unset)
//    MEGABET_DRW_COMPANY_ID       / DRW_COMPANY_ID      (--live only)
//    MEGABET_DRW_GATEWAY_ID       / DRW_GATEWAY_ID      (--live only)
// ============================================================================

// ---- Brand profiles --------------------------------------------------------
// apiUrl here is a default; anything in .env overrides it.
//
// merchantId is DELIBERATELY null for every brand -- it must come from .env.
// Do not be tempted to read it off the MANAGE API page: the field there is
// "Grant Access To Master BO", which is the merchant a key is granted access
// TO, not the merchant the brand IS. They are different numbers, and getting
// it wrong does not throw -- the API happily returns a DIFFERENT merchant's
// transactions, which would then be filed into a DRW company as if they were
// yours. Get this value from the brand's own account details.
const PROFILES = {
  megabet: {
    label: 'MegaBet26',
    apiUrl: 'https://jkaswn9.u55y38.com/api/v1/index.php',
    merchantId: null,
    urlVerified: false,               // host confirmed; /api/v1 path assumed, same platform
  },
  xmen9: {
    label: 'Xmen9',
    apiUrl: 'https://bkxm9.ns1469.com/api/v1/index.php',
    merchantId: null,                 // set CASINO_XMEN9_MERCHANT_ID
    urlVerified: true,                // watched the admin panel call this exact endpoint
  },
  mario96: {
    label: 'Mario96',
    apiUrl: 'https://jkmr96au.u55y38.com/api/v1/index.php',
    merchantId: null,
    urlVerified: false,               // host from DRW company_credentials, never tested
  },
};

const SETTINGS = {
  module: '/transactions/getAllTransactions',
  maxPages: 50,      // safety stop, so a bad filter cannot page forever
  pageDelayMs: 250,  // be polite to their server
};

// ---- args ------------------------------------------------------------------
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

// Per-brand variable wins, plain one is the fallback:
//   CASINO_MEGABET_ACCESS_ID  ->  CASINO_ACCESS_ID
function envFor(brand, suffix) {
  const specific = `${brand.toUpperCase()}_${suffix}`;
  return process.env[specific] ?? process.env[suffix] ?? null;
}

const BRAND = typeof args.brand === 'string' ? args.brand.toLowerCase() : null;
if (!BRAND || !PROFILES[BRAND]) {
  fail(
    BRAND ? `Unknown brand "${BRAND}".` : 'Missing --brand.',
    'Use one of: ' + Object.keys(PROFILES).map((b) => '--brand=' + b).join('  '),
  );
}
const PROFILE = PROFILES[BRAND];

const CONFIG = {
  apiUrl:      envFor(BRAND, 'CASINO_API_URL')     ?? PROFILE.apiUrl,
  accessId:    envFor(BRAND, 'CASINO_ACCESS_ID'),
  accessToken: envFor(BRAND, 'CASINO_ACCESS_TOKEN'),
  merchantId:  envFor(BRAND, 'CASINO_MERCHANT_ID') ?? PROFILE.merchantId,
  companyId:   envFor(BRAND, 'DRW_COMPANY_ID'),
  gatewayId:   envFor(BRAND, 'DRW_GATEWAY_ID'),
};

function requireConfig(keys) {
  const missing = keys.filter((k) => !CONFIG[k]);
  if (missing.length) {
    const names = missing.map((k) => {
      const suffix = { accessId: 'CASINO_ACCESS_ID', accessToken: 'CASINO_ACCESS_TOKEN',
        merchantId: 'CASINO_MERCHANT_ID', companyId: 'DRW_COMPANY_ID',
        gatewayId: 'DRW_GATEWAY_ID' }[k];
      return `${BRAND.toUpperCase()}_${suffix}  (or ${suffix})`;
    });
    fail(
      'Missing from your .env:\n    ' + names.join('\n    '),
      'Did you remember  --env-file=.env  ?',
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

// ---- the casino call -------------------------------------------------------
async function fetchPage(pageIndex, range) {
  const form = new FormData();
  form.append('module', SETTINGS.module);
  form.append('accessId', CONFIG.accessId);
  form.append('accessToken', CONFIG.accessToken);
  form.append('merchantId', CONFIG.merchantId);
  form.append('pageIndex', String(pageIndex));
  form.append('sDate', range.sDate);
  form.append('eDate', range.eDate);
  if (TYPE) form.append('type', TYPE);
  if (STATUS) form.append('status', STATUS);

  let res;
  try {
    res = await fetch(CONFIG.apiUrl, { method: 'POST', body: form });
  } catch (e) {
    fail(
      `Could not reach ${CONFIG.apiUrl}`,
      PROFILE.urlVerified
        ? 'Network problem? ' + e.message
        : `That URL is a best guess for ${PROFILE.label} and has never been tested. `
          + 'Check the real one in the backend and set ' + BRAND.toUpperCase() + '_CASINO_API_URL.',
    );
  }

  if (!res.ok) {
    fail(
      `${PROFILE.label} answered HTTP ${res.status} on page ${pageIndex}.`,
      res.status === 403
        ? 'Usually the IP whitelist: the key may be locked to an address this machine is not using. '
          + 'Check MANAGE API -> the key\'s "Whitelisted IP Address".'
        : 'Check the Access ID / Token, that the key is ACTIVE, and that '
          + '/transactions/getAllTransactions is ticked on it.',
    );
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    fail(
      `${PROFILE.label} did not return JSON.`,
      (PROFILE.urlVerified ? '' : 'The API URL for this brand is unverified - you may be hitting a web page, not the API. ')
        + 'First 300 chars: ' + text.slice(0, 300),
    );
  }

  if (json.status && json.status !== 'SUCCESS') {
    fail(
      'The casino refused the request: ' + JSON.stringify(json).slice(0, 400),
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

    if (page >= totalPage || page >= SETTINGS.maxPages) break;
    page++;
    await new Promise((r) => setTimeout(r, SETTINGS.pageDelayMs));
  } while (true);

  if (page >= SETTINGS.maxPages && page < totalPage) {
    console.log(`  (stopped at the ${SETTINGS.maxPages}-page safety limit -- narrow --days)`);
  }
  return all;
}

// ---- reporting -------------------------------------------------------------

// Every transaction carries the merchant it belongs to. If that does not match
// the merchantId we asked with, we are looking at someone else's data -- say so
// loudly rather than quietly importing it. Returns true if anything looks off.
function merchantMismatch(rows) {
  const seen = [...new Set(rows.map((t) => String(t.merchantId ?? '')).filter(Boolean))];
  if (!seen.length) return false;

  const asked = String(CONFIG.merchantId);
  const foreign = seen.filter((m) => m !== asked);
  if (!foreign.length) return false;

  console.log('\n  !! MERCHANT MISMATCH');
  console.log(`     asked for merchantId ${asked}`);
  console.log(`     but these rows belong to: ${seen.join(', ')}`);
  console.log('     These transactions are not this brand\'s. Do NOT run --live.');
  console.log('     Check the merchant id -- note the MANAGE API page\'s');
  console.log('     "Grant Access To Master BO" is a DIFFERENT number.\n');
  return true;
}

function surveyReport(rows) {
  console.log('\n=== WHAT ' + PROFILE.label.toUpperCase() + ' ACTUALLY RETURNED ===\n');

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

  const merchants = [...new Set(rows.map((t) => t.merchantId).filter(Boolean))];
  console.log(`\n  merchantId on the returned rows: ${merchants.join(', ') || '(none)'}`);
  merchantMismatch(rows);

  console.log(`
  READ THIS CAREFULLY:
  The backend's transaction screen offers DEPOSIT, STAFF DEPOSIT,
  STAFF MANUAL DEPOSIT and AUTOPAY DEPOSIT as separate kinds.
  Compare that list against the type values above.

    - If the deposit-ish rows all come back as plain "DEPOSIT", then
      type=DEPOSIT is enough and the puller is correct as written.
    - If you see AUTOPAY DEPOSIT (or others) as their own values, then
      filtering on type=DEPOSIT WOULD MISS THEM. Say which values
      appeared and the filter can be widened before any --live run.
`);
}

function dryRunReport(rows, range) {
  console.log('\n=== DRY RUN - nothing was written ===\n');
  console.log(`  brand  : ${PROFILE.label}`);
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

  if (merchantMismatch(rows)) return;

  console.log(`\n  WOULD insert ${rows.length} rows into gateway_events as '${BRAND}:<id>' (status 'pending').`);
  console.log('  Re-run with --live once these numbers look right.\n');
}

// ---- the live write --------------------------------------------------------
async function writeToInbox(rows) {
  // Refuse, do not merely warn. Importing another merchant's transactions into
  // a tenant's books is not something to leave to whether anyone read a warning.
  if (merchantMismatch(rows)) {
    fail(
      'Refusing to write: the returned rows do not all belong to merchant '
        + CONFIG.merchantId + '.',
      'Fix the merchant id and re-run the dry run first.',
    );
  }

  requireConfig(['companyId', 'gatewayId']);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in your .env.');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const payloadRows = rows.map((t) => ({
    gateway_id: CONFIG.gatewayId,
    company_id: CONFIG.companyId,
    // Namespaced by brand so two casinos can never collide on a numeric id.
    event_id: `${BRAND}:${t.id}`,
    payload: t,
  }));

  // One call per 500, not one per row. ignoreDuplicates leans on the unique
  // index from migration-033, so re-running this is harmless by construction.
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

  console.log('\n=== LIVE ===\n');
  console.log(`  ${rows.length} fetched, ${written} newly inserted, `
    + `${rows.length - written} already present (skipped).`);
  console.log("  They are in gateway_events with status 'pending'.\n");
}

// ---- main ------------------------------------------------------------------
(async () => {
  requireConfig(['accessId', 'accessToken', 'merchantId']);

  const range = dateRange(DAYS);

  console.log('');
  console.log(`  ${SURVEY ? 'SURVEY' : LIVE ? 'LIVE' : 'DRY RUN'}  -  ${PROFILE.label} deposit puller`);
  console.log(`  ${CONFIG.apiUrl}${PROFILE.urlVerified ? '' : '   (URL unverified for this brand)'}`);
  console.log(`  merchant ${CONFIG.merchantId}`);
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
