import { useEffect, useState } from 'react';
import { getOwnerSummaries } from '../lib/auth.js';
import AccountMenu from '../components/AccountMenu.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import UpdateBell from '../components/UpdateBell.jsx';
import useIsMobile from '../lib/useIsMobile.js';

const fmt = (n) => {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function fmtTime(iso) {
  if (!iso) return 'no data yet';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/*
 * OwnerOverview — lands here after an "owner" login: one card per company the
 * provider has linked to this account, showing today's deposits, withdrawals,
 * Win/Loss and the Store balance. Read-only — see migration-013.sql, which
 * grants an owner read access but never touches any write policy, so this view
 * (and the full dashboard a card opens into) can't edit any company's data.
 */
export default function OwnerOverview({ ctx, onLogout, onOpenCompany }) {
  const { user } = ctx;
  const isMobile = useIsMobile();
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState('');

  async function refresh() {
    const res = await getOwnerSummaries();
    if (!res.ok) { setError(res.error); setRows([]); return; }
    setError('');
    setRows(res.rows);
  }
  useEffect(() => { refresh(); }, []);

  return (
    <div style={styles.page}>
      <header style={styles.topbar}>
        <div style={styles.brand}>
          <div style={styles.logo}><i className="ti ti-crown" aria-hidden="true" /></div>
          <div>
            <div style={styles.title}>Owner overview</div>
            <div style={styles.sub}>Today's numbers across every company you own</div>
          </div>
        </div>
        <div style={styles.userBox}>
          <UpdateBell />
          <ThemeToggle />
          <span className="badge badge-owner"><i className="ti ti-crown" aria-hidden="true" /> Owner</span>
          <AccountMenu user={user} roleLabel="Owner" onLogout={onLogout} />
        </div>
      </header>

      <main style={{ ...styles.main, padding: isMobile ? 14 : 24 }}>
        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}
        {rows === null && !error && <p style={styles.emptyText}>Loading…</p>}
        {rows && rows.length === 0 && !error && (
          <p style={styles.emptyText}>No companies are linked to your account yet — ask your provider to link one.</p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {rows && rows.map((r) => (
            <CompanyCard key={r.companyId} row={r}
              onOpen={() => onOpenCompany({ id: r.companyId, name: r.name, logo: r.logo, timezone: r.timezone })} />
          ))}
        </div>
      </main>
    </div>
  );
}

function CompanyCard({ row, onOpen }) {
  const win = (row.depositsAmount || 0) - (row.withdrawalsAmount || 0);
  return (
    <button type="button" onClick={onOpen} style={styles.companyCard}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
      <div style={styles.companyHead}>
        {row.logo
          ? <img src={row.logo} alt="" style={styles.companyLogo} />
          : <div style={styles.companyIcon}><i className="ti ti-building" aria-hidden="true" /></div>}
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <div style={styles.companyName}>{row.name}</div>
          <div style={styles.companySub}>As of {row.asOfDate} · updated {fmtTime(row.updatedAt)}</div>
        </div>
        <i className="ti ti-chevron-right" aria-hidden="true" style={styles.chevron} />
      </div>

      <div style={styles.statGrid}>
        <Stat label="Deposits" count={row.depositsCount} amount={row.depositsAmount} color="var(--success)" />
        <Stat label="Withdrawals" count={row.withdrawalsCount} amount={row.withdrawalsAmount} color="var(--danger)" />
        <Stat label="Win / Loss" amount={win} color={win >= 0 ? 'var(--success)' : 'var(--danger)'} />
        <Stat label="Store" count={row.storeCountToday} amount={row.storeBalance} color="var(--accent)"
          note={`yesterday ${fmt(row.storeYesterday)}`} />
      </div>
    </button>
  );
}

function Stat({ label, count, amount, color, note }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}{count != null && <span style={styles.statCount}> · {count} today</span>}</div>
      <div style={{ ...styles.statAmount, color }}>{fmt(amount)}</div>
      {note && <div style={styles.statNote}>{note}</div>}
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
  userBox: { display: 'flex', alignItems: 'center', gap: 12 },
  main: { flex: 1, width: '100%', maxWidth: 1200, margin: '0 auto', padding: 24 },
  emptyText: { fontSize: 13.5, color: 'var(--muted)' },
  companyCard: {
    width: '100%', boxSizing: 'border-box', appearance: 'none', font: 'inherit', color: 'inherit',
    textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14,
    transition: 'border-color 0.15s',
  },
  companyHead: { display: 'flex', alignItems: 'center', gap: 12 },
  companyLogo: { width: 40, height: 40, objectFit: 'contain', borderRadius: 9, background: 'var(--surface-2)', flexShrink: 0 },
  companyIcon: {
    width: 40, height: 40, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
  },
  companyName: { fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  companySub: { fontSize: 11.5, color: 'var(--muted)', marginTop: 2 },
  chevron: { marginLeft: 'auto', color: 'var(--muted)', fontSize: 18, flexShrink: 0 },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 },
  stat: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' },
  statLabel: { fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 },
  statCount: { color: 'var(--muted)', fontWeight: 400 },
  statAmount: { fontSize: 15, fontWeight: 600, marginTop: 3 },
  statNote: { fontSize: 10.5, color: 'var(--muted)', marginTop: 2 },
};
