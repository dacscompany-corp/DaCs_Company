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
      staffSafe(tree); assert(text(tree).includes('1.23%'));
      for (const label of ['Export CSV', 'Add Expense', 'Edit', 'Print receipt for this material expense']) assert(!button(tree, label), label + ' visible');
    } else { assert(text(tree).includes('1,234')); assert(button(tree, 'Export CSV')); assert(button(tree, 'Add Expense')); }
  });
  for (const role of ['staff', 'owner']) await test(role + ' material details and attachments', () => {
    const tree = harness(role).render('ItemDetailsModal', { item: material, billingNum: 1, onClose() {}, onPrint() {} });
    if (role === 'staff') { staffSafe(tree); assert(!button(tree, 'Print Receipt')); assert(!button(tree, 'Edit')); }
    else { assert(text(tree).includes('1,234')); assert(button(tree, 'Print Receipt')); }
  });
  for (const role of ['staff', 'owner']) await test(role + ' expanded labor and worker statement menu', () => {
    const tree = harness(role).render('LaborDrill', laborProps, { 2: true, 3: { Mason: true } });
    if (role === 'staff') {
      staffSafe(tree); assert(text(tree).includes('24.7%'));
      for (const label of ['Export CSV', 'Worker Statement', 'Worker statement', 'Ledger', 'Edit contract', 'Raise cap', 'Worker agreement', 'View', 'Receipt / Invoice', 'Edit', 'Pay', 'Add Payment', 'New Contract']) assert(!button(tree, label), label + ' visible');
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
  await test('staff financial entry shortcut cannot open a form', async () => {
    const h = harness('staff'); await h.api.openAddEntry('labor', months, project);
    assert.equal(h.calls.length, 0);
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
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
