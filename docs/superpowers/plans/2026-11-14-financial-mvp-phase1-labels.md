# Financial MVP — Phase 1: label and calculation fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every profit, allocation and contract figure in Project Control, Budget Overview, Reports, the project print and the AI briefings is labelled for what it measures and computed from one shared layer. Sample Residence's ₱74,267 case is frozen as a regression.

**Architecture:** A new pure module `js/project-finance.js` sits beside `js/billing-allocation.js`: globals plus `module.exports`, no database, no roles, integer centavos. It turns the totals the existing money functions already produce (`buildProject`, `_projSpent`, `_projMargin`, `_folderCompletion`) into labelled view models. Every screen, print and AI payload reads those view models; the old arithmetic is untouched. Phase 1 writes no data and adds no migration.

**Tech Stack:** Plain HTML + vanilla JS (no build step), React-via-CDN in `js/portal-app.compiled.js` (edited directly), Node test files run by `npm test`, read-only live checks through `npx supabase db query --linked`.

**Spec:** `docs/superpowers/specs/2026-11-14-financial-management-mvp-design.md` (v1.2) — §2, §3, §6, §7.1, §7.2 (T13–T19, T21, T22), §7.3 Phase 1.

## Global Constraints

- **Never run `npm run build`.** Edit `js/portal-app.compiled.js` directly.
- **No new data field, no migration, no write to the database** in Phase 1.
- **Copy, verbatim:** `BOQ-based profit estimate`, `Projected final profit`, `Recognized Project Profit`, `Unavailable`, `Profit not confirmed`, `Contract less cost to date`, `Contract less allocated funds`, `Operating allocation remaining`, `Total allocation remaining, including reserve`, `Fund balance`, `Company-fronted cost`, `Not charged to a billing period`, `BOQ last saved`, `BOQ date unavailable`, `Saving a BOQ refreshes this date even when progress hasn't changed.`, `All Time only`, `No BOQ progress recorded`, `Allocated less cost (by date)`, `Costs by date`.
- **"Unbilled contract value"** must not appear anywhere: no verified billings exist yet.
- **Stale threshold:** `PF_BOQ_STALE_DAYS = 30` (one constant), counted in Asia/Manila calendar days.
- **Money in `project-finance.js`:** integer centavos, rounded half away from zero, percentages from unrounded ratios. Display `₱ 4,545,733.23`; negatives `−₱ 126,276.00` (U+2212); percentages to two decimals.
- **Dates:** Asia/Manila (UTC+8, no DST), built from date parts. Never `toISOString().slice(0,10)` for a date key.
- **Billing periods are matched by `id`**, never by number or month. Cover and no-period costs stay in Spent and in every reconciliation.
- **Do not change the arithmetic of** `_projSpent`, `_projEarned`, `_projMargin`, `_recognisedProfit` or `buildProject`. `_folderCompletion` gains fields only.
- **Recognized Project Profit** always reads `Unavailable`.
- **Visibility:**
  - Staff see no profit, estimate, allocation or contract-less figure, anywhere.
  - `Operating allocation remaining` and every envelope are owner-only.
  - `Total allocation remaining, including reserve` keeps today's "Budget Remaining" audience (not staff).
- **Tests:** a label change updates the test's expected text. A test is never deleted. If a slice marker moves, fix the marker.
- Run `npm test` after every task. Run `node --check <file>` on every JS file touched.
- **The user commits and pushes.** Each task ends at a checkpoint for the user; never run `git commit` or `git push`.

## Review Focus

1. **Date filter other than All Time.** Project Control filters cost by date, but BOQ-earned revenue and Fund Allocated are cumulative. The estimate, Contract less cost to date and both allocation-remaining figures must read `All Time only`, never a mixed number. Owning tests: Task 4 `testLedgerAllTimeOnly`; Task 5 `testBillingPeriodsAllTimeOnly`.
2. **BOQ timestamp shapes.** The shim delivers `updatedAt` as a Timestamp object (`toDate()`), the reconcile tool as an ISO string, and older rows may have none. All three must resolve, and missing must read `BOQ date unavailable`. Owning test: Task 1 `pfManilaDayKey` and `pfBoqBasis` cases.
3. **Manila day boundary.** A BOQ saved at 00:30 Manila counts by the Manila date, not UTC. Day 30 is not stale; day 31 is. Owning test: Task 1 boundary case.
4. **Credits and negative rows** (stock cost moves, reversals) are summed signed, never clamped to zero as `pcPeriodAllocationView` does. Owning test: Task 2 `pfFundBalances` with a −₱5,000.00 row; Task 2 negative-base `pfPeriodBuckets`.
5. **Additional Works and stray links.** Child folders' periods count once. An overhead row linked to another folder's period is `Not charged to a billing period`, never another job's fund. Owning test: Task 2 AW case.

---

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `js/project-finance.js` | new | Labels, centavos, Manila dates, BOQ basis, profit view, allocation remaining, fund balances, duplicate billing numbers |
| `tests/project-finance.test.js` | new | Unit tests for the module |
| `tests/helpers/portal-money.js` | new | Loads the live portal money functions from source; builds a project from rows like `PortalApp` does |
| `tests/fixtures/sample-residence-2026-11-12.json`, `…-2026-11-14.json` | new | The two frozen Sample snapshots |
| `tests/sample-regression.test.js` | new | R1–R4 and both snapshots, old functions and new module side by side |
| `js/portal-app.compiled.js` | modify | `_folderCompletion` fields; `_pcFinance`; hero, cost card, company strip, folder grid, AW list, Billing Periods, print payload, AI payload |
| `js/print-utils.js` | modify | Project cost summary print |
| `js/expenses-module.js` | modify | Budget Overview hidden figures, Reports KPIs, tables, print |
| `js/ai-assistant.js`, `js/ai-summary.js` | modify | Health Check facts and prompt; summary label |
| `tests/budget-overview-labels.test.js`, `tests/ai-health-facts.test.js` | new | Tests for the above |
| `tests/billing-allocation.test.js`, `tests/project-control-staff.test.js`, `tests/money-math.test.js` | modify | Expected text, harness globals |
| `tools/finance/reconcile-folder.js` | new | Read-only live reconciliation of one folder |
| `admin.html`, `package.json`, `.github/workflows/ci.yml` | modify | Script tag and cache-busters, test list, syntax-check globs |
| `CLAUDE.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/OVERHEAD_MODULE.md` | modify | The new rules |

---

### Task 1: `project-finance.js` — labels, money, dates, BOQ basis, profit view

**Files:**
- Create: `js/project-finance.js`, `tests/project-finance.test.js`
- Modify: `package.json` (append `&& node tests/project-finance.test.js` to `test`), `admin.html` (add `<script src="js/project-finance.js"></script>` directly after the `js/billing-allocation.js` tag at ~line 5549, before `print-utils.js`), `.github/workflows/ci.yml` (syntax loop becomes `for f in js/*.js tests/*.js tests/helpers/*.js tools/finance/*.js service-worker.js`)

**Interfaces — Produces** (each a global in the browser and a `module.exports` key, the same UMD shape as `billing-allocation.js`):
- `PF_LABELS`: frozen object holding every Global Constraints string, under these keys:
  - `boqEstimate`, `projected`, `recognized`, `unavailable`, `notConfirmed`;
  - `contractLessCost`, `contractLessAllocated`;
  - `operatingRemaining`, `totalRemaining`, `fundBalance`, `companyFronted`, `notCharged`;
  - `boqSaved`, `boqDateUnavailable`, `boqSaveNote`, `allTimeOnly`, `noBoqProgress`;
  - `byDateRemaining` (`Allocated less cost (by date)`), `byDateCaption` (`Costs by date`), `incomplete` (`Incomplete`).
- `PF_BOQ_STALE_DAYS = 30`
- `pfCents(value) → integer` — `Number(value)`; non-finite → 0; half away from zero; float-safe (2.675 → 268).
- `pfPeso(cents) → string`
- `pfPct(percent: number|null) → string` (`null` → `'—'`)
- `pfManilaDayKey(value: Date|string|{toDate()}|null) → 'YYYY-MM-DD'|null`
- `pfBoqBasis(completion, today: Date) → BoqBasis`. `BoqBasis` fields:
  - `hasProgress`, `completePct` (number|null, 0–100), `status` (`'draft'|'submitted'|'approved'`; missing → `'draft'`);
  - `savedAt` (string|null), `savedDayKey`, `ageDays` (number|null);
  - `isDraft`, `isForReview`, `isUndated`, `isStale`, `current`;
  - `savedText`, `badges` (string[]).
