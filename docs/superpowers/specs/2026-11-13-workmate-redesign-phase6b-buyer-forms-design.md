# WorkMate redesign — Phase 6b: Record purchase and the buyer's other screens (design)

**Status:** design approved by the owner 13 November 2026 ("A, A, A"); this spec awaits review.
**App:** DAC's WorkMate (`C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`), base `main` at `7a69308`
(0.17.0+1026, published 13 Nov). **Target:** `0.18.0+1027`. **No server change.**
**Source:** the Claude Design handoff (variant 1a "Inbox"): the Record purchase and Issue / move sheets. The other
screens have no mockup and take the `WmPage` look of Phases 3b and 5.

## 1. Purpose

Phase 6a redesigned the buyer's three tabs. Everything they open is still in the old look. 6b finishes the redesign:
Record purchase and Issue / move become the mockup's sheets; the screens the mockup does not draw become pages in the
new look. After 6b no old-style screen is left in the app.

## 2. Owner decisions (13 November 2026)

| Topic | Decision |
|---|---|
| Record purchase | **The mockup's sheet**, in the **mockup's order**: items first. Section titles in the mono capital style, not numbered circles. |
| Issue / move | **The mockup's sheet**; the item, from, to and request pickers stay **drop-down lists** (real stock is too long for chips); the quantity takes the mockup's − / +. |
| Throw away (Record purchase) | **A small bin button beside the sheet's ✕**, with today's confirmation. Closing the sheet keeps the draft, as leaving the page does today. |
| Screens with no mockup | **`WmPage` look**, nothing rearranged: Record leftovers, Purchase, Correct purchase, My cash, Record payment, Report a return, Buying is off. |
| Fields | As in every phase: **every real field stays**, including those the mockup leaves out. |

## 3. What does not change

- Every server call; `RecordController`, the draft model and its autosave, the queue and the sync, `StockSubmitter`,
  `StockController`, the pay models, the repository. Every validation and every problem message, with its key, shown
  where it is today relative to its field.
- **Money** (owner rules): a purchase's cost enters Material / Spent once, after the server accepts it, through the
  shared recording operation — the app only sends the same body as today. **A payment is recorded only from the
  person's own choice** ("Paid now?", default *Not paid yet*; Record payment) — never from "Paid with", a receipt
  photo or anything else. Petty cash, own money, returns and credits stay outside Spent. Stock screens show **no peso**.
  Nothing new shows an amount; no amount is removed.
- Receipt photos stay in the buyer-only folder; the photo slots, their camera / gallery choice and "No receipt" with
  its reason are unchanged.
- Words: every label, hint, notice and button text stays, in both languages where it has both. **No new Tagalog.**
  The only wording changes are the section titles of Record purchase (§5).
- Existing keys stay on the element that plays the same part. Record purchase: `record-form`, `record-discard`,
  `record-send`, `purchase-date`, `supplier`, `supplier-name`, `payment`, `line-<n>`, `item-<n>`, `qty-<n>`,
  `unit-<n>`, `unit-note-<n>`, `amount-<n>`, `category-<n>`, `place-<n>`, `match-<n>`, `substitute-<n>`,
  `extra-<n>`, `extra-location-<n>`, `unplanned-<n>`, `remove-line-<n>`, `add-line`, `add-fee`, `add-discount`,
  `charge-<n>`, `charge-amount-<n>`, `adjust-<n>`, `share-<n>-<i>`, `remove-charge-<n>`, `photo-<slot>`,
  `camera-<slot>`, `gallery-<slot>`, `remove-photo-<slot>`, `no-receipt`, `no-receipt-reason`, `notes`,
  `receipt-total`, `computed-total`, `paid-now`, `paid-amount`, `paid-from-…`, `paid-credit`, `paid-method`,
  `paid-overspend`, `problem-…`. Stock: `move-item`, `move-from`, `move-to`, `move-request`, `request-…`, `move-qty`,
  `move-reason`, `move-note`, `move-send`, `stock-load-failure`, `stock-day`, `leftover-project`, `leftover-line-…`,
  `leftover-qty`, `leftover-where`, `leftover-note`, `leftover-send`. The other screens: every key they have today
  (`correct…`, `detail-…`, `payments…`, `void-…`, `receipt-…`, `waiting-owner`, `cash-…`, `my-cash…`, `report-return`,
  `return-…`, `withdraw-…`, `dispute-…`, `issue-…`, `pay-…`, `buying-off-unsent`, `same-items-…`, `note-…`).
- `openRecord` and `openMove` keep their signatures and results, so `BuyerShell` is untouched apart from the dialog's
  look (§8).

## 4. Shared pieces

