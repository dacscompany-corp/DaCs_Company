// ════════════════════════════════════════════════════════════════════
// PURCHASE SCREENS (0096):  node tests/purchase-screens.test.js
//
// Zero dependencies. Runs the REAL js/expenses-module.js in a sandbox with a
// fake database and checks what the screens show:
//   1. a ₱700 purchase on a project with NO billing period (expenses.folderId,
//      no projectId) counts — once — in the dashboard, the overview cards,
//      the folder list, the Budget Overview folder cards and the folder detail;
//   2. deleting a project or billing period with a live purchase asks the
//      server FIRST and removes nothing.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const A = require('../js/billing-allocation.js');
const expensesSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'expenses-module.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
const tick = () => new Promise(r => setImmediate(r));

function harness({ rpc, collections }) {
  const elements = {};
  const el = id => elements[id] || (elements[id] = { innerHTML: '', textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, getContext() { return this; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, dataset: {} });
  const notes = [], dbCalls = [];
  const snap = (rows) => ({ docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }), ref: { delete: async () => {} } })), size: rows.length, empty: !rows.length });
  const query = (name) => {
    const q = { where: () => q, limit: () => q, get: async () => { dbCalls.push(name); return snap((collections || {})[name] || []); },
                onSnapshot: (next) => { next(snap((collections || {})[name] || [])); return () => {}; } };
    return q;
  };
  const context = vm.createContext({ console: { log() {}, error() {}, warn() {} }, ...A,
    window: { currentUserRole: 'owner', sbClient: { rpc: async (name, args) => rpc(name, args) },
      location: { href: 'https://example.test/admin.html', origin: 'https://example.test' } },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
      createElement: () => ({ click() {}, style: {} }), body: { style: {}, appendChild() {}, removeChild() {} } },
    Chart: class { destroy() {} }, setTimeout() {}, clearTimeout() {} });
  vm.runInContext(expensesSource, context);
  context.db = { collection: (name) => ({ ...query(name), doc: () => ({ delete: async () => { dbCalls.push('delete:' + name); } }) }),
                 batch: () => ({ delete() { dbCalls.push('batch.delete'); }, commit: async () => { dbCalls.push('batch.commit'); } }) };
  context.currentUser = { uid: 'owner' };
  vm.runInContext(`
    _uid = () => 'owner';
    showExpNotif = (m) => __notes.push(m);
    showDeleteConfirm = async () => { __notes.push('CONFIRM'); return true; };
    loadProjects = async () => {};
  `, Object.assign(context, { __notes: notes }));
  return { context, el, notes, dbCalls };
}

const PROJECTS = `
  expFolders = [{id:'f',name:'With periods',totalBudget:10000}, {id:'np',name:'No period',totalBudget:1000}];
  expProjects = [{id:'p',folderId:'f',month:'October',year:2026,monthlyBudget:5000},
                 {id:'c',folderId:'f',month:'October',year:2026,fundingType:'president'}];
  _rptOvhdRows = [];
`;
const EXPENSES = [
  { id: 'e1', projectId: 'p', amount: 300, dateTime: '2026-10-14T09:00' },
  { id: 'e2', projectId: 'c', amount: 50, dateTime: '2026-10-14T09:00', coverExpense: true },
  { id: 'np1', folderId: 'np', amount: 700, dateTime: '2026-10-14T09:00', coverExpense: true, purchaseLineId: 'L1' }
];

(async () => {
  console.log('\npurchase screens (0096)');

  await test('dashboard and overview cards count a no-period purchase once (₱300 + ₱50 + ₱700 = ₱1,050)', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    h.context.subscribeOvAllData();
    await tick(); await tick();
    ok(h.el('dashTotalSpent').textContent === '₱1,050.00', 'dashboard Total Spent: ' + h.el('dashTotalSpent').textContent);
    ok(h.el('mvpTotalSpent').textContent === '₱1,050.00', 'overview Total Spent: ' + h.el('mvpTotalSpent').textContent);
  });

  await test('folder list: the no-period project shows its ₱700 against its ₱1,000 contract (70%)', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    h.context.subscribeOvAllData();
    await tick(); await tick();
    h.context.renderProjectPanel('expOverviewList');
    const html = h.el('expOverviewList').innerHTML;
    const np = html.slice(html.indexOf('No period'));
    ok(/width:70\.0%/.test(np), 'the no-period folder bar must read 70%: ' + (np.match(/width:[0-9.]+%/) || ['none'])[0]);
  });

  await test('Budget Overview folder cards: Spent and Cover include the no-period purchase', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    h.context.subscribeOvAllData();
    await tick(); await tick();
    h.context.mvpRenderFolderGrid();
    const html = h.el('mvpFolderGrid').innerHTML;
    const np = html.slice(html.indexOf('No period'));
    ok(np.includes('700.00'), 'the no-period folder card must show ₱700');
    const f = html.slice(html.indexOf('With periods'), html.indexOf('No period'));
    ok(f.includes('350.00') && !f.includes('1,050.00'), 'the other folder keeps its own ₱350, never the ₱700');
  });

  await test('folder detail: the no-period purchase is in Material, Spent and the transaction count', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    h.context.subscribeOvAllData();
    await tick(); await tick();
    vm.runInContext(`expExpenses = _ovAllExpenses;`, h.context);
    h.context.mvpRenderOvFolderDetail('np');
    ok(h.el('mvpOvKpiMatVal').textContent.includes('700.00'), 'Material: ' + h.el('mvpOvKpiMatVal').textContent);
    ok(/^1 transaction/.test(h.el('mvpOvKpiMatSub2').textContent), 'count: ' + h.el('mvpOvKpiMatSub2').textContent);
  });

  await test('deleting a project with a live purchase asks the server first and removes NOTHING', async () => {
    const calls = [];
    const h = harness({ rpc: async (name, args) => { calls.push(name); return { data: name === 'pur_live_purchases' ? 1 : 0, error: null }; },
                        collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    await h.context.deleteFolder('f');
    ok(calls.includes('pur_live_purchases'), 'the purchase pre-check must run');
    ok(!h.notes.includes('CONFIRM'), 'it must stop before the confirm');
    ok(h.dbCalls.length === 0, 'nothing may be read or deleted: ' + h.dbCalls.join(','));
    ok(h.notes.some(n => /purchase\(s\), so it cannot be deleted/.test(n)), 'the user is told why');
  });

  await test('deleting a billing period with a live purchase asks the server first and removes NOTHING', async () => {
    const h = harness({ rpc: async (name, args) => ({ data: name === 'pur_live_purchases' && args.p_period === 'p' ? 2 : 0, error: null }),
                        collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    await h.context.deleteProject('p');
    ok(!h.notes.includes('CONFIRM') && h.dbCalls.length === 0, 'nothing may be deleted: ' + h.dbCalls.join(','));
  });

  await test('when the pre-check itself fails, nothing is deleted either', async () => {
    const h = harness({ rpc: async (name) => name === 'pur_live_purchases' ? { data: null, error: { message: 'network' } } : { data: 0, error: null },
                        collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    await h.context.deleteFolder('f');
    await h.context.deleteProject('p');
    ok(!h.notes.includes('CONFIRM') && h.dbCalls.length === 0, 'nothing may be deleted');
  });

  await test('with no live purchase, deleting goes ahead as before', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: [], payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    await h.context.deleteProject('p');
    ok(h.notes.includes('CONFIRM') && h.dbCalls.includes('batch.commit'), 'the normal delete must still run');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
