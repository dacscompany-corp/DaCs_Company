// ════════════════════════════════════════════════════════════════════
// REQUESTS ADMIN TESTS: run with  node tests/requests-admin.test.js
//
// Zero dependencies. Loads the REAL js/requests-admin-core.js (it exports
// its pure half under Node) and guards what the office reads on screen:
//   1. Manila dates — the cutoff is Saturday 12:00 noon Asia/Manila, and a
//      browser in another time zone must still show Manila time.
//   2. Line states — what "needs action" means (conflict, reduction,
//      nothing or part arranged), so nothing waiting is hidden.
//   3. Queue order — urgent first (earliest needed-by), then by batch.
//   4. Server error codes become sentences an office user can act on.
// ════════════════════════════════════════════════════════════════════
'use strict';
const ra = require('../js/requests-admin-core.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || '') + ' expected ' + b + ', got ' + a);
}

const portion = (o) => Object.assign({ id: 'p', batch_id: 'b1', quantity: 10, pending_reduction: 0, arranged: false,
  cutoff_at: '2026-10-10T04:00:00+00:00', purchase_on: '2026-10-12', delivery_on: '2026-10-14' }, o);
const line = (o) => Object.assign({ id: 'l', status: 'open', urgent: false, needed_by: null, portions: [portion({})], open_conflicts: [],
  description: 'PVC pipe', spec: '1/2 in', unit: 'pc', catalog_name: null }, o);
const req = (o) => Object.assign({ id: 'r', received_at: '2026-10-05T01:00:00+00:00', requester_name: 'Juan', project_name: 'Site A',
  work_name: 'Main Contract', team_name: null, lines: [line({})] }, o);

console.log('\nrequests-admin: dates (Asia/Manila)');

test('formatManila shows Manila time whatever the machine zone', () => {
  eq(ra.formatManila('2026-10-03T03:58:00Z'), 'Sat 3 Oct 2026, 11:58 AM');
  eq(ra.formatManila('2026-10-03T16:05:00Z'), 'Sun 4 Oct 2026, 12:05 AM');
  eq(ra.formatManila('not a date'), '—');
});

test('cutoffLabel says "12:00 noon" for the weekly cutoff', () => {
  eq(ra.cutoffLabel('2026-10-10T04:00:00+00:00'), 'Sat 10 Oct, 12:00 noon');
  eq(ra.cutoffLabel('2026-10-10T12:00:00+08:00'), 'Sat 10 Oct, 12:00 noon');
});

test('formatDay reads a date-only value without shifting it', () => {
  eq(ra.formatDay('2026-10-12'), 'Mon 12 Oct');
  eq(ra.formatDay('2026-10-14'), 'Wed 14 Oct');
  eq(ra.formatDay(''), '—');
  eq(ra.formatDay(null), '—');
});

test('shortDay is the Manila calendar day of an instant', () => {
  eq(ra.shortDay('2026-10-09T17:00:00Z'), 'Sat 10 Oct');
});

test('batchLabel', () => {
  eq(ra.batchLabel({ cutoff_at: '2026-10-10T04:00:00+00:00', purchase_on: '2026-10-12', delivery_on: '2026-10-14' }),
     'Cutoff Sat 10 Oct, 12:00 noon · Buy Mon 12 Oct · Deliver Wed 14 Oct');
});

console.log('\nrequests-admin: quantities and input');

test('formatQty trims zeros and groups thousands', () => {
  eq(ra.formatQty(10), '10');
  eq(ra.formatQty('2.500'), '2.5');
  eq(ra.formatQty(1.125), '1.125');
  eq(ra.formatQty(1000000), '1,000,000');
  eq(ra.formatQty(null), '—');
});

test('parseQty accepts what the server accepts and nothing else', () => {
  eq(ra.parseQty(' 12 '), 12);
  eq(ra.parseQty('2.125'), 2.125);
  eq(ra.parseQty('1000000'), 1000000);
  eq(ra.parseQty('0'), null);
  eq(ra.parseQty('-1'), null);
  eq(ra.parseQty('1.2345'), null);
  eq(ra.parseQty('1000001'), null);
  eq(ra.parseQty('abc'), null);
  eq(ra.parseQty(''), null);
});

test('validateDates: delivery may equal but never precede purchasing', () => {
  eq(ra.validateDates('2026-10-12', '2026-10-14'), null);
  eq(ra.validateDates('2026-10-12', '2026-10-12'), null);
  eq(typeof ra.validateDates('2026-10-12', '2026-10-11'), 'string');
  eq(typeof ra.validateDates('', '2026-10-11'), 'string');
});

