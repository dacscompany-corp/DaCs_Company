// ════════════════════════════════════════════════════════════════════
// SHIM ROW->DOC TESTS — run with:  node tests/shim-fromrow.test.js
//
// Zero dependencies, no framework. Feeds known rows into the REAL
// fromRow(), extracted from js/supabase-config.js at run time (never a
// copy), and fails loudly if a rule breaks.
//
// THE RULE UNDER GUARD — `kind` is stripped ONLY where it is a
// discriminator.
//
//   `profiles` is three collections in one table (users / clientUsers /
//   constructionClientUsers), told apart by a `kind` column. Those REG
//   entries declare `kind:`, the query filters on it, and it must NOT
//   leak into doc data — nothing in the app should ever see or rewrite it.
//
//   But three OTHER tables have a `kind` column that is ordinary data:
//     · quotation_presets.kind  'client' | 'scope'
//     · payment_requests.kind   'construction' | 'cost_plus'
//     · client_errors.kind      'error' | 'unhandledrejection'
//   None of them declares `kind:` in REG. Stripping theirs silently
//   deletes a real field on every read — no error, no warning, the value
//   is just gone.
//
//   That is exactly what happened on 2026-08-26: "Save as preset" wrote
//   three good rows to quotation_presets, every read returned them, and
//   qtRenderPresetBar's `p.kind === 'client'` matched none of them, so
//   both preset dropdowns rendered empty with nothing in the console.
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
    throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}

function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/shim-fromrow.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}

// ── Load the live converter ──────────────────────────────────────────
const F = 'js/supabase-config.js';
const src = read(F);
const engine =
  slice(src, 'const camelToSnake', '// ── 3. Timestamp', F) +
  slice(src, 'function wrapTs', 'function tsToISO', F) +
  slice(src, 'function fieldToCol', '// doc data (camel) → row (snake)', F) +
  slice(src, 'function fromRow', '// ── 6. Snapshot wrappers', F);

// `wrapTs` needs the TS class; a minimal stand-in is enough here because
// no test below declares a ts column.
const ctx = { TS: class TS { constructor(ms) { this._ms = ms; } } };
const { fromRow } = new Function('ctx',
  'with(ctx){' + engine + '\n; return { fromRow };}')(ctx);

console.log('\nfromRow — the `kind` column');
console.log('──────────────────────────────────────');

// ── A. profiles: kind IS a discriminator, and must stay hidden ───────
const PROFILE_CFG = { table: 'profiles', kind: 'admin', rename: { ownerUid: 'owner_id' } };

test('A1. a config that declares kind: strips it from doc data', () => {
  const out = fromRow(PROFILE_CFG, { id: 'u1', kind: 'admin', email: 'a@b.com' });
  eq('kind' in out, false, 'kind leaked into a profiles doc');
  eq(out.email, 'a@b.com', 'email');
});

test('A2. …even when the row carries a different kind value', () => {
  const cfg = { table: 'profiles', kind: 'client', rename: { ownerUid: 'owner_id' } };
  const out = fromRow(cfg, { id: 'u2', kind: 'client', ownerUid: null, owner_id: 'o1' });
  eq('kind' in out, false, 'kind leaked');
  eq(out.ownerUid, 'o1', 'rename still applies');
});

// ── B. the three tables where kind is REAL DATA ─────────────────────
const PRESET_CFG  = { table: 'quotation_presets', rename: { userId: 'owner_id' },
                      ts: ['createdAt', 'updatedAt'], json: ['data'] };
const PAYREQ_CFG  = { table: 'payment_requests', rename: { ownerUid: 'owner_id' } };
const ERRORS_CFG  = { table: 'client_errors' };

test('B1. quotation_presets keeps kind — the preset-dropdown bug', () => {
  const out = fromRow(PRESET_CFG, {
    id: 'p1', owner_id: '869c0be7', kind: 'client',
    name: 'Jeacela Turiano Castillo', deleted_at: null
  });
  eq(out.kind, 'client', 'kind must survive the read');
  eq(out.name, 'Jeacela Turiano Castillo', 'name');
  eq(out.userId, '869c0be7', 'owner_id → userId');
  eq(out.deletedAt, null, 'deleted_at → deletedAt');
});

test('B2. a scope preset keeps its kind too', () => {
  const out = fromRow(PRESET_CFG, { id: 'p2', owner_id: 'o', kind: 'scope', name: 'Electrical' });
  eq(out.kind, 'scope', 'kind');
});

test('B3. payment_requests keeps its construction/cost_plus kind', () => {
  eq(fromRow(PAYREQ_CFG, { id: 'r1', kind: 'construction' }).kind, 'construction', 'kind');
  eq(fromRow(PAYREQ_CFG, { id: 'r2', kind: 'cost_plus' }).kind,    'cost_plus',    'kind');
});

test('B4. client_errors keeps its error/unhandledrejection kind', () => {
  eq(fromRow(ERRORS_CFG, { id: 'e1', kind: 'unhandledrejection' }).kind,
     'unhandledrejection', 'kind — drives the Promise/Error badge in error-log.js');
});

// ── C. the filter that the stripped column broke ────────────────────
test('C1. qtRenderPresetBar can partition presets by kind', () => {
  const rows = [
    { id: 'p1', owner_id: 'o', kind: 'client', name: 'Jeacela Turiano Castillo', deleted_at: null },
    { id: 'p2', owner_id: 'o', kind: 'client', name: 'LC',                       deleted_at: null },
    { id: 'p3', owner_id: 'o', kind: 'scope',  name: 'Electrical',               deleted_at: null }
  ].map((r) => fromRow(PRESET_CFG, r));

  const live    = rows.filter((p) => !p.deletedAt);
  const clients = live.filter((p) => p.kind === 'client');
  const scopes  = live.filter((p) => p.kind === 'scope');

  eq(live.length,    3, 'live presets');
  eq(clients.length, 2, 'client presets — 0 here is the reported bug');
  eq(scopes.length,  1, 'scope presets');
});

// ── D. legacy_id stays hidden for everyone ──────────────────────────
test('D1. legacy_id is still stripped from every table', () => {
  eq('legacyId' in fromRow(PAYREQ_CFG, { id: 'r', legacy_id: 'old-1', kind: 'cost_plus' }),
     false, 'legacy_id must not surface');
});

console.log('\n──────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach((f) => console.log('  · ' + f)); process.exit(1); }
console.log('`kind` survives where it is data, and is hidden where it is a discriminator.');
