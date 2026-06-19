/*
 * auth.js — accounts, roles, sessions (Supabase-backed)
 * -----------------------------------------------------
 * Login + passwords are handled by Supabase Auth (secure, server-side).
 * Companies / accounts / roles live in Postgres tables (companies, profiles)
 * protected by Row-Level Security — see supabase/schema.sql.
 *
 * Roles: provider (no company) / master / manager / staff.
 * Every function here is ASYNC (it talks to the database).
 *
 * Account creation note: to create a login without logging the creator out, we
 * sign the new user up on an isolated client (makeSignupClient), then the creator
 * inserts the profile row (RLS authorises it by the creator's role).
 */

import { supabase, makeSignupClient } from './supabaseClient.js';

export const ROLES = { PROVIDER: 'provider', MASTER: 'master', MANAGER: 'manager', STAFF: 'staff' };

// ---- validation ------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validateEmail = (e) => EMAIL_RE.test(String(e).trim());
export const validatePassword = (p) => typeof p === 'string' && p.length >= 6;

// ---- role helpers (pure) ---------------------------------------------------

export function canAccessConsole(role) {
  return role === ROLES.MASTER || role === ROLES.MANAGER;
}
export function creatableRoles(actorRole) {
  if (actorRole === ROLES.MASTER) return [ROLES.MANAGER, ROLES.STAFF];
  if (actorRole === ROLES.MANAGER) return [ROLES.STAFF];
  return [];
}
export function canActOn(actor, target) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false;
  if (actor.companyId !== target.companyId) return false;
  if (actor.role === ROLES.MASTER) return target.role === ROLES.MANAGER || target.role === ROLES.STAFF;
  if (actor.role === ROLES.MANAGER) return target.role === ROLES.STAFF;
  return false;
}

// ---- mapping + small helpers ----------------------------------------------

function profileToUser(p, email) {
  return {
    id: p.id,
    companyId: p.company_id,
    name: p.name,
    username: p.username,
    email: email || p.email,
    operatorId: p.operator_id,
    role: p.role,
    active: p.active,
  };
}

function friendly(error, fallback = 'Something went wrong.') {
  if (!error) return fallback;
  const m = error.message || String(error);
  if (/row-level security|violates row-level/i.test(m)) return "You don't have permission to do that.";
  if (/profiles_username_unique|username/i.test(m)) return 'That Name/ID is already taken — choose another.';
  if (/duplicate key|already registered|already exists/i.test(m)) return 'That email is already in use.';
  return m;
}

async function nextOperatorId(companyId) {
  const { data } = await supabase.from('profiles').select('operator_id').eq('company_id', companyId);
  const nums = (data || [])
    .map((r) => parseInt(String(r.operator_id || '').replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `OP-${String(next).padStart(3, '0')}`;
}

/** Sign a new user up on an isolated client so the creator stays logged in. */
async function createAuthUser(email, password) {
  const temp = makeSignupClient();
  const { data, error } = await temp.auth.signUp({ email: email.trim(), password });
  if (error) return { ok: false, error: friendly(error) };
  if (!data.user) return { ok: false, error: 'Could not create the login.' };
  return { ok: true, userId: data.user.id };
}

// ---- current user / session ------------------------------------------------

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile || !profile.active) return null;
  return profileToUser(profile, user.email);
}

/** Full context for routing: provider -> {user, company:null}; others -> {user, company}. */
export async function loadContext() {
  const me = await getCurrentUser();
  if (!me) return null;
  if (me.role === ROLES.PROVIDER) return { user: me, company: null };
  const { data: company } = await supabase.from('companies').select('*').eq('id', me.companyId).maybeSingle();
  if (!company) return null;
  return { user: me, company };
}

// ---- login / logout / own password ----------------------------------------

/** Login by Name/ID OR email (+ password). */
export async function login({ identifier, password }) {
  const id = String(identifier || '').trim();
  if (!id) return { ok: false, error: 'Enter your Name/ID or email.' };

  let email = id;
  if (!id.includes('@')) {
    // Resolve a Name/ID to its login email (DB function, callable before sign-in).
    const { data, error } = await supabase.rpc('email_for_login', { identifier: id });
    if (error || !data) return { ok: false, error: 'Incorrect Name/ID or password.' };
    email = data;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/email not confirmed/i.test(error.message)) return { ok: false, error: 'Account not active yet — contact your administrator.' };
    return { ok: false, error: 'Incorrect Name/ID, email, or password.' };
  }
  const me = await getCurrentUser();
  if (!me) {
    await supabase.auth.signOut();
    return { ok: false, error: 'This account has no access yet. Contact your administrator.' };
  }
  return { ok: true, user: me };
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function changeOwnPassword(currentPassword, newPassword) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const { error: e1 } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (e1) return { ok: false, error: 'Current password is incorrect.' };
  if (!validatePassword(newPassword)) return { ok: false, error: 'New password must be at least 6 characters.' };
  const { error: e2 } = await supabase.auth.updateUser({ password: newPassword });
  if (e2) return { ok: false, error: friendly(e2) };
  return { ok: true };
}