console.log('\nrequests-admin: line states');

test('lineState covers every case, conflicts first', () => {
  eq(ra.lineState(line({})), 'unarranged');
  eq(ra.lineState(line({ portions: [portion({ arranged: true })] })), 'arranged');
  eq(ra.lineState(line({ portions: [portion({ arranged: true }), portion({ id: 'p2' })] })), 'partly');
  eq(ra.lineState(line({ portions: [portion({ arranged: true, pending_reduction: 2 })] })), 'reduction');
  eq(ra.lineState(line({ status: 'cancelled', portions: [] })), 'cancelled');
  eq(ra.lineState(line({ status: 'cancelled', portions: [portion({ arranged: true, pending_reduction: 10 })] })), 'reduction',
     'a cancelled line with arranged quantity still needs the office');
  eq(ra.lineState(line({ open_conflicts: [{ id: 'k' }], portions: [portion({ arranged: true, pending_reduction: 2 })] })), 'conflict');
});

test('needsAction is true for conflict, reduction, unarranged and partly', () => {
  eq(ra.needsAction(line({})), true);
  eq(ra.needsAction(line({ portions: [portion({ arranged: true })] })), false);
  eq(ra.needsAction(line({ status: 'cancelled', portions: [] })), false);
  eq(Object.keys(ra.STATE_LABEL).sort(), ['arranged', 'cancelled', 'conflict', 'partly', 'reduction', 'unarranged']);
  eq(Object.keys(ra.STATE_PILL).sort(), Object.keys(ra.STATE_LABEL).sort());
});

test('requestSummary', () => {
  const s = ra.requestSummary(req({ lines: [
    line({ id: 'a', urgent: true, needed_by: '2026-10-08' }),
    line({ id: 'b', urgent: true, needed_by: '2026-10-06', portions: [portion({ batch_id: 'b2', cutoff_at: '2026-10-03T04:00:00+00:00' })] }),
    line({ id: 'c', status: 'cancelled', urgent: true, needed_by: '2026-10-01', portions: [] }),
    line({ id: 'd', open_conflicts: [{ id: 'k' }] }),
  ] }));
  eq(s.urgent, true);
  eq(s.neededBy, '2026-10-06', 'a cancelled urgent line does not count');
  eq([s.openLines, s.totalLines, s.actionLines, s.conflicts, s.reductions], [3, 4, 3, 1, 0]);
  eq(s.firstCutoff, '2026-10-03T04:00:00+00:00');
  eq(s.batchIds.sort(), ['b1', 'b2']);
});

test('a cancelled line with a reduction to resolve keeps its batch and cutoff', () => {
  const s = ra.requestSummary(req({ lines: [line({ status: 'cancelled', portions: [portion({
    batch_id: 'b7', arranged: true, pending_reduction: 4, cutoff_at: '2026-10-03T04:00:00+00:00' })] })] }));
  eq(s.batchIds, ['b7']);
  eq(s.firstCutoff, '2026-10-03T04:00:00+00:00');
  eq([s.openLines, s.actionLines, s.reductions], [0, 1, 1]);
});

console.log('\nrequests-admin: queue');

test('sortQueue: urgent first by needed-by, then by first open batch, then oldest first', () => {
  const out = ra.sortQueue([
    req({ id: 'late-batch', lines: [line({ portions: [portion({ cutoff_at: '2026-10-17T04:00:00+00:00' })] })] }),
    req({ id: 'urgent-later', lines: [line({ urgent: true, needed_by: '2026-10-09' })] }),
    req({ id: 'old', received_at: '2026-10-04T01:00:00+00:00' }),
    req({ id: 'urgent-sooner', lines: [line({ urgent: true, needed_by: '2026-10-07' })] }),
    req({ id: 'new' }),
  ]);
  eq(out.map(r => r.id), ['urgent-sooner', 'urgent-later', 'old', 'new', 'late-batch']);
});

test('filterQueue: text, batch and needs-action', () => {
  const list = [
    req({ id: '1', requester_name: 'Pedro Santos' }),
    req({ id: '2', lines: [line({ description: 'Cement', portions: [portion({ batch_id: 'b9', arranged: true })] })] }),
  ];
  eq(ra.filterQueue(list, { text: 'pedro' }).map(r => r.id), ['1']);
  eq(ra.filterQueue(list, { text: 'CEMENT' }).map(r => r.id), ['2']);
  eq(ra.filterQueue(list, { batchId: 'b9' }).map(r => r.id), ['2']);
  eq(ra.filterQueue(list, { actionOnly: true }).map(r => r.id), ['1']);
  eq(ra.filterQueue(list, {}).length, 2);
});

