import { useState } from 'react';
import {
  listCompaniesWithMasters,
  provisionCompany,
  providerResetPassword,
  providerAddMaster,
  deleteCompany,
  changeOwnPassword,
} from '../lib/auth.js';

/*
 * Provider — the distributor's backend (super-admin).
 * Create companies + their master account, and reset any master's password.
 * Providers are not part of any company and never see company app data.
 */
export default function Provider({ ctx, onLogout }) {
  const { user } = ctx;
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  return (
    <div style={styles.page}>
      <header style={styles.topbar}>
        <div style={styles.brand}>
          <div style={styles.logo}><i className="ti ti-shield-lock" aria-hidden="true" /></div>
          <div>
            <div style={styles.title}>Provider Admin</div>
            <div style={styles.sub}>Manage tenant companies &amp; master accounts</div>
          </div>
        </div>
        <div style={styles.userBox}>
          <span className="badge badge-provider"><i className="ti ti-shield-lock" aria-hidden="true" /> Provider</span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{user.name}</div>
            <div style={styles.sub}>{user.email}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            <i className="ti ti-logout" aria-hidden="true" /> Log out
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.grid}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <CreateCompany onCreated={refresh} />
            <ChangePasswordCard user={user} />
          </div>
          <CompaniesPanel key={tick} onChanged={refresh} />
        </div>
      </main>
    </div>
  );
}

function CreateCompany({ onCreated }) {
  const blank = { companyName: '', masterName: '', masterEmail: '', password: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  function submit(e) {
    e.preventDefault();
    setError(''); setOk('');
    const res = provisionCompany(form);
    if (!res.ok) return setError(res.error);
    setOk(`Created "${res.company.name}" with master ${res.user.operatorId}.`);
    setForm(blank);
    onCreated?.();
  }

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-building-plus" aria-hidden="true" /> New company</h3>
      <p style={styles.cardSub}>Creates the company and its master account.</p>
      <form onSubmit={submit}>
        <div className="field"><label>Company name</label>
          <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Acme Pty Ltd" /></div>
        <div className="field"><label>Master name</label>
          <input value={form.masterName} onChange={(e) => setForm({ ...form, masterName: e.target.value })} placeholder="Jane Smith" /></div>
        <div className="field"><label>Master email</label>
          <input type="email" value={form.masterEmail} onChange={(e) => setForm({ ...form, masterEmail: e.target.value })} placeholder="jane@acme.com" /></div>
        <div className="field"><label>Temporary password</label>
          <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥ 6 characters" /></div>
        {error && <div className="error-text">{error}</div>}
        {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 6 }}>
          <i className="ti ti-plus" aria-hidden="true" /> Create company
        </button>
      </form>
    </section>
  );
}

function CompaniesPanel({ onChanged }) {
  const companies = listCompaniesWithMasters();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = q
    ? companies.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.masters.some((m) => m.email.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      )
    : companies;

  return (
    <section style={styles.card}>
      <div style={styles.companiesHead}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>
          <i className="ti ti-building" aria-hidden="true" /> Companies ({companies.length})
        </h3>
        <div style={styles.searchWrap}>
          <i className="ti ti-search" aria-hidden="true" style={styles.searchIcon} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company or master…"
            style={styles.searchInput}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} style={styles.searchClear} aria-label="Clear search">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {companies.length === 0 && <p style={styles.cardSub}>No companies yet — create one on the left.</p>}
      {companies.length > 0 && filtered.length === 0 && (
        <p style={styles.cardSub}>No companies match “{query}”.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map((c) => (
          <CompanyCard key={c.id} company={c} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function CompanyCard({ company, onChanged }) {
  const [resettingId, setResettingId] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '' });
  const [showDelete, setShowDelete] = useState(false);

  function doReset(e, userId) {
    e.preventDefault();
    setError(''); setOk('');
    const res = providerResetPassword(userId, newPw);
    if (!res.ok) return setError(res.error);
    setOk('Master password reset.');
    setResettingId(null); setNewPw('');
    onChanged?.();
  }

  function doAddMaster(e) {
    e.preventDefault();
    setError(''); setOk('');
    const res = providerAddMaster({ companyId: company.id, ...addForm });
    if (!res.ok) return setError(res.error);
    setOk(`Added master ${res.user.operatorId}.`);
    setAdding(false); setAddForm({ name: '', email: '', password: '' });
    onChanged?.();
  }

  return (
    <div style={styles.companyCard}>
      <div style={styles.companyHead}>
        <div>
          <div style={styles.companyName}>{company.name}</div>
          <div style={styles.sub}>{company.managerCount} manager(s) · {company.staffCount} staff</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setAdding((a) => !a); setError(''); setOk(''); }}>
            <i className="ti ti-user-plus" aria-hidden="true" /> Add master
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => setShowDelete(true)}>
            <i className="ti ti-trash" aria-hidden="true" /> Delete
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {company.masters.length === 0 && <div style={styles.sub}>No master account.</div>}
        {company.masters.map((m) => (
          <div key={m.id} style={styles.masterRow}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {m.name} <span className="badge badge-master" style={{ marginLeft: 4 }}>Master</span>
                {!m.active && <span className="badge badge-off" style={{ marginLeft: 4 }}>Disabled</span>}
              </div>
              <div style={styles.sub}>{m.operatorId} · {m.email}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setResettingId(resettingId === m.id ? null : m.id); setNewPw(''); setError(''); }}>
              <i className="ti ti-key" aria-hidden="true" /> Reset password
            </button>
            {resettingId === m.id && (
              <form onSubmit={(e) => doReset(e, m.id)} style={styles.resetRow}>
                <input type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)}
                  placeholder={`New password for ${m.operatorId}`} style={{ flex: 1 }} />
                <button type="submit" className="btn btn-primary btn-sm">Set</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setResettingId(null); setNewPw(''); }}>Cancel</button>
              </form>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <form onSubmit={doAddMaster} style={styles.addBox}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input placeholder="Name" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
            <input type="email" placeholder="Email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
            <input type="text" placeholder="Temp password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} style={{ gridColumn: '1 / -1' }} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>
            <i className="ti ti-check" aria-hidden="true" /> Add master
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}
      {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}

      {showDelete && (
        <DeleteCompanyModal
          company={company}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { setShowDelete(false); onChanged?.(); }}
        />
      )}
    </div>
  );
}

