# WorkMate redesign — Phase 5: Tools, Agreements and My proposals as sheets (design)

**Status:** design approved by the owner 12 November 2026 ("approved"); this spec awaits review.
**App:** DAC's WorkMate (`C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`), base `main` at `2b291d9`
(0.15.1+1024, published 13 Nov). **Target:** `0.16.0+1025`. **No server change.**
**Source:** the Claude Design handoff (variant 1a "Inbox"): the Tools, Agreements and Proposals sheets.

## 1. Purpose

Tools, My agreements and My proposals are still old-style pages. Phase 5 turns each into the mockup's swipe-down sheet,
with cards that open in place instead of a second page, and gives the forms behind them the new page look.

## 2. Owner decisions (12 November 2026)

| Topic | Decision |
|---|---|
| Tool forms | **Restyled as pages** (the `WmPage` look of Add item): Report a problem, Issue a tool, Hand over, Return, Undo. |
| My proposals | **Included**, as a sheet; the Propose a task form becomes a `WmPage`. |
| Rules | The real tool rules stay (0107 / 0111): a worker only reports a problem on their own tool; a team leader hands over and returns for the teams they lead now. The mockup's Return / Hand over on a worker's own tool is **not** built. |

## 3. What does not change

- Every server call, the tool submitter (unresolved / unreadable / recovery handling), `ToolsController`,
  `AgreementsController`, `MyWorkController` and their rules.
- Every field, check and word of the five tool forms and of Propose a task.
- Every notice and its words: tools need signal / Try again, "Saved copy from …", unresolved and unreadable record
  boxes, recovery, "finish this first", tools switched off, not leading a team, "Recorded. · Naitala na.", refusals;
  agreements' checking / failure notices, "Updated …" and the two-language footnote; "A mistake you can't undo here? …".
- Agreements stay **online only**: nothing about money is saved on the phone; amounts show only in My agreements (0113).
- No photos in Tools on the phone (0111).
- Existing keys (`tools-parts`, `tool-<id>`, `tools-issue`, `record-<id>`, `undo-<id>`, `tool-report`, `tool-handover`,
  `tool-return`, `tools-signal`, `tools-saved-copy`, `tools-recovery`, `tools-finish-first`, `tools-not-leading`,
  `tool-finish-first`, `tool-history-failure`, `agreement-<id>`, `agreement-progress`, `agreements-checking`,
  `agreements-notice`, `propose`, `propose-…`) stay on the element that plays the same part.

## 4. Shared piece

`WmSegmented` (in `lib/ui/wm_chips.dart`): the grey-track switch of History (track `inert`, radius 999, padding 4,
gap 4; equal halves, height 38, 14 px; the chosen one white with 800 text). History's Week / Month uses it (no visible
change; keys `span-week`, `span-month` stay).

## 5. Tools sheet

Opened by Home's My tools shortcut and Profile's My tools row: a **tall `WmSheet`**, key `tools-sheet`, titled
"My tools" for a worker and "Tools" for a team leader (subtitle: the Tagalog line of the title when it has one).
It refreshes when it opens (the sheet has no pull-down).

Body, in order:
1. **Leader only:** `WmSegmented` **Mine (n) · Team (n) · My records** (key `tools-parts`; segments `tools-part-mine`,
   `tools-part-team`, `tools-part-records`).
2. The notices exactly as today, in today's order.
3. **Mine:** one card per tool (key `tool-<id>`), white, radius 16. **Closed:** "TOOL-0007 · Grinder" (16/800) with an
   expand arrow; details (13, muted); place and how long held; the condition when not good; lost-pending; "You
   reported: …". **Tapped, it opens in place** (one card open at a time) and adds:
   - "finish this first" when records are waiting;
   - **the actions allowed** as two-language buttons: on one's own tool, **Report a problem** (`tool-report`);
   - **History** (label + rows, as the old tool page): loaded when the card opens; a progress line while loading; the
     two-language failure text when it cannot be read (`tool-history-failure`).
   Empty: "No tools with you."
4. **Team (leader):** **Issue a tool** (`tools-issue`, filled, two-language) when leading; "Saved copy from …"; the
   not-leading text; then each person's name (700) followed by their tool cards. An opened team card shows **Hand over**
   (`tool-handover`, filled; or the "needs repair" note) and **Return** (`tool-return`), then History. Empty: "No tools
   out with your team."
5. **My records (leader):** one card per record (`record-<id>`): kind and time, tool, person · project, "Undone", and
   **Undo** (`undo-<id>`) when it may be undone. Empty: "Nothing recorded yet."
6. The office-fixes footnote (two languages).

Actions push their form as a page over the sheet; when a form reports success the sheet shows "Recorded. · Naitala na."
and reads the tools again, as today.

## 6. The tool forms

Report a problem, Issue a tool, Hand over, Return and Undo each become a `WmPage` (round back button, title 24/800,
scrolling body) with their send button as a `WmSheetButton` **pinned in the footer**, any note or failure text above
or under it as today. Fields, their order, validation, the sending state and the keys are unchanged.

## 7. Agreements sheet

Opened by Home's shortcut and Profile's row: a **tall `WmSheet`**, key `agreements-sheet`, titled "My agreements" with
its Tagalog subtitle. It reads again when it opens.

Body: the checking / failure notices as today; one card per agreement (key `agreement-<id>`), **opening in place**
(one at a time) instead of a second page. **Closed:** project (16/800), scope, trade / "Additional Works of …", an
expand arrow; "Daily basis" pill when it applies; the progress line and bar (`agreement-progress`); the agreed / paid /
balance rows; "No agreed total — paid by the day." when daily. **Opened**, it adds **WORKS COVERED** (numbered, when
any) and **PAYMENTS** (date · amount · method per row, or "No payments recorded yet."). Then "Updated 9:28 AM" and the
two-language footnote. Everything shown today stays, with today's words.

## 8. My proposals sheet

Opened from My Work's pill and Home's shortcut (team leaders): a **tall `WmSheet`**, key `proposals-sheet`, titled
"My proposals". Body: **Propose a task** (`propose`, a `WmSheetButton`-style green button with a plus icon), the
explanation line, the notices as today, then one card per proposal: title + status pill, where, the office's reason
(danger) when declined, and "If you are on it, it is in My Work." when published; pending ones as today. The Propose a
task form becomes a `WmPage` with its send button pinned in the footer; every field stays.

## 9. Testing

- Existing tests of the three screens and the forms are rewritten to open the sheets and assert the same facts; none
  deleted. `pageBack` on a form keeps working (tooltip "Back"); closing a sheet uses Back.
- New: the leader's switch and its counts; a tool card opens in place and shows exactly the allowed actions for a
  worker's own tool and for a leader's team tool; history loads on open and its failure text shows; one card open at
  a time; an agreement card opens in place with works and payments; My proposals opens as a sheet; each form's send
  button sits in the pinned footer; History's switch is unchanged after the extraction.
- Full `flutter test` and `flutter analyze` clean; no hit-test warnings.

## 10. Acceptance

1. My tools / Tools opens as a sheet; a leader sees Mine · Team · My records.
2. A tool opens in place with the allowed actions and its history; every action still records as before.
3. The five tool forms and Propose a task have the new page look with every field.
4. My agreements opens as a sheet; an agreement opens in place with works and payments; amounts appear nowhere else.
5. My proposals opens as a sheet.
6. All tests and the analyzer pass. The phone check comes **before** publishing build 1025.
