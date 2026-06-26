import { useEffect, useRef, useState } from 'react';

/*
 * Toast — a small, theme-aware notification system for the whole portal.
 *
 * Recreated (in plain JS + inline styles + Tabler icons) from a shadcn/Tailwind
 * toast so it matches the rest of the app's stack. Colours come from the shared
 * CSS variables (var(--surface) / --text / --border …) so toasts AUTO-ADAPT to
 * the Light / Dark theme with no extra work.
 *
 * Anywhere in the app (portal screens OR the FinTrack artifact) can fire one:
 *     window.showToast("Action Done !", "success");
 *
 * Two types (no "warning"):
 *   success  → green, 1s   "Action Done !"            (entry saved)
 *   error    → red,   1s   "Error , Please Try Again" (entry rejected)
 *
 * New-version notices are NOT shown here anymore — they live in the header
 * notification bell (src/components/UpdateBell.jsx), which polls /version.json
 * and lights up when a newer deploy is available.
 */

const TYPE_CFG = {
  success: { accent: 'var(--success)', icon: 'ti-circle-check', duration: 1000, position: 'bottom-right' },
  error:   { accent: 'var(--danger)',  icon: 'ti-alert-circle', duration: 1000, position: 'bottom-right' },
};

let _idSeq = 1;

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  // Remove a toast, playing its exit animation first.
  const dismiss = (id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 240);
  };

  // Expose the global trigger.
  useEffect(() => {
    const show = (message, type = 'success', opts = {}) => {
      const cfg = TYPE_CFG[type] || TYPE_CFG.success;
      const id = _idSeq++;
      const position = opts.position || cfg.position;
      const duration = opts.duration != null ? opts.duration : cfg.duration;
      setToasts((prev) => [...prev, { id, message, type, position, leaving: false }]);
      setTimeout(() => dismiss(id), duration);
    };
    window.showToast = show;
    return () => { if (window.showToast === show) delete window.showToast; };
  }, []);

  return (
    <>
      <ToastStack toasts={toasts.filter((t) => t.position === 'top')} position="top" onClose={dismiss} />
      <ToastStack toasts={toasts.filter((t) => t.position === 'bottom-right')} position="bottom-right" onClose={dismiss} />
    </>
  );
}

function ToastStack({ toasts, position, onClose }) {
  if (toasts.length === 0) return null;
  const isTop = position === 'top';
  const wrap = {
    position: 'fixed', zIndex: 3000, display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none',
    ...(isTop
      ? { top: 16, left: '50%', transform: 'translateX(-50%)', alignItems: 'center', width: 'min(540px, calc(100vw - 32px))' }
      : { bottom: 16, right: 16, alignItems: 'flex-end', width: 'min(420px, calc(100vw - 32px))' }),
  };
  return (
    <div style={wrap}>
      {toasts.map((t) => <ToastCard key={t.id} toast={t} isTop={isTop} onClose={onClose} />)}
    </div>
  );
}

function ToastCard({ toast, isTop, onClose }) {
  const cfg = TYPE_CFG[toast.type] || TYPE_CFG.update;
  const anim = toast.leaving
    ? (isTop ? 'toast-out-top' : 'toast-out-right')
    : (isTop ? 'toast-in-top' : 'toast-in-right');
  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto', width: '100%', boxSizing: 'border-box',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        background: `color-mix(in srgb, ${cfg.accent} 12%, var(--surface))`,
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${cfg.accent}`,
        borderRadius: 12,
        boxShadow: 'var(--shadow, 0 10px 30px rgba(0,0,0,0.18))',
        padding: '12px 14px',
        animation: `${anim} 0.24s ease forwards`,
      }}
    >
      <i className={`ti ${cfg.icon}`} aria-hidden="true" style={{ color: cfg.accent, fontSize: 20, lineHeight: 1.4, flexShrink: 0 }} />
      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45, flex: 1 }}>{toast.message}</div>
      <button
        type="button" onClick={() => onClose(toast.id)} aria-label="Dismiss"
        style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--muted)', padding: 2, marginLeft: 2, display: 'inline-flex', flexShrink: 0 }}
      >
        <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 16 }} />
      </button>
    </div>
  );
}
