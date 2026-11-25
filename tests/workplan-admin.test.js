// ════════════════════════════════════════════════════════════════════
// WORK PLAN ADMIN TESTS:  node tests/workplan-admin.test.js
//
// Zero dependencies. Loads the REAL js/workplan-admin-core.js (pure half)
// and checks BEHAVIOUR: task states and the office lists, the full-save
// payload, what needs a new version, keeping selections the office did
// not remove, unsaved meeting edits, AI drafts (prompt rules, parsing,
// unique-only matching), error sentences. Then guards across every Work
// Plan file: every RPC is granted to signed-in users, no money.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const wp = require('../js/workplan-admin-core.js');
const ROOT = path.join(__dirname, '..');
const src = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || '') + ' expected ' + b + ', got ' + a);
}
const task = (o) => Object.assign({ id: 't', status: 'not_started', title: 'Wall prep', project_name: 'Barlin', work_name: 'Main Contract',
  folder_id: 'F1', team_name: null, responsible: { id: 'w19', name: 'Juan' }, helpers: [], blocked: false, sent_back: false,
  overdue: false, not_acknowledged_24h: false, office_flags: [], proposed_by: null, planned_start: null, planned_end: null }, o);
const C = wp.CHOOSE;

console.log('\nworkplan-admin: states and the office lists');

test('statusLabel and statusPill; a leader\'s draft reads "Proposal"', () => {
  eq(wp.statusLabel(task({ status: 'draft' })), 'Draft');
  eq(wp.statusLabel(task({ status: 'draft', proposed_by: 'Mario' })), 'Proposal');
  eq(wp.statusLabel(task({ status: 'leader_checked' })), 'Leader checked');
  eq(wp.statusPill(task({ status: 'completed' })), 'att-pill--done');
  eq(wp.statusPill(task({ status: 'draft', proposed_by: 'Mario' })), 'att-pill--pm');
});

test('plannedLabel reads calendar days without shifting them', () => {
  eq(wp.plannedLabel(task({ planned_start: '2026-10-19', planned_end: '2026-10-21' })), 'Mon 19 Oct – Wed 21 Oct');
  eq(wp.plannedLabel(task({ planned_end: '2026-10-21' })), 'By Wed 21 Oct');
  eq(wp.plannedLabel(task({ planned_start: '2026-10-19' })), 'From Mon 19 Oct');
  eq(wp.plannedLabel(task({ planned_start: '2026-10-19', planned_end: '2026-10-19' })), 'Mon 19 Oct');
  eq(wp.plannedLabel(task({})), '—');
});

test('boardGroups: one heading per task, first match wins, in the office order', () => {
  const g = wp.boardGroups([
    task({ id: 'done', status: 'completed' }),
    task({ id: 'chk', status: 'reported_done', blocked: true }),
    task({ id: 'blk', status: 'in_progress', blocked: true, overdue: true }),
    task({ id: 'ack', status: 'not_started', not_acknowledged_24h: true, overdue: true }),
    task({ id: 'ovd', status: 'in_progress', overdue: true }),
    task({ id: 'act', status: 'not_started' }),
    task({ id: 'drf', status: 'draft' }),
  ]);
  eq(g.map(x => x.key), ['check', 'blocked', 'unacked', 'overdue', 'active', 'drafts', 'done']);
  eq(g.map(x => x.tasks.map(t => t.id)), [['chk'], ['blk'], ['ack'], ['ovd'], ['act'], ['drf'], ['done']]);
});

test('alertCounts counts live tasks only (spec §15 office lists)', () => {
  eq(wp.alertCounts([
    task({ status: 'in_progress', blocked: true, overdue: true }),
    task({ status: 'not_started', not_acknowledged_24h: true }),
    task({ status: 'reported_done' }),
    task({ status: 'draft', proposed_by: 'Mario' }),
    task({ status: 'completed', overdue: true, blocked: true }),
  ]), { check: 1, blocked: 1, unacked: 1, overdue: 1, proposals: 1 });
});

test('filterBoard by project and by text (title, project, people)', () => {
  const all = [task({ id: 'a', folder_id: 'F1', title: 'Wall prep' }),
               task({ id: 'b', folder_id: 'F2', title: 'Electrical', helpers: [{ id: 'w7', name: 'Pedro' }] })];
  eq(wp.filterBoard(all, { folder: 'F2' }).map(t => t.id), ['b']);
  eq(wp.filterBoard(all, { text: 'pedro' }).map(t => t.id), ['b']);
  eq(wp.filterBoard(all, { text: '  WALL ' }).map(t => t.id), ['a']);
  eq(wp.filterBoard(all, {}).length, 2);
});

