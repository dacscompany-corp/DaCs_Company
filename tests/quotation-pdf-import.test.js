// ════════════════════════════════════════════════════════════════════
// QUOTATION-PDF IMPORT TESTS — run with:  node tests/quotation-pdf-import.test.js
//
// Zero dependencies, no framework. Feeds synthetic PDF cell rows into the
// REAL parser, extracted from js/print-utils.js at run time (never a copy),
// and fails loudly if a rule breaks.
//
// WHY SYNTHETIC ROWS: the parser's input is already plain data —
// [{ page, y, cells:[{x,w,s}] }] — produced by window.dacsScanPdfCells().
// So the whole classifier is testable without pdf.js, a browser, or a
// fixture PDF. The x values below are not invented: they were MEASURED by
// generating a quotation PDF with the same jsPDF/autotable config as
// js/quotation-print.js and reading it back through pdf.js.
//
// The rules under guard:
//   1. Indent decides the level, and the indent is measured against the
//      BODY's leftmost label — never against the head row, whose
//      DESCRIPTION text is centred in a wide column and marks nothing.
//      Groups sit at that edge, lines ~6pt right of it (three leading
//      spaces, js/quotation-print.js:830), sections far right of both
//      because a merged cell inherits columnStyles[0]'s halign:'center'.
//   2. A wrapped label continues the thing above it, and the VERTICAL GAP
//      is what identifies one — never the indent. jsPDF indents a line's
//      first visual line only, so a wrapped description starts at exactly
//      the group indent; what gives it away is that it sits a line-height
//      below its parent instead of a full row pitch.
//   3. [REMOVED] lines are dropped. (optional) lines keep their label but
//      import at ZERO, exactly as the quotation totals them. WAIVED → 0.
//   4. Money shape: ONE unitPrice per line (no material/labor split), and
//      every imported line starts at percentCompletion 0. A LOT-priced
//      section imports AS a LOT so its money survives.
//   6. The report math engine is duplicated in the admin editor and the
//      client portal; §J runs BOTH over the same fixtures so they cannot
//      drift. If every line reads 50%, the report reads 50% — whatever
//      the group amounts and empty groups look like.
//   5. The head row repeats on every page (autotable showHead) — it
//      re-anchors the columns, it is never data.
//
// If a test fails with "SLICE NOT FOUND", the source was restructured —
// update the extraction markers below, don't delete the test.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(actual, expected, label) {
  const a = typeof actual === 'number' ? +actual.toFixed(6) : actual;
  const b = typeof expected === 'number' ? +expected.toFixed(6) : expected;
  if (a !== b) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }
function throws(fn, re, label) {
  try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error((label || '') + ' wrong message: ' + e.message); return; }
  throw new Error((label || 'expected a throw') + ' — nothing was thrown');
}

function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/quotation-pdf-import.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}
function evalWith(src, ctx, names) {
  const fn = new Function('ctx', 'with(ctx){' + src + '\n; return {' + names.join(',') + '};}');
  return fn(ctx);
}

// ── Load the live parser engine ──────────────────────────────────────
const P = evalWith(
  slice(read('js/print-utils.js'),
        '// ==== QT PDF IMPORT ENGINE START ====',
        '// ==== QT PDF IMPORT ENGINE END ====', 'print-utils.js'),
  { window: {} },
  ['qtpNum', 'qtpRowText', 'qtpAnchors', 'qtpColOf', 'qtpTree', 'qtpHeaderBox']
);

// ── Load the live report mapper + BOQ math from pm-admin.js ──────────
const M = evalWith(
  slice(read('js/pm-admin.js'),
        '// ==== RP IMPORT MAP START ====',
        '// ==== RP IMPORT MAP END ====', 'pm-admin.js'),
  { window: {}, _pmUid: (p) => p + Math.random().toString(36).slice(2, 8) },
  ['_pmRpImportMap']
);
const _RP_ENGINE_SRC = slice(read('js/pm-admin.js'),
  '// ==== RP MATH ENGINE START ====', '// ==== RP MATH ENGINE END ====', 'pm-admin.js');
const _RP_E = evalWith(_RP_ENGINE_SRC, { window: {} },
  ['_pmRpNum', '_pmRpLiRate', '_pmRpLiTotal', '_pmRpLiAcc', '_pmRpIsLump',
   '_pmRpGroupTotal', '_pmRpGroupAmount', '_pmRpGroupPct', '_pmRpCiSub',
   '_pmRpCiAcc', '_pmRpGrand', '_pmRpAcc', '_pmRpPct']);
// The names the older sections here were written against.
const MATH = {
  _pmNum: _RP_E._pmRpNum, _pmLiTotal: _RP_E._pmRpLiTotal, _pmLiAcc: _RP_E._pmRpLiAcc,
  _pmBoqGrand: _RP_E._pmRpGrand, _pmBoqAcc: _RP_E._pmRpAcc, _pmBoqPct: _RP_E._pmRpPct,
  _pmCiSub: _RP_E._pmRpCiSub, _pmCiAcc: _RP_E._pmRpCiAcc
};

// ── Geometry — MEASURED from a real generated quotation PDF ──────────
// These are pdf.js point positions read back out of a PDF built with the
// same jsPDF/autotable config as js/quotation-print.js. Three of them are
// counter-intuitive and each one broke a naive parser:
//   · DESCRIPTION's head text is CENTRED in the wide auto-width column, so
//     it sits ~120pt right of where the descriptions actually start.
//   · A section row is one merged cell that inherits columnStyles[0]'s
//     halign:'center', so its label is centred near the middle of the page
//     — it is NOT flush left, and its x shifts with the label's length.
//   · pdf.js folds a line's three leading spaces into x, not into str, so
//     the indent shows up as +5.9pt and never as whitespace in the text.
const X = { num: 44.98, desc: 183.38, qty: 361.85, unit: 397.79, price: 438.02, amount: 510.18 };
const GROUP_X   = 63.2;             // description column edge + cell padding
const LINE_X    = 69.1;             // + three leading spaces at fontSize 7
const SECTION_X = 233.9;            // centred across the merged span

// Row pitch vs wrap pitch, also measured: two table rows are ~15pt apart,
// two visual lines of ONE wrapped cell only ~8pt. That gap is the ONLY thing
// that separates a wrapped description from a new sub-item, because jsPDF
// indents a line's first visual line and not its continuations — so a wrap
// lands at exactly the group x.
const ROW_GAP = 15, WRAP_GAP = 8;

let _y = 800;
function row(cells, page, gap) {
  return { page: page || 0, y: (_y -= (gap || ROW_GAP)), cells: cells.map(c => ({ x: c[0], w: 10, s: c[1] })) };
}
function resetY() { _y = 800; }

const HEAD = () => row([[X.num, '#'], [X.desc, 'DESCRIPTION'], [X.qty, 'QTY'],
                        [X.unit, 'UNIT'], [X.price, 'UNIT PRICE'], [X.amount, 'AMOUNT']]);
