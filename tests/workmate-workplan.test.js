// ════════════════════════════════════════════════════════════════════
// WORKMATE MY WORK (0093) STATIC TESTS:
//   run with  node tests/workmate-workplan.test.js
//
// Zero dependencies. Guards the shape of migration 0093 (Stage 1c-1):
// workers reach wp_* only through RPCs, Blocked is derived and locks
// Start work / Report done, office-only fields never reach a worker,
// retries are safe, no money. The LIVE behaviour is checked by
// supabase/tests/1c_acceptance.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = rel => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const MIGRATION = 'supabase/migrations/0093_workmate_my_work.sql';

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SQL = read(MIGRATION);
const CODE = SQL.replace(/--.*$/gm, '');
function fnBlock(name) {
  const m = CODE.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\$\\$;', 'i'));
  return m ? m[0] : '';
}
const TABLES = ['wp_meetings', 'wp_meeting_versions', 'wp_note_recipients', 'wp_tasks', 'wp_task_people', 'wp_acks',
  'wp_blockers', 'wp_dependencies', 'wp_events', 'wp_ops', 'wp_photos'];

console.log('\nworkmate my work (0093)');

test('the migration exists and sets a lock timeout', () => {
  assert(SQL.length > 0, 'missing ' + MIGRATION);
  assert(/set local lock_timeout = '5s';/.test(CODE), 'no set local lock_timeout');
});

test('no money anywhere in 0093', () => {
  assert(!/\b[a-z_]*(price|amount|cost|peso)[a-z_]*\b/i.test(CODE), 'a money word appears in 0093 code');
});

test('every wp_ table exists with an owner, RLS, and is in the policy loop', () => {
  const loop = CODE.match(/foreach v_table in array array\[([^\]]*)\]/);
  assert(loop, 'the policy loop is missing');
  for (const t of TABLES) {
    const m = CODE.match(new RegExp('create table if not exists ' + t + ' \\(([\\s\\S]*?)\\n\\);'));
    assert(m, t + ' missing');
    assert(/owner_id uuid not null references profiles\(id\)/.test(m[1]), t + ' needs owner_id');
    assert(new RegExp('alter table ' + t + ' enable row level security;').test(CODE), t + ' RLS');
    assert(loop[1].includes("'" + t + "'"), t + ' is not in the policy loop');
  }
});

test('the loop gives the office SELECT only and revokes anon and direct writes', () => {
  assert(/for select to authenticated using \(\(is_owner\(\) or is_staff\(\)\) and can_access\(owner_id\)\)/.test(CODE), 'office select');
  assert(/revoke all on %I from anon/.test(CODE), 'revoke anon');
  assert(/revoke insert, update, delete, truncate, references, trigger on %I from authenticated/.test(CODE), 'revoke writes');
  const doBlock = CODE.slice(CODE.indexOf('foreach v_table in array'), CODE.indexOf('end $$;', CODE.indexOf('foreach v_table in array')));
  const creates = doBlock.match(/create policy/g) || [];
  assert(creates.length === 1, 'the policy loop must create exactly one policy, found ' + creates.length);
  assert(/create policy/.test(doBlock) && /for select/.test(doBlock), 'the loop policy must be FOR SELECT');
  assert(!/grant\s[^;]*\b(insert|update|delete)\b[^;]*\son\s+(table\s+)?wp_/i.test(CODE), 'no grant of write rights on a wp_ table');
});

test('task states; a draft has version 0, a published task a version; completed pairs with completed_at', () => {
  assert(/check \(status in \('draft', 'not_started', 'in_progress', 'reported_done', 'leader_checked', 'completed', 'cancelled'\)\)/.test(CODE), 'status list');
  assert(/check \(status <> 'draft' or version = 0\)/.test(CODE), 'draft → version 0');
  assert(/check \(status in \('draft', 'cancelled'\) or version > 0\)/.test(CODE), 'published → version > 0');
  assert(/check \(\(status = 'completed'\) = \(completed_at is not null\)\)/.test(CODE), 'completed_at');
});

test('one current responsible person per task; people history kept', () => {
  assert(/create unique index if not exists wp_task_one_responsible on wp_task_people \(task_id\) where role = 'responsible' and removed_at is null;/.test(CODE), 'one responsible');
  assert(/create unique index if not exists wp_task_people_current on wp_task_people \(task_id, person_id\) where removed_at is null;/.test(CODE), 'one current row per person');
});

test('a blocker is cleared only with a note; a dependency never points at itself', () => {
  assert(/check \(cleared_at is null or btrim\(coalesce\(clear_note, ''\)\) <> ''\)/.test(CODE), 'clear note');
  assert(/check \(task_id <> depends_on\)/.test(CODE), 'self dependency');
});

