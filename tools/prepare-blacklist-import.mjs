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
const head = rows[0].map(h=>h.replace(/^\uFEFF/,'').trim());
const col  = n => head.indexOf(n);
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
  const addedBy = (r[col('added_by')]||'').trim();
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
    addedBy ? `user #${addedBy}` : '',
    (r[col('created_at')]||'').trim(),
  ].map(esc).join(','));
}

fs.writeFileSync(OUT, '\uFEFF' + out.join('\r\n'), 'utf8');
console.log(`rows in  : ${data.length}`);
console.log(`rows out : ${out.length-1}   (skipped ${skipped} with no name)`);
console.log(`with at least one usable number: ${withNumbers}`);
console.log(`rows listing more than one number: ${multi}`);
console.log(`written  : ${OUT}`);
