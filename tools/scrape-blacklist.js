/* ============================================================================
 * Blacklist scraper — run this in YOUR OWN browser, while logged in.
 * ============================================================================
 *
 * WHAT IT DOES
 *   Walks every page of the blacklist list, collects all the records, and saves
 *   them to a CSV file on your computer. Nothing is sent anywhere — it only
 *   reads pages you can already see, using the login you already have open.
 *
 * HOW TO RUN IT
 *   1. Log in to the blacklist site as normal.
 *   2. Go to the Blacklist Customers page (the one with the list).
 *   3. Press F12 to open the developer tools, and click the "Console" tab.
 *   4. If it warns you about pasting, type  allow pasting  and press Enter.
 *   5. Paste this whole file in, press Enter, and wait. Progress prints as it
 *      goes; a CSV downloads automatically at the end.
 *
 * WHY IT READS JSON RATHER THAN THE TABLE ON SCREEN
 *   The site is a Laravel + Inertia app: the page it serves is an empty shell,
 *   and the table you see is built afterwards by JavaScript. An earlier version
 *   of this script looked for <table> tags in the fetched HTML and found none —
 *   61 KB of perfectly valid response with zero rows in it. Inertia parks the
 *   whole page payload as JSON in a data-page attribute on the root element, so
 *   that is what we read: it is the same data the table is drawn from, and it
 *   arrives with the database's own field names already attached.
 * ========================================================================== */

(async () => {
  // ---------------- EASY CONFIG ------------------------------------------
  const PAGE_SIZE = 200;   // the site's own pageSize param, turned up from 50
  const MAX_PAGES = 500;   // safety stop
  const DELAY_MS  = 250;   // pause between pages, so the server isn't hammered
  const FILENAME  = 'blacklist-export.csv';
  // -----------------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* The Inertia payload, parsed off the root element's data-page attribute. */
  const parsePage = (root) => {
    const el = root.querySelector('[data-page]');
    if (!el) return null;
    try { return JSON.parse(el.getAttribute('data-page')); } catch { return null; }
  };

  /* Find the records inside the page props without hard-coding where they live:
     prefer a Laravel paginator ({data:[...], last_page, total}) because its
     meta tells us when to stop, and otherwise fall back to the biggest array of
     plain objects on the page. */
  const locate = (node, depth = 0, best = { rows: [], meta: null }) => {
    if (!node || typeof node !== 'object' || depth > 8) return best;
    if (Array.isArray(node)) {
      const first = node[0];
      if (node.length > best.rows.length && first && typeof first === 'object' && !Array.isArray(first)) {
        best = { rows: node, meta: best.meta };
      }
      return best;
    }
    if (Array.isArray(node.data) && node.data.length && typeof node.data[0] === 'object') {
      if (node.data.length >= best.rows.length) best = { rows: node.data, meta: node };
    }
    for (const v of Object.values(node)) best = locate(v, depth + 1, best);
    return best;
  };

  const urlFor = (n) => {
    const u = new URL(window.location.href);
    u.searchParams.set('page', String(n));
    u.searchParams.set('pageSize', String(PAGE_SIZE));
    return u.toString();
  };

  // Read the page already on screen first, to confirm we can find the records
  // at all before firing off a run of requests.
  const live = parsePage(document);
  if (!live) {
    console.error('Could not read this page\'s data. Are you on the Blacklist Customers page?');
    return;
  }
  const probe = locate(live.props);
  if (!probe.rows.length) {
    console.error('Read the page data, but found no list of records in it. Prop keys:', Object.keys(live.props || {}));
    return;
  }
  console.log('Record fields:', Object.keys(probe.rows[0]).join(' | '));
  if (probe.meta) {
    console.log(`Paginator: ${probe.meta.total ?? '?'} records in total`);
  }

  const all = [];
  const seen = new Set();
  let lastPage = null;

  for (let p = 1; p <= MAX_PAGES; p++) {
    let payload;
    try {
      const res = await fetch(urlFor(p), { credentials: 'include' });
      if (!res.ok) { console.warn(`Page ${p}: HTTP ${res.status} — stopping.`); break; }
      payload = parsePage(new DOMParser().parseFromString(await res.text(), 'text/html'));
    } catch (err) {
      console.warn(`Page ${p} failed (${err.message}) — stopping.`);
      break;
    }
    if (!payload) { console.warn(`Page ${p}: no page data returned — stopping.`); break; }

    const { rows, meta } = locate(payload.props);
    if (meta && meta.last_page) lastPage = meta.last_page;
    if (!rows.length) { console.log(`Page ${p} came back empty. Done.`); break; }

    // Dedupe by id so a server that ignores ?page= can't pad the file with
    // repeats — and so a re-run picks up where it makes sense.
    let added = 0;
    for (const r of rows) {
      const key = r.id ?? JSON.stringify(r);
      if (seen.has(key)) continue;
      seen.add(key); all.push(r); added++;
    }
    console.log(`page ${p}: ${rows.length} records (${added} new) — ${all.length} collected`);

    if (!added) { console.log('Nothing new on that page — pagination has run out. Stopping.'); break; }
    if (lastPage && p >= lastPage) { console.log('Reached the last page.'); break; }
    await sleep(DELAY_MS);
  }

  if (!all.length) { console.error('No records collected.'); return; }

  // Union of every field seen across all records, so one row missing a key
  // can't shift every later column along by one.
  const cols = [...new Set(all.flatMap(Object.keys))];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v);
    return `"${String(s).replace(/"/g, '""')}"`;
  };
  const csv = [cols.map(esc).join(','), ...all.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');

  // A BOM so Excel opens names and symbols correctly instead of as mojibake.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();

  console.log(`Done — ${all.length} records saved to ${FILENAME}`);
})();
