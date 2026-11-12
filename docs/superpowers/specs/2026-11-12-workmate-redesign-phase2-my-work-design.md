# WorkMate redesign — Phase 2: My Work

Date: 12 November 2026

Written for: the owner, the implementer and the reviewer.

Status: **Design approved by the owner on 12 November 2026.** Approving this design does not approve a build, a
pilot, a publish, a commit or any change to the live system; each of those is its own approval, as for every
WorkMate stage.

Source design: the Claude Design handoff bundle `WorkMate app redesign-handoff.zip` (Downloads, 11 Nov 2026), variant
**1a "Inbox"**, My Work tab and its sheets in `workmate-app-redesign/project/WorkMate App.dc.html`. Phase 1 (Home and
shell) is live as 0.12.1+1016 (WorkMate `3fabf73`); its spec is
`docs/superpowers/specs/2026-11-11-workmate-redesign-phase1-home-design.md` and its shared sheet (`WmSheet`) is reused
here.

---

## 1. Purpose

My Work today is a list grouped under section headings, and a task opens as a full page whose buttons sit in the
middle of a long scroll. Phase 2 makes the list scannable — **chips with counts**, a **4-step progress bar** and a
plain **"Next:" line** on every task — and turns the task into a **tall swipe-down sheet** with its one main action
fixed at the bottom. Report forms open **inside the same sheet**, and a **swipe-left shortcut** on a card jumps
straight to Report progress or Report a problem. The worker finishes a report without losing their place in the list.

## 2. Owner decisions (12 November 2026)

| Subject | Decision |
|---|---|
| Phase | **Phase 2 = My Work only** (chips, progress bar, task sheet, report forms as sheets, swipe). |
| Progress steps | **4 steps: Read · Started · Reported done · Approved.** The leader's check is optional in the real flow (the office can approve from "Reported done"), so it is a small "Checked by the leader" line under step 3, not a step. |
| Swipe | **Keep it, as a shortcut only.** Swiping reveals buttons; a button opens the form; nothing is ever sent from the swipe. The same buttons stay in the task sheet. |
| My proposals | **Waits** — stays a full page in Phase 2. |
| Forms (carried from Phase 1) | **Every real field and rule stays.** |
| Approach | **One tall task sheet whose body switches to the form** (back arrow returns to the task). |

## 3. What does not change

- `actionsFor` and every rule about who may do what (acknowledge, start, progress, problem, done, check, locks); every
  server call; the offline queue, "Pending sync", refusals and Dismiss; the saved copy shown with no signal.
- **Everything the task page shows today is still shown**: the changed-task box, the sent-back notice, refused actions
  with Dismiss, actions waiting to send, Instructions, Waiting for (problems and earlier tasks), People, Photos (private
  links), History.
- Every report form field: notes (required for progress, optional for done/check), the optional photo (taken in the
  app, kept privately, deleted when the worker backs out), the problem kind, the request link for materials/tool
  problems, and "Make a request".
- **My proposals** and **Propose a task** stay full pages. The "Meeting notes (N)" button stays and opens the Phase 1
  Meeting notes sheet.
- Home's Needs-you rows (Phase 1) still open a task through the shared `openTask` opener — they now get the sheet.
- Tab set and order, the bottom bar, Home and Profile: unchanged.

## 4. My Work tab, top to bottom

Measurements are the design's (logical pixels); colours are `WmColors` names.

1. Page padding 16 / 20 / 28. Title "My Work" 26/800; subtitle "Your tasks from the office. Read each one, then report
   as you work." 14 muted, 2 below.
2. **Buttons row** (12 below, wrap, gap 8): "Meeting notes (N)" (`forum`) and, for a team leader, "My proposals"
   (`lightbulb`) — pills: height 40, padding 0 14 0 10, radius 999, white, border `border`, icon 20, 14/700 `green`.
   Keys `open-notes`, `open-proposals` kept.
3. Notices — unchanged content and order: the no-signal saved-copy line or the failure notice; refused actions not on
   a listed task (with Dismiss); "N actions saved on this phone, waiting for signal."
