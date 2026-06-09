// Service Worker — منصة فِكر (تثبيت على الجوال + عمل أساسي دون اتصال)
const CACHE = 'fikr-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // لا تخزّن طلبات الـ API أو الملفات المرفوعة (يجب أن تكون حيّة)
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/uploads/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const cp = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp).catch(() => {}));
      return r;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('/index.html')))
  );
});
