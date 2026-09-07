const CACHE_NAME = "punarvapar-v4-ai-darkmode-quality";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./i18n.js",
  "./manifest.json", "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App shell: cache-first for same-origin static assets.
// API calls (different origin / /price-board etc.) always go to network —
// the app's own IndexedDB layer handles the offline data story for those.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // let API calls pass through untouched
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
