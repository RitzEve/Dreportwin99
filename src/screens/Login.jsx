import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { login } from '../lib/auth.js';
import { applyTheme } from '../lib/theme.js';
import InstallPrompt from '../components/InstallPrompt.jsx';
import UpdateBell from '../components/UpdateBell.jsx';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

// Lazy-loaded: Three.js + @react-three/fiber + @react-three/drei add ~230KB
// gzipped, which would otherwise bloat EVERY page's bundle (Provider/Console/
// FinTrack included) just for this login-screen decoration. Split into its
// own chunk, fetched only once Login.jsx actually renders — someone already
// signed in (session persists) never mounts Login at all, so they never pay
// for this chunk, same reasoning as FinTrack.jsx's own lazy-load in AppScreen.jsx.
const Beams = lazy(() => import('../components/Beams.jsx'));

/*
 * Login — email/Name-ID + password, staged over a full-bleed dark hero: the
 * real react-bits "Beams" component (Three.js / @react-three/fiber), gold-
 * tinted to match the brand, sweeping behind a centred glass card (nothing
 * tracks the cursor — a first CSS-only approximation wasn't what the user
 * wanted, so this ports the actual WebGL component; see multi-company-portal
 * memory for why that's fine here even without shadcn/Tailwind/TypeScript —
 * R3F itself has no dependency on any of those). Always dark, regardless of
 * the site's light/dark setting — this is a fixed brand moment, not a themed
 * page. No company picker / self-registration: the provider creates
 * companies + master accounts, and email is globally unique.
 */