4. **Chips** (16 below; one horizontal scrolling row, gap 8): **Today · Upcoming · Waiting · Done**, each with its
   count. Chip: height 38, padding 0 8 0 16, radius 999, 14/700; count bubble min 22 × 22, radius 11, 12/800.
   Selected: `text` (#1B1B19) background and border, white label, bubble at 20 % white. Others: white, border
   `border`, label `textSecondary`, bubble `inert`. **Today is selected when the tab opens**; the choice is not
   saved. Groups are `groupOf(...)` as today (Done = completed in the last 14 days); order inside a chip is the
   controller's existing `group(...)` order. Keys `chip-today`, `chip-upcoming`, `chip-waiting`, `chip-done`.
5. **Swipe hint** (12 below), shown only while the selected chip has a card that can be swiped and the worker has not
   swiped yet on this phone: `swipe_left` icon 18 + "Swipe a task left to report progress or a problem." 12.5 muted.
   The first completed swipe hides it for good on this phone (saved locally, per phone).
6. **Task cards** (12 below; 10 apart): white, radius 16, padding 14, border `danger` when the task needs the worker
   (to read / to check), else `border`.
   - Row: title 16/800 (line height 1.25) and the existing `TaskPill`.
   - `where` 13 muted (4 below).
   - Meta 13 (2 below): `plannedLabel · role` plus " · Late" when late; the whole line `danger`/700 when late, else
     `textSecondary`.
   - **Progress bar** (12 below): 4 segments, gap 4, height 4, radius 2; a reached step `green`, else `border`.
   - **Next line** (7 below), 12.5/700, words and colours in 5.2.
   - Tap → the task sheet (section 7). Key `task-<id>` kept.
7. Empty chip: "No tasks here right now." centred, muted, 32 above. No tasks at all, as today: "No tasks for you
   right now."

## 5. Progress steps and the Next line

### 5.1 Steps (card bar and sheet tracker)

| # | Step | Reached when |
|---|---|---|
| 1 | **Read** | the current version is read: `!entry.toRead` (a pending "I've read this" for this version counts) |
| 2 | **Started** | `effectiveStatus` is in progress or later |
| 3 | **Reported done** | `effectiveStatus` is reported done, checked by leader, or completed |
| 4 | **Approved** | `effectiveStatus` is completed |

- A task the office changed goes back to "not read" (step 1 empty) until read again — the steps after it keep their
  state.
- Sent back by the office (`sentBack` and in progress): steps 3–4 empty again; the sent-back notice shows in the sheet.
- **Checked by the leader** (`effectiveStatus == leaderChecked`): step 3 reached, and the tracker shows a small line
  "Checked by the leader" (12.5 `green`) under it. Not a step.
- The "current" step is the first not reached; no current step when all four are reached.

### 5.2 Next line (first rule that matches)

| Situation | Words | Colour |
|---|---|---|
| any action of this task waiting to send | Saved on this phone · sends when there is signal | `brown` |
| to read | Next: read the task | `danger` |
| leader, to check | Next: check this work | `danger` |
| blocked | Waiting for the office to clear a problem | `brown` |
| completed | Completed | `green` |
| reported done or checked by leader | Reported · the office checks it next | `textSecondary` |
| responsible, not started | Next: start work | `textSecondary` |
| responsible, in progress | Next: report done | `textSecondary` |
| helper (not responsible), not completed | The responsible person reports this work | `textSecondary` |

Refused actions keep their existing "Not accepted" pill; the Next line follows the table.

## 6. Swipe left on a card

- **Which buttons:** "Progress" when `actionsFor(e).progress`; "Problem" when `actionsFor(e).problem`. A card with
  neither does not move.
- Buttons sit behind the card's right edge: padding 6, gap 6, each 70 wide, radius 12, icon 22 over label 12/800.
  Progress: `greenTint` / `green`, `edit_note`. Problem: `dangerTint` / `danger`, `report`.
- Drag follows the finger up to the buttons' full width (82 for one, 158 for two: 6 + 70 per button + 6 gap/edge);
  let go past 64 → snaps open, else snaps back. Vertical scrolling of the list keeps working. Only one card is open at a time; tapping an open card, another
  card, or swiping back closes it.
- A tap on **Progress / Problem opens the task sheet straight on that form** (back arrow → the task). **Nothing is sent
  by a swipe or by these buttons.**
- A tap on a closed card opens the task sheet.
- Keys: `swipe-progress-<id>`, `swipe-problem-<id>`.

## 7. The task sheet

A Phase 1 `WmSheet`, **tall** (92 %), titled with the task title. It reads its entry from the shared controller by id
and follows every refresh; if the task leaves the list it says "This task is no longer on your list." (and offers
only close).

**Body, in this order:**
1. `TaskPill` + meta line 13 muted: `plannedLabel · role · Team X · Version N`.
2. `where` 14 `textSecondary` (6 below).
3. **Step tracker** (14 below): white card, border, radius 16, padding 14 / 6 / 12, four columns. Circle 28: reached →
   `green` fill with a white `check`; current → white with a 2 px border in the Next-line colour and the step number;
   later → white, 2 px `border`, number `textDisabled`. A 2 px line joins each circle to the previous one, `green` once
   reached. Labels 12, current 800, later `textDisabled`. "Checked by the leader" line under step 3 when it applies.
4. Changed box (danger tint) when the task changed since read — words as today.
5. Sent-back notice; refused actions with Dismiss; actions waiting to send — as today.
6. Instructions; Waiting for; People; Photos; History — as today (existing `WpBox` cards).

**Footer** (white, top border):
- **One main button** (min height 56), chosen in this order:
  1. to read → **I'VE READ THIS** (`done_all`), key `ack`;
  2. `a.start` → **START WORK** (`play_arrow`), key `start` — grey and inert when locked or already pending;
  3. `a.done` → **REPORT DONE** (`task_alt`), key `done` — grey and inert when locked;
  4. `a.check` → **CHECK THIS WORK** (`fact_check`), key `check`;
  5. otherwise no main button.
- **Note** under it (13), when one applies: the lock's existing words (`lockText`) in `brown`; "The office checks the
  work before it counts as completed." (reported done / checked by leader) muted; "Completed." muted.
- **Second row** (10 below, two equal buttons, height 48, radius 14): "Report progress" (`edit_note`, white, border,
  `green`) when `a.progress`; "Report a problem" (`report`, white, `dangerBorder`, `danger`) when `a.problem`. Keys
  `progress`, `problem` kept.

## 8. Report forms inside the sheet

- Report progress, Report a problem, Report done and Check this work open **inside the task sheet**: header back arrow
  (key `wm-sheet-back`) + the form's title; body = today's form (same fields, labels, validation and photo handling);
  footer = the form's existing send button (same words: "Send progress", "Report the problem", "Report done",
  "Mark as checked") with the note "Saved on this phone. It is sent as soon as there is signal."
