import { createRoot } from 'react-dom/client';
import './lib/storageBridge.js'; // installs window.storage before anything renders
import './styles/global.css';
import { ensureSeed } from './lib/auth.js';
import Root from './Root.jsx';

ensureSeed(); // first-run demo company so login works out of the box

createRoot(document.getElementById('root')).render(<Root />);
