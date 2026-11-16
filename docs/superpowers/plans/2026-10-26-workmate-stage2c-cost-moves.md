# WorkMate Stage 2C — Owner-confirmed stock cost moves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When goods move from the company's warehouse to a project, from one project to another, or back to the warehouse, the **main owner** decides whether their **cost** moves too — and when approved, the cost lands in the right project's Spent (and leaves the giving one) as ordinary, labelled expense rows, so every peso of a purchase sits in exactly one place. Stock stays **switched off** until the joint launch with 2B-b (the phone).

**Architecture:** One migration, **0105**, on top of 2B-a's 0104. Every stock move row now carries its **holder** (whose cost the goods are: the company or a project). After each physical move the server opens a **pending cost move** wherever goods arrive in someone else's cost; the main owner approves (whole, for what is still there) or rejects with a reason; a stock recorder may ask again for the same movement. Approval values the goods **by lot** (the purchase line's cost with its discount and delivery-fee shares; the last portion takes the remainder) and writes `expenses` rows tied to the cost move (`stk_cost_move_id`): the receiving project funded like a purchase (`pur_fund`, for the month it received the goods), the giving project negative rows on every billing period / Cover group that carried that lot's cost, in proportion (`pur_prorate`). A warehouse loss of company goods moves their value to **company stock loss** with the count. Nothing is edited: cost moves are reversed by the main owner with a reason; a physical record under an approved cost move, a purchase price under approved moves, and deleting a project or period that holds stock are all refused by the database. Dacs Web: cost-move states on the Stock screen, approval cards in **Purchasing → Owner approvals** (and Stock → Waiting for owner), a **Company stock** tab for owner accounts, and read-only "Stock cost move" rows in Project Control and Expenses whose pesos staff never see. Every peso of stock lives in one new file, `js/stock-cost-admin.js`.

**Tech stack:** PostgreSQL / Supabase (plpgsql), vanilla JS, Node test files, PGlite, embedded PostgreSQL for the two-sessions tests.

**Spec:** [Mobile Purchasing](../specs/2026-09-30-workmate-mobile-purchasing-design.md) (*Warehouse cost assignment*, *Project-to-project material cost transfers*, §3.8) · answers: [2B + 2C questions](../specs/2026-10-24-workmate-stage2bc-questions.md) — **Q1–Q30 = A ("I approve all R", 24 Oct 2026)** · built on: plan [2B-a](2026-10-25-workmate-stage2b-a-stock.md) (0104, live with stock off since 26 Oct) · purchasing as built: plans [2A-2](2026-10-16-workmate-stage2a2-purchasing-office.md), [2A-4b](2026-10-23-workmate-stage2a4b-buyer-payments.md)

**Repo:** **Dacs Web** only (base `2422950`). Plan 2B-b (the phone) follows; then one joint ZZ pilot, then launch (Q1, Q30).

**Status:** Revision 2, 26 October 2026, **for the user's review**. Revision 2 fixes the user's review finding on **R81** (which accepted R79, R83 and R84): revision 1 let a purchase be **re-funded** — its rows moved to other billing periods or off Cover — while approved cost moves still relied on where its cost sat, leaving those moves' rows on the old periods. Now each approved cost move keeps where its purchase's cost sat (`basis_alloc`), and **any correction, re-fund or approved change request that would move the purchase's rows is refused** (`STOCK_COST_FUNDING`) until those cost moves are reversed. A regression test re-funds after a partial transfer and checks period totals, Cover and later transfers; a ninth two-sessions test races a re-fund against an approval. Stock stays **switched off**. Nothing is applied live and nothing is in the repo yet. The code below was built and tested first in a scratch clone (one commit per task, every suite green after each), every important rule was broken on purpose to prove a test catches it (see *Proof*), and the plan was then re-applied to fresh clones from its own text and compared byte for byte (see *Rehearsal*).

## Global Constraints

- **Inside the money model, through ordinary rows (CLAUDE.md, Q24, Q25):** an approved cost move is **expense rows** — Material, Spent and Cover read them like any other row; nothing in the browser filters, funds or totals them. The four places of a purchase line's pesos: its project's Spent, **company stock** (warehouse, or issued with the assignment pending), a receiving project's Spent, **company stock loss**. Company stock is never in a project's Spent and never G&A. **Client billing is never changed** (Q25).
- **Main owner only (CLAUDE.md, Q18):** approving, rejecting and reversing a cost move is the main owner's (`pur_main_owner()`: role owner, `owner_id` null, active, allowed Expenses). Stock recorders (0104's) may ask again after a rejection or a reversal.
- **Who sees pesos (Q28):** owner accounts see values and Company stock; **staff never** — not Buyer staff, not in Project Control's Materials list (the 15 Oct data-entry exception does not reach cost moves: staff see the row, its "Stock cost move" tag and its state, never its amount, and their subtotals leave it out). Workers and team leaders see nothing of it.
- **New data needs real DB columns:** 0105 adds `stk_moves.holder`, `expenses.stk_cost_move_id`, `stk_events.cost_move_id` and the table `stk_cost_moves`. It **redefines** from 0104 `stk_take`, `stk_check_record`, `stk_move`, `stk_decide`, `stk_reverse`, `stk_record_json` and from 0096 `pur_guard_expense_row`, `pur_guard_delete` — copied from their files with small, named changes; Task 3 Step 1 checks the live bodies still match those files before applying.
- **Migrations:** next number = highest + 1 = **0105** (highest on disk: `0104_stock.sql`). The user applies the **committed** file, unchanged, once (SQL editor). We then verify the live database ourselves.
- **Stock stays off (Q1, Q30):** 0105 goes live in Task 3 with stock **switched off** — every cost function answers `STOCK_OFF` (the Owner approvals list is simply empty). **Do not switch stock on** in this plan: it goes on at the joint launch after 2B-b and the joint pilot.
- **Dates:** a cost move's funding month is the day the project received the goods (the movement's date, Manila); the screens build "today" from local parts, never `toISOString()`.
- **Mirror portal edits:** not needed — `admin.html` only; the client and partner portals never read `expenses`.
- **The user commits.** Executors never run `git commit` or `git push`. Each task ends at a "stop for the user" step. The user's own uncommitted edit in `admin.html` stays as it is: apply the Modify blocks with `git apply`, which leaves the rest of the file alone.
- **CRLF files:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are CRLF. Task 1's Step 1 restores CRLF after applying (the diffs are shown with LF).

## Rulings (2C)

R1–R72 stand (plans 2A-2 … 2B-a). New, found while building and testing this plan. **For the user's approval with the plan.**

| # | Ruling |
|---|---|
| R73 | **The server asks; nobody fills in a cost form.** After every physical record the server opens one pending cost move per moved lot and delivery wherever goods arrive in someone else's cost: at a project whose cost they are not — **assign** from company stock (Q11's "Cost assignment pending") or **transfer** from another project (Q12); a **company** lot's goods brought to the warehouse while a project holds them — **back** to company stock (Q10). A project's own leftovers keep their cost in the warehouse (12 Oct), and untraced old stock never asks (₱0, Q13). |
| R74 | **Whose cost goods are (the holder).** Every stock move row carries the holder of the goods it moved; goods entering stock take their lot's own (a warehouse purchase: the company; leftovers and traced opening stock: their project). Until the main owner approves, goods at a project still belong to their old holder. Within one delivery at a place, goods **not yet** the place's own leave first — so a pending assignment shrinks before goods already charged leave. A return takes the issue's goods as their cost now stands: the project's own once its assignment was approved (then it asks to go **back**), else the company's (then nothing to ask — the pending assignment shrinks, Q10). |
| R75 | **A pending cost move covers what is still there (Q10, Q20).** Its quantity is never more than its holder still has there after the earlier pending requests on the same goods; goods that left before approval are not charged. Approval is whole, for that quantity; with nothing left, only a rejection (with a reason). The card says so. |
| R76 | **Value by lot (Q12).** A purchase line is worth its item amount less its discount shares plus its delivery-fee shares, for its quantity in item units; its own holder starts with all of it. Each approved move takes the line's cost × quantity ÷ the line's quantity, to the centavo (never more than the giving holder holds), and the **last** portion out of a holder takes what it holds — so a line's portions always add up to it exactly (₱100 for 3 pieces → ₱33.33 + ₱33.33 + ₱33.34; ₱995 for 100 → ₱328.35 + ₱328.35 + ₱338.30). The value is fixed at approval; a pending one shows an estimate that follows a corrected price (Q21). |
| R77 | **The rows (Q14, Q15, Q25).** Receiving project: funded like a purchase for the month it **received** the goods — its periods for that month, earliest billing number first, the rest Cover; an Additional Works job its own period — labelled **"From warehouse — item"** or **"Moved from A — item"**. Giving project: negative rows on every (billing period, Cover) group that carried that lot's cost for it — its purchase line rows, its share of the delivery-fee rows, earlier cost-move rows — in proportion, largest remainder first (as fee shares), labelled **"Moved to B — item"** or **"Back to company stock — item"**. A split is one row on screen (`split_group`). |
| R78 | **Company stock loss (Q27).** When the main owner confirms a count that lost company-held goods of a traced lot, their value moves to company stock loss with the confirmation — no expense row, no project, not G&A; reversing the count brings it back. A project's own leftovers lost stay its cost (already Spent). |
| R79 | **Reject and ask again (Q19, Q20).** Reject needs a reason; the goods stay recorded where they are and the cost stays where it was — **"Cost move rejected — kept with source"**. A stock recorder asks again **for the same movement** with a note (no second physical record); one open request per movement. A wrong lot or quantity is fixed by reversing the physical record and recording the right one (Q12, Q23). After the main owner reverses an approved cost move (say, to fix a purchase's price), it may be asked again the same way. |
| R80 | **Reversing (Q23).** An approved cost move is never edited: the main owner reverses it with a reason; its rows leave Spent, the record stays. Refused while later movements or cost moves rely on it (reverse those first — newest first). A physical record whose cost the owner approved is not reversed until that cost move is (`COST_MOVED`); its pending ones are withdrawn with it. A count's loss is reversed with the count. |
| R81 | **A purchase under approved moves stays as it is — its price and where its cost sits (Q21, rev 2).** While approved cost moves rely on a purchase, a correction, unit check, **re-funding** or approved change request is refused if it would change a lot's value or quantity (`STOCK_COST_IN_USE`) **or move any of the purchase's rows to another billing period, project or onto/off Cover** (`STOCK_COST_FUNDING`) — the main owner reverses those cost moves first (newest first), then re-funds or corrects, then the moves are asked for again. Each approved cost move keeps both: the lot's price and quantity, and the purchase's rows summed by billing period, project and Cover (`basis_alloc`). Checked by the database after the purchase is stored again, so every 2A path is covered; a refused change leaves no trace. A change that moves no peso and no row (supplier, notes) is fine. Note: a transfer out frees room in the giving period, so after one, a re-fund would usually move rows — and is refused. Pending moves simply follow the purchase as it is. |
| R82 | **Completed projects (Q16).** Approving a cost move into or out of a completed project — or a job under one — is refused until it is reopened; rejecting is allowed; the physical record stays. |
| R83 | **Who sees what (Q28).** Values (approved value, the card's estimate, Company stock) reach **owner accounts only** — for anyone else the server leaves the keys out. Staff see each cost move's state and words. In Project Control staff see a "Stock cost move" row and its state, **never its pesos**, and their category subtotals leave it out; their Spent-based figures stay hidden as before. |
| R84 | **Where (Q17, Q18).** The main owner approves on cards in **Purchasing → Owner approvals** (the same cards in Stock → Waiting for owner): item, quantity still there, from → to, value, the receiving month, the giving project's billing periods and Cover it comes off, the record and its note. **Company stock** is a Purchasing tab for owner accounts once stock is on: by item — in the warehouse, issued with the assignment pending, awaiting delivery, company stock loss. |
| R85 | **Nothing deleted under stock.** A project with live stock records or open cost moves, or a billing period carrying cost-move rows, is never deleted (`STOCK_LIVE`) — mark it completed instead. |
| R86 | **Cost-move rows are read-only everywhere.** The database refuses any insert, change or delete of them outside the stock functions (`STOCK_COST_ROW`); Project Control and Expenses tag them **"Stock cost move"**, never offer a part-by-part edit, say why on Edit / Delete, and take their Cover flag from the server (never the old budget guess). |
| R87 | **One place for stock pesos.** Every peso of stock on screen is `js/stock-cost-admin.js`'s; `js/stock-admin.js` stays quantities only (its test still says so) and shows cost moves as states. Only those two files call `stk_*` functions; only `stock-cost-admin.js` calls the cost ones. |
| R88 | **Locks.** An approval or reversal takes the lot's purchase first (as every purchase write does), then the item and the projects charged in one sorted pass; a count's loss and a purchase correction meet on the lot's row. Nine two-sessions tests prove the outcomes (no stale price, no rows moved under an approval, no double charge, the budget filled once, no deadlock). |

## File structure

| File | Task | What |
|---|---|---|
| `supabase/migrations/0105_stock_cost_moves.sql` | 1 | **New.** Holder, `stk_cost_moves`, valuation, rows, approvals, guards, reads |
| `supabase/tests/2c_cost.pglite.mjs` | 1 | **New.** 29 behaviour tests on PGlite |
| `supabase/tests/2c_concurrency.mjs` | 1 | **New.** 9 two-sessions-at-once tests on real PostgreSQL, 15 rounds each |
| `supabase/tests/2c_acceptance.sql` | 1 | **New.** Live acceptance, rolls itself back |
| `supabase/tests/2b_stock.pglite.mjs`, `2a1…2a4 *.pglite.mjs` | 1 | `--with-0105`: every 2B-a and purchasing behaviour again with 0105 on top (0105 redefines 0096's two guards) |
| `package.json` | 1, 2 | test:sql (Task 1); `stock-cost-admin.test.js` in `npm test` (Task 2) |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` | 1 | Docs (CRLF) |
| `js/stock-cost-admin.js` | 2 | **New.** Every peso of stock: the cost forms, the approval cards, Company stock |
| `tests/stock-cost-admin.test.js` | 2 | **New.** 9 tests: words, states, who, pesos, Expenses, wiring |
| `js/stock-admin.js` | 2 | Cost-move states and buttons under each record (no pesos); the cards in Waiting for owner |
| `js/purchasing-admin-list.js`, `js/purchasing-admin-purchases.js` | 2 | Company stock tab; cost cards in Owner approvals |
| `js/purchasing-admin-core.js` | 2 | Words for a correction refused for stock reasons (`STOCK_IN_USE`, `STOCK_COST_IN_USE`, `STOCK_COST_FUNDING`) |
| `js/portal-app.compiled.js` | 2 | `stkCostMoveId`; "Stock cost move" tag; staff never see its pesos (`_hideStockCost`) |
| `js/expenses-module.js`, `js/expense-split-rows.js` | 2 | Tag, read-only, Cover flag from the server, refusal words; `expIsStockCostRow` |
| `css/purchasing-admin.css`, `admin.html` | 2 | `stk-cost` styles; the new script, versions |
| `tests/money-math.test.js` | 2 | **§X**: cost-move rows (negative ones too) are ordinary Spent; the browser never filters them |
| `tests/project-control-staff.test.js`, `tests/expense-split-rows.test.js`, `tests/purchase-server.test.js` | 2 | Staff hiding; the subtotal fence; the Cover-flag fence (same guarantees, new rows) |
| `CLAUDE.md`, `docs/ARCHITECTURE.md` | 2 | The money rule; the module map |

---

### Task 1: Dacs Web — migration 0105 (stock cost moves)

**Interfaces produced:** `stk_cost_decide(op uuid, cost uuid, approve boolean, note text)`, `stk_cost_reverse(op uuid, cost uuid, reason text)`, `stk_cost_resubmit(op uuid, cost uuid, note text)` → `{cost_move_id, status, quantity?, value?, rows?}`; reads `stk_cost_pending()` (main owner; `[]` while stock is off), `stk_company_stock()` (owner accounts). `stk_move` answers gain `cost_moves` (ids); every stock record's json gains `costs` — `{id, kind, status, move_id, quantity, approved_quantity, effective, from_name, to_name, received_on, note, decision_note, reversed, reverse_reason, …}`, plus `value` / `estimate` for owner accounts only. `expenses.stk_cost_move_id`.

<!-- Tests -->

**Modify:** `supabase/tests/2a1_purchase.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a1_purchase.pglite.mjs b/supabase/tests/2a1_purchase.pglite.mjs
index c83e597..376e414 100644
--- a/supabase/tests/2a1_purchase.pglite.mjs
+++ b/supabase/tests/2a1_purchase.pglite.mjs
@@ -23,7 +23,9 @@ const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
 // --with-0102: and 2A-4a's 0102 on top of those (payments must not change recording).
 // --with-0104: and 2B-a's 0104 (stock) on top, switched OFF as before launch —
 // the old tickbox and every purchase rule unchanged.
-const WITH_0104 = process.argv.includes('--with-0104');
+// --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
+const WITH_0105 = process.argv.includes('--with-0105');
+const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
 const WITH_0102 = process.argv.includes('--with-0102') || WITH_0104;
 const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
 const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
@@ -32,6 +34,7 @@ const WITH_0097 = process.argv.includes('--with-0097') || WITH_0101;
 const PR_MOD = WITH_0097 ? await import('./pr_base.mjs') : null;
 const PR_BASE = WITH_0097 ? PR_MOD.prBase(ROOT) : '';
 const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
+const M105 = WITH_0105 ? read(path.join(ROOT, 'supabase/migrations/0105_stock_cost_moves.sql')) : '';
 const M97 = WITH_0097 ? read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')) : '';
 const M101 = WITH_0101 ? read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')) : '';
 const fnText = (src, name) => {
@@ -107,7 +110,7 @@ async function fresh() {
   if (WITH_0097) { await db.exec(PR_BASE); await db.exec(M97); }
   if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
-  if (WITH_0104) { await db.exec(PR_MOD.CATALOG_0085); await db.exec(M104); }
+  if (WITH_0104) { await db.exec(PR_MOD.CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); }
   await db.exec(`insert into profiles values
     ('${OWNER}', 'owner', null, 'active', null), ('${STAFF}', 'staff', '${OWNER}', 'active', null),
     ('${WORKER}', 'worker', '${OWNER}', 'active', null), ('${OTHER}', 'owner', null, 'active', null),
@@ -153,7 +156,7 @@ async function code(promise) {
   try { await promise; return 'no error'; } catch (e) { return e.message; }
 }
 
-console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock off)' : '') + ' on PGlite)');
+console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock off)' : '') + (WITH_0105 ? ' + 0105' : '') + ' on PGlite)');
 
 await test('§3.3 example: ₱8,000 on 14 Oct → ₱3,000 + ₱4,000 + ₱1,000 Cover (earliest billing number first)', async () => {
   const db = await fresh(); await as(db, OWNER);
```

**Modify:** `supabase/tests/2a2_purchasing.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a2_purchasing.pglite.mjs b/supabase/tests/2a2_purchasing.pglite.mjs
index a64e07f..77b9c2f 100644
--- a/supabase/tests/2a2_purchasing.pglite.mjs
+++ b/supabase/tests/2a2_purchasing.pglite.mjs
@@ -25,8 +25,11 @@ const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql
 // --with-0102: and 2A-4a's 0102 on top of 0101.
 // --with-0104: and 2B-a's 0104 (stock) on top, switched ON (launch) — stock
 // must not change how the Purchasing tab buys, covers, corrects or approves.
-const WITH_0104 = process.argv.includes('--with-0104');
+// --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
+const WITH_0105 = process.argv.includes('--with-0105');
+const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
 const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
+const M105 = WITH_0105 ? read(path.join(ROOT, 'supabase/migrations/0105_stock_cost_moves.sql')) : '';
 const WITH_0102 = process.argv.includes('--with-0102') || WITH_0104;
 const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
 const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
@@ -101,7 +104,7 @@ async function fresh() {
   await db.exec(M97);
   if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
-  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); }
+  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -169,7 +172,7 @@ async function spent(db, folderId) {
   return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
 }
 
-console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097' + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + ' on PGlite)');
+console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097' + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + (WITH_0105 ? ' + 0105' : '') + ' on PGlite)');
 
 // ── A. The Buyer switch ──────────────────────────────────────────────
 
```

**Modify:** `supabase/tests/2a3_server.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a3_server.pglite.mjs b/supabase/tests/2a3_server.pglite.mjs
index 6471751..eb50073 100644
--- a/supabase/tests/2a3_server.pglite.mjs
+++ b/supabase/tests/2a3_server.pglite.mjs
@@ -23,8 +23,11 @@ const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql
 const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql'));
 // --with-0102: the same tests with 2A-4a's 0102 on top — payments must not change the phone server.
 // --with-0104: and 2B-a's 0104 (stock) on top, switched ON (launch).
-const WITH_0104 = process.argv.includes('--with-0104');
+// --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
+const WITH_0105 = process.argv.includes('--with-0105');
+const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
 const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
+const M105 = WITH_0105 ? read(path.join(ROOT, 'supabase/migrations/0105_stock_cost_moves.sql')) : '';
 const WITH_0102 = process.argv.includes('--with-0102') || WITH_0104;
 const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
 const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
@@ -112,7 +115,7 @@ async function fresh() {
   await db.exec(M97);
   await db.exec(M101);
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
-  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); }
+  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -170,7 +173,7 @@ async function periodsOf(db, folderId) {
                     from projects p where p.folder_id = $1 order by p.created_at, p.id`, [folderId]);
 }
 
-console.log('\n2A-3a phone purchasing server (0096 + 0097 + 0101' + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + ' on PGlite)');
+console.log('\n2A-3a phone purchasing server (0096 + 0097 + 0101' + (WITH_0102 ? ' + 0102' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + (WITH_0105 ? ' + 0105' : '') + ' on PGlite)');
 
 // ── A. Signing a buyer in (Q1, R1, R3) ──────────────────────────────
 
```

**Modify:** `supabase/tests/2a4_payments.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a4_payments.pglite.mjs b/supabase/tests/2a4_payments.pglite.mjs
index 856600a..85f4ca6 100644
--- a/supabase/tests/2a4_payments.pglite.mjs
+++ b/supabase/tests/2a4_payments.pglite.mjs
@@ -26,8 +26,11 @@ const M102 = read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sq
 // --with-0103: re-run every test with 0103 on top (2A-4b: a return's photo reaches its buyer).
 // --with-0104: and 2B-a's 0104 (stock) on top of 0103, switched ON (launch) —
 // stock must not change how purchases are paid.
-const WITH_0104 = process.argv.includes('--with-0104');
+// --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
+const WITH_0105 = process.argv.includes('--with-0105');
+const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
 const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
+const M105 = WITH_0105 ? read(path.join(ROOT, 'supabase/migrations/0105_stock_cost_moves.sql')) : '';
 const WITH_0103 = process.argv.includes('--with-0103') || WITH_0104;
 const M103 = WITH_0103 ? read(path.join(ROOT, 'supabase/migrations/0103_buyer_return_photo.sql')) : '';
 
@@ -118,7 +121,7 @@ async function fresh(opts = {}) {
     await db.exec(fnText(M98, 'pm_main_owner_id'));
     await db.exec(M102);
     if (WITH_0103) await db.exec(M103);
-    if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); }
+    if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); }
   }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
@@ -213,7 +216,7 @@ async function resolve(db, purchaseId, refunds, credit = null, opId = op()) {
     [opId, purchaseId, JSON.stringify(refunds), credit === null ? null : JSON.stringify(credit)])).r;
 }
 