- `pfProfitView({ contract, spent, completion, today, period, forecast }) → ProfitView`:
  - `allTime`;
  - `headline: { kind: 'boq'|'notConfirmed'|'allTimeOnly', label, cents|null, reasons: string[] }`;
  - `boq: { available, label, earnedCents|null, profitCents|null, marginPct|null, basis }`;
  - `projected: null | { label, text }`;
  - `recognized: { label, text, note }`;
  - `contractLessCost: { label, cents|null }`.
- `completion` is `_folderCompletion`'s result: `{ hasData, pct, status?, savedAt? }` (Task 3 adds the last two).
- `period == null || period === 'All Time'` ⇒ `allTime`.
- `forecast`:
  - `undefined` (Phase 1) ⇒ `projected: null` and no forecast reason;
  - `null` ⇒ `projected = { label: 'Projected final profit', text: 'Forecast pending' }` and the reason `'No approved forecast'`.

**Rules the tests pin:**
- `badges`, in order: `'Draft'` | `'For review'`; then `'Stale · N days'` when `ageDays > 30`; then `'BOQ date unavailable'` when undated.
- `current = hasProgress && status === 'approved' && !isUndated && !isStale`.
- `savedText = 'BOQ last saved D Mon YYYY'` from the Manila date, or `'BOQ date unavailable'`.
- Headline:
  - not All Time → `allTimeOnly`;
  - else `boq.available && basis.current` → `{ kind:'boq', label:'BOQ-based profit estimate', cents: profitCents }`;
  - else `notConfirmed`, with reasons from:
    - `'No BOQ progress recorded'`;
    - `'BOQ is Draft'` | `'BOQ is For review'`;
    - `'BOQ last saved N days ago'` (stale);
    - `'BOQ date unavailable'`;
    - then `'No approved forecast'` when `forecast === null`.
- `earnedCents = pfCents(contract × pct)`, `profitCents = earnedCents − pfCents(spent)`, `marginPct = profitCents / earnedCents × 100` (null when `earnedCents ≤ 0`).
- `contractLessCost.cents = pfCents(contract) − pfCents(spent)`.
- When not All Time, `boq.profitCents`, `boq.earnedCents`, `marginPct` and `contractLessCost.cents` are all `null`.

- [ ] **Step 1: Write the failing tests** in `tests/project-finance.test.js` (plain `assert`, same style as `tests/billing-allocation.test.js`):

```js
const PF = require('../js/project-finance.js');
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);
// money
eq(PF.pfCents(4545733.23), 454573323); eq(PF.pfCents(0.005), 1); eq(PF.pfCents(-0.005), -1);
eq(PF.pfCents(2.675), 268); eq(PF.pfCents('x'), 0); eq(PF.pfCents(null), 0);
eq(PF.pfPeso(454573323), '₱ 4,545,733.23'); eq(PF.pfPeso(-12627600), '−₱ 126,276.00'); eq(PF.pfPeso(0), '₱ 0.00');
eq(PF.pfPct(1.6075), '1.61%'); eq(PF.pfPct(null), '—');
// Manila dates — three input shapes and the day boundary (Review Focus 2, 3)
eq(PF.pfManilaDayKey('2026-09-07T06:14:46.774Z'), '2026-09-07');
eq(PF.pfManilaDayKey({ toDate: () => new Date('2026-09-07T06:14:46.774Z') }), '2026-09-07');
eq(PF.pfManilaDayKey('2026-10-14T16:30:00Z'), '2026-10-15');
eq(PF.pfManilaDayKey(null), null); eq(PF.pfManilaDayKey('garbage'), null);
// basis
const comp = o => ({ hasData: true, pct: 0.7, status: 'approved', savedAt: '2026-11-01T02:00:00Z', ...o });
const at = s => new Date(s);
let b = PF.pfBoqBasis(comp({}), at('2026-11-14T04:00:00Z'));
eq([b.current, b.ageDays, b.savedText, b.badges], [true, 13, 'BOQ last saved 1 Nov 2026', []]);
eq(PF.pfBoqBasis(comp({ status: 'draft' }), at('2026-11-14T04:00:00Z')).badges, ['Draft']);
eq(PF.pfBoqBasis(comp({ status: 'submitted' }), at('2026-11-14T04:00:00Z')).badges, ['For review']);
eq(PF.pfBoqBasis(comp({ status: undefined }), at('2026-11-14T04:00:00Z')).isDraft, true);
b = PF.pfBoqBasis(comp({ savedAt: '2026-10-14T16:30:00Z' }), at('2026-11-14T15:59:00Z'));
eq([b.ageDays, b.isStale, b.current], [30, false, true]);
b = PF.pfBoqBasis(comp({ savedAt: '2026-10-14T16:30:00Z' }), at('2026-11-14T16:00:00Z'));
eq([b.ageDays, b.isStale, b.current, b.badges], [31, true, false, ['Stale · 31 days']]);
b = PF.pfBoqBasis(comp({ savedAt: null }), at('2026-11-14T04:00:00Z'));
eq([b.savedText, b.badges, b.current], ['BOQ date unavailable', ['BOQ date unavailable'], false]);
eq(PF.pfBoqBasis({ hasData: false, pct: 0 }, at('2026-11-14T04:00:00Z')).hasProgress, false);
eq(PF.PF_BOQ_STALE_DAYS, 30);
eq(PF.PF_LABELS.boqSaveNote, "Saving a BOQ refreshes this date even when progress hasn't changed.");
// profit view — the ₱74,267 case (R1, R2)
const sample = { contract: 6600000, spent: 4545733.23, today: at('2026-11-12T04:16:15Z'), period: 'All Time',
  completion: comp({ status: 'draft', savedAt: '2026-09-07T06:14:46.774Z' }) };
let v = PF.pfProfitView(sample);
eq([v.boq.earnedCents, v.boq.profitCents, PF.pfPct(v.boq.marginPct)], [462000000, 7426677, '1.61%']);
eq(v.headline, { kind: 'notConfirmed', label: 'Profit not confirmed', cents: null,
  reasons: ['BOQ is Draft', 'BOQ last saved 66 days ago'] });
eq([v.recognized.label, v.recognized.text], ['Recognized Project Profit', 'Unavailable']);
eq([v.contractLessCost.label, v.contractLessCost.cents, v.projected], ['Contract less cost to date', 205426677, null]);
v = PF.pfProfitView({ ...sample, completion: comp({ savedAt: '2026-11-01T02:00:00Z' }) });
eq([v.headline.kind, v.headline.label, v.headline.cents], ['boq', 'BOQ-based profit estimate', 7426677]);
v = PF.pfProfitView({ ...sample, completion: { hasData: false, pct: 0 } });
eq([v.boq.available, v.headline.reasons], [false, ['No BOQ progress recorded']]);
v = PF.pfProfitView({ ...sample, period: 'This Month' });
eq([v.headline.kind, v.headline.label, v.boq.profitCents, v.contractLessCost.cents], ['allTimeOnly', 'All Time only', null, null]);
v = PF.pfProfitView({ ...sample, forecast: null });
eq([v.projected, v.headline.reasons.at(-1)], [{ label: 'Projected final profit', text: 'Forecast pending' }, 'No approved forecast']);
// fence: the profit view never reads allocation planning (CLAUDE.md, billing allocations)
for (const fn of [PF.pfProfitView, PF.pfBoqBasis])
  assert.doesNotMatch(fn.toString(), /pcAllocation|pcPeriod|directPct|targetMargin|allocationMap/);
```

- [ ] **Step 2: Run** `node tests/project-finance.test.js`. Expected: FAIL (`Cannot find module '../js/project-finance.js'`).
- [ ] **Step 3: Implement** `js/project-finance.js` with the Interfaces above. Use an IIFE that writes each export to `root` (window/globalThis) and `module.exports`, exactly like `billing-allocation.js`. Format month names with a fixed English short-month array; don't depend on the runtime locale.
- [ ] **Step 4: Run** `node tests/project-finance.test.js && node --check js/project-finance.js && npm test`. Expected: PASS, every suite green.
- [ ] **Step 5: Checkpoint — the user commits** (suggested: `Financial MVP P1: project-finance.js — labels, centavos, BOQ basis, profit view`).

---

### Task 2: `project-finance.js` — allocation remaining, fund balances, duplicate billing numbers

**Files:** Modify `js/project-finance.js`, `tests/project-finance.test.js`

