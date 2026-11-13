# WorkMate redesign — Phase 6a: the buyer's three tabs (design)

**Status:** design approved by the owner 13 November 2026 ("A, A, A"); this spec awaits review.
**App:** DAC's WorkMate (`C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`), base `main` at `83c7c10`
(0.16.0+1025, published 13 Nov). **Target:** `0.17.0+1026`. **No server change.**
**Source:** the Claude Design handoff (variant 1a "Inbox"): Shopping list, My purchases, Stock, the Received sheet.

## 1. Purpose

The buyer's app is the last part still in the old look. Phase 6 brings it to the mockup in two releases. **6a (this
spec)** is what a buyer sees first: the three tabs and the two small sheets that open from them. **6b** (its own spec)
is Record purchase and the screens behind the tabs.

## 2. Owner decisions (13 November 2026)

| Topic | Decision |
|---|---|
| Releases | **Two.** 6a = Shopping list, My purchases, Stock, the claim sheet, the Received sheet. 6b = Record purchase, Issue / move, Record leftovers, and the screens with no mockup. Each is reviewed, phone-checked and published on its own. |
| Record purchase | **The mockup's sheet** (6b). Not built in 6a: the buttons that open it keep opening today's screen. |
| Screens with no mockup | **The `WmPage` look** (6b): Purchase, Correct purchase, My cash, Record payment, Report a return, Record leftovers, Buying is off. |
| Fields | As in every phase: **every real field stays**, including those the mockup leaves out. |

## 3. What does not change

- Every server call; `ShoppingController`, `MyPurchasesController`, `StockController`, `StockSubmitter`, the repository,
  the queue and the sync. `BuyerShell`'s logic (tabs, refresh on resume, drafts, the same-items dialog, issue from
  stock, the Stock tab following the server's switch and an unresolved record).
- **The bottom bar**: it is already the redesigned `WmNavBar` (Phase 1), with the My purchases badge. No change.
- **Who sees money** (owner rule, 14 Oct 2026): the shopping list shows **quantities and names only, never a price**;
  amounts appear in My purchases for the buyer's own purchases and payments, as today. Stock shows **no peso at all**
  (0104); a cost move shows only its state. Nothing new shows an amount.
- "Bought" stays what the server says (covered), Still to buy is never negative, and "In warehouse" stays a hint.
- Every word, notice and rule: saved-copy banners, "Claiming needs signal", refusals with Dismiss, "Nothing left to buy
  here.", urgent / needed by / quantity changed / arranged / Buying: …, Release, Arranged / Not arranged, Issue from
  stock; Not sent yet / Drafts / Recorded, needs-attention cards with Fix and send again / Throw away, the pay line and
  Record payment, the flags; stock's signal notice, unresolved and unreadable boxes, recovery, finish-first, stock off,
  "Not matched yet", Return, "A mistake? The office reverses it …"; "Recorded. · Naitala na." and the queued notice
  (both stay SnackBars: they show on a tab, not over a sheet).
- Pull down to refresh stays on all three tabs (they are pages).
- Existing keys stay on the element that plays the same part: `scope-week`, `scope-all`, `project-filter`,
  `shopping-saved-copy`, `entry-<id>`, `pick-<id>`, `urgent-<id>`, `changed-<id>`, `from-stock-<id>`,
  `in-warehouse-<id>`, `issue-stock-<id>`, `claim-<id>`, `release-<id>`, `arranged-<id>`, `record-selected`,
  `record-unplanned`, `claim-qty`, `claim-confirm`; `mine-saved-copy`, `draft-<id>`, `delete-draft-<id>`,
  `purchase-<id>`, `pay-line-<id>`, `pay-<id>`, `queued-<id>`, `queued-pay-<id>`, `fix-<id>`, `throw-<id>`,
  `throw-pay-<id>`, `mine-badge`; `tab-stock`, `stock-parts`, `stock-signal`, `stock-recovery`, `stock-finish-first`,
  `stock-issue`, `stock-leftovers`, `stock-item-<id>`, `awaiting-<key>`, `receive-<key>`, `record-<id>`,
  `return-<id>`, `receive-qty`, `receive-note`, `receive-send`, `stock-recorded`, `stock-refused`.

## 4. Shared look (all three tabs)

- Title 26 px / 800 with the Tagalog line under it (13 px, muted); body sides 20 px (today 16, title 23).
- Section labels in the mono style with the Tagalog after a dot: `MINE · Akin`.
- Cards: white, 1-px border, radius 16, padding 14, 8–10 px apart.
- Numbers (quantities, amounts) in IBM Plex Mono; the one that matters bold.
- Pills: 12.5 px / 800, padding 5 × 10, radius 999.
- A centred child never uses `Container(alignment:)` inside a `Row` (the 1022 chip bug).

## 5. Shopping list

