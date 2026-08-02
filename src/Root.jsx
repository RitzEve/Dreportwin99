import { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient.js';
import { ROLES, loadContext, logout, canAccessConsole, isProviderTier, touchPresence } from './lib/auth.js';
import Login from './screens/Login.jsx';
import Provider from './screens/Provider.jsx';
import Console from './screens/Console.jsx';
import OwnerOverview from './screens/OwnerOverview.jsx';
import AppScreen from './app/AppScreen.jsx';
import FluxLoader from './components/FluxLoader.jsx';
import ToastHost from './components/Toast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

/*
 * Root — loads the Supabase session, then routes by role:
 *   not logged in     -> Login
 *   provider          -> Provider backend
 *   owner             -> OwnerOverview (one card per linked company; a card
 *                        drills into that company's real dashboard, read-only —
 *                        see migration-013.sql)
 *   master / manager  -> Console (can open the app)
 *   staff             -> straight into the app
 */

/*
 * The browser tab title names WHICH company this tab is signed into.
 *
 * This matters because the Supabase session lives in sessionStorage, not
 * localStorage (see supabaseClient.js) — so every tab is its own independent
 * session and ONE browser can genuinely be signed into two different companies
 * side by side. When every tab just read "DRW" they were impossible to tell
 * apart at a glance.
 *
 * The company name goes FIRST on purpose: browsers truncate tab titles from the
 * right, so the distinguishing part has to lead. The DRW shield favicon already
 * carries the branding, which is why the trailing "· DRW" can afford to be the
 * part that gets cut off on a crowded tab strip.
 */
// How often a signed-in tab stamps "still here". Paired with ONLINE_WINDOW_MS in
// Console.jsx, which decides how long that stamp keeps counting as online — keep
// the window comfortably larger than this interval or a slow beat looks offline.
const PRESENCE_BEAT_MS = 2 * 60 * 1000;

const BASE_TITLE = 'DRW';
function tabTitle({ loading, ctx, ownerCompany }) {
  if (loading || !ctx) return BASE_TITLE;
  // Provider/sub-provider belong to no company; they manage all of them.
  if (isProviderTier(ctx.user.role)) return `Provider · ${BASE_TITLE}`;
  // An owner has no company of their own either — the relevant one is whichever
  // they've drilled into, and null means they're still on the overview.
  const company = ctx.user.role === ROLES.OWNER ? ownerCompany : ctx.company;
  const name = String(company?.name || '').trim();
  if (name) return `${name} · ${BASE_TITLE}`;
  return ctx.user.role === ROLES.OWNER ? `Owner · ${BASE_TITLE}` : BASE_TITLE;
}
export default function Root() {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreenState] = useState(() => sessionStorage.getItem('portal-screen') || 'console');
  const setScreen = (s) => { sessionStorage.setItem('portal-screen', s); setScreenState(s); };
  // Which company an owner has drilled into (null = showing the overview).
  const [ownerCompany, setOwnerCompany] = useState(null);

  useEffect(() => {
    let active = true;
    loadContext().then((c) => { if (active) { setCtx(c); setLoading(false); } });
    // Keep context in sync with sign-in / sign-out events.
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadContext().then((c) => { if (active) setCtx(c); });
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // Keep the tab title in step with whoever this tab is signed in as.
  useEffect(() => {
    document.title = tabTitle({ loading, ctx, ownerCompany });
  }, [loading, ctx, ownerCompany]);

  /*
   * Presence heartbeat — tells the master/manager Console this account is still
   * signed in (and, server-side, which IP from). See migration-026.
   *
   * Keyed on the user ID, not the `ctx` OBJECT: Supabase hands us a brand-new
   * ctx on every onAuthStateChange, which re-fires each time a backgrounded tab
   * regains focus. Keying on the object would tear down and rebuild this
   * interval constantly, so on a busy machine it might never actually reach the
   * two-minute mark (the same trap AppScreen.jsx fell into in V2.2.0).
   *
   * Skipped entirely while the tab is hidden, so a forgotten background tab
   * stops counting as "online" within one staleness window instead of holding
   * the dot green forever.
   */
  useEffect(() => {
    if (!ctx?.user?.id) return undefined;
    let stopped = false;
    const beat = () => { if (!stopped && document.visibilityState === 'visible') touchPresence(); };
    beat();
    const iv = setInterval(beat, PRESENCE_BEAT_MS);
    // Re-stamp the moment they come back to the tab, so the dot doesn't lag.
    document.addEventListener('visibilitychange', beat);
    return () => { stopped = true; clearInterval(iv); document.removeEventListener('visibilitychange', beat); };
  }, [ctx?.user?.id]);

  async function handleAuthed() {
    setCtx(await loadContext());
    setScreen('console');
  }
  async function handleLogout() {
    await logout();
    setCtx(null);
    setScreen('console');
    setOwnerCompany(null);
  }

  // Pick the screen, then render it alongside the always-on ToastHost so the
  // entry success/error toasts work on every screen. (New-version notices now live
  // in the header notification bell, src/components/UpdateBell.jsx.)
  let content;
  if (loading) content = <Splash />;
  else if (!ctx) content = <Login onAuthed={handleAuthed} />;
  else if (isProviderTier(ctx.user.role)) content = <Provider ctx={ctx} onLogout={handleLogout} />;
  else if (ctx.user.role === ROLES.OWNER) {
    content = ownerCompany
      ? <AppScreen ctx={{ user: ctx.user, company: ownerCompany }} onExit={() => setOwnerCompany(null)} onLogout={handleLogout} backLabel="Overview" />
      : <OwnerOverview ctx={ctx} onLogout={handleLogout} onOpenCompany={setOwnerCompany} />;
  }
  else if (!canAccessConsole(ctx.user.role)) content = <AppScreen ctx={ctx} canReturnToConsole={false} onLogout={handleLogout} />;
  else if (screen === 'app') content = <AppScreen ctx={ctx} onExit={() => setScreen('console')} onLogout={handleLogout} />;
  else content = <Console ctx={ctx} onOpenApp={() => setScreen('app')} onLogout={handleLogout} />;

  // ErrorBoundary wraps only the routed screen: a render crash anywhere in it shows
  // a recoverable message instead of unmounting to a blank page (React's default
  // with no boundary at all) — see the V2.0.6 incident in CLAUDE.md.
  return (<><ErrorBoundary key={screen + String(!!ctx) + (ownerCompany ? `-${ownerCompany.id}` : '')}>{content}</ErrorBoundary><ToastHost /></>);
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
