# Office portal redesign — cards and pop-up (Attendance, Requests, Work Plan)

**Revision 2 — 16 Nov 2026 · Status:** written for the owner's approval.
**Revision 1 — 14 Nov 2026:** the "triage split view" (variant B of `Dacs Web Admin.dc.html`), approved; Phase 1
(frame + Requests Queue) built on it and committed as `affc4b6`, **not pushed**. Revision 2 replaces its layout.

**Source design:** Claude Design project **"WorkMate app redesign"** (`2b535c62-b68d-47c8-a17e-fc8d5a5d5265`), file
**`Dacs Web Office v5.dc.html`**, with its data files `dacs-data-att.js`, `dacs-data-req.js`, `dacs-data-buy.js`,
`dacs-data-wp.js`. Copied into the repo at **`docs/design/office-v5/`** (checked 16 Nov: the live project and the
export `WorkMate app redesign-handoff (2).zip` are identical). The data files are the designer's screen-by-screen
mapping, made from **`docs/design/office-screens-inventory.md`** (the inventory of every screen as it is today).
Their names, dates and numbers are made up; the real ones come from the existing loaders.

The same project holds v2, v3 and v4. They are **not** the design: v2 is the split view, v3 replaces the top tabs with
a sidebar and adds a Home page, v4 opens a card where it stands.

---

## 1. Intent

The office works three tabs of `admin.html` every day: **Attendance**, **Requests** and **Work Plan**. Today each
screen is a full-width page with its own colours and layout, one item (a request, a worker's day, a task, a meeting,
a purchase) opens as another page, and most forms are pop-ups of their own. Phase 1 turned the Requests Queue into a
list with the item beside it.

v5 makes all of them one pattern:

- **What needs action comes first.** Each screen opens on its "Needs you" tab; tabs carry counts; the top tabs and the
  module links carry red counts.
- **Cards in a grid**, grouped under plain headings, instead of tables and lists. Big, easy targets (44 px buttons,
  rounded pills).
- **One item at a time in a pop-up** over the cards, with **Next** to go through them without closing it.
- **"What to do now"**: each item says, in one sentence, what the office should do with it, and where there is one
  clear next step, the button for it — on the item and on its card.
- **Forms open in the same pop-up**, replacing the item; closing the form goes back to the item.
- **One set of colours** across the three tabs; Requests' five setup screens under one **Setup ▾** menu.

The other top tabs (Project Control, Project Management, Quotations, Appointments, Construction, Users) are not part
of this project.

## 2. Decisions made by the owner