console.log('\nworkplan-admin: the task form');

const base = { title: 'X', folder_id: 'F1', work_id: 'F1', team_id: '', responsible_id: '', helper_ids: [], planned_start: '', planned_end: '', checks: [] };

test('taskProblem mirrors the server and refuses unresolved choices', () => {
  eq(wp.taskProblem(base), null);
  eq(wp.taskProblem(Object.assign({}, base, { title: '  ' })), 'TITLE_REQUIRED');
  eq(wp.taskProblem(Object.assign({}, base, { folder_id: '' })), 'BAD_DESTINATION');
  eq(wp.taskProblem(Object.assign({}, base, { work_id: '' })), 'BAD_DESTINATION', 'work is never defaulted');
  eq(wp.taskProblem(Object.assign({}, base, { planned_start: '2026-10-21', planned_end: '2026-10-19' })), 'BAD_DATES');
  eq(wp.taskProblem(Object.assign({}, base, { planned_start: '21/10/2026' })), 'BAD_DATES');
  eq(wp.taskProblem(Object.assign({}, base, { responsible_id: 'w7', helper_ids: ['w7'] })), 'BAD_PERSON');
  for (const k of ['folder_id', 'work_id', 'team_id', 'responsible_id'])
    eq(wp.taskProblem(Object.assign({}, base, { [k]: C })), 'NEEDS_CHOICE', k);
  eq(wp.taskProblem(Object.assign({}, base, { checks: ['helpers'] })), 'NEEDS_CHOICE', 'unconfirmed helpers');
});

test('buildTaskPayload is a FULL save: arrays never null, empty ids left out, no default work, minor flag', () => {
  const p = wp.buildTaskPayload({ meeting_id: 'M', folder_id: 'F1', work_id: 'AW1', team_id: '', responsible_id: 'w19',
    helper_ids: ['w7', 'w7', ''], depends_on: [], title: ' Wall ', instructions: ' plaster ', planned_start: '', planned_end: '2026-10-21',
    source_passage: 'p', office_flags: ['x'], checks: [], minor_text_only: false, change_note: '' });
  eq(p, { folder_id: 'F1', work_id: 'AW1', title: 'Wall', instructions: 'plaster', helper_ids: ['w7'], depends_on: [],
          office_flags: ['x'], source_passage: 'p', meeting_id: 'M', responsible_id: 'w19', planned_end: '2026-10-21' });
  const q = wp.buildTaskPayload(Object.assign({}, base, { minor_text_only: true, change_note: ' typo ' }));
  eq([q.minor_text_only, q.change_note, q.helper_ids, q.office_flags, q.depends_on], [true, 'typo', [], [], []]);
  ok(!('checks' in q) && !('important' in q), 'no form-only keys sent');
});

test('docToForm then buildTaskPayload keeps every field of an office task', () => {
  const doc = { meeting_id: 'M', folder_id: 'F1', work_id: 'AW', team_id: 'T', responsible: { id: 'w19' },
    helpers: [{ id: 'w7' }], depends_on: ['d1'], title: 'Wall', instructions: 'i', planned_start: '2026-10-19',
    planned_end: null, source_passage: 's', office_flags: ['f'] };
  const p = wp.buildTaskPayload(wp.docToForm(doc));
  eq([p.meeting_id, p.folder_id, p.work_id, p.team_id, p.responsible_id, p.helper_ids, p.depends_on, p.planned_start, p.planned_end, p.office_flags],
     ['M', 'F1', 'AW', 'T', 'w19', ['w7'], ['d1'], '2026-10-19', undefined, ['f']]);
});

console.log('\nworkplan-admin: what needs a new version (mirrors 0094)');

const pub = { status: 'not_started', title: 'Wall', instructions: 'Plaster', team_id: 'T', responsible: { id: 'w19' },
              helpers: [{ id: 'w7' }, { id: 'w8' }], planned_start: '2026-10-19', planned_end: '2026-10-21' };
const form = (o) => Object.assign(wp.docToForm(pub), o);

