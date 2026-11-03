// ════════════════════════════════════════════════════════════════════
// A SAVE THAT MAY HAVE REACHED THE SERVER:  run with  node tests/expense-pending-save.test.js
//
// Zero dependencies. Drives the REAL js/expense-pending-save.js against a
// fake server that behaves like pur_op_reserve / pur_record / pur_op_cancel /
// pur_op_state / pur_op_recover (0096, 0106, 0109): an operation id is
// recorded once PER ACCOUNT, a repeated id gets the first answer back, a
// cancelled id is refused for good, recovery cancels every registered id the
// server has no answer for. Tabs share one browser storage and one fake of
// the browser's locks (navigator.locks). Then runs Project Control's own Add
// Expense code on a fake page.
//   1. Accepted → reply lost → the form edited → Send it again: recorded once,
//      exactly as first entered (purchase AND payment); the edit is not sent.
//   2. Accepted → reply lost → closed, page reloaded → reopened: the same id
//      and body are still there; sending again records nothing new.
//   3. Never reached the server → sent again → recorded once.
//   4. Cancel it: not recorded → cancelled for good (a late arrival is
//      refused); recorded → nothing to cancel, nothing twice.
//   5. A refusal saves nothing and is forgotten. Every id is registered
//      before it is sent.
//   6. Two tabs: one save at a time per account — a second tab pressing while
//      the first builds, uploads or sends gets nothing sent; no save is ever
//      overwritten or lost; an answer clears only its own save.
//   7. Browser storage blocked (refuses, silently drops, full): nothing sent
//      or uploaded, nothing kept in page memory; a save kept before storage
//      was blocked is never discarded and blocks a new entry.
//   8. Damaged storage: never "nothing waiting"; the kept id settles it; with
//      no readable id only the server settles it (recovery) — the original
//      arriving after the list was checked is refused. No clearing by hand.
//   9. Another account on the same browser never sees, sends or settles it.
//  10. Bound to the account that started it: a sign-in change (another tab)
//      stops every further request and keeps what is unsettled; the other
//      account never sends or settles it; the first settles it afterwards.
//      A later attempt refused for another reason keeps the save.
//  11. Project Control: the form locks for a save still waiting AND for
//      blocked or damaged storage; another tab saving is said in words; every
//      request of a save carries the sign-in of the account that pressed Save.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const MOD = path.join(__dirname, '..', 'js', 'expense-pending-save.js');
const EXP = read('js/expenses-module.js');
const HTML = read('admin.html');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((label || '') + ' expected ' + y + ', got ' + x);
}
// A fresh copy of the module — what a reloaded page, or another tab, gets (its memory starts empty).
function load() { delete require.cache[require.resolve(MOD)]; return require(MOD); }
const settle = () => new Promise(r => setTimeout(r, 0));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
// localStorage as the browser keeps it across a reload — shared by every tab. mode:
//   'ok' · 'blocked' (every call throws, as with storage switched off) ·
//   'drop' (writes silently ignored) · 'full' (writes over 64 characters throw:
//   the quota — a short test write passes, the save itself does not).
function storage(mode) {
  const m = new Map();
  const s = { mode: mode || 'ok', m };
  const deny = () => { throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); };
  s.getItem = (k) => { if (s.mode === 'blocked') deny(); return m.has(k) ? m.get(k) : null; };
  s.setItem = (k, v) => {
    if (s.mode === 'blocked') deny();
    if (s.mode === 'drop') return;
    if (s.mode === 'full' && String(v).length > 64) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    m.set(k, String(v));
  };
  s.removeItem = (k) => { if (s.mode === 'blocked') deny(); if (s.mode === 'drop') return; m.delete(k); };
  return s;
}
// navigator.locks as the browser shares it between tabs of one site: request(name, {ifAvailable}, cb).
function locks() {
  const held = new Set();
  return { held, request: async (name, opts, cb) => {
    if (held.has(name)) { if (opts && opts.ifAvailable) return cb(null); throw new Error('test: waiting for a lock is never asked'); }
    held.add(name);
    try { return await cb({ name }); } finally { held.delete(name); }
  } };
}
// The server: pur_ops and the registrations per (account, operation id), as 0096/0106/0109 key them; a purchase
// with its payments in one transaction. srv.as(uid) is that account's session; srv.reserve / record / … are UID's.
function server() {
  const ops = new Map(), cancelled = new Set(), reserved = new Set();
  const s = { purchases: [], payments: [], lose: null, refuse: null, loseReserve: false, refuseReserve: null, loseRecover: false,
              calls: 0, unregistered: 0 };
  s.as = (actor) => ({
    reserve: async ({ p_op }) => {
      s.calls++;
      if (s.refuseReserve) { const code = s.refuseReserve; s.refuseReserve = null; return { data: null, error: { code: 'P0001', message: code } }; }
      if (s.loseReserve) { s.loseReserve = false; throw new TypeError('Failed to fetch'); }
      reserved.add(actor + '|' + p_op);
      return { data: null, error: null };
    },
    record: async ({ p_op, p_body }) => {
      s.calls++;
      const k = actor + '|' + p_op;
      if (!reserved.has(k)) s.unregistered++;
      if (s.refuse) { const code = s.refuse; s.refuse = null; return { data: null, error: { code: 'P0001', message: code } }; }
      if (s.lose === 'before') { s.lose = null; throw new TypeError('Failed to fetch'); }          // not arrived (yet)
      if (cancelled.has(k)) return { data: null, error: { code: 'P0001', message: 'OP_CANCELLED' } };
      if (ops.has(k)) return { data: Object.assign({}, ops.get(k), { replayed: true }), error: null };
      const r = { purchase_id: 'P' + (s.purchases.length + 1), pay: (p_body.payments || []).length ? { state: 'paid' } : undefined };
      s.purchases.push(Object.assign({ by: actor }, JSON.parse(JSON.stringify(p_body))));
      (p_body.payments || []).forEach(x => s.payments.push(Object.assign({ op: p_op }, x)));
      ops.set(k, r);
      if (s.lose === 'after') { s.lose = null; return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }; }  // saved, reply lost
      return { data: r, error: null };
    },
    cancelOp: async ({ p_op }) => {
      s.calls++;
      const k = actor + '|' + p_op;
      if (ops.has(k)) return { data: 'recorded', error: null };
      cancelled.add(k);
      return { data: 'cancelled', error: null };
    },
    stateOp: async ({ p_op }) => {
      s.calls++;
      const k = actor + '|' + p_op;
      return { data: ops.has(k) ? 'recorded' : cancelled.has(k) ? 'cancelled' : 'none', error: null };
    },
    // pur_op_recover: every registered id of this account with no answer → cancelled for good.
    recoverOps: async () => {
      s.calls++;
      if (s.loseRecover) { s.loseRecover = false; throw new TypeError('Failed to fetch'); }
      let n = 0;
      for (const k of reserved) if (k.startsWith(actor + '|') && !ops.has(k) && !cancelled.has(k)) { cancelled.add(k); n++; }
      return { data: { cancelled: n, recorded: 0 }, error: null };
    },
  });
  Object.assign(s, s.as(UID));
  return s;
}
let n = 0;
const newId = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
// The form as typed: ₱1,000, "Paid in full". counted() also counts how often
// the body was built (uploads happen there); slow() waits for an upload.
const form = (amount, paid = true) => () => ({ source: 'expenses_form', receipt_total: amount,
  lines: [{ destination: 'project', folder_id: 'F', item_name: 'Cement', amount }],
  ...(paid ? { payments: [{ amount: String(amount), source: 'company', method: 'gcash' }] } : {}) });
