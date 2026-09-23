/* DAC's Admin — service worker (Web Push + share-target intake; no offline caching).
   Receives the nightly Project Management summary push and shows it.
   Also receives files shared from the Android share sheet (manifest-admin.json
   share_target) and hands them to /share-capture.html via the Cache API.
   SW_VERSION: 2026-09-23-share-diag  (bump to force clients to pick up icon/badge changes) */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ── Share target ────────────────────────────────────────────────────
// Android POSTs the shared files to /share-capture.html (static host — no
// server to receive them), so the SW intercepts the POST, stashes each file
// in a dedicated cache, and redirects to the page, which reads them back
// from the cache. Only this exact POST is intercepted; every other request
// still goes straight to the network.
//
// WITHOUT this interception the POST hits Vercel and comes back 405 — there is
// no fallback. So every step also writes a breadcrumb to /shared-meta: the page
// reads it back and can say exactly which boundary failed instead of showing an
// empty picker. Diagnosing this on a phone with no devtools is otherwise
// impossible — that is why the whole path used to be un-debuggable.
const SHARE_CACHE = 'dacs-share-intake';
const SHARE_META  = '/shared-meta';

async function shareWriteMeta(cache, meta) {
  try {
    await cache.put(SHARE_META, new Response(JSON.stringify(meta), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (_) { /* meta is best-effort — never let it break the share itself */ }
}

self.addEventListener('fetch', (event) => {
  let url;
  try { url = new URL(event.request.url); } catch (_) { return; }
  if (event.request.method !== 'POST' || url.pathname !== '/share-capture.html') return;

  event.respondWith((async () => {
    let count = 0;
    const meta = {
      at: new Date().toISOString(),
      swVersion: '2026-09-23-share-diag',
      stage: 'start',
      error: '',
      received: 0,          // entries named "media" in the form, before the size filter
      kept: 0,              // of those, the ones with a real body
      files: [],            // { name, type, size } per kept file
      text: '', title: '', linkUrl: '',
    };

    let cache = null;
    try { cache = await caches.open(SHARE_CACHE); } catch (e) { /* reported below */ }

    try {
      meta.stage = 'formData';
      const form = await event.request.formData();

      const all = form.getAll('media');
      meta.received = all.length;
      const files = all.filter((f) => f && typeof f.size === 'number' && f.size > 0);
      meta.kept = files.length;
      meta.files = files.map((f) => ({ name: f.name || '', type: f.type || '', size: f.size }));

      // Some apps share a link or caption instead of (or beside) the image.
      meta.title   = String(form.get('title') || '');
      meta.text    = String(form.get('text')  || '');
      meta.linkUrl = String(form.get('url')   || '');

      if (!cache) throw new Error('Cache storage unavailable');

      meta.stage = 'cache-clear';
      for (const req of await cache.keys()) await cache.delete(req);   // drop leftovers from a previous share

      meta.stage = 'cache-put';
      for (const f of files) {
        await cache.put('/shared-file-' + count, new Response(f, {
          headers: {
            'Content-Type': f.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(f.name || ('shared-' + count)),
          },
        }));
        count++;
      }
      meta.stage = 'done';
    } catch (e) {
      // Was: silently swallowed, so a failure here looked exactly like a share
      // with no files. Record it — the page surfaces it.
      meta.error = (e && (e.message || e.name)) ? (e.name + ': ' + e.message) : String(e);
    }

    meta.stored = count;
    if (cache) await shareWriteMeta(cache, meta);

    return Response.redirect('/share-capture.html?shared=' + count + '&sw=1', 303);
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
