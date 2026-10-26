# WorkMate Stage 2B-a — Stock on the server and Dacs Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The company can track goods — in the warehouse and left over at each project's site — in catalogue units: receive warehouse purchases (in parts), issue to a project (filling a request line, "From stock"), return, move between projects, record leftovers, count, and enter opening stock — **quantities only, never a peso**, and **switched off until the joint launch** with 2C (cost moves) and 2B-b (the phone).

**Architecture:** One migration, **0104**: eight private tables (stock switch, places, purchase-line matches, lots, records, per-lot moves, request covers, events), `stk_*` functions for every action and read, and three triggers that keep purchases honest about stock (no correction undoes it, no void while stock records exist, the old inventory table frozen once stock is on). "Bought" in every request capacity formula becomes **covered** (purchases + stock), so Still to buy follows issues. Dacs Web gets a **Requests → Stock** tab (`js/stock-admin.js`), an "In warehouse" hint and "Issue from stock" on the shopping list, and hides the old "Add to inventory" tick and Inventory screen once stock is on. Every write takes an operation id (send once) and the locks purchases already use (purchase first, then items and request lines in one sorted pass).

**Tech stack:** PostgreSQL / Supabase (plpgsql), vanilla JS, Node test files, PGlite, embedded PostgreSQL for the two-sessions tests.

**Spec:** [Mobile Purchasing](../specs/2026-09-30-workmate-mobile-purchasing-design.md) (*Warehouse cost assignment*, §3.8) · answers: [2B + 2C questions](../specs/2026-10-24-workmate-stage2bc-questions.md) — **Q1–Q30 = A ("I approve all R", 24 Oct 2026)** · earlier answers kept: [Stage 2 questions](../specs/2026-10-12-workmate-stage2-questions.md) (Q9, Q11–Q15, Q25, Q28) · purchasing as built: plans [2A-2](2026-10-16-workmate-stage2a2-purchasing-office.md), [2A-4b](2026-10-23-workmate-stage2a4b-buyer-payments.md), [0.8.1](2026-10-24-workmate-0.8.1-pilot-fixes.md)

**Repo:** **Dacs Web** only (base `be1add8`). Plans 2C and 2B-b follow; one joint pilot, then launch (Q1, Q30).

**Status:** Revision 3, 26 October 2026, **for the user's review**. Revision 3 fixes the rounding finding of the user's review of revision 2 (which accepted R70, R71 and the changed R55): three boxes entered separately could total **99.999** pieces instead of 100 when their receipt dates were entered out of order — revision 2 gave each new receipt the converted total of the receipts dated *before it* less theirs. Now each new receipt gets the **converted total received less the quantities already assigned**, and no existing receipt's quantity ever changes (R56); a regression test covers dates out of order, backdated receipts, a reversal and a receipt again. Earlier: revision 2, 25 October 2026. Revision 2 fixes the two findings of the user's review of revision 1: **(1)** a catalogue item's kind and unit are now fixed once **stock** uses it — a match, a lot or any stock record — even with no request (R70); **(2)** stock is issued **oldest received first, by delivery** — each delivery, including each part of a partial delivery, is its own layer dated the day it arrived; revision 1 ordered by purchase date per purchase line (R65 rewritten, R71). Stock stays **switched off**. Nothing is applied live and nothing is in the repo yet. The code below was built and tested first in a scratch clone (one commit per task, every suite green after each), then re-applied to a fresh clone from this plan's text and compared byte for byte (see *Rehearsal*).

## Global Constraints

- **Outside the money model (CLAUDE.md):** 0104 reads and writes **no peso amount, no `expenses` or `payroll` row, and changes no Spent / Earned / Profit function**. The value of stock and every cost move are **Stage 2C** (main owner only). A warehouse purchase stays outside Spent exactly as in 2A.
- **New data needs real DB columns.** 0104 creates its own tables and adds no column to an existing table. It **redefines** `pr_portion_bought`, `pr_line_bought`, `pur_shopping_list` and `pur_purchase_view` — all four checked live on 25 Oct to match their migration files exactly (`md5(replace(prosrc, chr(13), ''))`), so nothing live is lost.
- **Migrations:** next number = highest + 1 = **0104** (highest on disk: `0103_buyer_return_photo.sql`). The user applies the **committed** file, unchanged, once (SQL editor). We then verify the live database ourselves.
- **Dormant until launch (Q1):** 0104 goes live in Task 3 with stock **switched off** — every stock write and read answers `STOCK_OFF`; only the main owner sees Requests → Stock, with the switch and a warning. **Do not switch stock on** in this plan: it goes on at the joint launch, after 2C, 2B-b and the joint pilot (Q30).
- **Staff see no peso amounts:** the Stock tab shows quantities only — no price, value or supplier anywhere in its reads (Q28). Workers and team leaders see nothing of it.
- **Dates:** a receipt's, issue's or count's day is a Manila day that has happened (`pur_past_day`); the screens build "today" from local parts, never `toISOString()`.
- **Mirror portal edits:** not needed — this is `admin.html` only (no client or partner screen changes).
- **The user commits.** Executors never run `git commit` or `git push`. Each task ends at a "stop for the user" step. The user's own uncommitted edit in `admin.html` stays as it is: apply the Modify blocks with `git apply`, which leaves the rest of the file alone.
- **CRLF files:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are CRLF. Task 1's Step 1 restores CRLF after applying (the diffs are shown with LF).

## Rulings (2B-a)

R1–R51 stand (plans 2A-2 … 0.8.1). New, found while building and testing this plan. **For the user's approval with the plan.**

| # | Ruling |
|---|---|
| R52 | **Requests → Stock is its own tab**, not part of Purchasing: Q11 includes office staff who do not have the Buyer switch. Who records stock: owner and staff accounts allowed the Expenses section (Buyer staff are office staff) — the same accounts that may enter purchases on the Expenses form. Workers and team leaders never. |
| R53 | **The stock switch.** `stk_settings`, one row per company, set only by the **main owner** (`stk_set_enabled`, typed "STOCK" on the screen). Off: every stock write and read is `STOCK_OFF`, the tab is hidden from everyone but the main owner (who sees the switch and "only at launch"), the shopping list hint reads 0, and the old tick works as today. |
| R54 | **Warehouse lines always need the office's match.** A warehouse purchase line cannot link to a request (2A's rule), so it is never matched automatically. The Receiving tab makes it one click when the line's name and unit equal **exactly one** active catalogue item (a suggestion the office confirms, never applied by itself). Letting the buyer pick the catalogue item at the counter is a question for 2B-b. |
| R55 | **Matching (Q4, Q5).** Automatic only for a project line linked to a request whose catalogue item has the line's own unit (not a substitute): one line unit = one item unit. Otherwise the office says how many item units the **whole line** is; another unit needs a note and is never checked by whoever recorded or bought the purchase (the owner may) — the same rule as the purchase unit check. A match can change until **any of its goods are stock** (received under it, left over, …); to change it after that, reverse those records first. *(Rev 2: was "until its goods move" — a delivery already counted in the old item is now protected too.)* |
| R56 | **Receipts (Q6, Q7).** Kept in the purchase line's own unit. Once the line is matched, **each receipt enters stock as its own layer**, dated the day it arrived. **Rev 3:** its item units = the converted total received (the receipts already in stock plus this one) **less the item units already assigned** to those receipts; an existing receipt's quantity never changes. So the whole line adds up exactly whatever the receipt dates or the order of entry — 3 boxes = 100 pieces entered as box 1 (dated yesterday) 33.333, box 2 (dated the day before) 33.334, box 3 (dated earlier still) 33.333 — and a box reversed and received again brings it back to exactly 100 (revision 2 could end at 99.999). Receipts made before the match enter at the match, in the order received, each keeping its own received day. Received in parts; the rest shows **Awaiting delivery** until received or closed **Not delivered** with a reason (any money back goes through 2A-4's refund or credit). |
| R57 | **A return never reopens a request.** Returning unused goods from an issue moves the same lots back; the request stays filled (the goods were delivered). A **mistaken** issue is reversed instead, which does reopen it. (What a return does to cost — Q10 — is 2C.) |
| R58 | **Filling a request from stock (Q8, Q9).** Only with the request line's own catalogue item (or a line with none) in the same unit; the whole quantity must fit Still to buy (the rest is a separate, unplanned record — stock records have no "extra"). Picked weekly portions are the only ones filled; otherwise the earliest week first. Any stock recorder may fill a request — the Buyer switch is a purchasing rule, not a stock one (Q11). No reservations: the shopping list shows **In warehouse: N** as a hint only. |
| R59 | **"Bought" means covered where it limits buying.** `pr_portion_bought` / `pr_line_bought` = recorded purchases **plus** live stock records, so every 0097 formula (Still to buy, splitting, assigning, reducing a request) counts goods issued from stock and Still to buy is never negative. What the shopping list and a purchase **show** as Bought stays purchases alone, with **From stock** beside it. WorkMate 0.8.1 does not show From stock yet — 2B-b does, at the same launch (stock is off until then). |
| R60 | **Counts (Q27).** One item at one place. Equal to the books: done. Different: waits for the main owner with a reason (lost, damaged, expired, miscounted, other), and is confirmed only while the books still read what they read when counted — otherwise **count again**. A loss comes off the lots there, oldest first; goods found become an untraced lot. One open count per item and place. |
| R61 | **Opening stock (Q13).** Waits for the main owner. Traced only to a recorded **project** purchase line — those goods are its leftovers, and share its room with leftovers (pending ones included); a warehouse line becomes stock only by being received. Untraced otherwise (worth ₱0 in 2C). |
| R62 | **Reversing (Q23).** Never edited: a record is reversed with a reason (kept, marked) by the person who recorded it or an owner account; a confirmed count or opening stock by the main owner only; a record still waiting is **withdrawn** (its recorder or the main owner). Refused while the goods have moved on — reverse the later records first; an issue with returns needs its returns reversed first. In 2B-a no cost has moved, so no reversal waits for the owner; 2C adds that where an approved cost move exists. |
| R63 | **Purchases with stock (Q21, Q22), by trigger** — the 2A functions are not rewritten: a stored purchase line keeps its destination, project and unit while it has stock records, and its quantity covers what was received and closed (warehouse) or entered as stock (project) — else `STOCK_IN_USE`; a purchase with live or waiting stock records is never voided, replaced, or voided by an approved change request. A matched line whose unit is corrected before any stock record goes back to **To match**. Q21's "price change refused while approved moves use the line" is 2C (no approved move exists before 2C). |
| R64 | **One stock path (Q29).** Once stock is on, the old `inventory` table refuses every write (`STOCK_TICK_RETIRED`) — which retires both the Add Expense "Also add this to inventory" tick (also hidden, and never sent) and the old Construction → Inventory screen (hidden). The table and its empty rows stay, read-only, for a later clean-up. Before launch nothing changes. |
| R65 | **Oldest received first (Q12), rev 2.** Goods are kept in **layers**: each delivery received (each part of a partial delivery is its own), each leftover record, each confirmed opening stock and goods found by a count is one layer, dated the **day it entered stock**, and a layer travels with its goods. An issue, a move or a loss takes the oldest received layers at that place first — among **all** lots of the item there, company stock and project leftovers alike — never by purchase date (a late part delivery of an old purchase goes after an earlier delivery of a newer one; a delivery entered late but received earlier goes first). Staff may name the lot the goods came from: then its oldest received layer first. Fixed when the goods move; 2C values each move by its lot. A return brings back the same lots and layers; one item's screen lists each layer with the day it was received. |
| R66 | **What stock reads show staff:** item, quantities, places, dates, who recorded, and for a purchase line its item name, quantity, unit, purchase date and buyer's name — **never a price, value or supplier** (checked by a test that walks every read). No stock table is readable directly. |
| R67 | **Completed projects** stay pickable for physical records, marked "(completed)" (Q16: cost moves into or out of them are 2C's refusal). |
| R68 | **Two old test fences rewritten, same guarantee:** `tests/purchasing-admin.test.js` read the Purchasing nav gate in its old shape (one `if` for Purchasing) — now one `if` hides Purchasing and Stock; `tests/purchasing-payments-server.test.js` looked for 0103's file name, which leaves the README's next-number line when 0104 arrives — now its paragraph. |
| R69 | **Item history** is untouched (its switch stays off); linking stock to item history waits until 2A's first real use is assessed. |
| R70 | **A catalogue item's kind and unit are fixed once stock uses it (rev 2)** — a match, a lot, or any stock record (live, waiting or reversed: history) — even if no request ever used it. 0092 fixed them for request lines and said to extend the test when Stage 2 adds stock tables: `pr_item_in_use` now counts both, 0092's `pr_office_save_item` refuses `ITEM_IN_USE` through it, `pr_office_catalog`'s `in_use` locks the two fields on the Catalogue form, and a trigger on `pr_catalog_items` refuses any other path. Name, spec, category, brand, other names and Active stay editable. Every stock write holds the item's row while it runs (`FOR SHARE`), so a unit change and a first match at the same moment can never both succeed (race 8). |
| R71 | **A delivery is reversed only while its own goods are there (rev 2).** Reversing a receipt, leftover, opening or count checks that record's own layers — not the lot as a whole — so a delivery whose goods were issued cannot be reversed just because a later delivery of the same purchase is still in the warehouse. |

## File structure

| File | Task | What |
|---|---|---|
| `supabase/migrations/0104_stock.sql` | 1 | **New.** Tables, guards, `stk_*` operations and reads, covered = purchases + stock |
| `supabase/tests/2b_stock.pglite.mjs` | 1 | **New.** 38 behaviour tests on PGlite |
| `supabase/tests/2b_concurrency.mjs` | 1 | **New.** 8 two-sessions-at-once tests on real PostgreSQL, 15 rounds each |
| `supabase/tests/2b_acceptance.sql` | 1 | **New.** Live acceptance, rolls itself back |
| `supabase/tests/pr_base.mjs` | 1 | `CATALOG_0085`: the catalogue columns 0104 reads (0085's and 0090's) |
| `supabase/tests/2a1…2a4 *.pglite.mjs` | 1 | `--with-0104`: every purchasing suite again with 0104 — stock off (2A-1, the tick's own suite), stock on (2A-2, 2A-3, 2A-4) |
| `tests/purchasing-payments-server.test.js` | 1 | R68 (0103's README fence) |
| `package.json` | 1, 2 | test:sql (Task 1); `stock-admin.test.js` in `npm test` (Task 2) |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md`, `CLAUDE.md` | 1 | Docs (the first two CRLF) |
| `js/stock-admin.js` | 2 | **New.** Requests → Stock and its forms; `StockAdmin.openIssue`; each delivery listed with its received day |
| `tests/stock-admin.test.js` | 2 | **New.** 16 tests: words agree with 0104, quantities only, wiring, the item lock's sentence, layers |
| `js/requests-admin-core.js` | 2 | The Catalogue's `ITEM_IN_USE` sentence names stock (R70) |
| `js/admin.js`, `admin.html` | 2 | Nav entry, stock status, view, script; old Inventory hidden once on |
| `js/purchasing-admin-list.js` | 2 | In warehouse hint, Issue from stock, From stock per portion |
| `js/expenses-module.js` | 2 | The old tick hidden and never sent once stock is on |
| `css/purchasing-admin.css` | 2 | `stk-*` styles |
| `tests/purchasing-admin.test.js` | 2 | R68 (nav fence) |
| `docs/ARCHITECTURE.md` | 2 | Module map row |

---

### Task 1: Dacs Web — migration 0104 (stock, quantities only)

**Interfaces produced:** `pr_office_save_item` / `pr_office_catalog` (0092's, `in_use` counting stock), `stk_status()`, `stk_set_enabled(boolean)`, `stk_match(op, purchase, line_no, item, covers text, note)`, `stk_receive(op, purchase, line_no, qty text, on text, note)`, `stk_not_delivered(op, purchase, line_no, qty text, reason)`, `stk_leftover(op, purchase, line_no, qty text, where text, on text, note)`, `stk_move(op, body jsonb)`, `stk_count(op, body jsonb)`, `stk_opening(op, body jsonb)`, `stk_decide(op, record, approve, note)`, `stk_reverse(op, record, reason)`; reads `stk_overview()`, `stk_item(item)`, `stk_project_lines(folder)`, `stk_choices()`, `stk_request_lines(folder)`; `pur_shopping_list` rows gain `from_stock`, `in_warehouse`, `in_warehouse_unit` (portions: `from_stock`).

<!-- Tests -->

**Modify:** `supabase/tests/2a1_purchase.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a1_purchase.pglite.mjs b/supabase/tests/2a1_purchase.pglite.mjs
index e89d955..c83e597 100644
--- a/supabase/tests/2a1_purchase.pglite.mjs
+++ b/supabase/tests/2a1_purchase.pglite.mjs
@@ -21,12 +21,17 @@ const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
 // must not change how a purchase is recorded, funded, corrected or voided.
 // --with-0101: the same again with 2A-3a's 0101 on top of 0097.
 // --with-0102: and 2A-4a's 0102 on top of those (payments must not change recording).
-const WITH_0102 = process.argv.includes('--with-0102');
+// --with-0104: and 2B-a's 0104 (stock) on top, switched OFF as before launch —
+// the old tickbox and every purchase rule unchanged.
+const WITH_0104 = process.argv.includes('--with-0104');
+const WITH_0102 = process.argv.includes('--with-0102') || WITH_0104;
 const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
 const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
 const WITH_0101 = process.argv.includes('--with-0101') || WITH_0102;
 const WITH_0097 = process.argv.includes('--with-0097') || WITH_0101;
-const PR_BASE = WITH_0097 ? (await import('./pr_base.mjs')).prBase(ROOT) : '';
+const PR_MOD = WITH_0097 ? await import('./pr_base.mjs') : null;
+const PR_BASE = WITH_0097 ? PR_MOD.prBase(ROOT) : '';
+const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
 const M97 = WITH_0097 ? read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')) : '';
 const M101 = WITH_0101 ? read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')) : '';
 const fnText = (src, name) => {
@@ -102,6 +107,7 @@ async function fresh() {
   if (WITH_0097) { await db.exec(PR_BASE); await db.exec(M97); }
   if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
+  if (WITH_0104) { await db.exec(PR_MOD.CATALOG_0085); await db.exec(M104); }
   await db.exec(`insert into profiles values
     ('${OWNER}', 'owner', null, 'active', null), ('${STAFF}', 'staff', '${OWNER}', 'active', null),
     ('${WORKER}', 'worker', '${OWNER}', 'active', null), ('${OTHER}', 'owner', null, 'active', null),
@@ -147,7 +153,7 @@ async function code(promise) {
   try { await promise; return 'no error'; } catch (e) { return e.message; }
 }
 
-console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + ' on PGlite)');
+console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock off)' : '') + ' on PGlite)');
 
 await test('§3.3 example: ₱8,000 on 14 Oct → ₱3,000 + ₱4,000 + ₱1,000 Cover (earliest billing number first)', async () => {
   const db = await fresh(); await as(db, OWNER);
```

**Modify:** `supabase/tests/2a2_purchasing.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a2_purchasing.pglite.mjs b/supabase/tests/2a2_purchasing.pglite.mjs
index e81cfcf..a64e07f 100644
--- a/supabase/tests/2a2_purchasing.pglite.mjs
+++ b/supabase/tests/2a2_purchasing.pglite.mjs
@@ -11,7 +11,7 @@ import { PGlite } from '@electric-sql/pglite';
 import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
-import { prBase, fnText } from './pr_base.mjs';
+import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';
 
 const HERE = path.dirname(fileURLToPath(import.meta.url));
 const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
@@ -23,7 +23,11 @@ const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql
 // --with-0101: the same tests with 2A-3a's 0101 on top — 0101 must not change
 // how the Purchasing tab buys, covers, corrects or approves.
 // --with-0102: and 2A-4a's 0102 on top of 0101.
-const WITH_0102 = process.argv.includes('--with-0102');
+// --with-0104: and 2B-a's 0104 (stock) on top, switched ON (launch) — stock
+// must not change how the Purchasing tab buys, covers, corrects or approves.
+const WITH_0104 = process.argv.includes('--with-0104');
+const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
+const WITH_0102 = process.argv.includes('--with-0102') || WITH_0104;
 const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
 const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
 const WITH_0101 = process.argv.includes('--with-0101') || WITH_0102;
@@ -97,6 +101,7 @@ async function fresh() {
   await db.exec(M97);
   if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
+  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -109,6 +114,7 @@ async function fresh() {
   await as(db, OWNER);
   await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
   await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
+  if (WITH_0104) await db.query(`select stk_set_enabled(true)`);
   return db;
 }
 async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
@@ -163,7 +169,7 @@ async function spent(db, folderId) {
   return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
 }
 
-console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097' + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + ' on PGlite)');
+console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097' + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + ' on PGlite)');
 
 // ── A. The Buyer switch ──────────────────────────────────────────────
 
```

**Modify:** `supabase/tests/2a3_server.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a3_server.pglite.mjs b/supabase/tests/2a3_server.pglite.mjs
index ddfe73f..6471751 100644
--- a/supabase/tests/2a3_server.pglite.mjs
+++ b/supabase/tests/2a3_server.pglite.mjs
@@ -11,7 +11,7 @@ import { PGlite } from '@electric-sql/pglite';
 import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
-import { prBase, fnText } from './pr_base.mjs';
+import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';
 
 const HERE = path.dirname(fileURLToPath(import.meta.url));
 const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
@@ -22,7 +22,10 @@ const M96 = read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sq
 const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql'));
 const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql'));
 // --with-0102: the same tests with 2A-4a's 0102 on top — payments must not change the phone server.
-const WITH_0102 = process.argv.includes('--with-0102');
+// --with-0104: and 2B-a's 0104 (stock) on top, switched ON (launch).
+const WITH_0104 = process.argv.includes('--with-0104');
+const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
+const WITH_0102 = process.argv.includes('--with-0102') || WITH_0104;
 const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
 const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
 
@@ -109,6 +112,7 @@ async function fresh() {
   await db.exec(M97);
   await db.exec(M101);
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
+  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -126,6 +130,7 @@ async function fresh() {
   await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
   await db.query(`select pur_set_buyer($1, true)`, [GONE]);
   await db.query(`update profiles set status = 'inactive' where id = $1`, [GONE]);
+  if (WITH_0104) await db.query(`select stk_set_enabled(true)`);
   return db;
 }
 async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
@@ -165,7 +170,7 @@ async function periodsOf(db, folderId) {
                     from projects p where p.folder_id = $1 order by p.created_at, p.id`, [folderId]);
 }
 
-console.log('\n2A-3a phone purchasing server (0096 + 0097 + 0101' + (WITH_0102 ? ' + 0102' : '') + ' on PGlite)');
+console.log('\n2A-3a phone purchasing server (0096 + 0097 + 0101' + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + ' on PGlite)');
 
 // ── A. Signing a buyer in (Q1, R1, R3) ──────────────────────────────
 
```

**Modify:** `supabase/tests/2a4_payments.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a4_payments.pglite.mjs b/supabase/tests/2a4_payments.pglite.mjs
index 91f00e1..856600a 100644
--- a/supabase/tests/2a4_payments.pglite.mjs
+++ b/supabase/tests/2a4_payments.pglite.mjs
@@ -11,7 +11,7 @@ import { PGlite } from '@electric-sql/pglite';
 import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
-import { prBase, fnText } from './pr_base.mjs';
+import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';
 
 const HERE = path.dirname(fileURLToPath(import.meta.url));
 const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
@@ -24,7 +24,11 @@ const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql
 const M98 = read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql'));
 const M102 = read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql'));
 // --with-0103: re-run every test with 0103 on top (2A-4b: a return's photo reaches its buyer).
-const WITH_0103 = process.argv.includes('--with-0103');
+// --with-0104: and 2B-a's 0104 (stock) on top of 0103, switched ON (launch) —
+// stock must not change how purchases are paid.
+const WITH_0104 = process.argv.includes('--with-0104');
+const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
+const WITH_0103 = process.argv.includes('--with-0103') || WITH_0104;
 const M103 = WITH_0103 ? read(path.join(ROOT, 'supabase/migrations/0103_buyer_return_photo.sql')) : '';
 
 // The 2A-1 base schema (same as 2a1_purchase.pglite.mjs), plus the service
@@ -114,6 +118,7 @@ async function fresh(opts = {}) {
     await db.exec(fnText(M98, 'pm_main_owner_id'));
     await db.exec(M102);
     if (WITH_0103) await db.exec(M103);
+    if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); }
   }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
@@ -132,6 +137,7 @@ async function fresh(opts = {}) {
   await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
   await db.query(`select pur_set_buyer($1, true)`, [GONE]);
   await db.query(`update profiles set status = 'inactive' where id = $1`, [GONE]);
+  if (WITH_0104 && !opts.without102) await db.query(`select stk_set_enabled(true)`);
   return db;
 }
 async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
@@ -207,7 +213,7 @@ async function resolve(db, purchaseId, refunds, credit = null, opId = op()) {
     [opId, purchaseId, JSON.stringify(refunds), credit === null ? null : JSON.stringify(credit)])).r;
 }
 
-console.log('\n2A-4a paying for purchases (0096 + 0097 + 0101 + 0102 on PGlite)');
+console.log('\n2A-4a paying for purchases (0096 + 0097 + 0101 + 0102' + (WITH_0103 ? ' + 0103' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + ' on PGlite)');
 
 // ── A. "Paid now": the purchase and its payments together (Q3) ─────────
 
```

**Create:** `supabase/tests/2b_acceptance.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 2B-a acceptance — migration 0104 (live behaviour, stock).
--
-- Self-wrapped in begin / rollback: nothing persists — not the stock switch,
-- the ZZ project, item, purchases, stock records or the Buyer switch.
-- Editor-safe (set_config 'v2b.*', no temp objects). Needs one active main
-- owner allowed Expenses, an active staff account of theirs allowed Expenses,
-- and an active worker. Run it through MCP execute_sql. Success ends with the
-- row '2b acceptance: all checks passed'.
--   A. stock is off: everyone is refused; the main owner switches it on
--   B. a warehouse purchase: matched, received in part, awaiting the rest;
--      the item's unit is then fixed (stock uses it)
--   C. issue, return, count (main owner confirms), reverse — balances right;
--      the oldest RECEIVED delivery goes first
--   D. purchases with stock: void refused; the old tick refused once on
--   E. a worker sees nothing; helpers stay internal; no peso written
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_folder uuid; v_item uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select p.id, s.id into v_owner, v_staff
    from profiles p join profiles s on s.owner_id = p.id and s.role = 'staff' and coalesce(s.status, 'active') = 'active'
         and (jsonb_typeof(s.allowed_modules) is distinct from 'array' or jsonb_array_length(s.allowed_modules) = 0
              or s.allowed_modules ? 'expenses')
   where p.role = 'owner' and p.owner_id is null and coalesce(p.status, 'active') = 'active'
     and (jsonb_typeof(p.allowed_modules) is distinct from 'array' or jsonb_array_length(p.allowed_modules) = 0
          or p.allowed_modules ? 'expenses')
   order by p.created_at, s.created_at limit 1;
  select w.id into v_worker from profiles w
   where w.owner_id = v_owner and w.role in ('worker', 'teamLeader') and coalesce(w.status, 'active') = 'active'
   order by w.created_at limit 1;
  assert v_owner is not null and v_staff is not null and v_worker is not null,
    'need an active main owner with an active staff account allowed Expenses and an active worker';
  assert not coalesce((select enabled from stk_settings where owner_id = v_owner), false), 'stock must still be off live (2B-a is dormant)';
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2b acceptance') returning id into v_folder;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, created_by)
  values (v_owner, 'material', 'ZZ 2b cement', 'acceptance', 'bag', v_owner) returning id into v_item;
  perform set_config('v2b.owner', v_owner::text, true);
  perform set_config('v2b.staff', v_staff::text, true);
  perform set_config('v2b.worker', v_worker::text, true);
  perform set_config('v2b.folder', v_folder::text, true);
  perform set_config('v2b.item', v_item::text, true);
  perform set_config('v2b.today', v_today::text, true);
  perform set_config('v2b.yesterday', (v_today - 1)::text, true);
  perform set_config('v2b.expenses', (select count(*)::text from expenses), true);
end $$;

-- ═══ A. Off until the main owner switches it on ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (stk_status() ->> 'enabled')::boolean = false and (stk_status() ->> 'can_record')::boolean, 'A1 staff: may record, but stock is off';
  begin
    perform stk_overview();
    raise exception 'A2 a read worked while off';
  exception when others then assert sqlerrm like '%STOCK_OFF%', 'A2 wrong error: ' || sqlerrm;
  end;
  begin
    perform stk_set_enabled(true);
    raise exception 'A3 staff switched stock on';
  exception when others then assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'A3 wrong error: ' || sqlerrm;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  perform pur_set_buyer(current_setting('v2b.staff')::uuid, true);
  perform stk_set_enabled(true);
  assert (stk_status() ->> 'enabled')::boolean and (stk_status() ->> 'is_main_owner')::boolean, 'A4 on, for the main owner';
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2b.today'),
         'supplier', 'ZZ 2b supplier', 'receipt_total', '1000', 'notes', 'ZZ 2b',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 2b cement', 'unit', 'bag',
                                                       'quantity', '10', 'amount', '1000', 'category', 'Materials',
                                                       'unplanned_reason', 'ZZ 2b acceptance'))));
  perform set_config('v2b.purchase', r ->> 'purchase_id', true);
end $$;

-- ═══ B. Matched, received in part ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.staff'), 'role', 'authenticated')::text, true);
do $$
declare ov jsonb; l jsonb;
begin
  ov := stk_overview();
  select x into l from jsonb_array_elements(ov -> 'awaiting') x where x ->> 'purchase_id' = current_setting('v2b.purchase');
  assert l is not null and (l ->> 'awaiting')::numeric = 10 and l -> 'match' = 'null'::jsonb, 'B1 awaiting 10, to match';
  assert l ->> 'suggested_item_id' = current_setting('v2b.item'), 'B2 the one-click suggestion';
  assert not (l ? 'gross_amount') and not (l ? 'amount'), 'B3 no price on the line';
  perform stk_match(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 1, current_setting('v2b.item')::uuid, '10', null);
  perform stk_receive(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 1, '6', current_setting('v2b.yesterday'), 'ZZ 2b');
  select x into l from jsonb_array_elements(stk_overview() -> 'awaiting') x where x ->> 'purchase_id' = current_setting('v2b.purchase');
  assert (l ->> 'received')::numeric = 6 and (l ->> 'awaiting')::numeric = 4, 'B4 received 6, awaiting 4';
  begin
    perform stk_receive(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 1, '5', current_setting('v2b.today'), '');
    raise exception 'B5 received more than awaited';
  exception when others then assert sqlerrm like '%MORE_THAN_AWAITED%', 'B5 wrong error: ' || sqlerrm;
  end;
  begin
    perform pr_office_save_item(current_setting('v2b.item')::uuid, 'material', 'ZZ 2b cement', 'acceptance', 'kg', '', true, null, null);
    raise exception 'B6 the unit of an item stock uses changed';
  exception when others then assert sqlerrm like '%ITEM_IN_USE%', 'B6 wrong error: ' || sqlerrm;
  end;
  assert (select (x ->> 'in_use')::boolean from jsonb_array_elements(pr_office_catalog()) x where x ->> 'id' = current_setting('v2b.item')),
    'B7 the catalogue shows it in use';
end $$;

-- ═══ C. Issue, return, count, reverse ═══
do $$
declare i jsonb; ret jsonb; c jsonb; v_item jsonb;
begin
  i := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2b.item'), 'from', 'warehouse',
         'to', current_setting('v2b.folder'), 'quantity', '4', 'on', current_setting('v2b.today'), 'unplanned_reason', 'ZZ 2b'));
  assert i ->> 'kind' = 'issue', 'C1 an issue';
  ret := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2b.item'), 'returns_record', i ->> 'record_id',
           'quantity', '1', 'on', current_setting('v2b.today')));
  perform set_config('v2b.return', ret ->> 'record_id', true);
  c := stk_count(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2b.item'), 'at', 'warehouse', 'counted', '2',
         'on', current_setting('v2b.today'), 'reason', 'lost'));
  assert c ->> 'status' = 'pending' and (c ->> 'book')::numeric = 3, 'C2 counted 2 of 3: waits for the owner';
  perform set_config('v2b.count', c ->> 'record_id', true);
  begin
    perform stk_decide(gen_random_uuid(), (c ->> 'record_id')::uuid, true, 'x');
    raise exception 'C3 staff confirmed a count';
  exception when others then assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'C3 wrong error: ' || sqlerrm;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  perform stk_decide(gen_random_uuid(), current_setting('v2b.count')::uuid, true, 'ZZ 2b');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.staff'), 'role', 'authenticated')::text, true);
do $$
declare it jsonb; wh numeric; site numeric;
begin
  perform stk_reverse(gen_random_uuid(), current_setting('v2b.return')::uuid, 'ZZ 2b mistake');
  it := stk_item(current_setting('v2b.item')::uuid);
  select coalesce(sum((p ->> 'quantity')::numeric) filter (where p ->> 'name' = 'Warehouse'), 0),
         coalesce(sum((p ->> 'quantity')::numeric) filter (where p ->> 'name' = 'ZZ 2b acceptance'), 0)
    into wh, site
    from jsonb_array_elements(it -> 'lots') l, jsonb_array_elements(l -> 'places') p;
  assert wh = 1 and site = 4, 'C4 warehouse 1, site 4 (6 in, 4 out, 1 lost; the return reversed) — got ' || wh || ' / ' || site;
  assert (select count(*) from jsonb_array_elements(it -> 'records') r where (r ->> 'reversed')::boolean) = 1, 'C5 the reversed record stays';
end $$;
do $$
declare i jsonb; wh jsonb;
begin
  -- The rest arrives today; yesterday's delivery (1 left) still goes first.
  perform stk_receive(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 1, '4', current_setting('v2b.today'), 'ZZ 2b');
  i := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2b.item'), 'from', 'warehouse',
         'to', current_setting('v2b.folder'), 'quantity', '2', 'on', current_setting('v2b.today'), 'unplanned_reason', 'ZZ 2b'));
  assert jsonb_array_length(i -> 'lots') = 2, 'C6 the issue drew on two deliveries';
  select jsonb_agg(jsonb_build_array(y ->> 'received_on', (y ->> 'quantity')::numeric)) into wh
    from jsonb_array_elements(stk_item(current_setting('v2b.item')::uuid) -> 'lots') l, jsonb_array_elements(l -> 'layers') y
   where y ->> 'name' = 'Warehouse';
  assert wh = jsonb_build_array(jsonb_build_array(current_setting('v2b.today'), 3)),
    'C7 oldest received first: yesterday''s last bag went, today''s delivery has 3 left — got ' || coalesce(wh::text, 'nothing');
end $$;

-- ═══ D. Purchases with stock ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_void(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 'ZZ 2b');
    raise exception 'D1 voided a purchase with stock records';
  exception when others then assert sqlerrm like '%STOCK_IN_USE%', 'D1 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2b.today'),
      'receipt_total', '10', 'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 2b tick',
      'unit', 'pc', 'quantity', '1', 'amount', '10', 'in_inventory', true, 'unplanned_reason', 'ZZ 2b'))));
    raise exception 'D2 the old tick still writes';
  exception when others then assert sqlerrm like '%STOCK_TICK_RETIRED%', 'D2 wrong error: ' || sqlerrm;
  end;
end $$;

-- ═══ E. A worker sees nothing; helpers internal; no peso ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not (stk_status() ->> 'enabled')::boolean and not (stk_status() ->> 'can_record')::boolean, 'E1 a worker: no stock';
  begin
    perform stk_overview();
    raise exception 'E2 a worker read stock';
  exception when others then assert sqlerrm like '%NOT_ALLOWED%', 'E2 wrong error: ' || sqlerrm;
  end;
  begin
    perform stk_balance(gen_random_uuid(), gen_random_uuid());
    raise exception 'E3 stk_balance is callable';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'stk_move(uuid,jsonb)', 'execute'), 'E4 anon cannot move stock';
  assert not has_function_privilege('authenticated', 'pr_portion_bought(uuid)', 'execute'), 'E5 still internal';
  assert (select count(*) from pg_policies where tablename like 'stk\_%') = 0, 'E6 no direct table access';
  assert (select count(*) from expenses)::text = current_setting('v2b.expenses'), 'E7 no stock step wrote an expense row';
end $$;

select '2b acceptance: all checks passed' as result;
rollback;
```

**Create:** `supabase/tests/2b_concurrency.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 2B-a STOCK — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2b_stock.pglite.mjs)
//
// Same approach as 2a4_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104
// VERBATIM over the same minimal tables, pairs of calls released at the same
// moment on two connections. Nothing touches the live database.
//   1. two issues of the last bags at once → one, never below zero
//   2. two leftover records past what the line brought → one
//   3. a receipt reversed while its bags are issued → never below zero
//   4. a correction lowering a line while more is received → never past it
//   5. an issue and a purchase filling the same request at once → never past it
//   6. the same press twice at once → one record
//   7. a count confirmed while an issue moves the same bags → never a stale count
//   8. a catalogue unit change while stock is first matched to the item → one wins
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const M02 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
const BUYER = '00000000-0000-0000-0000-000000000011';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const ROUNDS = 15;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2b-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2B-a stock — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id), completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int, created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null, monthly_budget numeric not null default 0);
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false, split_group text, split_index int, split_total int,
  client_submission_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade, total_salary numeric);
