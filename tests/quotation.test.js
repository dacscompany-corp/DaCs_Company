// ════════════════════════════════════════════════════════════════════
// QUOTATION CALC TESTS — run with:  node tests/quotation.test.js
//
// Zero dependencies, no framework. Feeds known inputs into the REAL
// functions, extracted from js/quotation-module.js at run time (never a
// copy), and fails loudly if a rule breaks.
//
// The rules under guard (see the spec, §7–§8):
//   1. Totals order is FIXED: discount applies to Project Cost, VAT
//      applies to the DISCOUNTED sub-total.
//   2. optional / waived / removed lines contribute ZERO — but a removed
//      line KEEPS its price so the revision diff can value the deletion.
//   3. A section's own lumpAmount WINS; group amounts under it are a
//      display breakdown and must not re-add.
//   4. Expiry is COMPUTED from local date parts. Never UTC — PH is UTC+8
//      and toISOString() rolls the key back a day.
//   5. The revision diff matches lines by id and reports a peso delta.
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

function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/quotation.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}
function evalWith(src, ctx, names) {
  const fn = new Function('ctx', 'with(ctx){' + src + '\n; return {' + names.join(',') + '};}');
  return fn(ctx);
}

// ── Load the live calc engine ────────────────────────────────────────
const src = read('js/quotation-module.js');
const M = evalWith(
  slice(src, '// ==== QT CALC ENGINE START ====', '// ==== QT CALC ENGINE END ====', 'quotation-module.js'),
  { window: {} },
  ['qtParseNum','qtLineAmount','qtRawLineAmount','qtGroupTotal','qtSectionTotal','qtProjectCost',
   'qtDiscountAmount','qtSubTotal','qtVatAmount','qtGrandTotal','qtIsExpired',
   'qtNextQuoteNo','qtFlattenLines','qtDiffSnapshots','qtTodayKey']
);

// ── Fixtures ─────────────────────────────────────────────────────────
const line = (id, qty, price, state) =>
  ({ id, description: 'line ' + id, qty, unit: 'pc', unitPrice: price, state: state || 'normal' });

// Rated section: 2×850 + 3×1200 = 5,300
const ratedSection = {
  id: 'S1', label: 'ELECTRICAL', pricing: 'rated',
  groups: [{ id: 'G1', label: 'OUTLETS', lines: [line('L1', 2, 850), line('L2', 3, 1200)] }]
};

// Lump section, mirroring the reference document:
// REPAIR SERVICE = 200,126 with KIOSK 92,707 + ELECTRICAL 107,419 shown
// underneath as a BREAKDOWN, not as extra charges.
const lumpSectionWithOwnAmount = {
  id: 'S2', label: 'REPAIR SERVICE', pricing: 'lump', lumpAmount: 200126,
  groups: [
    { id: 'G2', label: 'KIOSK',      lumpAmount: 92707,  lines: [line('L3', 1, 0)] },
    { id: 'G3', label: 'ELECTRICAL', lumpAmount: 107419, lines: [line('L4', 1, 0)] }
  ]
};

// Lump section with NO section-level amount: groups sum instead.
const lumpSectionGroupsOnly = {
  id: 'S3', label: 'MOBILIZATION', pricing: 'lump',
  groups: [
    { id: 'G4', label: 'DELIVERY',     lumpAmount: 8000, lines: [] },
    { id: 'G5', label: 'INSTALLATION', lumpAmount: 4948, lines: [] }
  ]
};

const quote = (over) => Object.assign({
  sections: [ratedSection], discount: 0, discountType: 'amount',
  vatMode: 'none', vatPct: 12, status: 'draft', validUntil: null
}, over || {});

console.log('\n── Line amounts and line states ──');

