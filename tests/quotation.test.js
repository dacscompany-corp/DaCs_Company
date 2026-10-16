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
  ['qtParseNum','qtFmt','qtLineAmount','qtRawLineAmount','qtGroupTotal','qtSectionTotal',
   'qtProjectCost','qtDiscountAmount','qtSubTotal','qtVatAmount','qtGrandTotal','qtIsExpired',
   'qtNextQuoteNo','qtFlattenLines','qtDiffSnapshots','qtTodayKey','qtDuplicateOf']
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

// ── The sheet prints NO group amounts, ever ──────────────────────────
// qtGroupPrintAmount (js/quotation-print.js) is the single choke point both
// render paths use for a group's AMOUNT cell, and it always prints blank. A
// group amount sitting beside a section total reads to the client as a charge
// stacked on top of it. Blanked 2026-08-06, restored 2026-08-26 behind an
// arithmetic "do they foot?" test, blanked again 2026-08-27 — owner's call
// each time, because footing correctly still read as double-billing.
//
// Each case below asserts BOTH halves: nothing prints, AND qtSectionTotal
// still does its math off those group amounts. The math must not get
// "simplified away" just because nothing renders it.
const P = evalWith(
  slice(read('js/quotation-print.js'),
        'function qtGroupPrintAmount', '// ── Table rows', 'quotation-print.js'),
  { window: { qtParseNum: M.qtParseNum, qtGroupTotal: M.qtGroupTotal, qtFmt: M.qtFmt } },
  ['qtGroupPrintAmount']
);

// Sums what the sheet actually PRINTS for a section's groups.
const printedGroupSum = (sec) => (sec.groups || []).reduce((s, g) => {
  const cell = P.qtGroupPrintAmount(sec, g);
  return s + (cell === '' ? 0 : M.qtParseNum(cell));
}, 0);

const gLump = (id, amt) => ({ id, label: id, lumpAmount: amt, lines: [] });
const gRated = (id, ...ls) => ({ id, label: id, lumpAmount: '', lines: ls });

test('LOT section with its own amount prints NO group amounts', () => {
  // 25,000 + 25,000 beside a 100,000 section is the 2026-08-06 misread.
  const sec = { id: 'S', pricing: 'lump', lumpAmount: 100000,
                groups: [gLump('D', 25000), gLump('H', 25000)] };
  eq(P.qtGroupPrintAmount(sec, sec.groups[0]), '');
  eq(P.qtGroupPrintAmount(sec, sec.groups[1]), '');
  eq(printedGroupSum(sec), 0, 'nothing printed');
  eq(M.qtSectionTotal(sec), 100000, "the section's own amount still wins");
});

test('LOT section with NO amount of its own STILL prints no group amounts', () => {
  // Here the groups genuinely foot to the section — and it makes no
  // difference. Footing correctly is what 2026-08-26 allowed and 2026-08-27
  // took back: the client only ever sees the section total.
  const sec = { id: 'S', pricing: 'lump', lumpAmount: '',
                groups: [gLump('D', 25000), gLump('H', 75000)] };
  eq(printedGroupSum(sec), 0, 'nothing printed even though they foot');
  eq(M.qtSectionTotal(sec), 100000, 'the section still sums from them');
});

test('rated section prints no group amounts, but still sums them', () => {
  const sec = { id: 'S', pricing: 'rated', lumpAmount: '',
                groups: [gRated('A', line('mob', 1, 5000), line('del', 1, 5000)),
                         gRated('H', line('pm', 1, 40000))] };
  eq(printedGroupSum(sec), 0, 'nothing printed');
  eq(M.qtSectionTotal(sec), 50000, 'the section still sums from the lines');
});

test('a zero / BY OWNER group prints blank, same as every other group', () => {
  const sec = { id: 'S', pricing: 'lump', lumpAmount: '',
                groups: [gLump('D', 25000), gLump('E', ''), gLump('F', 0)] };
  eq(P.qtGroupPrintAmount(sec, sec.groups[0]), '', 'funded group');
  eq(P.qtGroupPrintAmount(sec, sec.groups[1]), '', 'empty group');
  eq(P.qtGroupPrintAmount(sec, sec.groups[2]), '', 'zero group');
  eq(M.qtSectionTotal(sec), 25000);
});

