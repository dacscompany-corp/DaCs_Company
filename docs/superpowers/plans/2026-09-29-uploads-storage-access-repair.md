# Uploads Storage Access Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop anyone who is not entitled to a file from listing, downloading or uploading it in the `uploads` storage bucket, while every legitimate reader (owner, staff, construction clients, partners, design clients) keeps working exactly as today.

**Architecture:** One migration (`0081`) replaces the five catch-all `uploads` policies with three scoped ones. The access decision lives in two small SQL functions, `uploads_can_read(name, owner_id)` and `uploads_can_write(name)`, keyed on the object's **top folder** (for example `weeklyBillReceipts`), the **project id in the second path segment** where there is one, and the **uploader** (`storage.objects.owner_id`). They reuse the helpers the live tables already use (`is_owner`, `is_staff`, `is_worker`, `cproj_client_can_read`, `cproj_partner_can_read`), so a file follows the same rule as the database row it belongs to. **No JavaScript changes.** The shim already signs every read as the logged-in user, which is exactly what the new rules check.

**Tech Stack:** Supabase Postgres RLS on `storage.objects`; plain Node (built-ins only) for the CI guard; a rolled-back SQL script for the live check.

**Spec:** [docs/superpowers/specs/2026-09-29-unified-worker-app-design.md](../specs/2026-09-29-unified-worker-app-design.md), §1 "Before the pilot: document-storage repair", §9 acceptance line "Before Stage 1a ships, document-storage checks deny unauthorized file access…".

## Global Constraints

- Preserve authorized clients' and partners' access to their own project documents, and staff's agreed encoding access (spec §1).
- The storage repair must still preserve authorized PM client/partner document access because existing PM operations remain in use outside this app (spec §10).
- Repair through migrations; verify live policies; test allowed/denied access by role and project (spec §1).
- **Migration number: `0081`.** The highest on disk is `0080`. Never reuse a number, and never make a SQL-editor-only change (CLAUDE.md §Verifying).
- **Never run `npm run build`** (CLAUDE.md hard rule).
- **The user commits manually.** Every "Checkpoint" step means stop and hand over; never run `git commit` or `git push` yourself.
- Applying the migration to production is a hard-to-reverse, outward-facing action: **get the user's explicit go-ahead in the same session before Task 4**, and have the rollback file ready.
- `quotations` (0045) and `reimbursements` (0041) are **owner-only** (CLAUDE.md money invariants). Their storage folders follow the same rule.

## Why this is needed (evidence, 2026-09-29)

Verified against the live project `hqbgduyonlbbsvjuapre`:

| Policy on `storage.objects` | Command | Granted to | Rule | Where it came from |
|---|---|---|---|---|
| `uploads_read` | SELECT | **public** (includes not-logged-in) | `bucket_id = 'uploads'` | **No migration** (hand-made drift) |
| `uploads_insert` | INSERT | **public** | `bucket_id = 'uploads'` | **No migration** (hand-made drift) |
| `uploads_auth_select` | SELECT | authenticated | `bucket_id = 'uploads'` | 0027 |
| `uploads_auth_insert` | INSERT | authenticated | `bucket_id = 'uploads'` | 0027 |
| `uploads_admin_update` | UPDATE | authenticated | owner or staff | 0032 |

- A read-only query run **as the `anon` role** (not logged in) listed **all 745 files**.
- The same query run **as a real worker account** also listed all 745.
- The `attendance` bucket (per-worker photo folders) and the `app-releases` bucket (public on purpose so phones can download app updates, 0079) are **out of scope**. Both were checked and are correct.
- **Migration 0019's partner "signed agreement" gate is NOT live.** `caller_is_partner()` and `partner_signed_project()` don't exist in the database, and `weekly_bills` has only `_admin`, `_client_read` and `_partner_read` policies. This matches the owner's 2026-07-03 decision that partners sign only the first-login Partnership Agreement and the per-project sign-off is legacy. **The storage rules must not reference those functions.** They would fail at runtime, and they would be stricter than the tables the portal reads.

### Pre-validated (2026-09-29, no production change)

The read and write rules below were loaded as **temporary session-only functions** (`pg_temp`, rolled back) and evaluated for one real account per role against the live files. They agreed exactly with the independent expectation in Task 2:

| Role | Files visible today | Visible after 0081 | Sample upload check |
|---|---|---|---|
| Main owner | 745 | **745** | quotation file → allowed |
| Sub-owner (admin-pm@) | 745 | **745** | — |
| Staff | 745 | **682** (all but 55 quotation + 8 reimbursement files) | quotation file → refused |
| Worker, team leader | 745 | **1** (the employee agreement PDF) | own employee signature and signed-terms copy → allowed; client-style signature, Expense Inbox → refused |
| Construction client | 745 | **209** (their projects' receipts + terms, templates, own uploads) | receipt to own project → allowed |
| Partner | 745 | **209** | — |
| Design client | 745 | **2** (agreement templates) | — |
| Not logged in | 745 | **0** | — |

Counts will drift as files are added; the Task 2 script compares against a live expectation, not these numbers.

## Access map: every folder in `uploads`

Every upload site was traced (`grep -rn "storage.ref(" js share-capture.html`, plus the `store:`/`contracts:` config in `expenses-module.js`). Every file URL stored in client-readable tables was checked live. **All client-visible PM receipts (174) are under `weeklyBillReceipts/<project>/`**, and every `weeklyBillReceipts` and `projectTerms` path's second segment is a real `construction_projects.id`. Every live object has `owner_id` set (none null).

| Top folder | Who uploads | Who may READ after the repair | Who may UPLOAD |
|---|---|---|---|
| `expenseInbox` | owner/staff (share-capture.html) | owner, staff | owner, staff |
| `overheadReceipts` | owner/staff | owner, staff | owner, staff |
| `workerAgreements`, `outsourceAgreements` | owner/staff | owner, staff | owner, staff |
| `laborContractFiles`, `outsourceContractFiles` | owner/staff | owner, staff | owner, staff |
| `workerAgreementGlobal`, `outsourceAgreementGlobal` | owner/staff | owner, staff | owner, staff |
| `employeeTermsGlobal` | owner/staff | owner, staff, **workers and team leaders** (first-login employee agreement in `admin.html`) | owner, staff |
| `quotations` | owner | **owner only** | owner only |
| `reimbursementReceipts` | owner | **owner only** | owner only |
| `weeklyBillReceipts/<pm project>/…` | owner/staff | owner, staff, **that project's client and partner** (same test as the `weekly_bills` `_client_read` / `_partner_read` policies) | owner, staff |
| `procurementReceipts/<pm project>/…` | owner/staff, **client** | as `weeklyBillReceipts` | owner, staff, **that project's client** |
| `accomplishmentReports/<pm project>/…` | owner/staff | as `weeklyBillReceipts` | owner, staff |
| `projectTerms/<pm project>/…` | owner/staff | as `weeklyBillReceipts` | owner, staff |
| `agreementDocs/…` | owner/staff | everyone logged in **except workers** (templates shown at the client/partner signing gates) | owner, staff |
| `signatures/…` | owner/staff, **client, partner** | owner, staff, **the uploader** | owner, staff; a client/partner writing `<own uid>_<ts>.png` or `proj_<project>_<own uid>_<ts>.png`; a worker/team leader writing only `employee_<own uid>_<ts>.png` |
| `signed-terms/<uid>/…` | owner/staff, **client, partner** | owner, staff, **the uploader** | owner, staff, anyone writing under **their own** `<uid>` folder (every signing gate snapshots here) |
| anything else | nobody today | owner, staff | owner, staff |

Two rules apply on top of the table:
- **The uploader can always read back their own file** (`owner_id = auth.uid()`). The shim uploads with `upsert: true` and then signs reads as the same user, so this keeps every upload flow working.
- **Workers and team leaders get only the employee agreement.** `js/admin.js` sends every non-owner role through a first-login employee agreement in `admin.html`: read `employeeTermsGlobal/`, upload `signatures/employee_<own uid>_…` and `signed-terms/<own uid>/…`. Nothing else: their Attendance app uses the separate `attendance` bucket. (Found in Task 3 review, 2026-09-29; 13 workers + 2 team leaders had not passed that gate yet.)
- **Role checks are NULL-safe** (`coalesce(is_worker(), false)`): a profile with no role is not denied the agreement templates.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `tests/storage-access.test.js` | Create | CI guard. Reads the migration and rollback **text** and every upload site in `js/` and `share-capture.html`. Fails if a policy is ever granted to public/anon, or if a new upload folder appears that the access map doesn't classify |
| `package.json` | Modify (`scripts.test`) | Add the new suite to `npm test` (CI runs `npm test`) |
| `supabase/tests/uploads_access.sql` | Create | Live check against the real database, always rolled back. Impersonates each role and compares what it can see and upload with an independently written expectation |
| `supabase/migrations/0081_uploads_access_repair.sql` | Create | The fix: two functions, drop five policies, create three |
| `supabase/rollback_0081_uploads_access.sql` | Create | Emergency undo **without** re-opening public access |
| `docs/ARCHITECTURE.md` | Modify (§8 "Storage is PRIVATE") | Describe the access map |
| `docs/DATABASE_SCHEMA.md` | Modify (top banner area) | Short "Storage access" section pointing at 0081 |
| `supabase/migrations/README.md` | Modify (Status ledger) | Record 0081 and the drift it removed |
| `CLAUDE.md` | Modify (Finishing a change) | New rule: a new upload folder needs an access-map entry |

---

### Task 1: CI guard for the storage access rules

**Files:**
- Create: `tests/storage-access.test.js`
- Modify: `package.json` (the `"test"` script)

**Interfaces:**
- Consumes: nothing (reads files as text).
- Produces: the folder classification `FOLDERS` (the single written copy of the access map, used only by this test) and the file paths `supabase/migrations/0081_uploads_access_repair.sql` and `supabase/rollback_0081_uploads_access.sql`, which Task 3 creates.

- [ ] **Step 1: Write the failing test**

Create `tests/storage-access.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// STORAGE ACCESS TESTS: run with  node tests/storage-access.test.js
//
// Zero dependencies. Guards migration 0081 (uploads bucket access):
//   I.   The policies: nothing granted to public/anon, the five catch-all
//        policies dropped, the scoped ones created "to authenticated".
//   II.  The rules: owner-only folders, the client/partner project folders,
//        uploader-reads-own, workers limited to the employee agreement.
//   III. Fan-out: every folder the app uploads to is classified below.
//        A new storage.ref('newFolder/…') without an access decision fails
//        here, because otherwise only owner/staff could read it and a
//        client-facing feature would break silently.
//   IV.  The rollback never re-opens public access.
//
// The LIVE behaviour is checked by supabase/tests/uploads_access.sql.
// Reads every migration from 0081 on — the LAST definition of each rule function is the live one.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/0081_uploads_access_repair.sql');
const ROLLBACK  = path.join(ROOT, 'supabase/rollback_0081_uploads_access.sql');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }
function read(p) {
  if (!fs.existsSync(p)) throw new Error('missing file: ' + path.relative(ROOT, p));
  return fs.readFileSync(p, 'utf8');
}
// SQL with -- comments removed, so a comment can't satisfy (or fail) a check.
function code(sql) { return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'); }

const MIG_DIR = path.join(ROOT, 'supabase/migrations');
// Every migration from 0081 on, in filename order, comments stripped.
// Later files may redefine the rules; CLAUDE.md sends new folder rules to a NEW migration.
function laterMigrations() {
  return fs.readdirSync(MIG_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) >= '0081')
    .sort()
    .map((f) => ({ file: f, sql: code(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')) }));
}
// All of them concatenated (for "is X named / granted anywhere" checks).
function allRules() {
  read(MIGRATION); // throws "missing file" if 0081 is absent
  return laterMigrations().map((m) => m.sql).join('\n');
}
// The LAST definition of a function across 0081+ — that is what is live.
function lastFn(name) {
  const re = new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\nend \\$\\$;', 'g');
  let hit = null;
  for (const m of laterMigrations()) for (const x of m.sql.matchAll(re)) hit = x[0];
  if (!hit) throw new Error('no definition of public.' + name + ' in migrations 0081+');
  return hit;
}

// The access map (plan: docs/superpowers/plans/2026-09-29-uploads-storage-access-repair.md).
const FOLDERS = {
  expenseInbox: 'admin', overheadReceipts: 'admin',
  workerAgreements: 'admin', outsourceAgreements: 'admin',
  laborContractFiles: 'admin', outsourceContractFiles: 'admin',
  employeeTermsGlobal: 'employeeTerms', workerAgreementGlobal: 'admin', outsourceAgreementGlobal: 'admin',
  quotations: 'ownerOnly', reimbursementReceipts: 'ownerOnly',
  weeklyBillReceipts: 'clientProject', procurementReceipts: 'clientProject', accomplishmentReports: 'clientProject',
  projectTerms: 'clientProject',
  agreementDocs: 'template',
  signatures: 'uploaderOwn', 'signed-terms': 'uploaderOwn',
};
const OWNER_ONLY_SQL = "('quotations', 'reimbursementReceipts')";
const CLIENT_PROJECT_SQL = "('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms')";

console.log('\nI. Policies');
test('migration file exists', () => read(MIGRATION));
test('drops all five catch-all policies', () => {
  const sql = code(read(MIGRATION));
  for (const p of ['uploads_read', 'uploads_insert', 'uploads_auth_select', 'uploads_auth_insert', 'uploads_admin_update']) {
    ok(new RegExp('drop policy if exists "' + p + '"\\s+on storage\\.objects').test(sql), 'no drop for ' + p);
  }
});
test('nothing is granted to public or anon', () => {
  for (const m of laterMigrations()) {
    const lower = m.sql.toLowerCase();
    ok(!/\bto\s+(public|anon)\b/.test(lower), m.file + ': found a policy "to public" / "to anon"');
    ok(!/\bfor\s+all\b/.test(lower), m.file + ': found a "for all" policy');
    for (const s of m.sql.match(/create policy[\s\S]*?;/g) || []) if (/on storage\.objects/.test(s)) ok(/\bto authenticated\b/.test(s), m.file + ': storage policy without "to authenticated"');
  }
});
test('rule functions are not executable by anon', () => {
  const sql = allRules();
  for (const f of ['dacs_try_uuid(text)', 'uploads_can_read(text, text)', 'uploads_can_write(text)']) {
    ok(sql.includes('revoke all on function public.' + f + ' from anon;'), 'missing anon revoke for ' + f);
  }
});
test('scoped SELECT policy checks the read rule with owner_id', () => {
  const sql = allRules();
  ok(/create policy "uploads_select_scoped" on storage\.objects\s+for select to authenticated\s+using \(bucket_id = 'uploads' and public\.uploads_can_read\(name, owner_id\)\)/.test(sql),
    'uploads_select_scoped missing or reshaped');
});
test('scoped INSERT policy checks the write rule', () => {
  const sql = allRules();
  ok(/create policy "uploads_insert_scoped" on storage\.objects\s+for insert to authenticated\s+with check \(bucket_id = 'uploads' and public\.uploads_can_write\(name\)\)/.test(sql),
    'uploads_insert_scoped missing or reshaped');
});
test('UPDATE (overwrite) stays owner/staff, owner-only folders owner only', () => {
  const sql = allRules();
  ok(/create policy "uploads_admin_update" on storage\.objects\s+for update to authenticated/.test(sql), 'uploads_admin_update missing');
  const upd = sql.slice(sql.indexOf('create policy "uploads_admin_update"'));
  ok(upd.includes(OWNER_ONLY_SQL) && upd.includes('then is_owner()') && upd.includes('(is_owner() or is_staff())'),
    'update policy does not separate owner-only folders');
});

console.log('\nII. Rules');
test('owner-only folders are owner-only in BOTH functions', () => {
  ok(lastFn('uploads_can_read').includes("v_folder in " + OWNER_ONLY_SQL + " then return is_owner()"),
    'uploads_can_read: owner-only check missing');
  ok(lastFn('uploads_can_write').includes("v_folder in " + OWNER_ONLY_SQL + " then return is_owner()"),
    'uploads_can_write: owner-only check missing');
});
test('client/partner project folders use the project id and the live membership test', () => {
  const sql = lastFn('uploads_can_read');
  ok(sql.includes('v_folder in ' + CLIENT_PROJECT_SQL), 'client project folder list changed');
  ok(sql.includes('cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid)'), 'client/partner membership check missing');
});
test('does not call the 0019 partner-gate functions (not live; owner decision 2026-07-03)', () => {
  const r = lastFn('uploads_can_read');
  const w = lastFn('uploads_can_write');
  ok(!r.includes('caller_is_partner') && !r.includes('partner_signed_project'),
    'caller_is_partner / partner_signed_project do not exist in the live DB — the read policy would error');
  ok(!w.includes('caller_is_partner') && !w.includes('partner_signed_project'),
    'caller_is_partner / partner_signed_project do not exist in the live DB — the write policy would error');
});
test('the uploader can always read their own file', () => {
  ok(lastFn('uploads_can_read').includes('p_owner_id = v_uid::text then return true'), 'owner_id read-back rule missing');
});
test('workers/team leaders: employee agreement only, NULL-safe role checks', () => {
  const r = lastFn('uploads_can_read');
  ok(r.includes("v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false)"), 'employee terms read rule missing');
  ok(r.includes("v_folder = 'agreementDocs' then return not coalesce(is_worker(), false)"), 'agreementDocs read rule changed (must be NULL-safe)');
  const w = lastFn('uploads_can_write');
  ok(w.includes("'^signatures/employee_' || v_uid::text || '_[0-9]+\\.png$'"), 'worker employee-signature rule missing');
  const exit = w.indexOf('if coalesce(is_worker(), false) then return false; end if;');
  ok(exit !== -1, 'write rule does not exclude workers');
  ok(w.indexOf("v_folder = 'signatures'") < exit && w.indexOf("v_folder = 'signed-terms'") < exit,
    'the worker exit must come after the signature / signed-terms rules');
  ok(w.indexOf("v_folder = 'procurementReceipts'") > exit, 'procurement uploads must stay closed to workers');
});
test('client uploads are limited to their own signature / signed-terms / project receipts', () => {
  const sql = lastFn('uploads_can_write');
  ok(sql.includes("'^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\\.png$'"), 'signature path rule changed');
  ok(sql.includes("v_folder = 'signed-terms'  then return v_seg2 = v_uid::text"), 'signed-terms rule changed');
  ok(sql.includes("v_folder = 'procurementReceipts'"), 'procurement receipt upload rule missing');
});

console.log('\nIII. Every upload folder is classified');
function uploadFolders() {
  const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'js', f));
  files.push(path.join(ROOT, 'share-capture.html'));
  const found = new Map(); // folder → first file seen
  const patterns = [
    /storage\.ref\(\s*[`'"]([A-Za-z][\w-]*)\//g,          // storage.ref('folder/…')
    /const path\s*=\s*[`'"]([A-Za-z][\w-]*)\//g,           // const path = `folder/…`
    /\b(?:store|contracts):\s*'([A-Za-z][\w-]*)'/g,        // expenses-module agreement config
  ];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of patterns) for (const m of src.matchAll(re)) {
      if (!found.has(m[1])) found.set(m[1], path.relative(ROOT, f));
    }
  }
  return found;
}
test('every folder the app uploads to has an access decision', () => {
  const unknown = [...uploadFolders()].filter(([folder]) => !(folder in FOLDERS));
  ok(unknown.length === 0, 'unclassified upload folder(s): ' +
    unknown.map(([f, file]) => f + ' (' + file + ')').join(', ') +
    ' — add it to FOLDERS here AND decide its rule in uploads_can_read/uploads_can_write (new migration)');
});
test('the scan still finds the known upload sites (guards against a silent regex miss)', () => {
  const found = uploadFolders();
  for (const f of ['expenseInbox', 'weeklyBillReceipts', 'procurementReceipts', 'signatures', 'signed-terms',
                   'quotations', 'reimbursementReceipts', 'workerAgreementGlobal', 'workerAgreements']) {
    ok(found.has(f), 'scan no longer sees uploads to ' + f);
  }
});
test('every client-facing folder in the map is named in the migration', () => {
  const sql = allRules();
  for (const [folder, cls] of Object.entries(FOLDERS)) {
    if (cls === 'admin' || cls === 'uploaderOwn') continue;
    ok(sql.includes("'" + folder + "'"), folder + ' (' + cls + ') is not handled in any migration from 0081 on');
  }
});

console.log('\nIV. Rollback');
test('rollback exists and never re-opens public/anon access', () => {
  const sql = code(read(ROLLBACK)).toLowerCase();
  ok(!/\bto\s+(public|anon)\b/.test(sql), 'rollback grants public/anon access');
  ok(sql.includes('drop policy if exists "uploads_select_scoped"'), 'rollback does not remove the scoped select policy');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Add it to `npm test`**

In `package.json`, append the new suite to the end of the `"test"` script so it reads (one line):

```json
"test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js",
```

- [ ] **Step 3: Run it to verify it fails for the right reason**

Run: `node tests/storage-access.test.js`
Expected: exit code 1, `2 passed, 15 failed`. Sections I, II, the third Section III test and Section IV FAIL with `missing file: …0081_uploads_access_repair.sql` / `…rollback_0081_uploads_access.sql`. The **two scan tests PASS** (every current upload folder is already in `FOLDERS`; verified 2026-09-29: 18 folders found, all classified). If a scan test fails, a folder was missed: add it to `FOLDERS` with its class from the access map before continuing.

- [ ] **Step 4: Syntax check**

Run: `node --check tests/storage-access.test.js`
Expected: no output, exit 0.

- [ ] **Step 5: Checkpoint (user commits)**

Stop and tell the user: "Task 1 ready to commit: `tests/storage-access.test.js`, `package.json`. The test fails until Task 3 adds the migration." Do not run git commit.

---

### Task 2: Live access check (records today's exposure)

**Files:**
- Create: `supabase/tests/uploads_access.sql`

**Interfaces:**
- Consumes: live tables `profiles`, `auth.users`, `construction_projects`, `partner_agreements`, `storage.objects`, `pg_policies`; after Task 4, `public.uploads_can_write(text)` from Task 3.
- Produces: a script that ends with the single row `uploads access: all checks passed`, or raises `FAIL: <what>`.

- [ ] **Step 1: Write the script**

Create `supabase/tests/uploads_access.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- uploads_access.sql — LIVE check of who can see / upload what in the
-- `uploads` storage bucket (migration 0081).
--
-- SAFE ON PRODUCTION: everything runs in one transaction that is always
-- ROLLED BACK, it writes no rows, and every check is a read. It acts as
-- real accounts by setting the same JWT claims PostgREST sets, switching
-- to the `authenticated` / `anon` role, counting what storage RLS lets
-- through, and switching back to compare as postgres.
--
-- Run: paste into the Supabase SQL editor, or via the Supabase MCP
-- execute_sql tool, or  psql "$DB_URL" -f supabase/tests/uploads_access.sql
-- Pass:  one row  'uploads access: all checks passed'
-- Fail:  ERROR  'FAIL: <which check>'  (stops at the first failure)
--
-- The expectation (pg_temp.expected_for) is written independently of the
-- policy functions, as plain joins, so a bug in one is caught by the other.
-- ════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_label; end if;
end $$;

-- Set the JWT claims for an account (call as postgres; takes effect when
-- the role is switched to authenticated).
create function pg_temp.act_as(p_uid uuid) returns void
language plpgsql as $$
declare v_email text;
begin
  if p_uid is null then raise exception 'FAIL: fixture account missing'; end if;
  select email into v_email from auth.users where id = p_uid;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'email', v_email, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end $$;

-- What an account SHOULD see, from the access map, as plain joins.
create function pg_temp.expected_for(p_uid uuid) returns int
language sql as $$
  with me as (
    select p.id, lower(u.email) as email, coalesce(p.role, '') as role
      from profiles p join auth.users u on u.id = p.id
     where p.id = p_uid
  ),
  mine as (
    select c.id from construction_projects c, me
     where lower(c.client_email) = me.email or lower(c.partner_email) = me.email
  )
  select count(*)::int
    from storage.objects o, me
   where o.bucket_id = 'uploads'
     and (   o.owner_id = p_uid::text
          or (split_part(o.name, '/', 1) in ('quotations', 'reimbursementReceipts') and me.role = 'owner')
          or (split_part(o.name, '/', 1) not in ('quotations', 'reimbursementReceipts') and me.role in ('owner', 'staff'))
          or (split_part(o.name, '/', 1) in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms')
              and split_part(o.name, '/', 2) in (select id::text from mine))
          or (split_part(o.name, '/', 1) = 'employeeTermsGlobal' and me.role in ('worker', 'teamLeader'))
          or (split_part(o.name, '/', 1) = 'agreementDocs' and me.role not in ('worker', 'teamLeader')))
$$;

-- ── Fixtures: one real account per role (all exist on 2026-09-29) ─────
select set_config('t.owner',   (select id::text from profiles where role = 'owner' and owner_id is null limit 1), true);
select set_config('t.subowner',(select id::text from profiles where role = 'owner' and owner_id is not null limit 1), true);
select set_config('t.staff',   (select id::text from profiles where role = 'staff' limit 1), true);
select set_config('t.worker',  (select id::text from profiles where role in ('worker', 'teamLeader')
                                  and coalesce(status, 'active') = 'active' limit 1), true);
select set_config('t.client',  (select p.id::text from profiles p join construction_projects c
                                   on lower(c.client_email) = lower(p.email)
                                 where exists (select 1 from storage.objects o where o.bucket_id = 'uploads'
                                                 and o.name like 'weeklyBillReceipts/' || c.id || '/%')
                                 limit 1), true);
select set_config('t.client_pid', (select c.id::text from construction_projects c
                                     join profiles p on lower(c.client_email) = lower(p.email)
                                    where p.id::text = current_setting('t.client')
                                      and exists (select 1 from storage.objects o where o.bucket_id = 'uploads'
                                                    and o.name like 'weeklyBillReceipts/' || c.id || '/%')
                                    limit 1), true);
-- On 2026-09-29 ONE client account owns every PM project that has receipts,
-- so "another project's receipts" can't be a real file. The cross-project
-- checks use a project id that belongs to nobody, through the rule functions.
select set_config('t.other_pid', '00000000-0000-4000-8000-000000000000', true);
select set_config('t.partner', (select p.id::text from profiles p join construction_projects c
                                   on lower(c.partner_email) = lower(p.email) limit 1), true);
select set_config('t.design',  (select id::text from profiles where kind = 'client' limit 1), true);
select set_config('t.total',   (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);

-- A fixture that found no row reads back as '' (set_config stores NULL as an
-- empty string), so test for '' rather than NULL.
select pg_temp.check(current_setting('t.owner')      <> '', 'fixture: main owner account');
select pg_temp.check(current_setting('t.subowner')   <> '', 'fixture: sub-owner account');
select pg_temp.check(current_setting('t.staff')      <> '', 'fixture: staff account');
select pg_temp.check(current_setting('t.worker')     <> '', 'fixture: active worker account');
select pg_temp.check(current_setting('t.client')     <> '', 'fixture: construction client with receipts');
select pg_temp.check(current_setting('t.client_pid') <> '', 'fixture: that client''s project with receipts');
select pg_temp.check(not exists (select 1 from construction_projects where id::text = current_setting('t.other_pid')),
                 'fixture: the "nobody''s project" id really belongs to nobody');
select pg_temp.check(current_setting('t.partner')    <> '', 'fixture: partner account');
select pg_temp.check(current_setting('t.design')     <> '', 'fixture: design client account');

-- ── 0. Policy shape: no storage.objects policy at all is granted to ───
--    public/anon (a catch-all like `using (true)` would reach uploads too;
--    app-releases is a public BUCKET, which needs no public policy).
select pg_temp.check(not exists (
  select 1 from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and ('public' = any(roles) or 'anon' = any(roles))), 'no storage.objects policy is granted to public/anon');

-- ── 1. Not logged in: sees nothing ────────────────────────────────────
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = 0, 'anon sees 0 uploads (saw ' || current_setting('t.seen') || ')');

-- ── 2. Every persona sees exactly its expected set ────────────────────
-- (repeated block: act_as → authenticated → count → back to postgres → compare)
select pg_temp.act_as(current_setting('t.owner')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = current_setting('t.total')::int
                 and current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.owner')::uuid),
                 'main owner sees every upload');

select pg_temp.act_as(current_setting('t.subowner')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.subowner')::uuid),
                 'sub-owner sees the owner set');

select pg_temp.act_as(current_setting('t.staff')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
select set_config('t.seen_q', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                  and split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts')
                                  and owner_id is distinct from auth.uid()::text), true);
select set_config('t.seen_inbox', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                      and split_part(name, '/', 1) = 'expenseInbox'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.staff')::uuid),
                 'staff sees exactly the staff set');
select pg_temp.check(current_setting('t.seen_q')::int = 0, 'staff sees no quotation / reimbursement files');
select pg_temp.check(current_setting('t.seen_inbox')::int =
                 (select count(*)::int from storage.objects where bucket_id = 'uploads' and split_part(name, '/', 1) = 'expenseInbox'),
                 'staff still sees every Expense Inbox receipt (encoding access kept)');

select pg_temp.act_as(current_setting('t.worker')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
select set_config('t.seen_other', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                      and split_part(name, '/', 1) <> 'employeeTermsGlobal'
                                      and owner_id is distinct from auth.uid()::text), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.worker')::uuid),
                 'worker sees exactly the worker set');
select pg_temp.check(current_setting('t.seen_other')::int = 0,
                 'worker sees nothing but the employee agreement PDF (saw ' || current_setting('t.seen_other') || ' other)');

select pg_temp.act_as(current_setting('t.client')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
select set_config('t.seen_own_wbr', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                        and name like 'weeklyBillReceipts/' || current_setting('t.client_pid') || '/%'), true);
select set_config('t.r_other_wbr', public.uploads_can_read(
                   'weeklyBillReceipts/' || current_setting('t.other_pid') || '/2026-09-01_0_0_1700000000000.jpg', null)::text, true);
select set_config('t.r_other_terms', public.uploads_can_read(
                   'projectTerms/' || current_setting('t.other_pid') || '/1700000000000_terms.pdf', null)::text, true);
select set_config('t.seen_admin', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                      and split_part(name, '/', 1) in ('expenseInbox', 'overheadReceipts', 'quotations',
                                          'reimbursementReceipts', 'workerAgreements', 'laborContractFiles')), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.client')::uuid),
                 'construction client sees exactly their set');
select pg_temp.check(current_setting('t.seen_own_wbr')::int > 0, 'client still sees their own project receipts');
select pg_temp.check(not current_setting('t.r_other_wbr')::boolean,   'client may not read another project''s receipts');
select pg_temp.check(not current_setting('t.r_other_terms')::boolean, 'client may not read another project''s terms');
select pg_temp.check(current_setting('t.seen_admin')::int = 0, 'client sees no admin-only files');

select pg_temp.act_as(current_setting('t.partner')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.partner')::uuid),
                 'partner sees exactly their set');

select pg_temp.act_as(current_setting('t.design')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.design')::uuid),
                 'design client sees only templates and their own files');

-- ── 3. Upload rule, per persona (needs 0081's uploads_can_write) ──────
select pg_temp.act_as(current_setting('t.client')::uuid);
set local role authenticated;
select set_config('t.w_own_proc',   public.uploads_can_write('procurementReceipts/' || current_setting('t.client_pid') || '/x_client_1.jpg')::text, true);
select set_config('t.w_other_proc', public.uploads_can_write('procurementReceipts/' || current_setting('t.other_pid') || '/x_client_1.jpg')::text, true);
select set_config('t.w_sig',        public.uploads_can_write('signatures/' || auth.uid() || '_1700000000000.png')::text, true);
select set_config('t.w_sig_proj',   public.uploads_can_write('signatures/proj_' || current_setting('t.client_pid') || '_' || auth.uid() || '_1700000000000.png')::text, true);
select set_config('t.w_sig_other',  public.uploads_can_write('signatures/' || current_setting('t.staff') || '_1700000000000.png')::text, true);
select set_config('t.w_terms',      public.uploads_can_write('signed-terms/' || auth.uid() || '/1700000000000_terms.pdf')::text, true);
select set_config('t.w_terms_other',public.uploads_can_write('signed-terms/' || current_setting('t.staff') || '/1700000000000_terms.pdf')::text, true);
select set_config('t.w_overhead',   public.uploads_can_write('overheadReceipts/x_1.jpg')::text, true);
reset role;
select pg_temp.check(current_setting('t.w_own_proc')::boolean,       'client may upload a receipt to their own project');
select pg_temp.check(not current_setting('t.w_other_proc')::boolean, 'client may not upload to another project');
select pg_temp.check(current_setting('t.w_sig')::boolean,            'client may upload their own signature');
select pg_temp.check(current_setting('t.w_sig_proj')::boolean,       'client may upload their own project-terms signature');
select pg_temp.check(not current_setting('t.w_sig_other')::boolean,  'client may not upload someone else''s signature');
select pg_temp.check(current_setting('t.w_terms')::boolean,          'client may snapshot signed terms under their own id');
select pg_temp.check(not current_setting('t.w_terms_other')::boolean,'client may not write under another user''s signed-terms');
select pg_temp.check(not current_setting('t.w_overhead')::boolean,   'client may not upload into admin folders');

select pg_temp.act_as(current_setting('t.worker')::uuid);
set local role authenticated;
select set_config('t.w_worker_sig',     public.uploads_can_write('signatures/' || auth.uid() || '_1700000000000.png')::text, true);
select set_config('t.w_worker_emp_sig', public.uploads_can_write('signatures/employee_' || auth.uid() || '_1700000000000.png')::text, true);
select set_config('t.w_worker_terms',   public.uploads_can_write('signed-terms/' || auth.uid() || '/1700000000000_employee-terms.pdf')::text, true);
select set_config('t.w_worker_proc',    public.uploads_can_write('procurementReceipts/' || current_setting('t.client_pid') || '/x.jpg')::text, true);
select set_config('t.w_worker_inbox',   public.uploads_can_write('expenseInbox/1700000000000_0_x.jpg')::text, true);
reset role;
select pg_temp.check(not current_setting('t.w_worker_sig')::boolean,   'worker may not upload a client-style signature');
select pg_temp.check(current_setting('t.w_worker_emp_sig')::boolean,   'worker may upload their own employee-agreement signature');
select pg_temp.check(current_setting('t.w_worker_terms')::boolean,     'worker may snapshot signed terms under their own id');
select pg_temp.check(not current_setting('t.w_worker_proc')::boolean,  'worker may not upload procurement receipts');
select pg_temp.check(not current_setting('t.w_worker_inbox')::boolean, 'worker may not upload to Expense Inbox');

select pg_temp.act_as(current_setting('t.staff')::uuid);
set local role authenticated;
select set_config('t.w_staff_inbox', public.uploads_can_write('expenseInbox/1700000000000_0_x.jpg')::text, true);
select set_config('t.w_staff_wbr',   public.uploads_can_write('weeklyBillReceipts/' || current_setting('t.client_pid') || '/x.jpg')::text, true);
select set_config('t.w_staff_quote', public.uploads_can_write('quotations/' || auth.uid() || '/x.jpg')::text, true);
reset role;
select pg_temp.check(current_setting('t.w_staff_inbox')::boolean,       'staff may upload to Expense Inbox');
select pg_temp.check(current_setting('t.w_staff_wbr')::boolean,         'staff may upload PM receipts');
select pg_temp.check(not current_setting('t.w_staff_quote')::boolean,   'staff may not upload quotation files');

select pg_temp.act_as(current_setting('t.owner')::uuid);
set local role authenticated;
select set_config('t.w_owner_quote', public.uploads_can_write('quotations/' || auth.uid() || '/x.jpg')::text, true);
reset role;
select pg_temp.check(current_setting('t.w_owner_quote')::boolean, 'owner may upload quotation files');

select 'uploads access: all checks passed' as result;
rollback;
```

- [ ] **Step 2: Run it against the live database BEFORE the fix to record today's exposure**

Run the file through the Supabase MCP `execute_sql` tool (project `hqbgduyonlbbsvjuapre`), the SQL editor, or `psql`. It is read-only and rolls back.

Expected: **ERROR `FAIL: no uploads policy is granted to public/anon`**. That is today's drift (`uploads_read`/`uploads_insert` granted to public). Write the error text into the Task 4 checkpoint message as the "before" evidence.

To see the next failures too (optional evidence), temporarily comment out the check in section 0, run again, and expect `FAIL: anon sees 0 uploads (saw 745)` (or the current total). **Restore the section 0 check afterwards.**

- [ ] **Step 3: Checkpoint (user commits)**

Stop and tell the user: "Task 2 ready to commit: `supabase/tests/uploads_access.sql`. Before-fix run: `<paste error>`."

---

### Task 3: The migration and its rollback

**Files:**
- Create: `supabase/migrations/0081_uploads_access_repair.sql`
- Create: `supabase/rollback_0081_uploads_access.sql`
- Test: `tests/storage-access.test.js` (from Task 1)

**Interfaces:**
- Consumes (existing live functions, verified 2026-09-29): `is_owner()`, `is_staff()`, `is_worker()` (0002), `cproj_client_can_read(uuid)` (0002), `cproj_partner_can_read(uuid)` (0020), `auth.uid()`. **Do not use** `caller_is_partner()` / `partner_signed_project()`: they don't exist live.
- Produces:
  - `public.dacs_try_uuid(p text) returns uuid`: the uuid, or null for anything else; never raises.
  - `public.uploads_can_read(p_name text, p_owner_id text) returns boolean`
  - `public.uploads_can_write(p_name text) returns boolean`
  - policies `uploads_select_scoped` (SELECT), `uploads_insert_scoped` (INSERT) and `uploads_admin_update` (UPDATE, recreated), all `to authenticated`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0081_uploads_access_repair.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0081_uploads_access_repair.sql
--
-- WHO MAY READ / UPLOAD WHICH FILE in the `uploads` bucket.
--
-- Before this migration (verified live 2026-09-29) the bucket had five
-- catch-all policies. Two of them, uploads_read and uploads_insert, were
-- granted to PUBLIC and exist in NO migration (hand-made drift): a visitor
-- who was not logged in could list and download all 745 files (receipts,
-- quotations, signatures, worker agreements) and upload new ones. 0027's
-- own policies let ANY logged-in user (workers and every client included)
-- read every file too. 0027's "private bucket" only hid the public URL.
--
-- Now a file follows the same rule as the database row it belongs to:
--   • the uploader can always read back their own file (the shim uploads
--     with upsert:true and signs every read as the logged-in user);
--   • quotations/ and reimbursementReceipts/ are OWNER-only (0045, 0041);
--   • owner and staff read everything else (staff keep encoding access);
--   • a construction client / partner reads weeklyBillReceipts/,
--     procurementReceipts/, accomplishmentReports/ and projectTerms/ ONLY
--     under their own construction project's id: the same test as the
--     weekly_bills _client_read / _partner_read policies. (0019's partner
--     "signed agreement" gate is NOT live, so it is deliberately not used;
--     owner decision 2026-07-03, partners sign the first-login agreement);
--   • agreementDocs/ (signing-gate templates) is readable by anyone logged
--     in except workers;
--   • workers and team leaders read only employeeTermsGlobal/ and upload
--     only their own employee signature and signed-terms copy: the
--     first-login employee agreement gate in admin.html (js/admin.js).
--     Nothing else (their Attendance app uses the `attendance` bucket).
--
-- No JavaScript change: js/supabase-config.js §11b already signs as the
-- logged-in user. Live check: supabase/tests/uploads_access.sql.
-- CI guard: tests/storage-access.test.js. Undo (never re-opens public):
-- supabase/rollback_0081_uploads_access.sql.
--
-- ADDING A NEW UPLOAD FOLDER: it is owner/staff-only until you give it a
-- rule in uploads_can_read / uploads_can_write (new migration) and add it
-- to FOLDERS in tests/storage-access.test.js.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. text → uuid, or null (a policy must never raise mid-listing) ──
create or replace function public.dacs_try_uuid(p text)
returns uuid language sql immutable set search_path = public as $$
  select case
           when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then p::uuid
         end
$$;

-- ── 2. READ rule ──────────────────────────────────────────────────────
create or replace function public.uploads_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_pid    uuid := dacs_try_uuid(split_part(p_name, '/', 2));
begin
  if v_uid is null then return false; end if;

  -- The uploader can always read back their own file.
  if p_owner_id is not null and p_owner_id = v_uid::text then return true; end if;

  -- Owner-only modules (quotations 0045, reimbursements 0041).
  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- Owner and staff: everything else (staff encode receipts from here).
  if is_owner() or is_staff() then return true; end if;

  -- Construction client / partner: files filed under THEIR project. Same
  -- test as the weekly_bills _client_read / _partner_read policies.
  if v_folder in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms') then
    return v_pid is not null
       and (cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid));
  end if;

  -- Employee agreement PDF: every non-owner admin role (staff, worker,
  -- teamLeader) signs it at first login in admin.html (js/admin.js).
  if v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false); end if;

  -- Agreement templates shown at the client/partner signing gates.
  -- coalesce: a profile with a NULL role must not be denied (NOT NULL = NULL).
  if v_folder = 'agreementDocs' then return not coalesce(is_worker(), false); end if;

  return false;
end $$;

-- ── 3. UPLOAD rule ────────────────────────────────────────────────────
create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;
  if is_owner() or is_staff() then return true; end if;
  -- Signatures. Clients/partners (js/client-management-app.js):
  --   signatures/<uid>_<ts>.png  and  signatures/proj_<project>_<uid>_<ts>.png
  -- Workers/team leaders (employee agreement gate, js/admin.js):
  --   signatures/employee_<uid>_<ts>.png  only
  if v_folder = 'signatures' then
    if coalesce(is_worker(), false) then
      return p_name ~ ('^signatures/employee_' || v_uid::text || '_[0-9]+\.png$');
    end if;
    return p_name ~ ('^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\.png$');
  end if;
  --   signed-terms/<uid>/<ts>_<name>.pdf   (dacsSnapshotPdf, every signing gate)
  if v_folder = 'signed-terms'  then return v_seg2 = v_uid::text; end if;

  -- Workers and team leaders upload nothing else.
  if coalesce(is_worker(), false) then return false; end if;
  --   procurementReceipts/<project>/…  (client "bought by client" receipt; clients only,
  --   partners are read-only, same as the procurement_client_update table policy)
  if v_folder = 'procurementReceipts' then
    return dacs_try_uuid(v_seg2) is not null and cproj_client_can_read(dacs_try_uuid(v_seg2));
  end if;

  return false;
end $$;

revoke all on function public.dacs_try_uuid(text) from public;
revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.dacs_try_uuid(text) from anon;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.dacs_try_uuid(text) to authenticated;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- ── 4. Replace the catch-all policies ─────────────────────────────────
drop policy if exists "uploads_read"          on storage.objects;  -- live-only drift, PUBLIC
drop policy if exists "uploads_insert"        on storage.objects;  -- live-only drift, PUBLIC
drop policy if exists "uploads_auth_select"   on storage.objects;  -- 0027
drop policy if exists "uploads_auth_insert"   on storage.objects;  -- 0027
drop policy if exists "uploads_admin_update"  on storage.objects;  -- 0032, recreated below
drop policy if exists "uploads_select_scoped" on storage.objects;
drop policy if exists "uploads_insert_scoped" on storage.objects;

create policy "uploads_select_scoped" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and public.uploads_can_read(name, owner_id));

create policy "uploads_insert_scoped" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and public.uploads_can_write(name));

-- Overwrite (the shim's upsert:true on an existing path): owner/staff as in
-- 0032, except the owner-only folders.
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              else (is_owner() or is_staff()) end);

-- Keep the bucket private (0027); harmless if already false.
update storage.buckets set public = false where id = 'uploads';
```

- [ ] **Step 2: Write the rollback**

Create `supabase/rollback_0081_uploads_access.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- rollback_0081_uploads_access.sql: EMERGENCY undo of 0081.
--
-- Use ONLY if 0081 breaks a legitimate reader and the fix can't wait.
-- Restores the 0027/0032 state: any LOGGED-IN user may read and upload,
-- owner/staff may overwrite. It deliberately does NOT restore the
-- hand-made uploads_read / uploads_insert policies that were granted to
-- PUBLIC. Not-logged-in visitors stay locked out even after a rollback.
--
-- The helper functions are left in place (unused, harmless). 0081 is
-- LIVE (applied 2026-09-29 through the SQL editor; it has no
-- schema_migrations row). Ship any corrected rules as a NEW migration
-- (0082), never re-apply a changed 0081. This file is an emergency
-- script, not a migration: after running it, re-run 0081 (unchanged)
-- to restore the scoped rules.
-- ════════════════════════════════════════════════════════════════════
begin;

drop policy if exists "uploads_select_scoped" on storage.objects;
drop policy if exists "uploads_insert_scoped" on storage.objects;
drop policy if exists "uploads_admin_update"  on storage.objects;
drop policy if exists "uploads_auth_select"   on storage.objects;
drop policy if exists "uploads_auth_insert"   on storage.objects;

create policy "uploads_auth_select" on storage.objects
  for select to authenticated using (bucket_id = 'uploads');
create policy "uploads_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'uploads');
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using      (bucket_id = 'uploads' and (is_owner() or is_staff()))
  with check (bucket_id = 'uploads' and (is_owner() or is_staff()));

commit;
```

- [ ] **Step 3: Run the CI guard**

Run: `node tests/storage-access.test.js`
Expected: every test prints `ok`, last line `N passed, 0 failed`, exit 0. If a Section II check fails, the SQL text differs from the plan; fix the SQL, not the test.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all eleven suites pass (the ten existing ones are untouched by this task).

- [ ] **Step 5: Checkpoint (user commits)**

Stop and tell the user: "Task 3 ready to commit: `supabase/migrations/0081_uploads_access_repair.sql`, `supabase/rollback_0081_uploads_access.sql`. `npm test` green. Not yet applied to the live database; Task 4 needs your go-ahead."

---

### Task 4: Apply to production and verify every role

**Files:** none changed. This task applies Task 3 and runs Task 2.

**Interfaces:**
- Consumes: `supabase/migrations/0081_uploads_access_repair.sql`, `supabase/tests/uploads_access.sql`, `supabase/rollback_0081_uploads_access.sql`.

- [ ] **Step 1: Ask for the go-ahead**

Tell the user, in plain words: "Ready to apply the storage fix to the live database. Clients and partners keep their own project files; staff keep everything except quotations and reimbursements; workers and not-logged-in visitors lose access. Rollback file is ready. Apply now?" **Do not continue without an explicit yes in this session.**

- [ ] **Step 2: Dry run inside a rolled-back transaction**

Run through the Supabase MCP `execute_sql` tool (project `hqbgduyonlbbsvjuapre`): `begin;` + the full contents of `0081_uploads_access_repair.sql` + `select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'uploads%';` + `rollback;`
Expected: result `3`, no error. This proves the SQL compiles against the live schema. The rollback discards it.

- [ ] **Step 3: Apply for real**

Apply `0081_uploads_access_repair.sql` with the Supabase MCP `apply_migration` tool (name `0081_uploads_access_repair`, query = the file contents), so it is recorded in `supabase_migrations.schema_migrations`.
Expected: success.

- [ ] **Step 4: Run the live check**

Run `supabase/tests/uploads_access.sql` exactly as in Task 2 Step 2.
Expected: one row, `uploads access: all checks passed`.
If it raises `FAIL: …`, read which check failed. If it's a legitimate reader losing access (for example "client still sees their own project receipts"), **run the rollback file immediately**, then fix 0081 in a new task.

- [ ] **Step 5: Prove a not-logged-in visitor is locked out over HTTP**

Run (the anon key is the public one already shipped in `js/supabase-config.js` line 17):

```bash
ANON=$(grep -o "SUPABASE_ANON_KEY = '[^']*'" js/supabase-config.js | cut -d"'" -f2)
curl -s -X POST "https://hqbgduyonlbbsvjuapre.supabase.co/storage/v1/object/list/uploads" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"prefix":"expenseInbox","limit":5}'
```

Expected: `[]`. Before the fix this returned file entries.

- [ ] **Step 6: Browser check, one real account per role**

Ask the user to log in with each account and confirm, or do it with them. Tick each line:

| Account | Page | Check | Expected |
|---|---|---|---|
| Owner (`admin@dacsbuilding.com`) | `admin.html` | Open any Materials expense receipt, an overhead receipt, a quotation image, a reimbursement receipt | All open |
| Owner | `share-capture.html` on phone | Share one receipt photo | Lands in Expense Inbox and opens |
| Staff | `admin.html` | Open an Expense Inbox photo, a PM Daily Expenses receipt, an overhead receipt | All open |
| Construction client (the Los Churreros account) | `Client Management.html` | Open a Daily Expenses receipt; open Project Terms PDF | Both open |
| Construction client | `Client Management.html` | Procurement list, "bought by client": upload a receipt photo, then view it | Upload succeeds and opens |
| Partner | `Dacs Partnership.html` | Open a Daily Expenses receipt on a signed project | Opens |
| Design client | `client.html` | Log in, open any document shown | Nothing broken |
| Worker | Dacs Attendance app | Time In with photo | Works (different bucket; sanity only) |
| Worker or team leader who has not signed yet | `admin.html` | First-login employee agreement: open the Terms PDF, draw a signature, accept | PDF opens; afterwards `profiles.agreement_signature_image` is non-empty and the newest `agreement_events` row for them has `pdf_snapshot_url` |
| Construction client (first login) | `Client Management.html` | Agreement ceremony with a drawn signature | Signature saved (`agreement_signature_image` non-empty); snapshot PDF recorded |
| Construction client | `Client Management.html` | Per-project terms: open PDF, sign | `partner_agreements` row has a non-empty `signatureImage` |

Then run this in the SQL editor the next day and confirm there are no new storage errors:

```sql
select at, page, kind, message from client_errors
 where at > now() - interval '1 day'
   and (message ilike '%storage%' or message ilike '%sign%' or message ilike '%403%' or message ilike '%not found%')
 order by at desc;
```

Expected: no rows related to receipts or PDFs.

- [ ] **Step 7: Checkpoint**

Tell the user the result of Steps 4–6 in plain words. Nothing to commit (no file changed).

---

### Task 5: Documentation and the "new folder" rule

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§8, the paragraph starting "**Storage is PRIVATE**")
- Modify: `docs/DATABASE_SCHEMA.md` (add a section after the top banner)
- Modify: `supabase/migrations/README.md` (Status ledger)
- Modify: `CLAUDE.md` (section "Finishing a change")

**Interfaces:** none.

- [ ] **Step 1: ARCHITECTURE.md §8**

Directly after the existing "**Storage is PRIVATE — don't render stored URLs directly.**" paragraph (it ends with "…fetching it from a **worker/server** context where the shim isn't loaded."), insert:

```markdown
**Who can read a stored file (`0081`).** Signing only works if the logged-in user is allowed to
read that file, and the rule follows the file's **top folder**: owner and staff read everything
except `quotations/` and `reimbursementReceipts/` (owner-only); a construction client or partner
reads `weeklyBillReceipts/`, `procurementReceipts/`, `accomplishmentReports/` and `projectTerms/`
only under **their own** construction project's id (same test as the `weekly_bills` read policies);
`agreementDocs/` is readable by anyone logged in except workers; the uploader can always read
back their own file; workers and team leaders read only the employee agreement PDF (`employeeTermsGlobal/`) and upload only their own employee signature and signed-terms copy. The rules are `uploads_can_read` /
`uploads_can_write` in migration 0081. **A new upload folder is owner/staff-only until it gets a
rule there**, and `tests/storage-access.test.js` fails CI until it is classified.
```

- [ ] **Step 2: DATABASE_SCHEMA.md**

After the top "⚠️ The storage layer described below is out of date" banner block, insert:

```markdown
## Storage access (`uploads` bucket, migration 0081)

The bucket is private (0027) and every read is a signed URL minted as the logged-in user.
Access is decided per **top folder** by `uploads_can_read(name, owner_id)` and
`uploads_can_write(name)`. The full folder-by-folder map is in
`docs/superpowers/plans/2026-09-29-uploads-storage-access-repair.md` ("Access map"). Project-scoped
folders put the `construction_projects.id` in the **second path segment**
(`weeklyBillReceipts/<project id>/…`); keep that shape for any new client-facing folder.
```

- [ ] **Step 3: migrations README Status ledger**

At the end of the "Status ledger" section, before "Get the truth before relying on this line:", add:

```markdown
**0081 (uploads access repair)** removed two hand-made storage policies that existed in no
migration, `uploads_read` and `uploads_insert`, both granted to PUBLIC (not-logged-in visitors
could list and download every file). Applied <DATE OF TASK 4> via `apply_migration`; live check
`supabase/tests/uploads_access.sql`. Emergency undo: `supabase/rollback_0081_uploads_access.sql`
(does not restore public access).
```

Replace `<DATE OF TASK 4>` with the actual date Task 4 Step 3 ran, e.g. `2026-09-30`.

- [ ] **Step 4: CLAUDE.md**

In "Finishing a change" → "### Adding a data field" table, add this row after the "Print / export" row:

```markdown
| Storage folder | `uploads_can_read` / `uploads_can_write` (new migration) + `FOLDERS` in `tests/storage-access.test.js` | If it uploads to a **new** top folder: it is owner/staff-only until given a rule |
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: all suites pass (docs aren't tested, and this confirms nothing else moved).

- [ ] **Step 6: Checkpoint (user commits)**

Stop and tell the user: "Task 5 ready to commit: `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `supabase/migrations/README.md`, `CLAUDE.md`."

---

## Self-review against the spec

| Spec requirement | Covered by |
|---|---|
| §1 Repair existing receipt/document access **before Stage 1a ships** | Whole plan; Task 4 is the gate |
| §1 Preserve clients' and partners' access to **their own project documents** | Access map; `uploads_can_read` project rules; Task 2 checks "client still sees their own project receipts", partner persona; Task 4 browser rows |
| §1 Preserve **staff's agreed encoding access** | Staff read everything except owner-only modules; Task 2 checks "staff still sees every Expense Inbox receipt"; Task 4 staff rows |
| §1 **Verify live policies**, repair **through migrations** | Evidence table; Task 2 before-run; migration 0081 via `apply_migration` |
| §1 **Test allowed/denied access by role and project** | Task 2 (7 personas, own vs other project, read and upload) + Task 4 Step 5 (HTTP as anon) + Step 6 |
| §1 Capture current policy evidence | "Why this is needed" table + Task 2 Step 2 before-run output |
| §9 "document-storage checks deny unauthorized file access while preserving each client/partner's permitted documents and staff encoding access" | Task 2 passing after Task 4 |
| §10 Preserve authorized **PM** client/partner document access | `weeklyBillReceipts`/`procurementReceipts`/`accomplishmentReports`/`projectTerms` keyed on `construction_projects.id` |
| §2 Workers cannot retrieve procurement prices via images/direct data | Workers/team leaders read only the employee agreement PDF (Task 2 "worker sees nothing but the employee agreement PDF") |

Out of scope, stated so nobody expands it silently: the `attendance` and `app-releases` buckets (checked, correct); the Stage 1a private request-photo bucket (belongs to the Stage 1a plan); restricting staff from payroll data (spec §2 legacy exception).
