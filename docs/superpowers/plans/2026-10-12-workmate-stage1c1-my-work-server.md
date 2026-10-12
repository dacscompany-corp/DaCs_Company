# WorkMate Stage 1c-1 — My Work Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One migration (0093) gives My Work its server: meetings with office-only original notes and published shared-note versions, tasks (draft → published → done → leader check → office approval), responsible person + helpers, per-version acknowledgements, blockers, same-project dependencies, a derived *Blocked* state that locks Start work / Report done, leader proposals, private task photos, worker RPCs, office RPCs — with a live acceptance script and a static test suite.

**Architecture:** New `wp_*` tables (work plan), all RLS-on with office SELECT policies only; workers reach nothing directly. Every worker write is a retry-safe `SECURITY DEFINER` RPC (`wp_ops`, like `pr_ops`) that re-checks the caller's role on the task at run time through one helper (`wp_worker_task`). One document builder, `wp_task_doc(task, viewer, office)`, decides what a worker vs the office sees. *Blocked* is never stored: `wp_task_blocked` derives it from open blockers and unfinished predecessors. Teams, leaders and worker names reuse 1a (`pr_teams`, `pr_is_current_leader`, `pr_person_name`).

**Tech Stack:** Supabase Postgres (SQL migration, plpgsql), Supabase Storage policies, Node zero-dependency static tests (as `tests/workmate-history.test.js`), a self-rolling-back acceptance script (editor-safe: `set_config('v1c.*')`, no temp table).

**Spec:** `docs/superpowers/specs/2026-09-30-workmate-meetings-work-plan-design.md` — §3 roles, §6 publishing, §7 acknowledgements, §8 blockers/dependencies, §9 completion, §11 offline, §13 acceptance, **§15 decisions (12 October 2026)**. Answer sheet: `docs/superpowers/specs/2026-10-12-workmate-stage1c-questions.md`.

## Global Constraints

- **Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs Web`. All paths are relative to it.
- **NEVER `git commit` / `git push`.** The user commits. Every task ends "Stop — no commit".
- **NEVER run `npm run build`.**
- **Migration number 0093**, file `supabase/migrations/0093_workmate_my_work.sql` (highest on disk is `0092_pr_catalog_kind_unit_lock.sql`; re-check with `ls supabase/migrations | sort | tail -3` before creating — if a higher number exists, use highest + 1 everywhere this plan says 0093). **Never apply anything to the live database from a task** — the user dry-runs and applies it (Task 6).
- **Idempotent DDL:** `create table if not exists`, `create index if not exists`, `create or replace function`, `drop policy if exists` before every `create policy`. The file must apply cleanly twice.
- **`set local lock_timeout = '5s';`** directly after the header comment (as 0090).
- **No money:** no column, JSON key or function in 0093 may hold or return a price, amount, cost or total. Outside the money model; nothing feeds Spent / Earned / Profit, Attendance or payroll.
- **Workers reach `wp_*` only through RPCs:** RLS on every `wp_*` table; the only policies are office `select` ones; `revoke all ... from anon` and `revoke insert, update, delete, truncate, references, trigger ... from authenticated` on every `wp_*` table.
- **Every function** is `SECURITY DEFINER` with `set search_path = public`. Worker/office RPCs and storage-policy helpers: `revoke all ... from public, anon; grant execute ... to authenticated`. Internal helpers: `revoke all ... from public, anon, authenticated`, never granted.
- **Who:** worker = `pr_is_requester()` (role worker/teamLeader, active), company = `attendance_data_owner()`. Office = `pr_is_office()` (owner/staff), company = `data_owner_id()`, row check `can_access(owner_id)`. A team leader acts only as `pr_is_current_leader(team, user)` (role + current leader row).
- **Roles on a task** (`wp_role_on`): `'responsible'` or `'helper'` from `wp_task_people` (current row), else `'leader'` when the caller is the current leader of the task's team, else null. Only assigned people (responsible/helper) acknowledge; only the responsible person starts, reports progress and reports done; any role may report a blocker; a leader checks only when not the responsible person.
- **States (spec §15):** `draft → not_started → in_progress → reported_done → leader_checked → completed`, plus `cancelled`. *Sent back* = `in_progress` with `sent_back = true` (cleared on the next Report done). *Blocked* is derived (`wp_task_blocked`): an open blocker or a dependency whose task is not `completed`. Start work and Report done refuse `TASK_BLOCKED`; office approval also refuses while blocked. Leader check is recorded but never replaces office approval; the office may approve from `reported_done` or `leader_checked`.
- **Workers never receive:** the meeting's `original_notes`, a task's `source_passage` / `office_flags` / `proposed_by` / acknowledgement list, tasks they have no role on, or notes of a meeting version they are not a recipient of.
- **Error codes** (`raise exception '<CODE>' using errcode = 'P0001'`), new in 0093: `NOT_ASSIGNED`, `NOT_RESPONSIBLE`, `NOT_LEADER`, `OWN_WORK`, `TASK_BLOCKED`, `BAD_STATE`, `BAD_KIND`, `BAD_REQUEST`, `BAD_LINK`, `NOTE_REQUIRED`, `TITLE_REQUIRED`, `BAD_DATES`, `BAD_TEAM`, `BAD_PERSON`, `NO_RESPONSIBLE`, `BAD_DEPENDENCY`, `DEPENDENCY_CYCLE`, `HAS_DEPENDENTS`, `TASK_CLOSED`; reused: `NOT_A_REQUESTER`, `OFFICE_ONLY`, `NOT_FOUND`, `BAD_OPERATION`, `BAD_DESTINATION`, `REASON_REQUIRED`, `BAD_PATH`, `PHOTO_NOT_UPLOADED`.
- **Task photos:** private bucket **`task-photos`**, JPEG only, 5 MB (`5242880`). Path `<uploader_id>/<task_id>/<uuid>.jpg`. Upload: an assigned person / leader of a published task, under their own id. Read: the uploader, the task's responsible person, the current leader of its team, and the office of its company. **No update or delete policy** for anyone. (A new bucket, not an `uploads` top folder — no `uploads_can_*` rule needed.)
- **Line endings:** SQL/JS files LF. `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are **CRLF** — keep them CRLF. Edit those two with Python bytes (`open(p, 'rb')` / `open(p, 'wb')`), **never PowerShell text output** (BOM/mojibake). Keep `package.json`'s existing line endings.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0093_workmate_my_work.sql` (create) | The whole server change, sections §1–§7, each ending with its own grants |
| `tests/workmate-workplan.test.js` (create) | Static shape tests for 0093; grows each task |
| `supabase/tests/1c_acceptance.sql` (create, Task 5) | Live behaviour, self-rolling-back, editor-safe |
| `package.json` (modify, Task 5) | Append the new static test to `npm test` |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` (modify, Task 5) | 0093 paragraph, next number 0094, new tables/RPCs |

---

### Task 1: Schema, task photos and the shared helpers

**Files:**
- Create: `supabase/migrations/0093_workmate_my_work.sql` (header + §1–§3)
- Create: `tests/workmate-workplan.test.js`

**Interfaces:**
- Produces (tables): `wp_meetings`, `wp_meeting_versions`, `wp_note_recipients`, `wp_tasks`, `wp_task_people`, `wp_acks`, `wp_blockers`, `wp_dependencies`, `wp_events`, `wp_ops`, `wp_photos`; bucket `task-photos`.
- Produces (internal, used by Tasks 2–4):
  - `wp_person_ok(p_person uuid, p_owner uuid) returns boolean` — active worker/teamLeader of that company
  - `wp_work_valid(p_owner uuid, p_folder uuid, p_work uuid) returns boolean` — open top-level PC project of that company; work = the project or its own open AW child
  - `wp_task_blocked(p_task uuid) returns boolean`
  - `wp_role_on(p_task uuid, p_user uuid) returns text` — `'responsible' | 'helper' | 'leader' | null`
  - `wp_can_check(p_task uuid, p_user uuid) returns boolean`
  - `wp_depends_on(p_from uuid, p_target uuid) returns boolean` — `p_from` (transitively) waits for `p_target`
  - `wp_task_doc(p_task uuid, p_viewer uuid, p_office boolean) returns jsonb`
  - `wp_op_prev(p_op uuid, p_uid uuid) returns jsonb` — locks the op; returns its stored result or null
  - `wp_op_save(p_op uuid, p_uid uuid, p_kind text, p_result jsonb) returns jsonb`
  - `wp_log(p_owner uuid, p_task uuid, p_meeting uuid, p_kind text, p_note text, p_detail jsonb) returns bigint` — event id; actor = `auth.uid()`
  - `wp_worker_task(p_task uuid) returns wp_tasks` — locks the task (`for update`); `NOT_ASSIGNED` unless the caller has a role on a published, non-cancelled task of their company
  - `wp_office_task_row(p_task uuid) returns wp_tasks` — `OFFICE_ONLY` / `NOT_FOUND`; locks the task
- Produces (storage helpers, granted): `wp_can_upload_task_path(text)`, `wp_can_read_task_photo(text)`, `wp_office_task_path_ok(text)`.
- `wp_task_doc` keys (worker): `id, meeting_id, title, instructions, folder_id, project_name, work_id, work_name, team_id, team_name, status, sent_back, blocked, planned_start, planned_end, version, version_at, published_at, completed_at, updated_at, responsible {id,name}, helpers [{id,name}], blockers [{id,kind,description,request_id,reported_at,reported_by}], waiting_for [{task_id,title,status}], photos [{id,path,blocker_id,event_id,created_at}], history [{id,kind,note,by,at}], my_role, my_ack_version, can_check`. Office adds instead of the last three: `source_passage, office_flags, proposed_by, acks [{person_id,name,role,acked}], not_acknowledged_24h, overdue, depends_on [uuid]`.

- [ ] **Step 1: Write the failing test file**

Create `tests/workmate-workplan.test.js`:

```js
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
  assert(!/create policy [^\n]* on wp_\w+ for (insert|update|delete|all)/.test(CODE), 'no write policy on a wp_ table');
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

// ── Tasks 2–5 append their tests above this line ──

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/workmate-workplan.test.js`
Expected: FAIL — "missing supabase/migrations/0093_workmate_my_work.sql" and most other tests failing; exit code 1.

- [ ] **Step 3: Create the migration with header, §1–§3**

Create `supabase/migrations/0093_workmate_my_work.sql` (LF):

```sql
-- 0093 — WorkMate Stage 1c-1: My Work (Meetings & Work Plan) — the server.
--
-- ── WHAT. The office turns meeting notes into tasks (drafted by AI or by
--    hand — the AI call is Dacs Web's job, plan 1c-2; here a draft is just a
--    task in status 'draft'), publishes them with shared notes, and checks
--    the work. Workers see their tasks in WorkMate's My Work, acknowledge
--    them, report progress, blockers and done; a team leader checks.
--    Spec: docs/superpowers/specs/2026-09-30-workmate-meetings-work-plan-design.md
--    (§15 decisions, 12 October 2026).
--
-- ── WORKERS NEVER TOUCH wp_* TABLES. RLS is on everywhere; the only
--    policies are office reads. Every worker read/write is a SECURITY
--    DEFINER RPC that re-checks, when it runs, that the caller is still the
--    responsible person / helper / current team leader of that task — a
--    stale offline action cannot bypass a change made meanwhile.
--
-- ── WORKERS NEVER SEE the office's original meeting notes, the AI source
--    passage, office flags, who proposed a task, or anyone's
--    acknowledgements; only tasks they have a role on; only the shared
--    notes of a version they were chosen to receive.
--
-- ── RETRY-SAFE. Every worker write carries a client-made operation id; the
--    first result is stored in wp_ops and returned verbatim on retry.
--
-- ── BLOCKED IS DERIVED, never stored: a task is blocked while it has an
--    open blocker or an earlier task (dependency) that is not Completed.
--    Start work, Report done and office approval are refused while blocked.
--    Only the office clears a blocker, with a note.
--
-- ── NO MONEY. Outside the money model: nothing here feeds Spent / Earned /
--    Profit, Attendance or payroll. No penalties follow from any status.

set local lock_timeout = '5s';

-- ════ §1 Tables ════════════════════════════════════════════════════════

-- A meeting. original_notes are the office's own typed/pasted notes and
-- never reach a worker; workers read a published VERSION's shared notes.
create table if not exists wp_meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  title text not null check (btrim(title) <> ''),
  held_on date not null,
  original_notes text not null default '',
  current_version int not null default 0 check (current_version >= 0),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wp_meetings_owner on wp_meetings (owner_id, held_on desc);
alter table wp_meetings enable row level security;

-- Each publish of a meeting's shared notes is a new version; older ones stay.
create table if not exists wp_meeting_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  meeting_id uuid not null references wp_meetings(id),
  version int not null check (version > 0),
  shared_notes text not null default '',
  change_note text not null default '',
  published_by uuid not null references profiles(id),
  published_at timestamptz not null default now(),
  unique (meeting_id, version)
);
alter table wp_meeting_versions enable row level security;