test('waived lines do not inflate a rated section total', () => {
  const waived = { ...line('by owner', 1, 9999), state: 'waived' };
  const sec = { id: 'S', pricing: 'rated', lumpAmount: '',
                groups: [gRated('B', waived), gRated('D', line('haul', 1, 5000))] };
  eq(P.qtGroupPrintAmount(sec, sec.groups[0]), '', 'all-waived group prints blank');
  eq(printedGroupSum(sec), 0, 'nothing printed');
  eq(M.qtGroupTotal(sec.groups[0]), 0, 'waived line carries no money');
  eq(M.qtSectionTotal(sec), 5000);
});

// ── A group's optional qty / unit are LABELS, never multipliers ──────
// Groups may carry their own qty and unit so the sheet can read
// "Clearing & Hauling — 2 lot — 25,000.00". They are presentation only: a
// group's money is its lumpAmount, or the sum of its lines. If qty ever starts
// multiplying, a quotation silently doubles.
test('group qty does NOT multiply a LOT group amount', () => {
  const sec = { id: 'S', pricing: 'lump', lumpAmount: '',
                groups: [{ id: 'D', label: 'Clearing & Hauling',
                           qty: 5, unit: 'lot', lumpAmount: 25000, lines: [] }] };
  eq(M.qtSectionTotal(sec), 25000, 'qty 5 must not make it 125,000');
  eq(P.qtGroupPrintAmount(sec, sec.groups[0]), '', 'and it prints no amount');
});

test('group qty does NOT multiply a rated group total', () => {
  const sec = { id: 'S', pricing: 'rated', lumpAmount: '',
                groups: [{ id: 'A', label: 'Mobilization', qty: 3, unit: 'set',
                           lumpAmount: '', lines: [line('mob', 1, 5000)] }] };
  eq(M.qtGroupTotal(sec.groups[0]), 5000, 'qty 3 must not make it 15,000');
  eq(M.qtSectionTotal(sec), 5000);
});

test('a group with no qty / unit still totals normally', () => {
  const sec = { id: 'S', pricing: 'lump', lumpAmount: '',
                groups: [{ id: 'D', label: 'Clearing', lumpAmount: 25000, lines: [] }] };
  eq(M.qtSectionTotal(sec), 25000);
  eq(P.qtGroupPrintAmount(sec, sec.groups[0]), '', 'and it prints no amount');
});