test('Blocked is derived (open blocker or earlier task not Completed), never stored', () => {
  const b = fnBlock('wp_task_blocked');
  assert(/b\.cleared_at is null/.test(b) && /d\.status <> 'completed'/.test(b), 'wp_task_blocked rule');
  assert(!/\bblocked boolean\b/.test(CODE), 'blocked must not be a stored column');
});

test('a leader role needs the CURRENT leader of the task team', () => {
  assert(/pr_is_current_leader\(t\.team_id, p_user\)/.test(fnBlock('wp_role_on')), 'wp_role_on');
  assert(/pr_is_current_leader\(t\.team_id, p_user\)/.test(fnBlock('wp_can_check')), 'wp_can_check');
});

test('the worker view of a task never carries office-only fields', () => {
  const b = fnBlock('wp_task_doc');
  const split = b.indexOf('|| case when p_office then');
  assert(split > 0, 'the office part must be appended with || case when p_office then');
  const workerPart = b.slice(0, split);
  for (const f of ['source_passage', 'office_flags', 'original_notes', 'acks', 'proposed_by'])
    assert(!workerPart.includes(f), f + ' leaks into the worker part');
  const e = b.indexOf('else jsonb_build_object(');
  assert(e > 0, 'the worker else-branch is missing');
  const elsePart = b.slice(e);
  for (const f of ['source_passage', 'office_flags', 'original_notes', 'acks', 'proposed_by'])
    assert(!elsePart.includes("'" + f + "'"), f + ' leaks into the worker else-branch as a key');
});

