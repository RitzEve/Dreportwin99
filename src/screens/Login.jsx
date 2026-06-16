import { useState } from 'react';
import { login, SEED_LOGINS } from '../lib/auth.js';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showTest, setShowTest] = useState(false);

  function submit(e) {
    e.preventDefault();
    const res = login({ email, password });
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
            <label>Email</label>
            <input
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }}>
            <i className="ti ti-login-2" aria-hidden="true" /> Sign in
          </button>
        </form>

        {/* Dev helper — remove this block for production. */}
        <div style={styles.testWrap}>
          <button type="button" onClick={() => setShowTest((s) => !s)} style={styles.testToggle}>
            <i className={`ti ti-chevron-${showTest ? 'up' : 'down'}`} aria-hidden="true" /> Test logins
          </button>
          {showTest && (
            <div style={styles.testList}>
              {SEED_LOGINS.map((l) => (
                <button key={l.email} type="button" style={styles.testItem}
                  onClick={() => { setEmail(l.email); setPassword(l.password); setError(''); }}>
                  <span style={{ fontWeight: 600 }}>{l.label}</span>
                  <span style={{ color: 'var(--muted)' }}>{l.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.footnote}>
        Prototype · data is stored in this browser only. See README for going live.
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
  testWrap: { marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 12 },
  testToggle: {
    background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer',
    fontSize: 12, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0,
  },
  testList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 },
  testItem: {
    display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px',
    fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
    background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
  },
  footnote: { fontSize: 12, color: 'var(--muted)', textAlign: 'center', maxWidth: 420 },
};
