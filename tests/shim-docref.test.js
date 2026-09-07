// ════════════════════════════════════════════════════════════════════
// SHIM SNAPSHOT-REF TESTS — run with:  node tests/shim-docref.test.js
//
// Zero dependencies, no framework. Exercises the REAL snapshot wrappers
// and the REAL db.batch(), extracted from js/supabase-config.js at run
// time (never a copy), and fails loudly if the rule breaks.
//
// THE RULE UNDER GUARD — every document a snapshot hands back carries a
// USABLE `.ref`.
//
//   Firestore gives each doc in a snapshot a live reference, and the app
//   leans on it in a dozen places:
//
//     expenses-module.js   deleteFolder / deleteProject  batch.delete(d.ref)
//     expenses-module.js   stock adjust                  doc.ref.update(...)
//     pm-admin.js          project teardown              d.ref.delete()
//     payment-requests.js  status sweeps                 batch.update(doc.ref)
//     client-app.js  client-management-app.js  construction-module.js
//                          isRead backfill               batch.update(d.ref)
//
//   The shim used to build those docs with a hardcoded `ref: null`. Every
//   one of those call sites then queued a null and blew up inside
//   commit() with "Cannot read properties of null (reading 'delete')" —
//   the toast the user saw on 2026-09-07 when deleting the "Los Churreros
//   System Plus" folder. Nothing failed at the call site, so the stack
//   pointed at the shim's batch loop and not at the module that was wrong.
//
//   A folder with no billing periods deleted fine, which is why this hid
//   for so long: the null only reaches commit() when the query actually
//   returned rows.
//
// If a test fails with "SLICE NOT FOUND", the source was restructured —
// update the extraction markers below, don't delete the test.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
const failures = [];
const pending  = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function atest(name, fn) { pending.push([name, fn]); }
function ok(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }
function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}

function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/shim-docref.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}

// ── Load the live snapshot wrappers + the live batch ─────────────────
const F   = 'js/supabase-config.js';
const src = read(F);

const snapSrc  = slice(src, 'function docSnap', '// ── 7. Query / Collection / Doc refs', F);
// The sliced batch text ends with the `};` that closes the db object, so
// prefixing `const db = {` re-forms a complete object literal.
const batchSrc = slice(src, '  batch() {', '// ── 9. auth facade', F);

// Stand-ins for the two things the wrappers reach for. `fromRow` is
// covered by shim-fromrow.test.js; here only identity matters. `DocRef`
// records what the batch actually asked it to do.
const harness = [
  'const deleted = [];',
  'const updated = [];',
  'function fromRow(cfg, row) { return row; }',
  'class DocRef {',
  '  constructor(cfg, id, ctx, preload) { this.cfg = cfg; this.id = id; this.ctx = ctx; this._pre = preload; }',
  '  async delete() { deleted.push(this.id); }',
  '  async update(d) { updated.push([this.id, d]); }',
  '  async set(d) { updated.push([this.id, d]); }',
  '}',
  'class CollectionRef {',
  '  constructor(cfg, ctx) { this.cfg = cfg; this.ctx = ctx; }',
  '  async add(d) { updated.push(["(new)", d]); }',
  '}',
].join('\n');

const mod = new Function(
  harness + '\n' + snapSrc + '\nconst db = {\n' + batchSrc +
  '\nreturn { docSnap, querySnap, db, deleted, updated };'
)();

const { docSnap, querySnap, db, deleted, updated } = mod;
const CFG = { table: 'expenses', idField: 'id' };

// ════════════════════════════════════════════════════════════════════
// I. A query snapshot hands back usable refs
// ════════════════════════════════════════════════════════════════════
console.log('\nI. Query snapshot refs');

test('every doc in a query snapshot carries a non-null ref', () => {
  const snap = querySnap(CFG, [{ id: 'e1', amount: 100 }, { id: 'e2', amount: 200 }]);
  eq(snap.size, 2, 'snapshot size');
  snap.docs.forEach((d) => {
    ok(d.ref != null, 'doc ' + d.id + ' has a null ref — batch.delete(d.ref) will throw in commit()');
  });
});