const HEAD_NO_PRICE = () => row([[X.num, '#'], [X.desc, 'DESCRIPTION'], [X.qty, 'QTY'],
                                 [X.unit, 'UNIT'], [X.amount, 'AMOUNT']]);
const SEC   = (label, amt) => row([[SECTION_X, label]].concat(amt ? [[X.amount + 16, amt]] : []));
const GRP   = (label, qty, unit) => row([[GROUP_X, label]]
                .concat(qty ? [[X.qty + 5, qty]] : []).concat(unit ? [[X.unit + 3, unit]] : []));
const LINE  = (label, qty, unit, price, amt) => row([[LINE_X, label], [X.qty, qty],
                [X.unit, unit]].concat(price != null ? [[X.price + 19, price]] : [])
                .concat(amt != null ? [[X.amount + 16, amt]] : []));
const WRAP  = (text, x) => row([[x == null ? GROUP_X : x, text]], 0, WRAP_GAP);
const TOTAL = (amt) => row([[300, 'TOTAL PROJECT COST:'], [X.amount + 16, amt]]);

console.log('\n── §A  number + column primitives ──────────────────────');

test('qtpNum strips commas and rejects non-numbers', () => {
  eq(P.qtpNum('1,250.00'), 1250);
  eq(P.qtpNum('20,125.00'), 20125);
  eq(P.qtpNum('0.00'), 0);
  eq(P.qtpNum(''), null);
  eq(P.qtpNum('   '), null);
  eq(P.qtpNum('WAIVED'), null);
  eq(P.qtpNum('cu.m'), null);
});

test('qtpAnchors finds the itemized head row and its six columns', () => {
  const a = P.qtpAnchors(HEAD());
  ok(a, 'header row recognised');
  eq(a.desc, X.desc, 'desc anchor');
  eq(a.price, X.price, 'price anchor');
  eq(a.amount, X.amount, 'amount anchor');
});

test('qtpAnchors ignores rows that are not the itemized head', () => {
  eq(P.qtpAnchors(row([[22, 'CLIENT'], [50, 'Juan dela Cruz'], [140, 'QUOTE NO.'], [165, 'Q-2026-0003']])), null);
  eq(P.qtpAnchors(TOTAL('1,673,153.09')), null);
});

test('qtpAnchors reports a head row that has no UNIT PRICE column', () => {
  const a = P.qtpAnchors(HEAD_NO_PRICE());
  ok(a, 'still a header row');
  eq(a.price, null, 'no price column');
});

test('qtpColOf assigns the four value columns by nearest head anchor', () => {
  const a = P.qtpAnchors(HEAD());
  eq(P.qtpColOf(361.8, a), 'qty',    'centred qty');
  eq(P.qtpColOf(366.6, a), 'qty',    'a shorter qty shifts right and is still qty');
  eq(P.qtpColOf(397.8, a), 'unit');
  eq(P.qtpColOf(401.1, a), 'unit');
  eq(P.qtpColOf(456.9, a), 'price',  'right-aligned price sits well right of its head');
  eq(P.qtpColOf(462.7, a), 'price');
  eq(P.qtpColOf(526.7, a), 'amount', 'right-aligned amount');
  eq(P.qtpColOf(530.6, a), 'amount');
});

test('qtpColOf never returns a description column — the head cannot locate one', () => {
  // DESCRIPTION's head text is centred in the wide auto-width column, ~120pt
  // right of where descriptions actually begin. Any boundary drawn from it
  // would swallow half the table, so the column is deliberately absent here
  // and qtpTree derives the real edge from the body instead.
  const a = P.qtpAnchors(HEAD());
  ok(['qty', 'unit', 'price', 'amount'].indexOf(P.qtpColOf(GROUP_X, a)) !== -1,
     'only value columns are returned');
});

console.log('\n── §B  row classification ──────────────────────────────');

function tree(rows) { resetY(); return P.qtpTree(rows); }

test('a full three-level table parses into sections → groups → lines', () => {
  const t = tree([
    HEAD(),
    SEC('1. CIVIL WORKS', '500,000.00'),
    GRP('A. Earthworks'),
    LINE('Excavation', '16.10', 'cu.m', '1,250.00', '20,125.00'),
    LINE('Backfill', '8.00', 'cu.m', '900.00', '7,200.00'),
    GRP('B. Concrete', '1', 'lot'),
    LINE('Footing', '4.00', 'cu.m', '6,500.00', '26,000.00'),
    SEC('2. ARCHITECTURAL', '120,000.00'),
    GRP('A. Tiling'),
    LINE('Floor tiles', '45.00', 'sq.m', '1,100.00', '49,500.00'),
    TOTAL('1,673,153.09')
  ]);
  eq(t.sections.length, 2, 'sections');
  eq(t.sections[0].label, 'CIVIL WORKS', 'leading "1. " stripped');
  eq(t.sections[0].groups.length, 2, 'groups in section 1');
  eq(t.sections[0].groups[0].label, 'A. Earthworks');
  eq(t.sections[0].groups[0].lines.length, 2);
  eq(t.sections[0].groups[0].lines[0].description, 'Excavation', 'indent stripped');
  eq(t.sections[0].groups[0].lines[0].qty, 16.1);
  eq(t.sections[0].groups[0].lines[0].unit, 'cu.m');
  eq(t.sections[0].groups[0].lines[0].unitPrice, 1250);
  eq(t.sections[1].label, 'ARCHITECTURAL');
  eq(t.sections[1].groups[0].lines[0].unitPrice, 1100);
  eq(t.stats.sections, 2);
  eq(t.stats.groups, 3);
  eq(t.stats.lines, 4);
});

test('the printed TOTAL PROJECT COST is captured as the checksum', () => {
  const t = tree([HEAD(), SEC('1. X', '10.00'), GRP('A'), LINE('a', '1', 'set', '10.00', '10.00'),
                  TOTAL('1,673,153.09')]);
  eq(t.printedTotal, 1673153.09);
});

test('a wrapped line continues the line above even though it sits at the GROUP indent', () => {
  // The bug this guards: jsPDF indents only a line's FIRST visual line, so the
  // continuation starts at exactly GROUP_X and looks identical to a new
  // sub-item. Only the tighter vertical gap tells them apart. A real PDF put
  // 30 electrical lines under a phantom sub-item before this was fixed.
  const t = tree([
    HEAD(), SEC('1. CIVIL WORKS', '1.00'), GRP('A. Earthworks'),
    LINE('Excavation for footing and', '16.10', 'cu.m', '1,250.00', '20,125.00'),
    WRAP('wall foundation, manual'),
    LINE('Backfill', '8.00', 'cu.m', '900.00', '7,200.00')
  ]);
  const lines = t.sections[0].groups[0].lines;
  eq(t.sections[0].groups.length, 1, 'the wrap did NOT become a phantom sub-item');
  eq(lines.length, 2, 'nor a third line');
  eq(lines[0].description, 'Excavation for footing and wall foundation, manual');
  eq(lines[1].description, 'Backfill', 'the line AFTER the wrap still parents correctly');
});