-- Who may read a version's shared notes (chosen by staff at publish).
create table if not exists wp_note_recipients (
  owner_id uuid not null references profiles(id),
  version_id uuid not null references wp_meeting_versions(id),
  person_id uuid not null references profiles(id),
  primary key (version_id, person_id)
);
alter table wp_note_recipients enable row level security;

-- A task: one Project Control project + Main Contract (work = project) or
-- one of its Additional Works. meeting_id null = a standalone task.
-- version 0 = draft; publishing makes it 1; an important revision raises it
-- and every assigned person must acknowledge the new version.
create table if not exists wp_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  meeting_id uuid references wp_meetings(id),
  folder_id uuid not null references folders(id),
  work_folder_id uuid not null references folders(id),
  team_id uuid references pr_teams(id),
  title text not null check (btrim(title) <> ''),
  instructions text not null default '',
  planned_start date,
  planned_end date,
  status text not null default 'draft'
    check (status in ('draft', 'not_started', 'in_progress', 'reported_done', 'leader_checked', 'completed', 'cancelled')),
  sent_back boolean not null default false,
  version int not null default 0,
  version_at timestamptz,
  source_passage text not null default '',
  office_flags jsonb not null default '[]'::jsonb,
  proposed_by uuid references profiles(id),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (planned_start is null or planned_end is null or planned_end >= planned_start),
  check (status <> 'draft' or version = 0),
  check (status in ('draft', 'cancelled') or version > 0),
  check ((status = 'completed') = (completed_at is not null)),
  check (jsonb_typeof(office_flags) = 'array')
);
create index if not exists wp_tasks_owner_folder on wp_tasks (owner_id, folder_id);
create index if not exists wp_tasks_meeting on wp_tasks (meeting_id) where meeting_id is not null;
alter table wp_tasks enable row level security;

-- Responsible person and helpers. Removing someone sets removed_at, so the
-- history still shows who was on the task.
create table if not exists wp_task_people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  person_id uuid not null references profiles(id),
  role text not null check (role in ('responsible', 'helper')),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  check (removed_at is null or removed_at >= added_at)
);
create unique index if not exists wp_task_people_current on wp_task_people (task_id, person_id) where removed_at is null;
create unique index if not exists wp_task_one_responsible on wp_task_people (task_id) where role = 'responsible' and removed_at is null;
create index if not exists wp_task_people_person on wp_task_people (person_id) where removed_at is null;
alter table wp_task_people enable row level security;

-- "I've read this" — per person, per task VERSION actually read.
create table if not exists wp_acks (
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  person_id uuid not null references profiles(id),
  version int not null check (version > 0),
  acked_at timestamptz not null default now(),
  primary key (task_id, person_id, version)
);
alter table wp_acks enable row level security;

-- A reported problem. Never creates a purchase or moves a date; only the
-- office clears it, with a note. A material blocker may point at a request.
create table if not exists wp_blockers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  kind text not null check (kind in ('materials', 'tool', 'preparation', 'other')),
  description text not null check (btrim(description) <> ''),
  request_id uuid references pr_requests(id),
  reported_by uuid not null references profiles(id),
  reported_at timestamptz not null default now(),
  cleared_by uuid references profiles(id),
  cleared_at timestamptz,
  clear_note text,
  check ((cleared_at is null) = (cleared_by is null)),
  check (cleared_at is null or btrim(coalesce(clear_note, '')) <> '')
);
create index if not exists wp_blockers_open on wp_blockers (task_id) where cleared_at is null;
alter table wp_blockers enable row level security;

-- "This task waits for that one" — same project only, no cycles (checked
-- by wp_office_save_task under a per-project lock).
create table if not exists wp_dependencies (
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  depends_on uuid not null references wp_tasks(id),
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);
create index if not exists wp_dependencies_target on wp_dependencies (depends_on);
alter table wp_dependencies enable row level security;

-- Append-only history of tasks and meetings.
create table if not exists wp_events (
  id bigserial primary key,
  owner_id uuid not null references profiles(id),
  task_id uuid references wp_tasks(id),
  meeting_id uuid references wp_meetings(id),
  actor_id uuid not null references profiles(id),
  kind text not null,
  note text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (task_id is not null or meeting_id is not null)
);
create index if not exists wp_events_task on wp_events (task_id, id);
alter table wp_events enable row level security;

-- The first answer to each worker operation, returned verbatim on retry.
create table if not exists wp_ops (
  owner_id uuid not null references profiles(id),
  op_id uuid not null,
  actor_id uuid not null references profiles(id),
  kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, op_id)
);
alter table wp_ops enable row level security;

-- Private task photos (bucket task-photos, §3), on a blocker or a report.
create table if not exists wp_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  task_id uuid not null references wp_tasks(id),
  blocker_id uuid references wp_blockers(id),
  event_id bigint references wp_events(id),
  storage_path text not null unique,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists wp_photos_task on wp_photos (task_id);
alter table wp_photos enable row level security;

-- The office reads; every change goes through an RPC. No anon access and no
-- direct writes for anyone.
do $$
declare v_table text;
begin
  foreach v_table in array array['wp_meetings', 'wp_meeting_versions', 'wp_note_recipients', 'wp_tasks', 'wp_task_people', 'wp_acks',
                                  'wp_blockers', 'wp_dependencies', 'wp_events', 'wp_ops', 'wp_photos'] loop
    execute format('drop policy if exists %I on %I', v_table || '_office_read', v_table);
    execute format('create policy %I on %I for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id))',
                   v_table || '_office_read', v_table);
    execute format('revoke all on %I from anon', v_table);
    execute format('revoke insert, update, delete, truncate, references, trigger on %I from authenticated', v_table);
  end loop;
end $$;

-- ════ §2 Shared helpers ═══════════════════════════════════════════════

-- An active worker or team leader of this company (names only ever shown).
create or replace function wp_person_ok(p_person uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p
                  where p.id = p_person and p.role in ('worker', 'teamLeader')
                    and coalesce(p.status, 'active') = 'active'
                    and coalesce(p.owner_id, p.id) = p_owner)
$$;

-- An open top-level Project Control project of this company, and the work:
-- the project itself (Main Contract) or one of its own open Additional
-- Works. Unlike requests, a task does not need Allow requests or Time In.
create or replace function wp_work_valid(p_owner uuid, p_folder uuid, p_work uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from folders f
                  where f.id = p_folder and f.owner_id = p_owner and f.parent_folder_id is null
                    and f.completed_at is null and coalesce(btrim(f.name), '') <> '')
     and (p_work = p_folder
          or exists (select 1 from folders c
                      where c.id = p_work and c.parent_folder_id = p_folder
                        and c.completed_at is null and coalesce(btrim(c.name), '') <> ''))
$$;

-- THE blocked rule: an open blocker, or an earlier task not yet Completed.
create or replace function wp_task_blocked(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from wp_blockers b where b.task_id = p_task and b.cleared_at is null)
      or exists (select 1 from wp_dependencies x join wp_tasks d on d.id = x.depends_on
                  where x.task_id = p_task and d.status <> 'completed')
$$;

-- The caller's role on a task: assigned (responsible/helper), else the
-- current leader of its team, else null.
create or replace function wp_role_on(p_task uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.role from wp_task_people p
      where p.task_id = p_task and p.person_id = p_user and p.removed_at is null),
    (select 'leader'::text from wp_tasks t
      where t.id = p_task and t.team_id is not null and pr_is_current_leader(t.team_id, p_user)))
$$;

-- A leader may check reported work of their team — never their own.
create or replace function wp_can_check(p_task uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wp_tasks t
     where t.id = p_task and t.status = 'reported_done' and t.team_id is not null
       and pr_is_current_leader(t.team_id, p_user)
       and not exists (select 1 from wp_task_people p
                        where p.task_id = t.id and p.person_id = p_user
                          and p.role = 'responsible' and p.removed_at is null))
$$;

-- Does p_from (directly or through others) wait for p_target?
create or replace function wp_depends_on(p_from uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive up(id) as (
    select x.depends_on from wp_dependencies x where x.task_id = p_from
    union
    select x.depends_on from wp_dependencies x join up on x.task_id = up.id)
  select exists (select 1 from up where up.id = p_target)
$$;

-- One task as JSON. The worker part never carries office-only fields; the
-- office part is appended only when p_office.
create or replace function wp_task_doc(p_task uuid, p_viewer uuid, p_office boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', t.id, 'meeting_id', t.meeting_id, 'title', t.title, 'instructions', t.instructions,
           'folder_id', t.folder_id, 'project_name', f.name, 'work_id', t.work_folder_id,
           'work_name', case when t.work_folder_id = t.folder_id then 'Main Contract' else w.name end,
           'team_id', t.team_id, 'team_name', tm.name,
           'status', t.status, 'sent_back', t.sent_back, 'blocked', wp_task_blocked(t.id),
           'planned_start', t.planned_start, 'planned_end', t.planned_end,
           'version', t.version, 'version_at', t.version_at, 'published_at', t.published_at,
           'completed_at', t.completed_at, 'updated_at', t.updated_at,
           'responsible', (select jsonb_build_object('id', p.person_id, 'name', pr_person_name(p.person_id))
                             from wp_task_people p
                            where p.task_id = t.id and p.role = 'responsible' and p.removed_at is null),
           'helpers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.person_id, 'name', pr_person_name(p.person_id))
                                       order by lower(pr_person_name(p.person_id))), '[]'::jsonb)
                         from wp_task_people p
                        where p.task_id = t.id and p.role = 'helper' and p.removed_at is null),
           'blockers', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'description', b.description,
                                         'request_id', b.request_id, 'reported_at', b.reported_at,
                                         'reported_by', pr_person_name(b.reported_by)) order by b.reported_at), '[]'::jsonb)
                          from wp_blockers b where b.task_id = t.id and b.cleared_at is null),
           'waiting_for', (select coalesce(jsonb_agg(jsonb_build_object('task_id', d.id, 'title', d.title, 'status', d.status)
                                           order by d.title), '[]'::jsonb)
                             from wp_dependencies x join wp_tasks d on d.id = x.depends_on
                            where x.task_id = t.id and d.status <> 'completed'),
           'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.storage_path, 'blocker_id', ph.blocker_id,
                                       'event_id', ph.event_id, 'created_at', ph.created_at) order by ph.created_at), '[]'::jsonb)
                        from wp_photos ph
                       where ph.task_id = t.id
                         and (p_office or ph.uploaded_by = p_viewer
                              or exists (select 1 from wp_task_people r
                                          where r.task_id = t.id and r.person_id = p_viewer
                                            and r.role = 'responsible' and r.removed_at is null)
                              or (t.team_id is not null and pr_is_current_leader(t.team_id, p_viewer)))),
           'history', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'note', e.note,
                                        'by', pr_person_name(e.actor_id), 'at', e.created_at) order by e.id), '[]'::jsonb)
                         from wp_events e where e.task_id = t.id))
         || case when p_office then jsonb_build_object(
              'source_passage', t.source_passage, 'office_flags', t.office_flags,
              'proposed_by', case when t.proposed_by is null then null else pr_person_name(t.proposed_by) end,
              'acks', (select coalesce(jsonb_agg(jsonb_build_object('person_id', p.person_id, 'name', pr_person_name(p.person_id),
                         'role', p.role,
                         'acked', exists (select 1 from wp_acks a where a.task_id = t.id
                                            and a.person_id = p.person_id and a.version = t.version))
                         order by p.role desc, lower(pr_person_name(p.person_id))), '[]'::jsonb)
                         from wp_task_people p where p.task_id = t.id and p.removed_at is null),
              'not_acknowledged_24h', t.status not in ('draft', 'completed', 'cancelled')
                   and t.version_at < now() - interval '24 hours'
                   and exists (select 1 from wp_task_people p
                                where p.task_id = t.id and p.removed_at is null
                                  and not exists (select 1 from wp_acks a where a.task_id = t.id
                                                    and a.person_id = p.person_id and a.version = t.version)),
              'overdue', t.status in ('not_started', 'in_progress')
                   and t.planned_end < (now() at time zone 'Asia/Manila')::date,
              'depends_on', (select coalesce(jsonb_agg(x.depends_on), '[]'::jsonb) from wp_dependencies x where x.task_id = t.id))
            else jsonb_build_object(
              'my_role', wp_role_on(t.id, p_viewer),
              'my_ack_version', (select max(a.version) from wp_acks a where a.task_id = t.id and a.person_id = p_viewer),
              'can_check', wp_can_check(t.id, p_viewer)) end
    from wp_tasks t
    join folders f on f.id = t.folder_id
    join folders w on w.id = t.work_folder_id
    left join pr_teams tm on tm.id = t.team_id
   where t.id = p_task
$$;

-- Retry safety: serialise one operation id per caller and return its first
-- answer, if any.
create or replace function wp_op_prev(p_op uuid, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_op is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('wp_op:' || p_uid::text || ':' || p_op::text));
  return (select o.result from wp_ops o where o.actor_id = p_uid and o.op_id = p_op);
end;
$$;

create or replace function wp_op_save(p_op uuid, p_uid uuid, p_kind text, p_result jsonb) returns jsonb
language sql security definer set search_path = public as $$
  insert into wp_ops (owner_id, op_id, actor_id, kind, result)
  values (attendance_data_owner(), p_op, p_uid, p_kind, p_result)
  returning result
