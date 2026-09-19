# Project Control Billing Allocation Design

**Date:** 2026-09-19  
**Status:** Proposed for implementation  
**Scope:** Project Control only (`folders` / `projects`), not Project Management

## Purpose

Give every client-funded Project Control billing period an explicit cost-control plan. The
company default is 70% Direct Cost, 20% Indirect Cost and 10% Target Margin Reserve. These are
budget envelopes, not accounting entries and not a replacement for actual project profit.

The feature must answer four separate questions without mixing them:

1. How much client funding was allocated to this billing period?
2. How much was planned for direct cost, indirect cost and target margin?
3. How much direct and indirect cost was actually incurred?
4. How much profit has actually been earned from accomplished work?

## Definitions

### Allocation base

The allocation base is the billing period's existing confidential `monthlyBudget` value in
`project_budgets`. It is the amount Project Control currently calls Fund Allocated. This design
does not introduce tax, VAT or withholding calculations. If those are later recorded as their
own fields, a separate design must decide whether allocation uses gross or net funds.

### Planned envelopes

For allocation base `B`:

```text
direct budget        = B * direct percentage
indirect budget      = B * indirect percentage
target margin reserve = B * target margin percentage

direct percentage + indirect percentage + target margin percentage = 100
```

The default percentages are 70, 20 and 10. Only the owner may change them. Percentages are
stored as a snapshot on each billing period so later changes to the project default do not
rewrite history.

### Actual costs

The feature reuses the existing money classification:

```text
actual direct = materials
              + direct payroll
              + statutory liability attributed to direct workers

actual indirect = indirect payroll
                + statutory liability attributed to indirect workers
                + project overhead expenses
```

Out Source payments remain Labor and therefore Direct Cost. Cover-funded costs keep their real
classification; `coverExpense` and president-funded periods identify the funding source, not a
fourth cost bucket.

Company overhead remains outside every project. Reimbursements, warranty retention, quotations
and attendance rewards remain outside the Project Control money model.

### Target margin versus actual profit

Target Margin Reserve is a planning amount. It is never written as revenue, expense, payment or
profit. Actual profit remains unchanged:

```text
earned revenue = BOQ accomplishment percentage * contract amount
spent          = labor + material + project overhead
actual profit  = earned revenue - spent
```

The UI must use the term **Target Margin Reserve**, not simply Profit, whenever it displays the
10% allocation. Actual profit continues to be labelled Earned or Forecast under the existing
rules.

## Recommended Approach

### Chosen: configurable project policy with immutable period snapshots

Each folder has an owner-only default policy. Creating a client-funded billing period copies the
folder percentages into a separate owner-only allocation record. Editing the folder default
affects future periods only. Editing an existing period uses one transactional database function
to update the snapshot and create an immutable adjustment record containing the before values,
after values, reason, actor and timestamp.

This approach preserves history, supports projects whose estimates cannot sustain 70/20/10, and
keeps sensitive amounts and target-margin information away from staff accounts.

### Rejected: global hard-coded 70/20/10

This is simpler but cannot accommodate material-heavy, labor-heavy or unusually high-overhead
projects. Changing the constant later would also make historical periods appear to have used a
policy that did not exist when they were funded.

### Rejected: derive all percentages at read time

This avoids schema changes but destroys historical accuracy and provides no audit trail. It also
makes owner-approved reallocations impossible to explain.

## Data Model

Migration `0073_project_control_billing_allocations.sql` will add:

### `project_control_allocation_policies`

- `folder_id uuid primary key references folders(id) on delete cascade`
- `owner_id uuid not null`
- `direct_pct numeric(5,2) not null default 70`
- `indirect_pct numeric(5,2) not null default 20`
- `target_margin_pct numeric(5,2) not null default 10`
- `updated_at timestamptz not null default now()`
- A check constraint requiring non-negative values totalling exactly 100

These are the defaults for future billing periods. RLS permits only the owning owner account to
read or write the table. Staff and clients receive no policy rows.

