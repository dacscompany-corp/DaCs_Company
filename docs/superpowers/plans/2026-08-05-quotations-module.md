# Quotations Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a purpose-built outgoing client quotation builder to `admin.html` as a new top-level **Quotations** nav tab — itemized estimate, print/PDF, revision snapshots, and a win/loss pipeline — fully isolated from the money model.

**Architecture:** Three new front-end files (`js/quotation-module.js`, `js/quotation-print.js`, `css/quotation-module.css`) over three new Postgres tables added by `supabase/migrations/0045_quotations.sql`. Data access goes through the existing Firestore-compat shim (`db.collection('quotations')…`), which requires `REG` registration. No framework, no build step, no imports — every entry point is a `window.*` global, matching every other module in this repo.

**Tech Stack:** Plain HTML + vanilla JS (no build step) · Supabase Postgres + Storage + Realtime via the compat shim in `js/supabase-config.js` · jsPDF + jspdf-autotable lazy-loaded from CDN for export · zero-dependency Node test script for the calc engine.

**Spec:** [docs/superpowers/specs/2026-08-05-quotations-module-design.md](../specs/2026-08-05-quotations-module-design.md) — read it before Task 1.

## Global Constraints

- **Never run `npm run build`.** It is a hard-fail stub. `js/portal-app.compiled.js` is edited directly. This plan does not touch it.
- **Commit locally, never push.** Work happens on the `feat/quotations` branch. Each task ends in **one local commit** using the message given in its final step. **Never run `git push`**, never merge to `main`, and never touch any other branch — pushing and merging are the owner's decisions alone.
- **Never apply the migration yourself.** Task 1 writes `0045_quotations.sql`; the **owner applies it** to the live database. Any task that needs the tables to exist must confirm with the controller that it has been applied before running browser checks against real data.
- **Browser verification is the owner's.** Implementers run `node --check` and `npm test`, and record the browser steps they could not perform in their report rather than claiming them as passed. Never report a browser check as passing if you did not run it.
- **A new data field needs a real DB column.** The shim maps camelCase → snake_case directly; writing a field with no column makes the whole save fail silently. Every field used in this plan is created in Task 1.
- **Never build a local date key with `toISOString().slice(0,10)`.** PH is UTC+8 and it rolls back a day. Use `qtTodayKey()` from Task 2, which builds from local parts.
- **Staff must never see peso amounts.** This module is **owner-only**, blocked in four places: `_visibleNav()`, the `switchView` guard, the module's own init check, and RLS.
- **The isolation contract:** a quotation never writes to `folders`, `construction_projects`, `invoices`, `payment_requests`, `expenses`, `payroll` or `boq_documents`, and no money-model function ever reads `quotations`. Marking a quote *Won* changes a status string and nothing else.
- **Migration numbering:** next number = highest + 1, never reuse, never a Supabase SQL-editor one-off. Highest on disk is `0044`, so this is `0045`.
- **Run `npm test` after every task.** It must stay green (all checks in `tests/money-math.test.js` + `tests/reimbursement.test.js`, plus the new `tests/quotation.test.js` from Task 2). A red money test means something got coupled to the money model that shouldn't be — that is the regression signal this module needs.
- **`node --check <file>` after every JS edit.** There is no type checker and no bundler; this is the only thing that catches a syntax error before the browser does.
- **Naming:** every global in `js/quotation-module.js` and `js/quotation-print.js` is prefixed `qt`. Module-local state is the object `qtState`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `supabase/migrations/0045_quotations.sql` | Three tables, indexes, RLS, realtime publication | 1 |
| `js/supabase-config.js` | Three `REG` entries (modify, ~line 100) | 1 |
| `js/quotation-module.js` | State, calc engine, list page, editor, revisions, presets | 2, 4–11 |
| `js/quotation-print.js` | A4 print sheet + jsPDF export | 12, 13 |
| `css/quotation-module.css` | Editor + print styling | 4–12 |
| `tests/quotation.test.js` | Calc engine, expiry, quote numbering, revision diff | 2 |
| `js/admin.js` | `PRIMARY_NAV`, `_FOCUS_SUBVIEWS`, `_visibleNav()` (modify) | 3 |
| `admin.html` | `QUOTE_VIEWS`, `TITLES`, staff guard, init dispatch, markup, tags (modify) | 3 |
| `package.json` | Add the new test to the `test` script (modify) | 2 |
| `docs/DATABASE_SCHEMA.md` | Document the three tables (modify) | 1 |
| `docs/ARCHITECTURE.md` | §4 module map, §7 data model (modify) | 3 |
| `CLAUDE.md` | Isolation rule (modify) | 3 |

---

## Task 1: Database — migration 0045, shim registration, schema docs

**Files:**
- Create: `supabase/migrations/0045_quotations.sql`
- Modify: `js/supabase-config.js` (the `REG` object, after the `boqTemplates` line ~99)
- Modify: `docs/DATABASE_SCHEMA.md`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `quotations`, `quotation_revisions`, `quotation_presets`; shim collections `quotations`, `quotationRevisions`, `quotationPresets` usable as `db.collection('quotations')`.

- [ ] **Step 1: Confirm the migration number is still free**

Run:
```bash
ls supabase/migrations | tail -5
```
Expected: highest file is `0044_warranty_status_simplify.sql`, and **no** `0045_*` exists. If a `0045` appeared, use the next free number and update every reference in this plan.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0045_quotations.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0045_quotations.sql
--
-- OUTGOING CLIENT QUOTATIONS (Project Estimates).
--
-- A quotation is a SALES document produced BEFORE any project exists.
-- DAC's builds an itemized estimate, prints/exports it, sends it to the
-- prospect, and tracks the outcome (draft → sent → won | lost).
--
-- ── DELIBERATELY ISOLATED — same rule as reimbursements (0041) and the
--    warranty retention fund (0043).  A row here is a PROPOSAL, not
--    revenue:
--      · no money math reads it (Labor / Material / Overhead / Spent /
--        Earned / Profit all ignore it — see docs/OVERHEAD_MODULE.md),
--      · it creates no folder, no construction_project, no invoice, no
--        payment_request, no expense, no payroll row, no journal entry,
--      · marking a quote WON changes a status string and NOTHING else.
--        Converting a won quote into a project is a manual admin action.
--    Nothing outside js/quotation-module.js and js/quotation-print.js may
--    read or write these tables.  If that ever changes they stop being a
--    sales register and the isolation rule in CLAUDE.md /
--    docs/ARCHITECTURE.md has to be revisited FIRST.
--
-- Access: OWNER ONLY.  Mirrors warranty_retentions_owner (`owner_id =
-- auth.uid()`, which excludes staff, since staff act as their owner
-- through data_owner_id()).  Every meaningful column is a peso amount or
-- the context for one, and staff must not see peso amounts.  No
-- client-read policy — the client never sees this inside the system.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. The quotation ────────────────────────────────────────────────
create table if not exists quotations (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,

  -- Q-2026-0001. Generated by the app from the highest sequence already
  -- used that year, and editable. A label, not a key.
  quote_no        text,
  rev_no          integer not null default 1,

  quote_date      date,
  -- Drives the COMPUTED "expired" state. Nothing writes an expired
  -- status; the app derives it (status = 'sent' and valid_until < today).
  valid_until     date,

  client_name     text,
  client_email    text,
  client_address  text,
  client_tin      text,

  project_name    text,
  location        text,
  subject         text,
  scope_note      text,

  -- The 3-level tree: [{ id, label, pricing, lumpAmount, images:[],
  --   groups:[{ id, label, lumpAmount, lines:[{ id, description, qty,
  --   unit, unitPrice, state }] }] }]
  -- ONE client-facing rate per line. There is deliberately NO
  -- material/labor split here — that is internal costing and belongs in
  -- the BOQ, never on a document a client reads.
  sections        jsonb not null default '[]'::jsonb,

  discount        numeric not null default 0,
  discount_type   text    not null default 'amount'
                  check (discount_type in ('amount','percent')),

  -- none      → sheet prints "VAT not applicable"
  -- exclusive → VAT computed at vat_pct and ADDED to the sub-total
  -- inclusive → total unchanged; the VAT component is shown broken out
  vat_mode        text    not null default 'none'
                  check (vat_mode in ('none','exclusive','inclusive')),
  vat_pct         numeric not null default 12,

  -- Final total after discount and VAT. Denormalised for list sorting and
  -- pipeline stats; recomputed by the app on every save.
  total_amount    numeric not null default 0,

  status          text not null default 'draft'
                  check (status in ('draft','sent','won','lost')),
  status_note     text,
  -- Stamped when status moves to won/lost, cleared if it moves back.
  -- Powers win-rate-over-time without scanning the history blob.
  decided_at      timestamptz,

  -- In-app reminder only. NOTHING is emailed from these columns.
  follow_up_date  date,
  follow_up_note  text,

  -- { validityNote, payment, deliveryTimeline, warranty, exclusions,
  --   conditions:[{title,body,include}], signOff:{preparedBy,clientApproval} }
  terms           jsonb not null default '{}'::jsonb,
  prepared_by     text,

  -- Append-only status/edit trail ([{ at, by, status, from, note }]),
  -- same convention as reimbursements.history.
  history         jsonb not null default '[]'::jsonb,

  -- Soft delete. Every read filters `deleted_at is null`.
  deleted_at      timestamptz,

  created_by      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists quotations_owner_live_idx
  on quotations(owner_id) where deleted_at is null;
create index if not exists quotations_status_idx     on quotations(status);
create index if not exists quotations_date_idx       on quotations(quote_date);
create index if not exists quotations_valid_idx      on quotations(valid_until);
create index if not exists quotations_followup_idx
  on quotations(follow_up_date) where follow_up_date is not null;


-- ── 2. Immutable revision snapshots ─────────────────────────────────
-- Every SEND freezes a full copy. The module only ever INSERTs here;
-- there is no edit or delete path. Rows disappear only with the parent.
--
-- Storage trade-off, made knowingly: a quote revised eight times stores
-- its tree eight times. At this volume (hundreds of quotes) that is cheap,
-- and it makes any revision printable on its own. Storing diffs instead
-- would halve the storage and double the complexity.
create table if not exists quotation_revisions (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references quotations(id) on delete cascade,
  -- Denormalised so the RLS check stays single-table.
  owner_id      uuid not null references auth.users(id) on delete cascade,

  rev_no        integer not null,
  snapshot      jsonb   not null,
  total_amount  numeric not null default 0,
  sent_at       timestamptz,
  note          text,
  created_at    timestamptz default now()
);

create unique index if not exists quotation_revisions_uniq
  on quotation_revisions(quotation_id, rev_no);
create index if not exists quotation_revisions_owner_idx
  on quotation_revisions(owner_id);


-- ── 3. Reusable client blocks and scope blocks ──────────────────────
create table if not exists quotation_presets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,

  -- 'client' → data is a client block { clientName, clientEmail,
  --            clientAddress, clientTin }
  -- 'scope'  → data is { sections: [ …same shape as quotations.sections ] }
  kind        text not null check (kind in ('client','scope')),
  name        text not null,
  data        jsonb not null default '{}'::jsonb,

  deleted_at  timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists quotation_presets_owner_kind_idx
  on quotation_presets(owner_id, kind) where deleted_at is null;


-- ── 4. RLS — owner only, staff excluded ─────────────────────────────
alter table quotations          enable row level security;
alter table quotation_revisions enable row level security;
alter table quotation_presets   enable row level security;

drop policy if exists quotations_owner on quotations;
create policy quotations_owner on quotations for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists quotation_revisions_owner on quotation_revisions;
create policy quotation_revisions_owner on quotation_revisions for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists quotation_presets_owner on quotation_presets;
create policy quotation_presets_owner on quotation_presets for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());


-- ── 5. Realtime ─────────────────────────────────────────────────────
-- The module lists through .onSnapshot(), and a table only broadcasts
-- once it is in the publication — new tables are NOT auto-added (see
-- 0004_realtime.sql). Without this the list only updates on refresh.
do $$
declare t text;
begin
  foreach t in array array['quotations','quotation_revisions','quotation_presets']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
```

- [ ] **Step 3: Apply the migration**

Apply it through the normal Supabase migration path for this project (**never** paste it into the SQL editor as a one-off — see `supabase/migrations/README.md`).

Then verify all three tables and the RLS policies exist:
```sql
select table_name from information_schema.tables
 where table_name in ('quotations','quotation_revisions','quotation_presets');

select tablename, policyname from pg_policies
 where tablename in ('quotations','quotation_revisions','quotation_presets');

select tablename from pg_publication_tables
 where pubname = 'supabase_realtime'
   and tablename in ('quotations','quotation_revisions','quotation_presets');
```
Expected: 3 tables, 3 policies, 3 publication rows.

- [ ] **Step 4: Register the collections in the shim**

In `js/supabase-config.js`, in the `REG` object, immediately after the `boqTemplates:` line (~line 99), add:

```js
  quotations:         { table: 'quotations',          rename: OWNER, ts: ['createdAt','updatedAt'], json: ['sections','terms','history'] },
  quotationRevisions: { table: 'quotation_revisions', rename: OWNER, ts: ['createdAt','sentAt'],    json: ['snapshot'] },
  quotationPresets:   { table: 'quotation_presets',   rename: OWNER, ts: ['createdAt','updatedAt'], json: ['data'] },
```

`rename: OWNER` maps `userId` → `owner_id`, matching every other collection. `json:` marks the columns that hold structures rather than scalars.

- [ ] **Step 5: Syntax-check the shim**

Run: `node --check js/supabase-config.js`
Expected: no output (success).

- [ ] **Step 6: Verify the round-trip in the browser**

Open `admin.html`, log in as **owner**, and in the console run:
```js
await db.collection('quotations').add({
  userId: auth.currentUser.uid, quoteNo: 'Q-TEST-0001', status: 'draft',
  sections: [{ id: 's1', label: 'TEST', pricing: 'rated', groups: [] }],
  terms: { payment: 'x' }, totalAmount: 0
});
const s = await db.collection('quotations').where('userId','==',auth.currentUser.uid).get();
console.log(s.docs.map(d => d.data()));
```
Expected: the document reads back with `sections` as a real **array** (not a string) and `terms` as an object. If either comes back as a string, the `json:` registration in Step 4 is wrong.

Then delete the test row:
```js
await db.collection('quotations').doc(s.docs[0].id).delete();
```

- [ ] **Step 7: Document the tables**

In `docs/DATABASE_SCHEMA.md`, add a new numbered section (place it after the BOQ section, §3) documenting `quotations`, `quotation_revisions` and `quotation_presets` — one field table each, using the column list from Step 2 and following the formatting of the existing sections. Include, in bold, the isolation note: **no money math reads these tables; marking a quote Won changes a status string and nothing else.**

- [ ] **Step 8: Hand off for commit**

Do **not** run git. Print this for the user:
```bash
git add supabase/migrations/0045_quotations.sql js/supabase-config.js docs/DATABASE_SCHEMA.md
git commit -m "feat(quotations): add 0045 tables, shim registration and schema docs"
```

---

## Task 2: Calc engine + tests

The pure logic — totals, expiry, quote numbering, revision diff — written test-first. Everything else in the module depends on these functions, and they are the only part that can be tested without a browser.

**Files:**
- Create: `js/quotation-module.js`
- Create: `tests/quotation.test.js`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces, all on `window` and all pure (no DOM, no network):
  - `qtParseNum(v) → number` · `qtFmt(n) → string` · `qtEscHtml(s) → string`
  - `qtTodayKey() → 'YYYY-MM-DD'` built from **local** parts
  - `qtLineAmount(line) → number`
  - `qtGroupTotal(group) → number` · `qtSectionTotal(section) → number`
  - `qtProjectCost(sections) → number` · `qtDiscountAmount(q) → number` · `qtSubTotal(q) → number` · `qtVatAmount(q) → number` · `qtGrandTotal(q) → number`
  - `qtIsExpired(q) → boolean`
  - `qtNextQuoteNo(list) → 'Q-YYYY-NNNN'`
  - `qtFlattenLines(sections) → [{id, path, description, qty, unitPrice, state, amount}]`
  - `qtDiffSnapshots(prev, curr) → {added[], removed[], changed[], delta}`

  Throughout, `q` is a quotation-shaped object `{ sections, discount, discountType, vatMode, vatPct, status, validUntil }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/quotation.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// QUOTATION CALC TESTS — run with:  node tests/quotation.test.js
//
// Zero dependencies, no framework. Feeds known inputs into the REAL
// functions, extracted from js/quotation-module.js at run time (never a
// copy), and fails loudly if a rule breaks.
//
// The rules under guard (see the spec, §7–§8):
//   1. Totals order is FIXED: discount applies to Project Cost, VAT
//      applies to the DISCOUNTED sub-total.
//   2. optional / waived / removed lines contribute ZERO — but a removed
//      line KEEPS its price so the revision diff can value the deletion.
//   3. A section's own lumpAmount WINS; group amounts under it are a
//      display breakdown and must not re-add.
//   4. Expiry is COMPUTED from local date parts. Never UTC — PH is UTC+8
//      and toISOString() rolls the key back a day.
//   5. The revision diff matches lines by id and reports a peso delta.
//
// If a test fails with "SLICE NOT FOUND", the source was restructured —
// update the extraction markers below, don't delete the test.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(actual, expected, label) {
  const a = typeof actual === 'number' ? +actual.toFixed(6) : actual;
  const b = typeof expected === 'number' ? +expected.toFixed(6) : expected;
  if (a !== b) throw new Error((label || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }

function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file + ' — file restructured; update tests/quotation.test.js markers');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}
function evalWith(src, ctx, names) {
  const fn = new Function('ctx', 'with(ctx){' + src + '\n; return {' + names.join(',') + '};}');
  return fn(ctx);
}

