# WorkMate Stage 2A-4b — Paying on the phone (WorkMate 0.8.0+1009) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer pays for purchases from the phone — at the counter ("Paid now?") or later (Record payment), also with no signal — sees each purchase's Unpaid / Partially paid / Paid / Overpaid with what is left, and has a **My cash** card: petty cash held, a return waiting for the owner, what the company owes them, **Report a return** (with a photo only they and the owner can open) and **I did not receive this**. **None of it changes Spent, Earned or Profit.**

**Architecture:** One small migration (**0103**) gives the phone two things 0102 kept but never sent — a return's **photo** (finding F3 of 2A-4a) and the purchases-list row's **supplier id** (to pay from that supplier's credit with no signal), each 0102's function text plus one key — and one read, **`pur_my_ops_done`**: which of the caller's own operation ids the server already accepted (R38). Dacs Web shows the return photo on the buyer's own Cash tab and in the owner's one-buyer view. The phone reuses 2A-3b's design: payments and returns ride the **same send-once queue** as purchases (op kinds `pay` and `cash_return`, each op id minted once, photos uploaded once and kept between attempts); a "Paid now?" payment rides **inside** its purchase's `pur_record` call (one transaction, both or neither). The buyer's cash and the company's supplier credits are read fresh, with a **saved copy** for use with no signal; each saved copy records which sent operations it already counts, and a sent operation stays on the phone until every saved copy counts it (R38). Voiding a payment, taking back a return and "I did not receive this" need signal. No new tab (Q23).

**Tech stack:** Dacs Web — PostgreSQL / Supabase (plpgsql), vanilla JS, Node test files, PGlite. WorkMate — Flutter 3.38.9 / Dart 3.10.8, supabase_flutter 2.17.2, sqflite 2.4.2+1, image_picker 1.2.1 (no new dependency).

**Spec:** [Mobile Purchasing](../specs/2026-09-30-workmate-mobile-purchasing-design.md) · answers: [2A-4 questions](../specs/2026-10-22-workmate-stage2a4-questions.md) — **Q1–Q24 = A (Q10 clarified), confirmed 22 Oct 2026** · server as built: [plan 2A-4a + execution notes](2026-10-22-workmate-stage2a4a-payments-server-web.md) (R1–R16, F1–F5) · phone as built: [plan 2A-3b](2026-10-21-workmate-stage2a3b-buyer-app.md) (R16–R27)

**Repos:** Task 1 in **Dacs Web** (base `c3f4587`); Tasks 2–3 in **`Documents/Dacs WorkMate`** (base `a7f5ed1`). This plan file lives in Dacs Web with the other WorkMate plans.

**Status:** Revision 3, 23 October 2026, **for the user's review**. Revision 2 fixed four review findings (R38 a payment whose answer was lost is never counted twice; R39 a photo handed to the queue is never deleted by leaving during Save; the purchase screen counts payments waiting on the phone; Record payment only on tracked purchases on every screen). Revision 3 fixes the second review's blocker in R38: a sent payment was deleted from the phone at once, so a failed read right after fell back to an older saved copy that did not count it — cash held and left to pay could show too high. Sent payments are now kept until every saved copy counts them. **R37 still needs the user's own approval** (the reviewer recommends it; that is not the owner's approval). Nothing is applied live and nothing is in either repo yet. The code below was built and tested first in scratch clones (one commit per task, every suite green after each), then re-applied to fresh clones and compared byte for byte (see *Rehearsal*).

## Global Constraints

- **Outside the money model (CLAUDE.md):** payments, petty cash, refunds, credits and own money never feed Spent / Earned / Profit. 0103 reads and writes no `expenses` or `payroll` row and changes no Spent function; the phone sends payments only through 0102's functions.
- **New data needs real DB columns.** 0103 adds no column: `photo_url` and `supplier_id` already exist (0102, 0097). It redefines two **internal** functions (`pur_cash_detail`, `pur_list_doc`), each 0102's text plus one key, and revokes both again; its one grant is `pur_my_ops_done` (the caller's own operation ids only).
- **Migrations:** next number = highest + 1 = **0103** (highest on disk: `0102_purchase_payments.sql`). The user applies the **committed** file, unchanged, once (SQL editor; the README bans one-off editor changes, not applying a migration file). We then verify the live database ourselves.
- **Staff see no peso amounts** outside the approved exceptions: a Buyer sees payments on purchases in their buying scope and **their own** cash only (Q24). The phone shows no other buyer's cash, ever.
- **Dates:** a payment's day and a return's day are Manila's (`isoDate(manilaDate(now))`), never the UTC date.
- **WorkMate:** `pubspec.yaml` **`version: 0.8.0+1009`**. No dependency change. JDK 21 for builds (`$env:JAVA_HOME="$HOME\.jdks\jbr-21.0.11"`). **Never `--split-per-abi`**; the `app-releases` bucket takes 50 MB at most.
- **Q22:** every message and key label in English with the Tagalog line underneath.
- **The user commits.** Executors never run `git commit` or `git push`. Each task ends at a "stop for the user" step.
- **CRLF files:** Dacs Web's `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are CRLF. Task 1's Step 1 restores CRLF after applying (the diffs are shown with LF).

## Rulings (2A-4b)

R1–R27 stand (plans 2A-3b, 2A-4a). New, found while building and testing this plan. **For the user's approval with the plan.**

| # | Ruling |
|---|---|
| R28 | **0103 = two keys and one read.** `pur_cash_detail` adds the return's `photo_url` (F3: the buyer sees their own return photo — on the phone and on Dacs Web's Cash tab; the owner in that buyer's view). `pur_list_doc` adds `supplier_id`, so Record payment can offer that supplier's credit from the **saved copy** of My purchases, with no signal. Both stay internal (revoked again). `pur_my_ops_done(op ids)` answers which of the **caller's own** operation ids the server already has (R38). |
| R29 | **Paying works with no signal (Q6).** A later payment and a return are queued like purchases (`pur_op` kinds `pay` / `cash_return`; op id minted once at Save; the proof or photo uploaded once, its link kept between attempts) and shown **Waiting to send**. A refused one is **Needs attention** with the reason in both languages, and is **thrown away** by the buyer (with its photo) — it is never retried, and never "fixed": the buyer records it again. |
| R30 | **Online only:** voiding a payment (Q7, with a reason), taking back a return the owner has not decided, and **I did not receive this** (Q14, a note — the server requires one). With no signal they say "This needs signal" and change nothing. Each form mints its op id when it opens, so a resend acts once. |
| R31 | **What is left to pay counts payments still on the phone (Q6)**, marked "₱… waiting to send"; a refused one does not count. **Cash held** on the My cash card counts unsent petty-cash payments (purchases paid now from petty cash, and later petty-cash payments) and is **never below ₱0**; the rest shows as a shortfall (Q16). A return waiting to send or waiting for the owner **never** lowers cash held (Q17). |
| R32 | **What "Paid from" offers (R2, Q21, Q11):** petty cash and **own money** only to a staff buyer — own money only while the owner allows it, as last read; **Company (paid directly)** always; **Supplier credit** only for the purchase's own supplier with something left, chosen from a list. Never read and no signal: company and petty cash (the server decides, both or neither). A staff buyer starts on petty cash, as on the web. Changing the supplier re-picks the credit or leaves credit. |
| R33 | **Q16 on the phone:** paying more petty cash than held (less unsent petty-cash payments) shows a warning, in both languages, **before saving — never a refusal**. |
| R34 | **Record payment** is offered on recorded purchases whose payments are tracked (Q2: purchases from before 0102 stay "Payment not tracked"; the owner may start tracking one on Dacs Web) — **one rule, `PayState.canRecordPayment` (tracked and not voided), on every screen**. From My purchases (works offline, from the saved copy) and from the purchase itself (online), each prefilled with what is left **after payments waiting on the phone** (R31). "Paid now?" takes no proof photo, as on the web; Record payment takes one, optional (Q5). |
| R35 | **My cash is a card at the top of My purchases**, opening the full **My cash** screen (Q23: no new tab). An owner account sees no card (no petty cash, R2). Never read and no signal: "Connect once to see your cash". |
| R36 | **A return's photo** is filed in the private `pettyCash/` folder as a `petty_cash` upload (0102 R13). The buyer opens it on the phone by downloading it as themselves — never a signed link (2A-4a F2). |
| R38 | **A payment is counted exactly once — online, offline, and when its answer is lost.** (a) The server may accept a payment while its answer never reaches the phone. Before and after every fresh read of balances (My purchases, My cash, a purchase's payments) the phone asks `pur_my_ops_done` which queued op ids the server already has and marks them **sent**, as the background send does when the answer arrives: never sent again, photos deleted. With no signal nothing is marked on a guess. (b) A sent op is **kept on the phone until every saved copy that shows it counts it.** Each saved copy records which sent ops it already counts. A copy read before an op went still shows it — "Sent — shows in the list when it next updates" — and still counts it in what is left to pay and in cash held ("₱… not in this list yet", never "waiting to send"). Once the saved copies of My purchases and My cash both count it, it is forgotten (with its draft). (c) An op that went **during** a read (sent by the background send, or found by the check after it) may or may not be in that read, so the read is done again. Still moving after three reads, or no signal for the check after a read: that read is not used, and the saved copy is shown — exact, because it says what it counts. A purchase's Payments come with the payments that same read does not count. The phone's database moves to version 2 (a column on the queue and one on the saved copies); 0.7.1's queue and saved copies are kept. The op id makes the server write once; this makes the phone count once. |
| R39 | **A photo handed to the queue is the queue's.** While Save runs on Record payment and Report a return, Back waits; the form's photo is deleted only if it was never handed over (left without saving). A photo whose Save is still running is kept, never deleted. |
| R37 | **The launch ships 0.8.0+1009**, not 0.7.1+1008: 2A-3b's Step 7 (one real buyer run) and Step 8 (publish) wait for launch anyway, and 0.8.0 is 0.7.1 plus paying. 0.7.1 is never published. |

## File structure

| Repo | File | Task | What |
|---|---|---|---|
| Dacs Web | `supabase/migrations/0103_buyer_return_photo.sql` | 1 | **New.** The two keys (R28) |
| Dacs Web | `supabase/tests/2a4_payments.pglite.mjs` | 1 | `--with-0103` re-run + one 0103 test (48 with 0103) |
| Dacs Web | `supabase/tests/2a4b_acceptance.sql` | 1 | **New.** Live acceptance, rolls itself back |
| Dacs Web | `tests/purchasing-payments-server.test.js` | 1 | 0103 is 0102's text plus one key each; test:sql and docs |
| Dacs Web | `tests/purchasing-payments-screens.test.js` | 1 | The return photo link on the buyer's and the owner's lists |
| Dacs Web | `js/purchasing-admin-cash.js`, `admin.html` | 1 | `photoLink`; cache-buster `?v=20261023b` |
| Dacs Web | `package.json`, `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` | 1 | test:sql; docs (CRLF) |
| WorkMate | `lib/purchasing/domain/pay_models.dart` | 2 | **New.** Pay state, payments, credits, My cash, the payment and return checks and bodies |
| WorkMate | `lib/purchasing/domain/purchase_draft.dart` | 2 | "Paid now?" on the draft; its checks; the payment inside `pur_record` |
| WorkMate | `lib/purchasing/domain/pur_models.dart`, `pur_op.dart`, `pur_failure.dart` | 2 | List row pay + supplier; op kinds and photo folders; 0102 refusals in both languages |
| WorkMate | `lib/purchasing/data/*` , `sync/purchasing_sync.dart` | 2 | Server calls, the queue, the saved copy, sending pay / return ops; sent ops kept until every saved copy counts them, database version 2 (R38) |
| WorkMate | `lib/purchasing/ui/pay_copy.dart`, `purchasing_copy.dart` | 2 | Words, both languages |
| WorkMate | `test/purchasing/domain/pay_models_test.dart`, `data/payments_repository_test.dart`, `data/purchasing_db_test.dart`, fakes | 2 | 20 + 30 tests, and 3 new database tests (R38: the answer lost; a failed read after it, on both screens; sent during a read; the upgrade from 0.7.1) |
| WorkMate | `lib/purchasing/pay/*` | 3 | **New.** Record payment, Report a return, My cash (card + screen) |
| WorkMate | `lib/purchasing/record/*`, `mine/*`, `ui/buyer_shell.dart`, `ui/pay_widgets.dart` | 3 | "Paid now?"; the payment line; Payments on a purchase; shared widgets |
| WorkMate | `test/purchasing/pay/pay_screens_test.dart`, `record/record_screen_test.dart` | 3 | 29 screen tests (R39 Back during a slow Save, and the screen closed by the app during it; waiting payments on the purchase; a legacy purchase; R38 a sent payment says so and still counts); the record test's scroll helper scrolls both ways |
| WorkMate | `pubspec.yaml` | 3 | `0.8.0+1009` |

## Server calls the phone makes (all live after 0103)

| Call | Used for |
|---|---|
| `pur_record(op, body)` with `payments` (0102) | A purchase with its "Paid now?" payment — one transaction |
| `pur_pay(op, purchase, payment)` | Record payment (queued) |
| `pur_void_payment(op, payment, reason)` | Void (online) |
| `pur_purchase_payments(purchase)` | A purchase's payments, its open credits, this account's holder / own-money / cash held |
| `pur_my_cash()` (0103: returns carry `photo_url`) | My cash, saved for offline |
| `pur_credits(null)` | Supplier credits, saved for offline |
| `pur_my_purchases(60)` (0103: rows carry `supplier_id`; 0102: `pay`) | My purchases |
| `pur_my_ops_done(op ids)` (0103) | Before and after every fresh read of balances: which queued ops the server already has (R38) |
| `pur_cash_report_return(op, …, photo)` | Report a return (queued) |
| `pur_cash_withdraw_return(op, return)`, `pur_cash_dispute(op, issue, note)` | Online only |
| `receipt_uploads` insert (kind `purchase` / `petty_cash`) + Storage upload | Proof under `purchases/`, return photo under `pettyCash/` |

---

### Task 1: Dacs Web — migration 0103 and the return photo links

**Interfaces produced:** `pur_my_cash().returns[].photo_url`; `pur_my_purchases()[].supplier_id` (and `pur_purchases`); `pur_my_ops_done(uuid[]) → uuid[]`.

<!-- Tests -->

**Modify:** `supabase/tests/2a4_payments.pglite.mjs` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/supabase/tests/2a4_payments.pglite.mjs b/supabase/tests/2a4_payments.pglite.mjs
index 7d7736f..91f00e1 100644
--- a/supabase/tests/2a4_payments.pglite.mjs
+++ b/supabase/tests/2a4_payments.pglite.mjs
@@ -23,6 +23,9 @@ const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql
 const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql'));
 const M98 = read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql'));
 const M102 = read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql'));
+// --with-0103: re-run every test with 0103 on top (2A-4b: a return's photo reaches its buyer).
+const WITH_0103 = process.argv.includes('--with-0103');
+const M103 = WITH_0103 ? read(path.join(ROOT, 'supabase/migrations/0103_buyer_return_photo.sql')) : '';
 
 // The 2A-1 base schema (same as 2a1_purchase.pglite.mjs), plus the service
 // role the sign-in function runs as.
@@ -110,6 +113,7 @@ async function fresh(opts = {}) {
   if (!opts.without102) {
     await db.exec(fnText(M98, 'pm_main_owner_id'));
     await db.exec(M102);
+    if (WITH_0103) await db.exec(M103);
   }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
@@ -365,6 +369,7 @@ await test('Q2: a purchase recorded before 0102 reads "Payment not tracked" unti
   await as(db, '');
   await db.exec(fnText(M98, 'pm_main_owner_id'));
   await db.exec(M102);
+  if (WITH_0103) await db.exec(M103);
   eq((await state(db, old)).state, 'not_tracked', 'not "Unpaid"');
   await as(db, BUYER);
   const fresh2 = (await record(db, body([{ folder_id: f, item_name: 'Sand', quantity: 1, amount: 100 }]))).purchase_id;
@@ -1005,5 +1010,47 @@ await test('the history is append-only', async () => {
   eq((await all(db, `select kind from pur_money_events`)).map(r => r.kind), ['cash_given']);
 });
 
+if (WITH_0103) await test('0103: the buyer\'s own return photo (F3), the owner in that buyer\'s view, no other buyer; list rows name their supplier; done operations are the caller\'s own (R38)', async () => {
+  const db = await fresh();
+  await give(db, BUYER, 500);
+  const mine = `pettyCash/${OWNER}/2026-10/66666666-6666-6666-6666-666666666666.jpg`;
+  const url = 'https://example.supabase.co/storage/v1/object/public/uploads/' + mine;
+  await db.query(`insert into receipt_uploads (path, owner_id, kind, uploaded_by, state) values ($1, $2, 'petty_cash', $3, 'pending')`, [mine, OWNER, BUYER]);
+  await as(db, BUYER);
+  await db.query(`select pur_cash_report_return($1, '200', $2, 'the owner', $3, '')`, [op(), phDate(), url]);
+  await db.query(`select pur_cash_report_return($1, '50', $2, '', '', 'no photo')`, [op(), phDate()]);
+  const mineNow = (await one(db, `select pur_my_cash() x`)).x;
+  eq(mineNow.returns.map(r => r.photo_url).sort(), ['', url], 'both returns, the photo where there is one');
+  await as(db, OWNER);
+  eq((await one(db, `select pur_cash_buyer($1) x`, [BUYER])).x.returns.map(r => r.photo_url).sort(), ['', url], 'the main owner too');
+  await as(db, BUYER2);
+  const other = (await one(db, `select pur_my_cash() x`)).x;
+  eq(other.returns, [], 'another buyer sees only their own (none)');
+  assert(/OWNER_ONLY|NOT_ALLOWED/.test(await code(db.query(`select pur_cash_buyer($1)`, [BUYER]))), 'and cannot read Juan\'s');
+  await db.exec(`set role authenticated`);
+  assert((await code(db.query(`select pur_cash_detail($1, $2)`, [OWNER, BUYER]))).includes('permission denied'), 'still internal');
+  await db.exec(`reset role`);
+  // A purchases-list row (Purchasing, My purchases) also names its supplier, for paying from its credit offline.
+  const wil = await supplier(db, 'ZZ Wilcon');
+  const { id } = await bought(db, BUYER, 100, { body: { supplier_id: wil } });
+  await as(db, BUYER);
+  const row = (await one(db, `select pur_my_purchases(30) x`)).x.find(r => r.id === id);
+  eq([row.supplier_id, row.pay.state], [wil, 'unpaid'], 'My purchases: the supplier and the payment state');
+  // R38: which of MY operation ids the server already has — never another account's.
+  const mine1 = op(), mine2 = op();
+  await give(db, BUYER, 10);
+  await as(db, BUYER);
+  await db.query(`select pur_cash_report_return($1, '1', $2, '', '', '')`, [mine1, phDate()]);
+  const askBoth = async () => (await one(db, `select pur_my_ops_done($1::uuid[]) x`, [[mine1, mine2]])).x;
+  eq(await askBoth(), [mine1], 'the accepted one only');
+  await as(db, BUYER2);
+  eq(await askBoth(), [], 'another buyer learns nothing of Juan\'s');
+  assert((await code(db.query(`select pur_my_ops_done($1::uuid[])`, [Array.from({ length: 201 }, () => op())]))).includes('BAD_OP'), '200 at most');
+  await as(db, BUYER);
+  // Nothing else in the answer changed: 0102's keys plus photo_url on each return.
+  eq(Object.keys(mineNow.returns[0]).sort(),
+     ['amount', 'decided_at', 'decision_note', 'handed_on', 'handed_to', 'id', 'photo_url', 'status', 'voided_at']);
+});
+
 console.log('\n' + passed + ' passed, ' + failed + ' failed');
 if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/2a4b_acceptance.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-4b acceptance — migration 0103 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists — not the Buyer switch,
-- the petty cash, the return or its upload record. Editor-safe (set_config
-- 'v2a4b.*', no temp objects). Needs one active main owner with an active
-- staff account allowed Expenses, and an active worker. Run it through MCP
-- execute_sql. Success ends with the row '2a4b acceptance: all checks passed'.
--   A. a buyer reports a return with a photo: their own "My cash" carries the photo;
--      the server says that operation id is done — for this buyer only (R38)
--   B. the main owner sees it in that buyer's view; list rows carry supplier_id
--   C. a worker reads no cash at all; pur_cash_detail stays internal
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
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
  perform set_config('v2a4b.owner', v_owner::text, true);
  perform set_config('v2a4b.staff', v_staff::text, true);
  perform set_config('v2a4b.worker', v_worker::text, true);
  perform set_config('v2a4b.today', v_today::text, true);
  perform set_config('v2a4b.path', 'pettyCash/' || v_owner || '/' || to_char(v_today, 'YYYY-MM') || '/' || gen_random_uuid() || '.jpg', true);
end $$;

-- ═══ The main owner: Buyer switch on, petty cash given ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4b.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  perform pur_set_buyer(current_setting('v2a4b.staff')::uuid, true);
  perform pur_cash_give(gen_random_uuid(), current_setting('v2a4b.staff')::uuid, '500', current_setting('v2a4b.today'), 'cash', 'ZZ 2a4b');
end $$;

-- ═══ A. The buyer reports a return with a photo ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4b.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_url text := 'https://example.supabase.co/storage/v1/object/public/uploads/' || current_setting('v2a4b.path');
  v_op uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
begin
  insert into receipt_uploads (path, owner_id, kind) values (current_setting('v2a4b.path'), current_setting('v2a4b.owner')::uuid, 'petty_cash');
  r := pur_cash_report_return(v_op, '200', current_setting('v2a4b.today'), 'ZZ the owner', v_url, 'ZZ 2a4b');
  perform set_config('v2a4b.op', v_op::text, true);
  assert pur_my_ops_done(array[v_op, v_other]) = array[v_op], 'A0 the server has the return''s operation, not an unsent one (R38)';
  perform set_config('v2a4b.ret', r ->> 'return_id', true);
  assert (select x ->> 'photo_url' from jsonb_array_elements(pur_my_cash() -> 'returns') x where x ->> 'id' = current_setting('v2a4b.ret')) = v_url,
    'A1 the buyer''s own My cash carries the photo';
  assert uploads_can_read(current_setting('v2a4b.path'), null), 'A2 and Storage lets them open it';
end $$;

-- ═══ B. The main owner sees it in that buyer's view ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4b.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (select x ->> 'photo_url' from jsonb_array_elements(pur_cash_buyer(current_setting('v2a4b.staff')::uuid) -> 'returns') x
           where x ->> 'id' = current_setting('v2a4b.ret')) like 'https://%' || current_setting('v2a4b.path'), 'B1 the main owner sees the photo';
  assert not exists (select 1 from jsonb_array_elements(pur_purchases(null, null, null, 'all')) x where not (x ? 'supplier_id')),
    'B2 every purchases-list row names its supplier (0103)';
end $$;

-- ═══ C. A worker reads no cash; the detail stays internal ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4b.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_my_cash();
    raise exception 'C1 a worker read cash';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%' or sqlerrm like '%NOT_OFFICE%', 'C1 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_cash_detail(current_setting('v2a4b.owner')::uuid, current_setting('v2a4b.staff')::uuid);
    raise exception 'C2 pur_cash_detail is callable';
  exception when insufficient_privilege then null;
  end;
  assert not uploads_can_read(current_setting('v2a4b.path'), null), 'C3 a worker cannot open the photo';
  assert pur_my_ops_done(array[current_setting('v2a4b.op')::uuid]) = '{}'::uuid[], 'C4 another account learns nothing of the buyer''s operations';
end $$;
reset role;

select '2a4b acceptance: all checks passed' as result;
rollback;
```

**Modify:** `tests/purchasing-payments-screens.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/purchasing-payments-screens.test.js b/tests/purchasing-payments-screens.test.js
index 8af506d..3a07779 100644
--- a/tests/purchasing-payments-screens.test.js
+++ b/tests/purchasing-payments-screens.test.js
@@ -295,6 +295,17 @@ test('F4: the owner\'s payment tags are re-read after every payment action and w
     ok(m && m[1] >= '20261023a', f + '.js cache-buster bumped');
   }
 });
