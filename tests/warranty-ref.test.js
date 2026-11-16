// ═══════════════════════════════════════════════════════════════════════════
// WARRANTY REFERENCE NUMBERS:  run with  node tests/warranty-ref.test.js
//
// Zero dependencies. Runs the REAL js/warranty-fund.js on a fake page and a
// fake database that honours its filters. The number is only a label (the id
// is the identity), but two records must not read the same.
//
// The bug this fences: a new record was numbered from the rows the Warranty
// Fund screen had already loaded. Close a project without that screen open and
// it had loaded nothing, so Los Churreros System Plus became WR-2026-0001 when
// Dapitan already was (21 Oct 2026).
//   1. A closing is numbered from the database, whatever the screen has loaded.
//   2. A deleted record's number is not reused; another year's or another
//      company's numbers do not count.
//   3. Two closings before the first can be read back still differ.
//   4. A failed read never stops a closing: it numbers from what is on hand.
//   5. Closing the same project again keeps its number and takes no new one.
//   6. A fund draw follows the same rules.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'warranty-fund.js'), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0, finished = false;
const failures = [];
const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const eq = (a, b, m) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((m ? m + ': ' : '') + 'got ' + x + ', wanted ' + y);
};

const OWNER = 'owner-1';
const NOW = '2026-11-03T03:00:00Z';
class FixedDate extends Date {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return new Date(NOW).getTime(); }
}

// Answers like the shim: .where(...).get() → { docs: [{ id, data() }] }; add() → { id }.
function fakeDb(seed, opts = {}) {
  const store = { warrantyRetentions: (seed.ret || []).map(r => ({ ...r })), warrantyFundExpenses: (seed.exp || []).map(r => ({ ...r })) };
  const query = (name, filters) => ({
    where: (f, op, v) => query(name, filters.concat([[f, v]])),
    get: async () => {
      if (opts.failRead && opts.failRead(filters)) throw new Error('offline');
      return { docs: store[name].filter(r => filters.every(([f, v]) => r[f] === v)).map(r => ({ id: r.id, data: () => ({ ...r }) })) };
    },
    onSnapshot: (apply) => {
      apply({ docs: store[name].filter(r => filters.every(([f, v]) => r[f] === v)).map(r => ({ id: r.id, data: () => ({ ...r }) })) });
      return () => {};
    },
  });
  return {
    store,
    collection: (name) => ({
      ...query(name, []),
      add: async (d) => {
        const row = { id: name + '-' + (store[name].length + 1), ...d };
        if (!opts.addedRowsUnreadable) store[name].push(row);
        return { id: row.id };
      },
      doc: (id) => ({ update: async (p) => { Object.assign(store[name].find(r => r.id === id), p); } }),
    }),
  };
}

function el(value) {
  return { value: value === undefined ? '' : value, textContent: '', innerHTML: '', style: {}, disabled: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, removeChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
}
function world(seed, opts, fields = {}) {
  const db = fakeDb(seed, opts);
  const els = {};
  const ctx = {
    db, Date: FixedDate, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } } },
    auth: { currentUser: { email: 'admin@dacsbuilding.com' } },
    currentUserRole: 'owner', currentDataUserId: OWNER,
    confirm: () => true, alert() {},
    document: { getElementById: (id) => els[id] || (els[id] = el(fields[id])), createElement: () => el(), body: el(),
                addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { db, win: ctx };
}
const row = (refNo, extra = {}) => ({ id: 'r' + refNo + (extra.projectId || ''), userId: OWNER, projectId: 'p-' + refNo, projectName: 'Old job',
                                      refNo, status: 'active', deletedAt: null, contributedAmount: 100, ...extra });
async function close(w, projectId) {
  await w.win.wfRecordCloseout({ projectId, projectName: 'New job', clientName: 'A client', totalPaid: 1000, directCost: 500 });
  return w.db.store.warrantyRetentions.find(r => r.projectId === projectId);
}

