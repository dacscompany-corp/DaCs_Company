# Petty cash for Labor and Overhead — design

Date: 25 Nov 2026 · Status: **approved by the owner 25 Nov 2026 ("okay"), as written** · Migration: **0122**

## 1. Why

Petty cash given to a staff buyer pays for more than materials. On 18–20 Nov one
buyer was given ₱35,000; only ₱1,110 is recorded as spent (one purchase). The
rest — labor and site overhead paid in cash — is invisible to petty cash, so the
buyer's balance reads about ₱33,890 held, and a cash count would show a false
shortfall.

Materials can already be paid from petty cash (Add Expense → Paid now? → Paid
from, done 25 Nov, uncommitted). This adds the same choice to **Labor (payroll)**
and **Overhead**, so one entry, typed once, also lowers that buyer's petty cash.

## 2. Goals

1. A **Paid from** choice on Add/Edit Payroll (Project Control) and Add/Edit
   Overhead (Project Control's Overhead tab **and** the Overhead section).
2. Choosing petty cash writes a **petty cash record in the same database step**
   as the entry — both saved or neither.
3. **Editing or deleting** the entry voids that record automatically, with a
   reason, and writes a new one when it is still paid from petty cash. Nothing
   is ever deleted from petty cash.
4. The buyer's petty cash screens — the buyer card, **My cash**, the **daily
   report**, its print and CSV — show these as **"Paid labor"** /
   **"Paid overhead"** lines, and the balance and cash counts include them.

## 3. Non-goals

- **No change to Spent, Labor, Overhead, Cover, Earned or Profit.** A payroll or
  overhead row counts exactly as today; petty cash only says *how* it was paid.
- **Not own money.** "Company owes you" for labor/overhead paid from a staff
  member's own pocket is a separate step (owner's call, see §9).
- Not Project Management (PM payroll / daily expenses).
- No backfill script. Past entries paid from petty cash are marked by editing
  them (the main owner picks whose petty cash).
- "Mode of Payment" (Cash / GCash / Bank Transfer / Cheque) is unchanged; Paid
  from is a separate question.

## 4. Anti-goals (would make it a failure even if it "works")

- A petty cash record deleted, or changed in place, instead of voided.
- Labor or overhead counted twice, or petty cash leaking into Spent / Profit.
- Staff seeing a peso they don't see today.
- An account recording another buyer's petty cash when it isn't the main owner.

## 5. Approaches (owner picked A on 25 Nov)

- **A — Auto record + auto void (picked).** The entry carries "whose petty cash";
  database triggers write a petty cash record on save and void / re-record it on
  edit or delete. History and past cash counts follow petty cash's existing
  rules. Most work: a migration with triggers.
- B — Just a box on the entry, and the balance adds those rows up. Simplest, but
  editing or deleting an old entry silently rewrites past balances and past cash
  counts, with no trail. Rejected: breaks petty cash's "never deleted" rule.
- C — A separate "spent on labor/overhead" line typed in Purchasing. Safe, but
  every payment is typed twice and the two can disagree. Rejected: double entry.

## 6. Who sees and may choose what (same as materials)

| Account | Paid from choices |
|---|---|
| Staff with the Buyer switch | Company · **My petty cash** |
| **Main owner** (owner role, `owner_id` null, active) | Company · **Petty cash** + **Whose petty cash** (staff buyers, the list `pur_cash_tracker` gives Record payment) |
| Other owner accounts, staff without the Buyer switch | Company only (the row is not shown) |

- Picking petty cash makes the **payment date required** (petty cash needs a day).
- Staff cannot add Overhead in Project Control today; that stays (see §9).
- The server enforces all of this; the form only mirrors it.

Form sketch (Payroll; Overhead gets the same rows next to its amount):

```
Mode of Payment     [ Cash        ▾ ]
Paid from           [ Company     ▾ ]      Company / Petty cash
Whose petty cash    [ Buyer A     ▾ ]      main owner only, after Petty cash
Payment date        required when Petty cash is picked
```

## 7. Data and server (migration 0122)

**Columns** (new; shim maps `pettyCashBy` → `petty_cash_by`, no `REG` change):

- `payroll.petty_cash_by uuid null references profiles(id)`
- `overhead_expenses.petty_cash_by uuid null references profiles(id)`