// ---- provider: companies + masters ----------------------------------------

export async function listCompaniesWithMasters() {
  const { data: companies, error } = await supabase.from('companies').select('*').order('name');
  if (error) return [];
  const { data: profiles } = await supabase.from('profiles').select('*');
  const all = profiles || [];
  return companies.map((c) => {
    const team = all.filter((p) => p.company_id === c.id);
    return {
      ...c,
      masters: team.filter((p) => p.role === ROLES.MASTER).map((p) => profileToUser(p)),
      managerCount: team.filter((p) => p.role === ROLES.MANAGER).length,
      staffCount: team.filter((p) => p.role === ROLES.STAFF).length,
    };
  });
}

export async function createCompany(name, timezone) {
  if (!name || !name.trim()) return { ok: false, error: 'Enter a company name.' };
  const base = { name: name.trim() };
  const row = timezone ? { ...base, timezone } : base;
  let { data, error } = await supabase.from('companies').insert(row).select().single();
  // If the timezone column hasn't been added yet (migration-004 not run), retry
  // without it so creating a company still works.
  if (error && timezone && /timezone|column/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('companies').insert(base).select().single());
  }
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true, company: data };
}

/** Provider edits a company's name and/or time zone. Pass only what changed. */
export async function updateCompany(companyId, { name, timezone } = {}) {
  const me = await getCurrentUser();
  if (!me || me.role !== ROLES.PROVIDER) return { ok: false, error: 'Not authorised.' };
  const fields = {};
  if (name != null) {
    if (!name.trim()) return { ok: false, error: 'Enter a company name.' };
    fields.name = name.trim();
  }
  if (timezone != null) fields.timezone = timezone;
  if (Object.keys(fields).length === 0) return { ok: true };

  let { error } = await supabase.from('companies').update(fields).eq('id', companyId);
  // Graceful path if the timezone column isn't there yet (migration-004 not run).
  if (error && timezone != null && /timezone|column/i.test(error.message || '')) {
    if (fields.name != null) {
      ({ error } = await supabase.from('companies').update({ name: fields.name }).eq('id', companyId));
      if (!error) return { ok: false, error: 'Saved the name, but time zone needs a one-time database setup (run migration-004.sql in Supabase).' };
    } else {
      return { ok: false, error: 'Time zone needs a one-time database setup (run migration-004.sql in Supabase).' };
    }
  }
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true };
}

