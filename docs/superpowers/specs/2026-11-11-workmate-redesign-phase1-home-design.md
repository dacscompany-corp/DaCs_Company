# WorkMate redesign — Phase 1: Home and shell

Date: 11 November 2026

Written for: the owner, the implementer and the reviewer.

Status: **Design approved by the owner on 11 November 2026.** Approving this design does not approve a build, a
pilot, a publish, a commit or any change to the live system; each of those is its own approval, as for every
WorkMate stage. Phases 2–6 (section 10) are listed for order only: each gets its own spec and approval.

Source design: the Claude Design handoff bundle `WorkMate app redesign-handoff.zip` (Downloads, 11 Nov 2026),
file `workmate-app-redesign/project/WorkMate Redesign.dc.html`, variant **1a "Inbox" (chosen)**, rendered by
`WorkMate App.dc.html`. Variant B ("Up next" carousel) was not chosen and is not built. The bundle stays out of the
repository, like the earlier prototype zip.

Base: WorkMate repo `Documents\Dacs WorkMate`, main `56e59c4` (0.11.1+1014, published), clean.

---

## 1. Purpose

Workers open WorkMate to do one thing at a time. Today Home stacks four separate cards under attendance (My Work,
Requests, My tools, My agreements), each with its own lines of counts, and the worker has to work out which of those
needs them. Phase 1 replaces those four cards with **one "Needs you" list where every row has its own button**, adds
a **sync badge** that says honestly whether anything is still on the phone, moves Tools and Agreements into a quiet
**shortcut row** and a **Mine** section on Profile, restyles the **bottom bar**, and adds the shared **swipe-down
sheet** that later phases use for details and forms.

The colours and fonts in the design are already WorkMate's (`WmColors`, Barlow, IBM Plex Mono). This is a **layout
change, not a new look.**

## 2. Owner decisions (11 November 2026)

| Subject | Decision |
|---|---|
| Rollout | **Phases, Home first.** Phase 1 = this spec. Then My Work, Requests, History, Tools/Agreements sheets, Buyer — each its own build, pilot and publish approval. |
| Forms | **Keep every real field and rule.** The mockup's simplified forms (New request = name + qty; Record purchase = qty + amount) are layout guidance only. No field, check or server rule is removed by the redesign. |
| Sync badge source | **Everything waiting on the phone:** attendance, requests, My Work reports, tool records. "All sent" only when nothing waits. |
| Sync badge words | **"N not sent yet"** (matches the existing attendance "Not sent yet" sign), not the mockup's "waiting for signal". |
| "Needs you" length | **5 rows, then "Show N more"**, which opens the rest in place. The red count beside NEEDS YOU is always the full count. |
| Next delivery | **Kept on Home as a quiet line** under the Needs you card; no button. |
| Approach | **One shared rule list (pure code) that Home only draws** (section 9). |
| Module that failed to start | **Counts as "not checked yet"** (option A, 11 Nov 2026, after the final review). If the phone cannot open Requests' or My Work's storage at start, the badge stays hidden and Home never says "caught up" (5.3, 6). |

## 3. What does not change

- The **Time In / Time Out** card, hero button and four-step flow, the "Not sent yet" / "Saved" pill on today's card,
  the camera-cancel notice, refused-submission notices and attendance failure notices.
- **This week** and **Weekly reward** strips, including the reward's no-offline-copy rule.
- The temporary-password prompt (0111/0112): still opens over Home only, never over the flow.
- **My Work, Requests and History tabs** keep their current layout until their phases. Tools, Agreements, Proposals,
  New request (compose) and Task screens still open as **full pages**; their sheet versions come in their phases.
- Every server call, offline queue, retry, refusal and "saved on this phone" rule. **Phase 1 adds no server function,
  migration, table or column.** Every number it shows is already on the phone.
- Linked Labor rules (0113): agreements are online only, **no amount on Home or Profile**, nothing shown before this
  session's read found at least one agreement, another account never sees the previous account's agreements.
- Tool rules (0107/0111): an unresolved tool submission never sends by itself.
- Tab set and order: worker/leader = Home · My Work · Requests · History · Profile; buyer = Shopping list ·
  My purchases · Stock · Profile.

## 4. Home, top to bottom

Measurements are the design's (logical pixels). Colours are `WmColors` names.

1. **Header** — avatar 44, name 17/800, "Carpenter · W-0142" 13 muted, as today. **New: the sync badge** at the
   right end of the row (section 6).