test('revisionChanges: nothing, wording only, and each always-new-version change', () => {
  eq(wp.revisionChanges(pub, form({})), { changes: [], text: false });
  eq(wp.revisionChanges(pub, form({ instructions: ' Plaster ' })), { changes: [], text: false }, 'spaces only');
  eq(wp.revisionChanges(pub, form({ instructions: 'Plaster.' })), { changes: [], text: true });
  eq(wp.revisionChanges(pub, form({ helper_ids: ['w8', 'w7'] })), { changes: [], text: false }, 'helper order');
  eq(wp.revisionChanges(pub, form({ helper_ids: ['w7'] })).changes, ['people']);
  eq(wp.revisionChanges(pub, form({ responsible_id: 'w8', helper_ids: ['w7'] })).changes, ['people']);
  eq(wp.revisionChanges(pub, form({ team_id: '' })).changes, ['team']);
  eq(wp.revisionChanges(pub, form({ planned_end: '2026-10-23' })).changes, ['planned dates']);
  eq(wp.revisionChanges(pub, form({ title: 'Wall 2', helper_ids: [], planned_start: '' })), { changes: ['people', 'planned dates'], text: true });
  eq(wp.revisionChanges(Object.assign({}, pub, { status: 'draft' }), form({ planned_end: '' })), { changes: [], text: false }, 'drafts never');
});

test('keepSelections keeps what the office did not remove', () => {
  eq(wp.keepSelections(['old', 'a', 'b'], ['a', 'b', 'c'], ['b', 'c']), ['old', 'b', 'c'], 'older link not shown survives');
  eq(wp.keepSelections(['a'], ['a'], []), [], 'unticked on screen = removed');
  eq(wp.keepSelections([], ['a'], ['a', 'a']), ['a']);
});

console.log('\nworkplan-admin: unsaved meeting edits');

const meeting = { title: 'Mon meeting', held_on: '2026-10-12', original_notes: 'notes',
                  versions: [{ version: 2, shared_notes: 'v2 shared' }, { version: 1, shared_notes: 'v1' }] };

test('meetingFields: unsaved edits win over the server copy; newest shared notes', () => {
  eq(wp.meetingFields(meeting), { title: 'Mon meeting', held_on: '2026-10-12', notes: 'notes', shared: 'v2 shared',
                                  recip: 'default', people: [], change: '' });
  const f = wp.meetingFields(meeting, { notes: 'typed', shared: 'my shared', recip: 'choose', people: ['w7'] });
  eq([f.title, f.notes, f.shared, f.recip, f.people], ['Mon meeting', 'typed', 'my shared', 'choose', ['w7']]);
  eq(wp.meetingFields({}).shared, '');
});

test('meetingUnsaved notices any edit that differs from the server', () => {
  eq(wp.meetingUnsaved(meeting, {}), false);
  eq(wp.meetingUnsaved(meeting, { notes: 'notes' }), false, 'same text is not unsaved');
  eq(wp.meetingUnsaved(meeting, { notes: 'notes!' }), true);
  eq(wp.meetingUnsaved(meeting, { people: ['w7'] }), true);
  eq(wp.meetingUnsaved({}, { notes: 'x' }), true, 'a new meeting');
});

test('settlePending forgets only what was saved, in the SAME object the input handlers write to', () => {
  const p = { notes: 'abc', shared: 'x' };
  ok(wp.settlePending(p, { notes: 'abc', title: 'T' }) === p, 'returns the same object');
  eq(p, { shared: 'x' });
  const q = { notes: 'abc, typed while saving' };
  wp.settlePending(q, { notes: 'abc' });
  eq(q, { notes: 'abc, typed while saving' });
  const r = { people: ['w7', 'w19'], recip: 'choose' };
  wp.settlePending(r, { people: ['w7', 'w19'], recip: 'choose', shared: '' });
  eq(r, {});
  const u = { people: ['w7'] };
  wp.settlePending(u, { people: ['w7', 'w19'] });
  eq(u, { people: ['w7'] }, 'changed during publish');
  eq(wp.settlePending(undefined, { notes: 'x' }), undefined);
  // What revision 3 got wrong: an input handler still holding the object
  // must keep writing to the one the screen draws from.
  const held = { notes: 'saved' };
  wp.settlePending(held, { notes: 'saved' });
  held.notes = 'typed after the save';
  eq(wp.meetingFields({ original_notes: 'saved' }, held).notes, 'typed after the save');
});

test('loadTickets: only the newest load may draw', () => {
  const t = wp.loadTickets();
  const a = t.take(), b = t.take();
  eq([t.isLatest(a), t.isLatest(b)], [false, true]);
  eq(wp.loadTickets().isLatest(a), false, 'each screen has its own tickets');
});

