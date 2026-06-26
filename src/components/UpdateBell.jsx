import { useEffect, useRef, useState } from 'react';

/*
 * UpdateBell — a notification bell shown in the header of every page.
 *
 * It replaces the old auto pop-up "new version" toast. The bell quietly polls
 * /version.json (emitted into each deploy by vite.config.js) and compares the
 * DEPLOYED version to the version THIS tab was built as (__APP_VERSION__). When a
 * newer version is live the bell rings (gentle swing + a red dot); clicking it
 * opens a panel with the new version number, how to update, and a "What's new"
 * list. The notes travel inside version.json, so even a stale tab can show what
 * changed in the version it doesn't have yet.
 *
 * Theme-aware via the shared CSS variables, so it matches light/dark everywhere —
 * the portal screens AND inside the FinTrack app.
 */

const BUILD = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;
const SEEN_KEY = 'portal-update-seen-v1';

export default function UpdateBell() {
  const [latest, setLatest] = useState(null);
  const [notes, setNotes] = useState([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; } });
  const wrapRef = useRef(null);

  // Poll the deployed version.json: shortly after load, every minute, and on focus.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok || stopped) return;
        const d = await r.json();
        if (stopped) return;
        if (d && d.version) setLatest(d.version);
        setNotes(d && Array.isArray(d.notes) ? d.notes : []);
      } catch { /* offline or dev (no version.json) — ignore */ }
    };
    const t0 = setTimeout(check, 3000);
    const iv = setInterval(check, 60000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { stopped = true; clearTimeout(t0); clearInterval(iv); window.removeEventListener('focus', onFocus); };
  }, []);

  // Close the panel on outside-click or Esc.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const hasUpdate = !!(BUILD && latest && latest !== BUILD);
  const ringing = hasUpdate && seen !== latest; // ring/blink until the user opens the panel once

  const toggle = () => {
    setOpen((o) => !o);
    if (ringing) { try { localStorage.setItem(SEEN_KEY, latest); } catch { /* ignore */ } setSeen(latest); }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button" onClick={toggle}
        aria-label={hasUpdate ? `Update available: version ${latest}` : 'Notifications'}
        aria-haspopup="dialog" aria-expanded={open}
        title={hasUpdate ? `New version v${latest} available` : "Notifications — you're up to date"}
        style={{
          position: 'relative', width: 38, height: 38, flexShrink: 0, borderRadius: 10,
          border: `1px solid ${ringing ? 'var(--accent)' : 'var(--border)'}`,
          background: ringing ? 'var(--accent-bg)' : 'var(--surface-2)',
          color: ringing ? 'var(--accent)' : 'var(--muted)',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          transition: 'border-color 0.2s, background 0.2s, color 0.2s',
        }}>
        <i className={`ti ti-bell${ringing ? '-ringing' : ''}${ringing ? ' ub-bell-icon' : ''}`} aria-hidden="true" style={{ fontSize: 19, lineHeight: 1, transformOrigin: '50% 3px' }} />
        {hasUpdate && (
          <span className={ringing ? 'ub-bell-dot' : undefined} style={{
            position: 'absolute', top: 5, right: 5, width: 9, height: 9, borderRadius: '50%',
            background: 'var(--danger)', border: '2px solid var(--surface-2)',
          }} />
        )}
      </button>

      {open && <Panel hasUpdate={hasUpdate} latest={latest} build={BUILD} notes={notes} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Panel({ hasUpdate, latest, build, notes, onClose }) {
  return (
    <div role="dialog" aria-label="Version notifications"
      style={{
        position: 'absolute', top: 46, right: 0, zIndex: 4000,
        width: 'min(344px, calc(100vw - 28px))',
        background: 'var(--surface)', color: 'var(--text)',
        border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: 'var(--shadow, 0 18px 50px -14px rgba(0,0,0,0.5))',
        overflow: 'hidden', animation: 'bell-panel-in 0.18s ease forwards',
      }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderBottom: '1px solid var(--border)', background: hasUpdate ? 'var(--accent-bg)' : 'var(--surface-2)' }}>
        <i className={`ti ti-${hasUpdate ? 'rocket' : 'circle-check'}`} aria-hidden="true" style={{ fontSize: 20, color: hasUpdate ? 'var(--accent)' : 'var(--success)' }} />
        <div style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{hasUpdate ? 'Update available' : "You're up to date"}</div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--muted)', padding: 2, display: 'inline-flex' }}>
          <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 17 }} />
        </button>
      </div>

      <div style={{ padding: '13px 14px', maxHeight: '62vh', overflowY: 'auto' }}>
        {/* version line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: (hasUpdate || notes.length) ? 12 : 0 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{hasUpdate ? 'New version' : 'Current version'}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: hasUpdate ? 'var(--accent)' : 'var(--text)', background: hasUpdate ? 'var(--accent-bg)' : 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 10px' }}>
            v{hasUpdate ? latest : (build || '—')}
          </span>
        </div>

        {/* how to update */}
        {hasUpdate && (
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ti ti-refresh" aria-hidden="true" style={{ color: 'var(--accent)' }} /> How to update
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.65, color: 'var(--text)' }}>
              <li>Log out (if you're signed in).</li>
              <li>Fully close this tab — or the app, if you added it to your home screen.</li>
              <li>Open it again. You should see <strong>v{latest}</strong> on the login screen.</li>
            </ol>
          </div>
        )}

        {/* what's new */}
        {notes.length > 0 ? (
          <>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ti ti-sparkles" aria-hidden="true" style={{ color: 'var(--accent)' }} /> What's new{hasUpdate ? '' : ' in this version'}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>
              {notes.map((n, i) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}
            </ul>
          </>
        ) : (
          !hasUpdate && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No new notifications. You'll see a note here when an update is available.</div>
        )}
      </div>
    </div>
  );
}