// Client-side speed bump only — a page refresh or a different browser resets
// it. Real enforcement lives in Supabase's own auth rate limits; this just
// stops casual repeated guessing from the form itself.
const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;
const ATTEMPTS_KEY = 'drw_login_attempts';
const LOCKOUT_KEY = 'drw_login_lockout_until';

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
  const [lockedUntil, setLockedUntil] = useState(() => Number(localStorage.getItem(LOCKOUT_KEY)) || 0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Skip the WebGL canvas entirely for reduced-motion users — no motion, no
  // GPU/battery cost, just the plain gradient background underneath it.
  const [reducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Gentle entrance for the login card — a soft fade-and-rise on mount (GSAP via
  // the useGSAP hook, which auto-reverts on unmount). Honors reduced-motion by
  // simply not running, and by skipping when the tab is hidden at mount (GSAP is
  // rAF-driven and pauses while hidden, which would otherwise leave the card blank
  // until the tab regains focus) — either way the card just shows at its natural state.
  const cardRef = useRef(null);
  useGSAP(() => {
    if (reducedMotion || document.hidden) return;
    gsap.from(cardRef.current, { opacity: 0, y: 24, duration: 0.7, ease: 'power3.out' });
  }, { scope: cardRef });

  // This screen is always the dark brand look, independent of the site's own
  // light/dark toggle. Force it just while mounted, then hand back whatever
  // the signed-in app was actually set to — never touches the saved preference.
  useEffect(() => {
    const previous = document.documentElement.dataset.theme;
    applyTheme('dark');
    return () => {
      if (previous) document.documentElement.dataset.theme = previous;
      else delete document.documentElement.dataset.theme;
    };
  }, []);

  // Countdown while locked out; clears itself (and the stored counters) at zero.
  useEffect(() => {
    if (!lockedUntil) { setSecondsLeft(0); return; }
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        localStorage.removeItem(LOCKOUT_KEY);
        localStorage.removeItem(ATTEMPTS_KEY);
        setLockedUntil(0);
        setSecondsLeft(0);
      } else {
        setSecondsLeft(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const locked = secondsLeft > 0;

  async function submit(e) {
    e.preventDefault();
    if (lockedUntil && Date.now() < lockedUntil) return;
    setError('');
    setBusy(true);
    const res = await login({ identifier, password });
    setBusy(false);
    if (!res.ok) {
      // A server-side rate limit isn't a wrong guess — don't count it against the
      // local attempt counter or stack our own cooldown on top of Supabase's.
      if (res.rateLimited) { setError(res.error); return; }
      const attempts = (Number(localStorage.getItem(ATTEMPTS_KEY)) || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        const until = Date.now() + COOLDOWN_SECONDS * 1000;
        localStorage.setItem(LOCKOUT_KEY, String(until));
        localStorage.removeItem(ATTEMPTS_KEY);
        setLockedUntil(until);
        setError('Too many attempts. Please wait before trying again.');
      } else {
        localStorage.setItem(ATTEMPTS_KEY, String(attempts));
        setError(res.error);
      }
      return;
    }
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
    onAuthed();
  }

  return (
    <div style={styles.page}>
      {/* Notification bell — fixed top-right so it's on the login screen too */}
      <div style={{ position: 'fixed', top: 'max(14px, env(safe-area-inset-top))', right: 14, zIndex: 50 }}>
        <UpdateBell />
      </div>

      {/* Ambient hero: react-bits Beams (WebGL), gold-tinted, + a vignette, full-bleed behind the card */}
      {!reducedMotion && (
        <div style={styles.beamField} aria-hidden="true">
          <Suspense fallback={null}>
            <Beams beamWidth={2} beamHeight={15} beamNumber={12} lightColor="#e3b341" speed={2} noiseIntensity={1.75} scale={0.2} rotation={-25} />
          </Suspense>
        </div>
      )}
      <div style={styles.vignette} aria-hidden="true" />

      {/* Login card */}
      <div ref={cardRef} style={styles.card}>
        <ShieldMark size={56} />
        <h1 style={styles.heading}>Welcome back</h1>
        <p style={styles.subheading}>Sign in to continue</p>

        <form onSubmit={submit} style={{ width: '100%' }}>
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

          {error && <div className="error-text" style={{ marginBottom: 12, marginTop: 4, textAlign: 'left' }}>{error}</div>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', height: 48, fontSize: 15 }} disabled={busy || locked}>
            <i className={`ti ti-${locked ? 'lock' : busy ? 'loader-2' : 'login-2'}`} aria-hidden="true" /> {locked ? `Try again in ${secondsLeft}s` : busy ? 'Signing in…' : 'Log in'}
          </button>
        </form>

        <InstallPrompt />

        <div style={styles.footer}>
          Secure access · authorised accounts only · V2.5.7
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    position: 'relative', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', padding: 24,
    // DRW brand: gold glow over a near-black base — the gold-shield-on-black identity.
    background: 'radial-gradient(120% 85% at 78% 12%, rgba(227,179,65,0.30), transparent 55%), radial-gradient(110% 80% at 12% 92%, rgba(166,124,0,0.20), transparent 52%), linear-gradient(155deg, #14130f 0%, #211d12 52%, #100f0c 100%)',
  },
  beamField: { position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' },
  vignette: {
    position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
    background: 'radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)',
  },
  card: {
    position: 'relative', zIndex: 2, width: '100%', maxWidth: 400,
    background: 'rgba(15,13,10,0.72)', backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
    border: '1px solid rgba(227,179,65,0.16)', borderRadius: 18, padding: '2.25rem 2rem',
    boxShadow: '0 24px 70px -20px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.05)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
  },
  heading: { fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: '14px 0 6px', color: '#f4ecd8' },
  subheading: { fontSize: 13.5, color: 'rgba(244,236,216,0.6)', margin: '0 0 26px' },
  label: { display: 'block', textAlign: 'left', fontSize: 13, fontWeight: 500, color: 'rgba(244,236,216,0.85)', marginBottom: 7 },
  input: { padding: '13px 14px', fontSize: 15, borderRadius: 10, width: '100%' },
  eyeBtn: {
    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
    background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(244,236,216,0.5)',
    fontSize: 19, padding: 6, display: 'flex', alignItems: 'center',
  },
  footer: { textAlign: 'center', fontSize: 12, color: 'rgba(244,236,216,0.45)', marginTop: 22 },
};
