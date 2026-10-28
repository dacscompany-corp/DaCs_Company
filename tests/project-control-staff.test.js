// Execute the live Project Control components and their export/print handlers.
// Removing a staff branch must expose a fixture amount or a financial action
// here, even if the money arithmetic itself still passes.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const allocation = require('../js/billing-allocation.js');
const source = fs.readFileSync(path.join(__dirname, '../js/portal-app.compiled.js'), 'utf8');
const start = source.indexOf('const peso =');
const end = source.indexOf('function PortalApp()');
assert(start >= 0 && end > start, 'SLICE NOT FOUND: update Project Control test extraction markers');

function harness(role) {
  let states = {}, index = 0;
  const downloads = [], popups = [], calls = [];
  const window = { currentUserRole: role, localStorage: { getItem: () => null },
    open: () => { const popup = { html: '', document: {
      write: html => { popup.html += html; }, close() {}
    }, print() {} }; popups.push(popup); return popup; },
    openExpModal: id => calls.push(id), openEditExpenseModal: id => calls.push(id),
    openEditPayrollModal: id => calls.push(id),
    printWorkerLaborSOA: () => calls.push('soa'),
    printSinglePayrollInvoice: () => calls.push('invoice'),
    eiRender: () => calls.push('inbox'), lcWorkerContracts: () => []
  };
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props }, children }),
    useState: initial => {
      const key = index++;
      if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial;
      return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
    },
    useMemo: fn => fn(), useCallback: fn => fn, useRef: initial => ({ current: initial }), useEffect() {}
  };
  const document = {
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {}, removeChild() {} }
  };
  const URL = { createObjectURL: blob => { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} };
  const names = ['FoldersGrid', 'PageHead', 'KPIStrip', 'ProjectLedger', 'CostBudget', 'FlowCards',
    'RecentEntries', 'ContractRollup', 'OverheadDrill', 'BillingPeriodsDrill', 'AdditionalWorksDrill',
    'LaborDrill', 'MaterialDrill', 'ItemDetailsModal', 'DocPill', 'LazyReceiptThumb',
    'ExpenseInboxMount', 'openAddEntry', 'openRowSupportingDocs', 'BillingSummary'];
  const api = new Function('React', 'window', 'document', 'URL', 'Blob', 'setTimeout',
    ...Object.keys(allocation), source.slice(start, end) + '\nreturn {' + names.join(',') + '};')(
      React, window, document, URL, Blob, () => {}, ...Object.values(allocation));
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const saved = states, savedIndex = index;
      states = {}; index = 0;
      const result = expand(node.type({ ...node.props, children: node.children }));
      states = saved; index = savedIndex;
      return result;
    }
    return { ...node, children: node.children.map(expand) };
  }
  const render = (name, props, overrides = {}) => {
    states = { ...overrides }; index = 0;
    return expand(api[name](props));
  };
  return { render, api, window, downloads, popups, calls };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (!tree || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.children) : String(tree);
}
function staffSafe(tree) {
  const output = JSON.stringify(tree);
  assert(!/₱|\bPHP\b|1,234|1234/.test(output), 'staff output contains a peso amount: ' + text(tree));
  assert(!nodes(tree).some(n => n.type === 'img' || (n.type === 'a' && n.props.href)), 'staff can open a financial document');
}
// Materials and Labor lists show staff the peso amounts they enter (owner
// decision 2026-10-15) — but never a share of the CONTRACT, which together
// with the pesos would reveal the contract value, and never a document.
function staffEntrySafe(tree, contractShares) {
  const out = text(tree);
  contractShares.forEach(p => assert(!out.includes(p), 'staff sees share of contract ' + p + ': ' + out));
  assert(!/Share of contract|of contract/.test(out), 'staff sees a share-of-contract label');
  assert(!nodes(tree).some(n => n.type === 'img' || (n.type === 'a' && n.props.href)), 'staff can open a financial document');
}
function button(tree, label) {
  return nodes(tree).find(n => n.type === 'button' && (text(n).trim() === label || n.props.title === label));
}
const project = { id: 'f1', name: 'Pilot house', code: 'PC-1', revenue: 100000, allocated: 50000,
  labor: 1234, material: 1234, overhead: 1234, coverCost: 1234, completion: null,
  docCounts: { po: 1, dr: 1, si: 1, pay: 1 }, materialCount: 1,
  laborBreakdown: { direct: 1234, indirect: 0, liability: 0, liabilityIndirect: 0 },
  overheadBreakdown: { indirectLabor: 0, expenses: 1234 } };
