# Project Cost Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Project Control `CostBudget` panel a planned cost budget — Labor, Material and Overhead in pesos against the folder's contract — and show actual spend against each, with the leftover reported as planned margin.

**Architecture:** One new owner-only table (`project_cost_plans`, one row per folder) and one new pure-function module (`js/cost-plan.js`) that is the only place plan math happens. The panel and the Overhead drill both read it. The plan is **planning, outside the money model** — `_projSpent` / `_projEarned` / `_projMargin` / `_recognisedProfit` never read it, and a new test fence enforces that. It absorbs the existing OCM allowance (`folders.ocm_pct`), which becomes the backfill source for the overhead row.

**Tech Stack:** Plain HTML + vanilla JS, **no build step**. React via `React.createElement` inside `js/portal-app.compiled.js` (which IS the source of truth — never run `npm run build`). Supabase behind a Firestore-compat shim (`js/supabase-config.js`). Tests are plain `node` scripts using `assert`, run by `npm test`.

**Spec:** [`docs/superpowers/specs/2026-09-25-project-cost-plan-design.md`](../specs/2026-09-25-project-cost-plan-design.md)

## Global Constraints

- **Never run `npm run build`.** `js/portal-app.compiled.js` is edited directly. The script is a hard-fail stub.
- **A new data field needs a real DB column.** The shim maps camelCase → snake_case; writing a field with no column fails the **whole** statement silently.
- **`folders.id` ≠ `construction_projects.id`.** This feature uses `folders.id` only.
- **`projects` means "billing period"**, not project.
- **Staff (`currentUserRole === 'staff'`) must not see peso amounts anywhere.** This feature is **owner-only** — stricter than staff-hiding.
- **Migrations: next number = highest + 1, never reuse.** Highest on disk is `0074`, so this is `0075`.
- **Run `npm test` after any change touching money code.** 9 suites, 231 checks, ~1s, exits 1 on breakage.
- **Dates:** never `toISOString().slice(0,10)` for a local date key — PH is UTC+8.
- **Planned margin is never labelled "Profit".** Actual profit stays `earned − spent`.
- **No portal HTML changes** — only `admin.html` loads `portal-app.compiled.js`, so the "mirror into both portals" rule does not apply here.
- **Do not commit.** The repo owner commits manually. Every "Commit" step below is written as the command to *offer*, not to run unprompted.

---

### Task 1: The calc engine — `js/cost-plan.js`

Pure functions, no DB, no DOM. This is the only place plan math is computed, so the panel, the drill and the editor cannot drift apart. Mirrors the shape of `js/billing-allocation.js`.

**Files:**
- Create: `js/cost-plan.js`
- Test: `tests/cost-plan.test.js`
- Modify: `package.json` (add the suite to the `test` script)

**Interfaces:**
- Consumes: nothing — this task has no dependencies.
- Produces:
  - `cpPlannedCost(plan) → number`
  - `cpPlanMargin(contract, plan) → { plannedCost, margin, marginPct, markupPct, overContract } | null`
  - `cpBucketStatus(actual, planned) → { key, pct, remaining, over }`
  - `cpPlanView(project, plan) → { contract, buckets: [{ id, actual, planned, status }], plannedCost, margin } | null`
  - `plan` objects are `{ laborAmount, materialAmount, overheadAmount }` (camelCase — the shim converts to `labor_amount` etc.)
  - Exported on `window` **and** `module.exports`, same dual export as `billing-allocation.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/cost-plan.test.js`:

```js
'use strict';

const assert = require('assert');
const C = require('../js/cost-plan.js');

const eq = (actual, expected, message) => assert.deepStrictEqual(actual, expected, message);
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.000001, message || `${actual} !== ${expected}`);

const plan = { laborAmount: 396000, materialAmount: 180000, overheadAmount: 79200 };

// ── cpPlannedCost ────────────────────────────────────────────────
eq(C.cpPlannedCost(plan), 655200);
eq(C.cpPlannedCost(null), 0);
eq(C.cpPlannedCost({}), 0);
// negative amounts are floored at zero, never subtracted from the total
eq(C.cpPlannedCost({ laborAmount: -500, materialAmount: 100, overheadAmount: 0 }), 100);

// ── cpPlanMargin ─────────────────────────────────────────────────
const m = C.cpPlanMargin(720000, plan);
eq(m.plannedCost, 655200);
eq(m.margin, 64800);
close(m.marginPct, 9);
close(m.markupPct, 9.890109890109891);
eq(m.overContract, false);

// markup and margin are DIFFERENT numbers — the whole point of §12 of the terms doc
const m2 = C.cpPlanMargin(120000, { laborAmount: 100000, materialAmount: 0, overheadAmount: 0 });
close(m2.markupPct, 20);
close(m2.marginPct, 16.666666666666664);

// no contract → null, never an invented comparison
eq(C.cpPlanMargin(0, plan), null);
eq(C.cpPlanMargin(720000, null), null);

// planned cost over contract → negative margin, flagged, NOT an error
const over = C.cpPlanMargin(500000, plan);
eq(over.margin, -155200);
eq(over.overContract, true);

// zero planned cost → markupPct is null, not Infinity
eq(C.cpPlanMargin(720000, { laborAmount: 0, materialAmount: 0, overheadAmount: 0 }).markupPct, null);

// ── cpBucketStatus ───────────────────────────────────────────────
eq(C.cpBucketStatus(7999, 10000).key, 'healthy');
eq(C.cpBucketStatus(8000, 10000).key, 'advisory');
eq(C.cpBucketStatus(9000, 10000).key, 'high');
eq(C.cpBucketStatus(10000, 10000).key, 'high');   // exactly 100% is not yet over
eq(C.cpBucketStatus(10001, 10000).key, 'over');
eq(C.cpBucketStatus(5, 0).key, 'unbudgeted');
eq(C.cpBucketStatus(0, 0).key, 'empty');
eq(C.cpBucketStatus(2000, 10000).remaining, 8000);
eq(C.cpBucketStatus(12000, 10000).remaining, -2000);
close(C.cpBucketStatus(125, 100).pct, 125);

// ── cpPlanView ───────────────────────────────────────────────────
const project = { revenue: 720000, labor: 210000, material: 98000, overhead: 91000 };
const view = C.cpPlanView(project, plan);
eq(view.contract, 720000);
eq(view.plannedCost, 655200);
eq(view.margin.margin, 64800);
eq(view.buckets.length, 3);
eq(view.buckets.map(b => b.id), ['labor', 'material', 'overhead']);
eq(view.buckets[0].status.key, 'healthy');
eq(view.buckets[2].status.key, 'over');
eq(view.buckets[2].status.remaining, -11800);

// no plan row → null, so the panel falls back to today's rendering
eq(C.cpPlanView(project, null), null);

// a plan row with a zero bucket is a DELIBERATE statement, not "no plan"
const sparse = C.cpPlanView(project, { laborAmount: 396000, materialAmount: 0, overheadAmount: 79200 });
eq(sparse.buckets[1].status.key, 'unbudgeted');

// no contract → the view still renders, margin is null
const noContract = C.cpPlanView({ revenue: 0, labor: 1, material: 2, overhead: 3 }, plan);
eq(noContract.margin, null);
eq(noContract.contract, 0);

console.log('cost-plan: all checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/cost-plan.test.js
```

