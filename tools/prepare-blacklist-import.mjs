/*
 * Turns the blacklist site's CSV export into a CSV that matches the
 * blacklist_members table, ready for Supabase's own "Import data from CSV".
 *
 *   node tools/prepare-blacklist-import.mjs <source.csv> <output.csv>
 *
 * Decisions baked in, and why:
 *  - COUNTRY is Australia for every row. The source is an Australian list and
 *    not one number in it carries a Malaysian (60) prefix; the odd-looking
 *    prefixes are mistyped local numbers, not foreign ones. Guessing per-row
 *    would misfile them.
 *  - PHONE is kept exactly as typed, however messy ("MANY", "N/A", two numbers
 *    separated by /). phone_digits gets every real number found in that text,
 *    space-separated, so a row listing two numbers can match on either.
 *  - CREATED_AT keeps the original report date. An entry filed in June should
 *    not read as reported today.
 *  - ADDED_BY in the export is a numeric user id, not a name, so it can't be
 *    resolved to "ausstaff" etc. Recorded as "user #7" — honest about what's
 *    actually known rather than inventing a name.
 */
import fs from 'node:fs';

const [,, SRC, OUT] = process.argv;
if (!SRC || !OUT) { console.error('usage: node prepare-blacklist-import.mjs <src.csv> <out.csv>'); process.exit(1); }

function parseCSV(text){const rows=[];let row=[],cur='',q=false;
for(let i=0;i<text.length;i++){const c=text[i];
if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}
else if(c==='"')q=true;else if(c===','){row.push(cur);cur='';}
else if(c==='\r'){}else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur='';}else cur+=c;}
if(cur!==''||row.length){row.push(cur);rows.push(row);}return rows;}

/* Every plausible phone number in a free-text field, normalised so the same
   subscriber matches however it was typed.
 *
 * Splitting is done on real separators (/ \ , ;) ONLY — never on spaces, because
 * "0408 336 471" is one number written the normal way, and splitting it on
 * spaces produces three fragments too short to keep, silently losing the row.
 * A part that comes out implausibly long is then re-split on whitespace, which
 * catches two numbers written side by side with no punctuation between them.
 * Anything under 7 digits is dropped: a stray "111" would flag half the
 * customer base. */
const MIN_LEN = 7, MAX_LEN = 12;

function normNum(d){
  if (d.startsWith('61') && d.length > 9) d = d.slice(2);
  else if (d.startsWith('60') && d.length > 9) d = d.slice(2);
  return d.replace(/^0+/,'');
}

function extractNumbers(text){
  const out = [];
  const take = (d) => {
    const n = normNum(d);
    if (n.length >= MIN_LEN - 1 && n.length <= MAX_LEN && !out.includes(n)) out.push(n);
  };
  for (const part of String(text||'').split(/[/\\,;]+/)) {
    const d = part.replace(/\D/g,'');
    if (!d) continue;
    if (d.length <= MAX_LEN) { if (d.length >= MIN_LEN) take(d); continue; }
    // Too long to be one number — two written side by side, so split on spaces.
    for (const tok of part.split(/\s+/)) {
      const t = tok.replace(/\D/g,'');
      if (t.length >= MIN_LEN && t.length <= MAX_LEN) take(t);
    }
  }
  return out;
}

const rows = parseCSV(fs.readFileSync(SRC,'utf8')).filter(r=>r.length>1);

/* Two different exports feed this script and they name their columns
   differently: the database dump uses snake_case ("phone_number"), while the
   browser scraper copies the column headings off the page ("Phone No"). Strip
   case, spaces and underscores, then look the column up through a list of
   known spellings, so either file works without editing anything. */
const norm = h => h.replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[\s_]+/g,'');
const head = rows[0].map(norm);
const ALIASES = {
  name:           ['name'],
  phone_number:   ['phonenumber','phoneno','phone'],
  pay_id:         ['payid'],
  bsb:            ['bsb'],
  account_number: ['accountnumber','accountno'],
  reason:         ['reason'],
  added_by:       ['addedby'],
  added_by_user:  ['addedbyuser'],
  created_at:     ['createdat'],
};
const col = n => {
  for (const a of ALIASES[n]) { const i = head.indexOf(a); if (i !== -1) return i; }
  return -1;
};

// Without a name column every row gets skipped as nameless and the output is
// an empty file \u2014 a silent, very confusing failure. Stop and say so instead.
if (col('name') === -1) {
  console.error(`No "name" column found. Headings in this file: ${rows[0].join(' | ')}`);
  process.exit(1);
}

const data = rows.slice(1);

const OUT_COLS = ['country','name','phone','phone_digits','payid','bsb','account_no','reason','added_by_company','added_by_name','created_at'];
const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
const out = [OUT_COLS.join(',')];

let withNumbers = 0, multi = 0, skipped = 0;
for (const r of data) {
  const name = (r[col('name')]||'').trim();
  if (!name) { skipped++; continue; }               // name is NOT NULL in the table
  const phoneRaw = (r[col('phone_number')]||'').trim();
  const nums = extractNumbers(phoneRaw);
  if (nums.length) withNumbers++;
  if (nums.length > 1) multi++;
  /* Who reported it. The browser scrape carries a nested added_by_user object
     with the reporter's actual name ("ausstaff"), which is what staff want to
     see; the older database dump only had a numeric id, which reads sensibly
     as "user #7" and nothing better. Prefer the real name when it is there. */
  let addedBy = (r[col('added_by')]||'').trim();
  const userJson = col('added_by_user') === -1 ? '' : (r[col('added_by_user')]||'').trim();
  if (userJson) {
    try {
      const u = JSON.parse(userJson);
      if (u && (u.name || u.username)) addedBy = String(u.name || u.username).trim();
    } catch { /* malformed - fall back to the id below */ }
  }
  out.push([
    'Australia',
    name,
    phoneRaw,
    nums.join(' '),
    (r[col('pay_id')]||'').trim(),
    (r[col('bsb')]||'').trim(),
    (r[col('account_number')]||'').trim(),
    (r[col('reason')]||'').trim(),
    'blacklistaus (imported)',
    // The database dump gives a numeric user id, which only reads sensibly as
    // "user #7"; the scraped page gives the actual name, which stands alone.
    addedBy ? (/^\d+$/.test(addedBy) ? `user #${addedBy}` : addedBy) : '',
    (r[col('created_at')]||'').trim(),
  ].map(esc).join(','));
}

fs.writeFileSync(OUT, '\uFEFF' + out.join('\r\n'), 'utf8');
console.log(`rows in  : ${data.length}`);
console.log(`rows out : ${out.length-1}   (skipped ${skipped} with no name)`);
console.log(`with at least one usable number: ${withNumbers}`);
console.log(`rows listing more than one number: ${multi}`);
console.log(`written  : ${OUT}`);