- **Send** queues exactly what today's form returns (`reportProgress`, `reportProblem`, `reportDone`, `checkWork`) and
  returns to the **task view**, which then shows "Pending sync".
- **Leaving a form never loses the sheet in one move:** the back arrow, Android Back, dragging the sheet down and
  tapping outside all return to the task view; from the task view they close the sheet.
- **A form keeps what was typed while the sheet is open** (owner decision after the 1017 pilot, 12 Nov 2026 — option
  a): leaving a form and opening it again shows the same note, photo, problem kind and request link. Each form keeps
  its own draft. **Send** clears that form's draft (the photo goes with the report). **Closing the sheet** — any way,
  including "Make a request" and a task that left the list — clears every draft and deletes any unsent photo, as
  backing out of the old page did. Drafts are never saved on the phone beyond the open sheet.
- "Make a request" (materials/tool problem) closes the sheet and opens the Requests tab, as today.

## 9. Sheet and Meeting-notes improvements carried from Phase 1

- `WmSheet` footer gets an optional **note line** under the main button (13; muted, or `brown` for a lock).
- The sheet's round back/close buttons keep their 36 px look but get a **48 × 48 tap area**.
- **Meeting notes** with no signal: if a saved copy exists, a brown line "No signal: showing what this phone saved on
  {day}, {time}." above the notes; if nothing could be read, "No signal right now. Open this again when there is
  signal." instead of "No meeting notes for you yet."

