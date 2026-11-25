# Petty Cash for Labor and Overhead — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Labor (payroll) and Overhead entries be marked "Paid from: Petty cash", so the database records a petty cash spend in the same step, voids it on edit/delete, and the buyer's balance, cash counts and daily report include it.

**Architecture:** A new column `petty_cash_by` on `payroll` and `overhead_expenses` says whose petty cash paid. Triggers (migration 0122) check who may set it and keep exactly one live row per entry in a new append-only table `pur_cash_spends`; `pur_cash_raw`, `pur_cash_detail` and `pur_cash_report` read it. The browser only adds a "Paid from" choice to four forms (through one small shared helper) and shows the result.

**Tech Stack:** Plain HTML + vanilla JS (no build step), Supabase Postgres (plpgsql triggers), PGlite for SQL tests, Node test scripts.

**Spec:** `docs/superpowers/specs/2026-11-25-petty-cash-labor-overhead-design.md` (approved 25 Nov 2026).

## Global Constraints

- **Never run `npm run build`.** Edit `js/portal-app.compiled.js` directly.
- Migration number is **0122**; never edit an earlier migration.
- Petty cash **never** changes Spent, Labor, Overhead, Cover, Earned or Profit. `_projSpent`, `_projEarned`, `_projMargin`, `_recognisedProfit` must not mention `pettyCashBy` / `petty_cash_by`.
- A `pur_cash_spends` row is **never deleted or changed in place**; the only change is setting `voided_at` + `void_reason` once.
- Who may choose petty cash: a **staff buyer** (themselves only) or the **main owner** (`pur_is_main_owner()`, anyone's). Overhead forms offer it to the **main owner only**.
- Payroll `payment_date` is `YYYY-MM-DDTHH:MM` (or `YYYY-MM-DD`, or blank); the petty cash day is its **first 10 characters**. Never use `toISOString().slice(0,10)` for a local day.
- Refusal codes (raised with `errcode = 'P0001'`): `NOT_A_BUYER`, `PERSON_NOT_ALLOWED`, `PETTY_CASH_DATE`, `BAD_AMOUNT`.
- Spend labels: kind `payroll` shows as **"Paid labor"**, kind `overhead` as **"Paid overhead"**.
- Void reasons, exactly: `Payroll entry changed`, `Payroll entry deleted`, `Overhead entry changed`, `Overhead entry deleted`.
- Staff hiding: the "Petty cash" tag carries no pesos; nothing new is shown in Project Control's amount-hidden areas.
- Bump the `?v=` cache-buster in `admin.html` for every JS file a task changes (format `YYYYMMDDx`, e.g. `20261125a`).
- The user commits manually: **do not commit or push**. Each task's last step is "stage nothing; report the changed files".

## Review Focus

1. **The edit form re-sends the same day in another shape** (`2026-11-20` → `2026-11-20T00:00`) and the same amount: no void, no new spend. → Task 1 test `same day in another shape changes nothing`.
2. **Someone who can't choose petty cash edits a petty-cash row** (notes, worker name): the browser must not send `pettyCashBy`, and the spend stays. → Task 1 test `an edit that leaves petty_cash_by alone keeps the spend`; Task 3 test `edit sends pettyCashBy only when the choice was shown`.
3. **A billing period or folder is deleted** (cascade delete of payroll rows): the spends are voided, not left live or erroring. → Task 1 test `cascade delete of a billing period voids its spends`.
4. **A split payroll entry** (two rows, one `split_group`): two spends server-side, one line on the daily report and the buyer card. → Task 1 test `split rows: one spend each`; Task 6 test `split rows show as one line`.
5. **Overhead soft delete and restore** (`deleted_at` set, then cleared): void, then a new live spend. → Task 1 test `overhead soft delete voids, restore re-records`.

---

### Task 1: Migration 0122 and its database tests

**Files:**
- Create: `supabase/migrations/0122_petty_cash_labor_overhead.sql`
- Create: `supabase/tests/pc_petty_cash_spends.pglite.mjs`
- Modify: `package.json` (append `&& node supabase/tests/pc_petty_cash_spends.pglite.mjs` to `test:sql`)
- Modify: `supabase/migrations/README.md` (0122 entry: built, not applied)
- Modify: `docs/DATABASE_SCHEMA.md` (two columns, one table)
- Modify: `CLAUDE.md` (petty cash bullet under *Money invariants*: "Payroll and overhead remain unchanged" → labor and overhead may be paid from a staff buyer's petty cash (0122): a `pur_cash_spends` row per entry, kept by triggers, voided never deleted; the entry still counts once in Labor / Overhead and Spent; only the main owner picks another person's petty cash)

**Interfaces:**
- Produces (DB):
  - `payroll.petty_cash_by uuid null references profiles(id)`, `overhead_expenses.petty_cash_by uuid null references profiles(id)` (shim field `pettyCashBy`).
  - Table `pur_cash_spends(id uuid pk default gen_random_uuid(), owner_id uuid not null, buyer_id uuid not null, amount numeric(14,2) not null check (amount > 0), spent_on date not null, kind text not null check (kind in ('payroll','overhead')), payroll_id uuid, overhead_id uuid, split_group text, label text not null default '', place text not null default '', created_by uuid, created_at timestamptz not null default now(), voided_at timestamptz, void_reason text)`; check exactly one of `payroll_id` / `overhead_id` is set; partial unique indexes on `payroll_id` and on `overhead_id` `where voided_at is null`; index on `(owner_id, buyer_id, spent_on)`. RLS enabled, no policies, `revoke all ... from public, anon, authenticated`.
  - `pur_spend_day(p text) returns date` — `pur_past_day(left(btrim(p), 10))`, any failure re-raised as `PETTY_CASH_DATE`.
  - `pur_cash_raw(p_owner, p_buyer, p_upto)` — 0102's body **plus** `- sum(amount) from pur_cash_spends where owner_id = p_owner and buyer_id = p_buyer and pur_stood(voided_at, p_upto) and (p_upto is null or spent_on <= p_upto)`.
  - `pur_cash_detail` (0103's version) **plus** `'spends'`: last 90 days by `spent_on`, each `{id, kind, amount, spent_on, label, place, split_group, voided_at, void_reason}` newest first.
  - `pur_cash_report` (0102's version, copied verbatim) **plus** per day `'spends'`: `[{id, kind, amount, label, place, split_group, voided_on}]` for `spent_on = v_day`; the `continue when` emptiness test includes it; `reversals` gains spends voided that day with `what` = `'Paid labor'` / `'Paid overhead'`, `entry_day` = `spent_on`, `effect` = `+amount`, `reason` = `void_reason`.
  - Error codes as in Global Constraints.

- [ ] **Step 1: Write the failing suite `supabase/tests/pc_petty_cash_spends.pglite.mjs`**

Setup: copy `2a4_payments.pglite.mjs`'s `BASE`, `fresh()` (with 0102 + 0103), ids (`OWNER`, `STAFF`, `BUYER`, `BUYER2`, `EXPOWNER`, `OTHER`) and helpers (`as`, `one`, `all`, `code`, `phDate`, `folder`, `period`, `raw`). In `BASE`, extend `payroll` with `worker_name text, role text, payment_date text, split_group text, split_index int, split_total int`, and add `create table overhead_expenses (id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id), scope text, expense_name text, category text, description text, amount numeric, date text, status text, deleted_at timestamptz)`. Then apply 0122. Helpers: `addPay(db, {amount, day, by, split})` inserts a payroll row on a billing period and returns its id; `addOh(db, {amount, day, by, folderId})`; `spends(db, buyer)` returns all rows ordered by `created_at`.

Tests (name → assertions):
- `staff buyer pays labor from own petty cash` → as `BUYER`: `addPay({amount: 1500, day: phDate()+'T08:30', by: BUYER})`; one live spend `{kind:'payroll', amount:1500, spent_on: phDate(), label:'Mario · Mason', place:<folder name>}`; `raw(BUYER)` drops by 1500.
- `main owner records a buyer's petty cash` → as `OWNER`, `by: BUYER2` → spend `buyer_id = BUYER2`.
- `staff cannot record another buyer's petty cash` → as `BUYER`, `by: BUYER2` → `code(...) === 'PERSON_NOT_ALLOWED'`, no payroll row, no spend.
- `a non-main owner cannot either` → as `EXPOWNER`, `by: BUYER` → `PERSON_NOT_ALLOWED`.
- `only a staff account of this company holds petty cash` → as `OWNER`, `by: OWNER` → `NOT_A_BUYER`; `by` = another company's staff → `NOT_A_BUYER`.
- `petty cash needs a past day` → blank / `'2026-13-01'` / tomorrow → `PETTY_CASH_DATE`; amount `0` → `BAD_AMOUNT`.
- `company-paid rows are untouched` → `by: null` → no spend; `raw` unchanged.
- `same day in another shape changes nothing` → insert with `'2026-11-20'`-style day, update `payment_date` to the same day `+ 'T00:00'` and `total_salary` to the same value → still one spend, none voided.
- `an edit that leaves petty_cash_by alone keeps the spend` → update `worker_name`, `notes`-like columns only → same live spend id.
- `amount change voids and re-records` → update `total_salary` 1500 → 1800 as `STAFF` (a non-buyer may fix the amount) → old spend `void_reason = 'Payroll entry changed'`, new live spend 1800, same buyer.
- `switching to company voids` → update `petty_cash_by = null` → spend voided `'Payroll entry changed'`, none live.
- `delete voids, never deletes` → `delete from payroll` → spend still present, `void_reason = 'Payroll entry deleted'`.
- `cascade delete of a billing period voids its spends` → `delete from projects where id = <period>` → spends voided `'Payroll entry deleted'`.
- `split rows: one spend each` → two rows sharing `split_group` → two live spends with that `split_group`.
- `overhead: main owner, project and company scope` → as `OWNER`: project overhead `place = <folder name>`, company overhead (`scope 'company'`, no folder) `place = 'Company overhead'`, `label` = `expense_name`.
- `overhead soft delete voids, restore re-records` → set `deleted_at` → voided `'Overhead entry deleted'`; clear it → a new live spend.
- `one live spend per entry` → direct `insert into pur_cash_spends` of a second live row for the same `payroll_id` (as admin) fails on the unique index.
- `voids count from the day they are made` → spend dated `phDate(-3)`, voided today: `raw(BUYER, phDate(-1))` still includes it, `raw(BUYER)` does not.
- `the daily report and the buyer card carry spends` → as `OWNER`: `pur_cash_report(BUYER, phDate(-3), phDate())` has the spend under its day's `spends` and the void under today's `reversals` with `what = 'Paid labor'`, `effect = amount`; `pur_cash_buyer(BUYER)` has it in `spends`.
- `nobody reads the table directly` → as `BUYER` **and** `set role authenticated` (the 2a4 `as()` does not switch role; reset after): `select * from pur_cash_spends` → permission error.

- [ ] **Step 2: Run it to verify it fails**

Run: `node supabase/tests/pc_petty_cash_spends.pglite.mjs`
Expected: FAIL — `ENOENT` for `0122_petty_cash_labor_overhead.sql`.

- [ ] **Step 3: Write `supabase/migrations/0122_petty_cash_labor_overhead.sql`**

Contents, in order: the two columns (`add column if not exists`); the table, indexes, RLS and revokes; `pur_spend_day`; then two trigger functions per table, all `security definer set search_path = public`, `revoke execute ... from public, anon, authenticated`:

- `pur_spend_check()` — `BEFORE INSERT OR UPDATE` on both tables. Reads the amount column (`total_salary` / `amount`), the day column (`payment_date` / `date`) and, for overhead, `deleted_at` through `TG_TABLE_NAME`. Skip entirely when `NEW.petty_cash_by is null`, or (overhead) `NEW.deleted_at is not null`. When the person is new (`INSERT`, or `NEW.petty_cash_by is distinct from OLD.petty_cash_by`): `pur_holder_ok(NEW.owner_id, NEW.petty_cash_by)` else `NOT_A_BUYER`; `auth.uid() = NEW.petty_cash_by or pur_is_main_owner()` else `PERSON_NOT_ALLOWED`. When the person is new **or** the day or rounded amount changed: `pur_spend_day(day)`; amount `> 0` else `BAD_AMOUNT`.
- `pur_spend_sync()` — `AFTER INSERT OR UPDATE OR DELETE` on both tables. Compute the old and new *key* = `(petty_cash_by, day, round(amount, 2))`, null when not petty cash or (overhead) soft-deleted; the day comes from `left(btrim(..), 10)` so `T00:00` does not count as a change. If the keys are equal, do nothing. Otherwise void the entry's live spend (`voided_at = now()`, reason: `… deleted` on `DELETE` or when overhead `deleted_at` became set, else `… changed`), then insert a new spend when the new key is not null: `owner_id`, `buyer_id`, `amount`, `spent_on`, `kind`, the id column, `split_group` (payroll only), `label` (payroll: `worker_name` + `' · ' || role` when role is not blank; overhead: first non-blank of `expense_name`, `description`, `category`), `place` (payroll: `folders.name` via `projects.folder_id`; overhead: `'Company overhead'` when `folder_id` is null, else `folders.name`), `created_by = auth.uid()`.
- Triggers: `payroll_petty_check`, `payroll_petty_sync`, `overhead_petty_check`, `overhead_petty_sync`.

Then `create or replace` `pur_cash_raw`, `pur_cash_detail`, `pur_cash_report` as in Interfaces, keeping each function's existing `revoke`/`grant` lines.

- [ ] **Step 4: Run it to verify it passes**

Run: `node supabase/tests/pc_petty_cash_spends.pglite.mjs`
Expected: every test `ok`, `0 failed`.

- [ ] **Step 5: Re-run the petty cash suites it redefines functions for**

Run: `node supabase/tests/2a4_payments.pglite.mjs --with-0103` (unchanged; it does not load 0122) and `npm run test:sql`
Expected: all pass.

- [ ] **Step 6: Docs** — 0122 rows in `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md`; the `CLAUDE.md` bullet as listed in Files. Stage nothing; report the changed files.

---

### Task 2: Shared browser helper `js/petty-cash-pick.js`

**Files:**
- Create: `js/petty-cash-pick.js`
- Create: `tests/petty-cash-labor-overhead.test.js` (and add `&& node tests/petty-cash-labor-overhead.test.js` to `npm test` in `package.json`)
- Modify: `admin.html` (`<script src="js/petty-cash-pick.js?v=20261125a"></script>` before `expenses-module.js`)

**Interfaces:**
- Produces `window.DacsPettyCash`:
  - `choices({ role, mainOwner, canBuy, buyers, overhead }) → [{ value, label }]` — always `{company, 'Company (paid directly)'}` first; staff with `canBuy` and `!overhead` add `{mine, 'My petty cash'}`; `mainOwner` with `buyers.length` adds `{petty_cash, 'Petty cash'}`; nothing else.
  - `holderFor(choice, pickedPerson, myUid) → uuid | null` — `mine` → `myUid`; `petty_cash` → `pickedPerson || null`; else `null`.
  - `problem(choice, holder, dayText) → string` — `''` for `company`; `'Choose whose petty cash paid.'` when petty cash without a holder; `'Petty cash needs the payment date.'` when `dayText` has no `YYYY-MM-DD` start.
  - `errorText(err) → string | null` — `NOT_A_BUYER`: `'Only a staff buyer holds petty cash.'`; `PERSON_NOT_ALLOWED`: `'Only the main owner can record another person\'s petty cash.'`; `PETTY_CASH_DATE`: `'Petty cash needs a payment date that is not in the future.'`; `BAD_AMOUNT`: `'Check the amount.'`; otherwise `null`. Matches the code anywhere in `err.message`.
  - `async loadBuyers() → [{ buyer_id, name }]` — only when `window.currentUserRole !== 'staff' && window.currentStockMainOwner`: `rpc('pur_cash_tracker')`, filter `b.can_buy || Number(b.recorded) !== 0`, cache; `[]` on any error or otherwise.
  - `nameOf(uid) → string` — from the cache, else `''`.
  - `tag(uid) → string` — `'Petty cash'` + (`' · ' + name` when known).

- [ ] **Step 1: Write the failing tests** — load the file in a `vm` context with a stub `window`; assert: owner (not main) → only company; main owner with 2 buyers → company + petty_cash; staff buyer → company + mine; staff buyer with `overhead: true` → company only; `holderFor('mine', 'x', 'me') === 'me'`; `holderFor('petty_cash', '', 'me') === null`; the three `problem` strings and `problem('company', null, '') === ''`; `problem('mine','me','2026-11-20T08:00') === ''`; each `errorText` code and `errorText(new Error('boom')) === null`; `loadBuyers` returns `[]` and makes no rpc call for staff and for a non-main owner; `tag` with and without a cached name.
- [ ] **Step 2: Run** `node tests/petty-cash-labor-overhead.test.js` — Expected: FAIL (file missing).
- [ ] **Step 3: Implement `js/petty-cash-pick.js`** (an IIFE assigning `window.DacsPettyCash`; no DOM access).
- [ ] **Step 4: Run** `node tests/petty-cash-labor-overhead.test.js` — Expected: PASS. Stage nothing; report the changed files.

---

### Task 3: Payroll forms — Add and Edit

**Files:**
- Modify: `admin.html` — Add Payroll: after the `payMethod` block, a `payPaidFromRow` (`<select id="payPaidFrom" onchange="payTogglePettyCash('pay')">`) and a hidden `payPaidPersonRow` (`<select id="payPaidPerson">`, label "Whose petty cash"). Edit Payroll: the same with the `editPay` prefix plus a hidden `<p id="editPayPettyNote">` for a read-only line. Bump `expenses-module.js?v=`.
- Modify: `js/expenses-module.js` — setup, toggle, add save (`handleAddPayroll`, the `rows` map near line 3810), edit load (`openEditPayrollModal`, near line 5040), edit save (`handleEditPayroll`, near line 5133), both catch blocks.
- Test: `tests/petty-cash-labor-overhead.test.js` (extend)

**Interfaces:**
- Consumes: `DacsPettyCash.*` (Task 2); DB column `pettyCashBy` and refusal codes (Task 1).
- Produces: `window.payTogglePettyCash(prefix: 'pay' | 'editPay')`; `async function _paySetupPettyCash(prefix, current /* uuid | null */)` — fills `#<prefix>PaidFrom` from `choices({role, mainOwner: window.currentStockMainOwner, canBuy: window.currentCanBuy, buyers: await loadBuyers()})`, fills `#<prefix>PaidPerson`, hides the whole row when only `company` is offered, and sets `dataset.shown = '1'` on the select when visible.

Behaviour:
- Add opens → `_paySetupPettyCash('pay', null)`, choice `company` — called in `openExpModal`'s `id === 'addPayrollModal'` branch (line ~5196, next to `payToggleMode()`).
- Edit opens → `_paySetupPettyCash('editPay', p.pettyCashBy || null)`: preselect `mine` when it is the caller's own id, `petty_cash` + that person when the caller is the main owner; when the row is paid from petty cash this account **cannot** choose (anyone else), hide the select and show `#editPayPettyNote` = `'Paid from ' + DacsPettyCash.tag(id) + ' — only the main owner can change this.'` and leave `dataset.shown` unset.
- Save (add): when the select is shown, `holder = holderFor(...)`; `problem(choice, holder, paymentDate)` blocks with `showExpNotif(msg, 'error')`; every split row gets `...(holder && { pettyCashBy: holder })`.
- Save (edit): include `pettyCashBy: holder` (may be `null`) in the update **only when** `#editPayPaidFrom.dataset.shown === '1'`; same `problem` check.
- Both catches: `showExpNotif('Error: ' + (DacsPettyCash.errorText(err) || err.message), 'error')`.

- [ ] **Step 1: Write the failing tests** (source checks in the repo's style): the HTML has both selects with `onchange="payTogglePettyCash('pay')"` / `('editPay')`; the add `rows` map contains `...(holder && { pettyCashBy: holder })`; `test('edit sends pettyCashBy only when the choice was shown')` — the edit update builds `pettyCashBy` only under `dataset.shown === '1'`; both catch blocks call `DacsPettyCash.errorText`; `_paySetupPettyCash('pay', null)` is called where the Add Payroll modal opens and `_paySetupPettyCash('editPay', p.pettyCashBy || null)` in the edit load.
- [ ] **Step 2: Run** `node tests/petty-cash-labor-overhead.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the markup and the functions above.
- [ ] **Step 4: Run** `node --check js/expenses-module.js && npm test` — Expected: all suites pass (`payroll-fresh-read`, `staff-payroll-period`, `project-control-staff` included). Stage nothing; report the changed files.

---

### Task 4: Overhead forms — Overhead section and Project Control's Overhead tab

**Files:**
- Modify: `admin.html` — the Overhead modal (`ovhdExpStatus` area, near line 5510): `ovhdPaidFromRow` with `<select id="ovhdPaidFrom" onchange="ovhdTogglePettyCash()">` and hidden `ovhdPaidPersonRow` / `<select id="ovhdPaidPerson">`. Bump `overhead-module.js?v=` and add a cache-buster to `portal-app.compiled.js` only if the page already uses one there (it does not today — leave it).
- Modify: `js/overhead-module.js` — open for add/edit (near lines 651, 682), `handleSaveOverheadExpense` payload (near line 795), catch.
- Modify: `js/portal-app.compiled.js` — overhead drill form state (`form`), the modal fields (after the amount field, near line 2490), `saveEntry` (near line 2286).
- Test: `tests/petty-cash-labor-overhead.test.js` (extend)

**Interfaces:**
- Consumes: `DacsPettyCash.*` with `overhead: true` (Task 2).
- Produces: `window.ovhdTogglePettyCash()`; overhead docs carry `pettyCashBy`.

Behaviour (both forms): the row shows only when `choices({..., overhead: true})` offers more than `company` (the main owner with buyers). Picking `petty_cash` shows "Whose petty cash". Saving sends `pettyCashBy: holderFor(...)` only when the row was shown; on edit, a row paid from petty cash opens with that person selected. Overhead section: choosing petty cash sets `#ovhdExpStatus` to `paid`. Project Control drill: a petty-cash add also sends `status: 'paid'`. Refusals use `DacsPettyCash.errorText` (`_ovhdToast` / `alert`).

- [ ] **Step 1: Write the failing tests** — HTML has `ovhdPaidFrom` / `ovhdPaidPerson`; `overhead-module.js` payload includes `pettyCashBy` under the shown guard and sets status `paid` for petty cash; `portal-app.compiled.js` `saveEntry` sends `pettyCashBy` in both the `patch` and the `add` under the same guard and `status: "paid"` for a petty-cash add; neither form calls `choices` without `overhead: true`.
- [ ] **Step 2: Run** `node tests/petty-cash-labor-overhead.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --check js/overhead-module.js && node --check js/portal-app.compiled.js && npm test` — Expected: all pass. Stage nothing; report the changed files.

---

### Task 5: Show it — list tags and payroll vouchers

**Files:**
- Modify: `js/portal-app.compiled.js` — `mapPayrollDoc` (line ~240) adds `pettyCashBy: d.pettyCashBy || null`; Labor `payRows` "For" cell (line ~3130) appends a small pill `DacsPettyCash.tag(p.pettyCashBy)` when set; the overhead drill row's description cell appends the same pill for `x.pettyCashBy`.
- Modify: `js/overhead-module.js` — the list row (near line 511) appends the pill.
- Modify: `js/invoice-module.js` — `printSinglePayrollInvoice` "Detalye" (near line 2278): a `Galing sa / Paid from` row = `DacsPettyCash.tag(p.pettyCashBy)` when set.
- Modify: `js/expenses-module.js` — the payroll receipt (near line 6516): a `Paid from` row, same text.
- Modify: `tests/money-math.test.js` — a new check that the extracted bodies of `buildProject`, `_projSpent`, `_projOverhead`, `_companyOverhead`, `_projEarned`, `_projMargin`, `_recognisedProfit` contain neither `pettyCashBy` nor `petty_cash_by` (`mapPayrollDoc` is excluded: it carries the field). If an existing check compares `mapPayrollDoc`'s whole output, add `pettyCashBy: null` to its expected value; never drop the field to make it pass.
- Test: `tests/petty-cash-labor-overhead.test.js` (extend)

**Interfaces:**
- Consumes: `DacsPettyCash.tag` (Task 2); `pettyCashBy` on payroll and overhead docs.

- [ ] **Step 1: Write the failing tests** — the four render sites call `DacsPettyCash.tag(` guarded by the field being set; `mapPayrollDoc` carries `pettyCashBy`; the pill markup contains no `peso(` / `₱`; the money-math check.
- [ ] **Step 2: Run** `node tests/petty-cash-labor-overhead.test.js && node tests/money-math.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Bump `invoice-module.js?v=` and any other changed file's `?v=`.
- [ ] **Step 4: Run** `npm test` — Expected: all pass. Stage nothing; report the changed files.

---

### Task 6: Petty cash screens — buyer card, My cash, daily report, print, CSV

**Files:**
- Modify: `js/purchasing-admin-core.js` — `reportRows` (line ~639): after `payments`, add `spends` rows: `what` = `'Paid labor'` / `'Paid overhead'`, `detail` = `label + ' · ' + place` + the existing `voided(x)` suffix, `amountOut` = amount; spends sharing a non-null `split_group` on the same day become **one** row with the summed amount. Reversal rows already read `x.what`, so `'Void: Paid labor of <day>'` needs no change.
- Modify: `js/purchasing-admin-cash.js` — `buyerPanel` and `renderMyCash`: a section **"Paid labor and overhead (90 days)"** listing `d.spends` (grouped the same way): `spent_on — peso(amount) — Paid labor|Paid overhead — label · place`, voided ones `class="is-void"` with `— voided: <reason>`. No void button (a spend is voided by editing or deleting its entry).
- Modify: `admin.html` — bump both files' `?v=`.
- Test: `tests/petty-cash-labor-overhead.test.js` (extend); the existing `tests/purchasing-payments-screens.test.js` must stay green.

**Interfaces:**
- Consumes: `pur_cash_report` `days[].spends` and `pur_cash_detail` `spends` (Task 1).
- Produces: `PA.groupSpends(spends) → [{ kind, amount, label, place, spent_on, voided_at, void_reason, ids }]` in `purchasing-admin-core.js` (used by `reportRows` and both lists).

- [ ] **Step 1: Write the failing tests** — `reportRows` on a report with one day holding a 1,500 labor spend and two 400 split-group spends gives rows `Paid labor` 1,500 and `Paid labor` 800 (`test('split rows show as one line')`); a voided spend's detail ends `(voided on <day>)`; `reportCsv` carries `Paid overhead`; the buyer card and My cash render the section and no `data-void-spend` button.
- [ ] **Step 2: Run** `node tests/petty-cash-labor-overhead.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — Expected: all pass. Stage nothing; report the changed files.

---

### Task 7: Go live (only with the owner's yes)

**Files:** none changed.

- [ ] **Step 1: Ask the owner** to approve applying 0122 to the live database (`hqbgduyonlbbsvjuapre`). Stop here without a yes. 0121 is built but not applied; 0122 does not depend on it.
- [ ] **Step 2: Before applying**, read the buyer's balance: `select pur_cash_raw(owner_id, buyer_id) from (select distinct owner_id, buyer_id from pur_cash_issues) x;` (live value on 25 Nov: ₱33,890 held = ₱35,000 − ₱1,110).
- [ ] **Step 3: Apply** 0122 with the Supabase `apply_migration` tool (never the SQL editor).
- [ ] **Step 4: Verify** the two columns, the table, the four triggers and the three functions exist; the balance from Step 2 is unchanged (no spends yet); `select count(*) from pur_cash_spends` = 0.
- [ ] **Step 5: Browser check** in `admin.html` as the main owner: add a ₱1 test payroll paid from the buyer's petty cash → the buyer card shows "Paid labor ₱1"; edit it to ₱2 → a void and a new line; delete it → voided, balance back. Report what was seen; leave the voided test records (they are history).