test('a group label that wraps continues the group', () => {
  const t = tree([
    HEAD(), SEC('1. X', '1.00'),
    GRP('A. General Requirements and'),
    WRAP('Site Preparation'),
    LINE('Temporary facilities', '1', 'lot', '5,000.00', '5,000.00')
  ]);
  eq(t.sections[0].groups.length, 1);
  eq(t.sections[0].groups[0].label, 'A. General Requirements and Site Preparation');
});

test('two groups a full row apart stay two groups — spacing, not emptiness, decides', () => {
  // Both of these are bare labels at GROUP_X and the first has no lines, so an
  // "absorb while empty" rule would silently merge two real sub-items into one.
  const t = tree([
    HEAD(), SEC('1. X', '1.00'),
    GRP('A. First Group'),
    GRP('B. Second Group'),
    LINE('Only line', '1', 'lot', '5,000.00', '5,000.00')
  ]);
  eq(t.sections[0].groups.length, 2);
  eq(t.sections[0].groups[0].label, 'A. First Group');
  eq(t.sections[0].groups[1].label, 'B. Second Group');
  eq(t.sections[0].groups[1].lines.length, 1, 'the line parents to the second group');
});

test('a section label that wraps continues the section', () => {
  const t = tree([
    HEAD(),
    SEC('1. GENERAL REQUIREMENTS AND', '1.00'),
    WRAP('PRELIMINARY WORKS', SECTION_X),
    GRP('A. Mobilisation'),
    LINE('Site office', '1', 'lot', '15,000.00', '15,000.00')
  ]);
  eq(t.sections.length, 1);
  eq(t.sections[0].label, 'GENERAL REQUIREMENTS AND PRELIMINARY WORKS');
});

test('a line with a price but no indent is still a line, not a group', () => {
  // Defensive: if jsPDF ever drops the leading spaces, the price column alone
  // must still identify the row as a line.
  const t = tree([
    HEAD(), SEC('1. X', '1.00'), GRP('A'),
    row([[GROUP_X, 'Unindented line'], [X.qty, '2'], [X.unit, 'set'], [X.price + 19, '50.00'], [X.amount + 16, '100.00']])
  ]);
  eq(t.sections[0].groups[0].lines.length, 1, 'classified as a line');
  eq(t.sections[0].groups[0].lines[0].unitPrice, 50);
});

test('lines before any group land in an implicit unnamed group, never lost', () => {
  const t = tree([HEAD(), SEC('1. X', '1.00'),
                  LINE('Orphan line', '1', 'set', '10.00', '10.00')]);
  eq(t.sections[0].groups.length, 1);
  eq(t.sections[0].groups[0].lines[0].description, 'Orphan line');
  eq(t.stats.lines, 1);
});

console.log('\n── §C  line states: removed / optional / waived ─────────');

test('[REMOVED] lines are skipped and counted', () => {
  const t = tree([
    HEAD(), SEC('1. X', '1.00'), GRP('A'),
    LINE('Kept', '1', 'set', '10.00', '10.00'),
    LINE('Dropped scope  [REMOVED]', '1', 'set', '99.00', '99.00')
  ]);
  eq(t.sections[0].groups[0].lines.length, 1, 'only the kept line');
  eq(t.sections[0].groups[0].lines[0].description, 'Kept');
  eq(t.stats.skippedRemoved, 1);
});

test('(optional) lines keep their label but import at ZERO', () => {
  // The quotation prints an optional line's unit price yet totals it at 0
  // (qtLineAmount returns 0 for any non-normal state), so importing the rate
  // would make the report's contract value exceed the quote the client signed.
  // The scope line survives; the money does not.
  const t = tree([
    HEAD(), SEC('1. X', '0.00'), GRP('A'),
    LINE('Excavation', '1', 'set', '10.00', '10.00'),
    LINE('Extra sink (optional)', '1', 'set', '3,000.00', '0.00')
  ]);
  const li = t.sections[0].groups[0].lines[1];
  eq(li.description, 'Extra sink (optional)', 'the label is preserved so the admin sees it');
  eq(li.unitPrice, 0, 'the rate is NOT carried over');
  eq(t.stats.optional, 1);
  ok(t.warnings.some(w => /optional/i.test(w)), 'the admin is told, so they can price it if taken');
});

test('a WAIVED line imports at zero, not as NaN', () => {
  const t = tree([
    HEAD(), SEC('1. X', '1.00'), GRP('A'),
    LINE('Free delivery', '1', 'lot', '0.00', 'WAIVED')
  ]);
  eq(t.sections[0].groups[0].lines[0].unitPrice, 0);
});

test('a lump-sum section (no line prices) is imported AND warned about', () => {
  const t = tree([
    HEAD(), SEC('1. PLUMBING', '80,000.00'), GRP('A. Rough-in'),
    row([[LINE_X, 'Pipes and fittings'], [X.qty, '1'], [X.unit, 'lot']])
  ]);
  eq(t.sections[0].groups[0].lines.length, 1, 'the line is still imported');
  eq(t.sections[0].groups[0].lines[0].unitPrice, 0);
  ok(t.warnings.some(w => /lump/i.test(w) && /PLUMBING/.test(w)),
     'warned that the section carries no unit prices — got: ' + JSON.stringify(t.warnings));
});

console.log('\n── §D  page bands: what is data and what is not ─────────');

test('the head row repeats on page 2 and re-anchors instead of becoming data', () => {
  resetY();
  const rows = [
    HEAD(),
    SEC('1. CIVIL WORKS', '1.00'), GRP('A'),
    LINE('Page one line', '1', 'set', '10.00', '10.00'),
    HEAD(),                                  // autotable showHead:'everyPage'
    LINE('Page two line', '2', 'set', '20.00', '40.00')
  ];
  rows[4].page = 1; rows[5].page = 1;
  const t = P.qtpTree(rows);
  eq(t.sections.length, 1, 'no phantom section from the repeated head');
  eq(t.sections[0].groups[0].lines.length, 2);
  eq(t.sections[0].groups[0].lines[1].description, 'Page two line');
});