| # | Decision | When |
|---|---|---|
| D1 | **Keep everything.** Every real button, field, state, warning and role rule on today's screens survives, laid out in the new style. Nothing is cut down to what the mockup shows. | 14 Nov 2026 |
| D2 | **One group of screens at a time:** one shared frame, then the screens group by group, each checked in the browser and pushed before the next. | 14 Nov 2026 |
| D3 | **Order:** (1) Requests Queue → (2) Attendance → (3) Work Plan → (4) Purchasing, Stock, Tools → (5) the five Setup screens. | 14 Nov 2026 |
| D4 | **The design is v5** (`Dacs Web Office v5.dc.html`): cards in a grid, the item and its forms in a pop-up, "What to do now". It replaces the split view of revision 1, including its rule "forms open in the panel, not as pop-ups" (inventory §0.7). | 16 Nov 2026 |
| D6 | **All remaining screens in one go** (Attendance, Work Plan, Purchasing, Stock, Tools, Setup), built back to back after the Queue and **checked together at the end** — replaces D2's "each group checked and pushed before the next" for these groups. The owner accepted that a problem could touch several screens at once. | 16 Nov 2026 |
| D5 | **v5's counts, limited to what the account can act on** (§6.1): red always means "you can act on this". A count at zero shows no badge; a top tab's count is the sum of the link counts that account sees. Fallback if it feels too red in use: secondary counts (Hours report, Meetings, Item history) in neutral grey, red kept for Today on site, Queue, Board and approvals — **not built unless the owner asks**. | 16 Nov 2026 |
| D7 | **Attendance is rebuilt as v5 cards**, not just framed: the owner saw Today on site still showing its old tiles and table inside the new header and chose "Attendance first" — all five Attendance screens plus App updates as cards with pop-ups, checked before the other kept-inside screens (Purchasing's owner tabs, Stock → Waiting, Teams, Item history) are touched. Plan: `docs/superpowers/plans/2026-11-16-office-v5-attendance-cards.md`. | 16 Nov 2026 |
| D8 | **Today on site's red count leaves out "Absent?"**: the crew still records attendance in Messenger, so every worker reads Absent? every day. The count (and the Needs you tab and tile) holds only what the office can settle: a day that never timed out once the day is over, and a location problem. Absent workers stay listed under **Absent?** and **Everyone**, with no red number. | 16 Nov 2026 |

## 3. Goals, non-goals, anti-goals

**Goals**
- All 17 screens look and work like v5: header, tiles and help where the design has them, tabs with counts, cards,
  the pop-up with "What to do now", forms in the pop-up, Next.
- Each existing drill-down page becomes the pop-up of its screen; links to an item still land on it.
- The modules row gets the **Setup ▾** menu; the three top tabs and their main module links get "needs you" counts.
- Works at phone width (≤ 720 px).

**Non-goals**
- The other six top tabs, the portal's top bar (logo, top tabs, bell), v3's sidebar and Home page.
- Any server, RLS, migration or data change. **This is drawing only**: every screen keeps its data loading, server
  calls and checks.
- New features. Actions the mockup draws that the system does not have are **not** built (§8).
- The WorkMate phone app.

**Anti-goals — the project has failed if any of these happen, even if the screens look right**
- A screen loses a button, field, state, warning, confirmation, reason box or typed-confirmation step it has today.
- Anyone sees an amount they cannot see today — through a card, a tile, a count, a pill, a tooltip, a "What to do
  now" sentence or the pop-up. Staff never see pesos outside the Purchasing / Project Control exceptions in
  `CLAUDE.md`; Stock and Tools never show a peso to anyone except where `stock-cost-admin.js` already does (owner
  accounts); non-buyers never reach Purchasing; Weekly bonus amounts stay owner-only.
- A "What to do now" or card button **does something no button does today**, or does it for more than the one line it
  names (e.g. arranges every line of a request).
- An account narrowed by `allowed_modules` (e.g. `admin-pm@`, a Purchasing-, Stock- or Tools-only account) loses a
  screen it can open today, or gains one.
- A phase ships half its screens converted. An existing fence test is deleted or weakened to get green.

## 4. Approaches considered

Revision 1 chose **one shared frame, then screen groups in phases** (D2) over building all 17 at once (one huge
change, nothing ships for weeks) and over putting today's pages inside a frame unchanged (cramped, no counts). That
still holds. For v5:

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| **A** | **Change Phase 1's shared frame** (`js/split-view.js`, `css/split-view.css`) to draw cards and the pop-up; screens keep handing it the same tabs, groups, rows and item content. Redo the Queue on it first. | The Queue is redone before Attendance starts; Phase 1's split view is never pushed on its own. | **Chosen (builder's call, only sensible way)** — Phase 1's data work (rows, item content, forms, counts, Setup menu) carries over; one frame keeps 17 screens alike. |
| B | Keep the Queue as the split view, build the other screens in v5 | No rework now, but the office gets two different layouts side by side | Rejected |
| C | A new frame file beside the old one, move screens over one by one | Two frames to keep in step for weeks | Rejected |

## 5. Where things are today

| Group | Views (ids unchanged) | Code | Styles | Fences |
|---|---|---|---|---|
| **Frame (Phase 1)** | — | `js/split-view.js` (`SplitView.render / panelHtml / form / fill / section / notice / facts / history / error`, `NavCounts`) | `css/split-view.css` | `tests/split-view.test.js` |
| Requests Queue (Phase 1, split view) | `reqQueue`, drill-down `reqDetail` | `js/requests-admin-core.js`, `-queue.js`, `-detail.js`, `-gallery.js` | `css/requests-admin.css` | `tests/requests-admin.test.js`, `workmate-requests-office.test.js` |
| Attendance | `attToday`, `attWorkers`, `attProjects`, `attReports`, `attRewards`, `attAppUpdates` (owner only), drill-down `attWorker` | `js/attendance-admin.js` (≈270 KB), `js/app-updates-admin.js` | `css/attendance-admin.css` | `tests/attendance.test.js`, `app-updates.test.js`, `worker-password.test.js`, `workmate-3b-web.test.js` |
| Work Plan | `wpBoard`, `wpMeetings`, drill-downs `wpTask`, `wpMeeting` | `js/workplan-admin-core.js`, `-board.js`, `-task.js`, `-meetings.js`, `-form.js` | `css/workplan-admin.css` | `tests/workplan-admin.test.js`, `workplan-screens.test.js`, `ai-worker.test.js` |
| Purchasing / Stock / Tools | `reqPurchasing`, drill-down `reqPurchase`, `reqStock`, `reqTools` | `js/purchasing-admin-*.js` (6 files), `js/reconciliation-admin.js`, `js/stock-admin.js`, `js/stock-cost-admin.js`, `js/tools-admin.js` | `css/purchasing-admin.css`, `css/requests-admin.css` | `purchasing-admin.test.js`, `purchasing-payments-screens.test.js`, `reconciliation-admin.test.js`, `stock-admin.test.js`, `stock-cost-admin.test.js`, `tools-admin.test.js` |
| Setup | `reqBatches`, `reqTeams`, `reqCatalog`, `reqHistory`, `reqProjects` | `js/requests-admin-setup.js`, `-history.js` | `css/requests-admin.css` | `requests-admin.test.js` |

Chrome: `PRIMARY_NAV`, `_FOCUS_SUBVIEWS`, `_visibleNav()`, `_buildTabsBar()`, `syncPortalChrome()` in `js/admin.js`
(Phase 1 already added the Setup ▾ menu and the `NavCounts` badges); `ATT_VIEWS` / `REQ_VIEWS` / `WP_VIEWS` and
`switchView()` in `admin.html`; shared tokens in `css/admin-renovation.css` (already the design's palette and fonts).

The "needs you" rules already exist in the pure core modules and are the source of truth for counts and for "What to
do now": `attention()` in `attendance-admin.js`, request states in `requests-admin-core.js`, board groups in
`workplan-admin-core.js`. **Where the mockup's rule and the code's rule differ, the code wins.**

Uncommitted in the working tree (16 Nov): two Phase 1 fixes seen live on 14 Nov — `.sv-panel-body > * { flex-shrink:
0 }` (long items squeezed to nothing) and a "▸ Show / ▾ Hide" marker on a folded History — with their tests. Both
lessons carry into the pop-up (§6.4).

## 6. The design

### 6.1 Modules row and counts (unchanged from revision 1, built in Phase 1)

- Requests' links: **Queue · Purchasing · Stock · Tools · Setup ▾** (Weekly batches, Teams, Catalogue, Item history,
  Projects). An open setup screen highlights Setup and shows its name. One or no visible setup item → no menu.
  `_visibleNav()` returns the same modules for every role and focus; only the drawing groups them.
- **Red counts on module links (D5)** — each counts only for accounts that can clear it:

  | Link | Counts | Who sees the count |
  |---|---|---|
  | Today on site | items in its "Needs you" tab | everyone who sees the link |
  | Hours report | days waiting for a time out | everyone who sees the link |
  | Queue | requests in "Needs action" | everyone who sees the link |
  | Purchasing | changes waiting for the owner's approval | owner accounts (who can approve) |
  | Stock | counts and opening stock waiting for the owner | the main owner |
  | Tools | Lost reports and Retire requests waiting for the owner | the main owner |
  | Item history | photos to review | everyone who sees the link |
  | Board | tasks in "Needs you" | everyone who sees the link |
  | Meetings | meetings with draft tasks waiting | everyone who sees the link |

  Where the code's rule for "who can act" differs from this table, the code wins (e.g. the main-owner test is role
  owner, `owner_id` null, active — never `allowed_modules`).
- **A count at zero shows no badge** — no grey badge, no "0". A failed count also shows no badge, never a wrong one.
- **A top tab's count (Attendance, Requests, Work Plan) is the sum of the link counts that account sees** under it,
  so the numbers always add up; a link whose count failed adds nothing.
- A link's count appears when its phase ships (Queue: Phase 1; Today, Hours report: 2; Board, Meetings: 3;
  Purchasing, Stock, Tools: 4; Item history: 5). Counts are numbers of items, never amounts; only sections in the
  account's visible nav are fetched. The Construction bell stays as it is.

