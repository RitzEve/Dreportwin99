/*
 * auth.js — accounts, roles, sessions
 * -----------------------------------
 * Role hierarchy:
 *   provider — that's the distributor (you). Not part of any company.
 *              Creates companies + their master account; resets master passwords.
 *   master   — top of a company. Creates/manages manager + staff accounts.
 *   manager  — creates/manages staff accounts only. Also uses the app.
 *   staff    — uses the app only. No console.
 *
 * Login is by EMAIL + PASSWORD (no company picker), so emails are globally unique.
 *
 * SECURITY NOTE (read before going live):
 *   FRONTEND PROTOTYPE. Passwords are hashed with a fast non-crypto hash in
 *   localStorage. Fine for a one-machine demo, NOT secure and NOT multi-device.
 *   A real product must verify passwords on a SERVER (bcrypt/argon2) against a
 *   shared database. Keep all auth behind this module so the swap touches one file.
 */

import {
  createCompany,
  deleteCompanyCascade,
  listCompanies,
  getCompany,
  listUsers,
  listAllUsers,
  getUser,
  findUserByEmailGlobal,
  insertUser,
  updateUser,
  deleteUser,
  nextOperatorId,
  isEmpty,
} from './store.js';
import { removeCompanyAppData } from './storageBridge.js';

const SESSION_KEY = 'mcp_session_v1';

export const ROLES = { PROVIDER: 'provider', MASTER: 'master', MANAGER: 'manager', STAFF: 'staff' };

// Re-export so screens import everything company/account-related from here.
export { listCompanies } from './store.js';

// ---- password hashing (prototype only — see note above) -------------------

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function makeSalt() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function hashPw(password, salt) {
  return cyrb53(`${salt}|${password}`, 0x9e3779b9);
}

// ---- validation helpers ----------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email) {
  return EMAIL_RE.test(String(email).trim());
}

export function validatePassword(pw) {
  return typeof pw === 'string' && pw.length >= 6;
}

// ---- session ---------------------------------------------------------------

function setSession(userId) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId }));
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Returns the logged-in context, or null.
 *   provider -> { user, company: null }
 *   others   -> { user, company }
 */
export function getActiveContext() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { userId } = JSON.parse(raw);
    const user = getUser(userId);
    if (!user || !user.active) return null;
    if (user.role === ROLES.PROVIDER) return { user, company: null };
    const company = getCompany(user.companyId);
    if (!company) return null;
    return { company, user };
  } catch {
    return null;
  }
}

export function isProvider() {
  const ctx = getActiveContext();
  return !!ctx && ctx.user.role === ROLES.PROVIDER;
}

/** Master + manager get the console (team management). */
export function canAccessConsole(role) {
  return role === ROLES.MASTER || role === ROLES.MANAGER;
}

/** Which roles a given actor may create within their company. */
export function creatableRoles(actorRole) {
  if (actorRole === ROLES.MASTER) return [ROLES.MANAGER, ROLES.STAFF];
  if (actorRole === ROLES.MANAGER) return [ROLES.STAFF];
  return [];
}

/** Can `actor` manage (edit/disable/reset/delete) `target`? */
export function canActOn(actor, target) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false; // never act on yourself here
  if (actor.companyId !== target.companyId) return false;
  if (actor.role === ROLES.MASTER) return target.role === ROLES.MANAGER || target.role === ROLES.STAFF;
  if (actor.role === ROLES.MANAGER) return target.role === ROLES.STAFF;
  return false;
}

// ---- login -----------------------------------------------------------------