+test('F3 (0103): the buyer\'s own Returns and the owner\'s one-buyer view link the return photo, opened as a download', () => {
+  const cash = read('js/purchasing-admin-cash.js');
+  ok(/const photoLink = \(url\) => \(url \? ' <a class="att-link" href="#" data-photo="' \+ esc\(url\) \+ '">photo<\/a>' : ''\);/.test(cash), 'one photo link');
+  const buyer = cash.slice(cash.indexOf("section('Returns', 'Reported returns wait for the owner.'"), cash.indexOf("section('Repaid to you"));
+  ok(/photoLink\(r\.photo_url\)/.test(buyer), 'the buyer\'s own Returns list');
+  const panel = cash.slice(cash.indexOf('<h4 class="pur-h4">Returns (90 days)</h4>'), cash.indexOf('<h4 class="pur-h4">Cash counts</h4>'));
+  ok(/photoLink\(r\.photo_url\)/.test(panel), 'the owner\'s one-buyer view');
+  const opens = cash.match(/querySelectorAll\('\[data-photo\]'\)\.forEach\(a => a\.addEventListener\('click', \(e\) => \{ e\.preventDefault\(\); root\.open\(a\.dataset\.photo, '_blank'\); \}\)\);/g) || [];
+  eq(opens.length, 3, 'tracker, one-buyer view and the buyer\'s own cash each open it through the shim (pettyCash/ downloads, F2)');
+  ok(!/dacsMaybeSignUrl|createSignedUrl/.test(cash), 'never a signed link');
+});
 test('R4 and R9 on the Payments card: a carried-over payment and a rejected claim say so', () => {
   const pay = read('js/purchasing-admin-pay.js');
   ok(/p\.moved \? ' · carried over from the earlier version of this purchase'/.test(pay), 'carried over');
```

**Modify:** `tests/purchasing-payments-server.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/purchasing-payments-server.test.js b/tests/purchasing-payments-server.test.js
index 81fb487..ec0944e 100644
--- a/tests/purchasing-payments-server.test.js
+++ b/tests/purchasing-payments-server.test.js
@@ -214,11 +214,43 @@ test('npm run test:sql runs the 2A-4a suites and re-runs 2A-1 / 2A-2 / 2A-3 with
   ok(JSON.parse(read('package.json')).scripts.test.includes('node tests/purchasing-payments-server.test.js'), 'npm test runs this file');
 });
 test('the migrations README and the schema doc know 0102', () => {
-  ok(/0102_purchase_payments\.sql/.test(read('supabase/migrations/README.md')), 'README');
+  ok(/\*\*0102 \(WorkMate Stage 2A-4a/.test(read('supabase/migrations/README.md')), 'README: the 0102 entry');
   const doc = read('docs/DATABASE_SCHEMA.md');
   for (const t of TABLES) ok(doc.includes(t), 'DATABASE_SCHEMA.md: ' + t);
   ok(/payments_tracked/.test(doc), 'DATABASE_SCHEMA.md: purchases.payments_tracked');
 });
 
+console.log('\n0103 (2A-4b): a buyer sees the photo of their own return');
+
+test('0103: pur_cash_detail (+ photo_url) and pur_list_doc (+ supplier_id) are 0102\'s text plus one key, still internal; pur_my_ops_done reads the caller\'s own ids', () => {
+  const M103raw = read('supabase/migrations/0103_buyer_return_photo.sql');
+  const M103 = strip(M103raw);
+  const fns = [...M103.matchAll(/create or replace function (?:public\.)?([a-z_]+)\s*\(/g)].map(m => m[1]);
+  eq(fns, ['pur_cash_detail', 'pur_list_doc', 'pur_my_ops_done'], 'three functions');
+  ok(!/create table|alter table|create policy|drop |insert into|update |delete from/i.test(M103), 'no table, policy, drop or data change');
+  eq([...M103.matchAll(/^grant [^;]*;/gm)].map(m => m[0]), ['grant execute on function pur_my_ops_done(uuid[]) to authenticated;'],
+     'the one grant: pur_my_ops_done (pur_cash_detail and pur_list_doc stay internal)');
+  ok(/revoke all on function pur_my_ops_done\(uuid\[\]\) from public, anon;/.test(M103), 'never for anon');
+  const od = fnBody(M103, 'pur_my_ops_done', '0103');
+  ok(/o\.actor_id = auth\.uid\(\)/.test(od) && /cardinality\(p_ops\), 0\) > 200/.test(od), 'the caller\'s own ids only, 200 at most');
+  ok(!/insert|update|delete/i.test(od), 'a read');
+  ok(/revoke all on function pur_cash_detail\(uuid, uuid\) from public, anon, authenticated;/.test(M103), 'revoked again, explicitly');
+  ok(/revoke all on function pur_list_doc\(uuid\) from public, anon, authenticated;/.test(M103), 'pur_list_doc revoked again, explicitly');
+  const ld = fnBody(M103, 'pur_list_doc', '0103'), ld102 = fnBody(M102, 'pur_list_doc', '0102');
+  eq(removed(ld, ld102), [], 'pur_list_doc keeps every 0102 line');
+  eq(added(ld, ld102), ["'supplier_id', pu.supplier_id,"], '… plus the listed supplier');
+  const now = fnBody(M103, 'pur_cash_detail', '0103'), then = fnBody(M102, 'pur_cash_detail', '0102');
+  eq(removed(now, then), ["'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)"], 'one line replaced');
+  eq(added(now, then), ["'photo_url', r.photo_url, 'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)"], '… by itself plus photo_url');
+  ok(!/expenses|payroll|_projSpent/.test(M103), 'nothing about Spent');
+});
+test('npm run test:sql re-runs the payments suite with 0103; the migrations README and the schema doc know 0103', () => {
+  const pkg = JSON.parse(read('package.json'));
+  ok(/node supabase\/tests\/2a4_payments\.pglite\.mjs && node supabase\/tests\/2a4_payments\.pglite\.mjs --with-0103 &&/.test(pkg.scripts['test:sql']),
+    'test:sql runs 2a4_payments with and without 0103');
+  ok(/0103_buyer_return_photo\.sql/.test(read('supabase/migrations/README.md')) && /\*\*0103 /.test(read('supabase/migrations/README.md')), 'README');
+  ok(/0103/.test(read('docs/DATABASE_SCHEMA.md')) && /photo_url/.test(read('docs/DATABASE_SCHEMA.md')), 'DATABASE_SCHEMA');
+});
+
 console.log('\n' + passed + ' passed, ' + failed + ' failed');
 if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

<!-- Code -->

**Modify:** `admin.html` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/admin.html b/admin.html
index 6c02d9f..f7caa0a 100644
--- a/admin.html
+++ b/admin.html
@@ -5432,7 +5432,7 @@
 <script src="js/purchasing-admin-record.js?v=20261022b"></script>
 <script src="js/purchasing-admin-purchases.js?v=20261022b"></script>
 <script src="js/purchasing-admin-pay.js?v=20261023a"></script>
-<script src="js/purchasing-admin-cash.js?v=20261023a"></script>
+<script src="js/purchasing-admin-cash.js?v=20261023b"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261014a"></script>
 <script src="js/workplan-admin-board.js?v=20261014a"></script>
```

**Modify:** `docs/DATABASE_SCHEMA.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
index b9f14e7..c66b566 100644
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -1120,6 +1120,9 @@ Every table has RLS on, **no policies** and every privilege revoked: the screens
 | `receipt_mark_attached` (0097, redefined) | Also marks a payment's proof and a return's photo attached |
 | Trigger `purchases_pay_follow_replace` | When a purchase is replaced, its payments, refunds and credits move to the new version, with "not tracked" |
 | `pur_cash_detail(owner, buyer)` (internal) | One buyer's cash summary with the last 90 days of petty cash given, returns, cash counts and repayments. Read by `pur_my_cash` (the buyer) and `pur_cash_buyer` (the main owner) |
+| `pur_cash_detail` (0103, redefined) | Each return also carries `photo_url`, so a buyer sees the photo of their own return in "My cash" (the phone and Dacs Web) and the main owner sees it in that buyer's view. Still internal |
+| `pur_list_doc` (0103, redefined) | Also `supplier_id` (the listed supplier), so the phone can pay from that supplier's credit from its saved copy of My purchases. Still internal |
+| `pur_my_ops_done(op ids)` (0103) | Which of the caller's own operation ids `pur_ops` already holds (at most 200 asked). The phone finishes those before reading fresh balances, so a payment whose answer was lost is never counted twice |
 | Buyer reads and writes | `pur_pay`, `pur_void_payment` (the recorder or the main owner; `RESOLVED_FIRST` if a refund or credit already relies on it), `pur_purchase_payments`, `pur_credits`, `pur_my_cash`, `pur_cash_dispute`, `pur_cash_report_return`, `pur_cash_withdraw_return` |
 | Main-owner reads and writes | `pur_cash_give`, `pur_cash_clear_dispute`, `pur_cash_void_issue`, `pur_cash_decide_return`, `pur_cash_void_return`, `pur_cash_count`, `pur_cash_void_count`, `pur_set_own_money`, `pur_accept_own_money`, `pur_repay_buyer`, `pur_void_repayment`, `pur_resolve_overpaid`, `pur_void_refund`, `pur_void_credit`, `pur_cash_tracker`, `pur_cash_buyer(buyer)`, `pur_overpaid` (with a suggested split: the latest payments first), `pur_cash_report(buyer, from, to)` (≤ 92 days; voided entries listed apart) |
 | `pettyCash/<company>/<yyyy-mm>/<id>.jpg` (storage, R13) | A return photo. `uploads_can_read` (0097's, plus this branch first): only the main owner and the buyer who uploaded it (`pur_petty_reader`, by the upload ledger); written by buyers of the company; never overwritten. Ledger kind `petty_cash`. Payment proofs stay in `purchases/` |
```

**Modify:** `js/purchasing-admin-cash.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/purchasing-admin-cash.js b/js/purchasing-admin-cash.js
index e016bee..7ad05a5 100644
--- a/js/purchasing-admin-cash.js
+++ b/js/purchasing-admin-cash.js
@@ -22,6 +22,8 @@
     const PA = root.PurchasingAdmin;
     if (!RA || !PA) return;
     const esc = RA.esc;
+    // A return's photo (pettyCash/, R13): opened through the shim, which downloads it (F2) — never a signed link.
+    const photoLink = (url) => (url ? ' <a class="att-link" href="#" data-photo="' + esc(url) + '">photo</a>' : '');
     const ui = { report: null };
     const peso = (v) => esc(PA.peso(v));
     const newOp = () => root.DacsReceipts.newId();
@@ -90,7 +92,7 @@
             section('Returns waiting for you', 'The buyer says they handed this back. It lowers their cash held only when you confirm it, on the day you confirm.',
               (t.pending_returns || []).map(r => '<li><strong>' + esc(r.name) + '</strong> — ' + peso(r.amount) + ', handed over ' + esc(r.handed_on) +
                 (r.handed_to ? ' to ' + esc(r.handed_to) : '') + (r.note ? ' — ' + esc(r.note) : '') +
-                (r.photo_url ? ' <a class="att-link" href="#" data-photo="' + esc(r.photo_url) + '">photo</a>' : '') +
+                photoLink(r.photo_url) +
                 ' <button type="button" class="att-btn att-btn--sm att-btn--primary" data-confirm="' + esc(r.id) + '">Confirm received</button>' +
                 ' <button type="button" class="att-btn att-btn--sm" data-reject="' + esc(r.id) + '">Reject…</button></li>')) +
             section('"I did not receive this"', 'A buyer says petty cash you recorded never reached them. Their balance is unchanged until you settle it.',
@@ -228,7 +230,8 @@
               '<h4 class="pur-h4">Returns (90 days)</h4><ul class="pur-history">' +
                 ((d.returns || []).map(r => '<li' + (r.voided_at ? ' class="is-void"' : '') + '>' + esc(r.handed_on) + ' — ' + peso(r.amount) + ' — ' +
                   esc({ reported: 'waiting for you', withdrawn: 'withdrawn by the buyer', confirmed: 'confirmed', rejected: 'rejected' }[r.status] || r.status) +
-                  (r.decision_note ? ': ' + esc(r.decision_note) : '') + (r.voided_at ? ' — voided' : r.status === 'confirmed' ? voidBtn('data-void-return', r.id) : '') + '</li>').join('') ||
+                  (r.decision_note ? ': ' + esc(r.decision_note) : '') + photoLink(r.photo_url) +
+                  (r.voided_at ? ' — voided' : r.status === 'confirmed' ? voidBtn('data-void-return', r.id) : '') + '</li>').join('') ||
                   '<li class="req-muted">None.</li>') + '</ul>' +
               '<h4 class="pur-h4">Cash counts</h4><ul class="pur-history">' +
                 ((d.counts || []).map(k => '<li' + (k.voided_at ? ' class="is-void"' : '') + '>' + esc(k.counted_on) + ' — counted ' + peso(k.counted) +
@@ -241,6 +244,7 @@
             '</div></div>';
         const again = () => { reload(); };
         host.querySelector('[data-close-buyer]').addEventListener('click', () => { host.innerHTML = ''; });
+        host.querySelectorAll('[data-photo]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); root.open(a.dataset.photo, '_blank'); }));
         host.querySelector('[data-count]').addEventListener('click', () => countModal(b, again));
         const rp = host.querySelector('[data-repay]');
         if (rp) rp.addEventListener('click', () => repayModal(b, f.owes, again));
@@ -393,12 +397,13 @@
             section('Returns', 'Reported returns wait for the owner.',
               (d.returns || []).map(r => '<li>' + esc(r.handed_on) + ' — ' + peso(r.amount) + ' — ' +
                 esc({ reported: 'waiting for the owner', withdrawn: 'withdrawn', confirmed: 'confirmed', rejected: 'rejected' }[r.status] || r.status) +
-                (r.decision_note ? ': ' + esc(r.decision_note) : '') + (r.voided_at ? ' — voided by the owner' : '') +
+                (r.decision_note ? ': ' + esc(r.decision_note) : '') + (r.voided_at ? ' — voided by the owner' : '') + photoLink(r.photo_url) +
                 (r.status === 'reported' ? ' <button type="button" class="att-btn att-btn--sm" data-withdraw="' + esc(r.id) + '">Withdraw</button>' : '') + '</li>')) +
             section('Repaid to you (90 days)', 'What the company paid back for your own money.',
               (d.repayments || []).map(x => '<li' + (x.voided_at ? ' class="is-void"' : '') + '>' + esc(x.paid_on) + ' — ' + peso(x.amount) +
                 (x.voided_at ? ' — voided' : '') + '</li>'));
         body.querySelector('[data-return]').addEventListener('click', () => returnModal(f.held, reload));
+        body.querySelectorAll('[data-photo]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); root.open(a.dataset.photo, '_blank'); }));
         body.querySelectorAll('[data-dispute]').forEach(b => b.addEventListener('click', () => noteModal('I did not receive this',
             'The owner sees your note. Your balance does not change until they settle it.', 'Send', 'pur_cash_dispute', { p_issue: b.dataset.dispute }, 'p_note', reload)));
         body.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
```

**Modify:** `package.json` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/package.json b/package.json
index 5785dbd..8b4cd0c 100644
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**Create:** `supabase/migrations/0103_buyer_return_photo.sql`

```sql
-- 0103 — WorkMate Stage 2A-4b: a buyer sees the photo of their own petty-cash return.
--
-- Plan: docs/superpowers/plans/2026-10-23-workmate-stage2a4b-buyer-payments.md;
-- finding F3 of plan 2A-4a (execution notes, 23 Oct 2026).
--
-- 0102 kept a return's photo (pur_cash_returns.photo_url, in the private
-- pettyCash/ folder that only the main owner and the uploading buyer may read,
-- R13) but pur_cash_detail never sent it: the buyer's own "My cash" (pur_my_cash)
-- and the main owner's one-buyer view (pur_cash_buyer) both read through it.
-- pur_cash_detail is 0102's text plus one key, 'photo_url', on each return.
-- It stays internal (callable only through pur_my_cash / pur_cash_buyer, which
-- check their caller first). Opening the photo is still decided by Storage on
-- every download (uploads_can_read → pur_petty_reader).
--
-- pur_list_doc (one Purchases / My purchases row) is 0102's text plus one key,
-- 'supplier_id': the phone may record a payment from that supplier's credit
-- with no signal, from its saved copy of My purchases (2A-4b, Q6/Q11). The
-- row already carried the supplier's name; Purchasing reads it as before.
--
-- pur_my_ops_done (new): which of the CALLER'S OWN operation ids the server
-- already accepted (pur_ops, 0096). A phone whose answer was lost keeps the
-- payment queued; before it reads fresh balances it asks this, finishes what
-- the server already has, and so never counts that payment twice (2A-4b R38).
-- It reveals nothing but the caller's own ids, at most 200 asked at once.
--
-- Nothing else changes: no table, no money. pur_my_ops_done is the only grant.

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
                  'photo_url', r.photo_url, 'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)
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

revoke all on function pur_cash_detail(uuid, uuid) from public, anon, authenticated;

-- One purchases-list row (0101, 0102): plus the listed supplier.
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
           'supplier_id', pu.supplier_id,
           'pay', pur_pay_state(pu.id))
    from purchases pu where pu.id = p_purchase
$$;

revoke all on function pur_list_doc(uuid) from public, anon, authenticated;

-- Which of the caller's own operation ids the server already has (R38).
create or replace function pur_my_ops_done(p_ops uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(cardinality(p_ops), 0) > 200 then raise exception 'BAD_OP' using errcode = 'P0001'; end if;
  return coalesce((select array_agg(o.op_id order by o.op_id) from pur_ops o
                    where o.actor_id = auth.uid() and o.op_id = any(coalesce(p_ops, '{}'::uuid[]))), '{}'::uuid[]);
end;
$$;

revoke all on function pur_my_ops_done(uuid[]) from public, anon;
grant execute on function pur_my_ops_done(uuid[]) to authenticated;
```

**Modify:** `supabase/migrations/README.md` — apply with `git apply --ignore-whitespace`

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
index fc9b90a..d96e7dd 100644
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0103** — highest on disk is
-  `0102_purchase_payments.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0104** — highest on disk is
+  `0103_buyer_return_photo.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -190,6 +190,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0102 (WorkMate Stage 2A-4a — paying for purchases; OUTSIDE the money model)** adds nine private tables (RLS on, no policies, every privilege revoked — reads and writes only through its functions): `pur_payments` (a payment on the WHOLE purchase: amount, actual day, method, and the money it came from — `petty_cash` / `own_money` (a staff buyer's) / `company` / `credit`; voided with a reason, never deleted), `pur_supplier_credits` (a balance with one supplier, from an overpaid purchase, used in parts by `credit` payments), `pur_refunds` (tied to the money that paid: `funded_by` × `received_by` decides whether the buyer's cash held or "Company owes buyer" moves; a credit-funded excess is refunded in cash only when the owner records it — by default it goes back to the supplier's credit), `pur_cash_issues` / `pur_cash_returns` / `pur_cash_counts` (petty cash given by the main owner, returns the buyer reports and the main owner confirms — the balance drops on the confirmation day — and cash counts, a record only), `pur_own_money` (the "May use own money" switch), `pur_buyer_repayments`, and the append-only `pur_money_events`; plus `purchases.payments_tracked` (false on every purchase recorded before 0102 — "Payment not tracked" — true from then on). Redefines `pur_record` (body `payments`: "paid now", accepted in the SAME transaction as the purchase or not at all), `pur_header_ok` (a correction or replacement carrying `payments` is `BAD_PAY`), `pur_list_doc` (adds `pay`, the payment state) and `receipt_mark_attached` (payment proofs and return photos); a trigger moves payments, refunds and credits to a purchase's replacement (each payment keeps its `first_purchase_id`; one history entry per moved row). Return photos get their own folder, `pettyCash/` (redefines `uploads_can_read` / `uploads_can_write`, the `uploads_admin_update` policy and the `receipt_uploads` checks and insert policy: only the main owner and the uploading buyer read one). A voided petty-cash entry stays on its own day; the void counts on the day it was made. Buyers (`pur_buyer`) record and void their payments and see their own cash; the MAIN owner (0098's `pm_main_owner_id`, with the Expenses section) gives petty cash, confirms returns, resolves Overpaid, repays, sets the switch and reads the tracker and daily report. Every write takes an operation id (`pur_ops`). **Writes and reads no `expenses` or `payroll` row: Spent is computed exactly as before.** Requires 0098. Prove with `npm run test:sql` (`2a4_payments.pglite.mjs`, `2a4_concurrency.mjs`, and the 2A-1 / 2A-2 / 2A-3 suites re-run `--with-0102`) and `node tests/purchasing-payments-server.test.js`; live: `supabase/tests/2a4_acceptance.sql` (self-wrapped, rolls back).
 
+**0103 (WorkMate Stage 2A-4b — a buyer sees the photo of their own petty-cash return; OUTSIDE the money model)** redefines `pur_cash_detail` as 0102's text plus `photo_url` on each return (finding F3 of 2A-4a: the photo was kept but never sent to the buyer's "My cash"). It is read through `pur_my_cash` (the buyer, their own) and `pur_cash_buyer` (the main owner); it stays internal (revoked again, no grant). Also redefines `pur_list_doc` as 0102's text plus `supplier_id` (the phone pays from that supplier's credit using its saved copy of My purchases); internal as before. Adds `pur_my_ops_done(op ids)` (signed-in users): which of the caller's OWN operation ids the server already accepted (`pur_ops`), so a phone whose answer was lost never counts that payment twice; at most 200 asked at once. No table, no data, no money. Opening the photo is still decided by Storage on every download (`pur_petty_reader`). Prove with `npm run test:sql` (`2a4_payments.pglite.mjs --with-0103`) and `node tests/purchasing-payments-server.test.js`; live: `supabase/tests/2a4b_acceptance.sql` (self-wrapped, rolls back).
+
 Get the truth before relying on this line:
 
 ```sql
````


- [ ] **Step 1: Apply the files above** in Dacs Web. Create blocks as given; Modify blocks with `git apply --ignore-whitespace`. Then put the two CRLF files back to CRLF everywhere:

```bash
node -e "const fs=require('fs');for(const f of ['supabase/migrations/README.md','docs/DATABASE_SCHEMA.md'])fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"
```

- [ ] **Step 2: Tests.** `npm test` → every suite passes (39): `purchasing-payments-server` **18**, `purchasing-payments-screens` **23**, money 249. `npm run test:sql` → every suite passes (19), including `2a4_payments.pglite.mjs` (47) and `2a4_payments.pglite.mjs --with-0103` (**48**).
- [ ] **Step 3: Stop for the user** to review and commit. Do not push yet (the web's photo link needs 0103 live).

### Task 2: WorkMate — paying on the phone, domain and data

**Interfaces produced:** `PurchasingApi` — `today`, `myCash`, `purchasePayments`, `queuedPayments`, `pay`, `voidPayment`, `reportReturn`, `withdrawReturn`, `dispute`, `discardAction`; `PayState.canRecordPayment`; `PurchasePaymentsView` (`pay`, `queued`); `QueuedState.sent`; `MyPurchasesView.queuedPayments` / `unsentFor` / `sentFor`; `MyCashView` (`figures`, `queuedReturns`, `creditsFor`); `PurchaseDraft` "Paid now?" fields.

<!-- Tests -->

**Create:** `test/purchasing/data/payments_repository_test.dart`

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/attendance/sync/submission_sync.dart' show SyncResult;
import 'package:workmate/purchasing/data/purchasing_api.dart';
import 'package:workmate/purchasing/data/purchasing_db.dart';
import 'package:workmate/purchasing/data/purchasing_repository.dart';
import 'package:workmate/purchasing/domain/pay_models.dart';
import 'package:workmate/purchasing/domain/pur_failure.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';
import 'package:workmate/purchasing/sync/purchasing_sync.dart';

import '../../attendance/fakes.dart';
import '../domain/purchase_draft_test.dart' show unplanned;
import '../purchasing_fakes.dart';

/// 0102 on the phone: later payments and returns are queued and sent once
/// (Q6), "Paid now?" rides with its purchase (Q3), the buyer's own cash is
/// read fresh or from the saved copy, and voids / withdrawals / "I did not
/// receive this" need signal.
void main() {
  late PurchasingDb db;
  late FakePurchasingRemote remote;
  late Directory dir;
  late PurchasingRepository repo;
  late PurchasingSync sync;
  var user = 'u1';
  var ids = 0;
  var kicks = 0;
  var turnedOff = 0;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await PurchasingDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    remote = FakePurchasingRemote();
    dir = await Directory.systemTemp.createTemp('pur-pay');
    user = 'u1';
    ids = 0;
    kicks = 0;
    turnedOff = 0;
    repo = PurchasingRepository(
      db: db,
      remote: remote,
      device: FakeDevice(),
      scheduler: FakeScheduler(),
      currentUserId: () => user,
      companyOf: (_) => 'o1',
      photoDir: () async => dir,
      sendNow: () async => kicks++,
      onBuyingOff: () async => turnedOff++,
      now: () => wednesday,
      newId: () => 'id${++ids}',
    );
    sync = PurchasingSync(db: db, remote: remote, now: () => wednesday);
  });
  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  Future<String> photo(String name) async {
    final f = File('${dir.path}/$name');
    await f.writeAsBytes([1, 2, 3]);
    return f.path;
  }

  final today = repoToday();

  PaymentInput pay({String amount = '300', String source = 'petty_cash', String method = 'gcash', String? creditId, String? paidOn}) =>
      PaymentInput(amount: amount, paidOn: paidOn ?? today, method: method, source: source, creditId: creditId);

  group('"My cash": the buyer\'s own, fresh or saved', () {
    test('read and saved; with no signal the saved copy, saying so', () async {
      remote.creditRows = [{'id': 'c1', 'supplier_id': 's1', 'supplier': 'ZZ Hardware', 'amount': 200, 'left': 80}];
      final fresh = await repo.myCash();
      expect([fresh.cash!.held, fresh.fromCache, fresh.credits.single.left], [1470, false, 80]);
      remote.readError = const SocketException('down');
      final saved = await repo.myCash();
      expect([saved.cash!.held, saved.fromCache, saved.credits.single.left], [1470, true, 80]);
      expect(saved.error, isA<SocketException>());
    });

    test('never read and no signal: nothing to show, and why', () async {
      remote.readError = const SocketException('down');
      final v = await repo.myCash();
      expect([v.cash, v.figures], [null, null]);
      expect(v.error, isA<SocketException>());
    });

    test('BUYER_REQUIRED wipes the saved copy and says buying is off (R26)', () async {
      await repo.myCash();
      remote.readError = Exception('BUYER_REQUIRED');
      await expectLater(repo.myCash(), throwsA(anything));
      expect(turnedOff, 1);
      remote.readError = const SocketException('down');
      expect((await repo.myCash()).cash, isNull, reason: 'the saved copy is gone');
    });

    test('Q16: payments still on the phone lower cash held as shown, never below zero; refused ones do not', () async {
      await repo.myCash();
      remote.readError = const SocketException('down');
      await repo.pay('pu1', pay(amount: '2000'));
      final v = await repo.myCash();
      expect(v.unsentPettyCash, 2000);
      expect(v.figures, (held: 0.0, shortfall: 530.0));
      await repo.pay('pu1', pay(amount: '100', source: 'company'));
      expect((await repo.myCash()).unsentPettyCash, 2000, reason: 'company money is not petty cash');
    });
  });

  group('a later payment (Q6): queued, sent once', () {
    test('refused before queueing where the server would refuse it: nothing queued', () async {
      await expectLater(repo.pay('pu1', pay(paidOn: '2099-01-01')), throwsA(isA<PaymentInvalid>()));
      await expectLater(repo.pay('pu1', pay(amount: '0')), throwsA(isA<PaymentInvalid>()));
      remote.creditRows = [{'id': 'c1', 'supplier_id': 's1', 'left': 80}];
      await repo.myCash();
      await expectLater(
          repo.pay('pu1', pay(source: 'credit', creditId: 'c1', amount: '120')),
          throwsA(isA<PaymentInvalid>().having((e) => e.problems, 'problems', [PayProblem.overCredit])),
          reason: 'what the credit had left when last read');
      expect(await db.ops('u1'), isEmpty);
    });

    test('waiting shows on My purchases and counts in what is left; the proof goes first, under purchases/', () async {
      final proof = await photo('gcash.jpg');
      await repo.pay('pu1', pay(amount: '300'), proofPhoto: proof);
      expect(kicks, 1);
      final mine = await repo.myPurchases();
      expect(mine.queuedPayments.single.state, QueuedState.waiting);
      expect([mine.unsentFor('pu1'), mine.unsentFor('pu2')], [300, 0]);
      expect(await repo.unsentFor('u1'), 1, reason: 'Buying is turned off counts it');

      expect(await sync.drain('u1'), SyncResult.done);
      expect(remote.uploads.single, startsWith('purchases/o1/'));
      expect(remote.uploadKinds, ['purchase']);
      final sent = remote.paid.single;
      expect([sent['op'], sent['purchase_id'], sent['amount'], sent['source'], sent['method']], ['id1', 'pu1', '300.00', 'petty_cash', 'gcash']);
      expect(sent['proof_url'], endsWith(remote.uploads.single));
      expect(sent.containsKey('person_id'), isFalse, reason: 'the server fills in the buyer (R2)');
      expect(await db.ops('u1'), isEmpty);
      expect(File(proof).existsSync(), isFalse, reason: 'the proof is safe to delete only once recorded');
    });

    test('no signal: the uploaded proof is not uploaded again, and the same op id retries', () async {
      await repo.pay('pu1', pay(), proofPhoto: await photo('p.jpg'));
      remote.writeError = const SocketException('down');
      expect(await sync.drain('u1'), SyncResult.retry);
      expect(await sync.drain('u1'), SyncResult.done);
      expect(remote.uploads, hasLength(1));
      expect(remote.calls.where((c) => c.startsWith('pay:')), ['pay:id1:pu1', 'pay:id1:pu1']);
      expect(remote.paid, hasLength(1));
    });

    test('refused: kept as Needs attention with the reason, not counted in what is left; thrown away with its proof', () async {
      final proof = await photo('p.jpg');
      await repo.pay('pu1', pay(), proofPhoto: proof);
      remote.writeError = Exception('BAD_STATE');
      await sync.drain('u1');
      final q = (await repo.myPurchases()).queuedPayments.single;
      expect([q.state, q.failure], [QueuedState.needsAttention, PurFailure.alreadyVoided]);
      expect((await repo.myPurchases()).unsentFor('pu1'), 0);
      expect((await repo.myCash()).unsentPettyCash, 0);
      await repo.discardAction(q.opId);
      expect(await db.ops('u1'), isEmpty);
      expect(File(proof).existsSync(), isFalse);
    });

    test('R38: accepted, the answer lost, then a refresh — counted once, finished on the phone, never sent again', () async {
      final proof = await photo('p.jpg');
      await repo.myCash();
      await repo.pay('pu1', pay(amount: '300'), proofPhoto: proof);
      remote.loseNextAnswer = true;
      expect(await sync.drain('u1'), SyncResult.retry, reason: 'no answer: the phone still holds it');
      expect([remote.paid.length, (await db.ops('u1')).length], [1, 1]);
      // The fresh balance already counts the ₱300 (the server has it).
      final mine = await repo.myPurchases();
      expect([mine.queuedPayments, mine.unsentFor('pu1')], [isEmpty, 0]);
      expect((await repo.myCash()).unsentPettyCash, 0);
      expect(await db.ops('u1'), isEmpty);
      expect(File(proof).existsSync(), isFalse);
      expect(await sync.drain('u1'), SyncResult.done);
      expect(remote.paid, hasLength(1), reason: 'never a second send');
    });

    test('R38: only what the server has is finished; with no signal nothing is', () async {
      await repo.pay('pu1', pay(amount: '100'));
      await repo.pay('pu1', pay(amount: '200'));
      remote.accepted.add('id1');
      final mine = await repo.myPurchases();
      expect([for (final q in mine.queuedPayments) q.opId], ['id2']);
      expect(mine.unsentFor('pu1'), 200);
      remote.accepted.add('id2');
      remote.readError = const SocketException('down');
      expect((await repo.myPurchases()).queuedPayments, hasLength(1), reason: 'no signal: nothing is finished on a guess');
    });

    test('R38: the answer lost, the check finds it, then the list read fails — the saved list still counts it (My purchases)', () async {
      await repo.myPurchases();
      await repo.pay('pu1', pay(amount: '300'));
      remote.loseNextAnswer = true;
      await sync.drain('u1');
      remote.balanceError = const SocketException('down');
      final v = await repo.myPurchases();
      expect([v.fromCache, v.unsentFor('pu1'), v.sentFor('pu1'), v.queuedPayments.single.state], [true, 300, true, QueuedState.sent],
          reason: 'the saved list was read before the payment went');
      expect(await db.ops('u1'), isEmpty, reason: 'marked sent: never sent again');
      expect(await sync.drain('u1'), SyncResult.done);
      expect(remote.paid, hasLength(1));
      remote.balanceError = null;
      final fresh = await repo.myPurchases();
      expect([fresh.fromCache, fresh.queuedPayments, fresh.unsentFor('pu1')], [false, isEmpty, 0], reason: 'the fresh list counts it');
    });

    test('R38: the answer lost, the check finds it, then the cash read fails — the saved cash held still counts it (My cash)', () async {
      await repo.myCash();
      await repo.pay('pu1', pay(amount: '300'));
      remote.loseNextAnswer = true;
      await sync.drain('u1');
      remote.balanceError = const SocketException('down');
      final v = await repo.myCash();
      expect([v.fromCache, v.unsentPettyCash, v.figures!.held], [true, 300, 1170]);
      remote.balanceError = null;
      remote.cash = {...remote.cash, 'recorded': 1170, 'held': 1170};
      final fresh = await repo.myCash();
      expect([fresh.fromCache, fresh.unsentPettyCash, fresh.figures!.held], [false, 0, 1170]);
    });

    test('R38: sent normally, then no signal — each saved copy counts it until that copy is read fresh; then it is forgotten', () async {
      await repo.myPurchases();
      await repo.myCash();
      await repo.pay('pu1', pay(amount: '300'));
      await sync.drain('u1');
      remote.readError = const SocketException('down');
      expect((await repo.myPurchases()).unsentFor('pu1'), 300);
      expect((await repo.myCash()).unsentPettyCash, 300);
      remote.readError = null;
      await repo.myPurchases();
      expect(await db.sentOps('u1'), hasLength(1), reason: 'the saved My cash does not count it yet');
      remote.readError = const SocketException('down');
      expect((await repo.myCash()).unsentPettyCash, 300);
      expect((await repo.myPurchases()).unsentFor('pu1'), 0, reason: 'the saved list now counts it');
      remote.readError = null;
      await repo.myCash();
      expect(await db.sentOps('u1'), isEmpty, reason: 'both copies count it');
      remote.readError = const SocketException('down');
      expect([(await repo.myCash()).unsentPettyCash, (await repo.myPurchases()).unsentFor('pu1')], [0, 0]);
    });

    test('R38: a saved My cash that counts a sent payment never lowers cash held by it again', () async {
      await repo.myPurchases();
      await repo.myCash();
      await repo.pay('pu1', pay(amount: '300'));
      await sync.drain('u1');
      remote.cash = {...remote.cash, 'recorded': 1170, 'held': 1170};
      await repo.myCash();
      expect(await db.sentOps('u1'), hasLength(1), reason: 'the saved list does not count it yet');
      remote.readError = const SocketException('down');
      final v = await repo.myCash();
      expect([v.fromCache, v.unsentPettyCash, v.figures!.held], [true, 0, 1170]);
      expect((await repo.myPurchases()).unsentFor('pu1'), 300);
    });

    test('R38: sent while the cash is being read — read again, so it is counted exactly once', () async {
      await repo.pay('pu1', pay(amount: '300'));
      remote.duringRead = () async {
        await sync.drain('u1');
        remote.cash = {...remote.cash, 'recorded': 1170, 'held': 1170};
      };
      final v = await repo.myCash();
      expect([v.fromCache, v.unsentPettyCash, v.figures!.held], [false, 0, 1170]);
      expect(remote.calls.where((c) => c == 'myCash'), hasLength(2));
    });

    test('R38: still moving after three reads, or no signal for the check after the read — the saved copy, not a guess', () async {
      await repo.myCash();
      remote.duringRead = () async {
        await repo.pay('pu1', pay(amount: '10'));
        await sync.drain('u1');
      };
      final busy = await repo.myCash();
      expect([busy.fromCache, busy.unsentPettyCash, remote.calls.where((c) => c == 'myCash').length], [true, 30, 4]);
      // A payment still waiting, so the check after the read asks the server.
      remote.duringRead = null;
      remote.writeError = const SocketException('no signal');
      remote.writeErrorSticky = true;
      await repo.pay('pu1', pay(amount: '300'));
      await sync.drain('u1');
      remote.duringRead = () async {
        remote.cash = {...remote.cash, 'held': 999};
        remote.opsDoneError = const SocketException('lost');
      };
      final lost = await repo.myCash();
      expect([lost.fromCache, lost.cash!.held], [true, 1470], reason: 'the read cannot be placed: not used');
    });

    test('R38: a purchase\'s payments and what the phone still holds come from one read', () async {
      await repo.myPurchases();
      await repo.myCash();
      await repo.pay('pu1', pay(amount: '100'));
      expect([for (final q in (await repo.purchasePayments('pu1')).queued) q.state], [QueuedState.waiting]);
      remote.duringRead = () => sync.drain('u1');
      final v = await repo.purchasePayments('pu1');
      expect([v.queued, remote.calls.where((c) => c == 'payments:pu1').length], [isEmpty, 3], reason: 'sent during the read: read again');
      remote.duringRead = null;
      remote.readError = const SocketException('down');
      expect([for (final q in await repo.queuedPayments('pu1')) q.state], [QueuedState.sent], reason: 'the saved list does not count it');
      remote.readError = null;
      await repo.myPurchases();
      expect(await db.sentOps('u1'), hasLength(1), reason: 'the saved My cash does not count it yet');
      expect(await repo.queuedPayments('pu1'), isEmpty, reason: 'the saved list counts it now');
    });

    test('a purchase\'s own payments still on the phone (for its detail screen)', () async {
      await repo.pay('pu1', pay(amount: '100'));
      await repo.pay('pu2', pay(amount: '50'));
      expect([for (final q in await repo.queuedPayments('pu1')) q.amount], [100]);
    });

    test('a payment still waiting cannot be thrown away (it may already be recorded)', () async {
      await repo.pay('pu1', pay());
      await repo.discardAction('id1');
      expect(await db.ops('u1'), hasLength(1));
    });
  });

  group('a return of petty cash (Q17): queued, its photo in the private pettyCash/ folder', () {
    test('refused before queueing: no amount, a future day', () async {
      await expectLater(repo.reportReturn(ReturnInput(amount: '', handedOn: today)), throwsA(isA<ReturnInvalid>()));
      await expectLater(repo.reportReturn(const ReturnInput(amount: '100', handedOn: '2099-01-01')), throwsA(isA<ReturnInvalid>()));
      expect(await db.ops('u1'), isEmpty);
    });

    test('waits on "My cash", then is sent with its photo as a petty_cash upload; never lowers cash held itself', () async {
      final ph = await photo('ret.jpg');
      await repo.reportReturn(ReturnInput(amount: '1,000', handedOn: today, handedTo: ' the owner ', note: 'ZZ'), photo: ph);
      final v = await repo.myCash();
      expect([v.queuedReturns.single.amount, v.unsentPettyCash], [1000, 0], reason: 'Q17: only the owner\'s confirmation lowers the balance');
      await sync.drain('u1');
      expect(remote.uploads.single, startsWith('pettyCash/o1/'));
      expect(remote.uploadKinds, ['petty_cash']);
      final r = remote.returned.single;
      expect([r['op'], r['amount'], r['handed_on'], r['handed_to'], r['note']], ['id1', '1000.00', today, 'the owner', 'ZZ']);
      expect(r['photo_url'], endsWith(remote.uploads.single));
      expect((await repo.myCash()).queued, isEmpty);
    });

    test('no photo: sent with none', () async {
      await repo.reportReturn(ReturnInput(amount: '50', handedOn: today));
      await sync.drain('u1');
      expect([remote.uploads, remote.returned.single['photo_url']], [isEmpty, '']);
    });
  });

  group('"Paid now?" rides with its purchase (Q3)', () {
    Future<PurchaseDraft> ready({String paidNow = 'full', String paidFrom = 'petty_cash', String? credit}) async => repo
        .newDraft(lines: [unplanned()])
        .copyWith(receiptTotal: '500', photos: {'supplier_invoice_url': await photo('r.jpg')}, paidNow: paidNow, paidFrom: paidFrom, paidCredit: credit);

    test('one pur_record with the payment inside it; its petty cash counts on "My cash" until sent', () async {
      await repo.myCash();
      remote.readError = const SocketException('down');
      await repo.send(await ready());
      expect((await repo.myCash()).unsentPettyCash, 500);
      remote.readError = null;
      await sync.drain('u1');
      expect(remote.recorded.single['payments'], [
        {'amount': '500.00', 'paid_on': '2026-10-21', 'source': 'petty_cash', 'method': 'cash', 'note': ''},
      ]);
      expect(remote.paid, isEmpty, reason: 'never a second call: both or neither');
    });

    test('petty cash from an account this phone knows is not a staff buyer: refused before sending (R2)', () async {
      remote.cash = {'holder': false};
      await repo.myCash();
      await expectLater(repo.send(await ready()),
          throwsA(isA<PurchaseInvalid>().having((e) => e.problems.map((p) => p.kind), 'kinds', [ProblemKind.personRequired])));
    });

    test('a credit: never more than it had left when last read (R10)', () async {
      remote.creditRows = [{'id': 'c1', 'supplier_id': 's1', 'left': 80}];
      await repo.myCash();
      await expectLater(repo.send(await ready(paidFrom: 'credit', credit: 'c1')),
          throwsA(isA<PurchaseInvalid>().having((e) => e.problems.map((p) => p.kind), 'kinds', [ProblemKind.overCredit])));
    });

    test('never read: petty cash is sent, and the server decides', () async {
      await repo.send(await ready());
      expect(await db.ops('u1'), hasLength(1));
    });
  });

  group('online only: voiding a payment, withdrawing a return, "I did not receive this"', () {
    test('a void needs a reason; each sends its form\'s op id', () async {
      await expectLater(repo.voidPayment('p1', '  ', opId: 'op1'), throwsA(isA<PurFailureException>()));
      await repo.voidPayment('p1', ' paid twice ', opId: 'op1');
      await repo.withdrawReturn('r1', opId: 'op2');
      await repo.dispute('i1', ' never got it ', opId: 'op3');
      expect(remote.calls.where((c) => !c.startsWith('my')),
          ['voidPayment:op1:p1:paid twice', 'withdraw:op2:r1', 'dispute:op3:i1:never got it']);
    });

    test('BUYER_REQUIRED on any of them turns buying off (R26)', () async {
      remote.writeError = Exception('BUYER_REQUIRED');
      await expectLater(repo.dispute('i1', 'x', opId: 'op1'), throwsA(anything));
      expect(turnedOff, 1);
    });

    test('a purchase\'s payments, read online', () async {
      remote.payments = {
        'pay': {'state': 'partial', 'tracked': true, 'due': 1000, 'paid': 300, 'balance': 700},
        'payments': [{'id': 'p1', 'amount': 300, 'source': 'petty_cash', 'can_void': true}],
        'open_credits': [], 'me': {'holder': true, 'own_money': true, 'cash_held': 700},
      };
      final pp = (await repo.purchasePayments('pu1')).pay;
      expect([pp.pay.balance, pp.payments.single.canVoid, pp.ownMoney, pp.cashHeld], [700, true, true, 700]);
    });
  });

  test('only the signed-in account\'s payments and returns are sent', () async {
    await repo.pay('pu1', pay());
    user = 'u2';
    await repo.reportReturn(ReturnInput(amount: '10', handedOn: today));
    await sync.drain('u1');
    expect([remote.paid.length, remote.returned.length], [1, 0]);
    await sync.drain('u2');
    expect(remote.returned.length, 1);
  });
}

/// Manila's date at the harness's [wednesday] — what [PurchasingRepository.today] answers.
String repoToday() => '2026-10-21';
```

**Modify:** `test/purchasing/data/purchasing_db_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/purchasing/data/purchasing_db_test.dart b/test/purchasing/data/purchasing_db_test.dart
index a1a37ae..965c4da 100644
--- a/test/purchasing/data/purchasing_db_test.dart
+++ b/test/purchasing/data/purchasing_db_test.dart
@@ -1,3 +1,5 @@
+import 'dart:io';
+
 import 'package:flutter_test/flutter_test.dart';
 import 'package:sqflite_common_ffi/sqflite_ffi.dart';
 import 'package:workmate/purchasing/data/purchasing_db.dart';
@@ -50,11 +52,65 @@ void main() {
     expect(await db.unsentCount('u1'), 0);
   });
 
-  test('recorded: op and draft go together', () async {
+  test('R38: sent — never sent again and no longer waiting, but kept with its draft until forgotten', () async {
     await db.queueDraft('u1', d('d1'), op('o1', 'd1'), now);
-    await db.finishRecord('o1', 'd1');
-    expect(await db.ops('u1'), isEmpty);
-    expect(await db.drafts('u1', queued: true), isEmpty);
+    await db.markSent('o1', 'd1', now);
+    expect([await db.ops('u1'), await db.sendable('u1'), await db.drafts('u1', queued: true)], [isEmpty, isEmpty, isEmpty]);
+    expect([await db.hasAnySendable(), await db.unsentCount('u1')], [false, 0]);
+    expect([for (final o in await db.sentOps('u1')) '${o.opId} ${o.sent}'], ['o1 true']);
+    expect((await db.sentDrafts('u1')).map((x) => x.id), ['d1']);
+    // Never back to editing, thrown away, rewritten or queued again.
+    expect(await db.unqueueDraft('u1', 'd1'), isFalse);
+    expect(await db.discardRefused('u1', 'd1'), isNull);
+    await db.saveDraft('u1', d('d1'), now);
+    expect(await db.drafts('u1', queued: false), isEmpty);
+    expect(await db.queueDraft('u1', d('d1'), op('o9', 'd1'), now), isFalse);
+    await db.forgetSent('u2', ['o1']);
+    expect(await db.sentOps('u1'), hasLength(1), reason: 'only its own account forgets it');
+    await db.forgetSent('u1', ['o1']);
+    expect([await db.sentOps('u1'), await db.sentDrafts('u1')], [isEmpty, isEmpty]);
+  });
+
+  test('R38: forgetting never touches an op not sent yet', () async {
+    await db.queueDraft('u1', d('d1'), op('o1', 'd1'), now);
+    await db.forgetSent('u1', ['o1']);
+    expect((await db.sendable('u1')).single.opId, 'o1');
+    expect((await db.drafts('u1', queued: true)).single.id, 'd1');
+  });
+
+  test('R38: a saved copy keeps which sent ops it counts', () async {
+    await db.putCache('u1', 'my_cash', const {'held': 1}, now, covers: ['o1', 'o2']);
+    expect((await db.cache('u1', 'my_cash'))!.covers, {'o1', 'o2'});
+    await db.putCache('u1', 'my_cash', const {'held': 2}, now);
+    expect((await db.cache('u1', 'my_cash'))!.covers, isEmpty);
+  });
+
+  test('a 0.7.1 database (version 1) is upgraded in place: its queue and saved copies kept', () async {
+    final dir = await Directory.systemTemp.createTemp('pur-db-v1');
+    final path = '${dir.path}/p.db';
+    final v1 = await databaseFactoryFfi.openDatabase(path,
+        options: OpenDatabaseOptions(
+          version: 1,
+          onCreate: (x, _) async {
+            await x.execute('create table pur_draft (id text primary key, user_id text not null, body text not null, '
+                'queued integer not null default 0, created_at integer not null, updated_at integer not null)');
+            await x.execute('create table pur_op (op_id text primary key, user_id text not null, kind text not null, draft_id text, '
+                'body text not null, seq integer not null, attempts integer not null default 0, last_error text, '
+                'failed_permanently integer not null default 0, created_at integer not null)');
+            await x.execute('create table pur_cache (user_id text not null, name text not null, body text not null, '
+                'fetched_at integer not null, primary key (user_id, name))');
+          },
+        ));
+    await v1.insert('pur_op', {...op('o1', 'd1').toMap(), 'seq': 1});
+    await v1.insert('pur_cache', {'user_id': 'u1', 'name': 'my_purchases', 'body': '[]', 'fetched_at': 0});
+    await v1.close();
+    final up = await PurchasingDb.open(databaseFactoryFfi, path, singleInstance: false);
+    expect((await up.sendable('u1')).single.opId, 'o1');
+    expect((await up.cache('u1', 'my_purchases'))!.covers, isEmpty);
+    await up.markSent('o1', 'd1', now);
+    expect((await up.sentOps('u1')).single.sent, isTrue);
+    await up.close();
+    await dir.delete(recursive: true);
   });
 
   test('progress is kept between attempts', () async {
```

**Create:** `test/purchasing/domain/pay_models_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/domain/pay_models.dart';
import 'package:workmate/purchasing/domain/pur_failure.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';

PurchaseDraft draft({String paidNow = 'none', String paidAmount = '', String paidFrom = 'company', String? paidCredit, String total = '1250'}) =>
    PurchaseDraft(
      id: 'd1',
      createdAt: DateTime.utc(2026, 10, 23, 2),
      purchaseDate: '2026-10-23',
      supplierName: 'ZZ Hardware',
      receiptTotal: total,
      lines: const [
        DraftPurchaseLine(key: 'k1', itemName: 'ZZ cement', quantity: '1', unit: 'bag', amount: '1250', folderId: 'f1', unplannedReason: 'ZZ'),
      ],
      photos: const {'supplier_invoice_url': '/p/a.jpg'},
      paidNow: paidNow,
      paidAmount: paidAmount,
      paidFrom: paidFrom,
      paidMethod: 'gcash',
      paidCredit: paidCredit,
    );

void main() {
  group('the server\'s answers as the phone reads them', () {
    test('pay state: numbers as numbers or text; absent = not tracked (Q2)', () {
      final s = PayState.fromJson({'state': 'partial', 'tracked': true, 'due': '1000', 'paid': 300, 'balance': '700.00', 'excess': 0, 'unresolved': 0});
      expect([s.state, s.tracked, s.due, s.paid, s.balance], ['partial', true, 1000, 300, 700]);
      expect(const PayState().state, 'not_tracked');
      expect(PayState.fromJson(null).tracked, isFalse);
      expect(PayState.fromJson(s.toJson()).balance, 700, reason: 'kept for offline as it came');
    });

    test('Q6: what is left counts payments still on the phone, never below zero', () {
      const s = PayState(state: 'partial', tracked: true, due: 1000, paid: 300, balance: 700);
      expect(s.leftAfter(0), 700);
      expect(s.leftAfter(200), 500);
      expect(s.leftAfter(900), 0);
      expect(const PayState(state: 'void_paid').payable, isFalse, reason: 'R12: no new payment on a voided purchase');
      expect([const PayState(state: 'not_tracked').canRecordPayment, s.canRecordPayment, const PayState(state: 'void_paid', tracked: true).canRecordPayment],
          [false, true, false], reason: 'R34: tracked and not voided — the same rule on every screen');
      expect(const PayState(state: 'overpaid').payable, isTrue);
    });

    test('a payment: carried over, own money to review, rejected, void', () {
      final p = PurPayment.fromJson({
        'id': 'p1', 'amount': '200', 'paid_on': '2026-10-23', 'method': 'cash', 'source': 'own_money', 'authorized': false,
        'accepted_at': null, 'rejected_at': null, 'moved': true, 'can_void': true,
      });
      expect([p.toReview, p.moved, p.canVoid, p.voided], [true, true, true, false]);
      expect(PurPayment.fromJson({'id': 'p2', 'source': 'own_money', 'authorized': false, 'rejected_at': '2026-10-23T01:00:00Z'}).toReview, isFalse,
          reason: 'R9: a rejected claim is decided');
      expect(PurPayment.fromJson({'id': 'p3', 'source': 'own_money'}).authorized, isTrue, reason: 'missing = authorized (switch on)');
    });

    test('My cash: the buyer\'s own, with the return photo (0103) and the flags', () {
      final c = MyCash.fromJson({
        'holder': true, 'recorded': '-530', 'held': 0, 'shortfall': 530, 'pending_returns': '1000', 'owes': 50, 'owes_to_review': 100,
        'own_money': false,
        'issues': [
          {'id': 'i1', 'amount': 4500, 'issued_on': '2026-10-22', 'disputed_at': '2026-10-23T00:36:00Z', 'dispute_cleared_at': null},
          {'id': 'i2', 'amount': 500, 'issued_on': '2026-10-22', 'voided_at': '2026-10-23T01:12:00Z'},
          {'id': 'i3', 'amount': 100, 'issued_on': '2026-10-23'},
        ],
        'returns': [
          {'id': 'r1', 'amount': 1000, 'handed_on': '2026-10-23', 'status': 'reported', 'photo_url': 'https://x/pettyCash/a.jpg'},
        ],
        'repayments': [{'id': 'x1', 'amount': 150, 'paid_on': '2026-10-23', 'method': 'cash'}],
      });
      expect([c.holder, c.recorded, c.held, c.shortfall, c.pendingReturns, c.owes, c.owesToReview, c.ownMoney],
          [true, -530, 0, 530, 1000, 50, 100, false]);
      expect([for (final i in c.issues) (i.flagged, i.canDispute)], [(true, false), (false, false), (false, true)],
          reason: 'Q14: one flag per entry; a voided entry is settled');
      expect([c.returns.single.waiting, c.returns.single.photoUrl], [true, 'https://x/pettyCash/a.jpg']);
      expect(c.repayments.single.amount, 150);
      expect(MyCash.fromJson({'holder': false}).holder, isFalse, reason: 'an owner account holds no petty cash (R2)');
    });

    test('supplier credits: usable only when not voided and something is left (Q11)', () {
      final c = SupplierCredit.fromJson({'id': 'c1', 'supplier_id': 's1', 'supplier': 'ZZ Hardware', 'amount': 200, 'left': '80'});
      expect([c.usable, c.left], [true, 80]);
      expect(SupplierCredit.fromJson({'id': 'c2', 'left': 0}).usable, isFalse);
      expect(SupplierCredit.fromJson({'id': 'c3', 'left': 50, 'voided_at': '2026-10-23'}).usable, isFalse);
      expect(SupplierCredit.fromJson(c.toJson()).left, 80, reason: 'kept for offline');
    });

    test('a My purchases row carries its payment state (0102) and its listed supplier (0103)', () {
      final row = MyPurchase.fromJson({
        'id': 'u1', 'status': 'recorded', 'supplier': 'ZZ Hardware', 'supplier_id': 's1', 'receipt_total': 1000,
        'pay': {'state': 'partial', 'tracked': true, 'due': 1000, 'paid': 300, 'balance': 700},
      });
      expect([row.supplierId, row.pay.state, row.pay.balance], ['s1', 'partial', 700]);
      final old = MyPurchase.fromJson({'id': 'u2', 'status': 'recorded'});
      expect([old.supplierId, old.pay.state], [null, 'not_tracked'], reason: 'a saved copy from before 0102/0103 still reads');
    });

    test('a purchase\'s payments with what this account may use', () {
      final pp = PurchasePayments.fromJson({
        'pay': {'state': 'unpaid', 'tracked': true, 'due': 500, 'balance': 500},
        'supplier_id': 's1',
        'payments': [{'id': 'p1', 'amount': 100, 'voided_at': '2026-10-23'}],
        'open_credits': [{'id': 'c1', 'left': 80}],
        'me': {'holder': true, 'own_money': true, 'cash_held': '-20'},
      });
      expect([pp.pay.balance, pp.supplierId, pp.payments.single.voided, pp.openCredits.single.left, pp.holder, pp.ownMoney, pp.cashHeld],
          [500, 's1', true, 80, true, true, -20]);
    });
  });

  group('Q16: cash held is never below zero; overspending warns, never refuses', () {
    test('payments still on the phone lower it; the rest is the shortfall', () {
      const c = MyCash(holder: true, recorded: 1470);
      expect(cashAfter(c), (held: 1470.0, shortfall: 0.0));
      expect(cashAfter(c, unsentPettyCash: 2000), (held: 0.0, shortfall: 530.0));
    });
    test('the warning names what is over; nothing to warn about = null', () {
      expect(overspendBy('2000', 1470), 530);
      expect(overspendBy('100', -530), 100, reason: 'a shortfall holds ₱0');
      expect(overspendBy('1470', 1470), isNull);
      expect(overspendBy('1470.01', 1470), 0.01, reason: 'a centavo over is over');
      expect(overspendBy('', 100), isNull);
      expect(overspendBy('500', null), isNull, reason: 'unknown balance: no warning');
    });
  });

  group('a payment is refused before sending exactly where the server would refuse it', () {
    const today = '2026-10-23';
    PaymentInput pay({String amount = '300', String paidOn = today, String method = 'gcash', String source = 'company', String? creditId}) =>
        PaymentInput(amount: amount, paidOn: paidOn, method: method, source: source, creditId: creditId);

    test('amount, date (Manila today, from 2020), source, method', () {
      expect(paymentProblems(pay(), today: today), isEmpty);
      expect(paymentProblems(pay(amount: '0'), today: today), [PayProblem.badAmount]);
      expect(paymentProblems(pay(amount: '1.005'), today: today), [PayProblem.badAmount], reason: 'two decimals at most');
      expect(paymentProblems(pay(paidOn: '2026-10-24'), today: today), [PayProblem.badDate], reason: 'never in the future');
      expect(paymentProblems(pay(paidOn: '2019-12-31'), today: today), [PayProblem.badDate]);
      expect(paymentProblems(pay(paidOn: '23/10/2026'), today: today), [PayProblem.badDate]);
      expect(paymentProblems(pay(source: 'loan'), today: today), [PayProblem.badSource]);
      expect(paymentProblems(pay(method: 'barter'), today: today), [PayProblem.badMethod]);
    });

    test('a supplier credit: one must be chosen; never more than it has left', () {
      expect(paymentProblems(pay(source: 'credit', method: 'barter'), today: today), [PayProblem.creditRequired],
          reason: 'a credit is not cash: no method is checked');
      expect(paymentProblems(pay(source: 'credit', creditId: 'c1', amount: '120'), today: today, creditLeft: 80), [PayProblem.overCredit]);
      expect(paymentProblems(pay(source: 'credit', creditId: 'c1', amount: '80'), today: today, creditLeft: 80), isEmpty);
      expect(paymentProblems(pay(source: 'credit', creditId: 'c1', amount: '500'), today: today), isEmpty, reason: 'unknown left: the server checks');
    });

    test('the body: two decimals as text; a credit is "other" with its id; no person (the server fills in the buyer); proof only when given', () {
      expect(paymentBody(pay(amount: '1,250.5')),
          {'amount': '1250.50', 'paid_on': today, 'source': 'company', 'method': 'gcash', 'note': ''});
      final c = paymentBody(pay(source: 'credit', creditId: 'c1', method: 'cash'));
      expect([c['method'], c['credit_id'], c.containsKey('person_id')], ['other', 'c1', false]);
      final petty = paymentBody(const PaymentInput(amount: '700', paidOn: today, source: 'petty_cash', proofUrl: 'https://x/p.jpg', note: ' slip '));
      expect([petty['source'], petty['method'], petty.containsKey('person_id'), petty['proof_url'], petty['note']],
          ['petty_cash', 'cash', false, 'https://x/p.jpg', 'slip']);
      expect(PaymentInput.fromJson(pay(source: 'credit', creditId: 'c1').toJson()).creditId, 'c1', reason: 'kept on the phone as typed');
    });

    test('the purchase form\'s "Paid by" word becomes a payment method', () {
      expect([methodOf('GCash'), methodOf('Bank transfer'), methodOf('On account'), methodOf('')], ['gcash', 'bank_transfer', 'cash', 'cash']);
    });
  });

  group('Q3 "Paid now?": sent with the purchase, in the same transaction', () {
    test('Not paid yet sends no payment; older drafts on the phone read Not paid yet', () {
      expect(paidNowPayment(draft()), isNull);
      expect(purchaseBody(draft()).containsKey('payments'), isFalse);
      final old = draft().toJson()..removeWhere((k, _) => k.startsWith('paid_'));
      expect(PurchaseDraft.fromJson(old).paidNow, 'none');
    });

    test('Paid in full sends the receipt total, dated the purchase\'s own day', () {
      final body = purchaseBody(draft(paidNow: 'full', paidFrom: 'petty_cash'));
      expect(body['payments'], [
        {'amount': '1250.00', 'paid_on': '2026-10-23', 'source': 'petty_cash', 'method': 'gcash', 'note': ''},
      ]);
    });

    test('Paid part: the typed amount, less than the total', () {
      expect((purchaseBody(draft(paidNow: 'part', paidAmount: '300'))['payments'] as List).single['amount'], '300.00');
      expect(paidNowProblems(draft(paidNow: 'part', paidAmount: '1250'), holder: true).map((p) => p.kind), [ProblemKind.partNotLess]);
      expect(paidNowProblems(draft(paidNow: 'part', paidAmount: ''), holder: true).map((p) => p.kind), [ProblemKind.paidAmount]);
    });

    test('petty cash and own money need a staff buyer (R2); a credit needs one chosen, within what is left (R10)', () {
      expect(paidNowProblems(draft(paidNow: 'full', paidFrom: 'own_money'), holder: false).map((p) => p.kind), [ProblemKind.personRequired]);
      expect(paidNowProblems(draft(paidNow: 'full', paidFrom: 'petty_cash'), holder: true), isEmpty);
      expect(paidNowProblems(draft(paidNow: 'full', paidFrom: 'credit'), holder: true).map((p) => p.kind), [ProblemKind.creditRequired]);
      expect(paidNowProblems(draft(paidNow: 'full', paidFrom: 'credit', paidCredit: 'c1'), holder: true, creditLeft: 80).map((p) => p.kind),
          [ProblemKind.overCredit]);
      final credit = (purchaseBody(draft(paidNow: 'part', paidAmount: '50', paidFrom: 'credit', paidCredit: 'c1'))['payments'] as List).single;
      expect([credit['source'], credit['credit_id'], credit['method']], ['credit', 'c1', 'other']);
      expect(paidNowProblems(draft(), holder: false), isEmpty, reason: 'Not paid yet asks nothing');
    });

    test('the draft keeps "Paid now?" as typed', () {
      final d = PurchaseDraft.fromJson(draft(paidNow: 'part', paidAmount: '300', paidFrom: 'credit', paidCredit: 'c1').toJson());
      expect([d.paidNow, d.paidAmount, d.paidFrom, d.paidMethod, d.paidCredit], ['part', '300', 'credit', 'gcash', 'c1']);
      expect(d.copyWith(paidCredit: null).paidCredit, isNull);
      expect(d.copyWith(paidNow: 'full').paidCredit, 'c1');
    });
  });

  group('every 0102 refusal a buyer can meet says what to do', () {
    test('whole codes only: BAD_PAY_SOURCE is not BAD_PAY, PERSON_NOT_ALLOWED is not NOT_ALLOWED', () {
      expect(PurFailure.of(Exception('BAD_PAY_SOURCE')), PurFailure.invalid);
      expect(PurFailure.of(Exception('PERSON_NOT_ALLOWED')), PurFailure.notAHolder);
      expect(PurFailure.of(Exception('NOT_ALLOWED')), PurFailure.buyingOff);
      expect(PurFailure.of(Exception('OVER_CREDIT')), PurFailure.overCredit);
      expect(PurFailure.of(Exception('CREDIT_GONE')), PurFailure.creditGone);
      expect(PurFailure.of(Exception('CREDIT_SUPPLIER')), PurFailure.creditSupplier);
      expect(PurFailure.of(Exception('RESOLVED_FIRST')), PurFailure.resolvedFirst);
      expect(PurFailure.of(Exception('NOT_YOURS')), PurFailure.notYours);
      expect(PurFailure.of(Exception('ALREADY_DISPUTED')), PurFailure.alreadyDisputed);
      expect(PurFailure.of(Exception('NOT_A_BUYER')), PurFailure.notAHolder);
      expect(PurFailure.of(Exception('BAD_STATE')), PurFailure.alreadyVoided, reason: 'a payment on a voided purchase (R12)');
    });
    test('none of them is retried: the content would be refused again', () {
      for (final f in [PurFailure.overCredit, PurFailure.creditGone, PurFailure.creditSupplier, PurFailure.resolvedFirst, PurFailure.notYours,
          PurFailure.alreadyDisputed, PurFailure.notAHolder]) {
        expect(f.retryable, isFalse, reason: f.name);
        expect(purFailureCopy(f).english, isNotEmpty);
        expect(purFailureCopy(f).tagalog, isNotEmpty);
      }
    });
  });
}
```

**Modify:** `test/purchasing/purchasing_api_fake.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/purchasing/purchasing_api_fake.dart b/test/purchasing/purchasing_api_fake.dart
index 22eb1c4..1f61c1e 100644
--- a/test/purchasing/purchasing_api_fake.dart
+++ b/test/purchasing/purchasing_api_fake.dart
@@ -1,6 +1,8 @@
+import 'dart:async';
 import 'dart:typed_data';
 
 import 'package:workmate/purchasing/data/purchasing_api.dart';
+import 'package:workmate/purchasing/domain/pay_models.dart';
 import 'package:workmate/purchasing/domain/pur_models.dart';
 import 'package:workmate/purchasing/domain/purchase_draft.dart';
 
@@ -23,6 +25,17 @@ class FakePurchasingApi implements PurchasingApi {
   Object? error;
   Object? keepError;
 
+  // 0102: the buyer's cash and one purchase's payments, as the test sets them.
+  MyCashView cash = const MyCashView(cash: MyCash(holder: true, recorded: 1470, held: 1470));
+  PurchasePayments payments = const PurchasePayments(pay: PayState(state: 'unpaid', tracked: true, due: 1000, balance: 1000), holder: true);
+  String todayIs = '2026-10-21';
+  List<QueuedCashAction> queuedFor = const [];
+
+  /// While set, pay and reportReturn wait for it (a slow Save).
+  Completer<void>? saveGate;
+  final paid = <(String, PaymentInput, String?)>[];
+  final returned = <(ReturnInput, String?)>[];
+
   final calls = <String>[];
   final sent = <PurchaseDraft>[];
   final saved = <PurchaseDraft>[];
@@ -143,6 +156,70 @@ class FakePurchasingApi implements PurchasingApi {
   @override
   Future<int> unsentFor(String userId) async => 0;
 
+  @override
+  String today() => todayIs;
+
+  @override
+  Future<MyCashView> myCash() async {
+    calls.add('myCash');
+    _maybeFail();
+    return cash;
+  }
+
+  /// Thrown by every purchasePayments read while set (the purchase itself still reads).
+  Object? paymentsError;
+
+  @override
+  Future<PurchasePaymentsView> purchasePayments(String purchaseId) async {
+    calls.add('payments:$purchaseId');
+    final e = paymentsError;
+    if (e != null) throw e;
+    _maybeFail();
+    return PurchasePaymentsView(pay: payments, queued: [for (final q in queuedFor) if (q.purchaseId == purchaseId) q]);
+  }
+
+  @override
+  Future<List<QueuedCashAction>> queuedPayments(String purchaseId) async => [for (final q in queuedFor) if (q.purchaseId == purchaseId) q];
+
+  @override
+  Future<void> pay(String purchaseId, PaymentInput payment, {String? proofPhoto}) async {
+    final problems = paymentProblems(payment, today: todayIs);
+    if (problems.isNotEmpty) throw PaymentInvalid(problems);
+    await saveGate?.future;
+    _maybeFail();
+    paid.add((purchaseId, payment, proofPhoto));
+  }
+
+  @override
+  Future<void> voidPayment(String paymentId, String reason, {required String opId}) async {
+    calls.add('voidPayment:$paymentId:$reason');
+    _maybeFail();
+  }
+
+  @override
+  Future<void> reportReturn(ReturnInput r, {String? photo}) async {
+    final problems = returnProblems(r, today: todayIs);
+    if (problems.isNotEmpty) throw ReturnInvalid(problems);
+    await saveGate?.future;
+    _maybeFail();
+    returned.add((r, photo));
+  }
+
+  @override
+  Future<void> withdrawReturn(String returnId, {required String opId}) async {
+    calls.add('withdraw:$returnId');
+    _maybeFail();
+  }
+
+  @override
+  Future<void> dispute(String issueId, String note, {required String opId}) async {
+    calls.add('dispute:$issueId:$note');
+    _maybeFail();
+  }
+
+  @override
+  Future<void> discardAction(String opId) async => calls.add('discardAction:$opId');
+
   @override
   Future<void> keepOnly(String userId) async {
     calls.add('keepOnly:$userId');
```

**Modify:** `test/purchasing/purchasing_fakes.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/purchasing/purchasing_fakes.dart b/test/purchasing/purchasing_fakes.dart
index 9ed1194..6252ef2 100644
--- a/test/purchasing/purchasing_fakes.dart
+++ b/test/purchasing/purchasing_fakes.dart
@@ -1,3 +1,4 @@
+import 'dart:io';
 import 'dart:typed_data';
 
 import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
@@ -66,13 +67,51 @@ class FakePurchasingRemote implements PurchasingRemote {
 
   final calls = <String>[];
   final uploads = <String>[];
+
+  /// The ledger kind of each upload, in order (0102: 'petty_cash' for a return's photo).
+  final uploadKinds = <String>[];
   final recorded = <Map<String, dynamic>>[];
   final recordOps = <String>[];
 
+  // 0102: the buyer's cash, the company's credits, one purchase's payments.
+  Map<String, dynamic> cash = {'holder': true, 'recorded': 1470, 'held': 1470, 'shortfall': 0, 'pending_returns': 0, 'owes': 0,
+    'owes_to_review': 0, 'own_money': false, 'issues': [], 'returns': [], 'repayments': []};
+  List<Map<String, dynamic>> creditRows = [];
+  Map<String, dynamic> payments = {'pay': {'state': 'unpaid', 'tracked': true, 'due': 1000, 'balance': 1000}, 'payments': [], 'open_credits': [],
+    'me': {'holder': true, 'own_money': false, 'cash_held': 1470}};
+
+  /// Op ids the server has accepted (pur_my_ops_done answers from these).
+  final accepted = <String>{};
+
+  /// The next pur_pay is accepted but its answer is lost on the way back.
+  bool loseNextAnswer = false;
+
+  /// Thrown by the balance reads only (My purchases, My cash, credits, one
+  /// purchase's payments) while set; pur_my_ops_done still answers (R38).
+  Object? balanceError;
+
+  /// Run inside every balance read while set, before it answers: something
+  /// that happens while the read is under way (the background send).
+  Future<void> Function()? duringRead;
+
+  /// Thrown by pur_my_ops_done only, while set.
+  Object? opsDoneError;
+
+  /// pur_pay / pur_cash_report_return bodies, in order, with their op ids.
+  final paid = <Map<String, dynamic>>[];
+  final returned = <Map<String, dynamic>>[];
+
   void _read() {
     if (readError != null) throw readError!;
   }
 
+  Future<void> _balance() async {
+    _read();
+    if (balanceError != null) throw balanceError!;
+    final f = duringRead;
+    if (f != null) await f();
+  }
+
   void _write() {
     final e = writeError;
     if (e == null) return;
@@ -127,7 +166,7 @@ class FakePurchasingRemote implements PurchasingRemote {
 
   @override
   Future<List<Map<String, dynamic>>> myPurchases() async {
-    _read();
+    await _balance();
     return mine;
   }
 
@@ -142,6 +181,7 @@ class FakePurchasingRemote implements PurchasingRemote {
     calls.add('record:$opId');
     _write();
     recordOps.add(opId);
+    accepted.add(opId);
     recorded.add(body);
     return {'purchase_id': 'pu${recorded.length}'};
   }
@@ -164,16 +204,91 @@ class FakePurchasingRemote implements PurchasingRemote {
   }
 
   @override
-  Future<String> uploadReceipt({required String path, required String localPath, required String companyId, required String userId}) async {
+  Future<String> uploadReceipt(
+      {required String path, required String localPath, required String companyId, required String userId, String kind = 'purchase'}) async {
     final e = uploadError;
     if (e != null) {
       uploadError = null;
       throw e;
     }
     uploads.add(path);
+    uploadKinds.add(kind);
     return 'https://x.supabase.co/storage/v1/object/public/uploads/$path';
   }
 
+  @override
+  Future<Map<String, dynamic>> myCash() async {
+    await _balance();
+    calls.add('myCash');
+    return cash;
+  }
+
+  @override
+  Future<List<Map<String, dynamic>>> credits() async {
+    _read();
+    if (balanceError != null) throw balanceError!;
+    return creditRows;
+  }
+
+  @override
+  Future<List<String>> opsDone(List<String> opIds) async {
+    _read();
+    if (opsDoneError != null) throw opsDoneError!;
+    calls.add('opsDone:${opIds.length}');
+    return [for (final id in opIds) if (accepted.contains(id)) id];
+  }
+
+  @override
+  Future<Map<String, dynamic>> purchasePayments(String purchaseId) async {
+    await _balance();
+    calls.add('payments:$purchaseId');
+    return payments;
+  }
+
+  @override
+  Future<Map<String, dynamic>> pay(String opId, String purchaseId, Map<String, dynamic> payment, {required String userId}) async {
+    calls.add('pay:$opId:$purchaseId');
+    _write();
+    if (accepted.contains(opId)) return {'payment_id': 'replayed', 'replayed': true};
+    paid.add({'op': opId, 'purchase_id': purchaseId, ...payment});
+    accepted.add(opId);
+    if (loseNextAnswer) {
+      loseNextAnswer = false;
+      throw const SocketException('the answer was lost');
+    }
+    return {'payment_id': 'pay${paid.length}'};
+  }
+
+  @override
+  Future<Map<String, dynamic>> voidPayment(String opId, String paymentId, String reason, {required String userId}) async {
+    calls.add('voidPayment:$opId:$paymentId:$reason');
+    _write();
+    return {'payment_id': paymentId};
+  }
+
+  @override
+  Future<Map<String, dynamic>> reportReturn(String opId, Map<String, dynamic> body, String photoUrl, {required String userId}) async {
+    calls.add('return:$opId');
+    _write();
+    returned.add({'op': opId, ...body, 'photo_url': photoUrl});
+    accepted.add(opId);
+    return {'return_id': 'r${returned.length}'};
+  }
+
+  @override
+  Future<Map<String, dynamic>> withdrawReturn(String opId, String returnId, {required String userId}) async {
+    calls.add('withdraw:$opId:$returnId');
+    _write();
+    return {'return_id': returnId};
+  }
+
+  @override
+  Future<Map<String, dynamic>> dispute(String opId, String issueId, String note, {required String userId}) async {
+    calls.add('dispute:$opId:$issueId:$note');
+    _write();
+    return {'issue_id': issueId};
+  }
+
   @override
   Future<Uint8List?> receipt(String url) async {
     calls.add('receipt:$url');
```

<!-- Code -->

**Modify:** `lib/purchasing/data/purchasing_api.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/data/purchasing_api.dart b/lib/purchasing/data/purchasing_api.dart
index 548e956..442fd3d 100644
--- a/lib/purchasing/data/purchasing_api.dart
+++ b/lib/purchasing/data/purchasing_api.dart
@@ -1,7 +1,9 @@
 import 'dart:typed_data';
 
+import '../domain/pay_models.dart';
 import '../domain/pur_failure.dart';
 import '../domain/pur_models.dart';
+import '../domain/pur_op.dart';
 import '../domain/purchase_draft.dart';
 
 /// The shopping list as last read: fresh when online, the saved copy offline.
@@ -31,6 +33,10 @@ enum QueuedState {
   /// The server refused it; it stays here with the reason until the buyer
   /// fixes it or throws it away (Q7). Never silently dropped.
   needsAttention,
+
+  /// R38: the server has it, but the list shown was read before it went
+  /// (a saved copy, offline). Shown and counted until a fresh read counts it.
+  sent,
 }
 
 /// A purchase recorded on the phone that the server does not have yet.
@@ -41,14 +47,105 @@ class QueuedPurchase {
   final PurFailure? failure;
 }
 
+/// A payment or a return recorded on the phone that the server does not have
+/// yet (0102, Q6): "Waiting to send", or refused ("Needs attention").
+class QueuedCashAction {
+  const QueuedCashAction({required this.opId, required this.kind, required this.body, required this.state, this.failure});
+
+  final String opId;
+
+  /// [opPay] or [opCashReturn].
+  final String kind;
+
+  /// pay: {purchase_id, payment}; cash_return: {amount, handed_on, handed_to, note}.
+  final Map<String, dynamic> body;
+  final QueuedState state;
+  final PurFailure? failure;
+
+  bool get isPayment => kind == opPay;
+  String? get purchaseId => isPayment ? body['purchase_id'] as String? : null;
+  Map<String, dynamic> get _payment => Map<String, dynamic>.from((body['payment'] as Map?) ?? const {});
+  String get source => isPayment ? (_payment['source'] as String? ?? '') : '';
+  double get amount => parseMoney(((isPayment ? _payment['amount'] : body['amount']) ?? '').toString()) ?? 0;
+}
+
+/// One purchase's payments read fresh (0102), with the payments on this phone
+/// that read does not count (R38): both from the same read, so a payment is
+/// never counted twice or missed.
+class PurchasePaymentsView {
+  const PurchasePaymentsView({required this.pay, this.queued = const []});
+  final PurchasePayments pay;
+  final List<QueuedCashAction> queued;
+}
+
 /// My purchases (Q12): what is still on the phone, then the server's list.
 class MyPurchasesView {
-  const MyPurchasesView({this.queued = const [], this.purchases = const [], this.fetchedAt, this.fromCache = false, this.error});
+  const MyPurchasesView(
+      {this.queued = const [], this.purchases = const [], this.queuedPayments = const [], this.fetchedAt, this.fromCache = false, this.error});
   final List<QueuedPurchase> queued;
   final List<MyPurchase> purchases;
+
+  /// Later payments still on the phone (Q6).
+  final List<QueuedCashAction> queuedPayments;
   final DateTime? fetchedAt;
   final bool fromCache;
   final Object? error;
+
+  /// Payments on [purchaseId] this list does not count yet (waiting to send,
+  /// or sent after it was read): they count in what is shown as left to pay,
+  /// marked as such (Q6, R38). Refused ones do not count.
+  double unsentFor(String purchaseId) => queuedPayments
+      .where((q) => q.purchaseId == purchaseId && q.state != QueuedState.needsAttention)
+      .fold<double>(0, (a, q) => round2(a + q.amount));
+
+  /// Whether [unsentFor] holds a payment already sent (R38): then it is "not
+  /// in this list yet", never "waiting to send".
+  bool sentFor(String purchaseId) => queuedPayments.any((q) => q.purchaseId == purchaseId && q.state == QueuedState.sent);
+}
+
+/// "My cash" (Q23): the buyer's own cash as last read, what is still on the
+/// phone, and the supplier credits a payment may use.
+class MyCashView {
+  const MyCashView({this.cash, this.credits = const [], this.queued = const [], this.unsentPettyCash = 0, this.fetchedAt, this.fromCache = false, this.error});
+
+  /// Null until it was read once (needs signal the first time).
+  final MyCash? cash;
+  final List<SupplierCredit> credits;
+
+  /// Returns (and payments) waiting to send or refused.
+  final List<QueuedCashAction> queued;
+
+  /// Petty cash in payments still on the phone (purchases paid now, and
+  /// later payments): it lowers cash held as shown (Q16).
+  final double unsentPettyCash;
+  final DateTime? fetchedAt;
+  final bool fromCache;
+  final Object? error;
+
+  /// Cash held never below zero, and the shortfall (Q16), counting [unsentPettyCash].
+  ({double held, double shortfall})? get figures => cash == null ? null : cashAfter(cash!, unsentPettyCash: unsentPettyCash);
+
+  List<QueuedCashAction> get queuedReturns => [for (final q in queued) if (q.kind == opCashReturn) q];
+
+  /// Usable credits with one supplier (Q11).
+  List<SupplierCredit> creditsFor(String? supplierId) =>
+      supplierId == null ? const [] : [for (final c in credits) if (c.usable && c.supplierId == supplierId) c];
+}
+
+/// Thrown by [PurchasingApi.pay] for a payment the server would refuse.
+class PaymentInvalid implements Exception {
+  const PaymentInvalid(this.problems);
+  final List<PayProblem> problems;
+  @override
+  String toString() => 'PaymentInvalid($problems)';
+}
+
+/// Thrown by [PurchasingApi.reportReturn] for a return the server would refuse.
+class ReturnInvalid implements Exception {
+  const ReturnInvalid(this.problems);
+  final List<ReturnProblem> problems;
+  @override
+  String toString() => 'ReturnInvalid($problems)';
 }
 
 /// Thrown by [PurchasingApi.send] for a draft the server would refuse.
@@ -129,6 +226,43 @@ abstract interface class PurchasingApi {
   /// Purchases on the phone for [userId] not yet recorded (R2's screen).
   Future<int> unsentFor(String userId);
 
+  // ── paying, petty cash, own money (0102, 0103) ──
+
+  /// Today in Manila, "YYYY-MM-DD": the latest day a payment or return may carry.
+  String today();
+
+  /// The buyer's own cash: fresh when online, the saved copy offline.
+  Future<MyCashView> myCash();
+
+  /// One purchase's payments and what this account may pay with, with the
+  /// payments on this phone it does not count. Online only.
+  Future<PurchasePaymentsView> purchasePayments(String purchaseId);
+
+  /// Payments on [purchaseId] still on this phone (waiting, sent after the
+  /// saved list was read, or refused): for when there is no signal.
+  Future<List<QueuedCashAction>> queuedPayments(String purchaseId);
+
+  /// Queues a later payment (Q6: also with no signal) and starts sending.
+  /// [proofPhoto]: a kept photo (GCash screenshot, deposit slip), optional.
+  /// Throws [PaymentInvalid] first.
+  Future<void> pay(String purchaseId, PaymentInput payment, {String? proofPhoto});
+
+  /// Voids a payment this account recorded, with a reason (Q7). Online only.
+  Future<void> voidPayment(String paymentId, String reason, {required String opId});
+
+  /// Queues a return of petty cash (Q17) with an optional kept photo, and
+  /// starts sending. Throws [ReturnInvalid] first.
+  Future<void> reportReturn(ReturnInput r, {String? photo});
+
+  /// Takes back a return the owner has not decided yet. Online only.
+  Future<void> withdrawReturn(String returnId, {required String opId});
+
+  /// "I did not receive this" on petty cash given (Q14). Online only.
+  Future<void> dispute(String issueId, String note, {required String opId});
+
+  /// Throws a refused payment or return away, with its photo.
+  Future<void> discardAction(String opId);
+
   /// Keeps only [userId]'s saved copy ('' keeps none). Unsent purchases are
   /// never touched.
   Future<void> keepOnly(String userId);
```

**Modify:** `lib/purchasing/data/purchasing_db.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/data/purchasing_db.dart b/lib/purchasing/data/purchasing_db.dart
index f72a227..b116a4c 100644
--- a/lib/purchasing/data/purchasing_db.dart
+++ b/lib/purchasing/data/purchasing_db.dart
@@ -16,7 +16,7 @@ class PurchasingDb {
   static Future<PurchasingDb> open(DatabaseFactory factory, String path, {bool singleInstance = true}) async {
     final db = await factory.openDatabase(
       path,
-      options: OpenDatabaseOptions(version: 1, onCreate: _create, singleInstance: singleInstance),
+      options: OpenDatabaseOptions(version: 2, onCreate: _create, onUpgrade: _upgrade, singleInstance: singleInstance),
     );
     return PurchasingDb._(db);
   }
@@ -42,7 +42,8 @@ class PurchasingDb {
         attempts integer not null default 0,
         last_error text,
         failed_permanently integer not null default 0,
-        created_at integer not null
+        created_at integer not null,
+        done_at integer
       )''');
     await db.execute('''
       create table pur_cache (
@@ -50,20 +51,30 @@ class PurchasingDb {
         name text not null,
         body text not null,
         fetched_at integer not null,
+        covers text,
         primary key (user_id, name)
       )''');
   }
 
+  /// Version 2 (0.8.0, R38): a sent op is kept until every saved copy counts
+  /// it (done_at); each saved copy names the sent ops it counts (covers).
+  static Future<void> _upgrade(Database db, int from, int to) async {
+    if (from < 2) {
+      await db.execute('alter table pur_op add column done_at integer');
+      await db.execute('alter table pur_cache add column covers text');
+    }
+  }
+
   Future<void> close() => _db.close();
 
   PurchaseDraft _draft(Map<String, Object?> row) => PurchaseDraft.fromJson(Map<String, dynamic>.from(jsonDecode(row['body']! as String) as Map));
 
   // ── drafts ─────────────────────────────────────────────────────────────
 
-  /// Never rewrites a queued draft: once handed to the queue it changes only
-  /// through [unqueueDraft].
+  /// Never rewrites a queued (or sent: queued = 2) draft: once handed to the
+  /// queue it changes only through [unqueueDraft].
   Future<void> saveDraft(String userId, PurchaseDraft d, DateTime now) => _db.transaction((txn) async {
-        final queued = await txn.query('pur_draft', columns: ['id'], where: 'id = ? and queued = 1', whereArgs: [d.id], limit: 1);
+        final queued = await txn.query('pur_draft', columns: ['id'], where: 'id = ? and queued >= 1', whereArgs: [d.id], limit: 1);
         if (queued.isNotEmpty) return;
         await txn.insert(
           'pur_draft',
@@ -79,7 +90,8 @@ class PurchasingDb {
         );
       });
 
-  /// [queued] false = still being edited; true = handed to the queue.
+  /// [queued] false = still being edited; true = handed to the queue and not
+  /// sent yet (sent ones: [sentDrafts]).
   Future<List<PurchaseDraft>> drafts(String userId, {required bool queued}) async => (await _db.query('pur_draft',
           where: 'user_id = ? and queued = ?', whereArgs: [userId, queued ? 1 : 0], orderBy: 'created_at desc'))
       .map(_draft)
@@ -103,7 +115,7 @@ class PurchasingDb {
   /// neither. False (nothing written) when it is already queued: a second
   /// Send must never record a second purchase.
   Future<bool> queueDraft(String userId, PurchaseDraft d, PurOp op, DateTime now) => _db.transaction((txn) async {
-        final already = await txn.query('pur_draft', columns: ['id'], where: 'id = ? and queued = 1', whereArgs: [d.id], limit: 1);
+        final already = await txn.query('pur_draft', columns: ['id'], where: 'id = ? and queued >= 1', whereArgs: [d.id], limit: 1);
         if (already.isNotEmpty) return false;
         await txn.insert(
           'pur_draft',
@@ -148,26 +160,72 @@ class PurchasingDb {
         return _draft(rows.first);
       });
 
-  /// Purchases on the phone not yet recorded: being edited, waiting to send
-  /// or needing attention — for the Buying is turned off screen.
+  /// Purchases on the phone not yet recorded (being edited, waiting to send
+  /// or needing attention), and payments and returns not yet sent (0102) —
+  /// for the Buying is turned off screen.
   Future<int> unsentCount(String userId) async =>
-      Sqflite.firstIntValue(await _db.rawQuery('select count(*) from pur_draft where user_id = ?', [userId])) ?? 0;
+      Sqflite.firstIntValue(await _db.rawQuery(
+          'select (select count(*) from pur_draft where user_id = ? and queued < 2)'
+          ' + (select count(*) from pur_op where user_id = ? and draft_id is null and done_at is null)',
+          [userId, userId])) ??
+      0;
+
+  /// A payment or a return (0102) queued on its own: no draft, sent once
+  /// in queue order. Its op id is minted once, so a retry records it once.
+  Future<void> queueOp(PurOp op) => _db.transaction((txn) async {
+        final top = (await txn.rawQuery('select coalesce(max(seq), 0) as s from pur_op')).first['s']! as int;
+        await txn.insert('pur_op', {...op.toMap(), 'seq': top + 1});
+      });
+
+  /// A refused payment or return the buyer throws away: returned (for its
+  /// photo) and deleted. Null while it could still be sent, or when it is
+  /// a purchase (those go through [discardRefused]).
+  Future<PurOp?> discardFailedOp(String userId, String opId) => _db.transaction((txn) async {
+        final rows = await txn.query('pur_op',
+            where: 'user_id = ? and op_id = ? and draft_id is null and failed_permanently = 1', whereArgs: [userId, opId], limit: 1);
+        if (rows.isEmpty) return null;
+        await txn.delete('pur_op', where: 'op_id = ?', whereArgs: [opId]);
+        return PurOp.fromMap(rows.first);
+      });
 
   // ── the queue ──────────────────────────────────────────────────────────
 
   /// This account's ops that may still be sent, in queue order.
   Future<List<PurOp>> sendable(String userId) async => (await _db.query('pur_op',
-          where: 'user_id = ? and failed_permanently = 0', whereArgs: [userId], orderBy: 'seq asc'))
+          where: 'user_id = ? and failed_permanently = 0 and done_at is null', whereArgs: [userId], orderBy: 'seq asc'))
       .map(PurOp.fromMap)
       .toList();
 
-  /// Every op of this account, refused ones included, in queue order.
+  /// Every op of this account not sent yet, refused ones included, in queue order.
   Future<List<PurOp>> ops(String userId) async =>
-      (await _db.query('pur_op', where: 'user_id = ?', whereArgs: [userId], orderBy: 'seq asc')).map(PurOp.fromMap).toList();
+      (await _db.query('pur_op', where: 'user_id = ? and done_at is null', whereArgs: [userId], orderBy: 'seq asc')).map(PurOp.fromMap).toList();
+
+  /// R38: ops the server has, kept while a saved copy does not count them
+  /// yet, in queue order.
+  Future<List<PurOp>> sentOps(String userId) async =>
+      (await _db.query('pur_op', where: 'user_id = ? and done_at is not null', whereArgs: [userId], orderBy: 'seq asc'))
+          .map(PurOp.fromMap)
+          .toList();
+
+  /// The drafts of sent purchases, kept with their op.
+  Future<List<PurchaseDraft>> sentDrafts(String userId) async =>
+      (await _db.query('pur_draft', where: 'user_id = ? and queued = 2', whereArgs: [userId], orderBy: 'created_at desc')).map(_draft).toList();
+
+  /// Sent ops every saved copy now counts: they go, with their drafts.
+  Future<void> forgetSent(String userId, Iterable<String> opIds) => _db.transaction((txn) async {
+        for (final id in opIds) {
+          final rows = await txn.query('pur_op',
+              columns: ['draft_id'], where: 'user_id = ? and op_id = ? and done_at is not null', whereArgs: [userId, id], limit: 1);
+          if (rows.isEmpty) continue;
+          await txn.delete('pur_op', where: 'op_id = ?', whereArgs: [id]);
+          final draftId = rows.first['draft_id'] as String?;
+          if (draftId != null) await txn.delete('pur_draft', where: 'id = ? and queued = 2', whereArgs: [draftId]);
+        }
+      });
 
   /// Any account: the app-closed sweeper asks this before it touches auth.
   Future<bool> hasAnySendable() async =>
-      (await _db.query('pur_op', columns: ['op_id'], where: 'failed_permanently = 0', limit: 1)).isNotEmpty;
+      (await _db.query('pur_op', columns: ['op_id'], where: 'failed_permanently = 0 and done_at is null', limit: 1)).isNotEmpty;
 
   /// Progress kept between attempts (uploaded receipt links, the company).
   Future<void> updateOpBody(String opId, Map<String, dynamic> body) =>
@@ -182,25 +240,32 @@ class PurchasingDb {
   Future<void> markFailed(String opId, String error) =>
       _db.rawUpdate('update pur_op set failed_permanently = 1, last_error = ? where op_id = ?', [error, opId]);
 
-  /// The purchase is recorded on the server: the op and its draft go
-  /// together, so it is never shown twice.
-  Future<void> finishRecord(String opId, String? draftId) => _db.transaction((txn) async {
-        await txn.delete('pur_op', where: 'op_id = ?', whereArgs: [opId]);
-        if (draftId != null) await txn.delete('pur_draft', where: 'id = ?', whereArgs: [draftId]);
+  /// The server has it (R38): never sent again, and no longer waiting. The
+  /// op and its draft are KEPT, marked sent, until every saved copy counts
+  /// it ([forgetSent]): a copy read before it went must still show it.
+  Future<void> markSent(String opId, String? draftId, DateTime at) => _db.transaction((txn) async {
+        await txn.update('pur_op', {'done_at': at.millisecondsSinceEpoch}, where: 'op_id = ? and done_at is null', whereArgs: [opId]);
+        if (draftId != null) await txn.update('pur_draft', {'queued': 2}, where: 'id = ?', whereArgs: [draftId]);
       });
 
   // ── last answers read, for offline ─────────────────────────────────────
 
-  Future<void> putCache(String userId, String name, Object json, DateTime at) => _db.insert(
+  /// [covers]: the sent ops this answer already counts (R38).
+  Future<void> putCache(String userId, String name, Object json, DateTime at, {Iterable<String> covers = const []}) => _db.insert(
         'pur_cache',
-        {'user_id': userId, 'name': name, 'body': jsonEncode(json), 'fetched_at': at.millisecondsSinceEpoch},
+        {'user_id': userId, 'name': name, 'body': jsonEncode(json), 'fetched_at': at.millisecondsSinceEpoch, 'covers': jsonEncode(covers.toList())},
         conflictAlgorithm: ConflictAlgorithm.replace,
       );
 
-  Future<({Object? body, DateTime at})?> cache(String userId, String name) async {
+  Future<({Object? body, DateTime at, Set<String> covers})?> cache(String userId, String name) async {
     final rows = await _db.query('pur_cache', where: 'user_id = ? and name = ?', whereArgs: [userId, name], limit: 1);
     if (rows.isEmpty) return null;
-    return (body: jsonDecode(rows.first['body']! as String), at: DateTime.fromMillisecondsSinceEpoch(rows.first['fetched_at']! as int, isUtc: true));
+    final covers = rows.first['covers'] as String?;
+    return (
+      body: jsonDecode(rows.first['body']! as String),
+      at: DateTime.fromMillisecondsSinceEpoch(rows.first['fetched_at']! as int, isUtc: true),
+      covers: covers == null ? <String>{} : {for (final c in jsonDecode(covers) as List<dynamic>) c as String},
+    );
   }
 
   /// Keeps only [userId]'s saved copy ('' keeps none). Drafts and the queue
```

**Modify:** `lib/purchasing/data/purchasing_remote.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/data/purchasing_remote.dart b/lib/purchasing/data/purchasing_remote.dart
index 1b42f32..f43c8ad 100644
--- a/lib/purchasing/data/purchasing_remote.dart
+++ b/lib/purchasing/data/purchasing_remote.dart
@@ -55,8 +55,29 @@ abstract class PurchasingRemote {
       {required String userId});
 
   /// The ledger row, THEN the file (0089: a file never exists without one).
-  /// Returns the link stored on the purchase.
-  Future<String> uploadReceipt({required String path, required String localPath, required String companyId, required String userId});
+  /// Returns the link stored on the purchase. [kind] is the ledger's:
+  /// 'purchase' (receipts and payment proofs) or 'petty_cash' (a return's photo).
+  Future<String> uploadReceipt(
+      {required String path, required String localPath, required String companyId, required String userId, String kind = 'purchase'});
+
+  // ── payments, petty cash, own money (0102, 0103) ──
+  /// The signed-in buyer's own cash (pur_my_cash).
+  Future<Map<String, dynamic>> myCash();
+
+  /// Which of these op ids (this account's own) the server already accepted
+  /// (pur_my_ops_done, 0103) — at most 200 at once.
+  Future<List<String>> opsDone(List<String> opIds);
+
+  /// Every supplier credit of the company, used or not (pur_credits).
+  Future<List<Map<String, dynamic>>> credits();
+
+  /// One purchase's payments, its open credits and what this account may use.
+  Future<Map<String, dynamic>> purchasePayments(String purchaseId);
+  Future<Map<String, dynamic>> pay(String opId, String purchaseId, Map<String, dynamic> payment, {required String userId});
+  Future<Map<String, dynamic>> voidPayment(String opId, String paymentId, String reason, {required String userId});
+  Future<Map<String, dynamic>> reportReturn(String opId, Map<String, dynamic> body, String photoUrl, {required String userId});
+  Future<Map<String, dynamic>> withdrawReturn(String opId, String returnId, {required String userId});
+  Future<Map<String, dynamic>> dispute(String opId, String issueId, String note, {required String userId});
 
   /// The receipt's bytes, read as the buyer (never a signed link: 0097), or null.
   Future<Uint8List?> receipt(String url);
@@ -132,10 +153,11 @@ class SupabasePurchasingRemote implements PurchasingRemote {
       _write('pur_request_change', {'p_op': opId, 'p_purchase': purchaseId, 'p_kind': 'correct', 'p_body': body, 'p_reason': reason}, userId);
 
   @override
-  Future<String> uploadReceipt({required String path, required String localPath, required String companyId, required String userId}) async {
+  Future<String> uploadReceipt(
+      {required String path, required String localPath, required String companyId, required String userId, String kind = 'purchase'}) async {
     _same(userId);
     try {
-      await _client.from('receipt_uploads').insert({'path': path, 'owner_id': companyId, 'kind': 'purchase'}).timeout(_readTimeout);
+      await _client.from('receipt_uploads').insert({'path': path, 'owner_id': companyId, 'kind': kind}).timeout(_readTimeout);
     } catch (e) {
       if (!isDuplicate(e)) rethrow;
     }
@@ -150,6 +172,47 @@ class SupabasePurchasingRemote implements PurchasingRemote {
     return _client.storage.from(receiptBucket).getPublicUrl(path);
   }
 
+  @override
+  Future<Map<String, dynamic>> myCash() async => Map<String, dynamic>.from(await _read('pur_my_cash') as Map);
+
+  @override
+  Future<List<Map<String, dynamic>>> credits() async => _rows(await _read('pur_credits', {'p_supplier': null}));
+
+  @override
+  Future<List<String>> opsDone(List<String> opIds) async =>
+      [for (final id in (await _read('pur_my_ops_done', {'p_ops': opIds}) as List<dynamic>? ?? const [])) id.toString()];
+
+  @override
+  Future<Map<String, dynamic>> purchasePayments(String purchaseId) async =>
+      Map<String, dynamic>.from(await _read('pur_purchase_payments', {'p_purchase': purchaseId}) as Map);
+
+  @override
+  Future<Map<String, dynamic>> pay(String opId, String purchaseId, Map<String, dynamic> payment, {required String userId}) =>
+      _write('pur_pay', {'p_op': opId, 'p_purchase': purchaseId, 'p_payment': payment}, userId);
+
+  @override
+  Future<Map<String, dynamic>> voidPayment(String opId, String paymentId, String reason, {required String userId}) =>
+      _write('pur_void_payment', {'p_op': opId, 'p_payment': paymentId, 'p_reason': reason}, userId);
+
+  @override
+  Future<Map<String, dynamic>> reportReturn(String opId, Map<String, dynamic> body, String photoUrl, {required String userId}) =>
+      _write('pur_cash_report_return', {
+        'p_op': opId,
+        'p_amount': body['amount'],
+        'p_handed_on': body['handed_on'],
+        'p_handed_to': body['handed_to'] ?? '',
+        'p_photo_url': photoUrl,
+        'p_note': body['note'] ?? '',
+      }, userId);
+
+  @override
+  Future<Map<String, dynamic>> withdrawReturn(String opId, String returnId, {required String userId}) =>
+      _write('pur_cash_withdraw_return', {'p_op': opId, 'p_return': returnId}, userId);
+
+  @override
+  Future<Map<String, dynamic>> dispute(String opId, String issueId, String note, {required String userId}) =>
+      _write('pur_cash_dispute', {'p_op': opId, 'p_issue': issueId, 'p_note': note}, userId);
+
   @override
   Future<Uint8List?> receipt(String url) async {
     final path = receiptPathOf(url);
```

**Modify:** `lib/purchasing/data/purchasing_repository.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/data/purchasing_repository.dart b/lib/purchasing/data/purchasing_repository.dart
index bf415f3..0746524 100644
--- a/lib/purchasing/data/purchasing_repository.dart
+++ b/lib/purchasing/data/purchasing_repository.dart
@@ -6,6 +6,7 @@ import '../../attendance/device/device_bridge.dart';
 import '../../attendance/domain/event_id.dart';
 import '../../attendance/domain/work_date.dart';
 import '../../attendance/sync/upload_scheduler.dart';
+import '../domain/pay_models.dart';
 import '../domain/pur_failure.dart';
 import '../domain/pur_models.dart';
 import '../domain/pur_op.dart';
@@ -17,6 +18,9 @@ import 'purchasing_remote.dart';
 /// Offline-first buying (Q7). Recording happens on the phone first and is
 /// sent once, whenever there is signal, from the app or the background task.
 /// Claiming, releasing, Mark arranged and corrections need signal (Q5, Q6).
+/// Paying (0102): a later payment and a return of petty cash are queued the
+/// same way (Q6); voiding a payment, withdrawing a return and "I did not
+/// receive this" need signal.
 class PurchasingRepository implements PurchasingApi {
   PurchasingRepository({
     required this.db,
@@ -217,9 +221,14 @@ class PurchasingRepository implements PurchasingApi {
 
   @override
   Future<void> send(PurchaseDraft draft) async {
-    final problems = purchaseProblems(draft);
-    if (problems.isNotEmpty) throw PurchaseInvalid(problems);
     final u = _user();
+    // "Paid now?" (0102, Q3): petty cash and own money need a staff buyer
+    // (unknown before the first read: the server decides); a credit, what it has left.
+    final cash = await db.cache(u, 'my_cash');
+    final holder = cash == null || (cash.body as Map)['holder'] == true;
+    final left = draft.paidFrom == 'credit' ? await _creditLeft(u, draft.paidCredit) : null;
+    final problems = [...purchaseProblems(draft), ...paidNowProblems(draft, holder: holder, creditLeft: left)];
+    if (problems.isNotEmpty) throw PurchaseInvalid(problems);
     final op = PurOp(
       opId: _newId(),
       userId: u,
@@ -245,11 +254,14 @@ class PurchasingRepository implements PurchasingApi {
     Object? error;
     DateTime? fetchedAt;
     var fromCache = false;
+    var counted = <String>{};
     try {
-      final fresh = await _guard(remote.myPurchases);
+      final (fresh, covers) = await _guard(() => _fresh(u, remote.myPurchases));
       docs = fresh;
+      counted = covers;
       fetchedAt = _now();
-      await db.putCache(u, 'my_purchases', fresh, fetchedAt);
+      await db.putCache(u, 'my_purchases', fresh, fetchedAt, covers: covers);
+      await _forgetCounted(u);
     } catch (e) {
       if (PurFailure.of(e) == PurFailure.buyingOff) rethrow;
       error = e;
@@ -258,20 +270,20 @@ class PurchasingRepository implements PurchasingApi {
         docs = _rows(cached.body);
         fetchedAt = cached.at;
         fromCache = true;
+        counted = cached.covers;
       }
     }
-    final ops = {for (final o in await db.ops(u)) o.draftId: o};
+    final allOps = await _notCounted(u, counted);
+    final ops = {for (final o in allOps) if (o.draftId != null) o.draftId: o};
+    final drafts = [...await db.drafts(u, queued: true), ...await db.sentDrafts(u)]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
     final queued = [
-      for (final d in await db.drafts(u, queued: true))
+      for (final d in drafts)
         if (ops[d.id] case final op?)
-          QueuedPurchase(
-            draft: d,
-            state: op.failedPermanently ? QueuedState.needsAttention : QueuedState.waiting,
-            failure: op.failedPermanently ? PurFailure.fromStored(op.lastError) : null,
-          ),
+          QueuedPurchase(draft: d, state: _state(op), failure: op.failedPermanently ? PurFailure.fromStored(op.lastError) : null),
     ];
     return MyPurchasesView(
       queued: queued,
+      queuedPayments: [for (final a in _cashActions(allOps)) if (a.isPayment) a],
       purchases: [for (final d in docs ?? const <Map<String, dynamic>>[]) MyPurchase.fromJson(d)],
       fetchedAt: fetchedAt,
       fromCache: fromCache,
@@ -335,6 +347,243 @@ class PurchasingRepository implements PurchasingApi {
     await _guard(() => remote.requestChange(opId, purchase.id, body, reason, userId: u));
   }
 
+  // ── paying, petty cash, own money (0102, 0103) ─────────────────────────
+
+  @override
+  String today() => isoDate(manilaDate(_now()));
+
+  List<QueuedCashAction> _cashActions(List<PurOp> ops) => [
+        for (final o in ops)
+          if (o.draftId == null && (o.kind == opPay || o.kind == opCashReturn))
+            QueuedCashAction(
+              opId: o.opId,
+              kind: o.kind,
+              body: o.purchase,
+              state: _state(o),
+              failure: o.failedPermanently ? PurFailure.fromStored(o.lastError) : null,
+            ),
+      ];
+
+  QueuedState _state(PurOp o) => o.failedPermanently
+      ? QueuedState.needsAttention
+      : o.sent
+          ? QueuedState.sent
+          : QueuedState.waiting;
+
+  /// R38: what a list read with [counted] does not count — every op not sent
+  /// yet (refused ones included, shown but never counted), and every sent op
+  /// outside [counted]. In queue order.
+  Future<List<PurOp>> _notCounted(String u, Set<String> counted) async =>
+      [...await db.ops(u), for (final o in await db.sentOps(u)) if (!counted.contains(o.opId)) o]..sort((a, b) => a.seq.compareTo(b.seq));
+
+  /// Petty cash in payments the balance shown does not count (purchases paid
+  /// now from petty cash, later petty-cash payments); refused ones are not counted.
+  double _unsentPetty(List<PurOp> ops) {
+    var sum = 0.0;
+    for (final o in ops.where((o) => !o.failedPermanently)) {
+      final payments = switch (o.kind) {
+        opPay => [o.purchase['payment']],
+        opRecord => (o.purchase['payments'] as List<dynamic>?) ?? const [],
+        _ => const [],
+      };
+      for (final p in payments.whereType<Map<dynamic, dynamic>>()) {
+        if (p['source'] == 'petty_cash') sum = round2(sum + (parseMoney('${p['amount']}') ?? 0));
+      }
+    }
+    return sum;
+  }
+
+  /// R38: an operation the server accepted but whose answer never came back
+  /// is still queued here. Ask the server which queued ops it already has and
+  /// mark them sent, as the sync would (never sent again, photos deleted).
+  /// Throws with no signal.
+  Future<void> _reconcile(String u) async {
+    final live = [for (final o in await db.ops(u)) if (!o.failedPermanently) o];
+    for (var i = 0; i < live.length; i += 200) {
+      final chunk = live.sublist(i, i + 200 > live.length ? live.length : i + 200);
+      final done = (await remote.opsDone([for (final o in chunk) o.opId])).toSet();
+      for (final o in chunk.where((o) => done.contains(o.opId))) {
+        await db.markSent(o.opId, o.draftId, _now());
+        for (final r in o.receipts.values) {
+          await discardPhoto(r.local);
+        }
+      }
+    }
+  }
+
+  /// R38: one fresh read, and exactly which sent ops it already counts.
+  /// Ops the server has are marked sent first; those sent before the read
+  /// began are in it. An op that went during the read (sent by the
+  /// background send, or found by the check after it) may or may not be in
+  /// it, so the read is done again — it is sent before that one begins. Not
+  /// settled after three reads, or no signal for the check after it: the
+  /// read is not used, and the saved copy is shown (exact, as it says what
+  /// it counts).
+  Future<(T, Set<String>)> _fresh<T>(String u, Future<T> Function() read) async {
+    for (var round = 0; round < 3; round++) {
+      await _reconcile(u);
+      final before = await _queueState(u);
+      final value = await read();
+      await _reconcile(u);
+      final after = await _queueState(u);
+      final wentDuring = {...after.sent.difference(before.sent), ...before.waiting.difference(after.waiting).difference(after.refused)};
+      if (wentDuring.isEmpty) return (value, before.sent);
+    }
+    throw const PurFailureException(PurFailure.noConnection);
+  }
+
+  Future<({Set<String> waiting, Set<String> refused, Set<String> sent})> _queueState(String u) async {
+    final ops = await db.ops(u);
+    return (
+      waiting: {for (final o in ops) if (!o.failedPermanently) o.opId},
+      refused: {for (final o in ops) if (o.failedPermanently) o.opId},
+      sent: {for (final o in await db.sentOps(u)) o.opId},
+    );
+  }
+
+  /// A sent op is forgotten once every saved copy that shows it (My purchases,
+  /// My cash) counts it; until then a copy read before it went still shows it.
+  Future<void> _forgetCounted(String u) async {
+    final copies = [await db.cache(u, 'my_purchases'), await db.cache(u, 'my_cash')];
+    await db.forgetSent(u, [
+      for (final o in await db.sentOps(u))
+        if (copies.every((c) => c == null || c.covers.contains(o.opId))) o.opId,
+    ]);
+  }
+
+  /// What a credit had left when last read on this phone, or null.
+  Future<double?> _creditLeft(String u, String? creditId) async {
+    final saved = await db.cache(u, 'credits');
+    if (saved == null || creditId == null) return null;
+    for (final c in _rows(saved.body).map(SupplierCredit.fromJson)) {
+      if (c.id == creditId) return c.left;
+    }
+    return null;
+  }
+
+  @override
+  Future<MyCashView> myCash() async {
+    final u = _user();
+    MyCash? cash;
+    var credits = const <SupplierCredit>[];
+    Object? error;
+    DateTime? at;
+    var fromCache = false;
+    var counted = <String>{};
+    try {
+      final ((mine, creditRows), covers) = await _guard(() => _fresh(u, () async => (await remote.myCash(), await remote.credits())));
+      at = _now();
+      counted = covers;
+      await db.putCache(u, 'my_cash', mine, at, covers: covers);
+      await db.putCache(u, 'credits', creditRows, at, covers: covers);
+      await _forgetCounted(u);
+      cash = MyCash.fromJson(mine);
+      credits = creditRows.map(SupplierCredit.fromJson).toList();
+    } catch (e) {
+      if (PurFailure.of(e) == PurFailure.buyingOff) rethrow;
+      error = e;
+      final saved = await db.cache(u, 'my_cash');
+      if (saved != null) {
+        cash = MyCash.fromJson(Map<String, dynamic>.from(saved.body as Map));
+        at = saved.at;
+        fromCache = true;
+        counted = saved.covers;
+      }
+      final savedCredits = await db.cache(u, 'credits');
+      if (savedCredits != null) credits = _rows(savedCredits.body).map(SupplierCredit.fromJson).toList();
+    }
+    final ops = await _notCounted(u, counted);
+    return MyCashView(
+      cash: cash,
+      credits: credits,
+      queued: _cashActions(ops),
+      unsentPettyCash: _unsentPetty(ops),
+      fetchedAt: at,
+      fromCache: fromCache,
+      error: (cash == null || fromCache) ? error : null,
+    );
+  }
+
+  @override
+  Future<PurchasePaymentsView> purchasePayments(String purchaseId) async {
+    final u = _user();
+    final (json, covers) = await _guard(() => _fresh(u, () => remote.purchasePayments(purchaseId)));
+    return PurchasePaymentsView(
+      pay: PurchasePayments.fromJson(json),
+      queued: [for (final a in _cashActions(await _notCounted(u, covers))) if (a.purchaseId == purchaseId) a],
+    );
+  }
+
+  @override
+  Future<List<QueuedCashAction>> queuedPayments(String purchaseId) async {
+    final u = _user();
+    final saved = await db.cache(u, 'my_purchases');
+    return [for (final a in _cashActions(await _notCounted(u, saved?.covers ?? const {}))) if (a.purchaseId == purchaseId) a];
+  }
+
+  @override
+  Future<void> pay(String purchaseId, PaymentInput payment, {String? proofPhoto}) async {
+    final u = _user();
+    final left = payment.source == 'credit' ? await _creditLeft(u, payment.creditId) : null;
+    final problems = paymentProblems(payment, today: today(), creditLeft: left);
+    if (problems.isNotEmpty) throw PaymentInvalid(problems);
+    await db.queueOp(PurOp(
+      opId: _newId(),
+      userId: u,
+      kind: opPay,
+      createdAt: _now().toUtc(),
+      // The proof's link is added once it is uploaded (purchasing_sync).
+      purchase: {'purchase_id': purchaseId, 'payment': paymentBody(payment.copyWith(proofUrl: null))},
+      companyId: companyOf(u),
+      receipts: {if (proofPhoto != null) 'proof': ReceiptUpload(local: proofPhoto, photoId: _newId())},
+    ));
+    await _kick();
+  }
+
+  @override
+  Future<void> voidPayment(String paymentId, String reason, {required String opId}) async {
+    final u = _user();
+    if (reason.trim().isEmpty) throw const PurFailureException(PurFailure.reasonRequired);
+    await _guard(() => remote.voidPayment(opId, paymentId, reason.trim(), userId: u));
+  }
+
+  @override
+  Future<void> reportReturn(ReturnInput r, {String? photo}) async {
+    final u = _user();
+    final problems = returnProblems(r, today: today());
+    if (problems.isNotEmpty) throw ReturnInvalid(problems);
+    await db.queueOp(PurOp(
+      opId: _newId(),
+      userId: u,
+      kind: opCashReturn,
+      createdAt: _now().toUtc(),
+      purchase: r.toJson(),
+      companyId: companyOf(u),
+      receipts: {if (photo != null) 'photo': ReceiptUpload(local: photo, photoId: _newId())},
+    ));
+    await _kick();
+  }
+
+  @override
+  Future<void> withdrawReturn(String returnId, {required String opId}) async {
+    final u = _user();
+    await _guard(() => remote.withdrawReturn(opId, returnId, userId: u));
+  }
+
+  @override
+  Future<void> dispute(String issueId, String note, {required String opId}) async {
+    final u = _user();
+    await _guard(() => remote.dispute(opId, issueId, note.trim(), userId: u));
+  }
+
+  @override
+  Future<void> discardAction(String opId) async {
+    final op = await db.discardFailedOp(_user(), opId);
+    for (final r in op?.receipts.values ?? const <ReceiptUpload>[]) {
+      await discardPhoto(r.local);
+    }
+  }
+
   @override
   Future<Uint8List?> receipt(String url) async {
     final hit = _receipts[url];
```

**Create:** `lib/purchasing/domain/pay_models.dart`

```dart
/// How a purchase is paid, petty cash and "Company owes me" (0102, 0103), as
/// the phone reads them, and the payment checks the server would make. All of
/// it is OUTSIDE the money model: a payment never changes Spent; it only says
/// how a receipt was paid and whose money did it.
library;

import 'purchase_draft.dart' show parseMoney, round2;

double _num(Object? v) => switch (v) {
      num n => n.toDouble(),
      String s => double.tryParse(s) ?? 0,
      _ => 0,
    };

double? _numOrNull(Object? v) => v == null ? null : _num(v);

String _str(Object? v) => v == null ? '' : v.toString();

List<Map<String, dynamic>> _rows(Object? v) => [for (final r in (v as List<dynamic>? ?? const [])) Map<String, dynamic>.from(r as Map)];

/// Where the money for a payment came from (Q5). One payment, one source.
const paySources = ['petty_cash', 'own_money', 'company', 'credit'];

/// How it was handed over (Q5). A supplier credit is sent as 'other'.
const payMethods = ['cash', 'gcash', 'bank_transfer', 'check', 'other'];

/// The purchase form's "Paid by" word → a payment method (the web's methodOf).
String methodOf(String paymentMethod) {
  final m = paymentMethod.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '_');
  return payMethods.contains(m) ? m : 'cash';
}

/// One purchase's payment state (`pur_pay_state`, 0102).
class PayState {
  const PayState({
    this.state = 'not_tracked',
    this.tracked = false,
    this.due = 0,
    this.paid = 0,
    this.balance = 0,
    this.excess = 0,
    this.unresolved = 0,
  });

  factory PayState.fromJson(Map<String, dynamic>? j) => j == null
      ? const PayState()
      : PayState(
          state: _str(j['state']).isEmpty ? 'not_tracked' : _str(j['state']),
          tracked: j['tracked'] == true,
          due: _num(j['due']),
          paid: _num(j['paid']),
          balance: _num(j['balance']),
          excess: _num(j['excess']),
          unresolved: _num(j['unresolved']),
        );

  /// not_tracked · unpaid · partial · paid · overpaid · void · void_paid.
  final String state;

  /// False on purchases recorded before 0102 until a payment is recorded (Q2).
  final bool tracked;
  final double due;
  final double paid;

  /// What is still to pay, never below zero.
  final double balance;
  final double excess;

  /// Over, and not yet refunded or kept as credit (the owner resolves it).
  final double unresolved;

  /// Payment is possible only on a recorded purchase (R12).
  bool get payable => state != 'void' && state != 'void_paid';

  /// The phone offers Record payment only on a purchase whose payments are
  /// tracked and that is not voided (R34): one from before 0102 stays "Payment
  /// not tracked" until the owner starts tracking it on Dacs Web (Q2).
  bool get canRecordPayment => tracked && payable;

  /// Still to pay once payments waiting on this phone are counted (Q6).
  double leftAfter(double unsent) => (round2(balance - unsent)).clamp(0, double.infinity).toDouble();

  Map<String, dynamic> toJson() => {
        'state': state,
        'tracked': tracked,
        'due': due,
        'paid': paid,
        'balance': balance,
        'excess': excess,
        'unresolved': unresolved,
      };
}

/// One payment on a purchase (`pur_payment_json`).
class PurPayment {
  const PurPayment({
    required this.id,
    this.amount = 0,
    this.paidOn = '',
    this.method = '',
    this.source = '',
    this.personName = '',
    this.creditId,
    this.authorized = true,
    this.acceptedAt,
    this.rejectedAt,
    this.rejectReason = '',
    this.proofUrl = '',
    this.note = '',
    this.createdByName = '',
    this.voidedAt,
    this.voidReason = '',
    this.canVoid = false,
    this.moved = false,
  });

  factory PurPayment.fromJson(Map<String, dynamic> j) => PurPayment(
        id: _str(j['id']),
        amount: _num(j['amount']),
        paidOn: _str(j['paid_on']),
        method: _str(j['method']),
        source: _str(j['source']),
        personName: _str(j['person_name']),
        creditId: j['credit_id'] as String?,
        authorized: j['authorized'] != false,
        acceptedAt: j['accepted_at'] as String?,
        rejectedAt: j['rejected_at'] as String?,
        rejectReason: _str(j['reject_reason']),
        proofUrl: _str(j['proof_url']),
        note: _str(j['note']),
        createdByName: _str(j['created_by_name']),
        voidedAt: j['voided_at'] as String?,
        voidReason: _str(j['void_reason']),
        canVoid: j['can_void'] == true,
        moved: j['moved'] == true,
      );

  final String id;
  final double amount;
  final String paidOn;
  final String method;
  final String source;
  final String personName;
  final String? creditId;

  /// Own money while "May use own money" was off is kept but not owed until
  /// the owner accepts it (Q21); a rejected one is never owed (R9).
  final bool authorized;
  final String? acceptedAt;
  final String? rejectedAt;
  final String rejectReason;
  final String proofUrl;
  final String note;
  final String createdByName;
  final String? voidedAt;
  final String voidReason;
  final bool canVoid;

  /// Carried over from the earlier version of a replaced purchase (R4).
  final bool moved;

  bool get voided => voidedAt != null;

  /// Own money the owner has not decided on yet.
  bool get toReview => source == 'own_money' && !authorized && acceptedAt == null && rejectedAt == null;
}

/// A balance with one supplier, used in parts (Q11, Q12; `pur_credits`).
class SupplierCredit {
  const SupplierCredit({required this.id, this.supplierId, this.supplier = '', this.amount = 0, this.left = 0, this.voided = false});

  factory SupplierCredit.fromJson(Map<String, dynamic> j) => SupplierCredit(
        id: _str(j['id']),
        supplierId: j['supplier_id'] as String?,
        supplier: _str(j['supplier']),
        amount: _num(j['amount']),
        left: _num(j['left']),
        voided: j['voided_at'] != null,
      );

  final String id;
  final String? supplierId;
  final String supplier;
  final double amount;
  final double left;
  final bool voided;

  bool get usable => !voided && left > 0;

  Map<String, dynamic> toJson() => {
        'id': id,
        'supplier_id': supplierId,
        'supplier': supplier,
        'amount': amount,
        'left': left,
        'voided_at': voided ? 'voided' : null,
      };
}

/// A purchase's payments as `pur_purchase_payments` gives them.
class PurchasePayments {
  const PurchasePayments({
    this.pay = const PayState(),
    this.supplierId,
    this.payments = const [],
    this.openCredits = const [],
    this.holder = false,
    this.ownMoney = false,
    this.cashHeld,
  });

  factory PurchasePayments.fromJson(Map<String, dynamic> j) {
    final me = Map<String, dynamic>.from((j['me'] as Map?) ?? const {});
    return PurchasePayments(
      pay: PayState.fromJson(j['pay'] == null ? null : Map<String, dynamic>.from(j['pay'] as Map)),
      supplierId: j['supplier_id'] as String?,
      payments: _rows(j['payments']).map(PurPayment.fromJson).toList(),
      openCredits: _rows(j['open_credits']).map(SupplierCredit.fromJson).toList(),
      holder: me['holder'] == true,
      ownMoney: me['own_money'] == true,
      cashHeld: _numOrNull(me['cash_held']),
    );
  }

  final PayState pay;
  final String? supplierId;
  final List<PurPayment> payments;

  /// Credit with this purchase's supplier that a payment may use.
  final List<SupplierCredit> openCredits;

  /// A staff buyer, who may pay from petty cash or their own money (R2).
  final bool holder;
  final bool ownMoney;

  /// Petty cash on record (may be below zero: the shortfall, Q16).
  final double? cashHeld;
}

/// Petty cash given to the buyer (`pur_cash_detail` issues).
class CashIssue {
  const CashIssue({
    required this.id,
    this.amount = 0,
    this.issuedOn = '',
    this.method = '',
    this.note = '',
    this.disputedAt,
    this.disputeNote = '',
    this.disputeClearedAt,
    this.disputeClearedNote = '',
    this.voidedAt,
    this.voidReason = '',
  });

  factory CashIssue.fromJson(Map<String, dynamic> j) => CashIssue(
        id: _str(j['id']),
        amount: _num(j['amount']),
        issuedOn: _str(j['issued_on']),
        method: _str(j['method']),
        note: _str(j['note']),
        disputedAt: j['disputed_at'] as String?,
        disputeNote: _str(j['dispute_note']),
        disputeClearedAt: j['dispute_cleared_at'] as String?,
        disputeClearedNote: _str(j['dispute_cleared_note']),
        voidedAt: j['voided_at'] as String?,
        voidReason: _str(j['void_reason']),
      );

  final String id;
  final double amount;
  final String issuedOn;
  final String method;
  final String note;
  final String? disputedAt;
  final String disputeNote;
  final String? disputeClearedAt;
  final String disputeClearedNote;
  final String? voidedAt;
  final String voidReason;

  bool get voided => voidedAt != null;

  /// "I did not receive this" is still open (Q14).
  bool get flagged => disputedAt != null && disputeClearedAt == null;

  /// One flag per entry; a voided entry is settled.
  bool get canDispute => !voided && disputedAt == null;
}

/// A return the buyer reported (`pur_cash_detail` returns; 0103 adds the photo).
class CashReturn {
  const CashReturn({
    required this.id,
    this.amount = 0,
    this.handedOn = '',
    this.handedTo = '',
    this.status = '',
    this.decisionNote = '',
    this.photoUrl = '',
    this.voidedAt,
  });

  factory CashReturn.fromJson(Map<String, dynamic> j) => CashReturn(
        id: _str(j['id']),
        amount: _num(j['amount']),
        handedOn: _str(j['handed_on']),
        handedTo: _str(j['handed_to']),
        status: _str(j['status']),
        decisionNote: _str(j['decision_note']),
        photoUrl: _str(j['photo_url']),
        voidedAt: j['voided_at'] as String?,
      );

  final String id;
  final double amount;
  final String handedOn;
  final String handedTo;

  /// reported · withdrawn · confirmed · rejected.
  final String status;
  final String decisionNote;
  final String photoUrl;
  final String? voidedAt;

  bool get waiting => status == 'reported';
}

/// The company repaying the buyer's own money.
class Repayment {
  const Repayment({required this.id, this.amount = 0, this.paidOn = '', this.method = '', this.voidedAt});

  factory Repayment.fromJson(Map<String, dynamic> j) => Repayment(
        id: _str(j['id']),
        amount: _num(j['amount']),
        paidOn: _str(j['paid_on']),
        method: _str(j['method']),
        voidedAt: j['voided_at'] as String?,
      );

  final String id;
  final double amount;
  final String paidOn;
  final String method;
  final String? voidedAt;
}

/// The buyer's own cash (`pur_my_cash`, Q23/Q24): never another buyer's.
class MyCash {
  const MyCash({
    this.holder = false,
    this.recorded = 0,
    this.held = 0,
    this.shortfall = 0,
    this.pendingReturns = 0,
    this.owes = 0,
    this.owesToReview = 0,
    this.ownMoney = false,
    this.lastGivenOn,
    this.issues = const [],
    this.returns = const [],
    this.repayments = const [],
  });

  factory MyCash.fromJson(Map<String, dynamic> j) => MyCash(
        holder: j['holder'] == true,
        recorded: _num(j['recorded']),
        held: _num(j['held']),
        shortfall: _num(j['shortfall']),
        pendingReturns: _num(j['pending_returns']),
        owes: _num(j['owes']),
        owesToReview: _num(j['owes_to_review']),
        ownMoney: j['own_money'] == true,
        lastGivenOn: j['last_given_on'] as String?,
        issues: _rows(j['issues']).map(CashIssue.fromJson).toList(),
        returns: _rows(j['returns']).map(CashReturn.fromJson).toList(),
        repayments: _rows(j['repayments']).map(Repayment.fromJson).toList(),
      );

  /// False for an owner account: only staff buyers hold petty cash (R2).
  final bool holder;

  /// Petty cash on record; below zero is a shortfall, never shown as cash (Q16).
  final double recorded;
  final double held;
  final double shortfall;

  /// Reported, not yet confirmed: never lowers [held] (Q17).
  final double pendingReturns;

  /// "Company owes me" — own money accepted or allowed, less repayments.
  final double owes;

  /// Own money paid while it was not allowed, waiting for the owner (Q21).
  final double owesToReview;

  /// "May use own money" is on (Q21).
  final bool ownMoney;
  final String? lastGivenOn;
  final List<CashIssue> issues;
  final List<CashReturn> returns;
  final List<Repayment> repayments;
}

/// What the "My cash" card shows once actions still on this phone count:
/// payments from petty cash lower it, a return waiting to send waits beside
/// it (Q17: only the owner's confirmation lowers the balance). Cash held is
/// never below zero; the rest is the shortfall (Q16).
({double held, double shortfall}) cashAfter(MyCash cash, {double unsentPettyCash = 0}) {
  final r = round2(cash.recorded - unsentPettyCash);
  return (held: r > 0 ? r : 0, shortfall: r < 0 ? -r : 0);
}

/// Q16: a warning, never a refusal — paying more petty cash than is on record.
/// Null when there is nothing to warn about (or the balance is unknown).
double? overspendBy(String amount, double? held) {
  final a = parseMoney(amount);
  if (held == null || a == null || a <= 0) return null;
  final h = held > 0 ? held : 0.0;
  return a > h ? round2(a - h) : null;
}

/// Why a payment would be refused — the server's codes (the web's
/// paymentProblems, the same order).
enum PayProblem { badAmount, badDate, badSource, badMethod, creditRequired, overCredit }

/// One payment being entered: in "Paid now?" (Q3) or Record payment (Q6).
class PaymentInput {
  const PaymentInput({
    this.amount = '',
    required this.paidOn,
    this.method = 'cash',
    this.source = 'company',
    this.creditId,
    this.note = '',
    this.proofUrl,
  });

  factory PaymentInput.fromJson(Map<String, dynamic> j) => PaymentInput(
        amount: _str(j['amount']),
        paidOn: _str(j['paid_on']),
        method: _str(j['method']).isEmpty ? 'cash' : _str(j['method']),
        source: _str(j['source']).isEmpty ? 'company' : _str(j['source']),
        creditId: j['credit_id'] as String?,
        note: _str(j['note']),
        proofUrl: j['proof_url'] as String?,
      );

  final String amount;
  final String paidOn;
  final String method;
  final String source;
  final String? creditId;
  final String note;
  final String? proofUrl;

  PaymentInput copyWith({String? amount, String? paidOn, String? method, String? source, Object? creditId = _keep, String? note, Object? proofUrl = _keep}) =>
      PaymentInput(
        amount: amount ?? this.amount,
        paidOn: paidOn ?? this.paidOn,
        method: method ?? this.method,
        source: source ?? this.source,
        creditId: identical(creditId, _keep) ? this.creditId : creditId as String?,
        note: note ?? this.note,
        proofUrl: identical(proofUrl, _keep) ? this.proofUrl : proofUrl as String?,
      );

  Map<String, dynamic> toJson() =>
      {'amount': amount, 'paid_on': paidOn, 'method': method, 'source': source, 'credit_id': creditId, 'note': note, 'proof_url': proofUrl};
}

const _keep = Object();

/// [today] is Manila's "YYYY-MM-DD"; [creditLeft] what the chosen credit has
/// left (null: unknown — the server checks it).
List<PayProblem> paymentProblems(PaymentInput p, {required String today, double? creditLeft}) {
  final out = <PayProblem>[];
  final a = parseMoney(p.amount);
  if (a == null || a <= 0) out.add(PayProblem.badAmount);
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(p.paidOn) || p.paidOn.compareTo(today) > 0 || p.paidOn.compareTo('2020-01-01') < 0) {
    out.add(PayProblem.badDate);
  }
  if (!paySources.contains(p.source)) out.add(PayProblem.badSource);
  if (p.source != 'credit' && !payMethods.contains(p.method)) out.add(PayProblem.badMethod);
  if (p.source == 'credit') {
    if ((p.creditId ?? '').isEmpty) {
      out.add(PayProblem.creditRequired);
    } else if (a != null && a > 0 && creditLeft != null && a > creditLeft) {
      out.add(PayProblem.overCredit);
    }
  }
  return out;
}

/// The `pur_pay` / `pur_record` body of one payment (the web's paymentBody).
/// A buyer's petty cash and own money are their own: the server fills in the
/// person, so none is sent (R2).
Map<String, dynamic> paymentBody(PaymentInput p) => {
      // Two decimals as text: pur_money reads text, never a float's digits.
      'amount': round2(parseMoney(p.amount) ?? 0).toStringAsFixed(2),
      'paid_on': p.paidOn,
      'source': p.source,
      'method': p.source == 'credit' ? 'other' : p.method,
      'note': p.note.trim(),
      if (p.source == 'credit') 'credit_id': p.creditId,
      if ((p.proofUrl ?? '').isNotEmpty) 'proof_url': p.proofUrl,
    };

/// A return of petty cash the buyer reports (Q17). Only the owner's
/// confirmation lowers cash held, on the confirmation day (Q18).
class ReturnInput {
  const ReturnInput({this.amount = '', required this.handedOn, this.handedTo = '', this.note = ''});

  final String amount;
  final String handedOn;
  final String handedTo;
  final String note;

  Map<String, dynamic> toJson() => {
        // Two decimals as text, as pur_money reads it.
        'amount': round2(parseMoney(amount) ?? 0).toStringAsFixed(2),
        'handed_on': handedOn,
        'handed_to': handedTo.trim(),
        'note': note.trim(),
      };
}

enum ReturnProblem { badAmount, badDate }

/// What pur_cash_report_return would refuse: an amount above zero and a day
/// handed over, never in the future, from 2020 on. A return is never capped
/// by what is held (R11): it is real money the owner confirms.
List<ReturnProblem> returnProblems(ReturnInput r, {required String today}) => [
      if ((parseMoney(r.amount) ?? 0) <= 0) ReturnProblem.badAmount,
      if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(r.handedOn) || r.handedOn.compareTo(today) > 0 || r.handedOn.compareTo('2020-01-01') < 0)
        ReturnProblem.badDate,
    ];
```

**Modify:** `lib/purchasing/domain/pur_failure.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/domain/pur_failure.dart b/lib/purchasing/domain/pur_failure.dart
index ca2c218..24cc2f0 100644
--- a/lib/purchasing/domain/pur_failure.dart
+++ b/lib/purchasing/domain/pur_failure.dart
@@ -34,6 +34,28 @@ enum PurFailure {
   linesChanged,
   alreadyPending,
   reasonRequired,
+
+  // Payments, petty cash, own money (0102).
+  /// More than the supplier credit has left.
+  overCredit,
+
+  /// The supplier credit was voided, or is not there.
+  creditGone,
+
+  /// A credit with another supplier than the purchase's.
+  creditSupplier,
+
+  /// A refund or credit relies on this payment: the owner voids that first (R8).
+  resolvedFirst,
+
+  /// Only whoever recorded it (or the main owner) voids it (Q7).
+  notYours,
+
+  /// "I did not receive this" was already sent for that entry (Q14).
+  alreadyDisputed,
+
+  /// Petty cash and own money are a staff buyer's (R2).
+  notAHolder,
   invalid,
 
   /// A receipt photo of an unsent purchase is no longer on the phone.
@@ -76,6 +98,22 @@ enum PurFailure {
     'LINES_CHANGED': linesChanged,
     'ALREADY_PENDING': alreadyPending,
     'REASON_REQUIRED': reasonRequired,
+    'OVER_CREDIT': overCredit,
+    'CREDIT_GONE': creditGone,
+    'CREDIT_REQUIRED': creditGone,
+    'CREDIT_SUPPLIER': creditSupplier,
+    'RESOLVED_FIRST': resolvedFirst,
+    'NOT_YOURS': notYours,
+    'ALREADY_DISPUTED': alreadyDisputed,
+    'NOT_A_BUYER': notAHolder,
+    'PERSON_REQUIRED': notAHolder,
+    'PERSON_NOT_ALLOWED': notAHolder,
+    'ALREADY_VOIDED': notFound,
+    'BAD_PAY': invalid,
+    'BAD_PAY_SOURCE': invalid,
+    'BAD_METHOD': invalid,
+    'BAD_PERSON': invalid,
+    'BAD_NOTE': invalid,
     'BAD_DATE': invalid,
     'BAD_AMOUNT': invalid,
     'BAD_LINES': invalid,
@@ -197,6 +235,26 @@ Bilingual purFailureCopy(PurFailure f) => switch (f) {
           'A change for this purchase is already waiting for the owner.', 'May pagbabago nang naghihintay sa may-ari para dito.'),
       PurFailure.reasonRequired => const Bilingual(
           'Say why you are changing it.', 'Sabihin kung bakit mo ito binabago.'),
+      PurFailure.overCredit => const Bilingual(
+          'That is more than the supplier credit has left. Pay the rest another way.',
+          'Mas malaki iyan sa natitirang credit sa supplier. Bayaran ang kulang sa ibang paraan.'),
+      PurFailure.creditGone => const Bilingual(
+          'That supplier credit is no longer there. Choose another way to pay.',
+          'Wala na ang credit na iyon sa supplier. Pumili ng ibang paraan ng pagbayad.'),
+      PurFailure.creditSupplier => const Bilingual(
+          'That credit is with another supplier. Use it only on that supplier\'s purchases.',
+          'Sa ibang supplier ang credit na iyon. Gamitin lang sa binili sa supplier na iyon.'),
+      PurFailure.resolvedFirst => const Bilingual(
+          'A refund or credit relies on this payment. Ask the owner to void that first.',
+          'May refund o credit na nakasalalay sa bayad na ito. Ipa-void muna iyon sa may-ari.'),
+      PurFailure.notYours => const Bilingual(
+          'Only whoever recorded it, or the owner, can void it.', 'Ang nagtala lang nito, o ang may-ari, ang puwedeng mag-void.'),
+      PurFailure.alreadyDisputed => const Bilingual(
+          'You already said you did not receive this. The owner is checking it.',
+          'Nasabi mo na na hindi mo ito natanggap. Sinusuri na ng may-ari.'),
+      PurFailure.notAHolder => const Bilingual(
+          'Petty cash and own money are for staff buyers. Choose Company instead.',
+          'Ang petty cash at sariling pera ay para sa staff na bumibili. Piliin ang Kompanya.'),
       PurFailure.invalid => const Bilingual(
           'Something on the purchase is not filled in correctly. Check each line.',
           'May mali sa pagkakapuno ng purchase. Suriin ang bawat linya.'),
```

**Modify:** `lib/purchasing/domain/pur_models.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/domain/pur_models.dart b/lib/purchasing/domain/pur_models.dart
index c9e2db8..2c24570 100644
--- a/lib/purchasing/domain/pur_models.dart
+++ b/lib/purchasing/domain/pur_models.dart
@@ -2,6 +2,8 @@
 /// reads it. Numbers arrive as JSON numbers or numeric text; both are read.
 library;
 
+import 'pay_models.dart' show PayState;
+
 double _num(Object? v) => switch (v) {
       num n => n.toDouble(),
       String s => double.tryParse(s) ?? 0,
@@ -262,6 +264,8 @@ class MyPurchase {
     this.pendingChange = false,
     this.noReceiptReason = '',
     this.replacedBy,
+    this.supplierId,
+    this.pay = const PayState(),
   });
 
   factory MyPurchase.fromJson(Map<String, dynamic> j) => MyPurchase(
@@ -281,6 +285,8 @@ class MyPurchase {
         pendingChange: j['pending_change'] == true,
         noReceiptReason: _str(j['no_receipt_reason']),
         replacedBy: j['replaced_by'] as String?,
+        supplierId: j['supplier_id'] as String?,
+        pay: PayState.fromJson(j['pay'] == null ? null : Map<String, dynamic>.from(j['pay'] as Map)),
       );
 
   final String id;
@@ -300,6 +306,12 @@ class MyPurchase {
   final String noReceiptReason;
   final String? replacedBy;
 
+  /// The listed supplier (0103), for paying from that supplier's credit.
+  final String? supplierId;
+
+  /// How it is paid (0102): Unpaid / Partially paid / Paid / Overpaid.
+  final PayState pay;
+
   bool get voided => status == 'void';
 }
 
```

**Modify:** `lib/purchasing/domain/pur_op.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/domain/pur_op.dart b/lib/purchasing/domain/pur_op.dart
index 828554d..2daca1b 100644
--- a/lib/purchasing/domain/pur_op.dart
+++ b/lib/purchasing/domain/pur_op.dart
@@ -45,6 +45,7 @@ class PurOp {
     this.attempts = 0,
     this.lastError,
     this.failedPermanently = false,
+    this.sent = false,
   });
 
   factory PurOp.fromMap(Map<String, Object?> m) {
@@ -65,6 +66,7 @@ class PurOp {
       attempts: (m['attempts'] as int?) ?? 0,
       lastError: m['last_error'] as String?,
       failedPermanently: m['failed_permanently'] == 1,
+      sent: m['done_at'] != null,
     );
   }
 
@@ -90,6 +92,11 @@ class PurOp {
   final String? lastError;
   final bool failedPermanently;
 
+  /// R38: the server has it. Kept on the phone (never sent again) until every
+  /// saved copy that shows it counts it, so a copy read before it went still
+  /// shows it and no balance is ever wrong because of it.
+  final bool sent;
+
   Map<String, dynamic> get bodyJson => {
         'purchase': purchase,
         'company_id': companyId,
@@ -109,6 +116,7 @@ class PurOp {
         attempts: attempts,
         lastError: lastError,
         failedPermanently: failedPermanently,
+        sent: sent,
       );
 
   Map<String, Object?> toMap() => {
@@ -125,10 +133,25 @@ class PurOp {
       };
 }
 
-/// `purchases/<company>/<yyyy-mm>/<photo>.jpg` — the only shape 0097's
-/// receipt_uploads check and the buyer-only storage rule accept. The month is
-/// Manila's ([manilaNow] already shifted), as the web's local-parts month.
-String receiptPath({required String companyId, required DateTime manilaNow, required String photoId}) {
+/// `<folder>/<company>/<yyyy-mm>/<photo>.jpg` — the only shape the
+/// receipt_uploads check and the storage rules accept. [folder] is
+/// `purchases` (receipts and payment proofs, buyers of the company: 0097) or
+/// `pettyCash` (a return's photo: the main owner and its uploader only, 0102
+/// R13). The month is Manila's ([manilaNow] already shifted), as the web's
+/// local-parts month.
+String receiptPath({required String companyId, required DateTime manilaNow, required String photoId, String folder = 'purchases'}) {
   final ym = '${manilaNow.year.toString().padLeft(4, '0')}-${manilaNow.month.toString().padLeft(2, '0')}';
-  return 'purchases/${companyId.toLowerCase()}/$ym/${photoId.toLowerCase()}.jpg';
+  return '$folder/${companyId.toLowerCase()}/$ym/${photoId.toLowerCase()}.jpg';
 }
+
+/// What a queued op sends (0102). 'record' is a purchase (with any "paid
+/// now" payment inside it, one transaction); 'pay' a later payment on a
+/// recorded purchase (its proof photo under purchases/); 'cash_return' a
+/// return of petty cash (its photo under pettyCash/).
+const opRecord = 'record';
+const opPay = 'pay';
+const opCashReturn = 'cash_return';
+
+/// The upload kind and folder each op's photos go to.
+({String kind, String folder}) photoTarget(String opKind) =>
+    opKind == opCashReturn ? (kind: 'petty_cash', folder: 'pettyCash') : (kind: 'purchase', folder: 'purchases');
```

**Modify:** `lib/purchasing/domain/purchase_draft.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/domain/purchase_draft.dart b/lib/purchasing/domain/purchase_draft.dart
index c078250..c1822a4 100644
--- a/lib/purchasing/domain/purchase_draft.dart
+++ b/lib/purchasing/domain/purchase_draft.dart
@@ -1,4 +1,5 @@
 import '../../requests/domain/quantity.dart';
+import 'pay_models.dart';
 import 'pur_models.dart';
 
 const _keep = Object();
@@ -297,6 +298,11 @@ class PurchaseDraft {
     this.photos = const {},
     this.noReceipt = false,
     this.noReceiptReason = '',
+    this.paidNow = 'none',
+    this.paidAmount = '',
+    this.paidFrom = 'company',
+    this.paidMethod = 'cash',
+    this.paidCredit,
   });
 
   factory PurchaseDraft.fromJson(Map<String, dynamic> j) => PurchaseDraft(
@@ -313,6 +319,11 @@ class PurchaseDraft {
         photos: Map<String, String>.from((j['photos'] as Map?) ?? const {}),
         noReceipt: j['no_receipt'] == true,
         noReceiptReason: (j['no_receipt_reason'] as String?) ?? '',
+        paidNow: (j['paid_now'] as String?) ?? 'none',
+        paidAmount: (j['paid_amount'] as String?) ?? '',
+        paidFrom: (j['paid_from'] as String?) ?? 'company',
+        paidMethod: (j['paid_method'] as String?) ?? 'cash',
+        paidCredit: j['paid_credit'] as String?,
       );
 
   final String id;
@@ -336,6 +347,21 @@ class PurchaseDraft {
   final bool noReceipt;
   final String noReceiptReason;
 
+  /// "Paid now?" (0102, Q3): 'none' (Not paid yet), 'full' or 'part'. A
+  /// payment entered here is recorded in the SAME transaction as the
+  /// purchase: both or neither. Later payments go through Record payment.
+  final String paidNow;
+
+  /// The part paid, when [paidNow] is 'part'.
+  final String paidAmount;
+
+  /// petty_cash · own_money · company · credit (Q5).
+  final String paidFrom;
+  final String paidMethod;
+
+  /// The supplier credit used, when [paidFrom] is 'credit' (R10).
+  final String? paidCredit;
+
   /// Lines + fees − discounts, from what is typed (blank counts as 0).
   double get computedTotal {
     double v(String s) => parseMoney(s) ?? 0;
@@ -357,6 +383,11 @@ class PurchaseDraft {
     Map<String, String>? photos,
     bool? noReceipt,
     String? noReceiptReason,
+    String? paidNow,
+    String? paidAmount,
+    String? paidFrom,
+    String? paidMethod,
+    Object? paidCredit = _keep,
   }) =>
       PurchaseDraft(
         id: id,
@@ -372,6 +403,11 @@ class PurchaseDraft {
         photos: photos ?? this.photos,
         noReceipt: noReceipt ?? this.noReceipt,
         noReceiptReason: noReceiptReason ?? this.noReceiptReason,
+        paidNow: paidNow ?? this.paidNow,
+        paidAmount: paidAmount ?? this.paidAmount,
+        paidFrom: paidFrom ?? this.paidFrom,
+        paidMethod: paidMethod ?? this.paidMethod,
+        paidCredit: identical(paidCredit, _keep) ? this.paidCredit : paidCredit as String?,
       );
 
   Map<String, dynamic> toJson() => {
@@ -388,6 +424,11 @@ class PurchaseDraft {
         'photos': photos,
         'no_receipt': noReceipt,
         'no_receipt_reason': noReceiptReason,
+        'paid_now': paidNow,
+        'paid_amount': paidAmount,
+        'paid_from': paidFrom,
+        'paid_method': paidMethod,
+        'paid_credit': paidCredit,
       };
 }
 
@@ -436,6 +477,14 @@ enum ProblemKind {
   noReceiptReason,
   badTotal,
   totalMismatch,
+
+  // "Paid now?" (0102): the web's paidNowProblems codes.
+  paidAmount,
+  partNotLess,
+  personRequired,
+  badPaySource,
+  creditRequired,
+  overCredit,
 }
 
 class PurchaseProblem {
@@ -514,6 +563,47 @@ List<PurchaseProblem> purchaseProblems(PurchaseDraft d) {
   return out;
 }
 
+/// The payment "Paid now?" adds to the purchase, or null for Not paid yet.
+/// Paid in full sends the receipt total; the payment's date is the
+/// purchase's own date.
+PaymentInput? paidNowPayment(PurchaseDraft d) {
+  if (d.paidNow != 'full' && d.paidNow != 'part') return null;
+  final total = round2(parseMoney(d.receiptTotal) ?? 0);
+  return PaymentInput(
+    amount: d.paidNow == 'full' ? total.toStringAsFixed(2) : d.paidAmount,
+    paidOn: d.purchaseDate,
+    method: d.paidMethod,
+    source: d.paidFrom,
+    creditId: d.paidFrom == 'credit' ? d.paidCredit : null,
+  );
+}
+
+/// What "Paid now?" would have refused (the web's paidNowProblems).
+/// [holder]: this account holds petty cash (a staff buyer, R2);
+/// [creditLeft]: what the chosen credit has left, if known.
+List<PurchaseProblem> paidNowProblems(PurchaseDraft d, {required bool holder, double? creditLeft}) {
+  final pay = paidNowPayment(d);
+  if (pay == null) return const [];
+  final out = <PurchaseProblem>[];
+  final amount = parseMoney(pay.amount);
+  final total = parseMoney(d.receiptTotal) ?? 0;
+  if (amount == null || amount <= 0) {
+    out.add(const PurchaseProblem(ProblemKind.paidAmount));
+  } else if (d.paidNow == 'part' && amount >= total) {
+    out.add(const PurchaseProblem(ProblemKind.partNotLess));
+  }
+  if ((d.paidFrom == 'petty_cash' || d.paidFrom == 'own_money') && !holder) out.add(const PurchaseProblem(ProblemKind.personRequired));
+  if (!paySources.contains(d.paidFrom)) out.add(const PurchaseProblem(ProblemKind.badPaySource));
+  if (d.paidFrom == 'credit') {
+    if ((d.paidCredit ?? '').isEmpty) {
+      out.add(const PurchaseProblem(ProblemKind.creditRequired));
+    } else if (amount != null && amount > 0 && creditLeft != null && amount > creditLeft) {
+      out.add(const PurchaseProblem(ProblemKind.overCredit));
+    }
+  }
+  return out;
+}
+
 /// The pur_record body (0096/0097/0101) for a draft that has no problems.
 /// [docs]: receipt slot → uploaded link.
 Map<String, dynamic> purchaseBody(PurchaseDraft d, {Map<String, String> docs = const {}}) {
@@ -574,5 +664,6 @@ Map<String, dynamic> purchaseBody(PurchaseDraft d, {Map<String, String> docs = c
     'receipt_total': round2(parseMoney(d.receiptTotal) ?? 0),
     'lines': lines,
     'charges': charges,
+    if (paidNowPayment(d) case final pay?) 'payments': [paymentBody(pay)],
   };
 }
```

**Modify:** `lib/purchasing/sync/purchasing_sync.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/sync/purchasing_sync.dart b/lib/purchasing/sync/purchasing_sync.dart
index 5a39611..ce14412 100644
--- a/lib/purchasing/sync/purchasing_sync.dart
+++ b/lib/purchasing/sync/purchasing_sync.dart
@@ -10,9 +10,11 @@ import '../domain/pur_op.dart';
 /// A sane ceiling for one pass.
 const _maxPerRun = 50;
 
-/// Sends purchases recorded on the phone (Q7): for each, its receipt photos
-/// (each once: the link is kept between attempts), then pur_record with the
-/// op id minted at Send, so it is recorded once however often it is tried.
+/// Sends what was recorded on the phone (Q7; 0102 Q6): for each, its photos
+/// (each once: the link is kept between attempts), then the server call with
+/// the op id minted at Send, so it is recorded once however often it is
+/// tried — pur_record (a purchase, with any "paid now" payment inside it),
+/// pur_pay (a later payment) or pur_cash_report_return (a return).
 /// One account's queue, in order; stops at the first failure worth retrying.
 class PurchasingSync {
   PurchasingSync({required this.db, required this.remote, DateTime Function()? now}) : _now = now ?? DateTime.now;
@@ -44,6 +46,9 @@ class PurchasingSync {
         o = o.copyWith(companyId: await remote.company(userId));
         await db.updateOpBody(o.opId, o.bodyJson);
       }
+      // Receipts and payment proofs under purchases/; a return's photo under
+      // the private pettyCash/ (R13), each with its own upload kind.
+      final target = photoTarget(o.kind);
       final docs = <String, String>{};
       for (final e in o.receipts.entries) {
         var r = e.value;
@@ -55,17 +60,27 @@ class PurchasingSync {
         final file = File(r.local);
         if (!file.existsSync()) throw const PurFailureException(PurFailure.photoMissing);
         if (r.path == null) {
-          r = r.withPath(receiptPath(companyId: o.companyId!, manilaNow: manilaFields(_now()), photoId: r.photoId));
+          r = r.withPath(receiptPath(companyId: o.companyId!, manilaNow: manilaFields(_now()), photoId: r.photoId, folder: target.folder));
           o = o.copyWith(receipts: {...o.receipts, e.key: r});
           await db.updateOpBody(o.opId, o.bodyJson);
         }
-        final url = await remote.uploadReceipt(path: r.path!, localPath: file.path, companyId: o.companyId!, userId: userId);
+        final url = await remote.uploadReceipt(path: r.path!, localPath: file.path, companyId: o.companyId!, userId: userId, kind: target.kind);
         o = o.copyWith(receipts: {...o.receipts, e.key: r.withUrl(url)});
         await db.updateOpBody(o.opId, o.bodyJson);
         docs[e.key] = url;
       }
-      await remote.record(o.opId, {...o.purchase, 'docs': docs}, userId: userId);
-      await db.finishRecord(o.opId, o.draftId);
+      switch (o.kind) {
+        case opPay:
+          final payment = Map<String, dynamic>.from(o.purchase['payment'] as Map);
+          await remote.pay(o.opId, o.purchase['purchase_id'] as String, {...payment, 'proof_url': ?docs['proof']},
+              userId: userId);
+        case opCashReturn:
+          await remote.reportReturn(o.opId, o.purchase, docs['photo'] ?? '', userId: userId);
+        default:
+          await remote.record(o.opId, {...o.purchase, 'docs': docs}, userId: userId);
+      }
+      // R38: kept, marked sent, until every saved copy counts it.
+      await db.markSent(o.opId, o.draftId, _now());
       for (final r in o.receipts.values) {
         _discard(File(r.local)); // only now is the photo safe to delete
       }
```

**Create:** `lib/purchasing/ui/pay_copy.dart`

```dart
import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../domain/pay_models.dart';

// Q22: English, with the Tagalog line underneath. The words match Dacs Web's
// Purchasing tab (purchasing-admin-core.js PAY_STATE / PAY_SOURCE / PAY_METHOD).

/// A purchase's payment state (0102).
Bilingual payStateCopy(String state) => switch (state) {
      'unpaid' => const Bilingual('Unpaid', 'Hindi pa bayad'),
      'partial' => const Bilingual('Partially paid', 'Bahagyang bayad'),
      'paid' => const Bilingual('Paid', 'Bayad na'),
      'overpaid' => const Bilingual('Overpaid', 'Sobra ang bayad'),
      'void' => const Bilingual('Void', 'Void'),
      'void_paid' => const Bilingual('Voided — paid, to recover', 'Na-void — may bayad, babawiin'),
      _ => const Bilingual('Payment not tracked', 'Hindi naitala ang bayad'),
    };

/// Where the money came from (Q5).
Bilingual paySourceCopy(String source) => switch (source) {
      'petty_cash' => const Bilingual('Petty cash', 'Petty cash'),
      'own_money' => const Bilingual('My own money', 'Sariling pera'),
      'company' => const Bilingual('Company (paid directly)', 'Kompanya (direktang bayad)'),
      'credit' => const Bilingual('Supplier credit', 'Credit sa supplier'),
      _ => Bilingual(source, source),
    };

/// How it was handed over (Q5).
String payMethodLabel(String method) => switch (method) {
      'cash' => 'Cash',
      'gcash' => 'GCash',
      'bank_transfer' => 'Bank transfer',
      'check' => 'Check',
      'other' => 'Other',
      _ => method,
    };

/// "Paid now?" (Q3).
Bilingual paidNowCopy(String paidNow) => switch (paidNow) {
      'full' => const Bilingual('Paid in full', 'Bayad nang buo'),
      'part' => const Bilingual('Paid part (deposit)', 'Bahagyang bayad (deposito)'),
      _ => const Bilingual('Not paid yet', 'Hindi pa bayad'),
    };

/// What to do about each payment problem, before sending.
Bilingual payProblemCopy(PayProblem p) => switch (p) {
      PayProblem.badAmount => const Bilingual('Enter the amount paid.', 'Ilagay ang halagang ibinayad.'),
      PayProblem.badDate =>
        const Bilingual('Pick the day it was paid (not in the future).', 'Piliin ang araw ng pagbayad (hindi sa hinaharap).'),
      PayProblem.badSource => const Bilingual('Choose where the money came from.', 'Piliin kung saan galing ang pera.'),
      PayProblem.badMethod => const Bilingual('Choose how it was paid.', 'Piliin kung paano ibinayad.'),
      PayProblem.creditRequired => const Bilingual('Choose the supplier credit to use.', 'Piliin ang credit ng supplier na gagamitin.'),
      PayProblem.overCredit => const Bilingual('That is more than the credit has left.', 'Mas malaki iyan sa natitirang credit.'),
    };

const paidNowLabel = Bilingual('Paid now?', 'Binayaran na ba?');
const paidFromLabel = Bilingual('Paid from', 'Saan galing ang pera');
const recordPaymentLabel = Bilingual('Record payment', 'Itala ang bayad');
const paymentsLabel = Bilingual('Payments', 'Mga bayad');
const myCashLabel = Bilingual('My cash', 'Pera ko');
const cashHeldLabel = Bilingual('Petty cash held', 'Hawak na petty cash');
const returnWaitingLabel = Bilingual('Return waiting for the owner', 'Ibinalik, hinihintay ang may-ari');
const companyOwesMeLabel = Bilingual('Company owes me', 'Utang ng kompanya sa akin');
const reportReturnLabel = Bilingual('Report a return', 'Iulat ang ibinalik');
const notReceivedLabel = Bilingual('I did not receive this', 'Hindi ko ito natanggap');
const waitingToSendPayLabel = Bilingual('Waiting to send', 'Hinihintay maipadala');

/// "Unreconciled shortfall ₱530 — paid beyond the petty cash recorded" (Q16).
Bilingual shortfallCopy(String amount) => Bilingual('Shortfall $amount — paid beyond the petty cash recorded. The owner checks it.',
    'Kulang na $amount — lumampas ang bayad sa petty cash na naitala. Susuriin ng may-ari.');

/// Q16: the warning before paying more petty cash than is on record — never a refusal.
Bilingual overspendCopy(String held, String amount) => Bilingual(
    'You hold $held of petty cash on record. This payment is $amount. It is saved, and the owner sees the difference as a shortfall to check.',
    'May hawak kang $held na petty cash sa tala. Ang bayad na ito ay $amount. Maitatala ito, at makikita ng may-ari ang kulang para suriin.');

/// Own money paid while it was not allowed (Q21) — kept, but the owner decides.
const ownMoneyToReviewCopy = Bilingual('Paid with your own money while it was not allowed: the owner reviews it before the company owes it.',
    'Binayaran ng sariling pera kahit hindi pinayagan: susuriin muna ng may-ari bago ito maging utang ng kompanya.');
```

**Modify:** `lib/purchasing/ui/purchasing_copy.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/ui/purchasing_copy.dart b/lib/purchasing/ui/purchasing_copy.dart
index c92a348..98bfc68 100644
--- a/lib/purchasing/ui/purchasing_copy.dart
+++ b/lib/purchasing/ui/purchasing_copy.dart
@@ -21,6 +21,9 @@ const notArrangedLabel = Bilingual('Not arranged', 'Hindi pa naayos');
 const recordLabel = Bilingual('Record purchase', 'Itala ang binili');
 const noReceiptLabel = Bilingual('No receipt', 'Walang resibo');
 const waitingLabel = Bilingual('Waiting to send', 'Hinihintay maipadala');
+
+/// R38: the server has it; the list shown was read before it went (offline).
+const sentLabel = Bilingual('Sent — shows in the list when it next updates', 'Naipadala na — lalabas sa listahan sa susunod na update');
 const attentionLabel = Bilingual('Needs attention', 'Kailangang ayusin');
 const needsSignal = Bilingual('This needs signal. Try again when you are online.', 'Kailangan ng signal. Subukan ulit kapag online ka na.');
 
@@ -53,6 +56,14 @@ Bilingual problemCopy(ProblemKind k) => switch (k) {
       ProblemKind.badTotal => const Bilingual('Enter the total printed on the receipt.', 'Ilagay ang total na nakasulat sa resibo.'),
       ProblemKind.totalMismatch => const Bilingual('Items + fees − discounts do not match the receipt total.',
           'Hindi tugma ang items + bayad − diskwento sa total ng resibo.'),
+      ProblemKind.paidAmount => const Bilingual('Enter how much was paid now.', 'Ilagay kung magkano ang ibinayad ngayon.'),
+      ProblemKind.partNotLess => const Bilingual('A part payment is less than the receipt total. Choose Paid in full instead.',
+          'Ang bahagyang bayad ay mas mababa sa total ng resibo. Piliin ang Bayad nang buo.'),
+      ProblemKind.personRequired => const Bilingual('Petty cash and own money are for staff buyers. Choose Company.',
+          'Ang petty cash at sariling pera ay para sa staff na bumibili. Piliin ang Kompanya.'),
+      ProblemKind.badPaySource => const Bilingual('Choose where the money came from.', 'Piliin kung saan galing ang pera.'),
+      ProblemKind.creditRequired => const Bilingual('Choose the supplier credit to use.', 'Piliin ang credit ng supplier na gagamitin.'),
+      ProblemKind.overCredit => const Bilingual('That is more than the credit has left.', 'Mas malaki iyan sa natitirang credit.'),
     };
 
 /// The four receipt slots, as the Purchasing tab names them.
```


- [ ] **Step 1: Apply the files above** in the WorkMate repo.
- [ ] **Step 2: Tests.** `flutter test` → **885** passed; `flutter analyze` → no issues.
- [ ] **Step 3: Stop for the user** to review and commit.

### Task 3: WorkMate — the screens and 0.8.0+1009

**Interfaces used:** Task 2's only.

<!-- Tests -->

**Create:** `test/purchasing/pay/pay_screens_test.dart`

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/data/purchasing_api.dart';
import 'package:workmate/purchasing/domain/pay_models.dart';
import 'package:workmate/purchasing/domain/pur_failure.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/domain/pur_op.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';
import 'package:workmate/purchasing/mine/my_purchases_controller.dart';
import 'package:workmate/purchasing/mine/my_purchases_screen.dart';
import 'package:workmate/purchasing/mine/purchase_detail_screen.dart';
import 'package:workmate/purchasing/pay/my_cash_screen.dart';
import 'package:workmate/purchasing/pay/record_payment_screen.dart';
import 'package:workmate/purchasing/purchasing_services.dart';
import 'package:workmate/purchasing/record/record_controller.dart';
import 'package:workmate/purchasing/record/record_screen.dart';
import 'package:workmate/purchasing/ui/purchasing_copy.dart' show sentLabel;
import 'package:workmate/ui/theme.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../purchasing_api_fake.dart';

/// 2A-4b on the phone's screens: "Paid now?" (Q3), Record payment (Q6),
/// My purchases' payment line and the "My cash" card (Q23), My cash
/// (Q14, Q17), a purchase's Payments with Void (Q7).
void main() {
  late FakePurchasingApi api;
  late PurchasingServices services;
  var shots = 0;

  setUp(() {
    api = FakePurchasingApi();
    shots = 0;
    services = PurchasingServices(api: api, takePhoto: (_) async => 'shot${++shots}.jpg', pickPhoto: (_) async => 'gallery.jpg');
  });

  Future<void> show(WidgetTester tester, Widget screen) async {
    useTallPhone(tester);
    await tester.pumpWidget(MaterialApp(theme: workMateTheme(), home: screen));
    await tester.pumpAndSettle();
  }

  /// Scrolls the screen's list to [f], down or up.
  Future<void> reach(WidgetTester tester, Finder f, {required Key list}) async {
    if (f.evaluate().isEmpty) {
      final scroll = find.descendant(of: find.byKey(list), matching: find.byType(Scrollable)).first;
      try {
        await tester.scrollUntilVisible(f, 200, scrollable: scroll);
      } on StateError {
        await tester.scrollUntilVisible(f, -200, scrollable: scroll);
      }
    }
    await tester.ensureVisible(f);
    await tester.pumpAndSettle();
  }

  Future<void> choose(WidgetTester tester, Key dropdown, String item, {required Key list}) async {
    await reach(tester, find.byKey(dropdown), list: list);
    await tester.tap(find.byKey(dropdown));
    await tester.pumpAndSettle();
    await tester.tap(find.text(item).last);
    await tester.pumpAndSettle();
  }

  group('"Paid now?" on Record purchase (Q3)', () {
    const form = Key('record-form');
    PurchaseDraft draft({String total = '1250'}) => api
        .newDraft(lines: const [DraftPurchaseLine(key: 'k', itemName: 'ZZ cement', quantity: '1', amount: '1250', folderId: 'f1', unplannedReason: 'ZZ')])
        .copyWith(receiptTotal: total, photos: {'supplier_invoice_url': '/p/r.jpg'}, supplierId: 's1', supplierName: 'ZZ Hardware');

    Future<RecordController> open(WidgetTester tester, {PurchaseDraft? d}) async {
      final c = RecordController(api: api, draft: d ?? draft());
      await c.load();
      await show(tester, RecordScreen(controller: c, services: services));
      return c;
    }

    testWidgets('Not paid yet by default: nothing more is asked, nothing is paid', (tester) async {
      final c = await open(tester);
      await reach(tester, find.byKey(const Key('paid-now')), list: form);
      expect(find.text('Not paid yet · Hindi pa bayad'), findsOneWidget);
      expect(find.byKey(const Key('paid-method')), findsNothing);
      expect(paidNowPayment(c.draft), isNull);
    });

    testWidgets('Paid in full from petty cash: offered first to a staff buyer; sent with the purchase', (tester) async {
      final c = await open(tester);
      await choose(tester, const Key('paid-now'), 'Paid in full · Bayad nang buo', list: form);
      expect(c.draft.paidFrom, 'petty_cash');
      expect(find.byKey(const Key('paid-amount')), findsNothing, reason: 'in full: the receipt total');
      await reach(tester, find.byKey(const Key('record-send')), list: form);
      await tester.tap(find.byKey(const Key('record-send')));
      await tester.pumpAndSettle();
      expect(paymentBody(paidNowPayment(api.sent.single)!)['amount'], '1250.00');
    });

    testWidgets('Q16: paying more petty cash than held warns, never blocks', (tester) async {
      api.cash = const MyCashView(cash: MyCash(holder: true, recorded: 1000, held: 1000));
      final c = await open(tester);
      await choose(tester, const Key('paid-now'), 'Paid in full · Bayad nang buo', list: form);
      await reach(tester, find.byKey(const Key('paid-overspend')), list: form);
      expect(find.textContaining('You hold ₱1,000.00 of petty cash on record. This payment is ₱1,250.00.'), findsOneWidget);
      expect(c.overspend, (held: 1000.0, amount: 1250.0));
      await reach(tester, find.byKey(const Key('record-send')), list: form);
      await tester.tap(find.byKey(const Key('record-send')));
      await tester.pumpAndSettle();
      expect(api.sent, hasLength(1));
    });

    testWidgets('Paid part: the amount must be less than the total', (tester) async {
      final c = await open(tester);
      await choose(tester, const Key('paid-now'), 'Paid part (deposit) · Bahagyang bayad (deposito)', list: form);
      await reach(tester, find.byKey(const Key('paid-amount')), list: form);
      await tester.enterText(find.byKey(const Key('paid-amount')), '1250');
      await reach(tester, find.byKey(const Key('record-send')), list: form);
      await tester.tap(find.byKey(const Key('record-send')));
      await tester.pumpAndSettle();
      expect(api.sent, isEmpty);
      expect(c.problems.map((p) => p.kind), contains(ProblemKind.partNotLess));
      await reach(tester, find.byKey(const Key('problem-partNotLess-0')), list: form);
      expect(find.text('Ang bahagyang bayad ay mas mababa sa total ng resibo. Piliin ang Bayad nang buo.'), findsOneWidget);
    });

    testWidgets('own money only while allowed (Q21); a credit only for this supplier, within what is left (R10)', (tester) async {
      api.cash = const MyCashView(
        cash: MyCash(holder: true, recorded: 5000, held: 5000, ownMoney: true),
        credits: [
          SupplierCredit(id: 'c1', supplierId: 's1', supplier: 'ZZ Hardware', amount: 200, left: 80),
          SupplierCredit(id: 'c9', supplierId: 's9', supplier: 'Other', amount: 500, left: 500),
        ],
      );
      final c = await open(tester);
      expect(c.paySources, ['petty_cash', 'own_money', 'company', 'credit']);
      expect(c.credits.map((x) => x.id), ['c1'], reason: 'another supplier\'s credit is not offered');
      await choose(tester, const Key('paid-now'), 'Paid in full · Bayad nang buo', list: form);
      c.setPaidFrom('credit');
      await tester.pumpAndSettle();
      expect(c.draft.paidCredit, 'c1');
      await reach(tester, find.byKey(const Key('paid-credit')), list: form);
      expect(find.text('ZZ Hardware — ₱80.00 left'), findsOneWidget);
      expect(await c.send(), isFalse);
      expect(c.problems.map((p) => p.kind), contains(ProblemKind.overCredit));
      c.setSupplier(null);
      expect([c.draft.paidFrom, c.draft.paidCredit], ['petty_cash', null], reason: 'a typed supplier has no credit');
    });

    testWidgets('a staff buyer while "May use own money" is off: no own money (Q21)', (tester) async {
      api.cash = const MyCashView(cash: MyCash(holder: true, recorded: 500, held: 500, ownMoney: false));
      final c = await open(tester);
      expect(c.paySources, ['petty_cash', 'company']);
    });

    testWidgets('an owner account (not a staff buyer) is offered company money only (R2)', (tester) async {
      api.cash = const MyCashView(cash: MyCash(holder: false));
      final c = await open(tester);
      expect(c.paySources, ['company']);
      c.setPaidNow('full');
      expect(c.draft.paidFrom, 'company');
    });
  });

  group('Record payment (Q6)', () {
    const list = Key('pay-form');
    Future<void> open(WidgetTester tester, {double left = 700, String? supplierId = 's1'}) => show(
        tester, RecordPaymentScreen(services: services, purchaseId: 'pu1', supplier: 'ZZ Hardware', supplierId: supplierId, left: left));

    testWidgets('starts from what is left, petty cash for a staff buyer; queued with its proof', (tester) async {
      await open(tester);
      expect(find.text('₱700.00 left to pay'), findsOneWidget);
      expect((tester.widget(find.byKey(const Key('pay-amount'))) as TextField).controller!.text, '700.00');
      await reach(tester, find.byKey(const Key('pay-proof-camera')), list: list);
      await tester.tap(find.byKey(const Key('pay-proof-camera')));
      await tester.pumpAndSettle();
      await reach(tester, find.byKey(const Key('pay-save')), list: list);
      await tester.tap(find.byKey(const Key('pay-save')));
      await tester.pumpAndSettle();
      final (id, input, proof) = api.paid.single;
      expect([id, input.amount, input.source, input.paidOn, proof], ['pu1', '700.00', 'petty_cash', '2026-10-21', '/kept/shot1.jpg']);
    });

    testWidgets('Q16: over the cash held warns; Q6 refusals are shown, nothing queued', (tester) async {
      await open(tester, left: 2000);
      expect(find.byKey(const Key('pay-overspend')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('pay-amount')), '0');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pay-overspend')), findsNothing);
      await reach(tester, find.byKey(const Key('pay-save')), list: list);
      await tester.tap(find.byKey(const Key('pay-save')));
      await tester.pumpAndSettle();
      expect(api.paid, isEmpty);
      await reach(tester, find.byKey(const Key('pay-problem-badAmount')), list: list);
      expect(find.text('Ilagay ang halagang ibinayad.'), findsOneWidget);
    });

    testWidgets('a credit is "other", with its own picker and no method', (tester) async {
      api.cash = const MyCashView(
          cash: MyCash(holder: true, recorded: 5000, held: 5000),
          credits: [SupplierCredit(id: 'c1', supplierId: 's1', supplier: 'ZZ Hardware', amount: 200, left: 80)]);
      await open(tester, left: 50);
      await choose(tester, const ValueKey('pay-source-petty_cash,company,credit'), 'Supplier credit', list: list);
      expect(find.byKey(const Key('pay-method')), findsNothing);
      expect(find.text('ZZ Hardware — ₱80.00 left'), findsOneWidget);
      await reach(tester, find.byKey(const Key('pay-save')), list: list);
      await tester.tap(find.byKey(const Key('pay-save')));
      await tester.pumpAndSettle();
      expect([api.paid.single.$2.source, api.paid.single.$2.creditId], ['credit', 'c1']);
    });

    testWidgets('R39: Back during a slow Save waits; the proof handed to the queue is never deleted', (tester) async {
      useTallPhone(tester);
      bool? queued;
      await tester.pumpWidget(MaterialApp(
        theme: workMateTheme(),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async =>
                  queued = await openRecordPayment(context, services, purchaseId: 'pu1', supplier: 'ZZ Hardware', supplierId: 's1', left: 700),
              child: const Text('open'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await reach(tester, find.byKey(const Key('pay-proof-camera')), list: list);
      await tester.tap(find.byKey(const Key('pay-proof-camera')));
      await tester.pumpAndSettle();
      final gate = Completer<void>();
      api.saveGate = gate;
      await reach(tester, find.byKey(const Key('pay-save')), list: list);
      await tester.tap(find.byKey(const Key('pay-save')));
      await tester.pump();
      await tester.state<NavigatorState>(find.byType(Navigator)).maybePop();
      await tester.pump();
      // A closed screen is still drawn while it slides out: ask whether it is still the current one.
      expect(ModalRoute.of(tester.element(find.byType(RecordPaymentScreen)))!.isCurrent, isTrue, reason: 'Back waits for Save');
      gate.complete();
      await tester.pumpAndSettle();
      expect(find.byType(RecordPaymentScreen), findsNothing);
      expect(queued, isTrue);
      expect(api.paid.single.$3, '/kept/shot1.jpg');
      expect(api.calls.where((c) => c.startsWith('discardPhoto')), isEmpty, reason: 'the queue owns the proof now');
    });

    testWidgets('R39: a payment closed by the app during a slow Save keeps its proof for the queue', (tester) async {
      useTallPhone(tester);
      await tester.pumpWidget(MaterialApp(
        theme: workMateTheme(),
        home: RecordPaymentScreen(services: services, purchaseId: 'pu1', supplier: 'ZZ Hardware', supplierId: 's1', left: 700),
      ));
      await tester.pumpAndSettle();
      await reach(tester, find.byKey(const Key('pay-proof-camera')), list: list);
      await tester.tap(find.byKey(const Key('pay-proof-camera')));
      await tester.pumpAndSettle();
      final gate = Completer<void>();
      api.saveGate = gate;
      await reach(tester, find.byKey(const Key('pay-save')), list: list);
      await tester.tap(find.byKey(const Key('pay-save')));
      await tester.pump();
      // The app replaces the screen (e.g. signed out) while the Save is under way.
      await tester.pumpWidget(const SizedBox());
      gate.complete();
      await tester.pump();
      expect(api.paid.single.$3, '/kept/shot1.jpg');
      expect(api.calls.where((c) => c.startsWith('discardPhoto')), isEmpty, reason: 'the queue owns the proof now');
    });

    testWidgets('leaving without saving throws the proof photo away', (tester) async {
      await open(tester);
      await reach(tester, find.byKey(const Key('pay-proof-gallery')), list: list);
      await tester.tap(find.byKey(const Key('pay-proof-gallery')));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      expect(api.calls, contains('discardPhoto:/kept/gallery.jpg'));
    });
  });

  group('My purchases: the payment line and the "My cash" card (Q23)', () {
    MyPurchase row(String id, Map<String, dynamic> pay, {String status = 'recorded'}) =>
        MyPurchase.fromJson({'id': id, 'status': status, 'supplier': 'ZZ Hardware', 'supplier_id': 's1', 'receipt_total': 1000, 'pay': pay});

    Future<MyPurchasesController> open(WidgetTester tester) async {
      final c = MyPurchasesController(api: api);
      await c.refresh();
      await show(tester, Scaffold(body: MyPurchasesScreen(controller: c, onOpenDraft: (_) {}, onOpenPurchase: (_) {}, services: services)));
      return c;
    }

    testWidgets('left to pay counts payments still on the phone; one refused shows why and can be thrown away', (tester) async {
      api.mine = MyPurchasesView(
        purchases: [
          row('pu1', {'state': 'partial', 'tracked': true, 'due': 1000, 'paid': 300, 'balance': 700}),
          row('pu2', {'state': 'not_tracked'}),
          row('pu3', {'state': 'overpaid', 'tracked': true, 'due': 1000, 'paid': 1500, 'unresolved': 500}),
        ],
        queuedPayments: const [
          QueuedCashAction(opId: 'op1', kind: opPay, body: {'purchase_id': 'pu1', 'payment': {'amount': '200.00', 'source': 'petty_cash'}}, state: QueuedState.waiting),
          QueuedCashAction(
              opId: 'op2', kind: opPay, body: {'purchase_id': 'pu1', 'payment': {'amount': '50.00', 'source': 'company'}},
              state: QueuedState.needsAttention, failure: PurFailure.alreadyVoided),
        ],
      );
      await open(tester);
      expect(find.text('That purchase is no longer recorded (it was voided or replaced).'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('throw-pay-op2')));
      await tester.tap(find.byKey(const Key('throw-pay-op2')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('discardAction:op2'));
      await tester.scrollUntilVisible(find.text('₱500.00 left · ₱200.00 waiting to send'), 200);
      expect(find.text('₱500.00 left · ₱200.00 waiting to send'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('₱500.00 over — the owner resolves it'), 200);
      expect(find.byKey(const Key('pay-line-pu2')), findsNothing, reason: 'Q2: payment not tracked');
    });

    testWidgets('R38: on My purchases a sent payment is "not in this list yet", never "waiting to send"', (tester) async {
      api.mine = MyPurchasesView(
        purchases: [row('pu1', {'state': 'partial', 'tracked': true, 'due': 1000, 'paid': 300, 'balance': 700})],
        queuedPayments: const [
          QueuedCashAction(opId: 'op1', kind: opPay, body: {'purchase_id': 'pu1', 'payment': {'amount': '200.00', 'source': 'petty_cash'}}, state: QueuedState.sent),
        ],
        fromCache: true,
      );
      await open(tester);
      expect(find.text(sentLabel.english), findsOneWidget);
      await tester.scrollUntilVisible(find.text('₱500.00 left · ₱200.00 not in this list yet'), 200);
      expect(find.text('₱500.00 left · ₱200.00 not in this list yet'), findsOneWidget);
    });

    testWidgets('the card: cash held never below zero, the shortfall said; a waiting return beside it', (tester) async {
      api.cash = const MyCashView(
        cash: MyCash(holder: true, recorded: 470, held: 470, owes: 50),
        unsentPettyCash: 1000,
        queued: [QueuedCashAction(opId: 'r1', kind: opCashReturn, body: {'amount': '100.00'}, state: QueuedState.waiting)],
      );
      await open(tester);
      expect(find.descendant(of: find.byKey(const Key('cash-held')), matching: find.text('₱0.00')), findsOneWidget);
      expect(find.byKey(const Key('cash-shortfall')), findsOneWidget);
      expect(find.textContaining('Shortfall ₱530.00'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('cash-waiting')), matching: find.text('₱100.00')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('cash-owes')), matching: find.text('₱50.00')), findsOneWidget);
    });

    testWidgets('an owner account has no card (no petty cash, R2)', (tester) async {
      api.cash = const MyCashView(cash: MyCash(holder: false));
      await open(tester);
      expect(find.byKey(const Key('my-cash-card')), findsNothing);
    });

    testWidgets('Record payment opens from the row', (tester) async {
      api.mine = MyPurchasesView(purchases: [row('pu1', {'state': 'unpaid', 'tracked': true, 'due': 1000, 'balance': 1000})]);
      await open(tester);
      await tester.tap(find.byKey(const Key('pay-pu1')));
      await tester.pumpAndSettle();
      expect(find.byType(RecordPaymentScreen), findsOneWidget);
      expect(find.text('₱1,000.00 left to pay'), findsOneWidget);
    });
  });

  group('My cash (Q14, Q17)', () {
    const list = Key('my-cash');
    testWidgets('"I did not receive this" needs a note and needs signal; a waiting return can be taken back', (tester) async {
      api.cash = const MyCashView(
        cash: MyCash(
          holder: true,
          recorded: 1470,
          held: 1470,
          issues: [CashIssue(id: 'i1', amount: 4500, issuedOn: '2026-10-22', method: 'cash'), CashIssue(id: 'i2', amount: 500, issuedOn: '2026-10-22', disputedAt: 'x')],
          returns: [CashReturn(id: 'r1', amount: 1000, handedOn: '2026-10-23', status: 'reported')],
        ),
      );
      await show(tester, MyCashScreen(services: services));
      expect(find.byKey(const Key('dispute-i2')), findsNothing, reason: 'one flag per entry');
      await tester.tap(find.byKey(const Key('dispute-i1')));
      await tester.pumpAndSettle();
      expect(tester.widget<TextButton>(find.byKey(const Key('note-send'))).onPressed, isNull, reason: 'a note is required');
      await tester.enterText(find.byKey(const Key('note-field')), 'never got it');
      await tester.pump();
      await tester.tap(find.byKey(const Key('note-send')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('dispute:i1:never got it'));
      await reach(tester, find.byKey(const Key('withdraw-r1')), list: list);
      await tester.tap(find.byKey(const Key('withdraw-r1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('withdraw-yes')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('withdraw:r1'));
    });

    testWidgets('no signal: the online action says so; nothing changes', (tester) async {
      api.cash = const MyCashView(cash: MyCash(holder: true, issues: [CashIssue(id: 'i1', amount: 100, issuedOn: '2026-10-22')]));
      await show(tester, MyCashScreen(services: services));
      await tester.tap(find.byKey(const Key('dispute-i1')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('note-field')), 'x');
      await tester.pump();
      api.error = const SocketException('down');
      await tester.tap(find.byKey(const Key('note-send')));
      await tester.pumpAndSettle();
      expect(find.text('Kailangan ng signal. Subukan ulit kapag online ka na.'), findsOneWidget);
    });

    testWidgets('report a return: amount, day, to whom, a photo — queued (Q17)', (tester) async {
      await show(tester, MyCashScreen(services: services));
      await tester.tap(find.byKey(const Key('report-return')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('return-amount')), '1000');
      await tester.enterText(find.byKey(const Key('return-to')), 'the owner');
      await tester.tap(find.byKey(const Key('return-photo-camera')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('return-save')));
      await tester.tap(find.byKey(const Key('return-save')));
      await tester.pumpAndSettle();
      final (r, photo) = api.returned.single;
      expect([r.amount, r.handedOn, r.handedTo, photo], ['1000', '2026-10-21', 'the owner', '/kept/shot1.jpg']);
    });

    testWidgets('R39: a return\'s photo survives Back during a slow Save', (tester) async {
      await show(tester, MyCashScreen(services: services));
      await tester.tap(find.byKey(const Key('report-return')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('return-amount')), '200');
      await tester.tap(find.byKey(const Key('return-photo-camera')));
      await tester.pumpAndSettle();
      final gate = Completer<void>();
      api.saveGate = gate;
      await tester.ensureVisible(find.byKey(const Key('return-save')));
      await tester.tap(find.byKey(const Key('return-save')));
      await tester.pump();
      await tester.state<NavigatorState>(find.byType(Navigator)).maybePop();
      await tester.pump();
      // A closed screen is still drawn while it slides out: ask whether it is still the current one.
      expect(ModalRoute.of(tester.element(find.byKey(const Key('return-save'))))!.isCurrent, isTrue, reason: 'Back waits for Save');
      gate.complete();
      await tester.pumpAndSettle();
      expect(api.returned.single.$2, '/kept/shot1.jpg');
      expect(api.calls.where((c) => c.startsWith('discardPhoto')), isEmpty);
    });

    testWidgets('R39: a return closed by the app during a slow Save keeps its photo for the queue', (tester) async {
      await show(tester, MyCashScreen(services: services));
      await tester.tap(find.byKey(const Key('report-return')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('return-amount')), '200');
      await tester.tap(find.byKey(const Key('return-photo-camera')));
      await tester.pumpAndSettle();
      final gate = Completer<void>();
      api.saveGate = gate;
      await tester.ensureVisible(find.byKey(const Key('return-save')));
      await tester.tap(find.byKey(const Key('return-save')));
      await tester.pump();
      // The app replaces the screen (e.g. signed out) while the Save is under way.
      await tester.pumpWidget(const SizedBox());
      gate.complete();
      await tester.pump();
      expect(api.returned.single.$2, '/kept/shot1.jpg');
      expect(api.calls.where((c) => c.startsWith('discardPhoto')), isEmpty, reason: 'the queue owns the photo now');
    });

    testWidgets('never read and no signal: it says to connect once', (tester) async {
      api.cash = const MyCashView();
      await show(tester, MyCashScreen(services: services));
      expect(find.text('Connect once to see your cash.'), findsOneWidget);
    });
  });

  group('a purchase\'s Payments (Q7)', () {
    testWidgets('each payment with its source and notes; Void needs a reason; Record payment from here', (tester) async {
      api.detail = PurchaseDetail.fromJson(const {'id': 'pu1', 'status': 'recorded', 'supplier': 'ZZ Hardware', 'receipt_total': 1000});
      api.payments = PurchasePayments.fromJson({
        'pay': {'state': 'partial', 'tracked': true, 'due': 1000, 'paid': 300, 'balance': 700},
        'payments': [
          {'id': 'p1', 'amount': 300, 'paid_on': '2026-10-22', 'source': 'petty_cash', 'method': 'cash', 'created_by_name': 'staff', 'can_void': true, 'moved': true},
          {'id': 'p2', 'amount': 100, 'paid_on': '2026-10-22', 'source': 'own_money', 'method': 'cash', 'authorized': false, 'can_void': true,
            'rejected_at': 'x', 'reject_reason': 'ZZ not approved', 'voided_at': 'y', 'void_reason': 'twice'},
        ],
        'me': {'holder': true},
      });
      await show(tester, PurchaseDetailScreen(purchaseId: 'pu1', services: services));
      expect(find.textContaining('carried over from the earlier version'), findsOneWidget);
      expect(find.textContaining('rejected by the owner: ZZ not approved — not owed'), findsOneWidget);
      expect(find.byKey(const Key('void-p2')), findsNothing, reason: 'already void');
      await tester.ensureVisible(find.byKey(const Key('void-p1')));
      await tester.tap(find.byKey(const Key('void-p1')));
      await tester.pumpAndSettle();
      expect(tester.widget<TextButton>(find.byKey(const Key('void-yes'))).onPressed, isNull);
      await tester.enterText(find.byKey(const Key('void-reason')), 'paid twice');
      await tester.pump();
      await tester.tap(find.byKey(const Key('void-yes')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('voidPayment:p1:paid twice'));
      await tester.ensureVisible(find.byKey(const Key('detail-pay')));
      await tester.tap(find.byKey(const Key('detail-pay')));
      await tester.pumpAndSettle();
      expect(find.text('₱700.00 left to pay'), findsOneWidget);
    });

    testWidgets('payments waiting on the phone show on the purchase and count in what is left — never offered twice', (tester) async {
      api.detail = PurchaseDetail.fromJson(const {'id': 'pu1', 'status': 'recorded', 'supplier': 'ZZ Hardware', 'receipt_total': 1000});
      api.payments = PurchasePayments.fromJson({
        'pay': {'state': 'partial', 'tracked': true, 'due': 1000, 'paid': 300, 'balance': 700},
        'payments': [],
        'me': {'holder': true},
      });
      api.queuedFor = const [
        QueuedCashAction(opId: 'op1', kind: opPay, body: {'purchase_id': 'pu1', 'payment': {'amount': '300.00', 'source': 'petty_cash'}}, state: QueuedState.waiting),
      ];
      await show(tester, PurchaseDetailScreen(purchaseId: 'pu1', services: services));
      expect(find.text('Receipt ₱1,000.00 · paid ₱300.00 · left ₱400.00 · ₱300.00 waiting to send'), findsOneWidget);
      expect(find.byKey(const Key('payment-queued-op1')), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('detail-pay')));
      await tester.tap(find.byKey(const Key('detail-pay')));
      await tester.pumpAndSettle();
      expect(find.text('₱400.00 left to pay'), findsOneWidget);
    });

    testWidgets('R38: a payment sent after the list was read says so, and still counts in what is left', (tester) async {
      api.detail = PurchaseDetail.fromJson(const {'id': 'pu1', 'status': 'recorded', 'supplier': 'ZZ Hardware', 'receipt_total': 1000});
      api.payments = PurchasePayments.fromJson({
        'pay': {'state': 'partial', 'tracked': true, 'due': 1000, 'paid': 300, 'balance': 700},
        'payments': [],
        'me': {'holder': true},
      });
      api.queuedFor = const [
        QueuedCashAction(opId: 'op1', kind: opPay, body: {'purchase_id': 'pu1', 'payment': {'amount': '300.00', 'source': 'petty_cash'}}, state: QueuedState.sent),
      ];
      await show(tester, PurchaseDetailScreen(purchaseId: 'pu1', services: services));
      expect(find.text('Receipt ₱1,000.00 · paid ₱300.00 · left ₱400.00 · ₱300.00 not in this list yet'), findsOneWidget);
      expect(find.textContaining(sentLabel.english), findsOneWidget);
    });

    testWidgets('a purchase from before payments were tracked offers no Record payment (Q2, R34)', (tester) async {
      api.detail = PurchaseDetail.fromJson(const {'id': 'pu1', 'status': 'recorded', 'supplier': 'ZZ Hardware', 'receipt_total': 1000});
      api.payments = PurchasePayments.fromJson({'pay': {'state': 'not_tracked', 'tracked': false, 'due': 1000, 'balance': 1000}, 'payments': []});
      await show(tester, PurchaseDetailScreen(purchaseId: 'pu1', services: services));
      expect(find.text('Recorded before payments were tracked.'), findsOneWidget);
      expect(find.byKey(const Key('detail-pay')), findsNothing);
    });

    testWidgets('no signal for the payments: the purchase still shows', (tester) async {
      api.detail = PurchaseDetail.fromJson(const {'id': 'pu1', 'status': 'recorded', 'supplier': 'ZZ Hardware'});
      api.paymentsError = const SocketException('down');
      await show(tester, PurchaseDetailScreen(purchaseId: 'pu1', services: services));
      expect(find.text('ZZ Hardware'), findsOneWidget);
      expect(find.byKey(const Key('payments-offline')), findsOneWidget);
    });
  });
}
```

**Modify:** `test/purchasing/record/record_screen_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/purchasing/record/record_screen_test.dart b/test/purchasing/record/record_screen_test.dart
index bd1295a..abeba47 100644
--- a/test/purchasing/record/record_screen_test.dart
+++ b/test/purchasing/record/record_screen_test.dart
@@ -46,9 +46,16 @@ void main() {
 
   // The form's own list (every text field has a Scrollable of its own), then
   // all of the widget on screen: scrollUntilVisible stops at its first pixel.
+  // A target already built (above the screen as well as below) is brought into view directly.
   Future<void> scrollTo(WidgetTester tester, Finder f, {double step = 200}) async {
-    await tester.scrollUntilVisible(f, step,
-        scrollable: find.descendant(of: find.byKey(const Key('record-form')), matching: find.byType(Scrollable)).first);
+    if (f.evaluate().isEmpty) {
+      final list = find.descendant(of: find.byKey(const Key('record-form')), matching: find.byType(Scrollable)).first;
+      try {
+        await tester.scrollUntilVisible(f, step, scrollable: list);
+      } on StateError {
+        await tester.scrollUntilVisible(f, -step, scrollable: list); // it is above
+      }
+    }
     await tester.ensureVisible(f);
     await tester.pumpAndSettle();
   }
```

<!-- Code -->

**Modify:** `lib/purchasing/mine/my_purchases_controller.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/mine/my_purchases_controller.dart b/lib/purchasing/mine/my_purchases_controller.dart
index 0f210e8..c9949d7 100644
--- a/lib/purchasing/mine/my_purchases_controller.dart
+++ b/lib/purchasing/mine/my_purchases_controller.dart
@@ -14,12 +14,19 @@ class MyPurchasesController extends ChangeNotifier {
   final PurchasingApi api;
 
   MyPurchasesView view = const MyPurchasesView();
+
+  /// The "My cash" card (0102, Q23): the buyer's own cash, fresh or saved.
+  MyCashView cash = const MyCashView();
   List<PurchaseDraft> drafts = const [];
   bool loading = false;
   Bilingual? notice;
 
-  /// Needs attention: shown as a number on the tab.
-  int get attention => view.queued.where((q) => q.state == QueuedState.needsAttention).length;
+  /// Needs attention: shown as a number on the tab (refused payments and
+  /// returns too: each needs the buyer to look).
+  int get attention =>
+      view.queued.where((q) => q.state == QueuedState.needsAttention).length +
+      view.queuedPayments.where((q) => q.state == QueuedState.needsAttention).length +
+      cash.queuedReturns.where((q) => q.state == QueuedState.needsAttention).length;
 
   Future<void> refresh() async {
     loading = true;
@@ -27,6 +34,11 @@ class MyPurchasesController extends ChangeNotifier {
     try {
       drafts = await api.drafts();
       view = await api.myPurchases();
+      try {
+        cash = await api.myCash();
+      } catch (_) {
+        // The card waits for the first read; the purchases still show.
+      }
     } catch (e) {
       notice = purFailureCopy(PurFailure.of(e));
     } finally {
@@ -47,6 +59,12 @@ class MyPurchasesController extends ChangeNotifier {
     await refresh();
   }
 
+  /// A refused payment thrown away (with its proof photo).
+  Future<void> throwAwayPayment(QueuedCashAction q) async {
+    await api.discardAction(q.opId);
+    await refresh();
+  }
+
   Future<void> deleteDraft(PurchaseDraft d) async {
     await api.deleteDraft(d);
     await refresh();
```

**Modify:** `lib/purchasing/mine/my_purchases_screen.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/mine/my_purchases_screen.dart b/lib/purchasing/mine/my_purchases_screen.dart
index 91c7cd9..8bee77d 100644
--- a/lib/purchasing/mine/my_purchases_screen.dart
+++ b/lib/purchasing/mine/my_purchases_screen.dart
@@ -8,6 +8,11 @@ import '../data/purchasing_api.dart';
 import '../domain/pur_failure.dart';
 import '../domain/pur_models.dart';
 import '../domain/purchase_draft.dart';
+import '../pay/my_cash_screen.dart';
+import '../pay/record_payment_screen.dart';
+import '../purchasing_services.dart';
+import '../ui/pay_copy.dart';
+import '../ui/pay_widgets.dart';
 import '../ui/purchasing_copy.dart';
 import 'my_purchases_controller.dart';
 
@@ -22,14 +27,33 @@ List<(String, Color, Color)> purchaseFlags(MyPurchase p) => [
     ];
 
 class MyPurchasesScreen extends StatelessWidget {
-  const MyPurchasesScreen({super.key, required this.controller, required this.onOpenDraft, required this.onOpenPurchase});
+  const MyPurchasesScreen({super.key, required this.controller, required this.onOpenDraft, required this.onOpenPurchase, this.services});
 
   final MyPurchasesController controller;
 
+  /// For Record payment and My cash (0102); none in screens that only list.
+  final PurchasingServices? services;
+
   /// Continue a draft (or a refused purchase sent back to editing).
   final void Function(PurchaseDraft draft) onOpenDraft;
   final void Function(MyPurchase purchase) onOpenPurchase;
 
+  Future<void> _openCash(BuildContext context) async {
+    final s = services;
+    if (s == null) return;
+    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => MyCashScreen(services: s)));
+    await controller.refresh();
+  }
+
+  /// Q6: a later payment — also with no signal; what is left counts payments still on the phone.
+  Future<void> _pay(BuildContext context, MyPurchase p) async {
+    final s = services;
+    if (s == null) return;
+    final queued = await openRecordPayment(context, s,
+        purchaseId: p.id, supplier: p.supplier, supplierId: p.supplierId, left: p.pay.leftAfter(controller.view.unsentFor(p.id)));
+    if (queued) await controller.refresh();
+  }
+
   Future<void> _fix(QueuedPurchase q) async {
     final d = await controller.edit(q);
     if (d != null) onOpenDraft(d);
@@ -58,10 +82,17 @@ class MyPurchasesScreen extends StatelessWidget {
                   style: const TextStyle(color: WmColors.brownDeep, fontWeight: FontWeight.w600),
                 ),
               ],
-              if (v.queued.isNotEmpty) ...[
+              if (services != null) ...[const SizedBox(height: 10), MyCashCard(view: c.cash, onOpen: () => _openCash(context))],
+              if (v.queued.isNotEmpty || v.queuedPayments.isNotEmpty) ...[
                 const SizedBox(height: 16),
                 const BilingualText(Bilingual('Not sent yet', 'Hindi pa naipapadala'), style: monoLabel),
                 for (final q in v.queued) _QueuedCard(q: q, onFix: () => _fix(q), onThrowAway: () => c.throwAway(q)),
+                for (final q in v.queuedPayments)
+                  _QueuedPaymentCard(
+                    q: q,
+                    supplier: v.purchases.where((p) => p.id == q.purchaseId).firstOrNull?.supplier ?? '',
+                    onThrowAway: () => c.throwAwayPayment(q),
+                  ),
               ],
               if (c.drafts.isNotEmpty) ...[
                 const SizedBox(height: 16),
@@ -99,6 +130,7 @@ class MyPurchasesScreen extends StatelessWidget {
                             style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
                         const SizedBox(height: 6),
                         Wrap(spacing: 6, runSpacing: 6, children: [for (final f in purchaseFlags(p)) _Flag(f)]),
+                        if (p.pay.tracked || p.pay.state != 'not_tracked') _PayLine(p: p, unsent: v.unsentFor(p.id), anySent: v.sentFor(p.id), onPay: services == null ? null : () => _pay(context, p)),
                       ]),
                     ),
                   ),
@@ -122,6 +154,77 @@ class _Flag extends StatelessWidget {
       );
 }
 
+/// How a purchase is paid (0102): the state, what is left once payments
+/// still on the phone count (Q6), and Record payment.
+class _PayLine extends StatelessWidget {
+  const _PayLine({required this.p, required this.unsent, this.anySent = false, this.onPay});
+  final MyPurchase p;
+  final double unsent;
+  final bool anySent;
+  final VoidCallback? onPay;
+
+  @override
+  Widget build(BuildContext context) {
+    final left = p.pay.leftAfter(unsent);
+    final words = [
+      if (p.pay.state == 'overpaid') '${peso(p.pay.unresolved)} over — the owner resolves it'
+      else if (p.pay.payable && left > 0) '${peso(left)} left',
+      if (unsent > 0) anySent ? '${peso(unsent)} not in this list yet' : '${peso(unsent)} waiting to send',
+    ].join(' · ');
+    // A phone is narrow: the state and its words on one line, the button under them.
+    return Padding(
+      key: Key('pay-line-${p.id}'),
+      padding: const EdgeInsets.only(top: 8),
+      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
+        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
+          PayPill(p.pay.state),
+          if (words.isNotEmpty) Text(words, style: const TextStyle(fontSize: 12.5, color: WmColors.textSecondary)),
+        ]),
+        if (onPay != null && p.pay.canRecordPayment && !p.voided)
+          Align(
+            alignment: Alignment.centerRight,
+            child: TextButton(key: Key('pay-${p.id}'), onPressed: onPay, child: Text(recordPaymentLabel.english)),
+          ),
+      ]),
+    );
+  }
+}
+
+class _QueuedPaymentCard extends StatelessWidget {
+  const _QueuedPaymentCard({required this.q, required this.supplier, required this.onThrowAway});
+  final QueuedCashAction q;
+  final String supplier;
+  final VoidCallback onThrowAway;
+
+  @override
+  Widget build(BuildContext context) {
+    final attention = q.state == QueuedState.needsAttention;
+    final why = attention ? purFailureCopy(q.failure ?? PurFailure.unexpected) : null;
+    return Card(
+      key: Key('queued-pay-${q.opId}'),
+      color: attention ? WmColors.dangerTint : Colors.white,
+      child: Padding(
+        padding: const EdgeInsets.all(14),
+        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
+          Row(children: [
+            Expanded(child: Text('Payment${supplier.isEmpty ? '' : ' to $supplier'}', style: const TextStyle(fontWeight: FontWeight.w800))),
+            Text(peso(q.amount), style: const TextStyle(fontWeight: FontWeight.w800)),
+          ]),
+          Text(paySourceCopy(q.source).english, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
+          BilingualText(attention ? attentionLabel : (q.state == QueuedState.sent ? sentLabel : waitingToSendPayLabel),
+              style: TextStyle(fontWeight: FontWeight.w700, color: attention ? WmColors.danger : WmColors.brownDeep)),
+          if (why != null) ...[
+            const SizedBox(height: 6),
+            Text(why.english, style: const TextStyle(color: WmColors.danger, fontWeight: FontWeight.w600)),
+            Text(why.tagalog, style: const TextStyle(color: WmColors.danger, fontSize: 12.5)),
+            TextButton(key: Key('throw-pay-${q.opId}'), onPressed: onThrowAway, child: const Text('Throw away')),
+          ],
+        ]),
+      ),
+    );
+  }
+}
+
 class _QueuedCard extends StatelessWidget {
   const _QueuedCard({required this.q, required this.onFix, required this.onThrowAway});
   final QueuedPurchase q;
@@ -143,7 +246,7 @@ class _QueuedCard extends StatelessWidget {
             Expanded(child: Text(d.supplierName.isEmpty ? 'Purchase on ${d.purchaseDate}' : d.supplierName, style: const TextStyle(fontWeight: FontWeight.w800))),
             Text(peso(parseMoney(d.receiptTotal) ?? 0), style: const TextStyle(fontWeight: FontWeight.w800)),
           ]),
-          BilingualText(attention ? attentionLabel : waitingLabel,
+          BilingualText(attention ? attentionLabel : (q.state == QueuedState.sent ? sentLabel : waitingLabel),
               style: TextStyle(fontWeight: FontWeight.w700, color: attention ? WmColors.danger : WmColors.brownDeep)),
           if (why != null) ...[
             const SizedBox(height: 6),
```

**Modify:** `lib/purchasing/mine/purchase_detail_screen.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/mine/purchase_detail_screen.dart b/lib/purchasing/mine/purchase_detail_screen.dart
index 9ad2300..1f75f63 100644
--- a/lib/purchasing/mine/purchase_detail_screen.dart
+++ b/lib/purchasing/mine/purchase_detail_screen.dart
@@ -4,9 +4,14 @@ import '../../attendance/ui/attendance_copy.dart' show Bilingual;
 import '../../requests/domain/quantity.dart';
 import '../../ui/failure_notice.dart';
 import '../../ui/theme.dart';
+import '../data/purchasing_api.dart';
+import '../domain/pay_models.dart';
 import '../domain/pur_failure.dart';
 import '../domain/pur_models.dart';
+import '../pay/record_payment_screen.dart';
 import '../purchasing_services.dart';
+import '../ui/pay_copy.dart';
+import '../ui/pay_widgets.dart';
 import '../ui/purchasing_copy.dart';
 import 'correct_screen.dart';
 
@@ -27,6 +32,18 @@ class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
   Bilingual? _error;
   bool _changed = false;
 
+  /// Its payments (0102), read online beside the purchase; their own failure
+  /// never hides the purchase.
+  PurchasePayments? _pay;
+  Bilingual? _payNotice;
+
+  /// Payments on this purchase the payments read does not count (Q6, R38):
+  /// shown, and counted in what is left — as on My purchases — so the same
+  /// remainder is never offered twice.
+  List<QueuedCashAction> _queued = const [];
+  double get _unsent =>
+      _queued.where((q) => q.state != QueuedState.needsAttention).fold<double>(0, (a, q) => a + q.amount);
+
   @override
   void initState() {
     super.initState();
@@ -41,6 +58,130 @@ class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
     } catch (e) {
       if (mounted) setState(() => _error = purFailureCopy(PurFailure.of(e)));
     }
+    try {
+      // R38: the payments and what is still on the phone, from one read.
+      final v = await widget.services.api.purchasePayments(widget.purchaseId);
+      if (mounted) {
+        setState(() {
+          _pay = v.pay;
+          _queued = v.queued;
+        });
+      }
+    } catch (_) {
+      // Shown as "needs signal" in the Payments part only; what is on the
+      // phone still shows.
+      try {
+        final queued = await widget.services.api.queuedPayments(widget.purchaseId);
+        if (mounted) setState(() => _queued = queued);
+      } catch (_) {
+        // Nothing on the phone to show.
+      }
+    }
+  }
+
+  Future<void> _recordPayment(PurchaseDetail p, PurchasePayments pay) async {
+    final queued = await openRecordPayment(context, widget.services,
+        purchaseId: p.id, supplier: p.supplier, supplierId: pay.supplierId ?? p.supplierId, left: pay.pay.leftAfter(_unsent));
+    if (!queued || !mounted) return;
+    _changed = true;
+    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
+      content: Text('Saved. It is sent when there is signal. · Nai-save. Ipapadala kapag may signal.'),
+    ));
+    await _load();
+  }
+
+  /// Q7: never edited or deleted — voided with a reason, by whoever recorded it.
+  Future<void> _void(PurPayment x) async {
+    final api = widget.services.api;
+    final opId = api.newLineKey(); // minted once per form: a resend voids once
+    final reason = await askRequiredNote(
+      context,
+      title: 'Void this payment?',
+      message: '${peso(x.amount)} on ${x.paidOn}. It stays in the history, marked void. Petty cash it used comes back on your balance.',
+      action: 'Void',
+      label: 'Reason',
+      fieldKey: const Key('void-reason'),
+      sendKey: const Key('void-yes'),
+    );
+    if (reason == null || !mounted) return;
+    setState(() => _payNotice = null);
+    try {
+      await api.voidPayment(x.id, reason, opId: opId);
+      _changed = true;
+    } catch (e) {
+      final f = PurFailure.of(e);
+      if (mounted) setState(() => _payNotice = f == PurFailure.noConnection ? needsSignal : purFailureCopy(f));
+    }
+    await _load();
+  }
+
+  Widget _payments(PurchaseDetail p) {
+    final pay = _pay;
+    if (pay == null) {
+      return const Padding(
+        key: Key('payments-offline'),
+        padding: EdgeInsets.only(top: 16),
+        child: Text('Payments show when there is signal.', style: TextStyle(color: WmColors.textMuted)),
+      );
+    }
+    final s = pay.pay;
+    return Column(key: const Key('payments'), crossAxisAlignment: CrossAxisAlignment.start, children: [
+      const SizedBox(height: 16),
+      Row(children: [
+        const Expanded(child: BilingualText(paymentsLabel)),
+        PayPill(s.state),
+      ]),
+      Text(
+        s.state == 'not_tracked'
+            ? 'Recorded before payments were tracked.'
+            : s.state == 'overpaid'
+                ? 'Paid ${peso(s.paid)} on ${peso(s.due)} — ${peso(s.unresolved)} over, the owner resolves it.'
+                : 'Receipt ${peso(s.due)} · paid ${peso(s.paid)} · left ${peso(s.leftAfter(_unsent))}'
+                    '${_unsent > 0 ? ' · ${peso(_unsent)} ${_queued.any((q) => q.state == QueuedState.sent) ? 'not in this list yet' : 'waiting to send'}' : ''}',
+        style: const TextStyle(fontSize: 13, color: WmColors.textSecondary),
+      ),
+      if (_payNotice != null) ...[
+        const SizedBox(height: 8),
+        FailureNotice(english: _payNotice!.english, tagalog: _payNotice!.tagalog),
+      ],
+      for (final q in _queued)
+        ListTile(
+          key: Key('payment-queued-${q.opId}'),
+          contentPadding: EdgeInsets.zero,
+          title: Text(peso(q.amount)),
+          subtitle: Text([
+            paySourceCopy(q.source).english,
+            switch (q.state) {
+              QueuedState.waiting => waitingToSendPayLabel.english,
+              QueuedState.sent => sentLabel.english,
+              QueuedState.needsAttention => attentionLabel.english,
+            },
+            if (q.failure != null) purFailureCopy(q.failure!).english,
+          ].join(' · ')),
+        ),
+      for (final x in pay.payments)
+        ListTile(
+          key: Key('payment-${x.id}'),
+          contentPadding: EdgeInsets.zero,
+          leading: x.proofUrl.isEmpty ? null : SizedBox(width: 48, height: 48, child: _Receipt(url: x.proofUrl, services: widget.services)),
+          title: Text('${peso(x.amount)} · ${x.paidOn}', style: TextStyle(decoration: x.voided ? TextDecoration.lineThrough : null)),
+          subtitle: Text([
+            paySourceCopy(x.source).english,
+            if (x.source != 'credit') payMethodLabel(x.method),
+            if (x.createdByName.isNotEmpty) 'recorded by ${x.createdByName}',
+            if (x.moved) 'carried over from the earlier version',
+            if (x.toReview) 'own money: the owner reviews it',
+            if (x.rejectedAt != null) 'rejected by the owner: ${x.rejectReason} — not owed',
+            if (x.voided) 'voided: ${x.voidReason}',
+            if (x.note.isNotEmpty) x.note,
+          ].join(' · ')),
+          trailing: x.canVoid && !x.voided ? TextButton(key: Key('void-${x.id}'), onPressed: () => _void(x), child: const Text('Void…')) : null,
+        ),
+      if (s.canRecordPayment && p.recorded && p.replacedBy == null) ...[
+        const SizedBox(height: 8),
+        bilingualButton(recordPaymentLabel, () => _recordPayment(p, pay), key: const Key('detail-pay')),
+      ],
+    ]);
   }
 
   Future<void> _correct(PurchaseDetail p) async {
@@ -128,6 +269,7 @@ class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
           child: Text('Change sent to the owner (${r.status}): ${r.reason}${r.decisionNote.isEmpty ? '' : ' — ${r.decisionNote}'}',
               style: const TextStyle(color: WmColors.textSecondary)),
         ),
+      _payments(p),
       const SizedBox(height: 20),
       if (canCorrect) bilingualButton(const Bilingual('Correct this purchase', 'Itama ang purchase'), () => _correct(p), key: const Key('correct')),
       const SizedBox(height: 8),
```

**Create:** `lib/purchasing/pay/my_cash_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/purchasing_api.dart';
import '../domain/pay_models.dart';
import '../domain/pur_failure.dart';
import '../purchasing_services.dart';
import '../ui/pay_copy.dart';
import '../ui/pay_widgets.dart';
import '../ui/purchasing_copy.dart';
import 'report_return_screen.dart';

/// The "My cash" card at the top of My purchases (Q23: no new tab): petty
/// cash held (never below ₱0; the rest is the shortfall, Q16), a return
/// waiting for the owner, and what the company owes me. Tap for the detail.
class MyCashCard extends StatelessWidget {
  const MyCashCard({super.key, required this.view, required this.onOpen});
  final MyCashView view;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final c = view.cash;
    final f = view.figures;
    if (c == null || f == null || !c.holder) return const SizedBox.shrink();
    final waiting = c.pendingReturns + view.queuedReturns.fold<double>(0, (a, q) => a + q.amount);
    return Card(
      key: const Key('my-cash-card'),
      color: Colors.white,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Expanded(child: BilingualText(myCashLabel)),
              const Icon(Icons.chevron_right, color: WmColors.textMuted),
            ]),
            const SizedBox(height: 6),
            Wrap(spacing: 18, runSpacing: 8, children: [
              _Figure(cashHeldLabel, peso(f.held), key: const Key('cash-held')),
              if (waiting > 0) _Figure(returnWaitingLabel, peso(waiting), key: const Key('cash-waiting')),
              if (c.owes > 0 || c.owesToReview > 0) _Figure(companyOwesMeLabel, peso(c.owes), key: const Key('cash-owes')),
            ]),
            if (f.shortfall > 0) ...[
              const SizedBox(height: 8),
              PayWarning(key: const Key('cash-shortfall'), text: shortfallCopy(peso(f.shortfall))),
            ],
            if (view.fromCache && view.fetchedAt != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('Saved copy from ${shortDate(view.fetchedAt!)} ${clockTime(view.fetchedAt!)}.',
                    style: const TextStyle(fontSize: 12, color: WmColors.brownDeep, fontWeight: FontWeight.w600)),
              ),
          ]),
        ),
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure(this.label, this.value, {super.key});
  final Bilingual label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(label.english, style: const TextStyle(fontSize: 12, color: WmColors.textSecondary)),
        Text(value, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
      ]);
}

/// "My cash" in full (Q14, Q17, Q22, Q24 — the buyer's own, never another
/// buyer's): what was given and returned, "I did not receive this", repayments.
class MyCashScreen extends StatefulWidget {
  const MyCashScreen({super.key, required this.services});
  final PurchasingServices services;

  @override
  State<MyCashScreen> createState() => _MyCashScreenState();
}

class _MyCashScreenState extends State<MyCashScreen> {
  PurchasingApi get _api => widget.services.api;
  MyCashView? _view;
  Bilingual? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final v = await _api.myCash();
      if (mounted) setState(() => _view = v);
    } catch (e) {
      if (mounted) setState(() => _notice = purFailureCopy(PurFailure.of(e)));
    }
  }

  /// An online action: its failure is shown, nothing changes.
  Future<void> _online(Future<void> Function() call) async {
    setState(() => _notice = null);
    try {
      await call();
    } catch (e) {
      final f = PurFailure.of(e);
      if (mounted) setState(() => _notice = f == PurFailure.noConnection ? needsSignal : purFailureCopy(f));
    }
    await _load();
  }

  Future<void> _report() async {
    final held = _view?.figures?.held;
    final queued = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ReportReturnScreen(services: widget.services, held: held)));
    if (queued == true) await _load();
  }

  /// Q14: "I did not receive this", with a note (the server asks for one).
  Future<void> _dispute(CashIssue i) async {
    final opId = _api.newLineKey(); // minted once per form: a resend answers once
    final note = await askRequiredNote(context,
        title: 'I did not receive this', message: 'The owner sees your note. Your balance does not change until they settle it.', action: 'Send');
    if (note == null) return;
    await _online(() => _api.dispute(i.id, note, opId: opId));
  }

  Future<void> _withdraw(CashReturn r) async {
    final opId = _api.newLineKey();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Take back this return?'),
        content: Text('${peso(r.amount)} handed over ${r.handedOn}. The owner has not confirmed it yet.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep')),
          TextButton(key: const Key('withdraw-yes'), onPressed: () => Navigator.of(context).pop(true), child: const Text('Take back')),
        ],
      ),
    );
    if (ok == true) await _online(() => _api.withdrawReturn(r.id, opId: opId));
  }

  @override
  Widget build(BuildContext context) {
    final v = _view;
    final c = v?.cash;
    final f = v?.figures;
    return Scaffold(
      appBar: AppBar(title: const BilingualText(myCashLabel, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18))),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(key: const Key('my-cash'), padding: const EdgeInsets.all(16), children: [
            if (_notice != null) ...[
              FailureNotice(english: _notice!.english, tagalog: _notice!.tagalog, actions: [noticeAction('Dismiss · Isara', () => setState(() => _notice = null))]),
              const SizedBox(height: 10),
            ],
            if (v == null)
              const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
            else if (c == null || f == null)
              const BilingualText(Bilingual('Connect once to see your cash.', 'Kumonekta muna para makita ang pera mo.'))
            else if (!c.holder)
              const BilingualText(Bilingual('Petty cash is for staff buyers. This account pays as the company.',
                  'Ang petty cash ay para sa staff na bumibili. Bilang kompanya nagbabayad ang account na ito.'))
            else ...[
              const Text('Company money you hold for purchases, and what the company owes you for your own money. None of it changes a project\'s costs.',
                  style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
              const SizedBox(height: 10),
              Wrap(spacing: 18, runSpacing: 10, children: [
                _Figure(cashHeldLabel, peso(f.held), key: const Key('detail-held')),
                _Figure(companyOwesMeLabel, peso(c.owes), key: const Key('detail-owes')),
              ]),
              if (f.shortfall > 0) ...[const SizedBox(height: 8), PayWarning(text: shortfallCopy(peso(f.shortfall)))],
              if (c.owesToReview > 0) ...[
                const SizedBox(height: 8),
                Text('${peso(c.owesToReview)} waiting for the owner\'s review', style: const TextStyle(fontWeight: FontWeight.w700)),
                const PayWarning(text: ownMoneyToReviewCopy),
              ],
              if (v.fromCache && v.fetchedAt != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text('Saved copy from ${shortDate(v.fetchedAt!)} ${clockTime(v.fetchedAt!)}.',
                      key: const Key('cash-saved-copy'), style: const TextStyle(color: WmColors.brownDeep, fontWeight: FontWeight.w600)),
                ),
              const SizedBox(height: 14),
              bilingualButton(reportReturnLabel, _report, filled: true, key: const Key('report-return')),
              if (v.queuedReturns.isNotEmpty) ...[
                const SizedBox(height: 18),
                const BilingualText(Bilingual('Not sent yet', 'Hindi pa naipapadala'), style: monoLabel),
                for (final q in v.queuedReturns) _QueuedReturn(q: q, onThrowAway: () async {
                  await _api.discardAction(q.opId);
                  await _load();
                }),
              ],
              const SizedBox(height: 18),
              const BilingualText(Bilingual('Petty cash you were given (90 days)', 'Petty cash na ibinigay sa iyo (90 araw)'), style: monoLabel),
              if (c.issues.isEmpty) const Text('Nothing here.'),
              for (final i in c.issues)
                ListTile(
                  key: Key('issue-${i.id}'),
                  contentPadding: EdgeInsets.zero,
                  title: Text('${i.issuedOn} — ${peso(i.amount)} ${payMethodLabel(i.method)}',
                      style: TextStyle(decoration: i.voided ? TextDecoration.lineThrough : null)),
                  subtitle: Text([
                    if (i.note.isNotEmpty) i.note,
                    if (i.voided) 'voided: ${i.voidReason}',
                    if (i.flagged) 'You said not received — the owner is checking',
                    if (i.disputeClearedAt != null) 'Owner: ${i.disputeClearedNote}',
                  ].join(' · ')),
                  trailing: i.canDispute
                      ? TextButton(key: Key('dispute-${i.id}'), onPressed: () => _dispute(i), child: Text(notReceivedLabel.english))
                      : null,
                ),
              const SizedBox(height: 14),
              const BilingualText(Bilingual('Returns', 'Mga ibinalik'), style: monoLabel),
              if (c.returns.isEmpty) const Text('Nothing here.'),
              for (final r in c.returns)
                ListTile(
                  key: Key('return-${r.id}'),
                  contentPadding: EdgeInsets.zero,
                  leading: r.photoUrl.isEmpty ? null : _Thumb(url: r.photoUrl, services: widget.services),
                  title: Text('${r.handedOn} — ${peso(r.amount)}'),
                  subtitle: Text([
                    switch (r.status) {
                      'reported' => 'waiting for the owner',
                      'confirmed' => 'confirmed',
                      'rejected' => 'rejected',
                      'withdrawn' => 'taken back',
                      _ => r.status,
                    },
                    if (r.decisionNote.isNotEmpty) r.decisionNote,
                    if (r.voidedAt != null) 'voided by the owner',
                  ].join(' · ')),
                  trailing: r.waiting ? TextButton(key: Key('withdraw-${r.id}'), onPressed: () => _withdraw(r), child: const Text('Take back')) : null,
                ),
              const SizedBox(height: 14),
              const BilingualText(Bilingual('Repaid to you (90 days)', 'Ibinalik sa iyo (90 araw)'), style: monoLabel),
              if (c.repayments.isEmpty) const Text('Nothing here.'),
              for (final x in c.repayments)
                Text('${x.paidOn} — ${peso(x.amount)} ${payMethodLabel(x.method)}${x.voidedAt == null ? '' : ' (voided)'}'),
              const SizedBox(height: 40),
            ],
          ]),
        ),
      ),
    );
  }
}

class _QueuedReturn extends StatelessWidget {
  const _QueuedReturn({required this.q, required this.onThrowAway});
  final QueuedCashAction q;
  final VoidCallback onThrowAway;

  @override
  Widget build(BuildContext context) {
    final attention = q.state == QueuedState.needsAttention;
    final why = attention ? purFailureCopy(q.failure ?? PurFailure.unexpected) : null;
    return Card(
      key: Key('queued-return-${q.opId}'),
      color: attention ? WmColors.dangerTint : Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Return ${peso(q.amount)}', style: const TextStyle(fontWeight: FontWeight.w800)),
          BilingualText(attention ? attentionLabel : (q.state == QueuedState.sent ? sentLabel : waitingToSendPayLabel),
              style: TextStyle(fontWeight: FontWeight.w700, color: attention ? WmColors.danger : WmColors.brownDeep)),
          if (why != null) ...[
            Text(why.english, style: const TextStyle(color: WmColors.danger, fontWeight: FontWeight.w600)),
            Text(why.tagalog, style: const TextStyle(color: WmColors.danger, fontSize: 12.5)),
            TextButton(key: Key('throw-return-${q.opId}'), onPressed: onThrowAway, child: const Text('Throw away')),
          ],
        ]),
      ),
    );
  }
}

/// A return photo, downloaded as this buyer (never a signed link, R13/F2).
class _Thumb extends StatelessWidget {
  const _Thumb({required this.url, required this.services});
  final String url;
  final PurchasingServices services;

  @override
  Widget build(BuildContext context) => FutureBuilder(
        future: services.api.receipt(url),
        builder: (context, snap) {
          final bytes = snap.data;
          return SizedBox(
            width: 48,
            height: 48,
            child: bytes == null
                ? const Icon(Icons.image_outlined)
                : GestureDetector(
                    onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                      builder: (_) => Scaffold(
                        backgroundColor: WmColors.viewerBackdrop,
                        appBar: AppBar(backgroundColor: WmColors.viewerBackdrop, foregroundColor: Colors.white),
                        body: InteractiveViewer(child: Center(child: Image.memory(bytes))),
                      ),
                    )),
                    child: ClipRRect(borderRadius: BorderRadius.circular(6), child: Image.memory(bytes, fit: BoxFit.cover)),
                  ),
          );
        },
      );
}
```

**Create:** `lib/purchasing/pay/record_payment_screen.dart`

```dart
import 'dart:io';

import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/purchasing_api.dart';
import '../domain/pay_models.dart';
import '../domain/pur_failure.dart';
import '../domain/purchase_draft.dart' show parseMoney;
import '../purchasing_services.dart';
import '../ui/pay_copy.dart';
import '../ui/pay_widgets.dart';
import '../ui/purchasing_copy.dart';

/// Record payment (0102, Q6): a later payment on a recorded purchase — a
/// deposit, the rest, or more. Works with no signal: it is saved on the phone
/// as "Waiting to send" and recorded once, when there is signal. True once
/// queued.
Future<bool> openRecordPayment(
  BuildContext context,
  PurchasingServices services, {
  required String purchaseId,
  required String supplier,
  String? supplierId,
  required double left,
}) async =>
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RecordPaymentScreen(services: services, purchaseId: purchaseId, supplier: supplier, supplierId: supplierId, left: left),
      ),
    ) ==
    true;

class RecordPaymentScreen extends StatefulWidget {
  const RecordPaymentScreen({super.key, required this.services, required this.purchaseId, required this.supplier, this.supplierId, required this.left});

  final PurchasingServices services;
  final String purchaseId;
  final String supplier;
  final String? supplierId;

  /// Still to pay, payments waiting on this phone counted.
  final double left;

  @override
  State<RecordPaymentScreen> createState() => _RecordPaymentScreenState();
}

class _RecordPaymentScreenState extends State<RecordPaymentScreen> {
  PurchasingApi get _api => widget.services.api;

  late final TextEditingController _amount = TextEditingController(text: widget.left > 0 ? widget.left.toStringAsFixed(2) : '');
  final _note = TextEditingController();
  late String _paidOn = _api.today();
  String _source = 'company';
  String _method = 'cash';
  String? _credit;
  String? _proof;
  MyCashView? _cash;
  List<PayProblem> _problems = const [];
  Bilingual? _notice;
  bool _saving = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _amount.addListener(() => setState(() {}));
    _loadCash();
  }

  Future<void> _loadCash() async {
    try {
      final c = await _api.myCash();
      if (!mounted) return;
      setState(() {
        _cash = c;
        // A staff buyer usually pays from the petty cash they hold.
        if (_holder) _source = 'petty_cash';
      });
    } catch (_) {
      // Offline and never read: company money, petty cash; the server decides.
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    // A proof never queued is the phone's own file: it goes.
    final p = _proof;
    // R39: a photo is the phone's own until Save hands it to the queue. While
    // a Save is under way its owner is not known yet: it is kept, never deleted.
    if (!_saved && !_saving && p != null) _api.discardPhoto(p);
    super.dispose();
  }

  bool get _holder => _cash?.cash?.holder ?? true;
  bool get _ownMoney => _holder && (_cash?.cash?.ownMoney ?? false);
  List<SupplierCredit> get _credits => _cash?.creditsFor(widget.supplierId) ?? const [];

  /// R2, Q21, Q11: what this account may pay with.
  List<String> get _sources => [if (_holder) 'petty_cash', if (_ownMoney) 'own_money', 'company', if (_credits.isNotEmpty) 'credit'];

  PaymentInput get _input =>
      PaymentInput(amount: _amount.text, paidOn: _paidOn, method: _method, source: _source, creditId: _source == 'credit' ? _credit : null, note: _note.text);

  Future<void> _photo(Future<String?> Function(BuildContext) pick) async {
    final src = await pick(context);
    if (src == null || !mounted) return;
    final kept = await _api.keepPhoto('pay-${widget.purchaseId}', src);
    final old = _proof;
    setState(() => _proof = kept);
    if (old != null) await _api.discardPhoto(old);
  }

  Future<void> _pickDate() async {
    final today = DateTime.parse(_api.today());
    final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse(_paidOn) ?? today, firstDate: DateTime(2020), lastDate: today);
    if (picked != null) {
      setState(() => _paidOn = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}');
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _notice = null;
    });
    try {
      await _api.pay(widget.purchaseId, _input, proofPhoto: _proof);
      _saved = true;
      if (mounted) Navigator.of(context).pop(true);
    } on PaymentInvalid catch (e) {
      setState(() => _problems = e.problems);
    } catch (e) {
      setState(() => _notice = purFailureCopy(PurFailure.of(e)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sources = _sources;
    if (!sources.contains(_source)) _source = sources.first;
    if (_source == 'credit' && !_credits.any((c) => c.id == _credit)) _credit = _credits.first.id;
    final figures = _cash?.figures;
    final over = _source == 'petty_cash' && figures != null ? overspendBy(_amount.text, figures.held) : null;
    return PopScope(
      canPop: !_saving,
      child: Scaffold(
        appBar: AppBar(
          title: const BilingualText(recordPaymentLabel, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        ),
        body: SafeArea(
          child: ListView(
            key: const Key('pay-form'),
            padding: const EdgeInsets.all(16),
            children: [
              Text(widget.supplier.isEmpty ? 'No supplier' : widget.supplier, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
              Text(
                widget.left > 0 ? '${peso(widget.left)} left to pay' : 'Nothing left to pay — a payment now is over the receipt.',
                style: const TextStyle(color: WmColors.textMuted),
              ),
              const Text(
                'Saved on this phone. It is sent when there is signal. A payment never changes Spent.',
                style: TextStyle(fontSize: 12.5, color: WmColors.textMeta),
              ),
              if (_notice != null) ...[const SizedBox(height: 10), FailureNotice(english: _notice!.english, tagalog: _notice!.tagalog)],
              const SizedBox(height: 14),
              TextField(
                key: const Key('pay-amount'),
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount', prefixText: '₱ '),
              ),
              if (_problems.contains(PayProblem.badAmount)) _problem(PayProblem.badAmount),
              const SizedBox(height: 10),
              InkWell(
                key: const Key('pay-date'),
                onTap: _pickDate,
                child: InputDecorator(
                  decoration: const InputDecoration(labelText: 'Paid on'),
                  child: Text(_paidOn),
                ),
              ),
              if (_problems.contains(PayProblem.badDate)) _problem(PayProblem.badDate),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                key: ValueKey('pay-source-${sources.join(',')}'),
                initialValue: _source,
                isExpanded: true,
                decoration: InputDecoration(labelText: '${paidFromLabel.english} · ${paidFromLabel.tagalog}'),
                items: [
                  for (final s in sources)
                    DropdownMenuItem(
                      value: s,
                      child: Text(paySourceCopy(s).english, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (s) => setState(() => _source = s ?? 'company'),
              ),
              const SizedBox(height: 10),
              if (_source == 'credit')
                DropdownButtonFormField<String>(
                  key: const Key('pay-credit'),
                  initialValue: _credit,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Credit to use'),
                  items: [
                    for (final c in _credits)
                      DropdownMenuItem(
                        value: c.id,
                        child: Text('${c.supplier} — ${peso(c.left)} left', overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (id) => setState(() => _credit = id),
                )
              else
                DropdownButtonFormField<String>(
                  key: const Key('pay-method'),
                  initialValue: _method,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'How'),
                  items: [for (final m in payMethods) DropdownMenuItem(value: m, child: Text(payMethodLabel(m)))],
                  onChanged: (m) => setState(() => _method = m ?? 'cash'),
                ),
              for (final p in _problems.where((p) => p == PayProblem.creditRequired || p == PayProblem.overCredit)) _problem(p),
              if (over != null) ...[
                const SizedBox(height: 10),
                PayWarning(key: const Key('pay-overspend'), text: overspendCopy(peso(figures!.held), peso(parseMoney(_amount.text) ?? 0))),
              ],
              const SizedBox(height: 10),
              TextField(
                key: const Key('pay-note'),
                controller: _note,
                decoration: const InputDecoration(labelText: 'Note (optional)'),
              ),
              const SizedBox(height: 14),
              const Text('Proof (optional) — GCash screenshot, deposit slip', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              if (_proof != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.file(
                    File(_proof!),
                    key: const Key('pay-proof'),
                    height: 120,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const Icon(Icons.image),
                  ),
                ),
              Wrap(
                spacing: 8,
                children: [
                  TextButton.icon(
                    key: const Key('pay-proof-camera'),
                    onPressed: () => _photo(widget.services.takePhoto),
                    icon: const Icon(Icons.photo_camera_outlined),
                    label: const Text('Camera'),
                  ),
                  TextButton.icon(
                    key: const Key('pay-proof-gallery'),
                    onPressed: () => _photo(widget.services.pickPhoto),
                    icon: const Icon(Icons.photo_library_outlined),
                    label: const Text('Gallery'),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              bilingualButton(recordPaymentLabel, _saving ? null : _save, filled: true, key: const Key('pay-save')),
            ],
          ),
        ),
      ),
    );
  }

  Widget _problem(PayProblem p) {
    final b = payProblemCopy(p);
    return Padding(
      key: Key('pay-problem-${p.name}'),
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            b.english,
            style: const TextStyle(color: WmColors.danger, fontWeight: FontWeight.w700, fontSize: 13),
          ),
          Text(b.tagalog, style: const TextStyle(color: WmColors.danger, fontSize: 12)),
        ],
      ),
    );
  }
}
```

**Create:** `lib/purchasing/pay/report_return_screen.dart`

```dart
import 'dart:io';

import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/purchasing_api.dart';
import '../domain/pay_models.dart';
import '../domain/pur_failure.dart';
import '../purchasing_services.dart';
import '../ui/pay_copy.dart';
import '../ui/purchasing_copy.dart';

/// Report a return (0102, Q17): petty cash handed back to the owner. It waits
/// for the owner's confirmation, which alone lowers cash held — on the day
/// the owner confirms (Q18). Saved on the phone and sent once (Q6). Its
/// optional photo is filed in the private pettyCash/ folder: only the owner
/// and this buyer can open it (R13). True once queued.
class ReportReturnScreen extends StatefulWidget {
  const ReportReturnScreen({super.key, required this.services, this.held});
  final PurchasingServices services;

  /// Cash held as shown, for the hint only: a return is never capped (R11).
  final double? held;

  @override
  State<ReportReturnScreen> createState() => _ReportReturnScreenState();
}

class _ReportReturnScreenState extends State<ReportReturnScreen> {
  PurchasingApi get _api => widget.services.api;

  final _amount = TextEditingController();
  final _to = TextEditingController();
  final _note = TextEditingController();
  late String _handedOn = _api.today();
  String? _photo;
  List<ReturnProblem> _problems = const [];
  Bilingual? _notice;
  bool _saving = false;
  bool _saved = false;

  @override
  void dispose() {
    _amount.dispose();
    _to.dispose();
    _note.dispose();
    final p = _photo;
    // R39: a photo is the phone's own until Save hands it to the queue. While
    // a Save is under way its owner is not known yet: it is kept, never deleted.
    if (!_saved && !_saving && p != null) _api.discardPhoto(p);
    super.dispose();
  }

  Future<void> _takePhoto(Future<String?> Function(BuildContext) pick) async {
    final src = await pick(context);
    if (src == null || !mounted) return;
    final kept = await _api.keepPhoto('return', src);
    final old = _photo;
    setState(() => _photo = kept);
    if (old != null) await _api.discardPhoto(old);
  }

  Future<void> _pickDate() async {
    final today = DateTime.parse(_api.today());
    final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse(_handedOn) ?? today, firstDate: DateTime(2020), lastDate: today);
    if (picked != null) {
      setState(
        () => _handedOn = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}',
      );
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _notice = null;
    });
    try {
      await _api.reportReturn(
        ReturnInput(amount: _amount.text, handedOn: _handedOn, handedTo: _to.text, note: _note.text),
        photo: _photo,
      );
      _saved = true;
      if (mounted) Navigator.of(context).pop(true);
    } on ReturnInvalid catch (e) {
      setState(() => _problems = e.problems);
    } catch (e) {
      setState(() => _notice = purFailureCopy(PurFailure.of(e)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _problem(Bilingual b, String key) => Padding(
    key: Key(key),
    padding: const EdgeInsets.only(top: 4),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          b.english,
          style: const TextStyle(color: WmColors.danger, fontWeight: FontWeight.w700, fontSize: 13),
        ),
        Text(b.tagalog, style: const TextStyle(color: WmColors.danger, fontSize: 12)),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving,
    child: Scaffold(
      appBar: AppBar(
        title: const BilingualText(reportReturnLabel, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const BilingualText(
              Bilingual(
                'It waits for the owner. Only the owner\'s confirmation lowers your cash held.',
                'Hihintayin ang may-ari. Ang kumpirmasyon lang ng may-ari ang magbabawas sa hawak mong pera.',
              ),
              style: TextStyle(fontSize: 13, color: WmColors.textSecondary),
            ),
            if (widget.held != null) Text('You hold ${peso(widget.held!)} on record.', style: const TextStyle(color: WmColors.textMuted)),
            if (_notice != null) ...[const SizedBox(height: 10), FailureNotice(english: _notice!.english, tagalog: _notice!.tagalog)],
            const SizedBox(height: 14),
            TextField(
              key: const Key('return-amount'),
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Amount handed back', prefixText: '₱ '),
            ),
            if (_problems.contains(ReturnProblem.badAmount))
              _problem(const Bilingual('Enter the amount handed back.', 'Ilagay ang halagang ibinalik.'), 'return-problem-amount'),
            const SizedBox(height: 10),
            InkWell(
              key: const Key('return-date'),
              onTap: _pickDate,
              child: InputDecorator(
                decoration: const InputDecoration(labelText: 'Handed over on'),
                child: Text(_handedOn),
              ),
            ),
            if (_problems.contains(ReturnProblem.badDate))
              _problem(
                const Bilingual('Pick the day you handed it over (not in the future).', 'Piliin ang araw na ibinigay mo (hindi sa hinaharap).'),
                'return-problem-date',
              ),
            const SizedBox(height: 10),
            TextField(
              key: const Key('return-to'),
              controller: _to,
              decoration: const InputDecoration(labelText: 'Handed to (optional)'),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const Key('return-note'),
              controller: _note,
              decoration: const InputDecoration(labelText: 'Note (optional)'),
            ),
            const SizedBox(height: 14),
            const Text('Photo (optional)', style: TextStyle(fontWeight: FontWeight.w700)),
            const Text('Only you and the owner can open it.', style: TextStyle(fontSize: 12.5, color: WmColors.textMeta)),
            const SizedBox(height: 6),
            if (_photo != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.file(
                  File(_photo!),
                  key: const Key('return-photo'),
                  height: 120,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const Icon(Icons.image),
                ),
              ),
            Wrap(
              spacing: 8,
              children: [
                TextButton.icon(
                  key: const Key('return-photo-camera'),
                  onPressed: () => _takePhoto(widget.services.takePhoto),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: const Text('Camera'),
                ),
                TextButton.icon(
                  key: const Key('return-photo-gallery'),
                  onPressed: () => _takePhoto(widget.services.pickPhoto),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: const Text('Gallery'),
                ),
              ],
            ),
            const SizedBox(height: 20),
            bilingualButton(reportReturnLabel, _saving ? null : _save, filled: true, key: const Key('return-save')),
          ],
        ),
      ),
    ),
  );
}
```

**Modify:** `lib/purchasing/record/record_controller.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/record/record_controller.dart b/lib/purchasing/record/record_controller.dart
index ef8c22c..bc9b066 100644
--- a/lib/purchasing/record/record_controller.dart
+++ b/lib/purchasing/record/record_controller.dart
@@ -5,6 +5,7 @@ import 'package:flutter/foundation.dart';
 import '../../attendance/ui/attendance_copy.dart' show Bilingual;
 import '../../requests/domain/quantity.dart';
 import '../data/purchasing_api.dart';
+import '../domain/pay_models.dart';
 import '../domain/pur_failure.dart';
 import '../domain/pur_models.dart';
 import '../domain/purchase_draft.dart';
@@ -29,9 +30,18 @@ class RecordController extends ChangeNotifier {
 
   PurchaseChoices? choices;
 
+  /// The buyer's own cash (0102), fresh or the saved copy: what "Paid now?"
+  /// may offer. Null when it was never read (the server then decides).
+  MyCashView? cash;
+
   /// Problems are shown once the buyer has tried to send.
   bool _tried = false;
-  List<PurchaseProblem> get problems => _tried ? purchaseProblems(_draft) : const [];
+  List<PurchaseProblem> get problems => _tried ? _allProblems : const [];
+
+  List<PurchaseProblem> get _allProblems => [
+        ...purchaseProblems(_draft),
+        ...paidNowProblems(_draft, holder: holder, creditLeft: _chosenCredit?.left),
+      ];
 
   bool sending = false;
   Bilingual? notice;
@@ -42,6 +52,11 @@ class RecordController extends ChangeNotifier {
     } catch (e) {
       notice = purFailureCopy(PurFailure.of(e));
     }
+    try {
+      cash = await api.myCash();
+    } catch (_) {
+      // "Paid now?" then offers what any buyer may: company money, petty cash.
+    }
     notifyListeners();
   }
 
@@ -66,10 +81,11 @@ class RecordController extends ChangeNotifier {
 
   void setDate(String iso) => _set(_draft.copyWith(purchaseDate: iso));
 
-  /// A supplier from the list, or (null) one typed by name.
-  void setSupplier(Supplier? s) => _set(_draft.copyWith(supplierId: s?.id, supplierName: s?.label ?? ''));
+  /// A supplier from the list, or (null) one typed by name. Its credits are
+  /// not another supplier's: a credit chosen in "Paid now?" is re-picked.
+  void setSupplier(Supplier? s) => _set(_payFits(_draft.copyWith(supplierId: s?.id, supplierName: s?.label ?? '')));
 
-  void setSupplierName(String name) => _set(_draft.copyWith(supplierId: null, supplierName: name));
+  void setSupplierName(String name) => _set(_payFits(_draft.copyWith(supplierId: null, supplierName: name)));
 
   void setPayment(String method) => _set(_draft.copyWith(paymentMethod: method));
 
@@ -155,7 +171,7 @@ class RecordController extends ChangeNotifier {
   /// form still has problems, now shown.
   Future<bool> send() async {
     _tried = true;
-    if (purchaseProblems(_draft).isNotEmpty || sending) {
+    if (_allProblems.isNotEmpty || sending) {
       notifyListeners();
       return false;
     }
@@ -178,4 +194,70 @@ class RecordController extends ChangeNotifier {
 
   /// Throws the draft away, with its photos.
   Future<void> discard() => api.deleteDraft(_draft);
+
+  // ── "Paid now?" (0102, Q3) ─────────────────────────────────────────────
+
+  /// A staff buyer holds petty cash and may use own money (R2). Unknown
+  /// (never read) counts as yes: the server decides, both or neither.
+  bool get holder => cash?.cash?.holder ?? true;
+
+  /// Q21: own money is offered only while the owner allows it, as last read.
+  bool get ownMoneyAllowed => holder && (cash?.cash?.ownMoney ?? false);
+
+  /// Credits with this purchase's supplier that still have something left.
+  List<SupplierCredit> get credits => cash?.creditsFor(_draft.supplierId) ?? const [];
+
+  SupplierCredit? get _chosenCredit => credits.where((c) => c.id == _draft.paidCredit).firstOrNull;
+
+  /// Where the money may come from (Q5): petty cash and own money for a
+  /// staff buyer, the company always, a supplier credit when there is one.
+  List<String> get paySources => [
+        if (holder) 'petty_cash',
+        if (ownMoneyAllowed) 'own_money',
+        'company',
+        if (credits.isNotEmpty) 'credit',
+      ];
+
+  /// "Not paid yet" / "Paid in full" / "Paid part". The first payment choice
+  /// starts from the first source this account may use — petty cash for a
+  /// staff buyer, as on the web; later changes keep what was picked.
+  void setPaidNow(String v) {
+    var d = _draft.copyWith(paidNow: v);
+    if (v != 'none' && (_draft.paidNow == 'none' || !paySources.contains(d.paidFrom))) d = d.copyWith(paidFrom: paySources.first);
+    _set(_withCredit(d));
+  }
+
+  void setPaidAmount(String v) => _set(_draft.copyWith(paidAmount: v));
+
+  void setPaidFrom(String v) => _set(_withCredit(_draft.copyWith(paidFrom: v)));
+
+  void setPaidMethod(String v) => _set(_draft.copyWith(paidMethod: v));
+
+  void setPaidCredit(String id) => _set(_draft.copyWith(paidCredit: id));
+
+  /// After a supplier change: a credit only from the new supplier's, or
+  /// another source when it has none.
+  PurchaseDraft _payFits(PurchaseDraft d) {
+    final usable = cash?.creditsFor(d.supplierId) ?? const <SupplierCredit>[];
+    if (d.paidFrom != 'credit') return d;
+    if (usable.isEmpty) return d.copyWith(paidFrom: holder ? 'petty_cash' : 'company', paidCredit: null);
+    return usable.any((c) => c.id == d.paidCredit) ? d : d.copyWith(paidCredit: usable.first.id);
+  }
+
+  /// Paying from a credit picks the first usable one unless one is chosen.
+  PurchaseDraft _withCredit(PurchaseDraft d) {
+    if (d.paidFrom != 'credit') return d.copyWith(paidCredit: null);
+    final ok = credits.any((c) => c.id == d.paidCredit);
+    return ok || credits.isEmpty ? d : d.copyWith(paidCredit: credits.first.id);
+  }
+
+  /// Q16: paying more petty cash than is on record (less payments still on
+  /// the phone) — a warning, never a refusal. Null when nothing to say.
+  ({double held, double amount})? get overspend {
+    final pay = paidNowPayment(_draft);
+    final figures = cash?.figures;
+    if (pay == null || pay.source != 'petty_cash' || figures == null) return null;
+    final over = overspendBy(pay.amount, figures.held);
+    return over == null ? null : (held: figures.held, amount: parseMoney(pay.amount) ?? 0);
+  }
 }
```

**Modify:** `lib/purchasing/record/record_screen.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/record/record_screen.dart b/lib/purchasing/record/record_screen.dart
index 998c23c..e798470 100644
--- a/lib/purchasing/record/record_screen.dart
+++ b/lib/purchasing/record/record_screen.dart
@@ -7,9 +7,12 @@ import '../../attendance/ui/attendance_copy.dart' show Bilingual;
 import '../../requests/domain/quantity.dart';
 import '../../ui/failure_notice.dart';
 import '../../ui/theme.dart';
+import '../domain/pay_models.dart';
 import '../domain/pur_models.dart';
 import '../domain/purchase_draft.dart';
 import '../purchasing_services.dart';
+import '../ui/pay_copy.dart';
+import '../ui/pay_widgets.dart';
 import '../ui/purchasing_copy.dart';
 import 'record_controller.dart';
 
@@ -157,6 +160,12 @@ class RecordScreen extends StatelessWidget {
                     color: parseMoney(d.receiptTotal) != null && round2(parseMoney(d.receiptTotal)!) == d.computedTotal ? WmColors.green : WmColors.textSecondary,
                   ),
                 ),
+                const SizedBox(height: 18),
+                _heading('6', 'Paid now?'),
+                const Text('Optional. A payment never changes Spent — it only says how the receipt was paid.',
+                    style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
+                const SizedBox(height: 8),
+                _PaidNow(controller: c),
                 for (final p in general) ...[const SizedBox(height: 8), _ProblemText(p)],
                 const SizedBox(height: 20),
                 bilingualButton(recordLabel, c.sending ? null : () => _send(context), filled: true, key: const Key('record-send')),
@@ -177,6 +186,87 @@ class RecordScreen extends StatelessWidget {
       );
 }
 
+/// "Paid now?" (0102, Q3): the payment made at the counter, recorded with
+/// the purchase in one transaction — both or neither. Later payments go
+/// through Record payment on My purchases.
+class _PaidNow extends StatelessWidget {
+  const _PaidNow({required this.controller});
+  final RecordController controller;
+
+  @override
+  Widget build(BuildContext context) {
+    final c = controller;
+    final d = c.draft;
+    final sources = c.paySources;
+    final over = c.overspend;
+    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
+      DropdownButtonFormField<String>(
+        key: const Key('paid-now'),
+        initialValue: const ['none', 'full', 'part'].contains(d.paidNow) ? d.paidNow : 'none',
+        isExpanded: true,
+        decoration: const InputDecoration(labelText: 'Paid at the counter'),
+        items: [
+          for (final v in const ['none', 'full', 'part'])
+            DropdownMenuItem(value: v, child: Text('${paidNowCopy(v).english} · ${paidNowCopy(v).tagalog}', overflow: TextOverflow.ellipsis)),
+        ],
+        onChanged: (v) => c.setPaidNow(v ?? 'none'),
+      ),
+      if (d.paidNow != 'none') ...[
+        if (d.paidNow == 'part') ...[
+          const SizedBox(height: 10),
+          TextFormField(
+            key: const Key('paid-amount'),
+            initialValue: d.paidAmount,
+            keyboardType: const TextInputType.numberWithOptions(decimal: true),
+            decoration: const InputDecoration(labelText: 'Amount paid now', prefixText: '₱ '),
+            onChanged: c.setPaidAmount,
+          ),
+        ],
+        const SizedBox(height: 10),
+        DropdownButtonFormField<String>(
+          key: ValueKey('paid-from-${sources.join(',')}'),
+          initialValue: sources.contains(d.paidFrom) ? d.paidFrom : sources.first,
+          isExpanded: true,
+          decoration: InputDecoration(labelText: '${paidFromLabel.english} · ${paidFromLabel.tagalog}'),
+          items: [
+            for (final s in sources) DropdownMenuItem(value: s, child: Text(paySourceCopy(s).english, overflow: TextOverflow.ellipsis)),
+          ],
+          onChanged: (s) => c.setPaidFrom(s ?? 'company'),
+        ),
+        const SizedBox(height: 10),
+        if (d.paidFrom == 'credit')
+          DropdownButtonFormField<String>(
+            key: const Key('paid-credit'),
+            initialValue: c.credits.any((x) => x.id == d.paidCredit) ? d.paidCredit : null,
+            isExpanded: true,
+            decoration: const InputDecoration(labelText: 'Credit to use'),
+            items: [
+              for (final x in c.credits)
+                DropdownMenuItem(value: x.id, child: Text('${x.supplier} — ${peso(x.left)} left', overflow: TextOverflow.ellipsis)),
+            ],
+            onChanged: (id) {
+              if (id != null) c.setPaidCredit(id);
+            },
+          )
+        else
+          DropdownButtonFormField<String>(
+            key: const Key('paid-method'),
+            initialValue: payMethods.contains(d.paidMethod) ? d.paidMethod : 'cash',
+            isExpanded: true,
+            decoration: const InputDecoration(labelText: 'How'),
+            items: [for (final m in payMethods) DropdownMenuItem(value: m, child: Text(payMethodLabel(m)))],
+            onChanged: (m) => c.setPaidMethod(m ?? 'cash'),
+          ),
+        if (over != null) ...[
+          const SizedBox(height: 10),
+          PayWarning(key: const Key('paid-overspend'), text: overspendCopy(peso(over.held), peso(over.amount))),
+        ],
+      ],
+    ]);
+  }
+}
+
+
 class _ProblemText extends StatelessWidget {
   const _ProblemText(this.problem);
   final PurchaseProblem problem;
```

**Modify:** `lib/purchasing/ui/buyer_shell.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/ui/buyer_shell.dart b/lib/purchasing/ui/buyer_shell.dart
index 562b18a..646b249 100644
--- a/lib/purchasing/ui/buyer_shell.dart
+++ b/lib/purchasing/ui/buyer_shell.dart
@@ -142,7 +142,7 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     if (tabs.length < 2) return Scaffold(body: SafeArea(child: profile));
     final body = switch (_tab) {
       _Tab.shopping => ShoppingListScreen(controller: _shopping!, onRecord: (lines) => _record(lines: lines)),
-      _Tab.mine => MyPurchasesScreen(controller: _mine!, onOpenDraft: (d) => _record(draft: d), onOpenPurchase: _open),
+      _Tab.mine => MyPurchasesScreen(controller: _mine!, onOpenDraft: (d) => _record(draft: d), onOpenPurchase: _open, services: widget.purchasing),
       _Tab.profile => profile,
     };
     return Scaffold(
```

**Create:** `lib/purchasing/ui/pay_widgets.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../ui/theme.dart';
import 'pay_copy.dart';

/// A warning that never blocks (Q16 overspending, Q21 own money not allowed).
class PayWarning extends StatelessWidget {
  const PayWarning({super.key, required this.text});
  final Bilingual text;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: WmColors.brownTint, borderRadius: BorderRadius.circular(10)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(text.english, style: const TextStyle(color: WmColors.brownDeep, fontWeight: FontWeight.w700, fontSize: 13)),
          Text(text.tagalog, style: const TextStyle(color: WmColors.brownDeep, fontSize: 12)),
        ]),
      );
}

/// A purchase's payment state as a small pill (the Purchasing tab's colours).
class PayPill extends StatelessWidget {
  const PayPill(this.state, {super.key});
  final String state;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (state) {
      'paid' => (WmColors.green, WmColors.greenTint),
      'partial' => (WmColors.brownDeep, WmColors.brownTint),
      'unpaid' || 'overpaid' || 'void_paid' => (WmColors.danger, WmColors.dangerTint),
      _ => (WmColors.textSecondary, WmColors.inert),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(payStateCopy(state).english, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: fg)),
    );
  }
}

/// Asks for a note the server requires (a void's reason, "I did not receive
/// this"): the action stays off until something is typed. Null when cancelled.
/// The dialog owns its text box, so it is released only once the dialog has
/// gone — never while its closing animation still shows it.
Future<String?> askRequiredNote(
  BuildContext context, {
  required String title,
  required String message,
  required String action,
  String label = 'Note',
  Key fieldKey = const Key('note-field'),
  Key sendKey = const Key('note-send'),
}) =>
    showDialog<String>(
      context: context,
      builder: (_) => _NoteDialog(title: title, message: message, action: action, label: label, fieldKey: fieldKey, sendKey: sendKey),
    );

class _NoteDialog extends StatefulWidget {
  const _NoteDialog({required this.title, required this.message, required this.action, required this.label, required this.fieldKey, required this.sendKey});
  final String title;
  final String message;
  final String action;
  final String label;
  final Key fieldKey;
  final Key sendKey;

  @override
  State<_NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<_NoteDialog> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.message, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
          TextField(
            key: widget.fieldKey,
            controller: _text,
            autofocus: true,
            decoration: InputDecoration(labelText: widget.label),
            onChanged: (_) => setState(() {}),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          TextButton(
            key: widget.sendKey,
            onPressed: _text.text.trim().isEmpty ? null : () => Navigator.of(context).pop(_text.text.trim()),
            child: Text(widget.action),
          ),
        ],
      );
}
```

**Modify:** `pubspec.yaml` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/pubspec.yaml b/pubspec.yaml
index 58c55d2..fb8f510 100644
--- a/pubspec.yaml
+++ b/pubspec.yaml
@@ -1,7 +1,7 @@
 name: workmate
 description: "A new Flutter project."
 publish_to: 'none'
-version: 0.7.1+1008
+version: 0.8.0+1009
 
 environment:
   sdk: ^3.10.8
```


- [ ] **Step 1: Apply the files above** in the WorkMate repo.
- [ ] **Step 2: Tests.** `flutter test` → **914** passed; `flutter analyze` → no issues.
- [ ] **Step 3: Stop for the user** to review and commit.

### Task 4: Live — 0103, the web, the phone, the pilot

- [ ] **Step 1: The user applies the committed 0103** (Task 1 committed first): the whole file, unchanged, once, in the Supabase SQL editor.
- [ ] **Step 2: Verify the live database ourselves** (MCP `execute_sql`, read-only): `pur_cash_detail`, `pur_list_doc` and `pur_my_ops_done` match the file (`md5(replace(prosrc, chr(13), ''))`); the first two are executable by neither `authenticated` nor `anon`; `pur_my_ops_done` by `authenticated` only.
- [ ] **Step 3: Live acceptance.** Run `supabase/tests/2a4b_acceptance.sql` through MCP `execute_sql`. Expect `2a4b acceptance: all checks passed`. It rolls itself back; check afterwards that no `ZZ 2a4b` row and no new `pettyCash/` upload record exist.
- [ ] **Step 4: The user pushes Dacs Web** (Task 1).
- [ ] **Step 5: Release build** (PowerShell, WorkMate repo): `$env:JAVA_HOME="$HOME\.jdks\jbr-21.0.11"; flutter build apk --release` → `build\app\outputs\flutter-apk\app-release.apk`, **under 50 MB**. Copy to `Documents\WorkMate releases\dacs-workmate-0.8.0-1009.apk`. **Install on the test phone only** (`adb install -r`). Do **not** publish (R37).
- [ ] **Step 6: Set up the pilot (owner, Dacs Web):** project **`ZZ 2a4b pilot`** with one billing period; supplier **`ZZ Pay Hardware 2`**; staff@'s Buyer switch **ON**, "May use own money" **OFF**; **Give petty cash** ₱3,000 to staff@ (note `ZZ 2a4b`).
- [ ] **Step 7: Pilot checks** (test phone, staff@ unless stated). Record each result in *Execution notes*.

| # | Check | Expect |
|---|---|---|
| P1 | My purchases (0.8.0 was installed over 0.7.1) | A **My cash** card: Petty cash held **₱3,000.00** (R35). 0.7.1's saved lists and any drafts are still there (the phone database moved to version 2, R38) |
| P2 | Record purchase, ZZ Pay Hardware 2, `ZZ cement` ₱1,250 (reason `ZZ`), receipt photo, total 1250, **Paid now: Paid in full** (starts on Petty cash) | Recorded once; the row reads **Paid**; card **₱1,750** (Q3, R32) |
| P3 | Airplane ON. Record purchase `ZZ gravel` ₱1,000, **Paid part** ₱300, **Company**, GCash | **Waiting to send**. Airplane OFF → recorded **once** with its payment: **Partially paid, ₱700 left**; the card unchanged (company money) |
| P4 | Airplane ON. On ZZ gravel: **Record payment** ₱700, Petty cash, proof from the camera. Open ZZ gravel (still offline: its Payments need signal); airplane OFF, open it again **before** pulling My purchases | Offline, the row: "₱0.00 left · ₱700.00 waiting to send"; card ₱1,050 (R31). Online, the purchase shows the ₱700 as waiting or recorded and **offers no second ₱700** (left ₱0). Then **Paid**; on Dacs Web the proof opens |
| P4b | (R38) With signal: Record purchase `ZZ sand` ₱100, **Not paid yet**. Airplane ON: **Record payment** ₱100, Company. Airplane OFF just until it sends (its waiting card goes), airplane ON again; close and reopen My purchases | Either the payment reads **"Sent — shows in the list when it next updates"** and the row says "₱0.00 left · ₱100.00 not in this list yet", or (the list refreshed while there was signal) ZZ sand is simply **Paid**. Never missing from both, never counted twice. Airplane OFF, pull to refresh: **Paid**, no sent card |
| P5 | Airplane ON. My cash → **Report a return** ₱500, to "ZZ the owner", photo from the camera | "Not sent yet" on My cash; cash held **unchanged** (₱1,050). Airplane OFF → "waiting for the owner", still ₱1,050 (Q17, R31). Owner confirms on the web → **₱550**; the phone opens the return's photo (0103, R36); on the web, staff@'s own Cash tab shows its **photo** link (F3) |
| P6 | Record purchase `ZZ tiles` ₱1,000 Not paid yet; **Record payment** ₱1,000 Petty cash | The **warning** first (R33); saved; card **₱0.00** with "Shortfall ₱450.00" — the owner's tracker shows the same (Q16) |
| P7 | Owner (web): on ZZ cement record ₱500 more (Company) → Overpaid → **Resolve**: ₱300 refund to the company + **₱200 supplier credit** | Phone, pull to refresh: ZZ cement **Paid** |
| P8 | Record purchase `ZZ nails` ₱150, ZZ Pay Hardware 2, **Paid in full, Supplier credit** | The credit list shows "ZZ Pay Hardware 2 — ₱200.00 left"; recorded; **Paid**; the credit has **₱50 left**. On a new draft, change the supplier to a typed name: the credit option goes (R32) |
| P9 | My cash → **I did not receive this** on the ₱3,000 entry (empty note: Send stays off; then a note) | Flagged on the owner's tracker; owner clears it; the phone shows "Owner: …" (Q14, R30) |
| P10 | "Paid from" offers **no** own money. Owner turns **May use own money** ON; pull to refresh; Record purchase `ZZ paint` ₱100 Not paid yet, then **Record payment** ₱100 **My own money** | Offered now; recorded; **Paid**; card "Company owes me ₱100.00" (Q21, R32) |
| P11 | Open ZZ paint → its **Payments**: **Void…** the ₱100 (Void stays off until a reason is typed), reason `ZZ test` | Struck through "voided: ZZ test"; **Unpaid**; company owes back to ₱0. Airplane ON → Void says "This needs signal" (R30) |
| P12 | Airplane ON: Record payment ₱50 on ZZ paint. Owner voids ZZ paint on the web. Airplane OFF | **Needs attention**: "That purchase is no longer recorded…" in both languages; **Throw away** removes it (R29) |
| P12b | An old purchase from before 0102 (e.g. a Project Control purchase in My purchases' 60 days, if any staff@ recorded one; else skip) | Reads "Payment not tracked"; **no Record payment** on the row or on the purchase (R34) |
| P13 | Log out; **W-0007** signs in on the same phone | The worker app; no card, no price, no payment anywhere |
| P14 | `client_errors` since the install | Nothing new from WorkMate or the Cash tab |

- [ ] **Step 8: Clean-up.** Purchases list **filtered to `ZZ 2a4b pilot`**; void the ZZ purchases on the web; then a guarded SQL file **run by the user in the SQL editor** (dry run first; refuses if any matched row is not ZZ; the history guard off inside that transaction only) removes the project, supplier, the 0102 rows of this pilot and the upload records; the photo files are deleted by hand in Storage. Switches back to what the owner wants.
- [ ] **Step 9: Execution notes** in this plan; memory updated. **At launch** (R37): the real buyer's one buying run on **0.8.0**, then publish `dacs-workmate-0.8.0-1009.apk` in Dacs Web → Attendance → App updates (WorkMate stream).

---

## Self-review (against the answers)

| Answer | Where |
|---|---|
| Q3 (paid now, one transaction) | `paidNowPayment` / `paidNowProblems` → `purchaseBody.payments` → one `pur_record`; test "one pur_record with the payment inside it"; screen tests "Paid in full…", "Paid part…"; P2, P3 |
| Q4 (who may pay) | Phone sends no `person_id`: the server fills in the buyer (R2); R32 decides what is offered; test "an owner account … company money only" |
| Q5 (what a payment says) | `PaymentInput` → `paymentBody` (two-decimal text amount, credit = 'other'); proof optional (R34); P4 |
| Q6 (no signal) | Op kinds `pay` / `cash_return` on the send-once queue (R29); "left" counts unsent, on both screens (R31, R34); a payment counted exactly once, also offline (R38); a photo handed over is never deleted (R39); tests "waiting shows on My purchases…", "no signal: the uploaded proof is not uploaded again…", "the answer lost, the check finds it, then the list read fails…"; P3, P4, P4b, P5, P12 |
| Q7 (void, never delete) | `voidPayment` online, reason required (R30); `askRequiredNote`; screen test "Void needs a reason"; P11 |
| Q11, Q12 (credit used in parts) | Credits saved for offline; offered for the purchase's supplier only (R32); `OVER_CREDIT` checked before queueing; P7, P8 |
| Q14 (I did not receive this) | My cash → note required, online (R30); P9 |
| Q16 (overspend = warning, shortfall) | `overspendBy`, `cashAfter` (R31, R33); P6 |
| Q17, Q18 (returns, confirmation day) | Report a return queued; never lowers cash held until confirmed (R31); photo in `pettyCash/` (R36); P5 |
| Q21 (own money switch) | Offered only while on, as last read (R32); P10 |
| Q23 (phone screens) | "Paid now?" on Record purchase; the payment line + Record payment on My purchases; My cash card → screen (R35) |
| Q24 (who sees what) | `pur_my_cash` is the buyer's own; no owner tracker on the phone; P13 |
| F3 of 2A-4a | 0103 `photo_url`; the web's buyer and owner lists link it; the phone opens it (R36) |

No placeholders. Every server call the phone makes is live once 0103 is applied. Each task ends with its whole suite green on its own.

## Proof

Built in scratch clones: Dacs Web on `c3f4587` → Task 1 = `f2a9bc2`; WorkMate on `a7f5ed1` → Task 2 = `8968c8a`, Task 3 = `ae39628`.

- **Revision 2 (review findings):** each fix has a test that fails without it — "accepted, the answer lost, then a refresh — counted once" (and "only what the server has is finished; with no signal nothing is"), "Back during a slow Save waits; the proof handed to the queue is never deleted" (payment and return), "payments waiting on the phone show on the purchase and count in what is left", "a purchase from before payments were tracked offers no Record payment"; `pur_my_ops_done`'s own-ids rule fails both 0103 tests when broken.
- **Revision 3 (second review, R38):** the reviewer's case has a test on both screens — "the answer lost, the check finds it, then the list read fails — the saved list still counts it (My purchases)" and "… the saved cash held still counts it (My cash)" — plus "sent normally, then no signal — each saved copy counts it until that copy is read fresh; then it is forgotten", "sent while the cash is being read — read again, so it is counted exactly once", "still moving after three reads, or no signal for the check after the read — the saved copy, not a guess", "a purchase's payments and what the phone still holds come from one read"; the database's rules ("sent — never sent again and no longer waiting, but kept with its draft until forgotten", "forgetting never touches an op not sent yet", "a saved copy keeps which sent ops it counts") and its upgrade ("a 0.7.1 database (version 1) is upgraded in place"); "a saved My cash that counts a sent payment never lowers cash held by it again"; and two screen tests (a sent payment says "Sent" and "not in this list yet", never "waiting to send", and still counts in what is left). No server change: `pur_my_ops_done` is as in revision 2, and Task 1 is unchanged.
- **Task 1 (Dacs Web):** `npm test` green (39 suites; `purchasing-payments-server` 18, `purchasing-payments-screens` 23, money 249). `npm run test:sql` green (19 suites; `2a4_payments` 47, and **48** `--with-0103`). The 0103 test **fails** with either key removed from 0103 (checked by hand), and the static test fails too. `2a4b_acceptance.sql` dry-run on PGlite with Supabase-style JWT claims (the live `receipt_uploads` grant and `uploaded_by` default mirrored, both checked live): `all checks passed`, 0 rows left; **without 0103 it fails at A1**.
- **Task 2 (WorkMate):** `flutter test` **885** passed (832 + 53), `flutter analyze` clean.
- **Task 3 (WorkMate):** `flutter test` **914** passed, `flutter analyze` clean. Two real defects were found by the new screen tests and fixed before this plan: the payment line overflowed a phone-width card by 87 px (the button now sits under the state), and the note dialogs released their text box while the closing animation still drew it (the shared `askRequiredNote` dialog owns it).
- **Breakage run (phone): 55 / 55 caught** — each rule broken on purpose, one at a time, `flutter test test/purchasing` must fail: the payment body (credit = other, two-decimal text), the date and credit checks, cash held never below zero, a centavo over warns, left-to-pay never below zero, the return's day, "Paid now?" (full = total, petty cash for a staff buyer only, inside `pur_record`, checked before queueing), `OVER_CREDIT` not retried, the return photo's folder and upload kind, the proof attached, refused payments not counted, void needs a reason, a waiting payment cannot be thrown away, queued payments count as unsent, another supplier's credit never offered, own money only while allowed, the credit re-picked on a supplier change, petty cash first, the card's held figure, Record payment's default, waiting payments in what is left, no Void on a voided payment, an empty note never sent; and the review fixes — R38 (a check that marks nothing sent; no check before the read, or after it; not read again when an op went during it; a sent op deleted at once — the second review's bug; either saved copy's counts ignored; a sent op forgotten while a copy still shows it; sent shown as waiting; a purchase's waiting payments taken from another read; the purchase offline ignoring the saved list; a sent op sent again; the background sweeper woken for sent ops; a sent purchase counted as unsent; no upgrade from 0.7.1; sent payments left out of what is left, on the list and on the purchase; a sent payment called "waiting to send"), R39 (Back during Save, or a photo deleted while saving, on both Record payment and Report return), R34 (a not-tracked purchase payable; the detail offering a legacy one) and the detail ignoring waiting payments. The first run missed three (a centavo over, own money while off, Void on a voided payment): test gaps, each closed with a test, then caught. Revision 3's first run missed four: a saved My cash's counts ignored (a test added: "a saved My cash that counts a sent payment never lowers cash held by it again"), and three R39 checks — the R39 screen tests looked one frame after Back, when a closed screen is still drawn while it slides out, and nothing closed a screen in the middle of a Save. They now check that the screen is still the current one, and two new tests close the screen from the app during a slow Save (payment and return). Re-run: all four caught.
- Every file was restored and compared after each breakage run.
- **Android build:** `flutter build apk --debug` of Task 3 compiles (JDK 21, the app's Gradle plugin; no new package). A release build needs the upload key in `keystore.properties`, which lives only in the real WorkMate folder (not in git), so Task 4 builds the release there and checks it stays under 50 MB (0.7.1 was about 37 MB).

## Rehearsal

Fresh clones of the real repos (`core.autocrlf=false`): Dacs Web at `c3f4587`, WorkMate at `a7f5ed1`. The tasks were applied **from this plan's text only** — Create blocks written as given, Modify blocks with `git apply --ignore-whitespace` after `--check` — plus Task 1's CRLF command.

- Dacs Web, Task 1: **10 blocks** applied → all **10 files byte-identical** to the tested build (raw bytes, line endings included).
- WorkMate, Tasks 2 and 3: **17 + 13 blocks** applied → all **30 files byte-identical**.
- Revisions 2 and 3 were each rehearsed again from scratch on new clones after their review fixes: same result, every file byte-identical.
- Revision 1's first rehearsal found three new WorkMate files ending in a blank line, which a Create block cannot carry; the files were trimmed (no code change; `flutter test` 893 again, analyze clean) and the rehearsal repeated.

## Execution notes (Task 4, 23–24 October 2026)

- **Commits:** Dacs Web `aba80db` (Task 1; pushed 24 Oct), WorkMate `e8a331e` (Task 2) and `752fa2b` (Task 3), all by the user. Revision 3 of this plan was approved on 23 Oct; R37 (launch on 0.8.0+1009) was approved, then superseded by **R48 of the [0.8.1 plan](2026-10-24-workmate-0.8.1-pilot-fixes.md): launch ships 0.8.1+1010**. 0.8.0 was never published.
- **Step 1:** the user applied the committed 0103 in the SQL editor, 23 Oct ~12:56.
- **Step 2:** verified through MCP — the three function bodies match the file (`md5(replace(prosrc, chr(13), ''))`); `pur_cash_detail` and `pur_list_doc` executable by neither `authenticated` nor `anon`; `pur_my_ops_done` by `authenticated` only.
- **Step 3:** `2a4b_acceptance.sql` passed live; no ZZ row, petty-cash upload or money event left.
- **Step 4:** the user pushed Dacs Web on 24 Oct (origin/main `aba80db`).
- **Step 5:** release `dacs-workmate-0.8.0-1009.apk`, 37.7 MB, SHA-256 `18BBB454…A6A05B7`, signed with the same key as 0.7.1; installed over 0.7.1 on the test phone on 24 Oct 11:11. Not published.
- **Step 6:** project `ZZ 2a4b pilot` (one billing period), supplier `ZZ Pay Hardware 2`, ₱3,000 petty cash to staff@ (note `ZZ 2a4b`); staff@ Buyer ON, own money OFF.
- **Step 7 (pilot), 24 Oct — all PASS except P12b (skipped):**

| # | Result |
|---|---|
| P1 | PASS — card ₱3,000.00; 0.7.1's drafts and saved lists kept by the upgrade |
| P2 | PASS — ZZ cement ₱1,250 paid in full from petty cash: one purchase with its payment inside (one `pur_record`); card ₱1,750 |
| P3 | PASS — offline ZZ gravel ₱1,000, paid part ₱300 Company/GCash: waiting, then recorded once with its payment; Partially paid, ₱700 left; card unchanged |
| P4 | PASS — offline ₱700 petty-cash payment with a camera proof: card ₱1,050 at once; one ₱700 payment on the server with its proof; Paid; the proof opens on Dacs Web as a private download. The row read "₱700.00 waiting to send" (a zero "left" is not shown) |
| P4b | PASS (outcome B) — the list refreshed while there was signal, so ZZ sand simply showed Paid; one ₱100 payment on the server |
| P5 | PASS — offline return ₱500 with a photo: cash held unchanged until the owner confirmed, then ₱550 on the phone and the web; the phone shows the photo; staff@'s own Cash tab on the web links it (F3 of 2A-4a) |
| P6 | PASS — the overspend warning before saving; card ₱0.00 with "Shortfall ₱450.00", the same on the owner's tracker. (The first tries never reached Save; the 12:38 save recorded once.) |
| P7 | PASS — owner ₱500 Company → Overpaid → resolved as ₱300 refund + ₱200 supplier credit; the phone shows Paid |
| P8 | PASS — ZZ nails ₱150 paid from the credit ("₱200.00 left" offered) → ₱50 left; a typed supplier hides the credit |
| P9 | PASS — "I did not receive this" flagged on the tracker; owner cleared it ("ZZ checked"); the phone shows "Owner: ZZ checked"; no balance changed |
| P10 | PASS — own money not offered while off; switched on → a ₱100 own-money payment, authorized → Company owes ₱100 |
| P11 | PASS — Void offline: "This needs signal"; online with a reason: struck through, Unpaid, company owes back to ₱0 |
| P12 | PASS on the second try (ZZ wire ₱20): "Needs attention — That purchase is no longer recorded…" in both languages, Throw away. The first try (ZZ paint, ₱50) reached the server at 13:47:25, before the 13:50 void (the phone was briefly online), and correctly showed "Voided — paid, to recover" |
| P12b | Skipped — staff@'s only purchase from before 0102 is voided; covered by the R34 tests |
| P13 | PASS — W-0007 sees the worker app, nothing of payments |
| P14 | PASS — no `client_errors` |

- **Findings:** **F1** a voided purchase showed "Voided" and a second "Void" tag; **F2** a purchase opened with no signal showed a bare "No signal" page; **F3** a refresh could spin for a minute or more after the signal came back (the user force-closed the app). All three fixed in **0.8.1+1010** — see the [0.8.1 plan](2026-10-24-workmate-0.8.1-pilot-fixes.md). Also found there: a calendar-bound test (R47). Observation: Airplane mode on the test phone (Xiaomi) sometimes let a request through just after it was switched on.
- **Step 8 (clean-up):** done on 24 Oct after the 0.8.1 re-check — see the 0.8.1 plan's notes.
- **Step 9:** launch ships 0.8.1+1010 (R48): the real buyer's one buying run on 0.8.1, then publish it.
