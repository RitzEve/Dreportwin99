import { useState, useEffect, useRef } from 'react';
import { login } from '../lib/auth.js';
import InstallPrompt from '../components/InstallPrompt.jsx';

/*
 * Login — email/Name-ID + password, with a playful animated scene on the left.
 *
 * Four cartoon characters watch the cursor, blink at random, glance toward the
 * form while you type, and shyly cover/avert their eyes when the password is
 * shown (one keeps peeking). It's pure decoration — the real work is the
 * login() call below. No company picker / self-registration: the provider
 * creates companies + master accounts, and email is globally unique.
 *
 * (Adapted from a Tailwind/shadcn template into this project's plain-React +
 * inline-style + CSS-variable system, so it follows the app's light/dark theme.)
 */

// A bare pupil (used by the orange + yellow characters — no white of the eye).
function Pupil({ size = 12, maxDistance = 5, pupilColor = 'black', forceLookX, forceLookY, mouse }) {
  const ref = useRef(null);
  let x = 0, y = 0;
  if (forceLookX !== undefined && forceLookY !== undefined) {
    x = forceLookX; y = forceLookY;
  } else if (ref.current) {
    const r = ref.current.getBoundingClientRect();
    const dx = mouse.x - (r.left + r.width / 2);
    const dy = mouse.y - (r.top + r.height / 2);
    const dist = Math.min(Math.hypot(dx, dy), maxDistance);
    const a = Math.atan2(dy, dx);
    x = Math.cos(a) * dist; y = Math.sin(a) * dist;
  }
  return <div ref={ref} style={{ width: size, height: size, borderRadius: '50%', backgroundColor: pupilColor, transform: `translate(${x}px, ${y}px)`, transition: 'transform 0.1s ease-out' }} />;
}

