# Project Cost Plan — Design

**Date:** 2026-09-25
**Status:** Approved design, not yet implemented
**Migration:** `0075_project_cost_plans.sql` (highest on disk is `0074`)
**Source request:** `Costing_and_Cash_Flow_MVP_Terms.md`

---

## 1. What this is

A **planned cost budget for a project folder you have already won**, and the variance between that
plan and what has actually been spent.

The contract value is already known — it sits in `folder_budgets.total_budget` and the money model
already reads it as `revenue`. So the plan does **not** compute a price. It answers the opposite
question:

> Given the contract I already signed, what do I intend to spend on Labor, Material and Overhead —
> and what margin does that leave me?

```
Contract (known)  −  Planned Labor + Material + Overhead  =  Planned margin
```

It renders inside **Project Control**, in the existing `CostBudget` panel, which already shows the
three actual buckets. This design gives that panel a plan to compare against.

### What it is not

- **Not a quotation.** It never prices work for a prospect. `js/quotation-module.js` already does
  that and stays untouched.
- **Not a payment tracker.** No collections, no due dates, no client cash. See §9.
- **Not revenue, cost, payment or profit.** See §2.
- **No client-facing surface.** Only `admin.html` loads `js/portal-app.compiled.js`, so the panel
  cannot reach `Client Management.html` or `Dacs Partnership.html`. No portal mirroring applies.

---

## 2. The isolation contract

> A cost plan is **planning, outside the money model** — the same standing as billing allocations
> (0073), quotations (0045), reimbursements (0041) and warranty retention (0043).
>
> `_projSpent`, `_projEarned`, `_projMargin` and `_recognisedProfit` **never read it**. Nothing here
> is revenue, a cost, a payment or profit. Planned margin is never added to anything, never
> subtracted from anything, and is **never labelled "Profit"**.

Enforced by **§V of `tests/money-math.test.js`**, built exactly like the allocation fence that
already guards those same four functions (the unlabelled `test()` at `tests/money-math.test.js:82`):
it reads the source of each and fails if any cost-plan symbol appears in it.

*(Lettered sections in that file currently run J–U, so **V** is the next free letter. `CLAUDE.md`
calls the allocation fence "§R"; §R is actually the SOA contract band, and the allocation fence is
the unlabelled test at line 82.)*

`Spent` stays `Labor + Material + Overhead`. The plan adds no fourth bucket.

---

## 3. The bucket decision

The MVP terms document proposes Direct / Indirect / Overhead. **Those names are not used.** The plan
adopts the money model's existing three buckets, because a plan must compare against actuals in the
same shape or the variance means nothing — and the actuals arrive from `buildProject` already split
as `c.labor`, `c.material`, `c.overhead`.

| Terms doc bucket | Where it lands here | Why |
|---|---|---|
| Direct (materials + labor) | **splits into Labor + Material** | the system already tracks these separately — finer, not coarser |
| Indirect (equipment, depreciation, delivery) | **Overhead** | `Equipment Rental`, `Fuel`, `Transportation` are already overhead categories (`js/overhead-module.js:208`) |
| Overhead (office, utilities, admin) | **excluded from project cost** | company G&A is never charged to a job |

### G&A is recovered through margin, not charged to the job

The terms document puts office expenses, utilities and administrative costs into the project cost
stack. The money model forbids that — `_companyOverhead()` (`js/portal-app.compiled.js:357`) exists
solely to keep `scope: 'company'` rows out of any project.

**Resolution: G&A comes out of the margin, not out of a project cost line.** The company is still
paid for its office; that money is part of the margin the contract leaves, not a cost booked to the
job. Same pesos, invariant intact, and the terms document's vocabulary never enters the codebase.

---

## 4. This absorbs OCM

`folders.ocm_pct` (migration 0030) already plans exactly one bucket of this sheet:
`contract × pct = planned overhead`, compared against **all-time** actual overhead, with an overrun
flag, surfaced in the Overhead drill at `js/portal-app.compiled.js:2006`.

That is the overhead row of a project cost plan, already built and live. Running a second planned
overhead number beside it would be the same class of drift that made Reports and Project Control
disagree in August 2026.

**Therefore the plan owns all three buckets and OCM reads from it.**

- `overhead_amount` is backfilled on migration from `folders.ocm_pct × folder_budgets.total_budget`
- the Overhead drill's "Site overhead allowance" panel keeps its place and its look, but reads
  `plan.overhead_amount` instead of computing from `ocm_pct`
- `folders.ocm_pct` is **kept, not dropped** — old rows may hold it — but nothing writes it again
- the `prompt()` dialog at `:2006` is replaced by the plan editor modal (§7)

### Relationship to billing allocations (0073)

Both are planning envelopes; they operate at **different scopes and will rarely agree**. That is
correct, not a bug.

| | base | buckets | actuals | scope |
|---|---|---|---|---|
| Billing allocation (0073) | one period's Fund Allocated | Direct / Indirect / Target Margin | per period | tactical |
| **Project cost plan** | the whole contract | Labor / Material / Overhead + margin | all-time | strategic |

