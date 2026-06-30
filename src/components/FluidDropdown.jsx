import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/*
 * FluidDropdown — a theme-aware single-select dropdown.
 *
 * Recreated (plain JS + inline styles + Tabler icons + CSS animation) from a
 * shadcn/framer-motion "fluid dropdown" so it matches the rest of the app's
 * stack. Signature touches kept: a chevron that flips open, a soft pop-in panel,
 * and ONE highlight pill that slides to whichever row is hovered (falling back to
 * the selected row). Colours come from the shared CSS variables, so it AUTO-MATCHES
 * the Light / Dark theme in both the portal and the FinTrack app.
 *
 * The option panel renders in a portal at the document root, positioned with
 * fixed coordinates from the trigger — so it never gets clipped inside scrolling
 * modals, and follows the trigger if the page scrolls.
 *
 * Props:
 *   options   [{ value, label, icon?, color? }]   icon = Tabler class e.g. "ti-wallet"
 *   value     currently-selected value (compared loosely, so numbers/strings both work)
 *   onChange  (value) => void
 *   placeholder, ariaLabel, width (CSS), style (wrapper override), maxPanelHeight
 */

const ITEM_H = 38;

export default function FluidDropdown({
  options, value, onChange,
  placeholder = 'Select…', ariaLabel, width = '100%', style, maxPanelHeight = 300,
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(null);
  const [rect, setRect] = useState(null);
  const [kbIndex, setKbIndex] = useState(-1); // keyboard cursor (arrow-key highlight)
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value)) || null;
  const selIdx = options.findIndex((o) => String(o.value) === String(value));

  const place = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelH = Math.min(options.length * ITEM_H + 12, maxPanelHeight);
    const below = window.innerHeight - r.bottom;
    const flip = below < panelH + 16 && r.top > below; // open upward if cramped below
    setRect({ top: flip ? Math.max(8, r.top - panelH - 6) : r.bottom + 6, left: r.left, width: r.width });
  };

  useLayoutEffect(() => { if (open) place(); /* eslint-disable-next-line */ }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // Flag this dropdown as open globally so a parent modal's Escape handler yields:
    // Escape closes the open dropdown first, then the modal on the next press.
    if (typeof window !== 'undefined') window.__fluidOpenCount = (window.__fluidOpenCount || 0) + 1;
    const reposition = () => place();
    const onDown = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      if (typeof window !== 'undefined') window.__fluidOpenCount = Math.max(0, (window.__fluidOpenCount || 1) - 1);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
    /* eslint-disable-next-line */
  }, [open]);

  // Reset the keyboard cursor to the selected row each time the panel opens.
  useEffect(() => {
    if (open) setKbIndex(selIdx < 0 ? 0 : selIdx);
    else { setKbIndex(-1); setHovered(null); }
    /* eslint-disable-next-line */
  }, [open]);

  // Keep the keyboard-highlighted row scrolled into view.
  useEffect(() => {
    if (!open || kbIndex < 0 || !listRef.current) return;
    const el = listRef.current;
    const top = kbIndex * ITEM_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ITEM_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ITEM_H - el.clientHeight;
  }, [kbIndex, open]);

  const hoveredIdx = hovered != null ? options.findIndex((o) => o.value === hovered) : -1;
  const activeIndex = hoveredIdx >= 0 ? hoveredIdx : (kbIndex >= 0 ? kbIndex : selIdx);
  const activeVal = activeIndex >= 0 ? options[activeIndex].value : null;

  // Keyboard control: ↑/↓ move, Enter/Space select (or open), Esc close, Home/End jump.
  const moveKb = (delta) => {
    setHovered(null);
    setKbIndex((i) => {
      const base = i < 0 ? (selIdx < 0 ? 0 : selIdx) : i;
      return Math.min(options.length - 1, Math.max(0, base + delta));
    });
  };
  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      else moveKb(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (open) {
        e.preventDefault(); e.stopPropagation();
        if (activeIndex >= 0) onChange(options[activeIndex].value);
        setOpen(false); setHovered(null);
      } else {
        e.preventDefault(); // open with the keyboard instead of bubbling
        setOpen(true);
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    } else if (e.key === 'Home') {
      if (open) { e.preventDefault(); setHovered(null); setKbIndex(0); }
    } else if (e.key === 'End') {
      if (open) { e.preventDefault(); setHovered(null); setKbIndex(options.length - 1); }
    } else if (e.key === 'Tab') {
      if (open) setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width, ...style }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)} onKeyDown={onTriggerKey} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        style={{
          width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '8px 12px', minHeight: 38, cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
          background: 'var(--surface)', color: selected ? 'var(--text)' : 'var(--muted)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8,
          transition: 'border-color 0.15s ease, background 0.15s ease',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {selected && selected.color && <span style={{ width: 9, height: 9, borderRadius: '50%', background: selected.color, flexShrink: 0 }} />}
          {selected && selected.icon && <i className={`ti ${selected.icon}`} aria-hidden="true" style={{ fontSize: 16, color: selected.color || 'var(--muted)', flexShrink: 0 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected ? selected.label : placeholder}</span>
        </span>
        <i className="ti ti-chevron-down" aria-hidden="true" style={{ fontSize: 15, color: 'var(--muted)', flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && rect && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 4000 }}>
          <div
            ref={listRef}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
              boxShadow: 'var(--shadow, 0 12px 32px rgba(0,0,0,0.28))', padding: 6,
              maxHeight: maxPanelHeight, overflowY: 'auto', transformOrigin: 'top', animation: 'fluid-dd-in 0.18s ease',
            }}
          >
            <div style={{ position: 'relative' }} role="listbox">
              {activeIndex >= 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute', left: 0, right: 0, top: 0, height: ITEM_H, borderRadius: 8,
                    background: 'var(--surface-2)', pointerEvents: 'none',
                    transform: `translateY(${activeIndex * ITEM_H}px)`,
                    transition: 'transform 0.25s cubic-bezier(0.25,0.1,0.25,1)',
                  }}
                />
              )}
              {options.map((o) => {
                const isSel = selected && selected.value === o.value;
                const isActive = o.value === activeVal;
                return (
                  <button
                    key={String(o.value)} type="button" role="option" aria-selected={!!isSel}
                    onClick={() => { onChange(o.value); setOpen(false); setHovered(null); }}
                    onMouseEnter={() => setHovered(o.value)} onMouseLeave={() => setHovered(null)}
                    style={{
                      position: 'relative', zIndex: 1, width: '100%', height: ITEM_H, boxSizing: 'border-box',
                      display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', textAlign: 'left',
                      border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                      fontWeight: isSel ? 600 : 500, color: isActive ? 'var(--text)' : 'var(--muted)', transition: 'color 0.15s ease',
                    }}
                  >
                    {o.color && <span style={{ width: 9, height: 9, borderRadius: '50%', background: o.color, flexShrink: 0 }} />}
                    {o.icon && <i className={`ti ${o.icon}`} aria-hidden="true" style={{ fontSize: 16, color: o.color || 'currentColor', flexShrink: 0 }} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                    {isSel && <i className="ti ti-check" aria-hidden="true" style={{ marginLeft: 'auto', fontSize: 15, color: 'var(--accent)', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
