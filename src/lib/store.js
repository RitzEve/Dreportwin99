/*
 * store.js — low-level data layer (companies + user accounts)
 * -----------------------------------------------------------
 * Everything is kept in ONE localStorage record so the whole thing can later be
 * replaced by a real backend (Supabase / Firebase / your own API) by
 * reimplementing only this file — the screens never touch localStorage directly.
 *
 * Shape:
 *   {
 *     companies: { [companyId]: { id, name, slug, createdAt } },
 *     users:     { [userId]:    { id, companyId, name, email, operatorId,
 *                                 role: 'master'|'staff', active,
 *                                 salt, hash, createdAt, createdBy } }
 *   }
 *
 * Tenant isolation rule: every users query is scoped by companyId. Nothing in
 * the app reads users across companies.
 *
 * NOTE: the FinTrack app's own data (banks / members / transactions) is NOT
 * stored here — the artifact persists that itself through `window.storage`,
 * keyed by `fintrack-<companyId>-v2`, which keeps each company's books isolated.
 */

const DB_KEY = 'mcp_db_v2';

function blank() {
  return { companies: {}, users: {} };
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return blank();
    return Object.assign(blank(), JSON.parse(raw));
  } catch (err) {
    console.error('store.load failed, starting empty:', err);
    return blank();
  }
}

function save(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---- Companies -------------------------------------------------------------

export function listCompanies() {
  return Object.values(load().companies).sort((a, b) => a.name.localeCompare(b.name));
}

export function getCompany(companyId) {
  return load().companies[companyId] || null;
}

export function createCompany(name) {
  const db = load();
  const id = genId('co');
  db.companies[id] = { id, name: name.trim(), slug: slugify(name), createdAt: new Date().toISOString() };
  save(db);
  return db.companies[id];
}

/** Removes a company and every account belonging to it (does not touch app data). */
export function deleteCompanyCascade(companyId) {
  const db = load();
  delete db.companies[companyId];
  for (const id of Object.keys(db.users)) {
    if (db.users[id].companyId === companyId) delete db.users[id];
  }
  save(db);
}

// ---- Users (always tenant-scoped) -----------------------------------------

export function listUsers(companyId) {
  return Object.values(load().users)
    .filter((u) => u.companyId === companyId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getUser(userId) {
  return load().users[userId] || null;
}

export function findUserByEmail(companyId, email) {
  const target = String(email).toLowerCase().trim();
  return (
    Object.values(load().users).find(
      (u) => u.companyId === companyId && u.email.toLowerCase() === target
    ) || null
  );
}

/** Login is now by email alone (no company picker), so emails are GLOBALLY unique. */
export function findUserByEmailGlobal(email) {
  const target = String(email).toLowerCase().trim();
  return Object.values(load().users).find((u) => u.email.toLowerCase() === target) || null;
}

export function listAllUsers() {
  return Object.values(load().users);
}

export function insertUser(user) {
  const db = load();
  const id = genId('usr');
  db.users[id] = Object.assign({ id }, user);
  save(db);
  return db.users[id];
}

export function updateUser(userId, patch) {
  const db = load();
  if (!db.users[userId]) return null;
  db.users[userId] = Object.assign({}, db.users[userId], patch);
  save(db);
  return db.users[userId];
}

export function deleteUser(userId) {
  const db = load();
  delete db.users[userId];
  save(db);
}

/** Next operator id for a company, e.g. OP-001, OP-002 … (max existing + 1). */
export function nextOperatorId(companyId) {
  const nums = listUsers(companyId)
    .map((u) => parseInt(String(u.operatorId || '').replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `OP-${String(next).padStart(3, '0')}`;
}

export function isEmpty() {
  return Object.keys(load().companies).length === 0;
}

export function resetAll() {
  localStorage.removeItem(DB_KEY);
}
