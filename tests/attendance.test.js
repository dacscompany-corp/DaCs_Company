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
  ['attFormatHours', 'attRollUpByWorker', 'attRollUpByProject', 'attCsvCell', 'attToCsv',
   'attWorkerNameKey', 'attWorkerRoster', 'attValidateNewWorker',
   'attValidateEditWorker', 'attSplitName', 'attCanAbandon', 'attOpenRecords']
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
// ── A3 · Worker management roster ──────────────────────────────────
//
// A3 is NOT A1 with a different table. A1 answers "who is on site today"
// and lists active workers only; A3 is where a worker is deactivated and
// reactivated, so it MUST show the deactivated ones. A roster that hides
// them is a one-way door: the button that brings someone back sits on the
// screen that refuses to display them.

test('A3 keeps deactivated workers -- otherwise nobody can be reactivated', () => {
  const rows = M.attWorkerRoster([
    { id: '1', display_name: 'Ana Cruz',  role: 'worker', status: 'active'   },
    { id: '2', display_name: 'Ben Reyes', role: 'worker', status: 'inactive' },
  ]);
  eq(rows.length, 2, 'both rows survive');
  ok(rows.some(r => r.id === '2'), 'the deactivated worker is still listed');
});

test("a missing status counts as active, matching coalesce(status,'active')", () => {
  // Older profiles rows carry no status. The RPCs and attendance-signin
  // both treat that as active; this screen must not disagree.
  const rows = M.attWorkerRoster([{ id: '1', display_name: 'Ana', role: 'worker' }]);
  eq(rows.length, 1);
  eq(rows[0]._active, true, 'no status => active');
});

test('only worker and teamLeader appear -- never clients, staff or owners', () => {
  const rows = M.attWorkerRoster([
    { id: '1', display_name: 'Ana',   role: 'worker'     },
    { id: '2', display_name: 'Lead',  role: 'teamLeader' },
    { id: '3', display_name: 'Boss',  role: 'owner'      },
    { id: '4', display_name: 'Staff', role: 'staff'      },
    { id: '5', display_name: 'Cli',   role: 'client'     },
  ]);
  eq(rows.map(r => r.id).join(','), '1,2', 'teamLeader records attendance; the rest do not');
});

test('active sort above deactivated, then by name', () => {
  const rows = M.attWorkerRoster([
    { id: '1', display_name: 'Zoe', role: 'worker', status: 'inactive' },
    { id: '2', display_name: 'Ben', role: 'worker', status: 'active'   },
    { id: '3', display_name: 'Ana', role: 'worker', status: 'active'   },
  ]);
  eq(rows.map(r => r.display_name).join(','), 'Ana,Ben,Zoe');
});

test('the sort key falls back email-local then worker number, like the name does', () => {
  // profiles rows predating display_name really exist (W-0001, W-0002).
  eq(M.attWorkerNameKey({ display_name: 'Ana Cruz' }), 'ana cruz');
  eq(M.attWorkerNameKey({ email: 'tjohnaerol@gmail.com' }), 'tjohnaerol');
  eq(M.attWorkerNameKey({ worker_no: 1 }), 'w-0001');
});

console.log('\n──────────────────────────────────────');

// A4 creates a real auth account through the admin-create-user Edge
// Function. The rules that matter are the ones that decide WHO gets an
// account and WHAT is sent -- everything below is pinned because getting
// it wrong mints a privileged or unreachable account.

const nw = (o) => Object.assign({
  firstName: 'Juan', lastName: 'dela Cruz', email: 'juan@dacsbuilding.com',
  role: 'worker', position: 'Mason', password: 'sikreto123', confirm: 'sikreto123'
}, o);

test('A4 accepts a complete worker', () => {
  const r = M.attValidateNewWorker(nw());
  ok(r.valid, 'a filled form is valid');
  eq(Object.keys(r.errors).length, 0);
});

