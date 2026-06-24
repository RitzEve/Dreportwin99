/*
 * storageBridge.js — provides `window.storage` for the FinTrack artifact,
 * backed by the Supabase `app_data` table (one JSON row per company).
 *
 * The artifact calls:
 *     await window.storage.get(key)   -> { value } | null
 *     await window.storage.set(key, value)   (value is a JSON string)
 *     await window.storage.delete(key)
 * where key looks like `fintrack-<companyId>-v2`. We read/write that company's
 * row; Row-Level Security guarantees a user only ever touches their own company.
 */

import { supabase } from './supabaseClient.js';

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
        .from('app_data').select('data').eq('company_id', companyId).maybeSingle();
      if (error || !data) return null;
      return { value: JSON.stringify(data.data ?? {}) };
    },
    async set(key, value) {
      const companyId = companyIdFromKey(key);
      if (!companyId) return null;
      let obj;
      try { obj = JSON.parse(value); } catch { obj = value; }
      // Preferred path (migration-008): the database merges our data into the company
      // row ATOMICALLY (it locks the row), so two devices saving at the same instant
      // can never clobber each other. It returns the merged result so we can sync.
      const { data, error } = await supabase
        .rpc('app_data_merge', { p_company_id: companyId, p_incoming: obj });
      if (!error) return { value: JSON.stringify(data ?? {}) };
      // Fallback ONLY when the merge function isn't installed yet — plain whole-row
      // upsert (same as the client-side-merge behaviour shipped in v1.6.17).
      const missing = error.code === 'PGRST202'
        || /Could not find the function|does not exist/i.test(error.message || '');
      if (!missing) return null; // real error (network/permission) — let the app retry; don't overwrite
      const { error: upErr } = await supabase
        .from('app_data')
        .upsert({ company_id: companyId, data: obj, updated_at: new Date().toISOString() });
      return upErr ? null : { value };
    },
    async delete() {
      // legacy key cleanup is a no-op now (data is per-company in the DB)
      return true;
    },
  };
}