2. Greeting, weekday, long date — unchanged.
3. Notices (camera cancel, refused, failure) — unchanged.
4. Attendance card and Time In / Time Out hero — unchanged.
5. **NEEDS YOU** (section 5) — 24 below the attendance block.
6. **Next delivery line** — 10 below the card, only when a delivery is expected: `local_shipping` icon 18 green,
   "Next delivery Thu 12 Nov" 13.5/700 green. Same source and date format as today's Requests card
   (`RequestUpdates.nextDelivery`).
7. **Shortcut row** — 20 below. Four equal columns, gap 4. Each tile: icon 24 green over label 12.5/700
   `textSecondary`, centred, gap 6, padding 6 vertical, radius 14, pressed background `inert`.

   | Column | Tile | Shown when | Opens |
   |---|---|---|---|
   | 1 | My tools (`handyman`) | tools service present and `ToolsController.showCard` | ToolsScreen (page, as today) |
   | 2 | My agreements (`description`) | agreements service present and `AgreementsController.showCard` | AgreementsScreen (page, as today) |
   | 3 | Meeting notes (`forum`) | My Work service present | Meeting notes **sheet** (section 8) |
   | 4 | New request (`add`) — worker | Requests service present | ComposeScreen with a new draft, exactly as the Requests tab's New request |
   | 4 | My proposals (`lightbulb`) — team leader (`role == 'teamLeader'`) | My Work service present | ProposalsScreen (page, as today) |

   Tiles that are not shown leave their column empty; the others keep their columns, so a tile never jumps. No tile
   shown → no row. Tiles show **English only**; the Tagalog title stays as the subtitle inside each screen or sheet.
8. **This week** (22 below) and **Weekly reward** — unchanged.

## 5. "Needs you"

### 5.1 Layout

- Label row: `NEEDS YOU` in `monoLabel`; when there is at least one row, a red count bubble beside it (min 20 × 20,
  radius 10, `danger`, white 12/800) holding the **full** count.
- Card 9 below: white, border `border`, radius 20, rows separated by a 1 px `hairline` divider.
- Row: padding 14 / 14 / 14 / 16, gap 12; round icon 38 on its tint, icon 20 in its colour; title 15/700 (line
  height 1.25, up to 2 lines then ellipsis); line under it 13/600 in the row's colour; green action pill (padding
  8 × 14, radius 999, `green`, white 13.5/800). The whole row and the pill both open the target.
- More than 5 rows: the first 5 show, then a last row "Show N more" (14/700 green, `expand_more`), which reveals the
  rest in place and becomes "Show fewer". It folds back to 5 whenever the worker leaves Home (another tab, a
  screen opened from a row) and is never saved.
- Empty and every source read (5.3): one row, icon `done_all` on `greenTint`, "You are all caught up" 15/800,
  "Nothing needs you right now." 13 muted.

### 5.2 Rows, in this order

