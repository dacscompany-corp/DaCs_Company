/* DAC's Admin — service worker (Web Push + share-target intake; no offline caching).
   Receives the nightly Project Management summary push and shows it.
   Also receives files shared from the Android share sheet (manifest-admin-v2.json
   share_target) and hands them to /share-capture.html via the Cache API.
   SW_VERSION: 2026-09-23-share-diag2  (bump to force clients to pick up icon/badge changes) */

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

// Is this form entry a file rather than a plain text field?
function shareIsFile(v) {
  return v && typeof v === 'object' && typeof v.size === 'number' && typeof v.name === 'string';
}

self.addEventListener('fetch', (event) => {
  let url;
  try { url = new URL(event.request.url); } catch (_) { return; }
  if (event.request.method !== 'POST' || url.pathname !== '/share-capture.html') return;

  event.respondWith((async () => {
    let count = 0;
    const meta = {
      at: new Date().toISOString(),
      swVersion: '2026-09-23-share-diag2',
      stage: 'start',
      error: '',
      contentType: '',      // includes the multipart boundary Android chose
      bodyBytes: -1,        // -1 = could not measure; 0 = Android sent an empty body
      entries: [],          // EVERY field in the form, whatever it is named
      source: 'none',       // which field the files came from
      received: 0,          // entries named "media", before the size filter
      kept: 0,              // of those, the ones with a real body
      files: [],            // { name, type, size } per kept file
      text: '', title: '', linkUrl: '',
    };

    let cache = null;
    try { cache = await caches.open(SHARE_CACHE); } catch (e) { /* reported below */ }

    try {
      meta.contentType = event.request.headers.get('content-type') || '';

      // Measure the raw body BEFORE parsing. An empty body means Android never
      // attached the picture — nothing this app does could recover it. A full
      // body with no parsed fields means the multipart parse is the problem.
      // Must clone first: formData() consumes the stream.
      let probe = null;
      try { probe = event.request.clone(); } catch (_) {}

      meta.stage = 'formData';
      const form = await event.request.formData();

      if (probe) {
        try { meta.bodyBytes = (await probe.arrayBuffer()).byteLength; } catch (_) {}
      }

      meta.stage = 'entries';
      for (const [k, v] of form.entries()) {
        meta.entries.push(shareIsFile(v)
          ? { key: k, kind: 'file', name: v.name || '', type: v.type || '', size: v.size }
          : { key: k, kind: 'text', size: String(v || '').length, preview: String(v || '').slice(0, 120) });
      }

      const named = form.getAll('media');
      meta.received = named.length;

      // Take the declared "media" field first. If it is empty but the share did
      // carry a file under some other name, use that instead of dropping the
      // receipt on the floor — the field name is the sharing app's choice, and
      // a mismatch used to look identical to an empty share.
      let files = named.filter((f) => shareIsFile(f) && f.size > 0);
      if (files.length) {
        meta.source = 'media';
      } else {
        const loose = [];
        for (const [k, v] of form.entries()) {
          if (k !== 'media' && shareIsFile(v) && v.size > 0) loose.push(v);
        }
        if (loose.length) { files = loose; meta.source = 'fallback'; }
      }

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