test('rated line = qty x unitPrice', () => {
  eq(M.qtLineAmount(line('X', 2, 850)), 1700);
});
test('optional line contributes zero', () => {
  eq(M.qtLineAmount(line('X', 2, 850, 'optional')), 0);
});
test('waived line contributes zero', () => {
  eq(M.qtLineAmount(line('X', 2, 850, 'waived')), 0);
});
test('removed line contributes zero', () => {
  eq(M.qtLineAmount(line('X', 3, 9602, 'removed')), 0);
});
test('removed line KEEPS its price in the data (deletion is valuable)', () => {
  const l = line('X', 3, 9602, 'removed');
  eq(l.qty * l.unitPrice, 28806, 'raw price still recoverable');
});
// The print sheet needs a line's value REGARDLESS of state — a removed line
// prints struck through but still shows what it was worth. Without this the
// print module would reimplement qty x price outside the tested engine.
test('raw line amount ignores state', () => {
  eq(M.qtRawLineAmount(line('X', 3, 9602, 'removed')), 28806);
  eq(M.qtRawLineAmount(line('X', 3, 9602)), 28806);
});
test('raw line amount is zero for a missing line', () => {
  eq(M.qtRawLineAmount(null), 0);
});
test('blank and junk numbers parse to zero, never NaN', () => {
  eq(M.qtParseNum(''), 0);
  eq(M.qtParseNum(null), 0);
  eq(M.qtParseNum('abc'), 0);
  eq(M.qtParseNum('1,234.50'), 1234.5, 'commas are stripped');
});

console.log('\n── Section totals ──');

test('rated section sums its lines', () => {
  eq(M.qtSectionTotal(ratedSection), 5300);
});
test('lump section with its own amount IGNORES group amounts', () => {
  // 92,707 + 107,419 also equals 200,126 — so use a section amount that
  // differs from the group sum, or the test proves nothing.
  const s = Object.assign({}, lumpSectionWithOwnAmount, { lumpAmount: 190000 });
  eq(M.qtSectionTotal(s), 190000, 'section amount wins, groups do not re-add');
});
test('lump section with no own amount sums its groups', () => {
  eq(M.qtSectionTotal(lumpSectionGroupsOnly), 12948);
});
test('lump section lines never add to the total', () => {
  const s = { id: 'S', label: 'X', pricing: 'lump', lumpAmount: 5000,
              groups: [{ id: 'G', label: 'g', lines: [line('L', 10, 999)] }] };
  eq(M.qtSectionTotal(s), 5000);
});

console.log('\n── Totals order: discount then VAT ──');

test('project cost sums sections', () => {
  eq(M.qtProjectCost([ratedSection, lumpSectionGroupsOnly]), 5300 + 12948);
});
test('amount discount subtracts from project cost', () => {
  const q = quote({ sections: [lumpSectionWithOwnAmount], discount: 9531, discountType: 'amount' });
  eq(M.qtProjectCost(q.sections), 200126);
  eq(M.qtDiscountAmount(q), 9531);
  eq(M.qtSubTotal(q), 190595);
});
test('percent discount is a percent OF PROJECT COST', () => {
  const q = quote({ sections: [lumpSectionGroupsOnly], discount: 10, discountType: 'percent' });
  eq(M.qtDiscountAmount(q), 1294.8);
  eq(M.qtSubTotal(q), 11653.2);
});
test('discount cannot drive the sub-total negative', () => {
  const q = quote({ sections: [lumpSectionGroupsOnly], discount: 99999, discountType: 'amount' });
  eq(M.qtSubTotal(q), 0);
});
test('vatMode none adds nothing', () => {
  const q = quote({ sections: [lumpSectionGroupsOnly], vatMode: 'none' });
  eq(M.qtVatAmount(q), 0);
  eq(M.qtGrandTotal(q), 12948);
});
test('vatMode exclusive computes VAT on the DISCOUNTED sub-total and adds it', () => {
  const q = quote({ sections: [lumpSectionWithOwnAmount], discount: 9531,
                    discountType: 'amount', vatMode: 'exclusive', vatPct: 12 });
  eq(M.qtSubTotal(q), 190595);
  eq(M.qtVatAmount(q), 22871.4, 'VAT is 12% of 190,595 — NOT of 200,126');
  eq(M.qtGrandTotal(q), 213466.4);
});
test('vatMode inclusive breaks VAT out without changing the total', () => {
  const q = quote({ sections: [lumpSectionGroupsOnly], vatMode: 'inclusive', vatPct: 12 });
  eq(M.qtGrandTotal(q), 12948, 'total unchanged');
  eq(M.qtVatAmount(q), 12948 - (12948 / 1.12), 'component within the total');
});

console.log('\n── Expiry (PH timezone) ──');