Expected: FAIL — `Cannot find module '../js/cost-plan.js'`

- [ ] **Step 3: Write the implementation**

Create `js/cost-plan.js`:

```js
// ════════════════════════════════════════════════════════════════════
// PROJECT COST PLAN — migration 0075
//
// A planned cost budget for a folder whose contract is already signed.
// The contract is the INPUT; the plan says what we intend to spend on
// Labor, Material and Overhead, and the leftover is the planned margin.
//
// PLANNING, OUTSIDE THE MONEY MODEL. Nothing here is revenue, a cost, a
// payment or profit. `_projSpent` / `_projEarned` / `_projMargin` /
// `_recognisedProfit` never read it — §V of tests/money-math.test.js
// fails the build if they ever do. Planned margin is NEVER called Profit.
//
// This is the ONLY place plan math is computed, so the panel, the drill
// and the editor cannot drift apart.
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const num = value => Number(value) || 0;
  // A negative planned amount is meaningless and must never reduce the
  // total — it would understate planned cost and overstate margin.
  const pos = value => Math.max(0, num(value));

  function cpPlannedCost(plan) {
    if (!plan) return 0;
    return pos(plan.laborAmount) + pos(plan.materialAmount) + pos(plan.overheadAmount);
  }

  // Returns null with no plan or no contract — the caller shows "Contract
  // not set" rather than an invented comparison, the same way _ocmStatus
  // returns null with no allowance configured.
  function cpPlanMargin(contract, plan) {
    const revenue = num(contract);
    if (!plan || !(revenue > 0)) return null;
    const plannedCost = cpPlannedCost(plan);
    const margin = revenue - plannedCost;
    return {
      plannedCost,
      margin,
      // Margin is share of PRICE; markup is share of COST. They are
      // different numbers (20% markup = 16.67% margin) and both are
      // shown, because showing one alone gets filed as a bug.
      marginPct: margin / revenue * 100,
      markupPct: plannedCost > 0 ? margin / plannedCost * 100 : null,
      overContract: margin < 0
    };
  }

  // Utilisation bands deliberately mirror pcAllocationStatus in
  // billing-allocation.js so the dashboard speaks one visual language.
  // Kept as a separate copy: CLAUDE.md fences that module as the only
  // place allocation math happens, and four numbers are cheaper to
  // duplicate than a blurred boundary.
  function cpBucketStatus(actual, planned) {
    const spent = pos(actual);
    const budget = pos(planned);
    if (!(budget > 0)) {
      return { key: spent > 0 ? 'unbudgeted' : 'empty', pct: spent > 0 ? null : 0, remaining: 0, over: spent > 0 };
    }
    const pct = spent / budget * 100;
    return {
      key: pct > 100 ? 'over' : pct >= 90 ? 'high' : pct >= 80 ? 'advisory' : 'healthy',
      pct,
      remaining: budget - spent,
      over: pct > 100
    };
  }

  // The plan's buckets are the MONEY MODEL's buckets — labor, material,
  // overhead — because a plan compared against actuals in a different
  // shape reports nothing. `project` is the object buildProject() returns.
  function cpPlanView(project, plan) {
    if (!plan) return null;
    const contract = num(project && project.revenue);
    const buckets = [
      { id: 'labor',    actual: num(project && project.labor),    planned: pos(plan.laborAmount) },
      { id: 'material', actual: num(project && project.material), planned: pos(plan.materialAmount) },
      { id: 'overhead', actual: num(project && project.overhead), planned: pos(plan.overheadAmount) }
    ].map(bucket => Object.assign(bucket, { status: cpBucketStatus(bucket.actual, bucket.planned) }));
    return { contract, buckets, plannedCost: cpPlannedCost(plan), margin: cpPlanMargin(contract, plan) };
  }

  const api = { cpPlannedCost, cpPlanMargin, cpBucketStatus, cpPlanView };
  Object.keys(api).forEach(key => { root[key] = api[key]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/cost-plan.test.js
```

Expected: `cost-plan: all checks passed`

- [ ] **Step 5: Add the suite to `npm test`**

In `package.json`, append to the end of the `test` script (after `node tests/billing-allocation.test.js`):

```
 && node tests/cost-plan.test.js
```

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

Expected: all 10 suites pass; the money suite still reports 231 checks.

- [ ] **Step 7: Syntax check**

```bash
node --check js/cost-plan.js
```

Expected: no output.

- [ ] **Step 8: Commit (offer — do not run unprompted)**

```bash
git add js/cost-plan.js tests/cost-plan.test.js package.json
git commit -m "feat(cost-plan): add project cost plan calc engine

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The isolation fence — §V of `tests/money-math.test.js`

Makes "outside the money model" something CI enforces rather than something we remember. Written **before** any portal code exists so it can never be retro-fitted to pass.

**Files:**
- Modify: `tests/money-math.test.js` (append a new lettered section before the `summary()` block near line 2337)

**Interfaces:**
- Consumes: `portal` — the already-extracted object at `tests/money-math.test.js:71`, which exposes `_projSpent`, `_projEarned`, `_projMargin`, `_recognisedProfit`. Also `read()` (line 27) and the existing `test`, `eq`, `ok` helpers.
- Produces: nothing consumed by later tasks. Later tasks must keep it green.

- [ ] **Step 1: Write the failing assertion first**

Insert this immediately **before** the `// ═══…` comment that introduces `function summary()` (currently around line 2337):