$$;

create or replace function wp_log(p_owner uuid, p_task uuid, p_meeting uuid, p_kind text, p_note text, p_detail jsonb) returns bigint
language sql security definer set search_path = public as $$
  insert into wp_events (owner_id, task_id, meeting_id, actor_id, kind, note, detail)
  values (p_owner, p_task, p_meeting, auth.uid(), p_kind, coalesce(p_note, ''), coalesce(p_detail, '{}'::jsonb))
  returning id
$$;

-- A worker's task, locked, re-checked NOW: published, not cancelled, of the
-- caller's company, and the caller has a role on it.
create or replace function wp_worker_task(p_task uuid) returns wp_tasks
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  select * into t from wp_tasks where id = p_task and owner_id = attendance_data_owner() for update;
  if not found or t.status in ('draft', 'cancelled') or wp_role_on(t.id, auth.uid()) is null then
    raise exception 'NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

-- An office caller's task of its own company, locked.
create or replace function wp_office_task_row(p_task uuid) returns wp_tasks
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select * into t from wp_tasks where id = p_task and owner_id = data_owner_id() for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

revoke all on function wp_person_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_work_valid(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function wp_task_blocked(uuid) from public, anon, authenticated;
revoke all on function wp_role_on(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_can_check(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_depends_on(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_task_doc(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function wp_op_prev(uuid, uuid) from public, anon, authenticated;
revoke all on function wp_op_save(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function wp_log(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function wp_worker_task(uuid) from public, anon, authenticated;
revoke all on function wp_office_task_row(uuid) from public, anon, authenticated;

-- ════ §3 Task photos ═══════════════════════════════════════════════════

-- Private bucket: <uploader_id>/<task_id>/<uuid>.jpg. A NEW bucket like
-- request-photos — not an uploads top folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-photos', 'task-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Upload: a worker, under their own id, for a published task they have a
-- role on. SECURITY DEFINER because it reads wp_tasks, which workers cannot.
create or replace function wp_can_upload_task_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_is_requester()
     and (storage.foldername(p_name))[1] = auth.uid()::text
     and exists (select 1 from wp_tasks t
                  where t.id::text = (storage.foldername(p_name))[2]
                    and t.owner_id = attendance_data_owner()
                    and t.status not in ('draft', 'cancelled')
                    and wp_role_on(t.id, auth.uid()) is not null)
$$;

-- Read: an attached photo, by its uploader, the task's responsible person
-- or the current leader of the task's team (spec §15: never the whole crew).
create or replace function wp_can_read_task_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from wp_photos ph join wp_tasks t on t.id = ph.task_id
     where ph.storage_path = p_name
       and (ph.uploaded_by = auth.uid()
            or exists (select 1 from wp_task_people p
                        where p.task_id = t.id and p.person_id = auth.uid()
                          and p.role = 'responsible' and p.removed_at is null)
            or (t.team_id is not null and pr_is_current_leader(t.team_id, auth.uid()))))
$$;

-- The office of the task's company reads every photo of it.
create or replace function wp_office_task_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_owner() or is_staff(), false)
     and exists (select 1 from wp_tasks t
                  where t.id::text = (storage.foldername(p_name))[2] and t.owner_id = data_owner_id())
$$;

drop policy if exists "task-photos: assigned uploads own" on storage.objects;
create policy "task-photos: assigned uploads own" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-photos' and wp_can_upload_task_path(name));

drop policy if exists "task-photos: worker reads" on storage.objects;
create policy "task-photos: worker reads" on storage.objects for select to authenticated
  using (bucket_id = 'task-photos' and wp_can_read_task_photo(name));

drop policy if exists "task-photos: office reads" on storage.objects;
create policy "task-photos: office reads" on storage.objects for select to authenticated
  using (bucket_id = 'task-photos' and wp_office_task_path_ok(name));

revoke all on function wp_can_upload_task_path(text) from public, anon;
grant execute on function wp_can_upload_task_path(text) to authenticated;
revoke all on function wp_can_read_task_photo(text) from public, anon;
grant execute on function wp_can_read_task_photo(text) to authenticated;
revoke all on function wp_office_task_path_ok(text) from public, anon;
grant execute on function wp_office_task_path_ok(text) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/workmate-workplan.test.js`
Expected: `14 passed, 0 failed`.

Run: `npm test`
Expected: every existing suite still green (0093 is not yet in `npm test`; nothing else reads it).

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 2: Worker RPCs — My Work, notes, acknowledge, start, progress, blocker, done, leader check, proposal, photo

**Files:**
- Modify: `supabase/migrations/0093_workmate_my_work.sql` (append §4–§5)
- Modify: `tests/workmate-workplan.test.js` (insert tests above the `// ── Tasks 2–5 append` marker)

**Interfaces:**
- Consumes (Task 1): `wp_worker_task`, `wp_role_on`, `wp_task_blocked`, `wp_task_doc`, `wp_op_prev`, `wp_op_save`, `wp_log`, `wp_work_valid`; 0085 `pr_is_requester`, `pr_is_current_leader`.
- Produces (granted to authenticated):
  - `wp_my_work() returns jsonb` — array of worker task docs (published, not cancelled; Completed for 14 days)
  - `wp_my_notes() returns jsonb` — `[{meeting_id, title, held_on, version, shared_notes, change_note, published_at}]`, latest version only, last 90 days
  - `wp_acknowledge(p_op uuid, p_task uuid, p_version integer) returns jsonb` — `{stale boolean, task}`
  - `wp_start_work(p_op uuid, p_task uuid) returns jsonb` — `{task}`; also acknowledges the current version
  - `wp_report_progress(p_op uuid, p_task uuid, p_note text) returns jsonb` — `{event_id, task}`
  - `wp_report_blocker(p_op uuid, p_task uuid, p_kind text, p_description text, p_request uuid) returns jsonb` — `{blocker_id, task}`
  - `wp_report_done(p_op uuid, p_task uuid, p_note text) returns jsonb` — `{event_id, task}`
  - `wp_leader_check(p_op uuid, p_task uuid, p_note text) returns jsonb` — `{task}`
  - `wp_propose_task(p_op uuid, p_team uuid, p_folder uuid, p_work uuid, p_title text, p_details text) returns jsonb` — `{task_id}`
  - `wp_attach_photo(p_op uuid, p_task uuid, p_blocker uuid, p_event bigint, p_path text) returns jsonb` — `{photo_id}`

- [ ] **Step 1: Write the failing tests**

Insert above `// ── Tasks 2–5 append their tests above this line ──`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/workmate-workplan.test.js`
Expected: the 7 new tests FAIL (functions missing); the 14 Task 1 tests still pass; exit code 1.

- [ ] **Step 3: Append §4–§5 to the migration**

Append to `supabase/migrations/0093_workmate_my_work.sql`:

```sql
-- ════ §4 Worker reads ═══════════════════════════════════════════════════

-- My Work: every published task the caller has a role on (responsible,
-- helper, or current leader of its team). Completed ones stay 14 days.
create or replace function wp_my_work() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(wp_task_doc(t.id, auth.uid(), false)
                                    order by t.planned_start nulls last, t.created_at), '[]'::jsonb)
            from wp_tasks t
           where t.owner_id = attendance_data_owner()
             and t.status not in ('draft', 'cancelled')
             and (t.status <> 'completed' or t.completed_at > now() - interval '14 days')
             and wp_role_on(t.id, auth.uid()) is not null);
end;
$$;

-- Shared meeting notes: the LATEST published version of each meeting the
-- caller was chosen to receive. Never the office's original notes.
create or replace function wp_my_notes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'meeting_id', m.id, 'title', m.title, 'held_on', m.held_on, 'version', v.version,
                   'shared_notes', v.shared_notes, 'change_note', v.change_note, 'published_at', v.published_at)
                   order by m.held_on desc, v.published_at desc), '[]'::jsonb)
            from wp_meetings m
            join wp_meeting_versions v on v.meeting_id = m.id and v.version = m.current_version
            join wp_note_recipients r on r.version_id = v.id and r.person_id = auth.uid()
           where m.owner_id = attendance_data_owner()
             and m.held_on > (now() at time zone 'Asia/Manila')::date - 90);
end;
$$;

-- ════ §5 Worker writes (each retry-safe through wp_ops) ═══════════════

-- "I've read this" for the version the phone showed. An outdated version is
-- answered with the current task (stale = true) and recorded nowhere.
create or replace function wp_acknowledge(p_op uuid, p_task uuid, p_version integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) not in ('responsible', 'helper') then
    raise exception 'NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if p_version is distinct from t.version then
    v_result := jsonb_build_object('stale', true, 'task', wp_task_doc(t.id, v_uid, false));
  else
    insert into wp_acks (owner_id, task_id, person_id, version)
    values (t.owner_id, t.id, v_uid, t.version)
    on conflict do nothing;
    if found then
      perform wp_log(t.owner_id, t.id, null, 'acknowledged', '', jsonb_build_object('version', t.version));
    end if;
    v_result := jsonb_build_object('stale', false, 'task', wp_task_doc(t.id, v_uid, false));
  end if;
  return wp_op_save(p_op, v_uid, 'acknowledge', v_result);
end;
$$;