create table inventory (id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid, created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}`);
  await admin.query(mig('0096_purchase_recording.sql'));
  await admin.query(prBase(ROOT));
  await admin.query(CATALOG_0085);
  await admin.query(mig('0097_purchasing_office.sql'));
  await admin.query(mig('0101_purchasing_phone.sql'));
  await admin.query(fnText(mig('0098_pm_profit_sharing.sql'), 'pm_main_owner_id'));
  await admin.query(mig('0102_purchase_payments.sql'));
  await admin.query(fnText(mig('0090_workmate_item_history.sql'), 'pr_clean_aliases'));
  await admin.query(mig('0104_stock.sql'));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${STAFF}', 'staff', '${OWNER}', 'active', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'), ('${WORKER}', 'worker', '${OWNER}', 'active', 'Mark');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true);
    select stk_set_enabled(true);`);

  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const as = (uid) => admin.query(`select set_config('test.uid', '${uid}', false)`);
  const mkFolder = async (name) => (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
  const mkPeriod = async (f) => {
    const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                          values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                  extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, f])).id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
  };
  const item = async (name) => (await one(`insert into pr_catalog_items (owner_id, name, unit) values ($1, $2, 'bag') returning id`, [OWNER, name])).id;
  const purchase = (lines) => JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: lines.reduce((s, l) => s + l.amount, 0),
    lines: lines.map(l => ({ category: 'Materials', unit: 'bag', unplanned_reason: 'test', ...l })) });
  const record = async (lines) => {
    await as(BUYER);
    return (await one(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [purchase(lines)])).r.purchase_id;
  };
  const call = async (uid, sql, args) => { await as(uid); return (await one(sql, args)).r; };
  const MATCH = `select stk_match(gen_random_uuid(), $1, 1, $2, $3, null) r`;
  const RECEIVE = `select stk_receive(gen_random_uuid(), $1, 1, $2, '${TODAY}', '') r`;
  const MOVE = `select stk_move(gen_random_uuid(), $1::jsonb) r`;
  const stocked = async (it, qty) => {
    const pid = await record([{ destination: 'warehouse', item_name: 'Cement', quantity: qty, amount: qty * 100 }]);
    await call(OWNER, MATCH, [pid, it, String(qty)]);
    await call(BUYER, RECEIVE, [pid, String(qty)]);
    return pid;
  };
  const issue = (it, f, qty, extra = {}) => JSON.stringify({ item_id: it, from: 'warehouse', to: f, quantity: String(qty), on: TODAY,
                                                             unplanned_reason: 'test', ...extra });
  const bal = async (it, where) => Number((await one(`select coalesce(sum(stk_balance(lt.id, l.id)), 0) b from stk_lots lt, stk_locations l
                                                      where lt.item_id = $1 and l.owner_id = $2 and
                                                            (case when $3 = 'warehouse' then l.kind = 'warehouse' else l.folder_id::text = $3 end)`,
                                                     [it, OWNER, where])).b);
  const negatives = async () => Number((await one(`select count(*) n from stk_balances($1) where quantity < 0`, [OWNER])).n);

  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  async function pair(uidA, sqlA, argsA, uidB, sqlB, argsB) {
    const [a, b] = [await session(uidA), await session(uidB)];
    const run = async (c, sql, args) => {
      try {
        await c.query('begin');
        const r = await c.query(sql, args);
        await c.query('select pg_sleep(0.03)');
        await c.query('commit');
        return { ok: true, r: r.rows[0] && r.rows[0].r };
      } catch (e) {
        try { await c.query('rollback'); } catch {}
        return { ok: false, code: e.code, msg: e.message };
      }
    };
    const out = await Promise.all([run(a, sqlA, argsA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Cement ' + i);
      const f = await mkFolder('last bags ' + i);
      await stocked(it, 10);
      const out = await pair(STAFF, MOVE, [issue(it, f, 7)], BUYER, MOVE, [issue(it, f, 7)]);
      if (deadlock(out)) dead++;
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /NOT_ENOUGH/.test(o.msg))
          || await bal(it, 'warehouse') !== 3 || await negatives() > 0) bad++;
    }
    check('1. two people issue 7 of the last 10 bags at once: exactly one is accepted, 3 left, never below zero',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 2
  {
    let bad = 0, dead = 0;
    const LEFT = `select stk_leftover(gen_random_uuid(), $1, 1, '6', 'site', '${TODAY}', '') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Gravel ' + i);
      const f = await mkFolder('leftovers ' + i); await mkPeriod(f);
      const pid = await record([{ destination: 'project', folder_id: f, item_name: 'Gravel', quantity: 10, amount: 1000 }]);
      await call(OWNER, MATCH, [pid, it, '10']);
      const out = await pair(STAFF, LEFT, [pid], BUYER, LEFT, [pid]);
      if (deadlock(out)) dead++;
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /MORE_THAN_BOUGHT/.test(o.msg)) || await bal(it, f) !== 6) bad++;
    }
    check('2. two leftover records of 6 from a line of 10 at once: one is accepted, never more than the line brought',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 3
  {
    let bad = 0, dead = 0;
    const REV = `select stk_reverse(gen_random_uuid(), $1, 'wrong') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Sand ' + i);
      const f = await mkFolder('reverse ' + i);
      const pid = await stocked(it, 10);
      const rcpt = (await one(`select id from stk_records where purchase_id = $1 and kind = 'receive'`, [pid])).id;
      const out = await pair(BUYER, REV, [rcpt], STAFF, MOVE, [issue(it, f, 4)]);
      if (deadlock(out)) dead++;
      const w = await bal(it, 'warehouse');
      const ok = out.filter(o => o.ok).length === 1
        && ((out[0].ok && /NOT_ENOUGH/.test(out[1].msg) && w === 0) || (out[1].ok && /MOVED_ON/.test(out[0].msg) && w === 6));
      if (!ok || await negatives() > 0) bad++;
    }
    check('3. a receipt reversed while its bags are issued, at once: one wins, the warehouse never goes below zero',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 4
  {
    let bad = 0, dead = 0;
    const FIX = `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'fix') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Nails ' + i);
      const pid = await record([{ destination: 'warehouse', item_name: 'Nails', quantity: 10, amount: 1000 }]);
      await call(OWNER, MATCH, [pid, it, '10']);
      await call(BUYER, RECEIVE, [pid, '4']);
      const fixed = purchase([{ destination: 'warehouse', item_name: 'Nails', quantity: 5, amount: 500 }]);
      const out = await pair(OWNER, FIX, [pid, fixed], STAFF, RECEIVE, [pid, '3']);
      if (deadlock(out)) dead++;
      const q = Number((await one(`select quantity q from purchase_lines where purchase_id = $1`, [pid])).q);
      const got = Number((await one(`select stk_received($1, 1) v`, [pid])).v);
      const ok = out.filter(o => o.ok).length === 1 && got <= q
        && ((out[0].ok && /MORE_THAN_AWAITED/.test(out[1].msg) && q === 5 && got === 4)
            || (out[1].ok && /STOCK_IN_USE/.test(out[0].msg) && q === 10 && got === 7));
      if (!ok) bad++;
    }
    check('4. a correction to 5 while 3 more of 4 received come in, at once: one wins, received never passes the line',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 5
  {
    let bad = 0, dead = 0;
    const REC = `select pur_record(gen_random_uuid(), $1::jsonb) r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Tiles ' + i);
      const f = await mkFolder('request ' + i); await mkPeriod(f);
      await stocked(it, 20);
      const batch = (await one(`select pr_batch_for($1, now()) b`, [OWNER])).b;
      const req = (await one(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`,
                             [OWNER, WORKER, f])).id;
      const line = (await one(`insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id) values ($1, $2, 'Tiles', 'bag', $3) returning id`,
                              [OWNER, req, it])).id;
      await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 10)`, [OWNER, line, batch]);
      const buy = purchase([{ destination: 'project', folder_id: f, item_name: 'Tiles', quantity: 6, amount: 600, request_line_id: line, unplanned_reason: '' }]);
      const out = await pair(STAFF, MOVE, [issue(it, f, 6, { request_line_id: line, unplanned_reason: '' })], BUYER, REC, [buy]);
      if (deadlock(out)) dead++;
      const covered = Number((await one(`select pr_line_bought($1) v`, [line])).v);
      const ok = out.filter(o => o.ok).length === 1 && covered === 6
        && out.some(o => !o.ok && /REQUEST_EXCEEDED|EXTRA_REASON_REQUIRED/.test(o.msg));
      if (!ok) bad++;
    }
    check('5. an issue of 6 and a purchase of 6 for a request of 10, at once: one is accepted, never covered past the need',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 6
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Wire ' + i);
      const f = await mkFolder('press ' + i);
      await stocked(it, 10);
      const press = (await one(`select gen_random_uuid() id`)).id;
      const SAME = `select stk_move('${press}'::uuid, $1::jsonb) r`;
      const out = await pair(STAFF, SAME, [issue(it, f, 4)], STAFF, SAME, [issue(it, f, 4)]);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select count(*) n from stk_records where item_id = $1 and kind = 'issue'`, [it])).n);
      if (out.some(o => !o.ok) || n !== 1 || await bal(it, f) !== 4 || out[0].r.record_id !== out[1].r.record_id) bad++;
    }
    check('6. the same press sent twice at once: one record, both calls answered with it',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 7
  {
    let bad = 0, dead = 0;
    const DECIDE = `select stk_decide(gen_random_uuid(), $1, true, 'ok') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Bolts ' + i);
      const f = await mkFolder('count ' + i);
      await stocked(it, 10);
      const c = await call(STAFF, `select stk_count(gen_random_uuid(), $1::jsonb) r`,
                           [JSON.stringify({ item_id: it, at: 'warehouse', counted: '8', on: TODAY, reason: 'lost' })]);
      const out = await pair(OWNER, DECIDE, [c.record_id], BUYER, MOVE, [issue(it, f, 3)]);
      if (deadlock(out)) dead++;
      const w = await bal(it, 'warehouse');
      const ok = (out[0].ok && out[1].ok && w === 5)
        || (!out[0].ok && /STALE_COUNT/.test(out[0].msg) && out[1].ok && w === 7);
      if (!ok || await negatives() > 0) bad++;
    }
    check('7. a count confirmed while an issue moves the same bags: confirmed against the books it counted, or refused as stale',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 8
  {
    let bad = 0, dead = 0;
    const SAVE = `select pr_office_save_item($1, 'material', 'Gravel', '', 'kg', '', true, null, null) r`;
    const FIRST = `select stk_match(gen_random_uuid(), $1, 1, $2, '10', null) r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Gravel ' + i);
      const pid = await record([{ destination: 'warehouse', item_name: 'Gravel', quantity: 10, amount: 1000 }]);
      const out = await pair(OWNER, SAVE, [it], STAFF, FIRST, [pid, it]);
      if (deadlock(out)) dead++;
      const unit = (await one(`select unit from pr_catalog_items where id = $1`, [it])).unit;
      const matched = Number((await one(`select count(*) n from stk_matches where purchase_id = $1`, [pid])).n);
      const ok = out.filter(o => o.ok).length === 1
        && ((out[0].ok && unit === 'kg' && matched === 0 && /REASON_REQUIRED/.test(out[1].msg))
            || (out[1].ok && unit === 'bag' && matched === 1 && /ITEM_IN_USE/.test(out[0].msg)));
      if (!ok) bad++;
    }
    check('8. a unit change while stock is first matched to the item, at once: one wins — never a match counted in the old unit',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/2b_stock.pglite.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 2B-a STOCK — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096, 0097, 0101, 0102, 0103 and 0104 VERBATIM on PGlite
// (PostgreSQL in memory) over the same minimal tables as the 2A-4 suite.
// Nothing here talks to the live database; supabase/tests/2b_acceptance.sql
// repeats the key cases there, rolled back.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const M02 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');
const M96 = mig('0096_purchase_recording.sql');
const M97 = mig('0097_purchasing_office.sql');
const M98 = mig('0098_pm_profit_sharing.sql');
const M101 = mig('0101_purchasing_phone.sql');
const M102 = mig('0102_purchase_payments.sql');
const M103 = mig('0103_buyer_return_photo.sql');
const M90 = mig('0090_workmate_item_history.sql');
const M104 = mig('0104_stock.sql');

const BASE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id) on delete cascade, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null,
  monthly_budget numeric not null default 0);
create table expenses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false,
  split_group text, split_index int, split_total int, client_submission_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  total_salary numeric, cover_expense boolean default false);
create table inventory (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid,
  created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}
`;

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';   // Expenses, no Buyer switch
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const LEADER = '00000000-0000-0000-0000-000000000015';
const OTHER = '00000000-0000-0000-0000-00000000000d';    // another company's owner
const PMOWNER = '00000000-0000-0000-0000-000000000013';  // owner-role account focused on PM
const EXPOWNER = '00000000-0000-0000-0000-000000000014'; // owner-role account with PM + Expenses (own scope)
const PMSTAFF = '00000000-0000-0000-0000-000000000018';  // staff focused on PM only
let opSeq = 0;
const op = () => '40000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);
function phDate(days = 0) {
  return new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
}
const TODAY = phDate();

async function fresh(opts = {}) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(CATALOG_0085);
  await db.exec(fnText(M90, 'pr_clean_aliases'));   // 0092's catalogue save calls it
  await db.exec(M97);
  await db.exec(M101);
  await db.exec(fnText(M98, 'pm_main_owner_id'));
  await db.exec(M102);
  await db.exec(M103);
  await db.exec(M104);
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', null, 'pedro@dacs.test', 'Pedro'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${LEADER}', 'teamLeader', '${OWNER}', 'active', null, null, 'Lito'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${PMOWNER}', 'owner', '${OWNER}', 'active', '["pm"]'::jsonb, 'admin-pm@dacs.test', null),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null),
    ('${PMSTAFF}', 'staff', '${OWNER}', 'active', '["pm"]'::jsonb, 'pmstaff@dacs.test', 'Pia');`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
  if (opts.on !== false) await db.query(`select stk_set_enabled(true)`);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}
async function refused(promise, want, m) {
  const got = await code(promise);
  assert(got.includes(want), (m || 'refused') + ': expected ' + want + ', got ' + got);
}

async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function period(db, folderId, budget = 100000) {
  const d = new Date(TODAY + 'T00:00:00Z');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, 'progress', 1) returning id`, [OWNER, folderId, months[d.getUTCMonth()], d.getUTCFullYear()])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, OWNER, budget]);
  return id;
}
async function item(db, name, unit = 'bag', owner = OWNER) {
  return (await one(db, `insert into pr_catalog_items (owner_id, name, unit) values ($1, $2, $3) returning id`, [owner, name, unit])).id;
}
// A request line for a project (Main Contract or work), one portion of NOW's batch.
async function request(db, folderId, opts = {}) {
  const batch = (await one(db, `select pr_batch_for($1, now()) b`, [OWNER])).b;
  const req = (await one(db, `insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id)
                               values ($1, $2, $3, $4) returning id`, [OWNER, WORKER, opts.project || folderId, folderId])).id;
  const line = (await one(db, `insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id)
                                values ($1, $2, $3, $4, $5) returning id`,
    [OWNER, req, opts.description || 'Cement', opts.unit || 'bag', opts.item || null])).id;
  const portion = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4) returning id`,
    [OWNER, line, batch, opts.quantity ?? 10])).id;
  return { req, line, portion, batch };
}
function body(lines, extra = {}) {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'purchasing', purchase_date: extra.date || TODAY, supplier: 'Wilcon', notes: '', payment_method: 'CASH',
           docs: {}, no_receipt_reason: 'test', receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', unit: 'bag', unplanned_reason: 'site ran out', ...l })) };
}
async function record(db, b, who = BUYER) {
  await as(db, who);
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [op(), JSON.stringify(b)])).r;
}
// A recorded warehouse purchase: one line of `qty` `unit` named `name`.
async function warehouseBuy(db, name, qty, opts = {}) {
  const r = await record(db, body([{ destination: 'warehouse', item_name: name, quantity: qty, unit: opts.unit || 'bag',
                                     amount: opts.amount || qty * 100 }], { date: opts.date }), opts.who || BUYER);
  return r.purchase_id;
}
async function projectBuy(db, f, name, qty, opts = {}) {
  const line = { folder_id: f, item_name: name, quantity: qty, unit: opts.unit || 'bag', amount: opts.amount || qty * 100 };
  if (opts.requestLine) { line.request_line_id = opts.requestLine; delete line.unplanned_reason; }
  const r = await record(db, body([line], { date: opts.date }), opts.who || BUYER);
  return r.purchase_id;
}
const rpc = async (db, who, fn, args) => {
  await as(db, who);
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  return (await one(db, `select ${fn}(${ph}) as r`, args)).r;
};
const match = (db, who, pid, line, itemId, covers, note = null) => rpc(db, who, 'stk_match', [op(), pid, line, itemId, String(covers), note]);
const receive = (db, who, pid, line, qty, on = TODAY) => rpc(db, who, 'stk_receive', [op(), pid, line, String(qty), on, '']);
const notDelivered = (db, who, pid, line, qty, reason = 'supplier ran out') => rpc(db, who, 'stk_not_delivered', [op(), pid, line, String(qty), reason]);
const leftover = (db, who, pid, line, qty, where = 'site') => rpc(db, who, 'stk_leftover', [op(), pid, line, String(qty), where, TODAY, '']);
const move = (db, who, b) => rpc(db, who, 'stk_move', [op(), JSON.stringify({ on: TODAY, ...b, quantity: String(b.quantity) })]);
const count = (db, who, b) => rpc(db, who, 'stk_count', [op(), JSON.stringify({ on: TODAY, ...b, counted: String(b.counted) })]);
const opening = (db, who, b) => rpc(db, who, 'stk_opening', [op(), JSON.stringify({ on: TODAY, ...b, quantity: String(b.quantity) })]);
const decide = (db, who, rec, ok, note = 'ok') => rpc(db, who, 'stk_decide', [op(), rec, ok, note]);
const reverse = (db, who, rec, reason = 'mistake') => rpc(db, who, 'stk_reverse', [op(), rec, reason]);

async function wh(db) { return (await one(db, `select id from stk_locations where owner_id = $1 and kind = 'warehouse'`, [OWNER])).id; }
async function site(db, f) { return (await one(db, `select id from stk_locations where owner_id = $1 and folder_id = $2`, [OWNER, f]))?.id; }
async function bal(db, itemId, where) {
  const loc = where === 'warehouse' ? await wh(db) : await site(db, where);
  if (!loc) return 0;
  return num((await one(db, `select stk_item_balance($1, $2, $3) b`, [OWNER, itemId, loc])).b);
}
async function money(db) {
  return one(db, `select (select count(*) from expenses) n, (select coalesce(sum(amount), 0) from expenses) s,
                         (select count(*) from payroll) pr, (select count(*) from pur_payments) pay`);
}
async function still(db, line) {
  return num((await one(db, `select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0) s
                               from pr_line_portions p where p.line_id = $1`, [line])).s);
}
// A matched, received warehouse lot of `qty` bags of item `it`
// (opts.date: purchased; opts.received: the day it arrived).
async function stocked(db, it, qty, opts = {}) {
  const pid = await warehouseBuy(db, opts.name || 'Cement', qty, { date: opts.date });
  await match(db, OWNER, pid, 1, it, qty);
  await receive(db, opts.receiver || BUYER, pid, 1, qty, opts.received || TODAY);
  return pid;
}
// The day each layer an answer's moves came from was received, with its quantity.
async function layersOf(db, takes) {
  const out = [];
  for (const t of takes) {
    const r = await one(db, `select on_date::text d from stk_records where id = $1`, [t.layer]);
    out.push([r.d, num(t.quantity)]);
  }
  return out;
}

console.log('\n2B-a stock (0096 + 0097 + 0101 + 0102 + 0103 + 0104 on PGlite)');

// ── A. The switch, and who ────────────────────────────────────────────

await test('stock off: every write and read is refused STOCK_OFF, status says off; purchases work as before', async () => {
  const db = await fresh({ on: false });
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 10);
  for (const [fn, args] of [['stk_match', [op(), pid, 1, it, '10', null]], ['stk_receive', [op(), pid, 1, '1', TODAY, '']],
                            ['stk_not_delivered', [op(), pid, 1, '1', 'x']], ['stk_leftover', [op(), pid, 1, '1', 'site', TODAY, '']],
                            ['stk_move', [op(), '{}']], ['stk_count', [op(), '{}']], ['stk_opening', [op(), '{}']],
                            ['stk_reverse', [op(), pid, 'x']], ['stk_decide', [op(), pid, true, 'x']]]) {
    await refused(rpc(db, OWNER, fn, args), 'STOCK_OFF', fn);
  }
  for (const fn of ['stk_overview()', 'stk_choices()']) await refused(db.query(`select ${fn}`), 'STOCK_OFF', fn);
  const status = async (who) => { await as(db, who); const s = (await one(db, `select stk_status() s`)).s;
                                  return [s.enabled, s.can_record, s.is_main_owner, s.is_owner, s.user_id]; };
  eq(await status(STAFF), [false, true, false, false, STAFF]);
  eq(await status(OWNER), [false, true, true, true, OWNER]);
  eq(await status(EXPOWNER), [false, true, false, true, EXPOWNER]);
  eq(await status(WORKER), [false, false, false, false, WORKER]);
});

await test('only the main owner switches stock on or off; each change is an event', async () => {
  const db = await fresh({ on: false });
  for (const who of [STAFF, BUYER, EXPOWNER, PMOWNER, WORKER]) {
    await as(db, who);
    await refused(db.query(`select stk_set_enabled(true)`), 'OWNER_ONLY', who);
  }
  await as(db, OWNER);
  await db.query(`select stk_set_enabled(true)`);
  await db.query(`select stk_set_enabled(true)`);
  await db.query(`select stk_set_enabled(false)`);
  eq((await all(db, `select detail ->> 'enabled' e from stk_events where kind = 'switched' order by id`)).map(r => r.e), ['true', 'false'],
     'a repeat is not a change');
  await as(db, STAFF);
  eq((await one(db, `select stk_status() s`)).s.enabled, false);
});

await test('who records: owner, office staff and Buyer staff — not workers, team leaders, PM-only accounts or another company', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  for (const who of [OWNER, STAFF, BUYER]) {
    const r = await opening(db, who, { item_id: it, at: 'warehouse', quantity: 1 });
    eq(r.status, 'pending', who);
  }
  await refused(opening(db, WORKER, { item_id: it, at: 'warehouse', quantity: 1 }), 'NOT_OFFICE');
  await refused(opening(db, LEADER, { item_id: it, at: 'warehouse', quantity: 1 }), 'NOT_OFFICE');
  await refused(opening(db, PMSTAFF, { item_id: it, at: 'warehouse', quantity: 1 }), 'NOT_ALLOWED');
  await refused(opening(db, PMOWNER, { item_id: it, at: 'warehouse', quantity: 1 }), 'NOT_ALLOWED');
  await refused(opening(db, OTHER, { item_id: it, at: 'warehouse', quantity: 1 }), 'STOCK_OFF', 'their company has stock off');
  await as(db, OTHER); await db.query(`select stk_set_enabled(true)`);
  await refused(opening(db, OTHER, { item_id: it, at: 'warehouse', quantity: 1 }), 'BAD_ITEM', 'another company\'s item');
  await refused(opening(db, OTHER, { item_id: await item(db, 'Sand', 'bag', OTHER), at: f, quantity: 1 }), 'BAD_PROJECT', 'another company\'s project');
  for (const who of [WORKER, LEADER, PMSTAFF]) {
    await as(db, who);
    await refused(db.query(`select stk_overview()`), 'NOT_ALLOWED', who);
    eq((await one(db, `select stk_status() s`)).s.enabled, false, who + ' sees no stock');
  }
});

// ── B. Receiving, matching, not delivered ─────────────────────────────

await test('a warehouse line waits to be matched and received; receipts in parts; awaiting goes down; stock only once matched', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 20);
  await as(db, STAFF);
  let ov = (await one(db, `select stk_overview() o`)).o;
  eq(ov.awaiting.length, 1);
  eq([num(ov.awaiting[0].awaiting), ov.awaiting[0].match, ov.awaiting[0].suggested_item_id], [20, null, it], 'one-click suggestion');
  await receive(db, BUYER, pid, 1, 12);
  eq(await bal(db, it, 'warehouse'), 0, 'received but not matched: not stock yet');
  await match(db, STAFF, pid, 1, it, 20);
  eq(await bal(db, it, 'warehouse'), 12, 'matched: the 12 received are stock');
  await receive(db, STAFF, pid, 1, 5);
  eq(await bal(db, it, 'warehouse'), 17);
  ov = (await one(db, `select stk_overview() o`)).o;
  eq([num(ov.awaiting[0].received), num(ov.awaiting[0].awaiting)], [17, 3]);
  await refused(receive(db, BUYER, pid, 1, 4), 'MORE_THAN_AWAITED');
  await receive(db, BUYER, pid, 1, 3);
  ov = (await one(db, `select stk_overview() o`)).o;
  eq(ov.awaiting.length, 0, 'all received and matched: off the list');
  eq(ov.items.map(i => [i.name, num(i.total)]), [['Cement', 20]]);
});

await test('a different unit: the office says how many item units the line is; partial receipts convert, the whole line is exact', async () => {
  const db = await fresh();
  const pcs = await item(db, 'Tie wire', 'piece');
  const pid = await warehouseBuy(db, 'Tie wire box', 3, { unit: 'box' });
  await refused(match(db, STAFF, pid, 1, pcs, 100), 'REASON_REQUIRED', 'a different unit needs a note');
  await refused(match(db, BUYER, pid, 1, pcs, 100, '3 boxes = 100 pcs'), 'OWN_PURCHASE', 'never by the buyer who bought it');
  await match(db, STAFF, pid, 1, pcs, 100, '3 boxes = 100 pcs');
  await receive(db, BUYER, pid, 1, 1);
  eq(await bal(db, pcs, 'warehouse'), 33.333, '1 of 3 boxes');
  await receive(db, BUYER, pid, 1, 1);
  eq(await bal(db, pcs, 'warehouse'), 66.667, '2 of 3 boxes: from the running total, not 33.333 + 33.333');
  await receive(db, BUYER, pid, 1, 1);
  eq(await bal(db, pcs, 'warehouse'), 100, 'all 3 boxes, one at a time: exactly 100, no rounding drift');
  // The owner may check their own purchase.
  const own = await warehouseBuy(db, 'Tie wire box', 1, { unit: 'box', who: OWNER });
  await match(db, OWNER, own, 1, pcs, 50, '1 box = 50 pcs');
});

await test('three boxes entered separately total exactly 100 pieces — even with their receipt dates out of order, backdated, reversed and received again', async () => {
  const db = await fresh();
  const pcs = await item(db, 'Tie wire', 'piece');
  const pid = await warehouseBuy(db, 'Tie wire box', 3, { unit: 'box' });
  await match(db, STAFF, pid, 1, pcs, 100, '3 boxes = 100 pcs');
  // Each box's own quantity, by receipt; existing ones must never change.
  const layerQty = async () => Object.fromEntries((await all(db,
    `select m.record_id, m.quantity from stk_moves m join stk_records r on r.id = m.record_id
      where r.purchase_id = $1 and r.kind = 'receive' and r.status = 'done' and r.reversed_at is null`, [pid]))
    .map(x => [x.record_id, num(x.quantity)]));
  const b1 = await receive(db, BUYER, pid, 1, 1, phDate(-1));
  eq(await layerQty(), { [b1.record_id]: 33.333 });
  const b2 = await receive(db, BUYER, pid, 1, 1, phDate(-2));        // received BEFORE box 1, entered after
  eq(await layerQty(), { [b1.record_id]: 33.333, [b2.record_id]: 33.334 }, 'box 1 unchanged; box 2 = 66.667 − 33.333');
  const b3 = await receive(db, BUYER, pid, 1, 1, phDate(-3));        // received first of all, entered last
  eq(await layerQty(), { [b1.record_id]: 33.333, [b2.record_id]: 33.334, [b3.record_id]: 33.333 }, 'box 3 = 100 − 66.667');
  eq(await bal(db, pcs, 'warehouse'), 100, 'exactly 100 pieces');
  // Reversed, then received again (backdated further still): back to exactly 100, the others untouched.
  await reverse(db, BUYER, b2.record_id, 'entered twice');
  eq(await bal(db, pcs, 'warehouse'), 66.666, 'two boxes left');
  const b4 = await receive(db, BUYER, pid, 1, 1, phDate(-10));
  eq(await layerQty(), { [b1.record_id]: 33.333, [b3.record_id]: 33.333, [b4.record_id]: 33.334 }, 'box 4 = 100 − 66.666');
  eq(await bal(db, pcs, 'warehouse'), 100, 'exactly 100 again');
  // Received before the match, dates out of order: at the match the whole line is exactly 100 too.
  const late = await warehouseBuy(db, 'Tie wire box', 3, { unit: 'box' });
  for (const d of [-1, -3, -2]) await receive(db, BUYER, late, 1, 1, phDate(d));
  const before = await bal(db, pcs, 'warehouse');
  await match(db, STAFF, late, 1, pcs, 100, '3 boxes = 100 pcs');
  eq(Math.round((await bal(db, pcs, 'warehouse') - before) * 1000) / 1000, 100, 'matched afterwards: exactly 100');
});

await test('the same unit counts one for one; a match can change until stock counts anything under it, then it is fixed', async () => {
  const db = await fresh();
  const a = await item(db, 'Cement');
  const b = await item(db, 'Cement 40kg');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await refused(match(db, STAFF, pid, 1, a, 9), 'BAD_QUANTITY', 'same unit: covers = the line quantity');
  await match(db, STAFF, pid, 1, a, 10);
  await match(db, STAFF, pid, 1, b, 10);
  await match(db, STAFF, pid, 1, a, 10);
  const r = await receive(db, STAFF, pid, 1, 4);
  eq(await bal(db, a, 'warehouse'), 4, 'received under the match: stock');
  await refused(match(db, STAFF, pid, 1, b, 10), 'STOCK_IN_USE', 'goods already counted under it');
  await reverse(db, STAFF, r.record_id, 'wrong item');
  await match(db, STAFF, pid, 1, b, 10);
  await receive(db, STAFF, pid, 1, 10);
  eq([await bal(db, a, 'warehouse'), await bal(db, b, 'warehouse')], [0, 10], 'only the live receipt counts, under the new match');
  await refused(match(db, STAFF, pid, 1, a, 10), 'STOCK_IN_USE');
  eq((await all(db, `select kind from stk_events where purchase_id = $1 and kind = 'matched' order by id`, [pid])).length, 4);
});

await test('a catalogue item\'s kind and unit are fixed once stock uses it — a match is enough, no request needed', async () => {
  const db = await fresh();
  const used = await item(db, 'Cement');
  const pending = await item(db, 'Sand');
  const free = await item(db, 'Gravel');
  const onlyMatched = await item(db, 'Tiles');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await match(db, STAFF, pid, 1, used, 10);
  await opening(db, STAFF, { item_id: pending, at: 'warehouse', quantity: 3 });
  // A project line matched and nothing more: no lot, no stock record — the match alone fixes it.
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pj = await projectBuy(db, f, 'Tiles', 4);
  await match(db, STAFF, pj, 1, onlyMatched, 4);
  eq(num((await one(db, `select count(*) n from stk_lots where item_id = $1`, [onlyMatched])).n), 0, 'no lot yet');
  const save = (id, kind, name, unit) => rpc(db, STAFF, 'pr_office_save_item', [id, kind, name, '', unit, '', true, null, null]);
  for (const id of [used, pending, onlyMatched]) {
    await refused(save(id, 'material', 'x', 'kg'), 'ITEM_IN_USE', 'unit');
    await refused(save(id, 'tool', 'x', 'bag'), 'ITEM_IN_USE', 'kind');
  }
  await save(used, 'material', 'Portland cement', 'bag');
  eq((await one(db, `select name, unit from pr_catalog_items where id = $1`, [used])), { name: 'Portland cement', unit: 'bag' },
     'the name, spec, category and so on stay editable');
  await save(free, 'material', 'Gravel', 'cu m');
  await db.exec(`reset role`);
  await refused(db.query(`update pr_catalog_items set unit = 'kg' where id = $1`, [used]), 'ITEM_IN_USE', 'no path around the save');
  await refused(db.query(`update pr_catalog_items set kind = 'tool' where id = $1`, [pending]), 'ITEM_IN_USE');
  await as(db, STAFF);
  const cat = (await one(db, `select pr_office_catalog() c`)).c;
  eq([used, pending, onlyMatched, free].map(id => cat.find(c => c.id === id).in_use), [true, true, true, false], 'the catalogue form locks the two fields');
  // A request line still locks it too (0092), and an item no longer matched is free again.
  const other = await item(db, 'Wire');
  await match(db, STAFF, pid, 1, other, 10);
  await save(used, 'material', 'Portland cement', 'sack');
});

await test('not delivered: the office closes the rest with a reason; it never silently disappears', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await match(db, STAFF, pid, 1, it, 10);
  await receive(db, BUYER, pid, 1, 6);
  await refused(notDelivered(db, STAFF, pid, 1, 4, ''), 'REASON_REQUIRED');
  await refused(notDelivered(db, STAFF, pid, 1, 5), 'MORE_THAN_AWAITED');
  await notDelivered(db, STAFF, pid, 1, 4);
  await refused(receive(db, BUYER, pid, 1, 1), 'MORE_THAN_AWAITED', 'closed');
  await as(db, STAFF);
  eq((await one(db, `select stk_overview() o`)).o.awaiting.length, 0);
  const rec = (await one(db, `select stk_overview() o`)).o.recent.find(r => r.kind === 'not_delivered');
  eq([num(rec.quantity), rec.reason], [4, 'supplier ran out']);
  eq(await bal(db, it, 'warehouse'), 6);
});

await test('receiving and closing are for warehouse lines of recorded purchases only', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pj = await projectBuy(db, f, 'Cement', 5);
  await refused(receive(db, BUYER, pj, 1, 1), 'NOT_WAREHOUSE');
  await refused(notDelivered(db, STAFF, pj, 1, 1), 'NOT_WAREHOUSE');
  const pid = await warehouseBuy(db, 'Cement', 5);
  await refused(receive(db, BUYER, pid, 2, 1), 'NOT_FOUND');
  await refused(receive(db, BUYER, pid, 1, 0), 'BAD_QUANTITY');
  await refused(receive(db, BUYER, pid, 1, '1.2345'), 'BAD_QUANTITY');
  await refused(receive(db, BUYER, pid, 1, 1, phDate(1)), 'BAD_DATE', 'not tomorrow');
  await as(db, OWNER);
  await db.query(`select pur_void($1, $2, 'wrong')`, [op(), pid]);
  await refused(receive(db, BUYER, pid, 1, 1), 'NOT_FOUND', 'a voided purchase');
});

// ── C. Issuing, requests, returns, moves ──────────────────────────────

await test('an issue fills a request line ("From stock"): Still to buy drops; Bought stays purchases only; the warehouse hint shows', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 20);
  const r = await request(db, f, { item: it, quantity: 10 });
  await as(db, BUYER);
  let l = (await one(db, `select pur_shopping_list(null, null, 'all') l`)).l.find(x => x.line_id === r.line);
  eq([num(l.in_warehouse), l.in_warehouse_unit, num(l.still_to_buy)], [20, 'bag', 10], 'the hint before the issue');
  const res = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 6, request_line_id: r.line });
  eq(res.kind, 'issue');
  eq(await still(db, r.line), 4);
  await as(db, BUYER);
  l = (await one(db, `select pur_shopping_list(null, null, 'all') l`)).l.find(x => x.line_id === r.line);
  eq([num(l.bought), num(l.from_stock), num(l.still_to_buy), num(l.in_warehouse)], [0, 6, 4, 14]);
  eq([num(l.portions[0].bought), num(l.portions[0].from_stock), num(l.portions[0].still_to_buy)], [0, 6, 4]);
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f)], [14, 6]);
  // A purchase afterwards covers only what is still needed (the rest is extra, with a reason).
  await refused(projectBuy(db, f, 'Cement', 5, { requestLine: r.line }), 'EXTRA_REASON_REQUIRED');
  await projectBuy(db, f, 'Cement', 4, { requestLine: r.line });
  eq(await still(db, r.line), 0);
  await as(db, BUYER);
  l = (await one(db, `select pur_shopping_list(null, null, 'all') l`)).l.find(x => x.line_id === r.line);
  eq([num(l.bought), num(l.from_stock), num(l.still_to_buy)], [4, 6, 0]);
});

await test('an issue to a project names a request line or an unplanned reason; the request must fit', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const other = await item(db, 'Sand');
  const f = await folder(db, 'Barlin');
  const g = await folder(db, 'Prado');
  await stocked(db, it, 50);
  const r = await request(db, f, { item: it, quantity: 10 });
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1 }), 'UNPLANNED_REASON_REQUIRED');
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: g, quantity: 1, request_line_id: r.line }), 'BAD_REQUEST_LINK', 'another project\'s request');
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 11, request_line_id: r.line }), 'REQUEST_EXCEEDED');
  const rs = await request(db, f, { item: other, quantity: 10 });
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, request_line_id: rs.line }), 'ITEM_MISMATCH');
  const ru = await request(db, f, { quantity: 10, unit: 'kg' });
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, request_line_id: ru.line }), 'UNIT_MISMATCH');
  await db.exec(`reset role`);
  await db.query(`update pr_lines set status = 'cancelled' where id = $1`, [ru.line]);
  const rn = await request(db, f, { quantity: 10 });   // no catalogue item, same unit: allowed
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 3, request_line_id: rn.line });
  await db.query(`update pr_lines set status = 'cancelled' where id = $1`, [rn.line]);
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, request_line_id: rn.line }), 'LINE_CLOSED');
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 2, unplanned_reason: 'formwork' });
  eq(await bal(db, it, f), 5);
});

await test('picked portions are the only ones filled; without picks the earliest week first', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 50);
  const r = await request(db, f, { item: it, quantity: 4 });
  await db.exec(`reset role`);
  const later = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  const p2 = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 6) returning id`,
    [OWNER, r.line, later])).id;
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 5, request_line_id: r.line });
  eq((await all(db, `select portion_id, quantity from stk_covers order by id`)).map(c => [c.portion_id, num(c.quantity)]),
     [[r.portion, 4], [p2, 1]], 'this week first, then next');
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 2, request_line_id: r.line,
                                  portion_picks: [{ portion_id: r.portion, quantity: '2' }] }), 'REQUEST_EXCEEDED', 'that portion is full');
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 2, request_line_id: r.line,
                          portion_picks: [{ portion_id: p2, quantity: '2' }] });
  eq(await still(db, r.line), 3);
});

await test('lots: oldest received first, across purchases; a named lot is honoured; never more than is there', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  const old = await stocked(db, it, 5, { date: phDate(-3) });
  const neu = await stocked(db, it, 10, { date: phDate(-1) });
  const lotOf = async (pid) => (await one(db, `select id from stk_lots where purchase_id = $1`, [pid])).id;
  const r1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 7, unplanned_reason: 'slab' });
  eq(r1.lots.map(x => [x.lot_id, num(x.quantity)]), [[await lotOf(old), 5], [await lotOf(neu), 2]]);
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x', lot_id: await lotOf(old) }), 'NOT_ENOUGH');
  const r2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 3, unplanned_reason: 'x', lot_id: await lotOf(neu) });
  eq(r2.lots.map(x => num(x.quantity)), [3]);
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 6, unplanned_reason: 'x' }), 'NOT_ENOUGH');
  await refused(move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x',
                                  lot_id: '00000000-0000-0000-0000-000000000001' }), 'BAD_LOT');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f)], [5, 10]);
});

await test('oldest RECEIVED first, by delivery: a late part delivery of an old purchase goes after an earlier delivery of a newer one', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  // A: bought 10 days ago, 5 arrive 8 days ago, the other 5 two days ago.
  const a = await warehouseBuy(db, 'Cement', 10, { date: phDate(-10) });
  await match(db, OWNER, a, 1, it, 10);
  await receive(db, BUYER, a, 1, 5, phDate(-8));
  // B: bought 6 days ago, all 10 arrived 7 days ago — received before it was matched.
  const b = await warehouseBuy(db, 'Cement', 10, { date: phDate(-6) });
  await receive(db, BUYER, b, 1, 10, phDate(-7));
  await match(db, OWNER, b, 1, it, 10);
  await receive(db, BUYER, a, 1, 5, phDate(-2));
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 8, unplanned_reason: 'slab' });
  eq(await layersOf(db, i1.lots), [[phDate(-8), 5], [phDate(-7), 3]], 'A\'s first delivery, then B — never A\'s late delivery');
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 9, unplanned_reason: 'slab' });
  eq(await layersOf(db, i2.lots), [[phDate(-7), 7], [phDate(-2), 2]]);
  // A return brings the same layers back, last moved first.
  const ret = await move(db, STAFF, { item_id: it, returns_record: i2.record_id, quantity: 4 });
  eq(await layersOf(db, ret.lots), [[phDate(-2), 2], [phDate(-7), 2]]);
  // A loss comes off the oldest received layer there.
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 6, reason: 'damaged' });
  await decide(db, OWNER, c.record_id, true);
  const loss = await all(db, `select m.layer, m.quantity from stk_moves m where m.record_id = $1`, [c.record_id]);
  eq(await layersOf(db, loss), [[phDate(-7), 1]]);
  // A delivery entered late but received earliest goes first.
  const e = await warehouseBuy(db, 'Cement', 3);
  await match(db, OWNER, e, 1, it, 3);
  await receive(db, BUYER, e, 1, 3, phDate(-30));
  const i3 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  eq(await layersOf(db, i3.lots), [[phDate(-30), 3], [phDate(-7), 1]]);
  // Naming a lot still picks within it, oldest received first.
  const i4 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x',
                                     lot_id: (await one(db, `select id from stk_lots where purchase_id = $1`, [a])).id });
  eq(await layersOf(db, i4.lots), [[phDate(-2), 1]]);
  // The item's screen lists each layer with the day it was received.
  await as(db, STAFF);
  const one1 = (await one(db, `select stk_item($1) i`, [it])).i;
  eq(one1.lots.flatMap(l => l.layers.filter(y => y.name === 'Warehouse').map(y => [y.received_on, num(y.quantity)])),
     [[phDate(-2), 4]], 'what is left in the warehouse: A\'s late delivery');
  // A receipt is refused reversal once any of THAT delivery moved on — not another's.
  const rB = (await one(db, `select id from stk_records where purchase_id = $1 and kind = 'receive'`, [b])).id;
  await refused(reverse(db, BUYER, rB, 'x'), 'MOVED_ON');
});

