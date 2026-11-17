// ════════════════════════════════════════════════════════════════════
// KEEP-EVERYTHING FENCE: run with  node tests/office-v5-keep.test.js
//
// Office v5 redesign (spec docs/superpowers/specs/2026-11-14-office-split-
// view-redesign-design.md, D1 "keep everything"): every visible string of
// every remaining office screen — snapshot taken at the commit before the
// conversion (tests/fixtures/office-v5-keep.json) — must still be found in
// that screen group's files (or the shared frame). A string may only leave
// through the fixture's "gone" map, with the reason it went.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const { GROUPS, haystack } = require('./tools/office-v5-strings.js');
const FIX = require('./fixtures/office-v5-keep.json');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\noffice-v5-keep: every screen keeps its wording');

test('the snapshot covers every remaining screen group', () => {
  for (const g of Object.keys(GROUPS)) {
    if (!Array.isArray(FIX.groups[g]) || FIX.groups[g].length < 50) throw new Error('group ' + g + ' missing or too small');
  }
});

for (const [g, files] of Object.entries(GROUPS)) {
  test(g + ': every string is still there, or gone with a reason', () => {
    const hay = haystack(files.concat(['js/split-view.js']).map(read));
    const gone = (FIX.gone || {})[g] || {};
    const missing = FIX.groups[g].filter(s => !gone[s] && !hay.includes(s));
    if (missing.length) throw new Error(missing.length + ' missing: ' + missing.slice(0, 8).map(s => JSON.stringify(s)).join(', '));
    for (const [s, why] of Object.entries(gone)) {
      if (!why || String(why).trim().length < 10) throw new Error('gone without a reason: ' + JSON.stringify(s));
    }
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
