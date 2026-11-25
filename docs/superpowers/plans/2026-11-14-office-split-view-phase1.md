# Office split view — Phase 1 (shared frame + Requests Queue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared triage split-view frame once, add the Requests **Setup ▾** menu and the Requests "needs action" count, and move Requests → Queue and the one-request page onto the frame (list left, request right, forms in the panel, Next).

**Architecture:** A new `js/split-view.js` (browser global `SplitView` + `NavCounts`; pure helpers exported under Node like the `*-core.js` files) and `css/split-view.css` draw the frame. Screens hand it rows and fill its panel; they keep their own data loading and RPCs. `js/requests-admin-queue.js` and `js/requests-admin-detail.js` are rewritten on top of it; `js/admin.js` draws the Setup menu and count badges.

**Tech Stack:** Plain HTML + vanilla JS, no build step, Supabase RPCs (unchanged), Node test scripts (zero dependencies).

**Spec:** [docs/superpowers/specs/2026-11-14-office-split-view-redesign-design.md](../specs/2026-11-14-office-split-view-redesign-design.md) — read it first.

## Global Constraints

- **Drawing only.** No migration, RLS, RPC or data change. Every RPC the Queue and request page call today is still called, with the same arguments.
- **Keep everything** (spec D1): every item in the Inventory below lands somewhere visible. Nothing in the mockup that does not exist today is built ("Mark all arranged" is **not** built).
- Never `npm run build`. Never commit or push: **the owner commits**. Each task ends with a checkpoint, not a git command.
- New and changed tags in `admin.html` use `?v=20261114c` (tests match `\d{8}[a-z]`).
- Pill tones reuse the existing classes in `css/attendance-admin.css` (`att-pill--done|working|abandoned|pc|pm|none|hidden`); their colours already equal the design's.
- Frame sizes: list **440px**; **360px** at ≤1100px; stacked at **≤720px** (list, then panel with **Back**).
- Labels follow the mockup, except labels that carry a rule (keep "Needs resolution", "Reduction to resolve", the reason texts, error sentences in `RA.ERRORS`).
- **"Needs action" = the code's existing rule**: a request with at least one line in `conflict | reduction | unarranged | partly` (`requestSummary().actionLines > 0`, the current "Needs action only" filter). The Requests badge counts these.
- Before Task 1 the owner has committed the Financial MVP changes (`admin.html`, `css/admin-renovation.css`, `css/dacs-portal.css`, …). If `git status --short` still lists `admin.html`, stop and ask.

## Review Focus

1. **"View in queue" from Weekly batches** lands on a tab that hides the batch's requests → must switch to **All open** (`showQueueForBatch` sets `tab = 'all'`; fenced in Task 5).
2. **Clicking rows quickly**: a slow earlier `pr_office_request` answer overwrites the panel of a later click → stale answers are dropped (`SplitView.seq`, tested in Task 1, used in Task 6).
3. **After an action the selected request leaves the tab** (arranged under "To arrange") → **Next** goes to the request that followed it, not the first row (`nextAfter` with a missing id, Task 1).
4. **Phone load** auto-selects the first row and jumps straight to the panel → on phones nothing is selected until a tap (`pickSelected(ids, null, true) === null`, Task 1).
5. **An account without the Queue** (Purchasing-only / Stock-only / Tools-only focus) fetches or shows a Requests count → only sections whose visible modules carry `count` are refreshed (fence, Task 3).

---

## Inventory — what exists today and where it lands

**Queue** (`js/requests-admin-queue.js`)

| Today | New place |
|---|---|
| Title "Request queue"; sub sentence | Header title; sub "From DAC'S WorkMate · urgent first, then by weekly batch" + " · N overdue" when N > 0 |
| "This week" box: Cutoff → Buy → Deliver, "Requests received after the cutoff go to the next week.", **Change batch dates** (→ `reqBatches`) | Tab-bar aside: the three steps, the note as a muted second line, the link |
| 300-row cap warning | Notice above the split (same text) |
| Summary chips (open, overdue, urgent, to resolve, to arrange, arranged) | Tab counts + overdue in the sub |
| Open / Closed segment with count | Tabs **Needs action · Urgent · To resolve · To arrange · Arranged · All open · Closed** (Closed loads `p_scope: 'closed'`; its count shows once loaded) |
| "Needs action only" checkbox | The **Needs action** tab (same rule) |
| Weekly batch select "All weekly batches" with `(open_portions)` | Select under the list search |
| Search "Search worker, project, item…" (`filterQueue`) | List search |
| "Showing X of Y" | List meta line |
| Columns Received / Requested by (+team) / For (project + work) / Items (+ "N items", "1 of 2 open", "closed") / Status pill + urgent / OVERDUE chip | Row: title "requester · project", sub = items, meta = "work · team · count", right = received day, pill = status, chip = urgent/overdue |
| Group headings: Urgent "Needed soonest first" · Cutoff …(This week pill, Buy · Deliver) · "Waiting on the office" · "Nothing left to arrange" + counts | Sticky group headers: title, meta, badge, count; tones red / ink / red / muted |
| Row marks: urgent, overdue, done | `stripe: 'red'`, `tint: true`, `dim: true` |
| Empty texts + **Clear filters** | List empty (same texts and button) |
| Enter / Space opens a row | Rows are buttons |
| `RA.showQueueForBatch(batchId)` | Kept; also sets `tab = 'all'` |

