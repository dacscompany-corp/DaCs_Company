# Office v5 — Phase 1 redo (shared frame on cards + pop-up, Requests Queue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the shared office frame from the split view to v5 — cards in a grid, the item and its forms in a centred pop-up with "What to do now" — and move Requests → Queue and the one-request view onto it, with the D5 counts mechanism (top tab = sum of the link counts the account sees).

**Architecture:** `js/split-view.js` keeps its name, its globals (`SplitView`, `NavCounts`) and most of its contract: a screen hands `render(host, cfg)` its tabs, groups and rows and fills a panel element in `onSelect(id, panel, opts)`. What changes is the drawing: rows become cards, and the panel element now lives inside one pop-up appended to `<body>` (so screen re-renders never touch it). `css/split-view.css` is rewritten to v5's measurements. The Queue gets a pure `requestNextStep()` in `js/requests-admin-core.js` that decides the "What to do now" sentence and its one button.

**Tech Stack:** Plain HTML + vanilla JS, no build step, Supabase RPCs (unchanged), Node test scripts (zero dependencies).

**Spec:** [docs/superpowers/specs/2026-11-14-office-split-view-redesign-design.md](../specs/2026-11-14-office-split-view-redesign-design.md) (revision 2, approved 16 Nov 2026) — read §6, §7 (Queue row), §9 first. Design: [docs/design/office-v5/Dacs Web Office v5.dc.html](../../design/office-v5/) and `dacs-data-req.js` (the `queue` screen and forms `fQty` … `fMatch`).

## Global Constraints

- **Drawing only.** No migration, RLS, RPC or data change. Every RPC the Queue and the request view call today is still called, with the same arguments (`pr_office_queue`, `pr_office_batches`, `pr_office_request`, `pr_office_set_arranged`, `pr_office_move_portion`, `pr_office_resolve_reduction`, `pr_office_change_quantity`, `pr_office_cancel_line`, `pr_office_resolve_conflict`, `pr_office_match_item`, `pr_office_catalog`).
- **Keep everything** (D1): every item in Phase 1's inventory (`docs/superpowers/plans/2026-11-14-office-split-view-phase1.md`, "Inventory") stays reachable. "Mark all arranged" is **not** built.
- **A next-step button only for exactly one existing action** (spec §6.3): it carries the same `data-act` attributes as the real button inside the item, so it runs the same handler.
- Never `npm run build`. **Never commit or push: the owner commits.** Each task ends with a checkpoint. Leave the owner's unrelated working-tree edits alone (the indent change at the `lucide.createIcons` line near the end of `admin.html`, `docs/superpowers/plans/2026-11-09-pm-staff-entry-permissions.md`).
- Changed tags in `admin.html` use `?v=20261116a`.
- v5 measurements: content max **1280px**; cards `repeat(auto-fill, minmax(300px, 1fr))`, gap **12px**, card radius **18px**, border **1.5px**; tabs and header buttons **44px** high, radius **999px**; pop-up max **780px**, radius **22px**, scrim `rgba(28,28,30,.45)`; phone **≤720px** = one column, pop-up full screen, radius 0.
- Pill tones reuse `att-pill--done|working|abandoned|pc|pm|none|hidden` (`SplitView.pillClass`).
- Rule-bearing wording stays exact (spec §9); `RA.ERRORS` is unchanged. The frame never draws a peso.
- Every old split-view fence gets a v5 counterpart in the same test file. No fence is deleted without its replacement in the same task.

## Review Focus

1. **Escape typed inside a form** closes the whole pop-up instead of going back to the item → the form's Escape handler stops propagation (test in Task 3).
2. **Switching to another screen while a pop-up is open** leaves it floating over that screen → `syncPortalChrome` closes it (test in Task 4).
3. **A stale card button** ("Mark arranged" on a card whose request someone else just arranged or split) → the action starts only from the fresh request's own "What to do now" button; if the fresh request has no single step, only the item shows (test in Task 6).
4. **Pressing a card's next-step button also counts as a click on the card** (opening, then toggling closed) → the button stops propagation (test in Task 2).
5. **Keyboard focus leaves the pop-up** or the page behind scrolls while it is open → Tab is trapped, `html.sv-pop-on` locks scrolling, focus returns to the card on close (test in Task 3).

---

### Task 0: Starting point

- [ ] **Step 1:** Run `git status --short` and `git log --oneline -1`. Expected: HEAD is `affc4b6` or later; modified `admin.html`, `css/split-view.css`, `tests/split-view.test.js` (the two 14 Nov live fixes and the indent change); untracked `docs/design/office-v5/`, `docs/design/office-screens-inventory.md`, `docs/superpowers/plans/2026-11-09-pm-staff-entry-permissions.md`, this plan. Anything else modified: stop and ask the owner.
- [ ] **Step 2:** Run `npm test`. Expected: every suite passes (baseline). Record the totals.

---

### Task 1: Pure half — nothing opens by itself, and the top-tab total

**Files:**
- Modify: `js/split-view.js` (pure half, lines 21–123)
- Test: `tests/split-view.test.js`

