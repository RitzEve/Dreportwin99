import { useEffect, useState } from 'react';

/*
 * useIsMobile — one shared definition of "is this a phone-sized screen?" so every
 * screen in the portal (and the FinTrack app) flips to its mobile layout at the
 * SAME breakpoint. Mirrors the matchMedia pattern already used for `isWideView`
 * inside FinTrack.jsx.
 *
 *   const isMobile = useIsMobile();   // true when viewport <= 900px wide
 *
 * Pass a custom max-width if a component needs a different cutoff:
 *   const isNarrow = useIsMobile(1100);
 */
export default function useIsMobile(maxWidth = 900) {
  const query = `(max-width: ${maxWidth}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return isMobile;
}