**One request** (`js/requests-admin-detail.js`)

| Today | New place |
|---|---|
| "← Request queue" | Desktop: gone (list beside). Phone: **Back** |
| "Request from {name}" / "Received … · project" / Cancelled pill | Kicker "Request · received {when}", title project, sub "work · from name · team", pills: status, urgent/overdue, Cancelled |
| Summary chips (items, urgent/overdue needed, to resolve, to arrange, arranged, cancelled) | Chips line at the top of Items |
| Worker's note | Text section "Note from the worker" |
| Line cards: number, description, kind · spec · unit · category, URGENT chip, state pill, facts (Still needed, Catalogue + **Match/Change**, Requested again from, For, Why urgent, Notes), offline-edit block (**Apply N / Keep N**), portions (batch, Buy → Deliver, quantity, Arranged by · when, Reduction −N; **Mark arranged, Move…, Undo arranged, Resolve reduction…**), line photos, **Change quantity… / Cancel item…** | Items section, same content and buttons |
| Side card: Requested by, Project, Work, Team, Received, Drafted on phone | Facts table |
| Request photos (click = full size, signed 10 min) | Photos section, same loading |
| History (collapsed above 6 events, count) | History section, same rule |
| Six pop-ups: Change quantity, Cancel this item (arranged warning), Resolve the reduction, Move to another weekly batch, Apply / Keep (offline edit), Match to the catalogue | Panel forms, same fields, validations and RPCs |
| Arrange / Undo: instant, button disabled, `alert` on error | Same |
| Load error / NOT_FOUND | Panel error |
| — (mockup only) "Mark all arranged" | **Not built**; listed for the owner |

---

### Task 0: Preconditions

**Files:** none changed.

- [ ] **Step 1:** Run `git status --short`. Expected: `admin.html`, `css/admin-renovation.css`, `css/dacs-portal.css`, `js/portal-app.compiled.js` are **not** listed. If they are, stop and ask the owner to commit them.
- [ ] **Step 2:** Run `npm test`. Expected: every suite passes (baseline).

### Task 1: Frame helpers (pure, tested)

**Files:**
- Create: `js/split-view.js` (pure half + Node export; the browser half comes in Task 2)
- Create: `tests/split-view.test.js`
- Modify: `package.json` (add `node tests/split-view.test.js` right after `node tests/requests-admin.test.js`)

**Interfaces — Produces** (`module.exports` under Node; `window.SplitView` in the browser):
- `pillClass(tone: 'done'|'gold'|'red'|'solidRed'|'check'|'pm'|'none') -> string` → `'att-pill att-pill--done'`, `'att-pill att-pill--working'`, `'att-pill att-pill--abandoned'`, `'att-pill sv-pill--solid-red'`, `'att-pill att-pill--pc'`, `'att-pill att-pill--pm'`, `'att-pill att-pill--none'`; unknown → `--none`.
- `pickDefaultTab(tabs: {id, count?: number|null, needs?: boolean}[], saved: string|null) -> string`
- `flatIds(groups: {rows: {id}[]}[]) -> string[]`
- `nextAfter(ids: string[], id: string|null, lastIndex: number) -> string|null`
- `pickSelected(ids: string[], wanted: string|null, isPhone: boolean) -> string|null`
- `seq() -> { next(): number, isLatest(n: number): boolean }`
- `badgeText(n) -> string|null`

- [ ] **Step 1: Write the failing tests** in `tests/split-view.test.js` (same `test/ok/eq` harness as `tests/requests-admin.test.js`):