### 6.2 The screen (every converted screen)

Measurements are v5's. Content column max **1280 px**, side padding **32 px** (14 px on a phone), page background
`#F5F5F5`. Top to bottom, each part optional:

1. **Header:** Playfair title 30 px · grey sub-line 15 px (max 760 px) · a **segmented switch** where the design has
   one (e.g. By site / Full list) · **More (…)** button (44 px outlined pill) with a menu · **primary button** (44 px
   green pill; a "+" icon when it adds something). Secondary actions that sit in toolbars today go into More, never
   away.
2. **Switched-off state** (Stock, Tools): one dashed card with the title, the sentence and the switch-on button.
3. **Tiles:** a grid of count tiles (26 px mono number + label); clicking one opens its tab. Amount tiles only where
   the account sees amounts today.
4. **Lede:** the screen's status sentence (16 px). **Strips:** green info boxes for standing rules. **"How …"**: a
   collapsed card for explanations and legends that are text today.
5. **Tabs:** pill buttons (44 px) with a count bubble; a "Needs you" tab's count is red when above 0. The first tab is
   "Needs you" / "Needs action" where the screen has one. Under the tabs: the Queue's **This week** box, then one line
   explaining the current tab.
6. **Toolbar row:** search box (pill, up to 380 px; filters the cards in the browser unless the screen searches the
   server today), the tab's own buttons, its filters (selects, dates, checkboxes), "Showing X of Y". Then a tab note
   and a colour legend where the design has them.
