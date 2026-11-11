// Service worker : l'application fonctionne entièrement hors connexion.
const CACHE = 'maison-chahyn-v18';
const V = '?v=18';
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
// Manifest au nom de la personne (« Maison Yanis ») : l'app installée porte son prénom
async function personalManifest(url) {
  const base = await fetch('manifest.webmanifest', { cache: 'no-cache' }).then(r => r.json()).catch(() => caches.match('manifest.webmanifest').then(r => r && r.json()));
  const m = base || {};
  const name = (url.searchParams.get('name') || m.name || 'Maison').slice(0, 45);
  const short = (url.searchParams.get('short') || name).slice(0, 12);
  Object.assign(m, { name, short_name: short });
  const col = url.searchParams.get('color');
  if (col && /^#[0-9a-f]{6}$/i.test(col)) m.theme_color = col;
  return new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/manifest+json' } });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const u = new URL(req.url);
  if (u.origin === location.origin && u.pathname.endsWith('manifest.webmanifest') && u.searchParams.has('name')) { e.respondWith(personalManifest(u)); return; }
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