```js
const sv = require('../js/split-view.js');
test('pillClass maps tones to the existing pill classes', () => {
  eq(sv.pillClass('done'), 'att-pill att-pill--done');
  eq(sv.pillClass('gold'), 'att-pill att-pill--working');
  eq(sv.pillClass('red'), 'att-pill att-pill--abandoned');
  eq(sv.pillClass('solidRed'), 'att-pill sv-pill--solid-red');
  eq(sv.pillClass('check'), 'att-pill att-pill--pc');
  eq(sv.pillClass('nope'), 'att-pill att-pill--none');
});
test('pickDefaultTab: saved wins, an empty needs tab gives way to the next', () => {
  const tabs = [{ id: 'attn', count: 0, needs: true }, { id: 'urgent', count: 2 }, { id: 'all', count: 5 }];
  eq(sv.pickDefaultTab(tabs, 'all'), 'all');
  eq(sv.pickDefaultTab(tabs, 'gone'), 'urgent');
  eq(sv.pickDefaultTab(tabs, null), 'urgent');
  eq(sv.pickDefaultTab([{ id: 'attn', count: 3, needs: true }, { id: 'all', count: 5 }], null), 'attn');
  eq(sv.pickDefaultTab([{ id: 'all', count: 0 }], null), 'all');
});
test('nextAfter: the following row, or the row now at the old place', () => {
  eq(sv.nextAfter(['a', 'b', 'c'], 'a', 0), 'b');
  eq(sv.nextAfter(['a', 'b', 'c'], 'c', 2), null);
  eq(sv.nextAfter(['a', 'c'], 'b', 1), 'c');   // b left the list after an action
  eq(sv.nextAfter(['a'], 'b', 5), null);
});
test('pickSelected: wanted always wins; desktop falls back to the first row, phone to nothing', () => {
  eq(sv.pickSelected(['a', 'b'], 'x', false), 'x');
  eq(sv.pickSelected(['a', 'b'], null, false), 'a');
  eq(sv.pickSelected(['a', 'b'], null, true), null);
  eq(sv.pickSelected([], null, false), null);
});
test('seq drops stale answers', () => {
  const s = sv.seq(); const a = s.next(); const b = s.next();
  ok(!s.isLatest(a) && s.isLatest(b), 'only the newest request counts');
});
test('badgeText', () => {
  eq(sv.badgeText(0), null); eq(sv.badgeText(null), null); eq(sv.badgeText(NaN), null);
  eq(sv.badgeText(7), '7'); eq(sv.badgeText(120), '99+');
});
test('flatIds keeps group order', () => {
  eq(sv.flatIds([{ rows: [{ id: 'a' }] }, { rows: [{ id: 'b' }, { id: 'c' }] }]), ['a', 'b', 'c']);
});
```

- [ ] **Step 2:** Run `node tests/split-view.test.js`. Expected: FAIL (`Cannot find module '../js/split-view.js'`).
- [ ] **Step 3:** Implement the seven helpers in `js/split-view.js` inside the same IIFE shape as `js/requests-admin-core.js` (`(function (root) { … if (module.exports) { module.exports = pure; return; } … })(typeof window !== 'undefined' ? window : globalThis)`). `pickDefaultTab`: saved if it is a tab id; else if `tabs[0].needs && !tabs[0].count` and a second tab exists → `tabs[1].id`; else `tabs[0].id`.
- [ ] **Step 4:** Run `node tests/split-view.test.js`. Expected: all pass. Add it to `package.json`'s `test` script, run `npm test`, expect green.
- [ ] **Checkpoint:** changed `js/split-view.js`, `tests/split-view.test.js`, `package.json` (no commit).

### Task 2: The frame — list, panel, forms, phone

