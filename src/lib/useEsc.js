import { useEffect } from 'react';

/*
 * useEsc — close a popup when the user presses Escape.
 *
 * `active` gates the listener so it's only attached while the popup is open;
 * `onClose` runs on Escape. For single, non-stacking modals (e.g. a confirm or a
 * change-password dialog). It yields to any open FluidDropdown (which sets
 * window.__fluidOpenCount while open) so Escape closes an open dropdown first and
 * the modal on the next press.
 */
export function useEsc(active, onClose) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if ((typeof window !== 'undefined' ? (window.__fluidOpenCount || 0) : 0) > 0) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}