```js
// == V. THE COST PLAN IS PLANNING, NOT MONEY (migration 0075) =======
// A cost plan says what we INTEND to spend against a contract already
// signed. It is not revenue, a cost, a payment or profit — same standing
// as billing allocations (0073), quotations (0045), reimbursements
// (0041) and warranty retention (0043).
//
// The four money functions must never read it. If one ever does, a
// planned number starts moving a real one, and "Profit" stops meaning
// earned − spent. This fence reads their source and fails on contact.
console.log('\nV. The cost plan is planning, not money');
{
  const COST_PLAN_SYMBOLS =
    /costPlan|cpPlannedCost|cpPlanMargin|cpBucketStatus|cpPlanView|plannedMargin|markupPct/;

  test('the cost plan never enters Spent, Earned or recognised Profit', () => {
    for (const name of ['_projSpent', '_projEarned', '_projMargin', '_recognisedProfit']) {
      ok(!COST_PLAN_SYMBOLS.test(portal[name].toString()),
         name + ' must stay independent of cost planning');
    }
  });

  test('a project carrying plan fields computes exactly as one without them', () => {
    // Same numbers, one object salted with every plan field. If the
    // salted one differs, something started reading the plan.
    const bare = { revenue: 720000, labor: 210000, material: 98000, overhead: 91000,
                   completion: { hasData: true, pct: 0.5 } };
    const salted = Object.assign({}, bare, {
      costPlan: { laborAmount: 396000, materialAmount: 180000, overheadAmount: 79200 },
      plannedMargin: 64800, markupPct: 9.89
    });
    eq(portal._projSpent(salted), portal._projSpent(bare));
    eq(portal._projEarned(salted), portal._projEarned(bare));
    eq(portal._projMargin(salted).profit, portal._projMargin(bare).profit);
    eq(portal._recognisedProfit(salted), portal._recognisedProfit(bare));
    // and the buckets stay THREE — planned margin is never a fourth
    eq(portal._projSpent(salted), 399000);
  });
}
```

- [ ] **Step 2: Run it and confirm it passes on today's code**

```bash
node tests/money-math.test.js
```

Expected: PASS, and the tally rises from 231 to **233** checks. It passes now because no portal code references the plan yet — that is the point. Tasks 5–8 must keep it passing.

- [ ] **Step 3: Prove the fence actually bites**

Temporarily add `// costPlan` as a comment inside `_projSpent` in `js/portal-app.compiled.js:316`, then:

```bash
node tests/money-math.test.js
```

Expected: FAIL — `_projSpent must stay independent of cost planning`. **Remove the temporary comment and re-run to confirm it passes again.** A fence never verified to fail is not a fence.

- [ ] **Step 4: Commit (offer)**

```bash
git add tests/money-math.test.js
git commit -m "test(cost-plan): fence the money model against cost planning

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration 0075 + schema doc

**Files:**
- Create: `supabase/migrations/0075_project_cost_plans.sql`
- Modify: `docs/DATABASE_SCHEMA.md` (new subsection in §2, after the billing-allocations block near line 104)

**Interfaces:**
- Consumes: `folders(id)`, `folder_budgets(folder_id, total_budget)`, `folders.ocm_pct` (0030), `is_owner()` (0002).
- Produces: table `project_cost_plans` with columns `folder_id`, `owner_id`, `labor_amount`, `material_amount`, `overhead_amount`, `history`, `created_at`, `updated_at`. Task 4 registers it in the shim; Task 7 writes to it.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0075_project_cost_plans.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0075_project_cost_plans.sql
--
-- PROJECT COST PLAN. A planned cost budget for a folder whose contract is
-- already signed: what we intend to spend on Labor, Material and Overhead.
-- The leftover (contract − planned cost) is the planned MARGIN, derived and
-- never stored.
--
-- PLANNING, OUTSIDE THE MONEY MODEL — same standing as billing allocations
-- (0073), quotations (0045), reimbursements (0041) and warranty retention
-- (0043). Nothing here is revenue, a cost, a payment or profit. Planned
-- margin is NEVER labelled Profit. §V of tests/money-math.test.js fences it.
--
-- ABSORBS THE OCM ALLOWANCE (0030). folders.ocm_pct priced ONE bucket —
-- site overhead — as a % of contract. That is this table's overhead row, so
-- it is backfilled here and nothing writes ocm_pct again. The column is KEPT,
-- not dropped: old rows may hold it and the backfill must stay re-runnable.
--
-- Amounts are PESOS, not percentages: margin is simply what is left over, so
-- there is no "must total 100" constraint to violate.
--
-- Owner-only. Every column is a peso amount; staff must never see one.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

create table if not exists project_cost_plans (
  folder_id        uuid primary key references folders(id) on delete cascade,
  owner_id         uuid not null,
  labor_amount     numeric not null default 0,
  material_amount  numeric not null default 0,
  overhead_amount  numeric not null default 0,
  history          jsonb   not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table project_cost_plans drop constraint if exists project_cost_plans_amounts_chk;
alter table project_cost_plans
  add constraint project_cost_plans_amounts_chk
  check (labor_amount >= 0 and material_amount >= 0 and overhead_amount >= 0);

create index if not exists project_cost_plans_owner_idx on project_cost_plans (owner_id);

-- ── RLS: owner only ────────────────────────────────────────────────
-- Gates on profiles.role = 'owner' via is_owner() from 0002 and NOTHING
-- else. 0073 shipped with an extra profiles.kind = 'admin' clause that
-- exists nowhere else in the schema; a real owner whose kind was not
-- 'admin' passed every other gate and was refused here alone. 0074 had to
-- undo it. Not repeating that.
alter table project_cost_plans enable row level security;

drop policy if exists project_cost_plans_owner on project_cost_plans;
create policy project_cost_plans_owner on project_cost_plans
  for all
  using (is_owner() and owner_id = auth.uid())
  with check (is_owner() and owner_id = auth.uid());

-- ── Backfill from the OCM allowance ────────────────────────────────
-- overhead_amount = folders.ocm_pct % of the folder's contract value.
-- Only folders that actually have both a percentage and a contract get a
-- row; everything else simply has no plan until someone makes one.
-- ON CONFLICT DO NOTHING keeps this re-runnable without clobbering a plan
-- someone has since edited.
insert into project_cost_plans (folder_id, owner_id, labor_amount, material_amount, overhead_amount)
select f.id,
       f.owner_id,
       0,
       0,
       fb.total_budget * f.ocm_pct / 100.0
  from folders f
  join folder_budgets fb on fb.folder_id = f.id
 where f.ocm_pct is not null
   and f.ocm_pct > 0
   and fb.total_budget is not null
   and fb.total_budget > 0
on conflict (folder_id) do nothing;
```