**Interfaces:**
- Produces: `pickSelected(ids: string[], wanted: string|null) → string|null` (returns `wanted || null`; `ids` kept for call-site compatibility), `navTotal(counts: {[key]: number|null}, keys: string[]) → number|null` (sum of finite counts > 0 among `keys`; `null` when the sum is 0). Both on `module.exports` and `window.SplitView`.

- [ ] **Step 1: Replace the old `pickSelected: wanted always wins…` test and add `navTotal`'s**

```js
test('pickSelected: only an item asked for opens; nothing opens by itself', () => {
  eq(sv.pickSelected(['a', 'b'], 'x'), 'x');
  eq(sv.pickSelected(['a', 'b'], null), null);
  eq(sv.pickSelected([], null), null);
});

test('navTotal: the sum of the counts the account sees; zero or failed adds nothing', () => {
  eq(sv.navTotal({ requests: 3, buy: 2 }, ['requests', 'buy']), 5);
  eq(sv.navTotal({ requests: 3, buy: null }, ['requests', 'buy']), 3);
  eq(sv.navTotal({ requests: 0 }, ['requests']), null);
  eq(sv.navTotal({}, ['requests']), null);
  eq(sv.navTotal({ requests: 3, stock: 4 }, ['requests']), 3);
  eq(sv.navTotal({ a: NaN, b: -1, c: 2 }, ['a', 'b', 'c']), 2);
});
```

- [ ] **Step 2:** Run `node tests/split-view.test.js`. Expected: FAIL (`navTotal is not a function`; `pickSelected` still returns `'a'`).
- [ ] **Step 3:** Implement both in the pure half; add `navTotal` to `pure`. Update the comment above `pickSelected` (v5: nothing opens until a card is clicked or a link names an item).
- [ ] **Step 4:** Run `node tests/split-view.test.js`. Expected: the two new tests pass. (Render fences may now fail on the old layout; Task 2 replaces them.)
- [ ] **Checkpoint:** `js/split-view.js`, `tests/split-view.test.js`.

---

### Task 2: The screen — header, tabs, toolbar, groups of cards

**Files:**
- Modify: `js/split-view.js` (`render`, `rowHtml` → `cardHtml`, `groupHtml`; remove `measure`, the split and list markup)
- Modify: `css/split-view.css` (header, tabs, toolbar, groups, cards, empty; remove `.sv-split`, `.sv-list*`, `.sv-row*`, the 1100px rule)
- Test: `tests/split-view.test.js`

**Interfaces:**
- Consumes: `pickSelected`, `pickDefaultTab`, `flatIds`, `nextFrom`, `panelPlan` (Task 1 / existing).
- Produces — `render(host, cfg)`; `cfg` fields (renames from Phase 1 marked ←):