console.log('\nworkplan-admin: AI drafts');

const ctx = {
  projects: [{ folder_id: 'F1', name: 'Barlin Residence', works: [{ work_id: 'AW1', name: 'Barlin Additional Works' }] },
             { folder_id: 'F2', name: 'Castro Residence', works: [] }, { folder_id: 'F3', name: 'Castro Residence', works: [] }],
  people: [{ id: 'w7', name: 'Pedro Santos', worker_no: 7 }, { id: 'w19', name: 'Juan Cruz', worker_no: 19 },
           { id: 'w23', name: 'Juan Cruz', worker_no: 23 }],
  teams: [{ id: 'T1', name: 'Team test' }, { id: 'T2', name: 'Team A' }, { id: 'T3', name: 'Team A' }],
  heldOn: '2026-10-12',
};
const draftOf = (o) => wp.parseDraft(JSON.stringify({ tasks: [Object.assign({ title: 'Work' }, o)] })).tasks[0];

test('draftMessages carries the lists and the rules (no inventing, exact names, language, no money)', () => {
  const m = wp.draftMessages('Bukas, wall prep sa Barlin.', ctx);
  ok(m.length === 2 && m[0].role === 'system' && m[1].role === 'user', 'system + user');
  for (const s of ['Barlin Residence', 'Barlin Additional Works', 'Pedro Santos (W-0007)', 'Team test', 'Never invent',
                   'EXACTLY', 'Taglish', 'money', '"tasks"', 'source_passage', 'Main Contract'])
    ok(m[0].content.includes(s), 'system prompt lacks: ' + s);
  ok(m[1].content.includes('Bukas, wall prep sa Barlin.') && m[1].content.includes('2026-10-12'), 'notes + date in the user message');
});

test('parseDraft finds the JSON inside prose, cleans fields, keeps only real dates', () => {
  const d = wp.parseDraft('Here you go:\n{"tasks":[{"title":" Wall prep ","project":"Barlin Residence","planned_start":"2026-10-19",' +
    '"planned_end":"next week","helpers":["Pedro Santos",""],"flags":[],"waits_for":null}],"shared_notes":"Monday start"}\nThanks!');
  eq(d.tasks.length, 1);
  eq([d.tasks[0].title, d.tasks[0].planned_start, d.tasks[0].planned_end, d.tasks[0].raw_end, d.tasks[0].helpers, d.tasks[0].waits_for],
     ['Wall prep', '2026-10-19', null, 'next week', ['Pedro Santos'], []]);
  eq(d.shared_notes, 'Monday start');
  const n = wp.parseDraft('{"tasks":[{"title":"X","planned_start":null,"planned_end":"null"}]}');
  eq([n.tasks[0].raw_start, n.tasks[0].raw_end], ['', '']);
  eq(wp.parseDraft('{"tasks":[{"title":""}],"shared_notes":""}').tasks.length, 0, 'untitled tasks dropped');
});

test('parseDraft refuses an unreadable answer', () => {
  for (const bad of ['', 'no json here', '{"tasks": [', '{"tasks":[}']) {
    let threw = '';
    try { wp.parseDraft(bad); } catch (e) { threw = e.message; }
    eq(threw, 'AI_UNREADABLE', JSON.stringify(bad));
  }
});

test('resolveDraft fills a field only on one exact match (names, or a unique W-number)', () => {
  const r = wp.resolveDraft(draftOf({ project: 'barlin residence', work: 'Barlin Additional Works', team: 'Team test',
    responsible: 'W-0019', helpers: ['Pedro Santos (W-0007)'], source_passage: 'Si Juan ang electrical', flags: ['check wording'] }), ctx);
  eq([r.values.folder_id, r.values.work_id, r.values.team_id, r.values.responsible_id, r.values.helper_ids, r.values.checks],
     ['F1', 'AW1', 'T1', 'w19', ['w7'], []]);
  eq(r.values.source_passage, 'Si Juan ang electrical');
  ok(r.flags.includes('check wording') && r.values.office_flags === r.flags, 'AI flags kept as office flags');
  eq(wp.taskProblem(r.values), null, 'fully resolved draft can be saved');
  eq(wp.resolveDraft(draftOf({ project: 'Barlin Residence', work: 'Main Contract', responsible: 'Pedro Santos' }), ctx).values.work_id, 'F1',
     'Main Contract only when the AI says so');
});

