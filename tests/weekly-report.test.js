// Weekly report engine tests - run with:  node tests/weekly-report.test.js
// Zero dependencies. Requires js/weekly-report-data.js directly.
'use strict';
// The timezone must be set BEFORE the module loads, so wrTime proves Manila output.
process.env.TZ = 'America/Los_Angeles';
const W = require('../js/weekly-report-data.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
}
function eq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((msg ? msg + ': ' : '') + 'expected ' + y + ' got ' + x);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'not ok'); }

// ── helpers ─────────────────────────────────────────────────────────
const WEEK = '2026-11-16';
const TODAY = '2026-11-23';
function rec(o) {
  return Object.assign({
    id: 'r1', worker_id: 'w1', worker_name: 'Ana', worker_position: 'Mason', work_date: '2026-11-16',
    status: 'complete', timein_at: '2026-11-16T00:00:00Z', timein_project_system: 'pc',
    timein_folder_id: 'f1', timein_pm_project_id: null, timein_project_name: 'Site A',
    timein_photo_path: 'in.jpg', timein_description: null, timein_location_status: 'inside_radius',
    timein_is_mock: false, timein_was_offline: false, timeout_at: '2026-11-16T09:00:00Z',
    timeout_project_system: 'pc', timeout_folder_id: 'f1', timeout_pm_project_id: null,
    timeout_project_name: 'Site A', timeout_photo_path: 'out.jpg', timeout_extra_photo_paths: null,
    timeout_description: 'Did work', timeout_event_id: 'ev1', timeout_location_status: 'inside_radius',
    timeout_is_mock: false, timeout_was_offline: false, total_minutes: 540,
    abandoned_at: null, abandoned_note: null
  }, o || {});
}
function worker(o) {
  return Object.assign({ worker_id: 'w1', worker_no: 7, name: 'Ana', position: 'Mason',
    role: 'worker', active: true, in_roster: 'eligible' }, o || {});
}
function payload(o) {
  return Object.assign({ week_start: WEEK, week_end: '2026-11-22', history_starts_on: '2026-11-01',
    roster: [worker()], records: [], duties: [] }, o || {});
}

// ── tests ───────────────────────────────────────────────────────────
test('wrTime shows Manila: 2026-11-22T09:42:00Z -> 5:42 PM', () => {
  eq(W.wrTime('2026-11-22T09:42:00Z'), '5:42 PM');
  eq(W.wrTime(null), '—');
});

test('manila today ignores the browser', () => {
  eq(W.wrManilaTodayKey(Date.parse('2026-11-22T17:30:00Z')), '2026-11-23');
  eq(W.wrManilaTodayKey(Date.parse('2026-11-22T15:59:00Z')), '2026-11-22');
});

test('week start and days and label', () => {
  eq(W.wrWeekStart('2026-11-22'), '2026-11-16');
  eq(W.wrWeekStart('2026-11-23'), '2026-11-23');
  eq(W.wrWeekDays('2026-11-16')[6], '2026-11-22');
  eq(W.wrWeekDays('2026-11-16').length, 7);
  eq(W.wrWeekLabel('2026-11-16'), 'Mon 16 – Sun 22 Nov 2026');
  eq(W.wrDayLabel('2026-11-16'), 'Mon 16 Nov');
  eq(W.wrAddDays('2026-11-30', 1), '2026-12-01');
});

test('week labels across a month and a year', () => {
  eq(W.wrWeekLabel('2026-11-30'), 'Mon 30 Nov – Sun 6 Dec 2026');
  eq(W.wrWeekLabel('2026-12-28'), 'Mon 28 Dec 2026 – Sun 3 Jan 2027');
});

test('formatters', () => {
  eq(W.wrHoursText(1714), '28h 34m');
  eq(W.wrHoursText(null), '—');
  eq(W.wrWorkerNo(7), 'W-0007');
  eq(W.wrWorkerNo(null), '—');
  eq(W.wrTrade('Helper (Marc Kelley)'), 'Helper');
  eq(W.wrTrade('Mason'), 'Mason');
  eq(W.wrProjectKey('pc', 'x'), 'pc:x');
  eq(W.wrProjectKey('pm', 'x'), 'pm:x');
});