- [ ] **Step 2: Verify the referenced objects really exist**

```bash
grep -n "create table folder_budgets" -A 6 supabase/migrations/0001_init.sql
grep -n "function is_owner" supabase/migrations/0002_rls.sql
grep -n "ocm_pct" supabase/migrations/0030_folder_ocm_pct.sql
```

Expected: `folder_budgets` has `folder_id` and `total_budget`; `is_owner()` exists; `ocm_pct` is on `folders`. **If `folder_budgets`'s owner column is not named `owner_id`, or `folders` has no `owner_id`, fix the backfill's `select` before continuing** — a wrong column name here fails the whole migration.

- [ ] **Step 3: Document the table**

In `docs/DATABASE_SCHEMA.md` §2, immediately after the "Project Control billing allocations" block, add:

```markdown
### `projectCostPlans/{folderId}` → `project_cost_plans` 🔒 — migration `0075`, **owner-only**

The **planned** cost budget for a folder whose contract is already signed: what we intend to spend
on Labor, Material and Overhead. **Outside the money model** — nothing here is revenue, expense,
payment or profit, and `Spent` / `Earned` / `Profit` never read it (§V of `money-math.test.js`
fences that). Engine: `js/cost-plan.js`.

| Field | Type | Notes |
|---|---|---|
| `userId` | string | `owner_id` |
| `laborAmount` | number | planned Labor, **pesos** |
| `materialAmount` | number | planned Material, **pesos** |
| `overheadAmount` | number | planned Overhead, **pesos**. Backfilled from `folders.ocm_pct × folder_budgets.total_budget` |
| `history` | jsonb | append-only `[{ at, by, labor, material, overhead, note }]`; `note` optional |
| `createdAt`, `updatedAt` | ts | |

Doc id is the **`folders.id`** — never `construction_projects.id`.

**Planned margin is derived, never stored:** `contract − (labor + material + overhead)`. It is
**never labelled "Profit"**. Both percentages are always displayed — margin (share of contract) and
markup (share of cost) are different numbers.

**Absorbs OCM (0030).** `folders.ocm_pct` priced the overhead bucket alone; this table now owns it.
The column is **kept, not dropped**, but nothing writes it again.
```

- [ ] **Step 4: Confirm the migration number is still free**

```bash
ls supabase/migrations/ | tail -5
```

Expected: `0075_project_cost_plans.sql` is the highest and `0075` appears exactly once. **Never reuse a number.**

- [ ] **Step 5: Apply it**

This repo applies migrations through Supabase, not from this plan. **Hand the file to the repo owner to apply and wait for confirmation** before Task 7 (the first task that writes to the table). Tasks 4–6 can proceed without it.

- [ ] **Step 6: Commit (offer)**

```bash
git add supabase/migrations/0075_project_cost_plans.sql docs/DATABASE_SCHEMA.md
git commit -m "feat(cost-plan): add project_cost_plans table (migration 0075)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Register the collection in the shim

Without this, `db.collection('projectCostPlans')` resolves to nothing and every read comes back empty — silently.

**Files:**
- Modify: `js/supabase-config.js` (the `REG` object, which starts at line 68; add after the `projectControlBillingAllocations` entry near line 85)
- Modify: `admin.html` (script tag beside `js/billing-allocation.js` at line 5374)

**Interfaces:**
- Consumes: `REG`, `OWNER` (the rename map already used by the allocation entries).
- Produces: `db.collection('projectCostPlans')` works, keyed by `folder_id`, with `updatedAt` treated as a timestamp.

- [ ] **Step 1: Add the REG entry**

In `js/supabase-config.js`, directly after the `projectControlBillingAllocations` block:

```js
  projectCostPlans: {
    table: 'project_cost_plans', rename: OWNER,
    idField: 'folder_id', ts: ['updatedAt']
  },
```

`rename: OWNER` maps `userId` → `owner_id`, exactly as the two allocation entries do. `idField: 'folder_id'` makes the doc id the folder id. No `json:` entry is needed — `history` is plain jsonb the shim passes through, the same as `quotations.history`.

- [ ] **Step 2: Add the script tag**

In `admin.html`, immediately after line 5374:

```html
<script src="js/cost-plan.js"></script>
```

- [ ] **Step 3: Syntax check**

```bash
node --check js/supabase-config.js
```

Expected: no output.

- [ ] **Step 4: Verify the registration resolves**

```bash
node -e "const s=require('fs').readFileSync('js/supabase-config.js','utf8'); const m=s.match(/projectCostPlans:\s*\{[^}]*\}/); if(!m) throw new Error('REG entry missing'); if(!/project_cost_plans/.test(m[0])) throw new Error('wrong table'); if(!/folder_id/.test(m[0])) throw new Error('wrong idField'); console.log('REG entry OK:', m[0].replace(/\s+/g,' '));"
```

Expected: `REG entry OK: projectCostPlans: { table: 'project_cost_plans', rename: OWNER, idField: 'folder_id', ts: ['updatedAt'] }`

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: 10 suites pass, money suite at 233 checks.

- [ ] **Step 6: Commit (offer)**

```bash
git add js/supabase-config.js admin.html
git commit -m "feat(cost-plan): register projectCostPlans in the shim

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Load the plan onto the folder

Threads the plan from Supabase to the components, mirroring the allocation-policy rail exactly so the owner-gating and teardown behave identically.

**Files:**
- Modify: `js/portal-app.compiled.js` — ref beside `allocationPolicyRef` (:3446), merge at :3530, teardown at :3561–3566, subscription beside :3571, prop at :3940

