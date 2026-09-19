# Project Control Billing Allocations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-controlled 70/20/10 billing allocations to Project Control while preserving the existing actual-cost, earned-revenue and profit model.

**Architecture:** A small browser/Node-compatible allocation engine owns all percentage and variance math. Separate owner-only Supabase tables store folder defaults, immutable billing-period snapshots and adjustment history; existing client-readable budget tables remain unchanged. Expenses, Project Control, overhead, reports and exports consume the shared engine so one formula drives every surface.

**Tech Stack:** Plain HTML, vanilla JavaScript, React-via-CDN in `portal-app.compiled.js`, Supabase/Postgres/RLS/RPC, zero-dependency Node tests.

**Spec:** `docs/superpowers/specs/2026-09-19-project-control-billing-allocation-design.md`

## Global Constraints

- Never run `npm run build`; edit `js/portal-app.compiled.js` directly.
- `folders.id` and `construction_projects.id` are unrelated; this feature uses `folders` and `projects` only.
- `projects` means Project Control billing period.
- The allocation base is existing `project_budgets.monthly_budget`.
- Default policy is Direct 70%, Indirect 20%, Target Margin Reserve 10%; values are owner-configurable and must total 100%.
- Target Margin Reserve is planning data only and must never enter Spent, Earned or actual Profit.
- Existing money rules remain `Labor = direct + (liability - liabilityIndirect)`, `Overhead = indirect + liabilityIndirect + overhead_expenses`, `Spent = Labor + Material + Overhead`, `Profit = Earned - Spent`.
- Cover costs retain their Direct or Indirect classification and remain a subset of Spent.
- Company G&A, reimbursements, warranty funds, quotations and attendance rewards stay outside this feature.
- Staff must not see allocation percentages or peso amounts; clients must not receive allocation-policy rows through RLS.
- Legacy billing periods remain Allocation not configured until the owner applies a policy.
- Use local date parts, never `toISOString().slice(0,10)`, for local date keys.
- Before HTML/CSS implementation, read and apply `modern-web-guidance:modern-web-guidance`; use `superpowers:test-driven-development` for every implementation task.

---

### Task 1: Shared Allocation Engine

**Files:**
- Create: `js/billing-allocation.js`
- Create: `tests/billing-allocation.test.js`
- Modify: `admin.html:5120-5127`
- Modify: `package.json:2-4`
- Modify: `.github/workflows/ci.yml:45-55`

**Interfaces:**
- Produces: `window.PC_ALLOCATION_DEFAULTS`
- Produces: `pcValidateAllocationPolicy(policy) -> { valid, total, message }`
- Produces: `pcAllocationAmounts(base, policy) -> allocation|null`
- Produces: `pcAllocationStatus(actual, budget) -> { key, pct }`
- Produces: `pcPeriodAllocationView(base, policy, directActual, indirectActual) -> view|null`
- Produces: `pcActualsForPeriod(periodId, payroll, expenses, overhead, isIndirectPayroll) -> { directActual, indirectActual }`
- Produces: `pcProjectAllocationRollup(periodViews, unallocatedIndirect, actualProfit, isForecast) -> rollup`

- [ ] **Step 1: Write failing pure-function tests**

Create a zero-dependency test file that imports the real engine and asserts:

```js
const A = require('../js/billing-allocation.js');

eq(A.pcValidateAllocationPolicy({ directPct: 70, indirectPct: 20, targetMarginPct: 10 }).valid, true);
eq(A.pcValidateAllocationPolicy({ directPct: 70, indirectPct: 25, targetMarginPct: 10 }).valid, false);

const amounts = A.pcAllocationAmounts(100000, { directPct: 70, indirectPct: 20, targetMarginPct: 10 });
eq(amounts.directBudget, 70000);
eq(amounts.indirectBudget, 20000);
eq(amounts.targetMarginReserve, 10000);

const view = A.pcPeriodAllocationView(100000, { directPct: 70, indirectPct: 20, targetMarginPct: 10 }, 72000, 19000);
eq(view.reserveAtRisk, 1000);
eq(view.totalActual, 91000);

const actuals = A.pcActualsForPeriod(
  'p1',
  [{ projectId: 'p1', totalSalary: 30000, laborType: 'direct' },
   { projectId: 'p1', totalSalary: 5000, laborType: 'indirect' }],
  [{ projectId: 'p1', amount: 40000, coverExpense: true }],
  [{ billingPeriodId: 'p1', amount: 3000 }, { billingPeriodId: null, amount: 2000 }],
  p => p.laborType === 'indirect'
);
eq(actuals.directActual, 70000);
eq(actuals.indirectActual, 8000);
```

