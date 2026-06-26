import { useEffect, useRef, useState } from 'react';

/*
 * UpdateBell — a notification bell shown in the header of every page.
 *
 * It replaces the old auto pop-up "new version" toast. The bell quietly polls
 * /version.json (emitted into each deploy by vite.config.js) and compares the
 * DEPLOYED version to the version THIS tab was built as (__APP_VERSION__). When a
 * newer version is live the bell rings — a gentle swing, a pulsing red dot, and a
 * soft gold halo — and clicking it opens a glass panel with the new version
 * number, how to update, and a "What's new" list. The notes travel inside
 * version.json, so even a stale tab can show what changed in the version it
 * doesn't have yet.
 *
 * Theme-aware via the shared CSS variables, so it matches light/dark everywhere —
 * the portal screens AND inside the FinTrack app. The button/close hover, press,
 * and focus states + animations live in global.css (.ub-* classes).
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
        className={`ub-bell-btn${ringing ? ' is-ringing' : ''}`}
        aria-label={hasUpdate ? `Update available: version ${latest}` : 'Notifications'}
        aria-haspopup="dialog" aria-expanded={open}
        title={hasUpdate ? `New version v${latest} available` : "Notifications — you're up to date"}>
        {ringing && <span className="ub-halo" aria-hidden="true" />}
        <i className={`ti ti-bell${ringing ? '-ringing ub-bell-icon' : ''}`} aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }} />
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

// small-caps tracked section label
const labelStyle = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 };
// the version "build tag" — monospace + tabular figures so it reads precise
const chip = (accent) => ({ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 600, letterSpacing: '0.01em', color: accent ? 'var(--accent)' : 'var(--text)', background: accent ? 'var(--accent-bg)' : 'var(--surface-2)', border: `1px solid ${accent ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`, borderRadius: 7, padding: '2px 9px' });

function Panel({ hasUpdate, latest, build, notes, onClose }) {
  const num = (n) => (
    <span style={{ flexShrink: 0, width: 19, height: 19, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>{n}</span>
  );
  return (
    <div role="dialog" aria-label="Version notifications"
      style={{
        position: 'absolute', top: 48, right: 0, zIndex: 4000,
        width: 'min(344px, calc(100vw - 28px))',
        background: 'color-mix(in srgb, var(--surface) 84%, transparent)',
        backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow, 0 18px 50px -14px rgba(0,0,0,0.5)), inset 0 1px 0 rgba(255,255,255,0.10)',
        overflow: 'hidden', animation: 'bell-panel-in 0.2s cubic-bezier(0.16,1,0.3,1) forwards',
      }}>
      {/* header — soft gradient */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderBottom: '1px solid var(--border)',
        background: hasUpdate
          ? 'linear-gradient(135deg, var(--accent-bg), color-mix(in srgb, var(--accent) 4%, var(--surface)))'
          : 'linear-gradient(135deg, var(--surface-2), var(--surface))',
      }}>
        <i className={`ti ti-${hasUpdate ? 'circle-arrow-up' : 'circle-check'}`} aria-hidden="true" style={{ fontSize: 20, color: hasUpdate ? 'var(--accent)' : 'var(--success)' }} />
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', flex: 1 }}>{hasUpdate ? 'Update available' : "You're up to date"}</div>
        <button type="button" onClick={onClose} aria-label="Close" className="ub-close">
          <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 17 }} />
        </button>
      </div>

      <div style={{ padding: '14px 15px', maxHeight: '62vh', overflowY: 'auto' }}>
        {/* version line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: (hasUpdate || notes.length) ? 16 : 0 }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{hasUpdate ? 'New version' : 'Current version'}</span>
          <span style={chip(hasUpdate)}>v{hasUpdate ? latest : (build || '—')}</span>
        </div>

        {/* how to update — numbered steps */}
        {hasUpdate && (
          <div style={{ marginBottom: 18 }}>
            <div style={labelStyle}><i className="ti ti-refresh" aria-hidden="true" style={{ fontSize: 13, color: 'var(--accent)' }} /> How to update</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>{num(1)}<span style={{ fontSize: 12.5, lineHeight: 1.5 }}>Log out (if you're signed in).</span></div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>{num(2)}<span style={{ fontSize: 12.5, lineHeight: 1.5 }}>Fully close this tab — or the app, if you added it to your home screen.</span></div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>{num(3)}<span style={{ fontSize: 12.5, lineHeight: 1.5 }}>Open it again. You should see <strong style={{ fontFamily: 'var(--font-mono)' }}>v{latest}</strong> on the login screen.</span></div>
            </div>
          </div>
        )}

        {/* what's new — custom accent bullets */}
        {notes.length > 0 ? (
          <div>
            <div style={labelStyle}><i className="ti ti-sparkles" aria-hidden="true" style={{ fontSize: 13, color: 'var(--accent)' }} /> What's new{hasUpdate ? '' : ' in this version'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0, marginTop: 7, width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
                  <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{n}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          !hasUpdate && <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>No new notifications. You'll see a note here when an update is available.</div>
        )}
      </div>
    </div>
  );
}
