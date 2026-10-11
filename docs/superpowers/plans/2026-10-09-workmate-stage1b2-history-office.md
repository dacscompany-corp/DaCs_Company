# WorkMate Stage 1b-2 — Item History Office Screens (Dacs Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give owner and staff the Dacs Web screens for Find Previous Item: an *Allow item history* switch per project, catalogue aliases and brand, a new **Item history** view (search, item page with history and photos, historical references) and a **Photos to review** queue — all on top of the live 0090 server.

**Architecture:** Plain JS in the existing Requests section. Pure helpers (dates, aliases, paths, error sentences) go into `js/requests-admin-core.js`, which Node tests load directly. Two new browser files: `js/requests-admin-history.js` (search, item page, references) and `js/requests-admin-gallery.js` (photo upload, cover, retire, review queue). Every change is a 0090 office RPC; photo files go to the private `item-gallery` bucket first (re-encoded in the browser, which also strips GPS metadata), then the RPC records them.

**Tech Stack:** Vanilla JS (IIFE modules on `window.RequestsAdmin`), supabase-js v2 (`sbClient.rpc`, `sbClient.storage`), the shared Attendance `att-*` styles + `css/requests-admin.css`, Node zero-dependency tests (`tests/requests-admin.test.js`).

**Spec:** `docs/superpowers/specs/2026-10-09-workmate-stage1b-item-history-design.md` (§4.5 Dacs Web, §4.2 office functions, §4.1 rules). Server: `supabase/migrations/0090_workmate_item_history.sql` (applied live 2026-10-09).

## Global Constraints

- **Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs Web`. Paths are relative to it.
- **NEVER `git commit` / `git push`.** The user commits. Every task ends "Stop — no commit". **Never run `npm run build`.** No database changes in this plan (0090 is already live).
- **Write files with the Edit tool or Python** (`open(p, 'w', encoding='utf-8', newline='')`), **never PowerShell text output**. All files touched here are **LF** (`admin.html`, `js/admin.js`, `js/requests-admin-*.js`, `css/requests-admin.css`, `tests/requests-admin.test.js`, `docs/ARCHITECTURE.md`) — keep LF.
- **Every write is an office RPC.** The browser never inserts/updates/deletes a `pr_*` table. The only direct reads allowed: `folders` (to list a project's Additional Works) and the two private buckets via `createSignedUrl` / `download`.
- **Office RPCs used (0090/0086):** `pr_office_projects()`, `pr_office_catalog()`, `pr_office_save_item(p_item, p_kind, p_name, p_spec, p_unit, p_category, p_active, p_aliases, p_brand)`, `pr_office_set_allow_requests(p_folder, p_allow)`, `pr_office_set_allow_history(p_folder, p_allow)`, `pr_office_history_search(p_query, p_kind, p_category, p_folder, p_from, p_to, p_limit, p_offset)`, `pr_office_history_item(p_item, p_folder)`, `pr_office_add_ref(p_item, p_folder, p_work, p_description, p_ref_date, p_precision, p_source_note)`, `pr_office_retire_ref(p_ref, p_reason)`, `pr_office_photo_queue()`, `pr_office_publish_photo(p_photo, p_path, p_checklist, p_make_cover)`, `pr_office_keep_private(p_photo)`, `pr_office_add_gallery_photo(p_item, p_path, p_checklist, p_make_cover, p_ref)`, `pr_office_set_cover(p_photo)`, `pr_office_retire_photo(p_photo, p_reason)`.
- **Gallery files:** bucket **`item-gallery`**, path **`<company id>/<catalog item id>/<uuid>.jpg`**, all lower case (`pr_gallery_check_path` refuses anything else), `upload(..., { upsert: false, contentType: 'image/jpeg' })`. Company id = `window.currentDataUserId` (set by `js/admin.js`; staff → their owner's id). Re-encode with `window.DacsReceipts.compressToBlob(source, 1200, 0.8)` before every upload. **Nothing is ever deleted** (no `.remove`, no delete RPC).
- **Checklist:** every upload and every approved copy requires three ticks — *no price/amount/receipt/price tag*, *no face/name/phone/personal detail*, *product only*. Without all three, the browser refuses with `CHECKLIST_REQUIRED` and never uploads.
- **Workers read reference text:** the add-reference form warns staff never to type a price, amount or person's name.
- **No money:** nothing shows or stores a price; staff and owner see the same screens (no `_staff()` hiding needed).
- **Nav:** new view **`reqHistory`** ("Item history") in the Requests `modules[]` of `PRIMARY_NAV` (`js/admin.js`), `REQ_VIEWS` + `TITLES` + a `<div id="reqHistoryView">` in `admin.html`. Not hidden, so `_FOCUS_SUBVIEWS` is unchanged.
- **Cache-busting:** every `requests-admin` script tag and `css/requests-admin.css` carry `?v=20261009b`.

## File structure

| File | Responsibility |
|---|---|
| `js/requests-admin-core.js` (M) | + pure helpers `parseAliases`, `aliasesProblem`, `entryDateLabel`, `entryPill`, `refProblem`, `galleryPath`; + 0090 error sentences; + browser helpers `RA.head`, `RA.signImages` |
| `js/requests-admin-setup.js` (M) | Catalogue: brand + aliases; Projects: *Item history* switch; uses `RA.head` |
| `js/requests-admin-detail.js` (M) | A request line shows "Requested again from …" (`ref_label`) |
| `js/requests-admin-history.js` (C) | `reqHistory` view: tabs, search, item page (photos read-only + history), add/retire historical reference |
| `js/requests-admin-gallery.js` (C) | `RA.gallery`: upload modal, set cover, retire photo, Photos-to-review tab (approve copy / keep private) |
| `css/requests-admin.css` (M) | `.hist-*` styles |
| `admin.html`, `js/admin.js` (M) | View host, `REQ_VIEWS`, `TITLES`, script tags, nav entry |
| `tests/requests-admin.test.js` (M) | Pure-helper tests + static wiring/safety tests |
| `docs/ARCHITECTURE.md` (M) | Requests module-map row |

---

### Task 1: Core helpers, 0090 error sentences, shared head + signed images

**Files:**
- Modify: `js/requests-admin-core.js`
- Modify: `js/requests-admin-setup.js` (only: use `RA.head`)
- Test: `tests/requests-admin.test.js`

**Interfaces:**
- Produces (pure, also on `window.RequestsAdmin`):
  - `parseAliases(text) → string[]` — split on `,` or new line, trim, drop blanks, keep the first spelling of each (case-insensitive).
  - `aliasesProblem(list) → 'BAD_ITEM' | null` — more than 20, or any longer than 60 characters.
  - `entryDateLabel(entry) → string` — `'3 Oct 2026'` (exact), `'around Aug 2026'` (approximate), `'Date unknown'`.
  - `entryPill(entry) → att-pill class` — `Requested` → `att-pill--done`, `Requested — cancelled` → `att-pill--hidden`, `Historical reference` → `att-pill--pc`, any retired entry → `att-pill--hidden`.
  - `refProblem({ description, precision, date }) → 'BAD_REFERENCE' | null` — same rule as `pr_office_add_ref`.
  - `galleryPath(ownerId, itemId, id) → '<owner>/<item>/<id>.jpg'` (lower case); throws without an owner.
  - `ERRORS` gains the 0090 codes plus two browser codes `NO_PHOTO`, `UPLOAD_FAILED`.
- Produces (browser only): `RA.head(title, sub, actions) → html`, `RA.signImages(scope) → Promise` (signs every `<img data-sign-bucket data-sign-path>` inside `scope` for 10 minutes; click opens full size).

- [ ] **Step 1: Write the failing tests**

In `tests/requests-admin.test.js`, replace the whole test `errorMessage maps every 0086 code and never matches a code inside another` with:

```js
test('errorMessage maps every 0086 and 0090 code and never matches a code inside another', () => {
  const codes = ['OFFICE_ONLY', 'NOT_FOUND', 'LINE_CLOSED', 'REDUCTION_PENDING', 'NOTHING_PENDING', 'ALREADY_RESOLVED', 'BAD_QUANTITY',
    'REASON_REQUIRED', 'BAD_CATALOG_ITEM', 'BAD_BATCH', 'BAD_DATES', 'ARRANGED', 'NOT_A_TEAM_LEADER', 'NOT_IN_TEAM', 'DUPLICATE_ITEM',
    'DUPLICATE_TEAM', 'BAD_ITEM', 'BAD_OUTCOME', 'BAD_TEAM', 'BAD_WORKER',
    'HISTORY_NOT_AVAILABLE', 'BAD_REFERENCE', 'BAD_DESTINATION', 'CHECKLIST_REQUIRED', 'BAD_PATH', 'FILE_MISSING',
    'ALREADY_IN_GALLERY', 'ALREADY_REVIEWED', 'NOT_MATCHED', 'PHOTO_RETIRED', 'TOO_MANY_ITEMS', 'NO_PHOTO', 'UPLOAD_FAILED'];
  eq(Object.keys(ra.ERRORS).sort(), codes.slice().sort());
  for (const c of codes) eq(ra.errorMessage({ message: c }), ra.ERRORS[c], c);
  eq(ra.errorMessage({ message: 'BAD_CATALOG_ITEM' }), ra.ERRORS.BAD_CATALOG_ITEM);
  eq(ra.errorMessage({ message: 'NOT_A_TEAM_LEADER' }), ra.ERRORS.NOT_A_TEAM_LEADER);
  eq(ra.errorMessage({ message: 'UPLOAD_FAILED: network error' }), ra.ERRORS.UPLOAD_FAILED);
  eq(ra.errorMessage({ message: 'boom' }), 'Something went wrong: boom');
  eq(ra.errorMessage(null), 'Something went wrong: unknown error');
});
```

Then add, directly above the line `// ── SUMMARY (keep last) ──` near the end of the file:

