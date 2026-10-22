# WorkMate Stage 2A-4a — Paying for purchases: server and Dacs Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record how purchases are paid — deposits, the rest, from petty cash, a buyer's own money, the company directly or a supplier credit — and give the main owner a petty-cash tracker with a daily report, an Overpaid list (refunds and supplier credit) and "Company owes buyer" with repayments. **None of it changes Spent, Earned or Profit.**

**Architecture:** One migration (**0102**) adds nine private tables (RLS on, no policies, every privilege revoked) and the functions that are the only way in. A payment is tracked against the **purchase**, never as an expense row; every balance (cash held, company owes, credit left, what is over) is worked out from the records, never stored. `pur_record` gains "paid now": the purchase and its payments are accepted in **one transaction**. Four earlier functions (`pur_record`, `pur_header_ok`, `pur_list_doc`, `receipt_mark_attached`) and 0097's storage rules (for the new private `pettyCash/` folder, R13) are redefined; the tests prove each is its earlier text plus the lines 0102 adds. Dacs Web gets a Payments card on each purchase, "Paid now?" on the purchase form, a Payment column, a **Cash** tab (the main owner's tracker, or a buyer's own cash) and an owner-only Unpaid / Partially paid / Paid badge in Project Control. Plan **2A-4b** (the phone) follows.

**Tech Stack:** PostgreSQL / Supabase (plpgsql), vanilla JS (no build step), Node test files with no dependencies, PGlite + embedded-postgres for `npm run test:sql`.

**Spec:** [Mobile Purchasing](../specs/2026-09-30-workmate-mobile-purchasing-design.md) (*Supplier payments*, *Owner-authorized personal advances*, *Overpayment refunds and supplier credit*) · answers: [2A-4 questions](../specs/2026-10-22-workmate-stage2a4-questions.md) — **Q1–Q24 = A, Q10 with two cases added; confirmed by the user 22 October 2026** · before: [2A-3a plan](2026-10-20-workmate-stage2a3a-server-web.md), [2A-3b plan](2026-10-21-workmate-stage2a3b-buyer-app.md)

**Status:** Revision 2, 22 October 2026, **for the user's review** — rulings R4, R5, R7, R9, R10, R11 and R13 changed as the user approved on 22 October (audit trail on moved payments; the Overpaid split only a suggestion; voids as reversals on the void day; accept **or** reject own money with a reason; supplier credit in "Paid now?"; a confirmed return above cash held leaves ₱0 and a shortfall; return photos in a private folder). Nothing is applied live and nothing is in the repo yet. The code below was built and tested first in a scratch clone of `main` at `c12a98e` (one commit per task, `npm test` green after each, `npm run test:sql` all suites green), then re-applied to a fresh clone and compared byte for byte (rehearsal: see the end).

## Global Constraints

- **Never run `npm run build`.** `js/portal-app.compiled.js` is the live source and is edited directly (CLAUDE.md).
- **New data needs real DB columns.** Every new column and table is in migration 0102.
- **Migrations:** next number = highest + 1 = **0102** (highest on disk: `0101_purchasing_phone.sql`). Never SQL-editor changes. The user applies the file; we then verify the live database ourselves (memory: a "done apply" has not always matched the live DB).
- **Outside the money model (CLAUDE.md):** petty cash, personal advances, refunds and supplier credits never feed Spent / Earned / Profit, and issuing, returning or repaying money never creates an expense. **0102 writes and reads no `expenses` or `payroll` row** — the static test reads the migration and the behaviour tests compare every expense row before and after. The money tests gain a fence that `_projSpent`, `_projEarned`, `_projMargin`, `_recognisedProfit` and `buildProject` mention no payment symbol. Run `npm test` after every task: Task 2 touches money code (`portal-app.compiled.js`, `expenses-module.js`).
- **Staff see no peso amounts** outside the two approved exceptions. Buyer staff see payments on purchases in their buying scope and **their own** cash only (Q24). Project Control's payment badge is owner accounts only — never staff — and carries no amount.
- **Dates:** never `toISOString().slice(0,10)` for a local date (the browser builds it from local parts, `PA.localDay`). The server uses `(now() at time zone 'Asia/Manila')::date`.
- **The user commits.** Executors never run `git commit` or `git push`. Each task ends at a "stop for the user" step.
- **CRLF files:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` use CRLF line endings in the repo. Keep CRLF. Every other file in this plan is LF.

## Rulings

The answers (Q1–Q24) decide the behaviour. These rulings settle the details the answers left open, found while building and testing. **For the user's approval with the plan.**

- **R1 — Who is the "main owner"?** 0098's definition (`pm_main_owner_id`: owner role, no `owner_id`, active) **and** the Expenses section. `admin-pm@` (PM only) and sub-owner accounts are refused (`OWNER_ONLY` / `NOT_ALLOWED`).
- **R2 — Petty cash and own money belong to staff buyers only.** An owner account paying is "Company, paid directly". A staff buyer records only **their own** petty cash or own money; the main owner may record anyone's (e.g. entering a buyer's report).
- **R3 — "Not tracked" (Q2).** A new column `purchases.payments_tracked`: false on every purchase recorded before 0102, true from then on. One payment turns it on for that purchase.
- **R4 — A replacement takes its payments with it, with an audit trail.** When a correction adds or removes lines (`pur_replace`), the purchase gets a new row; a trigger moves its payments, refunds and credits to the new version, and "not tracked" with them. Without it, a replaced purchase would show its money as "to recover". Each moved row writes **its own** history entry (`payment_moved` / `refund_moved` / `credit_moved`, naming the version it came from), and a payment keeps `first_purchase_id` — the purchase it was first paid on, never rewritten. The Payments card says "carried over from the earlier version".
- **R5 — The Overpaid screen starts from a suggested split, and it is only a suggestion.** The latest payments are taken as the ones paid too much, each part no more than that money can still give back. Nothing is saved until the main owner presses **Save**, after changing any amount they want; the server checks the parts sent, never the suggestion.
- **R6 — Q10's credit case.** The suggested resolution of a credit-funded excess is **back to that supplier's credit** (a new credit row). The main owner may instead record a real cash refund of it: to the company, or into a buyer's hands, where it is company cash they hold. Never more than the credit payments made.
- **R7 — Voids in the daily report are reversals on the day of the void.** Q18 dates a return by its **confirmation** day, and past days never change. A voided entry **stays on its own day** (marked "voided on …"), and the void appears as a **reversal on the day it was made** ("Void: petty cash given of 20 Oct"), moving that day's closing back. So a printed or exported day never changes afterwards. The running balance today is the same either way.
- **R8 — A payment a refund or credit relies on cannot be voided** (`RESOLVED_FIRST`). Void the refund or credit first. Otherwise more would be given back than was ever over.
- **R9 — Own money while the switch is off** is kept and flagged "to review" (Q21). The main owner either **accepts** it (then it is owed) or **rejects** it **with a reason** (never owed; the payment itself stays, because it really happened — it still pays the supplier). One decision per payment, kept with who and when; a rejected one leaves "to review".
- **R10 — "Paid now?" on the web form** is optional and starts at "Not paid yet". It offers petty cash / own money only when the purchase is bought by a staff buyer, and **supplier credit** when the purchase's supplier has credit left (pick which credit; never more than is left). Purchase and payment are saved in the **same transaction**, as for every other source.
- **R11 — Limits.** A repayment never passes what is owed (`OVER_OWED`). A reported return is not capped (real money handed back; the main owner confirms it). If a confirmed return is **more than the cash recorded**, cash held reads **₱0** and the difference shows as an **unreconciled shortfall** — never a negative balance (as Q16). A cash count may be ₱0. A payment's date and every other date are never in the future (Philippine date), and from 2020 on.
- **R12 — No new payment on a voided purchase** (`BAD_STATE`). Payments on a **completed** project's purchase are allowed: they change no cost.
- **R13 — Proof photos.** A payment's GCash screenshot or slip goes in the buyers-only `purchases/` folder, like receipts. A **return's photo** goes in a new private folder, **`pettyCash/<company>/<month>/`**, readable only by the **main owner** and **the buyer who uploaded it** — other buyers cannot open it. The server accepts a return photo only if it is the reporting buyer's own upload to that folder. Both are marked attached like receipts. The new folder gets its own storage rule in 0102 and an entry in `tests/storage-access.test.js`.
- **R14 — The daily report covers at most 92 days** (`BAD_RANGE`), one buyer at a time; days with nothing on them are skipped.
- **R15 — Project Control's badge** reads a separate owner-only list (`pur_payment_badges`, owner accounts with the Expenses section). It is never part of any total; staff never load it.
- **R16 — `pur_cash_buyer(buyer)`.** The main owner's read of one buyer's last 90 days (petty cash given, returns, counts, repayments), so a mistaken entry can be voided from the Cash tab. A buyer reads the same through `pur_my_cash` for themselves only.

## File structure

| File | Task | What |
|---|---|---|
| `supabase/migrations/0102_purchase_payments.sql` | 1 | **New.** The migration |
| `supabase/tests/2a4_payments.pglite.mjs` | 1 | **New.** 47 behaviour tests on PGlite (0096 + 0097 + 0101 + 0102 verbatim) |
| `supabase/tests/2a4_concurrency.mjs` | 1 | **New.** 4 two-session races on a throwaway PostgreSQL |
| `supabase/tests/2a4_acceptance.sql` | 1 | **New.** Live acceptance, rolls itself back |
| `tests/purchasing-payments-server.test.js` | 1 | **New.** Static fences: outside the money model, redefined functions, grants, sent once |
| `supabase/tests/2a1_purchase.pglite.mjs`, `2a2_purchasing.pglite.mjs`, `2a3_server.pglite.mjs` | 1 | `--with-0102` re-runs |
| `tests/money-math.test.js` | 1 | The payments fence |
| `tests/storage-access.test.js` | 1 | The new `pettyCash` folder in `FOLDERS` and its rule (R13) |
| `package.json` | 1, 2 | New suites in `test:sql` and `test` |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` | 1 | Docs (CRLF) |
| `js/purchasing-admin-core.js` | 2 | Payment words and checks, refund routes, the Overpaid split, the daily report and CSV, error sentences |
| `js/purchasing-admin-pay.js` | 2 | **New.** The Payments card, Record payment, voids, Resolve overpaid |
| `js/purchasing-admin-cash.js` | 2 | **New.** The Cash tab: the main owner's tracker and daily report, or a buyer's own cash |
| `js/purchasing-admin-list.js` | 2 | The Cash tab |
| `js/purchasing-admin-purchases.js` | 2 | The Payment column and the Payments card |
| `js/purchasing-admin-record.js` | 2 | "Paid now?" |
| `js/expenses-module.js`, `js/portal-app.compiled.js` | 2 | The owner-only badge |
| `js/receipt-storage.js` | 2 | Upload kind `petty_cash` → the `pettyCash/` folder |
| `css/purchasing-admin.css`, `admin.html` | 2 | Styles, script tags, cache-busters `?v=20261022b` |
| `tests/purchasing-payments-screens.test.js` | 2 | **New.** 19 tests: the screens agree with the server, staff hiding, wiring |
| `tests/purchasing-admin.test.js` | 2 | The RPC allow-list covers the two new files |

---

### Task 1: Migration 0102 and its tests

**Interfaces produced:** the tables and functions in the migration header; `pur_pay_state` (`{state, tracked, due, paid, balance, excess, resolved, unresolved, over_resolved}`) used by every screen; `pur_list_doc.pay`.

<!-- Tests -->

**Modify:** `supabase/tests/2a1_purchase.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a1_purchase.pglite.mjs b/supabase/tests/2a1_purchase.pglite.mjs
index 118c06c..e89d955 100644
--- a/supabase/tests/2a1_purchase.pglite.mjs
+++ b/supabase/tests/2a1_purchase.pglite.mjs
@@ -20,7 +20,11 @@ const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
 // --with-0097: the same tests with 2A-2's migration applied on top — 0097
 // must not change how a purchase is recorded, funded, corrected or voided.
 // --with-0101: the same again with 2A-3a's 0101 on top of 0097.
-const WITH_0101 = process.argv.includes('--with-0101');
+// --with-0102: and 2A-4a's 0102 on top of those (payments must not change recording).
+const WITH_0102 = process.argv.includes('--with-0102');
+const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
+const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
+const WITH_0101 = process.argv.includes('--with-0101') || WITH_0102;
 const WITH_0097 = process.argv.includes('--with-0097') || WITH_0101;
 const PR_BASE = WITH_0097 ? (await import('./pr_base.mjs')).prBase(ROOT) : '';
 const M97 = WITH_0097 ? read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')) : '';
@@ -97,6 +101,7 @@ async function fresh() {
   await db.exec(read(MIG));
   if (WITH_0097) { await db.exec(PR_BASE); await db.exec(M97); }
   if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
+  if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
   await db.exec(`insert into profiles values
     ('${OWNER}', 'owner', null, 'active', null), ('${STAFF}', 'staff', '${OWNER}', 'active', null),
     ('${WORKER}', 'worker', '${OWNER}', 'active', null), ('${OTHER}', 'owner', null, 'active', null),
@@ -142,7 +147,7 @@ async function code(promise) {
   try { await promise; return 'no error'; } catch (e) { return e.message; }
 }
 
-console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + (WITH_0101 ? ' + 0101' : '') + ' on PGlite)');
+console.log('\n2A-1 purchase recording (0096' + (WITH_0097 ? ' + 0097' : '') + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + ' on PGlite)');
 
 await test('§3.3 example: ₱8,000 on 14 Oct → ₱3,000 + ₱4,000 + ₱1,000 Cover (earliest billing number first)', async () => {
   const db = await fresh(); await as(db, OWNER);
```

**Modify:** `supabase/tests/2a2_purchasing.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a2_purchasing.pglite.mjs b/supabase/tests/2a2_purchasing.pglite.mjs
index 5b64ed3..e81cfcf 100644
--- a/supabase/tests/2a2_purchasing.pglite.mjs
+++ b/supabase/tests/2a2_purchasing.pglite.mjs
@@ -22,7 +22,11 @@ const M96 = read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sq
 const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql'));
 // --with-0101: the same tests with 2A-3a's 0101 on top — 0101 must not change
 // how the Purchasing tab buys, covers, corrects or approves.
-const WITH_0101 = process.argv.includes('--with-0101');
+// --with-0102: and 2A-4a's 0102 on top of 0101.
+const WITH_0102 = process.argv.includes('--with-0102');
+const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
+const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
+const WITH_0101 = process.argv.includes('--with-0101') || WITH_0102;
 const M101 = WITH_0101 ? read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')) : '';
 
 // The 2A-1 base schema (same as 2a1_purchase.pglite.mjs).
@@ -92,6 +96,7 @@ async function fresh() {
   await db.exec(prBase(ROOT));
   await db.exec(M97);
   if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
+  if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -158,7 +163,7 @@ async function spent(db, folderId) {
   return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
 }
 
-console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097' + (WITH_0101 ? ' + 0101' : '') + ' on PGlite)');
+console.log('\n2A-2 purchasing tab + Buyer switch (0096 + 0097' + (WITH_0101 ? ' + 0101' : '') + (WITH_0102 ? ' + 0102' : '') + ' on PGlite)');
 
 // ── A. The Buyer switch ──────────────────────────────────────────────
 
```

**Modify:** `supabase/tests/2a3_server.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a3_server.pglite.mjs b/supabase/tests/2a3_server.pglite.mjs
index 1adab38..ddfe73f 100644
--- a/supabase/tests/2a3_server.pglite.mjs
+++ b/supabase/tests/2a3_server.pglite.mjs
@@ -21,6 +21,10 @@ const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_of
 const M96 = read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql'));
 const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql'));
 const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql'));
+// --with-0102: the same tests with 2A-4a's 0102 on top — payments must not change the phone server.
+const WITH_0102 = process.argv.includes('--with-0102');
+const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
+const M102 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')) : '';
 
 // The 2A-1 base schema (same as 2a1_purchase.pglite.mjs), plus the service
 // role the sign-in function runs as.
@@ -104,6 +108,7 @@ async function fresh() {
   await db.exec(prBase(ROOT));
   await db.exec(M97);
   await db.exec(M101);
+  if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -160,7 +165,7 @@ async function periodsOf(db, folderId) {
                     from projects p where p.folder_id = $1 order by p.created_at, p.id`, [folderId]);
 }
 
-console.log('\n2A-3a phone purchasing server (0096 + 0097 + 0101 on PGlite)');
+console.log('\n2A-3a phone purchasing server (0096 + 0097 + 0101' + (WITH_0102 ? ' + 0102' : '') + ' on PGlite)');
 
 // ── A. Signing a buyer in (Q1, R1, R3) ──────────────────────────────
 
@@ -411,9 +416,10 @@ await test('My purchases rows have the office list shape (same builder) plus not
   const a = (await one(db, `select pur_my_purchases(60) l`)).l[0];
   const b = (await one(db, `select pur_purchases(null, null, null, 'all') l`)).l.find(x => x.id === r.purchase_id);
   eq(a, b, 'identical rows');
-  eq(Object.keys(b).sort(), ['bought_by_name', 'extra', 'id', 'lines', 'linked', 'needs_review', 'no_receipt_reason', 'pending_change',
+  eq(Object.keys(b).sort(), ['bought_by_name', 'extra', 'id', 'lines', 'linked', 'needs_review', 'no_receipt_reason',
+    ...(WITH_0102 ? ['pay'] : []), 'pending_change',
     'projects', 'purchase_date', 'receipt_total', 'recorded_by_name', 'replaced_by', 'source', 'status', 'supplier', 'unit_check',
-    'unplanned', 'warehouse'], '0097 keys + no_receipt_reason + replaced_by');
+    'unplanned', 'warehouse'], '0097 keys + no_receipt_reason + replaced_by' + (WITH_0102 ? ' + pay (0102)' : ''));
 });
 
 await test('My purchases is for buyers only, and the window is 1–366 days', async () => {
```

**Create:** `supabase/tests/2a4_acceptance.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-4a acceptance — migration 0102 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists — not the Buyer or
-- own-money switch, not the "ZZ 2a4" project, its purchases, payments, petty
-- cash, refunds, credit or repayment. Editor-safe (set_config 'v2a4.*', no
-- temp objects). Needs one active main owner with an active staff account
-- allowed Expenses. That account's switches are set inside this transaction,
-- so its real settings are kept. Run it through MCP execute_sql.
-- Success ends with the row '2a4 acceptance: all checks passed'.
--   A. "paid now": the purchase and its payment together; Paid; cash held down
--   B. a deposit, the rest, then too much: Partially paid → Paid → Overpaid
--   C. Overpaid resolved: refund tied to its money + a supplier credit, used in part
--   D. petty cash: given, returned, confirmed; the daily report adds up
--   E. own money: switch off → flagged; accepted; repaid
--   F. who may: a worker and the staff account are refused the owner's screens
--   G. no Spent moved anywhere — this project's or any other
--   H. return photos: the main owner reads them; a buyer only their own uploads
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_main uuid; v_sup uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
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

  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a4 project') returning id into v_main;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_main, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1);
  insert into project_budgets (project_id, owner_id, monthly_budget) select id, v_owner, 1000000 from projects where folder_id = v_main;
  insert into suppliers (owner_id, name, created_by) values (v_owner, 'ZZ 2a4 Hardware', v_owner) returning id into v_sup;

  perform set_config('v2a4.owner', v_owner::text, true);
  perform set_config('v2a4.staff', v_staff::text, true);
  perform set_config('v2a4.worker', v_worker::text, true);
  perform set_config('v2a4.main', v_main::text, true);
  perform set_config('v2a4.sup', v_sup::text, true);
  perform set_config('v2a4.today', v_today::text, true);
  -- G (before): every expense row of the company, count and pesos.
  perform set_config('v2a4.spent', (select count(*)::text || '/' || coalesce(sum(amount), 0)::text from expenses where owner_id = v_owner), true);
end $$;

-- ═══ As the main owner: switches on, petty cash given ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  perform pur_set_buyer(current_setting('v2a4.staff')::uuid, true);
  perform pur_set_own_money(current_setting('v2a4.staff')::uuid, false);
  r := pur_cash_give(gen_random_uuid(), current_setting('v2a4.staff')::uuid, '5000', current_setting('v2a4.today'), 'cash', 'ZZ 2a4');
  assert (r ->> 'held')::numeric >= 5000, 'D1 petty cash given counts at once';
  perform set_config('v2a4.held0', (r ->> 'held'), true);
end $$;

-- ═══ A–C as the buyer ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_p uuid; v_q uuid; v_rcpt text := 'https://example.test/zz-2a4-receipt.jpg';
  v_line jsonb := jsonb_build_object('folder_id', current_setting('v2a4.main'), 'item_name', 'ZZ 2a4 cement', 'unit', 'bag', 'unplanned_reason', 'ZZ test');
begin
  -- A. Paid now.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
         'receipt_total', 1250, 'supplier_id', current_setting('v2a4.sup'), 'docs', jsonb_build_object('po_image_url', v_rcpt),
         'lines', jsonb_build_array(v_line || jsonb_build_object('amount', 1250)),
         'payments', jsonb_build_array(jsonb_build_object('amount', '1250', 'paid_on', current_setting('v2a4.today'),
                                                          'method', 'cash', 'source', 'petty_cash'))));
  assert r -> 'pay' ->> 'state' = 'paid', 'A1 paid now: ' || (r -> 'pay')::text;
  assert ((pur_my_cash() ->> 'recorded')::numeric) = current_setting('v2a4.held0')::numeric - 1250, 'A2 cash held went down by ₱1,250';
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
      'receipt_total', 99, 'lines', jsonb_build_array(v_line || jsonb_build_object('amount', 99)),
      'payments', jsonb_build_array(jsonb_build_object('amount', '99', 'paid_on', current_setting('v2a4.today'), 'method', 'barter', 'source', 'company'))));
    raise exception 'A3 a bad payment let its purchase through';
  exception when others then
    assert sqlerrm like '%BAD_METHOD%', 'A3 wrong error: ' || sqlerrm;
  end;
  assert not exists (select 1 from jsonb_array_elements(pur_my_purchases(1)) x where (x ->> 'receipt_total')::numeric = 99),
    'A4 the refused purchase was not recorded';

  -- B. Deposit, the rest, too much.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
         'receipt_total', 1000, 'supplier_id', current_setting('v2a4.sup'),
         'lines', jsonb_build_array(v_line || jsonb_build_object('amount', 1000))));
  v_p := (r ->> 'purchase_id')::uuid;
  perform set_config('v2a4.p', v_p::text, true);
  r := pur_pay(gen_random_uuid(), v_p, jsonb_build_object('amount', '300', 'paid_on', current_setting('v2a4.today'), 'method', 'gcash', 'source', 'company'));
  assert r -> 'pay' ->> 'state' = 'partial', 'B1 a deposit: Partially paid';
  r := pur_pay(gen_random_uuid(), v_p, jsonb_build_object('amount', '700', 'paid_on', current_setting('v2a4.today'), 'method', 'cash', 'source', 'petty_cash'));
  assert r -> 'pay' ->> 'state' = 'paid', 'B2 the rest: Paid';
  r := pur_pay(gen_random_uuid(), v_p, jsonb_build_object('amount', '500', 'paid_on', current_setting('v2a4.today'), 'method', 'cash', 'source', 'petty_cash'));
  assert r -> 'pay' ->> 'state' = 'overpaid' and (r -> 'pay' ->> 'unresolved')::numeric = 500, 'B3 too much: Overpaid ₱500';
  assert (select x -> 'pay' ->> 'state' from jsonb_array_elements(pur_my_purchases(1)) x where x ->> 'id' = v_p::text) = 'overpaid',
    'B4 the list row shows it';

  -- E (part). Own money while the switch is off.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
         'receipt_total', 400, 'supplier_id', current_setting('v2a4.sup'),
         'lines', jsonb_build_array(v_line || jsonb_build_object('amount', 400)),
         'payments', jsonb_build_array(jsonb_build_object('amount', '400', 'paid_on', current_setting('v2a4.today'),
                                                          'method', 'cash', 'source', 'own_money'))));
  assert (pur_my_cash() ->> 'owes_to_review')::numeric = 400 and (pur_my_cash() ->> 'owes')::numeric = 0, 'E1 flagged, not owed yet';
  perform set_config('v2a4.own', pur_purchase_payments((r ->> 'purchase_id')::uuid) -> 'payments' -> 0 ->> 'id', true);

  -- D (part). A return reported.
  r := pur_cash_report_return(gen_random_uuid(), '1000', current_setting('v2a4.today'), 'ZZ the owner', '', 'ZZ 2a4');
  perform set_config('v2a4.ret', r ->> 'return_id', true);
  assert (pur_my_cash() ->> 'pending_returns')::numeric >= 1000, 'D2 awaiting confirmation, shown apart';

  -- F. The owner's screens are not the buyer's.
  begin
    perform pur_cash_tracker();
    raise exception 'F1 the buyer read the tracker';
  exception when others then
    assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'F1 wrong error: ' || sqlerrm;
  end;
end $$;

-- ═══ C–E as the main owner ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_credit uuid; v_rep jsonb; v_q uuid; v_d jsonb; v_held numeric;
begin
  -- C. ₱500 over: ₱300 back into the buyer's petty cash, ₱200 as Wilcon-style credit.
  v_held := (select (b ->> 'recorded')::numeric from jsonb_array_elements(pur_cash_tracker() -> 'buyers') b
              where b ->> 'buyer_id' = current_setting('v2a4.staff'));
  assert exists (select 1 from jsonb_array_elements(pur_overpaid()) x where x ->> 'id' = current_setting('v2a4.p')), 'C1 on the Overpaid list';
  r := pur_resolve_overpaid(gen_random_uuid(), current_setting('v2a4.p')::uuid,
         jsonb_build_array(jsonb_build_object('amount', '300', 'funded_by', 'petty_cash', 'person_id', current_setting('v2a4.staff'),
                                              'received_by', 'petty_cash', 'received_on', current_setting('v2a4.today'))),
         jsonb_build_object('amount', '200', 'note', 'ZZ credit memo'));
  assert r -> 'pay' ->> 'state' = 'paid', 'C2 resolved';
  assert (select (b ->> 'recorded')::numeric from jsonb_array_elements(pur_cash_tracker() -> 'buyers') b
           where b ->> 'buyer_id' = current_setting('v2a4.staff')) = v_held + 300, 'C3 cash held +₱300';
  v_credit := (r -> 'created' -> 1 ->> 'credit_id')::uuid;
  perform set_config('v2a4.credit', v_credit::text, true);

  -- D. Confirm the return; the daily report adds up.
  r := pur_cash_decide_return(gen_random_uuid(), current_setting('v2a4.ret')::uuid, true, 'ZZ counted');
  v_rep := pur_cash_report(current_setting('v2a4.staff')::uuid, current_setting('v2a4.today'), current_setting('v2a4.today'));
  v_d := v_rep -> 'days' -> 0;
  assert v_d ->> 'day' = current_setting('v2a4.today'), 'D3 today is in the report';
  assert (v_d ->> 'opening')::numeric
         + (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d -> 'received') x)
         + (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d -> 'refunds_in') x)
         - (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d -> 'payments') x)
         - (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d -> 'returns') x)
         = (v_d ->> 'closing')::numeric, 'D4 opening + in − out = closing';

  -- E. Accept the own-money payment, repay part of it.
  perform pur_accept_own_money(gen_random_uuid(), current_setting('v2a4.own')::uuid);
  assert (select (b ->> 'owes')::numeric from jsonb_array_elements(pur_cash_tracker() -> 'buyers') b
           where b ->> 'buyer_id' = current_setting('v2a4.staff')) >= 400, 'E2 accepted: owed';
  r := pur_repay_buyer(gen_random_uuid(), current_setting('v2a4.staff')::uuid, '150', current_setting('v2a4.today'), 'cash', 'ZZ');
  begin
    perform pur_repay_buyer(gen_random_uuid(), current_setting('v2a4.staff')::uuid, '100000000', current_setting('v2a4.today'), 'cash', 'ZZ');
    raise exception 'E3 repaid more than owed';
  exception when others then
    assert sqlerrm like '%OVER_OWED%', 'E3 wrong error: ' || sqlerrm;
  end;
  assert exists (select 1 from jsonb_each_text(pur_payment_badges()) b where b.value in ('paid', 'partial')), 'F2 the owner badge reads states';
end $$;

-- ═══ C. The buyer uses the credit in part ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_q uuid;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
         'receipt_total', 500, 'supplier_id', current_setting('v2a4.sup'),
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a4.main'), 'item_name', 'ZZ 2a4 sand',
                                                       'unit', 'bag', 'amount', 500, 'unplanned_reason', 'ZZ test')),
         'payments', jsonb_build_array(
            jsonb_build_object('amount', '120', 'paid_on', current_setting('v2a4.today'), 'method', 'other', 'source', 'credit',
                               'credit_id', current_setting('v2a4.credit')),
            jsonb_build_object('amount', '380', 'paid_on', current_setting('v2a4.today'), 'method', 'cash', 'source', 'petty_cash'))));
  assert r -> 'pay' ->> 'state' = 'paid', 'C4 credit + cash pay it in full';
  assert (select (x ->> 'left')::numeric from jsonb_array_elements(pur_credits(current_setting('v2a4.sup')::uuid)) x
           where x ->> 'id' = current_setting('v2a4.credit')) = 80, 'C5 ₱80 of the credit left';
end $$;

-- ═══ F. A worker reaches none of it ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_my_cash();
    raise exception 'F3 a worker read cash';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%' or sqlerrm like '%NOT_OFFICE%', 'F3 wrong error: ' || sqlerrm;
  end;
  begin
    perform 1 from pur_payments limit 1;
    raise exception 'F4 a signed-in user read pur_payments directly';
  exception when insufficient_privilege then null;
  end;
  assert not uploads_can_read('pettyCash/' || current_setting('v2a4.owner') || '/2026-10/zz-2a4.jpg', null),
    'F5 a worker reads a return photo';
end $$;

-- ═══ H. Return photos (R13): the main owner reads them; a buyer only their own uploads ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not uploads_can_read('pettyCash/' || current_setting('v2a4.owner') || '/2026-10/zz-2a4.jpg', null),
    'H1 a buyer reads a return photo they did not upload';
  assert uploads_can_write('pettyCash/' || current_setting('v2a4.owner') || '/2026-10/zz-2a4.jpg'),
    'H2 the buyer may upload a return photo';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert uploads_can_read('pettyCash/' || current_setting('v2a4.owner') || '/2026-10/zz-2a4.jpg', null),
    'H3 the main owner reads return photos';
end $$;
reset role;

-- ═══ G. Spent: only the purchases moved it ═══
do $$
declare v_n int; v_s numeric; v_main numeric;
begin
  select coalesce(sum(e.amount), 0) into v_main from expenses e join projects p on p.id = e.project_id
   where p.folder_id = current_setting('v2a4.main')::uuid;
  assert v_main = 1250 + 1000 + 400 + 500, 'G1 the ZZ project''s Spent = its four purchases, not what was paid: ' || v_main;
  select count(*), coalesce(sum(e.amount), 0) into v_n, v_s from expenses e
   where e.owner_id = current_setting('v2a4.owner')::uuid
     and coalesce(e.project_id, '00000000-0000-0000-0000-000000000000') not in (select id from projects where folder_id = current_setting('v2a4.main')::uuid);
  assert v_n::text || '/' || v_s::text = current_setting('v2a4.spent'), 'G2 no other expense row changed';
end $$;

select '2a4 acceptance: all checks passed' as result;
rollback;
```

**Create:** `supabase/tests/2a4_concurrency.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 2A-4a PAYMENTS — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2a4_payments.pglite.mjs)
//
// Same approach as 2a3_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 VERBATIM
// over the same minimal tables, pairs of calls released at the same moment
// on two connections. Nothing touches the live database.
//   1. two buyers use the same supplier credit at once → never past what is left
//   2. two refunds of the same overpayment at once → the same peso resolved once
//   3. two repayments at once → never repaid past what is owed
//   4. the same "paid now" press twice at once → one purchase, one payment
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));

const OWNER = '00000000-0000-0000-0000-00000000000a';
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2a4-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2A-4a payments — two sessions at once (0096 + 0097 + 0101 + 0102 on PostgreSQL)');
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
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql')));
  await admin.query(prBase(ROOT));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')));
  await admin.query(fnText(read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')), 'pm_main_owner_id'));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', 'Pedro');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true); select pur_set_buyer('${BUYER2}', true);`);

  const mkFolder = async (name, parent = null) =>
    (await admin.query(`insert into folders (owner_id, name, parent_folder_id) values ($1, $2, $3) returning id`, [OWNER, name, parent])).rows[0].id;
  const mkPeriod = async (f) => {
    const p = (await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                  values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [OWNER, f])).rows[0].id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
  };
  const buy = (f, amount) => JSON.stringify({ source: 'workmate', purchase_date: '2026-10-14', receipt_total: amount,
    docs: { po_image_url: 'https://example.test/receipt.jpg' },
    lines: [{ destination: 'project', folder_id: f, item_name: 'Lumber', unit: 'pc', amount, unplanned_reason: 'test' }] });
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
  const REC = `select pur_record(gen_random_uuid(), $1::jsonb) r`;
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');
  const periods = async (f) => Number((await admin.query(`select count(*) n from projects where folder_id = $1`, [f])).rows[0].n);
  const spent = async (f) => Number((await admin.query(`select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id
                                                          where p.folder_id = $1`, [f])).rows[0].s);

  const PAY = `select pur_pay(gen_random_uuid(), $1, $2::jsonb) r`;
  const RESOLVE = `select pur_resolve_overpaid(gen_random_uuid(), $1, $2::jsonb, null) r`;
  const REPAY = `select pur_repay_buyer(gen_random_uuid(), $1, $2, '2026-10-14', 'cash', '') r`;
  const asOwner = () => admin.query(`select set_config('test.uid', '${OWNER}', false)`);
  const asBuyer = () => admin.query(`select set_config('test.uid', '${BUYER}', false)`);
  const supplier = (await admin.query(`insert into suppliers (owner_id, name, created_by) values ($1, 'Wilcon', $1) returning id`, [OWNER])).rows[0].id;
  const recordFor = async (f, amount, extra = {}) => {
    await asBuyer();
    const b = JSON.parse(buy(f, amount));
    return (await admin.query(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [JSON.stringify({ ...b, supplier_id: supplier, ...extra })])).rows[0].r.purchase_id;
  };
  const P = (amount, extra = {}) => JSON.stringify({ amount: String(amount), paid_on: '2026-10-14', method: 'cash', source: 'company', ...extra });
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('credit ' + i); await mkPeriod(f);
      const over = await recordFor(f, 100);
      await admin.query(`select pur_pay(gen_random_uuid(), $1, $2::jsonb)`, [over, P(600)]);
      await asOwner();
      const credit = (await one(`select pur_resolve_overpaid(gen_random_uuid(), $1, '[]'::jsonb, '{"amount":"500"}'::jsonb) r`, [over])).r.created[0].credit_id;
      const a = await recordFor(f, 300);
      const b = await recordFor(f, 300);
      const out = await pair(BUYER, PAY, [a, P(300, { source: 'credit', credit_id: credit })],
                             BUYER2, PAY, [b, P(300, { source: 'credit', credit_id: credit })]);
      if (deadlock(out)) dead++;
      const left = Number((await one(`select pur_credit_left($1) v`, [credit])).v);
      const oks = out.filter(o => o.ok).length;
      if (oks !== 1 || left !== 200 || !out.some(o => !o.ok && /OVER_CREDIT/.test(o.msg))) bad++;
    }
    check('1. two buyers use the same ₱500 credit for ₱300 each at once: exactly one is accepted, ₱200 left, never below zero',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('over ' + i); await mkPeriod(f);
      const p = await recordFor(f, 100);
      await admin.query(`select pur_pay(gen_random_uuid(), $1, $2::jsonb)`, [p, P(400)]);
      const part = JSON.stringify([{ amount: '200', funded_by: 'company', received_by: 'company', received_on: '2026-10-14' }]);
      const out = await pair(OWNER, RESOLVE, [p, part], OWNER, RESOLVE, [p, part]);
      if (deadlock(out)) dead++;
      const st = (await one(`select pur_pay_state($1) s`, [p])).s;
      if (out.filter(o => o.ok).length !== 1 || Number(st.resolved) !== 200 || Number(st.unresolved) !== 100) bad++;
    }
    check('2. two ₱200 refunds of the same ₱300 overpayment at once: one is accepted, the same peso is never resolved twice',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 3
  {
    let bad = 0, dead = 0;
    await asOwner();
    await admin.query(`select pur_set_own_money($1, true)`, [BUYER]);
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('own ' + i); await mkPeriod(f);
      const p = await recordFor(f, 1000);
      await admin.query(`select pur_pay(gen_random_uuid(), $1, $2::jsonb)`, [p, P(1000, { source: 'own_money' })]);
      await asOwner();
      const owedBefore = Number((await one(`select pur_owes($1, $2) v`, [OWNER, BUYER])).v);
      const out = await pair(OWNER, REPAY, [BUYER, String(owedBefore - 400)], OWNER, REPAY, [BUYER, String(owedBefore - 400)]);
      if (deadlock(out)) dead++;
      const owed = Number((await one(`select pur_owes($1, $2) v`, [OWNER, BUYER])).v);
      if (out.filter(o => o.ok).length !== 1 || owed !== 400) bad++;
      // settle what is left so the next round starts from what it adds
      await admin.query(`select pur_repay_buyer(gen_random_uuid(), $1, $2, '2026-10-14', 'cash', '')`, [BUYER, String(owed)]);
    }
    check('3. two repayments that together pass what is owed, at once: one is accepted, never repaid past the balance',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 4
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('press ' + i); await mkPeriod(f);
      const press = (await one(`select gen_random_uuid() id`)).id;
      const b = JSON.stringify({ ...JSON.parse(buy(f, 500)), payments: [JSON.parse(P(500))] });
      const SAME = `select pur_record('${press}'::uuid, $1::jsonb) r`;
      const out = await pair(BUYER, SAME, [b], BUYER, SAME, [b]);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select count(*) n from purchases pu join purchase_lines l on l.purchase_id = pu.id where l.folder_id = $1`, [f])).n);
      const pays = Number((await one(`select count(*) n from pur_payments x join purchase_lines l on l.purchase_id = x.purchase_id where l.folder_id = $1`, [f])).n);
      if (out.some(o => !o.ok) || n !== 1 || pays !== 1) bad++;
    }
    check('4. the same "paid now" press sent twice at once: one purchase, one payment, both calls answered',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/2a4_payments.pglite.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 2A-4a PAYING FOR PURCHASES — BEHAVIOUR TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096, 0097, 0101 and 0102 VERBATIM on PGlite (PostgreSQL
// in memory) over the same minimal tables as the 2A-3 suite, plus 0098's
// main-owner check. Nothing here talks to the live database;
// supabase/tests/2a4_acceptance.sql repeats the key cases there, rolled back.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));
const M96 = read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql'));
const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql'));
const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql'));
const M98 = read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql'));
const M102 = read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql'));

// The 2A-1 base schema (same as 2a1_purchase.pglite.mjs), plus the service
// role the sign-in function runs as.
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
const GONE = '00000000-0000-0000-0000-000000000016';     // inactive Buyer staff
const ORPHAN = '00000000-0000-0000-0000-000000000017';   // staff with no owner_id
const NOBODY = '00000000-0000-0000-0000-0000000000ff';   // no profile row
const RECEIPT = 'https://example.supabase.co/storage/v1/object/public/uploads/purchases/' + OWNER +
                '/2026-10/11111111-1111-1111-1111-111111111111.jpg';
let opSeq = 0;
const op = () => '30000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);

// A Philippine calendar date, `days` from today (UTC+8 has no daylight time,
// so shifting by 8 hours before reading the UTC date gives the local date).
function phDate(days = 0) {
  return new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];

// without102: the database as it was before 0102 (to test purchases recorded before it).
async function fresh(opts = {}) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(M97);
  await db.exec(M101);
  if (!opts.without102) {
    await db.exec(fnText(M98, 'pm_main_owner_id'));
    await db.exec(M102);
  }
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', null, 'pedro@dacs.test', 'Pedro'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${LEADER}', 'teamLeader', '${OWNER}', 'active', null, null, 'Lito'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${PMOWNER}', 'owner', '${OWNER}', 'active', '["pm"]'::jsonb, 'admin-pm@dacs.test', null),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null),
    ('${GONE}', 'staff', '${OWNER}', 'active', null, 'gone@dacs.test', 'Gone'),
    ('${ORPHAN}', 'staff', null, 'active', null, 'orphan@dacs.test', 'Orphan');`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
  await db.query(`select pur_set_buyer($1, true)`, [GONE]);
  await db.query(`update profiles set status = 'inactive' where id = $1`, [GONE]);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}

async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function period(db, folderId, budget = 100000, date = phDate(), owner = OWNER) {
  const d = new Date(date + 'T00:00:00Z');
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, 'progress', 1) returning id`,
    [owner, folderId, MONTHS[d.getUTCMonth()], d.getUTCFullYear()])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, owner, budget]);
  return id;
}
function body(lines, extra = {}) {
  const total = extra.receipt_total ?? lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'workmate', purchase_date: phDate(), supplier: 'Wilcon', notes: '', payment_method: 'CASH',
           docs: { po_image_url: RECEIPT }, ...extra, receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Materials', unit: 'bag', unplanned_reason: 'site ran out', ...l })) };
}
async function record(db, b, opId = op()) {
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [opId, JSON.stringify(b)])).r;
}
async function spent(db, folderId) {
  return num((await one(db, `select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id where p.folder_id = $1`, [folderId])).s);
}
async function periodsOf(db, folderId) {
  return all(db, `select p.id, p.month, p.year, p.funding_type,
                         exists (select 1 from project_budgets b where b.project_id = p.id) as has_budget
                    from projects p where p.folder_id = $1 order by p.created_at, p.id`, [folderId]);
}

// ── helpers for 0102 ─────────────────────────────────────────────────
async function supplier(db, name = 'Wilcon', owner = OWNER) {
  return (await one(db, `insert into suppliers (owner_id, name, created_by) values ($1, $2, $1) returning id`, [owner, name])).id;
}
const P = (amount, extra = {}) => ({ amount: String(amount), paid_on: phDate(), method: 'cash', source: 'company', ...extra });
async function pay(db, purchaseId, p, opId = op()) {
  return (await one(db, `select pur_pay($1, $2, $3::jsonb) as r`, [opId, purchaseId, JSON.stringify(p)])).r;
}
async function state(db, purchaseId) {
  return (await one(db, `select pur_pay_state($1) s`, [purchaseId])).s;
}
async function raw(db, buyer, upto = null) {
  return num((await one(db, `select pur_cash_raw($1, $2, $3::date) v`, [OWNER, buyer, upto])).v);
}
async function owes(db, buyer) { return num((await one(db, `select pur_owes($1, $2) v`, [OWNER, buyer])).v); }
async function give(db, buyer, amount, day = phDate()) {
  await as(db, OWNER);
  return (await one(db, `select pur_cash_give($1, $2, $3, $4, 'cash', '') r`, [op(), buyer, String(amount), day])).r;
}
async function money(db) {
  return one(db, `select (select count(*) from expenses) n, (select coalesce(sum(amount), 0) from expenses) s,
                         (select count(*) from payroll) pr`);
}
// A recorded project purchase by `who`, for ₱amount (one line, or several).
async function bought(db, who, amount, extra = {}) {
  const f = extra.folder || await folder(db, 'Barlin ' + (++opSeq));
  if (!extra.folder) await period(db, f);
  await as(db, who);
  const r = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount }], extra.body || {}));
  return { id: r.purchase_id, folder: f, r };
}
async function resolve(db, purchaseId, refunds, credit = null, opId = op()) {
  return (await one(db, `select pur_resolve_overpaid($1, $2, $3::jsonb, $4::jsonb) r`,
    [opId, purchaseId, JSON.stringify(refunds), credit === null ? null : JSON.stringify(credit)])).r;
}

console.log('\n2A-4a paying for purchases (0096 + 0097 + 0101 + 0102 on PGlite)');

// ── A. "Paid now": the purchase and its payments together (Q3) ─────────

await test('paid in full from petty cash at the counter: one send records the purchase AND its payment; Paid; cash held goes down', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await give(db, BUYER, 5000);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 5, amount: 1250 }],
    { payments: [P(1250, { source: 'petty_cash' })] }));
  eq(r.payments.length, 1, 'payment saved with the purchase');
  eq(r.pay.state, 'paid');
  eq(await raw(db, BUYER), 3750, '₱5,000 − ₱1,250');
  eq(num((await one(db, `select person_id::text = $1 as me from pur_payments`, [BUYER])).me ? 1 : 0), 1, 'the buyer\'s own petty cash');
});

await test('a refused payment refuses the purchase too: nothing is saved, and the same press can be sent again fixed', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const press = op();
  const bad = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 500 }], { payments: [P(500, { method: 'bitcoin' })] });
  assert((await code(record(db, bad, press))).includes('BAD_METHOD'), 'refused');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 0, 'no purchase');
  eq(num((await one(db, `select count(*) n from expenses`)).n), 0, 'no Spent');
  eq(num((await one(db, `select count(*) n from pur_ops`)).n), 0, 'the press is not used up');
  const r = await record(db, { ...bad, payments: [P(500)] }, press);
  eq(r.pay.state, 'paid', 'fixed and sent again with the same press');
});

await test('a retry records the purchase and its payment once', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const press = op();
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 500 }], { payments: [P(200), P(300)] });
  const first = await record(db, b, press);
  const again = await record(db, b, press);
  eq(again.replayed, true, 'the first answer');
  eq(again.purchase_id, first.purchase_id);
  eq(num((await one(db, `select count(*) n from purchases`)).n), 1);
  eq(num((await one(db, `select count(*) n from pur_payments`)).n), 2, 'two payments, once');
});

await test('a correction or a replacement never carries payments (BAD_PAY); more than 5 at once refused', async () => {
  const db = await fresh();
  const { id, folder: f } = await bought(db, BUYER, 500);
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 450 }], { payments: [P(450)] });
  assert((await code(db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), id, JSON.stringify(b)]))).includes('BAD_PAY'), 'correct');
  assert((await code(db.query(`select pur_replace($1, $2, $3::jsonb, 'more')`, [op(), id, JSON.stringify(b)]))).includes('BAD_PAY'), 'replace');
  const six = body([{ folder_id: f, item_name: 'Sand', quantity: 1, amount: 600 }], { payments: [1, 2, 3, 4, 5, 6].map(() => P(100)) });
  assert((await code(record(db, six))).includes('BAD_PAY'), 'six');
});

await test('paying at recording needs the Buyer switch: Project Control staff still record, without payments', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, STAFF);
  const b = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 500 }], { source: 'expenses_form' });
  assert((await code(record(db, { ...b, payments: [P(500)] }))).includes('BUYER_REQUIRED'), 'with payments');
  const r = await record(db, b);
  eq((await state(db, r.purchase_id)).state, 'unpaid', 'recorded, Unpaid');
});

// ── B. Payments (Q4–Q8) ─────────────────────────────────────────────────

await test('a deposit, then the rest: Unpaid → Partially paid → Paid, every payment kept', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 10000);
  eq((await state(db, id)).state, 'unpaid');
  await pay(db, id, P(3000));
  let s = await state(db, id);
  eq([s.state, num(s.paid), num(s.balance)], ['partial', 3000, 7000]);
  await pay(db, id, P(2000, { method: 'gcash' }));
  await pay(db, id, P(5000, { method: 'bank_transfer' }));
  s = await state(db, id);
  eq([s.state, num(s.paid), num(s.balance)], ['paid', 10000, 0]);
  eq(num((await one(db, `select count(*) n from pur_payments where purchase_id = $1`, [id])).n), 3, 'never overwritten');
});

await test('spec example 7: ₱10,500 paid on ₱10,000 → Overpaid ₱500; Spent never changes', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 10000);
  const before = await money(db);
  for (const a of [3000, 2000, 5000, 500]) await pay(db, id, P(a));
  const s = await state(db, id);
  eq([s.state, num(s.excess), num(s.unresolved)], ['overpaid', 500, 500]);
  eq(await money(db), before, 'expenses and payroll untouched');
});

await test('one receipt across two projects: one payment on the purchase, never a copy per project', async () => {
  const db = await fresh();
  const a = await folder(db, 'Barlin'); await period(db, a);
  const b = await folder(db, 'Malolos'); await period(db, b);
  await as(db, BUYER);
  const r = await record(db, body([{ folder_id: a, item_name: 'Cement', quantity: 1, amount: 3000 },
                                   { folder_id: b, item_name: 'Sand', quantity: 1, amount: 1000 }], { payments: [P(4000)] }));
  eq(num((await one(db, `select count(*) n from pur_payments`)).n), 1);
  eq(r.pay.state, 'paid');
});

await test('who may pay: buyers of the company; staff without the switch, workers and another company cannot', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER2);
  await pay(db, id, P(100));
  await as(db, OWNER);
  await pay(db, id, P(100));
  for (const [who, want] of [[STAFF, 'BUYER_REQUIRED'], [WORKER, 'BUYER_REQUIRED'], [PMOWNER, 'BUYER_REQUIRED'], [OTHER, 'NOT_FOUND']]) {
    await as(db, who);
    const r = await code(pay(db, id, P(100)));
    assert(r.includes(want), who + ': ' + r);
  }
});

await test('petty cash and own money: a buyer records their own; only the main owner records another buyer\'s', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  assert((await code(pay(db, id, P(100, { source: 'petty_cash', person_id: BUYER2 })))).includes('PERSON_NOT_ALLOWED'), 'another buyer');
  await pay(db, id, P(100, { source: 'petty_cash' }));
  eq(await raw(db, BUYER), -100, 'defaults to the caller');
  await as(db, OWNER);
  assert((await code(pay(db, id, P(100, { source: 'petty_cash' })))).includes('PERSON_REQUIRED'), 'owner must say whose');
  assert((await code(pay(db, id, P(100, { source: 'petty_cash', person_id: OWNER })))).includes('NOT_A_BUYER'), 'the owner holds no petty cash');
  assert((await code(pay(db, id, P(100, { source: 'own_money', person_id: WORKER })))).includes('NOT_A_BUYER'), 'a worker');
  assert((await code(pay(db, id, P(100, { source: 'petty_cash', person_id: 'nope' })))).includes('BAD_PERSON'), 'garbage id');
  await pay(db, id, P(100, { source: 'petty_cash', person_id: BUYER2 }));
  eq(await raw(db, BUYER2), -100, 'the main owner entered it for Pedro');
});

await test('bad payments are refused, nothing saved: ₱0, three decimals, a future or ancient date, unknown source/method, a non-https proof', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  const cases = [[P(0), 'BAD_AMOUNT'], [P('10.005'), 'BAD_AMOUNT'], [P(-5), 'BAD_AMOUNT'], [P(10, { paid_on: phDate(1) }), 'BAD_DATE'],
                 [P(10, { paid_on: '2019-12-31' }), 'BAD_DATE'], [P(10, { paid_on: '2026-02-30' }), 'BAD_DATE'],
                 [P(10, { source: 'loan' }), 'BAD_PAY_SOURCE'], [P(10, { method: 'barter' }), 'BAD_METHOD'],
                 [P(10, { proof_url: 'javascript:alert(1)' }), 'BAD_DOCS'], [P(10, { note: 'x'.repeat(301) }), 'BAD_NOTE'],
                 [P(10, { credit_id: '11111111-1111-1111-1111-111111111111' }), 'BAD_PAY']];
  for (const [p, want] of cases) {
    const r = await code(pay(db, id, p));
    assert(r.includes(want), JSON.stringify(p) + ' → ' + r);
  }
  eq(num((await one(db, `select count(*) n from pur_payments`)).n), 0);
});

await test('no new payment on a voided purchase (BAD_STATE)', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await db.query(`select pur_void($1, $2, 'mistake')`, [op(), id]);
  assert((await code(pay(db, id, P(100)))).includes('BAD_STATE'));
});

await test('Q2: a purchase recorded before 0102 reads "Payment not tracked" until a payment is recorded on it', async () => {
  const db = await fresh({ without102: true });
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, BUYER);
  const old = (await record(db, body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 900 }]))).purchase_id;
  await as(db, '');
  await db.exec(fnText(M98, 'pm_main_owner_id'));
  await db.exec(M102);
  eq((await state(db, old)).state, 'not_tracked', 'not "Unpaid"');
  await as(db, BUYER);
  const fresh2 = (await record(db, body([{ folder_id: f, item_name: 'Sand', quantity: 1, amount: 100 }]))).purchase_id;
  eq((await state(db, fresh2)).state, 'unpaid', 'a new one is tracked');
  await pay(db, old, P(400));
  const s = await state(db, old);
  eq([s.state, s.tracked], ['partial', true], 'one payment turns tracking on');
});

await test('a mistaken payment is voided with a reason by whoever recorded it (or the main owner); never deleted; petty cash comes back', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await give(db, BUYER, 1000);
  await as(db, BUYER);
  const p = (await pay(db, id, P(600, { source: 'petty_cash' }))).payment_id;
  eq(await raw(db, BUYER), 400);
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_void_payment($1, $2, 'not mine')`, [op(), p]))).includes('NOT_YOURS'), 'another buyer');
  await as(db, BUYER);
  assert((await code(db.query(`select pur_void_payment($1, $2, '  ')`, [op(), p]))).includes('REASON_REQUIRED'), 'reason');
  await db.query(`select pur_void_payment($1, $2, 'wrong amount')`, [op(), p]);
  eq(await raw(db, BUYER), 1000, 'the cash is back');
  eq((await state(db, id)).state, 'unpaid');
  assert((await code(db.query(`select pur_void_payment($1, $2, 'again')`, [op(), p]))).includes('ALREADY_VOIDED'));
  eq(num((await one(db, `select count(*) n from pur_payments where id = $1 and voided_at is not null`, [p])).n), 1, 'kept, voided');
  await as(db, OWNER);
  const q = (await pay(db, id, P(100))).payment_id;
  await as(db, BUYER);
  await as(db, OWNER);
  await db.query(`select pur_void_payment($1, $2, 'owner fixes it')`, [op(), q]);
});

await test('Q8: a lower corrected total makes it Overpaid; a voided purchase with payments is "to recover"; Spent follows only the purchase', async () => {
  const db = await fresh();
  const { id, folder: f } = await bought(db, BUYER, 1000);
  await pay(db, id, P(1000));
  await as(db, BUYER);
  const fixed = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 800 }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'discount')`, [op(), id, JSON.stringify(fixed)]);
  let s = await state(db, id);
  eq([s.state, num(s.excess)], ['overpaid', 200]);
  eq(await spent(db, f), 800, 'Spent = the corrected purchase, payments ignored');
  await db.query(`select pur_void($1, $2, 'cancelled')`, [op(), id]);
  s = await state(db, id);
  eq([s.state, num(s.due), num(s.unresolved)], ['void_paid', 0, 1000]);
  eq(await spent(db, f), 0);
});

await test('a replacement takes its payments, refunds and "not tracked" with it', async () => {
  const db = await fresh();
  const { id, folder: f } = await bought(db, BUYER, 1000);
  await pay(db, id, P(400));
  await as(db, BUYER);
  const two = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 1000 }, { folder_id: f, item_name: 'Nails', quantity: 1, amount: 50 }]);
  const r = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot nails') r`, [op(), id, JSON.stringify(two)])).r;
  eq(num((await one(db, `select count(*) n from pur_payments where purchase_id = $1`, [r.purchase_id])).n), 1, 'moved');
  const s = await state(db, r.purchase_id);
  eq([s.state, num(s.paid), num(s.balance)], ['partial', 400, 650]);
  eq((await state(db, id)).state, 'void', 'the old version has nothing to recover');
});

// ── C. Overpaid, refunds, supplier credit (Q9–Q12) ──────────────────────

await test('only the main owner (with Expenses) resolves Overpaid', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 100);
  await pay(db, id, P(150));
  for (const who of [BUYER, STAFF, PMOWNER, EXPOWNER, WORKER]) {
    await as(db, who);
    const r = await code(resolve(db, id, [{ amount: '50', funded_by: 'company', received_by: 'company', received_on: phDate() }]));
    assert(r.includes('OWNER_ONLY') || r.includes('NOT_ALLOWED'), who + ': ' + r);
  }
  await as(db, OWNER);
  await db.query(`update profiles set allowed_modules = '["pm"]'::jsonb where id = $1`, [OWNER]);
  assert((await code(resolve(db, id, [{ amount: '50', funded_by: 'company', received_by: 'company', received_on: phDate() }]))).includes('NOT_ALLOWED'),
    'a main owner focused away from Expenses');
});

await test('the agreed example: ₱700 petty cash + ₱300 own money, ₱500 over → ₱300 back into petty cash, ₱200 to the buyer', async () => {
  const db = await fresh();
  await as(db, OWNER);
  await db.query(`select pur_set_own_money($1, true)`, [BUYER]);
  await give(db, BUYER, 700);
  const { id, folder: f } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  await pay(db, id, P(700, { source: 'petty_cash' }));
  await pay(db, id, P(300, { source: 'own_money' }));
  const fixed = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 500 }]);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'half returned')`, [op(), id, JSON.stringify(fixed)]);
  eq([await raw(db, BUYER), await owes(db, BUYER)], [0, 300], 'before');
  await as(db, OWNER);
  const list = (await one(db, `select pur_overpaid() r`)).r;
  eq(list.length, 1);
  const sug = Object.fromEntries(list[0].suggested.map(x => [x.source, num(x.amount)]));
  eq(sug, { own_money: 300, petty_cash: 200 }, 'suggested: the latest payments first (own money, then petty cash)');
  await resolve(db, id, [
    { amount: '300', funded_by: 'petty_cash', person_id: BUYER, received_by: 'petty_cash', received_on: phDate() },
    { amount: '200', funded_by: 'own_money', person_id: BUYER, received_by: 'buyer', received_on: phDate() }]);
  eq([await raw(db, BUYER), await owes(db, BUYER)], [300, 100], 'cash held +₱300, company owes −₱200');
  eq((await state(db, id)).state, 'paid', 'resolved');
  eq((await one(db, `select pur_overpaid() r`)).r.length, 0, 'off the list');
});

await test('each refund part is capped by what that money paid; the total by what is over; the same peso is resolved once', async () => {
  const db = await fresh();
  await give(db, BUYER, 1000);
  const { id } = await bought(db, BUYER, 600);
  await as(db, BUYER);
  await pay(db, id, P(400, { source: 'petty_cash' }));
  await pay(db, id, P(400));   // company
  await as(db, OWNER);
  const part = (amount, funded_by, received_by, person_id) => ({ amount: String(amount), funded_by, received_by, person_id, received_on: phDate() });
  assert((await code(resolve(db, id, [part(250, 'company', 'company')]))).includes('OVER_RESOLVED'), 'over is ₱200');
  assert((await code(resolve(db, id, [part(150, 'own_money', 'buyer', BUYER)]))).includes('OVER_SOURCE'), 'no own money paid');
  assert((await code(resolve(db, id, [part(150, 'petty_cash', 'company', BUYER2)]))).includes('OVER_SOURCE'), 'Pedro\'s cash did not pay');
  assert((await code(resolve(db, id, [part(100, 'company', 'company'), part(150, 'petty_cash', 'company', BUYER)]))).includes('OVER_RESOLVED'),
    'all or nothing');
  eq(num((await one(db, `select count(*) n from pur_refunds`)).n), 0, 'nothing kept from the refused call');
  await resolve(db, id, [part(120, 'company', 'company'), part(80, 'petty_cash', 'company', BUYER)]);
  assert((await code(resolve(db, id, [part(1, 'company', 'company')]))).includes('OVER_RESOLVED'), 'resolved once');
  assert((await code(resolve(db, id, []))).includes('NOTHING_TO_RESOLVE'));
});

await test('refund routes: back into petty cash or to the company; company money refunded to the buyer is cash they hold; bad routes refused', async () => {
  const db = await fresh();
  await give(db, BUYER, 500);
  const { id } = await bought(db, BUYER, 100);
  await as(db, BUYER);
  await pay(db, id, P(300, { source: 'petty_cash' }));
  await as(db, OWNER);
  await pay(db, id, P(300));   // the owner paid too: ₱500 over
  const part = (amount, funded_by, received_by, person_id) => ({ amount: String(amount), funded_by, received_by, person_id, received_on: phDate() });
  assert((await code(resolve(db, id, [part(10, 'own_money', 'petty_cash', BUYER)]))).includes('BAD_REFUND_ROUTE'));
  assert((await code(resolve(db, id, [part(10, 'petty_cash', 'buyer', BUYER)]))).includes('BAD_REFUND_ROUTE'));
  assert((await code(resolve(db, id, [part(10, 'company', 'petty_cash', null)]))).includes('NOT_A_BUYER'), 'who received it');
  const held = await raw(db, BUYER);
  await resolve(db, id, [part(100, 'petty_cash', 'company', BUYER)]);
  eq(await raw(db, BUYER), held, 'petty cash → company moves no balance');
  await resolve(db, id, [part(250, 'company', 'petty_cash', BUYER)]);
  eq(await raw(db, BUYER), held + 250, 'company money now held by the buyer');
});

await test('a supplier credit is a balance: used in parts on later purchases until gone, each use once; it is not cash', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  const ace = await supplier(db, 'Ace');
  const { id } = await bought(db, BUYER, 1000, { body: { supplier_id: wil } });
  await pay(db, id, P(1500));
  await as(db, OWNER);
  const credit = (await resolve(db, id, [], { amount: '500', note: 'credit memo 1234' })).created[0].credit_id;
  const b = await bought(db, BUYER, 400, { body: { supplier_id: wil } });
  const c2 = await bought(db, BUYER, 400, { body: { supplier_id: wil } });
  const other = await bought(db, BUYER, 400, { body: { supplier_id: ace } });
  await give(db, BUYER, 1000);
  await as(db, BUYER);
  const held = await raw(db, BUYER);
  const use = op();
  await pay(db, b.id, P(200, { source: 'credit', credit_id: credit }), use);
  await pay(db, b.id, P(200, { source: 'credit', credit_id: credit }), use);   // a retry
  eq(num((await one(db, `select pur_credit_left($1) v`, [credit])).v), 300, 'used once: ₱300 left');
  await pay(db, b.id, P(200, { source: 'petty_cash' }));
  eq((await state(db, b.id)).state, 'paid', 'credit + cash = the full cost');
  assert((await code(pay(db, c2.id, P(301, { source: 'credit', credit_id: credit })))).includes('OVER_CREDIT'), 'never past what is left');
  const last = (await pay(db, c2.id, P(300, { source: 'credit', credit_id: credit }))).payment_id;
  eq(num((await one(db, `select pur_credit_left($1) v`, [credit])).v), 0, 'used up');
  assert((await code(pay(db, other.id, P(1, { source: 'credit', credit_id: credit })))).includes('CREDIT_SUPPLIER'), 'another supplier');
  eq(await raw(db, BUYER), held - 200, 'only the ₱200 cash left the petty cash');
  await db.query(`select pur_void_payment($1, $2, 'wrong')`, [op(), last]);
  eq(num((await one(db, `select pur_credit_left($1) v`, [credit])).v), 300, 'a voided use gives it back');
  await as(db, OWNER);
  assert((await code(db.query(`select pur_void_credit($1, $2, 'x')`, [op(), credit]))).includes('CREDIT_USED'), 'used credit stays');
  const listed = (await one(db, `select pur_credits($1) r`, [wil])).r;
  eq(listed.map(x => num(x.left)), [300]);
});

await test('Q10: an overpaid credit-funded payment goes back to that supplier\'s credit (suggested), unless a real refund is recorded', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  const first = await bought(db, BUYER, 100, { body: { supplier_id: wil } });
  await pay(db, first.id, P(600));
  await as(db, OWNER);
  const credit = (await resolve(db, first.id, [], { amount: '500' })).created[0].credit_id;
  const { id, folder: f } = await bought(db, BUYER, 500, { body: { supplier_id: wil } });
  await as(db, BUYER);
  await pay(db, id, P(500, { source: 'credit', credit_id: credit }));
  const fixed = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 300 }], { supplier_id: wil });
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'two bags back')`, [op(), id, JSON.stringify(fixed)]);
  await as(db, OWNER);
  const row = (await one(db, `select pur_overpaid() r`)).r.find(x => x.id === id);
  eq(row.suggested.map(x => [x.source, num(x.amount)]), [['credit', 200]], 'the excess came from credit');
  await resolve(db, id, [], { amount: '200', note: 'back to Wilcon credit' });
  eq((await one(db, `select pur_credits($1) r`, [wil])).r.reduce((s, x) => s + num(x.left), 0), 200, 'Wilcon credit ₱200 again');
});

await test('a payment that was refunded cannot be voided until the refund is (RESOLVED_FIRST)', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 100);
  await as(db, OWNER);
  const p = (await pay(db, id, P(300))).payment_id;
  const r = (await resolve(db, id, [{ amount: '200', funded_by: 'company', received_by: 'company', received_on: phDate() }])).created[0].refund_id;
  assert((await code(db.query(`select pur_void_payment($1, $2, 'oops')`, [op(), p]))).includes('RESOLVED_FIRST'));
  await db.query(`select pur_void_refund($1, $2, 'entered wrong')`, [op(), r]);
  await db.query(`select pur_void_payment($1, $2, 'oops')`, [op(), p]);
  eq((await state(db, id)).state, 'unpaid');
  // Still more over than resolved after the void — only "refunded more than that money paid" can stop it.
  const db2 = await fresh();
  await give(db2, BUYER, 300);
  const b = await bought(db2, BUYER, 1000);
  await as(db2, BUYER);
  const petty = (await pay(db2, b.id, P(300, { source: 'petty_cash' }))).payment_id;
  await as(db2, OWNER);
  await pay(db2, b.id, P(1500));
  await resolve(db2, b.id, [{ amount: '300', funded_by: 'petty_cash', person_id: BUYER, received_by: 'petty_cash', received_on: phDate() }]);
  assert((await code(db2.query(`select pur_void_payment($1, $2, 'oops')`, [op(), petty]))).includes('RESOLVED_FIRST'),
    'petty cash refunded ₱300 it would no longer have paid');
});

await test('a credit needs a listed supplier: the purchase\'s, or one picked when confirming', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 100, { body: { supplier: 'Sari-sari store' } });
  await pay(db, id, P(150));
  await as(db, OWNER);
  assert((await code(resolve(db, id, [], { amount: '50' }))).includes('CREDIT_SUPPLIER'), 'no supplier on the list');
  const s = await supplier(db, 'Sari-sari store');
  await resolve(db, id, [], { amount: '50', supplier_id: s });
  eq((await state(db, id)).state, 'paid');
});

await test('a payment a supplier credit relies on cannot be voided either (more would be given back than is over)', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  const { id } = await bought(db, BUYER, 100, { body: { supplier_id: wil } });
  await as(db, OWNER);
  const p = (await pay(db, id, P(300))).payment_id;
  const credit = (await resolve(db, id, [], { amount: '200' })).created[0].credit_id;
  // No refund here: only "what is over" can stop this void.
  assert((await code(db.query(`select pur_void_payment($1, $2, 'oops')`, [op(), p]))).includes('RESOLVED_FIRST'));
  await db.query(`select pur_void_credit($1, $2, 'entered wrong')`, [op(), credit]);
  await db.query(`select pur_void_payment($1, $2, 'oops')`, [op(), p]);
  eq((await state(db, id)).state, 'unpaid');
});

await test('Q10: a credit-funded overpayment may instead be refunded in cash — to the company, or into a buyer\'s hands (cash they hold)', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  const first = await bought(db, BUYER, 100, { body: { supplier_id: wil } });
  await pay(db, first.id, P(600));
  await as(db, OWNER);
  const credit = (await resolve(db, first.id, [], { amount: '500' })).created[0].credit_id;
  const { id, folder: f } = await bought(db, BUYER, 500, { body: { supplier_id: wil } });
  await as(db, BUYER);
  await pay(db, id, P(500, { source: 'credit', credit_id: credit }));
  const fixed = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 300 }], { supplier_id: wil });
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'two bags back')`, [op(), id, JSON.stringify(fixed)]);
  await as(db, OWNER);
  const part = (amount, received_by, person_id) => ({ amount: String(amount), funded_by: 'credit', received_by, person_id, received_on: phDate() });
  assert((await code(resolve(db, id, [part(600, 'company')]))).includes('OVER_SOURCE'), 'never more than the credit paid');
  assert((await code(resolve(db, id, [part(10, 'buyer', BUYER)]))).includes('BAD_REFUND_ROUTE'), 'credit money is not the buyer\'s own');
  const held = await raw(db, BUYER);
  await resolve(db, id, [part(120, 'company'), part(80, 'petty_cash', BUYER)]);
  eq((await state(db, id)).state, 'paid', 'resolved by refunds, not credit');
  eq(await raw(db, BUYER), held + 80, 'the ₱80 handed to the buyer is cash they hold');
  eq((await one(db, `select pur_credits($1) r`, [wil])).r.reduce((s, x) => s + num(x.left), 0), 0, 'the credit was not restored');
});

await test('pur_cash_buyer: the main owner reads one buyer\'s entries (counts included); a buyer cannot', async () => {
  const db = await fresh();
  await give(db, BUYER, 1000);
  await as(db, OWNER);
  await db.query(`select pur_cash_count($1, $2, $3, '900', 'site')`, [op(), BUYER, phDate()]);
  const d = (await one(db, `select pur_cash_buyer($1) d`, [BUYER])).d;
  eq([num(d.held), d.issues.length, d.counts.length, num(d.counts[0].recorded)], [1000, 1, 1, 1000]);
  assert((await code(db.query(`select pur_cash_buyer($1)`, [WORKER]))).includes('NOT_A_BUYER'));
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_cash_buyer($1)`, [BUYER]))).includes('OWNER_ONLY'), 'another buyer');
  await as(db, BUYER);
  eq((await one(db, `select pur_my_cash() m`)).m.counts.length, 1, 'a buyer sees their own counts too');
});

// ── D. Petty cash (Q13–Q20) ─────────────────────────────────────────────

await test('only the main owner gives petty cash, and only to a staff buyer', async () => {
  const db = await fresh();
  for (const who of [BUYER, STAFF, PMOWNER, EXPOWNER]) {
    await as(db, who);
    const r = await code(db.query(`select pur_cash_give($1, $2, '1000', $3, 'cash', '')`, [op(), BUYER, phDate()]));
    assert(r.includes('OWNER_ONLY') || r.includes('NOT_ALLOWED'), who + ': ' + r);
  }
  await as(db, OWNER);
  for (const target of [STAFF, WORKER, OWNER, GONE]) {
    const r = await code(db.query(`select pur_cash_give($1, $2, '1000', $3, 'cash', '')`, [op(), target, phDate()]));
    assert(r.includes('NOT_A_BUYER'), target + ': ' + r);
  }
  await give(db, BUYER, 1000);
  eq(await raw(db, BUYER), 1000, 'counts at once (Q14)');
});

await test('Q14: "I did not receive this" flags it without changing the balance; the main owner clears the flag or voids the entry', async () => {
  const db = await fresh();
  const issue = (await give(db, BUYER, 1000)).issue_id;
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_cash_dispute($1, $2, 'not me')`, [op(), issue]))).includes('NOT_FOUND'), 'only the buyer it was given to');
  await as(db, BUYER);
  await db.query(`select pur_cash_dispute($1, $2, 'only got 500')`, [op(), issue]);
  eq(await raw(db, BUYER), 1000, 'balance unchanged');
  assert((await code(db.query(`select pur_cash_dispute($1, $2, 'again')`, [op(), issue]))).includes('ALREADY_DISPUTED'));
  await as(db, OWNER);
  eq((await one(db, `select pur_cash_tracker() t`)).t.disputes.length, 1, 'on the tracker');
  await db.query(`select pur_cash_clear_dispute($1, $2, 'handed over at the site, he forgot')`, [op(), issue]);
  eq((await one(db, `select pur_cash_tracker() t`)).t.disputes.length, 0);
  await db.query(`select pur_cash_void_issue($1, $2, 'entered twice')`, [op(), issue]);
  eq(await raw(db, BUYER), 0, 'a void takes it out');
});

await test('Q17: a reported return waits; only the main owner\'s confirmation lowers the balance; a rejection needs a reason; the buyer may withdraw', async () => {
  const db = await fresh();
  await give(db, BUYER, 1000);
  await as(db, BUYER);
  const a = (await one(db, `select pur_cash_report_return($1, '300', $2, 'Sir John', '', '') r`, [op(), phDate()])).r.return_id;
  eq(await raw(db, BUYER), 1000, 'not until confirmed');
  eq(num((await one(db, `select pur_my_cash() m`)).m.pending_returns), 300, 'shown apart');
  const b = (await one(db, `select pur_cash_report_return($1, '50', $2, '', '', '') r`, [op(), phDate()])).r.return_id;
  await db.query(`select pur_cash_withdraw_return($1, $2)`, [op(), b]);
  await as(db, OWNER);
  assert((await code(db.query(`select pur_cash_decide_return($1, $2, false, '')`, [op(), a]))).includes('REASON_REQUIRED'));
  assert((await code(db.query(`select pur_cash_decide_return($1, $2, true, '')`, [op(), b]))).includes('BAD_STATE'), 'withdrawn');
  await db.query(`select pur_cash_decide_return($1, $2, true, 'counted')`, [op(), a]);
  eq(await raw(db, BUYER), 700);
  await as(db, BUYER);
  assert((await code(db.query(`select pur_cash_withdraw_return($1, $2)`, [op(), a]))).includes('BAD_STATE'), 'decided');
  const c = (await one(db, `select pur_cash_report_return($1, '100', $2, '', '', '') r`, [op(), phDate()])).r.return_id;
  await as(db, OWNER);
  await db.query(`select pur_cash_decide_return($1, $2, false, 'never received')`, [op(), c]);
  eq(await raw(db, BUYER), 700, 'a rejection changes nothing');
  await db.query(`select pur_cash_void_return($1, $2, 'it was ₱200')`, [op(), a]);
  eq(await raw(db, BUYER), 1000, 'a confirmed return voided');
  await as(db, WORKER);
  assert((await code(db.query(`select pur_cash_report_return($1, '1', $2, '', '', '')`, [op(), phDate()]))).includes('BUYER_REQUIRED'));
});

await test('Q16: paying more than the petty cash recorded keeps the payment; cash held reads ₱0 and the rest is an unreconciled shortfall', async () => {
  const db = await fresh();
  await give(db, BUYER, 800);
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  await pay(db, id, P(1000, { source: 'petty_cash' }));
  const m = (await one(db, `select pur_my_cash() m`)).m;
  eq([num(m.recorded), num(m.held), num(m.shortfall)], [-200, 0, 200]);
  await give(db, BUYER, 200, phDate());
  const t = (await one(db, `select pur_cash_tracker() t`)).t.buyers.find(x => x.buyer_id === BUYER);
  eq([num(t.held), num(t.shortfall)], [0, 0], 'reconciled by recording the missing handover');
});

await test('Q19: a cash count is a record only, shown against the balance recorded that day', async () => {
  const db = await fresh();
  await give(db, BUYER, 3500);
  await as(db, OWNER);
  await db.query(`select pur_cash_count($1, $2, $3, '3200', 'counted at the site')`, [op(), BUYER, phDate()]);
  const t = (await one(db, `select pur_cash_tracker() t`)).t.buyers.find(x => x.buyer_id === BUYER);
  eq([num(t.last_count.counted), num(t.last_count.recorded)], [3200, 3500], 'short ₱300');
  eq(await raw(db, BUYER), 3500, 'no balance change');
  await as(db, BUYER);
  assert((await code(db.query(`select pur_cash_count($1, $2, $3, '1', '')`, [op(), BUYER, phDate()]))).includes('OWNER_ONLY'));
});

await test('Q18/Q20 the daily report: opening + received + refunds in − payments − confirmed returns = closing; a return counts on its confirmation day; empty days skipped', async () => {
  const db = await fresh();
  await give(db, BUYER, 5000, phDate(-3));
  const { id } = await bought(db, BUYER, 1500);
  await as(db, BUYER);
  await pay(db, id, P(1500, { source: 'petty_cash', paid_on: phDate(-2) }));
  await db.query(`select pur_cash_report_return($1, '1000', $2, 'Sir', '', '')`, [op(), phDate(-1)]);
  await as(db, OWNER);
  const ret = (await one(db, `select id from pur_cash_returns`)).id;
  await db.query(`select pur_cash_decide_return($1, $2, true, '')`, [op(), ret]);
  const rep = (await one(db, `select pur_cash_report($1, $2, $3) r`, [BUYER, phDate(-5), phDate()])).r;
  eq(rep.days.map(d => d.day), [phDate(-3), phDate(-2), phDate()], 'three days with entries; the handover day is not one of them');
  eq(rep.days.map(d => [num(d.opening), num(d.closing)]), [[0, 5000], [5000, 3500], [3500, 2500]]);
  for (const d of rep.days) {
    const sum = (k) => d[k].reduce((s, x) => s + num(x.amount), 0);
    eq(num(d.opening) + sum('received') + sum('refunds_in') - sum('payments') - sum('returns'), num(d.closing), d.day + ' adds up');
  }
  eq(rep.days[2].returns[0].handed_on, phDate(-1), 'shown with its handover day');
  eq(rep.days[1].payments[0].items, ['Cement'], 'what was bought');
  eq([num(rep.opening), num(rep.closing)], [0, 2500]);
  assert((await code(db.query(`select pur_cash_report($1, $2, $3)`, [BUYER, phDate(-100), phDate()]))).includes('BAD_RANGE'), 'at most 92 days');
});

await test('R7: a voided entry stays on its own day; the void is a reversal on the day it was made — past closings never change', async () => {
  const db = await fresh();
  const issue = (await give(db, BUYER, 1000, phDate(-2))).issue_id;
  const { id } = await bought(db, BUYER, 300);
  await as(db, BUYER);
  const p = (await pay(db, id, P(300, { source: 'petty_cash', paid_on: phDate(-1) }))).payment_id;
  await as(db, OWNER);
  const before = (await one(db, `select pur_cash_report($1, $2, $3) r`, [BUYER, phDate(-2), phDate(-1)])).r;
  await as(db, BUYER);
  await db.query(`select pur_void_payment($1, $2, 'double entry')`, [op(), p]);
  await as(db, OWNER);
  await db.query(`select pur_cash_void_issue($1, $2, 'given twice')`, [op(), issue]);
  const rep = (await one(db, `select pur_cash_report($1, $2, $3) r`, [BUYER, phDate(-2), phDate()])).r;
  eq(rep.days.map(d => d.day), [phDate(-2), phDate(-1), phDate()]);
  eq(rep.days.slice(0, 2).map(d => num(d.closing)), before.days.map(d => num(d.closing)), 'the past closings are what they were');
  eq([rep.days[1].payments[0].voided_on, rep.days[0].received[0].voided_on], [phDate(), phDate()], 'marked voided, still on their days');
  eq(rep.days[2].reversals.map(r => [r.what, num(r.effect), r.reason]),
     [['Paid to supplier', 300, 'double entry'], ['Petty cash given', -1000, 'given twice']], 'today: the two reversals');
  for (const d of rep.days) {
    const sum = (k) => d[k].reduce((s, x) => s + num(x.amount), 0);
    const rev = d.reversals.reduce((s, x) => s + num(x.effect), 0);
    eq(num(d.opening) + sum('received') + sum('refunds_in') - sum('payments') - sum('returns') + rev, num(d.closing), d.day + ' adds up');
  }
  eq(await raw(db, BUYER), 0, 'today: both undone');
});

await test('R11: a confirmed return of more than is recorded leaves cash held at ₱0 and the rest as an unreconciled shortfall', async () => {
  const db = await fresh();
  await give(db, BUYER, 500);
  await as(db, BUYER);
  const r = (await one(db, `select pur_cash_report_return($1, '800', $2, '', '', '') r`, [op(), phDate()])).r.return_id;
  await as(db, OWNER);
  await db.query(`select pur_cash_decide_return($1, $2, true, 'counted ₱800')`, [op(), r]);
  const t = (await one(db, `select pur_cash_tracker() t`)).t.buyers.find(x => x.buyer_id === BUYER);
  eq([num(t.recorded), num(t.held), num(t.shortfall)], [-300, 0, 300]);
});

await test('R4: a replacement moves each payment with its own history entry; the payment keeps its first purchase', async () => {
  const db = await fresh();
  const { id, folder: f } = await bought(db, BUYER, 1000);
  const a = (await pay(db, id, P(300))).payment_id;
  const b = (await pay(db, id, P(200, { method: 'gcash' }))).payment_id;
  await as(db, BUYER);
  const two = body([{ folder_id: f, item_name: 'Cement', quantity: 1, amount: 1000 }, { folder_id: f, item_name: 'Nails', quantity: 1, amount: 50 }]);
  const n = (await one(db, `select pur_replace($1, $2, $3::jsonb, 'forgot nails') r`, [op(), id, JSON.stringify(two)])).r.purchase_id;
  const rows = await all(db, `select id, purchase_id, first_purchase_id, amount, paid_on, method from pur_payments order by amount`);
  eq(rows.map(r => [r.purchase_id === n, r.first_purchase_id === id, num(r.amount), r.method]),
     [[true, true, 200, 'gcash'], [true, true, 300, 'cash']], 'moved, every detail kept');
  const ev = await all(db, `select ref_id, purchase_id, detail ->> 'from_purchase' f from pur_money_events where kind = 'payment_moved' order by amount`);
  eq(ev.map(e => [e.ref_id, e.purchase_id === n, e.f === id]), [[b, true, true], [a, true, true]], 'one entry per payment');
  eq([(await state(db, id)).state, (await state(db, n)).state, num((await state(db, n)).paid)], ['void', 'partial', 500],
     'counted once, on the new version');
  const pv = (await one(db, `select pur_purchase_payments($1) v`, [n])).v;
  eq(pv.payments.map(x => x.moved), [true, true]);
});

await test('R9: the main owner rejects an own-money claim with a reason — never owed, the decision kept, no second decision', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  const p = (await pay(db, id, P(400, { source: 'own_money' }))).payment_id;
  assert((await code(db.query(`select pur_reject_own_money($1, $2, 'no')`, [op(), p]))).includes('OWNER_ONLY'));
  await as(db, OWNER);
  assert((await code(db.query(`select pur_reject_own_money($1, $2, ' ')`, [op(), p]))).includes('REASON_REQUIRED'));
  await db.query(`select pur_reject_own_money($1, $2, 'I said to wait for petty cash')`, [op(), p]);
  eq(await owes(db, BUYER), 0, 'never owed');
  await as(db, BUYER);
  eq(num((await one(db, `select pur_my_cash() m`)).m.owes_to_review), 0, 'off the review list');
  await as(db, OWNER);
  eq((await one(db, `select pur_cash_tracker() t`)).t.to_review.length, 0);
  assert((await code(db.query(`select pur_accept_own_money($1, $2)`, [op(), p]))).includes('BAD_STATE'), 'no accept after a reject');
  assert((await code(db.query(`select pur_reject_own_money($1, $2, 'again')`, [op(), p]))).includes('BAD_STATE'), 'once');
  eq((await state(db, id)).state, 'partial', 'the supplier was still paid');
  const j = (await one(db, `select pur_payment_json($1) j`, [p])).j;
  eq(j.reject_reason, 'I said to wait for petty cash');
  eq((await all(db, `select kind from pur_money_events where ref_id = $1 order by seq`, [p])).map(r => r.kind), ['paid', 'own_money_rejected']);
});

await test('R13: a return photo lives in pettyCash/, read only by the main owner and the buyer who uploaded it', async () => {
  const db = await fresh();
  const mine = `pettyCash/${OWNER}/2026-10/44444444-4444-4444-4444-444444444444.jpg`;
  await db.query(`insert into receipt_uploads (path, owner_id, kind, uploaded_by, state) values ($1, $2, 'petty_cash', $3, 'pending')`, [mine, OWNER, BUYER]);
  const can = async (who, fn) => { await as(db, who); return (await one(db, fn === 'r' ? `select uploads_can_read($1, $2) x` : `select uploads_can_write($1) x`, fn === 'r' ? [mine, BUYER] : [mine])).x; };
  eq([await can(BUYER, 'r'), await can(OWNER, 'r'), await can(BUYER2, 'r'), await can(STAFF, 'r'), await can(EXPOWNER, 'r'), await can(WORKER, 'r')],
     [true, true, false, false, false, false], 'the uploader and the main owner only (even with the uploader id passed for another reader)');
  eq([await can(BUYER, 'w'), await can(STAFF, 'w'), await can(WORKER, 'w')], [true, false, false], 'buyers of the company write');
  const url = 'https://example.supabase.co/storage/v1/object/public/uploads/' + mine;
  await as(db, BUYER2);
  assert((await code(db.query(`select pur_cash_report_return($1, '1', $2, '', $3, '')`, [op(), phDate(), url]))).includes('BAD_DOCS'),
    'another buyer cannot attach it');
  const purchasesPath = `purchases/${OWNER}/2026-10/55555555-5555-5555-5555-555555555555.jpg`;
  await db.query(`insert into receipt_uploads (path, owner_id, kind, uploaded_by, state) values ($1, $2, 'purchase', $3, 'pending')`, [purchasesPath, OWNER, BUYER]);
  await as(db, BUYER);
  assert((await code(db.query(`select pur_cash_report_return($1, '1', $2, '', $3, '')`, [op(), phDate(),
    'https://example.supabase.co/storage/v1/object/public/uploads/' + purchasesPath]))).includes('BAD_DOCS'), 'never from the shared purchases folder');
  await db.query(`select pur_cash_report_return($1, '1', $2, '', $3, '')`, [op(), phDate(), url]);
  eq((await one(db, `select state from receipt_uploads where path = $1`, [mine])).state, 'attached', 'the uploader attaches their own');
});

await test('Q24: the tracker and report are the main owner\'s; a buyer sees only their own cash', async () => {
  const db = await fresh();
  await give(db, BUYER, 1000);
  await give(db, BUYER2, 2000);
  for (const who of [BUYER, STAFF, PMOWNER, EXPOWNER]) {
    await as(db, who);
    assert((await code(db.query(`select pur_cash_tracker()`))).match(/OWNER_ONLY|NOT_ALLOWED/), who + ' tracker');
    assert((await code(db.query(`select pur_cash_report($1, $2, $3)`, [BUYER, phDate(), phDate()]))).match(/OWNER_ONLY|NOT_ALLOWED/), who + ' report');
    assert((await code(db.query(`select pur_overpaid()`))).match(/OWNER_ONLY|NOT_ALLOWED/), who + ' overpaid');
  }
  await as(db, BUYER);
  const mine = (await one(db, `select pur_my_cash() m`)).m;
  eq([num(mine.held), mine.issues.length], [1000, 1], 'Juan sees his ₱1,000 only');
  await as(db, OWNER);
  eq((await one(db, `select pur_my_cash() m`)).m.holder, false, 'the owner holds no petty cash');
  const t = (await one(db, `select pur_cash_tracker() t`)).t;
  eq(t.buyers.map(b => [b.name, num(b.held)]).sort(), [['Juan', 1000], ['Pedro', 2000]], 'both buyers, GONE has nothing');
});

// ── E. The buyer's own money (Q21, Q22) ─────────────────────────────────

await test('Q21: own money while "May use own money" is off is kept and flagged, not owed until the main owner accepts it', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  const p = (await pay(db, id, P(400, { source: 'own_money' }))).payment_id;
  eq((await one(db, `select authorized from pur_payments where id = $1`, [p])).authorized, false);
  eq([await owes(db, BUYER), num((await one(db, `select pur_my_cash() m`)).m.owes_to_review)], [0, 400]);
  eq((await state(db, id)).state, 'partial', 'it still paid the supplier');
  await as(db, BUYER);
  assert((await code(db.query(`select pur_accept_own_money($1, $2)`, [op(), p]))).includes('OWNER_ONLY'));
  await as(db, OWNER);
  eq((await one(db, `select pur_cash_tracker() t`)).t.to_review.length, 1);
  await db.query(`select pur_accept_own_money($1, $2)`, [op(), p]);
  eq(await owes(db, BUYER), 400);
  assert((await code(db.query(`select pur_accept_own_money($1, $2)`, [op(), p]))).includes('BAD_STATE'), 'once');
  await db.query(`select pur_set_own_money($1, true)`, [BUYER]);
  await as(db, BUYER);
  const q = (await pay(db, id, P(100, { source: 'own_money' }))).payment_id;
  eq((await one(db, `select authorized from pur_payments where id = $1`, [q])).authorized, true, 'switch on: authorized');
  eq(num((await one(db, `select count(*) n from pur_money_events where kind = 'own_money_on'`)).n), 1, 'switch history');
});

await test('Q22: repayments are the main owner\'s, never more than owed, voided with a reason', async () => {
  const db = await fresh();
  await as(db, OWNER);
  await db.query(`select pur_set_own_money($1, true)`, [BUYER]);
  const { id } = await bought(db, BUYER, 1000);
  await as(db, BUYER);
  await pay(db, id, P(1000, { source: 'own_money' }));
  assert((await code(db.query(`select pur_repay_buyer($1, $2, '100', $3, 'cash', '')`, [op(), BUYER, phDate()]))).includes('OWNER_ONLY'));
  await as(db, OWNER);
  const r = (await one(db, `select pur_repay_buyer($1, $2, '600', $3, 'gcash', '') r`, [op(), BUYER, phDate()])).r;
  eq(num(r.owes), 400);
  assert((await code(db.query(`select pur_repay_buyer($1, $2, '500', $3, 'cash', '')`, [op(), BUYER, phDate()]))).includes('OVER_OWED'));
  await db.query(`select pur_void_repayment($1, $2, 'paid twice by mistake')`, [op(), r.repayment_id]);
  eq(await owes(db, BUYER), 1000);
  eq(await raw(db, BUYER), 0, 'repaying never touches petty cash');
});

// ── F. Outside the money model, private, retried once ───────────────────

await test('nothing here writes expenses or payroll: Spent is identical through every operation', async () => {
  const db = await fresh();
  const wil = await supplier(db, 'Wilcon');
  await as(db, OWNER);
  await db.query(`select pur_set_own_money($1, true)`, [BUYER]);
  const { id } = await bought(db, BUYER, 1000, { body: { supplier_id: wil } });
  const before = await money(db);
  await give(db, BUYER, 2000);
  await as(db, BUYER);
  await pay(db, id, P(700, { source: 'petty_cash' }));
  await pay(db, id, P(500, { source: 'own_money' }));
  const ret = (await one(db, `select pur_cash_report_return($1, '100', $2, '', '', '') r`, [op(), phDate()])).r.return_id;
  await as(db, OWNER);
  await db.query(`select pur_cash_decide_return($1, $2, true, '')`, [op(), ret]);
  await resolve(db, id, [{ amount: '100', funded_by: 'own_money', person_id: BUYER, received_by: 'buyer', received_on: phDate() }], { amount: '100' });
  await db.query(`select pur_repay_buyer($1, $2, '300', $3, 'cash', '')`, [op(), BUYER, phDate()]);
  await db.query(`select pur_cash_count($1, $2, $3, '1200', '')`, [op(), BUYER, phDate()]);
  eq(await money(db), before, 'expenses (rows, ₱) and payroll unchanged');
  const src = M102.replace(/--[^\n]*/g, '');
  assert(!/\b(insert\s+into|update|delete\s+from)\s+(public\.)?(expenses|payroll)\b/i.test(src), '0102 writes no expense or payroll row');
  assert(!/\bfrom\s+(public\.)?(expenses|payroll)\b/i.test(src), '0102 reads neither');
});

await test('the nine tables are private: a signed-in client reads and writes none of them directly', async () => {
  const db = await fresh();
  await give(db, BUYER, 100);
  await as(db, OWNER);
  await db.exec(`set role authenticated`);
  for (const t of ['pur_payments', 'pur_supplier_credits', 'pur_refunds', 'pur_cash_issues', 'pur_cash_returns',
                   'pur_cash_counts', 'pur_own_money', 'pur_buyer_repayments', 'pur_money_events']) {
    assert((await code(db.query(`select * from ${t}`))).includes('permission denied'), t);
  }
  assert((await code(db.query(`insert into pur_cash_issues (owner_id, buyer_id, amount, issued_on, method, created_by)
                                 values ($1, $2, 1, current_date, 'cash', $1)`, [OWNER, BUYER]))).includes('permission denied'));
  for (const f of ['pur_cash_raw($1, $1)', 'pur_owes($1, $1)', 'pur_pay_state($1)']) {
    assert((await code(db.query(`select ${f}`, [OWNER]))).includes('permission denied'), f + ' is internal');
  }
  await db.exec(`reset role`);
});

await test('every write answers a retry with its first answer (petty cash given once, a return reported once, a repayment once)', async () => {
  const db = await fresh();
  await as(db, OWNER);
  const g = op();
  await db.query(`select pur_cash_give($1, $2, '1000', $3, 'cash', '')`, [g, BUYER, phDate()]);
  const again = (await one(db, `select pur_cash_give($1, $2, '1000', $3, 'cash', '') r`, [g, BUYER, phDate()])).r;
  eq(again.replayed, true);
  eq(await raw(db, BUYER), 1000, 'given once');
  await as(db, BUYER);
  const rr = op();
  await db.query(`select pur_cash_report_return($1, '100', $2, '', '', '')`, [rr, phDate()]);
  await db.query(`select pur_cash_report_return($1, '100', $2, '', '', '')`, [rr, phDate()]);
  eq(num((await one(db, `select count(*) n from pur_cash_returns`)).n), 1, 'reported once');
});

await test('Project Control\'s badge: owner accounts only, by purchase line and charge id', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 1000);
  await pay(db, id, P(400));
  const line = (await one(db, `select id from purchase_lines where purchase_id = $1`, [id])).id;
  await as(db, OWNER);
  eq((await one(db, `select pur_payment_badges() b`)).b[line], 'partial');
  for (const [who, want] of [[STAFF, 'OWNER_ONLY'], [BUYER, 'OWNER_ONLY'], [WORKER, 'OWNER_ONLY'], [PMOWNER, 'NOT_ALLOWED']]) {
    await as(db, who);
    const r = await code(db.query(`select pur_payment_badges()`));
    assert(r.includes(want), who + ': ' + r);
  }
});

await test('a payment\'s proof photo and a return\'s photo mark their uploads attached', async () => {
  const db = await fresh();
  const { id } = await bought(db, BUYER, 100);
  const path1 = `purchases/${OWNER}/2026-10/22222222-2222-2222-2222-222222222222.jpg`;
  const path2 = `pettyCash/${OWNER}/2026-10/33333333-3333-3333-3333-333333333333.jpg`;
  await db.query(`insert into receipt_uploads (path, owner_id, kind, uploaded_by, state) values ($1, $2, 'purchase', $3, 'pending'), ($4, $2, 'petty_cash', $3, 'pending')`,
    [path1, OWNER, BUYER, path2]);
  const url = (p) => 'https://example.supabase.co/storage/v1/object/public/uploads/' + p;
  await as(db, BUYER);
  await pay(db, id, P(100, { proof_url: url(path1) }));
  await db.query(`select pur_cash_report_return($1, '1', $2, '', $3, '')`, [op(), phDate(), url(path2)]);
  eq((await all(db, `select state from receipt_uploads order by path desc`)).map(r => r.state), ['attached', 'attached']);
});

await test('the history is append-only', async () => {
  const db = await fresh();
  await give(db, BUYER, 100);
  assert((await code(db.query(`update pur_money_events set amount = 1`))).includes('HISTORY_IMMUTABLE'));
  assert((await code(db.query(`delete from pur_money_events`))).includes('HISTORY_IMMUTABLE'));
  eq((await all(db, `select kind from pur_money_events`)).map(r => r.kind), ['cash_given']);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Modify:** `tests/money-math.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/money-math.test.js b/tests/money-math.test.js
index 8c9e69c..67cee90 100644
--- a/tests/money-math.test.js
+++ b/tests/money-math.test.js
@@ -94,6 +94,25 @@ test('allocation planning never enters Spent, Earned or recognised Profit', () =
   eq(portal._recognisedProfit(project), 0);
 });
 
+// 2A-4a (0102): supplier payments, petty cash, refunds, supplier credit and a
+// buyer's own money are tracked against the purchase, never as expense rows.
+// No Spent / Earned / Profit function may read them, and a payment state on
+// a purchase-made row (Project Control's owner badge) changes no total.
+test('payments, petty cash and own money never enter Spent, Earned or recognised Profit', () => {
+  for (const name of ['_projSpent', '_projEarned', '_projMargin', '_recognisedProfit', 'buildProject']) {
+    ok(!/pur_pay|pur_payments|payBadge|PayBadge|pettyCash|petty_cash|ownMoney|own_money|supplierCredit|pur_refunds|cashHeld|owesBuyer/.test(portal[name].toString()),
+      name + ' must stay independent of payments');
+  }
+  const folder = { id: 'f1', totalBudget: 100000 };
+  const months = [{ id: 'm1', monthlyBudget: 50000, fundingType: 'progress' }];
+  const rows = [{ projectId: 'm1', amount: 3000, docs: {}, purchaseLineId: 'L1' }];
+  const paid = rows.map(r => ({ ...r, payState: 'overpaid', payPaid: 9000 }));
+  const a = portal.buildProject(folder, months, [], rows, []);
+  const b = portal.buildProject(folder, months, [], paid, []);
+  eq(b.material, a.material); eq(b.spent, a.spent); eq(b.coverCost, a.coverCost);
+  eq(b.spent, 3000);   // the purchase, not what was paid
+});
+
 function pakyaw(expPayroll) {
   return evalWith(
     slice(expensesSrc, 'function lcDrawsDown', '// Worker names seen on this folder', 'expenses-module.js'),
```

**Create:** `tests/purchasing-payments-server.test.js`

```js
// ════════════════════════════════════════════════════════════════════
// PAYMENTS SERVER (0102) STATIC TESTS:
//   run with  node tests/purchasing-payments-server.test.js
//
// Zero dependencies. Reads supabase/migrations/0102_purchase_payments.sql
// and fences what the behaviour tests cannot see (those are
// supabase/tests/2a4_payments.pglite.mjs, 2a4_concurrency.mjs and the 2A-1 /
// 2A-2 / 2A-3 suites re-run --with-0102 — npm run test:sql):
//   1. Outside the money model: 0102 writes and reads no expense or payroll
//      row, and redefines no Spent function; the four functions it does
//      redefine are their earlier text plus the lines 0102 adds.
//   2. Every function is granted to signed-in users (and checks the caller
//      itself) or revoked from them; the nine tables are private.
//   3. Every write is sent once (operation id) and every void needs a reason;
//      the main owner's writes check for the main owner.
//   4. The live acceptance script rolls back; test:sql runs the new suites.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const strip = (sql) => sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const M102 = strip(read('supabase/migrations/0102_purchase_payments.sql'));
const M101 = strip(read('supabase/migrations/0101_purchasing_phone.sql'));
const M97 = strip(read('supabase/migrations/0097_purchasing_office.sql'));
const M96 = strip(read('supabase/migrations/0096_purchase_recording.sql'));

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function fnBody(code, name, where) {
  const m = code.match(new RegExp('create or replace function (?:public\\.)?' + name + '\\s*\\([\\s\\S]*?\\n(?:end )?\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found in ' + where);
  return m[0];
}
const lines = (t) => t.split('\n').map(l => l.replace(/\s+$/, '')).filter(Boolean);
const added = (now, then) => lines(now).filter(l => !lines(then).includes(l)).map(l => l.trim());
const removed = (now, then) => lines(then).filter(l => !lines(now).includes(l)).map(l => l.trim());

const defined = [...M102.matchAll(/create or replace function (?:public\.)?([a-z_]+)\s*\(/g)].map(m => m[1]);
const TABLES = ['pur_payments', 'pur_supplier_credits', 'pur_refunds', 'pur_cash_issues', 'pur_cash_returns',
                'pur_cash_counts', 'pur_own_money', 'pur_buyer_repayments', 'pur_money_events'];

console.log('\n0102: outside the money model');
test('0102 writes and reads no expense or payroll row', () => {
  ok(!/\b(insert\s+into|update|delete\s+from)\s+(public\.)?(expenses|payroll)\b/i.test(M102), 'writes');
  ok(!/\b(from|join)\s+(public\.)?(expenses|payroll)\b/i.test(M102), 'reads');
  ok(!/dacs\.purchase_write', 'on'/.test(M102.replace(fnBody(M102, 'pur_record', '0102'), '')),
    'only pur_record (0096\'s recording) opens the expense-row guard');
});
test('0102 redefines no Spent, funding or cover function', () => {
  for (const f of ['pur_store', 'pur_charge_rows', 'pur_clear_rows', 'pur_fund', 'pur_period_remaining', 'pur_cover_period',
                   'pur_prorate', 'pur_insert', 'pur_correct', 'pur_replace', 'pur_void', 'pur_cover_lines', 'pur_purchase_view']) {
    ok(!defined.includes(f), '0102 must not redefine ' + f);
  }
});
test('pur_record is 0096\'s, plus "paid now" in the same transaction', () => {
  const now = fnBody(M102, 'pur_record', '0102'), then = fnBody(M96, 'pur_record', '0096');
  eq(removed(now, then), ['perform pur_header_ok(p_body);', 'perform pur_lock(pur_body_keys(p_body));',
                          'v_result := pur_insert(v_owner, v_uid, p_body, null);'], 'only these three now read v_body');
  ok(added(now, then).every(l => /v_pays|v_body|v_pay\b|v_ids|BAD_PAY|BUYER_REQUIRED|pur_buyer\(\)|pur_pay_insert|pur_pay_state|^end if;$|^end loop;$|^raise exception|v_result := v_result \|\|/.test(l)
    || ['perform pur_header_ok(v_body);', 'perform pur_lock(pur_body_keys(v_body));', 'v_result := pur_insert(v_owner, v_uid, v_body, null);'].includes(l)),
    'only payment lines added: ' + JSON.stringify(added(now, then)));
  ok(now.indexOf('pur_insert(') < now.indexOf('pur_pay_insert('), 'the purchase first, then its payments');
  ok(now.indexOf('pur_pay_insert(') < now.indexOf('insert into pur_ops'), 'the answer is stored after the payments');
});
test('pur_header_ok is 0097\'s plus refusing payments on a correction or replacement', () => {
  const now = fnBody(M102, 'pur_header_ok', '0102'), then = fnBody(M97, 'pur_header_ok', '0097');
  eq(added(now, then), ["if p_body ? 'payments' then", "raise exception 'BAD_PAY' using errcode = 'P0001';"]);
  eq(removed(now, then), []);
  ok(lines(now).length === lines(then).length + 3, 'one if … end if block added');
});
test('pur_list_doc is 0101\'s plus the payment state', () => {
  const now = fnBody(M102, 'pur_list_doc', '0102'), then = fnBody(M101, 'pur_list_doc', '0101');
  eq(added(now, then), ["'replaced_by', pu.replaced_by,", "'pay', pur_pay_state(pu.id))"]);
  eq(removed(now, then), ["'replaced_by', pu.replaced_by)"]);
});
test('receipt_mark_attached is 0097\'s plus the payment proof and return photo', () => {
  const now = fnBody(M102, 'receipt_mark_attached', '0102'), then = fnBody(M97, 'receipt_mark_attached', '0097');
  eq(added(now, then), ["elsif tg_table_name = 'pur_payments' then", 'v_vals := array[new.proof_url];',
                        "elsif tg_table_name = 'pur_cash_returns' then", 'v_vals := array[new.photo_url];']);
  eq(removed(now, then), []);
});

console.log('\n0102: access');
const PUBLIC = ['pur_record', 'pur_pay', 'pur_void_payment', 'pur_accept_own_money', 'pur_reject_own_money', 'pur_resolve_overpaid', 'pur_void_refund',
  'pur_void_credit', 'pur_cash_give', 'pur_cash_dispute', 'pur_cash_clear_dispute', 'pur_cash_void_issue', 'pur_cash_report_return',
  'pur_cash_withdraw_return', 'pur_cash_decide_return', 'pur_cash_void_return', 'pur_cash_count', 'pur_cash_void_count',
  'pur_set_own_money', 'pur_repay_buyer', 'pur_void_repayment', 'pur_purchase_payments', 'pur_credits', 'pur_my_cash',
  'pur_cash_buyer', 'pur_cash_tracker', 'pur_overpaid', 'pur_cash_report', 'pur_payment_badges'];
const grants = [...M102.matchAll(/grant execute on function [\s\S]*?;/g)].map(m => m[0]).join('\n');
const revokesAll = [...M102.matchAll(/revoke all on function ([\s\S]*?) from public, anon, authenticated;/g)].map(m => m[1]).join(' ');
// The storage rules (R13) run as the signed-in reader, like pur_buyer(): granted, each answering only about the caller.
const STORAGE_RULES = ['uploads_can_read', 'uploads_can_write', 'pur_petty_reader'];
test('every function is granted to signed-in users or revoked from them — none in between', () => {
  for (const f of defined) {
    if (f === 'receipt_mark_attached') continue;   // a trigger; revoked from public, anon as 0097 did
    if (STORAGE_RULES.includes(f)) continue;       // checked in the R13 test
    const granted = new RegExp('\\b' + f + '\\(').test(grants);
    const revoked = new RegExp('\\b' + f + '\\(').test(revokesAll);
    ok(granted !== revoked, f + (granted ? ' is both granted and revoked' : ' is neither granted nor revoked'));
    ok(granted === PUBLIC.includes(f), f + (granted ? ' is callable but not in the public list' : ' should be callable'));
  }
  ok(!/to (anon|public)\b/.test(grants), 'nothing for anon or public');
});
test('the nine tables are private: RLS on, no policy, every privilege revoked', () => {
  // The only policies 0102 writes are the upload ledger's and the storage overwrite rule, restated for pettyCash (R13).
  eq([...M102.matchAll(/create policy ("?[a-z_]+"?) on ([a-z_.]+)/g)].map(m => m[1] + ' on ' + m[2]),
     ['receipt_uploads_insert on public.receipt_uploads', '"uploads_admin_update" on storage.objects'], 'no policy on the new tables');
  for (const t of TABLES) {
    ok(new RegExp('alter table ' + t + ' enable row level security;').test(M102), t + ' RLS');
    ok(new RegExp('revoke all on table [^;]*\\b' + t + '\\b[^;]*from public, anon, authenticated;').test(M102), t + ' revoked');
  }
  ok(/revoke all on sequence pur_money_events_seq_seq from public, anon, authenticated;/.test(M102), 'the history\'s sequence');
});
test('each public function checks its caller first: buyers (pur_pay_owner / pur_actor_owner) or the main owner (pur_main_owner)', () => {
  const OWNER_ONLY = ['pur_accept_own_money', 'pur_reject_own_money', 'pur_resolve_overpaid', 'pur_void_refund', 'pur_void_credit', 'pur_cash_give',
    'pur_cash_clear_dispute', 'pur_cash_void_issue', 'pur_cash_decide_return', 'pur_cash_void_return', 'pur_cash_count',
    'pur_cash_void_count', 'pur_set_own_money', 'pur_repay_buyer', 'pur_void_repayment', 'pur_cash_tracker', 'pur_overpaid', 'pur_cash_report',
    'pur_cash_buyer'];
  for (const f of PUBLIC) {
    const body = fnBody(M102, f, '0102');
    const decl = body.slice(0, body.indexOf('begin'));
    if (f === 'pur_record') { ok(/pur_actor_owner\(p_body ->> 'source'\)/.test(decl), f); continue; }
    if (f === 'pur_payment_badges') { ok(/is_owner\(\)/.test(body) && /pur_actor_owner\('expenses_form'\)/.test(body), f); continue; }
    if (OWNER_ONLY.includes(f)) ok(/v_owner uuid := pur_main_owner\(\);/.test(decl), f + ' main owner only');
    else ok(/v_owner uuid := pur_pay_owner\(\);/.test(decl), f + ' buyers only');
  }
  const main = fnBody(M102, 'pur_main_owner', '0102');
  ok(/pm_main_owner_id\(\)/.test(main) && /pur_is_main_owner\(\)/.test(main), 'the main owner = 0098\'s, with the Expenses section');
  ok(/p\.owner_id is null/.test(fnBody(M102, 'pur_is_main_owner', '0102')) && /allowed_modules \? 'expenses'/.test(fnBody(M102, 'pur_is_main_owner', '0102')),
    'no sub-owner, no account focused away from Expenses');
});

test('R13: return photos get their own private folder — 0097\'s storage rules plus the pettyCash lines, before every general rule', () => {
  const r = fnBody(M102, 'uploads_can_read', '0102'), r0 = fnBody(M97, 'uploads_can_read', '0097');
  const w = fnBody(M102, 'uploads_can_write', '0102'), w0 = fnBody(M97, 'uploads_can_write', '0097');
  eq(added(r, r0), ["if v_folder = 'pettyCash' then", 'return pur_petty_reader(p_name);'], 'read: only the pettyCash lines added');
  eq(removed(r, r0), []);
  eq(lines(r).length, lines(r0).length + 3, 'read: one if … end if');
  eq(added(w, w0), ["if v_folder = 'pettyCash' then"], 'write: only the pettyCash test added (its return line is the purchases one)');
  eq(removed(w, w0), []);
  eq(lines(w).length, lines(w0).length + 3, 'write: one if … end if');
  ok(r.indexOf("v_folder = 'pettyCash'") < r.indexOf('p_owner_id = v_uid::text then return true'), 'before the uploader read-back');
  ok(r.indexOf("v_folder = 'pettyCash'") < r.indexOf('if is_owner() or is_staff() then return true'), 'before the generic owner/staff rule');
  ok(w.indexOf("v_folder = 'pettyCash'") < w.indexOf('if is_owner() or is_staff() then return true'), 'write: before the generic rule');
  const reader = fnBody(M102, 'pur_petty_reader', '0102');
  ok(/pur_is_main_owner\(\)/.test(reader) && /u\.uploaded_by = auth\.uid\(\)/.test(reader) && /= data_owner_id\(\)::text/.test(reader),
    'the main owner, or the uploader, of that company');
  ok(/revoke all on function public\.pur_petty_reader\(text\) from public, anon;/.test(M102) &&
     /grant execute on function public\.pur_petty_reader\(text\) to authenticated;/.test(M102), 'callable by signed-in readers only');
  for (const f of ['uploads_can_read(text, text)', 'uploads_can_write(text)']) {
    ok(M102.includes('revoke all on function public.' + f + ' from anon;') && M102.includes('grant execute on function public.' + f + ' to authenticated;'), f);
  }
  const upd = M102.slice(M102.indexOf('create policy "uploads_admin_update"'), M102.indexOf('-- ════ 10.'));
  eq((upd.match(/when split_part\(name, '\/', 1\) = 'pettyCash' then false/g) || []).length, 2, 'never overwritten (using and check)');
  ok(/when 'petty_cash' then 'pettyCash'/.test(M102) && /kind not in \('purchase', 'petty_cash'\) or pur_buyer\(\)/.test(M102), 'the ledger: buyers, the right folder');
  ok(/u\.kind = 'petty_cash'\s+and u\.uploaded_by = auth\.uid\(\)/.test(fnBody(M102, 'pur_cash_report_return', '0102')), 'a return attaches only its buyer\'s own photo');
});

console.log('\n0102: sent once, voided with a reason');
test('every public write starts by asking pur_op_begin for an earlier answer and stores its own', () => {
  const READS = ['pur_purchase_payments', 'pur_credits', 'pur_my_cash', 'pur_cash_buyer', 'pur_cash_tracker', 'pur_overpaid', 'pur_cash_report',
                 'pur_payment_badges', 'pur_set_own_money'];
  for (const f of PUBLIC.filter(x => !READS.includes(x) && x !== 'pur_record')) {
    const body = fnBody(M102, f, '0102');
    const begin = body.indexOf('v_prev := pur_op_begin(p_op);');
    ok(begin !== -1, f + ' takes an operation id');
    ok(/if v_prev is not null then return v_prev; end if;/.test(body.slice(begin)), f + ' returns the first answer');
    ok(/return pur_op_done\(v_owner, p_op, '[a-z_]+'/.test(body), f + ' stores its answer');
  }
  ok(/on conflict \(user_id\) do update/.test(fnBody(M102, 'pur_set_own_money', '0102')), 'the switch: setting it twice is the same');
});
test('every void and rejection needs a reason; nothing is deleted', () => {
  ok(/v_reason text := pur_reason\(p_reason\);/.test(fnBody(M102, 'pur_reject_own_money', '0102')), 'a rejected own-money claim says why (R9)');
  for (const f of ['pur_void_payment', 'pur_void_refund', 'pur_void_credit', 'pur_cash_void_issue', 'pur_cash_void_return',
                   'pur_cash_void_count', 'pur_void_repayment']) {
    ok(/v_reason text := pur_reason\(p_reason\);/.test(fnBody(M102, f, '0102')), f + ' reason');
  }
  ok(/else pur_reason\(p_note\) end/.test(fnBody(M102, 'pur_cash_decide_return', '0102')), 'a rejection');
  ok(/v_note text := pur_reason\(p_note\);/.test(fnBody(M102, 'pur_cash_dispute', '0102')), 'a dispute says why');
  ok(!/\bdelete\s+from\s+pur_/i.test(M102), 'no delete');
  ok(/before update or delete on pur_money_events/.test(M102), 'history append-only');
});
test('the limits that must hold under races take a lock first', () => {
  ok(/from pur_supplier_credits where id = v_credit and owner_id = p_owner for update/.test(fnBody(M102, 'pur_pay_insert', '0102')), 'a credit row');
  for (const f of ['pur_pay', 'pur_void_payment', 'pur_resolve_overpaid', 'pur_void_refund', 'pur_void_credit']) {
    ok(/perform pur_purchase_lock\(/.test(fnBody(M102, f, '0102')), f + ' locks the purchase');
  }
  const repay = fnBody(M102, 'pur_repay_buyer', '0102');
  ok(repay.indexOf('pur_person_lock(p_buyer)') < repay.indexOf('pur_owes(v_owner, p_buyer)'), 'the buyer, before reading what is owed');
});

console.log('\n0102: acceptance and CI');
test('the live acceptance script rolls itself back and ends with the success row', () => {
  const acc = read('supabase/tests/2a4_acceptance.sql');
  const code = strip(acc).trim();
  ok(/^begin;/.test(code) && /rollback;$/.test(code), 'begin … rollback');
  ok(!/\bcommit\b/i.test(code), 'never commits');
  ok(/'2a4 acceptance: all checks passed'/.test(acc), 'success row');
});
test('npm run test:sql runs the 2A-4a suites and re-runs 2A-1 / 2A-2 / 2A-3 with 0102', () => {
  const sql = JSON.parse(read('package.json')).scripts['test:sql'];
  for (const s of ['2a4_payments.pglite.mjs', '2a4_concurrency.mjs', '2a1_purchase.pglite.mjs --with-0102',
                   '2a2_purchasing.pglite.mjs --with-0102', '2a3_server.pglite.mjs --with-0102']) {
    ok(sql.includes('node supabase/tests/' + s), 'test:sql runs ' + s);
  }
  ok(JSON.parse(read('package.json')).scripts.test.includes('node tests/purchasing-payments-server.test.js'), 'npm test runs this file');
});
test('the migrations README and the schema doc know 0102', () => {
  ok(/0102_purchase_payments\.sql/.test(read('supabase/migrations/README.md')), 'README');
  const doc = read('docs/DATABASE_SCHEMA.md');
  for (const t of TABLES) ok(doc.includes(t), 'DATABASE_SCHEMA.md: ' + t);
  ok(/payments_tracked/.test(doc), 'DATABASE_SCHEMA.md: purchases.payments_tracked');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Modify:** `tests/storage-access.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/storage-access.test.js b/tests/storage-access.test.js
index b23d6c7..d9e07de 100644
--- a/tests/storage-access.test.js
+++ b/tests/storage-access.test.js
@@ -74,6 +74,8 @@ const FOLDERS = {
   expenseReceipts: 'tenant', payrollReceipts: 'tenant',
   // 0097: one receipt per purchase — only accounts that may BUY in that company.
   purchases: 'buyer',
+  // 0102 (R13): a petty-cash return photo — the main owner and the buyer who uploaded it.
+  pettyCash: 'pettyCash',
 };
 const OWNER_ONLY_SQL = "('quotations', 'reimbursementReceipts')";
 const CLIENT_PROJECT_SQL = "('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms')";
@@ -199,6 +201,22 @@ test('purchase receipts are buyer-locked (0097): buyers of THAT company only, be
   ok(upd.includes("split_part(name, '/', 1) = 'purchases'") && upd.includes('pur_buyer()'), 'overwrite policy is not buyer-locked for purchases');
 });
 
+test('petty-cash return photos are locked to the main owner and their uploader (0102, R13), before every other rule', () => {
+  const r = lastFn('uploads_can_read');
+  const w = lastFn('uploads_can_write');
+  ok(r.includes("v_folder = 'pettyCash' then\n    return pur_petty_reader(p_name);"), 'read rule for pettyCash missing or reshaped');
+  ok(w.includes("v_folder = 'pettyCash' then\n    return pur_buyer() and v_seg2 = data_owner_id()::text;"), 'write rule for pettyCash missing or reshaped');
+  ok(r.indexOf("v_folder = 'pettyCash'") < r.indexOf('p_owner_id = v_uid::text then return true'), 'read: pettyCash rule must precede the uploader read-back');
+  ok(r.indexOf("v_folder = 'pettyCash'") < r.indexOf('if is_owner() or is_staff() then return true'), 'read: pettyCash rule must precede the generic rule');
+  ok(w.indexOf("v_folder = 'pettyCash'") < w.indexOf('if is_owner() or is_staff() then return true'), 'write: pettyCash rule must precede the generic rule');
+  // The purchases rule is still there, unchanged, in the same latest definition.
+  ok(r.includes("v_folder = 'purchases' then\n    return pur_buyer() and split_part(p_name, '/', 2) = data_owner_id()::text;"), 'purchases read rule kept');
+  const sql = allRules();
+  const from = sql.lastIndexOf('create policy "uploads_admin_update"');
+  const upd = sql.slice(from, sql.indexOf(');', from) + 2);
+  ok(upd.includes("split_part(name, '/', 1) = 'pettyCash' then false"), 'a return photo is never overwritten');
+});
+
 console.log('\nIII. Every upload folder is classified');
 function uploadFolders() {
   const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'js', f));
```

<!-- Code -->

**Modify:** `docs/DATABASE_SCHEMA.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
index 15c00f9..b9f14e7 100644
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -1093,6 +1093,38 @@ What buying from the WorkMate phone needs from the server. Spec `docs/superpower
 | `pur_my_pending_changes()` | Any account that may record (0096's rule), buyer or not: the caller's OWN pending change requests — `id`, `purchase_id`, `kind`, `reason`, `requested_at`, and the purchase's `line_ids` / `charge_ids`. No amounts. Project Control and Expenses show "Waiting for the owner" on those rows and offer Withdraw (`pur_withdraw_change`) |
 | `pur_purchase_view` (0097, redefined) | Adds `no_receipt_reason` |
 
+## Paying for purchases (0102) — WorkMate Stage 2A-4a
+
+Supplier payments, Overpaid, refunds and supplier credit, petty cash and "Company owes buyer". **Outside the money model:** nothing here writes or reads `expenses` or `payroll`; Spent, Earned and Profit never read these tables (CLAUDE.md). Answers `docs/superpowers/specs/2026-10-22-workmate-stage2a4-questions.md`; plan `docs/superpowers/plans/2026-10-22-workmate-stage2a4a-payments-server-web.md`.
+
+Every table has RLS on, **no policies** and every privilege revoked: the screens read and write only through the functions below. Every write takes an operation id (`pur_ops`, 0096: a retry returns the first answer). Mistakes are **voided with a reason**, never edited or deleted. "Main owner" = 0098's `pm_main_owner_id()` (owner role, no `owner_id`, active) with the Expenses section.
+
+| Table / object | Columns and rules |
+|---|---|
+| `purchases.payments_tracked` (boolean) | `false` on every purchase recorded before 0102 ("Payment not tracked" until a payment is recorded on it); `true` on every purchase since |
+| `pur_payments` (`purchase_id`, `first_purchase_id` (never changes: a replacement moves `purchase_id` only, with one `payment_moved` history entry per payment), `amount` > 0, `paid_on`, `method` `cash`/`gcash`/`bank_transfer`/`check`/`other`, `source`, `person_id`, `credit_id`, `authorized`, `accepted_by`/`accepted_at`, `rejected_by`/`rejected_at`/`reject_reason`, `proof_url` (https or ''), `note`, `created_by`, void fields) | One payment on the WHOLE purchase (never per project). `source`: `petty_cash` / `own_money` (`person_id` = the staff buyer whose money), `company` (paid directly; `person_id` = who handed it over), `credit` (`credit_id`; not cash). `authorized` = the buyer's own-money switch was on; an unauthorized one counts in "Company owes buyer" only once the main owner accepts it; rejected (with a reason, `pur_reject_own_money`) it is never owed. Either decision is kept |
+| `pur_supplier_credits` (`supplier_id`, `purchase_id` = the overpaid purchase it came from, `amount`, `note`, void fields) | A balance with one supplier. Left = `amount` − non-voided `credit` payments using it (`pur_credit_left`). A used credit is not voided (`CREDIT_USED`) |
+| `pur_refunds` (`purchase_id`, `amount`, `funded_by` `petty_cash`/`own_money`/`company`/`credit`, `received_by` `petty_cash`/`company`/`buyer`, `person_id`, `received_on`, `note`, void fields) | Tied to the money that paid. Routes (check constraint): petty cash → back into the buyer's petty cash (cash held up) or the company; own money → the buyer ("Company owes buyer" down) or the company; company or credit → the company, or the buyer (company cash now held by the buyer). A credit-funded excess normally goes back to the supplier's credit (a new `pur_supplier_credits` row); a `credit` refund is the supplier paying it back in cash instead. Each `funded_by` part ≤ what that money paid (`OVER_SOURCE`); refunds + credits ≤ what is over (`OVER_RESOLVED`) |
+| `pur_cash_issues` (`buyer_id`, `amount`, `issued_on`, `method`, `note`, `disputed_at`/`dispute_note`, `dispute_cleared_*`, void fields) | Petty cash the main owner gave a staff buyer. Counts at once; "I did not receive this" flags it and changes nothing |
+| `pur_cash_returns` (`buyer_id`, `amount`, `handed_on`, `handed_to`, `photo_url`, `note`, `status` `reported`/`withdrawn`/`confirmed`/`rejected`, `decided_at`/`decided_by`/`decision_note`, void fields — confirmed only) | The buyer reports; only the main owner's confirmation lowers the balance, on the **confirmation** day (Philippine date) |
+| `pur_cash_counts` (`buyer_id`, `counted_on`, `counted` ≥ 0, `note`, void fields) | A cash count: a record only, shown against the balance recorded that day |
+| `pur_own_money` (`user_id`, `owner_id`, `allowed`, `updated_by`, `updated_at`) | The "May use own money" switch (main owner); history in `pur_money_events` (`own_money_on` / `own_money_off`) |
+| `pur_buyer_repayments` (`buyer_id`, `amount`, `paid_on`, `method`, `note`, void fields) | The company repaying a buyer's own money. Never more than owed (`OVER_OWED`) |
+| `pur_money_events` (`seq`, `kind`, `purchase_id`, `person_id`, `ref_id`, `amount`, `detail`, `reason`, `actor_id`, `at`) | Append-only history of all of the above (`HISTORY_IMMUTABLE`) |
+| `pur_pay_state(purchase)` (internal) | `{state, tracked, due, paid, balance, excess, resolved, unresolved, over_resolved}`. `due` = receipt total while recorded, ₱0 once voided. `state`: `not_tracked`, `unpaid`, `partial`, `paid`, `overpaid` (unresolved excess), `void`, `void_paid` (voided, money to recover) |
+| `pur_cash_raw(owner, buyer, upto)` (internal) | Petty cash recorded at the end of a day: issues + refunds received into petty cash − petty-cash payments − confirmed returns. A voided entry counts until the day it was voided (`pur_stood`), so a past day's closing never changes; the daily report shows the void as a reversal on its own day. Below 0 = the screens show ₱0 held and an "Unreconciled shortfall" |
+| `pur_owes(owner, buyer)` (internal) | Authorized or accepted own-money payments − own-money refunds the buyer received − repayments |
+| `pur_record` (0096, redefined) | Body `payments` (≤ 5): "paid now", saved in the SAME transaction as the purchase; a refused payment refuses the purchase. Needs the Buyer switch when it carries payments |
+| `pur_header_ok` (0097, redefined) | A correction or replacement carrying `payments` → `BAD_PAY` |
+| `pur_list_doc` (0101, redefined) | Adds `pay` (the payment state) — shown in the Purchases list and My purchases |
+| `receipt_mark_attached` (0097, redefined) | Also marks a payment's proof and a return's photo attached |
+| Trigger `purchases_pay_follow_replace` | When a purchase is replaced, its payments, refunds and credits move to the new version, with "not tracked" |
+| `pur_cash_detail(owner, buyer)` (internal) | One buyer's cash summary with the last 90 days of petty cash given, returns, cash counts and repayments. Read by `pur_my_cash` (the buyer) and `pur_cash_buyer` (the main owner) |
+| Buyer reads and writes | `pur_pay`, `pur_void_payment` (the recorder or the main owner; `RESOLVED_FIRST` if a refund or credit already relies on it), `pur_purchase_payments`, `pur_credits`, `pur_my_cash`, `pur_cash_dispute`, `pur_cash_report_return`, `pur_cash_withdraw_return` |
+| Main-owner reads and writes | `pur_cash_give`, `pur_cash_clear_dispute`, `pur_cash_void_issue`, `pur_cash_decide_return`, `pur_cash_void_return`, `pur_cash_count`, `pur_cash_void_count`, `pur_set_own_money`, `pur_accept_own_money`, `pur_repay_buyer`, `pur_void_repayment`, `pur_resolve_overpaid`, `pur_void_refund`, `pur_void_credit`, `pur_cash_tracker`, `pur_cash_buyer(buyer)`, `pur_overpaid` (with a suggested split: the latest payments first), `pur_cash_report(buyer, from, to)` (≤ 92 days; voided entries listed apart) |
+| `pettyCash/<company>/<yyyy-mm>/<id>.jpg` (storage, R13) | A return photo. `uploads_can_read` (0097's, plus this branch first): only the main owner and the buyer who uploaded it (`pur_petty_reader`, by the upload ledger); written by buyers of the company; never overwritten. Ledger kind `petty_cash`. Payment proofs stay in `purchases/` |
+| `pur_payment_badges()` | Owner accounts only: `{line or charge id: state}` for Project Control's Unpaid / Partially paid / Paid / Overpaid badge |
+
 ## PM profit sharing (0098)
 
 An internal owner/partner allocation per PM project - **outside the money model** (never a payout, invoice or accounting entry). Spec `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`; plan `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`. `project_id` is a `construction_projects.id` (never a `folders.id`). The three tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`: nothing reads or writes them directly. Read through `pm_sharing_read` (owner-role accounts of the company); write through `pm_set_sharing` (main owner only).
```

**Modify:** `package.json` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/package.json b/package.json
index 1329bb5..eb4c33e 100644
--- a/package.json
+++ b/package.json
@@ -1,10 +1,10 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**Create:** `supabase/migrations/0102_purchase_payments.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0102 — WorkMate Stage 2A-4a: paying for purchases.
-- Answers: docs/superpowers/specs/2026-10-22-workmate-stage2a4-questions.md
-- Plan:    docs/superpowers/plans/2026-10-22-workmate-stage2a4a-payments-server-web.md
--
-- Supplier payments on a purchase (deposits, the rest, from petty cash, the
-- buyer's own money, the company directly or a supplier credit), Overpaid and
-- how it is resolved (refunds tied to the money that paid, supplier credit),
-- petty cash (given, reported back, confirmed, counted), "Company owes buyer"
-- and its repayments.
--
-- OUTSIDE THE MONEY MODEL (CLAUDE.md): nothing here writes or reads
-- `expenses` or `payroll`, and no Spent / Earned / Profit code reads these
-- tables. A payment, refund, credit, petty-cash entry or repayment never
-- creates an expense. Only a recorded purchase adds to Spent (0096).
--
-- • Nine private tables. RLS on, NO policies, privileges revoked. Every read
--   and write goes through the SECURITY DEFINER functions below.
-- • Who: payments — accounts that may buy (pur_buyer, 0097), in their own
--   company. Petty cash, repayments, the own-money switch, Overpaid and the
--   tracker — the MAIN owner (pm_main_owner_id, 0098) with the Expenses
--   section. A buyer reads and reports only their own cash.
-- • Every write takes an operation id (pur_ops, 0096): a retry returns the
--   first answer and writes nothing.
-- • Mistakes are VOIDED with a reason, never edited or deleted.
-- • pur_record gains "paid now" (Q3): the purchase and its payments are
--   accepted in ONE transaction, or neither is.
-- Requires 0096, 0097, 0098, 0101.
-- ════════════════════════════════════════════════════════════════════

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- Purchases recorded before 0102 read "Payment not tracked" (Q2) until a
-- payment is recorded on them; every purchase from now on is tracked.
alter table purchases add column if not exists payments_tracked boolean not null default false;
alter table purchases alter column payments_tracked set default true;

-- A credit with one supplier, confirmed from an overpaid purchase (Q9, Q11).
-- It is a BALANCE: used in parts by payments with source 'credit' until gone.
create table if not exists pur_supplier_credits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  supplier_id uuid not null references suppliers(id),
  purchase_id uuid not null references purchases(id),     -- the overpaid purchase it came from
  amount numeric(12,2) not null check (amount > 0),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_supplier_credits_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_supplier_credits_supplier on pur_supplier_credits (owner_id, supplier_id);
create index if not exists pur_supplier_credits_purchase on pur_supplier_credits (purchase_id);

-- One payment to the supplier, on the whole purchase (never per project).
--   source  petty_cash  person = the buyer whose petty cash paid
--           own_money   person = the buyer whose own money paid ("Company owes buyer")
--           company     person = who handed it over (optional) — owner/office paid directly
--           credit      credit_id = the supplier credit used; not cash
create table if not exists pur_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  -- The purchase it was first recorded on. A replacement moves purchase_id
  -- to the new version (R4); this never changes.
  first_purchase_id uuid not null references purchases(id),
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  method text not null check (method in ('cash', 'gcash', 'bank_transfer', 'check', 'other')),
  source text not null check (source in ('petty_cash', 'own_money', 'company', 'credit')),
  person_id uuid references profiles(id),
  credit_id uuid references pur_supplier_credits(id),
  -- own_money only: was the buyer's "May use own money" switch on? (Q21)
  -- If not, the main owner accepts it (then it is owed) or rejects it with a
  -- reason (never owed); either decision stays (R9).
  authorized boolean not null default true,
  accepted_by uuid references profiles(id),
  accepted_at timestamptz,
  rejected_by uuid references profiles(id),
  rejected_at timestamptz,
  reject_reason text,
  proof_url text not null default '' check (proof_url = '' or proof_url ~ '^https://'),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_payments_person_chk check (source not in ('petty_cash', 'own_money') or person_id is not null),
  constraint pur_payments_credit_chk check ((source = 'credit') = (credit_id is not null)),
  constraint pur_payments_decision_chk check (
    (accepted_at is null or rejected_at is null)
    and ((rejected_at is null and rejected_by is null and reject_reason is null)
         or (rejected_at is not null and rejected_by is not null and char_length(btrim(reject_reason)) between 1 and 500))),
  constraint pur_payments_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_payments_purchase on pur_payments (purchase_id);
create index if not exists pur_payments_person on pur_payments (owner_id, person_id, paid_on);
create index if not exists pur_payments_credit on pur_payments (credit_id) where credit_id is not null;

-- A refund from the supplier, tied to the money that paid (Q10):
--   funded_by   received_by   effect
--   petty_cash  petty_cash    the buyer's cash held goes up (person = that buyer)
--   petty_cash  company       nothing moves (the company has its money back)
--   own_money   buyer         "Company owes buyer" goes down (person = that buyer)
--   own_money   company       nothing moves (the company still owes the buyer)
--   company     company       nothing moves
--   company     petty_cash    company cash now held by the buyer (person = the buyer who received it)
--   credit      company       the supplier paid back in cash what a credit had paid — instead of the
--   credit      petty_cash      default, back to its credit (Q10); in a buyer's hands it is cash they hold
create table if not exists pur_refunds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  amount numeric(12,2) not null check (amount > 0),
  funded_by text not null check (funded_by in ('petty_cash', 'own_money', 'company', 'credit')),
  received_by text not null check (received_by in ('petty_cash', 'company', 'buyer')),
  person_id uuid references profiles(id),
  received_on date not null,
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_refunds_route_chk check (
    (funded_by = 'petty_cash' and received_by in ('petty_cash', 'company') and person_id is not null)
    or (funded_by = 'own_money' and received_by in ('buyer', 'company') and person_id is not null)
    or (funded_by in ('company', 'credit') and received_by = 'company' and person_id is null)
    or (funded_by in ('company', 'credit') and received_by = 'petty_cash' and person_id is not null)),
  constraint pur_refunds_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_refunds_purchase on pur_refunds (purchase_id);
create index if not exists pur_refunds_person on pur_refunds (owner_id, person_id, received_on);

-- Petty cash the main owner gave a buyer (Q13). It counts at once; the buyer
-- may say it never arrived (Q14), which flags it and changes nothing.
create table if not exists pur_cash_issues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  issued_on date not null,
  method text not null check (method in ('cash', 'gcash', 'bank_transfer', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  disputed_at timestamptz, dispute_note text check (char_length(dispute_note) <= 300),
  dispute_cleared_at timestamptz, dispute_cleared_by uuid references profiles(id),
  dispute_cleared_note text check (char_length(dispute_cleared_note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_cash_issues_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_cash_issues_buyer on pur_cash_issues (owner_id, buyer_id, issued_on);

-- Unused petty cash handed back (Q17). The buyer reports it; only the main
-- owner's confirmation lowers the balance, on the confirmation day (Q18).
create table if not exists pur_cash_returns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  handed_on date not null,
  handed_to text not null default '' check (char_length(handed_to) <= 120),
  photo_url text not null default '' check (photo_url = '' or photo_url ~ '^https://'),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'reported' check (status in ('reported', 'withdrawn', 'confirmed', 'rejected')),
  decided_at timestamptz, decided_by uuid references profiles(id),
  decision_note text check (char_length(decision_note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_cash_returns_decided_chk check ((status in ('confirmed', 'rejected')) = (decided_at is not null)),
  constraint pur_cash_returns_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (status = 'confirmed' and voided_at is not null and voided_by is not null
        and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_cash_returns_buyer on pur_cash_returns (owner_id, buyer_id, status);

-- A cash count by the main owner (Q19): a record only, never a balance change.
create table if not exists pur_cash_counts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  counted_on date not null,
  counted numeric(12,2) not null check (counted >= 0),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_cash_counts_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_cash_counts_buyer on pur_cash_counts (owner_id, buyer_id, counted_on);

-- "May use own money" (Q21), one row per staff account that ever had it.
create table if not exists pur_own_money (
  user_id uuid primary key references profiles(id),
  owner_id uuid not null references profiles(id),
  allowed boolean not null default false,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

-- The company repaying a buyer's own money (Q22).
create table if not exists pur_buyer_repayments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  method text not null check (method in ('cash', 'gcash', 'bank_transfer', 'check', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_buyer_repayments_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_buyer_repayments_buyer on pur_buyer_repayments (owner_id, buyer_id, paid_on);

-- Append-only history of everything above.
create table if not exists pur_money_events (
  seq bigint generated always as identity primary key,
  owner_id uuid not null,
  kind text not null,
  purchase_id uuid,
  person_id uuid,
  ref_id uuid,
  amount numeric(12,2),
  detail jsonb,
  reason text,
  actor_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists pur_money_events_ref on pur_money_events (owner_id, ref_id);
create index if not exists pur_money_events_person on pur_money_events (owner_id, person_id, seq);

create or replace function pur_money_events_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists pur_money_events_immutable_trg on pur_money_events;
create trigger pur_money_events_immutable_trg
  before update or delete on pur_money_events for each row execute function pur_money_events_immutable();

-- ════ 2. Internal helpers (never granted to clients) ══════════════════

-- Today in the Philippines (UTC+8, no daylight time).
create or replace function pur_manila_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- A peso amount above 0, at most two decimals, below ₱10 billion.
create or replace function pur_pos_money(p text) returns numeric
language plpgsql immutable as $$
declare v numeric := pur_money(p);
begin
  if v is null or v <= 0 or v >= 10000000000 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- A "YYYY-MM-DD" day that has happened (Philippine date), from 2020 on.
create or replace function pur_past_day(p text) returns date
language plpgsql stable as $$
declare v date;
begin
  if coalesce(btrim(p), '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  begin
    v := btrim(p)::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if v < date '2020-01-01' or v > pur_manila_today() then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Optional free text, trimmed; longer than p_max is refused.
create or replace function pur_note(p text, p_max int default 300) returns text
language plpgsql immutable as $$
begin
  if char_length(btrim(coalesce(p, ''))) > p_max then
    raise exception 'BAD_NOTE' using errcode = 'P0001';
  end if;
  return btrim(coalesce(p, ''));
end;
$$;

-- A required reason (voids, rejections, disputes).
create or replace function pur_reason(p text) returns text
language plpgsql immutable as $$
begin
  if char_length(btrim(coalesce(p, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  return btrim(p);
end;
$$;

-- The caller may buy; their company. (Payments, the buyer's own cash.)
create or replace function pur_pay_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

-- Is the caller the main owner (0098's definition) with the Expenses section?
create or replace function pur_is_main_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner' and p.owner_id is null and coalesce(p.status, 'active') = 'active'
       and (jsonb_typeof(p.allowed_modules) is distinct from 'array'
            or jsonb_array_length(p.allowed_modules) = 0 or p.allowed_modules ? 'expenses')
      from profiles p where p.id = auth.uid()), false)
$$;

-- The main owner's company (= their own id), else refused.
create or replace function pur_main_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := pm_main_owner_id();
begin
  if not pur_is_main_owner() then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- A staff account of this company: the only kind that holds petty cash or
-- can be owed its own money. (Owner accounts pay as 'company'.)
create or replace function pur_holder_ok(p_owner uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = p_person and p.role = 'staff' and p.owner_id = p_owner)
$$;

create or replace function pur_own_money_on(p_owner uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.allowed from pur_own_money m where m.user_id = p_person and m.owner_id = p_owner), false)
$$;

create or replace function pur_event(p_owner uuid, p_kind text, p_purchase uuid, p_person uuid, p_ref uuid,
                                     p_amount numeric, p_detail jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into pur_money_events (owner_id, kind, purchase_id, person_id, ref_id, amount, detail, reason, actor_id)
  values (p_owner, p_kind, p_purchase, p_person, p_ref, p_amount, p_detail, p_reason, auth.uid());
end;
$$;

-- Store the answer to an operation (0096's pur_ops) and return it.
create or replace function pur_op_done(p_owner uuid, p_op uuid, p_kind text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (p_owner, p_op, auth.uid(), p_kind, p_result);
  return p_result;
end;
$$;

-- One person's money, taken one change at a time (repayments against what is owed).
create or replace function pur_person_lock(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pur_person:' || p_person, 0));
end;
$$;

-- What a supplier credit has left.
create or replace function pur_credit_left(p_credit uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select c.amount - coalesce((select sum(p.amount) from pur_payments p
                               where p.credit_id = c.id and p.voided_at is null), 0)
    from pur_supplier_credits c where c.id = p_credit
$$;

-- Payments on a purchase from one source (and one person, for the buyer's own money / petty cash).
create or replace function pur_paid_from(p_purchase uuid, p_source text, p_person uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from pur_payments
   where purchase_id = p_purchase and voided_at is null and source = p_source
     and (p_source not in ('petty_cash', 'own_money') or person_id = p_person)
$$;

-- Refunds already recorded against that same money.
create or replace function pur_refunded_from(p_purchase uuid, p_source text, p_person uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from pur_refunds
   where purchase_id = p_purchase and voided_at is null and funded_by = p_source
     and (p_source not in ('petty_cash', 'own_money') or person_id = p_person)
$$;

-- How much of an overpayment is already resolved: refunds + credits from it.
create or replace function pur_resolved(p_purchase uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from pur_refunds where purchase_id = p_purchase and voided_at is null), 0)
       + coalesce((select sum(amount) from pur_supplier_credits where purchase_id = p_purchase and voided_at is null), 0)
$$;

-- A purchase's payment state (Q2, Q8). due = the receipt total while the
-- purchase is recorded, ₱0 once voided. excess = paid − due when above 0;
-- the part not yet refunded or credited is "unresolved".
--   not_tracked  recorded before 0102 and never given a payment
--   unpaid · partial · paid · overpaid (unresolved excess)
--   void         voided, nothing (left) to recover
--   void_paid    voided with money paid still to recover
create or replace function pur_pay_state(p_purchase uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pu purchases;
  v_due numeric; v_paid numeric; v_excess numeric; v_resolved numeric; v_unresolved numeric; v_state text;
begin
  select * into pu from purchases where id = p_purchase;
  if pu.id is null then return null; end if;
  v_paid := coalesce((select sum(amount) from pur_payments where purchase_id = p_purchase and voided_at is null), 0);
  v_due := case when pu.status = 'recorded' then pu.receipt_total else 0 end;
  v_excess := greatest(0, v_paid - v_due);
  v_resolved := pur_resolved(p_purchase);
  v_unresolved := greatest(0, v_excess - v_resolved);
  v_state := case
    when pu.status <> 'recorded' then case when v_unresolved > 0 then 'void_paid' else 'void' end
    when not pu.payments_tracked and v_paid = 0 then 'not_tracked'
    when v_unresolved > 0 then 'overpaid'
    when v_paid = 0 then 'unpaid'
    when v_paid < v_due then 'partial'
    else 'paid' end;
  return jsonb_build_object('state', v_state, 'tracked', pu.payments_tracked, 'due', v_due, 'paid', v_paid,
                            'balance', greatest(0, v_due - v_paid), 'excess', v_excess, 'resolved', v_resolved,
                            'unresolved', v_unresolved,
                            -- A correction raised the total after a refund or credit: more was given back than is now over.
                            'over_resolved', greatest(0, v_resolved - v_excess));
end;
$$;

-- Was an entry still standing at the end of a day? (null day = now.) A void
-- counts on the day it was made, never before (R7): a past day's closing
-- never changes; the void shows as a reversal on its own day.
create or replace function pur_stood(p_voided_at timestamptz, p_upto date) returns boolean
language sql immutable as $$
  select p_voided_at is null or (p_upto is not null and (p_voided_at at time zone 'Asia/Manila')::date > p_upto)
$$;

-- A buyer's petty cash as recorded at the end of p_upto (Q16, Q18, R7; null
-- = now). Can be below 0: the screens show ₱0 held and the rest as an
-- "Unreconciled shortfall". Returns count on the day the main owner
-- confirmed them; voids on the day they were made (Philippine dates).
create or replace function pur_cash_raw(p_owner uuid, p_buyer uuid, p_upto date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from pur_cash_issues
                    where owner_id = p_owner and buyer_id = p_buyer and pur_stood(voided_at, p_upto)
                      and (p_upto is null or issued_on <= p_upto)), 0)
       + coalesce((select sum(amount) from pur_refunds
                    where owner_id = p_owner and person_id = p_buyer and received_by = 'petty_cash' and pur_stood(voided_at, p_upto)
                      and (p_upto is null or received_on <= p_upto)), 0)
       - coalesce((select sum(amount) from pur_payments
                    where owner_id = p_owner and person_id = p_buyer and source = 'petty_cash' and pur_stood(voided_at, p_upto)
                      and (p_upto is null or paid_on <= p_upto)), 0)
       - coalesce((select sum(amount) from pur_cash_returns
                    where owner_id = p_owner and buyer_id = p_buyer and status = 'confirmed' and pur_stood(voided_at, p_upto)
                      and (p_upto is null or (decided_at at time zone 'Asia/Manila')::date <= p_upto)), 0)
$$;

-- What the company owes a buyer for their own money (Q21, Q22): authorized
-- or owner-accepted own-money payments, less own-money refunds the buyer
-- received, less repayments. Unauthorized ones not yet accepted are apart.
create or replace function pur_owes(p_owner uuid, p_buyer uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from pur_payments
                    where owner_id = p_owner and person_id = p_buyer and source = 'own_money' and voided_at is null
                      and (authorized or accepted_at is not null)), 0)
       - coalesce((select sum(amount) from pur_refunds
                    where owner_id = p_owner and person_id = p_buyer and funded_by = 'own_money'
                      and received_by = 'buyer' and voided_at is null), 0)
       - coalesce((select sum(amount) from pur_buyer_repayments
                    where owner_id = p_owner and buyer_id = p_buyer and voided_at is null), 0)
$$;

create or replace function pur_owes_to_review(p_owner uuid, p_buyer uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from pur_payments
   where owner_id = p_owner and person_id = p_buyer and source = 'own_money' and voided_at is null
     and not authorized and accepted_at is null and rejected_at is null
$$;

-- One payment, inserted on a purchase the caller has locked (pur_pay, pur_record).
-- p_pay: {amount, paid_on, method, source, person_id?, credit_id?, proof_url?, note?}
create or replace function pur_pay_insert(p_owner uuid, p_purchase uuid, p_pay jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  pu purchases;
  v_amount numeric;
  v_day date;
  v_method text := btrim(coalesce(p_pay ->> 'method', ''));
  v_source text := btrim(coalesce(p_pay ->> 'source', ''));
  v_person uuid := pur_uuid(p_pay ->> 'person_id');
  v_credit uuid := pur_uuid(p_pay ->> 'credit_id');
  v_proof text := btrim(coalesce(p_pay ->> 'proof_url', ''));
  v_note text := pur_note(p_pay ->> 'note');
  v_authorized boolean := true;
  c pur_supplier_credits;
  v_id uuid;
begin
  if jsonb_typeof(p_pay) is distinct from 'object' then
    raise exception 'BAD_PAY' using errcode = 'P0001';
  end if;
  select * into pu from purchases where id = p_purchase and owner_id = p_owner;
  if pu.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if pu.status <> 'recorded' then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  v_amount := pur_pos_money(p_pay ->> 'amount');
  v_day := pur_past_day(p_pay ->> 'paid_on');
  if v_source not in ('petty_cash', 'own_money', 'company', 'credit') then
    raise exception 'BAD_PAY_SOURCE' using errcode = 'P0001';
  end if;
  if v_proof <> '' and v_proof !~ '^https://' then
    raise exception 'BAD_DOCS' using errcode = 'P0001';
  end if;
  if (p_pay ? 'person_id') and nullif(btrim(coalesce(p_pay ->> 'person_id', '')), '') is not null and v_person is null then
    raise exception 'BAD_PERSON' using errcode = 'P0001';
  end if;

  if v_source in ('petty_cash', 'own_money') then
    -- A buyer's own cash: staff record their own; the main owner anyone's.
    if v_person is null and is_staff() then v_person := v_uid; end if;
    if v_person is null then raise exception 'PERSON_REQUIRED' using errcode = 'P0001'; end if;
    if v_person <> v_uid and not pur_is_main_owner() then
      raise exception 'PERSON_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if not pur_holder_ok(p_owner, v_person) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
    if v_source = 'own_money' then v_authorized := pur_own_money_on(p_owner, v_person); end if;
  elsif v_source = 'company' then
    if v_person is null then v_person := v_uid; end if;
    if not exists (select 1 from profiles p where p.id = v_person
                     and (p.id = p_owner or (p.role in ('owner', 'staff') and p.owner_id = p_owner))) then
      raise exception 'BAD_PERSON' using errcode = 'P0001';
    end if;
  end if;

  if v_source = 'credit' then
    if v_credit is null then raise exception 'CREDIT_REQUIRED' using errcode = 'P0001'; end if;
    select * into c from pur_supplier_credits where id = v_credit and owner_id = p_owner for update;
    if c.id is null or c.voided_at is not null then raise exception 'CREDIT_GONE' using errcode = 'P0001'; end if;
    if pu.supplier_id is null or c.supplier_id <> pu.supplier_id then
      raise exception 'CREDIT_SUPPLIER' using errcode = 'P0001';
    end if;
    if v_amount > pur_credit_left(v_credit) then raise exception 'OVER_CREDIT' using errcode = 'P0001'; end if;
    v_method := 'other';
    v_person := null;
  elsif v_credit is not null then
    raise exception 'BAD_PAY' using errcode = 'P0001';
  end if;
  if v_method not in ('cash', 'gcash', 'bank_transfer', 'check', 'other') then
    raise exception 'BAD_METHOD' using errcode = 'P0001';
  end if;

  insert into pur_payments (owner_id, purchase_id, first_purchase_id, amount, paid_on, method, source, person_id, credit_id,
                            authorized, proof_url, note, created_by)
  values (p_owner, p_purchase, p_purchase, v_amount, v_day, v_method, v_source, v_person, v_credit,
          v_authorized, v_proof, v_note, v_uid)
  returning id into v_id;
  update purchases set payments_tracked = true where id = p_purchase and not payments_tracked;
  perform pur_event(p_owner, 'paid', p_purchase, v_person, v_id, v_amount,
                    jsonb_build_object('source', v_source, 'method', v_method, 'paid_on', v_day,
                                       'credit_id', v_credit, 'authorized', v_authorized), null);
  return v_id;
end;
$$;

-- ════ 3. "Paid now": the purchase and its payments in ONE transaction (Q3) ══

-- 0097's header check, plus: a correction or replacement never carries
-- payments (they are recorded on the purchase, Record payment).
create or replace function pur_header_ok(p_body jsonb) returns void
language plpgsql immutable as $$
begin
  if coalesce(p_body ->> 'purchase_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  begin
    perform (p_body ->> 'purchase_date')::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if coalesce(p_body ->> 'date_time', '') <> '' and left(p_body ->> 'date_time', 10) <> p_body ->> 'purchase_date' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  if pur_money(p_body ->> 'receipt_total') is null then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if coalesce(p_body ->> 'source', 'expenses_form') not in ('expenses_form', 'workmate', 'purchasing') then
    raise exception 'BAD_SOURCE' using errcode = 'P0001';
  end if;
  if p_body ? 'payments' then
    raise exception 'BAD_PAY' using errcode = 'P0001';
  end if;
end;
$$;

-- 0096's pur_record, plus body.payments: [{amount, paid_on, method, source,
-- person_id?, credit_id?, proof_url?, note?}], at most 5. A refused payment
-- refuses the purchase too: nothing is saved (one transaction).
create or replace function pur_record(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  v_result jsonb;
  v_pays jsonb := coalesce(p_body -> 'payments', '[]'::jsonb);
  v_body jsonb := p_body - 'payments';
  v_pay jsonb;
  v_ids jsonb := '[]'::jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if jsonb_typeof(v_pays) <> 'array' or jsonb_array_length(v_pays) > 5 then
    raise exception 'BAD_PAY' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_pays) > 0 and not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_header_ok(v_body);
  perform pur_lock(pur_body_keys(v_body));
  perform set_config('dacs.purchase_write', 'on', true);
  v_result := pur_insert(v_owner, v_uid, v_body, null);
  for v_pay in select value from jsonb_array_elements(v_pays) loop
    v_ids := v_ids || to_jsonb(pur_pay_insert(v_owner, (v_result ->> 'purchase_id')::uuid, v_pay));
  end loop;
  if jsonb_array_length(v_pays) > 0 then
    v_result := v_result || jsonb_build_object('payments', v_ids, 'pay', pur_pay_state((v_result ->> 'purchase_id')::uuid));
  end if;
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'record', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- A replacement (pur_replace) is the same purchase in a new row: its
-- payments, refunds and credits follow it, and so does "not tracked" (R4).
-- Each moved row keeps its own details (a payment its first_purchase_id)
-- and gets its own history entry. Counted on the new version only: the old
-- one, void with nothing left on it, has nothing to recover.
create or replace function pur_pay_follow_replace() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_moved int := 0; r record;
begin
  if old.replaced_by is null and new.replaced_by is not null then
    for r in update pur_payments set purchase_id = new.replaced_by where purchase_id = old.id
             returning id, amount, person_id loop
      v_moved := v_moved + 1;
      perform pur_event(old.owner_id, 'payment_moved', new.replaced_by, r.person_id, r.id, r.amount,
                        jsonb_build_object('from_purchase', old.id), null);
    end loop;
    for r in update pur_refunds set purchase_id = new.replaced_by where purchase_id = old.id
             returning id, amount, person_id loop
      perform pur_event(old.owner_id, 'refund_moved', new.replaced_by, r.person_id, r.id, r.amount,
                        jsonb_build_object('from_purchase', old.id), null);
    end loop;
    for r in update pur_supplier_credits set purchase_id = new.replaced_by where purchase_id = old.id
             returning id, amount loop
      perform pur_event(old.owner_id, 'credit_moved', new.replaced_by, null, r.id, r.amount,
                        jsonb_build_object('from_purchase', old.id), null);
    end loop;
    update purchases set payments_tracked = old.payments_tracked or v_moved > 0 where id = new.replaced_by;
  end if;
  return null;
end;
$$;
drop trigger if exists purchases_pay_follow_replace on purchases;
create trigger purchases_pay_follow_replace
  after update of replaced_by on purchases for each row execute function pur_pay_follow_replace();

-- ════ 4. Payments (buyers, Q4–Q8) ═════════════════════════════════════

-- Record a later payment on a recorded purchase.
create or replace function pur_pay(p_op uuid, p_purchase uuid, p_payment jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  perform pur_purchase_lock(p_purchase);
  if not exists (select 1 from purchases where id = p_purchase and owner_id = v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_id := pur_pay_insert(v_owner, p_purchase, p_payment);
  return pur_op_done(v_owner, p_op, 'pay', jsonb_build_object('purchase_id', p_purchase, 'payment_id', v_id,
                                                              'pay', pur_pay_state(p_purchase)));
end;
$$;

-- Void a payment (Q7): the person who recorded it, or the main owner. A
-- void that would leave more refunded or credited than is still over is
-- refused until that refund or credit is voided (RESOLVED_FIRST).
create or replace function pur_void_payment(p_op uuid, p_payment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  v_purchase uuid;
  pay pur_payments;
  v_state jsonb;
  v_before numeric;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select purchase_id into v_purchase from pur_payments where id = p_payment and owner_id = v_owner;
  if v_purchase is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pur_purchase_lock(v_purchase);
  select * into pay from pur_payments where id = p_payment for update;
  if pay.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  if pay.created_by <> auth.uid() and not pur_is_main_owner() then
    raise exception 'NOT_YOURS' using errcode = 'P0001';
  end if;
  v_before := (pur_pay_state(pay.purchase_id) ->> 'over_resolved')::numeric;
  update pur_payments set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_payment;
  v_state := pur_pay_state(pay.purchase_id);
  -- Refused only when THIS void leaves more given back than is over, or more
  -- refunded than that money now paid.
  if (v_state ->> 'over_resolved')::numeric > v_before
     or (pay.source in ('petty_cash', 'own_money', 'company')
         and pur_refunded_from(pay.purchase_id, pay.source, pay.person_id) > pur_paid_from(pay.purchase_id, pay.source, pay.person_id)) then
    raise exception 'RESOLVED_FIRST' using errcode = 'P0001';
  end if;
  perform pur_event(v_owner, 'payment_voided', pay.purchase_id, pay.person_id, p_payment, pay.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'void_payment', jsonb_build_object('purchase_id', pay.purchase_id, 'pay', v_state));
end;
$$;

-- The main owner accepts an own-money payment made while "May use own
-- money" was off (Q21): from then on it counts in "Company owes buyer".
create or replace function pur_accept_own_money(p_op uuid, p_payment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  pay pur_payments;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into pay from pur_payments where id = p_payment and owner_id = v_owner for update;
  if pay.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if pay.source <> 'own_money' or pay.authorized or pay.accepted_at is not null or pay.rejected_at is not null
     or pay.voided_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update pur_payments set accepted_by = auth.uid(), accepted_at = now() where id = p_payment;
  perform pur_event(v_owner, 'own_money_accepted', pay.purchase_id, pay.person_id, p_payment, pay.amount, null, null);
  return pur_op_done(v_owner, p_op, 'accept_own_money',
                     jsonb_build_object('payment_id', p_payment, 'owes', pur_owes(v_owner, pay.person_id)));
end;
$$;

-- ... or rejects it, with a reason (R9): it is never owed. The payment
-- itself stays — the supplier was paid — and so does the decision.
create or replace function pur_reject_own_money(p_op uuid, p_payment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  pay pur_payments;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into pay from pur_payments where id = p_payment and owner_id = v_owner for update;
  if pay.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if pay.source <> 'own_money' or pay.authorized or pay.accepted_at is not null or pay.rejected_at is not null
     or pay.voided_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update pur_payments set rejected_by = auth.uid(), rejected_at = now(), reject_reason = v_reason where id = p_payment;
  perform pur_event(v_owner, 'own_money_rejected', pay.purchase_id, pay.person_id, p_payment, pay.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'reject_own_money',
                     jsonb_build_object('payment_id', p_payment, 'owes', pur_owes(v_owner, pay.person_id)));
end;
$$;

-- ════ 5. Overpaid: refunds and supplier credit (main owner, Q9–Q12) ══════

-- p_refunds: [{amount, funded_by, received_by, person_id?, received_on, note?}]
-- p_credit:  {amount, supplier_id?, note?} or null
-- Each refund part is capped by what that money paid; refunds + credits
-- never exceed what is over. All parts are saved together or not at all.
create or replace function pur_resolve_overpaid(p_op uuid, p_purchase uuid, p_refunds jsonb, p_credit jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  pu purchases;
  v_state jsonb;
  v_part jsonb;
  v_amount numeric;
  v_total numeric := 0;
  v_funded text; v_recv text; v_person uuid; v_day date;
  v_supplier uuid;
  v_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_refunds jsonb := coalesce(p_refunds, '[]'::jsonb);
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  perform pur_purchase_lock(p_purchase);
  select * into pu from purchases where id = p_purchase and owner_id = v_owner;
  if pu.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_refunds) <> 'array' or jsonb_array_length(v_refunds) > 10
     or (p_credit is not null and jsonb_typeof(p_credit) not in ('object', 'null')) then
    raise exception 'BAD_RESOLUTION' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_refunds) = 0 and (p_credit is null or jsonb_typeof(p_credit) = 'null') then
    raise exception 'NOTHING_TO_RESOLVE' using errcode = 'P0001';
  end if;

  for v_part in select value from jsonb_array_elements(v_refunds) loop
    v_amount := pur_pos_money(v_part ->> 'amount');
    v_funded := btrim(coalesce(v_part ->> 'funded_by', ''));
    v_recv := btrim(coalesce(v_part ->> 'received_by', ''));
    v_person := pur_uuid(v_part ->> 'person_id');
    v_day := pur_past_day(v_part ->> 'received_on');
    if v_funded in ('company', 'credit') and v_recv = 'company' then
      v_person := null;
    elsif not ((v_funded = 'petty_cash' and v_recv in ('petty_cash', 'company'))
               or (v_funded = 'own_money' and v_recv in ('buyer', 'company'))
               or (v_funded in ('company', 'credit') and v_recv = 'petty_cash')) then
      raise exception 'BAD_REFUND_ROUTE' using errcode = 'P0001';
    elsif v_person is null or not pur_holder_ok(v_owner, v_person) then
      raise exception 'NOT_A_BUYER' using errcode = 'P0001';
    end if;
    -- Never more back than that money paid (company / credit: any payment of that kind).
    if pur_refunded_from(p_purchase, v_funded, v_person) + v_amount
       > pur_paid_from(p_purchase, v_funded, case when v_funded in ('company', 'credit') then null else v_person end) then
      raise exception 'OVER_SOURCE' using errcode = 'P0001';
    end if;
    insert into pur_refunds (owner_id, purchase_id, amount, funded_by, received_by, person_id, received_on, note, created_by)
    values (v_owner, p_purchase, v_amount, v_funded, v_recv, v_person, v_day, pur_note(v_part ->> 'note'), auth.uid())
    returning id into v_id;
    perform pur_event(v_owner, 'refunded', p_purchase, v_person, v_id, v_amount,
                      jsonb_build_object('funded_by', v_funded, 'received_by', v_recv, 'received_on', v_day), null);
    v_ids := v_ids || jsonb_build_object('refund_id', v_id);
    v_total := v_total + v_amount;
  end loop;

  if p_credit is not null and jsonb_typeof(p_credit) = 'object' then
    v_amount := pur_pos_money(p_credit ->> 'amount');
    v_supplier := coalesce(pur_uuid(p_credit ->> 'supplier_id'), pu.supplier_id);
    if v_supplier is null or not exists (select 1 from suppliers s where s.id = v_supplier and s.owner_id = v_owner) then
      raise exception 'CREDIT_SUPPLIER' using errcode = 'P0001';
    end if;
    insert into pur_supplier_credits (owner_id, supplier_id, purchase_id, amount, note, created_by)
    values (v_owner, v_supplier, p_purchase, v_amount, pur_note(p_credit ->> 'note'), auth.uid())
    returning id into v_id;
    perform pur_event(v_owner, 'credit_confirmed', p_purchase, null, v_id, v_amount,
                      jsonb_build_object('supplier_id', v_supplier), null);
    v_ids := v_ids || jsonb_build_object('credit_id', v_id);
    v_total := v_total + v_amount;
  end if;

  -- The same peso is resolved once: refunds + credits never pass what is over.
  v_state := pur_pay_state(p_purchase);
  if (v_state ->> 'over_resolved')::numeric > 0 then
    raise exception 'OVER_RESOLVED' using errcode = 'P0001';
  end if;
  return pur_op_done(v_owner, p_op, 'resolve_overpaid',
                     jsonb_build_object('purchase_id', p_purchase, 'created', v_ids, 'pay', v_state));
end;
$$;

create or replace function pur_void_refund(p_op uuid, p_refund uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  r pur_refunds;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into r from pur_refunds where id = p_refund and owner_id = v_owner;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pur_purchase_lock(r.purchase_id);
  select * into r from pur_refunds where id = p_refund for update;
  if r.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pur_refunds set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_refund;
  perform pur_event(v_owner, 'refund_voided', r.purchase_id, r.person_id, p_refund, r.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'void_refund', jsonb_build_object('purchase_id', r.purchase_id, 'pay', pur_pay_state(r.purchase_id)));
end;
$$;

-- A credit already used is not voided (void its uses first).
create or replace function pur_void_credit(p_op uuid, p_credit uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  c pur_supplier_credits;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into c from pur_supplier_credits where id = p_credit and owner_id = v_owner;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pur_purchase_lock(c.purchase_id);
  select * into c from pur_supplier_credits where id = p_credit for update;
  if c.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  if exists (select 1 from pur_payments where credit_id = p_credit and voided_at is null) then
    raise exception 'CREDIT_USED' using errcode = 'P0001';
  end if;
  update pur_supplier_credits set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_credit;
  perform pur_event(v_owner, 'credit_voided', c.purchase_id, null, p_credit, c.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'void_credit', jsonb_build_object('purchase_id', c.purchase_id, 'pay', pur_pay_state(c.purchase_id)));
end;
$$;

-- ════ 6. Petty cash (Q13–Q19) ═════════════════════════════════════════

create or replace function pur_cash_give(p_op uuid, p_buyer uuid, p_amount text, p_on text, p_method text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_amount numeric;
  v_day date;
  v_method text := btrim(coalesce(p_method, ''));
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  v_amount := pur_pos_money(p_amount);
  v_day := pur_past_day(p_on);
  if v_method not in ('cash', 'gcash', 'bank_transfer', 'other') then
    raise exception 'BAD_METHOD' using errcode = 'P0001';
  end if;
  if not pur_holder_ok(v_owner, p_buyer) or not pur_can_buy(p_buyer, v_owner) then
    raise exception 'NOT_A_BUYER' using errcode = 'P0001';
  end if;
  insert into pur_cash_issues (owner_id, buyer_id, amount, issued_on, method, note, created_by)
  values (v_owner, p_buyer, v_amount, v_day, v_method, pur_note(p_note), auth.uid())
  returning id into v_id;
  perform pur_event(v_owner, 'cash_given', null, p_buyer, v_id, v_amount, jsonb_build_object('issued_on', v_day, 'method', v_method), null);
  return pur_op_done(v_owner, p_op, 'cash_give', jsonb_build_object('issue_id', v_id, 'held', pur_cash_raw(v_owner, p_buyer)));
end;
$$;

-- The buyer: "I did not receive this" (Q14). Flags only.
create or replace function pur_cash_dispute(p_op uuid, p_issue uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  v_note text := pur_reason(p_note);
  i pur_cash_issues;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into i from pur_cash_issues where id = p_issue and owner_id = v_owner and buyer_id = auth.uid() for update;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if i.voided_at is not null then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  if i.disputed_at is not null and i.dispute_cleared_at is null then
    raise exception 'ALREADY_DISPUTED' using errcode = 'P0001';
  end if;
  update pur_cash_issues set disputed_at = now(), dispute_note = v_note,
                             dispute_cleared_at = null, dispute_cleared_by = null, dispute_cleared_note = null
   where id = p_issue;
  perform pur_event(v_owner, 'cash_disputed', null, i.buyer_id, p_issue, i.amount, null, v_note);
  return pur_op_done(v_owner, p_op, 'cash_dispute', jsonb_build_object('issue_id', p_issue));
end;
$$;

-- The main owner settles a flag: the cash was handed over (the flag is
-- cleared, with a note). If it was NOT handed over, void the entry instead.
create or replace function pur_cash_clear_dispute(p_op uuid, p_issue uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_note text := pur_reason(p_note);
  i pur_cash_issues;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into i from pur_cash_issues where id = p_issue and owner_id = v_owner for update;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if i.disputed_at is null or i.dispute_cleared_at is not null or i.voided_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update pur_cash_issues set dispute_cleared_at = now(), dispute_cleared_by = auth.uid(), dispute_cleared_note = v_note
   where id = p_issue;
  perform pur_event(v_owner, 'dispute_cleared', null, i.buyer_id, p_issue, i.amount, null, v_note);
  return pur_op_done(v_owner, p_op, 'cash_clear_dispute', jsonb_build_object('issue_id', p_issue));
end;
$$;

create or replace function pur_cash_void_issue(p_op uuid, p_issue uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  i pur_cash_issues;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into i from pur_cash_issues where id = p_issue and owner_id = v_owner for update;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if i.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pur_cash_issues set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_issue;
  perform pur_event(v_owner, 'cash_issue_voided', null, i.buyer_id, p_issue, i.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'cash_void_issue', jsonb_build_object('issue_id', p_issue, 'held', pur_cash_raw(v_owner, i.buyer_id)));
end;
$$;

-- The buyer reports handing unused cash back (Q17): "Return awaiting confirmation".
create or replace function pur_cash_report_return(p_op uuid, p_amount text, p_handed_on text, p_handed_to text,
                                                  p_photo_url text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  v_amount numeric;
  v_day date;
  v_photo text := btrim(coalesce(p_photo_url, ''));
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  if not pur_holder_ok(v_owner, auth.uid()) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  v_amount := pur_pos_money(p_amount);
  v_day := pur_past_day(p_handed_on);
  -- R13: a return photo is the buyer's own upload in the private pettyCash/ folder.
  if v_photo <> '' and (v_photo !~ '^https://' or not exists (
       select 1 from receipt_uploads u
        where u.path = (receipt_paths_of(array[v_photo]))[1] and u.kind = 'petty_cash'
          and u.uploaded_by = auth.uid() and u.owner_id = v_owner)) then
    raise exception 'BAD_DOCS' using errcode = 'P0001';
  end if;
  insert into pur_cash_returns (owner_id, buyer_id, amount, handed_on, handed_to, photo_url, note, created_by)
  values (v_owner, auth.uid(), v_amount, v_day, pur_note(p_handed_to, 120), v_photo, pur_note(p_note), auth.uid())
  returning id into v_id;
  perform pur_event(v_owner, 'return_reported', null, auth.uid(), v_id, v_amount, jsonb_build_object('handed_on', v_day), null);
  return pur_op_done(v_owner, p_op, 'cash_report_return', jsonb_build_object('return_id', v_id));
end;
$$;

-- The buyer takes back a report the main owner has not decided yet.
create or replace function pur_cash_withdraw_return(p_op uuid, p_return uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  r pur_cash_returns;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into r from pur_cash_returns where id = p_return and owner_id = v_owner and buyer_id = auth.uid() for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'reported' then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  update pur_cash_returns set status = 'withdrawn' where id = p_return;
  perform pur_event(v_owner, 'return_withdrawn', null, r.buyer_id, p_return, r.amount, null, null);
  return pur_op_done(v_owner, p_op, 'cash_withdraw_return', jsonb_build_object('return_id', p_return));
end;
$$;

-- The main owner confirms the money arrived (the balance drops today, Q18)
-- or rejects the report with a reason.
create or replace function pur_cash_decide_return(p_op uuid, p_return uuid, p_confirm boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_note text;
  r pur_cash_returns;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  if p_confirm is null then raise exception 'BAD_DECISION' using errcode = 'P0001'; end if;
  v_note := case when p_confirm then pur_note(p_note) else pur_reason(p_note) end;
  select * into r from pur_cash_returns where id = p_return and owner_id = v_owner for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'reported' then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  update pur_cash_returns
     set status = case when p_confirm then 'confirmed' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), decision_note = v_note
   where id = p_return;
  perform pur_event(v_owner, case when p_confirm then 'return_confirmed' else 'return_rejected' end,
                    null, r.buyer_id, p_return, r.amount, jsonb_build_object('handed_on', r.handed_on), v_note);
  return pur_op_done(v_owner, p_op, 'cash_decide_return',
                     jsonb_build_object('return_id', p_return, 'held', pur_cash_raw(v_owner, r.buyer_id)));
end;
$$;

-- A confirmed return entered by mistake.
create or replace function pur_cash_void_return(p_op uuid, p_return uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  r pur_cash_returns;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into r from pur_cash_returns where id = p_return and owner_id = v_owner for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'confirmed' or r.voided_at is not null then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  update pur_cash_returns set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_return;
  perform pur_event(v_owner, 'return_voided', null, r.buyer_id, p_return, r.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'cash_void_return', jsonb_build_object('return_id', p_return, 'held', pur_cash_raw(v_owner, r.buyer_id)));
end;
$$;

-- A cash count (Q19): what the main owner counted, against the balance recorded that day.
create or replace function pur_cash_count(p_op uuid, p_buyer uuid, p_on text, p_counted text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_counted numeric := pur_money(p_counted);
  v_day date;
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  if v_counted is null or v_counted >= 10000000000 then raise exception 'BAD_AMOUNT' using errcode = 'P0001'; end if;
  v_day := pur_past_day(p_on);
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  insert into pur_cash_counts (owner_id, buyer_id, counted_on, counted, note, created_by)
  values (v_owner, p_buyer, v_day, v_counted, pur_note(p_note), auth.uid())
  returning id into v_id;
  perform pur_event(v_owner, 'cash_counted', null, p_buyer, v_id, v_counted,
                    jsonb_build_object('counted_on', v_day, 'recorded', pur_cash_raw(v_owner, p_buyer, v_day)), null);
  return pur_op_done(v_owner, p_op, 'cash_count', jsonb_build_object('count_id', v_id, 'counted', v_counted,
                                                                     'recorded', pur_cash_raw(v_owner, p_buyer, v_day)));
end;
$$;

create or replace function pur_cash_void_count(p_op uuid, p_count uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  k pur_cash_counts;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into k from pur_cash_counts where id = p_count and owner_id = v_owner for update;
  if k.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if k.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pur_cash_counts set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_count;
  perform pur_event(v_owner, 'count_voided', null, k.buyer_id, p_count, k.counted, null, v_reason);
  return pur_op_done(v_owner, p_op, 'cash_void_count', jsonb_build_object('count_id', p_count));
end;
$$;

-- ════ 7. The buyer's own money (Q21, Q22) ═════════════════════════════

create or replace function pur_set_own_money(p_buyer uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  if p_on is null then raise exception 'BAD_SWITCH' using errcode = 'P0001'; end if;
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  insert into pur_own_money (user_id, owner_id, allowed, updated_by, updated_at)
  values (p_buyer, v_owner, p_on, auth.uid(), now())
  on conflict (user_id) do update set allowed = excluded.allowed, owner_id = excluded.owner_id,
                                      updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where pur_own_money.allowed is distinct from excluded.allowed or pur_own_money.owner_id <> excluded.owner_id;
  if found then
    perform pur_event(v_owner, case when p_on then 'own_money_on' else 'own_money_off' end, null, p_buyer, null, null, null, null);
  end if;
  return jsonb_build_object('user_id', p_buyer, 'own_money', p_on);
end;
$$;

create or replace function pur_repay_buyer(p_op uuid, p_buyer uuid, p_amount text, p_on text, p_method text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_amount numeric;
  v_day date;
  v_method text := btrim(coalesce(p_method, ''));
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  v_amount := pur_pos_money(p_amount);
  v_day := pur_past_day(p_on);
  if v_method not in ('cash', 'gcash', 'bank_transfer', 'check', 'other') then
    raise exception 'BAD_METHOD' using errcode = 'P0001';
  end if;
  perform pur_person_lock(p_buyer);
  if v_amount > pur_owes(v_owner, p_buyer) then raise exception 'OVER_OWED' using errcode = 'P0001'; end if;
  insert into pur_buyer_repayments (owner_id, buyer_id, amount, paid_on, method, note, created_by)
  values (v_owner, p_buyer, v_amount, v_day, v_method, pur_note(p_note), auth.uid())
  returning id into v_id;
  perform pur_event(v_owner, 'repaid', null, p_buyer, v_id, v_amount, jsonb_build_object('paid_on', v_day, 'method', v_method), null);
  return pur_op_done(v_owner, p_op, 'repay_buyer', jsonb_build_object('repayment_id', v_id, 'owes', pur_owes(v_owner, p_buyer)));
end;
$$;

create or replace function pur_void_repayment(p_op uuid, p_repayment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  r pur_buyer_repayments;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into r from pur_buyer_repayments where id = p_repayment and owner_id = v_owner;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pur_person_lock(r.buyer_id);
  select * into r from pur_buyer_repayments where id = p_repayment for update;
  if r.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pur_buyer_repayments set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_repayment;
  perform pur_event(v_owner, 'repayment_voided', null, r.buyer_id, p_repayment, r.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'void_repayment', jsonb_build_object('repayment_id', p_repayment, 'owes', pur_owes(v_owner, r.buyer_id)));
end;
$$;

-- ════ 8. Reads ════════════════════════════════════════════════════════

-- 0101's list row, plus the payment state (Q2, Q12).
create or replace function pur_list_doc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
           'supplier', pu.supplier, 'receipt_total', pu.receipt_total,
           'recorded_by_name', pur_person_name(pu.recorded_by),
           'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
           'projects', (select coalesce(jsonb_agg(distinct l.folder_name), '[]'::jsonb) from purchase_lines l
                         where l.purchase_id = pu.id and l.destination = 'project'),
           'warehouse', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.destination = 'warehouse'),
           'lines', (select count(*) from purchase_lines l where l.purchase_id = pu.id),
           'linked', (select count(*) from purchase_lines l where l.purchase_id = pu.id and l.request_line_id is not null),
           'unplanned', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unplanned_reason <> ''),
           'extra', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.extra_qty > 0),
           'unit_check', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unit_check = 'pending'),
           'needs_review', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.needs_funding_review),
           'pending_change', exists (select 1 from purchase_change_requests r where r.purchase_id = pu.id and r.status = 'pending'),
           'no_receipt_reason', pu.no_receipt_reason,
           'replaced_by', pu.replaced_by,
           'pay', pur_pay_state(pu.id))
    from purchases pu where pu.id = p_purchase
$$;

-- One payment, as the screens show it.
create or replace function pur_payment_json(p_payment uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'purchase_id', p.purchase_id, 'first_purchase_id', p.first_purchase_id,
    'moved', p.first_purchase_id <> p.purchase_id,
    'amount', p.amount, 'paid_on', p.paid_on, 'method', p.method,
    'source', p.source, 'person_id', p.person_id,
    'person_name', case when p.person_id is null then null else pur_person_name(p.person_id) end,
    'credit_id', p.credit_id, 'authorized', p.authorized, 'accepted_at', p.accepted_at,
    'rejected_at', p.rejected_at, 'reject_reason', p.reject_reason,
    'proof_url', p.proof_url, 'note', p.note, 'created_by', p.created_by,
    'created_by_name', pur_person_name(p.created_by), 'created_at', p.created_at,
    'voided_at', p.voided_at, 'void_reason', p.void_reason,
    'can_void', p.voided_at is null and (p.created_by = auth.uid() or pur_is_main_owner()))
  from pur_payments p where p.id = p_payment
$$;

-- A purchase's payments, refunds and credits, and what the caller may use (buyers).
create or replace function pur_purchase_payments(p_purchase uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  pu purchases;
begin
  select * into pu from purchases where id = p_purchase and owner_id = v_owner;
  if pu.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'pay', pur_pay_state(p_purchase),
    'supplier_id', pu.supplier_id,
    'payments', (select coalesce(jsonb_agg(pur_payment_json(p.id) order by p.paid_on, p.created_at, p.id), '[]'::jsonb)
                   from pur_payments p where p.purchase_id = p_purchase),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', r.id, 'amount', r.amount, 'funded_by', r.funded_by, 'received_by', r.received_by,
                  'person_name', case when r.person_id is null then null else pur_person_name(r.person_id) end,
                  'received_on', r.received_on, 'note', r.note, 'voided_at', r.voided_at, 'void_reason', r.void_reason)
                  order by r.created_at), '[]'::jsonb) from pur_refunds r where r.purchase_id = p_purchase),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'amount', c.amount, 'left', pur_credit_left(c.id), 'supplier_id', c.supplier_id,
                  'supplier', (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end from suppliers s where s.id = c.supplier_id),
                  'note', c.note, 'voided_at', c.voided_at, 'void_reason', c.void_reason)
                  order by c.created_at), '[]'::jsonb) from pur_supplier_credits c where c.purchase_id = p_purchase),
    -- Credit with this purchase's supplier that a payment may use (Q11).
    'open_credits', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'left', pur_credit_left(c.id),
                       'from_purchase_id', c.purchase_id, 'created_at', c.created_at) order by c.created_at), '[]'::jsonb)
                       from pur_supplier_credits c
                      where c.owner_id = v_owner and pu.supplier_id is not null and c.supplier_id = pu.supplier_id
                        and c.voided_at is null and pur_credit_left(c.id) > 0),
    'me', jsonb_build_object('user_id', auth.uid(), 'main_owner', pur_is_main_owner(),
                             'holder', pur_holder_ok(v_owner, auth.uid()),
                             'own_money', pur_own_money_on(v_owner, auth.uid()),
                             'cash_held', case when pur_holder_ok(v_owner, auth.uid()) then pur_cash_raw(v_owner, auth.uid()) end));
end;
$$;

-- Supplier credits (Q12: buyers and the main owner see them).
create or replace function pur_credits(p_supplier uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_pay_owner();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id, 'supplier_id', c.supplier_id,
            'supplier', (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end from suppliers s where s.id = c.supplier_id),
            'amount', c.amount, 'left', pur_credit_left(c.id), 'purchase_id', c.purchase_id,
            'purchase_date', (select pu.purchase_date from purchases pu where pu.id = c.purchase_id),
            'note', c.note, 'created_at', c.created_at, 'voided_at', c.voided_at)
          order by c.created_at desc), '[]'::jsonb)
            from pur_supplier_credits c
           where c.owner_id = v_owner and (p_supplier is null or c.supplier_id = p_supplier));
end;
$$;

-- A buyer's cash, as the main owner's tracker and the buyer's own screen show it.
create or replace function pur_cash_summary(p_owner uuid, p_buyer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'buyer_id', p_buyer, 'name', pur_person_name(p_buyer),
    'recorded', pur_cash_raw(p_owner, p_buyer),
    'held', greatest(0, pur_cash_raw(p_owner, p_buyer)),
    'shortfall', greatest(0, -pur_cash_raw(p_owner, p_buyer)),
    'pending_returns', (select coalesce(sum(amount), 0) from pur_cash_returns
                         where owner_id = p_owner and buyer_id = p_buyer and status = 'reported'),
    'open_disputes', (select count(*) from pur_cash_issues where owner_id = p_owner and buyer_id = p_buyer
                        and voided_at is null and disputed_at is not null and dispute_cleared_at is null),
    'last_given_on', (select max(issued_on) from pur_cash_issues where owner_id = p_owner and buyer_id = p_buyer and voided_at is null),
    'owes', pur_owes(p_owner, p_buyer),
    'owes_to_review', pur_owes_to_review(p_owner, p_buyer),
    'own_money', pur_own_money_on(p_owner, p_buyer),
    'can_buy', pur_can_buy(p_buyer, p_owner),
    'last_count', (select jsonb_build_object('id', k.id, 'counted_on', k.counted_on, 'counted', k.counted,
                                             'recorded', pur_cash_raw(p_owner, p_buyer, k.counted_on), 'note', k.note)
                     from pur_cash_counts k where k.owner_id = p_owner and k.buyer_id = p_buyer and k.voided_at is null
                    order by k.counted_on desc, k.created_at desc limit 1))
$$;

-- One buyer's cash with the last 90 days of entries (internal: the callers
-- below check who is asking). Counts are listed for the main owner's view.
create or replace function pur_cash_detail(p_owner uuid, p_buyer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select pur_cash_summary(p_owner, p_buyer) || jsonb_build_object(
    'holder', true,
    'issues', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'amount', i.amount, 'issued_on', i.issued_on,
                 'method', i.method, 'note', i.note, 'disputed_at', i.disputed_at, 'dispute_note', i.dispute_note,
                 'dispute_cleared_at', i.dispute_cleared_at, 'dispute_cleared_note', i.dispute_cleared_note,
                 'voided_at', i.voided_at, 'void_reason', i.void_reason) order by i.issued_on desc, i.created_at desc), '[]'::jsonb)
                 from pur_cash_issues i where i.owner_id = p_owner and i.buyer_id = p_buyer
                  and i.issued_on >= pur_manila_today() - 90),
    'returns', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'handed_on', r.handed_on,
                  'handed_to', r.handed_to, 'status', r.status, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
                  'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)
                  from pur_cash_returns r where r.owner_id = p_owner and r.buyer_id = p_buyer
                   and (r.status = 'reported' or r.handed_on >= pur_manila_today() - 90)),
    'repayments', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'paid_on', x.paid_on,
                     'method', x.method, 'voided_at', x.voided_at) order by x.paid_on desc, x.created_at desc), '[]'::jsonb)
                     from pur_buyer_repayments x where x.owner_id = p_owner and x.buyer_id = p_buyer
                      and x.paid_on >= pur_manila_today() - 90),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'counted_on', k.counted_on, 'counted', k.counted,
                 'recorded', pur_cash_raw(p_owner, p_buyer, k.counted_on), 'note', k.note, 'voided_at', k.voided_at)
                 order by k.counted_on desc, k.created_at desc), '[]'::jsonb)
                 from pur_cash_counts k where k.owner_id = p_owner and k.buyer_id = p_buyer
                  and k.counted_on >= pur_manila_today() - 90))
$$;

-- The buyer's own cash (their phone / the Purchasing tab): balance, what is
-- waiting, what they are owed, and the last 90 days of entries.
create or replace function pur_my_cash() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
begin
  if not pur_holder_ok(v_owner, auth.uid()) then
    return jsonb_build_object('holder', false);
  end if;
  return pur_cash_detail(v_owner, auth.uid());
end;
$$;

-- The same for one buyer, for the main owner's tracker (voids live there).
create or replace function pur_cash_buyer(p_buyer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
begin
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  return pur_cash_detail(v_owner, p_buyer);
end;
$$;

-- The main owner's tracker (Q15, Q16, Q19, Q24): every staff buyer, or
-- anyone with cash on record; the returns and flags waiting; Overpaid.
create or replace function pur_cash_tracker() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  return jsonb_build_object(
    'today', pur_manila_today(),
    'buyers', (select coalesce(jsonb_agg(pur_cash_summary(v_owner, p.id) order by pur_person_name(p.id)), '[]'::jsonb)
                 from profiles p
                where p.role = 'staff' and p.owner_id = v_owner
                  and (pur_can_buy(p.id, v_owner)
                       or exists (select 1 from pur_cash_issues i where i.buyer_id = p.id and i.owner_id = v_owner)
                       or exists (select 1 from pur_payments x where x.person_id = p.id and x.owner_id = v_owner)
                       or exists (select 1 from pur_buyer_repayments r where r.buyer_id = p.id and r.owner_id = v_owner))),
    'pending_returns', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'buyer_id', r.buyer_id,
                          'name', pur_person_name(r.buyer_id), 'amount', r.amount, 'handed_on', r.handed_on,
                          'handed_to', r.handed_to, 'photo_url', r.photo_url, 'note', r.note, 'reported_at', r.created_at)
                          order by r.created_at), '[]'::jsonb)
                          from pur_cash_returns r where r.owner_id = v_owner and r.status = 'reported'),
    'disputes', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'buyer_id', i.buyer_id,
                   'name', pur_person_name(i.buyer_id), 'amount', i.amount, 'issued_on', i.issued_on,
                   'dispute_note', i.dispute_note, 'disputed_at', i.disputed_at) order by i.disputed_at), '[]'::jsonb)
                   from pur_cash_issues i where i.owner_id = v_owner and i.voided_at is null
                    and i.disputed_at is not null and i.dispute_cleared_at is null),
    'to_review', (select coalesce(jsonb_agg(pur_payment_json(x.id) order by x.paid_on, x.created_at), '[]'::jsonb)
                    from pur_payments x where x.owner_id = v_owner and x.source = 'own_money' and x.voided_at is null
                     and not x.authorized and x.accepted_at is null and x.rejected_at is null));
end;
$$;

-- Overpaid purchases (Q8, Q9) with a suggested split of what is over:
-- the LATEST payments are taken as the ones paid too much (plan R5), each
-- part no more than its money can still give back.
create or replace function pur_overpaid() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_out jsonb := '[]'::jsonb;
  v_pu record;
  v_state jsonb;
  v_left numeric;
  v_pay record;
  v_take numeric;
  v_cap numeric;
  v_split jsonb;
  v_key text;
  v_person uuid;
begin
  for v_pu in select pu.id from purchases pu
               where pu.owner_id = v_owner and exists (select 1 from pur_payments x where x.purchase_id = pu.id)
               order by pu.purchase_date desc, pu.created_at desc loop
    v_state := pur_pay_state(v_pu.id);
    continue when (v_state ->> 'unresolved')::numeric = 0 and (v_state ->> 'over_resolved')::numeric = 0;
    v_left := (v_state ->> 'unresolved')::numeric;
    v_split := '{}'::jsonb;
    for v_pay in select x.* from pur_payments x where x.purchase_id = v_pu.id and x.voided_at is null
                  order by x.paid_on desc, x.created_at desc, x.id desc loop
      exit when v_left <= 0;
      -- One part per kind of money (company and credit money is not anyone's own).
      v_person := case when v_pay.source in ('petty_cash', 'own_money') then v_pay.person_id end;
      v_key := v_pay.source || ':' || coalesce(v_person::text, '');
      v_cap := pur_paid_from(v_pu.id, v_pay.source, v_person)
               - pur_refunded_from(v_pu.id, v_pay.source, v_person)
               - coalesce((v_split -> v_key ->> 'amount')::numeric, 0);
      v_take := least(v_left, v_pay.amount, greatest(0, v_cap));
      continue when v_take <= 0;
      v_split := jsonb_set(v_split, array[v_key], jsonb_build_object(
                   'source', v_pay.source, 'person_id', v_person,
                   'person_name', case when v_person is null then null else pur_person_name(v_person) end,
                   'amount', coalesce((v_split -> v_key ->> 'amount')::numeric, 0) + v_take));
      v_left := v_left - v_take;
    end loop;
    v_out := v_out || jsonb_build_array(pur_list_doc(v_pu.id) || jsonb_build_object(
               'supplier_id', (select supplier_id from purchases where id = v_pu.id),
               'paid_by', (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'person_id', s.person_id,
                             'person_name', case when s.person_id is null then null else pur_person_name(s.person_id) end,
                             'paid', s.paid,
                             'refunded', pur_refunded_from(v_pu.id, s.source, s.person_id))), '[]'::jsonb)
                             from (select x.source, case when x.source in ('petty_cash', 'own_money') then x.person_id end as person_id,
                                          sum(x.amount) as paid
                                     from pur_payments x where x.purchase_id = v_pu.id and x.voided_at is null
                                    group by 1, 2) s),
               'suggested', (select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_each(v_split))));
  end loop;
  return v_out;
end;
$$;

-- The daily report (Q18, Q20): one buyer, a range of Philippine days
-- (at most 92). Each day: opening, what came in, what went out, closing —
-- recorded figures; the screens show ₱0 and a shortfall below zero. An
-- entry stays on its own day even if voided later (marked voided_on); the
-- void shows as a reversal on the day it was made (R7), so a past day's
-- closing never changes. Days with nothing on them are skipped. Each day:
--   opening + received + refunds_in − payments − returns + Σ reversals.effect = closing
create or replace function pur_cash_report(p_buyer uuid, p_from text, p_to text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_from date := pur_past_day(p_from);
  v_to date;
  v_day date;
  v_open numeric;
  v_close numeric;
  v_days jsonb := '[]'::jsonb;
  v_in jsonb; v_refunds jsonb; v_pays jsonb; v_rets jsonb; v_rev jsonb;
begin
  begin
    v_to := btrim(p_to)::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if v_to < v_from or v_to - v_from > 92 then raise exception 'BAD_RANGE' using errcode = 'P0001'; end if;
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  v_open := pur_cash_raw(v_owner, p_buyer, v_from - 1);
  v_close := v_open;
  for v_day in select d::date from generate_series(v_from, v_to, interval '1 day') d loop
    v_in := (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'amount', i.amount, 'method', i.method, 'note', i.note,
               'disputed', i.disputed_at is not null and i.dispute_cleared_at is null,
               'voided_on', (i.voided_at at time zone 'Asia/Manila')::date) order by i.created_at), '[]'::jsonb)
               from pur_cash_issues i where i.owner_id = v_owner and i.buyer_id = p_buyer and i.issued_on = v_day);
    v_refunds := (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'purchase_id', r.purchase_id,
                    'supplier', (select pu.supplier from purchases pu where pu.id = r.purchase_id), 'funded_by', r.funded_by,
                    'voided_on', (r.voided_at at time zone 'Asia/Manila')::date) order by r.created_at), '[]'::jsonb)
                    from pur_refunds r where r.owner_id = v_owner and r.person_id = p_buyer and r.received_by = 'petty_cash'
                     and r.received_on = v_day);
    v_pays := (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'method', x.method,
                 'purchase_id', x.purchase_id, 'supplier', pu.supplier, 'purchase_status', pu.status,
                 'projects', (select coalesce(jsonb_agg(distinct l.folder_name), '[]'::jsonb) from purchase_lines l
                               where l.purchase_id = pu.id and l.destination = 'project'),
                 'warehouse', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.destination = 'warehouse'),
                 'items', (select coalesce(jsonb_agg(l.item_name order by l.line_no), '[]'::jsonb) from purchase_lines l where l.purchase_id = pu.id),
                 'docs', pu.docs, 'proof_url', x.proof_url, 'note', x.note,
                 'voided_on', (x.voided_at at time zone 'Asia/Manila')::date) order by x.created_at), '[]'::jsonb)
                 from pur_payments x join purchases pu on pu.id = x.purchase_id
                where x.owner_id = v_owner and x.person_id = p_buyer and x.source = 'petty_cash' and x.paid_on = v_day);
    v_rets := (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'handed_on', r.handed_on,
                 'handed_to', r.handed_to, 'confirmed_at', r.decided_at,
                 'voided_on', (r.voided_at at time zone 'Asia/Manila')::date) order by r.decided_at), '[]'::jsonb)
                 from pur_cash_returns r where r.owner_id = v_owner and r.buyer_id = p_buyer and r.status = 'confirmed'
                  and (r.decided_at at time zone 'Asia/Manila')::date = v_day);
    -- Voids made on this day: each undoes its entry from here on (effect: +in / −out).
    v_rev := (select coalesce(jsonb_agg(x.v order by x.at), '[]'::jsonb) from (
                select i.voided_at as at, jsonb_build_object('what', 'Petty cash given', 'entry_day', i.issued_on,
                         'amount', i.amount, 'effect', -i.amount, 'reason', i.void_reason) as v
                  from pur_cash_issues i where i.owner_id = v_owner and i.buyer_id = p_buyer
                   and (i.voided_at at time zone 'Asia/Manila')::date = v_day
                union all
                select r.voided_at, jsonb_build_object('what', 'Refund received', 'entry_day', r.received_on,
                         'amount', r.amount, 'effect', -r.amount, 'reason', r.void_reason)
                  from pur_refunds r where r.owner_id = v_owner and r.person_id = p_buyer and r.received_by = 'petty_cash'
                   and (r.voided_at at time zone 'Asia/Manila')::date = v_day
                union all
                select x.voided_at, jsonb_build_object('what', 'Paid to supplier', 'entry_day', x.paid_on,
                         'amount', x.amount, 'effect', x.amount, 'reason', x.void_reason)
                  from pur_payments x where x.owner_id = v_owner and x.person_id = p_buyer and x.source = 'petty_cash'
                   and (x.voided_at at time zone 'Asia/Manila')::date = v_day
                union all
                select r.voided_at, jsonb_build_object('what', 'Returned to the owner', 'entry_day', (r.decided_at at time zone 'Asia/Manila')::date,
                         'amount', r.amount, 'effect', r.amount, 'reason', r.void_reason)
                  from pur_cash_returns r where r.owner_id = v_owner and r.buyer_id = p_buyer and r.status = 'confirmed'
                   and (r.voided_at at time zone 'Asia/Manila')::date = v_day) x);
    continue when v_in = '[]'::jsonb and v_refunds = '[]'::jsonb and v_pays = '[]'::jsonb and v_rets = '[]'::jsonb
              and v_rev = '[]'::jsonb;
    v_open := pur_cash_raw(v_owner, p_buyer, v_day - 1);
    v_close := pur_cash_raw(v_owner, p_buyer, v_day);
    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'day', v_day, 'opening', v_open, 'received', v_in, 'refunds_in', v_refunds, 'payments', v_pays,
      'returns', v_rets, 'reversals', v_rev, 'closing', v_close));
  end loop;
  return jsonb_build_object(
    'buyer_id', p_buyer, 'name', pur_person_name(p_buyer), 'from', v_from, 'to', v_to,
    'opening', pur_cash_raw(v_owner, p_buyer, v_from - 1), 'closing', pur_cash_raw(v_owner, p_buyer, v_to),
    'days', v_days,
    'pending_returns', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'handed_on', r.handed_on))
                          , '[]'::jsonb) from pur_cash_returns r
                          where r.owner_id = v_owner and r.buyer_id = p_buyer and r.status = 'reported'),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('counted_on', k.counted_on, 'counted', k.counted,
                 'recorded', pur_cash_raw(v_owner, p_buyer, k.counted_on), 'note', k.note) order by k.counted_on), '[]'::jsonb)
                 from pur_cash_counts k where k.owner_id = v_owner and k.buyer_id = p_buyer and k.voided_at is null
                  and k.counted_on between v_from and v_to));
end;
$$;

-- Project Control's Unpaid / Partially paid / Paid badge (owner/admin only,
-- Stage 2 Q8): purchase line and charge ids of recorded, tracked purchases.
create or replace function pur_payment_badges() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null or not coalesce(is_owner(), false) or not pr_is_office() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  v_owner := pur_actor_owner('expenses_form');
  return coalesce((
    select jsonb_object_agg(x.id, x.state)
      from (select l.id::text as id, pur_pay_state(pu.id) ->> 'state' as state
              from purchases pu join purchase_lines l on l.purchase_id = pu.id
             where pu.owner_id = v_owner and pu.status = 'recorded'
            union all
            select c.id::text, pur_pay_state(pu.id) ->> 'state'
              from purchases pu join purchase_charges c on c.purchase_id = pu.id
             where pu.owner_id = v_owner and pu.status = 'recorded') x
     where x.state in ('unpaid', 'partial', 'paid', 'overpaid')), '{}'::jsonb);
end;
$$;

-- ════ 9. Receipt photos of payments and returns mark their upload attached ══
create or replace function public.receipt_mark_attached() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_vals text[];
begin
  if tg_table_name = 'expenses' then
    v_vals := array[new.po_image_url, new.delivery_receipt_url, new.supplier_invoice_url, new.payment_receipt_url];
  elsif tg_table_name = 'purchases' then
    select coalesce(array_agg(x), '{}') into v_vals
      from jsonb_each_text(case when jsonb_typeof(new.docs) = 'object' then new.docs else '{}'::jsonb end) d(k, x);
  elsif tg_table_name = 'pur_payments' then
    v_vals := array[new.proof_url];
  elsif tg_table_name = 'pur_cash_returns' then
    v_vals := array[new.photo_url];
  else
    select coalesce(array_agg(x), '{}') into v_vals
      from jsonb_array_elements_text(case when jsonb_typeof(new.receipt_images) = 'array'
                                          then new.receipt_images else '[]'::jsonb end) x;
  end if;
  update receipt_uploads
     set state = 'attached', attached_at = now()
   where state = 'pending' and owner_id = new.owner_id and path = any (receipt_paths_of(v_vals));
  return null;
end $$;
revoke all on function public.receipt_mark_attached() from public, anon;
drop trigger if exists pur_payments_receipt_attach on public.pur_payments;
create trigger pur_payments_receipt_attach
  after insert on public.pur_payments for each row execute function public.receipt_mark_attached();
drop trigger if exists pur_cash_returns_receipt_attach on public.pur_cash_returns;
create trigger pur_cash_returns_receipt_attach
  after insert on public.pur_cash_returns for each row execute function public.receipt_mark_attached();

-- ════ 9b. Return photos: their own private folder (R13) ══════════════════
-- pettyCash/<company>/<yyyy-mm>/<id>.jpg. A buyer's cash is theirs alone
-- (Q24): a return photo is read only by the MAIN owner and by the buyer who
-- uploaded it (the upload ledger says who), never by other buyers. Payment
-- proofs stay in purchases/: buyers may see payments on purchases (Q24).
-- Checked before the uploader read-back and the generic owner/staff rule.

-- The upload ledger learns the kind; only buyers file it, in their company.
alter table public.receipt_uploads drop constraint if exists receipt_uploads_path_check;
alter table public.receipt_uploads add constraint receipt_uploads_path_check
  check (path ~ '^(expenseReceipts|payrollReceipts|purchases|pettyCash)/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$');
alter table public.receipt_uploads drop constraint if exists receipt_uploads_kind_check;
alter table public.receipt_uploads add constraint receipt_uploads_kind_check check (kind in ('expense', 'payroll', 'purchase', 'petty_cash'));
drop policy if exists receipt_uploads_insert on public.receipt_uploads;
create policy receipt_uploads_insert on public.receipt_uploads
  for insert to authenticated
  with check ((is_owner() or is_staff())
              and owner_id = data_owner_id()
              and uploaded_by = auth.uid()
              and state = 'pending'
              and split_part(path, '/', 2) = owner_id::text
              and (kind not in ('purchase', 'petty_cash') or pur_buyer())
              and split_part(path, '/', 1) = case kind when 'expense' then 'expenseReceipts'
                                                       when 'payroll' then 'payrollReceipts'
                                                       when 'petty_cash' then 'pettyCash'
                                                       else 'purchases' end);

-- May the caller read this pettyCash/ file? The main owner of that company,
-- or the account that uploaded it. SECURITY DEFINER: the ledger's own read
-- policy must not decide this.
create or replace function public.pur_petty_reader(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and split_part(p_name, '/', 2) = data_owner_id()::text
     and (pur_is_main_owner()
          or exists (select 1 from receipt_uploads u where u.path = p_name and u.uploaded_by = auth.uid()))
$$;

-- 0097's rules, plus the pettyCash folder.
create or replace function public.uploads_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_pid    uuid := dacs_try_uuid(split_part(p_name, '/', 2));
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only (not even the uploader once the switch is off).
  if v_folder = 'purchases' then
    return pur_buyer() and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- 0102: petty cash return photos — the main owner and the uploading buyer only.
  if v_folder = 'pettyCash' then
    return pur_petty_reader(p_name);
  end if;

  -- The uploader can always read back their own file.
  if p_owner_id is not null and p_owner_id = v_uid::text then return true; end if;

  -- Owner-only modules (quotations 0045, reimbursements 0041).
  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- Owner and staff: everything else (staff encode receipts from here).
  if is_owner() or is_staff() then return true; end if;

  -- Construction client / partner: files filed under THEIR project. Same
  -- test as the weekly_bills _client_read / _partner_read policies.
  if v_folder in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms') then
    return v_pid is not null
       and (cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid));
  end if;

  -- Employee agreement PDF: every non-owner admin role (staff, worker,
  -- teamLeader) signs it at first login in admin.html (js/admin.js).
  if v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false); end if;

  -- Agreement templates shown at the client/partner signing gates.
  -- coalesce: a profile with a NULL role must not be denied (NOT NULL = NULL).
  if v_folder = 'agreementDocs' then return not coalesce(is_worker(), false); end if;

  return false;
end $$;

create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only.
  if v_folder = 'purchases' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  -- 0102: petty cash return photos — buyers of THAT company (read back through the ledger).
  if v_folder = 'pettyCash' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  if is_owner() or is_staff() then return true; end if;
  -- Signatures. Clients/partners (js/client-management-app.js):
  --   signatures/<uid>_<ts>.png  and  signatures/proj_<project>_<uid>_<ts>.png
  -- Workers/team leaders (employee agreement gate, js/admin.js):
  --   signatures/employee_<uid>_<ts>.png  only
  if v_folder = 'signatures' then
    if coalesce(is_worker(), false) then
      return p_name ~ ('^signatures/employee_' || v_uid::text || '_[0-9]+\.png$');
    end if;
    return p_name ~ ('^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\.png$');
  end if;
  --   signed-terms/<uid>/<ts>_<name>.pdf   (dacsSnapshotPdf, every signing gate)
  if v_folder = 'signed-terms'  then return v_seg2 = v_uid::text; end if;

  -- Workers and team leaders upload nothing else.
  if coalesce(is_worker(), false) then return false; end if;
  --   procurementReceipts/<project>/…  (client "bought by client" receipt; clients only,
  --   partners are read-only, same as the procurement_client_update table policy)
  if v_folder = 'procurementReceipts' then
    return dacs_try_uuid(v_seg2) is not null and cproj_client_can_read(dacs_try_uuid(v_seg2));
  end if;

  return false;
end $$;

revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- 0097's overwrite policy; a return photo is never overwritten.
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) = 'pettyCash' then false
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) = 'pettyCash' then false
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end);

-- ════ 10. Privileges ═══════════════════════════════════════════════════

alter table pur_payments enable row level security;
alter table pur_supplier_credits enable row level security;
alter table pur_refunds enable row level security;
alter table pur_cash_issues enable row level security;
alter table pur_cash_returns enable row level security;
alter table pur_cash_counts enable row level security;
alter table pur_own_money enable row level security;
alter table pur_buyer_repayments enable row level security;
alter table pur_money_events enable row level security;
revoke all on table pur_payments, pur_supplier_credits, pur_refunds, pur_cash_issues, pur_cash_returns,
                    pur_cash_counts, pur_own_money, pur_buyer_repayments, pur_money_events
  from public, anon, authenticated;
revoke all on sequence pur_money_events_seq_seq from public, anon, authenticated;

-- Internal helpers: only the SECURITY DEFINER operations call them.
revoke all on function pur_money_events_immutable(), pur_manila_today(), pur_pos_money(text), pur_past_day(text),
                       pur_note(text, int), pur_reason(text), pur_pay_owner(), pur_is_main_owner(), pur_main_owner(),
                       pur_holder_ok(uuid, uuid), pur_own_money_on(uuid, uuid),
                       pur_event(uuid, text, uuid, uuid, uuid, numeric, jsonb, text), pur_op_done(uuid, uuid, text, jsonb),
                       pur_person_lock(uuid), pur_credit_left(uuid), pur_paid_from(uuid, text, uuid),
                       pur_refunded_from(uuid, text, uuid), pur_resolved(uuid), pur_pay_state(uuid),
                       pur_cash_raw(uuid, uuid, date), pur_owes(uuid, uuid), pur_owes_to_review(uuid, uuid),
                       pur_pay_insert(uuid, uuid, jsonb), pur_pay_follow_replace(), pur_payment_json(uuid),
                       pur_cash_summary(uuid, uuid), pur_cash_detail(uuid, uuid), pur_stood(timestamptz, date)
  from public, anon, authenticated;
-- The storage rules run as the signed-in reader: like pur_buyer(), callable, answering only about the caller.
revoke all on function public.pur_petty_reader(text) from public, anon;
grant execute on function public.pur_petty_reader(text) to authenticated;
-- Restated: create or replace keeps a function's permissions, so they can never drift.
revoke all on function pur_header_ok(jsonb) from public, anon, authenticated;
revoke all on function pur_list_doc(uuid) from public, anon, authenticated;

-- Called by Dacs Web and WorkMate (each checks its caller itself).
revoke all on function pur_record(uuid, jsonb), pur_pay(uuid, uuid, jsonb), pur_void_payment(uuid, uuid, text),
                       pur_accept_own_money(uuid, uuid), pur_reject_own_money(uuid, uuid, text), pur_resolve_overpaid(uuid, uuid, jsonb, jsonb),
                       pur_void_refund(uuid, uuid, text), pur_void_credit(uuid, uuid, text),
                       pur_cash_give(uuid, uuid, text, text, text, text), pur_cash_dispute(uuid, uuid, text),
                       pur_cash_clear_dispute(uuid, uuid, text), pur_cash_void_issue(uuid, uuid, text),
                       pur_cash_report_return(uuid, text, text, text, text, text), pur_cash_withdraw_return(uuid, uuid),
                       pur_cash_decide_return(uuid, uuid, boolean, text), pur_cash_void_return(uuid, uuid, text),
                       pur_cash_count(uuid, uuid, text, text, text), pur_cash_void_count(uuid, uuid, text),
                       pur_set_own_money(uuid, boolean), pur_repay_buyer(uuid, uuid, text, text, text, text),
                       pur_void_repayment(uuid, uuid, text), pur_purchase_payments(uuid), pur_credits(uuid),
                       pur_my_cash(), pur_cash_buyer(uuid), pur_cash_tracker(), pur_overpaid(), pur_cash_report(uuid, text, text),
                       pur_payment_badges()
  from public, anon;
grant execute on function pur_record(uuid, jsonb), pur_pay(uuid, uuid, jsonb), pur_void_payment(uuid, uuid, text),
                          pur_accept_own_money(uuid, uuid), pur_reject_own_money(uuid, uuid, text), pur_resolve_overpaid(uuid, uuid, jsonb, jsonb),
                          pur_void_refund(uuid, uuid, text), pur_void_credit(uuid, uuid, text),
                          pur_cash_give(uuid, uuid, text, text, text, text), pur_cash_dispute(uuid, uuid, text),
                          pur_cash_clear_dispute(uuid, uuid, text), pur_cash_void_issue(uuid, uuid, text),
                          pur_cash_report_return(uuid, text, text, text, text, text), pur_cash_withdraw_return(uuid, uuid),
                          pur_cash_decide_return(uuid, uuid, boolean, text), pur_cash_void_return(uuid, uuid, text),
                          pur_cash_count(uuid, uuid, text, text, text), pur_cash_void_count(uuid, uuid, text),
                          pur_set_own_money(uuid, boolean), pur_repay_buyer(uuid, uuid, text, text, text, text),
                          pur_void_repayment(uuid, uuid, text), pur_purchase_payments(uuid), pur_credits(uuid),
                          pur_my_cash(), pur_cash_buyer(uuid), pur_cash_tracker(), pur_overpaid(), pur_cash_report(uuid, text, text),
                          pur_payment_badges()
  to authenticated;
```

**Modify:** `supabase/migrations/README.md` — apply with `git apply --ignore-whitespace`

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
index f57ea44..fc9b90a 100644
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0102** — highest on disk is
-  `0101_purchasing_phone.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0103** — highest on disk is
+  `0102_purchase_payments.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -188,6 +188,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0101 (WorkMate Stage 2A-3a — what phone purchasing needs from the server)** adds `pur_signin_can_buy(user)` (service role only: the `attendance-signin` Edge Function's buyer check — the same answer `pur_buyer()` gives that account signed in, its company worked out as `data_owner_id()` does); redefines `pur_fund` (now VOLATILE: an Additional Works job with no billing period gets ONE hidden period — `funding_type 'downpayment'`, the purchase's month and year, no budget row, no allocation snapshot, as the web's staff path makes it — instead of `AW_NO_PERIOD`; the job is still charged in full, never Cover; the job's `pur_folder:` lock keeps it to one period); adds `purchases.no_receipt_reason` with trigger `purchases_require_receipt` (a PHONE purchase, source `workmate`, needs an https receipt link in `docs` or a reason — `NO_RECEIPT`; the web keeps receipts optional) and redefines `pur_insert` only to store the reason (≤ 300, `BAD_REASON`); adds `pur_list_doc` (one purchases-list row, now also `no_receipt_reason` and `replaced_by`), `pur_my_purchases(days)` (what the caller bought or recorded, every status, last 1–366 days), `pur_destinations()` (open projects with their open AW jobs) and `pur_my_pending_changes()` (the caller's own change requests waiting for the owner, with their purchase's line and charge ids — no amounts — for Project Control's "Waiting for the owner" and Withdraw); `pur_purchases` and `pur_purchase_view` show the reason. Spent is computed exactly as before. **Apply 0101 before deploying the `attendance-signin` change and the web change** (both call it). Prove with `npm run test:sql` (`2a3_server.pglite.mjs`, `2a3_concurrency.mjs`, and the 2A-1 / 2A-2 suites re-run `--with-0101`); live: `supabase/tests/2a3_acceptance.sql` (self-wrapped, rolls back).
 
+**0102 (WorkMate Stage 2A-4a — paying for purchases; OUTSIDE the money model)** adds nine private tables (RLS on, no policies, every privilege revoked — reads and writes only through its functions): `pur_payments` (a payment on the WHOLE purchase: amount, actual day, method, and the money it came from — `petty_cash` / `own_money` (a staff buyer's) / `company` / `credit`; voided with a reason, never deleted), `pur_supplier_credits` (a balance with one supplier, from an overpaid purchase, used in parts by `credit` payments), `pur_refunds` (tied to the money that paid: `funded_by` × `received_by` decides whether the buyer's cash held or "Company owes buyer" moves; a credit-funded excess is refunded in cash only when the owner records it — by default it goes back to the supplier's credit), `pur_cash_issues` / `pur_cash_returns` / `pur_cash_counts` (petty cash given by the main owner, returns the buyer reports and the main owner confirms — the balance drops on the confirmation day — and cash counts, a record only), `pur_own_money` (the "May use own money" switch), `pur_buyer_repayments`, and the append-only `pur_money_events`; plus `purchases.payments_tracked` (false on every purchase recorded before 0102 — "Payment not tracked" — true from then on). Redefines `pur_record` (body `payments`: "paid now", accepted in the SAME transaction as the purchase or not at all), `pur_header_ok` (a correction or replacement carrying `payments` is `BAD_PAY`), `pur_list_doc` (adds `pay`, the payment state) and `receipt_mark_attached` (payment proofs and return photos); a trigger moves payments, refunds and credits to a purchase's replacement (each payment keeps its `first_purchase_id`; one history entry per moved row). Return photos get their own folder, `pettyCash/` (redefines `uploads_can_read` / `uploads_can_write`, the `uploads_admin_update` policy and the `receipt_uploads` checks and insert policy: only the main owner and the uploading buyer read one). A voided petty-cash entry stays on its own day; the void counts on the day it was made. Buyers (`pur_buyer`) record and void their payments and see their own cash; the MAIN owner (0098's `pm_main_owner_id`, with the Expenses section) gives petty cash, confirms returns, resolves Overpaid, repays, sets the switch and reads the tracker and daily report. Every write takes an operation id (`pur_ops`). **Writes and reads no `expenses` or `payroll` row: Spent is computed exactly as before.** Requires 0098. Prove with `npm run test:sql` (`2a4_payments.pglite.mjs`, `2a4_concurrency.mjs`, and the 2A-1 / 2A-2 / 2A-3 suites re-run `--with-0102`) and `node tests/purchasing-payments-server.test.js`; live: `supabase/tests/2a4_acceptance.sql` (self-wrapped, rolls back).
+
 Get the truth before relying on this line:
 
 ```sql
````


- [ ] **Step 1: Apply the files above.** Create blocks as given; Modify blocks with `git apply --ignore-whitespace`. The README and DATABASE_SCHEMA diffs are shown with LF, so the applied lines come out LF; put both files back to CRLF everywhere:

```bash
node -e "const fs=require('fs');for(const f of ['supabase/migrations/README.md','docs/DATABASE_SCHEMA.md'])fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"
```

  Check: `git diff --stat` shows only the added lines for both files (no whole-file rewrite).
- [ ] **Step 2: Tests.** `npm test` → every suite passes, the money suite **249**; `node tests/purchasing-payments-server.test.js` → 16 passed; `storage-access` 20. `npm run test:sql` → every suite passes, including `2a4_payments.pglite.mjs` (**47**), `2a4_concurrency.mjs` (**4**) and the 2A-1 / 2A-2 / 2A-3 suites `--with-0102` (45 / 44 / 23).
- [ ] **Step 3: Stop for the user** to review and commit.

### Task 2: Dacs Web — payments, Paid now, the Cash tab, the owner badge

**Interfaces used:** Task 1's functions only (`pur_pay`, `pur_void_payment`, `pur_resolve_overpaid`, `pur_purchase_payments`, `pur_credits`, `pur_my_cash`, `pur_cash_*`, `pur_overpaid`, `pur_payment_badges`, `pur_record` with `payments`).

<!-- Tests -->

**Modify:** `tests/purchasing-admin.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/purchasing-admin.test.js b/tests/purchasing-admin.test.js
index 597bfd7..ce6151d 100644
--- a/tests/purchasing-admin.test.js
+++ b/tests/purchasing-admin.test.js
@@ -146,10 +146,19 @@ test('the screens call only purchasing RPCs and write no table directly', () =>
     'pur_purchases', 'pur_purchase', 'pur_check_unit', 'pur_request_change', 'pur_change_requests', 'pur_decide_change',
     'pur_withdraw_change',
     // 2A-3a: the Purchases list's project filter (read-only, office accounts).
-    'pr_office_projects']);
-  for (const f of ['purchasing-admin-core', 'purchasing-admin-list', 'purchasing-admin-record', 'purchasing-admin-purchases']) {
+    'pr_office_projects',
+    // 2A-4a (0102): payments, Overpaid, petty cash, own money — every one checks its caller.
+    'pur_pay', 'pur_void_payment', 'pur_accept_own_money', 'pur_reject_own_money', 'pur_resolve_overpaid', 'pur_void_refund', 'pur_void_credit',
+    'pur_cash_give', 'pur_cash_dispute', 'pur_cash_clear_dispute', 'pur_cash_void_issue', 'pur_cash_report_return',
+    'pur_cash_withdraw_return', 'pur_cash_decide_return', 'pur_cash_void_return', 'pur_cash_count', 'pur_cash_void_count',
+    'pur_set_own_money', 'pur_repay_buyer', 'pur_void_repayment', 'pur_purchase_payments', 'pur_credits', 'pur_my_cash',
+    'pur_cash_tracker', 'pur_cash_buyer', 'pur_overpaid', 'pur_cash_report']);
+  for (const f of ['purchasing-admin-core', 'purchasing-admin-list', 'purchasing-admin-record', 'purchasing-admin-purchases',
+                   'purchasing-admin-pay', 'purchasing-admin-cash']) {
     const src = read('js/' + f + '.js');
     for (const m of src.matchAll(/rpc\('([a-z_]+)'/g)) ok(allowed.has(m[1]), f + ' calls ' + m[1]);
+    // Calls made through a helper (voidModal / noteModal) name the function as a plain string.
+    for (const m of src.matchAll(/'((?:pur|pr)_[a-z_]+)'/g)) ok(allowed.has(m[1]), f + ' names ' + m[1]);
     ok(!/\.(insert|update|upsert|delete)\(/.test(src.replace(/\.update\(\)/g, '')), f + ' writes a table directly');
   }
 });
```

**Create:** `tests/purchasing-payments-screens.test.js`

```js
// ════════════════════════════════════════════════════════════════════
// PAYMENTS AND PETTY CASH SCREENS (0102, 2A-4a):
//   run with  node tests/purchasing-payments-screens.test.js
//
// Zero dependencies. Loads the REAL js/purchasing-admin-core.js (its pure
// half) and reads the screens' source:
//   1. The words and checks agree with the server: payment states, what a
//      payment form must refuse, "paid now", refund routes, the Overpaid
//      split, cash held never below ₱0, the daily report and its CSV.
//   2. Outside the money model: the screens write no table, read no expense
//      row, and every server error has a sentence.
//   3. Staff never see a payment badge in Project Control; the Cash tab and
//      the badge are wired in; each write is sent once.
// ════════════════════════════════════════════════════════════════════
'use strict';
const pa = require('../js/purchasing-admin-core.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

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

console.log('\npayments: the words agree with the server');

test('every payment state has a pill; the detail says what is left or over', () => {
  const states = ['not_tracked', 'unpaid', 'partial', 'paid', 'overpaid', 'void', 'void_paid'];
  const sql = read('supabase/migrations/0102_purchase_payments.sql');
  for (const s of states) ok(sql.includes("'" + s + "'"), s + ' is a server state');
  eq(Object.keys(pa.PAY_STATE).sort(), states.slice().sort());
  eq(pa.payLabel({ state: 'partial', balance: 7000 }), { text: 'Partially paid', tone: 'working', detail: '₱7,000.00 left' });
  eq(pa.payLabel({ state: 'overpaid', unresolved: 500 }).detail, '₱500.00 to recover');
  eq(pa.payLabel({ state: 'not_tracked' }).text, 'Payment not tracked', 'Q2: never "Unpaid" for an old purchase');
  eq(pa.payLabel(null), null);
});
test('a payment form is refused before sending exactly where the server would refuse it', () => {
  const p = (x) => Object.assign({ amount: '500', paidOn: '2026-10-22', method: 'cash', source: 'company' }, x);
  const ctx = { today: '2026-10-22' };
  eq(pa.paymentProblems(p(), ctx), []);
  eq(pa.paymentProblems(p({ amount: '0' }), ctx), ['BAD_AMOUNT']);
  eq(pa.paymentProblems(p({ amount: '1.005' }), ctx), ['BAD_AMOUNT'], 'three decimals');
  eq(pa.paymentProblems(p({ paidOn: '2026-10-23' }), ctx), ['BAD_DATE'], 'not in the future');
  eq(pa.paymentProblems(p({ paidOn: '2019-12-31' }), ctx), ['BAD_DATE']);
  eq(pa.paymentProblems(p({ source: 'loan' }), ctx), ['BAD_PAY_SOURCE']);
  eq(pa.paymentProblems(p({ method: 'barter' }), ctx), ['BAD_METHOD']);
  eq(pa.paymentProblems(p({ source: 'credit' }), ctx), ['CREDIT_REQUIRED']);
  eq(pa.paymentProblems(p({ source: 'credit', creditId: 'c1', method: '' }), { today: '2026-10-22', creditLeft: 300 }), ['OVER_CREDIT']);
  eq(pa.paymentProblems(p({ source: 'credit', creditId: 'c1', amount: '300', method: '' }), { today: '2026-10-22', creditLeft: 300 }), [], 'credit has no method');
});
test('the payment body: a credit is "other", not cash; a person only when given', () => {
  eq(pa.paymentBody({ amount: '1,250.5', paidOn: '2026-10-22', method: 'gcash', source: 'company', note: ' deposit ' }),
     { amount: '1250.5', paid_on: '2026-10-22', source: 'company', method: 'gcash', note: 'deposit' });
  const c = pa.paymentBody({ amount: '200', paidOn: '2026-10-22', method: 'cash', source: 'credit', creditId: 'c1' });
  eq([c.method, c.credit_id, 'person_id' in c], ['other', 'c1', false]);
  eq(pa.paymentBody({ amount: '1', paidOn: '2026-10-22', method: 'cash', source: 'petty_cash', personId: 'u2', proofUrl: 'https://x/p.jpg' }).person_id, 'u2');
});
test('Q16: paying more than the cash on record is a warning, never a refusal', () => {
  eq(pa.cashWarning('800', 800), '');
  ok(/You hold ₱800\.00[\s\S]*₱1,000\.00[\s\S]*shortfall/.test(pa.cashWarning('1000', 800)), 'warns');
  ok(/You hold ₱0\.00/.test(pa.cashWarning('10', -200)), 'never says below zero');
  eq(pa.cashWarning('10', null), '', 'unknown balance: no warning');
});
test('Q3 "paid now": none sends nothing; full sends the receipt total; part needs less than it; petty cash needs a staff buyer', () => {
  const st = (x) => Object.assign({ paidNow: 'full', paidFrom: 'company', paidMethod: 'gcash', purchaseDate: '2026-10-22' }, x);
  eq(pa.paidNowPayments(st({ paidNow: 'none' }), 1250, 'u1'), []);
  eq(pa.paidNowPayments(st(), 1250, null), [{ amount: '1250', paid_on: '2026-10-22', source: 'company', method: 'gcash', note: '' }]);
  eq(pa.paidNowPayments(st({ paidNow: 'part', paidAmount: '300', paidFrom: 'petty_cash' }), 1250, 'u1')[0].person_id, 'u1');
  eq(pa.paidNowPayments(st({ paidFrom: 'company' }), 1250, 'u1')[0].person_id, undefined, 'company: no person sent');
  eq(pa.paidNowProblems(st({ paidNow: 'part', paidAmount: '1250' }), 1250, null), ['PART_NOT_LESS']);
  eq(pa.paidNowProblems(st({ paidNow: 'part', paidAmount: '' }), 1250, null), ['PAID_AMOUNT']);
  eq(pa.paidNowProblems(st({ paidFrom: 'own_money' }), 1250, null), ['PERSON_REQUIRED']);
  eq(pa.paidNowProblems(st({ paidFrom: 'loan' }), 1250, null), ['BAD_PAY_SOURCE']);
  // R10: a supplier credit may pay at the counter — the server checks it in the purchase's own transaction.
  eq(pa.paidNowProblems(st({ paidFrom: 'credit' }), 1250, null), ['CREDIT_REQUIRED']);
  eq(pa.paidNowProblems(st({ paidFrom: 'credit', paidCredit: 'c1' }), 1250, null, 1000), ['OVER_CREDIT']);
  eq(pa.paidNowProblems(st({ paidFrom: 'credit', paidCredit: 'c1', paidNow: 'part', paidAmount: '500' }), 1250, null, 1000), []);
  const c = pa.paidNowPayments(st({ paidFrom: 'credit', paidCredit: 'c1', paidNow: 'part', paidAmount: '500' }), 1250, 'u1')[0];
  eq([c.source, c.credit_id, c.method, 'person_id' in c], ['credit', 'c1', 'other', false], 'not cash, nobody\'s money');
  eq(pa.paidNowProblems(st({ paidNow: 'none' }), 0, null), []);
});
test('Q10 refund routes match the server\'s check constraint exactly', () => {
  const sql = read('supabase/migrations/0102_purchase_payments.sql');
  const chk = sql.slice(sql.indexOf('constraint pur_refunds_route_chk'), sql.indexOf('constraint pur_refunds_void_chk'));
  // Each "(funded_by … and received_by …)" clause of the check: which money, which receivers.
  const clauses = [...chk.matchAll(/\(funded_by (?:= '([a-z_]+)'|in \(([^)]*)\)) and received_by (?:= '([a-z_]+)'|in \(([^)]*)\))/g)]
    .map(m => ({ funded: m[1] ? [m[1]] : m[2].match(/[a-z_]+/g), recv: m[3] ? [m[3]] : m[4].match(/[a-z_]+/g) }));
  ok(clauses.length >= 4, 'the route check was read: ' + clauses.length);
  const serverAllows = (f, r) => clauses.some(c => c.funded.includes(f) && c.recv.includes(r));
  for (const [funded, recvs] of Object.entries(pa.REFUND_ROUTES)) {
    for (const r of recvs) ok(serverAllows(funded, r), funded + ' → ' + r + ' allowed by the server');
  }
  for (const c of clauses) for (const f of c.funded) for (const r of c.recv) {
    ok((pa.REFUND_ROUTES[f] || []).includes(r), f + ' → ' + r + ' is allowed by the server but missing on screen');
  }
  eq(Object.keys(pa.REFUND_ROUTES).sort(), ['company', 'credit', 'own_money', 'petty_cash'], 'every funding source has routes');
  ok(/Back into Juan's petty cash/.test(pa.routeLabel('petty_cash', 'petty_cash', 'Juan')));
  ok(/Company owes/.test(pa.routeLabel('own_money', 'buyer', 'Juan')));
  ok(/no balance changes/.test(pa.routeLabel('own_money', 'company', 'Juan')));
});
test('the Overpaid screen starts from the server\'s split: credit back to credit, the rest refunded to the money that paid', () => {
  const r = pa.defaultResolution({ suggested: [
    { source: 'own_money', person_id: 'u1', person_name: 'Juan', amount: 300 },
    { source: 'petty_cash', person_id: 'u1', person_name: 'Juan', amount: 150 },
    { source: 'credit', person_id: null, amount: 50 }] }, '2026-10-22');
  eq(r.credit, 50, 'Q10 clarified: credit-funded excess goes back to the supplier\'s credit');
  eq(r.refunds.map(x => [x.fundedBy, x.receivedBy, x.amount]), [['own_money', 'buyer', 300], ['petty_cash', 'petty_cash', 150]]);
});
test('a resolution is refused before sending where the server would refuse it', () => {
  const paidBy = [{ source: 'petty_cash', person_id: 'u1', paid: 700, refunded: 0 }, { source: 'own_money', person_id: 'u1', paid: 300, refunded: 0 }];
  const part = (amount, fundedBy, receivedBy, personId) => ({ amount: String(amount), fundedBy, receivedBy, personId, receivedOn: '2026-10-22' });
  eq(pa.resolutionProblems([part(300, 'petty_cash', 'petty_cash', 'u1'), part(200, 'own_money', 'buyer', 'u1')], '', paidBy, 500, '2026-10-22'), [],
     'the agreed example');
  eq(pa.resolutionProblems([part(400, 'own_money', 'buyer', 'u1')], '', paidBy, 500, '2026-10-22').map(x => x.code), ['OVER_SOURCE']);
  eq(pa.resolutionProblems([part(300, 'petty_cash', 'petty_cash', 'u1')], '300', paidBy, 500, '2026-10-22').map(x => x.code), ['OVER_RESOLVED']);
  eq(pa.resolutionProblems([part(10, 'own_money', 'petty_cash', 'u1')], '', paidBy, 500, '2026-10-22').map(x => x.code), ['BAD_REFUND_ROUTE']);
  eq(pa.resolutionProblems([], '', paidBy, 500, '2026-10-22').map(x => x.code), ['NOTHING_TO_RESOLVE']);
  eq(pa.resolutionProblems([], '200', paidBy, 500, '2026-10-22'), [], 'a credit alone');
  eq(pa.resolutionProblems([part(10, 'petty_cash', 'company', 'u2')], '', paidBy, 500, '2026-10-22').map(x => x.code), ['OVER_SOURCE'],
     'another buyer\'s petty cash did not pay');
});
test('cash held never reads below ₱0: the rest is the shortfall', () => {
  eq(pa.cashFigures({ recorded: -200, pending_returns: 50, owes: 400, owes_to_review: 100 }),
     { held: 0, shortfall: 200, pending: 50, owes: 400, toReview: 100 });
  eq(pa.cashFigures({ recorded: 3500 }).held, 3500);
});
test('the daily report: rows add up day by day; the CSV quotes what needs quoting and never prints a negative balance', () => {
  const rep = { days: [
    { day: '2026-10-19', opening: 0, closing: 5000, received: [{ amount: 5000, method: 'cash', note: 'run 1' }], refunds_in: [], payments: [], returns: [] },
    { day: '2026-10-20', opening: 5000, closing: -300, received: [], refunds_in: [],
      payments: [{ amount: 5300, supplier: 'Wilcon, Malolos', items: ['Cement', 'Sand'], projects: ['Barlin'], warehouse: false }], returns: [] }] };
  const rows = pa.reportRows(rep);
  eq(rows.map(r => r.what), ['Opening', 'Petty cash received', 'Closing', 'Opening', 'Paid to supplier', 'Closing']);
  eq([rows[5].held, rows[5].shortfall], [0, 300]);
  const csv = pa.reportCsv(rep).split('\r\n');
  eq(csv[0], 'Day,Entry,Detail,In (PHP),Out (PHP),Cash held (PHP),Unreconciled shortfall (PHP)');
  ok(csv[5].includes('"Wilcon, Malolos — Cement, Sand · Barlin"'), 'a comma is quoted: ' + csv[5]);
  ok(!/,-\d/.test(pa.reportCsv(rep)), 'no negative amount');
  ok(csv[6].endsWith(',0.00,300.00'), 'closing ₱0 with the shortfall: ' + csv[6]);
});
test('R7 in the report: an entry voided later stays on its day, marked; the void is a row on its own day', () => {
  const rep = { days: [
    { day: '2026-10-20', opening: 1000, closing: 700, received: [], refunds_in: [], returns: [], reversals: [],
      payments: [{ amount: 300, supplier: 'Wilcon', items: ['Cement'], projects: ['Barlin'], voided_on: '2026-10-22' }] },
    { day: '2026-10-22', opening: 700, closing: 0, received: [], refunds_in: [], payments: [], returns: [],
      reversals: [{ what: 'Paid to supplier', entry_day: '2026-10-20', amount: 300, effect: 300, reason: 'double entry' },
                  { what: 'Petty cash given', entry_day: '2026-10-18', amount: 1000, effect: -1000, reason: 'given twice' }] }] };
  const rows = pa.reportRows(rep);
  ok(/\(voided on 2026-10-22\)/.test(rows[1].detail), 'marked on its day');
  eq(rows.slice(4, 6).map(r => [r.what, r.detail, r.amountIn, r.amountOut]),
     [['Void: Paid to supplier of 2026-10-20', 'double entry', 300, ''], ['Void: Petty cash given of 2026-10-18', 'given twice', '', 1000]]);
  for (const d of rep.days) {
    const day = rows.filter(r => r.day === d.day && r.held == null);
    const net = day.reduce((s, r) => s + (r.amountIn === '' ? 0 : r.amountIn) - (r.amountOut === '' ? 0 : r.amountOut), 0);
    // The voided payment still left that day: its row stays an outflow (voided later, not then).
    eq(d.opening + net, d.closing, d.day + ' adds up from its rows');
  }
});

console.log('\npayments: outside the money model, and every refusal has words');

test('every error code 0102 can raise has a sentence on screen', () => {
  const sql = read('supabase/migrations/0102_purchase_payments.sql');
  const codes = new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]));
  codes.delete('HISTORY_IMMUTABLE');   // a database rule, never reached from a screen
  for (const c of codes) ok(pa.ERRORS[c], c + ' has no sentence');
  ok(/That is more back than that money paid/.test(pa.errorMessage({ message: 'OVER_SOURCE' })), 'matched whole');
  ok(!/payment: at most five/.test(pa.errorMessage({ message: 'BAD_PAY_SOURCE' })), 'BAD_PAY never matches BAD_PAY_SOURCE');
});
test('the payment and cash screens write no table, read no expense row and name no Spent', () => {
  for (const f of ['js/purchasing-admin-pay.js', 'js/purchasing-admin-cash.js']) {
    const src = read(f);
    ok(!/\.from\(/.test(src), f + ' reads or writes a table directly');
    ok(!/\bexpenses\b|\bpayroll\b|_projSpent|buildProject|refreshOvAllData/.test(src.replace(/^\s*\/\/.*$/gm, '')), f + ' touches the money model');
  }
});
test('each write is sent once: an operation id per form, kept across retries of the same form', () => {
  for (const f of ['js/purchasing-admin-pay.js', 'js/purchasing-admin-cash.js']) {
    const src = read(f);
    const writes = [...src.matchAll(/RA\.rpc\('(pur_(?:pay|void_[a-z]+|accept_own_money|resolve_overpaid|cash_[a-z_]+|repay_buyer))'/g)];
    for (const m of writes) {
      if (/^pur_cash_(tracker|report|buyer)$/.test(m[1])) continue;
      const call = src.slice(m.index, src.indexOf(')', src.indexOf('}', m.index)) + 1);
      ok(/p_op: (opId|newOp\(\))/.test(call), f + ': ' + m[1] + ' has no operation id');
    }
    for (const m of src.matchAll(/const opId = (?:root\.DacsReceipts\.newId|newOp)\(\);/g)) {
      const modal = src.indexOf('RA.modal(', m.index), next = src.indexOf('function ', m.index);
      ok(modal !== -1 && (next === -1 || modal < next), f + ': the id is made once, when the form opens (a resent Save reuses it)');
      // Save (onSubmit … onDone) never makes a new id: a second press of the same form resends the first.
      const save = src.slice(src.indexOf('onSubmit', modal), src.indexOf('onDone', modal));
      ok(!/newId\(\)|newOp\(\)|const opId/.test(save), f + ': a new operation id made on Save');
    }
  }
});

console.log('\npayments: staff, wiring');

test('Project Control\'s payment badge: never for staff, owner list only, not part of any total', () => {
  const portal = read('js/portal-app.compiled.js');
  ok(/const payState = !_staff\(\) && typeof window\.expPurPayBadge === "function"/.test(portal), 'hidden from staff in the row');
  const em = read('js/expenses-module.js');
  ok(/window\.expPurPayBadge = id => \(id && window\.currentUserRole === 'owner' && _purPayBadges\[id\]\) \|\| null;/.test(em), 'owner only');
  ok(/if \(window\.currentUserRole === 'owner'\) \{\s*try \{\s*const \{ data, error \} = await window\.sbClient\.rpc\('pur_payment_badges'\)/.test(em),
    'loaded for owner accounts only');
  const tags = portal.slice(portal.indexOf('const purchaseTags = (m) =>'), portal.indexOf('const openReceiptThumb'));
  ok(!/amount|peso|₱/.test(tags.slice(tags.indexOf('const payState'))), 'the badge carries no amount');
});
test('the Cash tab, the Payments card and "Paid now" are wired in', () => {
  const list = read('js/purchasing-admin-list.js');
  ok(/t\('cash', 'Cash'\)/.test(list) && /ui\.tab === 'cash' && PA\.renderCash/.test(list), 'Cash tab');
  const pur = read('js/purchasing-admin-purchases.js');
  ok(/<div data-payments><\/div>/.test(pur) && /PA\.renderPayments\(host\.querySelector\('\[data-payments\]'\), doc\)/.test(pur), 'Payments card');
  ok(/<th>Payment<\/th>/.test(pur) && /PA\.payPill\(p\.pay\)/.test(pur), 'Purchases list column');
  const rec = read('js/purchasing-admin-record.js');
  ok(/\(st\.editId \? '' : paidNowHtml\(me\)\)/.test(rec), '"Paid now" on new purchases only');
  const save = rec.slice(rec.indexOf('async function save('), rec.indexOf('function refreshDocs('));
  ok(/if \(!st\.editId\) \{[\s\S]*?PA\.paidNowPayments\(st, body\.receipt_total, cashHolder\(me\)\)[\s\S]*?rpc\('pur_record'/.test(save), 'sent with pur_record');
  ok(!/payments/.test(save.slice(save.indexOf("rpc('pur_correct'"))), 'never with a correction or replacement');
  // R10: supplier credit at the counter — offered only when the supplier has some left, checked against what is left.
  ok(/RA\.rpc\('pur_credits', \{ p_supplier: st\.supplierId \}\)/.test(rec), 'the supplier\'s credits are read');
  ok(/openCredits = \(cr \|\| \[\]\)\.filter\(c => !c\.voided_at && Number\(c\.left\) > 0\);/.test(rec), 'only credits with something left');
  ok(/if \(openCredits\.length\) from\.credit = PA\.PAY_SOURCE\.credit;/.test(rec), 'credit offered in "Paid from"');
  ok(/PA\.paidNowProblems\(st, [^;]*credit \? credit\.left : null\)/.test(rec), 'checked against the credit left');
  const html = read('admin.html');
  for (const f of ['purchasing-admin-pay', 'purchasing-admin-cash']) {
    const i = html.indexOf('js/' + f + '.js?v=');
    ok(i > html.indexOf('js/purchasing-admin-purchases.js'), f + ' loads after the purchases screen');
  }
  for (const f of ['js/purchasing-admin-core.js', 'js/purchasing-admin-list.js', 'js/purchasing-admin-record.js', 'js/purchasing-admin-purchases.js',
                   'js/purchasing-admin-pay.js', 'js/purchasing-admin-cash.js', 'css/purchasing-admin.css']) {
    const m = html.match(new RegExp(f.replace(/[.\/]/g, '\\$&') + '\\?v=(\\d{8}[a-z])'));
    ok(m && m[1] >= '20261022b', f + ' cache-buster bumped');
  }
  const em = html.match(/js\/expenses-module\.js\?v=(\d{8}[a-z])/);
  ok(em && em[1] >= '20261022b', 'expenses-module.js cache-buster bumped');
});
test('the main owner\'s screens show cash held never below zero and returns as waiting until confirmed', () => {
  const cash = read('js/purchasing-admin-cash.js');
  ok(/PA\.cashFigures\(b\)/.test(cash) && /PA\.cashFigures\(d\)/.test(cash), 'every balance through cashFigures');
  ok(!/\.recorded\)?\s*\+?\s*'<\/strong>/.test(cash), 'no raw recorded balance printed');
  ok(/Confirm received/.test(cash) && /p_confirm: true/.test(cash), 'confirm');
  ok(/Report a return/.test(cash) && /pur_cash_report_return/.test(cash), 'a buyer reports');
  ok(/data-reject-own=/.test(cash) && /'pur_reject_own_money', \{ p_payment: b\.dataset\.rejectOwn \}, 'p_reason'/.test(cash), 'R9: reject with a reason');
});
test('R13: a return photo goes to the private pettyCash folder; payment proofs stay with the purchase', () => {
  ok(/petty_cash: 'pettyCash'/.test(read('js/receipt-storage.js')), 'the upload helper knows the folder');
  const cash = read('js/purchasing-admin-cash.js');
  ok(/uploadReceipt\('petty_cash'/.test(cash) && !/uploadReceipt\('purchase'/.test(cash), 'the return photo is filed under pettyCash');
  ok(/uploadReceipt\('purchase'/.test(read('js/purchasing-admin-pay.js')), 'a payment proof is a purchase document');
});
test('R4 and R9 on the Payments card: a carried-over payment and a rejected claim say so', () => {
  const pay = read('js/purchasing-admin-pay.js');
  ok(/p\.moved \? ' · carried over from the earlier version of this purchase'/.test(pay), 'carried over');
  ok(/p\.rejected_at \? ' \(rejected by the owner: '/.test(pay), 'rejected');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Modify:** `tests/storage-access.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/storage-access.test.js b/tests/storage-access.test.js
index d9e07de..05b57ca 100644
--- a/tests/storage-access.test.js
+++ b/tests/storage-access.test.js
@@ -226,7 +226,7 @@ function uploadFolders() {
     /storage\.ref\(\s*[`'"]([A-Za-z][\w-]*)\//g,          // storage.ref('folder/…')
     /const path\s*=\s*[`'"]([A-Za-z][\w-]*)\//g,           // const path = `folder/…`
     /\b(?:store|contracts):\s*'([A-Za-z][\w-]*)'/g,        // expenses-module agreement config
-    /\b(?:expense|payroll|purchase):\s*'([A-Za-z][\w-]*)'/g, // receipt-storage.js FOLDER map
+    /\b(?:expense|payroll|purchase|petty_cash):\s*'([A-Za-z][\w-]*)'/g, // receipt-storage.js FOLDER map
   ];
   for (const f of files) {
     const src = fs.readFileSync(f, 'utf8');
@@ -246,7 +246,7 @@ test('the scan still finds the known upload sites (guards against a silent regex
   const found = uploadFolders();
   for (const f of ['expenseInbox', 'weeklyBillReceipts', 'procurementReceipts', 'signatures', 'signed-terms',
                    'quotations', 'reimbursementReceipts', 'workerAgreementGlobal', 'workerAgreements',
-                   'expenseReceipts', 'payrollReceipts', 'purchases']) {
+                   'expenseReceipts', 'payrollReceipts', 'purchases', 'pettyCash']) {
     ok(found.has(f), 'scan no longer sees uploads to ' + f);
   }
 });
```

<!-- Code -->

**Modify:** `admin.html` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/admin.html b/admin.html
index 9715339..c9380dc 100644
--- a/admin.html
+++ b/admin.html
@@ -22,7 +22,7 @@
     <link rel="stylesheet" href="css/reimbursement-module.css">
     <link rel="stylesheet" href="css/attendance-admin.css">
     <link rel="stylesheet" href="css/requests-admin.css?v=20261012a">
-    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261020a">
+    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261022b">
     <link rel="stylesheet" href="css/workplan-admin.css?v=20261014a">
     <!-- Warranty Retention Register + Fund Styles -->
     <link rel="stylesheet" href="css/warranty-fund.css?v=20260803f">
@@ -5413,7 +5413,7 @@
 <script src="js/print-utils.js"></script>
 <script src="js/receipt-storage.js?v=20261016a"></script>
 <script src="js/expense-split-rows.js?v=20261015a"></script>
-<script src="js/expenses-module.js?v=20261022a"></script>
+<script src="js/expenses-module.js?v=20261022b"></script>
 <script src="js/overhead-module.js"></script>
 <script src="js/reimbursement-module.js"></script>
 <script src="js/construction-module.js"></script>
@@ -5427,10 +5427,12 @@
 <script src="js/requests-admin-setup.js?v=20261012a"></script>
 <script src="js/requests-admin-history.js?v=20261012a"></script>
 <script src="js/requests-admin-gallery.js?v=20261012a"></script>
-<script src="js/purchasing-admin-core.js?v=20261022a"></script>
-<script src="js/purchasing-admin-list.js?v=20261020a"></script>
-<script src="js/purchasing-admin-record.js?v=20261022a"></script>
-<script src="js/purchasing-admin-purchases.js?v=20261022a"></script>
+<script src="js/purchasing-admin-core.js?v=20261022b"></script>
+<script src="js/purchasing-admin-list.js?v=20261022b"></script>
+<script src="js/purchasing-admin-record.js?v=20261022b"></script>
+<script src="js/purchasing-admin-purchases.js?v=20261022b"></script>
+<script src="js/purchasing-admin-pay.js?v=20261022b"></script>
+<script src="js/purchasing-admin-cash.js?v=20261022b"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261014a"></script>
 <script src="js/workplan-admin-board.js?v=20261014a"></script>
```

**Modify:** `css/purchasing-admin.css` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/css/purchasing-admin.css b/css/purchasing-admin.css
index 2a5e92e..705aa76 100644
--- a/css/purchasing-admin.css
+++ b/css/purchasing-admin.css
@@ -113,4 +113,19 @@
     .pur-portions { padding-left: 0; }
     .pur-portion-acts { margin-left: 0; }
     .pur-rec-row .att-label.pur-w2 { grid-column: auto; }
-}
\ No newline at end of file
+}
+
+/* ── Payments and petty cash (0102, 2A-4a) — never part of Spent ── */
+.pur-h4 { margin: 14px 0 6px; font-size: 13.5px; font-weight: 700; }
+.pur-pay-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
+.pur-pay-figs { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 8px 0 12px; font-size: 13px; }
+.pur-pay-figs strong { margin-left: 4px; }
+.pur-pay-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
+.pur-history li.is-void { color: var(--att-ink-3, #888); text-decoration: line-through; text-decoration-thickness: 1px; }
+.pur-voided { margin-top: 10px; font-size: 13px; }
+.pur-resolve-part { border: 1px solid var(--att-line, #e3e3df); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
+.pur-cash-cards { gap: 12px; }
+.pur-cash-cards > span { display: flex; flex-direction: column; min-width: 160px; padding: 10px 14px; border: 1px solid var(--att-line, #e3e3df);
+    border-radius: 12px; background: var(--att-card, #fff); }
+.pur-cash-cards > span strong { margin: 2px 0 0; font-size: 18px; }
+.pur-cash-cards small { color: var(--att-ink-3, #888); font-size: 12px; }
```

**Modify:** `js/expenses-module.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/expenses-module.js b/js/expenses-module.js
index bd29a99..879114e 100644
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -2075,6 +2075,8 @@ function renderExpensesTable() {
             ? '<span title="Recorded as a purchase — edit or void it to change it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10.5px;font-weight:700;border:1px solid #c7d2fe;">From purchase</span>'
               + (_purReviewLines.has(e.purchaseLineId) ? '<span title="No billing period for its month — charged to Cover until the office reviews it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:10.5px;font-weight:700;border:1px solid #fed7aa;">Office review</span>' : '')
               + (window.expPurPendingChange(e.purchaseLineId || e.purchaseChargeId) ? '<span title="You sent a change of this purchase to the owner — open the row to withdraw it" style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fefce8;color:#a16207;font-size:10.5px;font-weight:700;border:1px solid #fde68a;">Waiting for the owner</span>' : '')
+              // 2A-4a (0102): how it was paid — owner accounts only; never part of Spent.
+              + ((st => st ? '<span title="How this purchase was paid (Requests → Purchasing). Payments never change Spent." style="display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;background:' + (st === 'paid' ? '#f0fdf4;color:#15803d;border:1px solid #bbf7d0' : st === 'partial' ? '#fefce8;color:#a16207;border:1px solid #fde68a' : '#fef2f2;color:#b91c1c;border:1px solid #fecaca') + ';font-size:10.5px;font-weight:700;">' + ({ unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid', overpaid: 'Overpaid' })[st] + '</span>' : '')(window.expPurPayBadge && window.expPurPayBadge(e.purchaseLineId || e.purchaseChargeId)))
             : '';
         return `
         <tr class="exp-group-row">
@@ -2947,6 +2949,7 @@ function _expNoPeriodSpent(folderId) {
 // (pur_review_lines, pur_my_pending_changes — no amounts).
 let _purReviewLines = new Set();
 let _purPending = new Map();   // purchase line / charge id → my pending change request
+let _purPayBadges = {};        // 0102: purchase line / charge id → unpaid / partial / paid / overpaid (owner only)
 async function _purLoadReviewFlags() {
     try {
         // Ids only, through the server (0097: purchase tables are buyers-only).
@@ -2961,10 +2964,20 @@ async function _purLoadReviewFlags() {
         (data || []).forEach(r => (r.line_ids || []).concat(r.charge_ids || []).forEach(id => byId.set(id, r)));
         _purPending = byId;
     } catch (err) { console.warn('purchase changes waiting for the owner:', err); }
+    // 2A-4a (0102): Unpaid / Partially paid / Paid — owner accounts only (the
+    // server refuses everyone else). How a purchase was paid never changes Spent.
+    if (window.currentUserRole === 'owner') {
+        try {
+            const { data, error } = await window.sbClient.rpc('pur_payment_badges');
+            if (error) throw error;
+            _purPayBadges = data || {};
+        } catch (err) { _purPayBadges = {}; console.warn('purchase payment badges:', err); }
+    }
     window.dispatchEvent(new Event('dacs:pur-review-flags'));
 }
 window.expPurNeedsReview = id => !!id && _purReviewLines.has(id);
 window.expPurPendingChange = id => (id && _purPending.get(id)) || null;
+window.expPurPayBadge = id => (id && window.currentUserRole === 'owner' && _purPayBadges[id]) || null;
 // The Purchasing tab sends changes to the owner too; it re-reads the flags.
 window.expPurReloadFlags = _purLoadReviewFlags;
 
```

**Modify:** `js/portal-app.compiled.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/portal-app.compiled.js b/js/portal-app.compiled.js
index 27cd322..4e5a1c1 100644
--- a/js/portal-app.compiled.js
+++ b/js/portal-app.compiled.js
@@ -3301,7 +3301,11 @@ function MaterialDrill({ project, onBack, materialTx, childMonths, activeFolder,
     const review = typeof window.expPurNeedsReview === "function" && (m._parts || [m]).some((p) => window.expPurNeedsReview(p.purchaseLineId));
     // 2A-3a (Q16): a change this account sent to the owner, not yet decided.
     const waiting = typeof window.expPurPendingChange === "function" && (m._parts || [m]).some((p) => window.expPurPendingChange(p.purchaseLineId || p.purchaseChargeId));
-    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { title: "Recorded as a purchase — edit or void it to change it", style: tagStyle("#eef2ff", "#3730a3", "#c7d2fe") }, "From purchase"), review && /* @__PURE__ */ React.createElement("span", { title: "No billing period for its month — charged to Cover until the office reviews it", style: tagStyle("#fff7ed", "#c2410c", "#fed7aa") }, "Office review"), waiting && /* @__PURE__ */ React.createElement("span", { title: "You sent a change of this purchase to the owner — open the row to withdraw it", style: tagStyle("#fefce8", "#a16207", "#fde68a") }, "Waiting for the owner"));
+    // 2A-4a (0102): how the purchase was paid — owner/admin only, never staff,
+    // and never part of Spent (the badge reads a separate owner-only list).
+    const payState = !_staff() && typeof window.expPurPayBadge === "function" && window.expPurPayBadge((m._parts || [m]).map((p) => p.purchaseLineId || p.purchaseChargeId).find(Boolean));
+    const payTag = payState && { unpaid: ["Unpaid", "#fef2f2", "#b91c1c", "#fecaca"], partial: ["Partially paid", "#fefce8", "#a16207", "#fde68a"], paid: ["Paid", "#f0fdf4", "#15803d", "#bbf7d0"], overpaid: ["Overpaid", "#fef2f2", "#b91c1c", "#fecaca"] }[payState];
+    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { title: "Recorded as a purchase — edit or void it to change it", style: tagStyle("#eef2ff", "#3730a3", "#c7d2fe") }, "From purchase"), review && /* @__PURE__ */ React.createElement("span", { title: "No billing period for its month — charged to Cover until the office reviews it", style: tagStyle("#fff7ed", "#c2410c", "#fed7aa") }, "Office review"), waiting && /* @__PURE__ */ React.createElement("span", { title: "You sent a change of this purchase to the owner — open the row to withdraw it", style: tagStyle("#fefce8", "#a16207", "#fde68a") }, "Waiting for the owner"), payTag && /* @__PURE__ */ React.createElement("span", { title: "How this purchase was paid (Requests → Purchasing). Payments never change Spent.", style: tagStyle(payTag[1], payTag[2], payTag[3]) }, payTag[0]));
   };
   const openReceiptThumb = (m) => {
     if (_staff()) return;
```

**Create:** `js/purchasing-admin-cash.js`

```js
// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Cash (0102, WorkMate 2A-4a).
//
// OUTSIDE THE MONEY MODEL (CLAUDE.md): petty cash, a buyer's own money,
// refunds and supplier credit track who holds or is owed company money.
// Nothing here creates an expense or changes Spent, Earned or Profit.
//
//   The main owner (pur_cash_tracker answers):  every buyer's cash held,
//     returns to confirm, "I did not receive this" flags, own-money payments
//     to accept, Overpaid purchases, supplier credits, the daily report
//     (print and CSV), giving petty cash, cash counts, repayments and the
//     "May use own money" switch.
//   A buyer (the tracker refuses them):  My cash — their own balance,
//     returns, what the company owes them, "I did not receive this" and
//     Report a return.
// Cash held never reads below ₱0: the rest is an "Unreconciled shortfall"
// (Q16). A return lowers the balance when the owner confirms it (Q18).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;
    const ui = { report: null };
    const peso = (v) => esc(PA.peso(v));
    const newOp = () => root.DacsReceipts.newId();

    async function renderCash(body, me) {
        body.innerHTML = '<div class="att-empty">Loading…</div>';
        let t;
        try {
            t = await RA.rpc('pur_cash_tracker');
        } catch (e) {
            if (/OWNER_ONLY|NOT_ALLOWED/.test(String((e && (e.message || e.code)) || ''))) return renderMyCash(body, me);
            RA.fail(body, e);
            return;
        }
        return renderTracker(body, me, t);
    }
    PA.renderCash = renderCash;

    // ── The main owner ──────────────────────────────────────────────

    function daysAgo(day, today) {
        if (!day) return '';
        const n = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000);
        return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
    }

    async function renderTracker(body, me, t) {
        let overpaid = [], credits = [];
        try {
            [overpaid, credits] = await Promise.all([RA.rpc('pur_overpaid'), RA.rpc('pur_credits', { p_supplier: null })]);
        } catch (e) { RA.fail(body, e); return; }
        const buyers = t.buyers || [];
        const reload = () => renderCash(body, me);
        const openCredits = (credits || []).filter(c => !c.voided_at);
        body.innerHTML =
            '<div class="att-info"><i data-lucide="wallet"></i><div>Petty cash, a buyer\'s own money, refunds and supplier credit say who holds or is owed company money. ' +
              '<strong>None of it changes Spent or Profit</strong> — a purchase counted once, when it was recorded.</div></div>' +
            '<div class="att-toolbar">' +
              '<button type="button" class="att-btn att-btn--primary" data-give>Give petty cash…</button>' +
              '<button type="button" class="att-btn" data-report>Daily report…</button>' +
            '</div>' +
            '<div data-report-host></div>' +
            '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
              '<thead><tr><th>Buyer</th><th>Cash held</th><th>Returns waiting</th><th>Company owes</th><th>May use own money</th><th>Last given</th><th>Last count</th><th></th></tr></thead><tbody>' +
              (buyers.length ? buyers.map(b => {
                  const f = PA.cashFigures(b);
                  const lc = b.last_count;
                  const diff = lc ? PA.round2(Number(lc.counted) - Number(lc.recorded)) : 0;
                  return '<tr>' +
                    '<td><strong>' + esc(b.name) + '</strong>' + (b.can_buy ? '' : '<div class="req-muted">Buyer switch off</div>') + '</td>' +
                    '<td><strong>' + peso(f.held) + '</strong>' + (f.shortfall > 0 ? '<div>' + PA.pill('Unreconciled shortfall ' + PA.peso(f.shortfall), 'abandoned') + '</div>' : '') +
                      (Number(b.open_disputes) > 0 ? '<div>' + PA.pill('Not-received flag', 'working') + '</div>' : '') + '</td>' +
                    '<td>' + (f.pending > 0 ? peso(f.pending) : '—') + '</td>' +
                    '<td>' + (f.owes > 0 ? peso(f.owes) : '—') + (f.toReview > 0 ? '<div>' + PA.pill(PA.peso(f.toReview) + ' to review', 'working') + '</div>' : '') + '</td>' +
                    '<td><label class="att-switch"><input type="checkbox" data-own="' + esc(b.buyer_id) + '"' + (b.own_money ? ' checked' : '') + '> ' +
                      (b.own_money ? 'Allowed' : 'Off') + '</label></td>' +
                    '<td>' + (b.last_given_on ? esc(b.last_given_on) + '<div class="req-muted">' + esc(daysAgo(b.last_given_on, t.today)) + '</div>' : '—') + '</td>' +
                    '<td>' + (lc ? esc(lc.counted_on) + ': ' + peso(lc.counted) + '<div class="req-muted">' +
                      (diff === 0 ? 'matched' : diff < 0 ? 'short ' + esc(PA.peso(-diff)) : 'over ' + esc(PA.peso(diff))) + '</div>' : '—') + '</td>' +
                    '<td><button type="button" class="att-btn att-btn--sm" data-buyer="' + esc(b.buyer_id) + '">Details…</button></td>' +
                  '</tr>';
              }).join('') : '<tr><td colspan="8" class="att-empty">No staff buyer yet. Turn a staff member\'s Buyer switch on in Users.</td></tr>') +
            '</tbody></table></div></div></div>' +
            '<div data-buyer-host></div>' +
            section('Returns waiting for you', 'The buyer says they handed this back. It lowers their cash held only when you confirm it, on the day you confirm.',
              (t.pending_returns || []).map(r => '<li><strong>' + esc(r.name) + '</strong> — ' + peso(r.amount) + ', handed over ' + esc(r.handed_on) +
                (r.handed_to ? ' to ' + esc(r.handed_to) : '') + (r.note ? ' — ' + esc(r.note) : '') +
                (r.photo_url ? ' <a class="att-link" href="#" data-photo="' + esc(r.photo_url) + '">photo</a>' : '') +
                ' <button type="button" class="att-btn att-btn--sm att-btn--primary" data-confirm="' + esc(r.id) + '">Confirm received</button>' +
                ' <button type="button" class="att-btn att-btn--sm" data-reject="' + esc(r.id) + '">Reject…</button></li>')) +
            section('"I did not receive this"', 'A buyer says petty cash you recorded never reached them. Their balance is unchanged until you settle it.',
              (t.disputes || []).map(i => '<li><strong>' + esc(i.name) + '</strong> — ' + peso(i.amount) + ' given ' + esc(i.issued_on) + ': "' + esc(i.dispute_note) + '"' +
                ' <button type="button" class="att-btn att-btn--sm" data-clear="' + esc(i.id) + '">It was handed over…</button>' +
                ' <button type="button" class="att-btn att-btn--sm att-btn--warn" data-void-issue="' + esc(i.id) + '">Void the entry…</button></li>')) +
            section('Own money to review', 'Paid with a buyer\'s own money while "May use own money" was off. Kept as a real payment. ' +
                'Accept it and the company owes it; reject it, with a reason, and it is never owed (R9).',
              (t.to_review || []).map(p => '<li><strong>' + esc(p.person_name) + '</strong> — ' + peso(p.amount) + ' on ' + esc(p.paid_on) +
                (p.note ? ' — ' + esc(p.note) : '') + ' <a class="att-link" href="#" data-open="' + esc(p.purchase_id) + '">purchase</a>' +
                ' <button type="button" class="att-btn att-btn--sm att-btn--primary" data-accept="' + esc(p.id) + '">Accept</button>' +
                ' <button type="button" class="att-btn att-btn--sm" data-reject-own="' + esc(p.id) + '">Reject…</button></li>')) +
            section('Overpaid', 'More was paid than the purchase now costs (or it was voided after it was paid). Refund it to the money that paid it, or keep it as supplier credit.',
              (overpaid || []).map(o => '<li><strong>' + esc(o.supplier || 'No supplier') + '</strong> · ' + esc(RA.formatDay(o.purchase_date)) + ' · ' +
                (PA.payPill ? PA.payPill(o.pay) : '') +
                (Number(o.pay && o.pay.over_resolved) > 0 ? ' ' + PA.pill('Refunded ' + PA.peso(o.pay.over_resolved) + ' more than is over — check', 'abandoned') : '') +
                ' <a class="att-link" href="#" data-open="' + esc(o.id) + '">open</a>' +
                (Number(o.pay && o.pay.unresolved) > 0 ? ' <button type="button" class="att-btn att-btn--sm att-btn--primary" data-resolve="' + esc(o.id) + '">Resolve…</button>' : '') +
                '</li>')) +
            section('Supplier credit', 'A balance with one supplier, used in parts when paying that supplier, until it is gone. Not cash.',
              openCredits.map(c => '<li><strong>' + esc(c.supplier || 'Supplier') + '</strong> — ' + peso(c.left) + ' left of ' + peso(c.amount) +
                (c.note ? ' — ' + esc(c.note) : '') + ' <a class="att-link" href="#" data-open="' + esc(c.purchase_id) + '">from this purchase</a>' +
                (Number(c.left) === Number(c.amount) ? ' <button type="button" class="att-btn att-btn--sm" data-void-credit="' + esc(c.id) + '">Void…</button>' : '') + '</li>'));

        body.querySelector('[data-give]').addEventListener('click', () => giveModal(buyers, reload));
        body.querySelector('[data-report]').addEventListener('click', () => reportPanel(body.querySelector('[data-report-host]'), buyers, t.today));
        if (ui.report) reportPanel(body.querySelector('[data-report-host]'), buyers, t.today, ui.report);
        body.querySelectorAll('[data-own]').forEach(el => el.addEventListener('change', async () => {
            try { await RA.rpc('pur_set_own_money', { p_buyer: el.dataset.own, p_on: el.checked }); } catch (e) { PA.notice(e); }
            reload();
        }));
        body.querySelectorAll('[data-buyer]').forEach(b => b.addEventListener('click', () =>
            buyerPanel(body.querySelector('[data-buyer-host]'), buyers.find(x => x.buyer_id === b.dataset.buyer), t.today, reload)));
        body.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try { await RA.rpc('pur_cash_decide_return', { p_op: newOp(), p_return: b.dataset.confirm, p_confirm: true, p_note: null }); } catch (e) { PA.notice(e); }
            reload();
        }));
        body.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => noteModal('Reject this return?',
            'The buyer\'s cash held stays as it is. Say why — they see it.', 'Reject', 'pur_cash_decide_return',
            { p_return: b.dataset.reject, p_confirm: false }, 'p_note', reload)));
        body.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => noteModal('The cash was handed over',
            'The flag is cleared and the entry stays. If it was NOT handed over, void the entry instead.', 'Clear the flag', 'pur_cash_clear_dispute',
            { p_issue: b.dataset.clear }, 'p_note', reload)));
        body.querySelectorAll('[data-void-issue]').forEach(b => b.addEventListener('click', () =>
            PA.voidModal('Void this petty cash entry?', 'It leaves the buyer\'s balance and stays in the history, marked void.', 'pur_cash_void_issue', { p_issue: b.dataset.voidIssue }, reload)));
        body.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try { await RA.rpc('pur_accept_own_money', { p_op: newOp(), p_payment: b.dataset.accept }); } catch (e) { PA.notice(e); }
            reload();
        }));
        body.querySelectorAll('[data-reject-own]').forEach(b => b.addEventListener('click', () => noteModal('Reject this own-money claim?',
            'The payment stays (the supplier was paid), but the company will not owe it. The buyer sees your reason.', 'Reject',
            'pur_reject_own_money', { p_payment: b.dataset.rejectOwn }, 'p_reason', reload)));
        body.querySelectorAll('[data-resolve]').forEach(b => b.addEventListener('click', () =>
            PA.openResolve((overpaid || []).find(o => o.id === b.dataset.resolve), reload)));
        body.querySelectorAll('[data-void-credit]').forEach(b => b.addEventListener('click', () =>
            PA.voidModal('Void this supplier credit?', 'Only a credit nothing has used yet can be voided.', 'pur_void_credit', { p_credit: b.dataset.voidCredit }, reload)));
        body.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); PA.openPurchase(a.dataset.open); }));
        body.querySelectorAll('[data-photo]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); root.open(a.dataset.photo, '_blank'); }));
        RA.icons();
    }

    function section(title, help, items) {
        return '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">' + esc(title) + '</h3><p class="req-muted">' + esc(help) + '</p>' +
            (items.length ? '<ul class="pur-history">' + items.join('') + '</ul>' : '<p class="req-muted">Nothing here.</p>') + '</div></div>';
    }

    // A decision that needs a note (reject, clear a flag), sent once.
    function noteModal(title, sub, label, fn, args, noteArg, onDone) {
        const opId = newOp();
        RA.modal({
            title, sub, submitLabel: label,
            body: '<label class="att-label">Note<input class="att-input" name="note" maxlength="300" required></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                if (!form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc(fn, Object.assign({ p_op: opId, [noteArg]: form.note.value.trim() }, args));
            },
            onDone,
        });
    }

    const buyerOptions = (buyers, sel) => buyers.filter(b => b.can_buy || b.buyer_id === sel)
        .map(b => '<option value="' + esc(b.buyer_id) + '"' + (b.buyer_id === sel ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('');

    function giveModal(buyers, onDone) {
        const opId = newOp();
        const today = PA.localDay();
        RA.modal({
            title: 'Give petty cash',
            sub: 'Company money you hand a buyer for purchases. It counts on their balance at once; they return what is left at the end of the buying run.',
            submitLabel: 'Record',
            body: '<label class="att-label">Buyer<select class="att-input" name="buyer" required>' + buyerOptions(buyers) + '</select></label>' +
                  '<div class="pur-rec-row">' +
                    '<label class="att-label">Amount (₱)<input class="att-input" name="amount" inputmode="decimal" required></label>' +
                    '<label class="att-label">Given on<input class="att-input" type="date" name="day" max="' + esc(today) + '" value="' + esc(today) + '" required></label>' +
                    '<label class="att-label">How<select class="att-input" name="method">' +
                      ['cash', 'gcash', 'bank_transfer', 'other'].map(m => '<option value="' + m + '">' + esc(PA.PAY_METHOD[m]) + '</option>').join('') + '</select></label>' +
                  '</div>' +
                  '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                if (!(PA.parseMoney(form.amount.value) > 0)) throw new Error('BAD_AMOUNT');
                await RA.rpc('pur_cash_give', { p_op: opId, p_buyer: form.buyer.value, p_amount: String(PA.round2(PA.parseMoney(form.amount.value))),
                                                p_on: form.day.value, p_method: form.method.value, p_note: form.note.value });
            },
            onDone,
        });
    }

    // One buyer's entries (90 days), with counts and repayments — voids live here.
    async function buyerPanel(host, b, today, reload) {
        host.innerHTML = '<div class="att-card"><div class="att-card-body"><div class="att-empty">Loading…</div></div></div>';
        let d;
        try { d = await RA.rpc('pur_cash_buyer', { p_buyer: b.buyer_id }); } catch (e) { RA.fail(host, e); return; }
        const f = PA.cashFigures(d);
        const voidBtn = (attr, id) => ' <button type="button" class="att-btn att-btn--sm" ' + attr + '="' + esc(id) + '">Void…</button>';
        host.innerHTML =
            '<div class="att-card"><div class="att-card-body">' +
              '<div class="pur-pay-head"><h3 class="pur-h3">' + esc(d.name) + '</h3><button type="button" class="att-btn att-btn--sm" data-close-buyer>Close</button></div>' +
              '<div class="pur-pay-figs"><span>Cash held <strong>' + peso(f.held) + '</strong></span>' +
                (f.shortfall > 0 ? '<span>Unreconciled shortfall <strong>' + peso(f.shortfall) + '</strong></span>' : '') +
                '<span>Company owes <strong>' + peso(f.owes) + '</strong></span>' +
                (f.toReview > 0 ? '<span>To review <strong>' + peso(f.toReview) + '</strong></span>' : '') + '</div>' +
              '<div class="pur-pay-actions">' +
                '<button type="button" class="att-btn" data-count>Count cash…</button>' +
                (f.owes > 0 ? '<button type="button" class="att-btn" data-repay>Repay own money…</button>' : '') +
              '</div>' +
              '<h4 class="pur-h4">Petty cash given (90 days)</h4><ul class="pur-history">' +
                ((d.issues || []).map(i => '<li' + (i.voided_at ? ' class="is-void"' : '') + '>' + esc(i.issued_on) + ' — ' + peso(i.amount) + ' ' +
                  esc(PA.PAY_METHOD[i.method] || i.method) + (i.note ? ' — ' + esc(i.note) : '') +
                  (i.disputed_at && !i.dispute_cleared_at ? ' ' + PA.pill('Not-received flag', 'working') : '') +
                  (i.voided_at ? ' — voided: ' + esc(i.void_reason) : voidBtn('data-void-issue', i.id)) + '</li>').join('') || '<li class="req-muted">None.</li>') + '</ul>' +
              '<h4 class="pur-h4">Returns (90 days)</h4><ul class="pur-history">' +
                ((d.returns || []).map(r => '<li' + (r.voided_at ? ' class="is-void"' : '') + '>' + esc(r.handed_on) + ' — ' + peso(r.amount) + ' — ' +
                  esc({ reported: 'waiting for you', withdrawn: 'withdrawn by the buyer', confirmed: 'confirmed', rejected: 'rejected' }[r.status] || r.status) +
                  (r.decision_note ? ': ' + esc(r.decision_note) : '') + (r.voided_at ? ' — voided' : r.status === 'confirmed' ? voidBtn('data-void-return', r.id) : '') + '</li>').join('') ||
                  '<li class="req-muted">None.</li>') + '</ul>' +
              '<h4 class="pur-h4">Cash counts</h4><ul class="pur-history">' +
                ((d.counts || []).map(k => '<li' + (k.voided_at ? ' class="is-void"' : '') + '>' + esc(k.counted_on) + ' — counted ' + peso(k.counted) +
                  ', recorded ' + peso(Math.max(0, Number(k.recorded))) + (k.note ? ' — ' + esc(k.note) : '') +
                  (k.voided_at ? ' — voided' : voidBtn('data-void-count', k.id)) + '</li>').join('') || '<li class="req-muted">None.</li>') + '</ul>' +
              '<h4 class="pur-h4">Repayments of own money</h4><ul class="pur-history">' +
                ((d.repayments || []).map(x => '<li' + (x.voided_at ? ' class="is-void"' : '') + '>' + esc(x.paid_on) + ' — ' + peso(x.amount) + ' ' +
                  esc(PA.PAY_METHOD[x.method] || x.method) + (x.voided_at ? ' — voided' : voidBtn('data-void-repay', x.id)) + '</li>').join('') ||
                  '<li class="req-muted">None.</li>') + '</ul>' +
            '</div></div>';
        const again = () => { reload(); };
        host.querySelector('[data-close-buyer]').addEventListener('click', () => { host.innerHTML = ''; });
        host.querySelector('[data-count]').addEventListener('click', () => countModal(b, again));
        const rp = host.querySelector('[data-repay]');
        if (rp) rp.addEventListener('click', () => repayModal(b, f.owes, again));
        host.querySelectorAll('[data-void-issue]').forEach(x => x.addEventListener('click', () =>
            PA.voidModal('Void this petty cash entry?', 'It leaves the buyer\'s balance and stays in the history, marked void.', 'pur_cash_void_issue', { p_issue: x.dataset.voidIssue }, again)));
        host.querySelectorAll('[data-void-return]').forEach(x => x.addEventListener('click', () =>
            PA.voidModal('Void this confirmed return?', 'The amount goes back on the buyer\'s balance.', 'pur_cash_void_return', { p_return: x.dataset.voidReturn }, again)));
        host.querySelectorAll('[data-void-count]').forEach(x => x.addEventListener('click', () =>
            PA.voidModal('Void this cash count?', 'A count is a record only; voiding it changes no balance.', 'pur_cash_void_count', { p_count: x.dataset.voidCount }, again)));
        host.querySelectorAll('[data-void-repay]').forEach(x => x.addEventListener('click', () =>
            PA.voidModal('Void this repayment?', 'The company owes the buyer that amount again.', 'pur_void_repayment', { p_repayment: x.dataset.voidRepay }, again)));
        host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function countModal(b, onDone) {
        const opId = newOp();
        const today = PA.localDay();
        RA.modal({
            title: 'Count cash — ' + b.name,
            sub: 'What you counted, shown against the balance recorded that day. A record only: it changes no balance.',
            submitLabel: 'Record count',
            body: '<div class="pur-rec-row"><label class="att-label">Counted (₱)<input class="att-input" name="amount" inputmode="decimal" required></label>' +
                  '<label class="att-label">On<input class="att-input" type="date" name="day" max="' + esc(today) + '" value="' + esc(today) + '"></label></div>' +
                  '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                if (PA.parseMoney(form.amount.value) == null) throw new Error('BAD_AMOUNT');
                await RA.rpc('pur_cash_count', { p_op: opId, p_buyer: b.buyer_id, p_on: form.day.value,
                                                 p_counted: String(PA.round2(PA.parseMoney(form.amount.value))), p_note: form.note.value });
            },
            onDone,
        });
    }

    function repayModal(b, owes, onDone) {
        const opId = newOp();
        const today = PA.localDay();
        RA.modal({
            title: 'Repay ' + b.name,
            sub: 'The company owes ' + PA.peso(owes) + ' for their own money. A repayment is not an expense and not petty cash.',
            submitLabel: 'Record repayment',
            body: '<div class="pur-rec-row"><label class="att-label">Amount (₱)<input class="att-input" name="amount" inputmode="decimal" value="' + esc(String(owes)) + '" required></label>' +
                  '<label class="att-label">Paid on<input class="att-input" type="date" name="day" max="' + esc(today) + '" value="' + esc(today) + '"></label>' +
                  '<label class="att-label">How<select class="att-input" name="method">' +
                    Object.keys(PA.PAY_METHOD).map(m => '<option value="' + m + '">' + esc(PA.PAY_METHOD[m]) + '</option>').join('') + '</select></label></div>' +
                  '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const a = PA.parseMoney(form.amount.value);
                if (!(a > 0)) throw new Error('BAD_AMOUNT');
                if (a > Number(owes)) throw new Error('OVER_OWED');
                await RA.rpc('pur_repay_buyer', { p_op: opId, p_buyer: b.buyer_id, p_amount: String(PA.round2(a)), p_on: form.day.value,
                                                  p_method: form.method.value, p_note: form.note.value });
            },
            onDone,
        });
    }

    // The daily report (Q18, Q20): one buyer, Philippine days, print and CSV.
    async function reportPanel(host, buyers, today, keep) {
        const st = keep || { buyer: (buyers.find(b => b.can_buy) || buyers[0] || {}).buyer_id || '', from: today.slice(0, 8) + '01', to: today };
        ui.report = st;
        host.innerHTML =
            '<div class="att-card"><div class="att-card-body">' +
              '<div class="pur-pay-head"><h3 class="pur-h3">Daily report</h3><button type="button" class="att-btn att-btn--sm" data-close-report>Close</button></div>' +
              '<div class="att-toolbar">' +
                '<label class="att-label">Buyer<select class="att-input" data-r="buyer">' + buyerOptions(buyers.concat([]), st.buyer) +
                  buyers.filter(b => !b.can_buy && b.buyer_id !== st.buyer).map(b => '<option value="' + esc(b.buyer_id) + '">' + esc(b.name) + '</option>').join('') + '</select></label>' +
                '<label class="att-label">From<input class="att-input" type="date" data-r="from" value="' + esc(st.from) + '"></label>' +
                '<label class="att-label">To<input class="att-input" type="date" data-r="to" value="' + esc(st.to) + '"></label>' +
                '<button type="button" class="att-btn" data-print disabled>Print</button>' +
                '<button type="button" class="att-btn" data-csv disabled>CSV</button>' +
              '</div><div data-r-body><div class="att-empty">Loading…</div></div>' +
            '</div></div>';
        host.querySelector('[data-close-report]').addEventListener('click', () => { ui.report = null; host.innerHTML = ''; });
        host.querySelectorAll('[data-r]').forEach(el => el.addEventListener('change', () => { st[el.dataset.r] = el.value; reportPanel(host, buyers, today, st); }));
        if (!st.buyer) { host.querySelector('[data-r-body]').innerHTML = '<div class="att-empty">No buyer.</div>'; return; }
        let rep;
        try { rep = await RA.rpc('pur_cash_report', { p_buyer: st.buyer, p_from: st.from, p_to: st.to }); }
        catch (e) { host.querySelector('[data-r-body]').innerHTML = '<div class="att-info att-info--warn"><div>' + esc(PA.errorMessage(e)) + '</div></div>'; return; }
        const table = reportTable(rep);
        host.querySelector('[data-r-body]').innerHTML = table +
            ((rep.pending_returns || []).length ? '<p class="req-muted">Returns waiting for your confirmation (not in the balance yet): ' +
               rep.pending_returns.map(r => esc(PA.peso(r.amount) + ' handed over ' + r.handed_on)).join(', ') + '</p>' : '') +
            '<p class="req-muted">A voided entry stays on its own day, marked; the void is a row on the day it was made, so a past day\'s closing never changes.</p>';
        const print = host.querySelector('[data-print]'), csv = host.querySelector('[data-csv]');
        print.disabled = false; csv.disabled = false;
        print.addEventListener('click', () => {
            const w = root.open('', '_blank');
            if (!w) return PA.notice('Allow pop-ups for this site to print.');
            w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Petty cash — ' + esc(rep.name) + '</title>' +
                '<style>body{font:13px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}' +
                'td.n{text-align:right}tr.k td{font-weight:600;background:#f6f6f6}</style></head><body>' +
                '<h2>Petty cash — ' + esc(rep.name) + '</h2><p>' + esc(rep.from + ' to ' + rep.to) +
                '. Petty cash is outside Spent and Profit. Returns count on the day the owner confirmed them.</p>' + table + '</body></html>');
            w.document.close();
            w.focus();
            w.print();
        });
        csv.addEventListener('click', () => {
            const blob = new Blob([PA.reportCsv(rep)], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'petty-cash-' + String(rep.name || 'buyer').replace(/[^A-Za-z0-9]+/g, '-') + '-' + rep.from + '-to-' + rep.to + '.csv';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        });
    }

    function reportTable(rep) {
        const rows = PA.reportRows(rep);
        if (!rows.length) return '<div class="att-empty">Nothing in these days. Opening and closing: ' + esc(PA.peso(Math.max(0, Number(rep.opening)))) + '.</div>';
        const money = (v) => v === '' || v == null ? '' : esc(PA.peso(v));
        return '<div class="req-table-wrap"><table class="att-table req-table"><thead><tr><th>Day</th><th>Entry</th><th>Detail</th><th>In</th><th>Out</th><th>Cash held</th></tr></thead><tbody>' +
            rows.map(r => '<tr' + (r.held != null ? ' class="k"' : '') + '><td>' + esc(r.day) + '</td><td>' + esc(r.what) + '</td><td>' + esc(r.detail) + '</td>' +
              '<td class="n">' + money(r.amountIn) + '</td><td class="n">' + money(r.amountOut) + '</td><td class="n">' +
              (r.held == null ? '' : money(r.held) + (r.shortfall > 0 ? ' <span class="att-pill att-pill--abandoned">shortfall ' + esc(PA.peso(r.shortfall)) + '</span>' : '')) +
              '</td></tr>').join('') + '</tbody></table></div>';
    }

    // ── A buyer: My cash ─────────────────────────────────────────────

    async function renderMyCash(body, me) {
        let d;
        try { d = await RA.rpc('pur_my_cash'); } catch (e) { RA.fail(body, e); return; }
        const reload = () => renderCash(body, me);
        if (!d.holder) {
            body.innerHTML = '<div class="att-empty">Petty cash is held by staff buyers. Nothing to show for this account.</div>';
            return;
        }
        const f = PA.cashFigures(d);
        body.innerHTML =
            '<div class="att-info"><i data-lucide="wallet"></i><div>Company money you hold for purchases, and what the company owes you for your own money. ' +
              'None of it changes a project\'s costs.</div></div>' +
            '<div class="pur-pay-figs pur-cash-cards">' +
              '<span>Cash held <strong>' + peso(f.held) + '</strong></span>' +
              (f.shortfall > 0 ? '<span>Unreconciled shortfall <strong>' + peso(f.shortfall) + '</strong><small>You paid more than the petty cash on record — the owner will check it.</small></span>' : '') +
              (f.pending > 0 ? '<span>Return waiting <strong>' + peso(f.pending) + '</strong><small>Counts once the owner confirms it.</small></span>' : '') +
              '<span>Company owes you <strong>' + peso(f.owes) + '</strong>' + (f.toReview > 0 ? '<small>' + peso(f.toReview) + ' waiting for the owner\'s OK.</small>' : '') + '</span>' +
            '</div>' +
            '<div class="att-toolbar"><button type="button" class="att-btn att-btn--primary" data-return>Report a return…</button>' +
              '<span class="req-muted">' + (d.own_money ? 'You may use your own money when petty cash runs short.' : 'Ask the owner before using your own money.') + '</span></div>' +
            section('Petty cash you were given (90 days)', 'If an entry never reached you, say so — the owner checks it.',
              (d.issues || []).map(i => '<li' + (i.voided_at ? ' class="is-void"' : '') + '>' + esc(i.issued_on) + ' — ' + peso(i.amount) + ' ' +
                esc(PA.PAY_METHOD[i.method] || i.method) + (i.note ? ' — ' + esc(i.note) : '') +
                (i.voided_at ? ' — voided: ' + esc(i.void_reason) :
                  i.disputed_at && !i.dispute_cleared_at ? ' ' + PA.pill('You said not received', 'working') :
                  ' <button type="button" class="att-btn att-btn--sm" data-dispute="' + esc(i.id) + '">I did not receive this…</button>') +
                (i.dispute_cleared_at ? ' <span class="req-muted">Owner: ' + esc(i.dispute_cleared_note || '') + '</span>' : '') + '</li>')) +
            section('Returns', 'Reported returns wait for the owner.',
              (d.returns || []).map(r => '<li>' + esc(r.handed_on) + ' — ' + peso(r.amount) + ' — ' +
                esc({ reported: 'waiting for the owner', withdrawn: 'withdrawn', confirmed: 'confirmed', rejected: 'rejected' }[r.status] || r.status) +
                (r.decision_note ? ': ' + esc(r.decision_note) : '') + (r.voided_at ? ' — voided by the owner' : '') +
                (r.status === 'reported' ? ' <button type="button" class="att-btn att-btn--sm" data-withdraw="' + esc(r.id) + '">Withdraw</button>' : '') + '</li>')) +
            section('Repaid to you (90 days)', 'What the company paid back for your own money.',
              (d.repayments || []).map(x => '<li' + (x.voided_at ? ' class="is-void"' : '') + '>' + esc(x.paid_on) + ' — ' + peso(x.amount) +
                (x.voided_at ? ' — voided' : '') + '</li>'));
        body.querySelector('[data-return]').addEventListener('click', () => returnModal(f.held, reload));
        body.querySelectorAll('[data-dispute]').forEach(b => b.addEventListener('click', () => noteModal('I did not receive this',
            'The owner sees your note. Your balance does not change until they settle it.', 'Send', 'pur_cash_dispute', { p_issue: b.dataset.dispute }, 'p_note', reload)));
        body.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try { await RA.rpc('pur_cash_withdraw_return', { p_op: newOp(), p_return: b.dataset.withdraw }); } catch (e) { PA.notice(e); }
            reload();
        }));
        RA.icons();
    }

    function returnModal(held, onDone) {
        const opId = newOp();
        const today = PA.localDay();
        RA.modal({
            title: 'Report a return',
            sub: 'Unused petty cash you handed back. It shows as "waiting" until the owner confirms it.',
            submitLabel: 'Report',
            body: '<div class="pur-rec-row"><label class="att-label">Amount (₱)<input class="att-input" name="amount" inputmode="decimal" value="' + (held > 0 ? esc(String(held)) : '') + '" required></label>' +
                  '<label class="att-label">Handed over on<input class="att-input" type="date" name="day" max="' + esc(today) + '" value="' + esc(today) + '"></label></div>' +
                  '<label class="att-label">To whom (optional)<input class="att-input" name="to" maxlength="120"></label>' +
                  '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>' +
                  '<label class="att-label">Photo (optional)<input class="att-input" type="file" name="photo" accept="image/*"></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const a = PA.parseMoney(form.amount.value);
                if (!(a > 0)) throw new Error('BAD_AMOUNT');
                let photo = '';
                const file = form.photo.files && form.photo.files[0];
                // R13: its own private folder — the owner and this buyer only.
                if (file) photo = await root.DacsReceipts.uploadReceipt('petty_cash', await root.DacsReceipts.compressToBlob(file), root.currentDataUserId);
                await RA.rpc('pur_cash_report_return', { p_op: opId, p_amount: String(PA.round2(a)), p_handed_on: form.day.value,
                                                         p_handed_to: form.to.value, p_photo_url: photo, p_note: form.note.value });
            },
            onDone,
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
```

**Modify:** `js/purchasing-admin-core.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-core.js b/js/purchasing-admin-core.js
index 3ab85e9..affd92c 100644
--- a/js/purchasing-admin-core.js
+++ b/js/purchasing-admin-core.js
@@ -462,6 +462,215 @@
         return rows;
     }
 
+    // ── Payments (0102, 2A-4a) ──────────────────────────────────────
+    // Payments never change Spent: they say how a purchase was paid. These
+    // helpers only word the server's answers and check a form before it is
+    // sent — the server decides every balance.
+
+    // A purchase's payment state (pur_pay_state) as a pill: text, tone, detail.
+    const PAY_STATE = {
+        not_tracked: { text: 'Payment not tracked', tone: 'hidden' },
+        unpaid: { text: 'Unpaid', tone: 'abandoned' },
+        partial: { text: 'Partially paid', tone: 'working' },
+        paid: { text: 'Paid', tone: 'done' },
+        overpaid: { text: 'Overpaid', tone: 'abandoned' },
+        void: { text: 'Void', tone: 'hidden' },
+        void_paid: { text: 'Voided — paid, to recover', tone: 'abandoned' },
+    };
+    function payLabel(pay) {
+        if (!pay || !PAY_STATE[pay.state]) return null;
+        const base = PAY_STATE[pay.state];
+        let detail = '';
+        if (pay.state === 'partial') detail = peso(pay.balance) + ' left';
+        else if (pay.state === 'overpaid' || pay.state === 'void_paid') detail = peso(pay.unresolved) + ' to recover';
+        else if (pay.state === 'unpaid') detail = peso(pay.due) + ' due';
+        return { text: base.text, tone: base.tone, detail };
+    }
+
+    const PAY_SOURCE = { petty_cash: 'Petty cash', own_money: 'Own money', company: 'Company (paid directly)', credit: 'Supplier credit' };
+    const PAY_METHOD = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer', check: 'Check', other: 'Other' };
+    // The purchase form's "Paid by" word → a payment method.
+    function methodOf(paymentMethod) {
+        const m = String(paymentMethod || '').toLowerCase().replace(/\s+/g, '_');
+        return PAY_METHOD[m] ? m : 'cash';
+    }
+
+    // "YYYY-MM-DD" today from LOCAL date parts (PH is UTC+8 — never toISOString).
+    function localDay(d) {
+        const x = d || new Date();
+        return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
+    }
+
+    // What the server would refuse in a payment form, said before sending.
+    // p: {amount, paidOn, method, source, creditId}; ctx: {today, creditLeft}
+    function paymentProblems(p, ctx) {
+        const out = [];
+        const a = parseMoney(p.amount);
+        if (!(a > 0)) out.push('BAD_AMOUNT');
+        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.paidOn || '')) || String(p.paidOn) > String((ctx && ctx.today) || localDay()) ||
+            String(p.paidOn) < '2020-01-01') out.push('BAD_DATE');
+        if (!PAY_SOURCE[p.source]) out.push('BAD_PAY_SOURCE');
+        if (p.source !== 'credit' && !PAY_METHOD[p.method]) out.push('BAD_METHOD');
+        if (p.source === 'credit') {
+            if (!p.creditId) out.push('CREDIT_REQUIRED');
+            else if (a > 0 && ctx && ctx.creditLeft != null && a > Number(ctx.creditLeft)) out.push('OVER_CREDIT');
+        }
+        return out;
+    }
+
+    // The pur_pay / pur_record body of one payment.
+    function paymentBody(p) {
+        const out = { amount: String(round2(parseMoney(p.amount))), paid_on: p.paidOn, source: p.source,
+                      method: p.source === 'credit' ? 'other' : p.method, note: String(p.note || '').trim() };
+        if (p.personId) out.person_id = p.personId;
+        if (p.source === 'credit') out.credit_id = p.creditId;
+        if (p.proofUrl) out.proof_url = p.proofUrl;
+        return out;
+    }
+
+    // Q16: a warning, never a refusal — real cash cannot go below zero, so
+    // paying more than recorded means a handover was not recorded, or own money.
+    function cashWarning(amount, held) {
+        const a = parseMoney(amount);
+        if (held == null || !(a > 0) || a <= Number(held)) return '';
+        return 'You hold ' + peso(Math.max(0, Number(held))) + ' of petty cash on record. This payment is ' + peso(a) +
+            '. It is saved, and the owner sees the difference as a shortfall to check.';
+    }
+
+    // "Paid now?" on the purchase form (Q3): none / full / part. Returns the
+    // payments to send with the purchase (one transaction on the server).
+    // st: {paidNow, paidAmount, paidFrom, paidMethod, paidCredit, purchaseDate};
+    // holder = the staff buyer whose petty cash or own money it is (null: none).
+    // A supplier credit used at the counter (R10) is checked by the server in
+    // the same transaction as the purchase.
+    function paidNowPayments(st, total, holder) {
+        if (!st || !st.paidNow || st.paidNow === 'none') return [];
+        const amount = st.paidNow === 'full' ? total : parseMoney(st.paidAmount);
+        return [paymentBody({ amount, paidOn: st.purchaseDate, method: st.paidMethod || 'cash', source: st.paidFrom || 'company',
+                              personId: (st.paidFrom === 'petty_cash' || st.paidFrom === 'own_money') ? holder : null,
+                              creditId: st.paidFrom === 'credit' ? st.paidCredit : null })];
+    }
+    // creditLeft: what the chosen credit has left (null: unknown).
+    function paidNowProblems(st, total, holder, creditLeft) {
+        if (!st || !st.paidNow || st.paidNow === 'none') return [];
+        const out = [];
+        const amount = st.paidNow === 'full' ? total : parseMoney(st.paidAmount);
+        if (!(amount > 0)) out.push('PAID_AMOUNT');
+        else if (st.paidNow === 'part' && amount >= total) out.push('PART_NOT_LESS');
+        if ((st.paidFrom === 'petty_cash' || st.paidFrom === 'own_money') && !holder) out.push('PERSON_REQUIRED');
+        if (!PAY_SOURCE[st.paidFrom || 'company']) out.push('BAD_PAY_SOURCE');
+        if (st.paidFrom === 'credit') {
+            if (!st.paidCredit) out.push('CREDIT_REQUIRED');
+            else if (amount > 0 && creditLeft != null && amount > Number(creditLeft)) out.push('OVER_CREDIT');
+        }
+        return out;
+    }
+
+    // Q10: a refund goes back to the money that paid. Who may receive each kind.
+    // credit: the supplier paid back in cash what a credit had paid (instead of the
+    // default, back to its credit) — to the company, or into a buyer's hands.
+    const REFUND_ROUTES = { petty_cash: ['petty_cash', 'company'], own_money: ['buyer', 'company'], company: ['company', 'petty_cash'],
+                            credit: ['company', 'petty_cash'] };
+    function routeLabel(fundedBy, receivedBy, name) {
+        const who = name || 'the buyer';
+        if (receivedBy === 'company') return 'To the owner / company — no balance changes';
+        if (fundedBy === 'petty_cash') return 'Back into ' + who + '\'s petty cash (cash held goes up)';
+        if (fundedBy === 'own_money') return 'To ' + who + ', for their own money ("Company owes" goes down)';
+        return 'To ' + who + ' — company cash they now hold';
+    }
+
+    // The Overpaid screen's starting split (server suggestion: the latest
+    // payments are the ones paid too much). Credit-funded excess goes back
+    // to that supplier's credit (Q10 clarified); every other part is a
+    // refund to the money that paid it.
+    function defaultResolution(row, today) {
+        const refunds = [];
+        let credit = 0;
+        (row.suggested || []).forEach(s => {
+            const amount = round2(s.amount);
+            if (!(amount > 0)) return;
+            if (s.source === 'credit') { credit = round2(credit + amount); return; }
+            refunds.push({ amount, fundedBy: s.source, personId: s.person_id || null, personName: s.person_name || '',
+                           receivedBy: s.source === 'own_money' ? 'buyer' : s.source === 'petty_cash' ? 'petty_cash' : 'company',
+                           receivedOn: today || localDay() });
+        });
+        return { refunds, credit };
+    }
+
+    // What the server would refuse in a resolution (OVER_SOURCE, OVER_RESOLVED…).
+    // paidBy: the purchase's [{source, person_id, paid, refunded}]; unresolved: the ₱ still over.
+    function resolutionProblems(refunds, credit, paidBy, unresolved, today) {
+        const out = [];
+        let total = 0;
+        const used = {};
+        (refunds || []).forEach((r, i) => {
+            const a = parseMoney(r.amount);
+            if (!(a > 0)) { out.push({ code: 'BAD_AMOUNT', part: i + 1 }); return; }
+            if (!(REFUND_ROUTES[r.fundedBy] || []).includes(r.receivedBy)) out.push({ code: 'BAD_REFUND_ROUTE', part: i + 1 });
+            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.receivedOn || '')) || String(r.receivedOn) > String(today || localDay())) out.push({ code: 'BAD_DATE', part: i + 1 });
+            // Company and credit money is nobody's own: capped by every payment of that kind.
+            const anyone = r.fundedBy === 'company' || r.fundedBy === 'credit';
+            const key = r.fundedBy + ':' + (anyone ? '' : (r.personId || ''));
+            used[key] = round2((used[key] || 0) + a);
+            const src = (paidBy || []).filter(p => p.source === r.fundedBy && (anyone || p.person_id === r.personId));
+            const left = src.reduce((s, p) => s + Number(p.paid) - Number(p.refunded || 0), 0);
+            if (used[key] > round2(left)) out.push({ code: 'OVER_SOURCE', part: i + 1 });
+            total = round2(total + a);
+        });
+        const c = parseMoney(credit);
+        if (String(credit == null ? '' : credit).trim() !== '' && !(c >= 0)) out.push({ code: 'BAD_AMOUNT', part: 'credit' });
+        if (c > 0) total = round2(total + c);
+        if (!(total > 0)) out.push({ code: 'NOTHING_TO_RESOLVE' });
+        else if (total > round2(unresolved)) out.push({ code: 'OVER_RESOLVED' });
+        return out;
+    }
+
+    // A buyer's cash as the tracker shows it: never below ₱0 held (Q16).
+    function cashFigures(s) {
+        const recorded = Number((s && s.recorded) || 0);
+        return { held: Math.max(0, recorded), shortfall: Math.max(0, -recorded), pending: Number((s && s.pending_returns) || 0),
+                 owes: Number((s && s.owes) || 0), toReview: Number((s && s.owes_to_review) || 0) };
+    }
+
+    // The daily report (pur_cash_report) as rows for the table, print and CSV.
+    // Balances below zero read ₱0 with the shortfall beside them. An entry
+    // voided later stays on its own day, marked; its reversal is a row on the
+    // day it was voided (R7), so a past day's closing never changes.
+    function reportRows(rep) {
+        const rows = [];
+        const bal = (v) => Math.max(0, Number(v));
+        const short = (v) => Math.max(0, -Number(v));
+        const voided = (x) => (x.voided_on ? ' (voided on ' + x.voided_on + ')' : '');
+        (rep && rep.days || []).forEach(d => {
+            rows.push({ day: d.day, what: 'Opening', detail: '', amountIn: '', amountOut: '', held: bal(d.opening), shortfall: short(d.opening) });
+            (d.received || []).forEach(x => rows.push({ day: d.day, what: 'Petty cash received', detail: (PAY_METHOD[x.method] || x.method || '') +
+                (x.note ? ' — ' + x.note : '') + (x.disputed ? ' (buyer says not received)' : '') + voided(x), amountIn: Number(x.amount), amountOut: '' }));
+            (d.refunds_in || []).forEach(x => rows.push({ day: d.day, what: 'Refund received', detail: (x.supplier || '') + voided(x),
+                amountIn: Number(x.amount), amountOut: '' }));
+            (d.payments || []).forEach(x => rows.push({ day: d.day, what: 'Paid to supplier', detail: (x.supplier || 'No supplier') + ' — ' +
+                (x.items || []).join(', ') + ' · ' + ((x.projects || []).concat(x.warehouse ? ['Warehouse'] : [])).join(', ') +
+                (x.purchase_status === 'void' ? ' (purchase voided)' : '') + voided(x), amountIn: '', amountOut: Number(x.amount) }));
+            (d.returns || []).forEach(x => rows.push({ day: d.day, what: 'Returned to the owner', detail: 'handed over ' + x.handed_on +
+                (x.handed_to ? ' to ' + x.handed_to : '') + voided(x), amountIn: '', amountOut: Number(x.amount) }));
+            (d.reversals || []).forEach(x => rows.push({ day: d.day, what: 'Void: ' + x.what + ' of ' + x.entry_day, detail: x.reason || '',
+                amountIn: Number(x.effect) > 0 ? Number(x.effect) : '', amountOut: Number(x.effect) < 0 ? -Number(x.effect) : '' }));
+            rows.push({ day: d.day, what: 'Closing', detail: '', amountIn: '', amountOut: '', held: bal(d.closing), shortfall: short(d.closing) });
+        });
+        return rows;
+    }
+    function csvCell(v) {
+        const s = v == null ? '' : String(v);
+        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
+    }
+    function reportCsv(rep) {
+        const head = ['Day', 'Entry', 'Detail', 'In (PHP)', 'Out (PHP)', 'Cash held (PHP)', 'Unreconciled shortfall (PHP)'];
+        const lines = [head.map(csvCell).join(',')];
+        reportRows(rep).forEach(r => lines.push([r.day, r.what, r.detail, r.amountIn === '' ? '' : round2(r.amountIn).toFixed(2),
+            r.amountOut === '' ? '' : round2(r.amountOut).toFixed(2), r.held == null ? '' : round2(r.held).toFixed(2),
+            r.shortfall == null ? '' : round2(r.shortfall).toFixed(2)].map(csvCell).join(',')));
+        return lines.join('\r\n') + '\r\n';
+    }
+
     // ── Server error codes → sentences ─────────────────────────────
 
     const ERRORS = {
@@ -519,6 +728,33 @@
         NOT_OFFICE: 'Only office accounts can do this.',
         NOT_ALLOWED: 'This account is not set up for Expenses.',
         PGRST202: 'The server is not updated for the Purchasing tab yet (migration 0097). Nothing was changed.',
+        // 0102 — payments, petty cash, own money.
+        BAD_SOURCE: 'This purchase came from an unknown place. Reload the page.',
+        BAD_PAY: 'Check the payment: at most five with a purchase, and none on a correction (use Record payment).',
+        BAD_PAY_SOURCE: 'Choose where the money came from: petty cash, own money, the company, or a supplier credit.',
+        BAD_METHOD: 'Choose how it was paid (cash, GCash, bank transfer, check or other).',
+        BAD_PERSON: 'Pick whose money it was.',
+        PERSON_REQUIRED: 'Say whose petty cash or own money paid — only a staff buyer holds petty cash.',
+        PERSON_NOT_ALLOWED: 'You can record only your own petty cash or own money. The owner records another buyer\'s.',
+        NOT_A_BUYER: 'Only a staff buyer of this company holds petty cash or can be owed their own money.',
+        CREDIT_REQUIRED: 'Pick the supplier credit to use.',
+        CREDIT_GONE: 'That supplier credit was voided. Reload the purchase.',
+        CREDIT_SUPPLIER: 'A supplier credit pays only that supplier — this purchase needs a supplier from the list, and the same one.',
+        OVER_CREDIT: 'That is more than the credit has left.',
+        CREDIT_USED: 'Part of this credit was already used. Void those payments first.',
+        NOT_YOURS: 'Only the person who recorded this payment, or the owner, can void it.',
+        ALREADY_VOIDED: 'This was already voided. Reload the page.',
+        RESOLVED_FIRST: 'A refund or credit already relies on this payment. Void that refund or credit first.',
+        NOTHING_TO_RESOLVE: 'Enter a refund or a supplier credit.',
+        BAD_RESOLUTION: 'Check the refunds and the credit.',
+        BAD_REFUND_ROUTE: 'That refund cannot go there: petty cash goes back into petty cash or to the owner; own money goes to the buyer or the owner; company money goes to the owner or into a buyer\'s petty cash.',
+        OVER_SOURCE: 'That is more back than that money paid on this purchase.',
+        OVER_RESOLVED: 'Refunds and credit together cannot be more than what is over.',
+        ALREADY_DISPUTED: 'You already said this was not received. The owner will check it.',
+        OVER_OWED: 'That is more than the company owes this buyer.',
+        BAD_RANGE: 'Pick at most 92 days, the start before the end.',
+        PAID_AMOUNT: 'Enter how much was paid now.',
+        PART_NOT_LESS: 'A part payment is less than the receipt total — choose "Paid in full" instead.',
     };
 
     function errorMessage(error) {
@@ -536,7 +772,10 @@
                    listSummary, coverPreview, pickedStill, lineStill, defaultPicks, countsDirectly, docUploads, storedDocs, prorate, receiptTotal,
                    buildBody, formProblems, unplannedReasonNeeded, HISTORY_LABEL, REQUEST_STATUS, purchaseFlags, needsOwner, changeRows, ERRORS,
                    errorMessage, SOURCE_LABEL, sourceLabel, searchPurchases, voidWord, voidConfirmed, placesOf, canRecordAgain,
-                   chargesOf, recordAgainState };
+                   chargesOf, recordAgainState,
+                   PAY_STATE, payLabel, PAY_SOURCE, PAY_METHOD, methodOf, localDay, paymentProblems, paymentBody, cashWarning,
+                   paidNowPayments, paidNowProblems, REFUND_ROUTES, routeLabel, defaultResolution, resolutionProblems,
+                   cashFigures, reportRows, reportCsv };
 
     if (typeof module !== 'undefined' && module.exports) {
         module.exports = pure;
```

**Modify:** `js/purchasing-admin-list.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-list.js b/js/purchasing-admin-list.js
index 0ed039d..cdea6cf 100644
--- a/js/purchasing-admin-list.js
+++ b/js/purchasing-admin-list.js
@@ -2,11 +2,13 @@
 // Requests → Purchasing (0097). Buyers only (the nav hides it otherwise;
 // the server refuses everyone else).
 //
-// One view with three tabs:
+// One view with four tabs:
 //   Shopping list    — this file: every open request line with something
 //                      still to buy, its portions and who is buying each;
 //   Purchases        — js/purchasing-admin-purchases.js;
-//   Owner approvals  — js/purchasing-admin-purchases.js.
+//   Owner approvals  — js/purchasing-admin-purchases.js;
+//   Cash             — js/purchasing-admin-cash.js (0102): the main owner's
+//                      petty-cash tracker, or a buyer's own cash.
 // "Record purchase" (js/purchasing-admin-record.js) opens from the list
 // with the ticked lines.
 //
@@ -27,7 +29,7 @@
     function tabs() {
         const t = (id, label) => '<button type="button" class="att-seg-btn' + (ui.tab === id ? ' is-on' : '') + '" data-tab="' + id + '">' + label + '</button>';
         return '<div class="att-seg" role="tablist" aria-label="Purchasing">' +
-            t('list', 'Shopping list') + t('purchases', 'Purchases') + t('approvals', 'Owner approvals') + '</div>';
+            t('list', 'Shopping list') + t('purchases', 'Purchases') + t('approvals', 'Owner approvals') + t('cash', 'Cash') + '</div>';
     }
 
     // Needed · Bought · Still to buy, as three blocks the eye can compare.
@@ -232,6 +234,7 @@
         if (ui.tab === 'purchases') return PA.renderPurchases(host.querySelector('[data-body]'), me);
         if (ui.tab === 'approvals') return PA.renderApprovals(host.querySelector('[data-body]'), me);
         if (ui.tab === 'record') return PA.renderRecord(host.querySelector('[data-body]'), me);
+        if (ui.tab === 'cash' && PA.renderCash) return PA.renderCash(host.querySelector('[data-body]'), me);
         return renderList(host, me);
     }
 
```

**Create:** `js/purchasing-admin-pay.js`

```js
// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → a purchase's payments (0102, WorkMate 2A-4a).
//
// Payments say how a purchase was paid: a deposit, the rest, from petty
// cash, the buyer's own money, the company directly or a supplier credit.
// They NEVER change Spent, Earned or Profit — the purchase did that once,
// when it was recorded (CLAUDE.md). This file only shows the server's
// answer (pur_purchase_payments) and sends:
//   pur_pay              Record payment (buyers; the main owner for anyone)
//   pur_void_payment     the person who recorded it, or the main owner
//   pur_resolve_overpaid the main owner: refunds tied to the money that
//                        paid (Q10) and/or a supplier credit
// Every write carries its own operation id: a resent press records once.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    const opt = (map, sel) => Object.keys(map).map(k => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(map[k]) + '</option>').join('');

    function payPill(pay) {
        const l = PA.payLabel(pay);
        return l ? PA.pill(l.text, l.tone) + (l.detail ? ' <span class="req-muted">' + esc(l.detail) + '</span>' : '') : '';
    }
    PA.payPill = payPill;

    function sourceText(p) {
        const who = p.person_name ? ' — ' + p.person_name : '';
        if (p.source === 'own_money' && !p.authorized) {
            return PA.PAY_SOURCE.own_money + who + (p.accepted_at ? ' (accepted by the owner)'
                : p.rejected_at ? ' (rejected by the owner: ' + (p.reject_reason || '') + ' — not owed)'
                : ' (not allowed at the time — owner review)');
        }
        return (PA.PAY_SOURCE[p.source] || p.source) + (p.source === 'company' ? (p.person_name ? ', handed over by ' + p.person_name : '') : who);
    }

    // The Payments card on a purchase's page.
    async function renderPayments(host, purchase, onChange) {
        host.innerHTML = '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">Payments</h3><div class="att-empty">Loading…</div></div></div>';
        let data;
        try {
            data = await RA.rpc('pur_purchase_payments', { p_purchase: purchase.id });
        } catch (e) {
            host.innerHTML = '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">Payments</h3><p class="req-muted">' +
                esc(PA.errorMessage(e)) + '</p></div></div>';
            return;
        }
        const pay = data.pay || {};
        const open = purchase.status === 'recorded';
        const live = (data.payments || []).filter(p => !p.voided_at);
        const voided = (data.payments || []).filter(p => p.voided_at);
        const owner = !!(data.me && data.me.main_owner);
        host.innerHTML =
            '<div class="att-card"><div class="att-card-body">' +
              '<div class="pur-pay-head"><h3 class="pur-h3">Payments</h3>' + payPill(pay) + '</div>' +
              '<p class="req-muted">How this receipt was paid. Payments never change Spent — the purchase counted once, when it was recorded.</p>' +
              (pay.state === 'not_tracked' ? '<p class="req-muted">Recorded before payments were tracked. Record a payment to start tracking it.</p>' : '') +
              '<div class="pur-pay-figs">' +
                '<span>Receipt <strong>' + esc(PA.peso(pay.due)) + '</strong></span>' +
                '<span>Paid <strong>' + esc(PA.peso(pay.paid)) + '</strong></span>' +
                (Number(pay.balance) > 0 ? '<span>Left to pay <strong>' + esc(PA.peso(pay.balance)) + '</strong></span>' : '') +
                (Number(pay.excess) > 0 ? '<span>Over <strong>' + esc(PA.peso(pay.excess)) + '</strong>' +
                   (Number(pay.resolved) > 0 ? ' · resolved ' + esc(PA.peso(pay.resolved)) : '') + '</span>' : '') +
              '</div>' +
              (Number(pay.over_resolved) > 0 ? '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>More was refunded or credited (' +
                  esc(PA.peso(pay.over_resolved)) + ') than is now over — the purchase total went up after it was resolved. Check the refunds and credit below.</div></div>' : '') +
              (live.length ? '<div class="req-table-wrap"><table class="att-table req-table"><thead><tr><th>Paid on</th><th>Amount</th><th>How</th><th>From</th><th>Note</th><th></th></tr></thead><tbody>' +
                live.map(p => '<tr><td>' + esc(p.paid_on) + '</td><td><strong>' + esc(PA.peso(p.amount)) + '</strong></td><td>' +
                  esc(p.source === 'credit' ? 'Credit' : (PA.PAY_METHOD[p.method] || p.method)) + '</td><td>' + esc(sourceText(p)) + '</td><td>' +
                  esc(p.note || '') + (p.proof_url ? ' <a class="att-link" href="#" data-proof="' + esc(p.proof_url) + '">proof</a>' : '') +
                  '<div class="req-muted">recorded by ' + esc(p.created_by_name) +
                    (p.moved ? ' · carried over from the earlier version of this purchase' : '') + '</div></td><td>' +
                  (p.can_void ? '<button type="button" class="att-btn att-btn--sm" data-void-pay="' + esc(p.id) + '">Void…</button>' : '') +
                  '</td></tr>').join('') + '</tbody></table></div>' : '<p class="req-muted">No payment recorded.</p>') +
              ((data.refunds || []).length || (data.credits || []).length ? '<h4 class="pur-h4">Refunds and supplier credit</h4><ul class="pur-history">' +
                (data.refunds || []).map(r => '<li' + (r.voided_at ? ' class="is-void"' : '') + '>' + esc(r.received_on) + ' — refund <strong>' +
                  esc(PA.peso(r.amount)) + '</strong>: ' + esc(PA.routeLabel(r.funded_by, r.received_by, r.person_name)) +
                  (r.voided_at ? ' — voided: ' + esc(r.void_reason) : '') +
                  (owner && !r.voided_at ? ' <button type="button" class="att-btn att-btn--sm" data-void-refund="' + esc(r.id) + '">Void…</button>' : '') + '</li>').join('') +
                (data.credits || []).map(c => '<li' + (c.voided_at ? ' class="is-void"' : '') + '>Supplier credit <strong>' + esc(PA.peso(c.amount)) +
                  '</strong> with ' + esc(c.supplier || 'the supplier') + ' — ' + esc(PA.peso(c.left)) + ' left' +
                  (c.voided_at ? ' — voided: ' + esc(c.void_reason) : '') +
                  (owner && !c.voided_at ? ' <button type="button" class="att-btn att-btn--sm" data-void-credit="' + esc(c.id) + '">Void…</button>' : '') + '</li>').join('') +
                '</ul>' : '') +
              (voided.length ? '<details class="pur-voided"><summary>Voided payments (' + voided.length + ')</summary><ul class="pur-history">' +
                voided.map(p => '<li class="is-void">' + esc(p.paid_on) + ' — ' + esc(PA.peso(p.amount)) + ' ' + esc(sourceText(p)) +
                  ' — voided: ' + esc(p.void_reason) + '</li>').join('') + '</ul></details>' : '') +
              '<div class="pur-pay-actions">' +
                (open ? '<button type="button" class="att-btn" data-record-pay>Record payment…</button>' : '') +
                (owner && Number(pay.unresolved) > 0 ? '<button type="button" class="att-btn att-btn--primary" data-resolve>Resolve overpaid…</button>' : '') +
              '</div>' +
            '</div></div>';

        const reload = () => { renderPayments(host, purchase, onChange); if (onChange) onChange(); };
        host.querySelectorAll('[data-proof]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); root.open(a.dataset.proof, '_blank'); }));
        const rec = host.querySelector('[data-record-pay]');
        if (rec) rec.addEventListener('click', () => openRecordPayment(purchase, data, reload));
        const res = host.querySelector('[data-resolve]');
        if (res) res.addEventListener('click', async () => {
            try {
                const list = await RA.rpc('pur_overpaid');
                const row = (list || []).find(x => x.id === purchase.id);
                if (row) openResolve(row, reload); else reload();
            } catch (e) { PA.notice(e); }
        });
        host.querySelectorAll('[data-void-pay]').forEach(b => b.addEventListener('click', () =>
            voidModal('Void this payment?', 'It stays in the history, marked void. Petty cash it used goes back on the buyer\'s balance; a credit it used is given back.',
                      'pur_void_payment', { p_payment: b.dataset.voidPay }, reload)));
        host.querySelectorAll('[data-void-refund]').forEach(b => b.addEventListener('click', () =>
            voidModal('Void this refund?', 'It stays in the history, marked void, and the balance it moved goes back.', 'pur_void_refund', { p_refund: b.dataset.voidRefund }, reload)));
        host.querySelectorAll('[data-void-credit]').forEach(b => b.addEventListener('click', () =>
            voidModal('Void this supplier credit?', 'Only a credit nothing has used yet can be voided.', 'pur_void_credit', { p_credit: b.dataset.voidCredit }, reload)));
        RA.icons();
    }
    PA.renderPayments = renderPayments;

    // A void with its reason (kept in the history), sent once.
    function voidModal(title, sub, fn, args, onDone) {
        const opId = root.DacsReceipts.newId();
        RA.modal({
            title, sub, warn: true, submitLabel: 'Void',
            body: '<label class="att-label">Reason (kept in the history)<input class="att-input" name="reason" maxlength="500" required></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc(fn, Object.assign({ p_op: opId, p_reason: form.reason.value.trim() }, args));
            },
            onDone,
        });
    }
    PA.voidModal = voidModal;

    // Record payment (Q4–Q7). Petty cash / own money are the caller's own
    // (a staff buyer); the main owner may enter them for a buyer.
    async function openRecordPayment(purchase, data, onDone) {
        const me = data.me || {};
        let buyers = [];
        if (me.main_owner) {
            try { buyers = ((await RA.rpc('pur_cash_tracker')).buyers || []).filter(b => b.can_buy || Number(b.recorded) !== 0); } catch (_) { buyers = []; }
        }
        const opId = root.DacsReceipts.newId();
        const today = PA.localDay();
        const credits = data.open_credits || [];
        const sources = {};
        if (me.holder || buyers.length) { sources.petty_cash = PA.PAY_SOURCE.petty_cash; sources.own_money = PA.PAY_SOURCE.own_money; }
        sources.company = PA.PAY_SOURCE.company;
        if (credits.length) sources.credit = PA.PAY_SOURCE.credit;
        const balance = Number((data.pay || {}).balance || 0);
        RA.modal({
            title: 'Record payment',
            sub: (purchase.supplier || 'No supplier') + ' · receipt ' + PA.peso((data.pay || {}).due) + ' · ' + PA.peso(balance) + ' left to pay. ' +
                 'A payment never changes Spent.',
            submitLabel: 'Record payment',
            body:
                '<div class="pur-rec-row">' +
                  '<label class="att-label">Amount (₱)<input class="att-input" name="amount" inputmode="decimal" value="' + (balance > 0 ? esc(String(balance)) : '') + '" required></label>' +
                  '<label class="att-label">Paid on<input class="att-input" type="date" name="paidOn" max="' + esc(today) + '" value="' + esc(today) + '" required></label>' +
                '</div>' +
                '<label class="att-label">Paid from<select class="att-input" name="source">' + opt(sources, me.holder ? 'petty_cash' : 'company') + '</select></label>' +
                (me.main_owner && buyers.length ? '<label class="att-label" data-person-row>Whose money<select class="att-input" name="person">' +
                    buyers.map(b => '<option value="' + esc(b.buyer_id) + '">' + esc(b.name) + '</option>').join('') + '</select></label>' : '') +
                (credits.length ? '<label class="att-label" data-credit-row hidden>Credit to use<select class="att-input" name="credit">' +
                    credits.map(c => '<option value="' + esc(c.id) + '" data-left="' + esc(c.left) + '">' + esc(PA.peso(c.left) + ' left') + '</option>').join('') +
                  '</select></label>' : '') +
                '<label class="att-label" data-method-row>How<select class="att-input" name="method">' + opt(PA.PAY_METHOD, PA.methodOf(purchase.payment_method)) + '</select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>' +
                '<label class="att-label">Proof photo (optional — GCash screenshot, deposit slip)<input class="att-input" type="file" name="proof" accept="image/*"></label>' +
                '<p class="req-muted" data-own-note hidden>Own money counts as "Company owes you" once the owner has allowed it (or accepts it afterwards).</p>' +
                '<div class="att-info att-info--warn" data-cash-warn hidden></div>',
            errorMessage: PA.errorMessage,
            onOpen: (form) => {
                const sync = () => {
                    const s = form.source.value;
                    const credit = form.querySelector('[data-credit-row]');
                    if (credit) credit.hidden = s !== 'credit';
                    form.querySelector('[data-method-row]').hidden = s === 'credit';
                    const person = form.querySelector('[data-person-row]');
                    if (person) person.hidden = !(s === 'petty_cash' || s === 'own_money');
                    form.querySelector('[data-own-note]').hidden = s !== 'own_money';
                    const warn = form.querySelector('[data-cash-warn]');
                    const msg = s === 'petty_cash' && me.holder && !me.main_owner ? PA.cashWarning(form.amount.value, me.cash_held) : '';
                    warn.textContent = msg; warn.hidden = !msg;
                };
                form.source.addEventListener('change', sync);
                form.amount.addEventListener('input', sync);
                sync();
            },
            onSubmit: async (form) => {
                const s = form.source.value;
                const creditSel = form.credit;
                const p = { amount: form.amount.value, paidOn: form.paidOn.value, method: form.method.value, source: s,
                            note: form.note.value, creditId: s === 'credit' && creditSel ? creditSel.value : null,
                            personId: (s === 'petty_cash' || s === 'own_money') && form.person ? form.person.value : null };
                const left = s === 'credit' && creditSel ? Number(creditSel.selectedOptions[0].dataset.left) : null;
                const problems = PA.paymentProblems(p, { today, creditLeft: left });
                if (problems.length) throw new Error(problems[0]);
                const file = form.proof.files && form.proof.files[0];
                if (file) {
                    const blob = await root.DacsReceipts.compressToBlob(file);
                    p.proofUrl = await root.DacsReceipts.uploadReceipt('purchase', blob, root.currentDataUserId);
                }
                const r = await RA.rpc('pur_pay', { p_op: opId, p_purchase: purchase.id, p_payment: PA.paymentBody(p) });
                if (r && r.replayed) PA.notice('This payment was already recorded by an earlier press — nothing was added.', 'Already recorded');
            },
            onDone,
        });
    }
    PA.openRecordPayment = openRecordPayment;

    // Resolve overpaid (Q9–Q11, main owner): refunds tied to the money that
    // paid, and/or a supplier credit. Starts from the server's suggestion.
    function openResolve(row, onDone) {
        const opId = root.DacsReceipts.newId();
        const today = PA.localDay();
        const start = PA.defaultResolution(row, today);
        const pay = row.pay || {};
        const paidBy = row.paid_by || [];
        const people = {};
        paidBy.forEach(p => { if (p.person_id) people[p.person_id] = p.person_name; });
        // Into a buyer's hands needs a buyer who paid on this purchase to pick.
        const routeOpts = (fundedBy, sel, name) => (PA.REFUND_ROUTES[fundedBy] || [])
            .filter(r => !(r === 'petty_cash' && (fundedBy === 'company' || fundedBy === 'credit') && !Object.keys(people).length)).map(r => '<option value="' + r + '"' + (r === sel ? ' selected' : '') + '>' +
            esc(PA.routeLabel(fundedBy, r, name)) + '</option>').join('');
        const part = (r, i) =>
            '<div class="pur-resolve-part" data-part="' + i + '">' +
              '<div class="pur-rec-row">' +
                '<label class="att-label">Refund of (₱)<input class="att-input" name="amt' + i + '" inputmode="decimal" value="' + esc(String(r.amount)) + '"></label>' +
                '<label class="att-label pur-w2">Money it paid from<input class="att-input" disabled value="' + esc(PA.PAY_SOURCE[r.fundedBy] + (r.personName ? ' — ' + r.personName : '')) + '"></label>' +
                '<label class="att-label">Received on<input class="att-input" type="date" name="day' + i + '" max="' + esc(today) + '" value="' + esc(r.receivedOn) + '"></label>' +
              '</div>' +
              '<label class="att-label">Where it went<select class="att-input" name="route' + i + '">' + routeOpts(r.fundedBy, r.receivedBy, r.personName) + '</select></label>' +
              (r.fundedBy === 'company' || r.fundedBy === 'credit' ? '<label class="att-label" data-recv-row="' + i + '"' + (r.receivedBy === 'petty_cash' ? '' : ' hidden') + '>Buyer who received it<select class="att-input" name="recv' + i + '">' +
                  Object.keys(people).map(id => '<option value="' + esc(id) + '">' + esc(people[id]) + '</option>').join('') + '</select></label>' : '') +
              '<label class="att-label">Note (optional)<input class="att-input" name="note' + i + '" maxlength="300"></label>' +
            '</div>';
        // A credit-funded excess goes back to the supplier's credit unless a real
        // refund is recorded (Q10): its refund line starts at ₱0, the credit box full.
        const parts = start.refunds.slice();
        if (start.credit > 0) parts.push({ amount: 0, fundedBy: 'credit', personId: null, personName: '', receivedBy: 'company', receivedOn: today });
        RA.modal({
            title: 'Resolve overpaid',
            sub: (row.supplier || 'No supplier') + ' · ' + PA.peso(pay.unresolved) + ' over. A refund goes back to the money that paid it; ' +
                 'a credit stays with the supplier for later purchases. Nothing here changes Spent.',
            submitLabel: 'Save',
            body:
                '<p class="req-muted">Paid: ' + paidBy.map(p => esc(PA.PAY_SOURCE[p.source] + (p.person_name ? ' (' + p.person_name + ')' : '') + ' ' +
                    PA.peso(p.paid) + (Number(p.refunded) > 0 ? ', ' + PA.peso(p.refunded) + ' already refunded' : ''))).join(' · ') + '</p>' +
                '<p class="req-muted">Started from the latest payments — change any amount, or set one to 0 to leave it out.</p>' +
                parts.map(part).join('') +
                '<div class="pur-rec-row">' +
                  '<label class="att-label">Supplier credit (₱)<input class="att-input" name="credit" inputmode="decimal" value="' + (start.credit > 0 ? esc(String(start.credit)) : '') + '"></label>' +
                  '<label class="att-label pur-w2">Credit note (optional)<input class="att-input" name="creditNote" maxlength="300"' +
                    (start.credit > 0 ? ' value="Back to the supplier\'s credit (paid from credit)"' : '') + '></label>' +
                '</div>' +
                (row.supplier_id ? '' : '<p class="req-muted">This purchase has no supplier from the list, so a credit needs one — add the supplier on the purchase first.</p>'),
            errorMessage: PA.errorMessage,
            onOpen: (form) => {
                parts.forEach((r, i) => {
                    const sel = form['route' + i];
                    const recv = form.querySelector('[data-recv-row="' + i + '"]');
                    if (sel && recv) sel.addEventListener('change', () => { recv.hidden = sel.value !== 'petty_cash'; });
                });
            },
            onSubmit: async (form) => {
                const refunds = parts.map((r, i) => ({
                    amount: form['amt' + i].value, fundedBy: r.fundedBy, receivedBy: form['route' + i].value, receivedOn: form['day' + i].value,
                    personId: r.fundedBy === 'company' || r.fundedBy === 'credit'
                        ? (form['route' + i].value === 'petty_cash' && form['recv' + i] ? form['recv' + i].value : null) : r.personId,
                    note: form['note' + i].value,
                })).filter(r => String(r.amount).trim() !== '' && Number(PA.parseMoney(r.amount)) > 0);
                const credit = form.credit.value;
                const problems = PA.resolutionProblems(refunds.map(r => Object.assign({}, r, { personId: r.fundedBy === 'company' || r.fundedBy === 'credit' ? null : r.personId })),
                                                       credit, paidBy, pay.unresolved, today);
                if (problems.length) throw new Error(problems[0].code);
                await RA.rpc('pur_resolve_overpaid', {
                    p_op: opId, p_purchase: row.id,
                    p_refunds: refunds.map(r => Object.assign({ amount: String(PA.round2(PA.parseMoney(r.amount))), funded_by: r.fundedBy,
                        received_by: r.receivedBy, received_on: r.receivedOn, note: String(r.note || '').trim() }, r.personId ? { person_id: r.personId } : {})),
                    p_credit: Number(PA.parseMoney(credit)) > 0 ? { amount: String(PA.round2(PA.parseMoney(credit))), note: form.creditNote.value.trim() } : null,
                });
            },
            onDone,
        });
    }
    PA.openResolve = openResolve;
})(typeof window !== 'undefined' ? window : globalThis);
```

**Modify:** `js/purchasing-admin-purchases.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-purchases.js b/js/purchasing-admin-purchases.js
index c228b8b..26103fc 100644
--- a/js/purchasing-admin-purchases.js
+++ b/js/purchasing-admin-purchases.js
@@ -43,6 +43,8 @@
               '<div class="req-muted">' + esc(p.lines + (p.lines === 1 ? ' line' : ' lines') + (p.linked ? ' · ' + p.linked + ' from requests' : '')) + '</div></td>' +
             '<td>' + esc(PA.sourceLabel(p.source)) + '</td>' +
             '<td><strong>' + esc(PA.peso(p.receipt_total)) + '</strong></td>' +
+            // 0102: how it was paid — never part of Spent.
+            '<td>' + (PA.payPill ? PA.payPill(p.pay) : '') + '</td>' +
             '<td>' + esc(p.bought_by_name) + (p.bought_by_name !== p.recorded_by_name ? '<div class="req-muted">recorded by ' + esc(p.recorded_by_name) + '</div>' : '') + '</td>' +
             '<td>' + PA.purchaseFlags(p).map(f => PA.pill(f.text, f.tone)).join(' ') + '</td>' +
           '</tr>';
@@ -75,7 +77,7 @@
             '<p class="req-muted">Project Control purchases are listed here too — check the Source and the project before you void anything.</p>' +
             (rows.length
               ? '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
-                  '<thead><tr><th>Date</th><th>Supplier</th><th>For</th><th>Source</th><th>Total</th><th>Bought by</th><th>Status</th></tr></thead><tbody data-rows></tbody>' +
+                  '<thead><tr><th>Date</th><th>Supplier</th><th>For</th><th>Source</th><th>Total</th><th>Payment</th><th>Bought by</th><th>Status</th></tr></thead><tbody data-rows></tbody>' +
                 '</table></div></div></div><div class="att-empty" data-none hidden>Nothing matches the search.</div>'
               : '<div class="att-empty">No purchases in these dates.</div>');
         const reload = () => renderPurchases(body, me);
@@ -170,6 +172,8 @@
               (docs.length ? '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">Receipt photos</h3><div class="pur-docs">' +
                   docs.map(([k, v]) => '<a class="att-link" href="#" data-doc-url="' + esc(v) + '">' + esc(k.replace(/_url$/, '').replace(/_/g, ' ')) + '</a>').join(' · ') +
                 '</div></div></div>' : '') +
+              // 0102: deposits, the rest, refunds and credit (js/purchasing-admin-pay.js).
+              '<div data-payments></div>' +
               '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">History</h3><ul class="pur-history">' +
                 (doc.history || []).map(h => '<li>' + esc(RA.formatManila(h.at)) + ' — <strong>' + esc(PA.HISTORY_LABEL[h.kind] || h.kind) + '</strong> by ' +
                   esc(h.actor_name) + (h.reason ? ': ' + esc(h.reason) : '') + '</li>').join('') +
@@ -180,6 +184,7 @@
             '</div>';
 
         const reload = () => renderPurchase(host);
+        if (PA.renderPayments) PA.renderPayments(host.querySelector('[data-payments]'), doc);
         host.querySelector('[data-back]').addEventListener('click', () => { PA.ui.tab = 'purchases'; root.switchView('reqPurchasing'); });
         host.querySelectorAll('[data-open-purchase]').forEach(a => a.addEventListener('click', (e) => {
             e.preventDefault();
```

**Modify:** `js/purchasing-admin-record.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-record.js b/js/purchasing-admin-record.js
index 23f0fff..1d59e92 100644
--- a/js/purchasing-admin-record.js
+++ b/js/purchasing-admin-record.js
@@ -34,6 +34,7 @@
     }
 
     let ctx = null;   // { requestLines, batchId, purchase, again, onDone }
+    let openCredits = [];   // 0102: the chosen supplier's credits with something left (R10)
     let st = null;    // the form
 
     const DOCS = [['po', 'po_image_url', 'Purchase order'], ['dr', 'delivery_receipt_url', 'Delivery receipt'],
@@ -291,11 +292,24 @@
         }
     }
 
+    // Whose petty cash or own money a "paid now" payment is (0102): a staff
+    // buyer only — the caller, or the buyer the owner picked in "Bought by".
+    function cashHolder(me) {
+        if (!me.isOwner) return me.userId;
+        return st.boughtBy && st.boughtBy !== me.userId ? st.boughtBy : null;
+    }
+
     async function save(host, me) {
         const box = host.querySelector('[data-problems]');
         const fs = formState();
         const problems = PA.formProblems(fs);
         if (st.editId && !String(st.reason || '').trim()) problems.unshift({ code: 'REASON_REQUIRED' });
+        // "Paid now?" (0102, Q3): new purchases only — a correction never carries payments.
+        if (!st.editId) {
+            const credit = openCredits.find(c => c.id === st.paidCredit);
+            PA.paidNowProblems(st, PA.receiptTotal(PA.buildBody(fs).lines, PA.buildBody(fs).charges), cashHolder(me), credit ? credit.left : null)
+              .forEach(code => problems.push({ code }));
+        }
         if (problems.length) {
             box.innerHTML = '<ul>' + problems.map(p => '<li>' + esc((p.line ? 'Line ' + p.line + ': ' : p.charge ? 'Fee/discount ' + p.charge + ': ' : '') +
                 PA.ERRORS[p.code]) + '</li>').join('') + '</ul>';
@@ -311,7 +325,9 @@
             body = PA.buildBody(formState());
             let res;
             if (!st.editId) {
-                res = await RA.rpc('pur_record', { p_op: st.opId, p_body: body });
+                // The purchase and its "paid now" payment are accepted together, or neither is.
+                const pays = PA.paidNowPayments(st, body.receipt_total, cashHolder(me));
+                res = await RA.rpc('pur_record', { p_op: st.opId, p_body: pays.length ? Object.assign({}, body, { payments: pays }) : body });
             } else if (body.lines.length === st.editLines) {
                 res = await RA.rpc('pur_correct', { p_op: st.opId, p_purchase: st.editId, p_body: body, p_reason: st.reason.trim() });
             } else {
@@ -367,17 +383,49 @@
         });
     }
 
+    // Section 5 (0102, Q3): was it paid at the counter? Saved with the
+    // purchase in one go. Later payments: Record payment on the purchase.
+    // A credit with the chosen supplier may pay at the counter too (R10).
+    function paidNowHtml(me) {
+        const holder = cashHolder(me);
+        const from = { company: PA.PAY_SOURCE.company };
+        if (holder) { from.petty_cash = PA.PAY_SOURCE.petty_cash; from.own_money = PA.PAY_SOURCE.own_money; }
+        if (openCredits.length) from.credit = PA.PAY_SOURCE.credit;
+        if (!from[st.paidFrom]) st.paidFrom = holder ? 'petty_cash' : 'company';
+        if (st.paidFrom === 'credit' && !openCredits.some(c => c.id === st.paidCredit)) st.paidCredit = openCredits[0].id;
+        if (!PA.PAY_METHOD[st.paidMethod]) st.paidMethod = PA.methodOf(st.paymentMethod);
+        const sel = (map, v) => Object.keys(map).map(k => '<option value="' + esc(k) + '"' + (k === v ? ' selected' : '') + '>' + esc(map[k]) + '</option>').join('');
+        const now = st.paidNow || 'none';
+        return secHtml('5', 'Paid now?', 'Optional. A payment never changes Spent — it only says how the receipt was paid.') +
+            '<div class="att-card"><div class="att-card-body"><div class="pur-rec-row">' +
+              '<label class="att-label">Paid at the counter<select class="att-input" data-paid="paidNow">' +
+                sel({ none: 'Not paid yet / record later', full: 'Paid in full', part: 'Paid part (deposit)' }, now) + '</select></label>' +
+              (now === 'part' ? '<label class="att-label">Amount paid (₱)<input class="att-input" data-paid="paidAmount" inputmode="decimal" value="' + esc(st.paidAmount || '') + '"></label>' : '') +
+              (now !== 'none' ? '<label class="att-label">Paid from<select class="att-input" data-paid="paidFrom">' + sel(from, st.paidFrom) + '</select></label>' +
+                (st.paidFrom === 'credit'
+                  ? '<label class="att-label">Credit to use<select class="att-input" data-paid="paidCredit">' +
+                      openCredits.map(c => '<option value="' + esc(c.id) + '"' + (c.id === st.paidCredit ? ' selected' : '') + '>' +
+                        esc(PA.peso(c.left) + ' left') + '</option>').join('') + '</select></label>'
+                  : '<label class="att-label">How<select class="att-input" data-paid="paidMethod">' + sel(PA.PAY_METHOD, st.paidMethod) + '</select></label>') : '') +
+            '</div>' +
+            (now !== 'none' && !holder && me.isOwner ? '<p class="req-muted">Petty cash and own money belong to a staff buyer: pick them in "Bought by" to use theirs.</p>' : '') +
+            '</div></div>';
+    }
+
     async function renderRecord(host, me) {
         if (!ctx) { PA.ui.tab = 'list'; return PA.renderPurchasing(host.closest('.content-view') || host.parentNode); }
         let suppliers, buyers, folders;
         try {
-            const [s, b, f] = await Promise.all([
+            const [s, b, f, cr] = await Promise.all([
                 RA.rpc('pur_suppliers'),
                 me.isOwner ? RA.rpc('pur_buyer_options') : Promise.resolve([]),
                 root.sbClient.from('folders').select('id, name, parent_folder_id, completed_at').order('name'),
+                // R10: the chosen supplier's open credits, for "Paid now" (new purchases only).
+                st && !st.editId && st.supplierId ? RA.rpc('pur_credits', { p_supplier: st.supplierId }) : Promise.resolve([]),
             ]);
             if (f.error) throw f.error;
             suppliers = s || []; buyers = b || [];
+            openCredits = (cr || []).filter(c => !c.voided_at && Number(c.left) > 0);
             const all = f.data || [];
             folders = [];
             all.filter(x => !x.parent_folder_id && (me.isOwner || !x.completed_at)).forEach(p => {
@@ -436,6 +484,7 @@
             '<div class="att-card"><div class="att-card-body">' +
               '<p class="req-muted">Kept once for the whole receipt, office buyers only — never shown to clients, partners or workers.</p>' +
               '<div class="pur-rec-row">' + DOCS.map(docHtml).join('') + '</div></div></div>' +
+            (st.editId ? '' : paidNowHtml(me)) +
             (st.editId ? '<label class="att-label">Reason for the change (kept in the history)<input class="att-input" data-h="reason" maxlength="500" value="' + esc(st.reason) + '"></label>' : '') +
             '<div class="att-info att-info--warn" data-problems hidden></div>' +
             '<div class="pur-rec-foot"><span>Receipt total <strong data-total></strong></span>' +
@@ -443,7 +492,17 @@
               '<button type="button" class="att-btn att-btn--primary" data-save>' + (st.editId ? 'Save correction' : 'Save purchase') + '</button></div>';
 
         const rerender = () => renderRecord(host, me);
-        host.querySelectorAll('[data-h]').forEach(el => el.addEventListener('input', () => { st[el.dataset.h] = el.value; if (el.dataset.h === 'supplierId' && el.value) st.supplier = ''; refresh(host); }));
+        host.querySelectorAll('[data-h]').forEach(el => el.addEventListener('input', () => {
+            st[el.dataset.h] = el.value;
+            if (el.dataset.h === 'supplierId' && el.value) st.supplier = '';
+            // Whose petty cash "Paid now" can use follows "Bought by"; which credit, the supplier.
+            if ((el.dataset.h === 'boughtBy' || el.dataset.h === 'supplierId') && st.paidNow && st.paidNow !== 'none') return rerender();
+            refresh(host);
+        }));
+        host.querySelectorAll('[data-paid]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
+            st[el.dataset.paid] = el.value;
+            if (el.dataset.paid === 'paidNow' || el.dataset.paid === 'paidFrom') rerender();
+        }));
         host.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
             const l = st.lines[Number(el.dataset.i)];
             if (el.dataset.f === 'where') {
```

**Modify:** `js/receipt-storage.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/receipt-storage.js b/js/receipt-storage.js
index 8f57d85..81c5570 100644
--- a/js/receipt-storage.js
+++ b/js/receipt-storage.js
@@ -6,11 +6,13 @@
 // Separate print windows don't run §11b, so their HTML goes through signHtml.
 // Access (migration 0089): owner/staff of the company in path segment 2 only;
 // purchases/ (0097): only those who may buy in that company.
+// pettyCash/ (0102): a petty-cash return photo — the main owner and the buyer who uploaded it.
 // ════════════════════════════════════════════════════════════════════
 (function (root) {
   'use strict';
   // 'purchase' (0097): one receipt for a whole purchase — buyers of the company only.
-  const FOLDER = { expense: 'expenseReceipts', payroll: 'payrollReceipts', purchase: 'purchases' };
+  // 'petty_cash' (0102): a buyer's return photo — never visible to other buyers.
+  const FOLDER = { expense: 'expenseReceipts', payroll: 'payrollReceipts', purchase: 'purchases', petty_cash: 'pettyCash' };
   const PUB_RE = /\/storage\/v1\/object\/public\/uploads\/([^?#"'\s<>)]+)/;
   const PUB_RE_G = /https?:\/\/[^"'\s<>)]*\/storage\/v1\/object\/public\/uploads\/[^"'\s<>)]+/g;
 
```

**Modify:** `package.json` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/package.json b/package.json
index eb4c33e..5785dbd 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
```


- [ ] **Step 1: Apply the files above.**
- [ ] **Step 2: Tests.** `npm test` → every suite passes: money **249**, `project-control-staff` 31, `purchasing-admin` 51, `purchasing-payments-screens` **19**, `receipt-storage` 6. `node --check` on every changed JS file.
- [ ] **Step 3: Stop for the user** to review and commit. **Do not push yet**: the screens call 0102, which is not live.

### Task 3: Live — apply 0102, check it, push the web, browser checks

- [ ] **Step 1: The user applies the committed file 0102.** Tasks 1 and 2 are committed first. Then the whole of `supabase/migrations/0102_purchase_payments.sql`, **unchanged**, is pasted into the Supabase SQL editor and run **once**. Nothing is typed or edited in the editor. This follows the migrations README: its rule bans SQL-editor *one-offs* (schema changes that are not a file in the folder), not applying a migration file. 0050, 0079, 0081, 0097 and 0101 were applied the same way, and this repo has no Supabase CLI link (`supabase/config.toml`). The editor does not add a row to `supabase_migrations.schema_migrations`, so Step 2 checks the live database against the file instead.
- [ ] **Step 2: Verify the live database ourselves** (MCP `execute_sql`, read-only): the nine tables exist with RLS on and no policies; `purchases.payments_tracked` is false on every existing purchase; every function in the migration exists with its grants; `pur_record`, `pur_header_ok`, `pur_list_doc`, `receipt_mark_attached`, `uploads_can_read`, `uploads_can_write` and `pur_petty_reader` match the file, and the `uploads_admin_update` storage policy names `pettyCash` (compare `md5(replace(prosrc, chr(13), ''))` with the file's function bodies — a Windows paste adds carriage returns).
- [ ] **Step 3: Live acceptance.** Run `supabase/tests/2a4_acceptance.sql` through MCP `execute_sql`. Expect the row `2a4 acceptance: all checks passed` (sections A–H; H checks the return-photo folder's read rule live). It rolls itself back; check afterwards that no `ZZ 2a4` row exists.
- [ ] **Step 4: The user pushes the web** (Task 2's commit).
- [ ] **Step 5: Browser checks** (owner = `admin@`, buyer = `staff@` with the Buyer switch on, a **`ZZ 2a4 pilot`** project with one billing period, supplier **`ZZ Pay Hardware`**). Record each result in *Execution notes*.

| # | Check | Expect |
|---|---|---|
| C1 | Purchases list | A **Payment** column; every purchase from before 0102 reads **Payment not tracked** |
| C2 | Owner: Cash → **Give petty cash** ₱5,000 to staff@ | staff@'s Cash tab: **Cash held ₱5,000** |
| C3 | staff@: record a ZZ purchase ₱1,250, **Paid now: Paid in full, Petty cash** | Saved once; the purchase reads **Paid**; Cash held ₱3,750; Project Control shows ₱1,250 Spent on ZZ — the payment added nothing |
| C4 | staff@: record ₱1,000 **Not paid yet**, then **Record payment** ₱300 GCash with a proof photo, then ₱700 cash | **Unpaid → Partially paid (₱700 left) → Paid**; the proof opens |
| C5 | staff@: Record payment ₱500 more on that purchase | **Overpaid ₱500**; on the owner's Cash tab under Overpaid |
| C6 | Owner: **Resolve…** — ₱300 back into staff@'s petty cash, ₱200 supplier credit | The purchase reads **Paid**; staff@'s Cash held +₱300; the credit listed with ₱200 left |
| C7 | staff@: a new ZZ Pay Hardware purchase ₱500, Record payment ₱120 from **Supplier credit**, ₱380 cash | **Paid**; the credit has **₱80 left**; Cash held fell only by the ₱380 |
| C7b | staff@: a new ZZ Pay Hardware purchase ₱50, **Paid now: Paid in full, Supplier credit** (the ₱80 credit) | One save; **Paid**; the credit has **₱30 left**; a second ₱50 "paid now" from that credit is refused before sending (more than is left) |
| C8 | staff@: **Report a return** ₱1,000 **with a photo**; owner confirms it | Before: "Return waiting". After: Cash held −₱1,000, on today in the **Daily report**; Print and CSV open; the CSV adds up. The owner opens the photo; staff@ opens it from their Cash tab. If a second buyer account exists, it **cannot** open it (otherwise the acceptance script's H1 covers this) |
| C9 | staff@: "**I did not receive this**" on the ₱5,000 entry; owner "It was handed over…" | The flag shows on the tracker, the balance unchanged; cleared |
| C10 | Owner: "May use own money" **off**; staff@ records ₱200 from **Own money** | **To review** on the tracker, not owed; owner **Accept** → Company owes ₱200; **Repay** ₱150 → owes ₱50 |
| C10b | staff@ records another ₱100 from **Own money**; owner **Reject…** with a reason | Asks for the reason first; leaves "to review"; Company owes stays **₱50**; the Payments card shows "Rejected: <reason>"; the purchase still reads paid by it |
| C11 | staff@: pay more petty cash than held | A warning first; saved anyway; the owner sees Cash held **₱0** and an **Unreconciled shortfall** |
| C12 | Project Control, ZZ pilot | Owner: **Unpaid / Partially paid / Paid** badges on the purchase rows. staff@: **no badge**. Spent = the purchases' totals |
| C13 | Void a payment (with a reason), then void a petty cash entry from **Details…** | The state goes back; the entries stay, marked void. In the **Daily report**, the voided entry stays on its own day marked "voided on …", and today has a **"Void: …" reversal** row; the earlier day's closing is unchanged (R7) |
| C13b | staff@: correct a ZZ purchase by **adding a line** (a replacement) after paying it | The new version's Payments card lists the payment with "carried over from the earlier version" (R4) |
| C14 | `client_errors` since the push | Nothing new from these screens |

- [ ] **Step 6: Clean-up.** Void the ZZ purchases in Purchasing with the list **filtered to `ZZ 2a4 pilot`** first (memory: the list holds real Project Control purchases too). The user then removes the ZZ project, supplier and their payment, petty-cash, refund, credit and repayment rows (and the ZZ proof and return photos with their upload-ledger rows) with a guarded SQL transaction **run by the user in the SQL editor** (dry run first; it refuses if any matched row is not ZZ, and checks that real purchases and the expense total are unchanged). Turn the switches back to what the owner wants.
- [ ] **Step 7: Execution notes** in this plan; memory updated. Then plan **2A-4b** (the phone).

---

## Self-review (against the answers)

| Answer | Where |
|---|---|
| Q1 (two plans) | This plan is 2A-4a; 2A-4b (phone) follows. 0102 already serves the phone: "paid now" in `pur_record`, `pur_pay`, `pur_my_cash`, `pur_cash_report_return`, `pur_cash_dispute`, every write sent once |
| Q2 (not tracked) | R3; `pur_pay_state` `not_tracked`; test "Q2" |
| Q3 (paid now, one transaction) | `pur_record`; tests "paid in full …", "a refused payment refuses the purchase too", "a retry …", race 4; the web form, with supplier credit (R10) |
| Q4 (who may pay) | `pur_pay_owner`, R2; test "who may pay" |
| Q5 (what a payment says) | `pur_payments`; `pur_pay_insert`; tests "bad payments are refused", "petty cash and own money …" |
| Q6 (offline) | Every write takes an operation id (`pur_ops`); the phone's queue is 2A-4b |
| Q7 (void, never delete) | `pur_void_payment` (recorder or main owner), R8; test "a mistaken payment is voided …" |
| Q8 (after a correction or void) | `pur_pay_state` `overpaid` / `void_paid`; test "Q8 …"; a replacement moves the payments with an audit trail (R4, test "R4 …") |
| Q9 (main owner resolves) | `pur_resolve_overpaid`; tests "only the main owner …", "each refund part is capped …", race 2 |
| Q10 (refunds tied to the money) | `pur_refunds` routes; R6; tests "the agreed example", "refund routes", "Q10: an overpaid credit-funded payment …", "Q10: … refunded in cash" |
| Q11, Q12 (credit is a balance, used in parts) | `pur_supplier_credits`, `pur_credit_left`; test "a supplier credit is a balance …", race 1 |
| Q13, Q14 (petty cash given, counts at once, dispute) | `pur_cash_give`, `pur_cash_dispute`; tests "only the main owner gives …", "Q14 …" |
| Q15 (one running balance) | `pur_cash_raw`; the tracker's "last given … days ago" |
| Q16 (overspend = shortfall) | `cashFigures`, `pur_cash_summary`; tests "Q16 …", "R11 …"; the web warning (`cashWarning`) |
| Q17, Q18 (returns, confirmation day) | `pur_cash_report_return`, `pur_cash_decide_return`; tests "Q17 …", "Q18/Q20 the daily report …"; the return photo's private folder (R13), test "R13 …", acceptance H |
| Q19 (cash count) | `pur_cash_count`; test "Q19 …" |
| Q20 (daily report, print, CSV) | `pur_cash_report`, `reportRows`, `reportCsv`; R7 (voids are reversals on the void day; test "R7 …"), R14 |
| Q21 (own money switch) | `pur_own_money`, `pur_accept_own_money`, `pur_reject_own_money`; R9; tests "Q21 …", "R9 …" |
| Q22 (repayments) | `pur_repay_buyer`, `pur_void_repayment`; R11; test "Q22 …", race 3 |
| Q23 (screens) | The web screens here; the phone's card and "Paid now" are 2A-4b |
| Q24 (who sees what) | Tables private; buyers read their own (`pur_my_cash`); the tracker, report, Overpaid, repayments main owner only; test "Q24 …"; the badge (R15) |

No placeholders. Every function a screen calls is in Task 1. Each task ends with the whole suite green on its own.

## Proof

Built in a scratch clone of `main` at `c12a98e`: Task 1 = scratch commit `0264374`, Task 2 = `1bc6118` (26 files, +5,059 / −32).

- **After Task 1 alone:** `npm test` green (money **249/249**, `purchasing-payments-server` **16/16**, `storage-access` **20/20**); `npm run test:sql` green — all 18 suites, including `2a4_payments.pglite.mjs` **47/47**, `2a4_concurrency.mjs` **4/4**, and 2A-1 / 2A-2 / 2A-3 `--with-0102` **45 / 44 / 23**.
- **After Task 2:** `npm test` green — 39 suites, none failing (`purchasing-payments-screens` **19/19**, `purchasing-admin` 51/51, `project-control-staff` 31/31, `receipt-storage` 6/6, money 249/249); `node --check` clean on every changed JS file.
- **Live acceptance, dry run:** `2a4_acceptance.sql` run on PGlite with Supabase-style JWT claims → `2a4 acceptance: all checks passed`, **0** ZZ rows left. Section H was proven to run (flipping H3 makes it fail).
- **Breakage runs (each rule broken on purpose, one at a time; a test must fail):**
  - **Server: 35 / 35 caught** — paid-now, BAD_PAY, overpaid state, refund caps and routes, OVER_RESOLVED, credit balance / lock / supplier, returns on the confirmation day, **R7** (voids never rewrite a past day; reversal sign), own money owed only when accepted, **R9** (rejected leaves "to review"; a reason required), OVER_OWED and its lock, main owner = Expenses, cash only to staff buyers, someone else's cash, who may void, the replacement trigger and **R4** (`first_purchase_id` kept; one history entry per moved payment), `payments_tracked` default, internal functions not granted, `pur_list_doc.pay`, both RESOLVED_FIRST branches, the tracker and `pur_cash_buyer` main-owner-only, **R13** (return photos: not every buyer; the uploader check; only the buyer's own upload accepted). The first run missed one ("void a payment whose money was refunded" when what is over still covers it); a test case was added and it is now caught.
  - **Web: 30 / 30 caught** — the pills, the date and amount checks, refund routes, the Overpaid split, cash never below ₱0, the CSV, the badge hidden from staff and non-owners, "Paid now" on new purchases only, the Cash tab / Payments card / script tag, one operation id per form, every error with words, **R10** (credit offered, its id sent, capped by what is left, used-up credits hidden), **R7** (voided marker, reversal rows and their direction), **R9** (Reject button, its reason, "rejected" shown), **R4** ("carried over" shown), **R13** (return photo filed under `pettyCash`, the helper knows the folder).
- Every file was restored and compared after each breakage run.
- **After review:** one comment line in 0102 was corrected ("Ten private tables" → "Nine"; there are nine). It is a comment only, so no SQL changed. `npm test` was re-run green, and the rehearsal below uses the corrected commits.

## Rehearsal

A fresh clone of the real repo at `c12a98e` (`core.autocrlf=false`). Task 1 and then Task 2 were applied **from this plan's text only**: Create blocks written as given, Modify blocks with `git apply --ignore-whitespace` after `--check`, then Step 1's CRLF command.

- Task 1: **13 blocks** applied; Task 2: **15 blocks** applied.
- All **26 files** are **byte-identical** to the tested build (raw bytes, line endings included). The README and DATABASE_SCHEMA diffs show only the added lines (36 insertions, 2 deletions).
- The first rehearsal found that the LF diffs leave LF lines inside the two CRLF files. Step 1's CRLF command was added for that, and the rehearsal was repeated with it.
- `npm test` on the rehearsed copy: green, all 39 suites. `npm run test:sql` was not repeated there, because the files are byte-identical to those it passed on.
