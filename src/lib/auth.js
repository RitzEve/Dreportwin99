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
  // Drop the Console's "online" dot straight away rather than letting it go
  // stale on its own. Must run BEFORE signOut, while the token is still valid —
  // clear_presence() identifies the row by auth.uid(). Failure is ignored on
  // purpose: never block a sign-out on a presence write.
  try { await clearPresence(); } catch { /* signing out regardless */ }
  await supabase.auth.signOut();
}

// ---- presence: who's signed in right now, and from where ------------------
/*
 * Backed by the user_presence table + two SECURITY DEFINER functions
 * (migration-026). The IP is captured server-side from the request headers —
 * it is deliberately NOT passed from here, so it can't be faked.
 *
 * Both calls are fire-and-forget background chatter: if the migration hasn't
 * been run yet, or the network blips, they fail silently rather than surfacing
 * an error to someone who was only trying to use the app.
 */
export async function touchPresence() {
  try { await supabase.rpc('touch_presence'); } catch { /* presence is best-effort */ }
}

export async function clearPresence() {
  try { await supabase.rpc('clear_presence'); } catch { /* presence is best-effort */ }
}

/** Master/manager: presence rows for their own company, keyed by user id. */
export async function listPresence(companyId) {
  const { data, error } = await supabase
    .from('user_presence')
    .select('user_id, last_seen, last_ip, updated_at')
    .eq('company_id', companyId);
  // Includes the "table doesn't exist yet" case — the Console just shows no
  // dots instead of an error banner.
  if (error) return {};
  const byUser = {};
  for (const r of (data || [])) {
    byUser[r.user_id] = {
      lastSeen: r.last_seen,
      lastIp: r.last_ip || '',
      // When someone signs out, clear_presence() nulls last_seen but stamps
      // updated_at — so updated_at IS the moment they were last here. Falling
      // back to it means "last seen" survives a sign-out without needing a
      // separate column to remember it.
      lastSeenAt: r.last_seen || r.updated_at || null,
    };
  }
  return byUser;
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
export async function updateCompany(companyId, { name, timezone, country } = {}) {
  const me = await getCurrentUser();
  if (!me || !isProviderTier(me.role)) return { ok: false, error: 'Not authorised.' };
  const fields = {};
  if (name != null) {
    if (!name.trim()) return { ok: false, error: 'Enter a company name.' };
    fields.name = name.trim();
  }
  if (timezone != null) fields.timezone = timezone;
  // Country decides which shared Blacklist Member pool this company reads and
  // writes (migration-027) — companies in the same country share one list.
  if (country != null) fields.country = country || null;
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
  if (error && country != null && /country|column/i.test(error.message || '')) {
    return { ok: false, error: 'Country needs a one-time database setup (run migration-027.sql in Supabase).' };
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

// ---- the four "Details" vault pages: shared read gate ---------------------
/*
 * Resolve which company a Details-page READ should be scoped to, or null when
 * this session may not read that table at all.
 *
 * `allowed` lists the company-side roles that may read it. An OWNER is always
 * additionally allowed, but read-only and against the company they drilled
 * into: an owner's own profiles.company_id is always NULL (that's what makes
 * the whole owner drill-in read-only), so `me.companyId` is useless for them
 * and AppScreen.jsx passes the drilled-in company id in explicitly — same
 * shape as listTeam(companyId) already uses.
 *
 * Server-side this is backed by migration-025, which adds the matching
 * company_owners clause to each table's SELECT policy and deliberately leaves
 * their insert/update/delete policies alone — so an owner physically cannot
 * write to any of them. Every create/update/delete below keeps its own role
 * check as well; this helper is for reads only.
 */
function vaultReadCompanyId(me, companyId, allowed) {
  if (!me) return null;
  if (me.role === ROLES.OWNER) return companyId || null;
  return allowed.includes(me.role) ? (me.companyId || null) : null;
}

// ---- bank details (master/manager: drop-account records) ------------------
// Lives in its own table (migration-021) with RLS gated on company_id +
// role in ('master','manager') — staff never receives this data at all, not
// just a hidden nav item. Not linked to the `banks` array used for entry
// unless explicitly copied over (see markBankDetailAdded, called by
// FinTrack's "Add to bank accounts" action).

const BANK_DETAIL_FIELD_MAP = {
  phoneModel: 'phone_model', bankName: 'bank_name', holderName: 'holder_name',
  dateOfBirth: 'date_of_birth', phoneNumber: 'phone_number', email: 'email',
  emailPassword: 'email_password', cardLast4: 'card_last4', cardPin: 'card_pin',
  loginPin: 'login_pin', customerLoginId: 'customer_login_id', internetPassword: 'internet_password',
  vpn: 'vpn', otpLink: 'otp_link', bsb: 'bsb', account: 'account_number', payid: 'payid',
  openDate: 'open_date', agent: 'agent', others: 'others', remarks: 'remarks',
};

function bankDetailRowToObj(r) {
  const obj = {
    id: r.id, companyId: r.company_id, frozen: !!r.frozen,
    addedToBankAccountsAt: r.added_to_bank_accounts_at, updatedAt: r.updated_at,
  };
  for (const [key, col] of Object.entries(BANK_DETAIL_FIELD_MAP)) obj[key] = r[col] ?? '';
  return obj;
}

function bankDetailFieldsToRow(fields) {
  const row = {};
  for (const [key, col] of Object.entries(BANK_DETAIL_FIELD_MAP)) {
    if (fields[key] !== undefined) row[col] = fields[key] === '' ? null : fields[key];
  }
  return row;
}

const BANK_DETAILS_SETUP_ERROR = 'This needs a one-time database setup (run migration-021.sql in Supabase).';
const isBankDetailsMissing = (error) => /bank_details|does not exist|could not find|schema cache/i.test(error?.message || '');

/** Master/manager (own company) or an owner (read-only, drilled-in company). */
export async function listBankDetails(companyId) {
  const me = await getCurrentUser();
  const cid = vaultReadCompanyId(me, companyId, [ROLES.MASTER, ROLES.MANAGER]);
  if (!cid) return { ok: false, error: 'Not authorised.', rows: [] };
  const { data, error } = await supabase.from('bank_details').select('*')
    .eq('company_id', cid).order('created_at', { ascending: false });
  if (error) return { ok: false, error: isBankDetailsMissing(error) ? BANK_DETAILS_SETUP_ERROR : friendly(error), rows: [] };
  return { ok: true, rows: (data || []).map(bankDetailRowToObj) };
}

/** Master/manager: create a bank-details record for their own company. Every field is optional. */
export async function createBankDetail(fields) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  const row = { ...bankDetailFieldsToRow(fields), company_id: me.companyId };
  const { data, error } = await supabase.from('bank_details').insert(row).select().single();
  if (error) return { ok: false, error: isBankDetailsMissing(error) ? BANK_DETAILS_SETUP_ERROR : friendly(error) };
  return { ok: true, row: bankDetailRowToObj(data) };
}

/** Master/manager: edit a bank-details record. Pass only the fields that changed. */
export async function updateBankDetail(id, fields) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  const row = { ...bankDetailFieldsToRow(fields), updated_at: new Date().toISOString() };
  const { error } = await supabase.from('bank_details').update(row).eq('id', id);
  if (error) return { ok: false, error: isBankDetailsMissing(error) ? BANK_DETAILS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

/** Master/manager: permanently delete a bank-details record. */
export async function deleteBankDetail(id) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.from('bank_details').delete().eq('id', id);
  if (error) return { ok: false, error: isBankDetailsMissing(error) ? BANK_DETAILS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

/** Master/manager: freeze/unfreeze a bank-details record. Status only — not linked to entry. */
export async function setBankDetailFrozen(id, frozen) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.from('bank_details')
    .update({ frozen: !!frozen, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: isBankDetailsMissing(error) ? BANK_DETAILS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

/** Master/manager: stamp a record as having been copied into Bank Accounts (drives the "Added" badge). */
export async function markBankDetailAdded(id) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.from('bank_details')
    .update({ added_to_bank_accounts_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: isBankDetailsMissing(error) ? BANK_DETAILS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

// ---- company credentials (master/manager: general login/credential vault) --
// Lives in its own table (migration-022) with RLS gated on company_id + role
// in ('master','manager') — same isolation as bank_details, and arguably more
// important here since this can hold root-level infrastructure credentials.
// No fixed field schema: name/category/username/email/password/link cover the
// common case, customFields (jsonb array of {label,value,sensitive}) covers
// everything else a given record needs.

const CREDENTIAL_FIELD_MAP = {
  name: 'name', category: 'category', username: 'username',
  email: 'email', password: 'password', link: 'link',
};

function credentialRowToObj(r) {
  const obj = {
    id: r.id, companyId: r.company_id, updatedAt: r.updated_at,
    customFields: Array.isArray(r.custom_fields) ? r.custom_fields : [],
  };
  for (const [key, col] of Object.entries(CREDENTIAL_FIELD_MAP)) obj[key] = r[col] ?? '';
  return obj;
}

function credentialFieldsToRow(fields) {
  const row = {};
  for (const [key, col] of Object.entries(CREDENTIAL_FIELD_MAP)) {
    if (fields[key] !== undefined) row[col] = fields[key] === '' ? null : fields[key];
  }
  if (fields.customFields !== undefined) row.custom_fields = fields.customFields;
  return row;
}

const CREDENTIALS_SETUP_ERROR = 'This needs a one-time database setup (run migration-022.sql in Supabase).';
const isCredentialsMissing = (error) => /company_credentials|does not exist|could not find|schema cache/i.test(error?.message || '');

/** Master/manager (own company) or an owner (read-only, drilled-in company). */
export async function listCompanyCredentials(companyId) {
  const me = await getCurrentUser();
  const cid = vaultReadCompanyId(me, companyId, [ROLES.MASTER, ROLES.MANAGER]);
  if (!cid) return { ok: false, error: 'Not authorised.', rows: [] };
  const { data, error } = await supabase.from('company_credentials').select('*')
    .eq('company_id', cid).order('created_at', { ascending: false });
  if (error) return { ok: false, error: isCredentialsMissing(error) ? CREDENTIALS_SETUP_ERROR : friendly(error), rows: [] };
  return { ok: true, rows: (data || []).map(credentialRowToObj) };
}

/** Master/manager: create a credential record for their own company. Only `name` is required. */
export async function createCompanyCredential(fields) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  if (!fields.name || !fields.name.trim()) return { ok: false, error: 'Record name is required.' };
  fields.name = fields.name.trim();
  const row = { ...credentialFieldsToRow(fields), company_id: me.companyId };
  const { data, error } = await supabase.from('company_credentials').insert(row).select().single();
  if (error) return { ok: false, error: isCredentialsMissing(error) ? CREDENTIALS_SETUP_ERROR : friendly(error) };
  return { ok: true, row: credentialRowToObj(data) };
}

/** Master/manager: edit a credential record. Pass only the fields that changed. */
export async function updateCompanyCredential(id, fields) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  if (fields.name !== undefined && (!fields.name || !fields.name.trim())) return { ok: false, error: 'Record name is required.' };
  if (fields.name !== undefined) fields.name = fields.name.trim();
  const row = { ...credentialFieldsToRow(fields), updated_at: new Date().toISOString() };
  const { error } = await supabase.from('company_credentials').update(row).eq('id', id);
  if (error) return { ok: false, error: isCredentialsMissing(error) ? CREDENTIALS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

/** Master/manager: permanently delete a credential record. */
export async function deleteCompanyCredential(id) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.from('company_credentials').delete().eq('id', id);
  if (error) return { ok: false, error: isCredentialsMissing(error) ? CREDENTIALS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

// ---- payment gateway details (master/manager: payment gateway credential vault) --
// Lives in its own table (migration-023) with the same RLS shape as
// company_credentials — see that block's comment above for the full isolation
// reasoning. Fixed fields cover the common case (backend link/login ID/
// password/API key/merchant key/merchant code); customFields (jsonb array of
// {label,value,sensitive}) covers anything else per gateway.

const PAYMENT_GATEWAY_FIELD_MAP = {
  name: 'name', backendLink: 'backend_link', loginId: 'login_id', password: 'password',
  apiKey: 'api_key', merchantKey: 'merchant_key', merchantCode: 'merchant_code',
};

function paymentGatewayRowToObj(r) {
  const obj = {
    id: r.id, companyId: r.company_id, updatedAt: r.updated_at,
    customFields: Array.isArray(r.custom_fields) ? r.custom_fields : [],
  };
  for (const [key, col] of Object.entries(PAYMENT_GATEWAY_FIELD_MAP)) obj[key] = r[col] ?? '';
  return obj;
}

function paymentGatewayFieldsToRow(fields) {
  const row = {};
  for (const [key, col] of Object.entries(PAYMENT_GATEWAY_FIELD_MAP)) {
    if (fields[key] !== undefined) row[col] = fields[key] === '' ? null : fields[key];
  }
  if (fields.customFields !== undefined) row.custom_fields = fields.customFields;
  return row;
}

const PAYMENT_GATEWAYS_SETUP_ERROR = 'This needs a one-time database setup (run migration-023.sql in Supabase).';
const isPaymentGatewaysMissing = (error) => /payment_gateways|does not exist|could not find|schema cache/i.test(error?.message || '');

/** Master/manager (own company) or an owner (read-only, drilled-in company). */
export async function listPaymentGateways(companyId) {
  const me = await getCurrentUser();
  const cid = vaultReadCompanyId(me, companyId, [ROLES.MASTER, ROLES.MANAGER]);
  if (!cid) return { ok: false, error: 'Not authorised.', rows: [] };
  const { data, error } = await supabase.from('payment_gateways').select('*')
    .eq('company_id', cid).order('created_at', { ascending: false });
  if (error) return { ok: false, error: isPaymentGatewaysMissing(error) ? PAYMENT_GATEWAYS_SETUP_ERROR : friendly(error), rows: [] };
  return { ok: true, rows: (data || []).map(paymentGatewayRowToObj) };
}

/** Master/manager: create a payment gateway record for their own company. Only `name` is required. */
export async function createPaymentGateway(fields) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  if (!fields.name || !fields.name.trim()) return { ok: false, error: 'Record name is required.' };
  fields.name = fields.name.trim();
  const row = { ...paymentGatewayFieldsToRow(fields), company_id: me.companyId };
  const { data, error } = await supabase.from('payment_gateways').insert(row).select().single();
  if (error) return { ok: false, error: isPaymentGatewaysMissing(error) ? PAYMENT_GATEWAYS_SETUP_ERROR : friendly(error) };
  return { ok: true, row: paymentGatewayRowToObj(data) };
}

/** Master/manager: edit a payment gateway record. Pass only the fields that changed. */
export async function updatePaymentGateway(id, fields) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  if (fields.name !== undefined && (!fields.name || !fields.name.trim())) return { ok: false, error: 'Record name is required.' };
  if (fields.name !== undefined) fields.name = fields.name.trim();
  const row = { ...paymentGatewayFieldsToRow(fields), updated_at: new Date().toISOString() };
  const { error } = await supabase.from('payment_gateways').update(row).eq('id', id);
  if (error) return { ok: false, error: isPaymentGatewaysMissing(error) ? PAYMENT_GATEWAYS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

/** Master/manager: permanently delete a payment gateway record. */
export async function deletePaymentGateway(id) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.from('payment_gateways').delete().eq('id', id);
  if (error) return { ok: false, error: isPaymentGatewaysMissing(error) ? PAYMENT_GATEWAYS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

// ---- game kiosk details (ALL roles: master/manager/staff — no console gate) --
// Lives in its own table (migration-024), same dedicated-table pattern as
// payment_gateways/company_credentials/bank_details, but deliberately open to
// every role: RLS (and these functions) only check company_id, not my_role().

const KIOSK_FIELD_MAP = {
  name: 'name', backendLink: 'backend_link', loginId: 'login_id',
  password: 'password', merchantCode: 'merchant_code',
};

function kioskRowToObj(r) {
  const obj = {
    id: r.id, companyId: r.company_id, updatedAt: r.updated_at,
    customFields: Array.isArray(r.custom_fields) ? r.custom_fields : [],
  };
  for (const [key, col] of Object.entries(KIOSK_FIELD_MAP)) obj[key] = r[col] ?? '';
  return obj;
}

function kioskFieldsToRow(fields) {
  const row = {};
  for (const [key, col] of Object.entries(KIOSK_FIELD_MAP)) {
    if (fields[key] !== undefined) row[col] = fields[key] === '' ? null : fields[key];
  }
  if (fields.customFields !== undefined) row.custom_fields = fields.customFields;
  return row;
}

const KIOSK_SETUP_ERROR = 'This needs a one-time database setup (run migration-024.sql in Supabase).';
const isKioskMissing = (error) => /kiosk_details|does not exist|could not find|schema cache/i.test(error?.message || '');

/** Any company role (own company) or an owner (read-only, drilled-in company). */
export async function listKioskDetails(companyId) {
  const me = await getCurrentUser();
  const cid = vaultReadCompanyId(me, companyId, [ROLES.MASTER, ROLES.MANAGER, ROLES.STAFF]);
  if (!cid) return { ok: false, error: 'Not authorised.', rows: [] };
  const { data, error } = await supabase.from('kiosk_details').select('*')
    .eq('company_id', cid).order('created_at', { ascending: false });
  if (error) return { ok: false, error: isKioskMissing(error) ? KIOSK_SETUP_ERROR : friendly(error), rows: [] };
  return { ok: true, rows: (data || []).map(kioskRowToObj) };
}

/** Any signed-in role: create a kiosk record for their own company. Only `name` is required. */
export async function createKioskDetail(fields) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not authorised.' };
  if (!fields.name || !fields.name.trim()) return { ok: false, error: 'Record name is required.' };
  fields.name = fields.name.trim();
  const row = { ...kioskFieldsToRow(fields), company_id: me.companyId };
  const { data, error } = await supabase.from('kiosk_details').insert(row).select().single();
  if (error) return { ok: false, error: isKioskMissing(error) ? KIOSK_SETUP_ERROR : friendly(error) };
  return { ok: true, row: kioskRowToObj(data) };
}

/** Any signed-in role: edit a kiosk record. Pass only the fields that changed. */
export async function updateKioskDetail(id, fields) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not authorised.' };
  if (fields.name !== undefined && (!fields.name || !fields.name.trim())) return { ok: false, error: 'Record name is required.' };
  if (fields.name !== undefined) fields.name = fields.name.trim();
  const row = { ...kioskFieldsToRow(fields), updated_at: new Date().toISOString() };
  const { error } = await supabase.from('kiosk_details').update(row).eq('id', id);
  if (error) return { ok: false, error: isKioskMissing(error) ? KIOSK_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

/** Any signed-in role: permanently delete a kiosk record. */
export async function deleteKioskDetail(id) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.from('kiosk_details').delete().eq('id', id);
  if (error) return { ok: false, error: isKioskMissing(error) ? KIOSK_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

// ---- blacklist members (shared across companies in the same country) -------
/*
 * The one table in this app that is NOT walled off per company (migration-027):
 * every company in a country reads and writes one shared pool of problem
 * customers. Append-only — there is no update or delete policy on the table at
 * all, so entries can't be quietly edited or erased by whoever added them.
 *
 * Country comes from the phone number where it can be recognised (04/61 =
 * Australia, 60 = Malaysia), otherwise from the adding company. RLS then
 * refuses anything that doesn't match the adder's own country, so a wrong guess
 * fails loudly at the database rather than landing in another country's list.
 */

const BLACKLIST_SETUP_ERROR = 'This needs a one-time database setup (run migration-027.sql in Supabase).';
const isBlacklistMissing = (error) => /blacklist_members|my_country|country|does not exist|could not find|schema cache/i.test(error?.message || '');

function blacklistRowToObj(r) {
  return {
    id: r.id,
    country: r.country || '',
    name: r.name || '',
    phone: r.phone || '',
    phoneDigits: r.phone_digits || '',
    payid: r.payid || '',
    bsb: r.bsb || '',
    accountNo: r.account_no || '',
    reason: r.reason || '',
    addedByCompany: r.added_by_company || '',
    addedByName: r.added_by_name || '',
    createdAt: r.created_at,
  };
}

// Supabase caps a single select at 1000 rows (db.max_rows), silently — you get
// 1000 back with no error. The shared list is already over 3000, so it MUST be
// paged or the tail is invisible; worse, the transaction warning would quietly
// stop flagging anyone past the first 1000, which is a safety feature failing
// without a symptom. Explicit column list rather than '*' to keep the payload
// down, since the whole list is pulled for the warning index.
const BLACKLIST_PAGE = 1000;
const BLACKLIST_COLUMNS =
  'id, country, name, phone, phone_digits, payid, bsb, account_no, reason, added_by_company, added_by_name, created_at';

/** Anyone signed in at a company: the whole shared list for their country. */
export async function listBlacklistMembers() {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not authorised.', rows: [] };
  const rows = [];
  for (let from = 0; ; from += BLACKLIST_PAGE) {
    // RLS already restricts this to the caller's country — no client-side
    // filter needed, and none wanted: a filter here would be a suggestion, the
    // policy is the actual boundary.
    const { data, error } = await supabase.from('blacklist_members')
      .select(BLACKLIST_COLUMNS)
      .order('created_at', { ascending: false })
      .range(from, from + BLACKLIST_PAGE - 1);
    if (error) return { ok: false, error: isBlacklistMissing(error) ? BLACKLIST_SETUP_ERROR : friendly(error), rows: [] };
    rows.push(...(data || []));
    if (!data || data.length < BLACKLIST_PAGE) break;
  }
  return { ok: true, rows: rows.map(blacklistRowToObj) };
}

/*
 * migration-029 makes PayID and BSB+account unique per country, so the same
 * payment details can't be listed twice. Postgres reports that as a bare
 * "duplicate key value violates unique constraint ..." naming the index, which
 * means nothing to the person filling in the form — translate it into the field
 * they need to look at. Name and phone are deliberately NOT unique (one person
 * uses several aliases and numbers), so there is nothing to translate for those.
 */
function blacklistDuplicateError(error) {
  const m = error?.message || String(error || '');
  if (!/duplicate key|unique constraint/i.test(m)) return null;
  if (/blacklist_members_payid_uniq/i.test(m)) {
    return 'That PayID is already on the blacklist — search the list for it to see the existing entry.';
  }
  if (/blacklist_members_account_uniq/i.test(m)) {
    return 'That BSB and account number are already on the blacklist — search the list for the account number to see the existing entry.';
  }
  return null;
}

/**
 * Any company role (staff included) may add. `country` is resolved by the
 * caller; the database independently re-checks it against the adder's own
 * company, so this is convenience, not the security boundary.
 */
export async function addBlacklistMember(fields) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not authorised.' };
  if (!me.companyId) return { ok: false, error: 'Only a company account can add to the blacklist.' };
  if (!fields.name || !fields.name.trim()) return { ok: false, error: 'Name is required.' };
  const row = {
    country: fields.country || null,
    name: fields.name.trim(),
    phone: fields.phone || null,
    phone_digits: fields.phoneDigits || null,
    payid: fields.payid || null,
    bsb: fields.bsb || null,
    account_no: fields.accountNo || null,
    reason: fields.reason || null,
    added_by_company_id: me.companyId,
    added_by_company: fields.companyName || null,
    added_by_user_id: me.id,
    added_by_name: me.name || me.operatorId || null,
  };
  const { data, error } = await supabase.from('blacklist_members').insert(row).select().single();
  if (error) {
    if (isBlacklistMissing(error)) return { ok: false, error: BLACKLIST_SETUP_ERROR };
    const dup = blacklistDuplicateError(error);
    // Must be checked BEFORE friendly(), which maps any "duplicate key" to
    // "That email is already in use." — true for the signup path it was written
    // for, nonsense here.
    if (dup) return { ok: false, error: dup };
    return { ok: false, error: friendly(error) };
  }
  return { ok: true, row: blacklistRowToObj(data) };
}

/**
 * MASTER only: withdraw a blacklist entry. Deletes, never edits — the table has
 * no update policy, so what an entry says about someone can't be rewritten,
 * only removed. RLS re-checks the role and the country, so this client-side
 * check is convenience rather than the boundary.
 */
export async function deleteBlacklistMember(id) {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'Not authorised.' };
  if (me.role !== ROLES.MASTER) return { ok: false, error: 'Only a master can remove a blacklist entry.' };
  const { error } = await supabase.from('blacklist_members').delete().eq('id', id);
  if (error) return { ok: false, error: isBlacklistMissing(error) ? BLACKLIST_SETUP_ERROR : friendly(error) };
  return { ok: true };
}
