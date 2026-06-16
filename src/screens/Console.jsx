import { useState } from 'react';
import {
  ROLES,
  listTeam,
  createAccount,
  changeRole,
  setActive,
  removeAccount,
  adminResetPassword,
  changeOwnPassword,
  creatableRoles,
  canActOn,
} from '../lib/auth.js';

/*
 * Console — landing page for master & manager accounts.
 *   • Launch the FinTrack app, change your own password, log out.
 *   • Team panel: create staff (manager) or manager+staff (master) accounts and
 *     manage the ones you're allowed to.
 * Staff never see this page — they go straight into the app.
 */
const ROLE_LABEL = { master: 'Master', manager: 'Manager', staff: 'Staff' };

export default function Console({ ctx, onOpenApp, onLogout }) {
  const { company, user } = ctx;
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const roleClass = user.role === ROLES.MASTER ? 'badge-master' : 'badge-manager';

  return (
    <div style={styles.page}>
      <header style={styles.topbar}>
        <div style={styles.brand}>
          <div style={styles.logo}><i className="ti ti-building-bank" aria-hidden="true" /></div>
          <div>
            <div style={styles.company}>{company.name}</div>
            <div style={styles.sub}>Company console</div>
          </div>
        </div>
        <div style={styles.userBox}>
          <span className={`badge ${roleClass}`}>
            <i className={`ti ti-${user.role === ROLES.MASTER ? 'shield-check' : 'user-star'}`} aria-hidden="true" />
            {ROLE_LABEL[user.role]}
          </span>
          <div style={styles.userMeta}>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.sub}>{user.operatorId} · {user.email}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            <i className="ti ti-logout" aria-hidden="true" /> Log out
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <section style={styles.launchCard} onClick={onOpenApp} role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' ? onOpenApp() : null)}>
          <div style={styles.launchIcon}><i className="ti ti-wallet" aria-hidden="true" /></div>
          <div style={{ flex: 1 }}>
            <div style={styles.launchTitle}>Open Financial App</div>
            <div style={styles.sub}>
              Deposits, withdrawals, banks, members &amp; reports — scoped to {company.name}.
            </div>
          </div>
          <button className="btn btn-primary">Open <i className="ti ti-arrow-right" aria-hidden="true" /></button>
        </section>

        <div style={styles.grid}>
          <ChangePasswordCard user={user} />
          <TeamPanel key={tick} currentUser={user} company={company} onChanged={refresh} />
        </div>
      </main>
    </div>
  );
}

function ChangePasswordCard({ user }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  function submit(e) {
    e.preventDefault();
    setError(''); setOk('');
    if (next !== confirm) return setError('New passwords do not match.');
    const res = changeOwnPassword(user.id, cur, next);
    if (!res.ok) return setError(res.error);
    setOk('Password updated.');
    setCur(''); setNext(''); setConfirm('');
  }

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-key" aria-hidden="true" /> Your password</h3>
      <form onSubmit={submit}>
        <div className="field"><label>Current password</label>
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="••••••••" /></div>
        <div className="field"><label>New password</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 6 characters" /></div>
        <div className="field"><label>Confirm new password</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter new password" /></div>
        {error && <div className="error-text">{error}</div>}
        {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
        <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 6 }}>
          <i className="ti ti-check" aria-hidden="true" /> Update password
        </button>
      </form>
    </section>
  );
}

function TeamPanel({ currentUser, company, onChanged }) {
  const team = listTeam(company.id);
  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-users-group" aria-hidden="true" /> Team &amp; accounts</h3>
      <p style={styles.cardSub}>Create and manage accounts for {company.name}.</p>
      <CreateAccountForm currentUser={currentUser} onCreated={onChanged} />
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {team.map((m) => (
          <AccountRow key={m.id} account={m} currentUser={currentUser} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function CreateAccountForm({ currentUser, onCreated }) {
  const roles = creatableRoles(currentUser.role); // master -> [manager,staff], manager -> [staff]
  const blank = { name: '', email: '', password: '', role: roles[roles.length - 1] || ROLES.STAFF };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  function submit(e) {
    e.preventDefault();
    setError(''); setOk('');
    const res = createAccount(form);
    if (!res.ok) return setError(res.error);
    setOk(`Created ${res.user.operatorId} (${ROLE_LABEL[res.user.role]}).`);
    setForm({ ...blank });
    onCreated?.();
  }

  return (
    <form onSubmit={submit} style={styles.createBox}>
      <div style={styles.createGrid}>
        <div className="field" style={{ margin: 0 }}><label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></div>
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
      <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>
        <i className="ti ti-user-plus" aria-hidden="true" /> Add account
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
  const [resetting, setResetting] = useState(false);
  const [newPw, setNewPw] = useState('');
  const isSelf = account.id === currentUser.id;
  const manageable = canActOn(currentUser, account);
  const canToggleRole = currentUser.role === ROLES.MASTER && manageable; // master toggles manager<->staff

  function act(result) {
    if (!result.ok) setError(result.error);
    else { setError(''); onChanged?.(); }
  }

  function doReset(e) {
    e.preventDefault();
    const res = adminResetPassword(account.id, newPw);
    if (!res.ok) return setError(res.error);
    setError(''); setResetting(false); setNewPw('');
  }

  return (
    <div style={styles.row}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={styles.avatar}>{account.operatorId.replace(/\D/g, '').slice(-2) || '?'}</div>
        <div style={{ minWidth: 0 }}>
          <div style={styles.rowName}>
            {account.name}{isSelf && <span style={styles.youTag}>you</span>}
          </div>
          <div style={styles.sub}>{account.operatorId} · {account.email}</div>
        </div>
      </div>

      <div style={styles.rowActions}>
        <span className={`badge ${roleBadgeClass(account.role, account.active)}`}>
          {!account.active ? 'Disabled' : ROLE_LABEL[account.role]}
        </span>

        {manageable && (
          <>
            {canToggleRole && (
              <button className="btn btn-ghost btn-sm" title="Toggle role"
                onClick={() => act(changeRole(account.id, account.role === ROLES.STAFF ? ROLES.MANAGER : ROLES.STAFF))}>
                <i className="ti ti-arrows-exchange" aria-hidden="true" />
                {account.role === ROLES.STAFF ? 'Make manager' : 'Make staff'}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" title="Enable / disable"
              onClick={() => act(setActive(account.id, !account.active))}>
              <i className={`ti ti-${account.active ? 'lock' : 'lock-open'}`} aria-hidden="true" />
              {account.active ? 'Disable' : 'Enable'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setResetting((r) => !r)}>
              <i className="ti ti-key" aria-hidden="true" /> Reset pw
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => act(removeAccount(account.id))}>
              <i className="ti ti-trash" aria-hidden="true" /> Delete
            </button>
          </>
        )}
      </div>

      {resetting && (
        <form onSubmit={doReset} style={styles.resetRow}>
          <input type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)}
            placeholder={`New password for ${account.operatorId}`} style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary btn-sm">Set</button>
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
};
