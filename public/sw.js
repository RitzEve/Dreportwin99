/*
 * Service worker — its only jobs are (1) make the app INSTALLABLE on Android
 * (Chrome needs a registered SW with a fetch handler) and (2) show a graceful
 * "you're offline" page instead of a broken screen when there's no connection.
 *
 * It is deliberately NETWORK-FIRST: it always tries the live network first, so
 * it never serves stale code and never fights the in-app new-version detector
 * (src/components/Toast.jsx polls /version.json). The cache is only a fallback.
 */
const CACHE = 'portal-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/', '/index.html', OFFLINE_URL])).catch(() => {}),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Leave cross-origin traffic (Supabase API, Google Fonts, Tabler CDN) alone.
  if (url.origin !== self.location.origin) return;
  // The version probe must always hit the network — never intercept it.
  if (url.pathname === '/version.json') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Keep a fresh copy of page navigations + the shell for offline fallback.
        if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match(OFFLINE_URL);
          return Response.error();
        }),
      ),
  );
});