```js
console.log('\nrequests-admin: item history (0090)');

test('parseAliases trims, drops blanks and keeps one per spelling', () => {
  eq(ra.parseAliases(' saksakan, Plug\n\nplug ,SAKSAKAN, outlet '), ['saksakan', 'Plug', 'outlet']);
  eq(ra.parseAliases(''), []);
  eq(ra.parseAliases(null), []);
});

test('aliasesProblem uses the server caps (20 aliases, 60 characters each)', () => {
  eq(ra.aliasesProblem(['a']), null);
  eq(ra.aliasesProblem(Array.from({ length: 20 }, (_, i) => 'a' + i)), null);
  eq(ra.aliasesProblem(Array.from({ length: 21 }, (_, i) => 'a' + i)), 'BAD_ITEM');
  eq(ra.aliasesProblem(['x'.repeat(61)]), 'BAD_ITEM');
});

test('entryDateLabel: an exact day, "around" a month, or Date unknown — never shifted a day', () => {
  eq(ra.entryDateLabel({ date: '2026-10-03', date_precision: 'exact' }), '3 Oct 2026');
  eq(ra.entryDateLabel({ date: '2026-08-01', date_precision: 'approximate' }), 'around Aug 2026');
  eq(ra.entryDateLabel({ date: null, date_precision: 'unknown' }), 'Date unknown');
  eq(ra.entryDateLabel({ date: null, date_precision: 'exact' }), 'Date unknown');
  eq(ra.entryDateLabel(null), 'Date unknown');
});

test('entryPill: requested, cancelled, reference and retired read differently', () => {
  eq(ra.entryPill({ label: 'Requested' }), 'att-pill--done');
  eq(ra.entryPill({ label: 'Requested — cancelled' }), 'att-pill--hidden');
  eq(ra.entryPill({ label: 'Historical reference' }), 'att-pill--pc');
  eq(ra.entryPill({ label: 'Historical reference', retired: true }), 'att-pill--hidden');
});

test('refProblem mirrors pr_office_add_ref: a description, and a date exactly when not unknown', () => {
  eq(ra.refProblem({ description: 'x', precision: 'exact', date: '2026-10-03' }), null);
  eq(ra.refProblem({ description: 'x', precision: 'approximate', date: '2026-08-01' }), null);
  eq(ra.refProblem({ description: 'x', precision: 'unknown', date: '' }), null);
  eq(ra.refProblem({ description: '  ', precision: 'exact', date: '2026-10-03' }), 'BAD_REFERENCE');
  eq(ra.refProblem({ description: 'x', precision: 'unknown', date: '2026-10-03' }), 'BAD_REFERENCE');
  eq(ra.refProblem({ description: 'x', precision: 'approximate', date: '' }), 'BAD_REFERENCE');
  eq(ra.refProblem({ description: 'x', precision: 'later', date: '2026-10-03' }), 'BAD_REFERENCE');
});

test('galleryPath is <company>/<item>/<uuid>.jpg in lower case, and needs a company', () => {
  eq(ra.galleryPath('AAAA-1', 'BBBB-2', 'CCCC-3'), 'aaaa-1/bbbb-2/cccc-3.jpg');
  let threw = false;
  try { ra.galleryPath(null, 'b', 'c'); } catch (e) { threw = true; }
  eq(threw, true, 'no company');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/requests-admin.test.js`
Expected: FAIL — the error-codes test (missing keys) and the 6 new tests (`ra.parseAliases is not a function` etc.); exit 1.

- [ ] **Step 3: Implement in `js/requests-admin-core.js`**

3a. In the `ERRORS` object, after the line `BAD_WORKER: 'Only active workers and team leaders of your company can join a team.',` add:

```js
        // 0090 — item history
        HISTORY_NOT_AVAILABLE: 'This item has no history to show. Reload the page.',
        BAD_REFERENCE: 'Write what was used, and give a date unless you choose "Date unknown".',
        BAD_DESTINATION: 'Pick the project, then Main Contract or one of that project\'s own Additional Works.',
        CHECKLIST_REQUIRED: 'Tick all three checks before a photo goes to the workers\' gallery.',
        BAD_PATH: 'The photo was stored in the wrong place. Try again.',
        FILE_MISSING: 'The photo upload did not finish. Try again.',
        ALREADY_IN_GALLERY: 'This photo is already in the gallery.',
        ALREADY_REVIEWED: 'Someone already reviewed this photo. Reload the page.',
        NOT_MATCHED: 'Match the request line to a catalogue item first (open the request).',
        PHOTO_RETIRED: 'This photo is retired. Pick an approved photo.',
        TOO_MANY_ITEMS: 'Too many items at once. Try again with fewer.',
        // Browser-side (never sent by the server)
        NO_PHOTO: 'Choose a photo first.',
        UPLOAD_FAILED: 'The photo upload failed. Check the connection and try again.',
```

3b. Directly before the line `const pure = { formatQty, parseQty, …`, add:

```js
    // ── Item history (0090) ─────────────────────────────────────────

    // Workers' own words for an item, comma or new-line separated: trimmed,
    // blanks dropped, one per spelling. The server cleans the same way.
    function parseAliases(text) {
        const seen = new Set();
        const out = [];
        String(text || '').split(/[,\n]/).forEach(s => {
            const a = s.trim();
            if (a && !seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); out.push(a); }
        });
        return out;
    }

    // pr_office_save_item's caps: at most 20 aliases, 60 characters each.
    function aliasesProblem(list) {
        return (list || []).length > 20 || (list || []).some(a => a.length > 60) ? 'BAD_ITEM' : null;
    }

    // A history entry's date is a calendar day (or a month, or unknown):
    // read its parts, never pass it through a time zone.
    function entryDateLabel(e) {
        if (!e || e.date_precision === 'unknown') return 'Date unknown';
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(e.date || ''));
        if (!m) return 'Date unknown';
        if (e.date_precision === 'approximate') return 'around ' + MONTHS[+m[2] - 1] + ' ' + m[1];
        return (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
    }

    const ENTRY_PILL = {
        'Requested': 'att-pill--done',
        'Requested — cancelled': 'att-pill--hidden',
        'Historical reference': 'att-pill--pc',
    };
    function entryPill(e) {
        if (!e || e.retired) return 'att-pill--hidden';
        return ENTRY_PILL[e.label] || 'att-pill--none';
    }

    // pr_office_add_ref's rule: a description, a known precision, and a
    // date exactly when the precision is not 'unknown'.
    function refProblem(r) {
        const v = r || {};
        if (!String(v.description || '').trim()) return 'BAD_REFERENCE';
        if (!['exact', 'approximate', 'unknown'].includes(v.precision)) return 'BAD_REFERENCE';
        const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(String(v.date || ''));
        return (v.precision === 'unknown') === hasDate ? 'BAD_REFERENCE' : null;
    }

    // <company>/<item>/<uuid>.jpg in lower case — the only shape
    // pr_gallery_check_path accepts.
    function galleryPath(ownerId, itemId, id) {
        if (!ownerId) throw new Error('No company account to file the photo under — sign in again.');
        if (!itemId || !id) throw new Error('Missing the item or the photo id.');
        return [ownerId, itemId, id].map(x => String(x).toLowerCase()).join('/') + '.jpg';
    }
```

3c. Replace the `const pure = { … };` statement with:

```js
    const pure = { formatQty, parseQty, manilaParts, formatManila, formatDay, shortDay, cutoffLabel, batchLabel,
                   validateDates, lineState, STATE_LABEL, STATE_PILL, needsAction, requestSummary, sortQueue,
                   filterQueue, eventText, ERRORS, errorMessage, workerNo, itemLabel, catalogMatches,
                   parseAliases, aliasesProblem, entryDateLabel, entryPill, refProblem, galleryPath };
```

3d. In the browser half, directly before `const state = { detailId: null };`, add:

```js
    function head(title, sub, actions) {
        return '<div class="att-head"><div><h2 class="att-title">' + esc(title) + '</h2>' +
            '<p class="att-sub">' + esc(sub) + '</p></div>' +
            (actions ? '<div class="att-head-actions">' + actions + '</div>' : '') + '</div>';
    }

    // <img data-sign-bucket="item-gallery" data-sign-path="…"> → a 10-minute
    // signed link to a PRIVATE bucket; a click opens the full-size photo.
    async function signImages(scope) {
        for (const img of scope.querySelectorAll('img[data-sign-path]')) {
            const { data, error } = await root.sbClient.storage.from(img.dataset.signBucket)
                .createSignedUrl(img.dataset.signPath, 600);
            if (error || !data) { img.alt = 'Photo unavailable'; continue; }
            img.src = data.signedUrl;
            img.addEventListener('click', () => root.open(data.signedUrl, '_blank', 'noopener'));
        }
    }
```

