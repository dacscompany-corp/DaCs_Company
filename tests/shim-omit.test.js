// ════════════════════════════════════════════════════════════════════
// SHIM .omit() TESTS — run with:  node tests/shim-omit.test.js
//
// Zero dependencies, no framework. Runs the REAL Query class (with
// .omit() and _tableCols) extracted from js/supabase-config.js at run
// time, against an in-memory stand-in for supabase-js.
//
// WHY THIS EXISTS — receipt photos live in expenses / payroll rows as
// inline base64 (~14 MB for one owner by 2026-10-03). Project Control read
// both tables with select=* and waited for all of it before drawing
// anything; once the download stopped finishing, the page sat on
// "Loading project data…" forever. Project Control now reads them with
// .omit(<photo fields>) and fetches a row's photos only when one is viewed.
//
// THE RULES UNDER GUARD
//   1. An omitted field is never in the list read's select.
//   2. Every other column still is — including one added after this was
//      written (the column list is learned at runtime, never hardcoded).
//   3. Each doc carries `_lazy` = {field: true} for every omitted field that
//      holds a value, so "PO ✓ / receipt attached" still renders.
//   4. A partial (`_lazy`) payroll copy is never edited — saving it would
//      write receiptImages back empty and wipe the receipts.
//
// If a test fails with "SLICE NOT FOUND", the source was restructured —
// update the extraction markers below, don't delete the test.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
const failures = [];
const pending  = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function atest(name, fn) { pending.push([name, fn]); }
function ok(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }
function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}

function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/shim-omit.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}

