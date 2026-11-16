'use strict';
// The Billing Request page (the amount requested, each billing's amount and the
// total allocated), the buttons on the Billing Periods screen, and its Total
// Spent. Runs the real code, against data shaped like the live tables.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('js/portal-app.compiled.js', 'utf8');
const start = source.indexOf('function _pcBillingRequestHTML(');
assert(start >= 0, 'percentage request renderer exists');
const end = source.indexOf('\nasync function ', start);
const ctx = { Date, window: {} };
vm.createContext(ctx);
// The real billing names, so the page is checked against what the client will read.
const NAMES = source.slice(source.indexOf('const FUNDING_LBLS'), source.indexOf('\n', source.indexOf('function _pcBillingWhen(')));
vm.runInContext(NAMES + '\n' + source.slice(start, end), ctx);

// The one formula for the requested amount lives in the receipts module.
const receiptsWindow = { location: { origin: '' } };
const receiptsCtx = { window: receiptsWindow, console, Date, Number, String, Promise };
vm.createContext(receiptsCtx);
vm.runInContext(fs.readFileSync('js/billing-receipts.js', 'utf8'), receiptsCtx);
const receipts = receiptsWindow.BillingReceipts;

const REQUEST = { percent: 10, amount: 220000 };
const render = (budget, request = REQUEST) => ctx._pcBillingRequestHTML({ name: '<Project>', id: 'f' },
  [{ id: 'p', fundingType: 'progress', billingNumber: 1, month: 'November', year: 2026, monthlyBudget: budget }], request);