const counted = (amount) => { const f = form(amount); const b = async () => { b.calls++; return f(); }; b.calls = 0; return b; };
const slow = (amount, upload) => { const f = form(amount); const b = async () => { b.calls++; await upload.promise; return f(); }; b.calls = 0; return b; };
const UID = 'user-1';
// One tab's calls for UID: the shared storage, the shared locks, the server.
const tab = (store, lk, srv, extra = {}) => Object.assign({ store, uid: UID, locks: lk, account: async () => UID, newId, reserve: srv.reserve,
  record: srv.record, cancelOp: srv.cancelOp, stateOp: srv.stateOp, recoverOps: srv.recoverOps }, extra);
// session.current: who is signed in in this browser right now (any tab can change it).
const base = () => {
  const srv = server(), store = storage(), lk = locks(), session = { current: UID };
  return { srv, store, lk, session, t: (extra) => tab(store, lk, srv, Object.assign({ account: async () => session.current }, extra)) };
};
const status = (s) => [s.status, s.op === undefined ? null : s.op];

// ── Lost replies, Send it again, Cancel it ────────────────────────────

test('accepted → reply lost → the form edited → Send it again: recorded once, exactly as first entered — purchase and payment', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'after';
  const first = await ps.submit(t({ build: form(1000), label: 'Cement · ₱1,000' }));
  eq([first.outcome, first.resent, srv.purchases.length, srv.payments.length], ['unknown', false, 1, 1], 'the server saved it; the reply was lost');
  const kept = ps.read(store, UID);
  eq([kept.op, kept.body.receipt_total, kept.label], [first.pending.op, 1000, 'Cement · ₱1,000'], 'kept: the same id and body');
  const calls = srv.calls;
  // The person changes the amount to ₱1,200 (Project Control locks the form; this proves the module never sends the edit).
  const save = await ps.submit(t({ build: form(1200) }));
  eq([save.outcome, save.error.message, srv.calls], ['blocked', 'SAVE_PENDING', calls], 'Save while one waits sends nothing');
  const again = await ps.submit(t({ resend: true, build: form(1200) }));
  eq([again.outcome, again.resent, again.data.replayed, again.pending.op], ['saved', true, true, first.pending.op], 'the first answer, replayed');
  eq([srv.purchases.length, srv.payments.length, srv.purchases[0].receipt_total, srv.payments[0].amount], [1, 1, 1000, '1000'],
     'one purchase, one payment, the first values');
  eq(ps.read(store, UID), null, 'settled: forgotten');
});

test('accepted → reply lost → closed, page reloaded → reopened: the same id and body; sending again records nothing new', async () => {
  const { srv, store, t } = base();
  srv.lose = 'after';
  const first = await load().submit(t({ build: form(1000) }));
  const ps = load();                                                           // a reloaded page
  eq([ps.read(store, UID).op, ps.read(store, UID).body.receipt_total], [first.pending.op, 1000], 'still kept after the reload');
  const seen = await ps.check(t());
  eq(seen.state, 'recorded', 'on opening, the server says it was recorded');
  eq(ps.read(store, UID), null, 'and it is forgotten — nothing to send again');
  eq([srv.purchases.length, srv.payments.length], [1, 1]);
  const next = await ps.submit(t({ build: form(80, false) }));
  eq([next.outcome, next.resent, srv.purchases.length], ['saved', false, 2]);
  ok(next.pending.op !== first.pending.op, 'a new id for a new entry');
});

test('reply lost and the server not yet sure ("none"): kept through close and reload until sent again — then once', async () => {
  const { srv, store, t } = base();
  srv.lose = 'before';                                                         // the request never arrived
  const first = await load().submit(t({ build: form(1000) }));
  eq([first.outcome, srv.purchases.length], ['unknown', 0]);
  const ps = load();
  eq((await ps.check(t())).state, 'none', 'not recorded (yet)');
  eq(ps.read(store, UID).op, first.pending.op, 'kept: the first request could still arrive');
  const again = await ps.submit(t({ resend: true, build: form(5555) }));
  eq([again.outcome, again.resent, srv.purchases.length, srv.purchases[0].receipt_total], ['saved', true, 1, 1000]);
  eq(ps.read(store, UID), null);
});

test('Cancel it: not recorded → cancelled for good, and the first request arriving late is refused', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'before';
  const first = await ps.submit(t({ build: form(1000) }));
  const c = await ps.cancel(t());
  eq([c.state, ps.read(store, UID)], ['cancelled', null]);
  const late = await srv.record({ p_op: first.pending.op, p_body: first.pending.body });
  eq([late.error && late.error.message, srv.purchases.length], ['OP_CANCELLED', 0], 'the late arrival records nothing');
  const fresh = await ps.submit(t({ build: form(1000) }));
  eq([fresh.outcome, srv.purchases.length, srv.payments.length], ['saved', 1, 1], 'entered again: once');
});

test('Cancel it after it was recorded: the server says so — nothing cancelled, nothing twice', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'after';
  await ps.submit(t({ build: form(1000) }));
  const c = await ps.cancel(t());
  eq([c.state, ps.read(store, UID), srv.purchases.length, srv.payments.length], ['recorded', null, 1, 1]);
});

test('Cancel it with no answer again: kept, nothing changed', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'before';
  await ps.submit(t({ build: form(1000) }));
  const c = await ps.cancel(t({ cancelOp: async () => { throw new TypeError('Failed to fetch'); } }));
  eq([c.state, !!ps.read(store, UID)], ['unknown', true]);
});

test('a refusal saves nothing and is forgotten; the next press is a new entry', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.refuse = 'COMPLETED_PROJECT';
  const r = await ps.submit(t({ build: form(1000) }));
  eq([r.outcome, r.error.message, ps.read(store, UID), srv.purchases.length], ['refused', 'COMPLETED_PROJECT', null, 0]);
  eq(['P0001', 'PGRST202', '23505', '22P02', '42501', '28000', '', undefined].map(c => ps.outcome({ code: c })),
     ['refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'unknown', 'unknown']);
  eq(ps.outcome(null), 'saved');
});

test('an upload that fails before sending keeps nothing and sends nothing', async () => {
  const ps = load(), { srv, store, t } = base();
  let threw = '';
  try { await ps.submit(t({ build: async () => { throw new Error('upload failed'); } })); }
  catch (e) { threw = e.message; }
  eq([threw, ps.read(store, UID), srv.calls], ['upload failed', null, 0]);
});

test('every id is registered before it is sent; no answer to the registration: kept, nothing sent — Send it again registers, then records once', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.loseReserve = true;
  const first = await ps.submit(t({ build: form(1000) }));
  eq([first.outcome, srv.purchases.length, ps.read(store, UID).op], ['unknown', 0, first.pending.op], 'nothing sent; kept');
  const again = await ps.submit(t({ resend: true, build: form(1) }));
  eq([again.outcome, srv.purchases.length, srv.purchases[0].receipt_total], ['saved', 1, 1000]);
  // A NEW save whose registration is refused was never sent: forgotten.
  srv.refuseReserve = 'NOT_ALLOWED';
  const no = await ps.submit(t({ build: form(50) }));
  eq([no.outcome, no.error.message, ps.read(store, UID), srv.purchases.length], ['refused', 'NOT_ALLOWED', null, 1]);
  // A save that WAS sent before stays kept if its registration is refused on Send it again.
  srv.lose = 'before';
  const sent = await ps.submit(t({ build: form(70) }));
  srv.refuseReserve = 'NOT_ALLOWED';
  const re = await ps.submit(t({ resend: true, build: form(1) }));
  eq([re.outcome, ps.read(store, UID).op], ['unknown', sent.pending.op], 'not forgotten: its first request could still arrive');
  eq(srv.unregistered, 0, 'never a pur_record for an id the server had not registered');
});

// ── Two tabs: one save at a time per account ──────────────────────────