-console.log('\n2A-4a paying for purchases (0096 + 0097 + 0101 + 0102' + (WITH_0103 ? ' + 0103' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + ' on PGlite)');
+console.log('\n2A-4a paying for purchases (0096 + 0097 + 0101 + 0102' + (WITH_0103 ? ' + 0103' : '') + (WITH_0104 ? ' + 0104 (stock on)' : '') + (WITH_0105 ? ' + 0105' : '') + ' on PGlite)');
 
 // ── A. "Paid now": the purchase and its payments together (Q3) ─────────
 
```

**Modify:** `supabase/tests/2b_stock.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2b_stock.pglite.mjs b/supabase/tests/2b_stock.pglite.mjs
index 2f99151..38fbddd 100644
--- a/supabase/tests/2b_stock.pglite.mjs
+++ b/supabase/tests/2b_stock.pglite.mjs
@@ -27,6 +27,9 @@ const M102 = mig('0102_purchase_payments.sql');
 const M103 = mig('0103_buyer_return_photo.sql');
 const M90 = mig('0090_workmate_item_history.sql');
 const M104 = mig('0104_stock.sql');
+// --with-0105: and 2C's 0105 (cost moves) on top — every 2B-a behaviour holds.
+const WITH_0105 = process.argv.includes('--with-0105');
+const M105 = WITH_0105 ? mig('0105_stock_cost_moves.sql') : '';
 
 const BASE = `
 create role anon; create role authenticated; create role service_role;
@@ -106,6 +109,7 @@ async function fresh(opts = {}) {
   await db.exec(M102);
   await db.exec(M103);
   await db.exec(M104);
+  if (WITH_0105) await db.exec(M105);
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
@@ -231,7 +235,7 @@ async function layersOf(db, takes) {
   return out;
 }
 
-console.log('\n2B-a stock (0096 + 0097 + 0101 + 0102 + 0103 + 0104 on PGlite)');
+console.log('\n2B-a stock (0096 + 0097 + 0101 + 0102 + 0103 + 0104' + (WITH_0105 ? ' + 0105' : '') + ' on PGlite)');
 
 // ── A. The switch, and who ────────────────────────────────────────────
 
@@ -1029,7 +1033,7 @@ await test('no read carries a peso amount (staff see quantities only)', async ()
   const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { keys.add(k); walk(x); }); };
   docs.forEach(walk);
   const money = [...keys].filter(k => /amount|price|cost(?!_folder)|peso|total_amount|gross|value|supplier/.test(k));
-  eq(money, [], 'no money keys');
+  eq(money, WITH_0105 ? ['costs'] : [], 'no money keys (2C: a record\'s cost-move states, no values)');
   const text = JSON.stringify(docs);
   assert(!text.includes('Wilcon'), 'no supplier');
 });
@@ -1040,7 +1044,9 @@ await test('permissions: authenticated may call the operations and readers only;
     'stk_receive(uuid,uuid,integer,text,text,text)', 'stk_not_delivered(uuid,uuid,integer,text,text)',
     'stk_leftover(uuid,uuid,integer,text,text,text,text)', 'stk_move(uuid,jsonb)', 'stk_count(uuid,jsonb)', 'stk_opening(uuid,jsonb)',
     'stk_decide(uuid,uuid,boolean,text)', 'stk_reverse(uuid,uuid,text)', 'stk_overview()', 'stk_item(uuid)',
-    'stk_project_lines(uuid)', 'stk_choices()', 'stk_request_lines(uuid)', 'pur_shopping_list(uuid,uuid,text)'];
+    'stk_project_lines(uuid)', 'stk_choices()', 'stk_request_lines(uuid)', 'pur_shopping_list(uuid,uuid,text)',
+    ...(WITH_0105 ? ['stk_cost_decide(uuid,uuid,boolean,text)', 'stk_cost_reverse(uuid,uuid,text)',
+                     'stk_cost_resubmit(uuid,uuid,text)', 'stk_cost_pending()', 'stk_company_stock()'] : [])];
   for (const f of callable) {
     eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x,
         (await one(db, `select has_function_privilege('anon', $1, 'execute') x`, [f])).x], [f, true, false]);
```

**Create:** `supabase/tests/2c_acceptance.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 2C acceptance — migration 0105 (live behaviour, stock cost moves).
--
-- Self-wrapped in begin / rollback: nothing persists — not the stock switch,
-- the ZZ projects, item, purchase, stock records, cost moves or their
-- expense rows. Editor-safe (set_config 'v2c.*', no temp objects). Needs one
-- active main owner allowed Expenses, an active staff account of theirs
-- allowed Expenses, and an active worker. Run it through MCP execute_sql.
-- Success ends with the row '2c acceptance: all checks passed'.
--   A. stock is off live; the main owner switches it on (rolled back)
--   B. company stock issued to project A: assignment pending, no Spent;
--      staff see the state, never a value; only the main owner approves
--   C. A → B (transfer) and A → warehouse (back): rows on both sides
--   D. reversals: COST_MOVED, newest first; the price is fixed while valued;
--      and where a purchase's cost sits (its billing periods, Cover) too
--   E. a warehouse loss: company stock loss, no expense row
--   F. guards: cost rows untouchable, projects with stock undeletable;
--      a worker sees nothing; helpers internal
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_a uuid; v_b uuid; v_c uuid; v_pa uuid; v_pb uuid; v_pc uuid; v_item uuid; v_sand uuid;
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
  assert not coalesce((select enabled from stk_settings where owner_id = v_owner), false), 'stock must still be off live';
  assert (select count(*) from stk_cost_moves) = 0, 'no cost move exists live yet';
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2c A') returning id into v_a;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2c B') returning id into v_b;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_a, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1) returning id into v_pa;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_b, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1) returning id into v_pb;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_pa, v_owner, 100000), (v_pb, v_owner, 100000);
  -- C: a ₱600 billing period, so a ₱1,000 purchase is ₱600 there and ₱400 Cover (D6–D8).
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2c C') returning id into v_c;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_c, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1) returning id into v_pc;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_pc, v_owner, 600);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, created_by)
  values (v_owner, 'material', 'ZZ 2c sand', 'acceptance', 'bag', v_owner) returning id into v_sand;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, created_by)
  values (v_owner, 'material', 'ZZ 2c cement', 'acceptance', 'bag', v_owner) returning id into v_item;
  perform set_config('v2c.owner', v_owner::text, true);
  perform set_config('v2c.staff', v_staff::text, true);
  perform set_config('v2c.worker', v_worker::text, true);
  perform set_config('v2c.a', v_a::text, true);
  perform set_config('v2c.b', v_b::text, true);
  perform set_config('v2c.pa', v_pa::text, true);
  perform set_config('v2c.pb', v_pb::text, true);
  perform set_config('v2c.c', v_c::text, true);
  perform set_config('v2c.pc', v_pc::text, true);
  perform set_config('v2c.sand', v_sand::text, true);
  perform set_config('v2c.item', v_item::text, true);
  perform set_config('v2c.today', v_today::text, true);
  perform set_config('v2c.expenses', (select count(*)::text || ':' || coalesce(sum(amount), 0)::text from expenses), true);
end $$;

-- ═══ A. Off live; the main owner switches it on and buys ₱1,000 + ₱30 delivery of 10 bags ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  assert stk_cost_pending() = '[]'::jsonb, 'A1 stock off: nothing to approve';
  perform stk_set_enabled(true);
  perform pur_set_buyer(current_setting('v2c.staff')::uuid, true);
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2c.today'),
         'supplier', 'ZZ 2c supplier', 'receipt_total', '1030', 'notes', 'ZZ 2c',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 2c cement', 'unit', 'bag',
                                                       'quantity', '10', 'amount', '1000', 'category', 'Materials',
                                                       'unplanned_reason', 'ZZ 2c acceptance')),
         'charges', jsonb_build_array(jsonb_build_object('kind', 'delivery_fee', 'amount', '30'))));
  perform set_config('v2c.purchase', r ->> 'purchase_id', true);
  perform stk_match(gen_random_uuid(), (r ->> 'purchase_id')::uuid, 1, current_setting('v2c.item')::uuid, '10', null);
  perform stk_receive(gen_random_uuid(), (r ->> 'purchase_id')::uuid, 1, '10', current_setting('v2c.today'), 'ZZ 2c');
  assert (select jsonb_agg(jsonb_build_array(x ->> 'name', (x -> 'in_warehouse' ->> 'value')::numeric)) from jsonb_array_elements(stk_company_stock()) x
           where x ->> 'item_id' = current_setting('v2c.item')) = '[["ZZ 2c cement", 1030]]'::jsonb, 'A2 company stock ₱1,030';
end $$;

-- ═══ B. Issued to A: assignment pending ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.staff'), 'role', 'authenticated')::text, true);
do $$
declare i jsonb; t text;
begin
  i := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.item'), 'from', 'warehouse',
         'to', current_setting('v2c.a'), 'quantity', '4', 'on', current_setting('v2c.today'), 'unplanned_reason', 'ZZ 2c'));
  assert jsonb_array_length(i -> 'cost_moves') = 1, 'B1 one cost request';
  perform set_config('v2c.issue', i ->> 'record_id', true);
  perform set_config('v2c.assign', i -> 'cost_moves' ->> 0, true);
  t := stk_item(current_setting('v2c.item')::uuid)::text;
  assert t like '%"kind": "assign"%' and t like '%"status": "pending"%', 'B2 staff see "Cost assignment pending"';
  assert t not like '%"value"%' and t not like '%"estimate"%', 'B3 staff never see a value';
  begin
    perform stk_cost_decide(gen_random_uuid(), current_setting('v2c.assign')::uuid, true, 'x');
    raise exception 'B4 staff approved a cost move';
  exception when others then assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'B4 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;
do $$
begin
  assert (select count(*) from expenses e left join projects p on p.id = e.project_id
           where coalesce(e.folder_id, p.folder_id) = current_setting('v2c.a')::uuid) = 0, 'B5 pending: no Spent on A';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
declare c jsonb; r jsonb;
begin
  select x into c from jsonb_array_elements(stk_cost_pending()) x where x ->> 'id' = current_setting('v2c.assign');
  assert (c ->> 'estimate')::numeric = 412 and (c ->> 'effective')::numeric = 4, 'B6 the card: 4 bags, ₱412';
  r := stk_cost_decide(gen_random_uuid(), current_setting('v2c.assign')::uuid, true, 'ZZ 2c');
  assert (r ->> 'value')::numeric = 412, 'B7 approved ₱412 (₱1,030 × 4/10)';
end $$;
reset role;
do $$
begin
  assert (select jsonb_agg(jsonb_build_array(expense_name, amount, cover_expense, project_id::text)) from expenses
           where stk_cost_move_id = current_setting('v2c.assign')::uuid)
         = jsonb_build_array(jsonb_build_array('From warehouse — ZZ 2c cement', 412, false, current_setting('v2c.pa'))), 'B8 one row on A''s period';
end $$;

-- ═══ C. A → B and A → warehouse ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.staff'), 'role', 'authenticated')::text, true);
do $$
declare m jsonb; w jsonb;
begin
  m := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.item'), 'from', current_setting('v2c.a'),
         'to', current_setting('v2c.b'), 'quantity', '3', 'on', current_setting('v2c.today'), 'unplanned_reason', 'ZZ 2c'));
  w := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.item'), 'from', current_setting('v2c.a'),
         'to', 'warehouse', 'quantity', '1', 'on', current_setting('v2c.today')));
  perform set_config('v2c.move', m ->> 'record_id', true);
  perform set_config('v2c.transfer', m -> 'cost_moves' ->> 0, true);
  perform set_config('v2c.back', w -> 'cost_moves' ->> 0, true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (stk_cost_decide(gen_random_uuid(), current_setting('v2c.transfer')::uuid, true, 'ZZ') ->> 'value')::numeric = 309, 'C1 transfer ₱309';
  assert (stk_cost_decide(gen_random_uuid(), current_setting('v2c.back')::uuid, true, 'ZZ') ->> 'value')::numeric = 103, 'C2 back ₱103 (the rest)';
end $$;
reset role;
do $$
declare v_a numeric; v_b numeric; v_c numeric;
begin
  select coalesce(sum(e.amount), 0) into v_a from expenses e left join projects p on p.id = e.project_id
   where coalesce(e.folder_id, p.folder_id) = current_setting('v2c.a')::uuid;
  select coalesce(sum(e.amount), 0) into v_b from expenses e left join projects p on p.id = e.project_id
   where coalesce(e.folder_id, p.folder_id) = current_setting('v2c.b')::uuid;
  select h.value into v_c from stk_lots lt, stk_held(lt.id, null) h where lt.purchase_id = current_setting('v2c.purchase')::uuid;
  assert (v_a, v_b, v_c) = (0::numeric, 309::numeric, 721::numeric), 'C3 A ₱0, B ₱309, company ₱721 — got ' || v_a || ', ' || v_b || ', ' || v_c;
  assert v_a + v_b + v_c = 1030, 'C4 every peso in one place';
  assert (select array_agg(expense_name order by amount) from expenses e join projects p on p.id = e.project_id
           where e.stk_cost_move_id is not null and p.folder_id = current_setting('v2c.a')::uuid)
         = array['Moved to ZZ 2c B — ZZ 2c cement', 'Back to company stock — ZZ 2c cement', 'From warehouse — ZZ 2c cement'], 'C5 A''s labels';
end $$;

-- ═══ D. Reversals and the price ═══
set local role authenticated;
do $$
begin
  begin
    perform stk_reverse(gen_random_uuid(), current_setting('v2c.move')::uuid, 'ZZ');
    raise exception 'D1 reversed a movement whose cost moved';
  exception when others then assert sqlerrm like '%COST_MOVED%', 'D1 wrong error: ' || sqlerrm;
  end;
  begin
    perform stk_cost_reverse(gen_random_uuid(), current_setting('v2c.assign')::uuid, 'ZZ');
    raise exception 'D2 reversed the assignment under later moves';
  exception when others then assert sqlerrm like '%LATER_MOVES_FIRST%', 'D2 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_correct(gen_random_uuid(), current_setting('v2c.purchase')::uuid, jsonb_build_object('source', 'purchasing',
      'purchase_date', current_setting('v2c.today'), 'supplier', 'ZZ 2c supplier', 'receipt_total', '1130', 'notes', 'ZZ 2c',
      'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 2c cement', 'unit', 'bag',
                                                    'quantity', '10', 'amount', '1100', 'category', 'Materials', 'unplanned_reason', 'ZZ 2c')),
      'charges', jsonb_build_array(jsonb_build_object('kind', 'delivery_fee', 'amount', '30'))), 'ZZ price');
    raise exception 'D3 the price changed under approved cost moves';
  exception when others then assert sqlerrm like '%STOCK_COST_IN_USE%', 'D3 wrong error: ' || sqlerrm;
  end;
  perform stk_cost_reverse(gen_random_uuid(), current_setting('v2c.transfer')::uuid, 'ZZ wrong project');
end $$;
reset role;
do $$
begin
  assert (select count(*) from expenses where stk_cost_move_id = current_setting('v2c.transfer')::uuid) = 0, 'D4 its rows are gone';
  assert (select reverse_reason from stk_cost_moves where id = current_setting('v2c.transfer')::uuid) = 'ZZ wrong project', 'D5 the record stays';
end $$;

-- ═══ D6–D8. Where a purchase's cost sits is fixed too (R81, rev 2) ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2c.today'),
         'supplier', 'ZZ 2c supplier', 'receipt_total', '1000', 'notes', 'ZZ 2c',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'project', 'folder_id', current_setting('v2c.c'), 'item_name', 'ZZ 2c sand',
                                                       'unit', 'bag', 'quantity', '10', 'amount', '1000', 'category', 'Materials',
                                                       'unplanned_reason', 'ZZ 2c acceptance'))));
  perform set_config('v2c.sandbuy', r ->> 'purchase_id', true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.staff'), 'role', 'authenticated')::text, true);
do $$
declare m jsonb;
begin
  perform stk_match(gen_random_uuid(), current_setting('v2c.sandbuy')::uuid, 1, current_setting('v2c.sand')::uuid, '10', null);
  perform stk_leftover(gen_random_uuid(), current_setting('v2c.sandbuy')::uuid, 1, '5', 'warehouse', current_setting('v2c.today'), 'ZZ 2c');
  m := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.sand'), 'from', 'warehouse',
         'to', current_setting('v2c.b'), 'quantity', '2', 'on', current_setting('v2c.today'), 'unplanned_reason', 'ZZ 2c'));
  perform set_config('v2c.sandmove', m -> 'cost_moves' ->> 0, true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (stk_cost_decide(gen_random_uuid(), current_setting('v2c.sandmove')::uuid, true, 'ZZ') ->> 'value')::numeric = 200, 'D6 transfer ₱200';
end $$;
reset role;
do $$
begin
  assert (select jsonb_agg(jsonb_build_array(e.cover_expense, e.amount) order by e.cover_expense)
            from (select cover_expense, sum(amount) amount from expenses e join projects p on p.id = e.project_id
                   where p.folder_id = current_setting('v2c.c')::uuid group by 1) e)
         = '[[false, 480], [true, 320]]'::jsonb, 'D7 C: ₱600 − ₱120 on its period, ₱400 − ₱80 Cover';
  -- A second billing period this month would take the Cover part.
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (current_setting('v2c.owner')::uuid, current_setting('v2c.c')::uuid, to_char(current_setting('v2c.today')::date, 'FMMonth'),
          extract(year from current_setting('v2c.today')::date)::int, 'progress', 2);
  insert into project_budgets (project_id, owner_id, monthly_budget)
  select id, owner_id, 1000 from projects where folder_id = current_setting('v2c.c')::uuid and billing_number = 2;
end $$;
set local role authenticated;
do $$
begin
  begin
    perform pur_refund(gen_random_uuid(), current_setting('v2c.sandbuy')::uuid, 'ZZ billing periods re-checked');
    raise exception 'D8 a re-fund moved rows under an approved cost move';
  exception when others then assert sqlerrm like '%STOCK_COST_FUNDING%', 'D8 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;
do $$
begin
  assert (select sum(amount) from expenses e join projects p on p.id = e.project_id
           where p.folder_id = current_setting('v2c.c')::uuid and e.cover_expense) = 320, 'D8 nothing moved';
  perform set_config('v2c.rows', (select count(*)::text from expenses), true);
end $$;

-- ═══ E. A warehouse loss of company goods ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.staff'), 'role', 'authenticated')::text, true);
do $$
declare c jsonb;
begin
  c := stk_count(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.item'), 'at', 'warehouse', 'counted', '5',
         'reason', 'damaged', 'on', current_setting('v2c.today')));
  perform set_config('v2c.count', c ->> 'record_id', true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  perform stk_decide(gen_random_uuid(), current_setting('v2c.count')::uuid, true, 'ZZ');
  assert (select (x -> 'loss' ->> 'value')::numeric from jsonb_array_elements(stk_company_stock()) x
           where x ->> 'item_id' = current_setting('v2c.item')) = 206, 'E1 company stock loss ₱206 (2 bags)';
end $$;

-- ═══ F. Guards; a worker; internals ═══
reset role;
do $$
begin
  assert (select count(*)::text from expenses) = current_setting('v2c.rows'), 'E2 a loss writes no expense row';
  begin
    update expenses set amount = 1 where stk_cost_move_id = current_setting('v2c.assign')::uuid;
    raise exception 'F1 a cost row was edited';
  exception when others then assert sqlerrm like '%STOCK_COST_ROW%', 'F1 wrong error: ' || sqlerrm;
  end;
  begin
    delete from folders where id = current_setting('v2c.a')::uuid;
    raise exception 'F2 a project with stock was deleted';
  exception when others then assert sqlerrm like '%STOCK_LIVE%', 'F2 wrong error: ' || sqlerrm;
  end;
  assert not has_function_privilege('anon', 'stk_cost_decide(uuid,uuid,boolean,text)', 'execute'), 'F3 anon cannot decide';
  assert not has_function_privilege('authenticated', 'stk_cost_rows(uuid)', 'execute'), 'F4 internal';
  assert not has_function_privilege('authenticated', 'stk_held(uuid,uuid)', 'execute'), 'F5 internal';
  assert (select count(*) from pg_policies where tablename = 'stk_cost_moves') = 0, 'F6 no direct table access';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform stk_cost_pending();
    raise exception 'F7 a worker read the approvals';
  exception when others then assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'F7 wrong error: ' || sqlerrm;
  end;
  begin
    perform stk_company_stock();
    raise exception 'F8 a worker read company stock';
  exception when others then assert sqlerrm like '%NOT_ALLOWED%', 'F8 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;

select '2c acceptance: all checks passed' as result;
rollback;
```

**Create:** `supabase/tests/2c_concurrency.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 2C COST MOVES — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2c_cost.pglite.mjs)
//
// Same approach as 2b_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104 +
// 0105 VERBATIM, pairs of calls released at the same moment on two
// connections. Nothing touches the live database.
//   1. an approval while the goods are returned → charged for what was there
//   2. two approvals of one cost move (two tabs) → charged once
//   3. a price fix while a transfer is approved → never a stale value
//   4. a price fix while a warehouse loss is confirmed → never a stale value
//   5. an approval while the movement is reversed → one wins
//   6. two approvals (two items) into one billing period → its budget filled once
//   7. one approval pressed twice (same operation id) → one answer
//   8. a price fix while a warehouse lot's assignment is approved → never stale
//   9. a re-fund while a transfer out of it is approved → never rows moved under it
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2c-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2C cost moves — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 + 0105 on PostgreSQL)');
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
  await admin.query(mig('0105_stock_cost_moves.sql'));
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

  const DECIDE = `select stk_cost_decide(gen_random_uuid(), $1, true, 'ok') r`;
  const CORRECT = `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'price') r`;
  const DECIDE_REC = `select stk_decide(gen_random_uuid(), $1, true, 'ok') r`;
  const REVERSE = `select stk_reverse(gen_random_uuid(), $1, 'wrong') r`;
  const COUNT = `select stk_count(gen_random_uuid(), $1::jsonb) r`;
  const spent = async (f) => Number((await one(`select coalesce(sum(e.amount), 0) s from expenses e left join projects p on p.id = e.project_id
                                                where coalesce(e.folder_id, p.folder_id) = $1`, [f])).s);
  const held = async (lot, h) => (await one(`select value v, quantity q from stk_held($1, $2)`, [lot, h]));
  const lotOf = async (pid) => (await one(`select id from stk_lots where purchase_id = $1`, [pid])).id;
  // Every lot's cost is in exactly one place, and each project's Spent is the stock cost it holds.
  const fourPlaces = async (it, folders) => {
    const lots = (await admin.query(`select lt.id, b.value v from stk_lots lt cross join lateral stk_lot_basis(lt.id) b
                                       where not lt.untraced and lt.item_id = $1`, [it])).rows;
    for (const l of lots) {
      let sum = Number((await held(l.id, null)).v)
        + Number((await one(`select coalesce(sum(value), 0) v from stk_cost_moves where lot_id = $1 and kind = 'loss'
                             and status = 'approved' and reversed_at is null`, [l.id])).v);
      for (const f of folders) sum += Number((await held(l.id, f)).v);
      if (Math.round(sum * 100) !== Math.round(Number(l.v) * 100)) return false;
    }
    for (const f of folders) {
      let h = 0;
      for (const l of lots) h += Number((await held(l.id, f)).v);
      if (Math.round(h * 100) !== Math.round(await spent(f) * 100)) return false;
    }
    return true;
  };
  // Every approved, unreversed cost move is valued at its lot's CURRENT price and quantity.
  const basisFresh = async () => Number((await one(`select count(*) n from stk_cost_moves c cross join lateral stk_lot_basis(c.lot_id) b
                                                     where c.status = 'approved' and c.reversed_at is null
                                                       and (c.basis_value <> b.value or c.basis_quantity <> b.quantity)`)).n) === 0;
  const priceBody = (f, amount) => JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: amount, supplier: 'Wilcon',
    lines: [{ destination: f ? 'project' : 'warehouse', folder_id: f || undefined, item_name: 'Cement', category: 'Materials', unit: 'bag',
              quantity: 10, amount, unplanned_reason: 'test' }] });

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C1 ' + i);
      const f = await mkFolder('return ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const ret = JSON.stringify({ item_id: it, returns_record: is.record_id, quantity: '2', on: TODAY });
      const out = await pair(OWNER, DECIDE, [is.cost_moves[0]], STAFF, MOVE, [ret]);
      if (deadlock(out)) dead++;
      const c = await one(`select approved_quantity q, value v from stk_cost_moves where id = $1`, [is.cost_moves[0]]);
      const back = Number((await one(`select count(*) n from stk_cost_moves where kind = 'back' and to_folder is null and from_folder = $1`, [f])).n);
      // Approval first: 4 charged, the return asks to bring 2 back. Return first: only the 2 still there are charged.
      const ok = out.every(o => o.ok)
        && ((Number(c.q) === 4 && Number(c.v) === 400 && back === 1) || (Number(c.q) === 2 && Number(c.v) === 200 && back === 0))
        && await negatives() === 0 && await fourPlaces(it, [f]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('1. the owner approves while goods are returned: charged for what was there when approved — never for goods already back',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C2 ' + i);
      const f = await mkFolder('double ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const out = await pair(OWNER, DECIDE, [is.cost_moves[0]], OWNER, DECIDE, [is.cost_moves[0]]);
      if (deadlock(out)) dead++;
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /BAD_STATE/.test(o.msg)) || await spent(f) !== 400) bad++;
    }
    check('2. two approvals of the same cost move at once (two tabs): charged once',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 3
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C3 ' + i);
      const a = await mkFolder('price A ' + i); await mkPeriod(a);
      const b = await mkFolder('price B ' + i); await mkPeriod(b);
      const pid = await record([{ destination: 'project', folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000 }]);
      await call(OWNER, MATCH, [pid, it, '10']);
      await call(STAFF, `select stk_leftover(gen_random_uuid(), $1, 1, '5', 'warehouse', '${TODAY}', '') r`, [pid]);
      const mv = await call(STAFF, MOVE, [issue(it, b, 5)]);
      const out = await pair(OWNER, DECIDE, [mv.cost_moves[0]], OWNER, CORRECT, [pid, priceBody(a, 1200)]);
      if (deadlock(out)) dead++;
      const v = Number((await one(`select coalesce(value, -1) v from stk_cost_moves where id = $1`, [mv.cost_moves[0]])).v);
      // Approval first: the price fix is refused. Price fix first: approved at the new price.
      const ok = out.filter(o => o.ok).length >= 1
        && ((out[0].ok && !out[1].ok && /STOCK_COST_IN_USE/.test(out[1].msg) && v === 500)
            || (out[0].ok && out[1].ok && v === 600))
        && await basisFresh() && await fourPlaces(it, [a, b]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('3. a price fix while the owner approves the leftovers\' transfer: never a cost move valued at a stale price',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 4
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C4 ' + i);
      const pid = await stocked(it, 10);
      const cnt = await call(STAFF, COUNT, [JSON.stringify({ item_id: it, at: 'warehouse', counted: '7', reason: 'damaged', on: TODAY })]);
      const out = await pair(OWNER, DECIDE_REC, [cnt.record_id], OWNER, CORRECT, [pid, priceBody(null, 1200)]);
      if (deadlock(out)) dead++;
      const v = Number((await one(`select coalesce(sum(value), -1) v from stk_cost_moves where record_id = $1`, [cnt.record_id])).v);
      const ok = out[0].ok
        && ((!out[1].ok && /STOCK_COST_IN_USE/.test(out[1].msg) && v === 300) || (out[1].ok && v === 360))
        && await basisFresh() && await fourPlaces(it, []);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('4. a price fix while a warehouse loss is confirmed: the loss is valued at the price that stands',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 5
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C5 ' + i);
      const f = await mkFolder('reverse ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const out = await pair(OWNER, DECIDE, [is.cost_moves[0]], STAFF, REVERSE, [is.record_id]);
      if (deadlock(out)) dead++;
      const st = (await one(`select status from stk_cost_moves where id = $1`, [is.cost_moves[0]])).status;
      const ok = out.filter(o => o.ok).length === 1
        && ((out[0].ok && /COST_MOVED/.test(out[1].msg) && st === 'approved' && await spent(f) === 400)
            || (out[1].ok && /BAD_STATE/.test(out[0].msg) && st === 'withdrawn' && await spent(f) === 0))
        && await fourPlaces(it, [f]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('5. the owner approves while the movement is reversed: one wins — never a charge for goods that went back',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 6
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C6 ' + i), it2 = await item('C6b ' + i);   // two items: only the project's lock is shared
      const f = await mkFolder('budget ' + i);
      const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                            values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                    extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, f])).id;
      await admin.query(`insert into project_budgets values ($1, $2, 500)`, [p, OWNER]);
      await stocked(it, 10); await stocked(it2, 10);
      const i1 = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const i2 = await call(STAFF, MOVE, [issue(it2, f, 4)]);
      const out = await pair(OWNER, DECIDE, [i1.cost_moves[0]], OWNER, DECIDE, [i2.cost_moves[0]]);
      if (deadlock(out)) dead++;
      const inPeriod = Number((await one(`select coalesce(sum(amount), 0) s from expenses where project_id = $1 and not cover_expense`, [p])).s);
      if (!out.every(o => o.ok) || inPeriod !== 500 || await spent(f) !== 800) bad++;
    }
    check('6. two approvals of different items into one billing period at once: the period fills to its budget once, the rest is Cover',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 7
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C7 ' + i);
      const f = await mkFolder('press ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const opId = (await one(`select gen_random_uuid() g`)).g;
      const SAME = `select stk_cost_decide('${opId}', $1, true, 'ok') r`;
      const out = await pair(OWNER, SAME, [is.cost_moves[0]], OWNER, SAME, [is.cost_moves[0]]);
      if (deadlock(out)) dead++;
      if (!out.every(o => o.ok) || out[0].r.cost_move_id !== out[1].r.cost_move_id || await spent(f) !== 400) bad++;
    }
    check('7. the same approval pressed twice at once (one operation id): one answer, charged once',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 8
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C8 ' + i);
      const f = await mkFolder('assign price ' + i); await mkPeriod(f);
      const pid = await stocked(it, 10);
      const is = await call(STAFF, MOVE, [issue(it, f, 4)]);
      const out = await pair(OWNER, DECIDE, [is.cost_moves[0]], OWNER, CORRECT, [pid, priceBody(null, 1200)]);
      if (deadlock(out)) dead++;
      const v = Number((await one(`select coalesce(value, -1) v from stk_cost_moves where id = $1`, [is.cost_moves[0]])).v);
      // Approval first: the price fix is refused. Price fix first: approved at the new price (₱1,200 × 4/10).
      const ok = out[0].ok
        && ((!out[1].ok && /STOCK_COST_IN_USE/.test(out[1].msg) && v === 400) || (out[1].ok && v === 480))
        && await basisFresh() && await fourPlaces(it, [f]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('8. a price fix on a warehouse purchase while its assignment is approved: never valued at a stale price',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 9
  {
    let bad = 0, dead = 0;
    const REFUND = `select pur_refund(gen_random_uuid(), $1, 'billing periods re-checked') r`;
    const allocFresh = async () => Number((await one(`select count(*) n from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id
                                                       where c.status = 'approved' and c.reversed_at is null
                                                         and c.basis_alloc is distinct from stk_purchase_alloc(lt.purchase_id)`)).n) === 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('C9 ' + i);
      const a = await mkFolder('refund A ' + i), b = await mkFolder('refund B ' + i); await mkPeriod(b);
      const p1 = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                             values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                     extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, a])).id;
      await admin.query(`insert into project_budgets values ($1, $2, 600)`, [p1, OWNER]);
      const pid = await record([{ destination: 'project', folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000 }]);
      await call(OWNER, MATCH, [pid, it, '10']);
      await call(STAFF, `select stk_leftover(gen_random_uuid(), $1, 1, '5', 'warehouse', '${TODAY}', '') r`, [pid]);
      const mv = await call(STAFF, MOVE, [issue(it, b, 2)]);
      const p2 = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                             values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                     extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 2) returning id`, [OWNER, a])).id;
      await admin.query(`insert into project_budgets values ($1, $2, 1000)`, [p2, OWNER]);
      const out = await pair(OWNER, DECIDE, [mv.cost_moves[0]], OWNER, REFUND, [pid]);
      if (deadlock(out)) dead++;
      const cover = Number((await one(`select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id
                                         where p.folder_id = $1 and e.cover_expense`, [a])).s);
      // Approval first: the re-fund is refused and ₱320 stays on Cover. Re-fund first: no Cover left; approved off the new periods.
      const ok = out[0].ok
        && ((!out[1].ok && /STOCK_COST_FUNDING/.test(out[1].msg) && cover === 320) || (out[1].ok && cover === 0))
        && await allocFresh() && await fourPlaces(it, [a, b]);
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out), cover);
    }
    check('9. a re-fund while the owner approves a transfer out of the same purchase: never rows moved under an approved cost move',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/2c_cost.pglite.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 2C COST MOVES — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096, 0097, 0101, 0102, 0103, 0104 and 0105 VERBATIM on
// PGlite over the 2B-a suite's tables and helpers. Nothing here talks to the
// live database; supabase/tests/2c_acceptance.sql repeats the key cases
// there, rolled back.
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
const M105 = mig('0105_stock_cost_moves.sql');

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
  await db.exec(M105);
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

// ── 2C helpers ────────────────────────────────────────────────────────
const cdecide = (db, who, id, ok, note = 'ok') => rpc(db, who, 'stk_cost_decide', [op(), id, ok, note]);
const creverse = (db, who, id, reason = 'wrong lot') => rpc(db, who, 'stk_cost_reverse', [op(), id, reason]);
const cresubmit = (db, who, id, note = 'see the delivery photo') => rpc(db, who, 'stk_cost_resubmit', [op(), id, note]);
async function cost(db, id) { return one(db, `select * from stk_cost_moves where id = $1`, [id]); }
async function costsOf(db, rec) { return all(db, `select * from stk_cost_moves where record_id = $1 order by requested_at, id`, [rec]); }
async function lotOf(db, pid) { return (await one(db, `select id from stk_lots where purchase_id = $1`, [pid])).id; }
// A project's Spent: every expense row of its billing periods, or on the project itself.
async function spent(db, f) {
  return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e left join projects p on p.id = e.project_id
                              where coalesce(e.folder_id, p.folder_id) = $1`, [f])).s);
}
// A project's cost-move rows: [name, amount, Cover, billing period].
async function stockRows(db, f) {
  return (await all(db, `select e.expense_name n, e.amount a, e.cover_expense c, e.project_id p from expenses e
                           left join projects p on p.id = e.project_id
                          where e.stk_cost_move_id is not null and coalesce(e.folder_id, p.folder_id) = $1
                          order by e.created_at, e.split_index nulls first, e.amount desc`, [f])).map(r => [r.n, num(r.a), r.c, r.p]);
}
async function held(db, lot, holder) {
  const r = await one(db, `select value, quantity from stk_held($1, $2)`, [lot, holder]);
  return [num(r.value), num(r.quantity)];
}
async function lossValue(db, lot) {
  return num((await one(db, `select coalesce(sum(value), 0) v from stk_cost_moves where lot_id = $1 and kind = 'loss'
                              and status = 'approved' and reversed_at is null`, [lot])).v);
}
async function companyStock(db, who = OWNER) {
  await as(db, who);
  return (await one(db, `select stk_company_stock() x`)).x.map(i => [i.name, num(i.in_warehouse.quantity), num(i.in_warehouse.value),
    num(i.issued_pending.quantity), num(i.issued_pending.value), num(i.awaiting.quantity), num(i.loss.quantity), num(i.loss.value)]);
}
// A purchase with delivery fees / discounts (receipt total = lines + fees − discounts).
async function buyWith(db, lines, charges, opts = {}) {
  const b = body(lines, { date: opts.date });
  b.charges = charges;
  b.receipt_total = Math.round((b.receipt_total + charges.reduce((s, c) => s + (c.kind === 'discount' ? -c.amount : c.amount), 0)) * 100) / 100;
  return (await record(db, b, opts.who || BUYER)).purchase_id;
}
async function periodOn(db, f, date, budget = 100000, billing = 1, funding = 'progress') {
  const d = new Date(date + 'T00:00:00Z');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, $5, $6) returning id`, [OWNER, f, months[d.getUTCMonth()], d.getUTCFullYear(), funding, billing])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, OWNER, budget]);
  return id;
}
// Every traced lot: its cost is in exactly one place — company stock, a
// project (whose Spent carries it), or company stock loss.
// (notStock: a project's purchase cost that is not a stock lot, e.g. a line never stocked.)
async function fourPlaces(db, folders, notStock = {}) {
  const lots = await all(db, `select lt.id, b.value v from stk_lots lt cross join lateral stk_lot_basis(lt.id) b where not lt.untraced`);
  for (const l of lots) {
    let sum = (await held(db, l.id, null))[0] + await lossValue(db, l.id);
    for (const f of folders) sum += (await held(db, l.id, f))[0];
    eq(Math.round(sum * 100) / 100, num(l.v), 'lot ' + l.id + ': company + projects + loss = its cost');
  }
  for (const f of folders) {
    let h = notStock[f] || 0;
    for (const l of lots) h += (await held(db, l.id, f))[0];
    eq(await spent(db, f), Math.round(h * 100) / 100, 'project Spent = the stock cost it holds');
  }
}

console.log('\n2C cost moves (0096 + 0097 + 0101 + 0102 + 0103 + 0104 + 0105 on PGlite)');

// ── A. Company stock → a project (cost assignment, Q11) ──────────────

await test('company stock issued to a project: "Cost assignment pending" — no Spent until the main owner approves; then one "From warehouse" row', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); const p = await period(db, f);
  await stocked(db, it, 10);                       // ₱1,000 → ₱100 a bag
  const before = await money(db);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  eq(r.cost_moves.length, 1, 'one request per movement per lot');
  const c = await cost(db, r.cost_moves[0]);
  eq([c.kind, c.status, c.from_folder, c.to_folder, num(c.quantity), c.received_on.toISOString?.().slice(0, 10) ?? String(c.received_on)],
     ['assign', 'pending', null, f, 4, TODAY]);
  eq(await money(db), before, 'pending: no expense row');
  eq(await companyStock(db), [['Cement', 6, 600, 4, 400, 0, 0, 0]], 'issued, assignment pending: still company cost');
  const a = await cdecide(db, OWNER, c.id, true);
  eq([a.status, num(a.quantity), num(a.value)], ['approved', 4, 400]);
  eq(await stockRows(db, f), [['From warehouse — Cement', 400, false, p]]);
  eq(await spent(db, f), 400);
  eq(await companyStock(db), [['Cement', 6, 600, 0, 0, 0, 0, 0]]);
  const e = await one(db, `select category, quantity, notes, split_group from expenses where stk_cost_move_id = $1`, [c.id]);
  eq([e.category, num(e.quantity), e.split_group], ['Materials', 4, null]);
  await refused(cdecide(db, OWNER, c.id, true), 'BAD_STATE', 'decided once');
  await fourPlaces(db, [f]);
});

await test('value by lot (Q12): item amount − discount + delivery fee, to the centavo; the last portion takes what is left — the portions add up exactly', async () => {
  const db = await fresh();
  const pcs = await item(db, 'Tie wire', 'piece');
  const pid = await buyWith(db, [{ destination: 'warehouse', item_name: 'Tie wire box', quantity: 3, unit: 'box', amount: 1000 }],
                            [{ kind: 'discount', amount: 10 }, { kind: 'delivery_fee', amount: 5 }]);
  await match(db, STAFF, pid, 1, pcs, 100, '3 boxes = 100 pcs');
  await receive(db, BUYER, pid, 1, 3);
  const lot = await lotOf(db, pid);
  eq(await held(db, lot, null), [995, 100], 'company holds the whole line: ₱995 for 100 pieces');
  const fs = [await folder(db, 'A'), await folder(db, 'B'), await folder(db, 'C')];
  for (const f of fs) await period(db, f);
  const vals = [];
  for (const [f, q] of [[fs[0], 33], [fs[1], 33], [fs[2], 34]]) {
    const r = await move(db, STAFF, { item_id: pcs, from: 'warehouse', to: f, quantity: q, unplanned_reason: 'ties' });
    vals.push(num((await cdecide(db, OWNER, r.cost_moves[0], true)).value));
  }
  eq(vals, [328.35, 328.35, 338.3], '995 × 33/100; 666.65 × 33/67; the rest');
  eq(Math.round(vals.reduce((s, v) => s + v, 0) * 100) / 100, 995);
  eq(await held(db, lot, null), [0, 0]);
  await fourPlaces(db, fs);
});

await test('funded like a purchase (Q14): the month the project received the goods, earliest billing number first, the rest Cover', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin');
  const past = phDate(-40);
  const p1 = await periodOn(db, f, past, 300, 1), p2 = await periodOn(db, f, past, 100, 2);
  const now = await period(db, f);
  await stocked(db, it, 10, { date: past, received: past });
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 5, unplanned_reason: 'slab', on: past });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const rows = await stockRows(db, f);
  eq(rows.map(x => [x[0], x[1], x[2], x[3] === now ? 'now' : x[2] ? 'cover' : x[3] === p1 ? 'p1' : x[3] === p2 ? 'p2' : '?']),
     [['From warehouse — Cement (1/3)', 300, false, 'p1'], ['From warehouse — Cement (2/3)', 100, false, 'p2'],
      ['From warehouse — Cement (3/3)', 100, true, 'cover']], 'never this month\'s period');
  eq((await all(db, `select distinct split_group g from expenses where stk_cost_move_id = $1`, [r.cost_moves[0]])).length, 1, 'one split group');
});

await test('an Additional Works job: its own period, in full, never Cover', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const main = await folder(db, 'Barlin'); await period(db, main, 10);
  const aw = await folder(db, 'Extra room', { parent: main });
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: aw, quantity: 3, unplanned_reason: 'room' });
  eq((await cost(db, r.cost_moves[0])).kind, 'assign');
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const rows = await stockRows(db, aw);
  eq(rows.map(x => [x[0], x[1], x[2]]), [['From warehouse — Cement', 300, false]]);
  eq(await spent(db, main), 0, 'the main project is not charged');
});

// ── B. Project → project (transfer, Q12) and back to company (Q10) ───

await test('leftovers moved to another project: "Cost transfer pending"; approval moves the cost — A down, B up, the line still adds up', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 600);   // ₱600 budget → ₱400 Cover
  const b = await folder(db, 'Bagong'); const pb = await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line });   // ₱1,000
  eq(await spent(db, a), 1000);
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  const c = await cost(db, r.cost_moves[0]);
  eq([c.kind, c.from_folder, c.to_folder], ['transfer', a, b]);
  eq([await spent(db, a), await spent(db, b)], [1000, 0], 'pending: the cost stays where it was');
  await cdecide(db, OWNER, c.id, true);
  eq([await spent(db, a), await spent(db, b)], [500, 500]);
  eq((await stockRows(db, a)).map(x => [x[0], x[1], x[2]]),
     [['Moved to Bagong — Cement (1/2)', -300, false], ['Moved to Bagong — Cement (2/2)', -200, true]],
     'off A in proportion to where its cost sat: ₱600 period, ₱400 Cover');
  eq((await stockRows(db, b)).map(x => [x[0], x[1], x[2], x[3]]), [['Moved from Barlin — Cement', 500, false, pb]]);
  await fourPlaces(db, [a, b]);
});

await test('a delivery fee and a discount move with the goods: the giving project loses its share from every row that carried it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement'); const gr = await item(db, 'Gravel');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const pj = await buyWith(db, [{ folder_id: a, item_name: 'Cement', quantity: 10, amount: 3000 },
                                { folder_id: a, item_name: 'Gravel', quantity: 1, unit: 'bag', amount: 1000 }],
                           [{ kind: 'delivery_fee', amount: 200 }, { kind: 'discount', amount: 100 }]);
  await match(db, STAFF, pj, 1, it, 10);
  await match(db, STAFF, pj, 2, gr, 1);
  eq(await spent(db, a), 4100);
  await leftover(db, STAFF, pj, 1, 4, 'site');
  const r = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 4, unplanned_reason: 'formwork' });
  const c = await cost(db, r.cost_moves[0]);
  eq(c.kind, 'transfer');
  const v = num((await cdecide(db, OWNER, c.id, true)).value);
  eq(v, Math.round((3000 - 75 + 150) * 4 / 10 * 100) / 100, '(₱3,000 − ₱75 discount + ₱150 fee) × 4/10');
  eq([await spent(db, a), await spent(db, b)], [4100 - v, v]);
  const out = await stockRows(db, a);
  eq(Math.round(out.reduce((s, x) => s + x[1], 0) * 100) / 100, -v, 'the out rows add up to the value');
  await fourPlaces(db, [a, b], { [a]: 1000 - 25 + 50 });   // the gravel line, never stocked
});

