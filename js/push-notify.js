/* DAC's Admin — Web Push opt-in for the nightly Project Management summary.
   Admin-only. The bell toggle (in the project workspace topbar) subscribes THIS
   device for the currently-open project; the subscription + project are stored
   in Supabase (pushSubscriptions). A Cloudflare cron worker at 11:59 PM PHT
   computes the project's numbers and sends the push, which service-worker.js
   shows on the device — even when the app is closed.

   SETUP: after generating your VAPID keypair, paste the PUBLIC key below. */
const PM_VAPID_PUBLIC_KEY = 'BAB4GutS8XAXmVbWn7SLudzKYukRee_gMEHJ5uX_k7sBRRNi-z59VBIqJzEGO1whgUZJOLBN45nJvHt74zMmApo';

let _pmPushProj = null;   // { id, label } of the project the bell currently reflects

function _pmUrlB64ToUint8(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

async function _pmSwReg() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    try {
        return await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    } catch (e) { console.warn('SW register failed', e); return null; }
}

// Does the browser subscription's applicationServerKey match our current key?
function _pmSubKeyMatches(sub, appKey) {
    try {
        const cur = sub.options && sub.options.applicationServerKey;
        if (!cur) return false;
        const a = new Uint8Array(cur);
        if (a.length !== appKey.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== appKey[i]) return false;
        return true;
    } catch (_) { return false; }
}

function _pmPushOwnerId() {
    return window.currentDataUserId
        || (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid)
        || null;
}

// Can this browser actually receive web push? (iPhone Safari TABS can't — only
// works once the app is Added to Home Screen on iOS 16.4+.)
function _pmPushSupported() {
    return ('serviceWorker' in navigator) && (typeof Notification !== 'undefined') && ('PushManager' in window);
}
function _pmIsIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || '')
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
}

// Is THIS device subscribed for THIS project?
async function pmPushIsEnabled(projectId) {
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    try {
        const snap = await db.collection('pushSubscriptions')
            .where('endpoint', '==', sub.endpoint).where('projectId', '==', projectId).get();
        return !snap.empty;
    } catch (_) { return false; }
}

async function _pmStoreSub(sub, projectId) {
    const json = sub.toJSON();
    try {
        const snap = await db.collection('pushSubscriptions')
            .where('endpoint', '==', sub.endpoint).where('projectId', '==', projectId).get();
        if (!snap.empty) return;   // already stored for this device+project
    } catch (_) {}
    await db.collection('pushSubscriptions').add({
        userId:    _pmPushOwnerId(),
        projectId: projectId,
        endpoint:  sub.endpoint,
        p256dh:    json.keys && json.keys.p256dh,
        auth:      json.keys && json.keys.auth,
        createdAt: (window.firebase && firebase.firestore && firebase.firestore.FieldValue.serverTimestamp()) || new Date().toISOString(),
    });
}

async function _pmRemoveSub(endpoint, projectId) {
    try {
        const snap = await db.collection('pushSubscriptions')
            .where('endpoint', '==', endpoint).where('projectId', '==', projectId).get();
        await Promise.all(snap.docs.map(d => db.collection('pushSubscriptions').doc(d.id).delete()));
    } catch (_) {}
}

// True if THIS device's endpoint is still opted into any OTHER project. The
// browser has a single push subscription shared by every project, so we must
// not unsubscribe() it while another project still depends on it.
async function _pmEndpointStillUsed(endpoint) {
    try {
        const snap = await db.collection('pushSubscriptions')
            .where('endpoint', '==', endpoint).get();
        return !snap.empty;
    } catch (_) { return true; }  // on error, keep the sub (safer than killing it)
}