test('two tabs: Save in the second while the first is still uploading — the second sends nothing; the first save is kept, never overwritten; reply lost → recorded once', async () => {
  const { srv, store, lk, t } = base();
  const tabA = load(), tabB = load(), upA = deferred(), upB = deferred();
  srv.lose = 'after';
  const buildA = slow(1000, upA), buildB = slow(500, upB);
  const pa = tabA.submit(t({ build: buildA }));
  await settle();                                                              // A is uploading
  const pb = tabB.submit(t({ build: buildB }));                                // B presses Save meanwhile
  await settle();
  upA.resolve(); upB.resolve();
  const [ra, rb] = await Promise.all([pa, pb]);
  eq([ra.outcome, (tabB.read(store, UID) || {}).op], ['unknown', ra.pending.op], 'A\'s save — the one the server may hold — is still kept, not lost');
  eq([rb.outcome, rb.error && rb.error.message, buildB.calls, srv.purchases.length], ['blocked', 'SAVE_IN_PROGRESS', 0, 1],
     'B: nothing built, uploaded or sent');
  const rb2 = await tabB.submit(t({ build: form(500) }));
  eq(rb2.error.message, 'SAVE_PENDING', 'B\'s Save shows it instead of starting a new entry');
  const again = await tabB.submit(t({ resend: true }));
  eq([again.outcome, srv.purchases.length, srv.purchases[0].receipt_total, srv.payments.length], ['saved', 1, 1000, 1]);
  eq(lk.held.size, 0, 'the lock is released');
});

test('two tabs press Save at the same instant, both uploads slow, replies lost: exactly one is built and sent, and it is kept — whichever tab is first', async () => {
  for (const order of ['A first', 'B first']) {
    const { srv, store, t } = base();
    const tabA = load(), tabB = load(), up = deferred();
    const buildA = slow(1000, up), buildB = slow(500, up);
    srv.lose = 'after';
    const calls = order === 'A first' ? [tabA.submit(t({ build: buildA })), tabB.submit(t({ build: buildB }))]
                                      : [tabB.submit(t({ build: buildB })), tabA.submit(t({ build: buildA }))];
    up.resolve();
    const out = await Promise.all(calls);
    // Every save whose answer was lost is still kept — none lost, none overwritten.
    const kept = load().read(store, UID);
    eq(out.filter(r => r.outcome === 'unknown' && !(kept && kept.op === r.pending.op)).length, 0,
       order + ': saves the server may hold that are no longer kept (lost)');
    const sent = out.filter(r => r.outcome !== 'blocked'), busy = out.filter(r => r.outcome === 'blocked');
    eq([sent.length, busy.length, busy[0] && busy[0].error.message, buildA.calls + buildB.calls, srv.purchases.length],
       [1, 1, 'SAVE_IN_PROGRESS', 1, 1], order);
  }
});

test('while one tab is sending, the other tab\'s Cancel it, opening check and Check with the server do nothing; the answer then settles it', async () => {
  const { srv, store, lk, t } = base();
  const gate = deferred();
  const slowRecord = async (a) => { await gate.promise; return srv.record(a); };
  const pa = load().submit(t({ build: form(1000), record: slowRecord }));
  await settle();
  const other = load(), calls = srv.calls;
  eq([(await other.cancel(t())).state, (await other.check(t())).state, (await other.recover(t())).state, srv.calls],
     ['busy', 'busy', 'busy', calls], 'told another tab is saving; nothing asked');
  ok(other.read(store, UID), 'the save being sent is kept meanwhile');
  gate.resolve();
  eq([(await pa).outcome, other.read(store, UID), lk.held.size], ['saved', null, 0]);
});

test('an answer clears only its own save: another save found in storage meanwhile is kept — for Save, the opening check and Cancel it', async () => {
  const other = () => ({ op: newId(), body: form(70)(), at: 1, label: 'another save' });
  // Save: its reply arrives after something wrote another save behind the lock's back (an older page, say).
  { const { srv, store, t } = base(), gate = deferred(), ps = load();
    const pa = ps.submit(t({ build: form(1000), record: async (a) => { await gate.promise; return srv.record(a); } }));
    await settle();
    const y = other(); ps.write(store, UID, y);
    gate.resolve();
    eq([(await pa).outcome, ps.read(store, UID).op], ['saved', y.op], 'Save'); }
  // The opening check and Cancel it: the answer is for X; Y is kept.
  for (const which of ['check', 'cancel']) {
    const { srv, store, t } = base(), gate = deferred(), ps = load();
    srv.lose = 'after';
    await ps.submit(t({ build: form(1000) }));                               // X: recorded, reply lost
    const slowly = (fn) => async (a) => { await gate.promise; return fn(a); };
    const pc = which === 'check' ? ps.check(t({ stateOp: slowly(srv.stateOp) })) : ps.cancel(t({ cancelOp: slowly(srv.cancelOp) }));
    await settle();
    const y = other(); ps.write(store, UID, y);
    gate.resolve();
    eq([(await pc).state, ps.read(store, UID).op], ['recorded', y.op], which);
  }
  // And clearOwn itself: only every readable id equal to its own.
  const ps = load(), store = storage(), x = other(), y = other();
  ps.write(store, UID, x);
  eq([ps.clearOwn(store, UID, y.op), ps.read(store, UID).op], [false, x.op]);
  eq([ps.clearOwn(store, UID, x.op), ps.read(store, UID)], [true, null]);
});

test('a browser without locks sends nothing — two tabs could not be kept apart', async () => {
  const ps = load(), { srv, store, t } = base(), build = counted(1000);
  const r = await ps.submit(t({ locks: undefined, build }));
  eq([r.outcome, r.error.message, build.calls, srv.calls, store.m.size], ['blocked', 'LOCKS_UNAVAILABLE', 0, 0, 0]);
  srv.lose = 'before';
  await ps.submit(t({ build: form(1000) }));
  eq([(await ps.cancel(t({ locks: null }))).state, (await ps.check(t({ locks: {} }))).state, !!ps.read(store, UID)], ['blocked', 'blocked', true]);
});

// ── Browser storage blocked ──────────────────────────────────────────

test('storage blocked — refused, silently dropping writes, or full: nothing sent, nothing uploaded, nothing kept in page memory', async () => {
  for (const mode of ['blocked', 'drop', 'full']) {
    const ps = load(), srv = server(), store = storage(mode), lk = locks(), build = counted(1000);
    const r = await ps.submit(tab(store, lk, srv, { build }));
    eq([r.outcome, r.error.message, srv.calls, srv.purchases.length], ['blocked', 'STORAGE_BLOCKED', 0, 0], mode + ': nothing sent');
    // A full browser passes the short test write, so the body is built — and still never sent.
    eq(build.calls, mode === 'full' ? 1 : 0, mode + ': uploads only if a test write passed');
    store.mode = 'ok';
    eq(load().inspect(store, UID).status, 'none', mode + ': nothing half-kept (a reload sees no save)');
    eq(ps.read(store, UID), null, mode + ': and not in this page\'s memory either');
    store.mode = mode;
    const again = await ps.submit(tab(store, lk, srv, { build }));
    eq([again.outcome, srv.calls], ['blocked', 0], mode + ': pressed again');
  }
});

test('a save kept, then storage blocked: never discarded, no new entry sent; settled once when storage is back', async () => {
  const { srv, store, t } = base();
  srv.lose = 'before';
  const first = await load().submit(t({ build: form(1000) }));
  store.mode = 'blocked';                                                      // e.g. site data switched off, then the page reloaded
  const ps = load(), build = counted(1200), calls = srv.calls;
  eq(ps.inspect(store, UID).status, 'blocked', 'blocked — never "nothing waiting"');
  const save = await ps.submit(t({ build }));
  eq([save.outcome, save.error.message, build.calls, srv.calls], ['blocked', 'STORAGE_BLOCKED', 0, calls], 'a new press sends nothing');
  const resend = await ps.submit(t({ resend: true, build }));
  eq([resend.outcome, srv.calls], ['blocked', calls]);
  eq([(await ps.cancel(t())).state, (await ps.check(t())).state, (await ps.recover(t())).state, srv.calls],
     ['blocked', 'blocked', 'blocked', calls], 'nothing settles or clears it');
  store.mode = 'ok';
  eq(load().read(store, UID).op, first.pending.op, 'the same save, still kept');
  const again = await load().submit(t({ resend: true, build }));
  eq([again.outcome, srv.purchases.length, srv.purchases[0].receipt_total], ['saved', 1, 1000], 'once, as first entered');
});

