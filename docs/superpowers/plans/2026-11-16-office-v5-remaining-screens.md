# Office v5 — all remaining screens (Work Plan, Purchasing, Stock, Tools, Setup, Attendance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner chose native execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every remaining office screen on the v5 frame — cards in groups, one item at a time in the pop-up, "What to do now", v5 forms, counts — without losing any button, field, wording, guard or role rule.

**Architecture:** Builds on Phase 1's frame (`js/split-view.js`, `css/split-view.css`; plan `2026-11-16-office-v5-phase1.md`). Three shared pieces do most of the work: (1) frame additions for what these screens need (tiles, lede, strips, segmented switch, legend, day dots, tick boxes, a page shell for existing item pages); (2) a **form adapter** — every remaining form already draws `.att-modal` markup (`RA.modal`, Work Plan's `modal`, Attendance's builders), so CSS restyles it to the v5 form and hides the open item under it, and the pop-up leaves Escape/Tab to it; (3) a **keep-everything fence** — a snapshot of every visible string in every remaining screen file, taken before any change, that must still be found afterwards (exceptions only with a reason). Each screen's list becomes `SplitView.render` cards; each drill-down page renders its existing content into the pop-up through the page shell.

**Tech Stack:** Plain HTML + vanilla JS, no build step, Supabase RPCs (unchanged), Node test scripts (zero dependencies).

**Spec:** [docs/superpowers/specs/2026-11-14-office-split-view-redesign-design.md](../specs/2026-11-14-office-split-view-redesign-design.md) rev 2 + D6 (all remaining screens in one go, checked together at the end) and the two 16 Nov builder's calls in §6.5. Per-screen mapping: spec §7 and `docs/design/office-v5/dacs-data-{att,req,buy,wp}.js`. Inventory of today's screens: `docs/design/office-screens-inventory.md` §2.2–§4.

## Global Constraints

- **Drawing only.** No migration, RLS or RPC change; every RPC keeps its name and arguments. `CLAUDE.md` money rules hold: staff see no peso outside the Purchasing/Buyer and Project Control exceptions; Stock pesos only where `stock-cost-admin.js` shows them today (owner accounts); Weekly bonus amounts owner-only; non-buyers never reach Purchasing.
- **Keep everything** (D1): the keep-everything fence (Task 1) must stay green; an exception needs a `Ruling:` line saying where the thing went or why it no longer exists (e.g. a "← back" link replaced by ✕).
- **A next-step button only for exactly one existing action** of that item, wired to the same handler as the real button.
- Never `npm run build`. **Never commit or push — the owner commits.** Leave the owner's unrelated edits alone (`admin.html` lucide indent line, `docs/superpowers/plans/2026-11-09-pm-staff-entry-permissions.md`).
- Changed `admin.html` tags in this plan use `?v=20261116b`; a file whose content does not change keeps its tag.
- Existing fences: update their markers when code moves, never delete a fence without its v5 counterpart in the same task.
- `_FOCUS_SUBVIEWS`, the `*_VIEWS` groups and every view id stay; drill-down ids (`wpTask`, `wpMeeting`, `reqPurchase`, `attWorker`) route to their parent screen with that item's pop-up open.
- Each task ends with `npm test` green and `node --check` on every changed JS file.

## Review Focus