**Interfaces:**
- Consumes: `pcValidateAllocationPolicy` from `billing-allocation.js` (`require('./billing-allocation.js')` under Node, the global in the browser); `pfCents`, `PF_LABELS` (Task 1).
- Produces:
  - `pfPeriodBuckets(baseCents: integer, policy) → { directCents, indirectCents, reserveCents } | null`
    - direct = round(base × directPct / 100); indirect = round(base × indirectPct / 100); reserve = base − direct − indirect.
    - Rounding half away from zero. A negative base is allowed, so an exact reversal negates every bucket.
    - An invalid policy → `null`.
  - `pfAllocationRemaining({ periods, allocationMap, spentCents, allTime }) → { totalCents|null, operatingCents|null, directCents, indirectCents, reserveCents, missing, incomplete }`
    - Client periods are those with `fundingType !== 'president'`.
    - `missing` counts client periods with base > 0 and no valid policy in `allocationMap[id]`.
    - `totalCents` = Σ client base cents − spentCents.
    - `operatingCents` = direct + indirect − spentCents, or `null` when `missing > 0` (`incomplete: true`).
    - Both totals are `null` when `!allTime`.
  - `pfFundBalances({ periods, payroll, expenses, overhead, folderIds: Set }) → { rows, notChargedCents, notChargedRows: { expenses, overhead }, spentCents, clientBaseCents, totalRemainingCents }`
    - Each row: `{ id, folderId, fundingType, billingNumber, month, year, cover, baseCents, chargedCents, balanceCents|null, companyFrontedCents|null }`.
    - Payroll amount is `amount ?? totalSalary`.
    - A period's charged cost = payroll and expenses whose `projectId === period.id`, plus non-deleted, non-company overhead rows with `billingPeriodId === period.id && folderId === period.folderId`.
    - A Cover period: `balanceCents: null`, `companyFrontedCents = chargedCents`.
    - Not charged = expenses with no `projectId` whose `folderId ∈ folderIds`, plus overhead rows in `folderIds` that match no listed period.
    - `spentCents` = Σ charged + not charged. `totalRemainingCents` = clientBase − spent.
    - All sums are signed.
  - `pfDuplicateBillingNumbers(periods) → [{ folderId, number, periods: [{ id, month, year }] }]`
    - Client periods with `Number(billingNumber) > 0`, grouped by folder + number, groups of two or more.
    - Periods within a group are in calendar order; groups are in number order.
  - `pfDuplicateText(group) → 'Billing #3 is used by 2 periods (September 2026, October 2026) — check and renumber'`

- [ ] **Step 1: Write the failing tests** (append):

```js
const policy = { directPct: 70, indirectPct: 20, targetMarginPct: 10 };
eq(PF.pfPeriodBuckets(10000000, policy), { directCents: 7000000, indirectCents: 2000000, reserveCents: 1000000 }); // T01
eq(PF.pfPeriodBuckets(10001, policy), { directCents: 7001, indirectCents: 2000, reserveCents: 1000 });            // T02
eq(PF.pfPeriodBuckets(-10001, policy), { directCents: -7001, indirectCents: -2000, reserveCents: -1000 });        // exact reversal
eq(PF.pfPeriodBuckets(100, null), null);
const a = { id: 'a', folderId: 'f', fundingType: 'progress', monthlyBudget: 100000 };
let r = PF.pfAllocationRemaining({ periods: [a], allocationMap: { a: policy }, spentCents: PF.pfCents(87000), allTime: true });
eq([r.operatingCents, r.totalCents, r.incomplete], [900000, 1300000, false]);                                      // T01
r = PF.pfAllocationRemaining({ periods: [a, { id: 'b', folderId: 'f', fundingType: 'progress', monthlyBudget: 150000 },
  { id: 'z', folderId: 'f', fundingType: 'progress', monthlyBudget: 0 },
  { id: 'c', folderId: 'f', fundingType: 'president', monthlyBudget: 0 }],
  allocationMap: { a: policy }, spentCents: PF.pfCents(87000), allTime: true });
eq([r.missing, r.incomplete, r.operatingCents, r.totalCents], [1, true, null, 6300000]);                           // T21
eq(PF.pfAllocationRemaining({ periods: [a], allocationMap: { a: policy }, spentCents: 0, allTime: false }).totalCents, null);
// fund balances — signed credit, Cover, deleted, company, stray link (Review Focus 4)
const fb = PF.pfFundBalances({ folderIds: new Set(['f']),
  periods: [a, { id: 'c', folderId: 'f', fundingType: 'president', monthlyBudget: 0 }],
  payroll: [{ projectId: 'a', totalSalary: 30000 }],
  expenses: [{ projectId: 'a', amount: 40000 }, { projectId: 'a', amount: -5000 }, { projectId: 'c', amount: 2000 },
    { projectId: null, folderId: 'f', amount: 1000 }],
  overhead: [{ folderId: 'f', billingPeriodId: 'a', amount: 3000 }, { folderId: 'f', billingPeriodId: null, amount: 500 },
    { folderId: 'f', billingPeriodId: 'elsewhere', amount: 700 }, { folderId: 'f', billingPeriodId: 'a', amount: 900, deletedAt: 'x' },
    { folderId: 'f', scope: 'company', amount: 9999 }] });
const row = id => fb.rows.find(x => x.id === id);
eq([row('a').chargedCents, row('a').balanceCents], [6800000, 3200000]);
eq([row('c').balanceCents, row('c').companyFrontedCents], [null, 200000]);
eq([fb.notChargedCents, fb.notChargedRows, fb.spentCents, fb.totalRemainingCents],
  [660000, { expenses: 1, overhead: 2 }, 7220000, 2780000]);
eq(row('a').balanceCents - row('c').companyFrontedCents - fb.notChargedCents, fb.totalRemainingCents);
// Additional Works counted once; overhead pointing at another folder's period is not charged (Review Focus 5)
const aw = { id: 'w', folderId: 'aw', fundingType: 'progress', monthlyBudget: 20000 };
const fbAw = PF.pfFundBalances({ folderIds: new Set(['f', 'aw']), periods: [a, aw], payroll: [], expenses: [],
  overhead: [{ folderId: 'aw', billingPeriodId: 'w', amount: 100 }, { folderId: 'f', billingPeriodId: 'w', amount: 50 }] });
eq([fbAw.rows.length, fbAw.rows.find(x => x.id === 'w').chargedCents, fbAw.notChargedCents, fbAw.clientBaseCents],
  [2, 10000, 5000, 12000000]);
// duplicate billing numbers (T19)
const dup = PF.pfDuplicateBillingNumbers([
  { id: 'o', folderId: 'f', fundingType: 'progress', billingNumber: 3, month: 'October', year: '2026' },
  { id: 's', folderId: 'f', fundingType: 'progress', billingNumber: 3, month: 'September', year: '2026' },
  { id: 'm', folderId: 'f', fundingType: 'mobilization', billingNumber: null, month: 'May', year: '2026' },
  { id: 'n', folderId: 'f', fundingType: 'mobilization', billingNumber: 0, month: 'May', year: '2026' },
  { id: 'p', folderId: 'f', fundingType: 'president', billingNumber: 3, month: 'May', year: '2026' },
  { id: 'x', folderId: 'g', fundingType: 'progress', billingNumber: 3, month: 'May', year: '2026' }]);
eq(dup.map(g => [g.number, g.periods.map(p => p.id)]), [[3, ['s', 'o']]]);
eq(PF.pfDuplicateText(dup[0]), 'Billing #3 is used by 2 periods (September 2026, October 2026) — check and renumber');
```

- [ ] **Step 2: Run** `node tests/project-finance.test.js`. Expected: FAIL (`PF.pfPeriodBuckets is not a function`).
- [ ] **Step 3: Implement** the five functions in `js/project-finance.js`.
- [ ] **Step 4: Run** `node tests/project-finance.test.js && npm test`. Expected: PASS.
- [ ] **Step 5: Checkpoint — the user commits** (`Financial MVP P1: allocation remaining, fund balances by period id, duplicate billing numbers`).

---

### Task 3: Freeze both Sample snapshots; give `_folderCompletion` its basis fields

**Files:**
- Create: `tests/fixtures/sample-residence-2026-11-12.json`, `tests/fixtures/sample-residence-2026-11-14.json`, `tests/helpers/portal-money.js`, `tests/sample-regression.test.js`
- Modify: `js/portal-app.compiled.js` (`_folderCompletion`, ~line 369), `package.json` (append `&& node tests/sample-regression.test.js`)