**Files:**
- Modify: `js/split-view.js` (browser half)
- Create: `css/split-view.css`
- Test: `tests/split-view.test.js` (source fences)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces (browser, on `window.SplitView`):
  - `render(host: HTMLElement, cfg) -> void` where `cfg = { key, title, sub, live?: string (green pulsing chip; unused by the Queue, for Attendance later), primary?: {label, icon, onClick}, more?: [{label, icon, onClick}], tabs: [{id, label, count, needs?}], tab, onTab(id), aside?: html, notice?: html, search: {placeholder, value, onInput(text)}, listTools?: html, onListTools?(root), listMeta?: string, groups: [{title, tone: 'red'|'ink'|'muted'|'gold', meta?: html, badge?: {text, tone}, rows: [{id, title, sub?, meta?, chips?: [{text, tone}], right?, pill?: {text, tone}, stripe?: 'red', tint?: bool, dim?: bool}]}], empty: html, onEmpty?(root), selectedId, onSelect(id, panel: HTMLElement) }`. Re-callable with new cfg; keeps the list's scroll position and the search box focus/caret per `key`; on desktop auto-selects with `pickSelected`; remembers the selected row's index per `key` for `nextAfter`.
  - `panelHtml({ kicker, title, sub?, pills?: [{text, tone}], sections: html[], actions?: html, nextLabel? }) -> string` — header, sections, footer bar with actions left and `<button data-sv-next>` right when `nextLabel`; a `<button data-sv-back>Back</button>` shown only at ≤720px.
  - Section builders returning html: `section(title, html)`, `notice(tone, icon, title, html)`, `facts([[label, valueHtml, mono?]])`, `history([{when, html}], collapsedAbove?: number)`, `pills([{text, tone}])`.
  - `form(panel: HTMLElement, opts) -> { close }` — `opts` is `RA.modal`'s contract (`title, sub, body, submitLabel, warn, onSubmit(form), onDone, onOpen(form), errorMessage`) plus `kicker` and `onCancel`. Renders in the panel; **Cancel** and **Escape** call `onCancel`; Save disables itself, `await onSubmit(form)`; a throw shows `(opts.errorMessage || defaultMessage)(err)` in `[data-error]` and re-enables; success calls `onDone`. Focuses the first field.
  - `error(panelOrHost, message)` — the error box used by screens.
- Styles in `css/split-view.css`, all classes `sv-*`: header line (Playfair 26px title, grey sub), tab bar (underline, count pill; a needs tab with count > 0 that is not active gets the red-tint pill `#FBEDEB`/`#C0392B`), split grid `440px minmax(0,1fr)` gap 16px filling the window below its own top (`--sv-top` set from `getBoundingClientRect().top` on render and resize), list card (search box `#FAFAFA`, sticky group header `#F7F7F5` uppercase 12px, rows with title 14.5px bold / sub 12.5px `#6C6C70` / right mono 12px, selected row `#F1F6F2` + `inset 3px 0 0 #1A5C3A`, red stripe `inset 3px 0 0 #C0392B`, tint `#FDF6F5`, dim opacity .72), panel (kicker mono 11px uppercase, Playfair 24px title, sections 16px apart, footer bar `#FAFAFA` with top border), form fields (42px inputs, focus ring `#EAF2EC`), `sv-pill--solid-red` (`#C0392B`/`#fff`); ≤1100px list 360px; ≤720px single column, `.sv--panel` shows the panel and hides the list, page scroll instead of fixed height; `prefers-reduced-motion` turns animations off.

- [ ] **Step 1: Write the failing source fences** in `tests/split-view.test.js`:

```js
const SRC = src('js/split-view.js');
test('the frame carries no money', () => ok(!/₱/.test(SRC), 'no peso sign in the frame'));
test('forms keep the modal contract', () => {
  ok(/\(opts\.errorMessage \|\| [A-Za-z_]+\)\(err\)/.test(SRC), 'errors go through opts.errorMessage');
  ok(/submit\.disabled = true/.test(SRC) && /submit\.disabled = false/.test(SRC), 'double submit blocked, re-enabled on error');
  ok(/e\.key === 'Escape'/.test(SRC), 'Escape cancels');
});
test('phone: no auto-open, a Back button', () => {
  ok(/matchMedia\('\(max-width: 720px\)'\)/.test(SRC), 'phone check');
  ok(SRC.includes('data-sv-back'), 'Back');
});
test('stale panel answers are dropped by the screens that use seq()', () => ok(/function seq\(/.test(SRC)));
```

- [ ] **Step 2:** Run `node tests/split-view.test.js`. Expected: the new fences FAIL.
- [ ] **Step 3:** Implement the browser half and `css/split-view.css` to the Interfaces above. Rows are `<button class="sv-row" data-id>` (keyboard works by default). The list and the panel scroll on their own. Lucide icons via `lucide.createIcons()` after each render.
- [ ] **Step 4:** Run `node --check js/split-view.js` and `node tests/split-view.test.js`. Expected: OK and all pass.
- [ ] **Checkpoint:** `js/split-view.js`, `css/split-view.css`, `tests/split-view.test.js`.

### Task 3: Chrome — Setup ▾ menu and count badges

**Files:**
- Modify: `js/admin.js` (`PRIMARY_NAV` Requests modules ~2307-2324; `_buildTabsBar` ~2568; `syncPortalChrome` ~2630; `renderPortalChrome` ~2617)
- Modify: `js/split-view.js` (add `NavCounts`)
- Modify: `css/split-view.css` (menu + badges)
- Test: `tests/split-view.test.js`