await test('a delivery is reversed only while its own goods are still there — not because a later delivery of the same purchase is', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  const pid = await warehouseBuy(db, 'Cement', 10, { date: phDate(-4) });
  await match(db, OWNER, pid, 1, it, 10);
  const first = await receive(db, BUYER, pid, 1, 5, phDate(-3));
  const second = await receive(db, BUYER, pid, 1, 5, phDate(-1));
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 5, unplanned_reason: 'slab' });
  await refused(reverse(db, BUYER, first.record_id, 'x'), 'MOVED_ON', 'the first delivery went to Barlin');
  await reverse(db, BUYER, second.record_id, 'wrong day');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f)], [0, 5]);
});

await test('several issues from one purchase (8 now, 5 next week) and a return of part of one: the same lots come back, the request stays filled', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 20);
  const r = await request(db, f, { item: it, quantity: 13 });
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 8, request_line_id: r.line });
  await move(db, BUYER, { item_id: it, from: 'warehouse', to: f, quantity: 5, request_line_id: r.line });
  eq(await still(db, r.line), 0);
  const ret = await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 3 });
  eq(ret.kind, 'return');
  eq(ret.lots.map(x => x.lot_id), i1.lots.map(x => x.lot_id));
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f)], [10, 10]);
  eq(await still(db, r.line), 0, 'returned unused goods do not reopen the request');
  await refused(move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 6 }), 'MORE_THAN_ISSUED');
  await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 5 });
  await refused(move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 1 }), 'MORE_THAN_ISSUED');
  const ret2 = await move(db, STAFF, { item_id: it, returns_record: ret.record_id, quantity: 1 }).catch(e => e.message);
  assert(String(ret2).includes('BAD_RETURN'), 'a return is not returned');
  await as(db, STAFF);
  const rec = (await one(db, `select stk_overview() o`)).o.recent.find(x => x.id === i1.record_id);
  eq(num(rec.returnable), 0);
});

await test('moves between projects and back to the warehouse; no request needed to the warehouse, and none allowed', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin');
  const aw = await folder(db, 'Barlin AW', { parent: a });
  const b = await folder(db, 'Prado');
  await stocked(db, it, 10);
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 6, unplanned_reason: 'slab' });
  const m = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 2, unplanned_reason: 'Prado ran out' });
  eq(m.kind, 'move');
  const r = await request(db, aw, { project: a, item: it, quantity: 3 });
  await move(db, STAFF, { item_id: it, from: a, to: aw, quantity: 3, request_line_id: r.line });
  eq(await still(db, r.line), 0, 'an Additional Works request filled from Main Contract leftovers');
  await refused(move(db, STAFF, { item_id: it, from: b, to: 'warehouse', quantity: 1, unplanned_reason: 'x' }), 'BAD_REQUEST_LINK');
  await move(db, STAFF, { item_id: it, from: b, to: 'warehouse', quantity: 2 });
  await refused(move(db, STAFF, { item_id: it, from: a, to: a, quantity: 1, unplanned_reason: 'x' }), 'BAD_LOCATION');
  await refused(move(db, STAFF, { item_id: it, from: 'nowhere', to: a, quantity: 1, unplanned_reason: 'x' }), 'BAD_LOCATION');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, a), await bal(db, it, aw), await bal(db, it, b)], [6, 1, 3, 0]);
});

// ── D. Leftovers of project purchases ─────────────────────────────────

await test('leftovers of a project purchase: at its site or brought to the warehouse; the lot keeps the project\'s cost; never more than bought', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { item: it, quantity: 10 });
  const pj = await projectBuy(db, f, 'Cement', 10, { requestLine: r.line });
  await leftover(db, BUYER, pj, 1, 3, 'site');
  await leftover(db, STAFF, pj, 1, 2, 'warehouse');
  await refused(leftover(db, STAFF, pj, 1, 6), 'MORE_THAN_BOUGHT');
  eq([await bal(db, it, f), await bal(db, it, 'warehouse')], [3, 2]);
  const lot = await one(db, `select cost_folder_id, since::text, untraced from stk_lots where purchase_id = $1`, [pj]);
  eq([lot.cost_folder_id, lot.since, lot.untraced], [f, TODAY, false]);
  eq((await one(db, `select auto from stk_matches where purchase_id = $1`, [pj])).auto, true, 'matched by its request\'s catalogue item');
  const un = await projectBuy(db, f, 'Gravel', 4);
  await refused(leftover(db, STAFF, un, 1, 1), 'TO_MATCH', 'an unlisted line is matched first');
  const gravel = await item(db, 'Gravel');
  await match(db, STAFF, un, 1, gravel, 4);
  await leftover(db, STAFF, un, 1, 1);
  // Linked to a request whose catalogue item counts in another unit: never matched automatically (Q5).
  const wire = await item(db, 'Tie wire', 'piece');
  const rw = await request(db, f, { item: wire, unit: 'box', description: 'Tie wire', quantity: 2 });
  const boxes = await projectBuy(db, f, 'Tie wire', 2, { unit: 'box', requestLine: rw.line });
  await refused(leftover(db, STAFF, boxes, 1, 1), 'TO_MATCH', 'a box is not a piece');
  await match(db, STAFF, boxes, 1, wire, 100, '2 boxes = 100 pcs');
  await leftover(db, STAFF, boxes, 1, 30);
  eq(await bal(db, wire, f), 30);
  const whp = await warehouseBuy(db, 'Cement', 2);
  await refused(leftover(db, STAFF, whp, 1, 1), 'NOT_PROJECT');
  await refused(leftover(db, STAFF, pj, 1, 1, 'garage'), 'BAD_LOCATION');
  // The leftovers move on like any stock: issued from the warehouse to another project.
  const g = await folder(db, 'Prado');
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: g, quantity: 2, unplanned_reason: 'Prado' });
  eq(await bal(db, it, g), 2);
});

// ── E. Counts and opening stock ───────────────────────────────────────

await test('a count equal to the books is done at once; a different one waits for the main owner, with a reason', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  await stocked(db, it, 10);
  const same = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 10 });
  eq([same.status, num(same.difference)], ['done', 0]);
  await refused(count(db, STAFF, { item_id: it, at: 'warehouse', counted: 8 }), 'REASON_REQUIRED');
  const short = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 8, reason: 'damaged', note: 'wet bags' });
  eq([short.status, num(short.book), num(short.difference)], ['pending', 10, -2]);
  eq(await bal(db, it, 'warehouse'), 10, 'nothing changes until confirmed');
  await refused(count(db, BUYER, { item_id: it, at: 'warehouse', counted: 9, reason: 'lost' }), 'COUNT_PENDING', 'one open count per item and place');
  for (const who of [STAFF, BUYER, EXPOWNER]) await refused(decide(db, who, short.record_id, true), 'OWNER_ONLY', who);
  await decide(db, OWNER, short.record_id, true, 'checked');
  eq(await bal(db, it, 'warehouse'), 8);
  await refused(decide(db, OWNER, short.record_id, true), 'BAD_STATE', 'decided once');
});

await test('a count is confirmed only while the books read what they read; rejected with a reason; extra goods found become an untraced lot', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const c1 = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 7, reason: 'lost' });
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x' });
  await refused(decide(db, OWNER, c1.record_id, true), 'STALE_COUNT');
  await refused(decide(db, OWNER, c1.record_id, false, ''), 'REASON_REQUIRED');
  await decide(db, OWNER, c1.record_id, false, 'count again');
  const c2 = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 12, reason: 'miscounted' });
  await decide(db, OWNER, c2.record_id, true);
  eq(await bal(db, it, 'warehouse'), 12);
  eq(num((await one(db, `select count(*) n from stk_lots where untraced`)).n), 1);
});

await test('a loss comes off the lots at that place, oldest first', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const old = await stocked(db, it, 3, { date: phDate(-2) });
  await stocked(db, it, 5);
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 4, reason: 'expired' });
  await decide(db, OWNER, c.record_id, true);
  const moves = await all(db, `select lt.purchase_id, m.quantity, m.to_location from stk_moves m join stk_lots lt on lt.id = m.lot_id where m.record_id = $1 order by m.id`, [c.record_id]);
  eq(moves.map(x => [x.purchase_id === old, num(x.quantity), x.to_location]), [[true, 3], [false, 1]].map(x => [...x, null]));
});

await test('opening stock: untraced (₱0 later) or traced to a recorded project line; waits for the main owner; never more than the line brought', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const o1 = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 40, note: 'shelf A' });
  eq(await bal(db, it, 'warehouse'), 0, 'pending');
  await decide(db, OWNER, o1.record_id, true);
  eq(await bal(db, it, 'warehouse'), 40);
  const r = await request(db, f, { item: it, quantity: 10 });
  const pj = await projectBuy(db, f, 'Cement', 10, { requestLine: r.line });
  const o2 = await opening(db, STAFF, { item_id: it, at: f, quantity: 6, purchase_id: pj, line_no: 1 });
  await refused(opening(db, STAFF, { item_id: it, at: f, quantity: 5, purchase_id: pj, line_no: 1 }), 'MORE_THAN_BOUGHT', 'pending counts');
  await refused(leftover(db, STAFF, pj, 1, 5), 'MORE_THAN_BOUGHT', 'leftovers share the same room');
  await decide(db, OWNER, o2.record_id, true);
  eq(await bal(db, it, f), 6);
  eq((await one(db, `select cost_folder_id from stk_lots where purchase_id = $1`, [pj])).cost_folder_id, f, 'traced: the cost stays with its project');
  const whp = await warehouseBuy(db, 'Cement', 2);
  await refused(opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 1, purchase_id: whp, line_no: 1 }), 'NOT_PROJECT');
  const sand = await item(db, 'Sand');
  await refused(opening(db, STAFF, { item_id: sand, at: f, quantity: 1, purchase_id: pj, line_no: 1 }), 'ITEM_MISMATCH');
});

await test('a pending record is withdrawn by whoever recorded it (or the main owner), never by someone else', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const o = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 5 });
  await refused(reverse(db, BUYER, o.record_id), 'NOT_YOURS');
  const w = await reverse(db, STAFF, o.record_id, 'typo');
  eq(w.status, 'withdrawn');
  await refused(decide(db, OWNER, o.record_id, true), 'BAD_STATE');
  const o2 = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 5 });
  eq((await reverse(db, OWNER, o2.record_id, 'not ours')).status, 'withdrawn');
});

// ── F. Reversals ──────────────────────────────────────────────────────

await test('a mistaken issue is reversed (never edited): the goods are back, the request is open again, the record stays', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 10 });
  const i = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, request_line_id: r.line });
  await refused(reverse(db, STAFF, i.record_id, ''), 'REASON_REQUIRED');
  await reverse(db, STAFF, i.record_id, 'wrong project');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f), await still(db, r.line)], [10, 0, 10]);
  const row = await one(db, `select kind, quantity, reversed_at is not null rev, reverse_reason from stk_records where id = $1`, [i.record_id]);
  eq([row.kind, num(row.quantity), row.rev, row.reverse_reason], ['issue', 4, true, 'wrong project']);
  await refused(reverse(db, STAFF, i.record_id), 'BAD_STATE', 'reversed once');
});

await test('reversing is refused while the goods have moved on: an issue with returns, a receipt already issued, leftovers moved', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado');
  const pid = await stocked(db, it, 10);
  const rcpt = (await one(db, `select id from stk_records where kind = 'receive' and purchase_id = $1`, [pid])).id;
  const i = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 6, unplanned_reason: 'slab' });
  const ret = await move(db, STAFF, { item_id: it, returns_record: i.record_id, quantity: 1 });
  await refused(reverse(db, STAFF, i.record_id), 'RETURNS_FIRST');
  await refused(reverse(db, BUYER, rcpt), 'MOVED_ON', 'the received bags were issued');
  await reverse(db, STAFF, ret.record_id);
  await move(db, STAFF, { item_id: it, from: f, to: g, quantity: 6, unplanned_reason: 'x' });
  await refused(reverse(db, STAFF, i.record_id), 'MOVED_ON', 'the issued bags moved on to Prado');
  const r = await request(db, f, { item: it, quantity: 5 });
  const pj = await projectBuy(db, f, 'Cement', 5, { requestLine: r.line });
  const lo = await leftover(db, STAFF, pj, 1, 2);
  await move(db, STAFF, { item_id: it, from: f, to: 'warehouse', quantity: 2 });
  await refused(reverse(db, STAFF, lo.record_id), 'MOVED_ON');
});

await test('who reverses: whoever recorded it or an owner account; a confirmed count or opening stock only the main owner', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const i = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x' });
  await refused(reverse(db, BUYER, i.record_id), 'NOT_YOURS');
  await refused(reverse(db, EXPOWNER, i.record_id), 'STOCK_OFF', 'admin-exp@ is its own company');
  await reverse(db, OWNER, i.record_id);
  const o = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 2 });
  await decide(db, OWNER, o.record_id, true);
  await refused(reverse(db, STAFF, o.record_id), 'NOT_ALLOWED');
  await reverse(db, OWNER, o.record_id);
  eq(await bal(db, it, 'warehouse'), 10);
  const same = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 10 });
  await refused(reverse(db, OWNER, same.record_id), 'BAD_STATE', 'a count that changed nothing has nothing to reverse');
});

// ── G. Purchases with stock (Q21, Q22) ────────────────────────────────

await test('a purchase with stock records cannot be voided or replaced; after reversing them it can', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await receive(db, BUYER, pid, 1, 4);
  await as(db, OWNER);
  await refused(db.query(`select pur_void($1, $2, 'wrong')`, [op(), pid]), 'STOCK_IN_USE');
  const b = body([{ destination: 'warehouse', item_name: 'Cement', quantity: 10, amount: 1000 }]);
  await refused(db.query(`select pur_replace($1, $2, $3::jsonb, 'fix')`, [op(), pid, JSON.stringify(b)]), 'STOCK_IN_USE');
  const rec = (await one(db, `select id from stk_records where purchase_id = $1`, [pid])).id;
  await reverse(db, BUYER, rec, 'wrong line');
  await as(db, OWNER);
  await db.query(`select pur_void($1, $2, 'wrong')`, [op(), pid]);
  eq((await one(db, `select status from purchases where id = $1`, [pid])).status, 'void');
  // A purchase only MATCHED (no goods yet) voids as before.
  const p2 = await warehouseBuy(db, 'Cement', 3);
  await match(db, STAFF, p2, 1, it, 3);
  await as(db, OWNER);
  await db.query(`select pur_void($1, $2, 'wrong')`, [op(), p2]);
});

await test('a correction may not undo stock: not below what was received and closed, nor another unit, destination or project', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pid = await stocked(db, it, 10);
  const fix = async (line) => {
    await as(db, OWNER);
    return db.query(`select pur_correct($1, $2, $3::jsonb, 'fix')`, [op(), pid, JSON.stringify(body([line]))]);
  };
  await refused(fix({ destination: 'warehouse', item_name: 'Cement', quantity: 9, amount: 900 }), 'STOCK_IN_USE');
  await refused(fix({ destination: 'warehouse', item_name: 'Cement', quantity: 10, unit: 'kg', amount: 900 }), 'STOCK_IN_USE');
  await refused(fix({ destination: 'project', folder_id: f, item_name: 'Cement', quantity: 10, amount: 900 }), 'STOCK_IN_USE');
  await fix({ destination: 'warehouse', item_name: 'Portland cement', quantity: 12, amount: 1150 });
  eq(await bal(db, it, 'warehouse'), 10, 'a price, name or larger quantity fix keeps the stock and the match');
  eq((await one(db, `select stk_overview() o`)).o.awaiting.map(a => num(a.awaiting)), [2], '2 more now awaited');
  // A project line's leftovers: not below them, not to another project.
  const g = await folder(db, 'Prado'); await period(db, g);
  const pj = await projectBuy(db, f, 'Cement', 10);
  await match(db, STAFF, pj, 1, it, 10);
  await leftover(db, STAFF, pj, 1, 4);
  const fixPj = async (line) => {
    await as(db, OWNER);
    return db.query(`select pur_correct($1, $2, $3::jsonb, 'fix')`, [op(), pj, JSON.stringify(body([line]))]);
  };
  await refused(fixPj({ folder_id: f, item_name: 'Cement', quantity: 3, amount: 300 }), 'STOCK_IN_USE');
  await refused(fixPj({ folder_id: g, item_name: 'Cement', quantity: 10, amount: 1000 }), 'STOCK_IN_USE');
  await fixPj({ folder_id: f, item_name: 'Cement', quantity: 4, amount: 400 });
});

await test('a matched line whose unit is corrected before any stock record goes back to "To match"', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 10);
  await match(db, STAFF, pid, 1, it, 10);
  await as(db, OWNER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'fix')`, [op(), pid,
    JSON.stringify(body([{ destination: 'warehouse', item_name: 'Cement', quantity: 10, unit: 'sack', amount: 1000 }]))]);
  eq(num((await one(db, `select count(*) n from stk_matches where purchase_id = $1`, [pid])).n), 0);
  eq(num((await one(db, `select count(*) n from stk_lots where purchase_id = $1`, [pid])).n), 0);
  eq((await all(db, `select kind from stk_events where purchase_id = $1 order by id`, [pid])).map(r => r.kind), ['matched', 'unmatched']);
  await as(db, STAFF);
  eq((await one(db, `select stk_overview() o`)).o.awaiting[0].match, null);
});

// ── H. The old tickbox (Q29) ──────────────────────────────────────────

await test('the old "Add to inventory" tickbox works while stock is off, and is refused once it is on (nothing saved)', async () => {
  const db = await fresh({ on: false });
  const f = await folder(db, 'Barlin'); await period(db, f);
  const tick = body([{ folder_id: f, item_name: 'Nails', quantity: 2, amount: 100, in_inventory: true }]);
  await record(db, tick);
  eq(num((await one(db, `select count(*) n from inventory`)).n), 1, 'off: as before');
  await as(db, OWNER); await db.query(`select stk_set_enabled(true)`);
  const before = await money(db);
  await refused(record(db, body([{ folder_id: f, item_name: 'Bolts', quantity: 2, amount: 100, in_inventory: true }])), 'STOCK_TICK_RETIRED');
  eq(await money(db), before, 'nothing saved');
  await as(db, OWNER);
  await refused(db.query(`insert into inventory (owner_id, item_name, current_stock) values ($1, 'x', 1)`, [OWNER]), 'STOCK_TICK_RETIRED');
  await record(db, body([{ folder_id: f, item_name: 'Bolts', quantity: 2, amount: 100 }]));
});

// ── I. Retries, money, balances ───────────────────────────────────────

await test('a retried operation records once and returns the first answer, marked replayed', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const press = op();
  const b = JSON.stringify({ item_id: it, from: 'warehouse', to: f, quantity: '3', on: TODAY, unplanned_reason: 'x' });
  await as(db, STAFF);
  const a1 = (await one(db, `select stk_move($1, $2::jsonb) r`, [press, b])).r;
  const a2 = (await one(db, `select stk_move($1, $2::jsonb) r`, [press, b])).r;
  eq([a2.record_id, a2.replayed], [a1.record_id, true]);
  eq(await bal(db, it, f), 3);
  await as(db, BUYER);
  const a3 = (await one(db, `select stk_move($1, $2::jsonb) r`, [press, b])).r;
  assert(a3.record_id !== a1.record_id && !a3.replayed, 'another person\'s operation is their own');
  const r1 = (await one(db, `select stk_reverse($1, $2, 'x') r`, [press, a3.record_id])).r;
  assert(r1.replayed, 'the same press for a different call answers the first call (never runs again)');
});

await test('no stock action writes a peso: expenses, payroll and payments are untouched through a whole day of stock', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Prado'); await period(db, g);
  const r = await request(db, f, { item: it, quantity: 10 });
  const pj = await projectBuy(db, f, 'Cement', 10, { requestLine: r.line });
  const before = await money(db);
  const pid = await warehouseBuy(db, 'Cement', 20);
  const afterBuy = await money(db);
  eq([afterBuy.n, afterBuy.s], [before.n, before.s], 'a warehouse purchase writes no Spent (2A)');
  await match(db, STAFF, pid, 1, it, 20);
  await receive(db, BUYER, pid, 1, 15);
  await notDelivered(db, STAFF, pid, 1, 5);
  const i = await move(db, STAFF, { item_id: it, from: 'warehouse', to: g, quantity: 6, unplanned_reason: 'x' });
  await move(db, STAFF, { item_id: it, returns_record: i.record_id, quantity: 2 });
  await leftover(db, STAFF, pj, 1, 3);
  await move(db, STAFF, { item_id: it, from: f, to: g, quantity: 3, unplanned_reason: 'x' });
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 10, reason: 'lost' });
  await decide(db, OWNER, c.record_id, true);
  const o = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 4 });
  await decide(db, OWNER, o.record_id, true);
  await reverse(db, OWNER, o.record_id);
  eq(await money(db), afterBuy, 'the same expense rows, sum, payroll and payments');
});

await test('stk_balances agrees with stk_balance for every lot and place, and nothing is ever negative', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pcs = await item(db, 'Tie wire', 'piece');
  const f = await folder(db, 'Barlin');
  const g = await folder(db, 'Prado');
  await stocked(db, it, 10, { date: phDate(-1) });
  await stocked(db, it, 7);
  const tw = await warehouseBuy(db, 'Tie wire box', 3, { unit: 'box' });
  await match(db, STAFF, tw, 1, pcs, 100, '3 boxes = 100');
  await receive(db, BUYER, tw, 1, 2);
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 12, unplanned_reason: 'x' });
  await move(db, STAFF, { item_id: it, from: f, to: g, quantity: 5, unplanned_reason: 'x' });
  await move(db, STAFF, { item_id: pcs, from: 'warehouse', to: g, quantity: 66.667, unplanned_reason: 'x' });
  const rows = await all(db, `select lot_id, location_id, quantity from stk_balances($1)`, [OWNER]);
  for (const x of rows) {
    eq(num((await one(db, `select stk_balance($1, $2) b`, [x.lot_id, x.location_id])).b), num(x.quantity), 'lot ' + x.lot_id);
    assert(num(x.quantity) > 0, 'never negative');
    const layered = await one(db, `select coalesce(sum(quantity), 0) q from stk_layers($1) where lot_id = $2 and location_id = $3`,
                              [OWNER, x.lot_id, x.location_id]);
    eq(num(layered.q), num(x.quantity), 'its layers add up to it');
  }
  eq(num((await one(db, `select count(*) n from stk_layers($1) where quantity < 0`, [OWNER])).n), 0, 'no layer below zero');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, f), await bal(db, it, g), await bal(db, pcs, 'warehouse'), await bal(db, pcs, g)],
     [5, 7, 5, 0, 66.667]);
});

// ── J. Reading ────────────────────────────────────────────────────────

await test('the Stock screen: items by place, waiting for the owner, latest records; one item\'s lots and history; choices', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const done = await folder(db, 'Old job', { completed: true });
  await stocked(db, it, 10);
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 5, reason: 'lost' });
  await as(db, STAFF);
  const ov = (await one(db, `select stk_overview() o`)).o;
  eq(ov.items.map(i => [i.name, i.unit, num(i.total), i.places.map(p => [p.name, num(p.quantity)])]),
     [['Cement', 'bag', 10, [['Warehouse', 6], ['Barlin', 4]]]]);
  eq(ov.pending.map(p => [p.kind, num(p.quantity), num(p.book_quantity), p.recorded_by_name]), [['count', 5, 6, 'Ana']]);
  eq(ov.recent.map(r => r.kind), ['count', 'issue', 'receive']);
  const one1 = (await one(db, `select stk_item($1) i`, [it])).i;
  eq(one1.lots.length, 1);
  eq(one1.lots[0].places.map(p => [p.name, num(p.quantity)]), [['Barlin', 4], ['Warehouse', 6]]);
  eq(one1.records.map(r => r.kind), ['count', 'issue', 'receive']);
  const ch = (await one(db, `select stk_choices() c`)).c;
  eq(ch.items.map(i => i.name), ['Cement']);
  eq(ch.projects.map(p => [p.name, p.completed]), [['Barlin', false], ['Old job', true]], 'completed projects stay pickable for physical records (Q16)');
  const r = await request(db, f, { item: it, quantity: 3 });
  await as(db, STAFF);
  eq((await one(db, `select stk_request_lines($1) x`, [f])).x.map(l => [l.line_id, num(l.still_to_buy)]), [[r.line, 3]]);
  const pj = await projectBuy(db, f, 'Cement', 2, { requestLine: r.line });
  await as(db, STAFF);
  const pl = (await one(db, `select stk_project_lines($1) x`, [f])).x;
  eq(pl.map(l => [l.purchase_id, num(l.quantity), num(l.entered)]), [[pj, 2, 0]]);
  void done;
});

await test('no read carries a peso amount (staff see quantities only)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  const r = await request(db, f, { item: it, quantity: 3 });
  await projectBuy(db, f, 'Cement', 2, { requestLine: r.line });
  await as(db, STAFF);
  const docs = [(await one(db, `select stk_overview() x`)).x, (await one(db, `select stk_item($1) x`, [it])).x,
                (await one(db, `select stk_project_lines($1) x`, [f])).x, (await one(db, `select stk_choices() x`)).x,
                (await one(db, `select stk_request_lines($1) x`, [f])).x];
  const keys = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { keys.add(k); walk(x); }); };
  docs.forEach(walk);
  const money = [...keys].filter(k => /amount|price|cost(?!_folder)|peso|total_amount|gross|value|supplier/.test(k));
  eq(money, [], 'no money keys');
  const text = JSON.stringify(docs);
  assert(!text.includes('Wilcon'), 'no supplier');
});

await test('permissions: authenticated may call the operations and readers only; no table is readable directly', async () => {
  const db = await fresh();
  const callable = ['stk_status()', 'stk_set_enabled(boolean)', 'stk_match(uuid,uuid,integer,uuid,text,text)',
    'stk_receive(uuid,uuid,integer,text,text,text)', 'stk_not_delivered(uuid,uuid,integer,text,text)',
    'stk_leftover(uuid,uuid,integer,text,text,text,text)', 'stk_move(uuid,jsonb)', 'stk_count(uuid,jsonb)', 'stk_opening(uuid,jsonb)',
    'stk_decide(uuid,uuid,boolean,text)', 'stk_reverse(uuid,uuid,text)', 'stk_overview()', 'stk_item(uuid)',
    'stk_project_lines(uuid)', 'stk_choices()', 'stk_request_lines(uuid)', 'pur_shopping_list(uuid,uuid,text)'];
  for (const f of callable) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x,
        (await one(db, `select has_function_privilege('anon', $1, 'execute') x`, [f])).x], [f, true, false]);
  }
  const fns = (await all(db, `select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and (p.proname like 'stk\\_%' or p.proname in
                               ('pr_portion_purchased', 'pr_line_purchased', 'pr_portion_from_stock', 'pr_line_from_stock',
                                'pr_portion_bought', 'pr_line_bought', 'pur_purchase_view'))`)).map(r => r.f.replace(/ /g, ''));
  const internal = fns.filter(f => !callable.includes(f));
  assert(internal.length >= 30, 'internal helpers found: ' + internal.length);
  for (const f of internal) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x], [f, false]);
  }
  for (const t of ['stk_settings', 'stk_locations', 'stk_matches', 'stk_lots', 'stk_records', 'stk_moves', 'stk_covers', 'stk_events']) {
    const r = await one(db, `select relrowsecurity rls, (select count(*) from pg_policies where tablename = $1) n from pg_class where relname = $1`, [t]);
    eq([t, r.rls, num(r.n)], [t, true, 0]);
  }
});

await test('history is append-only: events, moves and covers cannot be changed or deleted', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 3 });
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 3, request_line_id: r.line });
  await db.exec(`reset role`);
  for (const sql of [`update stk_events set reason = 'x'`, `delete from stk_events`, `update stk_moves set quantity = 1`,
                     `delete from stk_moves`, `update stk_covers set quantity = 1`, `delete from stk_covers`]) {
    await refused(db.query(sql), 'HISTORY_IMMUTABLE', sql);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Modify:** `supabase/tests/pr_base.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/pr_base.mjs b/supabase/tests/pr_base.mjs
index dc282e7..cb0f349 100644
--- a/supabase/tests/pr_base.mjs
+++ b/supabase/tests/pr_base.mjs
@@ -15,6 +15,20 @@ export const fnText = (src, name) => {
   return m[0];
 };
 