await test('a company lot brought back to the warehouse from a project: "Back to company stock" pending; a project\'s own leftovers keep their cost there', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 6, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  eq(await spent(db, a), 600);
  const ret = await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 2 });
  const c = await cost(db, ret.cost_moves[0]);
  eq([c.kind, c.from_folder, c.to_folder, num(c.quantity)], ['back', a, null, 2], 'the return takes the project\'s own (approved) goods');
  await cdecide(db, OWNER, c.id, true);
  eq((await stockRows(db, a)).map(x => [x[0], x[1]]), [['From warehouse — Cement', 600], ['Back to company stock — Cement', -200]]);
  eq(await spent(db, a), 400);
  eq(await companyStock(db), [['Cement', 6, 600, 0, 0, 0, 0, 0]]);
  // A project's own leftovers brought to the warehouse: no request — still its cost (12 Oct).
  const r0 = await request(db, a, { item: it, quantity: 5 });
  const pj = await projectBuy(db, a, 'Cement', 5, { requestLine: r0.line });
  const lo = await leftover(db, STAFF, pj, 1, 2, 'warehouse');
  eq((await costsOf(db, lo.record_id)).length, 0);
  // …and issued back to that same project: none either.
  const back = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 2, unplanned_reason: 'slab', lot_id: await lotOf(db, pj) });
  eq(back.cost_moves, []);
  await fourPlaces(db, [a]);
});

await test('a plain move from a site to the warehouse takes the project\'s goods: "back"; between sites of company goods not yet assigned: a fresh assignment', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Bagong'); await period(db, b);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 3, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);                                    // A holds 3
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 2, unplanned_reason: 'slab' });   // 2 pending
  // To B: the goods NOT yet the site's own leave first — company goods → a fresh assignment to B.
  const m = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 2, unplanned_reason: 'formwork' });
  eq((await costsOf(db, m.record_id)).map(c => [c.kind, c.from_folder, c.to_folder, num(c.quantity)]), [['assign', null, b, 2]]);
  await as(db, OWNER);
  eq(num((await one(db, `select stk_cost_effective($1) e`, [i2.cost_moves[0]])).e), 0, 'A\'s pending assignment shrank to nothing');
  await refused(cdecide(db, OWNER, i2.cost_moves[0], true), 'NOTHING_LEFT');
  await cdecide(db, OWNER, i2.cost_moves[0], false, 'went to Bagong');
  await cdecide(db, OWNER, m.cost_moves[0], true);
  const w = await move(db, STAFF, { item_id: it, from: a, to: 'warehouse', quantity: 1 });
  eq((await costsOf(db, w.record_id)).map(c => [c.kind, c.from_folder, c.to_folder]), [['back', a, null]]);
  eq([await spent(db, a), await spent(db, b)], [300, 200]);
  await fourPlaces(db, [a, b]);
});

await test('Q12\'s own example: ₱100 for 3 pieces moved one at a time → ₱33.33 + ₱33.33 + ₱33.34', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const pid = await warehouseBuy(db, 'Cement', 3, { amount: 100 });
  await match(db, STAFF, pid, 1, it, 3);
  await receive(db, BUYER, pid, 1, 3);
  const fs = [await folder(db, 'A'), await folder(db, 'B'), await folder(db, 'C')];
  const vals = [];
  for (const f of fs) {
    await period(db, f);
    const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 1, unplanned_reason: 'x' });
    vals.push(num((await cdecide(db, OWNER, r.cost_moves[0], true)).value));
  }
  eq(vals, [33.33, 33.33, 33.34]);
  await fourPlaces(db, fs);
});

await test('a delivery fee on Cover while its line sat on the period: the move comes off each in proportion (Q15)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 1000);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const pj = await buyWith(db, [{ folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000 }], [{ kind: 'delivery_fee', amount: 100 }]);
  await match(db, STAFF, pj, 1, it, 10);
  eq((await all(db, `select amount a, cover_expense c from expenses order by amount desc`)).map(r => [num(r.a), r.c]), [[1000, false], [100, true]],
     'the line fills the period; its fee goes to Cover');
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  eq(num((await cdecide(db, OWNER, r.cost_moves[0], true)).value), 550);
  eq((await stockRows(db, a)).map(x => [x[1], x[2]]), [[-500, false], [-50, true]], '₱500 off the period, ₱50 off Cover');
  await fourPlaces(db, [a, b]);
});

await test('a project\'s own leftovers moved from its site to the warehouse keep their cost there: no request (12 Oct)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const r0 = await request(db, a, { item: it, quantity: 6 });
  const pj = await projectBuy(db, a, 'Cement', 6, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 4, 'site');
  const m = await move(db, STAFF, { item_id: it, from: a, to: 'warehouse', quantity: 3 });
  eq(m.cost_moves, []);
  eq(await spent(db, a), 600);
  eq(await companyStock(db), [], 'still the project\'s cost, not company stock');
  await fourPlaces(db, [a]);
});

await test('a return after the assignment was approved brings back the project\'s goods — even with company goods still waiting there', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 3, unplanned_reason: 'slab' });
  const ret = await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 2 });
  eq((await costsOf(db, ret.record_id)).map(c => [c.kind, c.from_folder, c.to_folder, num(c.quantity)]), [['back', a, null, 2]]);
  await as(db, OWNER);
  eq(num((await one(db, `select stk_cost_effective($1) e`, [i2.cost_moves[0]])).e), 3, 'the other issue still waits for all 3');
  await fourPlaces(db, [a]);
});

await test('two requests waiting on the same goods: the earlier one is charged first — never both for the same bags', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await move(db, STAFF, { item_id: it, from: a, to: 'warehouse', quantity: 5 });   // 3 left at the site
  await as(db, OWNER);
  eq([num((await one(db, `select stk_cost_effective($1) e`, [i1.cost_moves[0]])).e),
      num((await one(db, `select stk_cost_effective($1) e`, [i2.cost_moves[0]])).e)], [3, 0]);
  await refused(cdecide(db, OWNER, i2.cost_moves[0], true), 'NOTHING_LEFT', 'the later one first');
  eq(num((await cdecide(db, OWNER, i1.cost_moves[0], true)).value), 300);
  await fourPlaces(db, [a]);
});

await test('a reversal is refused while the goods it brought have moved on — counted by whose cost they are', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 3, unplanned_reason: 'slab' });
  const m = await move(db, STAFF, { item_id: it, from: a, to: 'warehouse', quantity: 3 });   // i2's company goods leave first
  eq(m.cost_moves, [], 'company goods back to company stock: nothing to ask');
  await refused(reverse(db, STAFF, i2.record_id, 'wrong'), 'MOVED_ON', 'its goods are back in the warehouse');
  await reverse(db, STAFF, m.record_id, 'wrong');
  await reverse(db, STAFF, i2.record_id, 'wrong');
  eq((await cost(db, i2.cost_moves[0])).status, 'withdrawn');
  eq([await bal(db, it, 'warehouse'), await bal(db, it, a), await spent(db, a)], [6, 4, 400]);
  await fourPlaces(db, [a]);
});

// ── C. Pending shrinks; reject; resubmit (Q10, Q19, Q20) ──────────────

await test('goods that left before approval are not charged: the pending assignment shrinks; nothing left → only a rejection', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 5, unplanned_reason: 'slab' });
  const ret = await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 2 });
  eq(ret.cost_moves, [], 'company goods back to company stock: nothing to ask');
  await as(db, OWNER);
  const card = (await one(db, `select stk_cost_pending() x`)).x;
  eq(card.map(x => [num(x.quantity), num(x.effective), num(x.estimate)]), [[5, 3, 300]], 'the card shows what is still there');
  const a1 = await cdecide(db, OWNER, i1.cost_moves[0], true);
  eq([num(a1.quantity), num(a1.value)], [3, 300], 'whole, for what is still there');
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 2, unplanned_reason: 'slab' });
  await move(db, STAFF, { item_id: it, returns_record: i2.record_id, quantity: 2 });
  await refused(cdecide(db, OWNER, i2.cost_moves[0], true), 'NOTHING_LEFT');
  await refused(cdecide(db, OWNER, i2.cost_moves[0], false, ' '), 'REASON_REQUIRED', 'a rejection needs a reason');
  eq((await cdecide(db, OWNER, i2.cost_moves[0], false, 'all returned')).status, 'rejected');
  eq(await spent(db, a), 300);
  await fourPlaces(db, [a]);
});

await test('reject keeps the goods recorded and the cost where it was; a stock recorder resubmits with a note — no second movement', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  const id = i1.cost_moves[0];
  await cdecide(db, OWNER, id, false, 'which slab?');
  eq([await bal(db, it, a), await spent(db, a)], [4, 0]);
  await refused(cresubmit(db, STAFF, id, ' '), 'REASON_REQUIRED');
  await refused(cresubmit(db, WORKER, id), 'NOT_OFFICE');
  const rs = await cresubmit(db, STAFF, id, 'Slab 2 — see photo');
  const n = await cost(db, rs.cost_move_id);
  eq([n.status, n.resubmits, n.note, num(n.quantity), n.record_id], ['pending', id, 'Slab 2 — see photo', 4, i1.record_id]);
  await refused(cresubmit(db, BUYER, id), 'BAD_STATE', 'one open request per movement');
  eq((await all(db, `select id from stk_records where kind = 'issue'`)).length, 1);
  await cdecide(db, OWNER, n.id, true);
  eq(await spent(db, a), 400);
  await refused(cresubmit(db, STAFF, id), 'BAD_STATE', 'already approved');
  const ev = (await all(db, `select kind from stk_events where cost_move_id is not null order by id`)).map(r => r.kind);
  eq(ev, ['cost_requested', 'cost_rejected', 'cost_resubmitted', 'cost_approved']);
});

// ── D. Who ───────────────────────────────────────────────────────────

await test('only the main owner approves, rejects and reverses; owner accounts see values, staff only the state', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  const id = i1.cost_moves[0];
  for (const who of [STAFF, BUYER, EXPOWNER, PMOWNER, WORKER]) {
    await refused(cdecide(db, who, id, true), 'OWNER_ONLY', who);
    await as(db, who);
    await refused(db.query(`select stk_cost_pending()`), 'OWNER_ONLY', who);
  }
  // Another company's main owner: their own stock is off; switched on, ours is not theirs.
  await refused(cdecide(db, OTHER, id, true), 'STOCK_OFF');
  await as(db, OTHER); await db.query(`select stk_set_enabled(true)`);
  await refused(cdecide(db, OTHER, id, true), 'NOT_FOUND');
  eq((await one(db, `select stk_cost_pending() x`)).x, [], 'their list is their own');
  await as(db, STAFF);
  const rec = (await one(db, `select stk_item($1) x`, [it])).x;
  const json = JSON.stringify(rec);
  assert(json.includes('"status":"pending"') && json.includes('"kind":"assign"'), 'staff see the state');
  assert(!/"value"|"estimate"/.test(json), 'staff never see a value');
  await refused(db.query(`select stk_company_stock()`), 'NOT_ALLOWED', 'company stock is for owner accounts');
  await refused(companyStock(db, EXPOWNER), 'STOCK_OFF', 'an owner account with its own scope reads its own (off)');
  eq((await companyStock(db, OWNER))[0][0], 'Cement');
  await cdecide(db, OWNER, id, true);
  for (const who of [STAFF, EXPOWNER]) await refused(creverse(db, who, id), 'OWNER_ONLY', who);
  await as(db, OWNER);
  assert(/"value":400/.test(JSON.stringify((await one(db, `select stk_item($1) x`, [it])).x)), 'the owner sees ₱400');
});

await test('a completed project: approval refused until it is reopened (Q16) — into it, out of it, or a job under it; rejecting still works', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const aw = await folder(db, 'Extra room', { parent: a });
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 3, unplanned_reason: 'slab' });
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: aw, quantity: 3, unplanned_reason: 'room' });
  await db.query(`update folders set completed_at = now() where id = $1`, [a]);
  await refused(cdecide(db, OWNER, i1.cost_moves[0], true), 'COMPLETED_PROJECT');
  await refused(cdecide(db, OWNER, i2.cost_moves[0], true), 'COMPLETED_PROJECT', 'a job under a completed project');
  await db.query(`update folders set completed_at = null where id = $1`, [a]);
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const m = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 1, unplanned_reason: 'formwork' });
  await db.query(`update folders set completed_at = now() where id = $1`, [a]);
  await refused(cdecide(db, OWNER, m.cost_moves[0], true), 'COMPLETED_PROJECT', 'out of a completed project');
  eq((await cdecide(db, OWNER, m.cost_moves[0], false, 'project closed')).status, 'rejected');
  eq(await spent(db, b), 0);
});

// ── E. Never edited: reversal (Q21–Q23) ──────────────────────────────

await test('a movement is not reversed while an approved cost move rides on it (COST_MOVED); its pending one is withdrawn', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await reverse(db, STAFF, i1.record_id, 'wrong project');
  eq((await cost(db, i1.cost_moves[0])).status, 'withdrawn');
  await refused(cdecide(db, OWNER, i1.cost_moves[0], true), 'BAD_STATE');
  const i2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i2.cost_moves[0], true);
  await refused(reverse(db, OWNER, i2.record_id, 'wrong'), 'COST_MOVED');
  await refused(creverse(db, OWNER, i2.cost_moves[0], ' '), 'REASON_REQUIRED');
  await creverse(db, OWNER, i2.cost_moves[0], 'wrong project');
  eq([await spent(db, a), (await all(db, `select 1 from expenses where stk_cost_move_id is not null`)).length], [0, 0], 'its rows are gone');
  const c = await cost(db, i2.cost_moves[0]);
  eq([c.status, c.reverse_reason, num(c.value)], ['approved', 'wrong project', 400], 'the record and its reason stay');
  await reverse(db, OWNER, i2.record_id, 'wrong project');
  eq(await bal(db, it, 'warehouse'), 10);
  await refused(creverse(db, OWNER, i2.cost_moves[0]), 'BAD_STATE', 'reversed once');
});

await test('cost reversals go newest first: a later approved move (or movement) relying on one blocks it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Bagong'); await period(db, b);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const m = await move(db, STAFF, { item_id: it, from: a, to: b, quantity: 4, unplanned_reason: 'formwork' });
  await cdecide(db, OWNER, m.cost_moves[0], true);
  eq([await spent(db, a), await spent(db, b)], [0, 400]);
  await refused(creverse(db, OWNER, i1.cost_moves[0]), 'LATER_MOVES_FIRST');
  await creverse(db, OWNER, m.cost_moves[0]);
  await refused(creverse(db, OWNER, i1.cost_moves[0]), 'LATER_MOVES_FIRST', 'the goods physically left A on A\'s cost');
  await reverse(db, OWNER, m.record_id, 'wrong site');
  await creverse(db, OWNER, i1.cost_moves[0]);
  eq([await spent(db, a), await spent(db, b)], [0, 0]);
  await fourPlaces(db, [a, b]);
});

await test('a purchase line\'s price or quantity cannot change while approved cost moves value its lot (Q21); other changes can', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const line = { folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000, request_line_id: r0.line };
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const m = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, m.cost_moves[0], true);
  const fix = (l, extra = {}) => { const x = body([{ ...l }], extra); delete x.lines[0].unplanned_reason; return x; };
  await as(db, OWNER);
  await refused(db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), pj, JSON.stringify(fix({ ...line, amount: 1200 }))]), 'STOCK_COST_IN_USE');
  const same = fix(line); same.supplier = 'CW Home Depot';
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'supplier')`, [op(), pj, JSON.stringify(same)]);
  eq([await spent(db, a), await spent(db, b)], [500, 500], 'a supplier fix changes no peso');
  await creverse(db, OWNER, m.cost_moves[0], 'price was wrong');
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), pj, JSON.stringify(fix({ ...line, amount: 1200 }))]);
  eq([await spent(db, a), await spent(db, b)], [1200, 0]);
  // Reversed to fix the price: a stock recorder asks again for the same movement.
  const again = await cresubmit(db, STAFF, m.cost_moves[0], 'price fixed');
  eq(num((await cdecide(db, OWNER, again.cost_move_id, true)).value), 600, '₱1,200 × 5/10');
  eq([await spent(db, a), await spent(db, b)], [600, 600]);
  await refused(db.query(`select pur_correct($1, $2, $3::jsonb, 'qty')`, [op(), pj, JSON.stringify(fix({ ...line, quantity: 8, amount: 1200 }))]),
                'STOCK_COST_IN_USE', 'quantity too');
  await fourPlaces(db, [a, b]);
});

await test('re-funding after a partial transfer (R81 rev 2): refused while cost moves rely on it — period totals, Cover and later transfers stay right', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); const p1 = await period(db, a, 600);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const c = await folder(db, 'Cubao'); await period(db, c);
  let p2 = null;
  // A's money by billing period and Cover: {"p1|false": 480, …}
  const groups = async () => {
    const rows = await all(db, `select e.project_id p, e.cover_expense c, sum(e.amount) s from expenses e left join projects pp on pp.id = e.project_id
                                 where coalesce(e.folder_id, pp.folder_id) = $1 group by 1, 2`, [a]);
    const out = {};
    for (const r of rows) out[(r.p === p1 ? 'p1' : r.p === p2 ? 'p2' : r.p ? 'other' : 'none') + '|' + r.c] = Math.round(num(r.s) * 100) / 100;
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== 0).sort());
  };
  const refund = () => rpc(db, OWNER, 'pur_refund', [op(), pj, 'billing periods re-checked']);
  const pj = await projectBuy(db, a, 'Cement', 10);            // ₱1,000 → ₱600 billing #1, ₱400 Cover
  await match(db, STAFF, pj, 1, it, 10);
  eq(await groups(), { 'p1|false': 600, 'p1|true': 400 });
  await refund();                                               // nothing relies on it yet: allowed
  eq(await groups(), { 'p1|false': 600, 'p1|true': 400 });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const m1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 2, unplanned_reason: 'slab' });
  eq(num((await cdecide(db, OWNER, m1.cost_moves[0], true)).value), 200);
  eq(await groups(), { 'p1|false': 480, 'p1|true': 320 }, '₱200 off in proportion: ₱120 period, ₱80 Cover');
  // The transfer freed ₱120 of billing #1, so re-funding would now move rows: refused.
  await refused(refund(), 'STOCK_COST_FUNDING', 'freed budget');
  // A second billing period this month would take the Cover part: refused too; a correction that re-funds as well.
  p2 = await periodOn(db, a, TODAY, 1000, 2);
  await refused(refund(), 'STOCK_COST_FUNDING', 'a new billing period');
  const fix = body([{ folder_id: a, item_name: 'Cement', quantity: 10, amount: 1000 }]); fix.supplier = 'CW Home Depot';
  await refused(rpc(db, OWNER, 'pur_correct', [op(), pj, JSON.stringify(fix), 'supplier']), 'STOCK_COST_FUNDING', 'a supplier fix that re-funds');
  eq(await groups(), { 'p1|false': 480, 'p1|true': 320 }, 'nothing moved');
  eq((await all(db, `select kind from purchase_history where purchase_id = $1 order by id`, [pj])).map(r => r.kind), ['recorded', 'refunded'],
     'the refusals left no history');
  // A later transfer while it stands: off the same groups, in proportion.
  const m2 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: c, quantity: 2, unplanned_reason: 'slab' });
  eq(num((await cdecide(db, OWNER, m2.cost_moves[0], true)).value), 200);
  eq(await groups(), { 'p1|false': 360, 'p1|true': 240 });
  eq([await spent(db, b), await spent(db, c)], [200, 200]);
  await fourPlaces(db, [a, b, c]);
  // Reverse both (newest first): now the re-fund goes through — ₱600 billing #1, ₱400 billing #2, no Cover.
  await creverse(db, OWNER, m2.cost_moves[0], 'to re-fund');
  await creverse(db, OWNER, m1.cost_moves[0], 'to re-fund');
  await refund();
  eq(await groups(), { 'p1|false': 600, 'p2|false': 400 });
  // Asked again and approved: off the new groups — no Cover left to reduce.
  const again = await cresubmit(db, STAFF, m1.cost_moves[0], 'after re-funding');
  eq(num((await cdecide(db, OWNER, again.cost_move_id, true)).value), 200);
  eq(await groups(), { 'p1|false': 480, 'p2|false': 320 });
  await refused(refund(), 'STOCK_COST_FUNDING', 'relied on again');
  await fourPlaces(db, [a, b, c]);
});

// ── F. Company stock loss (Q27) ──────────────────────────────────────

await test('a confirmed warehouse loss of company goods: value to company stock loss with the count — no Spent anywhere; reversed with it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const pid = await stocked(db, it, 10);
  const before = await money(db);
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 7, reason: 'damaged' });
  eq((await costsOf(db, c.record_id)).length, 0, 'nothing until the main owner confirms');
  await decide(db, OWNER, c.record_id, true);
  const loss = await costsOf(db, c.record_id);
  eq(loss.map(x => [x.kind, x.status, num(x.approved_quantity), num(x.value), x.location]), [['loss', 'approved', 3, 300, null]]);
  eq(await money(db), before, 'no expense row');
  eq(await companyStock(db), [['Cement', 7, 700, 0, 0, 0, 3, 300]]);
  await reverse(db, OWNER, c.record_id, 'found them');
  eq((await cost(db, loss[0].id)).reversed_at !== null, true);
  eq(await companyStock(db), [['Cement', 10, 1000, 0, 0, 0, 0, 0]]);
  // A project's own leftovers lost: they stay its cost — no loss move.
  const r0 = await request(db, a, { item: it, quantity: 4 });
  const pj = await projectBuy(db, a, 'Cement', 4, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 4, 'site');
  const c2 = await count(db, STAFF, { item_id: it, at: a, counted: 1, reason: 'lost' });
  await decide(db, OWNER, c2.record_id, true);
  eq((await costsOf(db, c2.record_id)).length, 0);
  eq(await spent(db, a), 400);
  await fourPlaces(db, [a]);
  void pid;
});

await test('untraced old stock is ₱0 and never asks for a cost move (Q13)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  const o = await opening(db, STAFF, { item_id: it, at: 'warehouse', quantity: 20 });
  await decide(db, OWNER, o.record_id, true);
  const m = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 5, unplanned_reason: 'slab' });
  eq(m.cost_moves, []);
  const c = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 10, reason: 'other' });
  await decide(db, OWNER, c.record_id, true);
  eq((await all(db, `select 1 from stk_cost_moves`)).length, 0);
  eq(await companyStock(db), [], 'untraced goods are not company stock value');
});

// ── G. The money, everywhere ─────────────────────────────────────────

await test('a busy day: every peso of every line in exactly one place — company stock, a project, or company stock loss', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 700);
  const b = await folder(db, 'Bagong'); await period(db, b, 250);
  const cc = await folder(db, 'Cubao'); await period(db, cc);
  const w1 = await buyWith(db, [{ destination: 'warehouse', item_name: 'Cement', quantity: 7, amount: 1777.77 }],
                           [{ kind: 'delivery_fee', amount: 33.33 }]);
  await match(db, STAFF, w1, 1, it, 7); await receive(db, BUYER, w1, 1, 7);
  const w2 = await warehouseBuy(db, 'Cement', 6, { amount: 1000 });
  await match(db, STAFF, w2, 1, it, 6); await receive(db, BUYER, w2, 1, 6);
  const r0 = await request(db, a, { item: it, quantity: 9 });
  const pj = await projectBuy(db, a, 'Cement', 9, { requestLine: r0.line, amount: 999.99 });
  await leftover(db, STAFF, pj, 1, 4, 'warehouse');
  const ok = async (rec) => { for (const id of rec.cost_moves) await cdecide(db, OWNER, id, true); };
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 5, unplanned_reason: 'x' }));
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 6, unplanned_reason: 'x' }));
  await ok(await move(db, STAFF, { item_id: it, from: a, to: cc, quantity: 3, unplanned_reason: 'formwork' }));
  await ok(await move(db, STAFF, { item_id: it, from: b, to: 'warehouse', quantity: 2 }));
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: cc, quantity: 4, unplanned_reason: 'x' }));
  await ok(await move(db, STAFF, { item_id: it, from: cc, to: b, quantity: 2, unplanned_reason: 'formwork' }));
  const cnt = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 0, reason: 'damaged' });
  if (cnt.status === 'pending') await decide(db, OWNER, cnt.record_id, true);
  await fourPlaces(db, [a, b, cc]);
  const total = await one(db, `select coalesce(sum(amount), 0) s from expenses where stk_cost_move_id is not null`);
  assert(Math.abs(num(total.s)) > 0, 'cost moves wrote rows');
  for (const [nm, x] of await all(db, `select split_group, sum(split_total) from expenses where split_group like 'stkcost:%' group by 1`).then(r => r.map(y => [y.split_group, 0]))) void nm, x;
});

await test('deleting is guarded: cost-move rows are never edited or deleted by hand; a project or billing period holding stock is never deleted', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); const p = await period(db, a);
  const b = await folder(db, 'Bagong');
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const e = (await one(db, `select id from expenses where stk_cost_move_id is not null`)).id;
  await refused(db.query(`update expenses set amount = 1 where id = $1`, [e]), 'STOCK_COST_ROW');
  await refused(db.query(`update expenses set expense_name = 'x' where id = $1`, [e]), 'STOCK_COST_ROW');
  await refused(db.query(`delete from expenses where id = $1`, [e]), 'STOCK_COST_ROW');
  await refused(db.query(`insert into expenses (owner_id, project_id, amount, stk_cost_move_id) values ($1, $2, 5, $3)`,
                         [OWNER, p, i1.cost_moves[0]]), 'STOCK_COST_ROW');
  await refused(db.query(`delete from projects where id = $1`, [p]), 'STOCK_LIVE');
  await refused(db.query(`delete from folders where id = $1`, [a]), 'STOCK_LIVE');
  // A project with only a pending request (goods still at its site) is held too.
  await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 1, unplanned_reason: 'x' });
  await refused(db.query(`delete from folders where id = $1`, [b]), 'STOCK_LIVE');
  // An ordinary expense row is untouched by all this.
  await db.query(`insert into expenses (owner_id, project_id, amount, expense_name) values ($1, $2, 50, 'Nails')`, [OWNER, p]);
  await db.query(`delete from expenses where expense_name = 'Nails'`);
});

await test('stock off: nothing can be decided; the Owner approvals list is empty; company stock is not read', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await as(db, OWNER); await db.query(`select stk_set_enabled(false)`);
  await refused(cdecide(db, OWNER, i1.cost_moves[0], true), 'STOCK_OFF');
  await refused(creverse(db, OWNER, i1.cost_moves[0]), 'STOCK_OFF');
  await refused(cresubmit(db, STAFF, i1.cost_moves[0]), 'STOCK_OFF');
  await as(db, OWNER);
  eq((await one(db, `select stk_cost_pending() x`)).x, []);
  await refused(db.query(`select stk_company_stock()`), 'STOCK_OFF');
});

await test('a retried approval records once and returns the first answer', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a);
  await stocked(db, it, 10);
  const i1 = await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 4, unplanned_reason: 'slab' });
  await as(db, OWNER);
  const o = op();
  const r1 = (await one(db, `select stk_cost_decide($1, $2, true, 'ok') r`, [o, i1.cost_moves[0]])).r;
  const r2 = (await one(db, `select stk_cost_decide($1, $2, true, 'ok') r`, [o, i1.cost_moves[0]])).r;
  eq([r2.cost_move_id, r2.replayed, num(r2.value)], [r1.cost_move_id, true, 400]);
  eq(await spent(db, a), 400, 'once');
});

await test('permissions: the five new calls for authenticated only; stk_cost_moves has RLS and no policy; helpers are internal', async () => {
  const db = await fresh();
  for (const f of ['stk_cost_decide(uuid,uuid,boolean,text)', 'stk_cost_reverse(uuid,uuid,text)', 'stk_cost_resubmit(uuid,uuid,text)',
                   'stk_cost_pending()', 'stk_company_stock()', 'stk_move(uuid,jsonb)', 'stk_decide(uuid,uuid,boolean,text)',
                   'stk_reverse(uuid,uuid,text)']) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x,
        (await one(db, `select has_function_privilege('anon', $1, 'execute') x`, [f])).x], [f, true, false]);
  }
  for (const f of ['stk_bucket_balance(uuid,uuid,uuid,uuid)', 'stk_buckets(uuid,uuid)', 'stk_lot_basis(uuid)', 'stk_held(uuid,uuid)',
                   'stk_cost_value(uuid,uuid,numeric)', 'stk_cost_effective(uuid)', 'stk_cost_requests(uuid)', 'stk_cost_losses(uuid)',
                   'stk_cost_carriers(uuid,uuid)', 'stk_cost_rows(uuid)', 'stk_cost_json(uuid)', 'stk_folder_name(uuid)',
                   'stk_folder_completed(uuid)', 'stk_take(uuid,uuid,uuid,numeric,uuid)', 'stk_check_record(uuid)',
                   'stk_record_json(uuid)', 'stk_moves_holder()', 'stk_guard_cost_basis()', 'pur_guard_expense_row()', 'pur_guard_delete()']) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x], [f, false]);
  }
  const r = await one(db, `select relrowsecurity rls, (select count(*) from pg_policies where tablename = 'stk_cost_moves') n
                             from pg_class where relname = 'stk_cost_moves'`);
  eq([r.rls, num(r.n)], [true, 0]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

<!-- Code -->

**Modify:** `docs/DATABASE_SCHEMA.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
index 886c33c..a13dfa5 100644
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -196,6 +196,7 @@ no envelope.
 | `splitGroup?` `splitIndex?` `splitTotal?` | — | multi-source split metadata |
 | `clientSubmissionId?` | uuid | `client_submission_id` — one id per Save press; unique with `split_index` (0089), so a retry cannot duplicate |
 | `purchaseLineId?` `purchaseChargeId?` | uuid | `purchase_line_id` / `purchase_charge_id` (0096): the row was written by a **purchase** (`pur_record`). It changes only through `pur_correct` / `pur_refund` / `pur_void` — the `expenses_purchase_guard` trigger refuses any other insert, update or delete |
+| `stkCostMoveId?` | uuid | `stk_cost_move_id` (0105): the row was written by a stock cost move the main owner approved (`stk_cost_decide`); negative on the giving project. It leaves only through `stk_cost_reverse` — the same trigger refuses anything else (`STOCK_COST_ROW`). See *Stock cost moves (0105)* |
 | `folderId?` | uuid | `folder_id` (0096): set ONLY on a purchase row for a project with **no billing period** for the purchase month and no Cover period (`projectId` null). It is that project's Cover Material — counted once in Material, Spent and Cover, in no period's envelope, shown as "No billing period" — until a re-fund moves it onto a period |
 | `createdAt` | ts | |
 
@@ -1130,7 +1131,7 @@ Every table has RLS on, **no policies** and every privilege revoked: the screens
 
 ## Stock (0104) — WorkMate Stage 2B-a
 
-Quantities only, in catalogue units — **no peso amount anywhere** (the value of stock and every cost move are Stage 2C, main owner). Private tables (RLS on, no policies): reads and writes only through the `stk_*` functions. Dormant until the main owner switches stock on (`stk_set_enabled`); until then every write is `STOCK_OFF`.
+Quantities only, in catalogue units — **no peso amount anywhere** (the value of stock and every cost move are 0105, below — main owner). Private tables (RLS on, no policies): reads and writes only through the `stk_*` functions. Dormant until the main owner switches stock on (`stk_set_enabled`); until then every write is `STOCK_OFF`.
 
 | Table | What it holds |
 |---|---|
