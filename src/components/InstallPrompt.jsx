import { useEffect, useState } from 'react';

/*
 * InstallPrompt — the "get it on your phone" helper shown on the Login screen.
 *
 * Distribution is just the private link: a tenant/staff opens it and installs the
 * app to their home screen. This little card makes that discoverable for
 * non-technical users:
 *   • Android / desktop Chrome → captures the `beforeinstallprompt` event and shows
 *     a real "Install app" button that triggers the native install dialog.
 *   • iPhone / iPad (Safari has no install API) → shows the manual steps:
 *     tap Share → "Add to Home Screen".
 *   • Already installed (running standalone) → renders nothing.
 *
 * The iOS tip is dismissible and remembers the choice (localStorage).
 */
const DISMISS_KEY = 'pwa_ios_tip_dismissed';

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null); // the saved beforeinstallprompt event
  const [installed, setInstalled] = useState(() => (typeof window !== 'undefined' ? isStandalone() : true));
  const [iosDismissed, setIosDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1',
  );

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const ios = typeof window !== 'undefined' && isIos();

  // Android / Chrome: native install button.
  if (deferred) {
    return (
      <div style={card}>
        <i className="ti ti-device-mobile-down" aria-hidden="true" style={{ fontSize: 22, color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={title}>Install this app</div>
          <div style={sub}>Add it to your home screen for quick, full-screen access.</div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={async () => {
            deferred.prompt();
            try { await deferred.userChoice; } catch { /* ignore */ }
            setDeferred(null);
          }}
          style={{ flexShrink: 0 }}
        >
          Install
        </button>
      </div>
    );
  }

  // iPhone / iPad: manual Add-to-Home-Screen steps (dismissible).
  if (ios && !iosDismissed) {
    return (
      <div style={card}>
        <i className="ti ti-device-mobile-share" aria-hidden="true" style={{ fontSize: 22, color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={title}>Add to your Home Screen</div>
          <div style={sub}>
            Tap the Share button <i className="ti ti-share" aria-hidden="true" style={{ fontSize: 13 }} />, then choose
            “Add to Home Screen”.
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setIosDismissed(true); }}
          style={dismissBtn}
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return null;
}

const card = {
  display: 'flex', alignItems: 'center', gap: 12,
  marginTop: 20, padding: '12px 14px',
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12,
  textAlign: 'left',
};
const title = { fontSize: 13.5, fontWeight: 600, color: 'var(--text)' };
const sub = { fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 };
const dismissBtn = {
  flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--muted)',
  cursor: 'pointer', padding: 4, display: 'inline-flex', fontSize: 16,
};
