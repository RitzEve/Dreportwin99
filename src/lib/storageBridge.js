/*
 * storageBridge.js — provides `window.storage` for the FinTrack artifact.
 * ----------------------------------------------------------------------
 * The artifact calls an async key/value API:
 *     await window.storage.get(key)   -> { value } | null
 *     await window.storage.set(key, value)
 *     await window.storage.delete(key)
 *
 * In the original artifact environment this was a hosted store. Here we back it
 * with localStorage. Because the artifact keys every record by company
 * (`fintrack-<companyId>-v2`), each company's books stay isolated automatically.
 *
 * To move to a real backend later, reimplement these three methods to call your
 * API — nothing in the artifact changes.
 */

const PREFIX = 'ft_store::';

/** Remove every app-data key a company wrote (used when a company is deleted). */
export function removeCompanyAppData(companyId) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(`${PREFIX}fintrack-${companyId}`)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? null : { value: v };
    },
    async set(key, value) {
      localStorage.setItem(PREFIX + key, value);
      return true;
    },
    async delete(key) {
      localStorage.removeItem(PREFIX + key);
      return true;
    },
  };
}
