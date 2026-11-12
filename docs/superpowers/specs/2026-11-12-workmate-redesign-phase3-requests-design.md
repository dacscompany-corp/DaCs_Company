# WorkMate redesign — Phase 3: Requests (design)

**Status:** design approved by the owner 12 November 2026 ("approved"); this spec awaits review.
**App:** DAC's WorkMate (`C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`), base `main` at `5eddf94`
(0.13.1+1018, published 12 Nov). **Target:** `0.14.0+1019`. **No server change.**
**Source:** the Claude Design handoff (variant 1a "Inbox"), Requests tab and request sheet. The mockup's request
form is simplified; it is layout reference only.
Earlier phases: Phase 1 (Home and shell), `2026-11-11-workmate-redesign-phase1-home-design.md`; Phase 2 (My Work),
`2026-11-12-workmate-redesign-phase2-my-work-design.md`.

## 1. Purpose

The Requests tab already has the right content: filters, request cards, the details page and the New request form.
Phase 3 gives it the redesign's look and makes a request easy to read at a glance: chips with counts, a 3-part bar
(Saved · Sent · Received) with a status line on every card, and the details as a tall swipe-down sheet like the task
sheet of Phase 2.

## 2. Owner decisions (12 November 2026)

| Topic | Decision |
|---|---|
| Scope | **List + details sheet.** New request and the item editor stay full pages, unchanged in Phase 3. |
| Find previous item | **Kept in both places**: on the Requests tab (a new request from an earlier item) and in the item editor. |
| Fields and rules | Every real field, action and server rule stays (standing decision, 11 Nov 2026). |

## 3. What does not change

- **New request** (`ComposeScreen`) and the **item editor** (`ItemEditorScreen`): every field, their order, their
  validation, the draft saving on every change, Delete draft, Find previous inside the editor, the camera, photos,
  catalog search, "Describe it", "For", Urgent and Needed by.
- Every server call and the offline queue (`RequestsApi`, `RequestSync`): submit, change quantity, cancel item,
  cancel the whole request, photos, dismiss a refusal, back to drafts.
- The filter rules of `RequestsController.rows` (All; Drafts = draft; Pending sync = pending; Needs attention =
  failed or needs resolution). The selected filter stays in the shared controller as today.
- Every word on the details page: the line texts ("Changing to … · Pending sync", "Cancelling · Pending sync", "Your
  change and the office's change differ. The office will decide and tell you.", "… · Arranged · Expected …",
  "From stock: … · Galing sa stock"), the confirmation and quantity dialogs, and the refusal notices with
  "Edit and send again · I-edit at ipadala ulit" and "Dismiss · Isara".
- A **draft** card opens straight into New request, as today. Only the requester may change or cancel (0085); a
  leader reads their team's requests only.
- Home's "Needs you" request rows and the New request shortcut keep their keys and openers.

## 4. Requests tab, top to bottom

1. **Title row:** "Requests" (26/800) and, on the right, the green **New request** button (key `new-request`, height 44,
   plus icon). Subtitle (14, muted, 2 below): "Materials and tools for your projects."