3e. Replace `root.RequestsAdmin = Object.assign({}, pure, { esc, icons, rpc, fail, modal, openRequest, state, views });` with:

```js
    root.RequestsAdmin = Object.assign({}, pure, { esc, icons, rpc, fail, modal, head, signImages, openRequest, state, views });
```

3f. Update the file header comment's file list: after the line `//   js/requests-admin-setup.js  — weekly batches, teams, catalogue, projects` add:

```js
//   js/requests-admin-history.js — Item history: search, item page, references (0090)
//   js/requests-admin-gallery.js — Item history: product photos and photo review (0090)
```

and change `// Every change goes through a 0086 office RPC; nothing here writes a table.` to `// Every change goes through a 0086/0090 office RPC; nothing here writes a table.`

- [ ] **Step 4: `js/requests-admin-setup.js` uses the shared head**

Replace the whole local function

```js
    function head(title, sub, actions) {
        return '<div class="att-head"><div><h2 class="att-title">' + esc(title) + '</h2>' +
            '<p class="att-sub">' + esc(sub) + '</p></div>' +
            (actions ? '<div class="att-head-actions">' + actions + '</div>' : '') + '</div>';
    }
```

with:

```js
    const head = RA.head;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node tests/requests-admin.test.js`
Expected: all pass, `24 passed, 0 failed`.
Run: `node --check js/requests-admin-core.js && node --check js/requests-admin-setup.js` → no output.
Run: `npm test` → all suites green.

- [ ] **Step 6: Stop — no commit.** Report to the controller.

---

### Task 2: Catalogue aliases + brand, Projects history switch, request source label

**Files:**
- Modify: `js/requests-admin-setup.js` (`itemModal`, `renderCatalog`, `renderProjects`)
- Modify: `js/requests-admin-detail.js` (`lineCard`)
- Test: `tests/requests-admin.test.js`

**Interfaces:**
- Consumes (Task 1): `RA.parseAliases`, `RA.aliasesProblem`, `RA.head`.
- Consumes (live 0090): `pr_office_catalog()` items now carry `brand` (text) and `aliases` (array); `pr_office_projects()` rows carry `allow_history`; `pr_office_request()` lines carry `ref_label` (null when the line has no Request Again link).

- [ ] **Step 1: Write the failing static tests**

In `tests/requests-admin.test.js`, directly after the line `const ra = require('../js/requests-admin-core.js');` add:

```js
const fs = require('fs');
const path = require('path');
const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
function ok(cond, msg) { if (!cond) throw new Error(msg); }
```

Then add, directly above `// ── SUMMARY (keep last) ──`:

```js
console.log('\nrequests-admin: catalogue, projects and request detail (0090)');

test('the catalogue form sends aliases and brand, checked against the server caps', () => {
  const s = src('js/requests-admin-setup.js');
  ok(s.includes('RA.parseAliases(form.aliases.value)'), 'aliases parsed from the form');
  ok(s.includes('RA.aliasesProblem(aliases)'), 'aliases capped before sending');
  ok(s.includes('p_aliases: aliases,') && s.includes('p_brand: form.brand.value.trim(),'), 'save sends p_aliases and p_brand');
  ok(/\[i\.name, i\.spec, i\.unit, i\.category, i\.brand\]\.concat\(i\.aliases \|\| \[\]\)/.test(s), 'catalogue search includes brand and aliases');
});

test('the Projects tab switches Item history separately from Allow requests', () => {
  const s = src('js/requests-admin-setup.js');
  ok(s.includes("RA.rpc('pr_office_set_allow_history', { p_folder: box.dataset.history, p_allow: box.checked })"), 'calls pr_office_set_allow_history');
  ok(s.includes('p.allow_history ? \' checked\' : \'\''), 'checkbox reflects allow_history');
  ok(s.includes("RA.rpc('pr_office_set_allow_requests', { p_folder: box.dataset.folder, p_allow: box.checked })"), 'Allow requests unchanged');
});

test('a request line shows where Request Again came from', () => {
  ok(src('js/requests-admin-detail.js').includes("line.ref_label ? '<div class=\"att-fact\"><div class=\"att-fact-label\">Requested again from</div>"), 'detail renders ref_label');
});

test('setup uses the shared RA.head', () => {
  ok(!/function head\(/.test(src('js/requests-admin-setup.js')), 'no private head() left in setup');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/requests-admin.test.js`
Expected: the first three new tests FAIL; "setup uses the shared RA.head" passes (Task 1); exit 1.

- [ ] **Step 3: Catalogue — replace `itemModal` in `js/requests-admin-setup.js`**

Replace the whole `function itemModal(item, rerender) { … }` with:

```js
    function itemModal(item, rerender) {
        const v = item || { kind: 'material', name: '', spec: '', unit: '', category: '', brand: '', aliases: [], active: true };
        RA.modal({
            title: item ? 'Edit item' : 'New item',
            sub: 'One row = one exact item. A different size or unit is a different item.',
            body:
                '<div class="att-field"><label for="reqKind">Kind</label><select class="att-input" id="reqKind" name="kind">' +
                  '<option value="material"' + (v.kind === 'material' ? ' selected' : '') + '>Material</option>' +
                  '<option value="tool"' + (v.kind === 'tool' ? ' selected' : '') + '>Tool</option></select></div>' +
                '<div class="att-field"><label for="reqCat">Category <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqCat" name="category" maxlength="60" value="' + esc(v.category) + '" placeholder="e.g. plumbing"></div>' +
                '<div class="att-field att-span"><label for="reqName">Name</label>' +
                  '<input class="att-input" id="reqName" name="name" maxlength="120" value="' + esc(v.name) + '" placeholder="e.g. PVC pipe"></div>' +
                '<div class="att-field"><label for="reqSpec">Size / spec <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqSpec" name="spec" maxlength="120" value="' + esc(v.spec) + '" placeholder="e.g. 1/2 in, 3 m"></div>' +
                '<div class="att-field"><label for="reqUnit">Unit</label>' +
                  '<input class="att-input" id="reqUnit" name="unit" maxlength="30" value="' + esc(v.unit) + '" placeholder="e.g. pc, bag, m"></div>' +
                '<div class="att-field att-span"><label for="reqBrand">Brand <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqBrand" name="brand" maxlength="80" value="' + esc(v.brand || '') + '" placeholder="e.g. Omni"></div>' +
                '<div class="att-field att-span"><label for="reqAliases">Other names workers use <span class="att-hint-inline">(optional — for search only)</span></label>' +
                  '<textarea class="att-input" id="reqAliases" name="aliases" rows="2" placeholder="e.g. saksakan, outlet, plug">' +
                    esc((v.aliases || []).join(', ')) + '</textarea></div>' +
                (item ? '<label class="req-toggle att-span"><input type="checkbox" name="active"' + (v.active ? ' checked' : '') + '> Active (workers can pick it)</label>' : ''),
            submitLabel: item ? 'Save' : 'Add item',
            onSubmit: async (form) => {
                const aliases = RA.parseAliases(form.aliases.value);
                const problem = RA.aliasesProblem(aliases);
                if (problem) throw new Error(problem);
                await RA.rpc('pr_office_save_item', {
                    p_item: item ? item.id : null,
                    p_kind: form.kind.value,
                    p_name: form.name.value.trim(),
                    p_spec: form.spec.value.trim(),
                    p_unit: form.unit.value.trim(),
                    p_category: form.category.value.trim(),
                    p_active: item ? form.active.checked : true,
                    p_aliases: aliases,
                    p_brand: form.brand.value.trim(),
                });
            },
            onDone: rerender,
        });
    }
```

- [ ] **Step 4: Catalogue table — brand column, aliases, search**

In `renderCatalog`:

4a. In the search input, change the placeholder text `Search name, size, unit, category…` to `Search name, size, unit, category, brand, other names…` (it sits inside `placeholder="…"`).

4b. Replace the table header `<th>Kind</th><th>Name</th><th>Size / spec</th><th>Unit</th><th>Category</th><th>Status</th><th></th>` with `<th>Kind</th><th>Name</th><th>Size / spec</th><th>Unit</th><th>Category</th><th>Brand</th><th>Status</th><th></th>`.

4c. Replace the whole `function draw() { … }` with:

```js
        function draw() {
            const t = catUi.text.trim().toLowerCase();
            const list = items.filter(i => (catUi.showInactive || i.active) && (!catUi.kind || i.kind === catUi.kind) &&
                (!t || [i.name, i.spec, i.unit, i.category, i.brand].concat(i.aliases || []).join(' ').toLowerCase().includes(t)));
            host.querySelector('[data-rows]').innerHTML = list.map(i =>
                '<tr><td>' + (i.kind === 'tool' ? 'Tool' : 'Material') + '</td><td><strong>' + esc(i.name) + '</strong>' +
                  ((i.aliases || []).length ? '<div class="req-muted">Also called: ' + esc(i.aliases.join(', ')) + '</div>' : '') + '</td>' +
                '<td>' + esc(i.spec || '—') + '</td><td>' + esc(i.unit) + '</td><td>' + esc(i.category || '—') + '</td>' +
                '<td>' + esc(i.brand || '—') + '</td>' +
                '<td>' + (i.active ? '<span class="att-pill att-pill--done">Active</span>' : '<span class="att-pill att-pill--hidden">Inactive</span>') + '</td>' +
                '<td><button class="att-btn" type="button" data-edit="' + esc(i.id) + '">Edit…</button></td></tr>').join('');
            host.querySelector('[data-empty]').style.display = list.length ? 'none' : 'block';
        }
```