test('day status', () => {
  eq(W.wrDayStatus(null, '2026-11-25', TODAY), 'pending');
  eq(W.wrDayStatus(null, TODAY, TODAY), 'pending');
  eq(W.wrDayStatus(null, '2026-11-22', TODAY), 'none');
  eq(W.wrDayStatus({ status: 'working' }, TODAY, TODAY), 'working');
  eq(W.wrDayStatus({ status: 'working' }, '2026-11-22', TODAY), 'missing_timeout');
  eq(W.wrDayStatus({ status: 'abandoned' }, '2026-11-22', TODAY), 'admin_closed');
  eq(W.wrDayStatus({ status: 'complete' }, '2026-11-22', TODAY), 'complete');
  eq(W.WR_DAY_LABEL.none, 'No attendance recorded');
});

test('photos: first photo then extras, in order, once each', () => {
  const p = W.wrPhotos(rec({ timeout_photo_path: 'out-e1.jpg', timeout_extra_photo_paths: ['out-e1-2.jpg', 'out-e1-3.jpg'] }));
  eq(p.map(x => x.path), ['out-e1.jpg', 'out-e1-2.jpg', 'out-e1-3.jpg']);
  eq(p.map(x => x.label), ['Work photo 1 of 3', 'Work photo 2 of 3', 'Work photo 3 of 3']);
  ok(p.every(x => x.legacy === false));
});

test('photos: an old single-photo Time Out is labelled legacy', () => {
  const p = W.wrPhotos(rec({ timeout_photo_path: 'old.jpg', timeout_extra_photo_paths: null }));
  eq(p.length, 1);
  eq(p[0].label, 'Legacy Time Out photo - purpose not recorded');
  eq(p[0].legacy, true);
  eq(W.wrPhotos(rec({ timeout_photo_path: null })), []);
  eq(W.wrPhotos(rec({ timeout_extra_photo_paths: [] }))[0].legacy, true);
});

test('photos: null entries are kept', () => {
  const p = W.wrPhotos(rec({ timeout_photo_path: 'a.jpg', timeout_extra_photo_paths: [null] }));
  eq(p.length, 2);
  eq(p[1].path, null);
});

test('hours: 578 + 571 + 565 = 28h 34m; a day with no Time Out adds a day, not hours', () => {
  const recs = [
    rec({ id: 'a', work_date: '2026-11-16', total_minutes: 578 }),
    rec({ id: 'b', work_date: '2026-11-17', total_minutes: 571 }),
    rec({ id: 'c', work_date: '2026-11-18', total_minutes: 565 }),
    rec({ id: 'd', work_date: '2026-11-19', status: 'working', total_minutes: null, timeout_at: null })
  ];
  const e = W.wrBuildEmployees(payload({ records: recs }), TODAY)[0];
  eq(e.recordedDays, 4);
  eq(e.knownMinutes, 1714);
  eq(e.hoursText, '28h 34m');
  eq(e.incompleteDays, 1);
});

test('no known minutes -> No hours recorded', () => {
  const e = W.wrBuildEmployees(payload({ records: [rec({ status: 'working', total_minutes: null, timeout_at: null })] }), TODAY)[0];
  eq(e.hoursText, 'No hours recorded');
  const e2 = W.wrBuildEmployees(payload(), TODAY)[0];
  eq(e2.hoursText, 'No hours recorded');
});

test('Time Out after midnight stays on the Time In day', () => {
  const r = rec({ work_date: '2026-11-18', timein_at: '2026-11-18T12:00:00Z', timeout_at: '2026-11-18T18:00:00Z', total_minutes: 360 });
  const e = W.wrBuildEmployees(payload({ records: [r] }), TODAY)[0];
  eq(e.entries[0].date, '2026-11-18');
  eq(e.days[3].status, 'none');
  eq(e.days[2].status, 'complete');
});

