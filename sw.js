const CACHE = 'minha-rodagem-2.0.0';
const ARQUIVOS = ['./index.html','./styles.css','./app.js','./experience.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    ARQUIVOS.map(path => new Request(path,{cache:'reload'}))
  )).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('minha-rodagem-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const navigation = request.mode === 'navigate' && [scope.pathname,scope.pathname+'index.html'].includes(url.pathname);
  if (!navigation && !ARQUIVOS.some(path => new URL(path,scope).pathname === url.pathname)) return;
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(navigation ? new URL('./index.html',scope).href : url.pathname) ||
      new Response('Abra o Minha Rodagem com internet uma vez para preparar o modo offline.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }));
});