// ── Load the live calc engine ────────────────────────────────────────
const src = read('js/quotation-module.js');
const M = evalWith(
  slice(src, '// ==== QT CALC ENGINE START ====', '// ==== QT CALC ENGINE END ====', 'quotation-module.js'),
  { window: {} },
  ['qtParseNum','qtLineAmount','qtGroupTotal','qtSectionTotal','qtProjectCost',
   'qtDiscountAmount','qtSubTotal','qtVatAmount','qtGrandTotal','qtIsExpired',
   'qtNextQuoteNo','qtFlattenLines','qtDiffSnapshots','qtTodayKey']
);

// ── Fixtures ─────────────────────────────────────────────────────────
const line = (id, qty, price, state) =>
  ({ id, description: 'line ' + id, qty, unit: 'pc', unitPrice: price, state: state || 'normal' });

// Rated section: 2×850 + 3×1200 = 5,300
const ratedSection = {
  id: 'S1', label: 'ELECTRICAL', pricing: 'rated',
  groups: [{ id: 'G1', label: 'OUTLETS', lines: [line('L1', 2, 850), line('L2', 3, 1200)] }]
};

// Lump section, mirroring the reference document:
// REPAIR SERVICE = 200,126 with KIOSK 92,707 + ELECTRICAL 107,419 shown
// underneath as a BREAKDOWN, not as extra charges.
const lumpSectionWithOwnAmount = {
  id: 'S2', label: 'REPAIR SERVICE', pricing: 'lump', lumpAmount: 200126,
  groups: [
    { id: 'G2', label: 'KIOSK',      lumpAmount: 92707,  lines: [line('L3', 1, 0)] },
    { id: 'G3', label: 'ELECTRICAL', lumpAmount: 107419, lines: [line('L4', 1, 0)] }
  ]
};

// Lump section with NO section-level amount: groups sum instead.
const lumpSectionGroupsOnly = {
  id: 'S3', label: 'MOBILIZATION', pricing: 'lump',
  groups: [
    { id: 'G4', label: 'DELIVERY',     lumpAmount: 8000, lines: [] },
    { id: 'G5', label: 'INSTALLATION', lumpAmount: 4948, lines: [] }
  ]
};

const quote = (over) => Object.assign({
  sections: [ratedSection], discount: 0, discountType: 'amount',
  vatMode: 'none', vatPct: 12, status: 'draft', validUntil: null
}, over || {});

console.log('\n── Line amounts and line states ──');

test('rated line = qty x unitPrice', () => {
  eq(M.qtLineAmount(line('X', 2, 850)), 1700);
});
test('optional line contributes zero', () => {
  eq(M.qtLineAmount(line('X', 2, 850, 'optional')), 0);
});
test('waived line contributes zero', () => {
  eq(M.qtLineAmount(line('X', 2, 850, 'waived')), 0);
});
test('removed line contributes zero', () => {
  eq(M.qtLineAmount(line('X', 3, 9602, 'removed')), 0);
});
test('removed line KEEPS its price in the data (deletion is valuable)', () => {
  const l = line('X', 3, 9602, 'removed');
  eq(l.qty * l.unitPrice, 28806, 'raw price still recoverable');
});
test('blank and junk numbers parse to zero, never NaN', () => {
  eq(M.qtParseNum(''), 0);
  eq(M.qtParseNum(null), 0);
  eq(M.qtParseNum('abc'), 0);
  eq(M.qtParseNum('1,234.50'), 1234.5, 'commas are stripped');
});

console.log('\n── Section totals ──');

test('rated section sums its lines', () => {
  eq(M.qtSectionTotal(ratedSection), 5300);
});
test('lump section with its own amount IGNORES group amounts', () => {
  // 92,707 + 107,419 also equals 200,126 — so use a section amount that
  // differs from the group sum, or the test proves nothing.
  const s = Object.assign({}, lumpSectionWithOwnAmount, { lumpAmount: 190000 });
  eq(M.qtSectionTotal(s), 190000, 'section amount wins, groups do not re-add');
});
test('lump section with no own amount sums its groups', () => {
  eq(M.qtSectionTotal(lumpSectionGroupsOnly), 12948);
});
test('lump section lines never add to the total', () => {
  const s = { id: 'S', label: 'X', pricing: 'lump', lumpAmount: 5000,
              groups: [{ id: 'G', label: 'g', lines: [line('L', 10, 999)] }] };
  eq(M.qtSectionTotal(s), 5000);
});

console.log('\n── Totals order: discount then VAT ──');

test('project cost sums sections', () => {
  eq(M.qtProjectCost([ratedSection, lumpSectionGroupsOnly]), 5300 + 12948);
});
test('amount discount subtracts from project cost', () => {
  const q = quote({ sections: [lumpSectionWithOwnAmount], discount: 9531, discountType: 'amount' });
  eq(M.qtProjectCost(q.sections), 200126);
  eq(M.qtDiscountAmount(q), 9531);
  eq(M.qtSubTotal(q), 190595);
});
test('percent discount is a percent OF PROJECT COST', () => {
  const q = quote({ sections: [lumpSectionGroupsOnly], discount: 10, discountType: 'percent' });
  eq(M.qtDiscountAmount(q), 1294.8);
  eq(M.qtSubTotal(q), 11653.2);
});
test('discount cannot drive the sub-total negative', () => {
  const q = quote({ sections: [lumpSectionGroupsOnly], discount: 99999, discountType: 'amount' });
  eq(M.qtSubTotal(q), 0);
});
test('vatMode none adds nothing', () => {
  const q = quote({ sections: [lumpSectionGroupsOnly], vatMode: 'none' });
  eq(M.qtVatAmount(q), 0);
  eq(M.qtGrandTotal(q), 12948);
});
test('vatMode exclusive computes VAT on the DISCOUNTED sub-total and adds it', () => {
  const q = quote({ sections: [lumpSectionWithOwnAmount], discount: 9531,
                    discountType: 'amount', vatMode: 'exclusive', vatPct: 12 });
  eq(M.qtSubTotal(q), 190595);
  eq(M.qtVatAmount(q), 22871.4, 'VAT is 12% of 190,595 — NOT of 200,126');
  eq(M.qtGrandTotal(q), 213466.4);
});
test('vatMode inclusive breaks VAT out without changing the total', () => {
  const q = quote({ sections: [lumpSectionGroupsOnly], vatMode: 'inclusive', vatPct: 12 });
  eq(M.qtGrandTotal(q), 12948, 'total unchanged');
  eq(M.qtVatAmount(q), 12948 - (12948 / 1.12), 'component within the total');
});

console.log('\n── Expiry (PH timezone) ──');

test('todayKey is built from LOCAL parts, not toISOString', () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  eq(M.qtTodayKey(), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
});
test('a sent quote past its validity is expired', () => {
  ok(M.qtIsExpired({ status: 'sent', validUntil: '2000-01-01' }));
});
test('a sent quote inside its validity is not expired', () => {
  ok(!M.qtIsExpired({ status: 'sent', validUntil: '2999-01-01' }));
});
test('a draft is never expired', () => {
  ok(!M.qtIsExpired({ status: 'draft', validUntil: '2000-01-01' }));
});
test('a won quote is never expired', () => {
  ok(!M.qtIsExpired({ status: 'won', validUntil: '2000-01-01' }));
});
test('no validity date means never expired', () => {
  ok(!M.qtIsExpired({ status: 'sent', validUntil: null }));
});

console.log('\n── Quote numbering ──');

test('first quote of the year is 0001', () => {
  const yr = new Date().getFullYear();
  eq(M.qtNextQuoteNo([]), `Q-${yr}-0001`);
});
test('numbering continues from the highest used THIS year', () => {
  const yr = new Date().getFullYear();
  eq(M.qtNextQuoteNo([
    { quoteNo: `Q-${yr}-0001` }, { quoteNo: `Q-${yr}-0007` }, { quoteNo: `Q-${yr}-0003` }
  ]), `Q-${yr}-0008`);
});
test('last year numbers do not affect this year', () => {
  const yr = new Date().getFullYear();
  eq(M.qtNextQuoteNo([{ quoteNo: `Q-${yr - 1}-0042` }]), `Q-${yr}-0001`);
});
test('malformed quote numbers are ignored, not crashed on', () => {
  const yr = new Date().getFullYear();
  eq(M.qtNextQuoteNo([{ quoteNo: null }, { quoteNo: 'junk' }, { quoteNo: `Q-${yr}-0002` }]), `Q-${yr}-0003`);
});

console.log('\n── Revision diff ──');

const revA = { sections: [{ id: 'S', label: 'BRANDING', pricing: 'rated',
  groups: [{ id: 'G', label: 'SIGNAGE', lines: [
    line('keep', 1, 50000), line('gone', 3, 9602), line('edit', 1, 10000)
  ] }] }], totalAmount: 88806 };

const revB = { sections: [{ id: 'S', label: 'BRANDING', pricing: 'rated',
  groups: [{ id: 'G', label: 'SIGNAGE', lines: [
    line('keep', 1, 50000), line('gone', 3, 9602, 'removed'),
    line('edit', 1, 12000), line('new', 1, 2500)
  ] }] }], totalAmount: 64500 };

test('flatten walks all three levels and carries the path', () => {
  const flat = M.qtFlattenLines(revA.sections);
  eq(flat.length, 3);
  eq(flat[0].id, 'keep');
  ok(flat[0].path.includes('BRANDING'), 'path names the section');
  ok(flat[0].path.includes('SIGNAGE'), 'path names the group');
});
test('diff detects an added line', () => {
  const d = M.qtDiffSnapshots(revA, revB);
  eq(d.added.length, 1);
  eq(d.added[0].id, 'new');
  eq(d.added[0].amount, 2500);
});
test('diff detects a line changed to removed and values the deletion', () => {
  const d = M.qtDiffSnapshots(revA, revB);
  const gone = d.changed.find(c => c.id === 'gone');
  ok(gone, 'the struck-out line shows as changed');
  eq(gone.from.amount, 28806, 'it was worth 28,806 before');
  eq(gone.to.amount, 0, 'it counts zero now');
  eq(gone.delta, -28806, 'the deletion is valued — the question the reference sheet could not answer');
});
test('diff detects a price change', () => {
  const d = M.qtDiffSnapshots(revA, revB);
  const edit = d.changed.find(c => c.id === 'edit');
  ok(edit, 'edited line detected');
  eq(edit.delta, 2000);
});
test('diff detects a deleted line', () => {
  const d = M.qtDiffSnapshots(revB, { sections: [{ id: 'S', label: 'BRANDING', pricing: 'rated',
    groups: [{ id: 'G', label: 'SIGNAGE', lines: [line('keep', 1, 50000)] }] }], totalAmount: 50000 });
  eq(d.removed.length, 3);
});
test('diff reports the net peso delta between revisions', () => {
  eq(M.qtDiffSnapshots(revA, revB).delta, 64500 - 88806);
});

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/quotation.test.js`
Expected: **FAIL** — `ENOENT: no such file or directory … js/quotation-module.js`. The file does not exist yet. That is the correct failure.

- [ ] **Step 3: Write the calc engine**

Create `js/quotation-module.js`. The `// ==== QT CALC ENGINE START ====` / `END` markers are load-bearing — the test slices between them, so **do not remove or reword them**.

```js
/* ════════════════════════════════════════════════════════════════════
   QUOTATION MODULE — outgoing client quotations / project estimates.

   A quotation is a SALES document produced BEFORE any project exists.
   DELIBERATELY ISOLATED (migration 0045, same rule as 0041 / 0043):
   nothing here writes to folders, construction_projects, invoices,
   payment_requests, expenses, payroll or boq_documents, and no money
   math reads `quotations`. Marking a quote WON changes a status string
   and nothing else.

   Owner-only. Every meaningful figure is a peso amount.
   ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ==== QT CALC ENGINE START ====
    // Pure functions only — no DOM, no network, no module state. They are
    // extracted and unit-tested by tests/quotation.test.js. Keep them that
    // way: anything that touches qtState or the DOM belongs below the END
    // marker, or the tests stop being able to load this block.

    function qtParseNum(v) {
        if (v === null || v === undefined || v === '') return 0;
        const n = parseFloat(String(v).replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function qtFmt(n) {
        return Number(qtParseNum(n)).toLocaleString('en-PH',
            { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function qtEscHtml(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Local date key. NEVER toISOString().slice(0,10) — PH is UTC+8 and
    // that rolls the key back a day (see CLAUDE.md).
    function qtTodayKey() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    // Only a `normal` line contributes. optional / waived / removed all
    // count zero — but the row KEEPS its qty and unitPrice, which is what
    // lets qtDiffSnapshots value a deletion.
    function qtLineAmount(line) {
        if (!line || (line.state && line.state !== 'normal')) return 0;
        return qtParseNum(line.qty) * qtParseNum(line.unitPrice);
    }

    function qtGroupTotal(group) {
        return ((group && group.lines) || []).reduce((s, l) => s + qtLineAmount(l), 0);
    }

    // Lump rules (spec §7): a section's own lumpAmount WINS and the group
    // amounts beneath it are a display breakdown that must not re-add —
    // the reference document's REPAIR SERVICE 200,126 = KIOSK 92,707 +
    // ELECTRICAL 107,419 shape. With no section amount, groups sum.
    function qtSectionTotal(section) {
        if (!section) return 0;
        const groups = section.groups || [];
        if (section.pricing === 'lump') {
            if (section.lumpAmount !== '' && section.lumpAmount !== null &&
                section.lumpAmount !== undefined) return qtParseNum(section.lumpAmount);
            return groups.reduce((s, g) => s + qtParseNum(g.lumpAmount), 0);
        }
        return groups.reduce((s, g) => s + qtGroupTotal(g), 0);
    }

    function qtProjectCost(sections) {
        return (sections || []).reduce((s, sec) => s + qtSectionTotal(sec), 0);
    }

    function qtDiscountAmount(q) {
        const pc = qtProjectCost(q && q.sections);
        return (q && q.discountType === 'percent')
            ? pc * (qtParseNum(q.discount) / 100)
            : qtParseNum(q && q.discount);
    }

    function qtSubTotal(q) {
        return Math.max(0, qtProjectCost(q && q.sections) - qtDiscountAmount(q));
    }

    // exclusive → computed on the DISCOUNTED sub-total and added.
    // inclusive → the component already inside the sub-total.
    // none      → zero; the sheet prints "VAT not applicable".
    function qtVatAmount(q) {
        const st = qtSubTotal(q), pct = qtParseNum(q && q.vatPct);
        if (!q || q.vatMode === 'none' || !q.vatMode) return 0;
        if (q.vatMode === 'exclusive') return st * (pct / 100);
        return st - (st / (1 + pct / 100));
    }

    function qtGrandTotal(q) {
        return (q && q.vatMode === 'exclusive') ? qtSubTotal(q) + qtVatAmount(q) : qtSubTotal(q);
    }

    // Computed, never stored — so extending the validity date fixes it and
    // no cron is needed. String compare is safe on YYYY-MM-DD keys.
    function qtIsExpired(q) {
        return !!(q && q.status === 'sent' && q.validUntil && q.validUntil < qtTodayKey());
    }

    function qtNextQuoteNo(list) {
        const yr = new Date().getFullYear(), pre = `Q-${yr}-`;
        const max = (list || []).reduce((m, q) => {
            const no = (q && q.quoteNo) || '';
            if (!no.startsWith(pre)) return m;
            const n = parseInt(no.slice(pre.length), 10);
            return isNaN(n) ? m : Math.max(m, n);
        }, 0);
        return pre + String(max + 1).padStart(4, '0');
    }

    function qtFlattenLines(sections) {
        const out = [];
        (sections || []).forEach(sec => (sec.groups || []).forEach(g =>
            (g.lines || []).forEach(l => out.push({
                id: l.id,
                path: `${sec.label || ''} › ${g.label || ''}`,
                description: l.description, qty: l.qty, unit: l.unit,
                unitPrice: l.unitPrice, state: l.state || 'normal',
                amount: qtLineAmount(l)
            }))));
        return out;
    }

    // Matches lines by their stable id across two snapshots.
    function qtDiffSnapshots(prev, curr) {
        const a = new Map(qtFlattenLines(prev && prev.sections).map(l => [l.id, l]));
        const b = new Map(qtFlattenLines(curr && curr.sections).map(l => [l.id, l]));
        const added = [], removed = [], changed = [];
        b.forEach((l, id) => { if (!a.has(id)) added.push(l); });
        a.forEach((l, id) => { if (!b.has(id)) removed.push(l); });
        b.forEach((l, id) => {
            const o = a.get(id);
            if (!o) return;
            if (o.qty !== l.qty || o.unitPrice !== l.unitPrice ||
                o.state !== l.state || o.description !== l.description) {
                changed.push({ id, from: o, to: l, delta: l.amount - o.amount });
            }
        });
        return { added, removed, changed,
                 delta: qtParseNum(curr && curr.totalAmount) - qtParseNum(prev && prev.totalAmount) };
    }
    // ==== QT CALC ENGINE END ====

    // Expose the calc engine for the rest of the module and the console.
    Object.assign(window, {
        qtParseNum, qtFmt, qtEscHtml, qtTodayKey, qtLineAmount, qtGroupTotal,
        qtSectionTotal, qtProjectCost, qtDiscountAmount, qtSubTotal,
        qtVatAmount, qtGrandTotal, qtIsExpired, qtNextQuoteNo,
        qtFlattenLines, qtDiffSnapshots
    });

})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/quotation.test.js`
Expected: **PASS** — `33 passed, 0 failed`.

