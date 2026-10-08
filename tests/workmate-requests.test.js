// ════════════════════════════════════════════════════════════════════
// WORKMATE REQUESTS (0085) STATIC TESTS: run with  node tests/workmate-requests.test.js
//
// Zero dependencies. Guards the shape of migration 0085:
//   - every pr_* table has RLS and NO policy that lets a worker in
//     (workers reach requests only through SECURITY DEFINER RPCs);
//   - no pr_* column can hold money;
//   - every SECURITY DEFINER function pins its search_path;
//   - worker RPCs are granted, internal helpers are not;
//   - the legacy requests tables are own-read-only for workers.
// The LIVE behaviour is checked by supabase/tests/0085_verify.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/0085_workmate_requests.sql');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SQL = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
const CODE = SQL.replace(/--.*$/gm, '');

/** The `create table if not exists <name> ( ... );` statement, or ''. */
function tableBlock(name) {
  const m = CODE.match(new RegExp('create table if not exists ' + name + '\\s*\\(([\\s\\S]*?)\\n\\);', 'i'));
  return m ? m[1] : '';
}
/** The `create or replace function <name>(...` ... `$$;` statement, or ''. */
function fnBlock(name) {
  const m = CODE.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\$\\$;', 'i'));
  return m ? m[0] : '';
}
const PR_TABLES = () => [...CODE.matchAll(/create table if not exists (pr_\w+)/gi)].map(m => m[1]);

console.log('\nworkmate-requests (0085)');

test('the migration exists', () => assert(SQL.length > 0, 'missing ' + MIGRATION));

test('setup tables exist', () => {
  for (const t of ['pr_teams', 'pr_team_members', 'pr_catalog_items', 'pr_project_settings', 'pr_batches']) {
    assert(tableBlock(t), 'no table ' + t);
  }
});

test('every pr_* table has row level security', () => {
  for (const t of PR_TABLES()) {
    assert(new RegExp('alter table ' + t + ' enable row level security', 'i').test(CODE), t + ' has no RLS');
  }
});