// The three records as they stood on 3 Nov 2026, then as corrected.
const AS_FOUND = [row('WR-2026-0001', { projectId: 'dapitan' }), row('WR-2026-0002', { projectId: 'san-rafael' }), row('WR-2026-0001', { projectId: 'system-plus' })];
const CORRECTED = [row('WR-2026-0001', { projectId: 'dapitan' }), row('WR-2026-0002', { projectId: 'san-rafael' }), row('WR-2026-0003', { projectId: 'system-plus' })];

[
  ['the screen never opened, the records as found', AS_FOUND, 'WR-2026-0003'],
  ['the screen never opened, the records as corrected', CORRECTED, 'WR-2026-0004'],
  ['nothing on record yet', [], 'WR-2026-0001'],
  ['a deleted record keeps its number', [row('WR-2026-0001'), row('WR-2026-0005', { deletedAt: '2026-09-01T00:00:00Z' })], 'WR-2026-0006'],
  ['last year\'s numbers do not count', [row('WR-2025-0009')], 'WR-2026-0001'],
  ['another company\'s numbers do not count', [row('WR-2026-0009', { userId: 'owner-2' })], 'WR-2026-0001'],
  ['a record with no number is passed over', [row('WR-2026-0002'), row(null, { projectId: 'none' })], 'WR-2026-0003'],
].forEach(([name, ret, want]) => test('closing: ' + name + ' → ' + want, async () => {
  const w = world({ ret });
  eq((await close(w, 'brand-new')).refNo, want);
}));

test('closing: two in one session, the first not yet readable, get different numbers', async () => {
  const w = world({ ret: CORRECTED }, { addedRowsUnreadable: true });
  const first = [], db = w.db;
  const realAdd = db.collection;
  db.collection = (name) => {
    const c = realAdd(name);
    return { ...c, add: async (d) => { first.push(d.refNo); return c.add(d); } };
  };
  await w.win.wfRecordCloseout({ projectId: 'a', totalPaid: 1000, directCost: 500 });
  await w.win.wfRecordCloseout({ projectId: 'b', totalPaid: 1000, directCost: 500 });
  eq(first, ['WR-2026-0004', 'WR-2026-0005']);
});

test('closing: a failed read still records it, numbered from what is on hand', async () => {
  const w = world({ ret: CORRECTED }, { failRead: (f) => f.some(([k]) => k === 'userId') });
  eq((await close(w, 'brand-new')).refNo, 'WR-2026-0001', 'nothing loaded');
});

test('closing: a failed read with the screen open numbers from the rows it loaded', async () => {
  let reading = false;
  const w = world({ ret: CORRECTED }, { failRead: (f) => reading && f.some(([k]) => k === 'userId') });
  w.win.initWarrantyFundModule();
  reading = true;
  eq((await close(w, 'brand-new')).refNo, 'WR-2026-0004');
});

test('closing the same project again keeps its number and takes no new one', async () => {
  const w = world({ ret: CORRECTED });
  eq((await close(w, 'system-plus')).refNo, 'WR-2026-0003', 'the same project');
  eq(w.db.store.warrantyRetentions.length, 3, 'no second record');
  eq((await close(w, 'brand-new')).refNo, 'WR-2026-0004', 'the next project');
});

const DRAW = { wfExpDescription: 'Repair', wfExpCategory: 'Labor', wfExpAmount: '500', wfExpDate: '2026-11-01' };
async function draw(seed) {
  const w = world(seed, {}, DRAW);
  await w.win.wfSaveDraw();
  return w.db.store.warrantyFundExpenses[w.db.store.warrantyFundExpenses.length - 1];
}
[
  ['the rows not loaded yet', [row('WF-2026-0001')], 'WF-2026-0002'],
  ['a deleted draw keeps its number', [row('WF-2026-0001'), row('WF-2026-0002', { deletedAt: '2026-09-01T00:00:00Z' })], 'WF-2026-0003'],
  ['none yet', [], 'WF-2026-0001'],
].forEach(([name, exp, want]) => test('draw: ' + name + ' → ' + want, async () => {
  eq((await draw({ exp })).refNo, want);
}));

process.on('exit', () => { if (!finished) { console.log('DID NOT FINISH'); process.exitCode = 1; } });
(async () => {
  console.log('\nWarranty reference numbers (js/warranty-fund.js)');
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
  process.exit(0);
})();
