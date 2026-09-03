import { normalizeName } from './phone.js';

/*
 * Member-name matching for the transaction form's SUGGESTION list only.
 *
 * Why this exists: the field used to filter with `stored.includes(typed)`, which
 * only ever fires when the stored name contains everything typed. Staff paste
 * names out of the casino backend and they arrive with a character fused to the
 * first word, so a pasted "GMONIQUE FEDERICO WILLIS" matched NOTHING while
 * "Monique Federico Willis" sat right there in the directory. One stray letter
 * hid the member completely, and the entry got filed under a new name instead.
 *
 * Matching in both directions, then word-by-word, survives that — along with the
 * other ways a pasted name drifts: a dropped middle name, first and last
 * swapped, a hyphen, a doubled space, trailing punctuation.
 *
 * IMPORTANT — this is NOT for the blacklist warning. `normalizeName` in phone.js
 * is deliberately strict because it decides whether to accuse a named person of
 * being blacklisted, where "close enough" would defame the wrong customer. This
 * file is the opposite trade-off on purpose: it only ranks names in a dropdown
 * that a human then picks from, so a generous extra candidate costs a glance.
 * Keep the two apart.
 */

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

/*
 * Ranked suggestions for `typed`, best first, capped. The cap matters now that
 * the matcher is generous: the old substring filter kept lists naturally short,
 * and an uncapped fuzzy list on an 800-member directory could run off-screen.
 *
 * Ties fall back to the order members already sit in, so ordinary prefix typing
 * still produces the list staff are used to.
 */
export const suggestMembersByName = (typed, members, cap = 8) =>
  members
    .map((m, i) => ({ m, i, ...matchMemberName(typed, m.name) }))
    .filter(x => x.tier > 0)
    .sort((a, b) => b.tier - a.tier || b.matched - a.matched || a.i - b.i)
    .slice(0, cap);
