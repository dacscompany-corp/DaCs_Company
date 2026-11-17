// ════════════════════════════════════════════════════════════════════
// SPLIT VIEW TESTS: run with  node tests/split-view.test.js
//
// Zero dependencies. Loads the REAL js/split-view.js (it exports its pure
// half under Node) and fences the shared triage split-view frame used by
// the office screens (spec 2026-11-14-office-split-view-redesign-design):
//   1. Pure helpers — default tab, selection, Next, stale answers, badges.
//   2. The frame carries no money and keeps the old modal contract.
//   3. Chrome — the Requests Setup menu and the count markers.
// ════════════════════════════════════════════════════════════════════
'use strict';
const sv = require('../js/split-view.js');
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

console.log('\nsplit-view: pure helpers');

test('pillClass maps tones to the existing pill classes', () => {
  eq(sv.pillClass('done'), 'att-pill att-pill--done');
  eq(sv.pillClass('gold'), 'att-pill att-pill--working');
  eq(sv.pillClass('red'), 'att-pill att-pill--abandoned');
  eq(sv.pillClass('solidRed'), 'att-pill sv-pill--solid-red');
  eq(sv.pillClass('check'), 'att-pill att-pill--pc');
  eq(sv.pillClass('pm'), 'att-pill att-pill--pm');
  eq(sv.pillClass('none'), 'att-pill att-pill--none');
  eq(sv.pillClass('nope'), 'att-pill att-pill--none');
});

test('pickDefaultTab: saved wins, an empty needs tab gives way to the next', () => {
  const tabs = [{ id: 'attn', count: 0, needs: true }, { id: 'urgent', count: 2 }, { id: 'all', count: 5 }];
  eq(sv.pickDefaultTab(tabs, 'all'), 'all');
  eq(sv.pickDefaultTab(tabs, 'gone'), 'urgent');
  eq(sv.pickDefaultTab(tabs, null), 'urgent');
  eq(sv.pickDefaultTab([{ id: 'attn', count: 3, needs: true }, { id: 'all', count: 5 }], null), 'attn');
  eq(sv.pickDefaultTab([{ id: 'all', count: 0 }], null), 'all');
});

test('nextAfter: the following row, or the row now at the old place', () => {
  eq(sv.nextAfter(['a', 'b', 'c'], 'a', 0), 'b');
  eq(sv.nextAfter(['a', 'b', 'c'], 'c', 2), null);
  eq(sv.nextAfter(['a', 'c'], 'b', 1), 'c');   // b left the list after an action
  eq(sv.nextAfter(['a'], 'b', 5), null);
});

test('pickSelected: wanted always wins; desktop falls back to the first row, phone to nothing', () => {
  eq(sv.pickSelected(['a', 'b'], 'x', false), 'x');
  eq(sv.pickSelected(['a', 'b'], null, false), 'a');
  eq(sv.pickSelected(['a', 'b'], null, true), null);
  eq(sv.pickSelected([], null, false), null);
});

test('seq drops stale answers', () => {
  const s = sv.seq(); const a = s.next(); const b = s.next();
  ok(!s.isLatest(a) && s.isLatest(b), 'only the newest request counts');
});

test('badgeText', () => {
  eq(sv.badgeText(0), null); eq(sv.badgeText(null), null); eq(sv.badgeText(NaN), null);
  eq(sv.badgeText(7), '7'); eq(sv.badgeText(120), '99+');
});

test('flatIds keeps group order', () => {
  eq(sv.flatIds([{ rows: [{ id: 'a' }] }, { rows: [{ id: 'b' }, { id: 'c' }] }]), ['a', 'b', 'c']);
});

console.log('\nsplit-view: the frame');

const SRC = src('js/split-view.js');

test('the frame carries no money', () => ok(!/₱/.test(SRC), 'no peso sign in the frame'));

test('forms keep the modal contract', () => {
  ok(/\(opts\.errorMessage \|\| [A-Za-z_]+\)\(err\)/.test(SRC), 'errors go through opts.errorMessage');
  ok(/submit\.disabled = true/.test(SRC) && /submit\.disabled = false/.test(SRC), 'double submit blocked, re-enabled on error');
  ok(/e\.key === 'Escape'/.test(SRC), 'Escape cancels');
});

test('phone: no auto-open, a Back button', () => {
  ok(/matchMedia\('\(max-width: 720px\)'\)/.test(SRC), 'phone check');
  ok(SRC.includes('data-sv-back'), 'Back');
});

test('the browser half exports the frame', () => {
  for (const fn of ['render', 'panelHtml', 'section', 'notice', 'facts', 'history', 'pills', 'form', 'error'])
    ok(new RegExp('function ' + fn + '\\(').test(SRC), 'missing function ' + fn);
  ok(/root\.SplitView = Object\.assign\(\{\}, pure, \{[^}]*render[^}]*form/.test(SRC), 'window.SplitView carries render and form');
});

test('the frame styles exist, phone and mid width included', () => {
  const css = src('css/split-view.css');
  ok(/grid-template-columns:\s*440px minmax\(0,\s*1fr\)/.test(css), '440px list');
  ok(/@media \(max-width: 1100px\)[\s\S]*?360px/.test(css), '360px list below 1100px');
  ok(/@media \(max-width: 720px\)/.test(css), 'phone layout');
  ok(css.includes('.sv-pill--solid-red'), 'solid red pill');
  ok(/prefers-reduced-motion/.test(css), 'reduced motion');
});

