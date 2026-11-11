/* Service worker de Calame — généré au build (voir vite.config.ts).
 *
 * Stratégie explicite :
 *  - précache des fichiers de l'application (HTML, JS, CSS, icônes) à l'installation ;
 *  - réponses servies depuis ce cache (fonctionnement hors ligne) ;
 *  - AUCUNE autre requête n'est interceptée ni mise en cache : en particulier les
 *    futures API de synchronisation/authentification (autre origine ou chemins
 *    non listés) passent directement au réseau. Les notes vivent dans IndexedDB,
 *    jamais dans le cache HTTP.
 *  - une nouvelle version attend la confirmation de l'utilisateur (SKIP_WAITING).
 */
const VERSION = '__CALAME_VERSION__';
const CACHE = `calame-app-${VERSION}`;
const ASSETS = __CALAME_ASSETS__;

const scopeUrl = new URL(self.registration.scope);
const PRECACHE = ASSETS.map((a) => new URL(a, scopeUrl).href);
const PRECACHE_SET = new Set(PRECACHE);
const INDEX = new URL('./', scopeUrl).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('calame-app-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scopeUrl.origin) return;
  if (req.mode === 'navigate' && url.href.startsWith(scopeUrl.href)) {
    // Navigation dans l'app : coquille en cache (fonctionne hors ligne).
    event.respondWith(caches.match(INDEX, { cacheName: CACHE }).then((r) => r || fetch(req)));
    return;
  }
  const clean = url.origin + url.pathname;
  if (!PRECACHE_SET.has(clean)) return;
  event.respondWith(caches.match(clean, { cacheName: CACHE }).then((r) => r || fetch(req)));
});
