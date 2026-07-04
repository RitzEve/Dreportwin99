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

// The browser's own local calendar date, as 'YYYY-MM-DD' (not toISOString(),
// which is UTC and can land on the wrong day near midnight).
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtChosenDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/*
 * OwnerOverview — lands here after an "owner" login: one card per company the
 * provider has linked to this account, showing that day's deposits, withdrawals,
 * Win/Loss and the Store balance for a chosen date (defaults to today). Read-only
 * — see migration-013.sql, which grants an owner read access but never touches
 * any write policy, so this view (and the full dashboard a card opens into)
 * can't edit any company's data.
 */
export default function OwnerOverview({ ctx, onLogout, onOpenCompany }) {
  const { user } = ctx;
  const isMobile = useIsMobile();
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [dateUnsupported, setDateUnsupported] = useState(false);
  // '' = live "today", computed per company's own time zone (the original default
  // behaviour). Only becomes a real value once the owner picks a specific date —
  // at that point it's the SAME literal date applied to every company, which is
  // what makes a side-by-side comparison across companies meaningful.
  const [pickedDate, setPickedDate] = useState('');

  const isToday = !pickedDate;
  const displayDate = pickedDate || todayLocal();

  async function refresh(date) {
    const res = await getOwnerSummaries(date || undefined);
    if (!res.ok) { setError(res.error); setRows([]); return; }
    setError('');
    setDateUnsupported(!!res.dateUnsupported);
    setRows(res.rows);
  }
  useEffect(() => { refresh(pickedDate); }, [pickedDate]);

  return (
    <div style={styles.page}>
      <header style={{ ...styles.topbar, padding: isMobile ? '12px 16px' : '14px 24px' }}>
        <div style={styles.brand}>
          <div style={styles.logo}><i className="ti ti-crown" aria-hidden="true" /></div>
          <div>
            <div style={styles.title}>Owner overview</div>
            <div style={styles.sub}>
              {isToday || dateUnsupported ? "Today's numbers across every company you own" : `Numbers for ${fmtChosenDate(displayDate)}`}
            </div>
          </div>
        </div>
        <div style={isMobile ? styles.userBoxMobile : styles.userBox}>
          <div style={styles.dateBox}>
            <label htmlFor="owner-date" style={styles.dateLabel}>Date</label>
            <input id="owner-date" type="date" value={displayDate} max={todayLocal()}
              onChange={(e) => setPickedDate(e.target.value)} style={{ padding: '6px 8px', fontSize: 13 }} />
            {!isToday && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPickedDate('')}>Today</button>
            )}
          </div>
          {/* Its own row, right-aligned, on mobile — keeps the account menu pinned to the
              true right edge of the screen so its dropdown (position:absolute, right:0)
              always has room to open on-screen, instead of landing wherever flex-wrap
              happens to strand it. */}
          <div style={isMobile ? styles.actionsMobile : styles.actions}>
            <UpdateBell />
            <ThemeToggle />
            <span className="badge badge-owner"><i className="ti ti-crown" aria-hidden="true" /> Owner</span>
            <AccountMenu user={user} roleLabel="Owner" onLogout={onLogout} />
          </div>
        </div>
      </header>

      <main style={{ ...styles.main, padding: isMobile ? 14 : 24 }}>
        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}
        {dateUnsupported && !error && (
          <div className="error-text" style={{ marginBottom: 16 }}>
            Picking a date needs a one-time database update — showing today's numbers instead. Ask your provider to run migration-014.sql.
          </div>
        )}
        {rows === null && !error && <p style={styles.emptyText}>Loading…</p>}
        {rows && rows.length === 0 && !error && (
          <p style={styles.emptyText}>No companies are linked to your account yet — ask your provider to link one.</p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {rows && rows.map((r) => (
            <CompanyCard key={r.companyId} row={r} isToday={isToday || dateUnsupported}
              onOpen={() => onOpenCompany({ id: r.companyId, name: r.name, logo: r.logo, timezone: r.timezone })} />
          ))}
        </div>
      </main>
    </div>
  );
}

function CompanyCard({ row, isToday, onOpen }) {
  const win = (row.depositsAmount || 0) - (row.withdrawalsAmount || 0);
  const countSuffix = isToday ? 'today' : 'that day';
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
        <Stat label="Deposits" count={row.depositsCount} countSuffix={countSuffix} amount={row.depositsAmount} color="var(--success)" />
        <Stat label="Withdrawals" count={row.withdrawalsCount} countSuffix={countSuffix} amount={row.withdrawalsAmount} color="var(--danger)" />
        <Stat label="Win / Loss" amount={win} color={win >= 0 ? 'var(--success)' : 'var(--danger)'} />
        <Stat label="Store" count={row.storeCountToday} countSuffix={countSuffix} amount={row.storeBalance} color="var(--accent)"
          note={`${isToday ? 'yesterday' : 'day before'} ${fmt(row.storeYesterday)}`} />
      </div>
    </button>
  );
}

function Stat({ label, count, countSuffix, amount, color, note }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}{count != null && <span style={styles.statCount}> · {count} {countSuffix}</span>}</div>
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
  userBox: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  // Mobile: date control and the icon/account cluster each become their own full-width
  // row (stacked), instead of sharing one wrapped row where they land unpredictably.
  userBoxMobile: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%', gap: 10 },
  dateBox: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dateLabel: { fontSize: 12, color: 'var(--muted)' },
  actions: { display: 'flex', alignItems: 'center', gap: 12 },
  // Right-aligned on its own full-width row — keeps AccountMenu's trigger pinned to the
  // true right edge, so its dropdown (position:absolute, right:0) never opens off-screen.
  actionsMobile: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' },
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
