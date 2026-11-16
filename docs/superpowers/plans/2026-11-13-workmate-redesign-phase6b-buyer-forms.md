# WorkMate Redesign Phase 6b (Record purchase and the buyer's other screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record purchase and Issue / move become the mockup's sheets, and every remaining buyer screen takes the
`WmPage` look — with every field, rule, notice and server call unchanged.

**Architecture:** Layout-only rewrites. `openRecord` and `openMove` keep their signatures and results but show a
`WmSheetFrame` through `showWmSheet` instead of pushing a page. The other screens swap `Scaffold` / `AppBar` for
`WmPage` with their main button in its pinned footer. Controllers, draft model, queue and submitters are not touched.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, Material 3, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-11-13-workmate-redesign-phase6b-buyer-forms-design.md` (Dacs Web repo). It is
the requirement for every task; this plan says how the work is split. Where they differ, the spec wins.

## Global Constraints

- Repository: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`, base `main` at `7a69308` (0.17.0+1026, published).
- **Never run `git commit`, `git push`, `git add`, `git stash`, `git checkout`, `git restore`, `git rm`, `git reset` or
  `git clean`.** **Never run `dart format`.**
- **No server change.** `RecordController`, `PurchaseDraft` and its autosave, the queue, the sync, `StockController`,
  `StockSubmitter`, the pay models and the repository stay as they are. Only layout code and tests change.
- **Money:** the body sent for a purchase, a payment, a return, a correction and a stock move is **exactly today's**.
  "Paid now?" still defaults to *Not paid yet* and a payment is recorded only from that choice or from Record payment.
  No peso in any stock screen. No amount added or removed anywhere.
- **Words:** every label, hint, notice and button text stays, in both languages where it has both. **No new Tagalog.**
  The only new words are Record purchase's section titles (spec §5) and the mono labels of Issue / move (spec §6).
- Every existing key stays on the element that plays the same part (spec §3). New keys: `move-minus`, `move-plus`.
- Follow the **layout** the spec describes, not only its colours.
- Shared widgets to use, not re-invent: `showWmSheet`, `WmSheetFrame`, `WmSheetButton`, `WmRoundButton`
  (`lib/ui/wm_sheet.dart`); `WmPage` (`lib/ui/wm_page.dart`); `WmPillButton`, `WmSegmented` (`lib/ui/wm_chips.dart`).
  Patterns to copy: the claim sheet in `lib/purchasing/list/shopping_list_screen.dart`, the Received sheet in
  `lib/stock/ui/receive_sheet.dart` (− / +, `sendBox` / `sendFooter`), the tool forms in
  `lib/tools/ui/tool_forms.dart` (`WmPage` with a pinned footer).
  A centred child must not use `Container(alignment: …)` inside a `Row`; use `Center(widthFactor: 1, …)`.
- **Never delete a test**; a test of an old layout is rewritten to assert the same fact. Tests must print no
  "Warning: A call to tap()" line (the test font is wide: `ensureVisible` + `pumpAndSettle` before a tap; a second
  Scrollable makes `scrollUntilVisible` ambiguous — pass `scrollable:`).
- Finish with `flutter test` passing and `flutter analyze` → `No issues found!`. Version `0.18.0+1027`.

---

### Task 1: Record purchase as a sheet

**Files:** `lib/ui/wm_sheet.dart` (the optional `action`), `lib/purchasing/record/record_screen.dart`,
`test/ui/wm_sheet_test.dart` (or the file that tests `WmSheetFrame`), the tests under `test/purchasing/record/`, and
`test/purchasing/ui/buyer_screens_test.dart` where it opens Record purchase.

**Produces:** `WmSheetFrame({…, Widget? action})` — `action` is laid out immediately to the left of the close button.

- [ ] **Step 1 (tests first):** add: (a) `WmSheetFrame` with an `action` shows it left of `wm-sheet-close`; (b) Record
  purchase opens as a sheet (`wm-sheet-close` present, no `AppBar`); (c) the text `ITEMS (1)` sits above
  `SUPPLIER AND DATE`, which sits above `RECEIPT`, which sits above `PAID NOW?` (compare `dy`); (d) `record-discard`
  asks "Throw this purchase away?" and, on Throw away, discards and closes with `false`; `wm-sheet-close` closes and
  the draft is still in `api.drafts()`; (e) `record-send` is inside the sheet's footer and, with a complete draft,
  queues **the same body an existing send test asserts** — reuse that test's fixture and expected body, and assert
  that with "Paid now?" untouched no payment is in it; (f) a line problem still shows inside that line's card;
  (g) with a 300-px keyboard inset the focused `receipt-total` and `record-send` are both above the keyboard;
  (h) 320 × 568 at scale 1.3 raises no exception. Run them; the new ones fail.
- [ ] **Step 2:** add `action` to `WmSheetFrame`.
- [ ] **Step 3:** rewrite `RecordScreen.build` per spec §5 as a `WmSheetFrame(tall: true, …)`: title / subtitle from
  `recordLabel`; `action:` the bin as a `WmRoundButton` with key `record-discard`; children in the spec's order with
  mono section labels (ITEMS (N), SUPPLIER AND DATE, DELIVERY FEES AND DISCOUNTS, RECEIPT, NOTES, PAID NOW?);
  `add-line`, `add-fee`, `add-discount` as white pills; the empty photo slot as the dashed box; `record-send` as a
  `WmSheetButton(busy: c.sending)` in `footer:`. `_LineCard`, `_ChargeCard`, `_ReceiptPhotos`, `_PaidNow`,
  `_SupplierField`, `_DateField` keep their fields, keys and callbacks; restyle their containers only. `record-form`
  stays the key the tests scroll: put it where the scrolling list is reachable, or keep the tests' scroll steps
  working with `scrollable:`. `openRecord` uses `showWmSheet<bool>` and returns `queued == true`.
