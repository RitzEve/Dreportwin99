import { useEffect, useRef, useState } from 'react';

/*
 * FluxLoader — a progressive "flux" progress bar with animated phase labels.
 *
 * Adapted from a Tailwind/shadcn/framer-motion component into this project's
 * plain-React + inline-style system (no Tailwind, no framer-motion). The vivid
 * blue→cyan fill is fixed; the track + label use the theme CSS variables so it
 * looks right in light and dark. The companion keyframes (flux-sheen,
 * flux-label-in) live in src/styles/global.css.
 *
 * Uncontrolled: it runs its own looping sweep (0→100 over `duration` seconds)
 * and shows the latest phase label crossed — perfect for indeterminate waits.
 */
const DEFAULT_PHASES = [
  { at: 0, label: 'starting up' },
  { at: 25, label: 'loading assets' },
  { at: 55, label: 'preparing magic' },
  { at: 80, label: 'almost there' },
  { at: 100, label: 'all done' },
];

const FLUX_FILL = 'linear-gradient(90deg,#1d6ffb 0%,#4aa8fd 35%,#74e1ff 55%,#4aa8fd 78%,#1d6ffb 100%)';
const FLUX_GLOW = '0 0 16px rgba(29,111,251,0.55), 0 0 28px rgba(116,225,255,0.40), inset 0 1.5px 0 rgba(255,255,255,0.5)';
const SHEEN = 'linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.6) 50%,transparent 100%)';

function pickLabel(value, phases) {
  let active = phases[0] ? phases[0].label : '';
  for (const p of phases) { if (value >= p.at) active = p.label; }
  return active;
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function FluxLoader({ phases = DEFAULT_PHASES, duration = 7, showLabel = true, maxWidth = 360 }) {
  const [pct, setPct] = useState(0);
  const rafRef = useRef(0);
  const reduced = reducedMotion();

  useEffect(() => {
    let start = null;
    const total = Math.max(600, duration * 1000);
    const tick = (ts) => {
      if (start === null) start = ts;
      const p = Math.min(100, (((ts - start) % total) / total) * 100);
      setPct(p);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [duration]);

  const label = pickLabel(pct, phases);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth }}>
      {showLabel && (
        <div style={{ position: 'relative', height: 34, width: '100%', textAlign: 'center', userSelect: 'none' }}>
          <div
            key={reduced ? 'static' : label}
            style={{
              fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--muted)',
              animation: reduced ? 'none' : 'flux-label-in 0.5s cubic-bezier(0.22,1,0.36,1)',
            }}
          >
            {label}
          </div>
        </div>
      )}

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="Loading"
        style={{
          position: 'relative', height: 14, width: '100%', borderRadius: 999, overflow: 'hidden',
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          boxShadow: 'inset 0 2px 3px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, borderRadius: 999,
          background: FLUX_FILL, boxShadow: FLUX_GLOW,
        }}>
          {!reduced && (
            <span aria-hidden style={{
              position: 'absolute', top: 0, bottom: 0, left: 0, width: '45%', borderRadius: 999,
              background: SHEEN, mixBlendMode: 'screen', animation: 'flux-sheen 1.5s linear infinite',
            }} />
          )}
        </div>
      </div>
    </div>
  );
}