Null = not paid from petty cash (today's behaviour).

**Table `pur_cash_spends`** — one row per entry paid from petty cash:
`id, owner_id, buyer_id, amount numeric(14,2) > 0, spent_on date,
kind ('payroll'|'overhead'), payroll_id uuid null, overhead_id uuid null,
label text, place text, created_by, created_at, voided_at, void_reason`.
`payroll_id` / `overhead_id` carry **no foreign key**: the record outlives a
deleted entry. `label` (worker · role, or expense name) and `place` (project
name, or "Company overhead") are snapshots for the report. RLS on with no
policies and `revoke all`, like the other `pur_cash_*` tables; read only
through `pur_*` functions.

**Triggers** (security definer) on `payroll` and `overhead_expenses`:

- **Before insert/update — check**, only when petty cash is being chosen or its
  person changed:
  - the person is a staff account of this company (`pur_holder_ok`) → else
    `NOT_A_BUYER`;
  - the caller is that person or the main owner (`pur_is_main_owner()`) → else
    `PERSON_NOT_ALLOWED`;
  - the date is a real day, not in the future (`pur_past_day`) → else
    `PETTY_CASH_DATE`. Payroll `payment_date` is a date-and-time box
    (`YYYY-MM-DDTHH:MM`, already local), so the day is its first 10 characters;
    overhead `date` is a plain day;
  - amount (`total_salary` / `amount`) > 0.
- **After insert:** petty cash set → insert one live spend.
- **After update:** if `petty_cash_by`, the amount, the date, or (overhead)
  `deleted_at` changed → void the live spend ("Payroll entry changed" /
  "Overhead entry deleted" …), then, if still petty cash and not deleted,
  insert a new one. Any other change (notes, worker name, contract) touches
  nothing. Correcting amount or date keeps the same person without re-checking
  who the caller is — anyone allowed to edit the row may fix a typo.
- **After delete** (payroll is hard-deleted, also by billing-period and folder
  deletes): void the live spend, "Payroll entry deleted".

At most **one live spend per entry** (partial unique indexes on `payroll_id` /
`overhead_id` where `voided_at is null`).

**Balance:** `pur_cash_raw` is redefined to also subtract live spends —
`spent_on <= p_upto`, counted with `pur_stood(voided_at, p_upto)` — exactly how
petty cash purchase payments count.

**Reads:** `pur_cash_detail` gains `spends` (last 90 days); `pur_cash_report`
gains a per-day `spends` list and the voids of spends in `reversals`
("Paid labor" / "Paid overhead"), so print and CSV carry them. Everything else
that reads `pur_cash_raw` (cash tracker, counts, Reconciliation's petty cash
total) picks the spends up with no change.

**Snapshots:** payroll `place` = the folder name behind its billing period
(`payroll.project_id → projects.folder_id → folders.name`). Moving a row to
another billing period is not a money change and does not re-record.

**In the browser:** a staff buyer's form sends `pettyCashBy` = their own id; the
main owner's sends the picked buyer. The main-owner test is
`window.currentStockMainOwner` (it is `pur_is_main_owner()`, read at sign-in).

## 8. Screens and files

- **Payroll** — `admin.html` Add (`payMethod` area) and Edit (`editPayMethod`
  area) forms; `js/expenses-module.js` add path (one `pettyCashBy` on every split
  row) and edit path. Plain-words messages for the four refusals.
- **Overhead** — Overhead section (`admin.html` modal + `js/overhead-module.js`)
  and Project Control's Overhead tab (`js/portal-app.compiled.js`, edited
  directly — never `npm run build`). In the Overhead section, picking petty cash
  sets **Status = Paid**.
- **Lists** — Labor and Overhead rows show a small **"Petty cash · Name"** tag
  (no pesos; the name only where the browser knows it).
- **Petty cash** — `js/purchasing-admin-core.js` `reportRows` / `reportCsv`,
  `js/purchasing-admin-cash.js` buyer card and My cash: the new lines. Split
  payroll rows (same `split_group`) show as **one** line.
- **Payroll voucher** (`js/print-utils.js`): "Paid from: Petty cash (Name)".
- **Docs:** `docs/DATABASE_SCHEMA.md`; `CLAUDE.md` petty cash rule (labor and
  overhead may now be paid from petty cash; still counted once, in Spent, as
  labor / overhead).

## 9. Calls made for the owner to check

1. **Same people as materials** (§6). Staff still can't add Overhead in Project
   Control, so overhead paid from a buyer's petty cash is entered by the main
   owner. *Asked 25 Nov whether staff buyers should add overhead they paid from
   their own petty cash; the owner approved the design as written — so no: staff
   stay out of the Overhead forms.*
2. **Own money is left out** (non-goal) — only petty cash.
3. **Corrections follow petty cash's existing rule:** the void counts from the
   day it is made, the new record from the payment date. So between the payment
   day and the fix, the history shows both (the daily report shows the void row
   that explains it); today's balance is right. Purchases behave the same way.
4. **Overhead section:** petty cash means paid, so Status becomes Paid.
5. **Payment date becomes required** for petty-cash payroll.

## 10. Left to the builder

- Exact trigger code, refusal texts, and where the new rows sit on each form.
- Whether the payroll voucher line also appears on the labor-contract statement.
- Tests: a PGlite suite for the triggers (insert, edit, delete, overhead soft
  delete, split rows, wrong person, non-main owner, future date, balance and
  report, the one-live-spend rule); JS tests for the forms and report rows; a
  `money-math.test.js` check that `_projSpent` / `_projMargin` /
  `_recognisedProfit` and the labor/overhead sums never read `pettyCashBy`.
- Apply order: 0121 is built but not applied; 0122 does not depend on it.