- [ ] **Step 4:** `flutter analyze` on the changed files; `flutter test test/purchasing test/ui`.
- [ ] **Step 5:** report files, the final order of every field, every judgement call, and whether the new tests were
  seen failing first.

---

### Task 2: Issue / move as a sheet; Record leftovers as a page

**Files:** `lib/stock/ui/move_screen.dart`, `lib/stock/ui/leftover_screen.dart`, `lib/stock/ui/stock_widgets.dart`
(remove `sendArea` once nothing uses it), `test/stock/stock_screens_test.dart`,
`test/purchasing/ui/buyer_screens_test.dart` where it opens Issue from stock.

- [ ] **Step 1 (tests first):** add: (a) Issue / move opens as a sheet with today's title for each of its three uses
  (issue or move, issue from stock, return); (b) `move-plus` / `move-minus` step by 1, stop at 0, keep a typed
  decimal, and do nothing while locked; (c) a fixed preset still disables the same controls; (d) `move-send` is in
  the footer and records **exactly today's parameters** (reuse an existing test's expected body); (e) answer lost:
  no `move-send`, the unresolved box in the body; (f) Record leftovers has `wm-page-back`, `leftover-send` in the
  pinned footer, and records today's parameters; (g) no "₱" in either; (h) 320 × 568 at scale 1.3 raises no exception.
  Run them; the new ones fail.
- [ ] **Step 2:** `move_screen.dart` per spec §6 on `WmSheetFrame` (`openMove` → `showWmSheet<bool>`, same result);
  `leftover_screen.dart` on `WmPage`. Both use `sendBox()` / `sendFooter(...)`.
- [ ] **Step 3:** delete `StockSending.sendArea` (grep the whole repo first: no caller may remain).
- [ ] **Step 4:** `flutter analyze`; `flutter test test/stock test/purchasing`.
- [ ] **Step 5:** report as in Task 1.

---

### Task 3: My cash, its card, Record payment, Report a return

**Files:** `lib/purchasing/pay/my_cash_screen.dart` (the screen and `MyCashCard`),
`lib/purchasing/pay/record_payment_screen.dart`, `lib/purchasing/pay/report_return_screen.dart`,
`lib/purchasing/ui/pay_widgets.dart` only if a shared piece needs the new look, and the tests under
`test/purchasing/pay/` and `test/purchasing/mine/` that assert them.

- [ ] **Step 1 (tests first):** per screen: `wm-page-back` and the title; `pay-save` / `return-save` in the pinned
  footer and saving **exactly today's body**; saving blocks leaving (the `PopScope` rule); the over-spend warning and
  every problem still show by their field; My cash keeps `report-return`, the held / owes figures and every list row
  with its actions; `MyCashCard` keeps `my-cash-card`, its figures and opens My cash; 320 × 568 at scale 1.3 raises no
  exception. Run them; the new ones fail.
- [ ] **Step 2:** the three screens on `WmPage` per spec §7; `MyCashCard` as a 6a card with a chevron (spec §8).
  Amounts in the mono style; My cash's group labels in the 6a form using the words they have today.
- [ ] **Step 3:** `flutter analyze`; `flutter test test/purchasing`.
- [ ] **Step 4:** report as in Task 1, listing every place an amount shows and confirming each showed before.

---

### Task 4: Purchase, Correct purchase, Buying is off, the dialog, version

**Files:** `lib/purchasing/mine/purchase_detail_screen.dart`, `lib/purchasing/mine/correct_screen.dart`,
`lib/purchasing/ui/buying_off_screen.dart`, `lib/purchasing/ui/buyer_shell.dart` (only `_SameItemsDialog`'s buttons),
`pubspec.yaml`, and the tests that assert them.

- [ ] **Step 1 (tests first):** Purchase: `wm-page-back`, the title, `correct`, `detail-pay`, the payments list,
  `void-…` with its reason dialog, the receipt thumbnails opening the viewer, and the pop result on Back unchanged;
  Correct purchase: `correct-save` in the pinned footer, the "send to the owner" dialog, every `cproblem-…` by its
  field, the saved body unchanged; Buying is off: its words and `buying-off-unsent`; the same-items dialog keeps its
  two keys and results; 320 × 568 at scale 1.3 raises no exception. Run them; the new ones fail.
- [ ] **Step 2:** the three screens on `WmPage` per spec §7 (Buying is off keeps its own structure if it is not a
  pushed page — give it the page look without a back button); the dialog's buttons in the app's style.
- [ ] **Step 3:** `pubspec.yaml` `0.17.0+1026` → `0.18.0+1027`.
- [ ] **Step 4:** grep `lib/purchasing lib/stock` for `AppBar(`: only the full-screen photo viewers may remain.
- [ ] **Step 5:** `flutter analyze` (whole project) → `No issues found!`; full `flutter test`; report the count (1399
  before Phase 6b; none deleted) and `grep -c "Warning: A call to tap()"` (expected 0).
