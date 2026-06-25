/*
 * storageBridge.js — provides `window.storage` for the FinTrack artifact,
 * backed by the Supabase `app_data` table (one JSON row per company).
 *
 * The artifact calls:
 *     await window.storage.get(key)      -> { value, updatedAt } | null   (full data blob)
 *     await window.storage.getMeta(key)  -> { updatedAt } | null           (tiny — just the timestamp)
 *     await window.storage.set(key, value)  -> { value } | null            (merges + writes)
 *     await window.storage.delete(key)
 * where key looks like `fintrack-<companyId>-v2`. We read/write that company's
 * row; Row-Level Security guarantees a user only ever touches their own company.
 *
 * EGRESS NOTE: the live app polls for other devices' changes. To avoid re-downloading
 * the whole company blob constantly, the poller uses getMeta() (a few bytes) and only
 * calls get() (the full blob) when updated_at actually changed.
 */

import { supabase } from './supabaseClient.js';
import { mergeData } from './mergeData.js';

function companyIdFromKey(key) {
  const m = /^fintrack-(.+)-v2$/.exec(String(key));
  return m ? m[1] : null;
}

if (typeof window !== 'undefined') {
  window.storage = {
    async get(key) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      const { data, error } = await supabase
        .from('app_data').select('data, updated_at').eq('company_id', companyId).maybeSingle();
      if (error || !data) return null;
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
      const missing = error.code === 'PGRST202'
        || /Could not find the function|does not exist/i.test(error.message || '');
      if (!missing) return null; // real error (network/permission) — let the app retry; don't overwrite

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

    async delete() {
      // legacy key cleanup is a no-op now (data is per-company in the DB)
      return true;
    },
  };
}