test('same name, two workers', () => {
  const p = payload({ roster: [worker({ worker_id: 'a', worker_no: 5, name: 'John Tapales' }), worker({ worker_id: 'b', worker_no: 7, name: 'John Tapales' })] });
  const es = W.wrBuildEmployees(p, TODAY);
  eq(es.length, 2);
  eq(es.map(e => e.workerNo), [5, 7]);
  ok(es[0].workerId !== es[1].workerId);
});

test('eligible worker with no records appears, past days none', () => {
  const e = W.wrBuildEmployees(payload(), TODAY)[0];
  eq(e.days.length, 7);
  ok(e.days.every(d => d.status === 'none'));
  eq(e.recordedDays, 0);
  eq(e.needsReview, false);
});

test('header photo is the earliest Time In photo, never a Time Out photo', () => {
  const recs = [
    rec({ id: 'b', work_date: '2026-11-17', timein_at: '2026-11-17T00:00:00Z', timein_photo_path: 'in-late.jpg' }),
    rec({ id: 'a', work_date: '2026-11-16', timein_at: '2026-11-16T00:00:00Z', timein_photo_path: 'in-early.jpg', timeout_photo_path: 'out-early.jpg' })
  ];
  eq(W.wrBuildEmployees(payload({ records: recs }), TODAY)[0].headerPhotoPath, 'in-early.jpg');
  eq(W.wrBuildEmployees(payload({ records: [rec({ timein_photo_path: null })] }), TODAY)[0].headerPhotoPath, null);
});

test('note kept exactly as written', () => {
  const n = 'Laid blocks\n2F <east> & "west" — Señor';
  eq(W.wrEntry(rec({ timeout_description: n }), worker()).note, n);
  eq(W.wrEntry(rec({ timeout_description: '' }), worker()).note, null);
  eq(W.wrEntry(rec({ status: 'working' }), worker()), null);
});

test('Time In and Time Out projects differ', () => {
  const en = W.wrEntry(rec({ timein_folder_id: 'f1', timein_project_name: 'Site A', timeout_folder_id: 'f2', timeout_project_name: 'Site B' }), worker());
  eq(en.projectsDiffer, true);
  eq(en.project.name, 'Site B');
  eq(en.project.key, 'pc:f2');
  eq(en.timeInProject.name, 'Site A');
  const same = W.wrEntry(rec(), worker());
  eq(same.projectsDiffer, false);
});

test('projects group by system + id, not name', () => {
  const p = payload({
    roster: [worker(), worker({ worker_id: 'w2', worker_no: 8, name: 'Ben' }), worker({ worker_id: 'w3', worker_no: 9, name: 'Cy' })],
    records: [
      rec({ id: '1', worker_id: 'w1', timeout_photo_path: 'a.jpg', timeout_extra_photo_paths: ['a2.jpg'] }),
      rec({ id: '2', worker_id: 'w2', timeout_photo_path: 'b.jpg' }),
      rec({ id: '3', worker_id: 'w3', timeout_project_system: 'pm', timeout_folder_id: null, timeout_pm_project_id: 'p9', timeout_project_name: 'Site A' })
    ]
  });
  const ps = W.wrBuildProjects(p);
  eq(ps.length, 2);
  const pc = ps.find(x => x.key === 'pc:f1');
  eq(pc.submissions, 2);
  eq(pc.contributors, 2);
  eq(pc.photoCount, 3);
  eq(pc.days.length, 1);
  eq(pc.days[0].entries.length, 2);
  ok(ps.find(x => x.key === 'pm:p9'));
});