/* Two-step delete: warning confirmation, then re-enter provider password. */
function DeleteCompanyModal({ company, onClose, onDeleted }) {
  const [step, setStep] = useState(1);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function confirmDelete(e) {
    e.preventDefault();
    setError('');
    const res = deleteCompany(company.id, password);
    if (!res.ok) return setError(res.error);
    onDeleted();
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <div style={styles.modalTitle}>
            <i className="ti ti-alert-triangle" aria-hidden="true" style={{ color: 'var(--danger)' }} /> Delete company
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close"><i className="ti ti-x" aria-hidden="true" /></button>
        </div>

        {step === 1 ? (
          <div style={styles.modalBody}>
            <p style={styles.modalText}>
              You are about to permanently delete <strong>{company.name}</strong>.
            </p>
            <ul style={styles.warnList}>
              <li>All {company.masters.length} master, {company.managerCount} manager &amp; {company.staffCount} staff accounts</li>
              <li>All of the company's financial data (banks, members, transactions)</li>
            </ul>
            <p style={{ ...styles.modalText, color: 'var(--danger)', fontWeight: 600 }}>
              This cannot be undone.
            </p>
            <div style={styles.modalActions}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { setStep(2); setError(''); }}>
                <i className="ti ti-arrow-right" aria-hidden="true" /> Continue
              </button>
            </div>
          </div>
        ) : (
          <form style={styles.modalBody} onSubmit={confirmDelete}>
            <p style={styles.modalText}>
              Final step — enter <strong>your provider password</strong> to permanently delete
              <strong> {company.name}</strong>.
            </p>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
            {error && <div className="error-text">{error}</div>}
            <div style={styles.modalActions}>
              <button type="button" className="btn btn-ghost" onClick={() => { setStep(1); setPassword(''); setError(''); }}>Back</button>
              <button type="submit" className="btn btn-danger" disabled={!password}>
                <i className="ti ti-trash" aria-hidden="true" /> Delete permanently
              </button>
            </div>
          </form>
        )}
      </div>
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
  title: { fontSize: 16, fontWeight: 600 },
  sub: { fontSize: 12, color: 'var(--muted)' },
  userBox: { display: 'flex', alignItems: 'center', gap: 12 },
  main: { flex: 1, width: '100%', maxWidth: 1040, margin: '0 auto', padding: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 20, alignItems: 'start' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' },
  cardTitle: { fontSize: 15, fontWeight: 600, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 },
  cardSub: { fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px' },
  companiesHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, flexWrap: 'wrap', marginBottom: 14,
  },
  searchWrap: { position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 220px', maxWidth: 320 },
  searchIcon: { position: 'absolute', left: 11, fontSize: 15, color: 'var(--muted)', pointerEvents: 'none' },
  searchInput: { width: '100%', padding: '8px 30px 8px 32px' },
  searchClear: {
    position: 'absolute', right: 6, background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--muted)', fontSize: 15, display: 'flex', padding: 4,
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
  },
  modal: {
    width: '100%', maxWidth: 440, background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 14, boxShadow: 'var(--shadow)', overflow: 'hidden',
  },
  modalHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--header)',
  },
  modalTitle: { fontSize: 15.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  modalBody: { padding: '18px', display: 'flex', flexDirection: 'column', gap: 12 },
  modalText: { fontSize: 13.5, lineHeight: 1.55, margin: 0, color: 'var(--text)' },
  warnList: { fontSize: 13, color: 'var(--muted)', margin: 0, paddingLeft: 18, lineHeight: 1.6 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  companyCard: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 11, padding: '12px 14px' },
  companyHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  companyName: { fontSize: 14.5, fontWeight: 600 },
  masterRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
    padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9,
  },
  resetRow: { display: 'flex', gap: 8, width: '100%', marginTop: 4 },
  addBox: { marginTop: 10, padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9 },
};