@@ -1166,6 +1167,33 @@ Guards: `stk_guard_line` (a purchase line may not undo its stock: destination, p
 
 Catalogue (0092 extended): `pr_item_in_use(item)` = a request line, a stock match, a lot or any stock record uses it. `pr_office_save_item` refuses a Kind or Unit change of such an item (`ITEM_IN_USE`), and `pr_office_catalog`'s `in_use` counts stock too, so the Catalogue form locks the two fields.
 
+## Stock cost moves (0105) — WorkMate Stage 2C
+
+Where the **cost** of stock sits, decided by the **main owner**. Moving goods never moves their cost by itself: every stock move row carries its `holder` (a project folder, or null = the company), and when goods arrive where someone else holds their cost the server opens a pending cost move. Approval writes **ordinary `expenses` rows** tied to the cost move (`stk_cost_move_id`) — so every Spent / Cover / report site reads them like any other row. Company stock is never in a project's Spent, nor in company overhead (G&A). Client billing is never changed.
+
+| Table / column | What it holds |
+|---|---|
+| `stk_moves.holder` | Whose cost the moved goods are. Goods entering stock take their lot's `cost_folder_id` (trigger `stk_moves_holder`): a warehouse purchase = the company; leftovers / traced opening stock = their project, even in the warehouse |
+| `stk_cost_moves` | `id`, `kind` (`assign` company → project, `transfer` project → project, `back` project → company, `loss` company stock → company stock loss), `status` (`pending`, `approved`, `rejected`, `withdrawn`), `record_id` + `move_id` (the physical record and move row), `lot_id`, `layer`, `location` (null for a loss), `from_folder` / `to_folder` (null = company), `quantity` (asked), `approved_quantity`, `value` (pesos), `basis_value` / `basis_quantity` (the lot's price and quantity it was valued at), `basis_alloc` (where its purchase's cost sat when approved — `stk_purchase_alloc`: its rows summed by billing period, project and Cover), `received_on` (the day the project received the goods — funding month), `resubmits` (the rejected / reversed one it asks again for), `note`, `requested_*`, `decided_*` + `decision_note`, `reversed_*` + `reverse_reason`. RLS on, no policies |
+| `expenses.stk_cost_move_id` | The approved cost move that wrote the row (both sides). Changed only by the stock functions — `pur_guard_expense_row` refuses anything else (`STOCK_COST_ROW`) |
+| `stk_events.cost_move_id` | `cost_requested`, `cost_approved`, `cost_rejected`, `cost_resubmitted`, `cost_withdrawn`, `cost_reversed` |
+
+When a cost move is opened (`stk_cost_requests`, after every physical move, untraced lots never): goods arriving at a project site whose holder is not that project → `assign` (from the company) or `transfer` (from another project); a **company** lot's goods brought to the warehouse while a project holds them → `back`. A project's own leftovers keep their cost in the warehouse. A confirmed loss (`stk_decide` on a count) of company-held goods → an approved `loss` with the count (`stk_cost_losses`): value to company stock loss, **no expense row**; reversing the count reverses it.
+
+Value (`stk_lot_basis`, `stk_held`, `stk_cost_value`): a lot is worth its purchase line's item amount − discount shares + delivery-fee shares, for the line's quantity in item units; its own holder starts with all of it. Each approved move takes the line's cost × quantity / the line's quantity, to the centavo; the **last** portion out of a holder takes what it holds, so the portions of a line always add up to it exactly (₱100 for 3 pieces → ₱33.33 + ₱33.33 + ₱33.34). A pending move covers only what the holder still has there after earlier pending requests (`stk_cost_effective`) — goods that left before approval are not charged; approval is whole, for that.
+
+Rows (`stk_cost_rows`): the receiving project is funded like a purchase (`pur_fund`: its periods for the month in `received_on`, earliest billing number first, the rest Cover; Additional Works its own period) — "From warehouse — item" / "Moved from A — item"; the giving project gets negative rows on every (billing period, Cover) group that carried the lot's cost for it (its purchase line rows, its share of the delivery-fee rows, earlier cost-move rows — `stk_cost_carriers`), in proportion with `pur_prorate` — "Moved to B — item" / "Back to company stock — item". A split is one `split_group` (`stkcost:<id>:in|out`).
+
+| Function | Who | What |
+|---|---|---|
+| `stk_cost_decide(op, cost, approve, note)` | main owner | Approve (refused `COMPLETED_PROJECT` into or out of a completed project or a job under one; `NOTHING_LEFT` when the goods are gone) or reject with a reason (the goods stay recorded, the cost stays) |
+| `stk_cost_reverse(op, cost, reason)` | main owner | Its rows leave Spent; the record stays. Refused `LATER_MOVES_FIRST` while later movements or cost moves rely on it. A loss goes with its count instead |
+| `stk_cost_resubmit(op, cost, note)` | stock recorders | Ask again for the same movement after a rejection or a reversal — no second physical record |
+| `stk_cost_pending()` | main owner | The Owner approvals cards: what is still there, the estimate, the giving project's groups, the record and its evidence. Stock off: `[]` |
+| `stk_company_stock()` | owner accounts | By item: in the warehouse, issued with the assignment pending, awaiting delivery, company stock loss — quantity and value |
+
+Redefined: from 0104 `stk_take` (returns the holder; within a delivery, goods not yet the place's own leave first), `stk_check_record`, `stk_move` (holder on every row; a return takes the issue's goods as their cost now stands; then `stk_cost_requests`; answer + `cost_moves`), `stk_decide` (+ `stk_cost_losses`), `stk_reverse` (`COST_MOVED` while an approved cost move rides on the record; pending ones withdrawn), `stk_record_json` (`costs` — states for everyone who reads stock, `value` / `estimate` keys for owner accounts only); from 0096 `pur_guard_expense_row` and `pur_guard_delete` (a project with live stock records or open cost moves, or a billing period carrying cost-move rows: `STOCK_LIVE`). Guard `stk_guard_cost_basis` (after insert on `purchase_history`, kinds corrected / unit_checked / refunded — every 2A path that stores a purchase again, an approved change request included): a purchase line's price or quantity cannot change while approved cost moves value its lot (`STOCK_COST_IN_USE`), and neither can where the purchase's cost sits — its rows' billing periods and Cover (`STOCK_COST_FUNDING`; reverse those moves first). Locks: the lot's purchase first (as every purchase write), then the item and the projects charged in one sorted pass; a count's loss and a purchase correction meet on the lot row.
+
 ## PM profit sharing (0098)
 
 An internal owner/partner allocation per PM project - **outside the money model** (never a payout, invoice or accounting entry). Spec `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`; plan `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`. `project_id` is a `construction_projects.id` (never a `folders.id`). The three tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`: nothing reads or writes them directly. Read through `pm_sharing_read` (owner-role accounts of the company); write through `pm_set_sharing` (main owner only).
```

**Modify:** `package.json` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/package.json b/package.json
index a9630f6..7c7cc68 100644
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**Create:** `supabase/migrations/0105_stock_cost_moves.sql`

```sql
-- 0105 — WorkMate Stage 2C: owner-confirmed stock cost moves (the money of stock).
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- (Warehouse cost assignment, Project-to-project material cost transfers,
-- §3.8); answers: docs/superpowers/specs/2026-10-24-workmate-stage2bc-questions.md
-- (all A); plan: docs/superpowers/plans/2026-10-26-workmate-stage2c-cost-moves.md.
-- Builds on 0104 (2B-a, quantities). Stock stays switched off until the joint launch.
--
-- ── 1. Whose cost goods are (the HOLDER). The company (null) or a project
--    (its folder). Every stock move row now carries the holder of the goods
--    it moved; goods entering stock take their lot's own holder (a warehouse
--    purchase: the company; leftovers or traced opening stock: their
--    project — 12 Oct: leftovers keep their project's cost, even in the
--    warehouse). Quantities are kept per (lot, layer, holder, place).
--
-- ── 2. When goods cross holders, the server asks the main owner. After
--    every physical move: goods arriving at a project held by someone else
--    → a PENDING cost move to that project ("Cost assignment pending" from
--    the company, Q11; "Cost transfer pending" from another project, Q12);
--    a company lot's goods brought back to the warehouse while a project
--    holds them → a pending cost move back to company stock (Q10). Until
--    the main owner approves, the cost stays where it was. A pending cost
--    move covers what is STILL there: goods that left before approval are
--    not charged (Q10, "the pending assignment simply shrinks"); approval is
--    whole or nothing for what is there (Q20). Reject keeps the movement and
--    the cost where it was (Q19); a stock recorder resubmits the cost request
--    for the same movement, with a note.
--
-- ── 3. What a portion is worth (Q12). By lot: a purchase line's item amount
--    less its discount shares plus its delivery-fee shares, over the line's
--    quantity in item units. The line's base holder starts holding all of it;
--    each approved move takes the line's cost × quantity / the line's
--    quantity, rounded to the centavo, and the LAST portion out of a holder
--    takes what it holds — so the portions of a line always add up to exactly
--    its cost (₱100 for 3 pieces → ₱33.33 + ₱33.33 + ₱33.34).
--    Untraced old stock is worth ₱0 and never asks for a cost move (Q13).
--
-- ── 4. The money (Q14, Q15, Q24, Q25). Approval writes ordinary expense
--    rows tied to the cost move (expenses.stk_cost_move_id), so every place
--    that shows Spent reads them like any other row:
--      receiving project — funded like a purchase (pur_fund): its periods for
--      the month it RECEIVED the goods, earliest billing number first, the
--      rest Cover; rows "From warehouse — item" / "Moved from A — item";
--      giving project — negative rows on every (billing period, Cover) group
--      that carried that lot's cost for it (its purchase line rows, its share
--      of the delivery fee, earlier cost-move rows), in proportion, to the
--      centavo (largest remainder, like fee shares); "Moved to B — item" /
--      "Back to company stock — item".
--    Company stock is never in any project's Spent nor in G&A. A confirmed
--    warehouse loss of company-held goods moves their value to COMPANY STOCK
--    LOSS with the count (Q27) — no Spent anywhere; a project's own leftovers
--    lost stay its cost. Every peso of a line is in exactly one place.
--    Client billing is never changed (Q25).
--
-- ── 5. Never edited (Q21–Q23). An approved cost move is reversed by the
--    main owner with a reason (its rows removed; refused while later moves
--    depend on it); a physical record is not reversed while an approved cost
--    move rides on it. A purchase line's price or quantity can't change while
--    approved cost moves value its lot — and neither can WHERE the purchase's
--    cost sits (its billing periods and Cover): a correction, re-funding or
--    approved change request that would move its rows waits until those cost
--    moves are reversed (rev 2). Into or out of a completed project:
--    refused until it is reopened (Q16).
--
-- Who: stock recorders (0104) cause cost moves by moving goods and may
-- resubmit a rejected one; only the MAIN OWNER approves, rejects and
-- reverses. Values are shown to owner accounts only (Q28). Each call carries
-- an operation id (pur_ops). Locks: the item, then each project charged
-- (pur_folder), in one sorted pass — the order purchases use.

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- Whose cost the moved goods are: a project (folder) or null = the company.
alter table stk_moves add column if not exists holder uuid;

-- A cost move: quantity of one lot and layer, at one place, from one holder
-- to another (null = company stock). 'loss' = company stock → company stock
-- loss (no place: the goods left stock).
create table if not exists stk_cost_moves (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('assign', 'transfer', 'back', 'loss')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  record_id uuid not null references stk_records(id),
  move_id bigint not null references stk_moves(id),
  lot_id uuid not null references stk_lots(id),
  layer uuid not null references stk_records(id),
  location uuid references stk_locations(id),
  from_folder uuid,
  to_folder uuid,
  quantity numeric(14,3) not null check (quantity > 0),
  approved_quantity numeric(14,3) check (approved_quantity > 0),
  value numeric(14,2) check (value >= 0),
  basis_value numeric(14,2),
  basis_quantity numeric(14,3),
  basis_alloc jsonb,                 -- where its purchase's cost sat when approved: {period|folder|cover: ₱}
  received_on date not null,
  resubmits uuid references stk_cost_moves(id),
  note text not null default '' check (char_length(note) <= 500),
  requested_by uuid not null references profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  reversed_by uuid references profiles(id),
  reversed_at timestamptz,
  reverse_reason text not null default '' check (char_length(reverse_reason) <= 500),
  check ((kind = 'loss') = (location is null)),
  check (kind <> 'loss' or (from_folder is null and to_folder is null)),
  check (kind <> 'assign' or (from_folder is null and to_folder is not null)),
  check (kind <> 'transfer' or (from_folder is not null and to_folder is not null and from_folder <> to_folder)),
  check (kind <> 'back' or (from_folder is not null and to_folder is null)),
  check ((status = 'approved') = (approved_quantity is not null and value is not null)),
  check (reversed_at is null or status = 'approved')
);
create index if not exists stk_cost_moves_lot on stk_cost_moves (lot_id, layer);
create index if not exists stk_cost_moves_record on stk_cost_moves (record_id);
create index if not exists stk_cost_moves_owner on stk_cost_moves (owner_id, status, requested_at);
alter table stk_cost_moves enable row level security;

-- The expense rows an approved cost move wrote (both sides).
alter table expenses add column if not exists stk_cost_move_id uuid references stk_cost_moves(id);
create index if not exists expenses_stk_cost_move on expenses (stk_cost_move_id) where stk_cost_move_id is not null;

alter table stk_events drop constraint if exists stk_events_kind_check;
alter table stk_events add constraint stk_events_kind_check
  check (kind in ('switched', 'matched', 'unmatched', 'confirmed', 'rejected', 'withdrawn', 'reversed',
                  'cost_requested', 'cost_approved', 'cost_rejected', 'cost_resubmitted', 'cost_withdrawn', 'cost_reversed'));
alter table stk_events add column if not exists cost_move_id uuid references stk_cost_moves(id);

-- Goods entering stock take their lot's own holder (receipts: the company;
-- leftovers and traced opening stock: their project). 0104's inflow paths
-- need no change.
create or replace function stk_moves_holder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.from_location is null then
    new.holder := (select lt.cost_folder_id from stk_lots lt where lt.id = new.lot_id);
  end if;
  return new;
end;
$$;
drop trigger if exists stk_moves_holder on stk_moves;
create trigger stk_moves_holder before insert on stk_moves
  for each row execute function stk_moves_holder();

-- ════ 2. Holders: quantities, values ═════════════════════════════════

-- What one holder has of a lot's layer at a place: live moves in and out
-- with that holder, plus approved cost moves re-labelling quantity there.
create or replace function stk_bucket_balance(p_lot uuid, p_layer uuid, p_holder uuid, p_loc uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when m.to_location = p_loc then m.quantity else -m.quantity end)
                     from stk_moves m join stk_records r on r.id = m.record_id
                    where m.lot_id = p_lot and m.layer = p_layer and m.holder is not distinct from p_holder
                      and (m.to_location = p_loc or m.from_location = p_loc)
                      and r.status = 'done' and r.reversed_at is null), 0)
       + coalesce((select sum(case when c.to_folder is not distinct from p_holder then c.approved_quantity else 0 end
                            - case when c.from_folder is not distinct from p_holder then c.approved_quantity else 0 end)
                     from stk_cost_moves c
                    where c.lot_id = p_lot and c.layer = p_layer and c.location = p_loc
                      and c.status = 'approved' and c.reversed_at is null), 0)
$$;

-- Every non-zero bucket of a company (optionally one item): lot, layer,
-- holder, place, the day its goods were received, quantity.
create or replace function stk_buckets(p_owner uuid, p_item uuid default null)
returns table (lot_id uuid, layer uuid, holder uuid, location_id uuid, received_on date, received_at timestamptz, quantity numeric)
language sql stable security definer set search_path = public as $$
  select x.lot_id, x.layer, x.holder, x.location_id, lr.on_date, lr.recorded_at, sum(x.q)
    from (select m.lot_id, m.layer, m.holder, m.to_location as location_id, m.quantity as q
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.to_location is not null and r.status = 'done' and r.reversed_at is null
          union all
          select m.lot_id, m.layer, m.holder, m.from_location, -m.quantity
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.from_location is not null and r.status = 'done' and r.reversed_at is null
          union all
          select c.lot_id, c.layer, c.to_folder, c.location, c.approved_quantity
            from stk_cost_moves c
           where c.owner_id = p_owner and c.location is not null and c.status = 'approved' and c.reversed_at is null
          union all
          select c.lot_id, c.layer, c.from_folder, c.location, -c.approved_quantity
            from stk_cost_moves c
           where c.owner_id = p_owner and c.location is not null and c.status = 'approved' and c.reversed_at is null) x
    join stk_lots lt on lt.id = x.lot_id
    join stk_records lr on lr.id = x.layer
   where p_item is null or lt.item_id = p_item
   group by x.lot_id, x.layer, x.holder, x.location_id, lr.on_date, lr.recorded_at
  having sum(x.q) <> 0
$$;

-- A purchase lot's cost and quantity (Q12): the line's item amount less its
-- discount shares plus its delivery-fee shares; the line in item units.
-- Untraced lots: (0, 0).
create or replace function stk_lot_basis(p_lot uuid, out value numeric, out quantity numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(round(l.gross_amount
                        - coalesce((select sum(s.amount) from purchase_charge_shares s
                                      join purchase_charges c on c.id = s.charge_id and c.kind = 'discount'
                                     where s.line_id = l.id), 0)
                        + coalesce((select sum(s.amount) from purchase_charge_shares s
                                      join purchase_charges c on c.id = s.charge_id and c.kind = 'delivery_fee'
                                     where s.line_id = l.id), 0), 2), 0),
         coalesce(stk_conv(l.purchase_id, l.line_no, l.quantity), 0)
    from stk_lots lt
    left join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
   where lt.id = p_lot
$$;

-- Where a purchase's cost sits: its expense rows (lines and delivery fees),
-- summed by billing period, project (no period) and Cover. Every key and sum
-- must stay the same while approved cost moves rely on the purchase (rev 2).
create or replace function stk_purchase_alloc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(x.k, x.amount order by x.k), '{}'::jsonb)
    from (select coalesce(e.project_id::text, '-') || '|' || coalesce(e.folder_id::text, '-') || '|' || e.cover_expense::text as k,
                 round(sum(e.amount), 2) as amount
            from expenses e
           where e.purchase_line_id in (select l.id from purchase_lines l where l.purchase_id = p_purchase)
              or e.purchase_charge_id in (select c.id from purchase_charges c where c.purchase_id = p_purchase)
           group by 1) x
$$;

-- What a holder holds of a lot, in value and quantity: the lot's own holder
-- starts with all of it; approved, unreversed cost moves add and take.
create or replace function stk_held(p_lot uuid, p_holder uuid, out value numeric, out quantity numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(case when lt.cost_folder_id is not distinct from p_holder then b.value else 0 end, 0)
         + coalesce((select sum(c.value) from stk_cost_moves c
                      where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
                        and c.kind <> 'loss' and c.to_folder is not distinct from p_holder), 0)
         - coalesce((select sum(c.value) from stk_cost_moves c
                      where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
                        and c.from_folder is not distinct from p_holder), 0),
         coalesce(case when lt.cost_folder_id is not distinct from p_holder then b.quantity else 0 end, 0)
         + coalesce((select sum(c.approved_quantity) from stk_cost_moves c
                      where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
                        and c.kind <> 'loss' and c.to_folder is not distinct from p_holder), 0)
         - coalesce((select sum(c.approved_quantity) from stk_cost_moves c
                      where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
                        and c.from_folder is not distinct from p_holder), 0)
    from stk_lots lt, stk_lot_basis(p_lot) b
   where lt.id = p_lot
$$;

-- The value of p_qty of a lot leaving a holder (Q12): the line's cost ×
-- qty / the line's quantity, to the centavo — and the LAST of what a holder
-- has takes what it holds, so a line's portions always add up to exactly its
-- cost (₱100 for 3 pieces → ₱33.33 + ₱33.33 + ₱33.34). Never more than the
-- holder holds.
create or replace function stk_cost_value(p_lot uuid, p_holder uuid, p_qty numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  h record;
  b record;
begin
  select * into h from stk_held(p_lot, p_holder);
  if h.quantity is null or h.quantity <= 0 or p_qty > h.quantity then
    raise exception 'COST_BASIS' using errcode = 'P0001',
      hint = 'That holder does not hold this much of the lot''s cost.';
  end if;
  if p_qty = h.quantity then
    return h.value;
  end if;
  select * into b from stk_lot_basis(p_lot);
  return least(h.value, round(b.value * p_qty / b.quantity, 2));
end;
$$;

-- What a pending cost move still covers: its quantity, but never more than
-- the holder still has there after the earlier pending requests on the
-- same goods (Q10 — goods that left before approval are not charged).
create or replace function stk_cost_effective(p_cost uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, least(c.quantity,
           stk_bucket_balance(c.lot_id, c.layer, c.from_folder, c.location)
           - coalesce((select sum(x.quantity) from stk_cost_moves x
                        where x.lot_id = c.lot_id and x.layer = c.layer and x.location = c.location
                          and x.from_folder is not distinct from c.from_folder and x.status = 'pending'
                          and (x.requested_at, x.id) < (c.requested_at, c.id)), 0)))
    from stk_cost_moves c where c.id = p_cost
$$;

-- A project's name for a row: "Main" or "Main — Additional Works job".
create or replace function stk_folder_name(p_folder uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(par.name || ' — ', '') || f.name
                     from folders f left join folders par on par.id = f.parent_folder_id where f.id = p_folder),
                  (select l.folder_name from stk_locations l where l.folder_id = p_folder limit 1), 'a project')
$$;

-- Is a project (or the project its job belongs to) completed?
create or replace function stk_folder_completed(p_folder uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select f.completed_at is not null or par.completed_at is not null
                     from folders f left join folders par on par.id = f.parent_folder_id where f.id = p_folder), false)
$$;

-- ════ 3. Taking goods: oldest received first, then whose cost ════════

-- Take p_qty of an item from a place: oldest received layer first (0104),
-- and within a layer the goods NOT yet the place's own holder first (goods
-- waiting for a cost assignment leave before goods already charged here).
-- Returns [{lot_id, layer, holder, quantity}]. The caller holds the item's lock.
create or replace function stk_take(p_owner uuid, p_item uuid, p_from uuid, p_qty numeric, p_lot uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_home uuid := (select l.folder_id from stk_locations l where l.id = p_from);
  v_left numeric := p_qty;
  v_take numeric;
  v_out jsonb := '[]'::jsonb;
begin
  for v in select b.lot_id, b.layer, b.holder, b.quantity as bal from stk_buckets(p_owner, p_item) b
            where b.location_id = p_from and b.quantity > 0 and (p_lot is null or b.lot_id = p_lot)
            order by b.received_on, b.received_at, b.layer, (b.holder is not distinct from v_home), b.holder
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v.bal);
    v_out := v_out || jsonb_build_object('lot_id', v.lot_id, 'layer', v.layer, 'holder', v.holder, 'quantity', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'NOT_ENOUGH' using errcode = 'P0001',
      hint = 'Only ' || (p_qty - v_left) || ' there.';
  end if;
  return v_out;
end;
$$;

-- Every bucket a record put goods in still holds zero or more (after a reversal).
create or replace function stk_check_record(p_record uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  for v in select distinct m.lot_id, m.layer, m.holder, m.to_location from stk_moves m
            where m.record_id = p_record and m.to_location is not null loop
    if stk_layer_balance(v.lot_id, v.layer, v.to_location) < 0
       or stk_bucket_balance(v.lot_id, v.layer, v.holder, v.to_location) < 0 then
      raise exception 'MOVED_ON' using errcode = 'P0001',
        hint = 'Those goods have moved on. Reverse the later records first.';
    end if;
  end loop;
end;
$$;

-- ════ 4. Asking the main owner ═══════════════════════════════════════

-- After a physical record: a pending cost move for every move row whose goods
-- arrive where someone else holds their cost (see the header, §2).
create or replace function stk_cost_requests(p_record uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_n int := 0;
  v_id uuid;
begin
  for m in select x.id, x.owner_id, x.lot_id, x.layer, x.holder, x.to_location, x.quantity, r.on_date,
                  lt.untraced, lt.cost_folder_id, l.kind as loc_kind, l.folder_id as loc_folder
             from stk_moves x
             join stk_records r on r.id = x.record_id
             join stk_lots lt on lt.id = x.lot_id
             join stk_locations l on l.id = x.to_location
            where x.record_id = p_record and x.from_location is not null and not lt.untraced
            order by x.id
  loop
    v_id := null;
    if m.loc_kind = 'site' and m.holder is distinct from m.loc_folder then
      insert into stk_cost_moves (owner_id, kind, record_id, move_id, lot_id, layer, location, from_folder, to_folder,
                                  quantity, received_on, requested_by)
      values (m.owner_id, case when m.holder is null then 'assign' else 'transfer' end, p_record, m.id, m.lot_id, m.layer,
              m.to_location, m.holder, m.loc_folder, m.quantity, m.on_date, auth.uid())
      returning id into v_id;
    elsif m.loc_kind = 'warehouse' and m.holder is not null and m.cost_folder_id is null then
      insert into stk_cost_moves (owner_id, kind, record_id, move_id, lot_id, layer, location, from_folder, to_folder,
                                  quantity, received_on, requested_by)
      values (m.owner_id, 'back', p_record, m.id, m.lot_id, m.layer, m.to_location, m.holder, null, m.quantity, m.on_date, auth.uid())
      returning id into v_id;
    end if;
    if v_id is not null then
      insert into stk_events (owner_id, kind, record_id, cost_move_id, actor_id)
      values (m.owner_id, 'cost_requested', p_record, v_id, auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- A confirmed loss of company-held goods (a count): their value moves to
-- company stock loss with the confirmation (Q27). No expense row.
create or replace function stk_cost_losses(p_record uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_n int := 0;
  v_value numeric;
  b record;
begin
  for m in select x.id, x.owner_id, x.lot_id, x.layer, x.quantity, r.on_date, lt.purchase_id
             from stk_moves x join stk_records r on r.id = x.record_id join stk_lots lt on lt.id = x.lot_id
            where x.record_id = p_record and x.to_location is null and x.holder is null and not lt.untraced
            order by x.id
  loop
    -- The lot's row: a correction of its purchase at this moment waits (or is seen).
    perform 1 from stk_lots lt where lt.id = m.lot_id for update;
    v_value := stk_cost_value(m.lot_id, null, m.quantity);
    select * into b from stk_lot_basis(m.lot_id);
    insert into stk_cost_moves (owner_id, kind, status, record_id, move_id, lot_id, layer, location, quantity,
                                approved_quantity, value, basis_value, basis_quantity, basis_alloc, received_on,
                                requested_by, decided_by, decided_at)
    values (m.owner_id, 'loss', 'approved', p_record, m.id, m.lot_id, m.layer, null, m.quantity,
            m.quantity, v_value, b.value, b.quantity, stk_purchase_alloc(m.purchase_id), m.on_date, auth.uid(), auth.uid(), now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- The (billing period, folder, Cover) groups carrying a lot's cost for a
-- project: its purchase line rows, its share of the delivery-fee rows (when
-- the lot is that project's own purchase), and every approved cost-move row
-- of the lot in that project. Amount = what each group still carries.
create or replace function stk_cost_carriers(p_lot uuid, p_holder uuid)
returns table (project_id uuid, folder_id uuid, cover boolean, amount numeric)
language sql stable security definer set search_path = public as $$
  select g.project_id, g.folder_id, g.cover, sum(g.amt)
    from (
      -- the lot's own purchase line rows
      select e.project_id, e.folder_id, e.cover_expense as cover, e.amount as amt
        from stk_lots lt
        join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
        join expenses e on e.purchase_line_id = l.id
       where lt.id = p_lot and lt.cost_folder_id = p_holder
      union all
      -- its share of each delivery-fee row of its project
      select e.project_id, e.folder_id, e.cover_expense, e.amount * s.amount / t.total
        from stk_lots lt
        join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
        join purchase_charge_shares s on s.line_id = l.id
        join purchase_charges c on c.id = s.charge_id and c.kind = 'delivery_fee'
        join (select sh.charge_id, sum(sh.amount) as total
                from purchase_charge_shares sh join purchase_lines l2 on l2.id = sh.line_id
               where l2.folder_id = p_holder group by sh.charge_id) t on t.charge_id = c.id and t.total > 0
        join expenses e on e.purchase_charge_id = c.id
        left join projects pp on pp.id = e.project_id
       where lt.id = p_lot and lt.cost_folder_id = p_holder and coalesce(e.folder_id, pp.folder_id) = p_holder
      union all
      -- earlier cost moves of this lot, in and out of this project
      select e.project_id, e.folder_id, e.cover_expense, e.amount
        from stk_cost_moves c
        join expenses e on e.stk_cost_move_id = c.id
        left join projects pp on pp.id = e.project_id
       where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
         and coalesce(e.folder_id, pp.folder_id) = p_holder) g
   group by g.project_id, g.folder_id, g.cover
$$;

-- Write an approved cost move's expense rows (header, §4). The caller holds
-- the projects' locks and sets dacs.purchase_write.
create or replace function stk_cost_rows(p_cost uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c stk_cost_moves;
  v_item text;
  v_cat text;
  v_label text;
  v_split record;
  v_splits jsonb;
  v_n int;
  v_k int;
  v_groups record;
  v_g jsonb;
  v_weights numeric[] := '{}';
  v_keys jsonb := '[]'::jsonb;
  v_shares numeric[];
  v_carried numeric := 0;
  v_rows jsonb := '[]'::jsonb;
  i int;
begin
  select * into c from stk_cost_moves where id = p_cost;
  select ci.name, coalesce(nullif(l.category, ''), 'Materials') into v_item, v_cat
    from stk_lots lt join pr_catalog_items ci on ci.id = lt.item_id
    left join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
   where lt.id = c.lot_id;
  -- Into the receiving project, funded like a purchase for the month it received the goods.
  if c.to_folder is not null and c.value > 0 then
    v_label := case when c.kind = 'assign' then 'From warehouse — ' else 'Moved from ' || stk_folder_name(c.from_folder) || ' — ' end || v_item;
    select coalesce(jsonb_agg(jsonb_build_object('period_id', f.period_id, 'amount', f.amount, 'cover', f.cover) order by f.n), '[]'::jsonb)
      into v_splits
      from pur_fund(c.owner_id, c.to_folder, c.received_on, c.value) with ordinality f(period_id, amount, cover, review, n);
    v_n := jsonb_array_length(v_splits);
    v_k := 0;
    for v_split in select * from jsonb_to_recordset(v_splits) as x(period_id uuid, amount numeric, cover boolean) loop
      v_k := v_k + 1;
      insert into expenses (owner_id, project_id, folder_id, expense_name, category, quantity, amount, date_time, notes,
                            payment_method, cover_expense, split_group, split_index, split_total, stk_cost_move_id)
      values (c.owner_id, v_split.period_id, case when v_split.period_id is null then c.to_folder end,
              v_label || case when v_n > 1 then ' (' || v_k || '/' || v_n || ')' else '' end, v_cat,
              case when v_n > 1 then 1 else c.approved_quantity end, v_split.amount, c.received_on::text,
              'Stock cost move approved by the owner', '', v_split.cover,
              case when v_n > 1 then 'stkcost:' || c.id || ':in' end, case when v_n > 1 then v_k end,
              case when v_n > 1 then v_n end, c.id);
      v_rows := v_rows || jsonb_build_object('side', 'in', 'period_id', v_split.period_id, 'amount', v_split.amount, 'cover', v_split.cover);
    end loop;
  end if;
  -- Out of the giving project, from every group that carried this lot's cost, in proportion.
  if c.from_folder is not null and c.value > 0 then
    v_label := case when c.kind = 'back' then 'Back to company stock — ' else 'Moved to ' || stk_folder_name(c.to_folder) || ' — ' end || v_item;
    for v_groups in select * from stk_cost_carriers(c.lot_id, c.from_folder) g where g.amount > 0
                     order by g.amount desc, g.project_id nulls last, g.cover loop
      v_weights := v_weights || v_groups.amount;
      v_carried := v_carried + v_groups.amount;
      v_keys := v_keys || jsonb_build_object('project_id', v_groups.project_id, 'folder_id', v_groups.folder_id, 'cover', v_groups.cover);
    end loop;
    if v_carried + 0.01 < c.value then
      raise exception 'COST_BASIS' using errcode = 'P0001',
        hint = 'The giving project carries less of this lot''s cost than the move.';
    end if;
    v_shares := pur_prorate(c.value, v_weights);
    v_n := coalesce(array_length(v_shares, 1), 0);
    for i in 1 .. v_n loop
      continue when v_shares[i] <= 0;
      v_g := v_keys -> (i - 1);
      insert into expenses (owner_id, project_id, folder_id, expense_name, category, quantity, amount, date_time, notes,
                            payment_method, cover_expense, split_group, split_index, split_total, stk_cost_move_id)
      values (c.owner_id, (v_g ->> 'project_id')::uuid, (v_g ->> 'folder_id')::uuid,
              v_label || case when v_n > 1 then ' (' || i || '/' || v_n || ')' else '' end, v_cat,
              case when v_n > 1 then 1 else c.approved_quantity end, -v_shares[i], c.received_on::text,
              'Stock cost move approved by the owner', '', (v_g ->> 'cover')::boolean,
              case when v_n > 1 then 'stkcost:' || c.id || ':out' end, case when v_n > 1 then i end,
              case when v_n > 1 then v_n end, c.id);
      v_rows := v_rows || jsonb_build_object('side', 'out', 'period_id', v_g ->> 'project_id', 'amount', -v_shares[i],
                                             'cover', (v_g ->> 'cover')::boolean);
    end loop;
  end if;
  return v_rows;
end;
$$;

-- ════ 5. 0104's operations, now cost-aware ═══════════════════════════

-- 0104's stk_move: every move row carries the holder of its goods; a return
-- takes the issue's goods as their cost now stands; afterwards the main
-- owner is asked wherever goods arrive in someone else's cost (§2).
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
  v_h record;
  v_can numeric;
  v_take numeric;
  v_first uuid;
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
    -- what this issue moved and has not had back, and to what is still there
    -- — taken as their cost now stands: the site's own first when the issue's
    -- cost assignment was approved, else the goods still waiting for it (2C).
    v_takes := '[]'::jsonb;
    v_left := v_qty;
    for v_m in select m.lot_id, m.layer, sum(m.quantity) as qty, max(m.id) as last_id, (array_agg(m.holder order by m.id))[1] as holder,
                      bool_or(exists (select 1 from stk_cost_moves c where c.move_id = m.id and c.status = 'approved'
                                         and c.reversed_at is null)) as assigned
                 from stk_moves m
                where m.record_id = v_issue.id and (v_lot is null or m.lot_id = v_lot)
                group by m.lot_id, m.layer order by max(m.id) desc
    loop
      exit when v_left <= 0;
      v_can := v_m.qty - coalesce((select sum(x.quantity) from stk_moves x join stk_records r on r.id = x.record_id
                                    where r.returns_record = v_issue.id and r.status = 'done' and r.reversed_at is null
                                      and x.lot_id = v_m.lot_id and x.layer = v_m.layer), 0);
      v_can := least(v_can, stk_layer_balance(v_m.lot_id, v_m.layer, v_from));
      continue when v_can <= 0;
      v_first := case when v_m.assigned then (select l.folder_id from stk_locations l where l.id = v_from) else v_m.holder end;
      for v_h in select b.holder, b.quantity from stk_buckets(v_owner, v_item) b
                  where b.lot_id = v_m.lot_id and b.layer = v_m.layer and b.location_id = v_from and b.quantity > 0
                  order by (b.holder is not distinct from v_first) desc, b.holder
      loop
        exit when v_can <= 0 or v_left <= 0;
        v_take := least(v_can, v_left, v_h.quantity);
        v_takes := v_takes || jsonb_build_object('lot_id', v_m.lot_id, 'layer', v_m.layer, 'holder', v_h.holder, 'quantity', v_take);
        v_can := v_can - v_take;
        v_left := v_left - v_take;
      end loop;
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
    insert into stk_moves (owner_id, record_id, lot_id, layer, holder, from_location, to_location, quantity)
    values (v_owner, v_id, (v_t ->> 'lot_id')::uuid, (v_t ->> 'layer')::uuid, (v_t ->> 'holder')::uuid, v_from, v_to,
            (v_t ->> 'quantity')::numeric);
  end loop;
  -- 2C: goods now held by someone else's cost ask the main owner.
  perform stk_cost_requests(v_id);
  if v_req is not null then
    perform stk_cover(v_owner, v_id, v_to_loc.folder_id, v_req, v_item, v_qty, p_body -> 'portion_picks');
  end if;
  v_result := jsonb_build_object('record_id', v_id, 'kind', v_kind, 'lots', v_takes,
                                 'cost_moves', (select coalesce(jsonb_agg(c.id order by c.requested_at, c.id), '[]'::jsonb)
                                                  from stk_cost_moves c where c.record_id = v_id));
  return pur_op_done(v_owner, p_op, 'stk_move', v_result);
end;
$$;
-- 0104's stk_decide: a loss carries the holder of the goods lost, and a loss
-- of company-held goods moves their value to company stock loss (Q27).
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
        insert into stk_moves (owner_id, record_id, lot_id, layer, holder, from_location, quantity)
        values (v_owner, r.id, (v_t ->> 'lot_id')::uuid, (v_t ->> 'layer')::uuid, (v_t ->> 'holder')::uuid, r.to_location,
                (v_t ->> 'quantity')::numeric);
      end loop;
      -- 2C (Q27): company-held goods lost → their value to company stock loss.
      perform stk_cost_losses(r.id);
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
-- 0104's stk_reverse: refused while an approved cost move rides on the record
-- (the main owner reverses that first, Q23); its pending ones are withdrawn;
-- a count's loss value comes back with it.
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
  -- 2C: an approved cost move rides on this record — the main owner reverses it first.
  if exists (select 1 from stk_cost_moves c where c.record_id = r.id and c.kind <> 'loss'
                and c.status = 'approved' and c.reversed_at is null) then
    raise exception 'COST_MOVED' using errcode = 'P0001',
      hint = 'The main owner approved this movement''s cost. Reverse that cost move first (Purchasing → Owner approvals).';
  end if;
  update stk_cost_moves set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(),
                            decision_note = 'The movement was reversed: ' || v_reason
   where record_id = r.id and status = 'pending';
  -- A count's loss value comes back with it.
  update stk_cost_moves set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason
   where record_id = r.id and kind = 'loss' and status = 'approved' and reversed_at is null;
  update stk_records set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason where id = r.id;
  -- What the record put somewhere must still be there (a receipt's layer
  -- included: refused once any of that delivery has moved on).
  perform stk_check_record(r.id);
  insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'reversed', r.id, v_reason, auth.uid());
  v_result := jsonb_build_object('record_id', r.id, 'reversed', true);
  return pur_op_done(v_owner, p_op, 'stk_reverse', v_result);
end;
$$;
-- ════ 6. The main owner decides ════════════════════════════════════

-- Approve or reject a pending cost move (Q18–Q20). Approve: whole, for what
-- is still there; refused into or out of a completed project (Q16). Reject:
-- a reason; the goods stay recorded, the cost stays with its holder (Q19).
create or replace function stk_cost_decide(p_op uuid, p_cost uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  c stk_cost_moves;
  v_item uuid;
  v_purchase uuid;
  v_eff numeric;
  v_value numeric;
  b record;
  v_rows jsonb;
  v_result jsonb;
begin
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
  select * into c from stk_cost_moves where id = p_cost and owner_id = v_owner;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select lt.item_id, lt.purchase_id into v_item, v_purchase from stk_lots lt where lt.id = c.lot_id;
  -- The purchase first (as every purchase write does), so its price cannot change under us.
  if v_purchase is not null then
    perform pur_purchase_lock(v_purchase);
  end if;
  perform stk_lock_items(array[v_item], array_remove(array['pur_folder:' || c.from_folder, 'pur_folder:' || c.to_folder], null));
  select * into c from stk_cost_moves where id = p_cost for update;
  if c.status <> 'pending' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not p_approve then
    update stk_cost_moves set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = pur_reason(p_note)
     where id = c.id;
    insert into stk_events (owner_id, kind, record_id, cost_move_id, reason, actor_id)
    values (v_owner, 'cost_rejected', c.record_id, c.id, pur_reason(p_note), auth.uid());
    return pur_op_done(v_owner, p_op, 'stk_cost_decide', jsonb_build_object('cost_move_id', c.id, 'status', 'rejected'));
  end if;
  if (c.from_folder is not null and stk_folder_completed(c.from_folder))
     or (c.to_folder is not null and stk_folder_completed(c.to_folder)) then
    raise exception 'COMPLETED_PROJECT' using errcode = 'P0001',
      hint = 'Reopen the project first; the goods'' record stays as it is.';
  end if;
  v_eff := stk_cost_effective(c.id);
  if v_eff <= 0 then
    raise exception 'NOTHING_LEFT' using errcode = 'P0001',
      hint = 'These goods are no longer there. Reject it with a reason.';
  end if;
  v_value := stk_cost_value(c.lot_id, c.from_folder, v_eff);
  select * into b from stk_lot_basis(c.lot_id);
  update stk_cost_moves set status = 'approved', approved_quantity = v_eff, value = v_value,
                            basis_value = b.value, basis_quantity = b.quantity, basis_alloc = stk_purchase_alloc(v_purchase),
                            decided_by = auth.uid(), decided_at = now(), decision_note = pur_note(p_note, 500)
   where id = c.id;
  perform set_config('dacs.purchase_write', 'on', true);
  v_rows := stk_cost_rows(c.id);
  perform set_config('dacs.purchase_write', '', true);
  insert into stk_events (owner_id, kind, record_id, cost_move_id, detail, reason, actor_id)
  values (v_owner, 'cost_approved', c.record_id, c.id, jsonb_build_object('quantity', v_eff, 'value', v_value),
          pur_note(p_note, 500), auth.uid());
  v_result := jsonb_build_object('cost_move_id', c.id, 'status', 'approved', 'quantity', v_eff, 'value', v_value, 'rows', v_rows);
  return pur_op_done(v_owner, p_op, 'stk_cost_decide', v_result);
end;
$$;

-- Reverse an approved cost move (Q23): its rows leave Spent, the record and
-- its reason stay. Refused while later approved moves depend on what it
-- moved (reverse those first). A loss is reversed with its count instead.
create or replace function stk_cost_reverse(p_op uuid, p_cost uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  c stk_cost_moves;
  v_item uuid;
  v_purchase uuid;
  v_reason text := pur_reason(p_reason);
  h record;
  v_result jsonb;
begin
  if not stk_on(v_owner) then
    raise exception 'STOCK_OFF' using errcode = 'P0001';
  end if;
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into c from stk_cost_moves where id = p_cost and owner_id = v_owner;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select lt.item_id, lt.purchase_id into v_item, v_purchase from stk_lots lt where lt.id = c.lot_id;
  -- The purchase first (as every purchase write does), so its price cannot change under us.
  if v_purchase is not null then
    perform pur_purchase_lock(v_purchase);
  end if;
  perform stk_lock_items(array[v_item], array_remove(array['pur_folder:' || c.from_folder, 'pur_folder:' || c.to_folder], null));
  select * into c from stk_cost_moves where id = p_cost for update;
  if c.status <> 'approved' or c.reversed_at is not null or c.kind = 'loss' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update stk_cost_moves set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason where id = c.id;
  -- Nothing may depend on it: what it gave the receiver is still the receiver's, there.
  select * into h from stk_held(c.lot_id, c.to_folder);
  if h.quantity < 0 or h.value < 0 or stk_bucket_balance(c.lot_id, c.layer, c.to_folder, c.location) < 0 then
    raise exception 'LATER_MOVES_FIRST' using errcode = 'P0001',
      hint = 'Later movements or cost moves rely on this one. Reverse those first.';
  end if;
  perform set_config('dacs.purchase_write', 'on', true);
  delete from expenses where stk_cost_move_id = c.id;
  perform set_config('dacs.purchase_write', '', true);
  insert into stk_events (owner_id, kind, record_id, cost_move_id, reason, actor_id)
  values (v_owner, 'cost_reversed', c.record_id, c.id, v_reason, auth.uid());
  v_result := jsonb_build_object('cost_move_id', c.id, 'reversed', true);
  return pur_op_done(v_owner, p_op, 'stk_cost_reverse', v_result);
end;
$$;

-- After a rejection — or after the main owner reversed an approved cost move
-- (say, to fix the purchase's price) — a stock recorder asks again for the
-- same movement: no second physical record (Q19), with a note (the evidence).
create or replace function stk_cost_resubmit(p_op uuid, p_cost uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  c stk_cost_moves;
  v_item uuid;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into c from stk_cost_moves where id = p_cost and owner_id = v_owner;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select lt.item_id into v_item from stk_lots lt where lt.id = c.lot_id;
  perform stk_lock_items(array[v_item]);
  select * into c from stk_cost_moves where id = p_cost for update;
  if not (c.status = 'rejected' or (c.status = 'approved' and c.reversed_at is not null and c.kind <> 'loss'))
     or exists (select 1 from stk_cost_moves x where x.move_id = c.move_id and x.status in ('pending', 'approved')
                   and x.reversed_at is null)
     or exists (select 1 from stk_records r where r.id = c.record_id and (r.status <> 'done' or r.reversed_at is not null)) then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  insert into stk_cost_moves (owner_id, kind, record_id, move_id, lot_id, layer, location, from_folder, to_folder,
                              quantity, received_on, resubmits, note, requested_by)
  values (c.owner_id, c.kind, c.record_id, c.move_id, c.lot_id, c.layer, c.location, c.from_folder, c.to_folder,
          c.quantity, c.received_on, c.id, pur_reason(p_note), auth.uid())
  returning id into v_id;
  insert into stk_events (owner_id, kind, record_id, cost_move_id, reason, actor_id)
  values (v_owner, 'cost_resubmitted', c.record_id, v_id, pur_reason(p_note), auth.uid());
  v_result := jsonb_build_object('cost_move_id', v_id, 'status', 'pending');
  return pur_op_done(v_owner, p_op, 'stk_cost_resubmit', v_result);
end;
$$;

-- ════ 7. Guards ═════════════════════════════════════════════════════

-- Q21: a purchase line's price or quantity cannot change while approved
-- cost moves value its lot (reverse those first) — nor, rev 2, can where the
-- purchase's cost sits: its rows' billing periods and Cover (R81). Checked
-- when a purchase's correction, unit check or re-funding (an approved change
-- request is a correction) is written to its history — after every line,
-- share and row is stored again — so every 2A path is covered.
create or replace function stk_guard_cost_basis() returns trigger
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if new.kind not in ('corrected', 'unit_checked', 'refunded') then
    return null;
  end if;
  -- The lots' rows: a count's loss being confirmed at this moment waits (or is seen).
  perform 1 from stk_lots lt where lt.purchase_id = new.purchase_id order by lt.id for update;
  for v in select lt.id as lot_id, (select b.value from stk_lot_basis(lt.id) b) as v_now,
                  (select b.quantity from stk_lot_basis(lt.id) b) as q_now
             from stk_lots lt where lt.purchase_id = new.purchase_id
  loop
    if exists (select 1 from stk_cost_moves c where c.lot_id = v.lot_id and c.status = 'approved' and c.reversed_at is null
                  and (c.basis_value is distinct from v.v_now or c.basis_quantity is distinct from v.q_now)) then
      raise exception 'STOCK_COST_IN_USE' using errcode = 'P0001',
        hint = 'The owner approved cost moves valued at this line''s price and quantity. Reverse them first.';
    end if;
  end loop;
  if exists (select 1 from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id
              where lt.purchase_id = new.purchase_id and c.status = 'approved' and c.reversed_at is null
                and c.basis_alloc is distinct from stk_purchase_alloc(new.purchase_id)) then
    raise exception 'STOCK_COST_FUNDING' using errcode = 'P0001',
      hint = 'The owner approved stock cost moves that rely on where this purchase''s cost sits — its billing periods and Cover. Reverse them first.';
  end if;
  return null;
end;
$$;
drop trigger if exists stk_guard_cost_basis on purchase_history;
create trigger stk_guard_cost_basis after insert on purchase_history
  for each row execute function stk_guard_cost_basis();
-- 0096's guard on expense rows, extended to cost-move rows: only the stock
-- functions write, change or remove them.
create or replace function pur_guard_expense_row() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('dacs.purchase_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  -- 2C: a stock cost move's rows — the main owner reverses the cost move instead.
  if tg_op in ('UPDATE', 'DELETE') and old.stk_cost_move_id is not null then
    raise exception 'STOCK_COST_ROW' using errcode = 'P0001',
      hint = 'This expense is a stock cost move the owner approved. The main owner reverses the cost move instead.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.stk_cost_move_id is not null then
    raise exception 'STOCK_COST_ROW' using errcode = 'P0001';
  end if;
  if tg_op in ('UPDATE', 'DELETE')
     and (old.purchase_line_id is not null or old.purchase_charge_id is not null or old.folder_id is not null) then
    raise exception 'PURCHASE_ROW' using errcode = 'P0001',
      hint = 'This expense comes from a purchase. Correct or void the purchase instead.';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and (new.purchase_line_id is not null or new.purchase_charge_id is not null or new.folder_id is not null) then
    raise exception 'PURCHASE_ROW' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
-- 0096's delete guard, extended: a project with stock or stock cost moves,
-- or a billing period carrying cost-move rows, is never deleted.
create or replace function pur_guard_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'folders' then
    if exists (select 1 from purchase_lines l join purchases pu on pu.id = l.purchase_id
                where l.folder_id = old.id and pu.status = 'recorded') then
      raise exception 'PURCHASES_LIVE' using errcode = 'P0001',
        hint = 'This project has purchases. Void them first, or mark the project completed.';
    end if;
    -- 2C: goods recorded at its site, or a cost move to or from it.
    if exists (select 1 from stk_locations sl join stk_moves m on m.from_location = sl.id or m.to_location = sl.id
                 join stk_records r on r.id = m.record_id
                where sl.folder_id = old.id and r.status = 'done' and r.reversed_at is null)
       or exists (select 1 from stk_cost_moves c where (c.from_folder = old.id or c.to_folder = old.id)
                     and (c.status = 'pending' or (c.status = 'approved' and c.reversed_at is null))) then
      raise exception 'STOCK_LIVE' using errcode = 'P0001',
        hint = 'This project has stock records or stock cost moves. Mark it completed instead.';
    end if;
  elsif exists (select 1 from expenses e
                 where e.project_id = old.id and (e.purchase_line_id is not null or e.purchase_charge_id is not null)) then
    raise exception 'PURCHASES_LIVE' using errcode = 'P0001',
      hint = 'This billing period has purchases. Void them first.';
  elsif exists (select 1 from expenses e where e.project_id = old.id and e.stk_cost_move_id is not null) then
    raise exception 'STOCK_LIVE' using errcode = 'P0001',
      hint = 'This billing period carries stock cost moves. The owner reverses them first.';
  end if;
  return old;
end;
$$;
-- ════ 8. Reading ═════════════════════════════════════════════════════

-- One cost move as the screens show it. Values only for owner accounts (Q28).
create or replace function stk_cost_json(p_cost uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'status', c.status, 'record_id', c.record_id, 'move_id', c.move_id, 'lot_id', c.lot_id,
    'quantity', c.quantity, 'approved_quantity', c.approved_quantity,
    'effective', case when c.status = 'pending' then stk_cost_effective(c.id) end,
    'from_folder', c.from_folder, 'to_folder', c.to_folder,
    'from_name', case when c.from_folder is null then 'Company stock' else stk_folder_name(c.from_folder) end,
    'to_name', case when c.kind = 'loss' then 'Company stock loss' when c.to_folder is null then 'Company stock'
                    else stk_folder_name(c.to_folder) end,
    'received_on', c.received_on, 'note', c.note, 'resubmits', c.resubmits,
    'requested_at', c.requested_at, 'requested_by_name', pur_person_name(c.requested_by),
    'decided_at', c.decided_at, 'decided_by_name', case when c.decided_by is null then null else pur_person_name(c.decided_by) end,
    'decision_note', c.decision_note, 'reversed', c.reversed_at is not null, 'reverse_reason', c.reverse_reason)
    -- Pesos: owner accounts only — for anyone else the keys are not there at all.
    || case when coalesce(is_owner(), false) then jsonb_build_object(
         'value', c.value,
         -- what approving now would charge (the same rule as the approval)
         'estimate', case when c.status = 'pending' and stk_cost_effective(c.id) > 0
                          then stk_cost_value(c.lot_id, c.from_folder, stk_cost_effective(c.id)) end)
       else '{}'::jsonb end
  from stk_cost_moves c where c.id = p_cost
$$;

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
    'lots', (select coalesce(jsonb_agg(jsonb_build_object('lot_id', m.lot_id, 'layer', m.layer, 'holder', m.holder,
                                                           'quantity', m.quantity) order by m.id), '[]'::jsonb)
               from stk_moves m where m.record_id = r.id),
    -- 2C: its cost moves — states for everyone who reads stock, values for owner accounts only (Q28).
    'costs', (select coalesce(jsonb_agg(stk_cost_json(c.id) order by c.requested_at, c.id), '[]'::jsonb)
                from stk_cost_moves c where c.record_id = r.id))
  from stk_records r
  left join pr_catalog_items c on c.id = r.item_id
  left join purchase_lines l on l.purchase_id = r.purchase_id and l.line_no = r.line_no
  left join pr_lines rl on rl.id = r.request_line_id
  where r.id = p_record
$$;

-- The main owner's Owner approvals cards (Q18): every pending cost move, with
-- what it would cost each side — the receiving month, and the giving
-- project's billing periods it comes off — and its evidence.
create or replace function stk_cost_pending() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  -- Stock off: nothing can be decided, so nothing is shown (the tab still opens).
  if not stk_on(v_owner) then
    return '[]'::jsonb;
  end if;
  return (select coalesce(jsonb_agg(stk_cost_json(c.id) || jsonb_build_object(
            'item_name', ci.name, 'item_unit', ci.unit, 'kind_record', r.kind, 'record_on', r.on_date, 'record_note', r.note,
            'record_by_name', pur_person_name(r.recorded_by), 'place_name', stk_place_name(c.location),
            'from_groups', case when c.from_folder is null then '[]'::jsonb else
              (select coalesce(jsonb_agg(jsonb_build_object('project_id', g.project_id, 'cover', g.cover, 'carries', round(g.amount, 2),
                                                            'month', p.month, 'year', p.year, 'billing_number', p.billing_number)
                                         order by p.year, p.billing_number), '[]'::jsonb)
                 from stk_cost_carriers(c.lot_id, c.from_folder) g left join projects p on p.id = g.project_id
                where g.amount > 0) end,
            'completed', (c.from_folder is not null and stk_folder_completed(c.from_folder))
                         or (c.to_folder is not null and stk_folder_completed(c.to_folder)))
          order by c.requested_at, c.id), '[]'::jsonb)
            from stk_cost_moves c
            join stk_records r on r.id = c.record_id
            join stk_lots lt on lt.id = c.lot_id
            join pr_catalog_items ci on ci.id = lt.item_id
           where c.owner_id = v_owner and c.status = 'pending');
end;
$$;

-- Company stock (Q17), by item, for owner accounts: in the warehouse; issued
-- to a project with the cost assignment pending (still company cost);
-- awaiting delivery (bought, not yet received); and company stock loss.
-- Never in any project's Spent, never in G&A.
create or replace function stk_company_stock() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  if not coalesce(is_owner(), false) then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(x.doc order by x.name), '[]'::jsonb) from (
    select ci.name, jsonb_build_object('item_id', ci.id, 'name', ci.name, 'spec', ci.spec, 'unit', ci.unit,
             'in_warehouse', jsonb_build_object('quantity', sum(v.wh_q), 'value', sum(v.wh_v)),
             'issued_pending', jsonb_build_object('quantity', sum(v.site_q), 'value', sum(v.site_v)),
             'awaiting', jsonb_build_object('quantity', sum(v.away_q), 'value', sum(v.away_v)),
             'loss', jsonb_build_object('quantity', sum(v.loss_q), 'value', sum(v.loss_v)),
             'total_value', sum(v.wh_v + v.site_v + v.away_v)) as doc
      from (
        select lt.item_id, q.wh, q.site,
               q.wh as wh_q, round(h.value * q.wh / nullif(h.quantity, 0), 2) as wh_v,
               q.site as site_q, round(h.value * q.site / nullif(h.quantity, 0), 2) as site_v,
               h.quantity - q.wh - q.site as away_q,
               h.value - coalesce(round(h.value * q.wh / nullif(h.quantity, 0), 2), 0)
                       - coalesce(round(h.value * q.site / nullif(h.quantity, 0), 2), 0) as away_v,
               coalesce((select sum(c.approved_quantity) from stk_cost_moves c where c.lot_id = lt.id and c.kind = 'loss'
                           and c.status = 'approved' and c.reversed_at is null), 0) as loss_q,
               coalesce((select sum(c.value) from stk_cost_moves c where c.lot_id = lt.id and c.kind = 'loss'
                           and c.status = 'approved' and c.reversed_at is null), 0) as loss_v
          from stk_lots lt
          cross join lateral stk_held(lt.id, null) h
          cross join lateral (select coalesce(sum(b.quantity) filter (where l.kind = 'warehouse'), 0) as wh,
                                     coalesce(sum(b.quantity) filter (where l.kind = 'site'), 0) as site
                                from stk_buckets(v_owner, lt.item_id) b join stk_locations l on l.id = b.location_id
                               where b.lot_id = lt.id and b.holder is null) q
         where lt.owner_id = v_owner and not lt.untraced and lt.cost_folder_id is null
           and (h.quantity > 0 or q.wh > 0 or q.site > 0)) v
      join pr_catalog_items ci on ci.id = v.item_id
     group by ci.id, ci.name, ci.spec, ci.unit) x);
end;
$$;

-- ════ 9. Who may call what ═══════════════════════════════════════════

revoke all on function stk_cost_decide(uuid, uuid, boolean, text) from public, anon;
grant execute on function stk_cost_decide(uuid, uuid, boolean, text) to authenticated;
revoke all on function stk_cost_reverse(uuid, uuid, text) from public, anon;
grant execute on function stk_cost_reverse(uuid, uuid, text) to authenticated;
revoke all on function stk_cost_resubmit(uuid, uuid, text) from public, anon;
grant execute on function stk_cost_resubmit(uuid, uuid, text) to authenticated;
revoke all on function stk_cost_pending() from public, anon;
grant execute on function stk_cost_pending() to authenticated;
revoke all on function stk_company_stock() from public, anon;
grant execute on function stk_company_stock() to authenticated;
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function stk_move(uuid, jsonb) from public, anon;
grant execute on function stk_move(uuid, jsonb) to authenticated;
revoke all on function stk_decide(uuid, uuid, boolean, text) from public, anon;
grant execute on function stk_decide(uuid, uuid, boolean, text) to authenticated;
revoke all on function stk_reverse(uuid, uuid, text) from public, anon;
grant execute on function stk_reverse(uuid, uuid, text) to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function stk_moves_holder() from public, anon, authenticated;
revoke all on function stk_bucket_balance(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function stk_buckets(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_lot_basis(uuid) from public, anon, authenticated;
revoke all on function stk_purchase_alloc(uuid) from public, anon, authenticated;
revoke all on function stk_held(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_cost_value(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function stk_cost_effective(uuid) from public, anon, authenticated;
revoke all on function stk_folder_name(uuid) from public, anon, authenticated;
revoke all on function stk_folder_completed(uuid) from public, anon, authenticated;
revoke all on function stk_take(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function stk_check_record(uuid) from public, anon, authenticated;
revoke all on function stk_cost_requests(uuid) from public, anon, authenticated;
revoke all on function stk_cost_losses(uuid) from public, anon, authenticated;
revoke all on function stk_cost_carriers(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_cost_rows(uuid) from public, anon, authenticated;
revoke all on function stk_cost_json(uuid) from public, anon, authenticated;
revoke all on function stk_record_json(uuid) from public, anon, authenticated;
revoke all on function stk_guard_cost_basis() from public, anon, authenticated;
revoke all on function pur_guard_expense_row() from public, anon, authenticated;
revoke all on function pur_guard_delete() from public, anon, authenticated;
```

**Modify:** `supabase/migrations/README.md` — apply with `git apply --ignore-whitespace`

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
index 2aedee6..96e389c 100644
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0105** — highest on disk is
-  `0104_stock.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0106** — highest on disk is
+  `0105_stock_cost_moves.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -194,6 +194,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0104 (WorkMate Stage 2B-a — stock, quantities only; OUTSIDE the money model)** adds eight private tables (RLS on, no policies — reads and writes only through its functions): `stk_settings` (the company's stock switch, set by the main owner only; every write is refused `STOCK_OFF` until launch), `stk_locations` (one warehouse per company and one site per Project Control folder, made on first use), `stk_matches` (how a purchase line counts as a catalogue item: `per` line units = `covers` item units — automatic for a request-linked line whose catalogue item has the same unit, otherwise the office's check, never by whoever recorded or bought it for another unit), `stk_lots` (the goods of one purchase line, or untraced old goods; `cost_folder_id` = whose cost they are — null = company stock, a project = its leftovers), `stk_records` (one action: receive, not delivered, leftover, issue, return, move, count, opening; never edited — reversed or withdrawn with a reason), `stk_moves` (its quantity per lot and **layer** — each delivery received, leftover, opening or found count is a layer dated the day it entered stock, and issues, moves and losses take the oldest received first), `stk_covers` (what goods entering a project filled on a request line) and the append-only `stk_events`. Redefines `pr_portion_bought` / `pr_line_bought` as COVERED (recorded purchases + live stock records — every Still to buy follows), adds `pr_portion_purchased` / `pr_line_purchased` / `*_from_stock`, and redefines `pur_shopping_list` (`bought` = purchases, plus `from_stock`, `in_warehouse`) and `pur_purchase_view`. Triggers: a purchase line may not undo its stock (`STOCK_IN_USE`: destination, project, unit, and quantity below what was received / entered), a purchase with stock records cannot be voided or replaced, once stock is on the old `inventory` table — the "Add to inventory" tick — refuses writes (`STOCK_TICK_RETIRED`), and a catalogue item's kind and unit never change once a request **or stock** uses it (`ITEM_IN_USE`; 0092's `pr_office_save_item` / `pr_office_catalog` extended through `pr_item_in_use`). Counts that differ and opening stock wait for the main owner (`stk_decide`). Every write takes an operation id (`pur_ops`). **Writes and reads no peso amount and no `expenses` / `payroll` row** — the value of stock and every cost move are Stage 2C. Requires 0098 (main owner) and 0102 (helpers). Prove with `npm run test:sql` (`2b_stock.pglite.mjs`, `2b_concurrency.mjs`, and the 2A-1 suite re-run `--with-0104` with stock off, the 2A-2 / 2A-3 / 2A-4 suites with stock on) and `node tests/stock-admin.test.js`; live: `supabase/tests/2b_acceptance.sql` (self-wrapped, rolls back).
 