test('everything before the head row and after the totals is ignored', () => {
  // The totals block's EARLIER rows are the trap: "Project Cost:",
  // "Sub-total:" and "Plus: VAT:" all precede "TOTAL PROJECT COST:", and
  // they price at zero — so they would sail past a checksum and show up as
  // junk line items in the builder.
  const t = tree([
    row([[22, 'CLIENT'], [50, 'Juan dela Cruz'], [140, 'QUOTE NO.'], [165, 'Q-2026-0003']]),
    row([[22, 'PROJECT'], [50, 'Prado Residence'], [140, 'DATE'], [165, 'September 15, 2026']]),
    HEAD(),
    SEC('1. X', '1.00'), GRP('A'), LINE('Real line', '1', 'set', '10.00', '10.00'),
    row([[300, 'Project Cost:'],     [X.amount + 16, '10.00']]),
    row([[300, 'Less: Discount:'],   [X.amount + 16, '(1.00)']]),
    row([[300, 'Sub-total:'],        [X.amount + 16, '9.00']]),
    row([[300, 'Plus: VAT:'],        [X.amount + 16, 'Not applicable']]),
    TOTAL('9.00'),
    row([[12, 'GENERAL TERMS & CONDITIONS']]),
    row([[12, '1. Prices are valid for 30 days.']])
  ]);
  eq(t.stats.lines, 1, 'neither the totals block nor the terms leaked in as line items');
  eq(t.stats.sections, 1);
  eq(t.sections[0].groups[0].lines[0].description, 'Real line');
  eq(t.printedTotal, 9, 'the checksum still comes from TOTAL PROJECT COST');
});

test('a PDF with no itemized head row is rejected with a plain-language error', () => {
  throws(() => P.qtpTree([row([[22, 'Some other document']]), row([[22, 'with no table']])]),
         /quotation/i, 'not-a-quotation');
});

test('a table with a head row but no line items is rejected, not imported empty', () => {
  throws(() => P.qtpTree([HEAD(), SEC('1. X', '0.00'), TOTAL('0.00')]),
         /no line items/i, 'empty-table');
});

test('a quotation exported with line pricing hidden is rejected', () => {
  throws(() => P.qtpTree([HEAD_NO_PRICE(), SEC('1. X', '1.00'), GRP('A'),
                          row([[LINE_X, 'a'], [X.qty, '1'], [X.unit, 'set'], [X.amount + 16, '10.00']])]),
         /pricing/i, 'no-prices');
});

console.log('\n── §E  document info box → report header ────────────────');

test('the info box maps PROJECT / CLIENT / LOCATION / AREA', () => {
  const h = P.qtpHeaderBox([
    row([[22, 'CLIENT'], [50, 'Juan dela Cruz'], [140, 'QUOTE NO.'], [165, 'Q-2026-0003']]),
    row([[22, 'PROJECT'], [50, 'Prado Residence'], [140, 'DATE'], [165, 'September 15, 2026']]),
    row([[22, 'LOCATION'], [50, 'Angeles City, Pampanga'], [140, 'VALID UNTIL'], [165, 'October 15, 2026']]),
    row([[22, 'ADDRESS'], [50, '123 Real St.'], [140, 'AREA'], [165, '120']]),
    HEAD(),
    SEC('1. X', '1.00')
  ]);
  eq(h.clientName, 'Juan dela Cruz');
  eq(h.projectName, 'Prado Residence');
  eq(h.location, 'Angeles City, Pampanga');
  eq(h.area, '120');
  eq(h.quoteNo, 'Q-2026-0003');
});

test('the info box scan stops at the table — "Project Cost:" is never read as PROJECT', () => {
  const h = P.qtpHeaderBox([
    row([[22, 'PROJECT'], [50, 'Real Project Name']]),
    HEAD(),
    SEC('1. X', '1.00'),
    row([[300, 'Project Cost:'], [X.amount + 16, '999.00']])
  ]);
  eq(h.projectName, 'Real Project Name', 'the totals block did not overwrite it');
});

console.log('\n── §F  money shape of the imported rows ─────────');

const SAMPLE = () => tree([
  HEAD(),
  SEC('1. CIVIL WORKS', '47,325.00'),
  GRP('A. Earthworks'),
  LINE('Excavation', '16.10', 'cu.m', '1,250.00', '20,125.00'),
  LINE('Backfill', '8.00', 'cu.m', '900.00', '7,200.00'),
  GRP('B. Concrete'),
  LINE('Footing', '4.00', 'cu.m', '5,000.00', '20,000.00'),
  TOTAL('47,325.00')
]);

test('the quotation rate lands in unitPrice, and NO material/labor split is invented', () => {
  const ci = M._pmRpImportMap(SAMPLE());
  const li = ci[0].subItems[0].lineItems[0];
  eq(li.unitPrice, '1250', 'one client-facing rate, exactly as the quotation carries it');
  ok(li.materialRate === undefined, 'no materialRate written');
  ok(li.laborRate === undefined, 'no laborRate written');
  eq(li.state, 'normal');
});

test('every imported line starts at 0% complete — a quotation is scope, not progress', () => {
  const ci = M._pmRpImportMap(SAMPLE());
  let n = 0;
  ci.forEach(c => c.subItems.forEach(s => s.lineItems.forEach(l => {
    eq(l.percentCompletion, 0, 'percentCompletion of ' + l.description);
    n++;
  })));
  eq(n, 3, 'all three lines checked');
  eq(MATH._pmBoqAcc(ci), 0, 'nothing is accomplished yet');
  eq(MATH._pmBoqPct({ costItems: ci }), 0, 'overall progress starts at 0%');
});

test('the imported grand total equals the quotation exactly', () => {
  const t = SAMPLE();
  const ci = M._pmRpImportMap(t);
  eq(MATH._pmBoqGrand(ci), 47325, 'Σ qty × unitPrice');
  eq(MATH._pmBoqGrand(ci), t.printedTotal, 'matches the PDF\u2019s printed TOTAL PROJECT COST');
});

test('the tree shape maps 1:1 onto cost items → sub-items → line items', () => {
  const ci = M._pmRpImportMap(SAMPLE());
  eq(ci.length, 1);
  eq(ci[0].name, 'CIVIL WORKS');
  eq(ci[0].pricing, 'rated', 'priced per line, like the quotation');
  eq(ci[0].subItems.length, 2);
  eq(ci[0].subItems[0].name, 'A. Earthworks');
  eq(ci[0].subItems[1].lineItems[0].description, 'Footing');
});

test('every node gets a fresh id with the right prefix', () => {
  const ci = M._pmRpImportMap(SAMPLE());
  ok(/^ci_/.test(ci[0].id), 'cost item id');
  ok(/^si_/.test(ci[0].subItems[0].id), 'sub-item id');
  ok(/^li_/.test(ci[0].subItems[0].lineItems[0].id), 'line item id');
  const ids = [];
  ci.forEach(c => c.subItems.forEach(s => s.lineItems.forEach(l => ids.push(l.id))));
  eq(new Set(ids).size, ids.length, 'line ids are unique');
});

test('values are stored as STRINGS, exactly like pmRpAddLine creates them', () => {
  const li = M._pmRpImportMap(SAMPLE())[0].subItems[0].lineItems[0];
  eq(typeof li.qty, 'string');
  eq(typeof li.unitPrice, 'string');
  eq(typeof li.unit, 'string');
  eq(typeof li.state, 'string');
});