const visible = html => html.replace(/<style>.*<\/style>/s, '');
assert.doesNotMatch(render(0), /NaN|Infinity/);
// The billing's amount and the total allocated show. Spending is not on this page at all.
assert.match(render(1000), /Progress Billing #1<small>November 2026<\/small><\/th><td>₱1,000\.00/);
assert.match(render(1000), /Total Allocated<\/th><td>₱1,000\.00/);
assert.doesNotMatch(visible(render(1000)), /fund position|Overall billing|Used|Remaining/, 'the Overall fund position box is gone');
assert.strictEqual((visible(render(1000)).match(/%/g) || []).length, 1, 'the only percentage on the page is the one requested');
assert.match(render(1000), /&lt;Project&gt;/);
// The amount being requested: the percentage set first, and the pesos it comes to.
assert.match(render(1000), /Requested this billing/);
assert.match(render(1000), /10% of Project Budget.*₱220,000\.00/);
assert.match(render(1000, { percent: 12.5, amount: 275000 }), /12\.5% of Project Budget.*₱275,000\.00/);
assert(render(1000).indexOf('Requested this billing') < render(1000).indexOf('<table'), 'the request comes before the breakdown');
// Design 1b: one formal page.
assert.doesNotMatch(render(1000), /Requested from|____/, 'no client on record: the Requested from box is left out');
assert.match(render(1000, { ...REQUEST, preparedBy: 'Ana <b>Cruz</b>' }), /<div class="line">Ana &lt;b&gt;Cruz&lt;\/b&gt;<\/div>/, 'the typed name sits on the signature line, escaped');
assert.match(render(1000), /<div class="line"><\/div>/, 'left blank, the line is signed by hand');
for (const text of ['Date issued', 'Billing breakdown', 'No.', 'Prepared by', 'Signature over printed name', 'Generated ']) {
  assert(render(1000).includes(text), 'design 1b needs: ' + text);
}
assert.match(render(1000), /<td class="no">01<\/td>/, 'billings are numbered');
assert.doesNotMatch(render(1000), /Received by|Percentages use/, 'design 1b has no Received by line and no explanation note');
assert.match(render(1000), /print-color-adjust:exact/, 'the shaded box must survive Save as PDF');
assert.match(render(1000), /@media print\{.*\.toolbar\{display:none\}/, 'the print button never prints');
assert.match(render(1000), /@media print\{.*\.sigs,\.foot,\.bk tr\{break-inside:avoid\}/, 'the signature and footer never split across pages');
const withBillings = n => ctx._pcBillingRequestHTML({ name: 'P', id: 'f' }, Array.from({ length: n }, (_, i) =>
  ({ id: 'p' + i, fundingType: 'progress', billingNumber: i + 1, month: 'November', year: 2026, monthlyBudget: 1000 })), REQUEST);
assert.doesNotMatch(withBillings(5), /\.bk small\{display:inline/, 'up to 5 billings keep the two-line rows on paper');
assert.match(withBillings(6), /@media print\{.*\.bk small\{display:inline/, 'longer lists go on one line so the request stays on one sheet');
assert.match(render(1000), /<h1>Billing Request<\/h1>/);
assert.match(render(1000), /Please release the next billing funds/);
assert.doesNotMatch(render(1000), /Acknowledgement Receipt|I acknowledge/);

// Each client billing with its amount, in date order, then the total allocated.
const overall = ctx._pcBillingRequestHTML({ name: 'P', id: 'f' }, [
  { id: 'q', fundingType: 'progress', billingNumber: 2, month: 'December', year: 2026, monthlyBudget: 3000 },
  { id: 'p', fundingType: 'mobilization', month: 'October', year: 2026, monthlyBudget: 1000 },
  { id: 'd', fundingType: 'downpayment', month: 'November', year: 2026, monthlyBudget: 0 },
  { id: 'cover', fundingType: 'president', month: 'November', year: 2026, monthlyBudget: 750 }
], REQUEST);
assert.match(overall, /Mobilization<small>October 2026<\/small><\/th><td>₱1,000\.00/);
assert.match(overall, /Downpayment<small>November 2026<\/small><\/th><td>₱0\.00/);
assert.match(overall, /Progress Billing #2<small>December 2026<\/small><\/th><td>₱3,000\.00/);
assert.match(overall, /Total Allocated<\/th><td>₱4,000\.00/);
assert(overall.indexOf('Mobilization') < overall.indexOf('Downpayment') && overall.indexOf('Downpayment') < overall.indexOf('Progress Billing #2'), 'date order');
assert.doesNotMatch(overall, /Cover|₱750\.00/);
assert.match(overall, /Please release the next billing funds/);
assert.throws(() => ctx._pcBillingRequestHTML({ name: 'P', id: 'f' },
  [{ id: 'cover', fundingType: 'president', monthlyBudget: 500 }], REQUEST), /No client billing/);

const realPrintSource = source.slice(source.indexOf('async function _pcPrintBillingRequest('), source.indexOf('\nfunction BillingPeriodsDrill('));
async function testLoadingPath() {
  const tables = {
    folders: [{ id: 'abcdef123', userId: 'owner', name: 'Test project', description: 'Quezon City', clientEmail: 'client@example.test' }],
    projects: [{ id: 'p1', folderId: 'abcdef123', month: 'November', year: 2026, fundingType: 'progress', billingNumber: 1 },
      { id: 'p0', folderId: 'abcdef123', month: 'October', year: 2026, fundingType: 'progress', billingNumber: 2 },
      { id: 'cover', folderId: 'abcdef123', month: 'November', year: 2026, fundingType: 'president' }],
    projectBudgets: [{ id: 'p1', monthlyBudget: 1000 }, { id: 'p0', monthlyBudget: 1000 }],
    folderBudgets: [{ id: 'abcdef123', totalBudget: 5000 }],
    clientUsers: [{ id: 'client', email: 'client@example.test', firstName: 'Client', lastName: '<Name>' }]
  };
  Object.entries(tables).forEach(([name, rows]) => { if (name !== 'clientUsers') rows.forEach(row => { row.userId = 'owner'; }); });
  async function run(options = {}) {
    let html = '', closed = false, opened = 0, writes = 0;
    const reads = [];
    const popup = { closed: false, close() { closed = true; }, document: {
      open() { html = ''; }, write(value) { html += value; }, close() {}
    } };
    const snap = row => ({ id: row && row.id, exists: !!row, data: () => row });
    const env = { Date, shortRef: (prefix, id) => prefix + '-' + id.slice(0, 6).toUpperCase(),
      console: { error() {} },
      window: { currentUserRole: options.role || 'owner', open() { opened++; return popup; }, alert() {}, BillingReceipts: receipts,
        dacsPrintHeader: () => '<header>DAC’S BUILDING DESIGN SERVICES<img alt="Logo"></header>' },
      db: { collection(name) {
        let id, predicates = [];
        const q = { doc(value) { id = value; return q; }, where(key, op, value) { predicates.push(r => r[key] === value); return q; },
          omit() { return q; }, async get() {
            reads.push(name);
            if (options.fail === name) throw Error('Read failed');
            if (options.revoke && name === 'projectBudgets') env.window.currentUserRole = 'staff';
            const rows = options.noContract && name === 'folderBudgets' ? [] : tables[name];
            assert(rows, 'unexpected collection: ' + name);
            return id ? snap(rows.find(r => r.id === id)) : { docs: rows.filter(r => predicates.every(test => test(r))).map(snap) };
          } };
        return new Proxy(q, { get(target, key) {
          if (['add', 'set', 'update', 'delete', 'addMany'].includes(key)) return () => { writes++; throw Error('Unexpected write'); };
          return target[key];
        } });
      } }
    };
    vm.createContext(env);
    vm.runInContext(NAMES + '\n' + source.slice(start, end) + '\n' + realPrintSource, env);
    await env._pcPrintBillingRequest({ id: 'abcdef123', code: 'STALE', location: 'STALE' }, 'percent' in options ? options.percent : 10, options.preparedBy);
    assert.equal(writes, 0, 'request never writes business data');
    return { html, closed, opened, reads };
  }
  const all = await run();
  assert.deepEqual(all.reads.slice().sort(), ['clientUsers', 'folderBudgets', 'folders', 'projectBudgets', 'projects'],
    'only these are read: the page shows no spending, so payroll, expenses and overhead are never loaded');
  assert.match(all.html, /FLD-ABCDEF/);
  assert.match(all.html, /Quezon City/);
  assert.match(all.html, /Client &lt;Name&gt;/);
  assert.match(all.html, /Requested from/, 'a client on record is still named');
  assert.match(all.html, /client@example\.test/, 'the client email shows under the name');
  assert.match(all.html, /Reference<\/span><span>FLD-ABCDEF/, 'the project code is the reference');
  assert.match(all.html, /DAC/);
  assert.match(all.html, /Progress Billing #1<small>November 2026<\/small><\/th><td>₱1,000\.00/, 'amounts come from the budgets table');
  assert.match(all.html, /Total Allocated<\/th><td>₱2,000\.00/);
  assert(all.html.indexOf('Progress Billing #2') < all.html.indexOf('Progress Billing #1'), 'date order on real rows');
  assert.match(all.html, /10% of Project Budget.*₱500\.00/, 'the amount comes from the freshly read contract');
  assert.doesNotMatch(all.html, /₱5,000\.00/, 'the contract figure itself is not printed');
  assert.doesNotMatch(all.html, /STALE|Cover/);
  assert.match((await run({ preparedBy: 'Ana Cruz' })).html, /<div class="line">Ana Cruz<\/div>/, 'the name typed in the window reaches the page');
  assert.equal((await run({ percent: 0 })).opened, 0, 'no percentage, no page');
  assert.equal((await run({ percent: undefined })).opened, 0, 'no percentage, no page');
  const noContract = await run({ noContract: true });
  assert(noContract.closed, 'no contract closes output');
  assert.doesNotMatch(noContract.html, /<table/);
  assert(all.html.indexOf('Please release') < all.html.indexOf('<table'), 'request precedes financial details');
  for (const name of Object.keys(tables)) {
    const failed = await run({ fail: name });
    assert(failed.closed, name + ' failure closes output');
    assert.doesNotMatch(failed.html, /<table/, 'failed reads never print partial or cached figures');
  }
  assert.equal((await run({ role: 'staff' })).opened, 0);
  assert((await run({ revoke: true })).closed, 'access loss while loading prevents output');
  console.log('Billing Request loading path: real table shapes, budgets, identity, scope, failures and no writes pass.');
}
async function testSettingThePercentage() {
  async function start(options = {}) {
    const asked = [], printed = [], alerts = [];
    let reads = 0;
    const env = { console: { error() {} }, PC_EXPENSE_IMAGE_FIELDS: [],
      window: { currentUserRole: options.role || 'owner', alert: message => alerts.push(message), BillingReceipts: { askRequestPercent: o => asked.push(o) } },
      db: { collection(name) { return { doc() { return { async get() {
        assert.equal(name, 'folderBudgets');
        reads++;
        if (options.revoke) env.window.currentUserRole = 'staff';
        if (options.fail) throw Error('Read failed');
        return options.contract == null ? { exists: false } : { exists: true, data: () => ({ totalBudget: options.contract }) };
      } }; } }; } } };
    vm.createContext(env);
    vm.runInContext(realPrintSource, env);
    env._pcPrintBillingRequest = (project, percent, preparedBy) => printed.push([project.id, percent, preparedBy]);
    await env._pcStartBillingRequest({ id: 'f', name: 'Sulit Residence' }, 1980000);
    return { asked, printed, alerts, reads };
  }
  const ok = await start({ contract: 2200000 });
  assert.equal(ok.asked.length, 1, 'the percentage is asked first');
  assert.equal(ok.printed.length, 0, 'nothing opens until a percentage is set');
  assert.equal(ok.asked[0].contract, 2200000);
  assert.equal(ok.asked[0].allocated, 1980000);
  assert.equal(ok.asked[0].projectName, 'Sulit Residence');
  ok.asked[0].onContinue(10, 'Ana Cruz');
  assert.deepEqual(ok.printed, [['f', 10, 'Ana Cruz']], 'the page opens with the percentage and name set');
  const staff = await start({ role: 'staff', contract: 2200000 });
  assert.equal(staff.asked.length, 0, 'staff get nothing');
  assert.equal(staff.reads, 0, 'staff never even load the contract');
  assert.equal((await start({ revoke: true, contract: 2200000 })).asked.length, 0, 'owner access lost while loading stops it');
  for (const options of [{ contract: 0 }, {}, { fail: true, contract: 1 }]) {
    const refused = await start(options);
    assert.equal(refused.asked.length, 0, JSON.stringify(options));
    assert.equal(refused.alerts.length, 1, 'and says why');
  }
  console.log('Billing Request percentage: asked first, from the fresh contract, refused without one.');
}
testSettingThePercentage().catch(error => { console.error(error); process.exitCode = 1; });
testLoadingPath().catch(error => { console.error(error); process.exitCode = 1; });

const asyncStart = source.indexOf('async function _pcPrintBillingRequest(');
vm.runInContext(source.slice(asyncStart, source.indexOf('\nfunction BillingPeriodsDrill(', asyncStart)), ctx);
let opened = false;
ctx.window = { currentUserRole: 'staff', open: () => { opened = true; } };
ctx._pcPrintBillingRequest({ id: 'f' });
assert.equal(opened, false, 'staff cannot open billing requests');

// Render the real Billing Periods screen.
Object.assign(ctx, {
  React: { createElement: (type, props, ...children) => ({ type, props, children }), useState: () => [null, () => {}] },
  _staff: () => ctx.window.currentUserRole === 'staff', _pcMoneyAction: fn => fn, _pcBillingWhen: m => m.when || '', _pcBillingName: m => m.name,
  Ico: {}, peso: String, pcAllocationStatus: () => ({ key: 'healthy', pct: 20 }),
  PC_PERIOD_BANDS: { healthy: {}, empty: {} }, pcPeriodAllocationView: () => null,
  AllocationBands: () => {}, AllocationHistory: () => {}
});
ctx._pcActualsForPeriod = p => ({ directActual: p.cost, indirectActual: 0 });
const drillStart = source.indexOf('function BillingPeriodsDrill(');
vm.runInContext(source.slice(drillStart, source.indexOf('\nfunction RecentEntries(', drillStart)), ctx);
const props = { project: { id: 'f', name: 'P' }, childMonths: [
  { id: 'p', name: 'Progress', monthlyBudget: 1000, cost: 200 },
  { id: 'cover', name: 'Cover', fundingType: 'president', cost: 100 }
], payrollRaw: [], expensesRaw: [], overheadRaw: [], allocationMap: {} };
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
}
const documentButtons = tree => nodes(tree).filter(n => n.type === 'button'
  && n.children.some(c => typeof c === 'string' && /Billing Request|Acknowledgement/.test(c)));
const labelOf = button => button.children.find(c => typeof c === 'string');

ctx.window.currentUserRole = 'owner';
const calls = [];
ctx.window.BillingReceipts = { openReceipt: (project, id) => calls.push(['receipt', id]), openOverall: project => calls.push(['overall', project.id]) };
ctx._pcStartBillingRequest = (project, allocated) => calls.push(['request', project.id, allocated]);
const buttons = documentButtons(ctx.BillingPeriodsDrill(props));
assert.deepEqual(buttons.map(labelOf), ['Overall Billing Acknowledgement', 'Billing Request', 'Acknowledgement Receipt'],
  'two page buttons, and one receipt button for the client billing; none on the Cover card');
buttons.forEach(button => button.props.onClick());
assert.deepEqual(calls, [['overall', 'f'], ['request', 'f', 1000], ['receipt', 'p']], 'each button opens its own document; the request is told the total allocated');
assert.equal(documentButtons(ctx.BillingPeriodsDrill({ ...props, childMonths: [] })).length, 0, 'no billings, no buttons');
assert.equal(documentButtons(ctx.BillingPeriodsDrill({ ...props, childMonths: [props.childMonths[1]] })).length, 0, 'no documents for a Cover-only project');

const totalTree = ctx.BillingPeriodsDrill({ ...props, expensesRaw: [{ folderId: 'f', amount: 100 }], overheadRaw: [
  { folderId: 'f', scope: 'project', amount: 700 },
  { folderId: 'f', scope: 'project', amount: 900, billingPeriodId: 'p' }, // already on its card: never counted again
  { folderId: 'f', scope: 'project', amount: 900, deletedAt: 'deleted' },
  { folderId: 'f', scope: 'company', amount: 900 },
  { folderId: 'elsewhere', scope: 'project', amount: 900 }
] });
const totalStat = nodes(totalTree).find(n => n.props && n.props.className === 'drill-stat' && n.children[0].children[0] === 'Total Spent');
assert.equal(totalStat.children[1].children[0][1], '1100', 'project total includes no-period material and unassigned project overhead once');

ctx.window.currentUserRole = 'staff';
assert.equal(documentButtons(ctx.BillingPeriodsDrill(props)).length, 0, 'document buttons remain owner-only');
console.log('Billing Request: requested amount, billing amounts, total allocated, button placement and owner-only access pass.');
