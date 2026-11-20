# Project Management — Billing Request, Acknowledgement Receipts, payment photo

Date: 18 November 2026

Written for: the owner, implementer and reviewer.

Status: Design from the owner's answers of 18 November 2026. Not built. Needs database update **0116**.

## 1. Why

Project Control already has a **Billing Request** and a saved, numbered **Acknowledgement Receipt** (0114,
spec `2026-11-09-billing-acknowledgement-receipts-mvp-terms.md`). The owner wants the same two documents
in **Project Management → project → Money → Payment**, where Project Management records the money a client
pays. The PM projects are billed in tranches (for example a ₱389,000 downpayment recorded by hand), so the
Billing Request asks for a **percentage of the Project Budget**, as in Project Control (owner's choice "A").

In the same change the owner asked to **remove the every-Friday payment request** and to let **Add Payment
carry a receipt photo**.

## 2. Goals, non-goals, anti-goals

**Goals**
- An owner can print a Billing Request for a PM project: a percentage of the Project Budget, every payment
  received so far, and the total received.
- An owner can issue a saved, numbered Acknowledgement Receipt for each payment the client has made.
- Add Payment can attach one photo of the client's payment (deposit slip, transfer screenshot).
- The Friday payment request is gone from the office screens.

**Non-goals**
- The client and partner portals do not change (`Client Management.html`, `Dacs Partnership.html`,
  `client-payment.js`, `client-management-app.js`).
- No "Proof of Payments" page for PM: the Billing Request already lists every payment and the total.
- No email delivery, no CSV, no PDF beyond the browser's print dialog.
- Project Control's documents, tables and functions do not change.

**Anti-goals (a failure even if it works)**
- A receipt amount anyone can type. The server reads it from the payment row.
- An AR number that appears twice, across Project Control and Project Management together.
- A document that writes or changes a payment, invoice, bill, budget, expense or anything in Spent / Earned /
  Profit, or feeds PM profit sharing, the warranty reserve or cash advances.
- Deleting any existing payment row while removing the Friday request.
- Showing staff the two document buttons.

## 3. What exists today (checked 18 Nov 2026)

- PM money-in lives in `payment_requests` rows with `construction_project_id` set. The Payment section is
  `#ws-panel-money` in `admin.html`; its code is `_pmLoadPayments` / `_pmPayUpdateKPIs` / `_pmPayRenderTable`
  and the modals below them in `js/pm-admin.js` (~line 5873).
- Live rows: **12, all payments, none a Friday request.** 9 `manual_payment` / `verified` (Add Payment),
  2 `self_payment` / `verified`, 1 `self_payment` / `paid`. No `source = 'pm-admin'` row exists.
- **Every PM payment row and every `construction_projects` row has `owner_id` null.** PM access is by role
  (`is_owner() or is_staff()`), not by company. New server functions therefore cannot filter by
  `owner_id = company` the way 0114 does (see §6).
- The contract figure is `construction_projects.budget` ("Project Budget" on screen).
- Add Payment (`#pmAddPaymentModal`, `pmSaveManualPayment`) has date, amount, reference no. and notes. No
  photo. The View modal (`#pmSelfPayReviewModal`, `pmReviewSelfPay`) already shows `proofBase64`, which
  only website payments have (2 rows, 65–172 KB of text each).
- Staff have full PM access, including this section (owner decision 9 Nov 2026, kept as is).

## 4. Approaches (decided 18 Nov 2026)

**Where the PM receipts are saved**
- **Chosen: a new table for PM receipts that shares 0114's number counter** (`billing_receipt_counters`).
  One AR series, so no number can repeat across the two systems; the live Project Control receipts table,
  its guard and its real receipts are not touched.
- Rejected: adding PM payments to `billing_receipts`. One table, but it changes a live, guarded table that
  holds permanent receipts; a mistake there is hard to undo.

**Where the Add Payment photo is saved**
- **Chosen: a file in the private `uploads` bucket, folder `paymentReceipts/`, office only** (owner and staff
  accounts; see §6 Storage), with the address in a new column `payment_requests.proof_url`. This is how expense and
  payroll photos work since 0089. Clients do not see this photo.
- Rejected: base64 text in `proof_base64`, as website payments do. No storage rule needed and clients would
  see it, but it is the method being retired (big rows, slow pages).

**Billing Request amount**
- **Chosen (owner, "A"): a percentage of the Project Budget**, listing every payment received.
- Rejected: a printout of a Friday payment request. The Friday request is being removed.

## 5. Design

### 5.1 The Payment section after the change

```
Payment                                  [Billing Request]  [+ Add Payment]
  ₱389,000.00  TOTAL CASH RECEIPT
DATE           AMOUNT        STATUS                  ACTIONS
Nov 13, 2026   ₱389,000.00   Client paid · Paid      [View] [Acknowledgement Receipt]
```

- **Billing Request** and **Acknowledgement Receipt** appear for **owner accounts only**
  (`currentUserRole === 'owner'`); the server refuses everyone else.
- Columns become Date · Amount · Status · Actions. "Week of (Friday)" becomes "Date"; Strict and
  Carryover go (§5.5). The "Recorded by admin" / "Self payment" note under the date stays.

### 5.2 Acknowledgement Receipt (one per payment)

**Which rows get the button.** A row of this project whose status is `verified`, `paid` or `partial` and
whose **paid amount** is above ₱0. Rows that are `submitted` (waiting for review), `rejected`, `unpaid`
or anything else get none.

**Paid amount** (computed by the server, rounded to the centavo): for `verified`, the first non-zero of
`amount_paid`, `paid_amount`, `total_amount`; for `paid` and `partial`, `amount_paid`. This is the rule
the Total cash receipt tile already uses for these statuses, so on live data the two agree.

**What it prints.** The same page as Project Control's receipt (`BillingReceipts.receiptHTML`): logo,
company, ACKNOWLEDGEMENT RECEIPT, Acknowledgement No, Date, Received From, one item row, Full Payment
Amount, Payment Details from Acknowledgement Settings, Received by with DAC's e-signature stamp. The
item row reads **"Payment received (Nov 13, 2026)"**, using the payment's own date (`week_ending_date`).
If the payment has a reference number, it is added: "Payment received (Nov 13, 2026) · Ref. 12345",
cut to the 200-character limit.

**Number.** `AR-YYYYMM-NNN` from the shared counter, in the Philippine month of issue. Never reused.

**Behaviour, same as Project Control.**
- Pressing again reopens the same receipt. A double click or retry cannot create a second one
  (one live receipt per payment, enforced by the database).
- If the paid amount changes after issue, the dialog says so and offers **Void and Re-issue**: a reason
  is required, the old receipt stays on record marked void, and the new one gets a new number. Void and
  Re-issue is also offered when nothing changed, to fix a typed name.
- A saved receipt never changes. Voiding, once, is the only change allowed. It survives the payment row
  being changed or removed.

**Names.** Received from is kept per PM project; the first time it is filled in with the project's client
name. Received by is offered from the last one typed in **either** system, so it is typed once.

### 5.3 Billing Request

1. The owner presses **Billing Request**. A small window (the existing `BillingReceipts.askRequestPercent`)
   shows **Project Budget** and **Total received so far**, asks for a percentage from 0.01 to 100 with up
   to two decimals, shows the amount, and has the optional, remembered **Prepared by**.
2. If the request is over what is left (Project Budget − Total received), it warns and the owner can
   continue: "This request is over what is left of the Project Budget (₱X). You can still continue." /
   "This project has already received its full Project Budget, so this request goes over it. You can
   still continue."
3. The page opens in a new window: the same design 1b layout as Project Control's
   (`_pcBillingRequestHTML`), with these differences:
   - **Reference** (owner, 18 Nov 2026, from the Project Control sample): `PM-` and the first six characters of
     the PM project's id, uppercase (Project Control prints `FLD-…` the same way), above Date issued.
   - Requested from: the PM project's client name and email (left out if empty). Project: project name
     and address.
   - Wording: "Please release the next billing funds to support continued project work. The breakdown
     below lists each payment received so far."
   - Requested box: "10% of Project Budget" and its peso amount. The Project Budget figure is not printed.
   - **Payments received** table, oldest first: No. · Payment (date, and reference number if any) ·
     Amount; footer **Total Received**.
   - **With no payments yet** (the first request, usually the downpayment) the page still prints, with
     "No payments received yet" and Total Received ₱0.00.
4. A project with no Project Budget cannot make a request: "This project has no Project Budget yet, so a
   percentage cannot be worked out."
5. Nothing is saved. The page is built from fresh reads each time; any failed read closes the window with
   a retry message instead of printing partial figures. Amount = `budget × percent ÷ 100`, rounded to the
   centavo (`BillingReceipts.requestAmount`).

### 5.4 Add Payment photo

- Add Payment gets an optional **Receipt photo** field: one image, compressed like expense photos
  (`DacsReceipts.compressToBlob`, 900 px, JPEG 0.75), with a small preview and a remove button.
- On Save the photo is uploaded first to `paymentReceipts/<account>/<yyyy-mm>/<uuid>.jpg` (month from
  local parts), then the row is saved with `proofUrl`. If the upload fails, nothing is saved and the form
  shows the reason. If the row save fails after the upload, the unused file is left (accepted, as in
  `pm-sharing-items.js`).
- The View modal shows `proofUrl` (signed on display by `supabase-config.js` §11b) and falls back to
  `proofBase64` for website payments.
- **Photos for payments already saved (owner, 18 Nov 2026).** On a payment recorded by hand
  (`source = 'manual_payment'`), View has an **Add photo** button, or **Replace photo** once one exists.
  It uploads the same way and then updates only that row's `proofUrl` (and `updatedAt`); no other field
  of the payment changes. A photo can be replaced but not removed. The replaced file stays in storage
  (named files are never deleted by this feature). Website payments keep the photo the client sent and
  get no Add photo button. This is how the 9 payments already recorded can get their slips.
- Staff can attach a photo too: they record payments today, and the folder is office-only, not owner-only.
- The date field becomes **"Payment date"** and defaults to **today** (built from local parts), not next
  Friday. It is still stored in `weekEndingDate`.

### 5.5 Removing the Friday payment request

Office screens only. No row is deleted; `strict`, `carryover` and the other columns stay in the database.

| Where | Removed |
|---|---|
| Payment section (`admin.html`, `pm-admin.js`) | **Send Payment Request** button and `#pmPaymentRequestModal`; the dark "Next payment due" banner (`#pm-pay-banner`); the **Outstanding balance**, **Next payment due** and **Strict weeks** tiles; the **Strict** and **Carryover** columns; the Edit and Strict/Unstrict row buttons; `pmOpenPaymentRequestModal`, `pmEditPayReq`, `pmSavePaymentRequest`, `pmToggleStrict` |
| Project cards (`_pmComputeProjectMetrics`, `_pmRenderProjectCards`) | **This Friday**, **Balance due** and the On track / Partial / Overdue badge. All three measure only Friday requests |
| Project Overview (`_pmOvHtml`) | The **Next payment due** dark card (with its Send request / Edit buttons), the **Next payment due** and **Outstanding balance** tiles, and the cadence pill |
| PM Reports (`_pmRptRenderKPIs`, `_pmRptCashReceipt`, print) | The **Outstanding — client still owes** card, on screen and on the printout (owner, 18 Nov 2026 follow-up). Remaining Cash Receipt moves up beside Total Paid |

Kept: Add Payment, website payments and their Approve / Reject review, Total cash receipt, Remaining cash
receipt, the payment donut (which already uses Project Budget − paid), the recent payments list, the
Revolving Fund, the rest of PM Reports, profit sharing, and the cost-plus Payment Requests view (`payment-requests.js`).
Profit sharing's internal "Client still owes" chip (`PMShare.outstanding`) is left as is: it shows only above ₱0,
which no longer happens.

The builder greps every remaining reader of `thisFriday`, `balanceDue`, `cadence`, `pm-pay-banner`,
`pm-pay-outstanding`, `pm-pay-next-due`, `pm-pay-strict-count` and the removed functions, including the
mobile layout, and removes or adjusts each.

## 6. Database update 0116

Applied by the owner; verify it live before relying on it.

**Tables**
- `pm_billing_receipts`: the same columns and checks as `billing_receipts`, with `project_id`
  (construction project) and `payment_id` (payment row) in place of `folder_id` / `period_id`. No foreign
  keys, so a receipt outlives its payment or project. Unique `(owner_id, receipt_no)`; one live receipt per
  `payment_id` (partial unique index); the same guard trigger function as 0114
  (`billing_receipts_guard()`, which is table-agnostic): no delete, and only a single void.
- `pm_billing_receipt_parties`: `project_id` primary key, `owner_id`, `received_from`, `received_by`,
  `updated_by`, `updated_at`.
- `payment_requests.proof_url text` (nullable).

**Access.** RLS on both new tables; select on `pm_billing_receipts` for owner accounts of the company
(`is_owner() and owner_id = attendance_data_owner()`, as 0114); no write grants. The parties table has no
grant at all.

**Functions** (security definer, `search_path = public, pg_temp`, refusal codes as in 0114 plus `NOT_PAID`):
- `pmar_state(p_project uuid)`: the project (name, address, client name and email, budget), the eligible
  payments with their paid amounts and labels, all receipts for the project, the names, business and
  payment details. One server rule for "paid amount" serves the receipts **and** the Billing Request.
- `pmar_issue(p_payment uuid, p_received_from text, p_received_by text)`: locks the payment row
  (`for no key update`), returns the live receipt if one exists, otherwise issues one.
- `pmar_reissue(p_receipt uuid, p_reason text, p_received_from text, p_received_by text)`: void and
  re-issue together or not at all.
- Reuse `bar_company()` (owner-only, active) and `bar_clean_name()`. The number comes from a new helper
  that does the same upsert on `billing_receipt_counters` as `bar_new_receipt`; 0114's functions are not
  redefined.

**Company check.** PM rows carry no `owner_id` (all null on live). A payment or project is accepted when its
`owner_id` is null **or** equals the caller's company. The receipt stores the caller's company in
`owner_id`.

**Storage (changed after the final review, 18 Nov 2026).** 0116 adds **no** storage rule: `paymentReceipts/`
falls under 0110's general office rule (owner or staff), the same access every office account has to the
payment rows themselves; clients and workers get nothing. The first design locked the folder to
`data_owner_id()` like `expenseReceipts`, but each owner-role account (admin-pm@, the PM-only login) is its
own `data_owner_id()`, so its photos would have been hidden from the main owner and staff, and theirs from it.
No `receipt_uploads` ledger row (its check allows only expense/payroll).

## 7. Files (fan-out)

| File | Change |
|---|---|
| `supabase/migrations/0116_pm_billing_documents.sql` | New (§6) |
| `supabase/migrations/README.md` | Add 0116 |
| `js/pm-billing-docs.js` (new, `window.PMBillingDocs`) | Receipt dialogs, Billing Request reads and page; the **only** caller of `pmar_*` |
| `js/billing-receipts.js` | Only if needed: optional labels for `askRequestPercent` / `requestWarning` so PM can say "Total received". Project Control wording and output stay exactly the same |
| `js/receipt-storage.js` | New kind `payment` → `paymentReceipts` |
| `js/pm-admin.js` | Buttons, table columns, Add Payment photo, View photo with Add / Replace photo, all removals in §5.5 |
| `admin.html` | Payment section markup, Add Payment field, View modal's Add / Replace photo, removed modal/banner/tiles, `<script>` tag for `pm-billing-docs.js` after `billing-receipts.js` and `receipt-storage.js` |
| `tests/storage-access.test.js` | `FOLDERS`: `paymentReceipts: 'admin'` (the general office rule) |
| Tests (new) | `tests/pm-billing-docs.test.js`; `supabase/tests/pmar_receipts.pglite.mjs` + concurrency; both added to `package.json` |
| `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md` §4, `docs/PROJECT_MANAGEMENT_MVP.md` | New tables and column, module row, Money tab description |
| `CLAUDE.md` | One money-invariant line: PM receipts are outside the money model; only `js/pm-billing-docs.js` calls `pmar_*` (the owner's file: propose the line, owner approves) |

No portal HTML changes, so nothing to mirror into `Client Management.html` / `Dacs Partnership.html`.

## 8. Boundaries

**Outside the money model.** A receipt is a record of a document; a Billing Request is a printout. Nothing
here writes or changes a payment row (apart from Add Payment's own new photo address), weekly bill, invoice,
budget, expense, payroll or accounting entry, and nothing feeds Spent / Earned / Profit, PM profit sharing
(`pm-sharing.js`), the warranty reserve or cash advances. A receipt relies on the payment row as the record
of money in hand; it does not check a bank.

## 9. Acceptance criteria

1. An owner sees **Billing Request** at the top of Payment and **Acknowledgement Receipt** on each paid row.
   Staff see neither, and the server refuses them.
2. A receipt prints the payment's paid amount, a new AR number and the 0114 layout; pressing again
   reopens it; two presses at once give one receipt.
3. Issuing in Project Control and Project Management one after the other, or at the same time, never
   produces the same AR number.
4. After the paid amount changes, Void and Re-issue needs a reason, keeps the old receipt void, and gives
   a new number and amount.
5. Rows that are submitted, rejected or unpaid have no receipt button, and a direct call is refused.
6. The Billing Request asks for a percentage first, prints that percentage and its amount, every payment
   received oldest first and Total Received; it prints with no payments; it warns over what is left; it
   never prints the Project Budget figure or any spending.
7. Add Payment saves an optional photo to `paymentReceipts/`; View shows it; a client account cannot read it.
   On a payment recorded by hand, View can add or replace the photo, changing nothing else on the row;
   website payments have no Add photo button.
8. No Send Payment Request button, banner, Strict / Carryover columns, This Friday, Balance due, cadence badge,
   Next payment due or Outstanding balance remains on the office screens. No payment row was deleted.
9. Typed text is escaped on every page; printing hides the print button.
10. `npm test` and `npm run test:sql` pass; `node --check` passes on every changed script.

## 10. Calls made in this design (for the owner to check)

1. The receipt's item row reads "Payment received (date)" plus the reference number when there is one.
2. The Billing Request prints even with no payments yet (the first, downpayment request).
3. Received from starts as the project's client name; Received by is shared across both systems.
4. Besides "This Friday", the project cards lose **Balance due** and the **On track / Overdue** badge, and
   the Overview loses **Outstanding balance**, **Next payment due** and its pill. Each measured only Friday
   requests, so each would always read ₱0 or "On track".
5. The Add Payment date becomes "Payment date", defaulting to today.
6. One photo per payment; staff can attach it.
7. Add / Replace photo on View is for payments recorded by hand only; a photo can be replaced, not
   removed, and the replaced file stays in storage.

## 11. Left to the builder

- Whether `pm-billing-docs.js` reuses `billing-receipts.js`'s dialog code by parameterising it or keeps its
  own small copy, as long as Project Control's behaviour and `tests/billing-receipts.test.js` stay unchanged.
- ~~A Reference line on the Billing Request~~ — decided by the owner: `PM-xxxxxx` (§5.3).
- Layout details of the Payment section and the Overview grid once tiles are removed.