console.log('\n── §G  lump-sum sections import AS lump sums ───────');

// The real shape of the Los Churreros quotation: 6 LOT sections, 59 lines, no
// line rates anywhere.
const LUMP = () => tree([
  HEAD(),
  SEC('1. I. GENERAL REQUIREMENTS', '112,000.00'),
  GRP('A. Mobilization & Demobilization'),
  row([[LINE_X, 'Mobilization / Demobilization'], [X.qty, '1'], [X.unit, 'lot']]),
  row([[LINE_X, 'Delivery of Materials'],         [X.qty, '1'], [X.unit, 'lot']]),
  SEC('2. II. SITE WORKS', '67,200.00'),
  GRP('A. Demolition Works'),
  row([[LINE_X, 'Demolition Works'], [X.qty, '1'], [X.unit, 'lot']]),
  TOTAL('179,200.00')
]);

test('a lump-priced section is detected and keeps its total', () => {
  const t = LUMP();
  eq(t.sections.length, 2);
  ok(t.sections[0].lump, 'section 1 flagged lump');
  eq(t.sections[0].amount, 112000);
  eq(t.stats.lines, 3, 'the scope still imports in full');
});

test('a LOT section imports AS a LOT, not as a pile of zero-rate lines', () => {
  const ci = M._pmRpImportMap(LUMP());
  eq(ci[0].pricing, 'lump');
  eq(ci[0].lumpAmount, '112000');
  eq(ci[1].pricing, 'lump');
  eq(ci[1].lumpAmount, '67200');
});

test('a normally-priced section is rated, with no LOT amount', () => {
  const ci = M._pmRpImportMap(SAMPLE());
  eq(ci[0].pricing, 'rated');
  eq(ci[0].lumpAmount, '', 'its lines already carry their own rates');
});

test('THE LOT MONEY SURVIVES THE IMPORT — it is not lost to zero-rate lines', () => {
  // This is the whole point: before LOT pricing existed the section imported as
  // ₱0 and the only money the PDF ever printed was thrown away.
  const ci = M._pmRpImportMap(LUMP());
  eq(MATH._pmBoqGrand(ci), 179200, '112,000 + 67,200');
  eq(MATH._pmBoqPct({ costItems: ci }), 0, 'but nothing is accomplished yet');
});

test('a LOT section\u2019s progress is weighted by the group amounts', () => {
  const ci = M._pmRpImportMap(LUMP());
  // Give the first section one group worth half its LOT, fully done.
  ci[0].subItems[0].lumpAmount = '112000';
  ci[0].subItems[0].lineItems.forEach(l => { l.percentCompletion = '100'; });
  eq(MATH._pmCiAcc(ci[0]), 112000, 'the whole LOT is accomplished');
  eq(MATH._pmBoqPct({ costItems: ci }), Math.round(112000 / 179200 * 100));
});

test('lump sections are reported so the admin knows rates are missing', () => {
  const t = LUMP();
  eq(t.warnings.filter(w => /lump sum/i.test(w)).length, 2, 'one warning per lump section');
  ok(/allocation target|LOT/i.test(t.warnings[0]), 'and it says what happens instead');
});

console.log('\n── §H  the builder tree: layout + staff hiding ──────');

// Render the LIVE tree markup from js/pm-admin.js. It is a pure string builder,
// so it runs without a browser once its collaborators are injected.
const treeSrc = slice(read('js/pm-admin.js'),
  'function _pmRpCostItemsHtml(d) {', 'function _pmRpUnitPrice(li) {', 'pm-admin.js');
function renderTree(role) {
  const win = { currentUserRole: role, pmRpMath: {
    num: _RP_E._pmRpNum, liRate: _RP_E._pmRpLiRate, liTotal: _RP_E._pmRpLiTotal,
    liAcc: _RP_E._pmRpLiAcc, isLump: _RP_E._pmRpIsLump, groupTotal: _RP_E._pmRpGroupTotal,
    groupAmount: _RP_E._pmRpGroupAmount, groupPct: _RP_E._pmRpGroupPct,
    ciSub: _RP_E._pmRpCiSub, ciAcc: _RP_E._pmRpCiAcc, grand: _RP_E._pmRpGrand,
    acc: _RP_E._pmRpAcc, pct: _RP_E._pmRpPct } };
  const f = new Function('_esc', 'window', '_fmt', '_pmRpRoman', '_pmRpAlpha',
                         'RP_STATES', '_pmRpUnitPrice',
    'return (' + treeSrc.replace(/^function _pmRpCostItemsHtml/, 'function') + ')')(
      (v) => String(v == null ? '' : v), win,
      (n) => '\u20B1' + Number(n || 0).toFixed(2),
      (n) => ['I', 'II', 'III'][n] || String(n + 1),
      (n) => String.fromCharCode(65 + n),
      ['normal', 'optional', 'waived', 'removed'],
      (li) => li.unitPrice || '');
  return f({ costItems: [
    { id: 'c1', name: 'GENERAL REQUIREMENTS', pricing: 'lump', lumpAmount: '112000', subItems: [
      { id: 's1', name: 'Mobilization', lumpAmount: '40000', lineItems: [
        { id: 'l1', description: 'Mobilization', unit: 'lot', qty: '1', percentCompletion: '50', state: 'normal' }] }] },
    { id: 'c2', name: 'CIVIL WORKS', pricing: 'rated', subItems: [
      { id: 's2', name: 'Earthworks', lineItems: [
        { id: 'l2', description: 'Excavation', unit: 'cu.m', qty: '2', unitPrice: '1250', percentCompletion: '0', state: 'normal' }] }] }] });
}
function colCount(tr) {
  return (tr.match(/<(td|th)\b[^>]*>/g) || []).reduce((n, c) => {
    const m = c.match(/colspan="(\d+)"/); return n + (m ? +m[1] : 1);
  }, 0);
}

test('every row spans exactly the nine columns of the head', () => {
  // A colspan that does not add up shears the whole table sideways, and it is
  // invisible until someone opens the page.
  ['owner', 'staff'].forEach(role => {
    const rows = renderTree(role).match(/<tr[\s\S]*?<\/tr>/g) || [];
    ok(rows.length >= 6, role + ': rows rendered');
    rows.forEach((r, i) => eq(colCount(r), 9, role + ' row ' + i));
  });
});

test('the head carries the quotation\u2019s columns plus % Complete', () => {
  const h = renderTree('owner');
  ['Item No.', 'Descriptions', 'QTY', 'Unit', 'Unit Price', 'Amount', '% Complete', 'State', 'Actions']
    .forEach(c => ok(h.indexOf('>' + c + '<') !== -1, 'missing column ' + c));
});

