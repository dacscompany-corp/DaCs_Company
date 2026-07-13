/* DAC's Admin — service worker (Web Push + share-target intake; no offline caching).
   Receives the nightly Project Management summary push and shows it.
   Also receives files shared from the Android share sheet (manifest-admin.json
   share_target) and hands them to /share-capture.html via the Cache API.
   SW_VERSION: 2026-07-14-share-target  (bump to force clients to pick up icon/badge changes) */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ── Share target ────────────────────────────────────────────────────
// Android POSTs the shared files to /share-capture.html (static host — no
// server to receive them), so the SW intercepts the POST, stashes each file
// in a dedicated cache, and redirects to the page, which reads them back
// from the cache. Only this exact POST is intercepted; every other request
// still goes straight to the network.
const SHARE_CACHE = 'dacs-share-intake';

self.addEventListener('fetch', (event) => {
  let url;
  try { url = new URL(event.request.url); } catch (_) { return; }
  if (event.request.method !== 'POST' || url.pathname !== '/share-capture.html') return;

  event.respondWith((async () => {
    let count = 0;
    try {
      const form  = await event.request.formData();
      const files = form.getAll('media').filter((f) => f && typeof f.size === 'number' && f.size > 0);
      const cache = await caches.open(SHARE_CACHE);
      for (const req of await cache.keys()) await cache.delete(req);   // drop leftovers from a previous share
      for (const f of files) {
        await cache.put('/shared-file-' + count, new Response(f, {
          headers: {
            'Content-Type': f.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(f.name || ('shared-' + count)),
          },
        }));
        count++;
      }
    } catch (_) { /* fall through — page will show the manual picker */ }
    return Response.redirect('/share-capture.html?shared=' + count, 303);
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { title: "DAC's Admin", body: event.data && event.data.text() }; }

  const title = data.title || "DAC's Project Update";
  const options = {
    body:     data.body || '',
    icon:     data.icon  || '/icons/notif-icon.png',
    badge:    data.badge || '/icons/notif-bell.png',
    tag:      data.tag   || 'pm-daily',
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    vibrate:  Array.isArray(data.vibrate) ? data.vibrate : [80],
    actions:  Array.isArray(data.actions) ? data.actions : [],
    data:     { url: data.url || '/admin.html', pid: data.pid || '', tab: data.tab || 'overview' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;   // "Dismiss" button just closes it

  const d = event.notification.data || {};
  const url = d.url || '/';
  let targetPath = url;
  try { targetPath = decodeURIComponent(new URL(url, self.location.origin).pathname); } catch (_) {}

  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus a window already on the target page (admin OR the portal page).
    for (const c of list) {
      let p = '';
      try { p = decodeURIComponent(new URL(c.url).pathname); } catch (_) {}
      if (p === targetPath) {
        await c.focus();
        if (d.pid) c.postMessage({ type: 'pm-deeplink', pid: d.pid, tab: d.tab }); // admin deep-link only
        return;
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