### `project_control_billing_allocations`

- `project_id uuid primary key references projects(id) on delete cascade`
- `owner_id uuid not null`
- `direct_pct numeric(5,2) not null`
- `indirect_pct numeric(5,2) not null`
- `target_margin_pct numeric(5,2) not null`
- `updated_at timestamptz not null default now()`
- A check constraint requiring non-negative values totalling exactly 100

The absence of a row marks a legacy period as **Allocation not configured**. New client-funded
periods must write a complete snapshot. No migration silently assigns a policy to historical
periods.

The peso envelope values are derived by joining the existing `project_budgets.monthly_budget`
with the owner-only snapshot percentages. They are not stored, preventing amount drift when the
billing amount is edited. The existing budget tables are deliberately unchanged: assigned
clients can read them under current RLS, so putting a target-margin percentage there would leak
commercial information even if the UI did not render it.

### `overhead_expenses`

- `billing_period_id uuid null references projects(id) on delete set null`

Project overhead can then be charged to a specific billing period. Existing rows remain null and
appear as **Unallocated Indirect Cost**. They continue to count in project Spent and actual
profit, but do not consume a particular period's indirect envelope until assigned.

### `billing_allocation_adjustments`

An append-only owner-only audit table:

- `id uuid primary key`
- `owner_id uuid not null`
- `project_id uuid not null references projects(id) on delete cascade`
- `old_direct_pct`, `old_indirect_pct`, `old_target_margin_pct`
- `new_direct_pct`, `new_indirect_pct`, `new_target_margin_pct`
- `reason text not null`
- `created_by uuid not null`
- `created_at timestamptz not null default now()`

RLS permits the owner to read and insert rows. There are no update or delete policies, preserving
the audit trail. The Supabase shim registers owner-only `projectControlAllocationPolicies`,
`projectControlBillingAllocations` and `billingAllocationAdjustments` collections.

### Transactional adjustment function

`update_project_control_billing_allocation(project_id, direct_pct, indirect_pct,
target_margin_pct, reason)` validates ownership and the 100% total, locks the allocation row,
inserts the immutable before/after audit record and updates the snapshot in one database
transaction. The browser never performs a separate update followed by a best-effort audit write.

## User Flows

### Configure project policy

The owner opens Project Control project settings and sees 70 / 20 / 10 defaults. Three numeric
inputs update a live 100% total. Saving is disabled until the values are non-negative and total
100. Staff never see or edit these settings.

### Create billing period

The existing New Billing Period form continues to capture funding type and amount. For a
client-funded period, it previews the calculated Direct, Indirect and Target Margin envelopes.
On save, it writes the normal `projects` row and `monthlyBudget` to `projectBudgets`, then writes
the percentage snapshot to the separate owner-only allocation table.

President-funded Cover periods keep `monthlyBudget = 0` and no allocation snapshot. Their actual
costs continue to count in the correct Direct or Indirect category and in Spent.

### Edit billing period

Changing only the billing amount recalculates the derived peso envelopes using the existing
snapshot. Changing percentages requires an owner, a non-empty reason and confirmation. The
transactional database function updates the snapshot and inserts its audit row together; either
both changes commit or neither does.

### Record costs

Materials and direct payroll consume the Direct envelope automatically. Indirect payroll consumes
the Indirect envelope automatically because payroll already belongs to a billing period. Adding
or editing a project overhead expense offers an optional billing-period selector restricted to
the same folder. A null selection is allowed but visibly reported as unallocated.

### Monitor a billing period

Each owner-only billing card shows:

- Fund Allocated
- Direct: budget, actual, remaining and utilization percentage
- Indirect: budget, actual, remaining and utilization percentage
- Target Margin Reserve
- Reserve at Risk, when total actual cost exceeds Direct plus Indirect budgets
- Allocation status and adjustment-history access

Staff retain the existing no-peso behavior. The feature must not expose confidential allocation
amounts or target-margin amounts through staff-readable rows.

### Monitor the project