- [ ] **Step 5: Projects — the Item history switch**

Replace the whole `async function renderProjects(host) { … }` with:

```js
    async function renderProjects(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading projects…</div></div>';
        let projects;
        try { projects = await RA.rpc('pr_office_projects'); } catch (e) { RA.fail(host, e); return; }
        projects = projects || [];
        host.innerHTML =
            '<div class="att-stack">' +
              head('Projects open to requests', 'A Project Control project accepts requests while it is on today\'s Time In list, or when Allow requests is on — use that for an upcoming site with no geofence yet. Completed projects never accept requests. Open Additional Works under a project are offered with it. Item history lets workers browse what was requested on that project before (Find Previous Item); it is separate from Allow requests and stays on after the project is completed.') +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<div class="req-table-wrap"><table class="att-table"><thead><tr><th>Project</th><th>Additional Works</th><th>Requests</th><th>Allow requests</th><th>Item history</th></tr></thead><tbody>' +
                projects.map(p =>
                    '<tr><td><strong>' + esc(p.name) + '</strong></td>' +
                    '<td>' + esc(String(p.additional_works)) + ' open</td>' +
                    '<td>' + requestableNote(p) + '</td>' +
                    '<td><label class="req-toggle"><input type="checkbox" data-folder="' + esc(p.folder_id) + '"' +
                      (p.allow_requests ? ' checked' : '') + (p.completed ? ' disabled' : '') + '> ' +
                      (p.allow_requests ? 'On' : 'Off') + '</label></td>' +
                    '<td><label class="req-toggle"><input type="checkbox" data-history="' + esc(p.folder_id) + '"' +
                      (p.allow_history ? ' checked' : '') + '> ' + (p.allow_history ? 'Workers can browse' : 'Off') + '</label></td></tr>').join('') +
                '</tbody></table></div>' +
                (projects.length ? '' : '<div class="att-empty">No Project Control projects yet.</div>') +
              '</div></div>' +
            '</div>';
        host.querySelectorAll('input[data-folder]').forEach(box => box.addEventListener('change', async () => {
            box.disabled = true;
            try {
                await RA.rpc('pr_office_set_allow_requests', { p_folder: box.dataset.folder, p_allow: box.checked });
                renderProjects(host);
            } catch (err) {
                alert(RA.errorMessage(err));
                box.checked = !box.checked;
                box.disabled = false;
            }
        }));
        host.querySelectorAll('input[data-history]').forEach(box => box.addEventListener('change', async () => {
            box.disabled = true;
            try {
                await RA.rpc('pr_office_set_allow_history', { p_folder: box.dataset.history, p_allow: box.checked });
                renderProjects(host);
            } catch (err) {
                alert(RA.errorMessage(err));
                box.checked = !box.checked;
                box.disabled = false;
            }
        }));
        RA.icons();
    }
```

Also update this file's header: `// Every change is a 0086 office RPC.` → `// Every change is a 0086/0090 office RPC.` and `//   reqProjects — which Project Control projects accept requests` → `//   reqProjects — which projects accept requests, and show their item history`.

- [ ] **Step 6: Request detail — the source label**

In `js/requests-admin-detail.js` `lineCard`, directly after the catalogue fact (the line ending `(line.catalog_item_id ? 'Change' : 'Match') + '</button></div></div>' +`) insert:

```js
                (line.ref_label ? '<div class="att-fact"><div class="att-fact-label">Requested again from</div><div class="att-fact-val">' +
                  esc(line.ref_label) + '</div></div>' : '') +
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node tests/requests-admin.test.js` → `28 passed, 0 failed`.
Run: `node --check js/requests-admin-setup.js && node --check js/requests-admin-detail.js` → no output.
Run: `npm test` → all green.

- [ ] **Step 8: Stop — no commit.** Report to the controller.

---

### Task 3: The Item history view — search, item page, historical references

**Files:**
- Create: `js/requests-admin-history.js`
- Modify: `css/requests-admin.css` (append `.hist-*` styles)
- Modify: `admin.html` (view host, `REQ_VIEWS`, `TITLES`, script + css tags with `?v=20261009b`)
- Modify: `js/admin.js` (Requests `modules[]` entry)
- Test: `tests/requests-admin.test.js`

**Interfaces:**
- Consumes (Task 1): `RA.head`, `RA.signImages`, `RA.entryDateLabel`, `RA.entryPill`, `RA.refProblem`, `RA.itemLabel`, `RA.formatQty`, `RA.modal`, `RA.rpc`, `RA.fail`, `RA.icons`, `RA.errorMessage`.
- Consumes (Task 4, called only on click, so this task works on its own): `RA.gallery.uploadModal(item, rerender)`, `RA.gallery.setCover(photoId, button, rerender)`, `RA.gallery.retireModal(photo, rerender)`, `RA.gallery.renderReview(host, nav)` where `nav = { tabsHtml, wireTabs }`.
- Produces: `RA.views.reqHistory = render` (the view). `render(host)` shows the search tab, the item page (when an item is open) or — via `RA.gallery.renderReview` — the review tab.
- Server data used (0090): search → `{ items: [{ id, kind, name, spec, unit, category, brand, aliases, active, cover_path, latest: { entry_kind, entry_id, label, project_id, project_name, work_id, work_name, date, date_precision } | null }], has_more }`; item → `{ id, kind, name, spec, unit, category, brand, aliases, active, photos: [{ id, path, is_cover, status, source, approved_at, approved_by_name, retired_at, retire_reason }], entries: [{ entry_kind, entry_id, label, project_id, project_name, work_id, work_name, date, date_precision, quantity, unit, description, note, retired, requester_name }] }`.

- [ ] **Step 1: Write the failing static tests**

Add directly above `// ── SUMMARY (keep last) ──` in `tests/requests-admin.test.js`:

```js
console.log('\nrequests-admin: item history screen (0090)');

test('Item history is wired into the Requests section', () => {
  const html = src('admin.html'), nav = src('js/admin.js');
  ok(html.includes('<div id="reqHistoryView"     class="content-view" style="display: none;"></div>'), 'view host');
  ok(/const REQ_VIEWS\s*=\s*\[[^\]]*'reqHistory'/.test(html), 'REQ_VIEWS lists reqHistory');
  ok(/reqHistory:\s*'Item history'/.test(html), 'title');
  const core = html.indexOf('js/requests-admin-core.js'), hist = html.indexOf('js/requests-admin-history.js');
  ok(core > 0 && hist > core, 'the history script loads after the core');
  ok(html.includes('css/requests-admin.css?v=20261009b') && html.includes('js/requests-admin-history.js?v=20261009b'), 'cache-busted');
  const start = nav.indexOf("id: 'requests'");
  const block = nav.slice(start, nav.indexOf(']', start));
  ok(block.includes("{ view: 'reqHistory'"), 'PRIMARY_NAV Requests lists reqHistory');
});

test('the history screen writes only through 0090 office RPCs and warns about reference text', () => {
  const s = src('js/requests-admin-history.js');
  ok(s.includes('RA.views.reqHistory = render;'), 'registers the view');
  const rpcs = [...s.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]);
  const allowed = ['pr_office_projects', 'pr_office_catalog', 'pr_office_history_search', 'pr_office_history_item',
                   'pr_office_add_ref', 'pr_office_retire_ref'];
  ok(rpcs.length > 0 && rpcs.every(r => allowed.includes(r)), 'unexpected RPC: ' + rpcs.filter(r => !allowed.includes(r)).join(', '));
  ok(!/\.(insert|update|delete|upsert|remove)\(/.test(s), 'no direct writes');
  ok(!/\.from\('pr_/.test(s), 'no direct pr_ table access');
  ok(s.includes("root.sbClient.from('folders').select('id, name, completed_at')"), 'reads Additional Works from folders only');
  ok(s.includes('RA.refProblem(ref)'), 'checks a reference before sending it');
  ok(/Never type a price, an amount or a person/.test(s), 'warns that workers read the reference text');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/requests-admin.test.js`
Expected: the 2 new tests FAIL (`ENOENT … requests-admin-history.js`, missing view host); exit 1.

- [ ] **Step 3: Create `js/requests-admin-history.js`**