// A full eyeball (white + pupil) that can blink (collapses to a thin line).
function EyeBall({ size = 48, pupilSize = 16, maxDistance = 10, eyeColor = 'white', pupilColor = 'black', isBlinking = false, forceLookX, forceLookY, mouse }) {
  const ref = useRef(null);
  let x = 0, y = 0;
  if (forceLookX !== undefined && forceLookY !== undefined) {
    x = forceLookX; y = forceLookY;
  } else if (ref.current) {
    const r = ref.current.getBoundingClientRect();
    const dx = mouse.x - (r.left + r.width / 2);
    const dy = mouse.y - (r.top + r.height / 2);
    const dist = Math.min(Math.hypot(dx, dy), maxDistance);
    const a = Math.atan2(dy, dx);
    x = Math.cos(a) * dist; y = Math.sin(a) * dist;
  }
  return (
    <div ref={ref} style={{ width: size, height: isBlinking ? 2 : size, backgroundColor: eyeColor, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'all 0.15s' }}>
      {!isBlinking && (
        <div style={{ width: pupilSize, height: pupilSize, borderRadius: '50%', backgroundColor: pupilColor, transform: `translate(${x}px, ${y}px)`, transition: 'transform 0.1s ease-out' }} />
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

  const [mouse, setMouse] = useState(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
  }));
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);

  const purpleRef = useRef(null);
  const blackRef = useRef(null);
  const yellowRef = useRef(null);
  const orangeRef = useRef(null);

  // Track the cursor (eyes + body lean follow it) and the viewport width.
  useEffect(() => {
    const onMove = (e) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    const mq = window.matchMedia('(min-width: 1024px)');
    const onResize = (e) => setIsWide(e.matches);
    mq.addEventListener('change', onResize);
    return () => { window.removeEventListener('mousemove', onMove); mq.removeEventListener('change', onResize); };
  }, []);

  // Random blinks (purple + black), each on its own 3–7s schedule.
  useEffect(() => makeBlinker(setIsPurpleBlinking), []);
  useEffect(() => makeBlinker(setIsBlackBlinking), []);

  // Glance at each other briefly when the user starts typing.
  useEffect(() => {
    if (!isTyping) { setIsLookingAtEachOther(false); return; }
    setIsLookingAtEachOther(true);
    const t = setTimeout(() => setIsLookingAtEachOther(false), 800);
    return () => clearTimeout(t);
  }, [isTyping]);

  // While the password is visible, purple sneakily peeks every 2–5s.
  useEffect(() => {
    if (!(password.length > 0 && showPassword)) { setIsPurplePeeking(false); return; }
    const t = setTimeout(() => {
      setIsPurplePeeking(true);
      setTimeout(() => setIsPurplePeeking(false), 800);
    }, Math.random() * 3000 + 2000);
    return () => clearTimeout(t);
  }, [password, showPassword, isPurplePeeking]);

  const pos = (ref) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
    const r = ref.current.getBoundingClientRect();
    const dx = mouse.x - (r.left + r.width / 2);
    const dy = mouse.y - (r.top + r.height / 3);
    return {
      faceX: Math.max(-15, Math.min(15, dx / 20)),
      faceY: Math.max(-10, Math.min(10, dy / 30)),
      bodySkew: Math.max(-6, Math.min(6, -dx / 120)),
    };
  };
  const purplePos = pos(purpleRef);
  const blackPos = pos(blackRef);
  const yellowPos = pos(yellowRef);
  const orangePos = pos(orangeRef);

  const pw = password.length > 0;
  const covering = pw && showPassword;        // eyes shielded while password is shown
  const leaning = isTyping || (pw && !showPassword);

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
      {/* Left — animated character scene (desktop only) */}
      {isWide && (
        <div style={styles.left}>
          <div style={styles.scene}>
            <div style={{ position: 'relative', width: 550, height: 400 }}>
              {/* Purple — back layer */}
              <div ref={purpleRef} style={{
                position: 'absolute', bottom: 0, left: 70, width: 180,
                height: leaning ? 440 : 400, backgroundColor: '#6C3FF5', borderRadius: '10px 10px 0 0', zIndex: 1,
                transform: covering ? 'skewX(0deg)' : leaning ? `skewX(${(purplePos.bodySkew) - 12}deg) translateX(40px)` : `skewX(${purplePos.bodySkew}deg)`,
                transformOrigin: 'bottom center', transition: 'all 0.7s ease-in-out',
              }}>
                <div style={{
                  position: 'absolute', display: 'flex', gap: 32, transition: 'all 0.7s ease-in-out',
                  left: covering ? 20 : isLookingAtEachOther ? 55 : 45 + purplePos.faceX,
                  top: covering ? 35 : isLookingAtEachOther ? 65 : 40 + purplePos.faceY,
                }}>
                  {[0, 1].map((i) => (
                    <EyeBall key={i} size={18} pupilSize={7} maxDistance={5} pupilColor="#2D2D2D" isBlinking={isPurpleBlinking} mouse={mouse}
                      forceLookX={covering ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
                      forceLookY={covering ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined} />
                  ))}
                </div>
              </div>

              {/* Black — middle layer */}
              <div ref={blackRef} style={{
                position: 'absolute', bottom: 0, left: 240, width: 120, height: 310,
                backgroundColor: '#2D2D2D', borderRadius: '8px 8px 0 0', zIndex: 2,
                transform: covering ? 'skewX(0deg)' : isLookingAtEachOther ? `skewX(${blackPos.bodySkew * 1.5 + 10}deg) translateX(20px)` : leaning ? `skewX(${blackPos.bodySkew * 1.5}deg)` : `skewX(${blackPos.bodySkew}deg)`,
                transformOrigin: 'bottom center', transition: 'all 0.7s ease-in-out',
              }}>
                <div style={{
                  position: 'absolute', display: 'flex', gap: 24, transition: 'all 0.7s ease-in-out',
                  left: covering ? 10 : isLookingAtEachOther ? 32 : 26 + blackPos.faceX,
                  top: covering ? 28 : isLookingAtEachOther ? 12 : 32 + blackPos.faceY,
                }}>
                  {[0, 1].map((i) => (
                    <EyeBall key={i} size={16} pupilSize={6} maxDistance={4} pupilColor="#2D2D2D" isBlinking={isBlackBlinking} mouse={mouse}
                      forceLookX={covering ? -4 : isLookingAtEachOther ? 0 : undefined}
                      forceLookY={covering ? -4 : isLookingAtEachOther ? -4 : undefined} />
                  ))}
                </div>
              </div>

              {/* Orange — front left semicircle */}
              <div ref={orangeRef} style={{
                position: 'absolute', bottom: 0, left: 0, width: 240, height: 200, zIndex: 3,
                backgroundColor: '#FF9B6B', borderRadius: '120px 120px 0 0',
                transform: covering ? 'skewX(0deg)' : `skewX(${orangePos.bodySkew}deg)`,
                transformOrigin: 'bottom center', transition: 'all 0.7s ease-in-out',
              }}>
                <div style={{
                  position: 'absolute', display: 'flex', gap: 32, transition: 'all 0.2s ease-out',
                  left: covering ? 50 : 82 + orangePos.faceX,
                  top: covering ? 85 : 90 + orangePos.faceY,
                }}>
                  {[0, 1].map((i) => (
                    <Pupil key={i} size={12} maxDistance={5} pupilColor="#2D2D2D" mouse={mouse}
                      forceLookX={covering ? -5 : undefined} forceLookY={covering ? -4 : undefined} />
                  ))}
                </div>
              </div>

              {/* Yellow — front right */}
              <div ref={yellowRef} style={{
                position: 'absolute', bottom: 0, left: 310, width: 140, height: 230,
                backgroundColor: '#E8D754', borderRadius: '70px 70px 0 0', zIndex: 4,
                transform: covering ? 'skewX(0deg)' : `skewX(${yellowPos.bodySkew}deg)`,
                transformOrigin: 'bottom center', transition: 'all 0.7s ease-in-out',
              }}>
                <div style={{
                  position: 'absolute', display: 'flex', gap: 24, transition: 'all 0.2s ease-out',
                  left: covering ? 20 : 52 + yellowPos.faceX,
                  top: covering ? 35 : 40 + yellowPos.faceY,
                }}>
                  {[0, 1].map((i) => (
                    <Pupil key={i} size={12} maxDistance={5} pupilColor="#2D2D2D" mouse={mouse}
                      forceLookX={covering ? -5 : undefined} forceLookY={covering ? -4 : undefined} />
                  ))}
                </div>
                <div style={{
                  position: 'absolute', width: 80, height: 4, backgroundColor: '#2D2D2D', borderRadius: 999, transition: 'all 0.2s ease-out',
                  left: covering ? 10 : 40 + yellowPos.faceX,
                  top: covering ? 88 : 88 + yellowPos.faceY,
                }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right — login form */}
      <div style={styles.right}>
        <div style={{ width: '100%', maxWidth: 400 }}>
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
                onFocus={() => setIsTyping(true)} onBlur={() => setIsTyping(false)}
                style={styles.input} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="password" style={styles.label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setIsTyping(true)} onBlur={() => setIsTyping(false)}
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
            Secure access · authorised accounts only · v1.6.27
          </div>
        </div>
      </div>
    </div>
  );
}

// Schedules a recurring random blink; returns a cleanup for the pending timeout.
function makeBlinker(setBlink) {
  let timeout;
  const schedule = () => {
    timeout = setTimeout(() => {
      setBlink(true);
      setTimeout(() => { setBlink(false); schedule(); }, 150);
    }, Math.random() * 4000 + 3000);
  };
  schedule();
  return () => clearTimeout(timeout);
}

const styles = {
  left: {
    position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    // DRWin brand: gold glow over a near-black base — the gold-shield-on-black identity.
    background: 'radial-gradient(120% 85% at 78% 12%, rgba(227,179,65,0.30), transparent 55%), radial-gradient(110% 80% at 12% 92%, rgba(166,124,0,0.20), transparent 52%), linear-gradient(155deg, #14130f 0%, #211d12 52%, #100f0c 100%)',
    padding: 24,
  },
  scene: { display: 'flex', alignItems: 'flex-end', justifyContent: 'center', transform: 'scale(0.82)', transformOrigin: 'center bottom' },
  right: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', background: 'var(--bg)' },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 7 },
  input: { padding: '13px 14px', fontSize: 15, borderRadius: 10 },
  eyeBtn: {
    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
    background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)',
    fontSize: 19, padding: 6, display: 'flex', alignItems: 'center',
  },
};
