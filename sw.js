/* Cache the shell so the app opens instantly and offline — a recording made
 * without signal still fails at the Scribe call, but the UI is never a blank
 * page. Bump CACHE on every deploy; the old one is dropped on activate. */

const CACHE = 'skryba-v1.2.0';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only the shell is ours to cache; ElevenLabs calls go straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      // Stale-while-revalidate: instant open, fresh on the next launch.
      const live = fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => hit);
      return hit || live;
    })
  );
});
