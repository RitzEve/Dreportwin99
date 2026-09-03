import { normalizeName, digitsOnly, normalizePhone, samePhone } from './phone.js';

/*
 * Member matching for the transaction form's SUGGESTION lists — name and phone.
 *
 * Why this exists: both fields used to filter with `stored.includes(typed)`,
 * which only fires when the stored value contains everything typed. That breaks
 * on real data in two different ways.
 *
 *   Names — staff paste them out of the casino backend and a character arrives
 *   fused to the first word, so a pasted "GMONIQUE FEDERICO WILLIS" matched
 *   NOTHING while "Monique Federico Willis" sat right there in the directory.
 *
 *   Phones — the same number gets written a dozen ways. "0412 345 678" stored
 *   against "0412345678" typed shared not one matching character run, because
 *   the spaces sit in the middle of the digits.
 *
 * Either way the member was invisible and the entry got filed under a fresh
 * record instead — which is how one person ends up with two.
 *
 * IMPORTANT — none of this is for the blacklist warning. `normalizeName` in
 * phone.js is deliberately strict because it decides whether to accuse a named
 * person of being blacklisted, where "close enough" would defame the wrong
 * customer. This file is the opposite trade-off on purpose: it only ranks rows
 * in a dropdown that a human then picks from, so a generous extra candidate
 * costs a glance. Keep the two apart.
 */

// ---------------------------------------------------------------- names ----

/** Name split into comparable words: "Federico-Willis." -> ["federico","willis"] */
export const nameTokens = v =>
  normalizeName(v).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/*
 * Two name-words agree if they're identical, or one contains the other and both
 * are at least 3 characters. That second case is what rescues a pasted
 * "gmonique" against the stored "monique"; the length floor stops 1-2 letter
 * fragments from agreeing with half the directory.
 */
export const tokensAgree = (a, b) =>
  a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)));

/*
 * tier 3 — the stored name contains what was typed (the original behaviour, so
 *          ordinary prefix typing is completely unchanged)
 * tier 2 — the typed text contains the whole stored name (pasted junk around it)
 * tier 1 — enough name-words agree, order-insensitive
 * tier 0 — no match
 *
 * `matched` counts agreeing words and breaks ties WITHIN a tier so the fuller
 * match wins: pasting "GMONIQUE FEDERICO WILLIS" ranks the three-word
 * "Monique Federico Willis" above a two-word "Federico Willis", since both sit
 * inside the pasted text and the tier alone can't separate them.
 */
export const matchMemberName = (typed, stored) => {
  const t = normalizeName(typed), s = normalizeName(stored);
  if (!t || !s) return { tier: 0, matched: 0 };
  const tt = nameTokens(typed), st = nameTokens(stored);
  const matched = st.filter(x => tt.some(y => tokensAgree(x, y))).length;
  if (s.includes(t)) return { tier: 3, matched };
  if (t.includes(s)) return { tier: 2, matched };
  // A single word never reaches the fuzzy tier. Typing one common first name
  // should not drag in everyone who shares it — those people are still found by
  // tier 3 the moment the typed fragment actually appears in their name.
  if (tt.length < 2 || st.length < 2) return { tier: 0, matched: 0 };
  const strong = matched >= 2
    && matched >= Math.ceil(st.length * 0.6)
    && matched >= Math.ceil(tt.length * 0.5);
  return strong ? { tier: 1, matched } : { tier: 0, matched: 0 };
};

// --------------------------------------------------------------- phones ----

/*
 * Phones compare on DIGITS, not on the string as typed — that is the whole fix.
 * Formatting is noise: spaces, brackets, dashes and the +61 / 04 prefixes all
 * describe the same subscriber, and phone.js already reduces them to a common
 * core (`normalizePhone` / `samePhone`, which was exported and until now unused).
 *
 * tier 3 — same subscriber, however either side is written: 0412 345 678 /
 *          0412345678 / +61 412 345 678 / 61412345678 all land here
 * tier 2 — the stored digits START with the digits typed (typing from the front,
 *          the ordinary case, and now immune to the stored spacing)
 * tier 1 — the typed digits appear somewhere inside the stored digits (a run
 *          from the middle of the number), 3-digit floor so a single keystroke
 *          doesn't return the whole directory
 * tier 0 — no match
 *
 * The last check before giving up repeats the OLD raw-substring test, purely so
 * this can only ever ADD matches. Anything staff could find yesterday still
 * comes up today.
 */
export const matchMemberPhone = (typed, stored) => {
  const q = digitsOnly(typed), s = digitsOnly(stored);
  if (q && s) {
    if (samePhone(typed, stored)) return { tier: 3, matched: 0 };
    if (s.startsWith(q)) return { tier: 2, matched: 0 };
    if (q.length >= 3 && s.includes(q)) return { tier: 1, matched: 0 };
  }
  const raw = String(stored || '').toLowerCase(), rq = String(typed || '').toLowerCase();
  if (rq && raw.includes(rq)) return { tier: 1, matched: 0 };
  return { tier: 0, matched: 0 };
};

// -------------------------------------------------------------- ranking ----

/*
 * Shared ranking for both fields: best tier first, then how full the match is,
 * then the order the members already sit in — so ordinary prefix typing still
 * produces the list staff are used to.
 *
 * The cap matters now that the matchers are generous: the old substring filters
 * kept lists naturally short, and an uncapped list on an 800-member directory
 * could run off-screen.
 */
const rankMembers = (typed, members, score, cap) =>
  members
    .map((m, i) => ({ m, i, ...score(typed, m) }))
    .filter(x => x.tier > 0)
    .sort((a, b) => b.tier - a.tier || b.matched - a.matched || a.i - b.i)
    .slice(0, cap);

export const suggestMembersByName = (typed, members, cap = 8) =>
  rankMembers(typed, members, (t, m) => matchMemberName(t, m.name), cap);

export const suggestMembersByPhone = (typed, members, cap = 8) =>
  rankMembers(typed, members, (t, m) => matchMemberPhone(t, m.phone), cap);
