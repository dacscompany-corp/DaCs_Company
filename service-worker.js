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
    icon:     data.icon  || '/icons/icon-192.png',
    badge:    data.badge || '/icons/icon-192.png',
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
  const url = d.url || '/admin.html';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.includes('admin.html')) {
        await c.focus();
        // App is already open — tell it to deep-link to the project + tab.
        c.postMessage({ type: 'pm-deeplink', pid: d.pid, tab: d.tab });
        return;
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