test('resolveDraft never turns an unknown or missing Additional Works into Main Contract', () => {
  const unknown = wp.resolveDraft(draftOf({ project: 'Barlin Residence', work: 'Garage extension', responsible: 'Pedro Santos' }), ctx);
  eq([unknown.values.folder_id, unknown.values.work_id], ['F1', C]);
  ok(unknown.flags.includes('Additional Works not recognised: "Garage extension"'), JSON.stringify(unknown.flags));
  eq(wp.taskProblem(unknown.values), 'NEEDS_CHOICE');
  const missing = wp.resolveDraft(draftOf({ project: 'Barlin Residence', responsible: 'Pedro Santos' }), ctx);
  eq(missing.values.work_id, C);
  ok(missing.flags.includes('Main Contract or Additional Works not given — choose one'), JSON.stringify(missing.flags));
});

test('resolveDraft: duplicate project, team and worker names need an explicit choice', () => {
  const r = wp.resolveDraft(draftOf({ project: 'Castro Residence', work: 'Main Contract', team: 'Team A', responsible: 'Juan Cruz' }), ctx);
  eq([r.values.folder_id, r.values.work_id, r.values.team_id, r.values.responsible_id], [C, C, C, C]);
  for (const f of ['Project "Castro Residence" matches 2 names — choose one', 'Team "Team A" matches 2 names — choose one',
                   'Person "Juan Cruz" matches 2 names — choose one'])
    ok(r.flags.includes(f), 'missing flag: ' + f + ' in ' + JSON.stringify(r.flags));
  eq(wp.taskProblem(Object.assign({}, r.values, { title: 'Work' })), 'NEEDS_CHOICE');
  eq(wp.resolveDraft(draftOf({ responsible: 'Juan Cruz (W-0023)' }), ctx).values.responsible_id, 'w23', 'a unique W-number decides');
  const clash = wp.resolveDraft(draftOf({ responsible: 'Pedro Santos (W-0023)' }), ctx);
  eq(clash.values.responsible_id, C, 'a name and a W-number that disagree are not guessed');
  ok(clash.flags.includes('Person "Pedro Santos (W-0023)" matches 2 names — choose one'), 'flag explains: ' + JSON.stringify(clash.flags));
});

test('resolveDraft: unknown helpers and unclear dates must be confirmed; waits-for and materials become flags', () => {
  const r = wp.resolveDraft(draftOf({ project: 'Barlin Residence', work: 'Main Contract', responsible: 'Pedro Santos',
    helpers: ['Kuya Ben', 'Pedro Santos'], planned_start: 'Monday', waits_for: ['wall prep'], materials: ['THHN 3.5', 'conduit'] }), ctx);
  eq(r.values.helper_ids, [], 'the responsible person is never also a helper');
  eq(r.values.checks, ['helpers', 'dates']);
  for (const f of ['Person not recognised: "Kuya Ben"', 'Start date unclear: "Monday"',
                   'Waits for: wall prep — link it after both are drafts', 'Materials mentioned: THHN 3.5, conduit'])
    ok(r.flags.includes(f), 'missing flag: ' + f);
  eq(wp.taskProblem(r.values), 'NEEDS_CHOICE');
  eq(wp.taskProblem(Object.assign({}, r.values, { checks: [] })), null, 'confirmed → can be saved');
  const none = wp.resolveDraft(draftOf({}), ctx);
  ok(none.flags.includes('No project given — choose one') && none.flags.includes('No responsible person given — choose one'), 'missing names flagged');
});

console.log('\nworkplan-admin: history and errors');

test('eventText adds the note', () => {
  eq(wp.eventText({ kind: 'sent_back', note: 'Kulang ang palitada' }), 'Sent back — Kulang ang palitada');
  eq(wp.eventText({ kind: 'revised', note: 'Changed: planned dates' }), 'Revised — everyone on the task must read it again — Changed: planned dates');
  eq(wp.eventText({ kind: 'published', note: '' }), 'Published');
  eq(wp.eventText({ kind: 'mystery', note: '' }), 'mystery');
});

