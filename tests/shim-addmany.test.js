// ════════════════════════════════════════════════════════════════════
// SHIM addMany() TESTS — run with:  node tests/shim-addmany.test.js
// Zero dependencies. Extracts the REAL CollectionRef / toRow from
// js/supabase-config.js and runs them against an in-memory supabase-js.
//
// WHY: split expenses/payroll used batch.commit(), which writes rows ONE AT
// A TIME — a dropped connection left 1 of 2 split rows saved (wrong totals,
// no error). addMany() is a single insert: all rows or none (spec
// 2026-10-08-receipt-photos-storage-design.md §4.3).
// If a test fails with "SLICE NOT FOUND", update the markers — don't delete it.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-config.js'), 'utf8');

let passed = 0, failed = 0; const failures = []; const pending = [];
function atest(name, fn) { pending.push([name, fn]); }
function ok(c, l) { if (!c) throw new Error(l || 'expected truthy'); }
function slice(start, end) {
  const i = src.indexOf(start); if (i === -1) throw new Error('SLICE NOT FOUND: ' + start);
  const j = src.indexOf(end, i); if (j === -1) throw new Error('SLICE NOT FOUND: end ' + end);
  return src.slice(i, j);
}

const calls = [];
let nextError = null;
const sb = {
  from(table) {
    return {
      insert(rows, opts) {
        calls.push({ table, rows, opts });
        return {
          select() {
            if (nextError) { const e = nextError; nextError = null; return Promise.resolve({ data: null, error: e }); }
            return Promise.resolve({ data: rows.map((r, i) => ({ id: 'id' + i, ...r })), error: null });
          },
        };
      },
    };
  },
};
const code = [
  slice('const camelToSnake', '\n') + '\n',
  slice('function fieldToCol(', '\n') + '\n',
  slice('const SERVER_TS', '\n') + '\n',
  slice('function tsToISO(', '\n}') + '\n}',
  slice('function toRow(cfg, data)', '// row (snake) → doc data'),
  'class Query { constructor(cfg, ctx) { this.cfg = cfg; this.ctx = ctx; } }',
  'class DocRef { constructor(cfg, id, ctx, pre) { this.cfg = cfg; this.id = id; this.ctx = ctx; this._pre = pre; } }',
  slice('class CollectionRef extends Query', 'class DocRef'),
  'return CollectionRef;',
].join('\n');
const CollectionRef = new Function('sb', 'writeChildren', code)(sb, async () => {});
const cfg = { table: 'expenses', rename: { userId: 'owner_id' }, ts: ['createdAt'] };

atest('one insert call carries every row (all-or-nothing)', async () => {
  calls.length = 0;
  const refs = await new CollectionRef(cfg).addMany([
    { userId: 'u1', amount: 7, splitIndex: 1, clientSubmissionId: 's1' },
    { userId: 'u1', amount: 3, splitIndex: 2, clientSubmissionId: 's1' },
  ]);
  ok(calls.length === 1, 'expected exactly one insert, got ' + calls.length);
  ok(calls[0].rows.length === 2, 'both rows in the one insert');
  ok(calls[0].rows[0].owner_id === 'u1' && calls[0].rows[1].client_submission_id === 's1', 'rows mapped to columns');
  ok(calls[0].opts && calls[0].opts.defaultToNull === false, 'missing keys must take column defaults, not null');
  ok(refs.length === 2 && refs[1].id === 'id1', 'returns a DocRef per row');
});
atest('an error is thrown unchanged (code kept for the 23505 retry check)', async () => {
  nextError = { code: '23505', message: 'duplicate key value violates unique constraint "expenses_client_submission_uniq"' };
  let caught = null;
  try { await new CollectionRef(cfg).addMany([{ userId: 'u1', amount: 1 }]); } catch (e) { caught = e; }
  ok(caught && caught.code === '23505', 'error code lost');
});
atest('an empty list does nothing', async () => {
  calls.length = 0;
  const refs = await new CollectionRef(cfg).addMany([]);
  ok(refs.length === 0 && calls.length === 0, 'no insert for an empty list');
});
atest('refuses tables it cannot insert in one statement', async () => {
  for (const bad of [{ table: 'settings', kv: true }, { table: 'milestones', jsonbData: true }, { table: 'x', children: { a: {} } }]) {
    let threw = false;
    try { await new CollectionRef(bad).addMany([{ a: 1 }]); } catch (_) { threw = true; }
    ok(threw, 'addMany accepted ' + bad.table);
  }
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
