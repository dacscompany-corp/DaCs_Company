# Overhead — how it works

Overhead is tracked in **two scopes**, and Project Overhead is **one bucket fed by two
different sources**. That second point is the thing to understand before changing anything.

---

## The two scopes

| Scope | What it is | Examples |
|---|---|---|
| **Company** | The cost of running the business | Office rent, electricity, internet, software, insurance |
| **Project** | The cost of running one job | Site fuel, temporary utilities, permits, equipment rental **+ the support people** |

A project expense carries a `folderId` (a **`folders`** row — a Project Control folder).
A company expense has none. Rows saved before the `scope` column existed are inferred:
`folderId` set means project, otherwise company.

---

## Project Overhead = operating costs + indirect labor

This is the part that trips people up. A project's overhead comes from **two collections**:

1. **`overheadExpenses`** — the site operating costs. Entered on the admin **Overhead**
   page or in the **Project Control → Overhead** drill.
2. **`payroll` rows tagged `laborType: 'indirect'`** — the support people: coordinator,
   site supervision, procurement staff, procurement fees. Entered in
   **Expenses → Payroll** using the **Overhead / Indirect Labor** category.

Both surfaces merge the two so they always agree:

- `js/overhead-module.js` → `_ovhdRows()` = overheadExpenses + payroll-derived rows
- `js/portal-app.compiled.js` → `buildProject()` → `overhead = laborBreakdown.indirect + overheadExpenses`

Payroll-sourced rows show up **read-only** (badged `Payroll`) on both screens. They are
edited only in Expenses → Payroll. **Never add a coordinator as an overhead expense** —
payroll already counts them, and you'd double-count.

---

## Labor burden follows the worker it was paid for

A statutory contribution (SSS / PhilHealth / Pag-IBIG / withholding) is **burden**, and it
belongs with the worker class it was paid for:

- a **mason's** SSS → **Labor Cost**
- a **coordinator's** SSS → **Project Overhead**, with the coordinator

Payroll asks which one when you pick the **Liability** category, and stores it in
`payroll.liabilityFor` (`'direct'` | `'indirect'`, migration **0026**). Rows saved before that
column existed are NULL, which is read as `'direct'` — historical data keeps its current
behaviour and nothing is silently reclassified. Re-tag an old contribution through
Expenses → Payroll to move it into Overhead.

`laborBreakdown.liability` stays the **true total** of all contributions;
`laborBreakdown.liabilityIndirect` is the slice that belongs to Overhead.

## Two rules that must not be broken

**1. Indirect labor is NOT in Labor Cost.**
`labor = direct + (liability − liabilityIndirect)`.
`overhead = indirect + liabilityIndirect + expenses`.
`spent = labor + material + overhead`. Every peso lands in exactly one bucket. If you ever put
indirect back into `labor` without removing it from `overhead`, every project double-counts
its coordinators.

**2. Overhead pay NEVER draws down a pakyaw contract.**
An overhead payment is a company cost, not progress against a worker's agreed job amount.
Enforced in three places, on purpose:
- `lcPaid()` in `js/expenses-module.js` skips `laborType === 'indirect'` rows (the real
  guard — it protects even old rows that still carry a `contractId`)
- both payroll save paths force `contractId = null` when the category is indirect
- the payroll form hides the contract picker when Overhead / Indirect Labor is selected

Re-tagging an existing row as Overhead unlinks it and **credits the amount back** to the
worker's contract. That's the repair path for anything mis-recorded.

---

## OCM allowance — priced overhead vs actual

A contract prices overhead in (OCM, typically 8–12% of a PH BOQ). `folders.ocm_pct`
(migration 0030) stores that percentage per project; the Overhead drill shows
**priced allowance vs actual overhead spend**, with an over-allowance warning. Set/edit it
via the panel's button (owner only; staff never see the panel).

Two rules baked into `_ocmStatus()`:

- The spent side is **all-time**, never period-filtered — the allowance covers the whole job.
- No configured percentage (or no contract) → `null`, and the panel shows a "set allowance"
  prompt. It never invents a comparison from missing data.

## Billing allocations — a plan for the period fund (migration 0073)

OCM asks "what did the **contract** price for overhead?" Billing allocations ask the narrower
question: **"of the money the client released for THIS period, how much was meant for what?"**