test('errorMessage maps every Work Plan and AI code, and never a code inside another', () => {
  for (const code of ['TITLE_REQUIRED', 'BAD_DESTINATION', 'BAD_PERSON', 'NO_RESPONSIBLE', 'DEPENDENCY_CYCLE', 'HAS_DEPENDENTS',
                      'TASK_CLOSED', 'TASK_BLOCKED', 'BAD_STATE', 'REASON_REQUIRED', 'NOTE_REQUIRED', 'NEEDS_CHOICE',
                      'NOTES_TOO_LONG', 'AI_UNREADABLE', 'AI_FAILED', 'AI_NOT_SIGNED_IN', 'AI_NOT_ALLOWED', 'AI_TOO_LARGE', 'AI_RATE_LIMITED'])
    eq(wp.errorMessage({ message: code }), wp.ERRORS[code], code);
  ok(wp.errorMessage({ message: 'XBAD_STATEX' }).startsWith('Something went wrong'), 'no partial match');
});

test('the shared modal shows Work Plan sentences (requests-admin-core modal takes errorMessage)', () => {
  ok(/\(opts\.errorMessage \|\| errorMessage\)\(err\)/.test(src('js/requests-admin-core.js')), 'modal must use opts.errorMessage');
});

console.log('\nworkplan-admin: guards across every Work Plan file');

