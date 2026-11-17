# Office portal redesign — triage split view (Attendance, Requests, Work Plan)

**Date:** 14 Nov 2026 · **Status:** approved by the owner 14 Nov 2026; Phase 1 (frame + Requests Queue) built
**Source design:** `WorkMate app redesign (1).zip` → `Dacs Web Admin.dc.html`, variant **B — "Triage split view"**
(marked *Chosen* in `Dacs Web Redesign.dc.html`). `Dacs Web Detail.dc.html` is the right-hand panel.
`Dacs Web Current.dc.html` is the designer's rebuild of today's portal, for reference only.

---

## 1. Intent

The office works three tabs of `admin.html` every day: **Attendance**, **Requests** and **Work Plan**. Today each
screen is a full-width page, a single item (one request, one worker's day, one task, one meeting, one purchase) opens
as **another page**, and most forms are **pop-ups**. Each module also has its own colours and layout.

The design turns all of them into one pattern, like an inbox:

- **What needs action comes first.** Each screen opens on a "Needs you" tab; tabs carry counts; the top tabs and the
  module links carry red counts.
- **One set of colours** across the three tabs (green done, gold to-do/waiting, red problem, blue checks).
- **Details open beside the list**, never on a new page — the office works down the list with **Next**.
- **Forms open in that same right-hand panel**, not as pop-ups.
- **Requests' five setup screens** (Weekly batches, Teams, Catalogue, Item history, Projects) move under one
  **Setup ▾** menu in the modules row.

The other top tabs (Project Control, Project Management, Quotations, Appointments, Construction, Users) are **not**
part of this project. The design says they come next, in the same layout.

## 2. Decisions already made by the owner

| # | Decision | When |
|---|---|---|
| D1 | **Keep everything.** Every real button, field, state, warning and role rule on today's screens survives, laid out in the new style. Nothing is cut down to what the mockup shows. | 14 Nov 2026 |
| D2 | **Approach A:** build one shared split-view frame, then convert the screens **one group at a time**, each group checked in the browser and pushed before the next. | 14 Nov 2026 |
| D3 | **Order:** (1) Requests Queue → (2) Attendance → (3) Work Plan → (4) Purchasing, Stock, Tools → (5) the five Setup screens. | 14 Nov 2026 |

## 3. Goals, non-goals, anti-goals

**Goals**
- All 17 screens below look and work like variant B: header line, tabs with counts, list on the left, panel on the
  right, forms in the panel, Next.
- Each existing "drill-down page" becomes the right-hand panel of its list.
- The modules row gets the **Setup ▾** menu; Attendance / Requests / Work Plan tabs and their main module links get
  "needs you" counts.
- Works at phone width (see §6.6).

**Non-goals**
- The other six top tabs. Variant A (the full-width page with a slide-in drawer).
- Any server, RLS, migration or data change. **This is drawing only**: every screen keeps its current data loading,
  server calls and checks.
- New features. Actions the mockup draws that the system does not have today are **not** built here (§8).
- The WorkMate phone app.

**Anti-goals — the project has failed if any of these happen, even if the screens look right**
- A screen loses a button, field, state, warning, confirmation or reason box it has today.
- Anyone sees an amount they cannot see today — through a list row, a count, a pill, a tooltip or the panel.
  Staff never see pesos outside the Purchasing/Project Control exceptions in `CLAUDE.md`; Stock and Tools never show
  a peso to anyone except where `stock-cost-admin.js` already does (owner accounts); non-buyers never reach Purchasing.
- An account narrowed by `allowed_modules` (e.g. `admin-pm@`, a Purchasing-only / Stock-only / Tools-only account)
  loses a screen it can open today, or gains one it cannot.
- A phase ships half its screens converted. Each phase finishes the screens it names.
- An existing fence test is deleted or weakened to get green.

## 4. Approaches considered

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| **A** | Shared frame once, then convert screen groups in phases, each checked and pushed | For a few weeks some screens are new and some old | **Chosen (D2)** — a mistake only ever touches one group |
| B | Build all 17, switch over in one go (old/new toggle) | No mixed look, but one huge change over ~30 files, nothing ships for weeks, two code paths meanwhile | Rejected |
| C | Put today's pages inside the new frame unchanged | Cheapest, but full-width pages are cramped in a panel and there is no "Needs you" grouping, counts or shared colours | Rejected |

## 5. Where things are today

| Group | Views (ids unchanged) | Code | Styles | Fences |
|---|---|---|---|---|
| Requests Queue | `reqQueue`, drill-down `reqDetail` | `js/requests-admin-core.js`, `-queue.js`, `-detail.js`, `-gallery.js` | `css/requests-admin.css` | `tests/requests-admin.test.js`, `workmate-requests-office.test.js` |
| Attendance | `attToday`, `attWorkers`, `attProjects`, `attReports`, `attRewards`, `attAppUpdates` (owner only), drill-down `attWorker` | `js/attendance-admin.js` (≈270 KB), `js/app-updates-admin.js` | `css/attendance-admin.css` | `tests/attendance.test.js`, `app-updates.test.js`, `worker-password.test.js`, `workmate-3b-web.test.js` |
| Work Plan | `wpBoard`, `wpMeetings`, drill-downs `wpTask`, `wpMeeting` | `js/workplan-admin-core.js`, `-board.js`, `-task.js`, `-meetings.js`, `-form.js` | `css/workplan-admin.css` | `tests/workplan-admin.test.js`, `workplan-screens.test.js`, `ai-worker.test.js` |
| Purchasing / Stock / Tools | `reqPurchasing`, drill-down `reqPurchase`, `reqStock`, `reqTools` | `js/purchasing-admin-*.js` (6 files), `js/reconciliation-admin.js`, `js/stock-admin.js`, `js/stock-cost-admin.js`, `js/tools-admin.js` | `css/purchasing-admin.css`, `css/requests-admin.css` | `purchasing-admin.test.js`, `purchasing-payments-screens.test.js`, `reconciliation-admin.test.js`, `stock-admin.test.js`, `stock-cost-admin.test.js`, `tools-admin.test.js` |
| Setup | `reqBatches`, `reqTeams`, `reqCatalog`, `reqHistory`, `reqProjects` | `js/requests-admin-setup.js`, `-history.js` | `css/requests-admin.css` | `requests-admin.test.js` |

Chrome: `PRIMARY_NAV`, `_FOCUS_SUBVIEWS`, `_visibleNav()`, `_buildTabsBar()`, `syncPortalChrome()` in `js/admin.js`;
`ATT_VIEWS` / `REQ_VIEWS` / `WP_VIEWS` and `switchView()` in `admin.html`; shared tokens in `css/admin-renovation.css`
(already the design's palette and fonts: `--brand-green #1A5C3A`, Barlow / Playfair Display / IBM Plex Mono).

The "what needs you" rules already exist in the pure core modules and are the source of truth for counts:
`attention()` in `attendance-admin.js`, request states (`conflict` "Needs resolution", `reduction` "Reduction to
resolve", urgent / overdue) in `requests-admin-core.js`, board groups (`check`, `blocked`, `unacked`, …) in
`workplan-admin-core.js`. **Where the mockup's rule and the code's rule differ, the code wins.**

Drill-downs are opened from code by `switchView('reqDetail' | 'attWorker' | 'wpTask' | 'wpMeeting' | 'reqPurchase')`
after setting a state id (`requests-admin-core.js:478`, `attendance-admin.js:4059`, `workplan-admin-core.js:495-496`,
`purchasing-admin-core.js:805`) — other screens link in this way.

## 6. The design

### 6.1 Modules row — Setup menu

- Requests' module links become: **Queue · Purchasing · Stock · Tools · Setup ▾**. Setup opens a small menu with
  Weekly batches, Teams, Catalogue, Item history, Projects. While one of those is open, the Setup link is highlighted
  and reads that screen's name (as in the mockup).
- Driven by data: a `group: 'setup'` (or similar) marker on those `PRIMARY_NAV` modules. **`_visibleNav()` keeps
  returning the same modules for every role and focus**, so `purchasing-admin.test.js`'s nav checks keep passing;
  only the drawing groups them. If only one or no setup item is visible to an account, no menu is drawn.
- Applies from Phase 1 (it is chrome), even though the setup screens themselves are redrawn in Phase 5.

### 6.2 Counts on tabs

- A count badge on the **Attendance**, **Requests** and **Work Plan** top tabs, and on their main module link
  (Today on site, Queue, Board), = the number of items in that screen's "Needs you" tab, for **this account**.
- A section's count appears **when its phase ships** (Phase 1: Requests only). Counts are numbers of items, never
  amounts.
- Counts are fetched in the background after the portal opens, using the modules' existing loaders, and refreshed
  when the section is opened or an action changes it. **Only sections in this account's visible nav are fetched**
  (an `admin-pm@` account loads nothing extra). A failed count shows no badge — never a wrong one.
- **The existing bell stays as it is** (it is the Construction notifications bell, `consNotificationBell`). The
  mockup's "needs total" bell is not added; the tab counts carry that job. *(Builder's call recorded here; see §9.)*

### 6.3 The screen frame (every converted screen)

Top to bottom, inside the content area (max width 1440px, as today):

1. **Header line:** Playfair title · one short grey line · optional live chip (where the screen refreshes itself
   today) · optional **More (…)** menu · optional **primary button** (green). Secondary actions that live in toolbars
   today go into More (…), never away.
2. **Tabs with counts** (underline style, count pill; red-tinted count on a non-active "needs" tab). The first tab is
   "Needs you" / "Needs action" where the screen has one. The design's per-screen tabs are in §7.
3. **Split:** list on the left (**440px**), panel on the right (rest), both scroll on their own, filling the window
   height below the header.

**List (left):** a search box (filters the list in the browser), then **sticky group headers** (uppercase, colour =
group tone, count on the right), then rows: bold title, grey sub-line, optional chips; on the right a mono figure
(time, quantity, date) over a status pill. The selected row is tinted with a green left bar. Empty list: the all-clear
("Nothing here. You're done.").

**Panel (right)** — the order of `Dacs Web Detail.dc.html`, every section optional:

1. Kicker (mono, uppercase) · Playfair title · grey sub · pills.
2. Notice box (red / gold / green / grey with icon, title, body).
3. Form fields (when a form is open).
4. Photos (two-up cards).
5. Text block (instructions, notes, "what's new").
6. Lines (items with their own pill, note and buttons — request items, days, people, places).
7. "Waiting for" blockers (red cards with **Clear…**).
8. Facts table (label / value; mono for times, quantities, numbers).
9. History (dot timeline).
10. **Footer bar:** action buttons on the left, **Next ›** on the right (next row of the current list order).

**Pill palette** (from the design; one map for all three tabs):

| Tone | Background / text | Used for |
|---|---|---|
| done | `#EAF2EC` / `#1A5C3A` | finished, arranged, recorded, on track |
| working / gold | `#F5EFE2` / `#7C5E2A` | on site, to arrange, to approve, waiting |
| red | `#FBEDEB` / `#C0392B` | problem, conflict, overdue, blocked (solid red for overdue-by-days) |
| check (pc) | `#E8EEF6` / `#2A4D7A` | reported done, leader checked, Project Control job |
| pm | `#EDEBE6` / `#5C5344` | Project Management site works |
| none / hidden | `#F0F0EE` / `#6C6C70` | absent?, older, neutral counts |

### 6.4 Forms in the panel

- A form opens **in the right panel** in place of the item (kicker = section, title = form name, one-line sub,
  fields, footer with **Save** (green) · optional second save · **Cancel**). Cancel or Save returns to the item.
- On a screen with no list item selected (e.g. "Add a worker"), the form takes the panel the same way.
- **Every existing guard stays:** reason boxes for void / reverse / correct, the temporary-password confirmation and
  its wording about waiting attendance, the App-updates publish warning, "type the number to confirm" steps, double-
  submit protection, the Add Expense save-once machinery where it is reached. If a confirmation is a separate step
  today, it stays a separate step (it may be a second panel state instead of a pop-up).
- Pop-ups that are not forms (photo viewer / gallery, receipt viewer) may stay as overlays.

### 6.5 Drill-downs become the panel

- `reqDetail`, `attWorker`, `wpTask`, `wpMeeting`, `reqPurchase` stop being separate pages. Their view ids **stay
  routable**: `switchView('reqDetail')` (and the others) lands on the parent screen with that item selected in the
  panel, so every existing link keeps working. If the item is not in the current tab, switch to the tab that holds it
  (or "All").
- `_FOCUS_SUBVIEWS` and the `*_VIEWS` groups keep those ids so focused accounts still reach them.
- The browser Back button behaves at least as well as today.

### 6.6 Phone width

At the existing small-screen breakpoint (≤ 720px): the list fills the screen; tapping a row shows the panel full-width
with a **Back** button at the top; Next still works; forms full-width. Tabs scroll sideways. The Setup menu and More
(…) open as full-width menus.

### 6.7 Roles and amounts

The frame knows nothing about money. Each screen's content keeps its current role checks (`currentUserRole`,
`currentCanBuy`, buyer scope, `currentStockOn` / `currentToolsOn` and their main-owner variants, `_hideStockCost`,
owner-only App updates). A list row's right-hand figure or a count is never an amount on a screen where the account
cannot see amounts today.

## 7. Per-screen layout (the mockup's mapping, to be completed by each phase's inventory)

Each phase **starts with an inventory** of its screens as they are today: every field, button, state, warning, empty
state, role variant and toolbar control, and where it lands in the new frame (tab, list row, panel section, More
menu, form). Anything that does not fit the mockup's slots still goes somewhere visible. The inventory is part of the
phase's plan and is checked against the screen after the build.

| Screen | Tabs (first = default) | List groups / row | Panel | Primary · More |
|---|---|---|---|---|
| **Requests → Queue** | Needs action · Urgent · To arrange · Arranged · All open | Urgent · this week's cutoff · waiting on the office · nothing left; row "worker · project", items, received date, status pill, urgent/overdue chip, red left bar when urgent | the request: overdue notice, items as lines with Mark arranged / Undo / Move / Resolve…, facts, photos, history; footer Mark all arranged · Next request | weekly batch dates in the tab bar |
| **Attendance → Today on site** | Needs you · On site · Absent? · Finished · Everyone | by site, then "not on site"; row name, role · site, time in, status pill, location chip | worker's day: notice, Time In/Out photos, facts; Next worker | More: Refresh, Add a worker, Download for Excel; live chip; date stepper kept from today |
| **Attendance → Workers** | Can use the app · Switched off · Team leaders · Everyone | Active / Switched off | details, sign-in, job, today; Edit, Switch off / on, Set temporary password | Add a worker |
| **Attendance → Sites & schedule** | All sites · Visible to workers · Hidden | Sites | working days, due time, closed days, location check; Edit schedule, Add a closed day, Hide/Show | — |
| **Attendance → Hours report** | Every worker · Anything to fix | Anything to fix / All clear | days as lines; "attendance only, never pay" text | Download for Excel; More: period choices |
| **Attendance → Weekly bonus** | Everyone · To verify · Not earning · On track | To verify / Not earning / On track | required days as lines, facts | More: last week, Download |
| **Attendance → App updates** (owner) | Published | Published | version facts, what's new, older-phones notice | Publish a new version |
| **Work Plan → Board** | Needs you · In progress · Drafts · Completed · All | Waiting for your check · Blocked · Not acknowledged after 24 h · Overdue · Active · Drafts and proposals · Completed (30 days) | task: proposal notice, instructions, blockers with Clear…, facts, history; Approve — completed, Send back, Publish, Reopen, Edit | New task; More: Open Meetings |
| **Work Plan → Meetings** | All meetings | Recent | shared notes, tasks from the meeting; Draft tasks with AI, Add a task | New meeting |
| **Requests → Purchasing** (buyers) | Shopping list · Purchases · Owner approvals · Cash, **plus every tab it has today** (payments, reconciliation, …) | per tab, as the mockup | per item type, as the mockup | Record purchase |
| **Requests → Stock** | Stock · Receiving · Waiting for owner · History (+ today's) | In stock / Bought, not received / … | places, receive, approve cost moves, reverse | Issue / move; More: Record leftovers, Count, Opening stock |
| **Requests → Tools** | Out · Problems · To register · Waiting for owner · All tools (+ today's) | With a worker / Problems / … | holder, where, condition; Return, Hand over, Mark repaired, Retire… | Issue a tool |
| **Setup → Weekly batches / Teams / Catalogue / Item history / Projects** | one tab each (Projects: All · Open in WorkMate · Closed) | as the mockup | as the mockup | New batch / New team / Add an item |

## 8. Things the mockup draws that do not exist today

Not built in this project (anti-goal: no new features under cover of a layout change). Each phase's inventory lists
the ones it finds so the owner can decide on them later. Known from the mockup, to be confirmed against the code:
"Move…" a request line to another batch; tools "Mark found"; receiving "Not delivered"; Hours report "Close the
day…"; Catalogue "Hide from workers"; any other button whose action has no existing function. If one of these turns
out to exist already, it is kept like everything else.

## 9. Calls made for the owner to check

- **Bell:** the existing Construction notifications bell stays unchanged; needs-you totals show on the tabs only (§6.2).
- **Counts per phase:** a section's count appears when that section is converted, not before.
- **Default tab:** a screen opens on "Needs you" when it has items; when it is empty it opens on the next tab
  (e.g. On site, To arrange, In progress) so the screen is not blank. *(The current Today screen already disables an
  empty "Needs you".)*
- **Wording:** chrome and labels follow the mockup; any label that carries a rule in `CLAUDE.md` or a spec (e.g.
  "Stock cost move", "Cover is right", the temporary-password text) keeps its current wording.
- **Phone:** stacked list → panel with Back (§6.6).
- **Mockup-only actions** are not built (§8).

## 10. Constraints for the builder

- Plain HTML + vanilla JS, **no build step**; never `npm run build`. Bump the `?v=` on every changed script and
  stylesheet tag in `admin.html`.
- Tests read source and fence rules. Update their extraction markers when code moves; **never delete a fence**.
  `npm test` and `node --check` on every changed file before each phase is called done; CI must be green.
- Keep pure logic in the `*-core.js` modules (they are `require`d by tests); the new frame should be a small shared
  file (e.g. `js/split-view.js` + its CSS section) that screens call with their rows and panel content, so the 17
  screens cannot drift apart.
- Remove a module's old CSS only once nothing uses it.
- The working tree holds uncommitted Financial MVP Phase 1 changes in `admin.html`, `css/admin-renovation.css`,
  `css/dacs-portal.css` and others. The owner commits those **before Phase 1 starts**, so the redesign stays separate.
  The owner commits and pushes; the builder does not.
- `admin.html` only — the client and partner portals are not involved.

## 11. Each phase is done when

1. Its inventory (§7) is written and every item is placed.
2. Its screens are converted completely; the old drill-down pages for them are gone, their view ids still route.
3. `node --check` on changed files, `npm test` green, fences updated not removed.
4. Checked in the browser on live data with: the owner account, a staff account, a buyer account (Phase 4), and a
   focused account (`admin-pm@` and a Purchasing/Stock/Tools-only account where relevant) — every item in the
   inventory found and working, no amount where there was none. **Real records are looked at, never acted on.**
   Buttons that write (Mark arranged, Approve, Switch off, Record purchase, …) are pressed only on **ZZ test
   records** made for the check, under a step list the owner approves first, and cleaned up afterwards by a named
   marker — the same way every WorkMate pilot has run.
5. Phone width checked.
6. The owner has seen it and pushed it; CI green.

## 12. Left to the builder

The shared frame's file and function names; exact CSS; how the frame keeps scroll position and selection across
re-renders; search matching rules; keyboard shortcuts (optional); whether Purchasing / Stock / Tools ship as one
phase or three (each still finishes completely); how the count fetches are batched; the list width between the phone
breakpoint and full desktop (e.g. narrower than 440px below ~1100px); whether the emptied drill-down containers in
`admin.html` are removed or left in place.
