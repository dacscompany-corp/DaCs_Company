# WorkMate Redesign Phase 6a (the buyer's three tabs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shopping list, My purchases, Stock, the claim sheet and the Received sheet take the mockup's layout — with
every field, rule, notice and server call unchanged.

**Architecture:** Layout-only rewrites of three tab screens that already sit inside the redesigned `WmNavBar` shell.
The two bottom sheets move onto `WmSheetFrame` with their button in its pinned footer. Shared pieces are reused
(`WmChoiceChip`, `WmSegmented`, `WmSheetFrame`, `WmSheetButton`); nothing new is shared except one small private
helper per screen.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, Material 3, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-11-13-workmate-redesign-phase6a-buyer-tabs-design.md` (Dacs Web repo). It is
the requirement for every task; this plan says how the work is split. Where they differ, the spec wins.

## Global Constraints

- Repository: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`, base `main` at `83c7c10` (0.16.0+1025, published).
- **Never run `git commit`, `git push`, `git add`, `git stash`, `git checkout`, `git restore`, `git rm`, `git reset` or
  `git clean`.** **Never run `dart format`.**
- **No server change.** Controllers, the repository, the queue, the sync, `StockSubmitter` and `BuyerShell`'s logic
  stay as they are. Only layout code and tests change.
- **Money:** no peso amount on the shopping list or in Stock, ever. Amounts stay where they are in My purchases.
  Nothing new shows an amount.
- Every existing word, notice and key stays on the element that plays the same part (spec §3 lists the keys). New keys:
  `stock-part-stock`, `stock-part-receive`, `stock-part-recent`, `receive-minus`, `receive-plus`.
- Follow the **layout** the spec describes (spec §4–§8), not only its colours.
- Shared widgets to use, not re-invent: `WmChoiceChip`, `WmSegmented`, `WmPillButton`, `WmCountChip`
  (`lib/ui/wm_chips.dart`); `showWmSheet`, `WmSheetFrame`, `WmSheetButton`, `WmSheetNote` (`lib/ui/wm_sheet.dart`).
  A centred child must not use `Container(alignment: …)` inside a `Row`; use `Center(widthFactor: 1, …)`.
- **Never delete a test**; a test of an old layout is rewritten to assert the same fact. Tests must print no
  "Warning: A call to tap()" line (the test font is wide: `ensureVisible` + `pumpAndSettle` before a tap).
- Do not touch: Record purchase, Issue / move, Record leftovers, Purchase, Correct purchase, My cash and its card,
  Record payment, Report a return, Buying is off, the same-items dialog (they are Phase 6b).
- Finish with `flutter test` passing and `flutter analyze` → `No issues found!`. Version `0.17.0+1026`.

---

### Task 1: Shopping list, its floating buttons, the claim sheet