1. **Filters** in one row that scrolls sideways: `This week · cutoff …` and `All weeks` as `WmChoiceChip` (height 38),
   then the project filter as a white pill "All projects ▾" (or the chosen project's name). Tapping the pill offers the
   same choices as today's dropdown. Keys as today.
2. **Sections** MINE, UNASSIGNED, OTHER BUYERS (today's `mineLabel` / `unassignedLabel` / `othersLabel` words).
3. **Item card** (replaces `_EntryCard`'s layout; its content and rules are unchanged):
   - Left, on a line I may pick: the mockup's **tick box** (26 px, radius 8, 2-px border; ticked = green with a white
     check), inside a 44-px tap area. It is the `pick-<id>` element and is announced as a checkbox. A ticked card has a
     green border.
   - Name 16 / 800 (description · spec); under it `place · for requester` (13, muted).
   - **Numbers row**, label over value: **Still to buy** first and bold, then Needed, Bought, and From stock when above
     zero. Each label keeps its two languages.
   - Pills on their own wrap: Urgent (· needed by), Needed by, Quantity changed, Arranged, Buying: ….
   - "In warehouse: …" in green; the notes.
   - Buttons, 44 px high, two languages: **I'll buy this** (outlined green) on an unassigned line; **Release** and
     **Arranged / Not arranged** side by side on mine; **Issue from stock** when offered. While a line is busy, the
     progress bar as today.
4. **Record purchase (N)**: when lines are ticked, the mockup's floating bar (full width less 16 px each side, 58 px,
   radius 16, green, shadow, two languages), in place of the full-width button at the foot. Same key, same action.
5. **Record purchase** (nothing ticked): the mockup's floating button (56 px, radius 18, plus icon, shadow), on
   Shopping list and My purchases as today.
6. **The claim sheet** becomes a `WmSheetFrame`: title "I'll buy this" / Tagalog, the "Still to buy … Take all of it, or
   part." line, the quantity field, and **Claim** as a `WmSheetButton` in the footer. Same check and message.

## 6. My purchases

1. Title and "Mga binili ko · last 60 days"; the notice, the saved-copy line and the **My cash card** stay where they
   are (the card's own look is 6b).
2. Groups **NOT SENT YET · Hindi pa naipapadala**, **DRAFTS · Mga draft**, **RECORDED · Naitala na**.
3. **Row card** (mockup): title 16 / 800, a muted line under it, the status on the right, and a chevron.
   - Recorded: supplier (or "No supplier"); `date · projects`; **the receipt total in mono bold on the right**; the
     flags as pills on their own wrap; the pay line (state pill, what is left / waiting, **Record payment**) under
     them. Tapping the card opens the purchase.
   - Draft: supplier or "Purchase on …"; `N items · not sent`; the delete button stays at the right.
   - Not sent yet (purchase or payment): the amount on the right; the waiting / sent / needs-attention words as a pill;
     a needs-attention card keeps its red tint, both languages of the reason, and its actions.
4. Nothing else moves: order, counts, what each tap does.

## 7. Stock

1. Title, Tagalog line, then the three-way **`WmSegmented`** switch: `Stock`, `To receive (N)`, `Recent`
   (`stock-parts` on the switch; new segment keys `stock-part-stock`, `stock-part-receive`, `stock-part-recent`).
2. Notices, unresolved / unreadable boxes, recovery, finish-first and stock-off lines as today, under the switch.
3. On **Stock**, when this account may record: **Issue / move** (filled green) and **Record leftovers** (white,
   bordered), side by side, 54 px, radius 14, two languages.
4. **Item card**: name 16 / 800 with the **total in mono bold on the right** (the words "in all" go; the unit stays);
   then one row per place: icon, name, quantity in mono bold.
5. **To receive card**: item; "Bought … by … · quantity" (muted); "Received … · still awaited …" (bold); "Not matched
   yet"; **Received…** full width, 50 px, outlined, two languages.
6. **Recent card**: kind (bold) with the date on the right; the line; For: …; Unplanned: …; By …; the state; the cost
   states; **Return** when allowed.
7. The two-language "A mistake? …" note at the foot.

## 8. The Received sheet

`ReceiveSheet` becomes a `WmSheetFrame` (title "Received…" / Tagalog): the item and its "received / still awaited"
line; **"How many arrived?"** with the mockup's **− and + buttons** (52 px, radius 14) on either side of the quantity;
the note; **Send** as a `WmSheetButton` in the footer with the failure / blocked notice above it.

- The quantity stays a field that can be typed in (decimals are real: 2.5 bags). − and + change it by 1 and never go
  below zero; the checks on Send are exactly today's.
- Locked (answer lost): no Send; the unresolved box shows in the body, as in the tool forms since Phase 5.
- `StockSending.sendArea` is still used by Issue / move and Record leftovers (6b): it stays; the sheet uses a
  footer / box pair added beside it.

## 9. Not in 6a

Record purchase, Issue / move, Record leftovers, Purchase, Correct purchase, My cash and its card, Record payment,
Report a return, Buying is off, the same-items dialog. They keep working exactly as today, in the old look, until 6b.

## 10. Tests and acceptance

1. No test is deleted; a test of an old layout is rewritten to assert the same fact. Baseline: 1372.
2. New tests: the tick box picks and unpicks and is a checkbox to a screen reader; a ticked card and the floating bar
   with its count; the filter pill offers every project and filters; no "₱" anywhere on the shopping list or Stock;
   the My purchases row shows total, flags, pay line and chevron, and a needs-attention row keeps both actions; the
   Stock switch shows the count and changes part; − / + in the Received sheet (not below zero, decimals kept) and Send
   in its footer; the three tabs at 320 × 568 with large text raise no overflow.
3. `flutter analyze` → `No issues found!`; full `flutter test` passes with no "Warning: A call to tap()".
4. An independent review of the whole diff before the phone check.
5. **Phone check before publishing 1026**, on an account with the **Buyer switch**. Looking is safe; a claim, a
   purchase, a payment or a stock record is real — only on ZZ test data, cancelled or voided afterwards.