## 10. How it is built

| Piece | Where | What |
|---|---|---|
| Steps + Next line | new `lib/workplan/domain/wp_progress.dart` | Pure: entry + actions → reached steps, current step, leader-checked flag, Next words + tone. No widgets. |
| My Work tab | `lib/workplan/ui/my_work_screen.dart` | Chips, cards with bar and Next line, swipe, hint. |
| Swipeable card | new `lib/workplan/ui/task_card.dart` | Card + swipe reveal, one-open-at-a-time handled by the screen. |
| Task sheet | new `lib/workplan/ui/task_sheet.dart` (replaces `task_screen.dart`) | Task view + form view switching, PopScope rules of section 8. |
| Forms | `lib/workplan/ui/report_forms.dart` | Form bodies usable inside the sheet (no own Scaffold/AppBar); logic unchanged. |
| Opener | `lib/workplan/ui/task_openers.dart` | `openTask(..., {form})` opens the sheet, optionally on a form. |
| Hint memory | small local store (shared preferences key `wm.mywork.swipeHintSeen`) passed through `WorkPlanServices` | Per phone. |
| Sheet | `lib/ui/wm_sheet.dart` | Footer note; 48 px tap areas. |
| Meeting notes | `lib/workplan/ui/notes_sheet.dart` | No-signal states. |
| Version | `pubspec.yaml` | `0.13.0+1017` (piloted 12 Nov, not published); `0.13.1+1018` with the form drafts of §8. |

## 11. Testing

- **Unit (wp_progress):** every row of 5.1 and 5.2, including changed-after-read, sent back, leader checked, pending
  ops, helper, blocked.
- **My Work (widget):** chip counts and switching; Today selected on open; card bar and Next line; empty chip text;
  notices still shown; Meeting notes / My proposals buttons still work.
- **Swipe (widget):** only allowed buttons appear (helper → Problem only; completed → no swipe); past 64 snaps open,
  less snaps back; one open at a time; a button opens the sheet on that form and **sends nothing**; the hint hides after
  the first swipe and stays hidden after a rebuild with the same store.
- **Task sheet (widget):** body order and content (all of section 3); the main button by state and its lock note; the
  second row; "no longer on your list".
- **Forms in the sheet:** each form sends exactly what the page form sent; back arrow / Back / drag / outside tap from a
  form return to the task view; a form left and reopened shows its draft (note, photo, kind, link); Send clears it;
  closing the sheet deletes an unsent photo; Make a request still opens Requests.
- **Existing tests** (`test/workplan/ui/my_work_screens_test.dart`, task and form tests, Home's Read/Check row tests)
  are **rewritten to assert the same facts in the new places** — never deleted.
- Full `flutter test` and `flutter analyze` clean.

## 12. Acceptance (Phase 2)

1. My Work opens on Today with counts on all four chips; switching chips shows the right tasks.
2. Every card shows the 4-part bar and a Next line that matches 5.2.
3. A changed task shows step 1 empty and "Next: read the task" until read.
4. A task checked by a leader shows "Checked by the leader" under step 3; approving fills step 4.
5. Swiping a responsible person's in-progress task shows Progress and Problem; a helper's shows only Problem; a
   completed task does not swipe; nothing is sent until Send is tapped in the form.
6. The task sheet shows everything the old page showed, with the right main button and lock note at the bottom.
7. Each form opens inside the sheet; Back returns to the task; Send returns to the task with "Pending sync".
8. Home's Read and Check rows open the task sheet.
9. Meeting notes with no signal says so instead of "No meeting notes".
10. All tests and the analyzer pass. The phone pilot and the publish of build 1018 are each a separate approval
    (1017 was piloted on 12 Nov and will not be published).
11. A form left and opened again while the sheet is open still shows what was typed and the photo.