console.log('\nrequests-admin: history and errors');

test('eventText covers every 0085 and 0086 event kind', () => {
  const kinds = ['submitted', 'quantity_changed', 'quantity_conflict', 'line_cancelled', 'request_cancelled', 'photo_attached',
    'portion_arranged', 'portion_unarranged', 'reduction_resolved', 'office_quantity_changed', 'office_line_cancelled',
    'conflict_resolved', 'item_matched', 'portion_moved'];
  for (const k of kinds) {
    const t = ra.eventText({ kind: k, detail: { from: 1, to: 2, proposed: 3, current: 4, quantity: 5, outcome: 'order_reduced', reason: 'r', applied: true, catalog_item_id: 'x' } });
    if (!t || t === k) throw new Error('no text for ' + k);
  }
  eq(ra.eventText({ kind: 'office_quantity_changed', detail: { from: 10, to: 8, reason: 'recount' } }), 'Office changed the quantity 10 → 8 — recount');
  eq(ra.eventText({ kind: 'reduction_resolved', detail: { quantity: 6, outcome: 'kept_as_surplus', note: null } }), 'Kept 6 as surplus');
  eq(ra.eventText({ kind: 'something_new', detail: {} }), 'something_new');
});

test('errorMessage maps every 0086 code and never matches a code inside another', () => {
  const codes = ['OFFICE_ONLY', 'NOT_FOUND', 'LINE_CLOSED', 'REDUCTION_PENDING', 'NOTHING_PENDING', 'ALREADY_RESOLVED', 'BAD_QUANTITY',
    'REASON_REQUIRED', 'BAD_CATALOG_ITEM', 'BAD_BATCH', 'BAD_DATES', 'ARRANGED', 'NOT_A_TEAM_LEADER', 'NOT_IN_TEAM', 'DUPLICATE_ITEM',
    'DUPLICATE_TEAM', 'BAD_ITEM', 'BAD_OUTCOME', 'BAD_TEAM', 'BAD_WORKER'];
  eq(Object.keys(ra.ERRORS).sort(), codes.slice().sort());
  for (const c of codes) eq(ra.errorMessage({ message: c }), ra.ERRORS[c], c);
  eq(ra.errorMessage({ message: 'BAD_CATALOG_ITEM' }), ra.ERRORS.BAD_CATALOG_ITEM);
  eq(ra.errorMessage({ message: 'NOT_A_TEAM_LEADER' }), ra.ERRORS.NOT_A_TEAM_LEADER);
  eq(ra.errorMessage({ message: 'boom' }), 'Something went wrong: boom');
  eq(ra.errorMessage(null), 'Something went wrong: unknown error');
});

console.log('\nrequests-admin: people');

test('workerNo is the W-0007 roster number, blank when unknown', () => {
  eq(ra.workerNo(7), 'W-0007');
  eq(ra.workerNo('21'), 'W-0021');
  eq(ra.workerNo(12345), 'W-12345');
  eq(ra.workerNo(null), '');
  eq(ra.workerNo(undefined), '');
  eq(ra.workerNo(0), '');
});

console.log('\nrequests-admin: catalogue');

test('itemLabel and catalogMatches (active, same kind, text)', () => {
  const items = [
    { id: '1', kind: 'material', name: 'PVC pipe', spec: '1/2 in', unit: 'pc', category: 'plumbing', active: true },
    { id: '2', kind: 'material', name: 'PVC elbow', spec: '', unit: 'pc', category: 'plumbing', active: false },
    { id: '3', kind: 'tool', name: 'Pipe wrench', spec: '14 in', unit: 'pc', category: '', active: true },
    { id: '4', kind: 'material', name: 'Cement', spec: '40 kg', unit: 'bag', category: 'masonry', active: true },
  ];
  eq(ra.itemLabel(items[0]), 'PVC pipe · 1/2 in (pc)');
  eq(ra.itemLabel(items[1]), 'PVC elbow (pc)');
  eq(ra.catalogMatches(items, 'material', '').map(i => i.id), ['4', '1']);
  eq(ra.catalogMatches(items, 'material', 'pipe').map(i => i.id), ['1']);
  eq(ra.catalogMatches(items, 'tool', 'pipe').map(i => i.id), ['3']);
  eq(ra.catalogMatches(items, 'material', 'plumb').map(i => i.id), ['1']);
});

// ── SUMMARY (keep last) ──
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