`js/cost-plan.js` defines its **own** copy of the utilisation thresholds rather than importing from
`js/billing-allocation.js`. That module is fenced by `CLAUDE.md` as the only place allocation math
happens; duplicating four numbers is cheaper than blurring that boundary.

---

## 5. Data model

### `project_cost_plans` — migration 0075, owner-only

One row per folder. Mirrors `project_control_allocation_policies`, which is also one row per folder.

```sql
create table project_cost_plans (
  folder_id        uuid primary key references folders(id) on delete cascade,
  owner_id         uuid not null,
  labor_amount     numeric not null default 0 check (labor_amount    >= 0),
  material_amount  numeric not null default 0 check (material_amount >= 0),
  overhead_amount  numeric not null default 0 check (overhead_amount >= 0),
  history          jsonb   not null default '[]',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
```

| Field | Notes |
|---|---|
| `folder_id` | primary key — `folders.id`, **never** `construction_projects.id` |
| `owner_id` | `userId` through the shim |
| `labor_amount`, `material_amount`, `overhead_amount` | **pesos, not percentages** — see below |
| `history` | append-only `[{ at, by, labor, material, overhead, note }]`, the `quotations.history` / `reimbursements.history` convention. **`note` is optional** — unlike an allocation adjustment, which demands a reason because it rewrites a frozen snapshot, this is a living plan that is expected to change as a job develops |

### Why pesos and not percentages

Billing allocations use percentages because the three must total exactly 100, which needs a
constraint and a validator. Here **margin is simply whatever is left over**, so there is no totals
constraint to violate:

```
planned cost = labor + material + overhead          stored
margin       = contract − planned cost              derived, never stored
markup %     = margin / planned cost                derived
margin %     = margin / contract                    derived
```

A builder plans in pesos ("₱396,000 of labor"), not in shares of a contract. Fewer ways to be wrong,
and one less validation rule to get subtly different from the allocation one.

### Both percentages are always displayed

`markup 20.0% · margin 16.67%` — the two are different by nature and showing only one guarantees the
other eventually gets filed as a bug. This is §12 of the terms document made permanent.

### RLS

Gates on `profiles.role = 'owner'` via the existing `is_owner()` from 0002, with **no
`profiles.kind` clause**. That extra clause is what shipped broken in 0073 and needed 0074 to fix —
a real owner whose `kind` was not `admin` was refused. Not repeating it.

---

## 6. Compute — `js/cost-plan.js`

Pure functions only. No DB, no DOM — so the test file can require it directly, the same shape as
`js/billing-allocation.js`.

| Function | Returns |
|---|---|
| `cpPlannedCost(plan)` | `labor + material + overhead` |
| `cpPlanMargin(contract, plan)` | `{ margin, markupPct, marginPct, overContract }`, or `null` when contract is 0 |
| `cpBucketStatus(actual, planned)` | `{ pct, key, remaining, over }` |
| `cpPlanView(project, plan)` | the full render object |

**This is the only place plan math is computed** — panel, drill, editor and any future report all
call it, so the surfaces cannot drift.

### Utilisation bands

Mirror the allocation bands so there is nothing new to learn:

| Band | Condition |
|---|---|
| `healthy` | < 80 % |
| `advisory` | ≥ 80 % |
| `high` | ≥ 90 % |
| `over` | > 100 % |
| `unbudgeted` | planned is 0 **and** actual > 0 |
| `empty` | planned is 0 and actual is 0 |

`cpPlanMargin` returns `null` when the folder has no contract value, exactly as `_ocmStatus` returns
`null` with no allowance configured. **It never invents a comparison from missing data.**

### When is a plan "configured"?

**The row existing is what counts**, not the amounts in it. A saved plan with
`material_amount = 0` and real material spend is a deliberate statement — it reads `unbudgeted`,
not "no plan". Only the **absence of the row** makes the panel fall back to today's rendering.

---

## 7. UI

### The panel

`CostBudget` (`js/portal-app.compiled.js:1239`) already renders Labor / Material / Overhead with
amounts and share-of-contract bars. It gains a plan line per row, and the bar changes meaning —
**from share-of-contract to share-of-plan**.

**With no plan row, the panel renders exactly as it does today.** Progressive enhancement, zero
regression for folders nobody has planned. Same convention as OCM's "set allowance" prompt and
allocations' "Allocation not configured".

```
┌─ COST BUDGET ────────────────────────── [ Edit plan ] ─┐
│  Labor Cost                                 ₱210,000    │
│     Plan ₱396,000 · 53% used · ₱186,000 left            │
│     ████████████░░░░░░░░░░░░░░                          │
│  Material Cost                              ₱ 98,000    │
│     Plan ₱180,000 · 54% used · ₱ 82,000 left            │
│  Overhead Cost                              ₱ 91,000    │
│     Plan ₱ 79,200 · 115% used · ₱11,800 over        ⚠   │
├─────────────────────────────────────────────────────────┤
│  Planned cost  ₱655,200    Contract  ₱720,000           │
│  Planned margin  ₱64,800   ·  markup 9.9% · margin 9.0% │
└─────────────────────────────────────────────────────────┘
```

