/*
 * deltaSync — send only what changed (V2.9.3).
 *
 * Until V2.9.2 every save sent the screen's WHOLE company record to the server and got the
 * whole record back: 9 MB each way for the biggest company (24,652 entries). A save took 4 s,
 * overlapping saves queued and timed out, the app retried them, and between 17 and 27 Oct
 * 2026 the pile-up ran the database out of memory five times.
 *
 * Now the app remembers the server's copy of every row as it last saw it (the "baseline")
 * and a save sends only the rows that differ from it. The server (app_data_merge_delta,
 * migration-041) merges those rows by the same rules as before and returns them merged.
 *
 * The baseline also fixes how other screens' changes come in. The update check used to merge
 * the downloaded record with ALL of this screen's rows, its own copy winning, so a row this
 * screen had never touched could put back an old version of something another screen had
 * just edited — and the next full save sent that old version to everyone. Now a row this
 * screen hasn't changed simply takes the server's version; only rows changed here (and not
 * yet saved) are merged with this screen's copy winning, as before.
 */
import { mergeData, txKey, idKey } from './mergeData.js';

// Order-independent signature of a value. The server stores `data` as JSONB and returns
// keys in Postgres's own canonical order, which never matches the browser's JSON.stringify
// order, so comparing raw strings ALWAYS looked "changed" (that once made the save effect
// re-send the same data forever). Sorting keys first makes "did it change?" reliable.
export const sortedStringify = (v) => {
  if (Array.isArray(v)) return '[' + v.map(sortedStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + sortedStringify(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
};

// The four row collections and the key each one merges by — the same keys as the server.
export const COLLECTIONS = [
  ['transactions', txKey],
  ['banks', idKey],
  ['members', idKey],
  ['offDays', txKey],
];

// Rows are immutable in React state, so a row's signature is computed once and remembered.
const sigCache = new WeakMap();
export const rowSig = (row) => {
  if (!row || typeof row !== 'object') return sortedStringify(row);
  let s = sigCache.get(row);
  if (s === undefined) { s = sortedStringify(row); sigCache.set(row, s); }
  return s;
};

// A row with no key at all (none exist today) is identified by its content, like the
// server's md5 fallback: changing it makes a new row and the old one stays.
const rowKey = (keyFn, row) => keyFn(row) || ('~' + rowSig(row));

/** The server's copy, as signatures: { transactions: Map(key -> sig), …, nextId }. */
export function makeBaseline(data) {
  const base = { nextId: Number((data && data.nextId) || 0) };
  for (const [name, keyFn] of COLLECTIONS) {
    const m = new Map();
    for (const row of ((data && data[name]) || [])) {
      const k = rowKey(keyFn, row);
      if (!m.has(k)) m.set(k, rowSig(row)); // first copy wins, like dedupeByKey on load
    }
    base[name] = m;
  }
  return base;
}

/** Record rows the server has just confirmed (its merged versions). */
export function patchBaseline(base, rows, nextId) {
  for (const [name, keyFn] of COLLECTIONS) {
    for (const row of ((rows && rows[name]) || [])) base[name].set(rowKey(keyFn, row), rowSig(row));
  }
  if (nextId != null) base.nextId = Math.max(base.nextId || 0, Number(nextId) || 0);
}

/**
 * The rows that differ from the baseline (new or changed), plus nextId. Returns null when
 * there is nothing to send. Rows dropped from local state are not "changes": the server
 * never removes a row a save leaves out (deleting is a `deleted: true` flag), same as before.
 */
export function diffAgainst(base, data) {
  const delta = {};
  let count = 0;
  for (const [name, keyFn] of COLLECTIONS) {
    const changed = [];
    const known = base[name];
    for (const row of ((data && data[name]) || [])) {
      if (known.get(rowKey(keyFn, row)) !== rowSig(row)) changed.push(row);
    }
    if (changed.length) { delta[name] = changed; count += changed.length; }
  }
  const nextId = Number((data && data.nextId) || 0);
  if (!count && nextId <= (base.nextId || 0)) return null;
  delta.nextId = nextId;
  return delta;
}

/**
 * Merge a freshly downloaded server copy into this screen's data. A row this screen hasn't
 * changed since the baseline takes the server's version (so another screen's edit or delete
 * isn't undone); a row changed here, or one the server doesn't have yet, is merged with this
 * screen's copy winning, by the same rules as always (mergeData).
 */
export function threeWayMerge(remote, local, base) {
  remote = remote || {}; local = local || {};
  const mine = { nextId: local.nextId };
  for (const [name, keyFn] of COLLECTIONS) {
    const remoteKeys = new Set(((remote[name]) || []).map(r => rowKey(keyFn, r)));
    const known = base ? base[name] : null;
    mine[name] = ((local[name]) || []).filter(row => {
      const k = rowKey(keyFn, row);
      return !remoteKeys.has(k) || !known || known.get(k) !== rowSig(row);
    });
  }
  return mergeData(remote, mine);
}

/** key -> signature of the rows a save sends, per collection, for adoptRows below. */
export function sentSignatures(delta) {
  const out = {};
  for (const [name, keyFn] of COLLECTIONS) {
    const m = new Map();
    for (const row of ((delta && delta[name]) || [])) m.set(rowKey(keyFn, row), rowSig(row));
    out[name] = m;
  }
  return out;
}

/**
 * Put the server's merged versions of the rows we just saved into this screen's data.
 * A row is replaced only if it is still exactly what we sent (an edit made while the save
 * was on its way is kept, and goes out with the next save) and the server's version differs.
 * An unchanged collection keeps its identity, so React does nothing when the server agreed.
 */
export function adoptRows(list, rows, keyFn, sent) {
  if (!rows || !rows.length || !Array.isArray(list)) return list;
  const byKey = new Map(rows.map(r => [rowKey(keyFn, r), r]));
  let changed = false;
  const out = list.map(row => {
    const k = rowKey(keyFn, row);
    const srv = byKey.get(k);
    if (!srv) return row;
    const sig = rowSig(row);
    if (!sent || sent.get(k) !== sig || rowSig(srv) === sig) return row;
    changed = true;
    return srv;
  });
  return changed ? out : list;
}
