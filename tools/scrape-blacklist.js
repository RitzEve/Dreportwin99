/* ============================================================================
 * Blacklist scraper — run this in YOUR OWN browser, while logged in.
 * ============================================================================
 *
 * WHAT IT DOES
 *   Walks every page of the blacklist table, collects all the rows, and saves
 *   them to a CSV file on your computer. Nothing is sent anywhere — it only
 *   reads pages you can already see, using the login you already have open.
 *
 * HOW TO RUN IT
 *   1. Log in to the blacklist site as normal.
 *   2. Go to the Blacklist Customers page (the one with the table).
 *   3. Press F12 to open the developer tools, and click the "Console" tab.
 *   4. If it warns you about pasting, type  allow pasting  and press Enter.
 *   5. Paste this whole file in, press Enter, and wait. Progress prints as it
 *      goes; a CSV downloads automatically at the end.
 *
 * IF SOMETHING LOOKS WRONG
 *   Check the EASY CONFIG block below — PAGE_PARAM and MAX_PAGES are the two
 *   things most likely to need adjusting. Everything else adapts on its own.
 * ========================================================================== */

(async () => {
  // ---------------- EASY CONFIG ------------------------------------------
  const PAGE_PARAM = 'page';   // the ?page=2 bit in the address bar
  const START_PAGE = 1;
  const MAX_PAGES  = 400;      // safety stop, ~25 rows/page covers 10,000 rows
  const DELAY_MS   = 250;      // pause between pages, so the server isn't hammered
  const FILENAME   = 'blacklist-export.csv';
  // -----------------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Find the biggest table on a page — the results grid, not a layout table. */
  const findTable = (doc) => {
    const tables = [...doc.querySelectorAll('table')];
    if (!tables.length) return null;
    return tables.sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length)[0];
  };

  /* Column names, read from the header row. Matching by NAME rather than
     position means the export stays correct even if columns get reordered. */
  const readHeaders = (table) => {
    const head = table.querySelector('thead tr') || table.querySelector('tr');
    return [...head.querySelectorAll('th,td')].map((c) =>
      c.textContent.replace(/[▲▼↕\s]+/g, ' ').trim());
  };

  /* One page's data rows as arrays of cell text. */
  const readRows = (table) => {
    const body = table.querySelector('tbody') || table;
    return [...body.querySelectorAll('tr')]
      .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
      .filter((cells) => cells.length && cells.some((c) => c !== ''));
  };

  const pageUrl = (n) => {
    const u = new URL(window.location.href);
    u.searchParams.set(PAGE_PARAM, String(n));
    return u.toString();
  };

  // Start from the page already on screen, so any search/status filter you've
  // set is respected rather than silently ignored.
  const firstTable = findTable(document);
  if (!firstTable) {
    console.error('No table found on this page. Are you on the Blacklist Customers page?');
    return;
  }
  const headers = readHeaders(firstTable);
  console.log('Columns found:', headers.join(' | '));

  const all = [];
  const seen = new Set();          // guards against a site that returns page 1 forever
  let emptyStreak = 0;

  for (let p = START_PAGE; p <= MAX_PAGES; p++) {
    let rows;
    try {
      const res = await fetch(pageUrl(p), { credentials: 'include' });
      if (!res.ok) { console.warn(`Page ${p}: HTTP ${res.status} — stopping.`); break; }
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const t = findTable(doc);
      rows = t ? readRows(t) : [];
    } catch (err) {
      console.warn(`Page ${p} failed (${err.message}) — stopping.`);
      break;
    }

    if (!rows.length) {
      if (++emptyStreak >= 2) { console.log(`No more rows after page ${p}. Done.`); break; }
      continue;
    }
    emptyStreak = 0;

    // If a page repeats content we've already taken, pagination isn't working
    // the way we assumed — stop rather than loop forever collecting duplicates.
    const fingerprint = rows[0].join('|');
    if (seen.has(fingerprint)) {
      console.log(`Page ${p} repeats earlier data — pagination looks finished. Stopping.`);
      break;
    }
    seen.add(fingerprint);

    all.push(...rows);
    if (p % 10 === 0 || p === START_PAGE) console.log(`page ${p} … ${all.length} rows so far`);
    await sleep(DELAY_MS);
  }

  if (!all.length) { console.error('No rows collected.'); return; }

  // Proper CSV quoting: wrap every field and double any quotes inside it, so
  // commas, line breaks and quotes in the Reason column can't break the file.
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...all].map((r) => r.map(esc).join(',')).join('\r\n');

  // A BOM so Excel opens names and symbols correctly instead of as mojibake.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();

  console.log(`Done — ${all.length} rows saved to ${FILENAME}`);
})();
