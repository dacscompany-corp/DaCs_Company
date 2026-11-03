// ════════════════════════════════════════════════════════════════════
// A SAVE THAT MAY HAVE REACHED THE SERVER — Project Control's Add Expense
// (WorkMate Stage 4, reviews of 30–31 Oct 2026; R119, R120).
//
// Add Expense records a purchase — and, with "Paid now?", its payment — in
// ONE server operation (pur_record) under ONE operation id. The server
// answers a repeated id with its first answer (pur_ops), so the same id can
// never be recorded twice. If the reply is lost, though, the server may
// already have saved it. So the EXACT id and the EXACT body are kept in this
// browser — per account, across closing the form and reloading the page —
// until the server has answered:
//   saved     → forgotten.
//   refused   → the server said no (one transaction: nothing was saved) →
//               forgotten; the form keeps what was typed.
//   no answer → kept. Project Control locks the form (nothing can be
//               edited, no new entry can start) and offers:
//     Send it again — the same id and the same body, never the form's
//       fields: the server records it once, or replays its first answer;
//     Cancel it — pur_op_cancel: the server confirms it had been recorded,
//       or makes sure it never will be (the phone's "Cancel it", 2B-b R102).
//
// One save at a time per account, across tabs and windows: every step that
// reads and changes what is kept runs under the browser's lock for that
// account (Web Locks, navigator.locks — handed in). A second tab asking
// while the first is building, uploading or sending is told so and does
// nothing; without the lock nothing is sent. An answer clears only its own
// operation — never another save found in storage.
//
// Each id is registered with the server (pur_op_reserve, 0109) BEFORE it is
// sent, so the server can always settle every save this account may have
// sent: if what is kept is damaged and no single id can be read, nothing new
// is sent until recover() — pur_op_recover cancels for good every registered
// save the server has no answer for (its first request arriving later is
// refused), or finds it recorded. An absent row in a list proves nothing;
// there is no "clear it by hand".
//
// Browser storage is trusted only when it proves itself:
//   blocked  (the browser refuses to read or write it, drops a write, or is
//            full) → NOTHING is sent and nothing is uploaded: a save this
//            browser cannot keep could be lost on a reload, and entering it
//            again would then record it twice. Nothing is kept in page
//            memory instead — a reload would lose it.
//   damaged  (what is kept cannot be read back whole) → never taken for
//            "nothing waiting": no new entry is sent. The operation id is
//            also kept on its own, so the server can still settle it (on
//            opening, and Cancel it); with no single readable id, recover().
// Another account never sees, sends or settles it: it is kept per account,
// and the server's pur_ops is per account too — another account sending the
// same id would be a NEW operation, so the id must never reach it.
//
// Bound to the account that started it, through every step (review of
// 31 Oct, R121): the calls handed in carry THAT account's sign-in (never a
// shared client's current one), and before every request account() must
// still name that account. If someone else is signed in now (a sign-in in
// another tab), nothing more is sent and whatever is unsettled stays kept
// for the first account — to settle when it is signed in again.
//
// A refusal settles a save only on its FIRST sending, or when the server
// says it was cancelled for good: a later attempt refused for another reason
// (an expired sign-in, a permission changed) says nothing about the first
// request, which may have been recorded — so the save stays kept.
//
// The calls are handed in (reserve, record, cancelOp, stateOp, recoverOps,
// locks, account), so this file reads no table and holds no money rule.
// Works in a browser (window.DacsPendingSave) and in Node for
// tests/expense-pending-save.test.js.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    const PREFIX = 'dacs.addExpense.pending.';
    const LOCK = 'dacs.addExpense.';
    const OP_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    function key(uid) { return PREFIX + uid; }
    function opKey(uid) { return PREFIX + uid + '.op'; }
    const isOp = (v) => typeof v === 'string' && OP_RX.test(v);
    function whole(p) {
        return !!p && typeof p === 'object' && isOp(p.op) && !!p.body && typeof p.body === 'object' && !Array.isArray(p.body);
    }
    function parse(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }

    // What this browser holds for an account:
    //   {status: 'none'} · {status: 'pending', pending} ·
    //   {status: 'damaged', op} (op: the one readable id, or null) ·
    //   {status: 'blocked'} (storage cannot be read) · {status: 'no_account'}
    function inspect(store, uid) {
        if (!uid) return { status: 'no_account' };
        let raw, rawOp;
        try {
            if (!store) throw new Error('no storage');
            raw = store.getItem(key(uid));
            rawOp = store.getItem(opKey(uid));
        } catch (e) { return { status: 'blocked' }; }
        if (raw == null && rawOp == null) return { status: 'none' };
        const p = parse(raw);
        if (whole(p) && rawOp === p.op) return { status: 'pending', pending: p };
        // Damaged: settle with the server by id only if exactly one id can be read.
        const ids = new Set([rawOp, p && p.op].filter(isOp));
        return { status: 'damaged', op: ids.size === 1 ? [...ids][0] : null, raw, rawOp };
    }

    // The pending save, or null — only when one is kept whole.
    function read(store, uid) {
        const s = inspect(store, uid);
        return s.status === 'pending' ? s.pending : null;
    }

    // Keep (p) or clear (null). True only if the browser now holds exactly
    // that — read back, never assumed. The id is written first, on its own.
    function write(store, uid, p) {
        if (!uid || !store) return false;
        try {
            if (p) {
                const raw = JSON.stringify(p);
                store.setItem(opKey(uid), p.op);
                store.setItem(key(uid), raw);
                return store.getItem(key(uid)) === raw && store.getItem(opKey(uid)) === p.op;
            }
            store.removeItem(key(uid));
            store.removeItem(opKey(uid));
            return store.getItem(key(uid)) == null && store.getItem(opKey(uid)) == null;
        } catch (e) { return false; }
    }

    // An answer for operation `op` clears what is kept only if every id that
    // can be read there IS `op` — never another save found in storage.
    function clearOwn(store, uid, op) {
        let raw, rawOp;
        try { raw = store.getItem(key(uid)); rawOp = store.getItem(opKey(uid)); } catch (e) { return false; }
        if (raw == null && rawOp == null) return true;
        const p = parse(raw);
        const ids = [rawOp, p && p.op].filter(isOp);
        if (!ids.length || ids.some(id => id !== op)) return false;
        return write(store, uid, null);
    }

    // Can this browser keep anything at all? Asked before uploading.
    function probe(store, uid) {
        const k = PREFIX + uid + '.probe', v = String(Date.now()) + Math.random();
        try {
            store.setItem(k, v);
            const back = store.getItem(k);
            store.removeItem(k);
            return back === v;
        } catch (e) { return false; }
    }

    // The server answered with a refusal — a Postgres or PostgREST code — so
    // nothing was saved. No code at all (a dropped connection, a timeout): no
    // answer, and it may have been saved.
    function outcome(error) {
        if (!error) return 'saved';
        return /^(P0001|PGRST|22|23|28|42)/.test(String(error.code || '')) ? 'refused' : 'unknown';
    }

    async function call(fn, args) {
        try { return (await fn(args)) || { data: null, error: null }; }
        catch (e) { return { data: null, error: e }; }
    }

    // Runs fn holding this account's lock — or, if another tab or window
    // holds it, or the browser has no locks, does nothing: busy(code).
    function locked(o, fn, busy) {
        const L = o.locks;
        if (!L || typeof L.request !== 'function') return Promise.resolve(busy('LOCKS_UNAVAILABLE'));
        return L.request(LOCK + o.uid, { ifAvailable: true }, (lock) => (lock ? fn() : busy('SAVE_IN_PROGRESS')));
    }
    const asState = (code) => ({ state: code === 'SAVE_IN_PROGRESS' ? 'busy' : 'blocked', code });

    // Is the account that started this still the one signed in? Asked before
    // every request; no way to tell counts as no.
    async function still(o) {
        if (typeof o.account !== 'function') return false;
        try { return (await o.account()) === o.uid; } catch (e) { return false; }
    }
    const changed = { state: 'account_changed', code: 'ACCOUNT_CHANGED' };

    // Nothing sent, nothing uploaded, nothing changed.
    const stop = (code, extra) => Object.assign({ outcome: 'blocked', data: null, error: { message: code }, pending: null, resent: false }, extra || {});

    // One press of Save (resend false) or of "Send it again" (resend true).
    // A save still waiting is sent exactly as it was; otherwise build() makes
    // the new body (uploads included), and it is kept — and read back —
    // BEFORE anything is sent. Its id is registered with the server
    // (reserve), then sent (record). Blocked or damaged storage, no account,
    // another tab saving, no locks, someone else signed in now, or "Send it
    // again" with nothing waiting any more send nothing: outcome 'blocked'
    // (`kept`: a save stays waiting for this account).
    // o: {store, uid, locks, account(), resend, newId(), build(), reserve(args), record(args), label, now()}
    function submit(o) {
        if (inspect(o.store, o.uid).status === 'no_account') return Promise.resolve(stop('NO_ACCOUNT'));
        return locked(o, async () => {
            const s = inspect(o.store, o.uid);
            if (s.status === 'blocked') return stop('STORAGE_BLOCKED');
            if (s.status === 'damaged') return stop('STORAGE_DAMAGED', { op: s.op });
            if (s.status === 'none' && o.resend) return stop('NOTHING_PENDING');
            if (s.status === 'pending' && !o.resend) return stop('SAVE_PENDING', { pending: s.pending });
            let p = s.status === 'pending' ? s.pending : null;
            const resent = !!p;
            const away = () => stop('ACCOUNT_CHANGED', p ? { pending: p, resent, kept: true } : {});
            if (!(await still(o))) return away();
            if (!p) {
                if (!probe(o.store, o.uid)) return stop('STORAGE_BLOCKED');
                const body = await o.build();
                // Signed in as someone else while it uploaded: nothing kept, nothing sent.
                if (!(await still(o))) return away();
                p = { op: o.newId(), body, at: o.now ? o.now() : Date.now(), label: String(o.label || '') };
                if (!write(o.store, o.uid, p)) {
                    clearOwn(o.store, o.uid, p.op);
                    return stop('STORAGE_BLOCKED');
                }
            }
            // Registered first, so pur_op_recover can always settle it. A NEW save
            // whose registration is refused was never sent: forgotten. Anything
            // else without an answer stays kept.
            if (!(await still(o))) return away();
            const rv = await call(o.reserve, { p_op: p.op });
            if (rv.error) {
                const never = outcome(rv.error) === 'refused' && !resent;
                if (never) clearOwn(o.store, o.uid, p.op);
                return { outcome: never ? 'refused' : 'unknown', data: null, error: rv.error, pending: p, resent, kept: !never };
            }
            // Signed in as someone else between registering and recording: kept, nothing recorded.
            if (!(await still(o))) return away();
            const r = await call(o.record, { p_op: p.op, p_body: p.body });
            const out = outcome(r.error);
            const settled = out === 'saved' || (out === 'refused' && (!resent || /OP_CANCELLED/.test(String(r.error && r.error.message))));
            if (settled) clearOwn(o.store, o.uid, p.op);
            return { outcome: out, data: r.data, error: r.error, pending: p, resent, kept: !settled };
        }, stop);
    }

    // The id to settle with the server: the whole save's, or the one
    // readable id of a damaged one.
    function settleOp(s) { return s.status === 'pending' ? s.pending.op : s.status === 'damaged' ? s.op : null; }

    // "Cancel it": 'recorded' (it had been saved — nothing more to do) or
    // 'cancelled' (it never will be). Forgotten either way; kept if no answer.
    // 'unrecoverable': damaged with no readable id — only recover() settles it.
    // 'none' / 'blocked' / 'no_account' / 'busy' / 'account_changed': nothing asked, nothing changed.
    // o: {store, uid, locks, account(), cancelOp(args)}
    function cancel(o) {
        if (!o.uid) return Promise.resolve({ state: 'no_account' });
        return locked(o, async () => {
            const s = inspect(o.store, o.uid);
            if (s.status === 'none' || s.status === 'blocked') return { state: s.status };
            const op = settleOp(s);
            if (!op) return { state: 'unrecoverable' };
            if (!(await still(o))) return Object.assign({}, changed);
            const r = await call(o.cancelOp, { p_op: op });
            if (r.error || (r.data !== 'recorded' && r.data !== 'cancelled')) return { state: 'unknown', error: r.error, op };
            clearOwn(o.store, o.uid, op);
            return { state: r.data, op, pending: s.pending || null };
        }, asState);
    }

    // On opening the form: has the server recorded it meanwhile? 'recorded'
    // or 'cancelled' → forgotten. 'none' → kept: the first request may still
    // arrive, so only "Send it again" or "Cancel it" settles it.
    // o: {store, uid, locks, account(), stateOp(args)}
    function check(o) {
        if (!o.uid) return Promise.resolve({ state: 'no_account' });
        return locked(o, async () => {
            const s = inspect(o.store, o.uid);
            if (s.status === 'none') return { state: 'none_pending' };
            if (s.status === 'blocked') return { state: 'blocked' };
            const op = settleOp(s);
            if (!op) return { state: 'unrecoverable' };
            if (!(await still(o))) return Object.assign({}, changed);
            const r = await call(o.stateOp, { p_op: op });
            if (r.error) return { state: 'unknown', error: r.error, op };
            if (r.data === 'recorded' || r.data === 'cancelled') clearOwn(o.store, o.uid, op);
            return { state: r.data, op, pending: s.pending || null };
        }, asState);
    }

    // "Check with the server", for a damaged save with no readable id: the
    // server settles EVERY registered save of this account it has no answer
    // for (pur_op_recover — each cancelled for good, or found recorded). Only
    // then is the damaged copy cleared — and only if it is still the same.
    // 'settled' {cancelled, recorded}; 'unknown' (kept); 'refused' (a save
    // that can be settled by its own id — Send it again / Cancel it).
    // o: {store, uid, locks, account(), recoverOps()}
    function recover(o) {
        if (!o.uid) return Promise.resolve({ state: 'no_account' });
        return locked(o, async () => {
            const s = inspect(o.store, o.uid);
            if (s.status === 'blocked') return { state: 'blocked' };
            if (s.status !== 'damaged' || s.op) return { state: 'refused' };
            if (!(await still(o))) return Object.assign({}, changed);
            const r = await call(o.recoverOps, {});
            if (r.error || !r.data || typeof r.data !== 'object') return { state: 'unknown', error: r.error };
            let same = false;
            try { same = o.store.getItem(key(o.uid)) === s.raw && o.store.getItem(opKey(o.uid)) === s.rawOp; } catch (e) { same = false; }
            const cleared = same && write(o.store, o.uid, null);
            return { state: 'settled', cancelled: Number(r.data.cancelled) || 0, recorded: Number(r.data.recorded) || 0, cleared };
        }, asState);
    }

    const api = { key, opKey, inspect, read, write, clearOwn, probe, outcome, submit, cancel, check, recover };
    root.DacsPendingSave = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
