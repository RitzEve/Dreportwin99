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
      if (!companyId) return false;
      let obj;
      try { obj = JSON.parse(value); } catch { obj = value; }
      const { error } = await supabase
        .from('app_data')
        .upsert({ company_id: companyId, data: obj, updated_at: new Date().toISOString() });
      return !error;
    },
    async delete() {
      // legacy key cleanup is a no-op now (data is per-company in the DB)
      return true;
    },
  };
}
