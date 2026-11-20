# PM Billing Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Project Management's Money → Payment section an owner-only Billing Request and saved, numbered Acknowledgement Receipts, add a receipt photo to payments, and remove the every-Friday payment request from the office screens.

**Architecture:** Database update 0116 adds a PM receipts table that shares 0114's AR counter, three `pmar_*` server functions that read every amount themselves, a `payment_requests.proof_url` column and an office-only `paymentReceipts/` storage folder. A new browser module `js/pm-billing-docs.js` is the only caller of `pmar_*` and reuses `js/billing-receipts.js`'s receipt page, dialogs and percentage window through small, default-preserving parameters. `js/pm-admin.js` and `admin.html` get the buttons, the photo field and the removals.

**Tech Stack:** Plain HTML + vanilla JS (no build step), Supabase Postgres (plpgsql, RLS), PGlite / embedded-postgres SQL tests, Node `vm` sandbox tests.

**Spec:** `docs/superpowers/specs/2026-11-18-pm-billing-documents-design.md`

## Global Constraints

- Never run `npm run build`. Edit files directly.
- **Do not commit.** The owner commits by hand. Each task ends by listing its changed files.
- **Deploy order:** 0116 is applied by the owner and verified live **before** any of this web code goes live (an Add Payment photo writes `proof_url`; the buttons call `pmar_*`).
- 0114's tables and functions are **not redefined or altered**. Project Control's documents keep their exact wording and output; `tests/billing-receipts.test.js` and `tests/billing-request.test.js` stay green unchanged.
- The two document buttons are **owner accounts only** (`window.currentUserRole === 'owner'`); `pmar_*` refuse everyone else through `bar_company()`.
- Receipt number: `AR-YYYYMM-NNN`, Philippine month of issue, from `billing_receipt_counters`, never reused across both systems.
- Local date keys from local parts (`_pmToday()`); never `toISOString().slice(0,10)`.
- Outside the money model: nothing here writes or changes a payment (apart from the photo address), bill, invoice, budget, expense, payroll, or anything read by `_projSpent` / `_projEarned` / `_projMargin`, `js/pm-sharing.js`, `js/warranty-fund.js`, `js/cash-advance.js`.
- Client and partner portals are not touched (`Client Management.html`, `Dacs Partnership.html`, `js/client-payment.js`, `js/client-management-app.js`).
- Changed script tags in `admin.html` get `?v=20261118a`.
- Copy fixed by the spec (verbatim):
  - Receipt item row: `Payment received (Nov 13, 2026)`, plus ` · Ref. <reference>` when a reference exists, cut to 200 characters.
  - Billing Request lead: `Please release the next billing funds to support continued project work. The breakdown below lists each payment received so far.`
  - Over-the-budget warnings: `This request is over what is left of the Project Budget (₱X). You can still continue.` / `This project has already received its full Project Budget, so this request goes over it. You can still continue.`
  - No budget: `This project has no Project Budget yet, so a percentage cannot be worked out.`
  - Empty list: `No payments received yet`; footer label `Total Received`; requested box `<p>% of Project Budget`.

## Review Focus

1. **A verified payment whose `amount_paid` is 0 or empty** (older website payments): the receipt must use `paid_amount`, then `total_amount`, the same as Total cash receipt. Test in Task 1 (`verified with no amount_paid falls back to paid_amount, centavos kept`).
2. **A payment that stops being paid after its receipt** (status set back, amount cleared): pressing the button must show the existing receipt with an Open Old Receipt choice and no re-issue, never an error. Tests in Task 1 (`state keeps the receipt of a payment that is no longer paid`) and Task 2 (`a receipt whose payment is no longer paid: changed, nothing to re-issue`).
3. **A project with no Project Budget, or a budget of `null`**: the Billing Request stops with the no-budget message and opens no window. Test in Task 2 (`no Project Budget: message, no window`).
4. **Names, references and project names containing `<`, `&`, quotes or the apostrophe in DAC'S**: every page escapes them. Tests in Task 2 (`the Billing Request page escapes every typed text`) and Task 1 (`a long or odd reference is stored raw and cut to 200`).
5. **A photo upload that fails (network, or 0116 not applied)**: nothing is saved, the form shows why, and a payment with no photo still saves without a `proofUrl` key. Tests in Task 3 (`a failed photo upload saves nothing and shows the reason`, `Add Payment without a photo sends no proofUrl key`).

---

### Task 1: Database update 0116 and its tests

**Files:**
- Create: `supabase/migrations/0116_pm_billing_documents.sql`
- Create: `supabase/tests/pmar_base.mjs`, `supabase/tests/pmar_receipts.pglite.mjs`, `supabase/tests/pmar_concurrency.mjs`
- Modify: `package.json` (`test:sql`: append `&& node supabase/tests/pmar_receipts.pglite.mjs && node supabase/tests/pmar_concurrency.mjs`)
- Modify: `tests/storage-access.test.js` (`FOLDERS`: `paymentReceipts: 'tenant'`; extend the tenant-lock test)
- Modify: `supabase/migrations/README.md` (0116 in the canonical order), `docs/DATABASE_SCHEMA.md` (`payment_requests.proofUrl`, the two new tables)

