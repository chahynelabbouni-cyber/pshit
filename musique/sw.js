// Service worker : l'application fonctionne entièrement hors connexion.
const CACHE = 'maison-chahyn-v15';
const V = '?v=15';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css' + V,
  ...['app', 'db', 'tags', 'player', 'lyrics', 'ai', 'voice', 'sources'].map(f => `js/${f}.js${V}`),
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    // « no-cache » : on revérifie toujours auprès du serveur, pour recevoir les mises à jour tout de suite
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
