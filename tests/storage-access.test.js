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
