import { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient.js';
import { ROLES, loadContext, logout, canAccessConsole } from './lib/auth.js';
import Login from './screens/Login.jsx';
import Provider from './screens/Provider.jsx';
import Console from './screens/Console.jsx';
import AppScreen from './app/AppScreen.jsx';
import FluxLoader from './components/FluxLoader.jsx';
import ToastHost from './components/Toast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

/*
 * Root — loads the Supabase session, then routes by role:
 *   not logged in     -> Login
 *   provider          -> Provider backend
 *   master / manager  -> Console (can open the app)
 *   staff             -> straight into the app
 */
export default function Root() {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreenState] = useState(() => sessionStorage.getItem('portal-screen') || 'console');
  const setScreen = (s) => { sessionStorage.setItem('portal-screen', s); setScreenState(s); };

  useEffect(() => {
    let active = true;
    loadContext().then((c) => { if (active) { setCtx(c); setLoading(false); } });
    // Keep context in sync with sign-in / sign-out events.
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadContext().then((c) => { if (active) setCtx(c); });
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  async function handleAuthed() {
    setCtx(await loadContext());
    setScreen('console');
  }
  async function handleLogout() {
    await logout();
    setCtx(null);
    setScreen('console');
  }

  // Pick the screen, then render it alongside the always-on ToastHost so the
  // entry success/error toasts work on every screen. (New-version notices now live
  // in the header notification bell, src/components/UpdateBell.jsx.)
  let content;
  if (loading) content = <Splash />;
  else if (!ctx) content = <Login onAuthed={handleAuthed} />;
  else if (ctx.user.role === ROLES.PROVIDER) content = <Provider ctx={ctx} onLogout={handleLogout} />;
  else if (!canAccessConsole(ctx.user.role)) content = <AppScreen ctx={ctx} canReturnToConsole={false} onLogout={handleLogout} />;
  else if (screen === 'app') content = <AppScreen ctx={ctx} onExit={() => setScreen('console')} onLogout={handleLogout} />;
  else content = <Console ctx={ctx} onOpenApp={() => setScreen('app')} onLogout={handleLogout} />;

  // ErrorBoundary wraps only the routed screen: a render crash anywhere in it shows
  // a recoverable message instead of unmounting to a blank page (React's default
  // with no boundary at all) — see the V2.0.6 incident in CLAUDE.md.
  return (<><ErrorBoundary key={screen + String(!!ctx)}>{content}</ErrorBoundary><ToastHost /></>);
}

function Splash() {
  return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <FluxLoader phases={[
        { at: 0, label: 'starting up' },
        { at: 35, label: 'securing session' },
        { at: 70, label: 'loading workspace' },
        { at: 100, label: 'ready' },
      ]} />
    </div>
  );
}