+**0105 (WorkMate Stage 2C — owner-confirmed stock cost moves; INSIDE the money model, through ordinary expense rows)** adds `stk_moves.holder` (whose cost the moved goods are: a project folder, or null = the company; goods entering stock take their lot's own holder through the `stk_moves_holder` trigger, so 0104's inflow paths are unchanged), the private table `stk_cost_moves` (RLS on, no policies: kind `assign` company → project / `transfer` project → project / `back` project → company / `loss` company stock → company stock loss; status `pending` / `approved` / `rejected` / `withdrawn`; the approved quantity and value, the lot's price and quantity it was valued at, the reversal and its reason), `expenses.stk_cost_move_id`, and `stk_events.cost_move_id` with six `cost_*` kinds. After every physical move the server opens a **pending** cost move wherever goods arrive in someone else's cost (`stk_cost_requests`); until the **main owner** approves (`stk_cost_decide`), the cost stays where it was, and a pending one covers only what is still there (`stk_cost_effective`). Approval values the goods by lot (item amount − discount shares + delivery-fee shares; the last portion takes what is left — `stk_held`, `stk_cost_value`) and writes expense rows (`stk_cost_rows`): the receiving project funded like a purchase (`pur_fund`, the month it received the goods), the giving project negative rows on every billing period / Cover group that carried the lot's cost, in proportion (`stk_cost_carriers`, `pur_prorate`). Company stock is never in a project's Spent; a confirmed loss of company goods moves their value to company stock loss with the count (no expense row). Redefines from 0104 `stk_take` (returns the holder; goods not yet the place's own leave first), `stk_check_record`, `stk_move`, `stk_decide`, `stk_reverse` (refused `COST_MOVED` while an approved cost move rides on the record; pending ones withdrawn) and `stk_record_json` (`costs`, values for owner accounts only); from 0096 `pur_guard_expense_row` (cost-move rows: `STOCK_COST_ROW`) and `pur_guard_delete` (`STOCK_LIVE`). Adds `stk_guard_cost_basis` (after insert on `purchase_history`: a line's price or quantity cannot change while approved cost moves value it — `STOCK_COST_IN_USE` — nor where the purchase's cost sits, its billing periods and Cover — `STOCK_COST_FUNDING`; each approved cost move keeps that in `basis_alloc`). Callable: `stk_cost_decide` / `stk_cost_reverse` (main owner), `stk_cost_resubmit` (stock recorders), `stk_cost_pending` (main owner), `stk_company_stock` (owner accounts). Locks: the purchase, then the item and the projects charged in one sorted pass. Requires 0104. Prove with `npm run test:sql` (`2c_cost.pglite.mjs`, `2c_concurrency.mjs`, and the 2A / 2B-a suites re-run `--with-0105`) and `node tests/stock-cost-admin.test.js`; live: `supabase/tests/2c_acceptance.sql` (self-wrapped, rolls back).
+
 Get the truth before relying on this line:
 
 ```sql
````


- [ ] **Step 1: Apply the files above** in Dacs Web. Create blocks as given; Modify blocks with `git apply --ignore-whitespace`. Then put the two CRLF files back to CRLF everywhere:

```bash
node -e "const fs=require('fs');for(const f of ['supabase/migrations/README.md','docs/DATABASE_SCHEMA.md'])fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"
```

- [ ] **Step 2: Tests.** `npm test` → every suite passes (**40**; nothing in the web changes yet). `npm run test:sql` → every suite passes (**32**), including the new `2c_cost.pglite.mjs` (**29**) and `2c_concurrency.mjs` (**9**, 15 rounds each), and every 2B-a and purchasing suite again with 0105 on top: `2b_stock --with-0105` (38), `2a1 --with-0105` (45, stock off), `2a2 --with-0105` (44), `2a3 --with-0105` (23), `2a4 --with-0105` (48) — stock on.
- [ ] **Step 3: Stop for the user** to review and commit. Do not push yet.

### Task 2: Dacs Web — the approvals, Company stock, and cost-move rows on every screen

**Interfaces used:** Task 1's. **Produced:** `window.StockCostAdmin` (`openDecide(c, approve, onDone, unit)`, `openResubmit`, `openReverse`, `renderApprovals(host, onChange)`, `renderCompanyStock(body)`, `valueText`, `peso`), `StockAdmin.costState / costText / canResubmit / costActions`, `window.expIsStockCostRow(row)`.

<!-- Tests -->

**Modify:** `tests/expense-split-rows.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/expense-split-rows.test.js b/tests/expense-split-rows.test.js
index 0426bd2..daf2300 100644
--- a/tests/expense-split-rows.test.js
+++ b/tests/expense-split-rows.test.js
@@ -163,7 +163,10 @@ test('the Materials header total and the period totals still add every part', ()
   const raw = [leg(1, 2, 5000, 'b1'), leg(2, 2, 3000, 'b2'), { id: 'x', expenseName: 'Sand', amount: 250 }];
   const sum = rows => rows.reduce((s, r) => s + r.amount, 0);
   eq(sum(S.groupSplitRows(raw)), sum(raw));
-  ok(/total = items\.reduce\(\(s, m\) => s \+ \(Number\(m\.amount\) \|\| 0\), 0\)/.test(body), 'subtotal sums amounts');
+  // 2C (0105): every amount — except, for staff only, a stock cost move's (its value is the owner's).
+  ok(/total = items\.reduce\(\(s, m\) => s \+ _shownAmount\(m\), 0\)/.test(body), 'subtotal sums amounts');
+  ok(/const _shownAmount = \(m\) => _hideStockCost\(m\) \? 0 : Number\(m\.amount\) \|\| 0;/.test(portal), 'an owner\'s subtotal is every amount');
+  ok(/const _hideStockCost = \(m\) => _staff\(\) && /.test(portal), 'only staff lose a cost move\'s amount');
 });
 
 console.log('\n' + passed + ' passed, ' + failed + ' failed');
```

**Modify:** `tests/money-math.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/money-math.test.js b/tests/money-math.test.js
index 67cee90..328399a 100644
--- a/tests/money-math.test.js
+++ b/tests/money-math.test.js
@@ -550,6 +550,63 @@ console.log('\nP. Purchases are ordinary expense rows');
   });
 }
 
+// == X. STOCK COST MOVES (0105) ARE ORDINARY EXPENSE ROWS ================
+// WorkMate Stage 2C: when the main owner approves a stock cost move, the
+// server writes ordinary `expenses` rows tied to it (stkCostMoveId) — the
+// receiving project funded like a purchase, the giving project NEGATIVE rows
+// on every billing period / Cover group that carried the lot's cost, in
+// proportion. Every Spent / Cover site must read them exactly like any other
+// row: the link may never change a total, a negative row is never dropped,
+// and company stock (no project) is never anyone's Spent. Only staff lose a
+// cost move's amount on screen (_hideStockCost) — never a total that is Spent.
+console.log('\nX. Stock cost moves are ordinary expense rows');
+{
+  const folder = { id: 'f1', totalBudget: 1000000 };
+  const months = [
+    { id: 'm1', monthlyBudget: 7000, fundingType: 'progress' },
+    { id: 'm2', monthlyBudget: 0,    fundingType: 'president' }
+  ];
+  // A ₱1,500 line: ₱1,000 on the period, ₱500 Cover. Half its goods moved to
+  // another project — ₱750 off, in proportion: ₱500 period, ₱250 Cover.
+  const line = [
+    { projectId: 'm1', amount: 1000, docs: {}, purchaseLineId: 'L1' },
+    { projectId: 'm2', amount: 500,  docs: {}, coverExpense: true, purchaseLineId: 'L1' }
+  ];
+  const out = [
+    { projectId: 'm1', amount: -500, docs: {}, stkCostMoveId: 'K1' },
+    { projectId: 'm2', amount: -250, docs: {}, coverExpense: true, stkCostMoveId: 'K1' }
+  ];
+  const giving = portal.buildProject(folder, months, [], line.concat(out), []);
+  test('the giving project: Material and Spent drop by the value moved; Cover stays inside it', () => {
+    eq(giving.material, 750); eq(giving.spent, 750); eq(giving.coverCost, 250);
+  });
+  const unlinked = portal.buildProject(folder, months, [], line.concat(out.map(r => ({ ...r, stkCostMoveId: undefined }))), []);
+  test('the cost-move link changes no total', () => {
+    eq(giving.material, unlinked.material); eq(giving.spent, unlinked.spent); eq(giving.coverCost, unlinked.coverCost);
+  });
+  const receiving = portal.buildProject({ id: 'f2', totalBudget: 1000000 }, [{ id: 'n1', monthlyBudget: 600, fundingType: 'progress' }], [],
+    [{ projectId: 'n1', amount: 600, docs: {}, stkCostMoveId: 'K1' }, { folderId: 'f2', amount: 150, docs: {}, coverExpense: true, stkCostMoveId: 'K1' }], []);
+  test('the receiving project: counted like a purchase, its no-period Cover row inside Cover', () => {
+    eq(receiving.material, 750); eq(receiving.spent, 750); eq(receiving.coverCost, 150);
+  });
+  test('the line still adds up: giving + receiving = what was bought', () => {
+    eq(giving.spent + receiving.spent, 1500);
+  });
+  test('the browser never filters, funds or totals cost moves itself (display only)', () => {
+    const uses = portalSrc.split('\n').filter(l => l.includes('stkCostMoveId'));
+    ok(uses.length === 2, 'portal-app uses stkCostMoveId in ' + uses.length + ' lines');
+    ok(uses.some(l => /^const _hideStockCost = \(m\) => _staff\(\) && /.test(l)), 'the staff-only hiding');
+    ok(uses.some(l => /^\s+stkCostMoveId: d\.stkCostMoveId \|\| null,$/.test(l)), 'the mapped link');
+    for (const name of ['buildProject', '_projSpent', '_projEarned', '_projMargin', '_recognisedProfit']) {
+      const i = portalSrc.indexOf('function ' + name + '(');
+      ok(i !== -1, name + ' not found');
+      ok(!/_shownAmount|_hideStockCost|stkCostMoveId/.test(portalSrc.slice(i, portalSrc.indexOf('\n}\n', i))), name + ' reads a display helper');
+    }
+    const add = expensesSrc.slice(expensesSrc.indexOf('async function handleAddExpense('), expensesSrc.indexOf('\nasync function deleteExpense('));
+    ok(!/stkCostMoveId|stk_cost/.test(add), 'Add expense never writes a cost move');
+  });
+}
+
 // == J. OUT SOURCE IS NOT A FOURTH BUCKET (migration 0057) ==========
 // Project Control Out Source contracts are VENDOR subcontracts living in the
 // SAME `labor_contracts` table as in-house labor, split only by `category`.
