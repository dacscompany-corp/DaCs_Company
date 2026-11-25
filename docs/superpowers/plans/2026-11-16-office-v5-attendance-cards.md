# Office v5 — Attendance as cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the five Attendance screens and App updates as v5 cards with pop-ups (not just framed), and make Today on site's red count leave out "Absent?".

**Architecture:** Each screen keeps its own loader, RPCs, forms and pure helpers, and replaces only its drawing with one `SplitView.render(host, cfg)` call. Cards and pop-ups are drawn the way Purchasing, Stock and Tools already are. Every existing form (`attOpenResolve`, `attOpenNewWorker`, `attOpenEditWorker`, `attOpenLeaderSwitch`, `attOpenTempPassword`, `attOpenSchedule`) is reused unchanged and opened on a `<body>` host. Pure decisions go inside the `ATT REPORT ENGINE` markers so `tests/attendance.test.js` runs them.

**Tech Stack:** Plain JS, no build; Node test scripts (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-14-office-split-view-redesign-design.md` — D1 (keep everything), D4 (v5), D5 (counts), **D7** (Attendance as cards), **D8** (Today's count leaves out Absent?). Design: `docs/design/office-v5/dacs-data-att.js` (`today`, `workers`, `sites`, `hours`, `bonus`, `updates` screens and their `F.*` forms).

## Global Constraints

- Drawing only: no RPC, table, migration or Edge Function change. `attendance_*`, `wk_*`, `app_publish_release` calls stay byte-for-byte.
- Card fields (`title`, `sub`, `meta`, `right`, pill/chip text) are **plain text** — the frame escapes them. Never pass `attStatusPill…` / `attBadges` HTML into a card.
- Hours are never pay. The "Hours here are attendance only…" and "Hours record attendance — not a basis for pay…" sentences stay on their screens.
- **Staff see no peso**: Weekly bonus keeps `hideMoney = attIsStaff()` — no amount tile, no amount on cards, no amount in the pop-up, no "Download the list".
- Main owner only: Team Leader switch and Set temporary password (`isMainOwner` from `wk_me`), exactly as now.
- Every visible string of the old screens is either still drawn or listed in `tests/fixtures/office-v5-keep.json` → `gone` with a reason (group `att`).
- Local date keys only (`attTodayKey`, `attDateKey`) — never `toISOString().slice(0,10)`.
- D5/D8: a badge only where the office can act, gone at zero; Today's count = `attNeedsCount(attn)` (open + location only), set only while the screen shows **today**.
- Changed files get `?v=20261116c` in `admin.html`.

## Review Focus

1. **A past date picked on Today** → the Attendance badge must not change (count only while `workDate === attTodayKey()`); covered in Task 1.
2. **Before workers are due** → the Absent? tab and tile read "Not in yet", the lede says "The day has not started yet.", and nobody is in Needs you; covered in Task 1 (`attTodayTab` test with `started=false`).
3. **Two workers with the same name** → every card shows the worker number; cards are keyed by worker id, never by name; covered in Tasks 1–2.
4. **Staff on Weekly bonus** → no `₱` in the frame's HTML for any tab, card or pop-up; covered in Task 5 (source fence plus `hideMoney` branches).
5. **A date or range changed while the last one is still loading** → the older answer is dropped (Today gets a load ticket like Hours report's); covered in Task 1.

---

### Task 1: Today on site as cards (+ the worker's day "What to do now", D8 count)

**Files:**
- Modify: `js/attendance-admin.js` (`attRenderToday`, `attRenderWorker`, `attWorkerPanel`, `attFormHost`, engine helpers)
- Modify: `css/attendance-admin.css` (only if a card needs a rule the frame lacks)
- Test: `tests/attendance.test.js`, `tests/fixtures/office-v5-keep.json`

**Interfaces:**
- Produces (engine, pure): `attNeedsCount(attn) -> number` (items whose `kind !== 'none'`); `attTodayTab(tab, tone, isNeeds, started) -> boolean` for tabs `needs | all | on | abs | fin` (`on` = working, `abs` = no record, `fin` = done or abandoned); `attBadgeChips(record, skewMinutes, locFlags) -> [{ text, tone }]`: the same words as `attBadges` (`offline`, `clock Nm`, `in: off site`…), with tone `n` for offline and clock, `r` for a `bad` location, `w` for a `warn` location.
- Produces (browser): `attBodyHost() -> HTMLElement` (one `<div id="attPopFormHost">` on `<body>`; `attFormHost` uses it when in the pop-up). Every framed Attendance screen opens its forms on it.

- [ ] **Step 1: Failing tests.** In `tests/attendance.test.js`, add `attNeedsCount`, `attTodayTab` and `attBadgeChips` to the engine names list, then add these checks:
  - `attNeedsCount([{kind:'open'},{kind:'none'},{kind:'location'}]) === 2` and `attNeedsCount([{kind:'none'}]) === 0`.
  - `attTodayTab('abs', 'none', false, true) === true`, `attTodayTab('needs', 'none', false, true) === false`, `attTodayTab('fin', 'abandoned', false, true) === true`.
  - With `started === false`, `attTodayTab('needs', 'none', false, false) === false`.
  - `attBadgeChips` of an offline record with an `outside_radius` time in returns `[{text:'offline',tone:'n'},{text:'in: off site',tone:'r'}]`.
  - Source fences:
    - `attRenderToday` calls `SplitView.render(` with `key: 'attToday'`.
    - It has `seg:` with `By site` and `Full list`, and `primary: { label: 'Download for Excel'`.
    - `NavCounts.set('attToday', attNeedsCount(attn))` sits inside a `workDate === attTodayKey()` guard.
    - A load ticket guards the answer: `if (mine !== ticket) return;`.
- [ ] **Step 2: Run** `node tests/attendance.test.js`. Expected: the new checks FAIL (helpers missing).
- [ ] **Step 3: Implement.**
  - `attRenderToday` keeps `attLoadToday`, `attention()`, `lede`'s sentences, `exportCsv` and Add a worker. It draws through the frame:
    - `sub`: the date line.
    - `seg`: By site / Full list.
    - `primary`: Download for Excel.
    - `more`: Refresh, Add a worker.
    - `toolbar`: the date input and the "All sites" select.
    - `tiles`: Expected, On site, Finished, Absent? / Not in yet, Needs you. Each tile opens its tab; Needs you uses tone `red` when above 0.
    - `lede`: the status sentence.
    - `strips`: quiet sites ("N sites with nobody timed in today: A · B") and the attendance-only note.
    - `how`: the four legend words plus the badge words.
    - `tabs`: Needs you (`count = attNeedsCount`, `needs: true`), Everyone, On site, Absent? / Not in yet, Finished, each with its count and its v5 help line.
    - `search`: "Search a name or a site…".
  - **By site** groups: one per site with crew. The title is the site; the meta is "N of N crew timed in · Costing job" plus the old footer sentence. Then the "Workers not on site today" or "Workers not timed in yet" group, with the check sentence as its meta.
  - **Full list**: one untitled group in `sortRank` order.
  - Each card:
    - `title`: the name.
    - `sub`: "Role · W-0001 · site" (or "No site today").
    - `meta`: `attStatusNote(record)`.
    - `right`: the time in, or "No record".
    - `pill`: the short status (On site / Finished / Closed / Absent? or Not in yet).
    - `chips`: `attBadgeChips`.
    - `nextLabel`: "Close this day" only when `attCanAbandon(record, attTodayKey()).can`.
  - The pop-up is `attWorkerPanel` with the `workerId|workDate` id. In the pop-up, `attRenderWorker` draws its lead sentence as `SplitView.nextStep(sentence, buttonHtml)`, where the button is `#attResolve` "Close this day" only when closable. It hides the duplicate banner, and the card's step button (`opts.start`) clicks `#attResolve` once the page is drawn.
  - The count is `NavCounts.set('attToday', attNeedsCount(attn))`, only while today is shown.
  - A `ticket` drops a late answer.
  - Old strings that go: the table headers "Which site", "Arrived", "Left", "Photos", "What happened", the chip row "The colour on the left means", and "Everyone’s day". Each gets a keep-fence `gone` reason: "cards carry each column", "the How box carries the legend", "the tabs carry the slices".
- [ ] **Step 4: Run** `npm test`. Expected: exit 0.
- [ ] **Step 5: Ledger** — record rulings and `task-done` (no commit: the owner commits).

### Task 2: Workers as cards

**Files:** `js/attendance-admin.js` (`attRenderWorkers`), `tests/workmate-3b-web.test.js`, `tests/attendance.test.js`, keep fixture.

**Interfaces:** Consumes `attBodyHost()`. Forms unchanged: `attOpenNewWorker(host, onCreated)`, `attOpenEditWorker(host, w, onSaved)`, `attOpenLeaderSwitch(host, w, onSaved)`, `attOpenTempPassword(host, w, onSaved)`.

- [ ] **Step 1: Failing tests.**
  - The frame call uses `key: 'attWorkers'` with tabs `['on','Can use the app']`, `['off','Switched off']` and `['all','All']`, plus `primary: { label: 'Add a worker'`.
  - The two main-owner fences in `workmate-3b-web.test.js` (lines 79–80) move to the pop-up's action list: `isMainOwner && (w._active || w.role === 'teamLeader')` (leader button) and `isMainOwner && w._active` (password button). It is the same rule in a new shape.
  - The switch-off toggle keeps its `.update({ status: nowActive ? 'inactive' : 'active' })` and its zero-row alert.
- [ ] **Step 2: Run** `node tests/workmate-3b-web.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Each card:
    - `title`: the name.
    - `sub`: "W-0001 · job", plus " · Can lead a team" from `attLeaderNote`.
    - `meta`: "Signs in with email".
    - `pill`: Yes (`done`) or Switched off (`none`).
  - `lede`: the count sentence. `strips`: the switching-off sentence. `more`: Refresh. `search`: name or worker number.
  - The pop-up (`SV.page`, kicker "Worker") shows facts (Worker number, Signs in with, Job on site, Can use the app) and buttons:
    - Edit details
    - Switch off app access or Switch back on
    - Make or Remove Team Leader, for the main owner
    - Set temporary password, for the main owner and active accounts only
  - Each button calls the same function on `attBodyHost()`. After a save the list redraws with `refreshPanel: true`.
  - The table headers "Signs in with", "Job on site" and "Can use the app" stay as fact labels.
- [ ] **Step 4: Run** `npm test`. Expected: exit 0.
- [ ] **Step 5: Ledger.**

### Task 3: Sites & schedule as cards

**Files:** `js/attendance-admin.js` (`attRenderProjects`, `attOpenSchedule`), tests, keep fixture.

**Interfaces:** `attOpenSchedule(host, project, config, onSaved, defaultStart, startTab)` gains an optional `startTab` (`'days' | 'location' | 'closed'`, default `'days'`) passed to its existing `showTab`.

- [ ] **Step 1: Failing tests.**
  - `attOpenSchedule` passes `showTab(startTab || 'days')`.
  - The frame uses `key: 'attProjects'` with tabs All, Custom schedule, Hidden and Has closed days, plus `how: { title: 'How this page works'`.
  - The hide RPC call and its confirm text are unchanged.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Each card:
    - `title`: the site.
    - `sub`: "days · due 7:00 AM".
    - `meta`: closed days and "N here today".
    - `chips`: Costing job / Site works.
    - `pill`: Visible (`done`) or Hidden from workers (`none`).
  - The pop-up (kicker "Site") has the schedule facts and the site note.
    - Its "What to do now" box says "No working days are set yet for this site." with Set the schedule, only when `!daysSet`.
    - Buttons: Change/Set the schedule (`'days'`), Location… (`'location'`), Closed dates… (`'closed'`), and Hide from workers / Show to workers.
  - The Table / Cards switch and its `dacsAttSitesView` preference go (rev 2 ruling, "cards carry all columns"). They get keep-fence `gone` entries.
- [ ] **Step 4: Run** `npm test`. Expected: exit 0.
- [ ] **Step 5: Ledger.**

### Task 4: Hours report as cards

**Files:** `js/attendance-admin.js` (`attRenderReports`), tests, keep fixture.

- [ ] **Step 1: Failing tests.**
  - The frame uses `key: 'attReports'` with tabs `['needs','Waiting for a time out']`, `['worker','By worker']` and `['site','By site']`.
  - `more` holds the two Excel exports with their unchanged file names: `attendance-by-worker-` and `attendance-by-day-`.
  - The `ticket` guard stays.
  - Close this day calls `attOpenResolve(attBodyHost(), rec, run)`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `toolbar`: the preset seg (Just today / Last 7 days / Last 30 days) and the From / To inputs, with the same debounce and preset sync.
  - `tiles`: Total hours, Average day, Days finished, and Needs a time out (red when above 0, opens `needs`).
  - `lede`: the banner sentence. `strips`: the pay note, plus the "not confirmed on site" and "closed by the office" counts when non-zero.
  - Tab help: the open-panel sentence for `needs`. The totals line ("All 9 workers · 39 days · 312.5 h") goes in the By worker and By site help.
  - **Waiting** cards:
    - `title`: the worker. `sub`: "site · Tue 10 Nov". `meta`: "Arrived 7:30 AM · never timed out".
    - `pill`: "Needs a time out" (`working`).
    - `nextLabel`: "Close this day" when `_closable`. Otherwise the `_reason` goes in `meta`.
    - Pop-up: "What to do now" with Close this day, and "Open this worker's day".
  - **By worker** cards:
    - `right`: the hours. `meta`: "N days on site".
    - `pill`: the fix flags (Nothing / N days need a time out / N closed by the office).
    - Pop-up: the facts and the pay note.
  - **By site** cards: `right` is the hours, `sub` is "N days worked"; the pop-up shows the facts.
  - No count (ruling T9 stands).
- [ ] **Step 4: Run** `npm test`. Expected: exit 0.
- [ ] **Step 5: Ledger.**

### Task 5: Weekly bonus as cards

**Files:** `js/attendance-admin.js` (`attRenderRewards`), tests, keep fixture.

**Interfaces:** Produces (engine, pure) `attBonusDots(cells) -> string`. It maps tone to letter (`ok→o`, `late→l`, `missed→m`, `unv→u`, `pending→t`, `off→x`, `unknown→t`) for `SplitView`'s `dots`.

- [ ] **Step 1: Failing tests.**
  - `attBonusDots([{tone:'ok'},{tone:'late'},{tone:'missed'},{tone:'unv'},{tone:'off'}]) === 'olmux'`.
  - Fences for staff:
    - The `hideMoney` checks guard the money tile, each card's `right`, the pop-up's Amount fact and the "Download the list" `more` item.
    - The `attendance_reward_mark_paid` call and its confirm sentence are unchanged.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `sub`: the week line. `more`: Week before, Week after, and Download the list (not for staff). `toolbar`: the week date input and Show.
  - `tiles`:
    - Running week: On track, At risk, No bonus, and Bonus if all hold (not for staff).
    - Final week: Earned, No bonus, Not handed over yet, and Total bonus (not for staff).
  - `lede`: the lead plus `bodyText`. `legend`: the five dot words. `strips`: "Record only, no payments…".
  - `tabs`: the groups (`risk` / `on` / `no` running; `on` / `no` / `owed` final) plus Everyone.
  - `toolbar`: also the trade select, the supervisor select and a "Day" select (Everyone / All on time / Late / Missed / Unverified), which replaces the day chips with the same `inDayFilter`.
  - Each card:
    - `title`: the worker. `sub`: "trade · supervisor".
    - `dots`: `attBonusDots(r._cells)`.
    - `pill`: the `statusCell` text. `meta`: the reason.
    - `right`: the amount (not for staff).
    - `nextLabel`: "Mark as handed over" when final, qualified and not paid.
  - The pop-up:
    - A Monday-to-Friday row of day buttons; a day with a record opens that worker's day.
    - Result facts, with Amount left out for staff.
    - The "Record only" note.
    - Mark as handed over / Handed over, a toggle as now, with its confirm.
  - The group collapse toggles go; tabs replace them (keep-fence `gone`: "tabs replace the folding groups").
- [ ] **Step 4: Run** `npm test`. Expected: exit 0.
- [ ] **Step 5: Ledger.**

### Task 6: App updates as cards

**Files:** `js/app-updates-admin.js` (`render`, `initAppUpdatesModule`), `tests/app-updates.test.js`, keep fixture.

- [ ] **Step 1: Failing tests.**
  - The frame uses `key: 'attAppUpdates'`, `primary: { label: 'Publish a new version'`, and tabs All / DAC'S WorkMate / DACS Attendance with counts.
  - The publish flow (file check, `refusalFor`, the BLOCKED confirm, `app_publish_release`, the storage clean-up on refusal) is unchanged.
  - The publish page opens `wide: true, keep: true`.
- [ ] **Step 2: Run** `node tests/app-updates.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `lede`: the live-now line per app (`paintLive` as text).
  - Each card:
    - `title`: "App label version_name". `sub`: "Published date · size". `meta`: the notes.
    - `right`: the version code. `pill`: Current when it is the newest of its app.
  - The pop-up shows the version facts and the "Mind the size" note.
  - **Publish a new version** opens the existing publish card markup and handlers in the pop-up page (id `'__publish'`, wide and kept, so a stray click never drops a picked file). After it publishes, the list redraws.
- [ ] **Step 4: Run** `npm test`. Expected: exit 0.
- [ ] **Step 5: Ledger.**

### Task 7: Wire-up, review, check list

- [ ] Tags `?v=20261116c` for every file this plan changed, and update the version fences that pin a tag.
- [ ] Remove `attFramed`'s custom body for the five screens (the frame is drawn by each screen now). Keep `attendanceOpenWorker` → `SplitView.open(_attScreen, …)`.
- [ ] Update the ARCHITECTURE "Office frame (v5)" and Attendance rows, run `node --check` on the changed JS, and run `npm test` (exit 0).
- [ ] One fresh whole-change review, on the most capable model. Fix Critical and Important findings with a failing test first, and ledger the minor ones.
- [ ] Add an Attendance part to the browser check list, covering the owner, staff@ (bonus amounts hidden) and phone width.