// ── In-memory stand-in for supabase-js (only what Query uses) ────────
function makeSb(tables) {
  const log = [];
  const failCols = new Set();   // flag reads on these columns return an error
  function from(table) {
    const st = { table, sel: '*', filters: [], lim: null };
    const b = {
      select(s) { st.sel = s; return b; },
      eq(c, v)  { st.filters.push((r) => r[c] === v); return b; },
      is(c, v)  { st.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
      neq(c, v) { st.filters.push((r) => (v === '[]' ? JSON.stringify(r[c]) !== '[]' : r[c] !== v)); st.neq = c; return b; },
      not(c, op, v) { st.filters.push((r) => r[c] != null); return b; },
      or(expr) {   // supports "col.is.null,col.eq.[]"
        const parts = expr.split(',').map((p) => p.split('.'));
        st.filters.push((r) => parts.some(([c, op, v]) =>
          op === 'is' ? r[c] == null : JSON.stringify(r[c]) === v));
        return b;
      },
      order() { return b; },
      limit(n) { st.lim = n; return b; },
      then(res, rej) {
        log.push({ table, sel: st.sel, lim: st.lim });
        if (st.neq && failCols.has(st.neq)) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
        let rows = (tables[table] || []).filter((r) => st.filters.every((f) => f(r)));
        if (st.lim != null) rows = rows.slice(0, st.lim);
        if (st.sel !== '*') {
          const cols = st.sel.split(',');
          rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
        }
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return b;
  }
  return { from, log, failCols };
}

// ── Load the live Query class ────────────────────────────────────────
const F   = 'js/supabase-config.js';
const src = read(F);
const querySrc = slice(src, '// ── 7. Query / Collection / Doc refs', 'class CollectionRef', F);

function load(tables) {
  const sb = makeSb(tables);
  const Query = new Function('sb',
    'function camelToSnake(s) { return s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()); }\n' +
    'function snakeToCamel(s) { return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }\n' +
    'function fieldToCol(cfg, f) { return (cfg.rename && cfg.rename[f]) || camelToSnake(f); }\n' +
    'function fromRow(cfg, row) { const o = {}; for (const k in row) o[snakeToCamel(k)] = row[k]; return o; }\n' +
    'class DocRef { constructor(cfg, id, ctx) { this.cfg = cfg; this.id = id; this.ctx = ctx; } }\n' +
    'function querySnap(cfg, rows, ctx) {\n' +
    '  const docs = rows.map((r) => ({ id: r.id, data: () => fromRow(cfg, r), exists: true, ref: new DocRef(cfg, r.id, ctx) }));\n' +
    '  return { docs, empty: !docs.length, size: docs.length };\n' +
    '}\n' +
    querySrc + '\nreturn Query;'
  )(sb);
  return { Query, sb };
}

const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(500);
const EXP_CFG = { table: 'expenses', idField: 'id' };
const PAY_CFG = { table: 'payroll', idField: 'id', json: ['receiptImages'] };
const EXP_FIELDS = ['poImageUrl', 'deliveryReceiptUrl', 'supplierInvoiceUrl', 'paymentReceiptUrl'];
const expRow = (id, extra) => Object.assign({
  id, owner_id: 'U1', amount: 100, po_image_url: null, delivery_receipt_url: null,
  supplier_invoice_url: null, payment_receipt_url: null,
}, extra);
const payRow = (id, imgs) => ({ id, owner_id: 'U1', total_salary: 500, receipt_images: imgs });

// ════════════════════════════════════════════════════════════════════
// I. The list read leaves the photos out, and only the photos
// ════════════════════════════════════════════════════════════════════
console.log('\nI. Photo columns are left out of the list read');

atest('no omitted column is in the main select; the rest are', async () => {
  const { Query, sb } = load({ expenses: [expRow('e1'), expRow('e2', { po_image_url: PHOTO })] });
  await new Query(EXP_CFG).where('ownerId', '==', 'U1').omit(EXP_FIELDS).get();
  const main = sb.log.find((l) => l.sel !== '*' && l.sel !== 'id');
  ok(main, 'no explicit-column list read was made');
  const cols = main.sel.split(',');
  for (const c of ['po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url']) {
    ok(!cols.includes(c), c + ' was selected — the photos are back in the list read');
  }
  for (const c of ['id', 'owner_id', 'amount']) ok(cols.includes(c), c + ' missing from the list read');
});

atest('a column added later is still read — the list is learned, not hardcoded', async () => {
  const { Query } = load({ expenses: [expRow('e1', { brand_new_col: 'x' })] });
  const snap = await new Query(EXP_CFG).omit(EXP_FIELDS).get();
  eq(snap.docs[0].data().brandNewCol, 'x', 'new column value');
});

atest('the docs carry no photo data at all', async () => {
  const { Query } = load({ expenses: [expRow('e1', { payment_receipt_url: PHOTO })] });
  const snap = await new Query(EXP_CFG).omit(EXP_FIELDS).get();
  const d = snap.docs[0].data();
  ok(!JSON.stringify(d).includes('base64'), 'photo data leaked into the list doc');
  eq(d.amount, 100, 'amount');
});

atest('.omit() survives a later .where() (clone keeps it)', async () => {
  const { Query, sb } = load({ expenses: [expRow('e1')] });
  await new Query(EXP_CFG).omit(EXP_FIELDS).where('ownerId', '==', 'U1').get();
  ok(!sb.log.some((l) => l.sel === '*' && l.lim == null), 'fell back to select=*');
});

atest('without .omit() a read is unchanged (select=*)', async () => {
  const { Query, sb } = load({ expenses: [expRow('e1')] });
  await new Query(EXP_CFG).get();
  eq(sb.log.length, 1, 'request count');
  eq(sb.log[0].sel, '*', 'select');
});

// ════════════════════════════════════════════════════════════════════
// II. `_lazy` says which photos exist
// ════════════════════════════════════════════════════════════════════
console.log('\nII. _lazy flags');

atest('text photo fields: flagged only where a value exists', async () => {
  const { Query } = load({ expenses: [
    expRow('e1'),
    expRow('e2', { po_image_url: PHOTO, payment_receipt_url: PHOTO }),
    expRow('e3', { delivery_receipt_url: '' }),   // empty string = nothing attached
  ] });
  const snap = await new Query(EXP_CFG).omit(EXP_FIELDS).get();
  const by = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()._lazy]));
  eq(JSON.stringify(by.e1), '{}', 'e1 flags');
  eq(JSON.stringify(by.e2), '{"poImageUrl":true,"paymentReceiptUrl":true}', 'e2 flags');
  eq(JSON.stringify(by.e3), '{}', 'e3 flags');
});

atest('every omitted doc carries `_lazy`, even with no photos (marks it partial)', async () => {
  const { Query } = load({ expenses: [expRow('e1')] });
  const snap = await new Query(EXP_CFG).omit(EXP_FIELDS).get();
  ok(snap.docs[0].data()._lazy, 'no _lazy marker on a photo-free row');
});

atest('json photo field (payroll.receiptImages): [] and null are "none"', async () => {
  const { Query } = load({ payroll: [payRow('p1', []), payRow('p2', [PHOTO]), payRow('p3', null)] });
  const snap = await new Query(PAY_CFG).omit('receiptImages').get();
  const by = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()._lazy]));
  eq(!!by.p1.receiptImages, false, 'p1');
  eq(!!by.p2.receiptImages, true, 'p2');
  eq(!!by.p3.receiptImages, false, 'p3');
});

