import { createRoot } from 'react-dom/client';
import './lib/storageBridge.js'; // installs window.storage (Supabase-backed)
import './styles/global.css';
import { initTheme } from './lib/theme.js';
import Root from './Root.jsx';

initTheme(); // apply saved Light/Dark choice before first paint
createRoot(document.getElementById('root')).render(<Root />);
