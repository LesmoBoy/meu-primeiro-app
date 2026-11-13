const CACHE = 'minha-rodagem-1.5.0';
const arquivos = ['./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(arquivos)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(chaves => Promise.all(chaves
    .filter(chave => chave.startsWith('minha-rodagem-') && chave !== CACHE)
    .map(chave => caches.delete(chave)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const pedido = event.request;
  const url = new URL(pedido.url);
  const escopo = new URL(self.registration.scope);
  if (pedido.method !== 'GET' || url.origin !== escopo.origin || !url.pathname.startsWith(escopo.pathname)) return;
  const pagina = pedido.mode === 'navigate' &&
    [escopo.pathname, escopo.pathname + 'index.html'].includes(url.pathname);
  if (!pagina && !arquivos.some(arquivo => new URL(arquivo,escopo).pathname === url.pathname)) return;
  event.respondWith(fetch(pedido).catch(() => caches.open(CACHE).then(cache =>
    cache.match(pagina ? './index.html' : url.pathname))));
});