atest('a failed flag read marks rows "maybe attached", never "none"', async () => {
  const { Query, sb } = load({ expenses: [expRow('e1', { po_image_url: PHOTO })] });
  sb.failCols.add('po_image_url');
  const snap = await new Query(EXP_CFG).omit(EXP_FIELDS).get();
  eq(snap.docs[0].data()._lazy.poImageUrl, true, 'po flag after a failed read');
});

// ════════════════════════════════════════════════════════════════════
// III. Learning the column list
// ════════════════════════════════════════════════════════════════════
console.log('\nIII. Column discovery');

atest('the probe reads one PHOTO-FREE row when one exists', async () => {
  const { Query, sb } = load({ payroll: [payRow('p1', [PHOTO]), payRow('p2', [])] });
  await new Query(PAY_CFG).omit('receiptImages').get();
  const probes = sb.log.filter((l) => l.sel === '*' && l.lim === 1);
  eq(probes.length, 1, 'probe count (the photo-free row should satisfy the first probe)');
});

atest('no photo-free row: falls back to any one row and still works', async () => {
  const { Query } = load({ payroll: [payRow('p1', [PHOTO])] });
  const snap = await new Query(PAY_CFG).omit('receiptImages').get();
  eq(snap.size, 1, 'rows');
  eq(snap.docs[0].data().receiptImages, undefined, 'photo field');
  eq(snap.docs[0].data()._lazy.receiptImages, true, 'flag');
});

atest('an empty table falls back to a plain read instead of failing', async () => {
  const { Query } = load({ payroll: [] });
  const snap = await new Query(PAY_CFG).omit('receiptImages').get();
  eq(snap.size, 0, 'rows');
});

atest('the column list is learned once per table, not per read', async () => {
  const { Query, sb } = load({ expenses: [expRow('e1')] });
  await new Query(EXP_CFG).omit(EXP_FIELDS).get();
  await new Query(EXP_CFG).omit(EXP_FIELDS).get();
  eq(sb.log.filter((l) => l.sel === '*' && l.lim === 1).length, 1, 'probe count');
});

// ════════════════════════════════════════════════════════════════════
// IV. Call sites (source fences)
// ════════════════════════════════════════════════════════════════════
console.log('\nIV. Call sites');

const PC  = read('js/portal-app.compiled.js');
const EXP = read('js/expenses-module.js');

test('Project Control reads expenses without the photo fields', () => {
  ok(/collection\("expenses"\)\.where\("userId", "==", dataUid\)\.omit\(PC_EXPENSE_IMAGE_FIELDS\)/.test(PC),
    'expenses subscription lost its .omit() — Project Control downloads every photo again');
  for (const f of EXP_FIELDS) ok(new RegExp('PC_EXPENSE_IMAGE_FIELDS = \\[[^\\]]*"' + f + '"').test(PC), f + ' not omitted');
});

test('Project Control reads payroll without receiptImages', () => {
  ok(/collection\("payroll"\)\.where\("userId", "==", dataUid\)\.omit\("receiptImages"\)/.test(PC),
    'payroll subscription lost its .omit("receiptImages")');
});

test('the payroll Edit modal reloads a partial (_lazy) row before editing', () => {
  const fn = slice(EXP, 'async function openEditPayrollModal', '\nfunction ', 'js/expenses-module.js');
  ok(/if \(!p \|\| p\._lazy\)/.test(fn), 'openEditPayrollModal no longer refetches a _lazy row');
  ok(/if \(p\._lazy\) \{[^}]*return;/.test(fn), 'openEditPayrollModal can still open a _lazy row — its save would wipe receiptImages');
});

test('the contract ledger receipt viewer reloads a partial row', () => {
  const fn = slice(EXP, 'window.lcLedgerViewReceipt', '\n};', 'js/expenses-module.js');
  ok(/p\._lazy/.test(fn), 'lcLedgerViewReceipt reads receiptImages from a _lazy row');
});

test('the worker summary prefers a full payroll copy over a partial one', () => {
  ok(/async function openWorkerSummaryModal[\s\S]{0,200}_mergePayrollPools\(\)[\s\S]{0,300}_fillLazyPayroll/.test(EXP),
    'openWorkerSummaryModal no longer merges/fills partial rows');
  ok(/function printWorkerReceiptSummary[\s\S]{0,300}_mergePayrollPools\(\)/.test(EXP),
    'printWorkerReceiptSummary no longer uses _mergePayrollPools');
});

// ── run the async tests, then report ─────────────────────────────────
(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  - ' + failures.join('\n  - ')); process.exit(1); }
})();
