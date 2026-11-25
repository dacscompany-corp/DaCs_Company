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
// The body of one CSS rule, found by its exact selector ('' when absent).
const rule = (css, sel) => { const i = css.indexOf(sel + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };

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

test('pickSelected: only an item asked for opens; nothing opens by itself', () => {
  eq(sv.pickSelected(['a', 'b'], 'x'), 'x');
  eq(sv.pickSelected(['a', 'b'], null), null);
  eq(sv.pickSelected([], null), null);
});

test('navTotal: the sum of the counts the account sees; zero or failed adds nothing', () => {
  eq(sv.navTotal({ requests: 3, buy: 2 }, ['requests', 'buy']), 5);
  eq(sv.navTotal({ requests: 3, buy: null }, ['requests', 'buy']), 3);
  eq(sv.navTotal({ requests: 0 }, ['requests']), null);
  eq(sv.navTotal({}, ['requests']), null);
  eq(sv.navTotal({ requests: 3, stock: 4 }, ['requests']), 3);
  eq(sv.navTotal({ a: NaN, b: -1, c: 2 }, ['a', 'b', 'c']), 2);
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

test('one pop-up on <body>, a real dialog', () => {
  ok(/document\.body\.appendChild\(pop\)/.test(SRC), 'outside every screen host');
  ok(SRC.includes('role="dialog"') && SRC.includes('aria-modal="true"'), 'dialog');
  ok(/data-sv-close/.test(SRC) && /sv-pop-scrim/.test(SRC), '✕ and scrim');
  ok(!SRC.includes('data-sv-back') && !/function openPanel\(/.test(SRC), 'no Back, no openPanel');
  ok(/class="sv-panel"/.test(SRC), 'the filled element keeps class sv-panel');
});

test('Escape in a form goes back to the item, not out of the pop-up', () => {
  const f = SRC.slice(SRC.indexOf('function form('), SRC.indexOf('// ── NavCounts'));
  ok(/e\.key === 'Escape'\) \{[^}]*stopPropagation\(\)/.test(f), 'the form keeps its Escape');
  ok(f.includes('Back without saving'), 'the back link');
  ok(/opts\.doneText/.test(f) && /toast\(/.test(f), 'a toast after a save');
});

test('the pop-up keeps focus and the page still', () => {
  ok(/e\.key === 'Tab'/.test(SRC), 'Tab is trapped');
  ok(/classList\.add\('sv-pop-on'\)/.test(SRC) && /classList\.remove\('sv-pop-on'\)/.test(SRC), 'scroll lock');
  const c = SRC.slice(SRC.indexOf('function closePop('), SRC.indexOf('function closePop(') + 900);
  ok(/\.focus\(/.test(c) && /onClose/.test(c), 'focus back to the card, the screen told');
});

test('review fixes: Escape anywhere in a form goes back; a stray click never drops a form; fresh panel per item', () => {
  const k = SRC.slice(SRC.indexOf("document.addEventListener('keydown'"), SRC.indexOf('function trapTab('));
  ok(/sv-form-back[\s\S]{0,120}\.click\(\)/.test(k), 'Escape presses "Back without saving" when a form is open');
  ok(SRC.includes('data-sv-scrim') && /data-sv-scrim[\s\S]{0,200}form\.sv-form/.test(SRC), 'a click outside leaves an open form alone');
  ok(/function freshPanel\(/.test(SRC) && /cloneNode\(false\)/.test(SRC), 'a fresh panel element');
  const s = SRC.slice(SRC.indexOf('function showIn('), SRC.indexOf('function nextIn('));
  ok(/freshPanel\(\)/.test(s), 'each newly opened item gets a fresh panel, so old listeners never fire again');
});

test('What to do now and the toast are exported', () => {
  for (const fn of ['nextStep', 'toast', 'closePop', 'panelHtml', 'form', 'error'])
    ok(new RegExp('function ' + fn + '\\(').test(SRC), 'missing ' + fn);
  ok(/root\.SplitView = Object\.assign\(\{\}, pure, \{[^}]*nextStep[^}]*toast[^}]*closePop/.test(SRC), 'on window.SplitView');
  ok(SRC.includes('What to do now'), 'the box title');
});

test('the pop-up styles: 780px, full screen on a phone, sections never shrink', () => {
  const css = src('css/split-view.css');
  const box = rule(css, '.sv-pop-box');
  ok(/max-width: 780px/.test(box) && /border-radius: 22px/.test(box), 'desktop box');
  ok(/rgba\(28, ?28, ?30, ?\.45\)/.test(rule(css, '.sv-pop-scrim')), 'scrim');
  ok(/@media \(max-width: 720px\)[\s\S]*\.sv-pop-box \{[^}]*border-radius: 0/.test(css), 'phone: full screen');
  ok(/html\.sv-pop-on/.test(css), 'page locked');
  ok(/\.sv-panel-body > \* \{[^}]*flex-shrink: 0/.test(css), 'sections keep their height (14 Nov lesson)');
  ok(/\.sv-hist > summary::after \{[^}]*content:/.test(css), 'History fold marker kept');
  ok(rule(css, '.sv-step').length > 0 && rule(css, '.sv-toast').length > 0, 'step box and toast');
});

test('the browser half exports the frame', () => {
  for (const fn of ['render', 'panelHtml', 'section', 'notice', 'facts', 'history', 'pills', 'form', 'error'])
    ok(new RegExp('function ' + fn + '\\(').test(SRC), 'missing function ' + fn);
  ok(/root\.SplitView = Object\.assign\(\{\}, pure, \{[^}]*render[^}]*form/.test(SRC), 'window.SplitView carries render and form');
});

test('render draws groups of cards, not a list beside a panel', () => {
  const r = SRC.slice(SRC.indexOf('function render('), SRC.indexOf('function fill('));
  ok(/groupHtml\(/.test(r) && SRC.includes('class="sv-cards"') && SRC.includes("'sv-card'"), 'card grid');
  ok(!SRC.includes('sv-split') && !SRC.includes('sv-list-body') && !SRC.includes('function measure('), 'the split is gone');
  ok(SRC.includes('Open ›'), 'Open ›');
  ok(/cfg\.toolbar/.test(r) && /cfg\.showing/.test(r) && /cfg\.how/.test(r), 'toolbar, showing, how');
  ok(/t\.help/.test(r), 'the current tab explains itself');
});

test('a card\'s next-step button never also toggles the card', () => {
  ok(/data-sv-next-step/.test(SRC), 'the button exists');
  ok(/closest\('\[data-sv-next-step\]'\)[\s\S]{0,300}stopPropagation\(\)/.test(SRC), 'its press stops there');
  ok(/show\([^,()]+, true\)/.test(SRC), 'it opens the item with start');
});

test('cards open from the keyboard', () => {
  ok(/e\.key === 'Enter' \|\| e\.key === ' '/.test(SRC), 'Enter or Space');
});

test('the v5 screen styles', () => {
  const css = src('css/split-view.css');
  ok(/max-width: 1280px/.test(rule(css, '.sv')), 'content 1280px');
  ok(/repeat\(auto-fill, minmax\(300px, 1fr\)\)/.test(rule(css, '.sv-cards')) && /gap: 12px/.test(rule(css, '.sv-cards')), 'card grid');
  const card = rule(css, '.sv-card');
  ok(/border-radius: 18px/.test(card) && /1\.5px solid/.test(card), 'card shape');
  const tab = rule(css, '.sv-tab');
  ok(/height: 44px/.test(tab) && /border-radius: 999px/.test(tab), 'pill tabs');
  ok(css.includes('.sv-pill--solid-red'), 'solid red pill');
  ok(/@media \(max-width: 720px\)/.test(css), 'phone layout');
  ok(/prefers-reduced-motion/.test(css), 'reduced motion');
  ok(!/\.sv-split|\.sv-row\b/.test(css), 'no split or row styles left');
});

console.log('\nsplit-view: frame additions for the remaining screens');

test('dotsOf: v5 day dots, one per letter', () => {
  eq(sv.dotsOf('olmutx').map(d => d.tone), ['o', 'l', 'm', 'u', 't', 'x']);
  eq(sv.dotsOf('olmutx').map(d => d.label), ['On time', 'Late', 'Missed', 'Could not be verified', 'Not yet', 'Not a working day']);
  eq(sv.dotsOf('o?').length, 1, 'unknown letters are dropped');
  eq(sv.dotsOf(''), []);
});

test('tickCount: how many cards are ticked', () => {
  eq(sv.tickCount([{ rows: [{ id: 'a', tick: { on: true } }, { id: 'b', tick: { on: false } }] }, { rows: [{ id: 'c' }, { id: 'd', tick: { on: true } }] }]), 2);
  eq(sv.tickCount([]), 0);
});

test('header extras: segmented switch, tiles, lede, strips, switched-off card, no search', () => {
  const r = SRC.slice(SRC.indexOf('function render('), SRC.indexOf('function fill('));
  ok(/cfg\.seg/.test(r) && /data-sv-seg/.test(SRC), 'segmented switch');
  ok(/cfg\.tiles/.test(r) && /data-sv-tile/.test(SRC), 'tiles open their tab');
  ok(/cfg\.lede/.test(r) && /cfg\.strips/.test(r), 'lede and strips');
  ok(/cfg\.off/.test(r) && SRC.includes('sv-off'), 'switched-off card');
  ok(/cfg\.search === false/.test(r), 'a screen may have no search box');
});

test('cards: day dots, legend, tick boxes that never open the card, the tick bar', () => {
  ok(/r\.dots/.test(SRC) && /cfg\.legend/.test(SRC), 'dots and legend');
  ok(/data-sv-tick/.test(SRC) && /closest\('\[data-sv-tick\]'\)[\s\S]{0,300}stopPropagation\(\)/.test(SRC), 'a tick press stops there');
  ok(/cfg\.onTick/.test(SRC) && /cfg\.tickBar/.test(SRC) && /tickCount\(/.test(SRC), 'tick bar with its count');
  ok(/title \? /.test(SRC.slice(SRC.indexOf('function groupHtml('), SRC.indexOf('function menuHtml('))), 'a group without a title has no heading');
});

test('page shell for existing item pages, and the wide pop-up', () => {
  ok(/function page\(panel, p\)/.test(SRC) && /root\.SplitView = Object\.assign\(\{\}, pure, \{[^}]*page/.test(SRC), 'SplitView.page');
  const p = SRC.slice(SRC.indexOf('function page(panel, p)'), SRC.indexOf('function page(panel, p)') + 1600);
  ok(/sv-page-body/.test(p) && /data-sv-next/.test(p), 'a body to fill and Next');
  ok(/sv-pop-box--wide/.test(SRC), 'a wide pop-up for the largest pages and forms');
});

test('custom tab body, and big pages a stray click or Escape never closes', () => {
  const r = SRC.slice(SRC.indexOf('function render('), SRC.indexOf('function fill('));
  ok(/cfg\.custom/.test(r) && /data-sv-custom/.test(r) && /cfg\.onCustom/.test(r), 'a tab may keep its own content inside the frame');
  const p = SRC.slice(SRC.indexOf('function page(panel, p)'), SRC.indexOf('function page(panel, p)') + 1800);
  ok(/p\.keep/.test(p) && /data-sv-keep/.test(p), 'page({ keep: true }) marks a page that holds typed work');
  ok(/data-sv-scrim[\s\S]{0,260}\[data-sv-keep\]/.test(SRC), 'a click outside leaves a kept page alone');
  const k = SRC.slice(SRC.indexOf("document.addEventListener('keydown'"), SRC.indexOf('function trapTab('));
  ok(/\[data-sv-keep\]/.test(k), 'Escape leaves a kept page alone (✕ still closes it)');
});

test('a screen can open one of its items from code (Attendance: a worker\'s day)', () => {
  ok(/function openItem\(key, id\)/.test(SRC) && /root\.SplitView = Object\.assign\(\{\}, pure, \{[^}]*open: openItem/.test(SRC), 'SplitView.open');
  const o = SRC.slice(SRC.indexOf('function openItem(key, id)'), SRC.indexOf('function openItem(key, id)') + 400);
  ok(/mem\[key\]/.test(o) && /showIn\(/.test(o), 'opens it in that screen\'s pop-up, with its own onSelect');
});

test('form adapter: existing .att-modal forms take the item\'s place and keep their own keys', () => {
  const k = SRC.slice(SRC.indexOf("document.addEventListener('keydown'"), SRC.indexOf('function trapTab('));
  ok(/document\.querySelector\('\.att-modal'\)/.test(k), 'the pop-up leaves Escape and Tab to an open form');
  const css = src('css/split-view.css');
  ok(/max-width: 780px/.test(rule(css, '.att-modal-box')) && /border-radius: 22px/.test(rule(css, '.att-modal-box')), 'v5 form box');
  ok(/body:has\(\.att-modal\) #svPop \.sv-pop-box \{[^}]*visibility: hidden/.test(css), 'the item hides under an open form');
  ok(/z-index: 1250/.test(rule(css, '.att-modal')), 'forms sit above the pop-up');
});

test('review minors folded in: toast never blocks Next, 44px phone targets, comment', () => {
  const css = src('css/split-view.css');
  ok(/pointer-events: none/.test(rule(css, '.sv-toast')), 'toast lets taps through');
  ok(/@media \(max-width: 720px\)[\s\S]*\.sv-pop \.att-btn[^{]*\{[^}]*min-height: 44px/.test(css), 'phone tap targets in the pop-up');
  ok(!/triage split view/.test(SRC.slice(0, 1200)), 'the header comment describes v5');
  const nav = src('js/admin.js');
  ok(/function syncPortalChrome\(view\) \{\s*[^}]*SplitView\.closePop\(\);[\s\S]{0,200}const primary = findPrimaryForView/.test(nav) ||
     /function syncPortalChrome\(view\) \{[\s\S]{0,260}closePop\(\);\s*const primary/.test(nav), 'closePop runs before the guard');
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

test('a top tab shows the sum of the link counts the account sees (D5)', () => {
  const nav = src('js/admin.js');
  ok(nav.includes('data-nav-total='), 'top tabs carry their link keys');
  ok(/p\.modules\.filter\(m => m\.count && !m\.hidden\)/.test(nav), 'only visible counted links');
  const paint = SRC.slice(SRC.indexOf('function paint('), SRC.indexOf('function set('));
  ok(/\[data-nav-total\]/.test(paint) && /navTotal\(/.test(paint) && /badgeText\(/.test(paint), 'painted as the sum, through badgeText');
});

test('counts are fetched for every counted link the account can see', () => {
  const nav = src('js/admin.js');
  ok(/_visibleNav\(\)[\s\S]{0,120}flatMap\(p => p\.modules\.filter\(m => m\.count && !m\.hidden\)\.map\(m => m\.count\)\)/.test(nav), 'visible counted links only');
  ok(nav.includes('NavCounts.refresh('), 'refreshed from the chrome');
  ok(nav.includes('data-nav-count='), 'module badge spans drawn by the chrome');
});

test('D5 counts: each counted link has a loader that counts only what the account can act on', () => {
  const nav = src('js/admin.js');
  for (const [v, k] of [['attToday', 'attToday'], ['reqPurchasing', 'purchasing'], ['reqStock', 'stock'], ['reqTools', 'tools'],
                        ['reqHistory', 'history'], ['wpBoard', 'board'], ['wpMeetings', 'meetings']])
    ok(new RegExp("view: '" + v + "'[^}]*count: '" + k + "'").test(nav), v + ' counts ' + k);
  ok(/NavCounts\.register\('purchasing'[\s\S]{0,300}isOwner/.test(src('js/purchasing-admin-purchases.js')), 'approvals: owner accounts only');
  ok(/NavCounts\.register\('stock'[\s\S]{0,300}is_main_owner/.test(src('js/stock-admin.js')), 'stock: main owner only');
  ok(/NavCounts\.register\('tools'[\s\S]{0,300}is_main_owner/.test(src('js/tools-admin.js')), 'tools: main owner only');
  ok(/NavCounts\.register\('history'/.test(src('js/requests-admin-gallery.js')), 'photos to review');
  ok(/NavCounts\.register\('board'/.test(src('js/workplan-admin-board.js')) && /NavCounts\.register\('meetings'/.test(src('js/workplan-admin-meetings.js')), 'work plan');
  ok(/NavCounts\.set\('attToday'/.test(src('js/attendance-admin.js')), 'Today sets its own count');
  ok(/data-nav-total=/.test(nav.slice(nav.indexOf('function syncPortalChrome'))), 'the Setup menu button sums its screens');
});

test('changing screen closes an open pop-up', () => {
  const nav = src('js/admin.js');
  ok(/function syncPortalChrome\(view\) \{[\s\S]{0,300}SplitView\.closePop\(\)/.test(nav), 'syncPortalChrome closes it');
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

test('render keeps the open pop-up; only a refresh reloads it', () => {
  const r = SRC.slice(SRC.indexOf('function render('), SRC.indexOf('function fill('));
  ok(/panelPlan\(/.test(r) && /cfg\.refreshPanel/.test(r), 'panelPlan + refreshPanel');
  ok(/nextFrom\(/.test(SRC), 'Next keeps the order the user saw');
});

test('an error in the pop-up still has ✕, no Back of its own', () => {
  const fn = SRC.slice(SRC.indexOf('function error('), SRC.indexOf('function defaultMessage('));
  ok(/sv-error/.test(fn) && !/data-sv-back/.test(fn), 'error() draws the message; the box keeps ✕');
});

test('a long panel scrolls; its sections never shrink to nothing', () => {
  // Bug seen live 14 Nov: in the flex column, sections with overflow:hidden
  // (facts box, request item cards) were squeezed to 0 height.
  const css = src('css/split-view.css');
  ok(/\.sv-panel-body > \* \{[^}]*flex-shrink: 0/.test(css), 'panel sections keep their height');
});

test('a folded History says it can be opened', () => {
  const css = src('css/split-view.css');
  ok(/\.sv-hist > summary::after \{[^}]*content:/.test(css), 'a marker after the History title');
  ok(/\.sv-hist\[open\] > summary::after \{[^}]*content:/.test(css), 'and a different one when open');
  ok(/\.sv-hist > summary \{[^}]*cursor: pointer/.test(css), 'looks clickable');
});

test('printing with the pop-up open prints the whole item, not a clipped box', () => {
  // "Print this day" (a worker's day) now lives only in the pop-up.
  const css = src('css/split-view.css');
  const at = css.indexOf('@media print');
  ok(at > 0, 'the frame has print rules');
  const p = css.slice(at);
  ok(/html\.sv-pop-on body > \*:not\(#svPop\) \{[^}]*display: none/.test(p), 'only the pop-up prints');
  ok(/html\.sv-pop-on,\s*html\.sv-pop-on body \{[^}]*overflow: visible/.test(p), 'the page is not locked to one screen');
  ok(/html\.sv-pop-on #svPop \{[^}]*position: static/.test(p), 'the pop-up flows like a page');
  ok(/html\.sv-pop-on #svPop \.sv-pop-box \{[^}]*max-height: none[^}]*overflow: visible/.test(p), 'the box is not cut at the screen height');
  ok(/html\.sv-pop-on #svPop \.sv-panel-body \{[^}]*overflow: visible/.test(p), 'nor is its body');
  ok(/html\.sv-pop-on #svPop \.sv-pop-scrim,\s*html\.sv-pop-on #svPop \.sv-pop-x,\s*html\.sv-pop-on #svPop \.sv-panel-foot \{[^}]*display: none/.test(p),
    'no dimming, ✕ or Next on paper');
  // An id rule beats .sv-pop[hidden]: every print rule naming #svPop must
  // apply only while a pop-up is open, or a closed one prints as an empty box.
  const bare = p.slice(0, p.indexOf('\n}')).split('\n').filter(l => /#svPop/.test(l) && !/^\s*html\.sv-pop-on/.test(l));
  ok(bare.length === 0, 'no print rule shows a closed pop-up: ' + bare.join(' | '));
});

test("owner check 17 Nov: the v5 sections get v5's grey page and underlined module row; the rest of the portal stays as it was", () => {
  const nav = src('js/admin.js'), css = src('css/split-view.css');
  ok(/const V5_SECTIONS = \['attendance', 'requests', 'workplan'\];/.test(nav), 'Attendance, Requests and Work Plan');
  ok(/document\.body\.classList\.toggle\('sv-v5', V5_SECTIONS\.indexOf\(primary\.id\) >= 0\);/.test(nav), 'syncPortalChrome marks them');
  ok(/body\.sv-v5 \.main-content \{[^}]*background: #F5F5F5 !important/.test(css), 'the light grey page under white cards');
  ok(/body\.sv-v5 \.portal-module-link \{[^}]*border-bottom: 3px solid transparent/.test(css) &&
     /body\.sv-v5 \.portal-module-link\.active-link \{[^}]*border-bottom-color: #1A5C3A/.test(css), 'plain module links, the active one underlined green');
  ok(/\.sv-select \{[^}]*max-width: 240px/.test(css), 'a long project name never stretches a filter pill');
  ok(!/more:/.test(src('js/workplan-admin-board.js')), 'the Board has no More menu (v5: New task only; Meetings is in the module row)');
});

console.log('\nsplit-view: wired into admin.html');

test('the frame is loaded before the Requests scripts, cache-busted', () => {
  const h = src('admin.html');
  for (const f of ['js/split-view.js', 'js/admin.js', 'js/requests-admin-core.js', 'js/requests-admin-queue.js', 'js/requests-admin-detail.js'])
    ok(h.includes(f + '?v=20261116b'), f + ' cache-busted');
  // Changed again by the Attendance cards plan (16 Nov 2026).
  for (const f of ['css/split-view.css', 'css/attendance-admin.css', 'js/attendance-admin.js', 'js/app-updates-admin.js'])
    ok(h.includes(f + '?v=20261116c'), f + ' cache-busted');
  ok(h.indexOf('js/split-view.js') < h.indexOf('js/requests-admin-core.js'), 'order');
  ok(h.indexOf('css/split-view.css') > h.indexOf('css/admin-renovation.css'), 'frame styles after the shared renovation styles');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