// ── Duplicate: a new quotation from a past one ───────────────────────
// The copy is for a DIFFERENT client: the work is copied, the client is not,
// and no node may keep its source id (the revision diff pairs lines by id).
{
  const blank = () => ({ id: null, quoteNo: 'Q-NEW', revNo: 1, quoteDate: '2026-10-16',
    validUntil: '2026-11-15', clientName: '', clientEmail: '', clientAddress: '',
    projectName: '', location: '', area: '', subject: 'Project Estimate', scopeNote: '',
    images: [], showLinePricing: true, showLogo: true, sections: [],
    discount: 0, discountType: 'amount', vatMode: 'none', vatPct: 12, totalAmount: 0,
    status: 'draft', statusNote: '', decidedAt: null, followUpDate: '', followUpNote: '',
    terms: { payment: 'default' }, preparedBy: '', submittedBy: '', history: [] });
  const past = {
    id: 'OLD', quoteNo: 'Q-001', revNo: 3, quoteDate: '2026-01-05', validUntil: '2026-02-04',
    clientName: 'Old Client', clientEmail: 'old@x.ph', clientAddress: 'Old St.',
    projectName: '2-storey house', location: 'Cavite', area: '120 sqm', subject: 'Estimate',
    scopeNote: 'note', images: [{ url: 'u1', name: 'a.jpg', caption: '' }],
    showLinePricing: false, showLogo: false,
    sections: [{ id: 'S1', label: 'ELEC', pricing: 'rated', lumpAmount: '',
      groups: [{ id: 'G1', label: 'Wiring', lumpAmount: '',
        lines: [line('L1', 2, 850), line('L2', 1, 1000, 'optional'), line('L3', 5, 999, 'removed')] }] }],
    discount: 100, discountType: 'amount', vatMode: 'exclusive', vatPct: 12, totalAmount: 0,
    status: 'won', statusNote: 'signed', decidedAt: '2026-01-20', followUpDate: '2026-01-10',
    followUpNote: 'call', terms: { payment: '50% down' }, preparedBy: 'JT', submittedBy: 'Engr. X',
    history: [{ status: 'won' }] };
  let n = 0;
  const newId = () => 'x' + (++n);
  const d = M.qtDuplicateOf(past, blank(), newId);

  test('duplicate: client fields stay blank', () => {
    eq(d.clientName, ''); eq(d.clientEmail, ''); eq(d.clientAddress, '');
  });
  test('duplicate: new number, rev 1, fresh dates, unsaved draft', () => {
    eq(d.id, null); eq(d.quoteNo, 'Q-NEW'); eq(d.revNo, 1);
    eq(d.quoteDate, '2026-10-16'); eq(d.validUntil, '2026-11-15');
    eq(d.status, 'draft'); eq(d.statusNote, ''); eq(d.decidedAt, null);
    eq(d.followUpDate, ''); eq(d.followUpNote, ''); eq(d.history.length, 0);
  });
  test('duplicate: work, terms, images, discount/VAT and print options copied', () => {
    eq(d.projectName, '2-storey house'); eq(d.location, 'Cavite'); eq(d.area, '120 sqm');
    eq(d.subject, 'Estimate'); eq(d.scopeNote, 'note');
    eq(d.terms.payment, '50% down'); eq(d.images.length, 1); eq(d.images[0].url, 'u1');
    eq(d.discount, 100); eq(d.vatMode, 'exclusive');
    eq(d.showLinePricing, false); eq(d.showLogo, false);
    eq(d.preparedBy, 'JT'); eq(d.submittedBy, 'Engr. X');
  });
  test('duplicate: every node re-id\'d, removed lines left behind', () => {
    const s = d.sections[0], g = s.groups[0];
    ok(s.id !== 'S1' && g.id !== 'G1', 'section/group ids must be new');
    eq(g.lines.length, 2, 'removed line dropped');
    ok(g.lines.every(l => !['L1','L2','L3'].includes(l.id)), 'line ids must be new');
    eq(new Set([s.id, g.id, ...g.lines.map(l => l.id)]).size, 4, 'ids unique');
  });
  test('duplicate: total recomputed, source untouched', () => {
    eq(d.totalAmount, M.qtGrandTotal(d));
    eq(past.sections[0].id, 'S1'); eq(past.sections[0].groups[0].lines.length, 3);
    eq(past.clientName, 'Old Client');
  });
}

// Bulk unit edits must respect group/quotation boundaries and Undo must not
// overwrite a later manual edit. Run the live module with no DOM or database.
function unitEditor() {
  const app = { document: { getElementById: () => null } };
  app.window = app;
  require('vm').runInNewContext(src, app);
  const makeLine = (id, unit) => ({ id, unit, qty: 2, unitPrice: 150, state: 'normal' });
  const a = makeLine('a', 'set'), b = makeLine('b', 'sqm'), c = makeLine('c', 'lot');
  const d = makeLine('d', 'bag'), e = makeLine('e', 'pc');
  const q = { sections: [
    { groups: [{ unit: 'heading', lines: [a, b, c] }, { unit: 'set', lines: [d] }] },
    { groups: [{ unit: 'lot', lines: [e] }] }
  ] };
  app.qtState.current = q;
  return { app, q, a, b, c, d, e };
}

