# WorkMate Stage 1a-2 — Requests Office (Dacs Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admin/staff a **Requests** section in Dacs Web — the request queue (urgent first, by weekly batch), one request's detail with every office action, batch dates, Teams, Catalogue and *Allow requests* per project — backed by office RPCs in migration 0086; stop a project with requests from being half-deleted; and stop workers signing in to the web portal.

**Architecture:** Every office write is a `SECURITY DEFINER` RPC (migration 0086) that checks `pr_is_office()` and `can_access(owner_id)`, locks the `pr_lines` row first, and writes a `pr_events` row — the same server-side-rules approach as 0085, so the browser can never bypass a rule. The browser module is three plain-JS files in the existing no-build style: a core file with pure, Node-tested helpers and the RPC wrappers, a queue/detail file and a setup file (teams, catalogue, projects). They reuse the Attendance `att-*` styles.

**Tech Stack:** Supabase Postgres (plpgsql), plain JS (no build step), `window.sbClient`, Node zero-dependency tests.

**Spec:** `docs/superpowers/specs/2026-09-29-unified-worker-app-design.md` (§3, §4A, §4B, §4E, §5 "Dacs Web provides the request queue…", §6 row 1a, §9) and `docs/superpowers/plans/2026-10-02-workmate-stage1a-roadmap.md`. Builds on `supabase/migrations/0085_workmate_requests.sql` (applied live 2026-10-02) — read its header and §6/§9 before starting.

## Global Constraints

- **Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs Web`. Plain HTML + vanilla JS, **no build step**. **Never run `npm run build`.**
- **NEVER `git commit` / `git push`.** The user commits.
- **NO database access from any task** (no Supabase MCP, no SQL, no CLI). The controller prepares a dry-run file; the **user** runs it and applies 0086 in the SQL editor (Task 8).
- **Migration 0086** (`0085` is the highest on disk). Idempotent: `create or replace function`, `drop policy if exists`. **No `for all` policies and no `to public`/`to anon`** (`tests/storage-access.test.js` scans every migration ≥ 0081).
- **Every office RPC:** `language plpgsql|sql security definer set search_path = public`; refuses with `OFFICE_ONLY` unless `pr_is_office()` (the plain-SQL read RPCs `pr_office_queue`, `pr_office_people`, `pr_office_teams`, `pr_office_catalog`, `pr_office_projects` return `[]` instead); refuses with `NOT_FOUND` unless `can_access(<row>.owner_id)`; for any line change, locks the `pr_lines` row `for update` **before** touching its portions; records a `pr_events` row (`actor_id = auth.uid()`). New rows' `owner_id = data_owner_id()`.
- **Error codes** (exactly): `OFFICE_ONLY`, `NOT_FOUND`, `LINE_CLOSED`, `REDUCTION_PENDING`, `NOTHING_PENDING`, `ALREADY_RESOLVED`, `BAD_QUANTITY`, `REASON_REQUIRED`, `BAD_CATALOG_ITEM`, `BAD_BATCH`, `BAD_DATES`, `ARRANGED`, `NOT_A_TEAM_LEADER`, `NOT_IN_TEAM`, `DUPLICATE_ITEM`, `DUPLICATE_TEAM`, `BAD_ITEM`, `BAD_OUTCOME`, `BAD_TEAM`, `BAD_WORKER` — raised `using errcode = 'P0001'`.
- **No money.** Nothing here shows or stores a price, amount or cost. Staff see the whole Requests section (spec §2: admin/staff process requests).
- **Weekly batches:** cutoff Saturday 12:00 noon Asia/Manila (0085). Batch rows are created only by `pr_batch_for`; the office changes only `purchase_on` / `delivery_on`, through `pr_office_set_batch_dates`. 0086 drops the direct insert/update policies on `pr_batches`.
- **Quantities:** "Still needed" = Σ(`quantity − pending_reduction`). Arranged quantity is never shrunk by a worker (0085); the office resolves a pending reduction explicitly.
- **Dates on screen are Manila time.** Date-only values (`purchase_on`, `needed_by`) are shown as calendar dates without time-zone conversion; never `toISOString().slice(0,10)` for a local date (CLAUDE.md).
- **Escaping:** every value from the database goes through `esc()` before it reaches `innerHTML`.
- **Line endings:** keep each existing file's style (core.autocrlf=true; several files are CRLF in the working tree); new files LF; one trailing newline.
- **Tests:** `npm test` must stay green; new suites `tests/workmate-requests-office.test.js` (static SQL) and `tests/requests-admin.test.js` (pure JS) are added to it. `node --check` every new/changed JS file.

## File map

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/0086_workmate_requests_office.sql` | 1 | Office RPCs, read RPCs, folder guard RPC, batch policy tightening |
| `tests/workmate-requests-office.test.js` | 1, 7 | Static guards on 0086 and on the delete / sign-in call sites |
| `supabase/tests/0086_verify.sql` | 2 | Live behaviour checks (self-wrapped begin/rollback) |
| `docs/DATABASE_SCHEMA.md`, `supabase/migrations/README.md` | 2 | Docs |
| `js/requests-admin-core.js` | 3 | Pure helpers (Node-tested), error copy, RPC wrappers, router |
| `tests/requests-admin.test.js` | 3 | Tests for the pure helpers |
| `js/admin.js`, `admin.html` | 4 | Nav section, views, script tags, switchView wiring |
| `js/requests-admin-queue.js`, `css/requests-admin.css` | 4 | Queue view; the few styles not covered by `att-*` |
| `js/requests-admin-detail.js` | 5 | One request: detail view and every office action |
| `js/requests-admin-setup.js` | 6 | Weekly batches, Teams, Catalogue, Projects (*Allow requests*) views |
| `js/expenses-module.js`, `js/portal-app.compiled.js` | 7 | Refuse deleting a project / Additional Works that has requests |
| `js/admin.js` | 7 | Workers and team leaders can no longer sign in to Dacs Web |
| `docs/ARCHITECTURE.md` | 7 | Module map row |
| `package.json` | 1, 3 | Add the two new test suites |

---

### Task 1: Migration 0086 — office RPCs

**Files:**
- Create: `supabase/migrations/0086_workmate_requests_office.sql`
- Create: `tests/workmate-requests-office.test.js`
- Modify: `package.json` (append ` && node tests/workmate-requests-office.test.js` to the `"test"` script; keep the file's CRLF line endings — only that line may change)

**Interfaces:**
- Consumes (0085, live): tables `pr_teams`, `pr_team_members`, `pr_catalog_items`, `pr_project_settings`, `pr_batches`, `pr_requests`, `pr_lines`, `pr_line_portions`, `pr_line_conflicts`, `pr_events`, `pr_photos`; functions `pr_person_name(uuid)`, `pr_project_open(uuid)`, `pr_batch_for(uuid, timestamptz)`, `pr_apply_quantity(uuid, numeric, uuid)`; existing `is_owner()`, `is_staff()`, `can_access(uuid)`, `data_owner_id()`.
- Produces (RPCs, all `returns jsonb` unless noted; used by Tasks 3–7):
  - `pr_office_queue(p_scope text default 'open')` → array of request docs (no events); `p_scope` `'open'` = has an open line, `'closed'` = none; newest first, max 300.
  - `pr_office_request(p_request uuid)` → one request doc **with** `events`.
  - Request doc = `{id, status, received_at, drafted_at, note, cancelled_at, requester_id, requester_name, project_id, project_name, work_id, work_name, team_id, team_name, lines:[{id, position, kind, description, spec, unit, category, catalog_item_id, catalog_name, catalog_spec, catalog_unit, intended_member_id, intended_member_name, urgent, urgent_reason, needed_by, notes, status, version, has_conflict, needed, portions:[{id, batch_id, quantity, pending_reduction, arranged, arranged_at, arranged_by_name, cutoff_at, purchase_on, delivery_on}], open_conflicts:[{id, proposed_quantity, current_quantity, base_version, current_version, created_at, proposed_by_name}]}], photos:[{id, line_id, path}], events:[{kind, detail, line_id, actor_name, created_at}] | null}`.
  - `pr_office_set_arranged(p_portion uuid, p_arranged boolean)` → `{portion_id, arranged}`.
  - `pr_office_resolve_reduction(p_portion uuid, p_outcome text, p_note text)` → `{portion_id, removed}`; `p_outcome` ∈ `'order_reduced'`, `'kept_as_surplus'`.
  - `pr_office_change_quantity(p_line uuid, p_quantity numeric, p_reason text)` → `{status:'applied'|'unchanged', version, needed}`.
  - `pr_office_cancel_line(p_line uuid, p_reason text)` → `{status:'cancelled', request_closed}`.
  - `pr_office_resolve_conflict(p_conflict uuid, p_apply boolean, p_note text)` → `{conflict_id, applied}`.
  - `pr_office_match_item(p_line uuid, p_item uuid)` → `{line_id, catalog_item_id}` (`p_item` null = unmatch).
  - `pr_office_move_portion(p_portion uuid, p_batch uuid, p_note text)` → `{moved, merged}`.
  - `pr_office_batches()` → `[{id, cutoff_at, purchase_on, delivery_on, updated_at, updated_by_name, open_portions}]` (makes sure this week's and the next two weeks' batches exist; returns cutoffs from 35 days ago onward, oldest first).
  - `pr_office_set_batch_dates(p_batch uuid, p_purchase_on date, p_delivery_on date)` → batch object.
  - `pr_office_people()` → `[{id, name, worker_no, role}]` (active `worker`/`teamLeader` of the caller's company).
  - `pr_office_teams()` → `[{id, name, active, members:[{worker_id, name, role, is_leader, added_at}]}]` (current members only).
  - `pr_office_save_team(p_team uuid, p_name text, p_active boolean)` → `{id}` (`p_team` null = create).
  - `pr_office_add_member(p_team uuid, p_worker uuid)`, `pr_office_remove_member(p_team uuid, p_worker uuid)` → `{team_id, worker_id}`.
  - `pr_office_set_leader(p_team uuid, p_worker uuid)` → `{team_id, leader_id}` (`p_worker` null = no leader).
  - `pr_office_catalog()` → `[{id, kind, name, spec, unit, category, active}]` (incl. inactive).
  - `pr_office_save_item(p_item uuid, p_kind text, p_name text, p_spec text, p_unit text, p_category text, p_active boolean)` → `{id}`.
  - `pr_office_projects()` → `[{folder_id, name, completed, allow_requests, hidden_from_time_in, requestable, additional_works}]`.
  - `pr_office_set_allow_requests(p_folder uuid, p_allow boolean)` → `{folder_id, allow_requests}`.
  - `pr_folder_request_count(p_folder uuid)` → `integer` (requests on the folder, as project or as work, or on any of its child folders).
  - Internal: `pr_is_office() → boolean`, `pr_request_doc(uuid, boolean) → jsonb`.

- [ ] **Step 1: Write the failing static test** — create `tests/workmate-requests-office.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// WORKMATE REQUESTS — OFFICE (0086) STATIC TESTS:
//   run with  node tests/workmate-requests-office.test.js
//
// Zero dependencies. Guards the shape of migration 0086:
//   - every function is SECURITY DEFINER with a pinned search_path;
//   - every office RPC refuses non-office callers and checks the row's owner;
//   - line changes lock the pr_lines row before touching portions;
//   - batch rows can no longer be inserted or updated directly;
//   - every function has a permission decision (granted RPC or internal).
// The LIVE behaviour is checked by supabase/tests/0086_verify.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/0086_workmate_requests_office.sql');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SQL = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
const CODE = SQL.replace(/--.*$/gm, '');
function fnBlock(name) {
  const m = CODE.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\$\\$;', 'i'));
  return m ? m[0] : '';
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const OFFICE_RPCS = [
  'pr_office_queue(text)', 'pr_office_request(uuid)', 'pr_office_set_arranged(uuid, boolean)',
  'pr_office_resolve_reduction(uuid, text, text)', 'pr_office_change_quantity(uuid, numeric, text)',
  'pr_office_cancel_line(uuid, text)', 'pr_office_resolve_conflict(uuid, boolean, text)',
  'pr_office_match_item(uuid, uuid)', 'pr_office_move_portion(uuid, uuid, text)', 'pr_office_batches()',
  'pr_office_set_batch_dates(uuid, date, date)', 'pr_office_people()', 'pr_office_teams()',
  'pr_office_save_team(uuid, text, boolean)', 'pr_office_add_member(uuid, uuid)', 'pr_office_remove_member(uuid, uuid)',
  'pr_office_set_leader(uuid, uuid)', 'pr_office_catalog()',
  'pr_office_save_item(uuid, text, text, text, text, text, boolean)', 'pr_office_projects()',
  'pr_office_set_allow_requests(uuid, boolean)', 'pr_folder_request_count(uuid)'];
const INTERNAL = ['pr_is_office()', 'pr_request_doc(uuid, boolean)'];
const LINE_WRITERS = ['pr_office_set_arranged', 'pr_office_resolve_reduction', 'pr_office_change_quantity',
  'pr_office_cancel_line', 'pr_office_resolve_conflict', 'pr_office_match_item', 'pr_office_move_portion'];

console.log('\nworkmate-requests office (0086)');

test('the migration exists', () => assert(SQL.length > 0, 'missing ' + MIGRATION));

test('every function is SECURITY DEFINER with a pinned search_path', () => {
  const fns = [...CODE.matchAll(/create or replace function[\s\S]*?\$\$;/gi)].map(m => m[0]);
  assert(fns.length === OFFICE_RPCS.length + INTERNAL.length, 'expected ' + (OFFICE_RPCS.length + INTERNAL.length) + ' functions, found ' + fns.length);
  for (const f of fns) {
    assert(/security definer/i.test(f), 'not SECURITY DEFINER: ' + f.slice(0, 70));
    assert(/set search_path = public/i.test(f), 'no search_path: ' + f.slice(0, 70));
  }
});

test('every office RPC refuses non-office callers', () => {
  for (const sig of OFFICE_RPCS) {
    const b = fnBlock(sig.split('(')[0]);
    assert(b, 'no function ' + sig);
    assert(/pr_is_office\(\)/.test(b), sig + ' does not check pr_is_office()');
  }
});

test('every office RPC is scoped to the caller\'s company', () => {
  for (const sig of OFFICE_RPCS) {
    const b = fnBlock(sig.split('(')[0]);
    assert(/can_access\(|data_owner_id\(\)/.test(b), sig + ' has no owner scope');
  }
});

test('line changes lock the line before its portions', () => {
  for (const f of LINE_WRITERS) {
    const b = fnBlock(f);
    const lock = b.search(/from pr_lines ln[\s\S]*?for update/i);
    const portionWrite = b.search(/(update|delete from|insert into) pr_line_portions/i);
    assert(lock > 0, f + ' never locks pr_lines');
    if (portionWrite > 0) assert(lock < portionWrite, f + ' writes portions before locking the line');
  }
});

test('every line change is recorded in pr_events', () => {
  for (const f of LINE_WRITERS) assert(/insert into pr_events/i.test(fnBlock(f)), f + ' writes no event');
});

test('office quantity changes and cancels need a reason', () => {
  for (const f of ['pr_office_change_quantity', 'pr_office_cancel_line']) {
    const b = fnBlock(f);
    assert(/'REASON_REQUIRED'/.test(b) && /btrim\(coalesce\(p_reason, ''\)\) = ''/.test(b), f + ' does not require a reason');
  }
});

test('quantities keep the 0085 bounds (> 0, <= 1,000,000, 3 decimals)', () => {
  const b = fnBlock('pr_office_change_quantity');
  assert(/p_quantity <= 0 or p_quantity > 1000000 or p_quantity <> round\(p_quantity, 3\)/.test(b), 'quantity bounds missing');
});

test('batch rows can no longer be inserted or updated directly', () => {
  assert(/drop policy if exists pr_batches_admin_insert on pr_batches;/i.test(CODE), 'insert policy not dropped');
  assert(/drop policy if exists pr_batches_admin_update on pr_batches;/i.test(CODE), 'update policy not dropped');
  assert(!/create policy[^;]*on pr_batches/i.test(CODE), 'must not create a new pr_batches policy');
});

test('batch dates: only purchase_on / delivery_on change, delivery not before purchase', () => {
  const b = fnBlock('pr_office_set_batch_dates');
  assert(/set purchase_on = p_purchase_on, delivery_on = p_delivery_on/.test(b), 'wrong columns updated');
  assert(!/cutoff_at\s*=/.test(b.split('set purchase_on')[1] || ''), 'must not change cutoff_at');
  assert(/p_delivery_on < p_purchase_on/.test(b) && /'BAD_DATES'/.test(b), 'date order check missing');
});

test('a leader must hold the Team Leader role and be a current member', () => {
  const b = fnBlock('pr_office_set_leader');
  assert(/'teamLeader'/.test(b) && /'NOT_A_TEAM_LEADER'/.test(b) && /'NOT_IN_TEAM'/.test(b), 'leader rules missing');
  const clear = b.search(/set is_leader = false/), set = b.search(/set is_leader = true/);
  assert(clear > 0 && set > clear, 'the old leader must be cleared before the new one is set (one-leader index)');
});

test('permissions: office RPCs to signed-in users, internals to nobody', () => {
  for (const f of OFFICE_RPCS) {
    assert(new RegExp('revoke all on function ' + esc(f) + ' from public, anon;', 'i').test(CODE), 'missing revoke for ' + f);
    assert(new RegExp('grant execute on function ' + esc(f) + ' to authenticated;', 'i').test(CODE), 'missing grant for ' + f);
  }
  for (const f of INTERNAL) {
    assert(new RegExp('revoke all on function ' + esc(f) + ' from public, anon, authenticated;', 'i').test(CODE), 'missing revoke for ' + f);
    assert(!new RegExp('grant execute on function ' + esc(f), 'i').test(CODE), f + ' must not be granted');
  }
});

test('no money anywhere in 0086', () => {
  assert(!/price|amount|cost|peso/i.test(CODE), '0086 mentions money');
});

test('no for-all or public/anon policies', () => {
  assert(!/\bfor\s+all\b/i.test(CODE), 'found a for-all policy');
  for (const s of CODE.split(';').filter(s => !/^\s*grant\s+execute\s+on\s+function\b/i.test(s))) {
    assert(!/\bto\s+(public|anon)\b/i.test(s), 'found to public/anon: ' + s.trim().slice(0, 60));
  }
});

// ── SUMMARY (keep last) ──
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails** — `node tests/workmate-requests-office.test.js` → `the migration exists` FAILS (exit 1).

- [ ] **Step 3: Write the migration** — create `supabase/migrations/0086_workmate_requests_office.sql` with exactly this content:

```sql
-- 0086 — WorkMate Requests, Stage 1a-2: the office side (Dacs Web).
--
-- ── WHAT. Admin/staff read the request queue and act on it: mark portions
--    arranged, resolve a worker's reduction of arranged quantity, resolve
--    an offline edit conflict, change or cancel a line (with a reason),
--    match an unlisted item to the catalogue, move a portion between
--    weekly batches and change a batch's purchasing/delivery dates. They
--    also manage teams, the catalogue and "Allow requests" per project.
--    Spec: docs/superpowers/specs/2026-09-29-unified-worker-app-design.md.
--
-- ── EVERY OFFICE WRITE IS AN RPC. Each one checks pr_is_office() and
--    can_access(owner) on the server, locks the pr_lines row before its
--    portions (the 0085 worker RPCs lock the same row, so a worker's edit
--    and an office action can never interleave), and writes pr_events.
--
-- ── BATCH ROWS: created only by pr_batch_for (0085). The office changes
--    only purchase_on / delivery_on through pr_office_set_batch_dates, so
--    the direct insert/update policies 0085 left on pr_batches are dropped.
--
-- ── NO MONEY. Purchasing amounts arrive with Stage 2/4.

-- ════ §1 Who is "the office" ════════════════════════════════════════════

create or replace function pr_is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_owner() or is_staff(), false)
$$;

drop policy if exists pr_batches_admin_insert on pr_batches;
drop policy if exists pr_batches_admin_update on pr_batches;

-- ════ §2 Reading requests ══════════════════════════════════════════════

-- One request as the office sees it. Names only — never contact details.
create or replace function pr_request_doc(p_request uuid, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'received_at', r.received_at, 'drafted_at', r.drafted_at,
    'note', r.note, 'cancelled_at', r.cancelled_at,
    'requester_id', r.requester_id, 'requester_name', pr_person_name(r.requester_id),
    'project_id', r.folder_id, 'project_name', f.name,
    'work_id', r.work_folder_id,
    'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
    'team_id', r.team_id, 'team_name', t.name,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'position', l.position, 'kind', l.kind, 'description', l.description,
               'spec', l.spec, 'unit', l.unit, 'category', l.category,
               'catalog_item_id', l.catalog_item_id, 'catalog_name', c.name, 'catalog_spec', c.spec, 'catalog_unit', c.unit,
               'intended_member_id', l.intended_member_id,
               'intended_member_name', case when l.intended_member_id is null then null else pr_person_name(l.intended_member_id) end,
               'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
               'status', l.status, 'version', l.version, 'has_conflict', l.has_conflict,
               'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
               'portions', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', p.id, 'batch_id', p.batch_id, 'quantity', p.quantity,
                          'pending_reduction', p.pending_reduction,
                          'arranged', p.arranged_at is not null, 'arranged_at', p.arranged_at,
                          'arranged_by_name', case when p.arranged_by is null then null else pr_person_name(p.arranged_by) end,
                          'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on)
                        order by b.cutoff_at, p.created_at), '[]'::jsonb)
                   from pr_line_portions p join pr_batches b on b.id = p.batch_id
                  where p.line_id = l.id),
               'open_conflicts', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', k.id, 'proposed_quantity', k.proposed_quantity, 'current_quantity', k.current_quantity,
                          'base_version', k.base_version, 'current_version', k.current_version,
                          'created_at', k.created_at, 'proposed_by_name', pr_person_name(k.proposed_by))
                        order by k.created_at), '[]'::jsonb)
                   from pr_line_conflicts k
                  where k.line_id = l.id and k.resolved_at is null))
             order by l.position), '[]'::jsonb)
        from pr_lines l
        left join pr_catalog_items c on c.id = l.catalog_item_id
       where l.request_id = r.id),
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'line_id', ph.line_id, 'path', ph.storage_path)
                       order by ph.created_at), '[]'::jsonb)
        from pr_photos ph where ph.request_id = r.id),
    'events', case when p_full then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'detail', e.detail, 'line_id', e.line_id,
               'actor_name', pr_person_name(e.actor_id), 'created_at', e.created_at)
             order by e.created_at, e.id), '[]'::jsonb)
        from pr_events e where e.request_id = r.id) end)
  from pr_requests r
  join folders f on f.id = r.folder_id
  join folders w on w.id = r.work_folder_id
  left join pr_teams t on t.id = r.team_id
  where r.id = p_request