```js
// ════════════════════════════════════════════════════════════════════
// Requests → Item history (WorkMate Stage 1b, 0090). Owner + staff.
//
// The office side of Find Previous Item: search the company's catalogue
// items with their dated history (requests matched to the item plus
// hand-entered historical references), add or retire a historical
// reference, and see the item's photos. Uploading photos, the cover,
// retiring, and reviewing workers' private request photos live in
// js/requests-admin-gallery.js (RA.gallery).
// Every change is a 0090 office RPC. NO MONEY anywhere. Workers see a
// project's history only when Item history is on for it (Projects tab).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const PAGE = 30;
    const SOURCE_LABEL = {
        upload: 'Uploaded by the office',
        request_photo: 'Copy of a request photo',
        reference: 'For a historical reference',
    };

    // Kept while switching views, so Back returns to the same search.
    const ui = { tab: 'search', text: '', kind: '', category: '', folder: '', from: '', to: '',
                 items: [], hasMore: false, itemId: null };
    let lookups = null;   // { projects, categories } — loaded once per page load

    async function loadLookups() {
        if (lookups) return lookups;
        const [projects, catalog] = await Promise.all([RA.rpc('pr_office_projects'), RA.rpc('pr_office_catalog')]);
        const categories = [...new Set((catalog || []).map(c => c.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        lookups = { projects: projects || [], categories };
        return lookups;
    }

    function tabsHtml() {
        const tab = (id, label) => '<button class="att-btn' + (ui.tab === id ? ' att-btn--primary' : '') +
            '" type="button" data-tab="' + id + '">' + esc(label) + '</button>';
        return '<div class="req-actions">' + tab('search', 'Search items') + tab('review', 'Photos to review') + '</div>';
    }

    function wireTabs(host) {
        host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            ui.tab = b.dataset.tab;
            render(host);
        }));
    }

    function thumbHtml(path) {
        return path
            ? '<img class="hist-thumb" alt="Item photo" data-sign-bucket="item-gallery" data-sign-path="' + esc(path) + '">'
            : '<div class="hist-thumb hist-thumb--empty" aria-hidden="true"><i data-lucide="image"></i></div>';
    }

    function whereLabel(e) {
        return esc(e.project_name || '—') + ' · ' + esc(e.work_name || 'Main Contract');
    }

    function latestHtml(latest) {
        if (!latest) return '<span class="req-muted">No history yet</span>';
        return '<span class="att-pill ' + RA.entryPill(latest) + '">' + esc(latest.label) + '</span>' +
            '<div class="req-muted">' + whereLabel(latest) + ' · ' + esc(RA.entryDateLabel(latest)) + '</div>';
    }

    function searchArgs(offset) {
        return { p_query: ui.text, p_kind: ui.kind || null, p_category: ui.category || null, p_folder: ui.folder || null,
                 p_from: ui.from || null, p_to: ui.to || null, p_limit: PAGE, p_offset: offset };
    }

    // ── Search ──────────────────────────────────────────────────────

    async function renderSearch(host, append) {
        if (!append) {
            ui.items = [];
            ui.hasMore = false;
            host.innerHTML = '<div class="att-stack"><div class="att-empty">Searching…</div></div>';
        }
        let look, page;
        try {
            look = await loadLookups();
            page = await RA.rpc('pr_office_history_search', searchArgs(ui.items.length));
        } catch (e) { RA.fail(host, e); return; }
        ui.items = ui.items.concat((page && page.items) || []);
        ui.hasMore = !!(page && page.has_more);
        const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
        host.innerHTML =
            '<div class="att-stack">' +
              RA.head('Item history', 'Items the company asked for before, with their dated history and reviewed photos. Workers see a project\'s history only when Item history is on for it (Projects tab). No prices are ever shown.') +
              tabsHtml() +
              '<form class="att-toolbar" data-search>' +
                '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                  '<input class="att-search" type="search" name="text" aria-label="Search" placeholder="Name, other names, brand, size, category…" value="' + esc(ui.text) + '"></div>' +
                '<select class="att-filter" name="kind" aria-label="Kind">' +
                  opt('', 'Materials and tools', ui.kind) + opt('material', 'Materials', ui.kind) + opt('tool', 'Tools', ui.kind) + '</select>' +
                '<select class="att-filter" name="category" aria-label="Category">' + opt('', 'All categories', ui.category) +
                  look.categories.map(c => opt(c, c, ui.category)).join('') + '</select>' +
                '<select class="att-filter" name="folder" aria-label="Project">' + opt('', 'All projects', ui.folder) +
                  look.projects.map(p => opt(p.folder_id, p.name, ui.folder)).join('') + '</select>' +
                '<label class="req-toggle">From <input class="att-input" type="date" name="from" value="' + esc(ui.from) + '"></label>' +
                '<label class="req-toggle">To <input class="att-input" type="date" name="to" value="' + esc(ui.to) + '"></label>' +
                '<button class="att-btn att-btn--primary" type="submit">Search</button>' +
              '</form>' +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<div class="req-table-wrap"><table class="att-table"><thead><tr><th></th><th>Item</th><th>Kind</th><th>Brand</th><th>Latest</th></tr></thead><tbody>' +
                ui.items.map(i =>
                    '<tr class="req-row" tabindex="0" data-item="' + esc(i.id) + '">' +
                      '<td>' + thumbHtml(i.cover_path) + '</td>' +
                      '<td><strong>' + esc(RA.itemLabel(i)) + '</strong>' +
                        (i.active ? '' : ' <span class="att-pill att-pill--hidden">No longer listed</span>') +
                        ((i.aliases || []).length ? '<div class="req-muted">Also called: ' + esc(i.aliases.join(', ')) + '</div>' : '') + '</td>' +
                      '<td>' + (i.kind === 'tool' ? 'Tool' : 'Material') + '</td>' +
                      '<td>' + esc(i.brand || '—') + '</td>' +
                      '<td>' + latestHtml(i.latest) + '</td></tr>').join('') +
                '</tbody></table></div>' +
                (ui.items.length ? '' : '<div class="att-empty">No item matches. Items are added in the Catalogue tab.</div>') +
              '</div></div>' +
              (ui.hasMore ? '<div class="req-actions"><button class="att-btn" type="button" data-more>Show more</button></div>' : '') +
            '</div>';
        wireTabs(host);
        host.querySelector('[data-search]').addEventListener('submit', e => {
            e.preventDefault();
            const f = e.target;
            Object.assign(ui, { text: f.text.value.trim(), kind: f.kind.value, category: f.category.value,
                                folder: f.folder.value, from: f.from.value, to: f.to.value });
            renderSearch(host);
        });
        const more = host.querySelector('[data-more]');
        if (more) more.addEventListener('click', () => { more.disabled = true; renderSearch(host, true); });
        host.querySelectorAll('[data-item]').forEach(row => {
            const open = () => { ui.itemId = row.dataset.item; renderItem(host); };
            row.addEventListener('click', open);
            row.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
        });
        RA.icons();
        RA.signImages(host);
    }

    // ── One item ────────────────────────────────────────────────────

    function photoCard(p) {
        const approved = p.status === 'approved';
        return '<div class="hist-photo-card' + (approved ? '' : ' hist-photo-card--retired') + '">' +
            '<img class="req-photo" alt="Item photo" data-sign-bucket="item-gallery" data-sign-path="' + esc(p.path) + '">' +
            '<div>' + (p.is_cover ? '<span class="att-pill att-pill--done">Cover</span> ' : '') +
              (approved ? '' : '<span class="att-pill att-pill--hidden">Retired</span>') + '</div>' +
            '<div class="req-muted">' + esc(SOURCE_LABEL[p.source] || '') + (p.approved_by_name ? ' · ' + esc(p.approved_by_name) : '') + '</div>' +
            (approved
                ? '<div class="req-actions">' +
                    (p.is_cover ? '' : '<button class="att-btn" type="button" data-act="cover" data-id="' + esc(p.id) + '">Make cover</button>') +
                    '<button class="att-btn att-btn--warn" type="button" data-act="retire-photo" data-id="' + esc(p.id) + '">Retire…</button></div>'
                : '<div class="req-muted">' + esc(p.retire_reason || '') + '</div>') +
            '</div>';
    }

    function entryRow(e) {
        const canRetire = e.entry_kind === 'reference' && !e.retired;
        return '<tr>' +
            '<td><span class="att-pill ' + RA.entryPill(e) + '">' + esc(e.label) + '</span>' +
              (e.retired ? ' <span class="att-pill att-pill--hidden">Retired</span>' : '') + '</td>' +
            '<td>' + whereLabel(e) + '</td>' +
            '<td>' + esc(RA.entryDateLabel(e)) + '</td>' +
            '<td>' + (e.quantity === null || e.quantity === undefined ? '—' : esc(RA.formatQty(e.quantity)) + ' ' + esc(e.unit || '')) + '</td>' +
            '<td>' + esc([e.description, e.note].filter(Boolean).join(' — ') || '—') +
              (e.requester_name ? '<div class="req-muted">Requested by ' + esc(e.requester_name) + '</div>' : '') + '</td>' +
            '<td>' + (canRetire ? '<button class="att-btn att-btn--warn" type="button" data-act="retire-ref" data-id="' + esc(e.entry_id) + '">Retire…</button>' : '') + '</td>' +
            '</tr>';
    }

    async function renderItem(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the item…</div></div>';
        let look, item;
        try {
            look = await loadLookups();
            item = await RA.rpc('pr_office_history_item', { p_item: ui.itemId });
        } catch (e) { RA.fail(host, e); return; }
        const rerender = () => renderItem(host);
        const photos = item.photos || [];
        const entries = item.entries || [];
        const about = [item.kind === 'tool' ? 'Tool' : 'Material', item.brand, item.category,
                       (item.aliases || []).length ? 'also called ' + item.aliases.join(', ') : '',
                       item.active ? '' : 'no longer listed — workers cannot request it again'].filter(Boolean).join(' · ');
        host.innerHTML =
            '<div class="att-stack">' +
              '<div class="req-actions"><button class="att-btn" type="button" data-back><i data-lucide="arrow-left"></i> Back to results</button></div>' +
              RA.head(RA.itemLabel(item), about) +
              '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">Photos</div>' +
                '<div class="att-card-sub">Workers see approved photos only, cover first. Retired photos stay here for the record.</div></div>' +
                '<div class="att-card-tools"><button class="att-btn att-btn--primary" type="button" data-act="upload">Upload photo…</button></div></div>' +
                '<div class="att-card-body">' +
                  (photos.length ? '<div class="hist-photos">' + photos.map(photoCard).join('') + '</div>' : '<div class="att-empty">No photos yet.</div>') +
              '</div></div>' +
              '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">History</div>' +
                '<div class="att-card-sub">Requests matched to this item and hand-entered historical references, newest first. A historical reference creates no expense, stock or purchase.</div></div>' +
                '<div class="att-card-tools"><button class="att-btn att-btn--primary" type="button" data-act="add-ref">Add historical reference…</button></div></div>' +
                '<div class="att-card-body" style="padding:0">' +
                  (entries.length
                    ? '<div class="req-table-wrap"><table class="att-table"><thead><tr><th>What</th><th>Where</th><th>When</th><th>Quantity</th><th>Details</th><th></th></tr></thead><tbody>' +
                      entries.map(entryRow).join('') + '</tbody></table></div>'
                    : '<div class="att-empty">No history yet.</div>') +
              '</div></div>' +
            '</div>';
        const stack = host.firstElementChild;
        stack.querySelector('[data-back]').addEventListener('click', () => { ui.itemId = null; renderSearch(host); });
        stack.addEventListener('click', e => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const act = b.dataset.act;
            if (act === 'add-ref') refModal(item, look, rerender);
            else if (act === 'retire-ref') retireRefModal(entries.find(x => x.entry_id === b.dataset.id), rerender);
            else if (act === 'upload') RA.gallery.uploadModal(item, rerender);
            else if (act === 'cover') RA.gallery.setCover(b.dataset.id, b, rerender);
            else if (act === 'retire-photo') RA.gallery.retireModal(photos.find(p => p.id === b.dataset.id), rerender);
        });
        RA.icons();
        RA.signImages(host);
    }

    // ── Historical references ───────────────────────────────────────

    // A project's own Additional Works (owner/staff may read their folders).
    async function workOptions(projectId) {
        const { data, error } = await root.sbClient.from('folders').select('id, name, completed_at')
            .eq('parent_folder_id', projectId).order('name');
        if (error) throw error;
        return data || [];
    }

    function refModal(item, look, rerender) {
        RA.modal({
            title: 'Add historical reference',
            sub: RA.itemLabel(item) + ' — for items used before WorkMate. It creates no expense, stock or purchase.',
            body:
                '<div class="att-field att-span"><label for="histProject">Project</label><select class="att-input" id="histProject" name="project">' +
                  '<option value="">Choose a project…</option>' +
                  look.projects.map(p => '<option value="' + esc(p.folder_id) + '">' + esc(p.name) + (p.completed ? ' (completed)' : '') + '</option>').join('') +
                '</select></div>' +
                '<div class="att-field att-span"><label for="histWork">Main Contract or Additional Works</label>' +
                  '<select class="att-input" id="histWork" name="work" disabled><option value="">Choose a project first</option></select></div>' +
                '<div class="att-field att-span"><label for="histDesc">What was used</label>' +
                  '<input class="att-input" id="histDesc" name="description" maxlength="300" placeholder="e.g. Outlets for the kitchen counter"></div>' +
                '<div class="att-field"><label for="histPrecision">Date</label><select class="att-input" id="histPrecision" name="precision">' +
                  '<option value="exact">Exact day</option><option value="approximate">Around a month</option><option value="unknown">Date unknown</option></select></div>' +
                '<div class="att-field"><label for="histDate">Day <span class="att-hint-inline">(for "Around", any day in that month)</span></label>' +
                  '<input class="att-input" id="histDate" name="date" type="date"></div>' +
                '<div class="att-field att-span"><label for="histNote">Where this came from <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="histNote" name="note" maxlength="300" placeholder="e.g. old Messenger photo, site diary"></div>' +
                '<div class="att-info att-span"><i data-lucide="eye"></i><div>Workers can read what was used and where it came from. Never type a price, an amount or a person\'s name.</div></div>',
            submitLabel: 'Add reference',
            onOpen: (form) => {
                form.project.addEventListener('change', async () => {
                    const pid = form.project.value;
                    form.work.disabled = true;
                    if (!pid) { form.work.innerHTML = '<option value="">Choose a project first</option>'; return; }
                    form.work.innerHTML = '<option value="">Loading…</option>';
                    let children = [];
                    try {
                        children = await workOptions(pid);
                    } catch (e) {
                        const box = form.querySelector('[data-error]');
                        box.textContent = 'Couldn\'t load the Additional Works (' + RA.errorMessage(e) + '). Main Contract is still available.';
                        box.style.display = 'block';
                    }
                    form.work.innerHTML = '<option value="' + esc(pid) + '">Main Contract</option>' +
                        children.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.completed_at ? ' (completed)' : '') + '</option>').join('');
                    form.work.disabled = false;
                });
                form.precision.addEventListener('change', () => {
                    form.date.disabled = form.precision.value === 'unknown';
                    if (form.date.disabled) form.date.value = '';
                });
            },
            onSubmit: async (form) => {
                if (!form.project.value || !form.work.value) throw new Error('BAD_DESTINATION');
                const ref = { description: form.description.value, precision: form.precision.value, date: form.date.value };
                const problem = RA.refProblem(ref);
                if (problem) throw new Error(problem);
                await RA.rpc('pr_office_add_ref', {
                    p_item: item.id,
                    p_folder: form.project.value,
                    p_work: form.work.value,
                    p_description: ref.description.trim(),
                    p_ref_date: ref.precision === 'unknown' ? null : ref.date,
                    p_precision: ref.precision,
                    p_source_note: form.note.value.trim(),
                });
            },
            onDone: rerender,
        });
    }

    function retireRefModal(entry, rerender) {
        if (!entry) return;
        RA.modal({
            title: 'Retire historical reference',
            sub: 'Workers stop seeing it. The office keeps it, marked retired, with your reason.',
            body: '<div class="att-field att-span"><label for="histReason">Why</label>' +
                  '<input class="att-input" id="histReason" name="reason" maxlength="200" placeholder="e.g. wrong item, entered twice"></div>',
            submitLabel: 'Retire',
            warn: true,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_retire_ref', { p_ref: entry.entry_id, p_reason: form.reason.value.trim() });
            },
            onDone: rerender,
        });
    }

    // ── The view ────────────────────────────────────────────────────

    async function render(host) {
        if (ui.tab === 'review') {
            if (!RA.gallery) { RA.fail(host, new Error('The photo review screen did not load. Reload the page.')); return; }
            return RA.gallery.renderReview(host, { tabsHtml, wireTabs });
        }
        return ui.itemId ? renderItem(host) : renderSearch(host);
    }

    RA.views.reqHistory = render;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Append to `css/requests-admin.css`** (before the final `@media (max-width: 640px)` block):

```css
/* Item history (0090) — thumbnails, photo grid, review queue, checklist. */
.hist-thumb {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    border: 1px solid var(--att-line);
    object-fit: cover;
    background: var(--att-field);
    display: block;
    cursor: zoom-in;
}
.hist-thumb--empty { display: flex; align-items: center; justify-content: center; color: var(--att-muted); cursor: default; }
.hist-thumb--empty svg { width: 18px; height: 18px; }
.hist-photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.hist-photo-card { display: grid; gap: 6px; align-content: start; }
.hist-photo-card .req-photo { width: 100%; height: 140px; }
.hist-photo-card--retired { opacity: .55; }
.hist-review { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.hist-review-img {
    width: 100%;
    max-height: 260px;
    border-radius: 10px;
    border: 1px solid var(--att-line);
    object-fit: contain;
    background: var(--att-field);
    cursor: zoom-in;
}
.hist-checks { border: 1px solid var(--att-line); border-radius: 10px; padding: 10px 12px; display: grid; gap: 8px; margin: 0; }
.hist-checks legend { font-size: 12.5px; font-weight: 600; color: var(--att-ink-2); padding: 0 4px; }
```

- [ ] **Step 5: Wire it into `admin.html`**

5a. Line `<link rel="stylesheet" href="css/requests-admin.css">` → `<link rel="stylesheet" href="css/requests-admin.css?v=20261009b">`.

5b. After `<div id="reqCatalogView"    class="content-view" style="display: none;"></div>` add the line
`        <div id="reqHistoryView"     class="content-view" style="display: none;"></div>` (8 spaces of indent, exactly as its neighbours, and five spaces between `"reqHistoryView"` and `class`).

5c. Replace the four script tags

```html
<script src="js/requests-admin-core.js"></script>
<script src="js/requests-admin-queue.js"></script>
<script src="js/requests-admin-detail.js"></script>
<script src="js/requests-admin-setup.js"></script>
```

with

```html
<script src="js/requests-admin-core.js?v=20261009b"></script>
<script src="js/requests-admin-queue.js?v=20261009b"></script>
<script src="js/requests-admin-detail.js?v=20261009b"></script>
<script src="js/requests-admin-setup.js?v=20261009b"></script>
<script src="js/requests-admin-history.js?v=20261009b"></script>
<script src="js/requests-admin-gallery.js?v=20261009b"></script>
```

(`requests-admin-gallery.js` is created in Task 4; until then the browser logs one 404 and the review tab says "did not load" — nothing else is affected.)

5d. `const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqProjects'];` → `const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqHistory','reqProjects'];`

5e. In `TITLES`, after `reqCatalog:       'Item catalogue',` add `        reqHistory:       'Item history',`.

- [ ] **Step 6: Nav entry in `js/admin.js`**

In the Requests `modules: [ … ]`, after `{ view: 'reqCatalog',  label: 'Catalogue',      icon: 'package-search' },` add:

```js
        { view: 'reqHistory',  label: 'Item history',   icon: 'images' },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node tests/requests-admin.test.js` → `30 passed, 0 failed`.
Run: `node --check js/requests-admin-history.js && node --check js/admin.js` → no output.
Run: `npm test` → all green.

- [ ] **Step 8: Stop — no commit.** Report to the controller.

---

### Task 4: Gallery photos — upload, cover, retire, Photos to review

**Files:**
- Create: `js/requests-admin-gallery.js`
- Test: `tests/requests-admin.test.js`

**Interfaces:**
- Consumes (Task 1): `RA.galleryPath`, `RA.signImages`, `RA.head`, `RA.itemLabel`, `RA.formatManila`, `RA.entryDateLabel`, `RA.modal`, `RA.rpc`, `RA.fail`, `RA.icons`, `RA.errorMessage`; `window.DacsReceipts.compressToBlob(source, max, quality)` and `window.DacsReceipts.newId()` (`js/receipt-storage.js`, loaded earlier in `admin.html`); `window.currentDataUserId`.
- Consumes (Task 3): the history view calls `RA.gallery.uploadModal(item, rerender)`, `RA.gallery.setCover(photoId, button, rerender)`, `RA.gallery.retireModal(photo, rerender)`, `RA.gallery.renderReview(host, nav)` with `nav = { tabsHtml, wireTabs }`. `item` is the `pr_office_history_item` document (has `id`, `photos[]`, `entries[]`).
- Produces: `window.RequestsAdmin.gallery = { uploadModal, setCover, retireModal, renderReview }`.
- Server data used (0090): queue → `[{ photo_id, path, created_at, request_id, line_id, line_description, project_name, work_name, requester_name, item: { id, kind, name, spec, unit } }]`.

- [ ] **Step 1: Write the failing static tests**

Add directly above `// ── SUMMARY (keep last) ──` in `tests/requests-admin.test.js`:

