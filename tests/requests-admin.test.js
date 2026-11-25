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
const fs = require('fs');
const path = require('path');
const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
function ok(cond, msg) { if (!cond) throw new Error(msg); }

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

test('a cancelled line with a reduction to resolve keeps its batch and cutoff', () => {
  const s = ra.requestSummary(req({ lines: [line({ status: 'cancelled', portions: [portion({
    batch_id: 'b7', arranged: true, pending_reduction: 4, cutoff_at: '2026-10-03T04:00:00+00:00' })] })] }));
  eq(s.batchIds, ['b7']);
  eq(s.firstCutoff, '2026-10-03T04:00:00+00:00');
  eq([s.openLines, s.actionLines, s.reductions], [0, 1, 1]);
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

test('errorMessage maps every 0086 and 0090 code and never matches a code inside another', () => {
  const codes = ['OFFICE_ONLY', 'NOT_FOUND', 'LINE_CLOSED', 'REDUCTION_PENDING', 'NOTHING_PENDING', 'ALREADY_RESOLVED', 'BAD_QUANTITY',
    'REASON_REQUIRED', 'BAD_CATALOG_ITEM', 'BAD_BATCH', 'BAD_DATES', 'ARRANGED', 'NOT_A_TEAM_LEADER', 'NOT_IN_TEAM', 'DUPLICATE_ITEM',
    'DUPLICATE_TEAM', 'BAD_ITEM', 'BAD_OUTCOME', 'BAD_TEAM', 'BAD_WORKER',
    'HISTORY_NOT_AVAILABLE', 'BAD_REFERENCE', 'BAD_DESTINATION', 'CHECKLIST_REQUIRED', 'BAD_PATH', 'FILE_MISSING',
    'ALREADY_IN_GALLERY', 'ALREADY_REVIEWED', 'NOT_MATCHED', 'PHOTO_RETIRED', 'TOO_MANY_ITEMS', 'NO_PHOTO', 'UPLOAD_FAILED',
    'ITEM_IN_USE'];
  eq(Object.keys(ra.ERRORS).sort(), codes.slice().sort());
  for (const c of codes) eq(ra.errorMessage({ message: c }), ra.ERRORS[c], c);
  eq(ra.errorMessage({ message: 'BAD_CATALOG_ITEM' }), ra.ERRORS.BAD_CATALOG_ITEM);
  eq(ra.errorMessage({ message: 'NOT_A_TEAM_LEADER' }), ra.ERRORS.NOT_A_TEAM_LEADER);
  eq(ra.errorMessage({ message: 'UPLOAD_FAILED: network error' }), ra.ERRORS.UPLOAD_FAILED);
  eq(ra.errorMessage({ message: 'boom' }), 'Something went wrong: boom');
  eq(ra.errorMessage(null), 'Something went wrong: unknown error');
});

console.log('\nrequests-admin: people');

test('workerNo is the W-0007 roster number, blank when unknown', () => {
  eq(ra.workerNo(7), 'W-0007');
  eq(ra.workerNo('21'), 'W-0021');
  eq(ra.workerNo(12345), 'W-12345');
  eq(ra.workerNo(null), '');
  eq(ra.workerNo(undefined), '');
  eq(ra.workerNo(0), '');
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

console.log('\nrequests-admin: item history (0090)');

test('parseAliases trims, drops blanks and keeps one per spelling', () => {
  eq(ra.parseAliases(' saksakan, Plug\n\nplug ,SAKSAKAN, outlet '), ['saksakan', 'Plug', 'outlet']);
  eq(ra.parseAliases(''), []);
  eq(ra.parseAliases(null), []);
});

test('aliasesProblem uses the server caps (20 aliases, 60 characters each)', () => {
  eq(ra.aliasesProblem(['a']), null);
  eq(ra.aliasesProblem(Array.from({ length: 20 }, (_, i) => 'a' + i)), null);
  eq(ra.aliasesProblem(Array.from({ length: 21 }, (_, i) => 'a' + i)), 'BAD_ITEM');
  eq(ra.aliasesProblem(['x'.repeat(61)]), 'BAD_ITEM');
});

test('entryDateLabel: an exact day, "around" a month, or Date unknown — never shifted a day', () => {
  eq(ra.entryDateLabel({ date: '2026-10-03', date_precision: 'exact' }), '3 Oct 2026');
  eq(ra.entryDateLabel({ date: '2026-08-01', date_precision: 'approximate' }), 'around Aug 2026');
  eq(ra.entryDateLabel({ date: null, date_precision: 'unknown' }), 'Date unknown');
  eq(ra.entryDateLabel({ date: null, date_precision: 'exact' }), 'Date unknown');
  eq(ra.entryDateLabel(null), 'Date unknown');
});

test('entryPill: requested, cancelled, reference and retired read differently', () => {
  eq(ra.entryPill({ label: 'Requested' }), 'att-pill--done');
  eq(ra.entryPill({ label: 'Requested — cancelled' }), 'att-pill--hidden');
  eq(ra.entryPill({ label: 'Historical reference' }), 'att-pill--pc');
  eq(ra.entryPill({ label: 'Historical reference', retired: true }), 'att-pill--hidden');
});

test('refProblem mirrors pr_office_add_ref: a description, and a date exactly when not unknown', () => {
  eq(ra.refProblem({ description: 'x', precision: 'exact', date: '2026-10-03' }), null);
  eq(ra.refProblem({ description: 'x', precision: 'approximate', date: '2026-08-01' }), null);
  eq(ra.refProblem({ description: 'x', precision: 'unknown', date: '' }), null);
  eq(ra.refProblem({ description: '  ', precision: 'exact', date: '2026-10-03' }), 'BAD_REFERENCE');
  eq(ra.refProblem({ description: 'x', precision: 'unknown', date: '2026-10-03' }), 'BAD_REFERENCE');
  eq(ra.refProblem({ description: 'x', precision: 'approximate', date: '' }), 'BAD_REFERENCE');
  eq(ra.refProblem({ description: 'x', precision: 'later', date: '2026-10-03' }), 'BAD_REFERENCE');
});

test('galleryPath is <company>/<item>/<uuid>.jpg in lower case, and needs a company', () => {
  eq(ra.galleryPath('AAAA-1', 'BBBB-2', 'CCCC-3'), 'aaaa-1/bbbb-2/cccc-3.jpg');
  let threw = false;
  try { ra.galleryPath(null, 'b', 'c'); } catch (e) { threw = true; }
  eq(threw, true, 'no company');
});

console.log('\nrequests-admin: catalogue, projects and request detail (0090)');

test('the catalogue form sends aliases and brand, checked against the server caps', () => {
  const s = src('js/requests-admin-setup.js');
  ok(s.includes('RA.parseAliases(form.aliases.value)'), 'aliases parsed from the form');
  ok(s.includes('RA.aliasesProblem(aliases)'), 'aliases capped before sending');
  ok(s.includes('p_aliases: aliases,') && s.includes('p_brand: form.brand.value.trim(),'), 'save sends p_aliases and p_brand');
  ok(/\[i\.name, i\.spec, i\.unit, i\.category, i\.brand\]\.concat\(i\.aliases \|\| \[\]\)/.test(s), 'catalogue search includes brand and aliases');
});

test('the Projects tab switches Item history separately from Allow requests', () => {
  const s = src('js/requests-admin-setup.js');
  ok(s.includes("RA.rpc('pr_office_set_allow_history', { p_folder: proj.folder_id, p_allow: !proj.allow_history })"), 'calls pr_office_set_allow_history');
  ok(s.includes("aria-checked=\"' + (p.allow_history ? 'true' : 'false')"), 'the switch reflects allow_history');
  ok(s.includes("RA.rpc('pr_office_set_allow_requests', { p_folder: project.folder_id, p_allow: !project.allow_requests })"), 'Allow requests unchanged');
  // History outlives the job: unlike Allow requests, the history switch is never disabled for a completed project.
  ok(!/data-history="' \+ esc\(p\.folder_id\) \+ '"' \+ \(p\.completed/.test(s), 'history switch stays usable on completed projects');
});

test('a request line shows where Request Again came from', () => {
  ok(src('js/requests-admin-detail.js').includes("(line.ref_label ? fact('Requested again from', esc(line.ref_label)) : '')"), 'detail renders ref_label');
});

test('setup uses the shared RA.head', () => {
  ok(!/function head\(/.test(src('js/requests-admin-setup.js')), 'no private head() left in setup');
});

console.log('\nrequests-admin: item history screen (0090)');

test('Item history is wired into the Requests section', () => {
  const html = src('admin.html'), nav = src('js/admin.js');
  ok(html.includes('<div id="reqHistoryView"     class="content-view" style="display: none;"></div>'), 'view host');
  ok(/const REQ_VIEWS\s*=\s*\[[^\]]*'reqHistory'/.test(html), 'REQ_VIEWS lists reqHistory');
  ok(/reqHistory:\s*'Item history'/.test(html), 'title');
  const core = html.indexOf('js/requests-admin-core.js'), hist = html.indexOf('js/requests-admin-history.js');
  ok(core > 0 && hist > core, 'the history script loads after the core');
  // requests-admin.css changed again by the Requests Queue update (PR #48, 25 Nov 2026).
  ok(html.includes('css/requests-admin.css?v=20261125a') && html.includes('js/requests-admin-history.js?v=20261116b'), 'cache-busted');
  const start = nav.indexOf("id: 'requests'");
  const block = nav.slice(start, nav.indexOf(']', start));
  ok(block.includes("{ view: 'reqHistory'"), 'PRIMARY_NAV Requests lists reqHistory');
});

test('the history screen writes only through 0090 office RPCs and warns about reference text', () => {
  const s = src('js/requests-admin-history.js');
  ok(/RA\.views\.reqHistory = host => root\.SplitView\.render\(host, \{[\s\S]{0,500}onCustom: el => render\(el\)/.test(s),
     'registers the view (office v5: inside the frame, its own content kept)');
  const rpcs = [...s.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]);
  const allowed = ['pr_office_projects', 'pr_office_catalog', 'pr_office_history_search', 'pr_office_history_item',
                   'pr_office_add_ref', 'pr_office_retire_ref'];
  ok(rpcs.length > 0 && rpcs.every(r => allowed.includes(r)), 'unexpected RPC: ' + rpcs.filter(r => !allowed.includes(r)).join(', '));
  ok(!/\.(insert|update|delete|upsert|remove)\(/.test(s), 'no direct writes');
  ok(!/\.from\('pr_/.test(s), 'no direct pr_ table access');
  ok(s.includes("root.sbClient.from('folders').select('id, name, completed_at')"), 'reads Additional Works from folders only');
  ok(s.includes('RA.refProblem(ref)'), 'checks a reference before sending it');
  ok(/Never type a price, an amount or a person/.test(s), 'warns that workers read the reference text');
});

console.log('\nrequests-admin: gallery photos (0090)');

test('every gallery photo passes the three checks before anything is uploaded', () => {
  const s = src('js/requests-admin-gallery.js');
  const checks = /const CHECKS = \[([\s\S]*?)\];/.exec(s);
  ok(checks && (checks[1].match(/'/g) || []).length === 6, 'exactly three checks');
  ok((s.match(/if \(!checklistOk\(form\)\) throw new Error\('CHECKLIST_REQUIRED'\);/g) || []).length === 2,
     'both the upload and the approve-copy forms refuse without all three ticks');
  for (const fn of ['uploadModal', 'approveModal']) {
    const body = s.slice(s.indexOf('function ' + fn), s.indexOf('onDone', s.indexOf('function ' + fn)));
    ok(body.indexOf('checklistOk(form)') < body.indexOf('storeCopy('), fn + ' checks before it stores');
  }
});

test('photos are re-encoded and stored only in item-gallery, never overwritten or deleted', () => {
  const s = src('js/requests-admin-gallery.js');
  ok(s.includes('root.DacsReceipts.compressToBlob(source, 1200, 0.8)'), 're-encoded (drops camera metadata such as GPS)');
  ok(s.includes('RA.galleryPath(root.currentDataUserId, itemId, root.DacsReceipts.newId())'), '<company>/<item>/<uuid>.jpg');
  const uploads = [...s.matchAll(/storage\.from\(([A-Z_]+)\)\.upload\(/g)].map(m => m[1]);
  ok(uploads.length === 1 && uploads[0] === 'GALLERY', 'one upload, to item-gallery');
  ok(s.includes("{ upsert: false, contentType: 'image/jpeg' }"), 'never overwrites');
  ok(!/from\(REQUEST_PHOTOS\)\.(upload|remove|update|move|copy)\(/.test(s), 'the worker\'s original is only read');
  ok(!/\.remove\(|\.delete\(/.test(s), 'nothing is deleted');
});

test('the gallery screen writes only through 0090 office RPCs', () => {
  const s = src('js/requests-admin-gallery.js');
  ok(s.includes('RA.gallery = { uploadModal, setCover, retireModal, renderReview };'), 'exports RA.gallery');
  const rpcs = [...s.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]);
  const allowed = ['pr_office_add_gallery_photo', 'pr_office_set_cover', 'pr_office_retire_photo',
                   'pr_office_photo_queue', 'pr_office_publish_photo', 'pr_office_keep_private'];
  ok(rpcs.length === allowed.length && allowed.every(r => rpcs.includes(r)), 'RPCs: ' + rpcs.join(', '));
  ok(!/\.from\('pr_/.test(s), 'no direct pr_ table access');
  const html = src('admin.html');
  ok(html.indexOf('js/requests-admin-gallery.js?v=20261116b') > html.indexOf('js/requests-admin-core.js'), 'loaded after the core');
});

test('0092: an item already used in requests opens with kind and unit locked, and says why', () => {
  const setup = src('js/requests-admin-setup.js');
  ok(setup.includes('const locked = !!(item && item.in_use);'), 'locked comes from in_use');
  ok(setup.includes('id="reqKind" name="kind"\' + (locked ? \' disabled\' : \'\') + \'>'), 'kind disabled when locked');
  ok(/id="reqUnit"[^\n]*\(locked \? ' disabled' : ''\)/.test(setup), 'unit disabled when locked');
  ok(setup.includes('kind and unit are locked'), 'the form says why');
  ok(ra.ERRORS.ITEM_IN_USE.includes('new item') && ra.ERRORS.ITEM_IN_USE.includes('deactivate'), 'the refusal tells the office what to do');
});

test('office v5: a batch pop-up shows the new dates after Change dates…', () => {
  const s = src('js/requests-admin-setup.js');
  const batches = s.slice(s.indexOf('async function renderBatches('), s.indexOf('// ── Teams'));
  ok(/onDone: \(\) => renderBatches\(host, \{ refreshPanel: true \}\)/.test(batches), 'the save redraws the open batch');
  ok(/refreshPanel: !!\(o && o\.refreshPanel\)/.test(batches), 'and the frame is told to reload it, with the new record');
});

test('office v5: the Item history count follows the photos the screen just loaded', () => {
  const g = src('js/requests-admin-gallery.js');
  const review = g.slice(g.indexOf('async function renderReview('), g.indexOf('RA.gallery = {'));
  ok(/root\.NavCounts\.set\('history', queue\.length\)/.test(review), 'reviewing the last photo clears the badge without a reload');
});

console.log('\nrequests-admin: what the Teams screen says about a team with no leader');

test('a team with no leader is not described as unable to send', () => {
  const s = src('js/requests-admin-setup.js');
  ok(!/once it has a leader/.test(s), 'the page intro');
  ok(!/this team can\\'t send requests' \+/.test(s), 'the card warning');
  ok(!/no leader and can\\'t send requests/.test(s), 'the two confirm messages');
  ok(!/without one cannot send/.test(s), 'the comment above the cards');
  const note = "const NO_LEADER_NOTE = 'Requests still reach the office, but no leader sees them or checks the team\\'s work.';";
  ok(s.includes(note), 'one sentence says what really happens');
  ok(s.split('NO_LEADER_NOTE').length - 1 === 4, 'card and both confirm messages use it');
});

test('the screen matches the server: membership sends, a turned-off team is refused', () => {
  const m90 = src('supabase/migrations/0090_workmate_item_history.sql').replace(/\r/g, '');
  const submit = m90.slice(m90.indexOf('create or replace function pr_submit_request'));
  const teamCheck = submit.slice(submit.indexOf("v_team := nullif(p_request ->> 'team_id', '')"), submit.indexOf("raise exception 'NO_LINES'"));
  ok(teamCheck.includes('pr_is_current_member(v_team, v_uid)'), 'a team request needs current membership');
  ok(!/leader/i.test(teamCheck), 'if sending ever needs a leader, change NO_LEADER_NOTE too');
  const m85 = src('supabase/migrations/0085_workmate_requests.sql').replace(/\r/g, '');
  const member = m85.slice(m85.indexOf('create or replace function pr_is_current_member'), m85.indexOf('create or replace function pr_is_current_leader'));
  ok(/m\.removed_at is null and t\.active/.test(member), 'a turned-off team has no current members');
  ok(src('js/requests-admin-setup.js').includes("Inactive — this team can\\'t send requests."), 'and the screen says so');
});

console.log('\nrequests-admin: split-view queue (office redesign, Phase 1)');

test('queue tabs follow the existing "needs action" rule', () => {
  const todo = req({}), done = req({ lines: [line({ portions: [portion({ arranged: true })] })] });
  const clash = req({ lines: [line({ open_conflicts: [{ id: 'k' }] })] });
  const red = req({ lines: [line({ portions: [portion({ arranged: true, pending_reduction: 2 })] })] });
  const urgentDone = req({ lines: [line({ urgent: true, needed_by: '2026-10-01', portions: [portion({ arranged: true })] })] });
  eq([todo, done, clash, red].map(r => ra.inQueueTab(r, 'attn')), [true, false, true, true]);
  eq([clash, red, todo].map(r => ra.inQueueTab(r, 'resolve')), [true, true, false]);
  eq(ra.inQueueTab(todo, 'arrange'), true); eq(ra.inQueueTab(done, 'arranged'), true);
  eq(ra.inQueueTab(urgentDone, 'urgent'), false);
  eq(ra.queueCounts([todo, done, clash, red]), { attn: 3, urgent: 0, resolve: 2, arrange: 1, arranged: 1, all: 4 });
  eq(ra.QUEUE_TABS.map(t => t[0]), ['attn', 'urgent', 'resolve', 'arrange', 'arranged', 'all']);
});

test('requestState moved to the core unchanged', () => {
  eq(ra.requestState(req({})), 'unarranged');
  eq(ra.requestState(req({ lines: [line({ portions: [portion({ arranged: true })] }), line({ id: 'l2' })] })), 'partly');
  eq(ra.requestState(req({ lines: [line({ status: 'cancelled' })] })), 'cancelled');
  ok(!/function requestState\(/.test(src('js/requests-admin-queue.js')), 'no second copy left in the queue');
});

test('overdue is a Manila calendar comparison', () => {
  const u = req({ lines: [line({ urgent: true, needed_by: '2026-10-09' })] });
  eq(ra.isOverdue(u, '2026-10-10'), true); eq(ra.isOverdue(u, '2026-10-09'), false);
  eq(ra.isOverdue(req({}), '2026-10-10'), false);
  eq(ra.manilaDayKey(Date.parse('2026-10-09T17:00:00Z')), '2026-10-10');
  eq(ra.manilaDayKey(Date.parse('2026-10-09T15:59:00Z')), '2026-10-09');
});

test('a request opens in the Queue panel, never a page of its own', () => {
  const core = src('js/requests-admin-core.js');
  ok(/function openRequest\(id\) \{[\s\S]{0,120}root\.switchView\('reqQueue'\)/.test(core), 'openRequest → reqQueue');
  ok(core.includes("views.reqDetail = () => root.switchView('reqQueue')"), 'old route redirects');
});

test('requestNextStep: a button only for exactly one existing next step', () => {
  const today = '2026-11-16';
  let s = ra.requestNextStep(req({}), today);
  eq(s, { text: 'Nothing is arranged yet for this request.', label: 'Mark arranged', act: { act: 'arrange', portion: 'p' } });
  s = ra.requestNextStep(req({ lines: [line({}), line({ id: 'l2', portions: [portion({ id: 'p2' })] })] }), today);
  eq(s, { text: '2 portions are still to arrange. Mark each one arranged on its item.', label: null, act: null });
  s = ra.requestNextStep(req({ lines: [line({ portions: [portion({ arranged: true })] }), line({ id: 'l2', portions: [portion({ id: 'p2' })] })] }), today);
  eq(s, { text: 'One portion is still to arrange.', label: 'Mark arranged', act: { act: 'arrange', portion: 'p2' } });
  s = ra.requestNextStep(req({ lines: [line({ urgent: true, needed_by: '2026-11-10' })] }), today);
  eq(s.text, 'Needed Tue 10 Nov. Arrange it now or tell the worker when it will arrive.'); eq(s.label, 'Mark arranged');
  s = ra.requestNextStep(req({ lines: [line({ position: 2, open_conflicts: [{ id: 'k' }] })] }), today);
  eq(s, { text: 'One item has an offline edit that needs your decision. Choose Apply or Keep on item 3.', label: null, act: null });
  s = ra.requestNextStep(req({ lines: [line({ unit: 'gal', portions: [portion({ id: 'p9', arranged: true, quantity: 4, pending_reduction: 2 })] })] }), today);
  eq(s, { text: '4 gal was arranged; the request now needs 2 gal less. Say what happened to the order.', label: 'Resolve reduction…', act: { act: 'reduction', portion: 'p9', line: 'l' } });
  eq(ra.requestNextStep(req({ lines: [line({ portions: [portion({ arranged: true })] })] }), today), null);
  eq(ra.requestNextStep(req({ status: 'cancelled' }), today), null);
});

test('Queue cards carry the next step; the pop-up closes cleanly', () => {
  const q = src('js/requests-admin-queue.js');
  ok(/RA\.requestNextStep\(r, today\)/.test(q) && /nextLabel:/.test(q), 'rowOf asks the core');
  ok(/onClose: \(\) => \{[^}]*ui\.selectedId = null/.test(q), 'closing forgets the request');
  ok(/onSelect: \(id, panel, opts\)/.test(q) && /start: opts && opts\.start \?/.test(q), 'start passed to the item');
  ok(/toolbar: batchSelect\(\)/.test(q) && /showing:/.test(q), 'toolbar and showing');
  for (const s of ['What the labels on a request mean', 'Needed soonest first.', 'A reduction or an offline edit is waiting for your decision.',
    'Nothing arranged yet, or only partly.', 'Closed requests load separately.', 'Requests with something still to arrange or to resolve.'])
    ok(q.includes(s), 'missing: ' + s);
});

test('Queue keeps everything it had (v5)', () => {
  const q = src('js/requests-admin-queue.js');
  for (const s of ['Request queue', 'urgent first, then by weekly batch', 'Change batch dates',
    'Requests received after the cutoff go to the next week.', 'Showing the newest 300 requests',
    'All weekly batches', 'Search worker, project, item…', 'Clear filters', 'Closed',
    'No open requests. New ones appear here as soon as a worker sends them.', 'No closed requests yet.',
    'Needed soonest first', 'Waiting on the office', 'Nothing left to arrange', 'This week', 'OVERDUE'])
    ok(q.includes(s), 'missing: ' + s);
  ok(q.includes('SplitView.render('), 'drawn by the shared frame');
  ok(q.includes("RA.rpc('pr_office_queue'") && q.includes("RA.rpc('pr_office_batches')"), 'same RPCs');
  ok(/showQueueForBatch = function[\s\S]{0,300}ui\.tab = 'all'/.test(q), 'View in queue shows every open request of the batch');
  ok(q.includes("NavCounts.register('requests'"), 'badge loader');
  ok(!/<table/.test(q), 'the old table is gone');
});

test('one request keeps every action, now in the panel', () => {
  const d = src('js/requests-admin-detail.js');
  for (const r of ['pr_office_request', 'pr_office_set_arranged', 'pr_office_move_portion', 'pr_office_resolve_reduction',
    'pr_office_change_quantity', 'pr_office_cancel_line', 'pr_office_resolve_conflict', 'pr_office_match_item',
    'pr_office_batches', 'pr_office_catalog'])
    ok(d.includes("RA.rpc('" + r + "'"), 'missing RPC ' + r);
  for (const s of ['Mark arranged', 'Move…', 'Undo arranged', 'Resolve reduction…', 'Change quantity…', 'Cancel item…',
    'Still needed', 'Why urgent', 'Drafted on phone', 'Offline edit needs a decision.', 'The supplier order was reduced',
    'Kept the full order — the extra is surplus', 'Missing? Add it in Requests → Catalogue first.', 'No history yet.'])
    ok(d.includes(s), 'missing: ' + s);
  ok(!d.includes('RA.modal('), 'no pop-up forms left');
  ok((d.match(/SplitView\.form\(panel/g) || []).length === 6, 'six forms in the panel');
  ok(d.includes('RA.renderRequestPanel = '), 'exported for the queue');
});

test('one request: What to do now uses the real button, and start presses only that', () => {
  const d = src('js/requests-admin-detail.js');
  ok(/RA\.requestNextStep\(req, today\)/.test(d), 'the fresh request decides');
  ok(/SV\.nextStep\(/.test(d) && /step:/.test(d), 'the box is drawn');
  ok(/data-act="' \+ esc\(step\.act\.act\) \+ '"/.test(d), 'its button carries the same data-act as the real one');
  ok(/hooks\.start[\s\S]{0,200}querySelector\('\.sv-step \[data-act\]'\)/.test(d), 'start presses the box button only');
});

test('sameStep: a card button only starts the exact step it showed', () => {
  eq(ra.sameStep({ act: 'arrange', portion: 'p' }, { act: 'arrange', portion: 'p' }), true);
  eq(ra.sameStep({ act: 'arrange', portion: 'p' }, { act: 'arrange', portion: 'p2' }), false);
  eq(ra.sameStep({ act: 'reduction', portion: 'p' }, { act: 'arrange', portion: 'p' }), false);
  eq(ra.sameStep(null, { act: 'arrange', portion: 'p' }), false);
  eq(ra.sameStep({ act: 'arrange', portion: 'p' }, null), false);
});

test('review fixes: the card passes its step; a closed or replaced pop-up never runs it', () => {
  const q = src('js/requests-admin-queue.js'), d = src('js/requests-admin-detail.js');
  ok(/start: opts && opts\.start \? cardStep\(id\) : null/.test(q), 'the queue passes the step the card showed');
  ok(/RA\.sameStep\(want, \{ act: go\.dataset\.act, portion: go\.dataset\.portion \}\)/.test(d), 'only that exact step is pressed');
  ok(/ctx\.stillShowing\(\)/.test(d.slice(d.indexOf('if (hooks.start)'))), 'and only while the pop-up still shows this request');
  ok(/stillShowing: \(\) => panel\.isConnected && panel\.dataset\.svId === req\.id/.test(d), 'a replaced or closed panel no longer counts');
  const r = d.slice(d.indexOf('async function renderRequestPanel('));
  ok(/if \(!panel\.isConnected \|\| panel\.dataset\.svId !== id\) return;/.test(r), 'a late answer for a closed pop-up is dropped');
});

test('every save says what it did', () => {
  const d = src('js/requests-admin-detail.js');
  ok((d.match(/doneText:/g) || []).length === 6, 'six forms with a toast');
  for (const s of ['Quantity changed', 'Item cancelled', 'Reduction resolved', 'Moved to another weekly batch',
    'Applied the offline edit', 'Kept the current quantity; offline edit not applied', 'Matched to a catalogue item'])
    ok(d.includes(s), 'missing toast: ' + s);
  ok(/SV\.toast\('Marked '/.test(d) && d.includes('Undid "arranged"'), 'one-press actions too');
});

console.log('\nrequests-admin: review fixes (Phase 1)');

test('every page wrapper class the screens use still has its CSS', () => {
  const css = ['css/requests-admin.css', 'css/purchasing-admin.css', 'css/attendance-admin.css', 'css/workplan-admin.css', 'css/split-view.css']
    .map(src).join('\n');
  const used = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'js')).filter(n => n.endsWith('.js'))) {
    for (const m of src('js/' + f).matchAll(/class="att-stack ([a-z0-9 -]+)"/g)) m[1].split(' ').forEach(c => c && used.add(c));
  }
  ok(used.has('req-detail'), 'Purchasing / Stock / Tools wrap their pages in req-detail');
  for (const c of used) ok(new RegExp('\\.' + c + '\\b').test(css), 'no CSS left for .' + c);
  ok(/\.req-detail \{[^}]*font-family: var\(--att-sans\)/.test(src('css/requests-admin.css')), 'req-detail keeps the sans font (prices must not render in Playfair)');
});

test('the Queue reloads its panel only after an action, and never sticks an automatic tab', () => {
  const q = src('js/requests-admin-queue.js');
  ok(/async function load\([\s\S]*?draw\(\{ refreshPanel: true \}\)/.test(q), 'load() redraws with refreshPanel');
  ok(/refreshPanel: !!\(opts && opts\.refreshPanel\)/.test(q), 'draw passes it to the frame');
  ok(/function onTab\(id\) \{[\s\S]{0,300}ui\.tab = id/.test(q), 'a tab the user picks is kept');
  ok(!/if \(!closed\) ui\.tab = tab/.test(q), 'an automatic pick is not stored as the user\'s');
  ok(/function renderQueue\(el\) \{[\s\S]{0,200}visitTab = null/.test(q), 'the automatic pick lasts one visit');
});

test('Move… and Match open their form only if the panel still shows that request', () => {
  const d = src('js/requests-admin-detail.js');
  for (const fn of ['moveForm', 'matchForm']) {
    const body = d.slice(d.indexOf('async function ' + fn), d.indexOf('root.SplitView.form(panel', d.indexOf('async function ' + fn)));
    ok(/if \(!ctx\.stillShowing\(\)\) return;/.test(body), fn + ' re-checks after its RPC');
  }
  ok(/stillShowing: \(\) => panel\.isConnected && panel\.dataset\.svId === req\.id/.test(d), 'stillShowing compares the (still connected) panel with this request');
});

test('phones keep the stacked batch row inside the panel', () => {
  const c = src('css/requests-admin.css');
  ok(/@media \(min-width: 761px\) \{[^}]*\.sv-panel \.req-portion \{/.test(c), 'the 3-column panel row only above the phone breakpoint');
});

// ── SUMMARY (keep last) ──
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