test('no pr_* policy lets a worker in', () => {
  const policies = [...CODE.matchAll(/create policy[\s\S]*?;/gi)].map(m => m[0]).filter(p => /\bon\s+(public\.)?pr_\w+/i.test(p));
  assert(policies.length > 0, 'no pr_* policies found');
  for (const p of policies) {
    assert(!/is_worker\(|pr_is_requester\(|auth\.uid\(\)/i.test(p), 'worker-reachable policy: ' + p.slice(0, 120));
  }
});

test('no pr_* column can hold money', () => {
  for (const t of PR_TABLES()) {
    const cols = tableBlock(t).split('\n').map(l => l.trim().split(/\s+/)[0].toLowerCase());
    for (const c of cols) assert(!/price|amount|cost|total|peso/.test(c), t + '.' + c + ' looks like money');
  }
});

test('every SECURITY DEFINER function pins search_path', () => {
  const fns = [...CODE.matchAll(/create or replace function[\s\S]*?\$\$;/gi)].map(m => m[0]);
  for (const f of fns.filter(f => /security definer/i.test(f))) {
    assert(/set search_path = public/i.test(f), 'no search_path: ' + f.slice(0, 80));
  }
});

test('one current leader per team', () => {
  assert(/create unique index if not exists pr_team_one_leader on pr_team_members\s*\(team_id\)\s*where is_leader and removed_at is null/i.test(CODE),
    'missing the one-leader index');
});

test('a leader is named on the team AND holds the teamLeader role', () => {
  const f = fnBlock('pr_is_current_leader');
  assert(/is_leader/.test(f) && /removed_at is null/.test(f) && /'teamLeader'/.test(f) && /t\.active/.test(f), 'leader rule incomplete');
});

test('the cutoff is Saturday 12:00 noon, Manila time', () => {
  const f = fnBlock('pr_cutoff_after');
  assert(/'Asia\/Manila'/.test(f), 'not Manila time');
  assert(/isodow/.test(f) && /\b6\b/.test(f), 'not Saturday (isodow 6)');
  assert(/time '12:00'/.test(f), 'not 12:00 noon');
});

test('batches default to Monday purchasing and Wednesday delivery', () => {
  const f = fnBlock('pr_batch_for');
  assert(/v_day \+ 2/.test(f) && /v_day \+ 4/.test(f), 'purchase/delivery offsets are not +2/+4');
});

test('requestable projects are top-level, open Project Control folders', () => {
  const f = fnBlock('pr_project_open');
  assert(/from folders f/.test(f) && /parent_folder_id is null/.test(f) && /completed_at is null/.test(f), 'project rule incomplete');
  assert(/attendance_data_owner\(\)/.test(f), 'not owner-scoped');
  assert(!/construction_projects/.test(f), 'PM must never be a destination');
});

test('requestable = Attendance picker rule (not hidden) plus Allow requests', () => {
  const f = fnBlock('pr_project_open');
  assert(/attendance_project_config/.test(f) && /not h\.attendance_enabled/.test(f), 'a site hidden from Time In must not be requestable');
  assert(/allow_requests/.test(f), 'Allow requests must still open a project');
});

test('pr_project_settings.folder_id cascades with its folder', () => {
  assert(/folder_id uuid primary key references folders\(id\) on delete cascade/.test(tableBlock('pr_project_settings')), 'missing on delete cascade');
});

test('an unchanged quantity writes no version, event or portion work', () => {
  assert(/p_quantity = v_current/.test(fnBlock('pr_change_quantity')), 'no equal-quantity short-circuit');
});

test('request tables exist', () => {
  for (const t of ['pr_requests', 'pr_lines', 'pr_line_portions', 'pr_line_conflicts', 'pr_events', 'pr_ops', 'pr_photos']) {
    assert(tableBlock(t), 'no table ' + t);
  }
});

test('a retried submit cannot create a second request', () => {
  assert(/unique \(requester_id, client_op_id\)/i.test(tableBlock('pr_requests')), 'pr_requests needs unique (requester_id, client_op_id)');
  assert(/primary key \(actor_id, op_id\)/i.test(tableBlock('pr_ops')), 'pr_ops needs primary key (actor_id, op_id)');
});

test('an urgent line must carry a reason and a needed-by date', () => {
  assert(/check \(not urgent or \(btrim\(coalesce\(urgent_reason, ''\)\) <> '' and needed_by is not null\)\)/i.test(tableBlock('pr_lines')),
    'pr_lines urgent check missing');
});

test('a portion can never flag more than it holds', () => {
  assert(/pending_reduction numeric\(12,3\) not null default 0 check \(pending_reduction >= 0 and pending_reduction <= quantity\)/i.test(tableBlock('pr_line_portions')),
    'pending_reduction bounds missing');
});

test('request data is read-only to the office through RLS (changes go through RPCs)', () => {
  for (const t of ['pr_requests', 'pr_lines', 'pr_line_portions', 'pr_line_conflicts', 'pr_events', 'pr_ops', 'pr_photos']) {
    const pols = [...CODE.matchAll(new RegExp('create policy \\w+ on ' + t + '\\b[\\s\\S]*?;', 'gi'))].map(m => m[0]);
    assert(pols.length === 1, t + ' should have exactly one policy, found ' + pols.length);
    assert(/for select/i.test(pols[0]) && /is_owner\(\) or is_staff\(\)/i.test(pols[0]), t + ' policy must be owner/staff SELECT only');
  }
});

test('every pr_* policy is tenant-scoped with can_access(owner_id)', () => {
  const pols = [...CODE.matchAll(/create policy[\s\S]*?;/gi)].map(m => m[0]).filter(p => /\bon\s+(public\.)?pr_\w+/i.test(p));
  assert(pols.length > 0, 'no pr_* policies found');
  for (const p of pols) {
    const table = p.match(/\bon\s+(?:public\.)?(pr_\w+)/i)[1];
    if (table === 'pr_ops') {
      // pr_ops has no owner_id column: scope through the actor's owner.
      assert(/can_access\(\(select coalesce\(p\.owner_id, p\.id\) from profiles p where p\.id = pr_ops\.actor_id\)\)/i.test(p), 'pr_ops policy not scoped through actor_id');
    } else {
      assert(/can_access\(owner_id\)/i.test(p), 'not tenant-scoped: ' + p.slice(0, 100));
    }
    if (/can_access\(owner_id\)/i.test(p)) {
      assert(/^\s*owner_id uuid\b/m.test(tableBlock(table)), table + ' policy uses owner_id but the table has no owner_id column');
    }
  }
});

test('worker read RPCs exist and require an active worker', () => {
  for (const f of ['pr_destinations', 'pr_my_teams', 'pr_catalog']) {
    const b = fnBlock(f);
    assert(b, 'no function ' + f);
    assert(/security definer/i.test(b), f + ' must be SECURITY DEFINER');
    assert(/pr_is_requester\(\)/.test(b), f + ' must check pr_is_requester()');
    assert(/attendance_data_owner\(\)|pr_project_open\(/.test(b), f + ' must be owner-scoped');
  }
});

test('destinations offer Main Contract and open Additional Works only', () => {
  const b = fnBlock('pr_destinations');
  assert(/'Main Contract'/.test(b), 'Main Contract label missing');
  assert(/parent_folder_id = f\.id/.test(b) && /completed_at is null/.test(b), 'Additional Works rule missing');
  assert(!/construction_projects/.test(b), 'PM must never be a destination');
});

test("teams never expose colleagues' contact details", () => {
  const b = fnBlock('pr_my_teams');
  assert(!/email|phone|contact/i.test(b), 'pr_my_teams must not return email/phone');
  assert(/pr_person_name\(/.test(b), 'names come from pr_person_name');
});

test('submit checks the operation id BEFORE writing anything', () => {
  const b = fnBlock('pr_submit_request');
  assert(b, 'no function pr_submit_request');
  const look = b.search(/from pr_ops/i), write = b.search(/insert into pr_requests/i);
  assert(look > 0 && write > look, 'pr_ops lookup must come before the first insert');
  assert(/insert into pr_ops/i.test(b), 'the result must be stored in pr_ops');
});

test('submit enforces destination, team and leader rules on the server', () => {
  const b = fnBlock('pr_submit_request');
  for (const needle of ['pr_work_open(', 'pr_is_current_member(', 'pr_is_current_leader(', "'DESTINATION_CLOSED'", "'NOT_IN_TEAM'", "'NOT_TEAM_LEADER'", "'BAD_MEMBER'"]) {
    assert(b.includes(needle), 'missing ' + needle);
  }
  assert(!/construction_projects/.test(b), 'PM must never be a destination');
});

test("submit batches by the SERVER's received time, never the phone's", () => {
  const b = fnBlock('pr_submit_request');
  assert(/v_now timestamptz := now\(\)/.test(b) && /pr_batch_for\(v_owner, v_now\)/.test(b), 'batch must come from now()');
  assert(!/pr_batch_for\([^)]*drafted/i.test(b), 'drafted_at must never pick the batch');
});

test('submit caps a request at 100 lines', () => {
  assert(/> 100/.test(fnBlock('pr_submit_request')) && /'TOO_MANY_LINES'/.test(fnBlock('pr_submit_request')), 'line cap missing');
});

test('a decrease removes the newest unarranged quantity first, then only FLAGS arranged quantity', () => {
  const b = fnBlock('pr_apply_quantity');
  assert(b, 'no function pr_apply_quantity');
  const unarranged = b.search(/arranged_at is null\s+order by created_at desc/i);
  const arranged = b.search(/arranged_at is not null\s+order by created_at desc/i);
  assert(unarranged > 0 && arranged > 0, 'both passes must walk newest first');
  assert(/pending_reduction = pending_reduction \+ v_take/.test(b), 'arranged quantity must be flagged, not shrunk');
});

test('an increase first takes back a pending reduction, then adds to the batch for NOW', () => {
  const b = fnBlock('pr_apply_quantity');
  assert(/pending_reduction = pending_reduction - v_take/.test(b), 'increase must absorb pending reductions first');
  assert(/pr_batch_for\(p_owner, now\(\)\)/.test(b), 'new quantity must join the batch for now()');
});

test('an outdated edit is kept as a conflict, never applied', () => {
  const b = fnBlock('pr_change_quantity');
  assert(b, 'no function pr_change_quantity');
  assert(/p_base_version is distinct from l\.version/.test(b), 'version check missing');
  assert(/insert into pr_line_conflicts/i.test(b) && /has_conflict = true/.test(b), 'conflict must be recorded and flagged');
});

test('quantity and cancel RPCs are retry-safe and owner-only', () => {
  for (const f of ['pr_change_quantity', 'pr_cancel_line', 'pr_cancel_request']) {
    const b = fnBlock(f);
    assert(b, 'no function ' + f);
    const look = b.search(/from pr_ops/i), firstWrite = b.search(/insert into|update pr_|perform pr_apply_quantity/i);
    assert(look > 0 && firstWrite > look, f + ': pr_ops lookup must precede writes');
    assert(/requester_id <> v_uid/.test(b), f + ': requester-only check missing');
    assert(/insert into pr_ops/i.test(b), f + ': result not stored');
  }
});

test('completed work refuses quantity increases only', () => {
  const b = fnBlock('pr_change_quantity');
  assert(/p_quantity > v_current and not pr_work_open\(/.test(b), 'increase-only completed check missing');
});

test('my requests = mine, plus my teams when I am their current leader', () => {
  const b = fnBlock('pr_my_requests');
  assert(b, 'no function pr_my_requests');
  assert(/r\.requester_id = auth\.uid\(\)/.test(b) && /pr_is_current_leader\(r\.team_id, auth\.uid\(\)\)/.test(b), 'visibility rule missing');
  assert(/r\.owner_id = attendance_data_owner\(\)/.test(b) && /pr_is_requester\(\)/.test(b), 'not owner/requester scoped');
  assert(!/email|phone/i.test(b), 'must not return contact details');
  assert(/least\(coalesce\(p_limit, 50\), 200\)/.test(b), 'limit must be clamped');
});

test('request photos live in their own PRIVATE bucket', () => {
  assert(/insert into storage\.buckets[\s\S]*'request-photos', 'request-photos', false, 5242880, array\['image\/jpeg'\]/.test(CODE), 'bucket definition wrong');
  assert(!/'uploads'/.test(CODE), 'request photos must never touch the legacy uploads bucket');
});

test('photo policies: requester uploads own path; requester, team leader and office read', () => {
  const pols = [...CODE.matchAll(/create policy "request-photos:[^"]*" on storage\.objects[\s\S]*?;/gi)].map(m => m[0]);
  assert(pols.length === 3, 'expected 3 request-photos policies, found ' + pols.length);
  assert(pols.some(p => /for insert/i.test(p) && /pr_owns_request_path\(name\)/.test(p)), 'upload policy missing');
  assert(pols.some(p => /for select/i.test(p) && /pr_can_read_request_photo\(name\)/.test(p)), 'requester/leader read policy missing');
  assert(pols.some(p => /for select/i.test(p) && /is_owner\(\) or is_staff\(\)/.test(p)), 'office read policy missing');
  assert(!pols.some(p => /for (update|delete|all)/i.test(p)), 'workers must not update or delete photos');
  assert(pols.some(p => /is_owner\(\) or is_staff\(\)/.test(p) && /can_access\(r\.owner_id\)/.test(p)), 'office photo read must be tenant-scoped');
});

test('attaching a photo needs the uploaded object, the right path and a retry-safe op', () => {
  const b = fnBlock('pr_attach_photo');
  assert(b, 'no function pr_attach_photo');
  assert(/from storage\.objects/.test(b) && /'PHOTO_NOT_UPLOADED'/.test(b), 'must check the object exists');
  assert(/'BAD_PATH'/.test(b) && /v_uid::text \|\| '\/' \|\| p_request::text \|\| '\/'/.test(b), 'path prefix check missing');
  assert(/from pr_ops/.test(b) && /insert into pr_ops/.test(b), 'not retry-safe');
});

test('quantities are rejected when finer than the numeric(12,3) column', () => {
  assert(/<> round\(v_qty, 3\)/.test(fnBlock('pr_submit_request')), 'submit precision check missing');
  assert(/<> round\(p_quantity, 3\)/.test(fnBlock('pr_change_quantity')), 'change precision check missing');
});

test('every worker write serialises duplicate ops with an advisory lock before the pr_ops lookup', () => {
  for (const f of ['pr_submit_request', 'pr_change_quantity', 'pr_cancel_line', 'pr_cancel_request', 'pr_attach_photo']) {
    const b = fnBlock(f);
    const lock = b.search(/pg_advisory_xact_lock\(/), look = b.search(/from pr_ops/);
    assert(lock > 0 && look > lock, f + ': advisory lock must precede the pr_ops lookup');
  }
});

test('an increase locks the target portion and only grows an unarranged one', () => {
  const b = fnBlock('pr_apply_quantity');
  assert(/limit 1 for update/.test(b) && /where id = v_target and arranged_at is null/.test(b) && /not found/.test(b), 'portion race guard missing');
});

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORKER_RPCS = ['pr_destinations()', 'pr_my_teams()', 'pr_catalog()', 'pr_submit_request(uuid, jsonb)',
  'pr_change_quantity(uuid, uuid, integer, numeric)', 'pr_cancel_line(uuid, uuid)', 'pr_cancel_request(uuid, uuid)',
  'pr_my_requests(integer)', 'pr_attach_photo(uuid, uuid, uuid, text)'];
const POLICY_HELPERS = ['pr_is_requester()', 'pr_owns_request_path(text)', 'pr_can_read_request_photo(text)'];
const INTERNAL = ['pr_person_name(uuid)', 'pr_is_current_member(uuid, uuid)', 'pr_is_current_leader(uuid, uuid)',
  'pr_project_open(uuid)', 'pr_work_open(uuid, uuid)', 'pr_cutoff_after(timestamptz)', 'pr_batch_for(uuid, timestamptz)',
  'pr_apply_quantity(uuid, numeric, uuid)'];

test('worker RPCs and policy helpers: signed-in users only, never anon', () => {
  for (const f of [...WORKER_RPCS, ...POLICY_HELPERS]) {
    assert(new RegExp('revoke all on function ' + esc(f) + ' from public, anon;', 'i').test(CODE), 'missing revoke for ' + f);
    assert(new RegExp('grant execute on function ' + esc(f) + ' to authenticated;', 'i').test(CODE), 'missing grant for ' + f);
  }
});

test('internal helpers are callable by nobody', () => {
  for (const f of INTERNAL) {
    assert(new RegExp('revoke all on function ' + esc(f) + ' from public, anon, authenticated;', 'i').test(CODE), 'missing revoke for ' + f);
    assert(!new RegExp('grant execute on function ' + esc(f), 'i').test(CODE), f + ' must not be granted');
  }
});

test('every function in the migration is classified', () => {
  const names = [...CODE.matchAll(/create or replace function (pr_\w+)\s*\(/gi)].map(m => m[1]);
  const known = [...WORKER_RPCS, ...POLICY_HELPERS, ...INTERNAL].map(s => s.split('(')[0]);
  for (const n of names) assert(known.includes(n), n + ' has no permission decision');
});

test('legacy requests: workers read only their own and write nothing', () => {
  assert(/drop policy if exists requests_worker_create on requests;/i.test(CODE), 'requests_worker_create not dropped');
  assert(/drop policy if exists requests_worker_update on requests;/i.test(CODE), 'requests_worker_update not dropped');
  assert(/drop policy if exists request_items_rw on request_items;/i.test(CODE), 'request_items_rw not dropped');
  const read = CODE.match(/create policy requests_read on requests[\s\S]*?;/i);
  assert(read && /is_worker\(\) and requested_by = auth\.uid\(\)/.test(read[0]), 'requests_read must be own-only for workers');
  const items = [...CODE.matchAll(/create policy (request_items_\w+) on request_items[\s\S]*?;/gi)].map(m => m[0]);
  const worker = items.filter(p => /request_items_worker_read/.test(p));
  assert(worker.length === 1 && /for select/i.test(worker[0]) && /r\.requested_by = auth\.uid\(\)/.test(worker[0]), 'exactly one worker item policy: SELECT own only');
  const admin = items.filter(p => !/request_items_worker_read/.test(p));
  assert(admin.length >= 1, 'owner/staff item policies missing');
  for (const p of admin) {
    assert(/is_owner\(\) or is_staff\(\)/.test(p) && !/is_worker\(\)/.test(p) && !/auth\.uid\(\)/.test(p), 'item policy must be owner/staff only: ' + p.slice(0, 60));
    assert(!/for all/i.test(p), 'no for-all policy: ' + p.slice(0, 60));
  }
});

// ── 0088: worker cancel alignment ──
const M88 = path.join(ROOT, 'supabase/migrations/0088_pr_worker_cancel_alignment.sql');
const M86 = path.join(ROOT, 'supabase/migrations/0086_workmate_requests_office.sql');
const CODE88 = fs.existsSync(M88) ? fs.readFileSync(M88, 'utf8').replace(/--.*$/gm, '') : '';
const CODE86 = fs.existsSync(M86) ? fs.readFileSync(M86, 'utf8').replace(/--.*$/gm, '') : '';
function fnIn(code, name) {
  const m = code.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\$\\$;', 'i'));
  return m ? m[0] : '';
}
const norm = x => x.replace(/\s+/g, ' ').trim();
const REQ_LOCK = /perform 1 from pr_requests r where r\.id = \(select x\.request_id from pr_lines x where x\.id = p_line\) for (no key )?update;/;

console.log('\nworkmate-requests (0088)');

for (const name of ['pr_cancel_line', 'pr_cancel_request']) {
  test('0088 ' + name + ': definer, pinned path, requester check, pr_ops replay', () => {
    const f = fnIn(CODE88, name);
    assert(f, 'no ' + name + ' in 0088');
    assert(/security definer/i.test(f), 'not security definer');
    assert(/set search_path = public/i.test(f), 'search_path not pinned');
    assert(/pr_is_requester\(\)/.test(f), 'no pr_is_requester() check');
    assert(/select o\.result into v_prev from pr_ops/.test(f), 'no pr_ops replay');
  });
}

test('0088 pr_cancel_line: request lock is FOR NO KEY UPDATE and precedes the line lock', () => {
  const f = fnIn(CODE88, 'pr_cancel_line');
  const lock = f.search(REQ_LOCK);
  assert(lock >= 0 && /for no key update;/.test(f.match(REQ_LOCK)[0]), 'request lock must be for no key update');
  const lineLock = f.indexOf('for update of ln');
  assert(lineLock > lock, 'request lock must come before "for update of ln"');
});

test('0088 pr_cancel_request: request lock is FOR NO KEY UPDATE', () => {
  const f = fnIn(CODE88, 'pr_cancel_request');
  assert(/from pr_requests where id = p_request for no key update;/.test(f), 'request lock must be for no key update');
});

test('0088 pr_cancel_line closes the request when no open line is left', () => {
  const f = fnIn(CODE88, 'pr_cancel_line');
  assert(f.includes('request_cancelled'), 'no request_cancelled event');
  assert(f.includes("'by', 'worker'"), "no 'by', 'worker' detail");
});

test('0088 pr_office_cancel_line equals 0086 except for the NO KEY UPDATE request lock', () => {
  const f88 = fnIn(CODE88, 'pr_office_cancel_line');
  const f86 = fnIn(CODE86, 'pr_office_cancel_line');
  assert(f88 && f86, 'pr_office_cancel_line missing in 0088 or 0086');
  assert(/for no key update;/.test(f88.match(REQ_LOCK) ? f88.match(REQ_LOCK)[0] : ''), '0088 office cancel must use for no key update');
  const expected = norm(f86.replace(/(where x\.id = p_line\) )for update;/, '$1for no key update;'));
  assert(norm(f88) === expected, 'body differs from 0086 beyond the request lock');
});

// ── SUMMARY (keep last) ──
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