console.log('\n── Bulk quotation units ──');
test('changing a unit updates only that item until a scope is chosen', () => {
  const { app, a, b, d } = unitEditor();
  app.qtChangeLineUnit(0, 0, 0, 'lot');
  eq(a.unit, 'lot'); eq(b.unit, 'sqm'); eq(d.unit, 'bag');
  eq(app.qtState.isDirty, true);
});
test('keep this item only dismisses the pending bulk change', () => {
  const { app, a, b } = unitEditor();
  app.qtChangeLineUnit(0, 0, 0, 'lot');
  app.qtDismissUnitPrompt();
  app.qtApplyUnit('all');
  eq(a.unit, 'lot'); eq(b.unit, 'sqm');
});
test('this group changes other items in that group and leaves headings intact', () => {
  const { app, q, a, b, c, d, e } = unitEditor();
  app.qtChangeLineUnit(0, 0, 0, 'lot');
  app.qtApplyUnit('group');
  eq(a.unit, 'lot'); eq(b.unit, 'lot'); eq(c.unit, 'lot');
  eq(d.unit, 'bag'); eq(e.unit, 'pc');
  eq(q.sections[0].groups[0].unit, 'heading');
  app.qtUndoUnits();
  eq(a.unit, 'lot', 'source selection stays'); eq(b.unit, 'sqm'); eq(c.unit, 'lot');
});
test('entire quotation crosses sections without changing quantities, prices or headings', () => {
  const { app, q, a, b, c, d, e } = unitEditor();
  app.qtChangeLineUnit(0, 0, 0, 'lot');
  app.qtApplyUnit('all');
  for (const item of [a, b, c, d, e]) {
    eq(item.unit, 'lot'); eq(item.qty, 2); eq(item.unitPrice, 150); eq(item.state, 'normal');
  }
  eq(q.sections[0].groups[1].unit, 'set');
  eq(q.sections[1].groups[0].unit, 'lot');
});
test('undo restores custom, blank and missing units exactly', () => {
  const { app, b, d, e } = unitEditor();
  b.unit = 'custom unit'; d.unit = ''; delete e.unit;
  app.qtChangeLineUnit(0, 0, 0, 'lot');
  app.qtApplyUnit('all');
  app.qtUndoUnits();
  eq(b.unit, 'custom unit'); eq(d.unit, ''); eq(Object.hasOwn(e, 'unit'), false);
});
test('undo keeps later manual unit edits and skips deleted rows after reordering', () => {
  const { app, q, b, d, e } = unitEditor();
  app.qtChangeLineUnit(0, 0, 0, 'lot');
  app.qtApplyUnit('all');
  app.qtChangeLineUnit(0, 0, 1, 'kg');
  app.qtChangeLineUnit(0, 0, 1, 'lot');
  q.sections.reverse();
  q.sections[1].groups[1].lines = [];
  app.qtUndoUnits();
  eq(b.unit, 'lot', 'manual re-selection is kept'); eq(d.unit, 'lot', 'detached row is untouched');
  eq(e.unit, 'pc');
});
test('a stale prompt or undo never changes another quotation', () => {
  const { app, b } = unitEditor();
  app.qtChangeLineUnit(0, 0, 0, 'lot');
  const other = { sections: [{ groups: [{ lines: [{ unit: 'bag' }] }] }] };
  app.qtState.current = other;
  app.qtApplyUnit('all');
  eq(other.sections[0].groups[0].lines[0].unit, 'bag'); eq(b.unit, 'sqm');
  const second = unitEditor();
  second.app.qtChangeLineUnit(0, 0, 0, 'lot');
  second.app.qtApplyUnit('all');
  second.app.qtState.current = other;
  second.app.qtUndoUnits();
  eq(other.sections[0].groups[0].lines[0].unit, 'bag'); eq(second.b.unit, 'lot');
});
test('deleting the prompt source cancels the bulk action', () => {
  const { app, q, b, d } = unitEditor();
  app.qtChangeLineUnit(0, 0, 0, 'lot');
  q.sections[0].groups[0].lines.shift();
  app.qtApplyUnit('all');
  eq(b.unit, 'sqm'); eq(d.unit, 'bag');
});

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
