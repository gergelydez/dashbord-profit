// Minimal service worker — required by Chrome/Android to treat this PWA as
// installable so "Add to Home Screen" uses the manifest icon at full size
// instead of falling back to a generic shortcut icon.
// Intentionally does not cache anything: this is a live dashboard and stale
// cached data would be worse than no offline support.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
