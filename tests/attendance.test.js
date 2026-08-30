// ════════════════════════════════════════════════════════════════════
// ATTENDANCE REPORT TESTS — run with:  node tests/attendance.test.js
//
// Zero dependencies, no framework. Feeds known inputs into the REAL
// functions, extracted from js/attendance-admin.js at run time (never a
// copy), and fails loudly if a rule breaks.
//
// The rules under guard:
//   1. Hours come from total_minutes ONLY. An open day (no Time Out) is
//      a day worked with zero hours — never a figure invented from a
//      clock, because a report must not state something the database
//      has not agreed to.
//   2. Attendance hours are NOT pay. There is no rate anywhere in here,
//      and there must never be one: DAC's labour is pakyaw, capped by
//      labor_contracts.agreed_amount.
//   3. CSV cells starting = + - @ are neutralised. Excel executes those
//      as formulas, and a project name is attacker-adjacent text.
//   4. Quotes and newlines inside a cell are escaped, not stripped —
//      a worker's description can contain both.
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
  if (actual !== expected) {
    throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }

function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/attendance.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}
function evalWith(src, ctx, names) {
  const fn = new Function('ctx', 'with(ctx){' + src + '\n; return {' + names.join(',') + '};}');
  return fn(ctx);
}

const src = read('js/attendance-admin.js');
const M = evalWith(
  slice(src, '// ==== ATT REPORT ENGINE START ====', '// ==== ATT REPORT ENGINE END ====', 'attendance-admin.js'),
  { window: {} },
  ['attFormatHours', 'attRollUpByWorker', 'attRollUpByProject', 'attCsvCell', 'attToCsv']
);

const rec = (o) => Object.assign({
  worker_id: 'w1', worker_name: 'Juan dela Cruz', worker_position: 'Mason',
  timein_project_name: 'ABC Building Project', total_minutes: 480
}, o);

console.log('\nI. Hours');

test('the MVP example formats as 9h 45m', () => {
  eq(M.attFormatHours(585), '9h 45m');
});

test('nothing recorded is a dash, not a zero', () => {
  // "0h 0m" claims they worked nothing. A dash says we have no figure.
  eq(M.attFormatHours(null), '—');
  eq(M.attFormatHours(undefined), '—');
});

test('a whole number of hours still shows minutes', () => {
  eq(M.attFormatHours(480), '8h 0m');
});

console.log('\nII. Roll-up per worker');

test('days and hours add up across a worker\'s records', () => {
  const rows = M.attRollUpByWorker([rec({ total_minutes: 585 }), rec({ total_minutes: 480 })]);
  eq(rows.length, 1);
  eq(rows[0].daysWorked, 2);
  eq(rows[0].totalMinutes, 1065);
  eq(M.attFormatHours(rows[0].totalMinutes), '17h 45m');
});

test('an open day counts as worked but adds no hours', () => {
  // total_minutes is null until Time Out. Counting it as worked is
  // right; guessing its hours would put a number in a report that the
  // server never computed.
  const rows = M.attRollUpByWorker([rec({ total_minutes: 585 }), rec({ total_minutes: null })]);
  eq(rows[0].daysWorked, 2);
  eq(rows[0].totalMinutes, 585);
  eq(rows[0].openDays, 1, 'open days are counted so the report can flag them');
});

test('two workers stay separate and sort by name', () => {
  const rows = M.attRollUpByWorker([
    rec({ worker_id: 'w2', worker_name: 'Zeny Ramos' }),
    rec({ worker_id: 'w1', worker_name: 'Ana Cruz' })
  ]);
  eq(rows.length, 2);
  eq(rows[0].name, 'Ana Cruz');
  eq(rows[1].name, 'Zeny Ramos');
});

console.log('\nIII. Roll-up per project');

test('records group by the SNAPSHOTTED project name', () => {
  // The name on the record, not the project row: a project renamed
  // later must not silently rewrite what past attendance says.
  const rows = M.attRollUpByProject([
    rec({ timein_project_name: 'ABC Building Project' }),
    rec({ timein_project_name: 'ABC Building Project' }),
    rec({ timein_project_name: 'Residential Project' })
  ]);
  eq(rows.length, 2);
  eq(rows[0].project, 'ABC Building Project');
  eq(rows[0].daysWorked, 2);
  eq(rows[1].daysWorked, 1);
});

console.log('\nIV. CSV safety');

test('a cell starting with = is neutralised', () => {
  // Excel would run it. A project name is user-entered text.
  eq(M.attCsvCell('=cmd|calc'), "'=cmd|calc");
});

test('+ - @ are neutralised too', () => {
  eq(M.attCsvCell('+1'), "'+1");
  eq(M.attCsvCell('-1+2'), "'-1+2");
  eq(M.attCsvCell('@SUM(A1)'), "'@SUM(A1)");
});

test('an ordinary name is untouched', () => {
  eq(M.attCsvCell('ABC Building Project'), 'ABC Building Project');
});

test('commas and quotes are escaped, not stripped', () => {
  eq(M.attCsvCell('Cruz, Juan'), '"Cruz, Juan"');
  eq(M.attCsvCell('He said "go"'), '"He said ""go"""');
});

test('a newline inside a description survives as one cell', () => {
  // Workers do press enter in the description box.
  const cell = M.attCsvCell('Gate 2\nmay delivery');
  ok(cell.startsWith('"') && cell.endsWith('"'), 'must be quoted: ' + cell);
  ok(cell.indexOf('\n') !== -1, 'the newline is kept, not removed');
});

test('a whole file has a header row and CRLF endings', () => {
  const csv = M.attToCsv(['Worker', 'Hours'], [['Ana Cruz', '8h 0m']]);
  eq(csv, 'Worker,Hours\r\nAna Cruz,8h 0m');
});

console.log('\n──────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log('Attendance reports state only what the database computed.');