test('deleted projects with different names stay separate', () => {
  const p = payload({
    roster: [worker(), worker({ worker_id: 'w2', worker_no: 8, name: 'Ben' })],
    records: [
      rec({ id: '1', worker_id: 'w1', timein_folder_id: null, timeout_folder_id: null, timein_project_name: 'Old A', timeout_project_name: 'Old A' }),
      rec({ id: '2', worker_id: 'w2', timein_folder_id: null, timeout_folder_id: null, timein_project_name: 'Old B', timeout_project_name: 'Old B' })
    ]
  });
  eq(W.wrBuildProjects(p).length, 2);
});

test("a deleted project's Time In/Out difference is still seen", () => {
  const en = W.wrEntry(rec({ timein_folder_id: null, timein_project_name: 'Old A', timeout_folder_id: null, timeout_project_name: 'Old B' }), worker());
  eq(en.projectsDiffer, true);
});

test('employee meta says "yet" only when no day is past', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'weekly-report-admin.js'), 'utf8');
  ok(src.indexOf("'No attendance recorded yet'") > -1 && src.indexOf("status === 'none'") > -1);
});

test('duties match by trade', () => {
  const p = payload({ roster: [worker({ position: 'Helper (Marc Kelley)' })], duties: [{ position: 'helper', duties: 'Carry things', updated_at: '2026-11-01T00:00:00Z' }] });
  const e = W.wrBuildEmployees(p, TODAY)[0];
  eq(e.trade, 'Helper');
  eq(e.duties.text, 'Carry things');
  eq(W.wrBuildEmployees(payload(), TODAY)[0].duties, null);
});

test('name falls back: record, roster, worker number, dash', () => {
  const r = rec({ worker_name: 'Snapshot' });
  eq(W.wrBuildEmployees(payload({ roster: [worker({ name: 'Roster' })], records: [r] }), TODAY)[0].name, 'Snapshot');
  eq(W.wrBuildEmployees(payload({ roster: [worker({ name: 'Roster' })] }), TODAY)[0].name, 'Roster');
  eq(W.wrBuildEmployees(payload({ roster: [worker({ name: null })] }), TODAY)[0].name, 'W-0007');
  eq(W.wrBuildEmployees(payload({ roster: [worker({ name: null, worker_no: null })] }), TODAY)[0].name, '—');
});

test('review reasons', () => {
  const recs = [
    rec({ id: 'a', work_date: '2026-11-16', status: 'working', total_minutes: null, timeout_at: null }),
    rec({ id: 'b', work_date: '2026-11-17', timein_is_mock: true }),
    rec({ id: 'c', work_date: '2026-11-18', timeout_photo_path: null })
  ];
  const e = W.wrBuildEmployees(payload({ records: recs }), TODAY)[0];
  eq(e.reviewReasons, ['missing_timeout', 'verification', 'no_photo']);
  eq(e.needsReview, true);
  eq(W.WR_REASON.no_photo, 'Work photo missing');
  const closed = W.wrBuildEmployees(payload({ records: [rec({ status: 'abandoned' })] }), TODAY)[0];
  eq(closed.reviewReasons, ['admin_closed']);
  const perm = W.wrBuildEmployees(payload({ records: [rec({ timeout_location_status: 'permission_denied' })] }), TODAY)[0];
  eq(perm.reviewReasons, ['verification']);
});

test('an older Time Out with one photo and no note is not flagged', () => {
  const e = W.wrBuildEmployees(payload({ records: [rec({ timeout_description: null, timeout_extra_photo_paths: null })] }), TODAY)[0];
  eq(e.reviewReasons, []);
  eq(e.needsReview, false);
  eq(e.entries[0].legacy, true);
  eq(e.entries[0].note, null);
});