+// 0085's (and 0090's aliases / brand) catalogue columns that the minimal
+// pr_catalog_items above leaves out — 0104 (stock, and its copy of 0092's
+// catalogue save and list) reads them. Run after prBase, before 0104.
+export const CATALOG_0085 = `
+alter table pr_catalog_items add column if not exists kind text not null default 'material';
+alter table pr_catalog_items add column if not exists spec text not null default '';
+alter table pr_catalog_items add column if not exists unit text not null default 'bag';
+alter table pr_catalog_items add column if not exists category text not null default '';
+alter table pr_catalog_items add column if not exists active boolean not null default true;
+alter table pr_catalog_items add column if not exists updated_at timestamptz not null default now();
+alter table pr_catalog_items add column if not exists aliases text[] not null default '{}';
+alter table pr_catalog_items add column if not exists brand text not null default '';
+`;
+
 export function prBase(ROOT) {
   const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
   const M02 = mig('0002_rls.sql');
```

**Modify:** `tests/purchasing-payments-server.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/purchasing-payments-server.test.js b/tests/purchasing-payments-server.test.js
index ec0944e..96c06b0 100644
--- a/tests/purchasing-payments-server.test.js
+++ b/tests/purchasing-payments-server.test.js
@@ -248,7 +248,8 @@ test('npm run test:sql re-runs the payments suite with 0103; the migrations READ
   const pkg = JSON.parse(read('package.json'));
   ok(/node supabase\/tests\/2a4_payments\.pglite\.mjs && node supabase\/tests\/2a4_payments\.pglite\.mjs --with-0103 &&/.test(pkg.scripts['test:sql']),
     'test:sql runs 2a4_payments with and without 0103');
-  ok(/0103_buyer_return_photo\.sql/.test(read('supabase/migrations/README.md')) && /\*\*0103 /.test(read('supabase/migrations/README.md')), 'README');
+  // (0103's file name left the next-number line when 0104 arrived; its paragraph stays.)
+  ok(/\*\*0103 \(WorkMate Stage 2A-4b/.test(read('supabase/migrations/README.md')), 'README');
   ok(/0103/.test(read('docs/DATABASE_SCHEMA.md')) && /photo_url/.test(read('docs/DATABASE_SCHEMA.md')), 'DATABASE_SCHEMA');
 });
 
```

<!-- Code -->

**Modify:** `CLAUDE.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index b5c9356..2e347a3 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -141,6 +141,14 @@ Profit   = Earned − Spent
   every write carries an operation id so a retry records once. Only `js/cash-advance.js` calls the
   `pm_ca_*` functions (`tests/cash-advance.test.js` fences it). Owner-role only; staff never see it.
   Spec: `docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md`.
+- **Stock (0104, WorkMate 2B-a) is quantities only.** Lots, receipts, issues, returns, leftovers, counts and opening
+  stock never read or write a peso, an `expenses` row or Spent; the value of stock and every cost move are Stage 2C
+  (main owner only). "Bought" in request capacity (`pr_portion_bought`) means **covered** — purchases plus live stock
+  records — so Still to buy is never negative; the shopping list's `bought` stays purchases alone. A stock record is
+  never edited, only reversed with a reason. Goods are issued **oldest received first** — by delivery, never by
+  purchase date. A catalogue item's kind and unit are fixed once a request or stock uses it. Only `js/stock-admin.js`
+  calls the `stk_*` functions. Dormant until the main owner switches it on; then the old "Add to inventory" tick and
+  `inventory` table refuse writes.
 
 Full reasoning: [docs/OVERHEAD_MODULE.md](docs/OVERHEAD_MODULE.md).
 
```

**Modify:** `docs/DATABASE_SCHEMA.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
index c66b566..886c33c 100644
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -953,7 +953,7 @@ Every office write is a `SECURITY DEFINER` RPC that refuses non-office callers (
 | `pr_office_move_portion(portion, batch, note)` | Move an **unarranged** portion to another weekly batch (merges with that batch's unarranged portion) |
 | `pr_office_batches()` / `pr_office_set_batch_dates(batch, purchase, delivery)` | Batches from 35 days ago on (this week + next two always exist); only purchase/delivery dates change. **0086 dropped the direct insert/update policies on `pr_batches` and on the four setup tables (teams, members, catalogue, project settings)** |
 | `pr_office_people/teams/save_team/add_member/remove_member/set_leader` | Teams; a leader must hold the teamLeader role and be a current member |
-| `pr_office_catalog/save_item` | Catalogue; the same name + spec + unit is refused (`DUPLICATE_ITEM`). Since `0092`: once any request line uses an item, a Kind or Unit change is refused (`ITEM_IN_USE` — add a new item, deactivate the old); `pr_office_catalog` returns `in_use` |
+| `pr_office_catalog/save_item` | Catalogue; the same name + spec + unit is refused (`DUPLICATE_ITEM`). Since `0092`: once any request line uses an item, a Kind or Unit change is refused (`ITEM_IN_USE` — add a new item, deactivate the old); `pr_office_catalog` returns `in_use`. Since `0104`: stock counts as use too (a match, a lot or a stock record) |
 | `pr_office_projects/set_allow_requests` | Top-level Project Control projects and the *Allow requests* switch |
 | `pr_folder_request_count(folder)` | Requests on a folder or its children — Dacs Web refuses to delete a project / Additional Works that has any |
 
@@ -1128,6 +1128,44 @@ Every table has RLS on, **no policies** and every privilege revoked: the screens
 | `pettyCash/<company>/<yyyy-mm>/<id>.jpg` (storage, R13) | A return photo. `uploads_can_read` (0097's, plus this branch first): only the main owner and the buyer who uploaded it (`pur_petty_reader`, by the upload ledger); written by buyers of the company; never overwritten. Ledger kind `petty_cash`. Payment proofs stay in `purchases/` |
 | `pur_payment_badges()` | Owner accounts only: `{line or charge id: state}` for Project Control's Unpaid / Partially paid / Paid / Overpaid badge |
 
+## Stock (0104) — WorkMate Stage 2B-a
+
+Quantities only, in catalogue units — **no peso amount anywhere** (the value of stock and every cost move are Stage 2C, main owner). Private tables (RLS on, no policies): reads and writes only through the `stk_*` functions. Dormant until the main owner switches stock on (`stk_set_enabled`); until then every write is `STOCK_OFF`.
+
+| Table | What it holds |
+|---|---|
+| `stk_settings` | `owner_id` (pk), `enabled`, `updated_by`, `updated_at` — the company's stock switch (main owner only) |
+| `stk_locations` | `id`, `owner_id`, `kind` (`warehouse` \| `site`), `folder_id` (history, not a foreign key), `folder_name` — one warehouse per company, one site per project folder (Main Contract or Additional Works), made on first use |
+| `stk_matches` | (`purchase_id`, `line_no`) pk, `item_id` (catalogue item), `line_unit`, `per`, `covers` (`per` line units = `covers` item units), `auto`, `note`, `matched_by`, `matched_at` — how a purchase line counts as stock. Keyed by line number, which a correction keeps |
+| `stk_lots` | `id`, `item_id`, `purchase_id` + `line_no` (unique; null = untraced), `cost_folder_id` (null = company stock; a project = its leftovers), `untraced`, `since` (purchase date, or the day counted — display only) |
+| `stk_records` | `id`, `kind` (`receive`, `not_delivered`, `leftover`, `issue`, `return`, `move`, `count`, `opening`), `status` (`done`, `pending`, `rejected`, `withdrawn`), `item_id`, `purchase_id` + `line_no`, `from_location`, `to_location`, `quantity` (item units; receive / not delivered in the line's unit; a count = counted), `book_quantity` (a count: the books), `lot_id`, `on_date`, `request_line_id`, `unplanned_reason`, `returns_record` (a return: its issue), `reason`, `note`, recorded / decided / reversed by + at + reason. Live = done and not reversed. Never edited |
+| `stk_moves` | `record_id`, `lot_id`, `layer` (the record that brought these goods into stock — a receipt, leftover, opening or count; its `on_date` is the day received), `from_location` (null = enters stock, and then `layer = record_id`), `to_location` (null = leaves stock, a confirmed loss), `quantity` — append-only |
+| `stk_covers` | `record_id`, `request_line_id`, `portion_id`, `quantity` — what goods entering a project filled on a request ("From stock"); append-only |
+| `stk_events` | switched / matched / unmatched / confirmed / rejected / withdrawn / reversed — append-only |
+
+A lot's balance at a place = live moves in − live moves out, kept per **layer** (one per delivery received — a part delivery is its own — leftover record, confirmed opening stock or goods found by a count); never below zero (checked under the item's lock). A matched warehouse line's receipt enters stock as its own layer: the converted total received (the receipts already in stock plus this one) less the item units already assigned to them — a receipt's quantity never changes afterwards, so the whole line adds up exactly whatever the receipt dates or the order they were entered in (3 boxes = 100 pieces: 33.333 + 33.334 + 33.333; a box reversed and received again brings it back to exactly 100). Receipts made before the match enter at the match, in the order received, each with its own received day. Issues, moves and losses take the **oldest received** layer first (`stk_layers`), never by purchase date, unless a lot is named.
+
+| Function | Who | What |
+|---|---|---|
+| `stk_status()` | signed in | `enabled`, `can_record`, `is_main_owner`, `is_owner`, `user_id` |
+| `stk_set_enabled(on)` | main owner | Switch stock on (launch) or off |
+| `stk_match(op, purchase, line, item, covers, note)` | office | Match a line; another unit needs a note and never the buyer's own check; fixed once any of its goods are stock (reverse those receipts to change it) |
+| `stk_receive(op, purchase, line, qty, on, note)` | office (incl. Buyer staff) | A warehouse line arrived, in parts if need be |
+| `stk_not_delivered(op, purchase, line, qty, reason)` | office | The rest will not come (money: supplier refund / credit, 2A-4) |
+| `stk_leftover(op, purchase, line, qty, where, on, note)` | office | Leftovers of a project line, at its site or in the warehouse; never more than it brought |
+| `stk_move(op, body)` | office | Issue (warehouse → project), return (one issue's lots back), move (between sites / to the warehouse); fills a request line or is unplanned with a reason; oldest lot first unless named |
+| `stk_count(op, body)` | office | A count; a difference waits for the main owner with a reason |
+| `stk_opening(op, body)` | office | Opening stock, traced to a project purchase line or untraced; waits for the main owner |
+| `stk_decide(op, record, approve, note)` | main owner | Confirm (a count only while the books still read what was counted) or reject with a reason |
+| `stk_reverse(op, record, reason)` | recorder or an owner account (a confirmed count / opening: the main owner) | Reverse a record, or withdraw a pending one; refused while its goods have moved on |
+| `stk_overview()`, `stk_item(item)`, `stk_project_lines(folder)`, `stk_choices()`, `stk_request_lines(folder)` | office, stock on | The Stock screens' reads — quantities only |
+| `pr_portion_bought` / `pr_line_bought` (redefined) | internal | COVERED = recorded purchases + live stock records; `*_purchased` and `*_from_stock` are the parts |
+| `pur_shopping_list` (redefined) | buyers | `bought` = purchases, plus `from_stock` and `in_warehouse` (a hint, no reservation) |
+
+Guards: `stk_guard_line` (a purchase line may not undo its stock: destination, project, unit, quantity — `STOCK_IN_USE`), `stk_guard_void` (no void or replacement with stock records), `stk_inventory_frozen` (once stock is on, the old `inventory` table refuses writes — `STOCK_TICK_RETIRED`), `stk_item_fixed` (a catalogue item's kind and unit never change once a request line **or stock** uses it — `ITEM_IN_USE`).
+
+Catalogue (0092 extended): `pr_item_in_use(item)` = a request line, a stock match, a lot or any stock record uses it. `pr_office_save_item` refuses a Kind or Unit change of such an item (`ITEM_IN_USE`), and `pr_office_catalog`'s `in_use` counts stock too, so the Catalogue form locks the two fields.
+
 ## PM profit sharing (0098)
 
 An internal owner/partner allocation per PM project - **outside the money model** (never a payout, invoice or accounting entry). Spec `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`; plan `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`. `project_id` is a `construction_projects.id` (never a `folders.id`). The three tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`: nothing reads or writes them directly. Read through `pm_sharing_read` (owner-role accounts of the company); write through `pm_set_sharing` (main owner only).
```

**Modify:** `package.json` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/package.json b/package.json
index 8b4cd0c..4788c99 100644
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**Create:** `supabase/migrations/0104_stock.sql`

```sql
-- 0104 — WorkMate Stage 2B-a: stock on the server (quantities only).
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- (Warehouse cost assignment, §3.8); answers:
-- docs/superpowers/specs/2026-10-24-workmate-stage2bc-questions.md (all A);
-- plan: docs/superpowers/plans/2026-10-25-workmate-stage2b-a-stock.md.
--
-- ── 1. Where stock is (Q2). One company warehouse, and each Project
--    Control project's site (Main Contract or an Additional Works job) as a
--    place where goods can sit. Places are made the first time they are used.
--
-- ── 2. What is stock (Q3–Q5, Q9). Stock is counted in a CATALOGUE item's
--    unit, in LOTS: one lot per purchase line it came from (so every later
--    peso traces back to one receipt — Q12, priced in 2C), or an untraced
--    lot for old goods with no purchase in the system (Q13, worth ₱0 in 2C).
--    A purchase line becomes stock only once it is MATCHED to a catalogue
--    item: automatically when it is linked to a request line whose catalogue
--    item has the same unit, otherwise by the office ("To match"), which
--    says how many item units the line is (a different unit is the
--    office's check, never the buyer's own). Warehouse purchases are stock;
--    project purchases are taken as used by their project and become stock
--    only as recorded LEFTOVERS, whose lot keeps that project's cost.
--    Once stock uses a catalogue item (a match, a lot or a record), its kind
--    and unit are fixed, as 0092 fixes them once a request uses it — every
--    quantity already counted would otherwise change meaning.
--
-- ── 3. Receiving (Q6–Q7). A warehouse line is usable stock only as it is
--    received, in parts if need be; the rest is "Awaiting delivery" until
--    received or closed as NOT DELIVERED with a reason. Receipts are kept in
--    the purchase line's own unit and turned into item units by its match
--    (each new receipt = the converted total received less the item units
--    already assigned; a receipt's quantity never changes afterwards — so the
--    whole line adds up exactly, whatever the dates or the order of entry).
--
-- ── 4. Movements (Q8, Q10, Q11). Every action is one stk_records row; its
--    quantity effect is stk_moves rows. Goods are kept in LAYERS: each
--    delivery received (a part delivery is its own), each leftover record,
--    each confirmed opening stock and goods found by a count is one layer,
--    dated the day it entered stock; a layer travels with its goods. An
--    issue, a move or a loss takes the OLDEST RECEIVED layers first — never
--    by purchase date — unless staff names the lot the goods came from; the
--    lot is FIXED when the goods move (Q12). Issue = warehouse →
--    a project's site; return = back to the warehouse from one issue (the
--    same lots and layers); move = between sites, or a site's goods to the warehouse.
--    Goods entering a project fill a request line ("From stock") or are
--    unplanned with a reason. No reservations (Q9): only an issue counts.
--
-- ── 5. Requests. "Bought" in every capacity formula (pr_portion_bought,
--    pr_line_bought) now means COVERED: by recorded purchases and by live
--    stock records. So Still to buy, splitting, assigning and reducing a
--    request all count goods issued from stock, and Still to buy is never
--    negative. pr_portion_purchased / pr_line_purchased keep the purchases
--    alone (shown as "Bought"); *_from_stock the stock part.
--
-- ── 6. Counts and opening stock (Q13, Q27). A count that differs from the
--    books, and every opening count, wait for the MAIN OWNER. A count is
--    confirmed only while the books still read what they read when counted.
--
-- ── 7. Never edited (Q23). A mistaken record is REVERSED (reason kept,
--    never deleted); reversing is refused while the goods have moved on
--    (reverse those records first). A purchase line correction may not go
--    below what was received / entered as stock, nor change the unit,
--    destination or project of a line with stock (Q21); a purchase with live
--    stock records cannot be voided or replaced (Q22).
--
-- ── 8. Quantities only. No peso amount is read or written here: the value
--    of a lot and every cost move are Stage 2C (owner-confirmed). Nothing
--    here touches expenses, Spent, Earned or Profit.
--
-- ── 9. Dormant until launch. Every write is refused (STOCK_OFF) until the
--    main owner switches stock on for the company (2B + 2C launch together,
--    Q1). Once it is on, the old "Add to inventory" tickbox and the old
--    inventory table refuse writes (Q29).
--
-- Who: owner and office staff accounts allowed the Expenses section record
-- stock (Buyer staff are office staff); workers and team leaders never do.
-- Only the main owner switches stock on, confirms counts and opening stock,
-- and reverses them. Each call carries an operation id (pur_ops): a retry
-- returns the first answer. Locks: the purchase first, then items and
-- request lines in one sorted pass (pur_lock) — the same order as purchases.

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- The switch, one row per company that ever had it (main owner only).
create table if not exists stk_settings (
  owner_id uuid primary key references profiles(id),
  enabled boolean not null default false,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

-- folder_id is history, not a foreign key (as purchase_lines.folder_id):
-- folder_name keeps what the project was called.
create table if not exists stk_locations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('warehouse', 'site')),
  folder_id uuid,
  folder_name text not null default '',
  created_at timestamptz not null default now(),
  check ((kind = 'site') = (folder_id is not null))
);
create unique index if not exists stk_locations_warehouse on stk_locations (owner_id) where kind = 'warehouse';
create unique index if not exists stk_locations_site on stk_locations (owner_id, folder_id) where kind = 'site';

-- How a purchase line counts as a catalogue item: `per` line units are
-- `covers` item units. Keyed by purchase and line number, which a
-- correction keeps (its lines are stored again with the same numbers).
create table if not exists stk_matches (
  purchase_id uuid not null references purchases(id),
  line_no int not null,
  owner_id uuid not null references profiles(id),
  item_id uuid not null references pr_catalog_items(id),
  line_unit text not null,
  per numeric(14,3) not null check (per > 0),
  covers numeric(14,3) not null check (covers > 0),
  auto boolean not null default false,
  note text not null default '' check (char_length(note) <= 300),
  matched_by uuid references profiles(id),
  matched_at timestamptz not null default now(),
  primary key (purchase_id, line_no)
);

-- A lot: the goods of one purchase line, or untraced old goods.
-- cost_folder_id: whose cost the goods are — null = the company's stock,
-- else that project's (leftovers). 2C moves cost; 2B-a never changes it.
create table if not exists stk_lots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  item_id uuid not null references pr_catalog_items(id),
  purchase_id uuid references purchases(id),
  line_no int,
  cost_folder_id uuid,
  untraced boolean not null default false,
  since date not null,                     -- purchase date (or the day counted), for display; issuing is by layer
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (purchase_id, line_no),
  check ((purchase_id is null) = (line_no is null)),
  check (untraced = (purchase_id is null)),
  check (not untraced or cost_folder_id is null)
);
create index if not exists stk_lots_item on stk_lots (owner_id, item_id);

-- One action. quantity: item units — except receive / not_delivered, in the
-- purchase line's unit; for a count, the quantity counted (book_quantity =
-- what the books said). Live = status 'done' and not reversed.
create table if not exists stk_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('receive', 'not_delivered', 'leftover', 'issue', 'return', 'move', 'count', 'opening')),
  status text not null default 'done' check (status in ('done', 'pending', 'rejected', 'withdrawn')),
  item_id uuid references pr_catalog_items(id),
  purchase_id uuid references purchases(id),
  line_no int,
  from_location uuid references stk_locations(id),
  to_location uuid references stk_locations(id),
  quantity numeric(14,3) not null check (quantity >= 0),
  book_quantity numeric(14,3),
  lot_id uuid references stk_lots(id),
  on_date date not null,
  request_line_id uuid references pr_lines(id),
  unplanned_reason text not null default '' check (char_length(unplanned_reason) <= 300),
  returns_record uuid references stk_records(id),
  reason text not null default '' check (char_length(reason) <= 500),
  note text not null default '' check (char_length(note) <= 300),
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default now(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  reversed_by uuid references profiles(id),
  reversed_at timestamptz,
  reverse_reason text not null default '' check (char_length(reverse_reason) <= 500),
  check ((purchase_id is null) = (line_no is null)),
  check (kind not in ('receive', 'not_delivered', 'leftover') or purchase_id is not null),
  check (kind in ('receive', 'not_delivered') or item_id is not null),
  check (kind <> 'return' or returns_record is not null),
  check (reversed_at is null or status = 'done')
);
create index if not exists stk_records_owner on stk_records (owner_id, recorded_at desc);
create index if not exists stk_records_line on stk_records (purchase_id, line_no) where purchase_id is not null;
create index if not exists stk_records_item on stk_records (item_id, recorded_at desc) where item_id is not null;
create index if not exists stk_records_returns on stk_records (returns_record) where returns_record is not null;

-- The quantity a record moved, per lot and layer. from null = enters stock
-- (its layer is its own record: the receipt, leftover, opening or count);
-- to null = leaves stock (a confirmed loss). layer = the record that brought
-- these goods into stock — its on_date is the day they were received.
create table if not exists stk_moves (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  record_id uuid not null references stk_records(id),
  lot_id uuid not null references stk_lots(id),
  layer uuid not null references stk_records(id),
  from_location uuid references stk_locations(id),
  to_location uuid references stk_locations(id),
  quantity numeric(14,3) not null check (quantity > 0),
  check (from_location is not null or to_location is not null),
  check (from_location is distinct from to_location),
  check (from_location is not null or layer = record_id)
);
create index if not exists stk_moves_record on stk_moves (record_id);
create index if not exists stk_moves_lot on stk_moves (lot_id, layer);

-- What goods entering a project filled on a request line ("From stock").
-- They count while their record is live; a portion the office later removes
-- keeps the request line, so the line's figures stay right.
create table if not exists stk_covers (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  record_id uuid not null references stk_records(id),
  request_line_id uuid not null references pr_lines(id),
  portion_id uuid references pr_line_portions(id) on delete set null,
  quantity numeric(14,3) not null check (quantity > 0)
);
create index if not exists stk_covers_portion on stk_covers (portion_id) where portion_id is not null;
create index if not exists stk_covers_request_line on stk_covers (request_line_id);
create index if not exists stk_covers_record on stk_covers (record_id);

-- Append-only: the switch, matches, decisions and reversals.
create table if not exists stk_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('switched', 'matched', 'unmatched', 'confirmed', 'rejected', 'withdrawn', 'reversed')),
  record_id uuid references stk_records(id),
  purchase_id uuid references purchases(id),
  line_no int,
  detail jsonb not null default '{}'::jsonb,
  reason text not null default '',
  actor_id uuid not null references profiles(id),
  at timestamptz not null default now()
);

create or replace function stk_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists stk_events_no_change on stk_events;
create trigger stk_events_no_change before update or delete on stk_events
  for each row execute function stk_events_immutable();
drop trigger if exists stk_moves_no_change on stk_moves;
create trigger stk_moves_no_change before update or delete on stk_moves
  for each row execute function stk_events_immutable();
drop trigger if exists stk_covers_no_change on stk_covers;
create trigger stk_covers_no_change before update or delete on stk_covers
  for each row execute function stk_events_immutable();

-- Every read and write goes through the functions below: no table policy.
alter table stk_settings enable row level security;
alter table stk_locations enable row level security;
alter table stk_matches enable row level security;
alter table stk_lots enable row level security;
alter table stk_records enable row level security;
alter table stk_moves enable row level security;
alter table stk_covers enable row level security;
alter table stk_events enable row level security;

-- ════ 2. Who, and the switch ═════════════════════════════════════════

create or replace function stk_on(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.enabled from stk_settings s where s.owner_id = p_owner), false)
$$;

-- May the caller record stock? An active owner or staff account allowed
-- the Expenses section (0096's rule for ordinary entry). A boolean about the
-- caller only.
create or replace function stk_can_record() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and pr_is_office() and coalesce((
    select jsonb_typeof(p.allowed_modules) is distinct from 'array'
           or jsonb_array_length(p.allowed_modules) = 0 or p.allowed_modules ? 'expenses'
      from profiles p where p.id = auth.uid()), false)
$$;

-- The caller's company, for a stock write: refused unless they may record
-- and stock is switched on there.
create or replace function stk_actor() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  if not stk_on(v_owner) then
    raise exception 'STOCK_OFF' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

-- What the screens need to know.
create or replace function stk_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_can boolean := stk_can_record();
begin
  return jsonb_build_object('enabled', v_can and stk_on(data_owner_id()), 'can_record', v_can,
                            'is_main_owner', pur_is_main_owner(),
                            'is_owner', auth.uid() is not null and coalesce(is_owner(), false), 'user_id', auth.uid());
end;
$$;

-- The main owner switches stock on (launch) or off for the company.
create or replace function stk_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  if p_on is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  insert into stk_settings (owner_id, enabled, updated_by, updated_at) values (v_owner, p_on, auth.uid(), now())
  on conflict (owner_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where stk_settings.enabled is distinct from excluded.enabled;
  if found then
    insert into stk_events (owner_id, kind, detail, actor_id) values (v_owner, 'switched', jsonb_build_object('enabled', p_on), auth.uid());
  end if;
  return jsonb_build_object('enabled', p_on);
end;
$$;

-- ════ 3. Places, lines, lots and balances ════════════════════════════

create or replace function stk_warehouse(p_owner uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from stk_locations where owner_id = p_owner and kind = 'warehouse';
  if v is null then
    insert into stk_locations (owner_id, kind) values (p_owner, 'warehouse')
    on conflict do nothing;
    select id into v from stk_locations where owner_id = p_owner and kind = 'warehouse';
  end if;
  return v;
end;
$$;

-- A project's site: a folder of this company (Main Contract or an
-- Additional Works job).
create or replace function stk_site(p_owner uuid, p_folder uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  v_name text;
begin
  select f.name into v_name from folders f where f.id = p_folder and f.owner_id = p_owner;
  if v_name is null then
    raise exception 'BAD_PROJECT' using errcode = 'P0001';
  end if;
  select id into v from stk_locations where owner_id = p_owner and kind = 'site' and folder_id = p_folder;
  if v is null then
    insert into stk_locations (owner_id, kind, folder_id, folder_name) values (p_owner, 'site', p_folder, v_name)
    on conflict do nothing;
    select id into v from stk_locations where owner_id = p_owner and kind = 'site' and folder_id = p_folder;
  end if;
  return v;
end;
$$;

-- A place from request text: 'warehouse', or a project folder's id.
create or replace function stk_place(p_owner uuid, p text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p), '') = 'warehouse' then
    return stk_warehouse(p_owner);
  end if;
  if pur_uuid(p) is null then
    raise exception 'BAD_LOCATION' using errcode = 'P0001';
  end if;
  return stk_site(p_owner, pur_uuid(p));
end;
$$;

-- A line of a RECORDED purchase of this company.
create or replace function stk_line(p_owner uuid, p_purchase uuid, p_line_no int) returns purchase_lines
language plpgsql stable security definer set search_path = public as $$
declare v purchase_lines;
begin
  select l.* into v from purchase_lines l join purchases pu on pu.id = l.purchase_id
   where l.purchase_id = p_purchase and l.line_no = p_line_no and pu.owner_id = p_owner and pu.status = 'recorded';
  if v.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- An active catalogue item of this company.
create or replace function stk_item_ok(p_owner uuid, p_item uuid) returns pr_catalog_items
language plpgsql stable security definer set search_path = public as $$
declare v pr_catalog_items;
begin
  select * into v from pr_catalog_items where id = p_item and owner_id = p_owner;
  if v.id is null then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- The same, for a write: the item's row is held (FOR SHARE) until the end of
-- the transaction, so its kind and unit cannot change under a stock write
-- (a catalogue save waits, then finds the item in use — ITEM_IN_USE).
create or replace function stk_item_lock(p_owner uuid, p_item uuid) returns pr_catalog_items
language plpgsql security definer set search_path = public as $$
declare v pr_catalog_items;
begin
  select * into v from pr_catalog_items where id = p_item and owner_id = p_owner for share;
  if v.id is null then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Received / closed as not delivered, in the line's own unit (live records).
create or replace function stk_received(p_purchase uuid, p_line_no int, p_kind text default 'receive') returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.quantity), 0) from stk_records r
   where r.purchase_id = p_purchase and r.line_no = p_line_no and r.kind = p_kind
     and r.status = 'done' and r.reversed_at is null
$$;

-- Line units → item units, by the line's match (null = not matched).
create or replace function stk_conv(p_purchase uuid, p_line_no int, p_qty numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select round(p_qty * m.covers / m.per, 3) from stk_matches m where m.purchase_id = p_purchase and m.line_no = p_line_no
$$;

-- The match a line gets without the office: linked to a request line whose
-- catalogue item has the line's own unit, and not a substitute — one line
-- unit is one item unit.
create or replace function stk_auto_item(p_line purchase_lines) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from pr_lines rl join pr_catalog_items c on c.id = rl.catalog_item_id
   where rl.id = p_line.request_line_id and not p_line.substitute
     and lower(btrim(c.unit)) = lower(btrim(p_line.unit))
$$;

-- The line's match, made automatically when it can be; else TO_MATCH.
create or replace function stk_ensure_match(p_line purchase_lines) returns stk_matches
language plpgsql security definer set search_path = public as $$
declare
  v stk_matches;
  v_item uuid;
begin
  select * into v from stk_matches where purchase_id = p_line.purchase_id and line_no = p_line.line_no;
  if v.purchase_id is not null then
    return v;
  end if;
  v_item := stk_auto_item(p_line);
  if v_item is not null then
    -- Hold the item, then check its unit again as it stands now.
    perform 1 from pr_catalog_items where id = v_item for share;
    v_item := stk_auto_item(p_line);
  end if;
  if v_item is null then
    raise exception 'TO_MATCH' using errcode = 'P0001',
      hint = 'Match this purchase line to a catalogue item first (office).';
  end if;
  insert into stk_matches (purchase_id, line_no, owner_id, item_id, line_unit, per, covers, auto, matched_by)
  values (p_line.purchase_id, p_line.line_no, p_line.owner_id, v_item, lower(btrim(p_line.unit)), 1, 1, true, auth.uid())
  returning * into v;
  insert into stk_events (owner_id, kind, purchase_id, line_no, detail, actor_id)
  values (p_line.owner_id, 'matched', p_line.purchase_id, p_line.line_no,
          jsonb_build_object('item_id', v_item, 'per', 1, 'covers', 1, 'auto', true), auth.uid());
  return v;
end;
$$;

-- The lot of a purchase line (made on first use; needs its match).
create or replace function stk_lot_for_line(p_line purchase_lines) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  m stk_matches := stk_ensure_match(p_line);
begin
  select id into v from stk_lots where purchase_id = p_line.purchase_id and line_no = p_line.line_no;
  if v is null then
    insert into stk_lots (owner_id, item_id, purchase_id, line_no, cost_folder_id, since, created_by)
    values (p_line.owner_id, m.item_id, p_line.purchase_id, p_line.line_no,
            case when p_line.destination = 'project' then p_line.folder_id end,
            (select purchase_date from purchases where id = p_line.purchase_id), auth.uid())
    returning id into v;
  end if;
  return v;
end;
$$;

-- The line's lot if it is matched, or can be automatically; else null.
create or replace function stk_try_lot(p_line purchase_lines) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from stk_matches where purchase_id = p_line.purchase_id and line_no = p_line.line_no)
     and stk_auto_item(p_line) is null then
    return null;
  end if;
  return stk_lot_for_line(p_line);
end;
$$;

-- A warehouse line's live receipts become stock, one layer each, once it
-- has a lot. A receipt already in stock keeps its quantity, always. Each new
-- one gets the converted total received (the receipts already in stock plus
-- this one, in line units) MINUS the item units already assigned to them —
-- whatever the receipt dates and whatever order they were entered in, so the
-- whole line adds up exactly (3 boxes = 100 pieces: 33.333, 33.334, 33.333),
-- and a reversed-then-received-again box brings it back to exactly 100.
-- Receipts made before the match are taken in the order received. The caller
-- holds the purchase's lock.
create or replace function stk_receipt_moves(p_line purchase_lines, p_lot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_received numeric;   -- line units of the live receipts already in stock
  v_assigned numeric;   -- the item units those receipts were given
  v_q numeric;
begin
  select coalesce(sum(x.quantity), 0), coalesce(sum(m.q), 0) into v_received, v_assigned
    from stk_records x
    join (select record_id, sum(quantity) as q from stk_moves group by record_id) m on m.record_id = x.id
   where x.purchase_id = p_line.purchase_id and x.line_no = p_line.line_no and x.kind = 'receive'
     and x.status = 'done' and x.reversed_at is null;
  for r in select x.* from stk_records x
            where x.purchase_id = p_line.purchase_id and x.line_no = p_line.line_no and x.kind = 'receive'
              and x.status = 'done' and x.reversed_at is null
              and not exists (select 1 from stk_moves m where m.record_id = x.id)
            order by x.on_date, x.recorded_at, x.id
  loop
    v_received := v_received + r.quantity;
    v_q := stk_conv(p_line.purchase_id, p_line.line_no, v_received) - v_assigned;
    continue when v_q is null or v_q <= 0;
    insert into stk_moves (owner_id, record_id, lot_id, layer, to_location, quantity)
    values (p_line.owner_id, r.id, p_lot, r.id, r.to_location, v_q);
    v_assigned := v_assigned + v_q;
  end loop;
end;
$$;

-- What a lot holds at a place: every live move in, minus every live move out.
create or replace function stk_balance(p_lot uuid, p_loc uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when m.to_location = p_loc then m.quantity else -m.quantity end), 0)
    from stk_moves m join stk_records r on r.id = m.record_id
   where m.lot_id = p_lot and (m.to_location = p_loc or m.from_location = p_loc)
     and r.status = 'done' and r.reversed_at is null
$$;

-- What one layer of a lot holds at a place.
create or replace function stk_layer_balance(p_lot uuid, p_layer uuid, p_loc uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when m.to_location = p_loc then m.quantity else -m.quantity end), 0)
    from stk_moves m join stk_records r on r.id = m.record_id
   where m.lot_id = p_lot and m.layer = p_layer and (m.to_location = p_loc or m.from_location = p_loc)
     and r.status = 'done' and r.reversed_at is null
$$;

-- Every non-zero layer of a company (optionally one item), with the day its
-- goods were received: lot, layer, received_on / received_at, place, quantity.
create or replace function stk_layers(p_owner uuid, p_item uuid default null)
returns table (lot_id uuid, layer uuid, received_on date, received_at timestamptz, location_id uuid, quantity numeric)
language sql stable security definer set search_path = public as $$
  select x.lot_id, x.layer, lr.on_date, lr.recorded_at, x.location_id, sum(x.q)
    from (select m.lot_id, m.layer, m.to_location as location_id, m.quantity as q
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.to_location is not null and r.status = 'done' and r.reversed_at is null
          union all
          select m.lot_id, m.layer, m.from_location, -m.quantity
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.from_location is not null and r.status = 'done' and r.reversed_at is null) x
    join stk_lots lt on lt.id = x.lot_id
    join stk_records lr on lr.id = x.layer
   where p_item is null or lt.item_id = p_item
   group by x.lot_id, x.layer, lr.on_date, lr.recorded_at, x.location_id
  having sum(x.q) <> 0
$$;

-- Every non-zero balance of a company: lot, item, place, quantity.
create or replace function stk_balances(p_owner uuid) returns table (lot_id uuid, item_id uuid, location_id uuid, quantity numeric)
language sql stable security definer set search_path = public as $$
  select x.lot_id, lt.item_id, x.location_id, sum(x.q)
    from (select m.lot_id, m.to_location as location_id, m.quantity as q
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.to_location is not null and r.status = 'done' and r.reversed_at is null
          union all
          select m.lot_id, m.from_location, -m.quantity
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.from_location is not null and r.status = 'done' and r.reversed_at is null) x
    join stk_lots lt on lt.id = x.lot_id
   group by x.lot_id, lt.item_id, x.location_id
  having sum(x.q) <> 0
$$;

create or replace function stk_item_balance(p_owner uuid, p_item uuid, p_loc uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(stk_balance(lt.id, p_loc)), 0) from stk_lots lt where lt.owner_id = p_owner and lt.item_id = p_item
$$;

-- Item units that entered stock from a PROJECT line as leftovers or traced
-- opening stock (pending openings included, so two can never exceed it).
create or replace function stk_line_in(p_purchase uuid, p_line_no int) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.quantity), 0) from stk_records r
   where r.purchase_id = p_purchase and r.line_no = p_line_no and r.kind in ('leftover', 'opening')
     and r.status in ('done', 'pending') and r.reversed_at is null
$$;

-- Take p_qty of an item from a place: layer by layer, the OLDEST RECEIVED
-- first (the day the goods entered stock — a late part delivery of an old
-- purchase goes after an earlier delivery of a newer one), within the lot
-- named if any. Returns [{lot_id, layer, quantity}]. The caller holds the
-- item's lock.
create or replace function stk_take(p_owner uuid, p_item uuid, p_from uuid, p_qty numeric, p_lot uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_left numeric := p_qty;
  v_take numeric;
  v_out jsonb := '[]'::jsonb;
begin
  for v in select l.lot_id, l.layer, l.quantity as bal from stk_layers(p_owner, p_item) l
            where l.location_id = p_from and l.quantity > 0 and (p_lot is null or l.lot_id = p_lot)
            order by l.received_on, l.received_at, l.layer
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v.bal);
    v_out := v_out || jsonb_build_object('lot_id', v.lot_id, 'layer', v.layer, 'quantity', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'NOT_ENOUGH' using errcode = 'P0001',
      hint = 'Only ' || (p_qty - v_left) || ' there.';
  end if;
  return v_out;
end;
$$;

create or replace function stk_lock_items(p_items uuid[], p_extra text[] default '{}') returns void
language sql security definer set search_path = public as $$
  select pur_lock(coalesce((select array_agg('stk_item:' || i) from unnest(p_items) i where i is not null), '{}') || coalesce(p_extra, '{}'))
$$;

-- Every layer a record touched still holds a quantity of zero or more where
-- the record put goods (after a reversal).
create or replace function stk_check_record(p_record uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  for v in select distinct m.lot_id, m.layer, m.to_location from stk_moves m where m.record_id = p_record and m.to_location is not null loop
    if stk_layer_balance(v.lot_id, v.layer, v.to_location) < 0 then
      raise exception 'MOVED_ON' using errcode = 'P0001',
        hint = 'Those goods have moved on. Reverse the later records first.';
    end if;
  end loop;
end;
$$;

-- ════ 4. Requests: covered = purchases + stock ═══════════════════════

-- 0097's figures, by recorded purchases alone (shown as "Bought").
create or replace function pr_portion_purchased(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0)
    from purchase_line_covers c
    join purchase_lines l on l.id = c.line_id
    join purchases pu on pu.id = l.purchase_id
   where c.portion_id = p_portion and pu.status = 'recorded'
$$;

create or replace function pr_line_purchased(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0)
    from purchase_line_covers c
    join purchase_lines l on l.id = c.line_id
    join purchases pu on pu.id = l.purchase_id
   where c.request_line_id = p_line and pu.status = 'recorded'
$$;

-- From stock: live stock records only.
create or replace function pr_portion_from_stock(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0) from stk_covers c join stk_records r on r.id = c.record_id
   where c.portion_id = p_portion and r.status = 'done' and r.reversed_at is null
$$;

create or replace function pr_line_from_stock(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0) from stk_covers c join stk_records r on r.id = c.record_id
   where c.request_line_id = p_line and r.status = 'done' and r.reversed_at is null
$$;

-- COVERED, for every capacity formula of 0097 (Still to buy, splitting,
-- assigning, reducing): recorded purchases plus live stock records.
create or replace function pr_portion_bought(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select pr_portion_purchased(p_portion) + pr_portion_from_stock(p_portion)
$$;

create or replace function pr_line_bought(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select pr_line_purchased(p_line) + pr_line_from_stock(p_line)
$$;

-- Fill a request line from goods entering a project (record p_record, item
-- p_item, p_qty item units, at project p_folder). Picked portions are the
-- ONLY ones filled, each up to its pick; without picks the earliest batch
-- first. Each portion takes at most its Still to buy, and the whole
-- quantity must fit (the rest is a separate, unplanned record). The caller
-- holds the 'pr_line:' lock.
create or replace function stk_cover(p_owner uuid, p_record uuid, p_folder uuid, p_line uuid, p_item uuid, p_qty numeric, p_picks jsonb)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
  v_item pr_catalog_items;
  v_pick jsonb;
  v_p record;
  v_left numeric := p_qty;
  v_take numeric;
  v_cap numeric;
begin
  select ln.id, ln.unit, ln.catalog_item_id, ln.status as line_status, r.status as request_status, r.work_folder_id
    into v_req
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line and ln.owner_id = p_owner for update of ln;
  if v_req.id is null or v_req.work_folder_id <> p_folder then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  if v_req.line_status <> 'open' or v_req.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into v_item from pr_catalog_items where id = p_item;
  if v_req.catalog_item_id is not null and v_req.catalog_item_id <> p_item then
    raise exception 'ITEM_MISMATCH' using errcode = 'P0001';
  end if;
  if lower(btrim(v_req.unit)) <> lower(btrim(v_item.unit)) then
    raise exception 'UNIT_MISMATCH' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_picks, '[]'::jsonb)) <> 'array' then
    raise exception 'BAD_PORTION' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_picks, '[]'::jsonb)) > 0 then
    for v_pick in select value from jsonb_array_elements(p_picks) loop
      if pur_uuid(v_pick ->> 'portion_id') is null or pur_qty(v_pick ->> 'quantity') is null or pur_qty(v_pick ->> 'quantity') <= 0 then
        raise exception 'BAD_PORTION' using errcode = 'P0001';
      end if;
      select * into v_p from pr_line_portions where id = pur_uuid(v_pick ->> 'portion_id') and line_id = p_line for update;
      if v_p.id is null then
        raise exception 'BAD_PORTION' using errcode = 'P0001';
      end if;
      v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
      v_take := pur_qty(v_pick ->> 'quantity');
      if v_take > v_cap or v_take > v_left then
        raise exception 'REQUEST_EXCEEDED' using errcode = 'P0001', hint = 'Still to buy there: ' || v_cap || '.';
      end if;
      insert into stk_covers (owner_id, record_id, request_line_id, portion_id, quantity)
      values (p_owner, p_record, p_line, v_p.id, v_take);
      v_left := v_left - v_take;
    end loop;
  else
    for v_p in select p.* from pr_line_portions p join pr_batches b on b.id = p.batch_id
                where p.line_id = p_line order by b.cutoff_at, p.created_at, p.id for update of p
    loop
      exit when v_left <= 0;
      v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
      v_take := least(v_left, v_cap);
      continue when v_take <= 0;
      insert into stk_covers (owner_id, record_id, request_line_id, portion_id, quantity)
      values (p_owner, p_record, p_line, v_p.id, v_take);
      v_left := v_left - v_take;
    end loop;
  end if;
  if v_left > 0 then
    raise exception 'REQUEST_EXCEEDED' using errcode = 'P0001',
      hint = 'Still to buy: ' || (p_qty - v_left) || '. Record the rest separately, unplanned, with a reason.';
  end if;
  return p_qty;
end;
$$;

-- ════ 5. Guards on purchases and the old inventory ═══════════════════

-- A stored purchase line (recorded, corrected, checked) may not undo its
-- stock: destination, project and unit stay while it has stock records, and
-- its quantity covers what was received and closed (warehouse) or entered
-- as stock (project). A changed unit with no stock records drops the match.
create or replace function stk_guard_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m stk_matches;
  v_wh boolean;
  v_pj boolean;
  v_lot stk_lots;
begin
  select * into m from stk_matches where purchase_id = new.purchase_id and line_no = new.line_no;
  v_wh := exists (select 1 from stk_records r where r.purchase_id = new.purchase_id and r.line_no = new.line_no
                     and r.kind in ('receive', 'not_delivered') and r.status = 'done' and r.reversed_at is null);
  v_pj := exists (select 1 from stk_records r where r.purchase_id = new.purchase_id and r.line_no = new.line_no
                     and r.kind in ('leftover', 'opening') and r.status in ('done', 'pending') and r.reversed_at is null);
  if m.purchase_id is null and not v_wh and not v_pj then
    return null;
  end if;
  select * into v_lot from stk_lots where purchase_id = new.purchase_id and line_no = new.line_no;
  if (v_wh and new.destination <> 'warehouse')
     or (v_pj and (new.destination <> 'project' or new.folder_id is distinct from v_lot.cost_folder_id))
     or ((v_wh or v_pj) and m.purchase_id is not null and lower(btrim(new.unit)) <> m.line_unit)
     or (v_wh and new.quantity < stk_received(new.purchase_id, new.line_no) + stk_received(new.purchase_id, new.line_no, 'not_delivered'))
     or (v_pj and round(new.quantity * m.covers / m.per, 3) < stk_line_in(new.purchase_id, new.line_no)) then
    raise exception 'STOCK_IN_USE' using errcode = 'P0001',
      hint = 'Line ' || new.line_no || ' has stock records. Reverse them first, or keep the line''s destination, project, unit and enough quantity.';
  end if;
  if m.purchase_id is not null and not v_wh and not v_pj
     and (lower(btrim(new.unit)) <> m.line_unit or (v_lot.id is not null and new.destination = 'project' and new.folder_id is distinct from v_lot.cost_folder_id)
          or (v_lot.id is not null and new.destination = 'warehouse' and v_lot.cost_folder_id is not null)) then
    if exists (select 1 from stk_moves x where x.lot_id = v_lot.id) then
      raise exception 'STOCK_IN_USE' using errcode = 'P0001';
    end if;
    delete from stk_matches where purchase_id = new.purchase_id and line_no = new.line_no;
    if v_lot.id is not null then
      delete from stk_lots where id = v_lot.id;
    end if;
    insert into stk_events (owner_id, kind, purchase_id, line_no, detail, reason, actor_id)
    values (new.owner_id, 'unmatched', new.purchase_id, new.line_no, jsonb_build_object('item_id', m.item_id),
            'The purchase line changed', coalesce(auth.uid(), new.owner_id));
  end if;
  return null;
end;
$$;
drop trigger if exists stk_guard_line on purchase_lines;
create trigger stk_guard_line after insert or update of destination, folder_id, unit, quantity on purchase_lines
  for each row execute function stk_guard_line();

-- A purchase with live (or pending) stock records is never voided — nor
-- replaced, nor voided by an approved change request (they all void it).
create or replace function stk_guard_void() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'recorded' and new.status = 'void'
     and exists (select 1 from stk_records r where r.purchase_id = old.id
                    and r.status in ('done', 'pending') and r.reversed_at is null) then
    raise exception 'STOCK_IN_USE' using errcode = 'P0001',
      hint = 'This purchase has stock records. Reverse them first.';
  end if;
  return new;
end;
$$;
drop trigger if exists stk_guard_void on purchases;
create trigger stk_guard_void before update of status on purchases
  for each row execute function stk_guard_void();

-- One stock path (Q29): once stock is on, the old "Add to inventory"
-- tickbox (pur_move_stock) and the old Inventory screen write nothing.
create or replace function stk_inventory_frozen() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := coalesce(case when tg_op = 'DELETE' then old.owner_id else new.owner_id end, data_owner_id());
begin
  if stk_on(v_owner) then
    raise exception 'STOCK_TICK_RETIRED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists stk_inventory_frozen on inventory;
create trigger stk_inventory_frozen before insert or update or delete on inventory
  for each row execute function stk_inventory_frozen();

-- An item is IN USE once a request line or stock uses it (0092 counted
-- request lines; "when Stage 2 adds stock tables, extend the in-use test").
-- A match, a lot or any stock record — live, waiting or reversed: history.
create or replace function pr_item_in_use(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pr_lines l where l.catalog_item_id = p_item)
      or exists (select 1 from stk_matches m where m.item_id = p_item)
      or exists (select 1 from stk_lots lt where lt.item_id = p_item)
      or exists (select 1 from stk_records r where r.item_id = p_item)
$$;

-- The last word on it: no path changes the kind or unit of an item in use.
create or replace function stk_item_fixed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.kind is distinct from old.kind or new.unit is distinct from old.unit) and pr_item_in_use(old.id) then
    raise exception 'ITEM_IN_USE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists stk_item_fixed on pr_catalog_items;
create trigger stk_item_fixed before update of kind, unit on pr_catalog_items
  for each row execute function stk_item_fixed();

-- 0092's save, its in-use test extended to stock (pr_item_in_use).
create or replace function pr_office_save_item(p_item uuid, p_kind text, p_name text, p_spec text, p_unit text,
                                               p_category text, p_active boolean,
                                               p_aliases text[] default null, p_brand text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
  v_aliases text[] := case when p_aliases is null then null else pr_clean_aliases(p_aliases) end;
  v_kind text;
  v_unit text;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('material', 'tool')
     or btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_unit, '')) = '' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  if (v_aliases is not null and (cardinality(v_aliases) > 20
        or exists (select 1 from unnest(v_aliases) a where length(a) > 60)))
     or length(btrim(coalesce(p_brand, ''))) > 80 then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  begin
    if p_item is null then
      insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, active, aliases, brand)
      values (data_owner_id(), p_kind, btrim(p_name), btrim(coalesce(p_spec, '')), btrim(p_unit),
              btrim(coalesce(p_category, '')), coalesce(p_active, true), coalesce(v_aliases, '{}'::text[]),
              btrim(coalesce(p_brand, '')))
      returning id into v_id;
    else
      select owner_id into v_owner from pr_catalog_items where id = p_item;
      if v_owner is null or not can_access(v_owner) then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
      -- 0092: Kind and Unit are fixed once a request line uses the item.
      -- 0104: or stock (a match, a lot or a stock record).
      select kind, unit into v_kind, v_unit from pr_catalog_items where id = p_item for update;
      if (p_kind <> v_kind or btrim(p_unit) <> v_unit)
         and pr_item_in_use(p_item) then
        raise exception 'ITEM_IN_USE' using errcode = 'P0001';
      end if;
      update pr_catalog_items
         set kind = p_kind, name = btrim(p_name), spec = btrim(coalesce(p_spec, '')), unit = btrim(p_unit),
             category = btrim(coalesce(p_category, '')), active = coalesce(p_active, active),
             aliases = coalesce(v_aliases, aliases), brand = coalesce(btrim(p_brand), brand), updated_at = now()
       where id = p_item
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_ITEM' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id);
end;
$$;

-- 0092's catalogue list: `in_use` counts stock too, so Dacs Web locks Kind
-- and Unit before Save.
create or replace function pr_office_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
           'brand', c.brand, 'aliases', to_jsonb(c.aliases),
           'in_use', pr_item_in_use(c.id),
           'category', c.category, 'active', c.active)
         order by c.active desc, c.kind, lower(c.name), lower(c.spec)), '[]'::jsonb)
    from pr_catalog_items c
   where pr_is_office() and c.owner_id = data_owner_id()
$$;

-- ════ 6. The operations ══════════════════════════════════════════════

-- Match a purchase line to a catalogue item: p_covers = how many item units
-- the WHOLE line is (its quantity, for the same unit). A different unit
-- needs a note and is never checked by whoever recorded or bought it (the
-- owner may). A line already moving as stock is not re-matched.
create or replace function stk_match(p_op uuid, p_purchase uuid, p_line_no int, p_item uuid, p_covers text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_line purchase_lines;
  v_item pr_catalog_items;
  v_old stk_matches;
  v_lot stk_lots;
  v_covers numeric := pur_qty(p_covers);
  v_same boolean;
  pu purchases;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_purchase_lock(p_purchase);
  v_line := stk_line(v_owner, p_purchase, p_line_no);
  select * into v_old from stk_matches where purchase_id = p_purchase and line_no = p_line_no;
  perform stk_lock_items(array[p_item, v_old.item_id]);
  v_item := stk_item_lock(v_owner, p_item);
  if not v_item.active then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  v_same := lower(btrim(v_line.unit)) = lower(btrim(v_item.unit));
  if v_covers is null or v_covers <= 0 or v_covers > 1000000 or (v_same and v_covers <> v_line.quantity) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if not v_same then
    perform pur_reason(p_note);
    select * into pu from purchases where id = p_purchase;
    if not is_owner() and auth.uid() in (pu.recorded_by, coalesce(pu.bought_by, pu.recorded_by)) then
      raise exception 'OWN_PURCHASE' using errcode = 'P0001';
    end if;
  end if;
  select * into v_lot from stk_lots where purchase_id = p_purchase and line_no = p_line_no;
  -- Fixed once any of its goods are stock (received under it, left over, …).
  if v_lot.id is not null and exists (select 1 from stk_moves m join stk_records r on r.id = m.record_id
                                       where m.lot_id = v_lot.id and r.status = 'done' and r.reversed_at is null) then
    raise exception 'STOCK_IN_USE' using errcode = 'P0001';
  end if;
  if exists (select 1 from stk_records r where r.purchase_id = p_purchase and r.line_no = p_line_no
                and r.kind = 'opening' and r.status = 'pending') then
    raise exception 'STOCK_IN_USE' using errcode = 'P0001';
  end if;
  insert into stk_matches (purchase_id, line_no, owner_id, item_id, line_unit, per, covers, auto, note, matched_by, matched_at)
  values (p_purchase, p_line_no, v_owner, p_item, lower(btrim(v_line.unit)), v_line.quantity, v_covers, false,
          pur_note(p_note), auth.uid(), now())
  on conflict (purchase_id, line_no) do update
    set item_id = excluded.item_id, line_unit = excluded.line_unit, per = excluded.per, covers = excluded.covers,
        auto = false, note = excluded.note, matched_by = excluded.matched_by, matched_at = excluded.matched_at;
  if v_lot.id is not null then
    update stk_lots set item_id = p_item where id = v_lot.id;
  elsif v_line.destination = 'warehouse' then
    perform stk_lot_for_line(v_line);
  end if;
  -- What was received before the match is stock now, one layer per receipt.
  if v_line.destination = 'warehouse' then
    perform stk_receipt_moves(v_line, (select id from stk_lots where purchase_id = p_purchase and line_no = p_line_no));
  end if;
  insert into stk_events (owner_id, kind, purchase_id, line_no, detail, reason, actor_id)
  values (v_owner, 'matched', p_purchase, p_line_no,
          jsonb_build_object('item_id', p_item, 'per', v_line.quantity, 'covers', v_covers, 'before', to_jsonb(v_old)),
          pur_note(p_note), auth.uid());
  v_result := jsonb_build_object('purchase_id', p_purchase, 'line', p_line_no, 'item_id', p_item, 'covers', v_covers);
  return pur_op_done(v_owner, p_op, 'stk_match', v_result);
end;
$$;

-- Goods of a warehouse line arrived (part or all), in the line's own unit.
create or replace function stk_receive(p_op uuid, p_purchase uuid, p_line_no int, p_qty text, p_on text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_line purchase_lines;
  v_qty numeric := pur_qty(p_qty);
  v_lot uuid;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_purchase_lock(p_purchase);
  v_line := stk_line(v_owner, p_purchase, p_line_no);
  if v_line.destination <> 'warehouse' then
    raise exception 'NOT_WAREHOUSE' using errcode = 'P0001';
  end if;
  if v_qty is null or v_qty <= 0 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if v_qty > v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered') then
    raise exception 'MORE_THAN_AWAITED' using errcode = 'P0001',
      hint = 'Awaiting: ' || (v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered')) || '.';
  end if;
  insert into stk_records (owner_id, kind, purchase_id, line_no, to_location, quantity, on_date, note, recorded_by)
  values (v_owner, 'receive', p_purchase, p_line_no, stk_warehouse(v_owner), v_qty, pur_past_day(p_on), pur_note(p_note), auth.uid())
  returning id into v_id;
  -- A matched line's receipt is stock at once: its own layer, dated as received.
  v_lot := stk_try_lot(v_line);
  if v_lot is not null then
    perform stk_receipt_moves(v_line, v_lot);
  end if;
  v_result := jsonb_build_object('record_id', v_id, 'received', stk_received(p_purchase, p_line_no),
                                 'awaiting', v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered'));
  return pur_op_done(v_owner, p_op, 'stk_receive', v_result);
end;
$$;

-- The rest of a warehouse line will never come: closed with a reason (the
-- money goes through the supplier refund or credit of 2A-4).
create or replace function stk_not_delivered(p_op uuid, p_purchase uuid, p_line_no int, p_qty text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_line purchase_lines;
  v_qty numeric := pur_qty(p_qty);
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_purchase_lock(p_purchase);
  v_line := stk_line(v_owner, p_purchase, p_line_no);
  if v_line.destination <> 'warehouse' then
    raise exception 'NOT_WAREHOUSE' using errcode = 'P0001';
  end if;
  if v_qty is null or v_qty <= 0
     or v_qty > v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered') then
    raise exception 'MORE_THAN_AWAITED' using errcode = 'P0001';
  end if;
  insert into stk_records (owner_id, kind, purchase_id, line_no, quantity, on_date, reason, recorded_by)
  values (v_owner, 'not_delivered', p_purchase, p_line_no, v_qty, pur_manila_today(), pur_reason(p_reason), auth.uid())
  returning id into v_id;
  v_result := jsonb_build_object('record_id', v_id,
                                 'awaiting', v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered'));
  return pur_op_done(v_owner, p_op, 'stk_not_delivered', v_result);
end;
$$;

-- Leftovers of a PROJECT purchase line: at its project's site, or brought
-- to the warehouse. Item units; never more than the line brought. The cost
-- stays with the project (the lot's cost_folder_id).
create or replace function stk_leftover(p_op uuid, p_purchase uuid, p_line_no int, p_qty text, p_where text, p_on text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_line purchase_lines;
  m stk_matches;
  v_qty numeric := pur_qty(p_qty);
  v_lot uuid;
  v_to uuid;
  v_room numeric;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_purchase_lock(p_purchase);
  v_line := stk_line(v_owner, p_purchase, p_line_no);
  if v_line.destination <> 'project' then
    raise exception 'NOT_PROJECT' using errcode = 'P0001';
  end if;
  if coalesce(p_where, '') not in ('site', 'warehouse') then
    raise exception 'BAD_LOCATION' using errcode = 'P0001';
  end if;
  m := stk_ensure_match(v_line);
  perform stk_lock_items(array[m.item_id]);
  if v_qty is null or v_qty <= 0 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  v_room := stk_conv(p_purchase, p_line_no, v_line.quantity) - stk_line_in(p_purchase, p_line_no);
  if v_qty > v_room then
    raise exception 'MORE_THAN_BOUGHT' using errcode = 'P0001', hint = 'At most ' || greatest(v_room, 0) || ' more.';
  end if;
  v_lot := stk_lot_for_line(v_line);
  v_to := case when p_where = 'site' then stk_site(v_owner, v_line.folder_id) else stk_warehouse(v_owner) end;
  insert into stk_records (owner_id, kind, item_id, purchase_id, line_no, to_location, quantity, lot_id, on_date, note, recorded_by)
  values (v_owner, 'leftover', m.item_id, p_purchase, p_line_no, v_to, v_qty, v_lot, pur_past_day(p_on), pur_note(p_note), auth.uid())
  returning id into v_id;
  insert into stk_moves (owner_id, record_id, lot_id, layer, to_location, quantity) values (v_owner, v_id, v_lot, v_id, v_to, v_qty);
  v_result := jsonb_build_object('record_id', v_id, 'lot_id', v_lot, 'item_id', m.item_id);
  return pur_op_done(v_owner, p_op, 'stk_leftover', v_result);
end;
$$;

-- Move goods. p_body: item_id, from / to ('warehouse' or a project folder's
-- id), quantity (item units), on (the day the goods arrived), lot_id
-- (optional: the lot the goods actually came from), returns_record (a
-- return: the issue being returned — its lots, back to the warehouse),
-- request_line_id + portion_picks, or unplanned_reason, when the goods go
-- to a project; note. Warehouse → project = an issue.
create or replace function stk_move(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_item uuid := pur_uuid(p_body ->> 'item_id');
  v_qty numeric := pur_qty(p_body ->> 'quantity');
  v_lot uuid := pur_uuid(p_body ->> 'lot_id');
  v_ret uuid := pur_uuid(p_body ->> 'returns_record');
  v_req uuid := pur_uuid(p_body ->> 'request_line_id');
  v_issue stk_records;
  v_from uuid;
  v_to uuid;
  v_to_loc stk_locations;
  v_kind text;
  v_takes jsonb;
  v_t jsonb;
  v_left numeric;
  v_m record;
  v_can numeric;
  v_id uuid;
  v_unplanned text := btrim(coalesce(p_body ->> 'unplanned_reason', ''));
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if coalesce(btrim(p_body ->> 'request_line_id'), '') <> '' and v_req is null then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  perform stk_lock_items(array[v_item], case when v_req is null then '{}'::text[] else array['pr_line:' || v_req] end);
  perform stk_item_lock(v_owner, v_item);
  if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if v_ret is not null then
    select * into v_issue from stk_records where id = v_ret and owner_id = v_owner;
    if v_issue.id is null or v_issue.kind <> 'issue' or v_issue.status <> 'done' or v_issue.reversed_at is not null
       or v_issue.item_id <> v_item then
      raise exception 'BAD_RETURN' using errcode = 'P0001';
    end if;
    v_from := v_issue.to_location;
    v_to := v_issue.from_location;
    v_kind := 'return';
  else
    v_from := stk_place(v_owner, p_body ->> 'from');
    v_to := stk_place(v_owner, p_body ->> 'to');
    if v_from = v_to then
      raise exception 'BAD_LOCATION' using errcode = 'P0001';
    end if;
    v_kind := case when v_from = stk_warehouse(v_owner) then 'issue' else 'move' end;
  end if;
  select * into v_to_loc from stk_locations where id = v_to;
  if v_to_loc.kind = 'site' then
    if v_req is null and char_length(v_unplanned) not between 1 and 300 then
      raise exception 'UNPLANNED_REASON_REQUIRED' using errcode = 'P0001';
    end if;
  elsif v_req is not null or v_unplanned <> '' then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  if v_lot is not null and not exists (select 1 from stk_lots where id = v_lot and owner_id = v_owner and item_id = v_item) then
    raise exception 'BAD_LOT' using errcode = 'P0001';
  end if;

  if v_kind = 'return' then
    -- The issue's own lots and layers, the last moved first, each up to
    -- what this issue moved and has not had back, and to what is still there.
    v_takes := '[]'::jsonb;
    v_left := v_qty;
    for v_m in select m.lot_id, m.layer, sum(m.quantity) as qty, max(m.id) as last_id from stk_moves m
                where m.record_id = v_issue.id and (v_lot is null or m.lot_id = v_lot)
                group by m.lot_id, m.layer order by max(m.id) desc
    loop
      exit when v_left <= 0;
      v_can := v_m.qty - coalesce((select sum(x.quantity) from stk_moves x join stk_records r on r.id = x.record_id
                                    where r.returns_record = v_issue.id and r.status = 'done' and r.reversed_at is null
                                      and x.lot_id = v_m.lot_id and x.layer = v_m.layer), 0);
      v_can := least(v_can, stk_layer_balance(v_m.lot_id, v_m.layer, v_from));
      continue when v_can <= 0;
      v_takes := v_takes || jsonb_build_object('lot_id', v_m.lot_id, 'layer', v_m.layer, 'quantity', least(v_left, v_can));
      v_left := v_left - least(v_left, v_can);
    end loop;
    if v_left > 0 then
      raise exception 'MORE_THAN_ISSUED' using errcode = 'P0001',
        hint = 'At most ' || (v_qty - v_left) || ' of that issue can come back.';
    end if;
  else
    v_takes := stk_take(v_owner, v_item, v_from, v_qty, v_lot);
  end if;

  insert into stk_records (owner_id, kind, item_id, from_location, to_location, quantity, lot_id, on_date,
                           request_line_id, unplanned_reason, returns_record, note, recorded_by)
  values (v_owner, v_kind, v_item, v_from, v_to, v_qty, v_lot, pur_past_day(p_body ->> 'on'),
          v_req, case when v_req is null then v_unplanned else '' end, v_ret, pur_note(p_body ->> 'note'), auth.uid())
  returning id into v_id;
  for v_t in select value from jsonb_array_elements(v_takes) loop
    insert into stk_moves (owner_id, record_id, lot_id, layer, from_location, to_location, quantity)
    values (v_owner, v_id, (v_t ->> 'lot_id')::uuid, (v_t ->> 'layer')::uuid, v_from, v_to, (v_t ->> 'quantity')::numeric);
  end loop;
  if v_req is not null then
    perform stk_cover(v_owner, v_id, v_to_loc.folder_id, v_req, v_item, v_qty, p_body -> 'portion_picks');
  end if;
  v_result := jsonb_build_object('record_id', v_id, 'kind', v_kind, 'lots', v_takes);
  return pur_op_done(v_owner, p_op, 'stk_move', v_result);
end;
$$;

-- A count of one item at one place. Equal to the books: done. Different:
-- an adjustment waiting for the main owner, with a reason (lost, damaged,
-- expired, miscounted, other). p_body: item_id, at, counted, on, reason, note.
create or replace function stk_count(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_item uuid := pur_uuid(p_body ->> 'item_id');
  v_counted numeric := pur_qty(p_body ->> 'counted');
  v_at uuid;
  v_book numeric;
  v_reason text := btrim(coalesce(p_body ->> 'reason', ''));
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform stk_lock_items(array[v_item]);
  perform stk_item_lock(v_owner, v_item);
  v_at := stk_place(v_owner, p_body ->> 'at');
  if v_counted is null or v_counted > 1000000 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  v_book := stk_item_balance(v_owner, v_item, v_at);
  if v_counted <> v_book and v_reason not in ('lost', 'damaged', 'expired', 'miscounted', 'other') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from stk_records r where r.owner_id = v_owner and r.kind = 'count' and r.status = 'pending'
                and r.item_id = v_item and r.to_location = v_at) then
    raise exception 'COUNT_PENDING' using errcode = 'P0001';
  end if;
  insert into stk_records (owner_id, kind, status, item_id, to_location, quantity, book_quantity, on_date, reason, note, recorded_by)
  values (v_owner, 'count', case when v_counted = v_book then 'done' else 'pending' end, v_item, v_at, v_counted, v_book,
          pur_past_day(p_body ->> 'on'), case when v_counted = v_book then '' else v_reason end, pur_note(p_body ->> 'note'), auth.uid())
  returning id into v_id;
  v_result := jsonb_build_object('record_id', v_id, 'book', v_book, 'counted', v_counted, 'difference', v_counted - v_book,
                                 'status', case when v_counted = v_book then 'done' else 'pending' end);
  return pur_op_done(v_owner, p_op, 'stk_count', v_result);
end;
$$;

-- Goods already there on launch day, per place (waits for the main owner).
-- Traceable to a recorded PROJECT purchase line → that line's lot (its cost
-- stays with its project); otherwise an untraced lot. p_body: item_id, at,
-- quantity, on, purchase_id + line_no (optional), note.
create or replace function stk_opening(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_item uuid := pur_uuid(p_body ->> 'item_id');
  v_qty numeric := pur_qty(p_body ->> 'quantity');
  v_purchase uuid := pur_uuid(p_body ->> 'purchase_id');
  v_line_no int;
  v_line purchase_lines;
  m stk_matches;
  v_at uuid;
  v_lot uuid;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if coalesce(btrim(p_body ->> 'purchase_id'), '') <> '' then
    if v_purchase is null or coalesce(p_body ->> 'line_no', '') !~ '^\d{1,2}$' then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    v_line_no := (p_body ->> 'line_no')::int;
    perform pur_purchase_lock(v_purchase);
  end if;
  perform stk_lock_items(array[v_item]);
  perform stk_item_lock(v_owner, v_item);
  v_at := stk_place(v_owner, p_body ->> 'at');
  if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if v_purchase is not null then
    v_line := stk_line(v_owner, v_purchase, v_line_no);
    if v_line.destination <> 'project' then
      raise exception 'NOT_PROJECT' using errcode = 'P0001',
        hint = 'A warehouse purchase becomes stock by being received.';
    end if;
    m := stk_ensure_match(v_line);
    if m.item_id <> v_item then
      raise exception 'ITEM_MISMATCH' using errcode = 'P0001';
    end if;
    if v_qty > stk_conv(v_purchase, v_line_no, v_line.quantity) - stk_line_in(v_purchase, v_line_no) then
      raise exception 'MORE_THAN_BOUGHT' using errcode = 'P0001';
    end if;
    v_lot := stk_lot_for_line(v_line);
  end if;
  insert into stk_records (owner_id, kind, status, item_id, purchase_id, line_no, to_location, quantity, lot_id, on_date, note, recorded_by)
  values (v_owner, 'opening', 'pending', v_item, v_purchase, v_line_no, v_at, v_qty, v_lot, pur_past_day(p_body ->> 'on'),
          pur_note(p_body ->> 'note'), auth.uid())
  returning id into v_id;
  v_result := jsonb_build_object('record_id', v_id, 'status', 'pending');
  return pur_op_done(v_owner, p_op, 'stk_opening', v_result);
end;
$$;

-- The main owner confirms or rejects a count difference or opening stock.
-- A count is confirmed only while the books still read what they read when
-- it was counted (else count again): a loss comes off the lots there,
-- oldest first; goods found become an untraced lot.
create or replace function stk_decide(p_op uuid, p_record uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_prev jsonb;
  r stk_records;
  v_line purchase_lines;
  v_lot uuid;
  v_takes jsonb;
  v_t jsonb;
  v_diff numeric;
  v_result jsonb;
begin
  v_owner := pur_main_owner();
  if not stk_on(v_owner) then
    raise exception 'STOCK_OFF' using errcode = 'P0001';
  end if;
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if p_approve is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  select * into r from stk_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.purchase_id is not null then
    perform pur_purchase_lock(r.purchase_id);
  end if;
  perform stk_lock_items(array[r.item_id]);
  select * into r from stk_records where id = p_record;
  if r.status <> 'pending' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not p_approve then
    update stk_records set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = pur_reason(p_note)
     where id = r.id;
    insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'rejected', r.id, pur_reason(p_note), auth.uid());
    return pur_op_done(v_owner, p_op, 'stk_decide', jsonb_build_object('record_id', r.id, 'status', 'rejected'));
  end if;

  if r.kind = 'count' then
    if stk_item_balance(v_owner, r.item_id, r.to_location) <> r.book_quantity then
      raise exception 'STALE_COUNT' using errcode = 'P0001',
        hint = 'The books changed since this count. Reject it and count again.';
    end if;
    v_diff := r.quantity - r.book_quantity;
    update stk_records set status = 'done', decided_by = auth.uid(), decided_at = now(), decision_note = pur_note(p_note, 500)
     where id = r.id;
    if v_diff < 0 then
      v_takes := stk_take(v_owner, r.item_id, r.to_location, -v_diff, null);
      for v_t in select value from jsonb_array_elements(v_takes) loop
        insert into stk_moves (owner_id, record_id, lot_id, layer, from_location, quantity)
        values (v_owner, r.id, (v_t ->> 'lot_id')::uuid, (v_t ->> 'layer')::uuid, r.to_location, (v_t ->> 'quantity')::numeric);
      end loop;
    else
      insert into stk_lots (owner_id, item_id, untraced, since, created_by)
      values (v_owner, r.item_id, true, r.on_date, auth.uid()) returning id into v_lot;
      insert into stk_moves (owner_id, record_id, lot_id, layer, to_location, quantity) values (v_owner, r.id, v_lot, r.id, r.to_location, v_diff);
    end if;
  else
    if r.purchase_id is not null then
      v_line := stk_line(v_owner, r.purchase_id, r.line_no);
      if v_line.destination <> 'project' or stk_conv(r.purchase_id, r.line_no, v_line.quantity) < stk_line_in(r.purchase_id, r.line_no) then
        raise exception 'MORE_THAN_BOUGHT' using errcode = 'P0001';
      end if;
      v_lot := stk_lot_for_line(v_line);
    else
      insert into stk_lots (owner_id, item_id, untraced, since, created_by)
      values (v_owner, r.item_id, true, r.on_date, auth.uid()) returning id into v_lot;
    end if;
    update stk_records set status = 'done', lot_id = v_lot, decided_by = auth.uid(), decided_at = now(),
                           decision_note = pur_note(p_note, 500)
     where id = r.id;
    insert into stk_moves (owner_id, record_id, lot_id, layer, to_location, quantity) values (v_owner, r.id, v_lot, r.id, r.to_location, r.quantity);
  end if;
  insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'confirmed', r.id, pur_note(p_note, 500), auth.uid());
  v_result := jsonb_build_object('record_id', r.id, 'status', 'done');
  return pur_op_done(v_owner, p_op, 'stk_decide', v_result);
end;
$$;

-- Reverse a mistaken record (reason kept; nothing is deleted), or withdraw
-- one still waiting for the main owner. The person who recorded it or an
-- owner account; a confirmed count or opening stock — the main owner only.
-- Refused while its goods have moved on, and for an issue with returns
-- (reverse those first).
create or replace function stk_reverse(p_op uuid, p_record uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  r stk_records;
  v_lot stk_lots;
  v_reason text := pur_reason(p_reason);
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into r from stk_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.purchase_id is not null then
    perform pur_purchase_lock(r.purchase_id);
  end if;
  select * into v_lot from stk_lots where purchase_id = r.purchase_id and line_no = r.line_no;
  perform stk_lock_items(array[r.item_id, v_lot.item_id],
                         case when r.request_line_id is null then '{}'::text[] else array['pr_line:' || r.request_line_id] end);
  select * into r from stk_records where id = p_record;
  if r.status = 'pending' then
    if auth.uid() <> r.recorded_by and not pur_is_main_owner() then
      raise exception 'NOT_YOURS' using errcode = 'P0001';
    end if;
    update stk_records set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = v_reason where id = r.id;
    insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'withdrawn', r.id, v_reason, auth.uid());
    return pur_op_done(v_owner, p_op, 'stk_reverse', jsonb_build_object('record_id', r.id, 'status', 'withdrawn'));
  end if;
  if r.status <> 'done' or r.reversed_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if r.kind in ('count', 'opening') then
    if not pur_is_main_owner() then
      raise exception 'NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if not exists (select 1 from stk_moves m where m.record_id = r.id) then
      raise exception 'BAD_STATE' using errcode = 'P0001';
    end if;
  elsif auth.uid() <> r.recorded_by and not is_owner() then
    raise exception 'NOT_YOURS' using errcode = 'P0001';
  end if;
  if r.kind = 'issue' and exists (select 1 from stk_records x where x.returns_record = r.id and x.status = 'done' and x.reversed_at is null) then
    raise exception 'RETURNS_FIRST' using errcode = 'P0001';
  end if;
  update stk_records set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason where id = r.id;
  -- What the record put somewhere must still be there (a receipt's layer
  -- included: refused once any of that delivery has moved on).
  perform stk_check_record(r.id);
  insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'reversed', r.id, v_reason, auth.uid());
  v_result := jsonb_build_object('record_id', r.id, 'reversed', true);
  return pur_op_done(v_owner, p_op, 'stk_reverse', v_result);
end;
$$;

-- ════ 7. Reading (quantities only) ═══════════════════════════════════

-- The caller's company, for a stock read: whoever may record stock, while
-- it is on (the screens are hidden before launch).
create or replace function stk_reader() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not stk_can_record() then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if not stk_on(data_owner_id()) then
    raise exception 'STOCK_OFF' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

create or replace function stk_place_name(p_loc uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when l.kind = 'warehouse' then 'Warehouse' else coalesce(f.name, l.folder_name) end
    from stk_locations l left join folders f on f.id = l.folder_id where l.id = p_loc
$$;

-- One record as the screens show it.
create or replace function stk_record_json(p_record uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'status', r.status, 'item_id', r.item_id, 'item_name', c.name, 'item_unit', c.unit,
    'purchase_id', r.purchase_id, 'line_no', r.line_no, 'line_item', l.item_name, 'line_unit', l.unit,
    'from_id', r.from_location, 'from_name', stk_place_name(r.from_location),
    'to_id', r.to_location, 'to_name', stk_place_name(r.to_location),
    'quantity', r.quantity, 'book_quantity', r.book_quantity, 'on', r.on_date,
    'request_line_id', r.request_line_id, 'request_description', rl.description,
    'unplanned_reason', r.unplanned_reason, 'returns_record', r.returns_record, 'reason', r.reason, 'note', r.note,
    'recorded_by', r.recorded_by, 'recorded_by_name', pur_person_name(r.recorded_by), 'recorded_at', r.recorded_at,
    'decided_by_name', case when r.decided_by is null then null else pur_person_name(r.decided_by) end,
    'decided_at', r.decided_at, 'decision_note', r.decision_note,
    'reversed', r.reversed_at is not null, 'reversed_at', r.reversed_at, 'reverse_reason', r.reverse_reason,
    'reversed_by_name', case when r.reversed_by is null then null else pur_person_name(r.reversed_by) end,
    'returnable', case when r.kind = 'issue' and r.status = 'done' and r.reversed_at is null then
                    r.quantity - coalesce((select sum(x.quantity) from stk_records x where x.returns_record = r.id
                                             and x.status = 'done' and x.reversed_at is null), 0) end,
    'lots', (select coalesce(jsonb_agg(jsonb_build_object('lot_id', m.lot_id, 'layer', m.layer, 'quantity', m.quantity) order by m.id), '[]'::jsonb)
               from stk_moves m where m.record_id = r.id))
  from stk_records r
  left join pr_catalog_items c on c.id = r.item_id
  left join purchase_lines l on l.purchase_id = r.purchase_id and l.line_no = r.line_no
  left join pr_lines rl on rl.id = r.request_line_id
  where r.id = p_record
$$;

-- A warehouse or project purchase line, for the stock screens: what it is,
-- its match, and (warehouse) what is received and still awaited. No price.
create or replace function stk_line_json(p_line purchase_lines) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'purchase_id', p_line.purchase_id, 'line_no', p_line.line_no, 'destination', p_line.destination,
    'folder_id', p_line.folder_id, 'folder_name', p_line.folder_name,
    'item_name', p_line.item_name, 'unit', p_line.unit, 'quantity', p_line.quantity,
    'purchase_date', pu.purchase_date, 'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
    'received', stk_received(p_line.purchase_id, p_line.line_no),
    'not_delivered', stk_received(p_line.purchase_id, p_line.line_no, 'not_delivered'),
    'awaiting', case when p_line.destination = 'warehouse'
                     then p_line.quantity - stk_received(p_line.purchase_id, p_line.line_no)
                          - stk_received(p_line.purchase_id, p_line.line_no, 'not_delivered') end,
    'entered', stk_line_in(p_line.purchase_id, p_line.line_no),
    'match', (select jsonb_build_object('item_id', m.item_id, 'item_name', c.name, 'item_unit', c.unit,
                                        'per', m.per, 'covers', m.covers, 'auto', m.auto)
                from stk_matches m join pr_catalog_items c on c.id = m.item_id
               where m.purchase_id = p_line.purchase_id and m.line_no = p_line.line_no),
    'auto_item_id', stk_auto_item(p_line),
    -- The one active catalogue item with exactly this name and unit, as a
    -- suggestion for the office's match (never applied by itself).
    'suggested_item_id', (select case when count(*) = 1 then (array_agg(c.id))[1] end from pr_catalog_items c
                           where c.owner_id = p_line.owner_id and c.active
                             and lower(btrim(c.name)) = lower(btrim(p_line.item_name)) and lower(btrim(c.unit)) = lower(btrim(p_line.unit))),
    'can_check', is_owner() or auth.uid() not in (pu.recorded_by, coalesce(pu.bought_by, pu.recorded_by)))
  from purchases pu where pu.id = p_line.purchase_id
$$;

-- The Stock screen: every item with stock, by place; warehouse lines
-- awaiting delivery or a match; what waits for the main owner; the latest
-- records.
create or replace function stk_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return jsonb_build_object(
    'warehouse_id', (select id from stk_locations where owner_id = v_owner and kind = 'warehouse'),
    'items', (select coalesce(jsonb_agg(x.doc order by x.name), '[]'::jsonb) from (
        select c.name, jsonb_build_object('item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
                 'total', sum(b.quantity),
                 'places', jsonb_agg(jsonb_build_object('location_id', b.location_id, 'name', stk_place_name(b.location_id),
                                                        'kind', l.kind, 'folder_id', l.folder_id, 'quantity', b.quantity)
                                     order by l.kind = 'site', stk_place_name(b.location_id))) as doc
          from (select s.item_id, s.location_id, sum(s.quantity) as quantity from stk_balances(v_owner) s
                 group by s.item_id, s.location_id having sum(s.quantity) <> 0) b
          join pr_catalog_items c on c.id = b.item_id
          join stk_locations l on l.id = b.location_id
         group by c.id, c.name, c.spec, c.unit) x),
    'awaiting', (select coalesce(jsonb_agg(stk_line_json(l) order by pu.purchase_date, l.purchase_id, l.line_no), '[]'::jsonb)
                   from purchase_lines l join purchases pu on pu.id = l.purchase_id
                  where pu.owner_id = v_owner and pu.status = 'recorded' and l.destination = 'warehouse'
                    and (l.quantity - stk_received(l.purchase_id, l.line_no) - stk_received(l.purchase_id, l.line_no, 'not_delivered') > 0
                         or (not exists (select 1 from stk_matches m where m.purchase_id = l.purchase_id and m.line_no = l.line_no)
                             and stk_auto_item(l) is null))),
    'pending', (select coalesce(jsonb_agg(stk_record_json(r.id) order by r.recorded_at), '[]'::jsonb)
                  from stk_records r where r.owner_id = v_owner and r.status = 'pending'),
    'recent', (select coalesce(jsonb_agg(stk_record_json(x.id) order by x.recorded_at desc), '[]'::jsonb)
                 from (select r.id, r.recorded_at from stk_records r where r.owner_id = v_owner
                        order by r.recorded_at desc limit 50) x));
end;
$$;

-- One item: its lots and where each is, and its records (newest first).
create or replace function stk_item(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := stk_reader();
  c pr_catalog_items := stk_item_ok(v_owner, p_item);
begin
  return jsonb_build_object(
    'item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
    'lots', (select coalesce(jsonb_agg(jsonb_build_object(
               'lot_id', lt.id, 'untraced', lt.untraced, 'since', lt.since, 'purchase_id', lt.purchase_id, 'line_no', lt.line_no,
               'cost_folder_id', lt.cost_folder_id,
               'cost_folder_name', case when lt.cost_folder_id is null then null
                                        else coalesce((select f.name from folders f where f.id = lt.cost_folder_id), l.folder_name) end,
               'line_item', l.item_name,
               'places', (select coalesce(jsonb_agg(jsonb_build_object('location_id', s.location_id, 'name', stk_place_name(s.location_id),
                                                                        'quantity', s.quantity) order by stk_place_name(s.location_id)), '[]'::jsonb)
                            from stk_balances(v_owner) s where s.lot_id = lt.id),
               -- Each delivery / entry still in stock, oldest received first (the issuing order).
               'layers', (select coalesce(jsonb_agg(jsonb_build_object('layer', y.layer, 'received_on', y.received_on,
                                                                        'location_id', y.location_id, 'name', stk_place_name(y.location_id),
                                                                        'quantity', y.quantity)
                                                     order by y.received_on, y.received_at, y.layer), '[]'::jsonb)
                            from stk_layers(v_owner, c.id) y where y.lot_id = lt.id and y.quantity > 0))
             order by lt.since, lt.created_at), '[]'::jsonb)
               from stk_lots lt left join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
              where lt.owner_id = v_owner and lt.item_id = c.id),
    'records', (select coalesce(jsonb_agg(stk_record_json(x.id) order by x.recorded_at desc), '[]'::jsonb)
                  from (select r.id, r.recorded_at from stk_records r
                         where r.owner_id = v_owner
                           and (r.item_id = c.id or exists (select 1 from stk_lots lt where lt.purchase_id = r.purchase_id
                                                              and lt.line_no = r.line_no and lt.item_id = c.id))
                         order by r.recorded_at desc limit 200) x));
end;
$$;

-- A project's purchase lines (recorded), for "Record leftovers" and traced
-- opening stock: what each brought and how much is already stock.
create or replace function stk_project_lines(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return (select coalesce(jsonb_agg(stk_line_json(l) order by pu.purchase_date desc, l.purchase_id, l.line_no), '[]'::jsonb)
            from purchase_lines l join purchases pu on pu.id = l.purchase_id
           where pu.owner_id = v_owner and pu.status = 'recorded' and l.destination = 'project' and l.folder_id = p_folder);
end;
$$;

-- What the forms pick from: catalogue items and the company's projects.
create or replace function stk_choices() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit, 'kind', c.kind)
                                        order by lower(c.name), lower(c.spec)), '[]'::jsonb)
                from pr_catalog_items c where c.owner_id = v_owner and c.active),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('folder_id', f.id,
                   'name', case when f.parent_folder_id is null then f.name else coalesce(par.name, '') || ' — ' || f.name end,
                   'main', f.parent_folder_id is null,
                   'completed', f.completed_at is not null or par.completed_at is not null)
                   order by coalesce(par.name, f.name), f.parent_folder_id is not null, f.name), '[]'::jsonb)
                   from folders f left join folders par on par.id = f.parent_folder_id
                  where f.owner_id = v_owner));
end;
$$;

-- 0097's shopping list: "bought" is now what recorded PURCHASES covered;
-- "from_stock" what stock covered; "still_to_buy" counts both (as before,
-- through pr_portion_bought). "in_warehouse": usable warehouse stock of the
-- line's catalogue item, as a hint (no reservation, Q9) — 0 while stock is off.
create or replace function pur_shopping_list(p_batch uuid default null, p_folder uuid default null, p_scope text default 'open')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_on boolean;
  v_wh uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  v_on := stk_on(v_owner);
  v_wh := (select id from stk_locations where owner_id = v_owner and kind = 'warehouse');
  return (
    select coalesce(jsonb_agg(x.doc order by x.urgent desc, x.needed_by nulls last, x.first_cutoff nulls last, x.project_name, x.received_at, x.position), '[]'::jsonb)
      from (
        select l.urgent, l.needed_by, l.position, r.received_at, f.name as project_name,
               (select min(b.cutoff_at) from pr_line_portions p join pr_batches b on b.id = p.batch_id
                 where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch)) as first_cutoff,
               jsonb_build_object(
                 'line_id', l.id, 'request_id', r.id, 'kind', l.kind,
                 'description', l.description, 'spec', l.spec, 'unit', l.unit, 'category', l.category,
                 'catalog_item_id', l.catalog_item_id, 'catalog_name', c.name,
                 'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
                 'project_id', r.folder_id, 'project_name', f.name, 'work_id', r.work_folder_id,
                 'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
                 'requester_name', pr_person_name(r.requester_id),
                 'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
                 'bought', pr_line_purchased(l.id),
                 'from_stock', pr_line_from_stock(l.id),
                 'in_warehouse', case when v_on and v_wh is not null and l.catalog_item_id is not null
                                      then stk_item_balance(v_owner, l.catalog_item_id, v_wh) else 0 end,
                 'in_warehouse_unit', c.unit,
                 'still_to_buy', (select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0)
                                    from pr_line_portions p where p.line_id = l.id),
                 'extra', (select coalesce(sum(pl.extra_qty), 0) from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                            where pl.request_line_id = l.id and pu.status = 'recorded'),
                 'unit_checks', (select count(*) from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                                  where pl.request_line_id = l.id and pu.status = 'recorded' and pl.unit_check = 'pending'),
                 'portions', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'id', p.id, 'batch_id', p.batch_id, 'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on,
                            'delivery_on', b.delivery_on, 'quantity', p.quantity, 'pending_reduction', p.pending_reduction,
                            'bought', pr_portion_purchased(p.id),
                            'from_stock', pr_portion_from_stock(p.id),
                            'still_to_buy', greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id)),
                            'arranged', p.arranged_at is not null,
                            'buyer_id', p.buyer_id, 'buyer_name', case when p.buyer_id is null then null else pur_person_name(p.buyer_id) end,
                            'mine', p.buyer_id = auth.uid(), 'assigned_at', p.assigned_at,
                            'changed', p.assigned_at is not null and exists (
                               select 1 from pr_events e
                                where e.line_id = l.id and e.created_at > p.assigned_at
                                  and e.kind in ('quantity_changed', 'office_quantity_changed', 'conflict_resolved',
                                                 'line_cancelled', 'office_line_cancelled', 'reduction_resolved')))
                          order by b.cutoff_at, p.created_at), '[]'::jsonb)
                     from pr_line_portions p join pr_batches b on b.id = p.batch_id
                    where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch))
               ) as doc
          from pr_lines l
          join pr_requests r on r.id = l.request_id
          join folders f on f.id = r.folder_id
          join folders w on w.id = r.work_folder_id
          left join pr_catalog_items c on c.id = l.catalog_item_id
         where l.owner_id = v_owner
           and (p_folder is null or r.folder_id = p_folder)
           and (p_batch is null or exists (select 1 from pr_line_portions p where p.line_id = l.id and p.batch_id = p_batch))
           and (coalesce(p_scope, 'open') = 'all'
                or (l.status = 'open' and r.status = 'submitted'
                    and exists (select 1 from pr_line_portions p
                                 where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch)
                                   and p.quantity - p.pending_reduction - pr_portion_bought(p.id) > 0))
                or exists (select 1 from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                            where pl.request_line_id = l.id and pu.status = 'recorded' and pl.unit_check = 'pending'))
         order by l.urgent desc, l.needed_by nulls last, first_cutoff nulls last, f.name, r.received_at, l.position
         limit 500
      ) x);
end;
$$;

-- Requests open to stock: the open lines of a project (Main Contract or an
-- Additional Works job) with Still to buy, for an issue's "Fills request".
create or replace function stk_request_lines(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'line_id', l.id, 'description', l.description, 'spec', l.spec, 'unit', l.unit,
            'catalog_item_id', l.catalog_item_id, 'requester_name', pr_person_name(r.requester_id),
            'still_to_buy', (select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0)
                               from pr_line_portions p where p.line_id = l.id),
            'portions', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'cutoff_at', b.cutoff_at,
                                   'still_to_buy', greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id)))
                                 order by b.cutoff_at, p.created_at), '[]'::jsonb)
                           from pr_line_portions p join pr_batches b on b.id = p.batch_id where p.line_id = l.id))
          order by r.received_at, l.position), '[]'::jsonb)
            from pr_lines l join pr_requests r on r.id = l.request_id
           where l.owner_id = v_owner and r.work_folder_id = p_folder and l.status = 'open' and r.status = 'submitted'
             and exists (select 1 from pr_line_portions p where p.line_id = l.id
                            and p.quantity - p.pending_reduction - pr_portion_bought(p.id) > 0));
end;
$$;

-- 0101's one-purchase view: a request's "bought" is purchases alone, with
-- "from_stock" beside it.
create or replace function pur_purchase_view(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select pur_doc(pu.id) || jsonb_build_object(
    'recorded_by_name', pur_person_name(pu.recorded_by),
    'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
    'created_at', pu.created_at, 'updated_at', pu.updated_at, 'replaced_by', pu.replaced_by,
    'no_receipt_reason', pu.no_receipt_reason,
    'covers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'line', l.line_no, 'request_line_id', c.request_line_id, 'portion_id', c.portion_id,
                 'quantity', c.quantity, 'buyer_name', pur_person_name(c.buyer_id),
                 'request_description', rl.description, 'request_unit', rl.unit,
                 'cutoff_at', (select b.cutoff_at from pr_line_portions p join pr_batches b on b.id = p.batch_id where p.id = c.portion_id))
               order by l.line_no, c.id), '[]'::jsonb)
                 from purchase_line_covers c join purchase_lines l on l.id = c.line_id
                 join pr_lines rl on rl.id = c.request_line_id
                where l.purchase_id = pu.id),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('line', l.line_no, 'request_line_id', l.request_line_id,
                   'description', rl.description, 'spec', rl.spec, 'unit', rl.unit,
                   'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = rl.id),
                   'bought', pr_line_purchased(rl.id), 'from_stock', pr_line_from_stock(rl.id)) order by l.line_no), '[]'::jsonb)
                   from purchase_lines l join pr_lines rl on rl.id = l.request_line_id where l.purchase_id = pu.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'reason', h.reason, 'at', h.at,
                  'actor_name', pur_person_name(h.actor_id)) order by h.id), '[]'::jsonb)
                  from purchase_history h where h.purchase_id = pu.id),
    'change_requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status,
                          'reason', r.reason, 'requested_by_name', pur_person_name(r.requested_by), 'requested_at', r.requested_at,
                          'decision_note', r.decision_note) order by r.requested_at desc), '[]'::jsonb)
                          from purchase_change_requests r where r.purchase_id = pu.id))
  from purchases pu where pu.id = p_purchase
$$;

-- ════ 8. Who may call what ═══════════════════════════════════════════

-- The operations and readers (each refuses the wrong caller itself).
revoke all on function stk_status() from public, anon;
grant execute on function stk_status() to authenticated;
revoke all on function stk_set_enabled(boolean) from public, anon;
grant execute on function stk_set_enabled(boolean) to authenticated;
revoke all on function stk_match(uuid, uuid, int, uuid, text, text) from public, anon;
grant execute on function stk_match(uuid, uuid, int, uuid, text, text) to authenticated;
revoke all on function stk_receive(uuid, uuid, int, text, text, text) from public, anon;
grant execute on function stk_receive(uuid, uuid, int, text, text, text) to authenticated;
revoke all on function stk_not_delivered(uuid, uuid, int, text, text) from public, anon;
grant execute on function stk_not_delivered(uuid, uuid, int, text, text) to authenticated;
revoke all on function stk_leftover(uuid, uuid, int, text, text, text, text) from public, anon;
grant execute on function stk_leftover(uuid, uuid, int, text, text, text, text) to authenticated;
revoke all on function stk_move(uuid, jsonb) from public, anon;
grant execute on function stk_move(uuid, jsonb) to authenticated;
revoke all on function stk_count(uuid, jsonb) from public, anon;
grant execute on function stk_count(uuid, jsonb) to authenticated;
revoke all on function stk_opening(uuid, jsonb) from public, anon;
grant execute on function stk_opening(uuid, jsonb) to authenticated;
revoke all on function stk_decide(uuid, uuid, boolean, text) from public, anon;
grant execute on function stk_decide(uuid, uuid, boolean, text) to authenticated;
revoke all on function stk_reverse(uuid, uuid, text) from public, anon;
grant execute on function stk_reverse(uuid, uuid, text) to authenticated;
revoke all on function stk_overview() from public, anon;
grant execute on function stk_overview() to authenticated;
revoke all on function stk_item(uuid) from public, anon;
grant execute on function stk_item(uuid) to authenticated;
revoke all on function stk_project_lines(uuid) from public, anon;
grant execute on function stk_project_lines(uuid) to authenticated;
revoke all on function stk_choices() from public, anon;
grant execute on function stk_choices() to authenticated;
revoke all on function stk_request_lines(uuid) from public, anon;
grant execute on function stk_request_lines(uuid) to authenticated;
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function pur_shopping_list(uuid, uuid, text) from public, anon;
grant execute on function pur_shopping_list(uuid, uuid, text) to authenticated;
revoke all on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) from public, anon;
grant execute on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function stk_on(uuid) from public, anon, authenticated;
revoke all on function stk_can_record() from public, anon, authenticated;
revoke all on function stk_actor() from public, anon, authenticated;
revoke all on function stk_reader() from public, anon, authenticated;
revoke all on function stk_warehouse(uuid) from public, anon, authenticated;
revoke all on function stk_site(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_place(uuid, text) from public, anon, authenticated;
revoke all on function stk_line(uuid, uuid, int) from public, anon, authenticated;
revoke all on function stk_item_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_item_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_received(uuid, int, text) from public, anon, authenticated;
revoke all on function stk_conv(uuid, int, numeric) from public, anon, authenticated;
revoke all on function stk_auto_item(purchase_lines) from public, anon, authenticated;
revoke all on function stk_ensure_match(purchase_lines) from public, anon, authenticated;
revoke all on function stk_lot_for_line(purchase_lines) from public, anon, authenticated;
revoke all on function stk_try_lot(purchase_lines) from public, anon, authenticated;
revoke all on function stk_balance(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_layer_balance(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function stk_layers(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_receipt_moves(purchase_lines, uuid) from public, anon, authenticated;
revoke all on function pr_item_in_use(uuid) from public, anon, authenticated;
revoke all on function stk_item_fixed() from public, anon, authenticated;
revoke all on function stk_balances(uuid) from public, anon, authenticated;
revoke all on function stk_item_balance(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function stk_line_in(uuid, int) from public, anon, authenticated;
revoke all on function stk_take(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function stk_lock_items(uuid[], text[]) from public, anon, authenticated;
revoke all on function stk_check_record(uuid) from public, anon, authenticated;
revoke all on function stk_cover(uuid, uuid, uuid, uuid, uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function stk_place_name(uuid) from public, anon, authenticated;
revoke all on function stk_record_json(uuid) from public, anon, authenticated;
revoke all on function stk_line_json(purchase_lines) from public, anon, authenticated;
revoke all on function stk_guard_line() from public, anon, authenticated;
revoke all on function stk_guard_void() from public, anon, authenticated;
revoke all on function stk_inventory_frozen() from public, anon, authenticated;
revoke all on function stk_events_immutable() from public, anon, authenticated;
revoke all on function pr_portion_purchased(uuid) from public, anon, authenticated;
revoke all on function pr_line_purchased(uuid) from public, anon, authenticated;
revoke all on function pr_portion_from_stock(uuid) from public, anon, authenticated;
revoke all on function pr_line_from_stock(uuid) from public, anon, authenticated;
revoke all on function pr_portion_bought(uuid) from public, anon, authenticated;
revoke all on function pr_line_bought(uuid) from public, anon, authenticated;
revoke all on function pur_purchase_view(uuid) from public, anon, authenticated;
```

**Modify:** `supabase/migrations/README.md` — apply with `git apply --ignore-whitespace`

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
index d96e7dd..2aedee6 100644
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0104** — highest on disk is
-  `0103_buyer_return_photo.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0105** — highest on disk is
+  `0104_stock.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -192,6 +192,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0103 (WorkMate Stage 2A-4b — a buyer sees the photo of their own petty-cash return; OUTSIDE the money model)** redefines `pur_cash_detail` as 0102's text plus `photo_url` on each return (finding F3 of 2A-4a: the photo was kept but never sent to the buyer's "My cash"). It is read through `pur_my_cash` (the buyer, their own) and `pur_cash_buyer` (the main owner); it stays internal (revoked again, no grant). Also redefines `pur_list_doc` as 0102's text plus `supplier_id` (the phone pays from that supplier's credit using its saved copy of My purchases); internal as before. Adds `pur_my_ops_done(op ids)` (signed-in users): which of the caller's OWN operation ids the server already accepted (`pur_ops`), so a phone whose answer was lost never counts that payment twice; at most 200 asked at once. No table, no data, no money. Opening the photo is still decided by Storage on every download (`pur_petty_reader`). Prove with `npm run test:sql` (`2a4_payments.pglite.mjs --with-0103`) and `node tests/purchasing-payments-server.test.js`; live: `supabase/tests/2a4b_acceptance.sql` (self-wrapped, rolls back).
 
+**0104 (WorkMate Stage 2B-a — stock, quantities only; OUTSIDE the money model)** adds eight private tables (RLS on, no policies — reads and writes only through its functions): `stk_settings` (the company's stock switch, set by the main owner only; every write is refused `STOCK_OFF` until launch), `stk_locations` (one warehouse per company and one site per Project Control folder, made on first use), `stk_matches` (how a purchase line counts as a catalogue item: `per` line units = `covers` item units — automatic for a request-linked line whose catalogue item has the same unit, otherwise the office's check, never by whoever recorded or bought it for another unit), `stk_lots` (the goods of one purchase line, or untraced old goods; `cost_folder_id` = whose cost they are — null = company stock, a project = its leftovers), `stk_records` (one action: receive, not delivered, leftover, issue, return, move, count, opening; never edited — reversed or withdrawn with a reason), `stk_moves` (its quantity per lot and **layer** — each delivery received, leftover, opening or found count is a layer dated the day it entered stock, and issues, moves and losses take the oldest received first), `stk_covers` (what goods entering a project filled on a request line) and the append-only `stk_events`. Redefines `pr_portion_bought` / `pr_line_bought` as COVERED (recorded purchases + live stock records — every Still to buy follows), adds `pr_portion_purchased` / `pr_line_purchased` / `*_from_stock`, and redefines `pur_shopping_list` (`bought` = purchases, plus `from_stock`, `in_warehouse`) and `pur_purchase_view`. Triggers: a purchase line may not undo its stock (`STOCK_IN_USE`: destination, project, unit, and quantity below what was received / entered), a purchase with stock records cannot be voided or replaced, once stock is on the old `inventory` table — the "Add to inventory" tick — refuses writes (`STOCK_TICK_RETIRED`), and a catalogue item's kind and unit never change once a request **or stock** uses it (`ITEM_IN_USE`; 0092's `pr_office_save_item` / `pr_office_catalog` extended through `pr_item_in_use`). Counts that differ and opening stock wait for the main owner (`stk_decide`). Every write takes an operation id (`pur_ops`). **Writes and reads no peso amount and no `expenses` / `payroll` row** — the value of stock and every cost move are Stage 2C. Requires 0098 (main owner) and 0102 (helpers). Prove with `npm run test:sql` (`2b_stock.pglite.mjs`, `2b_concurrency.mjs`, and the 2A-1 suite re-run `--with-0104` with stock off, the 2A-2 / 2A-3 / 2A-4 suites with stock on) and `node tests/stock-admin.test.js`; live: `supabase/tests/2b_acceptance.sql` (self-wrapped, rolls back).
+
 Get the truth before relying on this line:
 
 ```sql
````


- [ ] **Step 1: Apply the files above** in Dacs Web. Create blocks as given; Modify blocks with `git apply --ignore-whitespace`. Then put the two CRLF files back to CRLF everywhere:

```bash
node -e "const fs=require('fs');for(const f of ['supabase/migrations/README.md','docs/DATABASE_SCHEMA.md'])fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"
```

- [ ] **Step 2: Tests.** `npm test` → every suite passes (39; `purchasing-payments-server` 18, money 248 unchanged). `npm run test:sql` → every suite passes (**25**), including the new `2b_stock.pglite.mjs` (**38**) and `2b_concurrency.mjs` (**8**, 15 rounds each), and every purchasing suite again with 0104 on top: `2a1 --with-0104` (45, stock off), `2a2 --with-0104` (44), `2a3 --with-0104` (23), `2a4 --with-0104` (48) — stock on.
- [ ] **Step 3: Stop for the user** to review and commit. Do not push yet.

### Task 2: Dacs Web — Requests → Stock, the shopping list hint, the old tick retired

**Interfaces used:** Task 1's only. **Produced:** `window.StockAdmin` (`openIssue(line, onDone)`, `render`), `window.currentStockOn`, `window.currentStockMainOwner`.

<!-- Tests -->

**Modify:** `tests/purchasing-admin.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/purchasing-admin.test.js b/tests/purchasing-admin.test.js
index c015e58..670332a 100644
--- a/tests/purchasing-admin.test.js
+++ b/tests/purchasing-admin.test.js
@@ -123,7 +123,7 @@ test('the nav has Purchasing and its drill-down, hidden unless the server says t
   const src = read('js/admin.js');
   ok(/view: 'reqPurchasing'/.test(src) && /view: 'reqPurchase',[^}]*hidden: true/.test(src), 'modules');
   ok(/requests: \['reqDetail', 'reqPurchase'\]/.test(src), '_FOCUS_SUBVIEWS');
-  ok(/p\.id === 'requests' && !window\.currentCanBuy[\s\S]{0,400}'reqPurchasing', 'reqPurchase'/.test(src), '_visibleNav gate');
+  ok(/p\.id === 'requests'\) \{[\s\S]{0,400}const hidden = window\.currentCanBuy \? \[\] : \['reqPurchasing', 'reqPurchase'\];/.test(src), '_visibleNav gate');
   ok(/rpc\('pur_me'\)[\s\S]{0,120}currentCanBuy = !!\(purMe && purMe\.can_buy\)/.test(src), 'loaded from the server at sign-in');
 });
 test('admin.html loads the purchasing files after Requests, with their views', () => {
@@ -132,7 +132,7 @@ test('admin.html loads the purchasing files after Requests, with their views', (
     ok(html.indexOf('js/' + f + '.js') > html.indexOf('js/requests-admin-core.js'), f);
   }
   ok(/id="reqPurchasingView"/.test(html) && /id="reqPurchaseView"/.test(html), 'views');
-  ok(/REQ_VIEWS\s*=\s*\[[^\]]*'reqPurchasing','reqPurchase'\]/.test(html), 'REQ_VIEWS');
+  ok(/REQ_VIEWS\s*=\s*\[[^\]]*'reqPurchasing','reqPurchase'[,\]]/.test(html), 'REQ_VIEWS');
   ok(html.indexOf('css/purchasing-admin.css') > 0, 'styles');
   // Files this stage changes must reach an already-open browser (a stale admin.js hides the tab).
   for (const f of ['supabase-config', 'admin', 'receipt-storage', 'expenses-module', 'user-navigator']) {
```

**Create:** `tests/stock-admin.test.js`

```js
// ════════════════════════════════════════════════════════════════════
// STOCK SCREENS (0104, 2B-a):  run with  node tests/stock-admin.test.js
//
// Zero dependencies. Loads the REAL js/stock-admin.js (its pure half) and
// reads the screens' source:
//   1. The words and checks agree with the server: every refusal has a
//      sentence, record kinds and count reasons match 0104, the forms refuse
//      what the server would refuse.
//   2. Quantities only: the screens read no table and show no peso amount.
//   3. Wiring: Requests → Stock is hidden until stock is switched on (the main
//      owner sees the switch); the old "Add to inventory" tick and Inventory
//      screen go once it is on; the shopping list's hint and "Issue from
//      stock"; every write is sent once.
// ════════════════════════════════════════════════════════════════════
'use strict';
const sa = require('../js/stock-admin.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0104_stock.sql');
const JS = read('js/stock-admin.js');
const BROWSER = JS.slice(JS.indexOf('// ── Browser'));

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((label || '') + ' expected ' + y + ', got ' + x);
}

console.log('\nstock: the words agree with the server');

test('every refusal 0104 can send has a sentence (and the helpers\' it reaches)', () => {
  const codes = [...new Set([...SQL.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))]
    // HISTORY_IMMUTABLE: a trigger on direct table writes, never an RPC answer;
    // BUYER_REQUIRED: the shopping list's (Purchasing), redefined here unchanged;
    // OFFICE_ONLY / DUPLICATE_ITEM: the catalogue save's (0092, redefined here) —
    // the Catalogue screen words them (requests-admin-core, checked below).
    .filter(c => !['HISTORY_IMMUTABLE', 'BUYER_REQUIRED', 'OFFICE_ONLY', 'DUPLICATE_ITEM'].includes(c));
  ok(codes.length >= 30, 'codes read: ' + codes.length);
  for (const c of codes) ok(sa.ERRORS[c], c + ' has no sentence');
  // Reached through pur_actor_owner, pur_main_owner, pur_op_begin, pur_note, pur_reason, pur_past_day.
  for (const c of ['NOT_OFFICE', 'NOT_ALLOWED', 'OWNER_ONLY', 'BAD_OP', 'BAD_NOTE', 'REASON_REQUIRED', 'BAD_DATE']) ok(sa.ERRORS[c], c);
  ok(/stk_set_enabled|STOCK_OFF/.test(sa.errorMessage({ message: 'STOCK_OFF' })) || sa.errorMessage({ message: 'STOCK_OFF' }).includes('switch'), 'stock off');
  eq(sa.errorMessage({ message: 'NOT_ENOUGH', hint: 'Only 3 there.' }), sa.ERRORS.NOT_ENOUGH + ' (Only 3 there.)', 'the hint says how much is there');
  eq(sa.errorMessage({ message: 'STOCK_IN_USE', hint: 'x' }), sa.ERRORS.STOCK_IN_USE, 'no hint where the sentence says it all');
  eq(sa.errorMessage({ code: 'PGRST202', message: 'Could not find' }), sa.ERRORS.PGRST202);
  ok(/^Something went wrong: /.test(sa.errorMessage({ message: 'weird' })));
});

test('an item in use by stock keeps its kind and unit, and the Catalogue screen says why', () => {
  const ra = require('../js/requests-admin-core.js');
  ok(/stock/.test(ra.ERRORS.ITEM_IN_USE) && ra.ERRORS.ITEM_IN_USE.includes('new item'), 'the Catalogue sentence names stock');
  for (const c of ['OFFICE_ONLY', 'DUPLICATE_ITEM', 'ITEM_IN_USE']) ok(ra.ERRORS[c], c + ' worded on the Catalogue screen');
  ok(/'in_use', pr_item_in_use\(c\.id\)/.test(SQL), 'the catalogue list locks Kind and Unit for stock too');
  const save = SQL.slice(SQL.indexOf('create or replace function pr_office_save_item'), SQL.indexOf('create or replace function pr_office_catalog'));
  ok(/if \(p_kind <> v_kind or btrim\(p_unit\) <> v_unit\)\s+and pr_item_in_use\(p_item\) then\s+raise exception 'ITEM_IN_USE'/.test(save),
     'the save itself refuses before updating (the trigger is the backstop)');
  ok(/create trigger stk_item_fixed before update of kind, unit on pr_catalog_items/.test(SQL), 'no path around the save');
  for (const t of ['stk_matches', 'stk_lots', 'stk_records', 'pr_lines']) ok(new RegExp('from ' + t + ' \\w+ where \\w+\\.(item_id|catalog_item_id) = p_item').test(SQL), t);
});

test('layers in words: each delivery with the day it was received, oldest first', () => {
  eq(sa.layerText([{ received_on: '2026-10-02', name: 'Warehouse', quantity: 5 }, { received_on: '2026-10-17', name: 'Barlin <AW>', quantity: 2.5 }]),
     'Received 2 Oct 2026 · Warehouse 5<br>Received 17 Oct 2026 · Barlin &lt;AW&gt; 2.5');
  eq(sa.layerText([]), '');
  ok(/order by l\.received_on, l\.received_at, l\.layer/.test(SQL), 'the server issues in that order');
});

test('every record kind of 0104 has a label; count reasons are the server\'s, in order', () => {
  const kinds = SQL.match(/kind text not null check \(kind in \(('receive'[^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  eq(Object.keys(sa.KIND_LABEL).sort(), kinds.slice().sort());
  const reasons = SQL.match(/v_reason not in \(([^)]*)\)/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  eq(sa.COUNT_REASONS.map(r => r[0]), reasons);
});

test('quantities parse as the server\'s pur_qty: at most 3 decimals, up to 1,000,000; zero only for a count', () => {
  eq([sa.parseQty('12'), sa.parseQty('1,250.5'), sa.parseQty('0.001'), sa.parseQty(' 7 ')], [12, 1250.5, 0.001, 7]);
  eq([sa.parseQty('1.2345'), sa.parseQty('-1'), sa.parseQty('1e3'), sa.parseQty(''), sa.parseQty('0'), sa.parseQty('1000001')],
     [null, null, null, null, null, null]);
  eq(sa.parseQty('0', true), 0, 'a count of nothing');
});

test('an issue / move is refused before sending where the server would refuse it', () => {
  const ctx = { today: '2026-10-25' };
  const st = (x) => Object.assign({ itemId: 'i1', from: 'warehouse', to: 'f1', quantity: '6', on: '2026-10-25', requestLineId: 'l1' }, x);
  eq(sa.moveProblems(st(), ctx), []);
  eq(sa.moveProblems(st({ requestLineId: null }), ctx), ['UNPLANNED_REASON_REQUIRED'], 'Q8: goods into a project fill a request or say why');
  eq(sa.moveProblems(st({ requestLineId: null, unplannedReason: 'slab' }), ctx), []);
  eq(sa.moveProblems(st({ to: 'warehouse', from: 'f1' }), ctx), ['BAD_REQUEST_LINK'], 'never a request for the warehouse');
  eq(sa.moveProblems(st({ to: 'warehouse', from: 'f1', requestLineId: null }), ctx), []);
  eq(sa.moveProblems(st({ to: 'warehouse' }), ctx), ['BAD_LOCATION', 'BAD_REQUEST_LINK']);
  eq(sa.moveProblems(st({ quantity: '1.0001' }), ctx), ['BAD_QUANTITY']);
  eq(sa.moveProblems(st({ on: '2026-10-26' }), ctx), ['BAD_DATE'], 'not tomorrow');
  eq(sa.moveProblems(st({ itemId: '' }), ctx), ['BAD_ITEM']);
  eq(sa.moveProblems({ itemId: 'i1', quantity: '2', on: '2026-10-25', returnsRecord: 'r1' }, ctx), [], 'a return names only its issue');
});

test('the move body says exactly what the server reads, and the kind it will be', () => {
  eq(sa.moveBody({ itemId: 'i1', from: 'warehouse', to: 'f1', quantity: '1,000', on: '2026-10-25', requestLineId: 'l1', unplannedReason: 'x', note: ' n ' }),
     { item_id: 'i1', quantity: '1000', on: '2026-10-25', note: 'n', from: 'warehouse', to: 'f1', request_line_id: 'l1' });
  eq(sa.moveBody({ itemId: 'i1', from: 'f1', to: 'f2', quantity: '2', on: '2026-10-25', unplannedReason: ' slab ', lotId: 'lot1' }),
     { item_id: 'i1', quantity: '2', on: '2026-10-25', note: '', from: 'f1', to: 'f2', unplanned_reason: 'slab', lot_id: 'lot1' });
  eq(sa.moveBody({ itemId: 'i1', from: 'f1', to: 'warehouse', quantity: '2', on: '2026-10-25', requestLineId: 'l1' }),
     { item_id: 'i1', quantity: '2', on: '2026-10-25', note: '', from: 'f1', to: 'warehouse' }, 'nothing about requests to the warehouse');
  eq(sa.moveBody({ itemId: 'i1', quantity: '2', on: '2026-10-25', returnsRecord: 'r1' }),
     { item_id: 'i1', quantity: '2', on: '2026-10-25', note: '', returns_record: 'r1' });
  eq([sa.moveKind({ from: 'warehouse', to: 'f1' }), sa.moveKind({ from: 'f1', to: 'f2' }), sa.moveKind({ from: 'f1', to: 'warehouse' }),
      sa.moveKind({ returnsRecord: 'r1' })], ['issue', 'move', 'move', 'return']);
  ok(/v_kind := case when v_from = stk_warehouse\(v_owner\) then 'issue' else 'move' end/.test(SQL), 'the server decides the same way');
});

test('a match: the same unit is one for one; another unit needs a note and someone who did not buy it (Q5)', () => {
  const line = { unit: 'bag', quantity: 20, can_check: true };
  const bag = { unit: 'Bag' }, pc = { unit: 'piece' };
  eq(sa.matchProblems(line, bag, '20', ''), []);
  eq(sa.matchProblems(line, bag, '19', ''), ['BAD_QUANTITY']);
  eq(sa.matchProblems(line, pc, '1000', ''), ['REASON_REQUIRED']);
  eq(sa.matchProblems(line, pc, '1000', '20 bags = 1000 pcs'), []);
  eq(sa.matchProblems(Object.assign({}, line, { can_check: false }), pc, '1000', 'x'), ['OWN_PURCHASE']);
  eq(sa.matchProblems(line, null, '20', ''), ['BAD_ITEM']);
  eq([sa.needsMatch({ match: null, auto_item_id: null }), sa.needsMatch({ match: null, auto_item_id: 'i' }), sa.needsMatch({ match: {} })],
     [true, false, false]);
});

test('a count: a difference needs one of the server\'s reasons; zero is a count', () => {
  const ctx = { today: '2026-10-25' };
  const st = (x) => Object.assign({ itemId: 'i1', at: 'warehouse', counted: '8', on: '2026-10-25', reason: '' }, x);
  eq(sa.countProblems(st(), 8, ctx), []);
  eq(sa.countProblems(st(), 10, ctx), ['REASON_REQUIRED']);
  eq(sa.countProblems(st({ reason: 'damaged' }), 10, ctx), []);
  eq(sa.countProblems(st({ counted: '0', reason: 'lost' }), 10, ctx), []);
  eq(sa.countProblems(st({ reason: 'stolen' }), 10, ctx), ['REASON_REQUIRED']);
  eq(sa.countProblems(st(), null, ctx), [], 'books unknown on screen: the server decides');
});

test('who may reverse or withdraw (Q23): matches the server\'s rule', () => {
  const me = { userId: 'u1', isOwner: false, isMainOwner: false };
  const owner = { userId: 'o', isOwner: true, isMainOwner: true };
  const admin = { userId: 'a', isOwner: true, isMainOwner: false };
  const r = (x) => Object.assign({ kind: 'issue', status: 'done', reversed: false, recorded_by: 'u1', quantity: 5, book_quantity: null }, x);
  eq([sa.canReverse(r(), me), sa.canReverse(r({ recorded_by: 'u2' }), me), sa.canReverse(r({ recorded_by: 'u2' }), admin)], [true, false, true]);
  eq([sa.canReverse(r({ reversed: true }), owner), sa.canReverse(r({ status: 'rejected' }), owner), sa.canReverse(r({ status: 'withdrawn' }), owner)],
     [false, false, false]);
  eq([sa.canReverse(r({ status: 'pending', kind: 'count' }), me), sa.canReverse(r({ status: 'pending', kind: 'count', recorded_by: 'u2' }), owner),
      sa.canReverse(r({ status: 'pending', kind: 'count', recorded_by: 'u2' }), admin)], [true, true, false]);
  eq([sa.canReverse(r({ kind: 'opening' }), me), sa.canReverse(r({ kind: 'opening' }), admin), sa.canReverse(r({ kind: 'opening' }), owner)],
     [false, false, true], 'a confirmed opening: the main owner only');
  eq(sa.canReverse(r({ kind: 'count', quantity: 8, book_quantity: 8 }), owner), false, 'a count that changed nothing');
  ok(/r\.kind in \('count', 'opening'\)[\s\S]{0,80}pur_is_main_owner\(\)/.test(SQL), 'the server: count and opening, main owner');
  ok(/auth\.uid\(\) <> r\.recorded_by and not is_owner\(\)/.test(SQL), 'the server: recorder or an owner account');
});

test('records in words; places: the warehouse first, completed projects last and marked (Q16)', () => {
  eq(sa.recordText({ kind: 'issue', item_name: 'Cement', item_unit: 'bag', quantity: 6, from_name: 'Warehouse', to_name: 'Barlin' }),
     '6 bag Cement — Warehouse → Barlin');
  eq(sa.recordText({ kind: 'receive', line_item: 'Tie wire box', line_unit: 'box', quantity: 2 }), '2 box Tie wire box received at the warehouse');
  eq(sa.recordText({ kind: 'count', item_name: 'Cement', quantity: 8, book_quantity: 10, to_name: 'Warehouse' }), 'Cement at Warehouse: counted 8, books 10');
  eq(sa.countDifference({ quantity: 8, book_quantity: 10 }), '-2');
  eq(sa.countDifference({ quantity: 12.5, book_quantity: 10 }), '+2.5');
  eq(sa.requestText({ request_line_id: 'l', request_description: 'Cement' }), 'For request: Cement');
  eq(sa.requestText({ unplanned_reason: 'slab' }), 'Unplanned: slab');
  eq(sa.recordState({ status: 'pending' }), ['Waiting for the owner', 'working']);
  eq(sa.recordState({ status: 'done', reversed: true }), ['Reversed', 'abandoned']);
  eq(sa.placeOptions({ projects: [{ folder_id: 'a', name: 'Old', completed: true }, { folder_id: 'b', name: 'Barlin', completed: false }] }),
     [{ value: 'warehouse', label: 'Warehouse' }, { value: 'b', label: 'Barlin' }, { value: 'a', label: 'Old (completed)' }]);
});

console.log('\nstock: quantities only');

test('the Stock screens read no table, write only through 0104\'s functions, and show no peso amount', () => {
  ok(!/\.from\(/.test(JS), 'no direct table read');
  ok(!/₱|peso|amount|price|toFixed\(2\)/i.test(JS.replace(/\/\/[^\n]*/g, '')), 'no money on screen');
  const called = [...new Set([...BROWSER.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]))].sort();
  const granted = [...SQL.matchAll(/grant execute on function ([a-z_]+)\(/g)].map(m => m[1]);
  for (const f of called) ok(granted.includes(f), f + ' is not a granted 0104 function');
  eq(called, ['stk_choices', 'stk_count', 'stk_decide', 'stk_item', 'stk_leftover', 'stk_match', 'stk_move', 'stk_not_delivered',
              'stk_opening', 'stk_overview', 'stk_project_lines', 'stk_receive', 'stk_request_lines', 'stk_reverse', 'stk_set_enabled', 'stk_status']);
});

test('every stock write is sent once: one operation id per form, kept across retries', () => {
  const writes = ['stk_move', 'stk_leftover', 'stk_count', 'stk_opening', 'stk_match', 'stk_receive', 'stk_not_delivered', 'stk_reverse', 'stk_decide'];
  for (const w of writes) {
    ok(new RegExp("sendOnce\\(\\(opId[^)]*\\) => RA\\.rpc\\('" + w + "'").test(BROWSER), w + ' goes through sendOnce');
    ok((BROWSER.match(new RegExp("RA\\.rpc\\('" + w + "'", 'g')) || []).length === 1, w + ' is called in one place');
  }
  ok(/function sendOnce\(fn\) \{\s+const opId = newOp\(\);\s+return \(\.\.\.args\) => fn\(opId, \.\.\.args\);/.test(BROWSER), 'the id is made once per form');
  ok(/randomUUID/.test(BROWSER), 'a real uuid');
});

console.log('\nstock: wiring');

test('Requests → Stock: in the nav, the view list and the page; hidden until stock is on, except from the main owner', () => {
  const admin = read('js/admin.js');
  const html = read('admin.html');
  ok(/\{ view: 'reqStock',\s+label: 'Stock',\s+icon: 'warehouse' \}/.test(admin), 'PRIMARY_NAV entry');
  ok(/if \(!window\.currentStockOn && !window\.currentStockMainOwner\) hidden\.push\('reqStock'\);/.test(admin), 'hidden until on');
  ok(/const \{ data: stk \} = await window\.sbClient\.rpc\('stk_status'\);/.test(admin), 'the server says (before 0104: hidden)');
  ok(/window\.currentStockOn = !!\(stk && stk\.enabled\);/.test(admin) && /window\.currentStockMainOwner = !!\(stk && stk\.is_main_owner\);/.test(admin));
  ok(/const REQ_VIEWS\s+= \[[^\]]*'reqStock'\]/.test(html), 'REQ_VIEWS');
  ok(/<div id="reqStockView"\s+class="content-view" style="display: none;"><\/div>/.test(html), 'the page');
  ok(/reqStock:\s+'Stock',/.test(html), 'the title');
  const core = html.indexOf('js/requests-admin-core.js'), stock = html.indexOf('<script src="js/stock-admin.js?v=');
  ok(core > 0 && stock > core && stock > html.indexOf('js/purchasing-admin-list.js'), 'loaded after Requests and the shopping list');
  ok(/RA\.views\.reqStock = render;/.test(JS), 'the view is registered');
  ok(/if \(!status \|\| !status\.enabled\) return renderOff\(host, status\);/.test(BROWSER), 'off: nothing but the switch');
  ok(/form\.word\.value\.trim\(\) !== 'STOCK'/.test(BROWSER), 'the switch needs STOCK typed');
});

test('one stock path (Q29): once stock is on, the old tick is hidden and never sent, and the old Inventory screen goes', () => {
  const exp = read('js/expenses-module.js');
  ok(/const toInventory = !window\.currentStockOn && !!document\.getElementById\('expToInventory'\)\?\.checked;/.test(exp), 'never sent');
  const open = exp.slice(exp.indexOf('function openExpModal'), exp.indexOf('function closeExpModal'));
  ok(/box\.style\.display = window\.currentStockOn \? 'none' : ''/.test(open), 'hidden whenever the Add Expense form opens (Expenses and Project Control)');
  const admin = read('js/admin.js');
  ok(/p\.id === 'construction' && window\.currentStockOn\)[\s\S]{0,300}m\.view !== 'consInventory'/.test(admin), 'old Inventory screen hidden');
  ok(/create trigger stk_inventory_frozen before insert or update or delete on inventory/.test(SQL), 'and the server refuses both');
});

test('the shopping list: "In warehouse" as a hint, "Issue from stock" only once stock is on', () => {
  const list = read('js/purchasing-admin-list.js');
  ok(/canBuy && Number\(l\.in_warehouse\) > 0/.test(list), 'the hint, for a line with something to buy');
  ok(/root\.StockAdmin && root\.currentStockOn[\s\S]{0,140}data-issue=/.test(list), 'the button needs stock on');
  ok(/root\.StockAdmin\.openIssue\(line, reload\)/.test(list), 'opens the issue form');
  ok(/Number\(p\.from_stock\) > 0 \? esc\(PA\.qty\(p\.from_stock\)\) \+ ' from stock · '/.test(list), 'a portion says what stock filled');
  ok(/function openIssue\(line, onDone\)[\s\S]{0,300}to: line\.work_id, requestLineId: line\.line_id/.test(BROWSER), 'to the request\'s own project (Main Contract or Additional Works)');
  ok(/'bought', pr_line_purchased\(l\.id\),\s+'from_stock', pr_line_from_stock\(l\.id\),/.test(SQL), 'Bought = purchases; From stock beside it');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

<!-- Code -->

**Modify:** `admin.html` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/admin.html b/admin.html
index f7caa0a..7f6f2cf 100644
--- a/admin.html
+++ b/admin.html
@@ -22,7 +22,7 @@
     <link rel="stylesheet" href="css/reimbursement-module.css">
     <link rel="stylesheet" href="css/attendance-admin.css">
     <link rel="stylesheet" href="css/requests-admin.css?v=20261012a">
-    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261023a">
+    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261025a">
     <link rel="stylesheet" href="css/workplan-admin.css?v=20261014a">
     <!-- Warranty Retention Register + Fund Styles -->
     <link rel="stylesheet" href="css/warranty-fund.css?v=20260803f">
@@ -2656,6 +2656,9 @@
              Buyers only; reqPurchase is one purchase, opened from Purchasing. -->
         <div id="reqPurchasingView" class="content-view" style="display: none;"></div>
         <div id="reqPurchaseView"   class="content-view" style="display: none;"></div>
+        <!-- Stock (WorkMate Stage 2B-a, 0104) — js/stock-admin.js. Quantities only;
+             hidden until the main owner switches stock on. -->
+        <div id="reqStockView"      class="content-view" style="display: none;"></div>
         <!-- Work Plan (WorkMate My Work, 0093/0094) — rendered by js/workplan-admin-*.js.
              wpMeeting and wpTask are drill-downs from the Board and Meetings. -->
         <div id="wpBoardView" class="content-view" style="display: none;"></div>
@@ -5428,11 +5431,12 @@
 <script src="js/requests-admin-history.js?v=20261012a"></script>
 <script src="js/requests-admin-gallery.js?v=20261012a"></script>
 <script src="js/purchasing-admin-core.js?v=20261023a"></script>
-<script src="js/purchasing-admin-list.js?v=20261022b"></script>
+<script src="js/purchasing-admin-list.js?v=20261025a"></script>
 <script src="js/purchasing-admin-record.js?v=20261022b"></script>
 <script src="js/purchasing-admin-purchases.js?v=20261022b"></script>
 <script src="js/purchasing-admin-pay.js?v=20261023a"></script>
 <script src="js/purchasing-admin-cash.js?v=20261023b"></script>
+<script src="js/stock-admin.js?v=20261025a"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261014a"></script>
 <script src="js/workplan-admin-board.js?v=20261014a"></script>
@@ -6305,7 +6309,7 @@
     const PM_VIEWS   = ['pmProjects','pmWorkspace'];
     const QUOTE_VIEWS = ['quoteList','quoteEditor','quoteRevision'];
     const ATT_VIEWS   = ['attToday','attWorkers','attWorker','attProjects','attReports','attRewards'];
-    const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqHistory','reqProjects','reqPurchasing','reqPurchase'];
+    const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqHistory','reqProjects','reqPurchasing','reqPurchase','reqStock'];
     const WP_VIEWS    = ['wpBoard','wpMeetings','wpMeeting','wpTask'];
     const TITLES = {
         dashboard:        'Dashboard',
@@ -6353,6 +6357,7 @@
         reqProjects:      'Projects open to requests',
         reqPurchasing:    'Purchasing',
         reqPurchase:      'Purchase',
+        reqStock:         'Stock',
         wpBoard:          'Work Plan',
         wpMeetings:       'Meetings',
         wpMeeting:        'Meeting',
```

**Modify:** `css/purchasing-admin.css` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/css/purchasing-admin.css b/css/purchasing-admin.css
index f75f5aa..d29fa71 100644
--- a/css/purchasing-admin.css
+++ b/css/purchasing-admin.css
@@ -130,3 +130,30 @@
     border-radius: 12px; background: var(--att-card, #fff); }
 .pur-cash-cards > span strong { margin: 2px 0 0; font-size: 18px; }
 .pur-cash-cards small { color: var(--att-ink-3, #888); font-size: 12px; }
+
+/* ── Stock (0104, 2B-a) — js/stock-admin.js. Quantities only ── */
+.pur-instock { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 4px; font-size: 13.5px; color: var(--att-ink-2); }
+.pur-instock svg, .pur-instock i { width: 15px; height: 15px; }
+.stk-tab .att-card { margin-bottom: 12px; }
+.stk-form .att-label, .stk-tab .att-label { display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; font-weight: 600; color: var(--att-ink-2); }
+.stk-form { display: grid; gap: 12px; }
+.stk-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
+.stk-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
+.stk-item { cursor: pointer; }
+.stk-item:hover { border-color: var(--att-green); }
+.stk-item-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
+.stk-item-total { margin-left: auto; font-size: 18px; font-weight: 700; color: var(--att-ink); font-variant-numeric: tabular-nums; }
+.stk-places { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 6px; font-size: 13.5px; color: var(--att-ink-2); }
+.stk-place.is-warehouse strong { color: var(--att-green); }
+.stk-h { margin: 18px 0 8px; font-size: 15px; font-weight: 700; }
+.stk-lots, .stk-recs { display: grid; gap: 8px; }
+.stk-lot, .stk-rec { padding: 10px 14px; border: 1px solid var(--att-line); border-radius: 12px; background: var(--att-field); font-size: 13.5px; }
+.stk-rec { display: flex; align-items: flex-start; gap: 12px; }
+.stk-rec-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
+.stk-rec.is-reversed .stk-rec-main { color: var(--att-muted); }
+.stk-rec-acts, .stk-line-acts { display: flex; flex-wrap: wrap; gap: 6px; }
+.stk-line-acts { margin-top: 8px; }
+@media (max-width: 640px) {
+    .stk-rec { flex-direction: column; }
+    .stk-grid2 { grid-template-columns: 1fr; }
+}
```

**Modify:** `docs/ARCHITECTURE.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/docs/ARCHITECTURE.md b/docs/ARCHITECTURE.md
index c8d1375..221c228 100644
--- a/docs/ARCHITECTURE.md
+++ b/docs/ARCHITECTURE.md
@@ -133,6 +133,7 @@ Also note: **`projects` means billing period**, not project. Read it that way ev
 | Attendance | `attendance-admin.js` | Construction worker Time In / Time Out (`0050`). **The worker client is a separate native Android app** (Kotlin + Compose, repo `Documents/Dacs Attendance`), **not** the Bubblewrap TWA in `android/` — that one wraps the *client portal* and is untouched. This module is the admin half only. Today's attendance (a LEFT JOIN against active workers, so a worker with no row shows as `No record` rather than vanishing), worker detail with both photos, **worker management** (`attWorkers` — the roster including **deactivated** workers, which Today deliberately hides; deactivating blocks sign-in via `attendance-signin` and is the only route back, so that screen must never filter them out. Shows `email`, which Today does not select, because two workers can share a display name and the email is the only thing that tells them apart), **creating a worker** (the `attOpenNewWorker` modal on that same screen — mints the auth account through the shared `adminCreateUser` helper and the `admin-create-user` Edge Function, never from the browser; `kind` is always `admin` and the role list is **worker / teamLeader only**, because staff, engineer and owner accounts belong to Users → Navigator and a second, less-guarded route to a privileged account is exactly what this must not become. `worker_no` is left out of the payload on purpose — `profiles_worker_no_trg` (0050) assigns it from `worker_no_seq`; `position` is written by a follow-up update because the Edge Function builds its profile row from a fixed whitelist. Terms are **not** pre-signed here: the worker accepts them in the Android app), the projects picker list (**deactivate, never delete** — records reference the project id), and reports with CSV export. The report roll-up and CSV escaping are pure functions guarded by `tests/attendance.test.js`, which extracts them from the live source. **Hours here are never a pay figure** and no rate column exists — do not add one. **Deliberately isolated** like Reimbursement, Warranty Fund and Quotations: no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Attendance hours are **not** the basis of pay — labour is pakyaw, capped by `labor_contracts.agreed_amount`. **One peso column exists** since 0066 — `attendance_weekly_rewards.amount`, a reported figure that creates no accounting entry and must never be made to; this line previously said there was none, and that the staff amount-hiding rule therefore did not apply. Whether staff should see that amount is undecided; it is currently visible to them, and the payroll CSV they work from depends on it. Workers write only through the `attendance_time_in` / `attendance_time_out` RPCs; they hold no insert or update policy. **Closing a forgotten Time Out** (`0061`) is the one admin write: `attendance_abandon()` sets status `abandoned` plus a `abandoned_by`/`abandoned_at`/`abandoned_note` trail, and **invents no hours** — `timeout_at` and `total_minutes` stay null, so the day still reports `—`. It goes through an RPC even though owner/staff already hold an update policy, because `abandoned_at` must be the server's `now()` and `abandoned_by` must be `auth.uid()`; a browser-supplied trail is one the caller chose. Guarded against closing a `complete` record, closing twice, and closing **today's** date (that worker is probably on site, and `attendance_time_out` only closes rows on `working`). Surfaced in A2 and in A6's **open-records panel** — the only place a record stuck since August becomes visible, because A1 shows one day at a time |
 | Requests | `requests-admin-core.js`, `requests-admin-queue.js`, `requests-admin-detail.js`, `requests-admin-setup.js`, `requests-admin-history.js`, `requests-admin-gallery.js` | The office half of **DAC'S WorkMate Requests** (`0085` tables, `0086` office RPCs). Workers and team leaders request materials and tools in the phone app; owner and staff process them here: the **queue** (urgent first, then by weekly batch — Saturday 12:00 noon Manila cutoff), one request's **detail** (mark portions arranged, move an unarranged portion to another batch, resolve a worker's reduction of arranged quantity as *order reduced* or *kept as surplus*, change or cancel an item with a reason, resolve an offline-edit conflict, match an unlisted item to the catalogue, private photos via signed URLs, full history), **weekly batches** (only purchasing/delivery dates change), **teams** (a leader needs the Team Leader role *and* the assignment), the **catalogue** (deactivate, never delete; since `0092` an item used in any request keeps its **kind and unit** — the form locks both and the server refuses `ITEM_IN_USE`) and **projects** (*Allow requests*). Since `0090` (Stage 1b, Find Previous Item): catalogue **aliases** and **brand** (search aids, not identity), a per-project **Item history** switch (separate from *Allow requests*, survives completion), and the **Item history** view — search items with their dated history, add or retire a **historical reference** (creates no expense, stock or purchase), and manage reviewed **product photos** in the private `item-gallery` bucket (`<company>/<item>/<uuid>.jpg`, re-encoded in the browser, three-tick checklist, cover, retire — never deleted); **Photos to review** publishes a COPY of a worker's private request photo or keeps it private. A request line shows the Request Again source (`ref_label`). **Every write is an RPC** — the browser holds no write policy. **No money anywhere**: quantities only, so staff see all of it. A project or Additional Works job with requests **cannot be deleted** (`deleteFolder` / `deleteChild` ask `pr_folder_request_count` first) — complete it instead. Pure helpers are guarded by `tests/requests-admin.test.js`; the migration by `tests/workmate-requests-office.test.js`. Workers and team leaders can no longer sign in to this portal (`ADMIN_ROLES`) |
 | Purchasing | `purchasing-admin-core.js`, `purchasing-admin-list.js`, `purchasing-admin-record.js`, `purchasing-admin-purchases.js`, `css/purchasing-admin.css` | WorkMate Stage 2A-2 (`0097`): **Requests → Purchasing**, for accounts the server lets buy (owner, admin accounts allowed Expenses, staff with the **Buyer** switch — set by the owner in Users → Navigator). An account focused on Expenses but not Requests still gets a Requests tab holding Purchasing alone (`_purchasingOnly` in `admin.js`). The **shopping list** (Needed · Bought · Still to buy per weekly-batch portion, who is buying each — "I'll buy this", assign, release, mark arranged), **Record purchase** (one receipt, many lines and projects, linked to their request portions — optionally picked per weekly portion, and then only those are covered — extras with a reason, substitutes with a reason and an office check, Unplanned lines, delivery fees / discounts, receipt photos in the buyer-only `purchases/` folder, kept in the form state so a redraw keeps them and a replacement is uploaded), **Purchases** (one purchase: covers, unit / substitute check, correct, void, history; receipts open through an authenticated download, never a signed link) and **Owner approvals** (staff changes only the owner may make, shown field by field — as asked vs asked for — and not approvable once the purchase changed). Shows prices — the one Requests screen that does. Every write is a `pur_*` RPC through the same recording operation as Expenses / Project Control (0096). Project Control's edit and void send owner-only staff changes for approval, and read the purchase behind a row through `pur_entry_row` (`expenses-module.js`) — purchase tables are buyers-only. Pure helpers: `tests/purchasing-admin.test.js`; migration: `tests/purchasing-server.test.js` + `npm run test:sql` |
+| Stock | `stock-admin.js`, `css/purchasing-admin.css` (`stk-*`) | WorkMate Stage 2B-a (`0104`): **Requests → Stock**, quantities only, for owner and office staff allowed Expenses (Buyer staff included). Hidden until the main owner switches stock on (`stk_status`; the main owner sees the switch). Tabs: **Stock** (items by place; one item's lots, each delivery with the day it was received — the issuing order, oldest received first — and history), **Receiving** (warehouse purchases awaiting delivery or a catalogue match), **Waiting for owner** (counts and opening stock the main owner confirms), **History** (reverse / withdraw). Forms: Issue / move, Record leftovers, Count, Opening stock, Match, Received, Not delivered — each sends one operation id. The shopping list shows "In warehouse" and, once stock is on, "Issue from stock" (`StockAdmin.openIssue`). Once stock is on, the old "Add to inventory" tick (Add Expense) and the old Inventory screen are hidden — the server refuses both. Pure helpers: `tests/stock-admin.test.js`; migration: `npm run test:sql` (`2b_stock`, `2b_concurrency`) |
 | Work Plan | `workplan-admin-core.js`, `workplan-admin-form.js`, `workplan-admin-board.js`, `workplan-admin-task.js`, `workplan-admin-meetings.js` | The office half of **DAC'S WorkMate My Work** (`0093`, `0094`; plan `docs/superpowers/plans/2026-10-13-workmate-stage1c2-work-plan-office.md`). Owner and staff turn **meeting notes** into tasks — **AI drafts** through the `dacs-ai` worker (gated by `ai_authorize`, `0095`) or by hand — and review each in the **task form**: an AI name is filled in only on one exact match, otherwise the field reads *Needs your choice* and Save refuses. **Publish** sends tasks and shared notes to chosen people (default: everyone assigned in that meeting). The **Board** groups tasks under the office lists (check, blocked, not acknowledged 24 h, overdue, live, drafts/proposals, completed). One **task** shows who read which version, problems (cleared by the office with a note), photos (private `task-photos`), history, and approve / send back / reopen / cancel-decline. On a published task the **server raises the version** for any people, team or date change, and for wording unless marked a minor spelling correction (`0094`). Edits keep links and helpers the office did not remove, including links to tasks completed long ago. Unsaved meeting notes, shared notes and recipients survive redraws. **No money** — staff see all of it. Tests: `tests/workplan-admin.test.js`, `tests/workmate-office-server.test.js`, `tests/ai-worker.test.js`; live: `supabase/tests/1c2_acceptance.sql`, `1c2_ai_gate.sql` |
 
 **Project Control is compiled React.** See the build trap in §8.
```

**Modify:** `js/admin.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/admin.js b/js/admin.js
index ba6da6f..80588eb 100644
--- a/js/admin.js
+++ b/js/admin.js
@@ -87,6 +87,17 @@ function checkAuthState() {
                     const { data: purMe } = await window.sbClient.rpc('pur_me');
                     window.currentCanBuy = !!(purMe && purMe.can_buy);
                 } catch (_) { /* tab stays hidden */ }
+
+                // Stock (0104): on once the main owner switches it on at
+                // launch; until then only the main owner sees the tab (with
+                // the switch). Before 0104 is applied the call fails: hidden.
+                window.currentStockOn = false;
+                window.currentStockMainOwner = false;
+                try {
+                    const { data: stk } = await window.sbClient.rpc('stk_status');
+                    window.currentStockOn = !!(stk && stk.enabled);
+                    window.currentStockMainOwner = !!(stk && stk.is_main_owner);
+                } catch (_) { /* tab stays hidden */ }
             } catch (e) {
                 console.warn('Could not fetch user role:', e);
                 await auth.signOut();
@@ -2279,10 +2290,13 @@ const PRIMARY_NAV = [
     // materials and tools in DAC'S WorkMate; the office processes them here.
     // Owner + staff. Quantities only — no price, amount or cost anywhere —
     // EXCEPT Purchasing (0097): buyers only (window.currentCanBuy), with prices.
+    // Stock (0104) is quantities only, for owner + office staff allowed
+    // Expenses, once switched on (window.currentStockOn).
     { id: 'requests', label: 'Requests', sub: 'Materials & Tools', defaultView: 'reqQueue',
       modules: [
         { view: 'reqQueue',    label: 'Queue',          icon: 'inbox' },
         { view: 'reqPurchasing', label: 'Purchasing',   icon: 'shopping-cart' },
+        { view: 'reqStock',    label: 'Stock',          icon: 'warehouse' },
         { view: 'reqBatches',  label: 'Weekly batches', icon: 'calendar-days' },
         { view: 'reqTeams',    label: 'Teams',          icon: 'users' },
         { view: 'reqCatalog',  label: 'Catalogue',      icon: 'package-search' },
@@ -2427,12 +2441,21 @@ function _visibleNav() {
                 // older phone. The RPCs refuse staff too; this hides the tab.
                 return { ...p, modules: p.modules.filter(m => m.view !== 'attAppUpdates') };
             }
-            if (p.id === 'requests' && !window.currentCanBuy) {
+            if (p.id === 'requests') {
                 // Purchasing shows prices and needs an account that may buy
                 // (0097: owner / admin with Expenses / staff with the Buyer
                 // switch). The server refuses everyone else; this hides it.
-                const hidden = ['reqPurchasing', 'reqPurchase'];
-                return { ...p, modules: p.modules.filter(m => !hidden.includes(m.view)) };
+                const hidden = window.currentCanBuy ? [] : ['reqPurchasing', 'reqPurchase'];
+                // Stock (0104): hidden until switched on — except from the
+                // main owner, who switches it on there. The server refuses
+                // accounts without Expenses.
+                if (!window.currentStockOn && !window.currentStockMainOwner) hidden.push('reqStock');
+                if (hidden.length) return { ...p, modules: p.modules.filter(m => !hidden.includes(m.view)) };
+            }
+            if (p.id === 'construction' && window.currentStockOn) {
+                // One stock path (Q29): once Stock is on, the old Inventory
+                // screen goes (its table refuses writes, 0104).
+                return { ...p, modules: p.modules.filter(m => m.view !== 'consInventory') };
             }
             if (role === 'staff' && p.id === 'pm') {
                 // Warranty Fund is peso amounts end to end and owner-only by
```

**Modify:** `js/expenses-module.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/expenses-module.js b/js/expenses-module.js
index 879114e..e782f04 100644
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -3038,7 +3038,9 @@ async function handleAddExpense(e) {
     const notes      = document.getElementById('expNotes').value.trim();
     const paymentMethod = (document.getElementById('expPaymentMethod')?.value || '').trim();
     // Inventory toggle — when on, this material is also tracked as a stock item.
-    const toInventory = !!document.getElementById('expToInventory')?.checked;
+    // Once Stock is on (0104, Q29) the old tick is retired: the server refuses it,
+    // and the form hides it (openExpModal). Stock lives in Requests → Stock.
+    const toInventory = !window.currentStockOn && !!document.getElementById('expToInventory')?.checked;
     const invUnit     = document.getElementById('expInvUnit')?.value || 'pcs';
     const invMinStock = Math.round(Math.max(0, parseFloat(document.getElementById('expInvMinStock')?.value) || 0) * 1000) / 1000;
     // The ACTUAL purchase date decides the billing month (spec §3.3).
@@ -4813,6 +4815,11 @@ function openExpModal(id)  {
             d.value = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
         }
         if (typeof window.expSetMoreDetails === 'function') window.expSetMoreDetails(false);
+        // One stock path (0104, Q29): no "Add to inventory" once Stock is on.
+        const inv = document.getElementById('expToInventory');
+        const box = inv && inv.closest('.aer-inv');
+        if (box) box.style.display = window.currentStockOn ? 'none' : '';
+        if (inv && window.currentStockOn) { inv.checked = false; window.expToggleInventoryFields(); }
     }
     if (id === 'addPayrollModal' && typeof payToggleMode === 'function') payToggleMode(); // sync Daily/Lamsam UI
     if (id === 'addPayrollModal' && typeof lcPopulatePayrollPicker === 'function') {
```

**Modify:** `js/purchasing-admin-list.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-list.js b/js/purchasing-admin-list.js
index cdea6cf..68f6ed4 100644
--- a/js/purchasing-admin-list.js
+++ b/js/purchasing-admin-list.js
@@ -11,6 +11,9 @@
 //                      petty-cash tracker, or a buyer's own cash.
 // "Record purchase" (js/purchasing-admin-record.js) opens from the list
 // with the ticked lines.
+// 0104: a line whose catalogue item is in the warehouse says so ("In
+// warehouse: 12", a hint — no reservation) and, once stock is on, offers
+// "Issue from stock" (js/stock-admin.js). "From stock" counts only issues.
 //
 // Wording (spec): Needed · Bought · Still to buy; "Unassigned / You /
 // <name>"; assigning is NOT "arranged" — that stays its own button.
@@ -55,6 +58,7 @@
               '<span class="pur-portion-batch">' + esc('Cutoff ' + RA.cutoffLabel(p.cutoff_at)) + '</span></div>' +
             '<div class="pur-pcell"><span class="pur-plabel">To buy</span>' +
               '<span class="pur-portion-qty">' + esc(PA.qty(p.quantity - p.pending_reduction)) + ' needed · ' +
+              (Number(p.from_stock) > 0 ? esc(PA.qty(p.from_stock)) + ' from stock · ' : '') +
               esc(PA.qty(p.bought)) + ' bought · <strong>' + esc(PA.qty(p.still_to_buy)) + ' still to buy</strong></span></div>' +
             '<div class="pur-pcell"><span class="pur-plabel">Buyer</span>' +
               '<span class="pur-portion-who' + (p.buyer_id ? '' : ' is-open') + '">' + esc(who) + '</span></div>' +
@@ -83,6 +87,15 @@
                     (l.catalog_name ? ' <span class="req-muted">· ' + esc(l.catalog_name) + '</span>' : '') + ' ' + urgent +
                     (Number(l.unit_checks) > 0 ? ' ' + PA.pill('Office check waiting', 'abandoned') : '') + '</div>' +
                   '<div class="req-muted">' + esc(l.project_name) + ' · ' + esc(l.work_name) + ' · requested by ' + esc(l.requester_name) + '</div>' +
+                  // 0104: warehouse stock of this catalogue item — a hint to check
+                  // before buying (no reservation, Q9); issuing is what counts.
+                  (canBuy && Number(l.in_warehouse) > 0
+                    ? '<div class="pur-instock"><i data-lucide="warehouse"></i> In warehouse: <strong>' + esc(PA.qty(l.in_warehouse)) + ' ' +
+                      esc(l.in_warehouse_unit || l.unit) + '</strong> — check before buying' +
+                      (root.StockAdmin && root.currentStockOn
+                        ? ' <button type="button" class="att-btn att-btn--sm" data-issue="' + esc(l.line_id) + '">Issue from stock…</button>' : '') +
+                      '</div>'
+                    : '') +
                 '</div>' +
                 figures(l) +
               '</div>' +
@@ -170,6 +183,10 @@
         if (clr) clr.addEventListener('click', () => { ui.picked = {}; reload(); });
         body.querySelector('[data-unplanned]').addEventListener('click', () => PA.openRecord({ requestLines: [] }));
         body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act, b.dataset.portion, lines, me, reload)));
+        body.querySelectorAll('[data-issue]').forEach(b => b.addEventListener('click', () => {
+            const line = lines.find(l => l.line_id === b.dataset.issue);
+            if (line && root.StockAdmin) root.StockAdmin.openIssue(line, reload);
+        }));
         RA.icons();
     }
 
```

**Modify:** `js/requests-admin-core.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/requests-admin-core.js b/js/requests-admin-core.js
index 840b6a8..15597c7 100644
--- a/js/requests-admin-core.js
+++ b/js/requests-admin-core.js
@@ -245,7 +245,7 @@
         NOT_A_TEAM_LEADER: 'Only an account with the Team Leader role can lead a team.',
         NOT_IN_TEAM: 'Add this person to the team first.',
         DUPLICATE_ITEM: 'This item (same name, size/spec and unit) is already in the catalogue.',
-        ITEM_IN_USE: 'This item is already used in requests, so its kind and unit cannot change. Add a new item with the right kind or unit, then deactivate this one.',
+        ITEM_IN_USE: 'This item is already used in requests or stock, so its kind and unit cannot change. Add a new item with the right kind or unit, then deactivate this one.',
         DUPLICATE_TEAM: 'An active team already has this name.',
         BAD_ITEM: 'Fill in the item name and unit, choose Material or Tool, and keep other names to 20 or fewer, each up to 60 characters.',
         BAD_OUTCOME: 'Choose what happened to the order.',
```

**Create:** `js/stock-admin.js`

```js
// ════════════════════════════════════════════════════════════════════
// Requests → Stock (WorkMate Stage 2B-a, migration 0104).
//
// Where goods are, in catalogue units: the company warehouse and each
// project's site. Four tabs:
//   Stock            — every item by place; open one for its lots and history;
//   Receiving        — warehouse purchases awaiting delivery or a match;
//   Waiting for owner — counts and opening stock the main owner confirms;
//   History          — the latest records, each reversible (never edited).
// Actions: Issue / move, Record leftovers, Count, Opening stock. The
// shopping list's "Issue from stock" opens the same issue form (openIssue).
//
// Goods are issued oldest RECEIVED first (each delivery is its own layer,
// dated the day it arrived); one item's screen lists them in that order.
//
// QUANTITIES ONLY: no peso amount is read or shown here — the value of
// stock and every cost move are Stage 2C (main owner). Owner and office
// staff allowed Expenses use it (Buyer staff are office staff); the nav
// hides it until the main owner switches stock on (launch), and shows the
// main owner the switch. Every rule is the server's (0104); this file only
// previews and explains. Each form sends one operation id, kept across
// retries of the same form, so a double press records once.
//
// Works in a browser (window.StockAdmin) and in Node for
// tests/stock-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    // ── Words ───────────────────────────────────────────────────────

    const KIND_LABEL = {
        receive: 'Received',
        not_delivered: 'Not delivered',
        leftover: 'Leftovers recorded',
        issue: 'Issued to project',
        return: 'Returned to warehouse',
        move: 'Moved',
        count: 'Count',
        opening: 'Opening stock',
    };

    // The server's count reasons (stk_count), in this order on screen.
    const COUNT_REASONS = [
        ['lost', 'Lost'], ['damaged', 'Damaged'], ['expired', 'Expired'], ['miscounted', 'Miscounted'], ['other', 'Other'],
    ];

    function qty(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }

    // Same rule as the server's pur_qty: a plain number, at most 3 decimals.
    // allowZero for a count. Null = refused.
    function parseQty(text, allowZero) {
        const s = String(text === null || text === undefined ? '' : text).replace(/,/g, '').trim();
        if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
        const x = Number(s);
        if (x > 1000000) return null;
        if (x === 0 && !allowZero) return null;
        return x;
    }

    // A record's state as a pill: [text, tone] or null.
    function recordState(r) {
        if (r.reversed) return ['Reversed', 'abandoned'];
        if (r.status === 'pending') return ['Waiting for the owner', 'working'];
        if (r.status === 'rejected') return ['Rejected', 'abandoned'];
        if (r.status === 'withdrawn') return ['Withdrawn', 'abandoned'];
        return null;
    }

    // One line about a record: what moved, how much, from where to where.
    function recordText(r) {
        const unit = r.kind === 'receive' || r.kind === 'not_delivered' ? (r.line_unit || '') : (r.item_unit || '');
        const what = r.item_name || r.line_item || 'Item';
        const howMuch = qty(r.quantity) + (unit ? ' ' + unit : '');
        switch (r.kind) {
            case 'receive': return howMuch + ' ' + what + ' received at the warehouse';
            case 'not_delivered': return howMuch + ' ' + what + ' will not be delivered';
            case 'leftover': return howMuch + ' ' + what + ' left over — ' + (r.to_name || '');
            case 'count': return what + ' at ' + (r.to_name || '') + ': counted ' + qty(r.quantity) + ', books ' + qty(r.book_quantity);
            case 'opening': return howMuch + ' ' + what + ' already at ' + (r.to_name || '');
            default: return howMuch + ' ' + what + ' — ' + (r.from_name || '') + ' → ' + (r.to_name || '');
        }
    }

    // What the record says about a request.
    function requestText(r) {
        if (r.request_line_id) return 'For request: ' + (r.request_description || 'request line');
        if (r.unplanned_reason) return 'Unplanned: ' + r.unplanned_reason;
        return '';
    }

    // A count's difference, signed, with its reason.
    function countDifference(r) {
        const d = Math.round((Number(r.quantity) - Number(r.book_quantity)) * 1000) / 1000;
        return (d > 0 ? '+' : '') + qty(d);
    }

    // Each delivery or entry still in stock, oldest received first — the
    // order the server issues them in: "Received 2 Oct 2026 · Warehouse 5".
    function layerText(layers) {
        const day = (d) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
            return m ? Number(m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1] : String(d || '');
        };
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return (layers || []).map(y => 'Received ' + esc(day(y.received_on)) + ' · ' + esc(y.name) + ' ' + esc(qty(y.quantity))).join('<br>');
    }

    // Who may reverse or withdraw (the server decides again).
    // me = { userId, isOwner, isMainOwner }.
    function canReverse(r, me) {
        if (r.reversed || r.status === 'rejected' || r.status === 'withdrawn') return false;
        if (r.status === 'pending') return r.recorded_by === me.userId || me.isMainOwner;
        if (r.kind === 'count' || r.kind === 'opening') return me.isMainOwner && !(r.kind === 'count' && Number(r.quantity) === Number(r.book_quantity));
        return r.recorded_by === me.userId || me.isOwner;
    }

    // Places to pick: the warehouse, then each project (completed ones last,
    // marked — goods can still be recorded there, Q16).
    function placeOptions(choices) {
        const projects = (choices && choices.projects) || [];
        return [{ value: 'warehouse', label: 'Warehouse' }]
            .concat(projects.filter(p => !p.completed).map(p => ({ value: p.folder_id, label: p.name })))
            .concat(projects.filter(p => p.completed).map(p => ({ value: p.folder_id, label: p.name + ' (completed)' })));
    }

    function itemLabel(i) {
        return i ? i.name + (i.spec ? ' — ' + i.spec : '') + ' (' + i.unit + ')' : '';
    }

    // A warehouse line: does it need the office's match, and what is left
    // to receive?
    function needsMatch(line) { return !line.match && !line.auto_item_id; }

    // Match form checks, as the server's: the same unit counts one for one;
    // another unit needs a note and someone other than who bought it.
    function matchProblems(line, item, coversText, note) {
        const out = [];
        if (!item) return ['BAD_ITEM'];
        const covers = parseQty(coversText);
        const same = String(line.unit || '').trim().toLowerCase() === String(item.unit || '').trim().toLowerCase();
        if (covers === null || (same && covers !== Number(line.quantity))) out.push('BAD_QUANTITY');
        if (!same && !String(note || '').trim()) out.push('REASON_REQUIRED');
        if (!same && line.can_check === false) out.push('OWN_PURCHASE');
        return out;
    }

    // ── Issue / move ────────────────────────────────────────────────

    // st: { itemId, from, to, quantity, on, lotId, returnsRecord,
    // requestLineId, unplannedReason, note }. ctx: { today }.
    function moveProblems(st, ctx) {
        const out = [];
        if (!st.itemId) out.push('BAD_ITEM');
        if (parseQty(st.quantity) === null) out.push('BAD_QUANTITY');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.on || '')) || (ctx && ctx.today && st.on > ctx.today)) out.push('BAD_DATE');
        if (!st.returnsRecord) {
            if (!st.from || !st.to || st.from === st.to) out.push('BAD_LOCATION');
            const toSite = st.to && st.to !== 'warehouse';
            if (toSite && !st.requestLineId && !String(st.unplannedReason || '').trim()) out.push('UNPLANNED_REASON_REQUIRED');
            if (!toSite && (st.requestLineId || String(st.unplannedReason || '').trim())) out.push('BAD_REQUEST_LINK');
        }
        if (String(st.note || '').trim().length > 300 || String(st.unplannedReason || '').trim().length > 300) out.push('BAD_NOTE');
        return out;
    }

    function moveBody(st) {
        const b = { item_id: st.itemId, quantity: String(parseQty(st.quantity)), on: st.on, note: String(st.note || '').trim() };
        if (st.returnsRecord) {
            b.returns_record = st.returnsRecord;
        } else {
            b.from = st.from;
            b.to = st.to;
            if (st.to !== 'warehouse') {
                if (st.requestLineId) b.request_line_id = st.requestLineId;
                else b.unplanned_reason = String(st.unplannedReason || '').trim();
            }
        }
        if (st.lotId) b.lot_id = st.lotId;
        return b;
    }

    // What kind of record a move will be (the server decides the same way).
    function moveKind(st) {
        if (st.returnsRecord) return 'return';
        return st.from === 'warehouse' ? 'issue' : 'move';
    }

    function countProblems(st, book, ctx) {
        const out = [];
        if (!st.itemId) out.push('BAD_ITEM');
        if (!st.at) out.push('BAD_LOCATION');
        const c = parseQty(st.counted, true);
        if (c === null) out.push('BAD_QUANTITY');
        if (c !== null && book !== null && book !== undefined && c !== Number(book)
            && !COUNT_REASONS.some(([k]) => k === st.reason)) out.push('REASON_REQUIRED');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.on || '')) || (ctx && ctx.today && st.on > ctx.today)) out.push('BAD_DATE');
        return out;
    }

    // ── Errors in words ─────────────────────────────────────────────

    const ERRORS = {
        STOCK_OFF: 'Stock is not switched on yet. The main owner switches it on at launch.',
        TO_MATCH: 'Match this purchase line to a catalogue item first (Receiving tab).',
        NOT_WAREHOUSE: 'That purchase line is for a project, not the warehouse. Record its leftovers instead.',
        NOT_PROJECT: 'That purchase line is for the warehouse — it becomes stock by being received.',
        MORE_THAN_AWAITED: 'That is more than is still awaited on this line.',
        MORE_THAN_BOUGHT: 'That is more than this purchase line brought (counting what is already recorded as stock).',
        MORE_THAN_ISSUED: 'That is more than this issue sent and has not had back.',
        NOT_ENOUGH: 'There is not that much there.',
        BAD_LOT: 'Pick a lot of this item.',
        BAD_RETURN: 'Only a live issue from the warehouse can be returned.',
        BAD_LOCATION: 'Pick where the goods are and where they go — two different places.',
        BAD_ITEM: 'Pick a catalogue item.',
        BAD_PROJECT: 'Pick one of your projects.',
        UNPLANNED_REASON_REQUIRED: 'Goods going to a project fill a request line, or say why they are needed.',
        REQUEST_EXCEEDED: 'That is more than the request still needs. Record the rest separately, as unplanned with a reason.',
        ITEM_MISMATCH: 'That request line is for a different catalogue item.',
        UNIT_MISMATCH: 'That request line uses another unit. Issue it as unplanned with a reason.',
        LINE_CLOSED: 'That request line was cancelled.',
        BAD_REQUEST_LINK: 'A request belongs to the project the goods go to — never to the warehouse.',
        BAD_PORTION: 'Check the weekly portions picked.',
        COUNT_PENDING: 'A count of this item here is already waiting for the owner.',
        STALE_COUNT: 'The books changed since this count. Reject it, then count again.',
        STOCK_IN_USE: 'This purchase line has stock records. Reverse them first, or keep its destination, project, unit and enough quantity.',
        MOVED_ON: 'Those goods have moved on. Reverse the later records first.',
        RETURNS_FIRST: 'Part of this issue came back. Reverse that return first.',
        NOT_YOURS: 'Only the person who recorded this, or an owner, can reverse it.',
        OWN_PURCHASE: 'Another unit is checked by the office — never by whoever recorded or bought the purchase.',
        BAD_QUANTITY: 'Enter a quantity (at most 3 decimals). For the same unit, the match is the line\'s own quantity.',
        BAD_DATE: 'Pick a date that has happened.',
        REASON_REQUIRED: 'Please give a reason.',
        BAD_NOTE: 'That note is too long (300 characters at most).',
        BAD_STATE: 'This record was already decided, withdrawn or reversed. Reload the page.',
        NOT_ALLOWED: 'Only the main owner can do that.',
        OWNER_ONLY: 'Only the main owner can do that.',
        NOT_OFFICE: 'Only owner and office accounts can record stock.',
        NOT_FOUND: 'That was not found. Reload the page.',
        BAD_OP: 'Something went wrong. Close the form and try again.',
        BAD_SWITCH: 'Something went wrong. Reload the page.',
        STOCK_TICK_RETIRED: 'The old "Add to inventory" tick is retired — stock is recorded in Requests → Stock.',
        ITEM_IN_USE: 'That catalogue item is used in requests or stock, so its kind and unit cannot change.',
        PGRST202: 'Stock is not installed on the server yet.',
    };
    const HINTED = ['NOT_ENOUGH', 'MORE_THAN_BOUGHT', 'MORE_THAN_ISSUED', 'MORE_THAN_AWAITED', 'REQUEST_EXCEEDED'];

    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) {
                return ERRORS[code] + (HINTED.includes(code) && error && error.hint ? ' (' + error.hint + ')' : '');
            }
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    function localDay(d) {
        const x = d || new Date();
        return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }

    const pure = { KIND_LABEL, COUNT_REASONS, qty, parseQty, recordState, recordText, requestText, countDifference, canReverse, layerText,
                   placeOptions, itemLabel, needsMatch, matchProblems, moveProblems, moveBody, moveKind, countProblems,
                   ERRORS, errorMessage, localDay };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser ─────────────────────────────────────────────────────

    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const ui = { tab: 'stock', itemId: null };
    let cache = { choices: null, status: null };

    const newOp = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

    // Who is looking, from the server (stk_status).
    function me() {
        const s = cache.status || {};
        return { userId: s.user_id, isOwner: !!s.is_owner, isMainOwner: !!s.is_main_owner };
    }

    function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }

    // A refusal from the server in words — or a plain sentence as it is.
    function notice(error, title) {
        const plain = typeof error === 'string' && !/^[A-Z][A-Z_]+$/.test(error);
        RA.modal({ title: title || 'Not done', body: '<p>' + esc(plain ? error : errorMessage(error)) + '</p>', submitLabel: 'OK', onSubmit: () => {} });
    }

    async function choices() {
        if (!cache.choices) cache.choices = await RA.rpc('stk_choices');
        return cache.choices;
    }

    function options(list, selected) {
        return list.map(o => '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
    }
    function itemOptions(items, selected) {
        return '<option value="">Pick an item…</option>' +
            items.map(i => '<option value="' + esc(i.item_id) + '"' + (i.item_id === selected ? ' selected' : '') + '>' + esc(itemLabel(i)) + '</option>').join('');
    }

    // A form that sends one operation id however many times it is submitted.
    function sendOnce(fn) {
        const opId = newOp();
        return (...args) => fn(opId, ...args);
    }

    // ── Forms ───────────────────────────────────────────────────────

    // Issue / move. preset: { itemId, from, to, requestLineId, quantity,
    // returnsRecord, returnFrom, lockItem }. onDone: after saving.
    async function openMove(preset, onDone) {
        const p = preset || {};
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const places = placeOptions(ch);
        const isReturn = !!p.returnsRecord;
        const send = sendOnce((opId, body) => RA.rpc('stk_move', { p_op: opId, p_body: body }));
        RA.modal({
            title: isReturn ? 'Return to the warehouse' : (p.from === 'warehouse' || !p.from ? 'Issue from stock' : 'Move goods'),
            sub: isReturn ? 'The same lots go back. A return never reopens the request — the goods were delivered.'
                          : 'Quantities in the catalogue item\'s unit. The oldest goods go first unless you name the lot.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Item<select class="att-input" name="item"' + (p.lockItem || isReturn ? ' disabled' : '') + '>' +
                  itemOptions(ch.items, p.itemId) + '</select></label>' +
                (isReturn ? '<p class="req-muted">From ' + esc(p.returnFrom || 'the project') + ' back to the Warehouse.</p>' :
                  '<div class="stk-grid2">' +
                    '<label class="att-label">From<select class="att-input" name="from">' + options(places, p.from || 'warehouse') + '</select></label>' +
                    '<label class="att-label">To<select class="att-input" name="to">' +
                      '<option value="">Pick a place…</option>' + options(places, p.to) + '</select></label>' +
                  '</div>') +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Quantity<input class="att-input" name="qty" inputmode="decimal" value="' + esc(p.quantity ? qty(p.quantity) : '') + '"></label>' +
                  '<label class="att-label">Date received<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '</div>' +
                (isReturn ? '' :
                  '<div data-request-box><label class="att-label">Fills request<select class="att-input" name="request">' +
                    '<option value="">None — unplanned</option></select></label>' +
                  '<label class="att-label" data-unplanned>Why it is needed (unplanned)<input class="att-input" name="unplanned" maxlength="300"></label></div>') +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: isReturn ? 'Return' : 'Save',
            errorMessage,
            onOpen: (form) => {
                if (isReturn) return;
                const sync = async () => {
                    const to = form.to.value;
                    const box = form.querySelector('[data-request-box]');
                    box.style.display = to && to !== 'warehouse' ? '' : 'none';
                    if (!to || to === 'warehouse') return;
                    let lines = [];
                    try { lines = await RA.rpc('stk_request_lines', { p_folder: to }); } catch (_) { lines = []; }
                    const item = form.item.value;
                    form.request.innerHTML = '<option value="">None — unplanned</option>' + lines
                        .filter(l => !item || !l.catalog_item_id || l.catalog_item_id === item)
                        .map(l => '<option value="' + esc(l.line_id) + '"' + (l.line_id === p.requestLineId ? ' selected' : '') + '>' +
                            esc(l.description + (l.spec ? ' — ' + l.spec : '') + ' · still ' + qty(l.still_to_buy) + ' ' + l.unit + ' · ' + l.requester_name) +
                            '</option>').join('');
                    form.querySelector('[data-unplanned]').style.display = form.request.value ? 'none' : '';
                };
                form.to.addEventListener('change', sync);
                form.item.addEventListener('change', sync);
                form.request.addEventListener('change', () => {
                    form.querySelector('[data-unplanned]').style.display = form.request.value ? 'none' : '';
                });
                sync();
            },
            onSubmit: async (form) => {
                const st = isReturn
                    ? { itemId: p.itemId, quantity: form.qty.value, on: form.on.value, returnsRecord: p.returnsRecord, note: form.note.value }
                    : { itemId: p.lockItem ? p.itemId : form.item.value, from: form.from.value, to: form.to.value, quantity: form.qty.value,
                        on: form.on.value, requestLineId: form.request.value || null, unplannedReason: form.unplanned.value, note: form.note.value };
                const problems = moveProblems(st, { today: localDay() });
                if (problems.length) throw new Error(problems[0]);
                await send(moveBody(st));
            },
            onDone,
        });
    }

    async function openLeftover(onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, a) => RA.rpc('stk_leftover', Object.assign({ p_op: opId }, a)));
        let lines = [];
        RA.modal({
            title: 'Record leftovers',
            sub: 'Goods a project bought and did not use. Their cost stays with that project.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Project<select class="att-input" name="folder"><option value="">Pick a project…</option>' +
                  options(placeOptions(ch).filter(o => o.value !== 'warehouse'), null) + '</select></label>' +
                '<label class="att-label">Purchase line<select class="att-input" name="line"><option value="">Pick the project first</option></select></label>' +
                '<p class="req-muted" data-line-note></p>' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Quantity<input class="att-input" name="qty" inputmode="decimal"></label>' +
                  '<label class="att-label">Where<select class="att-input" name="where"><option value="site">Still at the site</option>' +
                    '<option value="warehouse">Brought to the warehouse</option></select></label>' +
                '</div>' +
                '<label class="att-label">Date<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Save',
            errorMessage,
            onOpen: (form) => {
                const note = form.querySelector('[data-line-note]');
                form.folder.addEventListener('change', async () => {
                    lines = [];
                    try { lines = await RA.rpc('stk_project_lines', { p_folder: form.folder.value }); } catch (e) { note.textContent = errorMessage(e); }
                    form.line.innerHTML = '<option value="">Pick a purchase line…</option>' + lines.map((l, i) =>
                        '<option value="' + i + '">' + esc(RA.formatDay(l.purchase_date) + ' · ' + l.item_name + ' · ' + qty(l.quantity) + ' ' + l.unit) + '</option>').join('');
                });
                form.line.addEventListener('change', () => {
                    const l = lines[Number(form.line.value)];
                    if (!l) { note.textContent = ''; return; }
                    note.textContent = l.match || l.auto_item_id
                        ? (l.match ? 'Counts as ' + l.match.item_name + ' (' + l.match.item_unit + '). ' : '') +
                          'Already recorded as stock: ' + qty(l.entered) + '.'
                        : 'Not matched to a catalogue item yet — ask the office to match it (Receiving tab) first.';
                });
            },
            onSubmit: async (form) => {
                const l = lines[Number(form.line.value)];
                if (!l) throw new Error('NOT_FOUND');
                if (parseQty(form.qty.value) === null) throw new Error('BAD_QUANTITY');
                await send({ p_purchase: l.purchase_id, p_line_no: l.line_no, p_qty: String(parseQty(form.qty.value)),
                             p_where: form.where.value, p_on: form.on.value, p_note: form.note.value.trim() });
            },
            onDone,
        });
    }

    async function openCount(preset, onDone) {
        const p = preset || {};
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, body) => RA.rpc('stk_count', { p_op: opId, p_body: body }));
        RA.modal({
            title: 'Count',
            sub: 'Count one item at one place. A difference waits for the main owner, with a reason.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Item<select class="att-input" name="item">' + itemOptions(ch.items, p.itemId) + '</select></label>' +
                '<label class="att-label">Place<select class="att-input" name="at">' + options(placeOptions(ch), p.at || 'warehouse') + '</select></label>' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Counted<input class="att-input" name="counted" inputmode="decimal"></label>' +
                  '<label class="att-label">Date<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '</div>' +
                '<label class="att-label">If it differs from the books: why<select class="att-input" name="reason"><option value="">—</option>' +
                  COUNT_REASONS.map(([k, label]) => '<option value="' + k + '">' + label + '</option>').join('') + '</select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Save count',
            errorMessage,
            onSubmit: async (form) => {
                const st = { itemId: form.item.value, at: form.at.value, counted: form.counted.value, on: form.on.value, reason: form.reason.value };
                const problems = countProblems(st, null, { today: localDay() });
                if (problems.length) throw new Error(problems[0]);
                const r = await send({ item_id: st.itemId, at: st.at, counted: String(parseQty(st.counted, true)), on: st.on,
                                       reason: st.reason, note: form.note.value.trim() });
                if (r && r.status === 'pending') {
                    root.setTimeout(() => notice('Counted ' + qty(r.counted) + ', the books say ' + qty(r.book) +
                        '. The difference waits for the main owner.', 'Count saved'), 0);
                }
            },
            onDone,
        });
    }

    async function openOpening(onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, body) => RA.rpc('stk_opening', { p_op: opId, p_body: body }));
        let lines = [];
        RA.modal({
            title: 'Opening stock',
            sub: 'Goods already there before stock tracking. Name the purchase when you know it (its cost stays with that project); otherwise it is untraced. The main owner confirms.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Item<select class="att-input" name="item">' + itemOptions(ch.items, null) + '</select></label>' +
                '<label class="att-label">Place<select class="att-input" name="at">' + options(placeOptions(ch), 'warehouse') + '</select></label>' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Quantity<input class="att-input" name="qty" inputmode="decimal"></label>' +
                  '<label class="att-label">Date counted<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '</div>' +
                '<label class="att-label">Bought for project (optional)<select class="att-input" name="folder"><option value="">Not known — untraced</option>' +
                  options(placeOptions(ch).filter(o => o.value !== 'warehouse'), null) + '</select></label>' +
                '<label class="att-label">Purchase line<select class="att-input" name="line"><option value="">—</option></select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Send to the owner',
            errorMessage,
            onOpen: (form) => {
                form.folder.addEventListener('change', async () => {
                    lines = [];
                    if (form.folder.value) {
                        try { lines = await RA.rpc('stk_project_lines', { p_folder: form.folder.value }); } catch (_) { lines = []; }
                    }
                    form.line.innerHTML = '<option value="">—</option>' + lines.map((l, i) =>
                        '<option value="' + i + '">' + esc(RA.formatDay(l.purchase_date) + ' · ' + l.item_name + ' · ' + qty(l.quantity) + ' ' + l.unit) + '</option>').join('');
                });
            },
            onSubmit: async (form) => {
                if (!form.item.value) throw new Error('BAD_ITEM');
                if (parseQty(form.qty.value) === null) throw new Error('BAD_QUANTITY');
                const b = { item_id: form.item.value, at: form.at.value, quantity: String(parseQty(form.qty.value)), on: form.on.value,
                            note: form.note.value.trim() };
                const l = lines[Number(form.line.value)];
                if (form.folder.value && form.line.value !== '' && l) { b.purchase_id = l.purchase_id; b.line_no = String(l.line_no); }
                await send(b);
            },
            onDone,
        });
    }

    async function openMatch(line, onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, a) => RA.rpc('stk_match', Object.assign({ p_op: opId }, a)));
        const pre = (line.match && line.match.item_id) || line.suggested_item_id || '';
        RA.modal({
            title: 'Match to a catalogue item',
            sub: line.item_name + ' · ' + qty(line.quantity) + ' ' + line.unit + ' (bought ' + RA.formatDay(line.purchase_date) + ' by ' + line.bought_by_name + ')',
            body: '<div class="stk-form">' +
                '<label class="att-label">Catalogue item<select class="att-input" name="item">' + itemOptions(ch.items, pre) + '</select></label>' +
                '<label class="att-label">How many item units is the whole line?<input class="att-input" name="covers" inputmode="decimal" value="' + esc(qty(line.quantity)) + '"></label>' +
                '<p class="req-muted" data-unit-note></p>' +
                '<label class="att-label">Note (needed for another unit)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Match',
            errorMessage,
            onOpen: (form) => {
                const sync = () => {
                    const item = ch.items.find(i => i.item_id === form.item.value);
                    const n = form.querySelector('[data-unit-note]');
                    if (!item) { n.textContent = ''; return; }
                    const same = String(line.unit).trim().toLowerCase() === String(item.unit).trim().toLowerCase();
                    form.covers.readOnly = same;
                    if (same) form.covers.value = qty(line.quantity);
                    n.textContent = same ? 'Same unit — one for one.'
                        : 'Another unit: ' + qty(line.quantity) + ' ' + line.unit + ' = how many ' + item.unit + '?' +
                          (line.can_check === false ? ' The office checks this, not whoever bought it.' : '');
                };
                form.item.addEventListener('change', sync);
                sync();
            },
            onSubmit: async (form) => {
                const item = ch.items.find(i => i.item_id === form.item.value);
                const problems = matchProblems(line, item, form.covers.value, form.note.value);
                if (problems.length) throw new Error(problems[0]);
                await send({ p_purchase: line.purchase_id, p_line_no: line.line_no, p_item: item.item_id,
                             p_covers: String(parseQty(form.covers.value)), p_note: form.note.value.trim() || null });
            },
            onDone,
        });
    }

    function openReceive(line, onDone) {
        const send = sendOnce((opId, a) => RA.rpc('stk_receive', Object.assign({ p_op: opId }, a)));
        RA.modal({
            title: 'Received',
            sub: line.item_name + ' — awaiting ' + qty(line.awaiting) + ' ' + line.unit,
            body: '<div class="stk-form">' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Quantity received (' + esc(line.unit) + ')<input class="att-input" name="qty" inputmode="decimal" value="' + esc(qty(line.awaiting)) + '"></label>' +
                  '<label class="att-label">Date<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '</div>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Received',
            errorMessage,
            onSubmit: async (form) => {
                const q = parseQty(form.qty.value);
                if (q === null) throw new Error('BAD_QUANTITY');
                if (q > Number(line.awaiting)) throw new Error('MORE_THAN_AWAITED');
                await send({ p_purchase: line.purchase_id, p_line_no: line.line_no, p_qty: String(q), p_on: form.on.value, p_note: form.note.value.trim() });
            },
            onDone,
        });
    }

    function openNotDelivered(line, onDone) {
        const send = sendOnce((opId, a) => RA.rpc('stk_not_delivered', Object.assign({ p_op: opId }, a)));
        RA.modal({
            title: 'Will not be delivered',
            sub: line.item_name + ' — awaiting ' + qty(line.awaiting) + ' ' + line.unit + '. Any money back goes through a supplier refund or credit.',
            warn: true,
            body: '<div class="stk-form">' +
                '<label class="att-label">Quantity (' + esc(line.unit) + ')<input class="att-input" name="qty" inputmode="decimal" value="' + esc(qty(line.awaiting)) + '"></label>' +
                '<label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: 'Close it',
            errorMessage,
            onSubmit: async (form) => {
                const q = parseQty(form.qty.value);
                if (q === null) throw new Error('BAD_QUANTITY');
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send({ p_purchase: line.purchase_id, p_line_no: line.line_no, p_qty: String(q), p_reason: form.reason.value.trim() });
            },
            onDone,
        });
    }

    function openReverse(r, onDone) {
        const pending = r.status === 'pending';
        const send = sendOnce((opId, reason) => RA.rpc('stk_reverse', { p_op: opId, p_record: r.id, p_reason: reason }));
        RA.modal({
            title: pending ? 'Withdraw' : 'Reverse',
            sub: recordText(r) + (pending ? '' : '. The record stays, marked reversed; record the right one afterwards.'),
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: pending ? 'Withdraw' : 'Reverse',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }

    function openDecide(r, approve, onDone) {
        const send = sendOnce((opId, note) => RA.rpc('stk_decide', { p_op: opId, p_record: r.id, p_approve: approve, p_note: note }));
        RA.modal({
            title: approve ? 'Confirm' : 'Reject',
            sub: recordText(r) + (r.kind === 'count' ? ' (' + countDifference(r) + ', ' + (r.reason || '') + ')' : ''),
            warn: !approve,
            body: '<div class="stk-form"><label class="att-label">' + (approve ? 'Note (optional)' : 'Reason') + '<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: approve ? 'Confirm' : 'Reject',
            errorMessage,
            onSubmit: async (form) => {
                if (!approve && !form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.note.value.trim());
            },
            onDone,
        });
    }

    // ── The view ────────────────────────────────────────────────────

    function tabs() {
        const t = (id, label) => '<button type="button" class="att-seg-btn' + (ui.tab === id ? ' is-on' : '') + '" data-tab="' + id + '">' + label + '</button>';
        return '<div class="att-seg" role="tablist" aria-label="Stock">' +
            t('stock', 'Stock') + t('receiving', 'Receiving') + t('pending', 'Waiting for owner') + t('history', 'History') + '</div>';
    }

    function actions() {
        const b = (act, label, primary) => '<button type="button" class="att-btn att-btn--sm' + (primary ? ' att-btn--primary' : '') + '" data-action="' + act + '">' + label + '</button>';
        return '<div class="stk-actions">' + b('move', 'Issue / move', true) + b('leftover', 'Record leftovers') + b('count', 'Count') + b('opening', 'Opening stock') + '</div>';
    }

    function recordRow(r, m) {
        const st = recordState(r);
        const req = requestText(r);
        return '<div class="stk-rec' + (r.reversed ? ' is-reversed' : '') + '" data-record="' + esc(r.id) + '">' +
            '<div class="stk-rec-main"><strong>' + esc(KIND_LABEL[r.kind] || r.kind) + '</strong> ' + (st ? pill(st[0], st[1]) : '') +
              '<div>' + esc(recordText(r)) + '</div>' +
              (req ? '<div class="req-muted">' + esc(req) + '</div>' : '') +
              (r.kind === 'count' && r.status !== 'done' || (r.kind === 'count' && Number(r.quantity) !== Number(r.book_quantity))
                ? '<div class="req-muted">Difference ' + esc(countDifference(r)) + (r.reason ? ' · ' + esc(r.reason) : '') + '</div>' : '') +
              (r.reason && r.kind === 'not_delivered' ? '<div class="req-muted">' + esc(r.reason) + '</div>' : '') +
              (r.note ? '<div class="req-muted">Note: ' + esc(r.note) + '</div>' : '') +
              '<div class="req-muted">' + esc(r.recorded_by_name) + ' · ' + esc(RA.formatDay(r.on)) +
                (r.decided_by_name ? ' · ' + esc(r.status === 'rejected' ? 'rejected' : r.status === 'withdrawn' ? 'withdrawn' : 'confirmed') + ' by ' + esc(r.decided_by_name) +
                  (r.decision_note ? ': ' + esc(r.decision_note) : '') : '') +
                (r.reversed ? ' · reversed by ' + esc(r.reversed_by_name) + ': ' + esc(r.reverse_reason) : '') + '</div>' +
            '</div>' +
            '<div class="stk-rec-acts">' +
              (r.kind === 'issue' && Number(r.returnable) > 0 ? '<button type="button" class="att-btn att-btn--sm" data-rec-act="return">Return…</button>' : '') +
              (r.status === 'pending' && m.isMainOwner ? '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-rec-act="confirm">Confirm</button>' +
                '<button type="button" class="att-btn att-btn--sm" data-rec-act="reject">Reject</button>' : '') +
              (canReverse(r, m) ? '<button type="button" class="att-btn att-btn--sm" data-rec-act="reverse">' + (r.status === 'pending' ? 'Withdraw' : 'Reverse') + '</button>' : '') +
            '</div></div>';
    }

    function itemCard(i) {
        return '<div class="att-card stk-item" data-item="' + esc(i.item_id) + '"><div class="att-card-body">' +
            '<div class="stk-item-head"><strong>' + esc(i.name) + '</strong>' + (i.spec ? ' <span class="req-muted">' + esc(i.spec) + '</span>' : '') +
              '<span class="stk-item-total">' + esc(qty(i.total)) + ' ' + esc(i.unit) + '</span></div>' +
            '<div class="stk-places">' + i.places.map(p => '<span class="stk-place' + (p.kind === 'warehouse' ? ' is-warehouse' : '') + '">' +
              esc(p.name) + ': <strong>' + esc(qty(p.quantity)) + '</strong></span>').join('') + '</div>' +
            '</div></div>';
    }

    function lineCard(l) {
        const match = l.match ? 'Counts as ' + l.match.item_name + (l.match.auto ? '' : ' (' + qty(l.match.covers) + ' ' + l.match.item_unit + ' for ' + qty(l.match.per) + ' ' + l.unit + ')')
                              : 'Not matched yet';
        return '<div class="att-card stk-line"><div class="att-card-body">' +
            '<div><strong>' + esc(l.item_name) + '</strong> · ' + esc(qty(l.quantity)) + ' ' + esc(l.unit) +
              ' <span class="req-muted">bought ' + esc(RA.formatDay(l.purchase_date)) + ' by ' + esc(l.bought_by_name) + '</span></div>' +
            '<div class="req-muted">Received ' + esc(qty(l.received)) + (Number(l.not_delivered) > 0 ? ' · not delivered ' + esc(qty(l.not_delivered)) : '') +
              ' · <strong>awaiting ' + esc(qty(l.awaiting)) + '</strong></div>' +
            '<div>' + (l.match ? pill(match, 'done') : pill(match, 'working')) + '</div>' +
            '<div class="stk-line-acts" data-line="' + esc(l.purchase_id + ':' + l.line_no) + '">' +
              (Number(l.awaiting) > 0 ? '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-line-act="receive">Received…</button>' +
                '<button type="button" class="att-btn att-btn--sm" data-line-act="nd">Not delivered…</button>' : '') +
              '<button type="button" class="att-btn att-btn--sm" data-line-act="match">' + (l.match ? 'Change match…' : 'Match…') + '</button>' +
            '</div></div></div>';
    }

    async function renderItem(body, itemId, reload) {
        body.innerHTML = '<div class="att-empty">Loading…</div>';
        let it;
        try { it = await RA.rpc('stk_item', { p_item: itemId }); } catch (e) { RA.fail(body, e); return; }
        const m = me();
        body.innerHTML =
            '<button type="button" class="att-btn att-btn--sm" data-back>← All items</button>' +
            '<h3 class="stk-h">' + esc(itemLabel(it)) + '</h3>' +
            '<div class="stk-lots">' + (it.lots.length ? it.lots.map(l =>
                '<div class="stk-lot"><div><strong>' + esc(l.untraced ? 'Untraced (old stock)' : (l.line_item || 'Purchase')) + '</strong> · ' +
                  esc(l.untraced ? 'counted ' : 'bought ') + esc(RA.formatDay(l.since)) +
                  (l.cost_folder_name ? ' · ' + esc(l.cost_folder_name) + '\'s leftovers' : '') + '</div>' +
                  '<div class="req-muted">' + (l.places.length ? l.places.map(p => esc(p.name) + ': ' + esc(qty(p.quantity))).join(' · ') : 'Nothing left') + '</div>' +
                  (l.layers && l.layers.length ? '<div class="req-muted">' + layerText(l.layers) + '</div>' : '') + '</div>').join('')
              : '<div class="att-empty">No lots yet.</div>') + '</div>' +
            '<div class="stk-actions">' +
              '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-item-act="move">Issue / move</button>' +
              '<button type="button" class="att-btn att-btn--sm" data-item-act="count">Count</button></div>' +
            '<h3 class="stk-h">History</h3>' +
            '<div class="stk-recs">' + (it.records.map(r => recordRow(r, m)).join('') || '<div class="att-empty">Nothing yet.</div>') + '</div>';
        body.querySelector('[data-back]').addEventListener('click', () => { ui.itemId = null; reload(); });
        body.querySelector('[data-item-act="move"]').addEventListener('click', () => openMove({ itemId: it.item_id }, reload));
        body.querySelector('[data-item-act="count"]').addEventListener('click', () => openCount({ itemId: it.item_id }, reload));
        wireRecords(body, it.records, reload);
    }

    function wireRecords(scope, records, reload) {
        scope.querySelectorAll('[data-rec-act]').forEach(b => b.addEventListener('click', () => {
            const id = b.closest('[data-record]').dataset.record;
            const r = records.find(x => x.id === id);
            if (!r) return;
            const act = b.dataset.recAct;
            if (act === 'reverse') return openReverse(r, reload);
            if (act === 'confirm') return openDecide(r, true, reload);
            if (act === 'reject') return openDecide(r, false, reload);
            if (act === 'return') return openMove({ itemId: r.item_id, returnsRecord: r.id, returnFrom: r.to_name, quantity: r.returnable }, reload);
        }));
    }

    async function render(host) {
        host.innerHTML = '<div class="att-stack stk-tab req-detail"><div class="att-empty">Loading…</div></div>';
        let status;
        try { status = await RA.rpc('stk_status'); } catch (e) { RA.fail(host, e); return; }
        cache.status = status;
        root.currentStockMainOwner = !!(status && status.is_main_owner);
        if (!status || !status.enabled) return renderOff(host, status);
        const reload = () => render(host);
        host.innerHTML =
            '<div class="att-stack stk-tab req-detail">' +
              RA.head('Stock', 'Where goods are, in catalogue units. Quantities only — values come with owner-confirmed cost moves.', tabs()) +
              actions() +
              '<div data-body><div class="att-empty">Loading…</div></div>' +
            '</div>';
        host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            if (ui.tab === b.dataset.tab) return;
            ui.tab = b.dataset.tab; ui.itemId = null;
            render(host);
        }));
        host.querySelector('[data-action="move"]').addEventListener('click', () => openMove({}, reload));
        host.querySelector('[data-action="leftover"]').addEventListener('click', () => openLeftover(reload));
        host.querySelector('[data-action="count"]').addEventListener('click', () => openCount({}, reload));
        host.querySelector('[data-action="opening"]').addEventListener('click', () => openOpening(reload));
        const body = host.querySelector('[data-body]');
        cache.choices = null;
        if (ui.tab === 'stock' && ui.itemId) return renderItem(body, ui.itemId, reload);
        let ov;
        try { ov = await RA.rpc('stk_overview'); } catch (e) { RA.fail(body, e); return; }
        const m = me();
        if (ui.tab === 'receiving') {
            body.innerHTML = ov.awaiting.length ? ov.awaiting.map(lineCard).join('')
                : '<div class="att-empty">Nothing awaiting delivery or a match.</div>';
            body.querySelectorAll('[data-line-act]').forEach(b => b.addEventListener('click', () => {
                const key = b.closest('[data-line]').dataset.line;
                const l = ov.awaiting.find(x => x.purchase_id + ':' + x.line_no === key);
                if (!l) return;
                if (b.dataset.lineAct === 'receive') return openReceive(l, reload);
                if (b.dataset.lineAct === 'nd') return openNotDelivered(l, reload);
                return openMatch(l, reload);
            }));
        } else if (ui.tab === 'pending') {
            body.innerHTML = (ov.pending.length ? '<div class="stk-recs">' + ov.pending.map(r => recordRow(r, m)).join('') + '</div>'
                : '<div class="att-empty">Nothing is waiting for the owner.</div>') +
                (m.isMainOwner ? '' : '<p class="req-muted">Only the main owner confirms counts and opening stock.</p>');
            wireRecords(body, ov.pending, reload);
        } else if (ui.tab === 'history') {
            body.innerHTML = ov.recent.length ? '<div class="stk-recs">' + ov.recent.map(r => recordRow(r, m)).join('') + '</div>'
                : '<div class="att-empty">No stock records yet.</div>';
            wireRecords(body, ov.recent, reload);
        } else {
            body.innerHTML = (ov.pending.length ? '<div class="att-info"><i data-lucide="clock"></i><div>' + ov.pending.length +
                    ' waiting for the owner.</div></div>' : '') +
                (ov.items.length ? ov.items.map(itemCard).join('') : '<div class="att-empty">No stock yet. Receive a warehouse purchase, record leftovers or opening stock.</div>');
            body.querySelectorAll('[data-item]').forEach(c => c.addEventListener('click', () => { ui.itemId = c.dataset.item; render(host); }));
        }
        RA.icons();
    }

    // Before launch: nobody sees the tab except the main owner, who sees the switch.
    function renderOff(host, status) {
        if (!status || !status.is_main_owner) {
            host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' +
                esc(ERRORS.STOCK_OFF) + '</div></div></div>';
            RA.icons();
            return;
        }
        host.innerHTML =
            '<div class="att-stack stk-tab">' +
              RA.head('Stock', 'Not switched on yet.', '') +
              '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
                'Switch stock on <strong>only at launch</strong> — after owner-confirmed cost moves (2C) and the phone (2B-b) are ready. ' +
                'Once it is on, the old "Add to inventory" tick stops working, and staff start recording stock here.</div></div>' +
              '<button type="button" class="att-btn att-btn--warn" data-switch>Switch stock on…</button>' +
            '</div>';
        host.querySelector('[data-switch]').addEventListener('click', () => RA.modal({
            title: 'Switch stock on',
            sub: 'Type STOCK to confirm. Do this only at launch.',
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Type STOCK<input class="att-input" name="word" autocomplete="off"></label></div>',
            submitLabel: 'Switch on',
            errorMessage,
            onSubmit: async (form) => {
                if (form.word.value.trim() !== 'STOCK') throw new Error('Type STOCK to confirm.');
                await RA.rpc('stk_set_enabled', { p_on: true });
                root.currentStockOn = true;
            },
            onDone: () => root.location.reload(),
        }));
        RA.icons();
    }

    // The shopping list's "Issue from stock": the issue form for one request line.
    function openIssue(line, onDone) {
        return openMove({ itemId: line.catalog_item_id, from: 'warehouse', to: line.work_id, requestLineId: line.line_id,
                          quantity: Math.min(Number(line.in_warehouse) || 0, Number(line.still_to_buy) || 0), lockItem: true }, onDone);
    }

    root.StockAdmin = Object.assign({}, pure, { openIssue, render });
    RA.views.reqStock = render;
})(typeof window !== 'undefined' ? window : globalThis);
```

**Modify:** `package.json` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/package.json b/package.json
index 4788c99..a9630f6 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
```


- [ ] **Step 1: Apply the files above** (Modify blocks with `git apply --ignore-whitespace`; `admin.html` keeps the user's own uncommitted edit).
- [ ] **Step 2: Tests.** `npm test` → every suite passes (**40**), including the new `stock-admin.test.js` (**16**), `purchasing-admin.test.js` (51) and `requests-admin.test.js`. `node --check` on every `js/*.js` and `tests/*.js`. `npm run test:sql` is unchanged from Task 1 (Task 2 touches no SQL).
- [ ] **Step 3: Stop for the user** to review and commit.

### Task 3: Live — 0104 applied with stock off, verified, the web pushed

- [ ] **Step 1: The user applies the committed 0104** (Tasks 1–2 committed first): the whole file, unchanged, once, in the Supabase SQL editor.
- [ ] **Step 2: Verify the live database ourselves** (MCP `execute_sql`, read-only): every function in 0104 matches the file (`md5(replace(prosrc, chr(13), ''))`); the 17 callable stock functions and `pr_office_save_item` are executable by `authenticated` and not `anon`; every other `stk_*` function, `pr_item_in_use` and the `pr_portion_*` / `pr_line_*` helpers by neither; the eight `stk_*` tables have RLS on and no policy; the four triggers exist (`stk_guard_line`, `stk_guard_void`, `stk_inventory_frozen`, `stk_item_fixed`); **`stk_settings` is empty (stock off)**; and the Catalogue still saves an unused item normally.
- [ ] **Step 3: Live acceptance.** Run `supabase/tests/2b_acceptance.sql` through MCP `execute_sql`. Expect `2b acceptance: all checks passed`. It rolls itself back; check afterwards that no `ZZ 2b` folder, catalogue item or purchase exists, `stk_settings` and `stk_records` are empty, and staff@'s Buyer switch is unchanged.
- [ ] **Step 4: The user pushes Dacs Web.**
- [ ] **Step 5: Browser check (no stock action).** As the main owner: Requests shows **Stock**; it says "Not switched on yet" with the switch and the warning — **do not press it**. The Add Expense form still has "Also add this to inventory" (stock is off). Requests → Catalogue: an item used by requests still shows Kind and Unit locked; an unused one can change. As staff@: no Stock tab; the shopping list unchanged. `client_errors` since the push: nothing new.
- [ ] **Step 6: Execution notes** in this plan; memory updated. Next: plan 2C (cost moves, the owner approvals), then 2B-b (the phone), then the joint pilot (Q30) — the switch goes on only after it passes.

---

## Self-review (against the answers)

| Answer | Where |
|---|---|
| Q1 (three plans, one launch) | R53: 0104 live but switched off; the switch is the main owner's; Task 3 never turns it on |
| Q2 (warehouse + project sites) | `stk_locations`: one warehouse, a site per folder (Main Contract or Additional Works), made on first use; test "moves between projects…" |
| Q3 (warehouse = stock; project = leftovers keep their cost) | `stk_leftover`, lot `cost_folder_id`; test "leftovers of a project purchase…" |
| Q4, Q5 (To match; units by the office; units fixed) | `stk_match`, `stk_ensure_match` (R54, R55); the item's kind and unit fixed once stock uses it (R70); tests "a warehouse line waits…", "a different unit…", "the same unit…", "a catalogue item's kind and unit are fixed once stock uses it…"; race 8 |
| Q6, Q7 (receive in parts; not delivered; who) | `stk_receive`, `stk_not_delivered` (R56); tests "a warehouse line waits…", "not delivered…", "receiving and closing…" |
| Q8, Q9 (issue fills a request or is unplanned; no reservations) | `stk_move` + `stk_cover`, `pr_portion_bought` (R58, R59); the shopping list's hint; tests "an issue fills a request…", "…names a request line or an unplanned reason", "picked portions…"; race 5 |
| Q10 (returns) | `returns_record`: the issue's own lots back (R57); test "several issues… and a return…"; cost: 2C |
| Q11 (who records) | `stk_actor` (R52); test "who records…" |
| Q12 (by lot, oldest received first, fixed when moved) | Layers by received day; `stk_take` takes the oldest received layer, or within the named lot (R65, R71); tests "oldest RECEIVED first, by delivery…", "a delivery is reversed only while its own goods are still there…", "lots: oldest received first…"; values: 2C |
| Q13 (opening, traced or untraced) | `stk_opening` + `stk_decide` (R61); test "opening stock…" |
| Q14–Q20, Q24, Q25 (the money of moves, approvals) | **2C** — nothing here writes a peso; test "no stock action writes a peso…" |
| Q16 (completed projects) | Physical records allowed, marked (R67); test "the Stock screen…" |
| Q21, Q22 (corrections and voids with stock) | Triggers `stk_guard_line`, `stk_guard_void` (R63); tests "a correction may not undo stock…", "a purchase with stock records cannot be voided…", "a matched line whose unit is corrected…"; race 4 |
| Q23 (never edited; reversing) | `stk_reverse` (R62); tests "a mistaken issue is reversed…", "reversing is refused while the goods have moved on…", "who reverses…"; race 3 |
| Q26 (the phone) | 2B-b; every call it needs exists here |
| Q27 (counts, losses) | `stk_count` + `stk_decide` (R60); tests on counts; race 7 |
| Q28 (who sees values) | Quantities only (R66); test "no read carries a peso amount" |
| Q29 (the old tick) | `stk_inventory_frozen` + the form and nav (R64); tests "the old tick…" (server) and "one stock path" (screens) |
| Q30 (pilot) | After 2C and 2B-b; Task 3 only proves 0104 live with stock off |

No placeholders. Every task ends with its whole suite green on its own.

## Proof

Built in a scratch clone of Dacs Web on `be1add8`: Task 1 = `d4714b0`, Task 2 = `aba54da` (revision 2 was `5359f28` / `daf6db4`, revision 1 `f2d054e` / `7b86493`).

- **Revision 3 (review finding, rounding):** the new test "three boxes entered separately total exactly 100 pieces — even with their receipt dates out of order, backdated, reversed and received again" **fails on revision 2** (the second box, dated before the first, got 33.333 — on the way to 99.999) and passes now: box 1 (yesterday) 33.333, box 2 (the day before) 33.334, box 3 (earlier still) 33.333 = 100; each existing box keeps its quantity at every step; box 2 reversed → 66.666; a box received again dated ten days back → 33.334, exactly 100; three boxes received before the match, dates out of order, total exactly 100 at the match. Three new breaks — revision 2's date-order rule restored, each box converted alone, what is in stock not counted as assigned — are all caught.

- **Revision 2 (review findings):** each fix has tests that fail without it. *(1) Kind and unit:* "a catalogue item's kind and unit are fixed once stock uses it — a match is enough, no request needed" (a matched warehouse line; a project line only matched — no lot, no record; a waiting opening count; through the Catalogue save, a direct table update, and the catalogue list's `in_use`), and race 8 "a unit change while stock is first matched to the item, at once: one wins" (15 rounds — fails without the row lock). *(2) Oldest received first:* "oldest RECEIVED first, by delivery…" (an old purchase delivered in two parts, a newer purchase delivered in between and received before it was matched, a return, a loss from a count, a delivery entered late but received earliest, a named lot, the item screen's list), "a delivery is reversed only while its own goods are still there…", the three-box line received one box at a time (exactly 100), and every lot's layers add up to its balance with none below zero. Revision 1's rule "a match can change until the goods move" became "until any of its goods are stock" — its test was rewritten (R55).
- **Task 1:** `npm test` green (39 suites, 1,284 checks). `npm run test:sql` green (**25 suites, 755 checks**): `2b_stock` 38, `2b_concurrency` 8 × 15 rounds with no deadlock, and the 2A suites with 0104 on top — 2A-1 with stock **off** (the old tick's own tests still pass: nothing changes before launch), 2A-2 / 2A-3 / 2A-4 with stock **on** (purchasing, unit checks, change requests, phone purchases and payments behave exactly as before).
- **Task 2:** `npm test` green (40 suites, 1,300 checks); every JS file passes `node --check`.
- **Acceptance:** `2b_acceptance.sql` run as written on a throwaway PostgreSQL with Supabase-style JWT claims (`_dry2b` harness): `2b acceptance: all checks passed`, **0 rows left**. It now also checks, live, that the ZZ item's unit cannot change once matched (B6, B7) and that a delivery received yesterday is issued before today's (C6, C7). Its first runs caught two script bugs — a Purchasing-tab line needs an unplanned reason (rev 1); and staff cannot read the stock tables directly, so C7 reads through the Stock screen's own read (rev 2) — both fixed.
- **Live, read-only (25 Oct):** the four functions 0104 redefines and the 14 helpers it relies on match their migration files exactly (`md5(replace(prosrc, chr(13), ''))`, 18/18); no `stk_*` table or function exists; `inventory` has 0 rows, there are 0 warehouse purchase lines, and one old purchase line still carries the tick (after launch, replacing that purchase with the tick still on can be refused `STOCK_TICK_RETIRED` — untick it then; a correction is unaffected). Revision 2 also redefines 0092's `pr_office_save_item` / `pr_office_catalog`: their only change is the in-use test (now `pr_item_in_use`); Task 3 Step 2 checks the Catalogue still saves an unused item.
- **Breakage run: 71 / 71 caught** — each rule broken on purpose, one at a time, and a suite must fail: the switch (writes or reads while off, anyone switching it on, readers without Expenses); balances and layers (never short, the unit ratio upside down, issued by purchase date, newest received first, the received day ignored, receipts before the match lost, a receipt after the match not stock, receipts converted one by one, receipts assigned in date order (revision 2's rounding bug), what is in stock not counted as assigned, a layer borrowed from a later delivery, a return to another layer, the item lock gone — caught by the race test); receiving and matching (past what is awaited, not delivered without a reason, the buyer checking their own unit, a re-match after receiving, a same-unit match at another ratio, an automatic match ignoring the unit); the item lock (a match, or a waiting record, not fixing the item; the unit changed around the save; the save ignoring stock; the catalogue form unlocked; the item row not held — caught by race 8); leftovers and opening stock (past the line, leftovers turned company stock, pending openings not counted, opening from a warehouse line); moves and requests (unplanned without a reason, a request for the warehouse or for another project, past its need, another unit, a cancelled line, returned twice, stock not counted as covered, Bought including stock, no warehouse hint); counts (two open counts, a stale count confirmed, a loss not taken off, a difference without a reason); reversals (an issue under its return, after the goods moved on, anyone reversing, staff reversing a confirmed count); purchases (a correction below what was received, another unit, a leftover line moved to another project, a void with stock, the old tick still writing); history and access (history editable, a helper callable, a table readable, a retry recorded twice, a read naming the supplier); the screens (no unplanned reason asked, a new operation id per press, the count reason unchecked, a peso shown, the Stock tab always shown, the old Inventory screen kept, the tick still sent, Issue from stock while off, the in-use sentence omitting stock, layers out of order). Revision 3's run: 71/71 (the three new breaks included). Revision 1's run: 56/56 after one gap (an automatic match ignoring the unit) was closed. Revision 2's first run missed three — the three-box test happened to round cleanly (now one box at a time), the match-only case also had a lot (now a project line matched and nothing more), and the Catalogue save's own check is backed by the trigger, so only a source check can tell (added) — each closed, then caught.
- Every file was restored and compared byte for byte after each breakage run.

## Rehearsal

Two fresh clones of the real repo at `be1add8` (`core.autocrlf=false`, set before applying — otherwise `git apply` writes CRLF). Both tasks were applied **from this plan's text only** — Create blocks written as given, Modify blocks with `git apply --ignore-whitespace` after `--check` — plus Task 1's CRLF command. Done again from scratch for revisions 2 and 3.

- Clean clone: **25 blocks** (`package.json` has one per task) → all **24 files byte-identical** to the tested build (raw bytes, line endings included); no other file touched. `npm test` on the result: 40 suites green; `2b_stock.pglite.mjs`: 38 passed.
- Clone carrying the user's own uncommitted one-space edit in `admin.html` (as in the real repo today): the same 25 blocks apply, the 24 files match, and the edit is still there, unchanged.
