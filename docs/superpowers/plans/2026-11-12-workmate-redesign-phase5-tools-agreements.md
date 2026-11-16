# WorkMate Redesign Phase 5 (Tools, Agreements, My proposals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tools, My agreements and My proposals become the mockup's swipe-down sheets with cards that open in place;
the five tool forms and Propose a task get the new page look — with every field, rule, notice and server call unchanged.

**Architecture:** A shared `WmSegmented` switch (extracted from History). `ToolsScreen` → `ToolsSheet` (a tall
`WmSheetFrame`) whose tool cards expand in place and absorb `ToolDetailScreen` (actions + history). `AgreementsScreen`
→ `AgreementsSheet` whose cards expand in place and absorb `AgreementDetailScreen`. `ProposalsScreen` → `ProposalsSheet`.
The forms swap `Scaffold`/`AppBar` for `WmPage` with the send button in its pinned footer.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, Material 3, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-11-12-workmate-redesign-phase5-tools-agreements-design.md` (Dacs Web repo). It is
the requirement for every task; this plan says how the work is split. Where they differ, the spec wins.

## Global Constraints

- Repository: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`, base `main` at `3e769e6` (0.15.1+1024, published).
- **Never run `git commit`, `git push`, `git add`, `git stash`, `git checkout`, `git restore`, `git rm`, `git reset` or
  `git clean`.** **Never run `dart format`.** Delete a file with a normal file delete.
- **No server change.** Controllers, the tool submitter, every API call and every validation stay as they are.
- **The real tool rules stay** (0107 / 0111): on one's own tool only Report a problem; a leader's team tool gets
  Hand over (only when the condition is good; otherwise the "needs repair" note) and Return. Never add an action the old
  `ToolDetailScreen` did not offer for that case.
- Agreements stay online only; no amount is stored or shown anywhere new (0113).
- Every existing word, notice and key stays on the element that plays the same part (spec §3 lists the keys). New keys:
  `tools-sheet`, `tools-part-mine`, `tools-part-team`, `tools-part-records`, `agreements-sheet`, `proposals-sheet`.
- Shared widgets to use, not re-invent: `showWmSheet`, `WmSheetFrame`, `WmSheetButton`, `WmSheetNote`, `WmRoundButton`
  (`lib/ui/wm_sheet.dart`); `WmPage` (`lib/ui/wm_page.dart`); `WmPillButton`, `WmChoiceChip`, `WmCountChip`
  (`lib/ui/wm_chips.dart`). A centred child must not use `Container(alignment: …)` inside a `Row` (it stretches — the
  1022 chip bug); use `Center(widthFactor: 1, …)`.
- A sheet has no pull-down refresh: each sheet asks its controller to refresh once when it opens.
- **Never delete a test**; a test of an old page is rewritten to assert the same fact in the sheet. Tests must print no
  "Warning: A call to tap()" line.
- Finish with `flutter test` passing and `flutter analyze` → `No issues found!`. Version `0.16.0+1025`.

---

### Task 1: `WmSegmented`, and the six forms as pages

**Files:** `lib/ui/wm_chips.dart` (+ `test/ui/wm_chips_test.dart`), `lib/attendance/history/history_screen.dart`,
`lib/tools/ui/tool_forms.dart`, `lib/workplan/ui/proposals_screen.dart` (only `ProposeFormScreen`), and the tests that
cover those forms (`test/tools/tools_screens_test.dart`, `test/workplan/ui/my_work_screens_test.dart`).

**Produces:** `WmSegmented<T>({Key? key, required List<(T value, String label, Key? segmentKey)> segments, required T
selected, required ValueChanged<T> onChanged})` — or an equivalent signature with one entry per segment carrying its
value, label and key; say the final signature in the report.

- [ ] **Step 1 (tests first):** in `test/ui/wm_chips_test.dart` add a test for `WmSegmented`: three segments are equal
  width; the selected one's `Material` is white and its Semantics says selected; a tap calls `onChanged` with that value.
  In the form tests, add one assertion per form family that the send button sits in the pinned footer (its bottom edge
  within ~140 px of the screen bottom) and that the page has `wm-page-back`.
- [ ] **Step 2:** add `WmSegmented` to `wm_chips.dart` with exactly the look of History's `_SpanSwitch` (track `inert`,
  radius 999, padding 4, gap 4; halves `Expanded`, height 38, 14 px; chosen = white, w800, `text`; other = transparent,
  w600, `textMuted`; each segment `Semantics(button, selected)` carrying its key). Replace `_SpanSwitch` in
  `history_screen.dart` with it (keys `span-week`, `span-month`); History's tests must pass unchanged.
- [ ] **Step 3:** in `tool_forms.dart`, each of `ReportProblemScreen`, `IssueToolScreen`, `HandoverToolScreen`,
  `ReturnToolScreen`, `UndoRecordScreen`: `Scaffold(appBar: AppBar(title: T), body: … ListView(children: C))` becomes
  `WmPage(title: T, footer: F, children: C')`, where `F` holds the form's send button as a `WmSheetButton` (same key,
  same label words, same enabled / sending rule — pass `busy:` where the old button showed progress) plus whatever note
  or failure text sat directly with the button, and `C'` is `C` without those. Nothing else in the forms changes
  (fields, order, validation, keys, the `ToolSending` mixin). If a form's button is a two-language `bilingualButton`,
  keep both languages: `WmSheetButton(label: english, tagalog: tagalog, …)`.
- [ ] **Step 4:** the same change for `ProposeFormScreen` (title "Propose a task", send button `propose-send` in the
  footer, label "Send to the office").