```js
console.log('\nrequests-admin: gallery photos (0090)');

test('every gallery photo passes the three checks before anything is uploaded', () => {
  const s = src('js/requests-admin-gallery.js');
  const checks = /const CHECKS = \[([\s\S]*?)\];/.exec(s);
  ok(checks && (checks[1].match(/'/g) || []).length === 6, 'exactly three checks');
  ok((s.match(/if \(!checklistOk\(form\)\) throw new Error\('CHECKLIST_REQUIRED'\);/g) || []).length === 2,
     'both the upload and the approve-copy forms refuse without all three ticks');
  for (const fn of ['uploadModal', 'approveModal']) {
    const body = s.slice(s.indexOf('function ' + fn), s.indexOf('onDone', s.indexOf('function ' + fn)));
    ok(body.indexOf('checklistOk(form)') < body.indexOf('storeCopy('), fn + ' checks before it stores');
  }
});

test('photos are re-encoded and stored only in item-gallery, never overwritten or deleted', () => {
  const s = src('js/requests-admin-gallery.js');
  ok(s.includes('root.DacsReceipts.compressToBlob(source, 1200, 0.8)'), 're-encoded (drops camera metadata such as GPS)');
  ok(s.includes('RA.galleryPath(root.currentDataUserId, itemId, root.DacsReceipts.newId())'), '<company>/<item>/<uuid>.jpg');
  const uploads = [...s.matchAll(/storage\.from\(([A-Z_]+)\)\.upload\(/g)].map(m => m[1]);
  ok(uploads.length === 1 && uploads[0] === 'GALLERY', 'one upload, to item-gallery');
  ok(s.includes("{ upsert: false, contentType: 'image/jpeg' }"), 'never overwrites');
  ok(!/from\(REQUEST_PHOTOS\)\.(upload|remove|update|move|copy)\(/.test(s), 'the worker\'s original is only read');
  ok(!/\.remove\(|\.delete\(/.test(s), 'nothing is deleted');
});

test('the gallery screen writes only through 0090 office RPCs', () => {
  const s = src('js/requests-admin-gallery.js');
  ok(s.includes('RA.gallery = { uploadModal, setCover, retireModal, renderReview };'), 'exports RA.gallery');
  const rpcs = [...s.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]);
  const allowed = ['pr_office_add_gallery_photo', 'pr_office_set_cover', 'pr_office_retire_photo',
                   'pr_office_photo_queue', 'pr_office_publish_photo', 'pr_office_keep_private'];
  ok(rpcs.length === allowed.length && allowed.every(r => rpcs.includes(r)), 'RPCs: ' + rpcs.join(', '));
  ok(!/\.from\('pr_/.test(s), 'no direct pr_ table access');
  const html = src('admin.html');
  ok(html.indexOf('js/requests-admin-gallery.js?v=20261009b') > html.indexOf('js/requests-admin-core.js'), 'loaded after the core');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/requests-admin.test.js`