**Interfaces:**
- Produces: `window.NavCounts = { register(section: string, loader: () => Promise<number>), set(section, n: number|null), get(section) -> number|null, refresh(sections: string[]) -> Promise<void>, paint() }`. `paint()` writes `badgeText(n)` into every `[data-nav-count="<section>"]`, hides it when `null`, then calls `window.syncPtabPill(false)` if present. `refresh` runs each registered loader for the given sections only (one at a time is fine), `set(section, n)` on success, `set(section, null)` on any error; calls closer than 1 s apart reuse the running refresh.
- Produces in `PRIMARY_NAV`: `group: 'setup'` on `reqBatches, reqTeams, reqCatalog, reqHistory, reqProjects`; `count: 'requests'` on `reqQueue`.

- [ ] **Step 1: Write the failing fences/tests:**

```js
test('Requests Setup group and the Queue count marker', () => {
  const nav = src('js/admin.js');
  const block = nav.slice(nav.indexOf("id: 'requests'"), nav.indexOf("id: 'workplan'"));
  for (const v of ['reqBatches', 'reqTeams', 'reqCatalog', 'reqHistory', 'reqProjects'])
    ok(new RegExp("view: '" + v + "'[^}]*group: 'setup'").test(block), v + ' is under Setup');
  for (const v of ['reqQueue', 'reqPurchasing', 'reqStock', 'reqTools'])
    ok(!new RegExp("view: '" + v + "'[^}]*group: 'setup'").test(block), v + ' stays in the row');
  ok(/view: 'reqQueue'[^}]*count: 'requests'/.test(block), 'Queue carries the count');
});
test('counts are fetched only for sections the account can see', () => {
  const nav = src('js/admin.js');
  ok(/_visibleNav\(\)[\s\S]{0,200}\.filter\(p => p\.modules\.some\(m => m\.count\)\)/.test(nav), 'visible counted sections only');
  ok(nav.includes('NavCounts.refresh('), 'refreshed from the chrome');
});
```
(A failed loader showing no badge is covered by `badgeText(null) === null` in Task 1 and `set(section, null)` on error.)

- [ ] **Step 2:** Run `node tests/split-view.test.js` → FAIL. Run `node tests/purchasing-admin.test.js tests/stock-admin.test.js tests/tools-admin.test.js` → still PASS (baseline for nav behaviour).
- [ ] **Step 3:** Implement:
  - `PRIMARY_NAV` markers as above (no module added or removed; `_visibleNav()` output unchanged apart from the two extra properties).
  - `syncPortalChrome(view)`: visible modules with `group === 'setup'`: if 2 or more, draw one `<button class="portal-module-link sv-setup" aria-haspopup="menu" aria-expanded="false">` at the place of the first one, icon `settings-2`, label = the active setup module's label or "Setup", plus `chevron-down`; highlighted when the active view is in the group. Its menu `<div class="sv-setup-menu" role="menu">` is a child of `#portalModulesRow` (not the scrolling track), left = the button's `offsetLeft`, items are `data-view` buttons with their icons. Outside click and Escape close it. 0–1 setup modules → drawn inline as today.
  - A module with `count` gets `<span class="sv-count" data-nav-count="<count>" hidden></span>` after its label; `_buildTabsBar` gives each primary that has a counted module `<span class="sv-count sv-count--tab" data-nav-count="<count>" hidden></span>`. Both call `NavCounts.paint()` after drawing.
  - `renderPortalChrome()` ends with `if (window.NavCounts) NavCounts.refresh(_visibleNav().filter(p => p.modules.some(m => m.count)).map(p => p.modules.find(m => m.count).count));`.
  - CSS: tab count `#c0392b`/`#fff` (active tab: `#fff`/`#C0392B`), module count `#FBEDEB`/`#C0392B` 11px; menu white, 12px radius, `var(--shadow-lg)`, items 9px 12px; ≤720px menu full width with 16px sides.
- [ ] **Step 4:** Run `node --check js/admin.js js/split-view.js`, `node tests/split-view.test.js`, `node tests/purchasing-admin.test.js`, `node tests/stock-admin.test.js`, `node tests/tools-admin.test.js`, `node tests/requests-admin.test.js`. Expected: all pass.
- [ ] **Checkpoint:** `js/admin.js`, `js/split-view.js`, `css/split-view.css`, `tests/split-view.test.js`.

### Task 4: Requests core — queue states, tabs, counts; requests open in the Queue

**Files:**
- Modify: `js/requests-admin-core.js`
- Test: `tests/requests-admin.test.js`

