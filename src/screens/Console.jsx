import { useEffect, useState } from 'react';
import {
  ROLES,
  listTeam,
  createAccount,
  changeRole,
  setActive,
  removeAccount,
  adminResetPassword,
  updateAccountInfo,
  setOwnCompanyTimezone,
  setOwnCompanyLogo,
  creatableRoles,
  canActOn,
} from '../lib/auth.js';
import { TIMEZONES, DEFAULT_TIMEZONE, tzLabel } from '../lib/timezones.js';
import AccountMenu from '../components/AccountMenu.jsx';
import LogoManager from '../components/LogoManager.jsx';

/*
 * Console — landing page for master & manager accounts.
 *   • Launch the FinTrack app, change your own password, log out.
 *   • Team panel: create staff (manager) or manager+staff (master) accounts and
 *     manage the ones you're allowed to.
 * Staff never see this page — they go straight into the app.
 *
 * Passwords are self-service: there is no "reset someone else's password". A new
 * account gets a temp password at creation; the user changes it themselves.
 */
const ROLE_LABEL = { master: 'Master', manager: 'Manager', staff: 'Staff' };

export default function Console({ ctx, onOpenApp, onLogout }) {
  const { company, user } = ctx;
  const [team, setTeam] = useState(null);
  const roleClass = user.role === ROLES.MASTER ? 'badge-master' : 'badge-manager';

  async function refresh() { setTeam(await listTeam(company.id)); }
  useEffect(() => { refresh(); }, []);

  return (
    <div style={styles.page}>
      <header style={styles.topbar}>
        <div style={styles.brand}>
          {company.logo ? (
            <img src={company.logo} alt={company.name} title={company.name} style={styles.brandLogo} />
          ) : (
            <div style={styles.logo}><i className="ti ti-building-bank" aria-hidden="true" /></div>
          )}
          <div>
            {!company.logo && <div style={styles.company}>{company.name}</div>}
            <div style={styles.sub}>Company console</div>
          </div>
        </div>
        <div style={styles.userBox}>
          <span className={`badge ${roleClass}`}>
            <i className={`ti ti-${user.role === ROLES.MASTER ? 'shield-check' : 'user-star'}`} aria-hidden="true" />
            {ROLE_LABEL[user.role]}
          </span>
          <AccountMenu user={user} roleLabel={ROLE_LABEL[user.role]} onLogout={onLogout} />
        </div>
      </header>

      <main style={styles.main}>
        <section style={styles.launchCard} onClick={onOpenApp} role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' ? onOpenApp() : null)}>
          <div style={styles.launchIcon}><i className="ti ti-wallet" aria-hidden="true" /></div>
          <div style={{ flex: 1 }}>
            <div style={styles.launchTitle}>Open Financial App</div>
            <div style={styles.sub}>Deposits, withdrawals, banks, members &amp; reports — scoped to {company.name}.</div>
          </div>
          <button className="btn btn-primary">Open <i className="ti ti-arrow-right" aria-hidden="true" /></button>
        </section>

        {user.role === ROLES.MASTER && <CompanyLogo company={company} />}
        {user.role === ROLES.MASTER && <CompanyTimezone company={company} />}

        <section style={styles.card}>
          <h3 style={styles.cardTitle}><i className="ti ti-users-group" aria-hidden="true" /> Team &amp; accounts</h3>
          <p style={styles.cardSub}>Create and manage accounts for {company.name}.</p>
          <CreateAccountForm currentUser={user} onCreated={refresh} />
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {team === null && <p style={styles.cardSub}>Loading…</p>}
            {team && team.map((m) => (
              <AccountRow key={m.id} account={m} currentUser={user} onChanged={refresh} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function CompanyLogo({ company }) {
  // After saving, reload so the new logo flows into the console header and the
  // app session (which is read when the app is opened).
  async function save(res) {
    if (res.ok) setTimeout(() => window.location.reload(), 900);
    return res;
  }
  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-photo" aria-hidden="true" /> Company logo</h3>
      <p style={styles.cardSub}>Upload a logo to show instead of “{company.name}” in the app sidebar, top bar and this console. Leave it empty to keep showing the name.</p>
      <LogoManager
        currentLogo={company.logo || ''}
        note="PNG with a transparent background works best. The page reloads after saving so the new logo appears everywhere."
        onSave={async (dataUrl) => save(await setOwnCompanyLogo(dataUrl))}
        onRemove={async () => save(await setOwnCompanyLogo(null))}
      />
    </section>
  );
}

function CompanyTimezone({ company }) {
  const [tz, setTz] = useState(company.timezone || DEFAULT_TIMEZONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const changed = tz !== (company.timezone || DEFAULT_TIMEZONE);

  async function save() {
    setError(''); setOk(''); setBusy(true);
    const res = await setOwnCompanyTimezone(tz);
    if (!res.ok) { setBusy(false); return setError(res.error); }
    setOk('Time zone updated — reloading…');
    setTimeout(() => window.location.reload(), 900);
  }

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-clock-hour-4" aria-hidden="true" /> Company time zone</h3>
      <p style={styles.cardSub}>Transactions for {company.name} are stamped with this clock. Currently: <strong>{tzLabel(company.timezone)}</strong>.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tz} onChange={(e) => setTz(e.target.value)} style={{ flex: '1 1 260px', maxWidth: 380 }}>
          {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!changed || busy}>
          <i className={`ti ti-${busy ? 'loader-2' : 'check'}`} aria-hidden="true" /> {busy ? 'Saving…' : 'Save time zone'}
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
      {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
    </section>
  );
}

function CreateAccountForm({ currentUser, onCreated }) {
  const roles = creatableRoles(currentUser.role);
  const blank = { name: '', email: '', password: '', role: roles[roles.length - 1] || ROLES.STAFF };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const res = await createAccount(form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk(`Created ${res.user.operatorId} (${ROLE_LABEL[res.user.role]}).`);
    setForm({ ...blank });
    onCreated?.();
  }

  return (
    <form onSubmit={submit} style={styles.createBox}>
      <div style={styles.createGrid}>
        <div className="field" style={{ margin: 0 }}><label>Name / ID</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mario (login)" /></div>
        <div className="field" style={{ margin: 0 }}><label>Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" /></div>
        <div className="field" style={{ margin: 0 }}><label>Temp password</label>
          <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥ 6 chars" /></div>
        <div className="field" style={{ margin: 0 }}><label>Role</label>
          {roles.length > 1 ? (
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          ) : (
            <input value={ROLE_LABEL[roles[0]] || 'Staff'} disabled />
          )}
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
      <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={busy}>
        <i className={`ti ti-${busy ? 'loader-2' : 'user-plus'}`} aria-hidden="true" /> {busy ? 'Adding…' : 'Add account'}
      </button>
    </form>
  );
}

function roleBadgeClass(role, active) {
  if (!active) return 'badge-off';
  if (role === ROLES.MASTER) return 'badge-master';
  if (role === ROLES.MANAGER) return 'badge-manager';
  return 'badge-staff';
}

function AccountRow({ account, currentUser, onChanged }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '' });
  const isSelf = account.id === currentUser.id;
  const manageable = canActOn(currentUser, account);
  const canToggleRole = currentUser.role === ROLES.MASTER && manageable;

  async function act(fn) {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (!result.ok) setError(result.error);
    else { setError(''); onChanged?.(); }
  }

  async function doReset(e) {
    e.preventDefault();
    setBusy(true);
    const res = await adminResetPassword(account.id, newPw);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(''); setResetting(false); setNewPw('');
  }

  function startEdit() {
    setEditing(true);
    setDraft({ name: account.name, email: account.email || '' });
    setResetting(false);
    setError('');
  }

  async function doSaveEdit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    const nameChanged = draft.name.trim() !== (account.name || '');
    const emailChanged = draft.email.trim() !== (account.email || '');
    if (!nameChanged && !emailChanged) { setBusy(false); setEditing(false); return; }
    const payload = {};
    if (nameChanged) payload.name = draft.name;
    if (emailChanged) payload.email = draft.email;
    const res = await updateAccountInfo(account.id, payload);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setEditing(false); onChanged?.();
  }

  return (
    <div style={styles.row}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={styles.avatar}>{(account.operatorId || '').replace(/\D/g, '').slice(-2) || '?'}</div>
        <div style={{ minWidth: 0 }}>
          <div style={styles.rowName}>{account.name}{isSelf && <span style={styles.youTag}>you</span>}</div>
          <div style={styles.sub}>{account.operatorId} · {account.email}</div>
        </div>
      </div>

      <div style={styles.rowActions}>
        <span className={`badge ${roleBadgeClass(account.role, account.active)}`}>
          {!account.active ? 'Disabled' : ROLE_LABEL[account.role]}
        </span>

        {manageable && (
          <>
            <button className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => (editing ? setEditing(false) : startEdit())}>
              <i className="ti ti-pencil" aria-hidden="true" /> Edit
            </button>
            {canToggleRole && (
              <button className="btn btn-ghost btn-sm" disabled={busy}
                onClick={() => act(() => changeRole(account.id, account.role === ROLES.STAFF ? ROLES.MANAGER : ROLES.STAFF))}>
                <i className="ti ti-arrows-exchange" aria-hidden="true" />
                {account.role === ROLES.STAFF ? 'Make manager' : 'Make staff'}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => act(() => setActive(account.id, !account.active))}>
              <i className={`ti ti-${account.active ? 'lock' : 'lock-open'}`} aria-hidden="true" />
              {account.active ? 'Disable' : 'Enable'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setResetting((r) => !r); setNewPw(''); setEditing(false); }}>
              <i className="ti ti-key" aria-hidden="true" /> Reset pw
            </button>
            <button className="btn btn-danger btn-sm" disabled={busy}
              onClick={() => act(() => removeAccount(account.id))}>
              <i className="ti ti-trash" aria-hidden="true" /> Delete
            </button>
          </>
        )}
      </div>

      {editing && (
        <form onSubmit={doSaveEdit} style={styles.editBox}>
          <div className="field" style={{ margin: 0 }}>
            <label>Name / ID (used for login)</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Mario" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Login email</label>
            <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@company.com" />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              <i className={`ti ti-${busy ? 'loader-2' : 'check'}`} aria-hidden="true" /> {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}

      {resetting && (
        <form onSubmit={doReset} style={styles.resetRow}>
          <input type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)}
            placeholder={`New password for ${account.operatorId}`} style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!newPw || busy}>Set</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setResetting(false); setNewPw(''); }}>Cancel</button>
        </form>
      )}
      {error && <div className="error-text" style={{ width: '100%' }}>{error}</div>}
    </div>
  );
}