const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => /^workplan-admin-.*\.js$/.test(f));
const granted = new Set();
for (const m of ['supabase/migrations/0086_workmate_requests_office.sql', 'supabase/migrations/0093_workmate_my_work.sql',
                 'supabase/migrations/0094_workmate_work_plan_office.sql']) {
  for (const g of src(m).matchAll(/grant execute on function (\w+)\(/g)) granted.add(g[1]);
}

test('every RPC the Work Plan screens call is granted to signed-in users', () => {
  ok(files.length >= 1, 'no workplan-admin files found');
  for (const f of files) {
    for (const c of src('js/' + f).matchAll(/rpc\('(\w+)'/g)) ok(granted.has(c[1]), f + ' calls ' + c[1] + ', which is not granted');
  }
});

test('no money in the Work Plan files', () => {
  for (const rel of files.map(f => 'js/' + f).concat(['css/workplan-admin.css'])) {
    ok(!/peso|₱|\bamount\b|\bprice\b|\bcost\b/i.test(src(rel)), rel + ' mentions money');
  }
});

console.log('\nworkplan-admin: navigation');

// Runs the real PRIMARY_NAV, _FOCUS_SUBVIEWS and focusAllowedViews from
// js/admin.js for a module-focused account.
function focusViews(modules) {
  const s = src('js/admin.js');
  const a = s.indexOf('const PRIMARY_NAV');
  const b = s.indexOf('// Landing view for the first focused module');
  ok(a > 0 && b > a, 'nav slice markers not found in js/admin.js');
  const win = {};
  new Function('window', 'currentAllowedModules', s.slice(a, b))(win, modules);
  return win.focusAllowedViews();
}

test('a module-focused account granted Work Plan can open every Work Plan view, drill-downs included', () => {
  const v = focusViews(['workplan']);
  for (const x of ['wpBoard', 'wpMeetings', 'wpMeeting', 'wpTask']) ok(v.includes(x), x + ' blocked: ' + JSON.stringify(v));
});

test('a PM-only account cannot open any Work Plan view', () => {
  const v = focusViews(['pm']);
  for (const x of ['wpBoard', 'wpMeetings', 'wpMeeting', 'wpTask']) ok(!v.includes(x), x + ' reachable by a PM-only account');
});

test('PRIMARY_NAV shows Board and Meetings; Meeting and Task are hidden drill-downs', () => {
  const m = src('js/admin.js').match(/\{ id: 'workplan', label: 'Work Plan'[\s\S]*?\n    \},/);
  ok(m, 'workplan entry missing');
  ok(/defaultView: 'wpBoard'/.test(m[0]), 'default view');
  for (const v of ['wpBoard', 'wpMeetings']) ok(new RegExp("view: '" + v + "'(?![^}]*hidden)").test(m[0]), v + ' visible');
  for (const v of ['wpMeeting', 'wpTask']) ok(new RegExp("view: '" + v + "'[^}]*hidden: true").test(m[0]), v + ' hidden');
});

test('admin.html: view hosts, WP_VIEWS in switchView, titles, init, scripts in order', () => {
  const h = src('admin.html');
  for (const v of ['wpBoard', 'wpMeetings', 'wpMeeting', 'wpTask']) {
    ok(h.includes('<div id="' + v + 'View" class="content-view" style="display: none;"></div>'), v + ' host');
    ok(new RegExp(v + ":\\s+'").test(h), v + ' title');
  }
  ok(/const WP_VIEWS\s+= \['wpBoard','wpMeetings','wpMeeting','wpTask'\];/.test(h), 'WP_VIEWS');
  ok(/if \(WP_VIEWS\.includes\(view\)\s+&& typeof initWorkPlanModule === 'function'\) initWorkPlanModule\(view\);/.test(h), 'init dispatch');
  ok(h.includes('<link rel="stylesheet" href="css/workplan-admin.css?v=20261116b">'), 'stylesheet');
  const order = ['js/requests-admin-core.js', 'js/workplan-admin-core.js', 'js/workplan-admin-form.js', 'js/workplan-admin-board.js',
                 'js/workplan-admin-task.js', 'js/workplan-admin-meetings.js'].map(s => h.indexOf('<script src="' + s));
  ok(order.every(i => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), 'scripts present and in order: ' + order);
});

test('ARCHITECTURE.md module map names the Work Plan files', () => {
  ok(/\| Work Plan \| `workplan-admin-core\.js`/.test(src('docs/ARCHITECTURE.md')), 'module map row');
});

console.log('\nworkplan admin: office v5 (Board on cards, a task in the pop-up)');

test('taskNextStep: one button only for the decision the office is there to make', () => {
  const s1 = wp.taskNextStep({ status: 'leader_checked' });
  eq(s1.label, 'Approve — completed'); eq(s1.act, 'approve');
  ok(s1.text.includes('Checked by the team leader, waiting for your approval') && s1.text.includes('A leader\'s check never replaces the office approval.'), 'leader wording kept');
  const s2 = wp.taskNextStep({ status: 'reported_done' });
  ok(s2.text.includes('Reported done, waiting for your approval') && !s2.text.includes('leader\'s check'), 'reported done wording');
  eq(s2.act, 'approve');
  const s3 = wp.taskNextStep({ status: 'draft', proposed_by: 'x' });
  eq(s3.act, 'publish'); ok(s3.text.includes('Publish it to make it a task, or decline it with a reason the leader will see.'), 'proposal wording');
  const s4 = wp.taskNextStep({ status: 'draft' });
  eq(s4.act, 'publish'); eq(s4.label, 'Publish');
  for (const st of ['not_started', 'in_progress', 'completed', 'cancelled']) eq(wp.taskNextStep({ status: st }), null, st);
});

test('boardTab: Needs you = the lists that ask something of the office', () => {
  const T = o => Object.assign({ status: 'in_progress' }, o);
  ok(wp.boardTab(T({ status: 'reported_done' }), 'needs') && wp.boardTab(T({ blocked: true }), 'needs'), 'check and blocked');
  ok(wp.boardTab(T({ not_acknowledged_24h: true }), 'needs') && wp.boardTab(T({ overdue: true }), 'needs'), 'unacked and overdue');
  ok(!wp.boardTab(T({}), 'needs'), 'plain in progress is not');
  ok(wp.boardTab(T({ blocked: true }), 'prog') && wp.boardTab(T({ status: 'not_started' }), 'prog'), 'In progress = not started and in progress');
  ok(wp.boardTab(T({ status: 'draft' }), 'drafts') && wp.boardTab(T({ status: 'completed' }), 'done') && wp.boardTab(T({}), 'all'), 'drafts, completed, all');
  eq(wp.BOARD_TABS.map(t => t[0]), ['needs', 'prog', 'drafts', 'done', 'all']);
});

test('the Board is cards; a task opens in the pop-up; the old page routes to the Board', () => {
  const b = src('js/workplan-admin-board.js'), t = src('js/workplan-admin-task.js'), c = src('js/workplan-admin-core.js');
  ok(b.includes('SplitView.render(') && !/<table/.test(b), 'drawn by the shared frame, no table');
  ok(/WP\.taskNextStep\(t\)/.test(b) && /nextLabel:/.test(b), 'cards carry the next step');
  ok(/onClose: \(\) => \{[^}]*ui\.selectedId = null/.test(b), 'closing forgets the task');
  ok(/WP\.renderTaskPanel = /.test(t) && /SV\.page\(panel, \{/.test(t), 'the task page renders into the pop-up shell');
  ok(!/data-back/.test(t), 'no "← Work Plan" back link (✕ replaces it)');
  ok(/function openTask\(id\) \{ state\.taskId = id; root\.switchView\('wpBoard'\); \}/.test(c), 'openTask → the Board');
  ok(/views\.wpTask = \(\) => root\.switchView\('wpBoard'\)/.test(c), 'the old route lands on the Board');
  for (const r of ['wp_office_board', 'wp_office_destinations']) ok(b.includes("WP.rpc('" + r + "'"), 'board RPC ' + r);
  for (const r of ['wp_office_task', 'wp_office_clear_blocker', 'wp_office_publish', 'wp_office_approve', 'wp_office_send_back', 'wp_office_reopen', 'wp_office_cancel'])
    ok(t.includes("WP.rpc('" + r + "'"), 'task RPC ' + r);
  ok(/panel\.isConnected && panel\.dataset\.svId === id/.test(t), 'a closed or replaced pop-up never draws a late answer');
  ok(/want\.act === go\.dataset\.act/.test(t), 'a card button only starts the step it showed');
});

test('v5 Board (owner check 17 Nov): an empty board keeps the header, How box and filter; a short empty message', () => {
  const b = src('js/workplan-admin-board.js');
  ok(/primary: \{ label: 'New task', onClick: newTask \},/.test(b), 'New task is always the main button');
  ok(/how: HOW,/.test(b), 'How a task moves always shows (folded)');
  ok(/toolbar: folderSelect\(\),/.test(b), 'All projects always shows');
  ok(!/wp-ways|wp-steps/.test(b), 'no big two-box empty panel (the How box carries the steps)');
  ok(/data-meetings[^\n]*Open Meetings/.test(b) && /data-new[^\n]*New task/.test(b), 'the empty message still offers both ways to start');
});

test('v5 pop-ups (owner check 17 Nov): one column of the frame\'s sections, not the old two-column cards', () => {
  const t = src('js/workplan-admin-task.js'), m = src('js/workplan-admin-meetings.js'), sv = src('js/split-view.js');
  for (const [name, s] of [['task', t], ['meeting', m]]) {
    ok(!/wp-layout|wp-side|wp-main/.test(s), name + ': no side column');
    ok(!/class="att-card/.test(s), name + ': no old boxed cards');
  }
  ok(/SV\.section\('Problems and waiting'/.test(t) && /SV\.section\('Instructions'/.test(t) && /SV\.section\('People'/.test(t), 'task sections in v5 order');
  ok(/SV\.facts\(\[\s*\['Task', /.test(t), 'the task facts start with the task');
  ok(/SV\.history\(/.test(t), 'the task history is the frame\'s');
  ok(/actions: actionsHtml\(t\)/.test(t), 'the task\'s buttons sit in the footer beside Next');
  ok(/SV\.notice\(/.test(t), 'blocked / to-check notes are the frame\'s notices');
  ok(/sec\('Notes'/.test(m) && /sec\('AI drafts'/.test(m) && /sec\('Tasks from this meeting'/.test(m) && /sec\('Publish'/.test(m), 'meeting sections, one column');
  ok(/\(p\.actions \|\| p\.nextLabel\) \? '<footer class="sv-panel-foot"><div class="sv-panel-actions">' \+ \(p\.actions \|\| ''\)/.test(sv),
     'the page shell carries footer actions like panelHtml');
});

test('Meetings are cards; a meeting (and New meeting) opens in the pop-up; the old page routes to Meetings', () => {
  const m = src('js/workplan-admin-meetings.js'), c = src('js/workplan-admin-core.js');
  ok(m.includes('SplitView.render(') && !/<table/.test(m), 'drawn by the shared frame, no table');
  ok(/WP\.renderMeetingPanel = /.test(m) && /SV\.page\(panel, \{/.test(m), 'a meeting renders into the pop-up shell');
  ok(!/data-back/.test(m), 'no "← Meetings" back link (✕ replaces it)');
  ok(/onClose: \(\) => \{[^}]*ui\.selectedId = null/.test(m), 'closing forgets the meeting');
  ok(/function openMeeting\(id\) \{ state\.meetingId = id \|\| NEW_MEETING; root\.switchView\('wpMeetings'\); \}/.test(c), 'openMeeting → Meetings');
  ok(/views\.wpMeeting = \(\) => root\.switchView\('wpMeetings'\)/.test(c), 'the old route lands on Meetings');
  for (const r of ['wp_office_meetings', 'wp_office_meeting', 'wp_office_save_meeting', 'wp_office_publish'])
    ok(m.includes("WP.rpc('" + r + "'"), 'meeting RPC ' + r);
  ok(/panel\.isConnected && panel\.dataset\.svId === /.test(m), 'a closed or replaced pop-up never draws a late answer');
});

// ── Task 4 appends its tests above this line ──

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