If `SLICE NOT FOUND` appears, the `// ==== QT CALC ENGINE START ====` marker text does not match exactly.

- [ ] **Step 5: Wire the test into `npm test`**

In `package.json`, change the `test` script to:
```json
"test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js"
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all three files pass. The money and reimbursement tests must be **unchanged and green** — this task touches no money code, so any failure there means something got coupled that shouldn't be.

Also run: `node --check js/quotation-module.js` → no output.

- [ ] **Step 7: Hand off for commit**

```bash
git add js/quotation-module.js tests/quotation.test.js package.json
git commit -m "feat(quotations): calc engine (totals, expiry, numbering, diff) with tests"
```

---

## Task 3: Nav wiring, module registration, docs

Makes the tab exist and route. After this task the tab appears for the owner, is absent for staff, and lands on an empty placeholder.

**Files:**
- Modify: `js/admin.js` (`PRIMARY_NAV` ~line 2189, `_FOCUS_SUBVIEWS` ~line 2253, `_visibleNav()` ~line 2277)
- Modify: `admin.html` (nav item ~line 173, script/link tags ~line 5004, `QUOTE_VIEWS`/`TITLES`/staff guard/init dispatch ~lines 5744–5890, section markup near the BOQ view ~line 2567)
- Modify: `js/quotation-module.js` (add `window.initQuotationModule`)
- Create: `css/quotation-module.css`
- Modify: `docs/ARCHITECTURE.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the calc engine from Task 2.
- Produces: `window.initQuotationModule()`; views `quoteList`, `quoteEditor`, `quoteRevision`; the DOM containers `#quoteListView`, `#quoteEditorView`, `#quoteRevisionView`.

- [ ] **Step 1: Add the PRIMARY_NAV entry**

In `js/admin.js`, inside `PRIMARY_NAV`, insert **after** the `pm` block and **before** the `appointments` block:

```js
    // Outgoing client quotations. Pre-sales: a quotation exists before any
    // project does, and belongs to NEITHER project system — hence its own
    // top-level tab rather than a slot under Project Control.
    // Owner-only (0045), like Reimbursement and Warranty Fund.
    { id: 'quotations', label: 'Quotations', sub: 'Estimates & Proposals', defaultView: 'quoteList',
      modules: [
        { view: 'quoteList', label: 'Quotations', icon: 'file-text' },
      ]
    },
```

- [ ] **Step 2: Add the focus sub-views**

In `js/admin.js`, in `_FOCUS_SUBVIEWS`, add:

```js
    quotations: ['quoteEditor', 'quoteRevision'],
```

This is the entry that gets missed. Without it, an account with `allowed_modules = ['quotations']` can open the list but the drill-down into the editor is bounced back.

- [ ] **Step 3: Hide the tab from every non-owner role**

In `js/admin.js`, in `_visibleNav()`, extend the `.filter()` so the section is dropped for staff as well as workers. Replace:

```js
            if (role === 'staff') return p.id !== 'users';
```
with:
```js
            // Quotations is peso amounts end to end and owner-only by RLS
            // (0045) — same reasoning as Reimbursement and Warranty Fund.
            if (role === 'staff') return p.id !== 'users' && p.id !== 'quotations';
```

The existing `worker` / `teamLeader` branch already returns only `construction`, so those roles are covered.

- [ ] **Step 4: Bump the admin.js cache-buster**

In `admin.html` (~line 4998), bump the query string:
```html
<script src="js/admin.js?v=20260805a"></script>
```
`admin.js` carries `PRIMARY_NAV`; a stale cached copy silently hides the new tab. This step is not optional.

- [ ] **Step 5: Add the section markup**

In `admin.html`, immediately after the BOQ Builder view block (`<div id="boqBuilderView" …></div>`, ~line 2568), add:

```html
        <!-- ════════════ QUOTATIONS ════════════ -->
        <!-- Rendered dynamically by js/quotation-module.js -->
        <div id="quoteListView"     class="content-view" style="display: none;"></div>
        <div id="quoteEditorView"   class="content-view" style="display: none;"></div>
        <div id="quoteRevisionView" class="content-view" style="display: none;"></div>
```

- [ ] **Step 6: Add the sidebar nav item**

In `admin.html`, after the `data-view="boqBuilder"` nav item (~line 173), add one matching its markup exactly:

```html
                    <a href="#" class="nav-item nav-child" data-view="quoteList">
                        <i data-lucide="file-text"></i>
                        <span>Quotations</span>
                    </a>
```

- [ ] **Step 7: Add the stylesheet and script tags**

In `admin.html`, next to the BOQ stylesheet link (~line 29):
```html
    <link rel="stylesheet" href="css/quotation-module.css">
```

And after `<script src="js/boq-module.js"></script>` (~line 5004):
```html
<script src="js/quotation-module.js"></script>
<script src="js/quotation-print.js"></script>
```

`quotation-print.js` is created in Task 12. Until then the tag 404s harmlessly in the console — or create the file now as an empty IIFE to keep the console clean:
```js
/* Quotation print sheet + PDF export — see Task 12. */
(function () { 'use strict'; })();
```

- [ ] **Step 8: Create the stylesheet**

Create `css/quotation-module.css` with the shared shell the later tasks build on:

```css
/* ════════════════════════════════════════════════════════════════════
   QUOTATIONS MODULE — list, editor, revision viewer.
   Print styles live in the generated print window, not here.
   ════════════════════════════════════════════════════════════════════ */
.qt-header      { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap; }
.qt-title       { font-size:1.35rem; font-weight:700; color:#111827; margin:0; }
.qt-sub         { font-size:.85rem; color:#6b7280; margin:.15rem 0 0; }

.qt-stats       { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:.75rem; margin:1rem 0; }
.qt-stat        { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:.75rem .9rem; }
.qt-stat-label  { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; }
.qt-stat-value  { font-size:1.15rem; font-weight:700; color:#111827; margin-top:.2rem; }

.qt-table       { width:100%; border-collapse:collapse; background:#fff; font-size:.85rem; }
.qt-table th    { text-align:left; padding:.6rem .7rem; background:#f9fafb; border-bottom:1px solid #e5e7eb;
                  font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; }
.qt-table td    { padding:.6rem .7rem; border-bottom:1px solid #f3f4f6; }
.qt-table tr.qt-row-overdue { background:#fffbeb; }
.qt-amt         { text-align:right; font-variant-numeric:tabular-nums; }

.qt-pill        { display:inline-block; padding:.15rem .5rem; border-radius:999px; font-size:.72rem; font-weight:600; }
.qt-pill-draft  { background:#f3f4f6; color:#4b5563; }
.qt-pill-sent   { background:#dbeafe; color:#1d4ed8; }
.qt-pill-won    { background:#d1fae5; color:#047857; }
.qt-pill-lost   { background:#fee2e2; color:#b91c1c; }
.qt-pill-expired{ background:#fef3c7; color:#b45309; }

.qt-btn         { padding:.45rem .9rem; border-radius:8px; border:1px solid #d1d5db; background:#fff;
                  font-size:.82rem; font-weight:600; cursor:pointer; }
.qt-btn-primary { background:#059669; border-color:#059669; color:#fff; }
.qt-btn-danger  { background:#fff; border-color:#fca5a5; color:#b91c1c; }

.qt-empty       { text-align:center; padding:3rem 1rem; color:#6b7280; }

.qt-toast       { position:fixed; bottom:1.25rem; left:50%; transform:translateX(-50%) translateY(1rem);
                  background:#111827; color:#fff; padding:.7rem 1.1rem; border-radius:8px; font-size:.85rem;
                  opacity:0; pointer-events:none; transition:opacity .2s, transform .2s; z-index:10000; }
.qt-toast-show  { opacity:1; transform:translateX(-50%) translateY(0); }
.qt-toast-error { background:#b91c1c; }
```

- [ ] **Step 9: Wire the views into switchView**

In `admin.html`, inside the `switchView` IIFE:

Add the view group next to the others (~line 5748):
```js
    const QUOTE_VIEWS = ['quoteList','quoteEditor','quoteRevision'];
```

Add the titles to `TITLES` (~line 5773):
```js
        quoteList:        'Quotations',
        quoteEditor:      'Quotation',
        quoteRevision:    'Quotation Revision',
```

Add the views to the staff `blocked` list (~line 5796) and bounce them to the dashboard, since Quotations has no parent section a staff member can see:
```js
                const blocked = ['userNavigator', 'clientAccounts', 'sysErrors', 'expReports',
                                 'reimbursements', 'warrantyFund',
                                 'quoteList', 'quoteEditor', 'quoteRevision'];
```
The existing bounce logic already sends anything not named `warrantyFund`/`expReports`/`reimbursements` to `dashboard`, so no change is needed there.

Add the init dispatch next to the others (~line 5888):
```js
        if (QUOTE_VIEWS.includes(view) && typeof initQuotationModule === 'function') initQuotationModule(view);
```

- [ ] **Step 10: Add the module entry point**

In `js/quotation-module.js`, below the `Object.assign(window, {…})` block and still inside the IIFE, add:

```js
    // ── State ─────────────────────────────────────────────────────────
    const qtState = {
        list:      [],     // all live quotations for this owner
        presets:   [],     // client + scope presets
        current:   null,   // the quotation open in the editor
        revisions: [],     // revisions of the current quotation
        filters:   { status: 'all', year: 'all', search: '' },
        isDirty:   false,
        unsub:     null,
        revUnsub:  null
    };

    function qtUid() {
        return (window.auth && window.auth.currentUser && window.auth.currentUser.uid) || null;
    }
    // Owner-only. Staff are already blocked in _visibleNav and switchView;
    // this is the module's own third gate (RLS is the fourth).
    function qtIsOwner() {
        return typeof window.currentUserRole === 'undefined'
            || window.currentUserRole === null
            || window.currentUserRole === 'owner';
    }
    function qtEl(id) { return document.getElementById(id); }

    function qtToast(msg, type) {
        let t = qtEl('qtToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'qtToast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.className = 'qt-toast qt-toast-show' + (type === 'error' ? ' qt-toast-error' : '');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove('qt-toast-show'), 3200);
    }

    // Stable ids for tree nodes. The revision diff matches lines by these,
    // so they must survive a save/load round-trip — never regenerate them.
    function qtNewId() {
        return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    window.initQuotationModule = function (view) {
        if (!qtUid() || !qtIsOwner()) return;
        if (view === 'quoteList' || !view) {
            const root = qtEl('quoteListView');
            if (root) root.innerHTML = '<div class="qt-empty">Quotations — list renders in Task 4.</div>';
        }
    };

    Object.assign(window, { qtToast, qtNewId });
```

- [ ] **Step 11: Syntax-check everything touched**

Run:
```bash
node --check js/admin.js && node --check js/quotation-module.js && node --check js/quotation-print.js && npm test
```
Expected: no output from the checks, and all three test files green.

- [ ] **Step 12: Verify in the browser as owner**

Open `admin.html`, log in as **owner**. Expected:
- A **Quotations** tab appears in the top nav between *Project Management* and *Appointments*
- Clicking it lands on the placeholder text and the page title reads "Quotations"
- No console errors

- [ ] **Step 13: Verify in the browser as staff**

Log in as a **staff** account. Expected:
- The Quotations tab is **not rendered**
- In the console, `switchView('quoteList')` bounces to the dashboard rather than opening the view

- [ ] **Step 14: Update the docs**

In `docs/ARCHITECTURE.md`:
- §4 module map — add a row:
  `| Quotations | quotation-module.js, quotation-print.js | Outgoing client quotations (0045) — itemized estimate, revisions, win/loss pipeline, print/PDF. **Deliberately isolated** like Reimbursement and Warranty Fund: no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Marking a quote Won changes a status string and nothing else. Owner-only; staff never see it |`
- §7 data model — add `quotations`, `quotation_revisions`, `quotation_presets` (tracking only, `0045` — never read by the money model) to the grouped list.

In `CLAUDE.md`, under **Money invariants**, add a bullet next to the reimbursements and warranty-retention ones:
> - **`quotations` (0045) is outside the money model.** A quotation is a *proposal*, not revenue. Nothing may feed it into Spent / Earned / Profit, and marking a quote **Won** must never create a folder, construction project, invoice or contract value — converting a won quote into a project is a manual admin action. Only `js/quotation-module.js` and `js/quotation-print.js` may touch those tables. Owner-only; staff never see it.

- [ ] **Step 15: Hand off for commit**

```bash
git add js/admin.js admin.html js/quotation-module.js js/quotation-print.js css/quotation-module.css docs/ARCHITECTURE.md CLAUDE.md
git commit -m "feat(quotations): nav tab, view routing, owner-only guards and docs"
```

---

## Task 4: List page — load, render, pipeline stats, filters

**Files:**
- Modify: `js/quotation-module.js`
- Modify: `css/quotation-module.css` (only if a style is missing)

**Interfaces:**
- Consumes: `qtState`, `qtToast`, calc engine (`qtIsExpired`, `qtFmt`, `qtEscHtml`).
- Produces: `qtLoadList()`, `qtRenderList()`, `qtPipelineStats(list) → {draft, sent, won, lost, expired, pendingValue, wonValueYear, winRate, overdue}`, `qtStatusOf(q) → 'draft'|'sent'|'won'|'lost'|'expired'`, `window.qtSetFilter(key, value)`, `window.qtOpenQuote(id)` (stub until Task 5).

- [ ] **Step 1: Add the loader and the derived-status helper**

In `js/quotation-module.js`, below `initQuotationModule`, add:

```js
    // Display status. 'expired' is DERIVED, never stored — extending the
    // validity date fixes it and no cron is needed.
    function qtStatusOf(q) { return qtIsExpired(q) ? 'expired' : (q.status || 'draft'); }

    function qtIsOverdue(q) {
        return q.status === 'sent' && q.followUpDate && q.followUpDate < qtTodayKey();
    }

    function qtLoadList() {
        if (qtState.unsub) { qtState.unsub(); qtState.unsub = null; }
        qtState.unsub = db.collection('quotations')
            .where('userId', '==', qtUid())
            .onSnapshot(snap => {
                qtState.list = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(q => !q.deletedAt);          // soft delete
                if (!qtState.current) qtRenderList();
            }, err => {
                console.error('[QT] list load error:', err);
                qtToast('Could not load quotations: ' + err.message, 'error');
            });

        if (typeof window.registerViewCleanup === 'function') {
            window.registerViewCleanup(() => {
                if (qtState.unsub)    { qtState.unsub();    qtState.unsub = null; }
                if (qtState.revUnsub) { qtState.revUnsub(); qtState.revUnsub = null; }
            });
        }
    }
```

- [ ] **Step 2: Add the pipeline stats**

```js
    // Win rate deliberately ignores draft/sent — an undecided quote is not
    // a loss. Pending value excludes expired quotes: an expired price is
    // not a live opportunity.
    function qtPipelineStats(list) {
        const yr = new Date().getFullYear();
        const s = { draft: 0, sent: 0, won: 0, lost: 0, expired: 0,
                    pendingValue: 0, wonValueYear: 0, winRate: 0, overdue: 0 };
        (list || []).forEach(q => {
            const st = qtStatusOf(q);
            s[st] = (s[st] || 0) + 1;
            if (st === 'sent') s.pendingValue += qtParseNum(q.totalAmount);
            if (q.status === 'won' && String(q.quoteDate || '').startsWith(String(yr))) {
                s.wonValueYear += qtParseNum(q.totalAmount);
            }
            if (qtIsOverdue(q)) s.overdue++;
        });
        const decided = s.won + s.lost;
        s.winRate = decided ? (s.won / decided) * 100 : 0;
        return s;
    }
```

- [ ] **Step 3: Add filtering and the renderer**