Project Control rolls up all configured client-funded periods:

- Total Direct Budget versus Actual Direct
- Total Indirect Budget versus Actual Indirect
- Total Target Margin Reserve
- Unallocated Indirect Cost
- Actual Earned Profit and variance from the target margin

Target-margin variance is informational:

```text
target margin variance = actual earned profit - total target margin reserve
```

Forecast profit must not be presented as earned profit.

## Controls And Warnings

- At 80% utilization: advisory warning.
- At 90% utilization: high warning.
- Above 100%: over-budget warning.
- Spending is not automatically blocked; legitimate project work may have to continue.
- Consuming the target margin produces **Reserve at Risk** rather than silently moving money.
- Only the owner can change percentages or acknowledge a reallocation.
- Every percentage change requires a reason and creates an audit record.
- Percentages are rounded to two decimals; derived peso values are rounded only for display.

## Reporting

Owner-facing Project Control screens, billing-period details, reports, print views and CSV exports
must use the same allocation helper and classification helper. Reports show planned, actual,
remaining, utilization and variance for Direct and Indirect, plus Target Margin Reserve and
actual earned profit.

The existing Fund Allocated and Spent totals remain unchanged. The allocation feature explains
the fund; it does not add another amount to Spent.

## Code Surface

Expected implementation files:

- `supabase/migrations/0073_project_control_billing_allocations.sql`
- `js/supabase-config.js`
- `js/expenses-module.js`
- `js/portal-app.compiled.js` (edited directly; never run the build script)
- `js/overhead-module.js`
- `admin.html`
- `css/expenses.css` and/or the existing Project Control stylesheet
- `tests/money-math.test.js`
- focused allocation tests if clearer than extending the money test file
- `docs/DATABASE_SCHEMA.md`
- `docs/ARCHITECTURE.md`
- `docs/OVERHEAD_MODULE.md`
- `docs/EXPENSES_README.md`

No construction-client or partner portal HTML change is required unless allocation figures are
later approved for client display. This design keeps them owner-only.

## Failure Handling

- Validate the 100% total in both UI code and a database check constraint.
- Treat a missing allocation row as legacy/unconfigured, never as implicit 70/20/10.
- If a period references a deleted overhead assignment, `ON DELETE SET NULL` returns that cost to
  Unallocated Indirect Cost without removing it from project Spent.
- Create flows show a clear error if the billing-period row, confidential budget row or allocation
  row fails. Partial-create cleanup follows the existing pattern and must not delete unrelated
  user data.
- Percentage adjustments use the database function so snapshot and audit writes are atomic.
- Allocation audit rows are immutable.

## Verification

Automated tests must cover:

1. 70/20/10 calculations and decimal percentages.
2. Validation that percentages total 100 and are non-negative.
3. Legacy null snapshots.
4. Cover periods receiving no allocation snapshot.
5. Direct classification for materials, direct payroll, direct liability and Out Source.
6. Indirect classification for indirect payroll, indirect liability and assigned overhead.
7. Unassigned overhead remaining in project Spent but outside period utilization.
8. Target Margin Reserve never entering Spent, Earned or actual Profit.
9. Amount edits recomputing derived envelopes without changing snapshot percentages.
10. Owner-only editing and staff amount-hiding guards.
11. Allocation adjustment reason and audit creation.
12. Existing cover-money and money-invariant tests remaining green.

Run `npm test`, syntax-check every changed JavaScript file, and verify `admin.html` in the browser
as owner and staff. Browser verification must cover a new period, a legacy period, an assigned
overhead expense, an unassigned overhead expense, an over-budget warning and an audited
percentage adjustment.

## Non-Goals

- No automatic invoice, payment-request or accounting-entry creation.
- No automatic transfer out of the Target Margin Reserve.
- No change to BOQ accomplishment or earned-revenue calculations.
- No change to company G&A treatment.
- No tax, VAT or withholding engine.
- No client or partner visibility in this release.
- No retroactive mutation of historical billing-period allocations.
