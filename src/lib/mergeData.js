/*
 * mergeData — union two saved FinTrack data blobs so concurrent edits from different
 * devices/operators don't clobber each other. The DB keeps ONE row per company, so a
 * naive overwrite loses whatever the other device added in between.
 *
 * Transactions are matched by their unique `uid` (older rows fall back to `#id`); an
 * entry deleted on EITHER side stays deleted. Members union by id (newer lastActivity
 * wins); banks union by id (local wins); nextId takes the higher of the two.
 *
 * Shared by src/app/FinTrack.jsx (the live merge-on-poll) and src/lib/storageBridge.js
 * (the fallback merge when the atomic server-side RPC isn't installed).
 */
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
    memMap.set(m.id, !prev ? m : ((m.lastActivity || '') >= (prev.lastActivity || '') ? { ...prev, ...m } : { ...m, ...prev }));
  }
  const members = [...memMap.values()];
  const bankMap = new Map();
  for (const b of (remote.banks || [])) bankMap.set(b.id, b);
  for (const b of (local.banks || [])) bankMap.set(b.id, b);   // local bank edits/toggles win
  const banks = [...bankMap.values()];
  const nextId = Math.max(local.nextId || 0, remote.nextId || 0);
  return { transactions, banks, members, nextId };
}
