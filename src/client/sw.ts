/// <reference lib="webworker" />
/** Сервис-воркер: офлайн-экран и кэш статики. Приватные страницы (/z/, /kabinet) и API не кешируются. */
const sw = self as unknown as ServiceWorkerGlobalScope;
const BUILD = '__BUILD__';
const CACHE = 'pompon-' + BUILD;
const PRECACHE = ['/offline', `/assets/app.css?v=${BUILD}`, `/assets/theme.js?v=${BUILD}`, '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest'];
const PUBLIC_PAGES = new Set(['/', '/uslugi', '/kontakty', '/privacy', '/atribuciya']);

sw.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => sw.skipWaiting())); });
sw.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => sw.clients.claim())); });
sw.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/z/') || url.pathname.startsWith('/kabinet')) {
    if (req.mode === 'navigate') e.respondWith(fetch(req).catch(() => caches.match('/offline') as Promise<Response>));
    return; // приватное — только сеть
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { if (r.ok && PUBLIC_PAGES.has(url.pathname)) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })
      .catch(async () => (await caches.match(req)) || (await caches.match('/offline')) as Response));
    return;
  }
  if (/^\/(assets|icons|models)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })));
  }
});