```

**Modify:** `tests/project-control-staff.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/project-control-staff.test.js b/tests/project-control-staff.test.js
index b2ff33e..d22c11a 100644
--- a/tests/project-control-staff.test.js
+++ b/tests/project-control-staff.test.js
@@ -262,6 +262,31 @@ async function test(name, fn) {
       assert.deepEqual(h.calls, ['addExpenseModal', 'addExpenseModal', 'addPayrollModal']);
     } finally { globalThis.db = saved.db; globalThis.firebase = saved.firebase; }
   });
+  // 2C (0105): a stock cost move's rows are the owner's value — staff see the
+  // row and its tag, never its pesos, and their subtotals leave it out.
+  const costIn = { id: 'e2', projectId: 'p1', name: 'From warehouse — Cement', category: 'Electrical', amount: 1234,
+    date: '2026-10-13', quantity: 4, docs: {}, docUrls: {}, receipts: [], stkCostMoveId: 'c1' };
+  const plain = { ...material, id: 'e3', name: 'Tape', amount: 777, docUrls: {}, firstReceipt: '', receipts: [] };
+  for (const role of ['staff', 'owner']) await test(role + ': a stock cost move row in Materials', () => {
+    const h = harness(role);
+    h.window.expIsStockCostRow = (r) => !!(r && (r.stkCostMoveId || (r._parts || []).some(p => p.stkCostMoveId)));
+    const tree = h.render('MaterialDrill', { ...materialProps, materialTx: [plain, costIn] });
+    const out = text(tree);
+    assert(out.includes('From warehouse — Cement') && out.includes('Stock cost move'), 'the row and its tag: ' + out);
+    if (role === 'staff') {
+      assert(!/1,234|1234/.test(JSON.stringify(tree)), 'staff see a cost move\'s pesos: ' + out);
+      assert(out.includes('777'), 'staff still see the amounts they enter');
+      assert(!out.includes('2,011'), 'a staff subtotal leaves the cost move out: ' + out);
+    } else {
+      assert(out.includes('1,234') && out.includes('2,011'), 'the owner sees it, and the subtotal counts it: ' + out);
+    }
+    const modal = h.render('ItemDetailsModal', { item: costIn, billingNum: 1, billingOf: () => 1, onClose() {}, onOpenImage() {}, onPrint() {} });
+    assert(role === 'staff' ? !/1,234|1234/.test(JSON.stringify(modal)) : text(modal).includes('1,234'), role + ' details: ' + text(modal));
+  });
+  await test('a stock cost move is read-only in Project Control: no part-by-part edit, and it maps its link', () => {
+    assert(/stkCostMoveId: d\.stkCostMoveId \|\| null,/.test(source), 'mapExpense keeps the link');
+    assert(/const isOldSplit = \(m\) => [^\n]*window\.expIsStockCostRow\(m\)\);/.test(source), 'never edited part by part');
+  });
   console.log('\n' + passed + ' passed, ' + failed + ' failed');
   if (failed) process.exitCode = 1;
 })();
