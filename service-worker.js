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
    body:    data.body || '',
    icon:    data.icon  || '/icons/icon-192.png',
    badge:   data.badge || '/icons/icon-192.png',
    tag:     data.tag   || 'pm-daily',
    renotify: true,
    requireInteraction: false,
    data:    { url: data.url || '/admin.html' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('admin.html') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
