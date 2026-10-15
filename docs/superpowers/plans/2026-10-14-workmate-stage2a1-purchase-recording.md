# WorkMate Stage 2A-1 — One Purchase Recording Operation — Implementation Plan (revision 4, as built)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One server operation records every purchase and charges it to the right billing period by its **actual purchase month**. Dacs Web **Expenses → Add expense** switches to it, so the funding rule lives in exactly one place for the office now and for the WorkMate buyer app later.

**Architecture:**
- **Migration 0096** adds `purchases`: one receipt, with its lines, shared fee and discount charges, history, retry answers and stock moves.
- It adds five office operations:
  - `pur_record`, `pur_correct`, `pur_refund` and `pur_void`
  - `pur_replace`: a new version of a purchase with a different number of lines, with its stock carried over
- Each writes **ordinary `expenses` rows**, linked back to its purchase. Because of that, Project Control, Reports, print and CSV keep reading one table.
- **A project with no billing period at all** still counts the cost at once. It gets a Cover row tied to the project itself (`expenses.folder_id`, no period). Every Spent site, including the Expenses dashboard and folder totals, reads that one new kind of row.
- Every call locks everything it touches **before** writing, in one fixed order. A change to an existing purchase locks **that purchase** first, before looking up its projects.
- The "track in inventory" stock update runs inside the same transaction, **once per line**, within the company.
- **A project or period with a live purchase cannot be deleted.** Dacs Web asks first, and database triggers refuse it before anything is removed.
- **Reading purchases needs the same access as recording them.**
- `handleAddExpense` stops splitting in the browser and sends one purchase to `pur_record`. Edits and deletes of purchase-made rows go through `pur_correct` and `pur_void`, each with a reason.

**Tech Stack:**
- Supabase Postgres (plpgsql, RLS).
- Vanilla JS with no build step (`js/expenses-module.js`, `js/portal-app.compiled.js` edited directly, `admin.html`).
- Node test scripts (`npm test`, zero dependencies).
- **SQL test tools, installed only into `supabase/tests`:**
  - **PGlite**: PostgreSQL 16 compiled to WebAssembly.
  - **embedded-postgres**: a throwaway real PostgreSQL 17, for the two-session race tests.
  - **pg**: the database client.

**Spec:** [docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md](../specs/2026-09-30-workmate-mobile-purchasing-design.md), §3 "Money rules on the server" (agreed 12 October 2026) and the Office-side corrections and voids. Answers are in [2026-10-12-workmate-stage2-questions.md](../specs/2026-10-12-workmate-stage2-questions.md): Q1–Q5 and Q22–Q24. Decisions of 14–15 October 2026 are recorded below under "Reviews and decisions".

## Global Constraints

- **Money invariants (CLAUDE.md):**
  - Spent = Labor + Material + Overhead.
  - **Cover money is Spent, and the Cover figure is a subset, never a fourth bucket.**
  - A purchase line is **Material**.
  - Allocations, G&A and the billing-allocation envelopes are never touched.
- **The rule, verbatim (CLAUDE.md and AGENTS.md, applied 14 Oct):** "Petty cash, personal advances, supplier refunds and supplier credits stay outside Spent, Earned and Profit. Issuing, returning or repaying that money never creates an expense. Project purchase costs enter Material/Spent once, after server acceptance through the shared recording operation. Warehouse purchases stay outside project Spent until owner-approved cost assignment; approved cost transfers follow their separate rules. Payroll and overhead remain unchanged."
- **§3.3 funding:** charge the **actual purchase month**.
  - Use that month's client periods that have a budget, **earliest billing number first**.
  - Each period gives up to "budget − expenses − payroll already charged to it", **exactly as Dacs Web computes it today**.
  - Any shortage goes to **Cover**. **Never use another month.**
  - If no eligible period exists that month, put the whole amount on Cover and flag *office review*.
- **No billing period at all (decided 14 Oct):** keep the actual purchase. Count its cost in the project's Material/Spent **immediately**, as **Cover**, and flag *"No billing period — office review needed"*.
  - **Invent no period and no client allocation.**
  - A later re-fund keeps the purchase date and the total Spent, and the cost is never counted twice.
  - **Every** report counts it once.
- **Additional Works keep their separate no-cap rule (Q24):** charged in full to their own period, never moved to Cover.
- **§3.4 fees and discounts:**
  - A shared delivery fee becomes "Delivery fee (share)" rows, split by line amount to the centavo. **No share is ever negative, and the shares always add up to the fee.**
  - A discount reduces its lines before funding. **No negative rows.**
  - Lines + fees − discounts must equal the receipt total.
- **§3.1 retries:** a resent purchase is recorded **once**. The stock update is **independently** safe against duplication: one move per purchase line, ever.
- **Who:**
  - Active owner and staff accounts **allowed the Expenses section**, for recording **and for reading** purchases. Module-focused accounts, such as PM-only `admin-pm@`, are refused both.
  - **Expenses access never grants phone purchasing.** `source = 'workmate'` is refused until the Buyer switch (2A-2).
- **Stock:** items are matched **within the company**: its own item, else the unowned items the old browser mirror wrote, never another company's.
- **Office side:**
  - A correction replaces the purchase's rows **in one transaction**, and history keeps the before and after.
  - **A purchase whose number of lines must change is replaced** in one transaction (`pur_replace`), and its stock is carried over, never added twice.
  - A void removes the rows from Spent but keeps the receipt and history. It does not claim goods were returned or money refunded, and stock is not taken back.
  - Completed projects (`folders.completed_at`, 0064) are the only lock: staff cannot change them; the main owner can.
  - Moving a line to another project is main-owner only.
- **Deletion (decided 14 Oct, tightened 15 Oct):**
  - A project or period with a **live** purchase, even one discounted to zero, cannot be deleted.
  - The check happens **before anything is removed**: Dacs Web asks first, and database triggers refuse it too.
  - Once all of a project's purchases are voided, it **can** be deleted. Its purchases stay readable, keeping the old id and the project's name.
- **Concurrency:**
  - Simultaneous purchases never deadlock and never spend the same remaining fund twice.
  - Two changes to the **same** purchase run one after the other, each seeing what the other left.
  - This is proven with **two real database sessions**.
- **CI (decided 14 Oct):** CI runs **both** SQL suites (`npm run test:sql`) as well as `npm test`.
- **Migrations:** the next number is **0096** (highest on disk is 0095). Migrations are immutable once applied, idempotent, `set local lock_timeout = '5s'`, and any SECURITY DEFINER function gets `set search_path = public`.
- **Dates:** never `toISOString().slice(0,10)` for a local date key; PH is UTC+8.
- **Staff:** they never see budgets, and the server reads budgets on their behalf. Success messages contain no peso amounts.
- **Do not run `npm run build`.** `js/portal-app.compiled.js` is edited directly.
- The user commits and pushes; the agent never does.

---

## Finding that changes behaviour today (verify in Task 4, Step 1)

**Main Contract expenses entered by staff are recorded entirely as Cover today**, even when the period has budget left. Here is why:
- Staff cannot read `project_budgets` (0002 RLS), so `monthlyBudget` is 0 in a staff session (`expenses-module.js` ~line 636).
- `handleAddExpense` therefore finds no fundable period and falls into "nothing fundable left → Cover Expenses".
- **Additional Works are not affected**: they take a separate path that has no budget.
- The Expenses list has the same blind spot: its budget-based "Cover" guess tags **every** staff-viewed row as Cover.

From 0096 on, the **server** reads the budgets, and staff no longer see the guesses (R17). Rows saved before 0096 are not changed (R9).

## Reviews and decisions

### First review (14 October 2026)

Every point was **checked against the code or a running database** before changing anything:

| # | Review point | Verified | Resolution |
|---|---|---|---|
| 1 | Small fees overcharge | **Confirmed.** ₱0.03 over 5 equal lines gave a −₱0.01 share that was skipped, so ₱0.04 was charged. | Largest-remainder split (`pur_prorate`); stored shares re-checked; small-fee tests |
| 2 | Access too broad; PM-only must stay out | **Confirmed.** 0095 already refuses module-focused accounts; 0096 did not. | `pur_actor_owner(source)`: Expenses section required; `workmate` source refused (Buyer switch in 2A-2) |
| 3 | Simultaneous buying; possible deadlock | **Confirmed, and worse than stated:** on a real PostgreSQL, **20 of 20** simultaneous pairs deadlocked, including two purchases on the **same** project. | Operation lock, then all project and stock locks (advisory, sorted), **before any write**; `2a1_concurrency.mjs` with two sessions |
| 4 | A project with no periods was refused | **Confirmed.** | Decided: kept, counted at once as Cover, flagged; no period invented; `pur_refund` later |
| 5 | Inventory could be added twice | **Partly.** Two overlapping saves could each run the browser's stock step. | The stock update moved **into** the recording (same transaction), with `purchase_stock_moves` keyed by line. The browser no longer touches stock |
| 6 | Voiding didn't make a project deletable | **Confirmed.** `purchase_lines.folder_id` was a foreign key. | Decided: no foreign key; `folder_name` keeps the history |
| 7 | Rule wording too broad; AGENTS.md staff line | **Confirmed.** | The exact agreed rule applied to both files; AGENTS.md staff line aligned |
| 8 | Expense list shows wrong Cover tags for staff | **Confirmed.** | The list's guess skips staff; purchase rows keep their real Cover flag |
| 9 | "Every expense" overstated | **Confirmed.** | Now "Main Contract expenses entered by staff" |
| 10 | SQL tests outside CI | Correct. | Decided: both SQL suites run in CI |

### Second review (15 October 2026)

All five points were verified, then fixed:

| # | Review point | Verified | Resolution |
|---|---|---|---|
| 1 | The dashboard and Overview summary miss no-period costs | **Confirmed.** The new screen test on revision 2 code shows dashboard Total Spent **₱350 instead of ₱1,050**. The folder list, Budget Overview folder cards and the folder-detail count missed it too. Project Control and the report model were already right. | One helper (`_expNoPeriodRows` / `_expNoPeriodSpent`) used by `updateDashboardBudget` (with the overview cards and the stacked bar), `renderProjectPanel`, `mvpRenderFolderGrid` (Spent and Cover) and the folder-detail count. `tests/purchase-screens.test.js` runs the real Expenses module: 7 of 8 checks fail on revision 2, and all pass now |
| 2 | Deletion can stop half-way; a fully discounted purchase has no rows to guard | **Confirmed.** `deleteFolder` deletes period by period, batch by batch, and a zero-value purchase writes no expense row. | `pur_live_purchases()` is asked **before the confirm and before anything is removed**, on both delete paths; a failed check also deletes nothing. Database triggers on `folders` and `projects` refuse the delete **before** the cascade, reading the purchase **lines**, so zero-value purchases count |
| 3 | Void-and-re-record doubles stock | **Confirmed.** R8 recommended that workflow. | `pur_replace`: the old purchase is voided and the new one recorded in ONE transaction. The old stock moves are carried to the new lines of the same item. Tested in PGlite, with two sessions (race 8) and in live acceptance L |
| 4 | Reads ignore the Expenses scope; the stock match is not company-scoped | **Confirmed.** Testing also caught a bug in my first fix: the read rule returned *null* for accounts with no module list, which hid purchases from **everyone**. It was rewritten. | Every purchase table's read rule also requires `pur_reader()`, the same rule as recording. Stock: the company's own item first, else an unowned one, never another company's |
| 5 | Concurrent changes to the same purchase could hold stale project locks | **Confirmed.** Two-session test 7 shows revision 2 holding project A's lock while the purchase had moved to B. | `pur_purchase_lock()` is taken before the projects are looked up, in `pur_correct`, `pur_refund`, `pur_void` and `pur_replace`. Tests 6 and 7 |

### Execution reviews (15 October 2026)

Each task was reviewed after it was built, then the whole change once more. Everything found was fixed before this revision, and each fix was shown to fail on the old code first:

| Review | Found | Fix |
|---|---|---|
| Task 1 | Replacing a purchase could add stock twice when one item sat on several lines | Old stock moves are paired to new lines by item **and** position (`row_number()` per item) |
| Task 1 | A quantity of `NaN` was accepted | `pur_qty()`: digits with up to 3 decimals, else `BAD_QUANTITY`; Dacs Web rounds to 3 decimals first |
| Task 1 | Staff could move a line to the warehouse through a replace; non-canonical ids took different locks; bad dates, numbers and ids gave raw errors | Replace keeps staff lines where they were; lock keys use canonical ids (`pur_uuid()`); `BAD_DATE` / `BAD_LINES` / `BAD_PROJECT` |
| Task 2 | Deleting a project could stop half-way when one of its **Additional Works jobs** had a live purchase | `pur_live_purchases()` counts the jobs too; Project Control's job delete asks first |
| Task 2 | The period view counted a no-period row twice; some server codes showed raw | The period view skips no-period rows; plain messages, else the server's hint |
| Final | A Cover row could sit on **another month's** client period and use up that month's client money | Cover goes to a Cover period or a client period of the purchase month only; otherwise it is tied to the project (R3) |
| Final | Additional Works jobs of a completed project were open to staff; a retried save claimed the edited form was saved; dead browser stock code | The parent's completion counts; a replayed answer carries `replayed: true` and Dacs Web says the later changes were not applied; the old stock writer is deleted |

## Rulings for review (choices the spec left to the plan)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| R1 | **Every category** in Add expense records through `pur_record`. Labor stays on payroll, which is unchanged. | It is one form; two funding rules in one form would drift. | A non-material category also follows purchase-month funding. Easy to narrow later. |
| R2 | Remaining fund = budget − **all** expense rows (Cover-flagged included) − all payroll on that period, as Dacs Web computes it today. | Spec §3.3 says "exactly as Dacs Web does today". | None; behaviour is identical. |
| R3 | **Where a Cover row goes:** the project's Cover (president) period, that month's first, else the latest. If there is none, a client period of **that month only** with `cover_expense = true`, earliest billing number first — never another month's client period (final review, 15 Oct). **With no Cover period and no billing period in the purchase month, the row is tied to the project** (`folder_id`). | The spec's "Cover link" plus the 14 Oct decision. | Where a Cover peso is shown, never whether it counts. |
| R4 | **Office review flag** = no client period **with a budget** that month (Q23), or no period at all. | The spec's eligibility excludes "periods with no budget". | Only the flag; the money is the same. |
| R5 | **Additional Works with no period at all are refused** (`AW_NO_PERIOD`). The parent Main Contract is never charged, and an AW cost is never Cover (Q24). Dacs Web always provisions an AW period, so this cannot happen from the form. | Q24's no-cap rule; the 14 Oct no-period decision was for Main Contract. **Revisit for phone buyers in 2A-3.** | A refused save for an AW job with no period. |
| R6 | **Completed project:** staff are refused when recording, correcting, re-funding, replacing or voiding — on the project **and on its Additional Works jobs**; the owner may. There is no approval queue yet (2A-2). | "Completed is the only lock" (12 Oct). | Staff ask the owner until 2A-2. |
| R7 | **Moving a line to another project**, in a correction or a replacement, is **owner-only**. | "Main-owner approved". | Same as R6. |
| R8 | A correction keeps the **same number of lines**. To add or drop a line, **replace** the purchase (`pur_replace`): in one transaction the old one is voided (`replaced_by`) and its stock carried over. A separate void plus a new record would move stock again, so use replace. | Keeps line identity stable; stock never doubles. | None. |
| R9 | **Old expense rows are not converted.** Rows without a purchase link keep today's edit and delete exactly. | No back-fill of history. | Old staff Cover rows stay as they are. |
| R10 | **A project or period with a live purchase cannot be deleted.** Dacs Web asks `pur_live_purchases()` before the confirm and before removing anything; it counts the project's **Additional Works jobs** too (they cascade-delete with it), and Project Control's Additional Works delete asks it as well. Triggers on `folders` and `projects` refuse it before the cascade, reading purchase lines, so zero-value purchases count. **After voiding, it deletes**, and history keeps `folder_name`. **One narrow gap remains:** a purchase recorded in the seconds between the check and the delete. The database still refuses that purchase's own project and period, but periods already deleted in that same run stay deleted. The existing WorkMate-requests check has the same gap. | Decided 14–15 Oct. | Very unlikely; the database still protects the purchase itself. |
| R11 | `pur_record` returns the rows it wrote (period, amount, Cover), **never budget numbers**. Staff see no peso amounts in messages. | The staff no-amounts rule. | None. |
| R12 | **Deploy order:** apply 0096 **before** pushing the web change. There is **no fallback** to the old browser split. | Two funding rules must never run side by side. | A failed save ("The server is not updated for purchases yet"), never a wrong one. |
| R13 | **SQL test tools live only in `supabase/tests`** (their own `package.json`). `npm run test:sql` installs them there with no lockfile and runs both suites. CI runs it. `npm test` stays zero-dependency. | CI proves the money rules and the races. The app never ships the test tools. | About a minute more CI. A new CI dependency on npm and the embedded-postgres binaries. |
| R14 | The **actual purchase date** = the date part of the form's date/time. With no date, it is today, built from local parts. A `date_time` whose date differs is refused. | §3.3 step 1. | None. |
| R15 | A fee share's category is the category of that project's largest line. | So the category charts keep the fee beside its goods. | Cosmetic. |
| R16 | The Edit modal for a purchase row shows the **line's full amount**, hides the funding-source picker and requires a reason. Several-line or fee purchases are refused there; none exist until 2A-3. **Re-funding after a period is added** is `pur_refund`. From Dacs Web in 2A-1, the office re-funds by saving the row's Edit form unchanged with a reason. A one-click button comes in 2A-2. | The server re-funds the whole line. | One extra step for the office until 2A-2. |
| R17 | Staff no longer see the pink "will be recorded as Cover" banner, nor the list's budget-based Cover tags. Both were always wrong for them. | The server funds it. | None. |
| R18 | **Stock** ("track in inventory") is added by the recording, by exact item name, **within the company**: its own item first, else an unowned legacy item, and a new item gets the company as owner. It happens once per line (`purchase_stock_moves`). A correction or void does **not** change stock (that is 2B); a replacement carries it over. | Overlapping saves, retries and replacements can never double stock. | A wrong quantity needs a manual stock adjustment until 2B. |
| R19 | **Locks**, all **before any write**, in this order: the operation's lock; for a change to an existing purchase, **that purchase's lock**, taken before its projects are read; then each project and stock item it touches, as advisory locks sorted by lock number. Nobody takes a purchase lock after a project lock, so there is no cycle. | Proven by the two-session tests: no deadlock, no double spend, no stale project list. | None found. |
| R20 | **No-period rows in the screens:** <br>• **Project Control:** project cards, project detail, Additional Works cards and the Billing Periods total all count them, with a note under the period cards (amount owner-only). <br>• **Expenses:** the dashboard and overview cards, folder list, Budget Overview folder cards and folder detail add them (`_expNoPeriodSpent`); the folder view loads them. <br>• **Reports:** the shared report model (Reports, KPI, the three prints, CSV) adds them to Material, Spent and Cover, with a "No billing period (Cover)" line like "Unallocated Indirect". <br>A single period's receipt does **not** include them. | Every Spent site counts the cost once, as decided. | A missed site would under-count. The money test and the screen test fence them. |
| R21 | **Reading** purchases (all five purchase tables) needs `pur_reader()`: an active owner or staff account allowed the Expenses section, the same rule as recording. | Decided 15 Oct. | A module-focused office account sees no purchases (intended). |

**Out of scope (later 2A parts):**
- The Purchasing tab, Buyer switch, review queue, one-click re-fund and a "replace" screen (**2A-2**).
- Phone screens (**2A-3**).
- Payments, Unpaid/Paid badges, Overpaid and petty cash (**2A-4**).
- Stock receiving and corrections (**2B**). Cost moves (**2C**).

## File map

| File | Change | Task |
|---|---|---|
| `supabase/migrations/0096_purchase_recording.sql` | **New.** Tables, row and delete guards, read rule, locks, funding, stock, the five operations, the delete pre-check, grants | 1 |
| `supabase/tests/2a1_purchase.pglite.mjs` | **New.** 45 behaviour tests on PostgreSQL in memory (migration loaded verbatim) | 1 |
| `supabase/tests/2a1_concurrency.mjs` | **New.** 10 checks with two real sessions at once (embedded PostgreSQL) | 1 |
| `supabase/tests/package.json` | **New.** The SQL test tools, installed here only | 1 |
| `package.json` | `test:sql`; `purchase-server` and `purchase-screens` added to `npm test` | 1 |
| `tests/purchase-server.test.js` | **New.** 27 static checks: grants, locks before writes, purchase lock, guards, read rule, Cover subset and month, stock, web routing, replays, every Spent site, delete pre-checks (Additional Works included), error messages | 2 |
| `tests/purchase-screens.test.js` | **New.** 8 checks running the real Expenses module: the no-period cost in the dashboard, overview cards, folder list, folder cards and detail; deleting asks first and removes nothing | 2 |
| `js/expenses-module.js` | Purchases helpers; `handleAddExpense` → `pur_record` (no browser stock); edit → `pur_correct`; delete → `pur_void`; list tags; staff banner and Cover guess; folder view, report model, dashboard, folder list, folder cards and detail read no-period rows; CSV and print line; delete pre-checks | 2 |
| `js/portal-app.compiled.js` | No-period rows in project cards, project detail, AW cards, the Billing Periods total and a note | 2 |
| `admin.html` | "Reason for the change" field in Edit Expense | 2 |
| `tests/receipt-save-paths.test.js` | Add expense now records a purchase; no browser stock | 2 |
| `tests/money-math.test.js` | **§P**: purchase rows are read like any expense row; a no-period row counts once at every Spent site | 2 |
| `tests/billing-allocation.test.js` | Its fake database answers the new no-period query with nothing | 2 |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md` | Next number 0097, the 0096 entry, schema section, module map | 3 |
| `supabase/tests/2a1_acceptance.sql` | **New.** Live checks A–N, self-wrapped in `begin … rollback` | 3 |
| `.github/workflows/ci.yml` | The SQL step | 3 |

`Client Management.html` and `Dacs Partnership.html` are not touched: the expense forms live only in `admin.html`, and clients never read purchases. CLAUDE.md and AGENTS.md already carry the agreed rule (applied 14 Oct, outside these tasks).

---

### Task 1: Migration 0096 and its behaviour and race tests

**Files:**
- Create: `supabase/migrations/0096_purchase_recording.sql`, `supabase/tests/2a1_purchase.pglite.mjs`, `supabase/tests/2a1_concurrency.mjs`, `supabase/tests/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces (SQL, granted to `authenticated`):
  - `pur_record(p_op uuid, p_body jsonb) → jsonb {purchase_id, rows:[{line|fee, period_id (null = no period), amount, cover}], needs_review:[line_no], stock_moves}`
  - `pur_correct(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) → jsonb` (the same shape, without `stock_moves`)
  - `pur_refund(p_op uuid, p_purchase uuid, p_reason text) → jsonb` (the same)
  - `pur_void(p_op uuid, p_purchase uuid, p_reason text) → jsonb {purchase_id, status:'void'}`
  - `pur_replace(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) → jsonb` (the new purchase, shaped like `pur_record`)
  - `pur_live_purchases(p_folder uuid, p_period uuid) → int`, asked before deleting
  - `pur_reader() → boolean`, the read rule
- `p_body` fields:
  - `purchase_date` (YYYY-MM-DD), `date_time`, `supplier`, `receipt_total`, `notes`, `payment_method`, `source` (`expenses_form`; `workmate` is refused)
  - `docs` {`po_image_url`, `delivery_receipt_url`, `supplier_invoice_url`, `payment_receipt_url`}
  - `lines` [{`destination` 'project'|'warehouse', `folder_id`, `item_name`, `category`, `quantity`, `unit`, `amount`, `in_inventory`, `min_stock`}]
  - `charges` [{`kind` 'delivery_fee'|'discount', `amount`, `shares` [{`line`, `amount`}]}]
- Errors (`P0001`, the message is the code): `NOT_OFFICE`, `NOT_ALLOWED`, `BUYER_REQUIRED`, `BAD_OP`, `BAD_DATE`, `BAD_AMOUNT`, `BAD_NAME`, `BAD_QUANTITY`, `BAD_LINES`, `BAD_CHARGES`, `BAD_SOURCE`, `BAD_PROJECT`, `BAD_DESTINATION`, `COMPLETED_PROJECT`, `SPLIT_MISMATCH`, `DISCOUNT_TOO_LARGE`, `TOTAL_MISMATCH`, `AW_NO_PERIOD`, `REASON_REQUIRED`, `NOT_FOUND`, `BAD_STATE`, `LINES_CHANGED`, `OWNER_APPROVAL_NEEDED`, `PURCHASE_ROW` (row guard), `PURCHASES_LIVE` (delete guard).
- New columns:
  - `expenses.purchase_line_id`, `purchase_charge_id`, `folder_id` → camelCase `purchaseLineId`, `purchaseChargeId`, `folderId` through the shim (no `REG` entry needed).
  - `purchases.replaced_by`.

- [ ] **Step 1: The SQL test tools' own package, and the scripts in `package.json`.**

**New file `supabase/tests/package.json`:**

````json
{
  "name": "dacs-sql-tests",
  "private": true,
  "description": "Test-only tools for the SQL suites (npm run test:sql). Installed here, never into the app.",
  "type": "module",
  "dependencies": {
    "@electric-sql/pglite": "0.2.17",
    "embedded-postgres": "17.5.0-beta.15",
    "pg": "8.13.1"
  }
}
````

**Edit 1 of 1 — `package.json`.** Find:

````text
{
  "scripts": {
    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js",
    "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
    "build:watch": "npm run build",
    "build:prod": "npm run build"
  },
  "devDependencies": {
    "esbuild": "^0.28.0",
````

Replace with:

````text
{
  "scripts": {
    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js",
    "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
    "build:watch": "npm run build",
    "build:prod": "npm run build",
    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs"
  },
  "devDependencies": {
    "esbuild": "^0.28.0",
````

- [ ] **Step 2: Write the behaviour tests first.**

**New file `supabase/tests/2a1_purchase.pglite.mjs`:**

````js
// ════════════════════════════════════════════════════════════════════
// STAGE 2A-1 PURCHASE RECORDING — BEHAVIOUR TESTS ON A LOCAL POSTGRES
//   npm run test:sql      (needs the dev dependency @electric-sql/pglite)
//
// Runs migration 0096 VERBATIM on PGlite (PostgreSQL 16 in memory) over a
// minimal copy of the tables it touches: folders, projects, project_budgets,
// expenses, payroll, profiles — with the real role helpers lifted from 0002
// and 0094. Nothing here talks to the live database. The live acceptance
// script (supabase/tests/2a1_acceptance.sql) repeats the key cases there.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const MIG = process.env.DACS_0096 || path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const fnText = (src, name) => {
  const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found');
  return m[0];
};

const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));

const BASE = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id) on delete cascade, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null,
  monthly_budget numeric not null default 0);
create table expenses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false,
  split_group text, split_index int, split_total int, client_submission_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  total_salary numeric, cover_expense boolean default false);
create table inventory (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid,
  created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}
`;

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const OTHER = '00000000-0000-0000-0000-00000000000d';
const PMONLY = '00000000-0000-0000-0000-00000000000e';
const EXPSTAFF = '00000000-0000-0000-0000-00000000000f';
let opSeq = 0;
const op = () => '10000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

// One fresh database per test: base schema + 0096 + the people.
async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(read(MIG));
  await db.exec(`insert into profiles values
    ('${OWNER}', 'owner', null, 'active', null), ('${STAFF}', 'staff', '${OWNER}', 'active', null),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null), ('${OTHER}', 'owner', null, 'active', null),
    ('${PMONLY}', 'staff', '${OWNER}', 'active', '["pm"]'::jsonb),
    ('${EXPSTAFF}', 'staff', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb);`);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
const num = (x) => Number(x);

async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function period(db, folderId, month, year, opts = {}) {
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number, created_at)
                              values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [opts.owner || OWNER, folderId, month, year, opts.president ? 'president' : 'progress',
     opts.billing ?? null, opts.created || new Date(Date.now() + (opts.order || 0) * 1000).toISOString()])).id;
  if (opts.budget != null) await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, opts.budgetOwner || opts.owner || OWNER, opts.budget]);
  return id;
}
async function spend(db, periodId, amount) {
  await db.query(`insert into expenses (owner_id, project_id, expense_name, amount) values ($1, $2, 'earlier', $3)`, [OWNER, periodId, amount]);
}
function body(lines, extra = {}) {
  const total = extra.receipt_total ?? lines.reduce((s, l) => s + l.amount, 0)
    + (extra.charges || []).reduce((s, c) => s + (c.kind === 'delivery_fee' ? c.amount : -c.amount), 0);
  return { source: 'expenses_form', purchase_date: '2026-10-14', date_time: '2026-10-14T09:30', supplier: 'Wilcon',
           notes: '', payment_method: 'CASH', docs: {}, ...extra, receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', quantity: 1, ...l })) };
}
async function record(db, b, opId = op()) {
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [opId, JSON.stringify(b)])).r;
}
async function rows(db, periodId) {
  return (await all(db, `select amount, cover_expense, expense_name from expenses where project_id = $1 and purchase_line_id is not null order by split_index nulls first`, [periodId]))
    .map(r => ({ amount: num(r.amount), cover: r.cover_expense, name: r.expense_name }));
}
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}

console.log('\n2A-1 purchase recording (0096 on PGlite)');

await test('§3.3 example: ₱8,000 on 14 Oct → ₱3,000 + ₱4,000 + ₱1,000 Cover (earliest billing number first)', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'Barlin');
  const p1 = await period(db, f, 'October', 2026, { billing: 1, budget: 5000 });
  const p2 = await period(db, f, 'October', 2026, { billing: 2, budget: 4000 });
  const cover = await period(db, f, 'October', 2026, { president: true });
  await spend(db, p1, 2000);
  const r = await record(db, body([{ folder_id: f, item_name: 'Cement', amount: 8000 }]));
  eq(await rows(db, p1), [{ amount: 3000, cover: false, name: 'Cement (1/3)' }]);
  eq(await rows(db, p2), [{ amount: 4000, cover: false, name: 'Cement (2/3)' }]);
  eq(await rows(db, cover), [{ amount: 1000, cover: true, name: 'Cement (3/3)' }]);
  eq(r.needs_review, []);
  const total = await one(db, `select sum(amount) s from expenses where purchase_line_id is not null`);
  eq(num(total.s), 8000, 'Spent counts the purchase once; Cover is part of it');
});

await test('earliest billing number wins even when a later period has less left (not "lowest remaining first")', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const p2 = await period(db, f, 'October', 2026, { billing: 2, budget: 1000, order: 1 });
  const p1 = await period(db, f, 'October', 2026, { billing: 1, budget: 9000, order: 2 });
  await record(db, body([{ folder_id: f, item_name: 'Sand', amount: 500 }]));
  eq(await rows(db, p1), [{ amount: 500, cover: false, name: 'Sand' }]);
  eq(await rows(db, p2), []);
});

await test('never another month: September money is not used for an October purchase', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const sep = await period(db, f, 'September', 2026, { billing: 1, budget: 50000 });
  const oct = await period(db, f, 'October', 2026, { billing: 2, budget: 100 });
  await record(db, body([{ folder_id: f, item_name: 'Paint', amount: 300 }]));
  eq(await rows(db, sep), []);
  eq(await rows(db, oct), [{ amount: 100, cover: false, name: 'Paint (1/2)' }, { amount: 200, cover: true, name: 'Paint (2/2)' }],
     'no Cover period → the shortage sits on the same-month client period, flagged cover');
});

await test('Q23: no period that month → all Cover on the latest Cover period, flagged for office review', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'August', 2026, { billing: 1, budget: 10000 });
  const septCover = await period(db, f, 'September', 2026, { president: true });
  const r = await record(db, body([{ folder_id: f, item_name: 'Tiles', amount: 2500 }]));
  eq(await rows(db, septCover), [{ amount: 2500, cover: true, name: 'Tiles' }]);
  eq(r.needs_review, [1]);
  eq((await one(db, `select needs_funding_review v from purchase_lines`)).v, true);
});

await test("Q23 without any Cover period → tied to the project, flagged cover — never another month's client period", async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const aug = await period(db, f, 'August', 2026, { billing: 1, budget: 10000 });
  const sept = await period(db, f, 'September', 2026, { billing: 2, budget: 10000 });
  const r = await record(db, body([{ folder_id: f, item_name: 'Tiles', amount: 100 }]));
  eq(await rows(db, sept), [], "September's client period is not used");
  eq(await rows(db, aug), [], "August's client period is not used");
  const e = await all(db, `select project_id, folder_id, cover_expense, amount from expenses where purchase_line_id is not null`);
  eq(e.map(x => [x.project_id, x.folder_id, x.cover_expense, num(x.amount)]), [[null, f, true, 100]]);
  eq(r.needs_review, [1]);
});

await test("a Cover row never sits on another month's client period: a December purchase leaves October's money alone", async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const oct = await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  const dec = { purchase_date: '2026-12-02', date_time: '2026-12-02T09:00' };
  const r = await record(db, body([{ folder_id: f, item_name: 'Dec item', amount: 300 }], dec));
  const e = await all(db, `select project_id, folder_id, cover_expense, amount from expenses where purchase_line_id is not null`);
  eq(e.map(x => [x.project_id, x.folder_id, x.cover_expense, num(x.amount)]), [[null, f, true, 300]],
     'ONE Cover row tied to the project (no Cover period, no December period)');
  eq((await one(db, `select needs_funding_review v from purchase_lines`)).v, true, 'flagged for office review');
  eq(r.needs_review, [1]);
  eq(num((await one(db, `select pur_period_remaining($1) n`, [oct])).n), 1000, 'October still has all its ₱1,000');
  await record(db, body([{ folder_id: f, item_name: 'Oct item', amount: 1000 }], { purchase_date: '2026-10-20', date_time: '2026-10-20T09:00' }));
  eq(await rows(db, oct), [{ amount: 1000, cover: false, name: 'Oct item' }], 'the October purchase is funded ₱1,000 from October, no Cover');
  eq(num((await one(db, `select coalesce(sum(amount), 0) s from expenses where cover_expense`)).s), 300, 'Cover = only the December ₱300 fronted');
});

await test('…but with a Cover (president) period in November, a December shortage still goes to that Cover period', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const oct = await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  const novCover = await period(db, f, 'November', 2026, { president: true });
  const r = await record(db, body([{ folder_id: f, item_name: 'Dec item', amount: 300 }], { purchase_date: '2026-12-02', date_time: '2026-12-02T09:00' }));
  eq(await rows(db, novCover), [{ amount: 300, cover: true, name: 'Dec item' }], 'parked on the Cover period (it carries no client budget)');
  eq(await rows(db, oct), []);
  eq(num((await one(db, `select count(*) n from expenses where folder_id is not null`)).n), 0, 'not tied to the project');
  eq(r.needs_review, [1]);
  eq(num((await one(db, `select pur_period_remaining($1) n`, [oct])).n), 1000, 'October untouched');
});

await test('a period with no budget, and Cover periods, are never funding sources', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const zero = await period(db, f, 'October', 2026, { billing: 1, budget: 0 });
  const r = await record(db, body([{ folder_id: f, item_name: 'Wire', amount: 50 }]));
  eq(await rows(db, zero), [{ amount: 50, cover: true, name: 'Wire' }]);
  eq(r.needs_review, [1], 'only a zero-budget period that month counts as no eligible period');
});

await test('remaining = budget − expenses − payroll (exactly as Dacs Web)', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const p1 = await period(db, f, 'October', 2026, { billing: 1, budget: 10000 });
  await spend(db, p1, 1000);
  await db.query(`insert into payroll (owner_id, project_id, total_salary) values ($1, $2, 8500)`, [OWNER, p1]);
  await record(db, body([{ folder_id: f, item_name: 'Nails', amount: 700 }]));
  eq(await rows(db, p1), [{ amount: 500, cover: false, name: 'Nails (1/2)' }, { amount: 200, cover: true, name: 'Nails (2/2)' }]);
});

await test('Q24: Additional Works → its own period in full, no cap, never Cover', async () => {
  const db = await fresh(); await as(db, OWNER);
  const main = await folder(db, 'Main');
  await period(db, main, 'October', 2026, { billing: 1, budget: 999999 });
  const aw = await folder(db, 'Gazebo', { parent: main });
  const awp = await period(db, aw, 'September', 2026, {});
  await record(db, body([{ folder_id: aw, item_name: 'Lumber', amount: 22000 }]));
  eq(await rows(db, awp), [{ amount: 22000, cover: false, name: 'Lumber' }]);
  eq((await one(db, `select count(*) n from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [main])).n, 0, 'parent Main Contract untouched');
});