```js
    function qtFilteredList() {
        const f = qtState.filters, term = (f.search || '').toLowerCase();
        return qtState.list
            .filter(q => f.status === 'all' || qtStatusOf(q) === f.status)
            .filter(q => f.year === 'all' || String(q.quoteDate || '').startsWith(f.year))
            .filter(q => !term
                || (q.quoteNo     || '').toLowerCase().includes(term)
                || (q.clientName  || '').toLowerCase().includes(term)
                || (q.projectName || '').toLowerCase().includes(term))
            // Overdue follow-ups pinned to the top, then newest first.
            .sort((a, b) => (qtIsOverdue(b) - qtIsOverdue(a))
                         || String(b.quoteDate || '').localeCompare(String(a.quoteDate || '')));
    }

    function qtRenderList() {
        const root = qtEl('quoteListView');
        if (!root) return;
        const stats = qtPipelineStats(qtState.list);
        const rows  = qtFilteredList();
        const years = [...new Set(qtState.list.map(q => String(q.quoteDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();

        root.innerHTML = `
        <div class="qt-header">
            <div>
                <h2 class="qt-title">Quotations</h2>
                <p class="qt-sub">Client estimates and proposals${stats.overdue ? ` · <strong>${stats.overdue} follow-up${stats.overdue > 1 ? 's' : ''} overdue</strong>` : ''}</p>
            </div>
            <button class="qt-btn qt-btn-primary" onclick="qtNewQuote()">+ New Quotation</button>
        </div>

        <div class="qt-stats">
            ${qtStatCard('Draft',        stats.draft)}
            ${qtStatCard('Sent',         stats.sent)}
            ${qtStatCard('Expired',      stats.expired)}
            ${qtStatCard('Won',          stats.won)}
            ${qtStatCard('Lost',         stats.lost)}
            ${qtStatCard('Win rate',     stats.winRate.toFixed(0) + '%')}
            ${qtStatCard('Pending value','₱' + qtFmt(stats.pendingValue))}
            ${qtStatCard('Won this year','₱' + qtFmt(stats.wonValueYear))}
        </div>

        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem;">
            <select class="qt-btn" onchange="qtSetFilter('status', this.value)">
                ${['all','draft','sent','expired','won','lost'].map(v =>
                    `<option value="${v}"${qtState.filters.status === v ? ' selected' : ''}>${v === 'all' ? 'All statuses' : v}</option>`).join('')}
            </select>
            <select class="qt-btn" onchange="qtSetFilter('year', this.value)">
                <option value="all">All years</option>
                ${years.map(y => `<option value="${y}"${qtState.filters.year === y ? ' selected' : ''}>${y}</option>`).join('')}
            </select>
            <input class="qt-btn" style="font-weight:400;" placeholder="Search no. / client / project"
                   value="${qtEscHtml(qtState.filters.search)}"
                   oninput="qtSetFilter('search', this.value)">
        </div>

        ${rows.length ? `
        <table class="qt-table">
            <thead><tr>
                <th>Quote No.</th><th>Client</th><th>Project</th>
                <th>Date</th><th>Valid until</th><th class="qt-amt">Total</th>
                <th>Status</th><th></th>
            </tr></thead>
            <tbody>${rows.map(qtListRow).join('')}</tbody>
        </table>` : `
        <div class="qt-empty">
            <p><strong>No quotations yet</strong></p>
            <p>Create one to send a client an itemized estimate.</p>
        </div>`}`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function qtStatCard(label, value) {
        return `<div class="qt-stat"><div class="qt-stat-label">${label}</div><div class="qt-stat-value">${value}</div></div>`;
    }

    function qtListRow(q) {
        const st = qtStatusOf(q);
        return `<tr class="${qtIsOverdue(q) ? 'qt-row-overdue' : ''}">
            <td><strong>${qtEscHtml(q.quoteNo || '—')}</strong>${(q.revNo || 1) > 1 ? ` <span class="qt-sub">Rev ${q.revNo}</span>` : ''}</td>
            <td>${qtEscHtml(q.clientName || '—')}</td>
            <td>${qtEscHtml(q.projectName || '—')}</td>
            <td>${qtEscHtml(q.quoteDate || '—')}</td>
            <td>${qtEscHtml(q.validUntil || '—')}${qtIsOverdue(q) ? ' <span class="qt-pill qt-pill-expired">follow up</span>' : ''}</td>
            <td class="qt-amt">₱${qtFmt(q.totalAmount)}</td>
            <td><span class="qt-pill qt-pill-${st}">${st}</span></td>
            <td><button class="qt-btn" onclick="qtOpenQuote('${q.id}')">Open</button></td>
        </tr>`;
    }

    window.qtSetFilter = function (key, value) {
        qtState.filters[key] = value;
        qtRenderList();
    };
    // Replaced with the real editor in Task 5.
    window.qtOpenQuote = function (id) { console.log('[QT] open', id); };
    window.qtNewQuote  = function () { console.log('[QT] new'); };
```

- [ ] **Step 4: Call the loader from init**

Replace the body of `window.initQuotationModule` with:

```js
    window.initQuotationModule = function (view) {
        if (!qtUid() || !qtIsOwner()) return;
        qtLoadList();
        if (view === 'quoteList' || !view) qtRenderList();
    };
```

- [ ] **Step 5: Verify**

Run: `node --check js/quotation-module.js && npm test` → clean and green.

In the browser as **owner**, open Quotations. Expected: the eight stat cards render with zeros, the filters render, and the empty state reads "No quotations yet". No console errors.

Then seed two rows from the console and confirm they appear **without a reload** (this proves the realtime publication from Task 1):
```js
const uid = auth.currentUser.uid;
await db.collection('quotations').add({ userId: uid, quoteNo: 'Q-2026-0001', clientName: 'Los Churreros',
  projectName: 'Ayala Feliz kiosk', quoteDate: '2026-08-01', validUntil: '2026-09-01',
  totalAmount: 203543, status: 'sent', sections: [], terms: {} });
await db.collection('quotations').add({ userId: uid, quoteNo: 'Q-2026-0002', clientName: 'Test Co',
  projectName: 'Expired demo', quoteDate: '2026-01-05', validUntil: '2026-02-05',
  totalAmount: 50000, status: 'sent', sections: [], terms: {} });
```
Expected: two rows appear live; the second shows the **expired** pill; Sent = 1, Expired = 1; Pending value = ₱203,543.00 (the expired one is excluded).

Leave these rows in place — Tasks 5–11 use them. Delete them at the end of Task 11.

- [ ] **Step 6: Hand off for commit**

```bash
git add js/quotation-module.js css/quotation-module.css
git commit -m "feat(quotations): list page with pipeline stats and filters"
```

---

## Task 5: Editor shell — create, load, save, quote numbering

**Files:**
- Modify: `js/quotation-module.js`

**Interfaces:**
- Consumes: `qtState`, `qtNextQuoteNo`, `qtGrandTotal`, `qtNewId`, `qtToast`.
- Produces: `window.qtNewQuote()`, `window.qtOpenQuote(id)`, `window.qtSave()`, `window.qtBackToList()`, `qtRenderEditor()`, `qtCollectHeader()`, `qtBlankQuote() → object`, `qtMarkDirty()`.

- [ ] **Step 1: Add the blank-quote factory and the editor state**

```js
    function qtBlankQuote() {
        const today = qtTodayKey();
        const d = new Date(); d.setDate(d.getDate() + 30);
        const p = n => String(n).padStart(2, '0');
        const validUntil = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        return {
            id: null,
            quoteNo: qtNextQuoteNo(qtState.list), revNo: 1,
            quoteDate: today, validUntil,
            clientName: '', clientEmail: '', clientAddress: '', clientTin: '',
            projectName: '', location: '', subject: 'Project Estimate', scopeNote: '',
            sections: [],
            discount: 0, discountType: 'amount',
            vatMode: 'none', vatPct: 12,
            totalAmount: 0,
            status: 'draft', statusNote: '', decidedAt: null,
            followUpDate: '', followUpNote: '',
            terms: qtDefaultTerms(), preparedBy: '', history: []
        };
    }

    // Overwritten from settings/quotationDefaults in Task 8.
    function qtDefaultTerms() {
        return { validityNote: '', payment: '', deliveryTimeline: '', warranty: '',
                 exclusions: '', conditions: [], signOff: { preparedBy: true, clientApproval: true } };
    }

    function qtMarkDirty() { qtState.isDirty = true; }
```

- [ ] **Step 2: Add open / new / back**

```js
    window.qtNewQuote = function () {
        qtState.current   = qtBlankQuote();
        qtState.revisions = [];
        qtState.isDirty   = false;
        switchView('quoteEditor');
        qtRenderEditor();
    };

    window.qtOpenQuote = function (id) {
        const q = qtState.list.find(x => x.id === id);
        if (!q) { qtToast('Quotation not found', 'error'); return; }
        qtState.current   = JSON.parse(JSON.stringify(q));   // edit a copy
        qtState.revisions = [];
        qtState.isDirty   = false;
        switchView('quoteEditor');
        qtRenderEditor();
        qtLoadRevisions(id);                                  // defined in Task 10
    };

    window.qtBackToList = function () {
        if (qtState.isDirty && !confirm('You have unsaved changes. Leave anyway?')) return;
        qtState.current = null;
        qtState.isDirty = false;
        switchView('quoteList');
        qtRenderList();
    };

    // No-op until Task 10 defines the real one.
    function qtLoadRevisions() {}
```

- [ ] **Step 3: Add the header form renderer**

```js
    function qtField(label, key, type, extra) {
        const v = qtState.current[key];
        return `<label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;margin-bottom:.15rem;">${label}</label>
                <input class="qt-btn" style="font-weight:400;width:100%;margin-bottom:.6rem;"
                       type="${type || 'text'}" data-qt-key="${key}"
                       value="${qtEscHtml(v === null || v === undefined ? '' : v)}"
                       ${extra || ''} oninput="qtMarkDirty()">`;
    }

    function qtRenderEditor() {
        const root = qtEl('quoteEditorView');
        const q = qtState.current;
        if (!root || !q) return;
        const st = qtStatusOf(q);

        root.innerHTML = `
        <div class="qt-header">
            <div>
                <h2 class="qt-title">${qtEscHtml(q.quoteNo || 'New Quotation')}
                    ${q.revNo > 1 ? `<span class="qt-sub">Rev ${q.revNo}</span>` : ''}
                    <span class="qt-pill qt-pill-${st}">${st}</span></h2>
                <p class="qt-sub">${qtEscHtml(q.projectName || 'Untitled project')}</p>
            </div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                <button class="qt-btn" onclick="qtBackToList()">← Back</button>
                <button class="qt-btn qt-btn-primary" onclick="qtSave()">Save</button>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin-top:1rem;">
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;">
                <h3 style="font-size:.85rem;margin:0 0 .75rem;">Client</h3>
                ${qtField('Client name',  'clientName')}
                ${qtField('Email',        'clientEmail', 'email')}
                ${qtField('Address',      'clientAddress')}
                ${qtField('TIN',          'clientTin')}
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;">
                <h3 style="font-size:.85rem;margin:0 0 .75rem;">Project</h3>
                ${qtField('Project name', 'projectName')}
                ${qtField('Location',     'location')}
                ${qtField('Subject',      'subject')}
                ${qtField('Prepared by',  'preparedBy')}
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;">
                <h3 style="font-size:.85rem;margin:0 0 .75rem;">Document</h3>
                ${qtField('Quote no.',    'quoteNo')}
                ${qtField('Quote date',   'quoteDate',  'date')}
                ${qtField('Valid until',  'validUntil', 'date')}
            </div>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
            <label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;margin-bottom:.15rem;">Scope note</label>
            <textarea class="qt-btn" style="font-weight:400;width:100%;min-height:60px;" data-qt-key="scopeNote"
                      oninput="qtMarkDirty()">${qtEscHtml(q.scopeNote)}</textarea>
        </div>

        <div id="qtSectionsPane"></div>   <!-- Task 6 -->
        <div id="qtTotalsPane"></div>     <!-- Task 6 -->
        <div id="qtTermsPane"></div>      <!-- Task 8 -->
        <div id="qtOutcomePane"></div>    <!-- Task 9 -->
        <div id="qtRevisionsPane"></div>  <!-- Task 10 -->
        `;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // Reads every [data-qt-key] input back into qtState.current.
    function qtCollectHeader() {
        const root = qtEl('quoteEditorView');
        if (!root || !qtState.current) return;
        root.querySelectorAll('[data-qt-key]').forEach(inp => {
            qtState.current[inp.dataset.qtKey] = inp.value;
        });
    }
```

- [ ] **Step 4: Add save**

```js
    window.qtSave = async function () {
        if (!qtState.current) return;
        qtCollectHeader();
        const q = qtState.current;
        q.totalAmount = qtGrandTotal(q);

        // Only the columns that exist in migration 0045. The shim maps
        // camelCase straight to snake_case, so ANY stray key fails the whole
        // save — never spread an arbitrary object in here.
        const payload = {
            userId: qtUid(),
            quoteNo: q.quoteNo, revNo: q.revNo,
            quoteDate: q.quoteDate || null, validUntil: q.validUntil || null,
            clientName: q.clientName, clientEmail: q.clientEmail,
            clientAddress: q.clientAddress, clientTin: q.clientTin,
            projectName: q.projectName, location: q.location,
            subject: q.subject, scopeNote: q.scopeNote,
            sections: q.sections || [],
            discount: qtParseNum(q.discount), discountType: q.discountType || 'amount',
            vatMode: q.vatMode || 'none', vatPct: qtParseNum(q.vatPct),
            totalAmount: q.totalAmount,
            status: q.status || 'draft', statusNote: q.statusNote || '',
            decidedAt: q.decidedAt || null,
            followUpDate: q.followUpDate || null, followUpNote: q.followUpNote || '',
            terms: q.terms || {}, preparedBy: q.preparedBy || '',
            history: q.history || [],
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (q.id) {
                await db.collection('quotations').doc(q.id).update(payload);
            } else {
                payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                payload.createdBy = (window.auth.currentUser && window.auth.currentUser.email) || '';
                const ref = await db.collection('quotations').add(payload);
                q.id = ref.id;
            }
            qtState.isDirty = false;
            qtToast('Quotation saved');
            qtRenderEditor();
        } catch (e) {
            console.error('[QT] save failed:', e);
            // Surface the real Postgres message — a missing column fails the
            // entire save, and a generic "could not save" hides which one.
            qtToast('Save failed: ' + (e.message || e), 'error');
        }
    };
```

- [ ] **Step 5: Add Ctrl+S and the dirty guard**

At the end of `initQuotationModule`, before the closing brace:

```js
        // Attach once — init runs on EVERY view switch, so without this guard
        // Ctrl+S fires qtSave() N times and the unload guards stack.
        if (!window._qtHandlersWired) {
            window._qtHandlersWired = true;
            window.addEventListener('beforeunload', e => {
                if (qtState.isDirty) { e.preventDefault(); e.returnValue = ''; }
            });
            document.addEventListener('keydown', e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    const v = qtEl('quoteEditorView');
                    if (v && v.style.display !== 'none') { e.preventDefault(); window.qtSave(); }
                }
            });
        }
```

Also extend the init dispatch so the editor re-renders when returning to it:
```js
        if (view === 'quoteEditor' && qtState.current) qtRenderEditor();
```

And export the new globals:
```js
    Object.assign(window, { qtMarkDirty });
```

- [ ] **Step 6: Verify**

Run: `node --check js/quotation-module.js && npm test` → clean and green.

In the browser as owner:
1. Click **+ New Quotation** → the editor opens with `Q-2026-0003` (continuing from the two seeded rows), today's date, and a validity 30 days out
2. Fill in a client and project name, press **Ctrl+S** → toast "Quotation saved"
3. Click **← Back** → the new quote appears in the list with status `draft`
4. Click **Open** on it → the values load back correctly
5. Change a field, click **← Back** without saving → the confirm dialog appears

- [ ] **Step 7: Hand off for commit**

```bash
git add js/quotation-module.js
git commit -m "feat(quotations): editor shell with create, load, save and quote numbering"
```

---

## Task 6: Section tree editor and the totals panel

**Files:**
- Modify: `js/quotation-module.js`
- Modify: `css/quotation-module.css`

**Interfaces:**
- Consumes: the calc engine, `qtNewId`, `qtMarkDirty`, `qtRenderEditor`.
- Produces: `qtRenderSections()`, `qtRenderTotals()`, and globals `qtAddSection()`, `qtAddGroup(sIdx)`, `qtAddLine(sIdx, gIdx)`, `qtDeleteNode(kind, sIdx, gIdx, lIdx)`, `qtMoveNode(kind, sIdx, gIdx, lIdx, dir)`, `qtSetNodeField(kind, sIdx, gIdx, lIdx, field, value)`, `qtSetPricing(sIdx, mode)`.

- [ ] **Step 1: Add the tree mutators**

```js
    function qtSections() { return (qtState.current && qtState.current.sections) || []; }

    window.qtAddSection = function () {
        qtSections().push({ id: qtNewId(), label: '', pricing: 'rated', lumpAmount: '', images: [], groups: [] });
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };
    window.qtAddGroup = function (sIdx) {
        qtSections()[sIdx].groups.push({ id: qtNewId(), label: '', lumpAmount: '', lines: [] });
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };
    window.qtAddLine = function (sIdx, gIdx) {
        qtSections()[sIdx].groups[gIdx].lines.push({
            id: qtNewId(), description: '', qty: 1, unit: 'set', unitPrice: 0, state: 'normal'
        });
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };

    window.qtDeleteNode = function (kind, sIdx, gIdx, lIdx) {
        // A line is DELETED here only while drafting. To retire a line from a
        // sent quote, set its state to 'removed' instead — that keeps the
        // price in the data so the revision diff can value the deletion.
        if (!confirm('Delete this ' + kind + '?')) return;
        if (kind === 'section') qtSections().splice(sIdx, 1);
        else if (kind === 'group') qtSections()[sIdx].groups.splice(gIdx, 1);
        else qtSections()[sIdx].groups[gIdx].lines.splice(lIdx, 1);
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };

    window.qtMoveNode = function (kind, sIdx, gIdx, lIdx, dir) {
        const arr = kind === 'section' ? qtSections()
                  : kind === 'group'   ? qtSections()[sIdx].groups
                  :                      qtSections()[sIdx].groups[gIdx].lines;
        const i = kind === 'section' ? sIdx : kind === 'group' ? gIdx : lIdx;
        const j = i + dir;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        qtMarkDirty(); qtRenderSections();
    };

    window.qtSetNodeField = function (kind, sIdx, gIdx, lIdx, field, value) {
        const node = kind === 'section' ? qtSections()[sIdx]
                   : kind === 'group'   ? qtSections()[sIdx].groups[gIdx]
                   :                      qtSections()[sIdx].groups[gIdx].lines[lIdx];
        node[field] = value;
        qtMarkDirty(); qtRenderTotals();
        if (field === 'state') qtRenderSections();   // restyle the row
    };

    window.qtSetPricing = function (sIdx, mode) {
        qtSections()[sIdx].pricing = mode;
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };
```