test('the tree uses the shared BOQ classes, so it matches the BOQ and the PDF', () => {
  const h = renderTree('owner');
  ['boq-table', 'boq-thead-row', 'boq-row-l1', 'boq-row-l2', 'boq-row-l3', 'boq-row-subtotal']
    .forEach(c => ok(h.indexOf(c) !== -1, 'missing ' + c));
});

test('a LOT cost item shows its pricing, its LOT box, and says what it means', () => {
  const h = renderTree('owner');
  ok(h.indexOf('Lump sum (LOT)') !== -1, 'the pricing dropdown');
  ok(h.indexOf('value="112000"') !== -1, 'the LOT amount');
  ok(h.indexOf('rp-lot-note') !== -1, 'the explainer row');
  ok(h.indexOf('scope only') !== -1, 'its lines carry no rate');
});

test('a rated cost item gets a real Unit Price box and no LOT explainer', () => {
  const h = renderTree('owner');
  ok(h.indexOf("'li','l2','unitPrice'") !== -1, 'unit price input on the rated line');
  eq((h.match(/rp-lot-note/g) || []).length, 1, 'only the LOT item explains itself');
});

test('every line carries a State dropdown', () => {
  const h = renderTree('owner');
  ['normal', 'optional', 'waived', 'removed'].forEach(s =>
    ok(h.indexOf('value="' + s + '"') !== -1, 'missing state ' + s));
});

test('STAFF SEE NO PESO AMOUNTS in the report builder', () => {
  // CLAUDE.md: staff must not see peso amounts anywhere. Project Management is
  // staff-visible (js/admin.js hides only Warranty Fund from them).
  const h = renderTree('staff');
  ok(h.indexOf('unitPrice') === -1, 'staff got a unit-price input');
  ok(h.indexOf('lumpAmount') === -1, 'staff got a LOT amount box');
  ok(h.indexOf('value="112000"') === -1, 'staff saw the LOT figure');
  ok(!/\u20B1[0-9]/.test(h), 'a peso figure reached a staff account');
});

test('% complete and State stay editable for staff — neither is money', () => {
  const h = renderTree('staff');
  ok(h.indexOf('percentCompletion') !== -1);
  ok(h.indexOf("'state'") !== -1);
});

console.log('\n── §I  the printed report sheet ─────────────────');

// js/pm-report-print.js builds a self-contained HTML document, so it runs
// outside a browser given a small window/document stub. The money it prints is
// read off window.pmRpMath — the LIVE helpers from pm-admin.js, not a copy —
// so this also proves the sheet cannot drift from the builder.
const RP_MATH = MATH;   // same engine, loaded once above

function printSheet(doc, role) {
  let out = '';
  const win = {
    location: { href: 'http://localhost/admin.html' },
    currentUserRole: role,
    // The same surface js/pm-admin.js publishes; the sheet reads nothing else.
    pmRpMath: { num: _RP_E._pmRpNum, liRate: _RP_E._pmRpLiRate, liTotal: _RP_E._pmRpLiTotal,
                liAcc: _RP_E._pmRpLiAcc, isLump: _RP_E._pmRpIsLump,
                groupTotal: _RP_E._pmRpGroupTotal, groupAmount: _RP_E._pmRpGroupAmount,
                groupPct: _RP_E._pmRpGroupPct, ciSub: _RP_E._pmRpCiSub, ciAcc: _RP_E._pmRpCiAcc,
                grand: _RP_E._pmRpGrand, acc: _RP_E._pmRpAcc, pct: _RP_E._pmRpPct },
    open: () => ({ document: { write: (h) => { out = h; }, close() {} } })
  };
  new Function('window', 'document', 'alert', read('js/pm-report-print.js'))(
    win, { createElement: () => ({}), head: { appendChild() {} } }, () => {});
  win.pmRpPrintSheet(doc);
  return out;
}

const RP_DOC = {
  reportNo: 'AR-2026-001', subject: 'Accomplishment Report', ownerName: 'Juan dela Cruz',
  projectName: 'Prado Residence', location: 'Pampanga', area: '120 SQM',
  date: '2026-09-15', asOfDate: '2026-09-30', preparedBy: 'Vincent Cruz', submittedBy: '',
  showLogo: true, showSignPrepared: true, showSignSubmitted: true, showAmounts: true,
  images: [], costItems: [{ id: 'c1', name: 'GENERAL REQUIREMENTS', subItems: [
    { id: 's1', name: 'Mobilization', lineItems: [
      { id: 'l1', description: 'Mobilization', unit: 'lot', qty: '1', unitPrice: '50000', state: 'normal', percentCompletion: '50' },
      { id: 'l2', description: 'Delivery', unit: 'lot', qty: '2', unitPrice: '15000', state: 'normal', percentCompletion: '100' }] }] }]
};

function itemsCols(html) {
  const i = html.indexOf('<table class="p-items"');
  const table = html.slice(i, html.indexOf('</table>', i));
  const head = (table.match(/<th\b[^>]*>/g) || []).length;
  const bad = (table.match(/<tr[\s\S]*?<\/tr>/g) || []).slice(1).filter(r =>
    (r.match(/<td\b[^>]*>/g) || []).reduce((a, c) => {
      const m = c.match(/colspan="(\d+)"/); return a + (m ? +m[1] : 1); }, 0) !== head);
  return { head, bad: bad.length };
}

test('the sheet prints the header, the tree and the house colours', () => {
  const h = printSheet(RP_DOC, 'owner');
  ok(h.indexOf('ACCOMPLISHMENT REPORT') !== -1, 'letterhead');
  ok(h.indexOf('AR-2026-001') !== -1, 'report no');
  ok(h.indexOf('Juan dela Cruz') !== -1, 'client');
  ok(h.indexOf('#fbbf24') !== -1, 'yellow head, same as the BOQ and the quotation');
  ok(h.indexOf('#c81e1e') !== -1, 'red section band');
  ok(h.indexOf('p-sub') !== -1, 'subtotal band');
});

test('dates print from LOCAL parts, never UTC', () => {
  // PH is UTC+8; new Date('2026-09-15') is parsed as UTC and renders the 14th.
  const h = printSheet(RP_DOC, 'owner');
  ok(h.indexOf('September 15, 2026') !== -1, 'report date');
  ok(h.indexOf('September 30, 2026') !== -1, 'period covered');
});

test('the sheet totals agree with the builder, to the centavo', () => {
  const h = printSheet(RP_DOC, 'owner');
  const grand = RP_MATH._pmBoqGrand(RP_DOC.costItems);
  const acc = RP_MATH._pmBoqAcc(RP_DOC.costItems);
  eq(grand, 80000); eq(acc, 55000);
  ok(h.indexOf('80,000.00') !== -1, 'grand total');
  ok(h.indexOf('55,000.00') !== -1, 'accomplishment');
  ok(h.indexOf(RP_MATH._pmBoqPct(RP_DOC) + '%') !== -1, 'overall progress');
});

