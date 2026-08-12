import { useEffect, useMemo, useState } from 'react';
import FluidDropdown from '../components/FluidDropdown.jsx';
import { useEsc } from '../lib/useEsc.js';
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
  createOwner,
  listOwners,
  setOwnerCompanyLink,
  createProvider,
  listProviders,
  listBillingPayments,
  markRentPaid,
  markRentUnpaid,
  currentBillingPeriod,
  listCompanyBilling,
  updateCompanyBilling,
} from '../lib/auth.js';
import { TIMEZONES, DEFAULT_TIMEZONE, tzLabel } from '../lib/timezones.js';

// The full country list now lives in lib/countries.js — see the note there on
// why the values must never be re-spelled once a company is using one.
import { COUNTRY_OPTIONS } from '../lib/countries.js';
import AccountMenu from '../components/AccountMenu.jsx';
import LogoManager from '../components/LogoManager.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import UpdateBell from '../components/UpdateBell.jsx';
import Guide from './Guide.jsx';
import useIsMobile from '../lib/useIsMobile.js';

/*
 * Provider — the distributor's backend (super-admin).
 * Create companies (with or without a master), add masters, search, and delete a
 * company (password-confirmed; cascades to its accounts + data).
 * Passwords are self-service: each user changes their own once logged in.
 */
