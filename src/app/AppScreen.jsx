import { useEffect, useRef, useState } from 'react';
import { changeOwnPassword, listTeam } from '../lib/auth.js';
import { setTheme } from '../lib/theme.js';
import FluxLoader from '../components/FluxLoader.jsx';
import Guide from '../screens/Guide.jsx';
import useIsMobile from '../lib/useIsMobile.js';

/*
 * AppScreen — hosts the FinTrack artifact for the logged-in company.
 *
 * The artifact reads `window.FINTRACK_SESSION` ONCE at module-evaluation time, so
 * we set the session BEFORE importing it (the import is dynamic, inside the effect).
 */
export default function AppScreen({ ctx, onExit, onLogout, canReturnToConsole = true }) {
  const [Comp, setComp] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const isMobile = useIsMobile();
  // Identifies the signed-in session (company+user), not the `ctx` object itself.
  const sessionKeyRef = useRef(null);

  useEffect(() => {
    if (!ctx || !ctx.company) { onLogout(); return; }

    window.FINTRACK_SESSION = {
      companyId: ctx.company.id,
      companyName: ctx.company.name,
      companyLogo: ctx.company.logo || '',
      timezone: ctx.company.timezone || 'Australia/Sydney',
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

    // Supabase re-fires onAuthStateChange (and Root.jsx rebuilds `ctx` from scratch)
    // whenever the tab regains focus after being backgrounded, as part of its own
    // session-refresh check — even though the signed-in company/user hasn't changed.
    // Only treat this as a REAL reload (which resets Comp -> remounts FinTrack,
    // losing whatever page/scroll state the user was on) when the company or user
    // actually changed, or the user hit Retry. Otherwise just refresh the window
    // globals below and let FinTrack's own lightweight visibility-poll (inside the
    // artifact) pull any new data — don't force a full re-mount / full data re-fetch.
    const sessionKey = `${ctx.company.id}|${ctx.user.id}`;
    const isFreshSession = sessionKeyRef.current !== sessionKey;
    sessionKeyRef.current = sessionKey;

    let alive = true;
    if (isFreshSession) {
      setComp(null);
      setLoadError(false);
    }
    (async () => {
      try {
        // The shift roster / off-day cards are drawn from the company's real
        // accounts, so FinTrack needs the team list too — fetch it before the
        // import, same reason FINTRACK_SESSION is set before it (the artifact
        // reads both ONCE at module-evaluation time).
        const team = await listTeam(ctx.company.id).catch(() => []);
        window.FINTRACK_TEAM = team
          .filter((t) => t.active !== false)
          .map((t) => ({ id: t.id, operatorId: t.operatorId, name: t.name, role: t.role, nationality: t.nationality || '' }));
        const m = await import('./FinTrack.jsx');
        if (alive) { setComp(() => m.default); setLoadError(false); }
      } catch (err) {
        // A failed/blocked chunk load (bad deploy, flaky network) rejects this
        // promise outside React's render pipeline, so ErrorBoundary in Root.jsx
        // never sees it — without this catch the user is stuck on the loading
        // spinner forever with no way to recover. Surface it + offer a retry.
        console.error('AppScreen: failed to load the app', err);
        if (alive) setLoadError(true);
      }
    })();
    return () => { alive = false; };
  }, [ctx, onLogout, retryTick]);

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
          {ctx?.company?.logo
            ? <img src={ctx.company.logo} alt={ctx?.company?.name} title={ctx?.company?.name} style={styles.barLogo} />
            : <><i className="ti ti-building" aria-hidden="true" /> {ctx?.company?.name}</>}
          <span style={styles.dot}>·</span>
          {ctx?.user.operatorId} ({ctx?.user.role})
        </span>
        <button className="ub-bell-btn" style={{ marginLeft: 'auto' }} onClick={() => setGuideOpen(true)}
          title="Help / How to use" aria-label="Help / How to use">
          <i className="ti ti-help" aria-hidden="true" style={{ fontSize: 18 }} />
        </button>
      </div>
      <Guide open={guideOpen} role={ctx?.user?.role} onClose={() => setGuideOpen(false)} />
      <div style={{ ...styles.appArea, padding: isMobile ? 0 : '16px' }}>
        {Comp ? <Comp /> : loadError ? (
          <div style={styles.loadingWrap}>
            <div style={styles.errorCard}>
              <i className="ti ti-alert-triangle" aria-hidden="true" style={styles.errorIcon} />
              <div style={styles.errorTitle}>Couldn't load the app</div>
              <div style={styles.errorBody}>
                Your data is safe — this was just a loading problem. Check your connection and try again.
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setRetryTick((n) => n + 1)}>
                <i className="ti ti-refresh" aria-hidden="true" /> Retry
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.loadingWrap}>
            <FluxLoader phases={[
              { at: 0, label: 'opening app' },
              { at: 40, label: 'loading your data' },
              { at: 75, label: 'almost there' },
              { at: 100, label: 'ready' },
            ]} />
          </div>
        )}
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
  barLogo: { height: 20, maxWidth: 130, objectFit: 'contain', display: 'block' },
  dot: { opacity: 0.5 },
  appArea: { flex: 1, padding: '16px', minWidth: 0 },
  loadingWrap: { minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' },
  errorCard: { maxWidth: 380, textAlign: 'center' },
  errorIcon: { fontSize: 34, color: 'var(--danger)', marginBottom: 10, display: 'block' },
  errorTitle: { fontSize: 16, fontWeight: 600, marginBottom: 6, color: 'var(--text)' },
  errorBody: { fontSize: 13, opacity: 0.75, marginBottom: 18, lineHeight: 1.5, color: 'var(--text)' },
};