test('every printed row spans the full head, with money and without', () => {
  ['owner', 'staff'].forEach(role => {
    const r = itemsCols(printSheet(RP_DOC, role));
    eq(r.bad, 0, role + ': rows not matching the ' + r.head + '-column head');
  });
  // # | DESCRIPTION | QTY | UNIT | UNIT PRICE | AMOUNT | % COMPLETE
  eq(itemsCols(printSheet(RP_DOC, 'owner')).head, 7, 'owner head width');
  eq(itemsCols(printSheet(RP_DOC, 'staff')).head, 5, 'staff head width');
});

test('STAFF GET NO PESO AMOUNTS on the printed sheet either', () => {
  // showAmounts is true on this document; the role must still win.
  const h = printSheet(RP_DOC, 'staff');
  ok(!/\u20B1|80,000\.00|55,000\.00|50,000\.00/.test(h), 'an amount reached a staff print');
  ok(h.indexOf('Subtotal') === -1, 'staff got a subtotal band');
  ok(h.indexOf('% COMPLETE') !== -1, 'progress is not money — it stays');
  ok(h.indexOf('Delivery') !== -1, 'staff still see the work itself');
});

test('the printed-sheet switches actually switch things off', () => {
  const off = (k) => printSheet(Object.assign({}, RP_DOC, { [k]: false }), 'owner');
  ok(off('showLogo').indexOf('<img class="p-logo"') === -1, 'logo');
  const noMoney = off('showAmounts');
  ok(noMoney.indexOf('80,000.00') === -1, 'amounts');
  ok(noMoney.indexOf('% COMPLETE') !== -1, 'but progress survives');
  const noPrep = off('showSignPrepared');
  ok(noPrep.indexOf('>Prepared by<') === -1, 'prepared-by column');
  ok(noPrep.indexOf('Conforme') !== -1, 'the client column is never optional');
});