const material = { id: 'e1', projectId: 'p1', name: 'Wire', category: 'Electrical', amount: 1234,
  date: '2026-10-12', quantity: 2, docs: { po: true, dr: true, si: true, pay: true },
  docUrls: { po: 'https://example.test/receipt', si: 'https://example.test/invoice' },
  firstReceipt: 'https://example.test/receipt', receipts: ['https://example.test/receipt'] };
const pay = { id: 'pay1', projectId: 'p1', name: 'Mason', workerName: 'Mason', role: 'Mason',
  type: 'direct', laborType: 'direct', amount: 1234, totalSalary: 1234, contractId: 'c1', date: '2026-10-12' };
const contract = { id: 'c1', folderId: 'f1', workerName: 'Mason', agreedAmount: 5000,
  scopeOfWork: 'Wall', category: 'labor' };
const months = [{ id: 'p1', folderId: 'f1', month: 'October', year: 2026, monthlyBudget: 50000 }];
const materialProps = { project, materialTx: [material], childMonths: months, activeFolder: project, folderId: 'f1' };
const laborProps = { project, laborTx: [pay], childMonths: months, contracts: [contract],
  folderPayroll: [pay], activeFolder: project, folderId: 'f1', pmPaidByContractId: {} };
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (error) { failed++; console.error('  FAIL ' + name + '\n       ' + error.message); }
}
(async () => {
  for (const coverCost of [1234, 12340]) await test('staff Cover status hides total and threshold: ' + coverCost, () => {
    const tree = harness('staff').render('KPIStrip', { project: { ...project, coverCost } });
    staffSafe(tree); assert(text(tree).includes(coverCost > 10000 ? 'OVER LIMIT' : 'OK'));
  });
  for (const role of ['staff', 'owner']) await test(role + ' recent entries use the right visibility', () => {
    const tree = harness(role).render('RecentEntries', { onOpen() {}, laborTx: [pay], materialTx: [material] }, { 1: true });
    assert(text(tree).includes('Wire')); assert(text(tree).includes('Mason'));
    if (role === 'staff') staffSafe(tree); else assert(text(tree).includes('₱  1,234'));
  });
  await test('staff expanded folder hides amounts and financial editor/AI shortcuts', () => {
    const tree = harness('staff').render('FoldersGrid', { folders: [project], foldersRaw: [project],
      monthsRaw: months, payrollRaw: [pay], expensesRaw: [{ ...material, expenseName: 'Wire' }],
      overheadRaw: [], boqRaw: [], onPickFolder() {} }, { 1: 0, 4: true, 5: true });
    staffSafe(tree); assert(button(tree, 'Open Project'));
    assert(!button(tree, 'AI budget summary')); assert(!button(tree, 'Edit folder'));
  });
  for (const role of ['staff', 'owner']) await test(role + ' material list and category totals', () => {
    const tree = harness(role).render('MaterialDrill', materialProps);
    assert(text(tree).includes('Wire'));
    if (role === 'staff') {
      staffEntrySafe(tree, ['1.23%', '1.2%']); assert(text(tree).includes('1,234'), 'staff sees the amount they entered');
      for (const label of ['Export CSV', 'Print receipt for this material expense']) assert(!button(tree, label), label + ' visible');
      // Staff record and correct materials (owner decision 2026-10-15) — the
      // list itself still shows no pesos (staffSafe above).
      for (const label of ['Add Expense', 'Edit']) assert(button(tree, label), label + ' missing for staff');
    } else { assert(text(tree).includes('1,234')); assert(button(tree, 'Export CSV')); assert(button(tree, 'Add Expense')); }
  });
  for (const role of ['staff', 'owner']) await test(role + ' material details and attachments', () => {
    const tree = harness(role).render('ItemDetailsModal', { item: material, billingNum: 1, onClose() {}, onPrint() {} });
    if (role === 'staff') { staffEntrySafe(tree, ['1.23%']); assert(text(tree).includes('1,234')); assert(!button(tree, 'Print Receipt')); assert(button(tree, 'Edit')); }
    else { assert(text(tree).includes('1,234')); assert(button(tree, 'Print Receipt')); }
  });
  for (const role of ['staff', 'owner']) await test(role + ' expanded labor and worker statement menu', () => {
    const tree = harness(role).render('LaborDrill', laborProps, { 2: true, 3: { Mason: true } });
    if (role === 'staff') {
      staffEntrySafe(tree, ['1.2%']); assert(text(tree).includes('1,234'), 'staff sees the payment they entered');
      assert(/Total Agreed\s*—/.test(text(tree)), 'agreed total stays hidden');
      for (const label of ['Export CSV', 'Worker Statement', 'Worker statement', 'Ledger', 'Edit contract', 'Raise cap', 'Worker agreement', 'View', 'Receipt / Invoice', 'New Contract']) assert(!button(tree, label), label + ' visible');
      // Staff record and correct payroll (owner decision 2026-10-15).
      for (const label of ['Edit', 'Pay', 'Add Payment']) assert(button(tree, label), label + ' missing for staff');
    } else { assert(text(tree).includes('1,234')); assert(button(tree, 'Export CSV')); assert(button(tree, 'Worker Statement')); }
  });
  for (const role of ['staff', 'owner']) await test(role + ' overhead records', () => {
    const tree = harness(role).render('OverheadDrill', { project, overheadTx: [{ id: 'o1', amount: 1234,
      date: '2026-10-12', category: 'Water', receiptUrl: 'https://example.test/receipt' }],
      indirectTx: [], folderId: 'f1', childMonths: months, contractAmount: 100000, allTimeOverhead: 1234, ocmPct: 10 });
    if (role === 'staff') staffSafe(tree); else assert(text(tree).includes('1,234'));
  });
  await test('staff cannot open priced Additional Works breakdown', () => {
    const tree = harness('staff').render('AdditionalWorksDrill', { project, childFolders: [project],
      additionalWorksRaw: [], onOpenChild() {}, folderId: 'f1' });
    staffSafe(tree); assert(!button(tree, 'Edit BOQ breakdown'));
  });
  await test('staff contract rollup cannot display caps or payments', () => {
    staffSafe(harness('staff').render('ContractRollup', { contracts: [contract], folderPayroll: [pay], onOpen() {} }));
  });
  for (const [name, props] of [['MaterialDrill', materialProps], ['LaborDrill', laborProps]]) {
    await test(name + ' stale export handler rechecks staff before downloading', () => {
      const h = harness('owner'), tree = h.render(name, props);
      h.window.currentUserRole = 'staff'; button(tree, 'Export CSV').props.onClick();
      assert.equal(h.downloads.length, 0);
    });
    await test(name + ' owner CSV keeps amount column and value', async () => {
      const h = harness('owner'), tree = h.render(name, props);
      button(tree, 'Export CSV').props.onClick();
      assert.equal(h.downloads.length, 1);
      const csv = await h.downloads[0].text(); assert(csv.includes('Amount (PHP)')); assert(csv.includes('"1234"'));
    });
  }
  await test('stale material print handler refuses staff', () => {
    const h = harness('owner'), tree = h.render('MaterialDrill', materialProps);
    h.window.currentUserRole = 'staff'; button(tree, 'Print receipt for this material expense').props.onClick({ stopPropagation() {} });
    assert.equal(h.popups.length, 0);
  });
  await test('owner material receipt retains the amount', () => {
    const h = harness('owner'), tree = h.render('MaterialDrill', materialProps);
    button(tree, 'Print receipt for this material expense').props.onClick({ stopPropagation() {} });
    assert.equal(h.popups.length, 1); assert(h.popups[0].html.includes('₱ 1,234'));
  });
  await test('staff document status is visible but cannot open or attach a receipt', () => {
    const h = harness('staff'); const tree = h.render('DocPill', { m: material, k: 'po', label: 'PO', title: 'Purchase Order' });
    assert(text(tree).includes('PO')); assert(!tree.props.onClick); assert(!tree.props.role);
  });
  await test('staff entry shortcut opens the payroll and expense forms', async () => {
    const h = harness('staff');
    await h.api.openAddEntry('labor', months, project);
    await h.api.openAddEntry('material', months, project);
    assert.deepEqual(h.calls, ['addPayrollModal', 'addExpenseModal']);
  });
  await test('staff header cannot open the folder budget editor', () => {
    const tree = harness('staff').render('PageHead', { project, projects: [project], period: 'All Time' });
    staffSafe(tree); assert(!button(tree, 'Edit folder')); assert(!button(tree, 'Print Summary'));
  });
  await test('staff billing periods cannot open financial forms', () => {
    const tree = harness('staff').render('BillingPeriodsDrill', { project, childMonths: months,
      payrollRaw: [pay], expensesRaw: [material], overheadRaw: [], allocationMap: {} });
    staffSafe(tree); assert(text(tree).includes('October'));
    assert(!button(tree, 'Edit period')); assert(!button(tree, 'New Billing Period'));
  });
  await test('staff inbox mount cannot embed financial receipt encoding', () => {
    const tree = harness('staff').render('ExpenseInboxMount', { folderId: 'f1', label: 'Pilot' });
    assert(!nodes(tree).some(n => /eiPanelPortal/.test(n.props.id || '')));
  });
  await test('staff cannot render an already-open overhead amount editor', () => {
    const tree = harness('staff').render('OverheadDrill', { project, overheadTx: [], indirectTx: [],
      folderId: 'f1', childMonths: months, contractAmount: 100000, allTimeOverhead: 0 },
      { 0: true, 1: { category: 'Water', amount: '1234', date: '2026-10-12', description: '', billingPeriodId: '' } });
    staffSafe(tree);
  });
  // 16 Oct 2026 fixes from the 2A-1 browser checks.
  await test('a row on the Cover period reads "Billing #2 (Cover)"', () => {
    const cover = { id: 'p2', folderId: 'f1', month: 'October', year: 2026, monthlyBudget: 0, fundingType: 'president' };
    const tree = harness('owner').render('MaterialDrill', { ...materialProps, childMonths: [...months, cover],
      materialTx: [material, { ...material, id: 'e2', projectId: 'p2', name: 'Sand' }] });
    const out = text(tree);
    assert(/Billing #\s*2 \(Cover\)/.test(out), out);
    assert(/Billing #\s*1(?! \(Cover\))/.test(out), 'a client period must not say Cover');
  });
  await test('owner Material Total notes the Additional Works share', () => {
    const owner = text(harness('owner').render('MaterialDrill', { ...materialProps, project: { ...project, awMaterial: 1000 } }));
    assert(/incl\. ₱\s*1,000\s+Additional Works/.test(owner), owner);
    const none = text(harness('owner').render('MaterialDrill', materialProps));
    assert(!/Additional Works/.test(none), 'no note when the project has no Additional Works cost');
  });
  await test('no billing period: staff are sent to the owner, not to Budget Overview', async () => {
    const said = [], savedAlert = globalThis.alert;
    globalThis.alert = msg => said.push(msg);
    try {
      await harness('staff').api.openAddEntry('material', [], { id: 'f9' });
      await harness('owner').api.openAddEntry('material', [], { id: 'f9' });
    } finally { globalThis.alert = savedAlert; }
    assert(/Ask the owner/.test(said[0]) && !/Budget Overview/.test(said[0]), said[0]);
    assert(/Manage Periods/.test(said[1]), said[1]);
  });
  await test('Additional Works: two quick clicks make ONE hidden period', async () => {
    const saved = { db: globalThis.db, firebase: globalThis.firebase };
    let adds = 0;
    globalThis.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }),
      firestore: { FieldValue: { serverTimestamp: () => 'ts' } } };
    globalThis.db = { collection: () => ({ add: async () => { adds++; await new Promise(r => setImmediate(r)); return { id: 'aw-p' + adds }; } }) };
    try {
      const h = harness('staff'), aw = { id: 'aw1', parentFolderId: 'f1' };
      await Promise.all([h.api.openAddEntry('material', [], aw), h.api.openAddEntry('material', [], aw)]);
      await h.api.openAddEntry('labor', [], aw);   // later click, period list not refreshed yet
      assert.equal(adds, 1, 'periods created: ' + adds);
      assert.deepEqual(h.calls, ['addExpenseModal', 'addExpenseModal', 'addPayrollModal']);
    } finally { globalThis.db = saved.db; globalThis.firebase = saved.firebase; }
  });
  // 2C (0105): a stock cost move's rows are the owner's value — staff see the
  // row and its tag, never its pesos, and their subtotals leave it out.
  const costIn = { id: 'e2', projectId: 'p1', name: 'From warehouse — Cement', category: 'Electrical', amount: 1234,
    date: '2026-10-13', quantity: 4, docs: {}, docUrls: {}, receipts: [], stkCostMoveId: 'c1' };
  const plain = { ...material, id: 'e3', name: 'Tape', amount: 777, docUrls: {}, firstReceipt: '', receipts: [] };
  for (const role of ['staff', 'owner']) await test(role + ': a stock cost move row in Materials', () => {
    const h = harness(role);
    h.window.expIsStockCostRow = (r) => !!(r && (r.stkCostMoveId || (r._parts || []).some(p => p.stkCostMoveId)));
    const tree = h.render('MaterialDrill', { ...materialProps, materialTx: [plain, costIn] });
    const out = text(tree);
    assert(out.includes('From warehouse — Cement') && out.includes('Stock cost move'), 'the row and its tag: ' + out);
    if (role === 'staff') {
      assert(!/1,234|1234/.test(JSON.stringify(tree)), 'staff see a cost move\'s pesos: ' + out);
      assert(out.includes('777'), 'staff still see the amounts they enter');
      assert(!out.includes('2,011'), 'a staff subtotal leaves the cost move out: ' + out);
    } else {
      assert(out.includes('1,234') && out.includes('2,011'), 'the owner sees it, and the subtotal counts it: ' + out);
    }
    const modal = h.render('ItemDetailsModal', { item: costIn, billingNum: 1, billingOf: () => 1, onClose() {}, onOpenImage() {}, onPrint() {} });
    assert(role === 'staff' ? !/1,234|1234/.test(JSON.stringify(modal)) : text(modal).includes('1,234'), role + ' details: ' + text(modal));
  });
  // F2 (2B-b pilot): a purchase split ₱200 on the billing period + ₱100 on
  // Cover. The owner sees each part and which is Cover; staff see the total
  // they entered and the period once — no per-part pesos (they would show the
  // budget left) and never Cover. The details window opens for a split row.
  const part = (i, amount, extra) => ({ ...material, id: 'w' + i, name: 'Wire (' + i + '/2)', amount, projectId: 'p1',
    splitGroup: 'purchase:P9:1', splitIndex: i, splitTotal: 2, docUrls: {}, firstReceipt: '', receipts: [], ...extra });
  const wireParts = [part(1, 200, { purchaseLineId: 'L9' }), part(2, 100, { purchaseLineId: 'L9', coverExpense: true })];
  for (const role of ['staff', 'owner']) await test(role + ': a split purchase on its billing period and Cover', () => {
    const h = harness(role);
    h.window.expGroupSplitRows = require('../js/expense-split-rows.js').groupSplitRows;
    h.window.expIsPurchaseRow = require('../js/expense-split-rows.js').isPurchaseRow;
    const tree = h.render('MaterialDrill', { ...materialProps, materialTx: wireParts });
    const out = text(tree).replace(/\s+/g, ' ');
    assert(out.includes('300'), 'the row\'s total: ' + out);
    if (role === 'staff') {
      assert(!/₱200|₱100|\b200\.00\b|\b100\.00\b/.test(out) && !/Cover/.test(out), 'staff see a part\'s pesos or Cover: ' + out);
      assert.equal((out.match(/Billing #1/g) || []).length, 1, 'the period once: ' + out);
    } else {
      assert(/Billing #1 ₱200(\.00)? · Billing #1 \(Cover\) ₱100/.test(out), 'the owner sees each part and the Cover one: ' + out);
    }
    const row = h.window.expGroupSplitRows(wireParts, 'name')[0];
    const modal = h.render('ItemDetailsModal', { item: row, billingNum: 1, billingOf: () => 1, onClose() {}, onOpenImage() {}, onPrint() {} });
    const m = text(modal).replace(/\s+/g, ' ');
    if (role === 'staff') assert(!/₱ 200|₱ 100/.test(m) && !/Cover/.test(m), 'staff details show a part\'s pesos or Cover: ' + m);
    else assert(/₱ 200/.test(m) && /₱ 100/.test(m) && /Cover/.test(m), 'owner details: ' + m);
  });
  await test('a stock cost move is read-only in Project Control: no part-by-part edit, and it maps its link', () => {
    assert(/stkCostMoveId: d\.stkCostMoveId \|\| null,/.test(source), 'mapExpense keeps the link');
    assert(/const isOldSplit = \(m\) => [^\n]*window\.expIsStockCostRow\(m\)\);/.test(source), 'never edited part by part');
  });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
