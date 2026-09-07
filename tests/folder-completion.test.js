// ════════════════════════════════════════════════════════════════════
// FOLDER COMPLETION TESTS (migration 0064) — run with:
//   node tests/folder-completion.test.js
//
// Zero dependencies, no framework. Extracts the REAL helpers from
// js/portal-app.compiled.js at run time (never a copy) and fails loudly
// if a rule breaks.
//
// THE RULES UNDER GUARD
//
//  1. A folder is finished when it carries `completedAt`. Presence IS the
//     state — no status enum. The card already has a `status` field
//     ('track' | 'attn' | 'new') derived from spend-vs-budget; a second
//     one meaning "finished" is how a dashboard gets misread.
//
//  2. A finished folder LEAVES the active list — the project picker and
//     the one-at-a-time carousel both walk it, so "Showing 2 of 22"
//     counts live work only. The collapsed "Completed (N)" strip is the
//     way back in; nothing is deleted and nothing is unreachable.
//
//  3. Completion is a VIEW state and moves NO money. A completed folder
//     still books its Labor / Material / Overhead and still contributes
//     to the company P&L strip. If someone ever "tidies" the P&L to sum
//     only the active list, the company's profit to date silently drops
//     by every finished job — §IV is what catches that.
//
//  4. The completion date is built from LOCAL parts. PH is UTC+8, so
//     toISOString().slice(0,10) reports a job finished a day early.
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
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }
function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}

function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/folder-completion.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}

// ── Load the live helpers ────────────────────────────────────────────
const F   = 'js/portal-app.compiled.js';
const src = read(F);

const helpers = slice(src, '// ── Project completion (migration 0064)', '// ── END completion helpers', F);
const M = new Function(helpers + '\nreturn { _fldDone, _fldActive, _fldFinished, _fldDoneOn };')();
const { _fldDone, _fldActive, _fldFinished, _fldDoneOn } = M;

// A folder card as the grid builds it, trimmed to what these helpers read.
const card = (id, completedAt) => ({ id, name: id, completedAt });
// The shim wraps timestamps in a TS object exposing .toDate().
const TS = (d) => ({ toDate: () => d });

// ════════════════════════════════════════════════════════════════════
// I. What counts as finished
// ════════════════════════════════════════════════════════════════════
console.log('\nI. The completion predicate');

test('a folder with no completedAt is active', () => {
  eq(_fldDone(card('a')), false, 'undefined completedAt');
});

test('an explicit null reads as active — that is how re-opening works', () => {
  eq(_fldDone(card('a', null)), false, 'null completedAt');
});

test('a folder carrying a timestamp is finished', () => {
  eq(_fldDone(card('a', TS(new Date(2026, 7, 12)))), true, 'TS completedAt');
});

test('a plain Date counts too — not every write path wraps it', () => {
  eq(_fldDone(card('a', new Date(2026, 7, 12))), true, 'Date completedAt');
});

test('an ISO string counts — that is what comes straight off the column', () => {
  eq(_fldDone(card('a', '2026-08-12T04:00:00Z')), true, 'ISO completedAt');
});

test('a missing card is not finished, and does not throw', () => {
  eq(_fldDone(null), false, 'null card');
  eq(_fldDone(undefined), false, 'undefined card');
});

// ════════════════════════════════════════════════════════════════════
// II. Finished folders leave the active list
// ════════════════════════════════════════════════════════════════════
console.log('\nII. Active vs finished');

test('a finished folder is excluded from the active list', () => {
  const cards = [card('live1'), card('done1', TS(new Date())), card('live2')];
  eq(_fldActive(cards).map((c) => c.id).join(','), 'live1,live2', 'active ids');
});

test('the finished list holds exactly the ones the active list dropped', () => {
  const cards = [card('live1'), card('done1', TS(new Date())), card('live2')];
  eq(_fldFinished(cards).map((c) => c.id).join(','), 'done1', 'finished ids');
});