**Interfaces:**
- Consumes (0114, unchanged): `bar_company() → uuid`, `bar_clean_name(text) → text`, `billing_receipts_guard()`, `billing_receipt_counters`, `billing_receipt_parties`, `settings.invoiceDefaults`.
- Produces:
  - `pm_billing_receipts`: the columns and checks of `billing_receipts`, with `project_id uuid not null` and `payment_id uuid not null` in place of `folder_id` / `period_id`; no foreign keys; `unique (owner_id, receipt_no)`; partial unique index `pm_billing_receipts_one_live on (payment_id) where voided_at is null`; index on `(project_id, created_at)`; trigger `pm_billing_receipts_guard` (before update or delete) executing `billing_receipts_guard()`; RLS select policy `pm_billing_receipts_owner_read` = `is_owner() and owner_id = attendance_data_owner()`; `grant select` only.
  - `pm_billing_receipt_parties (project_id uuid primary key, owner_id uuid not null, received_from text not null default '', received_by text not null default '', updated_by uuid, updated_at timestamptz not null default clock_timestamp())`; RLS on, no grant.
  - `payment_requests.proof_url text` (nullable).
  - `pmar_paid_amount(p_status text, p_amount_paid numeric, p_paid_amount numeric, p_total_amount numeric) → numeric`: `verified` → first non-zero of amount_paid, paid_amount, total_amount; `paid` / `partial` → amount_paid; anything else → 0; null → 0; rounded to 2.
  - `pmar_label(p_date text, p_reference text) → text`: `'Payment received (' || to_char(date, 'Mon FMDD, YYYY') || ')'`; a blank or unparseable date gives `'Payment received'`; a non-blank trimmed reference appends `' · Ref. ' || ref`; `left(…, 200)`.
  - `pmar_state(p_project uuid) → jsonb` with exactly:
    `{ project: { id, name, address, client_name, client_email, budget }, received_from, received_by, business: { name, tin, address }, payment_details, payments: [ { id, date, reference, label, amount, source } ], total_received, receipts: [ <pm_billing_receipts row>, newest first ] }`.
    `payments` holds only rows with `pmar_paid_amount(...) > 0`, ordered by `week_ending_date`, then `created_at`. `received_from` = the project's parties row, else the project's `client_name`, else `''`. `received_by` = the project's parties row, else the latest non-empty `received_by` of this company in **either** `pm_billing_receipt_parties` or `billing_receipt_parties` (by `updated_at`).
  - `pmar_issue(p_payment uuid, p_received_from text, p_received_by text) → jsonb` (the receipt row).
  - `pmar_reissue(p_receipt uuid, p_reason text, p_received_from text, p_received_by text) → jsonb` (the new receipt row).
  - Refusal codes: 0114's (`NOT_SIGNED_IN`, `PROFILE_MISSING`, `INACTIVE`, `OWNER_ONLY`, `NOT_FOUND`, `NAME_REQUIRED`, `NAME_TOO_LONG`, `REASON_REQUIRED`, `REASON_TOO_LONG`, `ALREADY_VOID`) plus `NOT_PAID`.
  - Storage folder `paymentReceipts/<company>/<yyyy-mm>/<uuid>.jpg`: read, write and overwrite for owner or staff whose `data_owner_id()` is path segment 2.

- [ ] **Step 1: Write `supabase/tests/pmar_base.mjs`**