2. **Find previous item** (12 below, only when History is available, as today): a white pill button like My Work's
   Meeting notes pill (height 40, radius 999, border `border`, history icon 20 green, label 14/700 green "Find previous
   item"). Key `find-previous`. The spinner while it starts and the ignore-second-tap rule stay.
3. **No-signal line / failure notice** exactly as today (the brown "No signal: showing what this phone saved on …"
   line, or the bilingual notice with Retry).
4. **Chips** (12 below): **All · Drafts · Pending sync · Needs attention**, each with its count, in **My Work's chip
   style**: height 38, padding 0 8 0 16, radius 999, 14/700; selected = `#1B1B19` with white text; count bubble
   min 22 × 22, radius 11, 12/800. One horizontal scrolling row, gap 8, that **runs to the screen edges** with the first
   chip lined up with the title (as My Work). Keys stay `filter-all`, `filter-drafts`, `filter-pending`,
   `filter-attention`. Each count uses the same rule as its filter.
5. **Cards** (12 below, 10 apart): white, radius 16, padding 14, border `border` — **red (`danger`) when the request is
   the worker's own and its state is Not accepted or Needs resolution**.
   - Row: title (16/800; the project and work, or "New request" for an unnamed draft) + the status pill (`SyncChip`,
     unchanged).
   - Line (13, muted, 4 below), unchanged: "From Ramon · 3 items · 12 Nov" ("From …" only for a team member's request).
   - **3-part bar** (12 below): three equal segments, height 4, radius 2, gap 4, coloured by state (section 5).
   - **Status line** (8 below): icon 17 + text 13/700, coloured by state (section 5).
   - Tags (8 below, when any), unchanged rules: **URGENT** pill; "Next delivery Wed 14 Nov" (13, green).
   - Keys stay `entry-<entry key>`.
6. **Empty:** "Nothing here yet. Tap New request to ask for materials or tools." (as today); loading spinner as today.

## 5. The 3-part bar and the status line

The bar's segments read **Saved · Sent · Received**. One table drives both the card and the sheet:

| State | Segments (1 · 2 · 3) | Icon | Status line | Colour |
|---|---|---|---|---|
| Draft | `textMuted` · `border` · `border` | `edit_note` | Not sent yet · finish and send | `textSecondary` |
| Pending sync | `green` · `brown` · `border` | `cloud_off` | Saved on this phone · sends when there is signal | `brown` |
| Received | `green` · `green` · `green` | `check_circle` | Received by the office | `green` |
| Not accepted (failed) | `green` · `danger` · `border` | `report` | Needs attention · open it to see why | `danger` |
| Needs resolution | `green` · `danger` · `border` | `report` | Needs attention · open it to see why | `danger` |
| Cancelled | `textDisabled` · `textDisabled` · `textDisabled` | `block` | Cancelled | `textMuted` |

No segment animates (a repeating animation would keep the screen busy and adds nothing a worker needs).

## 6. Request details as a tall swipe-down sheet

A request that is not a draft opens as a **tall `WmSheet`** (Phase 1). Drag down, Android Back, tapping above it
or × close it. Opening it asks for a fresh copy (as Meeting notes do; the sheet has no pull-down). It follows the
shared controller, so it updates after every refresh. Keys: `request-sheet` on the sheet body; `request-gone` on
"This request is no longer on the list." (shown when the entry disappears).

**Header:** the title (the project and work, as the old page showed it) and the round close button.

**Body, in this order:**
1. The status pill (`SyncChip`) and the meta line (13, muted). Received: "From Ramon · Just me / Team X · Received
   12 Nov, 9:14 AM" ("From …" only for a team member's request). On the phone only: "Just me" / "Team X".
2. **Status box** (white card, radius 16, padding 14): the 3-part bar; under it the labels **Saved · Sent ·
   Received** (11.5/600, muted; left, centre, right); then the status line (icon 18 + 14/700, colour per section 5).
3. The request's note, when there is one (as today).
4. "Cancelled" (danger, 700) when the request is cancelled but something unsent outranks that state (as today).
5. For a request still on the phone and pending: "Saved on this phone. It is sent as soon as there is signal."
   (brown, as today).
6. The refusal notices, as today: bilingual, with **Edit and send again** for a refused send (it closes the sheet and
   opens the draft in New request, with today's guards) or **Dismiss** for anything else.
7. **"ITEMS (N)"** (mono label), then one card per item with exactly today's content and buttons: description +
   quantity and unit; kind · spec · "Not in the list" · "For …"; progress label + URGENT tag; the
   changing/cancelling lines; the "office will decide" explanation; each portion's "… · Arranged · Expected …";
   "From stock: …"; photos; and, for the requester on an open item, **Change quantity** and **Cancel item**. Keys stay
   `line-<id>`, `change-<id>`, `cancel-<id>`, `line-from-stock-<id>`.

**Footer:** **Cancel the whole request**, a red outlined button (height 48, radius 14), key `cancel-request`, only
when the worker may cancel it and no cancel is already waiting (today's rule). With nothing to show, no footer.
The confirmation dialog ("Cancel the whole request?" / "Keep" / "Cancel it", key `confirm-cancel`) and the
quantity dialog (`qty-field`, `qty-save`) open over the sheet, unchanged.

## 7. Shared pieces

My Work's chip, pill button and edge-to-edge chip row move to one shared file so both tabs look the same and cannot
drift: `WmCountChip`, `WmPillButton` and `WmChipRow` in `lib/ui/wm_chips.dart`. My Work uses them with no visible
change (its keys and tests stay).

## 8. How it is built

| Piece | Where | What |
|---|---|---|
| Chips + pill | new `lib/ui/wm_chips.dart` | Moved from `my_work_screen.dart`; My Work then uses them. |
| Bar + status line | new `lib/requests/ui/request_stage.dart` | Pure table of section 5 (`stageOf(SyncState)`), plus the bar widget and the status-line widget. |
| Counts | `lib/requests/list/requests_controller.dart` | `count(RequestFilter)`, the same rule as `rows`. |
| Requests tab | `lib/requests/list/requests_screen.dart` | Header, Find previous pill, chips, cards. |
| Details sheet | new `lib/requests/detail/request_sheet.dart` (replaces `request_detail_screen.dart`) | Section 6. Dialogs, photo loading and refusal labels move unchanged. |
| Opener | `lib/requests/list/request_openers.dart` | `openRequestEntry` opens the sheet; drafts still open New request. |
| Version | `pubspec.yaml` | `0.14.0+1019`. |

## 9. Testing

- **Unit (request_stage):** every row of section 5.
- **Requests tab (widget):** chip counts for each filter; switching filters; each state's card shows its bar and
  status line; the red border only on the worker's own attention cards; the Find previous pill still starts a search
  and ignores a second tap; New request still opens the form; empty and loading texts.
- **Details sheet (widget):** body order and content (all of section 6) for a received, a pending, a refused and a
  cancelled request; Change quantity and Cancel item from the sheet send exactly what they sent from the page;
  Cancel the whole request asks first; a leader's view of a team member's request has no buttons; "Edit and send
  again" closes the sheet and opens the draft; drag down / Back close the sheet; "no longer on the list".
- **Home:** the request "Needs you" row opens the sheet.
- **Existing tests** (`test/requests/detail/request_screens_test.dart`, `test/ui/home_inbox_test.dart`,
  `test/ui/screens_test.dart`, `test/history/ui/request_again_test.dart`, My Work tests) are **rewritten to assert the
  same facts in the new places**, never deleted.
- Full `flutter test` and `flutter analyze` clean.

## 10. Acceptance (Phase 3)

1. The Requests tab shows All · Drafts · Pending sync · Needs attention with counts; each filter shows the right
   requests.
2. Every request card shows the 3-part bar and the status line of section 5; the worker's own attention cards have a
   red border.
3. Find previous item and New request still work from the tab.
4. Tapping a draft opens New request; tapping any other request opens the details sheet.
5. The sheet shows everything the old page showed, and Change quantity, Cancel item, Cancel the whole request, Edit
   and send again and Dismiss all still work from it.
6. Home's request rows open the sheet.
7. All tests and the analyzer pass. The phone pilot and the publish of build 1019 are each a separate approval.

## 11. Phase 3b — the request pages in the new look (owner decision after the 1019 pilot, 12 Nov 2026)

On the 1019 phone check the owner asked for New request, Add item / Edit item and Find previous item to get the new
look too ("a", design approved 12 Nov). **They stay full pages** (camera, catalog search, date picker unchanged) and
**every field, button, label, key, validation and server call stays**. Build **0.14.1+1020**; 1019 is not published.

1. **One page frame (`WmPage`, `lib/ui/wm_page.dart`):** canvas background; a header with the round back button (the
   sheets' 36-px look, 48-px tap area, tooltip "Back"; it calls `maybePop`, so Android Back and any `PopScope` behave as
   today), the title 24/800 and, on the right, an optional round action button; a scrolling body with 20-px sides; an
   optional footer pinned at the bottom (white, top hairline, 12 / 20 padding) for the main button and its note. The
   sheets' round button becomes the shared `WmRoundButton` (in `wm_sheet.dart`), unchanged in look.
2. **Choice chips:** `WmChoiceChip` (in `wm_chips.dart`) — `WmCountChip` without the count: height 38, padding 0 16,
   radius 999, 14/700; selected = `#1B1B19` with white text, otherwise white with a `border` outline.
3. **New request:** `WmPage` titled "New request" with the round **Delete draft** action (key `draft-delete`). The body
   keeps its order and content (notices, PROJECT AND WORK card, TEAM, ITEMS, line cards, Add item, Note). TEAM uses
   `WmChoiceChip` (keys `team-none`, `team-<id>`). **SEND REQUEST** (`WmSheetButton`, key `send-request`, grey while
   sending) and "No signal? It is saved on this phone and sent as soon as there is signal." sit in the footer, with the
   send-failure notice above the button when there is one.
4. **Add item / Edit item:** `WmPage` titled "Add item" / "Edit item" with the round **Remove item** action when editing
   (key `item-remove`). Material / Tool become two `WmChoiceChip`s side by side (keys `item-kind-material`,
   `item-kind-tool`). Catalog matches become white rounded cards (keys `catalog-<id>`). "Not in the list? Describe it"
   (`describe-item`), "Find previous item" (`item-find-previous`) and "Add photo" (`item-add-photo`) become
   `WmPillButton`s. Every field, the Urgent switch, Needed by, notes and photos stay. **SAVE ITEM** (`WmSheetButton`,
   key `item-save`) sits in the footer.
5. **Find previous item:** `WmPage` titled "Find previous item". The kind chips (`history-kind-all`,
   `history-kind-<wire>`) and the period chips (`history-period-<name>`) become `WmChoiceChip`s. The search box, the
   Project and Category drop-downs, the result cards, the saved-copy banner, the failure notice, "No matches…" and
   SHOW MORE stay.
6. **Tests:** tests that read a page's old widget types (e.g. `ChoiceChip` for `team-none`) assert the same fact on the
   new widget; `tester.pageBack()` keeps working through the "Back" tooltip. Nothing is deleted.

## 12. Phase 3c — New request as the mockup's sheet (owner decision after the 1020 phone check, 12 Nov 2026)

On the 1020 check the owner showed the mockup's New request and asked for that layout. Decisions: **+ opens Add item
filled in** (recommended option), design approved 15:33. Build **0.14.2+1021**; 1020 is not published. Add item and Find
previous keep their §11 pages. Every field, rule, draft-saving behaviour and server call stays.

1. **New request is a tall `WmSheet`** opened by New request (tab, Home shortcut, Request Again from the tab) and by a
   draft card. Title "New request", or "Draft request" when a saved draft is reopened from its card. × / drag down / Back
   close it; the draft is already saved on every change; an untouched new request still stores nothing.
2. **Body, in order:** the notices as today (loading line, list failure with Retry, no-signal lists, no projects, project
   closed); **PROJECT AND WORK** — one card per project and work from the lists (icon, project 15/700, work 13 muted;
   selected: green tint, green border, check icon), tap = choose it (keys `dest-<workId>`; "Choose the project" error under
   the list when sending without one); **TEAM** chips (as §11); **ITEMS (N)** — the item cards as today, then the
   **quick-add row**: "Item name" box (key `quick-name`), "Qty" box (key `quick-qty`, number keyboard) and a green **+**
   (48 × 48, key `add-item`) that opens Add item with the name in its search box and the quantity in Quantity (empty boxes
   open a blank Add item; saving clears the two boxes); the item-count and limit errors as today; **Find previous item**
   pill (key `compose-find-previous`, only when History is available) — the picked item opens in Add item as a new item
   of this draft; **NOTE (OPTIONAL)** with the box "Anything the office should know" (key `request-note`); **Delete
   draft** (red text button, key `draft-delete`, with today's confirmation) when the draft has a project, an item or a note.
3. **Footer (pinned):** the send-failure notice when there is one; **SEND REQUEST** (`WmSheetButton`, key
   `send-request`) — grey while sending or while there is no item; under it "Add at least one item." when there is no item,
   otherwise "Saved on this phone as you type. It is sent as soon as there is signal."
4. Tests rewritten to open the sheet, tap `dest-<workId>` instead of the old picker, close with Back instead of
   `pageBack`, and assert the new title, the grey button and its note; nothing deleted.
5. **After review (owner decisions 12 Nov ~15:58, both recommended):** (a) the project list **collapses after a choice**
   — all cards show until a project is chosen; then only the chosen card stays with a **Change** link (key
   `dest-change`) that shows the full list again; a reopened draft with a project starts collapsed. (b) **SEND REQUEST
   with text in the quick-add boxes** first opens Add item filled in (as +) and sends nothing; the worker saves (or backs
   out) and taps SEND REQUEST again. (c) **Delete draft** shows on every reopened draft, and on a new one once it has a
   project, a team, an item or a note (fixes a review finding: a draft saved by a team or note choice had no Delete).
