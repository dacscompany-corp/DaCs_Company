// ════════════════════════════════════════════════════════════════════
// STAFF PAYROLL PERIOD:  node tests/staff-payroll-period.test.js
//
// Staff can't read billing budgets (every period reads ₱0 to them), so the
// Add Payroll form sees nothing fundable and falls back to one period. That
// period must be a CLIENT-funded one — the payment's month if there is one,
// else the latest — never the Cover period by accident of sort order. The
// owner's fallback is unchanged. Runs the live _payStaffPeriodId.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'expenses-module.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(a, b, m) { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function slice(start, end) {
  const i = src.indexOf(start); if (i < 0) throw new Error('SLICE NOT FOUND: ' + start);
  const j = src.indexOf(end, i); if (j < 0) throw new Error('SLICE NOT FOUND: ' + end);
  return src.slice(i, j);
}
const code = slice('const _PAY_MONTH_NAMES', 'function _payPeriodDate') + slice('function _payStaffPeriodId', 'async function handleAddPayroll');
function run(role, current, projects, payDate) {
  const window = { currentUserRole: role };
  const document = { getElementById: id => id === 'payDate' ? { value: payDate || '' } : null };
  return new Function('window', 'document', 'expCurrentProject', 'expProjects', code + '\nreturn _payStaffPeriodId();')(
    window, document, current, projects);
}
const periods = [
  { id: 'mob', folderId: 'f', month: 'October', year: 2026, fundingType: 'mobilization' },
  { id: 'cov', folderId: 'f', month: 'October', year: 2026, fundingType: 'president' },
  { id: 'sep', folderId: 'f', month: 'September', year: 2026, fundingType: 'progress', billingNumber: 1 },
  { id: 'nov', folderId: 'f', month: 'November', year: 2026, fundingType: 'progress', billingNumber: 2 },
  { id: 'other', folderId: 'g', month: 'December', year: 2026, fundingType: 'progress' },
];

test('owner keeps the active period (unchanged)', () => {
  eq(run('owner', { id: 'cov', folderId: 'f' }, periods, '2026-10-05'), 'cov');
});
test('staff: the payment month picks that month\'s client-funded period, never Cover', () => {
  eq(run('staff', { id: 'cov', folderId: 'f' }, periods, '2026-10-05'), 'mob');
});
test('staff: no date → the latest client-funded period of this project', () => {
  eq(run('staff', { id: 'cov', folderId: 'f' }, periods, ''), 'nov');
});
test('staff: a month with no client period → the latest client-funded period', () => {
  eq(run('staff', { id: 'cov', folderId: 'f' }, periods, '2027-02-01'), 'nov');
});
test('staff: only a Cover period → stays on it', () => {
  eq(run('staff', { id: 'cov', folderId: 'f' }, [periods[1]], '2026-10-05'), 'cov');
});
test('staff: another project\'s periods are never picked', () => {
  eq(run('staff', { id: 'cov', folderId: 'f' }, periods, '2026-12-01'), 'nov');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