// 'YYYY-MM' -> "July 2026".
function monthLabel(period) {
  if (!period) return '';
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}
function fmtMoney(n) {
  return n == null ? '' : `$${Number(n).toFixed(2)}`;
}
// Small local date formatter — no library, matches the plain-JS style used elsewhere here.
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Generic matchMedia hook, local to this file (useIsMobile.js already covers the
// narrow end; this covers the wide end for the 3-column desktop layout below).
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// A single shimmering placeholder block (see .skeleton in global.css). Shaped
// per-caller via width/height/style to stand in for real content while loading.
function SkeletonBlock({ width = '100%', height = 12, style }) {
  return <div className="skeleton" style={{ width, height, ...style }} />;
}

export default function Provider({ ctx, onLogout }) {
  const { user } = ctx;
  const isMobile = useIsMobile();
  const isWide = useMediaQuery('(min-width: 1200px)');
  const [companies, setCompanies] = useState(null); // null = loading
  const [guideOpen, setGuideOpen] = useState(false);
  const [billing, setBilling] = useState(null); // null = loading; array of {companyId, startedAt, rentalFee}
  const [billingError, setBillingError] = useState('');
  const [payments, setPayments] = useState(null); // null = loading; full payment log, every company/period
  const [paymentsError, setPaymentsError] = useState('');

  async function refresh() {
    setCompanies(await listCompaniesWithMasters());
    const b = await listCompanyBilling();
    if (b.ok) { setBilling(b.rows); setBillingError(''); }
    else { setBilling([]); setBillingError(b.error); }
    const p = await listBillingPayments();
    if (p.ok) { setPayments(p.rows); setPaymentsError(''); }
    else { setPayments([]); setPaymentsError(p.error); }
  }
  useEffect(() => { refresh(); }, []);

  const leftColumn = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <CreateCompany onCreated={refresh} />
      <OwnersCard companies={companies || []} />
      <ProvidersCard user={user} />
      <MaintenanceCard />
    </div>
  );
  const companiesSection = <CompaniesCard companies={companies} billing={billing} isFullProvider={user.role === 'provider'} onChanged={refresh} />;
  const billingSection = (
    <BillingCard companies={companies || []} billing={billing} billingError={billingError}
      payments={payments || []} paymentsError={paymentsError} onChanged={refresh} />
  );
  const historySection = <PaymentHistoryCard companies={companies || []} payments={payments} paymentsError={paymentsError} />;
  // billingSection + historySection share ONE grid column (the 340px slot on wide
  // screens) stacked vertically, rather than each being a separate grid cell.
  const billingColumn = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {billingSection}
      {historySection}
    </div>
  );

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
          <UpdateBell />
          <button className="ub-bell-btn" onClick={() => setGuideOpen(true)} title="Help / How to use" aria-label="Help / How to use">
            <i className="ti ti-help" aria-hidden="true" style={{ fontSize: 18 }} />
          </button>
          <ThemeToggle />
          <span className={`badge ${user.role === 'provider' ? 'badge-provider' : 'badge-subprovider'}`}>
            <i className="ti ti-shield-lock" aria-hidden="true" /> {user.role === 'provider' ? 'Provider' : 'Sub-provider'}
          </span>
          <AccountMenu user={user} roleLabel={user.role === 'provider' ? 'Provider' : 'Sub-provider'} onLogout={onLogout} onOpenGuide={() => setGuideOpen(true)} />
        </div>
      </header>
      <Guide open={guideOpen} role={user.role} onClose={() => setGuideOpen(false)} />

      <main style={{ ...styles.main, maxWidth: isWide ? 1320 : styles.main.maxWidth, padding: isMobile ? 14 : 24 }}>
        <div style={{ ...styles.grid, gridTemplateColumns: isMobile ? '1fr' : isWide ? styles.gridWide.gridTemplateColumns : styles.grid.gridTemplateColumns }}>
          {leftColumn}
          {isWide ? (
            <>
              {companiesSection}
              {billingColumn}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {companiesSection}
              {billingColumn}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* Companies list + its own search box (name or master name/email). */
function CompaniesCard({ companies, billing, isFullProvider, onChanged }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = !companies ? [] : q
    ? companies.filter(
        (c) => c.name.toLowerCase().includes(q) ||
          c.masters.some((m) => (m.email || '').toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      )
    : companies;

  return (
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

      {companies === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CompanySkeletonCard /><CompanySkeletonCard />
        </div>
      )}
      {companies && companies.length === 0 && <p style={styles.cardSub}>No companies yet — create one on the left.</p>}
      {companies && companies.length > 0 && filtered.length === 0 && (
        <p style={styles.cardSub}>No companies match “{query}”.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map((c) => <CompanyCard key={c.id} company={c} billing={billing} isFullProvider={isFullProvider} onChanged={onChanged} />)}
      </div>
    </section>
  );
}

function CompanySkeletonCard() {
  return (
    <div style={styles.companyCard} aria-hidden="true">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SkeletonBlock width="45%" height={16} />
        <SkeletonBlock width="60%" height={11} />
        <SkeletonBlock width="35%" height={11} />
      </div>
      <SkeletonBlock height={40} style={{ borderRadius: 9, marginTop: 10 }} />
    </div>
  );
}

function CreateCompany({ onCreated }) {
  const blank = { companyName: '', masterName: '', masterEmail: '', password: '', timezone: DEFAULT_TIMEZONE, country: '' };
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
        {/* Set here rather than only after the fact, so a new company can reach
            its shared Blacklist Member list from the moment it's created —
            country, not time zone, decides which pool that is. */}
        <div className="field"><label>Country <span style={styles.opt}>(shares the Blacklist Member list)</span></label>
          <FluidDropdown value={form.country} ariaLabel="Country" placeholder="— Country not set —"
            options={COUNTRY_OPTIONS}
            onChange={(v) => setForm({ ...form, country: v })} /></div>
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

/* Owner logins: one login, linked to several companies, for a bird's-eye view
 * (today's deposits/withdrawals/store) without a separate password per company. */
function OwnersCard({ companies }) {
  const blank = { name: '', email: '', password: '' };
  const [owners, setOwners] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [linkBusy, setLinkBusy] = useState(null);

  async function refresh() {
    setOwners(await listOwners());
  }
  useEffect(() => { refresh(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const res = await createOwner(form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk(`Created owner ${res.user.name}. Link companies below.`);
    setForm(blank);
    refresh();
  }

  async function toggleLink(ownerId, companyId, linked) {
    const key = `${ownerId}:${companyId}`;
    setLinkBusy(key);
    const res = await setOwnerCompanyLink(ownerId, companyId, linked);
    setLinkBusy(null);
    if (!res.ok) { window.showToast?.(res.error, 'error'); return; }
    refresh();
  }

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-crown" aria-hidden="true" /> Owners</h3>
      <p style={styles.cardSub}>
        An owner logs in once and sees today's numbers for every company you link them to below —
        no separate password per company, and they can't edit any company's data.
      </p>
      <form onSubmit={submit}>
        <div className="field"><label>Name / ID</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. The Boss" /></div>
        <div className="field"><label>Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="boss@example.com" /></div>
        <div className="field"><label>Temp password</label>
          <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥ 6 characters" /></div>
        {error && <div className="error-text">{error}</div>}
        {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
          <i className={`ti ti-${busy ? 'loader-2' : 'plus'}`} aria-hidden="true" /> {busy ? 'Creating…' : 'Create owner'}
        </button>
      </form>

      {owners === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <OwnerSkeletonRow /><OwnerSkeletonRow />
        </div>
      )}
      {owners && owners.length === 0 && <p style={{ ...styles.cardSub, marginTop: 12, marginBottom: 0 }}>No owners yet.</p>}

      {owners && owners.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {owners.map((o) => (
            <div key={o.id} style={styles.masterRow}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {o.name} <span className="badge badge-owner" style={{ marginLeft: 4 }}>Owner</span>
                </div>
                <div style={styles.sub}>{o.email} · {o.companyIds.length} compan{o.companyIds.length === 1 ? 'y' : 'ies'} linked</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}>
                <i className={`ti ti-${expandedId === o.id ? 'chevron-up' : 'link'}`} aria-hidden="true" /> {expandedId === o.id ? 'Close' : 'Link companies'}
              </button>
              {expandedId === o.id && (
                <div style={{ ...styles.editBox, gap: 2 }}>
                  {companies.length === 0 && <div style={styles.sub}>No companies yet.</div>}
                  {companies.map((c) => {
                    const linked = o.companyIds.includes(c.id);
                    const key = `${o.id}:${c.id}`;
                    return (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 4px', borderRadius: 7, cursor: linkBusy === key ? 'wait' : 'pointer' }}>
                        {/* `input, select { width:100% }` is a global rule for text/select fields —
                            override it here so this checkbox renders natively instead of stretched. */}
                        <input type="checkbox" checked={linked} disabled={linkBusy === key}
                          onChange={(e) => toggleLink(o.id, c.id, e.target.checked)}
                          style={{ width: 16, height: 16, minWidth: 16, padding: 0, border: 'revert', borderRadius: 'revert', background: 'revert', flexShrink: 0, accentColor: 'var(--accent)' }} />
                        {c.logo
                          ? <img src={c.logo} alt="" style={{ height: 20, maxWidth: 64, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
                          : <div style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <i className="ti ti-building" aria-hidden="true" style={{ fontSize: 12, color: 'var(--muted)' }} />
                            </div>}
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OwnerSkeletonRow() {
  return (
    <div style={styles.masterRow} aria-hidden="true">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <SkeletonBlock width="40%" height={13} />
        <SkeletonBlock width="55%" height={10} />
      </div>
    </div>
  );
}

function ProvidersCard({ user }) {
  const blank = { name: '', email: '', password: '', currentPassword: '', role: 'sub-provider' };
  const isFullProvider = user.role === 'provider';
  const [providers, setProviders] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [resetPw, setResetPw] = useState('');

  async function refresh() {
    setProviders(await listProviders());
  }
  useEffect(() => { refresh(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const res = await createProvider(form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk(`Created ${form.role === 'provider' ? 'provider' : 'sub-provider'} login for ${res.user.name}.`);
    setForm(blank);
    refresh();
  }

  async function doReset(e, userId, label) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const res = await adminResetPassword(userId, resetPw);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk(`Password reset for ${label}.`);
    setResettingId(null); setResetPw('');
  }

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}><i className="ti ti-shield-lock" aria-hidden="true" /> Providers</h3>
      <p style={styles.cardSub}>
        A provider has full access to everything. A sub-provider can do everything EXCEPT
        delete a company, and can never touch another provider or sub-provider's login
        (edit, deactivate, delete, or reset its password) — only a full provider can do that.
      </p>

      {isFullProvider ? (
        <form onSubmit={submit}>
          <div className="field"><label>Access level</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className={`btn btn-sm ${form.role === 'sub-provider' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1 }} onClick={() => setForm({ ...form, role: 'sub-provider' })}>
                <i className="ti ti-shield" aria-hidden="true" /> Sub-provider
              </button>
              <button type="button" className={`btn btn-sm ${form.role === 'provider' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1 }} onClick={() => setForm({ ...form, role: 'provider' })}>
                <i className="ti ti-shield-lock" aria-hidden="true" /> Full provider
              </button>
            </div>
          </div>
          <div className="field"><label>Name / ID</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Alex" /></div>
          <div className="field"><label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="alex@example.com" /></div>
          <div className="field"><label>Temp password (for the new login)</label>
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥ 6 characters" /></div>
          <div className="field"><label>Your own password (confirms it's really you)</label>
            <input type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} placeholder="Re-enter your password" /></div>
          {error && <div className="error-text">{error}</div>}
          {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
            <i className={`ti ti-${busy ? 'loader-2' : 'plus'}`} aria-hidden="true" /> {busy ? 'Creating…' : `Create ${form.role === 'provider' ? 'provider' : 'sub-provider'}`}
          </button>
        </form>
      ) : (
        <p style={{ ...styles.cardSub, marginBottom: 0 }}>Only a full provider can create or manage provider-tier logins.</p>
      )}

      {providers === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <OwnerSkeletonRow /><OwnerSkeletonRow />
        </div>
      )}

      {providers && providers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {providers.map((p) => (
            <div key={p.id} style={styles.masterRow}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {p.name}{' '}
                  <span className={`badge ${p.role === 'provider' ? 'badge-provider' : 'badge-subprovider'}`} style={{ marginLeft: 4 }}>
                    {p.role === 'provider' ? 'Provider' : 'Sub-provider'}
                  </span>
                  {p.id === user.id && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>(you)</span>}
                </div>
                <div style={styles.sub}>{p.email}</div>
              </div>
              {isFullProvider && (
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { setResettingId(resettingId === p.id ? null : p.id); setResetPw(''); setError(''); setOk(''); }}>
                  <i className="ti ti-key" aria-hidden="true" /> Reset password
                </button>
              )}
              {isFullProvider && resettingId === p.id && (
                <form onSubmit={(e) => doReset(e, p.id, p.name)} style={styles.resetRow}>
                  <input type="text" value={resetPw} onChange={(e) => setResetPw(e.target.value)}
                    placeholder={`New password for ${p.name}`} style={{ flex: 1 }} />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!resetPw || busy}>Set</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setResettingId(null); setResetPw(''); }}>Cancel</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
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

/*
 * Rental fees — provider-only bookkeeping (migration-016). Never shown to any
 * other role. One row per company: start date, rent amount, paid/unpaid.
 */
function BillingCard({ companies, billing, billingError, payments, paymentsError, onChanged }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies;
  const period = currentBillingPeriod();
  const thisMonth = useMemo(
    () => new Map((payments || []).filter((p) => p.period === period).map((p) => [p.companyId, p])),
    [payments, period]
  );
  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((c) => c.id)));
  }

  async function bulkMark(paid) {
    setBulkErr(''); setBulkBusy(true);
    const res = paid ? await markRentPaid([...selected]) : await markRentUnpaid([...selected]);
    setBulkBusy(false);
    if (!res.ok) { setBulkErr(res.error); return; }
    setSelected(new Set());
    onChanged?.();
  }

  const ready = billing && !billingError && !paymentsError;

  return (
    <section style={styles.card}>
      <div style={styles.companiesHead}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}><i className="ti ti-cash" aria-hidden="true" /> Rental fees</h3>
        <div style={styles.searchWrap}>
          <i className="ti ti-search" aria-hidden="true" style={styles.searchIcon} />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company…" style={styles.searchInput} />
          {query && (
            <button type="button" onClick={() => setQuery('')} style={styles.searchClear} aria-label="Clear search">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <p style={styles.cardSub}>Provider-only. Paid / unpaid below is for {monthLabel(period)}.</p>

      {billing === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <BillingSkeletonRow /><BillingSkeletonRow />
        </div>
      )}
      {billing && billingError && <p style={styles.cardSub}>{billingError}</p>}
      {billing && !billingError && paymentsError && <p style={styles.cardSub}>{paymentsError}</p>}
      {ready && companies.length === 0 && <p style={styles.cardSub}>No companies yet.</p>}
      {ready && companies.length > 0 && filtered.length === 0 && (
        <p style={styles.cardSub}>No companies match “{query}”.</p>
      )}

      {ready && filtered.length > 0 && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll}
              style={{ width: 16, height: 16, minWidth: 16, padding: 0, border: 'revert', borderRadius: 'revert', background: 'revert', flexShrink: 0, accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Select all</span>
          </label>

          {selected.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', marginBottom: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{selected.size} selected</span>
              <button type="button" className="btn btn-success btn-sm" disabled={bulkBusy} onClick={() => bulkMark(true)}>
                <i className={`ti ti-${bulkBusy ? 'loader-2' : 'check'}`} aria-hidden="true" /> Mark paid
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => bulkMark(false)}>
                <i className={`ti ti-${bulkBusy ? 'loader-2' : 'x'}`} aria-hidden="true" /> Mark unpaid
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => setSelected(new Set())}>Clear</button>
              {bulkErr && <div className="error-text" style={{ width: '100%', margin: 0 }}>{bulkErr}</div>}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((c) => (
              <BillingRow key={c.id} company={c} billing={billing.find((b) => b.companyId === c.id)}
                payment={thisMonth.get(c.id)} selected={selected.has(c.id)} onToggleSelect={() => toggleOne(c.id)}
                onChanged={onChanged} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function BillingSkeletonRow() {
  return (
    <div style={styles.billingRow} aria-hidden="true">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 150px' }}>
        <SkeletonBlock width={22} height={22} style={{ borderRadius: 5, flexShrink: 0 }} />
        <SkeletonBlock width="60%" height={13} />
      </div>
      <SkeletonBlock width={138} height={30} style={{ borderRadius: 7 }} />
      <SkeletonBlock width={76} height={30} style={{ borderRadius: 7 }} />
      <SkeletonBlock width={120} height={28} style={{ borderRadius: 7 }} />
    </div>
  );
}

function BillingRow({ company, billing, payment, selected, onToggleSelect, onChanged }) {
  const [rentDraft, setRentDraft] = useState(billing?.rentalFee != null ? String(billing.rentalFee) : '');
  const [savingField, setSavingField] = useState(null); // 'started' | 'rent' | 'paid' | null
  const [err, setErr] = useState('');
  const isPaid = !!payment;

  // Keep the draft in sync if the underlying data changes (e.g. after a refresh).
  useEffect(() => {
    setRentDraft(billing?.rentalFee != null ? String(billing.rentalFee) : '');
  }, [billing?.rentalFee]);

  async function saveStarted(value) {
    setSavingField('started'); setErr('');
    const res = await updateCompanyBilling(company.id, { startedAt: value });
    setSavingField(null);
    if (!res.ok) { setErr(res.error); return; }
    onChanged?.();
  }

  async function saveRent() {
    const current = billing?.rentalFee != null ? String(billing.rentalFee) : '';
    if (rentDraft.trim() === current) return; // unchanged — skip the round trip
    setSavingField('rent'); setErr('');
    const res = await updateCompanyBilling(company.id, { rentalFee: rentDraft.trim() });
    setSavingField(null);
    if (!res.ok) { setErr(res.error); setRentDraft(current); return; }
    onChanged?.();
  }

  async function markOne(paid) {
    setSavingField('paid'); setErr('');
    const res = paid ? await markRentPaid([company.id]) : await markRentUnpaid([company.id]);
    setSavingField(null);
    if (!res.ok) { setErr(res.error); return; }
    onChanged?.();
  }

  return (
    <div style={styles.billingRow}>
      {/* Global `input, select { width:100% }` rule stretches plain checkboxes — reset it here (same fix as the Owners "Link companies" row). */}
      <input type="checkbox" checked={selected} onChange={onToggleSelect}
        style={{ width: 16, height: 16, minWidth: 16, padding: 0, border: 'revert', borderRadius: 'revert', background: 'revert', flexShrink: 0, accentColor: 'var(--accent)' }} />

      <div style={styles.billingCompanyCell}>
        {company.logo
          ? <img src={company.logo} alt="" style={{ height: 20, maxWidth: 64, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
          : <div style={styles.billingLogoPlaceholder}><i className="ti ti-building" aria-hidden="true" style={{ fontSize: 12, color: 'var(--muted)' }} /></div>}
        <span style={styles.billingCompanyName}>{company.name}</span>
      </div>

      <label style={styles.billingField}>
        <span style={styles.billingFieldLabel}>Started</span>
        <input type="date" value={billing?.startedAt || ''} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => saveStarted(e.target.value)} disabled={savingField === 'started'} style={styles.billingDateInput} />
      </label>

      <label style={styles.billingField}>
        <span style={styles.billingFieldLabel}>Rent</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>$</span>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={rentDraft}
            onChange={(e) => setRentDraft(e.target.value)} onBlur={saveRent} disabled={savingField === 'rent'}
            style={styles.billingRentInput} />
        </div>
      </label>

      <div style={styles.billingField}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className={`btn btn-sm ${isPaid ? 'btn-success' : 'btn-ghost'}`}
            disabled={savingField === 'paid'} onClick={() => markOne(true)}>
            <i className="ti ti-check" aria-hidden="true" /> Paid
          </button>
          <button type="button" className="btn btn-ghost btn-sm"
            disabled={savingField === 'paid'} onClick={() => markOne(false)}>
            <i className="ti ti-x" aria-hidden="true" /> Unpaid
          </button>
        </div>
        {isPaid && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtMoney(payment.amount)} · {fmtDate(payment.paidAt)}</span>}
      </div>

      {err && <div className="error-text" style={{ width: '100%', margin: 0 }}>{err}</div>}
    </div>
  );
}

/* Full month-by-month log across every company — the "previous record" view.
 * Marking paid/unpaid above writes into this same log, so nothing extra to do
 * to keep it current. */
function PaymentHistoryCard({ companies, payments, paymentsError }) {
  const [showAll, setShowAll] = useState(false);
  const CAP = 15;
  const companyName = (id) => companies.find((c) => c.id === id)?.name || 'Unknown company';
  const sorted = [...(payments || [])].sort((a, b) => {
    if (a.period !== b.period) return b.period.localeCompare(a.period);
    return companyName(a.companyId).localeCompare(companyName(b.companyId));
  });
  const rows = showAll ? sorted : sorted.slice(0, CAP);

  return (
    <section style={styles.card}>
      <h3 style={{ ...styles.cardTitle, margin: 0 }}><i className="ti ti-history" aria-hidden="true" /> Payment history</h3>
      <p style={styles.cardSub}>Every rental payment ever recorded, newest month first — the permanent record behind the paid/unpaid buttons above.</p>

      {payments === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonBlock height={32} style={{ borderRadius: 7 }} />
          <SkeletonBlock height={32} style={{ borderRadius: 7 }} />
          <SkeletonBlock height={32} style={{ borderRadius: 7 }} />
        </div>
      )}
      {payments && paymentsError && <p style={{ ...styles.cardSub, marginBottom: 0 }}>{paymentsError}</p>}
      {payments && !paymentsError && sorted.length === 0 && (
        <p style={{ ...styles.cardSub, marginBottom: 0 }}>No payments recorded yet — mark a company paid above and it'll show up here.</p>
      )}

      {payments && !paymentsError && sorted.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((p) => (
              <div key={p.id} style={styles.historyRow}>
                <span style={styles.historyCompany}>{companyName(p.companyId)}</span>
                <span style={styles.historyPeriod}>{monthLabel(p.period)}</span>
                <span style={styles.historyAmount}>{fmtMoney(p.amount)}</span>
                <span style={styles.sub}>{fmtDate(p.paidAt)}</span>
              </div>
            ))}
          </div>
          {sorted.length > CAP && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10, width: '100%' }}
              onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show less' : `Show all ${sorted.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function CompanyCard({ company, billing, isFullProvider, onChanged }) {
  const isMobile = useIsMobile();
  const myBilling = billing?.find((b) => b.companyId === company.id);
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
  const [countryDraft, setCountryDraft] = useState(company.country || '');
  const [editingMasterId, setEditingMasterId] = useState(null);
  const [masterDraft, setMasterDraft] = useState({ name: '', email: '' });

  async function doEditCompany(e) {
    e.preventDefault();
    setError(''); setOk(''); setBusy(true);
    const payload = {};
    if (nameDraft.trim() !== (company.name || '')) payload.name = nameDraft;
    if (tzDraft !== (company.timezone || DEFAULT_TIMEZONE)) payload.timezone = tzDraft;
    if (countryDraft !== (company.country || '')) payload.country = countryDraft;
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
              {/* Country, not timezone, decides who shares a Blacklist Member
                  list — Perth and Sydney are two timezones but one country. */}
              <FluidDropdown value={countryDraft} ariaLabel="Country" placeholder="— Country not set —"
                options={COUNTRY_OPTIONS}
                onChange={(v) => setCountryDraft(v)} />
              <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                Companies sharing a country share one Blacklist Member list.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!nameDraft.trim() || busy}>
                  <i className={`ti ti-${busy ? 'loader-2' : 'check'}`} aria-hidden="true" /> Save
                </button>
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { setEditingName(false); setNameDraft(company.name); setTzDraft(company.timezone || DEFAULT_TIMEZONE); setCountryDraft(company.country || ''); }}>Cancel</button>
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
              <div style={styles.sub}>
                <i className="ti ti-world" aria-hidden="true" />{' '}
                {company.country
                  ? company.country
                  : <span style={{ color: 'var(--danger)' }}>No country set — Blacklist Member unavailable</span>}
              </div>
              {myBilling?.startedAt && (
                <div style={styles.sub}><i className="ti ti-calendar-event" aria-hidden="true" /> Started {fmtDate(myBilling.startedAt)}</div>
              )}
            </>
          )}
        </div>
        {!editingName && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditingName(true); setNameDraft(company.name); setTzDraft(company.timezone || DEFAULT_TIMEZONE); setCountryDraft(company.country || ''); setError(''); setOk(''); }}>
              <i className="ti ti-pencil" aria-hidden="true" /> Edit
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowLogo((s) => !s); setError(''); setOk(''); }}>
              <i className="ti ti-photo" aria-hidden="true" /> Logo
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAdding((a) => !a); setError(''); setOk(''); }}>
              <i className="ti ti-user-plus" aria-hidden="true" /> Add master
            </button>
            {isFullProvider && (
              <button className="btn btn-danger btn-sm" onClick={() => setShowDelete(true)}>
                <i className="ti ti-trash" aria-hidden="true" /> Delete
              </button>
            )}
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
  useEsc(true, onClose); // Escape closes the delete-company modal

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
  gridWide: { gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr) minmax(0, 340px)' },
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
  billingRow: { display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9 },
  billingCompanyCell: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 150px' },
  billingCompanyName: { fontSize: 13, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  billingLogoPlaceholder: { width: 22, height: 22, borderRadius: 5, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  billingField: { display: 'flex', flexDirection: 'column', gap: 3 },
  billingFieldLabel: { fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' },
  billingDateInput: { padding: '6px 8px', fontSize: 12.5, borderRadius: 7, width: 138 },
  billingRentInput: { padding: '6px 8px', fontSize: 12.5, borderRadius: 7, width: 76, fontVariantNumeric: 'tabular-nums' },
  historyRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12.5 },
  historyCompany: { flex: '1 1 120px', minWidth: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  historyPeriod: { flex: '0 0 auto', color: 'var(--muted)' },
  historyAmount: { flex: '0 0 auto', fontVariantNumeric: 'tabular-nums', fontWeight: 500 },
};