/** Master changes their OWN company's time zone (via a SECURITY DEFINER function). */
export async function setOwnCompanyTimezone(timezone) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not signed in.' };
  const { error } = await supabase.rpc('set_company_timezone', { new_tz: timezone });
  if (error) {
    if (/set_company_timezone|does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
      return { ok: false, error: 'Time zone editing needs a one-time database setup (run migration-005.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}

/** Provider sets (or clears, with null/'') a company's logo. */
export async function setCompanyLogo(companyId, logo) {
  const me = await getCurrentUser();
  if (!me || me.role !== ROLES.PROVIDER) return { ok: false, error: 'Not authorised.' };
  const value = logo ? String(logo) : null;
  const { error } = await supabase.from('companies').update({ logo: value }).eq('id', companyId);
  if (error) {
    if (/logo|column/i.test(error.message || '')) {
      return { ok: false, error: 'Logo upload needs a one-time database setup (run migration-006.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}

/** Master sets (or clears) their OWN company's logo (via a SECURITY DEFINER function). */
export async function setOwnCompanyLogo(logo) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not signed in.' };
  const value = logo ? String(logo) : null;
  const { error } = await supabase.rpc('set_company_logo', { new_logo: value });
  if (error) {
    if (/set_company_logo|does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
      return { ok: false, error: 'Logo upload needs a one-time database setup (run migration-006.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}

/** Create a company, and (optionally) its first master account in one go. */
export async function provisionCompany({ companyName, masterName, masterEmail, password, timezone }) {
  const me = await getCurrentUser();
  if (!me || me.role !== ROLES.PROVIDER) return { ok: false, error: 'Not authorised.' };
  if (!companyName || !companyName.trim()) return { ok: false, error: 'Enter a company name.' };

  const wantsMaster = masterName?.trim() || masterEmail?.trim() || password;
  if (wantsMaster) {
    if (!masterName?.trim()) return { ok: false, error: "Enter the master's name (or clear all master fields)." };
    if (!validateEmail(masterEmail)) return { ok: false, error: 'Enter a valid master email.' };
    if (!validatePassword(password)) return { ok: false, error: 'Master password must be at least 6 characters.' };
  }

  const created = await createCompany(companyName, timezone || 'Australia/Sydney');
  if (!created.ok) return created;

  if (!wantsMaster) return { ok: true, company: created.company };

  const res = await providerAddMaster({ companyId: created.company.id, name: masterName, email: masterEmail, password });
  if (!res.ok) return { ok: false, error: `Company created, but master failed: ${res.error}` };
  return { ok: true, company: created.company, user: res.user };
}

export async function providerAddMaster({ companyId, name, email, password }) {
  const me = await getCurrentUser();
  if (!me || me.role !== ROLES.PROVIDER) return { ok: false, error: 'Not authorised.' };
  if (!name || !name.trim()) return { ok: false, error: 'Enter a name.' };
  if (!validateEmail(email)) return { ok: false, error: 'Enter a valid email.' };
  if (!validatePassword(password)) return { ok: false, error: 'Password must be at least 6 characters.' };

  const a = await createAuthUser(email, password);
  if (!a.ok) return a;
  const operatorId = await nextOperatorId(companyId);
  const { data, error } = await supabase.from('profiles')
    .insert({ id: a.userId, company_id: companyId, role: ROLES.MASTER, name: name.trim(), username: name.trim(), email: email.trim(), operator_id: operatorId, active: true })
    .select().single();
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true, user: profileToUser(data) };
}

/** Provider renames a company. */
export async function renameCompany(companyId, name) {
  const me = await getCurrentUser();
  if (!me || me.role !== ROLES.PROVIDER) return { ok: false, error: 'Not authorised.' };
  if (!name || !name.trim()) return { ok: false, error: 'Enter a company name.' };
  const { error } = await supabase.from('companies').update({ name: name.trim() }).eq('id', companyId);
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true };
}

/**
 * Edit an account's Name/ID and/or login email. Pass only the fields you want to
 * change (leave the other null/undefined). Name/ID updates the profiles table
 * (RLS authorises by the caller's role). Email is the real login credential, so
 * it goes through the admin_set_email DB function (updates auth + profiles).
 */
export async function updateAccountInfo(userId, { name, email } = {}) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not signed in.' };

  if (name != null) {
    if (!name.trim()) return { ok: false, error: 'Enter a Name/ID.' };
    const { error } = await supabase.from('profiles')
      .update({ name: name.trim(), username: name.trim() }).eq('id', userId);
    if (error) return { ok: false, error: friendly(error) };
  }

  if (email != null) {
    if (!validateEmail(email)) return { ok: false, error: 'Enter a valid email.' };
    const { error } = await supabase.rpc('admin_set_email', { target_id: userId, new_email: email.trim() });
    if (error) {
      if (/admin_set_email|does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
        return { ok: false, error: 'Email editing needs a one-time database setup (run migration-003.sql in Supabase). Any Name/ID change was still saved.' };
      }
      return { ok: false, error: friendly(error) };
    }
  }

  return { ok: true };
}

/** Provider deletes a company (cascades to its accounts + app data). Re-enters password. */
export async function deleteCompany(companyId, password) {
  const me = await getCurrentUser();
  if (!me || me.role !== ROLES.PROVIDER) return { ok: false, error: 'Not authorised.' };
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: me.email, password });
  if (authErr) return { ok: false, error: 'Password is incorrect.' };
  const { error } = await supabase.from('companies').delete().eq('id', companyId);
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true };
}

// ---- company team management (master / manager) ---------------------------

export async function listTeam(companyId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('company_id', companyId).order('created_at');
  if (error) return [];
  return data.map((p) => profileToUser(p));
}

export async function createAccount({ name, email, password, role }) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  if (!creatableRoles(me.role).includes(role)) return { ok: false, error: `You can't create a ${role} account.` };
  if (!name || !name.trim()) return { ok: false, error: 'Enter a name.' };
  if (!validateEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!validatePassword(password)) return { ok: false, error: 'Password must be at least 6 characters.' };

  const a = await createAuthUser(email, password);
  if (!a.ok) return a;
  const operatorId = await nextOperatorId(me.companyId);
  const { data, error } = await supabase.from('profiles')
    .insert({ id: a.userId, company_id: me.companyId, role, name: name.trim(), username: name.trim(), email: email.trim(), operator_id: operatorId, active: true })
    .select().single();
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true, user: profileToUser(data) };
}

export async function changeRole(userId, role) {
  if (role !== ROLES.MANAGER && role !== ROLES.STAFF) return { ok: false, error: 'Invalid role.' };
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true };
}

export async function setActive(userId, active) {
  const { error } = await supabase.from('profiles').update({ active }).eq('id', userId);
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true };
}

export async function removeAccount(userId) {
  const { error } = await supabase.from('profiles').delete().eq('id', userId);
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true };
}

/**
 * Admin password reset (role hierarchy enforced inside the DB function):
 * provider -> anyone; master -> manager/staff in own company; manager -> staff.
 */
export async function adminResetPassword(userId, newPassword) {
  if (!validatePassword(newPassword)) return { ok: false, error: 'Password must be at least 6 characters.' };
  const { error } = await supabase.rpc('admin_set_password', { target_id: userId, new_password: newPassword });
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true };
}