console.log('\nsplit-view: chrome — Setup menu and counts');

test('Requests Setup group and the Queue count marker', () => {
  const nav = src('js/admin.js');
  const block = nav.slice(nav.indexOf("id: 'requests'"), nav.indexOf("id: 'workplan'"));
  for (const v of ['reqBatches', 'reqTeams', 'reqCatalog', 'reqHistory', 'reqProjects'])
    ok(new RegExp("view: '" + v + "'[^}]*group: 'setup'").test(block), v + ' is under Setup');
  for (const v of ['reqQueue', 'reqPurchasing', 'reqStock', 'reqTools'])
    ok(!new RegExp("view: '" + v + "'[^}]*group: 'setup'").test(block), v + ' stays in the row');
  ok(/view: 'reqQueue'[^}]*count: 'requests'/.test(block), 'Queue carries the count');
});

test('counts are fetched only for sections the account can see', () => {
  const nav = src('js/admin.js');
  ok(/_visibleNav\(\)[\s\S]{0,200}\.filter\(p => p\.modules\.some\(m => m\.count\)\)/.test(nav), 'visible counted sections only');
  ok(nav.includes('NavCounts.refresh('), 'refreshed from the chrome');
  ok(nav.includes('data-nav-count='), 'badge spans drawn by the chrome');
});

test('NavCounts paints through badgeText and never shows a failed count', () => {
  ok(/function paint\(/.test(SRC) && /badgeText\(/.test(SRC.slice(SRC.indexOf('function paint('))), 'paint uses badgeText');
  ok(/catch \([a-z]+\) \{\s*set\(section, null\)/.test(SRC), 'a failed loader clears the badge');
  ok(/root\.NavCounts = \{/.test(SRC), 'window.NavCounts');
});

console.log('\nsplit-view: review fixes');

test('pickDefaultTab: an empty needs tab gives way to the first non-empty later tab', () => {
  // Queue: Urgent / To resolve / To arrange are subsets of Needs action, so they are empty too.
  eq(sv.pickDefaultTab([{ id: 'attn', count: 0, needs: true }, { id: 'urgent', count: 0 }, { id: 'arranged', count: 2 }, { id: 'all', count: 2 }], null), 'arranged');
  eq(sv.pickDefaultTab([{ id: 'attn', count: 0, needs: true }, { id: 'urgent', count: 0 }, { id: 'all', count: 0 }], null), 'urgent');
});

test('panelPlan: the same item keeps its panel; only a refresh reloads it', () => {
  eq(sv.panelPlan('a', 'a', 'a', false), { reuse: true, reload: false });   // search keystroke, filter, tab change
  eq(sv.panelPlan('a', 'a', 'a', true), { reuse: true, reload: true });     // after an action
  eq(sv.panelPlan('a', 'a', 'b', false), { reuse: false, reload: true });   // another item
  eq(sv.panelPlan(null, null, 'a', false), { reuse: false, reload: true }); // first show
  eq(sv.panelPlan('a', 'a', null, false), { reuse: false, reload: false }); // nothing selected
});

test('nextFrom: Next follows the order the user saw when they chose the item', () => {
  // b was arranged and moved to the bottom group: Next is c, not nothing.
  eq(sv.nextFrom(['a', 'b', 'c', 'd'], 'b', ['a', 'c', 'd', 'b'], 3), 'c');
  // b left the list: still c.
  eq(sv.nextFrom(['a', 'b', 'c', 'd'], 'b', ['a', 'c', 'd'], 1), 'c');
  // c also left meanwhile: d.
  eq(sv.nextFrom(['a', 'b', 'c', 'd'], 'b', ['a', 'd'], 1), 'd');
  // no snapshot: plain nextAfter.
  eq(sv.nextFrom(null, 'a', ['a', 'b'], 0), 'b');
  // end of the old order: nothing.
  eq(sv.nextFrom(['a', 'b'], 'b', ['a', 'b'], 1), null);
});

test('render keeps the panel element and Next/Back read the latest state', () => {
  ok(/panelPlan\(/.test(SRC.slice(SRC.indexOf('function render('))), 'render uses panelPlan');
  ok(/cfg\.refreshPanel/.test(SRC), 'screens ask for a reload with refreshPanel');
  ok(/panel\._svBound/.test(SRC) && /panel\._svState = /.test(SRC), 'one Next/Back listener per panel, fed the latest state');
});

test('a panel error keeps Back on phones', () => {
  const fn = SRC.slice(SRC.indexOf('function error('), SRC.indexOf('function defaultMessage('));
  ok(/sv-panel/.test(fn) && /data-sv-back/.test(fn), 'error() adds Back when it fills a panel');
});

console.log('\nsplit-view: wired into admin.html');

test('the frame is loaded before the Requests scripts, cache-busted', () => {
  const h = src('admin.html');
  ok(h.includes('css/split-view.css?v=20261114c') && h.includes('js/split-view.js?v=20261114c'), 'tags');
  ok(h.indexOf('js/split-view.js') < h.indexOf('js/requests-admin-core.js'), 'order');
  ok(h.indexOf('css/split-view.css') > h.indexOf('css/admin-renovation.css'), 'frame styles after the shared renovation styles');
  for (const f of ['js/admin.js', 'js/requests-admin-core.js', 'js/requests-admin-queue.js', 'js/requests-admin-detail.js', 'css/requests-admin.css'])
    ok(h.includes(f + '?v=20261114c'), f + ' cache-busted');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