Export `PMAR_SETUP` = `BR_SETUP` (from `br_base.mjs`) + `STORAGE_STANDIN` (from `pm_sharing_items_base.mjs`, plus any stub 0116's restated storage rules need to be created: `pur_petty_reader`, `pm_si_file_ok`, `dacs_try_uuid`, `cproj_client_can_read`, `cproj_partner_can_read`, `is_worker`, each returning false/null) + PM tables mirroring live columns: `construction_projects (id, owner_id, client_name, client_email, project_name, address, budget, created_at)` and `payment_requests (id, owner_id, construction_project_id, kind, source, status, amount, total_amount, amount_paid, paid_amount, week_ending_date text, reference_number, proof_base64, created_at)` **without** `proof_url`, both with live-style RLS (`is_owner() or is_staff()`). Export `M116`, `PM` (project ids), `PAY` (payment ids) and `seedPm(exec)`:

| id | project | source / status | amounts | date / ref |
|---|---|---|---|---|
| `PAY.V1` | `PM.A` | manual_payment / verified | all 389000 | 2026-11-13 / `GC-123` |
| `PAY.V2` | `PM.A` | self_payment / verified | amount_paid 0, paid_amount 140000.5, total 140000.5 | 2026-10-02 / null |
| `PAY.P1` | `PM.A` | self_payment / paid | amount_paid 200000, paid_amount null | 2026-07-24 / null |
| `PAY.S1` | `PM.A` | self_payment / submitted | amount_paid 0, paid 50000 | 2026-11-14 |
| `PAY.R1` | `PM.A` | self_payment / rejected | amount_paid 0 | 2026-11-01 |
| `PAY.U1` | `PM.A` | pm-admin / unpaid | total 10000 | 2026-11-20 |
| `PAY.B1` | `PM.B` | manual_payment / verified | 5000 | 2026-11-13 |

`PM.A`: owner_id **null**, client `Sample Client`, budget 1000000, address `Quezon City`. `PM.B`: owner_id = `IDS.OTHER`. `PM.Z`: owner_id null, budget null, no payments. Also seed one Project Control folder + billing period (reuse `seedReceipts` from `br_base.mjs`) for the shared-counter test.

- [ ] **Step 2: Write the failing behaviour tests in `supabase/tests/pmar_receipts.pglite.mjs`** (same harness shape as `br_receipts.pglite.mjs`; `fresh()` runs `PMAR_SETUP`, `M114`, `M116`, seeds, signs in as `IDS.OWNER`)

- `a receipt takes the paid amount and labels the payment with its date and reference`: `pmar_issue(PAY.V1, 'Sample Client', 'Cristher Dacome')` → amount 389000, billing_label `Payment received (Nov 13, 2026) · Ref. GC-123`, receipt_no `AR-<ym>-001`, project_id `PM.A`, payment_id `PAY.V1`, owner_id `IDS.OWNER`, voided_at null.
- `there is no way to pass an amount`: identity arguments of `pmar_issue` = `p_payment uuid, p_received_from text, p_received_by text`.
- `verified with no amount_paid falls back to paid_amount, centavos kept`: V2 → 140000.5, label `Payment received (Oct 2, 2026)`.
- `a website payment marked paid gets a receipt`: P1 → 200000.
- `submitted, rejected and unpaid rows are refused`: S1, R1, U1 → error contains `NOT_PAID`; no row in `pm_billing_receipts`.
- `pressing again returns the same receipt and spends no number`: second call with other names → same id and number, names unchanged, `billing_receipt_counters.last_no` = 1.
- `Project Control and Project Management share one number series`: `bar_issue` (a PC period), `pmar_issue(V1)`, `bar_issue` (another period), `pmar_issue(P1)` → `-001`, `-002`, `-003`, `-004` in that order across both tables.
- `void and re-issue keeps the old receipt and takes the new paid amount`: issue V1; as admin set V1 `amount_paid = paid_amount = total_amount = 390000`; `pmar_reissue(id, 'Amount corrected', …)` → new number, amount 390000; old row voided with that reason; one live row for V1.
- `re-issue needs a reason, and a void receipt cannot be voided again`: empty reason → `REASON_REQUIRED`; reissuing the old id → `ALREADY_VOID`.
- `a receipt can never be edited or deleted`: as admin, `update pm_billing_receipts set amount = 1` and `delete` → `RECEIPT_PERMANENT`.
- `staff and clients are refused, and another company's project is not found`: as `IDS.STAFF` and `IDS.CLIENT`, `pmar_state(PM.A)` and `pmar_issue(PAY.V1)` → `OWNER_ONLY`; after an owner issue, `IDS.STAFF` reading `pm_billing_receipts` sees 0 rows; as `IDS.OWNER`, `pmar_state(PM.B)` and `pmar_issue(PAY.B1)` → `NOT_FOUND`.
- `pmar_state lists paid payments oldest first with the total, receipts and names`: for `PM.A` → payments ids `[P1, V2, V1]`, amounts `[200000, 140000.5, 389000]`, `total_received` 729000.5, `project.budget` 1000000, `received_from` `Sample Client` before any issue, `received_by` = the name last used in Project Control.
- `names typed once: Received from per project, Received by across both systems`: after `pmar_issue(V1, 'Client X', 'Person Y')`, `pmar_state(PM.A).received_from` = `Client X`; `bar_state(<PC folder>).received_by` stays its own unless empty; `pmar_state(PM.Z).received_by` = `Person Y`.
- `state for a project with no payments`: `pmar_state(PM.Z)` → `payments` `[]`, `total_received` 0, `project.budget` null.
- `state keeps the receipt of a payment that is no longer paid`: issue V1, set V1 status `submitted` as admin → `pmar_state(PM.A).payments` lacks V1, `receipts` still has its live receipt.
- `a long or odd reference is stored raw and cut to 200`: set V1 reference to `<b>&"'` + 300 × `x` → label length 200, starts with `Payment received (Nov 13, 2026) · Ref. <b>&"'`.
- `nothing outside the receipt tables changes`: row counts and `md5(string_agg(t::text, ''))` of `payment_requests`, `expenses`, `invoices`, `projects`, `project_budgets` identical before and after an issue + reissue.
- `proof_url exists and paymentReceipts is office-only for that company`: column `payment_requests.proof_url` exists (text, nullable); `uploads_can_read('paymentReceipts/<OWNER>/2026-11/<uuid>.jpg', null)` and `uploads_can_write(same)` → true as `IDS.OWNER` and `IDS.STAFF`, false as `IDS.CLIENT` and `IDS.OTHER`; the same path under `<OTHER>` → false as `IDS.OWNER`.

- [ ] **Step 3: Write the failing race tests in `supabase/tests/pmar_concurrency.mjs`** (shape of `br_concurrency.mjs`, real PostgreSQL)

- `two presses at once give one receipt`: two sessions `pmar_issue(PAY.V1)` concurrently → both return the same id; one row.
- `PC and PM issuing at the same moment never share a number`: 10 rounds of concurrent `bar_issue` + `pmar_issue` on fresh items → all numbers across both tables distinct and consecutive.
- `re-issue racing an issue leaves exactly one live receipt`.

- [ ] **Step 4: Run them and see them fail**

Run: `npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/pmar_receipts.pglite.mjs`
Expected: FAIL (0116 file missing).

- [ ] **Step 5: Write `supabase/migrations/0116_pm_billing_documents.sql`**

Header comment in 0114's style (what, why, outside the money model, owner-only, only `js/pm-billing-docs.js` calls `pmar_*`, PM rows carry no `owner_id`). `set local lock_timeout = '5s';`. Then the Produces list above. Private helpers `pmar_project(p_company uuid, p_project uuid) → construction_projects` (raises `NOT_FOUND` unless the row exists and `owner_id is null or owner_id = p_company`), `pmar_next_no(p_company uuid) → text` (the counter upsert of `bar_new_receipt`, same format incl. `greatest(3, …)` padding), `pmar_save_parties(...)`, `pmar_new_receipt(p_company uuid, p_payment uuid, p_from text, p_by text) → pm_billing_receipts` (caller holds the payment row lock; raises `NOT_PAID` when the paid amount is 0). `pmar_issue` / `pmar_reissue` lock the payment row with `for no key update` before reading receipts. Revoke helpers from `public, anon, authenticated`; grant execute on the three `pmar_*` entry points to `authenticated`. Storage: restate `uploads_can_read` and `uploads_can_write` from 0110's bodies **byte-for-byte**, changing only the tenant lists to `('expenseReceipts', 'payrollReceipts', 'paymentReceipts')`; restate the `uploads_admin_update` policy from 0110 with the same one-list change; restate the grants and revokes that follow them.

- [ ] **Step 6: Extend `tests/storage-access.test.js`**

Add `paymentReceipts: 'tenant'` to `FOLDERS`. In `receipt folders are tenant-locked (0089)`, also assert the latest `uploads_can_read`, `uploads_can_write` and `uploads_admin_update` contain `'paymentReceipts'` inside the same tenant list, before the generic owner/staff rule. In the 0110 test, keep every existing assertion (they must still hold in 0116's restated bodies).

- [ ] **Step 7: Run the tests and see them pass**

Run: `node supabase/tests/pmar_receipts.pglite.mjs && node supabase/tests/pmar_concurrency.mjs && node supabase/tests/br_receipts.pglite.mjs && node supabase/tests/br_concurrency.mjs && node tests/storage-access.test.js`
Expected: every line `ok`, exit 0.

- [ ] **Step 8: Docs** — `supabase/migrations/README.md` gets 0116; `docs/DATABASE_SCHEMA.md` gets `payment_requests.proofUrl` (office-only photo address, `paymentReceipts/`), `pm_billing_receipts` and `pm_billing_receipt_parties` (outside the money model, owner-only).

- [ ] **Step 9: Stop — list the changed files for the owner. Do not commit.**

---

### Task 2: `js/pm-billing-docs.js` (receipts dialog and Billing Request)

**Files:**
- Create: `js/pm-billing-docs.js`, `tests/pm-billing-docs.test.js`
- Modify: `js/billing-receipts.js` (dialog `ops` and percentage-window labels, defaults unchanged)
- Modify: `admin.html` (script tag `js/pm-billing-docs.js?v=20261118a` right after `billing-receipts.js`; bump `billing-receipts.js` to `?v=20261118a`)
- Modify: `package.json` (`test`: append `&& node tests/pm-billing-docs.test.js`)
- Modify: `docs/ARCHITECTURE.md` §4 (row "PM Billing Documents"), `CLAUDE.md` (one money-invariant bullet, below)

**Interfaces:**
- Consumes: Task 1's `pmar_state` / `pmar_issue` / `pmar_reissue` and the `pmar_state` JSON shape.
- Produces (`window.PMBillingDocs`):
  - `paidAmount(row) → number` — the client mirror of `pmar_paid_amount`, on camelCase rows (`status`, `amountPaid`, `paidAmount`, `totalAmount`).
  - `isPaidRow(row) → boolean` — `paidAmount(row) > 0`.
  - `planFor(state, paymentId) → { kind: 'new'|'issued'|'changed'|'not_paid', period: { id, label }, live, voided, amount }` — `period` is the payment (id, label) so 0114's dialogs work unchanged; a live receipt whose payment is gone from `state.payments` → `kind 'changed'`, `amount 0`, `period` from the receipt (`payment_id`, `billing_label`); no receipt and not in `state.payments` → `'not_paid'`.
  - `requestWarning(budget, received, amount) → string` — the two spec texts, `''` when within what is left (centavo arithmetic like `BillingReceipts.requestWarning`).
  - `requestPageHTML(state, request) → string`, `request = { percent, amount, preparedBy, now: Date }`.
  - `refusalText(error) → string` — 0114 messages via `BillingReceipts.refusalText` for shared codes; `NOT_PAID` → `This payment is not marked paid, so there is nothing to acknowledge.`; a `PGRST202` or a message naming `pmar_` / `pm_billing_receipt` → `Acknowledgement Receipts in Project Management need database update 0116 applied first.`
  - `actions = { state(projectId), issue(popup, paymentId, from, by), reissue(popup, receiptId, reason, from, by) }` — rpc through `window.sbClient`; issue/reissue write `BillingReceipts.receiptHTML(receipt)` into the popup and close it on failure (as 0114's `guarded`).
  - `openReceipt(projectId, paymentId) → Promise<void>` and `openBillingRequest(projectId) → Promise<void>` — both return immediately unless `currentUserRole === 'owner'`.
- `js/billing-receipts.js` additions (exported on `window.BillingReceipts`):
  - `openReceiptDialog(state, plan, ops)`, `ops = { issue(popup, periodId, from, by), reissue(popup, receiptId, reason, from, by), amountLabel, noAmountText }`. Project Control's `openReceipt` calls it with `{ issue: actions.issue, reissue: actions.reissue, amountLabel: 'Fund Allocated', noAmountText: 'A new receipt can be issued once this billing has Fund Allocated.' }`, so its dialogs read exactly as today.
  - `askRequestPercent(o)` accepts optional `o.contractLabel` (default `'Project Budget (contract)'`), `o.allocatedLabel` (default `'Total Allocated so far'`) and `o.warning(contract, allocated, amount)` (default `requestWarning`).

- [ ] **Step 1: Write the failing tests in `tests/pm-billing-docs.test.js`** (load `billing-receipts.js` then `pm-billing-docs.js` into one `vm` context, as `billing-receipts.test.js` does; fake `sbClient.rpc` recording calls)

- `paid amount follows the Total cash receipt rule`: verified `{amountPaid:0, paidAmount:140000.5}` → 140000.5; verified `{amountPaid:0, paidAmount:0, totalAmount:9}` → 9; paid `{amountPaid:200000}` → 200000; partial `{amountPaid:5}` → 5; submitted `{amountPaid:7}` → 0; rejected → 0.
- `planFor offers to issue, reopen, or void and re-issue`: no receipt → `new` with amount; matching live → `issued`; live 389000 vs payment 390000 → `changed`; one centavo off → `changed`.
- `a receipt whose payment is no longer paid: changed, nothing to re-issue`: live receipt, payment absent → `kind 'changed'`, `amount 0`, `period.label` = receipt's `billing_label`.
- `not paid and no receipt: nothing to issue` → `not_paid`.
- `the receipt page is 0114's page with the payment line`: `BillingReceipts.receiptHTML(<pmar receipt>)` contains `ACKNOWLEDGEMENT RECEIPT`, the AR number, `Payment received (Nov 13, 2026) · Ref. GC-123` and `₱389,000.00` three times.
- `the Billing Request page carries the request, every payment and the total`: from a state with 3 payments → contains the spec lead text, `10% of Project Budget`, `₱100,000.00` (10% of 1,000,000), the three labels oldest first, `Total Received`, `₱729,000.50`, `Sample Client`, `Quezon City`, the Prepared by name; does **not** contain `₱1,000,000.00`, `Spent`, `Cover`.
- `the Billing Request prints with no payments yet`: empty `payments` → contains `No payments received yet` and `₱0.00` under `Total Received`.
- `printing hides the print button`: the page's CSS has `@media print` with `.toolbar{display:none}`.
- `the Billing Request page escapes every typed text`: client name `A<b>&"'`, project name `DAC'S <i>`, reference `<script>`, preparedBy `<img>` → none appear raw; escaped forms present.
- `over-budget warnings use the spec wording`: `requestWarning(1000000, 950000, 100000)` → `…over what is left of the Project Budget (₱50,000.00)…`; `requestWarning(1000000, 1000000, 1)` → the "already received its full Project Budget" text; within → `''`.
- `refusals read in plain words`: `NOT_PAID`, `OWNER_ONLY`, `ALREADY_VOID`, `{code:'PGRST202'}` → the texts above.
- `issue and reissue call only pmar_ functions with no amount`: calls equal `[['pmar_issue', {p_payment, p_received_from, p_received_by}]]` and `[['pmar_reissue', {p_receipt, p_reason, p_received_from, p_received_by}]]`; no argument key contains `amount`.
- `staff and other roles open nothing`: with `currentUserRole: 'staff'`, `openReceipt` / `openBillingRequest` make no rpc and open no window.
- `no Project Budget: message, no window`: `pmar_state` returns `project.budget` null, then 0 → `alert` called with the no-budget text; `window.open` never called; `askRequestPercent` never called.
- `the percentage window says Project Budget and Total received so far`: `openBillingRequest` passes `contractLabel: 'Project Budget'`, `allocatedLabel: 'Total received so far'`, `contract` = budget, `allocated` = `total_received`, and `warning` = `PMBillingDocs.requestWarning`.
- `a failed fresh read closes the window and prints nothing`: `onContinue` with the second `pmar_state` rejecting → popup closed, `alert('Could not prepare the billing request. Please refresh and try again.')`.
- `only pm-billing-docs.js calls pmar_, and no money file mentions the PM receipts`: scan `js/*.js` — `pmar_` appears only in `js/pm-billing-docs.js`; `pm_billing_receipt` / `pmar_` appear in none of `portal-app.compiled.js`, `expenses-module.js`, `pm-sharing.js`, `warranty-fund.js`, `cash-advance.js`, `project-finance.js`.
- `Project Control's dialogs and window keep their wording`: source of `billing-receipts.js` `openReceipt` passes `amountLabel: 'Fund Allocated'`; `askRequestPercent` defaults are `'Project Budget (contract)'` and `'Total Allocated so far'`.

- [ ] **Step 2: Run and see it fail**

Run: `node tests/pm-billing-docs.test.js`
Expected: FAIL (`js/pm-billing-docs.js` missing).

- [ ] **Step 3: Parameterise `js/billing-receipts.js`**

`issueDialog`, `existingDialog`, `reissueDialog` take `ops` and use `ops.issue` / `ops.reissue` / `ops.amountLabel` / `ops.noAmountText` wherever they now hard-code `actions.issue`, `actions.reissue`, `'Fund Allocated'` and the "once this billing has Fund Allocated" sentence. Add `openReceiptDialog(state, plan, ops)` (the `new` / `issued` / `changed` dispatch now inside `openReceipt`). `askRequestPercent` reads the three optional fields. Nothing else changes.

- [ ] **Step 4: Write `js/pm-billing-docs.js`**

IIFE on `window` in `billing-receipts.js`'s style, header comment stating outside the money model, owner-only, only caller of `pmar_*`. `openReceipt`: load `pmar_state` → `planFor` → `BillingReceipts.openReceiptDialog(state, plan, { issue: actions.issue, reissue: actions.reissue, amountLabel: 'Amount paid', noAmountText: 'This payment is no longer marked paid, so no new receipt can be issued.' })`, or the not-paid message dialog. `openBillingRequest`: load `pmar_state`; budget not > 0 → `alert(<no-budget text>)`; else `BillingReceipts.askRequestPercent({ projectName, contract: budget, allocated: total_received, contractLabel, allocatedLabel, warning: requestWarning, onContinue })`; `onContinue(percent, preparedBy)` opens the window inside the click, re-reads `pmar_state`, writes `requestPageHTML(fresh, { percent, amount: BillingReceipts.requestAmount(budget, percent), preparedBy, now: new Date() })`. `requestPageHTML` follows `_pcBillingRequestHTML` (`js/portal-app.compiled.js:1807`): same CSS and structure and `window.dacsPrintHeader('Billing Request', 'Payments received · All time')` fallback; sub-title `Payments received`; no Reference line; table columns `No.` · `Payment` · `Amount`, each row `Payment received` with `<small>` date and `Ref. …`; footer `Total Received`; footer strip `DAC'S Building Design Services · Billing Request` and `Generated <now>`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `node tests/pm-billing-docs.test.js && node tests/billing-receipts.test.js && node tests/billing-request.test.js && node --check js/pm-billing-docs.js && node --check js/billing-receipts.js`
Expected: all `ok`, exit 0.

- [ ] **Step 6: Wire and document**

`admin.html` script tags (Files). `docs/ARCHITECTURE.md` §4 row: `PM Billing Documents | pm-billing-docs.js (window.PMBillingDocs) | Billing Request and Acknowledgement Receipts for PM payments (0116). Outside the money model; owner-only; the only caller of pmar_*; reuses billing-receipts.js's page and dialogs.` `CLAUDE.md`, after the 0114 bullet: `- **PM Acknowledgement Receipts (0116) are a record of a document, outside the money model.** One live receipt per paid PM payment; the amount is the payment's paid amount, read by the server (no pmar_* function accepts an amount). Numbers share 0114's AR series and are never reused; a change is void-with-reason and re-issue. The PM Billing Request is a printout (a % of the Project Budget, payments received, Total Received) and records nothing. Owner accounts only. Only js/pm-billing-docs.js calls the pmar_* functions. Spec: docs/superpowers/specs/2026-11-18-pm-billing-documents-design.md.`

- [ ] **Step 7: Stop — list the changed files for the owner. Do not commit.**

---

### Task 3: The Payment section (buttons, photo, Friday request out)

**Files:**
- Modify: `js/pm-admin.js` (Payment section, ~lines 5873–6232), `admin.html` (`#ws-panel-money`, `#pmAddPaymentModal`, `#pmSelfPayReviewModal`; delete `#pmPaymentRequestModal`; bump `pm-admin.js` and `receipt-storage.js` to `?v=20261118a`)
- Modify: `js/receipt-storage.js` (`FOLDER.payment = 'paymentReceipts'`; header comment line for 0116)
- Modify: `tests/receipt-storage.test.js`, `tests/storage-access.test.js` (upload-folder scan pattern: add `payment` to the `receipt-storage.js FOLDER map` regex)
- Create: `tests/pm-payment-section.test.js`; Modify: `package.json` (`test`: append it)
- Modify: `docs/PROJECT_MANAGEMENT_MVP.md` (Money tab)

**Interfaces:**
- Consumes: `PMBillingDocs.isPaidRow(row)`, `PMBillingDocs.openReceipt(projectId, paymentId)`, `PMBillingDocs.openBillingRequest(projectId)` (Task 2); `payment_requests.proof_url` and the `paymentReceipts/` rule (Task 1); `DacsReceipts.compressToBlob(file)`, `DacsReceipts.receiptPath(kind, ownerId)`.
- Produces:
  - `admin.html` ids: `pm-pay-billing-request` (button, hidden by default), `pmAddPayPhoto` (file input, `accept="image/*"`), `pmAddPayPhotoPreview`, `pmAddPayPhotoClear`, `err-pmAddPayPhoto`, `pmPayPhotoRow` (wraps the View modal's photo controls), `pmPayPhotoBtn`, `pmPayPhotoInput`, `pmPayPhotoErr`.
  - `js/pm-admin.js`: `async function _pmUploadPaymentPhoto(file) → string` (public-format URL); `window.pmOpenBillingRequest()`; `window.pmAddPayPhotoChanged(input)`; `window.pmAddPayPhotoClear()`; `window.pmPickPaymentPhoto()`; `window.pmSavePaymentPhoto(input)`.

- [ ] **Step 1: Write the failing tests in `tests/pm-payment-section.test.js`** (use `tests/helpers/pm-admin-sandbox.js`; stub `PMBillingDocs`, `DacsReceipts`, `sbClient.storage`, and a fake `db.collection('paymentRequests')` recording `add` / `update`; set `currentDataUserId`)

- `the table is Date, Amount, Status, Actions`: `admin.html` `#pm-pay-tbody`'s `<thead>` cells are exactly `Date`, `Amount`, `Status`, `Actions`; rendered rows contain no `Strict`, `Unstrict`, `Carryover`, `data-pm-action="edit"`, `data-pm-action="toggle-strict"`.
- `every row has View; owner sees Acknowledgement Receipt only on paid rows`: render verified, paid, submitted, rejected, unpaid rows as owner → `data-pm-action="ack-receipt"` on the first two only; every row has `data-pm-action="review"`; clicking `ack-receipt` calls `PMBillingDocs.openReceipt(<project id>, <row id>)`.
- `staff see no document buttons`: as staff → no `ack-receipt`; after `_pmLoadPayments()`, `pm-pay-billing-request.style.display === 'none'`; as owner → `''`.
- `Total cash receipt uses the shared paid rule`: `_pmPayUpdateKPIs(rows)` sets `pm-pay-total-paid` to `_fmt(PMShare.paid(rows))`.
- `the Friday payment request is gone from the Payment section`: `admin.html` contains none of `pmPaymentRequestModal`, `pm-pay-banner`, `pm-pay-outstanding`, `pm-pay-next-due`, `pm-pay-strict-count`, `Send Payment Request`, `Strict weeks`; `js/pm-admin.js` contains none of `pmOpenPaymentRequestModal`, `pmEditPayReq`, `pmSavePaymentRequest`, `pmToggleStrict`; `css/pm-admin.css` has no `.pm-pay-banner`.
- `Add Payment defaults to today and says Payment date`: after `pmOpenAddPaymentModal()`, `pmAddPayDate.value === _pmToday()`; `admin.html` modal contains `Payment date` and not `Payment for week of`.
- `Add Payment with a photo uploads to paymentReceipts and saves proofUrl`: choose a file, save → one upload whose path matches `^paymentReceipts/<company>/\d{4}-\d{2}/[0-9a-f-]{36}\.jpg$`, `upsert: false`; the `add` payload's `proofUrl` is that file's public URL; the upload happened before the `add`.
- `Add Payment without a photo sends no proofUrl key`: payload has no `proofUrl` property.
- `a failed photo upload saves nothing and shows the reason`: upload returns `{ error: { message: 'upload down' } }` → no `add`; `err-pmAddPayPhoto.textContent` contains `upload down`; the modal stays open.
- `View shows the office photo first, then the website photo`: `pmReviewSelfPay({ proofUrl: U, proofBase64: B })` → `pmSelfPayImg.src === U`; with only `proofBase64` → `B`.
- `payments recorded by hand get Add photo, then Replace photo; website payments get neither`: `manual_payment` without photo → `pmPayPhotoBtn.textContent` `Add photo`, row visible; with `proofUrl` → `Replace photo`; `self_payment` → `pmPayPhotoRow.style.display === 'none'`.
- `replacing a photo changes only the photo`: `pmSavePaymentPhoto(input)` → one `update` on that row with keys exactly `['proofUrl', 'updatedAt']`; then `_pmLoadPayments` runs.

Add to `tests/receipt-storage.test.js`: `payment photos are filed under paymentReceipts/<company>/<yyyy-mm>/<uuid>.jpg` → `receiptPath('payment', OWNER, new Date(2026, 10, 18), <uuid>)` = `paymentReceipts/<owner>/2026-11/<uuid>.jpg`.

- [ ] **Step 2: Run and see them fail**

Run: `node tests/pm-payment-section.test.js && node tests/receipt-storage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`admin.html`: Payment header sub-title `Record client payments, print a Billing Request, and issue Acknowledgement Receipts.`; buttons `Billing Request` (`id="pm-pay-billing-request"`, `style="display:none"`, `onclick="pmOpenBillingRequest()"`, secondary) and `Add Payment` (primary); one stat tile (Total cash receipt); thead `Date · Amount · Status · Actions`, `colspan="4"`; remove `#pm-pay-banner` and `#pmPaymentRequestModal`. Add Payment: info text ends `It's saved as a completed client payment.`; date label `Payment date`; a `Receipt photo (optional)` group with `pmAddPayPhoto` (`onchange="pmAddPayPhotoChanged(this)"`), preview image, `Remove` button, error line. View modal: `pmPayPhotoRow` with `pmPayPhotoBtn` (`onclick="pmPickPaymentPhoto()"`), hidden `pmPayPhotoInput` (`onchange="pmSavePaymentPhoto(this)"`), `pmPayPhotoErr`.
`js/pm-admin.js`: `_pmLoadPayments` shows `pm-pay-billing-request` only for owners and sets empty rows to `colspan="4"`; `_pmPayUpdateKPIs` sets only `pm-pay-total-paid` from `_pmOvPaid(reqs)`; `_pmPayRenderTable` renders Date (with the existing Self payment / Recorded by admin note), Amount (`totalAmount`, else `amount + carryover`), Status badge, `View`/`Review` for every row and, for owners when `PMBillingDocs.isPaidRow(r)`, an `Acknowledgement Receipt` button (`data-pm-action="ack-receipt"`); the delegated click handler routes `review` and `ack-receipt` only. Delete `pmOpenPaymentRequestModal`, `pmEditPayReq`, `pmSavePaymentRequest`, `pmToggleStrict` and the banner block. `pmOpenAddPaymentModal` uses `_pmToday()` and clears the photo; `pmSaveManualPayment` uploads first when a photo is chosen (error → `err-pmAddPayPhoto`, return), adds `proofUrl` only when it has one. `_pmUploadPaymentPhoto`: `compressToBlob` → `receiptPath('payment', window.currentDataUserId)` → `sbClient.storage.from('uploads').upload(path, blob, { upsert: false, contentType: 'image/jpeg' })` → `getPublicUrl(path).data.publicUrl`; throws `Couldn't upload the photo: <message>`. No `receipt_uploads` row. `pmReviewSelfPay` shows `r.proofUrl || r.proofBase64` and the photo row for `source === 'manual_payment'` only. `pmSavePaymentPhoto` uploads, then `db.collection('paymentRequests').doc(id).update({ proofUrl, updatedAt: serverTimestamp() })`, refreshes the image and `_pmLoadPayments()`; failures go to `pmPayPhotoErr`. `css/pm-admin.css`: delete the `.pm-pay-banner*` rules (desktop and mobile).

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tests/pm-payment-section.test.js && node tests/receipt-storage.test.js && node tests/storage-access.test.js && node tests/pm-sharing.test.js && node --check js/pm-admin.js && node --check js/receipt-storage.js`
Expected: all `ok`, exit 0.

- [ ] **Step 5: Docs** — `docs/PROJECT_MANAGEMENT_MVP.md` Money tab: payments recorded by hand or sent through the website, receipt photo, Billing Request and Acknowledgement Receipts (owner only); the Friday payment request no longer exists.

- [ ] **Step 6: Stop — list the changed files for the owner. Do not commit.**

---

### Task 4: Friday request out of the project cards and Overview

**Files:**
- Modify: `js/pm-admin.js` (`_pmComputeProjectMetrics` ~1618, `_pmRenderProjectCards` ~1749, `_pmOvHtml` ~272–760, the range refresh ~950 if it touches a removed tile)
- Modify: `tests/pm-payment-section.test.js` (section B), `docs/PROJECT_MANAGEMENT_MVP.md` (Projects home card list)

**Interfaces:**
- Consumes: nothing new.
- Produces: project-card metrics object `{ progressPct }` only (no `balanceDue`, `thisFriday`, `cadence`). `_pmOvOutstanding` stays defined (`tests/pm-sharing.test.js` C7 calls it).

- [ ] **Step 1: Write the failing tests (section B of `tests/pm-payment-section.test.js`)**

- `project cards show no This Friday, Balance due or payment badge`: render cards for an active project with an unpaid Friday row in its requests → HTML contains none of `This Friday`, `Balance due`, `On track`, `Partial`, `Overdue`; a completed project still shows its closeout badge.
- `the Overview has no Next payment due, Outstanding balance or payment pill`: `_pmOvHtml(project, [], [], [verified 800000, unpaid 10000])` → contains `Total cash receipt` and `Remaining cash receipt`; contains none of `Next payment due`, `Outstanding balance`, `Send request`, `On track`, `Partial last week`, `STRICT`.
- `no screen sends a Friday request any more`: `js/pm-admin.js` contains no `>Send request<` and no `paymentRequests').add(` with `source: 'pm-admin'`.

- [ ] **Step 2: Run and see them fail**

Run: `node tests/pm-payment-section.test.js`
Expected: section B FAIL.

- [ ] **Step 3: Implement**

`_pmComputeProjectMetrics`: drop the balance / this-Friday / cadence block and the `paymentRequests` query from its `Promise.all` (nothing else on the card reads it). `_pmRenderProjectCards`: remove the Balance due and This Friday stats and the cadence badge; keep the closeout badge for closed projects; keep the card grid tidy. `_pmOvHtml`: remove the Outstanding balance and Next payment due tiles (grid goes from 6 to 4 columns, mobile rules adjusted), the cadence pill and the `ovNextDue` card (the trend card takes the row). Grep for and clean every leftover reader of `thisFriday`, `balanceDue`, `cadence`, `nextDueDate`, `ovNextDue`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tests/pm-payment-section.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/money-math.test.js && node --check js/pm-admin.js`
Expected: all `ok`, exit 0.

- [ ] **Step 5: Stop — list the changed files for the owner. Do not commit.**

---

## Finish

1. Run everything: `npm test` and `npm run test:sql` (both exit 0), and `node --check` on `js/pm-billing-docs.js`, `js/billing-receipts.js`, `js/pm-admin.js`, `js/receipt-storage.js`.
2. The owner applies 0116. Then verify live (read-only SQL): both tables and `payment_requests.proof_url` exist; `pmar_state`, `pmar_issue`, `pmar_reissue` exist with the argument lists above and execute is granted to `authenticated` only; the live bodies of `uploads_can_read` / `uploads_can_write` contain `'paymentReceipts'`; 0114's functions are unchanged (md5 of their bodies before vs after).
3. The owner commits and pushes the web code only after step 2 passes.
4. Owner's browser check (`admin.html`, owner account, a real project): Billing Request with a percentage opens and prints; View on a recorded payment shows Add photo and a photo saves; the Acknowledgement Receipt dialog opens on a paid row (issuing one creates a **permanent** AR number, so issue only a real one); staff@ sees neither document button; the project cards and Overview show no Friday figures. **No test receipts on live without the owner's approval.**