test('a save kept, then storage drops writes: settling cannot clear it, so it stays — and stays once on the server', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'after';
  await ps.submit(t({ build: form(1000) }));
  store.mode = 'drop';
  const again = await ps.submit(t({ resend: true, build: form(1200) }));
  eq([again.outcome, again.data.replayed, ps.inspect(store, UID).status], ['saved', true, 'pending'], 'answered, but not cleared: still kept');
  const save = await ps.submit(t({ build: form(1200) }));
  eq([save.outcome, srv.purchases.length, srv.payments.length], ['blocked', 1, 1], 'Save still sends no new entry');
});

// ── Damaged storage ──────────────────────────────────────────────────

test('damaged storage, its id still readable: never "nothing waiting" — a new press sends nothing; the server settles it by that id', async () => {
  // (a) Saved, reply lost, then the kept body damaged: opening asks the server → recorded → cleared.
  let { srv, store, t } = base();
  srv.lose = 'after';
  const first = await load().submit(t({ build: form(1000) }));
  store.m.set(load().key(UID), '{"op":"' + first.pending.op + '","body":{"receipt_t');   // cut short
  let ps = load(), build = counted(1200);
  eq(status(ps.inspect(store, UID)), ['damaged', first.pending.op], 'damaged, with its id');
  eq(ps.read(store, UID), null, 'not a save that can be sent again');
  const save = await ps.submit(t({ build }));
  eq([save.outcome, save.error.message, build.calls, srv.purchases.length], ['blocked', 'STORAGE_DAMAGED', 0, 1], 'a new press sends nothing');
  eq((await ps.submit(t({ resend: true, build }))).error.message, 'STORAGE_DAMAGED', 'cannot be sent again');
  eq((await ps.recover(t())).state, 'refused', 'settled by its own id, not by recovery');
  eq((await ps.check(t())).state, 'recorded');
  eq([ps.inspect(store, UID).status, srv.purchases.length], ['none', 1], 'settled: once');
  // (b) Never arrived, then the body unreadable and only the id left: Cancel it → cancelled for good.
  ({ srv, store, t } = base());
  srv.lose = 'before';
  const lost = await load().submit(t({ build: form(1000) }));
  store.m.delete(load().key(UID));
  ps = load();
  eq(status(ps.inspect(store, UID)), ['damaged', lost.pending.op], 'only the id left');
  eq((await ps.check(t())).state, 'none', 'the server has not seen it');
  eq(ps.inspect(store, UID).status, 'damaged', 'so it stays');
  eq((await ps.cancel(t())).state, 'cancelled');
  const late = await srv.record({ p_op: lost.pending.op, p_body: lost.pending.body });
  eq([late.error.message, srv.purchases.length, ps.inspect(store, UID).status], ['OP_CANCELLED', 0, 'none'], 'a late arrival is refused');
});

test('damaged, no readable id: no new entry and no clearing by hand; Check with the server cancels every unsettled save — the original arriving AFTER the list was checked is refused', async () => {
  const damages = [
    ['both unreadable', (st, k, ok2) => { st.m.set(k, 'not json'); st.m.set(ok2, 'garbage'); }],
    ['the two ids disagree', (st, k, ok2) => { st.m.set(ok2, '00000000-0000-4000-8000-999999999999'); }],
    ['the body is whole but not a save', (st, k, ok2) => { st.m.set(k, JSON.stringify({ op: st.m.get(ok2) + 'x', body: [] })); st.m.delete(ok2); }],
  ];
  for (const [what, damage] of damages) {
    const { srv, store, t } = base();
    srv.lose = 'before';                                                       // the first request is still on its way
    const first = await load().submit(t({ build: form(1000) }));
    const ps = load();
    damage(store, ps.key(UID), ps.opKey(UID));
    const calls = srv.calls, build = counted(1);
    eq(status(ps.inspect(store, UID)), ['damaged', null], what);
    ok(!('forget' in ps), what + ': there is no "clear it by hand"');
    eq([(await ps.submit(t({ build }))).error.message, build.calls], ['STORAGE_DAMAGED', 0], what + ': no new entry');
    eq([(await ps.cancel(t())).state, (await ps.check(t())).state, srv.calls], ['unrecoverable', 'unrecoverable', calls],
       what + ': nothing it can ask by id');
    eq(srv.purchases.length, 0, what + ': the list is checked — the expense is not there (yet), which proves nothing');
    const r = await ps.recover(t());
    eq([r.state, r.cancelled, r.cleared, ps.inspect(store, UID).status], ['settled', 1, true, 'none'], what + ': settled by the server');
    const late = await srv.record({ p_op: first.pending.op, p_body: first.pending.body });   // the original finally arrives
    eq([late.error.message, srv.purchases.length, srv.payments.length], ['OP_CANCELLED', 0, 0], what + ': refused — never recorded');
    const fresh = await ps.submit(t({ build: form(1000) }));
    eq([fresh.outcome, srv.purchases.length, srv.payments.length], ['saved', 1, 1], what + ': entered again — once');
  }
});

test('damaged, no readable id, but the original HAD arrived: recovery cancels nothing — it is in the list once, never twice', async () => {
  const { srv, store, t } = base();
  srv.lose = 'after';
  await load().submit(t({ build: form(1000) }));
  store.m.set(load().key(UID), 'not json'); store.m.set(load().opKey(UID), 'garbage');
  const r = await load().recover(t());
  eq([r.state, r.cancelled, load().inspect(store, UID).status, srv.purchases.length, srv.payments.length], ['settled', 0, 'none', 1, 1]);
});

