/*
 * theme.js — Light/Dark theme, chosen by the user and remembered.
 * Applies the choice as <html data-theme="light|dark">; global.css maps that to
 * the colour variables. Inline styles that use var(--x) update instantly.
 */
const KEY = 'portal-theme';

export function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getTheme() {
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return systemPrefersDark() ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent('portal-themechange', { detail: theme }));
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Call once at startup, before React renders. */
export function initTheme() {
  applyTheme(getTheme());
}
