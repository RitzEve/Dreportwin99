import { createRoot } from 'react-dom/client';
import './lib/storageBridge.js'; // installs window.storage (Supabase-backed)
import './styles/global.css';
import Root from './Root.jsx';

createRoot(document.getElementById('root')).render(<Root />);
