// ═══════════════════════════════════════════════════════════════════
// PAYROLL READ FRESH — run with:  node tests/payroll-fresh-read.test.js
//
// Zero dependencies. Loads the REAL js/print-utils.js, expenses-module.js,
// overhead-module.js and invoice-module.js into one page-like context, and
// runs them against an in-memory server shared with "another tab".
//
// WHY THIS EXISTS — _ovAllPayroll is a copy taken when the page loads, and
// other accounts, tabs and devices change payroll without telling this page.
// Project Control's lists are live, so a worker statement or a receipt printed
// from that copy could disagree with the list above it and look correct.
//
// THE RULES UNDER GUARD
//   1. The shared copy holds no photos (0.6 MB against 15 MB).
//   2. A statement and a receipt read payroll just before printing. If the read
//      fails, nothing is printed and the message says so: never the old copy.
//   3. The print window opens on the click itself: a window opened after a wait
//      can be blocked by the browser.
//   4. The Overhead tab reads payroll when it opens. Until that read has landed,
//      or if it fails, operating costs stay on screen while everything built on
//      payroll is hidden (indirect labor, Project and Overall totals, the charts),
//      its reports refuse and the page says why. Old figures are never shown.
//   5. An older answer arriving late never replaces a newer one.
//   6. Money rules and staff restrictions do not move.
//
// If a reader of the shared copy is added, the "every reader" test fails: check
// that it needs no photo and that an old copy is safe for it, then list it.
// ═══════════════════════════════════════════════════════════════════
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const A = require('../js/billing-allocation.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const UID = 'owner-1';
const PHOTO = 'data:image/jpeg;base64,PHOTO-BYTES';
const EXPENSE_PHOTOS = ['poImageUrl', 'deliveryReceiptUrl', 'supplierInvoiceUrl', 'paymentReceiptUrl'];
const SOURCES = ['js/print-utils.js', 'js/expenses-module.js', 'js/overhead-module.js', 'js/invoice-module.js']
  .map(f => [f, read(f)]);

function row(id, fields) { return { id, userId: UID, ...fields }; }

function freshRows() {
  return {
    payroll: [
      row('pay1', { projectId: 'p', workerName: 'Mark', role: 'Mason', laborType: 'direct', contractId: 'k1', daysWorked: 2, dailyRate: 150, totalSalary: 300, paymentDate: '2026-10-05', paymentMethod: 'cash', receiptImages: [PHOTO] }),
      row('pay2', { projectId: 'p', workerName: 'Mark', role: 'Mason', laborType: 'direct', contractId: 'k1', daysWorked: 1, dailyRate: 200, totalSalary: 200, paymentDate: '2026-10-06', paymentMethod: 'cash', receiptImages: [] }),
      row('ind1', { projectId: 'p', workerName: 'Cora', role: 'Coordinator Site Supervision', laborType: 'indirect', totalSalary: 400, paymentDate: '2026-10-07', receiptImages: [] }),
      row('dir1', { projectId: 'p', workerName: 'Nena', role: 'Helper', laborType: 'direct', totalSalary: 150, paymentDate: '2026-10-07', receiptImages: [] }),
      { id: 'other', userId: 'someone-else', projectId: 'x', workerName: 'Other', totalSalary: 9999, paymentDate: '2026-10-07', receiptImages: [] }
    ],
    expenses: [
      row('e1', { projectId: 'p', expenseName: 'Cement', category: 'Materials', amount: 1000, dateTime: '2026-10-03T09:00', poImageUrl: PHOTO, deliveryReceiptUrl: PHOTO, supplierInvoiceUrl: '', paymentReceiptUrl: PHOTO }),
      row('e2', { projectId: 'c', expenseName: 'Sand', category: 'Materials', amount: 50, dateTime: '2026-10-03T09:00', coverExpense: true, poImageUrl: '', deliveryReceiptUrl: '', supplierInvoiceUrl: '', paymentReceiptUrl: '' })
    ],
    overheadExpenses: [
      row('ov1', { scope: 'project', folderId: 'f', expenseName: 'Fuel', category: 'Fuel', amount: 500, date: '2026-10-02', status: 'paid' }),
      row('co1', { scope: 'company', expenseName: 'Rent', category: 'Office Rent', amount: 70, date: '2026-10-02', status: 'paid' })
    ],
    users: [], settings: [], invoices: []
  };
}

// The server every tab talks to. A read takes its rows when it is asked and
// answers later, like a real one: `hold` delays the answer, `fail` refuses it.
function makeServer() {
  const server = { tables: freshRows(), reads: [], hold: null, holdCosts: null, fail: false, failPayroll: false, failCosts: false, listeners: {}, nextId: 1 };
  server.push = name => (server.listeners[name] || []).forEach(run => run());
  const answer = async (log, make) => {
    const costs = log.table === 'overheadExpenses';
    const hold = server.hold || (costs && server.holdCosts);
    const fail = server.fail || (server.failPayroll && log.table === 'payroll') || (server.failCosts && costs);
    server.reads.push(log);
    const result = make();
    if (hold) await hold;
    if (fail) throw new Error('network down');
    return result;
  };
  const query = name => {
    const state = { where: [], omit: [] };
    const api = {
      where(field, op, value) { state.where.push([field, value]); return api; },
      orderBy() { return api; },
      limit() { return api; },
      omit(...fields) { state.omit = fields.flat(); return api; },
      get() {
        return answer({ table: name, omit: state.omit.slice() }, () => {
          const rows = (server.tables[name] || []).filter(r => state.where.every(([f, v]) => r[f] === v));
          const docs = rows.map(r => {
            const copy = JSON.parse(JSON.stringify(r));
            const lazy = {};
            state.omit.forEach(f => {
              const v = copy[f];
              if (v && (!Array.isArray(v) || v.length)) lazy[f] = true;
              delete copy[f];
            });
            if (state.omit.length) copy._lazy = lazy;
            return { id: r.id, data: () => copy };
          });
          return { docs, empty: !docs.length, size: docs.length, forEach: fn => docs.forEach(fn) };
        });
      },
      onSnapshot(next, onErr) {
        const run = () => api.get().then(next).catch(e => onErr && onErr(e));
        (server.listeners[name] = server.listeners[name] || []).push(run);
        run();
        return () => { server.listeners[name] = server.listeners[name].filter(r => r !== run); };
      },
      async add(data) {
        const id = 'new' + (server.nextId++);
        (server.tables[name] = server.tables[name] || []).push({ id, ...data });
        return { id };
      },
      doc(id) {
        return {
          id,
          get() {
            return answer({ table: name, doc: id, omit: [] }, () => {
              const found = (server.tables[name] || []).find(r => r.id === id);
              const copy = found ? JSON.parse(JSON.stringify(found)) : undefined;
              return { id, exists: !!found, data: () => copy };
            });
          },
          async update(patch) {
            const found = (server.tables[name] || []).find(r => r.id === id);
            if (!found) throw new Error('no row');
            Object.assign(found, patch);
          },
          async delete() { server.tables[name] = (server.tables[name] || []).filter(r => r.id !== id); }
        };
      }
    };
    return api;
  };
  server.db = { collection: query };
  return server;
}

function openTab(server, role) {
  const elements = {};
  const el = id => elements[id] || (elements[id] = {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null,
    getContext() { return this; }, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    appendChild() {}, addEventListener() {}, removeEventListener() {}, click() {}
  });
  const popups = [], alerts = [], toasts = [];
  let popupsAllowed = true;
  const makePopup = features => {
    const popup = { features, chunks: [], closed: false, focus() {}, print() {}, addEventListener() {},
      close() { popup.closed = true; },
      document: { open() { popup.chunks = []; }, write(s) { popup.chunks.push(s); }, close() {} } };
    popup.page = () => popup.chunks.join('');
    return popup;
  };
  const windowObj = {
    currentUserRole: role || 'owner',
    location: { href: 'https://example.test/admin.html', origin: 'https://example.test' },
    open: (url, name, features) => {
      if (!popupsAllowed) return null;
      const popup = makePopup(features);
      popups.push(popup);
      return popup;
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} }, ...A, window: windowObj,
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
      createElement: () => el('created-' + Math.random()), createTextNode: () => ({}), body: { style: {}, appendChild() {}, removeChild() {} },
      head: { appendChild() {} }, documentElement: { style: {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'test' },
    Chart: class { constructor(canvas, config) { this.config = config; context.__charts = (context.__charts || 0) + 1; } destroy() {} update() {} },
    Blob: class { constructor(parts) { context.__csv = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    firebase: { auth: () => ({ currentUser: { uid: UID, email: 'owner@example.test' } }) },
    alert: m => alerts.push(m), confirm: () => true,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Event: class {}, CustomEvent: class {},
    db: server.db, currentUser: { uid: UID, email: 'owner@example.test' }
  });
  windowObj.document = context.document;
  for (const [file, source] of SOURCES) vm.runInContext(source, context, { filename: file });
  vm.runInContext(`
    expFolders = [{ id:'f', name:'ZZ Barlin', totalBudget:100000 }];
    expProjects = [{ id:'p', folderId:'f', month:'October', year:2026, monthlyBudget:5000 },
                   { id:'c', folderId:'f', month:'October', year:2026, fundingType:'president' }];
    expLaborContracts = [{ id:'k1', workerName:'Mark', agreedAmount:1000, category:'labor', payType:'pakyaw' }];
    _rptOvhdRows = [];
    showExpNotif = () => {};
    _ovhdMonth = '2026-10';
    _ovhdToast = (m, t) => { __toasts.push(m); };
  `, Object.assign(context, { __toasts: toasts }));
  el('expReportsView').style.display = 'none';
  const tab = { context, w: windowObj, el, popups, alerts, toasts, server,
    run: code => vm.runInContext(code, context),
    blockPopups() { popupsAllowed = false; },
    // What a page does when it loads, finished.
    async load() { context.subscribeOvAllData(); await tick(); return tab; } };
  return tab;
}

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const gate = () => { let open; const hold = new Promise(r => { open = r; }); return { hold, open }; };
const lastPage = tab => tab.popups[tab.popups.length - 1].page();
const reads = (server, table) => server.reads.filter(r => r.table === table);

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n')[0]); }
}

(async () => {
  console.log('\npayroll read fresh');

  console.log('\n— the shared copy holds no photos');

  await test('the page-load read leaves out every photo column, so no full table is downloaded', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    assert.deepStrictEqual(reads(server, 'expenses').map(r => r.omit), [EXPENSE_PHOTOS]);
    assert.deepStrictEqual(reads(server, 'payroll').map(r => r.omit), [['receiptImages']]);
    const copy = tab.run('JSON.stringify(_ovAllExpenses) + JSON.stringify(_ovAllPayroll)');
    assert.ok(!copy.includes('PHOTO-BYTES'), 'no photo in the shared copy');
    assert.strictEqual(tab.run('_ovAllPayroll.length'), 4, 'only this account\'s rows');
  });

  await test('the amounts in the shared copy are unchanged, and Cover stays inside Spent', async () => {
    const tab = await openTab(makeServer()).load();
    assert.strictEqual(tab.run("expProjects.find(p => p.id === 'p')._spent"), 1000 + 300 + 200 + 400 + 150);
    assert.strictEqual(tab.run("expProjects.find(p => p.id === 'c')._spent"), 50);
    const model = tab.run("_pcReportModel('f')");
    assert.strictEqual(model.totals.mats, 1050);
    assert.strictEqual(model.totals.cover, 50, 'Cover is a subset of Spent, never a fourth bucket');
    assert.strictEqual(model.totals.totalSpent, 1050 + 650 + 400, 'Labor 650 + Materials 1050 + indirect 400, each once');
  });

  await test('the worker receipt summary still gets its photos: it fetches a photo-free row when needed', async () => {
    const tab = await openTab(makeServer()).load();
    const filled = await tab.context._fillLazyPayroll(tab.run("_mergePayrollPools().filter(p => p.workerName === 'Mark')"));
    const pay1 = filled.find(p => p.id === 'pay1');
    assert.deepStrictEqual(Array.from(pay1.receiptImages), [PHOTO], 'pay1 has a photo: fetched');
    const after = tab.run("_mergePayrollPools().find(p => p.id === 'pay1')");
    assert.deepStrictEqual(Array.from(after.receiptImages), [PHOTO], 'and the print that follows finds it in the full-row cache');
  });

  await test('an older answer arriving late never replaces a newer one, for either table', async () => {
    const server = makeServer();
    const tab = openTab(server);
    const slow = gate();
    server.hold = slow.hold;
    tab.context.subscribeOvAllData();
    await tick();
    server.hold = null;
    server.tables.payroll = server.tables.payroll.filter(p => p.id !== 'dir1');
    server.tables.expenses = server.tables.expenses.filter(e => e.id !== 'e2');
    tab.context.subscribeOvAllData();
    await tick();
    slow.open();
    await tick();
    assert.strictEqual(tab.run('_ovAllPayroll.length'), 3, 'payroll stays the newer read');
    assert.strictEqual(tab.run('_ovAllExpenses.length'), 1, 'expenses stay the newer read');
  });

  await test('every reader of the shared copy is known: none uses a photo', () => {
    const allowed = {
      'js/expenses-module.js': ['_expNoPeriodRows', '_mergePayrollPools', '_ovReadPayroll', '_pcReportModel', '_rptAllTimeGroups', 'loadRptData',
        'mvpPayRenderFolderGrid', 'mvpPayRenderProjectGrid', 'mvpPayRenderTable', 'mvpRenderFolderGrid', '_updateSpent'],
      'js/invoice-module.js': ['printPayrollInvoice'],
      'js/overhead-module.js': ['_ovhdIndirectRows']
    };
    const photo = /receiptImages|receiptURL|poImageUrl|deliveryReceiptUrl|supplierInvoiceUrl|paymentReceiptUrl/;
    const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      .replace(/^let _ovAll(Expenses|Payroll).*$/gm, '').replace(/^const _EXP_PHOTO_FIELDS.*$/m, '').replace(/\.omit\('receiptImages'\)/g, '.omit()');
    for (const file of fs.readdirSync(path.join(__dirname, '../js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)) {
      const src = stripComments(read(file));
      if (!/_ovAll(Expenses|Payroll)/.test(src)) continue;
      assert.ok(allowed[file], file + ' reads the shared copy: check it needs no photo and that an old copy is safe, then list it');
      // Split on top-level functions, whichever way the file declares them.
      const parts = src.split(/\n(?=(?: {0,4})(?:async function [\w$]+\(|function [\w$]+\(|window\.[\w$]+ = (?:async )?function))/);
      const names = new Set();
      for (const part of parts) {
        if (!/_ovAll(Expenses|Payroll)/.test(part)) continue;
        const m = part.match(/^\s*(?:async )?(?:function ([\w$]+)|window\.([\w$]+) =)/);
        const name = m ? (m[1] || m[2]) : '(module top)';
        if (name === '(module top)') continue;
        names.add(name);
        assert.ok(!photo.test(part), name + ' in ' + file + ' reads a photo field');
      }
      assert.deepStrictEqual([...names].sort(), allowed[file].slice().sort(), file);
    }
  });

  console.log('\n— a receipt reads its entry just before printing');

  await test('payroll ADDED from another tab: the receipt prints it (it used to say "not found")', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const { id } = await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Lito', role: 'Painter', daysWorked: 3, dailyRate: 250, totalSalary: 750, paymentDate: '2026-10-08' });
    await tab.w.printSinglePayrollInvoice(id);
    assert.deepStrictEqual(tab.alerts, []);
    assert.ok(lastPage(tab).includes('Lito') && lastPage(tab).includes('750.00'), 'the new entry');
  });

  await test('payroll EDITED from another tab: the receipt prints the new amount, not the old one', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await server.db.collection('payroll').doc('pay1').update({ totalSalary: 345 });
    await tab.w.printSinglePayrollInvoice('pay1');
    assert.ok(lastPage(tab).includes('345.00'), 'the new amount');
    assert.ok(!lastPage(tab).includes('300.00'), 'not the old one');
  });

  await test('payroll DELETED from another tab: nothing printed, the window closes, the message says why', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await server.db.collection('payroll').doc('pay1').delete();
    await tab.w.printSinglePayrollInvoice('pay1');
    assert.ok(tab.popups[0].closed, 'the window closed');
    assert.ok(!tab.popups[0].page().includes('300.00'), 'nothing printed from the old copy');
    assert.strictEqual(tab.alerts.length, 1);
    assert.match(tab.alerts[0], /no longer exists/);
    assert.match(tab.alerts[0], /nothing was printed/);
  });

  await test('the read fails: nothing printed, the window closes, the message says so', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    server.fail = true;
    await tab.w.printSinglePayrollInvoice('pay1');
    assert.ok(tab.popups[0].closed);
    assert.ok(!tab.popups[0].page().includes('300.00'), 'never the old copy');
    assert.strictEqual(tab.alerts.length, 1);
    assert.match(tab.alerts[0], /nothing was printed/);
    assert.match(tab.alerts[0], /connection/);
  });

  await test('the window opens on the click itself, before the read; pop-ups blocked means no read and a message', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const slow = gate();
    server.hold = slow.hold;
    const pending = tab.w.printSinglePayrollInvoice('pay1');
    assert.strictEqual(tab.popups.length, 1, 'open before anything is awaited');
    assert.ok(!tab.popups[0].page().includes('300.00'));
    slow.open();
    await pending;
    assert.ok(lastPage(tab).includes('300.00'));
    assert.ok(!lastPage(tab).includes('Preparing'), 'the waiting text is gone from the finished page');

    const blocked = await openTab(makeServer()).load();
    blocked.blockPopups();
    const before = blocked.server.reads.length;
    await blocked.w.printSinglePayrollInvoice('pay1');
    assert.strictEqual(blocked.server.reads.length, before, 'no read');
    assert.match(blocked.alerts[0], /pop-ups/);
  });

  console.log('\n— a statement reads payroll just before printing');

  await test('payroll ADDED from another tab is on the statement, in the total and in Paid', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', role: 'Mason', laborType: 'direct', contractId: 'k1', daysWorked: 1, dailyRate: 250, totalSalary: 250, paymentDate: '2026-10-08' });
    await tab.w.printWorkerLaborSOA('Mark', 'f');
    const page = lastPage(tab);
    assert.deepStrictEqual(tab.alerts, []);
    assert.ok(page.includes('250.00'), 'the new payment');
    assert.ok(page.includes('750.00'), 'Paid and total 300 + 200 + 250');
    assert.ok(page.includes('1,000.00'), 'agreed');
  });

  await test('payroll EDITED from another tab: the statement shows the new amount and total', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await server.db.collection('payroll').doc('pay2').update({ totalSalary: 225 });
    await tab.w.printWorkerLaborSOA('Mark', 'f');
    assert.ok(lastPage(tab).includes('225.00') && lastPage(tab).includes('525.00'), 'new amount and total');
    assert.ok(!lastPage(tab).includes('500.00'), 'not the old total');
  });

  await test('payroll DELETED from another tab: gone from the statement and from the total', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await server.db.collection('payroll').doc('pay2').delete();
    await tab.w.printWorkerLaborSOA('Mark', 'f');
    assert.ok(!lastPage(tab).includes('200.00'), 'the deleted payment');
    assert.ok(!lastPage(tab).includes('500.00'), 'the old total');
    assert.ok(lastPage(tab).includes('700.00'), 'Remaining 1,000 − 300');
  });

  await test('every entry deleted: the window closes and the message says there are none', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    server.tables.payroll = server.tables.payroll.filter(p => p.workerName !== 'Mark');
    await tab.w.printWorkerLaborSOA('Mark', 'f');
    assert.ok(tab.popups[0].closed);
    assert.match(tab.alerts[0], /No labor entries found for Mark/);
  });

  await test('the read fails: nothing printed, the window closes, the message says so', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    server.fail = true;
    await tab.w.printWorkerLaborSOA('Mark', 'f');
    assert.ok(tab.popups[0].closed);
    assert.ok(!tab.popups[0].page().includes('500.00'), 'never the old copy');
    assert.strictEqual(tab.alerts.length, 1);
    assert.match(tab.alerts[0], /nothing was printed/);
    assert.match(tab.alerts[0], /connection/);
  });

  await test('the window opens on the click itself; pop-ups blocked means no read and a message', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const slow = gate();
    server.hold = slow.hold;
    const pending = tab.w.printWorkerLaborSOA('Mark', 'f');
    assert.strictEqual(tab.popups.length, 1, 'open before anything is awaited');
    slow.open();
    await pending;
    assert.ok(lastPage(tab).includes('500.00'));
    assert.ok(!lastPage(tab).includes('Preparing'), 'the waiting text is gone from the finished page');

    const blocked = await openTab(makeServer()).load();
    blocked.blockPopups();
    const before = blocked.server.reads.length;
    await blocked.w.printWorkerLaborSOA('Mark', 'f');
    assert.strictEqual(blocked.server.reads.length, before, 'no read');
    assert.match(blocked.alerts[0], /pop-ups/);
  });

  await test('a vendor statement still keeps vendors and workers apart', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    tab.run("expLaborContracts.push({ id:'v1', workerName:'Mark', agreedAmount:5000, category:'outsource' });");
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark Vendor', contractId: 'v1', totalSalary: 640, paymentDate: '2026-10-09' });
    await tab.w.printWorkerLaborSOA('Mark', 'f', 'outsource');
    assert.ok(lastPage(tab).includes('640.00'), 'the vendor payment, by its contract');
    assert.ok(lastPage(tab).includes('5,000.00'), 'the vendor contract');
    assert.ok(!lastPage(tab).includes('1,000.00'), 'not the worker contract');
  });

  console.log('\n— printing immediately after a save');

  await test('a statement right after a save has the new entry, even while the page\'s own refresh is still on its way', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', contractId: 'k1', totalSalary: 275, paymentDate: '2026-10-08' });
    const slow = gate();
    server.hold = slow.hold;
    tab.context.refreshOvAllData();     // what every Add/Edit Payroll save calls
    await tick();
    server.hold = null;
    await tab.w.printWorkerLaborSOA('Mark', 'f');
    assert.ok(lastPage(tab).includes('275.00') && lastPage(tab).includes('775.00'), 'the entry just saved, and the total');
    slow.open();
    await tick();
    assert.strictEqual(tab.run('_ovAllPayroll.length'), 5, 'and the slower refresh changes nothing');
  });

  await test('a receipt right after a save prints the entry just saved', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const { id } = await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Lito', totalSalary: 880, paymentDate: '2026-10-08' });
    const slow = gate();
    server.hold = slow.hold;
    tab.context.refreshOvAllData();
    await tick();
    server.hold = null;
    await tab.w.printSinglePayrollInvoice(id);
    assert.deepStrictEqual(tab.alerts, []);
    assert.ok(lastPage(tab).includes('880.00'));
    slow.open();
    await tick();
  });

  await test('a late answer from before the save never brings the old rows back into the shared copy', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const slow = gate();
    server.hold = slow.hold;
    tab.context.refreshOvAllData();     // reads, and is slow
    await tick();
    server.hold = null;
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', contractId: 'k1', totalSalary: 275, paymentDate: '2026-10-08' });
    await tab.w.printWorkerLaborSOA('Mark', 'f');
    slow.open();
    await tick();
    assert.strictEqual(tab.run('_ovAllPayroll.length'), 5, 'the statement\'s newer read stands');
  });

  await test('a statement whose read is overtaken by a newer one prints the newer rows', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const slow = gate();
    server.hold = slow.hold;
    const pending = tab.w.printWorkerLaborSOA('Mark', 'f');
    await tick();
    server.hold = null;
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', contractId: 'k1', totalSalary: 275, paymentDate: '2026-10-08' });
    tab.context.refreshOvAllData();
    await tick();
    slow.open();
    await pending;
    assert.ok(lastPage(tab).includes('275.00') && lastPage(tab).includes('775.00'), 'never the older answer');
  });

  await test('an overtaken read that answers first waits for the newer one: never the old copy', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const first = gate(), second = gate();
    server.hold = first.hold;
    const pending = tab.w.printWorkerLaborSOA('Mark', 'f');
    await tick();
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mark', contractId: 'k1', totalSalary: 275, paymentDate: '2026-10-08' });
    server.hold = second.hold;
    tab.context.refreshOvAllData();
    await tick();
    first.open();
    await tick();
    assert.ok(!tab.popups[0].page().includes('500.00'), 'still waiting, not printed from the old copy');
    second.open();
    await pending;
    assert.ok(lastPage(tab).includes('275.00') && lastPage(tab).includes('775.00'), 'the newer rows');
  });

  console.log('\n— the Overhead tab reads payroll when it opens');

  const openOverhead = async tab => { tab.context.initOverheadModule(); await tick(); };
  const amounts = tab => ({ project: tab.el('ovhdProjectAmount').textContent, company: tab.el('ovhdCompanyAmount').textContent, overall: tab.el('ovhdOverallAmount').textContent });
  const money = s => Number(String(s).replace(/[^0-9.]/g, ''));

  await test('indirect labor is in its totals once, and direct labor is not', async () => {
    const tab = await openTab(makeServer()).load();
    await openOverhead(tab);
    assert.strictEqual(money(amounts(tab).project), 500 + 400, 'fuel 500 + coordinator 400, not the mason or helper');
    assert.strictEqual(money(amounts(tab).company), 70);
    assert.strictEqual(money(amounts(tab).overall), 970);
  });

  await test('payroll ADDED, EDITED and DELETED from another tab all show when Overhead is opened', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await openOverhead(tab);
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Dino', role: 'Coordinator', laborType: 'indirect', totalSalary: 90, paymentDate: '2026-10-09' });
    await openOverhead(tab);
    assert.strictEqual(money(amounts(tab).project), 990, 'added');
    await server.db.collection('payroll').doc('ind1').update({ totalSalary: 410 });
    await openOverhead(tab);
    assert.strictEqual(money(amounts(tab).project), 1000, 'edited');
    await server.db.collection('payroll').doc('ind1').delete();
    await openOverhead(tab);
    assert.strictEqual(money(amounts(tab).project), 590, 'deleted');
  });

  await test('direct labor added from another tab stays out of Overhead: counted once, as Labor', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Mason Two', role: 'Mason', laborType: 'direct', totalSalary: 600, paymentDate: '2026-10-09' });
    await openOverhead(tab);
    assert.strictEqual(money(amounts(tab).project), 900);
  });

  // What must be gone while payroll is not current, wherever it would show.
  const assertNoPayrollFigures = (tab, word) => {
    assert.strictEqual(tab.el('ovhdProjectAmount').textContent, word, 'Project is a combined total');
    assert.strictEqual(tab.el('ovhdOverallAmount').textContent, word, 'Overall is a combined total');
    assert.strictEqual(tab.el('ovhdChartsBlock').style.display, 'none', 'the charts are built on the combined rows');
    assert.ok(!tab.el('ovhdTableBody').innerHTML.includes('Cora'), 'no individual indirect pay in the table');
    assert.ok(!tab.el('ovhdBreakdownList').innerHTML.includes('Coordinator'), 'no indirect labor in the breakdown');
    assert.strictEqual(tab.run('_ovhdRows().some(r => r.fromPayroll)'), false, 'nor in the rows every section reads');
    const cards = amounts(tab);
    assert.ok(!/900|970|400/.test(cards.project + cards.overall + tab.el('ovhdProjectTrend').innerHTML), 'no old or combined figure in the cards');
  };
  const assertOperatingCostsShow = (tab, company = 70, project = 500) => {
    assert.strictEqual(money(amounts(tab).company), company, 'Company overhead has no payroll in it');
    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Fuel'), 'project operating cost listed');
    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Rent'), 'company operating cost listed');
    assert.ok(tab.el('ovhdBreakdownList').innerHTML.includes('Fuel'), 'and in the breakdown');
    assert.match(tab.el('ovhdProjectTrend').innerHTML, /Operating costs only/, 'labelled, so it is not read as Project Overhead');
    assert.ok(tab.el('ovhdProjectTrend').innerHTML.includes(project.toFixed(2)), 'with its amount');
  };

  await test('while it reads: operating costs show, payroll and combined totals do not, and reports refuse', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const slow = gate();
    server.hold = slow.hold;
    tab.context.initOverheadModule();
    await tick();
    assert.match(tab.el('ovhdPayrollNote').textContent, /Loading the latest payroll/);
    assert.notStrictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
    tab.context.printOverheadReport('monthly');
    tab.context.exportOverheadCsv();
    assert.strictEqual(tab.popups.length, 0, 'no print');
    assert.strictEqual(tab.context.__csv, undefined, 'no CSV');
    assert.strictEqual(tab.toasts.length, 2, 'each says why');
    server.hold = null;
    slow.open();
    await tick();
    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none', 'the note goes away');
    assert.notStrictEqual(tab.el('ovhdChartsBlock').style.display, 'none', 'the charts come back');
    assert.strictEqual(money(amounts(tab).project), 900);
    tab.context.exportOverheadCsv();
    assert.ok(tab.context.__csv.includes('Cora'), 'CSV has indirect labor');
    tab.context.printOverheadReport('monthly');
    assert.strictEqual(tab.popups.length, 1, 'print works');
  });

  await test('re-opening never redraws the old payroll figures, even for the moment of the read', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await openOverhead(tab);
    assert.strictEqual(money(amounts(tab).project), 900);
    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Cora'));
    const slow = gate();
    server.hold = slow.hold;
    tab.context.initOverheadModule();     // nothing awaited: exactly what is on screen at once
    assertNoPayrollFigures(tab, 'Loading…');
    server.hold = null;
    slow.open();
    await tick();
  });

  await test('payroll fails: operating costs stay; payroll, combined totals and charts are hidden, even after a good visit', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await openOverhead(tab);
    assert.strictEqual(money(amounts(tab).overall), 970, 'a good visit');
    server.failPayroll = true;
    await openOverhead(tab);
    assertNoPayrollFigures(tab, 'Unavailable');
    assertOperatingCostsShow(tab);
    assert.match(tab.el('ovhdPayrollNote').textContent, /Payroll is unavailable/);
    assert.match(tab.el('ovhdPayrollNote').textContent, /open Overhead again/);
    assert.match(tab.el('ovhdBreakdownList').innerHTML, /of operating costs/, 'a share of what is shown, never "of total"');
    assert.doesNotMatch(tab.el('ovhdBreakdownList').innerHTML, /of total/);
    tab.context.printOverheadReport('monthly');
    tab.context.exportOverheadCsv();
    assert.strictEqual(tab.popups.length, 0);
    assert.strictEqual(tab.context.__csv, undefined);
    assert.ok(tab.toasts.every(t => /Payroll is unavailable/.test(t)) && tab.toasts.length === 2);
  });

  await test('payroll fails: the charts are not drawn at all, so none can hold an operating-only total', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    server.failPayroll = true;
    await openOverhead(tab);
    assert.strictEqual(tab.context.__charts || 0, 0, 'no chart drawn');
  });

  await test('payroll fails: operating costs stay current while the page is open, and the rest stays hidden', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    server.failPayroll = true;
    await openOverhead(tab);
    server.tables.overheadExpenses.push(row('co2', { scope: 'company', expenseName: 'Water', category: 'Water', amount: 30, date: '2026-10-03', status: 'paid' }));
    server.tables.overheadExpenses.push(row('ov2', { scope: 'project', folderId: 'f', expenseName: 'Diesel', category: 'Fuel', amount: 25, date: '2026-10-03', status: 'paid' }));
    server.push('overheadExpenses');
    await tick();
    assertOperatingCostsShow(tab, 100, 525);
    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Water'), 'the new cost is listed');
    assertNoPayrollFigures(tab, 'Unavailable');
  });

  await test('payroll fails with a category filter on a payroll role: the filter stays, the rows stay hidden, and it works again after', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await openOverhead(tab);
    const role = 'Coordinator Site Supervision';
    tab.el('ovhdCategorySel').value = role;
    tab.context.onOverheadCategoryChange(role);
    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Cora'));
    server.failPayroll = true;
    await openOverhead(tab);
    assert.ok(tab.el('ovhdCategorySel').innerHTML.includes(role), 'the chosen filter is still offered, not silently dropped');
    assert.strictEqual(tab.run('_ovhdCategory'), role);
    assert.ok(!tab.el('ovhdTableBody').innerHTML.includes('Cora'));
    server.failPayroll = false;
    await openOverhead(tab);
    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Cora'), 'back when payroll is');
  });

  await test('opening Overhead again retries, and everything comes back', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    server.failPayroll = true;
    await openOverhead(tab);
    server.failPayroll = false;
    await openOverhead(tab);
    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
    assert.notStrictEqual(tab.el('ovhdChartsBlock').style.display, 'none');
    assert.strictEqual(money(amounts(tab).project), 900);
    assert.strictEqual(money(amounts(tab).overall), 970);
    assert.doesNotMatch(tab.el('ovhdProjectTrend').innerHTML, /Operating costs only/);
    assert.match(tab.el('ovhdBreakdownList').innerHTML, /of total/);
    assert.ok(tab.el('ovhdTableBody').innerHTML.includes('Cora'));
    assert.ok((tab.context.__charts || 0) > 0, 'the charts are drawn again');
    tab.context.exportOverheadCsv();
    assert.ok(tab.context.__csv.includes('Cora'));
  });

  await test('offline from the start: costs did not load either, so nothing claims to show them, and no false zero appears', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    server.fail = true;      // payroll and the operating costs both fail
    await openOverhead(tab);
    assert.strictEqual(tab.el('ovhdCompanyAmount').textContent, 'Unavailable', 'not ₱0.00');
    assert.strictEqual(tab.el('ovhdProjectAmount').textContent, 'Unavailable');
    assert.strictEqual(tab.el('ovhdOverallAmount').textContent, 'Unavailable');
    assert.match(tab.el('ovhdPayrollNote').textContent, /Payroll and operating costs are unavailable/);
    assert.doesNotMatch(tab.el('ovhdPayrollNote').textContent, /still show/);
    assert.doesNotMatch(tab.el('ovhdTableBody').innerHTML, /No overhead expenses match/, 'an unloaded list must not read as an empty one');
    assert.doesNotMatch(tab.el('ovhdBreakdownList').innerHTML, /No expenses match/);
    server.fail = false;
    await openOverhead(tab);
    await tick();
    assert.strictEqual(money(amounts(tab).company), 70, 'opening again re-reads the costs too');
    assert.strictEqual(money(amounts(tab).project), 900);
    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
  });

  await test('payroll fails first, then the costs arrive: the page moves from "both unavailable" to showing them', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const costs = gate();
    server.holdCosts = costs.hold;
    server.failPayroll = true;
    await openOverhead(tab);
    assert.match(tab.el('ovhdPayrollNote').textContent, /Payroll and operating costs are unavailable/);
    assert.strictEqual(tab.el('ovhdCompanyAmount').textContent, 'Unavailable');
    server.holdCosts = null;
    costs.open();
    await tick();
    assert.match(tab.el('ovhdPayrollNote').textContent, /Payroll is unavailable/);
    assert.match(tab.el('ovhdPayrollNote').textContent, /still show/);
    assertOperatingCostsShow(tab);
    assertNoPayrollFigures(tab, 'Unavailable');
  });

  await test('the costs fail while payroll is fine: nothing is stuck on Loading, the page says so, reports refuse, opening again retries', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const costs = gate();
    server.holdCosts = costs.hold;
    server.failCosts = true;
    await openOverhead(tab);
    assert.strictEqual(tab.el('ovhdCompanyAmount').textContent, 'Loading…', 'payroll has landed, the costs have not answered');
    costs.open();
    await tick();
    assert.strictEqual(tab.el('ovhdCompanyAmount').textContent, 'Unavailable');
    assert.strictEqual(tab.el('ovhdProjectAmount').textContent, 'Unavailable', 'payroll alone is not Project Overhead');
    assert.strictEqual(tab.el('ovhdOverallAmount').textContent, 'Unavailable');
    assert.match(tab.el('ovhdPayrollNote').textContent, /^Operating costs are unavailable/);
    tab.context.exportOverheadCsv();
    tab.context.printOverheadReport('monthly');
    assert.strictEqual(tab.context.__csv, undefined);
    assert.strictEqual(tab.popups.length, 0);
    assert.ok(tab.toasts.length === 2 && tab.toasts.every(t => /Operating costs are unavailable/.test(t)));
    server.holdCosts = null;
    server.failCosts = false;
    await openOverhead(tab);
    assert.strictEqual(money(amounts(tab).overall), 970);
    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
  });

  await test('an older Overhead read arriving late cannot put its failure or its rows back', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    const slow = gate();
    server.hold = slow.hold;
    server.fail = true;
    tab.context.initOverheadModule();
    await tick();
    server.hold = null;
    server.fail = false;
    await openOverhead(tab);
    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
    slow.open();
    await tick();
    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none', 'the late failure is ignored');
    await tick();
    assert.strictEqual(money(amounts(tab).project), 900);
  });

  await test('an Overhead read overtaken by a newer one draws the newer rows', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await openOverhead(tab);
    const slow = gate();
    server.hold = slow.hold;
    tab.context.initOverheadModule();
    await tick();
    server.hold = null;
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Dino', role: 'Coordinator', laborType: 'indirect', totalSalary: 90, paymentDate: '2026-10-09' });
    tab.context.refreshOvAllData();
    await tick();
    slow.open();
    await tick();
    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
    assert.strictEqual(money(amounts(tab).project), 990, 'the newer rows, not the page\'s old copy');
  });

  await test('an overtaken Overhead read that answers first keeps waiting: never the old copy', async () => {
    const server = makeServer();
    const tab = await openTab(server).load();
    await openOverhead(tab);
    const first = gate(), second = gate();
    server.hold = first.hold;
    tab.context.initOverheadModule();
    await tick();
    await server.db.collection('payroll').add({ userId: UID, projectId: 'p', workerName: 'Dino', role: 'Coordinator', laborType: 'indirect', totalSalary: 90, paymentDate: '2026-10-09' });
    server.hold = second.hold;
    tab.context.refreshOvAllData();
    await tick();
    first.open();
    await tick();
    assert.match(tab.el('ovhdPayrollNote').textContent, /Loading/, 'still says it is loading');
    second.open();
    await tick();
    assert.strictEqual(tab.el('ovhdPayrollNote').style.display, 'none');
    assert.strictEqual(money(amounts(tab).project), 990, 'the newer rows');
  });

  console.log('\n— staff and money rules do not move');

  await test('the buttons stay hidden from staff in Project Control', () => {
    const portal = read('js/portal-app.compiled.js');
    assert.ok(/!_staff\(\) && rc\("button", \{ className: "lc2-rowbtn", title: "Receipt \/ Invoice"/.test(portal), 'receipt button');
    assert.ok(/!_staff\(\) && rc\("div", \{ ref: soaRef/.test(portal), 'worker statement menu');
  });

  await test('staff read no more than before: same tables, no photos, and Reports figures stay hidden', async () => {
    const server = makeServer();
    const tab = await openTab(server, 'staff').load();
    assert.deepStrictEqual(server.reads.filter(r => r.table === 'expenses' || r.table === 'payroll').map(r => r.omit.length > 0), [true, true], 'one photo-free read of each');
    assert.ok(!server.reads.some(r => ['overheadExpenses', 'invoices', 'folderBudgets', 'projectBudgets'].includes(r.table)), 'no extra money table');
    assert.ok(!tab.run('JSON.stringify(_ovAllPayroll)').includes('PHOTO-BYTES'));
    const model = tab.run("_pcReportModel('f')");
    assert.strictEqual(model.totals, null, 'no totals');
    assert.strictEqual(JSON.stringify(model.rows).match(/1000|1050|totalSpent/), null, 'no pesos');
  });

  await test('the Overhead messages name no amount', async () => {
    const server = makeServer();
    const tab = await openTab(server, 'staff').load();
    server.fail = true;
    await openOverhead(tab);
    assert.ok(!/₱|\d/.test(tab.el('ovhdPayrollNote').textContent), 'no peso, no figure');
    tab.context.exportOverheadCsv();
    assert.ok(!/₱|\d/.test(tab.toasts.join(' ')));
    assert.ok(!/₱|\d/.test(tab.el('ovhdProjectAmount').textContent + tab.el('ovhdOverallAmount').textContent), 'the hidden cards hold only a word');
  });

  await test('no read of the shared copy feeds a save: nothing here writes', () => {
    for (const fn of ['_ovReadPayroll', 'subscribeOvAllData']) {
      const src = read('js/expenses-module.js');
      const i = src.indexOf('function ' + fn + '(');
      assert.ok(i >= 0, 'SLICE NOT FOUND: ' + fn);
      const body = src.slice(i, src.indexOf('\n}\n', i));
      assert.ok(!/\.(add|set|update|delete|addMany)\(/.test(body), fn + ' must only read');
    }
    const overhead = read('js/overhead-module.js');
    const i = overhead.indexOf('function _ovhdRefreshPayroll(');
    assert.ok(i >= 0, 'SLICE NOT FOUND: _ovhdRefreshPayroll');
    assert.ok(!/\.(add|set|update|delete)\(/.test(overhead.slice(i, overhead.indexOf('\n}\n', i))), 'Overhead refresh must only read');
  });

  await test('admin.html: the Overhead note exists, and browsers are told to load the new scripts', () => {
    const html = read('admin.html');
    assert.strictEqual((html.match(/id="ovhdPayrollNote"/g) || []).length, 1, 'one note');
    assert.ok(html.indexOf('id="ovhdPayrollNote"') > html.indexOf('id="expOverheadView"'), 'inside the Overhead view');
    assert.ok(html.indexOf('id="ovhdPayrollNote"') < html.indexOf('/expOverheadView'), 'inside the Overhead view');
    for (const f of ['expenses-module', 'overhead-module', 'invoice-module']) {
      assert.ok(new RegExp('<script src="js/' + f + '\\.js\\?v=20261104[b-z]"></script>').test(html), f + ' version');
    }
    assert.ok(html.indexOf('js/expenses-module.js') < html.indexOf('js/invoice-module.js'), 'the read is defined before the prints use it');
    assert.strictEqual((html.match(/id="ovhdChartsBlock"/g) || []).length, 1, 'one chart block');
    const start = html.indexOf('<div id="ovhdChartsBlock">') + '<div id="ovhdChartsBlock">'.length;
    const block = html.slice(start, html.indexOf('</div><!-- /ovhdChartsBlock -->'));
    let depth = 0;
    for (const tag of block.match(/<div\b|<\/div>/g) || []) {
      depth += tag === '</div>' ? -1 : 1;
      assert.ok(depth >= 0, 'the block must not close before its charts');
    }
    assert.strictEqual(depth, 0, 'its cards are balanced, so the marked end is its real end');
    for (const id of ['ovhdScopeChart', 'ovhdMonthlyChart', 'ovhdTrendChart']) assert.ok(block.includes(id), id + ' is inside the block');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exitCode = 1; }
})();
