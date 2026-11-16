# Billing Periods Documents — MVP Terms

Date: 9 November 2026

Written for: the owner, implementer and reviewer.

Status: Rewritten from the owner's answers of 9 November 2026, which supersede every earlier version of this file. Built in the working tree. Migration 0114 has not been applied to the live database, and the owner's browser check is outstanding.

## 1. Three documents

All three open from Project Control → project → Billing Periods. Only owner accounts see or can open them.

| Button | Where | What it is | Money shown | Saved? |
|---|---|---|---|---|
| **Acknowledgement Receipt** | On each client billing period card | A receipt for that billing, laid out like the owner's sample | Pesos: that period's Fund Allocated | Yes, with a permanent AR number |
| **Overall Billing Acknowledgement** | Top of the page | One grand total received for the project | Pesos: one total only | No |
| **Billing Request** | Top of the page | Asks the client to release the next billing funds | Pesos: the requested amount, each client billing's amount and the total allocated. The only percentage is the share of the contract requested | No |

Cover periods get none of these: no button on a Cover card, and a direct call is refused. A project with only Cover periods shows none of the three.

## 2. Acknowledgement Receipt

**Contents, following the sample:** logo and company name, the title ACKNOWLEDGEMENT RECEIPT, Acknowledgement No, Date, Received From, one item row (for example "Progress Billing 3 (November 2026)", quantity 1), Full Payment Amount, Payment Details, and the Received by name with the company under it and DAC's e-signature stamp above it (`assets/images/dacs-signature.png`, the same stamp as the Invoice module's e-signature option).

**Amount.** Always that period's Fund Allocated, read by the server. No function accepts an amount and the owner cannot type one. A period with ₱0 Fund Allocated cannot get a receipt.

**Number.** `AR-YYYYMM-NNN`, issued by the server in the Philippine month of issue. It counts per company and month, and a number is never reused, even when its receipt is voided.

**Pressing the button again** reopens the same receipt with the same number. A double click or a retry cannot create a second receipt.

**If Fund Allocated changes** after issue, the page says so and offers Void and Re-issue. The old receipt is marked void with a required reason and stays on record, and a new receipt gets a new number and the new amount. Both happen together or not at all. Void and Re-issue is also available when the amount has not changed, so a mistyped name can be corrected.

**A saved receipt never changes.** Its amount, names, business details and payment details are frozen when issued. Later changes to Fund Allocated or Acknowledgement Settings do not alter it, and deleting the billing period does not delete it. Voiding is the only change a receipt can receive, and only once.

**Names.** Received from is typed once per project and offered again next time. Received by is typed once and offered on every project. Either can be changed, which affects later documents only.

**Payment details and company details** come from Acknowledgement Settings and are copied onto each receipt. If none are saved, the payment box is left out.

## 3. Overall Billing Acknowledgement

One page, in the same style, titled PROOF OF PAYMENTS (renamed from Overall Billing Acknowledgement on 10 November 2026): Project and Date, Received From, then every client billing that has Fund Allocated, numbered in date order and laid out like the invoice (Item Description / Service, Qty 1, Unit Price, Amount; no discount column, for example "Downpayment (June 2026)"), then Total Billings and the Total Received box, Payment Details and Received by, with the same e-signature stamp. A billing with no Fund Allocated yet is not listed. (The owner asked for the billing list on 10 November 2026, replacing the single total line.)

Total Received is the sum of Fund Allocated across the project's client billing periods, the same figure as Total Allocated on the screen. It never shows money spent. It has no AR number and is not saved, so it always shows the current total. It is refused while that total is ₱0.

## 4. Billing Request

Asks the client to release the next billing funds. It lists **every client billing with its amount** (its Fund Allocated), in date order, then the **Total Allocated**. It shows no spending in any form. (On 9 November 2026, after seeing earlier versions, the owner added the billing list and total and removed the Overall fund position box.)