Every client-funded billing period carries three percentages that total exactly 100:

```
base                  = the period's Fund Allocated  (projectBudgets.monthlyBudget)
direct budget         = base × directPct        default 70
indirect budget       = base × indirectPct      default 20
target margin reserve = base × targetMarginPct  default 10
```

`js/billing-allocation.js` is the only place these are computed. Every surface — the Project
Control dashboard, the owner forms, the Billing Allocation Performance report, the print sheet and
the CSV — calls the same functions, so they cannot drift apart. **Owner-only everywhere**:
staff see no percentage, no envelope and no peso.

### It is planning, not money

Nothing here is revenue, a cost, a payment or profit. `Spent`, `Earned` and `Profit` are computed
exactly as they were before `0073` and never read an allocation. §R of `tests/money-math.test.js`
enforces that by reading the source of `_projSpent`, `_projEarned`, `_projMargin` and
`_recognisedProfit` and failing if any allocation symbol appears in them.

**Target Margin Reserve is not Profit.** It is the 10% the plan set aside; actual profit is still
`earned − spent` under the rules above. The UI must always spell out *Target Margin Reserve*. The
dashboard reports the variance between plan and actual **only when profit is earned** — on a
Forecast project `targetMarginVariance` is `null`, because a plan measured against a placeholder
is not a finding.

### Actuals, and where each peso is counted

`pcActualsForPeriod()` splits a period's costs the same way the money model already does:

- **direct actual** — materials + direct payroll (+ statutory burden tagged `direct`)
- **indirect actual** — indirect payroll (+ burden tagged `indirect`) + project overhead rows
  **attributed to that period** via `overheadExpenses.billingPeriodId`

Utilisation bands, from `pcAllocationStatus()`: **< 80 % healthy · ≥ 80 % advisory · ≥ 90 %
high · > 100 % over**. An envelope of zero with spend against it is `unbudgeted`, which is a
state, not a percentage — no division happens.

### The three things not to "fix"

**1. The snapshot is immutable except through the RPC.** A period's percentages are copied from
the folder policy at creation with a **true INSERT** — never the shim's `.set()`, which is an
upsert and would silently rewrite history. Editing the folder default afterwards changes future
periods only. Changing an existing period goes through
`update_project_control_billing_allocation()`, which demands a reason and writes an append-only
`billingAllocationAdjustments` row in the same transaction. Those rows have no UPDATE or DELETE
policy at all.

**2. A cover period has no allocation, and its costs are still costs.** A `president`-funded period
gets no snapshot, and the helpers and UI force zero allocation for it. That does **not** carve its
spending out of anything — cover money is Spent, and the Cover figure stays a subset. Converting a
configured period to cover leaves its snapshot dormant rather than deleting it.

**3. A missing snapshot is reported, never guessed.** Periods created before `0073` read
**"Allocation not configured"** and are counted (`legacyCount`) on every surface. Do not
back-fill them with 70/20/10 — the policy did not exist when they were funded, and applying it now
is an owner decision that goes through the RPC with a reason, like any other change.

---

## Profit is measured on EARNED revenue, not the full contract

Project overhead only means something if the profit it feeds is real. Contract revenue is
**earned as work is accomplished**, so:

```
% complete    = boqAccTotal(costItems) / boqGrandTotal(costItems)   (accomplishment report)
earned        = % complete × contract amount
gross profit  = earned − (labor + material + overhead)
```

Measuring the **full contract** against **costs-to-date** (what the app did before) reports a
~90% margin on a job that is 10% built, and hides overruns: a project half-built having
already burned 56% of its contract showed **+44%** margin when the truth was **−12%**.

`_projMargin()` in `js/portal-app.compiled.js` is the single place this is computed. It sets
`isForecast: true` when there is no usable accomplishment data — **no BOQ, or a BOQ whose
`percentCompletion` values are all zero.** In that case it falls back to the full contract,
and the UI must label the number *Forecast*, never *Earned*. That guard exists for a reason:
without it, a project whose accomplishment report simply hasn't been filled in yet would
compute 0% earned against real spend and scream "losing money" on every young job.

## Company profit (the top of the P&L)

Project overhead is a job cost. **Company overhead is not** — it never touches a job. It gets
subtracted once, at company level, on the Project Control overview (owner only, hidden from
`_staff()`):