| Field | Meaning |
|---|---|
| `key`, `title`, `sub`, `more`, `primary`, `notice` | as Phase 1; `primary` draws a "+" icon when its label starts with Add / New / Register / Create |
| `how` | optional `{ title, rows: [[label, text]] }` → a collapsed "How …" card under the header (`<details class="sv-how">`) |
| `tabs` | `[{ id, label, count, needs, help }]`; `help` = the line shown under the tabs for the current tab |
| `tab`, `onTab(id)` | as Phase 1 |
| `aside` | HTML under the tabs (the Queue's This week box) |
| `search` | `{ placeholder, value, onInput }` |
| `toolbar` ← `listTools`, `onToolbar(rootEl)` ← `onListTools` | extra controls in the toolbar row |
| `showing` ← `listMeta` | "Showing X of Y" text |
| `groups` | `[{ title, tone, meta, badge, rows }]` |
| row | `{ id, title, sub, meta, right, pill, chips, stripe, tint, dim, nextLabel }` — `nextLabel` (optional) draws the green next-step button |
| `empty`, `onEmpty` | as Phase 1 |
| `selectedId`, `refreshPanel` | the item the pop-up shows (Task 3); `null` = closed |
| `onSelect(id, panel, opts)` | fill the item; `opts.start === true` when it was opened by the card's next-step button |
| `onClose()` | the pop-up closed (✕, Escape, scrim, the open card clicked, a tab change, another screen) |

- Card markup: `<div class="sv-card" role="button" tabindex="0" data-id>` with top line (`sv-card-top`: chips, pill, `sv-card-right`), `sv-card-title`, `sv-card-sub`, `sv-card-meta`, bottom `sv-card-foot` = optional `<button type="button" class="sv-card-step" data-sv-next-step>` + `<span class="sv-card-open">Open ›</span>`. Classes `is-open` (the card in the pop-up), `sv-card--stripe-red`, `sv-card--tint`, `sv-card--dim`. Enter / Space on a focused card opens it.

- [ ] **Step 1: Replace `the frame styles exist, phone and mid width included` with these** (put `rule` with the other helpers at the top of the file)

```js
const rule = (css, sel) => { const i = css.indexOf(sel + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };

test('render draws groups of cards, not a list beside a panel', () => {
  const r = SRC.slice(SRC.indexOf('function render('), SRC.indexOf('function fill('));
  ok(r.includes('sv-cards') && SRC.includes("'sv-card'"), 'card grid');
  ok(!SRC.includes('sv-split') && !SRC.includes('sv-list-body') && !SRC.includes('function measure('), 'the split is gone');
  ok(SRC.includes('Open ›'), 'Open ›');
  ok(/cfg\.toolbar/.test(r) && /cfg\.showing/.test(r) && /cfg\.how/.test(r), 'toolbar, showing, how');
  ok(/t\.help/.test(r), 'the current tab explains itself');
});

test('a card\'s next-step button never also toggles the card', () => {
  ok(/data-sv-next-step/.test(SRC), 'the button exists');
  ok(/closest\('\[data-sv-next-step\]'\)[\s\S]{0,300}stopPropagation\(\)/.test(SRC), 'its press stops there');
  ok(/show\([^,()]+, true\)/.test(SRC), 'it opens the item with start');
});

test('cards open from the keyboard', () => {
  ok(/e\.key === 'Enter' \|\| e\.key === ' '/.test(SRC), 'Enter or Space');
});

test('the v5 screen styles', () => {
  const css = src('css/split-view.css');
  ok(/max-width: 1280px/.test(rule(css, '.sv')), 'content 1280px');
  ok(/repeat\(auto-fill, minmax\(300px, 1fr\)\)/.test(rule(css, '.sv-cards')) && /gap: 12px/.test(rule(css, '.sv-cards')), 'card grid');
  const card = rule(css, '.sv-card');
  ok(/border-radius: 18px/.test(card) && /1\.5px solid/.test(card), 'card shape');
  const tab = rule(css, '.sv-tab');
  ok(/height: 44px/.test(tab) && /border-radius: 999px/.test(tab), 'pill tabs');
  ok(css.includes('.sv-pill--solid-red'), 'solid red pill');
  ok(!/\.sv-split|\.sv-row\b/.test(css), 'no split or row styles left');
});
```

- [ ] **Step 2:** Run `node tests/split-view.test.js`. Expected: the four new tests FAIL.
- [ ] **Step 3:** Rewrite `render` to v5's order (spec §6.2): header (`sv-head`: title, sub, More, primary) · notice · how · tabs (`sv-tabs`, pill buttons with `sv-tab-n` counts; `is-needs` red when `needs && count`) · `sv-tab-help` line · aside · toolbar row (`sv-toolbar`: search pill max 380px, `cfg.toolbar`, `sv-showing`) · groups (`sv-group-head` "title · count" + meta + badge, then `sv-cards`) or the empty card. Keep: search focus and caret restore, the More menu, `onEmpty`, `onToolbar`. A tab click calls `closePop()` (Task 3; until then a no-op stub) before `cfg.onTab`. A card click on the open card closes the pop-up; on another card opens it via `show(id, false)`; a next-step press calls `e.stopPropagation()` then `show(id, true)`. `show` and the pop-up wiring are Task 3's — in this task `show(id, start)` sets `m.current`, `m.order = flatIds(cfg.groups)`, `m.lastIndex`, toggles `is-open`, and calls `cfg.onSelect(id, panel, { start })` with a temporary panel element.
- [ ] **Step 4:** Rewrite the screen part of `css/split-view.css` to the Global Constraints' measurements and v5's (`Dacs Web Office v5.dc.html` lines with `notForm`/`showBody`): header title Playfair 30px, sub 15px grey max 760px; More and primary 44px pills; tabs 44px pills, 1.5px border, active border `#1A5C3A`, count bubble 22px; tab help 15px; toolbar search 44px pill max 380px; group title 16px bold (`sv-tone-red` = `#C0392B`), "· count" 14px grey; card padding 16px, title 17px/600, sub 14.5px 2-line clamp, meta 13.5px grey, hover `translateY(-2px)` + green border, `is-open` green border + `0 14px 40px rgba(26,92,58,.14)`, stripe `inset 5px 0 0 #C0392B`, tint `#FDF6F5`, dim `opacity: .62`; next-step button 44px green pill; empty = dashed card. Keep `.sv-count`, `.sv-setup-menu`, `.sv-menu*`, `.sv-tone-*`, `.sv-pill--solid-red`, reduced motion.
- [ ] **Step 5:** Run `node tests/split-view.test.js` and `node --check js/split-view.js`. Expected: Task 1 and 2 tests pass. (The Queue still passes the old cfg names until Task 5 and the pop-up arrives in Task 3, so do not open the browser between tasks.)
- [ ] **Checkpoint:** `js/split-view.js`, `css/split-view.css`, `tests/split-view.test.js`.

---

### Task 3: The pop-up, forms in it, "What to do now", toast

**Files:**
- Modify: `js/split-view.js` (pop-up, `show`, Next, `panelHtml`, `form`, `error`, new `nextStep`, `toast`, `closePop`; remove `openPanel`, Back)
- Modify: `css/split-view.css` (pop-up, panel inside it, step box, form, toast, phone)
- Modify: `js/requests-admin-core.js:522-528` (`openRequest` drops the `openPanel` call)
- Test: `tests/split-view.test.js`

**Interfaces:**
- Consumes: Task 2's `show(id, start)`, `cfg.onSelect`, `cfg.onClose`, `cfg.refreshPanel`, `panelPlan`, `nextFrom`.
- Produces:
  - One pop-up per page: `#svPop` appended to `document.body` = `.sv-pop-scrim` + `.sv-pop-box[role="dialog"][aria-modal="true"][aria-labelledby]` with `<button class="sv-pop-x" data-sv-close aria-label="Close">` and `<section class="sv-panel">` (the element screens fill; class kept so `css/requests-admin.css`'s `.sv-panel .req-*` rules still apply). `pop.dataset.svKey` = the screen that owns it.
  - `closePop()` — hides it, removes `html.sv-pop-on`, sets that screen's `m.current = null`, returns focus to the card `[data-id]` if it is on screen, calls that screen's `cfg.onClose`. Safe when nothing is open.
  - `panelHtml(p)` — `p = { kicker, title, sub, pills, step, sections, actions, nextLabel }`: head = kicker, title (`id` for `aria-labelledby`), pills; body = sub, `p.step`, sections; footer = actions left, Next right. No Back.
  - `nextStep(text: string, buttonHtml: string) → html` — `<div class="sv-step"><div class="sv-step-k">What to do now</div><div class="sv-step-text">{esc(text)}</div>{buttonHtml}</div>`; `buttonHtml` arrives escaped from the screen and may be `''`.
  - `toast(text: string)` — one dark pill at the bottom centre, 3.2s, `role="status"`.
  - `form(panel, opts)` — as Phase 1 (`kicker, title, sub, body, submitLabel, warn, errorMessage, onOpen, onSubmit, onCancel, onDone`) plus `doneText` (toast after success). Markup: `<button type="button" class="sv-form-back" data-cancel>← Back without saving</button>`, title (Playfair 24px), `sub` as the intro, body, error line, footer Save · Cancel.
  - `error(where, message)` — no Back button any more (✕ is always in the box).
- Behaviour (spec §6.4–6.5): opening sets `html.sv-pop-on`, focuses the ✕; Tab / Shift+Tab cycle inside `.sv-pop-box`; Escape (document `keydown`, only while open) → `closePop()`; a click on the scrim → `closePop()`; Next → `nextFrom(m.order, m.current, flatIds(cfg.groups), m.lastIndex)` → `show(n, false)` in the open pop-up, marking that card `is-open`; `render()` with `cfg.selectedId` opens the pop-up on that item (link from elsewhere) and with `selectedId === null` closes it if this screen owns it; a re-render keeps the pop-up element untouched unless `panelPlan(...).reload`, in which case it calls `cfg.onSelect(id, panel, {})` keeping `panel.dataset.svRestore` scroll as Phase 1 did.

- [ ] **Step 1: Replace `phone: no auto-open, a Back button`, `render keeps the panel element and Next/Back read the latest state` and `a panel error keeps Back on phones` with these** (keep `a long panel scrolls…` and `a folded History…` as they are)

```js
test('one pop-up on <body>, a real dialog', () => {
  ok(/document\.body\.appendChild\(pop\)/.test(SRC), 'outside every screen host');
  ok(SRC.includes('role="dialog"') && SRC.includes('aria-modal="true"'), 'dialog');
  ok(/data-sv-close/.test(SRC) && /sv-pop-scrim/.test(SRC), '✕ and scrim');
  ok(!SRC.includes('data-sv-back') && !/function openPanel\(/.test(SRC), 'no Back, no openPanel');
  ok(/class="sv-panel"/.test(SRC), 'the filled element keeps class sv-panel');
});

test('Escape in a form goes back to the item, not out of the pop-up', () => {
  const f = SRC.slice(SRC.indexOf('function form('), SRC.indexOf('// ── NavCounts'));
  ok(/e\.key === 'Escape'\) \{[^}]*stopPropagation\(\)/.test(f), 'the form keeps its Escape');
  ok(f.includes('Back without saving'), 'the back link');
  ok(/opts\.doneText/.test(f) && /toast\(/.test(f), 'a toast after a save');
});

test('the pop-up keeps focus and the page still', () => {
  ok(/e\.key === 'Tab'/.test(SRC), 'Tab is trapped');
  ok(/classList\.add\('sv-pop-on'\)/.test(SRC) && /classList\.remove\('sv-pop-on'\)/.test(SRC), 'scroll lock');
  const c = SRC.slice(SRC.indexOf('function closePop('), SRC.indexOf('function closePop(') + 900);
  ok(/\.focus\(/.test(c) && /onClose/.test(c), 'focus back to the card, the screen told');
});

test('What to do now and the toast are exported', () => {
  for (const fn of ['nextStep', 'toast', 'closePop', 'panelHtml', 'form', 'error'])
    ok(new RegExp('function ' + fn + '\\(').test(SRC), 'missing ' + fn);
  ok(/root\.SplitView = Object\.assign\(\{\}, pure, \{[^}]*nextStep[^}]*toast[^}]*closePop/.test(SRC), 'on window.SplitView');
  ok(SRC.includes('What to do now'), 'the box title');
});

test('the pop-up styles: 780px, full screen on a phone, sections never shrink', () => {
  const css = src('css/split-view.css');
  const box = rule(css, '.sv-pop-box');
  ok(/max-width: 780px/.test(box) && /border-radius: 22px/.test(box), 'desktop box');
  ok(/rgba\(28, ?28, ?30, ?\.45\)/.test(rule(css, '.sv-pop-scrim')), 'scrim');
  ok(/@media \(max-width: 720px\)[\s\S]*\.sv-pop-box \{[^}]*border-radius: 0/.test(css), 'phone: full screen');
  ok(/html\.sv-pop-on/.test(css), 'page locked');
  ok(/\.sv-panel-body > \* \{[^}]*flex-shrink: 0/.test(css), 'sections keep their height (14 Nov lesson)');
  ok(/\.sv-hist > summary::after \{[^}]*content:/.test(css), 'History fold marker kept');
  ok(rule(css, '.sv-step').length > 0 && rule(css, '.sv-toast').length > 0, 'step box and toast');
});
```

Also replace the old `render keeps the panel element…` fence with:

```js
test('render keeps the open pop-up; only a refresh reloads it', () => {
  const r = SRC.slice(SRC.indexOf('function render('), SRC.indexOf('function fill('));
  ok(/panelPlan\(/.test(r) && /cfg\.refreshPanel/.test(r), 'panelPlan + refreshPanel');
  ok(/nextFrom\(/.test(SRC), 'Next keeps the order the user saw');
});
```

- [ ] **Step 2:** Run `node tests/split-view.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the pop-up, `show`, Next, `closePop`, `panelHtml`, `nextStep`, `toast`, `form` and `error` per the Interfaces above. `cfg.onClose` must only forget state, never redraw (it runs inside `closePop`, which `render` itself may call). Add `nextStep, toast, closePop` to `window.SplitView`, in that order, after `form`; remove `openPanel` from it and from `openRequest` in `js/requests-admin-core.js` (the Queue opens a linked item through `cfg.selectedId`).
- [ ] **Step 4:** Add the pop-up CSS (v5 values): scrim `rgba(28,28,30,.45)`; box max 780px, max-height `calc(100vh - 64px)`, radius 22px, shadow `0 30px 80px rgba(0,0,0,.3)`, centred with 32px padding; ✕ 44px round `#F0F0EE` at top 14px right 14px; head padding `24px 70px 12px 26px`, kicker 12.5px uppercase grey, title Playfair 26px; body scrolls, `padding: 4px 26px 20px`, gap 16px, `> * { flex-shrink: 0 }`; step box `#EAF2EC` radius 12px, kicker `#1A5C3A` 12.5px uppercase, text 15.5px `#134428`, its button 46px green; footer `#FAFAF8` border-top `#EDEDEB`; form back link 14px green, title Playfair 24px, Save green 44px, Cancel outlined; toast dark pill bottom 24px; `html.sv-pop-on, html.sv-pop-on body { overflow: hidden; }`; `@media (max-width: 720px)`: scrim padding 0, box `max-width: none; width: 100%; height: 100%; max-height: none; border-radius: 0`. Keep the facts, history (with the ▸ Show / ▾ Hide marker), notice and form-field rules.
- [ ] **Step 5:** Run `node tests/split-view.test.js`, `node --check js/split-view.js`, `node --check js/requests-admin-core.js`. Expected: all split-view tests pass.
- [ ] **Checkpoint:** `js/split-view.js`, `css/split-view.css`, `js/requests-admin-core.js`, `tests/split-view.test.js`.

---

### Task 4: Counts (D5) and closing the pop-up on a screen change

**Files:**
- Modify: `js/split-view.js` (`NavCounts.paint`)
- Modify: `js/admin.js` (`_buildTabsBar` count markup and signature ~2585–2610, `renderPortalChrome` refresh ~2644–2652, `syncPortalChrome` ~2704)
- Test: `tests/split-view.test.js`

**Interfaces:**
- Consumes: `navTotal` (Task 1), `closePop` (Task 3).
- Produces: a top tab carries `<span class="sv-count sv-count--tab" data-nav-total="k1 k2 …" hidden>` listing the `count` keys of its **visible, non-hidden** modules; `paint()` fills it with `badgeText(navTotal(counts, keys))`. Module links keep `data-nav-count="<key>"`. **Contract for later phases:** a `NavCounts.register(key, loader)` loader returns `null` when this account cannot act on that count (D5 limit) — no badge, adds nothing.

- [ ] **Step 1: Replace `counts are fetched only for sections the account can see` with these**

```js
test('a top tab shows the sum of the link counts the account sees (D5)', () => {
  const nav = src('js/admin.js');
  ok(nav.includes('data-nav-total='), 'top tabs carry their link keys');
  ok(/p\.modules\.filter\(m => m\.count && !m\.hidden\)/.test(nav), 'only visible counted links');
  const paint = SRC.slice(SRC.indexOf('function paint('), SRC.indexOf('function set('));
  ok(/\[data-nav-total\]/.test(paint) && /navTotal\(/.test(paint) && /badgeText\(/.test(paint), 'painted as the sum, through badgeText');
});

test('counts are fetched for every counted link the account can see', () => {
  const nav = src('js/admin.js');
  ok(/_visibleNav\(\)[\s\S]{0,120}flatMap\(p => p\.modules\.filter\(m => m\.count && !m\.hidden\)\.map\(m => m\.count\)\)/.test(nav), 'visible counted links only');
  ok(nav.includes('NavCounts.refresh('), 'refreshed from the chrome');
});

test('changing screen closes an open pop-up', () => {
  const nav = src('js/admin.js');
  ok(/function syncPortalChrome\(view\) \{[\s\S]{0,300}SplitView\.closePop\(\)/.test(nav), 'syncPortalChrome closes it');
});
```

Keep `Requests Setup group and the Queue count marker` and `NavCounts paints through badgeText and never shows a failed count` as they are.

- [ ] **Step 2:** Run `node tests/split-view.test.js`. Expected: the three new tests FAIL.
- [ ] **Step 3:** Implement: in `_buildTabsBar`, `const keys = p.modules.filter(m => m.count && !m.hidden).map(m => m.count)`; draw the `data-nav-total` span when `keys.length`; include the keys in the rebuild signature (`p.id + ':' + keys.join(',')`). In `renderPortalChrome`, refresh `_visibleNav().flatMap(p => p.modules.filter(m => m.count && !m.hidden).map(m => m.count))`. In `syncPortalChrome`, first line after the `primary` guard: `if (window.SplitView && window.SplitView.closePop) window.SplitView.closePop();`. In `paint()`, also fill every `[data-nav-total]` from `navTotal(counts, el.dataset.navTotal.split(' '))`.
- [ ] **Step 4:** Run `node tests/split-view.test.js`, `node --check js/admin.js`, `node --check js/split-view.js`. Expected: PASS.
- [ ] **Checkpoint:** `js/split-view.js`, `js/admin.js`, `tests/split-view.test.js`.

---

### Task 5: Queue — cards with their next step

**Files:**
- Modify: `js/requests-admin-core.js` (new pure `requestNextStep`)
- Modify: `js/requests-admin-queue.js` (`rowOf`, `draw`, `onTab`, the How rows, tab help)
- Test: `tests/requests-admin.test.js`

**Interfaces:**
- Consumes: Task 2's `cfg` (`toolbar`, `onToolbar`, `showing`, `how`, `tabs[].help`, `rows[].nextLabel`, `onSelect(id, panel, opts)`, `onClose`).
- Produces: `RA.requestNextStep(req, todayKey: 'YYYY-MM-DD') → null | { text: string, label: string|null, act: null | { act: 'arrange', portion } | { act: 'reduction', portion, line } }`, pure, exported on `module.exports`. Rules in order (item number = `(Number.isInteger(line.position) ? line.position : index) + 1`):
  1. `req.status === 'cancelled'` or `requestState(req)` is `arranged` / `cancelled` → `null`.
  2. Lines with open conflicts: one → `One item has an offline edit that needs your decision. Choose Apply or Keep on item N.`; several → `N items have an offline edit that needs your decision. Choose Apply or Keep on each.`; no button.
  3. Portions (any line) with `pending_reduction > 0`: exactly one → `{qty} {unit} was arranged; the request now needs {pending} {unit} less. Say what happened to the order.`, label `Resolve reduction…`, act `reduction`; several → `N reductions are waiting. Resolve each one on its item.`, no button.
  4. Unarranged portions on open lines: exactly one → label `Mark arranged`, act `arrange`; several → no button. Text: overdue (`isOverdue`) → `Needed {formatDay(neededBy)}. Arrange it now or tell the worker when it will arrive.`; else one → `Nothing is arranged yet for this request.` when `requestState` is `unarranged`, `One portion is still to arrange.` when `partly`; several → `N portions are still to arrange. Mark each one arranged on its item.`
  5. Otherwise `null`. Quantities through `formatQty`.

- [ ] **Step 1: Write the failing tests**

```js
test('requestNextStep: a button only for exactly one existing next step', () => {
  const today = '2026-11-16';
  let s = ra.requestNextStep(req({}), today);
  eq(s, { text: 'Nothing is arranged yet for this request.', label: 'Mark arranged', act: { act: 'arrange', portion: 'p' } });
  s = ra.requestNextStep(req({ lines: [line({}), line({ id: 'l2', portions: [portion({ id: 'p2' })] })] }), today);
  eq(s, { text: '2 portions are still to arrange. Mark each one arranged on its item.', label: null, act: null });
  s = ra.requestNextStep(req({ lines: [line({ portions: [portion({ arranged: true })] }), line({ id: 'l2', portions: [portion({ id: 'p2' })] })] }), today);
  eq(s, { text: 'One portion is still to arrange.', label: 'Mark arranged', act: { act: 'arrange', portion: 'p2' } });
  s = ra.requestNextStep(req({ lines: [line({ urgent: true, needed_by: '2026-11-10' })] }), today);
  eq(s.text, 'Needed Tue 10 Nov. Arrange it now or tell the worker when it will arrive.'); eq(s.label, 'Mark arranged');
  s = ra.requestNextStep(req({ lines: [line({ position: 2, open_conflicts: [{ id: 'k' }] })] }), today);
  eq(s, { text: 'One item has an offline edit that needs your decision. Choose Apply or Keep on item 3.', label: null, act: null });
  s = ra.requestNextStep(req({ lines: [line({ unit: 'gal', portions: [portion({ id: 'p9', arranged: true, quantity: 4, pending_reduction: 2 })] })] }), today);
  eq(s, { text: '4 gal was arranged; the request now needs 2 gal less. Say what happened to the order.', label: 'Resolve reduction…', act: { act: 'reduction', portion: 'p9', line: 'l' } });
  eq(ra.requestNextStep(req({ lines: [line({ portions: [portion({ arranged: true })] })] }), today), null);
  eq(ra.requestNextStep(req({ status: 'cancelled' }), today), null);
});

test('Queue cards carry the next step; the pop-up closes cleanly', () => {
  const q = src('js/requests-admin-queue.js');
  ok(/RA\.requestNextStep\(r, today\)/.test(q) && /nextLabel:/.test(q), 'rowOf asks the core');
  ok(/onClose: \(\) => \{[^}]*ui\.selectedId = null/.test(q), 'closing forgets the request');
  ok(/onSelect: \(id, panel, opts\)/.test(q) && /start: !!\(opts && opts\.start\)/.test(q), 'start passed to the item');
  ok(/toolbar: batchSelect\(\)/.test(q) && /showing:/.test(q), 'toolbar and showing');
  for (const s of ['What the labels on a request mean', 'Needed soonest first.', 'A reduction or an offline edit is waiting for your decision.',
    'Nothing arranged yet, or only partly.', 'Closed requests load separately.', 'Requests with something still to arrange or to resolve.'])
    ok(q.includes(s), 'missing: ' + s);
});
```

Update `Queue keeps everything it had (split view)` → name it `Queue keeps everything it had (v5)`; keep every string it checks.

- [ ] **Step 2:** Run `node tests/requests-admin.test.js`. Expected: the two new tests FAIL.
- [ ] **Step 3:** Implement `requestNextStep` in the core's pure half and export it; build its results with keys in the order `text, label, act` and `act` as `{ act, portion }` / `{ act, portion, line }` (the tests compare JSON). In the queue: `rowOf(r, today)` adds `nextLabel: step && step.label || ''`; `draw` passes `toolbar`, `onToolbar`, `showing`, `how`, tab `help` lines, `onClose`, `onSelect(id, panel, opts)` → `RA.renderRequestPanel(panel, id, { onChanged: () => load(), nextLabel: 'Next request', start: !!(opts && opts.start) })`. Tab help: `attn` "Requests with something still to arrange or to resolve." (the code's rule, not the design's narrower sentence), `urgent` "Needed soonest first.", `resolve` "A reduction or an offline edit is waiting for your decision.", `arrange` "Nothing arranged yet, or only partly.", `closed` "Closed requests load separately.", none for `arranged` / `all`. How title "What the labels on a request mean", rows: `URGENT · needed today` → "Needed today." · `URGENT · by [date]` → "Needed by that date." · `OVERDUE N DAYS · needed [date]` → "The date it was needed has passed." · `Red bar on the left` → "An urgent request." · `Dimmed card` → "Finished — nothing left to arrange." The 300 cap stays the gold `notice`. The This week box (`weekHtml`) moves to `aside` unchanged.
- [ ] **Step 4:** Run `node tests/requests-admin.test.js` and `node --check` on both files. Expected: PASS.
- [ ] **Checkpoint:** `js/requests-admin-core.js`, `js/requests-admin-queue.js`, `tests/requests-admin.test.js`.

---

### Task 6: One request in the pop-up — What to do now, start, toasts

**Files:**
- Modify: `js/requests-admin-detail.js` (`draw`, the six forms, the arrange / unarrange handler)
- Test: `tests/requests-admin.test.js`

**Interfaces:**
- Consumes: `SV.nextStep`, `SV.toast`, `SV.form(… doneText)`, `SV.panelHtml({ … step })` (Task 3); `RA.requestNextStep` (Task 5); `hooks.start` (Task 5).
- Produces: `RA.renderRequestPanel(panel, id, hooks)` with `hooks = { onChanged, nextLabel, start }`.

- [ ] **Step 1: Write the failing tests**

```js
test('one request: What to do now uses the real button, and start presses only that', () => {
  const d = src('js/requests-admin-detail.js');
  ok(/RA\.requestNextStep\(req, today\)/.test(d), 'the fresh request decides');
  ok(/SV\.nextStep\(/.test(d) && /step:/.test(d), 'the box is drawn');
  ok(/data-act="' \+ esc\(step\.act\.act\) \+ '"/.test(d), 'its button carries the same data-act as the real one');
  ok(/hooks\.start[\s\S]{0,200}querySelector\('\.sv-step \[data-act\]'\)/.test(d), 'start presses the box button only');
});

test('every save says what it did', () => {
  const d = src('js/requests-admin-detail.js');
  ok((d.match(/doneText:/g) || []).length === 6, 'six forms with a toast');
  for (const s of ['Quantity changed', 'Item cancelled', 'Reduction resolved', 'Moved to another weekly batch',
    'Applied the offline edit', 'Kept the current quantity; offline edit not applied', 'Matched to a catalogue item'])
    ok(d.includes(s), 'missing toast: ' + s);
  ok(/SV\.toast\('Marked '/.test(d) && d.includes('Undid "arranged"'), 'one-press actions too');
});
```

Keep `one request keeps every action, now in the panel` and `Move… and Match open their form only if the panel still shows that request` unchanged (they still hold).

- [ ] **Step 2:** Run `node tests/requests-admin.test.js`. Expected: the two new tests FAIL.
- [ ] **Step 3:** Implement: in `draw`, `const step = RA.requestNextStep(req, today)`; when `step`, build the button only when `step.act` (`att-btn att-btn--primary`, `data-act`, `data-portion`, and `data-line` for `reduction`, label `step.label`) and pass `step: SV.nextStep(step.text, button)` to `panelHtml`; the overdue red notice stays (it is not the step box). After `SV.fill`, `if (hooks.start) { hooks.start = false; const b = panel.querySelector('.sv-step [data-act]'); if (b) b.click(); }`. Arrange success → `SV.toast('Marked ' + RA.formatQty(portion.quantity) + ' ' + line.unit + ' arranged')`; undo → `SV.toast('Undid "arranged"')`. `doneText` on the six forms: Change quantity "Quantity changed", Cancel "Item cancelled", Resolve "Reduction resolved", Move "Moved to another weekly batch", conflict apply "Applied the offline edit (" + qty + " " + unit + ")" / keep "Kept the current quantity; offline edit not applied", Match "Matched to a catalogue item" (or "Removed the catalogue match" when "— No match —" is saved). Update the header comment (pop-up, not panel).
- [ ] **Step 4:** Run `node tests/requests-admin.test.js` and `node --check js/requests-admin-detail.js`. Expected: PASS.
- [ ] **Checkpoint:** `js/requests-admin-detail.js`, `tests/requests-admin.test.js`.

---

### Task 7: Wire-up, docs, full verification

**Files:**
- Modify: `admin.html` (tags for `css/split-view.css`, `css/requests-admin.css`, `js/split-view.js`, `js/requests-admin-core.js`, `js/requests-admin-queue.js`, `js/requests-admin-detail.js`, `js/admin.js` → `?v=20261116a`)
- Modify: `docs/ARCHITECTURE.md:144` (Split view row: cards + pop-up, D5 counts, `closePop`)
- Test: `tests/split-view.test.js` (the wiring fence)

- [ ] **Step 1: Update the wiring fence**

```js
test('the frame is loaded before the Requests scripts, cache-busted', () => {
  const h = src('admin.html');
  for (const f of ['css/split-view.css', 'js/split-view.js', 'js/admin.js', 'js/requests-admin-core.js', 'js/requests-admin-queue.js', 'js/requests-admin-detail.js', 'css/requests-admin.css'])
    ok(h.includes(f + '?v=20261116a'), f + ' cache-busted');
  ok(h.indexOf('js/split-view.js') < h.indexOf('js/requests-admin-core.js'), 'order');
  ok(h.indexOf('css/split-view.css') > h.indexOf('css/admin-renovation.css'), 'frame styles after the shared renovation styles');
});
```

- [ ] **Step 2:** Run `node tests/split-view.test.js`. Expected: FAIL on the tags.
- [ ] **Step 3:** Bump the seven tags (only those lines; leave the indent change at the `lucide.createIcons` line alone). Rewrite the ARCHITECTURE row.
- [ ] **Step 4:** Run `npm test`. Expected: every suite passes; totals = Task 0 baseline + the new tests. Run `node --check` on `js/split-view.js`, `js/admin.js`, `js/requests-admin-core.js`, `js/requests-admin-queue.js`, `js/requests-admin-detail.js`. Expected: no output.
- [ ] **Step 5: Browser check, look only (owner account, then staff@)** — open `admin.html`, Requests → Queue: v5 header, pill tabs with counts, This week box, toolbar, cards in groups; Requests top tab count = Queue count; a card opens the pop-up; ✕, Escape, scrim each close it and focus returns to the card; Next walks the cards; a form opens and Escape goes back to the item; at 400px wide: one column, full-screen pop-up. Press **no** button that writes. Record what was seen.
- [ ] **Step 6: ZZ step list, for the owner's approval** — write (do not run) the step list: create one ZZ request with one line (one portion) and one with two lines from a test worker account; check the one-line card shows **Mark arranged** and pressing it arranges and toasts; the two-line card shows the sentence and no button; Change quantity / Cancel / Move / Match on ZZ lines; clean-up by the ZZ marker. Hand it to the owner.
- [ ] **Checkpoint:** tell the owner the changed files for their commit: `js/split-view.js`, `css/split-view.css`, `js/admin.js`, `js/requests-admin-core.js`, `js/requests-admin-queue.js`, `js/requests-admin-detail.js`, `admin.html` (version lines only), `docs/ARCHITECTURE.md`, `tests/split-view.test.js`, `tests/requests-admin.test.js`, plus the spec, this plan and `docs/design/office-v5/`. The owner commits and pushes; CI green and the owner's look close the phase.
