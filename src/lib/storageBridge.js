/*
 * storageBridge.js — provides `window.storage` for the FinTrack artifact,
 * backed by the Supabase `app_data` table (one JSON row per company).
 *
 * The artifact calls:
 *     await window.storage.get(key)      -> { value, updatedAt } | null   (full data blob;
 *                                           null ONLY for a company with no data yet —
 *                                           a failed download or lost session THROWS)
 *     await window.storage.getMeta(key)  -> { updatedAt } | null           (tiny — just the timestamp)
 *     await window.storage.set(key, value)  -> { value } | null            (merges + writes the whole record)
 *     await window.storage.setDelta(key, delta) -> { updatedAt, prevUpdatedAt, rows, … } | { missing } | null
 *                                           (merges + writes only the changed rows; V2.9.3)
 *     await window.storage.load(key)     -> { data, rev } | { missing } | null   (V2.9.4: every row +
 *                                           the number of the company's latest change; THROWS on failure)
 *     await window.storage.changes(key, sinceRev) -> { rev, nextId, rows } | { missing } | null
 *                                           (V2.9.4: only the rows changed after `sinceRev`)
 *     await window.storage.save(key, delta) -> { rev, prevRev, changed, rows, nextId } | { missing } | null
 *                                           (V2.9.4: writes only the changed rows)
 *     await window.storage.delete(key)
 * where key looks like `fintrack-<companyId>-v2`. We read/write that company's
 * row; Row-Level Security guarantees a user only ever touches their own company.
 *
 * EGRESS NOTE: the live app polls for other devices' changes. To avoid re-downloading
 * the whole company blob constantly, the poller uses getMeta() (a few bytes) and only
 * calls get() (the full blob) when updated_at actually changed. Since V2.9.4 it asks
 * changes() instead: an idle check is a few bytes and a busy one carries only the rows
 * other screens changed. `{ missing }` everywhere means the server doesn't have that
 * function (an older database, or the switch was undone): the app falls back to the
 * V2.9.3 calls above.
 */

import { supabase } from './supabaseClient.js';
import { mergeData } from './mergeData.js';

function companyIdFromKey(key) {
  const m = /^fintrack-(.+)-v2$/.exec(String(key));
  return m ? m[1] : null;
}

// The function isn't installed on this database (PostgREST's "not found" for an RPC).
const isMissing = (error) => error.code === 'PGRST202'
  || /Could not find the function|does not exist/i.test(error.message || '');

if (typeof window !== 'undefined') {
  window.storage = {
    async get(key) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      // Signed out underneath us (e.g. the same login signed out "everywhere" from
      // another PC): the database would answer with zero rows, which looks exactly
      // like a brand-new empty company. Say what actually happened instead.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You have been signed out. Please log in again.');
      const { data, error } = await supabase
        .from('app_data').select('data, updated_at').eq('company_id', companyId).maybeSingle();
      // A failed download must never look like an empty company. On 2026-09-21 staff on
      // a slow VPN saw "No active banks" while their data was still on its way, kept
      // refreshing, and thought it was gone. Throw, so the app can say so and retry;
      // null stays reserved for the one real case: a company with no row yet.
      if (error) throw new Error(error.message || 'Could not download your company data.');
      if (!data) return null;
      return { value: JSON.stringify(data.data ?? {}), updatedAt: data.updated_at || null };
    },

    // Cheap "has anything changed?" probe — returns only the row's updated_at, not the
    // (potentially large) data blob. Used by the poller so an idle app barely uses egress.
    async getMeta(key) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      const { data, error } = await supabase
        .from('app_data').select('updated_at').eq('company_id', companyId).maybeSingle();
      if (error || !data) return null;
      return { updatedAt: data.updated_at || null };
    },

    async set(key, value) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      let obj;
      try { obj = JSON.parse(value); } catch { obj = value; }

      // Preferred path (migration-008): the database merges our data into the company
      // row ATOMICALLY (it locks the row) and returns the merged result — no extra read.
      const { data, error } = await supabase
        .rpc('app_data_merge', { p_company_id: companyId, p_incoming: obj });
      if (!error) return { value: JSON.stringify(data ?? {}) };

      // Fallback ONLY when the merge function isn't installed yet. Read the remote blob,
      // merge here (so a concurrent edit isn't clobbered), then write the merged result.
      if (!isMissing(error)) return null; // real error (network/permission) — let the app retry; don't overwrite

      let remote = null;
      try {
        const { data: row } = await supabase
          .from('app_data').select('data').eq('company_id', companyId).maybeSingle();
        remote = row ? row.data : null;
      } catch { /* treat as no remote */ }
      const merged = remote ? mergeData(remote, obj) : obj;
      const { error: upErr } = await supabase
        .from('app_data')
        .upsert({ company_id: companyId, data: merged, updated_at: new Date().toISOString() });
      return upErr ? null : { value: JSON.stringify(merged) };
    },

    // Save only the rows that changed (V2.9.3, migration-041). `delta` is
    // { transactions?, banks?, members?, offDays?, nextId }. Returns the server's answer
    // { updatedAt, prevUpdatedAt, changed, rows, nextId } — the merged versions of just
    // those rows, never the whole record — or { missing: true } when the function isn't
    // installed (the app then falls back to set()), or null on any other failure.
    async setDelta(key, delta) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      const { data, error } = await supabase
        .rpc('app_data_merge_delta', { p_company_id: companyId, p_delta: delta });
      if (!error) return data || null;
      return isMissing(error) ? { missing: true } : null;
    },

    // Every row of the company (migration-042/043), already parsed, plus `rev`: the number
    // of its latest change, which the update check then asks "what changed after?". A
    // company with nothing saved yet comes back empty with rev 0. Like get(), a failure
    // THROWS — it must never look like an empty company.
    async load(key) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You have been signed out. Please log in again.');
      const { data, error } = await supabase.rpc('company_load', { p_company: companyId });
      if (error) {
        if (isMissing(error)) return { missing: true };
        throw new Error(error.message || 'Could not download your company data.');
      }
      const { rev, ...rows } = data || {};
      return { data: rows, rev: Number(rev) || 0 };
    },

    // Only the rows changed after change number `sinceRev`: { rev, nextId, rows: { transactions?, … } }.
    // Nothing changed -> rows is {} (a few bytes). null on any failure (the next check retries).
    async changes(key, sinceRev) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      const { data, error } = await supabase
        .rpc('company_changes', { p_company: companyId, p_since: sinceRev });
      if (!error) return data || null;
      return isMissing(error) ? { missing: true } : null;
    },

    // Save only the rows that changed, straight into the company's rows. The answer has the
    // merged versions of just those rows and the change numbers before/after this save.
    async save(key, delta) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      const { data, error } = await supabase
        .rpc('company_save', { p_company: companyId, p_delta: delta });
      if (!error) return data || null;
      return isMissing(error) ? { missing: true } : null;
    },

    async delete() {
      // legacy key cleanup is a no-op now (data is per-company in the DB)
      return true;
    },
  };
}