```
gross profit = Σ recognised profit across all projects
net profit   = gross profit − company overhead (G&A)
```

`_recognisedProfit()` decides what each project contributes:

- **Has accomplishment data** → books its **earned margin** (percentage-of-completion).
- **No accomplishment data** → books **zero profit**. Revenue is recognised equal to cost
  incurred. This is the standard **zero-profit method** for contracts whose outcome cannot be
  estimated reliably.
- **Any project whose costs already exceed its contract** → the **loss is recognised
  immediately**, accomplishment data or not. That money is gone regardless of % complete.

Do **not** "improve" this by letting unmeasured projects book `contract − cost`. That is the
same flattery removed from project margins: a job 10% built would pour ~90% of its contract
into company profit as pure fiction. A project that shows no profit here is telling you its
accomplishment report needs updating — that's a feature.

## Soft delete

Deletes stamp `deletedAt` and keep an append-only `history` array. **Every read must filter
`!deletedAt`** — the admin page, `buildProject`, and the portal's `overheadRows` memo all do.
A read that forgets this will resurrect deleted expenses into project totals.

---

## Billing periods and overhead — what changed in 0073

**Before `0073`:** the Billing Periods card and drill showed *all payroll + materials* and **no**
overhead expenses, because electricity and rent are recorded at folder level with no period
attached. The card answered "how much of the allocated period fund did we spend"; the KPI strip
answered "what did this project actually cost". They did not match, and the gap was exactly the
operating costs.

**Since `0073`** an overhead row can be **attributed** to one billing period through
`overheadExpenses.billingPeriodId`, set on the Overhead page and in the Project Control → Overhead
drill. An attributed row counts against that period's Indirect envelope and appears in that
period's Spent. The gap therefore narrows to whatever is left **unattributed** — surfaced by name
as **Unallocated Indirect Cost** rather than quietly missing.

Three rules make the arithmetic safe:

- **Attribution moves where a peso is shown, never whether it counts.** Attributed or not, a
  project-overhead row is in that project's Spent exactly once. Attributing is a reporting
  decision, not an accounting entry.
- **Null is the normal state.** Rent and electricity have no period and should not be given one.
  The form nevertheless **opens on the current client-funded period** — the highest
  `billingNumber` with a Fund Allocated, mirroring how direct cost auto-picks a period in
  `expenses-module.js` (`handleAddExpense`) so nobody has to answer the question twice.
  A cover/president period holds no allocation and is never the default, editing never
  re-defaults a row (a deliberate Unallocated survives a reopen), and Unallocated stays one
  click away. Both forms read the same rule — `_ovhdDefaultPeriodId()`, once in
  `portal-app.compiled.js` and once in `overhead-module.js` — so the Overhead page and the
  drill cannot drift apart.
- **A stale or cross-folder link is treated as unallocated.** A `billingPeriodId` pointing at
  another folder's period stays on its own job and consumes **no** envelope — it must never eat
  into another project's Indirect budget.

`company`-scope rows are excluded from all of this. Company overhead (G&A) is never charged to a
job, so it can never be attributed to one of a job's billing periods.

---

## Schema

Table `overhead_expenses`. `0001_init` created only
`id, legacy_id, owner_id, category, amount, date, description, created_at`;
`0006` added `folder_id`; **`0025_overhead_columns.sql`** captures the columns the app has
actually been writing (`scope`, `expense_name`, `supplier`, `invoice_number`, `receipt_url`,
`status`, `notes`, `history`, `deleted_at`, `updated_at`, `created_by`), which existed only
in the live database until then.

**`0073_project_control_billing_allocations.sql`** added `billing_period_id` (nullable FK to
`projects(id)`, `on delete set null`) plus its index, and created the three owner-only allocation
tables and the adjustment RPC. Existing overhead rows keep `billing_period_id = null` and behave
exactly as they did before.

The Firestore-compat shim (`js/supabase-config.js`, `REG.overheadExpenses`) maps camelCase
fields straight to snake_case columns — there is **no** jsonb blob mode on this table, so any
new field written by the app needs a real column or the save fails. The allocation tables are
registered the same way (`projectControlAllocationPolicies`, `projectControlBillingAllocations`,
`billingAllocationAdjustments`); full field map in
[DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).