export function login({ email, password }) {
  if (!validateEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  const user = findUserByEmailGlobal(email);
  if (!user) return { ok: false, error: 'No account with that email.' };
  if (!user.active) return { ok: false, error: 'This account is disabled. Contact your administrator.' };
  if (user.hash !== hashPw(password, user.salt)) return { ok: false, error: 'Incorrect password.' };
  setSession(user.id);
  return { ok: true, user };
}

// ---- provider: companies + master accounts --------------------------------

/** Creates a company and its first master account. Does NOT change the session. */
export function provisionCompany({ companyName, masterName, masterEmail, password }) {
  if (!companyName || !companyName.trim()) return { ok: false, error: 'Enter a company name.' };
  if (!masterName || !masterName.trim()) return { ok: false, error: "Enter the master's name." };
  if (!validateEmail(masterEmail)) return { ok: false, error: 'Enter a valid master email.' };
  if (!validatePassword(password)) return { ok: false, error: 'Password must be at least 6 characters.' };
  if (findUserByEmailGlobal(masterEmail)) return { ok: false, error: 'That email is already in use.' };

  const company = createCompany(companyName);
  const salt = makeSalt();
  const ctx = getActiveContext();
  const user = insertUser({
    companyId: company.id,
    name: masterName.trim(),
    email: masterEmail.trim(),
    operatorId: nextOperatorId(company.id),
    role: ROLES.MASTER,
    active: true,
    salt,
    hash: hashPw(password, salt),
    createdAt: new Date().toISOString(),
    createdBy: ctx ? ctx.user.email : 'seed',
  });
  return { ok: true, company, user };
}

/** Companies, each with its master account(s) and headcount — for the provider page. */
export function listCompaniesWithMasters() {
  return listCompanies().map((c) => {
    const team = listUsers(c.id);
    return {
      ...c,
      masters: team.filter((u) => u.role === ROLES.MASTER),
      managerCount: team.filter((u) => u.role === ROLES.MANAGER).length,
      staffCount: team.filter((u) => u.role === ROLES.STAFF).length,
    };
  });
}

/** Provider resets a master's password (only allowed on master accounts). */
export function providerResetPassword(userId, newPassword) {
  if (!isProvider()) return { ok: false, error: 'Not authorised.' };
  const user = getUser(userId);
  if (!user || user.role !== ROLES.MASTER) return { ok: false, error: 'Master account not found.' };
  if (!validatePassword(newPassword)) return { ok: false, error: 'Password must be at least 6 characters.' };
  const salt = makeSalt();
  updateUser(userId, { salt, hash: hashPw(newPassword, salt) });
  return { ok: true };
}

/**
 * Provider deletes a company — and ALL its accounts and app data. Irreversible.
 * Requires the provider to re-enter their own password as the final confirmation.
 */
export function deleteCompany(companyId, password) {
  const ctx = getActiveContext();
  if (!ctx || ctx.user.role !== ROLES.PROVIDER) return { ok: false, error: 'Not authorised.' };
  if (ctx.user.hash !== hashPw(password, ctx.user.salt)) return { ok: false, error: 'Password is incorrect.' };
  const company = getCompany(companyId);
  if (!company) return { ok: false, error: 'Company not found.' };
  deleteCompanyCascade(companyId);
  try { removeCompanyAppData(companyId); } catch { /* app data may not exist */ }
  return { ok: true };
}

/** Provider can also add an extra master to a company. */
export function providerAddMaster({ companyId, name, email, password }) {
  if (!isProvider()) return { ok: false, error: 'Not authorised.' };
  if (!getCompany(companyId)) return { ok: false, error: 'Company not found.' };
  if (!name || !name.trim()) return { ok: false, error: 'Enter a name.' };
  if (!validateEmail(email)) return { ok: false, error: 'Enter a valid email.' };
  if (!validatePassword(password)) return { ok: false, error: 'Password must be at least 6 characters.' };
  if (findUserByEmailGlobal(email)) return { ok: false, error: 'That email is already in use.' };
  const salt = makeSalt();
  const user = insertUser({
    companyId,
    name: name.trim(),
    email: email.trim(),
    operatorId: nextOperatorId(companyId),
    role: ROLES.MASTER,
    active: true,
    salt,
    hash: hashPw(password, salt),
    createdAt: new Date().toISOString(),
    createdBy: 'provider',
  });
  return { ok: true, user };
}

// ---- company team management (master / manager) ---------------------------

export function listTeam(companyId) {
  return listUsers(companyId);
}

function activeMasterCount(companyId) {
  return listUsers(companyId).filter((u) => u.role === ROLES.MASTER && u.active).length;
}

/** Master/manager creates an account. Role must be one the actor may create. */
export function createAccount({ name, email, password, role }) {
  const ctx = getActiveContext();
  if (!ctx || !canAccessConsole(ctx.user.role)) return { ok: false, error: 'Not authorised.' };
  if (!creatableRoles(ctx.user.role).includes(role)) {
    return { ok: false, error: `You can't create a ${role} account.` };
  }
  if (!name || !name.trim()) return { ok: false, error: 'Enter a name.' };
  if (!validateEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!validatePassword(password)) return { ok: false, error: 'Password must be at least 6 characters.' };
  if (findUserByEmailGlobal(email)) return { ok: false, error: 'That email is already in use.' };

  const companyId = ctx.user.companyId;
  const salt = makeSalt();
  const user = insertUser({
    companyId,
    name: name.trim(),
    email: email.trim(),
    operatorId: nextOperatorId(companyId),
    role,
    active: true,
    salt,
    hash: hashPw(password, salt),
    createdAt: new Date().toISOString(),
    createdBy: ctx.user.operatorId,
  });
  return { ok: true, user };
}

/** Master only: switch a manager/staff account between manager and staff. */
export function changeRole(userId, role) {
  const ctx = getActiveContext();
  const target = getUser(userId);
  if (!ctx || ctx.user.role !== ROLES.MASTER || !canActOn(ctx.user, target)) {
    return { ok: false, error: 'Not authorised.' };
  }
  if (role !== ROLES.MANAGER && role !== ROLES.STAFF) return { ok: false, error: 'Invalid role.' };
  updateUser(userId, { role });
  return { ok: true };
}

export function setActive(userId, active) {
  const ctx = getActiveContext();
  const target = getUser(userId);
  if (!ctx || !canActOn(ctx.user, target)) return { ok: false, error: 'Not authorised.' };
  updateUser(userId, { active });
  return { ok: true };
}

export function removeAccount(userId) {
  const ctx = getActiveContext();
  const target = getUser(userId);
  if (!ctx || !canActOn(ctx.user, target)) return { ok: false, error: 'Not authorised.' };
  deleteUser(userId);
  return { ok: true };
}

/** Master/manager resets a managed account's password. */
export function adminResetPassword(userId, newPassword) {
  const ctx = getActiveContext();
  const target = getUser(userId);
  if (!ctx || !canActOn(ctx.user, target)) return { ok: false, error: 'Not authorised.' };
  if (!validatePassword(newPassword)) return { ok: false, error: 'Password must be at least 6 characters.' };
  const salt = makeSalt();
  updateUser(userId, { salt, hash: hashPw(newPassword, salt) });
  return { ok: true };
}

/** Anyone changes their own password (must supply the current one). */
export function changeOwnPassword(userId, currentPassword, newPassword) {
  const user = getUser(userId);
  if (!user) return { ok: false, error: 'Account not found.' };
  if (user.hash !== hashPw(currentPassword, user.salt)) return { ok: false, error: 'Current password is incorrect.' };
  if (!validatePassword(newPassword)) return { ok: false, error: 'New password must be at least 6 characters.' };
  const salt = makeSalt();
  updateUser(userId, { salt, hash: hashPw(newPassword, salt) });
  return { ok: true };
}

// ---- first-run seed --------------------------------------------------------

/** Seeds a provider account + a demo company with one of each role for testing. */
export function ensureSeed() {
  if (!isEmpty() || listAllUsers().length > 0) return;

  // Provider (you, the distributor)
  const salt = makeSalt();
  insertUser({
    companyId: null,
    name: 'Portal Admin',
    email: 'provider@portal.com',
    operatorId: 'PROVIDER',
    role: ROLES.PROVIDER,
    active: true,
    salt,
    hash: hashPw('provider123', salt),
    createdAt: new Date().toISOString(),
    createdBy: 'seed',
  });

  // Demo company with master + manager + staff so all logins can be tested
  const { company } = provisionCompany({
    companyName: 'Demo Company Pty Ltd',
    masterName: 'Demo Master',
    masterEmail: 'demo@demo.com',
    password: 'demo1234',
  });
  const mkUser = (name, email, password, role) => {
    const s = makeSalt();
    insertUser({
      companyId: company.id,
      name,
      email,
      operatorId: nextOperatorId(company.id),
      role,
      active: true,
      salt: s,
      hash: hashPw(password, s),
      createdAt: new Date().toISOString(),
      createdBy: 'seed',
    });
  };
  mkUser('Demo Manager', 'manager@demo.com', 'manager123', ROLES.MANAGER);
  mkUser('Demo Staff', 'staff@demo.com', 'staff123', ROLES.STAFF);
}

export const SEED_LOGINS = [
  { label: 'Provider (you)', email: 'provider@portal.com', password: 'provider123' },
  { label: 'Master', email: 'demo@demo.com', password: 'demo1234' },
  { label: 'Manager', email: 'manager@demo.com', password: 'manager123' },
  { label: 'Staff', email: 'staff@demo.com', password: 'staff123' },
];