test('coverage', () => {
  eq(W.wrCoverage(payload({ history_starts_on: null })).kind, 'before_history');
  eq(W.wrCoverage(payload({ history_starts_on: null })).note,
    'Roster history has not started yet. This week lists only people with attendance records; others may be missing.');
  const part = W.wrCoverage(payload({ history_starts_on: '2026-11-19' }));
  eq(part.kind, 'partial');
  eq(part.note, 'Roster history starts on Thu 19 Nov, during this week. People with no records before then may be missing.');
  const full = W.wrCoverage(payload({ history_starts_on: '2026-11-01' }));
  eq(full.kind, 'full');
  eq(full.note, '');
  const after = W.wrCoverage(payload({ history_starts_on: '2026-12-01' }));
  eq(after.kind, 'before_history');
  eq(after.note, 'Roster history starts on Tue 1 Dec. This week lists only people with attendance records; others may be missing.');
});

test('filter', () => {
  const p = payload({
    roster: [worker(), worker({ worker_id: 'w2', worker_no: 8, name: 'Ben', position: 'Helper' })],
    records: [rec({ id: '1', worker_id: 'w2', worker_name: 'Ben', worker_position: 'Helper', timeout_photo_path: null })]
  });
  const es = W.wrBuildEmployees(p, TODAY);
  eq(W.wrFilterEmployees(es, { q: 'w-0007' }).map(e => e.name), ['Ana']);
  eq(W.wrFilterEmployees(es, { q: 'BEN' }).map(e => e.name), ['Ben']);
  eq(W.wrFilterEmployees(es, { needsReview: true }).map(e => e.name), ['Ben']);
  eq(W.wrFilterEmployees(es, { trade: 'helper' }).map(e => e.name), ['Ben']);
  eq(W.wrFilterEmployees(es, { projectKey: 'pc:f1' }).map(e => e.name), ['Ben']);
  eq(W.wrFilterEmployees(es, {}).length, 2);
});

// ── Part 1b: all projects + photo numbering (Task 8) ──
function prow(id, name, o) {
  return Object.assign({ project_system: 'pc', project_id: id, project_name: name, hidden: false, completed: false }, o || {});
}

test('empty active projects are listed', () => {
  const p = payload({
    records: [rec({ id: '1' })],
    projects: [prow('f1', 'Site A'), prow('f2', 'Site B', { hidden: true }), prow('f3', 'Site C', { completed: true })]
  });
  const ps = W.wrBuildProjects(p);
  eq(ps.map(x => x.key), ['pc:f1', 'pc:f2']);
  const a = ps[0], b = ps[1];
  eq(a.hasWork, true);
  eq(a.submissions, 1);
  eq(a.hidden, false);
  eq(a.completed, false);
  eq(b.hasWork, false);
  eq(b.hidden, true);
  eq(b.days, []);
  eq([b.submissions, b.contributors, b.photoCount], [0, 0, 0]);
  eq([b.system, b.id, b.name], ['pc', 'f2', 'Site B']);
});

test('a completed project with work this week is listed', () => {
  const p = payload({ records: [rec({ id: '1' })], projects: [prow('f1', 'Site A', { completed: true })] });
  const ps = W.wrBuildProjects(p);
  eq(ps.length, 1);
  eq(ps[0].completed, true);
  eq(ps[0].hasWork, true);
});

test('no projects key -> same output as Part 1', () => {
  const base = payload({ records: [rec({ id: '1' }), rec({ id: '2', timeout_folder_id: 'f9', timeout_project_name: 'Zed' })] });
  const withKey = Object.assign({}, base, { projects: [] });
  const strip = ps => ps.map(x => ({ key: x.key, system: x.system, id: x.id, name: x.name, days: x.days,
    submissions: x.submissions, contributors: x.contributors, photoCount: x.photoCount }));
  eq(strip(W.wrBuildProjects(base)), strip(W.wrBuildProjects(withKey)));
  const ps = W.wrBuildProjects(base);
  eq(ps.length, 2);
  ok(ps.every(x => x.hidden === false && x.completed === false && x.hasWork === true));
});