$$;

create or replace function pr_office_queue(p_scope text default 'open') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(pr_request_doc(x.id, false) order by x.received_at desc), '[]'::jsonb)
    from (
      select r.id, r.received_at
        from pr_requests r
       where pr_is_office() and can_access(r.owner_id)
         and case when coalesce(p_scope, 'open') = 'closed'
                  then not exists (select 1 from pr_lines l where l.request_id = r.id and l.status = 'open')
                  else exists (select 1 from pr_lines l where l.request_id = r.id and l.status = 'open') end
       order by r.received_at desc
       limit 300) x
$$;

create or replace function pr_office_request(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_requests where id = p_request;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return pr_request_doc(p_request, true);
end;
$$;

-- ════ §3 Acting on lines and portions ══════════════════════════════════

-- Arranged = the office has arranged this quantity for purchase. A worker
-- can then only FLAG a reduction on it (0085). Undo is refused while a
-- reduction is pending: resolve it first.
create or replace function pr_office_set_arranged(p_portion uuid, p_arranged boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  l record;
  p record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if coalesce(p_arranged, false) then
    if l.status <> 'open' then
      raise exception 'LINE_CLOSED' using errcode = 'P0001';
    end if;
    if p.arranged_at is null then
      update pr_line_portions set arranged_at = now(), arranged_by = v_uid where id = p_portion;
      insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
      values (l.owner_id, l.request_id, l.id, v_uid, 'portion_arranged',
              jsonb_build_object('portion_id', p_portion, 'quantity', p.quantity));
    end if;
  else
    if p.pending_reduction > 0 then
      raise exception 'REDUCTION_PENDING' using errcode = 'P0001';
    end if;
    if p.arranged_at is not null then
      update pr_line_portions set arranged_at = null, arranged_by = null where id = p_portion;
      insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
      values (l.owner_id, l.request_id, l.id, v_uid, 'portion_unarranged',
              jsonb_build_object('portion_id', p_portion, 'quantity', p.quantity));
    end if;
  end if;
  return jsonb_build_object('portion_id', p_portion, 'arranged', coalesce(p_arranged, false));
end;
$$;

-- A worker reduced arranged quantity (pending_reduction). The office says
-- what happened to the order: reduced with the supplier, or kept (the extra
-- becomes surplus — tracked as stock from Stage 2). Either way the portion
-- now holds only what is still needed; the outcome is in pr_events.
create or replace function pr_office_resolve_reduction(p_portion uuid, p_outcome text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  v_removed boolean := false;
  l record;
  p record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('order_reduced', 'kept_as_surplus') then
    raise exception 'BAD_OUTCOME' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.pending_reduction <= 0 then
    raise exception 'NOTHING_PENDING' using errcode = 'P0001';
  end if;

  if p.quantity - p.pending_reduction <= 0 then
    delete from pr_line_portions where id = p_portion;
    v_removed := true;
  else
    update pr_line_portions set quantity = quantity - pending_reduction, pending_reduction = 0 where id = p_portion;
  end if;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'reduction_resolved',
          jsonb_build_object('portion_id', p_portion, 'quantity', p.pending_reduction, 'outcome', p_outcome,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('portion_id', p_portion, 'removed', v_removed);
end;
$$;

-- The office changes a line's quantity (spec §4B). Same portion rules as the
-- worker's change (pr_apply_quantity); the version rises so a worker's
-- offline edit made before this becomes a conflict, not an overwrite.
create or replace function pr_office_change_quantity(p_line uuid, p_quantity numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_current numeric;
  l record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 or p_quantity <> round(p_quantity, 3) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version into l from pr_lines ln where ln.id = p_line for update;
  if not found or not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  select coalesce(sum(quantity - pending_reduction), 0) into v_current from pr_line_portions where line_id = p_line;
  if p_quantity = v_current then
    return jsonb_build_object('status', 'unchanged', 'version', l.version, 'needed', v_current);
  end if;
  perform pr_apply_quantity(p_line, p_quantity, l.owner_id);
  update pr_lines set version = version + 1 where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'office_quantity_changed',
          jsonb_build_object('from', v_current, 'to', p_quantity, 'reason', btrim(p_reason)));
  return jsonb_build_object('status', 'applied', 'version', l.version + 1, 'needed', p_quantity);
end;
$$;

-- The office cancels a line (with a reason). Unarranged quantity goes;
-- arranged quantity is flagged for the office to resolve, like a worker's
-- cancel. When no open line is left, the request is marked cancelled.
create or replace function pr_office_cancel_line(p_line uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_closed boolean := false;
  l record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = p_line for update;
  if not found or not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  perform pr_apply_quantity(p_line, 0, l.owner_id);
  update pr_lines set status = 'cancelled', version = version + 1 where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'office_line_cancelled', jsonb_build_object('reason', btrim(p_reason)));

  if not exists (select 1 from pr_lines x where x.request_id = l.request_id and x.status = 'open') then
    update pr_requests set status = 'cancelled', cancelled_at = now() where id = l.request_id and status = 'submitted';
    v_closed := true;
  end if;
  return jsonb_build_object('status', 'cancelled', 'request_closed', v_closed);
end;
$$;

-- A worker's offline edit arrived against an outdated version (0085 kept
-- both values). The office either applies the worker's number or keeps the
-- current one; either way the conflict is closed with who and why.
create or replace function pr_office_resolve_conflict(p_conflict uuid, p_apply boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  v_current numeric;
  l record;
  k record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_conflicts where id = p_conflict;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into k from pr_line_conflicts where id = p_conflict for update;
  if k.resolved_at is not null then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;

  if coalesce(p_apply, false) then
    if l.status <> 'open' then
      raise exception 'LINE_CLOSED' using errcode = 'P0001';
    end if;
    if k.proposed_quantity <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'P0001';
    end if;
    select coalesce(sum(quantity - pending_reduction), 0) into v_current from pr_line_portions where line_id = v_line;
    if k.proposed_quantity <> v_current then
      perform pr_apply_quantity(v_line, k.proposed_quantity, l.owner_id);
      update pr_lines set version = version + 1 where id = v_line;
    end if;
  end if;

  update pr_line_conflicts
     set resolved_at = now(), resolved_by = v_uid,
         resolution = case when coalesce(p_apply, false) then 'applied' else 'kept' end
                      || coalesce(': ' || nullif(btrim(coalesce(p_note, '')), ''), '')
   where id = p_conflict;
  update pr_lines
     set has_conflict = exists (select 1 from pr_line_conflicts x where x.line_id = v_line and x.resolved_at is null)
   where id = v_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'conflict_resolved',
          jsonb_build_object('conflict_id', p_conflict, 'applied', coalesce(p_apply, false),
                             'proposed', k.proposed_quantity, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('conflict_id', p_conflict, 'applied', coalesce(p_apply, false));
end;
$$;

-- An unlisted item described by a worker is matched to the official
-- catalogue entry (spec §4A). Null unmatches.
create or replace function pr_office_match_item(p_line uuid, p_item uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  l record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.kind into l from pr_lines ln where ln.id = p_line for update;
  if not found or not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_item is not null and not exists (
       select 1 from pr_catalog_items c
        where c.id = p_item and c.owner_id = l.owner_id and c.active and c.kind = l.kind) then
    raise exception 'BAD_CATALOG_ITEM' using errcode = 'P0001';
  end if;
  update pr_lines set catalog_item_id = p_item where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'item_matched', jsonb_build_object('catalog_item_id', p_item));
  return jsonb_build_object('line_id', p_line, 'catalog_item_id', p_item);
end;
$$;

-- Move an UNARRANGED portion to another weekly batch (spec §4A: "move a late
-- item into an earlier batch when feasible, recording the change"). If the
-- line already has an unarranged portion in that batch, the two merge.
create or replace function pr_office_move_portion(p_portion uuid, p_batch uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  v_target uuid;
  v_merged boolean := false;
  l record;
  p record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.arranged_at is not null then
    raise exception 'ARRANGED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pr_batches b where b.id = p_batch and b.owner_id = l.owner_id) then
    raise exception 'BAD_BATCH' using errcode = 'P0001';
  end if;
  if p.batch_id = p_batch then
    return jsonb_build_object('moved', false, 'merged', false);
  end if;

  select id into v_target from pr_line_portions
   where line_id = v_line and batch_id = p_batch and arranged_at is null and id <> p_portion
   order by created_at desc, id desc limit 1 for update;
  if v_target is not null then
    update pr_line_portions set quantity = quantity + p.quantity where id = v_target;
    delete from pr_line_portions where id = p_portion;
    v_merged := true;
  else
    update pr_line_portions set batch_id = p_batch where id = p_portion;
  end if;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'portion_moved',
          jsonb_build_object('from_batch', p.batch_id, 'to_batch', p_batch, 'quantity', p.quantity,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('moved', true, 'merged', v_merged);
end;
$$;

-- ════ §4 Weekly batches ════════════════════════════════════════════════

-- This week's and the next two weeks' batches always exist, so the office
-- can move a portion into next week before anything was requested for it.
create or replace function pr_office_batches() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := data_owner_id();
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  perform pr_batch_for(v_owner, now());
  perform pr_batch_for(v_owner, now() + interval '7 days');
  perform pr_batch_for(v_owner, now() + interval '14 days');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on,
             'updated_at', b.updated_at,
             'updated_by_name', case when b.updated_by is null then null else pr_person_name(b.updated_by) end,
             'open_portions', (select count(*) from pr_line_portions p join pr_lines l on l.id = p.line_id
                                where p.batch_id = b.id and l.status = 'open'))
           order by b.cutoff_at), '[]'::jsonb)
      from pr_batches b
     where b.owner_id = v_owner and b.cutoff_at >= now() - interval '35 days');
end;
$$;

-- Holidays and supplier delays move a batch's dates (spec §4A); workers see
-- the new dates. The cutoff itself never changes.
create or replace function pr_office_set_batch_dates(p_batch uuid, p_purchase_on date, p_delivery_on date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  b record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_batches where id = p_batch;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_purchase_on is null or p_delivery_on is null or p_delivery_on < p_purchase_on then
    raise exception 'BAD_DATES' using errcode = 'P0001';
  end if;
  update pr_batches
     set purchase_on = p_purchase_on, delivery_on = p_delivery_on, updated_by = auth.uid(), updated_at = now()
   where id = p_batch
  returning * into b;
  return jsonb_build_object('id', b.id, 'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on);
end;
$$;

-- ════ §5 Teams ═════════════════════════════════════════════════════════

-- Active workers and team leaders of the caller's company. Names only.
create or replace function pr_office_people() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', pr_person_name(p.id), 'worker_no', p.worker_no, 'role', p.role)
                  order by lower(pr_person_name(p.id))), '[]'::jsonb)
    from profiles p
   where pr_is_office()
     and p.role in ('worker', 'teamLeader')
     and coalesce(p.status, 'active') = 'active'
     and coalesce(p.owner_id, p.id) = data_owner_id()
$$;

create or replace function pr_office_teams() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'active', t.active,
           'members', (select coalesce(jsonb_agg(jsonb_build_object(
                                'worker_id', m.worker_id, 'name', pr_person_name(m.worker_id), 'role', p.role,
                                'is_leader', m.is_leader, 'added_at', m.added_at)
                              order by m.is_leader desc, lower(pr_person_name(m.worker_id))), '[]'::jsonb)
                         from pr_team_members m join profiles p on p.id = m.worker_id
                        where m.team_id = t.id and m.removed_at is null))
         order by t.active desc, lower(t.name)), '[]'::jsonb)
    from pr_teams t
   where pr_is_office() and t.owner_id = data_owner_id()
$$;

create or replace function pr_office_save_team(p_team uuid, p_name text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  begin
    if p_team is null then
      insert into pr_teams (owner_id, name, active) values (data_owner_id(), btrim(p_name), coalesce(p_active, true))
      returning id into v_id;
    else
      select owner_id into v_owner from pr_teams where id = p_team;
      if v_owner is null or not can_access(v_owner) then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
      update pr_teams set name = btrim(p_name), active = coalesce(p_active, active) where id = p_team returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_TEAM' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function pr_office_add_member(p_team uuid, p_worker uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_teams where id = p_team and active;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p
                  where p.id = p_worker and p.role in ('worker', 'teamLeader')
                    and coalesce(p.status, 'active') = 'active' and coalesce(p.owner_id, p.id) = v_owner) then
    raise exception 'BAD_WORKER' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pr_team_members m where m.team_id = p_team and m.worker_id = p_worker and m.removed_at is null) then
    insert into pr_team_members (owner_id, team_id, worker_id) values (v_owner, p_team, p_worker);
  end if;
  return jsonb_build_object('team_id', p_team, 'worker_id', p_worker);
end;
$$;

-- Removing keeps the history row (removed_at). A removed leader is no longer leader.
create or replace function pr_office_remove_member(p_team uuid, p_worker uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_teams where id = p_team;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  update pr_team_members set removed_at = now(), is_leader = false
   where team_id = p_team and worker_id = p_worker and removed_at is null;
  return jsonb_build_object('team_id', p_team, 'worker_id', p_worker);
end;
$$;

-- Spec §3: acting for a team needs the Team Leader role AND this explicit
-- assignment. One leader per team (0085 index): clear first, then set.
create or replace function pr_office_set_leader(p_team uuid, p_worker uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_teams where id = p_team and active;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  if p_worker is not null then
    if not exists (select 1 from pr_team_members m where m.team_id = p_team and m.worker_id = p_worker and m.removed_at is null) then
      raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
    end if;
    if not exists (select 1 from profiles p
                    where p.id = p_worker and p.role = 'teamLeader' and coalesce(p.status, 'active') = 'active') then
      raise exception 'NOT_A_TEAM_LEADER' using errcode = 'P0001';
    end if;
  end if;
  update pr_team_members set is_leader = false where team_id = p_team and is_leader and removed_at is null;
  if p_worker is not null then
    update pr_team_members set is_leader = true where team_id = p_team and worker_id = p_worker and removed_at is null;
  end if;
  return jsonb_build_object('team_id', p_team, 'leader_id', p_worker);
end;
$$;

-- ════ §6 The catalogue ═════════════════════════════════════════════════

create or replace function pr_office_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
           'category', c.category, 'active', c.active)
         order by c.active desc, c.kind, lower(c.name), lower(c.spec)), '[]'::jsonb)
    from pr_catalog_items c
   where pr_is_office() and c.owner_id = data_owner_id()
$$;

-- One row = one defined item (name + spec + unit). The same identity twice
-- is refused (0085 index) so alternate wording never splits stock.
create or replace function pr_office_save_item(p_item uuid, p_kind text, p_name text, p_spec text, p_unit text,
                                               p_category text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('material', 'tool')
     or btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_unit, '')) = '' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  begin
    if p_item is null then
      insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, active)
      values (data_owner_id(), p_kind, btrim(p_name), btrim(coalesce(p_spec, '')), btrim(p_unit),
              btrim(coalesce(p_category, '')), coalesce(p_active, true))
      returning id into v_id;
    else
      select owner_id into v_owner from pr_catalog_items where id = p_item;
      if v_owner is null or not can_access(v_owner) then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
      update pr_catalog_items
         set kind = p_kind, name = btrim(p_name), spec = btrim(coalesce(p_spec, '')), unit = btrim(p_unit),
             category = btrim(coalesce(p_category, '')), active = coalesce(p_active, active), updated_at = now()
       where id = p_item
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_ITEM' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id);
end;
$$;

-- ════ §7 Which projects accept requests ════════════════════════════════

create or replace function pr_office_projects() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'folder_id', f.id, 'name', f.name, 'completed', f.completed_at is not null,
           'allow_requests', coalesce(s.allow_requests, false),
           'hidden_from_time_in', exists (select 1 from attendance_project_config h
                                           where h.project_system = 'pc' and h.folder_id = f.id
                                             and h.owner_id = f.owner_id and not h.attendance_enabled),
           'requestable', pr_project_open(f.id),
           'additional_works', (select count(*) from folders c where c.parent_folder_id = f.id and c.completed_at is null))
         order by (f.completed_at is not null), lower(f.name)), '[]'::jsonb)
    from folders f
    left join pr_project_settings s on s.folder_id = f.id
   where pr_is_office() and f.owner_id = data_owner_id()
     and f.parent_folder_id is null and coalesce(btrim(f.name), '') <> ''