test('Check with the server with no answer: nothing changed, still no new entry; a whole save or one with its id is never settled that way', async () => {
  const { srv, store, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  store.m.set(load().key(UID), 'not json'); store.m.set(load().opKey(UID), 'garbage');
  srv.loseRecover = true;
  const ps = load();
  eq([(await ps.recover(t())).state, ps.inspect(store, UID).status], ['unknown', 'damaged']);
  eq((await ps.submit(t({ build: form(1) }))).error.message, 'STORAGE_DAMAGED');
  const w = base();
  w.srv.lose = 'before';
  await load().submit(w.t({ build: form(1000) }));
  eq([(await load().recover(w.t())).state, load().inspect(w.store, UID).status, w.srv.calls], ['refused', 'pending', 2], 'a whole save: Send it again or Cancel it');
});

test('the damaged copy is cleared only if it is still what recovery looked at', async () => {
  const { srv, store, t } = base(), gate = deferred(), ps = load();
  store.m.set(ps.key(UID), 'not json'); store.m.set(ps.opKey(UID), 'garbage');
  const pr = ps.recover(t({ recoverOps: async () => { await gate.promise; return srv.recoverOps(); } }));
  await settle();
  const y = { op: newId(), body: form(70)(), at: 1, label: 'written meanwhile' };
  ps.write(store, UID, y);
  gate.resolve();
  const r = await pr;
  eq([r.state, r.cleared, ps.read(store, UID).op], ['settled', false, y.op]);
});

// ── Other accounts ───────────────────────────────────────────────────

test('another account on this browser never sees, sends or settles it; the first account settles it once later', async () => {
  const { srv, store, lk, t } = base();
  srv.lose = 'before';
  const first = await load().submit(t({ build: form(1000) }));
  const ps = load(), other = srv.as('user-2'), calls = srv.calls;              // user-2 signs in on the same browser
  const u2 = (extra) => Object.assign(tab(store, lk, srv, extra), { uid: 'user-2', account: async () => 'user-2', reserve: other.reserve,
    record: other.record, cancelOp: other.cancelOp, stateOp: other.stateOp, recoverOps: other.recoverOps });
  eq([ps.inspect(store, 'user-2').status, ps.read(store, 'user-2')], ['none', null], 'nothing waiting for user-2');
  eq([(await ps.check(u2())).state, (await ps.cancel(u2())).state, (await ps.recover(u2())).state, srv.calls],
     ['none_pending', 'none', 'refused', calls], 'user-2 cannot settle or recover it');
  const resend = await ps.submit(u2({ resend: true, build: form(1) }));
  eq([resend.error.message, srv.calls], ['NOTHING_PENDING', calls], 'nor send it again');
  const own = await ps.submit(u2({ build: form(300, false) }));
  eq([own.outcome, own.resent, srv.purchases.length, srv.purchases[0].by], ['saved', false, 1, 'user-2'], 'user-2 saves their own entry');
  ok(own.pending.op !== first.pending.op, 'with their own id');
  eq([ps.read(store, UID).op, ps.read(store, UID).body.receipt_total], [first.pending.op, 1000], 'user-1\'s save untouched');
  ok(ps.key(UID) !== ps.key('user-2') && ps.opKey(UID) !== ps.opKey('user-2'), 'kept per account');
  // Why it must never reach user-2: the server keys operations per account — user-2 cancelling or recovering touches nothing of user-1's …
  eq([(await other.cancelOp({ p_op: first.pending.op })).data, (await other.recoverOps()).data.cancelled], ['cancelled', 0]);
  // … and user-1, back again, settles their save once.
  const back = await load().submit(t({ resend: true, build: form(9) }));
  eq([back.outcome, srv.purchases.length, srv.purchases[1].receipt_total, srv.purchases[1].by], ['saved', 2, 1000, UID]);
});

test('signed out (no account): nothing sent, nothing kept', async () => {
  const ps = load(), { srv, store, t } = base(), build = counted(1);
  eq(ps.inspect(store, null).status, 'no_account');
  const r = await ps.submit(t({ uid: null, build }));
  eq([r.outcome, r.error.message, build.calls, srv.calls, store.m.size], ['blocked', 'NO_ACCOUNT', 0, 0, 0]);
  eq([(await ps.cancel(t({ uid: null }))).state, (await ps.check(t({ uid: null }))).state, (await ps.recover(t({ uid: null }))).state],
     ['no_account', 'no_account', 'no_account']);
});

test('Send it again after another tab of this account settled it: nothing new is sent', async () => {
  const { srv, store, t } = base();
  srv.lose = 'after';
  await load().submit(t({ build: form(1000) }));
  await load().check(t());                                                     // the other tab: recorded → cleared
  const build = counted(1000);
  const r = await load().submit(t({ resend: true, build }));
  eq([r.outcome, r.error.message, build.calls, srv.purchases.length], ['blocked', 'NOTHING_PENDING', 0, 1]);
});

// ── Bound to the account that started it (R121) ──────────────────────

test('the signed-in account changes during a slow upload (another tab signs in as B): nothing sent, nothing kept; A, signed in again, saves once — as A', async () => {
  const { srv, store, session, t } = base(), up = deferred(), ps = load();
  const pa = ps.submit(t({ build: slow(1000, up) }));
  await settle();                                                              // A's receipt is uploading
  session.current = 'user-2';                                                  // another tab signs in as B
  up.resolve();
  const ra = await pa;
  eq([ra.outcome, ra.error.message, srv.calls, ps.inspect(store, UID).status, ps.inspect(store, 'user-2').status],
     ['blocked', 'ACCOUNT_CHANGED', 0, 'none', 'none'], 'stopped: no request at all, nothing kept for anyone');
  session.current = UID;                                                       // A signs in again
  const again = await ps.submit(t({ build: form(1000) }));
  eq([again.outcome, srv.purchases.length, srv.purchases[0].by, srv.payments.length], ['saved', 1, UID, 1]);
});

test('the signed-in account changes between registration and recording: nothing recorded; kept for A; B can neither send nor settle it; A, back, records it once', async () => {
  const { srv, store, lk, session, t } = base(), ps = load();
  const reserveThenSwitch = async (a) => { const r = await srv.reserve(a); session.current = 'user-2'; return r; };
  const ra = await ps.submit(t({ build: form(1000), reserve: reserveThenSwitch }));
  eq([ra.outcome, ra.error.message, ra.kept, srv.purchases.length], ['blocked', 'ACCOUNT_CHANGED', true, 0], 'stopped before recording');
  eq(ps.read(store, UID).op, ra.pending.op, 'kept — for A');
  // B, signed in now, with their own sign-in and storage: nothing of A's to send or settle.
  const other = srv.as('user-2');
  const u2 = (extra) => Object.assign(tab(store, lk, srv, extra), { uid: 'user-2', account: async () => 'user-2', reserve: other.reserve,
    record: other.record, cancelOp: other.cancelOp, stateOp: other.stateOp, recoverOps: other.recoverOps });
  const calls = srv.calls;
  eq([(await ps.submit(u2({ resend: true, build: form(1) }))).error.message, (await ps.cancel(u2())).state, (await ps.check(u2())).state,
      (await ps.recover(u2())).state, srv.calls], ['NOTHING_PENDING', 'none', 'none_pending', 'refused', calls], 'B: nothing');
  // A's own steps asked while B is signed in: nothing sent — it would carry B's sign-in.
  eq([(await ps.submit(t({ resend: true }))).error.message, (await ps.cancel(t())).state, (await ps.check(t())).state, srv.calls],
     ['ACCOUNT_CHANGED', 'account_changed', 'account_changed', calls], 'A\'s save untouched while B is signed in');
  eq([ps.read(store, UID).op, srv.purchases.length], [ra.pending.op, 0], 'still kept for A; still nothing recorded');
  session.current = UID;                                                       // A signs in again
  const back = await ps.submit(t({ resend: true }));
  eq([back.outcome, srv.purchases.length, srv.purchases[0].by, srv.purchases[0].receipt_total, srv.payments.length, ps.read(store, UID)],
     ['saved', 1, UID, 1000, 1, null], 'once, as A, exactly as first entered');
});

test('Check with the server while someone else is signed in: nothing asked, nothing changed; A, back, settles it', async () => {
  const { srv, store, session, t } = base(), ps = load();
  srv.lose = 'before';
  await ps.submit(t({ build: form(1000) }));
  store.m.set(ps.key(UID), 'not json'); store.m.set(ps.opKey(UID), 'garbage');
  session.current = 'user-2';
  const calls = srv.calls;
  eq([(await ps.recover(t())).state, srv.calls, ps.inspect(store, UID).status], ['account_changed', calls, 'damaged']);
  session.current = UID;
  eq([(await ps.recover(t())).state, ps.inspect(store, UID).status], ['settled', 'none']);
});

test('no way to tell who is signed in: nothing sent', async () => {
  const { srv, t } = base(), ps = load(), build = counted(1);
  const r = await ps.submit(t({ account: undefined, build }));
  eq([r.outcome, r.error.message, build.calls, srv.calls], ['blocked', 'ACCOUNT_CHANGED', 0, 0]);
  const r2 = await ps.submit(t({ account: async () => { throw new Error('sign-in check failed'); }, build }));
  eq([r2.error.message, build.calls, srv.calls], ['ACCOUNT_CHANGED', 0, 0]);
});

test('a later attempt refused for another reason keeps the save — its first request may have been recorded; Cancel it settles it, never twice', async () => {
  // Recorded, reply lost; sending it again is refused before the server reads the id (an expired sign-in, say).
  const { srv, store, t } = base(), ps = load();
  srv.lose = 'after';
  await ps.submit(t({ build: form(1000) }));
  const expired = async () => ({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } });
  const again = await ps.submit(t({ resend: true, record: expired }));
  eq([again.outcome, again.kept, ps.inspect(store, UID).status], ['refused', true, 'pending'], 'refused — but kept: it may have been recorded');
  eq((await ps.submit(t({ build: form(1000) }))).error.message, 'SAVE_PENDING', 'and no new entry over it');
  const c = await ps.cancel(t());
  eq([c.state, srv.purchases.length, ps.inspect(store, UID).status], ['recorded', 1, 'none'], 'Cancel it: it had been recorded — once');
  // Sent again after it was cancelled for good: refused as cancelled → forgotten.
  const w = base();
  w.srv.lose = 'before';
  const first = await load().submit(w.t({ build: form(500) }));
  await w.srv.cancelOp({ p_op: first.pending.op });                           // cancelled from another tab or device
  const r = await load().submit(w.t({ resend: true }));
  eq([r.outcome, r.error.message, r.kept, load().inspect(w.store, UID).status], ['refused', 'OP_CANCELLED', false, 'none']);
});