Also assert 80/90/over thresholds, decimal percentages, zero budgets, legacy null policies,
unassigned overhead exclusion from period usage, project rollups, and that target margin is never
added to actual cost.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node tests/billing-allocation.test.js`

Expected: FAIL because `js/billing-allocation.js` does not exist.

- [ ] **Step 3: Implement the allocation engine**

Use an ASCII-only UMD-style file so the same implementation runs in the browser and Node:

```js
(function (root) {
  'use strict';
  const PC_ALLOCATION_DEFAULTS = Object.freeze({ directPct: 70, indirectPct: 20, targetMarginPct: 10 });
  const num = value => Number(value) || 0;

  function pcValidateAllocationPolicy(policy) {
    if (!policy) return { valid: false, total: 0, message: 'Allocation not configured' };
    const values = [Number(policy.directPct), Number(policy.indirectPct), Number(policy.targetMarginPct)];
    const total = values.reduce((sum, value) => sum + value, 0);
    const valid = values.every(value => Number.isFinite(value) && value >= 0) && Math.abs(total - 100) < 0.005;
    return { valid, total, message: valid ? '' : 'Direct, Indirect and Target Margin must total 100%' };
  }

  function pcAllocationAmounts(base, policy) {
    if (!pcValidateAllocationPolicy(policy).valid) return null;
    const amount = Math.max(0, num(base));
    return {
      base: amount,
      directBudget: amount * Number(policy.directPct) / 100,
      indirectBudget: amount * Number(policy.indirectPct) / 100,
      targetMarginReserve: amount * Number(policy.targetMarginPct) / 100
    };
  }

  function pcAllocationStatus(actual, budget) {
    const spent = Math.max(0, num(actual));
    const allowed = Math.max(0, num(budget));
    if (!(allowed > 0)) return { key: spent > 0 ? 'unbudgeted' : 'empty', pct: spent > 0 ? null : 0 };
    const pct = spent / allowed * 100;
    return { key: pct > 100 ? 'over' : pct >= 90 ? 'high' : pct >= 80 ? 'advisory' : 'healthy', pct };
  }

  function pcPeriodAllocationView(base, policy, directActual, indirectActual) {
    const amounts = pcAllocationAmounts(base, policy);
    if (!amounts) return null;
    const direct = Math.max(0, num(directActual));
    const indirect = Math.max(0, num(indirectActual));
    const spendableBudget = amounts.directBudget + amounts.indirectBudget;
    const totalActual = direct + indirect;
    return Object.assign({}, amounts, {
      directActual: direct,
      indirectActual: indirect,
      directRemaining: amounts.directBudget - direct,
      indirectRemaining: amounts.indirectBudget - indirect,
      directStatus: pcAllocationStatus(direct, amounts.directBudget),
      indirectStatus: pcAllocationStatus(indirect, amounts.indirectBudget),
      spendableBudget,
      totalActual,
      reserveAtRisk: Math.max(0, totalActual - spendableBudget)
    });
  }

  function pcActualsForPeriod(periodId, payroll, expenses, overhead, isIndirectPayroll) {
    let directActual = (expenses || []).filter(row => row.projectId === periodId)
      .reduce((sum, row) => sum + num(row.amount), 0);
    let indirectActual = 0;
    (payroll || []).filter(row => row.projectId === periodId).forEach(row => {
      const amount = num(row.amount != null ? row.amount : row.totalSalary);
      if (isIndirectPayroll(row)) indirectActual += amount;
      else directActual += amount;
    });
    indirectActual += (overhead || []).filter(row => !row.deletedAt && row.billingPeriodId === periodId)
      .reduce((sum, row) => sum + num(row.amount), 0);
    return { directActual, indirectActual };
  }

  function pcProjectAllocationRollup(periodViews, unallocatedIndirect, actualProfit, isForecast) {
    const totals = (periodViews || []).filter(Boolean).reduce((sum, row) => ({
      directBudget: sum.directBudget + row.directBudget,
      indirectBudget: sum.indirectBudget + row.indirectBudget,
      targetMarginReserve: sum.targetMarginReserve + row.targetMarginReserve,
      directActual: sum.directActual + row.directActual,
      indirectActual: sum.indirectActual + row.indirectActual
    }), { directBudget: 0, indirectBudget: 0, targetMarginReserve: 0, directActual: 0, indirectActual: 0 });
    totals.unallocatedIndirect = Math.max(0, num(unallocatedIndirect));
    totals.actualProfit = num(actualProfit);
    totals.isForecast = !!isForecast;
    totals.targetMarginVariance = isForecast ? null : totals.actualProfit - totals.targetMarginReserve;
    return totals;
  }

  const api = { PC_ALLOCATION_DEFAULTS, pcValidateAllocationPolicy, pcAllocationAmounts,
    pcAllocationStatus, pcPeriodAllocationView, pcActualsForPeriod, pcProjectAllocationRollup };
  Object.keys(api).forEach(key => { root[key] = api[key]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

Keep all exported functions free of DOM and database dependencies. `pcActualsForPeriod` accepts
the classifier callback instead of duplicating the live direct/indirect payroll rule.

- [ ] **Step 4: Load the engine before its consumers**

Add `<script src="js/billing-allocation.js"></script>` immediately after `supabase-config.js` and
before `expenses-module.js`, `overhead-module.js` and deferred `portal-app.compiled.js`.

- [ ] **Step 5: Add the test to local and CI commands**

Append `node tests/billing-allocation.test.js` to `npm test`, and add a named CI step:

```yaml
      - name: Project Control billing allocations
        run: node tests/billing-allocation.test.js
```

- [ ] **Step 6: Run the focused and full tests**

Run: `node tests/billing-allocation.test.js`

Expected: all allocation-engine tests pass.

Run: `npm test`

Expected: all existing and new tests pass.

- [ ] **Step 7: Commit**

```bash
git add js/billing-allocation.js tests/billing-allocation.test.js admin.html package.json .github/workflows/ci.yml
git commit -m "test: add billing allocation engine"
```

---

### Task 2: Owner-Only Schema, RLS And Transactional Audit

**Files:**
- Create: `supabase/migrations/0073_project_control_billing_allocations.sql`
- Modify: `js/supabase-config.js:68-110`
- Modify: `tests/billing-allocation.test.js`

**Interfaces:**
- Consumes: camelCase policies `{ directPct, indirectPct, targetMarginPct }`
- Produces: collections `projectControlAllocationPolicies`, `projectControlBillingAllocations`, `billingAllocationAdjustments`
- Produces: column `overhead_expenses.billing_period_id`
- Produces: RPC `update_project_control_billing_allocation(p_project_id, p_direct_pct, p_indirect_pct, p_target_margin_pct, p_reason)`

- [ ] **Step 1: Add failing schema and registry tests**

Read the migration and shim source in `tests/billing-allocation.test.js`. Assert the three tables,
100% check constraints, owner-only RLS policies, absence of adjustment update/delete policies,
`billing_period_id` FK, transactional RPC, `auth.uid()` ownership check, and all three REG entries.
Also assert that neither `folder_budgets` nor `project_budgets` receives a margin percentage.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node tests/billing-allocation.test.js`

Expected: FAIL because migration `0073` and registry entries do not exist.

- [ ] **Step 3: Create migration 0073**

Create owner-only policy and snapshot tables with constraints of this form:

```sql
constraint project_control_policy_total_chk check (
  direct_pct >= 0 and indirect_pct >= 0 and target_margin_pct >= 0
  and abs(direct_pct + indirect_pct + target_margin_pct - 100) < 0.005
)
```

Create `billing_allocation_adjustments` with no update or delete RLS policy. Add
`overhead_expenses.billing_period_id uuid references projects(id) on delete set null` and an index.

Create a `security definer` RPC with `set search_path = public` that:

```sql
if auth.uid() is null then raise exception 'Authentication required'; end if;
perform 1 from projects
where id = p_project_id and owner_id = auth.uid()
for update;
if not found then raise exception 'Billing period not found or access denied'; end if;
if btrim(coalesce(p_reason, '')) = '' then raise exception 'Reason is required'; end if;
```

Read the allocation snapshot with `FOR UPDATE` when it exists; for a legacy period, keep the three
old values null. The same transaction inserts the before/after audit row and upserts the snapshot.
Revoke public execution and grant execution only to `authenticated`.

- [ ] **Step 4: Register the collections in the shim**

Add:

```js
projectControlAllocationPolicies: {
  table: 'project_control_allocation_policies', rename: OWNER,
  idField: 'folder_id', ts: ['updatedAt']
},
projectControlBillingAllocations: {
  table: 'project_control_billing_allocations', rename: OWNER,
  idField: 'project_id', ts: ['updatedAt']
},
billingAllocationAdjustments: {
  table: 'billing_allocation_adjustments', rename: OWNER, ts: ['createdAt']
},
```

Do not add percentage fields to the existing budget registries.

- [ ] **Step 5: Run tests**

Run: `node tests/billing-allocation.test.js && node tests/shim-fromrow.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0073_project_control_billing_allocations.sql js/supabase-config.js tests/billing-allocation.test.js
git commit -m "feat: add owner-only billing allocation schema"
```

---

### Task 3: Allocation Data Loading And Save Paths

**Files:**
- Modify: `js/expenses-module.js:59-78,352-420,794-832,2084-2202`
- Modify: `js/portal-app.compiled.js:1350-1379,1687-1780,2910-3054`
- Modify: `tests/billing-allocation.test.js`

**Interfaces:**
- Consumes: collections and RPC from Task 2
- Produces: `_pcPolicyMap[folderId]`, `_pcAllocationMap[projectId]`, `_pcAdjustmentRows`
- Produces: `pcFolderPolicy(folderId) -> policy`
- Produces: `pcPeriodPolicy(projectId) -> policy|null`
- Produces: `pcSaveAllocationAdjustment(projectId, policy, reason) -> Promise`
- Produces: Project Control React props `allocationMap` and `allocationAdjustments`

- [ ] **Step 1: Add failing source-contract tests**

Assert that the normal and Additional Works create-folder paths write a default owner-only policy,
the normal and Additional Works create-period paths write a snapshot only for non-president
periods, the edit path calls the RPC when percentages change, staff never subscribe to the
owner-only collections, and no target-margin data is written to `folderBudgets`, `projectBudgets`
or `projects`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node tests/billing-allocation.test.js`

Expected: FAIL on missing subscriptions and save paths.

- [ ] **Step 3: Add owner-only state and subscriptions to Expenses**

Add maps and unsubscribe handles beside the existing budget maps. In `loadProjects()`, subscribe
only when `window.currentUserRole !== 'staff'`. Merge policies into folder objects as
`allocationPolicy` and snapshots into period objects as `allocationPolicy`; a missing snapshot
must stay `null`.

- [ ] **Step 4: Add folder policy save paths**

`handleCreateFolder` writes the default policy after the folder row and confidential budget row.
`handleEditFolder` upserts the three validated percentages to the policy collection. If a create
step fails, clean up only rows created under that new folder ID and report the error.

Update both child-folder creation branches in `AdditionalWorksDrill` to create the same default
policy. Updating an Additional Works estimate changes `folderBudgets.totalBudget` only; it must
not rewrite an existing allocation policy.

- [ ] **Step 5: Add billing snapshot save paths**

`handleCreateProject` copies `pcFolderPolicy(folderId)` into
`projectControlBillingAllocations/{projectId}` for all funding types except `president`. Preserve
`monthlyBudget = 0` and no snapshot for cover periods. If budget or snapshot creation fails,
delete only the newly created budget/allocation/project rows.

`ensureAdditionalWorksPeriod` must also create `projectBudgets/{projectId}` with a zero amount and
an allocation snapshot from the child folder policy. This prevents a hidden auto-created period
from becoming an unexplained legacy period when its amount is edited later.

`handleEditProject` updates month, year and funding type as today. When an owner changes a
configured snapshot or applies a policy to a legacy period, call:

```js
const result = await window.sbClient.rpc('update_project_control_billing_allocation', {
  p_project_id: id,
  p_direct_pct: policy.directPct,
  p_indirect_pct: policy.indirectPct,
  p_target_margin_pct: policy.targetMarginPct,
  p_reason: reason
});
if (result.error) throw result.error;
```

Switching to president deletes its allocation row; switching from president creates a new
snapshot from the folder policy and requires a positive billing amount.

- [ ] **Step 6: Load snapshots in Project Control React**

Add state/refs and owner-only subscriptions beside the budget subscriptions. Do not query these
collections when `isStaff` is true. Pass maps to the billing-period and project-summary surfaces;
do not merge target-margin fields into staff-visible folder or period documents.

- [ ] **Step 7: Run tests and syntax checks**

Run: `node tests/billing-allocation.test.js && npm test`

Run: `node --check js/expenses-module.js && node --check js/portal-app.compiled.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/expenses-module.js js/portal-app.compiled.js tests/billing-allocation.test.js
git commit -m "feat: persist project billing allocations"
```

---

### Task 4: Owner Allocation Forms And Preview

**Files:**
- Modify: `admin.html:3792-4014`
- Modify: `js/expenses-module.js:762-832,1975-2134,2167-2202`
- Modify: `css/expenses-module.css`
- Modify: `css/expenses-mvp.css`
- Modify: `tests/billing-allocation.test.js`

**Interfaces:**
- Consumes: `pcValidateAllocationPolicy`, `pcAllocationAmounts`, `pcFolderPolicy`, `pcPeriodPolicy`
- Produces: `pcReadPolicyInputs(prefix) -> policy`
- Produces: `pcRenderPolicyTotal(prefix)` and `pcRenderBillingPreview(mode)`
- Produces: owner-only folder defaults and billing-period snapshot editors

- [ ] **Step 1: Load required UI guidance and write failing markup tests**

Read `modern-web-guidance:modern-web-guidance` before editing HTML/CSS. Add source tests for the
three percentage inputs in create/edit folder forms, the billing preview, edit-period inputs,
reason field, owner-only wrappers, accessible labels and live total status.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node tests/billing-allocation.test.js`

Expected: FAIL on missing form controls.

- [ ] **Step 3: Add reusable allocation form markup**

Add compact numeric inputs labelled Direct Cost %, Indirect Cost %, and Target Margin % with
`min="0"`, `max="100"`, `step="0.01"`. Include a stable live-total row:

```html
<div class="pc-allocation-total" id="createFolderAllocationTotal" role="status" aria-live="polite">
  Total: 100.00%
</div>
```

Add a billing preview with three swatches and peso values. Use the term Target Margin Reserve,
never Profit. Cover funding hides the preview and snapshot controls.

- [ ] **Step 4: Wire validation and previews**

Use the shared engine for every calculation. Disable Save while totals are invalid. Folder forms
start at 70/20/10; edit forms use saved values. The billing create form uses folder defaults. The
billing edit form uses the period snapshot and reveals a required Reason for adjustment only
when percentages change. A legacy period starts with the folder policy and labels the action
Apply Allocation Policy; saving it uses the audited RPC with null before values.

- [ ] **Step 5: Style responsive controls**

Use three fixed minmax tracks on desktop and one column on narrow screens. Keep cards at 8px or
less radius, preserve existing colors plus distinct Direct/Indirect/Reserve swatches, and ensure
labels and longest values fit without viewport-scaled font sizes.

- [ ] **Step 6: Run tests and syntax checks**

Run: `node tests/billing-allocation.test.js && node --check js/expenses-module.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add admin.html js/expenses-module.js css/expenses-module.css css/expenses-mvp.css tests/billing-allocation.test.js
git commit -m "feat: add billing allocation controls"
```

---

### Task 5: Billing-Period Attribution For Project Overhead

**Files:**
- Modify: `admin.html:5015-5085`
- Modify: `js/overhead-module.js:13-23,127-168,493-697,815-912`
- Modify: `js/portal-app.compiled.js:1417-1680,3348`
- Modify: `tests/money-math.test.js`
- Modify: `tests/billing-allocation.test.js`

**Interfaces:**
- Consumes: `overheadExpenses.billingPeriodId`
- Produces: `_ovhdPopulateBillingPeriodSelect(folderId, selectedId)`
- Produces: period labels in overhead table, CSV and print
- Produces: assigned overhead passed to `pcActualsForPeriod`

- [ ] **Step 1: Write failing attribution tests**

Extend money tests to prove assigned and unassigned overhead both remain in project Spent exactly
once. Extend allocation tests to prove only matching `billingPeriodId` consumes a period's
Indirect envelope. Add source guards for both overhead save paths and CSV/print period columns.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node tests/money-math.test.js && node tests/billing-allocation.test.js`

Expected: FAIL on missing period attribution.

- [ ] **Step 3: Add the admin Overhead period selector**

When scope is Project and a folder is selected, populate a Billing Period select from
`expProjects.filter(p => p.folderId === folderId)`. Keep an Unallocated option. Company scope
clears and hides the selector. Create and edit payloads save `billingPeriodId` or `null`, and edit
history includes the field when it changes.

- [ ] **Step 4: Add attribution to the Project Control overhead drill**

Pass `childMonths` into `OverheadDrill`. Add the same selector to the React add/edit form and save
`billingPeriodId`. Display the assigned period or Unallocated in its records table. Payroll-based
indirect rows use their existing `projectId` and do not need a new database field.

- [ ] **Step 5: Update overhead export and print**

Add Billing Period after Project in CSV and print columns. Resolve payroll rows from their
`projectId`; resolve operating costs from `billingPeriodId`; render Unallocated when absent.

- [ ] **Step 6: Run tests and syntax checks**

Run: `npm test`

Run: `node --check js/overhead-module.js && node --check js/portal-app.compiled.js`

Expected: PASS, including the original one-peso-one-bucket tests.

- [ ] **Step 7: Commit**

```bash
git add admin.html js/overhead-module.js js/portal-app.compiled.js tests/money-math.test.js tests/billing-allocation.test.js
git commit -m "feat: attribute project overhead to billing periods"
```

---

### Task 6: Project Control Allocation Dashboard

**Files:**
- Modify: `js/portal-app.compiled.js:402-454,874-925,1019-1299,2870-3348`
- Modify: `js/print-utils.js:121-230`
- Modify: `css/dacs-portal.css`
- Modify: `tests/money-math.test.js`
- Modify: `tests/billing-allocation.test.js`

**Interfaces:**
- Consumes: allocation map, `pcActualsForPeriod`, `pcPeriodAllocationView`, `pcProjectAllocationRollup`
- Produces: period allocation bands, project rollup and print-summary allocation payload
- Preserves: `_projSpent`, `_projMargin`, `_recognisedProfit`

- [ ] **Step 1: Write failing dashboard and invariant tests**

Add source/engine tests for legacy badges, Direct/Indirect budget-actual-remaining values,
Target Margin Reserve wording, 80/90/over states, Reserve at Risk, unallocated indirect totals,
project rollup and staff suppression. Add explicit money tests proving the new engine is never
referenced inside `_projSpent`, `_projEarned`, `_projMargin` or `_recognisedProfit`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node tests/billing-allocation.test.js && node tests/money-math.test.js`

Expected: FAIL on missing UI contracts.

- [ ] **Step 3: Build period cards from the shared engine**

Update `BillingPeriodsDrill` to receive `overheadRaw` and `allocationMap`. Use existing
`_isOverheadPay` as the payroll classifier passed to `pcActualsForPeriod`. Configured owner cards
show three allocation rows plus actuals, remaining and status. Legacy periods show Allocation not
configured with an Apply Policy action. Cover periods show Cover Expenses and no fictional
allocation. Add a history action that filters `allocationAdjustments` by period ID and displays
before values, after values, reason, actor and timestamp in a compact modal.

- [ ] **Step 4: Add project rollup without changing profit math**

Roll configured periods into Direct Budget, Indirect Budget and Target Margin Reserve. Sum
project overhead with no `billingPeriodId` as Unallocated Indirect Cost. Show Actual Earned Profit
and target variance only when accomplishment data exists; otherwise label the actual-profit side
Forecast under existing behavior.

- [ ] **Step 5: Update Project Control print summary**

Add the precomputed rollup to `printProjectControlSummary()`'s data contract. `print-utils.js`
must only lay out those values and must not recalculate costs. Include Allocation not configured
and Unallocated Indirect Cost notes where applicable.

- [ ] **Step 6: Style and verify responsive behavior**

Add stable grid dimensions and restrained status colors. No nested cards, oversized headings or
text overlap. Preserve current Project Control visual language.

- [ ] **Step 7: Run tests and syntax checks**

Run: `npm test`

Run: `node --check js/portal-app.compiled.js && node --check js/print-utils.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/portal-app.compiled.js js/print-utils.js css/dacs-portal.css tests/money-math.test.js tests/billing-allocation.test.js
git commit -m "feat: show billing allocations in project control"
```

---

### Task 7: Budget Overview Reports, Print And CSV

**Files:**
- Modify: `js/expenses-module.js:4475-5167,5323-6286,6420-7205`
- Modify: `admin.html:672-676,3936-3982`
- Modify: `css/expenses-mvp.css`
- Modify: `tests/billing-allocation.test.js`
- Modify: `tests/money-math.test.js`

**Interfaces:**
- Consumes: the same map and shared engine used by Project Control
- Produces: allocation-aware overview cards, period detail, report dashboard, printed summaries and CSV

- [ ] **Step 1: Add failing fan-out tests**

Guard every required call site by name: `mvpRenderOvBillingPeriods`, `mvpOvOpenPeriodDetail`,
`renderReportsDashboard`, `exportRptTable`, `printFullBillingSummary`,
`printBillingSummaryReceipt`, and `printReportsDashboard`. Assert each consumes the shared helper,
uses Target Margin Reserve wording, and preserves staff amount hiding.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node tests/billing-allocation.test.js`

Expected: FAIL with missing report integration.

- [ ] **Step 3: Update on-screen overview and period detail**

Replace duplicated period allocation arithmetic with `pcPeriodAllocationView`. Add Direct,
Indirect and Target Margin rows to configured owner views. Preserve the current Materials, Labor,
Spent and Remaining figures; these are actual costs and must not be replaced by planned values.

- [ ] **Step 4: Update dashboard report tables**

Add planned Direct, actual Direct, planned Indirect, actual Indirect, Target Margin Reserve and
variance. Include an Unallocated Indirect summary. Do not add the reserve to Spent or subtract it
twice from Remaining.

- [ ] **Step 5: Update CSV and print fan-out**

Add matching columns and totals to all three print functions and the CSV export. Use the same
rollup object as the screen so totals cannot diverge. Legacy periods emit blank allocation cells
plus Allocation not configured; cover periods emit Cover Expenses.

- [ ] **Step 6: Run full tests and syntax check**

Run: `npm test`

Run: `node --check js/expenses-module.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add js/expenses-module.js admin.html css/expenses-mvp.css tests/billing-allocation.test.js tests/money-math.test.js
git commit -m "feat: report billing allocation performance"
```

---

### Task 8: Documentation And End-To-End Verification

**Files:**
- Modify: `docs/DATABASE_SCHEMA.md:60-190`
- Modify: `docs/ARCHITECTURE.md:140-190,230-280`
- Modify: `docs/OVERHEAD_MODULE.md:21-75,149-166`
- Modify: `docs/EXPENSES_README.md:80-110,420-450`
- Modify: `supabase/migrations/README.md`

**Interfaces:**
- Consumes: completed behavior from Tasks 1-7
- Produces: canonical schema, money-model and migration documentation

- [ ] **Step 1: Update canonical documentation**

Document migration 0073, all three owner-only tables, the adjustment RPC,
`overhead_expenses.billing_period_id`, allocation formulas, legacy behavior, owner/staff/client
visibility, cover handling, and the separation between Target Margin Reserve and actual Profit.

- [ ] **Step 2: Run placeholder and consistency scans**

Run:

```powershell
rg -n "T[B]D|T[O]DO|F[I]XME|target profit|Target Profit" docs js tests supabase/migrations/0073_project_control_billing_allocations.sql
rg -n "Target Margin Reserve|projectControlBillingAllocations|billingPeriodId" js docs tests
```

Expected: no unfinished placeholders; UI terminology consistently says Target Margin Reserve.

- [ ] **Step 3: Run full automated verification**

Run: `npm test`

Run:

```powershell
Get-ChildItem js,tests -Filter *.js -Recurse | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Syntax failed: $($_.FullName)" } }
```

Expected: every test and syntax check passes.

- [ ] **Step 4: Verify migration safety**

Review `0073` against `0002_rls.sql` helpers and confirm:

- clients cannot select any of the three new tables;
- staff cannot select target-margin policies or snapshots;
- owners can read/write policy and snapshot rows only for themselves;
- adjustment rows cannot be updated or deleted through RLS;
- the RPC rejects staff, blank reasons and totals other than 100;
- existing overhead remains valid with null `billing_period_id`.

- [ ] **Step 5: Browser verification as owner**

Open `admin.html` and verify:

1. Create a folder with 70/20/10 defaults.
2. Create a ₱100,000 progress billing and see ₱70,000 / ₱20,000 / ₱10,000.
3. Add direct material, direct payroll, indirect payroll, assigned overhead and unassigned overhead.
4. Confirm each amount lands in one bucket and Unallocated Indirect remains in project Spent.
5. Trigger 80%, 90% and over-budget states with controlled test data.
6. Adjust percentages with a reason and verify the immutable history.
7. Verify screen, print and CSV totals match.
8. Verify a legacy period shows Allocation not configured.
9. Verify a Cover period has no allocation but its costs remain in Spent.

- [ ] **Step 6: Browser verification as staff**

Log in as staff and verify no allocation percentages, target-margin values or peso amounts appear
in Project Control, Budget Overview, reports, print or CSV. Confirm direct/indirect operational
records still behave as before where staff access is allowed.

- [ ] **Step 7: Final verification review**

Use `superpowers:verification-before-completion`. Inspect `git diff --check`, `git status --short`,
the final test output and browser evidence before claiming completion.

- [ ] **Step 8: Commit documentation**

```bash
git add docs/DATABASE_SCHEMA.md docs/ARCHITECTURE.md docs/OVERHEAD_MODULE.md docs/EXPENSES_README.md supabase/migrations/README.md
git commit -m "docs: document project billing allocations"
```