// Bell button click — toggles the nightly summary for the open project.
window.pmPushToggle = async function() {
    const proj = _pmPushProj;
    if (!proj) { alert('Open a project first.'); return; }
    if (!_pmPushSupported()) {
        alert(_pmIsIOS()
            ? 'To get daily notifications on iPhone/iPad:\n\n1. Tap the Share button\n2. Choose "Add to Home Screen"\n3. Open DAC\'s from your Home Screen\n4. Then tap "Notify me daily" again\n\n(Requires iOS 16.4 or newer — Safari tabs can\'t do notifications.)'
            : 'Daily notifications aren\'t supported on this browser. Try Chrome on Android, or a desktop browser.');
        return;
    }
    if (PM_VAPID_PUBLIC_KEY.indexOf('REPLACE') === 0) {
        alert('Push is not configured yet — add the VAPID public key in js/push-notify.js (see the deploy guide).');
        return;
    }
    const reg = await _pmSwReg();
    if (!reg) { alert('Could not start notifications on this device.'); return; }

    if (await pmPushIsEnabled(proj.id)) {
        // turn OFF for this project — remove its row. Only drop the browser sub
        // if no other project on this device still uses the same endpoint.
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await _pmRemoveSub(sub.endpoint, proj.id);
            if (!(await _pmEndpointStillUsed(sub.endpoint))) { try { await sub.unsubscribe(); } catch (_) {} }
        }
        pmPushRefreshBell();
        return;
    }

    // turn ON
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('Allow notifications to get the daily summary.'); pmPushRefreshBell(); return; }
    const appKey = _pmUrlB64ToUint8(PM_VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    // If an existing subscription used a DIFFERENT VAPID key (e.g. keys were
    // rotated), drop it and re-subscribe with the current key.
    if (sub && !_pmSubKeyMatches(sub, appKey)) { try { await sub.unsubscribe(); } catch (_) {} sub = null; }
    if (!sub) {
        try {
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
        } catch (e) { alert('Could not subscribe to notifications: ' + e.message); return; }
    }
    await _pmStoreSub(sub, proj.id);
    pmPushRefreshBell();
    alert('Daily 11:59 PM summary enabled for ' + (proj.label || 'this project') + '.');
};

// Update the bell button to reflect the given project's subscription state.
// Call with (projectId, label) when a project opens; call with no args to refresh.
window.pmPushRefreshBell = async function(projectId, label) {
    if (projectId) _pmPushProj = { id: projectId, label: label || 'this project' };
    const btn = document.getElementById('pm-push-bell');
    if (!btn) return;
    // Only hide the bell when no project is open. On browsers that can't do web
    // push (e.g. iPhone Safari tabs) keep it VISIBLE but in an info state, so the
    // button doesn't silently vanish — tapping explains what to do.
    if (!_pmPushProj) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    if (!_pmPushSupported()) {
        btn.classList.remove('on');
        btn.classList.add('unsupported');
        btn.title = _pmIsIOS()
            ? 'iPhone: add this app to your Home Screen first, then enable daily notifications'
            : 'Daily notifications aren’t supported on this browser';
        btn.innerHTML = '<i data-lucide="bell-off" style="width:13px;height:13px;"></i> Notify me daily';
        if (window.lucide) lucide.createIcons();
        return;
    }
    btn.classList.remove('unsupported');
    let on = false;
    try { on = await pmPushIsEnabled(_pmPushProj.id); } catch (_) {}
    btn.classList.toggle('on', on);
    btn.title = on
        ? 'Daily 11:59 PM summary is ON for this project — tap to turn off'
        : 'Get a daily 11:59 PM summary of this project';
    btn.innerHTML = on
        ? '<i data-lucide="bell" style="width:13px;height:13px;"></i> Daily summary on'
        : '<i data-lucide="bell-off" style="width:13px;height:13px;"></i> Notify me daily';
    if (window.lucide) lucide.createIcons();
};

// ── Deep-linking from a notification ──────────────────────────────────────
// Open the project + tab a notification points to. Retries while the app/auth
// finishes loading (e.g. cold start from a notification tap).
function _pmRunDeepLink(pid, tab, _tries) {
    _tries = _tries || 0;
    if (!pid) return;
    (async () => {
        let ok = false;
        try { ok = window.pmOpenProjectById ? await window.pmOpenProjectById(pid, tab) : false; } catch (_) {}
        if (ok) { try { history.replaceState({}, '', location.pathname); } catch (_) {} return; }
        if (_tries < 40) setTimeout(() => _pmRunDeepLink(pid, tab, _tries + 1), 800);  // ~32s max
    })();
}

// Cold start: notification opened a new window with ?pmproject=…&pmtab=…
window.addEventListener('load', () => {
    try {
        const q = new URLSearchParams(location.search);
        const pid = q.get('pmproject');
        if (pid) _pmRunDeepLink(pid, q.get('pmtab') || 'overview');
    } catch (_) {}
});

// Warm start: the SW focused an already-open app and posted the target.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'pm-deeplink') _pmRunDeepLink(e.data.pid, e.data.tab);
    });
}

// Pre-register the SW on load so pushes are handled even before the first toggle.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { _pmSwReg(); });
}