**The amount requested is set first.** Pressing the button opens a small window showing the Project Budget (the contract amount) and Total Allocated so far. The owner types a percentage of the contract, from 0.01 to 100 with up to two decimals, and sees the amount it comes to. The page then prints "Requested this billing: 10% of Project Budget" and that amount, right under the request wording. The contract figure itself is not printed. If the requested amount is more than what is left of the contract (contract less Total Allocated), the window warns and the owner can still continue. A project with no contract amount cannot make a request. The amount is `contract × percent ÷ 100`, rounded to the centavo. A request is a document only: it creates no billing period, changes no Fund Allocated and records no money.

The page follows design 1b (owner's "Billing Request redesign", 9 November 2026), one formal A4 sheet: the company header; the title with Reference (the project code) and Date issued; Requested from (client name and email, left out when the project has no client on record) beside Project (name and location); the request wording; the requested box; Billing breakdown, numbered; a Prepared by signature line, showing the name typed in the percentage window (optional, remembered in that browser only; left blank, the line is signed by hand); and a footer with the date and time generated. There is no Received by line and no explanation note. Include this wording: “Please release the next billing funds to support continued project work. The breakdown below lists each client billing period.”

**Scope: client billing periods only**, over all time. Cover periods are left out, and Total Allocated is the sum of the client periods' Fund Allocated.

Nothing about the Billing Request is saved. It is generated from fresh reads each time, and any failed read closes the window with a retry message rather than printing partial figures.

## 5. The Billing Periods screen

Total Spent, and Remaining with it, include project overhead with no billing period, once. Company overhead and deleted rows stay out. The Billing Request shows no spending.

## 6. Boundaries

**Outside the money model.** A receipt is a record of a document. Nothing here creates or changes an expense, payroll row, invoice, payment, budget, billing period or accounting entry, and nothing feeds a receipt into Spent, Earned or Profit. Leaving Cover out of the Billing Request changes that page only: Cover is still Spent everywhere else.

A receipt relies on Fund Allocated as the record of money in hand. It does not check a bank or a payment record.

**Not in this MVP:** client or partner portal display, the Invoices list, email delivery, CSV export, signature images, and PDF files other than the browser's print dialog.

## 7. Implementation map

| Area | Location |
|---|---|
| Buttons, Billing Request page and reads | `js/portal-app.compiled.js`: `BillingPeriodsDrill`, `_pcBillingRequestHTML`, `_pcPrintBillingRequest` |
| Receipts, Overall page, dialogs | `js/billing-receipts.js` (`window.BillingReceipts`), the only caller of `bar_*` |
| Database | `supabase/migrations/0114_billing_acknowledgement_receipts.sql`: `billing_receipts`, `billing_receipt_counters`, `billing_receipt_parties`, `bar_state`, `bar_issue`, `bar_reissue`, `bar_set_parties` |
| Project identity | `folders.id`; billing periods are `projects` rows linked by `folderId`. Never `construction_projects.id` |

## 8. Acceptance criteria

1. An owner sees Overall Billing Acknowledgement and Billing Request at the top when a client billing period exists, and Acknowledgement Receipt on each client billing card. Cover cards have no document button.
2. Staff and other non-owner roles see no buttons and are refused by the server.
3. A new receipt prints the period's Fund Allocated, a new AR number and the sample's fields.
4. Pressing again reopens the same receipt. Two presses at once produce one receipt.
5. After Fund Allocated changes, Void and Re-issue needs a reason, keeps the old receipt as void, and gives a new number and amount.
6. No AR number is ever issued twice or reused.
7. A receipt is unchanged by later edits to settings or Fund Allocated, and survives deleting its billing period.
8. The Overall page lists each client billing that has Fund Allocated, with its amount and in date order, then Total Received. It shows no spending and no AR number.
9. The Billing Request asks for a percentage of the contract first, then shows that percentage and its peso amount, each client billing with its amount and the Total Allocated. It shows no spending, not the contract figure, and no mention of Cover. A request over what is left of the contract warns and can continue.
10. Received from is asked once per project and Received by once, and both can be changed.
11. Typed text is escaped on every page.
12. Printing hides the print button.
13. No document changes Spent, Earned, Profit, invoices, payments, budgets or billing periods.

Verification: `npm test`, `npm run test:sql`, `node --check` on the changed scripts, then the owner's browser check after 0114 is applied. Automated checks do not replace that check.