test('A4 mints workers and team leaders ONLY -- never staff, engineer or owner', () => {
  // The whole point of the worker-only role list. Users -> Navigator is
  // where privileged accounts are made, behind its own form; a second,
  // less-guarded route to one is exactly what this must not become.
  ok(M.attValidateNewWorker(nw({ role: 'worker'     })).valid);
  ok(M.attValidateNewWorker(nw({ role: 'teamLeader' })).valid);
  ['staff', 'engineer', 'owner', 'client', ''].forEach(role => {
    const r = M.attValidateNewWorker(nw({ role }));
    ok(!r.valid, role + ' must be rejected');
    ok(!!r.errors.role, role + ' must be rejected on the role field');
  });
});

test('A4 lowercases the email -- a case mismatch orphans the profile', () => {
  // Login returns a lowercased email. If the profile stores "Juan@..."
  // the account and its profile stop finding each other.
  eq(M.attValidateNewWorker(nw({ email: '  JUAN@Dacsbuilding.COM  ' })).payload.email,
     'juan@dacsbuilding.com');
});

test('A4 rejects a malformed email', () => {
  // worker2@dacsbuilding (no TLD) is really in the live roster.
  ok(!M.attValidateNewWorker(nw({ email: 'worker2@dacsbuilding' })).valid);
  ok(!M.attValidateNewWorker(nw({ email: 'nope' })).valid);
});

test('A4 enforces 8 characters and a matching confirmation', () => {
  ok(!M.attValidateNewWorker(nw({ password: 'short1', confirm: 'short1' })).valid);
  const mismatch = M.attValidateNewWorker(nw({ confirm: 'sikreto124' }));
  ok(!mismatch.valid);
  ok(!!mismatch.errors.confirm, 'the mismatch is reported on the confirm field');
});

test('A4 requires both names', () => {
  ok(!!M.attValidateNewWorker(nw({ firstName: '   ' })).errors.firstName);
  ok(!!M.attValidateNewWorker(nw({ lastName:  ''    })).errors.lastName);
});

test('A4 leaves position optional -- a trade may not be decided yet', () => {
  // Blocking on it would make an otherwise valid worker uncreatable,
  // and they still need to be able to time in.
  const r = M.attValidateNewWorker(nw({ position: '' }));
  ok(r.valid, 'no position is still a valid worker');
  eq(r.payload.position, '');
});

test('A4 never sends worker_no -- the 0050 trigger assigns it', () => {
  // profiles_worker_no_trg pulls from worker_no_seq on insert. A number
  // chosen in the browser races every other admin creating a worker.
  const r = M.attValidateNewWorker(nw());
  eq(r.payload.worker_no, undefined);
  eq(r.payload.workerNo,  undefined);
});

test('A4 sends no role the Edge Function would refuse to gate', () => {
  // kind is always 'admin' for these; role is the only thing separating a
  // worker from an engineer, so an empty role must never reach the wire.
  eq(M.attValidateNewWorker(nw({ role: '' })).valid, false);
});

console.log('\nVI. A3b - editing an existing worker');

const ew = (o) => Object.assign({
  firstName: 'Juan', lastName: 'Dela Cruz', position: 'Mason', status: 'active'
}, o);

test('A3b accepts a complete edit', () => {
  const r = M.attValidateEditWorker(ew());
  ok(r.valid, JSON.stringify(r.errors));
  eq(r.payload.display_name, 'Juan Dela Cruz');
  eq(r.payload.first_name, 'Juan');
  eq(r.payload.last_name, 'Dela Cruz');
});

test('A3b requires both names -- a nameless row renders as a worker number', () => {
  ok(!!M.attValidateEditWorker(ew({ firstName: '   ' })).errors.firstName);
  ok(!!M.attValidateEditWorker(ew({ lastName:  ''    })).errors.lastName);
});

test('A3b keeps display_name in step with its parts', () => {
  const r = M.attValidateEditWorker(ew({ firstName: 'Ana', lastName: 'Reyes' }));
  eq(r.payload.display_name, 'Ana Reyes');
});