- `WmSheetFrame` gains an optional **`action`** widget shown to the left of the close button (used by the bin button).
- A private mono section label per file, as in 6a (`ITEMS (2)`).
- New keys: `move-minus`, `move-plus` (Issue / move's quantity). Record leftovers has one quantity per line and keeps
  plain fields, with no − / +.

## 5. Record purchase (sheet)

Opened with `showWmSheet<bool>` (tall); still returns `true` once queued. Title "Record purchase" / "Itala ang binili";
header buttons: the bin (`record-discard`, tooltip "Throw away") then ✕. Back and ✕ close and keep the draft.

Body, top to bottom (`record-form` stays the scrolling list):

1. "Saved on this phone as you type. It is sent when there is signal." and the notice, as today.
2. **ITEMS (N)** — one white card per item (radius 16, border, padding 14) with **every field it has today in today's
   order within the card** (item, quantity, unit and its note, amount paid, category, for project / job / warehouse,
   the request match, substitute, extra and its location, the no-request reason, remove), then its problems. The
   mockup's two fields side by side are kept where today's are already side by side.
   Under the cards: **+ Add an item with no request** as a white pill (`add-line`).
3. **SUPPLIER AND DATE** — the date field and the supplier picker (with the typed name when "Not on the list"), then
   **Paid with** (`payment`).
4. **DELIVERY FEES AND DISCOUNTS** — the hint line, the charge cards, and **+ Delivery fee** / **+ Discount** as pills.
5. **RECEIPT** — the photo slots (the mockup's dashed box for an empty slot: camera icon and "Receipt photo"),
   "No receipt" and its reason, then **Total on the receipt** (`receipt-total`) and the "Items + fees − discounts: …"
   line (`computed-total`, green when it matches).
6. **NOTES** — the notes field.
7. **PAID NOW?** — the hint ("Optional. A payment never changes Spent — …") and the paid-now block exactly as today.
8. The general problems.

Footer (pinned): **Record purchase / Itala ang binili** as a `WmSheetButton` (`record-send`), `busy` while sending.
The footer is capped and scrolls (6a), so it never hides the field being typed in.

The "Throw this purchase away?" dialog is unchanged.

## 6. Issue / move (sheet) and Record leftovers (page)

**Issue / move**: `openMove` shows a `WmSheetFrame` (title from today's `_title`, so a return or an issue from stock
keeps its own title). Mono labels ITEM, FROM, TO, QUANTITY, WHEN, NOTE over today's controls: the three drop-downs
(and the request picker and the unplanned reason when they show), the quantity as a field with **− and +** on either
side (52 px, radius 14; step 1, never below zero, decimals kept, off while sending or locked — the Received sheet's
behaviour), the day field, the note. A preset (`MovePreset`, `fixed`) locks the same controls as today. Footer:
**Send / Ipadala** (`move-send`) through `StockSending.sendFooter`; locked → `sendBox` in the body. The two-language
"A mistake? …" note stays under the button.

**Record leftovers**: `WmPage` titled "Record leftovers", same fields in the same order, Send in the footer with the
note under it, `sendBox` in the body when locked. `StockSending.sendArea` is then unused and is **removed**.

## 7. The pages with no mockup

Each becomes a `WmPage` (round back button, 24 / 800 title, 20-px sides) with its main button, where it has one, as a
`WmSheetButton` in the pinned footer. Nothing else moves; `PopScope` rules (no leaving while saving; Purchase's own
pop result) stay.

| Screen | Title | Footer button |
|---|---|---|
| Purchase (`PurchaseDetailScreen`) | Purchase | none (Correct, Record payment and Void stay where they are in the body) |
| Correct purchase | Correct purchase / its Tagalog | `correct-save`; the "send to the owner" dialog unchanged |
| My cash | My cash / Pera ko | none (`report-return` stays in the body) |
| Record payment | today's title | `pay-save` |
| Report a return | today's title | `return-save` |
| Buying is off | today's words | Log out stays as it is |

Amounts on these pages take the mono style; the mono group labels of My cash take the 6a form (`RETURNS · Mga
ibinalik`). The full-screen photo viewers are unchanged.

## 8. Small pieces

- **My cash card** on My purchases: a 6a card (white, border, radius 16, no shadow), same content and key, chevron.
- **Same-items dialog**: unchanged words and keys; buttons in the app's dialog style.

## 9. Tests and acceptance

1. No test is deleted; a test of an old layout is rewritten to assert the same fact. Baseline: 1399.
2. New tests: Record purchase opens as a sheet and ITEMS comes before SUPPLIER AND DATE; the bin asks and discards,
   ✕ keeps the draft; `record-send` is in the pinned footer and sends **exactly today's body** (compare with the body
   the existing tests assert, including "Paid now?" left at *Not paid yet* sending no payment); a problem shows by its
   field; the sheet with the keyboard up keeps the typed field and the button visible. Issue / move: − / + (not below
   zero, decimals kept, off when locked or fixed), the recorded body unchanged, a preset still locks its controls.
   Each page: back button, title, footer button in the footer, saving blocks leaving. No "₱" in Issue / move or Record
   leftovers. 320 × 568 at scale 1.3 raises no overflow on each screen.
3. `flutter analyze` → `No issues found!`; full `flutter test` passes with no "Warning: A call to tap()".
4. An independent review of the whole diff before the phone check, with the money rules as its first question.
5. **Phone check before publishing 1027** on the test buyer. Recording a purchase, a payment, a return or a stock
   move is real: **ZZ test data only**, voided or reversed afterwards, or the screens are looked at without sending.

## 10. After the review and the phone check (13 November 2026)

| Change | Why |
|---|---|
| The first problem is repeated over the pinned button in Record purchase (`record-first-problem`) and Correct purchase (`correct-first-problem`), in its own words | Review: with the button pinned, a Send that sends nothing could show no visible response. |
| My cash: a heading too long for one line puts the Tagalog on its own line, without the dot | Owner, after the phone check ("fix them"). |
| Record purchase: the item card and the fee / discount card are flat (a border, no shadow) | Same. |
| The quantity box in Issue / move and in the Received sheet takes the app's field fill (it was white, as the mockup draws its stepper) | Same: here the number is a field that can be typed in, and every other such field is filled. |
| Record purchase: a new item's "For (project, job or warehouse)" box is empty until a place is picked | Owner ("fix it"). It showed Warehouse by accident while the form still asked for the place, in every version since at least 1023. **The one change in 6b that is not layout.** What is saved and sent is unchanged. |
| `openMove` lives in `lib/stock/ui/stock_screen.dart`; it now uses `showWmSheet` | Needed for §6; the owner approved the edit ("apply it"). |