1. **A form opened from an item, then cancelled** → the item comes back exactly as it was (scroll, open sections) — the item is hidden under the form, never redrawn (Task 1 fence + CSS).
2. **Escape while a form is open over an item** closes only the form; a second Escape closes the item (Task 1: the pop-up ignores keys while `.att-modal` is open).
3. **A staff account** sees no peso on any card, tile, count or pop-up where it saw none before — Purchasing cards (buyers only), Stock cost moves (owner), Weekly bonus amounts (owner) (fences in Tasks 4, 5, 8).
4. **A focused account** (`admin-pm@`, Purchasing-/Stock-/Tools-only) reaches exactly the screens it reached before, including drill-down links (fences in Tasks 9–10 using `_FOCUS_SUBVIEWS`).
5. **Links into an item from elsewhere** (Reconciliation "go", Weekly batches "View in queue", Problems "Open tool", a meeting's task, Hours/Bonus "open this day") land on that item's pop-up in its screen (fences per task).

---

### Task 0: Start

- [ ] `git status --short` matches the end of Phase 1 (its files modified, nothing else new). `npm test` green; record the total in the ledger `.superpowers/sdd/2026-11-16-office-v5-remaining-screens/progress.md`.

### Task 1: Frame additions, form adapter, keep-everything fence

**Files:** `js/split-view.js`, `css/split-view.css`, new `tests/office-v5-keep.test.js`, new `tests/fixtures/office-v5-keep.json`, new `tests/tools/office-v5-strings.js`, `package.json` (add the new test to `npm test`), `tests/split-view.test.js`.

**Produces (frame):**
- `cfg.seg = { options: [{ id, label }], value, onChange(id) }` → segmented switch in the header.
- `cfg.tiles = [{ n, label, tab, tone: 'red'|'gold'|null }]` → tile grid; click = `cfg.onTab(tab)`; the tile of the current tab has a green border.
- `cfg.lede` (text), `cfg.strips` ([text]) → status sentence and green info boxes.
- `cfg.legend = [{ label, tone: 'o'|'l'|'m'|'u'|'t'|'x' }]` and `row.dots = 'oolmt'` → v5 day dots (On time / Late / Missed / Unverified / Today-upcoming / Not a working day).
- `row.tick = { on }`, `cfg.onTick(id, on)`, `cfg.tickBar = { label, count, onClick }` → tick box on the card (its press never opens the card) and the sticky green "label (count)" button, shown when count > 0.
- A group with `title: ''` draws its cards with no heading.
- `SplitView.page(panel, { kicker, title, pills, sub, step, nextLabel }) → Element` — draws the pop-up shell and returns the body element an existing page renderer fills; footer = Next.
- **Form adapter:** while any `.att-modal` is in the document, the pop-up's Escape/Tab handler does nothing; CSS restyles `.att-modal` (scrim `rgba(28,28,30,.45)`, box max 780px radius 22px, Playfair 24px title, 44px inputs, footer Save first) and `body:has(.att-modal) #svPop .sv-pop-box { visibility: hidden }`; `.att-modal` sits above `#svPop`.

**Keep-everything fence:** `tests/tools/office-v5-strings.js <files…>` prints the visible strings of those files at `HEAD` (text between tags in template/HTML strings, and quoted literals with a letter and a space, 4–200 chars, tags stripped). The fixture is generated **once, before any screen changes**, for the groups: `wp` = `js/workplan-admin-*.js`; `pur` = `js/purchasing-admin-*.js`, `js/reconciliation-admin.js`; `stock` = `js/stock-admin.js`, `js/stock-cost-admin.js`; `tools` = `js/tools-admin.js`; `setup` = `js/requests-admin-setup.js`, `-history.js`, `-gallery.js`; `att` = `js/attendance-admin.js`, `js/app-updates-admin.js`. The test asserts every string of a group is still found in that group's files (or `js/split-view.js`), except those listed in the fixture's `gone` map with a reason.

- [ ] Tests first: `tests/split-view.test.js` — `segmented switch, tiles, lede, strips`, `tick boxes never open the card; the tick bar shows its count`, `day dots and legend`, `page shell returns a body and keeps Next`, `the pop-up leaves Escape and Tab to an open form` (`/document\.querySelector\('\.att-modal'\)/` in the keydown handler), CSS `rule(css, '.att-modal-box')` max-width 780px + radius 22px and `body:has(.att-modal) #svPop .sv-pop-box`. Watch them fail.
- [ ] Generate the fixture from `HEAD` (before Task 2 touches any screen) and add `tests/office-v5-keep.test.js` (passes at once — it guards later tasks). Implement the frame additions and CSS. `npm test` green.

### Task 2: Work Plan — Board and one task

**Files:** `js/workplan-admin-board.js`, `js/workplan-admin-task.js`, `js/workplan-admin-core.js` (`openTask` routes to `wpBoard` + pop-up; pure `taskNextStep(t)`), `css/workplan-admin.css`, `tests/workplan-admin.test.js`, `tests/workplan-screens.test.js`.

- Header "Work Plan", sub, primary **New task**, More: **Open Meetings**; How "How a task moves" (the empty-board three steps + the two starting places).
- Tabs **Needs you · In progress · Drafts · Completed · All**; groups in the code's order (`boardGroups`: Waiting for your check · Blocked · Not acknowledged after 24 h · Overdue · Not started and in progress · Drafts and proposals · Completed in the last 30 days); toolbar: project select, search, "Showing N". Card: title, project · work, people · planned, chips (Blocked, Sent back, Overdue, Not read after 24 h, N to check), status pill.
- Pop-up = `SplitView.page` + the existing task page content (alerts, problems with Clear…, instructions, meeting notes, photos, people, facts, history, header actions, danger link). `taskNextStep`: Reported done / Leader checked → **Approve — completed**; Draft or Proposal → **Publish**; else none.
- The empty board ("No tasks yet — A task starts in one of two places…" with Open Meetings / New task and the three steps) stays as the empty state.
- [ ] Tests first (new fences: drawn by `SplitView.render`; `taskNextStep` cases; `wpTask` routes to the Board pop-up; every task action still calls the same RPC). Keep-everything green. `npm test` green.

### Task 3: Work Plan — Meetings and one meeting

**Files:** `js/workplan-admin-meetings.js`, `js/workplan-admin-core.js` (`openMeeting`), `tests/workplan-screens.test.js`.

- Header "Meetings", primary **New meeting**, More: **Board**; lede "N meetings have draft tasks waiting…"; tabs **Needs you · All meetings**; card: meeting, held on, shared notes state, tasks.
- Pop-up = page shell + the existing meeting page (notes, Save, AI drafts and their warnings, tasks from the meeting, shared notes, recipients, Publish…, versions). New meeting opens in the pop-up. Unsaved AI suggestions survive closing and reopening the pop-up in the same tab (they live in the module's memory today; keep it).
- [ ] Tests first; keep-everything green; `npm test` green.

### Task 4: Purchasing (buyers only) — all six tabs, one purchase, Record purchase

**Files:** `js/purchasing-admin-list.js`, `-purchases.js`, `-cash.js`, `-record.js`, `-pay.js`, `-core.js` (routing only), `js/reconciliation-admin.js`, `js/stock-cost-admin.js` (Company stock tab only), `css/purchasing-admin.css`, `tests/purchasing-admin.test.js`, `tests/purchasing-payments-screens.test.js`, `tests/reconciliation-admin.test.js`.

- The lock notice for non-buyers stays exactly as today.
- Tabs **Shopping list · Purchases · Owner approvals · Cash · Company stock (owner, stock on) · Reconciliation (owner)**.
- Shopping list: one card per request line (item, project · requested by, buyer, figures as meta, chips), **tick box** = "Add to the purchase", sticky **Record purchase (N)**; toolbar: batch, project, Mine / Unassigned / Urgent, Clear, **Purchase with no request**; pop-up = the line's figures and portions with I'll buy this / Assign… / Release / Mark arranged / Undo arranged, stock hint with Issue from stock….
- Purchases: cards (supplier, for, source, total, payment, bought by, status, flags); filters as today; pop-up = page shell + the existing purchase page (lines, office review, receipts, payments, refunds, history, Correct… / Void… / Record again…).
- Owner approvals: groups Waiting / Decided; pop-up with the Asked-for table and Approve / Reject… / Withdraw / Open purchase.
- Cash: the main owner's buyers as cards and the sections as groups (Returns waiting, "I did not receive this", Own money to review, Overpaid, Supplier credit), Give petty cash… / Daily report… as tab buttons; buyer details in the pop-up; the staff buyer's own view as one card/pop-up.
- Company stock and Reconciliation: groups per section with their "go" links, Show / Print / CSV, Cover is right… / Bill checked….
- Record purchase (and Correct / Record again) opens in the pop-up at the wide size (up to ~1040px), keeping every part, the save-once machinery and "Send to the owner?".
- `reqPurchase` routes to Purchasing → Purchases with that purchase's pop-up.
- Next steps (only where the account may act today): approval waiting (owner) → **Approve**; return waiting (main owner) → **Confirm received**; "I did not receive this" → **It was handed over…**; own money to review → **Accept**; Overpaid → **Resolve…**; waiting for a billing period → **Cover is right…**; bill to check → **Bill checked…**; unpaid / partly paid purchase → **Record payment…**.
- [ ] Tests first (who sees the tab unchanged; prices only here; every RPC unchanged; tick bar count; `reqPurchase` route). Keep-everything green. `npm test` green.

### Task 5: Stock

**Files:** `js/stock-admin.js`, `js/stock-cost-admin.js`, `tests/stock-admin.test.js`, `tests/stock-cost-admin.test.js`.

- Header "Stock", primary **Issue / move**, More: Record leftovers, Count, Opening stock, Match a project purchase line…, Switch stock off… (main owner); switched-off state with Switch stock on… (main owner).
- Tabs **Stock · Receiving · Waiting for owner · History**; cards per item / receiving line / record; pop-up: item (places, lots, records, Issue / move, Count), receiving line (Received…, Not delivered…, Match…), record with its stock cost moves (peso value owner accounts only, `_hideStockCost` unchanged; Approve… / Reject… / Reverse cost… main owner; Ask again…). `taskNextStep`-style rule: receiving awaiting → **Received…**; not matched → **Match…**; count/opening waiting and main owner → **Confirm**.
- [ ] Tests first (no peso for staff; main-owner buttons unchanged; every `stk_*` call unchanged). Keep-everything green. `npm test` green.

### Task 6: Tools

**Files:** `js/tools-admin.js`, `tests/tools-admin.test.js`.

- Header "Tools", primary **Register tools**, More: Switch tools off… (main owner); switched-off state.
- Tabs **Tools · Out (N) · To register (N) · Waiting for owner (N) · Problems (N)** (+ Show closed); cards per tool / line / problem; pop-up = page shell + the existing tool page (photo, facts, actions by state, records). Next step: Available → none (two actions); To register → **Register…**; Lost → **Found…**; problem → sentence only.
- "Open tool" from Problems opens that tool's pop-up.
- [ ] Tests first; keep-everything green; `npm test` green.

### Task 7: Setup — Weekly batches, Teams, Catalogue, Item history, Projects

**Files:** `js/requests-admin-setup.js`, `js/requests-admin-history.js`, `js/requests-admin-gallery.js`, `css/requests-admin.css`, `tests/requests-admin.test.js`.

- Weekly batches: tabs This week · Upcoming · Closed · All; strip with the cutoff rule; pop-up = dates + **Change dates…** (the existing date-card form) + View in queue.
- Teams: primary New team; tiles (Active teams, need a leader, workers not in a team); tabs Active teams · Show inactive · All; pop-up = members as lines (Make leader, remove, Remove as leader, Can't lead), Add members, Rename or deactivate, Clear leader mark, leader-problem warnings.
- Catalogue: primary New item; tabs All · Materials · Tools · Inactive; pop-up = item facts, Active switch with its confirm, Edit….
- Item history: tabs Photos to review · Search items (with its filters, Search, Show more); pop-up = photo review (Approve a copy…, Keep private) or the existing item page (photos, history table, Upload photo…, Add / Retire historical reference…).
- Projects: tiles; How this works; tabs All · Open in WorkMate · Closed; pop-up = status + the two switches with their explanations.
- Next steps: photo to review → **Approve a copy…**; team with no valid leader → sentence only (picking a leader is per member).
- [ ] Tests first; keep-everything green; `npm test` green.

### Task 8: Attendance — Today, one worker's day, Workers, Sites & schedule, Hours report, Weekly bonus, App updates

**Files:** `js/attendance-admin.js`, `js/app-updates-admin.js`, `css/attendance-admin.css`, `tests/attendance.test.js`, `tests/app-updates.test.js`, `tests/worker-password.test.js`, `tests/workmate-3b-web.test.js`.

- Today: seg **By site / Full list**, primary **Download for Excel**, More: Refresh, Pick another day…, Add a worker; tiles Expected / On site / Finished / Absent? (Not in yet) / Needs you; lede = today's status line; strips for quiet sites; How (words and badges); tabs **Needs you · Everyone · On site · Absent? · Finished**; groups by site (Costing job / Site works) or by status; the "Needs you" panel's three kinds become the Needs you tab's cards with their sentences; pop-up = one worker's day (existing content: summary, notice, facts, two photo cards, explanations, Close this day, Print this day). Next step: never timed out → **Close this day**.
- `attWorker` routes to the screen that opened it (Today, Hours report, Weekly bonus) with that day's pop-up.
- Workers: primary Add a worker, More Refresh; lede; strip "Switching a worker off is safe…"; tabs Can use the app · Switched off · All; pop-up = details + Edit details, Switch off / back on, Make / Remove Team Leader (main owner), Set temporary password (main owner, its two steps and exact warning).
- Sites & schedule: More Refresh; lede; How this page works; tabs All · Custom schedule · Hidden · Has closed days (the Table / Cards switch goes — spec §8); pop-up = schedule facts and notes + Set/Change the schedule, Location…, Closed dates…, Hide / Show (the schedule form's three parts as three buttons, each its own form, discard question kept).
- Hours report: More = the two Excel exports; period filters; tiles; lede; strip "Hours record attendance — not a basis for pay…"; tabs **Waiting for a time out · By worker · By site**; pop-up: day with **Close this day**, or worker / site totals + open this worker's day.
- Weekly bonus: seg running / final week, More Week before / Week after / Download the list; tiles (amounts owner only); lede (staff wording without pesos); legend; day dots; tabs as spec §7; "Record only, no payments" kept; pop-up: Mon–Fri, result (amount owner only), **Mark as handed over** (final week, its confirm).
- App updates (owner): primary Publish a new version (file check, then its separate "will be BLOCKED" confirm); lede live versions; tabs All · DAC'S WorkMate · DACS Attendance; cards per version.
- [ ] Tests first (owner-only amounts; staff wording; temporary-password text verbatim; App updates owner-only; `attWorker` route). Keep-everything green. `npm test` green.

### Task 9: Counts (D5) for every screen

**Files:** each module above (`NavCounts.register`), `js/admin.js` (`PRIMARY_NAV` `count:` keys), `tests/split-view.test.js`.

- Keys and who counts: `attToday` Needs you (all); `attReports` days waiting for a time out (all); `reqPurchasing` owner approvals waiting (owner accounts — loader returns `null` for others); `reqStock` waiting for owner (main owner only); `reqTools` waiting for owner (main owner only); `reqHistory` photos to review (all who see it); `wpBoard` Needs you (all); `wpMeetings` meetings with draft tasks (all). A screen that has the data sets its count with `NavCounts.set`.
- [ ] Tests first (each key registered; the who-can-act check in each loader; top tab total = sum). `npm test` green.

### Task 10: Wire-up, docs, verification, review

**Files:** `admin.html` (changed tags → `?v=20261116b`), `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md` (untouched — no schema change), the browser check list.

- [ ] Bump tags of changed files only; update ARCHITECTURE module map rows; `npm test` and `node --check` on every changed file.
- [ ] One fresh whole-change review (Phase 1 + this plan); fix Critical/Important with a failing test first.
- [ ] Write the look-only browser check for every screen (owner, staff@, a buyer, `admin-pm@`, a Purchasing/Stock/Tools-only account, phone width) and the ZZ step list for the owner's approval. Hand over the file list for the owner's commit.
