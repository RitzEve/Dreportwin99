import { useState } from 'react';
import { ROLES, getActiveContext, logout, canAccessConsole } from './lib/auth.js';
import Login from './screens/Login.jsx';
import Provider from './screens/Provider.jsx';
import Console from './screens/Console.jsx';
import AppScreen from './app/AppScreen.jsx';

/*
 * Root — routes by role after login:
 *   not logged in     -> Login
 *   provider          -> Provider backend
 *   master / manager  -> Console  (and can open the app)
 *   staff             -> straight into the app (no console)
 */
export default function Root() {
  const [ctx, setCtx] = useState(() => getActiveContext());
  const [screen, setScreen] = useState('console');

  function handleAuthed() {
    setCtx(getActiveContext());
    setScreen('console');
  }
  function handleLogout() {
    logout();
    setCtx(null);
    setScreen('console');
  }

  if (!ctx) return <Login onAuthed={handleAuthed} />;

  if (ctx.user.role === ROLES.PROVIDER) {
    return <Provider ctx={ctx} onLogout={handleLogout} />;
  }

  // Staff have no console — they go straight into the app.
  if (!canAccessConsole(ctx.user.role)) {
    return <AppScreen canReturnToConsole={false} onLogout={handleLogout} />;
  }

  // Master / manager
  if (screen === 'app') {
    return <AppScreen onExit={() => setScreen('console')} onLogout={handleLogout} />;
  }
  return <Console ctx={ctx} onOpenApp={() => setScreen('app')} onLogout={handleLogout} />;
}