// ── Project Control's own code on a fake page ─────────────────────────
function slice(from, to) {
  const a = EXP.indexOf(from), b = EXP.indexOf(to, a);
  if (a === -1 || b === -1) throw new Error('SLICE NOT FOUND: ' + from);
  return EXP.slice(a, b);
}
function page(store, srv, lk, opts = {}) {
  const session = opts.session || { current: UID };
  const els = {};
  const el = (id, inBox, extra) => (els[id] = Object.assign({ id, style: {}, textContent: '', value: '', disabled: false, dataset: {},
    closest: (sel) => (sel === '#expPendingBox' && inBox ? els.expPendingBox : null), reset() { this.wasReset = true; } }, extra || {}));
  ['expPendingBox', 'expPendingText', 'addExpenseForm', 'addExpenseBtn', 'expSplitPreview', 'expNotes', 'expPaymentMethod'].forEach(id => el(id));
  el('expAmount', false, { value: '60' }); el('expName', false, { value: 'ZZ glue' }); el('expCategory', false, { value: 'Materials' });
  el('expQty', false, { value: '1' }); el('expDocPO', false, { files: opts.file ? [{ name: 'receipt.jpg' }] : [] });
  ['expPendingResend', 'expPendingCancel', 'expPendingRecover'].forEach(id => el(id, true));
  const form = ['expAmount', 'expName', 'addExpenseBtn', 'expPendingResend', 'expPendingCancel', 'expPendingRecover'];
  const document = { getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => sel === '[data-pending-lock]' ? Object.values(els).filter(e => e.dataset.pendingLock) : form.map(f => els[f]) };
  const rpcs = [], runs = [], shared = [], notes = [], closed = [];
  const asking = { answer: false, asked: 0 };
  const names = { pur_record: 'record', pur_op_reserve: 'reserve', pur_op_cancel: 'cancelOp', pur_op_state: 'stateOp', pur_op_recover: 'recoverOps' };
  const window = { localStorage: store, sbClient: {
    // Like the real shared client: it runs as whoever is signed in at that moment.
    rpc: (name, args) => { shared.push(name + ':' + session.current); return srv.as(session.current)[names[name]](args); },
    auth: { getSession: async () => ({ data: { session: session.current ? { user: { id: session.current }, access_token: 'tok-' + session.current } : null }, error: null }) },
  } };
  const supabase = { createClient: (url, key, cfg) => {
    const actor = String(cfg.global.headers.Authorization).replace('Bearer tok-', '');
    return { rpc: (name, args) => { rpcs.push(name); runs.push(name + ':' + actor); return srv.as(actor)[names[name]](args); } };
  } };
  const navigator = { locks: lk };
  const upload = opts.upload || (async () => 'https://files.test/receipt.jpg');
  const src = slice('// ── A save that may already be on the server', '\n// ════') + '\n' + slice('async function handleAddExpense(', '\nasync function deleteExpense(');
  const f = new Function('window', 'document', 'navigator', 'DacsPendingSave', 'showExpNotif', 'refreshOvAllData', 'closeExpModal', 'showConfirm',
    'showExpLoading', '_purErrorText', 'console', 'supabase', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'expCurrentProject', 'expCurrentFolder',
    '_buildDateTime', '_purLocalDateKey', '_expPaidNowProblem', 'formatNum', '_uploadReceiptFile', '_expPaidNowPayments', 'DacsReceipts',
    '_expSupplierBody', '_expSuppliers', '_purLoadReviewFlags',
    'let currentUser = null;\n' + src + '\nreturn { as: (u) => { currentUser = u ? { uid: u } : null; }, _expCheckPending, handleAddExpense };');
  const api = f(window, document, navigator, load(), (m, t) => notes.push(t + ': ' + m), () => {}, (id) => closed.push(id),
    async () => { asking.asked++; return asking.answer; }, () => {}, (e) => e.message, { error() {}, log() {} }, supabase, 'https://db.test', 'anon-key',
    { folderId: 'F' }, null, () => '', () => '2026-10-31', () => null, (n) => String(n), (kind, file) => upload(kind, file), () => [], { newId },
    () => ({}), [], async () => {});
  const setUser = api.as;
  const as = (u) => { setUser(u); session.current = u; };                      // signing in (this page's account and the browser's sign-in)
  as(UID);
  const shown = (id) => els[id].style.display !== 'none';
  return Object.assign(api, { as, els, rpcs, runs, shared, notes, closed, asking, window, session,
    locked: () => els.expAmount.disabled && els.addExpenseBtn.disabled && !els.expPendingCancel.disabled,
    box: () => shown('expPendingBox'), choices: () => ['expPendingResend', 'expPendingCancel', 'expPendingRecover'].filter(shown) });
}

test('the form: blocked storage locks it with no choices, and Save sends nothing', async () => {
  const srv = server(), store = storage('blocked'), pg = page(store, srv, locks());
  await pg._expCheckPending();
  eq([pg.box(), pg.locked(), pg.choices(), pg.rpcs], [true, true, [], []], 'locked, nothing to press, nothing asked');
  ok(/not letting Project Control keep a save/.test(pg.els.expPendingText.textContent), 'says why');
  await pg.handleAddExpense(null);
  eq(pg.rpcs, [], 'Save sends nothing');
  await pg.window.expResendPending();
  await pg.window.expCancelPending();
  eq(pg.rpcs, [], 'neither do the choices');
});

test('the form: a damaged save with its id offers only Cancel it; with none, only Check with the server — and the delayed original is refused afterwards', async () => {
  const { srv, store, lk, t } = base();
  srv.lose = 'before';
  const first = await load().submit(t({ build: form(1000) }));
  store.m.set(load().key(UID), '{broken');
  let pg = page(store, srv, lk);
  await pg._expCheckPending();
  eq([pg.box(), pg.locked(), pg.choices(), pg.rpcs], [true, true, ['expPendingCancel'], ['pur_op_state']], 'asked the server; still locked');
  await pg.handleAddExpense(null);
  eq(pg.rpcs, ['pur_op_state'], 'Save sends nothing');
  await pg.window.expCancelPending();
  eq([pg.rpcs, pg.box(), load().inspect(store, UID).status], [['pur_op_state', 'pur_op_cancel'], false, 'none'], 'Cancel it settles it');
  eq((await srv.record({ p_op: first.pending.op, p_body: first.pending.body })).error.message, 'OP_CANCELLED');
  // No readable id.
  srv.lose = 'before';
  const second = await load().submit(t({ build: form(400) }));
  store.m.set(load().key(UID), '{broken'); store.m.set(load().opKey(UID), '??');
  pg = page(store, srv, lk);
  await pg._expCheckPending();
  eq([pg.box(), pg.locked(), pg.choices(), pg.rpcs], [true, true, ['expPendingRecover'], []], 'only Check with the server');
  ok(/does not prove it will not still arrive/.test(pg.els.expPendingText.textContent), 'says why a missing row proves nothing');
  pg.asking.answer = false;
  await pg.window.expRecoverPending();
  eq([pg.asking.asked, pg.rpcs, load().inspect(store, UID).status, pg.locked()], [1, [], 'damaged', true], 'not confirmed: nothing asked, still locked');
  pg.asking.answer = true;
  await pg.window.expRecoverPending();
  eq([pg.rpcs, load().inspect(store, UID).status, pg.box(), pg.locked()], [['pur_op_recover'], 'none', false, false], 'settled by the server, then unlocked');
  ok(pg.notes.some(m => /1 save\(s\) that had not reached it are cancelled for good/.test(m)), 'said so');
  eq([(await srv.record({ p_op: second.pending.op, p_body: second.pending.body })).error.message, srv.purchases.length], ['OP_CANCELLED', 0],
     'the original arriving after the list check: refused');
});