$$;

create or replace function pr_office_set_allow_requests(p_folder uuid, p_allow boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from folders where id = p_folder and parent_folder_id is null;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into pr_project_settings (folder_id, owner_id, allow_requests, updated_by, updated_at)
  values (p_folder, v_owner, coalesce(p_allow, false), auth.uid(), now())
  on conflict (folder_id) do update
    set allow_requests = excluded.allow_requests, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('folder_id', p_folder, 'allow_requests', coalesce(p_allow, false));
end;
$$;

-- Dacs Web asks this BEFORE deleting a project or an Additional Works job:
-- pr_requests keeps history (no-action foreign keys), so a project with
-- requests must be completed, not deleted — and the delete path removes
-- expenses and payroll first, so it must refuse before touching anything.
create or replace function pr_folder_request_count(p_folder uuid) returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from folders where id = p_folder;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return (
    select count(*)::int from pr_requests r
     where r.folder_id = p_folder or r.work_folder_id = p_folder
        or r.folder_id in (select c.id from folders c where c.parent_folder_id = p_folder)
        or r.work_folder_id in (select c.id from folders c where c.parent_folder_id = p_folder));
end;
$$;

-- ════ §8 Who may call what ═════════════════════════════════════════════

revoke all on function pr_is_office() from public, anon, authenticated;
revoke all on function pr_request_doc(uuid, boolean) from public, anon, authenticated;

revoke all on function pr_office_queue(text) from public, anon;
grant execute on function pr_office_queue(text) to authenticated;
revoke all on function pr_office_request(uuid) from public, anon;
grant execute on function pr_office_request(uuid) to authenticated;
revoke all on function pr_office_set_arranged(uuid, boolean) from public, anon;
grant execute on function pr_office_set_arranged(uuid, boolean) to authenticated;
revoke all on function pr_office_resolve_reduction(uuid, text, text) from public, anon;
grant execute on function pr_office_resolve_reduction(uuid, text, text) to authenticated;
revoke all on function pr_office_change_quantity(uuid, numeric, text) from public, anon;
grant execute on function pr_office_change_quantity(uuid, numeric, text) to authenticated;
revoke all on function pr_office_cancel_line(uuid, text) from public, anon;
grant execute on function pr_office_cancel_line(uuid, text) to authenticated;
revoke all on function pr_office_resolve_conflict(uuid, boolean, text) from public, anon;
grant execute on function pr_office_resolve_conflict(uuid, boolean, text) to authenticated;
revoke all on function pr_office_match_item(uuid, uuid) from public, anon;
grant execute on function pr_office_match_item(uuid, uuid) to authenticated;
revoke all on function pr_office_move_portion(uuid, uuid, text) from public, anon;
grant execute on function pr_office_move_portion(uuid, uuid, text) to authenticated;
revoke all on function pr_office_batches() from public, anon;
grant execute on function pr_office_batches() to authenticated;
revoke all on function pr_office_set_batch_dates(uuid, date, date) from public, anon;
grant execute on function pr_office_set_batch_dates(uuid, date, date) to authenticated;
revoke all on function pr_office_people() from public, anon;
grant execute on function pr_office_people() to authenticated;
revoke all on function pr_office_teams() from public, anon;
grant execute on function pr_office_teams() to authenticated;
revoke all on function pr_office_save_team(uuid, text, boolean) from public, anon;
grant execute on function pr_office_save_team(uuid, text, boolean) to authenticated;
revoke all on function pr_office_add_member(uuid, uuid) from public, anon;
grant execute on function pr_office_add_member(uuid, uuid) to authenticated;
revoke all on function pr_office_remove_member(uuid, uuid) from public, anon;
grant execute on function pr_office_remove_member(uuid, uuid) to authenticated;
revoke all on function pr_office_set_leader(uuid, uuid) from public, anon;
grant execute on function pr_office_set_leader(uuid, uuid) to authenticated;
revoke all on function pr_office_catalog() from public, anon;
grant execute on function pr_office_catalog() to authenticated;
revoke all on function pr_office_save_item(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function pr_office_save_item(uuid, text, text, text, text, text, boolean) to authenticated;
revoke all on function pr_office_projects() from public, anon;
grant execute on function pr_office_projects() to authenticated;
revoke all on function pr_office_set_allow_requests(uuid, boolean) from public, anon;
grant execute on function pr_office_set_allow_requests(uuid, boolean) to authenticated;
revoke all on function pr_folder_request_count(uuid) from public, anon;
grant execute on function pr_folder_request_count(uuid) to authenticated;
```

- [ ] **Step 4: Add the suite to `npm test`** — append ` && node tests/workmate-requests-office.test.js` to the end of the `"test"` script string in `package.json`. Check `git diff --stat package.json` → `1 insertion(+), 1 deletion(-)`.

- [ ] **Step 5: Run to verify it passes** — `node tests/workmate-requests-office.test.js` → `14 passed, 0 failed`; `npm test` → exit 0 (`tests/storage-access.test.js` also scans 0086).

- [ ] **Step 6: Stop — no commit.**

---
### Task 2: Live behaviour checks for 0086 + schema docs

**Files:**
- Create: `supabase/tests/0086_verify.sql`
- Modify: `docs/DATABASE_SCHEMA.md` (§13 WorkMate Requests — add an "Office RPCs (0086)" sub-section)
- Modify: `supabase/migrations/README.md` (canonical order: add `0086_workmate_requests_office.sql`; "next number" → **0087**)

**Interfaces:**
- Consumes: everything Task 1 produces; 0085 worker RPCs `pr_submit_request(uuid, jsonb)`, `pr_change_quantity(uuid, uuid, int, numeric)`.
- Produces: a script the **user** runs (Task 8). It must not be run by any subagent.

This script follows `supabase/tests/0085_verify.sql` exactly in style: it wraps itself in `begin; … rollback;`, stores ids in a temp table `t_ctx`, switches user with `set local role authenticated` + `set_config('request.jwt.claims', …, true)`, and checks expected errors with `begin … assert false, '…'; exception when others then assert sqlerrm = 'CODE', '…: ' || sqlerrm; end;` (`when others` does not catch `assert_failure`, so a missing error fails the check). Accounts used (live, verified 2026-10-02): **W-0007** (worker), **W-0019** (worker), **W-0021** (teamLeader), the company **owner** (= W-0007's `owner_id`), the company's one **staff** account, and — when present — an **outsider**: any `owner`-role account whose `data_owner_id()` is not that owner (there is one today, an owner-role sub-account).

- [ ] **Step 1: Write the script** — create `supabase/tests/0086_verify.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0086 WorkMate Requests (office) — live behaviour checks.
--
-- This file wraps itself in begin / rollback, so nothing persists. For a dry
-- run with the migration, run  begin;  <0086 migration>  <this file>  (its own
-- begin only warns; its rollback undoes everything, migration included).
--
-- Uses existing active accounts: W-0007, W-0019 (workers), W-0021
-- (teamLeader), their owner, that owner's staff account, and — if one
-- exists — an owner-role account of another company (the outsider).
-- Builds its own throwaway project, Additional Works, team and items.
-- A failed check aborts with its message; success ends with the row
-- 'pr office verify: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- ── 0. Accounts and a throwaway project (as the database owner) ──
do $$
declare
  v_worker uuid; v_other uuid; v_leader uuid; v_owner uuid; v_staff uuid; v_out uuid;
  v_p uuid; v_aw uuid; v_empty uuid; v_item uuid; v_tool uuid;
begin
  select id into v_worker from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_other  from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_leader from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_worker is not null and v_other is not null and v_leader is not null,
    'accounts W-0007 and W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_worker);
  assert (select role from profiles where id = v_owner) = 'owner', 'W-0007''s owner must be an owner account';
  select id into v_staff from profiles
   where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  assert v_staff is not null, 'the owner must have an active staff account';
  select id into v_out from profiles where role = 'owner' and id <> v_owner limit 1;

  insert into folders (owner_id, name) values (v_owner, 'ZZ 0086 verify project') returning id into v_p;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 0086 verify AW', v_p) returning id into v_aw;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 0086 verify empty') returning id into v_empty;
  insert into pr_project_settings (folder_id, owner_id, allow_requests) values (v_p, v_owner, true);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 0086 elbow', '1/2 in', 'pc', 'plumbing') returning id into v_item;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'tool', 'ZZ 0086 pipe wrench', '14 in', 'pc', 'plumbing') returning id into v_tool;

  insert into t_ctx values ('worker', v_worker), ('other', v_other), ('leader', v_leader), ('owner', v_owner),
    ('staff', v_staff), ('out', coalesce(v_out::text, '')), ('p', v_p), ('aw', v_aw), ('empty', v_empty),
    ('item', v_item), ('tool', v_tool);
end $$;

-- ── 1. As the worker W-0007: two requests, and the office RPCs refuse ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);

do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_aw uuid := (select v::uuid from t_ctx where k = 'aw');
  r jsonb;
begin
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_p, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ unlisted elbow', 'spec', 'half inch', 'unit', 'pc', 'quantity', 10),
         jsonb_build_object('kind', 'material', 'description', 'ZZ sand', 'unit', 'bag', 'quantity', 5))));
  insert into t_ctx values ('req', r ->> 'request_id'), ('lineA', r -> 'line_ids' ->> 0), ('lineB', r -> 'line_ids' ->> 1);
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_aw, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ AW nails', 'unit', 'kg', 'quantity', 2))));
  insert into t_ctx values ('reqAW', r ->> 'request_id');

  assert pr_office_queue('open') = '[]'::jsonb, 'a worker reads an empty office queue';
  begin perform pr_office_request((select v::uuid from t_ctx where k = 'req')); assert false, 'worker read a request';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker request: ' || sqlerrm; end;
  begin perform pr_office_set_arranged(gen_random_uuid(), true); assert false, 'worker arranged';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker arrange: ' || sqlerrm; end;
  begin perform pr_office_save_team(null, 'ZZ worker team', true); assert false, 'worker made a team';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker team: ' || sqlerrm; end;
  begin perform pr_folder_request_count(v_p); assert false, 'worker counted requests';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker count: ' || sqlerrm; end;
  begin perform pr_office_batches(); assert false, 'worker read batches';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker batches: ' || sqlerrm; end;
end $$;

-- ── 2. As the owner: read, match, arrange ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);

do $$
declare
  v_req uuid := (select v::uuid from t_ctx where k = 'req');
  v_a uuid := (select v::uuid from t_ctx where k = 'lineA');
  v_item uuid := (select v::uuid from t_ctx where k = 'item');
  v_tool uuid := (select v::uuid from t_ctx where k = 'tool');
  d jsonb; q jsonb; v_portion uuid;
begin
  q := pr_office_queue('open');
  assert exists (select 1 from jsonb_array_elements(q) e where e ->> 'id' = v_req::text), 'the request is in the open queue';
  assert (select e -> 'events' from jsonb_array_elements(q) e where e ->> 'id' = v_req::text) = 'null'::jsonb, 'the queue carries no history';

  d := pr_office_request(v_req);
  assert jsonb_array_length(d -> 'lines') = 2, 'two lines';
  assert d ->> 'requester_name' is not null and d ->> 'work_name' = 'Main Contract', 'names resolved';
  assert (d -> 'lines' -> 0 ->> 'needed')::numeric = 10, 'line A needs 10';
  assert exists (select 1 from jsonb_array_elements(d -> 'events') e where e ->> 'kind' = 'submitted'), 'history starts with submitted';

  begin perform pr_office_match_item(v_a, v_tool); assert false, 'matched a material to a tool';
  exception when others then assert sqlerrm = 'BAD_CATALOG_ITEM', 'wrong kind: ' || sqlerrm; end;
  perform pr_office_match_item(v_a, v_item);
  assert (select catalog_item_id from pr_lines where id = v_a) = v_item, 'line A matched';
  assert (select version from pr_lines where id = v_a) = 1, 'matching does not change the version';

  select id into v_portion from pr_line_portions where line_id = v_a;
  insert into t_ctx values ('portionA', v_portion);
  perform pr_office_set_arranged(v_portion, true);
  perform pr_office_set_arranged(v_portion, true);
  assert (select arranged_at is not null and arranged_by = auth.uid() from pr_line_portions where id = v_portion), 'portion arranged by the owner';
  assert (select count(*) from pr_events where line_id = v_a and kind = 'portion_arranged') = 1, 'arranging twice records once';
  perform pr_office_set_arranged(v_portion, false);
  assert (select arranged_at is null from pr_line_portions where id = v_portion), 'undo works with nothing pending';
  perform pr_office_set_arranged(v_portion, true);
end $$;

-- ── 3. As the worker: reduce arranged quantity → pending reduction ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  r := pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineA'), 1, 4);
  assert r ->> 'status' = 'applied', 'worker reduction applied';
  assert (select pending_reduction from pr_line_portions where id = (select v::uuid from t_ctx where k = 'portionA')) = 6,
    'arranged 10 → 4 flags 6 for the office';
end $$;

-- ── 4. As the owner: resolve the reduction; office quantity change; conflict ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$
declare
  v_portion uuid := (select v::uuid from t_ctx where k = 'portionA');
  v_b uuid := (select v::uuid from t_ctx where k = 'lineB');
  r jsonb;
begin
  begin perform pr_office_set_arranged(v_portion, false); assert false, 'undid an arrangement with a reduction pending';
  exception when others then assert sqlerrm = 'REDUCTION_PENDING', 'undo pending: ' || sqlerrm; end;
  begin perform pr_office_resolve_reduction(v_portion, 'lost', null); assert false, 'accepted a bad outcome';
  exception when others then assert sqlerrm = 'BAD_OUTCOME', 'outcome: ' || sqlerrm; end;
  r := pr_office_resolve_reduction(v_portion, 'kept_as_surplus', 'supplier will not take it back');
  assert not (r ->> 'removed')::boolean, 'portion kept';
  assert (select quantity = 4 and pending_reduction = 0 from pr_line_portions where id = v_portion), 'portion now 4, nothing pending';
  assert exists (select 1 from pr_events where line_id = (select v::uuid from t_ctx where k = 'lineA')
                  and kind = 'reduction_resolved' and detail ->> 'outcome' = 'kept_as_surplus'), 'outcome recorded';
  begin perform pr_office_resolve_reduction(v_portion, 'order_reduced', null); assert false, 'resolved twice';
  exception when others then assert sqlerrm = 'NOTHING_PENDING', 'twice: ' || sqlerrm; end;

  begin perform pr_office_change_quantity(v_b, 8, '  '); assert false, 'changed without a reason';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'no reason: ' || sqlerrm; end;
  begin perform pr_office_change_quantity(v_b, 0, 'zero'); assert false, 'changed to zero';
  exception when others then assert sqlerrm = 'BAD_QUANTITY', 'zero: ' || sqlerrm; end;
  r := pr_office_change_quantity(v_b, 8, 'site engineer recount');
  assert r ->> 'status' = 'applied' and (r ->> 'version')::int = 2 and (r ->> 'needed')::numeric = 8, 'office change applied, version 2';
  r := pr_office_change_quantity(v_b, 8, 'same again');
  assert r ->> 'status' = 'unchanged', 'same quantity changes nothing';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  r := pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineB'), 1, 3);
  assert r ->> 'status' = 'conflict', 'an edit against version 1 becomes a conflict';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$
declare
  v_b uuid := (select v::uuid from t_ctx where k = 'lineB');
  d jsonb; l jsonb; v_conflict uuid;
begin
  d := pr_office_request((select v::uuid from t_ctx where k = 'req'));
  select e into l from jsonb_array_elements(d -> 'lines') e where e ->> 'id' = v_b::text;
  assert (l ->> 'has_conflict')::boolean and jsonb_array_length(l -> 'open_conflicts') = 1, 'conflict shown to the office';
  v_conflict := (l -> 'open_conflicts' -> 0 ->> 'id')::uuid;
  assert (l -> 'open_conflicts' -> 0 ->> 'proposed_quantity')::numeric = 3
     and (l -> 'open_conflicts' -> 0 ->> 'current_quantity')::numeric = 8, 'both values kept';
  perform pr_office_resolve_conflict(v_conflict, true, 'worker is on site');
  assert (select version = 3 and not has_conflict from pr_lines where id = v_b), 'applied: version 3, conflict cleared';
  assert (select sum(quantity - pending_reduction) from pr_line_portions where line_id = v_b) = 3, 'line B now needs 3';
  assert (select resolution from pr_line_conflicts where id = v_conflict) = 'applied: worker is on site', 'resolution recorded';
  begin perform pr_office_resolve_conflict(v_conflict, false, null); assert false, 'resolved twice';
  exception when others then assert sqlerrm = 'ALREADY_RESOLVED', 'twice: ' || sqlerrm; end;
end $$;

-- ── 5. Batches: list, move a portion, change dates; no direct writes ──
do $$
declare
  bs jsonb; v_next uuid; v_portion_b uuid; n int; r jsonb;
begin
  bs := pr_office_batches();
  assert (select count(*) from jsonb_array_elements(bs) e where (e ->> 'cutoff_at')::timestamptz > now()) >= 3,
    'this week and the next two weeks exist';
  select (e ->> 'id')::uuid into v_next from jsonb_array_elements(bs) e
   where (e ->> 'cutoff_at')::timestamptz > now() + interval '7 days' order by e ->> 'cutoff_at' limit 1;
  insert into t_ctx values ('next', v_next);

  select id into v_portion_b from pr_line_portions where line_id = (select v::uuid from t_ctx where k = 'lineB');
  r := pr_office_move_portion(v_portion_b, v_next, 'supplier out of stock');
  assert (r ->> 'moved')::boolean and (select batch_id from pr_line_portions where id = v_portion_b) = v_next, 'portion moved';
  begin perform pr_office_move_portion((select v::uuid from t_ctx where k = 'portionA'), v_next, null); assert false, 'moved an arranged portion';
  exception when others then assert sqlerrm = 'ARRANGED', 'arranged move: ' || sqlerrm; end;
  begin perform pr_office_move_portion(v_portion_b, gen_random_uuid(), null); assert false, 'moved to a missing batch';
  exception when others then assert sqlerrm = 'BAD_BATCH', 'missing batch: ' || sqlerrm; end;

  begin perform pr_office_set_batch_dates(v_next, current_date + 10, current_date + 9); assert false, 'delivery before purchase';
  exception when others then assert sqlerrm = 'BAD_DATES', 'dates: ' || sqlerrm; end;
  r := pr_office_set_batch_dates(v_next, current_date + 10, current_date + 12);
  assert (select purchase_on = current_date + 10 and delivery_on = current_date + 12 and updated_by = auth.uid()
            from pr_batches where id = v_next), 'dates changed with who';

  update pr_batches set delivery_on = delivery_on + 1 where id = v_next;
  get diagnostics n = row_count;
  assert n = 0, 'a direct update of pr_batches changes nothing';
  begin
    insert into pr_batches (owner_id, cutoff_at, purchase_on, delivery_on) values (auth.uid(), '2031-01-04 12:00+08', '2031-01-06', '2031-01-08');
    assert false, 'a direct insert into pr_batches was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 6. Cancel lines; a request with an order still to undo stays open ──
do $$
declare
  v_a uuid := (select v::uuid from t_ctx where k = 'lineA');
  v_b uuid := (select v::uuid from t_ctx where k = 'lineB');
  v_portion uuid := (select v::uuid from t_ctx where k = 'portionA');
  v_req uuid := (select v::uuid from t_ctx where k = 'req');
  r jsonb;