const styles = {
  page: { minHeight: '100%', display: 'flex', flexDirection: 'column' },
  topbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
    padding: '14px 24px', background: 'var(--header)', borderBottom: '1px solid var(--border)',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12 },
  logo: {
    width: 40, height: 40, borderRadius: 11, background: 'var(--accent)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0,
  },
  company: { fontSize: 16, fontWeight: 600 },
  brandLogo: { height: 40, maxWidth: 200, objectFit: 'contain', borderRadius: 8 },
  sub: { fontSize: 12, color: 'var(--muted)' },
  userBox: { display: 'flex', alignItems: 'center', gap: 12 },
  userMeta: { textAlign: 'right' },
  userName: { fontSize: 13.5, fontWeight: 500 },
  main: { flex: 1, width: '100%', maxWidth: 1000, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 },
  launchCard: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '20px 22px', cursor: 'pointer',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)',
  },
  launchIcon: {
    width: 52, height: 52, borderRadius: 13, flexShrink: 0, fontSize: 26,
    background: 'var(--accent-bg)', color: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  launchTitle: { fontSize: 17, fontWeight: 600, marginBottom: 3 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)', gap: 20, alignItems: 'start' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' },
  cardTitle: { fontSize: 15, fontWeight: 600, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 },
  cardSub: { fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px' },
  createBox: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, padding: 14 },
  createGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
    padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)',
  },
  avatar: {
    width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', color: '#fff', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
  },
  rowName: { fontSize: 13.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 },
  youTag: { fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 6px', borderRadius: 5 },
  rowActions: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  resetRow: { display: 'flex', gap: 8, width: '100%', marginTop: 4 },
  editBox: { display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border)' },
};
