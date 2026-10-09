// ════════════════════════════════════════════════════════════════════
// RECEIPT STORAGE TESTS — run with:  node tests/receipt-storage.test.js
// Zero dependencies. Loads js/receipt-storage.js into a fake browser
// window and checks the helpers that every receipt save and print uses
// (spec docs/superpowers/specs/2026-10-08-receipt-photos-storage-design.md).
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0; const failures = []; const pending = [];
function atest(name, fn) { pending.push([name, fn]); }
function ok(c, l) { if (!c) throw new Error(l || 'expected truthy'); }

const log = [];
let failLedger = false, failUpload = false;
const fakeSb = {
  from(t) { return { insert(row) { log.push(['insert', t, row]); return Promise.resolve({ error: failLedger ? { message: 'ledger down' } : null }); } }; },
  storage: { from(b) { return {
    upload(p, blob, opts) { log.push(['upload', b, p, opts]); return Promise.resolve({ error: failUpload ? { message: 'upload down' } : null }); },
    getPublicUrl(p) { return { data: { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/' + b + '/' + p } }; },
  }; } },
};
const win = {
  sbClient: fakeSb,
  crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
  dacsMaybeSignUrl: async (u) => (/\/object\/public\/uploads\//.test(u) ? u.replace('/object/public/', '/object/sign/') + '?token=t' : u),
};
new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'receipt-storage.js'), 'utf8'))(win);
const R = win.DacsReceipts;
const OWNER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

atest('path: folder / owner / local yyyy-mm / uuid.jpg, matching 0089\'s ledger check', async () => {
  const p = R.receiptPath('payroll', OWNER, new Date(2026, 0, 31, 23, 30), 'ffffffff-0000-4000-8000-000000000001');
  ok(p === 'payrollReceipts/' + OWNER + '/2026-01/ffffffff-0000-4000-8000-000000000001.jpg', p);
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0089_receipt_storage.sql'), 'utf8');
  const re = new RegExp(sql.match(/check \(path ~ '([^']+)'\)/)[1]);
  ok(re.test(R.receiptPath('expense', OWNER)), 'generated path fails the ledger check constraint');
});
atest('path: unknown kind or missing owner throws', async () => {
  let a = false, b = false;
  try { R.receiptPath('bogus', OWNER); } catch (_) { a = true; }
  try { R.receiptPath('expense', ''); } catch (_) { b = true; }
  ok(a && b, 'bad input accepted');
});
atest('isInlinePhoto / storagePathOf', async () => {
  ok(R.isInlinePhoto('data:image/jpeg;base64,AAA') && !R.isInlinePhoto('https://x/y.jpg') && !R.isInlinePhoto(null), 'isInlinePhoto');
  ok(R.storagePathOf('https://p.supabase.co/storage/v1/object/public/uploads/expenseReceipts/a/b.jpg') === 'expenseReceipts/a/b.jpg', 'storagePathOf');
  ok(R.storagePathOf('data:image/jpeg;base64,AAA') === null, 'storagePathOf(data:)');
});
atest('upload: ledger row first, then upload with upsert:false + image/jpeg; returns the public-format URL', async () => {
  log.length = 0;
  const url = await R.uploadReceipt('expense', { size: 1 }, OWNER);
  ok(log[0][0] === 'insert' && log[0][1] === 'receipt_uploads', 'ledger insert must come first');
  ok(log[0][2].owner_id === OWNER && log[0][2].kind === 'expense' && /^expenseReceipts\//.test(log[0][2].path), 'ledger row');
  ok(log[1][0] === 'upload' && log[1][1] === 'uploads' && log[1][2] === log[0][2].path, 'upload to the same path');
  ok(log[1][3].upsert === false && log[1][3].contentType === 'image/jpeg', 'upload options');
  ok(url === 'https://proj.supabase.co/storage/v1/object/public/uploads/' + log[0][2].path, 'returned URL');
});
atest('upload: a ledger failure stops before uploading; an upload failure throws', async () => {
  log.length = 0; failLedger = true;
  let e1 = null; try { await R.uploadReceipt('payroll', {}, OWNER); } catch (e) { e1 = e; }
  failLedger = false;
  ok(e1 && log.length === 1, 'must not upload after a ledger failure');
  failUpload = true;
  let e2 = null; try { await R.uploadReceipt('payroll', {}, OWNER); } catch (e) { e2 = e; }
  failUpload = false;
  ok(e2, 'upload failure swallowed');
});
atest('signHtml signs stored links, leaves data: and other URLs alone', async () => {
  const stored = 'https://proj.supabase.co/storage/v1/object/public/uploads/payrollReceipts/a/2026-10/x.jpg';
  const html = '<img src="' + stored + '"><img src="data:image/jpeg;base64,AAA"><img src="' + stored + '"><a href="https://example.com/a">x</a>';
  const out = await R.signHtml(html);
  ok(!out.includes('/object/public/uploads/'), 'a stored link was left unsigned');
  ok((out.match(/\/object\/sign\/uploads\//g) || []).length === 2, 'both copies signed');
  ok(out.includes('data:image/jpeg;base64,AAA') && out.includes('https://example.com/a'), 'other values changed');
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
