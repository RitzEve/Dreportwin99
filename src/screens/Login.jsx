import { useEffect, useMemo, useState } from 'react';
import { login } from '../lib/auth.js';
import InstallPrompt from '../components/InstallPrompt.jsx';
import UpdateBell from '../components/UpdateBell.jsx';

/*
 * Login — email/Name-ID + password, with the DRW shield as a quiet ambient
 * hero on the left (desktop). A field of small gold sparkles drifts in
 * place behind it; nothing tracks the cursor. No company picker /
 * self-registration: the provider creates companies + master accounts, and
 * email is globally unique.
 */

// Deterministic pseudo-random sparkle field, generated once per mount.
function useSparkles(count) {
  return useMemo(() => Array.from({ length: count }, (_, i) => ({
    key: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: 1.5 + Math.random() * 2.5,
    delay: Math.random() * 5,
    duration: 2.8 + Math.random() * 3.4,
  })), [count]);
}

function ShieldMark({ size = 64, wordmark = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: wordmark ? 14 : 0 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <div data-motion="glow" style={{
          position: 'absolute', inset: -size * 0.45, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(227,179,65,0.42) 0%, rgba(227,179,65,0.14) 45%, transparent 72%)',
          filter: `blur(${size * 0.22}px)`, animation: 'login-shield-glow 5.5s ease-in-out infinite',
        }} />
        <img src="/icons/icon-512.png" alt="DRW" width={size} height={size}
          style={{ position: 'relative', width: size, height: size, borderRadius: size * 0.22, display: 'block', filter: 'drop-shadow(0 8px 22px rgba(0,0,0,0.45))' }} />
      </div>
      {wordmark && (
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.34em', color: '#f4ecd8', paddingLeft: '0.34em' }}>DRW</div>
      )}
    </div>
  );
}

export default function Login({ onAuthed }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);

  const sparkles = useSparkles(55);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onResize = (e) => setIsWide(e.matches);
    mq.addEventListener('change', onResize);
    return () => mq.removeEventListener('change', onResize);
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const res = await login({ identifier, password });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onAuthed();
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: isWide ? '1fr 1fr' : '1fr', background: 'var(--bg)' }}>
      {/* Notification bell — fixed top-right so it's on the login screen too */}
      <div style={{ position: 'fixed', top: 'max(14px, env(safe-area-inset-top))', right: 14, zIndex: 50 }}>
        <UpdateBell />
      </div>
      {/* Left — ambient brand panel (desktop only) */}
      {isWide && (
        <div style={styles.left}>
          <div style={styles.sparkleField} aria-hidden="true">
            {sparkles.map((s) => (
              <div key={s.key} data-motion="sparkle" style={{
                position: 'absolute', left: `${s.left}%`, top: `${s.top}%`,
                width: s.size, height: s.size, borderRadius: '50%',
                background: s.key % 3 === 0 ? '#e3b341' : '#f4ecd8',
                animation: `login-sparkle-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
              }} />
            ))}
          </div>
          <ShieldMark size={112} wordmark />
        </div>
      )}

      {/* Right — login form */}
      <div style={styles.right}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {!isWide && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
              <ShieldMark size={48} />
            </div>
          )}
          <div style={{ textAlign: 'center', marginBottom: 34 }}>
            <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', margin: '0 0 8px' }}>Welcome back</h1>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: 0 }}>Sign in to continue</p>
          </div>

          <form onSubmit={submit}>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="identifier" style={styles.label}>Name / ID or Email</label>
              <input id="identifier" type="text" autoComplete="username"
                placeholder="e.g. Mario  or  mario@company.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                style={styles.input} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="password" style={styles.label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ ...styles.input, paddingRight: 42 }} />
                <button type="button" onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={styles.eyeBtn}>
                  <i className={`ti ti-${showPassword ? 'eye-off' : 'eye'}`} aria-hidden="true" />
                </button>
              </div>
            </div>

            {error && <div className="error-text" style={{ marginBottom: 12, marginTop: 4 }}>{error}</div>}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', height: 48, fontSize: 15 }} disabled={busy}>
              <i className={`ti ti-${busy ? 'loader-2' : 'login-2'}`} aria-hidden="true" /> {busy ? 'Signing in…' : 'Log in'}
            </button>
          </form>

          <InstallPrompt />

          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 26 }}>
            Secure access · authorised accounts only · V2.2.5
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  left: {
    position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    // DRW brand: gold glow over a near-black base — the gold-shield-on-black identity.
    background: 'radial-gradient(120% 85% at 78% 12%, rgba(227,179,65,0.30), transparent 55%), radial-gradient(110% 80% at 12% 92%, rgba(166,124,0,0.20), transparent 52%), linear-gradient(155deg, #14130f 0%, #211d12 52%, #100f0c 100%)',
    padding: 24,
  },
  sparkleField: { position: 'absolute', inset: 0 },
  right: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', background: 'var(--bg)' },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 7 },
  input: { padding: '13px 14px', fontSize: 15, borderRadius: 10 },
  eyeBtn: {
    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
    background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)',
    fontSize: 19, padding: 6, display: 'flex', alignItems: 'center',
  },
};
