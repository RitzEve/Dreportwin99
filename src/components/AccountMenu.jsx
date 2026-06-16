import { useEffect, useRef, useState } from 'react';
import { changeOwnPassword } from '../lib/auth.js';
import { getTheme, setTheme } from '../lib/theme.js';

/*
 * AccountMenu — the top-right member button used on the Provider & Console pages.
 * Popup contains: Light/Dark theme toggle, Change password, Log out.
 * (The in-app FinTrack screen has its own matching menu.)
 */
export default function AccountMenu({ user, roleLabel, onLogout }) {
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const ref = useRef(null);
  const initials = (user.operatorId || user.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function pick(t) { setTheme(t); setThemeState(t); }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button onClick={() => setOpen((o) => !o)} style={S.trigger}>
        <span style={S.avatar}>{initials}</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{user.name}</span>
        <i className={`ti ti-chevron-${open ? 'up' : 'down'}`} aria-hidden="true" style={{ fontSize: 14, color: 'var(--muted)' }} />
      </button>

      {open && (
        <div style={S.popup}>
          <div style={S.head}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</div>
            <div style={S.sub}>{user.operatorId} · {roleLabel}</div>
            <div style={S.sub}>{user.email}</div>
          </div>

          <div style={S.section}>
            <div style={S.sectionLabel}>Theme</div>
            <div style={S.segmented}>
              <button onClick={() => pick('light')} style={{ ...S.seg, ...(theme === 'light' ? S.segActive : {}) }}>
                <i className="ti ti-sun" aria-hidden="true" /> Light
              </button>
              <button onClick={() => pick('dark')} style={{ ...S.seg, ...(theme === 'dark' ? S.segActive : {}) }}>
                <i className="ti ti-moon" aria-hidden="true" /> Dark
              </button>
            </div>
          </div>

          <button style={S.item} onClick={() => { setOpen(false); setPwOpen(true); }}>
            <i className="ti ti-key" aria-hidden="true" style={{ color: 'var(--accent)' }} /> Change password
          </button>
          <button style={{ ...S.item, color: 'var(--danger)', fontWeight: 500, borderTop: '1px solid var(--border)' }} onClick={onLogout}>
            <i className="ti ti-logout" aria-hidden="true" /> Log out
          </button>
        </div>
      )}

      {pwOpen && <ChangePasswordModal user={user} onClose={() => setPwOpen(false)} />}
    </div>
  );
}

function ChangePasswordModal({ user, onClose }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setOk('');
    if (next !== confirm) return setError('New passwords do not match.');
    setBusy(true);
    const res = await changeOwnPassword(cur, next);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOk('Password updated.');
    setCur(''); setNext(''); setConfirm('');
    setTimeout(onClose, 1100);
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <div style={S.modalTitle}><i className="ti ti-key" aria-hidden="true" style={{ color: 'var(--accent)' }} /> Change password</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
        <form style={S.modalBody} onSubmit={submit}>
          <div style={S.sub}>{user.operatorId} · {user.email}</div>
          <div className="field"><label>Current password</label>
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="••••••••" /></div>
          <div className="field"><label>New password</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 6 characters" /></div>
          <div className="field" style={{ margin: 0 }}><label>Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter new password" /></div>
          {error && <div className="error-text">{error}</div>}
          {ok && <div className="success-text"><i className="ti ti-circle-check" aria-hidden="true" />{ok}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <i className={`ti ti-${busy ? 'loader-2' : 'check'}`} aria-hidden="true" /> {busy ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const S = {
  trigger: {
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9,
    padding: '6px 10px 6px 6px', color: 'var(--text)', fontFamily: 'inherit',
  },
  avatar: {
    width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0,
  },
  popup: {
    position: 'absolute', top: '100%', right: 0, marginTop: 6, minWidth: 230, zIndex: 60, overflow: 'hidden',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, boxShadow: 'var(--shadow)',
  },
  head: { padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--header)' },
  sub: { fontSize: 11.5, color: 'var(--muted)' },
  section: { padding: '10px 14px', borderBottom: '1px solid var(--border)' },
  sectionLabel: { fontSize: 11, color: 'var(--muted)', marginBottom: 6 },
  segmented: { display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 8, padding: 3 },
  seg: {
    flex: 1, cursor: 'pointer', border: 'none', borderRadius: 6, padding: '6px 8px', fontSize: 12.5,
    fontFamily: 'inherit', background: 'transparent', color: 'var(--muted)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  segActive: { background: 'var(--surface)', color: 'var(--text)', boxShadow: '0 1px 3px rgba(0,0,0,0.18)', fontWeight: 600 },
  item: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px',
    background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)',
    textAlign: 'left', fontFamily: 'inherit',
  },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)', overflow: 'hidden' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--header)' },
  modalTitle: { fontSize: 15.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  modalBody: { padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
};