test('Submitted by falls back to Prepared by, then to the company', () => {
  const h = printSheet(RP_DOC, 'owner');           // submittedBy is blank
  eq((h.match(/Vincent Cruz/g) || []).length, 2, 'the fallback printed the same name twice');
  const anon = printSheet(Object.assign({}, RP_DOC, { preparedBy: '', submittedBy: '' }), 'owner');
  // The apostrophe is HTML-escaped on the way out, as it must be.
  ok(/DAC(&#39;|')S CONSTRUCTION/.test(anon), 'company name is the last resort');
});

console.log('\n── §J  the report math engine, and its two copies ────');

// The engine is duplicated verbatim in the admin editor and the client/partner
// portal because there is no module system to share it. Load BOTH copies and
// run every fixture through each: if one ever drifts, this fails.
function loadEngine(file, prefix) {
    const src = slice(read(file), '// ==== RP MATH ENGINE START ====',
                                  '// ==== RP MATH ENGINE END ====', file);
    const names = ['Num','LiRate','LiTotal','LiAcc','IsLump','GroupTotal','GroupAmount',
                   'GroupPct','CiSub','CiAcc','Grand','Acc','Pct'].map(n => prefix + n);
    const got = evalWith(src, { window: {} }, names);
    const api = {};
    names.forEach(n => { api[n.slice(prefix.length)] = got[n]; });
    return api;
}
const ENGINES = {
    'pm-admin.js':             loadEngine('js/pm-admin.js', '_pmRp'),
    'client-management-app.js': loadEngine('js/client-management-app.js', 'cmBoq')
};
function bothAgree(label, fn) {
    const results = Object.keys(ENGINES).map(k => [k, fn(ENGINES[k])]);
    const first = JSON.stringify(results[0][1]);
    results.slice(1).forEach(([k, v]) => {
        if (JSON.stringify(v) !== first) {
            throw new Error(label + ': ' + results[0][0] + ' says ' + first +
                            ' but ' + k + ' says ' + JSON.stringify(v));
        }
    });
    return results[0][1];
}

// A legacy report: material + labor, no unitPrice, no state, no pricing.
const LEGACY = { costItems: [{ id: 'c', name: 'Civil', subItems: [
    { id: 's', name: 'Earthworks', lineItems: [
        { id: 'a', qty: '16.1', materialRate: '1250', laborRate: '', percentCompletion: '50' },
        { id: 'b', qty: '8', materialRate: '600', laborRate: '300', percentCompletion: '100' }] }] }] };

// The same work written the new way: one unitPrice per line.
const MODERN = { costItems: [{ id: 'c', name: 'Civil', pricing: 'rated', subItems: [
    { id: 's', name: 'Earthworks', lineItems: [
        { id: 'a', qty: '16.1', unitPrice: '1250', state: 'normal', percentCompletion: '50' },
        { id: 'b', qty: '8', unitPrice: '900', state: 'normal', percentCompletion: '100' }] }] }] };

test('a LEGACY report computes exactly what it always did', () => {
    // 16.1 x 1250 = 20,125 ; 8 x 900 = 7,200
    const g = bothAgree('legacy grand', e => e.Grand(LEGACY.costItems));
    eq(g, 27325);
    eq(bothAgree('legacy acc', e => e.Acc(LEGACY.costItems)), 20125 * 0.5 + 7200);
    eq(bothAgree('legacy pct', e => e.Pct(LEGACY)), 63);
});

test('unitPrice and the old split agree when they describe the same work', () => {
    eq(bothAgree('modern grand', e => e.Grand(MODERN.costItems)),
       bothAgree('legacy grand', e => e.Grand(LEGACY.costItems)));
    eq(bothAgree('modern pct', e => e.Pct(MODERN)), bothAgree('legacy pct', e => e.Pct(LEGACY)));
});

test('unitPrice WINS over a stale material/labor pair on the same line', () => {
    const li = { qty: '2', unitPrice: '100', materialRate: '999', laborRate: '999' };
    eq(bothAgree('rate', e => e.LiRate(li)), 100);
    eq(bothAgree('total', e => e.LiTotal(li)), 200);
});

test('optional / waived / removed lines contribute ZERO', () => {
    ['optional', 'waived', 'removed'].forEach(st => {
        eq(bothAgree(st, e => e.LiTotal({ qty: '5', unitPrice: '100', state: st })), 0);
        eq(bothAgree(st + ' acc', e => e.LiAcc({ qty: '5', unitPrice: '100', state: st, percentCompletion: '100' })), 0);
    });
    eq(bothAgree('normal', e => e.LiTotal({ qty: '5', unitPrice: '100', state: 'normal' })), 500);
});

// ── LOT-priced sections ─────────────────────────────────────
const LOT = { costItems: [{ id: 'c', name: 'GENERAL REQUIREMENTS', pricing: 'lump',
    lumpAmount: '112000', subItems: [
    { id: 'g1', name: 'Mobilization', lumpAmount: '40000', lineItems: [
        { id: 'a', qty: '1', unit: 'lot', percentCompletion: '50', state: 'normal' }] },
    { id: 'g2', name: 'Permits', lumpAmount: '20000', lineItems: [
        { id: 'b', qty: '1', unit: 'lot', percentCompletion: '100', state: 'normal' }] },
    { id: 'g3', name: 'Bonds', lumpAmount: '52000', lineItems: [
        { id: 'c1', qty: '1', unit: 'lot', percentCompletion: '0', state: 'normal' }] }] }] };

test('a LOT section totals its OWN amount — the group figures never re-add', () => {
    eq(bothAgree('lot total', e => e.Grand(LOT.costItems)), 112000,
       'the group figures (40k+20k+52k) must not be added on top');
});

test('LOT progress is weighted by the group working figures', () => {
    // (40k x 50% + 20k x 100% + 52k x 0%) / 112k = 40,000 / 112,000
    eq(bothAgree('lot acc', e => e.Acc(LOT.costItems)), 40000);
    eq(bothAgree('lot pct', e => e.Pct(LOT)), 36);
});

test('a LOT section with NO group figures weighs its groups equally', () => {
    const flat = JSON.parse(JSON.stringify(LOT));
    flat.costItems[0].subItems.forEach(g => { delete g.lumpAmount; });
    // (50 + 100 + 0) / 3 = 50%
    eq(bothAgree('flat acc', e => e.Acc(flat.costItems)), 56000);
    eq(bothAgree('flat pct', e => e.Pct(flat)), 50);
});

test('a LOT section with no LOT amount falls back to summing its groups', () => {
    const noLot = JSON.parse(JSON.stringify(LOT));
    delete noLot.costItems[0].lumpAmount;
    eq(bothAgree('sum of groups', e => e.Grand(noLot.costItems)), 112000);
});

test('groupAmount reports the working figure in a LOT, the real sum when rated', () => {
    const ci = LOT.costItems[0];
    eq(bothAgree('lot group', e => e.GroupAmount(ci, ci.subItems[0])), 40000);
    const rc = MODERN.costItems[0];
    eq(bothAgree('rated group', e => e.GroupAmount(rc, rc.subItems[0])), 27325);
});

// ── The two ways LOT weighting went wrong ─────────────────────
// Both were found by a report whose every line read 50% while the summary read
// 52%. Each is a one-line slip with a client-visible consequence, so both are
// pinned here.

test('IF EVERY LINE IS 50%, THE WHOLE REPORT IS 50% — whatever the groups look like', () => {
    // The property that caught both bugs. It must hold for any arrangement of
    // group amounts and empty groups.
    const section = (lot, groups) => ({
        id: 'c' + lot, name: 'S', pricing: 'lump', lumpAmount: String(lot),
        subItems: groups.map((amt, i) => ({
            id: 'g' + lot + i, name: 'G', lumpAmount: amt,
            lineItems: amt === null ? [] : [{ id: 'l' + lot + i, state: 'normal', percentCompletion: '50' }]
        }))
    });
    const doc = { costItems: [
        section(112000, ['', '', null, null]),        // all blank, two empty groups
        section(67200,  ['40000', '27200']),          // fully priced
        section(154800, ['100000', '', null]),        // mixed, one empty
        section(28000,  [''])                         // single blank group
    ] };
    const grand = bothAgree('grand', e => e.Grand(doc.costItems));
    eq(grand, 362000);
    eq(bothAgree('acc', e => e.Acc(doc.costItems)), 181000, 'exactly half');
    eq(bothAgree('pct', e => e.Pct(doc)), 50);
});

test('a group with a BLANK amount is never dropped from the weighting', () => {
    // The bug that inflated: weighting by only the groups that happen to carry
    // an amount applies their progress to the WHOLE LOT, so a section half
    // done reported as fully on track.
    const doc = { costItems: [{ id: 'c', name: 'S', pricing: 'lump', lumpAmount: '100000', subItems: [
        { id: 'g1', name: 'Priced', lumpAmount: '50000', lineItems: [
            { id: 'a', state: 'normal', percentCompletion: '50' }] },
        { id: 'g2', name: 'Blank', lumpAmount: '', lineItems: [
            { id: 'b', state: 'normal', percentCompletion: '0' }] }] }] };
    eq(bothAgree('acc', e => e.Acc(doc.costItems)), 25000,
       'half the scope at 50% and half at 0% is 25%, not 50%');
    eq(bothAgree('pct', e => e.Pct(doc)), 25);
});

test('a group with NO lines is left out, not scored 0%', () => {
    // The bug that deflated: an empty placeholder group counted as "not
    // started" and dragged a finished section down.
    const doc = { costItems: [{ id: 'c', name: 'S', pricing: 'lump', lumpAmount: '90000', subItems: [
        { id: 'g1', name: 'Real work', lumpAmount: '', lineItems: [
            { id: 'a', state: 'normal', percentCompletion: '100' }] },
        { id: 'g2', name: 'Empty placeholder', lumpAmount: '', lineItems: [] },
        { id: 'g3', name: 'Another placeholder', lumpAmount: '', lineItems: [] }] }] };
    eq(bothAgree('pct', e => e.Pct(doc)), 100,
       'the only group with scope is finished, so the section is finished');
});

test('a group whose lines are ALL non-normal has no scope either', () => {
    const doc = { costItems: [{ id: 'c', name: 'S', pricing: 'lump', lumpAmount: '90000', subItems: [
        { id: 'g1', name: 'Real', lumpAmount: '', lineItems: [
            { id: 'a', state: 'normal', percentCompletion: '100' }] },
        { id: 'g2', name: 'All waived', lumpAmount: '', lineItems: [
            { id: 'b', state: 'waived', percentCompletion: '0' },
            { id: 'c2', state: 'removed', percentCompletion: '0' }] }] }] };
    eq(bothAgree('pct', e => e.Pct(doc)), 100, 'waived and removed work is not outstanding work');
});

test('a section with no scope at all reports 0%, not NaN', () => {
    const doc = { costItems: [{ id: 'c', name: 'S', pricing: 'lump', lumpAmount: '50000',
        subItems: [{ id: 'g', name: 'Empty', lumpAmount: '', lineItems: [] }] }] };
    eq(bothAgree('acc', e => e.Acc(doc.costItems)), 0);
    eq(bothAgree('pct', e => e.Pct(doc)), 0);
});

test('an empty or zero-value report reports 0%, never NaN or a divide-by-zero', () => {
    eq(bothAgree('empty', e => e.Pct({ costItems: [] })), 0);
    eq(bothAgree('zero', e => e.Pct({ costItems: [{ id: 'z', subItems: [
        { id: 'y', lineItems: [{ id: 'x', qty: '0', unitPrice: '0', percentCompletion: '100' }] }] }] })), 0);
});

// ── Report ───────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('Quotation-PDF import rules hold.\n');