-- Responsible person only; refused while blocked. Starting also
-- acknowledges the current version.
create or replace function wp_start_work(p_op uuid, p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) is distinct from 'responsible' then
    raise exception 'NOT_RESPONSIBLE' using errcode = 'P0001';
  end if;
  if t.status <> 'not_started' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if wp_task_blocked(t.id) then
    raise exception 'TASK_BLOCKED' using errcode = 'P0001';
  end if;
  insert into wp_acks (owner_id, task_id, person_id, version)
  values (t.owner_id, t.id, v_uid, t.version)
  on conflict do nothing;
  update wp_tasks set status = 'in_progress', updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'started', '', '{}'::jsonb);
  v_result := jsonb_build_object('task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'start_work', v_result);
end;
$$;

-- A progress note from the responsible person (photos attach to it).
create or replace function wp_report_progress(p_op uuid, p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_event bigint;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) is distinct from 'responsible' then
    raise exception 'NOT_RESPONSIBLE' using errcode = 'P0001';
  end if;
  if t.status not in ('not_started', 'in_progress') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  v_event := wp_log(t.owner_id, t.id, null, 'progress', btrim(p_note), '{}'::jsonb);
  v_result := jsonb_build_object('event_id', v_event, 'task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'report_progress', v_result);
end;
$$;

-- Anyone with a role may report a problem. It blocks the task until the
-- office clears it; it never creates a purchase or moves a date.
create or replace function wp_report_blocker(p_op uuid, p_task uuid, p_kind text, p_description text, p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_blocker uuid;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if t.status not in ('not_started', 'in_progress', 'reported_done', 'leader_checked') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('materials', 'tool', 'preparation', 'other') then
    raise exception 'BAD_KIND' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_request is not null and not exists (select 1 from pr_requests r
                                            where r.id = p_request and r.owner_id = t.owner_id and r.folder_id = t.folder_id) then
    raise exception 'BAD_REQUEST' using errcode = 'P0001';
  end if;
  insert into wp_blockers (owner_id, task_id, kind, description, request_id, reported_by)
  values (t.owner_id, t.id, p_kind, btrim(p_description), p_request, v_uid)
  returning id into v_blocker;
  perform wp_log(t.owner_id, t.id, null, 'blocker_reported', btrim(p_description),
                 jsonb_build_object('blocker_id', v_blocker, 'kind', p_kind));
  v_result := jsonb_build_object('blocker_id', v_blocker, 'task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'report_blocker', v_result);
end;
$$;

-- Responsible person, from In progress, refused while blocked. Clears the
-- Sent back mark.
create or replace function wp_report_done(p_op uuid, p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_event bigint;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) is distinct from 'responsible' then
    raise exception 'NOT_RESPONSIBLE' using errcode = 'P0001';
  end if;
  if t.status <> 'in_progress' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if wp_task_blocked(t.id) then
    raise exception 'TASK_BLOCKED' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'reported_done', sent_back = false, updated_at = now() where id = t.id;
  v_event := wp_log(t.owner_id, t.id, null, 'reported_done', btrim(coalesce(p_note, '')), '{}'::jsonb);
  v_result := jsonb_build_object('event_id', v_event, 'task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'report_done', v_result);
end;
$$;

-- The current leader of the task's team checks reported work — never their
-- own. Recorded; the office still gives the final approval.
create or replace function wp_leader_check(p_op uuid, p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if wp_role_on(t.id, v_uid) = 'responsible' then
    raise exception 'OWN_WORK' using errcode = 'P0001';
  end if;
  if t.team_id is null or not pr_is_current_leader(t.team_id, v_uid) then
    raise exception 'NOT_LEADER' using errcode = 'P0001';
  end if;
  if t.status <> 'reported_done' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'leader_checked', updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'leader_checked', btrim(coalesce(p_note, '')), '{}'::jsonb);
  v_result := jsonb_build_object('task', wp_task_doc(t.id, v_uid, false));
  return wp_op_save(p_op, v_uid, 'leader_check', v_result);
end;
$$;

-- A current team leader proposes a task: it arrives as a DRAFT for the
-- office, which edits, publishes or cancels it. Never live by itself.
create or replace function wp_propose_task(p_op uuid, p_team uuid, p_folder uuid, p_work uuid, p_title text, p_details text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_owner uuid;
  v_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  v_owner := attendance_data_owner();
  if p_team is null or not pr_is_current_leader(p_team, v_uid)
     or not exists (select 1 from pr_teams tm where tm.id = p_team and tm.owner_id = v_owner) then
    raise exception 'NOT_LEADER' using errcode = 'P0001';
  end if;
  if p_folder is null or not wp_work_valid(v_owner, p_folder, coalesce(p_work, p_folder)) then
    raise exception 'BAD_DESTINATION' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  insert into wp_tasks (owner_id, folder_id, work_folder_id, team_id, title, instructions, proposed_by, created_by)
  values (v_owner, p_folder, coalesce(p_work, p_folder), p_team, btrim(p_title), coalesce(p_details, ''), v_uid, v_uid)
  returning id into v_id;
  perform wp_log(v_owner, v_id, null, 'proposed', '', '{}'::jsonb);
  v_result := jsonb_build_object('task_id', v_id);
  return wp_op_save(p_op, v_uid, 'propose_task', v_result);
end;
$$;

-- Links an uploaded photo to the task (and optionally a blocker or a
-- report). Upload first, then attach: the row only ever points at a real object.
create or replace function wp_attach_photo(p_op uuid, p_task uuid, p_blocker uuid, p_event bigint, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  t wp_tasks;
  v_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_prev := wp_op_prev(p_op, v_uid);
  if v_prev is not null then
    return v_prev;
  end if;
  t := wp_worker_task(p_task);
  if (p_blocker is not null and not exists (select 1 from wp_blockers b where b.id = p_blocker and b.task_id = t.id))
     or (p_event is not null and not exists (select 1 from wp_events e where e.id = p_event and e.task_id = t.id)) then
    raise exception 'BAD_LINK' using errcode = 'P0001';
  end if;
  if p_path is null or left(p_path, length(v_uid::text || '/' || t.id::text || '/')) <> v_uid::text || '/' || t.id::text || '/' then
    raise exception 'BAD_PATH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'task-photos' and o.name = p_path) then
    raise exception 'PHOTO_NOT_UPLOADED' using errcode = 'P0001';
  end if;
  insert into wp_photos (owner_id, task_id, blocker_id, event_id, storage_path, uploaded_by)
  values (t.owner_id, t.id, p_blocker, p_event, p_path, v_uid)
  on conflict (storage_path) do nothing;
  select id into v_id from wp_photos where storage_path = p_path;
  perform wp_log(t.owner_id, t.id, null, 'photo_attached', '', jsonb_build_object('photo_id', v_id));
  v_result := jsonb_build_object('photo_id', v_id);
  return wp_op_save(p_op, v_uid, 'attach_photo', v_result);
end;
$$;

revoke all on function wp_my_work() from public, anon;
grant execute on function wp_my_work() to authenticated;
revoke all on function wp_my_notes() from public, anon;
grant execute on function wp_my_notes() to authenticated;
revoke all on function wp_acknowledge(uuid, uuid, integer) from public, anon;
grant execute on function wp_acknowledge(uuid, uuid, integer) to authenticated;
revoke all on function wp_start_work(uuid, uuid) from public, anon;
grant execute on function wp_start_work(uuid, uuid) to authenticated;
revoke all on function wp_report_progress(uuid, uuid, text) from public, anon;
grant execute on function wp_report_progress(uuid, uuid, text) to authenticated;
revoke all on function wp_report_blocker(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function wp_report_blocker(uuid, uuid, text, text, uuid) to authenticated;
revoke all on function wp_report_done(uuid, uuid, text) from public, anon;
grant execute on function wp_report_done(uuid, uuid, text) to authenticated;
revoke all on function wp_leader_check(uuid, uuid, text) from public, anon;
grant execute on function wp_leader_check(uuid, uuid, text) to authenticated;
revoke all on function wp_propose_task(uuid, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function wp_propose_task(uuid, uuid, uuid, uuid, text, text) to authenticated;
revoke all on function wp_attach_photo(uuid, uuid, uuid, bigint, text) from public, anon;
grant execute on function wp_attach_photo(uuid, uuid, uuid, bigint, text) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/workmate-workplan.test.js`
Expected: `21 passed, 0 failed`.

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 3: Office planning RPCs — destinations, meetings, drafts, publish, board

**Files:**
- Modify: `supabase/migrations/0093_workmate_my_work.sql` (append §6)
- Modify: `tests/workmate-workplan.test.js` (insert above the marker)

**Interfaces:**
- Consumes (Task 1): `wp_person_ok`, `wp_work_valid`, `wp_depends_on`, `wp_task_doc`, `wp_log`; 0086 `pr_is_office`; 0085 `pr_is_current_member`.
- Produces (granted to authenticated):
  - `wp_office_destinations() returns jsonb` — `[{folder_id, name, works:[{work_id, name}]}]` (open top-level projects + open AW)
  - `wp_office_meetings() returns jsonb` — `[{id, title, held_on, current_version, draft_count, task_count, updated_at}]`
  - `wp_office_meeting(p_meeting uuid) returns jsonb` — meeting incl. `original_notes`, `versions` (with recipients), `tasks` (office docs)
  - `wp_office_save_meeting(p_meeting uuid, p_title text, p_held_on date, p_original_notes text) returns jsonb` — `{meeting_id}`; null id = create
  - `wp_office_save_task(p_task uuid, p_data jsonb) returns jsonb` — `{task}` (office doc); null id = create a draft. `p_data` keys: `meeting_id, folder_id, work_id, team_id, title, instructions, planned_start, planned_end, source_passage, office_flags (array), responsible_id, helper_ids (array), depends_on (array), important (bool), change_note`. A **full** save: omitted keys become empty.
  - `wp_office_publish(p_meeting uuid, p_tasks uuid[], p_shared_notes text, p_recipients uuid[], p_change_note text) returns jsonb` — `{published_tasks, meeting_version}`
  - `wp_office_board(p_folder uuid default null) returns jsonb` — office docs, not cancelled, Completed for 30 days, drafts included
  - `wp_office_task(p_task uuid) returns jsonb` — one office doc
- Office people and teams come from 0086 `pr_office_people()` / `pr_office_teams()` (unchanged).

- [ ] **Step 1: Write the failing tests**

Insert above the marker:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/workmate-workplan.test.js`
Expected: the 6 new tests FAIL; earlier 21 pass; exit code 1.

- [ ] **Step 3: Append §6 to the migration**

```sql
-- ════ §6 Office: planning ═════════════════════════════════════════════

-- Where a task can go: open top-level projects and their open Additional Works.
create or replace function wp_office_destinations() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'folder_id', f.id, 'name', f.name,
           'works', (select coalesce(jsonb_agg(jsonb_build_object('work_id', c.id, 'name', c.name) order by lower(c.name)), '[]'::jsonb)
                       from folders c
                      where c.parent_folder_id = f.id and c.completed_at is null and coalesce(btrim(c.name), '') <> ''))
         order by lower(f.name)), '[]'::jsonb)
    from folders f
   where pr_is_office() and f.owner_id = data_owner_id() and f.parent_folder_id is null
     and f.completed_at is null and coalesce(btrim(f.name), '') <> ''
$$;

create or replace function wp_office_meetings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'title', m.title, 'held_on', m.held_on, 'current_version', m.current_version,
           'draft_count', (select count(*) from wp_tasks t where t.meeting_id = m.id and t.status = 'draft'),
           'task_count', (select count(*) from wp_tasks t where t.meeting_id = m.id and t.status <> 'cancelled'),
           'updated_at', m.updated_at)
         order by m.held_on desc, m.created_at desc), '[]'::jsonb)
    from wp_meetings m
   where pr_is_office() and m.owner_id = data_owner_id()
$$;

create or replace function wp_office_meeting(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_doc jsonb;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'id', m.id, 'title', m.title, 'held_on', m.held_on, 'original_notes', m.original_notes,
           'current_version', m.current_version,
           'versions', (select coalesce(jsonb_agg(jsonb_build_object(
                          'version', v.version, 'shared_notes', v.shared_notes, 'change_note', v.change_note,
                          'published_at', v.published_at, 'published_by', pr_person_name(v.published_by),
                          'recipients', (select coalesce(jsonb_agg(jsonb_build_object('id', r.person_id, 'name', pr_person_name(r.person_id))
                                                                   order by lower(pr_person_name(r.person_id))), '[]'::jsonb)
                                           from wp_note_recipients r where r.version_id = v.id))
                          order by v.version desc), '[]'::jsonb)
                          from wp_meeting_versions v where v.meeting_id = m.id),
           'tasks', (select coalesce(jsonb_agg(wp_task_doc(t.id, auth.uid(), true) order by t.created_at), '[]'::jsonb)
                       from wp_tasks t where t.meeting_id = m.id))
    into v_doc
    from wp_meetings m
   where m.id = p_meeting and m.owner_id = data_owner_id();
  if v_doc is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_doc;
end;
$$;

-- Create (null id) or edit a meeting. The original notes stay office-only.
create or replace function wp_office_save_meeting(p_meeting uuid, p_title text, p_held_on date, p_original_notes text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := data_owner_id();
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_held_on is null then
    raise exception 'BAD_DATES' using errcode = 'P0001';
  end if;
  if p_meeting is null then
    insert into wp_meetings (owner_id, title, held_on, original_notes, created_by)
    values (v_owner, btrim(p_title), p_held_on, coalesce(p_original_notes, ''), auth.uid())
    returning id into v_id;
    perform wp_log(v_owner, null, v_id, 'meeting_created', '', '{}'::jsonb);
  else
    update wp_meetings
       set title = btrim(p_title), held_on = p_held_on, original_notes = coalesce(p_original_notes, ''), updated_at = now()
     where id = p_meeting and owner_id = v_owner
    returning id into v_id;
    if v_id is null then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  return jsonb_build_object('meeting_id', v_id);
end;
$$;

-- Create (null id = a draft) or edit a task — a FULL save of every field.
-- A published task keeps its project/work and a responsible person; marking
-- the change important raises its version (everyone must acknowledge again).
create or replace function wp_office_save_task(p_task uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := data_owner_id();
  v_new boolean := p_task is null;
  t wp_tasks;
  v_id uuid;
  v_meeting uuid;
  v_folder uuid;
  v_work uuid;
  v_team uuid;
  v_resp uuid;
  v_start date;
  v_end date;
  v_helpers uuid[];
  v_deps uuid[];
  v_one uuid;
  v_title text;
  v_flags jsonb;
  v_important boolean;
  v_revised boolean;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  v_flags := coalesce(p_data -> 'office_flags', '[]'::jsonb);
  if jsonb_typeof(v_flags) <> 'array' then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  begin
    v_meeting := nullif(p_data ->> 'meeting_id', '')::uuid;
    v_folder := nullif(p_data ->> 'folder_id', '')::uuid;
    v_work := coalesce(nullif(p_data ->> 'work_id', '')::uuid, v_folder);
    v_team := nullif(p_data ->> 'team_id', '')::uuid;
    v_resp := nullif(p_data ->> 'responsible_id', '')::uuid;
    v_start := nullif(p_data ->> 'planned_start', '')::date;
    v_end := nullif(p_data ->> 'planned_end', '')::date;
    v_helpers := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'helper_ids', '[]'::jsonb)) x);
    v_deps := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'depends_on', '[]'::jsonb)) x);
    v_important := coalesce((p_data ->> 'important')::boolean, false);
  exception when others then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end;
  v_title := btrim(coalesce(p_data ->> 'title', ''));
  if v_title = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then
    raise exception 'BAD_DATES' using errcode = 'P0001';
  end if;

  if not v_new then
    select * into t from wp_tasks where id = p_task and owner_id = v_owner for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if t.status in ('completed', 'cancelled') then
      raise exception 'TASK_CLOSED' using errcode = 'P0001';
    end if;
    if t.status <> 'draft' and (v_folder is distinct from t.folder_id or v_work is distinct from t.work_folder_id) then
      raise exception 'BAD_DESTINATION' using errcode = 'P0001';
    end if;
  end if;
  if (v_new or t.status = 'draft') and (v_folder is null or not wp_work_valid(v_owner, v_folder, v_work)) then
    raise exception 'BAD_DESTINATION' using errcode = 'P0001';
  end if;
  if v_meeting is not null and not exists (select 1 from wp_meetings m where m.id = v_meeting and m.owner_id = v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_team is not null and not exists (select 1 from pr_teams tm where tm.id = v_team and tm.owner_id = v_owner and tm.active) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  if v_resp is not null and (not wp_person_ok(v_resp, v_owner)
                              or (v_team is not null and not pr_is_current_member(v_team, v_resp))) then
    raise exception 'BAD_PERSON' using errcode = 'P0001';
  end if;
  foreach v_one in array v_helpers loop
    if v_one = v_resp or not wp_person_ok(v_one, v_owner)
       or (v_team is not null and not pr_is_current_member(v_team, v_one)) then
      raise exception 'BAD_PERSON' using errcode = 'P0001';
    end if;
  end loop;
  if not v_new and t.status <> 'draft' and v_resp is null then
    raise exception 'NO_RESPONSIBLE' using errcode = 'P0001';
  end if;

  if v_new then
    insert into wp_tasks (owner_id, meeting_id, folder_id, work_folder_id, team_id, title, instructions,
                          planned_start, planned_end, source_passage, office_flags, created_by)
    values (v_owner, v_meeting, v_folder, v_work, v_team, v_title, coalesce(p_data ->> 'instructions', ''),
            v_start, v_end, coalesce(p_data ->> 'source_passage', ''), v_flags, v_uid)
    returning id into v_id;
    perform wp_log(v_owner, v_id, v_meeting, 'drafted', '', '{}'::jsonb);
  else
    v_id := t.id;
    v_revised := t.status <> 'draft' and v_important;
    update wp_tasks
       set meeting_id = v_meeting, folder_id = v_folder, work_folder_id = v_work, team_id = v_team, title = v_title,
           instructions = coalesce(p_data ->> 'instructions', ''), planned_start = v_start, planned_end = v_end,
           source_passage = coalesce(p_data ->> 'source_passage', ''), office_flags = v_flags,
           version = case when v_revised then t.version + 1 else t.version end,
           version_at = case when v_revised then now() else t.version_at end,
           updated_at = now()
     where id = v_id;
    perform wp_log(v_owner, v_id, v_meeting, case when v_revised then 'revised' else 'edited' end,
                   btrim(coalesce(p_data ->> 'change_note', '')), '{}'::jsonb);
  end if;

  -- People: end rows no longer wanted, add new ones; history is kept.
  update wp_task_people
     set removed_at = now()
   where task_id = v_id and removed_at is null
     and not ((role = 'responsible' and person_id is not distinct from v_resp)
              or (role = 'helper' and person_id = any (v_helpers)));
  if v_resp is not null then
    insert into wp_task_people (owner_id, task_id, person_id, role)
    select v_owner, v_id, v_resp, 'responsible'
     where not exists (select 1 from wp_task_people p
                        where p.task_id = v_id and p.person_id = v_resp and p.role = 'responsible' and p.removed_at is null);
  end if;
  insert into wp_task_people (owner_id, task_id, person_id, role)
  select v_owner, v_id, h, 'helper'
    from unnest(v_helpers) h
   where not exists (select 1 from wp_task_people p
                      where p.task_id = v_id and p.person_id = h and p.role = 'helper' and p.removed_at is null);

  -- Dependencies: same project, no cycles. One project at a time, so two
  -- staff linking A→B and B→A at once cannot both succeed.
  perform pg_advisory_xact_lock(hashtext('wp_deps:' || v_folder::text));
  foreach v_one in array v_deps loop
    if not exists (select 1 from wp_tasks d
                    where d.id = v_one and d.owner_id = v_owner and d.folder_id = v_folder and d.status <> 'cancelled') then
      raise exception 'BAD_DEPENDENCY' using errcode = 'P0001';
    end if;
    if v_one = v_id or wp_depends_on(v_one, v_id) then
      raise exception 'DEPENDENCY_CYCLE' using errcode = 'P0001';
    end if;
  end loop;
  delete from wp_dependencies where task_id = v_id and not (depends_on = any (v_deps));
  insert into wp_dependencies (owner_id, task_id, depends_on)
  select v_owner, v_id, d from unnest(v_deps) d
  on conflict do nothing;

  return jsonb_build_object('task', wp_task_doc(v_id, v_uid, true));
end;
$$;

-- Publish: the listed draft tasks (or every draft of the meeting) become
-- Not started at version 1, and — for a meeting — a new shared-notes
-- version goes to the chosen recipients (default: everyone assigned a
-- published task of that meeting). Already-published tasks are skipped.
create or replace function wp_office_publish(p_meeting uuid, p_tasks uuid[], p_shared_notes text, p_recipients uuid[], p_change_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := data_owner_id();
  m wp_meetings;
  t wp_tasks;
  v_ids uuid[];
  v_id uuid;
  v_count int := 0;
  v_version int;
  v_version_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_meeting is null and coalesce(cardinality(p_tasks), 0) = 0 then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  if p_meeting is not null then
    select * into m from wp_meetings where id = p_meeting and owner_id = v_owner for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  if p_recipients is not null then
    foreach v_id in array p_recipients loop
      if not wp_person_ok(v_id, v_owner) then
        raise exception 'BAD_PERSON' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  v_ids := coalesce(p_tasks, array(select x.id from wp_tasks x
                                    where x.meeting_id = p_meeting and x.owner_id = v_owner and x.status = 'draft'
                                    order by x.created_at));
  foreach v_id in array v_ids loop
    select * into t from wp_tasks where id = v_id and owner_id = v_owner for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if p_meeting is not null and t.meeting_id is distinct from p_meeting then
      raise exception 'BAD_OPERATION' using errcode = 'P0001';
    end if;
    continue when t.status <> 'draft';
    if not exists (select 1 from wp_task_people p
                    where p.task_id = t.id and p.role = 'responsible' and p.removed_at is null) then
      raise exception 'NO_RESPONSIBLE' using errcode = 'P0001';
    end if;
    if not wp_work_valid(v_owner, t.folder_id, t.work_folder_id) then
      raise exception 'BAD_DESTINATION' using errcode = 'P0001';
    end if;
    update wp_tasks
       set status = 'not_started', version = 1, version_at = now(), published_at = now(), updated_at = now()
     where id = t.id;
    perform wp_log(v_owner, t.id, t.meeting_id, 'published', '', '{}'::jsonb);
    v_count := v_count + 1;
  end loop;

  if p_meeting is not null then
    v_version := m.current_version + 1;
    insert into wp_meeting_versions (owner_id, meeting_id, version, shared_notes, change_note, published_by)
    values (v_owner, p_meeting, v_version, coalesce(p_shared_notes, ''), btrim(coalesce(p_change_note, '')), auth.uid())
    returning id into v_version_id;
    insert into wp_note_recipients (owner_id, version_id, person_id)
    select distinct v_owner, v_version_id, x.person_id
      from (select unnest(p_recipients) as person_id
             where p_recipients is not null
            union
            select p.person_id
              from wp_task_people p join wp_tasks k on k.id = p.task_id
             where p_recipients is null and k.meeting_id = p_meeting
               and k.status not in ('draft', 'cancelled') and p.removed_at is null) x;
    update wp_meetings set current_version = v_version, updated_at = now() where id = p_meeting;
    perform wp_log(v_owner, null, p_meeting, 'notes_published', btrim(coalesce(p_change_note, '')),
                   jsonb_build_object('version', v_version));
  end if;
  return jsonb_build_object('published_tasks', v_count, 'meeting_version', v_version);
end;
$$;

-- The board: every task of the company (or one project), drafts included,
-- each flagged blocked / not_acknowledged_24h / overdue for the office lists.
create or replace function wp_office_board(p_folder uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(wp_task_doc(t.id, auth.uid(), true)
                                    order by t.planned_end nulls last, t.created_at), '[]'::jsonb)
            from wp_tasks t
           where t.owner_id = data_owner_id()
             and (p_folder is null or t.folder_id = p_folder)
             and t.status <> 'cancelled'
             and (t.status <> 'completed' or t.completed_at > now() - interval '30 days'));
end;
$$;

create or replace function wp_office_task(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if not exists (select 1 from wp_tasks t where t.id = p_task and t.owner_id = data_owner_id()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return wp_task_doc(p_task, auth.uid(), true);
end;
$$;

revoke all on function wp_office_destinations() from public, anon;
grant execute on function wp_office_destinations() to authenticated;
revoke all on function wp_office_meetings() from public, anon;
grant execute on function wp_office_meetings() to authenticated;
revoke all on function wp_office_meeting(uuid) from public, anon;
grant execute on function wp_office_meeting(uuid) to authenticated;
revoke all on function wp_office_save_meeting(uuid, text, date, text) from public, anon;
grant execute on function wp_office_save_meeting(uuid, text, date, text) to authenticated;
revoke all on function wp_office_save_task(uuid, jsonb) from public, anon;
grant execute on function wp_office_save_task(uuid, jsonb) to authenticated;
revoke all on function wp_office_publish(uuid, uuid[], text, uuid[], text) from public, anon;
grant execute on function wp_office_publish(uuid, uuid[], text, uuid[], text) to authenticated;
revoke all on function wp_office_board(uuid) from public, anon;
grant execute on function wp_office_board(uuid) to authenticated;
revoke all on function wp_office_task(uuid) from public, anon;
grant execute on function wp_office_task(uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/workmate-workplan.test.js`
Expected: `27 passed, 0 failed`.

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 4: Office decisions — clear blocker, approve, send back, reopen, cancel

**Files:**
- Modify: `supabase/migrations/0093_workmate_my_work.sql` (append §7)
- Modify: `tests/workmate-workplan.test.js` (insert above the marker)

**Interfaces:**
- Consumes (Task 1): `wp_office_task_row`, `wp_task_blocked`, `wp_task_doc`, `wp_log`.
- Produces (granted to authenticated), each returning `{task}` (office doc):
  - `wp_office_clear_blocker(p_blocker uuid, p_note text)`
  - `wp_office_approve(p_task uuid, p_note text)`
  - `wp_office_send_back(p_task uuid, p_reason text)`
  - `wp_office_reopen(p_task uuid, p_reason text)`
  - `wp_office_cancel(p_task uuid, p_reason text)`

- [ ] **Step 1: Write the failing tests**

Insert above the marker:

```js
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
});

test('decision RPCs are callable when signed in, never by anon', () => {
  for (const sig of ['wp_office_clear_blocker\\(uuid, text\\)', 'wp_office_approve\\(uuid, text\\)',
    'wp_office_send_back\\(uuid, text\\)', 'wp_office_reopen\\(uuid, text\\)', 'wp_office_cancel\\(uuid, text\\)']) {
    assert(new RegExp('revoke all on function ' + sig + ' from public, anon;').test(CODE), sig + ' revoke');
    assert(new RegExp('grant execute on function ' + sig + ' to authenticated;').test(CODE), sig + ' grant');
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/workmate-workplan.test.js`
Expected: the 5 new tests FAIL; earlier 27 pass; exit code 1.

- [ ] **Step 3: Append §7 to the migration**

```sql
-- ════ §7 Office: decisions (online only) ══════════════════════════════

-- Only the office clears a blocker — after checking the materials, tool or
-- preparation really are ready for THIS task (spec §8). A note is required.
create or replace function wp_office_clear_blocker(p_blocker uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b wp_blockers;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  select * into b from wp_blockers where id = p_blocker and owner_id = data_owner_id() for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if b.cleared_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update wp_blockers set cleared_by = auth.uid(), cleared_at = now(), clear_note = btrim(p_note) where id = b.id;
  perform wp_log(b.owner_id, b.task_id, null, 'blocker_cleared', btrim(p_note), jsonb_build_object('blocker_id', b.id));
  return jsonb_build_object('task', wp_task_doc(b.task_id, auth.uid(), true));
end;
$$;

-- Final approval: from Reported done or Leader checked, never while blocked.
create or replace function wp_office_approve(p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  t := wp_office_task_row(p_task);
  if t.status not in ('reported_done', 'leader_checked') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if wp_task_blocked(t.id) then
    raise exception 'TASK_BLOCKED' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'completed', completed_at = now(), sent_back = false, updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'approved', btrim(coalesce(p_note, '')), '{}'::jsonb);
  return jsonb_build_object('task', wp_task_doc(t.id, auth.uid(), true));
end;
$$;

-- Reject a done report: back to In progress, marked Sent back; the leader's
-- check is cleared (it was for the rejected report). History keeps both.
create or replace function wp_office_send_back(p_task uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  t := wp_office_task_row(p_task);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if t.status not in ('reported_done', 'leader_checked') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'in_progress', sent_back = true, updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'sent_back', btrim(p_reason), '{}'::jsonb);
  return jsonb_build_object('task', wp_task_doc(t.id, auth.uid(), true));
end;
$$;

-- Reopen a Completed task: same effect as Send back. Tasks that wait for it
-- become Blocked again automatically (Blocked is derived).
create or replace function wp_office_reopen(p_task uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  t := wp_office_task_row(p_task);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if t.status <> 'completed' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'in_progress', sent_back = true, completed_at = null, updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'reopened', btrim(p_reason), '{}'::jsonb);
  return jsonb_build_object('task', wp_task_doc(t.id, auth.uid(), true));
end;
$$;

-- Cancel a draft (e.g. a declined proposal) or a live task, with a reason.
-- Refused while another task still waits for it — unlink that first.
create or replace function wp_office_cancel(p_task uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t wp_tasks;
begin
  t := wp_office_task_row(p_task);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if t.status in ('completed', 'cancelled') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if exists (select 1 from wp_dependencies x join wp_tasks d on d.id = x.task_id
              where x.depends_on = t.id and d.status <> 'cancelled') then
    raise exception 'HAS_DEPENDENTS' using errcode = 'P0001';
  end if;
  update wp_tasks set status = 'cancelled', updated_at = now() where id = t.id;
  perform wp_log(t.owner_id, t.id, null, 'cancelled', btrim(p_reason), '{}'::jsonb);
  return jsonb_build_object('task', wp_task_doc(t.id, auth.uid(), true));
end;
$$;

revoke all on function wp_office_clear_blocker(uuid, text) from public, anon;
grant execute on function wp_office_clear_blocker(uuid, text) to authenticated;
revoke all on function wp_office_approve(uuid, text) from public, anon;
grant execute on function wp_office_approve(uuid, text) to authenticated;
revoke all on function wp_office_send_back(uuid, text) from public, anon;
grant execute on function wp_office_send_back(uuid, text) to authenticated;
revoke all on function wp_office_reopen(uuid, text) from public, anon;
grant execute on function wp_office_reopen(uuid, text) to authenticated;
revoke all on function wp_office_cancel(uuid, text) from public, anon;
grant execute on function wp_office_cancel(uuid, text) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/workmate-workplan.test.js`
Expected: `32 passed, 0 failed`.

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 5: Acceptance script, docs and `npm test`

**Files:**
- Create: `supabase/tests/1c_acceptance.sql`
- Modify: `tests/workmate-workplan.test.js` (insert above the marker)
- Modify: `package.json`, `supabase/migrations/README.md` (CRLF), `docs/DATABASE_SCHEMA.md` (CRLF)

**Interfaces:**
- Consumes: every RPC from Tasks 2–4; accounts W-0007, W-0019 (workers), W-0021 (teamLeader), an active staff account of their owner, another owner account (same requirements as `1a_acceptance.sql` / `1b_acceptance.sql`).

- [ ] **Step 1: Write the failing tests**

Insert above the marker:

```js
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
  assert(/\*\*0093 \(WorkMate Stage 1c-1/.test(readme) && /\*\*0094\*\*/.test(readme), 'README paragraph + next number');
  assert(/wp_tasks/.test(read('docs/DATABASE_SCHEMA.md')), 'DATABASE_SCHEMA.md section');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/workmate-workplan.test.js`
Expected: the 3 new tests FAIL; earlier 32 pass; exit code 1.

- [ ] **Step 3: Create the acceptance script**

Create `supabase/tests/1c_acceptance.sql` (LF):

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-1 acceptance — My Work server (migration 0093).
--
-- Wraps itself in begin / rollback: nothing persists. Builds its own
-- throwaway projects, team, meeting and tasks (names start "ZZ 1c") and
-- checks only what it built. Editor-safe: context lives in transaction-
-- local settings (set_config 'v1c.*'), never a temp table. Dry run with
-- 0093:  begin;  <0093>  <this file>  (its own begin only warns; its
-- rollback undoes the migration too).
--
-- Accounts: W-0007 and W-0019 (active workers), W-0021 (active
-- teamLeader), all of one owner; an active staff account of that owner;
-- another owner account. A failed check stops the script with its message
-- (in the SQL editor the whole transaction is then aborted — expected;
-- nothing is kept); success ends with the row
-- '1c acceptance: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 0. Throwaway data (as the database owner) ──
do $$
declare
  v_w7 uuid; v_w19 uuid; v_w21 uuid; v_owner uuid; v_staff uuid; v_other uuid;
  v_p uuid; v_aw uuid; v_done uuid; v_oth_p uuid; v_team uuid;
begin
  select id into v_w7  from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w19 from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w21 from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null and v_w19 is not null and v_w21 is not null,
    'W-0007 and W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select coalesce(owner_id, id) from profiles where id = v_w19) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_w21) = v_owner, 'the three accounts must share one owner';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  select id into v_other from profiles where role = 'owner' and id <> v_owner limit 1;
  assert v_staff is not null and v_other is not null, 'need an active staff account of that owner and another owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1c project') returning id into v_p;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 1c AW', v_p) returning id into v_aw;
  insert into folders (owner_id, name, completed_at) values (v_owner, 'ZZ 1c done', now()) returning id into v_done;
  insert into folders (owner_id, name) values (v_other, 'ZZ 1c other company') returning id into v_oth_p;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1c team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values
    (v_owner, v_team, v_w21, true), (v_owner, v_team, v_w7, false), (v_owner, v_team, v_w19, false);

  perform set_config('v1c.w7', v_w7::text, true);
  perform set_config('v1c.w19', v_w19::text, true);
  perform set_config('v1c.w21', v_w21::text, true);
  perform set_config('v1c.staff', v_staff::text, true);
  perform set_config('v1c.p', v_p::text, true);
  perform set_config('v1c.aw', v_aw::text, true);
  perform set_config('v1c.done', v_done::text, true);
  perform set_config('v1c.oth_p', v_oth_p::text, true);
  perform set_config('v1c.team', v_team::text, true);
end $$;

-- ── 1. Staff: meeting, drafts, validation, publish (spec §13: drafts stay drafts; one destination; one responsible) ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_m uuid; v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_t5 uuid;
  v_base jsonb; v_d1 jsonb; v_d2 jsonb; v_res jsonb;
begin
  v_m := (wp_office_save_meeting(null, 'ZZ 1c meeting', '2026-10-12', 'ZZPRIVATE original notes') ->> 'meeting_id')::uuid;
  v_base := jsonb_build_object('meeting_id', v_m, 'folder_id', current_setting('v1c.p'), 'team_id', current_setting('v1c.team'));
  v_d1 := v_base || jsonb_build_object('title', 'ZZ 1c wall prep', 'responsible_id', current_setting('v1c.w19'),
                                       'source_passage', 'ZZSOURCE', 'office_flags', jsonb_build_array('ZZFLAG'));
  v_t1 := (wp_office_save_task(null, v_d1) -> 'task' ->> 'id')::uuid;
  v_d2 := v_base || jsonb_build_object('title', 'ZZ 1c electrical', 'work_id', current_setting('v1c.aw'),
                                       'responsible_id', current_setting('v1c.w7'),
                                       'helper_ids', jsonb_build_array(current_setting('v1c.w19')),
                                       'depends_on', jsonb_build_array(v_t1),
                                       'planned_start', '2026-10-19', 'planned_end', '2026-10-21');
  v_t2 := (wp_office_save_task(null, v_d2) -> 'task' ->> 'id')::uuid;
  assert (select status from wp_tasks where id = v_t2) = 'draft' and (select version from wp_tasks where id = v_t2) = 0,
    'a new task is a draft at version 0';

  begin perform wp_office_save_task(v_t1, v_d1 || jsonb_build_object('depends_on', jsonb_build_array(v_t2))); raise exception 'no error';
  exception when others then assert sqlerrm = 'DEPENDENCY_CYCLE', 'wall → electrical → wall must be refused, got ' || sqlerrm; end;
  begin perform wp_office_save_task(null, v_d1 || jsonb_build_object('folder_id', current_setting('v1c.done'))); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'a completed project is refused, got ' || sqlerrm; end;
  begin perform wp_office_save_task(null, v_d1 || jsonb_build_object('folder_id', current_setting('v1c.oth_p'))); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'another company''s project is refused, got ' || sqlerrm; end;
  begin perform wp_office_save_task(null, v_d1 || jsonb_build_object('responsible_id', current_setting('v1c.staff'))); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_PERSON', 'a staff account cannot be the responsible person, got ' || sqlerrm; end;
  begin perform wp_office_save_task(null, v_d1 || jsonb_build_object('helper_ids', jsonb_build_array(current_setting('v1c.w19')))); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_PERSON', 'the responsible person cannot also be a helper, got ' || sqlerrm; end;

  v_t3 := (wp_office_save_task(null, v_base || jsonb_build_object('title', 'ZZ 1c no one yet')) -> 'task' ->> 'id')::uuid;
  begin perform wp_office_publish(null, array[v_t3], null, null, null); raise exception 'no error';
  exception when others then assert sqlerrm = 'NO_RESPONSIBLE', 'no responsible person, no publish; got ' || sqlerrm; end;
  perform wp_office_cancel(v_t3, 'ZZ duplicate');

  -- An individual task (no meeting, no team) that is already overdue, and one that waits for it.
  v_t4 := (wp_office_save_task(null, jsonb_build_object('folder_id', current_setting('v1c.p'), 'title', 'ZZ 1c individual',
            'responsible_id', current_setting('v1c.w7'), 'planned_end', '2026-10-01')) -> 'task' ->> 'id')::uuid;
  v_t5 := (wp_office_save_task(null, jsonb_build_object('folder_id', current_setting('v1c.p'), 'title', 'ZZ 1c after individual',
            'responsible_id', current_setting('v1c.w19'), 'depends_on', jsonb_build_array(v_t4))) -> 'task' ->> 'id')::uuid;
  begin perform wp_office_cancel(v_t4, 'ZZ test'); raise exception 'no error';
  exception when others then assert sqlerrm = 'HAS_DEPENDENTS', 'a task another waits for cannot be cancelled, got ' || sqlerrm; end;

  v_res := wp_office_publish(v_m, null, 'Shared: Monday start, wall first.', null, 'first version');
  assert (v_res ->> 'published_tasks')::int = 2 and (v_res ->> 'meeting_version')::int = 1,
    'publishing the meeting publishes its two drafts as version 1: ' || v_res::text;
  assert (select status from wp_tasks where id = v_t1) = 'not_started' and (select version from wp_tasks where id = v_t1) = 1,
    'published = Not started, version 1';
  assert (select array_agg(r.person_id order by r.person_id)
            from wp_note_recipients r join wp_meeting_versions v on v.id = r.version_id where v.meeting_id = v_m)
       = (select array_agg(x order by x) from unnest(array[current_setting('v1c.w7')::uuid, current_setting('v1c.w19')::uuid]) x),
    'default recipients = the people assigned in that meeting (not the leader)';
  perform wp_office_publish(null, array[v_t4], null, null, null);

  perform set_config('v1c.m', v_m::text, true);
  perform set_config('v1c.t1', v_t1::text, true);
  perform set_config('v1c.t2', v_t2::text, true);
  perform set_config('v1c.t3', v_t3::text, true);
  perform set_config('v1c.t4', v_t4::text, true);
end $$;

-- ── 2. W-0007: only their own tasks; electrical blocked by the wall; acknowledgement retry; notes ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_work jsonb; v_t2 jsonb; v_notes jsonb; v_r1 jsonb; v_r2 jsonb; v_op uuid := gen_random_uuid();
begin
  v_work := wp_my_work();
  assert not exists (select 1 from jsonb_array_elements(v_work) x where x ->> 'id' = current_setting('v1c.t1')),
    'W-0007 is not on the wall task, so it is not listed';
  select x into v_t2 from jsonb_array_elements(v_work) x where x ->> 'id' = current_setting('v1c.t2');
  assert v_t2 is not null and v_t2 ->> 'my_role' = 'responsible', 'W-0007 sees electrical as responsible';
  assert (v_t2 ->> 'blocked')::boolean and jsonb_array_length(v_t2 -> 'waiting_for') = 1, 'electrical waits for the wall';
  assert v_t2 ->> 'work_name' = 'ZZ 1c AW', 'the Additional Works name is shown';
  assert not (v_t2 ? 'source_passage') and not (v_t2 ? 'office_flags') and not (v_t2 ? 'acks') and not (v_t2 ? 'proposed_by'),
    'no office-only fields reach a worker';
  assert exists (select 1 from jsonb_array_elements(v_work) x where x ->> 'id' = current_setting('v1c.t4')), 'the individual task is listed';

  begin perform wp_start_work(gen_random_uuid(), current_setting('v1c.t2')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'TASK_BLOCKED', 'Start work is locked while blocked, got ' || sqlerrm; end;

  v_r1 := wp_acknowledge(v_op, current_setting('v1c.t2')::uuid, 1);
  v_r2 := wp_acknowledge(v_op, current_setting('v1c.t2')::uuid, 1);
  assert v_r1 = v_r2 and not (v_r1 ->> 'stale')::boolean, 'a retried acknowledgement returns the first answer';

  v_notes := wp_my_notes();
  assert exists (select 1 from jsonb_array_elements(v_notes) x
                  where x ->> 'meeting_id' = current_setting('v1c.m') and x ->> 'shared_notes' like 'Shared:%'),
    'W-0007 reads the shared notes';
  assert position('ZZPRIVATE' in v_notes::text) = 0 and position('ZZSOURCE' in v_work::text) = 0
     and position('ZZFLAG' in v_work::text) = 0, 'original notes, AI source and office flags never reach a worker';

  begin perform wp_office_board(null); raise exception 'no error';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'a worker cannot open the office board, got ' || sqlerrm; end;
  begin perform wp_propose_task(gen_random_uuid(), current_setting('v1c.team')::uuid, current_setting('v1c.p')::uuid, null, 'ZZ idea', '');
    raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_LEADER', 'only a current team leader proposes, got ' || sqlerrm; end;
  begin perform wp_report_progress(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'x'); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_ASSIGNED', 'no action on a task you are not on, got ' || sqlerrm; end;
end $$;

-- ── 3. W-0019: reports a blocker (once, despite a retry); photo rules ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_op uuid := gen_random_uuid(); v_a jsonb; v_b jsonb;
begin
  begin perform wp_report_blocker(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'weather', 'ulan', null); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_KIND', 'an unknown blocker kind is refused, got ' || sqlerrm; end;
  v_a := wp_report_blocker(v_op, current_setting('v1c.t1')::uuid, 'materials', 'Walang semento', null);
  v_b := wp_report_blocker(v_op, current_setting('v1c.t1')::uuid, 'materials', 'Walang semento', null);
  assert v_a = v_b and jsonb_array_length(v_a -> 'task' -> 'blockers') = 1, 'a retried blocker report is recorded once';
  perform set_config('v1c.blocker', v_a ->> 'blocker_id', true);
  begin perform wp_start_work(gen_random_uuid(), current_setting('v1c.t1')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'TASK_BLOCKED', 'an open blocker locks Start work, got ' || sqlerrm; end;
  begin perform wp_attach_photo(gen_random_uuid(), current_setting('v1c.t1')::uuid, (v_a ->> 'blocker_id')::uuid, null,
                                current_setting('v1c.w7') || '/' || current_setting('v1c.t1') || '/x.jpg'); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_PATH', 'a photo path starts with the uploader and the task, got ' || sqlerrm; end;
  begin perform wp_attach_photo(gen_random_uuid(), current_setting('v1c.t1')::uuid, (v_a ->> 'blocker_id')::uuid, null,
                                current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/missing.jpg'); raise exception 'no error';
  exception when others then assert sqlerrm = 'PHOTO_NOT_UPLOADED', 'a photo must be uploaded first, got ' || sqlerrm; end;
end $$;

-- ── 4. Staff clears the blocker (note required) ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform wp_office_clear_blocker(current_setting('v1c.blocker')::uuid, ' '); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOTE_REQUIRED', 'clearing needs a note, got ' || sqlerrm; end;
  perform wp_office_clear_blocker(current_setting('v1c.blocker')::uuid, 'Semento delivered and checked at site');
  assert not (wp_office_task(current_setting('v1c.t1')::uuid) ->> 'blocked')::boolean, 'cleared → no longer blocked';
end $$;

-- The phone's upload, simulated as the database owner.
reset role;
insert into storage.objects (bucket_id, name, owner)
values ('task-photos', current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/ok.jpg', current_setting('v1c.w19')::uuid);
set local role authenticated;

-- ── 5. W-0019: attaches the photo, starts, reports done; cannot check own work ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_r jsonb;
begin
  v_r := wp_attach_photo(gen_random_uuid(), current_setting('v1c.t1')::uuid, current_setting('v1c.blocker')::uuid, null,
                         current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/ok.jpg');
  assert v_r ? 'photo_id', 'photo attached';
  perform wp_start_work(gen_random_uuid(), current_setting('v1c.t1')::uuid);
  v_r := wp_report_done(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'Tapos na ang palitada');
  assert v_r -> 'task' ->> 'status' = 'reported_done', 'reported done';
  begin perform wp_leader_check(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'ok'); raise exception 'no error';
  exception when others then assert sqlerrm = 'OWN_WORK', 'nobody checks their own work, got ' || sqlerrm; end;
end $$;

-- ── 6. W-0021 (current team leader): sees team tasks, checks the wall, proposes ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w21'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t1 jsonb; v_r jsonb;
begin
  select x into v_t1 from jsonb_array_elements(wp_my_work()) x where x ->> 'id' = current_setting('v1c.t1');
  assert v_t1 ->> 'my_role' = 'leader' and (v_t1 ->> 'can_check')::boolean, 'the leader sees the wall task and may check it';
  assert jsonb_array_length(v_t1 -> 'photos') = 1, 'the leader sees the blocker photo';
  assert wp_can_read_task_photo(current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/ok.jpg'), 'the leader may open it';
  begin perform wp_acknowledge(gen_random_uuid(), current_setting('v1c.t1')::uuid, 1); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_ASSIGNED', 'a leader who is not assigned does not acknowledge, got ' || sqlerrm; end;
  begin perform wp_start_work(gen_random_uuid(), current_setting('v1c.t2')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_RESPONSIBLE', 'the leader cannot start someone else''s task, got ' || sqlerrm; end;
  v_r := wp_leader_check(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'Checked, maayos');
  assert v_r -> 'task' ->> 'status' = 'leader_checked', 'leader check recorded';
  v_r := wp_propose_task(gen_random_uuid(), current_setting('v1c.team')::uuid, current_setting('v1c.p')::uuid, null,
                         'ZZ 1c proposal', 'Kailangan ng scaffolding');
  perform set_config('v1c.prop', v_r ->> 'task_id', true);
end $$;

-- W-0007 is not on the wall task: no photo.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w7'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not wp_can_read_task_photo(current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/ok.jpg'),
    'someone not on the task cannot open its photo';
end $$;

-- ── 7. Staff: a proposal is a draft; send back needs a reason ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb;
begin
  v := wp_office_task(current_setting('v1c.prop')::uuid);
  assert v ->> 'status' = 'draft' and v ->> 'proposed_by' is not null, 'a leader proposal arrives as a draft for the office';
  begin perform wp_office_send_back(current_setting('v1c.t1')::uuid, ''); raise exception 'no error';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'send back needs a reason, got ' || sqlerrm; end;
  v := wp_office_send_back(current_setting('v1c.t1')::uuid, 'Kulang ang palitada sa gilid');
  assert v -> 'task' ->> 'status' = 'in_progress' and (v -> 'task' ->> 'sent_back')::boolean, 'sent back → In progress, marked Sent back';
  begin perform wp_office_approve(current_setting('v1c.t1')::uuid, null); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_STATE', 'only reported work can be approved, got ' || sqlerrm; end;
end $$;

-- ── 8. W-0019 reports done again: Sent back clears ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_r jsonb;
begin
  v_r := wp_report_done(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'Inayos na');
  assert v_r -> 'task' ->> 'status' = 'reported_done' and not (v_r -> 'task' ->> 'sent_back')::boolean, 'reported again; Sent back cleared';
end $$;

-- ── 9. Staff: approve unblocks electrical; reopen blocks it again; important revision; notes v2 to W-0007 only ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb;
begin
  v := wp_office_approve(current_setting('v1c.t1')::uuid, 'Good');
  assert v -> 'task' ->> 'status' = 'completed', 'approved';
  assert not (wp_office_task(current_setting('v1c.t2')::uuid) ->> 'blocked')::boolean, 'electrical is ready once the wall is approved';
  begin perform wp_office_reopen(current_setting('v1c.t1')::uuid, ' '); raise exception 'no error';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'reopening needs a reason, got ' || sqlerrm; end;
  v := wp_office_reopen(current_setting('v1c.t1')::uuid, 'Crack found');
  assert v -> 'task' ->> 'status' = 'in_progress' and (v -> 'task' ->> 'sent_back')::boolean and v -> 'task' ->> 'completed_at' is null,
    'reopened → In progress, Sent back';
  assert (wp_office_task(current_setting('v1c.t2')::uuid) ->> 'blocked')::boolean, 'reopening the wall blocks electrical again';

  v := wp_office_task(current_setting('v1c.t2')::uuid);
  perform wp_office_save_task(current_setting('v1c.t2')::uuid, jsonb_build_object(
    'meeting_id', v ->> 'meeting_id', 'folder_id', v ->> 'folder_id', 'work_id', v ->> 'work_id', 'team_id', v ->> 'team_id',
    'title', v ->> 'title', 'responsible_id', v -> 'responsible' ->> 'id',
    'helper_ids', (select jsonb_agg(h -> 'id') from jsonb_array_elements(v -> 'helpers') h),
    'depends_on', v -> 'depends_on', 'planned_start', '2026-10-20', 'planned_end', '2026-10-22',
    'important', true, 'change_note', 'Start moved one day'));
  assert (wp_office_task(current_setting('v1c.t2')::uuid) ->> 'version')::int = 2, 'an important revision raises the version';

  perform wp_office_publish(current_setting('v1c.m')::uuid, null, 'Shared v2: electrical starts Tuesday.',
                            array[current_setting('v1c.w7')::uuid], 'only the electrical crew');
end $$;

-- ── 10. W-0019 reports the wall done again; left out of notes v2 ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w19'), 'role', 'authenticated')::text, true);
do $$
begin
  perform wp_report_done(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'Inayos ang crack');
  assert not exists (select 1 from jsonb_array_elements(wp_my_notes()) x where x ->> 'meeting_id' = current_setting('v1c.m')),
    'W-0019 was not chosen for notes version 2';
end $$;

-- ── 11. Staff approves the wall again ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  perform wp_office_approve(current_setting('v1c.t1')::uuid, 'OK now');
  assert not (wp_office_task(current_setting('v1c.t2')::uuid) ->> 'blocked')::boolean, 'electrical ready again';
  assert exists (select 1 from jsonb_array_elements(wp_office_task(current_setting('v1c.t2')::uuid) -> 'acks') a
                  where a ->> 'person_id' = current_setting('v1c.w7') and not (a ->> 'acked')::boolean),
    'after the revision W-0007 has not acknowledged version 2 yet';
end $$;

-- ── 12. W-0007: stale acknowledgement, then version 2; start, progress, done; notes v2 ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_r jsonb;
begin
  v_r := wp_acknowledge(gen_random_uuid(), current_setting('v1c.t2')::uuid, 1);
  assert (v_r ->> 'stale')::boolean and (v_r -> 'task' ->> 'version')::int = 2, 'acknowledging version 1 is stale after the revision';
  v_r := wp_acknowledge(gen_random_uuid(), current_setting('v1c.t2')::uuid, 2);
  assert not (v_r ->> 'stale')::boolean and (v_r -> 'task' ->> 'my_ack_version')::int = 2, 'version 2 acknowledged';
  perform wp_start_work(gen_random_uuid(), current_setting('v1c.t2')::uuid);
  v_r := wp_report_progress(gen_random_uuid(), current_setting('v1c.t2')::uuid, 'Kalahati na');
  assert v_r ? 'event_id', 'progress recorded';
  v_r := wp_report_done(gen_random_uuid(), current_setting('v1c.t2')::uuid, 'Tapos');
  assert v_r -> 'task' ->> 'status' = 'reported_done', 'electrical reported done';
  assert exists (select 1 from jsonb_array_elements(wp_my_notes()) x
                  where x ->> 'meeting_id' = current_setting('v1c.m') and (x ->> 'version')::int = 2), 'W-0007 reads notes version 2';
end $$;

-- ── 13. Office lists: not acknowledged after 24h, overdue; declined proposal; meeting history ──
reset role;
update wp_tasks set version_at = now() - interval '25 hours' where id = current_setting('v1c.t4')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  b jsonb; x jsonb; m jsonb;
begin
  b := wp_office_board(current_setting('v1c.p')::uuid);
  select e into x from jsonb_array_elements(b) e where e ->> 'id' = current_setting('v1c.t4');
  assert (x ->> 'not_acknowledged_24h')::boolean and (x ->> 'overdue')::boolean,
    'the individual task shows Not acknowledged (24h) and Overdue';
  assert not exists (select 1 from jsonb_array_elements(b) e where e ->> 'id' = current_setting('v1c.t3')), 'cancelled tasks leave the board';
  perform wp_office_cancel(current_setting('v1c.prop')::uuid, 'Not this week');
  assert wp_office_task(current_setting('v1c.prop')::uuid) ->> 'status' = 'cancelled', 'a proposal can be declined';
  m := wp_office_meeting(current_setting('v1c.m')::uuid);
  assert (m ->> 'current_version')::int = 2 and jsonb_array_length(m -> 'versions') = 2, 'both note versions are kept';
  assert position('ZZPRIVATE' in m::text) > 0, 'the office keeps the original notes';
end $$;

-- ── 14. Permission fence (as the database owner) ──
reset role;
do $$
declare
  f text; t text;
begin
  foreach f in array array['wp_person_ok(uuid,uuid)', 'wp_work_valid(uuid,uuid,uuid)', 'wp_task_blocked(uuid)', 'wp_role_on(uuid,uuid)',
      'wp_can_check(uuid,uuid)', 'wp_depends_on(uuid,uuid)', 'wp_task_doc(uuid,uuid,boolean)', 'wp_op_prev(uuid,uuid)',
      'wp_op_save(uuid,uuid,text,jsonb)', 'wp_log(uuid,uuid,uuid,text,text,jsonb)', 'wp_worker_task(uuid)', 'wp_office_task_row(uuid)'] loop
    assert not has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' must be internal';
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' must not be callable by anon';
  end loop;
  foreach f in array array['wp_my_work()', 'wp_my_notes()', 'wp_acknowledge(uuid,uuid,integer)', 'wp_start_work(uuid,uuid)',
      'wp_report_progress(uuid,uuid,text)', 'wp_report_blocker(uuid,uuid,text,text,uuid)', 'wp_report_done(uuid,uuid,text)',
      'wp_leader_check(uuid,uuid,text)', 'wp_propose_task(uuid,uuid,uuid,uuid,text,text)', 'wp_attach_photo(uuid,uuid,uuid,bigint,text)',
      'wp_office_destinations()', 'wp_office_meetings()', 'wp_office_meeting(uuid)', 'wp_office_save_meeting(uuid,text,date,text)',
      'wp_office_save_task(uuid,jsonb)', 'wp_office_publish(uuid,uuid[],text,uuid[],text)', 'wp_office_board(uuid)', 'wp_office_task(uuid)',
      'wp_office_clear_blocker(uuid,text)', 'wp_office_approve(uuid,text)', 'wp_office_send_back(uuid,text)',
      'wp_office_reopen(uuid,text)', 'wp_office_cancel(uuid,text)',
      'wp_can_upload_task_path(text)', 'wp_can_read_task_photo(text)', 'wp_office_task_path_ok(text)'] loop
    assert has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' must be callable when signed in';
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' must not be callable by anon';
  end loop;
  foreach t in array array['wp_meetings', 'wp_meeting_versions', 'wp_note_recipients', 'wp_tasks', 'wp_task_people', 'wp_acks',
      'wp_blockers', 'wp_dependencies', 'wp_events', 'wp_ops', 'wp_photos'] loop
    assert not has_table_privilege('anon', 'public.' || t, 'select'), t || ': anon reads nothing';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert')
       and not has_table_privilege('authenticated', 'public.' || t, 'update')
       and not has_table_privilege('authenticated', 'public.' || t, 'delete'), t || ': no direct writes';
  end loop;
  assert (select public = false from storage.buckets where id = 'task-photos'), 'task-photos is private';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name like 'wp\_%' and column_name ~* '(price|amount|cost|peso)'),
    'no wp_ table has a money column';
end $$;

select '1c acceptance: all checks passed' as result;

rollback;
```

- [ ] **Step 4: Add the suite to `npm test`**

In `package.json`, append ` && node tests/workmate-workplan.test.js` to the end of the `"test"` script string (after `node tests/project-control-staff.test.js`). Use the Edit tool; change nothing else.

- [ ] **Step 5: Update the two CRLF docs with Python**

Run with Python (`python -I`), from the repo root:

```python
import re
p = 'supabase/migrations/README.md'
s = open(p, 'rb').read().decode('utf-8')
s, n = re.subn(r"\(\*\*\d{4}\*\* — highest on disk is\s+`[^`]+`\)",
               "(**0094** — highest on disk is\r\n  `0093_workmate_my_work.sql`)", s, count=1)
assert n == 1, 'next-number line not found'
anchor = s.index('**0092 (catalogue kind/unit lock)**')
end = s.index('\r\n', anchor)
para = ("\r\n\r\n**0093 (WorkMate Stage 1c-1 — My Work server)** adds the work plan: `wp_meetings` (office-only "
        "`original_notes`) with published shared-note versions `wp_meeting_versions` + `wp_note_recipients`, `wp_tasks` "
        "(draft → not_started → in_progress → reported_done → leader_checked → completed, or cancelled; `sent_back`; "
        "`version` for re-acknowledgement), `wp_task_people` (one responsible + helpers, history kept), `wp_acks` (per "
        "version), `wp_blockers` (office clears with a note), `wp_dependencies` (same project, no cycles), `wp_events`, "
        "`wp_ops` (retry-safe worker writes) and `wp_photos` in the private `task-photos` bucket. Blocked is derived "
        "(`wp_task_blocked`) and locks Start work / Report done / approval. Worker RPCs `wp_my_work`, `wp_my_notes`, "
        "`wp_acknowledge`, `wp_start_work`, `wp_report_progress`, `wp_report_blocker`, `wp_report_done`, "
        "`wp_leader_check`, `wp_propose_task`, `wp_attach_photo`; office RPCs `wp_office_*`. No money; nothing feeds "
        "Spent, Attendance or payroll. Dry-run with `supabase/tests/1c_acceptance.sql` (self-wrapped, editor-safe).")
s = s[:end] + para + s[end:]
open(p, 'wb').write(s.encode('utf-8'))

p = 'docs/DATABASE_SCHEMA.md'
s = open(p, 'rb').read().decode('utf-8')
section = (
 "## 14. WorkMate My Work (`0093`) — meetings, tasks and work checks\r\n\r\n"
 "Stage 1c-1 server (plan `docs/superpowers/plans/2026-10-12-workmate-stage1c1-my-work-server.md`). **Project Control only. "
 "No money.** Workers reach nothing directly: every `wp_*` table is RLS-on with office SELECT policies only; workers use "
 "`SECURITY DEFINER` RPCs that re-check their role on the task when they run.\r\n\r\n"
 "| Table | What it is |\r\n|---|---|\r\n"
 "| `wp_meetings` | Title, `held_on`, **office-only** `original_notes`, `current_version` (0 = never published) |\r\n"
 "| `wp_meeting_versions`, `wp_note_recipients` | Each publish of shared notes is a version; recipients chosen by staff (default: people assigned in that meeting). Workers read only the latest version they received |\r\n"
 "| `wp_tasks` | One project + Main Contract/AW (`folder_id`, `work_folder_id`), optional `meeting_id` (null = standalone) and `team_id`; status draft/not_started/in_progress/reported_done/leader_checked/completed/cancelled; `sent_back`; `version` (0 = draft, raised by an important revision); office-only `source_passage`, `office_flags`, `proposed_by` |\r\n"
 "| `wp_task_people` | One current `responsible` + `helper`s; removal sets `removed_at` |\r\n"
 "| `wp_acks` | Acknowledgement per person per task **version** |\r\n"
 "| `wp_blockers` | materials/tool/preparation/other, optional `request_id`; cleared only by the office with `clear_note` |\r\n"
 "| `wp_dependencies` | Task waits for another task of the same project; no cycles |\r\n"
 "| `wp_events` | Append-only history (drafted, published, revised, acknowledged, started, progress, blocker_reported/cleared, reported_done, leader_checked, sent_back, approved, reopened, cancelled, proposed, photo_attached, notes_published) |\r\n"
 "| `wp_ops` | First result per `(actor_id, op_id)` — a retried phone operation returns it verbatim |\r\n"
 "| `wp_photos` | Private bucket **`task-photos`** (`<uploader>/<task>/<uuid>.jpg`): uploader, responsible, current team leader, office |\r\n\r\n"
 "**Blocked** is derived (`wp_task_blocked`): an open blocker or a dependency not `completed`. It locks Start work, Report done and office approval.\r\n\r\n"
 "| RPC | Who | What it does |\r\n|---|---|---|\r\n"
 "| `wp_my_work()`, `wp_my_notes()` | worker | Tasks with a role (responsible/helper/current leader); latest received shared notes |\r\n"
 "| `wp_acknowledge(op, task, version)` | assigned | Outdated version → `stale` answer, nothing recorded |\r\n"
 "| `wp_start_work`, `wp_report_progress`, `wp_report_done` | responsible | Start/Done refused while blocked (`TASK_BLOCKED`) |\r\n"
 "| `wp_report_blocker(op, task, kind, description, request)` | any role | Never creates a purchase or moves a date |\r\n"
 "| `wp_leader_check(op, task, note)` | current leader | Never own work (`OWN_WORK`); office approval still required |\r\n"
 "| `wp_propose_task(op, team, folder, work, title, details)` | current leader | Arrives as a draft for the office |\r\n"
 "| `wp_attach_photo(op, task, blocker, event, path)` | any role | Upload first, then attach |\r\n"
 "| `wp_office_destinations/meetings/meeting/save_meeting/save_task/publish/board/task` | office | Plan, publish (version 1, recipients), board with `blocked` / `not_acknowledged_24h` / `overdue` |\r\n"
 "| `wp_office_clear_blocker/approve/send_back/reopen/cancel` | office | Note/reason required where it matters; cancel refused while another task waits for it |\r\n\r\n")
anchor = s.index('## Relationship map')
s = s[:anchor] + section + s[anchor:]
open(p, 'wb').write(s.encode('utf-8'))
print('docs updated')
```

Expected: prints `docs updated`. Check both files still use CRLF only: `python -I -c "import sys;[print(f, open(f,'rb').read().count(b'\n')==open(f,'rb').read().count(b'\r\n')) for f in sys.argv[1:]]" supabase/migrations/README.md docs/DATABASE_SCHEMA.md` → `True` twice.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node tests/workmate-workplan.test.js`
Expected: `35 passed, 0 failed`.

Run: `npm test`
Expected: every suite green, ending with the workmate my work suite (`35 passed, 0 failed`).

- [ ] **Step 7: Stop — no commit.** Report to the controller.

---

### Task 6: Dry run, apply, live verification (controller + user)

No implementer. The controller prepares files and verifies; **the user** runs DDL in the Supabase SQL editor (MCP refuses DDL).

- [ ] **Step 1: Build the dry-run file**

With Python (bytes, no BOM, LF): `Downloads\0093_dry_run.sql` = `b'begin;\n\n' + migration.rstrip(b'\n') + b'\n\n' + acceptance`. Check: starts with `begin;`, contains no `\r`, no BOM.

- [ ] **Step 2: User dry run**

The user pastes `0093_dry_run.sql` into the SQL editor and runs it.
Expected: a single result row `1c acceptance: all checks passed` (the acceptance's own `rollback` undoes the migration too). Any error message names the failed check — fix in the files, rebuild, repeat.

- [ ] **Step 3: User applies 0093**

The user pastes `supabase/migrations/0093_workmate_my_work.sql` alone and runs it. Expected: "Success. No rows returned".

- [ ] **Step 4: Verify live (controller, MCP `execute_sql`, read-only)**

```sql
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'wp\_%') as tables,        -- 11
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'wp\_%') as fns,                                                              -- 38
  (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'task-photos:%') as photo_policies,         -- 3
  (select public from storage.buckets where id = 'task-photos') as bucket_public;                                               -- false
```

Expected: `tables 11, fns 38, photo_policies 3, bucket_public false` (38 = 12 internal + 3 storage helpers + 10 worker + 8 office planning + 5 office decisions). If not, the apply did not land (memory: verify-user-applied-migrations) — ask the user to re-run.

- [ ] **Step 5: Live acceptance (controller, MCP `execute_sql`)**

Run `supabase/tests/1c_acceptance.sql` through MCP `execute_sql` (DML only; self-rolling-back). Expected: `1c acceptance: all checks passed`.
Then run `supabase/tests/1a_acceptance.sql` and `1b_acceptance.sql` the same way. Expected: both pass — 0093 touches no `pr_*` object.

- [ ] **Step 6: Close out**

`npm test` green; append "Execution notes" to this plan (rulings, deviations, live results); update memory `workmate-stage1c-my-work.md` (1c-1 live; next 1c-2 Dacs Web Work Plan section) and its `MEMORY.md` line. Tell the user to commit and push Dacs Web. **Deploy order:** 0093 is additive (no existing table or function changes), so the push may follow the apply at any time.

---

## Execution notes (2026-10-12)

- Executed subagent-driven on `main`, no worktree, nothing committed by the agent (the user commits). Tasks 1–5 transcribed byte-for-byte (controller-verified), each task reviewed; final whole-change review on the most capable model.
- **Review fixes that changed the plan's code** (all in 0093 as applied):
  - `wp_worker_task` re-checks `pr_is_requester()` (inactive worker refused); `wp_can_read_task_photo` requires an active worker of the task's company.
  - Lock modes: `wp_worker_task`, `wp_office_task_row`, `wp_office_save_task`, `wp_office_publish`, `wp_office_clear_blocker` lock **FOR NO KEY UPDATE** (four deadlock paths closed: concurrent dependency saves, cancel vs link, clear-blocker vs attach-photo, opposite-order publishes). `wp_office_cancel` takes the `wp_deps:<folder>` advisory key; moving a draft takes both projects' keys (sorted) and is refused while another task depends on it (`BAD_DEPENDENCY`). Publish locks explicit task lists in sorted id order.
  - Worker history hides `acknowledged` and `proposed` events.
  - **Start work no longer auto-acknowledges**: it requires the caller's acknowledgement of the CURRENT version (`NOT_ACKNOWLEDGED`). The 1c-3 app must call `wp_acknowledge` before `wp_start_work`, and on `NOT_ACKNOWLEDGED` show the new version.
  - A leader assigned to the task (responsible **or helper**) cannot leader-check it (`OWN_WORK`); `can_check` matches.
  - Acceptance: meeting date = Manila today (no 90-day expiry); leak checks run on a viewer who sees the task; Start checks the acknowledgement gate.
- Deviation from plan text: static suite has **41** tests (plan 35); functions still 38.
- Dry run (user, SQL editor): "1c acceptance: all checks passed". Applied by the user 2026-10-12 ~16:34. Live verify (MCP): 11 `wp_*` tables, 38 functions, 3 `task-photos` policies, private bucket, final code live; no test rows left. 1a/1b not re-run — 0093 creates or alters no `pr_*` object.
- Notes for later plans: 1c-2 must send `[]` (not JSON null) for `helper_ids` / `depends_on` / `office_flags`; re-publishing a meeting with no drafts makes a new notes version (confirm in the UI); a deactivated team or person blocks re-saving a published task until reassigned; the app must upload photos without `upsert` (uploader can't read an unattached photo). Next migration number: 0094.
- Next: plan 1c-2 (Dacs Web Work Plan section + AI drafting via the `dacs-ai` worker on Llama 3.3 70B).