test('A3b sends NO role -- profiles_guard (0019) rejects worker role changes', () => {
  const p = M.attValidateEditWorker(ew({ role: 'teamLeader' })).payload;
  eq(p.role, undefined);
  eq(p.owner_id, undefined);
});

test('A3b sends no email or password -- those live on the auth user', () => {
  const p = M.attValidateEditWorker(ew({ email: 'x@y.com', password: 'sikreto123' })).payload;
  eq(p.email, undefined);
  eq(p.password, undefined);
});

test('A3b stores an empty position as null, never an empty string', () => {
  eq(M.attValidateEditWorker(ew({ position: '   ' })).payload.position, null);
});

test('A3b accepts only the two real statuses', () => {
  ok(M.attValidateEditWorker(ew({ status: 'active'   })).valid);
  ok(M.attValidateEditWorker(ew({ status: 'inactive' })).valid);
  ok(!M.attValidateEditWorker(ew({ status: 'archived' })).valid);
});

test('A3b prefers the stored first_name/last_name over any guessing', () => {
  const n = M.attSplitName({ first_name: 'Ana', last_name: 'Reyes', display_name: 'WRONG NAME' });
  eq(n.firstName, 'Ana');
  eq(n.lastName, 'Reyes');
});

test('A3b splits a legacy display_name on the LAST token', () => {
  // "given + middle + surname" is the case this gets right.
  eq(M.attSplitName({ display_name: 'John Aerol Tapales' }).firstName, 'John Aerol');
  eq(M.attSplitName({ display_name: 'John Aerol Tapales' }).lastName,  'Tapales');
  eq(M.attSplitName({ display_name: 'Ana Reyes' }).firstName, 'Ana');
  eq(M.attSplitName({ display_name: 'Ana Reyes' }).lastName,  'Reyes');
});

test('A3b splits a COMPOUND surname wrongly, on purpose and visibly', () => {
  // Pinned, not aspirational: no heuristic gets both this and the case
  // above right. The split is a prefill the admin corrects in the form,
  // so this is a known cost, not a silent bug.
  eq(M.attSplitName({ display_name: 'Juan Dela Cruz' }).firstName, 'Juan Dela');
  eq(M.attSplitName({ display_name: 'Juan Dela Cruz' }).lastName,  'Cruz');
});

test('A3b handles a single-word name without inventing a surname', () => {
  eq(M.attSplitName({ display_name: 'Madonna' }).firstName, 'Madonna');
  eq(M.attSplitName({ display_name: 'Madonna' }).lastName, '');
});

test('A3b survives a row with no name at all -- the W-000n case', () => {
  const n = M.attSplitName({});
  eq(n.firstName, '');
  eq(n.lastName, '');
  ok(!M.attValidateEditWorker(ew({ firstName: '', lastName: '' })).valid);
});

console.log('\nVII. Closing a forgotten Time Out (0061)');

// A worker who times in and never times out leaves a record on
// 'working' forever. attendance_abandon closes it WITHOUT inventing
// hours; the two functions below decide what the screen offers, and
// they must agree with the RPC's guards or the button lies.

const open = (o) => Object.assign({
  id: 'r1', worker_id: 'w1', worker_name: 'Juan dela Cruz',
  work_date: '2026-09-01', status: 'working', total_minutes: null,
  timein_project_name: 'ABC Building Project'
}, o);

const TODAY = '2026-09-04';

test('an open record from a past day can be closed', () => {
  const v = M.attCanAbandon(open(), TODAY);
  ok(v.can, v.reason);
});

test('a COMPLETE record is never closable -- it has a real Time Out', () => {
  // Overwriting one would destroy a captured event.
  const v = M.attCanAbandon(open({ status: 'complete', total_minutes: 585 }), TODAY);
  ok(!v.can);
  ok(/already|complete/i.test(v.reason), 'the reason names the real state: ' + v.reason);
});

test('an ALREADY abandoned record is not closable twice', () => {
  // A second close would overwrite the first one's trail.
  const v = M.attCanAbandon(open({ status: 'abandoned' }), TODAY);
  ok(!v.can);
});

