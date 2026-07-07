/*
 * auth.js — accounts, roles, sessions (Supabase-backed)
 * -----------------------------------------------------
 * Login + passwords are handled by Supabase Auth (secure, server-side).
 * Companies / accounts / roles live in Postgres tables (companies, profiles)
 * protected by Row-Level Security — see supabase/schema.sql.
 *
 * Roles: provider (no company) / master / manager / staff / owner (no single
 * company — linked to several via company_owners; read-only, see migration-013).
 * Every function here is ASYNC (it talks to the database).
 *
 * Account creation note: to create a login without logging the creator out, we
 * sign the new user up on an isolated client (makeSignupClient), then the creator
 * inserts the profile row (RLS authorises it by the creator's role).
 */

import { supabase, makeSignupClient } from './supabaseClient.js';

export const ROLES = { PROVIDER: 'provider', SUB_PROVIDER: 'sub-provider', MASTER: 'master', MANAGER: 'manager', STAFF: 'staff', OWNER: 'owner' };

// Sub-provider can do everything a provider can EXCEPT delete a company (see
// deleteCompany/createProvider below, which stay provider-ONLY on purpose).
export function isProviderTier(role) {
  return role === ROLES.PROVIDER || role === ROLES.SUB_PROVIDER;
}

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

// The exact profile columns profileToUser() reads. Select these explicitly instead
// of '*' so profile queries don't ship unused columns over the wire (Supabase egress).
// Keep this list in sync with profileToUser below if you add or remove a field.
const PROFILE_COLUMNS = 'id, company_id, name, username, email, operator_id, role, active, nationality';

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
    nationality: p.nationality || '',
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
  const { data: profile } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
  if (!profile || !profile.active) return null;
  return profileToUser(profile, user.email);
}

/** Full context for routing: provider/owner -> {user, company:null}; others -> {user, company}. */
export async function loadContext() {
  const me = await getCurrentUser();
  if (!me) return null;
  if (isProviderTier(me.role) || me.role === ROLES.OWNER) return { user: me, company: null };
  const { data: company } = await supabase.from('companies').select('*').eq('id', me.companyId).maybeSingle();
  if (!company) return null;
  return { user: me, company };
}

// ---- login / logout / own password ----------------------------------------

const RATE_LIMIT_MESSAGE = 'Too many login attempts from your network right now. Please wait a few minutes and try again.';

/** True for Supabase's own "too many requests" auth error, under whatever shape this SDK version uses. */
function isRateLimited(error) {
  if (!error) return false;
  return error.status === 429 || error.code === 'over_request_rate_limit' || /rate limit/i.test(error.message || '');
}

