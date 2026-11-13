const PREFIXO = 'rodagem-cache:' + self.registration.scope + ':';
const CACHE = PREFIXO + '2.1.0';
const ARQUIVOS = ['./index.html','./styles.css','./enhancements.css','./app.js','./gps-core.js','./tracking.js','./experience.js','./interactions.js','./vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css','./assets/inicio.svg','./assets/fechamento.svg','./assets/consumo.svg','./assets/historico.svg','./assets/ajustes.svg','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    ARQUIVOS.map(path => new Request(path,{cache:'reload'}))
  )).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(async key => {
    if (key.startsWith(PREFIXO) && key !== CACHE) return caches.delete(key);
    if (!/^minha-rodagem-\d+(?:\.\d+)*$/.test(key)) return;
    // Versões antigas partilhavam o nome do cache entre repositórios.
    // Remova apenas os arquivos deste app, preservando outros escopos.
    const cache = await caches.open(key);
    const scope = new URL(self.registration.scope);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) await cache.delete(request);
    }
    if (!(await cache.keys()).length) await caches.delete(key);
  }))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const navigation = request.mode === 'navigate' && [scope.pathname,scope.pathname+'index.html'].includes(url.pathname);
  if (!navigation && !ARQUIVOS.some(path => new URL(path,scope).pathname === url.pathname)) return;
  event.respondWith((async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),5000);
    let response;
    try {
      response = await fetch(request,{signal:controller.signal});
      if (response.ok) return response;
    } catch { /* Rede indisponível ou tempo de espera esgotado: use a cópia local. */ }
    finally { clearTimeout(timeout); }
    const cache = await caches.open(CACHE);
    return await cache.match(navigation ? new URL('./index.html',scope).href : url.pathname) ||
      response || new Response('Abra o Minha Rodagem com internet uma vez para preparar o modo offline.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
});