| # | Source | One row per | Icon · tint/colour | Title | Line | Button → opens |
|---|---|---|---|---|---|---|
| 1 | My Work | task with `toRead` | `fiber_new` · danger | task title | `task.changedSinceRead` (the same rule as the "Changed" pill): "Changed by the office · read it again"; else "New task · read it first" | **Read** → that task's TaskScreen |
| 2 | My Work | task with `toCheck` (leader) | `fact_check` · danger | task title | "Reported done · check the work" | **Check** → that task's TaskScreen |
| 3 | My Work | visible failed action (`visibleFailures` of each entry's and of `otherFailed`) | `report` · danger | `opLabel(op)` | "Not accepted · see why" | **See** → My Work tab |
| 4 | Requests | **own** entry in `failed` or `needsResolution` | `report` · danger | "Request · {title}" | needsResolution: "Needs resolution · check it and send again"; failed: "Not accepted · check it and send again" | **Fix** → the entry, opened exactly as the Requests tab opens it |
| 5 | Requests | draft entry | `edit_note` · inert / `textSecondary` | "Draft · {destination label, or New request}" | "{n} item(s) · not sent yet" | **Finish** → ComposeScreen on that draft |
| 6 | Tools | unresolved submission (`ToolSubmitter.unresolved`) | `report` · danger | the submission's `summary` | "Not confirmed · Send again or Check" | **Check** → ToolsScreen |
| 6b | Tools | any `unreadable` entry or `recoveryNeeded` (one row in total) | `report` · danger | "Saved tool records" | "Need checking" | **Check** → ToolsScreen |

Rules:

- Within a group, rows keep the order the module already sorts them in.
- **"Own" means the worker's own requests only.** Phone-side entries (draft / pending / failed) are always own; a
  server entry counts only when `mine` is true. A team member's request a leader can see is never a Needs you row.
- Pending (waiting-for-signal) items are **not** rows: they are the sync badge's job (section 6).
- The rows are computed fresh from the controllers on every rebuild; nothing is stored.
- After the target closes, Home refreshes the source it opened (as the tabs do today).

### 5.3 "Read at least once"

A source is **read** when its controller has finished at least one load from the phone's store or the server
(a saved copy counts). A source whose service is absent (module off) counts as read with nothing to show — **except
a module whose phone storage failed to open when the app started** (Requests or My Work; `main.dart` records the
failure): it counts as **not read**, because its unsent records may exist but cannot be counted (owner decision,
11 Nov 2026).

- Rows from read sources are shown even while another source is still loading.
- **"You are all caught up" appears only when every source is read and there are no rows.**
- No rows and some source not yet read → the whole NEEDS YOU block (label and card) is hidden. It never shows a
  false "caught up".

## 6. Sync badge

- Count = attendance submissions waiting on this phone for this worker (`AttendanceDb.sendable(workerId)`, the same
  list the sender drains; permanently refused ones are not waiting) + request entries in `SyncState.pending` +
  My Work actions waiting (`WpUpdates.pending`) + tool records not confirmed
  (`unresolved.length + unreadable.length + (recoveryNeeded ? 1 : 0)`).
- **0 → "All sent"**: `greenTint` background, `green` text and dot.
- **N > 0 → "N not sent yet"**: `brownTint` background, `brown` text and dot; the dot pulses (opacity 1 → 0.3 → 1,
  1.4 s, repeating).
- Pill: padding 6 × 10, radius 999, 12.5/800, 7 px dot, gap 6, no wrap. Not tappable in Phase 1.
- **Hidden until every source is read** (5.3; the attendance count is read when its local query returns). Never an
  early "All sent". A local read that fails leaves the badge hidden, and so does a module whose storage failed to
  open at start (5.3).
- Refreshes at the moments Home already refreshes: a background send settling (`_onQueueSettled`), the app
  resuming, the Time flow ending, and a pull-to-refresh on Home.
- Worker and team-leader Home only. The buyer shell has no Home and no badge in Phase 1.

## 7. Bottom bar and Profile

### 7.1 Bottom bar (both shells)

- White background, 1 px `border` line on top, padding 8 / 4 / 10.
- Selected tab: **filled** icon (e.g. `Icons.home`) in a `greenBorder` (#CBE0D2) stadium pill, icon and label
  `green`, label 12/800. Other tabs: outlined icon and label `textMuted`, label 12/600.
- Built on Flutter's `NavigationBar` (keeps accessibility, focus and existing finders) themed through
  `workMateTheme()`: Material's 64 × 32 indicator is accepted for the mockup's 60 × 32.
- Count bubble: min 18 × 18, radius 9, `danger`, white 11/800, **2 px white ring**, at the icon's top right.
  - **My Work**: same number as today (`WpUpdates.badge` = to read + to check + not accepted).
  - **Requests (new)**: own requests in `failed` or `needsResolution` (rows #4 of 5.2).
  - Buyer **My purchases**: same number as today.
- Existing keys stay (`my-work-badge`, `tab-stock`, …).

### 7.2 Profile

- Title "Profile" 26/800; page padding 16 / 20 / 28.
- **Profile card**: white, border, radius 20, padding 16, gap 14: avatar 56 (`green`, initials 19/800), name 18/800,
  subtitle 13 muted ("Carpenter · W-0142"; buyer: "Buyer"), "Active account" pill (`greenTint`/`green`, 12/800) 6 below.
- **MINE** (`monoLabel`, 20 above; card 8 below) — workers and team leaders only; each row only when its feature is on:
  - My tools (`handyman`): "No tools with you" / "{n} tool(s) with you", plus " · {p} problem(s) reported" when
    `openProblems > 0`. Shown when `ToolsController.showCard`. Opens ToolsScreen.
  - My agreements (`description`): "{n} agreement(s)". Shown when `AgreementsController.showCard`. Opens
    AgreementsScreen. **No amount.**
  - No row shown → no MINE section.
- **ACCOUNT**: Email, Position, Worker ID (info rows: label 14 muted, value 15/700 right-aligned, ellipsis); then
  Change password (`lock`, "Update your login") and, for non-buyers, Terms & Conditions (`gavel`, "Accepted 2 Oct
  2026" / "Read the terms you accepted"). Buyer: Email, Role = Buyer, Change password — as today.
- Action rows: padding 13 × 16, gap 12, icon 24 `green`, title 15/700, subtitle 13 muted, chevron 22 muted.
- **Log out**: full width, height 52, radius 16, white, border `border`, `logout` icon 20 + "Log out" 15/800 `green`,
  24 above. Same action as today.
- Version line unchanged.

## 8. Shared sheet, pop-up messages

### 8.1 `WmSheet`

A reusable bottom sheet built on `showModalBottomSheet` (`isScrollControlled`, `useSafeArea`), so Android Back closes
it.

- Backdrop `rgba(15,17,15,0.42)`; tap closes.
- Sheet: `canvas` background, top radius 28, shadow 0 −8 30 at 14 % black; height = content, or **92 % for tall
  sheets**; never above 92 %.
- Header (padding 10 / 20 / 8): grab handle 36 × 4 (`textFaint`, radius 2, 12 below); optional round back button;
  title 20/800 (line height 1.2) with optional Tagalog subtitle 12.5 muted; round close button. Round buttons: 36,
  `inert` background, icon 20 `textSecondary`.
- **Dragging the header down more than 110 px, or a downward fling, closes it**; less springs back.
- Body: scrolls, padding 6 / 20 / 20.
- Optional footer: white, top border, padding 12 / 20 / 16; a main button (min height 56, radius 16, `green`, icon 22 +
  label 16/800, optional Tagalog line 11.5/600 at 75 % white; grey `textDisabled` and inert when disabled) and an
  optional note 13 below it.
- Open: slide up 0.34 s (`Cubic(0.2, 0.8, 0.2, 1)`); backdrop fades in 0.2 s.

**Phase 1 uses it for exactly two things:**

1. **Meeting notes** — the current NotesScreen content inside a sheet titled "Meeting notes"; content height. Opened
   from the Home tile and from My Work's existing "Meeting notes (N)" button (that button stays where it is).
2. **Change password** — the current ChangePasswordSheet content in a WmSheet titled "Change password", its Save in
   the footer (its existing words "SAVE PASSWORD", `lock` icon). Its validation, error messages, busy state and result
   stay exactly as they are; Profile still shows "Your password has been changed."

### 8.2 Pop-up messages

`SnackBarThemeData` in `workMateTheme()`: floating, 16 side margins, radius 12, `text` (#1B1B19) background, white
14/600 text, shadow. Durations and wording unchanged.

## 9. How it is built

**Approach (approved): one shared rule list that Home only draws.**

| Piece | Where | What |
|---|---|---|
| Needs you rules | new `lib/home/needs_you.dart` | Pure function: My Work view/entries, request entries, tool submitter state, "read" flags → ordered rows (`kind`, title, line, tone, action label, target) + `allRead`. No widgets, no I/O. |
| Sync count | new `lib/home/sync_summary.dart` | Pure function: the four counts + read flags → `hidden` / `allSent` / `notSent(n)`. |
| Needs you card | new `lib/home/needs_you_card.dart` | Draws rows, the 5-row cut and "Show N more", the empty row. |
| Shortcut row | new `lib/home/shortcut_row.dart` | Draws the tiles it is given. |
| Sync badge | new `lib/home/sync_badge.dart` | Draws the pill and the pulsing dot. |
| Sheet | new `lib/ui/wm_sheet.dart` | `showWmSheet(...)` + the header/footer chrome and drag-to-close. |
| Openers | `lib/requests/…`, `lib/workplan/…` | The tab's private "open this entry / open this task / new request" code moves into shared functions; the tabs and Home both call them, so a row opens a request or task **exactly as the tab does**. |
| Attendance waiting count | `AttendanceRepository` + `HomeController` | A local read of `sendable(workerId).length`, refreshed with Home. No server call. |
| "Read once" flags | `MyWorkController`, `RequestsController`, `ToolSubmitter` | A `bool` that turns true after the first finished load (phone store or server). |
| Wiring | `lib/ui/home_shell.dart` | Builds rows and count from the controllers it already owns, passes them to HomeScreen, opens targets, adds the Requests badge, passes tools/agreements to Profile. |
| Home layout | `lib/attendance/home/home_screen.dart`, `lib/ui/worker_header.dart` | Header gets a trailing slot for the badge; the `requestUpdates` slot becomes Needs you + delivery line + shortcuts. |
| Profile | `lib/profile/profile_screen.dart`, `change_password_sheet.dart` | Layout of 7.2; Change password in WmSheet. |
| Notes | `lib/workplan/ui/notes_screen.dart`, `my_work_screen.dart` | Notes content as a sheet. |
| Theme | `lib/ui/theme.dart` | Navigation bar and snack bar themes. |
| Buyer bar | `lib/purchasing/ui/buyer_shell.dart` | Picks up the bar theme; selected icons filled. |
| Retired | `my_work_card.dart`, `request_updates_card.dart`, `tools_card.dart`, `agreements_card.dart` | No callers left after Phase 1; deleted. `request_updates.dart` (the summary) stays. |
| Version | `pubspec.yaml` | `0.12.0+1015`. |

Icons are Flutter's Material Icons (filled and outlined); the mockup's Material Symbols glyphs differ slightly in
drawing, not in meaning. Page entrance animations in the mockup (fade/rise) are not part of Phase 1.

## 10. Later phases (order only; each needs its own spec and approval)

2. **My Work** — Today / Upcoming / Waiting / Done chips with counts; 4-segment bar (Read → Started → Reported done →
   Checked) and a "Next: …" line on each task; the task as a tall sheet with the step tracker and its action in the
   footer; report forms as sheets with a back arrow; swipe a task left for Progress / Problem, with a one-time hint.
3. **Requests** — All / Drafts / Pending sync / Needs attention chips with counts; 3-segment bar (Saved → Sent →
   Received) and status line; request detail as a sheet (Fix and send again / Continue draft / Delete draft); New
   request and drafts as a tall sheet **with every current field** (item editor, units, catalogue, photos, needed-by,
   urgent, team, note, Find previous).
4. **History** — Week / Month switch, compact two-column day cards, "No record" days, the day as a sheet with both
   photos.
5. **Tools and Agreements as sheets** — expandable tool cards (Return / Hand over / Report a problem), leader
   Mine / Team / My records switch, expandable agreement cards; every 0107/0111/0113 rule kept.
6. **Buyer** — shopping-list tick boxes with a "Record purchase (N)" bar and a Record purchase button; My purchases
   groups; Stock / To receive / Recent switch; Record purchase, Received, Issue / move and Leftovers as sheets **with
   every current field**.

## 11. Testing

- **Rules (unit):** each source makes its row with the right words and button; the order of 5.2; a team member's
  request is never a row; pending items are never rows; changed vs new task line; the unreadable/recovery tool row
  appears once; "all caught up" only when every source is read; nothing when unread and empty.
- **Sync count (unit):** each of the four sources counts; 0 with all read → All sent; any unread → hidden; a
  permanently refused attendance submission does not count.
- **Home (widget):** rows render and Read / Check / See / Fix / Finish open the right screen; 6 rows → 5 + "Show 1
  more" → 6 + "Show fewer"; the count bubble shows the full number; the delivery line shows only with a delivery;
  each tile appears only under its rule; worker gets New request and leader gets My proposals; **no agreement amount
  anywhere on Home**; the badge shows All sent / N not sent yet / nothing.
- **Bottom bar (widget):** My Work and Requests bubbles with their numbers; selected tab's filled icon; buyer bar
  unchanged in tabs and keys.
- **Profile (widget):** MINE rows by rule, no amount, buyer has no MINE and no Terms, Log out still signs out.
- **WmSheet (widget):** drag past 110 px closes, a short drag springs back, Back closes, tapping the backdrop closes;
  Meeting notes opens from Home and from My Work; Change password saves, shows errors and returns as before.
- **Existing tests:** those that look for the four old cards (`test/attendance/home/home_screen_test.dart`,
  `test/ui/home_agreements_test.dart`, `test/ui/home_tools_password_test.dart`, `test/ui/screens_test.dart`,
  `test/profile/profile_screen_test.dart`, and any other found by search) are **rewritten to assert the same facts in
  the new places** — never deleted to make the suite pass.
- Full `flutter test` and `flutter analyze` clean on the real tree.

## 12. Acceptance (Phase 1)

1. A worker with a new task, a request to fix and a draft sees three Needs you rows, each with its own button, and
   each button opens the right thing.
2. A team leader with work to check sees a Check row and the My proposals tile instead of New request.
3. With a Time In still on the phone, the badge says "1 not sent yet" — never "All sent".
4. With nothing waiting and every source read, the badge says "All sent" and Needs you says "You are all caught up".
5. With no signal and no saved copy for My Work, Home never says "caught up".
6. Tools off → no My tools tile and no My tools row on Profile. No agreements found → no agreements tile or row.
   No amount appears on Home or Profile.
7. Time In / Time Out, This week and Weekly reward look and behave exactly as in 0.11.1.
8. Meeting notes and Change password open as swipe-down sheets; swipe down, tap outside and Back each close them.
9. The bottom bar shows the new style in both shells with the same tabs, and a red number on Requests when an own
   request needs fixing.
10. All tests and the analyzer pass. The phone pilot (worker + team-leader accounts) and the publish of build 1015 are
    each a separate approval.
11. If Requests' or My Work's storage could not open at start, Home shows no "All sent" and no "caught up", and
    Time In still works.