/** Login by Name/ID OR email (+ password). */
export async function login({ identifier, password }) {
  const id = String(identifier || '').trim();
  if (!id) return { ok: false, error: 'Enter your Name/ID or email.' };

  let email = id;
  if (!id.includes('@')) {
    // Resolve a Name/ID to its login email (DB function, callable before sign-in).
    const { data, error } = await supabase.rpc('email_for_login', { identifier: id });
    if (error) return { ok: false, error: isRateLimited(error) ? RATE_LIMIT_MESSAGE : 'Incorrect Name/ID or password.', rateLimited: isRateLimited(error) };
    if (!data) return { ok: false, error: 'Incorrect Name/ID or password.' };
    email = data;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (isRateLimited(error)) return { ok: false, error: RATE_LIMIT_MESSAGE, rateLimited: true };
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
  const { data: profiles } = await supabase.from('profiles').select(PROFILE_COLUMNS);
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
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
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

/** Any signed-in account sets (or clears, with '') its OWN nationality. */
export async function setOwnNationality(nationality) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not signed in.' };
  const { error } = await supabase.rpc('set_own_nationality', { new_nat: nationality || '' });
  if (error) {
    if (/set_own_nationality|nationality|does not exist|could not find|schema cache|PGRST202|PGRST204/i.test(error.message || '')) {
      return { ok: false, error: 'Nationality needs a one-time database setup (run migration-010.sql then migration-011.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}

/** Provider sets (or clears, with null/'') a company's logo. */
export async function setCompanyLogo(companyId, logo) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
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
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
  if (!companyName || !companyName.trim()) return { ok: false, error: 'Enter a company name.' };

  const wantsMaster = masterName?.trim() || masterEmail?.trim() || password;
  if (wantsMaster) {
    if (!masterName?.trim()) return { ok: false, error: "Enter the master's name (or clear all master fields)." };
    if (!validateEmail(masterEmail)) return { ok: false, error: 'Enter a valid master email.' };
    if (!validatePassword(password)) return { ok: false, error: 'Master password must be at least 6 characters.' };
  }

  const created = await createCompany(companyName, timezone || 'Australia/Sydney');
  if (!created.ok) return created;
  // Best-effort: seed a billing row with today as the start date (migration-016).
  // Never blocks company creation — the provider can still set this later.
  await supabase.from('company_billing')
    .upsert({ company_id: created.company.id, started_at: new Date().toISOString().slice(0, 10) }, { onConflict: 'company_id' });

  if (!wantsMaster) return { ok: true, company: created.company };

  const res = await providerAddMaster({ companyId: created.company.id, name: masterName, email: masterEmail, password });
  if (!res.ok) return { ok: false, error: `Company created, but master failed: ${res.error}` };
  return { ok: true, company: created.company, user: res.user };
}

export async function providerAddMaster({ companyId, name, email, password }) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
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
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
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
export async function updateAccountInfo(userId, { name, email, nationality } = {}) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not signed in.' };

  if (name != null) {
    if (!name.trim()) return { ok: false, error: 'Enter a Name/ID.' };
    const { error } = await supabase.from('profiles')
      .update({ name: name.trim(), username: name.trim() }).eq('id', userId);
    if (error) return { ok: false, error: friendly(error) };
  }

  if (nationality != null) {
    const { error } = await supabase.from('profiles')
      .update({ nationality }).eq('id', userId);
    if (error) {
      if (/nationality|does not exist|could not find|schema cache|PGRST204/i.test(error.message || '')) {
        return { ok: false, error: 'Nationality needs a one-time database setup (run migration-010.sql in Supabase). Any other change was still saved.' };
      }
      return { ok: false, error: friendly(error) };
    }
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
  // Delete the real logins too (frees every member's email + ID for reuse), then
  // the company. Falls back to the old delete if the function isn't installed yet.
  const { error } = await supabase.rpc('admin_delete_company', { target_company: companyId });
  if (error) {
    if (/admin_delete_company|does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
      const { error: delErr } = await supabase.from('companies').delete().eq('id', companyId);
      if (delErr) return { ok: false, error: friendly(delErr) };
      return { ok: true };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}

/**
 * Provider one-click cleanup: delete leftover logins (emails) from accounts that
 * were deleted BEFORE the auto-free functions existed, so those emails/IDs can be
 * reused. Returns { ok, count }. Live accounts are never touched (they have a profile).
 */
export async function purgeOrphanLogins() {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
  const { data, error } = await supabase.rpc('admin_purge_orphan_logins');
  if (error) {
    if (/admin_purge_orphan_logins|does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
      return { ok: false, error: 'This needs a one-time database setup (run migration-007.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true, count: data ?? 0 };
}

// ---- company team management (master / manager) ---------------------------

export async function listTeam(companyId) {
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('company_id', companyId).order('created_at');
  if (error) return [];
  return data.map((p) => profileToUser(p));
}

export async function createAccount({ name, email, password, role, nationality }) {
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
  let user = profileToUser(data);
  // Nationality is set in a second, best-effort step so the account itself is never
  // blocked by it (e.g. migration-010.sql not run yet — the account still gets created,
  // just without a nationality tag until the migration is applied).
  if (nationality) {
    const { data: natData, error: natError } = await supabase.from('profiles')
      .update({ nationality }).eq('id', a.userId).select().single();
    if (!natError && natData) user = profileToUser(natData);
  }
  return { ok: true, user };
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
  // Delete the real login (frees its email + ID for reuse); this cascades the
  // profile row away. Falls back to the old delete if the function isn't installed.
  const { error } = await supabase.rpc('admin_delete_account', { target_id: userId });
  if (error) {
    if (/admin_delete_account|does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
      const { error: delErr } = await supabase.from('profiles').delete().eq('id', userId);
      if (delErr) return { ok: false, error: friendly(delErr) };
      return { ok: true };
    }
    return { ok: false, error: friendly(error) };
  }
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

// ---- owner accounts (span multiple companies, read-only) -------------------

/** Provider creates an "owner" login — not tied to a single company. */
export async function createOwner({ name, email, password }) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
  if (!name || !name.trim()) return { ok: false, error: 'Enter a name.' };
  if (!validateEmail(email)) return { ok: false, error: 'Enter a valid email.' };
  if (!validatePassword(password)) return { ok: false, error: 'Password must be at least 6 characters.' };

  const a = await createAuthUser(email, password);
  if (!a.ok) return a;
  const { data, error } = await supabase.from('profiles')
    .insert({ id: a.userId, company_id: null, role: ROLES.OWNER, name: name.trim(), username: name.trim(), email: email.trim(), active: true })
    .select().single();
  if (error) {
    if (/profiles_role_check|invalid input value for enum|role/i.test(error.message || '')) {
      return { ok: false, error: 'Owner accounts need a one-time database setup (run migration-013.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true, user: profileToUser(data) };
}

/** Provider: every owner login, each with the list of company IDs it's linked to. */
export async function listOwners() {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return [];
  const { data: owners, error } = await supabase.from('profiles').select('*').eq('role', ROLES.OWNER).order('created_at');
  if (error) return [];
  const { data: links } = await supabase.from('company_owners').select('owner_id, company_id');
  const all = links || [];
  return owners.map((p) => ({ ...profileToUser(p), companyIds: all.filter((l) => l.owner_id === p.id).map((l) => l.company_id) }));
}

/** Provider links (linked=true) or unlinks (linked=false) a company to an owner. */
export async function setOwnerCompanyLink(ownerId, companyId, linked) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
  if (linked) {
    const { error } = await supabase.from('company_owners').insert({ owner_id: ownerId, company_id: companyId });
    if (error && !/duplicate key/i.test(error.message || '')) {
      if (/company_owners|does not exist|schema cache/i.test(error.message || '')) {
        return { ok: false, error: 'Owner accounts need a one-time database setup (run migration-013.sql in Supabase).' };
      }
      return { ok: false, error: friendly(error) };
    }
  } else {
    const { error } = await supabase.from('company_owners').delete().eq('owner_id', ownerId).eq('company_id', companyId);
    if (error) return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}

/**
 * Owner: deposits/withdrawals + store balance for every linked company, scoped to
 * one date. Pass 'YYYY-MM-DD' to look at a specific day; omit it for each company's
 * own "today" (per its own time zone).
 */
export async function getOwnerSummaries(date) {
  const me = await getCurrentUser();
  if (!me || me.role !== ROLES.OWNER) return { ok: false, error: 'Not authorised.', rows: [] };

  let { data, error } = await supabase.rpc('owner_company_summaries', { p_date: date || null });
  let dateUnsupported = false;
  // migration-014 (adds the date parameter) not run yet — fall back to the original
  // zero-argument version so the overview itself doesn't break, just date-picking.
  if (error && /does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
    dateUnsupported = true;
    ({ data, error } = await supabase.rpc('owner_company_summaries'));
  }
  if (error) {
    if (/owner_company_summaries/i.test(error.message || '')) {
      return { ok: false, error: 'This needs a one-time database setup (run migration-013.sql in Supabase).', rows: [] };
    }
    return { ok: false, error: friendly(error), rows: [] };
  }
  return { ok: true, dateUnsupported: dateUnsupported && !!date, rows: (data || []).map((r) => ({
    companyId: r.company_id, name: r.name, logo: r.logo, timezone: r.timezone, asOfDate: r.as_of_date,
    depositsCount: r.deposits_count, depositsAmount: r.deposits_amount,
    withdrawalsCount: r.withdrawals_count, withdrawalsAmount: r.withdrawals_amount,
    storeCountToday: r.store_count_today, storeBalance: r.store_balance, storeYesterday: r.store_yesterday,
    updatedAt: r.updated_at,
  })) };
}

// ---- provider accounts (other super-admin logins) --------------------------

/** Provider creates another provider-tier login (full provider or sub-provider —
 * pass role: ROLES.PROVIDER or ROLES.SUB_PROVIDER). Stays PROVIDER-ONLY on purpose
 * — a sub-provider must never be able to mint more provider-tier accounts, even
 * another sub-provider, or access could quietly proliferate beyond one person's
 * control. Also re-checks the CURRENT provider's own password first (same safety
 * step as deleteCompany) since this is one of the highest-privilege actions here. */
export async function createProvider({ name, email, password, currentPassword, role }) {
  const me = await getCurrentUser();
  if (!me || me.role !== ROLES.PROVIDER) return { ok: false, error: 'Not authorised.' };
  const targetRole = role === ROLES.SUB_PROVIDER ? ROLES.SUB_PROVIDER : ROLES.PROVIDER;
  if (!name || !name.trim()) return { ok: false, error: 'Enter a name.' };
  if (!validateEmail(email)) return { ok: false, error: 'Enter a valid email.' };
  if (!validatePassword(password)) return { ok: false, error: 'Password must be at least 6 characters.' };
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: me.email, password: currentPassword });
  if (authErr) return { ok: false, error: 'Your current password is incorrect.' };

  const a = await createAuthUser(email, password);
  if (!a.ok) return a;
  const { data, error } = await supabase.from('profiles')
    .insert({ id: a.userId, company_id: null, role: targetRole, name: name.trim(), username: name.trim(), email: email.trim(), active: true })
    .select().single();
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true, user: profileToUser(data) };
}

/** Every provider-tier login (full providers + sub-providers), readable by both tiers. */
export async function listProviders() {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return [];
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS)
    .in('role', [ROLES.PROVIDER, ROLES.SUB_PROVIDER]).order('created_at');
  if (error) return [];
  return data.map((p) => profileToUser(p));
}

// ---- provider-tier: company billing (start date + rental fees) ------------
// Lives in its own tables (migration-016 + migration-020) with RLS gated on
// is_provider_tier() — no master/manager/staff/owner login can ever read or
// write any of this, and it is only ever rendered on the Provider page.
// "Paid" isn't a sticky flag any more — it's a real per-month log
// (company_billing_payments), so past months stay on record instead of
// being overwritten every time this month's status changes.

/** 'YYYY-MM' for the current calendar month, in the browser's local time. */
export function currentBillingPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function billingRowToObj(r) {
  return { companyId: r.company_id, startedAt: r.started_at, rentalFee: r.rental_fee, updatedAt: r.updated_at };
}

function paymentRowToObj(r) {
  return { id: r.id, companyId: r.company_id, period: r.period, amount: r.amount, paidAt: r.paid_at, recordedBy: r.recorded_by };
}

/** Provider-tier: every company's start date + rental-fee amount (not paid-status — see listBillingPayments). */
export async function listCompanyBilling() {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.', rows: [] };
  const { data, error } = await supabase.from('company_billing').select('*');
  if (error) {
    if (/company_billing|does not exist|could not find|schema cache/i.test(error.message || '')) {
      return { ok: false, error: 'This needs a one-time database setup (run migration-016.sql in Supabase).', rows: [] };
    }
    return { ok: false, error: friendly(error), rows: [] };
  }
  return { ok: true, rows: (data || []).map(billingRowToObj) };
}

/** Provider-tier sets a company's start date and/or rental-fee amount. Pass only what changed. */
export async function updateCompanyBilling(companyId, { startedAt, rentalFee } = {}) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };

  const fields = { company_id: companyId, updated_at: new Date().toISOString() };
  if (startedAt !== undefined) fields.started_at = startedAt || null;
  if (rentalFee !== undefined) {
    const amount = rentalFee === '' || rentalFee == null ? null : Number(rentalFee);
    if (amount != null && (Number.isNaN(amount) || amount < 0)) return { ok: false, error: 'Enter a valid rent amount.' };
    fields.rental_fee = amount;
  }

  const { error } = await supabase.from('company_billing').upsert(fields, { onConflict: 'company_id' });
  if (error) {
    if (/company_billing|does not exist|could not find|schema cache/i.test(error.message || '')) {
      return { ok: false, error: 'This needs a one-time database setup (run migration-016.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}

/** Provider-tier: the payment log, optionally filtered to one company and/or one period ('YYYY-MM'). Most recent period first. */
export async function listBillingPayments({ companyId, period } = {}) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.', rows: [] };
  let q = supabase.from('company_billing_payments').select('*').order('period', { ascending: false });
  if (companyId) q = q.eq('company_id', companyId);
  if (period) q = q.eq('period', period);
  const { data, error } = await q;
  if (error) {
    if (/company_billing_payments|does not exist|could not find|schema cache/i.test(error.message || '')) {
      return { ok: false, error: 'This needs a one-time database setup (run migration-020.sql in Supabase).', rows: [] };
    }
    return { ok: false, error: friendly(error), rows: [] };
  }
  return { ok: true, rows: (data || []).map(paymentRowToObj) };
}

/** Provider-tier: mark one or many companies' CURRENT month rent as paid, using
 * each company's own configured rental_fee automatically. Pass an array of
 * company IDs even for a single company. */
export async function markRentPaid(companyIds) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.rpc('mark_rent_paid', { company_ids: companyIds });
  if (error) {
    if (/mark_rent_paid|does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
      return { ok: false, error: 'This needs a one-time database setup (run migration-020.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}

/** Provider-tier: clear the CURRENT month's paid record for one or many companies. */
export async function markRentUnpaid(companyIds) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.rpc('mark_rent_unpaid', { company_ids: companyIds });
  if (error) {
    if (/mark_rent_unpaid|does not exist|could not find|schema cache|PGRST202/i.test(error.message || '')) {
      return { ok: false, error: 'This needs a one-time database setup (run migration-020.sql in Supabase).' };
    }
    return { ok: false, error: friendly(error) };
  }
  return { ok: true };
}
