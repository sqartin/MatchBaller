// Service worker: uygulama kabuğunu önbelleğe alır, internet yokken bilgi sayfası gösterir.
// Oyun online olduğu için veri (socket.io, /api) her zaman ağdan gelir.
const VERSION = 'mb-v4';
const SHELL = [
  '/', '/index.html', '/style.css', '/app.js', '/i18n.js', '/sfx.js', '/ads.js', '/config.js', '/offline.html',
  '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api')) return;

  // Sayfa açılışı: önce ağ (güncel sürüm), olmazsa önbellek, o da yoksa çevrimdışı sayfası
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => { caches.open(VERSION).then(c => c.put('/', res.clone())); return res; })
        .catch(() => caches.match('/').then(r => r || caches.match('/offline.html'))),
    );
    return;
  }
  // Statik dosyalar: önce ağ, olmazsa önbellek
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