test('a snapshot doc ref is addressable — it knows its own id', () => {
  const snap = querySnap(CFG, [{ id: 'e1' }, { id: 'e2' }]);
  eq(snap.docs[0].ref.id, 'e1', 'first ref id');
  eq(snap.docs[1].ref.id, 'e2', 'second ref id');
});

test('a snapshot doc ref carries the collection config, not a bare id', () => {
  const snap = querySnap(CFG, [{ id: 'e1' }]);
  eq(snap.docs[0].ref.cfg.table, 'expenses', 'ref cfg table');
});

test('a subcollection query propagates its parent context onto each ref', () => {
  const ctx  = { col: 'folder_id', val: 'FLD-1' };
  const snap = querySnap(CFG, [{ id: 'e1' }], ctx);
  eq(snap.docs[0].ref.ctx && snap.docs[0].ref.ctx.val, 'FLD-1', 'ref ctx value');
});

test('an empty result set is still an empty snapshot, never a crash', () => {
  const snap = querySnap(CFG, []);
  eq(snap.empty, true, 'empty flag');
  eq(snap.docs.length, 0, 'docs length');
});

// ════════════════════════════════════════════════════════════════════
// II. A single-doc snapshot hands back a usable ref
// ════════════════════════════════════════════════════════════════════
console.log('\nII. Single-doc snapshot refs');

test('a doc that exists carries a non-null ref', () => {
  const s = docSnap(CFG, 'e1', { id: 'e1', amount: 5 });
  eq(s.exists, true, 'exists');
  ok(s.ref != null, 'ref is null');
  eq(s.ref.id, 'e1', 'ref id');
});

test('a MISSING doc still carries a ref — that is how you create it', () => {
  const s = docSnap(CFG, 'nope', null);
  eq(s.exists, false, 'exists');
  ok(s.ref != null, 'ref is null on a missing doc');
});

// ════════════════════════════════════════════════════════════════════
// III. The batch actually commits what a snapshot handed it
//      (this is the exact path that threw on the folder delete)
// ════════════════════════════════════════════════════════════════════
console.log('\nIII. Batch commit over snapshot refs');

atest('the deleteFolder pattern commits instead of throwing on null', async () => {
  deleted.length = 0;
  const eSnap   = querySnap(CFG, [{ id: 'exp1' }, { id: 'exp2' }]);
  const paySnap = querySnap(CFG, [{ id: 'pay1' }]);
  const batch = db.batch();
  eSnap.docs.forEach((d) => batch.delete(d.ref));
  paySnap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  eq(deleted.join(','), 'exp1,exp2,pay1', 'deleted ids');
});

atest('the isRead backfill pattern updates every row it matched', async () => {
  updated.length = 0;
  const snap  = querySnap(CFG, [{ id: 'n1' }, { id: 'n2' }]);
  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
  await batch.commit();
  eq(updated.length, 2, 'updated count');
  eq(updated[0][0], 'n1', 'first updated id');
});

atest('a per-doc ref.delete() loop (pm-admin teardown) works too', async () => {
  deleted.length = 0;
  const snap = querySnap(CFG, [{ id: 'a' }, { id: 'b' }]);
  for (const d of snap.docs) await d.ref.delete();
  eq(deleted.join(','), 'a,b', 'deleted ids');
});

// ════════════════════════════════════════════════════════════════════
// IV. The rule holds at the source, including the jsonb read path
//     (built inline in Query.get(), so it cannot be extracted above)
// ════════════════════════════════════════════════════════════════════
console.log('\nIV. No hardcoded null refs left in the source');

test('no snapshot doc in supabase-config.js is built with `ref: null`', () => {
  const hits = src.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /ref:\s*null/.test(l));
  eq(hits.length, 0,
     'lines still hardcoding a null ref: ' + hits.map(([n]) => n).join(', '));
});

test('the jsonbData read path builds a real DocRef for each item', () => {
  const jsonb = slice(src, 'const docs = items.map', 'return { docs,', F);
  ok(/new DocRef\(/.test(jsonb), 'jsonb path does not construct a DocRef: ' + jsonb.trim());
});

// ── run the async ones, then report ──────────────────────────────────
(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('Every snapshot doc can delete and update itself.');
})();