7. **Groups:** a heading (16 px bold, red for problem groups) "· count", an optional grey line under it, then the
   cards in a grid (min 300 px a column, 12 px gap).
8. **Card:** white, 1.5 px border, 18 px corners, 16 px padding.
   - Top line: tick box (only where ticking exists today, e.g. Shopping list) · status pill · chips · the mono figure
     on the right (time, quantity, date, day count — an amount only where that account sees amounts today).
   - Title (17 px semibold), sub-line (2 lines at most), grey meta line, day dots where the design has them (Weekly
     bonus Mon–Fri).
   - Bottom: the **next-step button** (§6.3) when there is one, and **Open ›**.
   - Urgent: red bar on the left. Finished or older: dimmed. The open card: green border and shadow. Hover lifts it.
     A card is a keyboard target: Enter or Space opens it.
9. **Empty:** a dashed card with a tick icon and the screen's empty sentence (all kept from today), plus **Clear
   filters** when a search or filter caused it.
10. **Ticked-items button** (Shopping list): a sticky green button at the bottom, "Record purchase (N)", shown once N
    > 0.

### 6.3 "What to do now"

- An item may carry one **next step**: a sentence, and at most one button.
- **The button appears only when the item has exactly one obvious next step that is an existing action** — the same
  function a button inside the item already calls, for the same line. Otherwise the box shows the sentence alone (e.g.
  "One item has an offline edit that needs your decision. Choose Apply or Keep on item 3."). No next step → no box.
- The sentence comes from the code's own rules (`attention()`, request states, board groups, …), worded as the
  design words it; rule-bearing wording stays exact (§9).
