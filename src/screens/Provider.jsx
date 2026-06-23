import { useEffect, useState } from 'react';
import FluidDropdown from '../components/FluidDropdown.jsx';
import {
  listCompaniesWithMasters,
  provisionCompany,
  providerAddMaster,
  deleteCompany,
  adminResetPassword,
  updateCompany,
  updateAccountInfo,
  setCompanyLogo,
  purgeOrphanLogins,
} from '../lib/auth.js';
import { TIMEZONES, DEFAULT_TIMEZONE, tzLabel } from '../lib/timezones.js';
import AccountMenu from '../components/AccountMenu.jsx';
import LogoManager from '../components/LogoManager.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import useIsMobile from '../lib/useIsMobile.js';

/*
 * Provider — the distributor's backend (super-admin).
 * Create companies (with or without a master), add masters, search, and delete a
 * company (password-confirmed; cascades to its accounts + data).
 * Passwords are self-service: each user changes their own once logged in.
 */
export default function Provider({ ctx, onLogout }) {
  const { user } = ctx;
  const isMobile = useIsMobile();
  const [companies, setCompanies] = useState(null); // null = loading
  const [query, setQuery] = useState('');

  async function refresh() {
    setCompanies(await listCompaniesWithMasters());
  }
  useEffect(() => { refresh(); }, []);

  const q = query.trim().toLowerCase();
  const filtered = !companies ? [] : q
    ? companies.filter(
        (c) => c.name.toLowerCase().includes(q) ||
          c.masters.some((m) => (m.email || '').toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      )
    : companies;

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
          <ThemeToggle />
          <span className="badge badge-provider"><i className="ti ti-shield-lock" aria-hidden="true" /> Provider</span>
          <AccountMenu user={user} roleLabel="Provider" onLogout={onLogout} />
        </div>
      </header>

      <main style={{ ...styles.main, padding: isMobile ? 14 : 24 }}>
        <div style={{ ...styles.grid, gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 340px) minmax(0, 1fr)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <CreateCompany onCreated={refresh} />
            <MaintenanceCard />
          </div>

          <section style={styles.card}>
            <div style={styles.companiesHead}>
              <h3 style={{ ...styles.cardTitle, margin: 0 }}>
                <i className="ti ti-building" aria-hidden="true" /> Companies {companies ? `(${companies.length})` : ''}
              </h3>
              <div style={styles.searchWrap}>
                <i className="ti ti-search" aria-hidden="true" style={styles.searchIcon} />
                <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search company or master…" style={styles.searchInput} />
                {query && (
                  <button type="button" onClick={() => setQuery('')} style={styles.searchClear} aria-label="Clear search">
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            {companies === null && <p style={styles.cardSub}>Loading…</p>}
            {companies && companies.length === 0 && <p style={styles.cardSub}>No companies yet — create one on the left.</p>}
            {companies && companies.length > 0 && filtered.length === 0 && (
              <p style={styles.cardSub}>No companies match “{query}”.</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtered.map((c) => <CompanyCard key={c.id} company={c} onChanged={refresh} />)}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function CreateCompany({ onCreated }) {
  const blank = { companyName: '', masterName: '', masterEmail: '', password: '', timezone: DEFAULT_TIMEZONE };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const res = await provisionCompany(form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk(res.user ? `Created "${res.company.name}" + master ${res.user.operatorId}.` : `Created "${res.company.name}".`);
    setForm(blank);
    onCreated?.();
  }

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-building-plus" aria-hidden="true" /> New company</h3>
      <p style={styles.cardSub}>Master fields are optional — you can add the master later.</p>
      <form onSubmit={submit}>
        <div className="field"><label>Company name</label>
          <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Acme Pty Ltd" /></div>
        <div className="field"><label>Time zone <span style={styles.opt}>(its log follows this)</span></label>
          <FluidDropdown value={form.timezone} ariaLabel="Time zone"
            options={TIMEZONES.map((t) => ({ value: t.value, label: t.label }))}
            onChange={(v) => setForm({ ...form, timezone: v })} /></div>
        <div className="field"><label>Master Name / ID <span style={styles.opt}>(optional)</span></label>
          <input value={form.masterName} onChange={(e) => setForm({ ...form, masterName: e.target.value })} placeholder="e.g. Mario (used for login)" /></div>
        <div className="field"><label>Master email <span style={styles.opt}>(optional)</span></label>
          <input type="email" value={form.masterEmail} onChange={(e) => setForm({ ...form, masterEmail: e.target.value })} placeholder="jane@acme.com" /></div>
        <div className="field"><label>Master temp password <span style={styles.opt}>(optional)</span></label>
          <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥ 6 characters" /></div>
        {error && <div className="error-text">{error}</div>}
        {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
          <i className={`ti ti-${busy ? 'loader-2' : 'plus'}`} aria-hidden="true" /> {busy ? 'Creating…' : 'Create company'}
        </button>
      </form>
    </section>
  );
}

/* One-click cleanup of leftover login emails from already-deleted accounts. */
function MaintenanceCard() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { type:'ok'|'none'|'err', text }

  async function run() {
    setBusy(true); setResult(null);
    const res = await purgeOrphanLogins();
    setBusy(false); setConfirming(false);
    if (!res.ok) {
      setResult({ type: 'err', text: res.error });
      window.showToast?.('Error , Please Try Again', 'error');
      return;
    }
    if (res.count > 0) {
      setResult({ type: 'ok', text: `Cleared ${res.count} freed-up email${res.count === 1 ? '' : 's'}. They can be used again now.` });
      window.showToast?.('Action Done !', 'success');
    } else {
      setResult({ type: 'none', text: 'Nothing to clear — there are no leftover emails right now.' });
    }
  }

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-eraser" aria-hidden="true" /> Maintenance</h3>
      <p style={styles.cardSub}>
        Clear leftover login emails from accounts that were deleted before the auto-free
        update, so those emails &amp; IDs can be registered again. Live accounts are never touched.
      </p>

      {!confirming ? (
        <button type="button" className="btn btn-ghost" style={{ width: '100%' }}
          onClick={() => { setResult(null); setConfirming(true); }} disabled={busy}>
          <i className="ti ti-eraser" aria-hidden="true" /> Clear freed-up emails
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ ...styles.cardSub, margin: 0 }}>This permanently removes leftover logins that have no account attached. Continue?</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={run} disabled={busy}>
              <i className={`ti ti-${busy ? 'loader-2' : 'check'}`} aria-hidden="true" /> {busy ? 'Clearing…' : 'Clear now'}
            </button>
          </div>
        </div>
      )}

      {result?.type === 'ok' && <div className="success-text" style={{ marginTop: 10 }}><i className="ti ti-circle-check" aria-hidden="true" />{result.text}</div>}
      {result?.type === 'none' && <p style={{ ...styles.cardSub, marginTop: 10 }}>{result.text}</p>}
      {result?.type === 'err' && <div className="error-text" style={{ marginTop: 10 }}>{result.text}</div>}
    </section>
  );
}

function CompanyCard({ company, onChanged }) {
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showLogo, setShowLogo] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(company.name);
  const [tzDraft, setTzDraft] = useState(company.timezone || DEFAULT_TIMEZONE);
  const [editingMasterId, setEditingMasterId] = useState(null);
  const [masterDraft, setMasterDraft] = useState({ name: '', email: '' });

  async function doEditCompany(e) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const payload = {};
    if (nameDraft.trim() !== (company.name || '')) payload.name = nameDraft;
    if (tzDraft !== (company.timezone || DEFAULT_TIMEZONE)) payload.timezone = tzDraft;
    if (!Object.keys(payload).length) { setBusy(false); setEditingName(false); return; }
    const res = await updateCompany(company.id, payload);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk('Company updated.');
    setEditingName(false);
    onChanged?.();
  }

  function startEditMaster(m) {
    setEditingMasterId(m.id);
    setMasterDraft({ name: m.name, email: m.email || '' });
    setResettingId(null);
    setError(''); setOk('');
  }

  async function doSaveMaster(e, m) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const nameChanged = masterDraft.name.trim() !== (m.name || '');
    const emailChanged = masterDraft.email.trim() !== (m.email || '');
    if (!nameChanged && !emailChanged) { setBusy(false); setEditingMasterId(null); return; }
    const payload = {};
    if (nameChanged) payload.name = masterDraft.name;
    if (emailChanged) payload.email = masterDraft.email;
    const res = await updateAccountInfo(m.id, payload);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk('Master details updated.');
    setEditingMasterId(null);
    onChanged?.();
  }

  async function doReset(e, userId) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const res = await adminResetPassword(userId, resetPw);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk('Master password reset.');
    setResettingId(null); setResetPw('');
  }

  async function doAddMaster(e) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const res = await providerAddMaster({ companyId: company.id, ...addForm });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk(`Added master ${res.user.operatorId}.`);
    setAdding(false); setAddForm({ name: '', email: '', password: '' });
    onChanged?.();
  }

  return (
    <div style={styles.companyCard}>
      <div style={styles.companyHead}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {editingName ? (
            <form onSubmit={doEditCompany} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Company name" style={{ width: '100%' }} />
              <FluidDropdown value={tzDraft} ariaLabel="Time zone"
                options={TIMEZONES.map((t) => ({ value: t.value, label: t.label }))}
                onChange={(v) => setTzDraft(v)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!nameDraft.trim() || busy}>
                  <i className={`ti ti-${busy ? 'loader-2' : 'check'}`} aria-hidden="true" /> Save
                </button>
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { setEditingName(false); setNameDraft(company.name); setTzDraft(company.timezone || DEFAULT_TIMEZONE); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <div style={styles.companyName}>
                {company.logo && <img src={company.logo} alt="" style={styles.companyLogoThumb} />}
                {company.name}
              </div>
              <div style={styles.sub}>{company.masters.length} master · {company.managerCount} manager · {company.staffCount} staff</div>
              <div style={styles.sub}><i className="ti ti-clock-hour-4" aria-hidden="true" /> {tzLabel(company.timezone)}</div>
            </>
          )}
        </div>
        {!editingName && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditingName(true); setNameDraft(company.name); setTzDraft(company.timezone || DEFAULT_TIMEZONE); setError(''); setOk(''); }}>
              <i className="ti ti-pencil" aria-hidden="true" /> Edit
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowLogo((s) => !s); setError(''); setOk(''); }}>
              <i className="ti ti-photo" aria-hidden="true" /> Logo
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAdding((a) => !a); setError(''); setOk(''); }}>
              <i className="ti ti-user-plus" aria-hidden="true" /> Add master
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => setShowDelete(true)}>
              <i className="ti ti-trash" aria-hidden="true" /> Delete
            </button>
          </div>
        )}
      </div>

      {showLogo && (
        <div style={styles.logoBox}>
          <LogoManager
            currentLogo={company.logo || ''}
            note="Shown instead of the company name in the app sidebar, top bar and console. PNG with a transparent background works best."
            onSave={async (dataUrl) => { const r = await setCompanyLogo(company.id, dataUrl); if (r.ok) onChanged?.(); return r; }}
            onRemove={async () => { const r = await setCompanyLogo(company.id, null); if (r.ok) onChanged?.(); return r; }}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {company.masters.length === 0 && <div style={styles.sub}>No master yet — use “Add master”.</div>}
        {company.masters.map((m) => (
          <div key={m.id} style={styles.masterRow}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {m.name} <span className="badge badge-master" style={{ marginLeft: 4 }}>Master</span>
                {!m.active && <span className="badge badge-off" style={{ marginLeft: 4 }}>Disabled</span>}
              </div>
              <div style={styles.sub}>{m.operatorId} · {m.email}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => (editingMasterId === m.id ? setEditingMasterId(null) : startEditMaster(m))}>
                <i className="ti ti-pencil" aria-hidden="true" /> Edit
              </button>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setResettingId(resettingId === m.id ? null : m.id); setResetPw(''); setEditingMasterId(null); setError(''); }}>
                <i className="ti ti-key" aria-hidden="true" /> Reset password
              </button>
            </div>
            {editingMasterId === m.id && (
              <form onSubmit={(e) => doSaveMaster(e, m)} style={styles.editBox}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Name / ID (used for login)</label>
                  <input value={masterDraft.name} onChange={(e) => setMasterDraft({ ...masterDraft, name: e.target.value })}
                    placeholder="e.g. Mario" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Login email</label>
                  <input type="email" value={masterDraft.email} onChange={(e) => setMasterDraft({ ...masterDraft, email: e.target.value })}
                    placeholder="mario@company.com" />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingMasterId(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                    <i className={`ti ti-${busy ? 'loader-2' : 'check'}`} aria-hidden="true" /> {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            )}
            {resettingId === m.id && (
              <form onSubmit={(e) => doReset(e, m.id)} style={styles.resetRow}>
                <input type="text" value={resetPw} onChange={(e) => setResetPw(e.target.value)}
                  placeholder={`New password for ${m.operatorId}`} style={{ flex: 1 }} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!resetPw || busy}>Set</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setResettingId(null); setResetPw(''); }}>Cancel</button>
              </form>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <form onSubmit={doAddMaster} style={styles.addBox}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
            <input placeholder="Name / ID (login)" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
            <input type="email" placeholder="Email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
            <input type="text" placeholder="Temp password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} style={{ gridColumn: '1 / -1' }} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy}>
            <i className={`ti ti-${busy ? 'loader-2' : 'check'}`} aria-hidden="true" /> {busy ? 'Adding…' : 'Add master'}
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}
      {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}

      {showDelete && (
        <DeleteCompanyModal company={company}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { setShowDelete(false); onChanged?.(); }} />
      )}
    </div>
  );
}

