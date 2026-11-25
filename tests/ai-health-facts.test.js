// ════════════════════════════════════════════════════════════════════
// AI HEALTH FACTS — node tests/ai-health-facts.test.js
//
// Financial MVP Phase 1 (spec 2026-11-14 §3.4). The AI Health Check computes
// every fact itself and the model only phrases them. Contract − cost is
// "Contract value minus costs", never profit; a loss comes only from cost above
// the contract or a negative BOQ-based estimate; a low margin only from a
// CURRENT BOQ-based estimate. Runs the REAL aiHealthFacts / aiHealthPrompt,
// lifted from js/ai-assistant.js between their markers.
// ════════════════════════════════════════════════════════════════════
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const SRC = read('ai-assistant.js');
const a = SRC.indexOf('function peso(');
const b = SRC.indexOf('// ── end AI health facts ──');
if (a === -1 || b === -1) throw new Error('SLICE NOT FOUND: AI health facts markers in js/ai-assistant.js');
const ctx = vm.createContext({ window: {} });
vm.runInContext(SRC.slice(a, b), ctx);
const { aiHealthFacts, aiHealthPrompt } = ctx.window;

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

const facts = aiHealthFacts([
  // A: no BOQ, cost already above the contract (funds still left)
  { id: 'a', name: 'Alpha', revenue: 1000000, allocated: 2000000, spent: 1050000, coverCost: 0,
    boqProfit: null, boqMarginPct: null, boqCurrent: false, boqBadges: [] },
  // B: Sample today — a tiny DRAFT, STALE estimate; contract − cost is 30% of the contract
  { id: 'b', name: 'Sample Residence', revenue: 6600000, allocated: 5940000, spent: 4611640.23, coverCost: 0,
    boqProfit: 8359.77, boqMarginPct: 0.18, boqCurrent: false, boqBadges: ['Draft', 'Stale · 68 days'] },
  // C: a CURRENT estimate with a 5% margin
  { id: 'c', name: 'Gamma', revenue: 500000, allocated: 500000, spent: 100000, coverCost: 0,
    boqProfit: 5000, boqMarginPct: 5, boqCurrent: true, boqBadges: [] },
  // D: a negative DRAFT estimate
  { id: 'd', name: 'Delta', revenue: 500000, allocated: 500000, spent: 300000, coverCost: 0,
    boqProfit: -20000, boqMarginPct: -7.1, boqCurrent: false, boqBadges: ['Draft'] }
], 10000);
const text = id => facts.alerts.filter(x => x.id === id).map(x => x.text.replace(/<[^>]+>/g, '')).join(' | ');

ok(text('a').includes('Alpha cost exceeds the contract by ₱50,000.00'), 'A: ' + text('a'));
ok(!/margin|loss|losing/.test(text('b')), 'B: contract less cost is never a margin, a draft estimate is never "low margin": ' + text('b'));
ok(text('c').includes('Gamma has a low BOQ-based margin of 5.0%'), 'C: ' + text('c'));
ok(text('d').includes('Delta: BOQ-based estimate shows a loss of ₱20,000.00 (Draft)'), 'D: ' + text('d'));
ok(!facts.alerts.some(x => /losing money|Gross Profit/.test(x.text)), 'no old wording');
ok(Math.abs(facts.totals.contractLessCost - (8600000 - 6061640.23)) < 0.005, 'contract value minus costs total');
ok(!('profit' in facts.totals), 'no "profit" total');

const prompt = aiHealthPrompt(facts, 'Saturday, November 14, 2026');
ok(prompt.includes('Contract value minus costs') && prompt.includes('NOT profit'), 'the prompt names it and says it is not profit');
ok(prompt.includes('Never describe contract value minus costs as profit'), 'the instruction to the model');
ok(prompt.includes('when it is Draft or Stale, say so'), 'draft or stale estimates are disclosed');
ok(!/Gross Profit/.test(prompt), 'no Gross Profit in the prompt');

// source fences
ok(!/Gross Profit/.test(SRC), 'ai-assistant.js has no Gross Profit');
ok(!/\(revenue - spent\) \/ revenue/.test(SRC), 'no contract-less-cost margin in ai-assistant.js');
const SUM = read('ai-summary.js');
ok(!/>Remaining</.test(SUM) && !/'Remaining: '/.test(SUM), 'ai-summary.js names the balance that includes the reserve');
ok(SUM.includes('Total Allocation Remaining'), 'ai-summary label');
ok(SUM.includes('(this folder; Additional Works not included)'), 'a folder-only balance says so when the project has Additional Works');
ok(/parseFloat\(folder\.overhead\)/.test(SUM), 'the summary Spent includes overhead, like Project Control');

console.log('ai-health-facts: ' + passed + ' checks passed');