function threeEntries() {
  return payload({
    roster: [worker(), worker({ worker_id: 'w2', worker_no: 8, name: 'Ben' }), worker({ worker_id: 'w3', worker_no: 9, name: 'Cy' })],
    records: [
      rec({ id: '1', worker_id: 'w1', worker_name: 'Ana', work_date: '2026-11-19', timeout_photo_path: 'a1', timeout_extra_photo_paths: ['a2', 'a3'] }),
      rec({ id: '2', worker_id: 'w2', worker_name: 'Ben', work_date: '2026-11-20', timeout_photo_path: 'b1', timeout_extra_photo_paths: ['b2', 'b3'] }),
      rec({ id: '3', worker_id: 'w3', worker_name: 'Cy', work_date: '2026-11-20', timeout_photo_path: 'c1', timeout_extra_photo_paths: ['c2', 'c3'] })
    ]
  });
}

test('numbering runs across entries', () => {
  const proj = W.wrBuildProjects(threeEntries())[0];
  const r = W.wrNumberPhotos(proj, null);
  eq(r.rows.map(x => [x.entry.workerName, x.from, x.to]), [['Ana', 1, 3], ['Ben', 4, 6], ['Cy', 7, 9]]);
  eq(r.photos.map(x => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  eq(r.photos.map(x => x.path), ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3']);
  eq(r.photos[0].entry.workerName, 'Ana');
  eq(r.photos[0].label, 'Work photo 1 of 3');
  eq(r.photos[0].legacy, false);
});

test('day filter restarts numbering', () => {
  const proj = W.wrBuildProjects(threeEntries())[0];
  const r = W.wrNumberPhotos(proj, '2026-11-20');
  eq(r.rows.map(x => [x.entry.workerName, x.from, x.to]), [['Ben', 1, 3], ['Cy', 4, 6]]);
  eq(r.photos.map(x => x.n), [1, 2, 3, 4, 5, 6]);
});

test('an entry without photos has from/to null and takes no number', () => {
  const p = payload({
    roster: [worker(), worker({ worker_id: 'w2', worker_no: 8, name: 'Ben' }), worker({ worker_id: 'w3', worker_no: 9, name: 'Cy' })],
    records: [
      rec({ id: '1', worker_id: 'w1', worker_name: 'Ana', timeout_photo_path: 'a1' }),
      rec({ id: '2', worker_id: 'w2', worker_name: 'Ben', timeout_photo_path: null, timeout_extra_photo_paths: null }),
      rec({ id: '3', worker_id: 'w3', worker_name: 'Cy', timeout_photo_path: 'c1' })
    ]
  });
  const r = W.wrNumberPhotos(W.wrBuildProjects(p)[0], null);
  eq(r.rows.map(x => [x.from, x.to]), [[1, 1], [null, null], [2, 2]]);
  eq(r.photos.map(x => x.n), [1, 2]);
});

test('a photo with a null path still gets a number; same-day order is worker name then record id', () => {
  const p = payload({
    roster: [worker(), worker({ worker_id: 'w2', worker_no: 8, name: 'ana' })],
    records: [
      rec({ id: '9', worker_id: 'w2', worker_name: 'ana', timeout_photo_path: 'x', timeout_extra_photo_paths: [null] }),
      rec({ id: '8', worker_id: 'w1', worker_name: 'Ana', timeout_photo_path: 'y', timeout_extra_photo_paths: null })
    ]
  });
  const r = W.wrNumberPhotos(W.wrBuildProjects(p)[0], null);
  eq(r.rows.map(x => x.entry.recordId), ['8', '9']);
  eq(r.photos.map(x => [x.n, x.path]), [[1, 'y'], [2, 'x'], [3, null]]);
});

// ── The screen: wiring and fences (Task 5) — the files are read as text ──
const fs = require('fs');
const path = require('path');
function readText(rel) {
  try { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); } catch (e) { return ''; }
}
const ADMIN_JS = readText('js/admin.js');
const ADMIN_HTML = readText('admin.html');
const SCREEN = readText('js/weekly-report-admin.js');
const WR_FILES = ['js/weekly-report-data.js', 'js/weekly-report-print.js', 'js/weekly-report-admin.js'];

test('nav has Weekly reports under Attendance', () => {
  const m = /\{\s*view:\s*'attWeekly',\s*label:\s*'Weekly reports'/.exec(ADMIN_JS);
  ok(m, "PRIMARY_NAV has no { view: 'attWeekly', label: 'Weekly reports' }");
  const rep = ADMIN_JS.indexOf("view: 'attReports'");
  const rew = ADMIN_JS.indexOf("view: 'attRewards'");
  ok(rep >= 0 && rew >= 0, 'attReports / attRewards entries not found');
  ok(rep < m.index && m.index < rew, 'attWeekly must sit between attReports and attRewards');
  const att = ADMIN_JS.indexOf("id: 'attendance'");
  const next = ADMIN_JS.indexOf("id: 'requests'", att);
  ok(att >= 0 && att < m.index && (next < 0 || m.index < next), 'attWeekly must be inside the Attendance section');
});

test('admin.html wires the view', () => {
  ok(ADMIN_HTML.includes('id="attWeeklyView"'), 'no attWeeklyView container');
  ok(/attWeekly:\s*'Weekly reports'/.test(ADMIN_HTML), "TITLES has no attWeekly: 'Weekly reports'");
  ok(ADMIN_HTML.includes("initWeeklyReportModule(document.getElementById('attWeeklyView'))"), 'no init call for attWeekly');
  const attViews = /const ATT_VIEWS\s*=\s*\[([^\]]*)\]/.exec(ADMIN_HTML);
  ok(attViews && !attViews[1].includes('attWeekly'), 'attWeekly must not be routed through initAttendanceModule (ATT_VIEWS)');
  const sv = ADMIN_HTML.indexOf('src="js/split-view.js');
  const a = ADMIN_HTML.indexOf('src="js/weekly-report-data.js');
  const b = ADMIN_HTML.indexOf('src="js/weekly-report-print.js');
  const c = ADMIN_HTML.indexOf('src="js/weekly-report-admin.js');
  ok(sv >= 0, 'split-view.js script tag not found');
  ok(a > sv && b > a && c > b, 'the weekly report scripts must follow split-view.js in the order data, print, admin');
  const svCss = ADMIN_HTML.indexOf('href="css/split-view.css');
  const wrCss = ADMIN_HTML.indexOf('href="css/weekly-report.css');
  ok(svCss >= 0 && wrCss > svCss, 'css/weekly-report.css must be linked after split-view.css');
});

test('final fixes: completed-day rule, Employees filter, empty text, cache keys', () => {
  const WRA = readText('js/weekly-report-admin.js');
  ok(/\.filter\(x => !\(x\.p\.completed && x\.s\.submissions === 0\)\)/.test(WRA), 'completed project with no work in scope is dropped');
  ok(/S\.projects\.filter\(p => p\.hasWork\)/.test(WRA) && /p\.hasWork && p\.key === S\.projectKey/.test(WRA), 'Employees filter uses projects with work');
  ok(/S\.projectsKnown \? 'No active projects\.'/.test(WRA), 'empty text depends on the projects key');
  ['css/weekly-report.css', 'js/weekly-report-data.js', 'js/weekly-report-print.js', 'js/weekly-report-admin.js'].forEach(f =>
    ok(ADMIN_HTML.includes(f + '?v=20261123b'), f + ' cache key'));
});

test('staff are not blocked and workers cannot reach it', () => {
  const blocked = /const blocked = \[([\s\S]*?)\];/.exec(ADMIN_HTML);
  ok(blocked, 'staff blocked list not found');
  ok(!blocked[1].includes('attWeekly'), 'staff must not be blocked from attWeekly');
  const worker = /currentUserRole === 'worker'[^\n]*\n\s*const allowed = \[([^\]]*)\]/.exec(ADMIN_HTML);
  ok(worker, 'worker allowed list not found');
  ok(!worker[1].includes('attWeekly') && !/'att/.test(worker[1]), 'workers and team leaders must not reach any Attendance view');
  ok(/if \(role === 'worker' \|\| role === 'teamLeader'\) return p\.id === 'construction';/.test(ADMIN_JS),
    "_visibleNav must keep workers and team leaders on Construction only");
});

test('the screen writes nothing but duties', () => {
  ok(SCREEN.length > 0, 'js/weekly-report-admin.js not found');
  ['.insert(', '.update(', '.delete(', '.upsert('].forEach(w => ok(!SCREEN.includes(w), 'the screen contains ' + w));
  const calls = (SCREEN.match(/\brpc\(/g) || []).length;
  const names = [];
  SCREEN.replace(/\brpc\(\s*'([A-Za-z0-9_]+)'/g, (m0, n) => { names.push(n); return m0; });
  ok(calls > 0, 'no rpc calls found');
  eq(names.length, calls, 'every rpc( call names its function as a quoted literal');
  eq(Array.from(new Set(names)).sort(), ['att_duty_list', 'att_duty_save', 'att_week_report']);
  const froms = (SCREEN.replace(/Array\.from\(/g, '').match(/\.from\(/g) || []).length;
  const bucket = (SCREEN.match(/\.from\('attendance'\)/g) || []).length;
  eq(froms, bucket, "the only .from( is the attendance photo bucket (no table reads or writes)");
});

test('no money anywhere in the module', () => {
  WR_FILES.forEach(f => {
    const src = readText(f);
    ok(src.length > 0, f + ' not found');
    const hit = /₱|attPeso|attendance_weekly_rewards|reward_amount|payroll/.exec(src);
    ok(!hit, f + ' contains ' + (hit && hit[0]));
  });
});

test('photos are signed only from the attendance bucket', () => {
  ok(SCREEN.includes(".from('attendance')"), "no .from('attendance')");
  ok(!SCREEN.includes('getPublicUrl'), 'getPublicUrl is not allowed');
  ok(/createSignedUrls\([^)]*3600\)/.test(SCREEN), 'photos are signed for 3600 seconds');
});

// ── Part 1b, Task 10: the screen opens on Projects ──────────────────
test('Weekly reports opens on Projects', () => {
  ok(/const S = \{[\s\S]*?seg: 'projects'/.test(SCREEN), "the module state must start with seg: 'projects'");
  ok(/S\.seg = 'projects'/.test(SCREEN), "each visit must reset the segment to 'projects'");
  ok(SCREEN.includes("id: 'with'") && SCREEN.includes('With work') && SCREEN.includes('All projects'), 'Projects tabs All projects / With work');
  ok(/ptab: 'all'/.test(SCREEN), "Projects tab defaults to 'all'");
});

test('signing is batched', () => {
  ok(SCREEN.includes('createSignedUrls('), 'createSignedUrls( not used');
  ok(!SCREEN.includes('createSignedUrl('), 'createSignedUrl( (one photo per request) is still called');
  ok(/SIGN_CHUNK = 50/.test(SCREEN) && /SIGN_FLIGHT = 2/.test(SCREEN), 'chunks of 50, two in flight');
});

test('hidden projects explain themselves', () => {
  ok(SCREEN.includes('Hidden from workers'), 'no Hidden from workers chip');
  ok(SCREEN.includes('Sites & schedule'), 'no pointer to Sites & schedule');
  ok(SCREEN.includes('Workers cannot pick this site at Time In while it is hidden.'), 'hidden explanation missing');
  ok(SCREEN.includes('No work submitted this week') && SCREEN.includes('No work submitted on this day'), 'empty copy missing');
});

test('the rpc names are still exactly the three', () => {
  const names = [];
  SCREEN.replace(/\brpc\(\s*'([A-Za-z0-9_]+)'/g, (m0, n) => { names.push(n); return m0; });
  eq(Array.from(new Set(names)).sort(), ['att_duty_list', 'att_duty_save', 'att_week_report']);
});

if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
console.log('\nall weekly-report checks passed');