begin
  begin perform pr_office_cancel_line(v_a, ''); assert false, 'cancelled without a reason';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'no reason: ' || sqlerrm; end;
  r := pr_office_cancel_line(v_a, 'wrong size requested');
  assert not (r ->> 'request_closed')::boolean, 'line B still open';
  assert (select status from pr_lines where id = v_a) = 'cancelled', 'line A cancelled';
  assert (select pending_reduction = quantity from pr_line_portions where id = v_portion), 'arranged quantity flagged, not erased';
  begin perform pr_office_cancel_line(v_a, 'again'); assert false, 'cancelled twice';
  exception when others then assert sqlerrm = 'LINE_CLOSED', 'twice: ' || sqlerrm; end;

  r := pr_office_cancel_line(v_b, 'not needed any more');
  assert (r ->> 'request_closed')::boolean, 'last open line closes the request';
  assert (select status = 'cancelled' and cancelled_at is not null from pr_requests where id = v_req), 'request cancelled';
  assert exists (select 1 from jsonb_array_elements(pr_office_queue('open')) e where e ->> 'id' = v_req::text),
    'a cancelled request with an order still to undo stays in the open queue';

  r := pr_office_resolve_reduction(v_portion, 'order_reduced', null);
  assert (r ->> 'removed')::boolean and not exists (select 1 from pr_line_portions where id = v_portion), 'fully reduced portion removed';
  assert not exists (select 1 from jsonb_array_elements(pr_office_queue('open')) e where e ->> 'id' = v_req::text), 'gone from the open queue';
  assert exists (select 1 from jsonb_array_elements(pr_office_queue('closed')) e where e ->> 'id' = v_req::text), 'in the closed list';
end $$;

-- ── 7. Projects and the delete guard ──
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_aw uuid := (select v::uuid from t_ctx where k = 'aw');
  v_empty uuid := (select v::uuid from t_ctx where k = 'empty');
  ps jsonb;
begin
  ps := pr_office_projects();
  assert exists (select 1 from jsonb_array_elements(ps) e where e ->> 'folder_id' = v_p::text
                  and (e ->> 'allow_requests')::boolean and (e ->> 'additional_works')::int = 1), 'project listed with its AW';
  assert not exists (select 1 from jsonb_array_elements(ps) e where e ->> 'folder_id' = v_aw::text), 'AW is not a top-level project';
  perform pr_office_set_allow_requests(v_empty, true);
  assert (select allow_requests from pr_project_settings where folder_id = v_empty), 'allow requests switched on';
  perform pr_office_set_allow_requests(v_empty, false);
  assert not (select allow_requests from pr_project_settings where folder_id = v_empty), 'and off again';
  begin perform pr_office_set_allow_requests(v_aw, true); assert false, 'set allow on an AW';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'AW allow: ' || sqlerrm; end;

  assert pr_folder_request_count(v_p) = 2, 'project counts its own and its AW''s requests';
  assert pr_folder_request_count(v_aw) = 1, 'AW counts its request';
  assert pr_folder_request_count(v_empty) = 0, 'an empty project counts none';
end $$;

-- ── 8. As staff: teams and the catalogue ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_other uuid := (select v::uuid from t_ctx where k = 'other');
  v_leader uuid := (select v::uuid from t_ctx where k = 'leader');
  v_owner uuid := (select v::uuid from t_ctx where k = 'owner');
  v_team uuid; v_item uuid; t jsonb;
begin
  assert exists (select 1 from jsonb_array_elements(pr_office_queue('closed')) e where e ->> 'id' = (select v from t_ctx where k = 'req')),
    'staff see the owner''s requests';
  assert exists (select 1 from jsonb_array_elements(pr_office_people()) e where e ->> 'id' = v_leader::text), 'people list has W-0021';

  v_team := (pr_office_save_team(null, 'ZZ 0086 team', true) ->> 'id')::uuid;
  assert (select owner_id from pr_teams where id = v_team) = v_owner, 'staff create teams for their owner';
  begin perform pr_office_save_team(null, ' zz 0086 TEAM ', true); assert false, 'duplicate team';
  exception when others then assert sqlerrm = 'DUPLICATE_TEAM', 'dup team: ' || sqlerrm; end;

  perform pr_office_add_member(v_team, v_other);
  perform pr_office_add_member(v_team, v_other);
  assert (select count(*) from pr_team_members where team_id = v_team and worker_id = v_other and removed_at is null) = 1, 'adding twice keeps one row';
  begin perform pr_office_set_leader(v_team, v_other); assert false, 'a worker became leader';
  exception when others then assert sqlerrm = 'NOT_A_TEAM_LEADER', 'worker leader: ' || sqlerrm; end;
  begin perform pr_office_set_leader(v_team, v_leader); assert false, 'a non-member became leader';
  exception when others then assert sqlerrm = 'NOT_IN_TEAM', 'outside leader: ' || sqlerrm; end;
  perform pr_office_add_member(v_team, v_leader);
  perform pr_office_set_leader(v_team, v_leader);
  select e into t from jsonb_array_elements(pr_office_teams()) e where e ->> 'id' = v_team::text;
  assert jsonb_array_length(t -> 'members') = 2 and (t -> 'members' -> 0 ->> 'is_leader')::boolean
     and t -> 'members' -> 0 ->> 'worker_id' = v_leader::text, 'leader listed first';
  perform pr_office_remove_member(v_team, v_leader);
  assert not exists (select 1 from pr_team_members where team_id = v_team and is_leader and removed_at is null), 'removed leader is no longer leader';
  assert exists (select 1 from pr_team_members where team_id = v_team and worker_id = v_leader and removed_at is not null), 'history row kept';

  v_item := (pr_office_save_item(null, 'material', 'ZZ 0086 cement', '40 kg', 'bag', 'masonry', true) ->> 'id')::uuid;
  begin perform pr_office_save_item(null, 'material', 'zz 0086 CEMENT', '40 KG', 'Bag', '', true); assert false, 'duplicate item';
  exception when others then assert sqlerrm = 'DUPLICATE_ITEM', 'dup item: ' || sqlerrm; end;
  begin perform pr_office_save_item(null, 'food', 'ZZ', '', 'pc', '', true); assert false, 'bad kind';
  exception when others then assert sqlerrm = 'BAD_ITEM', 'bad kind: ' || sqlerrm; end;
  perform pr_office_save_item(v_item, 'material', 'ZZ 0086 cement', '40 kg', 'bag', 'masonry', false);
  assert exists (select 1 from jsonb_array_elements(pr_office_catalog()) e
                  where e ->> 'id' = v_item::text and not (e ->> 'active')::boolean), 'inactive items stay listed for the office';
end $$;

-- ── 9. The outsider (another company's owner) sees and changes nothing ──
select set_config('request.jwt.claims', json_build_object('sub', coalesce(nullif((select v from t_ctx where k = 'out'), ''),
       (select v from t_ctx where k = 'worker')), 'role', 'authenticated')::text, true);
do $$
begin
  if (select v from t_ctx where k = 'out') = '' then
    raise notice 'no outsider account: tenant checks skipped';
    return;
  end if;
  assert not exists (select 1 from jsonb_array_elements(pr_office_queue('closed')) e where e ->> 'id' = (select v from t_ctx where k = 'req')),
    'the outsider''s queue does not list the request';
  begin perform pr_office_request((select v::uuid from t_ctx where k = 'req')); assert false, 'outsider read the request';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'outsider read: ' || sqlerrm; end;
  begin perform pr_office_set_batch_dates((select v::uuid from t_ctx where k = 'next'), current_date, current_date); assert false, 'outsider moved dates';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'outsider dates: ' || sqlerrm; end;
  begin perform pr_folder_request_count((select v::uuid from t_ctx where k = 'p')); assert false, 'outsider counted';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'outsider count: ' || sqlerrm; end;
end $$;

-- ── 10. Grants (as the database owner) ──
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'pr_office_queue(text)', 'execute'), 'anon cannot read the queue';
  assert has_function_privilege('authenticated', 'pr_office_queue(text)', 'execute'), 'signed-in users may call the queue';
  assert not has_function_privilege('authenticated', 'pr_request_doc(uuid, boolean)', 'execute'), 'pr_request_doc is internal';
  assert not has_function_privilege('authenticated', 'pr_is_office()', 'execute'), 'pr_is_office is internal';
  assert not exists (select 1 from pg_policies where tablename = 'pr_batches' and cmd in ('INSERT', 'UPDATE')), 'no batch write policies';
end $$;

select 'pr office verify: all checks passed' as result;

rollback;
```

- [ ] **Step 2: Docs** — in `docs/DATABASE_SCHEMA.md` §13 (WorkMate Requests), append:

```markdown
### Office RPCs (0086)

Every office write is a `SECURITY DEFINER` RPC that refuses non-office callers (`OFFICE_ONLY`) and other companies' rows (`NOT_FOUND`), locks the `pr_lines` row before its portions, and records a `pr_events` row. Read RPCs return names only — no contact details, no money.

| RPC | What it does |
|---|---|
| `pr_office_queue(scope)` / `pr_office_request(id)` | Requests with lines, portions (with batch dates), open conflicts, photos; the single read adds the history |
| `pr_office_set_arranged(portion, bool)` | Mark arranged / undo (undo refused while a reduction is pending) |
| `pr_office_resolve_reduction(portion, outcome, note)` | `order_reduced` or `kept_as_surplus`; the portion keeps only what is still needed |
| `pr_office_change_quantity(line, qty, reason)` / `pr_office_cancel_line(line, reason)` | Reason required; version rises so an older offline edit becomes a conflict |
| `pr_office_resolve_conflict(conflict, apply, note)` | Apply the worker's number or keep the current one |
| `pr_office_match_item(line, item)` | Match a line to an active catalogue item of the same kind (null unmatches) |
| `pr_office_move_portion(portion, batch, note)` | Move an **unarranged** portion to another weekly batch (merges with that batch's unarranged portion) |
| `pr_office_batches()` / `pr_office_set_batch_dates(batch, purchase, delivery)` | Batches from 35 days ago on (this week + next two always exist); only purchase/delivery dates change. **0086 dropped the direct insert/update policies on `pr_batches`** |
| `pr_office_people/teams/save_team/add_member/remove_member/set_leader` | Teams; a leader must hold the teamLeader role and be a current member |
| `pr_office_catalog/save_item` | Catalogue; the same name + spec + unit is refused (`DUPLICATE_ITEM`) |
| `pr_office_projects/set_allow_requests` | Top-level Project Control projects and the *Allow requests* switch |
| `pr_folder_request_count(folder)` | Requests on a folder or its children — Dacs Web refuses to delete a project / Additional Works that has any |
```

- [ ] **Step 3: Migrations README** — in `supabase/migrations/README.md` add `0086_workmate_requests_office.sql` after `0085_workmate_requests.sql` in the canonical order list (same format as the 0085 row), and change the "next number" line from 0086 to **0087**.

- [ ] **Step 4: Check** — `npm test` → exit 0 (nothing here is executed by Node; this guards the earlier suites). Do **not** run the SQL.

- [ ] **Step 5: Stop — no commit.**

---
### Task 3: Requests core module — pure helpers, error copy, RPC and modal helpers

**Files:**
- Create: `js/requests-admin-core.js`
- Create: `tests/requests-admin.test.js`
- Modify: `package.json` (append ` && node tests/requests-admin.test.js` to the `"test"` script; keep CRLF; only that line changes)

**Interfaces:**
- Consumes: the RPC names and the request-doc shape from Task 1 (see Task 1 **Produces**).
- Produces (browser global `window.RequestsAdmin`, used by Tasks 4–6; the pure half is also `module.exports` under Node):
  - Pure: `formatQty(n) → string`, `manilaParts(iso) → {y,m,d,dow,h,min}|null`, `formatManila(iso) → 'Sat 3 Oct 2026, 11:58 AM'`, `formatDay('YYYY-MM-DD') → 'Mon 5 Oct'`, `shortDay(iso) → 'Sat 10 Oct'` (Manila), `cutoffLabel(iso) → 'Sat 10 Oct, 12:00 noon'`, `batchLabel(batch) → 'Cutoff … · Buy … · Deliver …'`, `lineState(line) → 'conflict'|'reduction'|'cancelled'|'unarranged'|'partly'|'arranged'`, `STATE_LABEL`, `STATE_PILL`, `needsAction(line) → boolean`, `requestSummary(req) → {urgent, neededBy, openLines, totalLines, actionLines, conflicts, reductions, firstCutoff, batchIds}`, `sortQueue(reqs) → reqs` (new array), `filterQueue(reqs, {text, batchId, actionOnly}) → reqs`, `eventText(ev) → string`, `ERRORS`, `errorMessage(error) → string`, `parseQty(str) → number|null`, `validateDates(purchase, delivery) → string|null`, `itemLabel(item) → string`, `catalogMatches(items, kind, text) → items`.
  - Browser only: `esc(s)`, `icons()`, `rpc(name, args) → Promise<data>` (throws the Supabase error), `fail(host, error)`, `modal({title, sub, body, submitLabel, warn, onOpen(form), onSubmit: async (form) => void, onDone()}) → {close}`, `openRequest(id)`, `state` (`{detailId}`), `views` (`{viewId: async (host) => void}`, filled by Tasks 4–6).
  - Browser global `window.initRequestsModule(view)` — looks up `RequestsAdmin.views[view]` and renders into `#<view>View`.

- [ ] **Step 1: Write the failing tests** — create `tests/requests-admin.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails** — `node tests/requests-admin.test.js` → fails with `Cannot find module '../js/requests-admin-core.js'`.

- [ ] **Step 3: Write the module** — create `js/requests-admin-core.js`:

```js
// ════════════════════════════════════════════════════════════════════
// Requests (WorkMate, 0085/0086) — shared core for the office screens.
//
// Workers and team leaders request materials and tools in DAC'S WorkMate.
// The office (owner + staff) processes them in the Requests section:
//   js/requests-admin-queue.js  — the queue and one request's detail
//   js/requests-admin-setup.js  — weekly batches, teams, catalogue, projects
// Every change goes through a 0086 office RPC; nothing here writes a table.
// NO MONEY: quantities only — no price, amount or cost anywhere.
//
// Works in a browser (window.RequestsAdmin, window.initRequestsModule) and
// in Node for tests/requests-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Asia/Manila has no daylight saving: always UTC+8. Computing from UTC
    // parts keeps every browser on Manila time, whatever its own zone.
    const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

    // ── Dates ───────────────────────────────────────────────────────

    function manilaParts(iso) {
        const t = Date.parse(iso);
        if (!iso || isNaN(t)) return null;
        const d = new Date(t + MANILA_OFFSET_MS);
        return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(),
                 h: d.getUTCHours(), min: d.getUTCMinutes() };
    }

    function clock(h, min) {
        if (h === 12 && min === 0) return '12:00 noon';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return h12 + ':' + String(min).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
    }

    function formatManila(iso) {
        const p = manilaParts(iso);
        if (!p) return '—';
        return DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m] + ' ' + p.y + ', ' + clock(p.h, p.min);
    }

    function shortDay(iso) {
        const p = manilaParts(iso);
        return p ? DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m] : '—';
    }

    function cutoffLabel(iso) {
        const p = manilaParts(iso);
        return p ? DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m] + ', ' + clock(p.h, p.min) : '—';
    }

    // A date-only value ('2026-10-12') is a calendar day, not an instant:
    // read its parts, never pass it through a time zone.
    function formatDay(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
        if (!m) return '—';
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return DAYS[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MONTHS[+m[2] - 1];
    }

    function batchLabel(b) {
        return 'Cutoff ' + cutoffLabel(b.cutoff_at) + ' · Buy ' + formatDay(b.purchase_on) + ' · Deliver ' + formatDay(b.delivery_on);
    }

    function validateDates(purchase, delivery) {
        const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
        if (!ok(purchase) || !ok(delivery)) return 'Enter both dates.';
        if (delivery < purchase) return 'Delivery cannot be before purchasing.';
        return null;
    }

    // ── Quantities ──────────────────────────────────────────────────

    function formatQty(n) {
        if (n === null || n === undefined || n === '') return '—';
        const x = Number(n);
        if (!isFinite(x)) return '—';
        return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }

    // Same bounds as the server (0085/0086): > 0, <= 1,000,000, 3 decimals.
    function parseQty(text) {
        const s = String(text === null || text === undefined ? '' : text).trim();
        if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
        const x = Number(s);
        return x > 0 && x <= 1000000 ? x : null;
    }

    // ── Line and request states ─────────────────────────────────────

    // Order matters: something the office must resolve outranks the rest.
    // A CANCELLED line with arranged quantity still shows 'reduction' —
    // the order may already be placed, and only the office can settle it.
    function lineState(line) {
        const portions = line.portions || [];
        if ((line.open_conflicts || []).length) return 'conflict';
        if (portions.some(p => Number(p.pending_reduction) > 0)) return 'reduction';
        if (line.status === 'cancelled') return 'cancelled';
        const arranged = portions.filter(p => p.arranged).length;
        if (arranged === 0) return 'unarranged';
        return arranged === portions.length ? 'arranged' : 'partly';
    }

    const STATE_LABEL = {
        conflict: 'Needs resolution',
        reduction: 'Reduction to resolve',
        cancelled: 'Cancelled',
        unarranged: 'To arrange',
        partly: 'Partly arranged',
        arranged: 'Arranged',
    };
    const STATE_PILL = {
        conflict: 'att-pill--abandoned',
        reduction: 'att-pill--abandoned',
        cancelled: 'att-pill--hidden',
        unarranged: 'att-pill--none',
        partly: 'att-pill--working',
        arranged: 'att-pill--done',
    };
    const ACTION_STATES = ['conflict', 'reduction', 'unarranged', 'partly'];

    function needsAction(line) {
        return ACTION_STATES.includes(lineState(line));
    }

    function requestSummary(req) {
        const lines = req.lines || [];
        const open = lines.filter(l => l.status === 'open');
        const urgent = open.filter(l => l.urgent);
        const neededBy = urgent.map(l => l.needed_by).filter(Boolean).sort()[0] || null;
        const cutoffs = [];
        const batchIds = [];
        open.forEach(l => (l.portions || []).forEach(p => {
            if (!p.arranged && p.cutoff_at) cutoffs.push(p.cutoff_at);
            if (!batchIds.includes(p.batch_id)) batchIds.push(p.batch_id);
        }));
        cutoffs.sort((a, b) => Date.parse(a) - Date.parse(b));
        const states = lines.map(lineState);
        return {
            urgent: urgent.length > 0,
            neededBy,
            openLines: open.length,
            totalLines: lines.length,
            actionLines: states.filter(s => ACTION_STATES.includes(s)).length,
            conflicts: states.filter(s => s === 'conflict').length,
            reductions: states.filter(s => s === 'reduction').length,
            firstCutoff: cutoffs[0] || null,
            batchIds,
        };
    }

    function cmpNullLast(a, b, key) {
        if (a === b) return 0;
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;
        return key(a) - key(b);
    }

    // Urgent first (earliest needed-by first), then the earliest weekly
    // batch still to arrange, then first come first served.
    function sortQueue(reqs) {
        const day = (s) => Date.parse(s + 'T00:00:00Z');
        return (reqs || []).map(r => ({ r, s: requestSummary(r) })).sort((a, b) => {
            if (a.s.urgent !== b.s.urgent) return a.s.urgent ? -1 : 1;
            if (a.s.urgent) {
                const n = cmpNullLast(a.s.neededBy, b.s.neededBy, day);
                if (n) return n;
            }
            const c = cmpNullLast(a.s.firstCutoff, b.s.firstCutoff, Date.parse);
            if (c) return c;
            return Date.parse(a.r.received_at) - Date.parse(b.r.received_at);
        }).map(x => x.r);
    }

    function filterQueue(reqs, opts) {
        const o = opts || {};
        const text = String(o.text || '').trim().toLowerCase();
        return (reqs || []).filter(r => {
            const s = requestSummary(r);
            if (o.batchId && !s.batchIds.includes(o.batchId)) return false;
            if (o.actionOnly && s.actionLines === 0) return false;
            if (!text) return true;
            const hay = [r.requester_name, r.project_name, r.work_name, r.team_name, r.note]
                .concat((r.lines || []).map(l => [l.description, l.spec, l.catalog_name].join(' ')))
                .join(' ').toLowerCase();
            return hay.includes(text);
        });
    }

    // ── History ─────────────────────────────────────────────────────

    function withNote(d) {
        return d && d.note ? ' — ' + d.note : '';
    }

    function eventText(ev) {
        const d = (ev && ev.detail) || {};
        const q = formatQty;
        switch (ev && ev.kind) {
            case 'submitted':               return 'Sent the request';
            case 'quantity_changed':        return 'Changed the quantity ' + q(d.from) + ' → ' + q(d.to);
            case 'quantity_conflict':       return 'Offline edit to ' + q(d.proposed) + ' arrived after the quantity had changed to ' + q(d.current) + ' — needs resolution';
            case 'line_cancelled':          return 'Cancelled the item';
            case 'request_cancelled':       return 'Cancelled the request';
            case 'photo_attached':          return 'Added a photo';
            case 'portion_arranged':        return 'Marked ' + q(d.quantity) + ' arranged';
            case 'portion_unarranged':      return 'Undid "arranged" on ' + q(d.quantity);
            case 'reduction_resolved':      return (d.outcome === 'order_reduced' ? 'Reduced the order by ' + q(d.quantity) : 'Kept ' + q(d.quantity) + ' as surplus') + withNote(d);
            case 'office_quantity_changed': return 'Office changed the quantity ' + q(d.from) + ' → ' + q(d.to) + ' — ' + (d.reason || '');
            case 'office_line_cancelled':   return 'Office cancelled the item — ' + (d.reason || '');
            case 'conflict_resolved':       return (d.applied ? 'Applied the offline edit (' + q(d.proposed) + ')' : 'Kept the current quantity; offline edit (' + q(d.proposed) + ') not applied') + withNote(d);
            case 'item_matched':            return d.catalog_item_id ? 'Matched to a catalogue item' : 'Removed the catalogue match';
            case 'portion_moved':           return 'Moved ' + q(d.quantity) + ' to another weekly batch' + withNote(d);
            default:                        return String((ev && ev.kind) || '');
        }
    }

    // ── Server error codes → sentences ─────────────────────────────

    const ERRORS = {
        OFFICE_ONLY: 'Only the office (owner or staff accounts) can do this.',
        NOT_FOUND: 'This record no longer exists or belongs to another company. Reload the page.',
        LINE_CLOSED: 'This item is already cancelled.',
        REDUCTION_PENDING: 'A reduction is waiting on this quantity. Resolve it first.',
        NOTHING_PENDING: 'There is no reduction left to resolve. Reload the page.',
        ALREADY_RESOLVED: 'Someone already resolved this. Reload the page.',
        BAD_QUANTITY: 'Enter a quantity above 0 (up to 1,000,000, at most 3 decimals).',
        REASON_REQUIRED: 'Write a short reason. It is saved in the item\'s history.',
        BAD_CATALOG_ITEM: 'Pick an active catalogue item of the same kind (material or tool).',
        BAD_BATCH: 'That weekly batch is not available. Reload the page.',
        BAD_DATES: 'Delivery cannot be before purchasing. Check both dates.',
        ARRANGED: 'Arranged quantity cannot be moved. Undo "arranged" first.',
        NOT_A_TEAM_LEADER: 'Only an account with the Team Leader role can lead a team.',
        NOT_IN_TEAM: 'Add this person to the team first.',
        DUPLICATE_ITEM: 'This item (same name, size/spec and unit) is already in the catalogue.',
        DUPLICATE_TEAM: 'An active team already has this name.',
        BAD_ITEM: 'Fill in the item name and unit, and choose Material or Tool.',
        BAD_OUTCOME: 'Choose what happened to the order.',
        BAD_TEAM: 'Give the team a name. To change members, the team must be active — reload the page if it still fails.',
        BAD_WORKER: 'Only active workers and team leaders of your company can join a team.',
    };

    function errorMessage(error) {
        const text = String((error && (error.message || error.error_description || error.error)) || (typeof error === 'string' ? error : '') || '');
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) return ERRORS[code];
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    // ── Catalogue ───────────────────────────────────────────────────

    function itemLabel(item) {
        return item.name + (item.spec ? ' · ' + item.spec : '') + ' (' + item.unit + ')';
    }

    function catalogMatches(items, kind, text) {
        const t = String(text || '').trim().toLowerCase();
        return (items || [])
            .filter(i => i.active && i.kind === kind)
            .filter(i => !t || [i.name, i.spec, i.unit, i.category].join(' ').toLowerCase().includes(t))
            .sort((a, b) => a.name.localeCompare(b.name) || String(a.spec).localeCompare(String(b.spec)));
    }

    const pure = { formatQty, parseQty, manilaParts, formatManila, formatDay, shortDay, cutoffLabel, batchLabel,
                   validateDates, lineState, STATE_LABEL, STATE_PILL, needsAction, requestSummary, sortQueue,
                   filterQueue, eventText, ERRORS, errorMessage, itemLabel, catalogMatches };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser helpers ─────────────────────────────────────────────

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function icons() {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }

    async function rpc(name, args) {
        const { data, error } = await root.sbClient.rpc(name, args || {});
        if (error) throw error;
        return data;
    }

    function fail(host, error) {
        host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
            esc(errorMessage(error)) + '</div></div></div>';
        icons();
    }

    // One modal at a time, in a host appended to <body>. onSubmit throws to
    // keep the modal open with the message; on success the modal closes and
    // onDone runs (usually: re-render the view).
    function modal(opts) {
        let host = document.getElementById('reqModalHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'reqModalHost';
            document.body.appendChild(host);
        }
        host.innerHTML =
            '<div class="att-modal" id="reqModal">' +
              '<div class="att-modal-box att-modal-box--narrow" role="dialog" aria-modal="true" aria-labelledby="reqModalTitle">' +
                '<div class="att-modal-head"><div>' +
                  '<h3 class="att-modal-title" id="reqModalTitle">' + esc(opts.title) + '</h3>' +
                  (opts.sub ? '<p class="att-modal-sub">' + esc(opts.sub) + '</p>' : '') +
                '</div><button class="att-modal-x" type="button" data-close aria-label="Close">&times;</button></div>' +
                '<form class="att-modal-form" autocomplete="off">' +
                  '<div class="att-modal-body att-modal-body--single">' + (opts.body || '') +
                    '<div class="att-err att-err--general att-span" data-error style="display:none"></div>' +
                  '</div>' +
                  '<div class="att-modal-foot">' +
                    '<button class="att-btn" type="button" data-close>Cancel</button>' +
                    '<button class="att-btn ' + (opts.warn ? 'att-btn--warn' : 'att-btn--primary') + '" type="submit" data-submit>' +
                      esc(opts.submitLabel || 'Save') + '</button>' +
                  '</div>' +
                '</form>' +
              '</div>' +
            '</div>';
        const form = host.querySelector('form');
        const errorBox = host.querySelector('[data-error]');
        const submit = host.querySelector('[data-submit]');
        function onKey(e) { if (e.key === 'Escape') close(); }
        function close() {
            document.removeEventListener('keydown', onKey);
            host.innerHTML = '';
        }
        document.addEventListener('keydown', onKey);
        host.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        host.querySelector('#reqModal').addEventListener('click', e => { if (e.target.id === 'reqModal') close(); });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorBox.style.display = 'none';
            submit.disabled = true;
            try {
                await opts.onSubmit(form);
                close();
                if (opts.onDone) opts.onDone();
            } catch (err) {
                errorBox.textContent = errorMessage(err);
                errorBox.style.display = 'block';
                submit.disabled = false;
            }
        });
        if (opts.onOpen) opts.onOpen(form);
        const first = form.querySelector('input:not([type=hidden]):not([type=radio]), select, textarea');
        if (first) first.focus();
        icons();
        return { close };
    }

    const state = { detailId: null };
    const views = {};

    function openRequest(id) {
        state.detailId = id;
        root.switchView('reqDetail');
    }

    root.RequestsAdmin = Object.assign({}, pure, { esc, icons, rpc, fail, modal, openRequest, state, views });

    root.initRequestsModule = function (view) {
        const host = document.getElementById(view + 'View');
        const render = views[view];
        if (host && render) render(host);
    };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Add the suite to `npm test`** — append ` && node tests/requests-admin.test.js` to the `"test"` script in `package.json` (CRLF kept; `git diff --stat package.json` shows only that line).