- The same button sits on the item's card. Pressing it **opens the item in the pop-up and starts that action** there:
  a form opens in the pop-up; a one-press action (e.g. Mark arranged on a request with a single portion to arrange)
  runs as it does today from inside the item, with its saving state and errors.
- Examples from the design, all subject to the rule: overdue request with one portion → Mark arranged; reduction →
  Resolve reduction…; passed batch → Move…; never timed out → Close this day; leader checked → Approve — completed;
  draft or proposal → Publish; receiving → Received…; tools to register → Register…; photo to review → Approve a
  copy…; Cover → Cover is right…; bills → Bill checked….

### 6.4 The pop-up (items)

- **Clicking a card opens its item in a pop-up** centred over the page: max **780 px** wide, 22 px corners, dark scrim
  behind, the page does not scroll behind it. On a phone (≤ 720 px) it fills the screen.
- Close: **✕** (round, top right), **Escape**, or a click on the scrim. Clicking the open card again also closes it.
  Changing tab closes it.
- **Head:** kicker (uppercase grey), Playfair title 26 px, pills.
- **Body** (scrolls; its sections never shrink): sub-line · **What to do now** box (green) · notice boxes (red / gold
  / green / grey) · the item's sections in the design's building blocks — facts table, text, info note, **lines**
  (cards with their own pills, red note, facts and small buttons: request items and weekly portions, problems, people,
  lots, records), photos (click = full size), tables, switches, **History** (folds above 6 entries with "▸ Show / ▾
  Hide", as Phase 1 learned).
- **Footer** (light grey): the item's buttons on the left, **Next ›** on the right. Next goes to the card that was
  after this one when it was opened, even if an action moved this one to another group; the pop-up stays open.
- **Nothing opens by itself** on a desktop (the split view showed the first row; v5 shows cards until one is clicked).
- **Links to an item** (`switchView('reqDetail' | 'attWorker' | 'wpTask' | 'wpMeeting' | 'reqPurchase')` after
  setting the item id) open the parent screen with that item's pop-up; if the item is not in the current tab, the tab
  that holds it (or "All"). The view ids stay in `_FOCUS_SUBVIEWS` and the `*_VIEWS` groups.
- A re-render of the screen behind (search, a refresh after an action) keeps the open pop-up, its scroll and an open
  form untouched; only a refresh of that item redraws it, keeping its scroll.
- Focus moves into the pop-up when it opens, Tab stays inside it, and goes back to the card when it closes.
- The browser Back button behaves at least as well as in Phase 1.

### 6.5 Forms in the pop-up

- A form replaces the item in the pop-up: **"← Back without saving"** link · Playfair title 24 px · intro sentence ·
  red warning box where there is one · fields (44 px inputs) with their help lines · a **typed-confirmation box**
  (pink) where today has one · the error line · footer **Save** (green, wording of today's button) · **Cancel**.
- Back, Cancel and Escape return to the item (Escape closes the form first, then a second Escape closes the pop-up).
  Saving returns to the item, redrawn. Opening a form keeps the page's scroll position; closing restores it.
- On a screen-level action with no item (Add a worker, New task, Issue / move, Register tools, Record purchase…) the
  form opens in the pop-up on its own.
- **Every existing guard stays:** reason boxes, the temporary-password warning and its worker-number confirmation,
  the App-updates file check and its separate "will be BLOCKED" confirm step, "Type OFF / STOCK / TOOLS / the word"
  steps, double-press protection with "Saving…" wording, Add Expense's save-once machinery where it is reached. A
  confirmation that is its own step today stays its own step (a second state of the pop-up).
- A large form (Record purchase, New task, Schedule) scrolls inside the pop-up; it keeps all its parts. A step that
  today opens a further page (Record purchase from the Shopping list) opens in the pop-up instead.
- Photo and receipt viewers stay as they are (their own overlay above the pop-up).
- **Existing forms keep their code (builder's call, 16 Nov).** Every remaining screen opens its forms through the
  same `att-modal` markup (`RA.modal`, Work Plan's `modal`, Attendance's own builders). Rather than rewriting ~80
  forms, the frame restyles `.att-modal` to the v5 form (same box, scrim, title, footer) and, while one is open over
  an item, hides the item underneath so the form takes its place; closing the form shows the item again exactly as
  it was. The pop-up leaves Escape and Tab to an open form. Every field, check, wording and guard of those forms is
  untouched. (The Queue keeps its `SplitView.form` forms.)
- **Existing item pages keep their content (builder's call, 16 Nov).** A drill-down page (one purchase, one task,
  one meeting, one tool, one stock item, one worker's day, one history item) renders its existing content into the
  pop-up through a frame shell that adds ✕, the "What to do now" box where the screen has a single next step, and
  the footer with Next; the page's own "← back" link is dropped (✕ replaces it).
- After a successful save a short **toast** at the bottom says what was done (the design's wording, e.g. "Marked 10 pcs
  arranged"); errors stay inside the form.

### 6.6 Phone width (≤ 720 px)

Cards in one column, header and toolbar wrap, tabs scroll sideways, the pop-up fills the screen with ✕ at the top
right, Next still works, forms full screen. The Setup menu and More open as full-width menus.

### 6.7 Roles and amounts

The frame knows nothing about money and never draws an amount of its own. Each screen keeps its role checks
(`currentUserRole`, `currentCanBuy`, buyer scope, `currentStockOn` / `currentToolsOn` and the main-owner variants,
`_hideStockCost`, owner-only App updates and bonus amounts). A card's figure, a tile, a count or a "What to do now"
sentence is never an amount where the account cannot see amounts today. The design's data files mark owner-only
values (`'ow'`, `'mo'`) — those marks match today's rules and are a check list, not a source of truth.

## 7. Per-screen layout

The design's data files (`docs/design/office-v5/dacs-data-*.js`) give, for every screen, the header, tiles, tabs,
groups, card lines, item sections, buttons and forms. **Each phase starts by checking its screens against the
inventory and the code**: every item in the inventory must have a place; where the design and the code disagree on a
rule, the code wins; what does not fit the design's slots still goes somewhere visible. Summary:

| Screen | Header (primary · More · switch) | Tabs (first = default) | Cards / groups | Item pop-up |
|---|---|---|---|---|
| **Requests → Queue** | — · This week box · How: what the labels mean | Needs action · Urgent · To resolve · To arrange · Arranged · All open · Closed | Urgent · Cutoff (this week) · Waiting on the office · Nothing left to arrange · Closed; card: requester · project, items, work · team · N items, received day, status, urgent/overdue chip | Summary, note, items as lines (offline edit, Apply/Keep, Match/Change, Change quantity…, Cancel item…) with their weekly portions (Mark arranged, Move…, Undo arranged, Resolve reduction…), facts, photos, history |
| **Attendance → Today on site** | Download for Excel · More: Refresh, Pick another day…, Add a worker · By site / Full list | Needs you · Everyone · On site · Absent? · Finished | tiles Expected / On site / Finished / Absent? / Needs you; lede; quiet sites strip; by site (crew, Costing job / Site works) or by status | one worker's day: summary, notice, the day facts, two photos, location check, explanations; Close this day, Print this day |
| **Attendance → Workers** | Add a worker · More: Refresh | Can use the app · Switched off · All | worker, number · job, signs in with, Yes / Switched off | details; Edit details, Switch off / back on, Make / Remove Team Leader (main owner), Set temporary password (main owner) |
| **Attendance → Sites & schedule** | More: Refresh · How this page works | All · Custom schedule · Hidden · Has closed days | site, days · due, closed days · here today, Costing job / Site works, Visible / Hidden | schedule facts and notes; Set / Change the schedule, Location…, Closed dates…, Hide / Show |
| **Attendance → Hours report** | More: the two Excel exports · period filters | Waiting for a time out · By worker · By site | tiles; lede; "not a basis for pay" strip | worker or site hours; Close this day; Open this worker's day |
| **Attendance → Weekly bonus** | More: Week before, Week after, Download the list · running / final week | running: On track · At risk · No bonus · Everyone; final: Not handed over yet · Earned · No bonus · Everyone | tiles (amounts owner only); lede (staff wording without pesos); legend; day dots; "Record only, no payments" | Mon–Fri, result (amount owner only); Mark as handed over |
| **Attendance → App updates** (owner) | Publish a new version | All · DAC'S WorkMate · DACS Attendance | lede: live versions; one card per version | version facts; publish = file check, then the separate confirm step |
| **Work Plan → Board** | New task · How a task moves · project filter | Needs you · In progress · Drafts · Completed · All | Waiting for your check · Blocked · Not acknowledged after 24 h · Overdue · Not started and in progress · Drafts and proposals · Completed (30 days) | problems and waiting (Clear…, Open), instructions, meeting notes, photos, people, facts, history; Approve — completed, Send back, Publish, Reopen, Edit, See its meeting, Cancel this task… / Decline this proposal… |
| **Work Plan → Meetings** | New meeting · More: Board | Needs you · All meetings | meeting, held on, tasks, published / not | notes, AI drafts, tasks from the meeting, shared notes, recipients, published versions; Save notes, Draft tasks with AI / Draft again, Add task, Publish… |
| **Requests → Purchasing** (buyers) | per tab: Purchase with no request, Give petty cash…, Daily report…, Print | Shopping list · Purchases · Owner approvals · Cash · Company stock (owner) · Reconciliation (owner) | ticked shopping cards + sticky Record purchase (N); purchases; approvals Waiting / Decided; cash sections; company stock; reconciliation sections | request line (figures, portions, I'll buy this, Assign…, Release, Mark arranged); purchase (lines, office review, receipts, payments, refunds, history); approval; buyer details; each with today's forms |
| **Requests → Stock** | Issue / move · More: Record leftovers, Count, Opening stock, Match a project purchase line…, Switch stock off… (main owner) | Stock · Receiving · Waiting for owner · History | items with places; receiving lines; waiting records; records | item (places, lots, history); receiving line; record with its stock cost moves (value owner only; Approve / Reject / Reverse cost main owner; Ask again) |
| **Requests → Tools** | Register tools · More: Switch tools off… (main owner) | Tools · Out · To register · Waiting for owner · Problems (+ Show closed) | tools by number with state and where | photo, facts, records; buttons by state (Issue…, Hand over…, Return…, Repaired…, Ask to retire…, Report lost…, Found…, Confirm / Reject / Withdraw / Reverse) |
| **Setup → Weekly batches** | strip: the cutoff rule | This week · Upcoming · Closed · All | batches | dates; Change dates…, View in queue |
| **Setup → Teams** | New team · tiles | Active teams · Show inactive · All | teams, leader, members | members as lines (Make leader, Remove, Remove as leader); Add members, Rename or deactivate, Clear leader mark |
| **Setup → Catalogue** | New item | All · Materials · Tools · Inactive | items, kind · unit · category | item facts, Active switch (with its confirm); Edit… |
| **Setup → Item history** | — | Photos to review · Search items (with its filters and Search / Show more) | photos to review; items | photo: Approve a copy…, Keep private; item: photos, history table, Upload photo…, Add / Retire historical reference… |
| **Setup → Projects** | tiles · How this works | All · Open in WorkMate · Closed | projects, status, override chip | status, Allow requests override and Item history switches |

## 8. What the mockup draws that is not built, or changes

Not built (anti-goal: no new features under cover of a layout change); each phase lists what it finds for the owner:

- **"Mark arranged" for a whole request** with more than one line or portion (the design's Queue card and "What to do
  now"). That is "Mark all arranged", which does not exist. Those requests get the sentence without a button.
- Any design button with no existing function behind it.

Kept, in a new place (the owner should know):
- Attendance → Today's "Needs you" panel becomes the **Needs you** tab (every item and sentence kept); the day picker
  moves into More ("Pick another day…").
- Sites & schedule's **Table / Cards** switch goes: the cards carry every column of the table.
- Filter chips with counts (Today, Sites) become tabs with counts.
- The Schedule form's three inner tabs (Working days & time, Location, Closed dates) become three buttons on the
  site, each opening its own form; their separate save buttons and the "Discard the changes…" question stay.

Already exist, so they are kept (the inventory confirms): Move… a request line to another batch, tools Found…,
receiving Not delivered…, Hours report Close this day, the Catalogue's Active switch.

## 9. Calls made for the owner to check

- **Next-step buttons** only where there is exactly one existing next step (§6.3); otherwise the sentence alone.
- A card's next-step button **opens the item and starts the action**; a one-press action runs at once, as it does from
  inside the item today.
- **Phase 1 is redone first**: the frame changes to cards and the pop-up, the Queue moves onto it; Phase 1's split
  view (`affc4b6`) is not pushed on its own — the redone Queue is what gets checked and pushed.
- **Phone:** one column of cards; the pop-up fills the screen with ✕; Next works.
- **Nothing opens by itself**; a link to an item opens its pop-up.
- **Toast** after a successful save.
- **Bell** unchanged; **counts** appear per phase (§6.1); **default tab** = "Needs you" when it has items, else the
  next tab with items (as Phase 1).
- **Wording:** layout labels follow the design; every label that carries a rule keeps its current wording — "Stock
  cost move", "Cover is right", "Bill checked", the temporary-password text, the App-updates "will be BLOCKED" warning,
  "Record only, no payments", "Hours record attendance — not a basis for pay", "Closing a day records no hours and
  changes no pay", and every "Type … to confirm" step.

## 10. Constraints for the builder

- Plain HTML + vanilla JS, **no build step**; never `npm run build`. Bump the `?v=` on every changed script and
  stylesheet tag in `admin.html`.
- Tests read source and fence rules. Update their extraction markers when code moves; **never delete a fence**.
  `npm test` and `node --check` on every changed file before a phase is called done; CI must be green.
- Keep pure logic in the `*-core.js` modules and the pure half of the frame (both `require`d by tests). The frame
  stays one small shared file that screens call with their tabs, groups, rows and item content, so the 17 screens
  cannot drift apart.
- Remove a module's old CSS only once nothing uses it. `.req-detail` is still used by Purchasing / Stock / Tools.
- The working tree also holds changes that are not this project's (`admin.html` indent at the lucide line,
  `docs/superpowers/plans/2026-11-09-pm-staff-entry-permissions.md`). The owner commits and pushes; the builder does
  not, and keeps those out.
- `admin.html` only — the client and partner portals are not involved.

## 11. Each phase is done when

1. Its screens are checked against the inventory and the code (§7): every item placed, rule differences resolved in
   the code's favour, mockup-only actions listed.
2. Its screens are converted completely; the old drill-down pages are gone and their view ids still route.
3. `node --check` on changed files, `npm test` green, fences updated not removed.
4. Checked in the browser on live data with the owner account, a staff account, a buyer account (Phase 4) and a
   focused account (`admin-pm@`, a Purchasing / Stock / Tools-only account where relevant): every inventory item
   found and working, no amount where there was none. **Real records are looked at, never acted on.** Buttons that
   write are pressed only on **ZZ test records**, under a step list the owner approves first, and cleaned up by a
   named marker.
5. Phone width checked.
6. The owner has seen it and pushed it; CI green.

## 12. Left to the builder

The frame's file and function names (renaming `split-view` is optional); exact CSS within the design's measurements;
how the pop-up keeps its element across re-renders; search matching; keyboard shortcuts beyond Escape / Enter / Tab;
how count fetches are batched; whether Purchasing / Stock / Tools ship as one phase or three (each still finishes
completely); whether emptied drill-down containers in `admin.html` are removed or left in place; a wider pop-up (up
to ~1040 px) for the largest forms (Record purchase, New task) if their parts do not fit 780 px; how Weekly bonus's
week navigation (any week today) maps onto the running / final switch and More; keeping a meeting's unsaved AI
suggestions at least as long as today when its pop-up is closed and reopened in the same tab.