test("TODAY's open record is refused -- that worker is probably on site", () => {
  // Closing it would delete a live day's Time Out before it happens:
  // attendance_time_out only closes rows on status 'working', so the
  // worker's app would then get NOT_TIMED_IN.
  const v = M.attCanAbandon(open({ work_date: TODAY }), TODAY);
  ok(!v.can);
  ok(/today/i.test(v.reason), 'the reason says why: ' + v.reason);
});

test('a FUTURE-dated record is refused too, not just today', () => {
  // Should not exist (CAPTURED_IN_FUTURE), but the guard is >=, and a
  // clock-skewed row must not become closable by being ahead.
  ok(!M.attCanAbandon(open({ work_date: '2026-09-05' }), TODAY).can);
});

test('a missing record is refused rather than throwing', () => {
  ok(!M.attCanAbandon(null, TODAY).can);
  ok(!M.attCanAbandon(undefined, TODAY).can);
});

console.log('\nVIII. The A6 open-records panel');

test('only WORKING records are listed -- abandoned ones are done', () => {
  // The filter is on status, NOT on a null timeout_at: abandoning
  // leaves timeout_at null forever, so a timeout_at test would keep
  // every resolved record on the list and the panel would never empty.
  const list = M.attOpenRecords([
    open({ id: 'a', status: 'working' }),
    open({ id: 'b', status: 'complete', total_minutes: 480 }),
    open({ id: 'c', status: 'abandoned' })
  ], TODAY);
  eq(list.map(r => r.id).join(','), 'a');
});

test('the oldest stuck record sorts first -- it is the most stale', () => {
  const list = M.attOpenRecords([
    open({ id: 'new', work_date: '2026-09-02' }),
    open({ id: 'old', work_date: '2026-08-11' }),
    open({ id: 'mid', work_date: '2026-09-01' })
  ], TODAY);
  eq(list.map(r => r.id).join(','), 'old,mid,new');
});

test("today's open records are listed but flagged not closable", () => {
  // Listed so the panel's count agrees with the "Missing time out"
  // stat; flagged so the screen explains the missing button instead of
  // silently dropping the row.
  const list = M.attOpenRecords([
    open({ id: 'past',  work_date: '2026-09-01' }),
    open({ id: 'today', work_date: TODAY })
  ], TODAY);
  eq(list.length, 2);
  eq(list.find(r => r.id === 'past')._closable, true);
  eq(list.find(r => r.id === 'today')._closable, false);
});

test('an empty or missing set is an empty list, never a crash', () => {
  eq(M.attOpenRecords([], TODAY).length, 0);
  eq(M.attOpenRecords(null, TODAY).length, 0);
});

console.log('\nIX. Abandoned days in the report roll-up');

test('an abandoned day is counted apart from a still-open one', () => {
  // Both have null hours, but they are different facts: one is waiting
  // to be resolved, the other has been. Reporting them under one
  // "not closed" heading would mean resolving a record changed nothing
  // on screen.
  const rows = M.attRollUpByWorker([
    rec({ total_minutes: 585, status: 'complete' }),
    rec({ total_minutes: null, status: 'working' }),
    rec({ total_minutes: null, status: 'abandoned' })
  ]);
  eq(rows[0].daysWorked, 3, 'all three are days the worker was present');
  eq(rows[0].totalMinutes, 585, 'neither null day invents hours');
  eq(rows[0].openDays, 1, 'only the working one is still open');
  eq(rows[0].abandonedDays, 1);
});

test('an abandoned day still adds NO hours', () => {
  // The whole premise: nobody knows when they left, so the report
  // never says. Closing the record must not conjure a figure.
  const rows = M.attRollUpByWorker([rec({ total_minutes: null, status: 'abandoned' })]);
  eq(rows[0].totalMinutes, 0);
  eq(M.attFormatHours(rows[0].totalMinutes), '0h 0m');
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log('Attendance reports state only what the database computed.');