Labels stay terse — values and short fragments, no explanatory sentences.

### The two margin numbers

The dashboard will carry two labels containing "margin". Both are legitimate; they differ in scope,
and **the scope goes in the label, not in an explainer paragraph**:

- **`Planned margin (project)`** — contract − planned cost, this feature
- **`Target Margin Reserve`** — a period's Fund Allocated × 10 %, existing, keeps its period context

Neither is ever called "Profit". Actual profit stays `earned − spent`, computed where it always was.

### The editor

A modal on `[ Edit plan ]`: three peso inputs, margin computed live as you type, both percentages
beneath it. It replaces the `prompt()` dialog currently wired to OCM.

### Additional Works

AW child folders are folders, so they carry their own plan against their own contract. No
special-casing.

---

## 8. Data flow, failures, tests

### Load

Mirrors the allocation policy rail exactly:

```
costPlanRef                    new, beside allocationPolicyRef (:3446)
  ↓ owner-only snapshot on projectCostPlans where userId == dataUid  (:3571 pattern)
folder.costPlan                merged at :3530, next to allocationPolicy
  ↓ passed down at :3940 beside allocationMap
CostBudget / OverheadDrill
```

Non-owner teardown strips it the way `:3565` already strips `allocationPolicy`, so an admin or staff
session never holds the numbers in memory.

`CostBudget` currently receives no `folderId` or `activeFolder` — the plan must be threaded down
from the dashboard render.

### Save

```js
db.collection("projectCostPlans").doc(folderId).set({ … })
```

`.set()` (upsert) is **correct here**, unlike allocation snapshots which needed a true INSERT because
they *are* history. This is one mutable plan per folder; its history lives in the `history` jsonb
array, appended on each save.

### Failure modes

| Case | Behaviour |
|---|---|
| Migration not applied | save catch reports `(is migration 0075 applied?)`, copying the OCM handler's wording |
| No contract on folder | plan saves; margin reads `Contract not set` |
| Planned cost > contract | negative margin, warning tone, **save allowed** — a loss-leader is a real plan |
| No plan row | panel renders exactly as today |
| Staff session | plan lines absent entirely, not blanked to `—` |
| Non-owner admin | snapshot never subscribes; ref stays empty |

### Tests

| Test | Guards |
|---|---|
| `tests/cost-plan.test.js` **(new)** | the four pure functions: bands at 79 / 80 / 90 / 100, zero contract, negative margin, markup ≠ margin |
| **§V** in `tests/money-math.test.js` | source-reads the four money functions, fails if `costPlan`, `cpPlannedCost`, `cpPlanMargin`, `cpBucketStatus`, `cpPlanView`, `plannedMargin` or `markupPct` appears in any of them |
| §V, second assertion | planned margin is never summed into `Spent` — the buckets stay three |
| §V, third assertion | the save payload writes only columns migration 0075 creates — the `§U` pattern, applied to the new table |
| `node --check` | every changed JS file |
| `npm test` | all 9 suites, 231 checks, stay green |

---

## 9. Explicitly not in v1

Collection schedule · collection due dates · payment tracking · depreciation as its own line ·
contingency as its own line · any client-facing surface · any change to `_projSpent`, `_projEarned`,
`_projMargin` or `_recognisedProfit`.

### On the cash-flow half of the terms document

Project Control has **no payment ledger** — `payment_requests.construction_project_id` belongs to the
PM system, a different id space. The only record of client money arriving on a folder is each billing
period's Fund Allocated, summed as `allocated` at `js/portal-app.compiled.js:422`.

So a future collection schedule would need **no new payment ledger** — "total collected" already
exists as `allocated`, and cover/president periods are already excluded from it, which is correct
since that is company money. That is v2.

---

## 10. Files

| File | Change |
|---|---|
| `supabase/migrations/0075_project_cost_plans.sql` | table, RLS, `ocm_pct` backfill |
| `js/cost-plan.js` **(new)** | the only place plan math is computed |
| `js/portal-app.compiled.js` | `CostBudget` plan lines + variance; `OverheadDrill` reads plan; load rail; editor modal |
| `js/supabase-config.js` | `REG` entry for `projectCostPlans` |
| `admin.html` | `<script>` tag for `cost-plan.js` |
| `tests/cost-plan.test.js` **(new)** | pure-function tests |
| `tests/money-math.test.js` | §S isolation fence |
| `docs/DATABASE_SCHEMA.md` | new table |
| `docs/OVERHEAD_MODULE.md` | reasoning; OCM absorbed |
| `CLAUDE.md` | cost-plan invariant beside the allocations one |

No `PRIMARY_NAV` / `_FOCUS_SUBVIEWS` / `*_VIEWS` entry — this lives inside Project Control, already
wired. No portal HTML change, so the mirroring rule does not apply.