test('todayKey is built from LOCAL parts, not toISOString', () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  eq(M.qtTodayKey(), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
});
test('a sent quote past its validity is expired', () => {
  ok(M.qtIsExpired({ status: 'sent', validUntil: '2000-01-01' }));
});
test('a sent quote inside its validity is not expired', () => {
  ok(!M.qtIsExpired({ status: 'sent', validUntil: '2999-01-01' }));
});
test('a draft is never expired', () => {
  ok(!M.qtIsExpired({ status: 'draft', validUntil: '2000-01-01' }));
});
test('a won quote is never expired', () => {
  ok(!M.qtIsExpired({ status: 'won', validUntil: '2000-01-01' }));
});
test('no validity date means never expired', () => {
  ok(!M.qtIsExpired({ status: 'sent', validUntil: null }));
});

console.log('\n── Quote numbering ──');

test('first quote of the year is 0001', () => {
  const yr = new Date().getFullYear();
  eq(M.qtNextQuoteNo([]), `Q-${yr}-0001`);
});
test('numbering continues from the highest used THIS year', () => {
  const yr = new Date().getFullYear();
  eq(M.qtNextQuoteNo([
    { quoteNo: `Q-${yr}-0001` }, { quoteNo: `Q-${yr}-0007` }, { quoteNo: `Q-${yr}-0003` }
  ]), `Q-${yr}-0008`);
});
test('last year numbers do not affect this year', () => {
  const yr = new Date().getFullYear();
  eq(M.qtNextQuoteNo([{ quoteNo: `Q-${yr - 1}-0042` }]), `Q-${yr}-0001`);
});
test('malformed quote numbers are ignored, not crashed on', () => {
  const yr = new Date().getFullYear();
  eq(M.qtNextQuoteNo([{ quoteNo: null }, { quoteNo: 'junk' }, { quoteNo: `Q-${yr}-0002` }]), `Q-${yr}-0003`);
});

console.log('\n── Revision diff ──');

const revA = { sections: [{ id: 'S', label: 'BRANDING', pricing: 'rated',
  groups: [{ id: 'G', label: 'SIGNAGE', lines: [
    line('keep', 1, 50000), line('gone', 3, 9602), line('edit', 1, 10000)
  ] }] }], totalAmount: 88806 };

const revB = { sections: [{ id: 'S', label: 'BRANDING', pricing: 'rated',
  groups: [{ id: 'G', label: 'SIGNAGE', lines: [
    line('keep', 1, 50000), line('gone', 3, 9602, 'removed'),
    line('edit', 1, 12000), line('new', 1, 2500)
  ] }] }], totalAmount: 64500 };

test('flatten walks all three levels and carries the path', () => {
  const flat = M.qtFlattenLines(revA.sections);
  eq(flat.length, 3);
  eq(flat[0].id, 'keep');
  ok(flat[0].path.includes('BRANDING'), 'path names the section');
  ok(flat[0].path.includes('SIGNAGE'), 'path names the group');
});
test('diff detects an added line', () => {
  const d = M.qtDiffSnapshots(revA, revB);
  eq(d.added.length, 1);
  eq(d.added[0].id, 'new');
  eq(d.added[0].amount, 2500);
});
test('diff detects a line changed to removed and values the deletion', () => {
  const d = M.qtDiffSnapshots(revA, revB);
  const gone = d.changed.find(c => c.id === 'gone');
  ok(gone, 'the struck-out line shows as changed');
  eq(gone.from.amount, 28806, 'it was worth 28,806 before');
  eq(gone.to.amount, 0, 'it counts zero now');
  eq(gone.delta, -28806, 'the deletion is valued — the question the reference sheet could not answer');
});
test('diff detects a price change', () => {
  const d = M.qtDiffSnapshots(revA, revB);
  const edit = d.changed.find(c => c.id === 'edit');
  ok(edit, 'edited line detected');
  eq(edit.delta, 2000);
});
test('diff detects a deleted line', () => {
  const d = M.qtDiffSnapshots(revB, { sections: [{ id: 'S', label: 'BRANDING', pricing: 'rated',
    groups: [{ id: 'G', label: 'SIGNAGE', lines: [line('keep', 1, 50000)] }] }], totalAmount: 50000 });
  eq(d.removed.length, 3);
});
test('diff reports the net peso delta between revisions', () => {
  eq(M.qtDiffSnapshots(revA, revB).delta, 64500 - 88806);
});

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
