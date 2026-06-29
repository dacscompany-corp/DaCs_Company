/* DAC's Admin — service worker (Web Push only; no offline caching).
   Receives the nightly Project Management summary push and shows it. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { title: "DAC's Admin", body: event.data && event.data.text() }; }

  const title = data.title || "DAC's Project Update";
  const options = {
    body:     data.body || '',
    icon:     data.icon  || '/assets/images/DACS-TRANSPARENT.png',
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
