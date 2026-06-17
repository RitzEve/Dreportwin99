import { useState } from 'react';
import { login } from '../lib/auth.js';

/*
 * Login — email + password only.
 *
 * No company picker and no self-registration: the provider creates companies and
 * their master accounts. Email is globally unique, so the account (and its company)
 * is resolved from the email alone. After login, Root routes by role:
 *   provider -> Provider backend
 *   master / manager -> Console
 *   staff -> straight into the app.
 */
export default function Login({ onAuthed }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <div style={styles.logo}><i className="ti ti-building-bank" aria-hidden="true" /></div>
          <div>
            <div style={styles.brandName}>Company Portal</div>
            <div style={styles.brandSub}>Secure access to your financial workspace</div>
          </div>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label>Name / ID or Email</label>
            <input
              type="text"
              autoComplete="username"
              placeholder="e.g. Mario  or  mario@company.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
            <i className={`ti ti-${busy ? 'loader-2' : 'login-2'}`} aria-hidden="true" /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>

      <div style={styles.footnote}>
        Secure access · authorised accounts only · v1.1.2
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: '32px 16px', gap: 16,
  },
  card: {
    width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, padding: '28px 28px 24px', boxShadow: 'var(--shadow)',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 },
  logo: {
    width: 44, height: 44, borderRadius: 12, background: 'var(--accent)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0,
  },
  brandName: { fontSize: 18, fontWeight: 600 },
  brandSub: { fontSize: 12.5, color: 'var(--muted)', marginTop: 2 },
  footnote: { fontSize: 12, color: 'var(--muted)', textAlign: 'center', maxWidth: 420 },
};
