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

## Billing periods deliberately exclude overhead expenses

The Billing Periods card and drill show *all payroll + materials* — **not** overhead
expenses — because electricity and rent are recorded at folder level with no billing period
attached. That card answers "how much of the allocated period fund did we spend"; the KPI
strip and margin answer "what did this project actually cost". They will not match, and the
difference is exactly the operating costs. This is intended, not a bug.

---

## Schema

Table `overhead_expenses`. `0001_init` created only
`id, legacy_id, owner_id, category, amount, date, description, created_at`;
`0006` added `folder_id`; **`0025_overhead_columns.sql`** captures the columns the app has
actually been writing (`scope`, `expense_name`, `supplier`, `invoice_number`, `receipt_url`,
`status`, `notes`, `history`, `deleted_at`, `updated_at`, `created_by`), which existed only
in the live database until then.

The Firestore-compat shim (`js/supabase-config.js`, `REG.overheadExpenses`) maps camelCase
fields straight to snake_case columns — there is **no** jsonb blob mode on this table, so any
new field written by the app needs a real column or the save fails.