Expected: the 3 new tests FAIL (`ENOENT … requests-admin-gallery.js`); exit 1.

- [ ] **Step 3: Create `js/requests-admin-gallery.js`**

```js
// ════════════════════════════════════════════════════════════════════
// Requests → Item history → product photos (WorkMate Stage 1b, 0090).
//
// Upload a product photo, choose the cover, retire a photo, and the
// "Photos to review" queue: a worker's PRIVATE request photo is either
// published as a reviewed COPY (the original stays private) or kept
// private. A person checks every photo first: no prices, no personal
// details, the product only. The file goes to the private item-gallery
// bucket as <company>/<item>/<uuid>.jpg, then a 0090 office RPC records
// it. Photos are re-encoded in the browser first, which also drops
// camera metadata such as GPS location. Nothing is ever deleted here.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const GALLERY = 'item-gallery';
    const REQUEST_PHOTOS = 'request-photos';
    const CHECKS = [
        'No price, amount, receipt or price tag is visible',
        'No face, name, phone number or other personal detail is visible',
        'It shows only the product',
    ];

    function checklistHtml() {
        return '<fieldset class="hist-checks att-span"><legend>Before it goes to the workers’ gallery</legend>' +
            CHECKS.map((c, i) => '<label class="req-toggle"><input type="checkbox" name="check' + i + '"> ' + esc(c) + '</label>').join('') +
            '</fieldset>';
    }

    function checklistOk(form) {
        return CHECKS.every((c, i) => form['check' + i].checked);
    }

    // Re-encode (drops camera metadata), then store under a fresh uuid name.
    async function storeCopy(itemId, source) {
        if (!root.DacsReceipts) throw new Error('UPLOAD_FAILED: the photo tools did not load — reload the page');
        const blob = await root.DacsReceipts.compressToBlob(source, 1200, 0.8);
        const path = RA.galleryPath(root.currentDataUserId, itemId, root.DacsReceipts.newId());
        const { error } = await root.sbClient.storage.from(GALLERY).upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
        if (error) throw new Error('UPLOAD_FAILED: ' + (error.message || error));
        return path;
    }

    function uploadModal(item, rerender) {
        const refs = (item.entries || []).filter(e => e.entry_kind === 'reference' && !e.retired);
        const hasCover = (item.photos || []).some(p => p.is_cover);
        RA.modal({
            title: 'Upload a product photo',
            sub: RA.itemLabel(item),
            body:
                '<div class="att-field att-span"><label for="galFile">Photo</label>' +
                  '<input class="att-input" id="galFile" name="file" type="file" accept="image/*"></div>' +
                (refs.length
                    ? '<div class="att-field att-span"><label for="galRef">For a historical reference <span class="att-hint-inline">(optional)</span></label>' +
                      '<select class="att-input" id="galRef" name="ref"><option value="">No — a general photo of the item</option>' +
                      refs.map(r => '<option value="' + esc(r.entry_id) + '">' +
                        esc((r.project_name || '') + ' · ' + RA.entryDateLabel(r) + ' · ' + (r.description || '')) + '</option>').join('') +
                      '</select></div>'
                    : '') +
                '<label class="req-toggle att-span"><input type="checkbox" name="cover"' + (hasCover ? '' : ' checked') + '> Make it the cover photo</label>' +
                checklistHtml(),
            submitLabel: 'Upload',
            onSubmit: async (form) => {
                const file = form.file.files && form.file.files[0];
                if (!file) throw new Error('NO_PHOTO');
                if (!checklistOk(form)) throw new Error('CHECKLIST_REQUIRED');
                const path = await storeCopy(item.id, file);
                await RA.rpc('pr_office_add_gallery_photo', {
                    p_item: item.id,
                    p_path: path,
                    p_checklist: true,
                    p_make_cover: form.cover.checked,
                    p_ref: (form.ref && form.ref.value) || null,
                });
            },
            onDone: rerender,
        });
    }

    async function setCover(photoId, button, rerender) {
        button.disabled = true;
        try {
            await RA.rpc('pr_office_set_cover', { p_photo: photoId });
            rerender();
        } catch (err) {
            alert(RA.errorMessage(err));
            button.disabled = false;
        }
    }

    function retireModal(photo, rerender) {
        if (!photo) return;
        RA.modal({
            title: 'Retire this photo',
            sub: 'Workers stop seeing it on their next refresh. The office keeps it, greyed out, with your reason.',
            body: '<div class="att-field att-span"><label for="galReason">Why</label>' +
                  '<input class="att-input" id="galReason" name="reason" maxlength="200" placeholder="e.g. a price tag is visible"></div>',
            submitLabel: 'Retire',
            warn: true,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_retire_photo', { p_photo: photo.id, p_reason: form.reason.value.trim() });
            },
            onDone: rerender,
        });
    }

    // ── Photos to review ────────────────────────────────────────────

    function approveModal(q, rerender) {
        RA.modal({
            title: 'Approve a copy for the gallery',
            sub: RA.itemLabel(q.item) + ' · ' + q.project_name,
            body:
                '<img class="hist-review-img att-span" alt="Request photo" data-sign-bucket="' + REQUEST_PHOTOS + '" data-sign-path="' + esc(q.path) + '">' +
                '<label class="req-toggle att-span"><input type="checkbox" name="cover"> Make it the cover photo</label>' +
                checklistHtml() +
                '<div class="att-info att-span"><i data-lucide="shield-check"></i><div>If anything in the photo fails a check, keep it private instead — you can upload a clean photo from the item’s page.</div></div>',
            submitLabel: 'Approve copy',
            onOpen: (form) => { RA.signImages(form); },
            onSubmit: async (form) => {
                if (!checklistOk(form)) throw new Error('CHECKLIST_REQUIRED');
                const { data, error } = await root.sbClient.storage.from(REQUEST_PHOTOS).download(q.path);
                if (error || !data) throw new Error('UPLOAD_FAILED: ' + ((error && error.message) || 'could not read the original photo'));
                const path = await storeCopy(q.item.id, data);
                await RA.rpc('pr_office_publish_photo', {
                    p_photo: q.photo_id,
                    p_path: path,
                    p_checklist: true,
                    p_make_cover: form.cover.checked,
                });
            },
            onDone: rerender,
        });
    }

    async function renderReview(host, nav) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading photos to review…</div></div>';
        let queue;
        try { queue = await RA.rpc('pr_office_photo_queue'); } catch (e) { RA.fail(host, e); return; }
        queue = queue || [];
        const rerender = () => renderReview(host, nav);
        host.innerHTML =
            '<div class="att-stack">' +
              RA.head('Item history', 'Photos workers attached to requests for catalogue items. Approve a COPY for the workers’ gallery, or keep it private. The worker’s original always stays private.') +
              nav.tabsHtml() +
              (queue.length
                ? '<div class="hist-review">' + queue.map(q =>
                    '<div class="att-card" data-photo="' + esc(q.photo_id) + '"><div class="att-card-body att-stack">' +
                      '<img class="hist-review-img" alt="Request photo" data-sign-bucket="' + REQUEST_PHOTOS + '" data-sign-path="' + esc(q.path) + '">' +
                      '<div><strong>' + esc(RA.itemLabel(q.item)) + '</strong>' +
                        '<div class="req-muted">' + esc(q.project_name) + ' · ' + esc(q.work_name) + ' · ' + esc(q.requester_name) +
                        ' · ' + esc(RA.formatManila(q.created_at)) + '</div></div>' +
                      '<div class="req-actions">' +
                        '<button class="att-btn att-btn--primary" type="button" data-act="approve">Approve a copy…</button>' +
                        '<button class="att-btn" type="button" data-act="private">Keep private</button>' +
                      '</div>' +
                    '</div></div>').join('') + '</div>'
                : '<div class="att-empty">No photos waiting for review.</div>') +
            '</div>';
        nav.wireTabs(host);
        host.querySelectorAll('[data-photo]').forEach(card => card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const q = queue.find(x => x.photo_id === card.dataset.photo);
            if (!q) return;
            if (b.dataset.act === 'approve') { approveModal(q, rerender); return; }
            if (!confirm('Keep this photo private? It leaves this list and never goes to the gallery.')) return;
            b.disabled = true;
            try {
                await RA.rpc('pr_office_keep_private', { p_photo: q.photo_id });
                rerender();
            } catch (err) {
                alert(RA.errorMessage(err));
                b.disabled = false;
            }
        }));
        RA.icons();
        RA.signImages(host);
    }

    RA.gallery = { uploadModal, setCover, retireModal, renderReview };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/requests-admin.test.js` → `33 passed, 0 failed`.
