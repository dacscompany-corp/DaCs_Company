// ════════════════════════════════════════════════════════════════════
// WORKMATE ITEM HISTORY (0090) STATIC TESTS:
//   run with  node tests/workmate-history.test.js
//
// Zero dependencies. Guards the shape of migration 0090 (Stage 1b-1):
// who may see history, the gallery bucket rules, no money, the RPC
// permissions, and that re-declared 0085/0086 functions only ADD lines.
// The LIVE behaviour is checked by supabase/tests/1b_acceptance.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = rel => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const MIGRATION = 'supabase/migrations/0090_workmate_item_history.sql';

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SQL = read(MIGRATION);
const CODE = SQL.replace(/--.*$/gm, '');
function fnBlockIn(code, name) {
  const m = code.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\$\\$;', 'i'));
  return m ? m[0] : '';
}
const fnBlock = name => fnBlockIn(CODE, name);

console.log('\nworkmate item history (0090)');

test('the migration exists and sets a lock timeout', () => {
  assert(SQL.length > 0, 'missing ' + MIGRATION);
  assert(/set local lock_timeout = '5s';/.test(CODE), 'no set local lock_timeout');
});

test('no money anywhere in 0090', () => {
  assert(!/\b[a-z_]*(price|amount|cost|peso)[a-z_]*\b/i.test(CODE), 'a money word appears in 0090 code');
});

test('Allow item history is its own switch, off by default', () => {
  assert(/alter table pr_project_settings add column if not exists allow_history boolean not null default false;/.test(CODE),
    'allow_history must be boolean not null default false');
});

test('aliases and brand are search aids, not part of the item identity', () => {
  assert(/add column if not exists aliases text\[\] not null default '\{\}'/.test(CODE), 'aliases text[] default {}');
  assert(/add column if not exists brand text not null default ''/.test(CODE), 'brand text default empty');
  assert(!/pr_catalog_identity/.test(CODE), '0090 must not touch the 0085 identity index');
});