test('the form: Send it again records once, unlocks and closes; a later attempt the server refuses keeps it locked with the reason until Cancel it settles it', async () => {
  let { srv, store, lk, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  let pg = page(store, srv, lk);
  await pg._expCheckPending();
  eq([pg.locked(), pg.choices()], [true, ['expPendingResend', 'expPendingCancel']]);
  await pg.window.expResendPending();
  eq([srv.purchases.length, srv.purchases[0].receipt_total, pg.box(), pg.locked(), pg.closed, !!pg.els.addExpenseForm.wasReset,
      load().inspect(store, UID).status], [1, 1000, false, false, ['addExpenseModal'], true, 'none'], 'recorded once; unlocked, cleared, closed');
  ok(pg.notes.some(m => /recorded now — once, exactly as first entered/.test(m)), 'said so');
  ok(pg.rpcs.indexOf('pur_op_reserve') < pg.rpcs.indexOf('pur_record'), 'registered before sending');
  // Refused on a LATER attempt: the first request may have been recorded — kept and locked, the reason shown; Cancel it settles it.
  ({ srv, store, lk, t } = base());
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  pg = page(store, srv, lk);
  await pg._expCheckPending();
  srv.refuse = 'COMPLETED_PROJECT';
  await pg.window.expResendPending();
  eq([srv.purchases.length, !!load().read(store, UID), pg.box(), pg.locked()], [0, true, true, true], 'kept and locked');
  ok(pg.notes.some(m => /The server refused this attempt \(COMPLETED_PROJECT\)/.test(m)), 'the reason shown');
  await pg.window.expCancelPending();
  eq([load().inspect(store, UID).status, pg.box(), pg.locked()], ['none', false, false], 'Cancel it: never recorded — settled, unlocked');
  // Refused because it was cancelled for good (from another tab or device): settled — forgotten and unlocked, the reason shown.
  ({ srv, store, lk, t } = base());
  srv.lose = 'before';
  const first = await load().submit(t({ build: form(1000) }));
  pg = page(store, srv, lk);
  await pg._expCheckPending();
  await srv.cancelOp({ p_op: first.pending.op });
  await pg.window.expResendPending();
  eq([load().inspect(store, UID).status, pg.box(), pg.locked(), srv.purchases.length], ['none', false, false, 0], 'forgotten and unlocked');
  ok(pg.notes.some(m => /^error: Error saving expense: OP_CANCELLED/.test(m)), 'the reason shown');
});

test('the form: a new save the server refuses is forgotten — unlocked, the reason shown, what was typed kept', async () => {
  const { srv, store, lk, session } = base();
  srv.refuse = 'COMPLETED_PROJECT';
  const pg = page(store, srv, lk, { session });
  await pg.handleAddExpense(null);
  eq([srv.purchases.length, load().inspect(store, UID).status, pg.box(), pg.locked(), !!pg.els.addExpenseForm.wasReset, pg.closed],
     [0, 'none', false, false, false, []]);
  ok(pg.notes.some(m => /^error: Error saving expense: COMPLETED_PROJECT/.test(m)), 'the reason shown');
});

test('the form: every request of a save carries the sign-in of the account that pressed Save — even when another tab signs in as B mid-request; the shared client is never used', async () => {
  const { srv, store, lk, session, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  const sw = { as: (actor) => Object.assign({}, srv.as(actor), {
    record: async (a) => { session.current = 'user-2'; return srv.as(actor).record(a); } }) };   // B signs in while the request is on its way
  const pg = page(store, sw, lk, { session });
  await pg._expCheckPending();
  await pg.window.expResendPending();
  eq([srv.purchases.length, srv.purchases[0].by, pg.shared, pg.runs], [1, UID, [], ['pur_op_state:user-1', 'pur_op_reserve:user-1', 'pur_record:user-1']],
     'recorded as A, through A\'s own sign-in');
});

test('the form: a page still showing A while B is signed in sends nothing — not even if the sign-in flips back to A a moment later', async () => {
  const { srv, store, lk, t, session } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  const pg = page(store, srv, lk, { session });
  await pg._expCheckPending();
  pg.runs.length = 0;
  session.current = 'user-2';                                                  // another tab signed in as B; this page still shows A
  let reads = 0;
  const getSession = pg.window.sbClient.auth.getSession;
  pg.window.sbClient.auth.getSession = async () => { const r = await getSession(); if (++reads === 1) session.current = UID; return r; };
  await pg.window.expResendPending();
  eq([pg.runs, pg.shared, srv.purchases.length, !!load().read(store, UID)], [[], [], 0, true], 'nothing sent with B\'s sign-in; kept for A');
  ok(pg.notes.some(m => /The signed-in account changed/.test(m)), 'said in words');
  await pg.window.expResendPending();                                          // A is signed in again: now it goes — once, as A
  eq([srv.purchases.length, srv.purchases[0].by, pg.shared], [1, UID, []]);
});

test('the form: another tab signs in as B while a receipt uploads — nothing is sent as anyone and the typed form stays; A, back, saves it once, as A', async () => {
  const { srv, store, lk, session } = base(), up = deferred();
  const pg = page(store, srv, lk, { session, file: true, upload: async () => { await up.promise; return 'https://files.test/r.jpg'; } });
  const press = pg.handleAddExpense(null);
  await settle();                                                              // the receipt is uploading
  session.current = 'user-2';
  up.resolve();
  await press;
  eq([pg.runs, pg.shared, srv.purchases.length, load().inspect(store, UID).status, !!pg.els.addExpenseForm.wasReset],
     [[], [], 0, 'none', false], 'no request at all; nothing kept; the form not cleared');
  ok(pg.notes.some(m => /The signed-in account changed/.test(m)), 'said in words');
  session.current = UID;                                                       // A signs in again and presses Save
  await pg.handleAddExpense(null);
  eq([srv.purchases.length, srv.purchases[0].by, srv.purchases[0].receipt_total, srv.purchases[0].docs.po_image_url, pg.shared],
     [1, UID, 60, 'https://files.test/r.jpg', []]);
});

test('the form: another tab signs in as B between registration and recording — never recorded as B; B\'s page cannot send or settle it; A, back, sends it again — once, as A', async () => {
  const { srv, store, lk, session } = base();
  let switched = false;
  const sw = { as: (actor) => Object.assign({}, srv.as(actor), {
    reserve: async (a) => { const r = await srv.as(actor).reserve(a); if (!switched) { switched = true; session.current = 'user-2'; } return r; } }) };
  const pg = page(store, sw, lk, { session });
  await pg.handleAddExpense(null);
  eq([srv.purchases.length, pg.runs, !!load().read(store, UID)], [0, ['pur_op_reserve:user-1'], true], 'registered as A, then stopped: kept for A');
  ok(pg.notes.some(m => /The signed-in account changed/.test(m)), 'said in words');
  pg.as('user-2');                                                             // the page is B's now
  await pg._expCheckPending();
  await pg.window.expResendPending();
  await pg.window.expCancelPending();
  eq([pg.runs, pg.shared, srv.purchases.length, !!load().read(store, UID), pg.box()], [['pur_op_reserve:user-1'], [], 0, true, false],
     'B sends and settles nothing of A\'s');
  pg.as(UID);                                                                  // A signs in again
  await pg._expCheckPending();
  eq([pg.box(), pg.choices()], [true, ['expPendingResend', 'expPendingCancel']], 'A sees it waiting');
  await pg.window.expResendPending();
  eq([srv.purchases.length, srv.purchases[0].by, load().read(store, UID), pg.shared], [1, UID, null, []], 'once, as A');
});

test('the form: another tab saving — Send it again, Cancel it and Check with the server send nothing and say so; the form stays locked', async () => {
  const { srv, store, lk, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  const pg = page(store, srv, lk);
  await pg._expCheckPending();
  pg.rpcs.length = 0;
  lk.held.add('dacs.addExpense.' + UID);                                       // the other tab holds this account's lock
  await pg.window.expResendPending();
  await pg.window.expCancelPending();
  eq([pg.rpcs, pg.locked(), !!load().read(store, UID)], [[], true, true], 'nothing sent; still kept and locked');
  ok(pg.notes.filter(m => /Another tab or window is saving an expense/.test(m)).length === 2, 'said in words, both times');
});

test('the form: another account opening Add Expense sees nothing and is not locked; the save waits for its own account', async () => {
  const { srv, store, lk, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  const pg = page(store, srv, lk);
  await pg._expCheckPending();
  eq([pg.box(), pg.locked(), pg.choices()], [true, true, ['expPendingResend', 'expPendingCancel']], 'user-1: locked, both choices');
  pg.as('user-2');
  await pg._expCheckPending();
  eq([pg.box(), pg.els.expAmount.disabled], [false, false], 'user-2: nothing shown, nothing locked');
  await pg.window.expResendPending();
  eq([pg.rpcs.filter(r => r === 'pur_record').length, srv.purchases.length, !!load().read(store, UID)], [0, 0, true],
     'user-2 pressing the old Send it again sends nothing; user-1\'s save is still kept');
});

test('Save only shows an unsettled save; the save is registered, then sent through pur_record with the kept id and body, under the account\'s lock', () => {
  const add = EXP.slice(EXP.indexOf('async function handleAddExpense('), EXP.indexOf('\nasync function deleteExpense('));
  ok(/const state = DacsPendingSave\.inspect\(pendingStore, actor\);/.test(add)
     && /if \(state\.status !== 'none' && !\(pending && opts\.resend\)\) \{ _expShowPending\(state\); return; \}/.test(add), 'checked first — blocked and damaged too');
  ok(/const calls = await _expBoundCalls\(actor\);\n\s+if \(!calls\) \{ showExpNotif\('Not sent — ' \+ _expNotSentText\('ACCOUNT_CHANGED'\), 'error'\); return; \}/.test(add)
     && /const res = await DacsPendingSave\.submit\(\{ store: pendingStore, uid: actor, locks: _expLocks\(\), account: _expAccountNow,\s+resend: !!opts\.resend, newId: \(\) => DacsReceipts\.newId\(\), build, label,\s+reserve: calls\.reserve, record: calls\.record \}\);/.test(add), 'through the module, bound to the account that pressed Save');
  ok(/if \(res\.outcome === 'blocked'\) \{/.test(add) && /_expNotSentText\(res\.error\.message\)/.test(add), 'nothing sent: said why');
  ok(/if \(res\.outcome === 'unknown'\) \{\n\s+_expShowPending\(\{ status: 'pending', pending: res\.pending \}\);/.test(add), 'no answer: locked');
  ok(!/_expSubmissionId/.test(EXP), 'the old per-form id is gone');
  ok(/window\.expResendPending = function \(\) \{ return handleAddExpense\(null, \{ resend: true \}\); \};/.test(EXP), 'Send it again');
  ok(/cancelOp: calls\.cancelOp/.test(EXP) && /stateOp: calls\.stateOp/.test(EXP) && /recoverOps: calls\.recoverOps/.test(EXP)
     && (EXP.match(/account: _expAccountNow/g) || []).length === 4, 'Cancel it, the check on opening, Check with the server: bound, account checked');
  ok(/global: \{ headers: \{ Authorization: 'Bearer ' \+ token \} \}/.test(EXP) && /if \(actor && s && s\.user && s\.user\.id === actor\) token = s\.access_token;/.test(EXP),
     'a client bound to the token of the account that pressed Save');
  ok(!/window\.sbClient\.rpc\('pur_(record|op_reserve|op_cancel|op_state|op_recover)'/.test(EXP), 'never the shared client for a save');
  ok(/function _expLocks\(\) \{ try \{ return navigator\.locks \|\| null; \} catch \(e\) \{ return null; \} \}/.test(EXP), 'the browser\'s locks');
  ok(/function _expActor\(\) \{ return \(typeof currentUser !== 'undefined' && currentUser && currentUser\.uid\) \|\| null; \}/.test(EXP), 'per account that pressed Save');
  const mod = read('js/expense-pending-save.js').replace(/\/\/.*$/gm, '');
  ok(!/localStorage|sessionStorage/.test(mod), 'the module is handed its storage, never a fallback');
  ok(!/\bforget\b/.test(mod) && !/DacsPendingSave\.forget|expForgetPending|I checked the list/.test(EXP + HTML), 'no clearing by hand anywhere');
});

test('the form locks while a save is unsettled; closing keeps it; opening checks it', () => {
  const show = EXP.slice(EXP.indexOf('function _expShowPending('), EXP.indexOf('\nfunction _expHidePending('));
  ok(/#addExpenseForm \.aer-body input, #addExpenseForm \.aer-body select, #addExpenseForm \.aer-body textarea, ' \+\s+'#addExpenseForm \.aer-body button, #addExpenseBtn'/.test(show), 'every field and Save');
  ok(/if \(el\.closest\('#expPendingBox'\) \|\| el\.disabled\) return;/.test(show), 'but the box\'s choices');
  const close = EXP.slice(EXP.indexOf('function closeExpModal('), EXP.indexOf('\n}\n', EXP.indexOf('function closeExpModal(')));
  ok(!/DacsPendingSave|addExpenseModal'\) _exp/.test(close), 'closing never forgets it');
  ok(/_expSetupPaidNow\(\);\n        _expCheckPending\(\);/.test(EXP), 'checked when Add Expense opens');
  ok(/const still = DacsPendingSave\.inspect\(pendingStore, actor\);\n        if \(still\.status !== 'none'\) _expShowPending\(still\);/.test(EXP), 'still locked after the press ends');
  ok(/<div id="expPendingBox" role="alert" style="display:none;/.test(HTML)
     && /id="expPendingResend" onclick="expResendPending\(\)">Send it again \(exactly as first entered\)</.test(HTML)
     && /id="expPendingCancel" onclick="expCancelPending\(\)">Cancel it</.test(HTML)
     && /id="expPendingRecover" style="display:none;" onclick="expRecoverPending\(\)">Check with the server</.test(HTML), 'the box and its choices');
  const a = HTML.indexOf('<script src="js/expense-pending-save.js?v='), b = HTML.indexOf('<script src="js/expenses-module.js?v=');
  ok(a !== -1 && a < b, 'loaded before Project Control');
  ok(/OP_CANCELLED:/.test(EXP), 'a cancelled save reads in words');
});

// A test that never settles (a save waiting forever) fails after 5 s — and if the run stops early, it fails too.
let finished = false;
process.on('exit', () => { if (!finished) { console.log('\nNOT FINISHED — a test never settled'); process.exitCode = 1; } });
(async () => {
  console.log('\nA save that may already be on the server (js/expense-pending-save.js)');
  for (const [name, fn] of queue) {
    let timer;
    try {
      await Promise.race([fn(), new Promise((_, no) => { timer = setTimeout(() => no(new Error('never settled (5 s)')), 5000); })]);
      passed++; console.log('  ok  ' + name);
    }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
    finally { clearTimeout(timer); }
  }
  finished = true;
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
