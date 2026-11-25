# Project Control receipts: payment date and reference on the line

Date: 20 November 2026 · Written for: the owner, implementer and reviewer · Status: approved by the owner
("1A + 2A", 20 Nov 2026). Needs database update **0117**.

## Why

Project Management receipts (0116) print "Payment received (Nov 20, 2026) · Ref. …". The owner wants that to be
the standard, so Project Control's receipts (0114) say when the client paid and with which reference too.

## Decided

- **1A — typed when the receipt is issued.** Project Control's Acknowledgement Receipt window gets **Payment date**
  (defaults to today, never in the future) and **Reference no.** (optional, up to 100 characters). They are saved on
  the receipt only and frozen like the rest of it. Billing periods, Fund Allocated and every money figure are
  untouched.
- **2A — the billing name stays first:**
  `Progress Billing 3 (November 2026) · Payment received (Nov 20, 2026) · Ref. PC-NDBMOB-20261118-70453908`
  (no reference: the line ends after the date; cut to 200 characters like every receipt line).
- **Void and Re-issue** asks for both again, pre-filled from the old receipt (today and blank for a receipt issued
  before 0117).
- The amount is still always the period's Fund Allocated, read by the server. No function accepts an amount.

## Not changing

Project Management receipts and their window, the Overall Billing Acknowledgement (Proof of Payments), the Billing
Request, and receipts already issued (AR-202611-002/003/004 keep their line; a void and re-issue gives the new one).
The receipt page layout redesign in the working tree (owner's, uncommitted) is kept as it is.

## Database update 0117

- `billing_receipts.paid_on date` and `billing_receipts.payment_reference text` (nullable; 1–100 characters when
  set). Old rows stay null. 0114's guard still allows only a single void.
- `bar_issue_with_payment(p_period, p_received_from, p_received_by, p_paid_on, p_reference)` and
  `bar_reissue_with_payment(p_receipt, p_reason, p_received_from, p_received_by, p_paid_on, p_reference)`: the same
  locks, checks, numbering and parties as `bar_issue` / `bar_reissue`, plus the two values and the new line.
  Refusals `PAID_ON_REQUIRED`, `PAID_ON_FUTURE` (after today in Manila), `REFERENCE_TOO_LONG`.
- 0114's `bar_issue` / `bar_reissue` are kept unchanged, so the live site keeps working between applying 0117 and
  pushing the web code. Owner accounts only, as before; only `js/billing-receipts.js` calls them.

## Follow-up, 20 Nov 2026: the owner's final receipt layout (database update 0118)

From the owner's sample PDF (AR-202611-006) and answers:

- **Item line typed by the owner.** Both receipt windows (Project Control and Project Management) get a
  **Description** box, pre-filled with the automatic line and editable, e.g. "Full Payment of the Down Payment
  (Nov 20, 2026)". Up to 200 characters; blank is refused on screen, and the server falls back to the automatic
  line. In Project Control the box follows the payment date and reference while it still holds the automatic line.
  Re-issue pre-fills the old receipt's line. New functions `bar_issue_described` / `bar_reissue_described` and
  `pmar_issue_described` / `pmar_reissue_described` (0118); the 0114, 0116 and 0117 functions stay unchanged.
- **Company details and signature: show / hide.** Two tick boxes beside Print / Save PDF ("Company details",
  "Signature") hide the logo, name and address block and the e-signature / Received by block. The switches never
  print, start ticked, and the browser remembers the last choice. Same on the Overall Billing Acknowledgement.
- **Bank payment details** print as "Payment Via: <bank>", "Bank Transfer No.: <account no.>", "Account Name"
  (no Branch line). GCash is unchanged. The owner switches Acknowledgement Settings to BDO.
- The page layout itself stays the committed one (Qty, Unit Price, Full Payment Amount, title on the right).

## Acceptance

1. A Project Control receipt issued with a date and reference prints the 2A line; without a reference, the line
   ends after the date. 2. A future date, a missing date or a reference over 100 characters is refused, on screen
   and by the server. 3. Re-issue pre-fills the old values and keeps the old receipt void. 4. Pressing again returns
   the same receipt and spends no number. 5. Project Management's window and receipts are unchanged. 6. `npm test`
   and `npm run test:sql` pass.