/* Two-step delete: warning, then re-enter provider password. */
function DeleteCompanyModal({ company, onClose, onDeleted }) {
  const [step, setStep] = useState(1);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirmDelete(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    const res = await deleteCompany(company.id, password);
    setBusy(false);
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
            <p style={styles.modalText}>You are about to permanently delete <strong>{company.name}</strong>.</p>
            <ul style={styles.warnList}>
              <li>All {company.masters.length} master, {company.managerCount} manager &amp; {company.staffCount} staff accounts</li>
              <li>All of the company's financial data (banks, members, transactions)</li>
            </ul>
            <p style={{ ...styles.modalText, color: 'var(--danger)', fontWeight: 600 }}>This cannot be undone.</p>
            <div style={styles.modalActions}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { setStep(2); setError(''); }}>
                <i className="ti ti-arrow-right" aria-hidden="true" /> Continue
              </button>
            </div>
          </div>
        ) : (
          <form style={styles.modalBody} onSubmit={confirmDelete}>
            <p style={styles.modalText}>Final step — enter <strong>your provider password</strong> to permanently delete <strong>{company.name}</strong>.</p>
            <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
            {error && <div className="error-text">{error}</div>}
            <div style={styles.modalActions}>
              <button type="button" className="btn btn-ghost" onClick={() => { setStep(1); setPassword(''); setError(''); }}>Back</button>
              <button type="submit" className="btn btn-danger" disabled={!password || busy}>
                <i className={`ti ti-${busy ? 'loader-2' : 'trash'}`} aria-hidden="true" /> {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </form>
        )}
      </div>
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
  title: { fontSize: 16, fontWeight: 600 },
  sub: { fontSize: 12, color: 'var(--muted)' },
  opt: { color: 'var(--muted)', fontWeight: 400 },
  userBox: { display: 'flex', alignItems: 'center', gap: 12 },
  main: { flex: 1, width: '100%', maxWidth: 1040, margin: '0 auto', padding: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 20, alignItems: 'start' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' },
  cardTitle: { fontSize: 15, fontWeight: 600, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 },
  cardSub: { fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px' },
  companiesHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
  searchWrap: { position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 220px', maxWidth: 320 },
  searchIcon: { position: 'absolute', left: 11, fontSize: 15, color: 'var(--muted)', pointerEvents: 'none' },
  searchInput: { width: '100%', padding: '8px 30px 8px 32px' },
  searchClear: { position: 'absolute', right: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 15, display: 'flex', padding: 4 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { width: '100%', maxWidth: 440, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)', overflow: 'hidden' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--header)' },
  modalTitle: { fontSize: 15.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  modalBody: { padding: '18px', display: 'flex', flexDirection: 'column', gap: 12 },
  modalText: { fontSize: 13.5, lineHeight: 1.55, margin: 0, color: 'var(--text)' },
  warnList: { fontSize: 13, color: 'var(--muted)', margin: 0, paddingLeft: 18, lineHeight: 1.6 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  companyCard: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 11, padding: '12px 14px' },
  companyName: { fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  companyLogoThumb: { height: 22, maxWidth: 90, objectFit: 'contain', borderRadius: 4, verticalAlign: 'middle' },
  logoBox: { marginTop: 10, padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9 },
  masterRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9 },
  resetRow: { display: 'flex', gap: 8, width: '100%', marginTop: 4 },
  editBox: { display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border)' },
  nameEditRow: { display: 'flex', gap: 8, alignItems: 'center', width: '100%' },
  addBox: { marginTop: 10, padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9 },
};