test('task-photos: private, JPEG only, 5 MB; insert + two selects, no update/delete', () => {
  assert(/values \('task-photos', 'task-photos', false, 5242880, array\['image\/jpeg'\]\)/.test(CODE), 'bucket row');
  const pols = [...CODE.matchAll(/create policy "task-photos:[^"]*" on storage\.objects for (\w+)/g)].map(m => m[1]);
  assert(pols.sort().join(',') === 'insert,select,select', 'expected insert + two selects, got ' + pols);
});

test('a worker uploads only under their own id, for a task they have a role on', () => {
  const b = fnBlock('wp_can_upload_task_path');
  assert(/\(storage\.foldername\(p_name\)\)\[1\] = auth\.uid\(\)::text/.test(b), 'own folder');
  assert(/wp_role_on\(t\.id, auth\.uid\(\)\) is not null/.test(b), 'role on the task');
});

test('every function in 0093 is SECURITY DEFINER with a pinned search_path', () => {
  const fns = [...CODE.matchAll(/create or replace function[\s\S]*?\$\$;/gi)].map(m => m[0]);
  assert(fns.length > 0, 'no functions');
  const headers = (CODE.match(/create or replace function/gi) || []).length;
  assert(headers === fns.length, 'a function block has no closing $$; (' + headers + ' headers, ' + fns.length + ' blocks)');
  for (const f of fns) {
    assert(/security definer/i.test(f), 'not SECURITY DEFINER: ' + f.slice(0, 70));
    assert(/set search_path = public/i.test(f), 'no search_path: ' + f.slice(0, 70));
  }
});

test('internal helpers are never callable by signed-in users', () => {
  for (const f of ['wp_person_ok\\(uuid, uuid\\)', 'wp_work_valid\\(uuid, uuid, uuid\\)', 'wp_task_blocked\\(uuid\\)',
    'wp_role_on\\(uuid, uuid\\)', 'wp_can_check\\(uuid, uuid\\)', 'wp_depends_on\\(uuid, uuid\\)',
    'wp_task_doc\\(uuid, uuid, boolean\\)', 'wp_op_prev\\(uuid, uuid\\)', 'wp_op_save\\(uuid, uuid, text, jsonb\\)',
    'wp_log\\(uuid, uuid, uuid, text, text, jsonb\\)', 'wp_worker_task\\(uuid\\)', 'wp_office_task_row\\(uuid\\)'])
    assert(new RegExp('revoke all on function ' + f + ' from public, anon, authenticated;').test(CODE), f + ' must be internal');
});

test('a deactivated worker loses task access when an action runs', () => {
  assert(/if not pr_is_requester\(\) then\s+raise exception 'NOT_A_REQUESTER'/.test(fnBlock('wp_worker_task')), 'wp_worker_task must check pr_is_requester first');
  assert(/pr_is_requester\(\) and exists/.test(fnBlock('wp_can_read_task_photo')), 'wp_can_read_task_photo must check pr_is_requester');
});

test('storage policy helpers are callable when signed in, never by anon', () => {
  for (const sig of ['wp_can_upload_task_path\\(text\\)', 'wp_can_read_task_photo\\(text\\)', 'wp_office_task_path_ok\\(text\\)']) {
    assert(new RegExp('revoke all on function ' + sig + ' from public, anon;').test(CODE), sig + ' must revoke from public and anon');
    assert(new RegExp('grant execute on function ' + sig + ' to authenticated;').test(CODE), sig + ' must grant to authenticated');
  }
});

test('company scoping, and photos only for uploader, responsible person or current leader', () => {
  assert(fnBlock('wp_worker_task').includes('owner_id = attendance_data_owner()'), 'wp_worker_task company scope');
  assert(fnBlock('wp_office_task_row').includes('owner_id = data_owner_id()'), 'wp_office_task_row company scope');
  const photo = fnBlock('wp_can_read_task_photo');
  assert(photo.includes('t.owner_id = attendance_data_owner()'), 'wp_can_read_task_photo company scope');
  assert(photo.includes("p.role = 'responsible'"), 'wp_can_read_task_photo responsible person');
  assert(!photo.includes("'helper'"), 'wp_can_read_task_photo must not admit helpers');
  assert(fnBlock('wp_office_task_path_ok').includes('t.owner_id = data_owner_id()'), 'wp_office_task_path_ok company scope');
});

const WORKER_WRITES = ['wp_acknowledge', 'wp_start_work', 'wp_report_progress', 'wp_report_blocker', 'wp_report_done',
  'wp_leader_check', 'wp_propose_task', 'wp_attach_photo'];

test('every worker write: requester check, retry-safe operation, saved first answer', () => {
  for (const f of WORKER_WRITES) {
    const b = fnBlock(f);
    assert(b, f + ' missing');
    assert(/not pr_is_requester\(\)/.test(b) && /'NOT_A_REQUESTER'/.test(b), f + ' requester check');
    assert(/v_prev := wp_op_prev\(p_op, v_uid\);/.test(b) && /return wp_op_save\(p_op, v_uid, '/.test(b), f + ' op pattern');
  }
});

test('every worker write on a task re-checks the caller through wp_worker_task', () => {
  for (const f of WORKER_WRITES.filter(f => f !== 'wp_propose_task'))
    assert(/t := wp_worker_task\(p_task\);/.test(fnBlock(f)), f);
});

test('Start work and Report done are locked while blocked', () => {
  for (const f of ['wp_start_work', 'wp_report_done'])
    assert(/if wp_task_blocked\(t\.id\) then\s+raise exception 'TASK_BLOCKED'/.test(fnBlock(f)), f);
});

test('only the responsible person starts, reports progress and reports done', () => {
  for (const f of ['wp_start_work', 'wp_report_progress', 'wp_report_done'])
    assert(/is distinct from 'responsible' then\s+raise exception 'NOT_RESPONSIBLE'/.test(fnBlock(f)), f);
});

test('a leader check refuses own work and anyone not the current leader', () => {
  const b = fnBlock('wp_leader_check');
  assert(/'OWN_WORK'/.test(b) && /pr_is_current_leader\(t\.team_id, v_uid\)/.test(b) && /'NOT_LEADER'/.test(b), 'leader check');
});

test('an outdated acknowledgement is answered, not recorded; a proposal is a leader-only draft', () => {
  const a = fnBlock('wp_acknowledge');
  assert(/p_version is distinct from t\.version/.test(a) && /'stale', true/.test(a), 'stale handling');
  const p = fnBlock('wp_propose_task');
  assert(/pr_is_current_leader\(p_team, v_uid\)/.test(p) && /proposed_by/.test(p) && !/'not_started'/.test(p), 'proposal');
});

test('worker RPCs are callable when signed in, never by anon', () => {
  for (const sig of ['wp_my_work\\(\\)', 'wp_my_notes\\(\\)', 'wp_acknowledge\\(uuid, uuid, integer\\)', 'wp_start_work\\(uuid, uuid\\)',
    'wp_report_progress\\(uuid, uuid, text\\)', 'wp_report_blocker\\(uuid, uuid, text, text, uuid\\)',
    'wp_report_done\\(uuid, uuid, text\\)', 'wp_leader_check\\(uuid, uuid, text\\)',
    'wp_propose_task\\(uuid, uuid, uuid, uuid, text, text\\)', 'wp_attach_photo\\(uuid, uuid, uuid, bigint, text\\)']) {
    assert(new RegExp('revoke all on function ' + sig + ' from public, anon;').test(CODE), sig + ' revoke');
    assert(new RegExp('grant execute on function ' + sig + ' to authenticated;').test(CODE), sig + ' grant');
  }
});

test('office RPCs refuse non-office callers; list readers return nothing to them', () => {
  for (const f of ['wp_office_meeting', 'wp_office_save_meeting', 'wp_office_save_task', 'wp_office_publish', 'wp_office_board', 'wp_office_task'])
    assert(/if not pr_is_office\(\) then\s+raise exception 'OFFICE_ONLY'/.test(fnBlock(f)), f);
  for (const f of ['wp_office_destinations', 'wp_office_meetings'])
    assert(/pr_is_office\(\)/.test(fnBlock(f)) && /data_owner_id\(\)/.test(fnBlock(f)), f);
});

test('saving a task checks destination, team and people', () => {
  const b = fnBlock('wp_office_save_task');
  assert(/wp_work_valid\(v_owner, v_folder, v_work\)/.test(b), 'destination');
  assert(/'BAD_TEAM'/.test(b) && /'BAD_PERSON'/.test(b) && /pr_is_current_member\(v_team, v_resp\)/.test(b), 'team and people');
  assert(/'NO_RESPONSIBLE'/.test(b), 'a published task keeps a responsible person');
});

test('dependencies stay in one project and cycles are refused under a per-project lock', () => {
  const b = fnBlock('wp_office_save_task');
  assert(/pg_advisory_xact_lock\(hashtext\('wp_deps:' \|\| v_folder::text\)\)/.test(b), 'lock');
  assert(/d\.folder_id = v_folder/.test(b) && /'BAD_DEPENDENCY'/.test(b), 'same project');
  assert(/v_one = v_id or wp_depends_on\(v_one, v_id\)/.test(b) && /'DEPENDENCY_CYCLE'/.test(b), 'cycle');
});

test('an important revision of a published task raises its version', () => {
  assert(/t\.version \+ 1/.test(fnBlock('wp_office_save_task')), 'version bump');
});

test('publishing: responsible required, Not started at version 1, default recipients from the meeting', () => {
  const b = fnBlock('wp_office_publish');
  assert(/'NO_RESPONSIBLE'/.test(b) && /status = 'not_started', version = 1/.test(b), 'publish task');
  assert(/p_recipients is null/.test(b) && /insert into wp_note_recipients/.test(b), 'recipients');
});

test('office planning RPCs are callable when signed in, never by anon', () => {
  for (const sig of ['wp_office_destinations\\(\\)', 'wp_office_meetings\\(\\)', 'wp_office_meeting\\(uuid\\)',
    'wp_office_save_meeting\\(uuid, text, date, text\\)', 'wp_office_save_task\\(uuid, jsonb\\)',
    'wp_office_publish\\(uuid, uuid\\[\\], text, uuid\\[\\], text\\)', 'wp_office_board\\(uuid\\)', 'wp_office_task\\(uuid\\)']) {
    assert(new RegExp('revoke all on function ' + sig + ' from public, anon;').test(CODE), sig + ' revoke');
    assert(new RegExp('grant execute on function ' + sig + ' to authenticated;').test(CODE), sig + ' grant');
  }
});

test('row locks never block dependency inserts; a task others wait for keeps its project', () => {
  for (const f of ['wp_office_save_task', 'wp_office_publish', 'wp_office_clear_blocker', 'wp_worker_task']) {
    const b = fnBlock(f);
    assert(/for no key update;/.test(b) && !/\bfor update;/.test(b), f + ' must lock with FOR NO KEY UPDATE');
  }
  const st = fnBlock('wp_office_save_task');
  assert(/if v_folder is distinct from t\.folder_id then[\s\S]*?pg_advisory_xact_lock\(hashtext\('wp_deps:' \|\| v_one::text\)\)[\s\S]*?where x\.depends_on = t\.id and d\.status <> 'cancelled'\) then\s+raise exception 'BAD_DEPENDENCY'/.test(st), 'folder change locks both projects, then refuses while depended on');
});

test('the office clears a blocker only with a note', () => {
  const b = fnBlock('wp_office_clear_blocker');
  assert(/if not pr_is_office\(\) then\s+raise exception 'OFFICE_ONLY'/.test(b) && /'NOTE_REQUIRED'/.test(b), 'clear blocker');
});

test('approval needs reported work and no open blocker', () => {
  const b = fnBlock('wp_office_approve');
  assert(/t := wp_office_task_row\(p_task\);/.test(b), 'office row');
  assert(/t\.status not in \('reported_done', 'leader_checked'\)/.test(b) && /'TASK_BLOCKED'/.test(b) && /completed_at = now\(\)/.test(b), 'approve');
});

test('send back and reopen need a reason and mark the task Sent back', () => {
  for (const f of ['wp_office_send_back', 'wp_office_reopen']) {
    const b = fnBlock(f);
    assert(/t := wp_office_task_row\(p_task\);/.test(b), f + ' office row');
    assert(/'REASON_REQUIRED'/.test(b) && /status = 'in_progress', sent_back = true/.test(b), f);
  }
  assert(/completed_at = null/.test(fnBlock('wp_office_reopen')), 'reopen clears completed_at');
});

test('cancel needs a reason and refuses a task others still wait for', () => {
  const b = fnBlock('wp_office_cancel');
  assert(/'REASON_REQUIRED'/.test(b) && /'HAS_DEPENDENTS'/.test(b) && /x\.depends_on = t\.id/.test(b), 'cancel');
  assert(/perform pg_advisory_xact_lock\(hashtext\('wp_deps:' \|\| t\.folder_id::text\)\);\s+if exists \(select 1 from wp_dependencies x/.test(b), 'cancel serialises with dependency edits');
  assert(/for no key update;/.test(fnBlock('wp_office_task_row')) && !/\bfor update;/.test(fnBlock('wp_office_task_row')), 'office row lock is FOR NO KEY UPDATE');
});

test('decision RPCs are callable when signed in, never by anon', () => {
  for (const sig of ['wp_office_clear_blocker\\(uuid, text\\)', 'wp_office_approve\\(uuid, text\\)',
    'wp_office_send_back\\(uuid, text\\)', 'wp_office_reopen\\(uuid, text\\)', 'wp_office_cancel\\(uuid, text\\)']) {
    assert(new RegExp('revoke all on function ' + sig + ' from public, anon;').test(CODE), sig + ' revoke');
    assert(new RegExp('grant execute on function ' + sig + ' to authenticated;').test(CODE), sig + ' grant');
  }
});

test('npm test runs this suite', () => {
  assert(read('package.json').includes('node tests/workmate-workplan.test.js'), 'package.json test script');
});

test('the acceptance script is self-rolling-back, editor-safe and ends with the success row', () => {
  const a = read('supabase/tests/1c_acceptance.sql');
  assert(a.length > 0, 'missing supabase/tests/1c_acceptance.sql');
  assert(/^begin;$/m.test(a) && /\nrollback;\s*$/.test(a), 'begin … rollback');
  assert(!/create temp table/i.test(a), 'no temp table (the SQL editor breaks it)');
  assert(/'1c acceptance: all checks passed'/.test(a), 'success row');
});

test('docs record 0093 and the next number', () => {
  const readme = read('supabase/migrations/README.md');
  assert(/\*\*0093 \(WorkMate Stage 1c-1/.test(readme), 'README paragraph');
  const m = /\*\*(\d{4})\*\* — highest on disk is\s+`(\d{4})_/.exec(readme);
  assert(m, 'README next-number line');
  assert(Number(m[1]) === Number(m[2]) + 1 && Number(m[2]) >= 93, 'next number is highest + 1 and at least 0094');
  const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  assert(files[files.length - 1].startsWith(m[2]), 'README names the highest migration on disk: ' + files[files.length - 1]);
  assert(/wp_tasks/.test(read('docs/DATABASE_SCHEMA.md')), 'DATABASE_SCHEMA.md section');
});

test('Start work needs the current version acknowledged and never acknowledges by itself', () => {
  const b = fnBlock('wp_start_work');
  assert(/a\.version = t\.version\) then\s+raise exception 'NOT_ACKNOWLEDGED'/.test(b), 'NOT_ACKNOWLEDGED gate');
  assert(!/insert into wp_acks/.test(b), 'start must not insert an acknowledgement');
});

test('a worker history hides acknowledgements and proposals; an assigned leader cannot check', () => {
  assert(/e\.task_id = t\.id and \(p_office or e\.kind not in \('acknowledged', 'proposed'\)\)/.test(fnBlock('wp_task_doc')), 'history filter');
  assert(/wp_role_on\(t\.id, v_uid\) in \('responsible', 'helper'\) then\s+raise exception 'OWN_WORK'/.test(fnBlock('wp_leader_check')), 'helper is own work');
  assert(!/p\.role = 'responsible'/.test(fnBlock('wp_can_check')), 'can_check excludes any assignment');
});

// ── Tasks 2–5 append their tests above this line ──

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