test('a Request Again link is both-or-neither and only two kinds', () => {
  assert(/constraint pr_lines_ref_pair check \(\(ref_kind is null\) = \(ref_id is null\)/.test(CODE), 'pair check');
  assert(/ref_kind in \('request_line', 'reference'\)/.test(CODE), 'kind list');
});

test('the two new tables have RLS, office SELECT policies only, and no anon or direct writes', () => {
  for (const t of ['pr_item_refs', 'pr_gallery_photos']) {
    assert(new RegExp('alter table ' + t + ' enable row level security;').test(CODE), t + ' RLS');
    const policies = [...CODE.matchAll(new RegExp('create policy \\S+ on ' + t + ' for (\\w+)', 'g'))].map(m => m[1]);
    assert(policies.length === 1 && policies[0] === 'select', t + ' must have exactly one SELECT policy, got ' + policies);
    assert(new RegExp('revoke all on ' + t + ' from anon;').test(CODE), t + ' revoke from anon');
    assert(new RegExp('revoke insert, update, delete, truncate, references, trigger on ' + t + ' from authenticated;').test(CODE),
      t + ' revoke writes from authenticated');
  }
});

test('a historical reference: dated or explicitly unknown, retired with a reason, never deleted', () => {
  assert(/check \(\(date_precision = 'unknown'\) = \(ref_date is null\)\)/.test(CODE), 'unknown <=> no date');
  assert(/check \(retired_at is null or btrim\(coalesce\(retire_reason, ''\)\) <> ''\)/.test(CODE), 'retire needs a reason');
});

test('gallery photos: reviewed checklist required, one approved cover per item', () => {
  assert(/checklist_confirmed boolean not null check \(checklist_confirmed\)/.test(CODE), 'checklist must be true');
  assert(/create unique index if not exists pr_gallery_one_cover on pr_gallery_photos \(catalog_item_id\) where is_cover and status = 'approved';/.test(CODE),
    'one approved cover per item');
  const gpStart = CODE.indexOf('create table if not exists pr_gallery_photos');
  const gpTable = CODE.slice(gpStart, CODE.indexOf('\n);', gpStart));
  assert(gpStart >= 0 && gpTable.includes('check ((retired_at is null) = (retired_by is null))'), 'pr_gallery_photos pairs retired_at with retired_by');
  assert(CODE.includes('check ((gallery_review is null) = (gallery_reviewed_at is null) and (gallery_reviewed_at is null) = (gallery_reviewed_by is null));'),
    'review pair covers reviewed_by');
  assert(CODE.includes('create index if not exists pr_lines_catalog_item'), 'history lookup index on pr_lines');
});

test('item-gallery bucket: private, JPEG only, 5 MB', () => {
  assert(/values \('item-gallery', 'item-gallery', false, 5242880, array\['image\/jpeg'\]\)/.test(CODE), 'bucket row');
});

test('item-gallery has insert and select policies only — no update or delete for anyone', () => {
  const pols = [...CODE.matchAll(/create policy "item-gallery:[^"]*" on storage\.objects for (\w+)/g)].map(m => m[1]);
  assert(pols.sort().join(',') === 'insert,select,select', 'expected insert + two selects, got ' + pols);
});

test('a worker reads only approved photos of an item they may see', () => {
  const b = fnBlock('pr_can_read_gallery_path');
  assert(/pr_is_requester\(\)/.test(b) && /g\.status = 'approved'/.test(b) && /pr_history_entries\(/.test(b)
    && /attendance_data_owner\(\)/.test(b), 'must check requester, approved, company and a visible entry');
});

test('the office gallery path is tenant-locked to its own catalogue item', () => {
  const b = fnBlock('pr_office_gallery_path_ok');
  assert(/is_owner\(\) or is_staff\(\)/.test(b), 'office only');
  assert(/\(storage\.foldername\(p_name\)\)\[1\] = data_owner_id\(\)::text/.test(b), 'owner segment');
  assert(/c\.owner_id = data_owner_id\(\)/.test(b), 'item belongs to the company');
});

test('history visibility: own line, or a switched-on project; references never retired', () => {
  const b = fnBlock('pr_history_entries');
  assert(/l\.catalog_item_id is not null/.test(b), 'only matched lines');
  assert(/p_office or r\.requester_id = p_viewer or pr_history_open\(r\.folder_id, p_owner\)/.test(b), 'line rule');
  assert(/p_office or \(ir\.retired_at is null and pr_history_open\(ir\.folder_id, p_owner\)\)/.test(b), 'reference rule');
  assert(/case when p_office then r\.requester_id end/.test(b), 'requester id only for the office');
});

test('the switch is read on the top-level project of the same company', () => {
  const b = fnBlock('pr_history_open');
  assert(/s\.allow_history/.test(b) && /f\.owner_id = p_owner/.test(b) && /f\.parent_folder_id is null/.test(b), 'pr_history_open');
});

test('every function in 0090 is SECURITY DEFINER with a pinned search_path', () => {
  const fns = [...CODE.matchAll(/create or replace function[\s\S]*?\$\$;/gi)].map(m => m[0]);
  assert(fns.length > 0, 'no functions');
  for (const f of fns) {
    assert(/security definer/i.test(f), 'not SECURITY DEFINER: ' + f.slice(0, 70));
    assert(/set search_path = public/i.test(f), 'no search_path: ' + f.slice(0, 70));
  }
});

test('worker RPCs check the requester and use the worker company, never office mode', () => {
  for (const name of ['pr_history_search', 'pr_history_item', 'pr_history_visible']) {
    const b = fnBlock(name);
    assert(b, 'no function ' + name);
    assert(/pr_is_requester\(\)/.test(b), name + ' must check pr_is_requester()');
    assert(/attendance_data_owner\(\), auth\.uid\(\), false/.test(b), name + ' must call with (attendance_data_owner(), auth.uid(), false');
    assert(!/data_owner_id\(\)/.test(b), name + ' must not use the office company');
  }
});

test('search is bounded, paginated and treats % and _ literally', () => {
  const b = fnBlock('pr_history_search_doc');
  assert(/least\(greatest\(coalesce\(p_limit, 30\), 1\), 50\)/.test(b), 'limit 1..50, default 30');
  assert(/'has_more'/.test(b), 'has_more flag');
  assert(b.includes("replace(replace(replace(btrim(coalesce(p_query, '')), '\\', '\\\\'), '%', '\\%'), '_', '\\_')"), 'escapes backslash, % and _');
  for (const f of ['c.name', 'c.spec', 'c.brand', 'c.category']) assert(b.includes(f + ' ilike q.pat'), 'searches ' + f);
  assert(/unnest\(c\.aliases\) a where a ilike q\.pat/.test(b), 'searches aliases');
});

test('search: workers only get items with a visible entry; the office also finds items with none', () => {
  const b = fnBlock('pr_history_search_doc');
  assert(b.includes('(p_office and p_folder is null and p_from is null and p_to is null) or lt.catalog_item_id is not null'), 'inclusion rule');
  assert(/not v\.retired/.test(b), 'retired references never count as the latest entry');
});

test('item detail: no requester names, notes or retired photos for workers', () => {
  const b = fnBlock('pr_history_item_doc');
  assert(b.includes("'requester_name', case when p_office and e.requester_id is not null then pr_person_name(e.requester_id) end"), 'requester name office-only');
  assert(b.includes("p_office or g.status = 'approved'"), 'workers get approved photos only');
  assert(/limit 200/.test(b), 'entries are capped');
  assert(!/\bl\.notes\b/.test(b), 'never reads line notes');
});

test('item detail refuses an item the worker cannot see', () => {
  assert(/'HISTORY_NOT_AVAILABLE'/.test(fnBlock('pr_history_item')), 'HISTORY_NOT_AVAILABLE');
});

test('offline cleanup works per entry and per photo, capped at 500 items', () => {
  const b = fnBlock('pr_history_visible');
  assert(b.includes('cardinality(p_items), 0) > 500') && /'TOO_MANY_ITEMS'/.test(b), 'cap 500');
  assert(/'entries'/.test(b) && /'photo_ids'/.test(b), 'returns entry keys and photo ids');
  assert(b.includes("v.entry_kind || ':' || v.entry_id"), 'entry key = kind:id');
});

const OFFICE_RPCS_0090 = ['pr_office_save_item', 'pr_office_set_allow_history', 'pr_office_history_search',
  'pr_office_history_item', 'pr_office_add_ref', 'pr_office_retire_ref', 'pr_office_photo_queue',
  'pr_office_publish_photo', 'pr_office_keep_private', 'pr_office_add_gallery_photo', 'pr_office_set_cover',
  'pr_office_retire_photo'];

test('every 0090 office RPC refuses non-office callers', () => {
  for (const name of OFFICE_RPCS_0090) {
    const b = fnBlock(name);
    assert(b, 'no function ' + name);
    assert(/pr_is_office\(\)/.test(b), name + ' does not check pr_is_office()');
  }
});

test('office writes check the row company and record who', () => {
  for (const name of ['pr_office_add_ref', 'pr_office_retire_ref', 'pr_office_publish_photo', 'pr_office_keep_private',
                      'pr_office_add_gallery_photo', 'pr_office_set_cover', 'pr_office_retire_photo', 'pr_office_set_allow_history']) {
    const b = fnBlock(name);
    assert(/can_access\(/.test(b), name + ' must check can_access');
    // set_cover records who/when through pr_gallery_ensure_cover (cover_set_by/at).
    if (name !== 'pr_office_set_cover') assert(/auth\.uid\(\)/.test(b), name + ' must record the actor');
  }
  assert(fnBlock('pr_gallery_ensure_cover').includes('cover_set_by = auth.uid(), cover_set_at = now()'), 'the cover records who and when');
});

test('the old 7-argument save_item is dropped; aliases and brand are optional', () => {
  assert(CODE.includes('drop function if exists pr_office_save_item(uuid, text, text, text, text, text, boolean);'), 'drop old');
  const b = fnBlock('pr_office_save_item');
  assert(b.includes('p_aliases text[] default null, p_brand text default null'), 'optional new args');
  assert(b.includes('aliases = coalesce(v_aliases, aliases)') && b.includes('brand = coalesce(btrim(p_brand), brand)'),
    'null leaves aliases and brand unchanged');
  assert(/'DUPLICATE_ITEM'/.test(b) && /'BAD_ITEM'/.test(b), 'keeps the 0086 refusals');
});

test('history switch only touches allow_history', () => {
  const b = fnBlock('pr_office_set_allow_history');
  assert(b.includes('set allow_history = excluded.allow_history'), 'upsert sets allow_history');
  assert(!/allow_requests\s*=/.test(b), 'never changes allow_requests');
});

test('office reads use office mode and the office company', () => {
  assert(/pr_history_search_doc\(data_owner_id\(\), auth\.uid\(\), true/.test(fnBlock('pr_office_history_search')), 'search');
  assert(/pr_history_item_doc\(v_owner, auth\.uid\(\), true/.test(fnBlock('pr_office_history_item')), 'item');
});

test('a reference must sit on the project or one of its own Additional Works', () => {
  const b = fnBlock('pr_office_add_ref');
  assert(/f\.parent_folder_id is null/.test(b) && /c\.parent_folder_id = p_folder/.test(b), 'project/AW rule');
  assert(/'BAD_DESTINATION'/.test(b) && /'BAD_REFERENCE'/.test(b), 'refusals');
});

test('retiring needs a reason; nothing in 0090 deletes a reference or photo', () => {
  for (const name of ['pr_office_retire_ref', 'pr_office_retire_photo'])
    assert(/'REASON_REQUIRED'/.test(fnBlock(name)), name + ' needs a reason');
  assert(!/delete from pr_item_refs|delete from pr_gallery_photos|delete from storage\.objects/i.test(CODE), 'no deletes');
});

test('publishing needs the checklist and a real file at the right path, once', () => {
  const chk = fnBlock('pr_gallery_check_path');
  assert(chk.includes("o.bucket_id = 'item-gallery'") && /'FILE_MISSING'/.test(chk) && /'BAD_PATH'/.test(chk)
    && /'ALREADY_IN_GALLERY'/.test(chk), 'path check');
  for (const name of ['pr_office_publish_photo', 'pr_office_add_gallery_photo']) {
    const b = fnBlock(name);
    assert(/'CHECKLIST_REQUIRED'/.test(b) && /pr_gallery_check_path\(/.test(b), name + ' checklist + path');
  }
  assert(/'ALREADY_REVIEWED'/.test(fnBlock('pr_office_publish_photo')), 'a photo is reviewed once');
});

test('cover changes lock the catalogue item first', () => {
  for (const name of ['pr_office_publish_photo', 'pr_office_add_gallery_photo', 'pr_office_set_cover', 'pr_office_retire_photo']) {
    const b = fnBlock(name);
    const lock = b.search(/from pr_catalog_items where id = [a-z_.]+ for no key update/);
    const cover = b.indexOf('pr_gallery_ensure_cover(');
    assert(lock >= 0 && cover > lock, name + ' must lock the item before changing the cover');
  }
});

test('status is re-checked after the item lock in set_cover and retire_photo', () => {
  for (const name of ['pr_office_set_cover', 'pr_office_retire_photo']) {
    const b = fnBlock(name);
    const lock = b.indexOf('for no key update');
    const read = b.indexOf('select g.status into v_status');
    assert(lock >= 0 && read > lock, name + ' must read the status after taking the item lock');
  }
});

// A re-declared function may only GAIN lines: every original line, in order.
function missingOriginalLine(original, now) {
  const want = original.split('\n').map(s => s.trimEnd()).filter(s => s.trim() !== '');
  const have = now.split('\n').map(s => s.trimEnd());
  let j = 0;
  for (const line of want) {
    while (j < have.length && have[j] !== line) j++;
    if (j === have.length) return line;
    j++;
  }
  return null;
}
const CODE_0085 = read('supabase/migrations/0085_workmate_requests.sql').replace(/--.*$/gm, '');
const CODE_0086 = read('supabase/migrations/0086_workmate_requests_office.sql').replace(/--.*$/gm, '');

test('re-declared 0085/0086 functions keep every original line, in order', () => {
  for (const [src, name] of [[CODE_0085, 'pr_submit_request'], [CODE_0086, 'pr_request_doc'],
                             [CODE_0086, 'pr_office_catalog'], [CODE_0086, 'pr_office_projects']]) {
    const orig = fnBlockIn(src, name), now = fnBlock(name);
    assert(orig && now, 'missing ' + name);
    const lost = missingOriginalLine(orig, now);
    assert(lost === null, name + ' lost or changed the line: ' + lost);
    assert(now.split('\n').length > orig.split('\n').length, name + ' gained no lines');
  }
});

test('Request Again: malformed or unknown links refuse, stale links are dropped', () => {
  const b = fnBlock('pr_submit_request');
  assert(/'BAD_REFERENCE'/.test(b), 'BAD_REFERENCE');
  assert(b.includes("x.id = v_ref_id and x.owner_id = v_owner"), 'existence checked inside the company');
  assert(b.includes('pr_history_entries(v_owner, v_uid, false, v_item)'), 'visibility through the one rule');
  assert(/v_ref_kind := null;\s*v_ref_id := null;/.test(b), 'a stale link is dropped, not refused');
  assert(b.includes('update pr_lines set ref_kind = v_ref_kind, ref_id = v_ref_id where id = v_line_id;'), 'link stored on the line');
});

test('the office sees each line\'s source; catalogue and projects carry the new fields', () => {
  assert(fnBlock('pr_request_doc').includes("'ref_label', case when l.ref_kind is null then null else pr_ref_label(l.ref_kind, l.ref_id) end"), 'ref_label');
  assert(fnBlock('pr_office_catalog').includes("'brand', c.brand, 'aliases', to_jsonb(c.aliases),"), 'catalogue fields');
  assert(fnBlock('pr_office_projects').includes("'allow_history', coalesce(s.allow_history, false),"), 'allow_history');
  assert(CODE.includes('revoke all on function pr_ref_label(text, uuid) from public, anon, authenticated;'), 'pr_ref_label internal');
});

const GRANTED_0090 = [
  // worker
  'pr_history_search(text, text, text, uuid, date, date, integer, integer)', 'pr_history_item(uuid, uuid)',
  'pr_history_visible(uuid[])', 'pr_submit_request(uuid, jsonb)',
  // storage-policy helpers
  'pr_can_read_gallery_path(text)', 'pr_office_gallery_path_ok(text)',
  // office
  'pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text)', 'pr_office_set_allow_history(uuid, boolean)',
  'pr_office_history_search(text, text, text, uuid, date, date, integer, integer)', 'pr_office_history_item(uuid, uuid)',
  'pr_office_add_ref(uuid, uuid, uuid, text, date, text, text)', 'pr_office_retire_ref(uuid, text)', 'pr_office_photo_queue()',
  'pr_office_publish_photo(uuid, text, boolean, boolean)', 'pr_office_keep_private(uuid)',
  'pr_office_add_gallery_photo(uuid, text, boolean, boolean, uuid)', 'pr_office_set_cover(uuid)',
  'pr_office_retire_photo(uuid, text)', 'pr_office_catalog()', 'pr_office_projects()'];
const INTERNAL_0090 = [
  'pr_history_open(uuid, uuid)', 'pr_history_entries(uuid, uuid, boolean, uuid)', 'pr_entry_label(text, boolean)',
  'pr_history_search_doc(uuid, uuid, boolean, text, text, text, uuid, date, date, integer, integer)',
  'pr_history_item_doc(uuid, uuid, boolean, uuid, uuid)', 'pr_clean_aliases(text[])', 'pr_gallery_check_path(uuid, uuid, text)',
  'pr_gallery_ensure_cover(uuid, uuid)', 'pr_ref_label(text, uuid)', 'pr_request_doc(uuid, boolean)'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('every function in 0090 has exactly one permission decision', () => {
  const count = [...CODE.matchAll(/create or replace function\s+(\w+)\s*\(/gi)].length;
  assert(count === GRANTED_0090.length + INTERNAL_0090.length,
    'expected ' + (GRANTED_0090.length + INTERNAL_0090.length) + ' functions, found ' + count);
  for (const sig of GRANTED_0090) {
    assert(new RegExp('revoke all on function ' + esc(sig) + ' from public, anon;').test(CODE), 'no revoke for ' + sig);
    assert(new RegExp('grant execute on function ' + esc(sig) + ' to authenticated;').test(CODE), 'no grant for ' + sig);
  }
  for (const sig of INTERNAL_0090) {
    assert(new RegExp('revoke all on function ' + esc(sig) + ' from public, anon, authenticated;').test(CODE), 'not internal: ' + sig);
    assert(!new RegExp('grant execute on function ' + esc(sig)).test(CODE), 'internal function granted: ' + sig);
  }
});

test('nothing in 0090 is granted to anon or public', () => {
  assert(!/grant [^;]* to (anon|public)\b/i.test(CODE), 'a grant to anon/public');
});

test('the acceptance script exists, is self-rolling-back and editor-safe', () => {
  const t = read('supabase/tests/1b_acceptance.sql');
  assert(t.length > 0, 'missing supabase/tests/1b_acceptance.sql');
  assert(/^begin;$/m.test(t) && /rollback;\s*$/.test(t), 'begin … rollback');
  assert(!/create temp/i.test(t), 'no temp tables (the SQL editor breaks them)');
  assert(t.includes("'1b acceptance: all checks passed'"), 'success row');
});

test('package.json runs this suite', () => {
  assert(read('package.json').includes('node tests/workmate-history.test.js'), 'npm test does not run workmate-history');
});

// ── Tasks 2–5 append their tests above this line ──

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