```

**Modify:** `tests/purchase-server.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/purchase-server.test.js b/tests/purchase-server.test.js
index 28816e0..1619a50 100644
--- a/tests/purchase-server.test.js
+++ b/tests/purchase-server.test.js
@@ -209,7 +209,9 @@ test('staff never see a budget-based Cover guess (they cannot read budgets; the
   assert(staff !== -1 && staff < b.indexOf('const folderMonths'), 'staff must return before the budget-based banner');
   const list = between(EXP, 'const _coverSet = new Set();', 'const _renderExpRow');
   assert(/if \(window\.currentUserRole !== 'staff'\)/.test(list), 'the list guess must skip staff');
-  assert(/if \(e\.purchaseLineId \|\| e\.purchaseChargeId\) return;/.test(list), 'purchase rows must keep their real Cover flag');
+  // 2C (0105): a stock cost move's rows carry the server's Cover flag too.
+  assert(/if \(e\.purchaseLineId \|\| e\.purchaseChargeId \|\| e\.stkCostMoveId\) return;/.test(list),
+         'purchase and stock cost-move rows must keep their real Cover flag');
 });
 
 test('purchase-made rows are edited and deleted through their purchase', () => {
```

**Create:** `tests/stock-cost-admin.test.js`

```js
// ════════════════════════════════════════════════════════════════════
// STOCK COST MOVES (0105, 2C):  run with  node tests/stock-cost-admin.test.js
//
// Zero dependencies. Loads the REAL js/stock-cost-admin.js and
// js/stock-admin.js (their pure halves) and reads the screens' source:
//   1. The words agree with the server: every refusal 0105 can send has a
//      sentence; the states read as the spec words them.
//   2. Pesos: only owner accounts get a value (the server leaves the keys out
//      for anyone else); the Stock screen file still shows none; Project
//      Control and Expenses never edit, delete or guess Cover for a cost-move
//      row; the browser never computes a value or writes an expense row.
//   3. Wiring: the cards in Purchasing → Owner approvals and Stock → Waiting
//      for owner, the Company stock tab for owner accounts once stock is on,
//      the script tags, every write sent once.
// ════════════════════════════════════════════════════════════════════
'use strict';
const sc = require('../js/stock-cost-admin.js');
const sa = require('../js/stock-admin.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0105_stock_cost_moves.sql');
const JS = read('js/stock-cost-admin.js');
const BROWSER = JS.slice(JS.indexOf('// ── Browser'));
const STOCK = read('js/stock-admin.js');
const EXP = read('js/expenses-module.js');

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

console.log('\ncost moves: the words agree with the server');

test('every refusal 0105 can send has a sentence where it is shown', () => {
  const codes = [...new Set([...SQL.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))];
  // Expense-row and delete guards (triggers) are worded where they surface: Expenses.
  const expensesWords = ['PURCHASE_ROW', 'PURCHASES_LIVE', 'STOCK_COST_ROW', 'STOCK_LIVE', 'STOCK_COST_IN_USE', 'STOCK_COST_FUNDING'];
  for (const c of codes) {
    if (expensesWords.includes(c)) { ok(new RegExp('\\b' + c + ':').test(EXP), c + ' has no sentence in Expenses'); continue; }
    ok(sc.ERRORS[c] || sa.ERRORS[c], c + ' has no sentence');
  }
  for (const c of ['COST_MOVED', 'STOCK_COST_IN_USE']) ok(sa.ERRORS[c], c + ' on the Stock screen');
  for (const c of ['NOTHING_LEFT', 'COMPLETED_PROJECT', 'LATER_MOVES_FIRST', 'OWNER_ONLY']) ok(sc.ERRORS[c], c + ' on the cost forms');
  ok(sc.errorMessage({ message: 'LATER_MOVES_FIRST' }).includes('Reverse those first'), 'a code becomes a sentence');
  // A correction or re-fund refused for stock reasons reads in words where it is made: Expenses and Purchasing (rev 2).
  const purchasing = read('js/purchasing-admin-core.js');
  for (const c of ['STOCK_IN_USE', 'STOCK_COST_IN_USE', 'STOCK_COST_FUNDING']) {
    ok(new RegExp('\\b' + c + ':').test(purchasing), c + ' has no sentence in Purchasing');
    ok(new RegExp('\\b' + c + ':').test(EXP), c + ' has no sentence in Expenses');
  }
});

test('the states, as the spec words them (Q11, Q12, Q10, Q27)', () => {
  const s = (kind, status, reversed) => sa.costState({ kind, status, reversed })[0];
  eq([s('assign', 'pending'), s('transfer', 'pending'), s('back', 'pending')],
     ['Cost assignment pending', 'Cost transfer pending', 'Back to company stock — pending']);
  eq([s('assign', 'approved'), s('transfer', 'approved'), s('back', 'approved'), s('loss', 'approved')],
     ['Cost assigned', 'Cost transferred', 'Cost back in company stock', 'Company stock loss']);
  eq([s('assign', 'rejected'), s('assign', 'withdrawn'), s('assign', 'approved', true)],
     ['Cost move rejected — kept with source', 'Cost request withdrawn', 'Cost move reversed']);
  eq(sa.costText({ status: 'approved', approved_quantity: 3, quantity: 5, from_name: 'Company stock', to_name: 'Barlin' }, 'bag'),
     '3 bag: Company stock → Barlin', 'an approved one shows what it charged');
});

test('who may do what: the main owner decides and reverses; a recorder asks again once', () => {
  const owner = { isMainOwner: true }, staff = { isMainOwner: false };
  eq(sa.costActions({ status: 'pending', kind: 'assign' }, owner, [], true), ['approve', 'reject']);
  eq(sa.costActions({ status: 'pending', kind: 'assign' }, staff, [], true), []);
  eq(sa.costActions({ status: 'approved', kind: 'transfer' }, owner, [], true), ['reverse']);
  eq(sa.costActions({ status: 'approved', kind: 'loss' }, owner, [], true), [], 'a loss goes with its count');
  const rejected = { id: 'a', move_id: 7, status: 'rejected', kind: 'assign' };
  eq(sa.costActions(rejected, staff, [rejected], true), ['resubmit']);
  eq(sa.costActions(rejected, staff, [rejected], false), [], 'not a stock recorder');
  eq(sa.costActions(rejected, staff, [rejected, { id: 'b', move_id: 7, status: 'pending' }], true), [], 'already asked again');
  eq(sa.costActions(rejected, staff, [rejected, { id: 'b', move_id: 8, status: 'pending' }], true), ['resubmit'], 'another movement');
  const reversed = { id: 'c', move_id: 9, status: 'approved', reversed: true, kind: 'assign' };
  eq(sa.costActions(reversed, owner, [reversed], true), ['resubmit'], 'reversed (say, to fix the price): ask again');
});

console.log('\ncost moves: pesos');

test('a value only when the server sent one (owner accounts); negative and estimates read plainly', () => {
  eq(sc.valueText({ value: 400 }), '₱400.00');
  eq(sc.valueText({ estimate: 328.35 }), 'about ₱328.35');
  eq(sc.valueText({ status: 'pending', quantity: 4 }), '', 'staff: no keys, nothing shown');
  eq(sc.peso(-1234.5), '−₱1,234.50');
  eq(sc.groupText({ cover: true, carries: 400 }), 'Cover carries ₱400.00');
  eq(sc.groupText({ billing_number: 2, month: 'October', year: 2026, carries: 600 }), 'Billing #2 (October 2026) carries ₱600.00');
});

test('the server sends values to owner accounts only, and nothing of them to anyone else', () => {
  ok(/\|\| case when coalesce\(is_owner\(\), false\) then jsonb_build_object\(\s+'value', c\.value,/.test(SQL), 'value keys only for owners');
  ok(/else '\{\}'::jsonb end\s+from stk_cost_moves c where c\.id = p_cost/.test(SQL), 'no keys otherwise');
  ok(/create or replace function stk_cost_pending\(\)[\s\S]*?declare v_owner uuid := pur_main_owner\(\);/.test(SQL), 'the cards: main owner');
  ok(/create or replace function stk_company_stock\(\)[\s\S]*?if not coalesce\(is_owner\(\), false\) then\s+raise exception 'NOT_ALLOWED'/.test(SQL), 'company stock: owners');
  for (const f of ['stk_cost_decide', 'stk_cost_reverse']) {
    ok(new RegExp('create or replace function ' + f + '\\([\\s\\S]*?v_owner uuid := pur_main_owner\\(\\);').test(SQL), f + ': main owner');
  }
});

test('the Stock screen file still holds no peso; this file computes none and writes no expense row', () => {
  ok(!/₱|peso|amount|price|toFixed\(2\)/i.test(STOCK.replace(/\/\/[^\n]*/g, '')), 'stock-admin.js shows money');
  ok(!/\.from\(/.test(JS), 'no direct table read');
  ok(!/expenses|insert|\* *Number\(c\.(value|estimate)/.test(BROWSER.replace(/\/\/[^\n]*/g, '')), 'no expense write, no value arithmetic');
  ok(/c\.value !== undefined && c\.value !== null/.test(JS), 'the value is the server\'s');
});

test('Expenses: a cost-move row is never edited, deleted or guessed into Cover', () => {
  const del = EXP.slice(EXP.indexOf('async function deleteExpense('));
  ok(del.indexOf('pe.stkCostMoveId') !== -1 && del.indexOf('pe.stkCostMoveId') < del.indexOf('pe.purchaseLineId || pe.purchaseChargeId'), 'delete refuses first');
  const edit = EXP.slice(EXP.indexOf('_editingPurchase = null;\n    _purEditOpId = null;'));
  ok(/^_editingPurchase = null;\n    _purEditOpId = null;\n    if \(e\.stkCostMoveId\) \{ showExpNotif\(/.test(edit), 'edit refuses first');
  ok(/if \(e\.purchaseLineId \|\| e\.purchaseChargeId \|\| e\.stkCostMoveId\) return;/.test(EXP), 'its Cover flag is the server\'s');
  ok(/const purBadge = e\.stkCostMoveId\s+\? '<span title="Moved from stock[^']*>Stock cost move<\/span>'/.test(EXP), 'tagged');
  const split = require('../js/expense-split-rows.js');
  eq([split.isStockCostRow({ stkCostMoveId: 'k' }), split.isStockCostRow({ _parts: [{}, { stkCostMoveId: 'k' }] }), split.isStockCostRow({ purchaseLineId: 'l' })],
     [true, true, false]);
});

console.log('\ncost moves: wiring');

test('only this file calls the cost-move functions; every cost write is sent once', () => {
  const called = [...new Set([...BROWSER.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]))].sort();
  eq(called, ['stk_company_stock', 'stk_cost_decide', 'stk_cost_pending', 'stk_cost_resubmit', 'stk_cost_reverse']);
  const granted = [...SQL.matchAll(/grant execute on function ([a-z_]+)\(/g)].map(m => m[1]);
  for (const f of called) ok(granted.includes(f), f + ' is not granted by 0105');
  for (const w of ['stk_cost_decide', 'stk_cost_resubmit', 'stk_cost_reverse']) {
    ok(new RegExp("sendOnce\\(\\(opId[^)]*\\) => RA\\.rpc\\('" + w + "'").test(BROWSER), w + ' goes through sendOnce');
    ok((BROWSER.match(new RegExp("RA\\.rpc\\('" + w + "'", 'g')) || []).length === 1, w + ' is called in one place');
  }
  const others = fs.readdirSync(path.join(__dirname, '..', 'js')).filter(f => f.endsWith('.js') && !['stock-admin.js', 'stock-cost-admin.js'].includes(f));
  for (const f of others) ok(!/rpc\(\s*'stk_(cost_|company_stock)/.test(read('js/' + f)), f + ' calls a cost-move function');
});

test('Owner approvals and Waiting for owner show the cards; Company stock is a tab for owner accounts once stock is on', () => {
  const list = read('js/purchasing-admin-list.js');
  const purchases = read('js/purchasing-admin-purchases.js');
  ok(/function companyStockTab\(\) \{\s+return !!\(root\.StockCostAdmin && root\.currentStockOn && PA\.ui\.isOwner\);/.test(list), 'the tab rule');
  ok(/\(companyStockTab\(\) \? t\('company', 'Company stock'\) : ''\)/.test(list), 'the tab');
  ok(/if \(ui\.tab === 'company' && companyStockTab\(\)\) return root\.StockCostAdmin\.renderCompanyStock\(/.test(list), 'its body');
  ok(/\(me\.isOwner && root\.StockCostAdmin \? '<div data-stock-costs><\/div>' : ''\)/.test(purchases), 'owner approvals');
  ok(/if \(costs\) root\.StockCostAdmin\.renderApprovals\(costs\);/.test(purchases), 'cards drawn');
  ok(/if \(m\.isMainOwner && root\.StockCostAdmin\) root\.StockCostAdmin\.renderApprovals\(/.test(STOCK), 'Waiting for owner');
  const html = read('admin.html');
  const a = html.indexOf('<script src="js/stock-admin.js?v='), b = html.indexOf('<script src="js/stock-cost-admin.js?v=');
  ok(a !== -1 && b > a, 'stock-cost-admin.js loads after stock-admin.js');
  ok(html.indexOf('js/requests-admin-core.js') < b, 'after RequestsAdmin');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

<!-- Code -->

**Modify:** `CLAUDE.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index 2e347a3..663b9cf 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -142,13 +142,27 @@ Profit   = Earned − Spent
   `pm_ca_*` functions (`tests/cash-advance.test.js` fences it). Owner-role only; staff never see it.
   Spec: `docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md`.
 - **Stock (0104, WorkMate 2B-a) is quantities only.** Lots, receipts, issues, returns, leftovers, counts and opening
-  stock never read or write a peso, an `expenses` row or Spent; the value of stock and every cost move are Stage 2C
-  (main owner only). "Bought" in request capacity (`pr_portion_bought`) means **covered** — purchases plus live stock
+  stock never read or write a peso, an `expenses` row or Spent; the value of stock and every cost move are 0105
+  (below). "Bought" in request capacity (`pr_portion_bought`) means **covered** — purchases plus live stock
   records — so Still to buy is never negative; the shopping list's `bought` stays purchases alone. A stock record is
   never edited, only reversed with a reason. Goods are issued **oldest received first** — by delivery, never by
   purchase date. A catalogue item's kind and unit are fixed once a request or stock uses it. Only `js/stock-admin.js`
-  calls the `stk_*` functions. Dormant until the main owner switches it on; then the old "Add to inventory" tick and
-  `inventory` table refuse writes.
+  and `js/stock-cost-admin.js` call the `stk_*` functions. Dormant until the main owner switches it on; then the old
+  "Add to inventory" tick and `inventory` table refuse writes.
+- **Stock cost moves (0105, WorkMate 2C) — only the main owner moves the cost of stock.** Moving goods never moves
+  their cost: the server opens a pending cost move wherever goods arrive in someone else's cost (company → project,
+  project → project, a company lot back to the warehouse), and until the main owner approves, the cost stays where it
+  was — a pending one covers only what is still there. Approval writes **ordinary expense rows**
+  (`expenses.stk_cost_move_id`): the receiving project funded like a purchase (the month it received the goods), the
+  giving project **negative** rows on every billing period / Cover group that carried that lot's cost, in proportion.
+  They count in Material / Spent / Cover like any row — never filter them out. Value is by lot (item amount − discount +
+  delivery fee); the last portion takes what is left, so a line's portions always add up to it. **Company stock is never
+  in a project's Spent and never G&A**; a confirmed loss of company goods goes to company stock loss with no expense row.
+  Cost-move rows are never edited or deleted (`STOCK_COST_ROW`) — the main owner reverses the cost move with a reason; a
+  movement whose cost was approved is not reversed (`COST_MOVED`), a line's price can't change under approved moves
+  (`STOCK_COST_IN_USE`), and neither can where the purchase's cost sits — its billing periods and Cover: a correction,
+  re-fund or approved change request that would move its rows waits until those moves are reversed (`STOCK_COST_FUNDING`). Values are for owner accounts only: staff see the "Stock cost move" row and its state, never its
+  pesos, and it is left out of their subtotals (`_hideStockCost`). Pesos for stock live only in `js/stock-cost-admin.js`.
 
 Full reasoning: [docs/OVERHEAD_MODULE.md](docs/OVERHEAD_MODULE.md).
 
```

**Modify:** `admin.html` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/admin.html b/admin.html
index 7f6f2cf..5e50186 100644
--- a/admin.html
+++ b/admin.html
@@ -22,7 +22,7 @@
     <link rel="stylesheet" href="css/reimbursement-module.css">
     <link rel="stylesheet" href="css/attendance-admin.css">
     <link rel="stylesheet" href="css/requests-admin.css?v=20261012a">
-    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261025a">
+    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261026a">
     <link rel="stylesheet" href="css/workplan-admin.css?v=20261014a">
     <!-- Warranty Retention Register + Fund Styles -->
     <link rel="stylesheet" href="css/warranty-fund.css?v=20260803f">
@@ -5415,8 +5415,8 @@
 <script src="js/admin.js?v=20261018a"></script>
 <script src="js/print-utils.js"></script>
 <script src="js/receipt-storage.js?v=20261016a"></script>
-<script src="js/expense-split-rows.js?v=20261015a"></script>
-<script src="js/expenses-module.js?v=20261022b"></script>
+<script src="js/expense-split-rows.js?v=20261026a"></script>
+<script src="js/expenses-module.js?v=20261026a"></script>
 <script src="js/overhead-module.js"></script>
 <script src="js/reimbursement-module.js"></script>
 <script src="js/construction-module.js"></script>
@@ -5430,13 +5430,14 @@
 <script src="js/requests-admin-setup.js?v=20261012a"></script>
 <script src="js/requests-admin-history.js?v=20261012a"></script>
 <script src="js/requests-admin-gallery.js?v=20261012a"></script>
-<script src="js/purchasing-admin-core.js?v=20261023a"></script>
-<script src="js/purchasing-admin-list.js?v=20261025a"></script>
+<script src="js/purchasing-admin-core.js?v=20261026a"></script>
+<script src="js/purchasing-admin-list.js?v=20261026a"></script>
 <script src="js/purchasing-admin-record.js?v=20261022b"></script>
-<script src="js/purchasing-admin-purchases.js?v=20261022b"></script>
+<script src="js/purchasing-admin-purchases.js?v=20261026a"></script>
 <script src="js/purchasing-admin-pay.js?v=20261023a"></script>
 <script src="js/purchasing-admin-cash.js?v=20261023b"></script>
-<script src="js/stock-admin.js?v=20261025a"></script>
+<script src="js/stock-admin.js?v=20261026a"></script>
+<script src="js/stock-cost-admin.js?v=20261026a"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261014a"></script>
 <script src="js/workplan-admin-board.js?v=20261014a"></script>
```

**Modify:** `css/purchasing-admin.css` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/css/purchasing-admin.css b/css/purchasing-admin.css
index d29fa71..94706d0 100644
--- a/css/purchasing-admin.css
+++ b/css/purchasing-admin.css
@@ -153,6 +153,9 @@
 .stk-rec.is-reversed .stk-rec-main { color: var(--att-muted); }
 .stk-rec-acts, .stk-line-acts { display: flex; flex-wrap: wrap; gap: 6px; }
 .stk-line-acts { margin-top: 8px; }
+/* 2C (0105): a record's cost moves, under it. */
+.stk-cost { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 4px; padding-top: 6px; border-top: 1px dashed var(--att-line); }
+.stk-cost-acts { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
 @media (max-width: 640px) {
     .stk-rec { flex-direction: column; }
     .stk-grid2 { grid-template-columns: 1fr; }
```

**Modify:** `docs/ARCHITECTURE.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/docs/ARCHITECTURE.md b/docs/ARCHITECTURE.md
index 5303eb0..f2a7ed1 100644
--- a/docs/ARCHITECTURE.md
+++ b/docs/ARCHITECTURE.md
@@ -133,7 +133,7 @@ Also note: **`projects` means billing period**, not project. Read it that way ev
 | Attendance | `attendance-admin.js` | Construction worker Time In / Time Out (`0050`). **The worker client is a separate native Android app** (Kotlin + Compose, repo `Documents/Dacs Attendance`), **not** the Bubblewrap TWA in `android/` — that one wraps the *client portal* and is untouched. This module is the admin half only. Today's attendance (a LEFT JOIN against active workers, so a worker with no row shows as `No record` rather than vanishing), worker detail with both photos, **worker management** (`attWorkers` — the roster including **deactivated** workers, which Today deliberately hides; deactivating blocks sign-in via `attendance-signin` and is the only route back, so that screen must never filter them out. Shows `email`, which Today does not select, because two workers can share a display name and the email is the only thing that tells them apart), **creating a worker** (the `attOpenNewWorker` modal on that same screen — mints the auth account through the shared `adminCreateUser` helper and the `admin-create-user` Edge Function, never from the browser; `kind` is always `admin` and the role list is **worker / teamLeader only**, because staff, engineer and owner accounts belong to Users → Navigator and a second, less-guarded route to a privileged account is exactly what this must not become. `worker_no` is left out of the payload on purpose — `profiles_worker_no_trg` (0050) assigns it from `worker_no_seq`; `position` is written by a follow-up update because the Edge Function builds its profile row from a fixed whitelist. Terms are **not** pre-signed here: the worker accepts them in the Android app), the projects picker list (**deactivate, never delete** — records reference the project id), and reports with CSV export. The report roll-up and CSV escaping are pure functions guarded by `tests/attendance.test.js`, which extracts them from the live source. **Hours here are never a pay figure** and no rate column exists — do not add one. **Deliberately isolated** like Reimbursement, Warranty Fund and Quotations: no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Attendance hours are **not** the basis of pay — labour is pakyaw, capped by `labor_contracts.agreed_amount`. **One peso column exists** since 0066 — `attendance_weekly_rewards.amount`, a reported figure that creates no accounting entry and must never be made to; this line previously said there was none, and that the staff amount-hiding rule therefore did not apply. Whether staff should see that amount is undecided; it is currently visible to them, and the payroll CSV they work from depends on it. Workers write only through the `attendance_time_in` / `attendance_time_out` RPCs; they hold no insert or update policy. **Closing a forgotten Time Out** (`0061`) is the one admin write: `attendance_abandon()` sets status `abandoned` plus a `abandoned_by`/`abandoned_at`/`abandoned_note` trail, and **invents no hours** — `timeout_at` and `total_minutes` stay null, so the day still reports `—`. It goes through an RPC even though owner/staff already hold an update policy, because `abandoned_at` must be the server's `now()` and `abandoned_by` must be `auth.uid()`; a browser-supplied trail is one the caller chose. Guarded against closing a `complete` record, closing twice, and closing **today's** date (that worker is probably on site, and `attendance_time_out` only closes rows on `working`). Surfaced in A2 and in A6's **open-records panel** — the only place a record stuck since August becomes visible, because A1 shows one day at a time |
 | Requests | `requests-admin-core.js`, `requests-admin-queue.js`, `requests-admin-detail.js`, `requests-admin-setup.js`, `requests-admin-history.js`, `requests-admin-gallery.js` | The office half of **DAC'S WorkMate Requests** (`0085` tables, `0086` office RPCs). Workers and team leaders request materials and tools in the phone app; owner and staff process them here: the **queue** (urgent first, then by weekly batch — Saturday 12:00 noon Manila cutoff), one request's **detail** (mark portions arranged, move an unarranged portion to another batch, resolve a worker's reduction of arranged quantity as *order reduced* or *kept as surplus*, change or cancel an item with a reason, resolve an offline-edit conflict, match an unlisted item to the catalogue, private photos via signed URLs, full history), **weekly batches** (only purchasing/delivery dates change), **teams** (a leader needs the Team Leader role *and* the assignment), the **catalogue** (deactivate, never delete; since `0092` an item used in any request keeps its **kind and unit** — the form locks both and the server refuses `ITEM_IN_USE`) and **projects** (*Allow requests*). Since `0090` (Stage 1b, Find Previous Item): catalogue **aliases** and **brand** (search aids, not identity), a per-project **Item history** switch (separate from *Allow requests*, survives completion), and the **Item history** view — search items with their dated history, add or retire a **historical reference** (creates no expense, stock or purchase), and manage reviewed **product photos** in the private `item-gallery` bucket (`<company>/<item>/<uuid>.jpg`, re-encoded in the browser, three-tick checklist, cover, retire — never deleted); **Photos to review** publishes a COPY of a worker's private request photo or keeps it private. A request line shows the Request Again source (`ref_label`). **Every write is an RPC** — the browser holds no write policy. **No money anywhere**: quantities only, so staff see all of it. A project or Additional Works job with requests **cannot be deleted** (`deleteFolder` / `deleteChild` ask `pr_folder_request_count` first) — complete it instead. Pure helpers are guarded by `tests/requests-admin.test.js`; the migration by `tests/workmate-requests-office.test.js`. Workers and team leaders can no longer sign in to this portal (`ADMIN_ROLES`) |
 | Purchasing | `purchasing-admin-core.js`, `purchasing-admin-list.js`, `purchasing-admin-record.js`, `purchasing-admin-purchases.js`, `css/purchasing-admin.css` | WorkMate Stage 2A-2 (`0097`): **Requests → Purchasing**, for accounts the server lets buy (owner, admin accounts allowed Expenses, staff with the **Buyer** switch — set by the owner in Users → Navigator). An account focused on Expenses but not Requests still gets a Requests tab holding Purchasing alone (`_purchasingOnly` in `admin.js`). The **shopping list** (Needed · Bought · Still to buy per weekly-batch portion, who is buying each — "I'll buy this", assign, release, mark arranged), **Record purchase** (one receipt, many lines and projects, linked to their request portions — optionally picked per weekly portion, and then only those are covered — extras with a reason, substitutes with a reason and an office check, Unplanned lines, delivery fees / discounts, receipt photos in the buyer-only `purchases/` folder, kept in the form state so a redraw keeps them and a replacement is uploaded), **Purchases** (one purchase: covers, unit / substitute check, correct, void, history; receipts open through an authenticated download, never a signed link) and **Owner approvals** (staff changes only the owner may make, shown field by field — as asked vs asked for — and not approvable once the purchase changed). Shows prices — the one Requests screen that does. Every write is a `pur_*` RPC through the same recording operation as Expenses / Project Control (0096). Project Control's edit and void send owner-only staff changes for approval, and read the purchase behind a row through `pur_entry_row` (`expenses-module.js`) — purchase tables are buyers-only. Pure helpers: `tests/purchasing-admin.test.js`; migration: `tests/purchasing-server.test.js` + `npm run test:sql` |
-| Stock | `stock-admin.js`, `css/purchasing-admin.css` (`stk-*`) | WorkMate Stage 2B-a (`0104`): **Requests → Stock**, quantities only, for owner and office staff allowed Expenses (Buyer staff included). Hidden until the main owner switches stock on (`stk_status`; the main owner sees the switch). An account focused on other sections (`allowed_modules` without Requests) that the server lets record stock still gets a Requests tab holding Stock (`_stockOnly` in `admin.js`, menu and view guard — beside Purchasing for a buyer). Tabs: **Stock** (items by place; one item's lots, each delivery with the day it was received — the issuing order, oldest received first — and history), **Receiving** (warehouse purchases awaiting delivery or a catalogue match), **Waiting for owner** (counts and opening stock the main owner confirms), **History** (reverse / withdraw). Forms: Issue / move, Record leftovers, Count, Opening stock, Match, Received, Not delivered — each sends one operation id. The shopping list shows "In warehouse" and, once stock is on, "Issue from stock" (`StockAdmin.openIssue`). Once stock is on, the old "Add to inventory" tick (Add Expense) and the old Inventory screen are hidden — the server refuses both. Pure helpers: `tests/stock-admin.test.js`; migration: `npm run test:sql` (`2b_stock`, `2b_concurrency`) |
+| Stock | `stock-admin.js`, `stock-cost-admin.js`, `css/purchasing-admin.css` (`stk-*`) | WorkMate Stage 2B-a (`0104`): **Requests → Stock**, quantities only, for owner and office staff allowed Expenses (Buyer staff included). Hidden until the main owner switches stock on (`stk_status`; the main owner sees the switch). An account focused on other sections (`allowed_modules` without Requests) that the server lets record stock still gets a Requests tab holding Stock (`_stockOnly` in `admin.js`, menu and view guard — beside Purchasing for a buyer). Tabs: **Stock** (items by place; one item's lots, each delivery with the day it was received — the issuing order, oldest received first — and history), **Receiving** (warehouse purchases awaiting delivery or a catalogue match), **Waiting for owner** (counts and opening stock the main owner confirms), **History** (reverse / withdraw). Forms: Issue / move, Record leftovers, Count, Opening stock, Match, Received, Not delivered — each sends one operation id. The shopping list shows "In warehouse" and, once stock is on, "Issue from stock" (`StockAdmin.openIssue`). Once stock is on, the old "Add to inventory" tick (Add Expense) and the old Inventory screen are hidden — the server refuses both. Pure helpers: `tests/stock-admin.test.js`; migration: `npm run test:sql` (`2b_stock`, `2b_concurrency`). **Cost moves (2C, `0105`)**: each record lists its cost moves as states ("Cost assignment pending", "Cost transferred"…); `stock-cost-admin.js` holds every peso — the main owner's Approve / Reject / Reverse cost and a recorder's Ask again, the cards in Purchasing → **Owner approvals** (and Stock → Waiting for owner), and Purchasing → **Company stock** (owner accounts). Approved cost moves are ordinary expense rows (`stkCostMoveId`): Project Control and Expenses tag them "Stock cost move", never edit or delete them, and hide their amount from staff (`_hideStockCost`). Tests: `tests/stock-cost-admin.test.js`; `npm run test:sql` (`2c_cost`, `2c_concurrency`) |
 | Work Plan | `workplan-admin-core.js`, `workplan-admin-form.js`, `workplan-admin-board.js`, `workplan-admin-task.js`, `workplan-admin-meetings.js` | The office half of **DAC'S WorkMate My Work** (`0093`, `0094`; plan `docs/superpowers/plans/2026-10-13-workmate-stage1c2-work-plan-office.md`). Owner and staff turn **meeting notes** into tasks — **AI drafts** through the `dacs-ai` worker (gated by `ai_authorize`, `0095`) or by hand — and review each in the **task form**: an AI name is filled in only on one exact match, otherwise the field reads *Needs your choice* and Save refuses. **Publish** sends tasks and shared notes to chosen people (default: everyone assigned in that meeting). The **Board** groups tasks under the office lists (check, blocked, not acknowledged 24 h, overdue, live, drafts/proposals, completed). One **task** shows who read which version, problems (cleared by the office with a note), photos (private `task-photos`), history, and approve / send back / reopen / cancel-decline. On a published task the **server raises the version** for any people, team or date change, and for wording unless marked a minor spelling correction (`0094`). Edits keep links and helpers the office did not remove, including links to tasks completed long ago. Unsaved meeting notes, shared notes and recipients survive redraws. **No money** — staff see all of it. Tests: `tests/workplan-admin.test.js`, `tests/workmate-office-server.test.js`, `tests/ai-worker.test.js`; live: `supabase/tests/1c2_acceptance.sql`, `1c2_ai_gate.sql` |
 
 **Project Control is compiled React.** See the build trap in §8.
```

**Modify:** `js/expense-split-rows.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/expense-split-rows.js b/js/expense-split-rows.js
index ec20027..07f56fe 100644
--- a/js/expense-split-rows.js
+++ b/js/expense-split-rows.js
@@ -66,6 +66,12 @@
         return !!(r && (r.purchaseLineId || r.purchaseChargeId));
     }
 
+    // A stock cost move's rows (0105): read-only, reversed as one by the main
+    // owner (Requests → Stock) — never edited or deleted part by part.
+    function isStockCostRow(r) {
+        return !!(r && (r.stkCostMoveId || (r._parts || []).some(function (p) { return p.stkCostMoveId; })));
+    }
+
     // The billing period column for a (grouped) row: "Billing #1 + Billing #2"
     // for a split. labelOf(periodId) returns a period's label or ''.
     function periodLabel(r, labelOf) {
@@ -77,8 +83,9 @@
 
     root.expGroupSplitRows = groupSplitRows;
     root.expIsPurchaseRow = isPurchaseRow;
+    root.expIsStockCostRow = isStockCostRow;
     root.expSplitPeriodLabel = periodLabel;
     if (typeof module !== 'undefined' && module.exports) {
-        module.exports = { groupSplitRows: groupSplitRows, isPurchaseRow: isPurchaseRow, periodLabel: periodLabel };
+        module.exports = { groupSplitRows: groupSplitRows, isPurchaseRow: isPurchaseRow, isStockCostRow: isStockCostRow, periodLabel: periodLabel };
     }
 })(typeof window !== 'undefined' ? window : globalThis);
```

**Modify:** `js/expenses-module.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/expenses-module.js b/js/expenses-module.js
index e782f04..723357b 100644
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -2059,7 +2059,7 @@ function renderExpensesTable() {
         let cum = 0;
         sorted.forEach(e => {
             cum += (e.amount || 0);
-            if (e.purchaseLineId || e.purchaseChargeId) return;
+            if (e.purchaseLineId || e.purchaseChargeId || e.stkCostMoveId) return;
             if (e.coverExpense || cum > budget) _coverSet.add(e.id);
         });
     });
@@ -2071,7 +2071,9 @@ function renderExpensesTable() {
         const fundingBadge = (_coverSet.has(e.id) || e.coverExpense) ? _fundingBadgeHTML(null, true) : (srcProj ? _fundingBadgeHTML(srcProj, false) : '');
         const catBadge = showCategoryBadge ? getCategoryPillHTML(e.category) : '';
         const invBadge = e.inInventory ? '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 7px;border-radius:999px;background:#ecfdf5;color:#15803d;font-size:10.5px;font-weight:700;border:1px solid #a7f3d0;">📦 In Inventory</span>' : '';
-        const purBadge = (e.purchaseLineId || e.purchaseChargeId)
+        const purBadge = e.stkCostMoveId
+            ? '<span title="Moved from stock — the main owner approved where its cost goes. Only the main owner reverses it (Requests → Stock)." style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#f0f9ff;color:#0369a1;font-size:10.5px;font-weight:700;border:1px solid #bae6fd;">Stock cost move</span>'
+            : (e.purchaseLineId || e.purchaseChargeId)
             ? '<span title="Recorded as a purchase — edit or void it to change it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10.5px;font-weight:700;border:1px solid #c7d2fe;">From purchase</span>'
               + (_purReviewLines.has(e.purchaseLineId) ? '<span title="No billing period for its month — charged to Cover until the office reviews it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:10.5px;font-weight:700;border:1px solid #fed7aa;">Office review</span>' : '')
               + (window.expPurPendingChange(e.purchaseLineId || e.purchaseChargeId) ? '<span title="You sent a change of this purchase to the owner — open the row to withdraw it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fefce8;color:#a16207;font-size:10.5px;font-weight:700;border:1px solid #fde68a;">Waiting for the owner</span>' : '')
@@ -2836,6 +2838,12 @@ function _purErrorText(err) {
         BAD_PROJECT:           'This project no longer exists or belongs to another account — refresh the page.',
         NOT_FOUND:             'That purchase or project was not found — refresh the page.',
         PURCHASE_ROW:          'This row was made by a purchase — use Edit or Void on it instead.',
+        // Stock (0104) and stock cost moves (0105): a purchase whose goods are stock, or whose cost the owner moved.
+        STOCK_COST_IN_USE:     'The owner approved stock cost moves that rely on this purchase line\'s price and quantity — the main owner reverses them first (Requests → Stock).',
+        STOCK_COST_FUNDING:    'The owner approved stock cost moves that rely on where this purchase\'s cost sits (its billing periods and Cover) — the main owner reverses them first (Requests → Stock).',
+        STOCK_IN_USE:          'This purchase line has stock records — reverse them first (Requests → Stock), or keep its destination, project, unit and enough quantity.',
+        STOCK_COST_ROW:        'This row is a stock cost move the owner approved — only the main owner reverses it (Requests → Stock).',
+        STOCK_LIVE:            'It has stock records or stock cost moves — mark the project completed instead.',
         TOTAL_MISMATCH:        'The items and fees do not add up to the receipt total.',
         BAD_LINES:             'Check the item lines.',
     };
@@ -3123,6 +3131,8 @@ async function deleteExpense(id) {
         try { const snap = await db.collection('expenses').doc(id).get(); if (snap.exists) pe = { id: snap.id, ...snap.data() }; }
         catch (err) { console.error('deleteExpense fetch:', err); }
     }
+    // 2C (0105): a stock cost move's row — the database refuses it too (STOCK_COST_ROW).
+    if (pe && pe.stkCostMoveId) { showExpNotif('This is a stock cost move the main owner approved. It is never edited or deleted here — the main owner reverses it in Requests → Stock.', 'error'); return; }
     if (pe && (pe.purchaseLineId || pe.purchaseChargeId)) {
         if (!await _purOfferWithdraw(pe)) return;
         let pur;
@@ -4427,6 +4437,7 @@ async function openEditExpenseModal(id) {
     // and a reason is required. The billing period is the server's to choose.
     _editingPurchase = null;
     _purEditOpId = null;
+    if (e.stkCostMoveId) { showExpNotif('This is a stock cost move the main owner approved. It is never edited or deleted here — the main owner reverses it in Requests → Stock.', 'error'); return; }
     if (e.purchaseLineId || e.purchaseChargeId) {
         if (!await _purOfferWithdraw(e)) return;
         let pur;
```

**Modify:** `js/portal-app.compiled.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/portal-app.compiled.js b/js/portal-app.compiled.js
index 0cf79e2..22b8355 100644
--- a/js/portal-app.compiled.js
+++ b/js/portal-app.compiled.js
@@ -139,6 +139,11 @@ const peso = (n, opts = {}) => {
   return n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
 };
 const _staff = () => typeof window !== "undefined" && window.currentUserRole === "staff";
+// 2C (0105): a stock cost move the main owner approved — its value is for owner
+// accounts only, so staff see the row (and its state) but never its pesos, and
+// their subtotals leave it out. Every total that is Spent still counts it.
+const _hideStockCost = (m) => _staff() && (m._parts || [m]).some((p) => p.stkCostMoveId);
+const _shownAmount = (m) => _hideStockCost(m) ? 0 : Number(m.amount) || 0;
 // Project Control financial shortcuts recheck the role when invoked as well as
 // when rendered. Encoding in the separate Expenses module is unchanged.
 const _pcMoneyAction = (action) => (...args) => { if (!_staff()) return action(...args); };
@@ -314,6 +319,9 @@ function mapExpenseDoc(d) {
     splitTotal: Number(d.splitTotal) || 0,
     purchaseLineId: d.purchaseLineId || null,
     purchaseChargeId: d.purchaseChargeId || null,
+    // 2C (0105): a row an approved stock cost move wrote — read-only; the main
+    // owner reverses the cost move in Requests → Stock.
+    stkCostMoveId: d.stkCostMoveId || null,
     docs,
     docUrls,
     receipts,
@@ -3280,12 +3288,12 @@ function MaterialDrill({ project, onBack, materialTx, childMonths, activeFolder,
       const n = billingByProjectId.get(p.projectId);
       return n ? "Billing #" + n : "Billing period";
     };
-    const parts = m._parts.map((p, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: p.id || i }, i > 0 && " \xB7 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)", fontWeight: 600 } }, label(p)), " ₱" + peso(p.amount)));
+    const parts = m._parts.map((p, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: p.id || i }, i > 0 && " \xB7 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)", fontWeight: 600 } }, label(p)), _hideStockCost(m) ? "" : " ₱" + peso(p.amount)));
     return /* @__PURE__ */ React.createElement(React.Fragment, null, parts, m._partial && " \xB7 part of a larger expense");
   };
   // A purchase (0096) is edited / voided as a whole. An older split is changed
   // part by part, from the details window.
-  const isOldSplit = (m) => !!m._parts && !(window.expIsPurchaseRow && window.expIsPurchaseRow(m));
+  const isOldSplit = (m) => !!m._parts && !(window.expIsPurchaseRow && window.expIsPurchaseRow(m)) && !(window.expIsStockCostRow && window.expIsStockCostRow(m));
   // "From purchase" (0096: edit / void it as a purchase) and "Office review"
   // (its month had no billing period, so it sits on Cover until the office
   // reviews it). The review flags load separately — re-render when they land.
@@ -3298,6 +3306,9 @@ function MaterialDrill({ project, onBack, materialTx, childMonths, activeFolder,
   }, []);
   const tagStyle = (bg, color, border) => ({ display: "inline-flex", alignItems: "center", padding: "1px 7px", borderRadius: 999, background: bg, color, fontSize: 10.5, fontWeight: 700, border: "1px solid " + border, whiteSpace: "nowrap" });
   const purchaseTags = (m) => {
+    if (window.expIsStockCostRow && window.expIsStockCostRow(m)) {
+      return /* @__PURE__ */ React.createElement("span", { title: "Moved from stock — the main owner approved where its cost goes. Only the main owner reverses it (Requests → Stock).", style: tagStyle("#f0f9ff", "#0369a1", "#bae6fd") }, "Stock cost move");
+    }
     if (!(window.expIsPurchaseRow && window.expIsPurchaseRow(m))) return null;
     const review = typeof window.expPurNeedsReview === "function" && (m._parts || [m]).some((p) => window.expPurNeedsReview(p.purchaseLineId));
     // 2A-3a (Q16): a change this account sent to the owner, not yet decided.
@@ -3381,7 +3392,7 @@ function MaterialDrill({ project, onBack, materialTx, childMonths, activeFolder,
     const flat = [];
     order.forEach((cat) => {
       const items = byCat.get(cat) || [];
-      const total = items.reduce((s, m) => s + (Number(m.amount) || 0), 0);
+      const total = items.reduce((s, m) => s + _shownAmount(m), 0);
       const pctContract = project.revenue > 0 ? total / project.revenue * 100 : 0;
       flat.push({ kind: "header", cat, total, pctContract, count: items.length });
       items.forEach((m) => flat.push({ kind: "item", m }));
@@ -3445,7 +3456,7 @@ function MaterialDrill({ project, onBack, materialTx, childMonths, activeFolder,
     }
     const m = row.m;
     const billingNum = billingByProjectId.get(m.projectId);
-    return /* @__PURE__ */ React.createElement("tr", { key: m.id || i, className: "row", onClick: () => setDetailsItem(m), title: "Click to view item details" }, /* @__PURE__ */ React.createElement("td", { style: { fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "nowrap" } }, fmtDateTime(m.dateTime || m.date)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { className: "name" }, m.name), /* @__PURE__ */ React.createElement(PaymentTag, { method: m.paymentMethod }), purchaseTags(m)), (billingNum || m._parts) && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5 } }, /* @__PURE__ */ React.createElement("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })), "Charged to \xB7 ", m._parts ? splitChargedTo(m) : /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)", fontWeight: 600 } }, "Billing #", billingNum))),/* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--ink-2)" } }, m.category || "\u2014")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "pc-docs-row", title: "Purchase Order \xB7 Delivery Receipt \xB7 Supplier Invoice \xB7 Payment Receipt" }, /* @__PURE__ */ React.createElement(DocPill, { m, k: "po", label: "PO", title: "Purchase Order" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "dr", label: "DR", title: "Delivery Receipt" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "si", label: "SI", title: "Supplier Invoice" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "pay", label: "PR", title: "Payment Receipt" }))), /* @__PURE__ */ React.createElement("td", { className: "right" }, /* @__PURE__ */ React.createElement("span", { className: "amt" }, ["\u20B1 ", peso(m.amount)]), _staff() ? null : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 } }, project.revenue > 0 ? (Number(m.amount) / project.revenue * 100).toFixed(2) + "% of contract" : "\u2014")), /* @__PURE__ */ React.createElement("td", { onClick: (e) => e.stopPropagation() }, !_staff() && (m.firstReceipt || m.lazyImages) ? /* @__PURE__ */ React.createElement(LazyReceiptThumb, { m, onOpen: openReceiptThumb }) : /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db", fontSize: 11 } }, "\u2014")), /* @__PURE__ */ React.createElement("td", null, !_staff() && /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "Print receipt for this material expense", onClick: (e) => {
+    return /* @__PURE__ */ React.createElement("tr", { key: m.id || i, className: "row", onClick: () => setDetailsItem(m), title: "Click to view item details" }, /* @__PURE__ */ React.createElement("td", { style: { fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "nowrap" } }, fmtDateTime(m.dateTime || m.date)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { className: "name" }, m.name), /* @__PURE__ */ React.createElement(PaymentTag, { method: m.paymentMethod }), purchaseTags(m)), (billingNum || m._parts) && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5 } }, /* @__PURE__ */ React.createElement("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })), "Charged to \xB7 ", m._parts ? splitChargedTo(m) : /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)", fontWeight: 600 } }, "Billing #", billingNum))),/* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--ink-2)" } }, m.category || "\u2014")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "pc-docs-row", title: "Purchase Order \xB7 Delivery Receipt \xB7 Supplier Invoice \xB7 Payment Receipt" }, /* @__PURE__ */ React.createElement(DocPill, { m, k: "po", label: "PO", title: "Purchase Order" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "dr", label: "DR", title: "Delivery Receipt" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "si", label: "SI", title: "Supplier Invoice" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "pay", label: "PR", title: "Payment Receipt" }))), /* @__PURE__ */ React.createElement("td", { className: "right" }, /* @__PURE__ */ React.createElement("span", { className: "amt" }, _hideStockCost(m) ? "—" : ["\u20B1 ", peso(m.amount)]), _staff() ? null : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 } }, project.revenue > 0 ? (Number(m.amount) / project.revenue * 100).toFixed(2) + "% of contract" : "\u2014")), /* @__PURE__ */ React.createElement("td", { onClick: (e) => e.stopPropagation() }, !_staff() && (m.firstReceipt || m.lazyImages) ? /* @__PURE__ */ React.createElement(LazyReceiptThumb, { m, onOpen: openReceiptThumb }) : /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db", fontSize: 11 } }, "\u2014")), /* @__PURE__ */ React.createElement("td", null, !_staff() && /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "Print receipt for this material expense", onClick: (e) => {
       e.stopPropagation();
       printMaterialReceipt(m);
     } }, Ico.receipt || "\u{1F9FE}"), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: isOldSplit(m) ? "Edit \u2014 choose which part" : "Edit", onClick: (e) => {
@@ -3476,7 +3487,7 @@ function ItemDetailsModal({ item, billingNum, billingOf, onClose, onOpenImage, o
   const partsList = item._parts ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, item._parts.map((p, i) => {
     const n = p.projectId && billingOf ? billingOf(p.projectId) : null;
     const btn = { padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #e5e7eb", background: "#fff", color: "#374151" };
-    return /* @__PURE__ */ React.createElement("div", { key: p.id || i, style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("b", null, !p.projectId ? "No billing period" : n ? "Billing #" + n : "Billing period"), /* @__PURE__ */ React.createElement("span", null, "\u20B1 ", peso(p.amount)), p.coverExpense && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#b45309", fontWeight: 600 } }, "Cover"), oldSplit && /* @__PURE__ */ React.createElement("button", { type: "button", style: btn, onClick: () => {
+    return /* @__PURE__ */ React.createElement("div", { key: p.id || i, style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("b", null, !p.projectId ? "No billing period" : n ? "Billing #" + n : "Billing period"), /* @__PURE__ */ React.createElement("span", null, _hideStockCost(m) ? "" : ["\u20B1 ", peso(p.amount)]), p.coverExpense && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#b45309", fontWeight: 600 } }, "Cover"), oldSplit && /* @__PURE__ */ React.createElement("button", { type: "button", style: btn, onClick: () => {
       onClose();
       window.openEditExpenseModal && window.openEditExpenseModal(p.id);
     } }, "Edit"), oldSplit && /* @__PURE__ */ React.createElement("button", { type: "button", style: { ...btn, color: "#b91c1c", borderColor: "#fecaca" }, onClick: () => {
@@ -3519,7 +3530,7 @@ function ItemDetailsModal({ item, billingNum, billingOf, onClose, onOpenImage, o
     }
   };
   const Row = ({ label, children }) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #f3f4f6" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 130, fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 } }, label), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, fontSize: 14, color: "#111827" } }, children));
-  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" } }, /* @__PURE__ */ React.createElement("div", { onClick: (e) => e.stopPropagation(), style: { background: "#fff", borderRadius: 14, maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, position: "sticky", top: 0, background: "#fff", zIndex: 1, borderRadius: "14px 14px 0 0" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#6b7280", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 } }, "Item Details"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "#111827", wordBreak: "break-word" } }, m.name)), /* @__PURE__ */ React.createElement("button", { onClick: onClose, "aria-label": "Close", style: { background: "#f3f4f6", border: "none", width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: "pointer", color: "#6b7280", lineHeight: 1, flexShrink: 0 } }, "\xD7")), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 24px 20px" } }, /* @__PURE__ */ React.createElement(Row, { label: "Amount" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 700, color: "#1A5C3A" } }, "\u20B1 ", peso(m.amount))), /* @__PURE__ */ React.createElement(Row, { label: "Date & Time" }, fmtDateTime(m.dateTime || m.date)), /* @__PURE__ */ React.createElement(Row, { label: "Category" }, m.category || /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db" } }, "\u2014")), /* @__PURE__ */ React.createElement(Row, { label: "Payment" }, /* @__PURE__ */ React.createElement(PaymentTag, { method: m.paymentMethod }), " ", !m.paymentMethod && /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db" } }, "\u2014")), m.quantity > 1 && /* @__PURE__ */ React.createElement(Row, { label: "Quantity" }, m.quantity), partsList ? /* @__PURE__ */ React.createElement(Row, { label: "Charged To" }, partsList) : billingNum && /* @__PURE__ */ React.createElement(Row, { label: "Charged To" }, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })), /* @__PURE__ */ React.createElement("b", null, "Billing #", billingNum))), /* @__PURE__ */ React.createElement(Row, { label: "Documents" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, docOrder.map((o) => {
+  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" } }, /* @__PURE__ */ React.createElement("div", { onClick: (e) => e.stopPropagation(), style: { background: "#fff", borderRadius: 14, maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, position: "sticky", top: 0, background: "#fff", zIndex: 1, borderRadius: "14px 14px 0 0" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#6b7280", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 } }, "Item Details"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "#111827", wordBreak: "break-word" } }, m.name)), /* @__PURE__ */ React.createElement("button", { onClick: onClose, "aria-label": "Close", style: { background: "#f3f4f6", border: "none", width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: "pointer", color: "#6b7280", lineHeight: 1, flexShrink: 0 } }, "\xD7")), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 24px 20px" } }, /* @__PURE__ */ React.createElement(Row, { label: "Amount" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 700, color: "#1A5C3A" } }, _hideStockCost(m) ? "—" : ["\u20B1 ", peso(m.amount)])), /* @__PURE__ */ React.createElement(Row, { label: "Date & Time" }, fmtDateTime(m.dateTime || m.date)), /* @__PURE__ */ React.createElement(Row, { label: "Category" }, m.category || /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db" } }, "\u2014")), /* @__PURE__ */ React.createElement(Row, { label: "Payment" }, /* @__PURE__ */ React.createElement(PaymentTag, { method: m.paymentMethod }), " ", !m.paymentMethod && /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db" } }, "\u2014")), m.quantity > 1 && /* @__PURE__ */ React.createElement(Row, { label: "Quantity" }, m.quantity), partsList ? /* @__PURE__ */ React.createElement(Row, { label: "Charged To" }, partsList) : billingNum && /* @__PURE__ */ React.createElement(Row, { label: "Charged To" }, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })), /* @__PURE__ */ React.createElement("b", null, "Billing #", billingNum))), /* @__PURE__ */ React.createElement(Row, { label: "Documents" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, docOrder.map((o) => {
     const has = !!(m.docs && m.docs[o.k]);
     return /* @__PURE__ */ React.createElement("span", { key: o.k, title: o.label, style: { padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", background: has ? "#dcfce7" : "#f3f4f6", color: has ? "#166534" : "#9ca3af", border: "1px solid", borderColor: has ? "#86efac" : "#e5e7eb" } }, o.k === "pay" ? "PR" : o.k.toUpperCase(), " ", has ? "\u2713" : "\u2014");
   }))), m.notes && /* @__PURE__ */ React.createElement(Row, { label: "Notes" }, /* @__PURE__ */ React.createElement("div", { style: { whiteSpace: "pre-wrap", color: "#374151" } }, m.notes)), m.ref && /* @__PURE__ */ React.createElement(Row, { label: "Reference" }, /* @__PURE__ */ React.createElement("code", { style: { fontSize: 12, color: "#6b7280" } }, m.ref)), !full && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 18, fontSize: 12.5, color: "#9ca3af" } }, "Loading attachments…"), allImages.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 } }, "Attachments (", allImages.length, ")"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 } }, allImages.map((img, i) => /* @__PURE__ */ React.createElement("div", { key: i, onClick: () => openImg(img.url, img.label), style: { cursor: "pointer", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", background: "#f9fafb" } }, /* @__PURE__ */ React.createElement("img", { src: img.url, alt: img.label, loading: "lazy", style: { width: "100%", height: 90, objectFit: "cover", display: "block" } }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "#6b7280", padding: "4px 6px", textAlign: "center" } }, img.label)))))), /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 24px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 8, justifyContent: "flex-end", position: "sticky", bottom: 0, background: "#fff", borderRadius: "0 0 14px 14px" } }, !_staff() && /* @__PURE__ */ React.createElement("button", { onClick: _pcMoneyAction(() => onPrint && onPrint(m)), style: { padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" } }, "Print Receipt"), !oldSplit && /* @__PURE__ */ React.createElement("button", { onClick: () => {
```

**Modify:** `js/purchasing-admin-core.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-core.js b/js/purchasing-admin-core.js
index 3e9ffa2..3e4f02c 100644
--- a/js/purchasing-admin-core.js
+++ b/js/purchasing-admin-core.js
@@ -688,6 +688,10 @@
         BAD_QUANTITY: 'Enter a quantity above 0 (at most 3 decimals) and no more than what is left.',
         BAD_NOTE: 'Keep the note to 300 characters.',
         LINE_CLOSED: 'This item was cancelled. Reload the list.',
+        // Stock (0104) and stock cost moves (0105): a correction or re-fund the stock in it does not allow.
+        STOCK_IN_USE: 'This purchase line has stock records. Reverse them first (Requests → Stock), or keep its destination, project, unit and enough quantity.',
+        STOCK_COST_IN_USE: 'The owner approved stock cost moves that rely on this purchase line\'s price and quantity. The main owner reverses them first.',
+        STOCK_COST_FUNDING: 'The owner approved stock cost moves that rely on where this purchase\'s cost sits (its billing periods and Cover). The main owner reverses them first.',
         REDUCTION_PENDING: 'A reduction is waiting on this quantity. Resolve it in the request first.',
         BOUGHT: 'Something was already bought for this quantity, so it stays in its weekly batch.',
         BAD_REQUEST_LINK: 'A purchase line must go to the same project and work (Main Contract or Additional Works) as its request.',
```

**Modify:** `js/purchasing-admin-list.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-list.js b/js/purchasing-admin-list.js
index 68f6ed4..4b1fed3 100644
--- a/js/purchasing-admin-list.js
+++ b/js/purchasing-admin-list.js
@@ -8,7 +8,9 @@
 //   Purchases        — js/purchasing-admin-purchases.js;
 //   Owner approvals  — js/purchasing-admin-purchases.js;
 //   Cash             — js/purchasing-admin-cash.js (0102): the main owner's
-//                      petty-cash tracker, or a buyer's own cash.
+//                      petty-cash tracker, or a buyer's own cash;
+//   Company stock    — owner accounts, once stock is on (2C, 0105):
+//                      js/stock-cost-admin.js.
 // "Record purchase" (js/purchasing-admin-record.js) opens from the list
 // with the ticked lines.
 // 0104: a line whose catalogue item is in the warehouse says so ("In
@@ -32,7 +34,13 @@
     function tabs() {
         const t = (id, label) => '<button type="button" class="att-seg-btn' + (ui.tab === id ? ' is-on' : '') + '" data-tab="' + id + '">' + label + '</button>';
         return '<div class="att-seg" role="tablist" aria-label="Purchasing">' +
-            t('list', 'Shopping list') + t('purchases', 'Purchases') + t('approvals', 'Owner approvals') + t('cash', 'Cash') + '</div>';
+            t('list', 'Shopping list') + t('purchases', 'Purchases') + t('approvals', 'Owner approvals') + t('cash', 'Cash') +
+            (companyStockTab() ? t('company', 'Company stock') : '') + '</div>';
+    }
+
+    // 2C: the value of company stock — owner accounts, once stock is on.
+    function companyStockTab() {
+        return !!(root.StockCostAdmin && root.currentStockOn && PA.ui.isOwner);
     }
 
     // Needed · Bought · Still to buy, as three blocks the eye can compare.
@@ -232,6 +240,7 @@
         host.innerHTML = '<div class="att-stack pur-tab req-detail"><div class="att-empty">Loading…</div></div>';
         let me;
         try { me = await PA.me(); } catch (e) { RA.fail(host, e); return; }
+        ui.isOwner = !!me.isOwner;
         if (!me.canBuy) {
             host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' +
                 esc(PA.ERRORS.BUYER_REQUIRED) + '</div></div></div>';
@@ -252,6 +261,7 @@
         if (ui.tab === 'approvals') return PA.renderApprovals(host.querySelector('[data-body]'), me);
         if (ui.tab === 'record') return PA.renderRecord(host.querySelector('[data-body]'), me);
         if (ui.tab === 'cash' && PA.renderCash) return PA.renderCash(host.querySelector('[data-body]'), me);
+        if (ui.tab === 'company' && companyStockTab()) return root.StockCostAdmin.renderCompanyStock(host.querySelector('[data-body]'));
         return renderList(host, me);
     }
 
```

**Modify:** `js/purchasing-admin-purchases.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-purchases.js b/js/purchasing-admin-purchases.js
index 26103fc..66bf42d 100644
--- a/js/purchasing-admin-purchases.js
+++ b/js/purchasing-admin-purchases.js
@@ -305,12 +305,16 @@
               (r.status === 'pending' && !me.isOwner && r.requested_by === me.userId ? '<button type="button" class="att-btn att-btn--sm" data-withdraw="' + esc(r.id) + '">Withdraw</button>' : '') +
             '</div></div></div>';
         body.innerHTML =
+            // 2C (0105): stock cost moves waiting for the main owner — js/stock-cost-admin.js (empty for anyone else, or with stock off).
+            (me.isOwner && root.StockCostAdmin ? '<div data-stock-costs></div>' : '') +
             '<p class="req-muted">' + (me.isOwner
                 ? 'Changes your staff asked for that only you can make. Approving applies exactly the "Asked for" column, through the normal correction — and only while the purchase still reads as it did when they asked.'
                 : 'Changes you sent to the owner.') + '</p>' +
             (pending.length ? pending.map(card).join('') : '<div class="att-empty">Nothing is waiting.</div>') +
             (decided.length ? '<h3 class="pur-h3">Decided</h3>' + decided.map(card).join('') : '');
         const reload = () => renderApprovals(body, me);
+        const costs = body.querySelector('[data-stock-costs]');
+        if (costs) root.StockCostAdmin.renderApprovals(costs);
         body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => PA.openPurchase(b.dataset.open)));
         const approve = async (id) => {
             const res = await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: id, p_approve: true, p_note: null });
```

**Modify:** `js/stock-admin.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/stock-admin.js b/js/stock-admin.js
index 0a1ff4e..7a94cd3 100644
--- a/js/stock-admin.js
+++ b/js/stock-admin.js
@@ -13,8 +13,11 @@
 // Goods are issued oldest RECEIVED first (each delivery is its own layer,
 // dated the day it arrived); one item's screen lists them in that order.
 //
-// QUANTITIES ONLY: no peso amount is read or shown here — the value of
-// stock and every cost move are Stage 2C (main owner). Owner and office
+// QUANTITIES ONLY: no peso amount is read or shown here. Since 2C (0105)
+// each record lists its cost moves — "Cost assignment pending", "Cost
+// transferred"… — as states; their values (owner accounts) and the main
+// owner's Approve / Reject / Reverse cost, and a recorder's Ask again, are
+// js/stock-cost-admin.js (window.StockCostAdmin). Owner and office
 // staff allowed Expenses use it (Buyer staff are office staff); the nav
 // hides it until the main owner switches stock on (launch), and shows the
 // main owner the switch. Every rule is the server's (0104); this file only
@@ -119,6 +122,44 @@
         return r.recorded_by === me.userId || me.isOwner;
     }
 
+    // ── Cost moves (0105): states only ──────────────────────────────
+
+    // A cost move's state as a pill: [text, tone].
+    function costState(c) {
+        if (c.status === 'pending') {
+            return [c.kind === 'assign' ? 'Cost assignment pending' : c.kind === 'transfer' ? 'Cost transfer pending'
+                    : 'Back to company stock — pending', 'working'];
+        }
+        if (c.status === 'rejected') return ['Cost move rejected — kept with source', 'abandoned'];
+        if (c.status === 'withdrawn') return ['Cost request withdrawn', 'abandoned'];
+        if (c.reversed) return ['Cost move reversed', 'abandoned'];
+        return [c.kind === 'assign' ? 'Cost assigned' : c.kind === 'transfer' ? 'Cost transferred'
+                : c.kind === 'back' ? 'Cost back in company stock' : 'Company stock loss', 'done'];
+    }
+
+    // "4 bag: Company stock → Barlin" — what moved and whose cost.
+    function costText(c, unit) {
+        const q = c.status === 'approved' ? c.approved_quantity : c.quantity;
+        return qty(q) + (unit ? ' ' + unit : '') + ': ' + (c.from_name || '') + ' → ' + (c.to_name || '');
+    }
+
+    // Ask again: a rejected or reversed one, while nothing else is open for
+    // the same movement (costs = the record's cost moves).
+    function canResubmit(c, costs) {
+        if (!(c.status === 'rejected' || (c.status === 'approved' && c.reversed && c.kind !== 'loss'))) return false;
+        return !(costs || []).some(x => x.id !== c.id && x.move_id === c.move_id
+                                     && (x.status === 'pending' || (x.status === 'approved' && !x.reversed)));
+    }
+
+    // me = { isMainOwner }: decide a pending one; reverse an approved one (a loss goes with its count).
+    function costActions(c, me, costs, canRecord) {
+        const out = [];
+        if (me.isMainOwner && c.status === 'pending') out.push('approve', 'reject');
+        if (me.isMainOwner && c.status === 'approved' && !c.reversed && c.kind !== 'loss') out.push('reverse');
+        if (canRecord && canResubmit(c, costs)) out.push('resubmit');
+        return out;
+    }
+
     // Places to pick: the warehouse, then each project (completed ones last,
     // marked — goods can still be recorded there, Q16).
     function placeOptions(choices) {
@@ -229,6 +270,8 @@
         STALE_COUNT: 'The books changed since this count. Reject it, then count again.',
         STOCK_IN_USE: 'This purchase line has stock records. Reverse them first, or keep its destination, project, unit and enough quantity.',
         MOVED_ON: 'Those goods have moved on. Reverse the later records first.',
+        COST_MOVED: 'The main owner approved this movement\'s cost. The main owner reverses that cost move first.',
+        STOCK_COST_IN_USE: 'The owner approved cost moves that rely on this purchase line as it stands. Reverse them first.',
         RETURNS_FIRST: 'Part of this issue came back. Reverse that return first.',
         NOT_YOURS: 'Only the person who recorded this, or an owner, can reverse it.',
         OWN_PURCHASE: 'Another unit is checked by the office — never by whoever recorded or bought the purchase.',
@@ -266,6 +309,7 @@
     }
 
     const pure = { KIND_LABEL, COUNT_REASONS, qty, parseQty, recordState, recordText, requestText, countDifference, canReverse, layerText,
+                   costState, costText, canResubmit, costActions,
                    placeOptions, itemLabel, needsMatch, matchProblems, moveProblems, moveBody, moveKind, countProblems,
                    ERRORS, errorMessage, localDay };
 
@@ -288,7 +332,7 @@
     // Who is looking, from the server (stk_status).
     function me() {
         const s = cache.status || {};
-        return { userId: s.user_id, isOwner: !!s.is_owner, isMainOwner: !!s.is_main_owner };
+        return { userId: s.user_id, isOwner: !!s.is_owner, isMainOwner: !!s.is_main_owner, canRecord: !!s.can_record };
     }
 
     function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }
@@ -667,6 +711,7 @@
                 (r.decided_by_name ? ' · ' + esc(r.status === 'rejected' ? 'rejected' : r.status === 'withdrawn' ? 'withdrawn' : 'confirmed') + ' by ' + esc(r.decided_by_name) +
                   (r.decision_note ? ': ' + esc(r.decision_note) : '') : '') +
                 (r.reversed ? ' · reversed by ' + esc(r.reversed_by_name) + ': ' + esc(r.reverse_reason) : '') + '</div>' +
+              (r.costs || []).map(c => costLine(c, r, m)).join('') +
             '</div>' +
             '<div class="stk-rec-acts">' +
               (r.kind === 'issue' && Number(r.returnable) > 0 ? '<button type="button" class="att-btn att-btn--sm" data-rec-act="return">Return…</button>' : '') +
@@ -676,6 +721,23 @@
             '</div></div>';
     }
 
+    // One cost move under its record: its state, and (owner accounts) its
+    // value from js/stock-cost-admin.js; the buttons open that file's forms.
+    function costLine(c, r, m) {
+        const st = costState(c);
+        const SC = root.StockCostAdmin;
+        const v = SC ? SC.valueText(c) : '';
+        const acts = SC ? costActions(c, m, r.costs, m.canRecord) : [];
+        const label = { approve: 'Approve…', reject: 'Reject…', reverse: 'Reverse cost…', resubmit: 'Ask again…' };
+        const why = c.reversed ? c.reverse_reason : c.status === 'pending' ? c.note : c.decision_note;
+        return '<div class="stk-cost" data-cost="' + esc(c.id) + '">' + pill(st[0], st[1]) + ' <span>' + esc(costText(c, r.item_unit)) + '</span>' +
+            (v ? ' <strong>' + esc(v) + '</strong>' : '') +
+            (why ? ' <span class="req-muted">· ' + esc(why) + '</span>' : '') +
+            (acts.length ? '<span class="stk-cost-acts">' + acts.map(a => '<button type="button" class="att-btn att-btn--sm' +
+                (a === 'approve' ? ' att-btn--primary' : '') + '" data-cost-act="' + a + '">' + label[a] + '</button>').join('') + '</span>' : '') +
+            '</div>';
+    }
+
     function itemCard(i) {
         return '<div class="att-card stk-item" data-item="' + esc(i.item_id) + '"><div class="att-card-body">' +
             '<div class="stk-item-head"><strong>' + esc(i.name) + '</strong>' + (i.spec ? ' <span class="req-muted">' + esc(i.spec) + '</span>' : '') +
@@ -738,6 +800,17 @@
             if (act === 'reject') return openDecide(r, false, reload);
             if (act === 'return') return openMove({ itemId: r.item_id, returnsRecord: r.id, returnFrom: r.to_name, quantity: r.returnable }, reload);
         }));
+        scope.querySelectorAll('[data-cost-act]').forEach(b => b.addEventListener('click', () => {
+            const r = records.find(x => x.id === b.closest('[data-record]').dataset.record);
+            const c = r && (r.costs || []).find(x => x.id === b.closest('[data-cost]').dataset.cost);
+            const SC = root.StockCostAdmin;
+            if (!c || !SC) return;
+            const act = b.dataset.costAct;
+            if (act === 'approve') return SC.openDecide(c, true, reload, r.item_unit);
+            if (act === 'reject') return SC.openDecide(c, false, reload, r.item_unit);
+            if (act === 'reverse') return SC.openReverse(c, reload, r.item_unit);
+            if (act === 'resubmit') return SC.openResubmit(c, reload, r.item_unit);
+        }));
     }
 
     async function render(host) {
@@ -750,7 +823,7 @@
         const reload = () => render(host);
         host.innerHTML =
             '<div class="att-stack stk-tab req-detail">' +
-              RA.head('Stock', 'Where goods are, in catalogue units. Quantities only — values come with owner-confirmed cost moves.', tabs()) +
+              RA.head('Stock', 'Where goods are, in catalogue units. When goods reach someone else\'s project, the main owner approves where their cost goes.', tabs()) +
               actions() +
               '<div data-body><div class="att-empty">Loading…</div></div>' +
             '</div>';
@@ -782,9 +855,12 @@
             }));
         } else if (ui.tab === 'pending') {
             body.innerHTML = (ov.pending.length ? '<div class="stk-recs">' + ov.pending.map(r => recordRow(r, m)).join('') + '</div>'
-                : '<div class="att-empty">Nothing is waiting for the owner.</div>') +
-                (m.isMainOwner ? '' : '<p class="req-muted">Only the main owner confirms counts and opening stock.</p>');
+                : '<div class="att-empty">No count or opening stock is waiting for the owner.</div>') +
+                (m.isMainOwner ? '<div data-costs></div>'
+                    : '<p class="req-muted">Only the main owner confirms counts and opening stock, and approves where moved goods\' cost goes.</p>');
             wireRecords(body, ov.pending, reload);
+            // 2C: the main owner's pending cost moves, the same cards as Purchasing → Owner approvals.
+            if (m.isMainOwner && root.StockCostAdmin) root.StockCostAdmin.renderApprovals(body.querySelector('[data-costs]'));
         } else if (ui.tab === 'history') {
             body.innerHTML = ov.recent.length ? '<div class="stk-recs">' + ov.recent.map(r => recordRow(r, m)).join('') + '</div>'
                 : '<div class="att-empty">No stock records yet.</div>';
```

**Create:** `js/stock-cost-admin.js`

```js
// ════════════════════════════════════════════════════════════════════
// Stock cost moves (WorkMate Stage 2C, migration 0105).
//
// Moving goods never moves their cost by itself. When goods arrive where
// someone else holds their cost — company stock issued to a project, one
// project's goods moved to another, a company lot brought back to the
// warehouse — the server asks the MAIN OWNER (stk_cost_*):
//   Owner approvals (Purchasing tab) — renderApprovals: one card per
//     pending cost move, with what it would cost each side; Approve /
//     Reject with a reason;
//   Company stock (Purchasing tab, owner accounts) — renderCompanyStock:
//     in the warehouse, issued with the assignment pending, awaiting
//     delivery, and company stock loss;
//   the Stock screen's records (js/stock-admin.js) show each cost move's
//     state and offer Approve / Reject / Ask again / Reverse cost through
//     openDecide / openResubmit / openReverse below.
//
// PESOS: the server sends a value only to owner accounts (Q28); for anyone
// else the keys are missing and nothing is shown. Approval writes ordinary
// expense rows (expenses.stk_cost_move_id) — the server's, never this
// file's; company stock is never in a project's Spent. Every rule is the
// server's (0105); this file only explains. Each form sends one operation
// id, kept across retries of the same form, so a double press records once.
//
// Works in a browser (window.StockCostAdmin) and in Node for
// tests/stock-cost-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    function peso(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return (x < 0 ? '−' : '') + '₱' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function qty(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }

    // What a cost move is worth, for an owner account: the approved value,
    // or the estimate for what a pending one still covers. '' otherwise.
    function valueText(c) {
        if (!c) return '';
        if (c.value !== undefined && c.value !== null) return peso(c.value);
        if (c.estimate !== undefined && c.estimate !== null) return 'about ' + peso(c.estimate);
        return '';
    }

    // Each billing period (or Cover) the giving project's cost comes off.
    function groupText(g) {
        const where = g.cover ? 'Cover' : (g.billing_number ? 'Billing #' + g.billing_number : 'Billing period') +
            (g.month ? ' (' + g.month + (g.year ? ' ' + g.year : '') + ')' : '');
        return where + ' carries ' + peso(g.carries);
    }

    const ERRORS = {
        STOCK_OFF: 'Stock is not switched on yet.',
        OWNER_ONLY: 'Only the main owner approves, rejects or reverses cost moves.',
        NOT_ALLOWED: 'Only the main owner approves, rejects or reverses cost moves.',
        NOTHING_LEFT: 'These goods are no longer there, so there is nothing to charge. Reject it with a reason.',
        COMPLETED_PROJECT: 'One of the projects is completed. Reopen it first — the goods\' record stays as it is.',
        LATER_MOVES_FIRST: 'Later movements or cost moves rely on this one. Reverse those first.',
        COST_BASIS: 'The cost is not where the server expected. Reload the page.',
        REASON_REQUIRED: 'Please give a reason.',
        BAD_STATE: 'This was already decided, withdrawn or reversed. Reload the page.',
        NOT_FOUND: 'That was not found. Reload the page.',
        NOT_OFFICE: 'Only owner and office accounts can ask again.',
        BAD_OP: 'Something went wrong. Close the form and try again.',
        PGRST202: 'Cost moves are not installed on the server yet.',
    };

    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) return ERRORS[code];
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    const pure = { peso, qty, valueText, groupText, ERRORS, errorMessage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser ─────────────────────────────────────────────────────

    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const SA = () => root.StockAdmin || {};

    const newOp = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    function sendOnce(fn) {
        const opId = newOp();
        return (...args) => fn(opId, ...args);
    }

    function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }
    const stateOf = (c) => (SA().costState ? SA().costState(c) : null);
    const lineOf = (c, unit) => (SA().costText ? SA().costText(c, unit) : '');

    // Approve (the whole of what is still there) or reject with a reason.
    function openDecide(c, approve, onDone, unit) {
        const send = sendOnce((opId, note) => RA.rpc('stk_cost_decide', { p_op: opId, p_cost: c.id, p_approve: approve, p_note: note }));
        const v = valueText(c);
        RA.modal({
            title: approve ? 'Approve cost move' : 'Reject cost move',
            sub: lineOf(c, unit) + (approve && v ? ' — ' + v : '') +
                (approve ? '. The whole of what is still there; it cannot be edited afterwards, only reversed.'
                         : '. The goods stay recorded where they are; the cost stays where it was.'),
            warn: !approve,
            body: '<div class="stk-form"><label class="att-label">' + (approve ? 'Note (optional)' : 'Reason (the recorder sees this)') +
                '<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: approve ? 'Approve' : 'Reject',
            errorMessage,
            onSubmit: async (form) => {
                if (!approve && !form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.note.value.trim());
            },
            onDone,
        });
    }

    // A stock recorder asks again for the same movement (after a rejection
    // or a reversal) — no second physical record.
    function openResubmit(c, onDone, unit) {
        const send = sendOnce((opId, note) => RA.rpc('stk_cost_resubmit', { p_op: opId, p_cost: c.id, p_note: note }));
        RA.modal({
            title: 'Ask the owner again',
            sub: lineOf(c, unit) + '. Say what changed (the evidence, the right project).',
            body: '<div class="stk-form"><label class="att-label">Note<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: 'Ask again',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.note.value.trim());
            },
            onDone,
        });
    }

    // The main owner takes an approved cost move back: its expense rows leave
    // Spent; the record and the reason stay.
    function openReverse(c, onDone, unit) {
        const send = sendOnce((opId, reason) => RA.rpc('stk_cost_reverse', { p_op: opId, p_cost: c.id, p_reason: reason }));
        RA.modal({
            title: 'Reverse cost move',
            sub: lineOf(c, unit) + (valueText(c) ? ' — ' + valueText(c) : '') + '. Its rows leave Spent; the record stays, marked reversed.',
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: 'Reverse',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }

    // ── Purchasing → Owner approvals: pending cost moves ────────────

    function approvalCard(c) {
        const st = stateOf(c);
        const shrunk = Number(c.effective) < Number(c.quantity);
        return '<div class="att-card" data-cost="' + esc(c.id) + '"><div class="att-card-body">' +
            '<div><strong>' + esc(c.item_name) + '</strong> ' + (st ? pill(st[0], st[1]) : '') + '</div>' +
            '<div>' + esc(qty(c.effective)) + ' ' + esc(c.item_unit || '') + ': ' + esc(c.from_name) + ' → ' + esc(c.to_name) +
              (valueText(c) ? ' · <strong>' + esc(valueText(c)) + '</strong>' : '') + '</div>' +
            (shrunk ? '<div class="att-info att-info--warn"><i data-lucide="info"></i><div>' +
                (Number(c.effective) > 0 ? 'Only ' + esc(qty(c.effective)) + ' of the ' + esc(qty(c.quantity)) + ' are still there — approving charges those only.'
                                         : 'None of these goods are still there. Reject it with a reason.') + '</div></div>' : '') +
            (c.to_folder ? '<div class="req-muted">' + esc(c.to_name) + ': funded like a purchase for ' + esc(RA.formatDay(c.received_on)) +
                ' — its billing periods for that month, earliest first, the rest Cover.</div>' : '') +
            ((c.from_groups || []).length ? '<div class="req-muted">Off ' + esc(c.from_name) + ', in proportion: ' +
                c.from_groups.map(g => esc(groupText(g))).join(' · ') + '</div>' : '') +
            '<div class="req-muted">' + esc((SA().KIND_LABEL || {})[c.kind_record] || c.kind_record) + ' ' + esc(RA.formatDay(c.record_on)) +
              ' by ' + esc(c.record_by_name) + (c.record_note ? ' · ' + esc(c.record_note) : '') +
              (c.note ? ' · Asked again: ' + esc(c.note) : '') + '</div>' +
            (c.completed ? '<div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' + esc(ERRORS.COMPLETED_PROJECT) + '</div></div>' : '') +
            '<div class="pur-rec-row">' +
              '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-cost-approve' +
                (c.completed || !(Number(c.effective) > 0) ? ' disabled' : '') + '>Approve</button>' +
              '<button type="button" class="att-btn att-btn--sm att-btn--warn" data-cost-reject>Reject…</button>' +
            '</div></div></div>';
    }

    // host: an element to fill. Draws nothing when stock is off or nothing waits.
    async function renderApprovals(host, onChange) {
        let list;
        try { list = await RA.rpc('stk_cost_pending'); } catch (e) {
            host.innerHTML = /PGRST202|STOCK_OFF/.test(String((e && (e.code || e.message)) || '')) ? '' : '<div class="att-empty">' + esc(errorMessage(e)) + '</div>';
            return;
        }
        list = list || [];
        if (!list.length) { host.innerHTML = ''; return; }
        const reload = () => { renderApprovals(host, onChange); if (onChange) onChange(); };
        host.innerHTML = '<h3 class="pur-h3">Stock cost moves</h3>' +
            '<p class="req-muted">Goods moved where someone else holds their cost. Until you approve, the cost stays where it was.</p>' +
            list.map(approvalCard).join('');
        host.querySelectorAll('[data-cost]').forEach(card => {
            const c = list.find(x => x.id === card.dataset.cost);
            card.querySelector('[data-cost-approve]').addEventListener('click', () => openDecide(c, true, reload, c.item_unit));
            card.querySelector('[data-cost-reject]').addEventListener('click', () => openDecide(c, false, reload, c.item_unit));
        });
        RA.icons();
    }

    // ── Purchasing → Company stock (owner accounts) ─────────────────

    async function renderCompanyStock(body) {
        body.innerHTML = '<div class="att-empty">Loading…</div>';
        let items;
        try { items = await RA.rpc('stk_company_stock'); } catch (e) {
            body.innerHTML = '<div class="att-empty">' + esc(errorMessage(e)) + '</div>';
            return;
        }
        items = items || [];
        const cell = (x) => '<td style="text-align:right">' + esc(qty(x.quantity)) + '<div class="req-muted">' + esc(peso(x.value)) + '</div></td>';
        const total = items.reduce((s, i) => s + (Number(i.total_value) || 0), 0);
        body.innerHTML =
            '<p class="req-muted">Goods bought for the warehouse that no project carries yet. Never in a project\'s Spent, and not company overhead. ' +
              'Issued goods stay here until the main owner approves their cost assignment.</p>' +
            (items.length
                ? '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table"><thead><tr><th>Item</th><th style="text-align:right">In the warehouse</th>' +
                  '<th style="text-align:right">Issued, assignment pending</th><th style="text-align:right">Awaiting delivery</th><th style="text-align:right">Company stock loss</th></tr></thead><tbody>' +
                  items.map(i => '<tr><td><strong>' + esc(i.name) + '</strong>' + (i.spec ? ' <span class="req-muted">' + esc(i.spec) + '</span>' : '') +
                      '<div class="req-muted">' + esc(i.unit) + '</div></td>' + cell(i.in_warehouse) + cell(i.issued_pending) + cell(i.awaiting) + cell(i.loss) + '</tr>').join('') +
                  '</tbody></table></div></div></div>' +
                  '<p><strong>Company stock: ' + esc(peso(total)) + '</strong> <span class="req-muted">(warehouse + pending assignments + awaiting delivery; losses not included)</span></p>'
                : '<div class="att-empty">No company stock.</div>');
        RA.icons();
    }

    root.StockCostAdmin = Object.assign({}, pure, { openDecide, openResubmit, openReverse, renderApprovals, renderCompanyStock });
})(typeof window !== 'undefined' ? window : globalThis);
```

**Modify:** `package.json` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/package.json b/package.json
index 7c7cc68..34ecb8a 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js && node tests/stock-cost-admin.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
```


- [ ] **Step 1: Apply the files above** (Modify blocks with `git apply --ignore-whitespace`; `admin.html` keeps the user's own uncommitted edit).
- [ ] **Step 2: Tests.** `npm test` → every suite passes (**41**), including the new `stock-cost-admin.test.js` (**9**), `money-math.test.js` (**254**, with §X), `project-control-staff.test.js` (34), `stock-admin.test.js` (17), `expense-split-rows.test.js`, `purchase-server.test.js`. `node --check` on every changed `js/*.js`. `npm run test:sql` is unchanged from Task 1 (Task 2 touches no SQL).
- [ ] **Step 3: Stop for the user** to review and commit.

### Task 3: Live — 0105 applied with stock off, verified, the web pushed

- [ ] **Step 1: Before applying, check live** (MCP `execute_sql`, read-only): the eight functions 0105 redefines (`stk_take`, `stk_check_record`, `stk_move`, `stk_decide`, `stk_reverse`, `stk_record_json`, `pur_guard_expense_row`, `pur_guard_delete`) still match 0104 / 0096 exactly (`md5(replace(prosrc, chr(13), ''))`), `stk_settings` is empty and no `stk_records` row exists.
- [ ] **Step 2: The user applies the committed 0105** (Tasks 1–2 committed first): the whole file, unchanged, once, in the Supabase SQL editor.
- [ ] **Step 3: Verify the live database ourselves** (read-only): every function in 0105 matches the file; `stk_cost_decide`, `stk_cost_reverse`, `stk_cost_resubmit`, `stk_cost_pending`, `stk_company_stock` (and the redefined `stk_move`, `stk_decide`, `stk_reverse`) executable by `authenticated`, not `anon`; every new helper by neither; `stk_cost_moves` has RLS on and no policy; the columns `stk_moves.holder`, `expenses.stk_cost_move_id`, `stk_events.cost_move_id`, `stk_cost_moves.basis_alloc` exist; the triggers `stk_moves_holder` and `stk_guard_cost_basis` exist; **`stk_settings` is still empty (stock off)**; `expenses` has no row with a `stk_cost_move_id`.
- [ ] **Step 4: Live acceptance.** Run `supabase/tests/2c_acceptance.sql` through MCP `execute_sql`. Expect `2c acceptance: all checks passed`. It rolls itself back; check afterwards that no `ZZ 2c` folder, catalogue item or purchase exists, `stk_settings`, `stk_records` and `stk_cost_moves` are empty, the count and sum of `expenses` are unchanged, and staff@'s Buyer switch is unchanged.
- [ ] **Step 5: The user pushes Dacs Web.**
- [ ] **Step 6: Browser check (no stock action).** As the main owner: Purchasing → Owner approvals opens as before (no cost cards — stock is off); there is no Company stock tab (stock is off); Requests → Stock still says "Not switched on yet" — **do not press the switch**; Project Control and Expenses unchanged. As staff@: no change. `client_errors` since the push: nothing new.
- [ ] **Step 7: Execution notes** in this plan; memory updated. Next: plan 2B-b (the phone), then the joint ZZ pilot (Q30) — the switch goes on only after it passes.

---

## Self-review (against the answers)

| Answer | Where |
|---|---|
| Q10 (returns: back to company at the same value; pending shrinks) | R74, R75; `stk_move`'s return, `stk_cost_requests` (`back`), `stk_cost_effective`; tests "a company lot brought back…", "a return after the assignment was approved…", "a project's own leftovers moved from its site…", "goods that left before approval are not charged…"; race 1 |
| Q11 (cost assignment pending) | R73; test "company stock issued to a project…" |
| Q12 (by lot; fees and discounts; last portion takes the rest; lot fixed when moved) | R76; `stk_lot_basis`, `stk_held`, `stk_cost_value`; tests "Q12's own example: ₱100 for 3 pieces…", "value by lot…", "a delivery fee and a discount move with the goods…" |
| Q13 (traced opening keeps its project's cost; untraced ₱0) | R73; lots' own holder; test "untraced old stock is ₱0…" |
| Q14 (receiving month, funding order, Cover) | R77; `pur_fund(…, received_on, …)`; tests "funded like a purchase…", "an Additional Works job…"; race 6 |
| Q15 (out in proportion, centavo-exact) | R77; `stk_cost_carriers` + `pur_prorate`; tests "leftovers moved to another project…" (₱300 + ₱200 Cover), "a delivery fee on Cover while its line sat on the period…" (₱500 + ₱50 Cover), "a delivery fee and a discount…" |
| Q16 (completed projects) | R82; test "a completed project…" |
| Q17 (Company stock on the owner's Purchasing screen) | R84; `stk_company_stock`, `renderCompanyStock`; tests "company stock issued…", "a confirmed warehouse loss…", screen wiring |
| Q18 (Owner approvals cards, one at a time) | R84; `stk_cost_pending`, `renderApprovals`; tests "goods that left…" (the card), wiring |
| Q19 (reject keeps goods and cost; resubmit the same movement) | R79; `stk_cost_resubmit`; test "reject keeps the goods recorded…" |
| Q20 (whole or nothing) | R75; tests "goods that left before approval…", "two requests waiting on the same goods…" |
| Q21 (price — and, rev 2, billing periods and Cover — refused under approved moves; pending re-valued) | R81; `stk_guard_cost_basis`, `basis_alloc`, `stk_purchase_alloc`; tests "a purchase line's price or quantity cannot change…", "re-funding after a partial transfer…"; races 3, 4, 8, 9 |
| Q22 (void refused) | 0104's `stk_guard_void` (unchanged); 2B-a's tests re-run `--with-0105` |
| Q23 (never edited; owner-confirmed reversal when cost moved) | R80; `stk_cost_reverse`, `COST_MOVED`; tests "a movement is not reversed while…", "cost reversals go newest first…", "a reversal is refused while the goods it brought have moved on…"; race 5 |
| Q24 (every peso in one place; the server refuses; once) | `fourPlaces` checked in most 2C tests and in "a busy day…"; `COST_BASIS`, operation ids; race 2, race 7; money-math §X |
| Q25 (labelled rows; billing unchanged) | R77, R86; labels tested; money-math §X; no billing code touched |
| Q26 (the phone) | 2B-b; every call it needs exists here |
| Q27 (warehouse loss → company stock loss; leftovers stay) | R78; test "a confirmed warehouse loss…"; race 4 |
| Q28 (values for owner accounts only) | R83; tests "only the main owner approves…", 2B-a's "no read carries a peso" re-run `--with-0105`, the staff Project Control tests |
| Q29 (old tick) | 2B-a (unchanged) |
| Q30 (pilot) | After 2B-b; Task 3 only proves 0105 live with stock off |

No placeholders. Every task ends with its whole suite green on its own.

## Proof

Built in a scratch clone of Dacs Web on `2422950`: Task 1 = `305071d`, Task 2 = `2c6c91c` (revision 1 was `bd98cce` / `4e23f9d`).

- **Revision 2 (review finding, R81):** the new test "re-funding after a partial transfer (R81 rev 2)…" **fails on revision 1** (the breakage run puts revision 1's guard back: caught). It records a ₱1,000 purchase (₱600 billing #1, ₱400 Cover), re-funds while nothing relies on it (allowed, unchanged), transfers 2 of its leftovers out (₱120 off the period, ₱80 off Cover), then shows a re-fund refused `STOCK_COST_FUNDING` — once because the transfer freed room in the period, once after a second billing period is added — and a supplier-only correction that would re-fund refused too, with nothing moved and no history written; a later transfer comes off the same groups in proportion (₱360 / ₱240); after both cost moves are reversed the re-fund goes through (₱600 billing #1, ₱400 billing #2, no Cover); asked again and approved, the transfer comes off the new periods (₱480 / ₱320) and a re-fund is refused again — every lot in exactly one place at each step. Race 9 (a re-fund while the owner approves a transfer out of the same purchase) holds over 15 rounds with no deadlock. The acceptance script checks it live too (D6–D8). Purchasing now words the three stock refusals a correction can meet (it had none, a gap left from 2B-a); Expenses words the new one. Three new breaks (revision 1's guard, the allocation not kept at approval, Purchasing without the words) are all caught.

- **Task 1:** `npm test` green (40 suites, 1,301 checks on a fresh clone; the real repo runs two more that need its own untracked files). `npm run test:sql` green (**32 suites, 991 checks**): `2c_cost` 29, `2c_concurrency` 9 × 15 rounds with no deadlock, and with 0105 on top every earlier behaviour still holds — 2B-a's 38 (its "no read carries a peso" now allows exactly one new key, `costs`, whose values are missing for staff) and the 2A suites (0105 redefines 0096's two guards: purchases, corrections, voids, change requests, phone purchases and payments behave exactly as before).
- **Task 2:** `npm test` green (41 suites, 1,318 checks); every changed JS file passes `node --check`. Three old fences now name cost moves too, with the same guarantee: the Expenses Cover guess skips cost-move rows like purchase rows; the Materials header subtotal sums every amount except, for staff only, a cost move's; the Stock screen file still holds no peso (R87).
- **Acceptance:** `2c_acceptance.sql` run as written on a throwaway PostgreSQL with Supabase-style JWT claims (`_dry2c` harness): `2c acceptance: all checks passed`, **0 rows left** (stock records, settings, folders, cost moves, expense rows) — including D6–D8, a re-fund refused under an approved transfer. Its first run caught one script bug — staff cannot count `expenses` directly, so the count moved to a block run as the database owner.
- **Found while testing, fixed before this revision:** *(1)* the value rule — the holder's running average gave ₱100 / 3 pieces as ₱33.33 + **₱33.34** + ₱33.33; Q12 says each move is rounded and **the last** takes the rest, so each move now uses the line's own unit cost and the last portion out of a holder takes what it holds (₱33.33 + ₱33.33 + ₱33.34) — test "Q12's own example"; *(2)* approvals and reversals lock the lot's **purchase** first, as every purchase write does (race 8 fails without it); *(3)* a count's loss and a purchase correction meet on the lot's row (the loss's own insert already takes a key lock there; the explicit lock is kept for clarity); *(4)* a purchase correction from the Expenses screen can now be refused for stock reasons, so Expenses words `STOCK_COST_IN_USE`, `STOCK_IN_USE`, `STOCK_COST_ROW` and `STOCK_LIVE`.
- **Live, read-only (26 Oct):** the eight functions 0105 redefines — 0104's `stk_take`, `stk_check_record`, `stk_move`, `stk_decide`, `stk_reverse`, `stk_record_json` and 0096's `pur_guard_expense_row`, `pur_guard_delete` — match their migration files exactly (`md5(replace(prosrc, chr(13), ''))`, **8/8**); `stk_settings` and `stk_records` are empty (stock off); `stk_cost_moves` and `expenses.stk_cost_move_id` do not exist yet.
- **Breakage run: 68 / 68 caught** — each rule broken on purpose, one at a time, and a suite must fail: whose cost goods are and when the owner is asked (inflows holding nobody's cost, no request into a project, a project's own leftovers asked back, no request back to company, untraced stock asking, goods already charged leaving first, a return ignoring the approved assignment, a reversal ignoring whose goods); what is charged (pending charging goods already gone, earlier pending requests not counted, approval on goods no longer there, the last portion rounded too, the value without its delivery fee or discount, the value by the holder's average); the rows (funded on the approval day, the giving project keeping the cost, the giving side not in proportion, earlier cost moves or the delivery fee not carried, rows not on the giving project's Cover, a loss not recorded); who and when (anyone recording approving, reversing or asking again, anyone reading the cards, staff reading company stock or seeing values, deciding while stock is off, into a completed project or a job under one, rejecting without a reason, deciding twice, asking again while one is open, a retried approval charged twice); never edited (a movement reversed under its approved cost, pending left open on a reversed movement, a count's loss surviving its reversal, a cost reversed under later moves, a reversed cost keeping its rows, price or quantity changing under approved moves, **revision 1's re-funding under approved moves, where the cost sat not kept at approval**, cost rows edited or inserted by hand, a project with stock or a period with cost rows deleted); at the same moment (approval without the purchase lock — races 8 and 9, without the projects' locks — race 6, a correction checked without the lot rows — race 4); and the screens (a value made up in the browser, anyone approving, asking again while one is open, a cost pill priced on the Stock screen, Company stock or the cost cards for staff, the cost file not loaded, **Purchasing without the funding refusal's words**, staff seeing a cost move's pesos in Project Control, an owner's subtotal dropping cost moves, a staff subtotal counting them, the link not mapped, a part-by-part edit, an Expenses delete or edit of a cost-move row, the Cover guess on one, a split cost move not recognised). Revision 1's first run (66 breaks, two of them mis-written and fixed) missed eleven: five test gaps — a project's leftovers moved from its site to the warehouse, a return when the site also holds goods still waiting, a reversal refused by whose goods moved, two requests on the same goods (first come, first charged), a delivery fee on Cover while its line sat on the period — each closed with a new test, then caught; two lock gaps — the two-approvals race used one item (so the item lock already serialised it) and no race covered a warehouse lot's price — now race 6 uses two items and race 8 was added, then caught; and four breaks that changed nothing, rewritten or dropped: the last-portion special case was the formula's own result (rewritten against the corrected valuation, then caught), a rejection's reason is checked twice so breaking one check changed nothing (both broken now, caught), the loss's lot-row lock is doubled by its own insert's key lock (dropped), and Project Control's category amount only orders the groups (that change was reverted). Revision 1's final run: 65 / 65.**
- Every file was restored and compared byte for byte after each breakage run.

## Rehearsal

The plan's own text was applied to two fresh clones of the real Dacs Web at `2422950` — every Create block written as given, every Modify block through `git apply --ignore-whitespace` (after `--check`), then Task 1's CRLF command:

- **Clean clone:** 30 blocks; **all 29 files byte-identical** to the tested build (`2c6c91c`), no other file touched.
- **With the user's own uncommitted one-space `admin.html` edit made first:** 30 blocks; all 29 files identical (`admin.html` = the tested file plus that edit); no other file touched.
- **Task 1 alone** (a third clone): its 12 blocks give files byte-identical to `305071d`, and `npm test` passes there (40 suites, 1,301 checks) before Task 2 exists.

## Execution notes (27 October 2026)

- **Reviews:** revision 1 (26 Oct) → the user's review: R79, R83 and R84 accepted; **R81 changed** — a purchase's billing-period and Cover allocation must not change while approved cost moves depend on it → **revision 2** (`basis_alloc`, `STOCK_COST_FUNDING`, the re-funding-after-a-partial-transfer regression test, race 9, acceptance D6–D8, Purchasing's refusal words). Revision 2 approved 27 Oct.
- **Task 1:** applied from this plan (12 blocks; every file byte-identical to the tested build `305071d`); `npm test` 40 suites / 1,303 checks; `npm run test:sql` 32 suites / 991 checks; acceptance dry run passed with 0 rows left. Committed by the user as **`2663dd3`** (with this plan).
- **Task 2:** applied from this plan (18 blocks; every file byte-identical to `2c6c91c`; `admin.html` = the tested file plus the user's own uncommitted one-space edit); `node --check` on every changed JS file; `npm test` 41 suites / 1,320 checks (money-math 254). Committed by the user as **`db54690`**; the one-space `admin.html` edit stays uncommitted.
- **Step 1–2:** the user applied the committed 0105 in the SQL editor, 27 Oct ~01:30. (The read-only pre-check of Step 1 had been done on 26 Oct: the eight functions 0105 redefines matched their files, 8/8, stock off.)
- **Step 3 (verified through MCP, read-only):** all **29** function bodies match the file (`md5(replace(prosrc, chr(13), ''))`); the **8** callable functions (`stk_cost_decide`, `stk_cost_reverse`, `stk_cost_resubmit`, `stk_cost_pending`, `stk_company_stock`, and the redefined `stk_move`, `stk_decide`, `stk_reverse`) are executable by `authenticated`, none by `anon`; the other **21** by neither; `stk_cost_moves` has RLS on and **0** policies; the columns `stk_moves.holder`, `expenses.stk_cost_move_id`, `stk_events.cost_move_id`, `stk_cost_moves.basis_alloc` exist; the triggers `stk_moves_holder` and `stk_guard_cost_basis` exist; **`stk_settings` is empty — stock is off**; no expense row has a `stk_cost_move_id`.
- **Step 4:** `2c_acceptance.sql` passed live — *2c acceptance: all checks passed* — and rolled itself back. Before/after snapshot identical: 15 projects, 61 billing periods, 57 budgets, 6 catalogue items, 23 purchases / 23 lines, 576 expense rows totalling ₱3,037,634.74, 162 operation ids, 36 purchase history rows, the Buyer switch rows unchanged; every `stk_*` table 0 rows; no `ZZ 2c` project or item; no `client_errors`.
- **Step 5:** pushed by the user 27 Oct (`origin/main` = `db54690`, also carrying `c32ada6`, `2422950`, `2663dd3`). The ten changed web files at `dacs-company.vercel.app` are byte-identical to `db54690` (`admin.html` as committed, without the local edit).
- **Step 6 (browser, the user, 27 Oct ~20:00–20:30; server checks as each account):**
  - **admin@ (main owner):** Purchasing → Owner approvals opens as before ("Nothing is waiting"), **no cost cards**; Purchasing tabs Shopping list · Purchases · Owner approvals · Cash — **no Company stock tab**; Requests → Stock says "Not switched on yet" with the warning and the switch (**not pressed**); Project Control (J. Apo Residence materials) unchanged — purchase rows keep "From purchase", their billing period, amounts and receipts, totals as before; the Add Expense form still offers "Also add this to inventory" (stock off). Server: `stk_status` off / main owner; `stk_cost_pending` → `[]`; `stk_company_stock` → `STOCK_OFF`.
  - **staff@:** in the browser (the user, 20:34) Requests shows Queue · Purchasing · Weekly batches · Teams · Catalogue · Item history · Projects — **no Stock tab**; server: `stk_status` off, may record, not the main owner; `stk_cost_pending` → `OWNER_ONLY`; `stk_company_stock` → `STOCK_OFF`.
  - `stk_settings` and `stk_events` still empty afterwards; no new `client_errors`.
- **2C done. Stock stays switched off.** Next: plan 2B-b (the phone), then the joint ZZ pilot (Q30); the switch goes on only after it passes.