**Interfaces — Produces** (pure, exported):
- `requestState(req) -> 'conflict'|'reduction'|'cancelled'|'arranged'|'partly'|'unarranged'` — moved verbatim from `requests-admin-queue.js` (it computes `requestSummary(req)` itself).
- `QUEUE_TABS = [['attn','Needs action'],['urgent','Urgent'],['resolve','To resolve'],['arrange','To arrange'],['arranged','Arranged'],['all','All open']]`
- `inQueueTab(req, tab) -> boolean` — attn: `actionLines > 0`; urgent: `urgent` and state not `arranged|cancelled`; resolve: `conflict|reduction`; arrange: `unarranged|partly`; arranged: `arranged`; all: true.
- `queueCounts(reqs) -> {attn, urgent, resolve, arrange, arranged, all}`
- `isOverdue(req, todayKey) -> boolean` — `urgent && neededBy && neededBy < todayKey`.
- `manilaDayKey(nowMs: number) -> 'YYYY-MM-DD'` — built from `manilaParts`, never `toISOString().slice`.
- Browser: `openRequest(id)` sets `state.detailId = id` and calls `root.switchView('reqQueue')`; `views.reqDetail = () => root.switchView('reqQueue')`.

- [ ] **Step 1: Write the failing tests** (use the file's `req/line/portion` factories):

```js
test('queue tabs follow the existing "needs action" rule', () => {
  const todo = req({}), done = req({ lines: [line({ portions: [portion({ arranged: true })] })] });
  const clash = req({ lines: [line({ open_conflicts: [{ id: 'k' }] })] });
  const red = req({ lines: [line({ portions: [portion({ arranged: true, pending_reduction: 2 })] })] });
  const urgentDone = req({ lines: [line({ urgent: true, needed_by: '2026-10-01', portions: [portion({ arranged: true })] })] });
  eq([todo, done, clash, red].map(r => ra.inQueueTab(r, 'attn')), [true, false, true, true]);
  eq([clash, red, todo].map(r => ra.inQueueTab(r, 'resolve')), [true, true, false]);
  eq(ra.inQueueTab(todo, 'arrange'), true); eq(ra.inQueueTab(done, 'arranged'), true);
  eq(ra.inQueueTab(urgentDone, 'urgent'), false);
  eq(ra.queueCounts([todo, done, clash, red]), { attn: 3, urgent: 0, resolve: 2, arrange: 1, arranged: 1, all: 4 });
});
test('overdue is a Manila calendar comparison', () => {
  const u = req({ lines: [line({ urgent: true, needed_by: '2026-10-09' })] });
  eq(ra.isOverdue(u, '2026-10-10'), true); eq(ra.isOverdue(u, '2026-10-09'), false);
  eq(ra.manilaDayKey(Date.parse('2026-10-09T17:00:00Z')), '2026-10-10');
});
test('a request opens in the Queue panel, never a page of its own', () => {
  const core = src('js/requests-admin-core.js');
  ok(/function openRequest\(id\) \{[\s\S]{0,120}root\.switchView\('reqQueue'\)/.test(core), 'openRequest → reqQueue');
  ok(core.includes("views.reqDetail = () => root.switchView('reqQueue')"), 'old route redirects');
});
```

- [ ] **Step 2:** Run `node tests/requests-admin.test.js`. Expected: the three new tests FAIL.
- [ ] **Step 3:** Implement as specified; add the new names to `pure`. `RA.modal` stays unchanged (other screens and `tests/workplan-admin.test.js` rely on it).
- [ ] **Step 4:** Run `node tests/requests-admin.test.js` and `node tests/workplan-admin.test.js`. Expected: all pass.
- [ ] **Checkpoint:** `js/requests-admin-core.js`, `tests/requests-admin.test.js`.

### Task 5: The Queue on the frame

**Files:**
- Modify (rewrite the drawing): `js/requests-admin-queue.js`
- Modify: `css/requests-admin.css` (remove queue-table rules nothing uses any more; keep the rest)
- Test: `tests/requests-admin.test.js`

**Interfaces:**
- Consumes: `SplitView.render`, `NavCounts.register/set`, `RA.requestState/inQueueTab/queueCounts/isOverdue/manilaDayKey/sortQueue/filterQueue`, Task 6's `RA.renderRequestPanel`.
- Produces: `RA.views.reqQueue(host)`; `RA.showQueueForBatch(batchId)` (scope open, batch set, text cleared, `tab = 'all'`); `NavCounts.register('requests', async () => RA.queueCounts(await RA.rpc('pr_office_queue', { p_scope: 'open' }) || []).attn)`.
- Session state `ui = { scope, batchId, text, tab, selectedId }`; `tab` uses `pickDefaultTab` until the user picks one; `'closed'` is the seventh tab (sets `scope = 'closed'`, refetches; leaving it sets `scope = 'open'`).
- On every load: `pr_office_queue` + `pr_office_batches` (unchanged), `NavCounts.set('requests', counts.attn)` when the scope is open. `RA.state.detailId`, when set, becomes `ui.selectedId` (then cleared); if that request is not in the current tab, switch to `all`.
- Grouping = today's `groupOf` / `headingHtml` order and texts; rows per the Inventory.
- `onSelect(id, panel)` → `RA.renderRequestPanel(panel, id, { onChanged: reload, nextLabel: 'Next request' })`, where `reload` refetches the queue and re-renders with the same `selectedId`.

- [ ] **Step 1: Write the failing inventory fence:**

```js
test('Queue keeps everything it had (split view)', () => {
  const q = src('js/requests-admin-queue.js');
  for (const s of ['Request queue', 'urgent first, then by weekly batch', 'Change batch dates',
    'Requests received after the cutoff go to the next week.', 'Showing the newest 300 requests',
    'All weekly batches', 'Search worker, project, item…', 'Clear filters', 'Closed',
    'No open requests. New ones appear here as soon as a worker sends them.', 'No closed requests yet.',
    'Needed soonest first', 'Waiting on the office', 'Nothing left to arrange', 'This week', 'OVERDUE'])
    ok(q.includes(s), 'missing: ' + s);
  ok(q.includes('SplitView.render('), 'drawn by the shared frame');
  ok(q.includes("RA.rpc('pr_office_queue'") && q.includes("RA.rpc('pr_office_batches')"), 'same RPCs');
  ok(/showQueueForBatch = function[\s\S]{0,300}ui\.tab = 'all'/.test(q), 'View in queue shows every open request of the batch');
  ok(q.includes("NavCounts.register('requests'"), 'badge loader');
  ok(!/<table/.test(q), 'the old table is gone');
});
```

- [ ] **Step 2:** Run `node tests/requests-admin.test.js` → the fence FAILS.
- [ ] **Step 3:** Rewrite the drawing of `requests-admin-queue.js` on `SplitView.render` per the Inventory and Interfaces; `receivedLabel`, `teamLabel`, `urgentChip` wording, `itemsCount` wording and the grouping stay as they are. Remove queue-table CSS from `css/requests-admin.css` only where no selector is used any more (`grep` each class across `js/` first).
- [ ] **Step 4:** Run `node --check js/requests-admin-queue.js` and `node tests/requests-admin.test.js`. Expected: pass.
- [ ] **Checkpoint:** `js/requests-admin-queue.js`, `css/requests-admin.css`, `tests/requests-admin.test.js`.

### Task 6: One request in the panel; forms in the panel

**Files:**
- Modify (rewrite the drawing): `js/requests-admin-detail.js`
- Modify: `css/requests-admin.css` (line card / portion rules sized for the panel; old two-column page layout removed)
- Test: `tests/requests-admin.test.js`

**Interfaces:**
- Consumes: `SplitView.panelHtml/section/notice/facts/history/pills/form/error/seq`, `RA.*`.
- Produces: `RA.renderRequestPanel(panel: HTMLElement, id: string, hooks: { onChanged(): void, nextLabel: string }) -> Promise<void>` — fetches `pr_office_request` (dropping stale answers with `SplitView.seq()`), draws the panel per the Inventory (sections in the spec's order: notice → text → Items → photos → facts → history), wires every button. Every former `RA.modal({...})` becomes `SplitView.form(panel, {...same opts, kicker: 'Request', errorMessage: RA.errorMessage, onCancel: redraw })` with `onDone: hooks.onChanged`. Arrange / Undo keep `pr_office_set_arranged`, the disabled button and `alert(RA.errorMessage(err))`.
- Overdue notice (red, `alarm-clock`): "Overdue N day(s)" / "Needed {day}. Arrange it now or tell the worker when it will arrive." when `isOverdue` and the state is not `arranged|cancelled`.

- [ ] **Step 1: Write the failing inventory fence:**

```js
test('one request keeps every action, now in the panel', () => {
  const d = src('js/requests-admin-detail.js');
  for (const r of ['pr_office_request', 'pr_office_set_arranged', 'pr_office_move_portion', 'pr_office_resolve_reduction',
    'pr_office_change_quantity', 'pr_office_cancel_line', 'pr_office_resolve_conflict', 'pr_office_match_item',
    'pr_office_batches', 'pr_office_catalog'])
    ok(d.includes("RA.rpc('" + r + "'"), 'missing RPC ' + r);
  for (const s of ['Mark arranged', 'Move…', 'Undo arranged', 'Resolve reduction…', 'Change quantity…', 'Cancel item…',
    'Still needed', 'Why urgent', 'Drafted on phone', 'Offline edit needs a decision.', 'The supplier order was reduced',
    'Kept the full order — the extra is surplus', 'Missing? Add it in Requests → Catalogue first.', 'No history yet.'])
    ok(d.includes(s), 'missing: ' + s);
  ok(!d.includes('RA.modal('), 'no pop-up forms left');
  ok((d.match(/SplitView\.form\(panel/g) || []).length === 6, 'six forms in the panel');
  ok(d.includes('RA.renderRequestPanel = '), 'exported for the queue');
});
```
Keep the existing test `a request line shows where Request Again came from` unchanged — the line `(line.ref_label ? fact('Requested again from', esc(line.ref_label)) : '')` stays verbatim.

- [ ] **Step 2:** Run `node tests/requests-admin.test.js` → the new fence FAILS.
- [ ] **Step 3:** Rewrite the drawing per the Interfaces and Inventory. Photos keep `PHOTO_BUCKET = 'request-photos'`, 600-second signed links, click opens full size. History keeps the `<details>` open at ≤ 6 events.
- [ ] **Step 4:** Run `node --check js/requests-admin-detail.js` and `node tests/requests-admin.test.js`. Expected: pass.
- [ ] **Checkpoint:** `js/requests-admin-detail.js`, `css/requests-admin.css`, `tests/requests-admin.test.js`.

### Task 7: Wire into the page, docs, full run

**Files:**
- Modify: `admin.html` — add `<link rel="stylesheet" href="css/split-view.css?v=20261114c">` right after `css/closeout-dialog.css`; add `<script src="js/split-view.js?v=20261114c"></script>` right before `js/requests-admin-core.js`; bump `js/admin.js`, `js/requests-admin-core.js`, `-queue.js`, `-detail.js` and `css/requests-admin.css` to `?v=20261114c`.
- Modify: `tests/requests-admin.test.js:306` — expect `css/requests-admin.css?v=20261114c` (the history script version stays `20261012a`).
- Modify: `docs/ARCHITECTURE.md` §4 — `js/split-view.js` + `css/split-view.css`: the shared split-view frame (Phase 1: Requests Queue).
- Modify: the spec's status line → "Approved 14 Nov 2026; Phase 1 built".
- Test: `tests/split-view.test.js`

- [ ] **Step 1: Write the failing fence:**

```js
test('the frame is loaded before the Requests scripts, cache-busted', () => {
  const h = src('admin.html');
  ok(h.includes('css/split-view.css?v=20261114c') && h.includes('js/split-view.js?v=20261114c'), 'tags');
  ok(h.indexOf('js/split-view.js') < h.indexOf('js/requests-admin-core.js'), 'order');
});
```
- [ ] **Step 2:** Run it → FAIL. **Step 3:** make the edits above. **Step 4:** run `node --check` on every changed `.js` file, then `npm test`. Expected: every suite passes, no "SLICE NOT FOUND".
- [ ] **Checkpoint:** all Phase 1 files; tell the owner the list for their commit.

### Task 8: Browser check (owner runs or approves)

**Files:** a step list in the session scratchpad (not the repo).

- [ ] **Step 1:** Write the look-only list. Run it on live, **pressing no button that saves**:
  owner account — Requests: Setup ▾ (five items, highlight, Escape/outside click), tab and Queue counts equal the Needs action tab, every Inventory row visible, Next, search, batch select, Closed tab, "Change batch dates", Weekly batches → View in queue (lands on All open);
  staff account — same, no amounts anywhere;
  `admin-pm@` — no Requests tab, no count request in the Network tab;
  a Purchasing-only / Stock-only / Tools-only account — no Queue, no count;
  phone width (≤720px) — list first, tap → panel with Back, forms full width, menu full width;
  1100px width — list 360px.
- [ ] **Step 2:** Write the ZZ action list (one ZZ request from the test phone; each of the six forms + Mark arranged / Undo / Move / Apply-Keep / Match on it; clean-up by the ZZ marker), and **wait for the owner's approval before running it**.
- [ ] **Step 3:** Report results; the owner commits and pushes; CI green closes Phase 1.