**Interfaces:**
- Produces `_folderCompletion(boqRaw, folderId)`:
  - unchanged `{ hasData, pct, boqContract, boqAcc }`;
  - plus `status: doc.status || 'draft'` and `savedAt` from the **same** chosen doc. `savedAt` is an ISO string: `doc.updatedAt.toDate().toISOString()` for a Timestamp, the string as is, otherwise `null`.
  - When a doc exists with no progress: `{ hasData: false, pct: 0, status, savedAt }`.
  - No doc: unchanged `{ hasData: false, pct: 0 }`.
- Produces `tests/helpers/portal-money.js`:
  - `loadPortalMoney() → { peso, mapPayrollDoc, mapExpenseDoc, mapMonthlyProject, buildProject, _folderCompletion, _projSpent, _projMargin }`, evaluated from live source slices:
    - `'const peso = (n, opts = {}) =>'` → `'const _staff ='`;
    - `'const LIABILITY_KEYWORDS'` → `'const PC_EXPENSE_IMAGE_FIELDS'`;
    - `'function mapExpenseDoc'` → `'function FoldersGrid'`;
    - plus a `shortRef` stub.
    - A missing marker throws `SLICE NOT FOUND`.
  - `projectFromRows({ folder, periods, payroll, expenses, overhead, boqDocs }) → project`:
    - `buildProject(folder, periods.map(mapMonthlyProject), payroll.map(mapPayrollDoc), expenses.map(e => mapExpenseDoc({ ...e, docs: {} })), overhead.filter(live project rows))`;
    - then `project.spent = _projSpent(project)` and `project.completion = _folderCompletion(boqDocs, folder.id)`.
    - No Additional Works merge; the tool in Task 10 merges children itself, the way `PortalApp` does.
  - `projectFromFixture(fx) → projectFromRows({ ...fx, boqDocs: [fx.boq] })`.

**Fixture `sample-residence-2026-11-12.json`** (exact content; ids in full; amounts aggregated per period and kind; no names):

```json
{
  "name": "Sample Residence — 12 Nov 2026 snapshot (the ₱74,267 display)",
  "frozenOn": "2026-11-14",
  "window": { "from": "2026-11-12T12:16:14+08:00", "until": "2026-11-13T11:07:32+08:00" },
  "today": "2026-11-12T04:16:15Z",
  "folder": { "id": "00000000-0000-4000-8000-000000000001", "name": "Sample Residence", "totalBudget": 6600000 },
  "boq": { "folderId": "00000000-0000-4000-8000-000000000001", "status": "draft", "updatedAt": "2026-09-07T06:14:46.774Z",
    "costItems": [{ "subItems": [{ "lineItems": [{ "qty": 1, "materialRate": 6822056.76, "laborRate": 0, "percentCompletion": 70 }] }] }] },
  "policy": { "directPct": 70, "indirectPct": 20, "targetMarginPct": 10 },
  "periods": [
    { "id": "00000000-0000-4000-8000-000000000002", "folderId": "00000000-0000-4000-8000-000000000001", "fundingType": "downpayment", "billingNumber": 1, "month": "June", "year": "2026", "monthlyBudget": 3150000 },
    { "id": "00000000-0000-4000-8000-000000000003", "folderId": "00000000-0000-4000-8000-000000000001", "fundingType": "progress", "billingNumber": 2, "month": "August", "year": "2026", "monthlyBudget": 1056000 },
    { "id": "00000000-0000-4000-8000-000000000004", "folderId": "00000000-0000-4000-8000-000000000001", "fundingType": "progress", "billingNumber": 3, "month": "September", "year": "2026", "monthlyBudget": 1056000 },
    { "id": "00000000-0000-4000-8000-000000000005", "folderId": "00000000-0000-4000-8000-000000000001", "fundingType": "progress", "billingNumber": 3, "month": "October", "year": "2026", "monthlyBudget": 528000 },
    { "id": "00000000-0000-4000-8000-000000000006", "folderId": "00000000-0000-4000-8000-000000000001", "fundingType": "mobilization", "billingNumber": null, "month": "May", "year": "2026", "monthlyBudget": 150000 }
  ],
  "payroll": [
    { "projectId": "00000000-0000-4000-8000-000000000002", "laborType": "direct", "totalSalary": 851064 },
    { "projectId": "00000000-0000-4000-8000-000000000002", "laborType": "indirect", "totalSalary": 109670.73 },
    { "projectId": "00000000-0000-4000-8000-000000000003", "laborType": "direct", "totalSalary": 716379 },
    { "projectId": "00000000-0000-4000-8000-000000000004", "laborType": "direct", "totalSalary": 45000 },
    { "projectId": "00000000-0000-4000-8000-000000000005", "laborType": "direct", "totalSalary": 129000 }
  ],
  "expenses": [
    { "projectId": "00000000-0000-4000-8000-000000000002", "amount": 829152, "coverExpense": false },
    { "projectId": "00000000-0000-4000-8000-000000000002", "amount": 22950, "coverExpense": true },
    { "projectId": "00000000-0000-4000-8000-000000000003", "amount": 900615, "coverExpense": false },
    { "projectId": "00000000-0000-4000-8000-000000000004", "amount": 109155, "coverExpense": false },
    { "projectId": "00000000-0000-4000-8000-000000000005", "amount": 448800, "coverExpense": false },
    { "projectId": "00000000-0000-4000-8000-000000000005", "amount": 41862, "coverExpense": true },
    { "projectId": "00000000-0000-4000-8000-000000000006", "amount": 14826, "coverExpense": false },
    { "projectId": "00000000-0000-4000-8000-000000000006", "amount": 2,880, "coverExpense": true },
    { "projectId": null, "folderId": "00000000-0000-4000-8000-000000000001", "amount": 107070, "coverExpense": true }
  ],
  "overhead": [
    { "folderId": "00000000-0000-4000-8000-000000000001", "scope": "project", "billingPeriodId": "00000000-0000-4000-8000-000000000003", "amount": 7216.5 },
    { "folderId": "00000000-0000-4000-8000-000000000001", "scope": "project", "billingPeriodId": "00000000-0000-4000-8000-000000000004", "amount": 22635 },
    { "folderId": "00000000-0000-4000-8000-000000000001", "scope": "project", "billingPeriodId": null, "amount": 173025 }
  ],
  "expected": {
    "spentCents": 454573323, "laborCents": 174144300, "materialCents": 247731000, "overheadCents": 32698023, "coverCents": 17476200,
    "legacyLabel": "Net Profit · Earned", "legacyHeroText": "₱ 74,267",
    "earnedCents": 462000000, "boqEstimateCents": 7426677, "boqEstimateText": "₱ 74,266.77", "marginText": "1.61%",
    "ageDays": 66, "savedText": "BOQ last saved 7 Sep 2026", "badges": ["Draft", "Stale · 66 days"],
    "headline": { "kind": "notConfirmed", "label": "Profit not confirmed", "cents": null, "reasons": ["BOQ is Draft", "BOQ last saved 66 days ago"] },
    "directCents": 415800000, "indirectCents": 118800000, "reserveCents": 59400000,
    "directVarianceCents": -6075300, "indirectVarianceCents": 86101977,
    "operatingCents": 80026677, "totalRemainingCents": 139426677,
    "contractLessCostCents": 205426677, "contractLessAllocatedCents": 66000000,
    "fundBalanceCents": {
      "00000000-0000-4000-8000-000000000002": 133716327, "00000000-0000-4000-8000-000000000003": -58264350,
      "00000000-0000-4000-8000-000000000004": 87921000, "00000000-0000-4000-8000-000000000005": -9166200,
      "00000000-0000-4000-8000-000000000006": 13229400 },
    "notChargedCents": 28009500,
    "duplicates": [{ "number": 3, "periodIds": ["00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"],
      "text": "Billing #3 is used by 2 periods (September 2026, October 2026) — check and renumber" }]
  }
}
```

**Fixture `sample-residence-2026-11-14.json`** — identical except:
- `name`: `"Sample Residence — 14 Nov 2026 live snapshot"`
- `window`: `{ "from": "2026-11-13T20:49:40+08:00", "until": null }`
- `today`: `"2026-11-13T16:36:00Z"`
- payroll row for `757e630a…`: `totalSalary` **190500**
- no-period expense: `amount` **111093**
- overhead row for `0bf58942…`: `amount` **23019**
- `expected`:

```json
{ "spentCents": 461164023, "laborCents": 180294300, "materialCents": 248133300, "overheadCents": 32736423, "coverCents": 17878500,
  "legacyLabel": "Net Profit · Earned", "legacyHeroText": "₱ 8,360",
  "earnedCents": 462000000, "boqEstimateCents": 835977, "boqEstimateText": "₱ 8,359.77", "marginText": "0.18%",
  "ageDays": 68, "savedText": "BOQ last saved 7 Sep 2026", "badges": ["Draft", "Stale · 68 days"],
  "headline": { "kind": "notConfirmed", "label": "Profit not confirmed", "cents": null, "reasons": ["BOQ is Draft", "BOQ last saved 68 days ago"] },
  "directCents": 415800000, "indirectCents": 118800000, "reserveCents": 59400000,
  "directVarianceCents": -12627600, "indirectVarianceCents": 86063577,
  "operatingCents": 73435977, "totalRemainingCents": 132835977,
  "contractLessCostCents": 198835977, "contractLessAllocatedCents": 66000000,
  "fundBalanceCents": {
    "00000000-0000-4000-8000-000000000002": 133716327, "00000000-0000-4000-8000-000000000003": -58264350,
    "00000000-0000-4000-8000-000000000004": 87882600, "00000000-0000-4000-8000-000000000005": -15316200,
    "00000000-0000-4000-8000-000000000006": 13229400 },
  "notChargedCents": 28411800,
  "duplicates": [{ "number": 3, "periodIds": ["00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"],
    "text": "Billing #3 is used by 2 periods (September 2026, October 2026) — check and renumber" }] }
```

- [ ] **Step 1: Write the failing test** `tests/sample-regression.test.js`. For each fixture, with `old = loadPortalMoney()`, `p = projectFromFixture(fx)`, `m = old._projMargin(p)`, `c = PF.pfCents`, `x = fx.expected`:

```js
// the old path reproduces what was on screen (the verified cause)
eq([c(p.spent), c(p.labor), c(p.material), c(p.overhead), c(p.coverCost)],
   [x.spentCents, x.laborCents, x.materialCents, x.overheadCents, x.coverCents]);
eq([m.isForecast, c(m.earned), c(m.profit)], [false, x.earnedCents, x.boqEstimateCents]);
eq('₱ ' + old.peso(m.profit), x.legacyHeroText);
eq([p.completion.status, p.completion.savedAt], ['draft', '2026-09-07T06:14:46.774Z']);
// the new view: same number, new label, demoted (R1, R2, R4)
const v = PF.pfProfitView({ contract: p.revenue, spent: p.spent, completion: p.completion, today: new Date(fx.today), period: 'All Time' });
eq([v.boq.profitCents, PF.pfPeso(v.boq.profitCents), PF.pfPct(v.boq.marginPct)], [x.boqEstimateCents, x.boqEstimateText, x.marginText]);
eq([v.boq.label, v.boq.basis.ageDays, v.boq.basis.savedText, v.boq.basis.badges], ['BOQ-based profit estimate', x.ageDays, x.savedText, x.badges]);
eq(v.headline, x.headline);
assert.doesNotMatch(JSON.stringify(v), /Net Profit|Earned/);
eq(v.recognized.text, 'Unavailable');
eq(v.contractLessCost.cents, x.contractLessCostCents);
// allocation, by period id
const map = Object.fromEntries(fx.periods.map(q => [q.id, fx.policy]));
const months = fx.periods.map(old.mapMonthlyProject);   // keeps id and folderId
const r = PF.pfAllocationRemaining({ periods: months, allocationMap: map, spentCents: c(p.spent), allTime: true });
eq([r.directCents, r.indirectCents, r.reserveCents, r.operatingCents, r.totalCents],
   [x.directCents, x.indirectCents, x.reserveCents, x.operatingCents, x.totalRemainingCents]);
eq([r.directCents - c(p.labor) - c(p.material), r.indirectCents - c(p.overhead)], [x.directVarianceCents, x.indirectVarianceCents]);
eq(c(p.revenue) - c(p.allocated), x.contractLessAllocatedCents);
eq(c(p.allocated) - c(p.spent), x.totalRemainingCents, 'old Budget Remaining equals the new total');
const fb = PF.pfFundBalances({ periods: months, payroll: fx.payroll, expenses: fx.expenses, overhead: fx.overhead, folderIds: new Set([fx.folder.id]) });
eq(Object.fromEntries(fb.rows.map(q => [q.id, q.balanceCents])), x.fundBalanceCents);
eq([fb.notChargedCents, fb.spentCents, fb.totalRemainingCents], [x.notChargedCents, x.spentCents, x.totalRemainingCents]);
eq(PF.pfDuplicateBillingNumbers(months).map(g => ({ number: g.number, periodIds: g.periods.map(q => q.id), text: PF.pfDuplicateText(g) })), x.duplicates);
// R3: no allocation figure produces the estimate
for (const cents of [r.directCents, r.directCents + r.indirectCents, r.reserveCents, r.operatingCents, r.totalCents,
  r.directCents - c(p.spent), c(p.allocated) * 7 / 10]) assert.notStrictEqual(cents, x.boqEstimateCents);
```

  Also, once: two BOQ docs for one folder — doc A (2 cost items, `draft`, saved `2026-09-01T00:00:00Z`) and doc B (1 cost item, `approved`, saved `2026-11-01T00:00:00Z`). `_folderCompletion` returns doc A's `status` and `savedAt` (the same doc its `pct` comes from).
- [ ] **Step 2: Run** `node tests/sample-regression.test.js`. Expected: FAIL (`p.completion.status` is `undefined`).
- [ ] **Step 3: Implement** the `_folderCompletion` fields (Interfaces) and `tests/helpers/portal-money.js`. Create both fixtures exactly as above.
- [ ] **Step 4: Run** `node tests/sample-regression.test.js && node tests/money-math.test.js && npm test`. Expected: PASS. Money-math §B is unchanged and still green.
- [ ] **Step 5: Checkpoint — the user commits** (`Financial MVP P1: freeze Sample Residence 12 Nov and 14 Nov snapshots as regression fixtures`).

---

### Task 4: Project Control dashboard — hero, funding line, reserve comparison

**Files:**
- Modify: `js/portal-app.compiled.js`:
  - `_pcAllocationSummary` (~1236), new `_pcFinance` directly after it;
  - `ProjectLedger` (~1102), `CostBudget` reserve card (~1441);
  - `PortalApp` (`finance` near `allocationSummary`, ~4207; the dashboard render, ~4367).
- Modify tests: `tests/billing-allocation.test.js` (`dashboardHarness` context gains `...require('../js/project-finance.js')`; `testProjectLedger`; the reserve assertions in `testAllocationDashboard`), `tests/project-control-staff.test.js` (`allocation` becomes `{ ...require('../js/billing-allocation.js'), ...require('../js/project-finance.js') }`).

**Interfaces:**
- Consumes: `pfProfitView`, `pfAllocationRemaining`, `pfPeso`, `pfPct`, `pfCents`, `PF_LABELS` (Tasks 1–2); `_folderCompletion` fields (Task 3).
- Produces:
  - `_pcFinance(project, { period, today, periods, allocationMap }) → { profit: ProfitView, remaining: AllocationRemaining }`.
    - `contract = project.revenue`, `spent = _projSpent(project)`.
    - `periods` = the months of the project **and its Additional Works children**.
    - `allocationMap = null` for non-owners.
  - `_pcAllocationSummary(..., folderIds, today = new Date())` adds `profitBasis: 'current'|'unconfirmed'|'none'`. It passes `profitBasis !== 'current'` as the rollup's `isForecast` argument, so `targetMarginVariance` is `null` unless the BOQ estimate is current.
  - `ProjectLedger({ project, inboxPending, finance })`, `CostBudget({ ..., finance })`.
  - `PortalApp` computes `finance` once and passes it to `ProjectLedger`, `CostBudget`, `PageHead` (Task 6) and `BillingPeriodsDrill` (Task 5).

