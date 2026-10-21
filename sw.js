// DailyMate service worker.
//   * Shows push notifications for reminders and opens the app when one is tapped.
//   * Keeps a copy of the app's own files so DailyMate still opens without a
//     connection. Online, it always asks the server for the latest version first
//     (so updates appear right away); the copy is only used when that fails.
// It never touches requests to other sites (such as the Supabase API).

const CACHE = 'dailymate-app-v1';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'manifest.webmanifest', 'assets/icon.svg', 'assets/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() ?? '' }; }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 200) : 'DailyMate';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body.slice(0, 500) : '',
    tag: typeof data.tag === 'string' ? data.tag : 'dailymate',
    renotify: true,
    icon: 'assets/icon-192.png',
    badge: 'assets/badge-96.png',
    timestamp: Number.isFinite(data.at) ? data.at : Date.now(),
    data: { url: typeof data.url === 'string' && data.url.startsWith('./#/') ? data.url : './#/reminders' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? './#/reminders', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      return open.navigate(target).catch(() => {});
    }
    return self.clients.openWindow(target);
  })());
});
