/*
 * mergeData — union two saved FinTrack data blobs so concurrent edits from different
 * devices/operators don't clobber each other. The DB keeps ONE row per company, so a
 * naive overwrite loses whatever the other device added in between.
 *
 * Transactions are matched by their unique `uid` (older rows fall back to `#id`); an
 * entry deleted on EITHER side stays deleted. Members union by id (the newer edit —
 * `updatedAt` — wins the details, else newer lastActivity; lastActivity itself is the
 * later of the two; delete-wins like transactions — see the members block below); banks union by
 * id (newer `updatedAt` wins, so an active/inactive toggle or edit on one device reaches
 * the others); off-days union by uid (delete-wins) like transactions; nextId takes the
 * higher of the two.
 *
 * Shared by src/app/FinTrack.jsx (the live merge-on-poll) and src/lib/storageBridge.js
 * (the fallback merge when the atomic server-side RPC isn't installed).
 */
// Stable per-row keys, matching the server merge (see migration-012).
export const txKey = (t) => (t && t.uid ? t.uid : (t && t.id != null ? `#${t.id}` : ''));
export const idKey = (r) => (r && r.id != null && r.id !== '' ? String(r.id) : '');

/*
 * dedupeByKey — keep the FIRST occurrence of each key, preserving order. Rows whose
 * key is falsy (no stable identity) are all kept. Defense-in-depth against the
 * duplicate-key blow-up that migration-012 fixes server-side: the client normalises
 * a loaded blob so it can never hold — or send back — duplicate-keyed rows.
 */
export function dedupeByKey(arr, keyFn) {
  if (!Array.isArray(arr)) return arr;
  const seen = new Set();
  const out = [];
  for (const row of arr) {
    const k = keyFn(row);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(row);
  }
  return out;
}

// A member's edit time. Only a plain whole number counts — the same test the server
// merge applies — so both sides always agree on which edit is newer.
const editStamp = (r) => { const n = Number(r && r.updatedAt); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

export function mergeData(remote, local) {
  remote = remote || {}; local = local || {};
  const keyOf = t => (t && t.uid ? t.uid : `#${t && t.id}`);
  const txMap = new Map();
  for (const t of (remote.transactions || [])) txMap.set(keyOf(t), t);
  for (const t of (local.transactions || [])) {
    const k = keyOf(t), prev = txMap.get(k);
    txMap.set(k, prev ? { ...prev, ...t, deleted: !!(prev.deleted || t.deleted) } : t);
  }
  const transactions = [...txMap.values()];
  const memMap = new Map();
  for (const m of (remote.members || [])) memMap.set(m.id, m);
  for (const m of (local.members || [])) {
    const prev = memMap.get(m.id);
    if (!prev) { memMap.set(m.id, m); continue; }
    // An edit on the Members page stamps `updatedAt` (like banks), and the newer edit
    // wins the member's details. lastActivity can't decide that: an edit doesn't move
    // it, so a tab still holding the old name kept its copy, and its next deposit
    // (which bumps lastActivity) wrote the old name back over the edit for everyone.
    // Never-edited members carry no updatedAt and keep the old lastActivity rule.
    const byEdit = editStamp(m) - editStamp(prev);
    const localWins = byEdit !== 0 ? byEdit > 0 : (m.lastActivity || '') >= (prev.lastActivity || '');
    const win = localWins ? { ...prev, ...m } : { ...m, ...prev };
    // Whichever copy wins the details, the member's latest activity is the later date.
    const lastActivity = (m.lastActivity || '') > (prev.lastActivity || '') ? m.lastActivity : prev.lastActivity;
    if (lastActivity) win.lastActivity = lastActivity;
    // A member removed on EITHER side stays removed — delete-wins, same rule as
    // transactions/offDays. Editing a member's ID rewrites its key, so the edit
    // tombstones the OLD id; without this the union here would resurrect that row
    // and the member would show up twice (once per id).
    memMap.set(m.id, { ...win, deleted: !!(prev.deleted || m.deleted) });
  }
  const members = [...memMap.values()];
  const bankMap = new Map();
  for (const b of (remote.banks || [])) bankMap.set(b.id, b);
  for (const b of (local.banks || [])) {
    const prev = bankMap.get(b.id);
    // newer updatedAt wins, taken WHOLE — not field-merged — so a stale `deleted`/`active` flag
    // from the losing side can't leak onto the winner. Legacy banks have no updatedAt (-> 0), so
    // local keeps winning as before until a bank is first touched.
    bankMap.set(b.id, !prev ? b : ((b.updatedAt || 0) >= (prev.updatedAt || 0) ? b : prev));
  }
  const banks = [...bankMap.values()];
  // offDays: union by uid (older rows fall back to '#'||id); incoming fields win; deleted on
  // either side stays deleted (mirrors transactions). Kept even when the server omits offDays
  // (e.g. before migration-009 is applied), so the local copy is never silently dropped.
  const odMap = new Map();
  for (const o of (remote.offDays || [])) odMap.set(keyOf(o), o);
  for (const o of (local.offDays || [])) {
    const k = keyOf(o), prev = odMap.get(k);
    odMap.set(k, prev ? { ...prev, ...o, deleted: !!(prev.deleted || o.deleted) } : o);
  }
  const offDays = [...odMap.values()];
  const nextId = Math.max(local.nextId || 0, remote.nextId || 0);
  return { transactions, banks, members, offDays, nextId };
}
