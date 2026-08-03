/*
 * Phone helpers shared by the Blacklist Member list and the transaction-entry
 * warning that checks against it.
 *
 * The whole point is that the SAME person's number gets typed a dozen ways —
 * 0412 345 678, +61 412 345 678, 61412345678, (04) 1234 5678 — and a blacklist
 * that only matches an exact string is worth nothing. Everything here reduces a
 * number to a comparable core.
 */

/** Strip everything that isn't a digit. "+61 412-345 678" -> "61412345678". */
export const digitsOnly = (v) => String(v || '').replace(/\D/g, '');

/*
 * Country of a number, from its dialling prefix. Used to file imported/added
 * entries into the right country pool.
 *   04…            -> Australia (national mobile format)
 *   61… / +61…     -> Australia (international)
 *   60… / +60…     -> Malaysia
 * Anything unrecognised returns '' so the caller can fall back to the adding
 * company's own country rather than guessing wrong.
 */
export function countryFromPhone(value) {
  const d = digitsOnly(value);
  if (!d) return '';
  if (d.startsWith('61')) return 'Australia';
  if (d.startsWith('60')) return 'Malaysia';
  if (d.startsWith('0')) return 'Australia';   // 04xx… local form
  return '';
}

/*
 * Reduce a number to the part that actually identifies the subscriber, so the
 * same person matches however it was typed. Drops the country code and any
 * trunk "0", e.g. all of 0412345678 / 61412345678 / +61 412 345 678 collapse
 * to "412345678".
 *
 * Returns '' for anything too short to be a real number, which callers treat as
 * "don't match on this" — otherwise a stray "04" in a notes field would flag
 * half the customer base.
 */
export function normalizePhone(value) {
  let d = digitsOnly(value);
  if (!d) return '';
  if (d.startsWith('61') && d.length > 9) d = d.slice(2);        // +61…
  else if (d.startsWith('60') && d.length > 9) d = d.slice(2);   // +60…
  if (d.startsWith('0')) d = d.replace(/^0+/, '');               // trunk zero
  return d.length >= 7 ? d : '';
}

/** True when two numbers belong to the same subscriber, however they're typed. */
export const samePhone = (a, b) => {
  const x = normalizePhone(a);
  return !!x && x === normalizePhone(b);
};

/*
 * Every plausible number in a free-text field, normalised. One blacklist entry
 * often names the same person's two or three numbers ("61485761560 /
 * 61468472988"), and the entry has to match on any of them.
 *
 * Splits on real separators (/ \ , ;) and NEVER on spaces — "0408 336 471" is
 * one number written the ordinary way, and splitting it on spaces yields three
 * fragments too short to keep, silently losing the entry. A part that comes out
 * implausibly long is re-split on whitespace, which catches two numbers written
 * side by side with no punctuation between them.
 *
 * Kept in step with tools/prepare-blacklist-import.mjs, which applies the same
 * rules to the imported list — the two must agree or imported entries won't
 * match the same way app-added ones do.
 */
export function extractNumbers(text) {
  const out = [];
  const take = (d) => {
    const n = normalizePhone(d);
    if (n && n.length <= 12 && !out.includes(n)) out.push(n);
  };
  for (const part of String(text || '').split(/[/\\,;]+/)) {
    const d = digitsOnly(part);
    if (!d) continue;
    if (d.length <= 12) { take(d); continue; }
    for (const tok of part.split(/\s+/)) {
      const t = digitsOnly(tok);
      if (t.length >= 7 && t.length <= 12) take(t);
    }
  }
  return out;
}

/*
 * Names are matched case- and spacing-insensitively. Deliberately NOT fuzzy:
 * this drives a warning about a named person, and "close enough" matching would
 * accuse the wrong customer.
 */
export const normalizeName = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