**Hero layout** (non-staff only; staff keep today's white cells):
- Label: `headline.label`. Value: `pfPeso(headline.cents)`, or `—` when `cents` is `null`. Sub-line: `headline.reasons.join(' · ')`.
- Styling: red when `headline.cents < 0`, neutral (`pc-ledger-hero--unconfirmed`) when `kind !== 'boq'`, green otherwise.
- The "Total Contract" / "Actual Cost" pair stays.
- A breakdown list under the hero, one row each:
  1. `BOQ-based profit estimate`:
     - value `pfPeso(boq.profitCents)`, or `No BOQ progress recorded`;
     - meta `NN.N% complete · <savedText>`, each badge as a warning chip, `<pfPct(marginPct)> of BOQ-earned revenue`;
     - `PF_LABELS.boqSaveNote` in small print whenever a date shows.
  2. `Projected final profit` with `projected.text` — only when `profit.projected` is not `null`.
  3. `Recognized Project Profit` — `Unavailable`, with `No verified accounting source`.
  4. `Contract less cost to date` — `pfPeso(cents)`, or `All Time only`.
- Funding line (behind the eye):
  - `Fund Allocated`;
  - `Total allocation remaining, including reserve` (`pfPeso(totalCents)` / `All Time only`), replacing "Budget Remaining";
  - owner only: `Operating allocation remaining` (`pfPeso(operatingCents)`, or `Incomplete — 1 billing period has no allocation` / `Incomplete — N billing periods have no allocation`, or `All Time only`);
  - `Cover Expenses` unchanged.
- `heroLbl`, `rateLbl` and the "Net Profit / Net Loss · Earned / Forecast" strings are removed.

**Reserve card** (`CostBudget`):
- The left figure is labelled `BOQ-based profit estimate`, with its badges when not current, or `No BOQ progress recorded`.
- The comparison reads:
  - `Ahead of plan` / `Short of plan` only when `profitBasis === 'current'`;
  - `No comparison — BOQ is draft or stale` when `'unconfirmed'`;
  - `No comparison yet` when `'none'`.

- [ ] **Step 1: Rewrite the failing tests.**
  - In `testProjectLedger`, build `finance` with `h.context._pcFinance(project, { period: 'All Time', today: new Date('2026-11-12T04:16:15Z'), periods, allocationMap })` and assert:
    - **No BOQ:** text contains `Profit not confirmed`, `No BOQ progress recorded`, `Recognized Project Profit`, `Unavailable`, `Contract less cost to date`, `₱ 825,000.00`. It does not match `/Net Profit|Net Loss|· Earned|· Forecast|profit rate|Budget Remaining/`.
    - **The 12 Nov fixture project** (loaded through `tests/helpers/portal-money.js`): `Profit not confirmed`, `BOQ-based profit estimate`, `₱ 74,266.77`, `70.0% complete`, `BOQ last saved 7 Sep 2026`, `Draft`, `Stale · 66 days`, the save note, `1.61% of BOQ-earned revenue`.
    - **Approved BOQ saved 2026-11-01:** the hero label is `BOQ-based profit estimate` and the hero value is that estimate.
    - **Eye open, owner:** `Total allocation remaining, including reserve` `₱ 1,394,266.77` and `Operating allocation remaining` `₱ 800,266.77`.
    - **One funded client period without a snapshot:** `Incomplete — 1 billing period has no allocation`.
    - **`testLedgerAllTimeOnly`:** `finance` built with `period: 'This Month'` shows `All Time only` for the headline, Contract less cost to date and both remaining figures, and no peso figure in those rows.
    - **Staff:** the existing assertions are kept, and `/Profit|profit|allocation remaining|Show figures/` doesn't match.
  - In `testAllocationDashboard`, replace the `Forecast profit` / `Earned so far` assertions with the three reserve-card readings above. For an approved, fresh BOQ, `targetMarginVariance` is a number; for a draft one, it is `null`.
- [ ] **Step 2: Run** `node tests/billing-allocation.test.js`. Expected: FAIL (`_pcFinance is not a function`).
- [ ] **Step 3: Implement** `_pcFinance`, the `_pcAllocationSummary` change, `ProjectLedger`, the reserve card and the `PortalApp` wiring (`finance` memoised on `project`, `period`, the months and `visibleAllocationMap`). Pass `period` through.
- [ ] **Step 4: Run** `node tests/billing-allocation.test.js && node tests/project-control-staff.test.js && node --check js/portal-app.compiled.js && npm test`. Expected: PASS.
- [ ] **Step 5: Checkpoint — the user commits** (`Financial MVP P1: Project Control hero — BOQ-based profit estimate, both allocation-remaining figures`).

---

### Task 5: Project Control lists — company strip, folder grid, Additional Works, Billing Periods

**Files:** Modify `js/portal-app.compiled.js`:
- Company P&L strip (~905–922);
- `FoldersGrid` health banner (~729–762), card stat "Remaining" (~924), `runHealthCheck` payload (~704);
- `AdditionalWorksDrill` header (~2566);
- `BillingPeriodsDrill` (~1785–1880; gains a `period` prop from `PortalApp`).

Tests: `tests/billing-allocation.test.js`, `tests/project-control-staff.test.js`.

**Interfaces:**
- Consumes: `pfProfitView`, `pfBoqBasis`, `pfDuplicateBillingNumbers`, `pfDuplicateText`, `pfPeso`, `PF_LABELS`.
- Produces (for Task 8): the `runHealthCheck` payload adds, per project:
  - `contractLessCost` (pesos);
  - `boqProfit` (pesos or `null`), `boqMarginPct` (number or `null`), `boqCurrent` (boolean), `boqBadges` (string[]);
  - all from `pfProfitView({ …, period: 'All Time', today: new Date() })`.

**Exact copy:**
- **Company strip:**
  - title `Company profit estimate · BOQ-based`;
  - cells `BOQ-based estimate · all projects`, `Company Overhead`, `After company overhead`;
  - sub-line `N of M projects measured by BOQ · K draft or stale` (K = measured projects whose basis is not current);
  - the help tip says "BOQ-based estimates", never "earned".
- **Health banner:**
  - `_negM` = projects with `boqProfit < 0`, or with no BOQ progress and spent > contract. Message: `<n> showing a loss (BOQ-based estimate, or cost above the contract) — <name><more>.`
  - `_lowM` = projects with a **current** BOQ estimate and margin < 10. Message: `<n> with a low BOQ-based margin — <name><more>.`
- **Folder card:** `Remaining` → `Total allocation remaining, including reserve`.
- **Additional Works header:** `Remaining` → `Contract less cost to date`.
- **Billing Periods:**
  - header `Remaining` → `Total allocation remaining, including reserve`;
  - card `Remaining` → `Fund balance`;
  - when `period !== 'All Time'`, both read `All Time only`;
  - above the cards, one `role="note"` line per `pfDuplicateText(group)` for this folder's periods, visible to every role (no pesos).

- [ ] **Step 1: Write the failing tests.**
  - `FoldersGrid` (owner):
    - no `/Net Profit|Gross Profit|Company Profit · To Date/`;
    - the three new labels present;
    - `1 of 2 projects measured by BOQ · 1 draft or stale` for one draft-BOQ project plus one without a BOQ;
    - a project with a negative draft estimate gives the `showing a loss` banner;
    - a project with contract − spent at 8% and no BOQ gives no low-margin banner.
  - `BillingPeriodsDrill` with the 12 Nov fixture months and rows:
    - the duplicate note text appears exactly once;
    - cards show `Fund balance` with `879,210.00` and `91,662.00` on two different cards (matched by id);
    - header `Total allocation remaining, including reserve`.
  - `testBillingPeriodsAllTimeOnly`: `period: 'This Month'` gives `All Time only`.
  - Staff: the duplicate note shows, no peso.
- [ ] **Step 2: Run** `node tests/billing-allocation.test.js && node tests/project-control-staff.test.js`. Expected: FAIL on the new assertions.
- [ ] **Step 3: Implement** the copy and logic above. Update any older assertion that read `Remaining` to its new label.
- [ ] **Step 4: Run** `npm test && node --check js/portal-app.compiled.js`. Expected: PASS.
- [ ] **Step 5: Checkpoint — the user commits** (`Financial MVP P1: company strip, folder grid, billing periods — labels, duplicate billing numbers`).

---

### Task 6: Project cost summary print

**Files:** Modify `js/print-utils.js` (`dacsPrintProjectCostSummary`, ~141–270), `js/portal-app.compiled.js` (`PageHead.printSummary`, ~945); test `tests/billing-allocation.test.js` (`testAllocationPrint`; the print vm context gains the `project-finance.js` exports).

**Interfaces:**
- Consumes: `finance` from Task 4; `pfPeso`, `pfPct`, `PF_LABELS` as globals. `project-finance.js` loads before `print-utils.js`.
- Produces: the payload gains `finance: { profit, remaining }`. `earned`, `profit`, `marginPct`, `isForecast` and `completePct` stay in the payload, but the print no longer reads them.

**Print content:**
- **"Where does the money stand?" grid:** `Total contract` | `Fund spent` | `headline.label` with `pfPeso(headline.cents)` or the reasons | margin cell.
  - The margin cell shows only when `headline.kind === 'boq'`, as `<pct> of BOQ-earned revenue`.
- **New "Profit figures" block:** the four breakdown rows from Task 4, including the save note.
- **Allocation table (owner):**
  - `Actual Earned Profit` / `Forecast Profit` → `BOQ-based profit estimate` (plus ` (Draft · Stale · 66 days)` when not current);
  - `Target Variance` only when `profitBasis === 'current'`;
  - two new rows, `Operating allocation remaining` and `Total allocation remaining, including reserve`.

- [ ] **Step 1: Update `testAllocationPrint`** (failing).
  - The printed HTML includes `Profit not confirmed`, `BOQ-based profit estimate`, `BOQ last saved`, `Recognized Project Profit`, `Unavailable`, `Contract less cost to date`, `Operating allocation remaining`, `Total allocation remaining, including reserve`.
  - It excludes `Actual Earned Profit`, `Forecast Profit`, `Net profit`, `Earned against accomplishment`.
  - `Target Variance` appears only for a current-basis summary.
- [ ] **Step 2: Run** `node tests/billing-allocation.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && node --check js/print-utils.js`. Expected: PASS.
- [ ] **Step 5: Checkpoint — the user commits** (`Financial MVP P1: project cost summary print — same labels and basis as the screen`).

---

### Task 7: Budget Overview and Reports (`expenses-module.js`)

**Files:**
- Modify `js/expenses-module.js`:
  - `_updateBillingSummary` (~1385–1520): hidden elements, now on `pfFundBalances`;
  - `_updateBudgetOverviewFolder` `_setDelta('expContractDeltaVal'…)` (~1583);
  - the overview's `_ovSetDelta('mvpOvKpiContractDelta1'…)` (~7376);
  - `_PC_REPORT_HEADERS` (~5913), `_rptRenderKPIs` (~6200), `_rptRenderTable` (~6364);
  - report print (~6690–6703).
- Modify `admin.html`: caption `Actual Costs by Period` → `Actual Costs by Period · Costs by date` (~1056); bump `expenses-module.js?v=20261114a`.
- Create `tests/budget-overview-labels.test.js`; append it to `package.json`.

**Interfaces:**
- Consumes: `pfFundBalances`, `pfCents`, `pfPeso`, `PF_LABELS` (globals; `project-finance.js` loads before `expenses-module.js`).
- Overhead rows come from `_rptOvhdRows` (owner-loaded). While it is `null`, `Contract less cost to date` and the total read `Unavailable`. No fallback leaves overhead out.

**Exact changes:**
- **`_updateBillingSummary`:**
  - stats become `Total Contract`, `Cost to date`, `Contract less cost to date`;
  - each billing shows `₱X allocated` (never "received") and a `Fund balance` chip from `balanceCents`; a Cover period shows `Company-fronted cost`;
  - a `Not charged to a billing period` line;
  - the list opens with one `pfDuplicateText` line per duplicate billing number;
  - the total block reads `Total allocation remaining, including reserve`.
  - `_bsSpentForPeriod`, the month-matching helper, is removed from this card; `_payInPeriod` stays for its other callers.
- **Both deltas:** every badge reads `Contract less allocated funds` (one neutral colour); no `Profitable` / `Loss` / `Break-even`.
- **Reports:**
  - KPI `Funds Available` → `Total allocation remaining, including reserve` when `_rptState.period === 'annual'`, otherwise `Allocated less cost (by date)`;
  - `_rptRenderTable` header `Remaining` → `Allocated less cost (by date)`;
  - `_PC_REPORT_HEADERS` `Remaining` → `Fund balance`.
- **Report print:**
  - `Receivable Balance` → `Contract less allocated funds`;
  - `Total Billed (Received)` → `Total Billed (Fund Allocated)`;
  - `balanceLabel` follows the KPI rule;
  - the breakdown caption gains ` · Costs by date`, and its `Remaining` → `Allocated less cost (by date)`.
  - The `receipt` kind's `Received` / `Covered` wording is untouched: it is a receipt document, not a figure.

- [ ] **Step 1: Write the failing test** `tests/budget-overview-labels.test.js`.
  - **Source fence on `js/expenses-module.js`:** none of `'Profitable'`, `Overall Profit`, `'Overall ' + plTitle`, `Receivable Balance`, `'Funds Available'`, `Unbilled contract value`.
  - **Run `_updateBillingSummary`** (slice `function _updateBillingSummary` → `function _updateBudgetOverviewFolder`) in a vm with:
    - stub `document.getElementById` for the three ids;
    - `formatNum` sliced from source;
    - the `project-finance.js` exports;
    - `expCurrentFolder = { id, totalBudget: 6600000 }`;
    - `expExpenses` / `expPayroll` / `_rptOvhdRows` = the 12 Nov fixture rows (map `totalSalary`);
    - `projects` = the fixture periods.
  - **Assert:**
    - `Contract less cost to date` with `2,054,266.77`;
    - `Fund balance` with `879,210.00` and `91,662.00` in two separate entries;
    - `allocated` and no `received`;
    - `Not charged to a billing period` with `280,095.00`;
    - `Total allocation remaining, including reserve` with `1,394,266.77`.
  - With `_rptOvhdRows = null`: `Unavailable` and none of those three amounts.
  - **`_rptRenderKPIs`** with stubs: `annual` gives the total label; `monthly` gives `Allocated less cost (by date)`.
  - **Existing tests:** in `tests/money-math.test.js` §Reports, only failure-message strings change ("Funds Available" → the new label); the asserted amounts stay.
- [ ] **Step 2: Run** `node tests/budget-overview-labels.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && node --check js/expenses-module.js`. Expected: PASS.
- [ ] **Step 5: Checkpoint — the user commits** (`Financial MVP P1: Budget Overview and Reports — fund balance by period id, contract less allocated funds`).

---

### Task 8: AI Health Check and AI project summary

**Files:**
- Modify `js/ai-assistant.js`: move the fact computation and prompt text into two pure functions inside the IIFE, between the markers `// ── AI health facts (pure) ──` and `// ── end AI health facts ──`, directly after `esc` (~line 30). Expose them as `window.aiHealthFacts` / `window.aiHealthPrompt`; `aiHealthCheck` calls both.
- Modify `js/ai-summary.js` (~157, ~183).
- Modify `admin.html`: bump both script `?v=20261114a`.
- Create `tests/ai-health-facts.test.js` (slice from `function peso(` to `// ── end AI health facts ──`, evaluated with a stub `window`); append it to `package.json`.

**Interfaces:**
- Consumes: the Task 5 payload fields.
- Produces:
  - `aiHealthFacts(projects, coverLimit) → { totals: { contract, allocated, spent, cover, contractLessCost }, risks, warns, alerts, issuesPlain, verdict, vKind, healthyCount }`.
  - `aiHealthPrompt(facts, projectCount, today) → string`.

**Rules:**
- **Remove** `margin = (revenue − spent) / revenue` and both of its alerts.
- **Risk,** in order:
  - `spent > revenue > 0` → `<name> cost exceeds the contract by ₱X`;
  - else `boqProfit < 0` → `<name>: BOQ-based estimate shows a loss of ₱X`, plus ` (Draft, Stale · 68 days)` from `boqBadges` when not current.
- **Warn:** `boqCurrent && boqMarginPct < 10` → `<name> has a low BOQ-based margin of 5.0%`.
- **Budget, cover and no-budget alerts:** unchanged, but "over budget by" stays tied to `remaining`, which is the total allocation remaining, including reserve.
- **Card stat:** `Gross Profit` → `Contract less cost to date`.
- **Prompt:**
  - `- Total Gross Profit:` → `- Contract less cost to date (what is left of the contracts after cost so far — NOT profit): ₱…`;
  - add the sentence `Never describe contract less cost to date as profit. A BOQ-based estimate is an estimate; when it is Draft or Stale, say so.`
- **`ai-summary.js`:** stat `Remaining` and prompt line `Remaining:` → `Total allocation remaining, including reserve`.
- **Centavos:** `peso()` in both files becomes two decimals (`minimumFractionDigits: 2, maximumFractionDigits: 2`), so the card, alerts and prompt show `₱150,000.00`.

- [ ] **Step 1: Write the failing test.**
  - Facts for three projects:
    - **A** (contract 1,000,000, spent 3,150,000, no BOQ) → a risk containing `cost exceeds the contract by ₱150,000.00`.
    - **B** (contract 6,600,000, spent 4,611,640.23, `boqProfit` 8,359.77, `boqCurrent` false, badges `['Draft','Stale · 68 days']`) → no risk or warn about margin or loss.
    - **C** (`boqCurrent` true, `boqMarginPct` 5) → a warn containing `low BOQ-based margin of 5.0%`.
  - The prompt contains `Contract less cost to date` and `NOT profit`, and not `Gross Profit`.
  - Source fence: `js/ai-assistant.js` has no `Gross Profit` and no `(revenue - spent) / revenue`; `js/ai-summary.js` has no `>Remaining<` and no `'Remaining: '`.
- [ ] **Step 2: Run** `node tests/ai-health-facts.test.js`. Expected: FAIL (`SLICE NOT FOUND` / `aiHealthFacts is not defined`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && node --check js/ai-assistant.js && node --check js/ai-summary.js`. Expected: PASS.
- [ ] **Step 5: Checkpoint — the user commits** (`Financial MVP P1: AI Health Check — contract less cost to date is never profit`).

---

### Task 9: Documentation of the new rules

**Files:** Modify `CLAUDE.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/OVERHEAD_MODULE.md`.

- [ ] **Step 1: Money invariants bullet.** In `CLAUDE.md` and `AGENTS.md`, replace the bullet "Profit uses **earned** revenue. With no accomplishment data it falls back to the contract and must be labelled **"Forecast"**, never "Earned"." with:
  > - Earned − Spent is the **BOQ-based profit estimate**. `_projMargin` keeps the arithmetic; `js/project-finance.js` labels it. It always shows the BOQ %, **BOQ last saved** and Draft / For review / Stale (> 30 Manila days) / BOQ date unavailable. Unless the BOQ is approved and current it is not the headline, which then reads **"Profit not confirmed"**. With no BOQ progress there is no estimate, and contract − cost is **Contract less cost to date**, never profit. **Recognized Project Profit** is Unavailable (there is no accounting source). Cumulative figures read "All Time only" under a date filter. Sample Residence's ₱74,267 case is frozen in `tests/fixtures/` (spec `docs/superpowers/specs/2026-11-14-financial-management-mvp-design.md`).
- [ ] **Step 2: Billing allocations bullet** (both files). Change "the plan-vs-actual variance is shown only when profit is *earned*, never against a Forecast" to "the plan-vs-actual variance is shown only against a **current** BOQ-based estimate". Then append:
  > Fund Allocated − Spent is **Total allocation remaining, including reserve**. Direct + indirect − Spent is **Operating allocation remaining**: owner-only, and **Incomplete** while a funded client period has no snapshot. Contract − Fund Allocated is **Contract less allocated funds** ("Unbilled contract value" waits for verified billings). Billing periods are matched by id; duplicate billing numbers are flagged, never renumbered.
- [ ] **Step 3: `docs/ARCHITECTURE.md`.**
  - §4 module map: add a row for `project-finance.js` (`window` globals) — "Shared labelling layer for profit and allocation figures (Financial MVP Phase 1). Pure, centavos, no DB, no roles; every screen, print and AI payload reads it".
  - §6: replace the `Gross Profit` and `Net Profit` lines with `BOQ-based profit estimate = Earned − Spent` and `Company profit estimate = Σ recognised project estimate − G&A`.
  - Invariant 3: reword it to the bullet from Step 1.
  - The "Two words…" block: rename `Earned / Forecast Profit` to `BOQ-based profit estimate`.
- [ ] **Step 4: `docs/OVERHEAD_MODULE.md`.** Replace each "Earned profit" / "Forecast" profit label with the Step 1 wording. Labels only; the arithmetic text stays.
- [ ] **Step 5: Run** `npm test` (the docs change nothing it reads). **Checkpoint — the user commits** (`Docs: Financial MVP Phase 1 rules`).

---

### Task 10: Live Sample reconciliation, browser check, release gate

**Files:** Create `tools/finance/reconcile-folder.js` (CommonJS).

**Interfaces:**
- Consumes: `tests/helpers/portal-money.js` (`loadPortalMoney`, `projectFromRows`), `js/project-finance.js`.
- CLI: `node tools/finance/reconcile-folder.js --folder <folders.id> [--today <ISO>] [--sql-self-test]`.
  - `--sql-self-test` runs only the read-only guard against a built-in `update …` string and exits.
  - Additional Works children are built with `projectFromRows` each, then merged into the parent the way `PortalApp` merges them (revenue, buckets, allocated summed; completion from the parent's BOQ).

**How it reads the database:**
- Every SQL string must match `/^\s*(select|with)\b/i` and none of `/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate)\b/i`, or the tool exits 2 before running anything.
- Each query is written to a temp file and run as `npx supabase db query --linked -f <file>` through `child_process.spawnSync` with `shell: true`. The JSON is parsed from stdout and the temp file deleted.
- Queries: the folder + `folder_budgets`; its Additional Works children; their periods + `project_budgets` + `project_control_billing_allocations`; payroll, expenses and overhead for those (columns as in §3.1 of the spec); the folder's `boq_documents`.
- Worker names are read only for `classifyLabor` and are never printed.

**Prints (no names, no row-level personal data):**
- contract;
- BOQ % / status / BOQ last saved / age / badges;
- Spent and the three buckets, Cover;
- the estimate and the headline;
- direct / indirect / reserve, both variances, operating, total;
- Contract less cost to date, Contract less allocated funds;
- per period (`Billing #n Month Year` and id): base, charged, Fund balance or Company-fronted cost;
- not charged (amount and row counts);
- duplicate billing numbers;
- payroll rows without `labor_type` ("classified by name": count and amount);
- loaded row counts per table;
- the differences from the 14 Nov fixture's `expected`, listed for information only.

**Checks** (each prints PASS/FAIL; any FAIL → exit 1):
- C1. Old Spent (`_projSpent`) cents = `pfFundBalances.spentCents`.
- C2. Old `_projMargin().profit` cents = `pfProfitView().boq.profitCents` (All Time).
- C3. Old `allocated − spent` cents = `pfAllocationRemaining.totalCents` = `pfFundBalances.totalRemainingCents`. A difference means a Cover period carries a fund amount — report it.
- C4. Σ client `balanceCents` − Σ `companyFrontedCents` − `notChargedCents` = `totalRemainingCents`.
- C5. Row ids are unique per table, and every payroll / expense / live overhead row lands in exactly one period or in not charged: (charged rows + not-charged rows) = loaded rows.
- C6. When `incomplete` is false: `operatingCents` = (direct − Labor − Material) + (indirect − Overhead).

- [ ] **Step 1: Build the tool.** Dry-run its guard: `node tools/finance/reconcile-folder.js --folder x --sql-self-test`. Expected: the guard rejects a planted `update …` string and exits 2 without running anything.
- [ ] **Step 2: Run against Sample:** `node tools/finance/reconcile-folder.js --folder 00000000-0000-4000-8000-000000000001`. Expected: C1–C6 PASS.
  - If no rows were added since 14 Nov 00:36, the printed figures equal the 14 Nov fixture: Spent ₱4,611,640.23, estimate ₱8,359.77, operating ₱734,359.77, total ₱1,328,359.77, Sep #3 ₱878,826.00, Oct #3 −₱153,162.00, not charged ₱284,118.00.
  - Otherwise the differences are only the new rows.
  - Save the output beside the plan as `docs/superpowers/plans/2026-11-14-financial-mvp-phase1-sample-reconciliation.txt`.
- [ ] **Step 3: Browser check** on local code against live data (`admin.html`, owner sign-in), Sample Residence:
  - hero `Profit not confirmed` with the reasons;
  - breakdown `BOQ-based profit estimate` with today's figure, `70.0% complete · BOQ last saved 7 Sep 2026`, `Draft`, `Stale · N days`, the save note, `Recognized Project Profit — Unavailable`, `Contract less cost to date`;
  - eye: both remaining figures equal the tool's;
  - Billing Periods: the duplicate #3 note, two separate `Fund balance` cards;
  - date filter `This Month` → `All Time only`;
  - Print Summary matches the screen;
  - AI Health Check card and briefing never say "Gross Profit".
  - Then sign in as `staff@` and confirm no profit, estimate or allocation figure appears.
  - Record each item PASS/FAIL in the reconciliation file.
- [ ] **Step 4: Run** `npm test` (all suites) and the CI syntax loop locally. Expected: all PASS.
- [ ] **Step 5: Release gate — stop.** Hand the user:
  - the reconciliation file;
  - the browser-check results;
  - the list of changed files.
  - **The user commits and pushes**; the label fixes go live across Project Control only after this gate.
  - Forecasts and reports (Phases 2–3) stay unbuilt, and remain Sample-only behind the main-owner switch when they come.