await test('two lines on one project: the second sees what the first used', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const p1 = await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  await record(db, body([{ folder_id: f, item_name: 'A', amount: 800 }, { folder_id: f, item_name: 'B', amount: 500 }]));
  const r = await all(db, `select l.line_no, e.amount, e.cover_expense from expenses e join purchase_lines l on l.id = e.purchase_line_id order by l.line_no, e.cover_expense`);
  eq(r.map(x => [x.line_no, num(x.amount), x.cover_expense]), [[1, 800, false], [2, 200, false], [2, 300, true]]);
});

await test('Q4: ₱200 delivery fee over ₱3,000 (A) + ₱1,000 (B) → A ₱150, B ₱50 "Delivery fee (share)" rows', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A'), b = await folder(db, 'B');
  const pa = await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  const pb = await period(db, b, 'October', 2026, { billing: 1, budget: 100000 });
  await record(db, body([{ folder_id: a, item_name: 'Pipe', amount: 3000 }, { folder_id: b, item_name: 'Pipe', amount: 1000 }],
                        { charges: [{ kind: 'delivery_fee', amount: 200 }] }));
  const fees = await all(db, `select project_id, amount, expense_name from expenses where purchase_charge_id is not null order by amount desc`);
  eq(fees.map(x => [x.project_id, num(x.amount), x.expense_name]), [[pa, 150, 'Delivery fee (share)'], [pb, 50, 'Delivery fee (share)']]);
});

await test('rounding: a ₱100 fee over three equal lines → 33.34 + 33.33 + 33.33 (remainder to the largest, first on a tie)', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A'), b = await folder(db, 'B'), c = await folder(db, 'C');
  for (const f of [a, b, c]) await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }, { folder_id: b, item_name: 'x', amount: 10 }, { folder_id: c, item_name: 'x', amount: 10 }],
                        { charges: [{ kind: 'delivery_fee', amount: 100 }] }));
  const s = await all(db, `select s.amount from purchase_charge_shares s join purchase_lines l on l.id = s.line_id order by l.line_no`);
  eq(s.map(x => num(x.amount)), [33.34, 33.33, 33.33]);
});

await test('given shares must add up to the charge; a fee on a warehouse line writes no row', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  const bad = body([{ folder_id: a, item_name: 'x', amount: 100 }], { charges: [{ kind: 'delivery_fee', amount: 20, shares: [{ line: 1, amount: 19 }] }] });
  assert((await code(record(db, bad))).includes('SPLIT_MISMATCH'), 'shares ≠ charge must be refused');
  const ok = body([{ folder_id: a, item_name: 'x', amount: 100 }, { destination: 'warehouse', item_name: 'stock', amount: 100 }],
                  { charges: [{ kind: 'delivery_fee', amount: 20, shares: [{ line: 1, amount: 5 }, { line: 2, amount: 15 }] }] });
  await record(db, ok);
  eq((await all(db, `select amount from expenses where purchase_charge_id is not null`)).map(x => num(x.amount)), [5]);
  eq(num((await one(db, `select count(*) n from expenses where purchase_line_id is not null`)).n), 1, 'the warehouse line writes no expense row');
});

await test('discount reduces the line before funding; never a negative row; totals must match', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  const p = await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  await record(db, body([{ folder_id: a, item_name: 'Rebar', amount: 1000 }], { charges: [{ kind: 'discount', amount: 100 }] }));
  eq(await rows(db, p), [{ amount: 900, cover: false, name: 'Rebar' }]);
  eq(num((await one(db, `select count(*) n from expenses where amount < 0`)).n), 0);
  const tooBig = body([{ folder_id: a, item_name: 'x', amount: 50 }, { folder_id: a, item_name: 'y', amount: 500 }],
                      { charges: [{ kind: 'discount', amount: 60, shares: [{ line: 1, amount: 60 }] }] });
  assert((await code(record(db, tooBig))).includes('DISCOUNT_TOO_LARGE'), 'a discount above its line must be refused');
  const mismatch = body([{ folder_id: a, item_name: 'x', amount: 50 }], { receipt_total: 51 });
  assert((await code(record(db, mismatch))).includes('TOTAL_MISMATCH'), 'lines + fees − discounts must equal the receipt');
});

await test('a retry with the same operation id records once and returns the first answer', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  const id = op();
  const r1 = await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }]), id);
  const r2 = await record(db, body([{ folder_id: a, item_name: 'CHANGED', amount: 99 }]), id);
  eq(r2.replayed, true, 'the replay is marked, so the form can say the edits were not saved');
  eq(r1.replayed, undefined, 'the first answer is not marked');
  const { replayed, ...firstAnswer } = r2;
  eq(firstAnswer, r1, 'otherwise it is the first answer');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 1);
  eq(num((await one(db, `select sum(amount) s from expenses`)).s), 10);
});

await test('staff are funded from budgets they cannot see (not everything Cover)', async () => {
  const db = await fresh(); await as(db, STAFF);
  const a = await folder(db, 'A');
  const p = await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  await record(db, body([{ folder_id: a, item_name: 'x', amount: 400 }]));
  eq(await rows(db, p), [{ amount: 400, cover: false, name: 'x' }]);
  eq((await one(db, `select recorded_by, owner_id from purchases`)), { recorded_by: STAFF, owner_id: OWNER });
});

await test('only office accounts record; another owner\'s project is refused; the actual date must match date_time', async () => {
  const db = await fresh();
  const a = await folder(db, 'A');
  await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  await as(db, WORKER);
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }])))).includes('NOT_OFFICE'), 'worker must be refused');
  await as(db, OTHER);
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }])))).includes('BAD_PROJECT'), 'other owner must be refused');
  await as(db, OWNER);
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }], { date_time: '2026-11-02T08:00' })))).includes('BAD_DATE'), 'date mismatch must be refused');
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1.005 }])))).includes('BAD_AMOUNT'), 'sub-centavo amount must be refused');
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: -1 }], { receipt_total: 0 })))).includes('BAD_AMOUNT'), 'negative amount must be refused');
});

await test('month names: "Oct", "10" and " october " all match October', async () => {
  for (const m of ['Oct', '10', ' october ']) {
    const db = await fresh(); await as(db, OWNER);
    const a = await folder(db, 'A');
    const p = await period(db, a, m, 2026, { billing: 1, budget: 1000 });
    await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }]));
    eq(await rows(db, p), [{ amount: 10, cover: false, name: 'x' }], 'month ' + JSON.stringify(m));
  }
});

await test('completed project: staff refused, owner allowed (completed is the only lock)', async () => {
  const db = await fresh();
  const a = await folder(db, 'A', { completed: true });
  await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  await as(db, STAFF);
  assert((await code(record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }])))).includes('COMPLETED_PROJECT'), 'staff must be refused');
  await as(db, OWNER);
  await record(db, body([{ folder_id: a, item_name: 'x', amount: 1 }]));
});

await test('completed project: an Additional Works job under it is locked too — staff refused, owner allowed', async () => {
  const db = await fresh();
  const main = await folder(db, 'Main', { completed: true });
  const aw = await folder(db, 'Gazebo', { parent: main });
  await period(db, aw, 'October', 2026, { billing: 1 });
  await as(db, STAFF);
  assert((await code(record(db, body([{ folder_id: aw, item_name: 'x', amount: 1 }])))).includes('COMPLETED_PROJECT'),
         'staff must be refused on an AW job of a completed project');
  await as(db, OWNER);
  const r = await record(db, body([{ folder_id: aw, item_name: 'x', amount: 1 }]));
  await as(db, STAFF);
  assert((await code(one(db, `select pur_void($1, $2, 'fix') r`, [op(), r.purchase_id]))).includes('COMPLETED_PROJECT'),
         'staff must be refused a void on it too (pur_open)');
  await as(db, OWNER);
  await one(db, `select pur_void($1, $2, 'fix') r`, [op(), r.purchase_id]);
});

await test('purchase rows change only through the purchase; ordinary rows are untouched', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  const p = await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  await spend(db, p, 5);
  await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }]));
  assert((await code(db.query(`update expenses set amount = 1 where purchase_line_id is not null`))).includes('PURCHASE_ROW'), 'update must be refused');
  assert((await code(db.query(`delete from expenses where purchase_line_id is not null`))).includes('PURCHASE_ROW'), 'delete must be refused');
  const line = (await one(db, `select id from purchase_lines`)).id;
  assert((await code(db.query(`insert into expenses (owner_id, project_id, amount, purchase_line_id) values ($1, $2, 1, $3)`, [OWNER, p, line]))).includes('PURCHASE_ROW'), 'insert must be refused');
  await db.query(`update expenses set amount = 6 where purchase_line_id is null`);
  await db.query(`delete from expenses where purchase_line_id is null`);
});

await test('correction: Spent changes by exactly the difference; history keeps before and after', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  const p1 = await period(db, a, 'October', 2026, { billing: 1, budget: 5000 });
  const cover = await period(db, a, 'October', 2026, { president: true });
  const r = await record(db, body([{ folder_id: a, item_name: 'Cement', amount: 4000 }]));
  const before = num((await one(db, `select sum(amount) s from expenses`)).s);
  await one(db, `select pur_correct($1, $2, $3::jsonb, 'wrong amount') r`, [op(), r.purchase_id, JSON.stringify(body([{ folder_id: a, item_name: 'Cement', amount: 6000 }]))]);
  eq(num((await one(db, `select sum(amount) s from expenses`)).s) - before, 2000);
  eq(await rows(db, p1), [{ amount: 5000, cover: false, name: 'Cement (1/2)' }]);
  eq(await rows(db, cover), [{ amount: 1000, cover: true, name: 'Cement (2/2)' }]);
  const h = await all(db, `select kind, reason, before->'lines'->0->>'amount' b, after->'lines'->0->>'amount' a from purchase_history order by id`);
  eq(h.map(x => [x.kind, x.reason, x.b, x.a]), [['recorded', '', null, '4000.00'], ['corrected', 'wrong amount', '4000.00', '6000.00']]);
});

await test('correction rules: a reason is required, lines cannot be added, staff cannot move a line to another project', async () => {
  const db = await fresh(); await as(db, STAFF);
  const a = await folder(db, 'A'), b = await folder(db, 'B');
  await period(db, a, 'October', 2026, { billing: 1, budget: 5000 });
  await period(db, b, 'October', 2026, { billing: 1, budget: 5000 });
  const r = await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }]));
  const corr = (bd, reason = 'fix') => one(db, `select pur_correct($1, $2, $3::jsonb, $4) r`, [op(), r.purchase_id, JSON.stringify(bd), reason]);
  assert((await code(corr(body([{ folder_id: a, item_name: 'x', amount: 11 }]), ' '))).includes('REASON_REQUIRED'), 'reason');
  assert((await code(corr(body([{ folder_id: a, item_name: 'x', amount: 5 }, { folder_id: a, item_name: 'y', amount: 5 }])))).includes('LINES_CHANGED'), 'lines');
  assert((await code(corr(body([{ folder_id: b, item_name: 'x', amount: 10 }])))).includes('OWNER_APPROVAL_NEEDED'), 'move');
  await as(db, OWNER);
  await corr(body([{ folder_id: b, item_name: 'x', amount: 10 }]));
  eq(num((await one(db, `select count(*) n from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [b])).n), 1, 'owner may move it');
});

await test('void: rows leave Spent; purchase, receipt and history stay; a second void is refused', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  await period(db, a, 'October', 2026, { billing: 1, budget: 5000 });
  const r = await record(db, body([{ folder_id: a, item_name: 'x', amount: 10 }], { docs: { supplier_invoice_url: 'https://x/si.jpg', evil: 'nope' } }));
  eq((await one(db, `select supplier_invoice_url u from expenses`)).u, 'https://x/si.jpg', 'receipt on the first row');
  await one(db, `select pur_void($1, $2, 'duplicate entry') r`, [op(), r.purchase_id]);
  eq(num((await one(db, `select count(*) n from expenses`)).n), 0);
  eq(await one(db, `select status, docs from purchases`), { status: 'void', docs: { supplier_invoice_url: 'https://x/si.jpg' } });
  eq((await all(db, `select kind from purchase_history order by id`)).map(x => x.kind), ['recorded', 'voided']);
  assert((await code(one(db, `select pur_void($1, $2, 'again') r`, [op(), r.purchase_id]))).includes('BAD_STATE'), 'second void');
});

await test('a correction recomputes against the CURRENT remaining fund (its own old rows released first)', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A');
  const p1 = await period(db, a, 'October', 2026, { billing: 1, budget: 1000 });
  const r = await record(db, body([{ folder_id: a, item_name: 'x', amount: 1000 }]));
  await one(db, `select pur_correct($1, $2, $3::jsonb, 'typo') r`, [op(), r.purchase_id, JSON.stringify(body([{ folder_id: a, item_name: 'x', amount: 900 }]))]);
  eq(await rows(db, p1), [{ amount: 900, cover: false, name: 'x' }], 'not pushed to Cover by its own earlier rows');
});

await test('NO billing period at all: kept, counted at once as Cover tied to the project, flagged — no period invented', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'Empty');
  const r = await record(db, body([{ folder_id: f, item_name: 'Rebar', amount: 1500 }]));
  eq(r.needs_review, [1]);
  eq(r.rows.map(x => [x.period_id, num(x.amount), x.cover]), [[null, 1500, true]]);
  const e = await one(db, `select project_id, folder_id, cover_expense, amount from expenses where purchase_line_id is not null`);
  eq([e.project_id, e.folder_id, e.cover_expense, num(e.amount)], [null, f, true, 1500]);
  eq(num((await one(db, `select count(*) n from projects`)).n), 0, 'no period was invented');
});

await test('re-fund after the office adds a period: same purchase date, same total, moved once, review cleared', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'Empty');
  const r = await record(db, body([{ folder_id: f, item_name: 'Rebar', amount: 1500 }]));
  const p = await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  const cover = await period(db, f, 'October', 2026, { president: true });
  const rr = (await one(db, `select pur_refund($1, $2, 'billing period added') r`, [op(), r.purchase_id])).r;
  eq(rr.needs_review, []);
  eq(await rows(db, p), [{ amount: 1000, cover: false, name: 'Rebar (1/2)' }]);
  eq(await rows(db, cover), [{ amount: 500, cover: true, name: 'Rebar (2/2)' }]);
  eq(num((await one(db, `select sum(amount) s from expenses`)).s), 1500, 'total Spent unchanged');
  eq(num((await one(db, `select count(*) n from expenses where folder_id is not null`)).n), 0, 'the no-period row is gone');
  eq((await one(db, `select purchase_date::text d from purchases`)).d, '2026-10-14');
  eq((await all(db, `select kind from purchase_history order by id`)).map(x => x.kind), ['recorded', 'refunded']);
  assert((await code(one(db, `select pur_refund($1, $2, ' ') r`, [op(), r.purchase_id]))).includes('REASON_REQUIRED'), 'reason');
});

await test("links stay inside the company and project: another owner's period, budget or Cover period is never used", async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  // Wrong company on the period, on its budget, or on both — and a foreign Cover period.
  const foreignBoth = await period(db, f, 'October', 2026, { billing: 1, budget: 99999, owner: OTHER });
  const foreignPeriod = await period(db, f, 'October', 2026, { billing: 1, budget: 99999, owner: OTHER, budgetOwner: OWNER });
  // Our own period with a foreign budget row: never a funding source (billing #3, after ours, so Cover never lands on it either).
  const foreignBudget = await period(db, f, 'October', 2026, { billing: 3, budget: 99999, budgetOwner: OTHER });
  const foreignCover = await period(db, f, 'October', 2026, { president: true, owner: OTHER });
  const mine = await period(db, f, 'October', 2026, { billing: 2, budget: 100 });
  await record(db, body([{ folder_id: f, item_name: 'x', amount: 150 }]));
  for (const p of [foreignBoth, foreignPeriod, foreignBudget, foreignCover]) eq(await rows(db, p), [], 'a foreign period was used');
  eq(await rows(db, mine), [{ amount: 100, cover: false, name: 'x (1/2)' }, { amount: 50, cover: true, name: 'x (2/2)' }]);
});

await test('small fees never overcharge: ₱0.03 over five equal lines → exactly ₱0.03, no negative share', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  const lines = [1, 2, 3, 4, 5].map(i => ({ folder_id: f, item_name: 'x' + i, amount: 10 }));
  await record(db, body(lines, { charges: [{ kind: 'delivery_fee', amount: 0.03 }] }));
  const sh = (await all(db, `select s.amount from purchase_charge_shares s join purchase_lines l on l.id = s.line_id order by l.line_no`)).map(x => num(x.amount));
  eq(sh, [0.01, 0.01, 0.01]);
  eq(num((await one(db, `select sum(amount) s from expenses where purchase_charge_id is not null`)).s), 0.03);
  const p7 = (await one(db, `select pur_prorate(1, array[1,1,1,1,1,1,1]::numeric[]) s`)).s.map(Number);
  eq(p7, [0.15, 0.15, 0.14, 0.14, 0.14, 0.14, 0.14], '₱1 over 7: one leftover centavo each, earliest first');
  const p3 = (await one(db, `select pur_prorate(0.05, array[1,1,1]::numeric[]) s`)).s.map(Number);
  eq(p3, [0.02, 0.02, 0.01]);
});

await test('Expenses access only: a PM-focused account is refused; phone purchasing needs the Buyer switch', async () => {
  const db = await fresh();
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  await as(db, PMONLY);
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }])))).includes('NOT_ALLOWED'), 'PM-only refused');
  await as(db, EXPSTAFF);
  await record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }]));
  await as(db, OWNER);
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }], { source: 'workmate' })))).includes('BUYER_REQUIRED'), 'workmate refused');
});

await test('stock: added inside the purchase, once per line — retries, corrections and a repeat call add nothing', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  await db.query(`insert into inventory (item_name, unit, current_stock, min_stock) values ('Cement', 'bag', 5, 0)`);
  const id = op();
  const lines = (cement) => [{ folder_id: f, item_name: 'Cement', amount: cement, quantity: 10, in_inventory: true },
                             { folder_id: f, item_name: 'New Pipe', amount: 50, quantity: 3, unit: 'pc', in_inventory: true, min_stock: 2 }];
  const r1 = await record(db, body(lines(100)), id);
  eq(r1.stock_moves, 2);
  const r2 = await record(db, body(lines(100)), id);
  eq(r2.replayed, true, 'a retry is marked replayed');
  const { replayed, ...firstAnswer } = r2;
  eq(firstAnswer, r1, 'a retry returns the first answer');
  const inv = async () => (await all(db, `select item_name, current_stock, min_stock, unit from inventory order by item_name`))
    .map(x => [x.item_name, num(x.current_stock), num(x.min_stock), x.unit]);
  eq(await inv(), [['Cement', 15, 0, 'bag'], ['New Pipe', 3, 2, 'pc']]);
  await one(db, `select pur_correct($1, $2, $3::jsonb, 'fix price') r`, [op(), r1.purchase_id, JSON.stringify(body(lines(120)))]);
  eq(await inv(), [['Cement', 15, 0, 'bag'], ['New Pipe', 3, 2, 'pc']], 'a correction moves no stock');
  eq(num((await one(db, `select pur_move_stock($1, $2) n`, [r1.purchase_id, OWNER])).n), 0, 'a repeat stock call moves nothing');
  eq(await inv(), [['Cement', 15, 0, 'bag'], ['New Pipe', 3, 2, 'pc']]);
  eq(num((await one(db, `select count(*) n from purchase_stock_moves`)).n), 2);
});

await test('deleting: refused while a purchase is live; after voiding, the project deletes and its history stays readable', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'ZZ delete me');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  const r1 = await record(db, body([{ folder_id: f, item_name: 'x', amount: 10 }]));
  const g = await folder(db, 'ZZ no period');
  const r2 = await record(db, body([{ folder_id: g, item_name: 'y', amount: 20 }]));
  assert((await code(db.query(`delete from folders where id = $1`, [f]))).includes('PURCHASES_LIVE'), 'a live purchase blocks the delete');
  assert((await code(db.query(`delete from folders where id = $1`, [g]))).includes('PURCHASES_LIVE'), 'a live no-period purchase blocks it too');
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r1.purchase_id]);
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r2.purchase_id]);
  await db.query(`delete from folders where id = $1`, [f]);
  await db.query(`delete from folders where id = $1`, [g]);
  eq((await all(db, `select folder_name from purchase_lines order by folder_name`)).map(x => x.folder_name), ['ZZ delete me', 'ZZ no period']);
});

await test('a project-level row cannot be written outside the purchase functions', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  assert((await code(db.query(`insert into expenses (owner_id, folder_id, amount) values ($1, $2, 5)`, [OWNER, f]))).includes('PURCHASE_ROW'), 'insert refused');
});

await test('deleting is refused BEFORE anything is removed — a fully discounted purchase (no expense rows) counts too; the pre-check says so', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'ZZ discounted');
  const p = await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  await spend(db, p, 5);
  const r = await record(db, body([{ folder_id: f, item_name: 'free sample', amount: 10 }], { charges: [{ kind: 'discount', amount: 10 }] }));
  eq(num((await one(db, `select count(*) n from expenses where purchase_line_id is not null`)).n), 0, 'a zero line writes no expense row');
  eq((await one(db, `select pur_live_purchases($1, null) n`, [f])).n, 1, 'the pre-check counts it');
  assert((await code(db.query(`delete from folders where id = $1`, [f]))).includes('PURCHASES_LIVE'), 'the folder delete must be refused');
  eq(num((await one(db, `select count(*) n from expenses where project_id = $1`, [p])).n), 1, 'nothing was removed');
  const q = await period(db, f, 'October', 2026, { billing: 2, budget: 100 });
  const r2 = await record(db, body([{ folder_id: f, item_name: 'x', amount: 150 }]));
  eq((await one(db, `select pur_live_purchases(null, $1) n`, [q])).n, 1, 'the pre-check sees the period that carries a purchase');
  assert((await code(db.query(`delete from projects where id = $1`, [q]))).includes('PURCHASES_LIVE'), 'the period delete must be refused');
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r.purchase_id]);
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r2.purchase_id]);
  eq((await one(db, `select pur_live_purchases($1, $2) n`, [f, q])).n, 0);
  await db.query(`delete from folders where id = $1`, [f]);
});

await test('the pre-check and the delete guard cover Additional Works jobs under a project', async () => {
  const db = await fresh(); await as(db, OWNER);
  const parent = await folder(db, 'ZZ parent');
  const sibling = await folder(db, 'ZZ sibling');
  const child = await folder(db, 'ZZ aw job', { parent });
  await period(db, child, 'October', 2026, { billing: 1, budget: 100 });
  const r = await record(db, body([{ folder_id: child, item_name: 'aw item', amount: 30 }]));
  eq((await one(db, `select pur_live_purchases($1, null) n`, [parent])).n, 1, 'the parent counts the purchase on its job');
  eq((await one(db, `select pur_live_purchases($1, null) n`, [child])).n, 1, 'the job counts it');
  eq((await one(db, `select pur_live_purchases($1, null) n`, [sibling])).n, 0, 'an unrelated project reads 0');
  assert((await code(db.query(`delete from folders where id = $1`, [parent]))).includes('PURCHASES_LIVE'), 'the parent delete is refused');
  await one(db, `select pur_void($1, $2, 'test') r`, [op(), r.purchase_id]);
  eq((await one(db, `select pur_live_purchases($1, null) n`, [parent])).n, 0, 'voided: parent reads 0');
  await db.query(`delete from folders where id = $1`, [parent]);
});

await test('reading purchases needs the same access as recording them: PM-only staff and workers read nothing', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  await record(db, body([{ folder_id: f, item_name: 'x', amount: 10 }], { charges: [{ kind: 'delivery_fee', amount: 2 }] }));
  await db.exec(`grant usage on schema public, auth to authenticated; grant select on all tables in schema public to authenticated;
                 grant execute on all functions in schema auth to authenticated;`);
  const seen = async (uid) => {
    await as(db, uid);
    await db.exec('set role authenticated');
    const n = {};
    for (const t of ['purchases', 'purchase_lines', 'purchase_charges', 'purchase_charge_shares', 'purchase_history'])
      n[t] = num((await one(db, `select count(*) n from ${t}`)).n);
    await db.exec('reset role');
    return Object.values(n).join(',');
  };
  eq(await seen(OWNER), '1,1,1,1,1');
  eq(await seen(EXPSTAFF), '1,1,1,1,1');
  eq(await seen(STAFF), '1,1,1,1,1');
  eq(await seen(PMONLY), '0,0,0,0,0', 'a PM-only account must read nothing');
  eq(await seen(WORKER), '0,0,0,0,0');
  eq(await seen(OTHER), '0,0,0,0,0', 'another company reads nothing');
});

await test("stock stays inside the company: its own item first, else an unowned one, never another company's", async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  await db.query(`insert into inventory (owner_id, item_name, unit, current_stock, min_stock) values ($1, 'Cement', 'bag', 100, 0), (null, 'Wire', 'roll', 7, 0)`, [OTHER]);
  await record(db, body([{ folder_id: f, item_name: 'Cement', amount: 10, quantity: 4, in_inventory: true },
                         { folder_id: f, item_name: 'Wire', amount: 10, quantity: 1, in_inventory: true }]));
  const inv = (await all(db, `select owner_id, item_name, current_stock from inventory order by item_name, owner_id nulls first`))
    .map(x => [x.owner_id, x.item_name, num(x.current_stock)]);
  eq(inv, [[OWNER, 'Cement', 4], [OTHER, 'Cement', 100], [null, 'Wire', 8]], 'another company\'s Cement untouched; the unowned Wire used');
});

await test('replace: a different number of lines, one transaction — old voided, new recorded, stock never added twice', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  const p = await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  const r = await record(db, body([{ folder_id: f, item_name: 'Cement', amount: 400, quantity: 10, in_inventory: true }]));
  const stock = async () => (await all(db, `select item_name, current_stock from inventory order by item_name`)).map(x => [x.item_name, num(x.current_stock)]);
  eq(await stock(), [['Cement', 10]]);
  const nb = body([{ folder_id: f, item_name: 'Cement', amount: 400, quantity: 10, in_inventory: true },
                   { folder_id: f, item_name: 'Sand', amount: 100, quantity: 5, in_inventory: true }]);
  const rr = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the sand') r`, [op(), r.purchase_id, JSON.stringify(nb)])).r;
  eq(await stock(), [['Cement', 10], ['Sand', 5]], 'Cement carried over, not added again; only Sand is new');
  eq(rr.stock_moves, 1);
  eq(await one(db, `select status, replaced_by from purchases where id = $1`, [r.purchase_id]), { status: 'void', replaced_by: rr.purchase_id });
  eq(num((await one(db, `select sum(amount) s from expenses where project_id = $1`, [p])).s), 500, 'Spent = the new purchase only');
  eq((await all(db, `select kind from purchase_history where purchase_id = $1 order by id`, [r.purchase_id])).map(x => x.kind), ['recorded', 'replaced']);
  assert((await code(one(db, `select pur_replace($1, $2, $3::jsonb, 'again') r`, [op(), r.purchase_id, JSON.stringify(nb)]))).includes('BAD_STATE'), 'the old one is closed');
  // Staff may not move a cost to another project through a replacement either.
  const g = await folder(db, 'B');
  await period(db, g, 'October', 2026, { billing: 1, budget: 100000 });
  await as(db, STAFF);
  const moved = body([{ folder_id: g, item_name: 'Cement', amount: 400, quantity: 10, in_inventory: true }]);
  assert((await code(one(db, `select pur_replace($1, $2, $3::jsonb, 'move') r`, [op(), rr.purchase_id, JSON.stringify(moved)]))).includes('OWNER_APPROVAL_NEEDED'), 'staff move');
});

await test('replace: one item on several lines — each old stock move is carried to its own new line, never added twice', async () => {
  const db = await fresh(); await as(db, OWNER);
  const a = await folder(db, 'A'), b = await folder(db, 'B');
  await period(db, a, 'October', 2026, { billing: 1, budget: 100000 });
  await period(db, b, 'October', 2026, { billing: 1, budget: 100000 });
  const line = (f, name, amt, q) => ({ folder_id: f, item_name: name, amount: amt, quantity: q, in_inventory: true });
  const r = await record(db, body([line(a, 'Cement', 400, 10), line(b, 'Cement', 200, 5)]));
  const stock = async () => (await all(db, `select item_name, current_stock from inventory order by item_name`)).map(x => [x.item_name, num(x.current_stock)]);
  eq(await stock(), [['Cement', 15]]);
  const nb = body([line(a, 'Cement', 400, 10), line(b, 'Cement', 200, 5), line(a, 'Sand', 30, 3)]);
  await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot the sand') r`, [op(), r.purchase_id, JSON.stringify(nb)]);
  eq(await stock(), [['Cement', 15], ['Sand', 3]], 'Cement stays 15; only Sand is new');
});

await test('quantity and min_stock are plain decimals: NaN, Infinity, text, negative and zero are refused and inventory is untouched', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  await db.query(`insert into inventory (item_name, unit, current_stock, min_stock) values ('Wire', 'roll', 7, 0)`);
  for (const q of ['NaN', 'Infinity', 'abc', '-1', '0', '1.2345']) {
    const c = await code(record(db, body([{ folder_id: f, item_name: 'Wire', amount: 5, quantity: q, in_inventory: true }])));
    assert(c.includes('BAD_QUANTITY'), 'quantity ' + q + ' gave ' + c);
  }
  const c2 = await code(record(db, body([{ folder_id: f, item_name: 'Wire', amount: 5, quantity: 1, min_stock: 'NaN', in_inventory: true }])));
  assert(c2.includes('BAD_QUANTITY'), 'min_stock NaN gave ' + c2);
  eq((await all(db, `select item_name, current_stock from inventory`)).map(x => [x.item_name, num(x.current_stock)]), [['Wire', 7]]);
  eq(num((await one(db, `select count(*) n from purchases`)).n), 0);
});

await test('replace by staff: a project line cannot be moved to the warehouse (same rule as a correction)', async () => {
  const db = await fresh(); await as(db, STAFF);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100000 });
  const r = await record(db, body([{ folder_id: f, item_name: 'x', amount: 10 }]));
  const wh = body([{ destination: 'warehouse', item_name: 'x', amount: 10 }]);
  assert((await code(one(db, `select pur_replace($1, $2, $3::jsonb, 'move') r`, [op(), r.purchase_id, JSON.stringify(wh)]))).includes('OWNER_APPROVAL_NEEDED'), 'staff move to warehouse');
  eq(num((await one(db, `select sum(amount) s from expenses`)).s), 10, 'the cost stays in Spent');
  await as(db, OWNER);
  await one(db, `select pur_replace($1, $2, $3::jsonb, 'move') r`, [op(), r.purchase_id, JSON.stringify(wh)]);
});

await test('lock keys use the canonical uuid; an invalid project id is BAD_PROJECT', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  const keys = async (id) => (await one(db, `select pur_body_keys($1::jsonb) k`, [JSON.stringify({ lines: [{ folder_id: id }] })])).k;
  eq(await keys(f.toUpperCase()), await keys(f.toLowerCase()), 'upper and lower case must lock the same project');
  eq(await keys('{' + f + '}'), await keys(f), 'brace-wrapped too');
  for (const bad of ['not-a-uuid', '12345']) {
    assert((await code(record(db, body([{ folder_id: bad, item_name: 'x', amount: 1 }])))).includes('BAD_PROJECT'), 'folder_id ' + bad);
  }
  await record(db, body([{ folder_id: f.toUpperCase(), item_name: 'x', amount: 1 }]));
});

await test('malformed input keeps to the error codes: 2026-02-31 is BAD_DATE, a non-boolean in_inventory is BAD_LINES', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 100 });
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1 }], { purchase_date: '2026-02-31', date_time: '' })))).includes('BAD_DATE'), 'impossible date');
  assert((await code(record(db, body([{ folder_id: f, item_name: 'x', amount: 1, in_inventory: 'maybe' }])))).includes('BAD_LINES'), 'in_inventory maybe');
});

await test('completed project: staff are refused for correct, refund, void and replace; the owner may', async () => {
  const db = await fresh(); await as(db, OWNER);
  const f = await folder(db, 'A');
  await period(db, f, 'October', 2026, { billing: 1, budget: 1000 });
  const r = await record(db, body([{ folder_id: f, item_name: 'x', amount: 10 }]));
  await db.query(`update folders set completed_at = now() where id = $1`, [f]);
  const b = JSON.stringify(body([{ folder_id: f, item_name: 'x', amount: 12 }]));
  const calls = {
    correct: () => one(db, `select pur_correct($1, $2, $3::jsonb, 'fix') r`, [op(), r.purchase_id, b]),
    refund: () => one(db, `select pur_refund($1, $2, 'fix') r`, [op(), r.purchase_id]),
    void: () => one(db, `select pur_void($1, $2, 'fix') r`, [op(), r.purchase_id]),
    replace: () => one(db, `select pur_replace($1, $2, $3::jsonb, 'fix') r`, [op(), r.purchase_id, b]),
  };
  await as(db, STAFF);
  for (const [k, fn] of Object.entries(calls)) assert((await code(fn())).includes('COMPLETED_PROJECT'), 'staff ' + k);
  await as(db, OWNER);
  await calls.correct();
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

- [ ] **Step 3: Write the two-session race tests.**

**New file `supabase/tests/2a1_concurrency.mjs`:**

````js
// ════════════════════════════════════════════════════════════════════
// STAGE 2A-1 PURCHASE RECORDING — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2a1_purchase.pglite.mjs)
//
// PGlite has one connection, so races need a real server: embedded-postgres
// starts a throwaway PostgreSQL on this machine (or the CI runner), loads
// migration 0096 VERBATIM over the same minimal tables, and fires pairs of
// calls on two connections at the same moment. Nothing touches the live DB.
//   1. two purchases on the SAME project        → no deadlock, fund never overspent
//   2. A+B against B+A                          → no deadlock
//   3. the same operation id twice at once      → one purchase, stock once, same answer
//   4. a correction against a new purchase      → no deadlock
//   5. two purchases adding to a NEW stock item → one stock item, both quantities
//   6. two corrections of the SAME purchase      → one after the other, one set of rows
//   7. a correction that waited                 → holds the CURRENT project's lock, not a stale one
//   8. a replacement against a new purchase     → no deadlock, stock never added twice
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const MIG = process.env.DACS_0096 || path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const fnText = (src, name) => {
  const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found');
  return m[0];
};
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));

const OWNER = '00000000-0000-0000-0000-00000000000a';
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2a1-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2A-1 purchase recording — two sessions at once (0096 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id), completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int, created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null, monthly_budget numeric not null default 0);
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false, split_group text, split_index int, split_total int,
  client_submission_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade, total_salary numeric);
