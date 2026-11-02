// Pre-apply drift check for 0110 (Task 8 step 0). Prints the md5 the live
// uploads_can_read / uploads_can_write bodies should have if live still matches
// migration 0102 (the last migration that defined them).
//   node supabase/tests/pm_sharing_items_preapply.mjs                    -> 0102 (expected live)
//   node supabase/tests/pm_sharing_items_preapply.mjs --file <migration> -> any other file (e.g. 0110)
// Normalisation matches the SQL: collapse every \s+ to one space, then trim, then md5
// (SQL: md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) — collapse first, because
// Postgres btrim() strips spaces only, not newlines).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const i = process.argv.indexOf('--file');
const file = i > 0 ? path.resolve(process.argv[i + 1]) : path.join(root, 'supabase/migrations/0102_purchase_payments.sql');
const sql = fs.readFileSync(file, 'utf8');

function body(sig) {
  const head = 'create or replace function ' + sig;
  const at = sql.toLowerCase().lastIndexOf(head);
  if (at < 0) throw new Error('definition not found: ' + sig);
  const open = sql.indexOf('$$', at);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(open + 2, close);
}
const md5 = (s) => crypto.createHash('md5').update(s.replace(/\s+/g, ' ').trim()).digest('hex');

console.log('source: ' + path.relative(root, file));
for (const [name, sig] of [['uploads_can_read(text,text)', 'public.uploads_can_read('], ['uploads_can_write(text)', 'public.uploads_can_write(']])
  console.log(name + ' ' + md5(body(sig)));