- [ ] **Step 5: Run** — `node tests/requests-admin.test.js` → `16 passed, 0 failed`; `node --check js/requests-admin-core.js`; `npm test` → exit 0.

- [ ] **Step 6: Stop — no commit.**

---
### Task 4: Requests section in the portal + the queue screen

**Files:**
- Create: `js/requests-admin-queue.js`
- Create: `css/requests-admin.css`
- Modify: `js/admin.js` — `PRIMARY_NAV` (new section after the `attendance` entry) and `_FOCUS_SUBVIEWS`
- Modify: `admin.html` — stylesheet link, view containers, script tags, and the `switchView` override (`REQ_VIEWS`, `TITLES`, init call)

**Interfaces:**
- Consumes: `window.RequestsAdmin` (Task 3): `esc`, `icons`, `rpc`, `fail`, `openRequest`, `views`, `requestSummary`, `sortQueue`, `filterQueue`, `lineState`, `STATE_LABEL`, `STATE_PILL`, `formatManila`, `shortDay`, `batchLabel`, `formatQty`; RPCs `pr_office_queue(p_scope)`, `pr_office_batches()`.
- Produces: views `reqQueue` (this task), containers for `reqDetail` (Task 5) and `reqBatches`, `reqTeams`, `reqCatalog`, `reqProjects` (Task 6); `admin.html` calls `initRequestsModule(view)` for all six. CSS classes `req-row`, `req-urgent`, `req-muted`, `req-lines`, `req-photos`, `req-photo`, `req-history`, `req-history-item`, `req-history-when`, `req-actions`, `req-toggle` (used by Tasks 5–6).

Context: the portal's top navigation is data-driven from `PRIMARY_NAV` in `js/admin.js`; `syncPortalChrome(view)` finds the section whose `modules` contain the view. A module with `hidden: true` is routable but not shown in the secondary row (the `dashboard` entry does this) — `reqDetail` uses that so the Requests tab stays highlighted on the detail screen. `admin.html` overrides `switchView` (search for `window.switchView = function(view)`); each section declares its views in a `*_VIEWS` array and calls its init there. Staff see Requests (no money in it); `_visibleNav()` needs no change. **Workers never reach this section** (Task 7 blocks their web sign-in).

- [ ] **Step 1: Nav section** — in `js/admin.js`, insert into `PRIMARY_NAV` directly after the closing `},` of the `attendance` entry (the one whose last module is `attAppUpdates`):

```js
    // WorkMate Requests (0085/0086): workers and team leaders request
    // materials and tools in DAC'S WorkMate; the office processes them here.
    // Owner + staff. Quantities only — no price, amount or cost anywhere.
    { id: 'requests', label: 'Requests', sub: 'Materials & Tools', defaultView: 'reqQueue',
      modules: [
        { view: 'reqQueue',    label: 'Queue',          icon: 'inbox' },
        { view: 'reqBatches',  label: 'Weekly batches', icon: 'calendar-days' },
        { view: 'reqTeams',    label: 'Teams',          icon: 'users' },
        { view: 'reqCatalog',  label: 'Catalogue',      icon: 'package-search' },
        { view: 'reqProjects', label: 'Projects',       icon: 'hard-hat' },
        // One request's detail: routable, highlighted under Requests, but
        // not a button in the secondary row (like Appointments' dashboard).
        { view: 'reqDetail',   label: 'Request',        icon: 'file-text', hidden: true },
      ]
    },
```

  and add to `_FOCUS_SUBVIEWS` (after the `attendance:` entry):

```js
    // Drill-down from the queue into one request (also a hidden module).
    requests: ['reqDetail'],
```

- [ ] **Step 2: `admin.html` wiring** — four edits:
  1. After `<link rel="stylesheet" href="css/attendance-admin.css">` add `<link rel="stylesheet" href="css/requests-admin.css">`.
  2. After the line `<div id="quoteRevisionView" class="content-view" style="display: none;"></div>` add:

```html
        <!-- Requests (WorkMate, 0085/0086) — rendered by js/requests-admin-*.js.
             reqDetail is the drill-down from a row in reqQueue. -->
        <div id="reqQueueView"      class="content-view" style="display: none;"></div>
        <div id="reqDetailView"     class="content-view" style="display: none;"></div>
        <div id="reqBatchesView"    class="content-view" style="display: none;"></div>
        <div id="reqTeamsView"      class="content-view" style="display: none;"></div>
        <div id="reqCatalogView"    class="content-view" style="display: none;"></div>
        <div id="reqProjectsView"   class="content-view" style="display: none;"></div>
```

  3. After `<script src="js/app-updates-admin.js"></script>` add:

```html
<script src="js/requests-admin-core.js"></script>
<script src="js/requests-admin-queue.js"></script>
```

  4. In the `switchView` override: after `const ATT_VIEWS   = [...]` add
     `const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqProjects'];`;
     in `TITLES` after `attAppUpdates:    'App updates',` add

```js
        reqQueue:         'Request queue',
        reqDetail:        'Request',
        reqBatches:       'Weekly batches',
        reqTeams:         'Teams',
        reqCatalog:       'Item catalogue',
        reqProjects:      'Projects open to requests',
```

     and after the `initAppUpdatesModule(...)` call add
     `if (REQ_VIEWS.includes(view)   && typeof initRequestsModule === 'function') initRequestsModule(view);`

- [ ] **Step 3: Styles** — create `css/requests-admin.css`:

```css
/* ════════════════════════════════════════════════════════════════════
   REQUESTS (WorkMate) — extra styles for js/requests-admin-*.js.
   Everything else reuses the Attendance att-* classes and tokens
   (css/attendance-admin.css) so the two office sections look alike.
   ════════════════════════════════════════════════════════════════════ */

.req-row { cursor: pointer; }
.req-row:hover td { background: var(--att-line-soft); }
.req-row:focus-visible { outline: 2px solid var(--att-green); outline-offset: -2px; }

.req-urgent {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--att-red-tint);
    color: var(--att-red);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: .02em;
    white-space: nowrap;
}
.req-muted { color: var(--att-muted); font-size: 12.5px; }

.req-lines { display: grid; gap: 14px; }

.req-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.req-photos { display: flex; flex-wrap: wrap; gap: 10px; }
.req-photo {
    width: 96px;
    height: 96px;
    border-radius: 10px;
    border: 1px solid var(--att-line);
    object-fit: cover;
    background: var(--att-field);
    cursor: zoom-in;
}

.req-history { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.req-history-item { display: grid; grid-template-columns: 190px 1fr; gap: 12px; font-size: 13px; }
.req-history-when { color: var(--att-muted); font-size: 12.5px; }

.req-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.req-toggle input { width: 16px; height: 16px; accent-color: var(--att-green); }

@media (max-width: 640px) {
    .req-history-item { grid-template-columns: 1fr; gap: 2px; }
}
```

- [ ] **Step 4: The queue screen** — create `js/requests-admin-queue.js`:

```js
// ════════════════════════════════════════════════════════════════════
// Requests → Queue (WorkMate, 0086). Owner + staff.
//
// Every request with an open item, urgent first (earliest needed-by),
// then by the earliest weekly batch still to arrange. A row opens the
// request (js/requests-admin-detail.js). Closed = no open item left.
// Read-only here: every action lives on the detail screen.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;

    // Survives navigation within the session, not a reload.
    const ui = { scope: 'open', batchId: '', text: '', actionOnly: false };

    function statusPill(req, s) {
        let state;
        if (s.conflicts) state = 'conflict';
        else if (s.reductions) state = 'reduction';
        else if (s.openLines === 0) state = 'cancelled';
        else if (s.actionLines === 0) state = 'arranged';
        else state = (req.lines || []).some(l => RA.lineState(l) === 'partly' || RA.lineState(l) === 'arranged') ? 'partly' : 'unarranged';
        const label = state === 'cancelled' ? 'Closed' : RA.STATE_LABEL[state];
        return '<span class="att-pill ' + RA.STATE_PILL[state] + '">' + esc(label) + '</span>';
    }

    function rowHtml(r) {
        const s = RA.requestSummary(r);
        const urgent = s.urgent
            ? '<span class="req-urgent">URGENT' + (s.neededBy ? ' · by ' + esc(RA.formatDay(s.neededBy)) : '') + '</span>'
            : '';
        const items = (r.lines || []).map(l => esc(l.description)).slice(0, 3).join(', ') +
            ((r.lines || []).length > 3 ? ', …' : '');
        return '<tr class="req-row" tabindex="0" data-id="' + esc(r.id) + '">' +
            '<td>' + urgent + '</td>' +
            '<td>' + esc(RA.formatManila(r.received_at)) + '</td>' +
            '<td><strong>' + esc(r.requester_name) + '</strong>' +
              (r.team_name ? '<div class="req-muted">Team ' + esc(r.team_name) + '</div>' : '') + '</td>' +
            '<td>' + esc(r.project_name) + '<div class="req-muted">' + esc(r.work_name) + '</div></td>' +
            '<td>' + items + '<div class="req-muted">' + s.openLines + ' of ' + s.totalLines + ' open</div></td>' +
            '<td>' + (s.firstCutoff ? esc(RA.shortDay(s.firstCutoff)) : '—') + '</td>' +
            '<td>' + statusPill(r, s) + '</td>' +
            '</tr>';
    }

    function drawTable(host, all) {
        const list = RA.sortQueue(RA.filterQueue(all, { text: ui.text, batchId: ui.batchId, actionOnly: ui.actionOnly }));
        const body = host.querySelector('[data-rows]');
        const empty = host.querySelector('[data-empty]');
        body.innerHTML = list.map(rowHtml).join('');
        empty.style.display = list.length ? 'none' : 'block';
        empty.textContent = all.length
            ? 'No request matches these filters.'
            : (ui.scope === 'open' ? 'No open requests. New ones appear here as soon as a worker sends them.' : 'No closed requests yet.');
    }

    async function renderQueue(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading requests…</div></div>';
        let all, batches;
        try {
            [all, batches] = await Promise.all([RA.rpc('pr_office_queue', { p_scope: ui.scope }), RA.rpc('pr_office_batches')]);
        } catch (e) { RA.fail(host, e); return; }
        all = all || [];
        batches = batches || [];
        const now = Date.now();
        const current = batches.find(b => Date.parse(b.cutoff_at) > now);
        if (ui.batchId && !batches.some(b => b.id === ui.batchId)) ui.batchId = '';

        host.innerHTML =
            '<div class="att-stack">' +
              '<div class="att-head"><div>' +
                '<h2 class="att-title">Request queue</h2>' +
                '<p class="att-sub">Materials and tools requested in DAC\'S WorkMate. Urgent first, then by weekly batch.</p>' +
              '</div></div>' +
              (current
                ? '<div class="att-info"><i data-lucide="calendar-clock"></i><div><strong>This week:</strong> ' +
                  esc(RA.batchLabel(current)) + '. Requests received after the cutoff go to the next week. ' +
                  '<button class="att-link" type="button" data-go-batches>Change batch dates</button></div></div>'
                : '') +
              '<div class="att-toolbar">' +
                '<div class="att-seg" role="group" aria-label="Open or closed">' +
                  '<button type="button" class="att-seg-btn' + (ui.scope === 'open' ? ' is-on' : '') + '" data-scope="open">Open</button>' +
                  '<button type="button" class="att-seg-btn' + (ui.scope === 'closed' ? ' is-on' : '') + '" data-scope="closed">Closed</button>' +
                '</div>' +
                '<select class="att-filter" data-batch aria-label="Weekly batch">' +
                  '<option value="">All weekly batches</option>' +
                  batches.map(b => '<option value="' + esc(b.id) + '"' + (b.id === ui.batchId ? ' selected' : '') + '>' +
                    esc('Cutoff ' + RA.cutoffLabel(b.cutoff_at)) + ' (' + b.open_portions + ')</option>').join('') +
                '</select>' +
                '<input class="att-search" type="search" data-text placeholder="Search worker, project, item…" value="' + esc(ui.text) + '">' +
                '<label class="req-toggle"><input type="checkbox" data-action-only' + (ui.actionOnly ? ' checked' : '') + '> Needs action only</label>' +
              '</div>' +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<table class="att-table"><thead><tr>' +
                  '<th></th><th>Received</th><th>Requested by</th><th>For</th><th>Items</th><th>Batch</th><th>Status</th>' +
                '</tr></thead><tbody data-rows></tbody></table>' +
                '<div class="att-empty" data-empty style="display:none"></div>' +
              '</div></div>' +
            '</div>';

        drawTable(host, all);

        host.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
            if (ui.scope === b.dataset.scope) return;
            ui.scope = b.dataset.scope;
            renderQueue(host);
        }));
        host.querySelector('[data-batch]').addEventListener('change', e => { ui.batchId = e.target.value; drawTable(host, all); });
        host.querySelector('[data-text]').addEventListener('input', e => { ui.text = e.target.value; drawTable(host, all); });
        host.querySelector('[data-action-only]').addEventListener('change', e => { ui.actionOnly = e.target.checked; drawTable(host, all); });
        const goBatches = host.querySelector('[data-go-batches]');
        if (goBatches) goBatches.addEventListener('click', () => root.switchView('reqBatches'));
        const rows = host.querySelector('[data-rows]');
        rows.addEventListener('click', e => {
            const tr = e.target.closest('tr[data-id]');
            if (tr) RA.openRequest(tr.dataset.id);
        });
        rows.addEventListener('keydown', e => {
            const tr = e.target.closest('tr[data-id]');
            if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); RA.openRequest(tr.dataset.id); }
        });
        RA.icons();
    }

    RA.views.reqQueue = renderQueue;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: Check** — `node --check js/requests-admin-queue.js`; `node --check js/admin.js`; `npm test` → exit 0. In a browser is Task 8 (the RPCs do not exist live until 0086 is applied).

- [ ] **Step 6: Stop — no commit.**

---

### Task 5: One request — detail screen and every office action

**Files:**
- Create: `js/requests-admin-detail.js`
- Modify: `admin.html` — add `<script src="js/requests-admin-detail.js"></script>` directly after the `requests-admin-queue.js` script tag

**Interfaces:**
- Consumes: `window.RequestsAdmin` (Task 3) — `esc`, `icons`, `rpc`, `fail`, `modal`, `state.detailId`, `views`, `lineState`, `STATE_LABEL`, `STATE_PILL`, `formatQty`, `parseQty`, `formatManila`, `formatDay`, `cutoffLabel`, `batchLabel`, `eventText`, `itemLabel`, `catalogMatches`; RPCs `pr_office_request(p_request)`, `pr_office_batches()`, `pr_office_catalog()`, `pr_office_set_arranged(p_portion, p_arranged)`, `pr_office_resolve_reduction(p_portion, p_outcome, p_note)`, `pr_office_change_quantity(p_line, p_quantity, p_reason)`, `pr_office_cancel_line(p_line, p_reason)`, `pr_office_resolve_conflict(p_conflict, p_apply, p_note)`, `pr_office_match_item(p_line, p_item)`, `pr_office_move_portion(p_portion, p_batch, p_note)`; private bucket `request-photos` (0085 "office reads" storage policy); CSS from Task 4.
- Produces: view `reqDetail`.

Behaviour rules (from the spec and 0085/0086 — the server enforces them; the screen only offers what is allowed):
- **Mark arranged** on an unarranged portion of an open line. **Undo** on an arranged portion with nothing pending.
- **Move to another batch** only on an unarranged portion of an open line; the target list is every batch except the portion's own.
- **Resolve reduction** on any portion with `pending_reduction > 0` (also on a cancelled line).
- **Change quantity** and **Cancel item** on an open line; both need a reason.
- **Resolve** each open conflict: apply the worker's number or keep the current one.
- **Match** to the catalogue on any line (same kind only); "No match" unmatches.
- Photos open via a 10-minute signed URL; never a public URL.

- [ ] **Step 1: Write the screen** — create `js/requests-admin-detail.js`:

```js
// ════════════════════════════════════════════════════════════════════
// Requests → one request (WorkMate, 0086). Owner + staff.
//
// Every office action on a request: mark portions arranged, move an
// unarranged portion to another weekly batch, resolve a worker's
// reduction of arranged quantity, change or cancel an item (with a
// reason), resolve an offline-edit conflict, match an unlisted item to
// the catalogue. Each is one 0086 RPC; the server re-checks every rule,
// so this screen only decides which buttons to offer.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const PHOTO_BUCKET = 'request-photos';

    function kindLabel(kind) { return kind === 'tool' ? 'Tool' : 'Material'; }

    function portionRows(line) {
        const open = line.status === 'open';
        return (line.portions || []).map(p => {
            const pending = Number(p.pending_reduction) > 0;
            const actions = [];
            if (open && !p.arranged) {
                actions.push('<button class="att-btn att-btn--primary" type="button" data-act="arrange" data-portion="' + esc(p.id) + '">Mark arranged</button>');
                actions.push('<button class="att-btn" type="button" data-act="move" data-portion="' + esc(p.id) + '" data-line="' + esc(line.id) + '">Move…</button>');
            }
            if (p.arranged && !pending) {
                actions.push('<button class="att-btn" type="button" data-act="unarrange" data-portion="' + esc(p.id) + '">Undo arranged</button>');
            }
            if (pending) {
                actions.push('<button class="att-btn att-btn--warn" type="button" data-act="reduction" data-portion="' + esc(p.id) + '" data-line="' + esc(line.id) + '">Resolve reduction…</button>');
            }
            return '<tr>' +
                '<td><strong>' + esc(RA.cutoffLabel(p.cutoff_at)) + '</strong>' +
                  '<div class="req-muted">Buy ' + esc(RA.formatDay(p.purchase_on)) + ' · Deliver ' + esc(RA.formatDay(p.delivery_on)) + '</div></td>' +
                '<td>' + esc(RA.formatQty(p.quantity)) + ' ' + esc(line.unit) + '</td>' +
                '<td>' + (p.arranged
                    ? '<span class="att-pill att-pill--done">Arranged</span><div class="req-muted">' +
                      esc(p.arranged_by_name || '') + ' · ' + esc(RA.formatManila(p.arranged_at)) + '</div>'
                    : '<span class="att-pill att-pill--none">Not yet</span>') + '</td>' +
                '<td>' + (pending
                    ? '<strong style="color:var(--att-red)">−' + esc(RA.formatQty(p.pending_reduction)) + ' ' + esc(line.unit) + '</strong>'
                    : '—') + '</td>' +
                '<td><div class="req-actions">' + actions.join('') + '</div></td>' +
                '</tr>';
        }).join('');
    }

    function conflictBlocks(line) {
        return (line.open_conflicts || []).map(k =>
            '<div class="att-info att-info--warn"><i data-lucide="git-compare"></i><div>' +
              '<strong>Offline edit needs a decision.</strong> ' + esc(k.proposed_by_name) + ' changed this to <strong>' +
              esc(RA.formatQty(k.proposed_quantity)) + ' ' + esc(line.unit) + '</strong> on a phone that had not seen the change to ' +
              esc(RA.formatQty(k.current_quantity)) + ' (' + esc(RA.formatManila(k.created_at)) + '). Nothing was overwritten.' +
              '<div class="req-actions" style="margin-top:8px">' +
                '<button class="att-btn att-btn--primary" type="button" data-act="conflict" data-conflict="' + esc(k.id) + '" data-apply="1"' +
                  (line.status === 'open' && Number(k.proposed_quantity) > 0 ? '' : ' disabled') + '>Apply ' +
                  esc(RA.formatQty(k.proposed_quantity)) + '</button>' +
                '<button class="att-btn" type="button" data-act="conflict" data-conflict="' + esc(k.id) + '" data-apply="0">Keep ' +
                  esc(RA.formatQty(line.needed)) + '</button>' +
              '</div>' +
            '</div></div>').join('');
    }

    function lineCard(line, photos) {
        const st = RA.lineState(line);
        const open = line.status === 'open';
        const catalog = line.catalog_item_id
            ? esc(line.catalog_name) + (line.catalog_spec ? ' · ' + esc(line.catalog_spec) : '') + ' (' + esc(line.catalog_unit) + ')'
            : '<span class="req-muted">Not in the catalogue</span>';
        const linePhotos = photos.filter(ph => ph.line_id === line.id);
        return '<div class="att-card">' +
            '<div class="att-card-head"><div>' +
              '<div class="att-card-title">' + (line.position + 1) + '. ' + esc(line.description) + '</div>' +
              '<div class="att-card-sub">' + esc(kindLabel(line.kind)) + (line.spec ? ' · ' + esc(line.spec) : '') + ' · ' + esc(line.unit) +
                (line.category ? ' · ' + esc(line.category) : '') + '</div>' +
            '</div><div class="att-card-tools">' +
              (line.urgent ? '<span class="req-urgent">URGENT · by ' + esc(RA.formatDay(line.needed_by)) + '</span> ' : '') +
              '<span class="att-pill ' + RA.STATE_PILL[st] + '">' + esc(RA.STATE_LABEL[st]) + '</span>' +
            '</div></div>' +
            '<div class="att-card-body att-stack">' +
              '<div class="att-facts">' +
                '<div class="att-fact"><div class="att-fact-label">Still needed</div><div class="att-fact-val att-fact-strong">' +
                  esc(RA.formatQty(line.needed)) + ' ' + esc(line.unit) + '</div></div>' +
                '<div class="att-fact"><div class="att-fact-label">Catalogue</div><div class="att-fact-val">' + catalog +
                  ' <button class="att-link" type="button" data-act="match" data-line="' + esc(line.id) + '">' +
                  (line.catalog_item_id ? 'Change' : 'Match') + '</button></div></div>' +
                (line.intended_member_name ? '<div class="att-fact"><div class="att-fact-label">For</div><div class="att-fact-val">' +
                  esc(line.intended_member_name) + '</div></div>' : '') +
                (line.urgent ? '<div class="att-fact"><div class="att-fact-label">Why urgent</div><div class="att-fact-val">' +
                  esc(line.urgent_reason) + '</div></div>' : '') +
                (line.notes ? '<div class="att-fact"><div class="att-fact-label">Notes</div><div class="att-fact-val">' +
                  esc(line.notes) + '</div></div>' : '') +
              '</div>' +
              conflictBlocks(line) +
              ((line.portions || []).length
                ? '<table class="att-table"><thead><tr><th>Weekly batch</th><th>Quantity</th><th>Arranged</th><th>Reduction</th><th></th></tr></thead>' +
                  '<tbody>' + portionRows(line) + '</tbody></table>'
                : '') +
              (linePhotos.length ? '<div class="req-photos">' + linePhotos.map(photoImg).join('') + '</div>' : '') +
              (open ? '<div class="req-actions">' +
                '<button class="att-btn" type="button" data-act="qty" data-line="' + esc(line.id) + '">Change quantity…</button>' +
                '<button class="att-btn att-btn--warn" type="button" data-act="cancel" data-line="' + esc(line.id) + '">Cancel item…</button>' +
              '</div>' : '') +
            '</div></div>';
    }

    function photoImg(ph) {
        return '<img class="req-photo" alt="Request photo" data-photo-path="' + esc(ph.path) + '">';
    }

    async function loadPhotos(host) {
        const imgs = host.querySelectorAll('img[data-photo-path]');
        for (const img of imgs) {
            const { data, error } = await root.sbClient.storage.from(PHOTO_BUCKET).createSignedUrl(img.dataset.photoPath, 600);
            if (error || !data) { img.alt = 'Photo unavailable'; continue; }
            img.src = data.signedUrl;
            img.addEventListener('click', () => root.open(data.signedUrl, '_blank', 'noopener'));
        }
    }

    function historyHtml(req) {
        const byLine = {};
        (req.lines || []).forEach(l => { byLine[l.id] = (l.position + 1) + '. ' + l.description; });
        const events = (req.events || []).slice().reverse();
        if (!events.length) return '<div class="att-empty">No history yet.</div>';
        return '<ul class="req-history">' + events.map(e =>
            '<li class="req-history-item"><div class="req-history-when">' + esc(RA.formatManila(e.created_at)) + '</div>' +
            '<div><strong>' + esc(e.actor_name) + '</strong> — ' + esc(RA.eventText(e)) +
            (e.line_id && byLine[e.line_id] ? ' <span class="req-muted">(' + esc(byLine[e.line_id]) + ')</span>' : '') +
            '</div></li>').join('') + '</ul>';
    }

    // ── Modals ──────────────────────────────────────────────────────

    function findLine(req, id) { return (req.lines || []).find(l => l.id === id); }
    function findPortion(req, id) {
        for (const l of req.lines || []) for (const p of l.portions || []) if (p.id === id) return { line: l, portion: p };
        return null;
    }

    function qtyModal(req, line, rerender) {
        RA.modal({
            title: 'Change quantity',
            sub: line.description + ' · now ' + RA.formatQty(line.needed) + ' ' + line.unit,
            body:
                '<div class="att-field att-span"><label for="reqQty">New quantity (' + esc(line.unit) + ')</label>' +
                  '<input class="att-input" id="reqQty" name="qty" inputmode="decimal" value="' + esc(String(line.needed)) + '"></div>' +
                '<div class="att-field att-span"><label for="reqReason">Reason</label>' +
                  '<input class="att-input" id="reqReason" name="reason" maxlength="200" placeholder="e.g. Engineer recounted on site"></div>' +
                '<div class="att-hint att-span">Lowering below what is already arranged does not erase it: the difference waits as a reduction for you to resolve.</div>',
            submitLabel: 'Change quantity',
            onSubmit: async (form) => {
                const q = RA.parseQty(form.qty.value);
                if (q === null) throw new Error('BAD_QUANTITY');
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_change_quantity', { p_line: line.id, p_quantity: q, p_reason: form.reason.value.trim() });
            },
            onDone: rerender,
        });
    }

    function cancelModal(req, line, rerender) {
        const arranged = (line.portions || []).some(p => p.arranged);
        RA.modal({
            title: 'Cancel this item',
            sub: line.description + ' · ' + RA.formatQty(line.needed) + ' ' + line.unit,
            body:
                (arranged ? '<div class="att-info att-info--warn att-span"><i data-lucide="alert-triangle"></i><div>Part of this is already arranged. ' +
                  'That quantity will wait as a reduction for you to resolve.</div></div>' : '') +
                '<div class="att-field att-span"><label for="reqReason">Reason</label>' +
                  '<input class="att-input" id="reqReason" name="reason" maxlength="200" placeholder="e.g. Wrong size; replaced by item 3"></div>',
            submitLabel: 'Cancel item',
            warn: true,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_cancel_line', { p_line: line.id, p_reason: form.reason.value.trim() });
            },
            onDone: rerender,
        });
    }

    function reductionModal(line, portion, rerender) {
        RA.modal({
            title: 'Resolve the reduction',
            sub: line.description + ' · ' + RA.cutoffLabel(portion.cutoff_at),
            body:
                '<div class="att-info att-span"><i data-lucide="info"></i><div>' +
                  esc(RA.formatQty(portion.quantity)) + ' ' + esc(line.unit) + ' was arranged; the request now needs ' +
                  esc(RA.formatQty(portion.pending_reduction)) + ' ' + esc(line.unit) + ' less. What happened to the order?</div></div>' +
                '<label class="req-toggle att-span"><input type="radio" name="outcome" value="order_reduced" checked> ' +
                  'The supplier order was reduced</label>' +
                '<label class="req-toggle att-span"><input type="radio" name="outcome" value="kept_as_surplus"> ' +
                  'Kept the full order — the extra is surplus</label>' +
                '<div class="att-field att-span"><label for="reqNote">Note <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqNote" name="note" maxlength="200"></div>',
            submitLabel: 'Resolve',
            onSubmit: async (form) => {
                await RA.rpc('pr_office_resolve_reduction', { p_portion: portion.id, p_outcome: form.outcome.value, p_note: form.note.value.trim() || null });
            },
            onDone: rerender,
        });
    }

    async function moveModal(line, portion, rerender) {
        let batches;
        try { batches = await RA.rpc('pr_office_batches'); } catch (e) { alert(RA.errorMessage(e)); return; }
        const targets = (batches || []).filter(b => b.id !== portion.batch_id);
        RA.modal({
            title: 'Move to another weekly batch',
            sub: line.description + ' · ' + RA.formatQty(portion.quantity) + ' ' + line.unit,
            body:
                '<div class="att-field att-span"><label for="reqBatch">Weekly batch</label>' +
                  '<select class="att-input" id="reqBatch" name="batch">' +
                    targets.map(b => '<option value="' + esc(b.id) + '">' + esc(RA.batchLabel(b)) + '</option>').join('') +
                  '</select></div>' +
                '<div class="att-field att-span"><label for="reqNote">Note <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqNote" name="note" maxlength="200" placeholder="e.g. Supplier can deliver earlier"></div>',
            submitLabel: 'Move',
            onSubmit: async (form) => {
                await RA.rpc('pr_office_move_portion', { p_portion: portion.id, p_batch: form.batch.value, p_note: form.note.value.trim() || null });
            },
            onDone: rerender,
        });
    }

    function conflictModal(req, line, conflictId, apply, rerender) {
        const k = (line.open_conflicts || []).find(x => x.id === conflictId);
        if (!k) return;
        RA.modal({
            title: apply ? 'Apply the offline edit' : 'Keep the current quantity',
            sub: line.description,
            body:
                '<div class="att-info att-span"><i data-lucide="info"></i><div>' + (apply
                    ? 'The item will need <strong>' + esc(RA.formatQty(k.proposed_quantity)) + ' ' + esc(line.unit) + '</strong>.'
                    : 'The item stays at <strong>' + esc(RA.formatQty(line.needed)) + ' ' + esc(line.unit) + '</strong>; ' +
                      esc(k.proposed_by_name) + '\'s edit is kept in the history only.') + '</div></div>' +
                '<div class="att-field att-span"><label for="reqNote">Note <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqNote" name="note" maxlength="200"></div>',
            submitLabel: apply ? 'Apply' : 'Keep current',
            onSubmit: async (form) => {
                await RA.rpc('pr_office_resolve_conflict', { p_conflict: conflictId, p_apply: apply, p_note: form.note.value.trim() || null });
            },
            onDone: rerender,
        });
    }

    async function matchModal(line, rerender) {
        let items;
        try { items = await RA.rpc('pr_office_catalog'); } catch (e) { alert(RA.errorMessage(e)); return; }
        items = items || [];
        function options(text) {
            return '<option value="">— No match —</option>' + RA.catalogMatches(items, line.kind, text).map(i =>
                '<option value="' + esc(i.id) + '"' + (i.id === line.catalog_item_id ? ' selected' : '') + '>' + esc(RA.itemLabel(i)) + '</option>').join('');
        }
        RA.modal({
            title: 'Match to the catalogue',
            sub: line.description + (line.spec ? ' · ' + line.spec : '') + ' (' + line.unit + ')',
            body:
                '<div class="att-field att-span"><label for="reqFind">Search the ' + (line.kind === 'tool' ? 'tools' : 'materials') + '</label>' +
                  '<input class="att-input" id="reqFind" name="find" type="search" placeholder="Name, size, unit…"></div>' +
                '<div class="att-field att-span"><label for="reqItem">Catalogue item</label>' +
                  '<select class="att-input" id="reqItem" name="item" size="8">' + options('') + '</select></div>' +
                '<div class="att-hint att-span">Missing? Add it in Requests → Catalogue first. The worker\'s own words stay on the request.</div>',
            submitLabel: 'Save match',
            onOpen: (form) => {
                form.find.addEventListener('input', () => { form.item.innerHTML = options(form.find.value); });
            },
            onSubmit: async (form) => {
                await RA.rpc('pr_office_match_item', { p_line: line.id, p_item: form.item.value || null });
            },
            onDone: rerender,
        });
    }

    // ── The screen ──────────────────────────────────────────────────

    async function renderDetail(host) {
        const id = RA.state.detailId;
        if (!id) { root.switchView('reqQueue'); return; }
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the request…</div></div>';
        let req;
        try { req = await RA.rpc('pr_office_request', { p_request: id }); } catch (e) { RA.fail(host, e); return; }
        if (!req) { RA.fail(host, { message: 'NOT_FOUND' }); return; }
        const photos = req.photos || [];
        const requestPhotos = photos.filter(ph => !ph.line_id);
        const rerender = () => renderDetail(host);

        host.innerHTML =
            '<div class="att-stack">' +
              '<div class="att-crumbs"><button class="att-link" type="button" data-act="back">← Request queue</button></div>' +
              '<div class="att-head"><div>' +
                '<h2 class="att-title">Request from ' + esc(req.requester_name) + '</h2>' +
                '<p class="att-sub">' + esc(req.project_name) + ' · ' + esc(req.work_name) +
                  (req.team_name ? ' · Team ' + esc(req.team_name) : '') + ' · Received ' + esc(RA.formatManila(req.received_at)) +
                  (req.drafted_at ? ' (drafted ' + esc(RA.formatManila(req.drafted_at)) + ')' : '') + '</p>' +
              '</div>' +
              (req.status === 'cancelled' ? '<div class="att-head-actions"><span class="att-pill att-pill--hidden">Cancelled</span></div>' : '') +
              '</div>' +
              (req.note ? '<div class="att-info"><i data-lucide="message-square"></i><div>' + esc(req.note) + '</div></div>' : '') +
              '<div class="req-lines">' + (req.lines || []).map(l => lineCard(l, photos)).join('') + '</div>' +
              (requestPhotos.length ? '<div class="att-card"><div class="att-card-head"><div class="att-card-title">Photos</div></div>' +
                '<div class="att-card-body"><div class="req-photos">' + requestPhotos.map(photoImg).join('') + '</div></div></div>' : '') +
              '<div class="att-card"><div class="att-card-head"><div class="att-card-title">History</div></div>' +
                '<div class="att-card-body">' + historyHtml(req) + '</div></div>' +
            '</div>';

        host.querySelector('.att-stack').addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const act = b.dataset.act;
            if (act === 'back') { root.switchView('reqQueue'); return; }
            const line = b.dataset.line ? findLine(req, b.dataset.line) : null;
            const found = b.dataset.portion ? findPortion(req, b.dataset.portion) : null;
            if (act === 'arrange' || act === 'unarrange') {
                b.disabled = true;
                try {
                    await RA.rpc('pr_office_set_arranged', { p_portion: b.dataset.portion, p_arranged: act === 'arrange' });
                    rerender();
                } catch (err) { alert(RA.errorMessage(err)); b.disabled = false; }
            } else if (act === 'reduction' && found) reductionModal(found.line, found.portion, rerender);
            else if (act === 'move' && found) moveModal(found.line, found.portion, rerender);
            else if (act === 'qty' && line) qtyModal(req, line, rerender);
            else if (act === 'cancel' && line) cancelModal(req, line, rerender);
            else if (act === 'match' && line) matchModal(line, rerender);
            else if (act === 'conflict') {
                const owner = (req.lines || []).find(l => (l.open_conflicts || []).some(k => k.id === b.dataset.conflict));
                if (owner) conflictModal(req, owner, b.dataset.conflict, b.dataset.apply === '1', rerender);
            }
        });

        RA.icons();
        loadPhotos(host);
    }

    RA.views.reqDetail = renderDetail;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Script tag** — in `admin.html`, after `<script src="js/requests-admin-queue.js"></script>` add `<script src="js/requests-admin-detail.js"></script>`.