- [ ] **Step 5:** `flutter analyze` on the changed files; `flutter test test/ui test/tools test/workplan test/attendance`.
- [ ] **Step 6:** report the files, the `WmSegmented` signature, and any place where a form's layout forced a choice.

---

### Task 2: The Tools sheet

**Files:** `lib/tools/ui/tools_screen.dart` (the class becomes `ToolsSheet`; keep the file name), delete
`lib/tools/ui/tool_detail_screen.dart`, `lib/ui/home_shell.dart` (the opener), `test/tools/tools_screens_test.dart`,
and any test that expects `ToolsScreen` / `ToolDetailScreen` (`test/ui/*`, `test/profile/*`).

**Consumes:** `WmSegmented` (Task 1). **Produces:** `ToolsSheet({Key? key, required ToolsController controller,
required ToolSubmitter submitter})` and `Future<void> showToolsSheet(BuildContext context, ToolsController controller,
ToolSubmitter submitter)` (it calls `controller.refresh()` without awaiting, then `showWmSheet`).

- [ ] **Step 1 (tests first):** rewrite the Tools screen tests to open the sheet (through `showToolsSheet` from a button,
  as the task-sheet tests do) and keep every asserted fact; where a test opened the tool page and then tapped an action,
  it now taps the tool card (it opens in place) and then the same action key. Add: (a) a worker's own tool opened shows
  `tool-report` only; (b) a leader's team tool in good condition shows `tool-handover` and `tool-return`, one needing
  repair shows the "needs repair" note and `tool-return`; (c) history rows appear after the card opens, and the failure
  text (`tool-history-failure`) when the read fails; (d) opening a second card closes the first; (e) the leader's switch
  shows the counts and changes the part; (f) the sheet closes with Back.
- [ ] **Step 2:** build `ToolsSheet` per spec §5: `WmSheetFrame(key: tools-sheet, title, subtitle, tall: true, children)`.
  Keep the `_after` / `_recorded` / `_refused` / `_push` logic, the notices block and its order, `_team`, `_records`.
  A new private `_ToolCard` (stateful or driven by the sheet's `_openId`) replaces `_toolBox` + `ToolDetailScreen`:
  closed content = today's `_toolBox` content with an expand arrow instead of the chevron; opened content = exactly the
  old page's action block and its History block (move `_RecordRow`, the `myTool` / `teamTool` read and its failure
  handling from `tool_detail_screen.dart`; the read starts when the card opens and is repeated after a form succeeds).
  The old page popped `true` after a successful form so the list refreshed: keep that effect (success → "Recorded." +
  refresh). The SnackBars must show above the sheet (use the `ScaffoldMessenger` as today and check they are visible in
  a test; if a sheet hides them, show the same words as a `WmSheetNote`-style line at the top of the sheet and say so).
- [ ] **Step 3:** `home_shell.dart`: the Tools opener calls `showToolsSheet`; delete `tool_detail_screen.dart`; fix the
  other tests that referenced the old classes.
- [ ] **Step 4:** `flutter analyze`; `flutter test test/tools test/ui test/home test/profile`; then the full suite once.
- [ ] **Step 5:** report files (one deleted), counts, and every judgement call.

---

### Task 3: The Agreements sheet, the My proposals sheet, version

**Files:** `lib/agreements/ui/agreements_screen.dart` (class becomes `AgreementsSheet`; `AgreementDetailScreen` goes
away), `lib/workplan/ui/proposals_screen.dart` (`ProposalsScreen` → `ProposalsSheet`), `lib/ui/home_shell.dart`,
`lib/workplan/ui/my_work_screen.dart` (openers), `pubspec.yaml`, `test/agreements/agreements_screens_test.dart`,
`test/workplan/ui/my_work_screens_test.dart`, `test/ui/*` as needed.

**Produces:** `AgreementsSheet({Key? key, required AgreementsController controller})`, `showAgreementsSheet(context,
controller)`; `ProposalsSheet({Key? key, required MyWorkController controller})`, `showProposalsSheet(context,
controller)`. Each opener refreshes its controller (not awaited) and then shows the sheet.

- [ ] **Step 1 (tests first):** rewrite the agreements tests to open the sheet and keep every fact; where a test opened
  the agreement page, it now taps the card and finds the same works / payments texts in place. Add: opening a second
  agreement closes the first; an agreement that disappears while open collapses without an error; no amount appears
  when the read fails (as today). Rewrite the proposals tests to open the sheet (`open-proposals` on My Work, the Home
  shortcut) and keep their facts.
- [ ] **Step 2:** `AgreementsSheet` per spec §7: `WmSheetFrame(key: agreements-sheet, title: myAgreementsTitle.english,
  subtitle: myAgreementsTitle.tagalog, tall: true)`. The card = today's `_AgreementTile` content (header, daily pill,
  progress, money) with an expand arrow; opened = the old detail page's Works covered + Payments blocks (reuse `_Label`,
  `_PaymentRow`). Notices, "Updated …" and the footnote as today.
- [ ] **Step 3:** `ProposalsSheet` per spec §8 (`WmSheetFrame(key: proposals-sheet, title: 'My proposals', tall: true)`),
  the `propose` button full width in green with a plus icon (a `WmSheetButton`), pushing `ProposeFormScreen` as today.
- [ ] **Step 4:** the openers in `home_shell.dart` and `my_work_screen.dart`; `pubspec.yaml` `0.15.1+1024` →
  `0.16.0+1025`.
- [ ] **Step 5:** `flutter analyze` (whole project) → `No issues found!`; full `flutter test`; report the count (1349
  before Phase 5; none deleted) and `grep -c "Warning: A call to tap()"` (expected 0).
