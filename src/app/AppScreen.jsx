import { useEffect, useState } from 'react';
import { changeOwnPassword } from '../lib/auth.js';
import { setTheme } from '../lib/theme.js';

/*
 * AppScreen — hosts the FinTrack artifact for the logged-in company.
 *
 * The artifact reads `window.FINTRACK_SESSION` ONCE at module-evaluation time, so
 * we set the session BEFORE importing it (the import is dynamic, inside the effect).
 */
export default function AppScreen({ ctx, onExit, onLogout, canReturnToConsole = true }) {
  const [Comp, setComp] = useState(null);

  useEffect(() => {
    if (!ctx || !ctx.company) { onLogout(); return; }

    window.FINTRACK_SESSION = {
      companyId: ctx.company.id,
      companyName: ctx.company.name,
      operatorId: ctx.user.operatorId,
      operatorName: ctx.user.name,
      role: ctx.user.role,
    };
    window.FINTRACK_LOGOUT = () => onLogout();
    // Async now (hits Supabase). The artifact awaits this (see FinTrack handleChangePassword).
    window.FINTRACK_CHANGE_PASSWORD = (current, next) => changeOwnPassword(current, next);
    // The artifact's colours are computed at load, so re-init by reloading after the
    // theme is saved. Root restores the 'app' screen from sessionStorage on reload.
    window.FINTRACK_SET_THEME = (t) => { setTheme(t); window.location.reload(); };

    let alive = true;
    import('./FinTrack.jsx').then((m) => { if (alive) setComp(() => m.default); });
    return () => { alive = false; };
  }, [ctx, onLogout]);

  return (
    <div style={styles.wrap}>
      <div style={styles.bar}>
        {canReturnToConsole ? (
          <button className="btn btn-ghost btn-sm" onClick={onExit}>
            <i className="ti ti-chevron-left" aria-hidden="true" /> Console
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            <i className="ti ti-logout" aria-hidden="true" /> Log out
          </button>
        )}
        <span style={styles.barMeta}>
          <i className="ti ti-building" aria-hidden="true" /> {ctx?.company?.name}
          <span style={styles.dot}>·</span>
          {ctx?.user.operatorId} ({ctx?.user.role})
        </span>
      </div>
      <div style={styles.appArea}>
        {Comp ? <Comp /> : <div style={styles.loading}>Loading app…</div>}
      </div>
    </div>
  );
}

const styles = {
  wrap: { minHeight: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  bar: {
    display: 'flex', alignItems: 'center', gap: 14, padding: '8px 16px',
    background: 'var(--header)', borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  barMeta: { fontSize: 12.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 7 },
  dot: { opacity: 0.5 },
  appArea: { flex: 1, padding: '16px', minWidth: 0 },
  loading: { padding: 40, color: 'var(--muted)', fontSize: 14 },
};