create table inventory (id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid, created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}
insert into profiles values ('${OWNER}', 'owner', null, 'active', null);`);
  await admin.query(read(MIG));

  const mkFolder = async (name, budget) => {
    const f = (await admin.query(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).rows[0].id;
    const p = (await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                  values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [OWNER, f])).rows[0].id;
    await admin.query(`insert into project_budgets values ($1, $2, $3)`, [p, OWNER, budget]);
    await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type) values ($1, $2, 'October', 2026, 'president')`, [OWNER, f]);
    return f;
  };
  const body = (lines) => JSON.stringify({ purchase_date: '2026-10-14',
    receipt_total: lines.reduce((s, l) => s + l.amount, 0), lines });
  const session = async () => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${OWNER}', false)`);
    return c;
  };
  // Two calls, each in its own transaction, released together.
  async function pair(sqlA, argsA, sqlB, argsB) {
    const [a, b] = [await session(), await session()];
    const run = async (c, sql, args) => {
      try {
        await c.query('begin');
        const r = await c.query(sql, args);
        await c.query('select pg_sleep(0.03)');
        await c.query('commit');
        return { ok: true, r: r.rows[0] && r.rows[0].r };
      } catch (e) {
        try { await c.query('rollback'); } catch {}
        return { ok: false, code: e.code, msg: e.message };
      }
    };
    const out = await Promise.all([run(a, sqlA, argsA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const REC = `select pur_record(gen_random_uuid(), $1::jsonb) r`;

  // 1. Same project, both at once: no deadlock, the fund is never overspent.
  {
    const f = await mkFolder('same', 1000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const out = await pair(REC, [body([{ folder_id: f, item_name: 'x', amount: 40 }])], REC, [body([{ folder_id: f, item_name: 'y', amount: 40 }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    check('1. two purchases on the same project: no deadlock, no error', bad.length === 0, JSON.stringify([...new Set(bad)]));
    const t = (await admin.query(`select coalesce(sum(e.amount) filter (where not e.cover_expense), 0) n, coalesce(sum(e.amount) filter (where e.cover_expense), 0) c
                                    from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [f])).rows[0];
    check('1. the period gives exactly its ₱1,000, the rest is Cover', Number(t.n) === 1000 && Number(t.c) === ROUNDS * 80 - 1000,
          'non-cover ' + t.n + ', cover ' + t.c);
  }

  // 2. Crossed order: A+B against B+A.
  {
    const a = await mkFolder('A', 100000), b = await mkFolder('B', 100000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const out = await pair(REC, [body([{ folder_id: a, item_name: 'x', amount: 5 }, { folder_id: b, item_name: 'x', amount: 5 }])],
                             REC, [body([{ folder_id: b, item_name: 'y', amount: 5 }, { folder_id: a, item_name: 'y', amount: 5 }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    check('2. A+B against B+A: no deadlock, no error', bad.length === 0, JSON.stringify([...new Set(bad)]));
  }

  // 3. The same operation id twice at once (an overlapping save / interrupted retry).
  {
    const f = await mkFolder('op', 100000);
    let bad = [], same = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const id = '20000000-0000-0000-0000-' + String(i).padStart(12, '0');
      const b = body([{ folder_id: f, item_name: 'Op Stock ' + i, amount: 10, quantity: 4, in_inventory: true }]);
      const out = await pair(`select pur_record($1, $2::jsonb) r`, [id, b], `select pur_record($1, $2::jsonb) r`, [id, b]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
      // Same purchase; exactly one of the two is the replay (marked "replayed").
      if (out.every(o => o.ok) && out[0].r.purchase_id === out[1].r.purchase_id
          && out.filter(o => o.r.replayed === true).length === 1) same++;
    }
    check('3. same operation id at once: both succeed with the same answer', bad.length === 0 && same === ROUNDS,
          'same ' + same + '/' + ROUNDS + ' ' + JSON.stringify([...new Set(bad)]));
    const n = (await admin.query(`select count(*) n from purchase_lines l join purchases pu on pu.id = l.purchase_id where l.folder_id = $1`, [f])).rows[0].n;
    const stock = (await admin.query(`select count(*) n, coalesce(sum(current_stock), 0) s from inventory where item_name like 'Op Stock %'`)).rows[0];
    check('3. recorded once, stock moved once', Number(n) === ROUNDS && Number(stock.n) === ROUNDS && Number(stock.s) === ROUNDS * 4,
          'lines ' + n + ', stock items ' + stock.n + ', stock ' + stock.s);
  }

  // 4. A correction (old project A → new project B, owner) against a new purchase on B then A.
  {
    const a = await mkFolder('CA', 100000), b = await mkFolder('CB', 100000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const rec = (await (async () => { const c = await session(); const r = await c.query(REC, [body([{ folder_id: a, item_name: 'm', amount: 7 }])]); await c.end(); return r.rows[0].r; })());
      const out = await pair(`select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'move') r`, [rec.purchase_id, body([{ folder_id: b, item_name: 'm', amount: 7 }])],
                             REC, [body([{ folder_id: b, item_name: 'n', amount: 3 }, { folder_id: a, item_name: 'n', amount: 3 }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    check('4. a correction against a new purchase: no deadlock, no error', bad.length === 0, JSON.stringify([...new Set(bad)]));
  }

  // 5. Two purchases adding to the same NEW stock item at once.
  {
    const f = await mkFolder('stock', 100000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const name = 'Fresh Item ' + i;
      const out = await pair(REC, [body([{ folder_id: f, item_name: name, amount: 1, quantity: 2, in_inventory: true }])],
                             REC, [body([{ folder_id: f, item_name: name, amount: 1, quantity: 5, in_inventory: true }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    const s = (await admin.query(`select count(*) n, count(distinct item_name) d, coalesce(sum(current_stock), 0) s from inventory where item_name like 'Fresh Item %'`)).rows[0];
    check('5. same new stock item at once: one item each, both quantities', bad.length === 0 && Number(s.n) === ROUNDS && Number(s.d) === ROUNDS && Number(s.s) === ROUNDS * 7,
          'items ' + s.n + ', stock ' + s.s + ' ' + JSON.stringify([...new Set(bad)]));
  }
  // 6. Two corrections of the SAME purchase at once: one after the other,
  //    each on the purchase as the other left it — one set of rows remains.
  {
    const a = await mkFolder('SA', 100000), b = await mkFolder('SB', 100000), c = await mkFolder('SC', 100000);
    let bad = [], clean = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const s0 = await session();
      const rec = (await s0.query(REC, [body([{ folder_id: a, item_name: 'same' + i, amount: 9 }])])).rows[0].r;
      await s0.end();
      const out = await pair(`select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'to B') r`, [rec.purchase_id, body([{ folder_id: b, item_name: 'same' + i, amount: 9 }])],
                             `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'to C') r`, [rec.purchase_id, body([{ folder_id: c, item_name: 'same' + i, amount: 9 }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
      const left = (await admin.query(`select count(*) n, coalesce(sum(e.amount), 0) s, count(distinct p.folder_id) f
                                         from expenses e join purchase_lines l on l.id = e.purchase_line_id
                                         join projects p on p.id = e.project_id where l.purchase_id = $1`, [rec.purchase_id])).rows[0];
      if (Number(left.n) === 1 && Number(left.s) === 9 && Number(left.f) === 1) clean++;
    }
    check('6. two corrections of the same purchase at once: no error, one set of rows left', bad.length === 0 && clean === ROUNDS,
          'clean ' + clean + '/' + ROUNDS + ' ' + JSON.stringify([...new Set(bad)]));
  }

  // 7. A correction that WAITED holds the lock of the purchase's CURRENT
  //    project (the one the first correction moved it to), not a stale one.
  {
    const a = await mkFolder('LA', 100000), b = await mkFolder('LB', 100000), c = await mkFolder('LC', 100000);
    const s0 = await session();
    const rec = (await s0.query(REC, [body([{ folder_id: a, item_name: 'locked', amount: 5 }])])).rows[0].r;
    await s0.end();
    const [t1, t2] = [await session(), await session()];
    const pid2 = (await t2.query('select pg_backend_pid() p')).rows[0].p;
    await t1.query('begin');
    await t1.query(`select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'to B') r`, [rec.purchase_id, body([{ folder_id: b, item_name: 'locked', amount: 5 }])]);
    await t2.query('begin');
    const waiting = t2.query(`select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'to C') r`, [rec.purchase_id, body([{ folder_id: c, item_name: 'locked', amount: 5 }])]);
    await new Promise(r => setTimeout(r, 300));
    await t1.query('commit');
    await waiting;
    const held = async (folder) => Number((await admin.query(
      `select count(*) n from pg_locks l, (select hashtextextended('pur_folder:' || $2, 0) k) x
        where l.locktype = 'advisory' and l.pid = $1 and l.granted
          and l.classid::bigint = ((x.k >> 32) & 4294967295) and l.objid::bigint = (x.k & 4294967295)`, [pid2, folder])).rows[0].n);
    const holdsB = await held(b), holdsC = await held(c), holdsA = await held(a);
    await t2.query('commit');
    await t1.end(); await t2.end();
    check('7. a waiting correction locks the purchase\'s current project (B) and the new one (C), not the stale one (A)',
          holdsB === 1 && holdsC === 1 && holdsA === 0, 'A ' + holdsA + ', B ' + holdsB + ', C ' + holdsC);
  }

  // 8. A replacement against a new purchase on the same project and stock item.
  {
    const f = await mkFolder('RP', 100000);
    let bad = [];
    for (let i = 0; i < ROUNDS; i++) {
      const s0 = await session();
      const rec = (await s0.query(REC, [body([{ folder_id: f, item_name: 'Rep Item ' + i, amount: 4, quantity: 2, in_inventory: true }])])).rows[0].r;
      await s0.end();
      const out = await pair(`select pur_replace(gen_random_uuid(), $1, $2::jsonb, 'add line') r`, [rec.purchase_id,
                               body([{ folder_id: f, item_name: 'Rep Item ' + i, amount: 4, quantity: 2, in_inventory: true }, { folder_id: f, item_name: 'Rep Extra ' + i, amount: 1 }])],
                             REC, [body([{ folder_id: f, item_name: 'Rep Item ' + i, amount: 3, quantity: 5, in_inventory: true }])]);
      bad = bad.concat(out.filter(o => !o.ok).map(o => o.code + ' ' + o.msg));
    }
    const s = (await admin.query(`select count(*) n, coalesce(sum(current_stock), 0) s from inventory where item_name like 'Rep Item %'`)).rows[0];
    check('8. a replacement against a new purchase: no deadlock; stock = first 2 + new 5, never the replaced 2 again',
          bad.length === 0 && Number(s.n) === ROUNDS && Number(s.s) === ROUNDS * 7, 'items ' + s.n + ', stock ' + s.s + ' ' + JSON.stringify([...new Set(bad)]));
  }
} finally {
  await admin.end();
  await server.stop();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

- [ ] **Step 4: Run them. They fail because the migration does not exist yet.**

Run: `npm run test:sql`
Expected: the tools install into `supabase/tests/node_modules` (no lockfile), then FAIL: `Error: ENOENT: no such file or directory, open '…/supabase/migrations/0096_purchase_recording.sql'`.

- [ ] **Step 5: Write the migration.**

**New file `supabase/migrations/0096_purchase_recording.sql`:**

````sql
-- 0096 — WorkMate Stage 2A-1: one purchase recording operation.
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- Section 3 (money rules, agreed 12 October 2026); plan
-- docs/superpowers/plans/2026-10-14-workmate-stage2a1-purchase-recording.md.
--
-- ── 1. Purchases. A purchase (one receipt) has lines — each for a project
--    (Main Contract or an Additional Works folder) or the warehouse — and
--    optional delivery-fee / discount charges shared across its lines.
--    Purchase, payment and receipt are separate facts; this migration records
--    only the purchase. Payments come later and never touch Spent (§3.5).
--
-- ── 2. Purchases become ordinary expense rows (§3.2). A project line is
--    charged by writing `expenses` rows linked back to it (a fee share to its
--    charge), so Project Control, Reports, print and CSV keep reading one
--    table. Warehouse lines write NO rows: company stock cost, outside every
--    project's Spent until an owner-approved cost assignment (2C).
--
-- ── 3. Funding (§3.3): the ACTUAL purchase month. A Main Contract line
--    charges that month's client periods with a budget, earliest billing
--    number first, each up to its remaining fund (budget − expenses − payroll
--    already charged to it, exactly as Dacs Web computes it). A shortage goes
--    to Cover; never another month. No eligible period that month → the whole
--    amount is Cover and the line is flagged for office review. A project with
--    NO billing period at all still counts the cost at once: the row is tied
--    to the project (expenses.folder_id, no period), Cover, flagged — no
--    period or client allocation is ever invented. Additional Works lines
--    charge their own period in full, no cap (Q24). Cover rows carry
--    cover_expense = true, so Cover stays a SUBSET of Spent.
--
-- ── 4. Only through the purchase. Expense rows made by a purchase are
--    written, corrected, re-funded and voided only by these functions; a
--    trigger refuses any other insert, update or delete of such a row.
--
-- ── 5. Retry- and race-safe. Each call carries an operation id; the first
--    answer is kept in pur_ops and returned on retry, marked
--    "replayed": true. Every lock a
--    call needs (its operation, each project it charges, each stock item it
--    adds to) is taken at the start, in one fixed order, before anything is
--    written — so two simultaneous purchases wait for each other instead of
--    deadlocking or spending the same remaining fund twice.
--
-- ── 6. Stock. The "also track in inventory" tick adds the bought quantity
--    to `inventory` INSIDE the recording transaction, once per purchase line:
--    purchase_stock_moves (one row per line, primary key) refuses a second
--    move, so neither a retry nor an overlapping save can add stock twice.
--    Stock items are matched within the company (its own items, or the
--    unowned ones the old browser mirror wrote). Replacing a purchase
--    (pur_replace) carries the stock already moved over to the new lines, so
--    void-and-record never adds it twice.
--
-- ── 7. Deleting. A project or billing period with a live purchase cannot be
--    deleted (a database safeguard, checked before anything is removed — a
--    fully discounted purchase with no expense rows counts too). Dacs Web
--    asks pur_live_purchases() first, before deleting anything.
--
-- Who: active owner/staff accounts allowed the Expenses section (a
-- module-focused account such as admin-pm@ = ["pm"] is refused) — for
-- recording AND for reading purchases. Changes to one purchase are taken
-- one at a time (a per-purchase lock BEFORE its projects are looked up). Phone
-- purchasing (source 'workmate') is refused until the Buyer switch exists
-- (Stage 2A-2): Expenses access never grants it. Corrections, re-funds and
-- voids on a COMPLETED project, and moving a line to another project, are
-- main-owner only.

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  source text not null check (source in ('expenses_form', 'workmate')),
  purchase_date date not null,
  date_time text not null default '',
  supplier text not null default '' check (char_length(supplier) <= 200),
  receipt_total numeric(14,2) not null check (receipt_total >= 0),
  notes text not null default '' check (char_length(notes) <= 2000),
  payment_method text not null default '' check (char_length(payment_method) <= 60),
  docs jsonb not null default '{}'::jsonb,
  status text not null default 'recorded' check (status in ('recorded', 'void')),
  replaced_by uuid,
  recorded_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchases_owner on purchases (owner_id, purchase_date desc);

-- folder_id is history, not a foreign key: once every purchase of a project
-- is voided the project may be deleted, and its purchases stay readable
-- (folder_name keeps what it was called). The functions validate it.
create table if not exists purchase_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  line_no int not null check (line_no between 1 and 50),
  destination text not null check (destination in ('project', 'warehouse')),
  folder_id uuid,
  folder_name text not null default '',
  item_name text not null check (char_length(btrim(item_name)) between 1 and 200),
  category text not null default '' check (char_length(category) <= 100),
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default '' check (char_length(unit) <= 30),
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  in_inventory boolean not null default false,
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  needs_funding_review boolean not null default false,
  unique (purchase_id, line_no),
  check ((destination = 'project') = (folder_id is not null))
);
create index if not exists purchase_lines_folder on purchase_lines (folder_id);

create table if not exists purchase_charges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  charge_no int not null check (charge_no between 1 and 10),
  kind text not null check (kind in ('delivery_fee', 'discount')),
  amount numeric(14,2) not null check (amount > 0),
  unique (purchase_id, charge_no)
);

-- How a charge is shared across the purchase's lines. Never negative.
create table if not exists purchase_charge_shares (
  charge_id uuid not null references purchase_charges(id),
  line_id uuid not null references purchase_lines(id),
  amount numeric(14,2) not null check (amount >= 0),
  primary key (charge_id, line_id)
);

-- Recorded / corrected / re-funded / voided, with the content before and after.
create table if not exists purchase_history (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  kind text not null check (kind in ('recorded', 'corrected', 'refunded', 'voided', 'replaced')),
  reason text not null default '',
  before jsonb,
  after jsonb,
  actor_id uuid not null references profiles(id),
  at timestamptz not null default now()
);
create index if not exists purchase_history_purchase on purchase_history (purchase_id, id);

-- The first answer to each operation, returned verbatim on retry.
create table if not exists pur_ops (
  owner_id uuid not null references profiles(id),
  op_id uuid not null,
  actor_id uuid not null references profiles(id),
  kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, op_id)
);

-- One stock move per purchase line, ever (the primary key is the guard).
create table if not exists purchase_stock_moves (
  line_id uuid primary key references purchase_lines(id),
  inventory_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  moved_at timestamptz not null default now()
);

alter table expenses add column if not exists purchase_line_id uuid references purchase_lines(id);
alter table expenses add column if not exists purchase_charge_id uuid references purchase_charges(id);
-- A project's cost when it has NO billing period: tied to the project, no period.
alter table expenses add column if not exists folder_id uuid references folders(id) on delete cascade;
create index if not exists expenses_purchase_line on expenses (purchase_line_id) where purchase_line_id is not null;
create index if not exists expenses_purchase_charge on expenses (purchase_charge_id) where purchase_charge_id is not null;
create index if not exists expenses_folder on expenses (folder_id) where folder_id is not null;

-- Who may READ purchases: the same accounts that may record them — an active
-- owner or staff account allowed the Expenses section. A boolean about the
-- caller only; the policies below call it (callers need EXECUTE on it).
create or replace function pur_reader() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_mods jsonb;
begin
  if auth.uid() is null or not pr_is_office() then
    return false;
  end if;
  select p.allowed_modules into v_mods from profiles p where p.id = auth.uid();
  -- No list, an empty list, or a list that includes Expenses (never null).
  return jsonb_typeof(v_mods) is distinct from 'array' or jsonb_array_length(v_mods) = 0 or v_mods ? 'expenses';
end;
$$;

-- The office reads (owner, or staff of that owner, allowed Expenses); every
-- change goes through the functions below. Clients and workers read nothing.
do $$
declare t text;
begin
  foreach t in array array['purchases', 'purchase_lines', 'purchase_charges', 'purchase_history'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_office_read', t);
    execute format('create policy %I on %I for select using (can_access(owner_id) and pur_reader())', t || '_office_read', t);
  end loop;
end $$;
alter table purchase_charge_shares enable row level security;
drop policy if exists purchase_charge_shares_office_read on purchase_charge_shares;
create policy purchase_charge_shares_office_read on purchase_charge_shares for select
  using (pur_reader() and exists (select 1 from purchase_charges c where c.id = purchase_charge_shares.charge_id and can_access(c.owner_id)));
alter table pur_ops enable row level security;
alter table purchase_stock_moves enable row level security;

-- ════ 2. Only through the purchase ═══════════════════════════════════

-- A purchase-made expense row (or a project-level row with no period) is
-- written only inside the purchase functions, which set dacs.purchase_write
-- for their own transaction.
--
-- Trusting that setting is safe because API clients cannot run SQL or call
-- set_config: PostgREST exposes only the public schema's functions, and from a
-- request it sets only request.* settings. Only the SECURITY DEFINER
-- operations below set it, with is_local = true, so it ends with their
-- transaction. If a public function that runs caller-supplied SQL or
-- set_config is ever added, this guard needs rethinking.
create or replace function pur_guard_expense_row() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('dacs.purchase_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE')
     and (old.purchase_line_id is not null or old.purchase_charge_id is not null or old.folder_id is not null) then
    raise exception 'PURCHASE_ROW' using errcode = 'P0001',
      hint = 'This expense comes from a purchase. Correct or void the purchase instead.';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and (new.purchase_line_id is not null or new.purchase_charge_id is not null or new.folder_id is not null) then
    raise exception 'PURCHASE_ROW' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists expenses_purchase_guard on expenses;
create trigger expenses_purchase_guard before insert or update or delete on expenses
  for each row execute function pur_guard_expense_row();

-- A project (folder) or billing period with a LIVE purchase cannot be deleted.
-- Checked on the project/period row itself, BEFORE its cascade removes
-- anything — and from the purchase lines, so a fully discounted purchase
-- (no expense rows) counts too. Voided purchases never block.
create or replace function pur_guard_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'folders' then
    if exists (select 1 from purchase_lines l join purchases pu on pu.id = l.purchase_id
                where l.folder_id = old.id and pu.status = 'recorded') then
      raise exception 'PURCHASES_LIVE' using errcode = 'P0001',
        hint = 'This project has purchases. Void them first, or mark the project completed.';
    end if;
  elsif exists (select 1 from expenses e
                 where e.project_id = old.id and (e.purchase_line_id is not null or e.purchase_charge_id is not null)) then
    raise exception 'PURCHASES_LIVE' using errcode = 'P0001',
      hint = 'This billing period has purchases. Void them first.';
  end if;
  return old;
end;
$$;
drop trigger if exists folders_purchase_delete_guard on folders;
create trigger folders_purchase_delete_guard before delete on folders
  for each row execute function pur_guard_delete();
drop trigger if exists projects_purchase_delete_guard on projects;
create trigger projects_purchase_delete_guard before delete on projects
  for each row execute function pur_guard_delete();

-- Asked by Dacs Web BEFORE deleting anything: how many live purchases touch
-- this project AND its Additional Works jobs (any of their lines, discounted
-- to zero or not) or this period. The jobs are children that cascade-delete
-- with the project, so a live purchase on one must block the parent too.
create or replace function pur_live_purchases(p_folder uuid, p_period uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null or not pr_is_office() then
    raise exception 'NOT_OFFICE' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select count(distinct pu.id) from purchases pu
           where pu.owner_id = v_owner and pu.status = 'recorded'
             and (exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.folder_id = p_folder)
                  or exists (select 1 from purchase_lines l join folders f on f.id = l.folder_id
                              where l.purchase_id = pu.id and f.parent_folder_id = p_folder)
                  or exists (select 1 from expenses e join purchase_lines l on l.id = e.purchase_line_id
                              where l.purchase_id = pu.id and e.project_id = p_period)
                  or exists (select 1 from expenses e join purchase_charges c on c.id = e.purchase_charge_id
                              where c.purchase_id = pu.id and e.project_id = p_period)));
end;
$$;

-- ════ 3. Locks ═══════════════════════════════════════════════════════

-- Take every lock a call needs at once, in one fixed order (by lock number),
-- before anything is written. Two calls wanting the same project or stock
-- item wait in line; neither can hold one while waiting for the other.
create or replace function pur_lock(p_keys text[]) returns void
language plpgsql security definer set search_path = public as $$
declare k bigint;
begin
  for k in select distinct hashtextextended(x, 0) from unnest(p_keys) x where x is not null order by 1 loop
    perform pg_advisory_xact_lock(k);
  end loop;
end;
$$;

-- A uuid from request text in its canonical form, or null when it is not one
-- (never an exception, so callers can answer with their own error code).
create or replace function pur_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return nullif(btrim(coalesce(p, '')), '')::uuid;
exception when others then
  return null;
end;
$$;

-- The lock keys for a body: each project it charges, each stock item it adds to.
create or replace function pur_body_keys(p_body jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(k), '{}') from (
    select 'pur_folder:' || coalesce(pur_uuid(l ->> 'folder_id')::text, btrim(l ->> 'folder_id')) k
      from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) l
     where coalesce(l ->> 'folder_id', '') <> ''
    union
    select 'pur_stock:' || lower(btrim(l ->> 'item_name'))
      from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) l
     where (l ->> 'in_inventory') = 'true' and coalesce(btrim(l ->> 'item_name'), '') <> ''
  ) x
$$;

-- The project lock keys of a stored purchase.
create or replace function pur_stored_keys(p_purchase uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct 'pur_folder:' || l.folder_id), '{}')
    from purchase_lines l where l.purchase_id = p_purchase and l.folder_id is not null
$$;

-- ════ 4. Funding ═════════════════════════════════════════════════════

-- projects.month is free text ("October"). Full English names, 3-letter
-- abbreviations and numbers all count; anything else matches no month.
create or replace function pur_month_no(p text) returns int
language sql immutable as $$
  select case
    when btrim(coalesce(p, '')) ~ '^\d{1,2}$' and btrim(p)::int between 1 and 12 then btrim(p)::int
    else (select n from (values
            (1, 'january'), (2, 'february'), (3, 'march'), (4, 'april'), (5, 'may'), (6, 'june'),
            (7, 'july'), (8, 'august'), (9, 'september'), (10, 'october'), (11, 'november'), (12, 'december')) m(n, name)
           where lower(btrim(coalesce(p, ''))) in (m.name, left(m.name, 3)))
  end
$$;

-- What a period still has, exactly as Dacs Web computes it today:
-- its fund allocated minus every expense and payroll row charged to it.
create or replace function pur_period_remaining(p_period uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce((select b.monthly_budget from project_budgets b
                          join projects p on p.id = b.project_id and p.owner_id = b.owner_id
                         where b.project_id = p_period), 0)
             - coalesce((select sum(e.amount) from expenses e where e.project_id = p_period), 0)
             - coalesce((select sum(p.total_salary) from payroll p where p.project_id = p_period), 0), 2)
$$;

-- Where a Cover row goes (§3.3 "Cover link"): the project's Cover (president)
-- period when one exists — that month's, else the latest — otherwise a client
-- period of the same project in the purchase month, flagged cover_expense
-- (earliest billing number). Never another month's client period (it would
-- use up that month's client money). Only this company's periods of this
-- project. Never invents a period. Null = no Cover period and no period in
-- that month → the row is tied to the project.
create or replace function pur_cover_period(p_owner uuid, p_folder uuid, p_date date) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from (
    select p.id,
           (p.funding_type = 'president') as cover_period,
           (pur_month_no(p.month) = extract(month from p_date)::int and p.year = extract(year from p_date)::int) as same_month,
           coalesce(p.year, 0) as year, coalesce(pur_month_no(p.month), 0) as month_no, p.billing_number, p.created_at
      from projects p
     where p.folder_id = p_folder and p.owner_id = p_owner
  ) c
  -- A Cover period of any month, or a client period of the purchase month
  -- only (same_month must be TRUE; null — an unreadable month — is not).
  where c.cover_period is true or c.same_month is true
  order by c.cover_period desc,
           c.same_month desc nulls last,
           case when c.same_month then c.billing_number end asc nulls last,
           c.year desc, c.month_no desc, c.billing_number desc nulls last, c.created_at desc, c.id
  limit 1
$$;

-- How one amount for one project on one date is funded. Returns the rows to
-- write: period (null = the project itself: no Cover period and no period
-- in the purchase month), amount,
-- Cover, office review. Callers hold the project's lock (pur_lock).
create or replace function pur_fund(p_owner uuid, p_folder uuid, p_date date, p_amount numeric)
returns table (period_id uuid, amount numeric, cover boolean, review boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_aw boolean;
  v_left numeric := round(p_amount, 2);
  v_p record;
  v_remain numeric;
  v_charge numeric;
  v_any boolean := false;
  v_cover uuid;
begin
  if v_left <= 0 then
    return;
  end if;
  select f.parent_folder_id is not null into v_aw from folders f where f.id = p_folder and f.owner_id = p_owner;
  if v_aw is null then
    raise exception 'BAD_PROJECT' using errcode = 'P0001';
  end if;

  -- Additional Works: its own period, in full, no monthly cap, never Cover (Q24).
  if v_aw then
    select p.id into v_cover
      from projects p
     where p.folder_id = p_folder and p.owner_id = p_owner
     order by (pur_month_no(p.month) = extract(month from p_date)::int and p.year = extract(year from p_date)::int) desc nulls last,
              p.year desc nulls last, pur_month_no(p.month) desc nulls last, p.billing_number desc nulls last, p.created_at desc, p.id
     limit 1;
    if v_cover is null then
      raise exception 'AW_NO_PERIOD' using errcode = 'P0001';
    end if;
    return query select v_cover, v_left, false, false;
    return;
  end if;

  -- Main Contract: this month's client periods, earliest billing number first.
  for v_p in
    select p.id
      from projects p
      join project_budgets b on b.project_id = p.id and b.owner_id = p_owner
     where p.folder_id = p_folder
       and p.owner_id = p_owner
       and coalesce(p.funding_type, 'progress') <> 'president'
       and b.monthly_budget > 0
       and pur_month_no(p.month) = extract(month from p_date)::int
       and p.year = extract(year from p_date)::int
     order by p.billing_number nulls last, p.created_at, p.id
  loop
    v_any := true;
    exit when v_left <= 0;
    v_remain := pur_period_remaining(v_p.id);
    if v_remain > 0 then
      v_charge := least(v_remain, v_left);
      v_left := v_left - v_charge;
      return query select v_p.id, v_charge, false, false;
    end if;
  end loop;

  -- Shortage → Cover. No Cover period and no period in the purchase month →
  -- the project itself (period null), never another month's client period.
  if v_left > 0 then
    v_cover := pur_cover_period(p_owner, p_folder, p_date);
    return query select v_cover, v_left, true, not v_any;
  end if;
end;
$$;

-- ════ 5. Validating and writing a purchase ═══════════════════════════

-- Split a total across weights to the centavo (largest remainder): every
-- share is first rounded DOWN, then the centavos left over go one each to
-- the shares with the biggest remainders (the earliest line on a tie). No
-- share is ever negative, and the shares always add up to the total.
create or replace function pur_prorate(p_total numeric, p_weights numeric[]) returns numeric[]
language plpgsql immutable as $$
declare
  v_n int := coalesce(array_length(p_weights, 1), 0);
  v_sum numeric := 0;
  v_out numeric[] := '{}';
  v_cents int;
  r record;
  i int;
begin
  if v_n = 0 then
    return v_out;
  end if;
  for i in 1 .. v_n loop
    v_sum := v_sum + greatest(p_weights[i], 0);
  end loop;
  if v_sum <= 0 then
    -- No weights: equal shares.
    return pur_prorate(p_total, array_fill(1::numeric, array[v_n]));
  end if;
  for i in 1 .. v_n loop
    v_out := v_out || (floor(p_total * greatest(p_weights[i], 0) / v_sum * 100) / 100);
  end loop;
  v_cents := round((p_total - (select sum(x) from unnest(v_out) x)) * 100)::int;
  for r in
    select i2 as idx
      from generate_series(1, v_n) i2
     order by (p_total * greatest(p_weights[i2], 0) / v_sum * 100) - floor(p_total * greatest(p_weights[i2], 0) / v_sum * 100) desc, i2
     limit v_cents
  loop
    v_out[r.idx] := v_out[r.idx] + 0.01;
  end loop;
  return v_out;
end;
$$;

-- A peso amount from the request: a number with at most two decimals and
-- not negative, else null (the caller refuses it).
create or replace function pur_money(p text) returns numeric
language plpgsql immutable as $$
begin
  if p is null or btrim(p) !~ '^\d+(\.\d{1,2})?$' then
    return null;
  end if;
  return btrim(p)::numeric;
end;
$$;

-- A quantity from the request: a plain number with at most three decimals,
-- not negative (no NaN, Infinity or exponent), else null (the caller refuses it).
create or replace function pur_qty(p text) returns numeric
language plpgsql immutable as $$
begin
  if p is null or btrim(p) !~ '^\d+(\.\d{1,3})?$' then
    return null;
  end if;
  return btrim(p)::numeric;
end;
$$;

-- Who may call: an active owner or staff account (0094) allowed the
-- Expenses section — an account focused on other sections (allowed_modules,
-- e.g. admin-pm@ = ["pm"]) is refused, like the AI gate (0095). Phone
-- purchasing ('workmate') needs the Buyer switch, which arrives in 2A-2:
-- until then it is refused for everyone. Returns the data owner.
create or replace function pur_actor_owner(p_source text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_mods jsonb;
begin
  if auth.uid() is null or not pr_is_office() then
    raise exception 'NOT_OFFICE' using errcode = 'P0001';
  end if;
  select p.allowed_modules into v_mods from profiles p where p.id = auth.uid();
  if jsonb_typeof(v_mods) = 'array' and jsonb_array_length(v_mods) > 0 and not (v_mods ? 'expenses') then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if coalesce(p_source, 'expenses_form') = 'workmate' then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

-- Validate a purchase body and store its lines and charges. Writes no
-- expense rows (pur_charge_rows does).
create or replace function pur_store(p_owner uuid, p_purchase uuid, p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lines jsonb := coalesce(p_body -> 'lines', '[]'::jsonb);
  v_charges jsonb := coalesce(p_body -> 'charges', '[]'::jsonb);
  v_line jsonb;
  v_charge jsonb;
  v_share jsonb;
  v_dest text;
  v_folder uuid;
  v_folder_name text;
  v_amount numeric;
  v_qty numeric;
  v_min numeric;
  v_id uuid;
  v_line_ids uuid[] := '{}';
  v_line_gross numeric[] := '{}';
  v_gross numeric := 0;
  v_fees numeric := 0;
  v_discounts numeric := 0;
  v_shares numeric[];
  v_no int;
  n int := 0;
  c int := 0;
  k int;
begin
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) not between 1 and 50 then
    raise exception 'BAD_LINES' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_charges) is distinct from 'array' or jsonb_array_length(v_charges) > 10 then
    raise exception 'BAD_CHARGES' using errcode = 'P0001';
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    n := n + 1;
    v_dest := coalesce(v_line ->> 'destination', 'project');
    v_folder := pur_uuid(v_line ->> 'folder_id');
    if coalesce(btrim(v_line ->> 'folder_id'), '') <> '' and v_folder is null then
      raise exception 'BAD_PROJECT' using errcode = 'P0001';
    end if;
    v_amount := pur_money(v_line ->> 'amount');
    v_qty := case when v_line ->> 'quantity' is null then 1 else pur_qty(v_line ->> 'quantity') end;
    v_min := case when v_line ->> 'min_stock' is null then 0 else pur_qty(v_line ->> 'min_stock') end;
    if v_amount is null then
      raise exception 'BAD_AMOUNT' using errcode = 'P0001';
    end if;
    if v_line -> 'in_inventory' is not null and jsonb_typeof(v_line -> 'in_inventory') not in ('boolean', 'null') then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    if v_qty is null or v_min is null or v_qty <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'P0001';
    end if;
    if char_length(btrim(coalesce(v_line ->> 'item_name', ''))) not between 1 and 200 then
      raise exception 'BAD_NAME' using errcode = 'P0001';
    end if;
    v_folder_name := '';
    if v_dest = 'project' then
      -- The project must belong to this company.
      select f.name into v_folder_name from folders f where f.id = v_folder and f.owner_id = p_owner;
      if v_folder is null or v_folder_name is null then
        raise exception 'BAD_PROJECT' using errcode = 'P0001';
      end if;
      -- Completion is stamped on the main project: an Additional Works job
      -- under a completed project is locked too.
      if not is_owner() and exists (select 1 from folders f
                                     left join folders par on par.id = f.parent_folder_id
                                    where f.id = v_folder
                                      and (f.completed_at is not null or par.completed_at is not null)) then
        raise exception 'COMPLETED_PROJECT' using errcode = 'P0001';
      end if;
    elsif v_dest = 'warehouse' then
      if v_folder is not null then
        raise exception 'BAD_PROJECT' using errcode = 'P0001';
      end if;
    else
      raise exception 'BAD_DESTINATION' using errcode = 'P0001';
    end if;
    insert into purchase_lines (owner_id, purchase_id, line_no, destination, folder_id, folder_name, item_name, category,
                                quantity, unit, gross_amount, in_inventory, min_stock)
    values (p_owner, p_purchase, n, v_dest, v_folder, coalesce(v_folder_name, ''), btrim(v_line ->> 'item_name'),
            btrim(coalesce(v_line ->> 'category', '')), v_qty, btrim(coalesce(v_line ->> 'unit', '')), v_amount,
            coalesce((v_line ->> 'in_inventory')::boolean, false), v_min)
    returning id into v_id;
    v_line_ids := v_line_ids || v_id;
    v_line_gross := v_line_gross || v_amount;
    v_gross := v_gross + v_amount;
  end loop;

  for v_charge in select value from jsonb_array_elements(v_charges) loop
    c := c + 1;
    v_amount := pur_money(v_charge ->> 'amount');
    if v_amount is null or v_amount = 0 then
      raise exception 'BAD_AMOUNT' using errcode = 'P0001';
    end if;
    if coalesce(v_charge ->> 'kind', '') not in ('delivery_fee', 'discount') then
      raise exception 'BAD_CHARGES' using errcode = 'P0001';
    end if;
    insert into purchase_charges (owner_id, purchase_id, charge_no, kind, amount)
    values (p_owner, p_purchase, c, v_charge ->> 'kind', v_amount)
    returning id into v_id;
    if v_charge ->> 'kind' = 'delivery_fee' then
      v_fees := v_fees + v_amount;
    else
      v_discounts := v_discounts + v_amount;
    end if;

    -- Shares: given by line number, or by default in proportion to the
    -- lines' item amounts (Q4). They must add up to the charge exactly.
    if jsonb_typeof(v_charge -> 'shares') = 'array' and jsonb_array_length(v_charge -> 'shares') > 0 then
      v_shares := array_fill(0::numeric, array[n]);
      for v_share in select value from jsonb_array_elements(v_charge -> 'shares') loop
        v_no := case when (v_share ->> 'line') ~ '^\d{1,3}$' then (v_share ->> 'line')::int end;
        if v_no is null or v_no not between 1 and n or pur_money(v_share ->> 'amount') is null then
          raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
        end if;
        v_shares[v_no] := v_shares[v_no] + pur_money(v_share ->> 'amount');
      end loop;
    else
      v_shares := pur_prorate(v_amount, v_line_gross);
    end if;
    if (select sum(x) from unnest(v_shares) x) is distinct from v_amount
       or exists (select 1 from unnest(v_shares) x where x < 0) then
      raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
    end if;
    for k in 1 .. n loop
      if v_shares[k] > 0 then
        insert into purchase_charge_shares (charge_id, line_id, amount) values (v_id, v_line_ids[k], v_shares[k]);
      end if;
    end loop;
    -- What was stored must equal the charge (never more, never less).
    if (select coalesce(sum(s.amount), 0) from purchase_charge_shares s where s.charge_id = v_id) <> v_amount then
      raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
    end if;
  end loop;

  -- A line's discounts can never exceed its item amount (no negative rows).
  if exists (select 1
               from purchase_lines l
               join purchase_charge_shares s on s.line_id = l.id
               join purchase_charges ch on ch.id = s.charge_id and ch.kind = 'discount'
              where l.purchase_id = p_purchase
              group by l.id, l.gross_amount
             having sum(s.amount) > l.gross_amount) then
    raise exception 'DISCOUNT_TOO_LARGE' using errcode = 'P0001';
  end if;

  -- Lines + fees − discounts must equal the receipt total.
  if v_gross + v_fees - v_discounts <> (select pu.receipt_total from purchases pu where pu.id = p_purchase) then
    raise exception 'TOTAL_MISMATCH' using errcode = 'P0001';
  end if;
end;
$$;

-- Write the expense rows for a stored purchase: each project line's net
-- amount (item amount − its discount shares), and each project's delivery-fee
-- share as its own "Delivery fee (share)" row, all funded by pur_fund. A row
-- with no period is tied to its project (folder_id). Warehouse lines and their
-- shares write nothing. Returns what was written.
create or replace function pur_charge_rows(p_purchase uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pu purchases;
  v_line record;
  v_fee record;
  v_split record;
  v_splits jsonb;
  v_n int;
  v_k int;
  v_first boolean := true;
  v_rows jsonb := '[]'::jsonb;
  v_review int[] := '{}';
begin
  select * into pu from purchases where id = p_purchase;

  for v_line in
    select l.*, l.gross_amount - coalesce((select sum(s.amount) from purchase_charge_shares s
                                             join purchase_charges c on c.id = s.charge_id and c.kind = 'discount'
                                            where s.line_id = l.id), 0) as net
      from purchase_lines l
     where l.purchase_id = p_purchase and l.destination = 'project'
     order by l.line_no
  loop
    select coalesce(jsonb_agg(jsonb_build_object('period_id', f.period_id, 'amount', f.amount, 'cover', f.cover,
                                                 'review', f.review) order by f.n), '[]'::jsonb) into v_splits
      from pur_fund(pu.owner_id, v_line.folder_id, pu.purchase_date, v_line.net) with ordinality f(period_id, amount, cover, review, n);
    v_n := jsonb_array_length(v_splits);
    v_k := 0;
    for v_split in select * from jsonb_to_recordset(v_splits) as x(period_id uuid, amount numeric, cover boolean, review boolean) loop
      v_k := v_k + 1;
      insert into expenses (owner_id, project_id, folder_id, expense_name, category, quantity, amount, date_time, notes,
                            payment_method, in_inventory, cover_expense, split_group, split_index, split_total,
                            po_image_url, delivery_receipt_url, supplier_invoice_url, payment_receipt_url,
                            purchase_line_id)
      values (pu.owner_id, v_split.period_id, case when v_split.period_id is null then v_line.folder_id end,
              v_line.item_name || case when v_n > 1 then ' (' || v_k || '/' || v_n || ')' else '' end,
              v_line.category, case when v_n > 1 then 1 else v_line.quantity end, v_split.amount, pu.date_time,
              pu.notes, pu.payment_method, v_line.in_inventory, v_split.cover,
              case when v_n > 1 then 'purchase:' || p_purchase || ':' || v_line.line_no end,
              case when v_n > 1 then v_k end, case when v_n > 1 then v_n end,
              case when v_first then pu.docs ->> 'po_image_url' end,
              case when v_first then pu.docs ->> 'delivery_receipt_url' end,
              case when v_first then pu.docs ->> 'supplier_invoice_url' end,
              case when v_first then pu.docs ->> 'payment_receipt_url' end,
              v_line.id);
      v_first := false;
      if v_split.review then v_review := v_review || v_line.line_no; end if;
      v_rows := v_rows || jsonb_build_object('line', v_line.line_no, 'period_id', v_split.period_id,
                                             'amount', v_split.amount, 'cover', v_split.cover);
    end loop;
    update purchase_lines set needs_funding_review = (v_line.line_no = any (v_review)) where id = v_line.id;
  end loop;

  -- Delivery fees: one share per project folder, funded like any amount.
  for v_fee in
    select c.id as charge_id, l.folder_id, sum(s.amount) as amount,
           (select l2.category from purchase_lines l2
             where l2.purchase_id = p_purchase and l2.folder_id = l.folder_id
             order by l2.gross_amount desc, l2.line_no limit 1) as category
      from purchase_charges c
      join purchase_charge_shares s on s.charge_id = c.id
      join purchase_lines l on l.id = s.line_id and l.destination = 'project'
     where c.purchase_id = p_purchase and c.kind = 'delivery_fee'
     group by c.id, c.charge_no, l.folder_id
     order by c.charge_no, l.folder_id
  loop
    select coalesce(jsonb_agg(jsonb_build_object('period_id', f.period_id, 'amount', f.amount, 'cover', f.cover,
                                                 'review', f.review) order by f.n), '[]'::jsonb) into v_splits
      from pur_fund(pu.owner_id, v_fee.folder_id, pu.purchase_date, v_fee.amount) with ordinality f(period_id, amount, cover, review, n);
    v_n := jsonb_array_length(v_splits);
    v_k := 0;
    for v_split in select * from jsonb_to_recordset(v_splits) as x(period_id uuid, amount numeric, cover boolean, review boolean) loop
      v_k := v_k + 1;
      insert into expenses (owner_id, project_id, folder_id, expense_name, category, quantity, amount, date_time, notes,
                            payment_method, cover_expense, split_group, split_index, split_total, purchase_charge_id)
      values (pu.owner_id, v_split.period_id, case when v_split.period_id is null then v_fee.folder_id end,
              'Delivery fee (share)' || case when v_n > 1 then ' (' || v_k || '/' || v_n || ')' else '' end,
              coalesce(v_fee.category, ''), 1, v_split.amount, pu.date_time, pu.notes, pu.payment_method, v_split.cover,
              case when v_n > 1 then 'purchase-fee:' || v_fee.charge_id || ':' || v_fee.folder_id end,
              case when v_n > 1 then v_k end, case when v_n > 1 then v_n end, v_fee.charge_id);
      v_rows := v_rows || jsonb_build_object('fee', true, 'period_id', v_split.period_id,
                                             'amount', v_split.amount, 'cover', v_split.cover);
    end loop;
  end loop;

  return jsonb_build_object('purchase_id', p_purchase, 'rows', v_rows, 'needs_review', to_jsonb(v_review));
end;
$$;

-- Remove a purchase's expense rows (correction, re-fund, void).
create or replace function pur_clear_rows(p_purchase uuid) returns void
language sql security definer set search_path = public as $$
  delete from expenses e
   where e.purchase_line_id in (select id from purchase_lines where purchase_id = p_purchase)
      or e.purchase_charge_id in (select id from purchase_charges where purchase_id = p_purchase)
$$;

-- Add each "track in inventory" line's quantity to stock, once per line
-- (purchase_stock_moves' primary key refuses a second move). The first stock
-- item of this company with exactly this name, else a new one. The caller
-- holds the item's lock (pur_lock 'pur_stock:').
create or replace function pur_move_stock(p_purchase uuid, p_actor uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_line record;
  v_inv uuid;
  v_moved int := 0;
begin
  for v_line in
    select l.*, pu.notes from purchase_lines l join purchases pu on pu.id = l.purchase_id
     where l.purchase_id = p_purchase and l.in_inventory order by l.line_no
  loop
    continue when exists (select 1 from purchase_stock_moves m where m.line_id = v_line.id);
    -- Within the company: its own items first, else an unowned one (the old
    -- browser mirror wrote items with no owner). Never another company's.
    select i.id into v_inv from inventory i
     where i.item_name = v_line.item_name and (i.owner_id = v_line.owner_id or i.owner_id is null)
     order by (i.owner_id = v_line.owner_id) desc nulls last, i.created_at, i.id limit 1;
    if v_inv is null then
      insert into inventory (owner_id, item_name, unit, current_stock, min_stock, notes, last_updated, last_adjusted_by, created_at)
      values (v_line.owner_id, v_line.item_name, coalesce(nullif(v_line.unit, ''), 'pcs'), 0, v_line.min_stock,
              nullif(v_line.notes, ''), now(), p_actor, now())
      returning id into v_inv;
    end if;
    insert into purchase_stock_moves (line_id, inventory_id, quantity) values (v_line.id, v_inv, v_line.quantity)
    on conflict (line_id) do nothing;
    if found then
      update inventory set current_stock = coalesce(current_stock, 0) + v_line.quantity,
                           last_updated = now(), last_adjusted_by = p_actor
       where id = v_inv;
      v_moved := v_moved + 1;
    end if;
  end loop;
  return v_moved;
end;
$$;

-- The purchase as stored, for history and for the office's edit form.
create or replace function pur_doc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
    'date_time', pu.date_time, 'supplier', pu.supplier, 'receipt_total', pu.receipt_total, 'notes', pu.notes,
    'payment_method', pu.payment_method, 'docs', pu.docs,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'line', l.line_no, 'destination', l.destination, 'folder_id', l.folder_id, 'folder_name', l.folder_name,
                'item_name', l.item_name, 'category', l.category, 'quantity', l.quantity, 'unit', l.unit,
                'amount', l.gross_amount, 'in_inventory', l.in_inventory, 'min_stock', l.min_stock,
                'needs_funding_review', l.needs_funding_review) order by l.line_no), '[]'::jsonb)
                from purchase_lines l where l.purchase_id = pu.id),
    'charges', (select coalesce(jsonb_agg(jsonb_build_object(
                  'kind', c.kind, 'amount', c.amount,
                  'shares', (select coalesce(jsonb_agg(jsonb_build_object('line', l.line_no, 'amount', s.amount) order by l.line_no), '[]'::jsonb)
                               from purchase_charge_shares s join purchase_lines l on l.id = s.line_id where s.charge_id = c.id))
                  order by c.charge_no), '[]'::jsonb)
                  from purchase_charges c where c.purchase_id = pu.id))
  from purchases pu where pu.id = p_purchase
$$;

-- Header fields shared by record and correct.
create or replace function pur_header_ok(p_body jsonb) returns void
language plpgsql immutable as $$
begin
  if coalesce(p_body ->> 'purchase_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  begin
    perform (p_body ->> 'purchase_date')::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if coalesce(p_body ->> 'date_time', '') <> '' and left(p_body ->> 'date_time', 10) <> p_body ->> 'purchase_date' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  if pur_money(p_body ->> 'receipt_total') is null then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if coalesce(p_body ->> 'source', 'expenses_form') not in ('expenses_form', 'workmate') then
    raise exception 'BAD_SOURCE' using errcode = 'P0001';
  end if;
end;
$$;

-- The answer already given to this operation, if any — read AFTER taking the
-- operation's lock, so an overlapping second call waits and gets the same,
-- with "replayed": true added.
create or replace function pur_op_begin(p_op uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev jsonb;
begin
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));
  select o.result into v_prev from pur_ops o where o.actor_id = auth.uid() and o.op_id = p_op;
  if v_prev is null then
    return null;
  end if;
  -- Marked, so the caller can tell the user that a form edited before the
  -- retry was NOT saved — this is the first press's answer.
  return v_prev || jsonb_build_object('replayed', true);
end;
$$;

-- Changes to ONE purchase are taken one at a time, and this lock comes
-- BEFORE its projects are read: a second correction waits here, then reads
-- the projects the first one left — never a stale list.
create or replace function pur_purchase_lock(p_purchase uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pur_purchase:' || p_purchase, 0));
end;
$$;

-- A recorded purchase of this company, locked; staff refused on a completed
-- project or an Additional Works job under one (the main owner may).
create or replace function pur_open(p_owner uuid, p_purchase uuid) returns purchases
language plpgsql security definer set search_path = public as $$
declare pu purchases;
begin
  select * into pu from purchases where id = p_purchase and owner_id = p_owner for update;
  if pu.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if pu.status <> 'recorded' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not is_owner() and exists (select 1 from purchase_lines l join folders f on f.id = l.folder_id
                                  left join folders par on par.id = f.parent_folder_id
                                 where l.purchase_id = p_purchase
                                   and (f.completed_at is not null or par.completed_at is not null)) then
    raise exception 'COMPLETED_PROJECT' using errcode = 'P0001';
  end if;
  return pu;
end;
$$;

-- ════ 6. The operations ══════════════════════════════════════════════

-- Record a purchase once. p_body: purchase_date (YYYY-MM-DD, the ACTUAL
-- purchase date), date_time, supplier, receipt_total, notes, payment_method,
-- source, docs {po_image_url, delivery_receipt_url, supplier_invoice_url,
-- payment_receipt_url}, lines [{destination, folder_id, item_name, category,
-- quantity, unit, amount, in_inventory, min_stock}], charges [{kind, amount,
-- shares [{line, amount}]}]. Returns {purchase_id, rows, needs_review, stock_moves}.
create or replace function pur_record(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_header_ok(p_body);
  perform pur_lock(pur_body_keys(p_body));
  perform set_config('dacs.purchase_write', 'on', true);
  v_result := pur_insert(v_owner, v_uid, p_body, null);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'record', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- Insert a purchase, its lines, charges and expense rows, and move its stock.
-- p_carry: stock already moved by a purchase this one replaces —
-- [{line_no, item_name, inventory_id, quantity}]; the old moves of an item are
-- paired in line order with the new lines of that item, which take them over
-- instead of moving stock again (unpaired new lines move stock as usual). Callers hold every lock and the guard.
create or replace function pur_insert(p_owner uuid, p_actor uuid, p_body jsonb, p_carry jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_result jsonb;
begin
  insert into purchases (owner_id, source, purchase_date, date_time, supplier, receipt_total, notes, payment_method, docs, recorded_by)
  values (p_owner, coalesce(p_body ->> 'source', 'expenses_form'), (p_body ->> 'purchase_date')::date,
          coalesce(nullif(p_body ->> 'date_time', ''), p_body ->> 'purchase_date'), btrim(coalesce(p_body ->> 'supplier', '')),
          pur_money(p_body ->> 'receipt_total'), btrim(coalesce(p_body ->> 'notes', '')),
          btrim(coalesce(p_body ->> 'payment_method', '')),
          coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
                     where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                       and jsonb_typeof(v) = 'string'), '{}'::jsonb),
          p_actor)
  returning id into v_id;

  perform pur_store(p_owner, v_id, p_body);
  -- Carried-over stock: the first new "track in inventory" line of the same
  -- item takes the old move over (no stock change). Nothing is ever moved twice.
  insert into purchase_stock_moves (line_id, inventory_id, quantity)
  select l.id, c.inventory_id, c.quantity
    from (select k.*, row_number() over (partition by lower(k.item_name) order by k.line_no) rn
            from jsonb_to_recordset(coalesce(p_carry, '[]'::jsonb)) as k(line_no int, item_name text, inventory_id uuid, quantity numeric)) c
    join (select x.*, row_number() over (partition by lower(x.item_name) order by x.line_no) rn
            from purchase_lines x where x.purchase_id = v_id and x.in_inventory) l
      on lower(l.item_name) = lower(c.item_name) and l.rn = c.rn
  on conflict (line_id) do nothing;
  v_result := pur_charge_rows(v_id) || jsonb_build_object('stock_moves', pur_move_stock(v_id, p_actor));
  insert into purchase_history (owner_id, purchase_id, kind, after, actor_id)
  values (p_owner, v_id, 'recorded', pur_doc(v_id), p_actor);
  return v_result;
end;
$$;

-- Correct a recorded purchase: p_body has the same shape as pur_record and
-- the SAME number of lines (to add or drop a line, void and record again).
-- Funding is recomputed and the purchase's expense rows replaced in one
-- transaction; history keeps the content before and after. Stock already
-- moved is not moved again (a stock correction belongs to Stage 2B). Moving
-- a line to another project, or touching a COMPLETED project, is
-- main-owner only.
create or replace function pur_correct(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_old_folders uuid[];
  v_moves jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_header_ok(p_body);
  -- This purchase first, then its CURRENT projects and the new ones together.
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase) || pur_body_keys(p_body));
  pu := pur_open(v_owner, p_purchase);
  if jsonb_array_length(coalesce(p_body -> 'lines', '[]'::jsonb))
     <> (select count(*) from purchase_lines where purchase_id = p_purchase) then
    raise exception 'LINES_CHANGED' using errcode = 'P0001';
  end if;
  select array_agg(l.folder_id order by l.line_no) into v_old_folders from purchase_lines l where l.purchase_id = p_purchase;
  if not is_owner() and exists (select 1
                                  from jsonb_array_elements(p_body -> 'lines') with ordinality n(v, i)
                                 where pur_uuid(n.v ->> 'folder_id') is distinct from v_old_folders[n.i]) then
    raise exception 'OWNER_APPROVAL_NEEDED' using errcode = 'P0001';
  end if;

  v_before := pur_doc(p_purchase);
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  -- Stock already moved stays moved: the new lines take over the move records.
  select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'inventory_id', m.inventory_id,
                                               'quantity', m.quantity, 'moved_at', m.moved_at)), '[]'::jsonb)
    into v_moves
    from purchase_stock_moves m join purchase_lines l on l.id = m.line_id where l.purchase_id = p_purchase;
  delete from purchase_stock_moves m using purchase_lines l where l.id = m.line_id and l.purchase_id = p_purchase;
  delete from purchase_charge_shares s using purchase_charges c where c.id = s.charge_id and c.purchase_id = p_purchase;
  delete from purchase_charges where purchase_id = p_purchase;
  delete from purchase_lines where purchase_id = p_purchase;

  update purchases set
    purchase_date = (p_body ->> 'purchase_date')::date,
    date_time = coalesce(nullif(p_body ->> 'date_time', ''), p_body ->> 'purchase_date'),
    supplier = btrim(coalesce(p_body ->> 'supplier', '')),
    receipt_total = pur_money(p_body ->> 'receipt_total'),
    notes = btrim(coalesce(p_body ->> 'notes', '')),
    payment_method = btrim(coalesce(p_body ->> 'payment_method', '')),
    docs = docs || coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
                              where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                                and jsonb_typeof(v) = 'string'), '{}'::jsonb),
    updated_at = now()
  where id = p_purchase;

  perform pur_store(v_owner, p_purchase, p_body);
  insert into purchase_stock_moves (line_id, inventory_id, quantity, moved_at)
  select l.id, k.inventory_id, k.quantity, k.moved_at
    from jsonb_to_recordset(v_moves) as k(line_no int, inventory_id uuid, quantity numeric, moved_at timestamptz)
    join purchase_lines l on l.purchase_id = p_purchase and l.line_no = k.line_no;
  v_result := pur_charge_rows(p_purchase);
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'corrected', btrim(p_reason), v_before, pur_doc(p_purchase), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'correct', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- Replace a purchase with a new version that may have a different number of
-- lines (R8): the old one is voided and the new one recorded in ONE
-- transaction. Stock the old one already moved is carried over to the new
-- lines of the same item — so replacing never adds stock twice. Same rules as
-- a correction: reason required; staff cannot touch a completed project or
-- move costs to another project (owner-only).
create or replace function pur_replace(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_carry jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_header_ok(p_body);
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase) || pur_body_keys(p_body));
  pu := pur_open(v_owner, p_purchase);
  if not is_owner() and exists (
      select 1 from jsonb_array_elements(p_body -> 'lines') n(v)
       where not exists (select 1 from purchase_lines l
                          where l.purchase_id = p_purchase
                            and l.destination = coalesce(n.v ->> 'destination', 'project')
                            and l.folder_id is not distinct from pur_uuid(n.v ->> 'folder_id'))) then
    raise exception 'OWNER_APPROVAL_NEEDED' using errcode = 'P0001';
  end if;

  v_before := pur_doc(p_purchase);
  select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_name', l.item_name, 'inventory_id', m.inventory_id, 'quantity', m.quantity)), '[]'::jsonb)
    into v_carry
    from purchase_stock_moves m join purchase_lines l on l.id = m.line_id where l.purchase_id = p_purchase;
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  delete from purchase_stock_moves m using purchase_lines l where l.id = m.line_id and l.purchase_id = p_purchase;
  v_result := pur_insert(v_owner, v_uid, p_body, v_carry);
  update purchases set status = 'void', replaced_by = (v_result ->> 'purchase_id')::uuid, updated_at = now() where id = p_purchase;
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'replaced', btrim(p_reason), v_before, jsonb_build_object('replaced_by', v_result ->> 'purchase_id'), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'replace', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- Re-fund a recorded purchase as it stands — e.g. after the office added the
-- billing period a "No billing period" line was waiting for. Same purchase
-- date, same amounts: only where the pesos are charged can change, and the
-- total in Spent stays the same (the old rows are replaced, never added to).
create or replace function pur_refund(p_op uuid, p_purchase uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner('expenses_form');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase));
  pu := pur_open(v_owner, p_purchase);
  v_before := pur_doc(p_purchase);
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  v_result := pur_charge_rows(p_purchase);
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'refunded', btrim(p_reason), v_before, pur_doc(p_purchase), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'refund', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- Void a purchase: its expense rows leave Spent; the purchase, its lines,
-- receipt photos and history stay. A void does not claim goods were returned
-- or money refunded — those are recorded separately (stock is not taken back).
create or replace function pur_void(p_op uuid, p_purchase uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner('expenses_form');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase));
  pu := pur_open(v_owner, p_purchase);
  v_before := pur_doc(p_purchase);
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  update purchases set status = 'void', updated_at = now() where id = p_purchase;
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, actor_id)
  values (v_owner, p_purchase, 'voided', btrim(p_reason), v_before, v_uid);
  v_result := jsonb_build_object('purchase_id', p_purchase, 'status', 'void');
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'void', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- ════ 7. Permissions ═════════════════════════════════════════════════

revoke all on function pur_record(uuid, jsonb) from public, anon;
grant execute on function pur_record(uuid, jsonb) to authenticated;
revoke all on function pur_correct(uuid, uuid, jsonb, text) from public, anon;
grant execute on function pur_correct(uuid, uuid, jsonb, text) to authenticated;
revoke all on function pur_refund(uuid, uuid, text) from public, anon;
grant execute on function pur_refund(uuid, uuid, text) to authenticated;
revoke all on function pur_replace(uuid, uuid, jsonb, text) from public, anon;
grant execute on function pur_replace(uuid, uuid, jsonb, text) to authenticated;
revoke all on function pur_live_purchases(uuid, uuid) from public, anon;
grant execute on function pur_live_purchases(uuid, uuid) to authenticated;
-- A boolean about the caller only; the read policies need to call it.
revoke all on function pur_reader() from public, anon;
grant execute on function pur_reader() to authenticated;
revoke all on function pur_void(uuid, uuid, text) from public, anon;
grant execute on function pur_void(uuid, uuid, text) to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function pur_lock(text[]) from public, anon, authenticated;
revoke all on function pur_body_keys(jsonb) from public, anon, authenticated;
revoke all on function pur_stored_keys(uuid) from public, anon, authenticated;
revoke all on function pur_month_no(text) from public, anon, authenticated;
revoke all on function pur_period_remaining(uuid) from public, anon, authenticated;
revoke all on function pur_cover_period(uuid, uuid, date) from public, anon, authenticated;
revoke all on function pur_fund(uuid, uuid, date, numeric) from public, anon, authenticated;
revoke all on function pur_prorate(numeric, numeric[]) from public, anon, authenticated;
revoke all on function pur_money(text) from public, anon, authenticated;
revoke all on function pur_qty(text) from public, anon, authenticated;
revoke all on function pur_uuid(text) from public, anon, authenticated;
revoke all on function pur_actor_owner(text) from public, anon, authenticated;
revoke all on function pur_store(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_charge_rows(uuid) from public, anon, authenticated;
revoke all on function pur_clear_rows(uuid) from public, anon, authenticated;
revoke all on function pur_move_stock(uuid, uuid) from public, anon, authenticated;
revoke all on function pur_doc(uuid) from public, anon, authenticated;
revoke all on function pur_header_ok(jsonb) from public, anon, authenticated;
revoke all on function pur_op_begin(uuid) from public, anon, authenticated;
revoke all on function pur_open(uuid, uuid) from public, anon, authenticated;
revoke all on function pur_guard_expense_row() from public, anon, authenticated;
revoke all on function pur_guard_delete() from public, anon, authenticated;
revoke all on function pur_purchase_lock(uuid) from public, anon, authenticated;
revoke all on function pur_insert(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
````

- [ ] **Step 6: Run both SQL suites.**

Run: `npm run test:sql`
Expected: `45 passed, 0 failed`, then `10 passed, 0 failed`.

- [ ] **Step 7: Commit point (the user commits).** The five files above. `supabase/tests/node_modules/` is ignored by the existing `node_modules/` rule.

---

### Task 2: Dacs Web records through the server, and every Spent site reads no-period rows

**Files:**
- Create: `tests/purchase-server.test.js`, `tests/purchase-screens.test.js`
- Modify: `js/expenses-module.js`, `js/portal-app.compiled.js`, `admin.html`, `tests/receipt-save-paths.test.js`, `tests/money-math.test.js`, `tests/billing-allocation.test.js`

**Interfaces:**
- Consumes `pur_record`, `pur_correct`, `pur_void` and `pur_live_purchases` from Task 1, called through `window.sbClient.rpc(name, args)`.
- Reads `purchases`, `purchase_lines` and `purchase_charges`. RLS lets the office read them.
- Produces, in `js/expenses-module.js`:
  - `_purLocalDateKey(Date) → 'YYYY-MM-DD'`
  - `_purErrorText(err) → string`
  - `_purAskReason(title, sub, okLabel) → Promise<string|null>`
  - `_purForRow(expenseRow) → Promise<{purchase, line, lineCount, simple}|null>`
  - `_purLoadReviewFlags()`
  - `_purSaveCorrection()`
  - `_expNoPeriodRows(folderId|null) → rows`, `_expNoPeriodSpent(folderId|null) → number`
  - State: `_editingPurchase`, `_purEditOpId`, `_purReviewLines`
  - Report totals gain `noPeriodMaterial`.
- In `js/portal-app.compiled.js`, `mapExpenseDoc` gains `folderId` (set only on a no-period row).

- [ ] **Step 1: Write the static checks and the screen test first.**

**New file `tests/purchase-server.test.js`:**

````js
// ════════════════════════════════════════════════════════════════════
// PURCHASE SERVER (0096) STATIC TESTS:  node tests/purchase-server.test.js
//
// Zero dependencies. Guards the SHAPE of migration 0096 (WorkMate Stage
// 2A-1, one purchase recording operation) and of the Dacs Web code around
// it: grants, SECURITY DEFINER + pinned search_path, locks before writes,
// the expense-row guard, Cover kept a subset, the stock move kept on the
// server, and the no-period rows read by every Spent site. BEHAVIOUR is
// proven by `npm run test:sql` — supabase/tests/2a1_purchase.pglite.mjs
// (PostgreSQL in memory) and 2a1_concurrency.mjs (two sessions on a real
// PostgreSQL) — and live by supabase/tests/2a1_acceptance.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : ''; };
const strip = (s) => s.replace(/--.*$/gm, '');
const M = read('supabase/migrations/0096_purchase_recording.sql');
const C = strip(M);
const EXP = read('js/expenses-module.js');
const PC = read('js/portal-app.compiled.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const fnBlock = (name) => (C.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i')) || [''])[0];
const between = (src, a, b) => { const i = src.indexOf(a); return i === -1 ? '' : src.slice(i, src.indexOf(b, i + a.length)); };

console.log('\npurchase server (0096)');

test('0095 is untouched (applied migrations are never edited)', () => {
  const sha = crypto.createHash('sha256').update(read('supabase/migrations/0095_ai_request_gate.sql')).digest('hex');
  assert(sha === '80414edd6a2f2215920a09846436109d957f77b9e43a0446929cf13cbb0a7a7d', '0095 changed: ' + sha);
});

test('0096 exists and sets a lock timeout', () => {
  assert(M.length > 0, 'missing supabase/migrations/0096_purchase_recording.sql');
  assert(/set local lock_timeout = '5s';/.test(C), 'no lock timeout');
});

const PUBLIC = ['pur_record(uuid, jsonb)', 'pur_correct(uuid, uuid, jsonb, text)', 'pur_refund(uuid, uuid, text)', 'pur_void(uuid, uuid, text)',
  'pur_replace(uuid, uuid, jsonb, text)', 'pur_live_purchases(uuid, uuid)', 'pur_reader()'];
const INTERNAL = ['pur_lock(text[])', 'pur_body_keys(jsonb)', 'pur_stored_keys(uuid)', 'pur_month_no(text)',
  'pur_period_remaining(uuid)', 'pur_cover_period(uuid, uuid, date)', 'pur_fund(uuid, uuid, date, numeric)',
  'pur_prorate(numeric, numeric[])', 'pur_money(text)', 'pur_actor_owner(text)', 'pur_store(uuid, uuid, jsonb)',
  'pur_charge_rows(uuid)', 'pur_clear_rows(uuid)', 'pur_move_stock(uuid, uuid)', 'pur_doc(uuid)', 'pur_header_ok(jsonb)',
  'pur_op_begin(uuid)', 'pur_open(uuid, uuid)', 'pur_guard_expense_row()', 'pur_guard_delete()',
  'pur_purchase_lock(uuid)', 'pur_insert(uuid, uuid, jsonb, jsonb)', 'pur_uuid(text)', 'pur_qty(text)'];
const OPS = ['pur_record', 'pur_correct', 'pur_refund', 'pur_void', 'pur_replace'];
const ON_A_PURCHASE = ['pur_correct', 'pur_refund', 'pur_void', 'pur_replace'];

test('the five operations, the deletion pre-check and the read check: authenticated only, never anon', () => {
  for (const f of PUBLIC) {
    const esc = f.replace(/[()[\]]/g, '\\$&');
    assert(new RegExp('revoke all on function ' + esc + ' from public, anon;').test(C), f + ' not revoked from anon');
    assert(new RegExp('grant execute on function ' + esc + ' to authenticated;').test(C), f + ' not granted');
  }
});

test('every helper is internal (revoked from authenticated too)', () => {
  for (const f of INTERNAL) {
    const esc = f.replace(/[()[\]]/g, '\\$&');
    assert(new RegExp('revoke all on function ' + esc + ' from public, anon, authenticated;').test(C), f + ' is callable by users');
    assert(!new RegExp('grant execute on function ' + esc).test(C), f + ' granted');
  }
});

test('definer functions pin search_path; every pur_ function is accounted for', () => {
  const all = [...C.matchAll(/create or replace function (pur_\w+)\s*\(/g)].map(m => m[1]);
  const named = [...PUBLIC, ...INTERNAL].map(f => f.slice(0, f.indexOf('(')));
  for (const n of all) assert(named.includes(n), n + ' has no grant/revoke line');
  for (const n of all) {
    const b = fnBlock(n);
    if (/security definer/.test(b)) assert(/set search_path = public/.test(b), n + ' definer without search_path');
  }
});

test('who: active office accounts allowed Expenses; phone purchasing needs the Buyer switch', () => {
  const b = fnBlock('pur_actor_owner');
  assert(/pr_is_office\(\)/.test(b), 'office check must use pr_is_office (active accounts, 0094)');
  assert(/allowed_modules/.test(b) && /\? 'expenses'/.test(b) && /NOT_ALLOWED/.test(b), 'module-focused accounts must need expenses');
  assert(/'workmate'/.test(b) && /BUYER_REQUIRED/.test(b), "source 'workmate' must be refused until the Buyer switch exists");
  for (const n of OPS) assert(/pur_actor_owner\(/.test(fnBlock(n)), n + ' does not check the caller');
});

test('each operation takes its operation lock, then every project/stock lock, BEFORE writing anything', () => {
  assert(/pg_advisory_xact_lock/.test(fnBlock('pur_op_begin')) && /from pur_ops/.test(fnBlock('pur_op_begin')), 'pur_op_begin must lock, then read the stored answer');
  assert(/order by 1/.test(fnBlock('pur_lock')), 'locks must be taken in one fixed order');
  for (const n of OPS) {
    const b = fnBlock(n);
    const begin = b.indexOf('pur_op_begin(p_op)'), lock = b.indexOf('perform pur_lock('), write = b.search(/\n\s*(insert into|update |delete from|perform pur_clear_rows|perform pur_store)/);
    assert(begin !== -1 && lock > begin && write > lock, n + ': op lock → project locks → writes');
    assert(/insert into pur_ops/.test(b), n + ' does not store its answer');
  }
});

test('a change to one purchase locks THAT purchase before reading which projects it touches', () => {
  assert(/pg_advisory_xact_lock\(hashtextextended\('pur_purchase:'/.test(fnBlock('pur_purchase_lock')), 'per-purchase lock');
  for (const n of ON_A_PURCHASE) {
    const b = fnBlock(n);
    const pl = b.indexOf('perform pur_purchase_lock(p_purchase)'), keys = b.indexOf('pur_stored_keys(p_purchase)');
    assert(pl !== -1 && keys > pl, n + ': purchase lock → its stored projects');
  }
});

test('purchase-made and project-level rows are guarded; only the operations open the guard', () => {
  assert(/create trigger expenses_purchase_guard before insert or update or delete on expenses/.test(C), 'no guard trigger');
  assert(/old\.folder_id is not null/.test(fnBlock('pur_guard_expense_row')) && /new\.folder_id is not null/.test(fnBlock('pur_guard_expense_row')), 'project-level rows unguarded');
  const opened = [...C.matchAll(/set_config\('dacs\.purchase_write', 'on', true\)/g)].length;
  assert(opened === 5, 'the guard must be opened by exactly the five operations, found ' + opened);
});

test('Cover stays a subset; no period invented; links stay inside the company', () => {
  const rows = fnBlock('pur_charge_rows');
  assert(/insert into expenses \(/.test(rows) && /cover_expense/.test(rows), 'purchases must write ordinary expense rows flagged cover');
  assert(!/insert into projects/i.test(C), 'a period must never be created');
  assert(/p\.owner_id = p_owner/.test(fnBlock('pur_fund')) && /b\.owner_id = p_owner/.test(fnBlock('pur_fund')), 'periods and budgets must belong to the company');
  assert(/f\.owner_id = p_owner/.test(fnBlock('pur_store')), 'the project must belong to the company');
  assert(!/folder_id uuid references folders/.test(between(C, 'create table if not exists purchase_lines', ');')), 'purchase lines must not block deleting a project');
});

test('Cover link: a Cover period of any month, else a client period of the purchase month only', () => {
  assert(/\)\s*c\s+where[^\n]*\bsame_month\b/.test(fnBlock('pur_cover_period')), 'a Cover row never sits on another month\'s client period');
});

test('the completed-project lock also covers Additional Works jobs (completion is stamped on the main project)', () => {
  for (const f of ['pur_store', 'pur_open'])
    assert(/join folders par on par\.id = f\.parent_folder_id/.test(fnBlock(f)) && /par\.completed_at is not null/.test(fnBlock(f)),
           f + ' must also refuse staff when the parent project is completed');
});

test('a replayed operation is marked, so the form can say its later edits were not applied', () => {
  assert(/return v_prev \|\| jsonb_build_object\('replayed', true\);/.test(fnBlock('pur_op_begin')), 'pur_op_begin must mark a replay');
});

test('a project or period with a live purchase cannot be deleted — checked BEFORE its cascade, from the purchase lines', () => {
  assert(/create trigger folders_purchase_delete_guard before delete on folders/.test(C), 'folders guard');
  assert(/create trigger projects_purchase_delete_guard before delete on projects/.test(C), 'periods guard');
  const g = fnBlock('pur_guard_delete');
  assert(/from purchase_lines l join purchases pu on pu\.id = l\.purchase_id\s+where l\.folder_id = old\.id and pu\.status = 'recorded'/.test(g),
         'the project guard must read purchase lines (a fully discounted purchase has no expense rows)');
  assert(/PURCHASES_LIVE/.test(g), 'clear error');
  assert(/purchase_lines l where l\.purchase_id = pu\.id and l\.folder_id = p_folder/.test(fnBlock('pur_live_purchases')), 'the pre-check counts lines too');
});

test('the pre-check counts the Additional Works jobs under the project too', () => {
  assert(/parent_folder_id/.test(fnBlock('pur_live_purchases')), 'the pre-check counts the Additional Works jobs under the project too');
});

test('Project Control Additional Works delete asks about purchases before the confirm', () => {
  const b = between(PC, 'const deleteChild = async', '\n  };');
  const pre = b.indexOf('rpc("pur_live_purchases"');
  assert(pre !== -1 && pre < b.indexOf('confirm('), 'deleteChild must check purchases before confirm(');
});

test('_purErrorText maps BAD_PROJECT (reachable server codes are never shown raw)', () => {
  assert(/BAD_PROJECT:\s+'/.test(between(EXP, 'function _purErrorText(', '\n}\n')), 'BAD_PROJECT unmapped');
});

test('the period view skips no-period rows (they are added once by the panels, not into the period)', () => {
  const b = between(EXP, 'function updateBudgetOverview(', 'const exps    =');
  assert(/if \(!e\.projectId && e\.folderId\) return false;/.test(b), 'period branch must exclude no-period rows');
});

test('reading purchases needs the same access as recording them', () => {
  const r = fnBlock('pur_reader');
  assert(/pr_is_office\(\)/.test(r) && /\? 'expenses'/.test(r), 'active office account allowed Expenses');
  assert(/using \(can_access\(owner_id\) and pur_reader\(\)\)/.test(C), 'every purchase table policy must also require pur_reader()');
  assert(/using \(pur_reader\(\) and exists/.test(C), 'the shares policy too');
});

test('stock moves on the server, once per line', () => {
  assert(/create table if not exists purchase_stock_moves \(\s*line_id uuid primary key/.test(C), 'one move per line');
  assert(/on conflict \(line_id\) do nothing/.test(fnBlock('pur_move_stock')) && /if found then/.test(fnBlock('pur_move_stock')), 'a second move must add nothing');
  assert(/pur_move_stock\(/.test(fnBlock('pur_insert')) && !/pur_move_stock\(/.test(fnBlock('pur_correct') + fnBlock('pur_refund') + fnBlock('pur_void')), 'only recording moves stock');
  assert(/i\.owner_id = v_line\.owner_id or i\.owner_id is null/.test(fnBlock('pur_move_stock')), 'stock items stay inside the company (own, or unowned legacy)');
  assert(/p_carry/.test(fnBlock('pur_insert')) && /v_carry/.test(fnBlock('pur_replace')), 'a replacement carries the stock already moved');
});

test('nothing outside the money model is touched (reimbursements, warranty, quotations, allocations)', () => {
  for (const t of ['reimbursements', 'warranty_', 'quotations', 'project_control_billing_allocations', 'overhead_expenses'])
    assert(!C.includes(t), '0096 mentions ' + t);
});

console.log('\nDacs Web around it');

test('Add expense records through pur_record and decides no funding, Cover or stock itself', () => {
  const add = between(EXP, 'async function handleAddExpense(', '\nasync function deleteExpense(');
  assert(add.includes("rpc('pur_record'"), 'Add expense must call pur_record');
  assert(!/sortedSources|\.remain\b|coverExpense/.test(add), 'Add expense still decides funding or Cover itself');
  assert(!add.includes('_addExpenseToInventory('), 'the stock update must be the server\'s (once per line), never the browser\'s');
  assert(/data && data\.replayed/.test(add), 'handleAddExpense must read replayed and warn that later form edits were not applied');
});

test('the old browser stock writer is gone (the server owns stock now)', () => {
  assert(!EXP.includes('_addExpenseToInventory'), '_addExpenseToInventory must not come back');
});

test('staff never see a budget-based Cover guess (they cannot read budgets; the server funds it)', () => {
  const b = between(EXP, 'function _updateExpBudgetBanner(', '\nfunction expFundingCheckChanged(');
  const staff = b.indexOf("window.currentUserRole === 'staff'");
  assert(staff !== -1 && staff < b.indexOf('const folderMonths'), 'staff must return before the budget-based banner');
  const list = between(EXP, 'const _coverSet = new Set();', 'const _renderExpRow');
  assert(/if \(window\.currentUserRole !== 'staff'\)/.test(list), 'the list guess must skip staff');
  assert(/if \(e\.purchaseLineId \|\| e\.purchaseChargeId\) return;/.test(list), 'purchase rows must keep their real Cover flag');
});

test('purchase-made rows are edited and deleted through their purchase', () => {
  const del = between(EXP, 'async function deleteExpense(', '\nwindow.expToggleInventoryFields = function');
  const voidAt = del.indexOf("rpc('pur_void'");
  assert(voidAt !== -1 && voidAt < del.indexOf("showDeleteConfirm('Delete this expense?')"), 'delete must void a purchase row first');
  const save = between(EXP, 'async function _purSaveCorrection(', '\nasync function handleEditExpense(');
  assert(save.includes("rpc('pur_correct'") && save.includes('p_reason: reason'), 'edit must correct through pur_correct with a reason');
  const edit = between(EXP, 'async function handleEditExpense(', '\n// ════');
  const gate = edit.indexOf('if (_editingPurchase) return _purSaveCorrection();');
  assert(gate !== -1 && gate < edit.indexOf('.update(updateData)'), 'a purchase row must never reach the plain update');
});

test('no-period rows reach every Spent site: Project Control cards, detail, Additional Works, periods, Expenses, reports', () => {
  assert(/folderId: d\.projectId \? null : d\.folderId \|\| null/.test(PC), 'mapExpenseDoc must carry folderId');
  assert(PC.includes('childIds.has(e.projectId) || !e.projectId && e.folderId === f.id'), 'project cards');
  assert(PC.includes('childMonthIds.has(e.projectId) || !e.projectId && e.folderId === projectId'), 'project detail');
  assert(PC.includes('cfMonthIds.has(e.projectId) || !e.projectId && e.folderId === cf.id'), 'Additional Works cards');
  assert(/const totalSpent = cards\.reduce\(\(sum, c\) => sum \+ c\.totalCost, 0\) \+ noPeriodSpent;/.test(PC), 'billing-period drill total');
  assert(/where\('folderId', '==', folderId\)/.test(between(EXP, 'function subscribeFolderData(', '\n}\n')), 'Expenses folder view');
  const model = between(EXP, 'function _pcReportModel(', '\nfunction _pcDashboardReport(');
  assert(/noPeriodMaterial/.test(model) && /mats:sum\(rows, 'mats'\) \+ noPeriodMaterial/.test(model)
      && /cover:sum\(rows, 'cover'\) \+ noPeriodMaterial/.test(model), 'shared report model (Reports, KPI, prints, CSV)');
  assert(/No billing period \(Cover\)/.test(between(EXP, 'function exportRptTable(', '\nfunction ')), 'CSV line');
  assert(/No billing period \(Cover\)/.test(between(EXP, 'function _pcPrintFundingSummary(', '\nfunction ')), 'printed line');
  for (const [fn, marker] of [['function updateDashboardBudget(', '_expNoPeriodSpent(null)'], ['function renderProjectPanel(', '_expNoPeriodSpent(fid)'],
                              ['function mvpRenderFolderGrid(', '_expNoPeriodSpent(folder.id)'], ['function mvpRenderOvFolderDetail(', '_expNoPeriodRows(null)']])
    assert(between(EXP, fn, '\nfunction ').includes(marker), fn + ' must add the no-period purchases');
});

test('deleting asks about live purchases before the confirm and before anything is removed', () => {
  for (const fn of ['async function deleteFolder(', 'async function deleteProject(']) {
    const b = between(EXP, fn, '\nasync function ');
    const pre = b.indexOf("rpc('pur_live_purchases'"), confirm = b.indexOf('showDeleteConfirm('), first = b.search(/db\.collection\(|db\.batch\(/);
    assert(pre !== -1 && pre < confirm && pre < first, fn + ' must check purchases first');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
````

**New file `tests/purchase-screens.test.js`:**

````js
// ════════════════════════════════════════════════════════════════════
// PURCHASE SCREENS (0096):  node tests/purchase-screens.test.js
//
// Zero dependencies. Runs the REAL js/expenses-module.js in a sandbox with a
// fake database and checks what the screens show:
//   1. a ₱700 purchase on a project with NO billing period (expenses.folderId,
//      no projectId) counts — once — in the dashboard, the overview cards,
//      the folder list, the Budget Overview folder cards and the folder detail;
//   2. deleting a project or billing period with a live purchase asks the
//      server FIRST and removes nothing.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const A = require('../js/billing-allocation.js');
const expensesSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'expenses-module.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
const tick = () => new Promise(r => setImmediate(r));

function harness({ rpc, collections }) {
  const elements = {};
  const el = id => elements[id] || (elements[id] = { innerHTML: '', textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, getContext() { return this; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, dataset: {} });
  const notes = [], dbCalls = [];
  const snap = (rows) => ({ docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }), ref: { delete: async () => {} } })), size: rows.length, empty: !rows.length });
  const query = (name) => {
    const q = { where: () => q, limit: () => q, get: async () => { dbCalls.push(name); return snap((collections || {})[name] || []); },
                onSnapshot: (next) => { next(snap((collections || {})[name] || [])); return () => {}; } };
    return q;
  };
  const context = vm.createContext({ console: { log() {}, error() {}, warn() {} }, ...A,
    window: { currentUserRole: 'owner', sbClient: { rpc: async (name, args) => rpc(name, args) },
      location: { href: 'https://example.test/admin.html', origin: 'https://example.test' } },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
      createElement: () => ({ click() {}, style: {} }), body: { style: {}, appendChild() {}, removeChild() {} } },
    Chart: class { destroy() {} }, setTimeout() {}, clearTimeout() {} });
  vm.runInContext(expensesSource, context);
  context.db = { collection: (name) => ({ ...query(name), doc: () => ({ delete: async () => { dbCalls.push('delete:' + name); } }) }),
                 batch: () => ({ delete() { dbCalls.push('batch.delete'); }, commit: async () => { dbCalls.push('batch.commit'); } }) };
  context.currentUser = { uid: 'owner' };
  vm.runInContext(`
    _uid = () => 'owner';
    showExpNotif = (m) => __notes.push(m);
    showDeleteConfirm = async () => { __notes.push('CONFIRM'); return true; };
    loadProjects = async () => {};
  `, Object.assign(context, { __notes: notes }));
  return { context, el, notes, dbCalls };
}

const PROJECTS = `
  expFolders = [{id:'f',name:'With periods',totalBudget:10000}, {id:'np',name:'No period',totalBudget:1000}];
  expProjects = [{id:'p',folderId:'f',month:'October',year:2026,monthlyBudget:5000},
                 {id:'c',folderId:'f',month:'October',year:2026,fundingType:'president'}];
  _rptOvhdRows = [];
`;
const EXPENSES = [
  { id: 'e1', projectId: 'p', amount: 300, dateTime: '2026-10-14T09:00' },
  { id: 'e2', projectId: 'c', amount: 50, dateTime: '2026-10-14T09:00', coverExpense: true },
  { id: 'np1', folderId: 'np', amount: 700, dateTime: '2026-10-14T09:00', coverExpense: true, purchaseLineId: 'L1' }
];

(async () => {
  console.log('\npurchase screens (0096)');

  await test('dashboard and overview cards count a no-period purchase once (₱300 + ₱50 + ₱700 = ₱1,050)', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    h.context.subscribeOvAllData();
    await tick(); await tick();
    ok(h.el('dashTotalSpent').textContent === '₱1,050.00', 'dashboard Total Spent: ' + h.el('dashTotalSpent').textContent);
    ok(h.el('mvpTotalSpent').textContent === '₱1,050.00', 'overview Total Spent: ' + h.el('mvpTotalSpent').textContent);
  });

  await test('folder list: the no-period project shows its ₱700 against its ₱1,000 contract (70%)', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    h.context.subscribeOvAllData();
    await tick(); await tick();
    h.context.renderProjectPanel('expOverviewList');
    const html = h.el('expOverviewList').innerHTML;
    const np = html.slice(html.indexOf('No period'));
    ok(/width:70\.0%/.test(np), 'the no-period folder bar must read 70%: ' + (np.match(/width:[0-9.]+%/) || ['none'])[0]);
  });

  await test('Budget Overview folder cards: Spent and Cover include the no-period purchase', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    h.context.subscribeOvAllData();
    await tick(); await tick();
    h.context.mvpRenderFolderGrid();
    const html = h.el('mvpFolderGrid').innerHTML;
    const np = html.slice(html.indexOf('No period'));
    ok(np.includes('700.00'), 'the no-period folder card must show ₱700');
    const f = html.slice(html.indexOf('With periods'), html.indexOf('No period'));
    ok(f.includes('350.00') && !f.includes('1,050.00'), 'the other folder keeps its own ₱350, never the ₱700');
  });

  await test('folder detail: the no-period purchase is in Material, Spent and the transaction count', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    h.context.subscribeOvAllData();
    await tick(); await tick();
    vm.runInContext(`expExpenses = _ovAllExpenses;`, h.context);
    h.context.mvpRenderOvFolderDetail('np');
    ok(h.el('mvpOvKpiMatVal').textContent.includes('700.00'), 'Material: ' + h.el('mvpOvKpiMatVal').textContent);
    ok(/^1 transaction/.test(h.el('mvpOvKpiMatSub2').textContent), 'count: ' + h.el('mvpOvKpiMatSub2').textContent);
  });

  await test('deleting a project with a live purchase asks the server first and removes NOTHING', async () => {
    const calls = [];
    const h = harness({ rpc: async (name, args) => { calls.push(name); return { data: name === 'pur_live_purchases' ? 1 : 0, error: null }; },
                        collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    await h.context.deleteFolder('f');
    ok(calls.includes('pur_live_purchases'), 'the purchase pre-check must run');
    ok(!h.notes.includes('CONFIRM'), 'it must stop before the confirm');
    ok(h.dbCalls.length === 0, 'nothing may be read or deleted: ' + h.dbCalls.join(','));
    ok(h.notes.some(n => /purchase\(s\), so it cannot be deleted/.test(n)), 'the user is told why');
  });

  await test('deleting a billing period with a live purchase asks the server first and removes NOTHING', async () => {
    const h = harness({ rpc: async (name, args) => ({ data: name === 'pur_live_purchases' && args.p_period === 'p' ? 2 : 0, error: null }),
                        collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    await h.context.deleteProject('p');
    ok(!h.notes.includes('CONFIRM') && h.dbCalls.length === 0, 'nothing may be deleted: ' + h.dbCalls.join(','));
  });

  await test('when the pre-check itself fails, nothing is deleted either', async () => {
    const h = harness({ rpc: async (name) => name === 'pur_live_purchases' ? { data: null, error: { message: 'network' } } : { data: 0, error: null },
                        collections: { expenses: EXPENSES, payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    await h.context.deleteFolder('f');
    await h.context.deleteProject('p');
    ok(!h.notes.includes('CONFIRM') && h.dbCalls.length === 0, 'nothing may be deleted');
  });

  await test('with no live purchase, deleting goes ahead as before', async () => {
    const h = harness({ rpc: async () => ({ data: 0, error: null }), collections: { expenses: [], payroll: [] } });
    vm.runInContext(PROJECTS, h.context);
    await h.context.deleteProject('p');
    ok(h.notes.includes('CONFIRM') && h.dbCalls.includes('batch.commit'), 'the normal delete must still run');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
````

- [ ] **Step 2: Run them. The web checks fail.**

Run: `node tests/purchase-server.test.js; node tests/purchase-screens.test.js`
Expected:
- `18 passed, 9 failed`: the nine "Dacs Web around it" checks. The first is "Project Control Additional Works delete asks about purchases before the confirm".
- then `1 passed, 7 failed`. The first is dashboard Total Spent "₱350.00" instead of "₱1,050.00".

- [ ] **Step 3: Expenses: record, correct and void through the purchase; read no-period rows everywhere; check purchases before deleting.** Apply each edit in order; each "Find" block occurs exactly once.

**Edit 1 of 33 — `js/expenses-module.js`.** Find:

````text
    _pcAdjustmentRows = [];
    // Start global overview subscription
    subscribeOvAllData();

    // Confidential financials are owner-only. Subscribe to them only when the
    // current user is NOT staff; staff sessions keep empty maps so contract
````

Replace with:

````text
    _pcAdjustmentRows = [];
    // Start global overview subscription
    subscribeOvAllData();
    _purLoadReviewFlags();

    // Confidential financials are owner-only. Subscribe to them only when the
    // current user is NOT staff; staff sessions keep empty maps so contract
````

**Edit 2 of 33 — `js/expenses-module.js`.** Find:

````text
function updateDashboardBudget() {
    const totalContract  = expFolders.reduce((s, f) => s + (f.totalBudget || 0), 0);
    const totalAllocated = expProjects.reduce((s, p) => s + (p.monthlyBudget || 0), 0);
    const totalSpent     = expProjects.reduce((s, p) => s + (p._spent || 0), 0);
    const remaining      = totalAllocated - totalSpent;
    const spentPct       = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;
    const remPct         = totalAllocated > 0 ? Math.max(0, 100 - spentPct) : 0;
````

Replace with:

````text
function updateDashboardBudget() {
    const totalContract  = expFolders.reduce((s, f) => s + (f.totalBudget || 0), 0);
    const totalAllocated = expProjects.reduce((s, p) => s + (p.monthlyBudget || 0), 0);
    // …plus purchases on projects with no billing period (0096).
    const totalSpent     = expProjects.reduce((s, p) => s + (p._spent || 0), 0) + _expNoPeriodSpent(null);
    const remaining      = totalAllocated - totalSpent;
    const spentPct       = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;
    const remPct         = totalAllocated > 0 ? Math.max(0, 100 - spentPct) : 0;
````

**Edit 3 of 33 — `js/expenses-module.js`.** Find:

````text

    // ── MVP Dashboard Stacked Bar ────────────────────────────
    // We need mat/lab breakdown; use totals from expProjects
    const _totalMat = expProjects.reduce((s, p) => s + (p._matSpent || 0), 0);
    const _totalLab = expProjects.reduce((s, p) => s + (p._labSpent || 0), 0);
    const _base = totalAllocated > 0 ? totalAllocated : 1;
    const _matP = Math.min((_totalMat / _base) * 100, 100);
````

Replace with:

````text

    // ── MVP Dashboard Stacked Bar ────────────────────────────
    // We need mat/lab breakdown; use totals from expProjects
    const _totalMat = expProjects.reduce((s, p) => s + (p._matSpent || 0), 0) + _expNoPeriodSpent(null);
    const _totalLab = expProjects.reduce((s, p) => s + (p._labSpent || 0), 0);
    const _base = totalAllocated > 0 ? totalAllocated : 1;
    const _matP = Math.min((_totalMat / _base) * 100, 100);
````

**Edit 4 of 33 — `js/expenses-module.js`.** Find:

````text
        var isExpanded   = _expandedFolders.has(fid);
        var folderProjs        = expProjects.filter(function(p){ return p.folderId === fid; });
        var totalMonthlyBudget = folderProjs.reduce(function(s,p){ return s+(p.monthlyBudget||0); }, 0);
        var totalSpent   = folderProjs.reduce(function(s,p){ return s+(p._spent||0); }, 0);
        var usedPct      = folderBudget > 0 ? Math.min((totalSpent/folderBudget)*100, 100) : 0;
        var barColor     = usedPct>90?'#ef4444':usedPct>70?'#f59e0b':'#059669';
        var chevCls      = isExpanded ? 'exp-folder-chevron expanded' : 'exp-folder-chevron';
````

Replace with:

````text
        var isExpanded   = _expandedFolders.has(fid);
        var folderProjs        = expProjects.filter(function(p){ return p.folderId === fid; });
        var totalMonthlyBudget = folderProjs.reduce(function(s,p){ return s+(p.monthlyBudget||0); }, 0);
        var totalSpent   = folderProjs.reduce(function(s,p){ return s+(p._spent||0); }, 0) + _expNoPeriodSpent(fid);
        var usedPct      = folderBudget > 0 ? Math.min((totalSpent/folderBudget)*100, 100) : 0;
        var barColor     = usedPct>90?'#ef4444':usedPct>70?'#f59e0b':'#059669';
        var chevCls      = isExpanded ? 'exp-folder-chevron expanded' : 'exp-folder-chevron';
````

**Edit 5 of 33 — `js/expenses-module.js`.** Find:

````text
    const projectIds = expProjects
        .filter(p => p.folderId === folderId)
        .map(p => p.id);
    if (projectIds.length === 0) { updateBudgetOverview(); return; }

    // Firestore 'in' supports up to 30 values; chunk if needed
````

Replace with:

````text
    const projectIds = expProjects
        .filter(p => p.folderId === folderId)
        .map(p => p.id);

    // A purchase on a project with NO billing period is tied to the project
    // itself (expenses.folderId, no projectId — migration 0096). It matches no
    // period id below, so it is loaded on its own — even with no period at all.
    let allExpenses = [];
    let folderRows  = [];
    const unsubFolderRows = db.collection('expenses')
        .where('folderId', '==', folderId)
        .where('userId', '==', _uid())
        .onSnapshot(snap => {
            folderRows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.projectId);
            expExpenses = allExpenses.concat(folderRows);
            updateBudgetOverview(); populateMonthDropdown(); renderExpensesTable();
        }, err => console.error('folder expenses:', err));
    expUnsubscribers.push(unsubFolderRows);
    if (projectIds.length === 0) { updateBudgetOverview(); return; }

    // Firestore 'in' supports up to 30 values; chunk if needed
````

**Edit 6 of 33 — `js/expenses-module.js`.** Find:

````text
    for (let i = 0; i < projectIds.length; i += 30)
        chunks.push(projectIds.slice(i, i + 30));

    let allExpenses = [];
    let allPayroll  = [];
    let expDone = 0, payDone = 0;
    const total = chunks.length;
````

Replace with:

````text
    for (let i = 0; i < projectIds.length; i += 30)
        chunks.push(projectIds.slice(i, i + 30));

    let allPayroll  = [];
    let expDone = 0, payDone = 0;
    const total = chunks.length;
````

**Edit 7 of 33 — `js/expenses-module.js`.** Find:

````text
                const ids = new Set(chunk);
                allExpenses = allExpenses.filter(e => !ids.has(e.projectId));
                snap.docs.forEach(d => allExpenses.push({ id: d.id, ...d.data() }));
                expExpenses = allExpenses;
                expDone++;
                if (expDone >= total) { updateBudgetOverview(); populateMonthDropdown(); renderExpensesTable(); }
            });
````

Replace with:

````text
                const ids = new Set(chunk);
                allExpenses = allExpenses.filter(e => !ids.has(e.projectId));
                snap.docs.forEach(d => allExpenses.push({ id: d.id, ...d.data() }));
                expExpenses = allExpenses.concat(folderRows);
                expDone++;
                if (expDone >= total) { updateBudgetOverview(); populateMonthDropdown(); renderExpensesTable(); }
            });
````

**Edit 8 of 33 — `js/expenses-module.js`.** Find:

````text
    if (_fid && _periodMonth && _periodYear) {
        periodExpenses = expExpenses.filter(e => {
            if (!e.dateTime) return false;
            const d = new Date(e.dateTime);
            return _monthNames[d.getMonth()] === _periodMonth && d.getFullYear() === Number(_periodYear);
        });
````

Replace with:

````text
    if (_fid && _periodMonth && _periodYear) {
        periodExpenses = expExpenses.filter(e => {
            if (!e.dateTime) return false;
            // A no-period purchase (0096) belongs to no period; the panels add it separately.
            if (!e.projectId && e.folderId) return false;
            const d = new Date(e.dateTime);
            return _monthNames[d.getMonth()] === _periodMonth && d.getFullYear() === Number(_periodYear);
        });
````

**Edit 9 of 33 — `js/expenses-module.js`.** Find:

````text
        _projExpMap[e.projectId].push(e);
    });
    const _coverSet = new Set();
    Object.keys(_projExpMap).forEach(pid => {
        const proj = expProjects.find(p => p.id === pid);
        if (!proj || proj.fundingType === 'president') return;
        const budget = proj.monthlyBudget || 0;
````

Replace with:

````text
        _projExpMap[e.projectId].push(e);
    });
    const _coverSet = new Set();
    // Staff cannot read budgets — every budget reads 0 to them — so this guess
    // would tag every row Cover. Purchase rows (0096) carry their real Cover
    // flag from the server and are never guessed.
    if (window.currentUserRole !== 'staff') Object.keys(_projExpMap).forEach(pid => {
        const proj = expProjects.find(p => p.id === pid);
        if (!proj || proj.fundingType === 'president') return;
        const budget = proj.monthlyBudget || 0;
````

**Edit 10 of 33 — `js/expenses-module.js`.** Find:

````text
        let cum = 0;
        sorted.forEach(e => {
            cum += (e.amount || 0);
            if (e.coverExpense || cum > budget) _coverSet.add(e.id);
        });
    });
````

Replace with:

````text
        let cum = 0;
        sorted.forEach(e => {
            cum += (e.amount || 0);
            if (e.purchaseLineId || e.purchaseChargeId) return;
            if (e.coverExpense || cum > budget) _coverSet.add(e.id);
        });
    });
````

**Edit 11 of 33 — `js/expenses-module.js`.** Find:

````text
        const fundingBadge = (_coverSet.has(e.id) || e.coverExpense) ? _fundingBadgeHTML(null, true) : (srcProj ? _fundingBadgeHTML(srcProj, false) : '');
        const catBadge = showCategoryBadge ? getCategoryPillHTML(e.category) : '';
        const invBadge = e.inInventory ? '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 7px;border-radius:999px;background:#ecfdf5;color:#15803d;font-size:10.5px;font-weight:700;border:1px solid #a7f3d0;">📦 In Inventory</span>' : '';
        return `
        <tr class="exp-group-row">
            <td>${formatDate(e.dateTime)}</td>
            <td><strong>${_highlightMatch(e.expenseName || '—', name)}</strong>${catBadge}${fundingBadge}${invBadge}</td>
            <td class="exp-notes-cell">${e.notes ? '<span class="exp-notes-text">' + e.notes + '</span>' : '<span class="exp-notes-empty">—</span>'}</td>
            <td>${e.quantity || 1}</td>
            <td>₱${formatNum(e.amount)}</td>
````

Replace with:

````text
        const fundingBadge = (_coverSet.has(e.id) || e.coverExpense) ? _fundingBadgeHTML(null, true) : (srcProj ? _fundingBadgeHTML(srcProj, false) : '');
        const catBadge = showCategoryBadge ? getCategoryPillHTML(e.category) : '';
        const invBadge = e.inInventory ? '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 7px;border-radius:999px;background:#ecfdf5;color:#15803d;font-size:10.5px;font-weight:700;border:1px solid #a7f3d0;">📦 In Inventory</span>' : '';
        const purBadge = (e.purchaseLineId || e.purchaseChargeId)
            ? '<span title="Recorded as a purchase — edit or void it to change it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10.5px;font-weight:700;border:1px solid #c7d2fe;">From purchase</span>'
              + (_purReviewLines.has(e.purchaseLineId) ? '<span title="No billing period for its month — charged to Cover until the office reviews it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:10.5px;font-weight:700;border:1px solid #fed7aa;">Office review</span>' : '')
            : '';
        return `
        <tr class="exp-group-row">
            <td>${formatDate(e.dateTime)}</td>
            <td><strong>${_highlightMatch(e.expenseName || '—', name)}</strong>${catBadge}${fundingBadge}${invBadge}${purBadge}</td>
            <td class="exp-notes-cell">${e.notes ? '<span class="exp-notes-text">' + e.notes + '</span>' : '<span class="exp-notes-empty">—</span>'}</td>
            <td>${e.quantity || 1}</td>
            <td>₱${formatNum(e.amount)}</td>
````

**Edit 12 of 33 — `js/expenses-module.js`.** Find:

````text
        showExpNotif('Could not check this project for WorkMate requests, so nothing was deleted. ' + (err.message || err), 'error');
        return;
    }
    const count  = expProjects.filter(p => p.folderId === id).length;
    const msg    = count > 0
        ? `Delete folder "${folder?.name}" and its ${count} month(s)? All expenses & payroll inside will also be deleted.`
````

Replace with:

````text
        showExpNotif('Could not check this project for WorkMate requests, so nothing was deleted. ' + (err.message || err), 'error');
        return;
    }
    // Purchases (0096): a project with a LIVE purchase — even one discounted to
    // zero — cannot be deleted; the database refuses it too. Asked here, before
    // anything is removed, so the loop below can never stop half-way.
    try {
        const { data: purCount, error: purErr } = await window.sbClient.rpc('pur_live_purchases', { p_folder: id, p_period: null });
        if (purErr) throw purErr;
        if (purCount > 0) {
            showExpNotif(`"${folder?.name}" has ${purCount} purchase(s), so it cannot be deleted. Void them first, or mark the project completed.`, 'error');
            return;
        }
    } catch (err) {
        showExpNotif('Could not check this project for purchases, so nothing was deleted. ' + _purErrorText(err), 'error');
        return;
    }
    const count  = expProjects.filter(p => p.folderId === id).length;
    const msg    = count > 0
        ? `Delete folder "${folder?.name}" and its ${count} month(s)? All expenses & payroll inside will also be deleted.`
````

**Edit 13 of 33 — `js/expenses-module.js`.** Find:

````text
}

async function deleteProject(id) {
    if (!await showDeleteConfirm('Delete this project and ALL its expenses & payroll?')) return;
    try {
        const uid = _uid();
````

Replace with:

````text
}

async function deleteProject(id) {
    // A billing period carrying a LIVE purchase cannot be deleted (0096); asked
    // before the confirm and before anything is removed.
    try {
        const { data: purCount, error: purErr } = await window.sbClient.rpc('pur_live_purchases', { p_folder: null, p_period: id });
        if (purErr) throw purErr;
        if (purCount > 0) {
            showExpNotif(`This billing period carries ${purCount} purchase(s), so it cannot be deleted. Void them first.`, 'error');
            return;
        }
    } catch (err) {
        showExpNotif('Could not check this billing period for purchases, so nothing was deleted. ' + _purErrorText(err), 'error');
        return;
    }
    if (!await showDeleteConfirm('Delete this project and ALL its expenses & payroll?')) return;
    try {
        const uid = _uid();
````

**Edit 14 of 33 — `js/expenses-module.js`.** Find:

````text
let _expSubmissionId = null;
let _paySubmissionId = null;

// All rows in ONE insert (all-or-nothing). If this submission already landed
// (a retry after the response was lost), the unique index answers 23505 —
// confirm the rows exist and report 'already' instead of saving twice.
````

Replace with:

````text
let _expSubmissionId = null;
let _paySubmissionId = null;

// ════════════════════════════════════════════════════════════
// PURCHASES (migration 0096) — one server operation records them
// ════════════════════════════════════════════════════════════
// Add expense records a one-line purchase through pur_record. The SERVER
// picks the billing periods from the actual purchase month — earliest
// billing number first, any shortage to Cover, no period that month → Cover
// flagged for office review, no Cover period and no period that month → a Cover row
// tied to the project itself (expenses.folder_id, no period), flagged;
// Additional Works in full on their own period — for owner and staff alike
// (staff cannot read the budgets, the server can). Nothing is split in the
// browser, and the stock update ("track in inventory") is the server's too.
// Rows made by a purchase change only through pur_correct / pur_refund /
// pur_void; the database refuses any other write.

// "YYYY-MM-DD" from LOCAL date parts (PH is UTC+8 — never toISOString).
function _purLocalDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Server refusals in plain words. Unknown errors keep their own message.
function _purErrorText(err) {
    const m = String((err && (err.message || err.code)) || err || '');
    if (err && err.code === 'PGRST202') return 'The server is not updated for purchases yet (migration 0096) — nothing was changed.';
    const known = {
        AW_NO_PERIOD:          'This Additional Works job has no billing period yet — add one first.',
        COMPLETED_PROJECT:     'This project is marked completed — only the owner can add or change its costs.',
        OWNER_APPROVAL_NEEDED: 'Moving a cost to another project needs the owner.',
        NOT_OFFICE:            'Only office accounts can record expenses.',
        NOT_ALLOWED:           'This account is not set up for Expenses.',
        BUYER_REQUIRED:        'Phone purchasing needs the Buyer switch (not available yet).',
        PURCHASES_LIVE:        'It has purchases — void them first.',
        REASON_REQUIRED:       'Please give a reason.',
        BAD_STATE:             'This purchase was already voided.',
        LINES_CHANGED:         'This purchase has several items — it cannot be changed from here.',
        BAD_DATE:              'Check the date.',
        BAD_AMOUNT:            'Check the amount (pesos and centavos only).',
        BAD_NAME:              'Give the expense a name.',
        BAD_QUANTITY:          'Quantity must be more than zero.',
        BAD_PROJECT:           'This project no longer exists or belongs to another account — refresh the page.',
        NOT_FOUND:             'That purchase or project was not found — refresh the page.',
        PURCHASE_ROW:          'This row was made by a purchase — use Edit or Void on it instead.',
        TOTAL_MISMATCH:        'The items and fees do not add up to the receipt total.',
        BAD_LINES:             'Check the item lines.',
    };
    const code = Object.keys(known).find(k => m.includes(k));
    return code ? known[code] : (err && err.hint) || m;
}

// A short reason dialog (correction or void). Resolves the trimmed text, or
// null when cancelled. Same look as the labor-contract dialogs (.lcm-*).
function _purAskReason(title, sub, okLabel) {
    return new Promise(resolve => {
        const old = document.getElementById('purReasonOverlay');
        if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'purReasonOverlay';
        ov.className = 'lcm-ov';
        ov.innerHTML = `
            <div class="lcm-card" style="max-width:420px;">
              <div class="lcm-head"><div><h3 class="lcm-title">${_mvpEsc(title)}</h3><div class="lcm-sub">${_mvpEsc(sub)}</div></div>
                <button type="button" class="lcm-x" data-pr-close aria-label="Close">&times;</button></div>
              <div class="lcm-body">
                <label for="purReasonInput" style="font-size:12.5px;font-weight:600;color:#3A3A3C;">Reason (kept in the purchase history)</label>
                <textarea id="purReasonInput" rows="3" maxlength="500" style="width:100%;margin-top:6px;border:1.5px solid #d1d5db;border-radius:8px;padding:8px 10px;font:inherit;"></textarea>
              </div>
              <div class="lcm-foot"><button type="button" class="lcm-btn" data-pr-close>Cancel</button>
                <button type="button" class="lcm-btn primary" id="purReasonOk">${_mvpEsc(okLabel)}</button></div>
            </div>`;
        const done = (v) => { ov.remove(); resolve(v); };
        ov.onclick = e => { if (e.target === ov) done(null); };
        ov.querySelectorAll('[data-pr-close]').forEach(b => b.onclick = () => done(null));
        ov.querySelector('#purReasonOk').onclick = () => {
            const v = ov.querySelector('#purReasonInput').value.trim();
            if (!v) { ov.querySelector('#purReasonInput').focus(); return; }
            done(v);
        };
        document.body.appendChild(ov);
        ov.querySelector('#purReasonInput').focus();
    });
}

// The purchase behind a purchase-made expense row, with its one line.
// Null when the row is not from a purchase. `simple` = one line, no charges:
// the only shape the Expenses form can correct.
async function _purForRow(e) {
    if (!e || (!e.purchaseLineId && !e.purchaseChargeId)) return null;
    const sb = window.sbClient;
    let purchaseId = null, line = null;
    if (e.purchaseLineId) {
        const r = await sb.from('purchase_lines')
            .select('id, purchase_id, line_no, folder_id, item_name, category, quantity, unit, gross_amount, in_inventory, min_stock')
            .eq('id', e.purchaseLineId).single();
        if (r.error) throw r.error;
        line = r.data; purchaseId = line.purchase_id;
    } else {
        const r = await sb.from('purchase_charges').select('purchase_id').eq('id', e.purchaseChargeId).single();
        if (r.error) throw r.error;
        purchaseId = r.data.purchase_id;
    }
    const [p, lines, charges] = await Promise.all([
        sb.from('purchases').select('id, status, purchase_date, date_time, supplier, receipt_total, notes, payment_method, docs').eq('id', purchaseId).single(),
        sb.from('purchase_lines').select('id', { count: 'exact', head: true }).eq('purchase_id', purchaseId),
        sb.from('purchase_charges').select('id', { count: 'exact', head: true }).eq('purchase_id', purchaseId),
    ]);
    if (p.error) throw p.error;
    return { purchase: p.data, line, lineCount: lines.count || 0, simple: !!line && lines.count === 1 && (charges.count || 0) === 0 };
}

// A purchase on a project with NO billing period (0096) is tied to the project
// itself (folderId, no projectId) — it belongs to no period, so the period-
// by-period sums (p._spent) never see it. It is spent, though: every folder-
// and company-level total adds it, once. folderId null = every project.
function _expNoPeriodRows(folderId) {
    const src = _ovAllExpenses.length ? _ovAllExpenses : expExpenses;
    return src.filter(e => !e.projectId && e.folderId && (folderId == null || e.folderId === folderId));
}
function _expNoPeriodSpent(folderId) {
    return _expNoPeriodRows(folderId).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
}

// Lines the server charged to Cover because their month had no billing
// period (Q23) — shown as "Office review" in the Expenses list.
let _purReviewLines = new Set();
async function _purLoadReviewFlags() {
    try {
        const { data, error } = await window.sbClient.from('purchase_lines').select('id').eq('needs_funding_review', true);
        if (error) throw error;
        _purReviewLines = new Set((data || []).map(r => r.id));
    } catch (err) { console.warn('purchase review flags:', err); }
}

// Set while the Edit Expense modal is correcting a purchase (else null).
let _editingPurchase = null;
let _purEditOpId = null;

// All rows in ONE insert (all-or-nothing). If this submission already landed
// (a retry after the response was lost), the unique index answers 23505 —
// confirm the rows exist and report 'already' instead of saving twice.
````

**Edit 15 of 33 — `js/expenses-module.js`.** Find:

````text
async function handleAddExpense(e) {
    e.preventDefault();

    // Auto-pick the billing period this expense is charged to (the "Which budget
    // pays for this?" picker was removed). Preference mirrors what that picker
    // defaulted to, so behaviour is unchanged in the common single-period case:
    //   1. Additional Works       → the current period (no monthly-budget concept)
    //   2. the active period       → if it still has remaining budget
    //   3. the first fundable one  → otherwise
    //   4. nothing fundable left   → Cover Expenses (the overflow logic below still runs)
    const checkedSources = [];
    if (_expIsAdditionalWorks() && expCurrentProject) {
        checkedSources.push({ id: expCurrentProject.id, remain: Infinity, label: 'Additional Works' });
    } else {
        const fundable = (_expSources || []).filter(s => s.remain > 0);
        const active   = expCurrentProject && fundable.find(s => s.id === expCurrentProject.id);
        const pick     = active || fundable[0] || null;
        if (pick) {
            checkedSources.push(pick);
        } else {
            // No remaining budget anywhere → record as a Cover Expense.
            const fsSel      = document.getElementById('expFundingSourceSelect');
            const fallbackId = (fsSel && fsSel.value) ? fsSel.value : (expCurrentProject ? expCurrentProject.id : null);
            if (!fallbackId) { showExpNotif('No billing period to charge this to — add a billing period first.', 'error'); return; }
            checkedSources.push({ id: fallbackId, remain: 0, label: 'Cover Expenses' });
        }
    }

    const totalAmt   = parseFloat((document.getElementById('expAmount').value || '').replace(/,/g, '')) || 0;
    const expName    = document.getElementById('expName').value.trim();
    const category   = document.getElementById('expCategory').value;
    const qty        = parseFloat(document.getElementById('expQty').value) || 1;
    const dateTime   = _buildDateTime('expDate', 'expTime');
    const notes      = document.getElementById('expNotes').value.trim();
    const paymentMethod = (document.getElementById('expPaymentMethod')?.value || '').trim();
    // Inventory toggle — when on, this material is also tracked as a stock item.
    const toInventory = !!document.getElementById('expToInventory')?.checked;
    const invUnit     = document.getElementById('expInvUnit')?.value || 'pcs';
    const invMinStock = parseFloat(document.getElementById('expInvMinStock')?.value) || 0;

    // Priority split: lowest remaining first; true overflow → Cover Expenses record
    const sortedSources = [...checkedSources].sort((a, b) => a.remain - b.remain);
    let left = totalAmt;
    const splits = [];
    for (const s of sortedSources) {
        if (left <= 0) break;
        const charge = s.remain > 0 ? Math.min(s.remain, left) : 0;
        if (charge > 0) { left -= charge; splits.push({ projectId: s.id, amount: charge, coverExpense: false }); }
    }
    // Any remaining overflow → Cover Expenses (use current project id, flagged as cover)
    if (left > 0) {
        const fid = expCurrentProject?.folderId;
        const coverProj = fid ? expProjects.find(p => p.folderId === fid && p.fundingType === 'president') : null;
        const coverId = coverProj?.id || expCurrentProject?.id || splits[splits.length - 1]?.projectId;
        splits.push({ projectId: coverId, amount: left, coverExpense: true });
    }

    try {
        showExpLoading('addExpenseBtn', true);
````

Replace with:

````text
async function handleAddExpense(e) {
    e.preventDefault();

    // The project this expense belongs to. The SERVER picks its billing
    // periods (see "PURCHASES (migration 0096)" above); nothing is split here.
    const folderId = expCurrentProject ? (expCurrentProject.folderId || null) : (expCurrentFolder ? expCurrentFolder.id : null);
    if (!folderId) { showExpNotif('Open a project first — this expense needs one.', 'error'); return; }

    const totalAmt   = Math.round((parseFloat((document.getElementById('expAmount').value || '').replace(/,/g, '')) || 0) * 100) / 100;
    const expName    = document.getElementById('expName').value.trim();
    const category   = document.getElementById('expCategory').value;
    const qty        = Math.round((parseFloat(document.getElementById('expQty').value) || 1) * 1000) / 1000 || 1;
    const dateTime   = _buildDateTime('expDate', 'expTime');
    const notes      = document.getElementById('expNotes').value.trim();
    const paymentMethod = (document.getElementById('expPaymentMethod')?.value || '').trim();
    // Inventory toggle — when on, this material is also tracked as a stock item.
    const toInventory = !!document.getElementById('expToInventory')?.checked;
    const invUnit     = document.getElementById('expInvUnit')?.value || 'pcs';
    const invMinStock = Math.round(Math.max(0, parseFloat(document.getElementById('expInvMinStock')?.value) || 0) * 1000) / 1000;
    // The ACTUAL purchase date decides the billing month (spec §3.3).
    const purchaseDate = dateTime ? dateTime.slice(0, 10) : _purLocalDateKey(new Date());

    try {
        showExpLoading('addExpenseBtn', true);
````

**Edit 16 of 33 — `js/expenses-module.js`.** Find:

````text
            if (file) docUrls[key] = await _uploadReceiptFile('expense', file);
        }

        if (!_expSubmissionId) _expSubmissionId = DacsReceipts.newId();
        const rows = splits.map((sp, idx) => ({
            projectId:     sp.projectId,
            userId:        _uid(),
            expenseName:   expName + (splits.length > 1 ? ' (' + (idx + 1) + '/' + splits.length + ')' : ''),
            category,
            quantity:      splits.length > 1 ? 1 : qty,
            amount:        sp.amount,
            dateTime,
            notes,
            ...(paymentMethod ? { paymentMethod } : {}),
            // Supporting documents (PO/DR/SI/PR) attached only to the first split record.
            ...(idx === 0 && docUrls.po  ? { poImageUrl:         docUrls.po  } : {}),
            ...(idx === 0 && docUrls.dr  ? { deliveryReceiptUrl: docUrls.dr  } : {}),
            ...(idx === 0 && docUrls.si  ? { supplierInvoiceUrl: docUrls.si  } : {}),
            ...(idx === 0 && docUrls.pay ? { paymentReceiptUrl:  docUrls.pay } : {}),
            createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
            clientSubmissionId: _expSubmissionId,
            ...(toInventory ? { inInventory: true } : {}),
            ...(sp.coverExpense && { coverExpense: true }),
            ...(splits.length > 1 && { splitGroup: dateTime + '_' + expName, splitIndex: idx + 1, splitTotal: splits.length })
        }));
        const outcome = await _saveRowsOnce('expenses', rows, _expSubmissionId);
        _expSubmissionId = null;
        if (outcome === 'already') {
            if (toInventory && expName) {
                try { await _addExpenseToInventory(expName, qty, invUnit, invMinStock, notes); }
                catch (e) { console.warn('Inventory sync failed:', e); showExpNotif('Saved, but inventory sync failed: ' + e.message, 'error'); }
            }
            showExpNotif('An earlier attempt of this expense was already saved — check the list; changes made since were not applied.', 'success');
            refreshOvAllData();
            document.getElementById('addExpenseForm').reset();
            document.getElementById('expSplitPreview').style.display = 'none';
            closeExpModal('addExpenseModal');
            return;
        }

        // Mirror to the shared Construction inventory when flagged as a stock item.
        if (toInventory && expName) {
            try { await _addExpenseToInventory(expName, qty, invUnit, invMinStock, notes); }
            catch (e) { console.warn('Inventory sync failed:', e); showExpNotif('Saved, but inventory sync failed: ' + e.message, 'error'); }
        }

        const msg = toInventory
            ? 'Expense added & sent to inventory ✓'
            : (splits.length > 1
                ? `Split into ${splits.length} records across funding sources ✓`
                : 'Expense added! ✓');
        showExpNotif(msg, 'success');
        refreshOvAllData();

        document.getElementById('addExpenseForm').reset();
        document.getElementById('expSplitPreview').style.display = 'none';
        if (typeof window.expToggleInventoryFields === 'function') window.expToggleInventoryFields();
        closeExpModal('addExpenseModal');
    } catch (err) {
        showExpNotif('Error saving expense: ' + err.message, 'error');
        console.error(err);
    } finally {
        showExpLoading('addExpenseBtn', false);
````

Replace with:

````text
            if (file) docUrls[key] = await _uploadReceiptFile('expense', file);
        }

        // One id per Save press: a resent request is recorded once (pur_ops).
        if (!_expSubmissionId) _expSubmissionId = DacsReceipts.newId();
        const body = {
            source: 'expenses_form',
            purchase_date: purchaseDate,
            date_time: dateTime || purchaseDate,
            receipt_total: totalAmt,
            notes,
            payment_method: paymentMethod,
            docs: {
                ...(docUrls.po  ? { po_image_url:         docUrls.po  } : {}),
                ...(docUrls.dr  ? { delivery_receipt_url: docUrls.dr  } : {}),
                ...(docUrls.si  ? { supplier_invoice_url: docUrls.si  } : {}),
                ...(docUrls.pay ? { payment_receipt_url:  docUrls.pay } : {}),
            },
            lines: [{ destination: 'project', folder_id: folderId, item_name: expName, category,
                      quantity: qty, unit: toInventory ? invUnit : '', amount: totalAmt,
                      in_inventory: toInventory, min_stock: toInventory ? invMinStock : 0 }],
            charges: [],
        };
        const { data, error } = await window.sbClient.rpc('pur_record', { p_op: _expSubmissionId, p_body: body });
        if (error) throw error;
        _expSubmissionId = null;

        // The stock update ("track in inventory") happens on the SERVER, inside
        // the same transaction and once per purchase line — never here, so a
        // retry or an overlapping save can never add the stock twice.
        const rows = (data && data.rows) || [];
        const review = (data && data.needs_review) || [];
        const noPeriod = rows.some(r => !r.period_id);
        // A replayed answer (a retry of a press that had already saved) is the
        // FIRST press's result: edits made to the form since were not applied.
        const msg = (data && data.replayed)
            ? 'An earlier attempt of this expense was already saved — check the list; changes made since were not applied.'
            : noPeriod
            ? 'Saved ✓ — this project has no billing period for that month yet, so it was charged to Cover for office review'
            : review.length
                ? 'Saved ✓ — no billing period for that month, so it was charged to Cover for office review'
                : (data && data.stock_moves)
                    ? 'Expense added & sent to inventory ✓'
                    : (rows.length > 1 ? `Split into ${rows.length} records across funding sources ✓` : 'Expense added! ✓');
        showExpNotif(msg, 'success');
        refreshOvAllData();
        if (review.length) _purLoadReviewFlags().then(refreshOvAllData);

        document.getElementById('addExpenseForm').reset();
        document.getElementById('expSplitPreview').style.display = 'none';
        if (typeof window.expToggleInventoryFields === 'function') window.expToggleInventoryFields();
        closeExpModal('addExpenseModal');
    } catch (err) {
        showExpNotif('Error saving expense: ' + _purErrorText(err), 'error');
        console.error(err);
    } finally {
        showExpLoading('addExpenseBtn', false);
````

**Edit 17 of 33 — `js/expenses-module.js`.** Find:

````text
}

async function deleteExpense(id) {
    if (!await showDeleteConfirm('Delete this expense?')) return;
    try { await db.collection('expenses').doc(id).delete(); showExpNotif('Deleted.', 'success'); refreshOvAllData(); }
    catch (err) { showExpNotif('Error: ' + err.message, 'error'); }
````

Replace with:

````text
}

async function deleteExpense(id) {
    // A purchase-made row is VOIDED through its purchase: it leaves Spent, the
    // receipt and history stay. The database refuses a plain delete of it.
    let pe = expExpenses.find(x => x.id === id);
    if (!pe) {
        try { const snap = await db.collection('expenses').doc(id).get(); if (snap.exists) pe = { id: snap.id, ...snap.data() }; }
        catch (err) { console.error('deleteExpense fetch:', err); }
    }
    if (pe && (pe.purchaseLineId || pe.purchaseChargeId)) {
        let pur;
        try { pur = await _purForRow(pe); } catch (err) { showExpNotif('Error: ' + _purErrorText(err), 'error'); return; }
        if (pur.purchase.status !== 'recorded') { showExpNotif('This purchase was already voided.', 'error'); return; }
        const many = pur.lineCount > 1 ? ' — all ' + pur.lineCount + ' items on its receipt' : '';
        const reason = await _purAskReason('Void this purchase?', 'It leaves Spent' + many + '. The receipt and its history are kept.', 'Void purchase');
        if (!reason) return;
        try {
            const { error } = await window.sbClient.rpc('pur_void', { p_op: DacsReceipts.newId(), p_purchase: pur.purchase.id, p_reason: reason });
            if (error) throw error;
            showExpNotif('Purchase voided.', 'success');
            refreshOvAllData();
            _purLoadReviewFlags();
        } catch (err) { showExpNotif('Error: ' + _purErrorText(err), 'error'); }
        return;
    }
    if (!await showDeleteConfirm('Delete this expense?')) return;
    try { await db.collection('expenses').doc(id).delete(); showExpNotif('Deleted.', 'success'); refreshOvAllData(); }
    catch (err) { showExpNotif('Error: ' + err.message, 'error'); }
````

**Edit 18 of 33 — `js/expenses-module.js`.** Find:

````text
    if (label) label.textContent = open ? 'Fewer details' : 'More details — payment, date, notes';
};
window.expToggleMoreDetails = function () { window.expSetMoreDetails(); };

// Stock-in to the shared Construction inventory. If an item with the same name
// already exists, the quantity is added to its current stock; otherwise a new
// inventory item is created. (The expense itself still lives in Materials.)
async function _addExpenseToInventory(itemName, qty, unit, minStock, notes) {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const by  = (firebase.auth().currentUser || {}).uid || null;
    const addQty = parseFloat(qty) || 0;
    const snap = await db.collection('inventory').where('itemName', '==', itemName).limit(1).get();
    if (!snap.empty) {
        const doc = snap.docs[0];
        const cur = parseFloat(doc.data().currentStock) || 0;
        await doc.ref.update({ currentStock: cur + addQty, lastUpdated: now, lastAdjustedBy: by });
    } else {
        await db.collection('inventory').add({
            itemName,
            unit:         unit || 'pcs',
            currentStock: addQty,
            minStock:     parseFloat(minStock) || 0,
            notes:        notes || null,
            lastUpdated:    now,
            lastAdjustedBy: by,
            createdAt:      now
        });
    }
}

// ════════════════════════════════════════════════════════════
// PAYROLL FORM
````

Replace with:

````text
    if (label) label.textContent = open ? 'Fewer details' : 'More details — payment, date, notes';
};
window.expToggleMoreDetails = function () { window.expSetMoreDetails(); };

// ════════════════════════════════════════════════════════════
// PAYROLL FORM
````

**Edit 19 of 33 — `js/expenses-module.js`.** Find:

````text
        } catch (err) { console.error('openEditExpenseModal fetch:', err); }
    }
    if (!e) { showExpNotif('Expense not found.', 'error'); return; }
    _editingExpenseId = id;

    // Populate funding source dropdown (with remaining budget like Add Expense)
````

Replace with:

````text
        } catch (err) { console.error('openEditExpenseModal fetch:', err); }
    }
    if (!e) { showExpNotif('Expense not found.', 'error'); return; }

    // A purchase-made row is corrected through its purchase: the form shows the
    // purchase's FULL amount (not one funding split), the server re-funds it,
    // and a reason is required. The billing period is the server's to choose.
    _editingPurchase = null;
    _purEditOpId = null;
    if (e.purchaseLineId || e.purchaseChargeId) {
        let pur;
        try { pur = await _purForRow(e); } catch (err) { showExpNotif('Error: ' + _purErrorText(err), 'error'); return; }
        if (pur.purchase.status !== 'recorded') { showExpNotif('This purchase was voided.', 'error'); return; }
        if (!pur.simple) { showExpNotif('This expense is part of a purchase with several items or a shared fee — it cannot be changed from here yet.', 'error'); return; }
        _editingPurchase = pur;
        const d = pur.purchase.docs || {};
        e = { ...e, expenseName: pur.line.item_name, category: pur.line.category, quantity: Number(pur.line.quantity),
              amount: Number(pur.line.gross_amount), dateTime: pur.purchase.date_time, notes: pur.purchase.notes,
              paymentMethod: pur.purchase.payment_method, poImageUrl: d.po_image_url, deliveryReceiptUrl: d.delivery_receipt_url,
              supplierInvoiceUrl: d.supplier_invoice_url, paymentReceiptUrl: d.payment_receipt_url };
    }
    const _fsGroup = document.getElementById('editExpFundingSource')?.closest('.exp-form-group');
    if (_fsGroup) _fsGroup.style.display = _editingPurchase ? 'none' : '';
    const _reasonGroup = document.getElementById('editExpReasonGroup');
    if (_reasonGroup) _reasonGroup.style.display = _editingPurchase ? '' : 'none';
    const _reasonEl = document.getElementById('editExpReason');
    if (_reasonEl) _reasonEl.value = '';
    _editingExpenseId = id;

    // Populate funding source dropdown (with remaining budget like Add Expense)
````

**Edit 20 of 33 — `js/expenses-module.js`.** Find:

````text
    form.addEventListener('submit', handleEditExpense);
}

async function handleEditExpense(ev) {
    ev.preventDefault();
    if (!_editingExpenseId) return;
    try {
        showExpLoading('editExpenseBtn', true);
        const editFsSel = document.getElementById('editExpFundingSource');
````

Replace with:

````text
    form.addEventListener('submit', handleEditExpense);
}

// Edit Expense on a purchase-made row → pur_correct with the full amount.
// The project stays the same; the server recomputes the billing periods.
async function _purSaveCorrection() {
    const pur = _editingPurchase;
    const reason = (document.getElementById('editExpReason')?.value || '').trim();
    if (!reason) { showExpNotif('Please give a reason for the change.', 'error'); document.getElementById('editExpReason')?.focus(); return; }
    try {
        showExpLoading('editExpenseBtn', true);
        const amount   = Math.round((parseFloat((document.getElementById('editExpAmount').value || '').replace(/,/g, '')) || 0) * 100) / 100;
        const dateTime = _buildDateTime('editExpDate', 'editExpTime');
        const purchaseDate = dateTime ? dateTime.slice(0, 10) : pur.purchase.purchase_date;
        // Supporting docs: only the ones re-attached are replaced.
        const docs = {};
        const _map = { po_image_url: 'editExpDocPO', delivery_receipt_url: 'editExpDocDR', supplier_invoice_url: 'editExpDocSI', payment_receipt_url: 'editExpDocPR' };
        for (const [field, inputId] of Object.entries(_map)) {
            const file = document.getElementById(inputId)?.files?.[0];
            if (file) docs[field] = await _uploadReceiptFile('expense', file);
        }
        if (!_purEditOpId) _purEditOpId = DacsReceipts.newId();
        const body = {
            purchase_date: purchaseDate,
            date_time: dateTime || purchaseDate,
            supplier: pur.purchase.supplier || '',
            receipt_total: amount,
            notes: document.getElementById('editExpNotes').value.trim(),
            payment_method: (document.getElementById('editExpPaymentMethod')?.value || '').trim(),
            docs,
            lines: [{ destination: 'project', folder_id: pur.line.folder_id, item_name: document.getElementById('editExpName').value.trim(),
                      category: document.getElementById('editExpCategory').value,
                      quantity: Math.round((parseFloat(document.getElementById('editExpQty').value) || 1) * 1000) / 1000 || 1,
                      unit: pur.line.unit || '', amount, in_inventory: !!pur.line.in_inventory,
                      min_stock: Number(pur.line.min_stock) || 0 }],
            charges: [],
        };
        const { data, error } = await window.sbClient.rpc('pur_correct', { p_op: _purEditOpId, p_purchase: pur.purchase.id, p_body: body, p_reason: reason });
        if (error) throw error;
        _purEditOpId = null;
        _editingPurchase = null;
        _editingExpenseId = null;
        showExpNotif((data && data.replayed)
            ? 'An earlier attempt of this correction was already saved — check the list; changes made since were not applied.'
            : 'Purchase corrected ✓', 'success');
        refreshOvAllData();
        _purLoadReviewFlags();
        closeExpModal('editExpenseModal');
    } catch (err) { showExpNotif('Error: ' + _purErrorText(err), 'error'); console.error(err); }
    finally { showExpLoading('editExpenseBtn', false); }
}

async function handleEditExpense(ev) {
    ev.preventDefault();
    if (!_editingExpenseId) return;
    if (_editingPurchase) return _purSaveCorrection();
    try {
        showExpLoading('editExpenseBtn', true);
        const editFsSel = document.getElementById('editExpFundingSource');
````

**Edit 21 of 33 — `js/expenses-module.js`.** Find:

````text
    if (!p && !fid) { banner.style.display = 'none'; if (fsWrap) fsWrap.style.display = 'none'; return; }

    if (_expIsAdditionalWorks()) {
        _expCoverExpensesMode = false;
        banner.style.display = 'none';
        if (fsWrap) fsWrap.style.display = 'none';
````

Replace with:

````text
    if (!p && !fid) { banner.style.display = 'none'; if (fsWrap) fsWrap.style.display = 'none'; return; }

    if (_expIsAdditionalWorks()) {
        _expCoverExpensesMode = false;
        banner.style.display = 'none';
        if (fsWrap) fsWrap.style.display = 'none';
        return;
    }

    // Staff cannot read billing budgets, so every period looks empty here and
    // this banner would wrongly promise Cover. The server (pur_record, 0096)
    // reads the budgets and funds the expense; show staff nothing.
    if (window.currentUserRole === 'staff') {
        _expCoverExpensesMode = false;
        banner.style.display = 'none';
        if (fsWrap) fsWrap.style.display = 'none';
````

**Edit 22 of 33 — `js/expenses-module.js`.** Find:

````text
    // Use global cache if populated; otherwise fetch from Firestore.
    // For specific folder: filter by projectId only.
    // For All Folders: same — no year filtering on expenses (all-time totals).
    const cachedExp = _ovAllExpenses.filter(e => idSet.has(e.projectId));
    const cachedPay = _ovAllPayroll.filter(p => idSet.has(p.projectId));

    if (cachedExp.length || cachedPay.length) {
````

Replace with:

````text
    // Use global cache if populated; otherwise fetch from Firestore.
    // For specific folder: filter by projectId only.
    // For All Folders: same — no year filtering on expenses (all-time totals).
    const scopeFolders = _rptState.folderId ? _pcReportFolderIds(_rptState.folderId) : null;
    const inScope = e => idSet.has(e.projectId) || (!e.projectId && !!e.folderId && (!scopeFolders || scopeFolders.has(e.folderId)));
    const cachedExp = _ovAllExpenses.filter(inScope);
    const cachedPay = _ovAllPayroll.filter(p => idSet.has(p.projectId));

    if (cachedExp.length || cachedPay.length) {
````

**Edit 23 of 33 — `js/expenses-module.js`.** Find:

````text
        // Specific folder: fetch by billing period IDs (chunked)
        const chunks = [];
        for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
        chunks.forEach(chunk => {
            promises.push(
                db.collection('expenses').where('projectId', 'in', chunk).where('userId', '==', uid).get()
````

Replace with:

````text
        // Specific folder: fetch by billing period IDs (chunked)
        const chunks = [];
        for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
        // …and the no-period rows tied to these projects themselves (0096).
        const fChunks = [];
        const fIds = Array.from(scopeFolders || []);
        for (let i = 0; i < fIds.length; i += 30) fChunks.push(fIds.slice(i, i + 30));
        fChunks.forEach(fChunk => promises.push(
            db.collection('expenses').where('folderId', 'in', fChunk).where('userId', '==', uid).get()
              .then(snap => snap.docs.forEach(d => { const e = { id: d.id, ...d.data() }; if (!e.projectId) allExp.push(e); }))
        ));
        chunks.forEach(chunk => {
            promises.push(
                db.collection('expenses').where('projectId', 'in', chunk).where('userId', '==', uid).get()
````

**Edit 24 of 33 — `js/expenses-module.js`.** Find:

````text
    const allProjIdSet  = new Set(allProjs.map(p => p.id));
    const _src2Exp = _ovAllExpenses.length ? _ovAllExpenses : expExpenses;
    const _src2Pay = _ovAllPayroll.length  ? _ovAllPayroll  : expPayroll;
    const allExps       = _src2Exp.filter(e => allProjIdSet.has(e.projectId));
    const allPay        = _src2Pay.filter(p => allProjIdSet.has(p.projectId));
    const clientProjs   = allProjs.filter(p => p.fundingType !== 'president');

````

Replace with:

````text
    const allProjIdSet  = new Set(allProjs.map(p => p.id));
    const _src2Exp = _ovAllExpenses.length ? _ovAllExpenses : expExpenses;
    const _src2Pay = _ovAllPayroll.length  ? _ovAllPayroll  : expPayroll;
    const allFolderSet  = _rptState.folderId ? _pcReportFolderIds(_rptState.folderId) : null;
    const allExps       = _src2Exp.filter(e => allProjIdSet.has(e.projectId)
        || (!e.projectId && !!e.folderId && (!allFolderSet || allFolderSet.has(e.folderId))));
    const allPay        = _src2Pay.filter(p => allProjIdSet.has(p.projectId));
    const clientProjs   = allProjs.filter(p => p.fundingType !== 'president');

````

**Edit 25 of 33 — `js/expenses-module.js`.** Find:

````text
        const p = periods.find(p => p.id === row.projectId);
        return p && inWindow(row[key] ? new Date(row[key]) : periodDate(p));
    };
    const expenses = (options.expenses || (_ovAllExpenses.length ? _ovAllExpenses : expExpenses)).filter(e => belongs(e, 'dateTime'));
    const payroll = (options.payroll || (_ovAllPayroll.length ? _ovAllPayroll : expPayroll)).filter(p => belongs(p, 'paymentDate'));
    const overheadSource = _rptOvhdRows || [];
    const overheadRows = overheadSource.filter(e => !e.deletedAt && e.scope !== 'company' && folders.has(e.folderId)
````

Replace with:

````text
        const p = periods.find(p => p.id === row.projectId);
        return p && inWindow(row[key] ? new Date(row[key]) : periodDate(p));
    };
    const expSource = options.expenses || (_ovAllExpenses.length ? _ovAllExpenses : expExpenses);
    const expenses = expSource.filter(e => belongs(e, 'dateTime'));
    // A purchase on a project with NO billing period (0096): tied to the project,
    // Cover material, in no period's envelope — like Unallocated Indirect.
    const noPeriodRows = options.projectId ? [] : expSource.filter(e => !e.projectId && folders.has(e.folderId)
        && inWindow(new Date(e.dateTime || '')));
    const payroll = (options.payroll || (_ovAllPayroll.length ? _ovAllPayroll : expPayroll)).filter(p => belongs(p, 'paymentDate'));
    const overheadSource = _rptOvhdRows || [];
    const overheadRows = overheadSource.filter(e => !e.deletedAt && e.scope !== 'company' && folders.has(e.folderId)
````

**Edit 26 of 33 — `js/expenses-module.js`.** Find:

````text
    const unallocatedRows = options.projectId ? [] : overheadRows.filter(e =>
        !expProjects.some(p => assignedTo(e, p)));
    const unallocatedIndirect = sum(unallocatedRows, 'amount');
    const totals = { label:'TOTAL', budget:sum(rows, 'budget'), mats:sum(rows, 'mats'), labor:sum(rows, 'labor'),
        overhead:sum(rows, 'overhead') + unallocatedIndirect, totalSpent:sum(rows, 'totalSpent') + unallocatedIndirect,
        unallocatedIndirect, cover:sum(rows, 'cover'), txCount:expenses.length,
        workerCount:new Set(payroll.map(p => p.workerName || p.id)).size };
    totals.remaining = totals.budget - totals.totalSpent;
    totals.usedPct = totals.budget > 0 ? totals.totalSpent / totals.budget * 100 : 0;
    const allocation = pcProjectAllocationRollup(rows.map(r => r.allocation), unallocatedIndirect, 0, true);
    allocation.configuredCount = rows.filter(r => r.allocation).length;
    allocation.legacyCount = rows.filter(r => r.status === 'Allocation not configured').length;
    return { rows, totals, allocation, expenses, payroll, overheadRows: options.projectId
        ? overheadRows.filter(e => periods.some(p => assignedTo(e, p))) : overheadRows };
}

````

Replace with:

````text
    const unallocatedRows = options.projectId ? [] : overheadRows.filter(e =>
        !expProjects.some(p => assignedTo(e, p)));
    const unallocatedIndirect = sum(unallocatedRows, 'amount');
    const noPeriodMaterial = sum(noPeriodRows, 'amount');
    const totals = { label:'TOTAL', budget:sum(rows, 'budget'), mats:sum(rows, 'mats') + noPeriodMaterial, labor:sum(rows, 'labor'),
        overhead:sum(rows, 'overhead') + unallocatedIndirect, totalSpent:sum(rows, 'totalSpent') + unallocatedIndirect + noPeriodMaterial,
        unallocatedIndirect, noPeriodMaterial, cover:sum(rows, 'cover') + noPeriodMaterial, txCount:expenses.length + noPeriodRows.length,
        workerCount:new Set(payroll.map(p => p.workerName || p.id)).size };
    totals.remaining = totals.budget - totals.totalSpent;
    totals.usedPct = totals.budget > 0 ? totals.totalSpent / totals.budget * 100 : 0;
    const allocation = pcProjectAllocationRollup(rows.map(r => r.allocation), unallocatedIndirect, 0, true);
    allocation.configuredCount = rows.filter(r => r.allocation).length;
    allocation.legacyCount = rows.filter(r => r.status === 'Allocation not configured').length;
    return { rows, totals, allocation, expenses: expenses.concat(noPeriodRows), payroll, overheadRows: options.projectId
        ? overheadRows.filter(e => periods.some(p => assignedTo(e, p))) : overheadRows };
}

````

**Edit 27 of 33 — `js/expenses-module.js`.** Find:

````text
    if (model.totals.unallocatedIndirect) rows.push(_pcReportCells({ label:'Unallocated Indirect',
        overhead:model.totals.unallocatedIndirect, totalSpent:model.totals.unallocatedIndirect,
        remaining:-model.totals.unallocatedIndirect, allocation:null, status:'Unallocated Indirect' }));
    rows.push(_pcReportCells({ ...model.totals, allocation:totalAllocation, status:model.allocation.legacyCount ? 'Allocation not configured: ' + model.allocation.legacyCount : '' }));
    return _pcReportTable(_PC_REPORT_HEADERS, rows, 'Billing Allocation Performance')
        + '<p class="pc-report-note">Target Margin Reserve: planning only. Variance = planned minus actual. Cover Expenses are included above.</p>';
````

Replace with:

````text
    if (model.totals.unallocatedIndirect) rows.push(_pcReportCells({ label:'Unallocated Indirect',
        overhead:model.totals.unallocatedIndirect, totalSpent:model.totals.unallocatedIndirect,
        remaining:-model.totals.unallocatedIndirect, allocation:null, status:'Unallocated Indirect' }));
    if (model.totals.noPeriodMaterial) rows.push(_pcReportCells({ label:'No billing period (Cover)',
        mats:model.totals.noPeriodMaterial, totalSpent:model.totals.noPeriodMaterial,
        remaining:-model.totals.noPeriodMaterial, allocation:null, status:'No billing period — office review' }));
    rows.push(_pcReportCells({ ...model.totals, allocation:totalAllocation, status:model.allocation.legacyCount ? 'Allocation not configured: ' + model.allocation.legacyCount : '' }));
    return _pcReportTable(_PC_REPORT_HEADERS, rows, 'Billing Allocation Performance')
        + '<p class="pc-report-note">Target Margin Reserve: planning only. Variance = planned minus actual. Cover Expenses are included above.</p>';
````

**Edit 28 of 33 — `js/expenses-module.js`.** Find:

````text
        if (model.totals.unallocatedIndirect) rows.push(_pcReportCells({ label:'Unallocated Indirect',
            overhead:model.totals.unallocatedIndirect,totalSpent:model.totals.unallocatedIndirect,
            remaining:-model.totals.unallocatedIndirect,status:'Unallocated Indirect' }));
        const a = model.allocation;
        rows.push(_pcReportCells({ ...model.totals, allocation:a.configuredCount ? { ...a,
            directRemaining:a.directBudget-a.directActual, indirectRemaining:a.indirectBudget-a.indirectActual } : null }));
````

Replace with:

````text
        if (model.totals.unallocatedIndirect) rows.push(_pcReportCells({ label:'Unallocated Indirect',
            overhead:model.totals.unallocatedIndirect,totalSpent:model.totals.unallocatedIndirect,
            remaining:-model.totals.unallocatedIndirect,status:'Unallocated Indirect' }));
        if (model.totals.noPeriodMaterial) rows.push(_pcReportCells({ label:'No billing period (Cover)',
            mats:model.totals.noPeriodMaterial,totalSpent:model.totals.noPeriodMaterial,
            remaining:-model.totals.noPeriodMaterial,status:'No billing period — office review' }));
        const a = model.allocation;
        rows.push(_pcReportCells({ ...model.totals, allocation:a.configuredCount ? { ...a,
            directRemaining:a.directBudget-a.directActual, indirectRemaining:a.indirectBudget-a.indirectActual } : null }));
````

**Edit 29 of 33 — `js/expenses-module.js`.** Find:

````text
        const amount = model.totals.unallocatedIndirect;
        html += _pcReportTable(headers, [['','Unallocated Indirect','','','',0,0,0,amount,amount,-amount]], 'Unallocated Indirect');
    }
    return html + _pcReportTable(['Materials','Labor','Overhead','Grand Total Balance'],
        [[model.totals.mats,model.totals.labor,model.totals.overhead,model.totals.remaining]], 'Grand Total Balance');
}
````

Replace with:

````text
        const amount = model.totals.unallocatedIndirect;
        html += _pcReportTable(headers, [['','Unallocated Indirect','','','',0,0,0,amount,amount,-amount]], 'Unallocated Indirect');
    }
    if (model.totals.noPeriodMaterial) {
        const amount = model.totals.noPeriodMaterial;
        html += _pcReportTable(headers, [['','No billing period (Cover) — office review','','','',0,amount,0,0,amount,-amount]], 'No billing period');
    }
    return html + _pcReportTable(['Materials','Labor','Overhead','Grand Total Balance'],
        [[model.totals.mats,model.totals.labor,model.totals.overhead,model.totals.remaining]], 'Grand Total Balance');
}
````

**Edit 30 of 33 — `js/expenses-module.js`.** Find:

````text
        if (card) card.style.display = owner && _rptState.folderId ? '' : 'none';
        const tbody = document.getElementById(id + 'Tbody');
        if (tbody) tbody.innerHTML = owner ? rows.map(r => {
            const period = model.rows.find(p => p.id === r.projectId);
            const cells = kind === 'expense'
                ? [r.dateTime || '', period?.label || '', r.expenseName || '', r.category || '', r.notes || '', String(r.quantity || 1), Number(r.amount) || 0]
                : [r.paymentDate || '', period?.label || '', r.workerName || '', r.role || '', String(r.daysWorked || 0), Number(r.dailyRate) || 0, Number(r.totalSalary) || 0];
````

Replace with:

````text
        if (card) card.style.display = owner && _rptState.folderId ? '' : 'none';
        const tbody = document.getElementById(id + 'Tbody');
        if (tbody) tbody.innerHTML = owner ? rows.map(r => {
            const period = model.rows.find(p => p.id === r.projectId) || (!r.projectId && r.folderId ? { label:'No billing period' } : null);
            const cells = kind === 'expense'
                ? [r.dateTime || '', period?.label || '', r.expenseName || '', r.category || '', r.notes || '', String(r.quantity || 1), Number(r.amount) || 0]
                : [r.paymentDate || '', period?.label || '', r.workerName || '', r.role || '', String(r.daysWorked || 0), Number(r.dailyRate) || 0, Number(r.totalSalary) || 0];
````

**Edit 31 of 33 — `js/expenses-module.js`.** Find:

````text
                return s + e + l;
              }, 0)
            : fProjs.reduce(function(s, p) { return s + (p._spent || 0); }, 0);
        var variance   = budgetReceived - totalCost;
        var remPct     = budgetReceived > 0 ? ((budgetReceived - totalCost) / budgetReceived) * 100 : 100;
        var spentPct   = budgetReceived > 0 ? Math.min((totalCost / budgetReceived) * 100, 100) : 0;
````

Replace with:

````text
                return s + e + l;
              }, 0)
            : fProjs.reduce(function(s, p) { return s + (p._spent || 0); }, 0);
        totalCost += _expNoPeriodSpent(folder.id);   // no-period purchases (0096)
        var variance   = budgetReceived - totalCost;
        var remPct     = budgetReceived > 0 ? ((budgetReceived - totalCost) / budgetReceived) * 100 : 100;
        var spentPct   = budgetReceived > 0 ? Math.min((totalCost / budgetReceived) * 100, 100) : 0;
````

**Edit 32 of 33 — `js/expenses-module.js`.** Find:

````text
                       + (createdStr ? ' &bull; Created ' + createdStr : '');
        var varClass   = variance >= 0 ? 'ov-folder-card__stat-value--positive' : 'ov-folder-card__stat-value--negative';
        var _presPIds  = fProjs.filter(function(p) { return p.fundingType === 'president'; }).map(function(p) { return p.id; });
        var coverCost  = _useOvCache
            ? _ovAllExpenses.filter(function(x) { return fProjs.some(function(p){ return p.id === x.projectId; }) && (x.coverExpense || _presPIds.indexOf(x.projectId) !== -1); }).reduce(function(s,x){ return s+(parseFloat(x.amount)||0); }, 0)
              + _ovAllPayroll.filter(function(x) { return _presPIds.indexOf(x.projectId) !== -1; }).reduce(function(s,x){ return s+(parseFloat(x.totalSalary)||0); }, 0)
            : 0;

        return '<div class="ov-folder-card">'
            + '<div class="ov-folder-card__title-row">'
````

Replace with:

````text
                       + (createdStr ? ' &bull; Created ' + createdStr : '');
        var varClass   = variance >= 0 ? 'ov-folder-card__stat-value--positive' : 'ov-folder-card__stat-value--negative';
        var _presPIds  = fProjs.filter(function(p) { return p.fundingType === 'president'; }).map(function(p) { return p.id; });
        // No-period purchases (0096) are Cover material: inside the cost above and here.
        var coverCost  = _expNoPeriodSpent(folder.id) + (_useOvCache
            ? _ovAllExpenses.filter(function(x) { return fProjs.some(function(p){ return p.id === x.projectId; }) && (x.coverExpense || _presPIds.indexOf(x.projectId) !== -1); }).reduce(function(s,x){ return s+(parseFloat(x.amount)||0); }, 0)
              + _ovAllPayroll.filter(function(x) { return _presPIds.indexOf(x.projectId) !== -1; }).reduce(function(s,x){ return s+(parseFloat(x.totalSalary)||0); }, 0)
            : 0);

        return '<div class="ov-folder-card">'
            + '<div class="ov-folder-card__title-row">'
````

**Edit 33 of 33 — `js/expenses-module.js`.** Find:

````text
    setText('mvpOvKpiCoverPct', coverOfContract.toFixed(1) + '%');

    // ── Row 2: MATERIALS card
    var expCount = expExpenses.filter(function(e) { return fProjs.some(function(p) { return p.id === e.projectId; }); }).length;
    setText('mvpOvKpiMatVal', fmt(matCost));
    setText('mvpOvKpiMatSub', expCount + ' transaction' + (expCount !== 1 ? 's' : '') + ' · ' + matPct.toFixed(1) + '% of budget');
    setText('mvpOvKpiMatSub2', expCount + ' transaction' + (expCount !== 1 ? 's' : ''));
````

Replace with:

````text
    setText('mvpOvKpiCoverPct', coverOfContract.toFixed(1) + '%');

    // ── Row 2: MATERIALS card
    var expCount = expExpenses.filter(function(e) { return fProjs.some(function(p) { return p.id === e.projectId; }); }).length
        + _expNoPeriodRows(null).filter(function(e) { return scopeIds.has(e.folderId); }).length;
    setText('mvpOvKpiMatVal', fmt(matCost));
    setText('mvpOvKpiMatSub', expCount + ' transaction' + (expCount !== 1 ? 's' : '') + ' · ' + matPct.toFixed(1) + '% of budget');
    setText('mvpOvKpiMatSub2', expCount + ' transaction' + (expCount !== 1 ? 's' : ''));
````

- [ ] **Step 4: Project Control: no-period rows in every total.** This file is edited directly; never run `npm run build`.

**Edit 1 of 7 — `js/portal-app.compiled.js`.** Find:

````text
  return {
    id: d.id,
    projectId: d.projectId,
    date,
    dateTime,
    // full timestamp for date+time display
````

Replace with:

````text
  return {
    id: d.id,
    projectId: d.projectId,
    // Set only on a purchase for a project with NO billing period (0096).
    folderId: d.projectId ? null : d.folderId || null,
    date,
    dateTime,
    // full timestamp for date+time display
````

**Edit 2 of 7 — `js/portal-app.compiled.js`.** Find:

````text
    const childMonths = monthsRaw.filter((m) => m.folderId === f.id).map(mapMonthlyProject);
    const childIds = new Set(childMonths.map((m) => m.id));
    const labor = payrollRaw.filter((p) => childIds.has(p.projectId)).map(mapPayrollDoc);
    const material = expensesRaw.filter((e) => childIds.has(e.projectId)).map(mapExpenseDoc);
    const _raw = foldersRaw.find((x) => x.id === f.id) || {};
    const ovhd = (overheadRaw || []).filter((e) => e.folderId === f.id);
    const built = buildProject(_raw, childMonths, labor, material, ovhd);
````

Replace with:

````text
    const childMonths = monthsRaw.filter((m) => m.folderId === f.id).map(mapMonthlyProject);
    const childIds = new Set(childMonths.map((m) => m.id));
    const labor = payrollRaw.filter((p) => childIds.has(p.projectId)).map(mapPayrollDoc);
    const material = expensesRaw.filter((e) => childIds.has(e.projectId) || !e.projectId && e.folderId === f.id).map(mapExpenseDoc);
    const _raw = foldersRaw.find((x) => x.id === f.id) || {};
    const ovhd = (overheadRaw || []).filter((e) => e.folderId === f.id);
    const built = buildProject(_raw, childMonths, labor, material, ovhd);
````

**Edit 3 of 7 — `js/portal-app.compiled.js`.** Find:

````text
      payCount: payrollRaw.filter(p => p.projectId === m.id).length };
  }).sort((a, b) => b.label.localeCompare(a.label));
  const totalAllocated = cards.reduce((sum, c) => sum + c.budget, 0);
  const totalSpent = cards.reduce((sum, c) => sum + c.totalCost, 0);
  const historyPeriod = owner && cards.find(c => c.id === historyId && !c.cover);
  // Two DIFFERENT styles: .drill-stat is the big header block, .pc-period-stat the
  // compact in-card row. Using the card class in the header kills .drill-stat's type scale.
````

Replace with:

````text
      payCount: payrollRaw.filter(p => p.projectId === m.id).length };
  }).sort((a, b) => b.label.localeCompare(a.label));
  const totalAllocated = cards.reduce((sum, c) => sum + c.budget, 0);
  // A purchase on a project with NO billing period (0096) belongs to no card,
  // but it is spent: it counts in Total Spent and is named below the cards.
  const noPeriodSpent = expensesRaw.filter(e => !e.projectId && e.folderId === project.id).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const totalSpent = cards.reduce((sum, c) => sum + c.totalCost, 0) + noPeriodSpent;
  const historyPeriod = owner && cards.find(c => c.id === historyId && !c.cover);
  // Two DIFFERENT styles: .drill-stat is the big header block, .pc-period-stat the
  // compact in-card row. Using the card class in the header kills .drill-stat's type scale.
````

**Edit 4 of 7 — `js/portal-app.compiled.js`.** Find:

````text
      headStat("Total Allocated", totalAllocated),
      headStat("Total Spent", totalSpent),
      headStat("Remaining", totalAllocated - totalSpent, totalAllocated - totalSpent >= 0 ? "accent" : "")),
    !cards.length ? h("div", { className: "pc-feed-empty" }, "No billing periods yet.")
      : h("div", { className: "pc-period-grid" }, cards.map(c => h("div", { key: c.id, className: "pc-period-card" },
        h("div", { className: "pc-period-head" },
````

Replace with:

````text
      headStat("Total Allocated", totalAllocated),
      headStat("Total Spent", totalSpent),
      headStat("Remaining", totalAllocated - totalSpent, totalAllocated - totalSpent >= 0 ? "accent" : "")),
    noPeriodSpent > 0 && h("div", { className: "pc-feed-empty", role: "note" }, owner
      ? ["₱ ", peso(noPeriodSpent), " of Cover material has no billing period yet — it counts in Total Spent; office review needed."]
      : "Some Cover material has no billing period yet — office review needed."),
    !cards.length ? h("div", { className: "pc-feed-empty" }, "No billing periods yet.")
      : h("div", { className: "pc-period-grid" }, cards.map(c => h("div", { key: c.id, className: "pc-period-card" },
        h("div", { className: "pc-period-head" },
````

**Edit 5 of 7 — `js/portal-app.compiled.js`.** Find:

````text
      }
    } catch (err) {
      alert("Could not check for WorkMate requests, so nothing was deleted: " + (err.message || err));
      return;
    }
    if (!confirm(`Delete "${child.name}"? This removes its contract amount and any billing periods/entries recorded under it.`)) return;
````

Replace with:

````text
      }
    } catch (err) {
      alert("Could not check for WorkMate requests, so nothing was deleted: " + (err.message || err));
      return;
    }
    try {
      const { data: purCount, error: purErr } = await window.sbClient.rpc("pur_live_purchases", { p_folder: child.id, p_period: null });
      if (purErr) throw purErr;
      if (purCount > 0) {
        alert(`"${child.name}" has ${purCount} purchase(s), so it cannot be deleted. Void them in Expenses first.`);
        return;
      }
    } catch (err) {
      alert("Could not check for purchases, so nothing was deleted: " + (err.message || err));
      return;
    }
    if (!confirm(`Delete "${child.name}"? This removes its contract amount and any billing periods/entries recorded under it.`)) return;
````

**Edit 6 of 7 — `js/portal-app.compiled.js`.** Find:

````text
    [payrollRaw, childMonthIds]
  );
  const allMaterialTx = React.useMemo(
    () => expensesRaw.filter((e) => childMonthIds.has(e.projectId)).map(mapExpenseDoc).sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [expensesRaw, childMonthIds]
  );
  // Soft-deleted rows (deleted from the admin Overhead page) must not resurface here.
  const overheadRows = React.useMemo(
````

Replace with:

````text
    [payrollRaw, childMonthIds]
  );
  const allMaterialTx = React.useMemo(
    () => expensesRaw.filter((e) => childMonthIds.has(e.projectId) || !e.projectId && e.folderId === projectId).map(mapExpenseDoc).sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [expensesRaw, childMonthIds, projectId]
  );
  // Soft-deleted rows (deleted from the admin Overhead page) must not resurface here.
  const overheadRows = React.useMemo(
````

**Edit 7 of 7 — `js/portal-app.compiled.js`.** Find:

````text
      const cfMonths = monthsRaw.filter((m) => m.folderId === cf.id).map(mapMonthlyProject);
      const cfMonthIds = new Set(cfMonths.map((m) => m.id));
      const cfLabor = filterByPeriod(payrollRaw.filter((p) => cfMonthIds.has(p.projectId)).map(mapPayrollDoc), period);
      const cfMaterial = filterByPeriod(expensesRaw.filter((e) => cfMonthIds.has(e.projectId)).map(mapExpenseDoc), period);
      const cfOverhead = filterByPeriod((overheadRaw || []).filter((e) => e.folderId === cf.id && !e.deletedAt), period);
      return { ...buildProject(cf, cfMonths, cfLabor, cfMaterial, cfOverhead), raw: cf };
    }),
````

Replace with:

````text
      const cfMonths = monthsRaw.filter((m) => m.folderId === cf.id).map(mapMonthlyProject);
      const cfMonthIds = new Set(cfMonths.map((m) => m.id));
      const cfLabor = filterByPeriod(payrollRaw.filter((p) => cfMonthIds.has(p.projectId)).map(mapPayrollDoc), period);
      const cfMaterial = filterByPeriod(expensesRaw.filter((e) => cfMonthIds.has(e.projectId) || !e.projectId && e.folderId === cf.id).map(mapExpenseDoc), period);
      const cfOverhead = filterByPeriod((overheadRaw || []).filter((e) => e.folderId === cf.id && !e.deletedAt), period);
      return { ...buildProject(cf, cfMonths, cfLabor, cfMaterial, cfOverhead), raw: cf };
    }),
````

- [ ] **Step 5: The reason field in Edit Expense in `admin.html`.**

**Edit 1 of 1 — `admin.html`.** Find:

````text
                </div>
            </div>
            <div class="exp-form-group"><label>Notes (optional)</label><textarea id="editExpNotes" rows="2" placeholder="Additional details…"></textarea></div>
            <div class="exp-modal-footer">
                <button type="button" class="exp-btn exp-btn-secondary" onclick="closeExpModal('editExpenseModal')">Cancel</button>
                <button type="submit" id="editExpenseBtn" class="exp-btn exp-btn-primary" data-label="Save Changes"><i data-lucide="check" class="btn-icon"></i> Save Changes</button>
````

Replace with:

````text
                </div>
            </div>
            <div class="exp-form-group"><label>Notes (optional)</label><textarea id="editExpNotes" rows="2" placeholder="Additional details…"></textarea></div>
            <div class="exp-form-group" id="editExpReasonGroup" style="display:none;"><label for="editExpReason">Reason for the change <span style="color:#b91c1c;">*</span></label><input type="text" id="editExpReason" maxlength="500" placeholder="e.g. wrong amount on the receipt"><small style="display:block;margin-top:4px;color:#6b7280;">This expense came from a purchase. The change is kept in its history and the billing periods are worked out again.</small></div>
            <div class="exp-modal-footer">
                <button type="button" class="exp-btn exp-btn-secondary" onclick="closeExpModal('editExpenseModal')">Cancel</button>
                <button type="submit" id="editExpenseBtn" class="exp-btn exp-btn-primary" data-label="Save Changes"><i data-lucide="check" class="btn-icon"></i> Save Changes</button>
````

- [ ] **Step 6: Update the three existing test files to the new behaviour.**

**Edit 1 of 3 — `tests/receipt-save-paths.test.js`.** Find:

````text
// Zero dependencies. Static fences on js/expenses-module.js (spec
// 2026-10-08-receipt-photos-storage-design.md §4.3–4.4):
//   • the four receipt save paths upload files — never base64 in the row;
//   • add-expense / add-payroll save all split rows in ONE insert (addMany)
//     with a submission id, so a retry can't duplicate;
//   • a failure keeps the form (no reset in the catch);
//   • the two print popups sign photo links before writing the window.
// If a check fails with "SLICE NOT FOUND", update the markers — don't delete it.
````

Replace with:

````text
// Zero dependencies. Static fences on js/expenses-module.js (spec
// 2026-10-08-receipt-photos-storage-design.md §4.3–4.4):
//   • the four receipt save paths upload files — never base64 in the row;
//   • add-payroll saves all split rows in ONE insert (addMany) with a
//     submission id, so a retry can't duplicate; add-expense records ONE
//     purchase through pur_record (0096) with a per-Save operation id, and
//     the server (not the browser) adds any stock, once per line;
//   • a failure keeps the form (no reset in the catch);
//   • the two print popups sign photo links before writing the window.
// If a check fails with "SLICE NOT FOUND", update the markers — don't delete it.
````

**Edit 2 of 3 — `tests/receipt-save-paths.test.js`.** Find:

````text
  ok(f.includes("err.code === '23505'") && f.includes('client_submission'), 'duplicate check');
  ok(f.includes("where('clientSubmissionId', '==', submissionId)"), 'must confirm the earlier rows exist');
});
for (const [name, kind, idVar] of [['async function handleAddExpense(', 'expense', '_expSubmissionId'], ['async function handleAddPayroll(', 'payroll', '_paySubmissionId']]) {
  test(name + ' uploads files, saves once with a submission id, never batches', () => {
    const f = fn(name);
    ok(f.includes("_uploadReceiptFile('" + kind + "'"), 'no file upload');
````

Replace with:

````text
  ok(f.includes("err.code === '23505'") && f.includes('client_submission'), 'duplicate check');
  ok(f.includes("where('clientSubmissionId', '==', submissionId)"), 'must confirm the earlier rows exist');
});
for (const [name, kind, idVar] of [['async function handleAddPayroll(', 'payroll', '_paySubmissionId']]) {
  test(name + ' uploads files, saves once with a submission id, never batches', () => {
    const f = fn(name);
    ok(f.includes("_uploadReceiptFile('" + kind + "'"), 'no file upload');
````

**Edit 3 of 3 — `tests/receipt-save-paths.test.js`.** Find:

````text
  ok(f.includes("if (id === 'addExpenseModal') _expSubmissionId = null;"), 'expense id not cleared on close');
  ok(f.includes("if (id === 'addPayrollModal') _paySubmissionId = null;"), 'payroll id not cleared on close');
});
test('the "already saved" branch of add-expense still mirrors to inventory', () => {
  const f = fn('async function handleAddExpense(');
  const a = f.indexOf("if (outcome === 'already')");
  ok(a !== -1 && f.indexOf('_addExpenseToInventory(', a) !== -1 && f.indexOf('_addExpenseToInventory(', a) < f.indexOf('return;', a), 'inventory mirror missing from the already branch');
});
test('both print popups open in the click, then sign photo links before writing', () => {
  for (const name of ['function printWorkerReceiptSummary(', 'function printTransactionReceipt(']) {
````

Replace with:

````text
  ok(f.includes("if (id === 'addExpenseModal') _expSubmissionId = null;"), 'expense id not cleared on close');
  ok(f.includes("if (id === 'addPayrollModal') _paySubmissionId = null;"), 'payroll id not cleared on close');
});
test('async function handleAddExpense( uploads files, then records ONE purchase through pur_record (0096)', () => {
  const f = fn('async function handleAddExpense(');
  ok(f.includes("_uploadReceiptFile('expense'"), 'no file upload');
  ok(f.includes("rpc('pur_record', { p_op: _expSubmissionId, p_body: body })"), 'not recorded through pur_record with the Save id');
  ok(!f.includes("_saveRowsOnce('expenses'") && !f.includes('.addMany(') && !f.includes("collection('expenses')"), 'still writes expense rows itself');
  ok(f.includes('_expSubmissionId = null'), 'operation id not cleared after success');
  const c = f.slice(f.lastIndexOf('} catch'));
  ok(!/\.reset\(\)/.test(c), 'the catch branch must keep the form and its attachments');
});
test('add-expense never touches stock itself — the server adds it once per purchase line', () => {
  const f = fn('async function handleAddExpense(');
  ok(!f.includes('_addExpenseToInventory('), 'a browser stock update could run twice (retry / overlapping save)');
  ok(f.includes('in_inventory: toInventory') && f.includes('min_stock:'), 'the line must carry the stock request to the server');
});
test('both print popups open in the click, then sign photo links before writing', () => {
  for (const name of ['function printWorkerReceiptSummary(', 'function printTransactionReceipt(']) {
````

**Edit 1 of 1 — `tests/money-math.test.js`.** Find:

````text
      ok(!actual.includes('4,731'), 'contract-minus-spent is not available cash');
    });
  }
}

// == J. OUT SOURCE IS NOT A FOURTH BUCKET (migration 0057) ==========
````

Replace with:

````text
      ok(!actual.includes('4,731'), 'contract-minus-spent is not available cash');
    });
  }
  test('P. report totals are unchanged when the same rows come from a purchase', () => {
    vm.runInContext(`_ovAllExpenses.forEach((e, i) => { e.purchaseLineId = 'L' + i; if (e.coverExpense) e.purchaseChargeId = 'C'; });
                     _rptState.allExpenses = _ovAllExpenses;`, report);
    const m2 = report._pcDashboardReport().model;
    eq(m2.totals.mats, 150); eq(m2.totals.totalSpent, 269); eq(m2.totals.cover, 75); eq(m2.totals.remaining, 731);
  });
  // A purchase on a project with NO billing period (0096): one ₱40 Cover row
  // tied to the project. Every Spent site must count it once, inside Cover.
  test('P. a no-period purchase row counts once in the report: Material, Spent, Cover', () => {
    vm.runInContext(`_ovAllExpenses.push({folderId:'f',amount:40,coverExpense:true,purchaseLineId:'LNP',dateTime:'2026-09-15T08:00'});
                     _rptState.allExpenses = _ovAllExpenses;`, report);
    const m3 = report._pcDashboardReport().model;
    eq(m3.totals.mats, 190); eq(m3.totals.totalSpent, 309); eq(m3.totals.cover, 115); eq(m3.totals.remaining, 691);
    eq(m3.totals.noPeriodMaterial, 40);
    report._rptRenderKPIs(m3);
    ok(elements.rptKpiRow.innerHTML.includes('₱691.00'), 'KPI Funds Available must include the no-period row');
  });
  for (const [name, arg, spent, remaining] of [
    ['printFullBillingSummary','f','309.00','691.00'],
    ['printBillingSummaryReceipt','p','205.00','795.00'],
    ['printReportsDashboard',null,'309.00','691.00']
  ]) {
    test('P. ' + name + ' counts the no-period row exactly where it belongs', () => {
      report[name](arg);
      const actual = printed.match(/<caption>Actual Costs<\/caption>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)[1];
      ok(actual.includes('₱' + spent), 'incorrect Spent');
      ok(actual.includes('₱' + remaining), 'incorrect Funds Available');
      ok(name === 'printBillingSummaryReceipt' ? !printed.includes('No billing period') : printed.includes('No billing period'),
         'the no-period line belongs on the project summaries, never on one period\'s receipt');
    });
  }
}

// == P. PURCHASES (0096) ARE ORDINARY EXPENSE ROWS ======================
// WorkMate Stage 2A-1: a purchase is charged by writing ordinary `expenses`
// rows (spec §3.2), linked back by purchaseLineId / purchaseChargeId, Cover
// rows flagged coverExpense. Every site that totals Spent or Cover must read
// them EXACTLY like any other expense row — the link fields may never change
// a total, and the funding decision lives only on the server (pur_record).
// A project with NO billing period gets a Cover row tied to the project
// itself (folderId, no projectId): it counts once, inside Cover.
console.log('\nP. Purchases are ordinary expense rows');
{
  const folder = { id: 'f1', totalBudget: 1000000 };
  const months = [
    { id: 'm1', monthlyBudget: 7000, fundingType: 'progress' },
    { id: 'm2', monthlyBudget: 0,    fundingType: 'president' }
  ];
  // The §3.3 example as the server writes it: 3,000 + 4,000 + 1,000 Cover.
  const plain = [
    { projectId: 'm1', amount: 3000, docs: {} },
    { projectId: 'm1', amount: 4000, docs: {} },
    { projectId: 'm2', amount: 1000, docs: {}, coverExpense: true }
  ];
  const linked = plain.map((r, i) => ({ ...r, purchaseLineId: 'L1', ...(i === 2 ? { purchaseChargeId: 'C1' } : {}) }));
  const a = portal.buildProject(folder, months, [], plain, []);
  const b = portal.buildProject(folder, months, [], linked, []);
  test('Project Control: purchase links change no total', () => {
    eq(b.material, a.material); eq(b.spent, a.spent); eq(b.coverCost, a.coverCost);
  });
  test('Project Control: the purchase counts once, Cover inside it', () => {
    eq(b.spent, 8000); eq(b.coverCost, 1000);
  });
  test('Project Control: a no-period Cover row counts once in Material, Spent and Cover', () => {
    const c = portal.buildProject(folder, months, [], linked.concat([{ folderId: 'f1', amount: 500, docs: {}, coverExpense: true, purchaseLineId: 'L2' }]), []);
    eq(c.material, 8500); eq(c.spent, 8500); eq(c.coverCost, 1500);
  });
  test('Add expense decides no funding in the browser (pur_record does)', () => {
    const add = expensesSrc.slice(expensesSrc.indexOf('async function handleAddExpense('), expensesSrc.indexOf('\nasync function deleteExpense('));
    ok(add.includes("rpc('pur_record'"), 'Add expense must record through pur_record');
    ok(!/sortedSources|\.remain\b|coverExpense/.test(add), 'Add expense still splits or picks Cover itself');
  });
}

// == J. OUT SOURCE IS NOT A FOURTH BUCKET (migration 0057) ==========
````

**Edit 1 of 1 — `tests/billing-allocation.test.js`.** Find:

````text

  let deliver;
  c.db = { collection(name) {
    eq(name, 'overheadExpenses');
    return { where(field, op, uid) {
      eq([field,op,uid], ['userId','==','owner']);
````

Replace with:

````text

  let deliver;
  c.db = { collection(name) {
    // Reports also fetch a project's no-period purchase rows (0096): none here.
    if (name === 'expenses') { const q = { where: () => q, get: async () => ({ docs: [] }) }; return q; }
    eq(name, 'overheadExpenses');
    return { where(field, op, uid) {
      eq([field,op,uid], ['userId','==','owner']);
````

- [ ] **Step 7: Run everything.**

Run: `node --check js/expenses-module.js && node --check js/portal-app.compiled.js`, then every suite in `npm test` **one by one** (`npm test` chains them with `&&` and stops at the first red one).
Expected:
- every suite exits 0 **except** `tests/workmate-workplan.test.js`, whose only failure is "docs record 0093 and the next number" — the migrations README is Task 3
- `purchase server (0096)` with `27 passed, 0 failed`
- `purchase screens (0096)` with `8 passed, 0 failed`
- money-math `P.` lines all `ok`

- [ ] **Step 8: Commit point (the user commits).** The eight files above.

---

### Task 3: Documentation, CI and the live acceptance script

**Files:**
- Modify: `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md`, `.github/workflows/ci.yml`
- Create: `supabase/tests/2a1_acceptance.sql`

- [ ] **Step 1: Migrations README.** The next number becomes 0097; add the 0096 entry. (`tests/workmate-workplan.test.js` fails until the README names the highest migration on disk.)

**Edit 1 of 2 — `supabase/migrations/README.md`.** Find:

````text
one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
capture exist. Write the migration, apply the migration, commit the migration.

- **Next number = highest existing + 1** (**0096** — highest on disk is
  `0095_ai_request_gate.sql`). Sort the folder before you pick; don't
  trust this line if it looks stale. Duplicate numbers are how we got into trouble.
- **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
  project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
````

Replace with:

````text
one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
capture exist. Write the migration, apply the migration, commit the migration.

- **Next number = highest existing + 1** (**0097** — highest on disk is
  `0096_purchase_recording.sql`). Sort the folder before you pick; don't
  trust this line if it looks stale. Duplicate numbers are how we got into trouble.
- **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
  project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
````

**Edit 2 of 2 — `supabase/migrations/README.md`.** Find:

````text

**0095 (AI request gate)** adds `ai_requests` (who / feature / characters / when — never the text; no client access) and `ai_authorize(feature, chars)`, which the `dacs-ai` Cloudflare worker calls as the signed-in caller before running any model: active account; `work_plan_draft` for owner/staff (module-focused: `workplan`), `budget_summary` and `health_briefing` for owner (module-focused: `expenses`); input ≤ 40,000 / 4,000 / 12,000 characters; per person 10 per 10 min and 50 per rolling 24 h (drafts), 20 and 100 (budget summary and health briefing, each counted on its own); per company 300 per rolling 24 h (never a calendar day). Apply before deploying the worker. Dry-run with `supabase/tests/1c2_ai_gate.sql` (self-wrapped, editor-safe); simultaneous requests: `supabase/tests/1c2_ai_gate_concurrency.mjs` (two connections, after applying).

Get the truth before relying on this line:

```sql
````

Replace with:

````text

**0095 (AI request gate)** adds `ai_requests` (who / feature / characters / when — never the text; no client access) and `ai_authorize(feature, chars)`, which the `dacs-ai` Cloudflare worker calls as the signed-in caller before running any model: active account; `work_plan_draft` for owner/staff (module-focused: `workplan`), `budget_summary` and `health_briefing` for owner (module-focused: `expenses`); input ≤ 40,000 / 4,000 / 12,000 characters; per person 10 per 10 min and 50 per rolling 24 h (drafts), 20 and 100 (budget summary and health briefing, each counted on its own); per company 300 per rolling 24 h (never a calendar day). Apply before deploying the worker. Dry-run with `supabase/tests/1c2_ai_gate.sql` (self-wrapped, editor-safe); simultaneous requests: `supabase/tests/1c2_ai_gate_concurrency.mjs` (two connections, after applying).

**0096 (WorkMate Stage 2A-1 — one purchase recording operation)** adds `purchases` (one receipt: actual `purchase_date`, `receipt_total`, docs, `recorded`/`void`), `purchase_lines` (project or AW folder — kept as history with `folder_name`, no foreign key, so a project whose purchases are all voided can be deleted — or warehouse), `purchase_charges` + `purchase_charge_shares` (delivery fee / discount, split by line to the centavo, largest remainder), `purchase_history` (recorded / corrected / refunded / voided / replaced, before and after), `pur_ops` (first answer per operation id) and `purchase_stock_moves` (one stock move per line, ever); `expenses.purchase_line_id` / `purchase_charge_id` / `folder_id`. `pur_record`, `pur_correct`, `pur_refund`, `pur_void`, `pur_replace` (void + record in one transaction, stock carried over) — active owner/staff accounts allowed the **Expenses** section only, for recording AND reading (module-focused accounts refused; source `workmate` refused until the 2A-2 Buyer switch) — write ORDINARY `expenses` rows funded by the ACTUAL purchase month: earliest billing number first, each period up to budget − expenses − payroll, shortage to Cover (`cover_expense`) on the project's Cover period, else a client period of **that month only** (never another month's — it would use up that month's client money), no eligible period that month → all Cover + `needs_funding_review`; no Cover period and no billing period in the purchase month → a Cover row tied to the project (`folder_id`, no `project_id`), flagged — no period is ever invented; Additional Works in full on their own period. Quantities and minimum stock take **at most 3 decimals** (more is refused, `BAD_QUANTITY`; Dacs Web rounds first). Every call locks its operation, then (for a change to an existing purchase) that purchase, then every project and stock item it touches, in one fixed order, before writing. The "track in inventory" stock update runs inside the recording, once per line, matched within the company. Trigger `expenses_purchase_guard` refuses any other write to a purchase-made or project-level row; triggers `folders_purchase_delete_guard` / `projects_purchase_delete_guard` refuse deleting a project or period with a live purchase BEFORE anything is removed (a fully discounted purchase counts), and Dacs Web asks `pur_live_purchases()` first — it counts the project's Additional Works jobs too, since they cascade-delete with it. Dacs Web Expenses → Add expense records through `pur_record` from this migration on: **apply 0096 before deploying the web change.** Prove with `npm run test:sql` (PGlite + two sessions on a throwaway real PostgreSQL; CI runs it too); live: `supabase/tests/2a1_acceptance.sql` (self-wrapped, rolls back).

Get the truth before relying on this line:

```sql
````

- [ ] **Step 2: Schema doc.**

**Edit 1 of 2 — `docs/DATABASE_SCHEMA.md`.** Find:

````text
| `coverExpense?` | bool | overflow charged to president fund |
| `splitGroup?` `splitIndex?` `splitTotal?` | — | multi-source split metadata |
| `clientSubmissionId?` | uuid | `client_submission_id` — one id per Save press; unique with `split_index` (0089), so a retry cannot duplicate |
| `createdAt` | ts | |

### `payroll/{id}` — labor spend (also batch + split)
````

Replace with:

````text
| `coverExpense?` | bool | overflow charged to president fund |
| `splitGroup?` `splitIndex?` `splitTotal?` | — | multi-source split metadata |
| `clientSubmissionId?` | uuid | `client_submission_id` — one id per Save press; unique with `split_index` (0089), so a retry cannot duplicate |
| `purchaseLineId?` `purchaseChargeId?` | uuid | `purchase_line_id` / `purchase_charge_id` (0096): the row was written by a **purchase** (`pur_record`). It changes only through `pur_correct` / `pur_refund` / `pur_void` — the `expenses_purchase_guard` trigger refuses any other insert, update or delete |
| `folderId?` | uuid | `folder_id` (0096): set ONLY on a purchase row for a project with **no billing period** for the purchase month and no Cover period (`projectId` null). It is that project's Cover Material — counted once in Material, Spent and Cover, in no period's envelope, shown as "No billing period" — until a re-fund moves it onto a period |
| `createdAt` | ts | |

### `payroll/{id}` — labor spend (also batch + split)
````

**Edit 2 of 2 — `docs/DATABASE_SCHEMA.md`.** Find:

````text
| `ai_requests` (`owner_id`, `user_id`, `feature` `budget_summary`/`work_plan_draft`/`health_briefing`, `input_chars`, `created_at`) | One row per allowed AI request; never the text; RLS on with no policy (no client access); rows older than 30 days removed |
| `ai_authorize(p_feature, p_chars)` | Called by the `dacs-ai` worker as the caller: active account, feature allowed for the role and `allowed_modules`, size, per-person and per-company limits; raises `AI_NOT_SIGNED_IN` / `AI_NOT_ALLOWED` / `AI_TOO_LARGE` / `AI_RATE_LIMITED` |

````

Replace with:

````text
| `ai_requests` (`owner_id`, `user_id`, `feature` `budget_summary`/`work_plan_draft`/`health_briefing`, `input_chars`, `created_at`) | One row per allowed AI request; never the text; RLS on with no policy (no client access); rows older than 30 days removed |
| `ai_authorize(p_feature, p_chars)` | Called by the `dacs-ai` worker as the caller: active account, feature allowed for the role and `allowed_modules`, size, per-person and per-company limits; raises `AI_NOT_SIGNED_IN` / `AI_NOT_ALLOWED` / `AI_TOO_LARGE` / `AI_RATE_LIMITED` |

## Purchases (0096) — WorkMate Stage 2A-1

One recording operation for every purchase, shared by Dacs Web (Expenses → Add expense) and, later, the WorkMate buyer app. Spec `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md` §3; plan `docs/superpowers/plans/2026-10-14-workmate-stage2a1-purchase-recording.md`. RLS: owner and their staff read (`can_access`); nobody writes directly — only the functions. Callers: active owner/staff accounts allowed the **Expenses** section; source `workmate` is refused until the Buyer switch (2A-2).

| Object | Purpose |
|---|---|
| `purchases` (`owner_id`, `source` `expenses_form`/`workmate`, `purchase_date` = the ACTUAL purchase date, `date_time`, `supplier`, `receipt_total`, `notes`, `payment_method`, `docs` {po/dr/si/payment receipt URLs}, `status` `recorded`/`void`, `recorded_by`) | One receipt |
| `purchase_lines` (`purchase_id`, `line_no`, `destination` `project`/`warehouse`, `folder_id` + `folder_name` — history, **no foreign key**, `item_name`, `category`, `quantity` (up to 3 decimals), `unit`, `gross_amount`, `in_inventory`, `min_stock`, `needs_funding_review`) | What was bought, for which project (Main Contract or Additional Works folder). Warehouse lines write no expense rows |
| `purchase_charges` (`kind` `delivery_fee`/`discount`, `amount`) + `purchase_charge_shares` (`charge_id`, `line_id`, `amount`) | A shared fee or discount and how it is split across lines (default: by line amount, to the centavo by largest remainder — never a negative share, always exactly the charge) |
| `purchase_history` (`kind` `recorded`/`corrected`/`refunded`/`voided`/`replaced`, `reason`, `before`, `after`, `actor_id`) | Never edited |
| `pur_ops` (`actor_id`, `op_id`, `kind`, `result`) | First answer per operation id — a retry or an overlapping call returns it, nothing is recorded twice |
| `purchase_stock_moves` (`line_id` **primary key**, `inventory_id`, `quantity`, `moved_at`) | The "track in inventory" stock added for a line — once, ever. Stock items are matched within the company: its own item, else an unowned one (the old browser mirror wrote items with no owner), never another company's |
| `pur_record(p_op, p_body)` | Records a purchase and writes its `expenses` rows: per project line, the net amount (item − discount shares) funded by the **actual purchase month** — that month's client periods with a budget (this company's, this project's), **earliest billing number first**, each up to budget − expenses − payroll; shortage → Cover (`cover_expense = true`, on the project's Cover period, else a client period of **that month only** — never another month's); no eligible period that month → all Cover and `needs_funding_review`; **no Cover period and no billing period in the purchase month** → one Cover row tied to the project (`folder_id`), flagged. Additional Works → their own period in full. Fee shares → "Delivery fee (share)" rows, funded the same way. Adds stock for "track in inventory" lines. Refuses: totals ≠ receipt, shares ≠ charge, discount > line, sub-centavo or negative amounts, another company's project, staff on a completed project (or an Additional Works job under one) |
| `pur_correct(p_op, p_purchase, p_body, p_reason)` | Same lines, new content: the purchase's rows are replaced and re-funded in one transaction; reason required. Moving a line to another project, or any change on a completed project, is owner-only. Stock already moved is not moved again |
| `pur_refund(p_op, p_purchase, p_reason)` | Re-funds a purchase as it stands — e.g. after the office adds the billing period a "No billing period" line was waiting for. Same purchase date, same total; only where the pesos are charged changes |
| `pur_void(p_op, p_purchase, p_reason)` | Its rows leave Spent; purchase, docs and history stay. Not a return or a refund; stock is not taken back |
| `pur_replace(p_op, p_purchase, p_body, p_reason)` | A new version with a different number of lines: the old purchase is voided (`replaced_by`) and the new one recorded in ONE transaction; stock the old one moved is carried over to the new lines of the same item, never added twice. Same owner-only rules as a correction |
| `pur_live_purchases(p_folder, p_period)` | How many live purchases touch this project or any of its Additional Works jobs (any line, even discounted to zero) or this period — asked by Dacs Web before deleting anything |
| `folders_purchase_delete_guard`, `projects_purchase_delete_guard` (triggers) | Refuse deleting a project or period with a live purchase, BEFORE its cascade removes anything (`PURCHASES_LIVE`) |
| `pur_reader()` | The read rule of every purchase table: an active owner/staff account allowed the Expenses section (the same as recording) |

````

- [ ] **Step 3: Module map.**

**Edit 1 of 1 — `docs/ARCHITECTURE.md`.** Find:

````text
| Module | File | What it owns |
|---|---|---|
| Project Control | `portal-app.compiled.js` | Folder grid, per-project cost/profit, drills (labor, material, overhead, periods, additional works) |
| Budget Overview / Expenses | `expenses-module.js` (8.1k lines — the biggest) | Folders, billing periods, payroll, expenses, pakyaw labor contracts |
| Overhead | `overhead-module.js` | Company + project overhead ([OVERHEAD_MODULE.md](OVERHEAD_MODULE.md)) |
| Billing Allocations | `billing-allocation.js` | The **shared planning engine** for `0073`, not a nav section. Pure functions (`pcValidateAllocationPolicy`, `pcAllocationAmounts`, `pcAllocationStatus`, `pcPeriodAllocationView`, `pcActualsForPeriod`, `pcProjectAllocationRollup`) loaded by `admin.html` **before** `expenses-module.js` and `portal-app.compiled.js`, and `require()`d directly by the tests. It holds no state, touches no database and knows nothing about roles — every caller (Project Control dashboard, the owner forms, the reports, print, CSV) must get its numbers from here so they cannot drift apart. **Planning only:** see §6. Owner-only at every call site; staff see no percentage and no peso |
| Reimbursement | `reimbursement-module.js` | Client Reimbursement Tracker (`0041`) — expenses the **owner/admin advanced** and whether the **client** paid them back. **Deliberately isolated:** no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Prints are read-only: one record (invoice / receipt) or **Print All** — every record the filters show, grouped by project with subtotals, totals from the same `_rbTotals()` as the KPI cards. Owner-only (staff blocked in nav, switchView and RLS) |
````

Replace with:

````text
| Module | File | What it owns |
|---|---|---|
| Project Control | `portal-app.compiled.js` | Folder grid, per-project cost/profit, drills (labor, material, overhead, periods, additional works) |
| Budget Overview / Expenses | `expenses-module.js` (8.1k lines — the biggest) | Folders, billing periods, payroll, expenses, pakyaw labor contracts. **Add expense records a purchase through `pur_record` (`0096`)** — the server picks the billing periods (actual purchase month, earliest billing number, shortage → Cover) and adds any "track in inventory" stock once per line; rows marked *From purchase* are edited (`pur_correct`, reason required) or voided (`pur_void`) through their purchase. A project with **no billing period** gets a Cover row tied to the project (`expenses.folder_id`): Project Control, the dashboard, the folder list and folder cards (`_expNoPeriodSpent`), the Expenses folder view and every report, print and CSV count it once, as "No billing period". Deleting a project (with its Additional Works jobs), a period, or — in Project Control — an Additional Works job asks `pur_live_purchases()` first and removes nothing if one is live. Tests: `tests/purchase-server.test.js`, `tests/purchase-screens.test.js`, `npm run test:sql` |
| Overhead | `overhead-module.js` | Company + project overhead ([OVERHEAD_MODULE.md](OVERHEAD_MODULE.md)) |
| Billing Allocations | `billing-allocation.js` | The **shared planning engine** for `0073`, not a nav section. Pure functions (`pcValidateAllocationPolicy`, `pcAllocationAmounts`, `pcAllocationStatus`, `pcPeriodAllocationView`, `pcActualsForPeriod`, `pcProjectAllocationRollup`) loaded by `admin.html` **before** `expenses-module.js` and `portal-app.compiled.js`, and `require()`d directly by the tests. It holds no state, touches no database and knows nothing about roles — every caller (Project Control dashboard, the owner forms, the reports, print, CSV) must get its numbers from here so they cannot drift apart. **Planning only:** see §6. Owner-only at every call site; staff see no percentage and no peso |
| Reimbursement | `reimbursement-module.js` | Client Reimbursement Tracker (`0041`) — expenses the **owner/admin advanced** and whether the **client** paid them back. **Deliberately isolated:** no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Prints are read-only: one record (invoice / receipt) or **Print All** — every record the filters show, grouped by project with subtotals, totals from the same `_rbTotals()` as the KPI cards. Owner-only (staff blocked in nav, switchView and RLS) |
````

- [ ] **Step 4: CI runs the SQL suites too.**

**Edit 1 of 2 — `.github/workflows/ci.yml`.** Find:

````text
# ════════════════════════════════════════════════════════════════════
# CI — runs on every push and pull request.
#
# Two steps, well under a minute, no dependencies to install (every test
# uses only Node built-ins):
#   1. syntax — node --check on every authored JS file: the portal modules,
#               the tests, the service worker, and the two Cloudflare
#               workers (ES modules, so checked as .mjs). Catches the "one
#               bad character broke the whole admin page" class of bug.
#   2. tests  — `npm test`: ALL eleven suites, the same command a developer
#               runs locally. Among them tests/money-math.test.js, which
#               extracts the LIVE money functions and enforces every
#               invariant in CLAUDE.md, and the isolation suites
#               (reimbursements, quotations, attendance) that fail the
#               build if an isolated module ever touches the money model.
#
# Until 2026-09-27 this ran only 3 of the 9 suites by name, so a new suite
# added to package.json never reached CI. Running `npm test` keeps the two
````

Replace with:

````text
# ════════════════════════════════════════════════════════════════════
# CI — runs on every push and pull request.
#
# Three steps. The first two need no dependencies (every test uses only Node
# built-ins):
#   1. syntax — node --check on every authored JS file: the portal modules,
#               the tests, the service worker, and the two Cloudflare
#               workers (ES modules, so checked as .mjs). Catches the "one
#               bad character broke the whole admin page" class of bug.
#   2. tests  — `npm test`: ALL the suites, the same command a developer
#               runs locally. Among them tests/money-math.test.js, which
#               extracts the LIVE money functions and enforces every
#               invariant in CLAUDE.md, and the isolation suites
#               (reimbursements, quotations, attendance) that fail the
#               build if an isolated module ever touches the money model.
#
#   3. sql    — `npm run test:sql`: migration 0096's money rules on PostgreSQL
#               in memory (PGlite), then two sessions at once on a throwaway
#               real PostgreSQL (embedded-postgres). It installs those test
#               tools into supabase/tests only — never into the app.
#
# Until 2026-09-27 this ran only 3 of the 9 suites by name, so a new suite
# added to package.json never reached CI. Running `npm test` keeps the two
````

**Edit 2 of 2 — `.github/workflows/ci.yml`.** Find:

````text
      - name: All test suites (npm test)
        run: npm test

````

Replace with:

````text
      - name: All test suites (npm test)
        run: npm test

      - name: SQL money rules and two-session races (npm run test:sql)
        run: npm run test:sql

````

- [ ] **Step 5: The live acceptance script.** It is self-wrapped in `begin … rollback`, so nothing persists. It runs as a real staff account allowed Expenses, through `request.jwt.claims`.

**New file `supabase/tests/2a1_acceptance.sql`:**

````sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-1 acceptance — migration 0096 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists. Builds its own
-- "ZZ 2a1" projects and billing periods. Editor-safe (set_config 'v2a1.*',
-- no temp objects). Needs one active owner with an active staff account.
-- Success ends with the row '2a1 acceptance: all checks passed'.
--   A. §3.3 split, earliest billing number, Cover subset   E. guard
--      (A6: billing #1 first even when #2 is older and has less left)
--   B. staff funded from budgets they cannot read           F. retry
--   C. no period that month → Cover + office review         G. correct / void
--   D. Additional Works in full; fee share split 150 / 50
--   H. NO billing period: counted at once as Cover, flagged; re-fund later
--   I. phone purchasing refused until the Buyer switch  J. stock added once
--   K. after its purchase is voided, a project can be deleted
--   L. replace: a different number of lines, stock never added twice
--   M. never another month's client period: no Cover period, no period
--      that month → tied to the project; that month's money untouched
--   N. deleting refused before anything is removed (a zero-value purchase counts)
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_a uuid; v_b uuid; v_aw uuid;
  v_p1 uuid; v_p2 uuid; v_cover uuid; v_pb uuid; v_paw uuid; v_c uuid; v_c1 uuid; v_c2 uuid;
begin
  select p.id, s.id into v_owner, v_staff
    from profiles p join profiles s on s.owner_id = p.id and s.role = 'staff' and coalesce(s.status, 'active') = 'active'
         -- a staff account allowed the Expenses section (not module-focused elsewhere)
         and (jsonb_typeof(s.allowed_modules) is distinct from 'array' or jsonb_array_length(s.allowed_modules) = 0
              or s.allowed_modules ? 'expenses')
   where p.role = 'owner' and coalesce(p.status, 'active') = 'active'
   order by p.created_at, s.created_at limit 1;
  assert v_owner is not null and v_staff is not null, 'need an active owner with an active staff account allowed Expenses';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a1 project A') returning id into v_a;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a1 project B') returning id into v_b;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 2a1 additional works', v_a) returning id into v_aw;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_a, 'October', 2026, 'progress', 2) returning id into v_p2;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_a, 'October', 2026, 'progress', 1) returning id into v_p1;
  insert into projects (owner_id, folder_id, month, year, funding_type) values (v_owner, v_a, 'October', 2026, 'president') returning id into v_cover;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_b, 'October', 2026, 'progress', 1) returning id into v_pb;
  insert into projects (owner_id, folder_id, month, year, funding_type) values (v_owner, v_aw, 'October', 2026, 'progress') returning id into v_paw;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_p1, v_owner, 5000), (v_p2, v_owner, 4000), (v_pb, v_owner, 100000);
  insert into expenses (owner_id, project_id, expense_name, amount) values (v_owner, v_p1, 'ZZ 2a1 earlier', 2000);
  -- Billing #2 created BEFORE #1, and with LESS left: neither creation order
  -- nor "lowest remaining first" may pick it before billing #1.
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a1 project C') returning id into v_c;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number, created_at) values (v_owner, v_c, 'Oct', 2026, 'progress', 2, now() - interval '1 day') returning id into v_c2;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_c, 'October', 2026, 'progress', 1) returning id into v_c1;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_c2, v_owner, 500), (v_c1, v_owner, 9000);
  perform set_config('v2a1.c', v_c::text, true);
  perform set_config('v2a1.c1', v_c1::text, true);

  perform set_config('v2a1.owner', v_owner::text, true);
  perform set_config('v2a1.staff', v_staff::text, true);
  perform set_config('v2a1.a', v_a::text, true);
  perform set_config('v2a1.b', v_b::text, true);
  perform set_config('v2a1.aw', v_aw::text, true);
  perform set_config('v2a1.p1', v_p1::text, true);
  perform set_config('v2a1.p2', v_p2::text, true);
  perform set_config('v2a1.cover', v_cover::text, true);
  perform set_config('v2a1.pb', v_pb::text, true);
  perform set_config('v2a1.paw', v_paw::text, true);
end $$;

set local role authenticated;

-- ═══ A. The §3.3 example, recorded by STAFF (B: budgets they cannot read) ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a1.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_body jsonb;
begin
  assert not exists (select 1 from project_budgets where project_id = current_setting('v2a1.p1')::uuid),
    'B0 staff still cannot read billing budgets directly';
  v_body := jsonb_build_object('purchase_date', '2026-10-14', 'date_time', '2026-10-14T09:30', 'receipt_total', 8000,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.a'), 'item_name', 'ZZ 2a1 cement', 'category', 'Materials', 'quantity', 10, 'amount', 8000)));
  r := pur_record(gen_random_uuid(), v_body);
  perform set_config('v2a1.purchase', r ->> 'purchase_id', true);
  assert (select array_agg((x ->> 'amount')::numeric order by (x ->> 'cover')::boolean, (x ->> 'amount')::numeric)
            from jsonb_array_elements(r -> 'rows') x) = array[3000, 4000, 1000]::numeric[], 'A1 3,000 + 4,000 + 1,000';
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.p1')::uuid and purchase_line_id is not null) = 3000, 'A2 billing #1 first';
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.p2')::uuid) = 4000, 'A3 then billing #2';
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.cover')::uuid and cover_expense) = 1000, 'A4 shortage on the Cover period, flagged';
  assert (select sum(amount) from expenses e join purchase_lines l on l.id = e.purchase_line_id
           where l.purchase_id = (r ->> 'purchase_id')::uuid) = 8000, 'A5 Spent counts the purchase once, Cover inside it';
end $$;

-- ═══ A6. Earliest billing number, not creation order or lowest remaining ═══
do $$
begin
  perform pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-20', 'receipt_total', 300,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.c'), 'item_name', 'ZZ 2a1 sand', 'amount', 300))));
  assert (select sum(e.amount) from expenses e join purchase_lines l on l.id = e.purchase_line_id
           where l.item_name = 'ZZ 2a1 sand' and e.project_id = current_setting('v2a1.c1')::uuid) = 300, 'A6 billing #1 pays first';
end $$;

-- ═══ C. No period that month → all Cover + office review ═══
do $$
declare r jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-11-03', 'receipt_total', 500,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.a'), 'item_name', 'ZZ 2a1 tiles', 'amount', 500))));
  assert r -> 'needs_review' = '[1]'::jsonb, 'C1 flagged for office review';
  assert (select bool_and(cover_expense) and sum(amount) = 500 from expenses e join purchase_lines l on l.id = e.purchase_line_id
           where l.purchase_id = (r ->> 'purchase_id')::uuid), 'C2 all Cover';
end $$;

-- ═══ D. Additional Works in full; a fee shared 150 / 50 ═══
do $$
declare r jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 22000,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.aw'), 'item_name', 'ZZ 2a1 lumber', 'amount', 22000))));
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.paw')::uuid and not cover_expense) = 22000, 'D1 AW in full, no Cover';
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 4200,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 pipe', 'amount', 3000),
                               jsonb_build_object('folder_id', current_setting('v2a1.aw'), 'item_name', 'ZZ 2a1 pipe', 'amount', 1000)),
    'charges', jsonb_build_array(jsonb_build_object('kind', 'delivery_fee', 'amount', 200))));
  assert (select array_agg(e.amount order by e.amount desc) from expenses e join purchase_charges c on c.id = e.purchase_charge_id
           where c.purchase_id = (r ->> 'purchase_id')::uuid) = array[150, 50]::numeric[], 'D2 fee 150 / 50';
end $$;

-- ═══ E. A purchase-made row changes only through its purchase ═══
do $$
begin
  begin
    update expenses set amount = 1 where project_id = current_setting('v2a1.p2')::uuid and purchase_line_id is not null;
    raise exception 'E1 a direct update was allowed';
  exception when others then
    assert sqlerrm like '%PURCHASE_ROW%', 'E1 wrong error: ' || sqlerrm;
  end;
  begin
    delete from expenses where project_id = current_setting('v2a1.p2')::uuid and purchase_line_id is not null;
    raise exception 'E2 a direct delete was allowed';
  exception when others then
    assert sqlerrm like '%PURCHASE_ROW%', 'E2 wrong error: ' || sqlerrm;
  end;
end $$;

-- ═══ F. Retry: same operation id, one purchase ═══
do $$
declare op uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; v_body jsonb;
begin
  v_body := jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 10,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 nails', 'amount', 10)));
  r1 := pur_record(op, v_body);
  r2 := pur_record(op, v_body);
  assert r1 -> 'replayed' is null and (r2 ->> 'replayed')::boolean, 'F1 the retry is marked replayed';
  assert r2 - 'replayed' = r1, 'F1b otherwise the retry returns the first answer';
  assert (select count(*) from purchase_lines where item_name = 'ZZ 2a1 nails') = 1, 'F2 recorded once';
end $$;

-- ═══ G. Correct (difference only) and void (rows leave Spent) ═══
do $$
declare r jsonb; v_before numeric; v_after numeric;
begin
  select sum(amount) into v_before from expenses where project_id in (current_setting('v2a1.p1')::uuid, current_setting('v2a1.p2')::uuid, current_setting('v2a1.cover')::uuid);
  r := pur_correct(gen_random_uuid(), current_setting('v2a1.purchase')::uuid,
    jsonb_build_object('purchase_date', '2026-10-14', 'date_time', '2026-10-14T09:30', 'receipt_total', 8500,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.a'), 'item_name', 'ZZ 2a1 cement', 'category', 'Materials', 'quantity', 10, 'amount', 8500))),
    'ZZ 2a1 receipt said 8,500');
  select sum(amount) into v_after from expenses where project_id in (current_setting('v2a1.p1')::uuid, current_setting('v2a1.p2')::uuid, current_setting('v2a1.cover')::uuid);
  assert v_after - v_before = 500, 'G1 Spent changes by exactly the difference';
  perform pur_void(gen_random_uuid(), current_setting('v2a1.purchase')::uuid, 'ZZ 2a1 test void');
  assert not exists (select 1 from expenses e join purchase_lines l on l.id = e.purchase_line_id
                      where l.purchase_id = current_setting('v2a1.purchase')::uuid), 'G2 voided rows leave Spent';
  assert (select array_agg(kind order by id) from purchase_history where purchase_id = current_setting('v2a1.purchase')::uuid)
         = array['recorded', 'corrected', 'voided'], 'G3 history kept';
end $$;

-- ═══ H. NO billing period at all: counted at once, Cover, flagged; re-fund later ═══
do $$
declare r jsonb; v_f uuid;
begin
  insert into folders (owner_id, name) values (current_setting('v2a1.owner')::uuid, 'ZZ 2a1 no period') returning id into v_f;
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 700,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', v_f, 'item_name', 'ZZ 2a1 gravel', 'amount', 700))));
  assert r -> 'needs_review' = '[1]'::jsonb, 'H1 flagged';
  assert (select count(*) = 1 and bool_and(e.project_id is null and e.folder_id = v_f and e.cover_expense) and sum(e.amount) = 700
            from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = (r ->> 'purchase_id')::uuid),
    'H2 one Cover row tied to the project, no period';
  assert not exists (select 1 from projects where folder_id = v_f), 'H3 no period invented';
  perform set_config('v2a1.npf', v_f::text, true);
  perform set_config('v2a1.npp', r ->> 'purchase_id', true);
end $$;

-- The office adds the October period (as the database owner here, as Dacs Web would).
reset role;
do $$
declare v_p uuid;
begin
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (current_setting('v2a1.owner')::uuid, current_setting('v2a1.npf')::uuid, 'October', 2026, 'progress', 1) returning id into v_p;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_p, current_setting('v2a1.owner')::uuid, 10000);
  perform set_config('v2a1.npperiod', v_p::text, true);
end $$;
set local role authenticated;

do $$
begin
  perform pur_refund(gen_random_uuid(), current_setting('v2a1.npp')::uuid, 'ZZ 2a1 period added');
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.npperiod')::uuid and not cover_expense) = 700, 'H4 re-funded onto the period';
  assert not exists (select 1 from expenses where folder_id = current_setting('v2a1.npf')::uuid), 'H5 the no-period row is gone, counted once';
  assert (select purchase_date from purchases where id = current_setting('v2a1.npp')::uuid) = '2026-10-14', 'H6 purchase date kept';
end $$;

-- ═══ I. Phone purchasing needs the Buyer switch (2A-2) ═══
do $$
begin
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', '2026-10-14', 'receipt_total', 1,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 x', 'amount', 1))));
    raise exception 'I1 a workmate purchase was accepted';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'I1 wrong error: ' || sqlerrm;
  end;
end $$;

-- ═══ J. Stock: added inside the purchase, once — a retry adds nothing ═══
do $$
declare op uuid := gen_random_uuid(); v_body jsonb;
begin
  v_body := jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 90,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 stock item',
                                                  'amount', 90, 'quantity', 6, 'unit', 'pc', 'in_inventory', true)));
  perform pur_record(op, v_body);
  perform pur_record(op, v_body);
  assert (select count(*) = 1 and sum(current_stock) = 6 from inventory where item_name = 'ZZ 2a1 stock item'), 'J1 stock added once';
end $$;

-- ═══ K. After its purchase is voided, a project can be deleted ═══
do $$
begin
  perform pur_void(gen_random_uuid(), current_setting('v2a1.npp')::uuid, 'ZZ 2a1 test');
end $$;
reset role;
do $$
begin
  delete from folders where id = current_setting('v2a1.npf')::uuid;
  assert not exists (select 1 from folders where id = current_setting('v2a1.npf')::uuid), 'K1 deleted';
  assert (select folder_name from purchase_lines where purchase_id = current_setting('v2a1.npp')::uuid) = 'ZZ 2a1 no period', 'K2 history readable';
end $$;

-- ═══ L. Replace: a different number of lines, stock never added twice ═══
set local role authenticated;
do $$
declare r jsonb; rr jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 40,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 replace item',
                                                  'amount', 40, 'quantity', 3, 'in_inventory', true))));
  rr := pur_replace(gen_random_uuid(), (r ->> 'purchase_id')::uuid, jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 50,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 replace item',
                                                  'amount', 40, 'quantity', 3, 'in_inventory', true),
                               jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 replace extra', 'amount', 10))),
    'ZZ 2a1 forgot a line');
  assert (select sum(current_stock) from inventory where item_name = 'ZZ 2a1 replace item') = 3, 'L1 stock carried over, not added twice';
  assert (select status from purchases where id = (r ->> 'purchase_id')::uuid) = 'void', 'L2 the old purchase is closed';
  assert not exists (select 1 from expenses e join purchase_lines l on l.id = e.purchase_line_id
                      where l.purchase_id = (r ->> 'purchase_id')::uuid), 'L3 the old rows left Spent';
  assert (select sum(e.amount) from expenses e join purchase_lines l on l.id = e.purchase_line_id
           where l.purchase_id = (rr ->> 'purchase_id')::uuid) = 50, 'L4 the new purchase counts once';
end $$;

-- ═══ M. Never another month's client period: October has ₱1,000, no Cover period, no December period ═══
reset role;
do $$
declare v_f uuid; v_p uuid;
begin
  insert into folders (owner_id, name) values (current_setting('v2a1.owner')::uuid, 'ZZ 2a1 cross month') returning id into v_f;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (current_setting('v2a1.owner')::uuid, v_f, 'October', 2026, 'progress', 1) returning id into v_p;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_p, current_setting('v2a1.owner')::uuid, 1000);
  perform set_config('v2a1.xmf', v_f::text, true);
  perform set_config('v2a1.xmp', v_p::text, true);
end $$;
set local role authenticated;
do $$
declare r jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-12-02', 'receipt_total', 300,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.xmf'), 'item_name', 'ZZ 2a1 december item', 'amount', 300))));
  assert r -> 'needs_review' = '[1]'::jsonb, 'M1 flagged for office review';
  assert (select count(*) = 1 and bool_and(e.project_id is null and e.folder_id = current_setting('v2a1.xmf')::uuid and e.cover_expense)
                 and sum(e.amount) = 300
            from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = (r ->> 'purchase_id')::uuid),
    'M2 one Cover row tied to the project — not parked on October';
  assert not exists (select 1 from expenses where project_id = current_setting('v2a1.xmp')::uuid), 'M3 October''s client money untouched';
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-20', 'receipt_total', 1000,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.xmf'), 'item_name', 'ZZ 2a1 october item', 'amount', 1000))));
  assert (select count(*) = 1 and bool_and(e.project_id = current_setting('v2a1.xmp')::uuid and not e.cover_expense) and sum(e.amount) = 1000
            from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = (r ->> 'purchase_id')::uuid),
    'M4 the October purchase is funded ₱1,000 from October, no Cover';
end $$;

-- ═══ N. Deleting is refused BEFORE anything is removed — a fully discounted purchase counts ═══
do $$
declare v_f uuid; v_p uuid;
begin
  insert into folders (owner_id, name) values (current_setting('v2a1.owner')::uuid, 'ZZ 2a1 discounted') returning id into v_f;
  perform pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 0,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', v_f, 'item_name', 'ZZ 2a1 free sample', 'amount', 10)),
    'charges', jsonb_build_array(jsonb_build_object('kind', 'discount', 'amount', 10))));
  assert pur_live_purchases(v_f, null) = 1, 'N1 the pre-check sees the zero-value purchase';
  perform set_config('v2a1.discf', v_f::text, true);
end $$;
reset role;
do $$
begin
  begin
    delete from folders where id = current_setting('v2a1.discf')::uuid;
    raise exception 'N2 a project with a live purchase was deleted';
  exception when others then
    assert sqlerrm like '%PURCHASES_LIVE%', 'N2 wrong error: ' || sqlerrm;
  end;
  assert exists (select 1 from folders where id = current_setting('v2a1.discf')::uuid), 'N3 nothing removed';
end $$;

select '2a1 acceptance: all checks passed' as result;
rollback;
````

- [ ] **Step 6: Run everything.**

Run: `npm test && npm run test:sql`
Expected: exit 0, **969** `ok`, then `45 passed`, then `10 passed` (967 where no built Dacs Attendance APK sits next to the repo: `tests/app-updates.test.js` skips two checks).

- [ ] **Step 7: Commit point (the user commits).** The five files above. After the push, check that the **first** CI run is green on all three steps. It is the first time CI downloads the SQL tools.

---

### Task 4: Live — apply, verify, browser check (with the user)

The Supabase connector must be authorized first (`/mcp` → supabase). **Ask before every production call.** These rules hold throughout:
- Never edit live data by SQL; the office acts in Dacs Web.
- Never print the DB password or connection string.

- [ ] **Step 1: See the finding for yourself, before any change.** Log in as a **staff** account.
  - Open a Main Contract project whose current period still has budget, then open **Add expense**.
  - Expected today: the pink **"No remaining budget — expense will be recorded as Cover Expenses"** banner.
  - In the Expenses list, rows show **Cover** tags.
  - **Do not save.**
- [ ] **Step 2: Dry run on live, rolled back.** Use MCP `execute_sql` to run, in **one** call:
  1. `begin;`
  2. the full `0096_purchase_recording.sql`
  3. the body of `2a1_acceptance.sql`, without its own `begin;` and `rollback;`
  4. `rollback;`

  Expected: `2a1 acceptance: all checks passed`. Confirm with `select to_regclass('public.purchases')` → `null`.
- [ ] **Step 3: Apply.** With the user's go-ahead, MCP `apply_migration` with name `0096_purchase_recording`. Then verify:
  - `select count(*) from pg_proc where proname like 'pur\_%'` → **29**
  - triggers `expenses_purchase_guard`, `folders_purchase_delete_guard`, `projects_purchase_delete_guard` → 3 rows
  - `select column_name from information_schema.columns where table_name = 'expenses' and column_name in ('purchase_line_id','purchase_charge_id','folder_id')` → 3 rows
- [ ] **Step 4: Live acceptance.** Run `supabase/tests/2a1_acceptance.sql` through MCP `execute_sql`.
  Expected: `2a1 acceptance: all checks passed`.
- [ ] **Step 5: Push the web change.** The user commits and pushes; Vercel deploys. **Only after Step 3** (R12).
- [ ] **Step 6: Browser checks on `dacs-company.vercel.app/admin.html`.** Use a test project "ZZ 2a1 browser" with October periods: ₱5,000 #1, ₱4,000 #2, and a Cover period.

| # | Who | Action | Expected |
|---|---|---|---|
| B1 | Owner | Add expense ₱8,000, 14 Oct | "Split into 3 records". The list shows `(1/3)`, `(2/3)` and `(3/3)` with **From purchase** tags. Project Control Spent rises by exactly ₱8,000. |
| B2 | Staff | Add expense ₱100, October date | **No pink banner.** Saved to a period, not Cover. No pesos in the message. The list shows **no** budget-guess Cover tags. |
| B3 | Owner | Add expense dated a month with no period | "charged to Cover for office review"; the row shows **Office review**. |
| B4 | Owner | Edit B1's row → ₱8,500, reason "receipt said 8,500" | The form showed **₱8,000** (the full line), no funding picker, and a required reason. Spent rose by **₱500**. |
| B5 | Owner | Delete B1's row → "Void this purchase?" with a reason | All three rows gone; Spent falls by ₱8,500. |
| B6 | Staff | Add expense on a **completed** project | "only the owner can add or change its costs". Nothing saved. |
| B7 | Owner | Edit and delete an **old** (pre-0096) row | Exactly as before. |
| B8 | Owner | Additional Works job: ₱1,000 | One row on the AW period, not Cover; nothing on the parent. |
| B9 | Owner | New project "ZZ 2a1 no period" (no periods): Add expense ₱700 | "this project has no billing period yet … Cover for office review". **The Expenses dashboard Total Spent rises by ₱700**, as do the folder card and Project Control (with the **No billing period** note under Billing Periods). Reports, CSV and the full billing print show **No billing period (Cover)** ₱700. |
| B10 | Owner | Add an October period to "ZZ 2a1 no period", then Edit the ₱700 row unchanged with reason "period added" | The row moves onto the period. Spent stays ₱700 (not ₱1,400). The note is gone. |
| B11 | Owner | Add expense with **"Track in inventory"** ticked: "ZZ 2a1 bolts", qty 6 | Inventory shows ZZ 2a1 bolts **6**, once. |
| B12 | Owner | Try to delete "ZZ 2a1 no period" **before** voiding | "has 1 purchase(s), so it cannot be deleted"; **nothing** removed. The period and its row are still there. |
| B13 | Owner | Void the B9 and B11 purchases, then delete "ZZ 2a1 no period" | The delete succeeds. |

- [ ] **Step 6b: Access.** If a module-focused account exists (e.g. `admin-pm@`, PM only), sign in with it. Expenses → Add expense is refused ("not set up for Expenses"), and it reads no purchases.
- [ ] **Step 7: Errors.** Run `select at, page, kind, message from client_errors where at > now() - interval '2 hours' order by at desc limit 50;`. Expected: nothing from `pur_` or the Expenses or Project Control pages.
- [ ] **Step 8: Clean-up.**
  - Void the remaining B-test purchases. History stays.
  - Delete the "ZZ 2a1 browser" project.
  - Remove the "ZZ 2a1 bolts" stock item in Inventory.
- [ ] **Step 9: Close-out.**
  - Append `## Execution notes`.
  - Update memory `workmate-stage2-decisions.md` (2A-1 done; next 2A-2).
  - Update CLAUDE.md's money-test count (239 → 248).

---

## Self-review against the spec and the 14–15 October decisions

- **§3.1 one operation, retries:** five operations sharing `pur_op_begin` (operation lock, then the stored answer). Proven by the PGlite retry test and the two-session "same operation id at once" test.
- **§3.2 ordinary rows:** `pur_charge_rows`. Warehouse lines write none. Money-math §P proves linked rows read identically.
- **§3.3 steps 1–6:** each step has a test and a deliberate break that the tests catch.
- **No period at all (14 Oct):**
  - Kept, counted at once as Cover, flagged, no period invented (PGlite tests, acceptance H).
  - Read at every Spent site: money test §P (Project Control, report model, KPI, three prints), the screen test (dashboard, overview cards, folder list, folder cards, detail), and the static test (screen filters, CSV and print line).
  - `pur_refund` keeps the date and the total (PGlite, acceptance H).
- **Q24 Additional Works:** in full, never Cover; with no period, refused (R5).
- **§3.4:** fees to the centavo (largest remainder, never negative, exactly the fee), discounts, no negative rows, totals. All tested.
- **§3.5 payments:** none in 2A-1.
- **§3.6 corrections, re-funds, replacements and voids:** the difference only, history, void keeps the receipt, replace never doubles stock. All tested.
- **§3.7:** Cover is a subset; petty cash etc. untouched (static test); staff hiding unchanged in Project Control (`tests/project-control-staff.test.js` passes).
- **Office side:** completed lock (R6), owner-only move (R7), "From purchase", changes only through the purchase (trigger).
- **Deletion (14–15 Oct):** asked first and refused before anything is removed, zero-value purchases included (screen test, PGlite, acceptance N); allowed after voiding (PGlite, acceptance K).
- **Access (14–15 Oct):** the Expenses section is required to record **and read**; the Buyer switch is required for phone purchasing (PGlite, acceptance I).
- **Stock (14–15 Oct):** once per line, independently guarded, company-scoped, carried over on replacement (PGlite, races 3, 5 and 8, acceptance J and L).
- **Concurrency (15 Oct):** two changes to the same purchase run one after the other (races 6 and 7).
- **CI (14 Oct):** `npm test` + `npm run test:sql` (Task 3).

## Execution evidence (15 Oct 2026)

Revision 3 was built and tested in a scratch clone before execution; revision 4 is the code as built in the real repo after the execution reviews above. Nothing touched the live database.

- **`npm run test:sql`:** 45 passed (PGlite), then 10 passed (two sessions on PostgreSQL 17).
  - Revision 1 fails the race tests: every pair deadlocked.
  - Revision 2 fails race 7 (stale project lock) and race 8 (no replace).
- **Deliberate breaks to the migration:** (measured on revision 3; the execution-review fixes below each carry their own fail-first test) **40 breaks, all accounted for: 38 caught directly**, by the intended test.
  - **Behaviour suite:** funding order, other months, payroll, Cover flag, review flag, AW cap, row guard, retry, totals, discount, staff on completed, staff move, void, Cover target, date, rounding, PM-only record, workmate, no-period refused, re-fund adding, foreign period, foreign Cover period, stock on correction, stock guard, folder foreign key, project-level rows, read rule (both the *null* bug and the missing Expenses check), company-scoped stock, replace adding stock, replace keeping old rows, delete guard reading only expense rows, no folder delete guard, no period delete guard, pre-check ignoring zero-value lines.
  - **Race suite:** no locks, no operation lock, no purchase lock.
  - **The two not caught directly are deliberately covered another way:**
    - A foreign *budget* alone is also stopped by the remaining-fund check, so it is proven by breaking both layers, which is caught.
    - In this revision, locking after saving the lines is harmless: lines no longer hold a database link to the project. What matters is locking before the remaining fund is read. Moving the locks after funding **is** caught: the period overspends.
- **Execution-review fixes:** each was first shown failing on the old code by its new test (Task 1: stock pairing, NaN; Task 2: Additional Works delete check; final: the cross-month Cover row fails PGlite and acceptance M2, the completed Additional Works job fails both its checks).
- **Web:**
  - The purchase gate in edit, the per-Save operation id, the staff banner and the void call were each caught when broken.
  - The screen test fails 7 of 8 checks on revision 2 code (dashboard ₱350 instead of ₱1,050; deletion reaching the database) and passes on this one.
- **`npm test`:** exit 0, 969 `ok` lines (967 where no built Dacs Attendance APK sits next to the repo: `tests/app-updates.test.js` skips two checks).
- **Acceptance dry run:** `2a1_acceptance.sql` (A–N) was dry-run on PGlite with the real 0002 budget, expense and project RLS and `request.jwt.claims`. It printed `2a1 acceptance: all checks passed`, and nothing remained after the rollback.
- **Plan re-application:** the plan's 7 new files and 54 edits were applied, in plan order, to a fresh worktree of `main` @ `51c9a3b`. All **18** files came out **byte-identical** to the built and reviewed repo copy. `npm test` exited 0 (967 `ok` there: no APK next door), and the SQL suites gave 45 + 10 passed. Fail-first: Task 1 Step 4 gives ENOENT; Task 2 Step 2 gives 18 passed, 9 failed, then 1 passed, 7 failed.