Run: `node --check js/requests-admin-gallery.js` → no output.
Run: `npm test` → all green.

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 5: Docs, then the browser check (controller + user)

**Files:**
- Modify: `docs/ARCHITECTURE.md` (Requests module-map row)

**Interfaces:**
- Consumes: everything from Tasks 1–4. No new code.

- [ ] **Step 1: Architecture doc**

In `docs/ARCHITECTURE.md`, the module-map row that starts `| Requests | \`requests-admin-core.js\`, …`:

1a. In the files cell, after `` `requests-admin-setup.js` `` add `` , `requests-admin-history.js`, `requests-admin-gallery.js` ``.

1b. In the description cell, directly after `the **catalogue** (deactivate, never delete) and **projects** (*Allow requests*).` insert:

```markdown
 Since `0090` (Stage 1b, Find Previous Item): catalogue **aliases** and **brand** (search aids, not identity), a per-project **Item history** switch (separate from *Allow requests*, survives completion), and the **Item history** view — search items with their dated history, add or retire a **historical reference** (creates no expense, stock or purchase), and manage reviewed **product photos** in the private `item-gallery` bucket (`<company>/<item>/<uuid>.jpg`, re-encoded in the browser, three-tick checklist, cover, retire — never deleted); **Photos to review** publishes a COPY of a worker's private request photo or keeps it private. A request line shows the Request Again source (`ref_label`).
```

Keep the file LF.

Run: `npm test` → all green.

- [ ] **Step 2: Controller — whole-change review, then the user checks it in the browser**

After the final review is clean, the user runs Dacs Web locally (Live Server, `admin.html`, signed in as the **owner**) and does, in order:

1. **Catalogue:** edit a test item (e.g. one named `ZZ …`), add Brand `ZZBrand` and other names `saksakan, plug`, Save, reopen — both are kept. Search the catalogue for `plug` — the item shows.
2. **Projects:** on a test project, turn **Item history** on — *Allow requests* does not change; reload — still on.
3. **Item history → Search items:** search `saksakan` — the item appears; open it.
4. **Add historical reference:** pick the project, Main Contract, "What was used", **Around a month** + any day — Save. It appears in History as *Historical reference · around <Month Year>*. Retire it with a reason — it shows *Retired*.
5. **Upload photo:** try Upload without ticking the three checks — the form refuses ("Tick all three checks…"). Tick them, upload a product photo, **Make it the cover** — it shows with *Cover*; the search result shows the thumbnail.
6. **Make cover / Retire:** upload a second photo, *Make cover* on it, then *Retire…* it with a reason — the cover goes back to the first photo; the retired one is greyed with its reason.
7. **Photos to review:** if the pilot left request photos on lines matched to a catalogue item, *Approve a copy…* one (ticks required) — it appears in that item's photos as *Copy of a request photo*; *Keep private* another — it leaves the list. If the list is empty, say so (no pilot photo is matched) — this step is then covered by the 0090 acceptance script.
8. **Staff account:** sign in as staff — the Item history tab is there and works the same (no peso amounts exist anywhere on these screens).

Test data stays as retired records (nothing is ever deleted); use `ZZ` names so it is recognisable.

- [ ] **Step 3: Close out (controller)**

Append "Execution notes" to this plan; update memory `workmate-requests-0085.md` (1b-2 done; next 1b-3 seeding, 1b-4 app 0.5.0 + pilot) and its `MEMORY.md` line. Tell the user to commit and push Dacs Web.

---

## Execution notes (2026-10-11)

- Executed subagent-driven on `main`, no worktree, nothing committed by the agent. Each task matched a controller-simulated build of the plan (the simulation caught one wrong anchor before execution). Task reviews all clean; Task 4 had one fix round (a UTF-8 BOM on the new gallery file).
- Final review (opus): "Ready for the browser check". One fix wave: `BAD_ITEM` sentence now also states the alias caps; a thumbnail click in search opens only the photo; `js/admin.js?v=20261009b` cache-buster. Scoped re-review clean. `npm test` green (requests-admin 33/33).
- Browser check (user, owner + staff) passed all 8 steps. Live data left by the test: ZZ test pipe has brand `ZZBrand` and aliases `saksakan, plug`; one retired historical reference; 4 retired gallery photos (none visible to workers); the two pilot request photos reviewed (1 copy published then retired, 1 kept private); **Barlin Residence has Item history ON** (no worker can see it until the 1b-4 app).
- Deferred polish (later): stale Show-more race; Additional-Works load race in the reference modal; Back refetches page 0; failed Show-more clears the list; no From ≤ To check; add_gallery_photo not idempotent on a lost response; late review-queue render; raw compress/path errors; lookups cached per page load; signImages one at a time and 10-minute links; re-matched line keeps failing Approve until reload; static tests only.
- Next: 1b-3 seeding (staff add real photos and references for active sites), then 1b-4 app 0.5.0 + phone pilot.
