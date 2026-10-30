// Service worker: guarda la app y las fotos en el dispositivo para que funcione sin internet.
// Archivos de la app: primero la red (así llegan las actualizaciones) y, sin conexión, la copia guardada.
// Fotos: primero la copia guardada (no cambian).

const CACHE = 'ironk-v4';
const APP = [
  './', 'index.html', 'styles.css', 'config.js', 'vendor/supabase.js', 'icons.js', 'data.js', 'poses.js', 'coach.js', 'voice.js', 'app.js', 'sync.js',
  'manifest.webmanifest', 'icon.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP);
    // Las fotos se listan en data.js; las guardamos de a una para que una falla no frene la instalación.
    const src = await (await fetch('data.js')).text();
    const block = src.slice(src.indexOf('const PHOTOS'), src.indexOf('const PHOTO_LABELS'));
    const names = [...new Set([...block.matchAll(/'([^']+)'/g)].map(m => m[1]))];
    await Promise.all(names.map(n => cache.add(`fotos/${n}.jpg`).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase y otros: directo a la red

  if (url.pathname.includes('/fotos/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })));
    return;
  }

  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});