- [ ] **Step 2: Add the tree renderer**

```js
    const QT_STATES = ['normal', 'optional', 'waived', 'removed'];

    function qtRenderSections() {
        const pane = qtEl('qtSectionsPane');
        if (!pane || !qtState.current) return;
        const secs = qtSections();

        pane.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin:1.25rem 0 .5rem;">
            <h3 style="font-size:.95rem;margin:0;">Itemized estimate</h3>
            <button class="qt-btn" onclick="qtAddSection()">+ Section</button>
        </div>
        ${secs.length ? secs.map((sec, si) => `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-bottom:.75rem;">
            <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
                <input class="qt-btn" style="flex:1;min-width:180px;font-weight:700;" placeholder="SECTION NAME"
                       value="${qtEscHtml(sec.label)}"
                       oninput="qtSetNodeField('section',${si},0,0,'label',this.value)">
                <select class="qt-btn" onchange="qtSetPricing(${si}, this.value)">
                    <option value="rated"${sec.pricing === 'rated' ? ' selected' : ''}>Rated (qty × price)</option>
                    <option value="lump"${sec.pricing === 'lump'  ? ' selected' : ''}>Lump sum (LOT)</option>
                </select>
                ${sec.pricing === 'lump' ? `
                <input class="qt-btn qt-amt" style="width:140px;" placeholder="LOT amount"
                       value="${qtEscHtml(sec.lumpAmount)}"
                       oninput="qtSetNodeField('section',${si},0,0,'lumpAmount',this.value)">` : ''}
                <span class="qt-stat-value">₱${qtFmt(qtSectionTotal(sec))}</span>
                <button class="qt-btn" onclick="qtMoveNode('section',${si},0,0,-1)">↑</button>
                <button class="qt-btn" onclick="qtMoveNode('section',${si},0,0,1)">↓</button>
                <button class="qt-btn qt-btn-danger" onclick="qtDeleteNode('section',${si},0,0)">Delete</button>
            </div>
            ${sec.pricing === 'lump' && sec.lumpAmount !== '' && sec.lumpAmount !== null
              ? `<p class="qt-sub" style="margin:.4rem 0 0;">This section is priced as one LOT. The group amounts below are a printed breakdown and do <strong>not</strong> add to the total.</p>` : ''}

            <div id="qtImages-${si}"></div>   <!-- Task 7 -->

            ${(sec.groups || []).map((g, gi) => `
            <div style="border-top:1px solid #f3f4f6;margin-top:.75rem;padding-top:.75rem;">
                <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
                    <input class="qt-btn" style="flex:1;min-width:160px;font-weight:600;" placeholder="Group / sub-item"
                           value="${qtEscHtml(g.label)}"
                           oninput="qtSetNodeField('group',${si},${gi},0,'label',this.value)">
                    ${sec.pricing === 'lump' ? `
                    <input class="qt-btn qt-amt" style="width:130px;" placeholder="Amount"
                           value="${qtEscHtml(g.lumpAmount)}"
                           oninput="qtSetNodeField('group',${si},${gi},0,'lumpAmount',this.value)">` : `
                    <span class="qt-sub">₱${qtFmt(qtGroupTotal(g))}</span>`}
                    <button class="qt-btn" onclick="qtMoveNode('group',${si},${gi},0,-1)">↑</button>
                    <button class="qt-btn" onclick="qtMoveNode('group',${si},${gi},0,1)">↓</button>
                    <button class="qt-btn qt-btn-danger" onclick="qtDeleteNode('group',${si},${gi},0)">×</button>
                </div>
                <table class="qt-table" style="margin-top:.5rem;">
                    <thead><tr>
                        <th style="width:38%">Description</th><th style="width:70px">Qty</th>
                        <th style="width:80px">Unit</th>
                        ${sec.pricing === 'rated' ? '<th style="width:110px">Unit price</th><th class="qt-amt" style="width:110px">Amount</th>' : '<th colspan="2"></th>'}
                        <th style="width:110px">State</th><th style="width:40px"></th>
                    </tr></thead>
                    <tbody>${(g.lines || []).map((l, li) => qtLineRow(sec, si, gi, li, l)).join('')}</tbody>
                </table>
                <button class="qt-btn" style="margin-top:.4rem;" onclick="qtAddLine(${si},${gi})">+ Line</button>
            </div>`).join('')}

            <button class="qt-btn" style="margin-top:.75rem;" onclick="qtAddGroup(${si})">+ Group</button>
        </div>`).join('') : `<div class="qt-empty">No sections yet. Add one to start itemizing.</div>`}`;

        if (typeof qtRenderImages === 'function') qtSections().forEach((_, si) => qtRenderImages(si));
    }

    function qtLineRow(sec, si, gi, li, l) {
        const struck = l.state === 'removed' ? 'text-decoration:line-through;opacity:.55;' : '';
        const faded  = (l.state === 'optional' || l.state === 'waived') ? 'opacity:.7;' : '';
        return `<tr style="${struck}${faded}">
            <td><input class="qt-btn" style="width:100%;font-weight:400;" value="${qtEscHtml(l.description)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'description',this.value)"></td>
            <td><input class="qt-btn" style="width:100%;font-weight:400;" value="${qtEscHtml(l.qty)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'qty',this.value)"></td>
            <td><input class="qt-btn" style="width:100%;font-weight:400;" value="${qtEscHtml(l.unit)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'unit',this.value)"></td>
            ${sec.pricing === 'rated' ? `
            <td><input class="qt-btn qt-amt" style="width:100%;font-weight:400;" value="${qtEscHtml(l.unitPrice)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'unitPrice',this.value)"></td>
            <td class="qt-amt">${qtFmt(qtLineAmount(l))}</td>` : '<td colspan="2" class="qt-sub">scope only</td>'}
            <td><select class="qt-btn" style="width:100%;"
                        onchange="qtSetNodeField('line',${si},${gi},${li},'state',this.value)">
                ${QT_STATES.map(s => `<option value="${s}"${(l.state || 'normal') === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select></td>
            <td><button class="qt-btn qt-btn-danger" onclick="qtDeleteNode('line',${si},${gi},${li})">×</button></td>
        </tr>`;
    }
```

- [ ] **Step 3: Add the totals panel**

```js
    function qtRenderTotals() {
        const pane = qtEl('qtTotalsPane');
        const q = qtState.current;
        if (!pane || !q) return;
        const pc = qtProjectCost(q.sections), disc = qtDiscountAmount(q),
              sub = qtSubTotal(q), vat = qtVatAmount(q), total = qtGrandTotal(q);

        pane.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;max-width:460px;margin-left:auto;">
            <table style="width:100%;font-size:.88rem;">
                <tr><td>Project Cost</td><td class="qt-amt">₱${qtFmt(pc)}</td></tr>
                <tr>
                    <td>Less: Discount
                        <select class="qt-btn" style="padding:.15rem .4rem;" onchange="qtSetTotalsField('discountType', this.value)">
                            <option value="amount"${q.discountType === 'amount'  ? ' selected' : ''}>₱</option>
                            <option value="percent"${q.discountType === 'percent' ? ' selected' : ''}>%</option>
                        </select>
                        <input class="qt-btn qt-amt" style="width:90px;padding:.15rem .4rem;font-weight:400;"
                               value="${qtEscHtml(q.discount)}" oninput="qtSetTotalsField('discount', this.value)">
                    </td>
                    <td class="qt-amt">(${qtFmt(disc)})</td>
                </tr>
                <tr style="border-top:1px solid #e5e7eb;"><td><strong>Sub-total</strong></td><td class="qt-amt"><strong>₱${qtFmt(sub)}</strong></td></tr>
                <tr>
                    <td>Plus: VAT
                        <select class="qt-btn" style="padding:.15rem .4rem;" onchange="qtSetTotalsField('vatMode', this.value)">
                            <option value="none"${q.vatMode === 'none' ? ' selected' : ''}>Not applicable</option>
                            <option value="exclusive"${q.vatMode === 'exclusive' ? ' selected' : ''}>Exclusive (add)</option>
                            <option value="inclusive"${q.vatMode === 'inclusive' ? ' selected' : ''}>Inclusive (built in)</option>
                        </select>
                        <input class="qt-btn qt-amt" style="width:60px;padding:.15rem .4rem;font-weight:400;"
                               value="${qtEscHtml(q.vatPct)}" oninput="qtSetTotalsField('vatPct', this.value)">%
                    </td>
                    <td class="qt-amt">${q.vatMode === 'none' ? '—' : (q.vatMode === 'inclusive' ? '(incl. ' + qtFmt(vat) + ')' : qtFmt(vat))}</td>
                </tr>
                <tr style="border-top:2px solid #111827;">
                    <td><strong>TOTAL</strong></td>
                    <td class="qt-amt"><strong>₱${qtFmt(total)}</strong></td>
                </tr>
            </table>
            <p class="qt-sub" style="margin:.5rem 0 0;">
                ${q.vatMode === 'none' ? 'Prints as “VAT not applicable”.'
                 : q.vatMode === 'exclusive' ? 'VAT is added on top of the discounted sub-total.'
                 : 'VAT is already inside the total and is shown broken out.'}
            </p>
        </div>`;
    }

    window.qtSetTotalsField = function (key, value) {
        qtState.current[key] = value;
        qtMarkDirty(); qtRenderTotals();
    };
```

- [ ] **Step 4: Call both renderers from the editor**

At the end of `qtRenderEditor()`, before `lucide.createIcons()`, add:
```js
        qtRenderSections();
        qtRenderTotals();
```

- [ ] **Step 5: Verify against the reference document's numbers**

Run: `node --check js/quotation-module.js && npm test` → clean and green.

In the browser, open a quotation and rebuild the reference estimate:
1. Add a section **REPAIR SERVICE**, set it to **Lump sum**, LOT amount `200126`
2. Add groups **KIOSK** `92707` and **ELECTRICAL WORKS** `107419`
3. Expected: the section total reads **₱200,126.00** — *not* ₱400,252.00. The note about the breakdown not adding is visible
4. Add a second section **MOBILIZATION**, lump, no section amount, one group `12948` → section total ₱12,948.00
5. Project Cost = **₱213,074.00**
6. Set discount to `9531` (₱) → Sub-total **₱203,543.00** — matching the reference document exactly
7. Set VAT to **Exclusive** at 12% → VAT **₱24,425.16**, TOTAL **₱227,968.16**
8. Set VAT back to **Not applicable** → TOTAL returns to ₱203,543.00 and the VAT row shows an em dash with the "VAT not applicable" note
9. Add a rated section, add a line `3 × 9602`, set its state to **removed** → the row goes struck-through and the total drops by ₱28,806
10. Save, go Back, reopen → everything round-trips

- [ ] **Step 6: Hand off for commit**

```bash
git add js/quotation-module.js css/quotation-module.css
git commit -m "feat(quotations): section tree editor, lump/rated pricing, line states, totals panel"
```

---

## Task 7: Section reference images

**Files:**
- Modify: `js/quotation-module.js`

**Interfaces:**
- Consumes: `qtSections()`, `qtMarkDirty`, `qtToast`.
- Produces: `qtRenderImages(sIdx)`, `window.qtUploadImages(sIdx, fileList)`, `window.qtRemoveImage(sIdx, idx)`, `window.qtSetImageCaption(sIdx, idx, text)`.

Images go to the `uploads` bucket and the **public-format URL** is stored. Since migration `0027` that bucket is private, and `supabase-config.js` §11b transparently swaps stored URLs for short-lived signed URLs at point of use — so `<img src="…">` just works. **Not base64:** the BOQ inlines line photos in jsonb, which would bloat every row *and* every revision snapshot here.

- [ ] **Step 1: Add the uploader**

```js
    const QT_MAX_IMG_MB = 5;

    window.qtUploadImages = async function (sIdx, fileList) {
        const sec = qtSections()[sIdx];
        if (!sec) return;
        sec.images = sec.images || [];
        const files = Array.from(fileList || []);
        for (const f of files) {
            if (!/^image\//.test(f.type)) { qtToast(`${f.name} is not an image`, 'error'); continue; }
            if (f.size > QT_MAX_IMG_MB * 1024 * 1024) {
                qtToast(`${f.name} is over ${QT_MAX_IMG_MB}MB`, 'error'); continue;
            }
            try {
                const path = `quotations/${qtUid()}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, '_')}`;
                const ref  = storage.ref().child(path);
                await ref.put(f);
                const url  = await ref.getDownloadURL();
                sec.images.push({ url, name: f.name, caption: '' });
                qtMarkDirty();
            } catch (e) {
                // Per-file failure must never block saving the quotation.
                console.error('[QT] image upload failed:', e);
                qtToast(`Upload failed for ${f.name}: ${e.message || e}`, 'error');
            }
        }
        qtRenderImages(sIdx);
    };

    window.qtRemoveImage = function (sIdx, idx) {
        if (!confirm('Remove this image from the quotation?')) return;
        // Removes the reference only — the stored file is left in the bucket
        // so an earlier revision that still points at it keeps rendering.
        qtSections()[sIdx].images.splice(idx, 1);
        qtMarkDirty(); qtRenderImages(sIdx);
    };

    window.qtSetImageCaption = function (sIdx, idx, text) {
        qtSections()[sIdx].images[idx].caption = text;
        qtMarkDirty();
    };
```

- [ ] **Step 2: Add the renderer**

```js
    function qtRenderImages(sIdx) {
        const host = qtEl('qtImages-' + sIdx);
        const sec  = qtSections()[sIdx];
        if (!host || !sec) return;
        const imgs = sec.images || [];
        host.innerHTML = `
        <div style="margin-top:.6rem;">
            <label class="qt-btn" style="display:inline-block;cursor:pointer;">
                + Reference image
                <input type="file" accept="image/*" multiple hidden
                       onchange="qtUploadImages(${sIdx}, this.files); this.value='';">
            </label>
            <span class="qt-sub" style="margin-left:.5rem;">Renders and photos printed with this section (max ${QT_MAX_IMG_MB}MB each)</span>
            ${imgs.length ? `<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.5rem;">
                ${imgs.map((im, i) => `
                <div style="width:150px;">
                    <img src="${qtEscHtml(im.url)}" alt="${qtEscHtml(im.name)}"
                         style="width:150px;height:105px;object-fit:cover;border:1px solid #e5e7eb;border-radius:8px;">
                    <input class="qt-btn" style="width:100%;font-weight:400;font-size:.75rem;margin-top:.2rem;"
                           placeholder="Caption" value="${qtEscHtml(im.caption)}"
                           oninput="qtSetImageCaption(${sIdx}, ${i}, this.value)">
                    <button class="qt-btn qt-btn-danger" style="width:100%;margin-top:.2rem;font-size:.75rem;"
                            onclick="qtRemoveImage(${sIdx}, ${i})">Remove</button>
                </div>`).join('')}
            </div>` : ''}
        </div>`;
    }

    Object.assign(window, { qtRenderImages });
```

- [ ] **Step 3: Verify**

Run: `node --check js/quotation-module.js && npm test` → clean and green.

In the browser: open a quotation, upload two images to a section. Expected: both thumbnails render (proving the private-bucket signing works), captions save, **Save** → **Back** → **Open** round-trips them, and a non-image file is rejected with a toast without breaking the upload of the others.

- [ ] **Step 4: Hand off for commit**

```bash
git add js/quotation-module.js
git commit -m "feat(quotations): section reference images via the uploads bucket"
```

---

## Task 8: Terms panel and saved defaults

**Files:**
- Modify: `js/quotation-module.js`

**Interfaces:**
- Consumes: `qtState.current.terms`, `qtMarkDirty`.
- Produces: `qtRenderTerms()`, `qtLoadDefaultTerms()`, and globals `qtSetTerm(key, value)`, `qtAddCondition()`, `qtSetCondition(i, field, value)`, `qtDeleteCondition(i)`, `qtMoveCondition(i, dir)`, `qtSaveTermsAsDefault()`.

- [ ] **Step 1: Add the defaults loader**

```js
    // Standard clauses are typed once and reused, following the
    // settings/invoiceDefaults precedent in labor-invoice-module.js.
    async function qtLoadDefaultTerms() {
        try {
            const doc = await db.collection('settings').doc('quotationDefaults').get();
            if (doc.exists && doc.data() && doc.data().terms) return doc.data().terms;
        } catch (e) { console.warn('[QT] no saved default terms:', e.message); }
        return null;
    }

    window.qtSaveTermsAsDefault = async function () {
        qtCollectHeader();
        try {
            await db.collection('settings').doc('quotationDefaults')
                .set({ userId: qtUid(), terms: qtState.current.terms }, { merge: true });
            qtToast('Saved as your default terms');
        } catch (e) {
            qtToast('Could not save defaults: ' + (e.message || e), 'error');
        }
    };
```

In `qtNewQuote`, apply them:
```js
    window.qtNewQuote = async function () {
        qtState.current   = qtBlankQuote();
        const saved = await qtLoadDefaultTerms();
        if (saved) qtState.current.terms = saved;
        qtState.revisions = [];
        qtState.isDirty   = false;
        switchView('quoteEditor');
        qtRenderEditor();
    };
```

- [ ] **Step 2: Add the terms editors**

```js
    function qtTerms() {
        const q = qtState.current;
        if (!q.terms) q.terms = qtDefaultTerms();
        if (!Array.isArray(q.terms.conditions)) q.terms.conditions = [];
        if (!q.terms.signOff) q.terms.signOff = { preparedBy: true, clientApproval: true };
        return q.terms;
    }

    window.qtSetTerm = function (key, value) { qtTerms()[key] = value; qtMarkDirty(); };
    window.qtSetSignOff = function (key, on)  { qtTerms().signOff[key] = on; qtMarkDirty(); };

    window.qtAddCondition = function () {
        qtTerms().conditions.push({ title: '', body: '', include: true });
        qtMarkDirty(); qtRenderTerms();
    };
    window.qtSetCondition = function (i, field, value) {
        qtTerms().conditions[i][field] = value; qtMarkDirty();
    };
    window.qtDeleteCondition = function (i) {
        if (!confirm('Delete this condition?')) return;
        qtTerms().conditions.splice(i, 1); qtMarkDirty(); qtRenderTerms();
    };
    window.qtMoveCondition = function (i, dir) {
        const arr = qtTerms().conditions, j = i + dir;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        qtMarkDirty(); qtRenderTerms();
    };
```

- [ ] **Step 3: Add the renderer**

```js
    function qtTermArea(label, key, hint) {
        return `<label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;margin:.6rem 0 .15rem;">${label}
                ${hint ? `<span style="font-weight:400;">— ${hint}</span>` : ''}</label>
                <textarea class="qt-btn" style="font-weight:400;width:100%;min-height:56px;"
                          oninput="qtSetTerm('${key}', this.value)">${qtEscHtml(qtTerms()[key])}</textarea>`;
    }

    function qtRenderTerms() {
        const pane = qtEl('qtTermsPane');
        if (!pane || !qtState.current) return;
        const t = qtTerms();
        pane.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <h3 style="font-size:.95rem;margin:0;">Terms &amp; conditions</h3>
                <button class="qt-btn" onclick="qtSaveTermsAsDefault()">Save as my defaults</button>
            </div>
            ${qtTermArea('Validity',          'validityNote',     'e.g. valid for thirty (30) calendar days from issuance')}
            ${qtTermArea('Payment terms',     'payment',          'downpayment, progress billing, turnover')}
            ${qtTermArea('Delivery timeline', 'deliveryTimeline', 'e.g. 14 to 21 days upon approval / payment, whichever comes last')}
            ${qtTermArea('Warranty',          'warranty',         'what is covered, for how long, and what is excluded')}
            ${qtTermArea('Exclusions',        'exclusions',       'one per line')}

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;">
                <h4 style="font-size:.85rem;margin:0;">Numbered conditions</h4>
                <button class="qt-btn" onclick="qtAddCondition()">+ Condition</button>
            </div>
            ${t.conditions.map((c, i) => `
            <div style="border:1px solid #f3f4f6;border-radius:8px;padding:.6rem;margin-top:.5rem;">
                <div style="display:flex;gap:.4rem;align-items:center;">
                    <span class="qt-sub" style="width:1.5rem;">${i + 1}.</span>
                    <input class="qt-btn" style="flex:1;font-weight:600;" placeholder="Title"
                           value="${qtEscHtml(c.title)}" oninput="qtSetCondition(${i},'title',this.value)">
                    <label class="qt-sub" style="display:flex;gap:.25rem;align-items:center;">
                        <input type="checkbox" ${c.include !== false ? 'checked' : ''}
                               onchange="qtSetCondition(${i},'include',this.checked)"> print
                    </label>
                    <button class="qt-btn" onclick="qtMoveCondition(${i},-1)">↑</button>
                    <button class="qt-btn" onclick="qtMoveCondition(${i},1)">↓</button>
                    <button class="qt-btn qt-btn-danger" onclick="qtDeleteCondition(${i})">×</button>
                </div>
                <textarea class="qt-btn" style="font-weight:400;width:100%;min-height:52px;margin-top:.4rem;"
                          placeholder="Body" oninput="qtSetCondition(${i},'body',this.value)">${qtEscHtml(c.body)}</textarea>
            </div>`).join('')}

            <div style="margin-top:1rem;display:flex;gap:1rem;flex-wrap:wrap;">
                <label class="qt-sub"><input type="checkbox" ${t.signOff.preparedBy !== false ? 'checked' : ''}
                       onchange="qtSetSignOff('preparedBy', this.checked)"> Print “Submitted by” block</label>
                <label class="qt-sub"><input type="checkbox" ${t.signOff.clientApproval !== false ? 'checked' : ''}
                       onchange="qtSetSignOff('clientApproval', this.checked)"> Print “Client approval / date” block</label>
            </div>
        </div>`;
    }
```

Add `qtRenderTerms();` to the end of `qtRenderEditor()`.

- [ ] **Step 4: Verify**

Run: `node --check js/quotation-module.js && npm test` → clean and green.

In the browser: fill in all five term areas, add three numbered conditions, reorder them, untick *print* on one. Save → Back → Open: everything round-trips and the order is preserved. Click **Save as my defaults**, then **+ New Quotation** — the new quote opens pre-filled with those terms.

- [ ] **Step 5: Hand off for commit**

```bash
git add js/quotation-module.js
git commit -m "feat(quotations): terms panel with numbered conditions and saved defaults"
```

---

## Task 9: Outcome panel — status, follow-ups, history

**Files:**
- Modify: `js/quotation-module.js`

**Interfaces:**
- Consumes: `qtState.current`, `qtSave`, `qtStatusOf`.
- Produces: `qtRenderOutcome()`, `window.qtSetStatus(status)`, `window.qtSetOutcomeField(key, value)`, `qtPushHistory(entry)`.

- [ ] **Step 1: Add the history helper and the status transition**

```js
    function qtPushHistory(status, from, note) {
        const q = qtState.current;
        if (!Array.isArray(q.history)) q.history = [];
        q.history.push({
            at: new Date().toISOString(),
            by: (window.auth.currentUser && window.auth.currentUser.email) || '',
            status, from: from || null, note: note || ''
        });
    }

    window.qtSetStatus = async function (status) {
        const q = qtState.current;
        if (!q || q.status === status) return;

        // WON creates NOTHING. No folder, no construction project, no invoice,
        // no contract value — converting a won quote into a project is a
        // manual admin action (migration 0045 isolation contract).
        let note = '';
        if (status === 'lost') {
            note = prompt('Reason for loss (optional):') || '';
        }
        const from = q.status;
        q.status     = status;
        q.statusNote = note || q.statusNote || '';
        q.decidedAt  = (status === 'won' || status === 'lost') ? new Date().toISOString() : null;
        qtPushHistory(status, from, note);
        qtMarkDirty();
        await window.qtSave();
        qtRenderEditor();
    };

    window.qtSetOutcomeField = function (key, value) {
        qtState.current[key] = value;
        qtMarkDirty();
    };
```

- [ ] **Step 2: Add the renderer**

```js
    function qtRenderOutcome() {
        const pane = qtEl('qtOutcomePane');
        const q = qtState.current;
        if (!pane || !q) return;
        const st = qtStatusOf(q);
        const overdue = qtIsOverdue(q);

        pane.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
            <h3 style="font-size:.95rem;margin:0 0 .6rem;">Outcome</h3>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
                <span class="qt-pill qt-pill-${st}">${st}</span>
                ${q.status === 'draft' ? '<button class="qt-btn qt-btn-primary" onclick="qtSendQuote()">Send →</button>' : ''}
                ${q.status === 'sent'  ? `<button class="qt-btn qt-btn-primary" onclick="qtSetStatus('won')">Mark Won</button>
                                          <button class="qt-btn qt-btn-danger"  onclick="qtSetStatus('lost')">Mark Lost</button>` : ''}
                ${(q.status === 'won' || q.status === 'lost') ? `<button class="qt-btn" onclick="qtSetStatus('sent')">Reopen</button>` : ''}
            </div>
            ${st === 'expired' ? `<p class="qt-sub" style="color:#b45309;margin:.5rem 0 0;">
                This quotation lapsed on ${qtEscHtml(q.validUntil)}. Extend the validity date and save — that creates a new revision.</p>` : ''}
            ${q.statusNote ? `<p class="qt-sub" style="margin:.5rem 0 0;">Note: ${qtEscHtml(q.statusNote)}</p>` : ''}

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.75rem;margin-top:.9rem;">
                <div>
                    <label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;">Follow-up date</label>
                    <input class="qt-btn" style="font-weight:400;width:100%;" type="date"
                           value="${qtEscHtml(q.followUpDate || '')}"
                           onchange="qtSetOutcomeField('followUpDate', this.value)">
                    ${overdue ? '<p class="qt-sub" style="color:#b45309;">Overdue — pinned to the top of the list</p>' : ''}
                </div>
                <div>
                    <label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;">Follow-up note</label>
                    <input class="qt-btn" style="font-weight:400;width:100%;"
                           value="${qtEscHtml(q.followUpNote || '')}"
                           oninput="qtSetOutcomeField('followUpNote', this.value)">
                </div>
            </div>
            <p class="qt-sub" style="margin:.5rem 0 0;">Reminders are an in-app flag only — nothing is emailed to the client.</p>

            ${(q.history || []).length ? `
            <details style="margin-top:.9rem;">
                <summary class="qt-sub" style="cursor:pointer;">Status history (${q.history.length})</summary>
                <ul style="margin:.4rem 0 0 1rem;font-size:.8rem;color:#4b5563;">
                    ${q.history.slice().reverse().map(h =>
                        `<li>${qtEscHtml(String(h.at).slice(0, 16).replace('T', ' '))} — ${qtEscHtml(h.from || '·')} → <strong>${qtEscHtml(h.status)}</strong>${h.note ? ' · ' + qtEscHtml(h.note) : ''}${h.by ? ' · ' + qtEscHtml(h.by) : ''}</li>`).join('')}
                </ul>
            </details>` : ''}
        </div>`;
    }

    // Replaced with the real snapshotting version in Task 10.
    window.qtSendQuote = function () { window.qtSetStatus('sent'); };
```

Add `qtRenderOutcome();` to the end of `qtRenderEditor()`.

- [ ] **Step 3: Verify**

Run: `node --check js/quotation-module.js && npm test` → clean and green.

In the browser:
1. Open a draft → **Send →** → the pill flips to `sent` and *Mark Won / Mark Lost* appear
2. **Mark Lost** → the reason prompt appears; entering one shows it under the pill
3. Back to the list → Lost = 1, and the **win rate** updates
4. **Reopen** → back to `sent`, and `decidedAt` clears
5. Set a follow-up date in the past → save → the list shows the row highlighted with a **follow up** badge, pinned to the top, and the header reads "1 follow-up overdue"
6. Expand **Status history** → every transition is listed with who and when

- [ ] **Step 4: Hand off for commit**

```bash
git add js/quotation-module.js
git commit -m "feat(quotations): outcome panel with win/loss, follow-ups and status history"
```

---

## Task 10: Revisions — snapshot on send, history, diff

**Files:**
- Modify: `js/quotation-module.js`

**Interfaces:**
- Consumes: `qtDiffSnapshots`, `qtFlattenLines`, `qtSave`, `qtState`.
- Produces: `qtLoadRevisions(quotationId)`, `qtRenderRevisions()`, `window.qtSendQuote()` (real), `window.qtViewRevision(revId)`, `window.qtShowDiff(revId)`, `qtSnapshotOf(q) → object`.

- [ ] **Step 1: Replace the revisions stub with the real loader**

Replace the `function qtLoadRevisions() {}` stub from Task 5 with:

```js
    function qtLoadRevisions(quotationId) {
        if (qtState.revUnsub) { qtState.revUnsub(); qtState.revUnsub = null; }
        if (!quotationId) { qtState.revisions = []; qtRenderRevisions(); return; }
        qtState.revUnsub = db.collection('quotationRevisions')
            .where('quotationId', '==', quotationId)
            .onSnapshot(snap => {
                qtState.revisions = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => (b.revNo || 0) - (a.revNo || 0));
                qtRenderRevisions();
            }, err => console.error('[QT] revisions load error:', err));
    }

    // The frozen copy. Everything the print sheet needs to reproduce the
    // document exactly as it was sent — so a revision prints from itself,
    // never from the live record.
    function qtSnapshotOf(q) {
        return {
            quoteNo: q.quoteNo, revNo: q.revNo,
            quoteDate: q.quoteDate, validUntil: q.validUntil,
            clientName: q.clientName, clientEmail: q.clientEmail,
            clientAddress: q.clientAddress, clientTin: q.clientTin,
            projectName: q.projectName, location: q.location,
            subject: q.subject, scopeNote: q.scopeNote,
            sections: JSON.parse(JSON.stringify(q.sections || [])),
            discount: q.discount, discountType: q.discountType,
            vatMode: q.vatMode, vatPct: q.vatPct,
            totalAmount: q.totalAmount,
            terms: JSON.parse(JSON.stringify(q.terms || {})),
            preparedBy: q.preparedBy
        };
    }
```

- [ ] **Step 2: Replace the send stub with the snapshotting version**

```js
    window.qtSendQuote = async function () {
        const q = qtState.current;
        if (!q) return;

        // Save first so the snapshot matches what is stored, and so a brand
        // new quotation has an id to hang the revision off.
        await window.qtSave();
        if (!q.id) { qtToast('Save the quotation before sending', 'error'); return; }

        const note = prompt('What changed in this revision? (optional)') || '';

        try {
            // The snapshot is written BEFORE the status flips. If this insert
            // fails, the quotation stays where it was and the user is told —
            // never a "sent" quote with no frozen copy behind it.
            await db.collection('quotationRevisions').add({
                quotationId: q.id, userId: qtUid(),
                revNo: q.revNo || 1,
                snapshot: qtSnapshotOf(q),
                totalAmount: qtParseNum(q.totalAmount),
                sentAt: firebase.firestore.FieldValue.serverTimestamp(),
                note,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.error('[QT] snapshot failed:', e);
            qtToast('Could not freeze this revision — status unchanged: ' + (e.message || e), 'error');
            return;
        }

        const from = q.status;
        q.status = 'sent';
        qtPushHistory('sent', from, note ? 'Rev ' + q.revNo + ': ' + note : 'Rev ' + q.revNo);
        await window.qtSave();
        qtToast(`Sent — Rev ${q.revNo} frozen`);
        qtRenderEditor();
    };
```

- [ ] **Step 3: Bump the revision when a sent quote is edited**

In `window.qtSave`, immediately **after** the `const q = qtState.current;` line (not after `qtCollectHeader()` — `q` must already be in scope), insert:

```js
        // Editing a quotation that has already been sent creates a new
        // revision. The bump happens on save; the next Send freezes it.
        if (q.status === 'sent' && qtState.isDirty && qtState.revisions.length
            && qtState.revisions[0].revNo === q.revNo) {
            if (confirm(`This quotation was already sent as Rev ${q.revNo}.\n\nSaving creates Rev ${q.revNo + 1}. Continue?`)) {
                q.revNo = (q.revNo || 1) + 1;
            } else {
                return;
            }
        }
```

(Declare `const q = qtState.current;` above this block if it is not already in scope at that point.)

- [ ] **Step 4: Add the revisions panel with the diff**

```js
    function qtRenderRevisions() {
        const pane = qtEl('qtRevisionsPane');
        if (!pane) return;
        const revs = qtState.revisions || [];
        if (!revs.length) {
            pane.innerHTML = `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
                <h3 style="font-size:.95rem;margin:0 0 .3rem;">Revision history</h3>
                <p class="qt-sub">No revisions yet. Sending this quotation freezes Rev 1.</p></div>`;
            return;
        }
        pane.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
            <h3 style="font-size:.95rem;margin:0 0 .6rem;">Revision history</h3>
            <table class="qt-table">
                <thead><tr><th>Rev</th><th>Sent</th><th class="qt-amt">Total</th><th>Note</th><th></th></tr></thead>
                <tbody>${revs.map((r, i) => `
                <tr>
                    <td><strong>Rev ${r.revNo}</strong></td>
                    <td>${qtEscHtml(qtTsDate(r.sentAt))}</td>
                    <td class="qt-amt">₱${qtFmt(r.totalAmount)}</td>
                    <td>${qtEscHtml(r.note || '')}</td>
                    <td>
                        <button class="qt-btn" onclick="qtViewRevision('${r.id}')">View</button>
                        ${i < revs.length - 1 ? `<button class="qt-btn" onclick="qtShowDiff('${r.id}')">Diff</button>` : ''}
                    </td>
                </tr>`).join('')}</tbody>
            </table>
            <div id="qtDiffPane"></div>
        </div>`;
    }

    function qtTsDate(ts) {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    window.qtShowDiff = function (revId) {
        const revs = qtState.revisions;
        const i = revs.findIndex(r => r.id === revId);
        if (i < 0 || i >= revs.length - 1) return;
        const curr = revs[i].snapshot, prev = revs[i + 1].snapshot;
        // Snapshots carry their own totalAmount at the row level.
        curr.totalAmount = revs[i].totalAmount;
        prev.totalAmount = revs[i + 1].totalAmount;
        const d = qtDiffSnapshots(prev, curr);

        const row = (l, tag, delta) => `<li>${tag} <strong>${qtEscHtml(l.description || l.id)}</strong>
            <span class="qt-sub">${qtEscHtml(l.path)}</span> — ₱${qtFmt(delta)}</li>`;

        qtEl('qtDiffPane').innerHTML = `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:.8rem;margin-top:.8rem;">
            <h4 style="font-size:.85rem;margin:0 0 .4rem;">Rev ${revs[i + 1].revNo} → Rev ${revs[i].revNo}</h4>
            <ul style="margin:0 0 .5rem 1rem;font-size:.82rem;">
                ${d.added.map(l => row(l, '<span style="color:#047857;">added</span>', l.amount)).join('')}
                ${d.removed.map(l => row(l, '<span style="color:#b91c1c;">deleted</span>', -l.amount)).join('')}
                ${d.changed.map(c => `<li><span style="color:#b45309;">changed</span>
                    <strong>${qtEscHtml(c.to.description || c.id)}</strong>
                    <span class="qt-sub">${qtEscHtml(c.to.path)}</span> —
                    ${qtEscHtml(c.from.qty)} × ₱${qtFmt(c.from.unitPrice)} (${qtEscHtml(c.from.state)})
                    → ${qtEscHtml(c.to.qty)} × ₱${qtFmt(c.to.unitPrice)} (${qtEscHtml(c.to.state)})
                    — <strong>₱${qtFmt(c.delta)}</strong></li>`).join('')}
                ${(!d.added.length && !d.removed.length && !d.changed.length)
                    ? '<li class="qt-sub">No line-level changes — only header, terms or totals fields differ.</li>' : ''}
            </ul>
            <p style="margin:0;font-weight:700;">Net change: ₱${qtFmt(d.delta)}</p>
        </div>`;
    };

    window.qtViewRevision = function (revId) {
        const r = (qtState.revisions || []).find(x => x.id === revId);
        if (!r) return;
        const root = qtEl('quoteRevisionView');
        if (!root) return;
        root.innerHTML = `
        <div class="qt-header">
            <div>
                <h2 class="qt-title">${qtEscHtml(r.snapshot.quoteNo)} — Rev ${r.revNo}</h2>
                <p class="qt-sub">Frozen ${qtEscHtml(qtTsDate(r.sentAt))} · read-only</p>
            </div>
            <div style="display:flex;gap:.5rem;">
                <button class="qt-btn" onclick="switchView('quoteEditor')">← Back to current</button>
                <button class="qt-btn qt-btn-primary" onclick="qtPrintSheet(qtRevisionSnapshot('${r.id}'))">Print this revision</button>
            </div>
        </div>
        <pre style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;overflow:auto;font-size:.75rem;">${qtEscHtml(JSON.stringify(r.snapshot, null, 2))}</pre>`;
        switchView('quoteRevision');
    };

    // Lets the print module (Task 12) render a frozen revision from itself
    // rather than from the live record.
    window.qtRevisionSnapshot = function (revId) {
        const r = (qtState.revisions || []).find(x => x.id === revId);
        return r ? r.snapshot : null;
    };
```

Add `qtRenderRevisions();` to the end of `qtRenderEditor()`.

> The `<pre>` dump in `qtViewRevision` is the read-only viewer until Task 12 lands; once `qtPrintSheet` exists, **Print this revision** renders it properly. Leave the dump — it is a useful audit view.

- [ ] **Step 5: Verify**

Run: `node --check js/quotation-module.js && npm test` → clean and green.

In the browser, reproduce the reference document's failure and prove it is now answerable:
1. Open a draft with a rated section containing a line `STANDING CHURROS` `3 × 9602`
2. **Send →** → toast "Sent — Rev 1 frozen"; the revision table shows Rev 1
3. Set that line's state to **removed**; save → the confirm says it creates Rev 2; accept
4. **Send →** again, note "removed standing signage"
5. In the revision table click **Diff** on Rev 2. Expected:
   `changed STANDING CHURROS — 3 × ₱9,602.00 (normal) → 3 × ₱9,602.00 (removed) — ₱-28,806.00`
   and **Net change: ₱-28,806.00**
6. Click **View** on Rev 1 → the frozen snapshot still shows the line as `normal` with its price intact

- [ ] **Step 6: Hand off for commit**

```bash
git add js/quotation-module.js
git commit -m "feat(quotations): immutable revision snapshots with line-level diff"
```

---

## Task 11: Client and scope presets

**Files:**
- Modify: `js/quotation-module.js`

**Interfaces:**
- Consumes: `qtState.presets`, `qtSections()`, `qtMarkDirty`.
- Produces: `qtLoadPresets()`, and globals `qtSavePreset(kind, sIdx)`, `qtInsertPreset(id)`, `qtDeletePreset(id)`, `qtRenderPresetBar()`.

- [ ] **Step 1: Add the loader and mutators**

```js
    function qtLoadPresets() {
        db.collection('quotationPresets')
            .where('userId', '==', qtUid())
            .get()
            .then(snap => {
                qtState.presets = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                                           .filter(p => !p.deletedAt);
                qtRenderPresetBar();
            })
            .catch(e => console.error('[QT] presets load error:', e));
    }

    window.qtSavePreset = async function (kind, sIdx) {
        qtCollectHeader();
        const q = qtState.current;
        let data, suggested;
        if (kind === 'client') {
            data = { clientName: q.clientName, clientEmail: q.clientEmail,
                     clientAddress: q.clientAddress, clientTin: q.clientTin };
            suggested = q.clientName || 'Client';
        } else {
            const sec = qtSections()[sIdx];
            if (!sec) return;
            // Deep copy, then re-id every node — a preset inserted twice must
            // not produce duplicate ids, or the revision diff pairs the wrong
            // lines together.
            const copy = JSON.parse(JSON.stringify(sec));
            copy.id = qtNewId();
            (copy.groups || []).forEach(g => {
                g.id = qtNewId();
                (g.lines || []).forEach(l => { l.id = qtNewId(); });
            });
            data = { sections: [copy] };
            suggested = sec.label || 'Scope block';
        }
        const name = prompt('Save preset as:', suggested);
        if (!name) return;
        try {
            await db.collection('quotationPresets').add({
                userId: qtUid(), kind, name, data,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            qtToast('Preset saved');
            qtLoadPresets();
        } catch (e) {
            qtToast('Could not save preset: ' + (e.message || e), 'error');
        }
    };

    window.qtInsertPreset = function (id) {
        const p = (qtState.presets || []).find(x => x.id === id);
        if (!p || !qtState.current) return;
        if (p.kind === 'client') {
            Object.assign(qtState.current, p.data);
            qtRenderEditor();
        } else {
            const copy = JSON.parse(JSON.stringify(p.data.sections || []));
            copy.forEach(sec => {
                sec.id = qtNewId();
                (sec.groups || []).forEach(g => {
                    g.id = qtNewId();
                    (g.lines || []).forEach(l => { l.id = qtNewId(); });
                });
                qtSections().push(sec);
            });
            qtRenderSections(); qtRenderTotals();
        }
        qtMarkDirty();
        qtToast(`Inserted “${p.name}”`);
    };

    window.qtDeletePreset = async function (id) {
        if (!confirm('Delete this preset?')) return;
        try {
            await db.collection('quotationPresets').doc(id)
                .update({ deletedAt: new Date().toISOString() });
            qtLoadPresets();
        } catch (e) { qtToast('Could not delete preset: ' + (e.message || e), 'error'); }
    };
```

- [ ] **Step 2: Add the preset bar**

```js
    function qtRenderPresetBar() {
        const host = qtEl('qtPresetBar');
        if (!host) return;
        const clients = (qtState.presets || []).filter(p => p.kind === 'client');
        const scopes  = (qtState.presets || []).filter(p => p.kind === 'scope');
        host.innerHTML = `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-top:.75rem;">
            <select class="qt-btn" onchange="if(this.value){qtInsertPreset(this.value);this.value='';}">
                <option value="">Insert client preset…</option>
                ${clients.map(p => `<option value="${p.id}">${qtEscHtml(p.name)}</option>`).join('')}
            </select>
            <button class="qt-btn" onclick="qtSavePreset('client')">Save client as preset</button>
            <select class="qt-btn" onchange="if(this.value){qtInsertPreset(this.value);this.value='';}">
                <option value="">Insert scope preset…</option>
                ${scopes.map(p => `<option value="${p.id}">${qtEscHtml(p.name)}</option>`).join('')}
            </select>
            ${(clients.length + scopes.length)
                ? `<select class="qt-btn qt-btn-danger" onchange="if(this.value){qtDeletePreset(this.value);this.value='';}">
                     <option value="">Delete a preset…</option>
                     ${[...clients, ...scopes].map(p => `<option value="${p.id}">${qtEscHtml(p.kind)}: ${qtEscHtml(p.name)}</option>`).join('')}
                   </select>` : ''}
        </div>`;
    }
```

Add `<div id="qtPresetBar"></div>` to `qtRenderEditor()`'s HTML, directly under the three header cards, and call `qtRenderPresetBar();` at the end of `qtRenderEditor()`. Call `qtLoadPresets();` from `initQuotationModule` after `qtLoadList();`.

- [ ] **Step 3: Add "save this section as a scope preset"**

In `qtRenderSections()`, in each section's button row (next to Delete), add:
```js
                <button class="qt-btn" onclick="qtSavePreset('scope',${si})">Save as preset</button>
```

- [ ] **Step 4: Verify**

Run: `node --check js/quotation-module.js && npm test` → clean and green.

In the browser:
1. Fill in a client, click **Save client as preset**, name it
2. **+ New Quotation** → **Insert client preset…** → the fields populate
3. On a section with three lines, click **Save as preset**
4. Insert that scope preset into a different quotation **twice**. Expected: six lines, and — critically — **all six have distinct ids**. Verify in the console:
   ```js
   const ids = qtFlattenLines(qtState.current.sections).map(l => l.id);
   console.log(ids.length, new Set(ids).size);   // must be equal
   ```
   If they differ, the re-id logic in Step 1 is wrong and the revision diff will pair the wrong lines.
5. Delete a preset → it disappears from all three dropdowns

- [ ] **Step 5: Clean up the seeded test rows**

Delete the rows created in Task 4 Step 5 and any scratch quotations, from the console:
```js
const snap = await db.collection('quotations').where('userId','==',auth.currentUser.uid).get();
for (const d of snap.docs) {
  if (['Q-2026-0001','Q-2026-0002'].includes(d.data().quoteNo)) await db.collection('quotations').doc(d.id).delete();
}
```

- [ ] **Step 6: Hand off for commit**

```bash
git add js/quotation-module.js
git commit -m "feat(quotations): reusable client and scope presets"
```

---

## Task 12: The A4 print sheet

**Files:**
- Modify: `js/quotation-print.js` (replacing the empty stub from Task 3)

**Interfaces:**
- Consumes: the calc engine globals, `qtState.current`, `window.qtRevisionSnapshot(revId)`.
- Produces: `window.qtPrintSheet(snapshotOrNull)` — with no argument it prints the live quotation; given a snapshot it prints that frozen revision instead.

- [ ] **Step 1: Write the print module**

Replace the contents of `js/quotation-print.js`:

```js
/* ════════════════════════════════════════════════════════════════════
   QUOTATION PRINT — A4 sheet and PDF export.

   Renders EITHER the live quotation (no argument) or a frozen revision
   snapshot (passed in), so a revision always prints exactly as it was
   sent rather than picking up later edits.
   ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // Seller block. Confirm the contact line and TIN with the owner before
    // the first real quotation goes out — these print on every sheet.
    const COMPANY = {
        name:    "DAC'S CONSTRUCTION",
        logo:    'assets/images/DACS-TRANSPARENT.png',
        contact: '',   // e.g. 'hello@example.com / 09XXXXXXXXX'
        tin:     ''    // e.g. '000-000-000-000'
    };

    function qtDoc() {
        // The live quotation, shaped like a snapshot.
        const q = (window.qtState && window.qtState.current) || window._qtCurrentForPrint;
        return q || null;
    }

    function qtCompanyLine() {
        return [COMPANY.contact, COMPANY.tin ? 'TIN: ' + COMPANY.tin : '']
            .filter(Boolean).join(' · ');
    }

    function qtPrettyDate(key) {
        if (!key) return '';
        const d = new Date(key + 'T00:00:00');
        return isNaN(d) ? key : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // ── Table rows ────────────────────────────────────────────────────
    function qtRowsHtml(d) {
        const esc = window.qtEscHtml, fmt = window.qtFmt;
        let html = '';
        (d.sections || []).forEach((sec, si) => {
            const lump = sec.pricing === 'lump';
            html += `<tr class="p-l1">
                <td class="c-no">${si + 1}</td>
                <td class="c-desc" colspan="4"><strong>${esc(sec.label || 'SECTION')}</strong></td>
                <td class="c-amt"><strong>${fmt(window.qtSectionTotal(sec))}</strong></td>
            </tr>`;

            (sec.images || []).forEach(im => {
                html += `<tr class="p-img"><td></td><td colspan="5">
                    <img src="${esc(im.url)}" alt="${esc(im.name || '')}">
                    ${im.caption ? `<div class="p-cap">${esc(im.caption)}</div>` : ''}
                </td></tr>`;
            });

            (sec.groups || []).forEach(g => {
                html += `<tr class="p-l2">
                    <td></td>
                    <td class="c-desc" colspan="4">${esc(g.label || '')}</td>
                    <td class="c-amt">${lump && g.lumpAmount !== '' && g.lumpAmount !== undefined && g.lumpAmount !== null
                        ? fmt(g.lumpAmount) : (lump ? '' : fmt(window.qtGroupTotal(g)))}</td>
                </tr>`;

                (g.lines || []).forEach(l => {
                    const state = l.state || 'normal';
                    const cls = state === 'removed'  ? ' p-removed'
                              : state === 'waived'   ? ' p-waived'
                              : state === 'optional' ? ' p-optional' : '';
                    const amtCell = lump ? ''
                        : state === 'waived'  ? 'WAIVED'
                        : state === 'removed' ? fmt(window.qtParseNum(l.qty) * window.qtParseNum(l.unitPrice))
                        : fmt(window.qtLineAmount(l));
                    html += `<tr class="p-l3${cls}">
                        <td></td>
                        <td class="c-desc">${esc(l.description || '')}${state === 'optional' ? ' <em>(optional)</em>' : ''}</td>
                        <td class="c-qty">${esc(l.qty || '')}</td>
                        <td class="c-unit">${esc(l.unit || '')}</td>
                        <td class="c-rate">${lump ? '' : fmt(l.unitPrice)}</td>
                        <td class="c-amt">${amtCell}</td>
                    </tr>`;
                });
            });
        });
        return html;
    }

    // ── Terms ─────────────────────────────────────────────────────────
    function qtTermsHtml(d) {
        const esc = window.qtEscHtml, t = d.terms || {};
        const block = (title, body) => body
            ? `<div class="p-term"><div class="p-term-hd">${esc(title)}</div>
               ${String(body).split('\n').map(l => `<div>${esc(l)}</div>`).join('')}</div>` : '';
        const conds = (t.conditions || []).filter(c => c.include !== false);
        return `
        ${block('VALIDITY',         t.validityNote)}
        ${block('PAYMENT TERMS',    t.payment)}
        ${block('DELIVERY TIMELINE',t.deliveryTimeline)}
        ${block('WARRANTY',         t.warranty)}
        ${block('EXCLUSIONS',       t.exclusions)}
        ${conds.length ? `<div class="p-term"><div class="p-term-hd">GENERAL TERMS &amp; CONDITIONS</div>
            <ol>${conds.map(c => `<li><strong>${esc(c.title)}</strong> ${esc(c.body)}</li>`).join('')}</ol>
        </div>` : ''}`;
    }

    // ── Totals ────────────────────────────────────────────────────────
    function qtTotalsHtml(d) {
        const fmt = window.qtFmt;
        const pc = window.qtProjectCost(d.sections), disc = window.qtDiscountAmount(d),
              sub = window.qtSubTotal(d), vat = window.qtVatAmount(d), tot = window.qtGrandTotal(d);
        const vatRow = d.vatMode === 'none'
            ? `<tr><td>PLUS: VAT</td><td class="c-amt">Not applicable</td></tr>`
            : d.vatMode === 'inclusive'
            ? `<tr><td>VAT (${window.qtParseNum(d.vatPct)}%, included)</td><td class="c-amt">${fmt(vat)}</td></tr>`
            : `<tr><td>PLUS: VAT (${window.qtParseNum(d.vatPct)}%)</td><td class="c-amt">${fmt(vat)}</td></tr>`;
        return `
        <table class="p-tot">
            <tr><td>PROJECT COST</td><td class="c-amt">${fmt(pc)}</td></tr>
            ${disc ? `<tr><td>LESS: DISCOUNT</td><td class="c-amt">(${fmt(disc)})</td></tr>` : ''}
            <tr class="p-sub"><td>SUB TOTAL</td><td class="c-amt">${fmt(sub)}</td></tr>
            ${vatRow}
            <tr class="p-grand"><td>TOTAL PROJECT COST</td><td class="c-amt">${fmt(tot)}</td></tr>
        </table>
        <p class="p-vatnote">${d.vatMode === 'exclusive' ? '*VAT is added to the sub-total above.'
            : d.vatMode === 'inclusive' ? '*Total is VAT inclusive.' : '*VAT not applicable.'}</p>`;
    }

    // ── Entry point ───────────────────────────────────────────────────
    window.qtPrintSheet = function (snapshot) {
        const d = snapshot || qtDoc();
        if (!d) { if (window.qtToast) window.qtToast('Nothing to print', 'error'); return; }

        // An expired price should not go out by accident.
        if (!snapshot && window.qtIsExpired && window.qtIsExpired(d)) {
            if (!confirm(`This quotation lapsed on ${d.validUntil}.\n\nPrint it anyway?`)) return;
        }

        const esc = window.qtEscHtml;
        const base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${esc(d.subject || 'Project Estimate')} — ${esc(d.projectName || '')}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:9pt;color:#111;background:#e8e8e8;}
  .page{width:210mm;min-height:297mm;background:#fff;margin:12px auto;padding:12mm 14mm;box-shadow:0 2px 16px rgba(0,0,0,.18);}
  .p-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:8px;}
  .p-logo{height:52px;}
  .p-co{font-size:12pt;font-weight:700;}
  .p-title{font-size:14pt;font-weight:700;text-align:right;}
  .p-meta{width:100%;border-collapse:collapse;margin-top:10px;font-size:8.5pt;}
  .p-meta td{border:1px solid #d0d0d0;padding:4px 6px;}
  .p-meta .k{background:#f2f2f2;font-weight:700;width:22%;}
  .p-scope{margin-top:10px;font-size:8.5pt;white-space:pre-wrap;}
  table.p-items{width:100%;border-collapse:collapse;margin-top:12px;font-size:8pt;}
  table.p-items th{background:#f2f2f2;border:1px solid #c8c8c8;padding:4px;text-align:center;font-size:7.5pt;}
  table.p-items td{border:1px solid #e0e0e0;padding:3px 5px;vertical-align:top;}
  .c-no{width:26px;text-align:center;} .c-qty{width:38px;text-align:center;}
  .c-unit{width:44px;text-align:center;} .c-rate{width:72px;text-align:right;}
  .c-amt{width:88px;text-align:right;font-variant-numeric:tabular-nums;}
  tr.p-l1 td{background:#fafafa;}
  tr.p-l2 td{padding-left:14px;font-weight:600;}
  tr.p-l3 td.c-desc{padding-left:26px;}
  tr.p-removed td{text-decoration:line-through;color:#999;}
  tr.p-waived  td.c-amt{font-weight:700;}
  tr.p-optional td{color:#666;}
  tr.p-img img{max-width:150mm;max-height:70mm;object-fit:contain;margin:4px 0;}
  .p-cap{font-size:7.5pt;color:#555;}
  table.p-tot{margin-left:auto;margin-top:12px;border-collapse:collapse;width:78mm;font-size:8.5pt;}
  table.p-tot td{border:1px solid #d0d0d0;padding:4px 6px;}
  .p-sub td{font-weight:700;} .p-grand td{font-weight:700;background:#eaf7ef;font-size:9.5pt;}
  .p-vatnote{text-align:right;font-size:7.5pt;color:#555;margin-top:3px;}
  .p-term{margin-top:10px;font-size:8pt;} .p-term-hd{font-weight:700;background:#f2f2f2;padding:3px 5px;}
  .p-term ol{margin:4px 0 0 18px;} .p-term li{margin-bottom:3px;}
  .p-sign{display:flex;gap:30mm;margin-top:18mm;font-size:8.5pt;}
  .p-sign div{flex:1;border-top:1px solid #111;padding-top:3px;}
  .p-rev{position:fixed;top:6mm;right:10mm;font-size:7.5pt;color:#666;}
  @media print{body{background:#fff;} .page{margin:0;box-shadow:none;} @page{size:A4;margin:0;}}
</style></head><body>
<div class="page">
  <div class="p-rev">${esc(d.quoteNo || '')}${d.revNo > 1 ? ' · Rev ' + d.revNo : ''}</div>
  <div class="p-head">
    <div>
      <img class="p-logo" src="${base}${COMPANY.logo}" alt="">
      <div class="p-co">${esc(COMPANY.name)}</div>
      <div style="font-size:8pt;color:#555;">${esc(qtCompanyLine())}</div>
    </div>
    <div class="p-title">${esc((d.subject || 'PROJECT ESTIMATE').toUpperCase())}</div>
  </div>

  <table class="p-meta">
    <tr><td class="k">CLIENT</td><td>${esc(d.clientName || '')}</td><td class="k">QUOTE NO.</td><td>${esc(d.quoteNo || '')}${d.revNo > 1 ? ' (Rev ' + d.revNo + ')' : ''}</td></tr>
    <tr><td class="k">PROJECT</td><td>${esc(d.projectName || '')}</td><td class="k">DATE</td><td>${esc(qtPrettyDate(d.quoteDate))}</td></tr>
    <tr><td class="k">LOCATION</td><td>${esc(d.location || '')}</td><td class="k">VALID UNTIL</td><td>${esc(qtPrettyDate(d.validUntil))}</td></tr>
    ${d.clientAddress || d.clientTin ? `<tr><td class="k">ADDRESS</td><td>${esc(d.clientAddress || '')}</td><td class="k">TIN</td><td>${esc(d.clientTin || '')}</td></tr>` : ''}
  </table>

  ${d.scopeNote ? `<div class="p-scope"><strong>SCOPE OF WORK</strong><br>${esc(d.scopeNote)}</div>` : ''}

  <table class="p-items">
    <thead><tr><th>#</th><th>DESCRIPTION</th><th>QTY</th><th>UNIT</th><th>UNIT PRICE</th><th>AMOUNT</th></tr></thead>
    <tbody>${qtRowsHtml(d)}</tbody>
  </table>

  ${qtTotalsHtml(d)}
  ${qtTermsHtml(d)}

  <div class="p-sign">
    ${(d.terms && d.terms.signOff && d.terms.signOff.preparedBy !== false)
      ? `<div>${esc(d.preparedBy || '')}<br><span style="font-size:7.5pt;color:#666;">SUBMITTED BY</span></div>` : ''}
    ${(d.terms && d.terms.signOff && d.terms.signOff.clientApproval !== false)
      ? `<div><span style="font-size:7.5pt;color:#666;">CLIENT APPROVAL / DATE</span></div>` : ''}
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
</body></html>`;

        const w = window.open('', '_blank');
        if (!w) { if (window.qtToast) window.qtToast('Pop-up blocked — allow pop-ups to print', 'error'); return; }
        w.document.write(html);
        w.document.close();
    };

})();
```

- [ ] **Step 2: Expose `qtState` for the print module**

`quotation-print.js` reads `window.qtState`. At the bottom of the IIFE in `js/quotation-module.js`, add:
```js
    window.qtState = qtState;   // read-only use by quotation-print.js
```

- [ ] **Step 3: Add the Print button**

In `qtRenderEditor()`'s button row, next to Save:
```html
                <button class="qt-btn" onclick="qtPrintSheet()">Print</button>
```

And in `qtListRow()`, next to Open:
```html
            <button class="qt-btn" onclick="qtOpenQuote('${q.id}'); setTimeout(qtPrintSheet, 200);">Print</button>
```

- [ ] **Step 4: Verify against the reference document**

Run: `node --check js/quotation-print.js && node --check js/quotation-module.js && npm test` → clean and green.

In the browser, rebuild the reference estimate and click **Print**. Check the sheet against the original PDF:
1. **REPAIR SERVICE** shows `200,126.00` on the section row, with KIOSK `92,707.00` and ELECTRICAL WORKS `107,419.00` as sub-rows — the sub-rows are a breakdown, and the totals block still reads Project Cost `213,074.00`
2. A **removed** line prints struck through, and its own amount still shows — visibly retired, not silently vanished
3. A **waived** line prints `WAIVED` in the amount column
4. An **optional** line prints `(optional)` and is greyed
5. With VAT **Not applicable**, the VAT row reads `Not applicable` and the footnote reads `*VAT not applicable.` — the reference document's dash-plus-contradictory-footnote is impossible here
6. With VAT **Exclusive**, the row shows `24,425.16` and the total reads `227,968.16`
7. Section images print under their section heading with captions
8. The numbered conditions print in order; an unticked one does **not** print
9. Sign-off blocks respect their toggles
10. `Q-2026-000X · Rev 2` prints in the top-right
11. Open a **frozen revision** → **Print this revision** → the sheet shows that revision's numbers, not the live ones

- [ ] **Step 5: Hand off for commit**

```bash
git add js/quotation-print.js js/quotation-module.js
git commit -m "feat(quotations): A4 print sheet with line states, VAT modes and images"
```

---

## Task 13: PDF export

**Files:**
- Modify: `js/quotation-print.js`

**Interfaces:**
- Consumes: everything from Task 12.
- Produces: `window.qtExportPDF(snapshotOrNull)`.

- [ ] **Step 1: Add the lazy loader and the generator**

Append inside the IIFE in `js/quotation-print.js`, before the closing `})();`:

```js
    // ── PDF export ────────────────────────────────────────────────────
    // jsPDF and autotable load from CDN on first use only, exactly as
    // boqExportPDF() does — they are ~300KB and most sessions never export.
    window.qtExportPDF = function (snapshot) {
        if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
            if (window.qtToast) window.qtToast('Loading PDF library…');
            const s1 = document.createElement('script');
            s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            s1.onload = function () {
                const s2 = document.createElement('script');
                s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
                s2.onload = function () { qtGeneratePDF(snapshot); };
                s2.onerror = function () { if (window.qtToast) window.qtToast('Could not load the PDF library', 'error'); };
                document.head.appendChild(s2);
            };
            s1.onerror = function () { if (window.qtToast) window.qtToast('Could not load the PDF library', 'error'); };
            document.head.appendChild(s1);
            return;
        }
        qtGeneratePDF(snapshot);
    };

    function qtGeneratePDF(snapshot) {
        const d = snapshot || qtDoc();
        if (!d) { if (window.qtToast) window.qtToast('Nothing to export', 'error'); return; }
        if (!snapshot && window.qtIsExpired && window.qtIsExpired(d)
            && !confirm(`This quotation lapsed on ${d.validUntil}.\n\nExport it anyway?`)) return;

        const fmt = window.qtFmt;
        const jsPDF = (window.jspdf || window).jsPDF;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const M = 12;
        let y = M;

        doc.setFontSize(13).setFont(undefined, 'bold');
        doc.text(COMPANY.name, M, y + 4);
        doc.setFontSize(12);
        doc.text((d.subject || 'PROJECT ESTIMATE').toUpperCase(), 210 - M, y + 4, { align: 'right' });
        y += 10;

        doc.setFontSize(8.5).setFont(undefined, 'normal');
        [['CLIENT', d.clientName], ['PROJECT', d.projectName], ['LOCATION', d.location],
         ['QUOTE NO.', (d.quoteNo || '') + (d.revNo > 1 ? ' (Rev ' + d.revNo + ')' : '')],
         ['DATE', qtPrettyDate(d.quoteDate)], ['VALID UNTIL', qtPrettyDate(d.validUntil)]
        ].forEach(([k, v]) => {
            if (!v) return;
            doc.setFont(undefined, 'bold').text(k, M, y);
            doc.setFont(undefined, 'normal').text(String(v), M + 28, y);
            y += 4.4;
        });
        y += 2;

        // Flatten the tree into autotable rows, preserving the visual levels.
        const body = [];
        (d.sections || []).forEach((sec, si) => {
            body.push([{ content: `${si + 1}. ${sec.label || 'SECTION'}`, colSpan: 5, styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } },
                       { content: fmt(window.qtSectionTotal(sec)), styles: { fontStyle: 'bold', halign: 'right' } }]);
            const lump = sec.pricing === 'lump';
            (sec.groups || []).forEach(g => {
                body.push(['', { content: g.label || '', colSpan: 4, styles: { fontStyle: 'bold' } },
                           { content: lump && g.lumpAmount ? fmt(g.lumpAmount) : (lump ? '' : fmt(window.qtGroupTotal(g))), styles: { halign: 'right' } }]);
                (g.lines || []).forEach(l => {
                    const st = l.state || 'normal';
                    const amt = lump ? ''
                        : st === 'waived'  ? 'WAIVED'
                        : st === 'removed' ? fmt(window.qtParseNum(l.qty) * window.qtParseNum(l.unitPrice))
                        : fmt(window.qtLineAmount(l));
                    const label = (l.description || '')
                        + (st === 'optional' ? ' (optional)' : '')
                        + (st === 'removed'  ? '  [REMOVED]'  : '');
                    body.push(['', '   ' + label, l.qty || '', l.unit || '',
                               lump ? '' : fmt(l.unitPrice),
                               { content: amt, styles: { halign: 'right' } }]);
                });
            });
        });

        doc.autoTable({
            startY: y, margin: { left: M, right: M },
            head: [['#', 'DESCRIPTION', 'QTY', 'UNIT', 'UNIT PRICE', 'AMOUNT']],
            body,
            styles: { fontSize: 7.5, cellPadding: 1.4 },
            headStyles: { fillColor: [240, 240, 240], textColor: 20, fontSize: 7 },
            columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 12, halign: 'center' },
                            3: { cellWidth: 14, halign: 'center' }, 4: { cellWidth: 22, halign: 'right' },
                            5: { cellWidth: 26, halign: 'right' } }
        });

        y = doc.lastAutoTable.finalY + 6;
        const pc = window.qtProjectCost(d.sections), disc = window.qtDiscountAmount(d),
              sub = window.qtSubTotal(d), vat = window.qtVatAmount(d), tot = window.qtGrandTotal(d);
        const totRows = [['PROJECT COST', fmt(pc)]];
        if (disc) totRows.push(['LESS: DISCOUNT', '(' + fmt(disc) + ')']);
        totRows.push(['SUB TOTAL', fmt(sub)]);
        totRows.push(['PLUS: VAT', d.vatMode === 'none' ? 'Not applicable'
                      : d.vatMode === 'inclusive' ? '(incl. ' + fmt(vat) + ')' : fmt(vat)]);
        totRows.push(['TOTAL PROJECT COST', fmt(tot)]);

        doc.autoTable({
            startY: y, margin: { left: 210 - M - 78 },
            body: totRows, theme: 'grid',
            styles: { fontSize: 8.5, cellPadding: 1.6 },
            columnStyles: { 0: { cellWidth: 48 }, 1: { cellWidth: 30, halign: 'right' } },
            didParseCell: function (data) {
                if (data.row.index === totRows.length - 1) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [234, 247, 239];
                }
            }
        });

        const name = `${(d.quoteNo || 'quotation')}${d.revNo > 1 ? '-rev' + d.revNo : ''}.pdf`;
        doc.save(name.replace(/[^\w.\-]/g, '_'));
    }
```

- [ ] **Step 2: Add the Export button**

In `qtRenderEditor()`'s button row, next to Print:
```html
                <button class="qt-btn" onclick="qtExportPDF()">PDF</button>
```

And in `qtViewRevision()`, next to *Print this revision*:
```html
                <button class="qt-btn" onclick="qtExportPDF(qtRevisionSnapshot('${r.id}'))">PDF</button>
```

- [ ] **Step 3: Verify**

Run: `node --check js/quotation-print.js && npm test` → clean and green.

In the browser:
1. Click **PDF** on a quotation with both a lump and a rated section. Expected: the library loads once (toast "Loading PDF library…"), then a file downloads named `Q-2026-0003.pdf`
2. Open the PDF. Expected: the header block, the itemized table with section/group/line indentation preserved, `[REMOVED]` on a removed line with its price still shown, `WAIVED` on a waived line, `(optional)` on an optional line, and the totals table with the correct VAT treatment
3. Click **PDF** a second time → no reload of the library, immediate download
4. Export a frozen revision → the filename carries `-rev2` and the contents match that revision

- [ ] **Step 4: Final full verification**

Run:
```bash
node --check js/quotation-module.js && node --check js/quotation-print.js && node --check js/admin.js && npm test
```
Expected: no output from the checks; all three test files green, including the **unchanged** money-math and reimbursement suites.

Then confirm the isolation contract holds — in the console, as owner:
```js
// Marking a quote Won must create nothing.
const before = (await db.collection('folders').where('userId','==',auth.currentUser.uid).get()).docs.length;
// … mark a quotation Won in the UI …
const after  = (await db.collection('folders').where('userId','==',auth.currentUser.uid).get()).docs.length;
console.log(before === after ? 'ISOLATION OK' : 'ISOLATION BROKEN');
```
Expected: `ISOLATION OK`.

Finally, log in as **staff** and confirm: no Quotations tab, `switchView('quoteList')` bounces to the dashboard, and `await db.collection('quotations').get()` returns zero rows.

- [ ] **Step 5: Hand off for commit**

```bash
git add js/quotation-print.js js/quotation-module.js
git commit -m "feat(quotations): jsPDF export for quotations and frozen revisions"
```

---

## Coverage against the spec

| Spec section | Task |
|---|---|
| §1 What this is · not a BOQ derivative | 2 (own calc engine, one client-facing rate), 5–6 |
| §2 Isolation contract · owner-only in four places | 1 (RLS), 3 (nav, switchView, init check), 13 (verified) |
| §3 Feature set | 4–13 |
| §4 Files | all |
| §5 Nav wiring | 3 |
| §6 Data model · REG · RLS · realtime | 1 |
| §7 Tree · rated/lump · line states · images · totals · terms | 2, 6, 7, 8 |
| §8 Lifecycle · expiry · revisions · diff · follow-ups | 2, 9, 10 |
| §9 List · editor · print | 4, 5, 6, 12 |
| §10 Error handling | 5 (save), 7 (per-file upload), 10 (snapshot-before-status), 4 (load) |
| §11 Verification | every task's verify step; full pass in 13 |
| §12 Deferred | not built, by design |