**Interfaces:**
- Consumes: `db.collection('projectCostPlans')` (Task 4); `dataUid`, `isOwner`, `setFoldersRaw` — all already in scope in that component.
- Produces: `folder.costPlan` — either `{ laborAmount, materialAmount, overheadAmount, history }` or `null`. Task 6 renders it; Task 7 writes it; Task 8 reads it in the drill.

- [ ] **Step 1: Add the ref**

Beside `const allocationPolicyRef = React.useRef({});` (line 3446):

```js
  const costPlanRef = React.useRef({});
```

- [ ] **Step 2: Merge it onto each folder**

At line 3530, extend the owner-only spread that already carries `allocationPolicy`:

```js
setFoldersRaw(s.docs.map((d) => ({ id: d.id, ...d.data(), totalBudget: folderBudgetRef.current[d.id] || 0, ...(isOwner ? { allocationPolicy: allocationPolicyRef.current[d.id] || null, costPlan: costPlanRef.current[d.id] || null } : {}) })));
```

**The `isOwner` guard is the access control.** A non-owner session never receives the numbers at all — they are not blanked in the UI, they never arrive.

- [ ] **Step 3: Clear it on teardown**

Beside `allocationPolicyRef.current = {};` (line 3561):

```js
      costPlanRef.current = {};
```

And extend the strip at line 3565 so a session that loses owner status drops the field:

```js
      setFoldersRaw((prev) => prev.map(({ allocationPolicy, costPlan, ...folder }) => folder));
```

- [ ] **Step 4: Subscribe**

Beside the `projectControlAllocationPolicies` subscription (line 3571), following the same shape:

```js
      db.collection("projectCostPlans").where("userId", "==", dataUid).onSnapshot((s) => {
        const m = {};
        s.docs.forEach((d) => { m[d.id] = d.data(); });
        costPlanRef.current = m;
        setFoldersRaw((prev) => prev.map((f) => ({ ...f, costPlan: m[f.id] || null })));
      }),
```

Place it inside the same owner-only block that holds the allocation subscription, and register its unsubscribe the same way the neighbouring subscriptions do.

- [ ] **Step 5: Pass it to `CostBudget`**

At line 3940, add the prop to the existing `CostBudget` element:

```js
React.createElement(CostBudget, { project, summary: isOwner ? allocationSummary : null, childMonths, ...allocationCosts, allocationMap: isOwner ? visibleAllocationMap : {}, costPlan: isOwner && activeFolder ? activeFolder.costPlan : null, folderId: projectId, onOpen: setView, inboxPending })
```

- [ ] **Step 6: Syntax check**

```bash
node --check js/portal-app.compiled.js
```

Expected: no output.

- [ ] **Step 7: Run the full suite — the fence must still be green**

```bash
npm test
```

Expected: 10 suites pass, money suite at 233 checks. **If §V now fails, a money function has picked up a plan reference — fix that, never the fence.**

- [ ] **Step 8: Commit (offer)**

```bash
git add js/portal-app.compiled.js
git commit -m "feat(cost-plan): load the cost plan onto each folder (owner-only)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Render plan vs actual in `CostBudget`

**Files:**
- Modify: `js/portal-app.compiled.js` — `CostBudget`, from its signature at :1239 through the `rows` array and the panel's footer
- Modify: `css/dacs-portal.css` — the plan line and band tones

**Interfaces:**
- Consumes: `costPlan`, `folderId` (Task 5); `cpPlanView` from `window` (Task 1); the existing `project`, `_staff()`, `money()`, `peso()` helpers already in the component.
- Produces: the rendered panel. Task 7 adds the `[ Edit plan ]` button that opens the editor.

- [ ] **Step 1: Accept the new props and build the view**

Change the signature at :1239 to take `costPlan` and `folderId`, and immediately after the existing `const owner = …` line, add:

```js
  // The plan is owner-only and additive: with no plan row, `planView` is
  // null and every branch below falls back to today's rendering exactly.
  const planView = owner && costPlan && typeof cpPlanView === "function"
    ? cpPlanView(project, costPlan)
    : null;
  const planFor = (id) => planView ? planView.buckets.filter((b) => b.id === id)[0] : null;
```

- [ ] **Step 2: Give each row its plan line**

Each of the three entries in the `rows` array gains a `plan` field. For the labor row:

```js
      plan: planFor("labor"),
```

Do the same for `material` and `overhead` with their own ids. Then, where a row renders its `detail`, render the plan line above the bar when `row.plan` is present:

```js
        row.plan && row.plan.planned > 0
          ? h("div", { className: "pc-cb-plan pc-cb-plan-" + row.plan.status.key },
              "Plan " + money(row.plan.planned)
              + " · " + row.plan.status.pct.toFixed(0) + "% used · "
              + (row.plan.status.remaining >= 0
                  ? money(row.plan.status.remaining) + " left"
                  : money(-row.plan.status.remaining) + " over"))
          : row.plan
            ? h("div", { className: "pc-cb-plan pc-cb-plan-unbudgeted" }, "No plan for this bucket")
            : null,
```

- [ ] **Step 3: Switch the bar from share-of-contract to share-of-plan**

The existing `shareOf()` helper stays for the no-plan case. Where the bar width is computed, use:

```js
  const barPct = (row) => row.plan && row.plan.planned > 0
    ? Math.min(row.plan.status.pct, 100)
    : shareOf(row.amount);
```

- [ ] **Step 4: Add the footer summary**

At the end of the panel, rendered only when `planView` exists:

```js
    planView ? h("div", { className: "pc-cb-foot" },
      h("div", { className: "pc-cb-foot-row" },
        h("span", null, "Planned cost"), h("b", null, money(planView.plannedCost)),
        h("span", null, "Contract"),     h("b", null, money(planView.contract))),
      planView.margin
        ? h("div", { className: "pc-cb-foot-row" + (planView.margin.overContract ? " pc-cb-foot-warn" : "") },
            // NEVER "Profit". This is a plan; actual profit is earned − spent.
            h("span", null, "Planned margin (project)"),
            h("b", null, money(planView.margin.margin)),
            h("span", { className: "pc-cb-foot-pct" },
              "markup " + planView.margin.markupPct.toFixed(1) + "%"
              + " · margin " + planView.margin.marginPct.toFixed(1) + "%"))
        : h("div", { className: "pc-cb-foot-row" }, h("span", null, "Planned margin"), h("b", null, "Contract not set"))
    ) : null,
