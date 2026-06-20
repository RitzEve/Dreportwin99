import { useEffect, useState } from 'react';
import { getTheme, toggleTheme } from '../lib/theme.js';

/*
 * ThemeToggle — sliding sun/moon switch for the portal pages (Provider, Console).
 * Matches the in-app FinTrack header toggle. Flips the theme instantly via
 * theme.js (CSS variables update live — no reload) and stays in sync with the
 * 'portal-themechange' event in case the theme is changed elsewhere.
 */
export default function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme());
  const dark = theme === 'dark';

  useEffect(() => {
    const h = (e) => setThemeState(e.detail || getTheme());
    window.addEventListener('portal-themechange', h);
    return () => window.removeEventListener('portal-themechange', h);
  }, []);

  return (
    <button
      type="button"
      onClick={() => setThemeState(toggleTheme())}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
      style={{
        position: 'relative', width: 56, height: 30, flexShrink: 0, borderRadius: 999, padding: 0, cursor: 'pointer',
        border: `2px solid ${dark ? '#2d2a4e' : '#e8d5b7'}`, background: dark ? '#1a1838' : '#fef3c7',
        transition: 'background 0.3s, border-color 0.3s',
      }}
    >
      <span style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: dark ? 'calc(100% - 24px)' : 2,
        width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
        background: dark ? '#e8e6f0' : '#ff9500', color: dark ? '#1a1838' : '#ffffff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left 0.3s, background 0.3s',
      }}>
        <i className={`ti ti-${dark ? 'moon' : 'sun'}`} aria-hidden="true" style={{ fontSize: 13, display: 'block', lineHeight: 1 }} />
      </span>
    </button>
  );
}
