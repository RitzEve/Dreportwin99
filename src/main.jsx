import { createRoot } from 'react-dom/client';
import './lib/storageBridge.js'; // installs window.storage (Supabase-backed)
import './styles/global.css';
import { initTheme } from './lib/theme.js';
import Root from './Root.jsx';

initTheme(); // apply saved Light/Dark choice before first paint
createRoot(document.getElementById('root')).render(<Root />);

// Register the service worker so the app is installable on phones (and shows a
// graceful offline page). Production only — keeps the dev server free of SW
// caching. The SW is network-first, so it never serves stale code (see public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