```

- [ ] **Step 5: Add the styles**

Append to `css/dacs-portal.css`:

```css
/* Project cost plan (migration 0075) — owner-only plan-vs-actual lines. */
.pc-cb-plan { font: 400 11.5px 'IBM Plex Sans'; color: var(--text-light); margin-top: 2px; }
.pc-cb-plan-advisory { color: #8B6914; }
.pc-cb-plan-high     { color: #8B4A14; }
.pc-cb-plan-over,
.pc-cb-plan-unbudgeted { color: #A3372B; font-weight: 600; }
.pc-cb-foot { border-top: 1px solid #e7e6e2; margin-top: 12px; padding-top: 10px; }
.pc-cb-foot-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
                  font: 400 12.5px 'IBM Plex Sans'; }
.pc-cb-foot-row b { font: 700 13px 'IBM Plex Sans'; }
.pc-cb-foot-pct { color: var(--text-light); font-size: 11.5px; }
.pc-cb-foot-warn b { color: #A3372B; }
```

- [ ] **Step 6: Syntax check and full suite**

```bash
node --check js/portal-app.compiled.js && npm test
```

Expected: no output from `--check`; 10 suites pass, money suite at 233 checks.

- [ ] **Step 7: Check it in the browser**

Open `admin.html`, log in as owner, open a folder in Project Control. Verify:
- a folder with **no** plan row renders the panel **exactly as before** (bars = share of contract, no plan lines, no footer)
- a folder with a backfilled plan shows the overhead plan line and the footer
- logging in as **staff** shows no plan line and no footer anywhere

- [ ] **Step 8: Commit (offer)**

```bash
git add js/portal-app.compiled.js css/dacs-portal.css
git commit -m "feat(cost-plan): show plan vs actual in the Cost Budget panel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The plan editor

**Requires migration 0075 to be applied** (Task 3, Step 5) — this is the first task that writes.

**Files:**
- Modify: `js/portal-app.compiled.js` — a new `CostPlanEditor` component beside `CostBudget`, plus the `[ Edit plan ]` button in the panel header
- Modify: `css/dacs-portal.css` — modal styles
- Modify: `tests/money-math.test.js` — a third §V assertion fencing the save payload

**Interfaces:**
- Consumes: `cpPlannedCost`, `cpPlanMargin` (Task 1); `costPlan`, `folderId` (Task 5); `db` from the shim.
- Produces: rows in `project_cost_plans`. Task 8 reads `overheadAmount` from them.

- [ ] **Step 1: Write the payload fence first**

Add to the §V block in `tests/money-math.test.js`, inside the same `{ … }`:

```js
  test('the cost plan save writes only columns 0075 creates', () => {
    // CLAUDE.md's hard rule: the shim maps camelCase straight to snake_case,
    // so a field with no column fails the WHOLE statement, silently.
    const sql = read('supabase/migrations/0075_project_cost_plans.sql');
    const body = slice(sql, 'create table if not exists project_cost_plans (', ');',
                       'supabase/migrations/0075_project_cost_plans.sql');
    const columns = body.split('\n').slice(1)
      .map((l) => (l.trim().match(/^([a-z_]+)\s/) || [])[1])
      .filter(Boolean);
    const snake = (f) => f.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    const ALIAS = { userId: 'owner_id' };
    const col = (f) => ALIAS[f] || snake(f);

    const save = slice(portalSrc, 'db.collection("projectCostPlans").doc(folderId).set({', '});',
                       'js/portal-app.compiled.js');
    const fields = save.split('{')[1].split(',')
      .map((part) => (part.split(':')[0] || '').trim())
      .filter((f) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(f));
    ok(fields.length > 0, 'could not read the save payload — the marker moved');
    ok(fields.indexOf('laborAmount') >= 0, 'the payload parser is not seeing the real keys: ' + JSON.stringify(fields));
    fields.forEach((f) =>
      ok(columns.indexOf(col(f)) >= 0,
         'the cost plan save writes "' + f + '" → column ' + col(f) + ', which does not exist — the whole write will fail'));
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/money-math.test.js
```

Expected: FAIL — the `slice()` for the save payload throws `SLICE NOT FOUND`, because the save does not exist yet.

- [ ] **Step 3: Build the editor**

Add beside `CostBudget` in `js/portal-app.compiled.js`:

```js
// The plan editor. Owner-only; the caller never renders it otherwise.
// Amounts are PESOS — margin is simply the leftover, so there is no
// "must total 100" rule here, only a warning when planned cost exceeds
// the contract. A loss-leader is a real plan and must still save.
function CostPlanEditor({ project, costPlan, folderId, onClose }) {
  const h = React.createElement;
  const [labor, setLabor] = React.useState(String((costPlan && costPlan.laborAmount) || 0));
  const [material, setMaterial] = React.useState(String((costPlan && costPlan.materialAmount) || 0));
  const [overhead, setOverhead] = React.useState(String((costPlan && costPlan.overheadAmount) || 0));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const n = (v) => Number(String(v).replace(/,/g, "")) || 0;
  const draft = { laborAmount: n(labor), materialAmount: n(material), overheadAmount: n(overhead) };
  const contract = Number(project.revenue) || 0;
  const plannedCost = cpPlannedCost(draft);
  const margin = cpPlanMargin(contract, draft);

  const save = async () => {
    if (draft.laborAmount < 0 || draft.materialAmount < 0 || draft.overheadAmount < 0) {
      setError("Amounts cannot be negative."); return;
    }
    setSaving(true); setError("");
    try {
      const entry = { at: new Date().toISOString(), by: window.currentUserEmail || "",
                      labor: draft.laborAmount, material: draft.materialAmount, overhead: draft.overheadAmount };
      const history = ((costPlan && costPlan.history) || []).concat([entry]);
      await db.collection("projectCostPlans").doc(folderId).set({
        userId: window.currentDataUserId,
        laborAmount: draft.laborAmount,
        materialAmount: draft.materialAmount,
        overheadAmount: draft.overheadAmount,
        history,
        updatedAt: new Date()
      });
      onClose();
    } catch (err) {
      setError("Save failed (is migration 0075 applied?): " + (err.message || err));
    } finally { setSaving(false); }
  };

  const field = (label, value, set) => h("label", { className: "pc-cpe-field" },
    h("span", null, label),
    h("input", { type: "text", inputMode: "decimal", value,
                 onChange: (e) => set(e.target.value), disabled: saving }));

  return h("div", { className: "pc-cpe-backdrop", onClick: onClose },
    h("div", { className: "pc-cpe", onClick: (e) => e.stopPropagation() },
      h("h3", null, "Cost plan"),
      field("Labor", labor, setLabor),
      field("Material", material, setMaterial),
      field("Overhead", overhead, setOverhead),
      h("div", { className: "pc-cpe-sum" },
        h("div", null, "Planned cost ", h("b", null, "₱ " + peso(plannedCost))),
        h("div", null, "Contract ", h("b", null, "₱ " + peso(contract))),
        margin
          ? h("div", { className: margin.overContract ? "pc-cpe-warn" : "" },
              // Plan, not profit — the label must never say Profit.
              "Planned margin ", h("b", null, "₱ " + peso(margin.margin)),
              margin.markupPct !== null
                ? h("span", { className: "pc-cpe-pct" },
                    " markup " + margin.markupPct.toFixed(1) + "% · margin " + margin.marginPct.toFixed(1) + "%")
                : null)
          : h("div", null, "Planned margin ", h("b", null, "Contract not set"))),
      margin && margin.overContract
        ? h("div", { className: "pc-cpe-warn" }, "Planned cost is over contract.")
        : null,
      error ? h("div", { className: "pc-cpe-warn" }, error) : null,
      h("div", { className: "pc-cpe-actions" },
        h("button", { onClick: onClose, disabled: saving }, "Cancel"),
        h("button", { className: "pc-cpe-save", onClick: save, disabled: saving },
          saving ? "Saving…" : "Save plan"))));
}
```

Note the over-contract case shows a warning and the Save button **stays enabled** — that is deliberate.

- [ ] **Step 4: Wire the button into `CostBudget`**

Add state and a header button, rendered only for owners:

```js
  const [editingPlan, setEditingPlan] = React.useState(false);
```

```js
    owner ? h("button", { className: "pc-cb-edit", onClick: () => setEditingPlan(true) },
              costPlan ? "Edit plan" : "Set plan") : null,
    editingPlan ? h(CostPlanEditor, { project, costPlan, folderId, onClose: () => setEditingPlan(false) }) : null,
```

- [ ] **Step 5: Add modal styles**

Append to `css/dacs-portal.css`:

```css
.pc-cpe-backdrop { position: fixed; inset: 0; background: rgba(17,17,17,.38);
                   display: flex; align-items: center; justify-content: center; z-index: 60; }
.pc-cpe { background: #fff; border-radius: 14px; padding: 22px; width: min(420px, 92vw);
          font-family: 'IBM Plex Sans'; }
.pc-cpe h3 { margin: 0 0 14px; font: 600 15px 'IBM Plex Sans'; }
.pc-cpe-field { display: flex; align-items: center; justify-content: space-between;
                gap: 12px; margin-bottom: 10px; font-size: 13px; }
.pc-cpe-field input { width: 160px; padding: 7px 10px; border: 1px solid #e5e7eb;
                      border-radius: 8px; font: 400 13px 'IBM Plex Sans'; text-align: right; }
.pc-cpe-sum { border-top: 1px solid #e7e6e2; margin-top: 12px; padding-top: 12px;
              font-size: 12.5px; display: grid; gap: 4px; }
.pc-cpe-pct { color: var(--text-light); }
.pc-cpe-warn { color: #A3372B; font-weight: 600; margin-top: 8px; font-size: 12.5px; }
.pc-cpe-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.pc-cpe-actions button { padding: 8px 14px; border-radius: 8px; border: 1px solid #e5e7eb;
                         background: #fff; cursor: pointer; font: 600 12.5px 'IBM Plex Sans'; }
.pc-cpe-save { background: #157a52; color: #fff; border-color: #157a52; }
```

- [ ] **Step 6: Run the fence and the suite**

```bash
node --check js/portal-app.compiled.js && npm test
```

Expected: the §V payload test now **passes** (it can find and parse the save), 10 suites green, money suite at **234** checks.

- [ ] **Step 7: Check it in the browser**

With migration 0075 applied, open `admin.html` as owner: set a plan, reload, confirm it persisted; set planned cost above the contract and confirm the warning shows **and the save still works**; confirm a folder with no contract shows `Contract not set`.

- [ ] **Step 8: Commit (offer)**

```bash
git add js/portal-app.compiled.js css/dacs-portal.css tests/money-math.test.js
git commit -m "feat(cost-plan): add the plan editor and save path

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Point the Overhead drill at the plan, and document the rules

Completes the OCM absorption: one planned-overhead number, one place to edit it.

**Files:**
- Modify: `js/portal-app.compiled.js` — `OverheadDrill` (:1849) and its props at :3940
- Modify: `docs/OVERHEAD_MODULE.md` — a new section after "Billing allocations"
- Modify: `CLAUDE.md` — a cost-plan invariant beside the allocations one

**Interfaces:**
- Consumes: `folder.costPlan` (Task 5), `_ocmStatus` (unchanged, :388).
- Produces: nothing downstream. Final task.

- [ ] **Step 1: Pass the plan to the drill**

At :3940, add to the `OverheadDrill` element:

```js
costPlan: isOwner && activeFolder ? activeFolder.costPlan : null,
```

- [ ] **Step 2: Read the plan instead of `ocmPct`**

In `OverheadDrill`, replace the `_ocmStatus` call at :2005–2006 with a plan-first read that keeps `_ocmStatus`'s exact return shape, so every renderer below it is untouched:

```js
  // ── Site overhead allowance ───────────────────────────────────────
  // The planned overhead now lives in the project cost plan (0075), which
  // absorbed folders.ocm_pct. Reading ocm_pct here as well would be a
  // SECOND planned number that can drift from the first.
  const _planOverhead = costPlan ? Number(costPlan.overheadAmount) || 0 : 0;
  const ocm = _planOverhead > 0
    ? { pct: contractAmount > 0 ? _planOverhead / contractAmount * 100 : 0,
        allowance: _planOverhead,
        spent: allTimeOverhead,
        usedPct: _planOverhead > 0 ? allTimeOverhead / _planOverhead * 100 : 0,
        remaining: _planOverhead - allTimeOverhead,
        over: allTimeOverhead > _planOverhead }
    : null;
```

- [ ] **Step 3: Replace the prompt with a pointer to the editor**

Delete the whole `setOcmPct` function (`js/portal-app.compiled.js:2006–2017` — the `prompt()`, the `parseFloat` validation and the `db.collection("folders").doc(folderId).update({ ocmPct: n })` write).

Then in `_ocmBtn` (the next line), change **only** `onClick: setOcmPct` to `onClick: () => onBack()`. Leave the entire `style: { … }` object exactly as it is — the button keeps its current appearance.

Finally, at the `_ocmBtn(...)` call site inside `ocmPanel`, change the two labels:

```js
      _ocmBtn(ocm ? "Edit in cost plan" : "Set a cost plan")),
```

**`folders.ocm_pct` is now read by nothing and written by nothing.**

- [ ] **Step 4: Verify nothing still writes `ocm_pct`**

```bash
grep -rn "ocmPct" --include=*.js . | grep -v node_modules | grep -v tests/
```

Expected: **no `.update({ ocmPct` write anywhere.** Remaining mentions should only be the prop threading, which can now be removed, or comments.

- [ ] **Step 5: Document the invariant in `CLAUDE.md`**

Add to the "Money invariants" list, after the billing-allocations bullet:

```markdown
- **Project cost plans (0075) are planning, outside the money model.** A folder's plan says what we
  intend to spend on Labor / Material / Overhead against a contract **already signed**; the leftover
  is **planned margin**, derived and never stored. It is **never labelled "Profit"** — actual profit
  stays `earned − spent`. `_projSpent` / `_projEarned` / `_projMargin` / `_recognisedProfit` must
  stay free of every cost-plan symbol (**§V** of `money-math.test.js` reads their source and fails
  otherwise). Margin is simply the remainder, so there is **no "must total 100" rule** — planned cost
  over contract is a **warning, not a save block**. This **absorbed the OCM allowance (0030)**:
  `folders.ocm_pct` was backfilled into `overhead_amount` and is now read and written by nothing.
  Only `js/cost-plan.js` computes any of it. **Owner-only**; staff see no plan and no peso.
```

- [ ] **Step 6: Document the reasoning in `docs/OVERHEAD_MODULE.md`**

Add this section immediately after the "Billing allocations" section:

```markdown
## The project cost plan — a budget for a signed contract (migration 0075)

Billing allocations ask "of the money released for THIS period, how much was meant for what?" The
cost plan asks the whole-job version: **"against the contract I already signed, what do I intend to
spend, and what margin does that leave?"**

```
planned cost = labor + material + overhead      pesos, stored
margin       = contract − planned cost          derived, NEVER stored
margin %     = margin / contract                share of price
markup %     = margin / planned cost            share of cost
```

Both percentages are always shown. A 20% markup is a 16.67% margin; printing one alone guarantees
the other is eventually filed as a bug.

### Why the buckets are Labor / Material / Overhead

A plan compared against actuals in a different shape reports nothing. The actuals arrive from
`buildProject()` split as `labor` / `material` / `overhead`, so the plan uses those three. The
"Direct / Indirect / Overhead" of ordinary estimating language is deliberately **not** used here:
its *Indirect* (equipment, delivery, transport) is already inside our Overhead bucket, and its
*Direct* is our Labor plus Material.

### Company G&A is recovered through margin, never charged to a job

Estimating practice loads office rent, utilities and admin into the price. Our money model forbids
charging them to a project — `_companyOverhead()` exists to keep `scope: 'company'` rows out. So
**G&A comes out of the margin, not out of a project cost line.** The company is still paid for its
office; that money is part of what the contract leaves over. Same pesos, invariant intact.

### It absorbed the OCM allowance

`folders.ocm_pct` (0030) priced exactly one bucket — site overhead — as a percentage of contract.
That is this table's overhead row, so 0075 backfilled it and **nothing reads or writes `ocm_pct`
any more**. The Overhead drill's allowance panel is unchanged on screen; it simply reads
`project_cost_plans.overhead_amount`. Two planned overhead numbers would drift, and drift between
two surfaces is exactly what broke Reports against Project Control in August 2026.

### Cost plan vs billing allocation — different scopes, rarely equal

| | base | buckets | actuals | horizon |
|---|---|---|---|---|
| Billing allocation (0073) | one period's Fund Allocated | Direct / Indirect / Target Margin | per period | tactical |
| Cost plan (0075) | the whole contract | Labor / Material / Overhead | all-time | strategic |

They disagreeing is **correct**, not a bug. The UI says which is which in the label — *Planned margin
(project)* against *Target Margin Reserve* — and **neither is ever called "Profit"**.
```

- [ ] **Step 7: Full verification**

```bash
node --check js/portal-app.compiled.js && npm test
```

Expected: 10 suites pass, money suite at 234 checks.

- [ ] **Step 8: Browser check**

As owner: open the Overhead drill, confirm the allowance panel shows the plan's overhead figure and that its button returns to the dashboard; confirm a folder with **no** plan shows the "Set a cost plan" prompt rather than a comparison. As staff: confirm the panel is absent entirely.

- [ ] **Step 9: Commit (offer)**

```bash
git add js/portal-app.compiled.js docs/OVERHEAD_MODULE.md CLAUDE.md
git commit -m "feat(cost-plan): absorb the OCM allowance into the cost plan

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification summary

| After task | `npm test` suites | Money checks |
|---|---|---|
| 1 | 10 | 231 |
| 2 | 10 | 233 |
| 3–6 | 10 | 233 |
| 7–8 | 10 | 234 |

If the money suite fails with **"SLICE NOT FOUND"**, the source was restructured — update the extraction markers in the test, **never delete the test**.

Production errors self-report into `client_errors` (migration 0028). If the owner reports a break after this ships:

```sql
select at, page, kind, message, source, line from client_errors order by at desc limit 100;
```