test('every folder lands in exactly one of the two lists — none vanishes', () => {
  const cards = [card('a'), card('b', TS(new Date())), card('c', null), card('d', new Date())];
  eq(_fldActive(cards).length + _fldFinished(cards).length, cards.length, 'partition total');
});

test('the active list preserves order — the carousel walks it by index', () => {
  const cards = [card('a'), card('b', TS(new Date())), card('c'), card('d')];
  eq(_fldActive(cards).map((c) => c.id).join(','), 'a,c,d', 'active order');
});

test('all-finished leaves an empty active list, not a crash', () => {
  const cards = [card('a', TS(new Date())), card('b', TS(new Date()))];
  eq(_fldActive(cards).length, 0, 'active length');
  eq(_fldFinished(cards).length, 2, 'finished length');
});

test('no folders at all is an empty split, never a throw', () => {
  eq(_fldActive([]).length, 0, 'empty active');
  eq(_fldFinished(undefined).length, 0, 'undefined finished');
});

// ════════════════════════════════════════════════════════════════════
// III. The date on the badge — PH is UTC+8
// ════════════════════════════════════════════════════════════════════
console.log('\nIII. The completion date label');

test('a finished folder reads its date from local parts', () => {
  eq(_fldDoneOn(card('a', TS(new Date(2026, 7, 12, 15, 30)))), '12 Aug 2026', 'formatted date');
});

test('a late-evening PH completion does NOT roll back a day', () => {
  // 23:30 local on the 12th is the 12th. toISOString() would say the 11th
  // for anywhere east of UTC — the exact bug CLAUDE.md forbids.
  eq(_fldDoneOn(card('a', new Date(2026, 7, 12, 23, 30))), '12 Aug 2026', 'late-evening date');
});

test('an active folder has no date to show', () => {
  eq(_fldDoneOn(card('a')), '', 'active date label');
  eq(_fldDoneOn(card('a', null)), '', 'null date label');
});

test('an unparseable stamp yields no label rather than "Invalid Date"', () => {
  eq(_fldDoneOn(card('a', 'not-a-date')), '', 'garbage date label');
});

// ════════════════════════════════════════════════════════════════════
// IV. Completion moves NO money
// ════════════════════════════════════════════════════════════════════
console.log('\nIV. The money model is untouched');

test('the completion helpers read no money field at all', () => {
  const money = /\b(spent|earned|profit|revenue|allocated|contract|coverCost|labor|material|overhead)\b/i;
  const hit = money.exec(helpers.replace(/\/\/[^\n]*/g, ''));  // comments explain the rule; code must not touch it
  eq(hit, null, 'a money identifier leaked into the completion helpers: ' + (hit && hit[0]));
});

test('the card build never consults completion — every folder is costed', () => {
  // Each card's Labor / Material / Overhead is computed here. If the
  // completion filter ever moved INTO this loop, a finished project would
  // stop being costed at all rather than merely being hidden.
  const build = slice(src, 'const cards = folders.map((f) => {', 'const _fldMs =', F);
  ok(!/_fldDone|_fldActive|_fldFinished/.test(build),
     'the completion filter leaked into the money-bearing card build');
});

test('the active list is DERIVED from the full set, never the other way round', () => {
  // `cards` must stay the complete, costed set; `liveCards` is only a view of
  // it. Inverting that makes the full set unreachable for any aggregate.
  const split = slice(src, 'const liveCards =', 'const _restoredRef', F);
  ok(/const liveCards = _fldActive\(cards\)/.test(split), 'liveCards is no longer derived from cards: ' + split.trim());
  ok(/const doneCards = _fldFinished\(cards\)/.test(split), 'doneCards is no longer derived from cards: ' + split.trim());
});

test('the profit banner is not gated on completion', () => {
  const banner = slice(src, 'const _heroLbl', 'const _heroSub', F);
  ok(!/completedAt|_fldDone/.test(banner), 'the hero profit label now depends on completion state: ' + banner.trim());
});

// ── report ───────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('Completion is a view state: it hides projects, it never moves money.');