- [ ] **Step 3: Check** — `node --check js/requests-admin-detail.js`; `npm test` → exit 0.

- [ ] **Step 4: Stop — no commit.**

---
### Task 6: Setup screens — weekly batches, teams, catalogue, projects

**Files:**
- Create: `js/requests-admin-setup.js`
- Modify: `admin.html` — add `<script src="js/requests-admin-setup.js"></script>` directly after the `requests-admin-detail.js` script tag

**Interfaces:**
- Consumes: `window.RequestsAdmin` (Task 3) — `esc`, `icons`, `rpc`, `fail`, `modal`, `views`, `errorMessage`, `batchLabel`, `cutoffLabel`, `formatDay`, `formatManila`, `validateDates`, `itemLabel`; RPCs `pr_office_batches()`, `pr_office_set_batch_dates(p_batch, p_purchase_on, p_delivery_on)`, `pr_office_teams()`, `pr_office_people()`, `pr_office_save_team(p_team, p_name, p_active)`, `pr_office_add_member(p_team, p_worker)`, `pr_office_remove_member(p_team, p_worker)`, `pr_office_set_leader(p_team, p_worker)`, `pr_office_catalog()`, `pr_office_save_item(p_item, p_kind, p_name, p_spec, p_unit, p_category, p_active)`, `pr_office_projects()`, `pr_office_set_allow_requests(p_folder, p_allow)`; CSS from Task 4.
- Produces: views `reqBatches`, `reqTeams`, `reqCatalog`, `reqProjects`.

Rules shown to the office (the server enforces them):
- A batch's **cutoff never moves**; only purchasing and delivery dates do, and delivery is never before purchasing.
- A team leader needs **both** the Team Leader role **and** being set as that team's leader. Only Team Leader-role members get a "Make leader" button. Removing someone keeps the history.
- A catalogue item is one exact thing — name + size/spec + unit. Items are deactivated, never deleted.
- A project accepts requests when it is on today's Time In list **or** *Allow requests* is on (an upcoming site with no geofence yet). A completed project never does.

- [ ] **Step 1: Write the screens** — create `js/requests-admin-setup.js`:

```js
// ════════════════════════════════════════════════════════════════════
// Requests → setup (WorkMate, 0086). Owner + staff.
//
//   reqBatches  — weekly batches; change purchasing / delivery dates
//   reqTeams    — teams, members and the one leader per team
//   reqCatalog  — the item catalogue (deactivate, never delete)
//   reqProjects — which Project Control projects accept requests
// Every change is a 0086 office RPC.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;

    function head(title, sub, actions) {
        return '<div class="att-head"><div><h2 class="att-title">' + esc(title) + '</h2>' +
            '<p class="att-sub">' + esc(sub) + '</p></div>' +
            (actions ? '<div class="att-head-actions">' + actions + '</div>' : '') + '</div>';
    }

    // ── Weekly batches ──────────────────────────────────────────────

    async function renderBatches(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading batches…</div></div>';
        let batches;
        try { batches = await RA.rpc('pr_office_batches'); } catch (e) { RA.fail(host, e); return; }
        batches = batches || [];
        const now = Date.now();
        host.innerHTML =
            '<div class="att-stack">' +
              head('Weekly batches', 'Requests received before Saturday 12:00 noon (Manila) join that week\'s batch. Holidays or supplier delays? Move the purchasing and delivery dates; workers see the new dates.') +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<table class="att-table"><thead><tr><th>Cutoff</th><th>Purchasing</th><th>Delivery</th><th>Open items</th><th>Last changed</th><th></th></tr></thead><tbody>' +
                batches.slice().reverse().map(b => {
                    const past = Date.parse(b.cutoff_at) <= now;
                    return '<tr>' +
                        '<td><strong>' + esc(RA.cutoffLabel(b.cutoff_at)) + '</strong>' + (past ? ' <span class="req-muted">(closed)</span>' : '') + '</td>' +
                        '<td>' + esc(RA.formatDay(b.purchase_on)) + '</td>' +
                        '<td>' + esc(RA.formatDay(b.delivery_on)) + '</td>' +
                        '<td>' + esc(String(b.open_portions)) + '</td>' +
                        '<td>' + (b.updated_by_name ? esc(b.updated_by_name) + '<div class="req-muted">' + esc(RA.formatManila(b.updated_at)) + '</div>' : '<span class="req-muted">Default dates</span>') + '</td>' +
                        '<td><button class="att-btn" type="button" data-edit="' + esc(b.id) + '">Change dates…</button></td>' +
                        '</tr>';
                }).join('') +
                '</tbody></table>' +
                (batches.length ? '' : '<div class="att-empty">No batches yet.</div>') +
              '</div></div>' +
            '</div>';
        host.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
            const b = batches.find(x => x.id === btn.dataset.edit);
            if (!b) return;
            RA.modal({
                title: 'Change batch dates',
                sub: 'Cutoff ' + RA.cutoffLabel(b.cutoff_at) + ' — the cutoff itself does not change',
                body:
                    '<div class="att-field"><label for="reqBuy">Purchasing</label>' +
                      '<input class="att-input" id="reqBuy" name="buy" type="date" value="' + esc(b.purchase_on) + '"></div>' +
                    '<div class="att-field"><label for="reqDeliver">Delivery</label>' +
                      '<input class="att-input" id="reqDeliver" name="deliver" type="date" value="' + esc(b.delivery_on) + '"></div>',
                submitLabel: 'Save dates',
                onSubmit: async (form) => {
                    const problem = RA.validateDates(form.buy.value, form.deliver.value);
                    if (problem) throw new Error('BAD_DATES');
                    await RA.rpc('pr_office_set_batch_dates', { p_batch: b.id, p_purchase_on: form.buy.value, p_delivery_on: form.deliver.value });
                },
                onDone: () => renderBatches(host),
            });
        }));
        RA.icons();
    }

    // ── Teams ───────────────────────────────────────────────────────

    function teamCard(t, people) {
        const memberIds = t.members.map(m => m.worker_id);
        const candidates = people.filter(p => !memberIds.includes(p.id));
        return '<div class="att-card" data-team="' + esc(t.id) + '">' +
            '<div class="att-card-head"><div>' +
              '<div class="att-card-title">' + esc(t.name) + '</div>' +
              '<div class="att-card-sub">' + t.members.length + ' member' + (t.members.length === 1 ? '' : 's') + '</div>' +
            '</div><div class="att-card-tools">' +
              (t.active ? '<span class="att-pill att-pill--done">Active</span>' : '<span class="att-pill att-pill--hidden">Inactive</span>') +
              ' <button class="att-btn" type="button" data-act="edit-team">Rename / deactivate…</button>' +
            '</div></div>' +
            '<div class="att-card-body att-stack">' +
              (t.members.length
                ? '<table class="att-table"><tbody>' + t.members.map(m =>
                    '<tr><td><strong>' + esc(m.name) + '</strong>' +
                      (m.is_leader ? ' <span class="att-pill att-pill--pc">Leader</span>' : '') + '</td>' +
                    '<td>' + (m.role === 'teamLeader' ? 'Team Leader' : 'Worker') + '</td>' +
                    '<td><div class="req-actions">' +
                      (t.active && m.role === 'teamLeader' && !m.is_leader
                        ? '<button class="att-btn" type="button" data-act="lead" data-worker="' + esc(m.worker_id) + '">Make leader</button>' : '') +
                      (t.active && m.is_leader
                        ? '<button class="att-btn" type="button" data-act="unlead">No leader</button>' : '') +
                      '<button class="att-btn att-btn--warn" type="button" data-act="remove" data-worker="' + esc(m.worker_id) + '">Remove</button>' +
                    '</div></td></tr>').join('') + '</tbody></table>'
                : '<div class="att-empty">No members yet.</div>') +
              (t.active ? '<div class="req-actions">' +
                '<select class="att-filter" data-pick aria-label="Add a member"><option value="">Add a member…</option>' +
                  candidates.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) +
                    (p.role === 'teamLeader' ? ' (Team Leader)' : '') + '</option>').join('') +
                '</select>' +
                '<button class="att-btn att-btn--primary" type="button" data-act="add">Add</button>' +
              '</div>' : '') +
            '</div></div>';
    }

    function teamModal(team, rerender) {
        RA.modal({
            title: team ? 'Edit team' : 'New team',
            body:
                '<div class="att-field att-span"><label for="reqTeamName">Team name</label>' +
                  '<input class="att-input" id="reqTeamName" name="name" maxlength="80" value="' + esc(team ? team.name : '') + '" placeholder="e.g. Masonry crew A"></div>' +
                (team ? '<label class="req-toggle att-span"><input type="checkbox" name="active"' + (team.active ? ' checked' : '') + '> Active (can send requests)</label>' : ''),
            submitLabel: team ? 'Save' : 'Create team',
            onSubmit: async (form) => {
                if (!form.name.value.trim()) throw new Error('BAD_TEAM');
                await RA.rpc('pr_office_save_team', {
                    p_team: team ? team.id : null,
                    p_name: form.name.value.trim(),
                    p_active: team ? form.active.checked : true,
                });
            },
            onDone: rerender,
        });
    }

    async function renderTeams(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading teams…</div></div>';
        let teams, people;
        try { [teams, people] = await Promise.all([RA.rpc('pr_office_teams'), RA.rpc('pr_office_people')]); }
        catch (e) { RA.fail(host, e); return; }
        teams = teams || [];
        people = people || [];
        const rerender = () => renderTeams(host);
        host.innerHTML =
            '<div class="att-stack">' +
              head('Teams', 'A team leader can send requests for the whole team. They need the Team Leader role and to be set as this team\'s leader.',
                   '<button class="att-btn att-btn--primary" type="button" data-new-team>New team</button>') +
              (teams.length ? teams.map(t => teamCard(t, people)).join('') : '<div class="att-empty">No teams yet.</div>') +
            '</div>';
        host.querySelector('[data-new-team]').addEventListener('click', () => teamModal(null, rerender));
        host.querySelectorAll('[data-team]').forEach(card => card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const team = teams.find(t => t.id === card.dataset.team);
            const act = b.dataset.act;
            if (act === 'edit-team') { teamModal(team, rerender); return; }
            let call = null;
            if (act === 'add') {
                const pick = card.querySelector('[data-pick]').value;
                if (!pick) return;
                call = ['pr_office_add_member', { p_team: team.id, p_worker: pick }];
            } else if (act === 'remove') {
                const m = team.members.find(x => x.worker_id === b.dataset.worker);
                if (!confirm('Remove ' + (m ? m.name : 'this person') + ' from ' + team.name + '?' +
                    (m && m.is_leader ? ' The team will have no leader.' : ''))) return;
                call = ['pr_office_remove_member', { p_team: team.id, p_worker: b.dataset.worker }];
            } else if (act === 'lead') {
                call = ['pr_office_set_leader', { p_team: team.id, p_worker: b.dataset.worker }];
            } else if (act === 'unlead') {
                call = ['pr_office_set_leader', { p_team: team.id, p_worker: null }];
            }
            if (!call) return;
            b.disabled = true;
            try { await RA.rpc(call[0], call[1]); rerender(); }
            catch (err) { alert(RA.errorMessage(err)); b.disabled = false; }
        }));
        RA.icons();
    }

    // ── Catalogue ───────────────────────────────────────────────────

    const catUi = { text: '', kind: '', showInactive: false };

    function itemModal(item, rerender) {
        const v = item || { kind: 'material', name: '', spec: '', unit: '', category: '', active: true };
        RA.modal({
            title: item ? 'Edit item' : 'New item',
            sub: 'One row = one exact item. A different size or unit is a different item.',
            body:
                '<div class="att-field"><label for="reqKind">Kind</label><select class="att-input" id="reqKind" name="kind">' +
                  '<option value="material"' + (v.kind === 'material' ? ' selected' : '') + '>Material</option>' +
                  '<option value="tool"' + (v.kind === 'tool' ? ' selected' : '') + '>Tool</option></select></div>' +
                '<div class="att-field"><label for="reqCat">Category <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqCat" name="category" maxlength="60" value="' + esc(v.category) + '" placeholder="e.g. plumbing"></div>' +
                '<div class="att-field att-span"><label for="reqName">Name</label>' +
                  '<input class="att-input" id="reqName" name="name" maxlength="120" value="' + esc(v.name) + '" placeholder="e.g. PVC pipe"></div>' +
                '<div class="att-field"><label for="reqSpec">Size / spec <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqSpec" name="spec" maxlength="120" value="' + esc(v.spec) + '" placeholder="e.g. 1/2 in, 3 m"></div>' +
                '<div class="att-field"><label for="reqUnit">Unit</label>' +
                  '<input class="att-input" id="reqUnit" name="unit" maxlength="30" value="' + esc(v.unit) + '" placeholder="e.g. pc, bag, m"></div>' +
                (item ? '<label class="req-toggle att-span"><input type="checkbox" name="active"' + (v.active ? ' checked' : '') + '> Active (workers can pick it)</label>' : ''),
            submitLabel: item ? 'Save' : 'Add item',
            onSubmit: async (form) => {
                await RA.rpc('pr_office_save_item', {
                    p_item: item ? item.id : null,
                    p_kind: form.kind.value,
                    p_name: form.name.value.trim(),
                    p_spec: form.spec.value.trim(),
                    p_unit: form.unit.value.trim(),
                    p_category: form.category.value.trim(),
                    p_active: item ? form.active.checked : true,
                });
            },
            onDone: rerender,
        });
    }

    async function renderCatalog(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the catalogue…</div></div>';
        let items;
        try { items = await RA.rpc('pr_office_catalog'); } catch (e) { RA.fail(host, e); return; }
        items = items || [];
        const rerender = () => renderCatalog(host);
        host.innerHTML =
            '<div class="att-stack">' +
              head('Item catalogue', 'The materials and tools workers pick from. Unlisted items are matched to an entry here from the request screen.',
                   '<button class="att-btn att-btn--primary" type="button" data-new-item>New item</button>') +
              '<div class="att-toolbar">' +
                '<input class="att-search" type="search" data-text placeholder="Search name, size, unit, category…" value="' + esc(catUi.text) + '">' +
                '<select class="att-filter" data-kind aria-label="Kind">' +
                  '<option value="">Materials and tools</option>' +
                  '<option value="material"' + (catUi.kind === 'material' ? ' selected' : '') + '>Materials</option>' +
                  '<option value="tool"' + (catUi.kind === 'tool' ? ' selected' : '') + '>Tools</option></select>' +
                '<label class="req-toggle"><input type="checkbox" data-inactive' + (catUi.showInactive ? ' checked' : '') + '> Show inactive</label>' +
              '</div>' +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<table class="att-table"><thead><tr><th>Kind</th><th>Name</th><th>Size / spec</th><th>Unit</th><th>Category</th><th>Status</th><th></th></tr></thead>' +
                '<tbody data-rows></tbody></table><div class="att-empty" data-empty style="display:none">No item matches.</div>' +
              '</div></div>' +
            '</div>';
        function draw() {
            const t = catUi.text.trim().toLowerCase();
            const list = items.filter(i => (catUi.showInactive || i.active) && (!catUi.kind || i.kind === catUi.kind) &&
                (!t || [i.name, i.spec, i.unit, i.category].join(' ').toLowerCase().includes(t)));
            host.querySelector('[data-rows]').innerHTML = list.map(i =>
                '<tr><td>' + (i.kind === 'tool' ? 'Tool' : 'Material') + '</td><td><strong>' + esc(i.name) + '</strong></td>' +
                '<td>' + esc(i.spec || '—') + '</td><td>' + esc(i.unit) + '</td><td>' + esc(i.category || '—') + '</td>' +
                '<td>' + (i.active ? '<span class="att-pill att-pill--done">Active</span>' : '<span class="att-pill att-pill--hidden">Inactive</span>') + '</td>' +
                '<td><button class="att-btn" type="button" data-edit="' + esc(i.id) + '">Edit…</button></td></tr>').join('');
            host.querySelector('[data-empty]').style.display = list.length ? 'none' : 'block';
        }
        draw();
        host.querySelector('[data-new-item]').addEventListener('click', () => itemModal(null, rerender));
        host.querySelector('[data-text]').addEventListener('input', e => { catUi.text = e.target.value; draw(); });
        host.querySelector('[data-kind]').addEventListener('change', e => { catUi.kind = e.target.value; draw(); });
        host.querySelector('[data-inactive]').addEventListener('change', e => { catUi.showInactive = e.target.checked; draw(); });
        host.querySelector('[data-rows]').addEventListener('click', e => {
            const b = e.target.closest('[data-edit]');
            if (b) itemModal(items.find(i => i.id === b.dataset.edit), rerender);
        });
        RA.icons();
    }

    // ── Projects ────────────────────────────────────────────────────

    function requestableNote(p) {
        if (p.completed) return '<span class="att-pill att-pill--hidden">Completed</span>';
        if (p.requestable) return '<span class="att-pill att-pill--done">Workers can request</span>';
        return '<span class="att-pill att-pill--none">Not open</span>' +
            '<div class="req-muted">' + (p.hidden_from_time_in ? 'Hidden from Time In.' : 'Not on today\'s Time In list.') + ' Turn on Allow requests to open it.</div>';
    }

    async function renderProjects(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading projects…</div></div>';
        let projects;
        try { projects = await RA.rpc('pr_office_projects'); } catch (e) { RA.fail(host, e); return; }
        projects = projects || [];
        host.innerHTML =
            '<div class="att-stack">' +
              head('Projects open to requests', 'A Project Control project accepts requests while it is on today\'s Time In list, or when Allow requests is on — use that for an upcoming site with no geofence yet. Completed projects never accept requests. Open Additional Works under a project are offered with it.') +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<table class="att-table"><thead><tr><th>Project</th><th>Additional Works</th><th>Requests</th><th>Allow requests</th></tr></thead><tbody>' +
                projects.map(p =>
                    '<tr><td><strong>' + esc(p.name) + '</strong></td>' +
                    '<td>' + esc(String(p.additional_works)) + ' open</td>' +
                    '<td>' + requestableNote(p) + '</td>' +
                    '<td><label class="req-toggle"><input type="checkbox" data-folder="' + esc(p.folder_id) + '"' +
                      (p.allow_requests ? ' checked' : '') + (p.completed ? ' disabled' : '') + '> ' +
                      (p.allow_requests ? 'On' : 'Off') + '</label></td></tr>').join('') +
                '</tbody></table>' +
                (projects.length ? '' : '<div class="att-empty">No Project Control projects yet.</div>') +
              '</div></div>' +
            '</div>';
        host.querySelectorAll('input[data-folder]').forEach(box => box.addEventListener('change', async () => {
            box.disabled = true;
            try {
                await RA.rpc('pr_office_set_allow_requests', { p_folder: box.dataset.folder, p_allow: box.checked });
                renderProjects(host);
            } catch (err) {
                alert(RA.errorMessage(err));
                box.checked = !box.checked;
                box.disabled = false;
            }
        }));
        RA.icons();
    }

    RA.views.reqBatches = renderBatches;
    RA.views.reqTeams = renderTeams;
    RA.views.reqCatalog = renderCatalog;
    RA.views.reqProjects = renderProjects;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Script tag** — in `admin.html`, after `<script src="js/requests-admin-detail.js"></script>` add `<script src="js/requests-admin-setup.js"></script>`.

- [ ] **Step 3: Check** — `node --check js/requests-admin-setup.js`; `npm test` → exit 0.

- [ ] **Step 4: Stop — no commit.**

---
### Task 7: Refuse deleting a project that has requests; workers off the web portal; docs

**Files:**
- Modify: `js/expenses-module.js` — `async function deleteFolder(id)`
- Modify: `js/portal-app.compiled.js` — `const deleteChild = async (child) => {` (edit **directly**; never `npm run build`)
- Modify: `js/admin.js` — `ADMIN_ROLES` and the role-rejection message in `checkAuthState()`
- Modify: `tests/workmate-requests-office.test.js` — three source guards (append before the `// ── SUMMARY` block)
- Modify: `docs/ARCHITECTURE.md` — §4 Module map: one row for Requests

**Interfaces:**
- Consumes: RPC `pr_folder_request_count(p_folder uuid) → integer` (Task 1); `window.sbClient`; existing `showExpNotif(msg, kind)` in expenses-module.js.
- Produces: nothing new for other tasks.

Why: `pr_requests.folder_id` / `work_folder_id` reference `folders(id)` with no cascade (0085 keeps request history). Today `deleteFolder` deletes every billing period's expenses and payroll **first** and the folder **last** — with requests present the last step fails on the foreign key and leaves a half-deleted project. The check must run **before the confirm and before any delete**, and if the check itself fails (network, 0086 missing) nothing is deleted. Additional Works (`deleteChild`) gets the same check. A project with requests is **completed**, not deleted (0064).

Workers and team leaders: their old web screens (Construction → Current Batch / Urgent / History) write the legacy `requests` tables, which 0085 made read-only history — so those screens no longer work for them anyway. They use the phone apps. Owner and staff are the only roles that may sign in to `admin.html`. (The worker branches left in `admin.js`/`admin.html` become unreachable; leave them — removing them is not needed for this change.)

- [ ] **Step 1: Write the failing source guards** — in `tests/workmate-requests-office.test.js`, add before `// ── SUMMARY (keep last) ──`:

```js
// ── Dacs Web call sites (Task 7) ──
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
function bodyFrom(src, start) {
  const i = src.indexOf(start);
  if (i < 0) return '';
  return src.slice(i, i + 4000);
}

test('deleteFolder asks pr_folder_request_count before confirming or deleting anything', () => {
  const b = bodyFrom(read('js/expenses-module.js'), 'async function deleteFolder(id)');
  assert(b, 'deleteFolder not found');
  const check = b.indexOf("rpc('pr_folder_request_count'");
  assert(check > 0, 'no request-count check');
  assert(check < b.indexOf('showDeleteConfirm('), 'the check must come before the confirm');
  assert(check < b.indexOf('.delete('), 'the check must come before any delete');
  assert(/catch \(err\) \{\s*showExpNotif\([^;]*nothing was deleted[^;]*\);\s*return;/.test(b), 'a failed check must stop the delete');
});

test('Additional Works deleteChild asks pr_folder_request_count first', () => {
  const b = bodyFrom(read('js/portal-app.compiled.js'), 'const deleteChild = async (child) => {');
  assert(b, 'deleteChild not found');
  const check = b.indexOf('rpc("pr_folder_request_count"');
  assert(check > 0, 'no request-count check');
  assert(check < b.indexOf('confirm('), 'the check must come before the confirm');
  assert(check < b.indexOf('.delete('), 'the check must come before the delete');
  assert(/nothing was deleted/.test(b.slice(0, b.indexOf('confirm('))), 'a failed check must stop the delete');
});

test('only owner and staff may sign in to the web portal', () => {
  const src = read('js/admin.js');
  assert(/const ADMIN_ROLES = \['owner', 'staff'\];/.test(src), 'ADMIN_ROLES must be exactly owner and staff');
  assert(/use the DACS app on their phone/.test(src), 'workers get a message pointing them to the app');
});
```

- [ ] **Step 2: Run to verify they fail** — `node tests/workmate-requests-office.test.js` → the three new tests FAIL (exit 1).

- [ ] **Step 3: Guard `deleteFolder`** — in `js/expenses-module.js`, inside `async function deleteFolder(id) {`, insert directly after the line `const folder = expFolders.find(f => f.id === id);`:

```js
    // WorkMate requests (0085) keep their project as history, so a project
    // with requests is completed, never deleted. Checked BEFORE the confirm
    // and before anything is removed: the loop below deletes expenses and
    // payroll first, and only then would the folder delete fail on the
    // requests' foreign key — leaving the project half-deleted.
    try {
        const { data: reqCount, error: reqErr } = await window.sbClient.rpc('pr_folder_request_count', { p_folder: id });
        if (reqErr) throw reqErr;
        if (reqCount > 0) {
            showExpNotif(`"${folder?.name}" has ${reqCount} WorkMate request(s), so it cannot be deleted. Mark the project completed instead.`, 'error');
            return;
        }
    } catch (err) {
        showExpNotif('Could not check this project for WorkMate requests, so nothing was deleted. ' + (err.message || err), 'error');
        return;
    }
```

- [ ] **Step 4: Guard `deleteChild`** — in `js/portal-app.compiled.js`, replace the first line of the function body. Find:

```js
  const deleteChild = async (child) => {
    if (!confirm(
```

  and insert the check between those two lines so it reads:

```js
  const deleteChild = async (child) => {
    // WorkMate requests (0085) keep their Additional Works job as history:
    // refuse before the confirm, never after a half-delete. A failed check
    // deletes nothing.
    try {
      const { data: reqCount, error: reqErr } = await window.sbClient.rpc("pr_folder_request_count", { p_folder: child.id });
      if (reqErr) throw reqErr;
      if (reqCount > 0) {
        alert(`"${child.name}" has ${reqCount} WorkMate request(s), so it cannot be deleted. Mark it completed instead.`);
        return;
      }
    } catch (err) {
      alert("Could not check for WorkMate requests, so nothing was deleted: " + (err.message || err));
      return;
    }
    if (!confirm(
```

  (The rest of the `confirm(...)` line and the function are unchanged.)

- [ ] **Step 5: Owner and staff only** — in `js/admin.js` replace

```js
// Roles that are allowed to access the admin dashboard
const ADMIN_ROLES = ['owner', 'staff', 'worker', 'teamLeader'];
```

  with

```js
// Roles that are allowed to access the admin dashboard. Workers and team
// leaders use the phone apps (DACS Attendance / DAC'S WorkMate): their old
// Construction screens here write the legacy requests tables, which 0085
// made read-only history.
const ADMIN_ROLES = ['owner', 'staff'];
```

  and in `checkAuthState()` replace

```js
                    showLoginError('Access denied. This account does not have admin privileges.');
```

  with

```js
                    showLoginError(currentUserRole === 'worker' || currentUserRole === 'teamLeader'
                        ? 'Workers and team leaders use the DACS app on their phone. This portal is for the office.'
                        : 'Access denied. This account does not have admin privileges.');
```

  (Only the occurrence inside the `if (!ADMIN_ROLES.includes(currentUserRole))` block. Check with `grep -n "does not have admin privileges" js/admin.js` that there is exactly one before editing.)

- [ ] **Step 6: Architecture doc** — in `docs/ARCHITECTURE.md` §4 Module map, add a row after the Attendance row (same table format):

```markdown
| Requests | `requests-admin-core.js`, `requests-admin-queue.js`, `requests-admin-detail.js`, `requests-admin-setup.js` | The office half of **DAC'S WorkMate Requests** (`0085` tables, `0086` office RPCs). Workers and team leaders request materials and tools in the phone app; owner and staff process them here: the **queue** (urgent first, then by weekly batch — Saturday 12:00 noon Manila cutoff), one request's **detail** (mark portions arranged, move an unarranged portion to another batch, resolve a worker's reduction of arranged quantity as *order reduced* or *kept as surplus*, change or cancel an item with a reason, resolve an offline-edit conflict, match an unlisted item to the catalogue, private photos via signed URLs, full history), **weekly batches** (only purchasing/delivery dates change), **teams** (a leader needs the Team Leader role *and* the assignment), the **catalogue** (deactivate, never delete) and **projects** (*Allow requests*). **Every write is an RPC** — the browser holds no write policy. **No money anywhere**: quantities only, so staff see all of it. A project or Additional Works job with requests **cannot be deleted** (`deleteFolder` / `deleteChild` ask `pr_folder_request_count` first) — complete it instead. Pure helpers are guarded by `tests/requests-admin.test.js`; the migration by `tests/workmate-requests-office.test.js`. Workers and team leaders can no longer sign in to this portal (`ADMIN_ROLES`) |
```

- [ ] **Step 7: Run** — `node tests/workmate-requests-office.test.js` → `19 passed, 0 failed`; `node --check js/expenses-module.js js/portal-app.compiled.js js/admin.js` (one file per call on older Node); `npm test` → exit 0 (the money suite reads `portal-app.compiled.js` — it must stay green).

- [ ] **Step 8: Stop — no commit.**

---

### Task 8: Apply 0086 live and check it in the browser (controller + user)

**Not for a subagent.** The controller prepares the files; the **user** runs SQL in the Supabase SQL editor (MCP DDL calls are declined in this setup).

- [ ] **Step 1: Dry-run file** — the controller writes `<scratchpad>/0086_dry_run.sql` = `begin;` + the full text of `supabase/migrations/0086_workmate_requests_office.sql` + the full text of `supabase/tests/0086_verify.sql` (its own `begin;` only warns; its final `rollback;` undoes the migration too). The user runs it; expected last row: `pr office verify: all checks passed`. A failure names its check — fix the migration or the check, re-run `npm test`, rebuild the file, repeat.
- [ ] **Step 2: Apply** — the user runs `supabase/migrations/0086_workmate_requests_office.sql` in the SQL editor.
- [ ] **Step 3: Confirm it is live** (read-only MCP query; the user's "done" has not always matched the live DB):

```sql
select count(*) filter (where proname like 'pr_office_%') as office_rpcs,
       count(*) filter (where proname = 'pr_folder_request_count') as guard,
       (select count(*) from pg_policies where tablename = 'pr_batches' and cmd in ('INSERT', 'UPDATE')) as batch_write_policies
  from pg_proc where pronamespace = 'public'::regnamespace;
```

  Expected: `office_rpcs = 21`, `guard = 1`, `batch_write_policies = 0`.
- [ ] **Step 4: Browser check** (user, logged in as owner on `admin.html`; then once as staff):
  1. A **Requests** tab appears after Attendance with Queue · Weekly batches · Teams · Catalogue · Projects.
  2. **Projects**: turn *Allow requests* on for a test project → pill shows "Workers can request".
  3. **Catalogue**: add `ZZ test pipe | 1/2 in | pc`; adding it again shows the duplicate message; edit → deactivate works.
  4. **Teams**: create a team, add W-0007 and W-0021, make W-0021 leader; "Make leader" is not offered for W-0007.
  5. **Weekly batches**: this week and the next two exist; change next week's delivery date; a delivery before purchasing is refused.
  6. **Queue and detail** need a real request, and WorkMate cannot send one until 1a-3. The dry run (Step 1) already exercised every queue/detail RPC. For a click-through now, the controller **asks the user first** (it writes real rows to live tables) and, only on an explicit yes, gives a SQL-editor script that submits one `ZZ test` request as W-0007 for the test project (via `set local role authenticated` + `request.jwt.claims`, then `commit`). The user then checks: the request shows in the queue (urgent ones on top), opening it shows the lines; Mark arranged / Undo, Move…, Change quantity…, Cancel item…, Match work and each writes a History line. Otherwise this check moves to the 1a-4 pilot.
  7. Project Control: deleting a test project that has a request shows "…cannot be deleted. Mark the project completed instead." and deletes nothing.
  8. Log in as a **worker** account on `admin.html` → "Workers and team leaders use the DACS app on their phone…".
  9. As **staff**: the Requests tab is visible and works; no peso amounts appear anywhere in it.
- [ ] **Step 5: Record** — update `docs/superpowers/plans/2026-10-02-workmate-stage1a-roadmap.md` (row 1a-2: "done YYYY-MM-DD, 0086 live"), the memory file `workmate-requests-0085.md`, and add an "Execution notes" section to this plan (carry-overs for 1a-3). No commit — the user commits.

---

## Execution notes (2026-10-05)

Executed subagent-driven; every task reviewed, plus a final whole-change review. **0086 dry run passed and was applied live 2026-10-05 13:01**; live check: 21 `pr_office_%` functions, `pr_folder_request_count` + 2 internals, **0** insert/update policies on `pr_batches` and the four setup tables, 5 read policies kept, grants as designed.

**The shipped code differs from the task text above in these ways (the code is authoritative):**
- `pr_office_queue`: 'open' = an open line **or** a pending reduction **or** an unresolved conflict (a cancelled request with an order still to undo stays open); inside the 300-row cap, needs-action requests sort first; the queue screen says when the cap is hit.
- `pr_office_cancel_line` locks the request before the line (same order as 0085 `pr_cancel_request`) and writes a `request_cancelled` event (`detail.by = 'office'`) when it closes the request.
- 0086 also drops 0085's direct insert/update policies on `pr_teams`, `pr_team_members`, `pr_catalog_items`, `pr_project_settings` (they checked only the new row's owner, not what it pointed at).
- `requestSummary` counts cancelled lines with a pending reduction for batch and cutoff.
- Every Requests table sits in `.req-table-wrap` (scrolls on phones).
- Match modal refuses Save with nothing selected (a search could otherwise silently unmatch).
- Additional Works delete message: "…cannot be deleted — the requests keep it as their history." (AW cards have no Complete action.)
- Verify script: §3 assert moved to §4 (RLS hides portions from workers), robust direct-update check, same-owner assert, §6 order, §10 setup-table policy assert. Static tests: 21 (office) and 17 (requests-admin).

**Carry-overs:**
- **1a-3:** chain base versions for queued edits; never reuse an op id; the worker's `pr_cancel_line` never closes the request while the office cancel does — align.
- **Before Stage 2:** refuse changing kind/identity of a catalogue item already matched to lines.
- **Polish (deferred):** render race on quick re-navigation; modal focus handling and stale-close edge case; photos fetched one by one and not keyboard-accessible; inactive team still shows Remove; "Rename / deactivate…" label on inactive teams; verify script lacks move-merge and cross-company-id cases.
- **Deploy order:** 0086 is live, so the JS can ship; deletes are refused only if `pr_folder_request_count` cannot be reached.
- **After browser testing (2026-10-05):** search boxes use `.att-search-wrap` (border + icon); `.att-toolbar .req-toggle` keeps checkbox labels in normal case; Teams shows the W-number (`RequestsAdmin.workerNo`, tested) in the member picker and member rows. Browser check passed as owner, staff, and a worker (refused at sign-in).