**Files:** `lib/purchasing/list/shopping_list_screen.dart`, `lib/purchasing/ui/buyer_shell.dart` (only the
`floatingActionButton`'s look), `test/purchasing/list/shopping_list_screen_test.dart`,
`test/purchasing/ui/buyer_screens_test.dart`.

- [ ] **Step 1 (tests first):** add to `shopping_list_screen_test.dart`: (a) the tick box `pick-<id>` picks and unpicks
  and is a checkbox with the right checked state in the semantics tree; (b) a ticked card has a green border and the
  floating bar `record-selected` shows "Record purchase (1)" and, tapped, hands over the picked lines and clears the
  ticks; (c) the project pill `project-filter` offers every project plus "All projects" and choosing one filters;
  (d) `find.textContaining('₱')` finds nothing with a list holding every kind of line; (e) Still to buy comes before
  Needed on a card (compare their left edges); (f) at 320 × 568 with text scale 1.3 the screen raises no exception.
  Run them; the new ones fail.
- [ ] **Step 2:** rewrite the screen's layout per spec §4–§5: title 26 / 800; the filters in one horizontally
  scrolling row (`WmChoiceChip` for the two scopes; the project pill opening a menu of the same choices, same key);
  sections; the item card (tick box as a `Semantics(checked:)` + `InkWell` in a 44-px area; numbers row with Still to
  buy first; pills; warehouse line; notes; the 44-px two-language buttons). Keep `_ClaimSheet`'s logic and move it onto
  `WmSheetFrame` with `claim-confirm` as a `WmSheetButton` in the footer, opened with `showWmSheet`.
- [ ] **Step 3:** the floating bar for ticked lines replaces the foot button (position it inside the screen with a
  `Stack`, 16 px from each side, above the list's bottom padding); in `buyer_shell.dart` restyle the extended floating
  button (56 px, radius 18, plus icon, shadow) — keys and conditions unchanged.
- [ ] **Step 4:** `flutter analyze` on the changed files; `flutter test test/purchasing`.
- [ ] **Step 5:** report files, every judgement call, and whether the new tests were seen failing first.

---

### Task 2: My purchases

**Files:** `lib/purchasing/mine/my_purchases_screen.dart`, `test/purchasing/mine/my_purchases_test.dart`, and
`test/purchasing/ui/buyer_screens_test.dart` where it asserts this screen.

- [ ] **Step 1 (tests first):** add: (a) a recorded row shows the supplier, the date line, the receipt total, its
  flags, the pay line with `pay-<id>`, and a chevron, and a tap on the card (not on Record payment) calls
  `onOpenPurchase`; (b) a tap on `pay-<id>` does not open the purchase; (c) a needs-attention purchase keeps `fix-<id>`
  and `throw-<id>` and both languages of its reason; (d) a draft row keeps `delete-draft-<id>` and opens the draft;
  (e) the three group labels appear only when their group has rows (Recorded always); (f) 320 × 568 at scale 1.3
  raises no exception. Run them; the new ones fail.
- [ ] **Step 2:** rewrite the layout per spec §6 with one private row-card widget used by all three groups (title,
  muted line, right-hand value, optional pill, chevron, optional child block for flags / pay line / reason and
  actions). `MyCashCard` is used as it is. Amounts in the mono style.
- [ ] **Step 3:** `flutter analyze`; `flutter test test/purchasing`.
- [ ] **Step 4:** report as in Task 1.

---

### Task 3: Stock, the Received sheet, version

**Files:** `lib/stock/ui/stock_screen.dart`, `lib/stock/ui/receive_sheet.dart`, `lib/stock/ui/stock_widgets.dart`
(only to add the footer / box pair beside `sendArea`), `pubspec.yaml`, `test/stock/stock_screens_test.dart`,
`test/purchasing/ui/buyer_screens_test.dart` where it asserts Stock.

- [ ] **Step 1 (tests first):** add: (a) the switch is a `WmSegmented` with "To receive (N)" showing the count, and
  each segment key changes the part; (b) an item card shows its total on the right and one row per place; (c)
  `find.textContaining('₱')` finds nothing on any of the three parts; (d) in the Received sheet `receive-plus` adds 1,
  `receive-minus` takes 1 and stops at 0, a typed "2.5" stays "3.5" after plus; (e) `receive-send` sits in the sheet's
  footer and records with exactly today's parameters; (f) answer lost: no `receive-send`, the unresolved box in the
  body; (g) 320 × 568 at scale 1.3 raises no exception on each part. Run them; the new ones fail.
- [ ] **Step 2:** `stock_screen.dart` per spec §7: `SegmentedButton` → `WmSegmented` (keep `stock-parts`); the two
  54-px buttons; the three card layouts; everything else in place. The Received sheet opens with `showWmSheet`.
- [ ] **Step 3:** `receive_sheet.dart` per spec §8 on `WmSheetFrame`; in `stock_widgets.dart` add `sendBox()` and
  `sendFooter(...)` to `StockSending` **beside** `sendArea` (which Issue / move and Record leftovers still use — do
  not change or remove it), modelled on `ToolSending` in `lib/tools/ui/tool_widgets.dart`.
- [ ] **Step 4:** `pubspec.yaml` `0.16.0+1025` → `0.17.0+1026`.
- [ ] **Step 5:** `flutter analyze` (whole project) → `No issues found!`; full `flutter test`; report the count (1372
  before Phase 6a; none deleted) and `grep -c "Warning: A call to tap()"` (expected 0).
