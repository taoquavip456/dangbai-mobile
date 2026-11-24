// Service worker: mở app nhanh + xem được dữ liệu lần trước khi mất mạng.
// Luôn thử mạng trước (để có bản mới ngay), mất mạng mới dùng bản đã lưu.
const CACHE = 'dangbai-v2';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'e2e.js', 'remote-config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Không đụng tới máy trung gian (Supabase): luôn đi mạng.
  if (e.request.method !== 'GET' || /supabase\.co$/.test(u.hostname)) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (u.origin === location.origin || /cdn\.jsdelivr\.net$/.test(u.hostname))) {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return r;
  }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html'))));
});
