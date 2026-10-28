# WorkMate Stage 2B-b — Stock on the phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buyers record stock from the WorkMate phone — goods **received**, **issued** to a project, **returned**, **moved** between projects or to the warehouse, and **leftovers** — online only and quantities only; the shopping list gets **"From stock"**, the **"In warehouse"** hint and **Issue from stock**; workers and team leaders see **"From stock"** on their own requests. Then one **joint ZZ pilot** (2B + 2C) with a guarded clean-up, and only then the launch. Stock stays **switched off** until the user decides at the end of the pilot.

**Architecture:** The phone calls the same stock functions as Dacs Web (0104's `stk_*`, with 0105's cost moves underneath) — no new server write path. One migration, **0106**, adds `from_stock` to the workers' own request list (`pr_my_requests`, otherwise 0085's, key for key) and lets the server **settle** a stock operation whose answer was lost: `pur_op_cancel` (under the same lock recording takes) and `pur_op_state` (read only), with 0096's `pur_op_begin` refusing a cancelled id. Dacs Web gains the pilot's way back — **Switch stock off…** for the main owner — and two SQL files for the pilot: a read-only live acceptance and a guarded clean-up. WorkMate gets a `lib/stock/` module (models with no peso, forms that refuse what the server refuses, a server client, a controller that follows the server switch, and the screens) and a Stock tab in the buyer app, shown only while the server says stock is on. Every phone write is a **submission** saved on the phone before it leaves — its operation id and its exact payload together — and kept until the server's answer is known; a lost answer locks it: only **Send again** (the saved payload, unchanged), **Check** (`pur_op_state`, read only) or **Cancel it** (`pur_op_cancel`) until the **server** settles it — recorded, or cancelled for good, so a late request with that id is refused. It survives closing the form and restarting the app, and is never sent by itself.

**Tech stack:** PostgreSQL / Supabase (SQL), vanilla JS and Node tests, PGlite; Flutter 3.38.9 / Dart 3.10.8 (Android), `flutter_test`.

**Spec:** [Mobile Purchasing](../specs/2026-09-30-workmate-mobile-purchasing-design.md) · answers: [2B + 2C questions](../specs/2026-10-24-workmate-stage2bc-questions.md) — **Q1–Q30 = A ("I approve all R", 24 Oct 2026)**; this plan carries out **Q26** (the phone), **Q28** (who sees values) and **Q30** (the pilot) · built on: plans [2B-a](2026-10-25-workmate-stage2b-a-stock.md) (0104, live with stock off since 26 Oct) and [2C](2026-10-26-workmate-stage2c-cost-moves.md) (0105, live with stock off since 27 Oct) · the buyer app as built: plans [2A-3b](2026-10-21-workmate-stage2a3b-buyer-app.md), [2A-4b](2026-10-23-workmate-stage2a4b-buyer-payments.md), [0.8.1](2026-10-24-workmate-0.8.1-pilot-fixes.md)

**Repos:** **Dacs Web** (base `db54690`, Task 1) and **WorkMate** (base `7996311` = the published 0.8.1+1010, Tasks 2–3). Task 4 puts 0106 live with stock off and the new app on the test phone; Task 5 is the joint pilot and the launch decision.

**Status:** Revision 4, 28 October 2026. Revision 3 and R89 were approved on 28 Oct; Task 1 is committed (`19b9b5c`). Revision 4 follows the user's review of Task 2 (applied, not committed): a saved stock submission the phone can no longer read was **skipped** — treated as gone, so it no longer held back new sends and the next save erased it. Now (R104) unreadable saved data is **kept exactly as stored** and **blocks new stock sends** until it is settled: if its account and operation id still read, the server settles it by **Check** or **Cancel** without its payload ever being rebuilt; otherwise the phone shows a **recovery error**. Unreadable storage is never treated as empty and never overwritten, and the in-memory store exists only in the tests. Task 1 and 0106 are unchanged. Revision 3 followed the user's review of revision 2, which accepted R101 and R103 and replaced R102's timed guess: before the phone lets a person change or drop a submission whose answer was lost, the **server** now settles its id — atomically, under the same operation lock recording takes, it either confirms the operation was recorded or cancels the id for good, and a request that arrives later with a cancelled id is refused (`OP_CANCELLED`). No clock decides anything. New in 0106: `pur_op_cancel`, `pur_op_state`, and 0096's `pur_op_begin` refusing a cancelled id; a test has the original request arrive after the cancel and after a new submission — only the new submission records — on PGlite, and on real PostgreSQL with two sessions (a cancel during a recording waits and reports it; a recording during a cancel waits and is refused). Revision 2 fixed the user's review finding on lost answers: revision 1 kept a form's operation id across Sends but rebuilt the payload each time, and kept nothing once the form closed — so after a timeout a changed quantity could go out under the old id (the server answers a repeated id with its **first** answer, whatever the payload — so the change would be silently lost), and closing the form or restarting the app forgot the uncertain one, letting a second record go out. Now each submission's id and exact payload are saved together before it is sent (R101); after a lost answer the form locks — Send again (unchanged) or Check — and nothing is edited and no new stock submission starts until it is resolved; submissions survive closing and restarting, are never sent by itself, and belong to their account only (R103). Tests cover a changed quantity after a timeout, reopening and a restart. Nothing is applied live and nothing is in either repo yet. The code below was built and tested first in scratch clones (one commit per task, every suite green after each), every important rule was broken on purpose to prove a test catches it (see *Proof*), and the plan was then re-applied to fresh clones of both repos from its own text and compared byte for byte (see *Rehearsal*). **One ruling needs the user's decision: R89** (who uses stock on the phone — see the note under the table).

## Global Constraints

- **Quantities only on the phone (Q26, Q28):** no WorkMate screen shows a stock peso — not to staff, not to Buyer staff, and **not to owner accounts either** (their values stay on Dacs Web). The phone never reads a value or estimate out of a stock answer; a cost move appears as its state in words ("Cost assignment pending"). Purchase prices on Buyer screens stay as 2A built them.
- **Online only, once (Q26, R101–R103):** stock actions need signal and nothing is sent by itself. A submission's operation id and exact payload are saved together on the phone **before** it leaves and never change; a repeat is answered by the server from its records (`pur_ops`, first answer wins). A lost answer is resolved only by the server: its answer to Send again (unchanged), a refusal of the first Send, or the id confirmed recorded or cancelled for good (`pur_op_state`, `pur_op_cancel`) — never by editing, and never by a clock. No stock *answer* (overview, lists) is kept on the phone.
- **The server decides:** whether stock is on and whether this account may record are `stk_status`'s; every refusal comes from 0104 / 0105 and is shown in both languages. The phone's own checks (quantity, date, reason, more than awaited, more than bought) only refuse what the server would refuse anyway.
- **Workers and team leaders** see "From stock" on their own requests (and, for a leader, the team's) — a quantity, nothing else. 0106 changes nothing else in `pr_my_requests`.
- **New data needs real DB columns:** 0106 adds no table or column; it redefines one function (`pr_my_requests`) copied from 0085 with two keys added. Task 4 Step 1 checks the live body still matches 0085 before applying.
- **Migrations:** next number = highest + 1 = **0106** (highest on disk: `0105_stock_cost_moves.sql`). The user applies the **committed** file, unchanged, once (SQL editor). We then verify the live database ourselves.
- **Stock stays off (Q1, Q30):** Task 4 changes nothing for anyone while stock is off — the Stock tab, the button and every new number stay hidden. **Only the user switches stock on**, in Task 5, for the pilot. Executors never press the switch.
- **Dates:** a stock record's day is Manila's (`WorkDate.today()` on the phone; never later than today), never `toISOString()`.
- **Bilingual (2A, Q22 of 2A):** every message and key button on the phone in English with the Tagalog line underneath; screen titles and small field labels English.
- **The user commits.** Executors never run `git commit` or `git push`. Each task ends at a "stop for the user" step. The user's own uncommitted edit in `admin.html` stays as it is: apply the Modify blocks with `git apply`, which leaves the rest of the file alone.
- **The WorkMate signing key** (`android/keystore.properties` and the key file) stays in the real WorkMate repo only; release builds happen there.
- **CRLF files:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are CRLF. Task 1's Step 1 restores CRLF after applying (the diffs are shown with LF).

## Rulings (2B-b)

R1–R88 stand (plans 2A-2 … 2C). New, found while building and testing this plan. **For the user's approval with the plan.**

| # | Ruling |
|---|---|
| R89 | **Who uses stock on the phone (Q26) — DECISION NEEDED.** Q26 says the phone is for "Buyer staff and office staff". WorkMate lets in only workers, team leaders and accounts the server lets buy (`pur_buyer()`: the owner, an admin allowed Expenses, staff with the Buyer switch); **this plan does not change who can sign in**. So on the phone, stock is for those buyer accounts — and of them, only accounts the server lets record stock (`stk_status.can_record`, the same rule as the web's Stock screen) get the buttons; the others see the Stock tab read-only. **Office staff without the Buyer switch record stock on Dacs Web** (Requests → Stock), as today. Letting every office account into WorkMate is a bigger change (sign-in, the app's shells, the shared-phone rules) and is left for later unless the user wants it now. |
| R90 | **What the phone records (Q26):** **Received** — part or all of a warehouse purchase line, in the line's own unit, even before the office matches it (it becomes stock when matched, Q6–Q7); **Issue / move** — warehouse → project, project → project, project → warehouse, filling a request line of that item (same unit) or **unplanned with a reason**; **Return** — part of an issue back to the warehouse, the same lots (Q10); **Leftovers** — of a project purchase, left at the site or brought to the warehouse, in the catalogue item's unit, never more than the line brought (Q3). **Dacs Web only:** matching, not delivered, counts, opening stock, reversals and withdrawals, and every cost decision (approve, reject, ask again, reverse). |
| R91 | **Online only, never twice (rev 2: see R101–R103).** Stock needs signal; a refusal is explained in both languages and nothing is recorded. A lost answer is never pressed again from the form's current values — see R101. |
| R92 | **No pesos, even for owner accounts (Q28).** The phone's stock models carry no value field: `costs` are read as kind, status and reversed only, shown as words ("Cost assignment pending", "Cost transferred", "Cost move rejected — kept with source"). An owner account sees values on Dacs Web. |
| R93 | **The Stock tab follows the server switch.** `stk_status` is asked when the buyer app opens, when it comes back to the front, and on tapping the Stock or Shopping list tab. Stock on → the tab appears; switched off → the tab goes (an open Stock tab returns to the Shopping list) and Issue from stock goes. **No signal is not "off"**: the tab stays with the last answer and a notice. |
| R94 | **Issue from stock on the shopping list (Q9, Q26).** On a Mine or Unassigned line with a catalogue item and stock in the warehouse, for an account that may record: **Issue from stock** opens the issue form with the item, warehouse → the line's own job (Main Contract or Additional Works) and that request line fixed, the quantity starting at the smaller of "In warehouse" and "Still to buy" when both are in the same unit (else empty). "In warehouse: N" is a hint, never a reservation — the server checks the real balance (`NOT_ENOUGH`). "From stock" shows beside Bought and Still to buy once something was issued. |
| R95 | **Workers and leaders (Q26):** "From stock: N unit · Galing sa stock" under the request line once the office issued something for it (0106's `from_stock`, 0 while stock is off — then nothing shows). A return keeps it (the goods were delivered, R57); a reversed issue takes it back. 0106 also sends `from_stock` per weekly portion, for a later screen; the phone shows the line's. |
| R96 | **Mistakes are fixed on the web.** The phone never reverses: every stock screen says "A mistake? The office reverses it on Dacs Web (Requests → Stock → History)." |
| R97 | **The pilot's way back.** Dacs Web's Stock screen gets **Switch stock off…** for the main owner (typed OFF; the server's own `stk_set_enabled(false)`, main owner only since 0104). It undoes and deletes nothing: recording stops on the web and the phone, the Stock tab goes for everyone but the main owner, and the old "Add to inventory" tick works again. It exists for a pilot that fails before launch; after the launch, switching off would strand real stock and should not be used. |
| R98 | **The joint pilot (Q30).** Stock is one switch for the whole company, so the pilot runs in a **launch window**: the user switches stock on, the pilot runs on the web and the test phone with ZZ data only (projects `ZZ 2bc pilot A`, `ZZ 2bc pilot B` and the job `ZZ 2bc pilot A — extra room`; items and supplier `ZZ 2bc …`), then the guarded clean-up removes every ZZ row, then the user decides: **launch** (keep stock on, publish the app) or **switch stock off** (R97). While the switch is on, the old "Add to inventory" tick is hidden company-wide and real buyers on 0.8.1 see nothing new. |
| R99 | **The clean-up (Q30).** `supabase/tests/2bc_pilot_cleanup.sql`, run by the user in the SQL editor — dry run first (deletes, reports, undoes), then for real. It removes exactly the ZZ rows (projects named `ZZ 2bc pilot…` and their periods, budgets and settings; items, purchases, suppliers named `ZZ 2bc…`; their stock records, moves, covers, lots, matches, events, cost moves and cost-move expense rows; the ZZ sites; the ZZ requests) and **refuses with nothing changed** if real data is mixed in: a real line on a ZZ purchase, a payment on one, a ZZ item on a real request, a real purchase covering a ZZ request, a Work Plan blocker or task, payroll, overhead, a contract, a reimbursement or a construction project on a ZZ project, a hand-entered expense there, real goods at a ZZ site or ZZ goods at a real one, a ZZ cost move writing on a real project, a ZZ lot matched to a real item, a gallery photo. The history guards are off for its own transaction only and checked back on; the real expenses' count and sum, real purchases, stock records, moves, cost moves and requests are checked unchanged. It never touches the stock switch, the warehouse place, operation ids or photo files. |
| R101 | **A submission keeps its id and exact payload together (rev 2, the user's review).** When Send passes the phone's own checks, the phone makes the operation id, builds the server parameters once (`p_op` inside them) and **saves both together before sending** — so even a crash mid-send leaves it on the phone. If the answer is lost (no signal, a time-out, or any unknown error) the submission stays saved, unchanged, and the form **locks**: its fields cannot change, its Send is gone, and it offers only **Send again** — the saved parameters, byte for byte, under the same id — **Check** or **Cancel it and change**. Closing the form keeps it: the Stock tab shows it at the top ("Not sure this was recorded", what it was, when it was last sent) with Send again, Check and **Cancel it**, and **no new stock submission** starts for that account until it is resolved (the Stock tab's Issue / move, Record leftovers, Received… and Return… go; the shopping list's Issue from stock goes; the Stock tab stays even if stock is switched off meanwhile). Resolved means (R102): the server answered (recorded — or its first answer replayed); the server refused its first Send; or the server confirmed its id recorded (it goes as recorded — nothing to change) or cancelled for good (then, in its form, the fields unlock and the next Send is a **new** operation; on the Stock tab it simply goes). |
| R102 | **The server settles it — never a clock (rev 3, the user's review).** Every stock write takes its operation's lock first (`pur_op_begin`: per account and operation id, held until its transaction ends) and records only after it. **Cancel it** (`pur_op_cancel`) takes that **same** lock: if the operation was recorded it answers `recorded` and changes nothing (the phone closes it as recorded); otherwise it writes a `cancelled` mark for that account and id and answers `cancelled`. A recording already running holds the lock, so the cancel waits and then sees it; a request that arrives after the cancel — however late, the person's own first Send included — finds the mark at the lock and is **refused (`OP_CANCELLED`)**, recording nothing. Only after `cancelled` may the person change it (a **new** submission, a new id) or drop it. **Check** (`pur_op_state`) is read only: `recorded` (it goes), `cancelled` (it goes — nothing was recorded), or `none` ("Not recorded yet — it may still arrive. Send it again, or cancel it."), which never unlocks anything. A refusal of a Send again does not settle it (the first Send might still arrive); `OP_CANCELLED` does. No signal: nothing known, nothing changes. A stock write checks who may record and that stock is on before the lock, so a late request may be refused even earlier (e.g. `STOCK_OFF`) — still never recorded. Only the phone's stock submissions are ever cancelled; a cancel mark is a `pur_ops` row of kind `cancelled`. |
| R104 | **Saved data the phone cannot read is kept, and blocks (rev 4, the user's review).** The phone's settings file is read entry by entry. An entry that does not read in full (garbled payload, missing or bad fields) is **kept exactly as stored**: every later save writes it back, and nothing removes it except the server settling its id. If its account and operation id still read (well-formed ids) it is that account's: it **blocks** that account's new stock sends, shows on the Stock tab ("A saved stock record on this phone is damaged…") with **Check** and **Cancel it** — by its id alone; its payload is never rebuilt, so there is no Send again — and goes only when the server answers `recorded` or `cancelled`. An entry whose account does not read could be anyone's: it blocks **every** account on the phone; an entry of this account whose operation id does not read cannot be settled: it blocks this account. Both, and a stored text that is not a list at all, show a **recovery error** ("Saved stock records on this phone can't be read. New stock records are paused on this phone — nothing was deleted. Ask the office for help before recording stock here."). Damaged stored text is never read as empty and never overwritten: every save refuses (`STOCK_STORE_DAMAGED`). If a save fails while the phone is open, a new submission is not sent (nothing left the phone — its form stays editable) and no new stock send goes until the store is fixed. The app always uses the phone's settings file: with no store there is no Stock tab; the in-memory store is a test helper only. |
| R103 | **Kept across restarts, never sent by itself, one account's own.** Unresolved submissions live in the phone's settings file (quantities and ids only, no peso) and come back after closing or restarting the app. On opening and on coming back to the app the phone **checks** them (read only) — one the server settled (recorded, or cancelled) simply goes — but it **never sends or cancels** one by itself, with or without signal. Each belongs to the account that sent it: another account signing in on the same phone neither sees, sends, checks nor cancels it (the server's check and cancel answer per account), and is not held back by it; it waits for its owner. |
| R100 | **Version 0.9.0+1011**, built in the real WorkMate repo; on the test phone for Task 4 and the pilot; **published only at launch** (Task 5, the user's decision). Workers stay on what they have (the 0E switch-over is still deferred). |

## File structure

| File | Task | What |
|---|---|---|
| `supabase/migrations/0106_workmate_phone_stock.sql` | 1 | **New.** `pr_my_requests` (0085's) + `from_stock` per line and per portion; `pur_op_begin` (0096's) refusing a cancelled id; `pur_op_cancel`, `pur_op_state` |
| `supabase/tests/2bb_phone.pglite.mjs` | 1 | **New.** 16 tests on PGlite: From stock for workers and leaders (line and each portion); 0085's answer key for key; settling a lost answer (cancel: recorded or cancelled for good, per account; **the original arriving after the cancel and a new submission — only the new one records**; `pur_op_begin` = 0096's but for the refusal; a repeated id gets the first answer); the acceptance script passing as written and failing when it should; the whole simulated pilot cleaned beside real data; every clean-up refusal and after-check |
| `supabase/tests/2bb_concurrency.mjs` | 1 | **New.** Real PostgreSQL, two sessions: a cancel during a recording waits and reports it; a recording during a cancel waits and is refused; both released together, 15 rounds — never both |
| `supabase/tests/2bb_acceptance.sql` | 1 | **New.** Live acceptance, rolls itself back (writes one cancel mark inside it) |
| `supabase/tests/2bc_pilot_cleanup.sql` | 1 | **New.** The pilot's guarded clean-up (R99) |
| `js/stock-admin.js`, `tests/stock-admin.test.js`, `css/purchasing-admin.css`, `admin.html` | 1 | **Switch stock off…** (R97); its test; a style; script versions |
| `package.json` | 1 | `test:sql` runs the new suite |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` | 1 | Docs (CRLF) |
| `lib/stock/domain/stock_models.dart`, `stock_failure.dart`, `stock_forms.dart` | 2 | **New.** What the server sends (no peso), every refusal in both languages, the forms' own checks and bodies |
| `lib/stock/data/stock_remote.dart` | 2 | **New.** The `stk_*` calls, Check (`pur_op_state`) and Cancel (`pur_op_cancel`); the signed-in user checked before a write, a check or a cancel |
| `lib/stock/domain/stock_submission.dart`, `lib/stock/data/stock_pending_store.dart`, `lib/stock/data/stock_submitter.dart` | 2 | **New.** A submission (id + exact payload); where unresolved ones wait (the settings file); the one place stock is sent, retried, checked and cancelled; unreadable saved data kept, blocking, settled by id (R101–R104) |
| `lib/purchasing/domain/pur_models.dart`, `lib/requests/domain/remote_request.dart` | 2 | `from_stock`, `in_warehouse`, `catalog_item_id` read (and kept in the saved shopping list) |
| `test/stock/stock_fakes.dart`, `test/stock/stock_domain_test.dart`, `test/stock/stock_submitter_test.dart` | 2 | **New.** A fake stock server that answers a repeated id like `pur_ops` and refuses a cancelled one like 0106, and the in-memory store (tests only); 17 + 25 tests |
| `lib/stock/ui/*.dart` | 3 | **New.** Controller, Stock screen, issue / move / return form, Received sheet, leftovers form, shared form parts (the locking Send, the unresolved box), words |
| `lib/purchasing/ui/buyer_shell.dart`, `lib/purchasing/list/shopping_list_screen.dart`, `lib/purchasing/purchasing_services.dart`, `lib/main.dart` | 3 | The Stock tab, Issue from stock, the stock client and the settings-file store wired in |
| `lib/requests/detail/request_detail_screen.dart` | 3 | "From stock" on a worker's request line |
| `pubspec.yaml` | 3 | `0.9.0+1011` |
| `test/stock/stock_screens_test.dart`, `test/requests/detail/request_screens_test.dart` | 3 | **New** / one more test: 36 tests (a changed quantity after a time-out, reopening, a restart, damaged saved records and a recovery error among them) |

---

### Task 1: Dacs Web — 0106, the pilot's SQL, Switch stock off

**Interfaces produced:** `pr_my_requests(p_limit)` — as 0085, plus `from_stock` (numeric) on every line and every portion. Read by WorkMate's `RemoteLine.fromStock` / `Portion.fromStock` (Task 2). The stock functions the phone calls are 0104 / 0105's, unchanged: `stk_status()`, `stk_overview()`, `stk_choices()`, `stk_request_lines(p_folder)`, `stk_project_lines(p_folder)`, `stk_receive(p_op, p_purchase, p_line_no, p_qty, p_on, p_note)`, `stk_leftover(p_op, p_purchase, p_line_no, p_qty, p_where, p_on, p_note)`, `stk_move(p_op, p_body)`. New: `pur_op_cancel(p_op uuid) → text` ('recorded' | 'cancelled'; signed-in only) and `pur_op_state(p_op uuid) → text` ('recorded' | 'cancelled' | 'none'); every write refuses a cancelled id with `OP_CANCELLED`.

<!-- Tests -->

**Create:** `supabase/tests/2bb_acceptance.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 2B-b acceptance — migration 0106 (live: "From stock" on the workers'
-- requests; settling a stock submission whose answer was lost). Self-wrapped in
-- begin / rollback: section D writes one cancel mark, which is rolled back.
-- Run it through MCP execute_sql. Success ends with the row
-- '2bb acceptance: all checks passed'.
--   A. every worker and team leader who has requests reads them with
--      `from_stock` on each line and each weekly portion — 0 while stock is off;
--   B. the answer carries no money and no stock detail;
--   C. anon cannot call it; stock is still off; the cancel and state
--      functions are for signed-in accounts only, pur_op_begin for nobody;
--   D. as the main owner: a fresh operation id reads 'none'; cancelling it
--      says 'cancelled' (twice: the same answer); the operation lock every
--      write takes before recording (pur_op_begin) then refuses that id
--      OP_CANCELLED. (While stock is off a stock write stops even earlier,
--      STOCK_OFF — so the lock is called directly here, with the same claims.)
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';

do $$
declare
  w record;
  doc jsonb;
  n_people int := 0;
  n_lines int := 0;
  v_owner uuid := (select id from profiles where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active'
                     order by created_at limit 1);
  v_op uuid := gen_random_uuid();
  v_err text;
begin
  assert not coalesce((select s.enabled from stk_settings s where s.owner_id = v_owner), false), 'stock must still be off live';
  for w in select distinct p.id from profiles p join pr_requests r on r.requester_id = p.id
            where p.role in ('worker', 'teamLeader') and coalesce(p.status, 'active') = 'active' loop
    perform set_config('request.jwt.claims', json_build_object('sub', w.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    doc := pr_my_requests(200);
    execute 'reset role';
    n_people := n_people + 1;
    assert jsonb_typeof(doc) = 'array', 'A1 a list for ' || w.id;
    assert not exists (select 1 from jsonb_array_elements(doc) r, jsonb_array_elements(r -> 'lines') l
                        where not (l ? 'from_stock') or (l ->> 'from_stock')::numeric <> 0
                           or exists (select 1 from jsonb_array_elements(l -> 'portions') p
                                       where not (p ? 'from_stock') or (p ->> 'from_stock')::numeric <> 0)),
      'A2 every line and portion says from_stock, 0 while stock is off — ' || w.id;
    n_lines := n_lines + (select count(*) from jsonb_array_elements(doc) r, jsonb_array_elements(r -> 'lines') l);
    assert doc::text !~ '"(amount|price|cost[a-z_]*|value|peso|supplier[a-z_]*|lot_id|location[a-z_]*)"\s*:',
      'B1 no money and no stock detail — ' || w.id;
  end loop;
  assert not has_function_privilege('anon', 'pr_my_requests(integer)', 'execute'), 'C1 anon cannot read requests';
  assert has_function_privilege('authenticated', 'pr_my_requests(integer)', 'execute'), 'C2 signed-in workers can';
  assert has_function_privilege('authenticated', 'pur_op_cancel(uuid)', 'execute')
     and not has_function_privilege('anon', 'pur_op_cancel(uuid)', 'execute'), 'C3 pur_op_cancel: signed-in only';
  assert has_function_privilege('authenticated', 'pur_op_state(uuid)', 'execute')
     and not has_function_privilege('anon', 'pur_op_state(uuid)', 'execute'), 'C4 pur_op_state: signed-in only';
  assert not has_function_privilege('authenticated', 'pur_op_begin(uuid)', 'execute')
     and not has_function_privilege('anon', 'pur_op_begin(uuid)', 'execute'), 'C5 pur_op_begin: nobody calls it directly';

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert pur_op_state(v_op) = 'none', 'D1 a fresh id reads none';
  assert pur_op_cancel(v_op) = 'cancelled', 'D2 cancelled';
  assert pur_op_cancel(v_op) = 'cancelled', 'D3 cancelling again gives the same answer';
  assert pur_op_state(v_op) = 'cancelled', 'D4 it reads cancelled';
  execute 'reset role';
  begin
    perform pur_op_begin(v_op);
  exception when others then
    v_err := sqlerrm;
  end;
  assert v_err = 'OP_CANCELLED', 'D5 the operation lock refuses a cancelled id — got ' || coalesce(v_err, 'no refusal');
  raise notice 'checked % workers / leaders, % request lines', n_people, n_lines;
end $$;

select '2bb acceptance: all checks passed' as result;
rollback;
```

**Create:** `supabase/tests/2bb_concurrency.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 2B-b — SETTLING A LOST ANSWER: TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2bb_phone.pglite.mjs)
//
// Same approach as 2c_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104 +
// 0105 + 0106 VERBATIM, two connections. Nothing touches the live database.
// The phone's "Cancel it" (pur_op_cancel) and a stock write with the same
// operation id take the SAME lock (pur_op_begin's):
//   1. a cancel while the original is being recorded waits, then says
//      'recorded' — the write stands, nothing is cancelled
//   2. the original arriving while a cancel holds the lock waits, then is
//      refused OP_CANCELLED — nothing recorded
//   3. both released together (the cancel 0-40 ms late), 15 rounds: always
//      one of those two, never a cancelled id that was also recorded
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2bb-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2B-b settling a lost answer — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 + 0105 + 0106 on PostgreSQL)');
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
  // 0106's pr_my_requests reads request tables this harness does not build;
  // its body is not checked here (2bb_phone.pglite.mjs runs it).
  await admin.query(`set check_function_bodies = off`);
  await admin.query(mig('0106_workmate_phone_stock.sql'));
  await admin.query(`set check_function_bodies = on`);
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

  const opMove = (id, it, f, qty) => ({ sql: `select stk_move($1, $2::jsonb) r`, args: [id, issue(it, f, qty)] });
  const CANCEL = `select pur_op_cancel($1) r`;
  const issued = async (it) => Number((await one(`select count(*) n from stk_records r where r.kind = 'issue' and r.item_id = $1`, [it])).n);
  const state = async (uid, id) => call(uid, `select pur_op_state($1) r`, [id]);
  // Has [p] settled within [ms]? (false = still waiting on a lock)
  const settled = (p, ms) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms))]);
  const fails = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

  // 1
  {
    let bad = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('B1 ' + i);
      const f = await mkFolder('cancel late ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const id = (await one(`select gen_random_uuid() id`)).id;
      const [a, b] = [await session(BUYER), await session(BUYER)];
      await a.query('begin');
      const m = opMove(id, it, f, 4);
      await a.query(m.sql, m.args);                         // recorded, not yet committed: A holds the lock
      const cancel = b.query(CANCEL, [id]);
      const waited = !(await settled(cancel, 300));
      await a.query('commit');
      const answer = (await cancel).rows[0].r;
      await a.end(); await b.end();
      const ok = waited && answer === 'recorded' && await issued(it) === 1 && await state(BUYER, id) === 'recorded';
      if (!ok && bad++ === 0) console.log('       first bad:', waited, answer);
    }
    check('1. a cancel while the original is being recorded waits for it, then says recorded (the record stands)', bad === 0, `wrong outcome ${bad}`);
  }

  // 2
  {
    let bad = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('B2 ' + i);
      const f = await mkFolder('original late ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const id = (await one(`select gen_random_uuid() id`)).id;
      const [a, b] = [await session(BUYER), await session(BUYER)];
      await b.query('begin');
      const first = (await b.query(CANCEL, [id])).rows[0].r;  // cancelled, not yet committed: B holds the lock
      const m = opMove(id, it, f, 4);
      const late = fails(a.query(m.sql, m.args));
      const waited = !(await settled(late, 300));
      await b.query('commit');
      const err = await late;
      await a.end(); await b.end();
      const ok = first === 'cancelled' && waited && /OP_CANCELLED/.test(err || '') && await issued(it) === 0
        && await state(BUYER, id) === 'cancelled';
      if (!ok && bad++ === 0) console.log('       first bad:', first, waited, err);
    }
    check('2. the original arriving while the cancel holds the lock waits, then is refused OP_CANCELLED (nothing recorded)', bad === 0, `wrong outcome ${bad}`);
  }

  // 3
  {
    let bad = 0, dead = 0, rec = 0, can = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('B3 ' + i);
      const f = await mkFolder('race ' + i); await mkPeriod(f);
      await stocked(it, 10);
      const id = (await one(`select gen_random_uuid() id`)).id;
      const m = opMove(id, it, f, 4);
      // The cancel starts 0, 10, 20 or 40 ms late, so both orders happen.
      const delay = [0, 0.01, 0.02, 0.04][i % 4];
      const out = await pair(BUYER, m.sql, m.args, BUYER, `select (select pur_op_cancel($1) from (select pg_sleep(${delay})) s) r`, [id]);
      if (deadlock(out)) dead++;
      const n = await issued(it);
      const recorded = out[0].ok && out[1].ok && out[1].r === 'recorded' && n === 1;
      const cancelled = !out[0].ok && /OP_CANCELLED/.test(out[0].msg) && out[1].ok && out[1].r === 'cancelled' && n === 0;
      if (recorded) rec++;
      if (cancelled) can++;
      if (!(recorded || cancelled) && bad++ === 0) console.log('       first bad:', JSON.stringify(out), n);
    }
    check(`3. a write and a cancel released together: recorded-and-reported or cancelled-and-refused, never both (${rec} recorded, ${can} cancelled)`,
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/2bb_phone.pglite.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 2B-b (THE PHONE) — SERVER TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096 … 0105 and 0106 VERBATIM on PGlite over the 2C
// suite's tables and helpers:
//   A. "From stock" on the workers' requests (0106's pr_my_requests);
//   B. the joint pilot's guarded clean-up (2bc_pilot_cleanup.sql), run on a
//      whole simulated pilot beside real data.
// Nothing here talks to the live database.
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
const M106 = mig('0106_workmate_phone_stock.sql');
const M85 = mig('0085_workmate_requests.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
const CLEAN = read(path.join(ROOT, 'supabase/tests/2bc_pilot_cleanup.sql'));
// What 0085's pr_my_requests reads beyond the 2C base: teams, photos, who asks.
const REQUESTS_0085 = `
create table pr_teams (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  name text not null, active boolean not null default true, created_at timestamptz not null default now());
create table pr_team_members (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  team_id uuid not null references pr_teams(id), worker_id uuid not null references profiles(id), is_leader boolean not null default false,
  added_at timestamptz not null default now(), removed_at timestamptz);
create table pr_photos (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id), line_id uuid references pr_lines(id), storage_path text not null unique,
  uploaded_by uuid not null references profiles(id), created_at timestamptz not null default now());
${fnText(M85, 'pr_is_requester')}
${fnText(M85, 'pr_is_current_leader')}
${fnText(M51, 'attendance_data_owner')}
`;

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
  await db.exec(REQUESTS_0085);
  await db.exec(M106);
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

// ── 2B-b helpers ──────────────────────────────────────────────────────
const myRequests = async (db, who) => { await as(db, who); return (await one(db, `select pr_my_requests(100) x`)).x; };
const lineOf = (doc, lineId) => doc.flatMap(r => r.lines).find(l => l.id === lineId);
const issue = (db, who, it, to, qty, extra = {}) => move(db, who, { item_id: it, from: 'warehouse', to, quantity: qty, ...extra });
async function stubs(db) {
  await db.exec(`
    create table if not exists construction_projects (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete set null);
    create table if not exists wp_tasks (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id), work_folder_id uuid references folders(id));
    create table if not exists wp_blockers (id uuid primary key default gen_random_uuid(), request_id uuid references pr_requests(id));
    create table if not exists overhead_expenses (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade,
      billing_period_id uuid references projects(id) on delete set null, amount numeric);
    create table if not exists reimbursements (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
    create table if not exists labor_contracts (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
    create table if not exists pr_line_conflicts (id uuid primary key default gen_random_uuid(), line_id uuid references pr_lines(id));
    create table if not exists pr_item_refs (id uuid primary key default gen_random_uuid(), catalog_item_id uuid references pr_catalog_items(id),
      folder_id uuid references folders(id) on delete cascade);
    create table if not exists pr_gallery_photos (id uuid primary key default gen_random_uuid(), catalog_item_id uuid references pr_catalog_items(id));`);
}
// The clean-up as the user runs it: the file, then (2nd run) with v_dry false.
const cleanup = (db, real = false) => {
  if (!real) return db.exec(CLEAN);
  const run = CLEAN.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
  assert(run !== CLEAN, 'the setting line is in the file');
  return db.exec(run);
};
async function state(db) {
  return one(db, `select (select count(*) from folders) folders, (select count(*) from projects) periods,
    (select count(*) from pr_catalog_items) items, (select count(*) from purchases) purchases, (select count(*) from purchase_lines) lines,
    (select count(*) || '/' || coalesce(sum(amount), 0) from expenses) expenses, (select count(*) from stk_records) records,
    (select count(*) from stk_moves) moves, (select count(*) from stk_cost_moves) cost_moves, (select count(*) from stk_events) events,
    (select count(*) from stk_covers) covers, (select count(*) from stk_lots) lots, (select count(*) from stk_locations) places,
    (select count(*) from pr_requests) requests, (select count(*) from pr_lines) req_lines, (select count(*) from suppliers) suppliers`);
}

console.log('\n2B-b phone (0096 + 0097 + 0101 + 0102 + 0103 + 0104 + 0105 + 0106 on PGlite)');

// ── A. "From stock" on the workers' requests (0106, Q26) ─────────────

await test('a worker sees "From stock" on their request line and portion once the office issues it; 0 before', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 6 });
  let l = lineOf(await myRequests(db, WORKER), r.line);
  eq([num(l.from_stock), l.portions.map(p => num(p.from_stock))], [0, [0]], 'nothing issued yet');
  await issue(db, STAFF, it, f, 4, { request_line_id: r.line });
  l = lineOf(await myRequests(db, WORKER), r.line);
  eq([num(l.from_stock), l.portions.map(p => num(p.from_stock)), num(l.needed)], [4, [4], 6], '4 of the 6 from stock; still needed as asked');
});

await test('each weekly portion says what stock filled of it, not the whole line\'s', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 3 });
  const later = (await one(db, `select pr_batch_for($1, now() + interval '8 days') b`, [OWNER])).b;
  assert(later !== r.batch, 'a later weekly batch');
  await db.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 3)`, [OWNER, r.line, later]);
  await issue(db, STAFF, it, f, 4, { request_line_id: r.line });
  const l = lineOf(await myRequests(db, WORKER), r.line);
  const parts = l.portions.map(p => num(p.from_stock));
  eq([num(l.from_stock), parts.length, parts.reduce((a, b) => a + b, 0)], [4, 2, 4], 'the line 4, its two portions 4 between them');
  assert(parts.every(x => x < 4), 'no portion shows the whole line: ' + JSON.stringify(parts));
});

await test('a team leader sees "From stock" on a member\'s request too; another worker sees nothing of it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const team = (await one(db, `insert into pr_teams (owner_id, name) values ($1, 'Masons') returning id`, [OWNER])).id;
  await db.query(`insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values ($1, $2, $3, false), ($1, $2, $4, true)`,
                 [OWNER, team, WORKER, LEADER]);
  const r = await request(db, f, { item: it, quantity: 5 });
  await db.query(`update pr_requests set team_id = $1 where id = $2`, [team, r.req]);
  await issue(db, BUYER, it, f, 5, { request_line_id: r.line });
  eq(num(lineOf(await myRequests(db, LEADER), r.line).from_stock), 5);
  const other = '00000000-0000-0000-0000-000000000016';
  await db.query(`insert into profiles (id, role, owner_id, status, display_name) values ($1, 'worker', $2, 'active', 'Ben')`, [other, OWNER]);
  eq(lineOf(await myRequests(db, other), r.line), undefined, 'not their request');
});

await test('a return keeps "From stock" (the goods were delivered, R57); a reversed issue takes it back to 0', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 6 });
  const i1 = await issue(db, STAFF, it, f, 6, { request_line_id: r.line });
  await move(db, STAFF, { item_id: it, returns_record: i1.record_id, quantity: 2 });
  eq(num(lineOf(await myRequests(db, WORKER), r.line).from_stock), 6, 'a return never reopens a request');
  const r2 = await request(db, f, { item: it, quantity: 3 });
  const i2 = await issue(db, STAFF, it, f, 3, { request_line_id: r2.line });
  await reverse(db, STAFF, i2.record_id, 'wrong project');
  eq(num(lineOf(await myRequests(db, WORKER), r2.line).from_stock), 0);
});

await test('0106 changes nothing else: the answer is 0085\'s, key for key, plus "from_stock" on lines and portions', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const g = await folder(db, 'Extra room', { parent: f });
  await stocked(db, it, 10);
  const r = await request(db, f, { item: it, quantity: 6 });
  await request(db, g, { project: f, description: 'Sand', quantity: 2 });
  await issue(db, STAFF, it, f, 2, { request_line_id: r.line });
  await db.exec(fnText(M85, 'pr_my_requests').replace('create or replace function pr_my_requests(', 'create or replace function pr_my_requests_0085('));
  await as(db, WORKER);
  const was = (await one(db, `select pr_my_requests_0085(100) x`)).x;
  const now = (await one(db, `select pr_my_requests(100) x`)).x;
  const strip = (doc) => doc.map(rq => ({ ...rq, lines: rq.lines.map(({ from_stock, ...l }) => ({ ...l, portions: l.portions.map(({ from_stock: _f, ...p }) => p) })) }));
  eq(strip(now), was);
  assert(now.every(rq => rq.lines.every(l => 'from_stock' in l && l.portions.every(p => 'from_stock' in p))), 'every line and portion says it');
  const keys = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { keys.add(k); walk(x); }); };
  walk(now);
  eq([...keys].filter(k => /amount|price|cost|peso|value|supplier|lot|location|record/.test(k)), [], 'no money and no stock detail for workers');
});

await test('stock off: "from_stock" is there and 0; the grant is unchanged (authenticated, never anon)', async () => {
  const db = await fresh({ on: false });
  const f = await folder(db, 'Barlin'); await period(db, f);
  const r = await request(db, f, { quantity: 2 });
  eq(num(lineOf(await myRequests(db, WORKER), r.line).from_stock), 0);
  eq([(await one(db, `select has_function_privilege('authenticated', 'pr_my_requests(integer)', 'execute') x`)).x,
      (await one(db, `select has_function_privilege('anon', 'pr_my_requests(integer)', 'execute') x`)).x], [true, false]);
});

const ACCEPT = read(path.join(ROOT, 'supabase/tests/2bb_acceptance.sql'));
// Supabase's auth.uid() reads the JWT claims, as the script sets them; live profiles have created_at.
async function acceptancePrep(db) {
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as
                   $$ select coalesce(nullif(current_setting('test.uid', true), ''),
                                      nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
                 alter table profiles add column if not exists created_at timestamptz not null default now();
                 select set_config('test.uid', '', false);`);
}

await test('the live acceptance script (2bb_acceptance.sql) passes as written, stock off, and changes nothing', async () => {
  const db = await fresh({ on: false });
  const f = await folder(db, 'Barlin'); await period(db, f);
  await request(db, f, { quantity: 2 });
  await request(db, f, { quantity: 1, description: 'Sand' });
  await acceptancePrep(db);
  const before = await one(db, `select (select count(*) from pr_requests) r, (select count(*) from stk_settings) s`);
  const res = await db.exec(ACCEPT);
  assert(res.some(x => (x.rows || []).some(r => r.result === '2bb acceptance: all checks passed')), 'the success row');
  eq(await one(db, `select (select count(*) from pr_requests) r, (select count(*) from stk_settings) s`), before);
});

await test('the acceptance script fails on a database without 0106, and when anon may read requests', async () => {
  for (const [why, spoil, want] of [
    ['0085\'s pr_my_requests (0106 not applied)', (db) => db.exec(fnText(M85, 'pr_my_requests')), 'A2'],
    ['anon granted', (db) => db.exec(`grant execute on function pr_my_requests(integer) to anon`), 'C1'],
    ['0096\'s pur_op_begin (a cancelled id not refused)', (db) => db.exec(fnText(M96, 'pur_op_begin')), 'D5'],
    ['pur_op_cancel open to anon', (db) => db.exec(`grant execute on function pur_op_cancel(uuid) to anon`), 'C3'],
    ['lines without from_stock (portions with it)', (db) => {
      const line = "                        'from_stock', pr_line_from_stock(l.id),\n";
      const fn = fnText(M106, 'pr_my_requests');
      assert(fn.split(line).length === 2, 'the line key is in 0106 once');
      return db.exec(fn.replace(line, ''));
    }, 'A2'],
  ]) {
    const db = await fresh({ on: false });
    const f = await folder(db, 'Barlin'); await period(db, f);
    await request(db, f, { quantity: 2 });
    await acceptancePrep(db);
    await spoil(db);
    await refused(db.exec(ACCEPT), want, why);
  }
});

// ── A2. What the phone's lost-answer handling relies on (R101, R102) ──

const moveBody = (it, f, q) => JSON.stringify({ on: TODAY, item_id: it, from: 'warehouse', to: f, quantity: q, unplanned_reason: 'slab' });
const opState = async (db, who, id) => { await as(db, who); return (await one(db, `select pur_op_state($1) x`, [id])).x; };
const opCancel = async (db, who, id) => { await as(db, who); return (await one(db, `select pur_op_cancel($1) x`, [id])).x; };
const issueCount = async (db) => num((await one(db, `select count(*) n from stk_records where kind = 'issue'`)).n);

await test('Cancel it: under the operation lock the server finds it recorded (changing nothing) or cancels the id for good; Check reads it', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pid = await stocked(db, it, 10);
  const done = op();
  await rpc(db, STAFF, 'stk_move', [done, moveBody(it, f, '4')]);
  eq([await opState(db, STAFF, done), await opCancel(db, STAFF, done), await opState(db, STAFF, done)], ['recorded', 'recorded', 'recorded'],
     'recorded: the cancel says so and changes nothing');
  eq([await issueCount(db), await bal(db, it, 'warehouse')], [1, 6]);
  const lost = op();
  eq(await opState(db, STAFF, lost), 'none', 'never arrived');
  eq([await opCancel(db, STAFF, lost), await opCancel(db, STAFF, lost), await opState(db, STAFF, lost)], ['cancelled', 'cancelled', 'cancelled'],
     'cancelled for good; asking again gives the same answer');
  eq(await opState(db, BUYER, lost), 'none', 'another account\'s ids are its own');
  await refused(rpc(db, STAFF, 'stk_move', [lost, moveBody(it, f, '4')]), 'OP_CANCELLED', 'an issue with it');
  await refused(rpc(db, STAFF, 'stk_receive', [lost, pid, 1, '1', TODAY, '']), 'OP_CANCELLED', 'a receipt with it');
  await refused(rpc(db, STAFF, 'stk_leftover', [lost, pid, 1, '1', 'site', TODAY, '']), 'OP_CANCELLED', 'leftovers with it');
  eq([await issueCount(db), await bal(db, it, 'warehouse')], [1, 6], 'nothing recorded by any of them');
  // Ids are each account's own: staff@ recorded `shared`; the buyer cancelling the same id cancels the buyer's own.
  const shared = op();
  await rpc(db, STAFF, 'stk_move', [shared, moveBody(it, f, '1')]);
  eq(await opCancel(db, BUYER, shared), 'cancelled', 'never answered from another account\'s record');
  await refused(rpc(db, BUYER, 'stk_move', [shared, moveBody(it, f, '1')]), 'OP_CANCELLED', 'the buyer\'s own id is cancelled');
  eq([await opState(db, STAFF, shared), await opState(db, BUYER, shared), await issueCount(db)], ['recorded', 'cancelled', 2],
     'staff@\'s record untouched; the buyer recorded nothing');
  await refused((async () => { await as(db, ''); return one(db, `select pur_op_cancel($1) x`, [op()]); })(), 'AUTH_REQUIRED', 'signed in only');
});

await test('the original request arriving after cancellation and a new submission: only the new submission records', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const original = op();              // sent with 4; its answer was lost before it reached the server
  eq(await opState(db, STAFF, original), 'none');
  eq(await opCancel(db, STAFF, original), 'cancelled', 'the phone cancels it before the person may change it');
  const changed = op();               // the person changed it to 6: a new submission, a new id
  await rpc(db, STAFF, 'stk_move', [changed, moveBody(it, f, '6')]);
  await refused(rpc(db, STAFF, 'stk_move', [original, moveBody(it, f, '4')]), 'OP_CANCELLED', 'the original, arriving late, is refused');
  eq([await issueCount(db), num((await one(db, `select quantity q from stk_records where kind = 'issue'`)).q), await bal(db, it, 'warehouse')], [1, 6, 4],
     'only the new submission: one issue of 6');
  eq([await opState(db, STAFF, original), await opState(db, STAFF, changed)], ['cancelled', 'recorded']);
});

await test('0106\'s pur_op_begin is 0096\'s, unchanged but for refusing a cancelled id', () => {
  const was = fnText(M96, 'pur_op_begin');
  const now = fnText(M106, 'pur_op_begin');
  const back = now.replace('  v_kind text;\n', '')
    .replace('select o.result, o.kind into v_prev, v_kind', 'select o.result into v_prev')
    .replace(/  -- 2B-b \(R102\)[\s\S]*?raise exception 'OP_CANCELLED' using errcode = 'P0001';\n  end if;\n/, '');
  eq(back, was);
  assert(now.includes("perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));"), 'the lock');
  assert(fnText(M106, 'pur_op_cancel').includes("perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));"),
         'the cancel takes the very same lock');
});

await test('a repeated operation id gets the first answer, whatever the payload — so the phone never changes one', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const id = op();
  const body = (q) => JSON.stringify({ on: TODAY, item_id: it, from: 'warehouse', to: f, quantity: q, unplanned_reason: 'slab' });
  const first = await rpc(db, STAFF, 'stk_move', [id, body('4')]);
  const again = await rpc(db, STAFF, 'stk_move', [id, body('6')]);
  eq([again.record_id, again.replayed], [first.record_id, true], 'the first answer, marked replayed');
  eq(num((await one(db, `select count(*) n from stk_records where kind = 'issue'`)).n), 1, 'recorded once');
  eq(num((await one(db, `select quantity q from stk_records where kind = 'issue'`)).q), 4, 'the 6 was never recorded');
});

// ── B. The joint pilot's clean-up (Q30) ──────────────────────────────

// The pilot as the runbook (Task 4) does it — on the web and the phone —
// beside real data that must survive untouched.
async function pilot(db) {
  await stubs(db);
  // Real data first.
  const realItem = await item(db, 'Cement');
  const real = await folder(db, 'Barlin'); await period(db, real);
  const realBuy = await stocked(db, realItem, 10);
  const ri = await issue(db, STAFF, realItem, real, 3, { unplanned_reason: 'slab' });
  await cdecide(db, OWNER, ri.cost_moves[0], true);
  const realReq = await request(db, real, { item: realItem, quantity: 2 });
  await db.query(`insert into expenses (owner_id, project_id, expense_name, category, quantity, amount)
                  select $1, id, 'Nails', 'Materials', 1, 75 from projects where folder_id = $2`, [OWNER, real]);
  // The ZZ pilot.
  const a = await folder(db, 'ZZ 2bc pilot A'); await period(db, a);
  const b = await folder(db, 'ZZ 2bc pilot B'); await period(db, b, 500);
  const job = await folder(db, 'ZZ 2bc pilot A — extra room', { parent: a });
  const cement = await item(db, 'ZZ 2bc cement');
  const wire = await item(db, 'ZZ 2bc wire', 'piece');
  const sand = await item(db, 'ZZ 2bc sand');
  const req = await request(db, a, { item: cement, quantity: 6 });
  await request(db, job, { project: a, item: sand, quantity: 2, description: 'ZZ 2bc sand' });
  const wh = await buyWith(db, [{ destination: 'warehouse', item_name: 'ZZ 2bc cement', quantity: 10, amount: 1000 }],
                           [{ kind: 'delivery_fee', amount: 50 }]);
  await db.query(`insert into suppliers (owner_id, name, created_by) values ($1, 'ZZ 2bc hardware', $1)`, [OWNER]);
  await db.query(`update purchases set supplier_id = (select id from suppliers where name = 'ZZ 2bc hardware') where id = $1`, [wh]);
  await receive(db, BUYER, wh, 1, 6);
  await match(db, STAFF, wh, 1, cement, 10);
  await receive(db, BUYER, wh, 1, 4);
  const i1 = await issue(db, BUYER, cement, a, 4, { request_line_id: req.line });
  await cdecide(db, OWNER, i1.cost_moves[0], true);
  const back = await move(db, BUYER, { item_id: cement, returns_record: i1.record_id, quantity: 1 });
  await cdecide(db, OWNER, back.cost_moves[0], true);
  const pj = await projectBuy(db, b, 'ZZ 2bc wire', 2, { unit: 'box', amount: 300 });
  await match(db, STAFF, pj, 1, wire, 100, '2 boxes = 100 pcs');
  await leftover(db, BUYER, pj, 1, 50, 'warehouse');   // in pieces (the item's unit)
  const t = await move(db, BUYER, { item_id: wire, from: 'warehouse', to: a, quantity: 30, unplanned_reason: 'ties' });
  await cdecide(db, OWNER, t.cost_moves[0], false, 'wrong project');
  const again = await cresubmit(db, STAFF, t.cost_moves[0], 'see photo');
  await cdecide(db, OWNER, again.cost_move_id, true);
  const mv = await move(db, BUYER, { item_id: cement, from: a, to: b, quantity: 1, unplanned_reason: 'formwork' });
  await cdecide(db, OWNER, mv.cost_moves[0], true);
  const c = await count(db, STAFF, { item_id: cement, at: 'warehouse', counted: 5, reason: 'damaged' });
  await decide(db, OWNER, c.record_id, true);
  const o = await opening(db, STAFF, { item_id: sand, at: job, quantity: 3 });
  await decide(db, OWNER, o.record_id, true);
  const wrong = await issue(db, STAFF, cement, b, 1, { unplanned_reason: 'x' });
  await reverse(db, STAFF, wrong.record_id, 'mistake');
  return { real, realItem, realBuy, realReq, a, b, cement, wh, pj, req };
}

await test('the clean-up removes every ZZ pilot row and nothing real — dry run first, then the real run', async () => {
  const db = await fresh();
  const p = await pilot(db);
  await db.exec(`reset role`);
  // A real supplier no purchase uses yet: only "ZZ 2bc…" suppliers may go.
  await db.query(`insert into suppliers (owner_id, name, created_by) values ($1, 'Real Hardware', $1)`, [OWNER]);
  const before = await state(db);
  const realBefore = await one(db, `select (select count(*) || '/' || sum(e.amount) from expenses e join projects pp on pp.id = e.project_id where pp.folder_id = $1) barlin,
                                           (select count(*) from stk_records r where r.item_id = $2) real_records,
                                           (select count(*) from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id where lt.item_id = $2) real_cost,
                                           (select count(*) from stk_settings where enabled) switched_on`, [p.real, p.realItem]);
  const dry = await code(cleanup(db));
  assert(dry.includes('DRY RUN OK') && /purchases 2/.test(dry) && /projects 3/.test(dry) && /requests 2/.test(dry), dry);
  eq(await state(db), before, 'the dry run changed nothing');
  await cleanup(db, true);
  eq((await all(db, `select name from folders order by name`)).map(r => r.name), ['Barlin']);
  eq((await all(db, `select name from pr_catalog_items order by name`)).map(r => r.name), ['Cement']);
  eq((await all(db, `select name from suppliers where name like 'ZZ%'`)).length, 0);
  eq((await all(db, `select name from suppliers where name = 'Real Hardware'`)).length, 1, 'a real supplier stays, used or not');
  // Every stock row left is the real purchase's or the real item's.
  eq(await one(db, `select (select count(*) from stk_records where not (coalesce(item_id = $1, false) or coalesce(purchase_id = $2, false))) records,
                           (select count(*) from stk_lots where item_id <> $1) lots,
                           (select count(*) from stk_matches where item_id <> $1 or purchase_id <> $2) matches,
                           (select count(*) from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id where lt.item_id <> $1) cost_moves,
                           (select count(*) from stk_moves m join stk_lots lt on lt.id = m.lot_id where lt.item_id <> $1) moves,
                           (select count(*) from stk_locations where kind = 'site' and folder_id <> $3) sites`, [p.realItem, p.realBuy, p.real]),
     { records: 0, lots: 0, matches: 0, cost_moves: 0, moves: 0, sites: 0 }, 'no ZZ stock row left');
  eq(await one(db, `select (select count(*) || '/' || sum(e.amount) from expenses e join projects pp on pp.id = e.project_id where pp.folder_id = $1) barlin,
                           (select count(*) from stk_records r where r.item_id = $2) real_records,
                           (select count(*) from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id where lt.item_id = $2) real_cost,
                           (select count(*) from stk_settings where enabled) switched_on`, [p.real, p.realItem]), realBefore, 'real data untouched, the switch left as it was');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 1, 'the real purchase only');
  eq(num((await one(db, `select count(*) n from pr_requests`)).n), 1, 'the real request only');
  eq(num((await one(db, `select count(*) n from stk_locations where kind = 'warehouse'`)).n), 1, 'the warehouse place stays');
  eq((await all(db, `select tgname from pg_trigger where tgname in ('stk_events_no_change', 'stk_moves_no_change', 'stk_covers_no_change')
                      and tgenabled = 'O' order by 1`)).length, 3, 'history guards back on');
  await refused(db.query(`delete from stk_events`), 'HISTORY_IMMUTABLE', 'and they work');
  await refused(cleanup(db), 'no project named', 'a second run finds nothing');
  // Stock still works for real goods afterwards.
  await issue(db, STAFF, p.realItem, p.real, 1, { unplanned_reason: 'after clean-up' });
});

await test('the clean-up refuses — and changes nothing — when real data is mixed into the pilot', async () => {
  for (const [why, spoil, want] of [
    ['real goods at a ZZ site', (db, p) => issue(db, STAFF, p.realItem, p.a, 1, { unplanned_reason: 'x' }), 'real goods were recorded at a ZZ site'],
    ['a hand-entered expense on a ZZ project', (db, p) => db.query(`insert into expenses (owner_id, project_id, amount)
        select $1, id, 10 from projects where folder_id = $2`, [OWNER, p.a]), 'hand-entered expense'],
    ['a real line on a ZZ purchase', (db, p) => db.query(`insert into purchase_lines (owner_id, purchase_id, line_no, destination, folder_id, item_name, quantity, gross_amount)
        values ($1, $2, 9, 'project', $3, 'Nails', 1, 5)`, [OWNER, p.wh, p.real]), 'also has a real line'],
    ['a ZZ item on a real request', (db, p) => db.query(`update pr_lines set catalog_item_id = $1 where id = $2`, [p.cement, p.realReq.line]), 'ZZ item is on a real request'],
    ['a Work Plan task on a ZZ project', (db, p) => db.query(`insert into wp_tasks (folder_id) values ($1)`, [p.a]), 'Work Plan task'],
  ]) {
    const db = await fresh();
    const p = await pilot(db);
    await as(db, OWNER);
    await spoil(db, p);
    await db.exec(`reset role`);
    const before = await state(db);
    await refused(cleanup(db, true), want, why);
    eq(await state(db), before, why + ': nothing changed');
  }
  const db = await fresh();
  await stubs(db);
  await refused(cleanup(db, true), 'no project named', 'no pilot at all');
});

await test('every other clean-up guard refuses too (one pilot; each spoil rolled back afterwards)', async () => {
  const db = await fresh();
  const p = await pilot(db);
  const periodOf = async (f) => (await one(db, `select id from projects where folder_id = $1 order by id limit 1`, [f])).id;
  for (const [why, spoil, want] of [
    ['a real job under a ZZ project', () => folder(db, 'Fence', { parent: p.a }), 'a job under a ZZ project'],
    ['a ZZ job under a real project', () => folder(db, 'ZZ 2bc pilot stray', { parent: p.real }), 'sits under a real project'],
    ['a payment on a ZZ purchase', () => db.query(`insert into pur_payments (owner_id, purchase_id, first_purchase_id, amount, paid_on, method, source, created_by)
        values ($1, $2, $2, 10, $3, 'cash', 'company', $1)`, [OWNER, p.wh, TODAY]), 'payments, refunds or credits'],
    ['a real purchase covering a ZZ request', () => db.query(`insert into purchase_lines (owner_id, purchase_id, line_no, destination, item_name, quantity, gross_amount, request_line_id)
        values ($1, $2, 9, 'warehouse', 'Nails', 1, 5, $3)`, [OWNER, p.realBuy, p.req.line]), 'a real purchase covers a ZZ request'],
    ['a Work Plan blocker on a ZZ request', () => db.query(`insert into wp_blockers (request_id) values ($1)`, [p.req.req]), 'Work Plan blocker'],
    ['a ZZ purchase matched to a real item', () => db.query(`update stk_lots set item_id = $1 where purchase_id = $2`, [p.realItem, p.wh]), 'matched to a real catalogue item'],
    ['ZZ goods issued to a real project', () => issue(db, STAFF, p.cement, p.real, 1, { unplanned_reason: 'x' }), 'recorded at a real project'],
    ['a ZZ cost-move row on a real project', async () => {
      await db.exec(`select set_config('dacs.purchase_write', 'on', true)`);
      await db.query(`update expenses set project_id = $1 where stk_cost_move_id is not null and project_id = $2`, [await periodOf(p.real), await periodOf(p.b)]);
    }, 'wrote a row on a real project'],
    ['a gallery photo of a ZZ item', () => db.query(`insert into pr_gallery_photos (catalog_item_id) values ($1)`, [p.cement]), 'gallery photos'],
  ]) {
    await db.exec(`reset role`);
    const before = await state(db);
    await db.exec('begin');
    await spoil();
    await db.exec(`reset role`);
    await refused(cleanup(db, true), want, why);
    await db.exec('rollback');
    eq(await state(db), before, why + ': rolled back');
  }
  await cleanup(db, true);
  eq(num((await one(db, `select count(*) n from folders where name like 'ZZ%'`)).n), 0, 'and with no spoil it cleans');
});

await test('the clean-up\'s own after-checks stop a broken copy of it, with nothing changed', async () => {
  const db = await fresh();
  await pilot(db);
  await db.exec(`reset role`);
  const real = CLEAN.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
  for (const [why, from, to, want] of [
    ['a ZZ item left behind', '  delete from pr_catalog_items where id = any(zi);\n', '', 'a ZZ row is still there'],
    ['a ZZ project left behind', '  delete from folders where id = any(zf);\n', '', 'a ZZ project is still there'],
    ['real expenses deleted', '  delete from expenses where stk_cost_move_id = any(zcm) or', '  delete from expenses where true or', 'real expenses changed'],
    ['a history guard left off', "  execute 'alter table stk_moves enable trigger stk_moves_no_change';\n", '', 'history guard is not back on'],
  ]) {
    assert(real.split(from).length === 2, why + ': the line is in the file once');
    const before = await state(db);
    await refused(db.exec(real.replace(from, to)), want, why);
    eq(await state(db), before, why + ': nothing changed');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/2bc_pilot_cleanup.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- WorkMate 2B-b + 2C joint pilot (Q30): remove the "ZZ 2bc pilot" test data.
--
-- Run by the USER in the Supabase SQL editor, after the pilot (plan
-- docs/superpowers/plans/2026-10-27-workmate-stage2b-b-phone.md, Task 4).
-- One transaction. Any failed guard stops it and changes NOTHING.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It deletes everything, prints what it
--            removed in a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- What is "ZZ" (and nothing else is touched):
--   projects  — every folder whose name starts "ZZ 2bc pilot" (with their
--               billing periods, budgets and settings: the folder cascade);
--   items     — every catalogue item whose name starts "ZZ 2bc";
--   purchases — every purchase with a line on a ZZ project, or a warehouse
--               line whose item name starts "ZZ 2bc" (all of its lines must be ZZ);
--   stock     — every stock record of a ZZ item or of a ZZ purchase, their
--               moves, request covers, lots, matches, events, cost moves and
--               the cost-move expense rows; the ZZ projects' sites;
--   requests  — every request for a ZZ project (lines, weekly portions,
--               events, conflicts, photo rows);
--   suppliers — named "ZZ 2bc…" that no remaining purchase uses.
-- Not touched: the stock switch (stk_settings and its "switched" events),
-- the company warehouse place, real projects, items, purchases, requests,
-- stock and expenses, operation ids (pur_ops), and photo FILES (see the end).
-- The history guards (stk_events / stk_moves / stk_covers) are switched off
-- for this transaction only, and checked back on before it ends.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  zf uuid[]; zi uuid[]; zp uuid[]; zl uuid[]; zc uuid[]; zloc uuid[]; zlot uuid[]; zr uuid[]; zcm uuid[];
  zreq uuid[]; zrl uuid[]; zpor uuid[]; zper uuid[];
  real_exp_n bigint; real_exp_sum numeric; real_pur bigint; real_rec bigint; real_mov bigint; real_cm bigint; real_req bigint;
  n int; real_rec_tmp int; msg text := '';
begin
  -- ---------- what is ZZ ----------
  select coalesce(array_agg(id), '{}') into zf from folders where name like 'ZZ 2bc pilot%';
  if cardinality(zf) = 0 then
    raise exception 'GUARD: no project named "ZZ 2bc pilot…" — nothing to clean';
  end if;
  if exists (select 1 from folders f where f.parent_folder_id = any(zf) and not f.id = any(zf)) then
    raise exception 'GUARD: a job under a ZZ project is not named "ZZ 2bc pilot…"';
  end if;
  if exists (select 1 from folders f where f.id = any(zf) and f.parent_folder_id is not null and not f.parent_folder_id = any(zf)) then
    raise exception 'GUARD: a "ZZ 2bc pilot…" job sits under a real project';
  end if;
  select coalesce(array_agg(id), '{}') into zper from projects where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zi from pr_catalog_items where name like 'ZZ 2bc%';
  select coalesce(array_agg(distinct purchase_id), '{}') into zp from purchase_lines
   where folder_id = any(zf) or (destination = 'warehouse' and item_name like 'ZZ 2bc%');
  if exists (select 1 from purchase_lines where purchase_id = any(zp)
              and not (folder_id = any(zf) or (destination = 'warehouse' and item_name like 'ZZ 2bc%'))) then
    raise exception 'GUARD: a ZZ purchase also has a real line — stop and check';
  end if;
  select coalesce(array_agg(id), '{}') into zl from purchase_lines where purchase_id = any(zp);
  select coalesce(array_agg(id), '{}') into zc from purchase_charges where purchase_id = any(zp);
  if exists (select 1 from pur_payments where purchase_id = any(zp) or first_purchase_id = any(zp))
     or exists (select 1 from pur_refunds where purchase_id = any(zp))
     or exists (select 1 from pur_supplier_credits where purchase_id = any(zp)) then
    raise exception 'GUARD: a ZZ purchase has payments, refunds or credits (the pilot records none) — stop and check';
  end if;

  -- Requests for ZZ projects; ZZ items never on a real request, nor ZZ requests filled by real purchases.
  select coalesce(array_agg(id), '{}') into zreq from pr_requests where folder_id = any(zf) or work_folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zrl from pr_lines where request_id = any(zreq);
  select coalesce(array_agg(id), '{}') into zpor from pr_line_portions where line_id = any(zrl);
  if exists (select 1 from pr_lines where catalog_item_id = any(zi) and not request_id = any(zreq)) then
    raise exception 'GUARD: a ZZ item is on a real request';
  end if;
  if exists (select 1 from purchase_lines where request_line_id = any(zrl) and not purchase_id = any(zp))
     or exists (select 1 from purchase_line_covers where (request_line_id = any(zrl) or portion_id = any(zpor)) and not line_id = any(zl)) then
    raise exception 'GUARD: a real purchase covers a ZZ request';
  end if;
  if exists (select 1 from wp_blockers where request_id = any(zreq)) then
    raise exception 'GUARD: a Work Plan blocker points at a ZZ request';
  end if;

  -- Stock: ZZ items and ZZ purchases only, at the warehouse or ZZ sites only.
  select coalesce(array_agg(id), '{}') into zloc from stk_locations where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zlot from stk_lots where item_id = any(zi) or purchase_id = any(zp);
  if exists (select 1 from stk_lots where id = any(zlot) and not item_id = any(zi)) then
    raise exception 'GUARD: a ZZ purchase was matched to a real catalogue item';
  end if;
  if exists (select 1 from stk_lots where item_id = any(zi) and purchase_id is not null and not purchase_id = any(zp)) then
    raise exception 'GUARD: a ZZ item has stock from a real purchase';
  end if;
  if exists (select 1 from stk_matches where (item_id = any(zi)) <> (purchase_id = any(zp))) then
    raise exception 'GUARD: a match mixes a ZZ item with a real purchase (or the other way)';
  end if;
  select coalesce(array_agg(id), '{}') into zr from stk_records
   where item_id = any(zi) or purchase_id = any(zp) or lot_id = any(zlot);
  if exists (select 1 from stk_records where (from_location = any(zloc) or to_location = any(zloc)) and not id = any(zr)) then
    raise exception 'GUARD: real goods were recorded at a ZZ site';
  end if;
  if exists (select 1 from stk_records r where r.id = any(zr) and (
               (r.from_location is not null and not r.from_location = any(zloc)
                and r.from_location <> (select id from stk_locations w where w.owner_id = r.owner_id and w.kind = 'warehouse'))
            or (r.to_location is not null and not r.to_location = any(zloc)
                and r.to_location <> (select id from stk_locations w where w.owner_id = r.owner_id and w.kind = 'warehouse')))) then
    raise exception 'GUARD: ZZ goods were recorded at a real project''s site';
  end if;
  if exists (select 1 from stk_records where id = any(zr) and request_line_id is not null and not request_line_id = any(zrl))
     or exists (select 1 from stk_covers where (request_line_id = any(zrl) or portion_id = any(zpor)) and not record_id = any(zr))
     or exists (select 1 from stk_moves where (record_id = any(zr)) <> (lot_id = any(zlot))) then
    raise exception 'GUARD: ZZ stock and real requests or real stock are mixed';
  end if;
  select coalesce(array_agg(id), '{}') into zcm from stk_cost_moves where lot_id = any(zlot);
  if exists (select 1 from stk_cost_moves where (from_folder = any(zf) or to_folder = any(zf)) and not id = any(zcm))
     or exists (select 1 from stk_cost_moves where id = any(zcm)
                 and ((from_folder is not null and not from_folder = any(zf)) or (to_folder is not null and not to_folder = any(zf)))) then
    raise exception 'GUARD: a cost move links a ZZ project and real stock (or the other way)';
  end if;

  -- Nothing real hangs on a ZZ project.
  if exists (select 1 from construction_projects where folder_id = any(zf))
     or exists (select 1 from wp_tasks where folder_id = any(zf) or work_folder_id = any(zf))
     or exists (select 1 from payroll where project_id = any(zper))
     or exists (select 1 from overhead_expenses where folder_id = any(zf) or billing_period_id = any(zper))
     or exists (select 1 from reimbursements where folder_id = any(zf))
     or exists (select 1 from labor_contracts where folder_id = any(zf)) then
    raise exception 'GUARD: payroll, overhead, a contract, a reimbursement, a construction project or a Work Plan task is on a ZZ project';
  end if;
  if exists (select 1 from expenses
              where (folder_id = any(zf) or project_id = any(zper))
                and not (coalesce(purchase_line_id = any(zl), false) or coalesce(purchase_charge_id = any(zc), false)
                         or coalesce(stk_cost_move_id = any(zcm), false))) then
    raise exception 'GUARD: a hand-entered expense is on a ZZ project — stop and check';
  end if;
  if exists (select 1 from expenses where stk_cost_move_id = any(zcm)
              and not (coalesce(folder_id = any(zf), false) or coalesce(project_id = any(zper), false))) then
    raise exception 'GUARD: a ZZ cost move wrote a row on a real project';
  end if;
  if exists (select 1 from pr_gallery_photos where catalog_item_id = any(zi)) then
    raise exception 'GUARD: a ZZ item has gallery photos (the pilot adds none) — stop and check';
  end if;

  -- ---------- the real data, before ----------
  select count(*), coalesce(sum(amount), 0) into real_exp_n, real_exp_sum from expenses
   where not (coalesce(folder_id = any(zf), false) or coalesce(project_id = any(zper), false)
              or coalesce(purchase_line_id = any(zl), false) or coalesce(purchase_charge_id = any(zc), false)
              or coalesce(stk_cost_move_id = any(zcm), false));
  select count(*) into real_pur from purchases where not id = any(zp);
  select count(*) into real_rec from stk_records where not id = any(zr);
  select count(*) into real_mov from stk_moves where not record_id = any(zr);
  select count(*) into real_cm from stk_cost_moves where not id = any(zcm);
  select count(*) into real_req from pr_requests where not id = any(zreq);

  -- ---------- stock (its history guards are off for this transaction only) ----------
  perform set_config('dacs.purchase_write', 'on', true);
  execute 'alter table stk_events disable trigger stk_events_no_change';
  execute 'alter table stk_moves disable trigger stk_moves_no_change';
  execute 'alter table stk_covers disable trigger stk_covers_no_change';
  delete from expenses where stk_cost_move_id = any(zcm) or purchase_line_id = any(zl) or purchase_charge_id = any(zc);
  get diagnostics n = row_count; msg := msg || 'expense rows ' || n;
  delete from stk_events where cost_move_id = any(zcm) or record_id = any(zr) or purchase_id = any(zp);
  get diagnostics n = row_count; msg := msg || ', stock events ' || n;
  update stk_cost_moves set resubmits = null where id = any(zcm) and resubmits is not null;
  delete from stk_cost_moves where id = any(zcm);
  get diagnostics n = row_count; msg := msg || ', cost moves ' || n;
  delete from stk_covers where record_id = any(zr);
  get diagnostics n = row_count; msg := msg || ', request covers ' || n;
  delete from stk_moves where record_id = any(zr);
  get diagnostics n = row_count; msg := msg || ', stock moves ' || n;
  -- Returns first: a return always names its issue (it cannot be blanked).
  delete from stk_records where id = any(zr) and returns_record is not null;
  get diagnostics n = row_count;
  delete from stk_records where id = any(zr);
  get diagnostics real_rec_tmp = row_count; msg := msg || ', stock records ' || (n + real_rec_tmp);
  delete from stk_lots where id = any(zlot);
  get diagnostics n = row_count; msg := msg || ', lots ' || n;
  delete from stk_matches where purchase_id = any(zp) or item_id = any(zi);
  get diagnostics n = row_count; msg := msg || ', matches ' || n;
  delete from stk_locations where id = any(zloc);
  get diagnostics n = row_count; msg := msg || ', sites ' || n;
  execute 'alter table stk_events enable trigger stk_events_no_change';
  execute 'alter table stk_moves enable trigger stk_moves_no_change';
  execute 'alter table stk_covers enable trigger stk_covers_no_change';

  -- ---------- purchases ----------
  delete from purchase_change_requests where purchase_id = any(zp);
  delete from purchase_history where purchase_id = any(zp);
  delete from purchase_charge_shares where line_id = any(zl);
  delete from purchase_stock_moves where line_id = any(zl);
  delete from purchase_line_covers where line_id = any(zl);
  delete from purchase_charges where purchase_id = any(zp);
  delete from purchase_lines where purchase_id = any(zp);
  update purchases set replaced_by = null where id = any(zp) and replaced_by is not null;
  delete from purchases where id = any(zp);
  get diagnostics n = row_count; msg := msg || ', purchases ' || n;
  perform set_config('dacs.purchase_write', '', true);

  -- ---------- requests ----------
  delete from pr_photos where request_id = any(zreq);
  get diagnostics n = row_count; msg := msg || ', request photo rows ' || n;
  delete from pr_line_conflicts where line_id = any(zrl);
  delete from pr_events where request_id = any(zreq);
  delete from pr_line_portions where line_id = any(zrl);
  delete from pr_lines where request_id = any(zreq);
  delete from pr_requests where id = any(zreq);
  get diagnostics n = row_count; msg := msg || ', requests ' || n;

  -- ---------- catalogue, projects, suppliers ----------
  delete from pr_item_refs where catalog_item_id = any(zi);
  delete from pr_catalog_items where id = any(zi);
  get diagnostics n = row_count; msg := msg || ', catalogue items ' || n;
  delete from folders where id = any(zf) and parent_folder_id is not null;
  delete from folders where id = any(zf);
  if exists (select 1 from folders where id = any(zf)) then
    raise exception 'GUARD: a ZZ project is still there';
  end if;
  msg := msg || ', projects ' || cardinality(zf) || ' (with ' || cardinality(zper) || ' billing periods)';
  delete from suppliers s where s.name like 'ZZ 2bc%' and not exists (select 1 from purchases p where p.supplier_id = s.id);
  get diagnostics n = row_count; msg := msg || ', suppliers ' || n;

  -- ---------- after: nothing ZZ left, nothing real moved, guards back on ----------
  if exists (select 1 from folders where name like 'ZZ 2bc pilot%')
     or exists (select 1 from pr_catalog_items where name like 'ZZ 2bc%')
     or exists (select 1 from purchase_lines where item_name like 'ZZ 2bc%') then
    raise exception 'GUARD: a ZZ row is still there';
  end if;
  if (select count(*) from expenses) <> real_exp_n or (select coalesce(sum(amount), 0) from expenses) <> real_exp_sum then
    raise exception 'GUARD: real expenses changed';
  end if;
  if (select count(*) from purchases) <> real_pur or (select count(*) from stk_records) <> real_rec
     or (select count(*) from stk_moves) <> real_mov or (select count(*) from stk_cost_moves) <> real_cm
     or (select count(*) from pr_requests) <> real_req then
    raise exception 'GUARD: real purchases, stock or requests changed';
  end if;
  if (select count(*) from pg_trigger where tgname in ('stk_events_no_change', 'stk_moves_no_change', 'stk_covers_no_change')
         and tgenabled = 'O') <> 3 then
    raise exception 'GUARD: a stock history guard is not back on';
  end if;
  msg := msg || '. Real: ' || real_exp_n || ' expense rows (₱' || real_exp_sum || '), ' || real_pur || ' purchases, '
         || real_rec || ' stock records, ' || real_cm || ' cost moves, ' || real_req || ' requests — unchanged; history guards back on.';

  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): would delete %', msg;
  end if;
  raise notice 'CLEAN-UP DONE: deleted %', msg;
end $$;

-- Request photos: the rows are gone, the FILES stay in Storage (Supabase does
-- not delete Storage files from SQL). The pilot takes none; if it did, delete
-- them by hand under request-photos/<worker id>/<request id>/.
```

**Modify:** `tests/stock-admin.test.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/tests/stock-admin.test.js b/tests/stock-admin.test.js
index 47843bf..d38be47 100644
--- a/tests/stock-admin.test.js
+++ b/tests/stock-admin.test.js
@@ -285,5 +285,18 @@ test('the shopping list: "In warehouse" as a hint, "Issue from stock" only once
   ok(/'bought', pr_line_purchased\(l\.id\),\s+'from_stock', pr_line_from_stock\(l\.id\),/.test(SQL), 'Bought = purchases; From stock beside it');
 });
 
+test('the pilot\'s way back (2B-b): the main owner alone may switch stock off again, typed, and nothing is undone', () => {
+  ok(/\(status\.is_main_owner \? '<div class="stk-switch-off"><button[^']*data-switch-off>Switch stock off…<\/button><\/div>' : ''\)/.test(BROWSER),
+     'the button is the main owner\'s only');
+  const fn = BROWSER.slice(BROWSER.indexOf('function openSwitchOff'), BROWSER.indexOf('function renderOff'));
+  ok(/if \(form\.word\.value\.trim\(\) !== 'OFF'\) throw/.test(fn), 'typed OFF first');
+  ok(/RA\.rpc\('stk_set_enabled', \{ p_on: false \}\)/.test(fn), 'the server\'s own switch');
+  ok(/root\.currentStockOn = false;/.test(fn), 'the old tick comes back at once');
+  ok(/nothing is undone or deleted/.test(fn), 'says records stay');
+  eq((BROWSER.match(/RA\.rpc\('stk_set_enabled'/g) || []).length, 2, 'on and off, nowhere else');
+  const server = SQL.slice(SQL.indexOf('function stk_set_enabled'));
+  ok(/v_owner uuid := pur_main_owner\(\);/.test(server.slice(0, 300)), 'the server checks it is the main owner');
+});
+
 console.log('\n' + passed + ' passed, ' + failed + ' failed');
 if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

<!-- Code -->

**Modify:** `admin.html` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/admin.html b/admin.html
index 5e50186..cc550de 100644
--- a/admin.html
+++ b/admin.html
@@ -22,7 +22,7 @@
     <link rel="stylesheet" href="css/reimbursement-module.css">
     <link rel="stylesheet" href="css/attendance-admin.css">
     <link rel="stylesheet" href="css/requests-admin.css?v=20261012a">
-    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261026a">
+    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261027a">
     <link rel="stylesheet" href="css/workplan-admin.css?v=20261014a">
     <!-- Warranty Retention Register + Fund Styles -->
     <link rel="stylesheet" href="css/warranty-fund.css?v=20260803f">
@@ -5436,7 +5436,7 @@
 <script src="js/purchasing-admin-purchases.js?v=20261026a"></script>
 <script src="js/purchasing-admin-pay.js?v=20261023a"></script>
 <script src="js/purchasing-admin-cash.js?v=20261023b"></script>
-<script src="js/stock-admin.js?v=20261026a"></script>
+<script src="js/stock-admin.js?v=20261027a"></script>
 <script src="js/stock-cost-admin.js?v=20261026a"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261014a"></script>
```

**Modify:** `css/purchasing-admin.css` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/css/purchasing-admin.css b/css/purchasing-admin.css
index 94706d0..ee079b7 100644
--- a/css/purchasing-admin.css
+++ b/css/purchasing-admin.css
@@ -139,6 +139,7 @@
 .stk-form { display: grid; gap: 12px; }
 .stk-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
 .stk-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
+.stk-switch-off { margin-top: 18px; display: flex; justify-content: flex-end; }
 .stk-item { cursor: pointer; }
 .stk-item:hover { border-color: var(--att-green); }
 .stk-item-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
```

**Modify:** `docs/DATABASE_SCHEMA.md` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
index a13dfa5..c8fe4c9 100644
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -935,7 +935,7 @@ Stage 1a-1 server (plan `docs/superpowers/plans/2026-10-02-workmate-stage1a1-req
 
 Every `pr_*` office policy is tenant-scoped with `can_access` (`pr_ops` via its actor's owner), and worker write RPCs serialise retries of the same operation with an advisory lock.
 
-Worker RPCs: `pr_destinations()`, `pr_my_teams()`, `pr_catalog()`, `pr_submit_request(op, request)`, `pr_change_quantity(op, line, base_version, quantity)`, `pr_cancel_line(op, line)`, `pr_cancel_request(op, request)`, `pr_my_requests(limit)`, `pr_attach_photo(op, request, line, path)`. Completed projects / Additional Works refuse new requests and quantity increases (decreases, cancels and reading stay). PM projects are never destinations. A worker's cancel of the last open line closes the request (0088); cancelling something already cancelled succeeds without change.
+Worker RPCs: `pr_destinations()`, `pr_my_teams()`, `pr_catalog()`, `pr_submit_request(op, request)`, `pr_change_quantity(op, line, base_version, quantity)`, `pr_cancel_line(op, line)`, `pr_cancel_request(op, request)`, `pr_my_requests(limit)` (since 0106 each line and weekly portion also carries `from_stock`: what the office issued from stock for it — 0 while stock is off), `pr_attach_photo(op, request, line, path)`. Completed projects / Additional Works refuse new requests and quantity increases (decreases, cancels and reading stay). PM projects are never destinations. A worker's cancel of the last open line closes the request (0088); cancelling something already cancelled succeeds without change.
 
 **Legacy `requests` / `request_items`** (Flutter-prototype era) are read-only history since `0085`: owner/staff full access; a worker reads only their own rows and writes nothing.
 
@@ -1044,7 +1044,7 @@ One recording operation for every purchase, shared by Dacs Web (Expenses → Add
 | `purchase_lines` (`purchase_id`, `line_no`, `destination` `project`/`warehouse`, `folder_id` + `folder_name` — history, **no foreign key**, `item_name`, `category`, `quantity` (up to 3 decimals), `unit`, `gross_amount`, `in_inventory`, `min_stock`, `needs_funding_review`) | What was bought, for which project (Main Contract or Additional Works folder). Warehouse lines write no expense rows |
 | `purchase_charges` (`kind` `delivery_fee`/`discount`, `amount`) + `purchase_charge_shares` (`charge_id`, `line_id`, `amount`) | A shared fee or discount and how it is split across lines (default: by line amount, to the centavo by largest remainder — never a negative share, always exactly the charge) |
 | `purchase_history` (`kind` `recorded`/`corrected`/`refunded`/`voided`/`replaced`, `reason`, `before`, `after`, `actor_id`) | Never edited |
-| `pur_ops` (`actor_id`, `op_id`, `kind`, `result`) | First answer per operation id — a retry or an overlapping call returns it, nothing is recorded twice |
+| `pur_ops` (`actor_id`, `op_id`, `kind`, `result`) | First answer per operation id — a retry or an overlapping call returns it, nothing is recorded twice. Since 0106 a row of kind `cancelled` marks an id the phone cancelled (`pur_op_cancel`): every write refuses it (`OP_CANCELLED`) |
 | `purchase_stock_moves` (`line_id` **primary key**, `inventory_id`, `quantity`, `moved_at`) | The "track in inventory" stock added for a line — once, ever. Stock items are matched within the company: its own item, else an unowned one (the old browser mirror wrote items with no owner), never another company's |
 | `pur_record(p_op, p_body)` | Records a purchase and writes its `expenses` rows: per project line, the net amount (item − discount shares) funded by the **actual purchase month** — that month's client periods with a budget (this company's, this project's), **earliest billing number first**, each up to budget − expenses − payroll; shortage → Cover (`cover_expense = true`, on the project's Cover period, else a client period of **that month only** — never another month's); no eligible period that month → all Cover and `needs_funding_review`; **no Cover period and no billing period in the purchase month** → one Cover row tied to the project (`folder_id`), flagged. Additional Works → their own period in full. Fee shares → "Delivery fee (share)" rows, funded the same way. Adds stock for "track in inventory" lines. Refuses: totals ≠ receipt, shares ≠ charge, discount > line, sub-centavo or negative amounts, another company's project, staff on a completed project (or an Additional Works job under one) |
 | `pur_correct(p_op, p_purchase, p_body, p_reason)` | Same lines, new content: the purchase's rows are replaced and re-funded in one transaction; reason required. Moving a line to another project, or any change on a completed project, is owner-only. Stock already moved is not moved again |
@@ -1124,6 +1124,8 @@ Every table has RLS on, **no policies** and every privilege revoked: the screens
 | `pur_cash_detail` (0103, redefined) | Each return also carries `photo_url`, so a buyer sees the photo of their own return in "My cash" (the phone and Dacs Web) and the main owner sees it in that buyer's view. Still internal |
 | `pur_list_doc` (0103, redefined) | Also `supplier_id` (the listed supplier), so the phone can pay from that supplier's credit from its saved copy of My purchases. Still internal |
 | `pur_my_ops_done(op ids)` (0103) | Which of the caller's own operation ids `pur_ops` already holds (at most 200 asked). The phone finishes those before reading fresh balances, so a payment whose answer was lost is never counted twice |
+| `pur_op_cancel(op)` (0106) | The phone's "Cancel it" for a stock submission whose answer was lost: under the operation's own lock, `recorded` (it was — nothing changes) or `cancelled` (the id is cancelled for good; a late request with it is refused). Only then may the phone let the person change or drop it |
+| `pur_op_state(op)` (0106) | Read only: `recorded`, `cancelled` or `none` for the caller's own operation id (the phone's "Check") |
 | Buyer reads and writes | `pur_pay`, `pur_void_payment` (the recorder or the main owner; `RESOLVED_FIRST` if a refund or credit already relies on it), `pur_purchase_payments`, `pur_credits`, `pur_my_cash`, `pur_cash_dispute`, `pur_cash_report_return`, `pur_cash_withdraw_return` |
 | Main-owner reads and writes | `pur_cash_give`, `pur_cash_clear_dispute`, `pur_cash_void_issue`, `pur_cash_decide_return`, `pur_cash_void_return`, `pur_cash_count`, `pur_cash_void_count`, `pur_set_own_money`, `pur_accept_own_money`, `pur_repay_buyer`, `pur_void_repayment`, `pur_resolve_overpaid`, `pur_void_refund`, `pur_void_credit`, `pur_cash_tracker`, `pur_cash_buyer(buyer)`, `pur_overpaid` (with a suggested split: the latest payments first), `pur_cash_report(buyer, from, to)` (≤ 92 days; voided entries listed apart) |
 | `pettyCash/<company>/<yyyy-mm>/<id>.jpg` (storage, R13) | A return photo. `uploads_can_read` (0097's, plus this branch first): only the main owner and the buyer who uploaded it (`pur_petty_reader`, by the upload ledger); written by buyers of the company; never overwritten. Ledger kind `petty_cash`. Payment proofs stay in `purchases/` |
```

**Modify:** `js/stock-admin.js` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/js/stock-admin.js b/js/stock-admin.js
index 7a94cd3..2e62b48 100644
--- a/js/stock-admin.js
+++ b/js/stock-admin.js
@@ -826,6 +826,8 @@
               RA.head('Stock', 'Where goods are, in catalogue units. When goods reach someone else\'s project, the main owner approves where their cost goes.', tabs()) +
               actions() +
               '<div data-body><div class="att-empty">Loading…</div></div>' +
+              // 2B-b: the pilot's way back (Q30) — the main owner only, typed.
+              (status.is_main_owner ? '<div class="stk-switch-off"><button type="button" class="att-btn att-btn--sm att-btn--ghost" data-switch-off>Switch stock off…</button></div>' : '') +
             '</div>';
         host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
             if (ui.tab === b.dataset.tab) return;
@@ -836,6 +838,8 @@
         host.querySelector('[data-action="leftover"]').addEventListener('click', () => openLeftover(reload));
         host.querySelector('[data-action="count"]').addEventListener('click', () => openCount({}, reload));
         host.querySelector('[data-action="opening"]').addEventListener('click', () => openOpening(reload));
+        const off = host.querySelector('[data-switch-off]');
+        if (off) off.addEventListener('click', () => openSwitchOff());
         const body = host.querySelector('[data-body]');
         cache.choices = null;
         if (ui.tab === 'stock' && ui.itemId) return renderItem(body, ui.itemId, reload);
@@ -874,6 +878,28 @@
         RA.icons();
     }
 
+    // Switch stock off again (2B-b): for a pilot that failed before launch.
+    // Records already made stay as they are; nothing is undone or deleted.
+    function openSwitchOff() {
+        return RA.modal({
+            title: 'Switch stock off',
+            sub: 'Type OFF to confirm. Only if the pilot failed — stock is not launched yet.',
+            warn: true,
+            body: '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
+                'Every stock record stays as it is — nothing is undone or deleted. Recording stops (web and phone), the Stock tab goes ' +
+                'for everyone but you, and the old "Add to inventory" tick works again.</div></div>' +
+                '<div class="stk-form"><label class="att-label">Type OFF<input class="att-input" name="word" autocomplete="off"></label></div>',
+            submitLabel: 'Switch off',
+            errorMessage,
+            onSubmit: async (form) => {
+                if (form.word.value.trim() !== 'OFF') throw new Error('Type OFF to confirm.');
+                await RA.rpc('stk_set_enabled', { p_on: false });
+                root.currentStockOn = false;
+            },
+            onDone: () => root.location.reload(),
+        });
+    }
+
     // Before launch: nobody sees the tab except the main owner, who sees the switch.
     function renderOff(host, status) {
         if (!status || !status.is_main_owner) {
```

**Modify:** `package.json` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/package.json b/package.json
index 34ecb8a..f9bc084 100644
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**Create:** `supabase/migrations/0106_workmate_phone_stock.sql`

```sql
-- 0106 — WorkMate Stage 2B-b: stock on the phone.
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- (§3.8); answers: docs/superpowers/specs/2026-10-24-workmate-stage2bc-questions.md
-- (all A); plan: docs/superpowers/plans/2026-10-27-workmate-stage2b-b-phone.md.
--
-- A. "From stock" on the workers' requests (Q26). Workers and team leaders
--    see, on their own requests in WorkMate, how much the office issued from
--    stock for each line ("From stock: 6 bags") — and nothing else of stock:
--    no place, lot, record, value or cost (Q26, Q28). 0085's pr_my_requests,
--    unchanged but for two keys: `from_stock` on each line and on each
--    weekly portion (0104's pr_line_from_stock / pr_portion_from_stock; 0 while
--    stock is off).
--
-- B. Settling a stock submission whose answer was lost (R101–R103). The
--    phone sends each stock record once under its own operation id, saved
--    with its exact payload. When the answer is lost it may only send that
--    again, unchanged, or ask the server to SETTLE the id before the person
--    may change or drop it:
--      pur_op_cancel(id) — under the operation's own lock (the one every
--        write takes first, pur_op_begin), it either finds the operation
--        recorded and says so, changing nothing, or marks the id cancelled
--        for good. A recording still running holds that lock, so the cancel
--        waits for it and then sees it.
--      pur_op_begin — 0096's, copied, refusing a cancelled id (OP_CANCELLED):
--        a request that arrives after the cancel, however late, records
--        nothing. Every other answer is unchanged.
--      pur_op_state(id) — read only: recorded / cancelled / none.
--    The cancel mark is a pur_ops row of kind 'cancelled' for that account
--    and id. Only the phone's stock submissions are ever cancelled.
--
-- No table or column changes. Buyer and office stock screens need no other
-- server change: the phone calls 0104/0105's stk_* functions as the web does.

set local lock_timeout = '5s';

-- A. 0085's pr_my_requests, with `from_stock` per line and per portion.
create or replace function pr_my_requests(p_limit int default 50) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.doc order by x.received_at desc), '[]'::jsonb)
  from (
    select r.received_at,
           jsonb_build_object(
             'id', r.id, 'status', r.status, 'received_at', r.received_at, 'drafted_at', r.drafted_at, 'note', r.note,
             'mine', r.requester_id = auth.uid(),
             'requester_name', pr_person_name(r.requester_id),
             'project_id', r.folder_id, 'project_name', f.name,
             'work_id', r.work_folder_id,
             'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
             'team_id', r.team_id, 'team_name', t.name,
             'lines', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', l.id, 'position', l.position, 'kind', l.kind, 'catalog_item_id', l.catalog_item_id,
                        'description', l.description, 'spec', l.spec, 'unit', l.unit, 'category', l.category,
                        'intended_member_id', l.intended_member_id,
                        'intended_member_name', case when l.intended_member_id is null then null else pr_person_name(l.intended_member_id) end,
                        'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
                        'status', l.status, 'version', l.version, 'has_conflict', l.has_conflict,
                        'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
                        -- 2B-b (Q26): what the office issued from stock for this line (0 while stock is off).
                        'from_stock', pr_line_from_stock(l.id),
                        'portions', (
                          select coalesce(jsonb_agg(jsonb_build_object(
                                   'quantity', p.quantity, 'pending_reduction', p.pending_reduction,
                                   'arranged', p.arranged_at is not null,
                                   'from_stock', pr_portion_from_stock(p.id),
                                   'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on)
                                 order by b.cutoff_at, p.created_at), '[]'::jsonb)
                            from pr_line_portions p join pr_batches b on b.id = p.batch_id
                           where p.line_id = l.id))
                      order by l.position), '[]'::jsonb)
                 from pr_lines l where l.request_id = r.id),
             'photos', (
               select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'line_id', ph.line_id, 'path', ph.storage_path)
                                order by ph.created_at), '[]'::jsonb)
                 from pr_photos ph where ph.request_id = r.id)
           ) as doc
      from pr_requests r
      join folders f on f.id = r.folder_id
      join folders w on w.id = r.work_folder_id
      left join pr_teams t on t.id = r.team_id
     where pr_is_requester()
       and r.owner_id = attendance_data_owner()
       and (r.requester_id = auth.uid()
            or (r.team_id is not null and pr_is_current_leader(r.team_id, auth.uid())))
     order by r.received_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
$$;

-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function pr_my_requests(integer) from public, anon;
grant execute on function pr_my_requests(integer) to authenticated;

-- B. 0096's pur_op_begin, refusing a cancelled operation id.
create or replace function pur_op_begin(p_op uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev jsonb;
  v_kind text;
begin
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));
  select o.result, o.kind into v_prev, v_kind from pur_ops o where o.actor_id = auth.uid() and o.op_id = p_op;
  if v_prev is null then
    return null;
  end if;
  -- 2B-b (R102): an id the phone cancelled (pur_op_cancel) is never
  -- recorded — not even by its own first request arriving late.
  if v_kind = 'cancelled' then
    raise exception 'OP_CANCELLED' using errcode = 'P0001';
  end if;
  -- Marked, so the caller can tell the user that a form edited before the
  -- retry was NOT saved — this is the first press's answer.
  return v_prev || jsonb_build_object('replayed', true);
end;
$$;

revoke all on function pur_op_begin(uuid) from public, anon, authenticated;

-- The phone's "Cancel it": the server confirms the operation was recorded, or
-- cancels its id for good — atomically, under the lock recording takes.
create or replace function pur_op_cancel(p_op uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := data_owner_id();
  v_kind text;
begin
  if auth.uid() is null or v_owner is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));
  select o.kind into v_kind from pur_ops o where o.actor_id = auth.uid() and o.op_id = p_op;
  if v_kind = 'cancelled' then
    return 'cancelled';
  elsif v_kind is not null then
    return 'recorded';
  end if;
  insert into pur_ops (owner_id, op_id, actor_id, kind, result)
  values (v_owner, p_op, auth.uid(), 'cancelled', jsonb_build_object('cancelled', true));
  return 'cancelled';
end;
$$;

-- The phone's "Check": read only, the caller's own operation id.
create or replace function pur_op_state(p_op uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  return coalesce((select case when o.kind = 'cancelled' then 'cancelled' else 'recorded' end
                     from pur_ops o where o.actor_id = auth.uid() and o.op_id = p_op), 'none');
end;
$$;

revoke all on function pur_op_cancel(uuid) from public, anon;
grant execute on function pur_op_cancel(uuid) to authenticated;
revoke all on function pur_op_state(uuid) from public, anon;
grant execute on function pur_op_state(uuid) to authenticated;
```

**Modify:** `supabase/migrations/README.md` — apply with `git apply --ignore-whitespace`

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
index 96e389c..136837b 100644
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0106** — highest on disk is
-  `0105_stock_cost_moves.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0107** — highest on disk is
+  `0106_workmate_phone_stock.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -196,6 +196,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0105 (WorkMate Stage 2C — owner-confirmed stock cost moves; INSIDE the money model, through ordinary expense rows)** adds `stk_moves.holder` (whose cost the moved goods are: a project folder, or null = the company; goods entering stock take their lot's own holder through the `stk_moves_holder` trigger, so 0104's inflow paths are unchanged), the private table `stk_cost_moves` (RLS on, no policies: kind `assign` company → project / `transfer` project → project / `back` project → company / `loss` company stock → company stock loss; status `pending` / `approved` / `rejected` / `withdrawn`; the approved quantity and value, the lot's price and quantity it was valued at, the reversal and its reason), `expenses.stk_cost_move_id`, and `stk_events.cost_move_id` with six `cost_*` kinds. After every physical move the server opens a **pending** cost move wherever goods arrive in someone else's cost (`stk_cost_requests`); until the **main owner** approves (`stk_cost_decide`), the cost stays where it was, and a pending one covers only what is still there (`stk_cost_effective`). Approval values the goods by lot (item amount − discount shares + delivery-fee shares; the last portion takes what is left — `stk_held`, `stk_cost_value`) and writes expense rows (`stk_cost_rows`): the receiving project funded like a purchase (`pur_fund`, the month it received the goods), the giving project negative rows on every billing period / Cover group that carried the lot's cost, in proportion (`stk_cost_carriers`, `pur_prorate`). Company stock is never in a project's Spent; a confirmed loss of company goods moves their value to company stock loss with the count (no expense row). Redefines from 0104 `stk_take` (returns the holder; goods not yet the place's own leave first), `stk_check_record`, `stk_move`, `stk_decide`, `stk_reverse` (refused `COST_MOVED` while an approved cost move rides on the record; pending ones withdrawn) and `stk_record_json` (`costs`, values for owner accounts only); from 0096 `pur_guard_expense_row` (cost-move rows: `STOCK_COST_ROW`) and `pur_guard_delete` (`STOCK_LIVE`). Adds `stk_guard_cost_basis` (after insert on `purchase_history`: a line's price or quantity cannot change while approved cost moves value it — `STOCK_COST_IN_USE` — nor where the purchase's cost sits, its billing periods and Cover — `STOCK_COST_FUNDING`; each approved cost move keeps that in `basis_alloc`). Callable: `stk_cost_decide` / `stk_cost_reverse` (main owner), `stk_cost_resubmit` (stock recorders), `stk_cost_pending` (main owner), `stk_company_stock` (owner accounts). Locks: the purchase, then the item and the projects charged in one sorted pass. Requires 0104. Prove with `npm run test:sql` (`2c_cost.pglite.mjs`, `2c_concurrency.mjs`, and the 2A / 2B-a suites re-run `--with-0105`) and `node tests/stock-cost-admin.test.js`; live: `supabase/tests/2c_acceptance.sql` (self-wrapped, rolls back).
 
+**0106 (WorkMate Stage 2B-b — stock on the phone: "From stock" on the workers' requests; settling a lost answer)** redefines 0085's `pr_my_requests` with one key added to each request line and each weekly portion: `from_stock` — what the office issued from stock for it (0104's `pr_line_from_stock` / `pr_portion_from_stock`; live stock records only, so a reversed issue drops out and a return does not; 0 while stock is off). Nothing else in the answer changes (a test compares it with 0085's, key for key). It also lets the phone **settle** a stock submission whose answer was lost: `pur_op_cancel(op)` takes the operation's own lock (the one every write takes first) and either reports the operation `recorded` — changing nothing — or marks the id `cancelled` for good (a `pur_ops` row of kind `cancelled`); 0096's `pur_op_begin` is redefined, unchanged but for refusing a cancelled id (`OP_CANCELLED`), so a request that arrives after the cancel records nothing; `pur_op_state(op)` reads `recorded` / `cancelled` / `none`. No table or column changes. The buyer and office stock screens on the phone otherwise call 0104/0105's `stk_*` functions as the web does. Requires 0104 (and 0105 on the live order). Prove with `npm run test:sql` (`2bb_phone.pglite.mjs`, which also runs the joint pilot's guarded clean-up `supabase/tests/2bc_pilot_cleanup.sql` on a simulated pilot beside real data; `2bb_concurrency.mjs`: a cancel against a recording in flight, on real PostgreSQL); live: `supabase/tests/2bb_acceptance.sql` (read-only, rolls back).
+
 Get the truth before relying on this line:
 
 ```sql
````


- [ ] **Step 1: Apply the files above** in Dacs Web. Create blocks as given; Modify blocks with `git apply --ignore-whitespace` (`admin.html` keeps the user's own uncommitted edit). Then put the two CRLF files back to CRLF everywhere:

```bash
node -e "const fs=require('fs');for(const f of ['supabase/migrations/README.md','docs/DATABASE_SCHEMA.md'])fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"
```

- [ ] **Step 2: Tests.** `npm test` → every suite passes (**41**, 1,319 checks), including `stock-admin.test.js` (**18**, with the new switch-off test). `npm run test:sql` → every suite passes (**34**, 1,010 checks), including the new `2bb_phone.pglite.mjs` (**16**) and `2bb_concurrency.mjs` (**3**, real PostgreSQL). `node --check js/stock-admin.js`.
- [ ] **Step 3: Stop for the user** to review and commit. Do not push yet.

### Task 2: WorkMate — stock models, refusals, forms and the server client

**Interfaces produced:** `StockRemote` (`status()`, `overview()`, `choices()`, `requestLines(folderId)`, `projectLines(folderId)`, `write(StockWrite, params, userId:)`, `opState(opId, userId:)`, `cancelOp(opId, userId:)`), `SupabaseStockRemote(client)`, `newStockOpId()`; `StockWrite` (`move`, `receive`, `leftover`), `StockSubmission` (`opId`, `userId`, `write`, `payload`, `params`, `summary`, `lastSentAt`, `sends`); `StockPendingStore` (`load()` → `StockPendingLoad` (`readable`, `unreadable`, `damaged`), `save(readable)` — keeps every unreadable entry, refuses damaged storage — and `dropUnreadable(userId, opId)`), `UnreadableSubmission` (`raw`, `opId`, `userId`, `settleable`), `PrefsStockPendingStore(prefs)`; `StockSubmitter(remote:, store:, now:)` (`load(userId)`, `unresolved`, `unreadable`, `recoveryNeeded`, `blocked`, `byOp(id)`, `isBusy(id)`, `submit(write:, params:, summary:)`, `retry(id)`, `check(id)`, `cancel(id)`, `checkAll()`) → `StockSendOutcome` (`result`: recorded / refused / unsure / blocked, `opId`, `failure`, `answer`) and `StockSettleOutcome` (`result`: recorded / cancelled / pending / unknown, `failure`); `StockStatus`, `StockOverview`, `StockItem`, `StockPlace`, `StockLine`, `StockMatch`, `StockRecord`, `StockCostState`, `StockChoices`, `StockItemChoice`, `StockProject`, `StockRequestLine` (`fits(item)`), `warehousePlace`; `StockFailure` (`of(error)`, `retryable`, `uncertain`), `stockFailureCopy(f)`; `MoveForm`, `ReceiveForm`, `LeftoverForm` (`problems(today:)`, `body()` / `params(opId)`), `parseStockQty`, `qtyText`. `ShoppingLine.catalogItemId / fromStock / inWarehouse / inWarehouseUnit`; `RemoteLine.fromStock`, `Portion.fromStock`.

<!-- Tests -->

**Create:** `test/stock/stock_domain_test.dart`

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/stock/domain/stock_failure.dart';
import 'package:workmate/stock/domain/stock_forms.dart';
import 'package:workmate/stock/domain/stock_models.dart';

import 'stock_fakes.dart';

void main() {
  group('the server\'s answers, as the phone reads them', () {
    test('the overview: items by place, deliveries awaited, the latest records', () {
      final ov = sampleOverview();
      final c = ov.item('item-cement')!;
      expect([c.total, c.inWarehouse, c.at(warehousePlace), c.at('f-barlin'), c.at('f-sulit')], [14, 10, 10, 4, 0]);
      expect(ov.awaiting.map((l) => [l.key, l.awaiting, l.match?.itemId]).toList(), [
        ['p-1:1', 8, 'item-cement'],
        ['p-2:1', 3, null],
      ]);
      final issue = ov.recent.first;
      expect([issue.kind, issue.unit, issue.canReturn, issue.costs.single.status], ['issue', 'bag', true, 'pending']);
      expect([ov.recent.last.unit, ov.recent.last.what, ov.recent.last.canReturn], ['bag', 'Cement', false],
          reason: 'a receipt is counted in the purchase line\'s unit');
    });

    test('quantities only: no cost-move value is read, even when an owner account is sent one', () {
      final cost = sampleOverview().recent.first.costs.single;
      expect([cost.kind, cost.status, cost.reversed], ['assign', 'pending', false]);
      // StockCostState has no value, estimate or amount field at all.
      expect(cost.toString().contains('400'), isFalse);
    });

    test('numbers arrive as JSON numbers or numeric text; both are read', () {
      final l = StockLine.fromJson({'purchase_id': 'p', 'line_no': '2', 'quantity': '3', 'awaiting': '1.5', 'match': null});
      expect([l.lineNo, l.quantity, l.awaiting], [2, 3, 1.5]);
    });

    test('leftover room: the line in item units, less what is already stock — the server\'s rounding', () {
      StockLine line(double qty, double per, double covers, double entered) => StockLine(
          purchaseId: 'p', lineNo: 1, quantity: qty, entered: entered, match: StockMatch(itemId: 'i', per: per, covers: covers));
      expect(line(10, 10, 10, 3).leftoverRoom, 7);
      expect(line(3, 3, 100, 33.333).leftoverRoom, 66.667, reason: '3 boxes = 100 pieces');
      expect(line(2, 2, 100, 100).leftoverRoom, 0);
      expect(const StockLine(purchaseId: 'p', lineNo: 1, quantity: 5).leftoverRoom, 0, reason: 'not matched yet');
    });

    test('a request line fits an item only if it is that item\'s (or has none) and in the same unit', () {
      const own = StockRequestLine(lineId: 'a', catalogItemId: 'item-cement', unit: 'Bag ');
      const none = StockRequestLine(lineId: 'b', unit: 'bag');
      const other = StockRequestLine(lineId: 'c', catalogItemId: 'item-sand', unit: 'bag');
      const box = StockRequestLine(lineId: 'd', unit: 'box');
      expect([own.fits(cement), none.fits(cement), other.fits(cement), box.fits(cement)], [true, true, false, false]);
    });

    test('completed projects come last, marked', () {
      expect(sampleChoices.projectsInOrder.map((p) => p.label).toList(), ['Barlin Residence', 'Sulit', 'Old Fence (completed)']);
    });

    test('the shopping list keeps From stock, In warehouse and the catalogue item — also through its saved copy', () {
      final l = ShoppingLine.fromJson({
        'line_id': 'l', 'request_id': 'r', 'bought': 2, 'from_stock': 4, 'in_warehouse': '10', 'in_warehouse_unit': 'bag',
        'catalog_item_id': 'item-cement', 'still_to_buy': 4,
      });
      final again = ShoppingLine.fromJson(l.toJson());
      expect([again.bought, again.fromStock, again.inWarehouse, again.inWarehouseUnit, again.catalogItemId],
          [2, 4, 10, 'bag', 'item-cement']);
      final old = ShoppingLine.fromJson({'line_id': 'l', 'request_id': 'r'});
      expect([old.fromStock, old.inWarehouse, old.catalogItemId], [0, 0, null], reason: 'a saved copy from 0.8.1');
    });

    test('a worker\'s request line and portion read "from_stock" (0106); 0 from a server before 0106', () {
      Map<String, dynamic> line([Map<String, dynamic> extra = const {}]) => {
            'id': 'l', 'position': 1, 'kind': 'material', 'description': 'Cement', 'unit': 'bag', 'version': 1, 'needed': 6,
            'portions': [
              {'quantity': 6, 'pending_reduction': 0, 'arranged': false, 'cutoff_at': '2026-10-31T04:00:00Z', 'purchase_on': '2026-11-02',
               'delivery_on': '2026-11-04', ...extra},
            ],
            ...extra,
          };
      final now = RemoteLine.fromJson(line({'from_stock': 4}));
      expect([now.fromStock, now.portions.single.fromStock], [4, 4]);
      final before = RemoteLine.fromJson(line());
      expect([before.fromStock, before.portions.single.fromStock], [0, 0]);
    });
  });

  group('the forms check what the server checks', () {
    const today = '2026-10-27';

    test('quantities: above 0, at most 3 decimals, commas allowed; sent as plain text', () {
      expect(['8', '2.5', '1,000', '0.001'].map(parseStockQty).toList(), [8, 2.5, 1000, 0.001]);
      expect(['0', '-1', '1.2345', 'abc', '', '1000001'].map(parseStockQty).toList(), List.filled(6, null));
      expect([qtyText(8), qtyText(2.5), qtyText(33.333)], ['8', '2.5', '33.333']);
    });

    test('an issue to a project fills a request line, or says why it is needed', () {
      final f = MoveForm(itemId: 'item-cement', to: 'f-barlin', quantity: '4', on: today);
      expect(f.kind, 'issue');
      expect(f.problems(today: today), [StockFailure.unplannedReasonRequired]);
      f.requestLineId = 'line-1';
      expect(f.problems(today: today), isEmpty);
      expect(f.body(), {'item_id': 'item-cement', 'quantity': '4', 'on': today, 'note': '', 'from': 'warehouse', 'to': 'f-barlin',
                        'request_line_id': 'line-1'});
      f
        ..requestLineId = null
        ..unplannedReason = '  formwork ';
      expect(f.body()['unplanned_reason'], 'formwork');
      expect(f.body().containsKey('request_line_id'), isFalse);
    });

    test('a move between projects, or to the warehouse (no request there); never to the same place', () {
      final f = MoveForm(itemId: 'item-cement', from: 'f-barlin', to: warehousePlace, quantity: '1', on: today);
      expect([f.kind, f.problems(today: today)], ['move', isEmpty]);
      expect(f.body().keys.toSet(), {'item_id', 'quantity', 'on', 'note', 'from', 'to'});
      f.to = 'f-barlin';
      expect(f.problems(today: today), contains(StockFailure.badPlace));
      f.to = null;
      expect(f.problems(today: today), contains(StockFailure.badPlace));
    });

    test('a return names its issue only: the same lots go back to the warehouse', () {
      final f = MoveForm(itemId: 'item-cement', returnsRecord: 'r-issue', quantity: '2', on: today);
      expect([f.kind, f.problems(today: today)], ['return', isEmpty]);
      expect(f.body(), {'item_id': 'item-cement', 'quantity': '2', 'on': today, 'note': '', 'returns_record': 'r-issue'});
    });

    test('a day that has not happened, a missing item, a bad quantity, a long note — each refused here first', () {
      final f = MoveForm(to: 'f-barlin', quantity: '0', on: '2026-10-28', unplannedReason: 'x', note: 'n' * 301);
      expect(f.problems(today: today), [StockFailure.badItem, StockFailure.badQuantity, StockFailure.badDate, StockFailure.badNote]);
    });

    test('received: in the line\'s unit, never more than awaited', () {
      final line = sampleOverview().awaiting.first;
      final f = ReceiveForm(line: line, quantity: '9', on: today);
      expect(f.problems(today: today), [StockFailure.moreThanAwaited]);
      f.quantity = '8';
      expect(f.problems(today: today), isEmpty);
      expect(f.params('op-1'), {'p_op': 'op-1', 'p_purchase': 'p-1', 'p_line_no': 1, 'p_qty': '8', 'p_on': today, 'p_note': ''});
    });

    test('leftovers: a matched line only, in item units, never more than it brought', () {
      const matched = StockLine(purchaseId: 'p', lineNo: 2, quantity: 10, entered: 6, match: StockMatch(itemId: 'i', per: 10, covers: 10));
      final f = LeftoverForm(line: matched, quantity: '5', on: today);
      expect(f.problems(today: today), [StockFailure.moreThanBought]);
      f
        ..quantity = '4'
        ..where = 'warehouse';
      expect(f.problems(today: today), isEmpty);
      expect(f.params('op-2'), {'p_op': 'op-2', 'p_purchase': 'p', 'p_line_no': 2, 'p_qty': '4', 'p_where': 'warehouse', 'p_on': today,
                                'p_note': ''});
      final unmatched = LeftoverForm(line: const StockLine(purchaseId: 'p', lineNo: 3, quantity: 2), quantity: '1', on: today);
      expect(unmatched.problems(today: today), [StockFailure.toMatch]);
    });
  });

  group('refusals in words', () {
    test('every server code the phone can meet has its own words, in English and Tagalog', () {
      for (final code in ['STOCK_OFF', 'NOT_ALLOWED', 'TO_MATCH', 'MORE_THAN_AWAITED', 'MORE_THAN_BOUGHT', 'MORE_THAN_ISSUED', 'NOT_ENOUGH',
                          'BAD_RETURN', 'BAD_LOCATION', 'UNPLANNED_REASON_REQUIRED', 'REQUEST_EXCEEDED', 'ITEM_MISMATCH', 'UNIT_MISMATCH',
                          'LINE_CLOSED', 'BAD_REQUEST_LINK', 'BAD_DATE', 'BAD_STATE', 'NOT_WAREHOUSE', 'NOT_PROJECT']) {
        final f = StockFailure.of(Exception('P0001: $code'));
        expect(f, isNot(StockFailure.unexpected), reason: code);
        final copy = stockFailureCopy(f);
        expect(copy.english.isNotEmpty && copy.tagalog.isNotEmpty && copy.english != copy.tagalog, isTrue, reason: code);
      }
    });

    test('whole codes only, and no signal is "press Send again", never a guess', () {
      expect(StockFailure.of(Exception('UNPLANNED_REASON_REQUIRED')), StockFailure.unplannedReasonRequired);
      expect(StockFailure.of(Exception('REASON_REQUIRED')), StockFailure.reasonRequired);
      expect(StockFailure.of(const SocketException('down')), StockFailure.noConnection);
      expect(StockFailure.of(TimeoutException('slow')), StockFailure.noConnection);
      expect(StockFailure.of(StateError('AUTH_REQUIRED')), StockFailure.sessionExpired);
      expect(StockFailure.of(Exception('something odd')), StockFailure.unexpected);
      expect([StockFailure.noConnection.retryable, StockFailure.notEnough.retryable], [true, false]);
      expect(stockFailureCopy(StockFailure.noConnection).english, contains('never recorded twice'));
    });
  });
}
```

**Create:** `test/stock/stock_fakes.dart`

```dart
import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:workmate/stock/data/stock_pending_store.dart';
import 'package:workmate/stock/data/stock_remote.dart';
import 'package:workmate/stock/domain/stock_models.dart';
import 'package:workmate/stock/domain/stock_submission.dart';

/// The stock server, as the phone sees it, in memory: what each call was
/// sent, and canned answers or refusals. Like `pur_ops`, an operation id it
/// has recorded is answered again with the first answer (and `replayed`),
/// whatever the payload — which is why the phone never changes one. A
/// cancelled id (pur_op_cancel) is refused OP_CANCELLED, as 0106's lock does.
class FakeStockRemote implements StockRemote {
  FakeStockRemote({
    this.statusAnswer = const StockStatus(enabled: true, canRecord: true),
    StockOverview? overview,
    StockChoices? choices,
    Map<String, List<StockRequestLine>>? requestLines,
    Map<String, List<StockLine>>? projectLines,
  })  : overviewAnswer = overview ?? const StockOverview(),
        choicesAnswer = choices ?? const StockChoices(),
        requestLinesAnswer = requestLines ?? {},
        projectLinesAnswer = projectLines ?? {};

  StockStatus statusAnswer;
  StockOverview overviewAnswer;
  StockChoices choicesAnswer;
  Map<String, List<StockRequestLine>> requestLinesAnswer;
  Map<String, List<StockLine>> projectLinesAnswer;

  /// Thrown by reads (until cleared) / by the next write before it records.
  Object? failReads;
  Object? failNextWrite;

  /// The next write is recorded, then its answer is lost (this is thrown).
  Object? loseNextAnswer;

  /// The next cancel is done on the server, then its answer is lost.
  Object? loseNextCancel;

  /// Ids cancelled for good, per account: 'userId:opId'.
  final cancelled = <String>{};

  /// What the server recorded, once per operation id.
  final writes = <(String fn, Map<String, dynamic> params, String userId)>[];

  /// Every write that reached the call, failed ones included: (op id, exact payload).
  final attempts = <(String opId, String payload)>[];
  int statusCalls = 0;
  int overviewCalls = 0;
  int checks = 0;
  int cancels = 0;

  Future<T> _read<T>(T value) async {
    final f = failReads;
    if (f != null) throw f;
    return value;
  }

  @override
  Future<Map<String, dynamic>> write(StockWrite w, Map<String, dynamic> params, {required String userId}) async {
    final op = params['p_op'] as String;
    attempts.add((op, jsonEncode(params)));
    final f = failNextWrite;
    if (f != null) {
      failNextWrite = null;
      throw f;
    }
    if (cancelled.contains('$userId:$op')) throw PostgrestException(message: 'OP_CANCELLED', code: 'P0001');
    final i = writes.indexWhere((x) => x.$2['p_op'] == op && x.$3 == userId);
    final answer = {'record_id': 'rec-${i < 0 ? writes.length + 1 : i + 1}', 'cost_moves': const <String>[]};
    if (i >= 0) return {...answer, 'replayed': true};
    writes.add((w.fn, params, userId));
    final lost = loseNextAnswer;
    if (lost != null) {
      loseNextAnswer = null;
      throw lost;
    }
    return answer;
  }

  String _state(String opId, String userId) => writes.any((w) => w.$3 == userId && w.$2['p_op'] == opId)
      ? 'recorded'
      : (cancelled.contains('$userId:$opId') ? 'cancelled' : 'none');

  @override
  Future<String> opState(String opId, {required String userId}) {
    checks++;
    return _read(_state(opId, userId));
  }

  @override
  Future<String> cancelOp(String opId, {required String userId}) async {
    cancels++;
    final f = failReads;
    if (f != null) throw f;
    final now = _state(opId, userId);
    if (now == 'none') cancelled.add('$userId:$opId');
    final lost = loseNextCancel;
    if (lost != null) {
      loseNextCancel = null;
      throw lost;
    }
    return now == 'recorded' ? 'recorded' : 'cancelled';
  }

  @override
  Future<StockStatus> status() {
    statusCalls++;
    return _read(statusAnswer);
  }

  @override
  Future<StockOverview> overview() {
    overviewCalls++;
    return _read(overviewAnswer);
  }

  @override
  Future<StockChoices> choices() => _read(choicesAnswer);

  @override
  Future<List<StockRequestLine>> requestLines(String folderId) => _read(requestLinesAnswer[folderId] ?? const []);

  @override
  Future<List<StockLine>> projectLines(String folderId) => _read(projectLinesAnswer[folderId] ?? const []);
}

/// Tests only (R104): stock submissions kept in memory. The app always keeps
/// them in the phone's settings file (PrefsStockPendingStore).
class MemoryStockPendingStore implements StockPendingStore {
  List<StockSubmission> _all = [];

  @override
  Future<StockPendingLoad> load() async => StockPendingLoad(readable: List.of(_all));

  @override
  Future<void> save(List<StockSubmission> readable) async => _all = List.of(readable);

  @override
  Future<void> dropUnreadable(String userId, String opId) async {}
}

// ── sample answers, as 0104/0105 send them ──

const cement = StockItemChoice(itemId: 'item-cement', name: 'Cement', spec: 'Portland', unit: 'bag');
const wire = StockItemChoice(itemId: 'item-wire', name: 'Tie wire', unit: 'piece');
const barlin = StockProject(folderId: 'f-barlin', name: 'Barlin Residence');
const sulit = StockProject(folderId: 'f-sulit', name: 'Sulit');
const oldJob = StockProject(folderId: 'f-old', name: 'Old Fence', completed: true);

const sampleChoices = StockChoices(items: [cement, wire], projects: [oldJob, barlin, sulit]);

StockOverview sampleOverview() => StockOverview.fromJson({
      'items': [
        {
          'item_id': 'item-cement', 'name': 'Cement', 'spec': 'Portland', 'unit': 'bag', 'total': 14,
          'places': [
            {'location_id': 'l-wh', 'name': 'Warehouse', 'kind': 'warehouse', 'folder_id': null, 'quantity': 10},
            {'location_id': 'l-b', 'name': 'Barlin Residence', 'kind': 'site', 'folder_id': 'f-barlin', 'quantity': 4},
          ],
        },
      ],
      'awaiting': [
        {
          'purchase_id': 'p-1', 'line_no': 1, 'destination': 'warehouse', 'item_name': 'Cement', 'unit': 'bag', 'quantity': 20,
          'purchase_date': '2026-10-20', 'bought_by_name': 'Juan', 'received': 12, 'not_delivered': 0, 'awaiting': 8, 'entered': 12,
          'match': {'item_id': 'item-cement', 'item_name': 'Cement', 'item_unit': 'bag', 'per': 20, 'covers': 20, 'auto': false},
        },
        {
          'purchase_id': 'p-2', 'line_no': 1, 'destination': 'warehouse', 'item_name': 'Wire box', 'unit': 'box', 'quantity': 3,
          'purchase_date': '2026-10-21', 'bought_by_name': 'Ana', 'received': 0, 'not_delivered': 0, 'awaiting': 3, 'entered': 0, 'match': null,
        },
      ],
      'recent': [
        {
          'id': 'r-issue', 'kind': 'issue', 'status': 'done', 'item_id': 'item-cement', 'item_name': 'Cement', 'item_unit': 'bag',
          'from_name': 'Warehouse', 'to_name': 'Barlin Residence', 'quantity': 4, 'on': '2026-10-26', 'recorded_by': 'u-staff',
          'recorded_by_name': 'Ana', 'recorded_at': '2026-10-26T02:00:00Z', 'reversed': false, 'returnable': 4,
          'request_description': 'Cement for slab',
          'costs': [
            {'id': 'c-1', 'kind': 'assign', 'status': 'pending', 'reversed': false, 'quantity': 4, 'value': 400, 'estimate': 412},
          ],
        },
        {
          'id': 'r-old', 'kind': 'issue', 'status': 'done', 'item_id': 'item-cement', 'item_name': 'Cement', 'item_unit': 'bag',
          'from_name': 'Warehouse', 'to_name': 'Sulit', 'quantity': 2, 'on': '2026-10-24', 'recorded_by': 'u-staff',
          'recorded_by_name': 'Ana', 'recorded_at': '2026-10-24T02:00:00Z', 'reversed': false, 'returnable': 0, 'costs': [],
          'unplanned_reason': 'gate',
        },
        {
          'id': 'r-receive', 'kind': 'receive', 'status': 'done', 'item_id': null, 'line_item': 'Cement', 'line_unit': 'bag',
          'from_name': null, 'to_name': 'Warehouse', 'quantity': 12, 'on': '2026-10-25', 'recorded_by': 'u-buyer',
          'recorded_by_name': 'Juan', 'recorded_at': '2026-10-25T02:00:00Z', 'reversed': false, 'returnable': null, 'costs': [],
        },
      ],
    });
```

**Create:** `test/stock/stock_submitter_test.dart`

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:workmate/stock/data/stock_pending_store.dart';
import 'package:workmate/stock/data/stock_submitter.dart';
import 'package:workmate/stock/domain/stock_failure.dart';
import 'package:workmate/stock/domain/stock_submission.dart';

import 'stock_fakes.dart';

Map<String, dynamic> issue(String op, {String qty = '4'}) => {
      'p_op': op,
      'p_body': {'item_id': 'item-cement', 'quantity': qty, 'on': '2026-10-27', 'note': '', 'from': 'warehouse', 'to': 'f-barlin', 'request_line_id': 'l1'},
    };

PostgrestException refusal(String code) => PostgrestException(message: code, code: 'P0001');

void main() {
  late FakeStockRemote remote;
  late MemoryStockPendingStore store;
  late DateTime clock;
  late StockSubmitter s;

  setUp(() async {
    remote = FakeStockRemote();
    store = MemoryStockPendingStore();
    clock = DateTime.utc(2026, 10, 27, 2);
    s = StockSubmitter(remote: remote, store: store, now: () => clock);
    await s.load('u1');
  });

  Future<StockSendOutcome> send({String qty = '4'}) =>
      s.submit(write: StockWrite.move, params: (op) => issue(op, qty: qty), summary: 'Issued $qty bag Cement');

  test('answered: recorded, and nothing is left on the phone', () async {
    final o = await send();
    expect(o.result, StockSendResult.recorded);
    expect(remote.writes, hasLength(1));
    expect(s.unresolved, isEmpty);
    expect((await store.load()).readable, isEmpty);
  });

  test('saved BEFORE it leaves the phone — a restart mid-send still finds it', () async {
    final seen = <int>[];
    final gate = Completer<void>();
    final slow = _SlowRemote(remote, () async => seen.add((await store.load()).readable.length), gate.future);
    final t = StockSubmitter(remote: slow, store: store, now: () => clock);
    await t.load('u1');
    final pending = t.submit(write: StockWrite.move, params: (op) => issue(op), summary: 'x');
    await Future<void>.delayed(Duration.zero);
    gate.complete();
    await pending;
    expect(seen, [1], reason: 'stored while the request was out');
  });

  test('a lost answer keeps it — the same operation id and the exact payload — and blocks a new one', () async {
    remote.failNextWrite = TimeoutException('lost');
    final o = await send();
    expect(o.result, StockSendResult.unsure);
    expect(o.failure, StockFailure.noConnection);
    final kept = s.unresolved.single;
    expect(kept.params, issue(kept.opId));
    expect((await store.load()).readable.single.payload, kept.payload);
    expect((await send(qty: '6')).result, StockSendResult.blocked, reason: 'no new submission until it is resolved');
    expect(remote.attempts, hasLength(1));
  });

  test('an unknown error (a garbled reply, a server fault) is unsure too — kept, not dropped', () async {
    remote.loseNextAnswer = const FormatException('garbled reply after commit');
    final o = await send();
    expect([o.result, o.failure], [StockSendResult.unsure, StockFailure.unexpected]);
    expect(s.unresolved, hasLength(1));
    expect((await s.retry(s.unresolved.single.opId)).answer?['replayed'], isTrue);
    expect(remote.writes, hasLength(1));
  });

  test('Send again sends the saved payload byte for byte, under the same id', () async {
    remote.failNextWrite = const SocketException('lost');
    await send();
    final op = s.unresolved.single.opId;
    final o = await s.retry(op);
    expect(o.result, StockSendResult.recorded);
    expect(remote.attempts.map((a) => a.$1).toSet(), {op});
    expect(remote.attempts[1].$2, remote.attempts[0].$2, reason: 'unchanged');
    expect(s.unresolved, isEmpty);
  });

  test('recorded but the answer lost: Send again is answered, never recorded twice', () async {
    remote.loseNextAnswer = TimeoutException('lost after commit');
    expect((await send()).result, StockSendResult.unsure);
    final o = await s.retry(s.unresolved.single.opId);
    expect(o.result, StockSendResult.recorded);
    expect(o.answer?['replayed'], isTrue);
    expect(remote.writes, hasLength(1));
  });

  test('Check is read only: recorded → it goes (nothing sent); none → it stays, with no way to change it', () async {
    remote.loseNextAnswer = TimeoutException('lost');
    await send();
    final before = remote.attempts.length;
    expect((await s.check(s.unresolved.single.opId)).result, StockSettleResult.recorded);
    expect(s.unresolved, isEmpty);
    expect(remote.attempts.length, before, reason: 'a check never sends');

    remote.failNextWrite = TimeoutException('lost');
    await send();
    final op = s.unresolved.single.opId;
    clock = clock.add(const Duration(hours: 5));
    expect((await s.check(op)).result, StockSettleResult.pending, reason: 'no clock decides it — only the server');
    expect(s.byOp(op), isNotNull);
    expect(remote.cancelled, isEmpty, reason: 'a check never cancels');
    expect((await send(qty: '6')).result, StockSendResult.blocked);
  });

  test('Cancel: the server settles it — recorded (it goes as recorded, never changed) or cancelled for good', () async {
    remote.loseNextAnswer = TimeoutException('lost');
    await send();
    expect((await s.cancel(s.unresolved.single.opId)).result, StockSettleResult.recorded);
    expect([remote.writes.length, remote.cancelled.length, s.unresolved.length], [1, 0, 0], reason: 'it was recorded: nothing cancelled');

    remote.failNextWrite = TimeoutException('lost');
    await send();
    final op = s.unresolved.single.opId;
    expect((await s.cancel(op)).result, StockSettleResult.cancelled);
    expect(remote.cancelled, {'u1:$op'});
    expect(s.unresolved, isEmpty, reason: 'settled: it may be changed now');
    expect((await send(qty: '6')).result, StockSendResult.recorded);
    expect(remote.writes.last.$2['p_body']['quantity'], '6');
    expect(remote.writes.last.$2['p_op'], isNot(op), reason: 'a new operation id');
  });

  test('the original arriving after the cancel and a new submission is refused: only the new one records', () async {
    remote.failNextWrite = TimeoutException('lost before it reached the server');
    await send(qty: '4');
    final original = s.unresolved.single;
    expect((await s.cancel(original.opId)).result, StockSettleResult.cancelled);
    expect((await send(qty: '6')).result, StockSendResult.recorded);
    // The first request, held up on the network, arrives now — exactly as sent.
    await expectLater(remote.write(original.write, original.params, userId: 'u1'),
        throwsA(isA<Exception>().having((e) => e.toString(), 'refusal', contains('OP_CANCELLED'))));
    expect(remote.writes.map((w) => w.$2['p_body']['quantity']), ['6'], reason: 'only the new submission is recorded');
  });

  test('a cancel whose answer was lost: nothing known, it stays; a Check (or Cancel again) finds it cancelled', () async {
    remote.failNextWrite = TimeoutException('lost');
    await send();
    final op = s.unresolved.single.opId;
    remote.loseNextCancel = TimeoutException('cancel answer lost');
    expect((await s.cancel(op)).result, StockSettleResult.unknown);
    expect(s.byOp(op), isNotNull, reason: 'not settled on the phone without the server\'s word');
    expect((await s.check(op)).result, StockSettleResult.cancelled);
    expect(s.unresolved, isEmpty);
  });

  test('Send again of a cancelled id is refused OP_CANCELLED — settled, nothing recorded', () async {
    remote.failNextWrite = TimeoutException('lost');
    await send();
    final op = s.unresolved.single.opId;
    remote.loseNextCancel = TimeoutException('cancel answer lost');
    await s.cancel(op);
    final o = await s.retry(op);
    expect([o.result, o.failure], [StockSendResult.refused, StockFailure.opCancelled]);
    expect([remote.writes.length, s.unresolved.length], [0, 0]);
  });

  test('a refusal on the first Send settles it; on a Send again it does not (the first Send may still arrive)', () async {
    remote.failNextWrite = refusal('NOT_ENOUGH');
    expect((await send()).result, StockSendResult.refused);
    expect(s.unresolved, isEmpty);

    remote.failNextWrite = TimeoutException('lost');
    await send();
    final op = s.unresolved.single.opId;
    clock = clock.add(const Duration(hours: 5));
    remote.failNextWrite = refusal('NOT_ENOUGH');
    final o = await s.retry(op);
    expect([o.result, o.failure], [StockSendResult.unsure, StockFailure.notEnough], reason: 'however long after');
    expect(s.byOp(op), isNotNull);
    expect((await s.cancel(op)).result, StockSettleResult.cancelled, reason: 'only the server settles it');
  });

  test('no signal for a check or a cancel: nothing known, nothing changed', () async {
    remote.failNextWrite = TimeoutException('lost');
    await send();
    remote.failReads = const SocketException('offline');
    expect((await s.check(s.unresolved.single.opId)).result, StockSettleResult.unknown);
    expect((await s.cancel(s.unresolved.single.opId)).result, StockSettleResult.unknown);
    expect(s.unresolved, hasLength(1));
    expect(remote.cancelled, isEmpty);
  });

  test('one phone, two accounts: each sees and sends only its own', () async {
    remote.failNextWrite = TimeoutException('lost');
    await send();
    await s.load('u2');
    expect(s.unresolved, isEmpty);
    expect(s.blocked, isFalse);
    expect((await store.load()).readable, hasLength(1), reason: 'kept for its own account');
    await s.load('u1');
    expect(s.unresolved, hasLength(1));
  });

  test('nothing is sent or cancelled by itself: loading and checking all never write', () async {
    remote.failNextWrite = TimeoutException('lost');
    await send();
    final t = StockSubmitter(remote: remote, store: store, now: () => clock.add(const Duration(hours: 5)));
    await t.load('u1');
    await t.checkAll();
    expect([remote.attempts.length, remote.cancels, t.unresolved.length], [1, 0, 1]);
  });

  test('the settings file keeps it word for word across a fresh read (a restart)', () async {
    SharedPreferences.setMockInitialValues({});
    final p1 = PrefsStockPendingStore(await SharedPreferences.getInstance());
    final a = StockSubmitter(remote: remote, store: p1, now: () => clock);
    await a.load('u1');
    remote.failNextWrite = TimeoutException('lost');
    await a.submit(write: StockWrite.receive, params: (op) => {'p_op': op, 'p_purchase': 'p-1', 'p_line_no': 1, 'p_qty': '5', 'p_on': '2026-10-27', 'p_note': ''}, summary: 'Received 5 bag');
    final raw = (await SharedPreferences.getInstance()).getString(PrefsStockPendingStore.key)!;
    // ignore: invalid_use_of_visible_for_testing_member
    SharedPreferences.resetStatic();
    SharedPreferences.setMockInitialValues({PrefsStockPendingStore.key: raw});
    final b = StockSubmitter(remote: remote, store: PrefsStockPendingStore(await SharedPreferences.getInstance()), now: () => clock);
    await b.load('u1');
    final kept = b.unresolved.single;
    expect([kept.write, kept.summary, kept.sends, kept.payload], [StockWrite.receive, 'Received 5 bag', 1, a.unresolved.single.payload]);
    await b.retry(kept.opId);
    expect(remote.attempts[1], remote.attempts[0]);
  });

  group('saved data the phone cannot read (R104)', () {
    const a = 'aaaaaaaa-0000-4000-8000-000000000001';
    const b = 'bbbbbbbb-0000-4000-8000-000000000002';
    const op1 = '11111111-0000-4000-8000-000000000001';
    const op2 = '22222222-0000-4000-8000-000000000002';
    String bad(String op, String user) =>
        '{"op_id":"$op","user_id":"$user","fn":"stk_move","payload":"not json","created_at":"2026-10-27T02:00:00Z"}';
    late SharedPreferences prefs;

    Future<StockSubmitter> stored(String raw, String user) async {
      // ignore: invalid_use_of_visible_for_testing_member
      SharedPreferences.resetStatic();
      SharedPreferences.setMockInitialValues({PrefsStockPendingStore.key: raw});
      prefs = await SharedPreferences.getInstance();
      final t = StockSubmitter(remote: remote, store: PrefsStockPendingStore(prefs), now: () => clock);
      await t.load(user);
      return t;
    }

    List<dynamic> entries() => jsonDecode(prefs.getString(PrefsStockPendingStore.key)!) as List<dynamic>;
    Future<StockSendOutcome> sendWith(StockSubmitter t, {String qty = '4'}) =>
        t.submit(write: StockWrite.move, params: (op) => issue(op, qty: qty), summary: 'Issued $qty bag Cement');

    test('a damaged entry of this account blocks new sends; Check and Cancel settle it by its id, never its payload', () async {
      final t = await stored('[${bad(op1, a)}]', a);
      expect([t.unresolved.length, t.unreadable.single.opId, t.blocked, t.recoveryNeeded], [0, op1, true, false]);
      expect((await sendWith(t)).result, StockSendResult.blocked, reason: 'malformed data never unblocks a new send');
      expect((await t.check(op1)).result, StockSettleResult.pending);
      expect([t.blocked, entries().length], [true, 1], reason: 'not settled: still there, still blocking');
      expect((await t.cancel(op1)).result, StockSettleResult.cancelled);
      expect(remote.cancelled, {'$a:$op1'});
      expect([t.blocked, entries()], [false, isEmpty], reason: 'settled by the server: only now it goes');
      expect(remote.attempts, isEmpty, reason: 'its payload was never rebuilt or sent');
      expect((await sendWith(t)).result, StockSendResult.recorded);
    });

    test('a damaged entry the server had recorded: Check finds it — it goes, nothing sent', () async {
      await remote.write(StockWrite.move, {'p_op': op2, 'p_body': <String, dynamic>{}}, userId: a);
      final t = await stored('[${bad(op2, a)}]', a);
      expect((await t.check(op2)).result, StockSettleResult.recorded);
      expect([remote.attempts.length, entries().length, t.blocked], [1, 0, false]);
    });

    test('a damaged entry survives every later save, word for word — and belongs to its own account', () async {
      final t = await stored('[${bad(op1, b)}]', a);
      final before = jsonDecode(bad(op1, b));
      expect(t.blocked, isFalse, reason: 'another account\'s entry does not hold this one back');
      remote.failNextWrite = TimeoutException('lost');
      await sendWith(t);
      expect(entries().first, before, reason: 'kept on the save of a new submission');
      await t.retry(t.unresolved.single.opId);
      expect(entries(), [before], reason: 'kept on the save that settles the other one');
      await t.load(b);
      expect([t.blocked, t.unreadable.single.opId], [true, op1], reason: 'it waits for its own account');
    });

    test('an entry with no readable account blocks every account, needs recovery, and is never overwritten', () async {
      final t = await stored('[{"payload":"x"}]', a);
      expect([t.blocked, t.recoveryNeeded, t.unreadable], [true, true, isEmpty], reason: 'cannot be settled by id');
      expect((await sendWith(t)).result, StockSendResult.blocked);
      await t.load(b);
      expect([t.blocked, t.recoveryNeeded], [true, true], reason: 'it could be anyone\'s');
      await PrefsStockPendingStore(prefs).save(const []);
      expect(entries(), [{'payload': 'x'}], reason: 'a save keeps it');
    });

    test('an entry of this account with no readable operation id needs recovery; another account is not held back', () async {
      final t = await stored('[{"op_id":"not-an-id","user_id":"$a","payload":"x"}]', a);
      expect([t.blocked, t.recoveryNeeded], [true, true]);
      await t.load(b);
      expect([t.blocked, t.recoveryNeeded], [false, false]);
    });

    test('storage that is not a list at all: everything blocked, and nothing ever overwrites it', () async {
      for (final raw in ['not json', '{"a":1}']) {
        final t = await stored(raw, a);
        expect([t.blocked, t.recoveryNeeded, t.unresolved, t.unreadable], [true, true, isEmpty, isEmpty], reason: raw);
        expect((await sendWith(t)).result, StockSendResult.blocked, reason: raw);
        await expectLater(PrefsStockPendingStore(prefs).save(const []), throwsStateError, reason: raw);
        await expectLater(PrefsStockPendingStore(prefs).dropUnreadable(a, op1), throwsStateError, reason: raw);
        expect(prefs.getString(PrefsStockPendingStore.key), raw, reason: 'untouched');
      }
      expect(remote.attempts, isEmpty);
    });

    test('storage turning unreadable while open: a new submission is not sent, the form stays editable, nothing new goes after', () async {
      final t = await stored('[]', a);
      await prefs.setString(PrefsStockPendingStore.key, 'garbage');
      final o = await sendWith(t);
      expect([o.result, o.failure], [StockSendResult.refused, StockFailure.unexpected], reason: 'not saved, so not sent');
      expect([remote.attempts, t.blocked, t.recoveryNeeded], [isEmpty, true, true]);
      expect((await sendWith(t)).result, StockSendResult.blocked);
      expect(prefs.getString(PrefsStockPendingStore.key), 'garbage');
    });

    test('readable entries beside damaged ones still read; each damaged one is kept apart', () async {
      final good = StockSubmission.create(opId: op2, userId: a, write: StockWrite.move, params: issue(op2), summary: 's', now: clock).sentAt(clock);
      final t = await stored('[${bad(op1, a)},${jsonEncode(good.toJson())},{"op_id":"$op1","user_id":"$a","fn":"stk_move","payload":"{}","created_at":"not a date"}]', a);
      expect(t.unresolved.single.opId, op2);
      expect(t.unreadable.map((u) => u.opId), [op1, op1]);
      expect(t.blocked, isTrue);
    });
  });

  test('a payload never travels without its own operation id', () {
    expect(() => StockSubmission.create(opId: 'a', userId: 'u1', write: StockWrite.move, params: {'p_op': 'b'}, summary: '', now: clock),
        throwsArgumentError);
    expect(StockSubmission.fromJson({'op_id': 'a', 'user_id': 'u1', 'fn': 'stk_move', 'payload': '{"p_op":"b"}', 'created_at': '2026-10-27T02:00:00Z'}),
        isNull);
  });
}

/// Holds a write until [gate] opens, running [during] while it is out.
class _SlowRemote extends FakeStockRemote {
  _SlowRemote(this.inner, this.during, this.gate);
  final FakeStockRemote inner;
  final Future<void> Function() during;
  final Future<void> gate;

  @override
  Future<Map<String, dynamic>> write(StockWrite w, Map<String, dynamic> params, {required String userId}) async {
    await during();
    await gate;
    return inner.write(w, params, userId: userId);
  }
}
```

<!-- Code -->

**Modify:** `lib/purchasing/domain/pur_models.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/domain/pur_models.dart b/lib/purchasing/domain/pur_models.dart
index 2c24570..078a50b 100644
--- a/lib/purchasing/domain/pur_models.dart
+++ b/lib/purchasing/domain/pur_models.dart
@@ -131,6 +131,10 @@ class ShoppingLine {
     this.stillToBuy = 0,
     this.unitChecks = 0,
     this.portions = const [],
+    this.catalogItemId,
+    this.fromStock = 0,
+    this.inWarehouse = 0,
+    this.inWarehouseUnit = '',
   });
 
   factory ShoppingLine.fromJson(Map<String, dynamic> j) => ShoppingLine(
@@ -154,6 +158,10 @@ class ShoppingLine {
         stillToBuy: _num(j['still_to_buy']),
         unitChecks: _num(j['unit_checks']).toInt(),
         portions: _rows(j['portions']).map(PurPortion.fromJson).toList(),
+        catalogItemId: j['catalog_item_id'] as String?,
+        fromStock: _num(j['from_stock']),
+        inWarehouse: _num(j['in_warehouse']),
+        inWarehouseUnit: _str(j['in_warehouse_unit']),
       );
 
   final String lineId;
@@ -180,6 +188,18 @@ class ShoppingLine {
   final int unitChecks;
   final List<PurPortion> portions;
 
+  /// The request line's catalogue item (an issue from stock needs it).
+  final String? catalogItemId;
+
+  /// 2B-b (0104): what the office issued from stock for this line — Bought
+  /// stays purchases alone, and Still to buy counts both.
+  final double fromStock;
+
+  /// Usable warehouse stock of the line's catalogue item, in [inWarehouseUnit]:
+  /// a hint, no reservation (Q9) — 0 while stock is off.
+  final double inWarehouse;
+  final String inWarehouseUnit;
+
   Map<String, dynamic> toJson() => {
         'line_id': lineId,
         'request_id': requestId,
@@ -201,6 +221,10 @@ class ShoppingLine {
         'still_to_buy': stillToBuy,
         'unit_checks': unitChecks,
         'portions': [for (final p in portions) p.toJson()],
+        'catalog_item_id': catalogItemId,
+        'from_stock': fromStock,
+        'in_warehouse': inWarehouse,
+        'in_warehouse_unit': inWarehouseUnit,
       };
 
   /// "Santos Townhouse · AW-03 Fence"; the main contract shows the project alone.
```

**Modify:** `lib/requests/domain/remote_request.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/requests/domain/remote_request.dart b/lib/requests/domain/remote_request.dart
index c2ea79a..bb6a48e 100644
--- a/lib/requests/domain/remote_request.dart
+++ b/lib/requests/domain/remote_request.dart
@@ -14,6 +14,7 @@ class Portion {
     required this.cutoffAt,
     required this.purchaseOn,
     required this.deliveryOn,
+    this.fromStock = 0,
   });
 
   factory Portion.fromJson(Map<String, dynamic> j) => Portion(
@@ -23,6 +24,7 @@ class Portion {
         cutoffAt: DateTime.parse(j['cutoff_at'] as String),
         purchaseOn: j['purchase_on'] as String,
         deliveryOn: j['delivery_on'] as String,
+        fromStock: _num(j['from_stock']),
       );
 
   final double quantity;
@@ -37,6 +39,9 @@ class Portion {
   /// Calendar dates ("2026-10-12"), never instants.
   final String purchaseOn;
   final String deliveryOn;
+
+  /// 2B-b (0106): what the office issued from stock for this portion (0 before 0106).
+  final double fromStock;
 }
 
 class RemoteLine {
@@ -59,6 +64,7 @@ class RemoteLine {
     this.cancelled = false,
     this.hasConflict = false,
     this.portions = const [],
+    this.fromStock = 0,
   });
 
   factory RemoteLine.fromJson(Map<String, dynamic> j) => RemoteLine(
@@ -79,6 +85,7 @@ class RemoteLine {
         version: (j['version'] as num).toInt(),
         hasConflict: j['has_conflict'] == true,
         needed: _num(j['needed']),
+        fromStock: _num(j['from_stock']),
         portions: [
           for (final p in (j['portions'] as List<dynamic>? ?? const [])) Portion.fromJson(Map<String, dynamic>.from(p as Map)),
         ],
@@ -107,6 +114,10 @@ class RemoteLine {
   /// Still needed: Σ(quantity − pending reduction).
   final double needed;
   final List<Portion> portions;
+
+  /// 2B-b (Q26, 0106): what the office issued from stock for this line —
+  /// the only thing of stock a worker sees. 0 before 0106 or with stock off.
+  final double fromStock;
 }
 
 class RemotePhoto {
```

**Create:** `lib/stock/data/stock_pending_store.dart`

```dart
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../domain/stock_submission.dart';

/// A saved stock submission the phone can no longer read in full (R104):
/// kept exactly as stored, never dropped by a save. If its account and
/// operation id can still be read, the server can settle it by Check or
/// Cancel — its payload is never rebuilt. Otherwise it needs recovery.
class UnreadableSubmission {
  const UnreadableSubmission({required this.raw, this.opId, this.userId});

  /// The stored entry as it is (JSON text).
  final String raw;

  /// Read only if it is a well-formed id.
  final String? opId;
  final String? userId;

  /// Check and Cancel need only these two.
  bool get settleable => opId != null && userId != null;

  static final _uuid = RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

  static UnreadableSubmission of(Object? entry) {
    String? id(Object? v) => v is String && _uuid.hasMatch(v) ? v : null;
    final m = entry is Map ? entry : const {};
    return UnreadableSubmission(raw: jsonEncode(entry), opId: id(m['op_id']), userId: id(m['user_id']));
  }
}

/// What is stored on the phone: the submissions that read in full, the ones
/// that do not, and whether the stored text as a whole cannot be read.
class StockPendingLoad {
  const StockPendingLoad({this.readable = const [], this.unreadable = const [], this.damaged = false});
  final List<StockSubmission> readable;
  final List<UnreadableSubmission> unreadable;

  /// The stored text is not a list at all: nothing can be read or saved.
  final bool damaged;
}

/// Where unresolved stock submissions wait on the phone (R101, R104): they
/// survive closing a form, closing the app and a restart. Nothing here ever
/// sends. Unreadable data is never treated as empty and never overwritten.
abstract class StockPendingStore {
  Future<StockPendingLoad> load();

  /// Stores [readable] (every account's) — keeping every unreadable entry as
  /// it is now stored. Refuses (STOCK_STORE_DAMAGED) if the stored text
  /// cannot be read at all: it is never overwritten.
  Future<void> save(List<StockSubmission> readable);

  /// Removes the unreadable entries of this account and operation id — only
  /// after the server settled that id (recorded, or cancelled for good).
  Future<void> dropUnreadable(String userId, String opId);
}

/// The phone's settings file; every account's unresolved submissions in one
/// list (each carries its account, R103). Quantities and ids only — no peso.
class PrefsStockPendingStore implements StockPendingStore {
  PrefsStockPendingStore(this._prefs);

  static const key = 'stock.unresolved.v1';
  final SharedPreferences _prefs;

  /// The stored list, entry by entry (null: nothing stored; throws if damaged).
  List<Object?>? _entries() {
    final raw = _prefs.getString(key);
    if (raw == null) return null;
    final Object? list;
    try {
      list = jsonDecode(raw);
    } on FormatException {
      throw StateError('STOCK_STORE_DAMAGED');
    }
    if (list is! List) throw StateError('STOCK_STORE_DAMAGED');
    return list;
  }

  static StockSubmission? _read(Object? entry) {
    if (entry is! Map) return null;
    try {
      return StockSubmission.fromJson(Map<String, dynamic>.from(entry));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<StockPendingLoad> load() async {
    final List<Object?>? entries;
    try {
      entries = _entries();
    } on StateError {
      return const StockPendingLoad(damaged: true);
    }
    final readable = <StockSubmission>[];
    final unreadable = <UnreadableSubmission>[];
    for (final e in entries ?? const []) {
      final s = _read(e);
      if (s != null) {
        readable.add(s);
      } else {
        unreadable.add(UnreadableSubmission.of(e));
      }
    }
    return StockPendingLoad(readable: readable, unreadable: unreadable);
  }

  @override
  Future<void> save(List<StockSubmission> readable) async {
    final kept = [for (final e in _entries() ?? const []) if (_read(e) == null) e];
    await _write([...kept, for (final s in readable) s.toJson()]);
  }

  @override
  Future<void> dropUnreadable(String userId, String opId) async {
    final entries = _entries() ?? const [];
    await _write([
      for (final e in entries)
        if (_read(e) != null || !(UnreadableSubmission.of(e).opId == opId && UnreadableSubmission.of(e).userId == userId)) e,
    ]);
  }

  Future<void> _write(List<Object?> entries) async {
    final ok = await _prefs.setString(key, jsonEncode(entries));
    if (!ok) throw StateError('STOCK_SAVE_FAILED');
  }
}
```

**Create:** `lib/stock/data/stock_remote.dart`

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../attendance/domain/event_id.dart';
import '../domain/stock_models.dart';
import '../domain/stock_submission.dart';

const _readTimeout = Duration(seconds: 15);
const _rpcTimeout = Duration(seconds: 30);

/// Stock on the phone (Q26): online only — every read and write is one call
/// to 0104/0105's `stk_*` functions, the same ones the web Stock tab uses.
/// Nothing is queued: a write whose answer was lost is kept by
/// [StockSubmitter] and sent again unchanged, so it records once (`pur_ops`).
abstract class StockRemote {
  Future<StockStatus> status();
  Future<StockOverview> overview();
  Future<StockChoices> choices();
  Future<List<StockRequestLine>> requestLines(String folderId);
  Future<List<StockLine>> projectLines(String folderId);

  // Writes and checks refuse to act for another account than the signed-in
  // one (AUTH_REQUIRED): a shared site phone could otherwise send for, or
  // misread the records of, the last user.

  /// One stock write, its parameters exactly as given (`p_op` included).
  Future<Map<String, dynamic>> write(StockWrite write, Map<String, dynamic> params, {required String userId});

  /// The phone's Check, read only (0106's `pur_op_state`): 'recorded',
  /// 'cancelled' or 'none' for the signed-in account's own operation id.
  Future<String> opState(String opId, {required String userId});

  /// The phone's Cancel (0106's `pur_op_cancel`): under the operation's own
  /// lock the server answers 'recorded' (it was — nothing changes) or
  /// 'cancelled' (for good: a late request with this id is refused).
  Future<String> cancelOp(String opId, {required String userId});
}

/// One operation id per submission, made once and kept with its payload —
/// a lost answer sent again is answered, never recorded twice (R101).
String newStockOpId() => newEventId();

class SupabaseStockRemote implements StockRemote {
  SupabaseStockRemote(this._client);

  final SupabaseClient _client;

  void _same(String userId) {
    final session = _client.auth.currentUser?.id;
    if (session == null || session != userId) throw StateError('AUTH_REQUIRED');
  }

  Future<Object?> _read(String fn, [Map<String, dynamic>? params]) => _client.rpc(fn, params: params).timeout(_readTimeout);

  Future<Map<String, dynamic>> _write(String fn, Map<String, dynamic> params, String userId) async {
    _same(userId);
    final result = await _client.rpc(fn, params: params).timeout(_rpcTimeout);
    return Map<String, dynamic>.from(result as Map);
  }

  List<Map<String, dynamic>> _rows(Object? v) => [for (final r in (v as List<dynamic>? ?? const [])) Map<String, dynamic>.from(r as Map)];

  @override
  Future<StockStatus> status() async => StockStatus.fromJson(Map<String, dynamic>.from(await _read('stk_status') as Map));

  @override
  Future<StockOverview> overview() async => StockOverview.fromJson(Map<String, dynamic>.from(await _read('stk_overview') as Map));

  @override
  Future<StockChoices> choices() async => StockChoices.fromJson(Map<String, dynamic>.from(await _read('stk_choices') as Map));

  @override
  Future<List<StockRequestLine>> requestLines(String folderId) async =>
      _rows(await _read('stk_request_lines', {'p_folder': folderId})).map(StockRequestLine.fromJson).toList();

  @override
  Future<List<StockLine>> projectLines(String folderId) async =>
      _rows(await _read('stk_project_lines', {'p_folder': folderId})).map(StockLine.fromJson).toList();

  @override
  Future<Map<String, dynamic>> write(StockWrite write, Map<String, dynamic> params, {required String userId}) =>
      _write(write.fn, params, userId);

  @override
  Future<String> opState(String opId, {required String userId}) async {
    _same(userId);
    return await _read('pur_op_state', {'p_op': opId}) as String;
  }

  @override
  Future<String> cancelOp(String opId, {required String userId}) async {
    _same(userId);
    return await _client.rpc('pur_op_cancel', params: {'p_op': opId}).timeout(_rpcTimeout) as String;
  }
}
```

**Create:** `lib/stock/data/stock_submitter.dart`

```dart
import 'package:flutter/foundation.dart';

import '../domain/stock_failure.dart';
import '../domain/stock_submission.dart';
import 'stock_pending_store.dart';
import 'stock_remote.dart';

enum StockSendResult {
  /// The server answered: it is recorded (or was already — the same answer).
  recorded,

  /// Refused, and nothing can still record it: its first Send was refused,
  /// or the server holds its id cancelled (OP_CANCELLED).
  refused,

  /// Not known: the answer was lost, or a Send again was refused while the
  /// first Send might still arrive. It stays, unchanged, until settled (R101).
  unsure,

  /// Another unresolved stock submission must be settled first (R101).
  blocked,
}

class StockSendOutcome {
  const StockSendOutcome(this.result, {this.opId, this.failure, this.answer});
  final StockSendResult result;

  /// The submission it is about (null when blocked).
  final String? opId;
  final StockFailure? failure;
  final Map<String, dynamic>? answer;
}

/// What the server says about an unresolved submission's id (R102).
enum StockSettleResult {
  /// Recorded, once, under this id: nothing to change.
  recorded,

  /// Cancelled for good — no request with this id can record it any more:
  /// only now may it be changed (a new submission) or dropped.
  cancelled,

  /// (Check only) the server has neither: it may still arrive. Send again,
  /// or Cancel it.
  pending,

  /// No answer (no signal): nothing known, nothing changed.
  unknown,
}

class StockSettleOutcome {
  const StockSettleOutcome(this.result, {this.failure});
  final StockSettleResult result;
  final StockFailure? failure;
}

/// Sends every stock record from the phone (R101–R103). Each submission is
/// saved BEFORE it leaves, with its operation id and exact payload; a lost
/// answer leaves it saved and unchanged. It is settled only by the SERVER:
/// a reply, a refusal of its first Send, or — asked by Check (read only,
/// `pur_op_state`) or Cancel (`pur_op_cancel`, under the same lock recording
/// takes) — the id recorded or cancelled for good. Until then: no edit, no new
/// stock submission for that account, nothing sent by itself. A saved entry
/// the phone can no longer read is kept and blocks new sends too (R104): by
/// its id it can still be checked or cancelled; without one it needs recovery.
class StockSubmitter extends ChangeNotifier {
  StockSubmitter({required this.remote, required this.store, DateTime Function()? now}) : _now = now ?? DateTime.now;

  final StockRemote remote;
  final StockPendingStore store;
  final DateTime Function() _now;

  List<StockSubmission> _all = const [];
  List<UnreadableSubmission> _unreadable = const [];
  bool _damaged = false;
  String? _userId;
  final _busy = <String>{};
  bool _disposed = false;

  /// The signed-in account's unresolved submissions, oldest first.
  List<StockSubmission> get unresolved => [
        for (final s in _all)
          if (s.userId == _userId) s,
      ];

  /// This account's saved entries that no longer read in full but whose id
  /// does: the server can settle each by Check or Cancel (R104).
  List<UnreadableSubmission> get unreadable => [
        for (final u in _unreadable)
          if (u.settleable && u.userId == _userId) u,
      ];

  /// Saved stock data the phone cannot read and cannot settle by id — the
  /// whole store, an entry with no readable account (it could be anyone's),
  /// or one of this account's with no readable operation id (R104).
  bool get recoveryNeeded =>
      _damaged || _unreadable.any((u) => u.userId == null || (u.userId == _userId && u.opId == null));

  /// No new stock submission until every one of these is settled.
  bool get blocked => unresolved.isNotEmpty || unreadable.isNotEmpty || recoveryNeeded;
  bool isBusy(String opId) => _busy.contains(opId);
  StockSubmission? byOp(String opId) => unresolved.where((s) => s.opId == opId).firstOrNull;

  /// Reads what is waiting on the phone for [userId]; never sends.
  Future<void> load(String userId) async {
    _userId = userId;
    await _reload();
    _notify();
  }

  Future<void> _reload() async {
    final l = await store.load();
    _all = l.readable;
    _unreadable = l.unreadable;
    _damaged = l.damaged;
  }

  /// A new stock record. Refused while this account has one unresolved.
  Future<StockSendOutcome> submit({
    required StockWrite write,
    required Map<String, dynamic> Function(String opId) params,
    required String summary,
  }) async {
    final userId = _userId;
    if (userId == null) throw StateError('load() first');
    if (blocked) return const StockSendOutcome(StockSendResult.blocked);
    final opId = newStockOpId();
    final s = StockSubmission.create(opId: opId, userId: userId, write: write, params: params(opId), summary: summary, now: _now());
    return _send(s);
  }

  /// Send again: the saved submission, byte for byte — never the form.
  Future<StockSendOutcome> retry(String opId) async {
    final s = byOp(opId);
    if (s == null) return StockSendOutcome(StockSendResult.recorded, opId: opId);
    return _send(s);
  }

  Future<StockSendOutcome> _send(StockSubmission s) async {
    if (!_busy.add(s.opId)) return StockSendOutcome(StockSendResult.unsure, opId: s.opId);
    _notify();
    try {
      // Sent before? Then that Send might still arrive.
      final sentBefore = s.lastSentAt != null;
      final sent = s.sentAt(_now());
      try {
        await _put(sent);
      } catch (_) {
        // Not saved, so not sent. The phone cannot keep stock records safely:
        // nothing new is sent until that is fixed (R104).
        _damaged = true;
        if (!sentBefore) {
          // A new one: nothing left the phone — refused, the form stays editable.
          _all = [..._all.where((x) => x.opId != s.opId)];
          return StockSendOutcome(StockSendResult.refused, opId: s.opId, failure: StockFailure.unexpected);
        }
        return StockSendOutcome(StockSendResult.unsure, opId: s.opId, failure: StockFailure.unexpected);
      }
      try {
        final answer = await remote.write(sent.write, sent.params, userId: sent.userId);
        await _drop(sent.opId);
        return StockSendOutcome(StockSendResult.recorded, opId: s.opId, answer: answer);
      } catch (e) {
        final f = StockFailure.of(e);
        if (f.uncertain) return StockSendOutcome(StockSendResult.unsure, opId: s.opId, failure: f);
        // A refusal settles it only if no earlier Send of it can still arrive
        // — or the server says the id itself is cancelled (R102).
        if (sentBefore && f != StockFailure.opCancelled) {
          return StockSendOutcome(StockSendResult.unsure, opId: s.opId, failure: f);
        }
        await _drop(sent.opId);
        return StockSendOutcome(StockSendResult.refused, opId: s.opId, failure: f);
      }
    } finally {
      _busy.remove(s.opId);
      _notify();
    }
  }

  /// Check: asks the server, read only; never sends, never cancels.
  Future<StockSettleOutcome> check(String opId) => _settle(opId, cancel: false);

  /// Cancel it: the server settles the id — recorded (nothing changes) or
  /// cancelled for good. Only a 'cancelled' answer lets it be changed or dropped.
  Future<StockSettleOutcome> cancel(String opId) => _settle(opId, cancel: true);

  Future<StockSettleOutcome> _settle(String opId, {required bool cancel}) async {
    final s = byOp(opId);
    // An unreadable entry is settled by its id alone — its payload is never rebuilt (R104).
    final u = s == null ? unreadable.where((x) => x.opId == opId).firstOrNull : null;
    final userId = s?.userId ?? u?.userId;
    if (userId == null) return const StockSettleOutcome(StockSettleResult.recorded);
    if (!_busy.add(opId)) return const StockSettleOutcome(StockSettleResult.unknown);
    _notify();
    try {
      final String state;
      try {
        state = cancel ? await remote.cancelOp(opId, userId: userId) : await remote.opState(opId, userId: userId);
      } catch (e) {
        return StockSettleOutcome(StockSettleResult.unknown, failure: StockFailure.of(e));
      }
      if (u != null) {
        final result = switch (state) {
          'recorded' => StockSettleResult.recorded,
          'cancelled' => StockSettleResult.cancelled,
          'none' when !cancel => StockSettleResult.pending,
          _ => StockSettleResult.unknown,
        };
        if (result == StockSettleResult.recorded || result == StockSettleResult.cancelled) {
          try {
            await store.dropUnreadable(userId, opId);
            await _reload();
          } catch (_) {
            // Not removed from the phone: it stays (and blocks) until it can be.
            return const StockSettleOutcome(StockSettleResult.unknown, failure: StockFailure.unexpected);
          }
        }
        return StockSettleOutcome(result, failure: result == StockSettleResult.unknown ? StockFailure.unexpected : null);
      }
      final result = switch (state) {
        'recorded' => StockSettleResult.recorded,
        'cancelled' => StockSettleResult.cancelled,
        'none' when !cancel => StockSettleResult.pending,
        _ => StockSettleResult.unknown,
      };
      if (result == StockSettleResult.recorded || result == StockSettleResult.cancelled) await _drop(opId);
      return StockSettleOutcome(result, failure: result == StockSettleResult.unknown ? StockFailure.unexpected : null);
    } finally {
      _busy.remove(opId);
      _notify();
    }
  }

  /// Checks every unresolved one (on open and on coming back): read only —
  /// one the server settled (recorded, or cancelled) goes; the rest stay.
  Future<void> checkAll() async {
    for (final s in unresolved) {
      if (!isBusy(s.opId)) await check(s.opId);
    }
    for (final u in unreadable) {
      if (!isBusy(u.opId!)) await check(u.opId!);
    }
  }

  Future<void> _put(StockSubmission s) async {
    final next = [for (final x in _all) x.opId == s.opId ? s : x];
    if (!next.any((x) => x.opId == s.opId)) next.add(s);
    await store.save(next);
    _all = next;
  }

  Future<void> _drop(String opId) async {
    final next = [..._all.where((x) => x.opId != opId)];
    try {
      await store.save(next);
      _all = next;
    } catch (_) {
      // Could not be removed from the phone: it stays unresolved (a Check
      // settles it again later) and nothing new is sent meanwhile.
      _damaged = true;
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
```

**Create:** `lib/stock/domain/stock_failure.dart`

```dart
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart' show AuthRetryableFetchException;

import '../../attendance/ui/attendance_copy.dart' show Bilingual;

/// Every way a stock call from the phone can be refused (0104, 0105),
/// reduced to what the person can do about it. Anything unknown is
/// [unexpected], never a guess. Stock is online only (Q26): nothing is queued.
enum StockFailure {
  stockOff,
  notAllowed,
  toMatch,
  notWarehouse,
  notProject,
  moreThanAwaited,
  moreThanBought,
  moreThanIssued,
  notEnough,
  badReturn,
  badPlace,
  badItem,
  badProject,
  unplannedReasonRequired,
  requestExceeded,
  itemMismatch,
  unitMismatch,
  lineClosed,
  badRequestLink,
  badQuantity,
  badDate,
  badNote,
  reasonRequired,
  notFound,
  opCancelled,
  appUpdateRequired,
  sessionExpired,
  noConnection,
  unexpected;

  static const _byCode = <String, StockFailure>{
    'STOCK_OFF': stockOff,
    'NOT_OFFICE': notAllowed,
    'NOT_ALLOWED': notAllowed,
    'OWNER_ONLY': notAllowed,
    'TO_MATCH': toMatch,
    'NOT_WAREHOUSE': notWarehouse,
    'NOT_PROJECT': notProject,
    'MORE_THAN_AWAITED': moreThanAwaited,
    'MORE_THAN_BOUGHT': moreThanBought,
    'MORE_THAN_ISSUED': moreThanIssued,
    'NOT_ENOUGH': notEnough,
    'BAD_LOT': notEnough,
    'BAD_RETURN': badReturn,
    'BAD_LOCATION': badPlace,
    'BAD_ITEM': badItem,
    'BAD_PROJECT': badProject,
    'UNPLANNED_REASON_REQUIRED': unplannedReasonRequired,
    'REQUEST_EXCEEDED': requestExceeded,
    'ITEM_MISMATCH': itemMismatch,
    'UNIT_MISMATCH': unitMismatch,
    'LINE_CLOSED': lineClosed,
    'BAD_REQUEST_LINK': badRequestLink,
    'BAD_PORTION': badRequestLink,
    'BAD_QUANTITY': badQuantity,
    'BAD_DATE': badDate,
    'BAD_NOTE': badNote,
    'REASON_REQUIRED': reasonRequired,
    'NOT_FOUND': notFound,
    'BAD_STATE': notFound,
    'BAD_OP': unexpected,
    'OP_CANCELLED': opCancelled,
    'APP_UPDATE_REQUIRED': appUpdateRequired,
    'AUTH_REQUIRED': sessionExpired,
  };

  static StockFailure of(Object error) {
    if (error is StockFailureException) return error.failure;
    if (error is IOException || error is TimeoutException || error is http.ClientException || error is AuthRetryableFetchException) {
      return noConnection;
    }
    // Whole codes only: REASON_REQUIRED is part of longer codes.
    for (final m in RegExp(r'[A-Z][A-Z_]{2,}[A-Z]').allMatches(error.toString())) {
      final f = _byCode[m.group(0)];
      if (f != null) return f;
    }
    return unexpected;
  }

  /// Worth pressing Send again (the same operation id, so it records once).
  bool get retryable => this == noConnection || this == sessionExpired || this == unexpected;

  /// The answer was lost: the server may or may not have recorded it, so the
  /// submission is kept, unchanged, until resolved (R101). Every other
  /// failure is the server's (or the phone's, before sending) clear "no".
  bool get uncertain => this == noConnection || this == unexpected;
}

/// A refusal decided on the phone (no server code to read).
class StockFailureException implements Exception {
  const StockFailureException(this.failure);
  final StockFailure failure;
  @override
  String toString() => 'StockFailureException(${failure.name})';
}

/// English, then Tagalog (Q22) — the same meaning as the web's words.
Bilingual stockFailureCopy(StockFailure f) => switch (f) {
      StockFailure.stockOff => const Bilingual(
          'Stock is not switched on yet. The owner switches it on at launch.', 'Hindi pa naka-on ang stock. Bubuksan ito ng may-ari sa launch.'),
      StockFailure.notAllowed => const Bilingual(
          'Your account cannot record stock. Ask the owner.', 'Hindi puwedeng magtala ng stock ang account mo. Itanong sa may-ari.'),
      StockFailure.toMatch => const Bilingual(
          'The office has to match this purchase line to a catalogue item first (Dacs Web → Stock → Receiving).',
          'Kailangan munang itugma ng opisina ang linyang ito sa item sa catalogue.'),
      StockFailure.notWarehouse => const Bilingual(
          'That purchase line is for a project, not the warehouse. Record its leftovers instead.',
          'Para sa project ang linyang iyon, hindi sa bodega. Itala na lang ang natira.'),
      StockFailure.notProject => const Bilingual(
          'That purchase line is for the warehouse — it becomes stock by being received.',
          'Para sa bodega ang linyang iyon — nagiging stock ito kapag natanggap.'),
      StockFailure.moreThanAwaited => const Bilingual(
          'That is more than is still awaited on this line.', 'Mas marami iyan sa hinihintay pa sa linyang ito.'),
      StockFailure.moreThanBought => const Bilingual(
          'That is more than this purchase line brought (counting what is already stock).',
          'Mas marami iyan sa nabili sa linyang ito (kasama ang naitala nang stock).'),
      StockFailure.moreThanIssued => const Bilingual(
          'That is more than this issue sent and has not had back.', 'Mas marami iyan sa naipadala at hindi pa naibabalik.'),
      StockFailure.notEnough => const Bilingual(
          'There is not that much there. Refresh and check the quantity.', 'Wala nang ganoon karami doon. I-refresh at suriin ang dami.'),
      StockFailure.badReturn => const Bilingual(
          'Only a live issue from the warehouse can be returned.', 'Ang naipadala lang mula sa bodega ang puwedeng ibalik.'),
      StockFailure.badPlace => const Bilingual(
          'Choose where the goods are and where they go — two different places.',
          'Piliin kung nasaan ang gamit at saan dadalhin — dalawang magkaibang lugar.'),
      StockFailure.badItem => const Bilingual('Choose a catalogue item.', 'Pumili ng item sa catalogue.'),
      StockFailure.badProject => const Bilingual('Choose one of your projects.', 'Pumili ng isa sa mga project.'),
      StockFailure.unplannedReasonRequired => const Bilingual(
          'Goods going to a project fill a request, or say why they are needed.',
          'Ang gamit na dadalhin sa project ay para sa isang request, o sabihin kung bakit kailangan.'),
      StockFailure.requestExceeded => const Bilingual(
          'That is more than the request still needs. Send the rest separately, as unplanned with a reason.',
          'Sobra iyan sa kailangan pa ng request. Ipadala ang sobra nang hiwalay, may dahilan.'),
      StockFailure.itemMismatch => const Bilingual(
          'That request is for a different catalogue item.', 'Ibang item sa catalogue ang request na iyon.'),
      StockFailure.unitMismatch => const Bilingual(
          'That request uses another unit. Send it as unplanned with a reason.',
          'Ibang unit ang request na iyon. Ipadala bilang hindi planado, may dahilan.'),
      StockFailure.lineClosed => const Bilingual('That request was cancelled.', 'Kinansela ang request na iyon.'),
      StockFailure.badRequestLink => const Bilingual(
          'That request belongs to another project. Refresh and choose again.', 'Sa ibang project ang request na iyon. I-refresh at pumili ulit.'),
      StockFailure.badQuantity => const Bilingual(
          'Enter a quantity above 0 (at most 3 decimals).', 'Ilagay ang dami na higit sa 0 (hanggang 3 decimal).'),
      StockFailure.badDate => const Bilingual('Pick a date that has happened.', 'Pumili ng petsang lumipas na.'),
      StockFailure.badNote => const Bilingual(
          'That note is too long (300 characters at most).', 'Masyadong mahaba ang tala (hanggang 300 letra).'),
      StockFailure.reasonRequired => const Bilingual('Please give a reason.', 'Magbigay ng dahilan.'),
      StockFailure.notFound => const Bilingual(
          'That changed in the meantime. Refresh and try again.', 'Nagbago iyon. I-refresh at subukan ulit.'),
      StockFailure.opCancelled => const Bilingual(
          'This record was cancelled — nothing was recorded. Change it if needed and send it as a new one.',
          'Kinansela ang record na ito — walang naitala. Baguhin kung kailangan at ipadala bilang bago.'),
      StockFailure.appUpdateRequired => const Bilingual('Update WorkMate to send this.', 'I-update ang WorkMate para maipadala ito.'),
      StockFailure.sessionExpired => const Bilingual('Sign in again to send this.', 'Mag-sign in ulit para maipadala ito.'),
      StockFailure.noConnection => const Bilingual(
          'Stock needs signal. Press Send again when you are online — it is never recorded twice.',
          'Kailangan ng signal ang stock. Pindutin ulit ang Send kapag online ka na — hindi ito maitatala nang dalawang beses.'),
      StockFailure.unexpected => const Bilingual('Something went wrong. Try again.', 'May nasira. Subukan ulit.'),
    };
```

**Create:** `lib/stock/domain/stock_forms.dart`

```dart
/// The phone's stock forms, checked the way the server checks them (0104):
/// each problem here is one the server would refuse anyway, shown before
/// sending. The bodies are what `stk_move` / `stk_receive` / `stk_leftover`
/// take. Quantities are sent as text, exactly as typed (3 decimals at most).
library;

import 'stock_failure.dart';
import 'stock_models.dart';

/// Same rule as the server's pur_qty: a plain number, at most 3 decimals,
/// above 0 (a count may be 0 — not on the phone), at most 1,000,000.
double? parseStockQty(String text) {
  final s = text.replaceAll(',', '').trim();
  if (!RegExp(r'^\d+(\.\d{1,3})?$').hasMatch(s)) return null;
  final v = double.parse(s);
  return v > 0 && v <= 1000000 ? v : null;
}

/// "8", "2.5", "33.333": what the server is sent.
String qtyText(double v) => v.toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');

bool _isDay(String s) => RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s);

/// An issue (warehouse → project), a move (project → project or → the
/// warehouse) or a return (part of one issue back to the warehouse).
class MoveForm {
  MoveForm({
    this.itemId,
    this.from = warehousePlace,
    this.to,
    this.quantity = '',
    required this.on,
    this.requestLineId,
    this.unplannedReason = '',
    this.note = '',
    this.returnsRecord,
  });

  String? itemId;

  /// [warehousePlace] or a project's folder id.
  String from;
  String? to;
  String quantity;

  /// Manila calendar day ("2026-10-27"), never after today.
  String on;
  String? requestLineId;
  String unplannedReason;
  String note;

  /// Set for a return: the issue it brings goods back from.
  String? returnsRecord;

  bool get isReturn => returnsRecord != null;
  bool get toSite => !isReturn && to != null && to != warehousePlace;

  /// What the server will call it.
  String get kind => isReturn ? 'return' : (from == warehousePlace ? 'issue' : 'move');

  /// Problems the server would refuse, in the order a person fixes them.
  List<StockFailure> problems({required String today}) {
    final out = <StockFailure>[];
    if (itemId == null || itemId!.isEmpty) out.add(StockFailure.badItem);
    if (parseStockQty(quantity) == null) out.add(StockFailure.badQuantity);
    if (!_isDay(on) || on.compareTo(today) > 0) out.add(StockFailure.badDate);
    if (!isReturn) {
      if (to == null || from == to) out.add(StockFailure.badPlace);
      if (toSite && requestLineId == null && unplannedReason.trim().isEmpty) out.add(StockFailure.unplannedReasonRequired);
    }
    if (note.trim().length > 300 || unplannedReason.trim().length > 300) out.add(StockFailure.badNote);
    return out;
  }

  /// `stk_move(p_op, p_body)`'s body.
  Map<String, dynamic> body() {
    final b = <String, dynamic>{'item_id': itemId, 'quantity': qtyText(parseStockQty(quantity)!), 'on': on, 'note': note.trim()};
    if (isReturn) {
      b['returns_record'] = returnsRecord;
    } else {
      b['from'] = from;
      b['to'] = to;
      if (toSite) {
        if (requestLineId != null) {
          b['request_line_id'] = requestLineId;
        } else {
          b['unplanned_reason'] = unplannedReason.trim();
        }
      }
    }
    return b;
  }
}

/// "Received": part or all of a warehouse line, in the line's own unit.
class ReceiveForm {
  ReceiveForm({required this.line, this.quantity = '', required this.on, this.note = ''});

  final StockLine line;
  String quantity;
  String on;
  String note;

  List<StockFailure> problems({required String today}) {
    final out = <StockFailure>[];
    final q = parseStockQty(quantity);
    if (q == null) out.add(StockFailure.badQuantity);
    if (q != null && q > line.awaiting + 0.0005) out.add(StockFailure.moreThanAwaited);
    if (!_isDay(on) || on.compareTo(today) > 0) out.add(StockFailure.badDate);
    if (note.trim().length > 300) out.add(StockFailure.badNote);
    return out;
  }

  /// `stk_receive(p_op, p_purchase, p_line_no, p_qty, p_on, p_note)`.
  Map<String, dynamic> params(String opId) => {
        'p_op': opId,
        'p_purchase': line.purchaseId,
        'p_line_no': line.lineNo,
        'p_qty': qtyText(parseStockQty(quantity)!),
        'p_on': on,
        'p_note': note.trim(),
      };
}

/// Leftovers of a project purchase line, in the catalogue item's unit, left
/// at the project's site or brought to the warehouse (Q3).
class LeftoverForm {
  LeftoverForm({required this.line, this.quantity = '', this.where = 'site', required this.on, this.note = ''});

  final StockLine line;
  String quantity;

  /// 'site' or 'warehouse'.
  String where;
  String on;
  String note;

  List<StockFailure> problems({required String today}) {
    final out = <StockFailure>[];
    if (line.match == null) out.add(StockFailure.toMatch);
    final q = parseStockQty(quantity);
    if (q == null) out.add(StockFailure.badQuantity);
    if (q != null && line.match != null && q > line.leftoverRoom + 0.0005) out.add(StockFailure.moreThanBought);
    if (!_isDay(on) || on.compareTo(today) > 0) out.add(StockFailure.badDate);
    if (note.trim().length > 300) out.add(StockFailure.badNote);
    return out;
  }

  /// `stk_leftover(p_op, p_purchase, p_line_no, p_qty, p_where, p_on, p_note)`.
  Map<String, dynamic> params(String opId) => {
        'p_op': opId,
        'p_purchase': line.purchaseId,
        'p_line_no': line.lineNo,
        'p_qty': qtyText(parseStockQty(quantity)!),
        'p_where': where,
        'p_on': on,
        'p_note': note.trim(),
      };
}
```

**Create:** `lib/stock/domain/stock_models.dart`

```dart
/// What the stock server functions (0104, 0105) return, as the phone reads
/// it. QUANTITIES ONLY (Q26, Q28): no peso is read from any answer — a cost
/// move's value, which owner accounts are sent, is never parsed here.
library;

double _num(Object? v) => switch (v) {
      num n => n.toDouble(),
      String s => double.tryParse(s) ?? 0,
      _ => 0,
    };

String _str(Object? v) => v == null ? '' : v.toString();

DateTime? _time(Object? v) => v == null ? null : DateTime.tryParse(v.toString())?.toUtc();

List<Map<String, dynamic>> _rows(Object? v) => [for (final r in (v as List<dynamic>? ?? const [])) Map<String, dynamic>.from(r as Map)];

/// `stk_status()`: stock is usable here only when [enabled] (switched on AND
/// this account may record stock).
class StockStatus {
  const StockStatus({this.enabled = false, this.canRecord = false});

  factory StockStatus.fromJson(Map<String, dynamic> j) =>
      StockStatus(enabled: j['enabled'] == true, canRecord: j['can_record'] == true);

  final bool enabled;
  final bool canRecord;

  static const off = StockStatus();
}

/// A catalogue item stock can be recorded in (`stk_choices().items`).
class StockItemChoice {
  const StockItemChoice({required this.itemId, required this.name, this.spec = '', this.unit = ''});

  factory StockItemChoice.fromJson(Map<String, dynamic> j) =>
      StockItemChoice(itemId: _str(j['item_id']), name: _str(j['name']), spec: _str(j['spec']), unit: _str(j['unit']));

  final String itemId;
  final String name;
  final String spec;
  final String unit;

  /// "Cement — Portland (bag)".
  String get label => '$name${spec.trim().isEmpty ? '' : ' — $spec'} ($unit)';
}

/// A project (Main Contract or an Additional Works job) goods can go to.
class StockProject {
  const StockProject({required this.folderId, required this.name, this.main = true, this.completed = false});

  factory StockProject.fromJson(Map<String, dynamic> j) =>
      StockProject(folderId: _str(j['folder_id']), name: _str(j['name']), main: j['main'] != false, completed: j['completed'] == true);

  final String folderId;
  final String name;
  final bool main;

  /// Goods can still be recorded there (Q16); the cost move waits for the owner.
  final bool completed;

  String get label => completed ? '$name (completed)' : name;
}

class StockChoices {
  const StockChoices({this.items = const [], this.projects = const []});

  factory StockChoices.fromJson(Map<String, dynamic> j) => StockChoices(
        items: _rows(j['items']).map(StockItemChoice.fromJson).toList(),
        projects: _rows(j['projects']).map(StockProject.fromJson).toList(),
      );

  final List<StockItemChoice> items;
  final List<StockProject> projects;

  StockItemChoice? item(String? id) => items.where((i) => i.itemId == id).firstOrNull;

  /// Open projects first, then completed ones (marked), as the web lists them.
  List<StockProject> get projectsInOrder => [...projects.where((p) => !p.completed), ...projects.where((p) => p.completed)];
}

/// Where some of an item is, and how much.
class StockPlace {
  const StockPlace({required this.name, required this.kind, this.folderId, this.quantity = 0});

  factory StockPlace.fromJson(Map<String, dynamic> j) =>
      StockPlace(name: _str(j['name']), kind: _str(j['kind']), folderId: j['folder_id'] as String?, quantity: _num(j['quantity']));

  final String name;

  /// 'warehouse' or 'site'.
  final String kind;
  final String? folderId;
  final double quantity;

  bool get isWarehouse => kind == 'warehouse';
}

/// One item with stock somewhere (`stk_overview().items`).
class StockItem {
  const StockItem({required this.itemId, required this.name, this.spec = '', this.unit = '', this.total = 0, this.places = const []});

  factory StockItem.fromJson(Map<String, dynamic> j) => StockItem(
        itemId: _str(j['item_id']),
        name: _str(j['name']),
        spec: _str(j['spec']),
        unit: _str(j['unit']),
        total: _num(j['total']),
        places: _rows(j['places']).map(StockPlace.fromJson).toList(),
      );

  final String itemId;
  final String name;
  final String spec;
  final String unit;
  final double total;
  final List<StockPlace> places;

  double get inWarehouse => places.where((p) => p.isWarehouse).fold(0, (s, p) => s + p.quantity);

  /// How much is at one place: 'warehouse' or a project's folder id.
  double at(String place) => place == warehousePlace
      ? inWarehouse
      : places.where((p) => !p.isWarehouse && p.folderId == place).fold(0, (s, p) => s + p.quantity);
}

/// The warehouse as a place to pick, beside projects' folder ids.
const warehousePlace = 'warehouse';

/// A purchase line as stock sees it (0104 `stk_line_json`): a warehouse line
/// awaiting delivery, or a project line whose leftovers can be recorded.
class StockLine {
  const StockLine({
    required this.purchaseId,
    required this.lineNo,
    this.destination = '',
    this.folderId,
    this.folderName = '',
    this.itemName = '',
    this.unit = '',
    this.quantity = 0,
    this.purchaseDate = '',
    this.boughtByName = '',
    this.received = 0,
    this.notDelivered = 0,
    this.awaiting = 0,
    this.entered = 0,
    this.match,
  });

  factory StockLine.fromJson(Map<String, dynamic> j) => StockLine(
        purchaseId: _str(j['purchase_id']),
        lineNo: _num(j['line_no']).toInt(),
        destination: _str(j['destination']),
        folderId: j['folder_id'] as String?,
        folderName: _str(j['folder_name']),
        itemName: _str(j['item_name']),
        unit: _str(j['unit']),
        quantity: _num(j['quantity']),
        purchaseDate: _str(j['purchase_date']),
        boughtByName: _str(j['bought_by_name']),
        received: _num(j['received']),
        notDelivered: _num(j['not_delivered']),
        awaiting: _num(j['awaiting']),
        entered: _num(j['entered']),
        match: j['match'] == null ? null : StockMatch.fromJson(Map<String, dynamic>.from(j['match'] as Map)),
      );

  final String purchaseId;
  final int lineNo;
  final String destination;
  final String? folderId;
  final String folderName;
  final String itemName;

  /// The purchase line's own unit (receipts are counted in it, Q6).
  final String unit;
  final double quantity;
  final String purchaseDate;
  final String boughtByName;
  final double received;
  final double notDelivered;
  final double awaiting;

  /// Item units already entered as stock (leftovers, opening stock).
  final double entered;

  /// How the line counts as a catalogue item; null = the office matches it first.
  final StockMatch? match;

  String get key => '$purchaseId:$lineNo';

  /// Leftovers still recordable, in item units — never more than the line
  /// brought (MORE_THAN_BOUGHT), the same rounding as the server's.
  double get leftoverRoom {
    final m = match;
    if (m == null || m.per <= 0) return 0;
    final total = (quantity * m.covers / m.per * 1000).roundToDouble() / 1000;
    final room = ((total - entered) * 1000).roundToDouble() / 1000;
    return room < 0 ? 0 : room;
  }
}

class StockMatch {
  const StockMatch({required this.itemId, this.itemName = '', this.itemUnit = '', this.per = 1, this.covers = 1});

  factory StockMatch.fromJson(Map<String, dynamic> j) => StockMatch(
        itemId: _str(j['item_id']),
        itemName: _str(j['item_name']),
        itemUnit: _str(j['item_unit']),
        per: _num(j['per']),
        covers: _num(j['covers']),
      );

  final String itemId;
  final String itemName;
  final String itemUnit;
  final double per;
  final double covers;
}

/// A cost move's STATE under a record (0105) — never its value.
class StockCostState {
  const StockCostState({required this.kind, required this.status, this.reversed = false});

  factory StockCostState.fromJson(Map<String, dynamic> j) =>
      StockCostState(kind: _str(j['kind']), status: _str(j['status']), reversed: j['reversed'] == true);

  final String kind;
  final String status;
  final bool reversed;
}

/// One stock record (0104/0105 `stk_record_json`), quantities only.
class StockRecord {
  const StockRecord({
    required this.id,
    required this.kind,
    this.status = 'done',
    this.itemId,
    this.itemName = '',
    this.itemUnit = '',
    this.lineItem = '',
    this.lineUnit = '',
    this.fromName = '',
    this.toName = '',
    this.quantity = 0,
    this.bookQuantity,
    this.on = '',
    this.requestDescription = '',
    this.unplannedReason = '',
    this.reason = '',
    this.note = '',
    this.recordedBy = '',
    this.recordedByName = '',
    this.recordedAt,
    this.reversed = false,
    this.returnable = 0,
    this.costs = const [],
  });

  factory StockRecord.fromJson(Map<String, dynamic> j) => StockRecord(
        id: _str(j['id']),
        kind: _str(j['kind']),
        status: _str(j['status']),
        itemId: j['item_id'] as String?,
        itemName: _str(j['item_name']),
        itemUnit: _str(j['item_unit']),
        lineItem: _str(j['line_item']),
        lineUnit: _str(j['line_unit']),
        fromName: _str(j['from_name']),
        toName: _str(j['to_name']),
        quantity: _num(j['quantity']),
        bookQuantity: j['book_quantity'] == null ? null : _num(j['book_quantity']),
        on: _str(j['on']),
        requestDescription: _str(j['request_description']),
        unplannedReason: _str(j['unplanned_reason']),
        reason: _str(j['reason']),
        note: _str(j['note']),
        recordedBy: _str(j['recorded_by']),
        recordedByName: _str(j['recorded_by_name']),
        recordedAt: _time(j['recorded_at']),
        reversed: j['reversed'] == true,
        returnable: _num(j['returnable']),
        costs: _rows(j['costs']).map(StockCostState.fromJson).toList(),
      );

  final String id;

  /// receive, not_delivered, leftover, issue, return, move, count, opening.
  final String kind;
  final String status;
  final String? itemId;
  final String itemName;
  final String itemUnit;
  final String lineItem;
  final String lineUnit;
  final String fromName;
  final String toName;
  final double quantity;
  final double? bookQuantity;
  final String on;
  final String requestDescription;
  final String unplannedReason;
  final String reason;
  final String note;
  final String recordedBy;
  final String recordedByName;
  final DateTime? recordedAt;
  final bool reversed;

  /// An issue's quantity not yet returned (0 for anything else).
  final double returnable;
  final List<StockCostState> costs;

  /// Receipts are counted in the purchase line's unit, the rest in the item's.
  String get unit => kind == 'receive' || kind == 'not_delivered' ? lineUnit : itemUnit;
  String get what => itemName.isNotEmpty ? itemName : (lineItem.isNotEmpty ? lineItem : 'Item');
  bool get canReturn => kind == 'issue' && status == 'done' && !reversed && returnable > 0;
}

/// `stk_overview()`: the Stock screen in one read.
class StockOverview {
  const StockOverview({this.items = const [], this.awaiting = const [], this.recent = const []});

  factory StockOverview.fromJson(Map<String, dynamic> j) => StockOverview(
        items: _rows(j['items']).map(StockItem.fromJson).toList(),
        awaiting: _rows(j['awaiting']).map(StockLine.fromJson).toList(),
        recent: _rows(j['recent']).map(StockRecord.fromJson).toList(),
      );

  final List<StockItem> items;

  /// Warehouse lines awaiting delivery or a match.
  final List<StockLine> awaiting;

  /// The latest 50 records, newest first.
  final List<StockRecord> recent;

  StockItem? item(String? id) => items.where((i) => i.itemId == id).firstOrNull;
}

/// A request line goods going to a project can fill (`stk_request_lines`).
class StockRequestLine {
  const StockRequestLine({
    required this.lineId,
    this.description = '',
    this.spec = '',
    this.unit = '',
    this.catalogItemId,
    this.requesterName = '',
    this.stillToBuy = 0,
  });

  factory StockRequestLine.fromJson(Map<String, dynamic> j) => StockRequestLine(
        lineId: _str(j['line_id']),
        description: _str(j['description']),
        spec: _str(j['spec']),
        unit: _str(j['unit']),
        catalogItemId: j['catalog_item_id'] as String?,
        requesterName: _str(j['requester_name']),
        stillToBuy: _num(j['still_to_buy']),
      );

  final String lineId;
  final String description;
  final String spec;
  final String unit;
  final String? catalogItemId;
  final String requesterName;
  final double stillToBuy;

  /// The server's rule (ITEM_MISMATCH, UNIT_MISMATCH): the item's own request
  /// line, or one with no catalogue item, in the same unit.
  bool fits(StockItemChoice item) =>
      (catalogItemId == null || catalogItemId == item.itemId) && unit.trim().toLowerCase() == item.unit.trim().toLowerCase();
}
```

**Create:** `lib/stock/domain/stock_submission.dart`

```dart
import 'dart:convert';

/// The three stock writes the phone makes (R90), by their server function.
enum StockWrite {
  move('stk_move'),
  receive('stk_receive'),
  leftover('stk_leftover');

  const StockWrite(this.fn);
  final String fn;

  static StockWrite? byFn(String fn) => values.where((w) => w.fn == fn).firstOrNull;
}

/// One stock record sent from the phone (R101): its operation id and its
/// exact payload travel together and never change. It is kept on the phone
/// from the moment before it is first sent until the SERVER settles it — a
/// reply, a refusal of its first Send, or the server confirming the id was
/// recorded or is cancelled for good (R102).
class StockSubmission {
  const StockSubmission({
    required this.opId,
    required this.userId,
    required this.write,
    required this.payload,
    required this.summary,
    required this.createdAt,
    this.lastSentAt,
    this.sends = 0,
  });

  /// [params] are the server call's parameters, `p_op` included.
  factory StockSubmission.create({
    required String opId,
    required String userId,
    required StockWrite write,
    required Map<String, dynamic> params,
    required String summary,
    required DateTime now,
  }) {
    if (params['p_op'] != opId) throw ArgumentError('the payload carries its own operation id');
    return StockSubmission(opId: opId, userId: userId, write: write, payload: jsonEncode(params), summary: summary, createdAt: now);
  }

  static StockSubmission? fromJson(Map<String, dynamic> j) {
    final write = StockWrite.byFn(j['fn'] as String? ?? '');
    final opId = j['op_id'] as String?;
    final userId = j['user_id'] as String?;
    final payload = j['payload'] as String?;
    if (write == null || opId == null || userId == null || payload == null) return null;
    final params = jsonDecode(payload);
    if (params is! Map || params['p_op'] != opId) return null;
    return StockSubmission(
      opId: opId,
      userId: userId,
      write: write,
      payload: payload,
      summary: j['summary'] as String? ?? '',
      createdAt: DateTime.parse(j['created_at'] as String),
      lastSentAt: j['last_sent_at'] == null ? null : DateTime.parse(j['last_sent_at'] as String),
      sends: (j['sends'] as num?)?.toInt() ?? 0,
    );
  }

  final String opId;

  /// The account that sent it; nobody else sees, sends or checks it.
  final String userId;
  final StockWrite write;

  /// The exact parameters sent, as JSON text — every Send again decodes
  /// this, never the form.
  final String payload;

  /// What it was, in words, for the Stock tab ("Issued 4 bag Cement — …").
  final String summary;
  final DateTime createdAt;

  /// The last time it left the phone (set just before sending).
  final DateTime? lastSentAt;
  final int sends;

  Map<String, dynamic> get params => Map<String, dynamic>.from(jsonDecode(payload) as Map);

  StockSubmission sentAt(DateTime t) => StockSubmission(
        opId: opId,
        userId: userId,
        write: write,
        payload: payload,
        summary: summary,
        createdAt: createdAt,
        lastSentAt: t,
        sends: sends + 1,
      );

  Map<String, dynamic> toJson() => {
        'op_id': opId,
        'user_id': userId,
        'fn': write.fn,
        'payload': payload,
        'summary': summary,
        'created_at': createdAt.toUtc().toIso8601String(),
        'last_sent_at': lastSentAt?.toUtc().toIso8601String(),
        'sends': sends,
      };
}
```


- [ ] **Step 1: Apply the files above** in WorkMate (Create blocks as given; Modify blocks with `git apply --ignore-whitespace`).
- [ ] **Step 2: Tests.** `flutter analyze` → no issues. `flutter test` → **977** pass (935 before, plus `stock_domain_test.dart`'s 17 and `stock_submitter_test.dart`'s 25).
- [ ] **Step 3: Stop for the user** to review and commit.

### Task 3: WorkMate — the Stock tab, the forms, the shopping list, "From stock"; 0.9.0+1011

**Interfaces consumed:** Task 2's. **Produced:** `StockController(remote:)` (`status`, `overview`, `loading`, `loaded`, `failure`, `enabled`, `refresh()`), `StockScreen(controller:, submitter:, onRecorded:)`, `MoveScreen(remote:, submitter:, preset: MovePreset(...))`, `openMove(context, controller, submitter, preset)`, `ReceiveSheet(submitter:, line:)`, `LeftoverScreen(remote:, submitter:)`, `StockSending` (the locking Send), `UnresolvedBox`, `UnreadableBox`; `PurchasingServices.stock`, `PurchasingServices.stockStore`; `ShoppingListScreen.onIssueFromStock`.

<!-- Tests -->

**Modify:** `test/requests/detail/request_screens_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/requests/detail/request_screens_test.dart b/test/requests/detail/request_screens_test.dart
index 9b5eb2b..1b3a8b2 100644
--- a/test/requests/detail/request_screens_test.dart
+++ b/test/requests/detail/request_screens_test.dart
@@ -49,6 +49,17 @@ void main() {
     expect(find.textContaining('URGENT · by Wed 7 Oct'), findsOneWidget);
   });
 
+  testWidgets('2B-b: what the office sent from stock shows on the line; nothing while it is 0', (tester) async {
+    api.view = RequestsView(entries: [entry(requestDoc())]);
+    await showDetail(tester, 'r1');
+    expect(find.byKey(const Key('line-from-stock-l1')), findsNothing);
+    final doc = requestDoc();
+    (doc['lines'] as List).first['from_stock'] = 4;
+    api.view = RequestsView(entries: [entry(doc)]);
+    await showDetail(tester, 'r1');
+    expect(find.text('From stock: 4 pc · Galing sa stock'), findsOneWidget);
+  });
+
   testWidgets('the requester changes a quantity; it shows as pending sync', (tester) async {
     api.view = RequestsView(entries: [entry(requestDoc())]);
     await showDetail(tester, 'r1');
```

**Create:** `test/stock/stock_screens_test.dart`

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/profile/account_services.dart';
import 'package:workmate/purchasing/data/purchasing_api.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/purchasing_services.dart';
import 'package:workmate/purchasing/ui/buyer_shell.dart';
import 'package:workmate/stock/data/stock_pending_store.dart';
import 'package:workmate/stock/data/stock_submitter.dart';
import 'package:workmate/stock/domain/stock_failure.dart';
import 'package:workmate/stock/domain/stock_models.dart';
import 'package:workmate/stock/domain/stock_submission.dart';
import 'package:workmate/stock/ui/stock_controller.dart';
import 'package:workmate/stock/ui/stock_copy.dart';
import 'package:workmate/stock/ui/stock_screen.dart';
import 'package:workmate/ui/theme.dart';

import '../attendance/fakes.dart' show useTallPhone;
import '../purchasing/purchasing_api_fake.dart';
import '../purchasing/purchasing_fakes.dart' as pf;
import 'stock_fakes.dart';

Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: w);

const staff = WorkerProfile(id: 's1', email: 'staff@dacsbuilding.com', displayName: 'Ana Reyes', role: 'staff', status: 'active');
final account = AccountServices(changePassword: (_) async {}, termsAcceptedAt: () async => null);

/// A Cement line with 6 bags in the warehouse — what 0104 sends once stock is on.
ShoppingLine cementLine({double inWarehouse = 6, double fromStock = 0}) => ShoppingLine(
      lineId: 'l1',
      requestId: 'r1',
      description: 'Cement',
      unit: 'bag',
      projectId: 'f-barlin',
      projectName: 'Barlin Residence',
      workId: 'f-barlin',
      workName: 'Main Contract',
      requesterName: 'Juan',
      needed: 10,
      stillToBuy: 10 - fromStock,
      portions: [pf.portion('p1', buyer: 's1', mine: true, still: 10 - fromStock)],
      catalogItemId: 'item-cement',
      fromStock: fromStock,
      inWarehouse: inWarehouse,
      inWarehouseUnit: 'bag',
    );

const forSlab = StockRequestLine(lineId: 'l1', description: 'Cement', unit: 'bag', catalogItemId: 'item-cement', requesterName: 'Juan', stillToBuy: 10);

/// No peso anywhere: not the cost move's value (400) nor its estimate (412).
void expectNoPesos() {
  expect(find.textContaining('₱'), findsNothing);
  expect(find.textContaining('400'), findsNothing);
  expect(find.textContaining('412'), findsNothing);
}

Future<void> pick(WidgetTester tester, String dropdownKey, String text) async {
  await tester.ensureVisible(find.byKey(Key(dropdownKey)));
  await tester.tap(find.byKey(Key(dropdownKey)));
  await tester.pumpAndSettle();
  await tester.tap(find.text(text).last);
  await tester.pumpAndSettle();
}

/// The forms are lazily built lists: scroll the button into the built range first.
Future<void> press(WidgetTester tester, String key) async {
  final f = find.byKey(Key(key));
  if (f.evaluate().isEmpty) await tester.scrollUntilVisible(f, 300, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  late FakePurchasingApi api;
  late FakeStockRemote stock;

  setUp(() {
    // This week's cutoff must lie ahead of the real clock the shell reads.
    final liveWeek = PurBatch(id: 'b1', cutoffAt: DateTime.now().toUtc().add(const Duration(days: 3)), purchaseOn: '2026-10-26');
    api = FakePurchasingApi()..shopping = ShoppingView(lines: [cementLine()], batches: [liveWeek], fetchedAt: pf.wednesday);
    stock = FakeStockRemote(overview: sampleOverview(), choices: sampleChoices, requestLines: {'f-barlin': [forSlab]});
  });

  Future<void> openShell(WidgetTester tester) async {
    useTallPhone(tester);
    await tester.pumpWidget(wrap(BuyerShell(
      buyer: staff,
      versionName: '0.9.0',
      onSignOut: () async {},
      account: account,
      purchasing: PurchasingServices(api: api, stock: stock, stockStore: MemoryStockPendingStore()),
    )));
    await tester.pumpAndSettle();
  }

  group('the Stock tab follows the server switch', () {
    testWidgets('stock off: no Stock tab, no Issue from stock, the overview is never read', (tester) async {
      stock.statusAnswer = StockStatus.off;
      await openShell(tester);
      expect(stock.statusCalls, greaterThan(0));
      expect(stock.overviewCalls, 0);
      expect(find.byKey(const Key('tab-stock')), findsNothing);
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing, reason: 'even if a line says something is in the warehouse');
      expect(find.text('Shopping list'), findsWidgets);
    });

    testWidgets('no stock server at all (older services): the shell is as before', (tester) async {
      useTallPhone(tester);
      await tester.pumpWidget(wrap(BuyerShell(
        buyer: staff,
        versionName: '0.9.0',
        onSignOut: () async {},
        account: account,
        purchasing: PurchasingServices(api: api),
      )));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tab-stock')), findsNothing);
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing);
    });

    testWidgets('stock on: the tab shows quantities per place, and never a peso', (tester) async {
      await openShell(tester);
      expect(find.byKey(const Key('tab-stock')), findsOneWidget);
      await tester.tap(find.text('Stock').last);
      await tester.pumpAndSettle();
      expect(find.text('Cement · Portland'), findsOneWidget);
      expect(find.text('14 bag in all'), findsOneWidget);
      expect(find.text('10 bag'), findsOneWidget);
      expect(find.text('4 bag'), findsOneWidget);
      expect(find.byKey(const Key('record-unplanned')), findsNothing, reason: 'Record purchase stays on the buying tabs');
      expectNoPesos();
    });

    testWidgets('switched off while away: on resume the tab goes and the shopping list shows', (tester) async {
      await openShell(tester);
      await tester.tap(find.text('Stock').last);
      await tester.pumpAndSettle();
      stock.statusAnswer = StockStatus.off;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tab-stock')), findsNothing);
      expect(find.text('Mga bibilhin'), findsOneWidget);
    });

    testWidgets('no signal: the notice says so and the last answer stays', (tester) async {
      await openShell(tester);
      await tester.tap(find.text('Stock').last);
      await tester.pumpAndSettle();
      stock.failReads = const SocketException('offline');
      await tester.tap(find.text('Stock').last);
      await tester.pumpAndSettle();
      expect(find.text(stockNeedsSignal.english), findsOneWidget);
      expect(find.text(stockNeedsSignal.tagalog), findsOneWidget);
      expect(find.text('Cement · Portland'), findsOneWidget);
      expect(find.byKey(const Key('tab-stock')), findsOneWidget, reason: 'no signal is not "stock off"');
    });
  });

  group('shopping list', () {
    testWidgets('shows From stock and the warehouse hint', (tester) async {
      api.shopping = ShoppingView(lines: [cementLine(fromStock: 4)], batches: api.shopping.batches, fetchedAt: pf.wednesday);
      await openShell(tester);
      expect(find.byKey(const Key('from-stock-p1')), findsOneWidget);
      expect(find.text('4 bag'), findsOneWidget);
      expect(find.text(fromStockLabel.english), findsOneWidget);
      expect(find.text('In warehouse: 6 bag'), findsOneWidget);
    });

    testWidgets('Issue from stock: item, place and request fixed; starts at the smaller of warehouse and still to buy', (tester) async {
      await openShell(tester);
      final before = api.calls.where((c) => c == 'shoppingList').length;
      await press(tester, 'issue-stock-p1');
      expect(find.text('Issue from stock'), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const Key('move-qty'))).controller!.text, '6');
      expect(find.byKey(const Key('move-reason')), findsNothing, reason: 'it fills the request line');
      await press(tester, 'move-send');
      final (fn, params, userId) = stock.writes.single;
      expect(fn, 'stk_move');
      expect(userId, 's1');
      expect(params['p_body'], {
        'item_id': 'item-cement',
        'quantity': '6',
        'on': params['p_body']['on'],
        'note': '',
        'from': 'warehouse',
        'to': 'f-barlin',
        'request_line_id': 'l1',
      });
      expect(find.byKey(const Key('stock-recorded')), findsOneWidget);
      expect(api.calls.where((c) => c == 'shoppingList').length, greaterThan(before));
    });

    testWidgets('the button needs stock in the warehouse and the right to record', (tester) async {
      api.shopping = ShoppingView(lines: [cementLine(inWarehouse: 0)], batches: api.shopping.batches, fetchedAt: pf.wednesday);
      await openShell(tester);
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing);
    });

    testWidgets('an account that may not record stock sees the hint, no button', (tester) async {
      stock.statusAnswer = const StockStatus(enabled: true, canRecord: false);
      await openShell(tester);
      expect(find.text('In warehouse: 6 bag'), findsOneWidget);
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing);
    });
  });

  group('recording on the Stock screen', () {
    late StockController controller;
    late StockSubmitter submitter;
    late DateTime clock;
    var recorded = 0;

    Future<void> openStock(WidgetTester tester) async {
      useTallPhone(tester);
      recorded = 0;
      clock = DateTime.utc(2026, 10, 27, 2);
      controller = StockController(remote: stock);
      await controller.refresh();
      submitter = StockSubmitter(remote: stock, store: MemoryStockPendingStore(), now: () => clock);
      await submitter.load('s1');
      await tester.pumpWidget(wrap(Scaffold(body: StockScreen(controller: controller, submitter: submitter, onRecorded: () => recorded++))));
      await tester.pumpAndSettle();
    }

    testWidgets('read-only account: no Issue, Received or Return', (tester) async {
      stock.statusAnswer = const StockStatus(enabled: true, canRecord: false);
      await openStock(tester);
      expect(find.byKey(const Key('stock-issue')), findsNothing);
      expect(find.byKey(const Key('stock-leftovers')), findsNothing);
      await tester.tap(find.text('To receive (2)'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('receive-p-1:1')), findsNothing);
      await tester.tap(find.text('Recent'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('return-r-issue')), findsNothing);
    });

    testWidgets('Received: part of a line, checked against what is still awaited', (tester) async {
      await openStock(tester);
      await tester.tap(find.text('To receive (2)'));
      await tester.pumpAndSettle();
      expect(find.text('Not matched yet'), findsOneWidget, reason: 'the Wire box line');
      await press(tester, 'receive-p-1:1');
      expect(tester.widget<TextField>(find.byKey(const Key('receive-qty'))).controller!.text, '8');
      await tester.enterText(find.byKey(const Key('receive-qty')), '9');
      await press(tester, 'receive-send');
      expect(find.text(stockFailureCopy(StockFailure.moreThanAwaited).english), findsOneWidget);
      expect(stock.writes, isEmpty);
      await tester.enterText(find.byKey(const Key('receive-qty')), '5');
      await press(tester, 'receive-send');
      final (fn, params, _) = stock.writes.single;
      expect(fn, 'stk_receive');
      expect(params['p_purchase'], 'p-1');
      expect(params['p_line_no'], 1);
      expect(params['p_qty'], '5');
      expect(recorded, 1);
      expect(find.byKey(const Key('receive-qty')), findsNothing, reason: 'the sheet closed');
    });

    testWidgets('an unmatched line can still be received (it becomes stock once matched)', (tester) async {
      await openStock(tester);
      await tester.tap(find.text('To receive (2)'));
      await tester.pumpAndSettle();
      await press(tester, 'receive-p-2:1');
      expect(find.text(notMatchedYet.english), findsOneWidget);
      await press(tester, 'receive-send');
      expect(stock.writes.single.$2['p_qty'], '3');
    });

    testWidgets('Recent: cost states without values; Return brings the issue back', (tester) async {
      await openStock(tester);
      await tester.tap(find.text('Recent'));
      await tester.pumpAndSettle();
      expect(find.text('Cost assignment pending'), findsOneWidget);
      expect(find.text('For: Cement for slab'), findsOneWidget);
      expect(find.byKey(const Key('record-r-old')), findsOneWidget);
      expect(find.byKey(const Key('return-r-old')), findsNothing, reason: 'all of it already came back');
      expectNoPesos();
      await press(tester, 'return-r-issue');
      expect(find.text('Return to the warehouse'), findsOneWidget);
      expect(find.byKey(const Key('move-to')), findsNothing);
      await press(tester, 'move-send');
      final body = stock.writes.single.$2['p_body'] as Map<String, dynamic>;
      expect(body['returns_record'], 'r-issue');
      expect(body['quantity'], '4');
      expect(body.containsKey('from'), isFalse);
      expect(body.containsKey('to'), isFalse);
    });

    testWidgets('unplanned issue needs a reason; a request line of another item is not offered', (tester) async {
      stock.requestLinesAnswer = {
        'f-sulit': [const StockRequestLine(lineId: 'l-wire', description: 'Tie wire', unit: 'piece', catalogItemId: 'item-wire')],
      };
      await openStock(tester);
      await press(tester, 'stock-issue');
      await pick(tester, 'move-item', cement.label);
      await pick(tester, 'move-to', 'Sulit');
      await tester.tap(find.byKey(const Key('move-request')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Tie wire —'), findsNothing);
      await tester.tap(find.text('None — unplanned').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('move-qty')), '2');
      await press(tester, 'move-send');
      expect(find.text(stockFailureCopy(StockFailure.unplannedReasonRequired).english), findsOneWidget);
      expect(stock.attempts, isEmpty);
      await tester.enterText(find.byKey(const Key('move-reason')), 'Extra for the gate');
      await press(tester, 'move-send');
      final body = stock.writes.single.$2['p_body'] as Map<String, dynamic>;
      expect(body['to'], 'f-sulit');
      expect(body['unplanned_reason'], 'Extra for the gate');
      expect(body.containsKey('request_line_id'), isFalse);
    });

    /// An issue of 3 bag to Barlin for the Cement request, whose answer is lost.
    Future<void> issueLost(WidgetTester tester, {bool recorded = false}) async {
      await press(tester, 'stock-issue');
      await pick(tester, 'move-item', cement.label);
      await pick(tester, 'move-to', 'Barlin Residence');
      await pick(tester, 'move-request', 'Cement — Juan · 10 bag still needed');
      await tester.enterText(find.byKey(const Key('move-qty')), '3');
      if (recorded) {
        stock.loseNextAnswer = TimeoutException('lost after it was recorded');
      } else {
        stock.failNextWrite = const SocketException('lost');
      }
      await press(tester, 'move-send');
    }

    /// Whether a field takes input — scrolled back into the built part of the form first.
    Future<bool> fieldOn(WidgetTester tester, String key) async {
      final f = find.byKey(Key(key));
      if (f.evaluate().isEmpty) await tester.scrollUntilVisible(f, -300, scrollable: find.byType(Scrollable).first);
      return tester.widget<TextField>(f).enabled ?? true;
    }

    testWidgets('a lost answer locks the form: nothing can change; Send again sends the saved payload unchanged', (tester) async {
      await openStock(tester);
      await issueLost(tester);
      expect(find.text(notSureLabel.english), findsOneWidget);
      expect(find.text(stockFailureCopy(StockFailure.noConnection).english), findsOneWidget);
      expect(find.text('Issue or move'), findsOneWidget, reason: 'the form stays, locked');
      expect([await fieldOn(tester, 'move-qty'), await fieldOn(tester, 'move-note')], [false, false], reason: 'the quantity cannot be changed');
      expect(tester.widget<DropdownButtonFormField<String>>(find.byKey(const Key('move-to'))).onChanged, isNull);
      expect(find.byKey(const Key('move-send')), findsNothing, reason: 'no Send of the form — only Send again, Check or Cancel');
      expect(find.text(cancelChangeLabel.english), findsOneWidget, reason: 'a change goes through the server\'s cancel');
      await press(tester, 'unsure-send-again');
      expect(stock.attempts, hasLength(2));
      expect(stock.attempts[1], stock.attempts[0], reason: 'the same operation id and the same payload, byte for byte');
      expect(stock.writes.single.$2['p_body']['quantity'], '3');
      expect(find.text('Issue or move'), findsNothing, reason: 'recorded: the form closed');
      expect(recorded, 1);
      expect(submitter.unresolved, isEmpty);
    });

    testWidgets('a changed quantity after a timeout: only once the server cancels the id — then it is a new operation, and the late original is refused', (tester) async {
      await openStock(tester);
      await issueLost(tester);
      final first = stock.attempts.single;
      await press(tester, 'unsure-check');
      expect(find.text(notYetCopy.english), findsOneWidget, reason: 'the server has neither');
      expect(await fieldOn(tester, 'move-qty'), isFalse, reason: 'a check never unlocks it');
      clock = clock.add(const Duration(hours: 5));
      await press(tester, 'unsure-check');
      expect(await fieldOn(tester, 'move-qty'), isFalse, reason: 'no clock unlocks it either');
      await press(tester, 'unsure-cancel');
      expect(stock.cancelled, {'s1:${first.$1}'}, reason: 'the server cancelled the id for good');
      expect(find.text(stockFailureCopy(StockFailure.opCancelled).english), findsOneWidget);
      expect(await fieldOn(tester, 'move-qty'), isTrue, reason: 'now it may be changed');
      expect(submitter.unresolved, isEmpty);
      await tester.enterText(find.byKey(const Key('move-qty')), '5');
      await press(tester, 'move-send');
      expect(stock.writes.single.$2['p_body']['quantity'], '5');
      expect(stock.writes.single.$2['p_op'], isNot(first.$1), reason: 'a changed payload never travels under the old id');
      // The first request, held up on the network, arrives now.
      await expectLater(stock.write(StockWrite.move, jsonDecode(first.$2) as Map<String, dynamic>, userId: 's1'), throwsA(anything));
      expect(stock.writes.map((w) => w.$2['p_body']['quantity']), ['5'], reason: 'only the new submission is recorded');
    });

    testWidgets('Cancel it and change, when the server finds it was recorded: the form closes as recorded — nothing changes', (tester) async {
      await openStock(tester);
      await issueLost(tester, recorded: true);
      await press(tester, 'unsure-cancel');
      expect(find.text('Issue or move'), findsNothing);
      expect([stock.writes.length, stock.cancelled.length], [1, 0]);
      expect(stock.writes.single.$2['p_body']['quantity'], '3');
      expect(recorded, 1);
    });

    testWidgets('Cancel with no signal: nothing known, the form stays locked', (tester) async {
      await openStock(tester);
      await issueLost(tester);
      stock.failReads = const SocketException('offline');
      await press(tester, 'unsure-cancel');
      expect(await fieldOn(tester, 'move-qty'), isFalse);
      expect(find.text(stockFailureCopy(StockFailure.noConnection).english), findsOneWidget);
      expect(stock.cancelled, isEmpty);
    });

    testWidgets('a lost answer that was in fact recorded: Check finds it — nothing sent again, recorded once', (tester) async {
      await openStock(tester);
      await issueLost(tester, recorded: true);
      await press(tester, 'unsure-check');
      expect(find.text('Issue or move'), findsNothing);
      expect([stock.attempts.length, stock.writes.length, stock.checks], [1, 1, 1]);
      expect(find.byKey(const Key('stock-recorded')), findsOneWidget);
    });

    testWidgets('closing the form keeps it: the Stock tab shows it, nothing new starts, Send again from there', (tester) async {
      await openStock(tester);
      await issueLost(tester);
      await tester.pageBack();
      await tester.pumpAndSettle();
      final op = stock.attempts.single.$1;
      expect(find.byKey(Key('unsure-$op')), findsOneWidget);
      expect(find.text('Issued 3 bag Cement — Warehouse → Barlin Residence'), findsOneWidget);
      expect(find.byKey(const Key('stock-issue')), findsNothing, reason: 'no new submission until it is resolved');
      expect(find.byKey(const Key('stock-finish-first')), findsOneWidget);
      await tester.tap(find.text('To receive (2)'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('receive-p-1:1')), findsNothing);
      await tester.tap(find.descendant(of: find.byKey(const Key('stock-parts')), matching: find.text('Stock')));
      await tester.pumpAndSettle();
      await press(tester, 'unsure-send-again');
      expect(stock.attempts[1], stock.attempts[0]);
      expect(find.byKey(Key('unsure-$op')), findsNothing);
      expect(find.byKey(const Key('stock-issue')), findsOneWidget);
      expect(recorded, 1);
    });

    testWidgets('a refusal is explained and nothing is recorded', (tester) async {
      await openStock(tester);
      await press(tester, 'stock-issue');
      await pick(tester, 'move-item', cement.label);
      await pick(tester, 'move-to', 'Barlin Residence');
      await tester.enterText(find.byKey(const Key('move-qty')), '30');
      await pick(tester, 'move-request', 'Cement — Juan · 10 bag still needed');
      stock.failNextWrite = pf.refusal('NOT_ENOUGH');
      await press(tester, 'move-send');
      expect(find.text(stockFailureCopy(StockFailure.notEnough).english), findsOneWidget);
      expect(stock.writes, isEmpty);
      expect(recorded, 0);
    });

    testWidgets('leftovers: a project purchase, at the site or brought to the warehouse', (tester) async {
      stock.projectLinesAnswer = {
        'f-barlin': [
          StockLine.fromJson(const {
            'purchase_id': 'p-9', 'line_no': 2, 'destination': 'project', 'folder_id': 'f-barlin', 'item_name': 'Cement',
            'unit': 'bag', 'quantity': 20, 'purchase_date': '2026-10-22', 'entered': 5,
            'match': {'item_id': 'item-cement', 'item_name': 'Cement', 'item_unit': 'bag', 'per': 1, 'covers': 1},
          }),
        ],
      };
      await openStock(tester);
      await press(tester, 'stock-leftovers');
      await pick(tester, 'leftover-project', 'Barlin Residence');
      expect(find.textContaining('up to 15 bag can be recorded'), findsOneWidget);
      await tester.tap(find.byKey(const Key('leftover-line-p-9:2')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('leftover-qty')), '16');
      await press(tester, 'leftover-send');
      expect(find.text(stockFailureCopy(StockFailure.moreThanBought).english), findsOneWidget);
      await tester.enterText(find.byKey(const Key('leftover-qty')), '3');
      await tester.tap(find.text('Brought to the warehouse'));
      await tester.pumpAndSettle();
      await press(tester, 'leftover-send');
      final (fn, params, _) = stock.writes.single;
      expect(fn, 'stk_leftover');
      expect(params['p_purchase'], 'p-9');
      expect(params['p_line_no'], 2);
      expect(params['p_qty'], '3');
      expect(params['p_where'], 'warehouse');
      expect(recorded, 1);
    });
  });

  group('a record whose answer was lost survives reopening and a restart (R101)', () {
    Future<void> openWith(WidgetTester tester, StockPendingStore store, {WorkerProfile buyer = staff}) async {
      useTallPhone(tester);
      await tester.pumpWidget(wrap(BuyerShell(
        buyer: buyer,
        versionName: '0.9.0',
        onSignOut: () async {},
        account: account,
        purchasing: PurchasingServices(api: api, stock: stock, stockStore: store),
      )));
      await tester.pumpAndSettle();
    }

    /// Issue from stock (6 bag) whose answer is lost; then the app closes and
    /// the phone's settings are read afresh from what was written.
    Future<void> lostThenClosed(WidgetTester tester, {bool recorded = false}) async {
      SharedPreferences.setMockInitialValues({});
      await openWith(tester, PrefsStockPendingStore(await SharedPreferences.getInstance()));
      if (recorded) {
        stock.loseNextAnswer = TimeoutException('lost after it was recorded');
      } else {
        stock.failNextWrite = const SocketException('lost');
      }
      await press(tester, 'issue-stock-p1');
      await press(tester, 'move-send');
      expect(find.text(notSureLabel.english), findsOneWidget);
      final raw = (await SharedPreferences.getInstance()).getString(PrefsStockPendingStore.key)!;
      await tester.pumpWidget(const SizedBox());
      // ignore: invalid_use_of_visible_for_testing_member
      SharedPreferences.resetStatic();
      SharedPreferences.setMockInitialValues({PrefsStockPendingStore.key: raw});
    }

    testWidgets('closed, then opened again: the shell keeps the Stock tab for it (even switched off) and hides Issue from stock', (tester) async {
      await openWith(tester, MemoryStockPendingStore());
      stock.failNextWrite = const SocketException('lost');
      await press(tester, 'issue-stock-p1');
      await press(tester, 'move-send');
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing, reason: 'nothing new until it is resolved');
      stock.statusAnswer = StockStatus.off;
      await tester.tap(find.text('My purchases'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Shopping list').last);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tab-stock')), findsOneWidget, reason: 'switched off, but it must still be resolved');
      await tester.tap(find.byKey(const Key('tab-stock')));
      await tester.pumpAndSettle();
      final op = stock.attempts.single.$1;
      expect(find.byKey(Key('unsure-$op')), findsOneWidget);
      stock.statusAnswer = const StockStatus(enabled: true, canRecord: true);
      await press(tester, 'unsure-send-again');
      expect(stock.attempts[1], stock.attempts[0]);
      expect(stock.writes, hasLength(1));
    });

    testWidgets('after a restart with no signal: it is still there and nothing is sent by itself', (tester) async {
      await lostThenClosed(tester);
      stock.failReads = const SocketException('offline');
      await openWith(tester, PrefsStockPendingStore(await SharedPreferences.getInstance()));
      expect(stock.attempts, hasLength(1), reason: 'never sent by itself');
      expect(find.byKey(const Key('tab-stock')), findsOneWidget);
      await tester.tap(find.byKey(const Key('tab-stock')));
      await tester.pumpAndSettle();
      expect(find.text('Issued 6 bag Cement — Warehouse → Barlin Residence'), findsOneWidget);
      expect(stock.attempts, hasLength(1));
      // Signal back: Send again, by hand, sends the saved payload unchanged.
      stock.failReads = null;
      await press(tester, 'unsure-send-again');
      expect(stock.attempts, hasLength(2));
      expect(stock.attempts[1], stock.attempts[0]);
      expect(stock.writes.single.$2['p_body']['quantity'], '6');
      expect(find.byKey(Key('unsure-${stock.attempts[0].$1}')), findsNothing);
    });

    testWidgets('after a restart with signal: a check (read only) finds it was recorded — it goes, never sent again', (tester) async {
      await lostThenClosed(tester, recorded: true);
      await openWith(tester, PrefsStockPendingStore(await SharedPreferences.getInstance()));
      expect(stock.checks, greaterThan(0));
      expect([stock.attempts.length, stock.writes.length], [1, 1]);
      expect(find.byKey(const Key('issue-stock-p1')), findsOneWidget, reason: 'resolved: new records may start');
      expect((await SharedPreferences.getInstance()).getString(PrefsStockPendingStore.key), '[]');
    });

    testWidgets('after a restart, Cancel it on the Stock tab: the server cancels the id, the card goes, new records start; the late original is refused', (tester) async {
      await lostThenClosed(tester);
      await openWith(tester, PrefsStockPendingStore(await SharedPreferences.getInstance()));
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing);
      await tester.tap(find.byKey(const Key('tab-stock')));
      await tester.pumpAndSettle();
      final original = stock.attempts.single;
      await press(tester, 'unsure-cancel');
      expect(find.byKey(Key('unsure-${original.$1}')), findsNothing);
      expect(find.byKey(const Key('stock-refused')), findsOneWidget, reason: 'says it was cancelled and nothing recorded');
      expect((await SharedPreferences.getInstance()).getString(PrefsStockPendingStore.key), '[]');
      await tester.tap(find.text('Shopping list').last);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('issue-stock-p1')), findsOneWidget, reason: 'settled: new records may start');
      await expectLater(stock.write(StockWrite.move, jsonDecode(original.$2) as Map<String, dynamic>, userId: 's1'), throwsA(anything));
      expect(stock.writes, isEmpty, reason: 'the late original records nothing');
    });

    testWidgets('a damaged saved record: the Stock tab offers Check and Cancel (no Send again); nothing new starts; Cancel settles it', (tester) async {
      const me = WorkerProfile(id: 'aaaaaaaa-0000-4000-8000-0000000000a1', email: 'staff@dacsbuilding.com', displayName: 'Ana Reyes', role: 'staff', status: 'active');
      const op = '11111111-0000-4000-8000-0000000000a1';
      const raw = '[{"op_id":"$op","user_id":"${'aaaaaaaa-0000-4000-8000-0000000000a1'}","fn":"stk_move","payload":"not json"}]';
      // ignore: invalid_use_of_visible_for_testing_member
      SharedPreferences.resetStatic();
      SharedPreferences.setMockInitialValues({PrefsStockPendingStore.key: raw});
      final prefs = await SharedPreferences.getInstance();
      await openWith(tester, PrefsStockPendingStore(prefs), buyer: me);
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing, reason: 'malformed data never unblocks a new send');
      await tester.tap(find.byKey(const Key('tab-stock')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('unreadable-$op')), findsOneWidget);
      expect(find.text(unreadableLabel.english), findsOneWidget);
      expect(find.byKey(const Key('unsure-send-again')), findsNothing, reason: 'its payload is never rebuilt');
      expect(find.byKey(const Key('stock-issue')), findsNothing);
      expect(prefs.getString(PrefsStockPendingStore.key), raw, reason: 'opening and checking keep it');
      await press(tester, 'unreadable-cancel');
      expect(stock.cancelled, {'${me.id}:$op'});
      expect(find.byKey(const Key('unreadable-$op')), findsNothing);
      expect(prefs.getString(PrefsStockPendingStore.key), '[]');
      expect(find.byKey(const Key('stock-issue')), findsOneWidget, reason: 'settled by the server: stock records start again');
      expect(stock.attempts, isEmpty);
    });

    testWidgets('a damaged saved record with no signal: Cancel changes nothing — it stays, still blocking', (tester) async {
      const me = WorkerProfile(id: 'aaaaaaaa-0000-4000-8000-0000000000a2', email: 'staff@dacsbuilding.com', displayName: 'Ana Reyes', role: 'staff', status: 'active');
      const op = '11111111-0000-4000-8000-0000000000a2';
      const raw = '[{"op_id":"$op","user_id":"aaaaaaaa-0000-4000-8000-0000000000a2","fn":"stk_move","payload":"not json"}]';
      // ignore: invalid_use_of_visible_for_testing_member
      SharedPreferences.resetStatic();
      SharedPreferences.setMockInitialValues({PrefsStockPendingStore.key: raw});
      final prefs = await SharedPreferences.getInstance();
      await openWith(tester, PrefsStockPendingStore(prefs), buyer: me);
      await tester.tap(find.byKey(const Key('tab-stock')));
      await tester.pumpAndSettle();
      stock.failReads = const SocketException('offline');
      await press(tester, 'unreadable-cancel');
      expect(find.byKey(const Key('unreadable-$op')), findsOneWidget, reason: 'no answer from the server: it stays');
      expect(find.text(stockFailureCopy(StockFailure.noConnection).english), findsOneWidget);
      expect(find.byKey(const Key('stock-refused')), findsNothing, reason: 'never reported as cancelled');
      expect([stock.cancelled, prefs.getString(PrefsStockPendingStore.key)], [isEmpty, raw]);
      expect(find.byKey(const Key('stock-issue')), findsNothing, reason: 'still blocking');
    });

    testWidgets('damaged storage: a recovery error, nothing can start, and the stored text is never touched', (tester) async {
      // ignore: invalid_use_of_visible_for_testing_member
      SharedPreferences.resetStatic();
      SharedPreferences.setMockInitialValues({PrefsStockPendingStore.key: 'not json'});
      final prefs = await SharedPreferences.getInstance();
      await openWith(tester, PrefsStockPendingStore(prefs));
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing);
      await tester.tap(find.byKey(const Key('tab-stock')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stock-recovery')), findsOneWidget);
      expect(find.text(recoveryLabel.english), findsOneWidget);
      expect(find.byKey(const Key('stock-issue')), findsNothing);
      expect(find.byKey(const Key('stock-leftovers')), findsNothing);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(prefs.getString(PrefsStockPendingStore.key), 'not json');
      expect(stock.attempts, isEmpty);
    });

    testWidgets('a stock server with no store on the phone: no Stock tab at all (never kept in memory alone)', (tester) async {
      useTallPhone(tester);
      await tester.pumpWidget(wrap(BuyerShell(
        buyer: staff,
        versionName: '0.9.0',
        onSignOut: () async {},
        account: account,
        purchasing: PurchasingServices(api: api, stock: stock),
      )));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tab-stock')), findsNothing);
      expect(find.byKey(const Key('issue-stock-p1')), findsNothing);
    });

    testWidgets('after a restart, another account on the same phone neither sees nor sends it', (tester) async {
      await lostThenClosed(tester);
      await openWith(tester, PrefsStockPendingStore(await SharedPreferences.getInstance()),
          buyer: const WorkerProfile(id: 's2', email: 'other@dacsbuilding.com', displayName: 'Ben Cruz', role: 'staff', status: 'active'));
      expect(find.byKey(const Key('issue-stock-p1')), findsOneWidget, reason: 'not held back by someone else\'s');
      await tester.tap(find.byKey(const Key('tab-stock')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Issued 6 bag'), findsNothing);
      expect(stock.attempts, hasLength(1));
      expect(stock.checks, 0, reason: 'never checked as another account');
    });
  });

  group('StockController', () {
    test('stock off: the overview is not read', () async {
      stock.statusAnswer = StockStatus.off;
      final c = StockController(remote: stock);
      await c.refresh();
      expect(c.enabled, isFalse);
      expect(stock.overviewCalls, 0);
      expect(c.overview.items, isEmpty);
    });

    test('a failed refresh keeps the last answer and says why', () async {
      final c = StockController(remote: stock);
      await c.refresh();
      stock.failReads = const SocketException('offline');
      await c.refresh();
      expect(c.failure, StockFailure.noConnection);
      expect(c.enabled, isTrue);
      expect(c.overview.items, hasLength(1));
      expect(c.loading, isFalse);
    });

    test('an older refresh answering last changes nothing', () async {
      final c = StockController(remote: stock);
      final first = c.refresh();
      stock.statusAnswer = StockStatus.off;
      final second = c.refresh();
      await Future.wait([first, second]);
      expect(c.enabled, isFalse);
    });

    test('a refresh after dispose is ignored', () async {
      final c = StockController(remote: stock);
      final f = c.refresh();
      c.dispose();
      await f;
      expect(c.loaded, isFalse);
    });
  });
}
```

<!-- Code -->

**Modify:** `lib/main.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/main.dart b/lib/main.dart
index 98ce936..1ac60df 100644
--- a/lib/main.dart
+++ b/lib/main.dart
@@ -47,6 +47,8 @@ import 'requests/data/request_remote.dart';
 import 'requests/data/request_repository.dart';
 import 'requests/data/requests_db.dart';
 import 'requests/requests_services.dart';
+import 'stock/data/stock_pending_store.dart';
+import 'stock/data/stock_remote.dart';
 import 'terms/terms_repository.dart';
 import 'update/apk_installer.dart';
 import 'update/app_update_repository.dart';
@@ -274,7 +276,12 @@ Future<void> main() async {
     final wipe = PurchasingAccountWipe(repo);
     controller.addListener(() => wipe.onAppState(controller.state));
     wipe.onAppState(controller.state);
-    purchasing = PurchasingServices(api: repo, changed: queueSettled);
+    purchasing = PurchasingServices(
+      api: repo,
+      changed: queueSettled,
+      stock: SupabaseStockRemote(client),
+      stockStore: PrefsStockPendingStore(prefs),
+    );
   } catch (e) {
     debugPrint('Buying unavailable: $e');
   }
```

**Modify:** `lib/purchasing/list/shopping_list_screen.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/list/shopping_list_screen.dart b/lib/purchasing/list/shopping_list_screen.dart
index 2e1d2f4..ea86d90 100644
--- a/lib/purchasing/list/shopping_list_screen.dart
+++ b/lib/purchasing/list/shopping_list_screen.dart
@@ -3,6 +3,7 @@ import 'package:flutter/material.dart';
 import '../../attendance/ui/attendance_copy.dart' show Bilingual;
 import '../../attendance/ui/formats.dart';
 import '../../requests/domain/quantity.dart';
+import '../../stock/ui/stock_copy.dart' show fromStockLabel, issueFromStockLabel;
 import '../../ui/failure_notice.dart';
 import '../../ui/theme.dart';
 import '../domain/purchase_draft.dart';
@@ -12,13 +13,17 @@ import 'shopping_controller.dart';
 /// The shopping list on the phone (Q4–Q6). Quantities and names only: the
 /// prices of earlier purchases are never shown here.
 class ShoppingListScreen extends StatelessWidget {
-  const ShoppingListScreen({super.key, required this.controller, this.onRecord});
+  const ShoppingListScreen({super.key, required this.controller, this.onRecord, this.onIssueFromStock});
 
   final ShoppingController controller;
 
   /// Opens Record purchase with these lines; null hides the picking.
   final void Function(List<DraftPurchaseLine> lines)? onRecord;
 
+  /// 2B-b: opens Issue from stock for this line; null (stock off, or this
+  /// account may not record stock) hides the button.
+  final void Function(ShoppingEntry entry)? onIssueFromStock;
+
   @override
   Widget build(BuildContext context) => ListenableBuilder(
         listenable: controller,
@@ -120,7 +125,8 @@ class ShoppingListScreen extends StatelessWidget {
       child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
         BilingualText(title, style: monoLabel),
         const SizedBox(height: 6),
-        for (final e in entries) _EntryCard(entry: e, kind: kind, controller: controller, canPick: onRecord != null),
+        for (final e in entries)
+          _EntryCard(entry: e, kind: kind, controller: controller, canPick: onRecord != null, onIssueFromStock: onIssueFromStock),
       ]),
     );
   }
@@ -142,11 +148,12 @@ class _Banner extends StatelessWidget {
 }
 
 class _EntryCard extends StatelessWidget {
-  const _EntryCard({required this.entry, required this.kind, required this.controller, required this.canPick});
+  const _EntryCard({required this.entry, required this.kind, required this.controller, required this.canPick, this.onIssueFromStock});
   final ShoppingEntry entry;
   final _Kind kind;
   final ShoppingController controller;
   final bool canPick;
+  final void Function(ShoppingEntry entry)? onIssueFromStock;
 
   Future<void> _claim(BuildContext context) async {
     final p = entry.portion;
@@ -202,12 +209,23 @@ class _EntryCard extends StatelessWidget {
           Row(children: [
             Expanded(child: _Number(label: neededLabel, value: qtyUnit(l.needed, l.unit))),
             Expanded(child: _Number(label: boughtLabel, value: qtyUnit(l.bought, l.unit))),
+            if (l.fromStock > 0) Expanded(child: _Number(key: Key('from-stock-${p.id}'), label: fromStockLabel, value: qtyUnit(l.fromStock, l.unit))),
             Expanded(child: _Number(label: stillToBuyLabel, value: qtyUnit(p.stillToBuy, l.unit), strong: true)),
           ]),
+          // A hint, not a reservation (Q9): someone may issue it first.
+          if (l.inWarehouse > 0) ...[
+            const SizedBox(height: 6),
+            Text('In warehouse: ${qtyUnit(l.inWarehouse, l.inWarehouseUnit)}',
+                key: Key('in-warehouse-${p.id}'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: WmColors.green)),
+          ],
           if (l.notes.trim().isNotEmpty) ...[
             const SizedBox(height: 6),
             Text(l.notes, style: const TextStyle(fontSize: 13, color: WmColors.textSecondary)),
           ],
+          if (kind != _Kind.others && onIssueFromStock != null && l.inWarehouse > 0 && l.catalogItemId != null && !busy) ...[
+            const SizedBox(height: 10),
+            bilingualButton(issueFromStockLabel, () => onIssueFromStock!(entry), key: Key('issue-stock-${p.id}')),
+          ],
           if (kind != _Kind.others) ...[
             const SizedBox(height: 10),
             if (busy)
@@ -245,7 +263,7 @@ class _Pill extends StatelessWidget {
 }
 
 class _Number extends StatelessWidget {
-  const _Number({required this.label, required this.value, this.strong = false});
+  const _Number({super.key, required this.label, required this.value, this.strong = false});
   final Bilingual label;
   final String value;
   final bool strong;
```

**Modify:** `lib/purchasing/purchasing_services.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/purchasing_services.dart b/lib/purchasing/purchasing_services.dart
index 1c96a04..9ed7182 100644
--- a/lib/purchasing/purchasing_services.dart
+++ b/lib/purchasing/purchasing_services.dart
@@ -2,6 +2,8 @@ import 'package:flutter/material.dart';
 import 'package:image_picker/image_picker.dart';
 
 import '../requests/camera/request_camera_screen.dart';
+import '../stock/data/stock_pending_store.dart';
+import '../stock/data/stock_remote.dart';
 import 'data/purchasing_api.dart';
 
 /// Opens the camera or the gallery; the chosen file's path, or null.
@@ -24,6 +26,8 @@ class PurchasingServices {
     this.changed,
     this.takePhoto = realTakeReceipt,
     this.pickPhoto = realPickReceipt,
+    this.stock,
+    this.stockStore,
   });
 
   final PurchasingApi api;
@@ -33,4 +37,11 @@ class PurchasingServices {
 
   final PickReceipt takePhoto;
   final PickReceipt pickPhoto;
+
+  /// 2B-b: the stock server; null leaves the phone as it was before stock.
+  final StockRemote? stock;
+
+  /// Where stock records wait on the phone until the server settles them
+  /// (R101, R104): the phone's settings file. Stock is offered only with both.
+  final StockPendingStore? stockStore;
 }
```

**Modify:** `lib/purchasing/ui/buyer_shell.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/ui/buyer_shell.dart b/lib/purchasing/ui/buyer_shell.dart
index 646b249..73123d8 100644
--- a/lib/purchasing/ui/buyer_shell.dart
+++ b/lib/purchasing/ui/buyer_shell.dart
@@ -5,6 +5,10 @@ import 'package:flutter/material.dart';
 import '../../auth/worker_profile.dart';
 import '../../profile/account_services.dart';
 import '../../profile/profile_screen.dart';
+import '../../stock/data/stock_submitter.dart';
+import '../../stock/ui/move_screen.dart';
+import '../../stock/ui/stock_controller.dart';
+import '../../stock/ui/stock_screen.dart';
 import '../domain/pur_models.dart';
 import '../domain/purchase_draft.dart';
 import '../list/shopping_controller.dart';
@@ -15,10 +19,11 @@ import '../mine/purchase_detail_screen.dart';
 import '../purchasing_services.dart';
 import '../record/record_screen.dart';
 
-enum _Tab { shopping, mine, profile }
+enum _Tab { shopping, mine, stock, profile }
 
 /// The signed-in app for a buyer (Q2): Shopping list · My purchases ·
-/// Profile. No Time In, no worker Requests, no My Work.
+/// Profile. No Time In, no worker Requests, no My Work. 2B-b: a Stock tab
+/// while the server says stock is on (asked on open, resume and tab tap).
 class BuyerShell extends StatefulWidget {
   const BuyerShell({
     super.key,
@@ -45,8 +50,22 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
   _Tab _tab = _Tab.shopping;
   ShoppingController? _shopping;
   MyPurchasesController? _mine;
+  StockController? _stock;
+  StockSubmitter? _submitter;
 
-  List<_Tab> get _tabs => [if (widget.purchasing != null) ...[_Tab.shopping, _Tab.mine], _Tab.profile];
+  bool get _stockOn => _stock?.enabled ?? false;
+
+  /// A stock record whose answer was lost (R101): it must be resolved first.
+  bool get _unresolved => _submitter?.blocked ?? false;
+
+  /// The tab stays while one is unresolved, even if stock was switched off.
+  bool get _stockTab => _stockOn || _unresolved;
+
+  List<_Tab> get _tabs => [
+        if (widget.purchasing != null) ...[_Tab.shopping, _Tab.mine],
+        if (_stockTab) _Tab.stock,
+        _Tab.profile,
+      ];
 
   @override
   void initState() {
@@ -55,6 +74,19 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     if (p != null) {
       _shopping = ShoppingController(api: p.api)..refresh();
       _mine = MyPurchasesController(api: p.api)..refresh();
+      final stock = p.stock;
+      final store = p.stockStore;
+      // Stock only with the phone's own store: never kept in memory alone (R104).
+      if (stock != null && store != null) {
+        // Listen after the first refresh starts: its first notice is synchronous.
+        _stock = StockController(remote: stock)..refresh();
+        _stock!.addListener(_stockChanged);
+        // What is waiting on this phone for this account; checked (read
+        // only), never sent by itself.
+        final submitter = _submitter = StockSubmitter(remote: stock, store: store)
+          ..addListener(_stockChanged);
+        unawaited(submitter.load(widget.buyer.id).then((_) => submitter.checkAll()));
+      }
       _keepChoices();
       p.changed?.addListener(_refresh);
     } else {
@@ -69,15 +101,32 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     WidgetsBinding.instance.removeObserver(this);
     _shopping?.dispose();
     _mine?.dispose();
+    _stock?.dispose();
+    _submitter?.dispose();
     super.dispose();
   }
 
+  /// Stock switched on or off (or this account's right to record changed):
+  /// the tab and the shopping list's button follow; an open Stock tab closes.
+  void _stockChanged() {
+    if (!mounted) return;
+    setState(() {
+      if (_tab == _Tab.stock && !_stockTab) _tab = _Tab.shopping;
+    });
+  }
+
   /// A purchase was recorded in the background, or the app came back.
   void _refresh() {
     _shopping?.refresh();
     _mine?.refresh();
   }
 
+  void _refreshStock() {
+    _stock?.refresh();
+    final s = _submitter;
+    if (s != null && s.blocked) unawaited(s.checkAll());
+  }
+
   /// Reads the projects, jobs and suppliers while there is signal, so Record
   /// purchase has them later with none (the read keeps a saved copy).
   void _keepChoices() {
@@ -89,6 +138,7 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
   void didChangeAppLifecycleState(AppLifecycleState state) {
     if (state == AppLifecycleState.resumed) {
       _refresh();
+      _refreshStock();
       _keepChoices();
     }
   }
@@ -97,6 +147,31 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     setState(() => _tab = t);
     if (t == _Tab.shopping) _shopping?.refresh();
     if (t == _Tab.mine) _mine?.refresh();
+    if (t == _Tab.stock || t == _Tab.shopping) _refreshStock();
+  }
+
+  /// Issue from stock (Q26): this line's item, from the warehouse to the
+  /// line's job, filling this request line. Starts at what the warehouse
+  /// holds or what is still to buy, whichever is less — when both are in the
+  /// same unit; the server checks the real balance.
+  Future<void> _issueFromStock(ShoppingEntry entry) async {
+    final stock = _stock;
+    final submitter = _submitter;
+    final l = entry.line;
+    if (stock == null || submitter == null) return;
+    final sameUnit = l.inWarehouseUnit.trim().toLowerCase() == l.unit.trim().toLowerCase();
+    final preset = MovePreset(
+      itemId: l.catalogItemId,
+      to: l.workId,
+      requestLineId: l.lineId,
+      quantity: sameUnit ? (l.inWarehouse < l.stillToBuy ? l.inWarehouse : l.stillToBuy) : null,
+      fixed: true,
+    );
+    final done = await openMove(context, stock, submitter, preset);
+    if (!mounted || !done) return;
+    _refresh();
+    _refreshStock();
+    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(key: Key('stock-recorded'), content: Text('Recorded. · Naitala na.')));
   }
 
   /// Record purchase (Q7): picked lines, a saved draft, or blank (unplanned).
@@ -141,13 +216,18 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     final tabs = _tabs;
     if (tabs.length < 2) return Scaffold(body: SafeArea(child: profile));
     final body = switch (_tab) {
-      _Tab.shopping => ShoppingListScreen(controller: _shopping!, onRecord: (lines) => _record(lines: lines)),
+      _Tab.shopping => ShoppingListScreen(
+          controller: _shopping!,
+          onRecord: (lines) => _record(lines: lines),
+          onIssueFromStock: _stockOn && _stock!.status.canRecord && !_unresolved ? _issueFromStock : null,
+        ),
+      _Tab.stock => StockScreen(controller: _stock!, submitter: _submitter!, onRecorded: _refresh),
       _Tab.mine => MyPurchasesScreen(controller: _mine!, onOpenDraft: (d) => _record(draft: d), onOpenPurchase: _open, services: widget.purchasing),
       _Tab.profile => profile,
     };
     return Scaffold(
       body: SafeArea(child: body),
-      floatingActionButton: _tab == _Tab.profile
+      floatingActionButton: _tab == _Tab.profile || _tab == _Tab.stock
           ? null
           // Hidden while items are ticked: their own Record purchase button
           // sits where this one would.
@@ -170,6 +250,7 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
             switch (t) {
               _Tab.shopping => const NavigationDestination(icon: Icon(Icons.shopping_cart_outlined), label: 'Shopping list'),
               _Tab.mine => NavigationDestination(icon: _MineIcon(controller: _mine!), label: 'My purchases'),
+              _Tab.stock => const NavigationDestination(key: Key('tab-stock'), icon: Icon(Icons.inventory_2_outlined), label: 'Stock'),
               _Tab.profile => const NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
             },
         ],
```

**Modify:** `lib/requests/detail/request_detail_screen.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/requests/detail/request_detail_screen.dart b/lib/requests/detail/request_detail_screen.dart
index ec88bf6..b3f2825 100644
--- a/lib/requests/detail/request_detail_screen.dart
+++ b/lib/requests/detail/request_detail_screen.dart
@@ -205,6 +205,10 @@ class RequestDetailScreen extends StatelessWidget {
           '${formatQuantity(p.quantity)} ${l.unit} · ${p.arranged ? 'Arranged · ' : ''}Expected ${calendarDay(p.deliveryOn)}',
           style: const TextStyle(fontSize: 13),
         ),
+      // 2B-b (0106): what the office sent from stock — quantities only.
+      if (l.fromStock > 0)
+        Text('From stock: ${formatQuantity(l.fromStock)} ${l.unit} · Galing sa stock',
+            key: Key('line-from-stock-${l.id}'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: WmColors.green)),
       if (photos.isNotEmpty) ...[
         const SizedBox(height: 8),
         Wrap(spacing: 8, children: [for (final p in photos) _RemotePhoto(key: ValueKey(p.path), api: api, path: p.path)]),
```

**Create:** `lib/stock/ui/leftover_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../purchasing/ui/purchasing_copy.dart' show BilingualText;
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/stock_remote.dart';
import '../data/stock_submitter.dart';
import '../domain/stock_failure.dart';
import '../domain/stock_forms.dart';
import '../domain/stock_models.dart';
import '../domain/stock_submission.dart';
import 'stock_copy.dart';
import 'stock_widgets.dart';

/// Leftovers of a project purchase (Q3): left at the project's site or
/// brought to the warehouse — their cost stays with that project. Counted
/// in the catalogue item's unit; never more than the line brought.
class LeftoverScreen extends StatefulWidget {
  const LeftoverScreen({super.key, required this.remote, required this.submitter, this.today});

  /// Reads only; writes go through [submitter].
  final StockRemote remote;
  final StockSubmitter submitter;
  final String? today;

  @override
  State<LeftoverScreen> createState() => _LeftoverScreenState();
}

class _LeftoverScreenState extends State<LeftoverScreen> with StockSending {
  @override
  StockSubmitter get submitter => widget.submitter;

  late final String _today = widget.today ?? stockToday();
  StockChoices? _choices;
  StockFailure? _loadFailure;
  String? _project;
  List<StockLine>? _lines;
  StockLine? _line;
  String _where = 'site';
  String _on = '';
  final _qty = TextEditingController();
  final _note = TextEditingController();

  @override
  void initState() {
    super.initState();
    _on = _today;
    _load();
  }

  @override
  void dispose() {
    _qty.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loadFailure = null);
    try {
      final c = await widget.remote.choices();
      if (mounted) setState(() => _choices = c);
    } catch (e) {
      if (mounted) setState(() => _loadFailure = StockFailure.of(e));
    }
  }

  Future<void> _pickProject(String? folderId) async {
    setState(() {
      _project = folderId;
      _lines = null;
      _line = null;
    });
    if (folderId == null) return;
    try {
      final lines = await widget.remote.projectLines(folderId);
      if (mounted && _project == folderId) setState(() => _lines = lines);
    } catch (e) {
      if (mounted) setState(() => _loadFailure = StockFailure.of(e));
    }
  }

  Future<void> _send() async {
    final line = _line;
    if (line == null) {
      setState(() => failure = StockFailure.notProject);
      return;
    }
    final form = LeftoverForm(line: line, quantity: _qty.text, where: _where, on: _on, note: _note.text);
    final project = _choices?.projects.where((p) => p.folderId == _project).firstOrNull?.name ?? 'the project';
    final ok = await sendChecked(form.problems(today: _today),
        write: StockWrite.leftover,
        params: form.params,
        summary: 'Leftovers ${stockQty(parseStockQty(form.quantity) ?? 0, line.match?.itemUnit ?? '')} ${line.itemName} — '
            '${_where == 'site' ? 'at the site of' : 'brought to the warehouse from'} $project');
    if (ok && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Record leftovers')),
        body: SafeArea(
          child: _loadFailure != null
              ? Padding(
                  padding: const EdgeInsets.all(16),
                  child: FailureNotice(
                    key: const Key('stock-load-failure'),
                    english: stockFailureCopy(_loadFailure!).english,
                    tagalog: stockFailureCopy(_loadFailure!).tagalog,
                    actions: [noticeAction('Try again · Subukan ulit', _load)],
                  ),
                )
              : _choices == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(padding: const EdgeInsets.all(16), children: _fields(_choices!)),
        ),
      );

  List<Widget> _fields(StockChoices choices) {
    final line = _line;
    final unit = line?.match?.itemUnit ?? '';
    return [
      const StockFieldLabel('Project'),
      DropdownButtonFormField<String>(
        key: const Key('leftover-project'),
        initialValue: _project,
        isExpanded: true,
        hint: const Text('Choose the project'),
        items: [for (final p in choices.projectsInOrder) DropdownMenuItem(value: p.folderId, child: Text(p.label, overflow: TextOverflow.ellipsis))],
        onChanged: locked ? null : _pickProject,
      ),
      if (_project != null && _lines == null) const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator()),
      if (_lines != null) ...[
        const StockFieldLabel('Which purchase'),
        if (_lines!.isEmpty) const Text('No purchase for this project yet.', style: TextStyle(color: WmColors.textMuted)),
        IgnorePointer(
          ignoring: locked,
          child: RadioGroup<String>(
            groupValue: line?.key,
            onChanged: (k) => setState(() => _line = _lines!.where((l) => l.key == k).firstOrNull),
            child: Column(children: [
              for (final l in _lines!)
                RadioListTile<String>(
                  key: Key('leftover-line-${l.key}'),
                  value: l.key,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${l.itemName} · ${stockQty(l.quantity, l.unit)}'),
                  subtitle: Text(l.match == null
                      ? 'Bought ${l.purchaseDate} — not matched yet (the office matches it first)'
                      : 'Bought ${l.purchaseDate} — up to ${stockQty(l.leftoverRoom, l.match!.itemUnit)} can be recorded'),
                ),
            ]),
          ),
        ),
      ],
      if (line != null) ...[
        const StockFieldLabel('How much is left over?'),
        TextField(
          key: const Key('leftover-qty'),
          controller: _qty,
          enabled: !locked,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(suffixText: unit),
        ),
        const StockFieldLabel('Where is it?'),
        SegmentedButton<String>(
          key: const Key('leftover-where'),
          segments: const [
            ButtonSegment(value: 'site', label: Text('At the site')),
            ButtonSegment(value: 'warehouse', label: Text('Brought to the warehouse')),
          ],
          selected: {_where},
          onSelectionChanged: locked ? null : (s) => setState(() => _where = s.first),
        ),
        const StockFieldLabel('When'),
        Align(alignment: Alignment.centerLeft, child: StockDayField(value: _on, today: _today, onChanged: locked ? null : (d) => setState(() => _on = d))),
        const StockFieldLabel('Note (optional)'),
        TextField(key: const Key('leftover-note'), controller: _note, enabled: !locked, maxLength: 300),
      ],
      sendArea(sendKey: const Key('leftover-send'), onSend: _send),
      const SizedBox(height: 8),
      const BilingualText(undoOnWeb, style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
    ];
  }
}
```

**Create:** `lib/stock/ui/move_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../purchasing/ui/purchasing_copy.dart' show BilingualText;
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/stock_remote.dart';
import '../data/stock_submitter.dart';
import '../domain/stock_failure.dart';
import '../domain/stock_forms.dart';
import '../domain/stock_models.dart';
import '../domain/stock_submission.dart';
import 'stock_copy.dart';
import 'stock_widgets.dart';

/// Where the issue / move / return form starts. The shopping list's "Issue
/// from stock" fixes the item, the project and the request line; a return
/// fixes everything but the quantity.
class MovePreset {
  const MovePreset({
    this.itemId,
    this.from = warehousePlace,
    this.to,
    this.requestLineId,
    this.quantity,
    this.returnsRecord,
    this.returnFrom,
    this.fixed = false,
  });

  final String? itemId;
  final String from;
  final String? to;
  final String? requestLineId;
  final double? quantity;
  final String? returnsRecord;

  /// The issue's project, shown on a return.
  final String? returnFrom;

  /// Item, from, to and request line can't be changed (Issue from stock).
  final bool fixed;
}

/// Issue (warehouse → project), move (project → project, or → warehouse) or
/// return (Q8, Q10, Q26). Online only: the choices and the request lines
/// are read when it opens; Send needs signal and records once (R101).
class MoveScreen extends StatefulWidget {
  const MoveScreen({super.key, required this.remote, required this.submitter, required this.preset, this.overview, this.today});

  /// Reads only; writes go through [submitter].
  final StockRemote remote;
  final StockSubmitter submitter;
  final MovePreset preset;

  /// For the "N there" hint only; the server checks the real balance.
  final StockOverview? overview;
  final String? today;

  @override
  State<MoveScreen> createState() => _MoveScreenState();
}

class _MoveScreenState extends State<MoveScreen> with StockSending {
  @override
  StockSubmitter get submitter => widget.submitter;

  late final String _today = widget.today ?? stockToday();
  late final MoveForm _form = MoveForm(
    itemId: widget.preset.itemId,
    from: widget.preset.from,
    to: widget.preset.to,
    on: _today,
    requestLineId: widget.preset.requestLineId,
    returnsRecord: widget.preset.returnsRecord,
    quantity: widget.preset.quantity == null || widget.preset.quantity! <= 0 ? '' : qtyText(widget.preset.quantity!),
  );
  late final _qty = TextEditingController(text: _form.quantity);
  final _reason = TextEditingController();
  final _note = TextEditingController();

  StockChoices? _choices;
  StockFailure? _loadFailure;
  List<StockRequestLine>? _lines;
  bool _linesFailed = false;

  bool get _isReturn => _form.isReturn;

  @override
  void initState() {
    super.initState();
    _loadChoices();
  }

  @override
  void dispose() {
    _qty.dispose();
    _reason.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _loadChoices() async {
    setState(() => _loadFailure = null);
    try {
      final c = await widget.remote.choices();
      if (!mounted) return;
      setState(() => _choices = c);
      await _loadLines();
    } catch (e) {
      if (mounted) setState(() => _loadFailure = StockFailure.of(e));
    }
  }

  /// The request lines of the project the goods go to (a site only).
  Future<void> _loadLines() async {
    final to = _form.to;
    setState(() {
      _lines = null;
      _linesFailed = false;
    });
    if (_isReturn || to == null || to == warehousePlace) return;
    try {
      final lines = await widget.remote.requestLines(to);
      if (!mounted || _form.to != to) return;
      setState(() {
        _lines = lines;
        if (_form.requestLineId != null && !lines.any((l) => l.lineId == _form.requestLineId)) _form.requestLineId = null;
      });
    } catch (_) {
      if (mounted) setState(() => _linesFailed = true);
    }
  }

  StockItemChoice? get _item => _choices?.item(_form.itemId);

  List<StockRequestLine> get _fitting {
    final item = _item;
    return item == null ? const [] : (_lines ?? const []).where((l) => l.fits(item)).toList();
  }

  String _place(String? id) =>
      id == warehousePlace ? 'Warehouse' : (_choices?.projects.where((p) => p.folderId == id).firstOrNull?.name ?? 'a project');

  /// In words, for the Stock tab if the answer is lost.
  String _summary() {
    final item = _item;
    final q = stockQty(parseStockQty(_form.quantity) ?? 0, item?.unit ?? '');
    final what = item?.name ?? 'Item';
    if (_isReturn) return 'Returned $q $what — ${widget.preset.returnFrom ?? 'a project'} → Warehouse';
    return '${_form.kind == 'issue' ? 'Issued' : 'Moved'} $q $what — ${_place(_form.from)} → ${_place(_form.to)}';
  }

  Future<void> _send() async {
    _form
      ..quantity = _qty.text
      ..unplannedReason = _form.requestLineId == null ? _reason.text : ''
      ..note = _note.text;
    final ok = await sendChecked(_form.problems(today: _today),
        write: StockWrite.move, params: (op) => {'p_op': op, 'p_body': _form.body()}, summary: _summary());
    if (ok && mounted) Navigator.of(context).pop(true);
  }

  String get _title => _isReturn ? 'Return to the warehouse' : (widget.preset.fixed ? 'Issue from stock' : 'Issue or move');

  @override
  Widget build(BuildContext context) {
    final choices = _choices;
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: SafeArea(
        child: _loadFailure != null
            ? Padding(
                padding: const EdgeInsets.all(16),
                child: FailureNotice(
                  key: const Key('stock-load-failure'),
                  english: stockFailureCopy(_loadFailure!).english,
                  tagalog: stockFailureCopy(_loadFailure!).tagalog,
                  actions: [noticeAction('Try again · Subukan ulit', _loadChoices)],
                ),
              )
            : choices == null
                ? const Center(child: CircularProgressIndicator())
                : ListView(padding: const EdgeInsets.all(16), children: _fields(choices)),
      ),
    );
  }

  List<Widget> _fields(StockChoices choices) {
    final item = _item;
    final unit = item?.unit ?? '';
    final places = [
      const DropdownMenuItem<String>(value: warehousePlace, child: Text('Warehouse')),
      for (final p in choices.projectsInOrder) DropdownMenuItem<String>(value: p.folderId, child: Text(p.label, overflow: TextOverflow.ellipsis)),
    ];
    final there = widget.overview?.item(_form.itemId)?.at(_form.from);
    final fixed = widget.preset.fixed || _isReturn || locked;
    return [
      if (_isReturn)
        Text('From ${widget.preset.returnFrom ?? 'the project'}, back to the warehouse. The same lots go back.',
            style: const TextStyle(color: WmColors.textMuted)),
      const StockFieldLabel('Item'),
      DropdownButtonFormField<String>(
        key: const Key('move-item'),
        initialValue: _form.itemId,
        isExpanded: true,
        hint: const Text('Choose the item'),
        items: [for (final i in choices.items) DropdownMenuItem(value: i.itemId, child: Text(i.label, overflow: TextOverflow.ellipsis))],
        onChanged: fixed
            ? null
            : (v) => setState(() {
                  _form.itemId = v;
                  _form.requestLineId = null;
                }),
      ),
      if (!_isReturn) ...[
        const StockFieldLabel('From'),
        DropdownButtonFormField<String>(
          key: const Key('move-from'),
          initialValue: _form.from,
          isExpanded: true,
          items: places,
          onChanged: fixed ? null : (v) => setState(() => _form.from = v ?? warehousePlace),
        ),
        const StockFieldLabel('To'),
        DropdownButtonFormField<String>(
          key: const Key('move-to'),
          initialValue: _form.to,
          isExpanded: true,
          hint: const Text('Choose where it goes'),
          items: places,
          onChanged: fixed
              ? null
              : (v) {
                  setState(() {
                    _form.to = v;
                    _form.requestLineId = null;
                  });
                  _loadLines();
                },
        ),
      ],
      const StockFieldLabel('Quantity'),
      TextField(
        key: const Key('move-qty'),
        controller: _qty,
        enabled: !locked,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(
          suffixText: unit,
          helperText: there == null ? null : '${stockQty(there, unit)} there now',
        ),
      ),
      if (_form.toSite) ..._requestFields(),
      const StockFieldLabel('When'),
      Align(
        alignment: Alignment.centerLeft,
        child: StockDayField(value: _form.on, today: _today, onChanged: locked ? null : (d) => setState(() => _form.on = d)),
      ),
      const StockFieldLabel('Note (optional)'),
      TextField(key: const Key('move-note'), controller: _note, enabled: !locked, maxLength: 300),
      sendArea(sendKey: const Key('move-send'), onSend: _send),
      const SizedBox(height: 8),
      const BilingualText(undoOnWeb, style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
    ];
  }

  /// To a project: a request line it fills, or why it is needed (R58).
  List<Widget> _requestFields() {
    final fitting = _fitting;
    final fixedLine = (widget.preset.fixed && _form.requestLineId != null) || locked;
    return [
      const StockFieldLabel('For a request'),
      if (_lines == null && !_linesFailed) const LinearProgressIndicator(),
      if (_linesFailed)
        const BilingualText(stockNeedsSignal, style: TextStyle(fontSize: 13, color: WmColors.danger)),
      if (_lines != null)
        // A new item or place starts the choice afresh (its lines differ).
        KeyedSubtree(
          key: ValueKey('request-${_form.itemId}-${_form.to}'),
          child: DropdownButtonFormField<String?>(
            key: const Key('move-request'),
            initialValue: _form.requestLineId,
            isExpanded: true,
            items: [
              const DropdownMenuItem<String?>(value: null, child: Text('None — unplanned')),
              for (final l in fitting)
                DropdownMenuItem<String?>(
                  value: l.lineId,
                  child: Text('${l.description}${l.spec.isEmpty ? '' : ' · ${l.spec}'} — ${l.requesterName} · '
                      '${stockQty(l.stillToBuy, l.unit)} still needed', overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: fixedLine ? null : (v) => setState(() => _form.requestLineId = v),
          ),
        ),
      if (_form.requestLineId == null) ...[
        const StockFieldLabel('Why it is needed'),
        TextField(key: const Key('move-reason'), controller: _reason, enabled: !locked, maxLength: 300),
      ],
    ];
  }
}
```

**Create:** `lib/stock/ui/receive_sheet.dart`

```dart
import 'package:flutter/material.dart';

import '../../purchasing/ui/purchasing_copy.dart' show BilingualText;
import '../../ui/theme.dart';
import '../data/stock_submitter.dart';
import '../domain/stock_forms.dart';
import '../domain/stock_models.dart';
import '../domain/stock_submission.dart';
import 'stock_copy.dart';
import 'stock_widgets.dart';

/// "Received" (Q6, Q7): part or all of a warehouse purchase line arrived, in
/// the line's own unit. Not matched yet: still recorded — it becomes stock
/// when the office matches it.
class ReceiveSheet extends StatefulWidget {
  const ReceiveSheet({super.key, required this.submitter, required this.line, this.today});

  final StockSubmitter submitter;
  final StockLine line;
  final String? today;

  @override
  State<ReceiveSheet> createState() => _ReceiveSheetState();
}

class _ReceiveSheetState extends State<ReceiveSheet> with StockSending {
  @override
  StockSubmitter get submitter => widget.submitter;

  late final String _today = widget.today ?? stockToday();
  late final ReceiveForm _form = ReceiveForm(line: widget.line, on: _today);
  late final _qty = TextEditingController(text: qtyText(widget.line.awaiting));
  final _note = TextEditingController();

  @override
  void dispose() {
    _qty.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    _form
      ..quantity = _qty.text
      ..note = _note.text;
    final l = widget.line;
    final ok = await sendChecked(_form.problems(today: _today),
        write: StockWrite.receive,
        params: _form.params,
        summary: 'Received ${stockQty(parseStockQty(_form.quantity) ?? 0, l.unit)} ${l.itemName} (bought ${l.purchaseDate})');
    if (ok && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l = widget.line;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const BilingualText(receivedLabel, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19)),
          const SizedBox(height: 6),
          Text('${l.itemName} · bought ${l.purchaseDate} by ${l.boughtByName}', style: const TextStyle(color: WmColors.textMuted)),
          Text('Still awaited: ${stockQty(l.awaiting, l.unit)}', style: const TextStyle(fontWeight: FontWeight.w700)),
          if (l.match == null) ...[
            const SizedBox(height: 6),
            const BilingualText(notMatchedYet, style: TextStyle(fontSize: 12.5, color: WmColors.brownDeep)),
          ],
          const StockFieldLabel('How much arrived?'),
          TextField(
            key: const Key('receive-qty'),
            controller: _qty,
            enabled: !locked,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(suffixText: l.unit),
          ),
          const StockFieldLabel('When'),
          StockDayField(value: _form.on, today: _today, onChanged: locked ? null : (d) => setState(() => _form.on = d)),
          const StockFieldLabel('Note (optional)'),
          TextField(key: const Key('receive-note'), controller: _note, enabled: !locked, maxLength: 300),
          SizedBox(width: double.infinity, child: sendArea(sendKey: const Key('receive-send'), onSend: _send)),
        ]),
      ),
    );
  }
}
```

**Create:** `lib/stock/ui/stock_controller.dart`

```dart
import 'package:flutter/foundation.dart';

import '../data/stock_remote.dart';
import '../domain/stock_failure.dart';
import '../domain/stock_models.dart';

/// The Stock tab's state (Q26): online only. Whether stock is usable here at
/// all is the server's `stk_status` — asked on every refresh, so the tab
/// appears the moment the main owner switches stock on and goes when it is
/// off. With no signal the last answer stays and the screen says so.
class StockController extends ChangeNotifier {
  StockController({required this.remote});

  final StockRemote remote;

  StockStatus status = StockStatus.off;
  StockOverview overview = const StockOverview();
  bool loading = false;

  /// The overview was read at least once.
  bool loaded = false;

  /// Why the last refresh failed (no signal, mostly); null after a good one.
  StockFailure? failure;

  bool _disposed = false;
  int _generation = 0;

  bool get enabled => status.enabled;

  Future<void> refresh() async {
    final gen = ++_generation;
    loading = true;
    _notify();
    try {
      final s = await remote.status();
      final ov = s.enabled ? await remote.overview() : const StockOverview();
      // Only the latest refresh shows: an older one answering last changes nothing.
      if (gen != _generation || _disposed) return;
      status = s;
      overview = ov;
      loaded = s.enabled;
      failure = null;
    } catch (e) {
      if (gen != _generation || _disposed) return;
      failure = StockFailure.of(e);
    } finally {
      if (gen == _generation) {
        loading = false;
        _notify();
      }
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
```

**Create:** `lib/stock/ui/stock_copy.dart`

```dart
import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../requests/domain/quantity.dart';
import '../domain/stock_models.dart';

// Q22: English, with the Tagalog line underneath, on the key labels and every
// message. Screen titles and small field labels stay English.

const stockTitle = Bilingual('Stock', 'Stock sa bodega at site');
const issueMoveLabel = Bilingual('Issue / move', 'Ipadala / ilipat');
const issueFromStockLabel = Bilingual('Issue from stock', 'Kunin sa bodega');
const leftoversLabel = Bilingual('Record leftovers', 'Itala ang natira');
const receivedLabel = Bilingual('Received…', 'Natanggap…');
const returnLabel = Bilingual('Return…', 'Ibalik…');
const sendLabel = Bilingual('Send', 'Ipadala');
const fromStockLabel = Bilingual('From stock', 'Galing sa stock');
const stockNeedsSignal =
    Bilingual('Stock needs signal. Pull down to try again.', 'Kailangan ng signal ang stock. Hilahin pababa para subukan ulit.');
const stockOffNow = Bilingual('Stock is not switched on.', 'Hindi naka-on ang stock.');
const notMatchedYet = Bilingual('Not matched yet — the office matches it on Dacs Web; it becomes stock then.',
    'Hindi pa naitutugma — itutugma ng opisina sa Dacs Web; magiging stock ito pagkatapos.');
// R101–R103: a Send whose answer was lost.
const notSureLabel = Bilingual('Not sure this was recorded — the answer was lost. Send it again unchanged, check, or cancel it.',
    'Hindi sigurado kung naitala — nawala ang sagot. Ipadala ulit nang walang binago, i-check, o kanselahin.');
const sendAgainLabel = Bilingual('Send again', 'Ipadala ulit');
const checkLabel = Bilingual('Check', 'I-check');
const cancelLabel = Bilingual('Cancel it', 'Kanselahin');
const cancelChangeLabel = Bilingual('Cancel it and change', 'Kanselahin at baguhin');
const wasRecorded = Bilingual('It was recorded.', 'Naitala na ito.');
const notYetCopy = Bilingual('Not recorded yet — it may still arrive. Send it again, or cancel it.',
    'Hindi pa naitatala — baka dumating pa. Ipadala ulit, o kanselahin.');
const finishFirst = Bilingual('First finish the stock record that is not sure (top of the Stock tab).',
    'Tapusin muna ang stock record na hindi sigurado (sa itaas ng Stock tab).');

// R104: saved stock data the phone can no longer read.
const unreadableLabel = Bilingual(
    "A saved stock record on this phone is damaged — its details can't be read. Check whether it was recorded, or cancel it so it never records.",
    'May sirang stock record na naka-save sa phone na ito — hindi mabasa ang detalye. I-check kung naitala, o kanselahin para hindi na maitala.');
const unreadablePendingCopy = Bilingual('Not recorded yet — it may still arrive. Cancel it to settle it.',
    'Hindi pa naitatala — baka dumating pa. Kanselahin para matapos ito.');
const recoveryLabel = Bilingual(
    "Saved stock records on this phone can't be read. New stock records are paused on this phone — nothing was deleted. Ask the office for help before recording stock here.",
    'Hindi mabasa ang mga stock record na naka-save sa phone na ito. Nakahinto ang bagong stock record sa phone na ito — walang binura. Humingi ng tulong sa opisina bago magtala ng stock dito.');

/// A Send again refused while the first Send might still arrive.
Bilingual retryRefusedCopy(Bilingual refusal) => Bilingual('${refusal.english} The first Send may still arrive — check, or cancel it.',
    '${refusal.tagalog} Baka dumating pa ang unang pinadala — i-check, o kanselahin.');

const undoOnWeb = Bilingual('A mistake? The office reverses it on Dacs Web (Requests → Stock → History).',
    'May mali? Ang opisina ang magbabaliktad nito sa Dacs Web (Requests → Stock → History).');

/// "6 bag".
String stockQty(num v, String unit) => unit.trim().isEmpty ? formatQuantity(v) : '${formatQuantity(v)} ${unit.trim()}';

const _kind = {
  'receive': 'Received',
  'not_delivered': 'Not delivered',
  'leftover': 'Leftovers',
  'issue': 'Issued',
  'return': 'Returned',
  'move': 'Moved',
  'count': 'Count',
  'opening': 'Opening stock',
};

String recordKind(StockRecord r) => _kind[r.kind] ?? r.kind;

/// One line about a record: what moved, how much, from where to where.
String recordLine(StockRecord r) {
  final q = stockQty(r.quantity, r.unit);
  return switch (r.kind) {
    'receive' => '$q ${r.what} at the warehouse',
    'not_delivered' => '$q ${r.what} will not be delivered',
    'leftover' => '$q ${r.what} left over — ${r.toName}',
    'count' => '${r.what} at ${r.toName}: counted $q, books ${stockQty(r.bookQuantity ?? 0, r.unit)}',
    'opening' => '$q ${r.what} already at ${r.toName}',
    _ => '$q ${r.what} — ${r.fromName} → ${r.toName}',
  };
}

/// A record's state, or null when it simply happened.
String? recordState(StockRecord r) {
  if (r.reversed) return 'Reversed';
  return switch (r.status) {
    'pending' => 'Waiting for the owner',
    'rejected' => 'Rejected',
    'withdrawn' => 'Withdrawn',
    _ => null,
  };
}

/// A cost move's state, as the web words it — never its value (Q28).
String costState(StockCostState c) {
  if (c.status == 'pending') {
    return switch (c.kind) {
      'assign' => 'Cost assignment pending',
      'transfer' => 'Cost transfer pending',
      _ => 'Back to company stock — pending',
    };
  }
  if (c.status == 'rejected') return 'Cost move rejected — kept with source';
  if (c.status == 'withdrawn') return 'Cost request withdrawn';
  if (c.reversed) return 'Cost move reversed';
  return switch (c.kind) {
    'assign' => 'Cost assigned',
    'transfer' => 'Cost transferred',
    'back' => 'Cost back in company stock',
    _ => 'Company stock loss',
  };
}
```

**Create:** `lib/stock/ui/stock_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../purchasing/ui/purchasing_copy.dart' show BilingualText, bilingualButton;
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/stock_submitter.dart';
import '../domain/stock_failure.dart';
import '../domain/stock_models.dart';
import 'leftover_screen.dart';
import 'move_screen.dart';
import 'receive_sheet.dart';
import 'stock_controller.dart';
import 'stock_copy.dart';
import 'stock_widgets.dart';

enum StockPart { stock, receive, recent }

/// Opens the issue / move / return form; true when the server recorded it.
Future<bool> openMove(BuildContext context, StockController controller, StockSubmitter submitter, MovePreset preset) async {
  final done = await Navigator.of(context).push<bool>(MaterialPageRoute(
    builder: (_) => MoveScreen(remote: controller.remote, submitter: submitter, preset: preset, overview: controller.overview),
  ));
  return done == true;
}

/// The Stock tab (Q26): quantities only — never a peso, even for an owner
/// (Q28). Records here; matching, counts, opening stock, reversals and every
/// cost decision stay on Dacs Web. A record whose answer was lost waits at
/// the top, and no new one starts until it is resolved (R101).
class StockScreen extends StatefulWidget {
  const StockScreen({super.key, required this.controller, required this.submitter, this.onRecorded});

  final StockController controller;
  final StockSubmitter submitter;

  /// After a record the server accepted (the shopping list changes too).
  final VoidCallback? onRecorded;

  @override
  State<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends State<StockScreen> {
  StockPart _part = StockPart.stock;

  StockController get _c => widget.controller;
  StockSubmitter get _s => widget.submitter;

  Future<void> _after(Future<bool> recorded) async {
    if (await recorded) await _recorded();
  }

  Future<void> _recorded() async {
    widget.onRecorded?.call();
    await _c.refresh();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        key: Key('stock-recorded'),
        content: Text('Recorded. · Naitala na.'),
      ));
    }
  }

  void _issue() => _after(openMove(context, _c, _s, const MovePreset()));

  void _leftovers() => _after(Navigator.of(context)
      .push<bool>(MaterialPageRoute(builder: (_) => LeftoverScreen(remote: _c.remote, submitter: _s)))
      .then((v) => v == true));

  void _receive(StockLine line) => _after(showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => ReceiveSheet(submitter: _s, line: line),
      ).then((v) => v == true));

  void _return(StockRecord r) => _after(openMove(
        context,
        _c,
        _s,
        MovePreset(itemId: r.itemId, returnsRecord: r.id, returnFrom: r.toName, quantity: r.returnable),
      ));

  void _refused(StockFailure f) {
    final copy = stockFailureCopy(f);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(key: const Key('stock-refused'), content: Text('${copy.english}\n${copy.tagalog}')));
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: Listenable.merge([_c, _s]),
        builder: (context, _) {
          // Nothing new while one is unresolved (R101).
          final can = _c.status.canRecord && !_s.blocked;
          final ov = _c.overview;
          return RefreshIndicator(
            onRefresh: _c.refresh,
            child: ListView(padding: const EdgeInsets.all(16), children: [
              const Text('Stock', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
              Text(stockTitle.tagalog, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
              const SizedBox(height: 12),
              SegmentedButton<StockPart>(
                key: const Key('stock-parts'),
                showSelectedIcon: false,
                segments: [
                  const ButtonSegment(value: StockPart.stock, label: Text('Stock')),
                  ButtonSegment(value: StockPart.receive, label: Text('To receive (${ov.awaiting.length})')),
                  const ButtonSegment(value: StockPart.recent, label: Text('Recent')),
                ],
                selected: {_part},
                onSelectionChanged: (s) => setState(() => _part = s.first),
              ),
              if (_c.failure != null) ...[
                const SizedBox(height: 10),
                FailureNotice(
                  key: const Key('stock-signal'),
                  english: _c.failure == StockFailure.noConnection ? stockNeedsSignal.english : stockFailureCopy(_c.failure!).english,
                  tagalog: _c.failure == StockFailure.noConnection ? stockNeedsSignal.tagalog : stockFailureCopy(_c.failure!).tagalog,
                  actions: [noticeAction('Try again · Subukan ulit', _c.refresh)],
                ),
              ],
              for (final u in _s.unresolved)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: UnresolvedBox(submitter: _s, opId: u.opId, onRecorded: _recorded, onSettledNotRecorded: _refused),
                ),
              for (final u in _s.unreadable)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: UnreadableBox(submitter: _s, opId: u.opId!, onRecorded: _recorded, onSettledNotRecorded: _refused),
                ),
              if (_s.recoveryNeeded)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: FailureNotice(key: const Key('stock-recovery'), english: recoveryLabel.english, tagalog: recoveryLabel.tagalog),
                ),
              if (_s.blocked && _c.status.canRecord && !_s.recoveryNeeded) ...[
                const SizedBox(height: 8),
                const BilingualText(finishFirst, key: Key('stock-finish-first'), style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
              ],
              if (_c.loaded && !_c.enabled) ...[
                const SizedBox(height: 10),
                const BilingualText(stockOffNow, style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
              ],
              if (_c.loading && !_c.loaded) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
              if (can && _part == StockPart.stock) ...[
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: bilingualButton(issueMoveLabel, _issue, filled: true, key: const Key('stock-issue'))),
                  const SizedBox(width: 8),
                  Expanded(child: bilingualButton(leftoversLabel, _leftovers, key: const Key('stock-leftovers'))),
                ]),
              ],
              ...switch (_part) {
                StockPart.stock => _stock(ov),
                StockPart.receive => _toReceive(ov, can),
                StockPart.recent => _recent(ov, can),
              },
              const SizedBox(height: 16),
              const BilingualText(undoOnWeb, style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
            ]),
          );
        },
      );

  Widget _empty(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 32),
        child: Center(child: Text(text, style: const TextStyle(color: WmColors.textMuted))),
      );

  List<Widget> _stock(StockOverview ov) {
    if (_c.loaded && ov.items.isEmpty) return [_empty('No goods in stock yet.')];
    return [
      for (final i in ov.items)
        _Card(
          key: Key('stock-item-${i.itemId}'),
          children: [
            Text(i.spec.trim().isEmpty ? i.name : '${i.name} · ${i.spec}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            Text('${stockQty(i.total, i.unit)} in all', style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
            const SizedBox(height: 6),
            for (final p in i.places)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Row(children: [
                  Icon(p.isWarehouse ? Icons.warehouse_outlined : Icons.construction_outlined, size: 16, color: WmColors.textMuted),
                  const SizedBox(width: 6),
                  Expanded(child: Text(p.name)),
                  Text(stockQty(p.quantity, i.unit), style: const TextStyle(fontWeight: FontWeight.w700)),
                ]),
              ),
          ],
        ),
    ];
  }

  List<Widget> _toReceive(StockOverview ov, bool can) {
    if (_c.loaded && ov.awaiting.isEmpty) return [_empty('Nothing waiting to arrive.')];
    return [
      for (final l in ov.awaiting)
        _Card(
          key: Key('awaiting-${l.key}'),
          children: [
            Text(l.itemName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            Text('Bought ${l.purchaseDate} by ${l.boughtByName} · ${stockQty(l.quantity, l.unit)}',
                style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
            const SizedBox(height: 4),
            Text('Received ${stockQty(l.received, l.unit)} · still awaited ${stockQty(l.awaiting, l.unit)}',
                style: const TextStyle(fontWeight: FontWeight.w700)),
            if (l.match == null) const Text('Not matched yet', style: TextStyle(fontSize: 12.5, color: WmColors.brownDeep)),
            if (can) ...[
              const SizedBox(height: 8),
              bilingualButton(receivedLabel, () => _receive(l), key: Key('receive-${l.key}')),
            ],
          ],
        ),
    ];
  }

  List<Widget> _recent(StockOverview ov, bool can) {
    if (_c.loaded && ov.recent.isEmpty) return [_empty('Nothing recorded yet.')];
    return [
      for (final r in ov.recent)
        _Card(
          key: Key('record-${r.id}'),
          children: [
            Row(children: [
              Expanded(child: Text(recordKind(r), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              Text(r.on, style: const TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
            ]),
            Text(recordLine(r)),
            if (r.requestDescription.isNotEmpty)
              Text('For: ${r.requestDescription}', style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
            if (r.unplannedReason.isNotEmpty)
              Text('Unplanned: ${r.unplannedReason}', style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
            Text('By ${r.recordedByName}', style: const TextStyle(fontSize: 12.5, color: WmColors.textMeta)),
            if (recordState(r) != null) Text(recordState(r)!, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: WmColors.brownDeep)),
            // The cost's state only — its value is the main owner's, on the web.
            for (final c in r.costs) Text(costState(c), style: const TextStyle(fontSize: 12.5, color: WmColors.textSecondary)),
            if (can && r.canReturn) ...[
              const SizedBox(height: 8),
              bilingualButton(returnLabel, () => _return(r), key: Key('return-${r.id}')),
            ],
          ],
        ),
    ];
  }
}

class _Card extends StatelessWidget {
  const _Card({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(top: 10),
        color: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: WmColors.border)),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
        ),
      );
}
```

**Create:** `lib/stock/ui/stock_widgets.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/domain/work_date.dart';
import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../attendance/ui/formats.dart' show clockTime;
import '../../purchasing/ui/purchasing_copy.dart' show BilingualText, bilingualButton;
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/stock_submitter.dart';
import '../domain/stock_failure.dart';
import '../domain/stock_submission.dart';
import 'stock_copy.dart';

/// Manila's today ("2026-10-27"): the latest day a stock record may carry.
String stockToday([DateTime? now]) => WorkDate.today(now).iso;

/// A stock form's Send (R101): the phone's own checks first, then the
/// submission goes through [StockSubmitter] — saved with its operation id
/// and exact payload before it leaves. If the answer is lost the form
/// LOCKS: its fields cannot change, and only Send again (the saved payload),
/// Check, or Cancel it and change are offered — the last one unlocks the
/// fields only once the SERVER confirms the id cancelled (R102).
mixin StockSending<T extends StatefulWidget> on State<T> {
  StockSubmitter get submitter;

  bool sending = false;
  StockFailure? failure;
  Bilingual? message;

  /// The unresolved submission this form sent; the fields are locked while set.
  String? unsureOp;
  StockFailure? _unsureWhy;

  bool get locked => unsureOp != null;

  /// True when the server recorded it.
  Future<bool> sendChecked(
    List<StockFailure> problems, {
    required StockWrite write,
    required Map<String, dynamic> Function(String opId) params,
    required String summary,
  }) async {
    if (sending || locked) return false;
    if (problems.isNotEmpty) {
      setState(() {
        failure = problems.first;
        message = null;
      });
      return false;
    }
    setState(() {
      sending = true;
      failure = null;
      message = null;
    });
    try {
      final o = await submitter.submit(write: write, params: params, summary: summary);
      if (!mounted) return o.result == StockSendResult.recorded;
      setState(() {
        switch (o.result) {
          case StockSendResult.recorded:
            break;
          case StockSendResult.refused:
            failure = o.failure;
          case StockSendResult.blocked:
            message = finishFirst;
          case StockSendResult.unsure:
            unsureOp = o.opId;
            _unsureWhy = o.failure;
        }
      });
      return o.result == StockSendResult.recorded;
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  /// Send, or — once locked — the unresolved box in its place.
  Widget sendArea({required Key sendKey, required VoidCallback onSend}) {
    final op = unsureOp;
    if (op != null) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: UnresolvedBox(
          submitter: submitter,
          opId: op,
          firstFailure: _unsureWhy,
          inForm: true,
          onRecorded: () {
            if (mounted) Navigator.of(context).pop(true);
          },
          // Settled not recorded — refused, or cancelled by the server: the
          // fields open again, saying why; the next Send is a new operation.
          onSettledNotRecorded: (f) => setState(() {
            unsureOp = null;
            failure = f;
          }),
        ),
      );
    }
    final f = failure;
    final m = message;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (f != null)
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: FailureNotice(key: const Key('stock-failure'), english: stockFailureCopy(f).english, tagalog: stockFailureCopy(f).tagalog),
        ),
      if (m != null)
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: FailureNotice(key: const Key('stock-blocked'), english: m.english, tagalog: m.tagalog),
        ),
      const SizedBox(height: 12),
      sending ? const LinearProgressIndicator() : bilingualButton(sendLabel, onSend, filled: true, key: sendKey),
    ]);
  }
}

/// One unresolved stock submission (R101–R103): what it was, and Send again
/// (unchanged), Check (read only) or Cancel it (the server settles the id —
/// recorded, or cancelled for good). Never sends by itself.
class UnresolvedBox extends StatefulWidget {
  const UnresolvedBox({
    super.key,
    required this.submitter,
    required this.opId,
    required this.onRecorded,
    required this.onSettledNotRecorded,
    this.inForm = false,
    this.firstFailure,
  });

  final StockSubmitter submitter;
  final String opId;
  final VoidCallback onRecorded;

  /// Refused with nothing left to arrive, or cancelled by the server: nothing
  /// was recorded ([StockFailure.opCancelled] for a cancel).
  final ValueChanged<StockFailure> onSettledNotRecorded;

  /// In its own form: "Cancel it and change"; on the Stock tab: "Cancel it".
  final bool inForm;
  final StockFailure? firstFailure;

  @override
  State<UnresolvedBox> createState() => _UnresolvedBoxState();
}

class _UnresolvedBoxState extends State<UnresolvedBox> {
  Bilingual? _note;

  @override
  void initState() {
    super.initState();
    final f = widget.firstFailure;
    if (f != null) _note = stockFailureCopy(f);
  }

  StockSubmitter get _s => widget.submitter;

  Future<void> _sendAgain() async {
    final o = await _s.retry(widget.opId);
    if (!mounted) return;
    switch (o.result) {
      case StockSendResult.recorded:
        widget.onRecorded();
      case StockSendResult.refused:
        widget.onSettledNotRecorded(o.failure ?? StockFailure.unexpected);
      case StockSendResult.unsure:
        final f = o.failure;
        setState(() => _note = f == null ? null : (f.uncertain ? stockFailureCopy(f) : retryRefusedCopy(stockFailureCopy(f))));
      case StockSendResult.blocked:
        break;
    }
  }

  Future<void> _settle({required bool cancel}) async {
    final o = cancel ? await _s.cancel(widget.opId) : await _s.check(widget.opId);
    if (!mounted) return;
    switch (o.result) {
      case StockSettleResult.recorded:
        widget.onRecorded();
      case StockSettleResult.cancelled:
        widget.onSettledNotRecorded(StockFailure.opCancelled);
      case StockSettleResult.pending:
        setState(() => _note = notYetCopy);
      case StockSettleResult.unknown:
        setState(() => _note = stockFailureCopy(o.failure ?? StockFailure.noConnection));
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: _s,
        builder: (context, _) {
          final s = _s.byOp(widget.opId);
          if (s == null) return const SizedBox.shrink();
          final busy = _s.isBusy(s.opId);
          final note = _note;
          return Container(
            key: Key('unsure-${s.opId}'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: WmColors.brownTint, borderRadius: BorderRadius.circular(14)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const BilingualText(notSureLabel, style: TextStyle(fontWeight: FontWeight.w700, color: WmColors.brownDeep)),
              const SizedBox(height: 6),
              Text(s.summary, style: const TextStyle(fontWeight: FontWeight.w700)),
              if (s.lastSentAt != null)
                Text('Sent ${s.sends == 1 ? 'once' : '${s.sends} times'} · last ${clockTime(s.lastSentAt!)}',
                    style: const TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
              if (note != null) ...[
                const SizedBox(height: 6),
                BilingualText(note, style: const TextStyle(fontSize: 13, color: WmColors.danger)),
              ],
              const SizedBox(height: 10),
              if (busy)
                const LinearProgressIndicator()
              else ...[
                Row(children: [
                  Expanded(child: bilingualButton(sendAgainLabel, _sendAgain, filled: true, key: const Key('unsure-send-again'))),
                  const SizedBox(width: 8),
                  Expanded(child: bilingualButton(checkLabel, () => _settle(cancel: false), key: const Key('unsure-check'))),
                ]),
                const SizedBox(height: 8),
                bilingualButton(widget.inForm ? cancelChangeLabel : cancelLabel, () => _settle(cancel: true), key: const Key('unsure-cancel')),
              ],
            ]),
          );
        },
      );
}

/// A saved stock record the phone can no longer read, of this account (R104):
/// Check or Cancel it by its operation id — its payload is never rebuilt, so
/// there is no Send again. Never sends by itself.
class UnreadableBox extends StatefulWidget {
  const UnreadableBox({super.key, required this.submitter, required this.opId, required this.onRecorded, required this.onSettledNotRecorded});

  final StockSubmitter submitter;
  final String opId;
  final VoidCallback onRecorded;
  final ValueChanged<StockFailure> onSettledNotRecorded;

  @override
  State<UnreadableBox> createState() => _UnreadableBoxState();
}

class _UnreadableBoxState extends State<UnreadableBox> {
  Bilingual? _note;

  Future<void> _settle({required bool cancel}) async {
    final s = widget.submitter;
    final o = cancel ? await s.cancel(widget.opId) : await s.check(widget.opId);
    if (!mounted) return;
    switch (o.result) {
      case StockSettleResult.recorded:
        widget.onRecorded();
      case StockSettleResult.cancelled:
        widget.onSettledNotRecorded(StockFailure.opCancelled);
      case StockSettleResult.pending:
        setState(() => _note = unreadablePendingCopy);
      case StockSettleResult.unknown:
        setState(() => _note = stockFailureCopy(o.failure ?? StockFailure.noConnection));
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: widget.submitter,
        builder: (context, _) {
          final s = widget.submitter;
          if (!s.unreadable.any((u) => u.opId == widget.opId)) return const SizedBox.shrink();
          final note = _note;
          return Container(
            key: Key('unreadable-${widget.opId}'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: WmColors.dangerTint, borderRadius: BorderRadius.circular(14)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const BilingualText(unreadableLabel, style: TextStyle(fontWeight: FontWeight.w700, color: WmColors.danger)),
              if (note != null) ...[
                const SizedBox(height: 6),
                BilingualText(note, style: const TextStyle(fontSize: 13, color: WmColors.danger)),
              ],
              const SizedBox(height: 10),
              if (s.isBusy(widget.opId))
                const LinearProgressIndicator()
              else
                Row(children: [
                  Expanded(child: bilingualButton(checkLabel, () => _settle(cancel: false), key: const Key('unreadable-check'))),
                  const SizedBox(width: 8),
                  Expanded(child: bilingualButton(cancelLabel, () => _settle(cancel: true), filled: true, key: const Key('unreadable-cancel'))),
                ]),
            ]),
          );
        },
      );
}

/// The day the goods moved: today unless picked earlier (never later).
class StockDayField extends StatelessWidget {
  const StockDayField({super.key, required this.value, required this.today, required this.onChanged});

  final String value;
  final String today;

  /// Null: locked.
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        key: const Key('stock-day'),
        icon: const Icon(Icons.event_outlined),
        label: Text(value == today ? 'Today · $value' : value),
        onPressed: onChanged == null
            ? null
            : () async {
                final last = DateTime.parse(today);
                final picked = await showDatePicker(
                  context: context,
                  initialDate: DateTime.tryParse(value) ?? last,
                  firstDate: DateTime(2020),
                  lastDate: last,
                );
                if (picked != null) {
                  onChanged!('${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}');
                }
              },
      );
}

/// A small heading over a form field.
class StockFieldLabel extends StatelessWidget {
  const StockFieldLabel(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 14, bottom: 6),
        child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700, color: WmColors.textSecondary)),
      );
}
```

**Modify:** `pubspec.yaml` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/pubspec.yaml b/pubspec.yaml
index 49b27c7..f63013d 100644
--- a/pubspec.yaml
+++ b/pubspec.yaml
@@ -1,7 +1,7 @@
 name: workmate
 description: "A new Flutter project."
 publish_to: 'none'
-version: 0.8.1+1010
+version: 0.9.0+1011
 
 environment:
   sdk: ^3.10.8
```


- [ ] **Step 1: Apply the files above** in WorkMate.
- [ ] **Step 2: Tests.** `flutter analyze` → no issues. `flutter test` → **1,013** pass (36 more: `stock_screens_test.dart` 35, `request_screens_test.dart` 1). `pubspec.yaml` says `version: 0.9.0+1011`.
- [ ] **Step 3: Stop for the user** to review and commit.

### Task 4: Live — 0106 with stock off, the web pushed, 0.9.0 on the test phone

- [ ] **Step 1: Before applying, check live** (MCP `execute_sql`, read-only): `pr_my_requests`'s live body still matches 0085's and `pur_op_begin`'s still matches 0096's (`md5(replace(prosrc, chr(13), ''))` against the function bodies in `0085_workmate_requests.sql` and `0096_purchase_recording.sql`); `pur_op_cancel` and `pur_op_state` do not exist; no `pur_ops` row has kind `cancelled`; `pr_line_from_stock(uuid)` and `pr_portion_from_stock(uuid)` exist (0104); `stk_settings` has no row with `enabled` true (stock off).
- [ ] **Step 2: The user applies the committed 0106** (Task 1 committed first): the whole file, unchanged, once, in the Supabase SQL editor.
- [ ] **Step 3: Verify the live database ourselves** (read-only): the bodies of `pr_my_requests`, `pur_op_begin`, `pur_op_cancel` and `pur_op_state` match 0106's; `pr_my_requests`, `pur_op_cancel` and `pur_op_state` executable by `authenticated`, not `anon`; `pur_op_begin` by neither; stock still off; no `pur_ops` row of kind `cancelled`.
- [ ] **Step 4: Live acceptance.** Run `supabase/tests/2bb_acceptance.sql` through MCP `execute_sql`. Expect `2bb acceptance: all checks passed` — every active worker's and team leader's own list carries `from_stock` = 0 on every line and portion and no money or stock detail; anon cannot call it; the cancel and state functions are signed-in only and `pur_op_begin` nobody's; as the main owner a fresh id reads `none`, cancels to `cancelled` (twice the same), and the operation lock then refuses it `OP_CANCELLED`. It rolls itself back (the one cancel mark goes with it); afterwards check no `pur_ops` row has kind `cancelled`.
- [ ] **Step 5: The user pushes Dacs Web.** Nothing changes on screen while stock is off (Switch stock off… appears only when it is on).
- [ ] **Step 6: Release build** (PowerShell, real WorkMate repo, after the user committed Tasks 2–3): `$env:JAVA_HOME="$HOME\.jdks\jbr-21.0.11"; flutter build apk --release` → `build\app\outputs\flutter-apk\app-release.apk`, **under 50 MB**. Copy to `Documents\WorkMate releases\dacs-workmate-0.9.0-1011.apk`, note its SHA-256. **Install on the test phone only** (`adb install -r`). Do **not** publish (R100).
- [ ] **Step 7: Stock-off checks on the test phone** (record each in *Execution notes*):

| # | Check | Expect |
|---|---|---|
| S1 | staff@ (Buyer switch as the owner set it) opens the app | Shopping list · My purchases · Profile, as in 0.8.1 — **no Stock tab**, no "In warehouse", no Issue from stock, no "From stock" |
| S2 | Record purchase, My purchases, My cash, a purchase's Payments | As in 0.8.1 (nothing recorded — open and close only) |
| S3 | Log out; **W-0007** signs in; open a request | The worker app as in 0.8.1; no "From stock" line |
| S4 | `client_errors` since the install; Supabase function errors | Nothing new |

- [ ] **Step 8: Execution notes** in this plan; memory updated. Stock is still off. Next: Task 5, when the user chooses the launch window.

### Task 5: Launch window — the joint ZZ pilot (Q30), the clean-up, the launch decision

Only when the user says to start. Allow about two hours; no real buyer should record stock or use the old "Add to inventory" tick during it. **Only the user switches stock on.**

- [ ] **Step 1: Before (MCP, read-only):** note `select count(*), sum(amount) from expenses`, the counts of `purchases`, `stk_records`, `stk_cost_moves`, `pr_requests`, and that no folder, item or supplier is named `ZZ 2bc…`. Keep them for Step 6.
- [ ] **Step 2: The user switches stock on** — Dacs Web as the main owner → Requests → Stock → **Switch stock on…**, type STOCK.
- [ ] **Step 3: Set up (owner, Dacs Web).** staff@'s Buyer switch **ON**; check Requests → Stock as staff@ shows **Issue / move** (the server lets staff@ record — if not, stop: staff@ needs Expenses). Projects **`ZZ 2bc pilot A`** (one billing period, *Allow requests* on) with an Additional Works job **`ZZ 2bc pilot A — extra room`**, and **`ZZ 2bc pilot B`** (one billing period with a **₱200** fund, so the ₱300 purchase of P9 is ₱200 on the period and ₱100 on Cover). Catalogue items **`ZZ 2bc cement`** (bag), **`ZZ 2bc wire`** (piece), **`ZZ 2bc sand`** (bag). Supplier **`ZZ 2bc hardware`**. On the test phone as **W-0007**: a request for `ZZ 2bc pilot A`, `ZZ 2bc cement` **6 bag**.
- [ ] **Step 4: Pilot checks** (test phone = staff@ on 0.9.0 unless stated; web = Dacs Web). Record each result in *Execution notes*.

| # | Check | Expect |
|---|---|---|
| P1 | Phone: pull the Shopping list; the app back from the background | **Stock** tab appears (R93); no ₱ on any stock screen |
| P2 | Phone: Record purchase, **Warehouse**, `ZZ 2bc cement` **10 bag** ₱1,000 + delivery fee ₱50, supplier ZZ 2bc hardware (as 2A) | Recorded once. Stock → **To receive (1)**: "Not matched yet" |
| P3 | Phone: **Received…** 6 | Recorded; the line: received 6, still awaited 4. Web Receiving: the same |
| P4 | Web (staff@ or owner): **Match…** the line to `ZZ 2bc cement`, 1 bag = 1 bag. Phone: **Received…** 4 more | Stock tab: ZZ 2bc cement **10 bag** in the warehouse |
| P5 | Phone, Shopping list: the W-0007 cement line | "**In warehouse: 10 bag**"; **Issue from stock** (R94) |
| P6 | **Issue from stock**: item, place and request fixed, quantity **6** offered; change it to **4**, Send | Recorded once; the line: **From stock 4 bag**, Still to buy 2. Web, Owner approvals: a **cost assignment** card (₱ shown to the owner only) |
| P7 | Web (owner): **Approve** | ZZ 2bc pilot A's Project Control shows "From warehouse — ZZ 2bc cement". Phone Recent: "Cost assigned" — **no ₱**. W-0007 on the phone (log out / in): the request line says **"From stock: 4 bag · Galing sa stock"**, no ₱ |
| P8 | Phone, Recent: the issue → **Return…** 1, Send | The return form shows no From / To; recorded; web: a **Back to company stock** card → owner **Approves**. W-0007 still sees **From stock: 4** (R95) |
| P9 | Phone: Record purchase on **ZZ 2bc pilot B**: `ZZ 2bc wire` **2 box** ₱300. Web: **Match…** to `ZZ 2bc wire`, **2 box = 100 piece** (note). Phone: **Record leftovers** → B → that purchase → **50**, **Brought to the warehouse** | Leftovers recorded; the warehouse has 50 piece of ZZ 2bc wire (their cost stays B's, R73) |
| P10 | Phone: **Issue / move** — ZZ 2bc wire, warehouse → ZZ 2bc pilot A, 30, no request: Send with no reason → then reason "ties" | First: "Goods going to a project fill a request, or say why they are needed." (and the Tagalog line), nothing sent; then recorded. Web: a **cost transfer** card B → A |
| P11 | Web (owner): **Reject** "wrong project" → staff@ on the web **Ask again** "see photo" → owner **Approves** | Phone Recent: "Cost move rejected — kept with source", then "Cost transferred". A gains ₱90 (30 of 100 piece of a ₱300 line); B gives it back in proportion — **₱60 off its billing period, ₱30 off Cover** (owner's Project Control only) |
| P12 | Phone: **Issue / move** — ZZ 2bc cement, ZZ 2bc pilot A → ZZ 2bc pilot B, 1, reason "formwork". Owner approves | Transfer A → B approved |
| P13 | Phone: Airplane ON → Issue / move ZZ 2bc cement warehouse → ZZ 2bc pilot B, 1, reason "x", **Send** | "Not sure this was recorded…" and "Stock needs signal…"; the form **locks** (the quantity cannot be changed; only Send again / Check / Cancel it and change). Web History: nothing new (R101) |
| P13b | Still in airplane mode: Back; the Stock tab; then **swipe the app away and open it again** | The Stock tab shows "Issued 1 bag ZZ 2bc cement — Warehouse → ZZ 2bc pilot B" with Send again / Check / Cancel it; Issue / move, Record leftovers and the shopping list's Issue from stock are **gone**; **nothing was sent** by opening (web History still nothing) (R103) |
| P13c | Airplane OFF → **Check** | "Not recorded yet — it may still arrive. Send it again, or cancel it." (R102). **Send again** → recorded **once** (web History: one issue of 1 bag); the box goes; Issue / move is back |
| P13d | Airplane ON → Issue / move ZZ 2bc cement warehouse → ZZ 2bc pilot B, **2**, reason "y", **Send** (locks). Airplane OFF → **Cancel it and change** | "This record was cancelled — nothing was recorded…"; the fields unlock. Change 2 to **3**, **Send** → recorded once (web History: one issue of **3**, none of 2) (R102). MCP, read only: a `pur_ops` row of kind `cancelled` for staff@ |
| P14 | Web (staff@): History → that last issue → **Reverse** "mistake" | Phone Recent (pull): **Reversed** |
| P15 | Web: **Count** ZZ 2bc cement at the warehouse: **6** counted (books **7**: 10 − 4 issued + 1 returned), reason **damaged** → owner confirms | Owner: Company stock shows a loss of 1 bag; phone: Stock **6 bag** in the warehouse |
| P16 | Web: **Opening stock** ZZ 2bc sand **3 bag** at ZZ 2bc pilot A — extra room → owner confirms | Phone Stock: sand 3 at that job |
| P17 | Web (owner): correct the ZZ 2bc wire purchase's price; then try to void it | **Refused** — "The owner approved stock cost moves that rely on this purchase line's price and quantity…" (`STOCK_COST_IN_USE`), and the void refused (Q22). Nothing changed |
| P18 | staff@ on Dacs Web: Requests → Stock and Project Control for ZZ 2bc pilot A | States, never a cost move's ₱ (R83). Phone, as staff@ and as an owner account if one is at hand: no ₱ on any stock screen (R92) |
| P19 | Log out; **W-0007** on the test phone | The worker app; "From stock" on the request; **no Stock tab**, no ₱ |
| P20 | `client_errors` since Step 2; Supabase function errors | Nothing new |

- [ ] **Step 5: Clean-up (the user, SQL editor).** Open `supabase/tests/2bc_pilot_cleanup.sql`; run it **as is** (dry run): expect a red **DRY RUN OK** listing what it would remove — about 3 projects, 3 items, 2 purchases, 1 supplier, 1 request, and every ZZ stock row — and nothing changed. If it says **GUARD: …**, stop and send the message: real data is mixed in. Then change `v_dry boolean := true;` to `false;` and run again: **CLEAN-UP DONE**.
- [ ] **Step 6: Check (MCP, read-only):** no folder, item, supplier or purchase named `ZZ 2bc…`; the counts and the expense sum from Step 1 back exactly; the history guards (`stk_events_no_change`, `stk_moves_no_change`, `stk_covers_no_change`) on. The receipt photo files of P2 and P9 stay in Storage (delete them by hand only if wanted; never the month folder). staff@'s Buyer switch back to what the owner wants.
- [ ] **Step 7: The user decides.**
  - **Launch:** keep stock on. Dacs Web → Attendance → **App updates** (owner): upload `dacs-workmate-0.9.0-1011.apk` (WorkMate stream). Buyers update; workers' "From stock" is already live (0106). Tell the office the old "Add to inventory" tick is gone (Q29).
  - **Not yet:** Dacs Web → Requests → Stock → **Switch stock off…**, type OFF (R97). The ZZ rows are already gone; nothing else changed.
- [ ] **Step 8: Execution notes**; memory updated.

---

## Self-review (against the answers)

| Answer | Where |
|---|---|
| Q26 (the phone: receipt, issue, leftovers, returns, moves; online only; workers see From stock) | R89–R91, R95; Tasks 2–3 (`MoveScreen`, `ReceiveSheet`, `LeftoverScreen`, `StockSending`); 0106 + `request_detail_screen.dart`; tests "Received: part of a line…", "an unmatched line can still be received…", "Recent: … Return brings the issue back", "unplanned issue needs a reason…", "leftovers: a project purchase…", "2B-b: what the office sent from stock shows on the line…"; PGlite "a worker sees From stock…", "a team leader sees…"; pilot P2–P14, P19. **R89 asks the user about "office staff".** |
| The user's review of Task 2 (rev 4: unreadable saved data) | R104; `PrefsStockPendingStore` (`StockPendingLoad`, `UnreadableSubmission`, `dropUnreadable`), `StockSubmitter.unreadable` / `recoveryNeeded` / `blocked`, `UnreadableBox`, the recovery error; `MemoryStockPendingStore` moved to `test/stock/stock_fakes.dart`; tests — **malformed data cannot unblock a new send**: "a damaged entry of this account blocks new sends; Check and Cancel settle it by its id, never its payload", "an entry with no readable account blocks every account…", "an entry of this account with no readable operation id needs recovery…", "storage that is not a list at all: everything blocked…", "a damaged saved record: the Stock tab offers Check and Cancel…", "damaged storage: a recovery error, nothing can start…"; **nor disappear on the next save**: "a damaged entry survives every later save, word for word…", "…is never overwritten", "storage that is not a list at all: … nothing ever overwrites it", "…the stored text is never touched"; also "a damaged entry the server had recorded…", "storage turning unreadable while open…", "readable entries beside damaged ones still read…", "a stock server with no store on the phone: no Stock tab at all" |
| The user's review of rev 2 (R102: the server settles, not a clock) | R102; 0106's `pur_op_cancel`, `pur_op_state`, `pur_op_begin`; `StockSubmitter.check` / `cancel`; PGlite "Cancel it: under the operation lock…", "**the original request arriving after cancellation and a new submission: only the new submission records**", "0106's pur_op_begin is 0096's, unchanged but for…"; two sessions 1–3 (`2bb_concurrency.mjs`); acceptance C3–C5, D1–D5; phone "Check is read only…", "Cancel: the server settles it…", "the original arriving after the cancel and a new submission is refused…", "a cancel whose answer was lost…", "Send again of a cancelled id is refused…", "a changed quantity after a timeout: only once the server cancels the id…", "Cancel it and change, when the server finds it was recorded…", "Cancel with no signal…", "after a restart, Cancel it on the Stock tab…"; pilot P13d |
| The user's review of rev 1 (lost answers) | R101–R103; `StockSubmission`, `StockSubmitter`, `PrefsStockPendingStore`, `StockSending`, `UnresolvedBox`; tests — **changed quantity after a time-out**: "a lost answer locks the form…", "a changed quantity after a timeout: only once the server cancels the id…", "Send again sends the saved payload byte for byte…", "a payload never travels without its own operation id"; **reopening**: "closing the form keeps it…", "closed, then opened again: the shell keeps the Stock tab…"; **restart**: "after a restart with no signal: it is still there and nothing is sent by itself", "after a restart with signal: a check (read only) finds it was recorded…", "the settings file keeps it word for word across a fresh read…", "after a restart, another account on the same phone neither sees nor sends it"; also "a lost answer that was in fact recorded…", "an unknown error … is unsure too", "a refusal on the first Send settles it; on a Send again it does not…", "nothing is sent or cancelled by itself…"; PGlite "a repeated operation id gets the first answer…"; pilot P13–P13d |
| Q28 (who sees values) | R92; no value field in `stock_models.dart`; tests "stock on: the tab shows quantities per place, and never a peso", "Recent: cost states without values…"; 0106 test "0106 changes nothing else…" (no money key for workers); pilot P7, P18–P19 |
| Q30 (the joint pilot; guarded clean-up; launch only after it passes) | R97–R99; Task 5; `2bc_pilot_cleanup.sql`; PGlite "the clean-up removes every ZZ pilot row and nothing real…", "the clean-up refuses…", "every other clean-up guard refuses too…" |
| Q9 (In warehouse is a hint, no reservation) | R94; the shopping list hint; `NOT_ENOUGH` refusal test |
| Q3, Q6–Q8, Q10 (leftovers, receiving in parts and before a match, issuing, returns) | R90; the forms' checks mirror 0104's; pilot P3–P4, P8–P9 |
| Q22–Q23 (void refused, reversals on the web) | R96; pilot P14, P17 |
| Q29 (one stock path) | 2B-a (unchanged); R97 says switching off brings the old tick back |
| Q1 (stock off until launch) | Task 4 changes nothing while off (S1–S4); only the user switches it on (Task 5) |

No placeholders. Every task ends with its whole suite green on its own.

## Proof

Built in scratch clones: Dacs Web on `db54690` — Task 1 = `6e23d32` (committed by the user as `19b9b5c`, every file identical); WorkMate on `7996311` — Task 2 = `b20f74f`, Task 3 = `840e0bc` (revision 3 was `9e71fb4` / `a7b06ad`; revision 2 `3dedc50`; `253cdce` / `3ec1d19`; revision 1 `7e93f40`; `88f3dea` / `c294da4`).

- **Revision 4 (the user's review of Task 2: unreadable saved data).** Revision 3 skipped a saved entry it could not read — so it no longer blocked new sends and the next save erased it. Now the store reads entry by entry and keeps an unreadable one exactly as stored (`StockPendingLoad`: readable, unreadable, damaged), every save writes it back, a damaged stored text refuses every save, and only the server settling an id removes an entry (`dropUnreadable`). Tests on the real settings-file store: **malformed data cannot unblock a new send** — a damaged entry of this account blocks (Check `none` keeps it; Cancel → the server's `cancelled` → only then it goes and a send is allowed; its payload never sent), an entry with no readable account blocks every account, one with no readable operation id blocks its account, a text that is not a list blocks everything; **nor disappear on the next save** — another account's damaged entry stays word for word across a new submission's save and the save that settles it, a no-account entry survives a direct save, a damaged text is left untouched by save and drop; plus a damaged entry the server had recorded (Check, it goes, nothing sent), storage turning unreadable while open (the new submission is not sent, the form stays editable, nothing new goes after), and readable entries beside damaged ones. Screen tests: the Stock tab shows a damaged record with Check and Cancel and no Send again, holds back new stock records, and settles it on Cancel; with no signal Cancel changes nothing; damaged storage shows the recovery error and its text is never touched; with no store on the phone there is no Stock tab. The in-memory store moved to `test/stock/stock_fakes.dart`. Writing it found a gap from revision 2: a save failing before a new submission's first send locked its form on a submission no longer kept (no buttons) — now that submission is refused (nothing left the phone) and new sends stop. 0106 and Task 1 are unchanged.
- **Revision 3 (the user's review: the server settles, not a clock).** 0106 now holds the settling on the server: `pur_op_cancel` takes the very lock every write takes first (`pur_op_begin`'s, per account and id) and either reports `recorded` or writes a `cancelled` mark; `pur_op_begin` — 0096's, byte for byte but for the new refusal (a test reverses the change and compares) — refuses a cancelled id `OP_CANCELLED`; `pur_op_state` reads. **The test the review asked for**, on PGlite: the original request (4) is cancelled before it arrives, a new submission (6) records, then the original arrives and is refused — one issue of 6, 4 left in the warehouse, the original's id `cancelled`, the new one `recorded`. On **real PostgreSQL, two sessions** (`2bb_concurrency.mjs`, 15 rounds each): a cancel started while a recording holds the lock **waits** and then reports `recorded` (the record stands); a recording started while a cancel holds the lock **waits** and then is refused `OP_CANCELLED` (nothing recorded); both released together (the cancel 0–40 ms late) — 11 recorded-and-reported, 4 cancelled-and-refused, never both, no deadlock. Also: a cancel of a recorded id changes nothing; cancelling twice gives the same answer; ids are each account's own (a buyer cancelling the id staff@ recorded cancels only the buyer's own, and staff@'s record stands); a cancelled id is refused by issue, receipt and leftovers alike; signed-in only. The live acceptance script gains C3–C5 (grants) and D1–D5 (a fresh id reads `none`, cancels to `cancelled`, then the lock refuses it — all rolled back), and fails as it should on a database whose `pur_op_begin` is 0096's or whose cancel is open to anon. Writing D5 found that a stock write checks "stock on / may record" **before** the lock — so while stock is off a late request stops at `STOCK_OFF`; still never recorded, and D5 calls the lock itself. On the phone the two-minute rule is gone: Check never unlocks anything ("Not recorded yet — it may still arrive. Send it again, or cancel it."), Cancel unlocks the form only on the server's `cancelled`, closes it as recorded on `recorded`, and changes nothing without an answer; a Send again refused for another reason does not settle it, `OP_CANCELLED` does; a cancel whose answer was lost is settled by a later Check; checking on open never sends or cancels.
- **Revision 2 (lost answers)** still stands: id and payload saved together before sending; a lost answer locks the form; Send again sends the saved payload byte for byte; nothing new until settled; kept across closing and restarting; never sent by itself; one account's own — with its tests for a changed quantity after a time-out, reopening (the Stock tab keeps it, even switched off) and a restart (the settings file written, the app torn down, read afresh: no signal — still there, nothing sent; signal — a recorded one found by Check and dropped; another account neither sees nor sends it).
- **Task 1:** `npm test` green (41 suites, 1,319 checks); `npm run test:sql` green (**34 suites, 1,010 checks**): `2bb_phone`'s 16 — From stock for workers and leaders (line and each weekly portion), a return keeping it and a reversal taking it back, 0106's answer equal to 0085's key for key apart from `from_stock`, the grant; the settling tests above and the first-answer replay; the acceptance script passing as written **and failing** when it should; the **whole pilot simulated** beside real data and cleaned (dry run changes nothing; only real rows left; history guards back on); every clean-up refusal (5 + 9 spoiled pilots) and its after-checks stopping four broken copies — and `2bb_concurrency`'s 3. Every earlier suite unchanged (the simulated pilot runs purchases, matches, receipts, issues, returns, moves, cost moves, counts and opening stock through 0106's `pur_op_begin`).
- **Tasks 2–3:** `flutter analyze` clean; `flutter test` **977** after Task 2 and **1,013** after Task 3 (Task 2 stands green on its own). The fake stock server answers a repeated id like `pur_ops` and refuses a cancelled one like 0106; the screen tests run the real buyer shell over it.
- **Found while building:** the request line chooser kept its choice when the item or destination changed — now it starts afresh; the shell's first stock refresh notified during start-up — the listener is added after it; the leftover list used Flutter's deprecated radio API — now `RadioGroup`; the shell had no way back for a failed pilot — **Switch stock off…** (R97); a settled refusal of a Send again reopens the form with the reason (nothing was recorded) instead of closing it.
- **Breakage run: 119 / 119 caught** — each rule broken on purpose, one at a time, and a suite must fail. For revision 4, 13 new breaks: damaged storage read as empty, an unreadable entry skipped on load, a save dropping unreadable entries, a save overwriting damaged storage, any text taken as an id, unreadable entries not blocking, an entry of no known account not blocking, an unreadable entry dropped without the server's word, a damaged entry's Check `none` taken as settled, a damaged entry cleared with no answer, storage failing mid-way not stopping new sends, no recovery error, the damaged entry not shown — the first run missed one (the damaged record's box with no signal), closed with a test, then caught; four older breaks were re-aimed where revision 4 repeated their code (each twin now broken on its own) and one, for the skipping it replaced, was dropped. For revision 3, 18 new breaks: on the server — the lock ignoring a cancelled id, the cancel taking another lock or no lock, a recorded operation reported cancelled, a cancel that leaves the id usable, Check reading a cancel as recorded, anon allowed to cancel, another account's id looked at, the acceptance script not checking the lock's refusal; on the phone — a refusal of a Send again taken as final, `OP_CANCELLED` on a Send again left unsure, a Check's `none` taken as settled, dropping without the server's word, a Check that cancels, checking all that cancels, unlocking with no answer, a `recorded` answer to Cancel taken as cancelled, `OP_CANCELLED` read as an unknown error. The first run missed one — another account's id looked at by the cancel; the test had checked per-account *state* but not per-account *cancel* — closed (a buyer cancelling the id staff@ recorded), then caught. Revision 2's five timer breaks were removed with the timer; the rest (revisions 1–2: 0106, the acceptance script, the clean-up and each of its 14 refusals, Switch stock off, the phone's screens, forms, models and lost-answer handling) are all caught. Earlier runs: revision 2 94 / 94 (one gap closed), revision 1 75 / 75 (five gaps and one mis-written break closed).
- Every file was restored and compared byte for byte after each breakage run.
- **Not tested here:** `main.dart`'s lines wiring the real stock client and the settings-file store (Task 4's S1 and Task 5's P1, P13b and P13d check them on the phone), and `SupabaseStockRemote` against the live server (the acceptance script checks the server side live; the pilot the phone). The live database was not changed; one read-only query on 27 Oct (role settings).

## Rehearsal

The plan's own text was applied to fresh clones of both real repos — Dacs Web at `db54690`, WorkMate at `7996311` (cloned with `core.autocrlf=false` and `core.longpaths=true`; no signing key in either) — every Create block written as given, every Modify block through `git apply --ignore-whitespace` (after `--check`), then Task 1's CRLF command:

- **Clean clones:** Dacs Web 12 blocks, **all 12 files byte-identical** to the tested build (`6e23d32`); WorkMate 27 blocks, **all 27 files byte-identical** (`840e0bc`); no other file touched in either.
- **With the user's own uncommitted one-space `admin.html` edit made first:** the same — `admin.html` = the tested file plus that edit.
- **Task 1 alone** (a third clone): its 12 files identical to `6e23d32` (and the user's commit `19b9b5c` holds exactly those files).
- **The rehearsed WorkMate copy:** `flutter test` → 1,013 pass.
