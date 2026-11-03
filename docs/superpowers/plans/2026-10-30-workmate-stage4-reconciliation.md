# WorkMate Stage 4 — Reconciliation and reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner one place that shows the purchase money adds up and what is still waiting — and make "Unpaid" mean really unpaid — **without moving a peso**: a Reconciliation tab (Requests → Purchasing), "Cover is right" for lines waiting for a billing period, Bills to check after stock cost moves, "Paid now?" and a supplier on Project Control's Add Expense, and a Reports note for months changed later.

**Architecture:** One migration, **0109**, on top of 0096–0108. It adds three private history tables — `rec_cover_marks` ("Cover is right"), `rec_cost_row_log` (every cost-move expense row as it is added or removed, by trigger, because a reversal deletes its rows) and `rec_bill_checks` ("Bill checked") — plus `pur_op_reservations` (every Add Expense operation id, registered before it is sent, so the server can settle a save the browser lost — R120), and `rec_*` functions that **read** the records the money model already keeps (purchases, expense rows, lots, cost moves, payments) or record an owner decision that moves no money. Dacs Web: a new `js/reconciliation-admin.js` (the tab, owner accounts), "Paid now?" + supplier and the Reports note in `js/expenses-module.js` (the server already saves a payment with its purchase — 2A-4 Q3), a new `js/expense-pending-save.js` (an Add Expense save is kept, id and body, until the server answers — one at a time per account across tabs), and the scripts the pilot and the payments step need. Nothing writes an expense row, a payment from a guess, a billing period or a client bill; nothing feeds Spent, Earned or Profit.

**Tech stack:** PostgreSQL / Supabase (plpgsql), vanilla JS, Node test files, PGlite, embedded PostgreSQL for the two-sessions tests.

**Spec:** answers: [Stage 4 questions](../specs/2026-10-30-workmate-stage4-reconciliation-questions.md) — **Q1–Q7 and Q9–Q15 = A; Q8 = A as an approach only (no purchase confirmed paid); Q6 = A approves the feature only (the two Eagle Residence lines' Cover is not confirmed)**, 30 Oct 2026 · guide: [WorkMate guide](../specs/2026-09-29-workmate-prototype-and-workflow-guide.md) §14, §16 (Stage 4), §17, §18 · built on: plans [2C](2026-10-26-workmate-stage2c-cost-moves.md) (0105, cost moves), [2A-4a](2026-10-22-workmate-stage2a4a-payments-server-web.md) (0102, payments), [3a](2026-10-28-workmate-stage3a-tools.md) (0107)

**Repo:** **Dacs Web** only (base `db0b4fe`). No phone part (Q2): 0E + 3b and office-staff stock on the phone stay separate.

**Status (3 Nov 2026):** Revision 4. **Task 1 committed (`f007a13`, pushed 2 Nov); 0109 live and verified (1 Nov). Task 2 merged on 3 Nov; the user's browser check as owner passed (Task 2, Step 3). Committed as `4c1a79e` and pushed 3 Nov; the checks on the live site passed (Task 3, Steps 6–8). Task 4 (the ZZ pilot) done 3 Nov; one finding open, see *Execution notes*. Task 5 closed: script not needed, payments entered manually.** See *Execution notes*. What follows is revision 4 as reviewed on 31 October. Revision 4 fixes the user's review finding on revision 3: Add Expense kept each save for the account that pressed Save (A), but sent its requests through the shared Supabase client, whose session follows whoever signed in last — if another tab signed in as B during an upload, A's purchase and payment could be submitted as B, and A's save then cleared. Now **every request of a save carries A's own sign-in** (a client bound to A's token), and **before each request the browser checks A is still the one signed in**: a change stops every further request and keeps whatever is unsettled for A, to settle when A signs in again (R121). Found while doing this, and fixed: a later attempt the server refused for an unrelated reason (an expired sign-in, a permission changed) forgot the save, although its first request may have been recorded — now it stays, locked, until *Cancel it* settles it (R119). Revision 3 had fixed the findings on revision 2: tabs take turns per account and an answer clears only its own save (R119); every Add Expense id is registered before it is sent, and a save whose id the browser cannot read is settled only by the server (*Check with the server*, R120) — no clearing by hand. The Reports note (R115) is as the review confirmed in revision 3. The code below was built and tested first in a scratch clone of Dacs Web on `db0b4fe` (one commit per task, every suite green after each); every important rule was broken on purpose to prove a test catches it (*Proof*); and the plan was re-applied to fresh clones from its own text and compared byte for byte (*Rehearsal*).

## Global Constraints

- **Outside the money model (Q1):** 0109 and `js/reconciliation-admin.js` read and point. They never write an `expenses` row, a billing period or a client bill, and nothing feeds `_projSpent` / `_projEarned` / `_projMargin` / `_recognisedProfit` — `money-math.test.js` §Y fences it.
- **A payment only from the person's own choice (the user, 30 Oct):** Project Control's "Paid now?" (default *Not paid yet*) or a confirmed entry in `4_confirmed_payments.sql`. **Never** from "Paid with", a receipt photo or anything else on record. As committed, the payments script records nothing.
- **A save is recorded once (reviews, 30–31 Oct):** an Add Expense save that may already be on the server is never sent under a second id, never sent with edited values, and never forgotten until the server has answered — closing the form or reloading the page keeps it. One save at a time per account across tabs and windows; an answer clears only its own save; every request carries the sign-in of the account that pressed Save, and a sign-in change stops it, keeping what is unsettled. Browser storage that is blocked, full or damaged sends nothing new and discards nothing; a save whose id cannot be read is settled only by the server — never cleared by hand; another account never sees, sends or settles it (R119–R121).
- **Preserve every real record (the user, 30 Oct):** the 19 purchases the user confirmed real — and every other real row — stay exactly as they are; the payments script, as committed, names none of them. Task 3's acceptance rolls itself back; the live check only reads; Task 4's clean-up removes only `ZZ 4 pilot…` rows and stops on anything mixed.
- **Pending, not built around:** whether Cover is correct for the two Eagle Residence lines (Q6) is **the user's decision**; no task marks Cover on a real line. The payments were entered by hand on 31 Oct (Task 5, closed); **that does not confirm their recorded dates or sources: that verification is pending**, and no task records, changes or voids a payment without the user's specific instruction.
- **Who (Q3):** owner accounts allowed Expenses (`rec_owner`). Petty cash, own money, returns, disputes and Overpaid stay the **main owner's** (2A-4) — for any other owner account the server leaves those keys out. Staff never see the tab; staff without the Buyer switch never see "Paid now?".
- **New data needs real DB columns:** every table and column 0109 uses is created by 0109 (or exists since 0096–0107). 0109 redefines **no** earlier function. Task 3 Step 1 checks none of its objects exist yet.
- **Migrations:** next number = highest + 1 = **0109** (highest on disk: `0108_tools_crew_numbers.sql`). The user applies the **committed** file, unchanged, once (SQL editor); we then verify the live database ourselves.
- **Dates:** the tab's default range and the Reports note build days from local parts, never `toISOString()` (PH is UTC+8).
- **Mirror portal edits:** not needed — `admin.html` only; the client and partner portals never read these tables.
- **The user commits.** Executors never run `git commit` or `git push`. Each task ends at a "stop for the user" step. The user's own uncommitted edit in `admin.html` stays as it is: apply the Modify blocks with `git apply --ignore-whitespace`, which leaves the rest of the file alone.
- **CRLF files:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are CRLF. Task 1's Step 1 restores CRLF after applying (the diffs are shown with LF).

## Rulings (Stage 4)

R1–R104 stand (plans 2A-2 … 2B-b; 3a's T1–T21 too). New, found while building and testing this plan. **For the user's approval with the plan.**

| # | Ruling |
|---|---|
| R105 | **Who.** Every `rec_*` call needs an owner account allowed Expenses (`OWNER_ONLY` / `NOT_ALLOWED` otherwise) and sees its own company only. Inside, the cash figures — petty cash held and its shortfall, what the company owes a buyer, own money to review, returns to confirm, disputed handovers, Overpaid — reach the **main owner** only, as 2A-4 decided; for any other owner account the keys are left out. |
| R106 | **Where every purchase peso is (Q4).** For each **recorded** purchase made between two days: `recorded` (its receipt total) = `own` (its own rows — lines, delivery fees, discounts — plus cost-move rows on the project that bought the lot) + `other` (cost-move rows on any other project) + `company` (what the company still holds of its lots, or a warehouse line not yet in stock at its value) + `loss` (approved, unreversed company stock loss). The two sides come from **different records** (expense rows vs. receipt totals, lots and cost moves), so `difference` must be ₱0; the tab calls a difference a bug to report, never a business event. Voided purchases are listed apart and count nowhere; a corrected purchase is its correction. Default range: this month (local days); at most 3,700 days; print and CSV. |
| R107 | **"Cover is right" (Q6).** An owner account clears one line's "Office review" flag (`needs_funding_review`) with a reason (1–500 characters) — only a line that is waiting (`NOT_WAITING`) and wholly on Cover (`NOT_COVER`), on a recorded purchase (`BAD_STATE`). Its rows never move: they stay on Cover and in Spent. Every place that shows the mark reads the flag, so it clears everywhere at once: the Office review tag in Project Control, Expenses and Purchasing, and — found in self-review — the words "office review needed" for Cover material with no billing period on the billing-periods page and in Reports (screen, print, CSV), which now follow the flag too (words only; no total changes). The tab reloads the flags after a mark or a withdrawal. |
| R108 | **A mark follows the line as it was marked.** A correction re-creates a purchase's lines and re-checks their billing period as always (0096's `pur_charge_rows` sets the flag again if there is still no period), so a mark keeps a fingerprint of the line (project, amount, purchase date and where its rows sit) and **only a line's newest mark can apply**. After a correction the line waits again and the owner marks it again if Cover is still right. A mark is withdrawn, with a reason, only while it applies (`CHANGED_SINCE` otherwise); withdrawing puts the flag back. Marks are never deleted. |
| R109 | **No automatic re-funding (Q6 — C not chosen).** A waiting line says when a billing period for its month exists **now**; the office then saves the row again and the server re-funds it, as today. |
| R110 | **Bills to check (Q10).** A reversal deletes its cost move's expense rows (0105), so the months a move changed are logged as they happen — a trigger on `expenses`, cost-move rows only — and back-filled once from the rows already there. One item per cost move, transaction and direction: an **approval** (rows added) or a **reversal** (rows removed) — two items even inside one transaction; each side names its project and **billing period** (`period_id`, `folder_id`). An owner account ticks **"Bill checked"** (or un-ticks), with an optional note (≤ 500); the latest tick counts; ticks and the log are never changed or deleted. No bill is ever changed (Q25). |
| R111 | **Waiting (Q5)** counts only: lines waiting for a billing period, bills to check, cost moves and purchase changes waiting for approval, Unpaid / Partly paid purchases, stock records and tools (Lost / Retire) waiting for the owner — and, for the main owner, own money to accept, returns to confirm, disputed handovers, Overpaid. Each links to where it is decided; nothing is decided from the list. |
| R112 | **Money still out (Q9).** Unpaid and Partly paid balances by supplier (the listed supplier's name, else the typed name, else **"No supplier recorded"**); purchases whose payment is not tracked, counted apart and never as owed; supplier credit left; for the main owner, Overpaid and each buyer's cash held, shortfall, owed and own money to review. |
| R113 | **"Paid now?" on Add Expense (Q7).** Shown to owner accounts and Buyer staff only (`window.currentCanBuy`), under More details; every opening starts at **Not paid yet**. *Paid in full* / *Paid part* send one payment **with** the purchase — the server saves both or neither (`pur_record`, 2A-4 Q3) — paid on the purchase date. *Paid from*: the company (owner accounts), or a staff buyer's own petty cash or own money (the server fills in who). *How* starts from "Paid with" as a hint until changed. A supplier credit is used from Purchasing's form, not here. Edit Expense is unchanged (later payments: Purchasing → Record payment). **"Paid with" alone never records a payment** — tested for every choice on the form. The save itself follows R119. |
| R114 | **Supplier on Add Expense.** Optional, for the same accounts. A supplier from the list (matched by "name · branch", any case) is sent by its id; anything else as the typed name (≤ 200). A later correction from Project Control keeps it (0097's `pur_inherit` keeps `supplier_id`). |
| R115 | **The Reports note (Q11) — approvals and reversals (review rev 2).** A billing period changed by a stock cost move **after its month ended** is named under Billing Allocation Performance, from the server's **lasting** log of cost-move rows (R110's items, read through `js/reconciliation-admin.js`) — never from the expense rows, which a reversal deletes. So both show: "October 2026: changed Nov 5, 2026 by a stock cost move: −₱500.00 (Cement: Barlin → Bagong)" and "October 2026: changed again Dec 3, 2026 — a stock cost move was reversed: +₱500.00 (Cement: Barlin → Bagong)" — per period, cost move, direction and day (a split's period and Cover parts summed), in local days. Loaded fresh on each Reports visit. Owner accounts only; on the Reports screen and its print (not billing summaries). The figures stay today's; no total reads the note. |
| R116 | **The confirmed-payments script (Q8).** As committed it records nothing (`NOTHING CONFIRMED`). An entry is copied from the user's own confirmation — reference code, expected total, date paid, amount, where the money came from, **how (stated, never inferred)**, and the buyer's e-mail for petty cash or own money. Before changing anything it refuses a code that matches not exactly one purchase, a voided purchase, a changed total, a purchase that already has a payment / refund / credit, more than the total, a date before the purchase or in the future, a duplicate, a missing field. Each payment goes through `pur_pay` as admin@; dry run first; a payment never changes an expense row (checked). **Closed 3 Nov (Task 5): script not needed, payments entered manually; it stays empty.** |
| R117 | **Company stock stays out of Project Control Reports (Q12); no sign-off and no new lock (Q13); the old `inventory` table stays (Q15).** Nothing is built for these. |
| R118 | **The pilot's clean-up** (`4_pilot_cleanup.sql`) is 2B/2C's for the `ZZ 4 pilot` names, plus Stage 4's rows: the ZZ purchases' payments and money history (company money only — a ZZ payment from a buyer's petty cash or own money **stops** it, so no buyer's balance can change), the "Cover is right" marks on ZZ purchases, and the log and ticks of ZZ cost moves. Its history guards are off for the one transaction and checked back on. |
| R119 | **An Add Expense save is recorded once (reviews rev 2–3).** A press of Save builds the body **once** — uploads included — and keeps it with its operation id in this browser's `localStorage`, per account that pressed it (`js/expense-pending-save.js`), **before** sending it: written, then **read back**; the id is also kept on its own. **One save at a time per account, across tabs and windows:** every step that reads and changes what is kept — Save, *Send it again*, *Cancel it*, the check on opening, *Check with the server* — runs under the browser's lock for that account (Web Locks, `navigator.locks`, `ifAvailable`); a second tab pressing while the first builds, uploads or sends is told "Another tab or window is saving an expense…" and sends, uploads and changes nothing; a browser without the lock sends nothing. **An answer clears only its own save** — never another found in storage. The server answers → **forgotten**: saved, or refused on its **first** sending (one transaction: nothing saved — the form unlocks, says why, and keeps what was typed). A **later** attempt refused for another reason (an expired sign-in, a permission changed) says nothing about the first request, which may have been recorded: the save stays, locked, with the reason, until *Cancel it* settles it; refused because it was cancelled for good (`OP_CANCELLED`) → forgotten. **No answer** → kept, and the form **locks**: nothing can be edited and no new entry starts; Save only shows it. Closing the form or reloading the page keeps it; opening Add Expense asks the server (`pur_op_state`): recorded → forgotten and said so; cancelled (from another tab or device) → forgotten and said so; not yet → still locked. **Send it again** resends the **same id and body** — the server records it once, or replays its first answer — never the form's fields; if another tab of the same account already settled it, nothing is sent and the form is cleared ("check the list"). **Cancel it** (`pur_op_cancel`): the server confirms it had been recorded, or makes sure it never will be, so the first request arriving late is refused (the phone's rule, 2B-b R102). **Storage is trusted only when it proves itself.** *Blocked* — the browser refuses it, silently drops a write, or is full (site data switched off, some private windows): **nothing is sent or uploaded**, nothing is kept in page memory instead (a reload would lose it), and a save kept before storage was blocked stays, keeps the form locked, and is settled once storage is back. *Damaged* — what is kept cannot be read back whole: never "nothing waiting" and no new entry is sent; its one readable id is settled with the server (on opening, and *Cancel it*); with no single readable id, only the server settles it (R120). **Another account** on the same browser never sees, sends or settles it: the server keys operation ids per account (`pur_ops`), so another account sending it would record it again. The payroll form is unchanged. |
| R120 | **Every Add Expense id is registered before it is sent; an unreadable one is settled by the server, never by hand (review rev 3).** A missing row in a list does not prove a save's first request won't still arrive, so "I checked the list — clear it" is gone. Add Expense registers each operation id with `pur_op_reserve(op)` (0109's `pur_op_reservations`, per account; again is harmless) and sends `pur_record` only after the server accepted it — a **new** save whose registration is refused was never sent and is forgotten; anything without an answer stays kept. A save whose id the browser cannot read (both copies unreadable, or two that disagree) locks the form with one choice, **Check with the server** (after a confirmation): `pur_op_recover()` settles **every** registered Add Expense save of that account the server has no answer for — each **cancelled for good** through `pur_op_cancel` (its first request arriving later is refused, `OP_CANCELLED`) or found **recorded** first, never both (the lock recording takes decides). Only then is the damaged copy cleared — and only if it is still the same. No answer → nothing changes, still locked. Recovery reaches the account's unsettled Add Expense saves on any device: one there that had not reached the server is cancelled, and that device says so when it next checks — never recorded twice. Owners and staff allowed Expenses (`pur_actor_owner('expenses_form')`); workers, team leaders and accounts focused elsewhere are refused. Moves no money; `pur_ops` stays the record. |
| R121 | **Every request of a save is bound to the account that pressed Save (review rev 4).** The kept save is per account (R119), and so are its requests: registering, recording, the check on opening, *Send it again*, *Cancel it* and *Check with the server* all go through a client bound to **that account's** sign-in token (`_expBoundCalls`) — never the shared client, whose session follows whoever signed in last, in any tab. Before every request the browser checks that the signed-in account is still that one (`account()` in `DacsPendingSave`); if another account is signed in now — or it cannot tell — **nothing more is sent**, and whatever is unsettled stays kept for the first account: changed during an upload → nothing kept and nothing sent, the typed form stays; changed after the save was kept, or between registering and recording → kept, nothing recorded. Another account signed in sees nothing of it and can neither send nor settle it; the first account, signed in again, settles it — once, as itself. A page still showing the first account while another is signed in sends nothing, even if the sign-in flips back a moment later: the bound sign-in is taken only when it is that account's. |

## File structure

| File | Task | What |
|---|---|---|
| `supabase/migrations/0109_reconciliation.sql` | 1 | **New.** The three history tables and Add Expense's `pur_op_reservations`, the log trigger, the helpers, five readers, three owner decisions, `pur_op_reserve` / `pur_op_recover` (R120), grants |
| `supabase/tests/4_reconcile.pglite.mjs` | 1 | **New.** 38 tests on PGlite: every ruling above (Add Expense's registration and recovery among them — the original arriving after the list was checked is refused), the payments script (refusals, dry run, real run), the live check (passes; catches a stray row and a row removed behind the log's back), the clean-up (a whole pilot beside real data; three spoiled pilots stopped) |
| `supabase/tests/4_concurrency.mjs` | 1 | **New.** 4 two-session tests on real PostgreSQL, 15 rounds each — the fourth: a save's first request and a recovery at once, recorded or cancelled, never both (both orders seen) |
| `supabase/tests/4_acceptance.sql` | 1 | **New.** Live acceptance, rolls itself back — and checks that every **real** purchase on record already adds up, and (G) that a registered save the server has not seen is cancelled by recovery and its late first request refused |
| `supabase/tests/4_live_check.sql` | 1 | **New.** Read-only: the tab's figures worked out a second way; the log matches the rows |
| `supabase/tests/4_pilot_cleanup.sql` | 1 | **New.** The pilot's guarded clean-up (R118); operation ids and Add Expense's registrations stay — every pilot save ends recorded or cancelled |
| `supabase/tests/4_confirmed_payments.sql` | 1 | **New.** The guarded payments script — **empty**; filled only in Task 5 from the user's confirmations (R116) |
| `supabase/tests/2c_cost.pglite.mjs` | 1 | `--with-0109`: every 2C test with 0109's trigger on top |
| `package.json` | 1, 2 | `test:sql` runs the new suites and the re-run (1); `test` runs `reconciliation-admin.test.js` (2) |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` (CRLF) | 1 | Docs |
| `js/reconciliation-admin.js` | 2 | **New.** Requests → Purchasing → Reconciliation; the bill items for Reports' note |
| `tests/reconciliation-admin.test.js` | 2 | **New.** 21 tests (the printed Reports page among them) |
| `js/expense-pending-save.js` | 2 | **New.** An Add Expense save kept — id and body — until the server answers: one at a time per account across tabs, each answer clearing only its own; registered before it is sent; blocked or damaged storage sends nothing; an unreadable id settled only by the server; every step bound to the account that started it (R119–R121) |
| `tests/expense-pending-save.test.js` | 2 | **New.** 42 tests against a fake server that keys operations and registrations per account, a fake of the browser's locks shared by tabs, and a sign-in any tab can change: a lost reply then an edited retry, close and reload, Cancel it, two tabs with slow uploads and lost replies, an answer clearing only its own save, registration before sending, blocked / full / damaged storage, recovery with the original arriving after the list was checked, another account, **the signed-in account changing during a slow upload and between registration and recording**, a later attempt refused for another reason — and Project Control's own Add Expense code run on a fake page (the bound client, a sign-in that flips back and forth). A test that never settles fails |
| `tests/receipt-save-paths.test.js` | 2 | Its Add Expense fences follow R119 (closing keeps an unsettled save) and R121 (the save records through the bound client) |
| `js/purchasing-admin-list.js` | 2 | The tab, for owner accounts |
| `js/expenses-module.js`, `admin.html` | 2 | "Paid now?" and supplier on Add Expense, the kept save and its locked form — *Send it again*, *Cancel it*, *Check with the server*, every request bound to the account that pressed Save (R119–R121), their refusal words, the Reports note from the log (R115), the no-billing-period words (R107); the script tags and cache-busters |
| `js/portal-app.compiled.js` | 2 | The billing-periods page's "office review needed" follows the flag (R107). Edited directly — never `npm run build` |
| `tests/money-math.test.js` | 2 | §Y (3 checks); its Add Expense fence follows R121 (still only `pur_record`) |
| `tests/purchase-server.test.js` | 2 | Its Add Expense fence follows R121 (still only `pur_record`) |
| `CLAUDE.md`, `docs/ARCHITECTURE.md` | 2 | The money invariant for Stage 4, and how Add Expense records a save once; the module map |

---

### Task 1: Dacs Web — 0109, its tests, the pilot's and the owner's SQL, docs

**Interfaces produced** (Task 2 calls them; each takes and returns JSON):
- `rec_purchase_places(p_from text, p_to text)` → `{from, to, purchases: [{id, ref, purchase_date, entered, source, supplier, what, projects, recorded, own, other, company, loss, difference}], voided: [{id, ref, purchase_date, recorded, what, voided_at, reason}], totals: {purchases, recorded, own, other, company, loss, difference, with_difference}}`
- `rec_waiting()` → `{cost_moves, change_requests, stock, tools, billing_period, unpaid, bills}` + for the main owner `{own_money, returns, disputes, overpaid}`
- `rec_review_lines()` → `{today, waiting: [{purchase_id, ref, line_no, purchase_date, entered, item, category, project, folder_id, amount, rows: [{period, cover, amount}], period_now, days}], marks: [{id, purchase_id, ref, line_no, item, project, amount, purchase_date, reason, marked_by, marked_at, withdrawn_by, withdrawn_at, withdraw_reason, current}]}`
- `rec_bills()` → `[{cost_move_id, group, at, change ('approved' | 'reversed'), kind, item, unit, quantity, value, from, to, reverse_reason, sides: [{project, period, period_id, folder_id, cover, amount}], checked, note, checked_by, checked_at}]` — Reports' note reads it too
- `rec_money_out()` → `{owed: [{supplier, purchases, partly_paid, balance}], not_tracked: {purchases, total}, credits: [{supplier, credits, left}]}` + for the main owner `{overpaid: {purchases, amount}, buyers: [{name, cash_held, shortfall, owed_to_buyer, own_money_to_review}]}`
- `rec_accept_cover(p_op uuid, p_purchase uuid, p_line_no int, p_reason text)` → `{mark_id, purchase_id, line_no}`
- `rec_withdraw_cover(p_op uuid, p_mark uuid, p_reason text)` → `{mark_id, withdrawn}`
- `rec_bill_check(p_op uuid, p_cost_move uuid, p_group text, p_checked boolean, p_note text)` → `{cost_move_id, group, checked}`
- `pur_op_reserve(p_op uuid)` → nothing — registers an Add Expense id before `pur_record` (again is harmless)
- `pur_op_recover()` → `{cancelled, recorded}` — the calling account's registered Add Expense saves with no answer, settled

**Create:** `supabase/migrations/0109_reconciliation.sql`

```sql
-- 0109 — WorkMate Stage 4: reconciliation and reports (the owner's checks).
--
-- Answers: docs/superpowers/specs/2026-10-30-workmate-stage4-reconciliation-questions.md
-- (Q1–Q7 and Q9–Q15 = A; Q8 = the approach only; Q6 = the feature only);
-- plan: docs/superpowers/plans/2026-10-30-workmate-stage4-reconciliation.md.
-- Builds on 0096–0108. Nothing here moves a peso.
--
-- ── 1. It reads and points (Q1). Every function below either READS the
--    records the money model already keeps, or records an owner's decision
--    that moves no money. Nothing writes an expense row, a payment, a
--    billing period or a client bill; nothing feeds Spent, Earned or Profit.
--
-- ── 2. Who (Q3). Owner accounts allowed the Expenses section (rec_owner).
--    The cash figures inside — petty cash held, what the company owes a
--    buyer, own money to review, returns, disputes, Overpaid — stay the MAIN
--    owner's, as in 2A-4: for any other owner account the server leaves
--    those keys out. Staff never call any of it.
--
-- ── 3. Where every purchase peso is (Q4) — rec_purchase_places. For each
--    recorded purchase: its receipt total, and where those pesos sit today:
--      own     its own expense rows (lines, delivery fees, discounts) plus
--              the cost-move rows on the project that bought the lot;
--      other   cost-move rows on any other project (goods moved or issued
--              from company stock and approved);
--      company what the company still holds: a lot's company share
--              (stk_held), or a warehouse line not yet in stock at its value;
--      loss    company stock loss (approved, unreversed).
--    own + other + company + loss must equal the receipt total. The two
--    sides are counted from DIFFERENT records (expense rows vs. cost moves
--    and lots), so a difference is a bug to report, never a business event.
--    Voided purchases are listed apart and count nowhere; a purchase replaced
--    by its correction is the correction.
--
-- ── 4. "Cover is right" (Q6) — rec_accept_cover / rec_withdraw_cover. A line
--    the server charged to Cover because its month had no billing period
--    (needs_funding_review, 0096) keeps its "Office review" mark until the
--    office adds the period and saves the row again (re-funded, as today) —
--    or until an owner account marks it "Cover is right" with a reason. That
--    mark only clears the flag: the rows stay where they are (Cover, Spent).
--    Who, when, why and the line as it stood are kept (rec_cover_marks). A
--    later correction re-checks the line as always (pur_charge_rows sets the
--    flag again if there is still no period): the old mark no longer matches
--    the line and it waits again. A mark is withdrawn only while the line is
--    exactly as marked; withdrawing puts the flag back.
--
-- ── 5. Bills to check (Q10) — rec_cost_row_log, rec_bills, rec_bill_check.
--    An approved cost move writes expense rows; a reversal DELETES them
--    (0105). So the months a move changed are logged as they happen (a
--    trigger on expenses, cost-move rows only). One item per cost move,
--    transaction and direction: an approval (rows added) or a reversal (rows
--    removed) — two items even if both happen in one transaction. An owner
--    account ticks "Bill checked" (or un-ticks) per item, with a note; the
--    latest tick counts. Client bills are never touched (Q25).
--
-- ── 6. Money still out (Q9) — rec_money_out. Unpaid and Partly paid
--    balances by supplier ("No supplier recorded" when none), purchases whose
--    payment is not tracked (never counted as owed), Overpaid, supplier
--    credit left; for the main owner also petty cash held, what the company
--    owes buyers and own money to review. Payments never change Spent (2A-4).
--
-- ── 7. Waiting (Q5) — rec_waiting. Counts only, with no amounts; the
--    decisions stay where they are (Owner approvals, Cash, Stock, Tools).
--
-- ── 8. Add Expense's saves, settled even if the browser loses one (review,
--    R120) — pur_op_reservations, pur_op_reserve, pur_op_recover. Project
--    Control's Add Expense (which records a purchase AND its "Paid now?"
--    payment in one pur_record) registers each save's operation id BEFORE it
--    sends it, and keeps the id in the browser until the server answers. If
--    what the browser kept is damaged and the id cannot be read, nothing new
--    may be sent until pur_op_recover settles EVERY registered save of that
--    account the server has no answer for: each is cancelled for good — its
--    first request arriving later is refused (OP_CANCELLED, 0106) — unless it
--    was recorded first; pur_op_cancel decides under the lock recording takes,
--    so never both. An absent row in a list proves nothing; this does. Moves
--    no money; pur_ops stays the record of what happened.

-- ════ 1. Who may read and decide ═════════════════════════════════════

-- Owner accounts allowed the Expenses section, in their own company.
create or replace function rec_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(is_owner(), false) or not pr_is_office() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  return pur_actor_owner('expenses_form');
end;
$$;

-- ════ 2. "Cover is right" (Q6) ═══════════════════════════════════════

-- One owner decision about one purchase line, as the line stood. Lines are
-- re-created on every correction (new ids), so a mark names the purchase and
-- the line number, and keeps a fingerprint of the line (rec_line_key). Only
-- a line's newest mark (seq) can apply: marking the same line again after a
-- correction supersedes the older mark, even if the line reads the same.
create table if not exists rec_cover_marks (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  line_no int not null,
  item_name text not null default '',
  folder_name text not null default '',
  amount numeric(14,2) not null,
  purchase_date date not null,
  line_key text not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  marked_by uuid not null references profiles(id),
  marked_at timestamptz not null default now(),
  withdrawn_by uuid references profiles(id),
  withdrawn_at timestamptz,
  withdraw_reason text not null default '' check (char_length(withdraw_reason) <= 500),
  check ((withdrawn_at is null) = (withdrawn_by is null)),
  check (withdrawn_at is null or char_length(btrim(withdraw_reason)) between 1 and 500)
);
create index if not exists rec_cover_marks_line on rec_cover_marks (purchase_id, line_no, seq desc);
create index if not exists rec_cover_marks_owner on rec_cover_marks (owner_id, marked_at desc);
alter table rec_cover_marks enable row level security;

-- Never deleted; changed only once, to record its withdrawal.
create or replace function rec_cover_marks_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.withdrawn_at is not null or new.withdrawn_at is null
     or (new.id, new.seq, new.owner_id, new.purchase_id, new.line_no, new.item_name, new.folder_name, new.amount,
         new.purchase_date, new.line_key, new.reason, new.marked_by, new.marked_at)
        is distinct from
        (old.id, old.seq, old.owner_id, old.purchase_id, old.line_no, old.item_name, old.folder_name, old.amount,
         old.purchase_date, old.line_key, old.reason, old.marked_by, old.marked_at) then
    raise exception 'HISTORY_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists rec_cover_marks_guard on rec_cover_marks;
create trigger rec_cover_marks_guard before update or delete on rec_cover_marks
  for each row execute function rec_cover_marks_guard();

-- ════ 3. The months each cost move changed (Q10) ═════════════════════

-- Every cost-move expense row as it is added or removed. An approval's rows
-- are added in one transaction, a reversal's removed in one: (xact, change)
-- names the item.
create table if not exists rec_cost_row_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  cost_move_id uuid not null references stk_cost_moves(id),
  change text not null check (change in ('added', 'removed')),
  expense_id uuid not null,
  folder_id uuid,
  project_id uuid,
  cover boolean not null default false,
  amount numeric(14,2) not null,
  xact bigint not null default txid_current(),
  at timestamptz not null default now()
);
create index if not exists rec_cost_row_log_move on rec_cost_row_log (owner_id, cost_move_id, xact);
alter table rec_cost_row_log enable row level security;

-- "Bill checked" ticks, per item (cost move, transaction, direction). The latest counts.
create table if not exists rec_bill_checks (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  cost_move_id uuid not null references stk_cost_moves(id),
  xact bigint not null,
  change text not null check (change in ('added', 'removed')),
  checked boolean not null,
  note text not null default '' check (char_length(note) <= 500),
  checked_by uuid not null references profiles(id),
  checked_at timestamptz not null default now()
);
create index if not exists rec_bill_checks_group on rec_bill_checks (cost_move_id, xact, change, id desc);
alter table rec_bill_checks enable row level security;

create or replace function rec_history_locked() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_LOCKED' using errcode = 'P0001';
end;
$$;
drop trigger if exists rec_cost_row_log_locked on rec_cost_row_log;
create trigger rec_cost_row_log_locked before update or delete on rec_cost_row_log
  for each row execute function rec_history_locked();
drop trigger if exists rec_bill_checks_locked on rec_bill_checks;
create trigger rec_bill_checks_locked before update or delete on rec_bill_checks
  for each row execute function rec_history_locked();

-- The project a row is on: its own folder (no period), else its period's.
create or replace function rec_row_folder(p_folder uuid, p_period uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p_folder, (select p.folder_id from projects p where p.id = p_period))
$$;

create or replace function rec_log_cost_rows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.stk_cost_move_id is not null then
    insert into rec_cost_row_log (owner_id, cost_move_id, change, expense_id, folder_id, project_id, cover, amount)
    values (old.owner_id, old.stk_cost_move_id, 'removed', old.id, rec_row_folder(old.folder_id, old.project_id),
            old.project_id, coalesce(old.cover_expense, false), old.amount);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.stk_cost_move_id is not null then
    insert into rec_cost_row_log (owner_id, cost_move_id, change, expense_id, folder_id, project_id, cover, amount)
    values (new.owner_id, new.stk_cost_move_id, 'added', new.id, rec_row_folder(new.folder_id, new.project_id),
            new.project_id, coalesce(new.cover_expense, false), new.amount);
  end if;
  return null;
end;
$$;
drop trigger if exists rec_log_cost_rows_ins on expenses;
create trigger rec_log_cost_rows_ins after insert on expenses
  for each row when (new.stk_cost_move_id is not null) execute function rec_log_cost_rows();
drop trigger if exists rec_log_cost_rows_del on expenses;
create trigger rec_log_cost_rows_del after delete on expenses
  for each row when (old.stk_cost_move_id is not null) execute function rec_log_cost_rows();
drop trigger if exists rec_log_cost_rows_upd on expenses;
create trigger rec_log_cost_rows_upd after update on expenses
  for each row when ((old.stk_cost_move_id is not null or new.stk_cost_move_id is not null)
                     and (old.stk_cost_move_id, old.amount, old.project_id, old.folder_id, old.cover_expense)
                         is distinct from (new.stk_cost_move_id, new.amount, new.project_id, new.folder_id, new.cover_expense))
  execute function rec_log_cost_rows();

-- Rows approved before this migration: one group per cost move (xact 0).
insert into rec_cost_row_log (owner_id, cost_move_id, change, expense_id, folder_id, project_id, cover, amount, xact, at)
select e.owner_id, e.stk_cost_move_id, 'added', e.id, rec_row_folder(e.folder_id, e.project_id), e.project_id,
       coalesce(e.cover_expense, false), e.amount, 0, coalesce(e.created_at, now())
  from expenses e
 where e.stk_cost_move_id is not null
   and not exists (select 1 from rec_cost_row_log r where r.expense_id = e.id);

-- ════ 4. Helpers ═════════════════════════════════════════════════════

-- A purchase line's value (0105's stk_lot_basis, by line): its item amount
-- less its discount shares plus its delivery-fee shares.
create or replace function rec_line_value(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(l.gross_amount
               - coalesce((select sum(s.amount) from purchase_charge_shares s
                             join purchase_charges c on c.id = s.charge_id and c.kind = 'discount'
                            where s.line_id = l.id), 0)
               + coalesce((select sum(s.amount) from purchase_charge_shares s
                             join purchase_charges c on c.id = s.charge_id and c.kind = 'delivery_fee'
                            where s.line_id = l.id), 0), 2)
    from purchase_lines l where l.id = p_line
$$;

-- A line as it stands — its project, amount, purchase date and where its
-- rows sit — as one fingerprint. A correction that changes any of it
-- changes the key, so an old "Cover is right" mark no longer applies.
create or replace function rec_line_key(p_purchase uuid, p_line_no int) returns text
language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|', l.folder_id::text, l.gross_amount::text, pu.purchase_date::text,
           (select string_agg(coalesce(e.project_id::text, '-') || ':' || coalesce(e.folder_id::text, '-') || ':'
                              || coalesce(e.cover_expense, false)::text || ':' || e.amount::text, ','
                              order by coalesce(e.project_id::text, '-'), coalesce(e.folder_id::text, '-'), e.amount)
              from expenses e where e.purchase_line_id = l.id)))
    from purchase_lines l join purchases pu on pu.id = l.purchase_id
   where l.purchase_id = p_purchase and l.line_no = p_line_no
$$;

-- "October 2026 · billing #2", "May 2026 (Cover period)", or "No billing period".
create or replace function rec_period_label(p_period uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select btrim(coalesce(p.month, '') || ' ' || coalesce(p.year::text, ''))
                          || case when p.billing_number is not null then ' · billing #' || p.billing_number else '' end
                          || case when p.funding_type = 'president' then ' (Cover period)' else '' end
                     from projects p where p.id = p_period), 'No billing period')
$$;

-- The bill items (Q10) with their latest tick, for rec_waiting and rec_bills.
create or replace function rec_bill_groups(p_owner uuid)
returns table (cost_move_id uuid, xact bigint, change text, at timestamptz, checked boolean, note text,
               checked_by uuid, checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.cost_move_id, g.xact, g.change, g.at,
         coalesce(b.checked, false), coalesce(b.note, ''), b.checked_by, b.checked_at
    from (select r.cost_move_id, r.xact, r.change, min(r.at) as at
            from rec_cost_row_log r where r.owner_id = p_owner
           group by r.cost_move_id, r.xact, r.change) g
    left join lateral (select x.checked, x.note, x.checked_by, x.checked_at from rec_bill_checks x
                        where x.cost_move_id = g.cost_move_id and x.xact = g.xact and x.change = g.change
                        order by x.id desc limit 1) b on true
$$;

-- Does a mark still apply? Not withdrawn, the newest for its line, the line
-- recorded and not waiting, and exactly as it was marked.
create or replace function rec_mark_current(p_mark uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.withdrawn_at is null
       and not exists (select 1 from rec_cover_marks n
                        where n.purchase_id = m.purchase_id and n.line_no = m.line_no and n.seq > m.seq)
       and exists (select 1 from purchase_lines l join purchases pu on pu.id = l.purchase_id
                    where l.purchase_id = m.purchase_id and l.line_no = m.line_no
                      and pu.status = 'recorded' and not l.needs_funding_review)
       and rec_line_key(m.purchase_id, m.line_no) is not distinct from m.line_key
      from rec_cover_marks m where m.id = p_mark), false)
$$;

-- ════ 5. Reads ═══════════════════════════════════════════════════════

-- Q4: where every peso of the purchases made between two days sits today.
create or replace function rec_purchase_places(p_from text, p_to text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_from date;
  v_to date;
  v_rows jsonb;
  v_void jsonb;
begin
  if coalesce(p_from, '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_to, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  begin
    v_from := p_from::date;
    v_to := p_to::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if v_from > v_to or v_to - v_from > 3700 then
    raise exception 'BAD_RANGE' using errcode = 'P0001';
  end if;

  with pl as (
    select pu.* from purchases pu
     where pu.owner_id = v_owner and pu.status = 'recorded' and pu.purchase_date between v_from and v_to),
  own_rows as (
    select x.pid, sum(x.amount) as amt from (
      select l.purchase_id as pid, e.amount from expenses e join purchase_lines l on l.id = e.purchase_line_id
       where l.purchase_id in (select id from pl)
      union all
      select c.purchase_id, e.amount from expenses e join purchase_charges c on c.id = e.purchase_charge_id
       where c.purchase_id in (select id from pl)) x
     group by x.pid),
  move_rows as (
    select lt.purchase_id as pid,
           sum(e.amount) filter (where lt.cost_folder_id is not null
                                   and rec_row_folder(e.folder_id, e.project_id) = lt.cost_folder_id) as own_amt,
           sum(e.amount) filter (where lt.cost_folder_id is null
                                   or rec_row_folder(e.folder_id, e.project_id) is distinct from lt.cost_folder_id) as other_amt
      from expenses e
      join stk_cost_moves cm on cm.id = e.stk_cost_move_id
      join stk_lots lt on lt.id = cm.lot_id
     where lt.purchase_id in (select id from pl)
     group by lt.purchase_id),
  company as (
    select l.purchase_id as pid,
           sum(case when lt.id is not null then (select h.value from stk_held(lt.id, null) h)
                    when l.destination = 'warehouse' then rec_line_value(l.id)
                    else 0 end) as amt
      from purchase_lines l
      left join stk_lots lt on lt.purchase_id = l.purchase_id and lt.line_no = l.line_no
     where l.purchase_id in (select id from pl)
     group by l.purchase_id),
  loss as (
    select lt.purchase_id as pid, sum(c.value) as amt
      from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id
     where lt.purchase_id in (select id from pl)
       and c.kind = 'loss' and c.status = 'approved' and c.reversed_at is null
     group by lt.purchase_id),
  one as (
    select pl.id, pl.purchase_date, pl.created_at, pl.source, pl.receipt_total,
           coalesce((select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                       from suppliers s where s.id = pl.supplier_id), nullif(btrim(pl.supplier), ''), '') as supplier,
           (select string_agg(l.item_name, ', ' order by l.line_no) from purchase_lines l where l.purchase_id = pl.id) as what,
           (select string_agg(distinct case when l.destination = 'warehouse' then 'Warehouse' else l.folder_name end, ', ')
              from purchase_lines l where l.purchase_id = pl.id) as projects,
           round(coalesce(o.amt, 0) + coalesce(m.own_amt, 0), 2) as own,
           round(coalesce(m.other_amt, 0), 2) as other,
           round(coalesce(c.amt, 0), 2) as company,
           round(coalesce(x.amt, 0), 2) as lost
      from pl
      left join own_rows o on o.pid = pl.id
      left join move_rows m on m.pid = pl.id
      left join company c on c.pid = pl.id
      left join loss x on x.pid = pl.id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', one.id, 'ref', left(one.id::text, 8), 'purchase_date', one.purchase_date, 'entered', one.created_at,
           'source', one.source, 'supplier', one.supplier, 'what', coalesce(one.what, ''), 'projects', coalesce(one.projects, ''),
           'recorded', one.receipt_total, 'own', one.own, 'other', one.other, 'company', one.company, 'loss', one.lost,
           'difference', round(one.receipt_total - one.own - one.other - one.company - one.lost, 2))
         order by one.purchase_date desc, one.created_at desc), '[]'::jsonb)
    into v_rows
    from one;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pu.id, 'ref', left(pu.id::text, 8), 'purchase_date', pu.purchase_date, 'recorded', pu.receipt_total,
           'what', (select string_agg(l.item_name, ', ' order by l.line_no) from purchase_lines l where l.purchase_id = pu.id),
           'voided_at', h.at, 'reason', coalesce(h.reason, ''))
         order by pu.purchase_date desc, pu.created_at desc), '[]'::jsonb)
    into v_void
    from purchases pu
    left join lateral (select x.at, x.reason from purchase_history x
                        where x.purchase_id = pu.id and x.kind = 'voided' order by x.id desc limit 1) h on true
   where pu.owner_id = v_owner and pu.status = 'void' and pu.replaced_by is null
     and pu.purchase_date between v_from and v_to;

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'purchases', v_rows, 'voided', v_void,
    'totals', (select jsonb_build_object(
                 'purchases', count(*),
                 'recorded', coalesce(round(sum((r ->> 'recorded')::numeric), 2), 0),
                 'own', coalesce(round(sum((r ->> 'own')::numeric), 2), 0),
                 'other', coalesce(round(sum((r ->> 'other')::numeric), 2), 0),
                 'company', coalesce(round(sum((r ->> 'company')::numeric), 2), 0),
                 'loss', coalesce(round(sum((r ->> 'loss')::numeric), 2), 0),
                 'difference', coalesce(round(sum((r ->> 'difference')::numeric), 2), 0),
                 'with_difference', count(*) filter (where (r ->> 'difference')::numeric <> 0))
                 from jsonb_array_elements(v_rows) r));
end;
$$;

-- Q5: what is waiting for someone, as counts. The cash ones (and Overpaid)
-- are the main owner's decisions (2A-4) and reach only the main owner.
create or replace function rec_waiting() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_out jsonb;
begin
  v_out := jsonb_build_object(
    'cost_moves', (select count(*) from stk_cost_moves c where c.owner_id = v_owner and c.status = 'pending'),
    'change_requests', (select count(*) from purchase_change_requests r where r.owner_id = v_owner and r.status = 'pending'),
    'stock', (select count(*) from stk_records r where r.owner_id = v_owner and r.status = 'pending'),
    'tools', (select count(*) from tl_tools t where t.owner_id = v_owner and t.state in ('lost_pending', 'retire_pending')),
    'billing_period', (select count(*) from purchase_lines l join purchases pu on pu.id = l.purchase_id
                        where pu.owner_id = v_owner and pu.status = 'recorded' and l.needs_funding_review),
    'unpaid', (select count(*) from purchases pu
                where pu.owner_id = v_owner and pu.status = 'recorded' and pu.payments_tracked
                  and pur_pay_state(pu.id) ->> 'state' in ('unpaid', 'partial')),
    'bills', (select count(*) from rec_bill_groups(v_owner) g where not g.checked));
  if pur_is_main_owner() then
    v_out := v_out || jsonb_build_object(
      'own_money', (select count(*) from pur_payments x where x.owner_id = v_owner and x.source = 'own_money'
                      and x.voided_at is null and not x.authorized and x.accepted_at is null and x.rejected_at is null),
      'returns', (select count(*) from pur_cash_returns r where r.owner_id = v_owner and r.status = 'reported'),
      'disputes', (select count(*) from pur_cash_issues i where i.owner_id = v_owner and i.voided_at is null
                     and i.disputed_at is not null and i.dispute_cleared_at is null),
      'overpaid', (select count(*) from purchases pu
                    where pu.owner_id = v_owner and exists (select 1 from pur_payments x where x.purchase_id = pu.id)
                      and ((pur_pay_state(pu.id) ->> 'unresolved')::numeric > 0
                           or (pur_pay_state(pu.id) ->> 'over_resolved')::numeric > 0)));
  end if;
  return v_out;
end;
$$;

-- Q6: lines waiting for a billing period, and the "Cover is right" marks.
create or replace function rec_review_lines() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_today date := pur_manila_today();
begin
  return jsonb_build_object(
    'today', v_today,
    'waiting', (select coalesce(jsonb_agg(jsonb_build_object(
                  'purchase_id', pu.id, 'ref', left(pu.id::text, 8), 'line_no', l.line_no,
                  'purchase_date', pu.purchase_date, 'entered', pu.created_at,
                  'item', l.item_name, 'category', l.category, 'project', l.folder_name, 'folder_id', l.folder_id,
                  'amount', l.gross_amount,
                  'rows', (select coalesce(jsonb_agg(jsonb_build_object('period', rec_period_label(e.project_id),
                                     'cover', coalesce(e.cover_expense, false), 'amount', e.amount)
                                     order by e.amount desc), '[]'::jsonb)
                             from expenses e where e.purchase_line_id = l.id),
                  -- A billing period for the purchase month exists NOW: saving the row again would charge it there.
                  'period_now', exists (select 1 from projects p where p.folder_id = l.folder_id
                                          and pur_month_no(p.month) = extract(month from pu.purchase_date)::int
                                          and p.year = extract(year from pu.purchase_date)::int
                                          and coalesce(p.funding_type, '') <> 'president'),
                  'days', v_today - (pu.created_at at time zone 'Asia/Manila')::date)
                  order by pu.purchase_date, pu.created_at, l.line_no), '[]'::jsonb)
                  from purchase_lines l join purchases pu on pu.id = l.purchase_id
                 where pu.owner_id = v_owner and pu.status = 'recorded' and l.needs_funding_review),
    'marks', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', m.id, 'purchase_id', m.purchase_id, 'ref', left(m.purchase_id::text, 8), 'line_no', m.line_no,
                'item', m.item_name, 'project', m.folder_name, 'amount', m.amount, 'purchase_date', m.purchase_date,
                'reason', m.reason, 'marked_by', pur_person_name(m.marked_by), 'marked_at', m.marked_at,
                'withdrawn_by', case when m.withdrawn_by is null then null else pur_person_name(m.withdrawn_by) end,
                'withdrawn_at', m.withdrawn_at, 'withdraw_reason', m.withdraw_reason,
                'current', rec_mark_current(m.id))
                order by m.seq desc), '[]'::jsonb)
                from (select * from rec_cover_marks where owner_id = v_owner order by seq desc limit 100) m));
end;
$$;

-- Q10: every approval and reversal of a cost move, with the months it
-- changed on each side and its latest "Bill checked" tick. Project Control's
-- Reports read the same list (through js/reconciliation-admin.js) for its
-- "changed after the month ended" note (Q11): a reversal deletes its rows,
-- so only this log still knows that a month changed again.
create or replace function rec_bills() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := rec_owner();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'cost_move_id', g.cost_move_id, 'group', g.xact::text || ':' || g.change, 'at', g.at,
            'change', case g.change when 'added' then 'approved' else 'reversed' end,
            'kind', cm.kind, 'item', ci.name, 'unit', ci.unit, 'quantity', cm.approved_quantity, 'value', cm.value,
            'from', case when cm.from_folder is null then 'Company stock' else stk_folder_name(cm.from_folder) end,
            'to', case when cm.kind = 'loss' then 'Company stock loss'
                       when cm.to_folder is null then 'Company stock' else stk_folder_name(cm.to_folder) end,
            'reverse_reason', cm.reverse_reason,
            'sides', (select coalesce(jsonb_agg(jsonb_build_object(
                         'project', case when s.folder_id is null then 'No project' else stk_folder_name(s.folder_id) end,
                         'period', rec_period_label(s.project_id), 'period_id', s.project_id, 'folder_id', s.folder_id,
                         'cover', s.cover, 'amount', s.amount)
                         order by s.amount), '[]'::jsonb)
                        from (select r.folder_id, r.project_id, r.cover,
                                     round(sum(case when r.change = 'added' then r.amount else -r.amount end), 2) as amount
                                from rec_cost_row_log r
                               where r.owner_id = v_owner and r.cost_move_id = g.cost_move_id and r.xact = g.xact
                                 and r.change = g.change
                               group by r.folder_id, r.project_id, r.cover) s),
            'checked', g.checked, 'note', g.note,
            'checked_by', case when g.checked_by is null then null else pur_person_name(g.checked_by) end,
            'checked_at', g.checked_at)
          order by g.checked, g.at desc), '[]'::jsonb)
            from rec_bill_groups(v_owner) g
            join stk_cost_moves cm on cm.id = g.cost_move_id
            join stk_lots lt on lt.id = cm.lot_id
            join pr_catalog_items ci on ci.id = lt.item_id);
end;
$$;

-- Q9: money still out. Payments never change Spent (2A-4); this only adds up
-- what 2A-4 records. Cash keys: the main owner only.
create or replace function rec_money_out() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_out jsonb;
begin
  v_out := jsonb_build_object(
    'owed', (select coalesce(jsonb_agg(jsonb_build_object('supplier', x.name, 'purchases', x.n, 'partly_paid', x.partial,
                                                          'balance', x.balance) order by x.balance desc, x.name), '[]'::jsonb)
               from (select coalesce((select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                                        from suppliers s where s.id = pu.supplier_id),
                                     nullif(btrim(pu.supplier), ''), 'No supplier recorded') as name,
                            count(*) as n, count(*) filter (where st.v ->> 'state' = 'partial') as partial,
                            round(sum((st.v ->> 'balance')::numeric), 2) as balance
                       from purchases pu cross join lateral (select pur_pay_state(pu.id) as v) st
                      where pu.owner_id = v_owner and pu.status = 'recorded'
                        and st.v ->> 'state' in ('unpaid', 'partial')
                      group by 1) x),
    'not_tracked', (select jsonb_build_object('purchases', count(*), 'total', coalesce(round(sum(pu.receipt_total), 2), 0))
                      from purchases pu
                     where pu.owner_id = v_owner and pu.status = 'recorded' and not pu.payments_tracked
                       and not exists (select 1 from pur_payments x where x.purchase_id = pu.id and x.voided_at is null)),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object('supplier', y.name, 'credits', y.n, 'left', y.left_amt)
                                          order by y.left_amt desc, y.name), '[]'::jsonb)
                  from (select coalesce((select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                                           from suppliers s where s.id = c.supplier_id), 'A supplier') as name,
                               count(*) as n, round(sum(pur_credit_left(c.id)), 2) as left_amt
                          from pur_supplier_credits c
                         where c.owner_id = v_owner and c.voided_at is null and pur_credit_left(c.id) > 0
                         group by 1) y));
  if pur_is_main_owner() then
    v_out := v_out || jsonb_build_object(
      'overpaid', (select jsonb_build_object('purchases', count(*), 'amount', coalesce(round(sum(z.unresolved), 2), 0))
                     from (select (pur_pay_state(pu.id) ->> 'unresolved')::numeric as unresolved
                             from purchases pu
                            where pu.owner_id = v_owner
                              and exists (select 1 from pur_payments x where x.purchase_id = pu.id)) z
                    where z.unresolved > 0),
      'buyers', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'cash_held', greatest(0, b.raw),
                                                              'shortfall', greatest(0, -b.raw), 'owed_to_buyer', b.owes,
                                                              'own_money_to_review', b.review) order by b.name), '[]'::jsonb)
                   from (select pur_person_name(p.id) as name, pur_cash_raw(v_owner, p.id) as raw,
                                pur_owes(v_owner, p.id) as owes, pur_owes_to_review(v_owner, p.id) as review
                           from profiles p
                          where p.role = 'staff' and p.owner_id = v_owner
                            and (exists (select 1 from pur_cash_issues i where i.buyer_id = p.id and i.owner_id = v_owner)
                                 or exists (select 1 from pur_payments x where x.person_id = p.id and x.owner_id = v_owner)
                                 or exists (select 1 from pur_buyer_repayments r where r.buyer_id = p.id and r.owner_id = v_owner))) b
                  where b.raw <> 0 or b.owes <> 0 or b.review <> 0));
  end if;
  return v_out;
end;
$$;

-- ════ 6. Decisions (they move no money) ═══════════════════════════════

-- Q6: "Cover is right" — clears one line's "Office review" mark, with a reason.
create or replace function rec_accept_cover(p_op uuid, p_purchase uuid, p_line_no int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_prev jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  pu purchases;
  l purchase_lines;
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(p_purchase);
  select * into pu from purchases where id = p_purchase and owner_id = v_owner;
  if pu.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if pu.status <> 'recorded' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  select * into l from purchase_lines where purchase_id = p_purchase and line_no = p_line_no;
  if l.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not l.needs_funding_review then
    raise exception 'NOT_WAITING' using errcode = 'P0001';
  end if;
  if not exists (select 1 from expenses e where e.purchase_line_id = l.id)
     or exists (select 1 from expenses e where e.purchase_line_id = l.id and not coalesce(e.cover_expense, false)) then
    raise exception 'NOT_COVER' using errcode = 'P0001';
  end if;
  insert into rec_cover_marks (owner_id, purchase_id, line_no, item_name, folder_name, amount, purchase_date, line_key,
                               reason, marked_by)
  values (v_owner, p_purchase, p_line_no, l.item_name, coalesce(l.folder_name, ''), l.gross_amount, pu.purchase_date,
          rec_line_key(p_purchase, p_line_no), v_reason, auth.uid())
  returning id into v_id;
  update purchase_lines set needs_funding_review = false where id = l.id;
  return pur_op_done(v_owner, p_op, 'rec_accept_cover',
                     jsonb_build_object('mark_id', v_id, 'purchase_id', p_purchase, 'line_no', p_line_no));
end;
$$;

-- Q6: withdraw a mark — only while the line is exactly as it was marked.
create or replace function rec_withdraw_cover(p_op uuid, p_mark uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_prev jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  m rec_cover_marks;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select * into m from rec_cover_marks where id = p_mark and owner_id = v_owner;
  if m.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(m.purchase_id);
  select * into m from rec_cover_marks where id = p_mark for update;
  if m.withdrawn_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not rec_mark_current(m.id) then
    raise exception 'CHANGED_SINCE' using errcode = 'P0001',
      hint = 'The line changed (or was marked again) after this mark; it no longer applies.';
  end if;
  update purchase_lines set needs_funding_review = true where purchase_id = m.purchase_id and line_no = m.line_no;
  update rec_cover_marks set withdrawn_by = auth.uid(), withdrawn_at = now(), withdraw_reason = v_reason where id = m.id;
  return pur_op_done(v_owner, p_op, 'rec_withdraw_cover', jsonb_build_object('mark_id', m.id, 'withdrawn', true));
end;
$$;

-- Q10: tick (or un-tick) "Bill checked" for one item. p_group is the item's
-- key as rec_bills gives it: '<transaction>:added' (an approval) or
-- '<transaction>:removed' (a reversal).
create or replace function rec_bill_check(p_op uuid, p_cost_move uuid, p_group text, p_checked boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_prev jsonb;
  v_xact bigint;
  v_change text;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if coalesce(p_group, '') !~ '^\d{1,18}:(added|removed)$' or p_checked is null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  v_xact := split_part(p_group, ':', 1)::bigint;
  v_change := split_part(p_group, ':', 2);
  if char_length(v_note) > 500 then
    raise exception 'BAD_NOTE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from rec_cost_row_log r where r.owner_id = v_owner and r.cost_move_id = p_cost_move
                    and r.xact = v_xact and r.change = v_change) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into rec_bill_checks (owner_id, cost_move_id, xact, change, checked, note, checked_by)
  values (v_owner, p_cost_move, v_xact, v_change, p_checked, v_note, auth.uid());
  return pur_op_done(v_owner, p_op, 'rec_bill_check',
                     jsonb_build_object('cost_move_id', p_cost_move, 'group', p_group, 'checked', p_checked));
end;
$$;

-- ════ 7. Add Expense's saves (R120) ═════════════════════════════════

-- Every operation id Add Expense may send to pur_record, registered first.
-- Written only by pur_op_reserve; read only by pur_op_recover. Settled ids
-- are the ones pur_ops holds (recorded, or cancelled).
create table if not exists pur_op_reservations (
  actor_id uuid not null references profiles(id),
  op_id uuid not null,
  owner_id uuid not null references profiles(id),
  reserved_at timestamptz not null default now(),
  primary key (actor_id, op_id)
);
alter table pur_op_reservations enable row level security;

-- Register a save's id before it is sent. Accounts that may use Add Expense
-- (pur_actor_owner). Sending it again is harmless.
create or replace function pur_op_reserve(p_op uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  insert into pur_op_reservations (actor_id, op_id, owner_id) values (auth.uid(), p_op, v_owner)
  on conflict (actor_id, op_id) do nothing;
end;
$$;

-- Settle every registered save of the CALLING account that the server has no
-- answer for: cancelled for good, or found recorded (pur_op_cancel, each
-- under its operation's lock). Returns how many of each.
create or replace function pur_op_recover() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_op uuid;
  v_cancelled int := 0;
  v_recorded int := 0;
begin
  perform pur_actor_owner('expenses_form');
  for v_op in select r.op_id from pur_op_reservations r
               where r.actor_id = auth.uid()
                 and not exists (select 1 from pur_ops o where o.actor_id = r.actor_id and o.op_id = r.op_id)
               order by r.reserved_at, r.op_id
  loop
    if pur_op_cancel(v_op) = 'cancelled' then
      v_cancelled := v_cancelled + 1;
    else
      v_recorded := v_recorded + 1;
    end if;
  end loop;
  return jsonb_build_object('cancelled', v_cancelled, 'recorded', v_recorded);
end;
$$;

-- ════ 8. Who may call what ═══════════════════════════════════════════

revoke all on function rec_purchase_places(text, text) from public, anon;
grant execute on function rec_purchase_places(text, text) to authenticated;
revoke all on function rec_waiting() from public, anon;
grant execute on function rec_waiting() to authenticated;
revoke all on function rec_review_lines() from public, anon;
grant execute on function rec_review_lines() to authenticated;
revoke all on function rec_bills() from public, anon;
grant execute on function rec_bills() to authenticated;
revoke all on function rec_money_out() from public, anon;
grant execute on function rec_money_out() to authenticated;
revoke all on function rec_accept_cover(uuid, uuid, int, text) from public, anon;
grant execute on function rec_accept_cover(uuid, uuid, int, text) to authenticated;
revoke all on function rec_withdraw_cover(uuid, uuid, text) from public, anon;
grant execute on function rec_withdraw_cover(uuid, uuid, text) to authenticated;
revoke all on function rec_bill_check(uuid, uuid, text, boolean, text) from public, anon;
grant execute on function rec_bill_check(uuid, uuid, text, boolean, text) to authenticated;
revoke all on function pur_op_reserve(uuid) from public, anon;
grant execute on function pur_op_reserve(uuid) to authenticated;
revoke all on function pur_op_recover() from public, anon;
grant execute on function pur_op_recover() to authenticated;

-- Internal helpers: only the SECURITY DEFINER functions above call them.
revoke all on function rec_owner() from public, anon, authenticated;
revoke all on function rec_cover_marks_guard() from public, anon, authenticated;
revoke all on function rec_history_locked() from public, anon, authenticated;
revoke all on function rec_row_folder(uuid, uuid) from public, anon, authenticated;
revoke all on function rec_log_cost_rows() from public, anon, authenticated;
revoke all on function rec_line_value(uuid) from public, anon, authenticated;
revoke all on function rec_line_key(uuid, int) from public, anon, authenticated;
revoke all on function rec_mark_current(uuid) from public, anon, authenticated;
revoke all on function rec_period_label(uuid) from public, anon, authenticated;
revoke all on function rec_bill_groups(uuid) from public, anon, authenticated;
```

**Create:** `supabase/tests/4_reconcile.pglite.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 4 RECONCILIATION — SERVER TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096 … 0108 and 0109 VERBATIM on PGlite (PostgreSQL in
// memory), over the 2C suite's tables and helpers. Nothing here talks to the
// live database; supabase/tests/4_acceptance.sql repeats the key cases there,
// rolled back.
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
const M107 = mig('0107_tools.sql');
const M108 = mig('0108_tools_crew_numbers.sql');
const M109 = mig('0109_reconciliation.sql');
const M85 = mig('0085_workmate_requests.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
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
  $$ select coalesce(nullif(current_setting('test.uid', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
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
  await db.exec(M107);
  await db.exec(M108);
  if (!opts.no109) await db.exec(M109);
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
const P = (amount, extra = {}) => ({ amount: String(amount), paid_on: phDate(), method: 'cash', source: 'company', ...extra });
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

// ── Stage 4 helpers ───────────────────────────────────────────────────
const places = (db, who = OWNER, from = phDate(-400), to = phDate(30)) => rpc(db, who, 'rec_purchase_places', [from, to]);
const waiting = (db, who = OWNER) => rpc(db, who, 'rec_waiting', []);
const review = (db, who = OWNER) => rpc(db, who, 'rec_review_lines', []);
const bills = (db, who = OWNER) => rpc(db, who, 'rec_bills', []);
const moneyOut = (db, who = OWNER) => rpc(db, who, 'rec_money_out', []);
const accept = (db, who, pid, lineNo, reason = 'No client allocation this month — the company covers it', opId = op()) =>
  rpc(db, who, 'rec_accept_cover', [opId, pid, lineNo, reason]);
const withdraw = (db, who, mark, reason = 'Marked by mistake', opId = op()) => rpc(db, who, 'rec_withdraw_cover', [opId, mark, reason]);
const tick = (db, who, cm, group, checked = true, note = '', opId = op()) => rpc(db, who, 'rec_bill_check', [opId, cm, group, checked, note]);
const placeOf = async (db, pid) => (await places(db)).purchases.find(p => p.id === pid);
const six = (p) => [num(p.recorded), num(p.own), num(p.other), num(p.company), num(p.loss), num(p.difference)];
// Every expense row as one fingerprint: Stage 4 never changes one.
async function rowsPrint(db) {
  return one(db, `select count(*) n, coalesce(sum(amount), 0) s,
                         md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '-') || ':' || coalesce(folder_id::text, '-')
                                                 || ':' || amount::text || ':' || coalesce(cover_expense, false)::text, ',' order by id), '')) h
                    from expenses`);
}
// A project purchase dated in a month with no billing period (another month has one): Cover + "Office review".
async function uncovered(db, name = 'Barlin', amount = 344) {
  const f = await folder(db, name);
  await periodOn(db, f, phDate(-100));
  const b = body([{ folder_id: f, item_name: 'PAINTING MATERIALS', quantity: 1, unit: 'lot', amount }]);
  const pid = (await record(db, b)).purchase_id;
  return { f, pid, b };
}
const flag = async (db, pid, lineNo = 1) =>
  (await one(db, `select needs_funding_review x from purchase_lines where purchase_id = $1 and line_no = $2`, [pid, lineNo])).x;

console.log('\nStage 4 reconciliation (0096 … 0108 + 0109 on PGlite)');

// ── A. Where every purchase peso is (Q4) ─────────────────────────────

await test('a project purchase (Project Control or Purchasing): all of it in its own project — adds up', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, STAFF);
  const pc = (await one(db, `select pur_record($1, $2::jsonb) r`, [op(), JSON.stringify({ ...body([{ folder_id: f, item_name: 'Tiles', quantity: 1, amount: 3360 }]),
                                                                                         source: 'expenses_form' })])).r.purchase_id;
  const pu = await projectBuy(db, f, 'Cement', 10);
  eq(six(await placeOf(db, pc)), [3360, 3360, 0, 0, 0, 0]);
  eq(six(await placeOf(db, pu)), [1000, 1000, 0, 0, 0, 0]);
  const t = (await places(db)).totals;
  eq([num(t.purchases), num(t.recorded), num(t.own), num(t.difference), num(t.with_difference)], [2, 4360, 4360, 0, 0]);
});

await test('project and warehouse lines with a delivery fee and a discount: the project part in its Spent, the rest company stock — to the centavo', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pid = await buyWith(db, [{ folder_id: f, item_name: 'Sand', quantity: 3, amount: 1000 },
                                 { destination: 'warehouse', item_name: 'Cement', quantity: 7, amount: 1777.77 }],
                            [{ kind: 'delivery_fee', amount: 33.33 }, { kind: 'discount', amount: 10 }]);
  const p = await placeOf(db, pid);
  eq(num(p.recorded), 2801.10);
  eq(num(p.own), await spent(db, f), 'own = the project\'s Spent from it');
  eq(Math.round((num(p.own) + num(p.company)) * 100) / 100, 2801.10, 'own + company stock = the receipt');
  eq(num(p.difference), 0);
  eq(p.projects.split(', ').sort(), ['Barlin', 'Warehouse']);
});

await test('company stock issued and approved: the cost sits in the receiving project; a reversal brings it back — adds up at every step', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const pid = await stocked(db, it, 10);                          // ₱1,000
  eq(six(await placeOf(db, pid)), [1000, 0, 0, 1000, 0, 0], 'in the warehouse: company stock');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  eq(six(await placeOf(db, pid)), [1000, 0, 0, 1000, 0, 0], 'pending: still company stock');
  await cdecide(db, OWNER, r.cost_moves[0], true);
  eq(six(await placeOf(db, pid)), [1000, 0, 400, 600, 0, 0], 'approved: ₱400 in Barlin');
  await creverse(db, OWNER, r.cost_moves[0]);
  eq(six(await placeOf(db, pid)), [1000, 0, 0, 1000, 0, 0], 'reversed: back to company stock');
});

await test('leftovers moved to another project: the buying project keeps the rest, the receiving one holds the moved part', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 600);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  eq(six(await placeOf(db, pj)), [1000, 500, 500, 0, 0, 0]);
  eq([await spent(db, a), await spent(db, b)], [500, 500], 'the same as each project\'s Spent');
});

await test('a confirmed warehouse loss: company stock loss — and a busy day still adds up for every purchase', async () => {
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
  const cnt = await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 0, reason: 'damaged' });
  if (cnt.status === 'pending') await decide(db, OWNER, cnt.record_id, true);
  const all4 = await places(db);
  for (const p of all4.purchases) eq(num(p.difference), 0, p.what + ' adds up');
  eq(num(all4.totals.recorded), 1811.10 + 1000 + 999.99);
  assert(num(all4.totals.loss) > 0, 'some of it is company stock loss');
  eq(Math.round((num(all4.totals.own) + num(all4.totals.other)) * 100) / 100,
     Math.round((await spent(db, a) + await spent(db, b) + await spent(db, cc)) * 100) / 100,
     'own + other = the three projects\' Spent');
});

await test('a warehouse line not matched or received yet: company stock at its value', async () => {
  const db = await fresh();
  const pid = await warehouseBuy(db, 'Cement', 5, { amount: 950 });
  eq(six(await placeOf(db, pid)), [950, 0, 0, 950, 0, 0]);
});

await test('voided purchases are listed apart and count nowhere; a corrected purchase appears once', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const v = await projectBuy(db, f, 'Cement', 2);
  await as(db, BUYER);
  await db.query(`select pur_void($1, $2, 'entered twice')`, [op(), v]);
  const b = body([{ folder_id: f, item_name: 'Sand', quantity: 1, amount: 500 }]);
  const c = (await record(db, b)).purchase_id;
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'price')`, [op(), c, JSON.stringify({ ...b, receipt_total: 550,
    lines: [{ ...b.lines[0], amount: 550 }] })]);
  const all4 = await places(db);
  eq(all4.purchases.map(p => [p.id, num(p.recorded), num(p.difference)]), [[c, 550, 0]]);
  eq(all4.voided.map(p => [p.id, num(p.recorded), p.reason]), [[v, 200, 'entered twice']]);
});

await test('a stray expense row shows up as a difference — the check really compares two sets of records', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); const per = await period(db, f);
  const pid = await projectBuy(db, f, 'Cement', 10);
  const line = (await one(db, `select id from purchase_lines where purchase_id = $1`, [pid])).id;
  await db.exec(`alter table expenses disable trigger expenses_purchase_guard`);
  await db.query(`insert into expenses (owner_id, project_id, amount, purchase_line_id) values ($1, $2, 25, $3)`, [OWNER, per, line]);
  await db.exec(`alter table expenses enable trigger expenses_purchase_guard`);
  const p = await placeOf(db, pid);
  eq(six(p), [1000, 1025, 0, 0, 0, -25]);
  eq(num((await places(db)).totals.with_difference), 1);
});

await test('the date range: only purchases made between the two days; bad dates and ranges refused', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await periodOn(db, f, phDate(-40), 100000, 2);
  const old = await projectBuy(db, f, 'Cement', 1, { date: phDate(-40) });
  const now = await projectBuy(db, f, 'Sand', 1);
  eq((await places(db, OWNER, phDate(-1), phDate())).purchases.map(p => p.id), [now]);
  eq((await places(db, OWNER, phDate(-50), phDate(-30))).purchases.map(p => p.id), [old]);
  await refused(places(db, OWNER, '2026-13-01', '2026-12-31'), 'BAD_DATE');
  await refused(places(db, OWNER, 'yesterday', '2026-12-31'), 'BAD_DATE');
  await refused(places(db, OWNER, phDate(), phDate(-1)), 'BAD_RANGE');
});

await test('who: owner accounts with Expenses; staff, Buyer staff, workers and a PM-only owner are refused; another company sees only its own', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await projectBuy(db, f, 'Cement', 1);
  for (const [who, want] of [[STAFF, 'OWNER_ONLY'], [BUYER, 'OWNER_ONLY'], [WORKER, 'OWNER_ONLY'], [LEADER, 'OWNER_ONLY'],
                             [PMSTAFF, 'OWNER_ONLY'], [PMOWNER, 'NOT_ALLOWED']]) {
    for (const fn of [() => places(db, who), () => waiting(db, who), () => review(db, who), () => bills(db, who), () => moneyOut(db, who)]) {
      await refused(fn(), want, who);
    }
  }
  eq((await places(db, OTHER)).purchases, [], 'another company');
  eq((await places(db, EXPOWNER)).purchases, [], 'an owner account sees its own company only');
});

// ── B. Waiting, as counts (Q5) ───────────────────────────────────────

await test('waiting: billing period, unpaid, cost moves, change requests, stock, tools and bills — the cash counts reach the main owner only', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  const base = await waiting(db);
  eq([base.billing_period, base.unpaid, base.cost_moves, base.change_requests, base.stock, base.tools, base.bills].map(num), [0, 0, 0, 0, 0, 0, 0]);
  eq([base.own_money, base.returns, base.disputes, base.overpaid].map(num), [0, 0, 0, 0], 'the main owner sees the cash counts');
  await uncovered(db, 'Eagle');                                              // 1 line waiting for a billing period, Unpaid too
  const pid = await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 2, unplanned_reason: 'slab' });  // 1 cost move pending
  await as(db, BUYER);
  await db.query(`select pur_request_change($1, $2, 'void', null, 'wrong project')`, [op(), pid]);                     // 1 change request
  await count(db, STAFF, { item_id: it, at: 'warehouse', counted: 7, reason: 'damaged' });                            // 1 count waiting
  await as(db, OWNER);
  await db.query(`select tl_set_enabled(true)`);
  const drill = (await one(db, `insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, 'Drill', 'pc', 'tool') returning id`, [OWNER])).id;
  const reg = await rpc(db, STAFF, 'tl_register', [op(), JSON.stringify({ item_id: drill, condition: 'good', at: 'warehouse',
                                                                           photo_path: `tools/${OWNER}/2026-10/${crypto.randomUUID()}.jpg` })]);
  await rpc(db, STAFF, 'tl_report_lost', [op(), reg.tools[0].tool_id, 'not on site']);                                     // 1 tool waiting
  let w = await waiting(db);
  eq([w.billing_period, w.unpaid, w.cost_moves, w.change_requests, w.stock, w.tools, w.bills].map(num), [1, 2, 1, 1, 1, 1, 0]);
  await cdecide(db, OWNER, r.cost_moves[0], true);
  w = await waiting(db);
  eq([num(w.cost_moves), num(w.bills)], [0, 1], 'approved: a bill to check');
  const g = (await bills(db))[0];
  await tick(db, OWNER, g.cost_move_id, g.group);
  eq(num((await waiting(db)).bills), 0);
  const sub = await waiting(db, EXPOWNER);
  eq(['own_money', 'returns', 'disputes', 'overpaid'].map(k => k in sub), [false, false, false, false], 'not the main owner: no cash keys');
});

await test('waiting, cash: own money to accept, a return to confirm, a disputed handover and an Overpaid purchase', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = await projectBuy(db, f, 'Cement', 10);                 // ₱1,000
  await as(db, OWNER);
  await db.query(`select pur_cash_give($1, $2, '500', $3, 'cash', '')`, [op(), BUYER, phDate()]);
  await rpc(db, BUYER, 'pur_pay', [op(), a, JSON.stringify(P(300, { source: 'own_money' }))]);            // not allowed → to accept
  await rpc(db, OWNER, 'pur_pay', [op(), a, JSON.stringify(P(900))]);                                      // ₱1,200 paid on ₱1,000
  await as(db, BUYER);
  await db.query(`select pur_cash_report_return($1, '100', $2, 'Sir John', '', '')`, [op(), phDate()]);
  const issue = (await one(db, `select id from pur_cash_issues where buyer_id = $1`, [BUYER])).id;
  await db.query(`select pur_cash_dispute($1, $2, 'I got ₱450')`, [op(), issue]);
  const w = await waiting(db);
  eq([w.own_money, w.returns, w.disputes, w.overpaid].map(num), [1, 1, 1, 1]);
});

// ── C. "Cover is right" (Q6) ─────────────────────────────────────────

await test('a purchase in a month with no billing period waits; "Cover is right" needs a reason, clears the mark, and moves no money', async () => {
  const db = await fresh();
  const { f, pid } = await uncovered(db, 'Eagle', 344);
  eq(await flag(db, pid), true);
  const r = await review(db);
  eq(r.waiting.map(x => [x.ref, x.line_no, x.item, x.project, num(x.amount), x.rows.every(y => y.cover), x.period_now]),
     [[pid.slice(0, 8), 1, 'PAINTING MATERIALS', 'Eagle', 344, true, false]]);
  await refused(accept(db, OWNER, pid, 1, '   '), 'REASON_REQUIRED');
  const before = await rowsPrint(db);
  const out = await accept(db, OWNER, pid, 1);
  eq(await flag(db, pid), false);
  eq(await rowsPrint(db), before, 'not one expense row changed');
  eq((await review(db)).waiting, []);
  await as(db, OWNER);
  eq((await one(db, `select pur_review_lines() x`)).x, [], 'Project Control\'s "Office review" mark is gone too');
  const m = (await review(db)).marks;
  eq(m.map(x => [x.id, x.ref, x.item, x.project, num(x.amount), x.current, x.withdrawn_at]),
     [[out.mark_id, pid.slice(0, 8), 'PAINTING MATERIALS', 'Eagle', 344, true, null]]);
  eq(six(await placeOf(db, pid)), [344, 344, 0, 0, 0, 0], 'still in Spent, still adds up');
  void f;
});

await test('only owner accounts mark; staff and Buyer staff are refused; another company cannot reach the line', async () => {
  const db = await fresh();
  const { pid } = await uncovered(db);
  await refused(accept(db, STAFF, pid, 1), 'OWNER_ONLY');
  await refused(accept(db, BUYER, pid, 1), 'OWNER_ONLY');
  await refused(accept(db, PMOWNER, pid, 1), 'NOT_ALLOWED');
  await refused(accept(db, OTHER, pid, 1), 'NOT_FOUND');
  eq(await flag(db, pid), true, 'still waiting');
});

await test('a correction re-checks the line: still no billing period → it waits again, the old mark no longer applies and cannot be withdrawn', async () => {
  const db = await fresh();
  const { pid, b } = await uncovered(db);
  const out = await accept(db, OWNER, pid, 1);
  await as(db, BUYER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'receipt photo added')`, [op(), pid, JSON.stringify(b)]);
  eq(await flag(db, pid), true, 'waiting again');
  const r = await review(db);
  eq(r.waiting.length, 1);
  eq(r.marks.map(x => [x.id, x.current]), [[out.mark_id, false]]);
  await refused(withdraw(db, OWNER, out.mark_id), 'CHANGED_SINCE');
  await accept(db, OWNER, pid, 1, 'Still no client allocation for October');
  eq((await review(db)).marks.map(x => x.current), [true, false], 'a new mark for the line as it is now');
  await refused(withdraw(db, OWNER, out.mark_id), 'CHANGED_SINCE', 'the older mark is superseded, even though the line reads the same');
});

await test('adding the month\'s billing period and saving again re-funds the line, as today — no mark needed', async () => {
  const db = await fresh();
  const { f, pid, b } = await uncovered(db);
  await periodOn(db, f, phDate(), 100000, 2);
  eq((await review(db)).waiting[0].period_now, true, 'the screen can say a period exists now');
  await as(db, BUYER);
  await db.query(`select pur_correct($1, $2, $3::jsonb, 'October period added')`, [op(), pid, JSON.stringify(b)]);
  eq(await flag(db, pid), false);
  eq((await all(db, `select cover_expense c from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = $1`, [pid])).map(x => x.c),
     [false], 'on the new period now');
  eq((await review(db)).waiting, []);
});

await test('withdraw: a reason, only while the line is exactly as marked; it puts the mark back and the history stays', async () => {
  const db = await fresh();
  const { pid } = await uncovered(db);
  const out = await accept(db, OWNER, pid, 1);
  await refused(withdraw(db, OWNER, out.mark_id, ''), 'REASON_REQUIRED');
  await refused(withdraw(db, STAFF, out.mark_id), 'OWNER_ONLY');
  const before = await rowsPrint(db);
  await withdraw(db, OWNER, out.mark_id);
  eq(await flag(db, pid), true);
  eq(await rowsPrint(db), before, 'no money moved');
  await refused(withdraw(db, OWNER, out.mark_id), 'BAD_STATE');
  const m = (await review(db)).marks[0];
  eq([m.current, m.withdraw_reason, m.withdrawn_by !== null], [false, 'Marked by mistake', true]);
  await refused(withdraw(db, OWNER, crypto.randomUUID()), 'NOT_FOUND');
});

await test('refused: a line not waiting, a voided purchase, a line not on Cover, a line that does not exist', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const ok = await projectBuy(db, f, 'Cement', 1);
  await refused(accept(db, OWNER, ok, 1), 'NOT_WAITING');
  await refused(accept(db, OWNER, ok, 2), 'NOT_FOUND');
  await db.query(`update purchase_lines set needs_funding_review = true where purchase_id = $1`, [ok]);   // forged: a flag on a period row
  await refused(accept(db, OWNER, ok, 1), 'NOT_COVER');
  const { pid } = await uncovered(db, 'Eagle');
  await as(db, BUYER);
  await db.query(`select pur_void($1, $2, 'duplicate')`, [op(), pid]);
  await refused(accept(db, OWNER, pid, 1), 'BAD_STATE');
});

await test('retries record once: the same operation id returns the first answer', async () => {
  const db = await fresh();
  const { pid } = await uncovered(db);
  const id = op();
  const a = await accept(db, OWNER, pid, 1, 'first', id);
  const b = await accept(db, OWNER, pid, 1, 'first', id);
  eq([b.mark_id, b.replayed], [a.mark_id, true]);
  eq(num((await one(db, `select count(*) n from rec_cover_marks`)).n), 1);
});

await test('marks are history: never deleted, changed only by a withdrawal', async () => {
  const db = await fresh();
  const { pid } = await uncovered(db);
  const out = await accept(db, OWNER, pid, 1);
  await refused(db.query(`delete from rec_cover_marks where id = $1`, [out.mark_id]), 'HISTORY_LOCKED');
  await refused(db.query(`update rec_cover_marks set reason = 'changed' where id = $1`, [out.mark_id]), 'HISTORY_LOCKED');
});

// ── D. Bills to check (Q10) ──────────────────────────────────────────

await test('an approved cost move is listed with the months it changed on each side; tick and un-tick — the latest counts', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 600);
  const b = await folder(db, 'Bagong'); await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  eq(await bills(db), [], 'pending: nothing to check yet');
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const g = await bills(db);
  eq(g.map(x => [x.change, x.kind, x.item, num(x.quantity), num(x.value), x.from, x.to, x.checked]),
     [['approved', 'transfer', 'Cement', 5, 500, 'Barlin', 'Bagong', false]]);
  const month = (await one(db, `select rec_period_label(id) l from projects where folder_id = $1`, [a])).l;
  eq(g[0].sides.map(s => [s.project, s.period, s.cover, num(s.amount)]),
     [['Barlin', month, false, -300], ['Barlin', month, true, -200], ['Bagong', (await one(db, `select rec_period_label(id) l from projects where folder_id = $1`, [b])).l, false, 500]]);
  await refused(tick(db, OWNER, g[0].cost_move_id, g[0].group, true, 'x'.repeat(501)), 'BAD_NOTE');
  await tick(db, OWNER, g[0].cost_move_id, g[0].group, true, 'Barlin bill #3 credited ₱500');
  let t = (await bills(db))[0];
  eq([t.checked, t.note, t.checked_by !== null], [true, 'Barlin bill #3 credited ₱500', true]);
  await tick(db, OWNER, g[0].cost_move_id, g[0].group, false, 'wrong bill');
  t = (await bills(db))[0];
  eq([t.checked, t.note], [false, 'wrong bill']);
});

await test('a reversal is its own item: the rows it removed, on the same months; the approval keeps its tick', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const g1 = (await bills(db))[0];
  await tick(db, OWNER, g1.cost_move_id, g1.group);
  await creverse(db, OWNER, r.cost_moves[0]);
  const g = await bills(db);
  eq(g.map(x => [x.change, x.checked, x.sides.map(s => num(s.amount))]), [['reversed', false, [-400]], ['approved', true, [400]]]);
  assert(g[0].group !== g[1].group, 'two items');
});

await test('a cost from an earlier month, moved and then reversed later: two items, each naming that month\'s billing period — after the reversal deleted its rows', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); const old = await periodOn(db, a, phDate(-60), 600);   // ₱600 then: ₱1,000 bought → ₱400 Cover
  const b = await folder(db, 'Bagong'); const now = await period(db, b);
  const r0 = await request(db, a, { item: it, quantity: 10 });
  const pj = await projectBuy(db, a, 'Cement', 10, { requestLine: r0.line, date: phDate(-60) });
  await leftover(db, STAFF, pj, 1, 5, 'warehouse');
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 5, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  await creverse(db, OWNER, r.cost_moves[0]);
  eq(num((await one(db, `select count(*) n from expenses where stk_cost_move_id = $1`, [r.cost_moves[0]])).n), 0, 'the reversal deleted its rows');
  const g = await bills(db);
  const sides = (x) => x.sides.map(s => [s.period_id, s.folder_id, s.cover, num(s.amount)]).sort((p, q) => p[3] - q[3]);
  eq(g.map(x => x.change), ['reversed', 'approved']);
  eq(sides(g[1]), [[old, a, false, -300], [old, a, true, -200], [now, b, false, 500]], 'approved: off the earlier month (period and Cover), onto Bagong');
  eq(sides(g[0]), [[now, b, false, -500], [old, a, true, 200], [old, a, false, 300]], 'reversed: the same months, the other way');
  assert(new Date(g[0].at) >= new Date(g[1].at), 'the reversal is the later item');
});

await test('cost moves approved before 0109 appear once, from their rows', async () => {
  const db = await fresh({ no109: true });
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 3, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  await db.exec(M109);
  const g = await bills(db);
  eq(g.map(x => [x.change, x.group, x.sides.map(s => num(s.amount))]), [['approved', '0:added', [300]]]);
  await db.exec(M109);                                                     // run twice: still once
  eq((await bills(db)).length, 1);
});

await test('the log and the ticks are history; a tick needs a real group; staff refused; plain expenses are not logged', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); await period(db, f);
  await projectBuy(db, f, 'Sand', 1);
  eq(num((await one(db, `select count(*) n from rec_cost_row_log`)).n), 0, 'a purchase writes no log');
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const g = (await bills(db))[0];
  await tick(db, OWNER, g.cost_move_id, g.group);
  await refused(db.query(`delete from rec_cost_row_log`), 'HISTORY_LOCKED');
  await refused(db.query(`update rec_cost_row_log set amount = 0`), 'HISTORY_LOCKED');
  await refused(db.query(`delete from rec_bill_checks`), 'HISTORY_LOCKED');
  await refused(tick(db, OWNER, g.cost_move_id, '999999:added'), 'NOT_FOUND');
  await refused(tick(db, OWNER, g.cost_move_id, g.group.replace(':added', ':removed')), 'NOT_FOUND');
  await refused(tick(db, OWNER, g.cost_move_id, 'abc'), 'BAD_STATE');
  await refused(tick(db, OWNER, g.cost_move_id, '12'), 'BAD_STATE');
  await refused(tick(db, STAFF, g.cost_move_id, g.group), 'OWNER_ONLY');
  await refused(tick(db, OTHER, g.cost_move_id, g.group), 'NOT_FOUND');
});

// ── E. Money still out (Q9) ──────────────────────────────────────────

await test('owed by supplier: Unpaid and Partly paid balances; untracked purchases apart, never owed; payments never change Spent', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = await projectBuy(db, f, 'Cement', 10);                         // ₱1,000 Unpaid (Wilcon)
  const b = await projectBuy(db, f, 'Sand', 5);                            // ₱500
  const c = (await record(db, { ...body([{ folder_id: f, item_name: 'Nails', quantity: 1, amount: 80 }]), supplier: '' })).purchase_id;
  const d = await projectBuy(db, f, 'Tiles', 1, { amount: 5000 });
  await db.query(`update purchases set payments_tracked = false where id = $1`, [d]);           // as before 2A-4: not tracked
  const before = await rowsPrint(db);
  await rpc(db, OWNER, 'pur_pay', [op(), b, JSON.stringify(P(300))]);
  const m = await moneyOut(db);
  eq(m.owed.map(x => [x.supplier, num(x.purchases), num(x.partly_paid), num(x.balance)]),
     [['Wilcon', 2, 1, 1200], ['No supplier recorded', 1, 0, 80]]);
  eq([num(m.not_tracked.purchases), num(m.not_tracked.total)], [1, 5000]);
  eq(await rowsPrint(db), before, 'a payment changes no expense row');
  void a; void c;
});

await test('supplier credit left; Overpaid and the buyers\' cash reach the main owner only', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await as(db, OWNER);
  const sup = (await one(db, `select pur_save_supplier(null, 'Citi Hardware', 'Pasig', '', true) s`)).s.id;
  const a = (await record(db, { ...body([{ folder_id: f, item_name: 'Cement', quantity: 10, amount: 1000 }]), supplier: '', supplier_id: sup })).purchase_id;
  await rpc(db, OWNER, 'pur_pay', [op(), a, JSON.stringify(P(1300))]);                                  // ₱300 over
  await db.query(`select pur_cash_give($1, $2, '5000', $3, 'cash', '')`, [op(), BUYER, phDate()]);
  let m = await moneyOut(db);
  eq([num(m.overpaid.purchases), num(m.overpaid.amount)], [1, 300]);
  eq(m.buyers.map(x => [x.name, num(x.cash_held), num(x.shortfall), num(x.owed_to_buyer)]), [['Juan', 5000, 0, 0]]);
  await rpc(db, OWNER, 'pur_resolve_overpaid', [op(), a, JSON.stringify([]), JSON.stringify({ amount: '300', note: 'kept as credit' })]);
  m = await moneyOut(db);
  eq(m.credits.map(x => [x.supplier, num(x.credits), num(x.left)]), [['Citi Hardware · Pasig', 1, 300]]);
  eq([num(m.overpaid.purchases)], [0]);
  const sub = await moneyOut(db, EXPOWNER);
  eq(['overpaid', 'buyers'].map(k => k in sub), [false, false], 'not the main owner: no cash keys');
});

// ── F. The confirmed-payments script (Q8, Task 5) ───────────────────
// The script as committed — only its main owner, its list and its dry-run
// switch are filled in here, the same three lines the user would change.
const PAYSCRIPT = read(path.join(ROOT, 'supabase/tests/4_confirmed_payments.sql'));
async function payScript(db, confirm, dry = true) {
  let s = PAYSCRIPT;
  const swap = (a, b) => { assert(s.split(a).length === 2, 'script line: ' + a); s = s.replace(a, b); };
  swap(`v_main constant uuid := '869c0be7-da92-44d4-a2b1-03dac7fed7e9';`, `v_main constant uuid := '${OWNER}';`);
  swap(`v_confirm constant jsonb := $c$\n[]\n$c$;`, `v_confirm constant jsonb := $c$\n${JSON.stringify(confirm)}\n$c$;`);
  if (!dry) swap('\n  v_dry boolean := true;\n', '\n  v_dry boolean := false;\n');
  await db.exec(`select set_config('test.uid', '', false)`);
  return code(db.exec(s));
}
const confirmOf = (pid, total, extra = {}) => ({ ref: pid.slice(0, 8), expect_total: total.toFixed(2), paid_on: phDate(),
  amount: total.toFixed(2), source: 'company', person_email: null, method: 'bank_transfer', note: 'confirmed by the owner', ...extra });
async function payPrint(db) {
  return one(db, `select count(*) n, coalesce(sum(amount), 0) s from pur_payments`);
}

await test('the payments script as shipped: nothing confirmed → refused, nothing changed', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  await projectBuy(db, f, 'Cement', 10);
  const before = [await rowsPrint(db), await payPrint(db)];
  const s = PAYSCRIPT;
  assert(s.includes('v_confirm constant jsonb := $c$\n[]\n$c$;'), 'the committed list is empty');
  assert(s.includes('\n  v_dry boolean := true;\n'), 'the committed script is a dry run');
  await db.exec(`select set_config('test.uid', '', false)`);
  const got = await code(db.exec(s.replace(`'869c0be7-da92-44d4-a2b1-03dac7fed7e9'`, `'${OWNER}'`)));
  assert(got.includes('NOTHING CONFIRMED'), got);
  eq([await rowsPrint(db), await payPrint(db)], before);
});

await test('the payments script refuses, changing nothing: a wrong total, an unknown code, a payment already there, bad dates, too much, a duplicate, a missing method, petty cash with no buyer, a voided purchase', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = await projectBuy(db, f, 'Cement', 10);            // ₱1,000
  const b = await projectBuy(db, f, 'Sand', 5);               // ₱500
  const v = await projectBuy(db, f, 'Gravel', 1);
  await rpc(db, OWNER, 'pur_pay', [op(), b, JSON.stringify(P(100))]);
  await as(db, BUYER); await db.query(`select pur_void($1, $2, 'duplicate')`, [op(), v]);
  const before = [await rowsPrint(db), await payPrint(db)];
  const cases = [
    [[confirmOf(a, 999)], 'totals 1000.00 now'],
    [[{ ...confirmOf(a, 1000), ref: 'ffffffff' }], 'matches 0 purchases'],
    [[confirmOf(b, 500)], 'already has a payment'],
    [[confirmOf(a, 1000, { paid_on: phDate(-3) })], 'before its purchase date'],
    [[confirmOf(a, 1000, { paid_on: phDate(2) })], 'in the future'],
    [[confirmOf(a, 1000, { amount: '1000.01' })], 'at most its total'],
    [[confirmOf(a, 1000), confirmOf(a, 1000)], 'listed twice'],
    [[{ ...confirmOf(a, 1000), method: undefined }], 'missing a field'],
    [[confirmOf(a, 1000, { method: 'GCash' })], 'missing a field'],
    [[confirmOf(a, 1000, { source: 'petty_cash' })], 'needs the staff buyer'],
    [[confirmOf(v, 100)], 'is voided'],
    [[confirmOf(a, 1000), confirmOf(v, 100)], 'is voided'],
  ];
  for (const [list, want] of cases) {
    const got = await payScript(db, list, false);
    assert(got.includes(want), want + ': got ' + got);
    eq([await rowsPrint(db), await payPrint(db)], before, want + ': nothing changed');
  }
});

await test('the payments script: a dry run records nothing; the real run records exactly the confirmed payments — Spent unchanged, a second run refused', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = await projectBuy(db, f, 'Cement', 10);            // ₱1,000 — confirmed paid in full
  const b = await projectBuy(db, f, 'Sand', 5);               // ₱500   — confirmed ₱200 paid by the buyer's own money
  const c = await projectBuy(db, f, 'Nails', 1);              // ₱100   — not confirmed: stays Unpaid
  const list = [confirmOf(a, 1000, { paid_on: phDate() }),
                confirmOf(b, 500, { amount: '200.00', source: 'own_money', person_email: 'juan@dacs.test', method: 'gcash' })];
  const before = [await rowsPrint(db), await payPrint(db)];
  const dry = await payScript(db, list, true);
  assert(dry.includes('DRY RUN OK') && dry.includes('2 confirmed payment(s)'), dry);
  eq([await rowsPrint(db), await payPrint(db)], before, 'the dry run undid everything');
  const real = await payScript(db, list, false);
  eq(real, 'no error');
  eq(await rowsPrint(db), before[0], 'not one expense row changed');
  const st = async (pid) => (await one(db, `select pur_pay_state($1) s`, [pid])).s;
  eq([(await st(a)).state, (await st(b)).state, (await st(c)).state], ['paid', 'partial', 'unpaid']);
  eq((await all(db, `select source, method, amount, created_by from pur_payments order by amount desc`)).map(r => [r.source, r.method, num(r.amount), r.created_by]),
     [['company', 'bank_transfer', 1000, OWNER], ['own_money', 'gcash', 200, OWNER]]);
  const again = await payScript(db, list, false);
  assert(again.includes('already has a payment'), again);
});

// ── G. The live check (Q14) ─────────────────────────────────────────
const LIVECHECK = read(path.join(ROOT, 'supabase/tests/4_live_check.sql'));
async function liveCheck(db) {
  await db.exec(`select set_config('test.uid', '', false)`);
  const sql = LIVECHECK.replace(`'869c0be7-da92-44d4-a2b1-03dac7fed7e9'`, `'${OWNER}'`);
  assert(sql !== LIVECHECK, 'the check names admin@');
  const res = await db.exec(sql);
  return res.flatMap(r => r.rows || []).filter(r => r && 'check_name' in r);
}

await test('the live check: on a busy day of stock moves every check holds; it reads only', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const a = await folder(db, 'Barlin'); await period(db, a, 700);
  const b = await folder(db, 'Bagong'); await period(db, b, 250);
  const w = await warehouseBuy(db, 'Cement', 10, { amount: 1000 });
  await match(db, STAFF, w, 1, it, 10); await receive(db, BUYER, w, 1, 10);
  const r0 = await request(db, a, { item: it, quantity: 9 });
  const pj = await projectBuy(db, a, 'Cement', 9, { requestLine: r0.line, amount: 999.99 });
  await leftover(db, STAFF, pj, 1, 4, 'warehouse');
  const ok = async (rec) => { for (const id of rec.cost_moves) await cdecide(db, OWNER, id, true); };
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: a, quantity: 5, unplanned_reason: 'x' }));
  await ok(await move(db, STAFF, { item_id: it, from: 'warehouse', to: b, quantity: 6, unplanned_reason: 'x' }));
  const back = await move(db, STAFF, { item_id: it, from: b, to: 'warehouse', quantity: 2 });
  await ok(back);
  await creverse(db, OWNER, back.cost_moves[0]);
  await uncovered(db, 'Eagle');
  const before = await rowsPrint(db);
  const rows = await liveCheck(db);
  eq(rows.length, 6);
  for (const r of rows) eq([r.check_name, r.ok, r.detail], [r.check_name, true, r.detail]);
  assert(/lines waiting for a billing period: 1/.test(rows[5].check_name), rows[5].check_name);
  eq(await rowsPrint(db), before, 'read only');
});

await test('the live check catches a stray row (C2) and a cost-move row removed behind the log\'s back (C1, C4)', async () => {
  const db = await fresh();
  const it = await item(db, 'Cement');
  const f = await folder(db, 'Barlin'); const per = await period(db, f);
  await stocked(db, it, 10);
  const r = await move(db, STAFF, { item_id: it, from: 'warehouse', to: f, quantity: 4, unplanned_reason: 'slab' });
  await cdecide(db, OWNER, r.cost_moves[0], true);
  const pid = await projectBuy(db, f, 'Sand', 1);
  const line = (await one(db, `select id from purchase_lines where purchase_id = $1`, [pid])).id;
  await db.exec(`alter table expenses disable trigger expenses_purchase_guard`);
  await db.query(`insert into expenses (owner_id, project_id, amount, purchase_line_id) values ($1, $2, 25, $3)`, [OWNER, per, line]);
  let rows = await liveCheck(db);
  eq(rows.map(x => x.ok), [true, false, true, true, true, true], 'C2: the stray row');
  await db.query(`delete from expenses where purchase_line_id = $1 and amount = 25`, [line]);
  await db.exec(`alter table expenses disable trigger rec_log_cost_rows_del`);
  await db.query(`delete from expenses where stk_cost_move_id = $1`, [r.cost_moves[0]]);
  await db.exec(`alter table expenses enable trigger rec_log_cost_rows_del`);
  await db.exec(`alter table expenses enable trigger expenses_purchase_guard`);
  rows = await liveCheck(db);
  eq(rows.map(x => x.ok), [false, false, true, false, true, true], 'C1, C2 and C4: rows gone while the cost move stands');
});

// ── H. The pilot's guarded clean-up (4_pilot_cleanup.sql) ───────────
const CLEAN = read(path.join(ROOT, 'supabase/tests/4_pilot_cleanup.sql'));
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
const cleanup = (db, real = false) => {
  const run = real ? CLEAN.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;') : CLEAN;
  assert(!real || run !== CLEAN, 'the setting line is in the file');
  return db.exec(run);
};
async function snap4(db) {
  return one(db, `select (select count(*) from folders) folders, (select count(*) from projects) periods,
                         (select count(*) from pr_catalog_items) items, (select count(*) from purchases) purchases,
                         (select count(*) from expenses) exp_n, (select coalesce(sum(amount), 0) from expenses) exp_sum,
                         (select count(*) from pur_payments) pays, (select count(*) from pur_money_events) mev,
                         (select count(*) from stk_records) recs, (select count(*) from stk_cost_moves) cms,
                         (select count(*) from rec_cover_marks) marks, (select count(*) from rec_cost_row_log) log,
                         (select count(*) from rec_bill_checks) ticks`);
}
// The Stage 4 pilot (Q14) beside real data: a real purchase paid, a real
// "Cover is right" mark, a real cost move approved and ticked.
async function pilot4() {
  const db = await fresh();
  await stubs(db);
  const it = await item(db, 'Cement');
  const house = await folder(db, 'House'); await period(db, house);
  const realPaid = await projectBuy(db, house, 'Tiles', 1, { amount: 3360 });
  await rpc(db, OWNER, 'pur_pay', [op(), realPaid, JSON.stringify(P(3360))]);
  const real = await uncovered(db, 'Eagle Residence');
  await accept(db, OWNER, real.pid, 1, 'Real: no client allocation');
  const realLot = await stocked(db, it, 10);
  const rm = await move(db, STAFF, { item_id: it, from: 'warehouse', to: house, quantity: 2, unplanned_reason: 'real' });
  await cdecide(db, OWNER, rm.cost_moves[0], true);
  const rg = (await bills(db))[0];
  await tick(db, OWNER, rg.cost_move_id, rg.group, true, 'real bill');
  // ZZ
  const A = await folder(db, 'ZZ 4 pilot A'); await periodOn(db, A, phDate(-100));
  const B = await folder(db, 'ZZ 4 pilot B'); await period(db, B);
  const zi = await item(db, 'ZZ 4 pilot cement');
  await as(db, OWNER);
  const paid = (await one(db, `select pur_record($1, $2::jsonb) r`, [op(), JSON.stringify({
    ...body([{ folder_id: A, item_name: 'ZZ 4 pilot paint', quantity: 1, amount: 344 }]),
    source: 'expenses_form', supplier: 'ZZ 4 pilot supplier', payments: [P(344, { method: 'gcash' })] })])).r.purchase_id;
  const zc = await accept(db, OWNER, paid, 1, 'ZZ pilot');
  await withdraw(db, OWNER, zc.mark_id, 'ZZ pilot');
  await accept(db, OWNER, paid, 1, 'ZZ pilot again');
  const zw = await stocked(db, zi, 10, { name: 'ZZ 4 pilot cement' });
  const zm = await move(db, STAFF, { item_id: zi, from: 'warehouse', to: B, quantity: 4, unplanned_reason: 'ZZ' });
  await cdecide(db, OWNER, zm.cost_moves[0], true);
  const zg = (await bills(db)).find(x => x.cost_move_id === zm.cost_moves[0]);
  await tick(db, OWNER, zg.cost_move_id, zg.group, true, 'ZZ');
  await creverse(db, OWNER, zm.cost_moves[0]);
  const cnt = await count(db, STAFF, { item_id: zi, at: 'warehouse', counted: 9, reason: 'damaged' });
  if (cnt.status === 'pending') await decide(db, OWNER, cnt.record_id, true);
  await as(db, '');
  return { db, it, house, realPaid, realLot, real, A, B, zi, paid, zw, rm };
}
await test('the pilot clean-up: the dry run changes nothing; the real run removes only ZZ — real payments, marks, ticks, log and money stay; guards back on', async () => {
  const p = await pilot4();
  const db = p.db;
  const before = await snap4(db);
  const realRows = await one(db, `select count(*) n, coalesce(sum(amount), 0) s from expenses e left join projects pp on pp.id = e.project_id
                                   where coalesce(e.folder_id, pp.folder_id) not in (select id from folders where name like 'ZZ 4 pilot%')`);
  await refused(cleanup(db), 'DRY RUN OK', 'the dry run');
  eq(await snap4(db), before, 'nothing changed');
  await cleanup(db, true);
  eq(num((await one(db, `select count(*) n from folders where name like 'ZZ 4 pilot%'`)).n), 0);
  eq(num((await one(db, `select count(*) n from pr_catalog_items where name like 'ZZ 4 pilot%'`)).n), 0);
  eq((await all(db, `select id from purchases`)).map(r => r.id).sort(), [p.realPaid, p.real.pid, p.realLot].sort(), 'the three real purchases stay');
  eq(num((await one(db, `select count(*) n from pur_payments`)).n), 1, 'the real payment stays');
  eq(num((await one(db, `select count(*) n from rec_cover_marks`)).n), 1, 'the real mark stays');
  eq(num((await one(db, `select count(*) n from rec_bill_checks`)).n), 1, 'the real tick stays');
  eq(num((await one(db, `select count(*) n from rec_cost_row_log`)).n), 1, "the real cost move's log row stays");
  const after = await one(db, `select count(*) n, coalesce(sum(amount), 0) s from expenses`);
  eq([num(after.n), num(after.s)], [num(realRows.n), num(realRows.s)], 'real expense rows as they were');
  eq(num((await one(db, `select count(*) n from pg_trigger where tgname in ('stk_events_no_change', 'stk_moves_no_change', 'stk_covers_no_change',
      'pur_money_events_immutable_trg', 'rec_cost_row_log_locked', 'rec_bill_checks_locked', 'rec_cover_marks_guard') and tgenabled = 'O'`)).n), 7,
     'guards back on');
  await refused(db.query(`delete from rec_cover_marks`), 'HISTORY_LOCKED', 'and they hold');
  await refused(cleanup(db), 'no project named', 'a second run finds nothing');
});
await test("the clean-up stops (and changes nothing) when ZZ and real are mixed, or a ZZ payment came from a buyer's cash", async () => {
  for (const [why, spoil, want] of [
    ['a ZZ purchase paid from petty cash', async (p) => {
      await rpc(p.db, OWNER, 'pur_pay', [op(), p.zw, JSON.stringify(P(100, { source: 'petty_cash', person_id: BUYER }))]); },
     'came from petty cash'],
    ['ZZ goods moved onto a real project', async (p) => {
      await move(p.db, STAFF, { item_id: p.zi, from: 'warehouse', to: p.house, quantity: 1, unplanned_reason: 'x' }); },
     'real'],
    ['a real purchase line on a ZZ project', async (p) => {
      await as(p.db, BUYER);
      await p.db.query(`select pur_record($1, $2::jsonb)`, [op(), JSON.stringify(body([{ folder_id: p.house, item_name: 'Sand', quantity: 1, amount: 50 },
                                                                                      { folder_id: p.A, item_name: 'ZZ 4 pilot sand', quantity: 1, amount: 50 }]))]); },
     'also has a real line'],
  ]) {
    const p = await pilot4();
    await spoil(p);
    await as(p.db, '');
    const before = await snap4(p.db);
    await refused(cleanup(p.db, true), want, why);
    eq(await snap4(p.db), before, why + ': nothing changed');
  }
});

// ── I. Add Expense's saves, settled even if the browser loses one (R120) ──

const reserve = (db, who, id) => rpc(db, who, 'pur_op_reserve', [id]);
const recover = (db, who) => rpc(db, who, 'pur_op_recover', []);
const opState = (db, who, id) => rpc(db, who, 'pur_op_state', [id]);
const settled = (r) => [r.cancelled, r.recorded];         // [cancelled, recorded]
// An Add Expense save — the purchase and its "Paid now?" payment in one pur_record.
async function addExpense(db, f, id, amount, who = OWNER) {
  await as(db, who);
  return (await one(db, `select pur_record($1, $2::jsonb) r`, [id, JSON.stringify({ ...body([{ folder_id: f, item_name: 'Glue', quantity: 1, amount }]),
    source: 'expenses_form', payments: [P(amount)] })])).r;
}
const tally = async (db) => ({ purchases: num((await one(db, `select count(*) n from purchases where status = 'recorded'`)).n),
                               payments: num((await one(db, `select count(*) n from pur_payments`)).n) });

await test('Add Expense: ids registered before sending; with the browser\'s copy unreadable, recovery cancels every unsettled save — its first request arriving after the list was checked is refused', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const a = op(), b = op(), c = op();
  await reserve(db, OWNER, a);
  await reserve(db, OWNER, a);                                    // registered again: harmless
  await reserve(db, OWNER, b);
  await reserve(db, OWNER, c);
  await addExpense(db, f, a, 60);                                 // a reached the server (its reply lost); b never did; c is still on its way
  const listed = await tally(db);                                 // "the list": a only — b and c are absent, which proves nothing
  eq(listed, { purchases: 1, payments: 1 });
  eq(settled(await recover(db, OWNER)), [2, 0], 'b and c cancelled for good; a was settled already');
  eq([await opState(db, OWNER, a), await opState(db, OWNER, b), await opState(db, OWNER, c)], ['recorded', 'cancelled', 'cancelled']);
  await refused(addExpense(db, f, c, 40), 'OP_CANCELLED', 'c\'s first request, arriving after the list was checked');
  await refused(addExpense(db, f, b, 80), 'OP_CANCELLED', 'b, arriving even later');
  eq(await tally(db), listed, 'nothing recorded by the late requests — no purchase, no payment');
  eq(settled(await recover(db, OWNER)), [0, 0], 'nothing left to settle');
  const d = op();
  await reserve(db, OWNER, d);
  await addExpense(db, f, d, 40);                                 // entered again: once
  eq(await tally(db), { purchases: 2, payments: 2 });
});

await test('Add Expense recovery is per account: another account\'s unsettled save — even under the same id — is untouched', async () => {
  const db = await fresh();
  const f = await folder(db, 'Barlin'); await period(db, f);
  const x = op();
  await reserve(db, OWNER, x);
  await reserve(db, STAFF, x);                                    // the same id from another account is another operation
  eq(settled(await recover(db, STAFF)), [1, 0]);
  eq([await opState(db, STAFF, x), await opState(db, OWNER, x)], ['cancelled', 'none']);
  await addExpense(db, f, x, 60, OWNER);                          // the owner's save still records — once
  eq([await opState(db, OWNER, x), (await tally(db)).purchases], ['recorded', 1]);
  eq(settled(await recover(db, OWNER)), [0, 0], 'recorded before recovery: never cancelled');
});

await test('Add Expense registration and recovery: accounts that may use Add Expense only; a missing id refused', async () => {
  const db = await fresh();
  for (const [who, want] of [[WORKER, 'NOT_OFFICE'], [LEADER, 'NOT_OFFICE'], ['', 'NOT_OFFICE'], [PMOWNER, 'NOT_ALLOWED'], [PMSTAFF, 'NOT_ALLOWED']]) {
    await refused(reserve(db, who, op()), want, 'register as ' + (who || 'nobody'));
    await refused(recover(db, who), want, 'recover as ' + (who || 'nobody'));
  }
  await refused(reserve(db, OWNER, null), 'BAD_OP');
  for (const who of [OWNER, STAFF, BUYER, EXPOWNER]) await reserve(db, who, op());
  eq(num((await one(db, `select count(*) n from pur_op_reservations`)).n), 4);
});

// ── J. Permissions ───────────────────────────────────────────────────

await test('permissions: the ten calls for authenticated only; helpers are internal; the four tables have RLS and no policy', async () => {
  const db = await fresh();
  for (const f of ['rec_purchase_places(text,text)', 'rec_waiting()', 'rec_review_lines()', 'rec_bills()', 'rec_money_out()',
                   'rec_accept_cover(uuid,uuid,integer,text)', 'rec_withdraw_cover(uuid,uuid,text)',
                   'rec_bill_check(uuid,uuid,text,boolean,text)', 'pur_op_reserve(uuid)', 'pur_op_recover()']) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x,
        (await one(db, `select has_function_privilege('anon', $1, 'execute') x`, [f])).x], [f, true, false]);
  }
  for (const f of ['rec_owner()', 'rec_cover_marks_guard()', 'rec_history_locked()', 'rec_row_folder(uuid,uuid)', 'rec_log_cost_rows()',
                   'rec_line_value(uuid)', 'rec_line_key(uuid,integer)', 'rec_mark_current(uuid)', 'rec_period_label(uuid)',
                   'rec_bill_groups(uuid)']) {
    eq([f, (await one(db, `select has_function_privilege('authenticated', $1, 'execute') x`, [f])).x], [f, false]);
  }
  for (const t of ['rec_cover_marks', 'rec_cost_row_log', 'rec_bill_checks', 'pur_op_reservations']) {
    const r = await one(db, `select relrowsecurity rls, (select count(*) from pg_policies where tablename = $1) n from pg_class where relname = $1`, [t]);
    eq([t, r.rls, num(r.n)], [t, true, 0]);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/4_concurrency.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 4 RECONCILIATION — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 4_reconcile.pglite.mjs)
//
// Same approach as 2c_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104 +
// 0105 + 0106 + 0109 VERBATIM, pairs of calls released at the same moment on
// two connections. Nothing touches the live database.
//   1. "Cover is right" while the purchase is corrected → the line is
//      waiting exactly when it has no current mark, whichever came first
//   2. two owner tabs mark the same line → one mark
//   3. one press sent twice (same operation id) → one mark, one tick
//   4. an Add Expense save's first request and a recovery at once → recorded
//      (and never cancelled) or cancelled (and never recorded)
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
const ROUNDS = 15;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const LONG_AGO = new Date(Date.now() + 8 * 3600e3 - 100 * 86400e3).toISOString().slice(0, 10);
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-4-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\nStage 4 reconciliation — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 + 0105 + 0106 + 0109 on PostgreSQL)');
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
  // 0106 (pur_op_cancel, and pur_op_begin refusing a cancelled id): its
  // pr_my_requests reads request tables this harness does not build, so its
  // bodies are not checked here (2bb_phone.pglite.mjs runs it).
  await admin.query(`set check_function_bodies = off`);
  await admin.query(mig('0106_workmate_phone_stock.sql'));
  await admin.query(`set check_function_bodies = on`);
  await admin.query(mig('0109_reconciliation.sql'));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${STAFF}', 'staff', '${OWNER}', 'active', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true);
    select stk_set_enabled(true);`);

  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const as = (uid) => admin.query(`select set_config('test.uid', '${uid}', false)`);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // A project whose only billing period is ~100 days ago, and a purchase today: Cover + "Office review".
  const body = (f) => ({ source: 'purchasing', purchase_date: TODAY, receipt_total: 344, supplier: 'Wilcon',
    lines: [{ destination: 'project', folder_id: f, item_name: 'PAINTING MATERIALS', category: 'Materials', unit: 'lot', quantity: 1,
              amount: 344, unplanned_reason: 'test' }] });
  const uncovered = async (name) => {
    const f = (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
    const d = new Date(LONG_AGO + 'T00:00:00Z');
    const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                          values ($1, $2, $3, $4, 'progress', 1) returning id`, [OWNER, f, months[d.getUTCMonth()], d.getUTCFullYear()])).id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
    await as(BUYER);
    const pid = (await one(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [JSON.stringify(body(f))])).r.purchase_id;
    return { f, pid };
  };
  const flag = async (pid) => (await one(`select needs_funding_review x from purchase_lines where purchase_id = $1 and line_no = 1`, [pid])).x;
  const currentMarks = async (pid) => Number((await one(`select count(*) n from rec_cover_marks m where m.purchase_id = $1 and rec_mark_current(m.id)`, [pid])).n);
  const marks = async (pid) => Number((await one(`select count(*) n from rec_cover_marks where purchase_id = $1`, [pid])).n);

  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  // delayA: start A's call that many ms after B's (0: together).
  async function pair(uidA, sqlA, argsA, uidB, sqlB, argsB, delayA = 0) {
    const [a, b] = [await session(uidA), await session(uidB)];
    const run = async (c, sql, args, wait = 0) => {
      try {
        if (wait) await new Promise(r => setTimeout(r, wait));
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
    const out = await Promise.all([run(a, sqlA, argsA, delayA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');
  const ACCEPT = `select rec_accept_cover($1, $2, 1, 'No client allocation this month') r`;
  const CORRECT = `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'photo added') r`;

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const { f, pid } = await uncovered('race1 ' + i);
      const out = await pair(OWNER, ACCEPT, [crypto.randomUUID(), pid], BUYER, CORRECT, [pid, JSON.stringify(body(f))]);
      if (deadlock(out)) dead++;
      // Mark first, then the correction re-checks the line (waiting again, the mark no longer current);
      // or the correction first, then the mark on the line as it is now (not waiting, the mark current).
      const fl = await flag(pid), cur = await currentMarks(pid);
      const ok = out[1].ok && ((fl === true && cur === 0) || (fl === false && cur === 1)) && (out[0].ok || /NOT_WAITING/.test(out[0].msg));
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out), fl, cur);
    }
    check('1. "Cover is right" while the purchase is corrected: waiting exactly when no mark applies — never a cleared line without its mark',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const { pid } = await uncovered('race2 ' + i);
      const out = await pair(OWNER, ACCEPT, [crypto.randomUUID(), pid], OWNER, ACCEPT, [crypto.randomUUID(), pid]);
      if (deadlock(out)) dead++;
      const okCount = out.filter(o => o.ok).length;
      const ok = okCount === 1 && out.some(o => !o.ok && /NOT_WAITING/.test(o.msg)) && await marks(pid) === 1
        && await flag(pid) === false && await currentMarks(pid) === 1;
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('2. two owner tabs mark the same line at once: one mark, the other told it is no longer waiting',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 3
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const { pid } = await uncovered('race3 ' + i);
      const id = crypto.randomUUID();
      const out = await pair(OWNER, ACCEPT, [id, pid], OWNER, ACCEPT, [id, pid]);
      if (deadlock(out)) dead++;
      const ok = out.every(o => o.ok) && out[0].r.mark_id === out[1].r.mark_id && await marks(pid) === 1;
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('3. one "Cover is right" press sent twice (same operation id): one mark, the same answer both times',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 4
  {
    let bad = 0, dead = 0;
    const seen = { recorded: 0, cancelled: 0 };
    const RECORD = `select pur_record($1, $2::jsonb) r`;
    const RECOVER = `select pur_op_recover() r`;
    for (let i = 0; i < ROUNDS; i++) {
      const f = (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, 'race4 ' + i])).id;
      const id = crypto.randomUUID();
      await as(OWNER);
      await admin.query(`select pur_op_reserve($1)`, [id]);
      const b = { source: 'expenses_form', purchase_date: TODAY, receipt_total: 60, no_receipt_reason: 'test',
        lines: [{ destination: 'project', folder_id: f, item_name: 'Glue', category: 'Materials', unit: 'pc', quantity: 1, amount: 60 }] };
      // Even rounds: released together; odd rounds: the first request 15 ms after the recovery began (it holds
      // the operation's lock 30 ms), so both orders are exercised.
      const out = await pair(OWNER, RECORD, [id, JSON.stringify(b)], OWNER, RECOVER, [], i % 2 ? 15 : 0);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select count(distinct l.purchase_id) n from purchase_lines l where l.folder_id = $1`, [f])).n);
      const kind = (await one(`select kind from pur_ops where actor_id = $1 and op_id = $2`, [OWNER, id]))?.kind;
      // Recorded first: one purchase, and recovery found it recorded (or settled already) — nothing cancelled.
      // Recovery first: cancelled for good, the first request refused, no purchase.
      const recorded = out[0].ok && n === 1 && kind === 'record' && out[1].ok && out[1].r.cancelled === 0;
      const cancelled = !out[0].ok && /OP_CANCELLED/.test(out[0].msg) && n === 0 && kind === 'cancelled' && out[1].ok && out[1].r.cancelled === 1;
      if (recorded) seen.recorded++; else if (cancelled) seen.cancelled++;
      else if (bad++ === 0) console.log('       first bad:', JSON.stringify(out), n, kind);
    }
    console.log(`       (${seen.recorded} rounds recorded first, ${seen.cancelled} cancelled first)`);
    check('4. an Add Expense save\'s first request and a recovery at once: recorded or cancelled — never both, never neither (both orders seen)',
      bad === 0 && dead === 0 && seen.recorded > 0 && seen.cancelled > 0,
      `wrong outcome ${bad}, deadlocks ${dead}, recorded first ${seen.recorded}, cancelled first ${seen.cancelled}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/4_acceptance.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 4 acceptance — migration 0109 (live behaviour, reconciliation).
--
-- Self-wrapped in begin / rollback: nothing persists — not the ZZ projects,
-- item, purchases, stock records, cost moves, their expense rows and log,
-- the "Cover is right" mark or the bill tick. Editor-safe (set_config 'v4.*',
-- no temp objects). Needs one active main owner allowed Expenses, an active
-- staff account of theirs allowed Expenses, an active worker, and stock
-- switched ON (it is, since 28 Oct 2026). Run it through MCP execute_sql.
-- Success ends with the row 'stage 4 acceptance: all checks passed'.
--   A. every REAL purchase on record already adds up (read-only check)
--   B. a ZZ purchase in a month with no billing period waits; "Cover is
--      right" clears it without moving money; withdrawing puts it back
--   C. a ZZ warehouse lot issued to a ZZ project: approved → a bill to check
--      with its months; ticked; reversed → its own item; adds up throughout
--   D. money still out and waiting: the main owner's keys
--   E. staff and a worker are refused; history is locked; helpers internal
--   F. nothing outside the ZZ rows changed
--   G. Add Expense's saves (R120): an id is registered before it is sent;
--      recovery cancels one the server has not seen, and that save's first
--      request arriving afterwards is refused
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_a uuid; v_b uuid; v_pa uuid; v_pb uuid; v_item uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_old date := (now() at time zone 'Asia/Manila')::date - 100;
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
  assert coalesce((select enabled from stk_settings where owner_id = v_owner), false), 'stock must be on live';
  assert not exists (select 1 from folders where name like 'ZZ 4 %'), 'no "ZZ 4 …" project may exist before the run';
  -- What must not change (F).
  perform set_config('v4.expenses', (select md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '-') || ':'
                       || coalesce(folder_id::text, '-') || ':' || amount::text || ':' || coalesce(cover_expense, false)::text, ','
                       order by id), '')) from expenses), true);
  perform set_config('v4.flags', (select coalesce(string_agg(purchase_id::text || ':' || line_no, ',' order by purchase_id, line_no), '')
                                    from purchase_lines where needs_funding_review), true);
  perform set_config('v4.payments', (select count(*)::text from pur_payments), true);
  perform set_config('v4.marks', (select count(*)::text from rec_cover_marks), true);
  perform set_config('v4.ticks', (select count(*)::text from rec_bill_checks), true);
  perform set_config('v4.log', (select count(*)::text from rec_cost_row_log), true);
  insert into folders (owner_id, name) values (v_owner, 'ZZ 4 A') returning id into v_a;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 4 B') returning id into v_b;
  -- A's only billing period is ~100 days ago: a purchase today has no matching month.
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_a, to_char(v_old, 'FMMonth'), extract(year from v_old)::int, 'progress', 1) returning id into v_pa;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_b, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1) returning id into v_pb;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_pa, v_owner, 100000), (v_pb, v_owner, 100000);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, created_by)
  values (v_owner, 'material', 'ZZ 4 cement', 'acceptance', 'bag', v_owner) returning id into v_item;
  perform set_config('v4.owner', v_owner::text, true);
  perform set_config('v4.staff', v_staff::text, true);
  perform set_config('v4.worker', v_worker::text, true);
  perform set_config('v4.a', v_a::text, true);
  perform set_config('v4.b', v_b::text, true);
  perform set_config('v4.item', v_item::text, true);
  perform set_config('v4.today', v_today::text, true);
end $$;

-- ═══ A + B. The main owner: every real purchase adds up; "Cover is right" on a ZZ line ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.owner'), 'role', 'authenticated')::text, true);
do $$
declare
  r jsonb; v_pid uuid; v_mark uuid;
  v_today text := current_setting('v4.today');
begin
  -- A1: every recorded purchase in ten years, the real ones included, adds up.
  r := rec_purchase_places(((v_today::date) - 3650)::text, v_today);
  assert (r -> 'totals' ->> 'with_difference')::int = 0, 'A1 a purchase does not add up: ' || (r -> 'totals')::text;
  assert (r -> 'totals' ->> 'difference')::numeric = 0, 'A2 total difference';
  -- B1: a ZZ purchase today on A (no October-style period): Cover, waiting.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', v_today, 'supplier', 'ZZ 4 supplier',
         'receipt_total', 344, 'no_receipt_reason', 'acceptance',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'project', 'folder_id', current_setting('v4.a'),
                    'item_name', 'ZZ 4 paint', 'category', 'Materials', 'unit', 'lot', 'quantity', 1, 'amount', 344,
                    'unplanned_reason', 'acceptance'))));
  v_pid := (r ->> 'purchase_id')::uuid;
  perform set_config('v4.pid', v_pid::text, true);
  assert exists (select 1 from jsonb_array_elements(rec_review_lines() -> 'waiting') x where (x ->> 'purchase_id')::uuid = v_pid),
    'B1 the ZZ line waits for a billing period';
  begin
    perform rec_accept_cover(gen_random_uuid(), v_pid, 1, '  ');
    raise exception 'B2 accepted without a reason';
  exception when others then assert sqlerrm like '%REASON_REQUIRED%', 'B2 wrong error: ' || sqlerrm;
  end;
  v_mark := (rec_accept_cover(gen_random_uuid(), v_pid, 1, 'ZZ acceptance: Cover is right') ->> 'mark_id')::uuid;
  perform set_config('v4.mark', v_mark::text, true);
  assert not exists (select 1 from jsonb_array_elements(rec_review_lines() -> 'waiting') x where (x ->> 'purchase_id')::uuid = v_pid),
    'B3 no longer waiting';
  r := rec_purchase_places(v_today, v_today);
  assert (select array[(x ->> 'own')::numeric, (x ->> 'difference')::numeric] from jsonb_array_elements(r -> 'purchases') x
           where (x ->> 'id')::uuid = v_pid) = array[344, 0]::numeric[], 'B4 still ₱344 in its project''s Spent';
  assert (select (x ->> 'current')::boolean from jsonb_array_elements(rec_review_lines() -> 'marks') x
           where (x ->> 'id')::uuid = v_mark), 'B5 the mark applies';
  perform rec_withdraw_cover(gen_random_uuid(), v_mark, 'ZZ acceptance: withdrawn');
  assert exists (select 1 from jsonb_array_elements(rec_review_lines() -> 'waiting') x where (x ->> 'purchase_id')::uuid = v_pid),
    'B6 waiting again after the withdrawal';
  r := rec_purchase_places(v_today, v_today);
  assert (select (x ->> 'difference')::numeric from jsonb_array_elements(r -> 'purchases') x where (x ->> 'id')::uuid = v_pid) = 0,
    'B7 the ZZ purchase adds up';
end $$;

-- ═══ C. A ZZ warehouse lot to project B: a bill to check ═══
do $$
declare
  r jsonb; v_pid uuid; v_cm uuid; g jsonb;
  v_today text := current_setting('v4.today');
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', v_today, 'supplier', 'ZZ 4 supplier',
         'receipt_total', 1000, 'no_receipt_reason', 'acceptance',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 4 cement', 'category', 'Materials',
                    'unit', 'bag', 'quantity', 10, 'amount', 1000, 'unplanned_reason', 'acceptance'))));
  v_pid := (r ->> 'purchase_id')::uuid;
  perform set_config('v4.wpid', v_pid::text, true);
  perform stk_match(gen_random_uuid(), v_pid, 1, current_setting('v4.item')::uuid, '10', null);
  perform stk_receive(gen_random_uuid(), v_pid, 1, '10', v_today, '');
  r := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v4.item'), 'from', 'warehouse',
         'to', current_setting('v4.b'), 'quantity', '4', 'on', v_today, 'unplanned_reason', 'acceptance'));
  v_cm := (r -> 'cost_moves' ->> 0)::uuid;
  assert (rec_waiting() ->> 'cost_moves')::int >= 1, 'C1 a cost move waits';
  perform stk_cost_decide(gen_random_uuid(), v_cm, true, 'acceptance');
  select x into g from jsonb_array_elements(rec_bills()) x where (x ->> 'cost_move_id')::uuid = v_cm and x ->> 'change' = 'approved';
  assert g is not null, 'C2 the approval is a bill to check';
  assert (g ->> 'checked')::boolean = false and jsonb_array_length(g -> 'sides') = 1
         and (g -> 'sides' -> 0 ->> 'amount')::numeric = 400 and g -> 'sides' -> 0 ->> 'project' = 'ZZ 4 B',
    'C3 its months: ' || (g -> 'sides')::text;
  perform rec_bill_check(gen_random_uuid(), v_cm, g ->> 'group', true, 'ZZ acceptance');
  assert (select (x ->> 'checked')::boolean from jsonb_array_elements(rec_bills()) x
           where (x ->> 'cost_move_id')::uuid = v_cm and x ->> 'change' = 'approved'), 'C4 ticked';
  r := rec_purchase_places(v_today, v_today);
  assert (select array[(x ->> 'other')::numeric, (x ->> 'company')::numeric, (x ->> 'difference')::numeric]
            from jsonb_array_elements(r -> 'purchases') x where (x ->> 'id')::uuid = v_pid) = array[400, 600, 0]::numeric[],
    'C5 ₱400 in B, ₱600 company stock';
  perform stk_cost_reverse(gen_random_uuid(), v_cm, 'acceptance');
  assert exists (select 1 from jsonb_array_elements(rec_bills()) x
                  where (x ->> 'cost_move_id')::uuid = v_cm and x ->> 'change' = 'reversed' and not (x ->> 'checked')::boolean),
    'C6 the reversal is its own item, not checked';
  r := rec_purchase_places(v_today, v_today);
  assert (select (x ->> 'company')::numeric from jsonb_array_elements(r -> 'purchases') x where (x ->> 'id')::uuid = v_pid) = 1000,
    'C7 back to company stock';
end $$;

-- ═══ D. Money still out and waiting: the main owner's keys ═══
do $$
declare m jsonb; w jsonb;
begin
  m := rec_money_out();
  assert m ? 'owed' and m ? 'not_tracked' and m ? 'credits' and m ? 'overpaid' and m ? 'buyers', 'D1 money out keys: ' || m::text;
  w := rec_waiting();
  assert w ? 'billing_period' and w ? 'unpaid' and w ? 'bills' and w ? 'own_money' and w ? 'returns' and w ? 'overpaid',
    'D2 waiting keys: ' || w::text;
end $$;

-- ═══ E. Staff and a worker are refused ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform rec_purchase_places(current_setting('v4.today'), current_setting('v4.today')); raise exception 'E1 staff read places';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E1 wrong error: ' || sqlerrm; end;
  begin perform rec_money_out(); raise exception 'E2 staff read money out';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E2 wrong error: ' || sqlerrm; end;
  begin perform rec_accept_cover(gen_random_uuid(), current_setting('v4.pid')::uuid, 1, 'staff'); raise exception 'E3 staff marked Cover';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E3 wrong error: ' || sqlerrm; end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform rec_waiting(); raise exception 'E4 a worker read waiting';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E4 wrong error: ' || sqlerrm; end;
  begin perform rec_bills(); raise exception 'E5 a worker read the bills';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E5 wrong error: ' || sqlerrm; end;
end $$;

-- ═══ G. Add Expense's saves (R120) ═══
-- (Recovery settles every unsettled save of the account — inside this rolled-back run only.)
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.owner'), 'role', 'authenticated')::text, true);
do $$
declare
  v_x uuid := gen_random_uuid(); v_y uuid := gen_random_uuid(); r jsonb;
  v_body jsonb := jsonb_build_object('source', 'expenses_form', 'purchase_date', current_setting('v4.today'), 'receipt_total', 60,
         'no_receipt_reason', 'acceptance', 'lines', jsonb_build_array(jsonb_build_object('destination', 'project',
         'folder_id', current_setting('v4.b'), 'item_name', 'ZZ 4 glue', 'category', 'Materials', 'unit', 'pc', 'quantity', 1, 'amount', 60)));
begin
  perform pur_op_reserve(v_x);
  perform pur_op_reserve(v_x);                                  -- registered again: harmless
  perform pur_op_reserve(v_y);
  perform pur_record(v_x, v_body);                              -- x reached the server (its reply may be lost)
  r := pur_op_recover();                                        -- the browser lost the id: settle them all
  assert (r ->> 'cancelled')::int >= 1, 'G1 recovery cancelled nothing: ' || r::text;
  assert pur_op_state(v_x) = 'recorded' and pur_op_state(v_y) = 'cancelled', 'G2 recorded stays recorded; the other is cancelled';
  begin
    perform pur_record(v_y, v_body);                            -- y's first request, arriving after the list was checked
    raise exception 'G3 a cancelled save was recorded';
  exception when others then assert sqlerrm like '%OP_CANCELLED%', 'G3 wrong error: ' || sqlerrm;
  end;
  assert (pur_op_recover() ->> 'cancelled')::int = 0, 'G5 nothing left to settle';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform pur_op_recover(); raise exception 'G6 a worker recovered';
  exception when others then assert sqlerrm like '%NOT_OFFICE%', 'G6 wrong error: ' || sqlerrm; end;
end $$;

-- ═══ E (cont.) + F. History locked; helpers internal; nothing outside ZZ changed ═══
reset role;
do $$
begin
  begin
    delete from rec_cover_marks where id = current_setting('v4.mark')::uuid;
    raise exception 'E6 a mark was deleted';
  exception when others then assert sqlerrm like '%HISTORY_LOCKED%', 'E6 wrong error: ' || sqlerrm;
  end;
  begin
    delete from rec_cost_row_log;
    raise exception 'E7 the log was deleted';
  exception when others then assert sqlerrm like '%HISTORY_LOCKED%', 'E7 wrong error: ' || sqlerrm;
  end;
  assert not has_function_privilege('anon', 'rec_purchase_places(text,text)', 'execute'), 'E8 anon cannot read';
  assert not has_function_privilege('authenticated', 'rec_owner()', 'execute'), 'E9 internal';
  assert not has_function_privilege('authenticated', 'rec_line_key(uuid,integer)', 'execute'), 'E10 internal';
  assert (select count(*) from pg_policies where tablename in ('rec_cover_marks', 'rec_cost_row_log', 'rec_bill_checks',
                                                                'pur_op_reservations')) = 0,
    'E11 no direct table access';
  assert (select relrowsecurity from pg_class where relname = 'pur_op_reservations'), 'E12 reservations: RLS on';
  assert (select count(distinct purchase_id) from purchase_lines where item_name = 'ZZ 4 glue') = 1,
    'G4 exactly one ZZ glue purchase — the cancelled save''s late request recorded nothing';
  -- F: every expense row outside the ZZ projects is as it was; no real line's mark, no payment, no tick changed.
  assert (select md5(coalesce(string_agg(e.id::text || ':' || coalesce(e.project_id::text, '-') || ':'
                     || coalesce(e.folder_id::text, '-') || ':' || e.amount::text || ':' || coalesce(e.cover_expense, false)::text, ','
                     order by e.id), ''))
            from expenses e
           where coalesce(e.folder_id, (select p.folder_id from projects p where p.id = e.project_id))
                 not in (current_setting('v4.a')::uuid, current_setting('v4.b')::uuid)) = current_setting('v4.expenses'),
    'F1 a real expense row changed';
  assert (select coalesce(string_agg(purchase_id::text || ':' || line_no, ',' order by purchase_id, line_no), '')
            from purchase_lines where needs_funding_review
             and purchase_id <> current_setting('v4.pid')::uuid) = current_setting('v4.flags'),
    'F2 a real line''s "Office review" mark changed';
  assert (select count(*)::text from pur_payments) = current_setting('v4.payments'), 'F3 a payment was recorded';
  assert (select count(*) from rec_cover_marks)::text = (current_setting('v4.marks')::int + 1)::text, 'F4 only the ZZ mark';
  assert (select count(*) from rec_bill_checks)::text = (current_setting('v4.ticks')::int + 1)::text, 'F5 only the ZZ tick';
  assert (select count(*) from rec_cost_row_log)::text = (current_setting('v4.log')::int + 2)::text,
    'F6 the log: the ZZ approval''s row and the reversal''s';
  assert (select array_agg(e.cover_expense) = array[true] and sum(e.amount) = 344
            from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = current_setting('v4.pid')::uuid),
    'F7 the ZZ line is still ₱344 on Cover — marking and withdrawing moved nothing';
end $$;

select 'stage 4 acceptance: all checks passed' as result;
rollback;
```

**Create:** `supabase/tests/4_live_check.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 4 live check (question 14) — READ ONLY. Run through MCP execute_sql
-- (or the SQL editor) before launch and whenever the owner asks.
--
-- It works out "where every purchase peso is" a SECOND way and compares it
-- with what the Reconciliation tab shows (rec_purchase_places, run as the
-- main owner inside a transaction that is rolled back):
--   the tab counts expense ROWS (own rows, cost-move rows);
--   this check counts cost-move VALUES (stk_cost_moves) and holders.
-- Then three more things that must always hold:
--   · the cost-move log matches the rows that exist (added − removed);
--   · every line waiting for a billing period is all Cover;
--   · (for information) the lines waiting, and the marks that apply.
-- Each check is one row: ok = true, or false with what differs.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
-- admin@, the main owner (the tab is read as that account).
select set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
  from profiles p
 where p.id = '869c0be7-da92-44d4-a2b1-03dac7fed7e9' and p.role = 'owner' and p.owner_id is null
   and coalesce(p.status, 'active') = 'active';

with screen as (
  select (x ->> 'id')::uuid as id, (x ->> 'recorded')::numeric as recorded, (x ->> 'own')::numeric as own,
         (x ->> 'other')::numeric as other, (x ->> 'company')::numeric as company, (x ->> 'loss')::numeric as loss,
         (x ->> 'difference')::numeric as difference
    from jsonb_array_elements(rec_purchase_places(((now() at time zone 'Asia/Manila')::date - 3650)::text,
                                                  ((now() at time zone 'Asia/Manila')::date + 1)::text) -> 'purchases') x),
own_rows as (
  select x.pid, sum(x.amount) as amt from (
    select l.purchase_id as pid, e.amount from expenses e join purchase_lines l on l.id = e.purchase_line_id
    union all
    select c.purchase_id, e.amount from expenses e join purchase_charges c on c.id = e.purchase_charge_id) x
   group by x.pid),
moves as (
  -- Approved, unreversed cost moves by value: into a holder +, out of a holder −.
  select lt.purchase_id as pid,
         sum(case when c.kind <> 'loss' and c.to_folder is not distinct from lt.cost_folder_id and lt.cost_folder_id is not null then c.value else 0 end)
         - sum(case when c.from_folder is not distinct from lt.cost_folder_id and lt.cost_folder_id is not null then c.value else 0 end) as own_v,
         sum(case when c.kind <> 'loss' and c.to_folder is not null and c.to_folder is distinct from lt.cost_folder_id then c.value else 0 end)
         - sum(case when c.from_folder is not null and c.from_folder is distinct from lt.cost_folder_id then c.value else 0 end) as other_v,
         sum(case when c.kind = 'loss' then c.value else 0 end) as loss_v
    from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id
   where c.status = 'approved' and c.reversed_at is null
   group by lt.purchase_id),
second as (
  select pu.id, pu.receipt_total as recorded,
         round(coalesce(o.amt, 0) + coalesce(m.own_v, 0), 2) as own,
         round(coalesce(m.other_v, 0), 2) as other,
         round(coalesce(m.loss_v, 0), 2) as loss
    from purchases pu
    left join own_rows o on o.pid = pu.id
    left join moves m on m.pid = pu.id
   where pu.status = 'recorded'
     and pu.purchase_date between (now() at time zone 'Asia/Manila')::date - 3650 and (now() at time zone 'Asia/Manila')::date + 1),
log_net as (
  select r.cost_move_id, round(sum(case when r.change = 'added' then r.amount else -r.amount end), 2) as net
    from rec_cost_row_log r group by r.cost_move_id),
rows_now as (
  select e.stk_cost_move_id as cost_move_id, round(sum(e.amount), 2) as amt
    from expenses e where e.stk_cost_move_id is not null group by e.stk_cost_move_id)
select 'C1 the tab and this check agree for every purchase (own, other, loss)' as check_name,
       not exists (select 1 from screen s full join second d on d.id = s.id
                    where s.id is null or d.id is null or s.own <> d.own or s.other <> d.other or s.loss <> d.loss) as ok,
       (select coalesce(string_agg(left(coalesce(s.id, d.id)::text, 8) || ' tab ' || coalesce(s.own::text, '-') || '/' || coalesce(s.other::text, '-')
               || '/' || coalesce(s.loss::text, '-') || ' check ' || coalesce(d.own::text, '-') || '/' || coalesce(d.other::text, '-')
               || '/' || coalesce(d.loss::text, '-'), '; '), '')
          from screen s full join second d on d.id = s.id
         where s.id is null or d.id is null or s.own <> d.own or s.other <> d.other or s.loss <> d.loss) as detail
union all
select 'C2 every purchase adds up on the tab (difference ₱0)',
       not exists (select 1 from screen where difference <> 0),
       (select coalesce(string_agg(left(id::text, 8) || ' ₱' || difference, '; '), '') from screen where difference <> 0)
union all
select 'C3 the purchases counted: ' || (select count(*) from screen) || ', ₱' || (select coalesce(sum(recorded), 0) from screen),
       (select count(*) from screen) = (select count(*) from second), ''
union all
select 'C4 the cost-move log matches the rows that exist (added − removed)',
       not exists (select 1 from log_net l full join rows_now r on r.cost_move_id = l.cost_move_id
                    where coalesce(l.net, 0) <> coalesce(r.amt, 0)),
       (select coalesce(string_agg(left(coalesce(l.cost_move_id, r.cost_move_id)::text, 8) || ' log ' || coalesce(l.net, 0)
               || ' rows ' || coalesce(r.amt, 0), '; '), '')
          from log_net l full join rows_now r on r.cost_move_id = l.cost_move_id where coalesce(l.net, 0) <> coalesce(r.amt, 0))
union all
select 'C5 every line waiting for a billing period is all Cover',
       not exists (select 1 from purchase_lines l join purchases pu on pu.id = l.purchase_id join expenses e on e.purchase_line_id = l.id
                    where pu.status = 'recorded' and l.needs_funding_review and not coalesce(e.cover_expense, false)),
       ''
union all
select 'C6 (information) lines waiting for a billing period: '
         || (select count(*) from purchase_lines l join purchases pu on pu.id = l.purchase_id
              where pu.status = 'recorded' and l.needs_funding_review)
         || '; "Cover is right" marks that apply: ' || (select count(*) from rec_cover_marks m where rec_mark_current(m.id)),
       true,
       (select coalesce(string_agg(left(l.purchase_id::text, 8) || ' line ' || l.line_no || ' ₱' || l.gross_amount, '; '
                                   order by pu.purchase_date), '')
          from purchase_lines l join purchases pu on pu.id = l.purchase_id
         where pu.status = 'recorded' and l.needs_funding_review);
rollback;
```

**Create:** `supabase/tests/4_pilot_cleanup.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- WorkMate Stage 4 pilot (question 14): remove the "ZZ 4 pilot" test data.
--
-- Run by the USER in the Supabase SQL editor, after the pilot (plan
-- docs/superpowers/plans/2026-10-30-workmate-stage4-reconciliation.md,
-- Task 4). One transaction. Any failed guard stops it and changes NOTHING.
-- (Built from 2bc_pilot_cleanup.sql: the same guards, for the new prefix.)
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It deletes everything, prints what it
--            removed in a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- What is "ZZ" (and nothing else is touched):
--   projects  — every folder whose name starts "ZZ 4 pilot" (with their
--               billing periods, budgets and settings: the folder cascade);
--   items     — every catalogue item whose name starts "ZZ 4 pilot";
--   purchases — every purchase with a line on a ZZ project, or a warehouse
--               line whose item name starts "ZZ 4 pilot" (all of its lines must
--               be ZZ); their payments — paid by the COMPANY only (a ZZ payment
--               from a buyer's petty cash or own money stops the script, so no
--               real buyer's balance can change) — refunds, credits and money
--               history;
--   stock     — every stock record of a ZZ item or of a ZZ purchase, their
--               moves, request covers, lots, matches, events, cost moves and
--               the cost-move expense rows; the ZZ projects' sites;
--   Stage 4   — the "Cover is right" marks on ZZ purchases, and the cost-move
--               log and "Bill checked" ticks of ZZ cost moves;
--   requests  — every request for a ZZ project (lines, weekly portions,
--               events, conflicts, photo rows);
--   suppliers — named "ZZ 4 pilot…" that no remaining purchase uses.
-- Not touched: the stock and tools switches, the company warehouse place, real
-- projects, items, purchases (the 19 confirmed real on 30 Oct among them),
-- their payments, marks, ticks and log, requests, stock and expenses,
-- operation ids (pur_ops, and Add Expense's pur_op_reservations — each pilot
-- save ends recorded or cancelled, so none is left unsettled), and photo
-- FILES (see the end).
-- The history guards (stock, money events, Stage 4) are switched off for this
-- transaction only, and checked back on before it ends.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  zf uuid[]; zi uuid[]; zp uuid[]; zl uuid[]; zc uuid[]; zloc uuid[]; zlot uuid[]; zr uuid[]; zcm uuid[];
  zreq uuid[]; zrl uuid[]; zpor uuid[]; zper uuid[]; zpay uuid[];
  real_exp_n bigint; real_exp_sum numeric; real_pur bigint; real_rec bigint; real_mov bigint; real_cm bigint; real_req bigint;
  real_pay bigint; real_marks bigint; real_log bigint; real_ticks bigint; real_mev bigint;
  n int; real_rec_tmp int; msg text := '';
begin
  -- ---------- what is ZZ ----------
  select coalesce(array_agg(id), '{}') into zf from folders where name like 'ZZ 4 pilot%';
  if cardinality(zf) = 0 then
    raise exception 'GUARD: no project named "ZZ 4 pilot…" — nothing to clean';
  end if;
  if exists (select 1 from folders f where f.parent_folder_id = any(zf) and not f.id = any(zf)) then
    raise exception 'GUARD: a job under a ZZ project is not named "ZZ 4 pilot…"';
  end if;
  if exists (select 1 from folders f where f.id = any(zf) and f.parent_folder_id is not null and not f.parent_folder_id = any(zf)) then
    raise exception 'GUARD: a "ZZ 4 pilot…" job sits under a real project';
  end if;
  select coalesce(array_agg(id), '{}') into zper from projects where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zi from pr_catalog_items where name like 'ZZ 4 pilot%';
  select coalesce(array_agg(distinct purchase_id), '{}') into zp from purchase_lines
   where folder_id = any(zf) or (destination = 'warehouse' and item_name like 'ZZ 4 pilot%');
  if exists (select 1 from purchase_lines where purchase_id = any(zp)
              and not (folder_id = any(zf) or (destination = 'warehouse' and item_name like 'ZZ 4 pilot%'))) then
    raise exception 'GUARD: a ZZ purchase also has a real line — stop and check';
  end if;
  select coalesce(array_agg(id), '{}') into zl from purchase_lines where purchase_id = any(zp);
  select coalesce(array_agg(id), '{}') into zc from purchase_charges where purchase_id = any(zp);
  -- Payments on ZZ purchases: the company's money only, never a credit or a real purchase's.
  select coalesce(array_agg(id), '{}') into zpay from pur_payments where purchase_id = any(zp) or first_purchase_id = any(zp);
  if exists (select 1 from pur_payments where id = any(zpay)
              and (source <> 'company' or not purchase_id = any(zp) or not first_purchase_id = any(zp))) then
    raise exception 'GUARD: a ZZ payment came from petty cash, own money or a supplier credit, or moved to a real purchase — stop and check';
  end if;
  if exists (select 1 from pur_refunds where purchase_id = any(zp))
     or exists (select 1 from pur_supplier_credits where purchase_id = any(zp)) then
    raise exception 'GUARD: a ZZ purchase has refunds or credits (the pilot records none) — stop and check';
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
  select count(*) into real_pay from pur_payments where not id = any(zpay);
  select count(*) into real_mev from pur_money_events where not coalesce(purchase_id = any(zp), false);
  select count(*) into real_marks from rec_cover_marks where not purchase_id = any(zp);
  select count(*) into real_log from rec_cost_row_log where not cost_move_id = any(zcm);
  select count(*) into real_ticks from rec_bill_checks where not cost_move_id = any(zcm);

  -- ---------- stock (its history guards are off for this transaction only) ----------
  perform set_config('dacs.purchase_write', 'on', true);
  execute 'alter table stk_events disable trigger stk_events_no_change';
  execute 'alter table stk_moves disable trigger stk_moves_no_change';
  execute 'alter table stk_covers disable trigger stk_covers_no_change';
  delete from expenses where stk_cost_move_id = any(zcm) or purchase_line_id = any(zl) or purchase_charge_id = any(zc);
  get diagnostics n = row_count; msg := msg || 'expense rows ' || n;
  -- Stage 4: the log (including the rows the delete above just logged), ticks and marks.
  execute 'alter table rec_cost_row_log disable trigger rec_cost_row_log_locked';
  execute 'alter table rec_bill_checks disable trigger rec_bill_checks_locked';
  execute 'alter table rec_cover_marks disable trigger rec_cover_marks_guard';
  delete from rec_bill_checks where cost_move_id = any(zcm);
  get diagnostics n = row_count; msg := msg || ', bill ticks ' || n;
  delete from rec_cost_row_log where cost_move_id = any(zcm);
  get diagnostics n = row_count; msg := msg || ', cost-move log rows ' || n;
  delete from rec_cover_marks where purchase_id = any(zp);
  get diagnostics n = row_count; msg := msg || ', "Cover is right" marks ' || n;
  execute 'alter table rec_cost_row_log enable trigger rec_cost_row_log_locked';
  execute 'alter table rec_bill_checks enable trigger rec_bill_checks_locked';
  execute 'alter table rec_cover_marks enable trigger rec_cover_marks_guard';
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

  -- ---------- payments (the company's only; their money history) ----------
  execute 'alter table pur_money_events disable trigger pur_money_events_immutable_trg';
  delete from pur_money_events where purchase_id = any(zp) or ref_id = any(zpay);
  get diagnostics n = row_count; msg := msg || ', money events ' || n;
  delete from pur_payments where id = any(zpay);
  get diagnostics n = row_count; msg := msg || ', payments ' || n;
  execute 'alter table pur_money_events enable trigger pur_money_events_immutable_trg';

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
  delete from suppliers s where s.name like 'ZZ 4 pilot%' and not exists (select 1 from purchases p where p.supplier_id = s.id);
  get diagnostics n = row_count; msg := msg || ', suppliers ' || n;

  -- ---------- after: nothing ZZ left, nothing real moved, guards back on ----------
  if exists (select 1 from folders where name like 'ZZ 4 pilot%')
     or exists (select 1 from pr_catalog_items where name like 'ZZ 4 pilot%')
     or exists (select 1 from purchase_lines where item_name like 'ZZ 4 pilot%') then
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
  if (select count(*) from pur_payments) <> real_pay or (select count(*) from pur_money_events) <> real_mev
     or (select count(*) from rec_cover_marks) <> real_marks or (select count(*) from rec_cost_row_log) <> real_log
     or (select count(*) from rec_bill_checks) <> real_ticks then
    raise exception 'GUARD: real payments, money history, marks, log or ticks changed';
  end if;
  if (select count(*) from pg_trigger where tgname in ('stk_events_no_change', 'stk_moves_no_change', 'stk_covers_no_change',
         'pur_money_events_immutable_trg', 'rec_cost_row_log_locked', 'rec_bill_checks_locked', 'rec_cover_marks_guard')
         and tgenabled = 'O') <> 7 then
    raise exception 'GUARD: a history guard is not back on';
  end if;
  msg := msg || '. Real: ' || real_exp_n || ' expense rows (₱' || real_exp_sum || '), ' || real_pur || ' purchases, '
         || real_rec || ' stock records, ' || real_cm || ' cost moves, ' || real_req || ' requests, ' || real_pay || ' payments, '
         || real_marks || ' marks, ' || real_ticks || ' ticks — unchanged; history guards back on.';

  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): would delete %', msg;
  end if;
  raise notice 'CLEAN-UP DONE: deleted %', msg;
end $$;

-- Receipt and request photos: the rows are gone, the FILES stay in Storage
-- (Supabase does not delete Storage files from SQL). The pilot attaches none;
-- if it did, delete them by hand.
```

**Create:** `supabase/tests/4_confirmed_payments.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 4, question 8: record ONLY the payments the user has confirmed.
--
-- Run by the USER in the Supabase SQL editor (plan
-- docs/superpowers/plans/2026-10-30-workmate-stage4-reconciliation.md,
-- Task 5) — and only after the user has filled in the confirmations table
-- under question 8 of the Stage 4 sheet. One transaction. Any failed guard
-- stops it and changes NOTHING.
--
-- AS SHIPPED IT DOES NOTHING: v_confirm is empty, and an empty list stops
-- with "NOTHING CONFIRMED". A purchase is never marked paid from its payment
-- method, its receipt photo or anything else on record — only from an entry
-- below, copied from the user's own confirmation:
--   ref           the purchase's reference code (the first 8 characters)
--   expect_total  its receipt total as the sheet lists it (a check: it must still be that)
--   paid_on       the day the user says it was paid (YYYY-MM-DD, Philippine date)
--   amount        the amount the user says was paid (all of it, or part)
--   source        where the money came from: company | petty_cash | own_money
--   person_email  for petty_cash / own_money: the staff buyer whose money it was
--   method        how, AS THE USER CONFIRMS IT: cash | gcash | bank_transfer | check | other
--   note          optional, e.g. 'confirmed by the owner, 31 Oct'
-- A "no" or "not sure" in the table is simply left out: that purchase stays
-- Unpaid.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It records every confirmed payment, checks
--            the result, prints it in a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- WHAT IT DOES. Each payment is recorded by pur_pay — the same operation as
-- Purchasing → Record payment — as the main owner (admin@), so it lands in the
-- purchase's payment history like a click. A payment never changes Spent,
-- Earned or Profit (2A-4): the guard at the end proves not one expense row
-- changed. It refuses, before changing anything, if a purchase:
--   · is not found, or the code matches more than one purchase;
--   · is voided, or its total is no longer the expected one;
--   · already has a payment, a refund or a supplier credit (record those by hand);
--   · would be paid more than its total, or before its purchase date, or in the future;
--   · is listed twice; or an entry is missing a field.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  v_main constant uuid := '869c0be7-da92-44d4-a2b1-03dac7fed7e9';     -- admin@, the main owner
  -- The user's confirmations, one entry per purchase confirmed paid. EMPTY = nothing is recorded.
  -- Example shape (NOT a confirmation):
  --   [{"ref": "xxxxxxxx", "expect_total": 0.00, "paid_on": "2026-10-24", "amount": 0.00,
  --     "source": "company", "person_email": null, "method": "bank_transfer", "note": ""}]
  v_confirm constant jsonb := $c$
[]
$c$;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  e jsonb;
  pu purchases;
  v_ids uuid[] := '{}';
  v_amounts numeric[] := '{}';
  v_pays jsonb[] := '{}';
  v_person uuid;
  v_n int;
  v_i int;
  b_exp text; b_pur text; b_pay bigint; b_other text;
  msg text := '';
begin
  -- ---------- the main owner ----------
  if not exists (select 1 from profiles p where p.id = v_main and p.role = 'owner' and p.owner_id is null
                   and coalesce(p.status, 'active') = 'active') then
    raise exception 'GUARD: v_main is not the active main owner';
  end if;
  if jsonb_typeof(v_confirm) is distinct from 'array' then
    raise exception 'GUARD: v_confirm must be a list';
  end if;
  if jsonb_array_length(v_confirm) = 0 then
    raise exception 'NOTHING CONFIRMED — fill in the confirmations from the user''s table first; nothing was changed';
  end if;

  -- ---------- every entry, checked before anything changes ----------
  for e in select value from jsonb_array_elements(v_confirm) loop
    if jsonb_typeof(e) is distinct from 'object'
       or coalesce(e ->> 'ref', '') !~ '^[0-9a-f]{8}$'
       or coalesce(e ->> 'paid_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(e ->> 'expect_total', '') !~ '^\d+(\.\d{1,2})?$'
       or coalesce(e ->> 'amount', '') !~ '^\d+(\.\d{1,2})?$'
       or coalesce(e ->> 'source', '') not in ('company', 'petty_cash', 'own_money')
       or coalesce(e ->> 'method', '') not in ('cash', 'gcash', 'bank_transfer', 'check', 'other')
       or char_length(coalesce(e ->> 'note', '')) > 300 then
      raise exception 'GUARD: entry % is missing a field or has a bad value (ref, expect_total, paid_on, amount, source, method)', e;
    end if;
    select count(*) into v_n from purchases x where x.owner_id = v_main and x.id::text like (e ->> 'ref') || '%';
    if v_n <> 1 then
      raise exception 'GUARD: ref % matches % purchases (must be exactly 1)', e ->> 'ref', v_n;
    end if;
    select * into pu from purchases x where x.owner_id = v_main and x.id::text like (e ->> 'ref') || '%';
    if pu.id = any(v_ids) then
      raise exception 'GUARD: ref % is listed twice', e ->> 'ref';
    end if;
    if pu.status <> 'recorded' then
      raise exception 'GUARD: ref % is voided', e ->> 'ref';
    end if;
    if pu.receipt_total <> (e ->> 'expect_total')::numeric then
      raise exception 'GUARD: ref % totals % now, not % — stop and check', e ->> 'ref', pu.receipt_total, e ->> 'expect_total';
    end if;
    if exists (select 1 from pur_payments x where x.purchase_id = pu.id and x.voided_at is null)
       or exists (select 1 from pur_refunds x where x.purchase_id = pu.id and x.voided_at is null)
       or exists (select 1 from pur_supplier_credits x where x.purchase_id = pu.id and x.voided_at is null) then
      raise exception 'GUARD: ref % already has a payment, refund or credit — record it by hand in Purchasing', e ->> 'ref';
    end if;
    if (e ->> 'amount')::numeric <= 0 or (e ->> 'amount')::numeric > pu.receipt_total then
      raise exception 'GUARD: ref % — amount % must be above 0 and at most its total %', e ->> 'ref', e ->> 'amount', pu.receipt_total;
    end if;
    if (e ->> 'paid_on')::date < pu.purchase_date or (e ->> 'paid_on')::date > v_today then
      raise exception 'GUARD: ref % — paid on % is before its purchase date % or in the future', e ->> 'ref', e ->> 'paid_on', pu.purchase_date;
    end if;
    v_person := null;
    if e ->> 'source' in ('petty_cash', 'own_money') then
      select p.id into v_person from profiles p
       where lower(p.email) = lower(coalesce(e ->> 'person_email', '')) and p.role = 'staff' and p.owner_id = v_main;
      if v_person is null then
        raise exception 'GUARD: ref % — % needs the staff buyer''s e-mail (person_email)', e ->> 'ref', e ->> 'source';
      end if;
    end if;
    v_ids := v_ids || pu.id;
    v_amounts := v_amounts || (e ->> 'amount')::numeric;
    v_pays := v_pays || jsonb_build_object('amount', e ->> 'amount', 'paid_on', e ->> 'paid_on', 'method', e ->> 'method',
                                           'source', e ->> 'source', 'person_id', v_person, 'note', coalesce(e ->> 'note', ''));
  end loop;

  -- ---------- before ----------
  select md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '-') || ':' || coalesce(folder_id::text, '-') || ':'
                                 || amount::text || ':' || coalesce(cover_expense, false)::text, ',' order by id), ''))
    into b_exp from expenses;
  select md5(coalesce(string_agg(id::text || ':' || status || ':' || receipt_total::text || ':' || purchase_date::text, ',' order by id), ''))
    into b_pur from purchases;
  select count(*) into b_pay from pur_payments;
  select md5(coalesce(string_agg(id::text || ':' || amount::text || ':' || coalesce(voided_at::text, ''), ',' order by id), ''))
    into b_other from pur_payments where not (purchase_id = any(v_ids));

  -- ---------- record them, as the main owner ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_main, 'role', 'authenticated')::text, true);
  for v_i in 1 .. cardinality(v_ids) loop
    perform pur_pay(gen_random_uuid(), v_ids[v_i], v_pays[v_i]);
  end loop;

  -- ---------- after ----------
  for v_i in 1 .. cardinality(v_ids) loop
    if (select count(*) from pur_payments x where x.purchase_id = v_ids[v_i] and x.voided_at is null) <> 1
       or (select sum(amount) from pur_payments x where x.purchase_id = v_ids[v_i] and x.voided_at is null) <> v_amounts[v_i]
       or pur_pay_state(v_ids[v_i]) ->> 'state'
          <> (case when v_amounts[v_i] = (select receipt_total from purchases where id = v_ids[v_i]) then 'paid' else 'partial' end) then
      raise exception 'GUARD: after — purchase % does not show exactly the confirmed payment', left(v_ids[v_i]::text, 8);
    end if;
    msg := msg || left(v_ids[v_i]::text, 8) || ' ₱' || v_amounts[v_i] || ' → ' || (pur_pay_state(v_ids[v_i]) ->> 'state') || '; ';
  end loop;
  perform set_config('request.jwt.claims', '', true);
  if (select md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '-') || ':' || coalesce(folder_id::text, '-') || ':'
                                     || amount::text || ':' || coalesce(cover_expense, false)::text, ',' order by id), '')) from expenses) <> b_exp then
    raise exception 'GUARD: after — an expense row changed (a payment must never change Spent)';
  end if;
  if (select md5(coalesce(string_agg(id::text || ':' || status || ':' || receipt_total::text || ':' || purchase_date::text, ',' order by id), ''))
        from purchases) <> b_pur then
    raise exception 'GUARD: after — a purchase changed';
  end if;
  if (select count(*) from pur_payments) <> b_pay + cardinality(v_ids)
     or (select md5(coalesce(string_agg(id::text || ':' || amount::text || ':' || coalesce(voided_at::text, ''), ',' order by id), ''))
           from pur_payments where not (purchase_id = any(v_ids))) <> b_other then
    raise exception 'GUARD: after — some other payment changed';
  end if;

  msg := cardinality(v_ids) || ' confirmed payment(s) recorded as the main owner: ' || msg
         || 'no expense row, purchase or other payment changed.';
  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): %', msg;
  end if;
  raise notice 'DONE: %', msg;
end $$;
```

**Modify:** `supabase/tests/2c_cost.pglite.mjs`

```diff
diff --git a/supabase/tests/2c_cost.pglite.mjs b/supabase/tests/2c_cost.pglite.mjs
index 7ce7d64..422a9cf 100644
--- a/supabase/tests/2c_cost.pglite.mjs
+++ b/supabase/tests/2c_cost.pglite.mjs
@@ -31,6 +31,9 @@ const M105 = mig('0105_stock_cost_moves.sql');
 // --with-0107: and 3a's 0107 (tools) on top, switched ON — every behaviour here holds.
 const WITH_0107 = process.argv.includes('--with-0107');
 const M107 = WITH_0107 ? mig('0107_tools.sql') : '';
+// --with-0109: and Stage 4's 0109 (reconciliation: a log trigger on cost-move rows) on top — every behaviour here holds.
+const WITH_0109 = process.argv.includes('--with-0109');
+const M109 = WITH_0109 ? mig('0109_reconciliation.sql') : '';
 
 const BASE = `
 create role anon; create role authenticated; create role service_role;
@@ -112,6 +115,7 @@ async function fresh(opts = {}) {
   await db.exec(M104);
   await db.exec(M105);
   if (WITH_0107) await db.exec(M107);
+  if (M109) await db.exec(M109);
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
```

**Modify:** `package.json`

```diff
diff --git a/package.json b/package.json
index a9a2550..963e5c7 100644
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/3a_tools.pglite.mjs && node supabase/tests/3a_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0107 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0107 && node supabase/tests/2a3_server.pglite.mjs --with-0107 && node supabase/tests/2a4_payments.pglite.mjs --with-0107 && node supabase/tests/2b_stock.pglite.mjs --with-0107 && node supabase/tests/2c_cost.pglite.mjs --with-0107 && node supabase/tests/2bb_phone.pglite.mjs --with-0107 && node supabase/tests/3a_tools.pglite.mjs --with-0108 && node supabase/tests/ih_pilot_close.pglite.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/3a_tools.pglite.mjs && node supabase/tests/3a_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0107 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0107 && node supabase/tests/2a3_server.pglite.mjs --with-0107 && node supabase/tests/2a4_payments.pglite.mjs --with-0107 && node supabase/tests/2b_stock.pglite.mjs --with-0107 && node supabase/tests/2c_cost.pglite.mjs --with-0107 && node supabase/tests/2bb_phone.pglite.mjs --with-0107 && node supabase/tests/3a_tools.pglite.mjs --with-0108 && node supabase/tests/4_reconcile.pglite.mjs && node supabase/tests/4_concurrency.mjs && node supabase/tests/2c_cost.pglite.mjs --with-0109 && node supabase/tests/ih_pilot_close.pglite.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**Modify:** `supabase/migrations/README.md`

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0109** — highest on disk is
-  `0108_tools_crew_numbers.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0110** — highest on disk is
+  `0109_reconciliation.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -202,6 +202,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0108 (WorkMate Stage 3a follow-up TF1 — crew names in Tools with their worker numbers)** redefines 0107's `tl_person_name` alone: a worker or team leader with a display name reads "Name (W-0007)" wherever Tools names a person — the responsible-person lists, the Out list, a tool's page and history, the shopping list's "Issued:" and Mark as Complete's note — because two crew members may share a name (the 3a pilot found two "John Tapales"). One with no display name already reads "W-0007" and is not doubled; office and owner accounts are unchanged. Requests, Purchasing and Work Plan names are untouched. No table, grant or data change; no money. Requires 0107. Prove with `npm run test:sql` (`3a_tools.pglite.mjs --with-0108`).
 
+**0109 (WorkMate Stage 4 — reconciliation and reports: the owner's checks; OUTSIDE the money model)** adds three private tables (RLS on, no policies — reads and writes only through its functions): `rec_cover_marks` ("Cover is right": one owner decision, with a reason, about one purchase line the server charged to Cover for want of a billing period — it clears that line's `needs_funding_review` flag and moves no money; the line as marked is kept as a fingerprint, `line_key`, and only a line's newest mark applies, so a correction that re-checks the line — 0096's `pur_charge_rows` sets the flag again — leaves the old mark behind; never deleted, changed only by its withdrawal, which puts the flag back), `rec_cost_row_log` (every cost-move expense row as it is added or removed, written by triggers on `expenses` — a reversal deletes its rows (0105), so the log is the only record of the months a move changed; back-filled once from the rows already there; append-only) and `rec_bill_checks` ("Bill checked" ticks per cost-move item — an approval or a reversal; append-only, the latest counts). Callable — owner accounts allowed Expenses; petty cash, own money, returns, disputes and Overpaid for the main owner only: `rec_purchase_places` (where every peso of the purchases made between two days sits today — its own project, other projects, company stock, company stock loss — and the difference, which must be ₱0), `rec_waiting` (counts), `rec_review_lines`, `rec_accept_cover`, `rec_withdraw_cover`, `rec_bills`, `rec_bill_check`, `rec_money_out`; and `pur_op_reservations` with `pur_op_reserve` / `pur_op_recover` — Add Expense registers each save's operation id before sending it, so a save whose id the browser lost can still be settled (cancelled for good, or found recorded). **Writes no expense row, payment, billing period or bill**; nothing feeds Spent, Earned or Profit. Requires 0105 (cost moves) and 0102 (payments); `rec_waiting` also reads 0107's `tl_tools`. Prove with `npm run test:sql` (`4_reconcile.pglite.mjs`, `4_concurrency.mjs`, `2c_cost.pglite.mjs --with-0109`); live: `supabase/tests/4_acceptance.sql` (self-wrapped, rolls back) and `supabase/tests/4_live_check.sql` (read-only).
+
 Get the truth before relying on this line:
 
 ```sql
````

**Modify:** `docs/DATABASE_SCHEMA.md`

```diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -1225,6 +1225,30 @@ Covered (every Still to buy): `pr_line_bought` = purchases + stock + tools. A re
 
 Names: every person on these screens comes from `tl_person_name` — since **0108** the crew as "Name (W-0007)" (two crew members may share a name), or "W-0007" with no name; office and owner accounts by their name or e-mail.
 
+## Reconciliation (0109) — WorkMate Stage 4
+
+The owner's checks — **outside the money model**: nothing here writes an expense row, a payment, a billing period or a client bill, or feeds Spent / Earned / Profit. Owner accounts allowed Expenses (`rec_owner`; staff never); petty cash, own money, returns, disputes and Overpaid reach the **main owner** only (the keys are left out for anyone else). Answers: `docs/superpowers/specs/2026-10-30-workmate-stage4-reconciliation-questions.md`.
+
+| Table | What it holds |
+|---|---|
+| `rec_cover_marks` | "Cover is right": `purchase_id` + `line_no` (lines are re-created by a correction), `seq` (only a line's newest mark applies), the line as marked (`item_name`, `folder_name`, `amount`, `purchase_date`, `line_key` — a fingerprint of its project, amount, date and rows), `reason`, `marked_by` / `marked_at`, `withdrawn_by` / `withdrawn_at` / `withdraw_reason`. Never deleted; changed only by its withdrawal (`HISTORY_LOCKED`) |
+| `rec_cost_row_log` | Every cost-move expense row as it is `added` or `removed` (triggers `rec_log_cost_rows_*` on `expenses`): `cost_move_id`, `expense_id`, `folder_id`, `project_id` (the billing period), `cover`, `amount`, `xact` (the transaction), `at`. An item = (cost move, `xact`, `change`): an approval or a reversal. Back-filled from the rows already there (`xact` 0). Append-only |
+| `rec_bill_checks` | "Bill checked" per item: `cost_move_id`, `xact`, `change`, `checked` (a tick or an un-tick), `note`, `checked_by` / `checked_at`. Append-only; the latest counts |
+| `pur_op_reservations` | Add Expense's saves (R120): `actor_id` + `op_id` (the primary key), `owner_id`, `reserved_at` — every operation id Project Control's Add Expense registers **before** it sends `pur_record`. Settled ids are the ones `pur_ops` holds (recorded or cancelled). Written only by `pur_op_reserve`, read only by `pur_op_recover` |
+
+| Function | Who | What |
+|---|---|---|
+| `rec_purchase_places(from, to)` | owner accounts | Each recorded purchase made between the two days: `recorded` (its receipt total) = `own` (its own rows + cost-move rows on the project that bought the lot) + `other` (cost-move rows on any other project) + `company` (what the company still holds: `stk_held`, or a warehouse line not yet in stock at its value) + `loss` (company stock loss) — `difference` must be ₱0; the two sides come from different records. Voided purchases apart. At most 3,700 days |
+| `rec_waiting()` | owner accounts (cash counts: main owner) | Counts only: cost moves, change requests, stock and tools waiting for the owner, lines waiting for a billing period, Unpaid / Partly paid purchases, bills to check; own money, returns, disputes, Overpaid |
+| `rec_review_lines()` | owner accounts | The lines waiting for a billing period (with their rows and whether a period exists now) and the "Cover is right" marks (each with `current`) |
+| `rec_accept_cover(op, purchase, line_no, reason)` | owner accounts | Clears the line's flag; the rows stay. Refused `NOT_WAITING`, `NOT_COVER`, `BAD_STATE` (voided), `REASON_REQUIRED` |
+| `rec_withdraw_cover(op, mark, reason)` | owner accounts | Puts the flag back — only while the mark applies (`CHANGED_SINCE` otherwise) |
+| `rec_bills()` | owner accounts | Every approval and reversal of a cost move: the item, quantity, value, from → to, the months it changed on each side (`sides`), the latest tick; its `group` key names it |
+| `rec_bill_check(op, cost_move, group, checked, note)` | owner accounts | Tick or un-tick one item. Never changes a bill |
+| `rec_money_out()` | owner accounts (cash: main owner) | Unpaid and Partly paid balances by supplier ("No supplier recorded"), payment not tracked (never owed), supplier credit left; Overpaid and each buyer's petty cash held, shortfall, owed and own money to review |
+| `pur_op_reserve(op)` | accounts that may use Add Expense (`pur_actor_owner('expenses_form')`) | Registers a save's id before it is sent; again is harmless |
+| `pur_op_recover()` | the same | For the **calling** account: every registered save the server has no answer for is cancelled for good (`pur_op_cancel`, under the lock recording takes — its first request arriving later is refused, `OP_CANCELLED`) or found recorded; returns `{cancelled, recorded}`. Used only when the browser cannot read a save's id (damaged storage) — an absent row in a list proves nothing |
+
 ## PM profit sharing (0098)
 
 An internal owner/partner allocation per PM project - **outside the money model** (never a payout, invoice or accounting entry). Spec `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`; plan `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`. `project_id` is a `construction_projects.id` (never a `folders.id`). The three tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`: nothing reads or writes them directly. Read through `pm_sharing_read` (owner-role accounts of the company); write through `pm_set_sharing` (main owner only).
```


- [ ] **Step 1: Apply the files above** in Dacs Web. Create blocks as given; Modify blocks with `git apply --ignore-whitespace`. Then put the two CRLF files back to CRLF everywhere:

```bash
node -e "for (const f of ['supabase/migrations/README.md','docs/DATABASE_SCHEMA.md']) { const fs=require('fs'); const s=fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'); fs.writeFileSync(f, s.replace(/\n/g,'\r\n')); }"
```

- [ ] **Step 2: Tests.** `npm test` → every suite passes (**42**, 1,339 checks — Task 1 changes no screen). `npm run test:sql` → every suite passes (**48**, 1,447 checks), including the new `4_reconcile.pglite.mjs` (**38**), `4_concurrency.mjs` (**4**, real PostgreSQL) and `2c_cost.pglite.mjs --with-0109` (**29**).
- [ ] **Step 3: Stop for the user** to review and commit. Do not push yet.

### Task 2: Dacs Web — the Reconciliation tab, "Paid now?", the Reports note

**Interfaces consumed:** Task 1's `rec_*` functions and `pur_op_reserve` / `pur_op_recover` (above); 0102's `pur_record` with `payments` and 0106's `pur_op_cancel` / `pur_op_state` (unchanged).
**Interfaces produced:** `window.ReconciliationAdmin.render(body)`, `window.ReconciliationAdmin.costChanges()` (→ `rec_bills()`); `window.DacsPendingSave` — `inspect(store, uid)` → `{status: 'none' | 'pending' | 'damaged' | 'blocked' | 'no_account', pending?, op?}`, `read(store, uid)`, `write(store, uid, pending)` → `true` only if read back, `clearOwn(store, uid, op)` → clears only if every readable id there is `op`, `outcome(error)` → `'saved' | 'refused' | 'unknown'`, `submit({store, uid, locks, account, resend, newId, build, reserve, record, label})` → `{outcome: 'saved' | 'refused' | 'unknown' | 'blocked', data, error, pending, resent, kept}` (`blocked`: `ACCOUNT_CHANGED`, `SAVE_IN_PROGRESS`, `LOCKS_UNAVAILABLE`, `STORAGE_BLOCKED`, `STORAGE_DAMAGED`, `NO_ACCOUNT`, `SAVE_PENDING`, `NOTHING_PENDING` — nothing sent), `cancel({store, uid, locks, account, cancelOp})` → `{state: 'recorded' | 'cancelled' | 'unknown' | 'none' | 'busy' | 'blocked' | 'account_changed' | 'unrecoverable'}`, `check({store, uid, locks, account, stateOp})`, `recover({store, uid, locks, account, recoverOps})` → `{state: 'settled', cancelled, recorded, cleared}` or `{state: 'unknown' | 'refused' | 'busy' | 'blocked' | 'account_changed'}` — `account()`: who is signed in now, asked before every request; in `expenses-module.js` `_expBoundCalls(actor)` → `{reserve, record, cancelOp, stateOp, recoverOps}` bound to that account's sign-in, or `null` when another account is signed in; `_expAccountNow()`; `_expPaidNowPayments(choice, total, partAmount, source, how, paidOn)`, `_expPaidNowProblem(choice, total, partAmount)`, `_expPayHowOf(paidWith)`, `_expSupplierBody(typed, suppliers)`, `_pcEnsureCostChanges(onReady)`, `_pcLateCostMoveNotes(changes, periods)`, `_pcLateCostMoveHtml(folderId)`.

**Create:** `js/reconciliation-admin.js`

```js
// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Reconciliation (WorkMate Stage 4, migration 0109).
// Owner accounts allowed Expenses only; the server refuses everyone else,
// and leaves the cash figures out for anyone but the main owner.
//
// It READS and POINTS. Nothing here writes an expense row, a payment, a
// billing period or a client bill; nothing feeds Spent, Earned or Profit.
// The only writes are two owner decisions that move no money (rec_*):
//   "Cover is right" (and its withdrawal) — clears one line's "Office
//     review" mark; its rows stay on Cover and in Spent (Q6);
//   "Bill checked" — a tick after the office decided, by hand, whether a
//     client's bill needs adjusting for a cost move (Q10).
//
// Sections, top to bottom:
//   Waiting                 — counts with links; decisions stay where they are (Q5)
//   Where every purchase peso is — own project · other projects · company
//                             stock · company stock loss = recorded; a
//                             difference is a bug to report (Q4); print, CSV
//   Waiting for a billing period — the "Office review" lines; "Cover is
//                             right…", and the marks with "Withdraw…" (Q6)
//   Money still out         — owed by supplier, credits; cash for the main owner (Q9)
//   Bills to check          — each approval and reversal of a stock cost move,
//                             with the months it changed on each side (Q10)
//
// Works in a browser (window.ReconciliationAdmin) and in Node for
// tests/reconciliation-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    function peso(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return (x < 0 ? '−' : '') + '₱' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // "YYYY-MM-DD" from LOCAL date parts (PH is UTC+8 — never toISOString).
    function dayKey(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    // This month so far: the default range.
    function monthRange(now) {
        const d = now || new Date();
        return { from: dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), to: dayKey(d) };
    }

    // "Adds up ✓", or the difference and how many purchases carry one.
    function addsUpText(totals) {
        const t = totals || {};
        if (!Number(t.with_difference)) return 'Adds up ✓';
        return 'Difference ' + peso(t.difference) + ' in ' + t.with_difference + (Number(t.with_difference) === 1 ? ' purchase' : ' purchases') +
            ' — please tell the developer (a difference is a bug, not a business event).';
    }

    // Waiting (Q5): one line per count above zero, with where it is decided.
    // go: {tab} = a Purchasing tab, {view} = another screen, {anchor} = a
    // section of this tab.
    const WAITING = [
        ['billing_period', 'waiting for a billing period', 'line', { anchor: 'rec-review' }],
        ['bills', 'to check on a client\'s bill', 'stock cost move', { anchor: 'rec-bills' }],
        ['cost_moves', 'waiting for approval', 'stock cost move', { tab: 'approvals' }],
        ['change_requests', 'waiting for the owner', 'purchase change', { tab: 'approvals' }],
        ['unpaid', 'Unpaid or Partly paid', 'purchase', { tab: 'purchases' }],
        ['own_money', 'to accept or reject', 'own-money payment', { tab: 'cash' }],
        ['returns', 'to confirm', 'petty-cash return', { tab: 'cash' }],
        ['disputes', 'disputed', 'petty-cash handover', { tab: 'cash' }],
        ['overpaid', 'Overpaid', 'purchase', { tab: 'cash' }],
        ['stock', 'waiting for the owner', 'stock record', { view: 'reqStock' }],
        ['tools', 'waiting for the owner (Lost or Retire)', 'tool', { view: 'reqTools' }],
    ];
    function waitingItems(w) {
        const x = w || {};
        return WAITING.filter(([k]) => Number(x[k]) > 0).map(([k, what, noun, go]) => ({
            key: k, count: Number(x[k]), go,
            label: x[k] + ' ' + noun + (Number(x[k]) === 1 ? '' : 's') + ' ' + what,
        }));
    }

    // One side of a cost move on a bill: "Barlin · October 2026 · billing #1 (Cover) −₱300.00".
    function sideText(s) {
        return s.project + ' · ' + s.period + (s.cover ? ' (Cover)' : '') + ' ' + peso(s.amount);
    }

    function placesCsv(data) {
        const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const money = (v) => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
        const head = ['Purchase date', 'Ref', 'What', 'Where', 'Supplier', 'Recorded', 'Own project', 'Other projects',
                      'Company stock', 'Company stock loss', 'Difference'];
        const lines = [head.map(cell).join(',')];
        (data.purchases || []).forEach(p => lines.push([p.purchase_date, p.ref, p.what, p.projects, p.supplier, money(p.recorded), money(p.own),
            money(p.other), money(p.company), money(p.loss), money(p.difference)].map(cell).join(',')));
        const t = data.totals || {};
        lines.push(['Total', '', t.purchases + ' purchases', '', '', money(t.recorded), money(t.own), money(t.other), money(t.company),
            money(t.loss), money(t.difference)].map(cell).join(','));
        (data.voided || []).forEach(v => lines.push([v.purchase_date, v.ref, 'VOIDED: ' + (v.what || ''), '', '', money(v.recorded), '', '', '', '', '']
            .map(cell).join(',')));
        return lines.join('\r\n') + '\r\n';
    }

    const ERRORS = {
        OWNER_ONLY: 'Only owner accounts see Reconciliation.',
        NOT_ALLOWED: 'This account is not set up for Expenses.',
        NOT_OFFICE: 'Only owner accounts see Reconciliation.',
        BAD_DATE: 'Check the dates.',
        BAD_RANGE: 'The first day must be on or before the last (at most about ten years).',
        REASON_REQUIRED: 'Please give a reason.',
        NOT_WAITING: 'This line is no longer waiting for a billing period. Reload the page.',
        NOT_COVER: 'This line is not on Cover. Reload the page.',
        CHANGED_SINCE: 'The line changed (or was marked again) after this mark, so it no longer applies.',
        BAD_STATE: 'This was already done or no longer applies. Reload the page.',
        BAD_NOTE: 'The note is too long (500 characters at most).',
        NOT_FOUND: 'That was not found. Reload the page.',
        BAD_OP: 'Something went wrong. Close the form and try again.',
        PGRST202: 'Reconciliation is not installed on the server yet (migration 0109).',
    };
    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) return ERRORS[code];
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    const pure = { peso, dayKey, monthRange, addsUpText, waitingItems, sideText, placesCsv, ERRORS, errorMessage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser ─────────────────────────────────────────────────────

    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;
    const ui = { from: null, to: null };

    const newOp = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    // One operation id per opened form: a double press or a retry records once.
    function sendOnce(fn) {
        const opId = newOp();
        return (...args) => fn(opId, ...args);
    }
    function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }
    function section(id, title, sub, inner) {
        return '<section id="' + id + '" class="rec-section" style="margin-bottom:28px"><h3 class="pur-h3">' + esc(title) + '</h3>' +
            (sub ? '<p class="req-muted">' + esc(sub) + '</p>' : '') + inner + '</section>';
    }
    const when = (ts) => ts ? RA.formatManila(ts) : '';

    // ── Waiting (Q5) ────────────────────────────────────────────────
    function waitingHtml(w) {
        const items = waitingItems(w);
        if (!items.length) return '<div class="att-empty">Nothing is waiting.</div>';
        return '<div class="rec-waiting">' + items.map((it, i) =>
            '<button type="button" class="att-btn att-btn--sm" data-go="' + i + '">' + esc(it.label) + ' →</button>').join(' ') + '</div>';
    }
    function go(target, host) {
        if (target.anchor) {
            const el = host.querySelector('#' + target.anchor);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (target.tab) { PA.ui.tab = target.tab; root.switchView('reqPurchasing'); return; }
        if (target.view) root.switchView(target.view);
    }

    // ── Where every purchase peso is (Q4) ───────────────────────────
    function placesHtml(d) {
        const t = d.totals || {};
        const ok = !Number(t.with_difference);
        const num = (v) => '<td style="text-align:right">' + esc(peso(v)) + '</td>';
        return '<div class="pur-rec-row">' +
              '<label class="att-label">From<input class="att-input" type="date" data-from value="' + esc(ui.from) + '"></label>' +
              '<label class="att-label">To<input class="att-input" type="date" data-to value="' + esc(ui.to) + '"></label>' +
              '<button type="button" class="att-btn att-btn--sm" data-show>Show</button>' +
              '<button type="button" class="att-btn att-btn--sm" data-print>Print</button>' +
              '<button type="button" class="att-btn att-btn--sm" data-csv>CSV</button>' +
            '</div>' +
            '<div class="att-info' + (ok ? '' : ' att-info--warn') + '"><i data-lucide="' + (ok ? 'check-circle' : 'alert-triangle') + '"></i><div><strong>' +
              esc(addsUpText(t)) + '</strong> ' + esc(t.purchases + ' purchase' + (Number(t.purchases) === 1 ? '' : 's') + ', ' + peso(t.recorded) +
              ': ' + peso(t.own) + ' in their own projects, ' + peso(t.other) + ' in other projects, ' + peso(t.company) + ' company stock, ' +
              peso(t.loss) + ' company stock loss.') + '</div></div>' +
            ((d.purchases || []).length
                ? '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table"><thead><tr>' +
                  '<th>Date</th><th>Ref</th><th>What · where</th><th style="text-align:right">Recorded</th><th style="text-align:right">Own project</th>' +
                  '<th style="text-align:right">Other projects</th><th style="text-align:right">Company stock</th><th style="text-align:right">Stock loss</th>' +
                  '<th style="text-align:right">Difference</th></tr></thead><tbody>' +
                  d.purchases.map(p => '<tr class="req-row" tabindex="0" data-purchase="' + esc(p.id) + '"' +
                      (Number(p.difference) ? ' style="background:#fff4f2"' : '') + '><td>' + esc(RA.formatDay(p.purchase_date)) + '</td><td><code>' + esc(p.ref) +
                      '</code></td><td>' + esc(p.what) + '<div class="req-muted">' + esc(p.projects) + (p.supplier ? ' · ' + esc(p.supplier) : '') + '</div></td>' +
                      num(p.recorded) + num(p.own) + num(p.other) + num(p.company) + num(p.loss) +
                      '<td style="text-align:right"><strong>' + esc(Number(p.difference) ? peso(p.difference) : '✓') + '</strong></td></tr>').join('') +
                  '</tbody></table></div></div></div>'
                : '<div class="att-empty">No purchases in these days.</div>') +
            ((d.voided || []).length
                ? '<p class="req-muted">Voided in these days (counted nowhere): ' + d.voided.map(v => esc(v.ref + ' ' + RA.formatDay(v.purchase_date) + ' ' +
                    peso(v.recorded) + (v.reason ? ' — ' + v.reason : ''))).join(' · ') + '</p>'
                : '');
    }
    function printPlaces(d) {
        const w = root.open('', '_blank');
        if (!w) return PA.notice('Allow pop-ups for this site to print.');
        const rows = (d.purchases || []).map(p => '<tr><td>' + esc(p.purchase_date) + '</td><td>' + esc(p.ref) + '</td><td>' + esc(p.what) +
            '<br><small>' + esc(p.projects) + '</small></td>' + [p.recorded, p.own, p.other, p.company, p.loss, p.difference]
            .map(v => '<td style="text-align:right">' + esc(peso(v)) + '</td>').join('') + '</tr>').join('');
        w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Where every purchase peso is</title><style>' +
            'body{font:12px Arial,sans-serif;margin:24px}table{width:100%;border-collapse:collapse}th,td{padding:5px;border-bottom:1px solid #ccc;text-align:left}' +
            '@page{size:A4 landscape;margin:12mm}</style></head><body>' +
            (root.dacsPrintHeader ? root.dacsPrintHeader('Reconciliation', 'Printed ' + esc(new Date().toLocaleString('en-PH'))) : '') +
            '<h2>Where every purchase peso is — ' + esc(d.from + ' to ' + d.to) + '</h2><p><strong>' + esc(addsUpText(d.totals)) + '</strong></p>' +
            '<table><thead><tr><th>Date</th><th>Ref</th><th>What · where</th><th>Recorded</th><th>Own project</th><th>Other projects</th>' +
            '<th>Company stock</th><th>Stock loss</th><th>Difference</th></tr></thead><tbody>' + rows + '</tbody></table>' +
            '<p>For internal use only. A payment never changes Spent; company stock is never a project\'s Spent or company overhead.</p></body></html>');
        w.document.close();
        w.focus();
        w.print();
    }
    function downloadCsv(d) {
        const blob = new Blob([placesCsv(d)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'purchase-reconciliation-' + d.from + '-to-' + d.to + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // ── Waiting for a billing period (Q6) ───────────────────────────
    function reviewHtml(r) {
        const wait = r.waiting || [];
        const marks = r.marks || [];
        return (wait.length ? wait.map(l => '<div class="att-card" data-line="' + esc(l.purchase_id + ':' + l.line_no) + '"><div class="att-card-body">' +
                '<div><strong>' + esc(l.item) + '</strong> · ' + esc(l.project) + ' · <strong>' + esc(peso(l.amount)) + '</strong> ' + pill('Office review', 'working') + '</div>' +
                '<div class="req-muted">Ref <code>' + esc(l.ref) + '</code> · bought ' + esc(RA.formatDay(l.purchase_date)) + ' · waiting ' + esc(l.days) +
                  ' day' + (Number(l.days) === 1 ? '' : 's') + ' · on ' + (l.rows || []).map(x => esc(x.period + (x.cover ? ' (Cover)' : '') + ' ' + peso(x.amount))).join(', ') + '</div>' +
                (l.period_now ? '<div class="att-info"><i data-lucide="info"></i><div>A billing period for that month exists now. To charge it there, open the row in ' +
                  'Project Control and save it again.</div></div>' : '') +
                '<div class="pur-rec-row"><button type="button" class="att-btn att-btn--sm" data-cover>Cover is right…</button></div>' +
              '</div></div>').join('')
            : '<div class="att-empty">No line is waiting for a billing period.</div>') +
            (marks.length ? '<h4 class="pur-h4">"Cover is right" marks</h4><ul class="pur-history">' + marks.map(m => '<li data-mark="' + esc(m.id) + '">' +
                esc(m.item + ' · ' + m.project + ' · ' + peso(m.amount) + ' (ref ' + m.ref + ', bought ' + RA.formatDay(m.purchase_date) + ')') + ' — "' + esc(m.reason) + '" · ' +
                esc(m.marked_by + ', ' + when(m.marked_at)) + ' ' +
                (m.withdrawn_at ? pill('Withdrawn', 'abandoned') + ' <span class="req-muted">' + esc(m.withdrawn_by + ', ' + when(m.withdrawn_at) + ': ' + m.withdraw_reason) + '</span>'
                  : m.current ? pill('Applies', 'done') + ' <button type="button" class="att-btn att-btn--sm" data-withdraw>Withdraw…</button>'
                  : pill('No longer applies (the line changed)', 'abandoned')) + '</li>').join('') + '</ul>' : '');
    }
    function openCover(line, onDone) {
        const send = sendOnce((opId, reason) => RA.rpc('rec_accept_cover', { p_op: opId, p_purchase: line.purchase_id, p_line_no: line.line_no, p_reason: reason }));
        RA.modal({
            title: 'Cover is right',
            sub: line.item + ' · ' + line.project + ' · ' + peso(line.amount) + ' (ref ' + line.ref + '). This only clears the "Office review" mark: ' +
                'the cost stays on Cover and in Spent, and nothing is billed.',
            body: '<div class="stk-form"><label class="att-label">Why Cover is right (kept with the mark)<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: 'Mark Cover is right',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }
    function openWithdraw(mark, onDone) {
        const send = sendOnce((opId, reason) => RA.rpc('rec_withdraw_cover', { p_op: opId, p_mark: mark.id, p_reason: reason }));
        RA.modal({
            title: 'Withdraw "Cover is right"',
            sub: mark.item + ' · ' + mark.project + ' · ' + peso(mark.amount) + '. The line goes back to waiting for a billing period; nothing moves.',
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: 'Withdraw',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }

    // ── Money still out (Q9) ────────────────────────────────────────
    function moneyHtml(m) {
        const owed = m.owed || [];
        const total = owed.reduce((s, x) => s + Number(x.balance || 0), 0);
        const nt = m.not_tracked || {};
        return (owed.length
                ? '<div class="att-card"><div class="att-card-body" style="padding:0"><table class="att-table req-table"><thead><tr><th>Supplier</th>' +
                  '<th style="text-align:right">Purchases</th><th style="text-align:right">Still owed</th></tr></thead><tbody>' +
                  owed.map(x => '<tr><td>' + esc(x.supplier) + '</td><td style="text-align:right">' + esc(x.purchases) +
                      (Number(x.partly_paid) ? ' <span class="req-muted">(' + esc(x.partly_paid) + ' partly paid)</span>' : '') + '</td><td style="text-align:right"><strong>' +
                      esc(peso(x.balance)) + '</strong></td></tr>').join('') +
                  '<tr><td><strong>Total</strong></td><td></td><td style="text-align:right"><strong>' + esc(peso(total)) + '</strong></td></tr></tbody></table></div></div>'
                : '<div class="att-empty">Nothing Unpaid or Partly paid.</div>') +
            (Number(nt.purchases) ? '<p class="req-muted">' + esc(nt.purchases + ' purchase' + (Number(nt.purchases) === 1 ? '' : 's') + ' (' + peso(nt.total) +
                ') recorded before payments were tracked — never counted as owed.') + '</p>' : '') +
            ((m.credits || []).length ? '<p><strong>Supplier credit left:</strong> ' + m.credits.map(c => esc(c.supplier + ' ' + peso(c.left))).join(' · ') + '</p>' : '') +
            (m.overpaid && Number(m.overpaid.purchases) ? '<p><strong>Overpaid:</strong> ' + esc(m.overpaid.purchases + ' purchase' +
                (Number(m.overpaid.purchases) === 1 ? '' : 's') + ', ' + peso(m.overpaid.amount) + ' to refund or keep as credit') + ' (Cash tab).</p>' : '') +
            ((m.buyers || []).length ? '<p><strong>Buyers:</strong> ' + m.buyers.map(b => esc(b.name + ' — holds ' + peso(b.cash_held) +
                (Number(b.shortfall) ? ', shortfall ' + peso(b.shortfall) : '') + (Number(b.owed_to_buyer) ? ', company owes ' + peso(b.owed_to_buyer) : '') +
                (Number(b.own_money_to_review) ? ', ' + peso(b.own_money_to_review) + ' own money to review' : ''))).join(' · ') + '</p>' : '') +
            '<p class="req-muted">Payments never change Spent. Paying, refunds and credits are recorded on each purchase and in the Cash tab.</p>';
    }

    // ── Bills to check (Q10) ────────────────────────────────────────
    function billsHtml(list) {
        if (!list.length) return '<div class="att-empty">No stock cost move has changed a project\'s months yet.</div>';
        return list.map((b, i) => '<div class="att-card" data-bill="' + i + '"><div class="att-card-body">' +
            '<div>' + (b.checked ? pill('Bill checked', 'done') : pill('To check', 'working')) + ' <strong>' + esc(b.change === 'reversed' ? 'Reversed' : 'Approved') +
              '</strong> ' + esc(when(b.at)) + ' · ' + esc(b.item + ' ' + (b.quantity || '') + ' ' + (b.unit || '') + ': ' + b.from + ' → ' + b.to + ' · ' + peso(b.value)) + '</div>' +
            '<ul class="req-muted">' + (b.sides || []).map(s => '<li>' + esc(sideText(s)) + '</li>').join('') + '</ul>' +
            (b.checked && b.note ? '<div class="req-muted">"' + esc(b.note) + '" — ' + esc(b.checked_by + ', ' + when(b.checked_at)) + '</div>' : '') +
            '<div class="pur-rec-row"><button type="button" class="att-btn att-btn--sm" data-tick>' + (b.checked ? 'Un-tick…' : 'Bill checked…') + '</button></div>' +
            '</div></div>').join('');
    }
    function openTick(b, onDone) {
        const checked = !b.checked;
        const send = sendOnce((opId, note) => RA.rpc('rec_bill_check', { p_op: opId, p_cost_move: b.cost_move_id, p_group: b.group,
                                                                         p_checked: checked, p_note: note }));
        RA.modal({
            title: checked ? 'Bill checked' : 'Un-tick "Bill checked"',
            sub: checked ? 'You decided whether the client\'s bill needs adjusting for this cost move. This never changes a bill.'
                         : 'It goes back to the list to check.',
            body: '<div class="stk-form"><label class="att-label">Note (optional — e.g. which bill, what you did)<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: checked ? 'Bill checked' : 'Un-tick',
            errorMessage,
            onSubmit: async (form) => { await send(form.note.value.trim()); },
            onDone,
        });
    }

    // ── The tab ─────────────────────────────────────────────────────
    async function render(body) {
        if (!ui.from) Object.assign(ui, monthRange());
        body.innerHTML = '<div class="att-empty">Loading…</div>';
        let places, waiting, review, bills, money;
        try {
            [places, waiting, review, bills, money] = await Promise.all([
                RA.rpc('rec_purchase_places', { p_from: ui.from, p_to: ui.to }), RA.rpc('rec_waiting'), RA.rpc('rec_review_lines'),
                RA.rpc('rec_bills'), RA.rpc('rec_money_out')]);
        } catch (e) {
            body.innerHTML = '<div class="att-empty">' + esc(errorMessage(e)) + '</div>';
            return;
        }
        bills = bills || [];
        const again = () => render(body);
        // After a mark or its withdrawal, Project Control's and Expenses' "Office review" marks follow at once.
        const afterMark = () => { if (root.expPurReloadFlags) root.expPurReloadFlags(); render(body); };
        body.innerHTML =
            '<p class="req-muted">Checks, not a ledger: nothing here moves a peso or changes a bill. Owner accounts only.</p>' +
            section('rec-waiting', 'Waiting', 'What needs someone, and where it is decided.', waitingHtml(waiting)) +
            section('rec-places', 'Where every purchase peso is', 'For the purchases made in these days, where their pesos sit today. ' +
                'The two sides come from different records, so they must agree.', placesHtml(places)) +
            section('rec-review', 'Waiting for a billing period', 'Charged to Cover because the purchase month had no billing period. ' +
                'Add the period and save the row again, or mark it "Cover is right".', reviewHtml(review)) +
            section('rec-money', 'Money still out', '', moneyHtml(money || {})) +
            section('rec-bills', 'Bills to check', 'Each approved or reversed stock cost move changed these months. Client bills are never changed ' +
                'automatically: decide by hand, then tick.', billsHtml(bills));
        const items = waitingItems(waiting);
        body.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(items[Number(b.dataset.go)].go, body)));
        body.querySelector('[data-show]').addEventListener('click', () => {
            ui.from = body.querySelector('[data-from]').value; ui.to = body.querySelector('[data-to]').value;
            again();
        });
        body.querySelector('[data-print]').addEventListener('click', () => printPlaces(places));
        body.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(places));
        body.querySelectorAll('[data-purchase]').forEach(tr => tr.addEventListener('click', () => PA.openPurchase(tr.dataset.purchase)));
        body.querySelectorAll('[data-line]').forEach(card => {
            const l = (review.waiting || []).find(x => x.purchase_id + ':' + x.line_no === card.dataset.line);
            card.querySelector('[data-cover]').addEventListener('click', () => openCover(l, afterMark));
        });
        body.querySelectorAll('[data-mark] [data-withdraw]').forEach(btn => {
            const m = (review.marks || []).find(x => x.id === btn.closest('[data-mark]').dataset.mark);
            btn.addEventListener('click', () => openWithdraw(m, afterMark));
        });
        body.querySelectorAll('[data-bill]').forEach(card => {
            card.querySelector('[data-tick]').addEventListener('click', () => openTick(bills[Number(card.dataset.bill)], again));
        });
        RA.icons();
    }

    // Project Control's Reports note (Q11) reads the same list: every approval
    // and reversal of a stock cost move with the months it changed. Owner accounts.
    function costChanges() { return RA.rpc('rec_bills'); }

    root.ReconciliationAdmin = Object.assign({}, pure, { render, costChanges });
})(typeof window !== 'undefined' ? window : globalThis);
```

**Create:** `tests/reconciliation-admin.test.js`

```js
// ════════════════════════════════════════════════════════════════════
// RECONCILIATION (0109, Stage 4):  run with  node tests/reconciliation-admin.test.js
//
// Zero dependencies. Loads the REAL js/reconciliation-admin.js (its pure
// half), lifts the real Project Control functions out of
// js/expenses-module.js, and reads the screens' source:
//   1. The tab: its words agree with the server; the checks, the waiting
//      links, the CSV; only owner accounts get the tab; it reads and points
//      — the only writes are the three owner decisions that move no money.
//   2. "Paid now?" on Add Expense (Q7): a payment goes only from the person's
//      own choice — never from "Paid with"; only accounts that may record
//      payments see it; the supplier is a listed one by id, or the typed name.
//   3. The Reports note (Q11): a month changed by a cost move approved after
//      it ended is named, with the day and the amount; nothing else is.
// ════════════════════════════════════════════════════════════════════
'use strict';
const rc = require('../js/reconciliation-admin.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0109_reconciliation.sql');
const JS = read('js/reconciliation-admin.js');
const BROWSER = JS.slice(JS.indexOf('// ── Browser'));
const EXP = read('js/expenses-module.js');
const HTML = read('admin.html');

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
// A top-level function of expenses-module.js, lifted verbatim.
function lift(name) {
  const i = EXP.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('SLICE NOT FOUND: function ' + name + ' in js/expenses-module.js');
  const j = EXP.indexOf('\n}\n', i);
  return EXP.slice(i, j + 3);
}
function load(names, ctx) {
  const src = names.map(lift).join('\n');
  return new Function('ctx', 'with(ctx){' + src + '\nreturn {' + names.join(',') + '};}')(ctx);
}

console.log('\nReconciliation: the words agree with the server');

test('every refusal 0109 can send has a sentence', () => {
  const codes = [...new Set([...SQL.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))];
  ok(codes.length >= 10, 'found the codes: ' + codes.join(' '));
  for (const c of codes) {
    if (c === 'HISTORY_LOCKED') continue;          // a trigger: the screens never touch the tables
    ok(rc.ERRORS[c], c + ' has no sentence');
  }
  for (const c of ['NOT_ALLOWED', 'NOT_OFFICE', 'BAD_OP', 'PGRST202']) ok(rc.ERRORS[c], c);
  eq(rc.errorMessage({ message: 'CHANGED_SINCE' }), rc.ERRORS.CHANGED_SINCE);
  eq(rc.errorMessage({ code: 'PGRST202' }), rc.ERRORS.PGRST202);
  ok(rc.errorMessage({ message: 'something new' }).startsWith('Something went wrong'), 'unknown kept');
});

test('every rec_ call the tab makes exists in 0109 and is granted to signed-in accounts, never to anon', () => {
  const calls = [...new Set([...BROWSER.matchAll(/RA\.rpc\('(rec_[a-z_]+)'/g)].map(m => m[1]))].sort();
  eq(calls, ['rec_accept_cover', 'rec_bill_check', 'rec_bills', 'rec_money_out', 'rec_purchase_places', 'rec_review_lines',
             'rec_waiting', 'rec_withdraw_cover']);
  for (const f of calls) {
    ok(new RegExp('create or replace function ' + f + '\\(').test(SQL), f + ' not in 0109');
    ok(new RegExp('grant execute on function ' + f + '\\([^)]*\\) to authenticated;').test(SQL), f + ' not granted');
    ok(new RegExp('revoke all on function ' + f + '\\([^)]*\\) from public, anon;').test(SQL), f + ' open to anon');
  }
});

console.log('\nReconciliation: the checks, links and CSV');

test('adds up / a difference: the words say a difference is a bug to report', () => {
  eq(rc.addsUpText({ with_difference: 0, difference: 0 }), 'Adds up ✓');
  const d = rc.addsUpText({ with_difference: 1, difference: -25 });
  ok(d.startsWith('Difference −₱25.00 in 1 purchase') && /tell the developer/.test(d) && /bug, not a business event/.test(d), d);
  ok(/in 2 purchases/.test(rc.addsUpText({ with_difference: 2, difference: 3 })), 'plural');
});

test('waiting: only counts above zero, each pointing where it is decided', () => {
  const items = rc.waitingItems({ billing_period: 2, unpaid: 18, cost_moves: 0, bills: 1, returns: 1, stock: 0, tools: 3 });
  eq(items.map(i => [i.key, i.label, i.go]), [
    ['billing_period', '2 lines waiting for a billing period', { anchor: 'rec-review' }],
    ['bills', '1 stock cost move to check on a client\'s bill', { anchor: 'rec-bills' }],
    ['unpaid', '18 purchases Unpaid or Partly paid', { tab: 'purchases' }],
    ['returns', '1 petty-cash return to confirm', { tab: 'cash' }],
    ['tools', '3 tools waiting for the owner (Lost or Retire)', { view: 'reqTools' }]]);
  eq(rc.waitingItems({}), []);
  eq(rc.waitingItems(null), []);
});

test('the default range is this month, from local date parts', () => {
  eq(rc.monthRange(new Date(2026, 9, 30, 23, 59)), { from: '2026-10-01', to: '2026-10-30' });
  eq(rc.monthRange(new Date(2026, 10, 1, 0, 5)), { from: '2026-11-01', to: '2026-11-01' });
  ok(!/\.toISOString\(/.test(JS), 'never toISOString');
});

test('a side of a bill names the project, the month and Cover', () => {
  eq(rc.sideText({ project: 'Barlin', period: 'October 2026 · billing #1', cover: true, amount: -200 }), 'Barlin · October 2026 · billing #1 (Cover) −₱200.00');
  eq(rc.sideText({ project: 'Bagong', period: 'No billing period', cover: false, amount: 500 }), 'Bagong · No billing period ₱500.00');
});

test('the CSV: every purchase, the total, the voided apart; commas and quotes kept safe', () => {
  const csv = rc.placesCsv({
    purchases: [{ purchase_date: '2026-10-24', ref: '7a03382a', what: 'Materials', projects: 'Eagle Residence', supplier: 'A "B", C',
                  recorded: 500, own: 500, other: 0, company: 0, loss: 0, difference: 0 }],
    totals: { purchases: 1, recorded: 500, own: 500, other: 0, company: 0, loss: 0, difference: 0 },
    voided: [{ purchase_date: '2026-10-20', ref: 'ffffffff', what: 'Gravel', recorded: 100 }] });
  const lines = csv.trim().split('\r\n');
  eq(lines[0], 'Purchase date,Ref,What,Where,Supplier,Recorded,Own project,Other projects,Company stock,Company stock loss,Difference');
  eq(lines[1], '2026-10-24,7a03382a,Materials,Eagle Residence,"A ""B"", C",500.00,500.00,0.00,0.00,0.00,0.00');
  eq(lines[2], 'Total,,1 purchases,,,500.00,500.00,0.00,0.00,0.00,0.00');
  eq(lines[3], '2026-10-20,ffffffff,VOIDED: Gravel,,,100.00,,,,,');
});

console.log('\nReconciliation: it reads and points');

test('the tab never writes a row: only the three owner decisions, each sent once', () => {
  ok(!/\.from\(|\.collection\(|sbClient/.test(BROWSER), 'no direct table access');
  for (const w of ['pur_record', 'pur_pay', 'pur_correct', 'pur_void', 'stk_cost_', 'stk_move', 'expenses']) {
    ok(!new RegExp("rpc\\('" + w).test(BROWSER), 'calls ' + w);
  }
  for (const w of ['rec_accept_cover', 'rec_withdraw_cover', 'rec_bill_check']) {
    ok(new RegExp("const send = sendOnce\\(\\(opId, (reason|note)\\) => RA\\.rpc\\('" + w + "', \\{ p_op: opId").test(BROWSER), w + ' sent once');
  }
});

test('only js/reconciliation-admin.js calls the rec_ functions', () => {
  const dir = path.join(__dirname, '..', 'js');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'reconciliation-admin.js')) {
    ok(!/['"]rec_[a-z_]+['"]/.test(read('js/' + f)), f + ' calls a rec_ function');
  }
});

test('the tab is for owner accounts, beside Company stock, after Purchasing loads', () => {
  const list = read('js/purchasing-admin-list.js');
  ok(/function reconcileTab\(\) \{\s+return !!\(root\.ReconciliationAdmin && PA\.ui\.isOwner\);/.test(list), 'the tab rule');
  ok(/\(reconcileTab\(\) \? t\('reconcile', 'Reconciliation'\) : ''\)/.test(list), 'the tab');
  ok(/if \(ui\.tab === 'reconcile' && reconcileTab\(\)\) return root\.ReconciliationAdmin\.render\(/.test(list), 'its body');
  const a = HTML.indexOf('<script src="js/purchasing-admin-core.js?v='), b = HTML.indexOf('<script src="js/reconciliation-admin.js?v=');
  ok(a !== -1 && b > a, 'reconciliation-admin.js loads after purchasing-admin-core.js');
  ok(HTML.indexOf('<script src="js/purchasing-admin-list.js?v=') < b + 1e9, 'and is on the page');
});

console.log('\nProject Control: "Paid now?" (Q7)');

const pay = load(['_expPayHowOf', '_expPaidNowPayments', '_expPaidNowProblem', '_expSupplierLabel', '_expSupplierBody'],
  { _EXP_PAY_HOW: { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer', check: 'Check', other: 'Other' } });
const PAID_WITH = [...HTML.slice(HTML.indexOf('<select id="expPaymentMethod"'), HTML.indexOf('</select>', HTML.indexOf('<select id="expPaymentMethod"')))
  .matchAll(/<option value="([^"]*)">/g)].map(m => m[1]);

test('"Paid with" alone never records a payment — whatever it says', () => {
  ok(PAID_WITH.length >= 10 && PAID_WITH.includes('GCash') && PAID_WITH.includes('Bank Transfer'), 'the form\'s list: ' + PAID_WITH);
  for (const m of PAID_WITH) {
    eq(pay._expPaidNowPayments('none', 28120, '', 'company', pay._expPayHowOf(m), '2026-10-24'), [], '"' + m + '" with Not paid yet');
    eq(pay._expPaidNowPayments(undefined, 28120, '', 'company', pay._expPayHowOf(m), '2026-10-24'), [], '"' + m + '" with nothing chosen');
  }
  // In the save: payments come only from the person's choice, read only for accounts that may record them.
  const add = EXP.slice(EXP.indexOf('async function handleAddExpense('), EXP.indexOf('\nasync function deleteExpense('))
    .replace(/\/\/[^\n]*/g, '');   // the code, not its comments
  ok(/const paidNow  = window\.currentCanBuy \? \(document\.getElementById\('expPaidNow'\)\?\.value \|\| 'none'\) : 'none';/.test(add), 'the choice');
  ok(/const payments = _expPaidNowPayments\(paidNow, totalAmt, paidPart, document\.getElementById\('expPaidFrom'\)\?\.value,\s+document\.getElementById\('expPaidHow'\)\?\.value, purchaseDate\);/.test(add), 'payments from the choice');
  ok(/if \(payments\.length\) body\.payments = payments;/.test(add), 'sent only when chosen');
  eq((add.match(/payments/g) || []).length, 4, 'no other payment in the save');
  ok(!/paymentMethod[^\n]*payments|payments[^\n]*paymentMethod/.test(add), '"Paid with" never feeds a payment');
});

test('Paid in full / Paid part: the amount, the day bought, where the money came from and how', () => {
  eq(pay._expPaidNowPayments('full', 28120, '', 'company', 'bank_transfer', '2026-10-24'),
     [{ amount: '28120', paid_on: '2026-10-24', method: 'bank_transfer', source: 'company', note: '' }]);
  eq(pay._expPaidNowPayments('part', 500, '1,20.5', 'petty_cash', 'gcash', '2026-10-24'),
     [{ amount: '120.5', paid_on: '2026-10-24', method: 'gcash', source: 'petty_cash', note: '' }]);
  eq(pay._expPaidNowPayments('full', 80, '', 'credit', 'zelle', '2026-10-24')[0].source, 'company', 'only company / petty cash / own money');
  eq(pay._expPaidNowPayments('full', 80, '', 'company', 'zelle', '2026-10-24')[0].method, 'other');
  eq(pay._expPaidNowProblem('none', 0, ''), '');
  eq(pay._expPaidNowProblem('full', 0, ''), 'Enter the total first.');
  eq(pay._expPaidNowProblem('part', 500, ''), 'Enter the amount paid.');
  ok(/Paid in full/.test(pay._expPaidNowProblem('part', 500, '500')), 'a part is less than the total');
  eq(pay._expPaidNowProblem('part', 500, '499.99'), '');
});

test('"How" starts from "Paid with" as a hint only; the person can change it', () => {
  eq(['GCash', 'Cash', 'Bank Transfer', 'BDO', 'BPI', 'Metrobank', 'Cheque', 'Maya', 'Lalamove', 'Credit Card', 'Other', ''].map(pay._expPayHowOf),
     ['gcash', 'cash', 'bank_transfer', 'bank_transfer', 'bank_transfer', 'bank_transfer', 'check', 'other', 'other', 'other', 'other', 'other']);
  ok(/<select id="expPaidHow" onchange="this\.dataset\.touched = '1'">/.test(HTML), 'a hand-picked How is kept');
  ok(/if \(how && !how\.dataset\.touched\) how\.value = _expPayHowOf\(/.test(EXP), 'the hint fills it only when untouched');
});

test('only accounts that may record payments see it; every opening starts at "Not paid yet"', () => {
  const setup = EXP.slice(EXP.indexOf('async function _expSetupPaidNow('), EXP.indexOf('\n}\n', EXP.indexOf('async function _expSetupPaidNow(')));
  ok(/const can = !!window\.currentCanBuy;\s+wrap\.style\.display = can \? '' : 'none';/.test(setup), 'shown to buyers only');
  ok(/choice\.value = 'none'/.test(setup), 'reset to Not paid yet');
  ok(/'<option value="company">Company \(paid directly\)<\/option>' \+ \(window\.currentUserRole === 'staff'/.test(setup), 'owner pays as the company');
  ok(/_expSetupPaidNow\(\);\n        _expCheckPending\(\);\n    \}/.test(EXP), 'set up when Add Expense opens (and any unsettled save checked)');
  const sel = HTML.slice(HTML.indexOf('<select id="expPaidNow"'), HTML.indexOf('</select>', HTML.indexOf('<select id="expPaidNow"')));
  ok(/^<select id="expPaidNow" onchange="expTogglePaidNow\(\)">\s+<option value="none">Not paid yet \/ record later<\/option>/.test(sel), 'first and default: Not paid yet');
  ok(/<div id="expPaidNowWrap" style="display:none;">/.test(HTML), 'hidden until set up');
});

test('the supplier: one from the list by its id (any case), else the typed name', () => {
  const list = [{ id: 's1', name: 'Wilcon Depot', branch: 'Pasig' }, { id: 's2', name: 'Citi Hardware', branch: '' }];
  eq(pay._expSupplierBody('wilcon depot · PASIG', list), { supplier: '', supplier_id: 's1' });
  eq(pay._expSupplierBody(' Citi Hardware ', list), { supplier: '', supplier_id: 's2' });
  eq(pay._expSupplierBody('Wilcon', list), { supplier: 'Wilcon' });
  eq(pay._expSupplierBody('', list), { supplier: '' });
  eq(pay._expSupplierBody('x'.repeat(250), list).supplier.length, 200);
  // A correction from Project Control keeps the listed supplier: the server inherits supplier_id (0097 pur_inherit).
  ok(/if not \(v_body \? 'supplier_id'\) and pu\.supplier_id is not null then/.test(read('supabase/migrations/0097_purchasing_office.sql')), 'kept on edit');
});

test('the server\'s payment refusals read in words on Add Expense', () => {
  for (const c of ['BAD_PAY_SOURCE', 'PERSON_REQUIRED', 'NOT_A_BUYER', 'BAD_METHOD', 'BAD_SUPPLIER', 'BAD_PAY', 'BUYER_REQUIRED']) {
    ok(new RegExp('\\b' + c + ':').test(EXP), c + ' has no sentence');
  }
  ok(EXP.indexOf('BAD_PAY_SOURCE:') < EXP.indexOf('BAD_PAY:'), 'the longer code is matched first');
});

test('"office review" on no-billing-period Cover follows the flag: "Cover is right" clears it there too (words only)', () => {
  const lines = new Set(['L1']);
  const f = load(['_pcNoPeriodStatus'], { _purReviewLines: lines })._pcNoPeriodStatus;
  eq(f([{ folderId: 'f', purchaseLineId: 'L1', amount: 344 }]), 'No billing period — office review');
  lines.delete('L1');
  eq(f([{ folderId: 'f', purchaseLineId: 'L1', amount: 344 }]), 'No billing period — Cover', 'marked Cover is right');
  eq(f([{ projectId: 'p', purchaseLineId: 'L2' }]), 'No billing period — Cover', 'a row on a period is not "no billing period"');
  eq((EXP.match(/status:_pcNoPeriodStatus\(model\.expenses\)/g) || []).length, 2, 'the screen and the CSV');
  ok(!/No billing period — office review' \}\)\);/.test(EXP), 'no fixed "office review" left');
  const portal = read('js/portal-app.compiled.js');
  ok(/const noPeriodReview = typeof window\.expPurNeedsReview === "function"\s+&& expensesRaw\.some\(e => !e\.projectId && e\.folderId === project\.id && window\.expPurNeedsReview\(e\.purchaseLineId\)\);/.test(portal), 'the billing-periods page reads the flag');
  ok(/noPeriodReview \? "; office review needed\." : "\."\]/.test(portal) && /\(noPeriodReview \? " — office review needed\." : "\."\)/.test(portal), 'both wordings');
  ok(/const afterMark = \(\) => \{ if \(root\.expPurReloadFlags\) root\.expPurReloadFlags\(\); render\(body\); \};/.test(BROWSER)
     && /openCover\(l, afterMark\)/.test(BROWSER) && /openWithdraw\(m, afterMark\)/.test(BROWSER), 'the tab reloads the flags after a mark');
});

console.log('\nReports: a month changed after it ended (Q11)');

// The note reads rec_bills' items — the server's lasting log of cost-move
// rows (0109). Each side names its billing period; a reversal is its own item.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const OCT = { id: 'p10', folderId: 'f1', month: 'October', year: 2026 };
const NOV = { id: 'p11', folderId: 'f1', month: 'November', year: 2026 };
const iso = (y, m, d, h = 9) => new Date(y, m, d, h).toISOString();
// An October cost (₱300 on the period, ₱200 Cover) moved to Bagong on 5 Nov; reversed on 3 Dec.
const MOVED = { cost_move_id: 'K1', change: 'approved', at: iso(2026, 10, 5), item: 'Cement', from: 'Barlin', to: 'Bagong',
                sides: [{ period_id: 'p10', amount: -300, cover: false }, { period_id: 'p10', amount: -200, cover: true },
                        { period_id: 'b11', amount: 500, cover: false }] };
const REVERSED = { cost_move_id: 'K1', change: 'reversed', at: iso(2026, 11, 3), item: 'Cement', from: 'Barlin', to: 'Bagong',
                   sides: [{ period_id: 'p10', amount: 300, cover: false }, { period_id: 'p10', amount: 200, cover: true },
                           { period_id: 'b11', amount: -500, cover: false }] };
function notesFor(changes, periods) {
  return load(['_pcLateCostMoveNotes'], { _MONTHS: MONTHS })._pcLateCostMoveNotes(changes, periods);
}

test('an October cost moved in November and reversed in December: two notes on October — the move, then its reversal', () => {
  const n = notesFor([REVERSED, MOVED], [OCT, NOV]);
  eq(n.map(x => [x.period, x.day, x.change, x.amount, x.what]),
     [['October 2026', '2026-11-05', 'approved', -500, 'Cement: Barlin → Bagong'],
      ['October 2026', '2026-12-03', 'reversed', 500, 'Cement: Barlin → Bagong']]);
});

test('nothing is named for a move inside its own month, a side with no period, another project\'s period, or no time', () => {
  eq(notesFor([
    { cost_move_id: 'K2', change: 'approved', at: iso(2026, 10, 5), sides: [{ period_id: 'p11', amount: 400 }] },   // November, in November
    { cost_move_id: 'K3', change: 'approved', at: iso(2026, 11, 1), sides: [{ period_id: null, amount: 150 }] },    // Cover, no period
    { cost_move_id: 'K4', change: 'reversed', at: iso(2026, 11, 1), sides: [{ period_id: 'zz', amount: 50 }] },     // not in this report
    { cost_move_id: 'K5', change: 'approved', sides: [{ period_id: 'p10', amount: -50 }] },                          // no time
    { cost_move_id: 'K6', change: 'approved', at: new Date(2026, 9, 31, 23, 59).toISOString(), sides: [{ period_id: 'p10', amount: -50 }] },
  ], [OCT, NOV]), []);
});

// The real _pcPrintReport, with what it calls around it stubbed: the printed page itself.
function printed(kind, owner = true) {
  let html = '';
  const win = { document: { write: (h) => { html += h; }, close() {} }, focus() {}, print() {} };
  const ctx = {
    _MONTHS: MONTHS, expProjects: [OCT, NOV], expFolders: [{ id: 'f1', name: 'Barlin' }], _pcCostChanges: [MOVED, REVERSED],
    _pcIsOwner: () => owner, _mvpEsc: (s) => String(s), formatNum: (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    _pcReportTable: () => '', _pcAllocationReportHtml: () => '<!--allocation-->', _pcReportDetails: () => '', _pcReportCategories: () => [],
    _pcPrintFundingSummary: () => '', _pcFundingLabel: () => '', _pcPrintPeriodLabel: () => '', showExpNotif: () => {},
    window: { dacsPrintHeader: () => '', open: () => win },
  };
  const f = load(['_pcReportFolderIds', '_pcLateCostMoveNotes', '_pcLateCostMoveHtml', '_pcPrintReport'], ctx);
  const t = { cover: 0, budget: 0, mats: 0, labor: 0, overhead: 0, totalSpent: 0, remaining: 0, usedPct: 0, txCount: 0, workerCount: 0 };
  f._pcPrintReport('Barlin · 2026', { rows: [], totals: t, expenses: [] }, [], { kind, folderId: 'f1', dateLabel: '2026', periodLabel: 'Monthly' });
  return html;
}

test('the printed Reports page carries both notes; a billing summary print, and a staff account, carry none', () => {
  const page = printed('dashboard');
  ok(page.includes('Changed after the month ended'), 'the heading');
  ok(page.includes('October 2026: changed Nov 5, 2026 by a stock cost move: −₱500.00 (Cement: Barlin → Bagong)'), 'the move: ' + page.slice(page.indexOf('Changed after'), page.indexOf('Changed after') + 400));
  ok(page.includes('October 2026: changed again Dec 3, 2026 — a stock cost move was reversed: +₱500.00 (Cement: Barlin → Bagong)'), 'the reversal');
  ok(page.indexOf('<!--allocation-->') < page.indexOf('Changed after the month ended'), 'under Billing Allocation Performance');
  ok(!printed('receipt').includes('Changed after the month ended'), 'not on a billing summary print');
  ok(!printed('dashboard', false).includes('Changed after the month ended'), 'not for staff');
});

test('the note reads the lasting log through the tab module, fresh each Reports visit — never the expense rows, never a total', () => {
  ok(/allocation\.innerHTML = _pcAllocationReportHtml\(report\.model\) \+ _pcLateCostMoveHtml\(_rptState\.folderId\);/.test(EXP), 'on the screen');
  ok(/if \(options\.kind === 'dashboard'\) body \+= _pcLateCostMoveHtml\(options\.folderId\);/.test(EXP), 'on the Reports print only');
  ok(/function renderReportsDashboard\(\) \{\n    if \(_pcEnsureReportOverhead\(renderReportsDashboard\)\) return;\n    if \(_pcEnsureCostChanges\(renderReportsDashboard\)\) return;/.test(EXP)
     && /if \(_pcEnsureCostChanges\(printReportsDashboard\)\) return;/.test(EXP), 'loaded before the screen and the print');
  ok(/window\.ReconciliationAdmin\.costChanges\(\)/.test(lift('_pcEnsureCostChanges')) && /function costChanges\(\) \{ return RA\.rpc\('rec_bills'\); \}/.test(BROWSER), 'rec_bills, through the tab module');
  ok(/_pcCostChanges = null;\n    _pcCostChangesPromise = null;/.test(lift('loadRptData')), 'fresh on each visit');
  const notes = lift('_pcLateCostMoveNotes');
  ok(!/stkCostMoveId|createdAt|\.expenses/.test(notes), 'never from the expense rows (a reversal deletes them)');
  ok(!/_pcLateCostMove|_pcCostChanges/.test(lift('_pcReportModel')), 'the totals never read the note');
  ok(!/\.toISOString\(/.test(notes), 'local date parts');
  ok(/if \(!_pcIsOwner\(\)\) return '';/.test(lift('_pcLateCostMoveHtml')), 'owner only');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `js/expense-pending-save.js`

```js
// ════════════════════════════════════════════════════════════════════
// A SAVE THAT MAY HAVE REACHED THE SERVER — Project Control's Add Expense
// (WorkMate Stage 4, reviews of 30–31 Oct 2026; R119, R120).
//
// Add Expense records a purchase — and, with "Paid now?", its payment — in
// ONE server operation (pur_record) under ONE operation id. The server
// answers a repeated id with its first answer (pur_ops), so the same id can
// never be recorded twice. If the reply is lost, though, the server may
// already have saved it. So the EXACT id and the EXACT body are kept in this
// browser — per account, across closing the form and reloading the page —
// until the server has answered:
//   saved     → forgotten.
//   refused   → the server said no (one transaction: nothing was saved) →
//               forgotten; the form keeps what was typed.
//   no answer → kept. Project Control locks the form (nothing can be
//               edited, no new entry can start) and offers:
//     Send it again — the same id and the same body, never the form's
//       fields: the server records it once, or replays its first answer;
//     Cancel it — pur_op_cancel: the server confirms it had been recorded,
//       or makes sure it never will be (the phone's "Cancel it", 2B-b R102).
//
// One save at a time per account, across tabs and windows: every step that
// reads and changes what is kept runs under the browser's lock for that
// account (Web Locks, navigator.locks — handed in). A second tab asking
// while the first is building, uploading or sending is told so and does
// nothing; without the lock nothing is sent. An answer clears only its own
// operation — never another save found in storage.
//
// Each id is registered with the server (pur_op_reserve, 0109) BEFORE it is
// sent, so the server can always settle every save this account may have
// sent: if what is kept is damaged and no single id can be read, nothing new
// is sent until recover() — pur_op_recover cancels for good every registered
// save the server has no answer for (its first request arriving later is
// refused), or finds it recorded. An absent row in a list proves nothing;
// there is no "clear it by hand".
//
// Browser storage is trusted only when it proves itself:
//   blocked  (the browser refuses to read or write it, drops a write, or is
//            full) → NOTHING is sent and nothing is uploaded: a save this
//            browser cannot keep could be lost on a reload, and entering it
//            again would then record it twice. Nothing is kept in page
//            memory instead — a reload would lose it.
//   damaged  (what is kept cannot be read back whole) → never taken for
//            "nothing waiting": no new entry is sent. The operation id is
//            also kept on its own, so the server can still settle it (on
//            opening, and Cancel it); with no single readable id, recover().
// Another account never sees, sends or settles it: it is kept per account,
// and the server's pur_ops is per account too — another account sending the
// same id would be a NEW operation, so the id must never reach it.
//
// Bound to the account that started it, through every step (review of
// 31 Oct, R121): the calls handed in carry THAT account's sign-in (never a
// shared client's current one), and before every request account() must
// still name that account. If someone else is signed in now (a sign-in in
// another tab), nothing more is sent and whatever is unsettled stays kept
// for the first account — to settle when it is signed in again.
//
// A refusal settles a save only on its FIRST sending, or when the server
// says it was cancelled for good: a later attempt refused for another reason
// (an expired sign-in, a permission changed) says nothing about the first
// request, which may have been recorded — so the save stays kept.
//
// The calls are handed in (reserve, record, cancelOp, stateOp, recoverOps,
// locks, account), so this file reads no table and holds no money rule.
// Works in a browser (window.DacsPendingSave) and in Node for
// tests/expense-pending-save.test.js.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    const PREFIX = 'dacs.addExpense.pending.';
    const LOCK = 'dacs.addExpense.';
    const OP_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    function key(uid) { return PREFIX + uid; }
    function opKey(uid) { return PREFIX + uid + '.op'; }
    const isOp = (v) => typeof v === 'string' && OP_RX.test(v);
    function whole(p) {
        return !!p && typeof p === 'object' && isOp(p.op) && !!p.body && typeof p.body === 'object' && !Array.isArray(p.body);
    }
    function parse(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }

    // What this browser holds for an account:
    //   {status: 'none'} · {status: 'pending', pending} ·
    //   {status: 'damaged', op} (op: the one readable id, or null) ·
    //   {status: 'blocked'} (storage cannot be read) · {status: 'no_account'}
    function inspect(store, uid) {
        if (!uid) return { status: 'no_account' };
        let raw, rawOp;
        try {
            if (!store) throw new Error('no storage');
            raw = store.getItem(key(uid));
            rawOp = store.getItem(opKey(uid));
        } catch (e) { return { status: 'blocked' }; }
        if (raw == null && rawOp == null) return { status: 'none' };
        const p = parse(raw);
        if (whole(p) && rawOp === p.op) return { status: 'pending', pending: p };
        // Damaged: settle with the server by id only if exactly one id can be read.
        const ids = new Set([rawOp, p && p.op].filter(isOp));
        return { status: 'damaged', op: ids.size === 1 ? [...ids][0] : null, raw, rawOp };
    }

    // The pending save, or null — only when one is kept whole.
    function read(store, uid) {
        const s = inspect(store, uid);
        return s.status === 'pending' ? s.pending : null;
    }

    // Keep (p) or clear (null). True only if the browser now holds exactly
    // that — read back, never assumed. The id is written first, on its own.
    function write(store, uid, p) {
        if (!uid || !store) return false;
        try {
            if (p) {
                const raw = JSON.stringify(p);
                store.setItem(opKey(uid), p.op);
                store.setItem(key(uid), raw);
                return store.getItem(key(uid)) === raw && store.getItem(opKey(uid)) === p.op;
            }
            store.removeItem(key(uid));
            store.removeItem(opKey(uid));
            return store.getItem(key(uid)) == null && store.getItem(opKey(uid)) == null;
        } catch (e) { return false; }
    }

    // An answer for operation `op` clears what is kept only if every id that
    // can be read there IS `op` — never another save found in storage.
    function clearOwn(store, uid, op) {
        let raw, rawOp;
        try { raw = store.getItem(key(uid)); rawOp = store.getItem(opKey(uid)); } catch (e) { return false; }
        if (raw == null && rawOp == null) return true;
        const p = parse(raw);
        const ids = [rawOp, p && p.op].filter(isOp);
        if (!ids.length || ids.some(id => id !== op)) return false;
        return write(store, uid, null);
    }

    // Can this browser keep anything at all? Asked before uploading.
    function probe(store, uid) {
        const k = PREFIX + uid + '.probe', v = String(Date.now()) + Math.random();
        try {
            store.setItem(k, v);
            const back = store.getItem(k);
            store.removeItem(k);
            return back === v;
        } catch (e) { return false; }
    }

    // The server answered with a refusal — a Postgres or PostgREST code — so
    // nothing was saved. No code at all (a dropped connection, a timeout): no
    // answer, and it may have been saved.
    function outcome(error) {
        if (!error) return 'saved';
        return /^(P0001|PGRST|22|23|28|42)/.test(String(error.code || '')) ? 'refused' : 'unknown';
    }

    async function call(fn, args) {
        try { return (await fn(args)) || { data: null, error: null }; }
        catch (e) { return { data: null, error: e }; }
    }

    // Runs fn holding this account's lock — or, if another tab or window
    // holds it, or the browser has no locks, does nothing: busy(code).
    function locked(o, fn, busy) {
        const L = o.locks;
        if (!L || typeof L.request !== 'function') return Promise.resolve(busy('LOCKS_UNAVAILABLE'));
        return L.request(LOCK + o.uid, { ifAvailable: true }, (lock) => (lock ? fn() : busy('SAVE_IN_PROGRESS')));
    }
    const asState = (code) => ({ state: code === 'SAVE_IN_PROGRESS' ? 'busy' : 'blocked', code });

    // Is the account that started this still the one signed in? Asked before
    // every request; no way to tell counts as no.
    async function still(o) {
        if (typeof o.account !== 'function') return false;
        try { return (await o.account()) === o.uid; } catch (e) { return false; }
    }
    const changed = { state: 'account_changed', code: 'ACCOUNT_CHANGED' };

    // Nothing sent, nothing uploaded, nothing changed.
    const stop = (code, extra) => Object.assign({ outcome: 'blocked', data: null, error: { message: code }, pending: null, resent: false }, extra || {});

    // One press of Save (resend false) or of "Send it again" (resend true).
    // A save still waiting is sent exactly as it was; otherwise build() makes
    // the new body (uploads included), and it is kept — and read back —
    // BEFORE anything is sent. Its id is registered with the server
    // (reserve), then sent (record). Blocked or damaged storage, no account,
    // another tab saving, no locks, someone else signed in now, or "Send it
    // again" with nothing waiting any more send nothing: outcome 'blocked'
    // (`kept`: a save stays waiting for this account).
    // o: {store, uid, locks, account(), resend, newId(), build(), reserve(args), record(args), label, now()}
    function submit(o) {
        if (inspect(o.store, o.uid).status === 'no_account') return Promise.resolve(stop('NO_ACCOUNT'));
        return locked(o, async () => {
            const s = inspect(o.store, o.uid);
            if (s.status === 'blocked') return stop('STORAGE_BLOCKED');
            if (s.status === 'damaged') return stop('STORAGE_DAMAGED', { op: s.op });
            if (s.status === 'none' && o.resend) return stop('NOTHING_PENDING');
            if (s.status === 'pending' && !o.resend) return stop('SAVE_PENDING', { pending: s.pending });
            let p = s.status === 'pending' ? s.pending : null;
            const resent = !!p;
            const away = () => stop('ACCOUNT_CHANGED', p ? { pending: p, resent, kept: true } : {});
            if (!(await still(o))) return away();
            if (!p) {
                if (!probe(o.store, o.uid)) return stop('STORAGE_BLOCKED');
                const body = await o.build();
                // Signed in as someone else while it uploaded: nothing kept, nothing sent.
                if (!(await still(o))) return away();
                p = { op: o.newId(), body, at: o.now ? o.now() : Date.now(), label: String(o.label || '') };
                if (!write(o.store, o.uid, p)) {
                    clearOwn(o.store, o.uid, p.op);
                    return stop('STORAGE_BLOCKED');
                }
            }
            // Registered first, so pur_op_recover can always settle it. A NEW save
            // whose registration is refused was never sent: forgotten. Anything
            // else without an answer stays kept.
            if (!(await still(o))) return away();
            const rv = await call(o.reserve, { p_op: p.op });
            if (rv.error) {
                const never = outcome(rv.error) === 'refused' && !resent;
                if (never) clearOwn(o.store, o.uid, p.op);
                return { outcome: never ? 'refused' : 'unknown', data: null, error: rv.error, pending: p, resent, kept: !never };
            }
            // Signed in as someone else between registering and recording: kept, nothing recorded.
            if (!(await still(o))) return away();
            const r = await call(o.record, { p_op: p.op, p_body: p.body });
            const out = outcome(r.error);
            const settled = out === 'saved' || (out === 'refused' && (!resent || /OP_CANCELLED/.test(String(r.error && r.error.message))));
            if (settled) clearOwn(o.store, o.uid, p.op);
            return { outcome: out, data: r.data, error: r.error, pending: p, resent, kept: !settled };
        }, stop);
    }

    // The id to settle with the server: the whole save's, or the one
    // readable id of a damaged one.
    function settleOp(s) { return s.status === 'pending' ? s.pending.op : s.status === 'damaged' ? s.op : null; }

    // "Cancel it": 'recorded' (it had been saved — nothing more to do) or
    // 'cancelled' (it never will be). Forgotten either way; kept if no answer.
    // 'unrecoverable': damaged with no readable id — only recover() settles it.
    // 'none' / 'blocked' / 'no_account' / 'busy' / 'account_changed': nothing asked, nothing changed.
    // o: {store, uid, locks, account(), cancelOp(args)}
    function cancel(o) {
        if (!o.uid) return Promise.resolve({ state: 'no_account' });
        return locked(o, async () => {
            const s = inspect(o.store, o.uid);
            if (s.status === 'none' || s.status === 'blocked') return { state: s.status };
            const op = settleOp(s);
            if (!op) return { state: 'unrecoverable' };
            if (!(await still(o))) return Object.assign({}, changed);
            const r = await call(o.cancelOp, { p_op: op });
            if (r.error || (r.data !== 'recorded' && r.data !== 'cancelled')) return { state: 'unknown', error: r.error, op };
            clearOwn(o.store, o.uid, op);
            return { state: r.data, op, pending: s.pending || null };
        }, asState);
    }

    // On opening the form: has the server recorded it meanwhile? 'recorded'
    // or 'cancelled' → forgotten. 'none' → kept: the first request may still
    // arrive, so only "Send it again" or "Cancel it" settles it.
    // o: {store, uid, locks, account(), stateOp(args)}
    function check(o) {
        if (!o.uid) return Promise.resolve({ state: 'no_account' });
        return locked(o, async () => {
            const s = inspect(o.store, o.uid);
            if (s.status === 'none') return { state: 'none_pending' };
            if (s.status === 'blocked') return { state: 'blocked' };
            const op = settleOp(s);
            if (!op) return { state: 'unrecoverable' };
            if (!(await still(o))) return Object.assign({}, changed);
            const r = await call(o.stateOp, { p_op: op });
            if (r.error) return { state: 'unknown', error: r.error, op };
            if (r.data === 'recorded' || r.data === 'cancelled') clearOwn(o.store, o.uid, op);
            return { state: r.data, op, pending: s.pending || null };
        }, asState);
    }

    // "Check with the server", for a damaged save with no readable id: the
    // server settles EVERY registered save of this account it has no answer
    // for (pur_op_recover — each cancelled for good, or found recorded). Only
    // then is the damaged copy cleared — and only if it is still the same.
    // 'settled' {cancelled, recorded}; 'unknown' (kept); 'refused' (a save
    // that can be settled by its own id — Send it again / Cancel it).
    // o: {store, uid, locks, account(), recoverOps()}
    function recover(o) {
        if (!o.uid) return Promise.resolve({ state: 'no_account' });
        return locked(o, async () => {
            const s = inspect(o.store, o.uid);
            if (s.status === 'blocked') return { state: 'blocked' };
            if (s.status !== 'damaged' || s.op) return { state: 'refused' };
            if (!(await still(o))) return Object.assign({}, changed);
            const r = await call(o.recoverOps, {});
            if (r.error || !r.data || typeof r.data !== 'object') return { state: 'unknown', error: r.error };
            let same = false;
            try { same = o.store.getItem(key(o.uid)) === s.raw && o.store.getItem(opKey(o.uid)) === s.rawOp; } catch (e) { same = false; }
            const cleared = same && write(o.store, o.uid, null);
            return { state: 'settled', cancelled: Number(r.data.cancelled) || 0, recorded: Number(r.data.recorded) || 0, cleared };
        }, asState);
    }

    const api = { key, opKey, inspect, read, write, clearOwn, probe, outcome, submit, cancel, check, recover };
    root.DacsPendingSave = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

**Modify:** `js/expenses-module.js`

```diff
diff --git a/js/expenses-module.js b/js/expenses-module.js
index 0cc9a8a..7408737 100644
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -2789,10 +2789,177 @@ async function _uploadReceiptFile(kind, file) {
 }
 
 // One id per Save press, kept until the save succeeds, so a retry after a
-// lost response can never create a second copy (0089 unique index).
-let _expSubmissionId = null;
+// lost response can never create a second copy (0089 unique index). Add
+// Expense keeps its id AND body in js/expense-pending-save.js instead — across
+// closing the form and reloading — until the server answers (Stage 4 review).
 let _paySubmissionId = null;
 
+// ── A save that may already be on the server (js/expense-pending-save.js) ──
+function _expPendingStore() { try { return window.localStorage; } catch (e) { return null; } }
+// One save at a time per account across tabs and windows (Web Locks).
+function _expLocks() { try { return navigator.locks || null; } catch (e) { return null; } }
+// The account that pressed Save (pur_ops is per account), never the data owner.
+function _expActor() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || null; }
+// Every request of one save carries the sign-in of the account that pressed
+// Save (R121): a client bound to that account's token — never the shared
+// client, whose session follows whoever signed in last, in any tab. null:
+// someone else is signed in now, so nothing is sent.
+let _expBound = null;   // {token, calls} — reused while the token is the same
+async function _expBoundCalls(actor) {
+    let token = null;
+    try {
+        const { data } = await window.sbClient.auth.getSession();
+        const s = data && data.session;
+        if (actor && s && s.user && s.user.id === actor) token = s.access_token;
+    } catch (e) { token = null; }
+    if (!token) return null;
+    if (_expBound && _expBound.token === token) return _expBound.calls;
+    const c = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
+        global: { headers: { Authorization: 'Bearer ' + token } },
+        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'dacs.addExpense.bound' },
+    });
+    const calls = { reserve: (args) => c.rpc('pur_op_reserve', args), record: (args) => c.rpc('pur_record', args),
+                    cancelOp: (args) => c.rpc('pur_op_cancel', args), stateOp: (args) => c.rpc('pur_op_state', args),
+                    recoverOps: () => c.rpc('pur_op_recover') };
+    _expBound = { token, calls };
+    return calls;
+}
+// Who is signed in now — asked before every request of a save.
+async function _expAccountNow() {
+    try {
+        const { data } = await window.sbClient.auth.getSession();
+        return (data && data.session && data.session.user && data.session.user.id) || null;
+    } catch (e) { return null; }
+}
+function _expPendingState() { return DacsPendingSave.inspect(_expPendingStore(), _expActor()); }
+// What the box says for each state of DacsPendingSave.inspect().
+function _expPendingText(s) {
+    if (s.status === 'pending') {
+        const p = s.pending, when = new Date(p.at);
+        return 'A save from ' + (isNaN(when) ? 'earlier' : when.toLocaleString('en-PH',
+            { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + (p.label ? ' — ' + p.label : '') +
+            ' — may already be on the server: there was no answer. Settle it first; nothing in this form changes until then.';
+    }
+    if (s.status === 'damaged' && s.op) return 'A save kept in this browser can no longer be read whole, so it cannot be sent again. ' +
+        'Cancel it: the server says whether it had been saved, or makes sure it never will be. Nothing new is sent until then.';
+    if (s.status === 'damaged') return 'A save kept in this browser is damaged and its ID cannot be read — and a missing row in the list ' +
+        'does not prove it will not still arrive. Check with the server: every Add Expense save of your account that has not reached it ' +
+        'is cancelled for good; anything that did is in the list once. Nothing new is sent until then.';
+    if (s.status === 'no_account') return 'Sign in again to add an expense.';
+    return 'This browser is not letting Project Control keep a save (site storage is blocked, full, or in a private window), so nothing ' +
+        'is sent: a save it cannot keep could be recorded twice. Allow site storage, then open this form again.';
+}
+// Why a press sent nothing (DacsPendingSave's 'blocked' codes).
+function _expNotSentText(code) {
+    if (code === 'SAVE_IN_PROGRESS') return 'Another tab or window is saving an expense for this account — wait for it to finish, then try again.';
+    if (code === 'LOCKS_UNAVAILABLE') return 'This browser cannot keep two tabs from saving the same expense (it needs updating), so nothing is sent.';
+    if (code === 'ACCOUNT_CHANGED') return 'The signed-in account changed (in another tab or window), so nothing more is sent. The save stays with ' +
+        'the account that pressed Save — sign in as that account again to settle it.';
+    const now = _expPendingState();
+    return _expPendingText(now.status === 'none' ? { status: 'blocked' } : now);
+}
+// Locks the form while a save may be on the server — or while this browser
+// cannot keep one (blocked or damaged storage): nothing can be edited and no
+// new entry starts; only the box's choices (and closing).
+function _expShowPending(s) {
+    const box = document.getElementById('expPendingBox');
+    if (!box || !s || s.status === 'none') return;
+    document.getElementById('expPendingText').textContent = _expPendingText(s);
+    const choice = (id, on) => { const b = document.getElementById(id); if (b) b.style.display = on ? '' : 'none'; };
+    choice('expPendingResend', s.status === 'pending');
+    choice('expPendingCancel', s.status === 'pending' || (s.status === 'damaged' && !!s.op));
+    choice('expPendingRecover', s.status === 'damaged' && !s.op);
+    box.style.display = '';
+    document.querySelectorAll('#addExpenseForm .aer-body input, #addExpenseForm .aer-body select, #addExpenseForm .aer-body textarea, ' +
+        '#addExpenseForm .aer-body button, #addExpenseBtn').forEach(el => {
+        if (el.closest('#expPendingBox') || el.disabled) return;
+        el.disabled = true;
+        el.dataset.pendingLock = '1';
+    });
+}
+function _expHidePending() {
+    const box = document.getElementById('expPendingBox');
+    if (box) box.style.display = 'none';
+    document.querySelectorAll('[data-pending-lock]').forEach(el => { el.disabled = false; delete el.dataset.pendingLock; });
+}
+// Shows what this browser holds now (unlocked only when nothing is waiting).
+function _expRefreshPending() { _expHidePending(); _expShowPending(_expPendingState()); }
+// "Send it again" or "Cancel it" in a window whose save another tab of this
+// account already settled: nothing to send — the form's values may already
+// be in the list, so the form is cleared, never saved as a new entry.
+function _expSettledElsewhere() {
+    _expHidePending();
+    showExpNotif('That save was already settled in another tab or window — check the list before entering it again.', 'error');
+    document.getElementById('addExpenseForm').reset();
+    closeExpModal('addExpenseModal');
+    refreshOvAllData();
+}
+// When Add Expense opens: a save from before (this page or an earlier one)?
+// Ask the server whether it was recorded meanwhile; otherwise keep it locked.
+async function _expCheckPending() {
+    const store = _expPendingStore(), uid = _expActor();
+    const s = DacsPendingSave.inspect(store, uid);
+    _expHidePending();
+    if (s.status === 'none') return;
+    _expShowPending(s);
+    const calls = await _expBoundCalls(uid);
+    if (!calls) return;                       // someone else is signed in now: shown, not asked
+    const r = await DacsPendingSave.check({ store, uid, locks: _expLocks(), account: _expAccountNow, stateOp: calls.stateOp });
+    if (r.state === 'recorded') {
+        showExpNotif('Your earlier save had reached the server — it is in the list, once.', 'success');
+        refreshOvAllData();
+    } else if (r.state === 'cancelled') {
+        showExpNotif('Your earlier save was cancelled — it was never recorded, and never will be. Enter it again if it is still needed.', 'success');
+    }
+    if (r.state === 'recorded' || r.state === 'cancelled') _expRefreshPending();
+}
+window.expResendPending = function () { return handleAddExpense(null, { resend: true }); };
+window.expCancelPending = async function () {
+    const uid = _expActor(), calls = await _expBoundCalls(uid);
+    if (!calls) { showExpNotif('Nothing changed — ' + _expNotSentText('ACCOUNT_CHANGED'), 'error'); return; }
+    const r = await DacsPendingSave.cancel({ store: _expPendingStore(), uid, locks: _expLocks(), account: _expAccountNow,
+                                             cancelOp: calls.cancelOp });
+    if (r.state === 'none') { _expSettledElsewhere(); return; }
+    if (r.state !== 'recorded' && r.state !== 'cancelled') {
+        showExpNotif(r.state === 'unknown' ? 'Still no answer from the server — nothing changed. Try again when the connection is back.'
+                                           : 'Nothing changed — ' + _expNotSentText(r.code), 'error');
+        _expRefreshPending();
+        return;
+    }
+    _expRefreshPending();
+    if (r.state === 'recorded') {
+        showExpNotif('It had been saved — it is in the list once, exactly as first entered.', 'success');
+        document.getElementById('addExpenseForm').reset();
+        closeExpModal('addExpenseModal');
+    } else {
+        showExpNotif('Cancelled — the server will never record it. Enter it again if it is still needed.', 'success');
+    }
+    refreshOvAllData();
+};
+// A damaged save with no readable id: the server settles every Add Expense
+// save of this account it has no answer for (pur_op_recover) — cancelled for
+// good, or found recorded — and only then does the form unlock (R120).
+window.expRecoverPending = async function () {
+    const yes = await showConfirm('Check with the server? Every Add Expense save of your account that has not reached the server — in this ' +
+        'browser or another — is cancelled for good, so it can never be recorded later. Anything that did reach it stays in the list, once.',
+        { title: 'Check with the server', confirm: 'Check with the server', tone: 'ok' });
+    if (!yes) return;
+    const uid = _expActor(), calls = await _expBoundCalls(uid);
+    if (!calls) { showExpNotif('Nothing changed — ' + _expNotSentText('ACCOUNT_CHANGED'), 'error'); return; }
+    const r = await DacsPendingSave.recover({ store: _expPendingStore(), uid, locks: _expLocks(), account: _expAccountNow,
+                                              recoverOps: calls.recoverOps });
+    _expRefreshPending();
+    if (r.state === 'settled') {
+        showExpNotif('Settled with the server: ' + r.cancelled + ' save(s) that had not reached it are cancelled for good — they can never be ' +
+            'recorded. Anything that did reach it is in the list once; enter again only what is missing.', 'success');
+        refreshOvAllData();
+    } else if (r.state === 'unknown') {
+        showExpNotif('No answer from the server — nothing changed; the form stays locked. Try again when the connection is back.', 'error');
+    } else if (r.state !== 'refused') {
+        showExpNotif('Nothing changed — ' + _expNotSentText(r.code), 'error');
+    }
+};
+
 // ════════════════════════════════════════════════════════════
 // PURCHASES (migration 0096) — one server operation records them
 // ════════════════════════════════════════════════════════════
@@ -2823,6 +2990,14 @@ function _purErrorText(err) {
         NOT_OFFICE:            'Only office accounts can record expenses.',
         NOT_ALLOWED:           'This account is not set up for Expenses.',
         BUYER_REQUIRED:        'This needs an account that may buy (the owner, or staff with the Buyer switch).',
+        // "Paid now?" (0102): the payment is saved with the purchase — both or neither.
+        BAD_PAY_SOURCE:        'Choose where the money came from.',
+        PERSON_REQUIRED:       'Petty cash and own money belong to a staff buyer — choose "Company (paid directly)", or record it in Requests → Purchasing.',
+        NOT_A_BUYER:           'Only a staff buyer holds petty cash or own money.',
+        BAD_METHOD:            'Choose how it was paid.',
+        BAD_SUPPLIER:          'That supplier is no longer on the list — type the name again.',
+        BAD_PAY:               'Check the payment: more than zero, and not more than the total.',
+        OP_CANCELLED:          'That earlier save was cancelled, so it was never recorded — enter it again.',
         BAD_DOCS:              'A receipt photo link is not valid — attach the photo again.',
         EXTRA_REASON_REQUIRED: 'This purchase covers a request and would now be more than the request needs — correct it in Requests → Purchasing, where you can give the reason.',
         BAD_REQUEST_LINK:      'This purchase is linked to a request for another project — correct it in Requests → Purchasing.',
@@ -2984,6 +3159,13 @@ async function _purLoadReviewFlags() {
     window.dispatchEvent(new Event('dacs:pur-review-flags'));
 }
 window.expPurNeedsReview = id => !!id && _purReviewLines.has(id);
+// The words for Cover material with no billing period (0096): "office review"
+// only while one of its lines still waits — "Cover is right" (Stage 4, Q6)
+// clears it like every other Office review mark. Words only; no total reads it.
+function _pcNoPeriodStatus(rows) {
+    return (rows || []).some(e => !e.projectId && e.purchaseLineId && _purReviewLines.has(e.purchaseLineId))
+        ? 'No billing period — office review' : 'No billing period — Cover';
+}
 window.expPurPendingChange = id => (id && _purPending.get(id)) || null;
 window.expPurPayBadge = id => (id && window.currentUserRole === 'owner' && _purPayBadges[id]) || null;
 // The Purchasing tab sends changes to the owner too; it re-reads the flags.
@@ -3030,65 +3212,119 @@ async function _saveRowsOnce(collection, rows, submissionId) {
     }
 }
 
-async function handleAddExpense(e) {
-    e.preventDefault();
+async function handleAddExpense(e, opts = {}) {
+    if (e && e.preventDefault) e.preventDefault();
+
+    // A save that may already be on the server is settled first (Stage 4
+    // review): Save only shows it; "Send it again" resends it EXACTLY — the
+    // same operation id and body, never the form's fields. Storage that is
+    // blocked or damaged sends nothing new (R119).
+    const pendingStore = _expPendingStore(), actor = _expActor();
+    const state = DacsPendingSave.inspect(pendingStore, actor);
+    const pending = state.status === 'pending' ? state.pending : null;
+    if (opts.resend && state.status === 'none') { _expSettledElsewhere(); return; }
+    if (state.status !== 'none' && !(pending && opts.resend)) { _expShowPending(state); return; }
+    let build = null, label = '';
+    if (!pending) {
+        // The project this expense belongs to. The SERVER picks its billing
+        // periods (see "PURCHASES (migration 0096)" above); nothing is split here.
+        const folderId = expCurrentProject ? (expCurrentProject.folderId || null) : (expCurrentFolder ? expCurrentFolder.id : null);
+        if (!folderId) { showExpNotif('Open a project first — this expense needs one.', 'error'); return; }
+
+        const totalAmt   = Math.round((parseFloat((document.getElementById('expAmount').value || '').replace(/,/g, '')) || 0) * 100) / 100;
+        const expName    = document.getElementById('expName').value.trim();
+        const category   = document.getElementById('expCategory').value;
+        const qty        = Math.round((parseFloat(document.getElementById('expQty').value) || 1) * 1000) / 1000 || 1;
+        const dateTime   = _buildDateTime('expDate', 'expTime');
+        const notes      = document.getElementById('expNotes').value.trim();
+        const paymentMethod = (document.getElementById('expPaymentMethod')?.value || '').trim();
+        // "Paid now?" (Stage 4, Q7): accounts that may record payments, and only what the person chose.
+        const paidNow  = window.currentCanBuy ? (document.getElementById('expPaidNow')?.value || 'none') : 'none';
+        const paidPart = document.getElementById('expPaidAmount')?.value || '';
+        // Inventory toggle — when on, this material is also tracked as a stock item.
+        // Once Stock is on (0104, Q29) the old tick is retired: the server refuses it,
+        // and the form hides it (openExpModal). Stock lives in Requests → Stock.
+        const toInventory = !window.currentStockOn && !!document.getElementById('expToInventory')?.checked;
+        const invUnit     = document.getElementById('expInvUnit')?.value || 'pcs';
+        const invMinStock = Math.round(Math.max(0, parseFloat(document.getElementById('expInvMinStock')?.value) || 0) * 1000) / 1000;
+        // The ACTUAL purchase date decides the billing month (spec §3.3).
+        const purchaseDate = dateTime ? dateTime.slice(0, 10) : _purLocalDateKey(new Date());
+        const paidProblem = _expPaidNowProblem(paidNow, totalAmt, paidPart);
+        if (paidProblem) { showExpNotif(paidProblem, 'error'); return; }
+        label = (expName || 'Expense') + ' · ₱' + formatNum(totalAmt) + (paidNow !== 'none' ? ' (paid now)' : '');
+
+        // The body is built ONCE (uploads included) and kept with its operation id
+        // until the server answers.
+        build = async () => {
+            // Supporting docs (PO/DR/SI/PR): uploaded as files first — a failure
+            // stops here with nothing saved and the form untouched.
+            const _docMap = { po: 'expDocPO', dr: 'expDocDR', si: 'expDocSI', pay: 'expDocPR' };
+            const docUrls = {};
+            for (const [key, inputId] of Object.entries(_docMap)) {
+                const file = document.getElementById(inputId)?.files?.[0];
+                if (file) docUrls[key] = await _uploadReceiptFile('expense', file);
+            }
 
-    // The project this expense belongs to. The SERVER picks its billing
-    // periods (see "PURCHASES (migration 0096)" above); nothing is split here.
-    const folderId = expCurrentProject ? (expCurrentProject.folderId || null) : (expCurrentFolder ? expCurrentFolder.id : null);
-    if (!folderId) { showExpNotif('Open a project first — this expense needs one.', 'error'); return; }
-
-    const totalAmt   = Math.round((parseFloat((document.getElementById('expAmount').value || '').replace(/,/g, '')) || 0) * 100) / 100;
-    const expName    = document.getElementById('expName').value.trim();
-    const category   = document.getElementById('expCategory').value;
-    const qty        = Math.round((parseFloat(document.getElementById('expQty').value) || 1) * 1000) / 1000 || 1;
-    const dateTime   = _buildDateTime('expDate', 'expTime');
-    const notes      = document.getElementById('expNotes').value.trim();
-    const paymentMethod = (document.getElementById('expPaymentMethod')?.value || '').trim();
-    // Inventory toggle — when on, this material is also tracked as a stock item.
-    // Once Stock is on (0104, Q29) the old tick is retired: the server refuses it,
-    // and the form hides it (openExpModal). Stock lives in Requests → Stock.
-    const toInventory = !window.currentStockOn && !!document.getElementById('expToInventory')?.checked;
-    const invUnit     = document.getElementById('expInvUnit')?.value || 'pcs';
-    const invMinStock = Math.round(Math.max(0, parseFloat(document.getElementById('expInvMinStock')?.value) || 0) * 1000) / 1000;
-    // The ACTUAL purchase date decides the billing month (spec §3.3).
-    const purchaseDate = dateTime ? dateTime.slice(0, 10) : _purLocalDateKey(new Date());
+            const body = {
+                source: 'expenses_form',
+                purchase_date: purchaseDate,
+                date_time: dateTime || purchaseDate,
+                receipt_total: totalAmt,
+                notes,
+                payment_method: paymentMethod,
+                ...(window.currentCanBuy ? _expSupplierBody(document.getElementById('expSupplier')?.value, _expSuppliers) : {}),
+                docs: {
+                    ...(docUrls.po  ? { po_image_url:         docUrls.po  } : {}),
+                    ...(docUrls.dr  ? { delivery_receipt_url: docUrls.dr  } : {}),
+                    ...(docUrls.si  ? { supplier_invoice_url: docUrls.si  } : {}),
+                    ...(docUrls.pay ? { payment_receipt_url:  docUrls.pay } : {}),
+                },
+                lines: [{ destination: 'project', folder_id: folderId, item_name: expName, category,
+                          quantity: qty, unit: toInventory ? invUnit : '', amount: totalAmt,
+                          in_inventory: toInventory, min_stock: toInventory ? invMinStock : 0 }],
+                charges: [],
+            };
+            const payments = _expPaidNowPayments(paidNow, totalAmt, paidPart, document.getElementById('expPaidFrom')?.value,
+                                                 document.getElementById('expPaidHow')?.value, purchaseDate);
+            if (payments.length) body.payments = payments;
+            return body;
+        };
+    }
 
     try {
         showExpLoading('addExpenseBtn', true);
-
-        // Supporting docs (PO/DR/SI/PR): uploaded as files first — a failure
-        // stops here with nothing saved and the form untouched.
-        const _docMap = { po: 'expDocPO', dr: 'expDocDR', si: 'expDocSI', pay: 'expDocPR' };
-        const docUrls = {};
-        for (const [key, inputId] of Object.entries(_docMap)) {
-            const file = document.getElementById(inputId)?.files?.[0];
-            if (file) docUrls[key] = await _uploadReceiptFile('expense', file);
+        // One operation id and one body per save (pur_ops records an id once),
+        // kept until the server answers — js/expense-pending-save.js — and bound
+        // to the account that pressed Save through every request (R121).
+        const calls = await _expBoundCalls(actor);
+        if (!calls) { showExpNotif('Not sent — ' + _expNotSentText('ACCOUNT_CHANGED'), 'error'); return; }
+        const res = await DacsPendingSave.submit({ store: pendingStore, uid: actor, locks: _expLocks(), account: _expAccountNow,
+                                                   resend: !!opts.resend, newId: () => DacsReceipts.newId(), build, label,
+                                                   reserve: calls.reserve, record: calls.record });
+        if (res.outcome === 'blocked') {
+            // Nothing was sent or uploaded: this browser cannot keep the save, or one still waits.
+            if (res.error.message === 'NOTHING_PENDING') { _expSettledElsewhere(); return; }
+            showExpNotif('Not sent — ' + _expNotSentText(res.error.message), 'error');
+            return;
         }
-
-        // One id per Save press: a resent request is recorded once (pur_ops).
-        if (!_expSubmissionId) _expSubmissionId = DacsReceipts.newId();
-        const body = {
-            source: 'expenses_form',
-            purchase_date: purchaseDate,
-            date_time: dateTime || purchaseDate,
-            receipt_total: totalAmt,
-            notes,
-            payment_method: paymentMethod,
-            docs: {
-                ...(docUrls.po  ? { po_image_url:         docUrls.po  } : {}),
-                ...(docUrls.dr  ? { delivery_receipt_url: docUrls.dr  } : {}),
-                ...(docUrls.si  ? { supplier_invoice_url: docUrls.si  } : {}),
-                ...(docUrls.pay ? { payment_receipt_url:  docUrls.pay } : {}),
-            },
-            lines: [{ destination: 'project', folder_id: folderId, item_name: expName, category,
-                      quantity: qty, unit: toInventory ? invUnit : '', amount: totalAmt,
-                      in_inventory: toInventory, min_stock: toInventory ? invMinStock : 0 }],
-            charges: [],
-        };
-        const { data, error } = await window.sbClient.rpc('pur_record', { p_op: _expSubmissionId, p_body: body });
-        if (error) throw error;
-        _expSubmissionId = null;
+        if (res.outcome === 'unknown') {
+            _expShowPending({ status: 'pending', pending: res.pending });
+            showExpNotif('No answer from the server — this expense may already be saved. Send it again or cancel it; the form is locked until then.', 'error');
+            return;
+        }
+        if (res.outcome === 'refused' && res.kept) {
+            // A later attempt refused for another reason: the first request may have
+            // been recorded, so the save stays until "Cancel it" settles it.
+            _expShowPending({ status: 'pending', pending: res.pending });
+            showExpNotif('The server refused this attempt (' + _purErrorText(res.error) + '). Your earlier save may already be on the ' +
+                         'server — Cancel it to settle it; the form stays locked until then.', 'error');
+            return;
+        }
+        // The server answered — saved, or refused (nothing saved) — so the save is
+        // settled and forgotten: the form unlocks either way.
+        _expRefreshPending();
+        if (res.error) throw res.error;
+        const data = res.data;
 
         // The stock update ("track in inventory") happens on the SERVER, inside
         // the same transaction and once per purchase line — never here, so a
@@ -3098,7 +3334,10 @@ async function handleAddExpense(e) {
         const noPeriod = rows.some(r => !r.period_id);
         // A replayed answer (a retry of a press that had already saved) is the
         // FIRST press's result: edits made to the form since were not applied.
-        const msg = (data && data.replayed)
+        const msg = res.resent
+            ? (data && data.replayed ? 'Your earlier save had reached the server — it is recorded once, exactly as first entered.'
+                                     : 'Your earlier save is recorded now — once, exactly as first entered.')
+            : (data && data.replayed)
             ? 'An earlier attempt of this expense was already saved — check the list; changes made since were not applied.'
             : noPeriod
             ? 'Saved ✓ — this project has no billing period for that month yet, so it was charged to Cover for office review'
@@ -3107,7 +3346,8 @@ async function handleAddExpense(e) {
                 : (data && data.stock_moves)
                     ? 'Expense added & sent to inventory ✓'
                     : (rows.length > 1 ? `Split into ${rows.length} records across funding sources ✓` : 'Expense added! ✓');
-        showExpNotif(msg, 'success');
+        showExpNotif(msg + (data && data.pay ? ' · payment recorded (' + ({ paid: 'Paid', partial: 'Partly paid' }[data.pay.state] || data.pay.state) + ')' : ''),
+                     'success');
         refreshOvAllData();
         if (review.length) _purLoadReviewFlags().then(refreshOvAllData);
 
@@ -3120,6 +3360,8 @@ async function handleAddExpense(e) {
         console.error(err);
     } finally {
         showExpLoading('addExpenseBtn', false);
+        const still = DacsPendingSave.inspect(pendingStore, actor);
+        if (still.status !== 'none') _expShowPending(still);
     }
 }
 
@@ -3183,6 +3425,85 @@ window.expSetMoreDetails = function (open) {
 };
 window.expToggleMoreDetails = function () { window.expSetMoreDetails(); };
 
+// ════════════════════════════════════════════════════════════
+// "PAID NOW?" AND SUPPLIER ON ADD EXPENSE (WorkMate Stage 4, Q7)
+// For accounts that may record payments — owner accounts and Buyer staff
+// (window.currentCanBuy) — the payment goes WITH the purchase and the server
+// saves both or neither (pur_record, 2A-4 Q3). "Paid with" alone never marks
+// anything paid: only "Paid in full" / "Paid part", chosen by the person. A
+// payment never changes Spent. Staff without the Buyer switch see none of
+// this and record as before (Unpaid until a payment is recorded).
+// ════════════════════════════════════════════════════════════
+const _EXP_PAY_HOW = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer', check: 'Check', other: 'Other' };
+// "Paid with" → how the payment was made: a starting value for "How" only.
+function _expPayHowOf(paidWith) {
+    const m = String(paidWith || '').trim().toLowerCase();
+    if (m === 'cash' || m === 'gcash') return m;
+    if (m === 'cheque' || m === 'check') return 'check';
+    if (['bank transfer', 'bdo', 'bpi', 'metrobank'].includes(m)) return 'bank_transfer';
+    return 'other';
+}
+// The payments to send with the purchase: none unless the person chose
+// "Paid in full" or "Paid part".
+function _expPaidNowPayments(choice, total, partAmount, source, how, paidOn) {
+    if (choice !== 'full' && choice !== 'part') return [];
+    const amount = choice === 'full' ? total : Math.round((parseFloat(String(partAmount || '').replace(/,/g, '')) || 0) * 100) / 100;
+    return [{ amount: String(amount), paid_on: paidOn, method: _EXP_PAY_HOW[how] ? how : 'other',
+              source: ['company', 'petty_cash', 'own_money'].includes(source) ? source : 'company', note: '' }];
+}
+// What the form refuses before sending (the server checks again).
+function _expPaidNowProblem(choice, total, partAmount) {
+    if (choice !== 'full' && choice !== 'part') return '';
+    if (!(total > 0)) return 'Enter the total first.';
+    if (choice === 'part') {
+        const a = parseFloat(String(partAmount || '').replace(/,/g, '')) || 0;
+        if (!(a > 0)) return 'Enter the amount paid.';
+        if (a >= total) return 'A part payment is less than the total — choose "Paid in full".';
+    }
+    return '';
+}
+let _expSuppliers = [];
+function _expSupplierLabel(s) { return s.name + (s.branch ? ' · ' + s.branch : ''); }
+// The supplier part of the purchase: one from the list by its id, else the typed name.
+function _expSupplierBody(typed, suppliers) {
+    const text = String(typed || '').trim();
+    const hit = text && (suppliers || []).find(s => _expSupplierLabel(s).toLowerCase() === text.toLowerCase());
+    return hit ? { supplier: '', supplier_id: hit.id } : { supplier: text.slice(0, 200) };
+}
+window.expTogglePaidNow = function () {
+    const choice = document.getElementById('expPaidNow')?.value || 'none';
+    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
+    show('expPaidAmountWrap', choice === 'part');
+    show('expPaidFromRow', choice === 'full' || choice === 'part');
+    const how = document.getElementById('expPaidHow');
+    if (how && !how.dataset.touched) how.value = _expPayHowOf(document.getElementById('expPaymentMethod')?.value);
+};
+// Each time Add Expense opens: shown only to accounts that may record payments, set back to "Not paid yet".
+async function _expSetupPaidNow() {
+    const wrap = document.getElementById('expPaidNowWrap');
+    if (!wrap) return;
+    const can = !!window.currentCanBuy;
+    wrap.style.display = can ? '' : 'none';
+    const choice = document.getElementById('expPaidNow'); if (choice) choice.value = 'none';
+    const part = document.getElementById('expPaidAmount'); if (part) part.value = '';
+    const how = document.getElementById('expPaidHow'); if (how) delete how.dataset.touched;
+    const from = document.getElementById('expPaidFrom');
+    // A staff buyer may pay from their own petty cash or own money (the server fills in who);
+    // an owner account pays as the company.
+    if (from) from.innerHTML = '<option value="company">Company (paid directly)</option>' + (window.currentUserRole === 'staff'
+        ? '<option value="petty_cash">My petty cash</option><option value="own_money">My own money</option>' : '');
+    const sup = document.getElementById('expSupplier'); if (sup) sup.value = '';
+    window.expTogglePaidNow();
+    if (!can) return;
+    try {
+        const { data, error } = await window.sbClient.rpc('pur_suppliers');
+        if (error) throw error;
+        _expSuppliers = (data || []).filter(s => s.active);
+        const list = document.getElementById('expSupplierList');
+        if (list) list.innerHTML = _expSuppliers.map(s => '<option value="' + _mvpEsc(_expSupplierLabel(s)) + '"></option>').join('');
+    } catch (err) { _expSuppliers = []; console.warn('suppliers:', err); }
+}
+
 // ════════════════════════════════════════════════════════════
 // PAYROLL FORM
 // ════════════════════════════════════════════════════════════
@@ -4831,6 +5152,8 @@ function openExpModal(id)  {
         const box = inv && inv.closest('.aer-inv');
         if (box) box.style.display = window.currentStockOn ? 'none' : '';
         if (inv && window.currentStockOn) { inv.checked = false; window.expToggleInventoryFields(); }
+        _expSetupPaidNow();
+        _expCheckPending();
     }
     if (id === 'addPayrollModal' && typeof payToggleMode === 'function') payToggleMode(); // sync Daily/Lamsam UI
     if (id === 'addPayrollModal' && typeof lcPopulatePayrollPicker === 'function') {
@@ -4845,7 +5168,8 @@ function closeExpModal(id) {
     // A submission id belongs to ONE open form (spec 2026-10-08 §4.3): closing
     // the form forgets it, so a later, different entry can never be mistaken
     // for an earlier save whose response was lost.
-    if (id === 'addExpenseModal') _expSubmissionId = null;
+    // Add Expense: a save that may be on the server is NOT forgotten on close
+    // (js/expense-pending-save.js keeps it until the server answers).
     if (id === 'addPayrollModal') _paySubmissionId = null;
     const m = document.getElementById(id);
     if (m) m.classList.remove('active');
@@ -5189,6 +5513,9 @@ function _rptUpdateAxisHint(period) {
 
 function loadRptData() {
     if (!currentUser) return;
+    // The cost-move history for the "changed after the month ended" note: fresh on each visit.
+    _pcCostChanges = null;
+    _pcCostChangesPromise = null;
     _rptState.loading = true;
     _rptShowLoading();
 
@@ -5521,7 +5848,7 @@ function _pcAllocationReportHtml(model) {
         remaining:-model.totals.unallocatedIndirect, allocation:null, status:'Unallocated Indirect' }));
     if (model.totals.noPeriodMaterial) rows.push(_pcReportCells({ label:'No billing period (Cover)',
         mats:model.totals.noPeriodMaterial, totalSpent:model.totals.noPeriodMaterial,
-        remaining:-model.totals.noPeriodMaterial, allocation:null, status:'No billing period — office review' }));
+        remaining:-model.totals.noPeriodMaterial, allocation:null, status:_pcNoPeriodStatus(model.expenses) }));
     rows.push(_pcReportCells({ ...model.totals, allocation:totalAllocation, status:model.allocation.legacyCount ? 'Allocation not configured: ' + model.allocation.legacyCount : '' }));
     return _pcReportTable(_PC_REPORT_HEADERS, rows, 'Billing Allocation Performance')
         + '<p class="pc-report-note">Target Margin Reserve: planning only. Variance = planned minus actual. Cover Expenses are included above.</p>';
@@ -5536,13 +5863,69 @@ function _pcPeriodAllocationHtml(row) {
         ['Target Margin Reserve',a.targetMarginReserve,null,null]], 'Billing Allocation');
 }
 
+// A billing period changed by a stock cost move AFTER its month ended
+// (WorkMate Stage 4, Q11) — approvals AND reversals. They come from the
+// server's lasting log of cost-move rows (0109's rec_cost_row_log, through
+// rec_bills in js/reconciliation-admin.js): a reversal deletes its expense
+// rows, so the rows alone could never say that a month changed again. The
+// figures stay today's; the note says what changed later and when, so an
+// older printout can be matched. Display only: no total reads it.
+let _pcCostChanges = null;          // null until loaded for this Reports visit
+let _pcCostChangesPromise = null;
+function _pcEnsureCostChanges(onReady) {
+    if (!_pcIsOwner() || _pcCostChanges !== null || !window.ReconciliationAdmin || !window.ReconciliationAdmin.costChanges) return false;
+    if (!_pcCostChangesPromise) {
+        _pcCostChangesPromise = window.ReconciliationAdmin.costChanges().then(list => { _pcCostChanges = list || []; }).catch(err => {
+            console.warn('Report cost-move history:', err);
+            _pcCostChanges = [];
+            showExpNotif('Could not load the stock cost-move history for the Reports notes.', 'error');
+        });
+    }
+    _pcCostChangesPromise.then(onReady);
+    return true;
+}
+// changes: rec_bills' items ({cost_move_id, change, at, item, from, to,
+// sides: [{period_id, amount}]}); periods: the report's billing periods.
+function _pcLateCostMoveNotes(changes, periods) {
+    const byId = new Map((periods || []).map(p => [p.id, p]));
+    const out = new Map();
+    (changes || []).forEach(b => (b.sides || []).forEach(s => {
+        const p = byId.get(s.period_id);
+        const m = p ? _MONTHS.indexOf(p.month) : -1;
+        if (m < 0 || !Number(p.year) || !b.at) return;
+        const at = new Date(b.at);
+        if (isNaN(at) || at < new Date(Number(p.year), m + 1, 1)) return;
+        // Local parts — PH is UTC+8.
+        const day = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0');
+        const key = p.id + '|' + b.cost_move_id + '|' + b.change + '|' + day;
+        const n = out.get(key) || { period: p.name || [p.month, p.year].filter(Boolean).join(' '), day, at, change: b.change, amount: 0,
+                                    what: [b.item, (b.from || '') + ' → ' + (b.to || '')].filter(Boolean).join(': ') };
+        n.amount = Math.round((n.amount + (Number(s.amount) || 0)) * 100) / 100;
+        out.set(key, n);
+    }));
+    return [...out.values()].sort((a, b) => a.at - b.at);
+}
+function _pcLateCostMoveHtml(folderId) {
+    if (!_pcIsOwner()) return '';
+    const folders = _pcReportFolderIds(folderId);
+    const notes = _pcLateCostMoveNotes(_pcCostChanges, expProjects.filter(p => folders.has(p.folderId)));
+    if (!notes.length) return '';
+    return '<div class="pc-report-note"><strong>Changed after the month ended</strong> — the figures above are today\'s.'
+        + notes.map(n => '<div>' + _mvpEsc(n.period) + ': changed ' + (n.change === 'reversed' ? 'again ' : '')
+            + _mvpEsc(n.at.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' }))
+            + (n.change === 'reversed' ? ' — a stock cost move was reversed: ' : ' by a stock cost move: ')
+            + _mvpEsc((n.amount < 0 ? '−' : '+') + '₱' + formatNum(Math.abs(n.amount))) + (n.what ? ' (' + _mvpEsc(n.what) + ')' : '')
+            + '</div>').join('') + '</div>';
+}
+
 function renderReportsDashboard() {
     if (_pcEnsureReportOverhead(renderReportsDashboard)) return;
+    if (_pcEnsureCostChanges(renderReportsDashboard)) return;
     const report = _pcDashboardReport();
     _rptRenderKPIs(report.model);
     _rptRenderTable(report.groups, report.model);
     const allocation = document.getElementById('rptAllocationReport');
-    if (allocation) allocation.innerHTML = _pcAllocationReportHtml(report.model);
+    if (allocation) allocation.innerHTML = _pcAllocationReportHtml(report.model) + _pcLateCostMoveHtml(_rptState.folderId);
     const owner = _pcIsOwner();
     ['rptTrendChart', 'rptBudgetVsActualChart', 'expCategoryChart'].forEach(id => {
         const canvas = document.getElementById(id);
@@ -5937,7 +6320,7 @@ function exportRptTable() {
             remaining:-model.totals.unallocatedIndirect,status:'Unallocated Indirect' }));
         if (model.totals.noPeriodMaterial) rows.push(_pcReportCells({ label:'No billing period (Cover)',
             mats:model.totals.noPeriodMaterial,totalSpent:model.totals.noPeriodMaterial,
-            remaining:-model.totals.noPeriodMaterial,status:'No billing period — office review' }));
+            remaining:-model.totals.noPeriodMaterial,status:_pcNoPeriodStatus(model.expenses) }));
         const a = model.allocation;
         rows.push(_pcReportCells({ ...model.totals, allocation:a.configuredCount ? { ...a,
             directRemaining:a.directBudget-a.directActual, indirectRemaining:a.indirectBudget-a.indirectActual } : null }));
@@ -6191,7 +6574,8 @@ function _pcPrintFundingSummary(model) {
     }
     if (model.totals.noPeriodMaterial) {
         const amount = model.totals.noPeriodMaterial;
-        html += _pcReportTable(headers, [['','No billing period (Cover) — office review','','','',0,amount,0,0,amount,-amount]], 'No billing period');
+        const words = _pcNoPeriodStatus(model.expenses) === 'No billing period — office review' ? ' — office review' : '';
+        html += _pcReportTable(headers, [['','No billing period (Cover)' + words,'','','',0,amount,0,0,amount,-amount]], 'No billing period');
     }
     return html + _pcReportTable(['Materials','Labor','Overhead','Grand Total Balance'],
         [[model.totals.mats,model.totals.labor,model.totals.overhead,model.totals.remaining]], 'Grand Total Balance');
@@ -6239,6 +6623,7 @@ function _pcPrintReport(title, model, groups, options = {}) {
                 .concat([['TOTAL',t.totalSpent,t.totalSpent ? '100.0%' : '0.0%']]), 'Category Breakdown');
         }
         body += _pcAllocationReportHtml(model);
+        if (options.kind === 'dashboard') body += _pcLateCostMoveHtml(options.folderId);
         if (options.kind !== 'dashboard' || options.folderId) body += _pcReportDetails(model);
     } else body = _pcReportTable(['Billing Period','Status'], model.rows.map(r => [r.label,r.status]), 'Billing Summary');
     const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>' + _mvpEsc(title + (receiptNo ? ' - ' + receiptNo : ''))
@@ -6305,6 +6690,7 @@ function _rptRenderDetailTables(model) {
 // ════════════════════════════════════════════════════════════
 function printReportsDashboard() {
     if (_pcEnsureReportOverhead(printReportsDashboard)) return;
+    if (_pcEnsureCostChanges(printReportsDashboard)) return;
     const report = _pcDashboardReport();
     _pcPrintReport((expFolders.find(f => f.id === _rptState.folderId)?.name || 'Company-Wide Report')
         + ' · ' + report.label, report.model, report.groups, {kind:'dashboard',folderId:_rptState.folderId,dateLabel:report.label,
```

**Modify:** `js/portal-app.compiled.js`

```diff
diff --git a/js/portal-app.compiled.js b/js/portal-app.compiled.js
index db2cac4..00b352a 100644
--- a/js/portal-app.compiled.js
+++ b/js/portal-app.compiled.js
@@ -1694,6 +1694,9 @@ function BillingPeriodsDrill({ project, childMonths, payrollRaw, expensesRaw, ov
   // A purchase on a project with NO billing period (0096) belongs to no card,
   // but it is spent: it counts in Total Spent and is named below the cards.
   const noPeriodSpent = expensesRaw.filter(e => !e.projectId && e.folderId === project.id).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
+  // "office review" only while one of those lines still waits — "Cover is right" (Stage 4, Q6) clears it. Words only.
+  const noPeriodReview = typeof window.expPurNeedsReview === "function"
+    && expensesRaw.some(e => !e.projectId && e.folderId === project.id && window.expPurNeedsReview(e.purchaseLineId));
   const totalSpent = cards.reduce((sum, c) => sum + c.totalCost, 0) + noPeriodSpent;
   const historyPeriod = owner && cards.find(c => c.id === historyId && !c.cover);
   // Two DIFFERENT styles: .drill-stat is the big header block, .pc-period-stat the
@@ -1720,8 +1723,8 @@ function BillingPeriodsDrill({ project, childMonths, payrollRaw, expensesRaw, ov
       headStat("Total Spent", totalSpent),
       headStat("Remaining", totalAllocated - totalSpent, totalAllocated - totalSpent >= 0 ? "accent" : "")),
     noPeriodSpent > 0 && h("div", { className: "pc-feed-empty", role: "note" }, owner
-      ? ["₱ ", peso(noPeriodSpent), " of Cover material has no billing period yet — it counts in Total Spent; office review needed."]
-      : "Some Cover material has no billing period yet — office review needed."),
+      ? ["₱ ", peso(noPeriodSpent), " of Cover material has no billing period yet — it counts in Total Spent", noPeriodReview ? "; office review needed." : "."]
+      : "Some Cover material has no billing period yet" + (noPeriodReview ? " — office review needed." : ".")),
     !cards.length ? h("div", { className: "pc-feed-empty" }, "No billing periods yet.")
       : h("div", { className: "pc-period-grid" }, cards.map(c => h("div", { key: c.id, className: "pc-period-card" },
         h("div", { className: "pc-period-head" },
```

**Modify:** `js/purchasing-admin-list.js`

```diff
diff --git a/js/purchasing-admin-list.js b/js/purchasing-admin-list.js
index 2aeaeda..02f4217 100644
--- a/js/purchasing-admin-list.js
+++ b/js/purchasing-admin-list.js
@@ -11,6 +11,9 @@
 //                      petty-cash tracker, or a buyer's own cash;
 //   Company stock    — owner accounts, once stock is on (2C, 0105):
 //                      js/stock-cost-admin.js.
+//   Reconciliation   — owner accounts (Stage 4, 0109): where every purchase
+//                      peso is, what is waiting, "Cover is right", money
+//                      still out, bills to check — js/reconciliation-admin.js.
 // "Record purchase" (js/purchasing-admin-record.js) opens from the list
 // with the ticked lines.
 // 0104: a line whose catalogue item is in the warehouse says so ("In
@@ -35,7 +38,13 @@
         const t = (id, label) => '<button type="button" class="att-seg-btn' + (ui.tab === id ? ' is-on' : '') + '" data-tab="' + id + '">' + label + '</button>';
         return '<div class="att-seg" role="tablist" aria-label="Purchasing">' +
             t('list', 'Shopping list') + t('purchases', 'Purchases') + t('approvals', 'Owner approvals') + t('cash', 'Cash') +
-            (companyStockTab() ? t('company', 'Company stock') : '') + '</div>';
+            (companyStockTab() ? t('company', 'Company stock') : '') +
+            (reconcileTab() ? t('reconcile', 'Reconciliation') : '') + '</div>';
+    }
+
+    // Stage 4: the owner's checks — owner accounts (the server refuses anyone else).
+    function reconcileTab() {
+        return !!(root.ReconciliationAdmin && PA.ui.isOwner);
     }
 
     // 2C: the value of company stock — owner accounts, once stock is on.
@@ -279,6 +288,7 @@
         if (ui.tab === 'record') return PA.renderRecord(host.querySelector('[data-body]'), me);
         if (ui.tab === 'cash' && PA.renderCash) return PA.renderCash(host.querySelector('[data-body]'), me);
         if (ui.tab === 'company' && companyStockTab()) return root.StockCostAdmin.renderCompanyStock(host.querySelector('[data-body]'));
+        if (ui.tab === 'reconcile' && reconcileTab()) return root.ReconciliationAdmin.render(host.querySelector('[data-body]'));
         return renderList(host, me);
     }
 
```

**Modify:** `admin.html`

```diff
diff --git a/admin.html b/admin.html
index 224ef1f..c0b3985 100644
--- a/admin.html
+++ b/admin.html
@@ -4395,6 +4395,18 @@
 
             <!-- body -->
             <div class="aer-body">
+                <!-- A save that may already be on the server (js/expense-pending-save.js): shown — and
+                     the form locked — until it is sent again exactly or cancelled; also while this
+                     browser's storage is blocked or damaged (nothing new is sent then). A damaged save
+                     whose ID cannot be read is settled only by the server (pur_op_recover). -->
+                <div id="expPendingBox" role="alert" style="display:none;margin-bottom:16px;padding:12px 14px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;font-size:13px;">
+                    <div id="expPendingText" style="margin-bottom:10px;"></div>
+                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
+                        <button type="button" class="aer-catadd" id="expPendingResend" onclick="expResendPending()">Send it again (exactly as first entered)</button>
+                        <button type="button" class="aer-catadd" id="expPendingCancel" onclick="expCancelPending()">Cancel it</button>
+                        <button type="button" class="aer-catadd" id="expPendingRecover" style="display:none;" onclick="expRecoverPending()">Check with the server</button>
+                    </div>
+                </div>
                 <div id="expBudgetBanner" style="display:none;"></div>
 
                 <!-- Funding source is auto-selected at save time (handleAddExpense);
@@ -4481,7 +4493,7 @@
                         <div>
                             <label class="aer-lbl" for="expPaymentMethod">Paid with</label>
                             <div class="aer-selwrap">
-                                <select id="expPaymentMethod">
+                                <select id="expPaymentMethod" onchange="expTogglePaidNow()">
                                     <option value="">Not sure yet</option>
                                     <option value="Cash">Cash</option>
                                     <option value="GCash">GCash</option>
@@ -4506,6 +4518,50 @@
                             </div>
                         </div>
                     </div>
+                    <!-- "Paid now?" + supplier (WorkMate Stage 4, Q7): owner accounts and Buyer staff
+                         only — expenses-module.js shows it (_expSetupPaidNow). Staff without the
+                         Buyer switch never see it. -->
+                    <div id="expPaidNowWrap" style="display:none;">
+                        <div class="aer-row" style="margin-bottom:14px;">
+                            <div>
+                                <label class="aer-lbl" for="expPaidNow">Paid now?</label>
+                                <div class="aer-selwrap">
+                                    <select id="expPaidNow" onchange="expTogglePaidNow()">
+                                        <option value="none">Not paid yet / record later</option>
+                                        <option value="full">Paid in full</option>
+                                        <option value="part">Paid part (deposit)</option>
+                                    </select>
+                                    <svg class="aer-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
+                                </div>
+                            </div>
+                            <div id="expPaidAmountWrap" style="display:none;"><label class="aer-lbl" for="expPaidAmount">Amount paid (₱)</label><input class="aer-in" type="text" inputmode="decimal" id="expPaidAmount" placeholder="0.00"></div>
+                        </div>
+                        <div class="aer-row" id="expPaidFromRow" style="display:none;margin-bottom:14px;">
+                            <div>
+                                <label class="aer-lbl" for="expPaidFrom">Paid from</label>
+                                <div class="aer-selwrap"><select id="expPaidFrom"></select><svg class="aer-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
+                            </div>
+                            <div>
+                                <label class="aer-lbl" for="expPaidHow">How</label>
+                                <div class="aer-selwrap">
+                                    <select id="expPaidHow" onchange="this.dataset.touched = '1'">
+                                        <option value="cash">Cash</option>
+                                        <option value="gcash">GCash</option>
+                                        <option value="bank_transfer">Bank transfer</option>
+                                        <option value="check">Check</option>
+                                        <option value="other">Other</option>
+                                    </select>
+                                    <svg class="aer-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
+                                </div>
+                            </div>
+                        </div>
+                        <div class="aer-fg">
+                            <label class="aer-lbl" for="expSupplier">Supplier <small>— optional</small></label>
+                            <input class="aer-in" type="text" id="expSupplier" list="expSupplierList" maxlength="200" placeholder="e.g. Wilcon Depot" autocomplete="off">
+                            <datalist id="expSupplierList"></datalist>
+                        </div>
+                        <p style="font-size:12px;color:#8A8A8E;margin:-6px 2px 14px;">"Paid with" alone never marks it paid — choose <b>Paid in full</b> or <b>Paid part</b> to record the payment. A payment never changes Spent.</p>
+                    </div>
                     <div class="aer-fg">
                         <label class="aer-lbl" for="expNotes">Notes <small>— optional</small></label>
                         <textarea id="expNotes" rows="2" placeholder="Anything worth remembering…"></textarea>
@@ -5419,7 +5475,8 @@
 <script src="js/print-utils.js"></script>
 <script src="js/receipt-storage.js?v=20261016a"></script>
 <script src="js/expense-split-rows.js?v=20261028a"></script>
-<script src="js/expenses-module.js?v=20261029a"></script>
+<script src="js/expense-pending-save.js?v=20261031a"></script>
+<script src="js/expenses-module.js?v=20261031a"></script>
 <script src="js/overhead-module.js"></script>
 <script src="js/reimbursement-module.js"></script>
 <script src="js/construction-module.js"></script>
@@ -5434,13 +5491,14 @@
 <script src="js/requests-admin-history.js?v=20261012a"></script>
 <script src="js/requests-admin-gallery.js?v=20261012a"></script>
 <script src="js/purchasing-admin-core.js?v=20261026a"></script>
-<script src="js/purchasing-admin-list.js?v=20261029a"></script>
+<script src="js/purchasing-admin-list.js?v=20261030a"></script>
 <script src="js/purchasing-admin-record.js?v=20261022b"></script>
 <script src="js/purchasing-admin-purchases.js?v=20261026a"></script>
 <script src="js/purchasing-admin-pay.js?v=20261023a"></script>
 <script src="js/purchasing-admin-cash.js?v=20261023b"></script>
 <script src="js/stock-admin.js?v=20261028a"></script>
 <script src="js/stock-cost-admin.js?v=20261026a"></script>
+<script src="js/reconciliation-admin.js?v=20261030b"></script>
 <script src="js/tools-admin.js?v=20261029a"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261014a"></script>
```

**Modify:** `tests/money-math.test.js`

```diff
diff --git a/tests/money-math.test.js b/tests/money-math.test.js
index 328399a..a55303e 100644
--- a/tests/money-math.test.js
+++ b/tests/money-math.test.js
@@ -545,7 +545,11 @@ console.log('\nP. Purchases are ordinary expense rows');
   });
   test('Add expense decides no funding in the browser (pur_record does)', () => {
     const add = expensesSrc.slice(expensesSrc.indexOf('async function handleAddExpense('), expensesSrc.indexOf('\nasync function deleteExpense('));
-    ok(add.includes("rpc('pur_record'"), 'Add expense must record through pur_record');
+    // Stage 4 (R121): the request goes through the client bound to the account
+    // that pressed Save — calls.record, which is pur_record.
+    const at = expensesSrc.indexOf('async function _expBoundCalls(');
+    const bound = at === -1 ? '' : expensesSrc.slice(at, expensesSrc.indexOf('\n}\n', at));
+    ok(/record: calls\.record/.test(add) && bound.includes("record: (args) => c.rpc('pur_record', args)"), 'Add expense must record through pur_record');
     ok(!/sortedSources|\.remain\b|coverExpense/.test(add), 'Add expense still splits or picks Cover itself');
   });
 }
@@ -2565,6 +2569,39 @@ console.log('\nW. An indirect worker\'s burden never draws down a pakyaw contrac
   });
 }
 
+// == Y. RECONCILIATION (0109, STAGE 4) READS AND POINTS =================
+// The owner's Reconciliation tab, "Cover is right", "Bill checked", Project
+// Control's "Paid now?" and the Reports note for months changed later never
+// feed a money figure: no Spent / Earned / Profit function reads them, the
+// tab writes no expense row, and a payment is never taken from "Paid with".
+console.log('\nY. Reconciliation reads and points; a payment only from the person\'s choice');
+{
+  const recSrc = read('js/reconciliation-admin.js');
+  const body = (src, name) => { const i = src.indexOf('function ' + name + '('); ok(i !== -1, name + ' not found'); return src.slice(i, src.indexOf('\n}\n', i) + 3); };
+  test('no money function reads a Stage 4 helper', () => {
+    for (const name of ['buildProject', '_projSpent', '_projEarned', '_projMargin', '_recognisedProfit', '_companyOverhead']) {
+      ok(!/rec_|Reconciliation|_pcLateCostMove|_expPaidNow|_expSupplier/.test(body(portalSrc, name)), name + ' reads a Stage 4 helper');
+    }
+    ok(!/rec_|_pcLateCostMove|_expPaidNow/.test(body(expensesSrc, '_pcReportModel')), 'the report totals read a Stage 4 helper');
+    ok(!/['"]rec_[a-z_]+['"]/.test(portalSrc) && !/['"]rec_[a-z_]+['"]/.test(expensesSrc), 'Project Control never calls a rec_ function');
+  });
+  test('the Reconciliation tab writes no expense row, payment, billing period or bill', () => {
+    const browser = recSrc.slice(recSrc.indexOf('// ── Browser'));
+    ok(!/\.from\(|\.collection\(|sbClient/.test(browser), 'direct table access');
+    const writes = [...new Set([...browser.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1])
+      .filter(f => !/^rec_(purchase_places|waiting|review_lines|bills|money_out)$/.test(f)))].sort();
+    eq(JSON.stringify(writes), JSON.stringify(['rec_accept_cover', 'rec_bill_check', 'rec_withdraw_cover']));
+  });
+  test('"Paid with" never becomes a payment: Not paid yet sends none, whatever "Paid with" says', () => {
+    const f = evalWith(body(expensesSrc, '_expPayHowOf') + body(expensesSrc, '_expPaidNowPayments'),
+      { _EXP_PAY_HOW: { cash: 1, gcash: 1, bank_transfer: 1, check: 1, other: 1 } }, ['_expPayHowOf', '_expPaidNowPayments']);
+    for (const paidWith of ['', 'Cash', 'GCash', 'Maya', 'Lalamove', 'Bank Transfer', 'BDO', 'BPI', 'Metrobank', 'Cheque', 'Credit Card', 'Other']) {
+      eq(f._expPaidNowPayments('none', 1000, '', 'company', f._expPayHowOf(paidWith), '2026-10-24').length, 0, paidWith);
+    }
+    eq(f._expPaidNowPayments('full', 1000, '', 'company', 'gcash', '2026-10-24')[0].amount, '1000', 'Paid in full: the total');
+  });
+}
+
 // ════════════════════════════════════════════════════════════════════
 // §N above is ASYNC — it drives the merge through a recording fake db — so the
 // tally is a function §N calls once its assertions have run. Every other section
```

**Modify:** `package.json`

```diff
diff --git a/package.json b/package.json
index 963e5c7..5945a46 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js && node tests/stock-cost-admin.test.js && node tests/tools-admin.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js && node tests/stock-cost-admin.test.js && node tests/tools-admin.test.js && node tests/reconciliation-admin.test.js && node tests/expense-pending-save.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
```

**Modify:** `docs/ARCHITECTURE.md`

```diff
diff --git a/docs/ARCHITECTURE.md b/docs/ARCHITECTURE.md
index 5f063db..ad44c63 100644
--- a/docs/ARCHITECTURE.md
+++ b/docs/ARCHITECTURE.md
@@ -135,6 +135,7 @@ Also note: **`projects` means billing period**, not project. Read it that way ev
 | Purchasing | `purchasing-admin-core.js`, `purchasing-admin-list.js`, `purchasing-admin-record.js`, `purchasing-admin-purchases.js`, `css/purchasing-admin.css` | WorkMate Stage 2A-2 (`0097`): **Requests → Purchasing**, for accounts the server lets buy (owner, admin accounts allowed Expenses, staff with the **Buyer** switch — set by the owner in Users → Navigator). An account focused on Expenses but not Requests still gets a Requests tab holding Purchasing alone (`_purchasingOnly` in `admin.js`). The **shopping list** (Needed · Bought · Still to buy per weekly-batch portion, who is buying each — "I'll buy this", assign, release, mark arranged), **Record purchase** (one receipt, many lines and projects, linked to their request portions — optionally picked per weekly portion, and then only those are covered — extras with a reason, substitutes with a reason and an office check, Unplanned lines, delivery fees / discounts, receipt photos in the buyer-only `purchases/` folder, kept in the form state so a redraw keeps them and a replacement is uploaded), **Purchases** (one purchase: covers, unit / substitute check, correct, void, history; receipts open through an authenticated download, never a signed link) and **Owner approvals** (staff changes only the owner may make, shown field by field — as asked vs asked for — and not approvable once the purchase changed). Shows prices — the one Requests screen that does. Every write is a `pur_*` RPC through the same recording operation as Expenses / Project Control (0096). Project Control's edit and void send owner-only staff changes for approval, and read the purchase behind a row through `pur_entry_row` (`expenses-module.js`) — purchase tables are buyers-only. Pure helpers: `tests/purchasing-admin.test.js`; migration: `tests/purchasing-server.test.js` + `npm run test:sql` |
 | Stock | `stock-admin.js`, `stock-cost-admin.js`, `css/purchasing-admin.css` (`stk-*`) | WorkMate Stage 2B-a (`0104`): **Requests → Stock**, quantities only, for owner and office staff allowed Expenses (Buyer staff included). Hidden until the main owner switches stock on (`stk_status`; the main owner sees the switch). An account focused on other sections (`allowed_modules` without Requests) that the server lets record stock still gets a Requests tab holding Stock (`_stockOnly` in `admin.js`, menu and view guard — beside Purchasing for a buyer). Tabs: **Stock** (items by place; one item's lots, each delivery with the day it was received — the issuing order, oldest received first — and history), **Receiving** (warehouse purchases awaiting delivery or a catalogue match), **Waiting for owner** (counts and opening stock the main owner confirms), **History** (reverse / withdraw). Forms: Issue / move, Record leftovers, Count, Opening stock, Match, Received, Not delivered — each sends one operation id. The shopping list shows "In warehouse" and, once stock is on, "Issue from stock" (`StockAdmin.openIssue`). Once stock is on, the old "Add to inventory" tick (Add Expense) and the old Inventory screen are hidden — the server refuses both. Pure helpers: `tests/stock-admin.test.js`; migration: `npm run test:sql` (`2b_stock`, `2b_concurrency`). **Cost moves (2C, `0105`)**: each record lists its cost moves as states ("Cost assignment pending", "Cost transferred"…); `stock-cost-admin.js` holds every peso — the main owner's Approve / Reject / Reverse cost and a recorder's Ask again, the cards in Purchasing → **Owner approvals** (and Stock → Waiting for owner), and Purchasing → **Company stock** (owner accounts). Approved cost moves are ordinary expense rows (`stkCostMoveId`): Project Control and Expenses tag them "Stock cost move", never edit or delete them, and hide their amount from staff (`_hideStockCost`). Tests: `tests/stock-cost-admin.test.js`; `npm run test:sql` (`2c_cost`, `2c_concurrency`) |
 | Tools | `tools-admin.js`, `css/purchasing-admin.css` (`tl-*`, reusing `stk-*`) | WorkMate Stage 3a (`0107`): **Requests → Tools**, no money at all, for owner and office staff allowed Expenses. Hidden until the main owner switches tools on (`tl_status`; the main owner sees the switch, and "Switch tools off…" for a failed pilot); an account focused elsewhere that the server lets record gets Tools in its Requests tab (`_toolsOnly` in `admin.js`). Tabs: **Tools** (every tool by number; one tool's history and its actions by state), **Out** (issued, longest first, days held), **To register** (purchase lines of tools), **Waiting for owner** (Lost / Retire — the main owner confirms or rejects). Forms: Register (at the warehouse, or with a named person on a project — required), Issue (optionally filling a tool request line), Hand over, Return with condition, Repaired, Ask to retire, Report lost, Found, Reverse / Withdraw — each sends one operation id; photos go to `uploads/tools/<company>/`. Also: **Mark as Complete** (`markFolderComplete` in `expenses-module.js`) names the tools still out (`tl_project_out`, never blocks), and the shopping list shows tools issued per line (`tl_line_tools`). Tests: `tests/tools-admin.test.js`; `npm run test:sql` (`3a_tools`, `3a_concurrency`, and the 2A–2C suites `--with-0107`) |
+| Reconciliation | `reconciliation-admin.js` | WorkMate Stage 4 (`0109`): **Requests → Purchasing → Reconciliation**, owner accounts allowed Expenses (the cash figures for the main owner only). It reads and points — no money moves: **Waiting** (counts with links to where each is decided), **Where every purchase peso is** (own project, other projects, company stock, company stock loss; the difference must be ₱0; print and CSV), **Waiting for a billing period** ("Cover is right" with a reason, and its withdrawal), **Money still out** (owed by supplier, credits; Overpaid and buyers' cash for the main owner), **Bills to check** (each approval or reversal of a stock cost move, with the months it changed; "Bill checked"). Project Control's Add Expense gains "Paid now?" and a supplier for owner accounts and Buyer staff (`expenses-module.js`, default Not paid yet), and Reports notes a month changed by a cost move approved after it ended |
 | Work Plan | `workplan-admin-core.js`, `workplan-admin-form.js`, `workplan-admin-board.js`, `workplan-admin-task.js`, `workplan-admin-meetings.js` | The office half of **DAC'S WorkMate My Work** (`0093`, `0094`; plan `docs/superpowers/plans/2026-10-13-workmate-stage1c2-work-plan-office.md`). Owner and staff turn **meeting notes** into tasks — **AI drafts** through the `dacs-ai` worker (gated by `ai_authorize`, `0095`) or by hand — and review each in the **task form**: an AI name is filled in only on one exact match, otherwise the field reads *Needs your choice* and Save refuses. **Publish** sends tasks and shared notes to chosen people (default: everyone assigned in that meeting). The **Board** groups tasks under the office lists (check, blocked, not acknowledged 24 h, overdue, live, drafts/proposals, completed). One **task** shows who read which version, problems (cleared by the office with a note), photos (private `task-photos`), history, and approve / send back / reopen / cancel-decline. On a published task the **server raises the version** for any people, team or date change, and for wording unless marked a minor spelling correction (`0094`). Edits keep links and helpers the office did not remove, including links to tasks completed long ago. Unsaved meeting notes, shared notes and recipients survive redraws. **No money** — staff see all of it. Tests: `tests/workplan-admin.test.js`, `tests/workmate-office-server.test.js`, `tests/ai-worker.test.js`; live: `supabase/tests/1c2_acceptance.sql`, `1c2_ai_gate.sql` |
 
 **Project Control is compiled React.** See the build trap in §8.
```

**Modify:** `CLAUDE.md`

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index a5567c8..cdd141e 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -174,6 +174,23 @@ Profit   = Earned − Spent
   return or handover keeps it filled, reversing an issue reopens it only if that issue counted on its own. Records are never
   edited — reversed with a reason while they are the tool's latest. Only `js/tools-admin.js` calls the `tl_*` operations.
   Dormant until the main owner switches tools on.
+- **Reconciliation (0109, WorkMate Stage 4) reads and points — it moves no money.** The owner's **Reconciliation** tab
+  (Requests → Purchasing, owner accounts; petty cash, own money, returns, disputes and Overpaid for the main owner only)
+  shows where every peso of each purchase sits — its own project, other projects, company stock, company stock loss — and
+  the difference, which must be **₱0**: a difference is a bug to report, never a business event. **"Cover is right"** only
+  clears a line's Office review flag, with a reason; its rows stay on Cover and in Spent, and a correction re-checks the
+  line (only a line's newest mark applies). **Bills to check** never changes a bill (Q25). Nothing in `rec_*` or
+  `js/reconciliation-admin.js` writes an expense row, payment, billing period or bill, or feeds `_projSpent` /
+  `_projEarned` / `_projMargin` / `_recognisedProfit` (§Y of `money-math.test.js`). **A payment is recorded only from the
+  person's own choice** — Project Control's "Paid now?" (owner accounts and Buyer staff; default Not paid yet) or a
+  confirmed entry in `supabase/tests/4_confirmed_payments.sql` — never from "Paid with", a receipt photo or anything else
+  on record. **Add Expense records a save once** (`js/expense-pending-save.js`): its id and body are kept in the browser until
+  the server answers, one save at a time per account across tabs, and the id is registered (`pur_op_reserve`) before it is
+  sent — a save whose id the browser cannot read is settled only by `pur_op_recover`, never cleared by hand. Every request
+  of a save carries the sign-in of the account that pressed Save (`_expBoundCalls`) — never the shared `sbClient`, whose
+  session follows whoever signed in last in any tab; a sign-in change stops the save and keeps it for that account.
+  Only `js/reconciliation-admin.js` calls the `rec_*` functions. Spec:
+  `docs/superpowers/specs/2026-10-30-workmate-stage4-reconciliation-questions.md`.
 
 Full reasoning: [docs/OVERHEAD_MODULE.md](docs/OVERHEAD_MODULE.md).
 
```

**Create:** `tests/expense-pending-save.test.js`

```js
// ════════════════════════════════════════════════════════════════════
// A SAVE THAT MAY HAVE REACHED THE SERVER:  run with  node tests/expense-pending-save.test.js
//
// Zero dependencies. Drives the REAL js/expense-pending-save.js against a
// fake server that behaves like pur_op_reserve / pur_record / pur_op_cancel /
// pur_op_state / pur_op_recover (0096, 0106, 0109): an operation id is
// recorded once PER ACCOUNT, a repeated id gets the first answer back, a
// cancelled id is refused for good, recovery cancels every registered id the
// server has no answer for. Tabs share one browser storage and one fake of
// the browser's locks (navigator.locks). Then runs Project Control's own Add
// Expense code on a fake page.
//   1. Accepted → reply lost → the form edited → Send it again: recorded once,
//      exactly as first entered (purchase AND payment); the edit is not sent.
//   2. Accepted → reply lost → closed, page reloaded → reopened: the same id
//      and body are still there; sending again records nothing new.
//   3. Never reached the server → sent again → recorded once.
//   4. Cancel it: not recorded → cancelled for good (a late arrival is
//      refused); recorded → nothing to cancel, nothing twice.
//   5. A refusal saves nothing and is forgotten. Every id is registered
//      before it is sent.
//   6. Two tabs: one save at a time per account — a second tab pressing while
//      the first builds, uploads or sends gets nothing sent; no save is ever
//      overwritten or lost; an answer clears only its own save.
//   7. Browser storage blocked (refuses, silently drops, full): nothing sent
//      or uploaded, nothing kept in page memory; a save kept before storage
//      was blocked is never discarded and blocks a new entry.
//   8. Damaged storage: never "nothing waiting"; the kept id settles it; with
//      no readable id only the server settles it (recovery) — the original
//      arriving after the list was checked is refused. No clearing by hand.
//   9. Another account on the same browser never sees, sends or settles it.
//  10. Bound to the account that started it: a sign-in change (another tab)
//      stops every further request and keeps what is unsettled; the other
//      account never sends or settles it; the first settles it afterwards.
//      A later attempt refused for another reason keeps the save.
//  11. Project Control: the form locks for a save still waiting AND for
//      blocked or damaged storage; another tab saving is said in words; every
//      request of a save carries the sign-in of the account that pressed Save.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const MOD = path.join(__dirname, '..', 'js', 'expense-pending-save.js');
const EXP = read('js/expenses-module.js');
const HTML = read('admin.html');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((label || '') + ' expected ' + y + ', got ' + x);
}
// A fresh copy of the module — what a reloaded page, or another tab, gets (its memory starts empty).
function load() { delete require.cache[require.resolve(MOD)]; return require(MOD); }
const settle = () => new Promise(r => setTimeout(r, 0));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
// localStorage as the browser keeps it across a reload — shared by every tab. mode:
//   'ok' · 'blocked' (every call throws, as with storage switched off) ·
//   'drop' (writes silently ignored) · 'full' (writes over 64 characters throw:
//   the quota — a short test write passes, the save itself does not).
function storage(mode) {
  const m = new Map();
  const s = { mode: mode || 'ok', m };
  const deny = () => { throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); };
  s.getItem = (k) => { if (s.mode === 'blocked') deny(); return m.has(k) ? m.get(k) : null; };
  s.setItem = (k, v) => {
    if (s.mode === 'blocked') deny();
    if (s.mode === 'drop') return;
    if (s.mode === 'full' && String(v).length > 64) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    m.set(k, String(v));
  };
  s.removeItem = (k) => { if (s.mode === 'blocked') deny(); if (s.mode === 'drop') return; m.delete(k); };
  return s;
}
// navigator.locks as the browser shares it between tabs of one site: request(name, {ifAvailable}, cb).
function locks() {
  const held = new Set();
  return { held, request: async (name, opts, cb) => {
    if (held.has(name)) { if (opts && opts.ifAvailable) return cb(null); throw new Error('test: waiting for a lock is never asked'); }
    held.add(name);
    try { return await cb({ name }); } finally { held.delete(name); }
  } };
}
// The server: pur_ops and the registrations per (account, operation id), as 0096/0106/0109 key them; a purchase
// with its payments in one transaction. srv.as(uid) is that account's session; srv.reserve / record / … are UID's.
function server() {
  const ops = new Map(), cancelled = new Set(), reserved = new Set();
  const s = { purchases: [], payments: [], lose: null, refuse: null, loseReserve: false, refuseReserve: null, loseRecover: false,
              calls: 0, unregistered: 0 };
  s.as = (actor) => ({
    reserve: async ({ p_op }) => {
      s.calls++;
      if (s.refuseReserve) { const code = s.refuseReserve; s.refuseReserve = null; return { data: null, error: { code: 'P0001', message: code } }; }
      if (s.loseReserve) { s.loseReserve = false; throw new TypeError('Failed to fetch'); }
      reserved.add(actor + '|' + p_op);
      return { data: null, error: null };
    },
    record: async ({ p_op, p_body }) => {
      s.calls++;
      const k = actor + '|' + p_op;
      if (!reserved.has(k)) s.unregistered++;
      if (s.refuse) { const code = s.refuse; s.refuse = null; return { data: null, error: { code: 'P0001', message: code } }; }
      if (s.lose === 'before') { s.lose = null; throw new TypeError('Failed to fetch'); }          // not arrived (yet)
      if (cancelled.has(k)) return { data: null, error: { code: 'P0001', message: 'OP_CANCELLED' } };
      if (ops.has(k)) return { data: Object.assign({}, ops.get(k), { replayed: true }), error: null };
      const r = { purchase_id: 'P' + (s.purchases.length + 1), pay: (p_body.payments || []).length ? { state: 'paid' } : undefined };
      s.purchases.push(Object.assign({ by: actor }, JSON.parse(JSON.stringify(p_body))));
      (p_body.payments || []).forEach(x => s.payments.push(Object.assign({ op: p_op }, x)));
      ops.set(k, r);
      if (s.lose === 'after') { s.lose = null; return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }; }  // saved, reply lost
      return { data: r, error: null };
    },
    cancelOp: async ({ p_op }) => {
      s.calls++;
      const k = actor + '|' + p_op;
      if (ops.has(k)) return { data: 'recorded', error: null };
      cancelled.add(k);
      return { data: 'cancelled', error: null };
    },
    stateOp: async ({ p_op }) => {
      s.calls++;
      const k = actor + '|' + p_op;
      return { data: ops.has(k) ? 'recorded' : cancelled.has(k) ? 'cancelled' : 'none', error: null };
    },
    // pur_op_recover: every registered id of this account with no answer → cancelled for good.
    recoverOps: async () => {
      s.calls++;
      if (s.loseRecover) { s.loseRecover = false; throw new TypeError('Failed to fetch'); }
      let n = 0;
      for (const k of reserved) if (k.startsWith(actor + '|') && !ops.has(k) && !cancelled.has(k)) { cancelled.add(k); n++; }
      return { data: { cancelled: n, recorded: 0 }, error: null };
    },
  });
  Object.assign(s, s.as(UID));
  return s;
}
let n = 0;
const newId = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
// The form as typed: ₱1,000, "Paid in full". counted() also counts how often
// the body was built (uploads happen there); slow() waits for an upload.
const form = (amount, paid = true) => () => ({ source: 'expenses_form', receipt_total: amount,
  lines: [{ destination: 'project', folder_id: 'F', item_name: 'Cement', amount }],
  ...(paid ? { payments: [{ amount: String(amount), source: 'company', method: 'gcash' }] } : {}) });
const counted = (amount) => { const f = form(amount); const b = async () => { b.calls++; return f(); }; b.calls = 0; return b; };
const slow = (amount, upload) => { const f = form(amount); const b = async () => { b.calls++; await upload.promise; return f(); }; b.calls = 0; return b; };
const UID = 'user-1';
// One tab's calls for UID: the shared storage, the shared locks, the server.
const tab = (store, lk, srv, extra = {}) => Object.assign({ store, uid: UID, locks: lk, account: async () => UID, newId, reserve: srv.reserve,
  record: srv.record, cancelOp: srv.cancelOp, stateOp: srv.stateOp, recoverOps: srv.recoverOps }, extra);
// session.current: who is signed in in this browser right now (any tab can change it).
const base = () => {
  const srv = server(), store = storage(), lk = locks(), session = { current: UID };
  return { srv, store, lk, session, t: (extra) => tab(store, lk, srv, Object.assign({ account: async () => session.current }, extra)) };
};
const status = (s) => [s.status, s.op === undefined ? null : s.op];

// ── Lost replies, Send it again, Cancel it ────────────────────────────

test('accepted → reply lost → the form edited → Send it again: recorded once, exactly as first entered — purchase and payment', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'after';
  const first = await ps.submit(t({ build: form(1000), label: 'Cement · ₱1,000' }));
  eq([first.outcome, first.resent, srv.purchases.length, srv.payments.length], ['unknown', false, 1, 1], 'the server saved it; the reply was lost');
  const kept = ps.read(store, UID);
  eq([kept.op, kept.body.receipt_total, kept.label], [first.pending.op, 1000, 'Cement · ₱1,000'], 'kept: the same id and body');
  const calls = srv.calls;
  // The person changes the amount to ₱1,200 (Project Control locks the form; this proves the module never sends the edit).
  const save = await ps.submit(t({ build: form(1200) }));
  eq([save.outcome, save.error.message, srv.calls], ['blocked', 'SAVE_PENDING', calls], 'Save while one waits sends nothing');
  const again = await ps.submit(t({ resend: true, build: form(1200) }));
  eq([again.outcome, again.resent, again.data.replayed, again.pending.op], ['saved', true, true, first.pending.op], 'the first answer, replayed');
  eq([srv.purchases.length, srv.payments.length, srv.purchases[0].receipt_total, srv.payments[0].amount], [1, 1, 1000, '1000'],
     'one purchase, one payment, the first values');
  eq(ps.read(store, UID), null, 'settled: forgotten');
});

test('accepted → reply lost → closed, page reloaded → reopened: the same id and body; sending again records nothing new', async () => {
  const { srv, store, t } = base();
  srv.lose = 'after';
  const first = await load().submit(t({ build: form(1000) }));
  const ps = load();                                                           // a reloaded page
  eq([ps.read(store, UID).op, ps.read(store, UID).body.receipt_total], [first.pending.op, 1000], 'still kept after the reload');
  const seen = await ps.check(t());
  eq(seen.state, 'recorded', 'on opening, the server says it was recorded');
  eq(ps.read(store, UID), null, 'and it is forgotten — nothing to send again');
  eq([srv.purchases.length, srv.payments.length], [1, 1]);
  const next = await ps.submit(t({ build: form(80, false) }));
  eq([next.outcome, next.resent, srv.purchases.length], ['saved', false, 2]);
  ok(next.pending.op !== first.pending.op, 'a new id for a new entry');
});

test('reply lost and the server not yet sure ("none"): kept through close and reload until sent again — then once', async () => {
  const { srv, store, t } = base();
  srv.lose = 'before';                                                         // the request never arrived
  const first = await load().submit(t({ build: form(1000) }));
  eq([first.outcome, srv.purchases.length], ['unknown', 0]);
  const ps = load();
  eq((await ps.check(t())).state, 'none', 'not recorded (yet)');
  eq(ps.read(store, UID).op, first.pending.op, 'kept: the first request could still arrive');
  const again = await ps.submit(t({ resend: true, build: form(5555) }));
  eq([again.outcome, again.resent, srv.purchases.length, srv.purchases[0].receipt_total], ['saved', true, 1, 1000]);
  eq(ps.read(store, UID), null);
});

test('Cancel it: not recorded → cancelled for good, and the first request arriving late is refused', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'before';
  const first = await ps.submit(t({ build: form(1000) }));
  const c = await ps.cancel(t());
  eq([c.state, ps.read(store, UID)], ['cancelled', null]);
  const late = await srv.record({ p_op: first.pending.op, p_body: first.pending.body });
  eq([late.error && late.error.message, srv.purchases.length], ['OP_CANCELLED', 0], 'the late arrival records nothing');
  const fresh = await ps.submit(t({ build: form(1000) }));
  eq([fresh.outcome, srv.purchases.length, srv.payments.length], ['saved', 1, 1], 'entered again: once');
});

test('Cancel it after it was recorded: the server says so — nothing cancelled, nothing twice', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'after';
  await ps.submit(t({ build: form(1000) }));
  const c = await ps.cancel(t());
  eq([c.state, ps.read(store, UID), srv.purchases.length, srv.payments.length], ['recorded', null, 1, 1]);
});

test('Cancel it with no answer again: kept, nothing changed', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'before';
  await ps.submit(t({ build: form(1000) }));
  const c = await ps.cancel(t({ cancelOp: async () => { throw new TypeError('Failed to fetch'); } }));
  eq([c.state, !!ps.read(store, UID)], ['unknown', true]);
});

test('a refusal saves nothing and is forgotten; the next press is a new entry', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.refuse = 'COMPLETED_PROJECT';
  const r = await ps.submit(t({ build: form(1000) }));
  eq([r.outcome, r.error.message, ps.read(store, UID), srv.purchases.length], ['refused', 'COMPLETED_PROJECT', null, 0]);
  eq(['P0001', 'PGRST202', '23505', '22P02', '42501', '28000', '', undefined].map(c => ps.outcome({ code: c })),
     ['refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'unknown', 'unknown']);
  eq(ps.outcome(null), 'saved');
});

test('an upload that fails before sending keeps nothing and sends nothing', async () => {
  const ps = load(), { srv, store, t } = base();
  let threw = '';
  try { await ps.submit(t({ build: async () => { throw new Error('upload failed'); } })); }
  catch (e) { threw = e.message; }
  eq([threw, ps.read(store, UID), srv.calls], ['upload failed', null, 0]);
});

test('every id is registered before it is sent; no answer to the registration: kept, nothing sent — Send it again registers, then records once', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.loseReserve = true;
  const first = await ps.submit(t({ build: form(1000) }));
  eq([first.outcome, srv.purchases.length, ps.read(store, UID).op], ['unknown', 0, first.pending.op], 'nothing sent; kept');
  const again = await ps.submit(t({ resend: true, build: form(1) }));
  eq([again.outcome, srv.purchases.length, srv.purchases[0].receipt_total], ['saved', 1, 1000]);
  // A NEW save whose registration is refused was never sent: forgotten.
  srv.refuseReserve = 'NOT_ALLOWED';
  const no = await ps.submit(t({ build: form(50) }));
  eq([no.outcome, no.error.message, ps.read(store, UID), srv.purchases.length], ['refused', 'NOT_ALLOWED', null, 1]);
  // A save that WAS sent before stays kept if its registration is refused on Send it again.
  srv.lose = 'before';
  const sent = await ps.submit(t({ build: form(70) }));
  srv.refuseReserve = 'NOT_ALLOWED';
  const re = await ps.submit(t({ resend: true, build: form(1) }));
  eq([re.outcome, ps.read(store, UID).op], ['unknown', sent.pending.op], 'not forgotten: its first request could still arrive');
  eq(srv.unregistered, 0, 'never a pur_record for an id the server had not registered');
});

// ── Two tabs: one save at a time per account ──────────────────────────

test('two tabs: Save in the second while the first is still uploading — the second sends nothing; the first save is kept, never overwritten; reply lost → recorded once', async () => {
  const { srv, store, lk, t } = base();
  const tabA = load(), tabB = load(), upA = deferred(), upB = deferred();
  srv.lose = 'after';
  const buildA = slow(1000, upA), buildB = slow(500, upB);
  const pa = tabA.submit(t({ build: buildA }));
  await settle();                                                              // A is uploading
  const pb = tabB.submit(t({ build: buildB }));                                // B presses Save meanwhile
  await settle();
  upA.resolve(); upB.resolve();
  const [ra, rb] = await Promise.all([pa, pb]);
  eq([ra.outcome, (tabB.read(store, UID) || {}).op], ['unknown', ra.pending.op], 'A\'s save — the one the server may hold — is still kept, not lost');
  eq([rb.outcome, rb.error && rb.error.message, buildB.calls, srv.purchases.length], ['blocked', 'SAVE_IN_PROGRESS', 0, 1],
     'B: nothing built, uploaded or sent');
  const rb2 = await tabB.submit(t({ build: form(500) }));
  eq(rb2.error.message, 'SAVE_PENDING', 'B\'s Save shows it instead of starting a new entry');
  const again = await tabB.submit(t({ resend: true }));
  eq([again.outcome, srv.purchases.length, srv.purchases[0].receipt_total, srv.payments.length], ['saved', 1, 1000, 1]);
  eq(lk.held.size, 0, 'the lock is released');
});

test('two tabs press Save at the same instant, both uploads slow, replies lost: exactly one is built and sent, and it is kept — whichever tab is first', async () => {
  for (const order of ['A first', 'B first']) {
    const { srv, store, t } = base();
    const tabA = load(), tabB = load(), up = deferred();
    const buildA = slow(1000, up), buildB = slow(500, up);
    srv.lose = 'after';
    const calls = order === 'A first' ? [tabA.submit(t({ build: buildA })), tabB.submit(t({ build: buildB }))]
                                      : [tabB.submit(t({ build: buildB })), tabA.submit(t({ build: buildA }))];
    up.resolve();
    const out = await Promise.all(calls);
    // Every save whose answer was lost is still kept — none lost, none overwritten.
    const kept = load().read(store, UID);
    eq(out.filter(r => r.outcome === 'unknown' && !(kept && kept.op === r.pending.op)).length, 0,
       order + ': saves the server may hold that are no longer kept (lost)');
    const sent = out.filter(r => r.outcome !== 'blocked'), busy = out.filter(r => r.outcome === 'blocked');
    eq([sent.length, busy.length, busy[0] && busy[0].error.message, buildA.calls + buildB.calls, srv.purchases.length],
       [1, 1, 'SAVE_IN_PROGRESS', 1, 1], order);
  }
});

test('while one tab is sending, the other tab\'s Cancel it, opening check and Check with the server do nothing; the answer then settles it', async () => {
  const { srv, store, lk, t } = base();
  const gate = deferred();
  const slowRecord = async (a) => { await gate.promise; return srv.record(a); };
  const pa = load().submit(t({ build: form(1000), record: slowRecord }));
  await settle();
  const other = load(), calls = srv.calls;
  eq([(await other.cancel(t())).state, (await other.check(t())).state, (await other.recover(t())).state, srv.calls],
     ['busy', 'busy', 'busy', calls], 'told another tab is saving; nothing asked');
  ok(other.read(store, UID), 'the save being sent is kept meanwhile');
  gate.resolve();
  eq([(await pa).outcome, other.read(store, UID), lk.held.size], ['saved', null, 0]);
});

test('an answer clears only its own save: another save found in storage meanwhile is kept — for Save, the opening check and Cancel it', async () => {
  const other = () => ({ op: newId(), body: form(70)(), at: 1, label: 'another save' });
  // Save: its reply arrives after something wrote another save behind the lock's back (an older page, say).
  { const { srv, store, t } = base(), gate = deferred(), ps = load();
    const pa = ps.submit(t({ build: form(1000), record: async (a) => { await gate.promise; return srv.record(a); } }));
    await settle();
    const y = other(); ps.write(store, UID, y);
    gate.resolve();
    eq([(await pa).outcome, ps.read(store, UID).op], ['saved', y.op], 'Save'); }
  // The opening check and Cancel it: the answer is for X; Y is kept.
  for (const which of ['check', 'cancel']) {
    const { srv, store, t } = base(), gate = deferred(), ps = load();
    srv.lose = 'after';
    await ps.submit(t({ build: form(1000) }));                               // X: recorded, reply lost
    const slowly = (fn) => async (a) => { await gate.promise; return fn(a); };
    const pc = which === 'check' ? ps.check(t({ stateOp: slowly(srv.stateOp) })) : ps.cancel(t({ cancelOp: slowly(srv.cancelOp) }));
    await settle();
    const y = other(); ps.write(store, UID, y);
    gate.resolve();
    eq([(await pc).state, ps.read(store, UID).op], ['recorded', y.op], which);
  }
  // And clearOwn itself: only every readable id equal to its own.
  const ps = load(), store = storage(), x = other(), y = other();
  ps.write(store, UID, x);
  eq([ps.clearOwn(store, UID, y.op), ps.read(store, UID).op], [false, x.op]);
  eq([ps.clearOwn(store, UID, x.op), ps.read(store, UID)], [true, null]);
});

test('a browser without locks sends nothing — two tabs could not be kept apart', async () => {
  const ps = load(), { srv, store, t } = base(), build = counted(1000);
  const r = await ps.submit(t({ locks: undefined, build }));
  eq([r.outcome, r.error.message, build.calls, srv.calls, store.m.size], ['blocked', 'LOCKS_UNAVAILABLE', 0, 0, 0]);
  srv.lose = 'before';
  await ps.submit(t({ build: form(1000) }));
  eq([(await ps.cancel(t({ locks: null }))).state, (await ps.check(t({ locks: {} }))).state, !!ps.read(store, UID)], ['blocked', 'blocked', true]);
});

// ── Browser storage blocked ──────────────────────────────────────────

test('storage blocked — refused, silently dropping writes, or full: nothing sent, nothing uploaded, nothing kept in page memory', async () => {
  for (const mode of ['blocked', 'drop', 'full']) {
    const ps = load(), srv = server(), store = storage(mode), lk = locks(), build = counted(1000);
    const r = await ps.submit(tab(store, lk, srv, { build }));
    eq([r.outcome, r.error.message, srv.calls, srv.purchases.length], ['blocked', 'STORAGE_BLOCKED', 0, 0], mode + ': nothing sent');
    // A full browser passes the short test write, so the body is built — and still never sent.
    eq(build.calls, mode === 'full' ? 1 : 0, mode + ': uploads only if a test write passed');
    store.mode = 'ok';
    eq(load().inspect(store, UID).status, 'none', mode + ': nothing half-kept (a reload sees no save)');
    eq(ps.read(store, UID), null, mode + ': and not in this page\'s memory either');
    store.mode = mode;
    const again = await ps.submit(tab(store, lk, srv, { build }));
    eq([again.outcome, srv.calls], ['blocked', 0], mode + ': pressed again');
  }
});

test('a save kept, then storage blocked: never discarded, no new entry sent; settled once when storage is back', async () => {
  const { srv, store, t } = base();
  srv.lose = 'before';
  const first = await load().submit(t({ build: form(1000) }));
  store.mode = 'blocked';                                                      // e.g. site data switched off, then the page reloaded
  const ps = load(), build = counted(1200), calls = srv.calls;
  eq(ps.inspect(store, UID).status, 'blocked', 'blocked — never "nothing waiting"');
  const save = await ps.submit(t({ build }));
  eq([save.outcome, save.error.message, build.calls, srv.calls], ['blocked', 'STORAGE_BLOCKED', 0, calls], 'a new press sends nothing');
  const resend = await ps.submit(t({ resend: true, build }));
  eq([resend.outcome, srv.calls], ['blocked', calls]);
  eq([(await ps.cancel(t())).state, (await ps.check(t())).state, (await ps.recover(t())).state, srv.calls],
     ['blocked', 'blocked', 'blocked', calls], 'nothing settles or clears it');
  store.mode = 'ok';
  eq(load().read(store, UID).op, first.pending.op, 'the same save, still kept');
  const again = await load().submit(t({ resend: true, build }));
  eq([again.outcome, srv.purchases.length, srv.purchases[0].receipt_total], ['saved', 1, 1000], 'once, as first entered');
});

test('a save kept, then storage drops writes: settling cannot clear it, so it stays — and stays once on the server', async () => {
  const ps = load(), { srv, store, t } = base();
  srv.lose = 'after';
  await ps.submit(t({ build: form(1000) }));
  store.mode = 'drop';
  const again = await ps.submit(t({ resend: true, build: form(1200) }));
  eq([again.outcome, again.data.replayed, ps.inspect(store, UID).status], ['saved', true, 'pending'], 'answered, but not cleared: still kept');
  const save = await ps.submit(t({ build: form(1200) }));
  eq([save.outcome, srv.purchases.length, srv.payments.length], ['blocked', 1, 1], 'Save still sends no new entry');
});

// ── Damaged storage ──────────────────────────────────────────────────

test('damaged storage, its id still readable: never "nothing waiting" — a new press sends nothing; the server settles it by that id', async () => {
  // (a) Saved, reply lost, then the kept body damaged: opening asks the server → recorded → cleared.
  let { srv, store, t } = base();
  srv.lose = 'after';
  const first = await load().submit(t({ build: form(1000) }));
  store.m.set(load().key(UID), '{"op":"' + first.pending.op + '","body":{"receipt_t');   // cut short
  let ps = load(), build = counted(1200);
  eq(status(ps.inspect(store, UID)), ['damaged', first.pending.op], 'damaged, with its id');
  eq(ps.read(store, UID), null, 'not a save that can be sent again');
  const save = await ps.submit(t({ build }));
  eq([save.outcome, save.error.message, build.calls, srv.purchases.length], ['blocked', 'STORAGE_DAMAGED', 0, 1], 'a new press sends nothing');
  eq((await ps.submit(t({ resend: true, build }))).error.message, 'STORAGE_DAMAGED', 'cannot be sent again');
  eq((await ps.recover(t())).state, 'refused', 'settled by its own id, not by recovery');
  eq((await ps.check(t())).state, 'recorded');
  eq([ps.inspect(store, UID).status, srv.purchases.length], ['none', 1], 'settled: once');
  // (b) Never arrived, then the body unreadable and only the id left: Cancel it → cancelled for good.
  ({ srv, store, t } = base());
  srv.lose = 'before';
  const lost = await load().submit(t({ build: form(1000) }));
  store.m.delete(load().key(UID));
  ps = load();
  eq(status(ps.inspect(store, UID)), ['damaged', lost.pending.op], 'only the id left');
  eq((await ps.check(t())).state, 'none', 'the server has not seen it');
  eq(ps.inspect(store, UID).status, 'damaged', 'so it stays');
  eq((await ps.cancel(t())).state, 'cancelled');
  const late = await srv.record({ p_op: lost.pending.op, p_body: lost.pending.body });
  eq([late.error.message, srv.purchases.length, ps.inspect(store, UID).status], ['OP_CANCELLED', 0, 'none'], 'a late arrival is refused');
});

test('damaged, no readable id: no new entry and no clearing by hand; Check with the server cancels every unsettled save — the original arriving AFTER the list was checked is refused', async () => {
  const damages = [
    ['both unreadable', (st, k, ok2) => { st.m.set(k, 'not json'); st.m.set(ok2, 'garbage'); }],
    ['the two ids disagree', (st, k, ok2) => { st.m.set(ok2, '00000000-0000-4000-8000-999999999999'); }],
    ['the body is whole but not a save', (st, k, ok2) => { st.m.set(k, JSON.stringify({ op: st.m.get(ok2) + 'x', body: [] })); st.m.delete(ok2); }],
  ];
  for (const [what, damage] of damages) {
    const { srv, store, t } = base();
    srv.lose = 'before';                                                       // the first request is still on its way
    const first = await load().submit(t({ build: form(1000) }));
    const ps = load();
    damage(store, ps.key(UID), ps.opKey(UID));
    const calls = srv.calls, build = counted(1);
    eq(status(ps.inspect(store, UID)), ['damaged', null], what);
    ok(!('forget' in ps), what + ': there is no "clear it by hand"');
    eq([(await ps.submit(t({ build }))).error.message, build.calls], ['STORAGE_DAMAGED', 0], what + ': no new entry');
    eq([(await ps.cancel(t())).state, (await ps.check(t())).state, srv.calls], ['unrecoverable', 'unrecoverable', calls],
       what + ': nothing it can ask by id');
    eq(srv.purchases.length, 0, what + ': the list is checked — the expense is not there (yet), which proves nothing');
    const r = await ps.recover(t());
    eq([r.state, r.cancelled, r.cleared, ps.inspect(store, UID).status], ['settled', 1, true, 'none'], what + ': settled by the server');
    const late = await srv.record({ p_op: first.pending.op, p_body: first.pending.body });   // the original finally arrives
    eq([late.error.message, srv.purchases.length, srv.payments.length], ['OP_CANCELLED', 0, 0], what + ': refused — never recorded');
    const fresh = await ps.submit(t({ build: form(1000) }));
    eq([fresh.outcome, srv.purchases.length, srv.payments.length], ['saved', 1, 1], what + ': entered again — once');
  }
});

test('damaged, no readable id, but the original HAD arrived: recovery cancels nothing — it is in the list once, never twice', async () => {
  const { srv, store, t } = base();
  srv.lose = 'after';
  await load().submit(t({ build: form(1000) }));
  store.m.set(load().key(UID), 'not json'); store.m.set(load().opKey(UID), 'garbage');
  const r = await load().recover(t());
  eq([r.state, r.cancelled, load().inspect(store, UID).status, srv.purchases.length, srv.payments.length], ['settled', 0, 'none', 1, 1]);
});

test('Check with the server with no answer: nothing changed, still no new entry; a whole save or one with its id is never settled that way', async () => {
  const { srv, store, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  store.m.set(load().key(UID), 'not json'); store.m.set(load().opKey(UID), 'garbage');
  srv.loseRecover = true;
  const ps = load();
  eq([(await ps.recover(t())).state, ps.inspect(store, UID).status], ['unknown', 'damaged']);
  eq((await ps.submit(t({ build: form(1) }))).error.message, 'STORAGE_DAMAGED');
  const w = base();
  w.srv.lose = 'before';
  await load().submit(w.t({ build: form(1000) }));
  eq([(await load().recover(w.t())).state, load().inspect(w.store, UID).status, w.srv.calls], ['refused', 'pending', 2], 'a whole save: Send it again or Cancel it');
});

test('the damaged copy is cleared only if it is still what recovery looked at', async () => {
  const { srv, store, t } = base(), gate = deferred(), ps = load();
  store.m.set(ps.key(UID), 'not json'); store.m.set(ps.opKey(UID), 'garbage');
  const pr = ps.recover(t({ recoverOps: async () => { await gate.promise; return srv.recoverOps(); } }));
  await settle();
  const y = { op: newId(), body: form(70)(), at: 1, label: 'written meanwhile' };
  ps.write(store, UID, y);
  gate.resolve();
  const r = await pr;
  eq([r.state, r.cleared, ps.read(store, UID).op], ['settled', false, y.op]);
});

// ── Other accounts ───────────────────────────────────────────────────

test('another account on this browser never sees, sends or settles it; the first account settles it once later', async () => {
  const { srv, store, lk, t } = base();
  srv.lose = 'before';
  const first = await load().submit(t({ build: form(1000) }));
  const ps = load(), other = srv.as('user-2'), calls = srv.calls;              // user-2 signs in on the same browser
  const u2 = (extra) => Object.assign(tab(store, lk, srv, extra), { uid: 'user-2', account: async () => 'user-2', reserve: other.reserve,
    record: other.record, cancelOp: other.cancelOp, stateOp: other.stateOp, recoverOps: other.recoverOps });
  eq([ps.inspect(store, 'user-2').status, ps.read(store, 'user-2')], ['none', null], 'nothing waiting for user-2');
  eq([(await ps.check(u2())).state, (await ps.cancel(u2())).state, (await ps.recover(u2())).state, srv.calls],
     ['none_pending', 'none', 'refused', calls], 'user-2 cannot settle or recover it');
  const resend = await ps.submit(u2({ resend: true, build: form(1) }));
  eq([resend.error.message, srv.calls], ['NOTHING_PENDING', calls], 'nor send it again');
  const own = await ps.submit(u2({ build: form(300, false) }));
  eq([own.outcome, own.resent, srv.purchases.length, srv.purchases[0].by], ['saved', false, 1, 'user-2'], 'user-2 saves their own entry');
  ok(own.pending.op !== first.pending.op, 'with their own id');
  eq([ps.read(store, UID).op, ps.read(store, UID).body.receipt_total], [first.pending.op, 1000], 'user-1\'s save untouched');
  ok(ps.key(UID) !== ps.key('user-2') && ps.opKey(UID) !== ps.opKey('user-2'), 'kept per account');
  // Why it must never reach user-2: the server keys operations per account — user-2 cancelling or recovering touches nothing of user-1's …
  eq([(await other.cancelOp({ p_op: first.pending.op })).data, (await other.recoverOps()).data.cancelled], ['cancelled', 0]);
  // … and user-1, back again, settles their save once.
  const back = await load().submit(t({ resend: true, build: form(9) }));
  eq([back.outcome, srv.purchases.length, srv.purchases[1].receipt_total, srv.purchases[1].by], ['saved', 2, 1000, UID]);
});

test('signed out (no account): nothing sent, nothing kept', async () => {
  const ps = load(), { srv, store, t } = base(), build = counted(1);
  eq(ps.inspect(store, null).status, 'no_account');
  const r = await ps.submit(t({ uid: null, build }));
  eq([r.outcome, r.error.message, build.calls, srv.calls, store.m.size], ['blocked', 'NO_ACCOUNT', 0, 0, 0]);
  eq([(await ps.cancel(t({ uid: null }))).state, (await ps.check(t({ uid: null }))).state, (await ps.recover(t({ uid: null }))).state],
     ['no_account', 'no_account', 'no_account']);
});

test('Send it again after another tab of this account settled it: nothing new is sent', async () => {
  const { srv, store, t } = base();
  srv.lose = 'after';
  await load().submit(t({ build: form(1000) }));
  await load().check(t());                                                     // the other tab: recorded → cleared
  const build = counted(1000);
  const r = await load().submit(t({ resend: true, build }));
  eq([r.outcome, r.error.message, build.calls, srv.purchases.length], ['blocked', 'NOTHING_PENDING', 0, 1]);
});

// ── Bound to the account that started it (R121) ──────────────────────

test('the signed-in account changes during a slow upload (another tab signs in as B): nothing sent, nothing kept; A, signed in again, saves once — as A', async () => {
  const { srv, store, session, t } = base(), up = deferred(), ps = load();
  const pa = ps.submit(t({ build: slow(1000, up) }));
  await settle();                                                              // A's receipt is uploading
  session.current = 'user-2';                                                  // another tab signs in as B
  up.resolve();
  const ra = await pa;
  eq([ra.outcome, ra.error.message, srv.calls, ps.inspect(store, UID).status, ps.inspect(store, 'user-2').status],
     ['blocked', 'ACCOUNT_CHANGED', 0, 'none', 'none'], 'stopped: no request at all, nothing kept for anyone');
  session.current = UID;                                                       // A signs in again
  const again = await ps.submit(t({ build: form(1000) }));
  eq([again.outcome, srv.purchases.length, srv.purchases[0].by, srv.payments.length], ['saved', 1, UID, 1]);
});

test('the signed-in account changes between registration and recording: nothing recorded; kept for A; B can neither send nor settle it; A, back, records it once', async () => {
  const { srv, store, lk, session, t } = base(), ps = load();
  const reserveThenSwitch = async (a) => { const r = await srv.reserve(a); session.current = 'user-2'; return r; };
  const ra = await ps.submit(t({ build: form(1000), reserve: reserveThenSwitch }));
  eq([ra.outcome, ra.error.message, ra.kept, srv.purchases.length], ['blocked', 'ACCOUNT_CHANGED', true, 0], 'stopped before recording');
  eq(ps.read(store, UID).op, ra.pending.op, 'kept — for A');
  // B, signed in now, with their own sign-in and storage: nothing of A's to send or settle.
  const other = srv.as('user-2');
  const u2 = (extra) => Object.assign(tab(store, lk, srv, extra), { uid: 'user-2', account: async () => 'user-2', reserve: other.reserve,
    record: other.record, cancelOp: other.cancelOp, stateOp: other.stateOp, recoverOps: other.recoverOps });
  const calls = srv.calls;
  eq([(await ps.submit(u2({ resend: true, build: form(1) }))).error.message, (await ps.cancel(u2())).state, (await ps.check(u2())).state,
      (await ps.recover(u2())).state, srv.calls], ['NOTHING_PENDING', 'none', 'none_pending', 'refused', calls], 'B: nothing');
  // A's own steps asked while B is signed in: nothing sent — it would carry B's sign-in.
  eq([(await ps.submit(t({ resend: true }))).error.message, (await ps.cancel(t())).state, (await ps.check(t())).state, srv.calls],
     ['ACCOUNT_CHANGED', 'account_changed', 'account_changed', calls], 'A\'s save untouched while B is signed in');
  eq([ps.read(store, UID).op, srv.purchases.length], [ra.pending.op, 0], 'still kept for A; still nothing recorded');
  session.current = UID;                                                       // A signs in again
  const back = await ps.submit(t({ resend: true }));
  eq([back.outcome, srv.purchases.length, srv.purchases[0].by, srv.purchases[0].receipt_total, srv.payments.length, ps.read(store, UID)],
     ['saved', 1, UID, 1000, 1, null], 'once, as A, exactly as first entered');
});

test('Check with the server while someone else is signed in: nothing asked, nothing changed; A, back, settles it', async () => {
  const { srv, store, session, t } = base(), ps = load();
  srv.lose = 'before';
  await ps.submit(t({ build: form(1000) }));
  store.m.set(ps.key(UID), 'not json'); store.m.set(ps.opKey(UID), 'garbage');
  session.current = 'user-2';
  const calls = srv.calls;
  eq([(await ps.recover(t())).state, srv.calls, ps.inspect(store, UID).status], ['account_changed', calls, 'damaged']);
  session.current = UID;
  eq([(await ps.recover(t())).state, ps.inspect(store, UID).status], ['settled', 'none']);
});

test('no way to tell who is signed in: nothing sent', async () => {
  const { srv, t } = base(), ps = load(), build = counted(1);
  const r = await ps.submit(t({ account: undefined, build }));
  eq([r.outcome, r.error.message, build.calls, srv.calls], ['blocked', 'ACCOUNT_CHANGED', 0, 0]);
  const r2 = await ps.submit(t({ account: async () => { throw new Error('sign-in check failed'); }, build }));
  eq([r2.error.message, build.calls, srv.calls], ['ACCOUNT_CHANGED', 0, 0]);
});

test('a later attempt refused for another reason keeps the save — its first request may have been recorded; Cancel it settles it, never twice', async () => {
  // Recorded, reply lost; sending it again is refused before the server reads the id (an expired sign-in, say).
  const { srv, store, t } = base(), ps = load();
  srv.lose = 'after';
  await ps.submit(t({ build: form(1000) }));
  const expired = async () => ({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } });
  const again = await ps.submit(t({ resend: true, record: expired }));
  eq([again.outcome, again.kept, ps.inspect(store, UID).status], ['refused', true, 'pending'], 'refused — but kept: it may have been recorded');
  eq((await ps.submit(t({ build: form(1000) }))).error.message, 'SAVE_PENDING', 'and no new entry over it');
  const c = await ps.cancel(t());
  eq([c.state, srv.purchases.length, ps.inspect(store, UID).status], ['recorded', 1, 'none'], 'Cancel it: it had been recorded — once');
  // Sent again after it was cancelled for good: refused as cancelled → forgotten.
  const w = base();
  w.srv.lose = 'before';
  const first = await load().submit(w.t({ build: form(500) }));
  await w.srv.cancelOp({ p_op: first.pending.op });                           // cancelled from another tab or device
  const r = await load().submit(w.t({ resend: true }));
  eq([r.outcome, r.error.message, r.kept, load().inspect(w.store, UID).status], ['refused', 'OP_CANCELLED', false, 'none']);
});

// ── Project Control's own code on a fake page ─────────────────────────
function slice(from, to) {
  const a = EXP.indexOf(from), b = EXP.indexOf(to, a);
  if (a === -1 || b === -1) throw new Error('SLICE NOT FOUND: ' + from);
  return EXP.slice(a, b);
}
function page(store, srv, lk, opts = {}) {
  const session = opts.session || { current: UID };
  const els = {};
  const el = (id, inBox, extra) => (els[id] = Object.assign({ id, style: {}, textContent: '', value: '', disabled: false, dataset: {},
    closest: (sel) => (sel === '#expPendingBox' && inBox ? els.expPendingBox : null), reset() { this.wasReset = true; } }, extra || {}));
  ['expPendingBox', 'expPendingText', 'addExpenseForm', 'addExpenseBtn', 'expSplitPreview', 'expNotes', 'expPaymentMethod'].forEach(id => el(id));
  el('expAmount', false, { value: '60' }); el('expName', false, { value: 'ZZ glue' }); el('expCategory', false, { value: 'Materials' });
  el('expQty', false, { value: '1' }); el('expDocPO', false, { files: opts.file ? [{ name: 'receipt.jpg' }] : [] });
  ['expPendingResend', 'expPendingCancel', 'expPendingRecover'].forEach(id => el(id, true));
  const form = ['expAmount', 'expName', 'addExpenseBtn', 'expPendingResend', 'expPendingCancel', 'expPendingRecover'];
  const document = { getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => sel === '[data-pending-lock]' ? Object.values(els).filter(e => e.dataset.pendingLock) : form.map(f => els[f]) };
  const rpcs = [], runs = [], shared = [], notes = [], closed = [];
  const asking = { answer: false, asked: 0 };
  const names = { pur_record: 'record', pur_op_reserve: 'reserve', pur_op_cancel: 'cancelOp', pur_op_state: 'stateOp', pur_op_recover: 'recoverOps' };
  const window = { localStorage: store, sbClient: {
    // Like the real shared client: it runs as whoever is signed in at that moment.
    rpc: (name, args) => { shared.push(name + ':' + session.current); return srv.as(session.current)[names[name]](args); },
    auth: { getSession: async () => ({ data: { session: session.current ? { user: { id: session.current }, access_token: 'tok-' + session.current } : null }, error: null }) },
  } };
  const supabase = { createClient: (url, key, cfg) => {
    const actor = String(cfg.global.headers.Authorization).replace('Bearer tok-', '');
    return { rpc: (name, args) => { rpcs.push(name); runs.push(name + ':' + actor); return srv.as(actor)[names[name]](args); } };
  } };
  const navigator = { locks: lk };
  const upload = opts.upload || (async () => 'https://files.test/receipt.jpg');
  const src = slice('// ── A save that may already be on the server', '\n// ════') + '\n' + slice('async function handleAddExpense(', '\nasync function deleteExpense(');
  const f = new Function('window', 'document', 'navigator', 'DacsPendingSave', 'showExpNotif', 'refreshOvAllData', 'closeExpModal', 'showConfirm',
    'showExpLoading', '_purErrorText', 'console', 'supabase', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'expCurrentProject', 'expCurrentFolder',
    '_buildDateTime', '_purLocalDateKey', '_expPaidNowProblem', 'formatNum', '_uploadReceiptFile', '_expPaidNowPayments', 'DacsReceipts',
    '_expSupplierBody', '_expSuppliers', '_purLoadReviewFlags',
    'let currentUser = null;\n' + src + '\nreturn { as: (u) => { currentUser = u ? { uid: u } : null; }, _expCheckPending, handleAddExpense };');
  const api = f(window, document, navigator, load(), (m, t) => notes.push(t + ': ' + m), () => {}, (id) => closed.push(id),
    async () => { asking.asked++; return asking.answer; }, () => {}, (e) => e.message, { error() {}, log() {} }, supabase, 'https://db.test', 'anon-key',
    { folderId: 'F' }, null, () => '', () => '2026-10-31', () => null, (n) => String(n), (kind, file) => upload(kind, file), () => [], { newId },
    () => ({}), [], async () => {});
  const setUser = api.as;
  const as = (u) => { setUser(u); session.current = u; };                      // signing in (this page's account and the browser's sign-in)
  as(UID);
  const shown = (id) => els[id].style.display !== 'none';
  return Object.assign(api, { as, els, rpcs, runs, shared, notes, closed, asking, window, session,
    locked: () => els.expAmount.disabled && els.addExpenseBtn.disabled && !els.expPendingCancel.disabled,
    box: () => shown('expPendingBox'), choices: () => ['expPendingResend', 'expPendingCancel', 'expPendingRecover'].filter(shown) });
}

test('the form: blocked storage locks it with no choices, and Save sends nothing', async () => {
  const srv = server(), store = storage('blocked'), pg = page(store, srv, locks());
  await pg._expCheckPending();
  eq([pg.box(), pg.locked(), pg.choices(), pg.rpcs], [true, true, [], []], 'locked, nothing to press, nothing asked');
  ok(/not letting Project Control keep a save/.test(pg.els.expPendingText.textContent), 'says why');
  await pg.handleAddExpense(null);
  eq(pg.rpcs, [], 'Save sends nothing');
  await pg.window.expResendPending();
  await pg.window.expCancelPending();
  eq(pg.rpcs, [], 'neither do the choices');
});

test('the form: a damaged save with its id offers only Cancel it; with none, only Check with the server — and the delayed original is refused afterwards', async () => {
  const { srv, store, lk, t } = base();
  srv.lose = 'before';
  const first = await load().submit(t({ build: form(1000) }));
  store.m.set(load().key(UID), '{broken');
  let pg = page(store, srv, lk);
  await pg._expCheckPending();
  eq([pg.box(), pg.locked(), pg.choices(), pg.rpcs], [true, true, ['expPendingCancel'], ['pur_op_state']], 'asked the server; still locked');
  await pg.handleAddExpense(null);
  eq(pg.rpcs, ['pur_op_state'], 'Save sends nothing');
  await pg.window.expCancelPending();
  eq([pg.rpcs, pg.box(), load().inspect(store, UID).status], [['pur_op_state', 'pur_op_cancel'], false, 'none'], 'Cancel it settles it');
  eq((await srv.record({ p_op: first.pending.op, p_body: first.pending.body })).error.message, 'OP_CANCELLED');
  // No readable id.
  srv.lose = 'before';
  const second = await load().submit(t({ build: form(400) }));
  store.m.set(load().key(UID), '{broken'); store.m.set(load().opKey(UID), '??');
  pg = page(store, srv, lk);
  await pg._expCheckPending();
  eq([pg.box(), pg.locked(), pg.choices(), pg.rpcs], [true, true, ['expPendingRecover'], []], 'only Check with the server');
  ok(/does not prove it will not still arrive/.test(pg.els.expPendingText.textContent), 'says why a missing row proves nothing');
  pg.asking.answer = false;
  await pg.window.expRecoverPending();
  eq([pg.asking.asked, pg.rpcs, load().inspect(store, UID).status, pg.locked()], [1, [], 'damaged', true], 'not confirmed: nothing asked, still locked');
  pg.asking.answer = true;
  await pg.window.expRecoverPending();
  eq([pg.rpcs, load().inspect(store, UID).status, pg.box(), pg.locked()], [['pur_op_recover'], 'none', false, false], 'settled by the server, then unlocked');
  ok(pg.notes.some(m => /1 save\(s\) that had not reached it are cancelled for good/.test(m)), 'said so');
  eq([(await srv.record({ p_op: second.pending.op, p_body: second.pending.body })).error.message, srv.purchases.length], ['OP_CANCELLED', 0],
     'the original arriving after the list check: refused');
});

test('the form: Send it again records once, unlocks and closes; a later attempt the server refuses keeps it locked with the reason until Cancel it settles it', async () => {
  let { srv, store, lk, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  let pg = page(store, srv, lk);
  await pg._expCheckPending();
  eq([pg.locked(), pg.choices()], [true, ['expPendingResend', 'expPendingCancel']]);
  await pg.window.expResendPending();
  eq([srv.purchases.length, srv.purchases[0].receipt_total, pg.box(), pg.locked(), pg.closed, !!pg.els.addExpenseForm.wasReset,
      load().inspect(store, UID).status], [1, 1000, false, false, ['addExpenseModal'], true, 'none'], 'recorded once; unlocked, cleared, closed');
  ok(pg.notes.some(m => /recorded now — once, exactly as first entered/.test(m)), 'said so');
  ok(pg.rpcs.indexOf('pur_op_reserve') < pg.rpcs.indexOf('pur_record'), 'registered before sending');
  // Refused on a LATER attempt: the first request may have been recorded — kept and locked, the reason shown; Cancel it settles it.
  ({ srv, store, lk, t } = base());
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  pg = page(store, srv, lk);
  await pg._expCheckPending();
  srv.refuse = 'COMPLETED_PROJECT';
  await pg.window.expResendPending();
  eq([srv.purchases.length, !!load().read(store, UID), pg.box(), pg.locked()], [0, true, true, true], 'kept and locked');
  ok(pg.notes.some(m => /The server refused this attempt \(COMPLETED_PROJECT\)/.test(m)), 'the reason shown');
  await pg.window.expCancelPending();
  eq([load().inspect(store, UID).status, pg.box(), pg.locked()], ['none', false, false], 'Cancel it: never recorded — settled, unlocked');
  // Refused because it was cancelled for good (from another tab or device): settled — forgotten and unlocked, the reason shown.
  ({ srv, store, lk, t } = base());
  srv.lose = 'before';
  const first = await load().submit(t({ build: form(1000) }));
  pg = page(store, srv, lk);
  await pg._expCheckPending();
  await srv.cancelOp({ p_op: first.pending.op });
  await pg.window.expResendPending();
  eq([load().inspect(store, UID).status, pg.box(), pg.locked(), srv.purchases.length], ['none', false, false, 0], 'forgotten and unlocked');
  ok(pg.notes.some(m => /^error: Error saving expense: OP_CANCELLED/.test(m)), 'the reason shown');
});

test('the form: a new save the server refuses is forgotten — unlocked, the reason shown, what was typed kept', async () => {
  const { srv, store, lk, session } = base();
  srv.refuse = 'COMPLETED_PROJECT';
  const pg = page(store, srv, lk, { session });
  await pg.handleAddExpense(null);
  eq([srv.purchases.length, load().inspect(store, UID).status, pg.box(), pg.locked(), !!pg.els.addExpenseForm.wasReset, pg.closed],
     [0, 'none', false, false, false, []]);
  ok(pg.notes.some(m => /^error: Error saving expense: COMPLETED_PROJECT/.test(m)), 'the reason shown');
});

test('the form: every request of a save carries the sign-in of the account that pressed Save — even when another tab signs in as B mid-request; the shared client is never used', async () => {
  const { srv, store, lk, session, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  const sw = { as: (actor) => Object.assign({}, srv.as(actor), {
    record: async (a) => { session.current = 'user-2'; return srv.as(actor).record(a); } }) };   // B signs in while the request is on its way
  const pg = page(store, sw, lk, { session });
  await pg._expCheckPending();
  await pg.window.expResendPending();
  eq([srv.purchases.length, srv.purchases[0].by, pg.shared, pg.runs], [1, UID, [], ['pur_op_state:user-1', 'pur_op_reserve:user-1', 'pur_record:user-1']],
     'recorded as A, through A\'s own sign-in');
});

test('the form: a page still showing A while B is signed in sends nothing — not even if the sign-in flips back to A a moment later', async () => {
  const { srv, store, lk, t, session } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  const pg = page(store, srv, lk, { session });
  await pg._expCheckPending();
  pg.runs.length = 0;
  session.current = 'user-2';                                                  // another tab signed in as B; this page still shows A
  let reads = 0;
  const getSession = pg.window.sbClient.auth.getSession;
  pg.window.sbClient.auth.getSession = async () => { const r = await getSession(); if (++reads === 1) session.current = UID; return r; };
  await pg.window.expResendPending();
  eq([pg.runs, pg.shared, srv.purchases.length, !!load().read(store, UID)], [[], [], 0, true], 'nothing sent with B\'s sign-in; kept for A');
  ok(pg.notes.some(m => /The signed-in account changed/.test(m)), 'said in words');
  await pg.window.expResendPending();                                          // A is signed in again: now it goes — once, as A
  eq([srv.purchases.length, srv.purchases[0].by, pg.shared], [1, UID, []]);
});

test('the form: another tab signs in as B while a receipt uploads — nothing is sent as anyone and the typed form stays; A, back, saves it once, as A', async () => {
  const { srv, store, lk, session } = base(), up = deferred();
  const pg = page(store, srv, lk, { session, file: true, upload: async () => { await up.promise; return 'https://files.test/r.jpg'; } });
  const press = pg.handleAddExpense(null);
  await settle();                                                              // the receipt is uploading
  session.current = 'user-2';
  up.resolve();
  await press;
  eq([pg.runs, pg.shared, srv.purchases.length, load().inspect(store, UID).status, !!pg.els.addExpenseForm.wasReset],
     [[], [], 0, 'none', false], 'no request at all; nothing kept; the form not cleared');
  ok(pg.notes.some(m => /The signed-in account changed/.test(m)), 'said in words');
  session.current = UID;                                                       // A signs in again and presses Save
  await pg.handleAddExpense(null);
  eq([srv.purchases.length, srv.purchases[0].by, srv.purchases[0].receipt_total, srv.purchases[0].docs.po_image_url, pg.shared],
     [1, UID, 60, 'https://files.test/r.jpg', []]);
});

test('the form: another tab signs in as B between registration and recording — never recorded as B; B\'s page cannot send or settle it; A, back, sends it again — once, as A', async () => {
  const { srv, store, lk, session } = base();
  let switched = false;
  const sw = { as: (actor) => Object.assign({}, srv.as(actor), {
    reserve: async (a) => { const r = await srv.as(actor).reserve(a); if (!switched) { switched = true; session.current = 'user-2'; } return r; } }) };
  const pg = page(store, sw, lk, { session });
  await pg.handleAddExpense(null);
  eq([srv.purchases.length, pg.runs, !!load().read(store, UID)], [0, ['pur_op_reserve:user-1'], true], 'registered as A, then stopped: kept for A');
  ok(pg.notes.some(m => /The signed-in account changed/.test(m)), 'said in words');
  pg.as('user-2');                                                             // the page is B's now
  await pg._expCheckPending();
  await pg.window.expResendPending();
  await pg.window.expCancelPending();
  eq([pg.runs, pg.shared, srv.purchases.length, !!load().read(store, UID), pg.box()], [['pur_op_reserve:user-1'], [], 0, true, false],
     'B sends and settles nothing of A\'s');
  pg.as(UID);                                                                  // A signs in again
  await pg._expCheckPending();
  eq([pg.box(), pg.choices()], [true, ['expPendingResend', 'expPendingCancel']], 'A sees it waiting');
  await pg.window.expResendPending();
  eq([srv.purchases.length, srv.purchases[0].by, load().read(store, UID), pg.shared], [1, UID, null, []], 'once, as A');
});

test('the form: another tab saving — Send it again, Cancel it and Check with the server send nothing and say so; the form stays locked', async () => {
  const { srv, store, lk, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  const pg = page(store, srv, lk);
  await pg._expCheckPending();
  pg.rpcs.length = 0;
  lk.held.add('dacs.addExpense.' + UID);                                       // the other tab holds this account's lock
  await pg.window.expResendPending();
  await pg.window.expCancelPending();
  eq([pg.rpcs, pg.locked(), !!load().read(store, UID)], [[], true, true], 'nothing sent; still kept and locked');
  ok(pg.notes.filter(m => /Another tab or window is saving an expense/.test(m)).length === 2, 'said in words, both times');
});

test('the form: another account opening Add Expense sees nothing and is not locked; the save waits for its own account', async () => {
  const { srv, store, lk, t } = base();
  srv.lose = 'before';
  await load().submit(t({ build: form(1000) }));
  const pg = page(store, srv, lk);
  await pg._expCheckPending();
  eq([pg.box(), pg.locked(), pg.choices()], [true, true, ['expPendingResend', 'expPendingCancel']], 'user-1: locked, both choices');
  pg.as('user-2');
  await pg._expCheckPending();
  eq([pg.box(), pg.els.expAmount.disabled], [false, false], 'user-2: nothing shown, nothing locked');
  await pg.window.expResendPending();
  eq([pg.rpcs.filter(r => r === 'pur_record').length, srv.purchases.length, !!load().read(store, UID)], [0, 0, true],
     'user-2 pressing the old Send it again sends nothing; user-1\'s save is still kept');
});

test('Save only shows an unsettled save; the save is registered, then sent through pur_record with the kept id and body, under the account\'s lock', () => {
  const add = EXP.slice(EXP.indexOf('async function handleAddExpense('), EXP.indexOf('\nasync function deleteExpense('));
  ok(/const state = DacsPendingSave\.inspect\(pendingStore, actor\);/.test(add)
     && /if \(state\.status !== 'none' && !\(pending && opts\.resend\)\) \{ _expShowPending\(state\); return; \}/.test(add), 'checked first — blocked and damaged too');
  ok(/const calls = await _expBoundCalls\(actor\);\n\s+if \(!calls\) \{ showExpNotif\('Not sent — ' \+ _expNotSentText\('ACCOUNT_CHANGED'\), 'error'\); return; \}/.test(add)
     && /const res = await DacsPendingSave\.submit\(\{ store: pendingStore, uid: actor, locks: _expLocks\(\), account: _expAccountNow,\s+resend: !!opts\.resend, newId: \(\) => DacsReceipts\.newId\(\), build, label,\s+reserve: calls\.reserve, record: calls\.record \}\);/.test(add), 'through the module, bound to the account that pressed Save');
  ok(/if \(res\.outcome === 'blocked'\) \{/.test(add) && /_expNotSentText\(res\.error\.message\)/.test(add), 'nothing sent: said why');
  ok(/if \(res\.outcome === 'unknown'\) \{\n\s+_expShowPending\(\{ status: 'pending', pending: res\.pending \}\);/.test(add), 'no answer: locked');
  ok(!/_expSubmissionId/.test(EXP), 'the old per-form id is gone');
  ok(/window\.expResendPending = function \(\) \{ return handleAddExpense\(null, \{ resend: true \}\); \};/.test(EXP), 'Send it again');
  ok(/cancelOp: calls\.cancelOp/.test(EXP) && /stateOp: calls\.stateOp/.test(EXP) && /recoverOps: calls\.recoverOps/.test(EXP)
     && (EXP.match(/account: _expAccountNow/g) || []).length === 4, 'Cancel it, the check on opening, Check with the server: bound, account checked');
  ok(/global: \{ headers: \{ Authorization: 'Bearer ' \+ token \} \}/.test(EXP) && /if \(actor && s && s\.user && s\.user\.id === actor\) token = s\.access_token;/.test(EXP),
     'a client bound to the token of the account that pressed Save');
  ok(!/window\.sbClient\.rpc\('pur_(record|op_reserve|op_cancel|op_state|op_recover)'/.test(EXP), 'never the shared client for a save');
  ok(/function _expLocks\(\) \{ try \{ return navigator\.locks \|\| null; \} catch \(e\) \{ return null; \} \}/.test(EXP), 'the browser\'s locks');
  ok(/function _expActor\(\) \{ return \(typeof currentUser !== 'undefined' && currentUser && currentUser\.uid\) \|\| null; \}/.test(EXP), 'per account that pressed Save');
  const mod = read('js/expense-pending-save.js').replace(/\/\/.*$/gm, '');
  ok(!/localStorage|sessionStorage/.test(mod), 'the module is handed its storage, never a fallback');
  ok(!/\bforget\b/.test(mod) && !/DacsPendingSave\.forget|expForgetPending|I checked the list/.test(EXP + HTML), 'no clearing by hand anywhere');
});

test('the form locks while a save is unsettled; closing keeps it; opening checks it', () => {
  const show = EXP.slice(EXP.indexOf('function _expShowPending('), EXP.indexOf('\nfunction _expHidePending('));
  ok(/#addExpenseForm \.aer-body input, #addExpenseForm \.aer-body select, #addExpenseForm \.aer-body textarea, ' \+\s+'#addExpenseForm \.aer-body button, #addExpenseBtn'/.test(show), 'every field and Save');
  ok(/if \(el\.closest\('#expPendingBox'\) \|\| el\.disabled\) return;/.test(show), 'but the box\'s choices');
  const close = EXP.slice(EXP.indexOf('function closeExpModal('), EXP.indexOf('\n}\n', EXP.indexOf('function closeExpModal(')));
  ok(!/DacsPendingSave|addExpenseModal'\) _exp/.test(close), 'closing never forgets it');
  ok(/_expSetupPaidNow\(\);\n        _expCheckPending\(\);/.test(EXP), 'checked when Add Expense opens');
  ok(/const still = DacsPendingSave\.inspect\(pendingStore, actor\);\n        if \(still\.status !== 'none'\) _expShowPending\(still\);/.test(EXP), 'still locked after the press ends');
  ok(/<div id="expPendingBox" role="alert" style="display:none;/.test(HTML)
     && /id="expPendingResend" onclick="expResendPending\(\)">Send it again \(exactly as first entered\)</.test(HTML)
     && /id="expPendingCancel" onclick="expCancelPending\(\)">Cancel it</.test(HTML)
     && /id="expPendingRecover" style="display:none;" onclick="expRecoverPending\(\)">Check with the server</.test(HTML), 'the box and its choices');
  const a = HTML.indexOf('<script src="js/expense-pending-save.js?v='), b = HTML.indexOf('<script src="js/expenses-module.js?v=');
  ok(a !== -1 && a < b, 'loaded before Project Control');
  ok(/OP_CANCELLED:/.test(EXP), 'a cancelled save reads in words');
});

// A test that never settles (a save waiting forever) fails after 5 s — and if the run stops early, it fails too.
let finished = false;
process.on('exit', () => { if (!finished) { console.log('\nNOT FINISHED — a test never settled'); process.exitCode = 1; } });
(async () => {
  console.log('\nA save that may already be on the server (js/expense-pending-save.js)');
  for (const [name, fn] of queue) {
    let timer;
    try {
      await Promise.race([fn(), new Promise((_, no) => { timer = setTimeout(() => no(new Error('never settled (5 s)')), 5000); })]);
      passed++; console.log('  ok  ' + name);
    }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
    finally { clearTimeout(timer); }
  }
  finished = true;
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
```

**Modify:** `tests/purchase-server.test.js`

```diff
diff --git a/tests/purchase-server.test.js b/tests/purchase-server.test.js
index 1619a50..21b9f07 100644
--- a/tests/purchase-server.test.js
+++ b/tests/purchase-server.test.js
@@ -193,7 +193,9 @@ console.log('\nDacs Web around it');
 
 test('Add expense records through pur_record and decides no funding, Cover or stock itself', () => {
   const add = between(EXP, 'async function handleAddExpense(', '\nasync function deleteExpense(');
-  assert(add.includes("rpc('pur_record'"), 'Add expense must call pur_record');
+  // Stage 4 (R121): through the client bound to the account that pressed Save — calls.record is pur_record.
+  assert(add.includes('record: calls.record') && between(EXP, 'async function _expBoundCalls(', '\n}\n').includes("rpc('pur_record'"),
+         'Add expense must call pur_record');
   assert(!/sortedSources|\.remain\b|coverExpense/.test(add), 'Add expense still decides funding or Cover itself');
   assert(!add.includes('_addExpenseToInventory('), 'the stock update must be the server\'s (once per line), never the browser\'s');
   assert(/data && data\.replayed/.test(add), 'handleAddExpense must read replayed and warn that later form edits were not applied');
```

**Modify:** `tests/receipt-save-paths.test.js`

```diff
diff --git a/tests/receipt-save-paths.test.js b/tests/receipt-save-paths.test.js
index dc4dd45..b382ac8 100644
--- a/tests/receipt-save-paths.test.js
+++ b/tests/receipt-save-paths.test.js
@@ -5,8 +5,9 @@
 //   • the four receipt save paths upload files — never base64 in the row;
 //   • add-payroll saves all split rows in ONE insert (addMany) with a
 //     submission id, so a retry can't duplicate; add-expense records ONE
-//     purchase through pur_record (0096) with a per-Save operation id, and
-//     the server (not the browser) adds any stock, once per line;
+//     purchase through pur_record (0096) with ONE operation id and body kept
+//     until the server answers (js/expense-pending-save.js, Stage 4 review),
+//     and the server (not the browser) adds any stock, once per line;
 //   • a failure keeps the form (no reset in the catch);
 //   • the two print popups sign photo links before writing the window.
 // If a check fails with "SLICE NOT FOUND", update the markers — don't delete it.
@@ -62,17 +63,20 @@ for (const [name, kind] of [['async function handleEditExpense(', 'expense'], ['
     ok(!/catch \(_\) \{\}/.test(f), 'a photo failure is still swallowed silently');
   });
 }
-test('closing an add form forgets its submission id (a later entry can never be taken for an earlier lost save)', () => {
+test('closing add-payroll forgets its submission id; closing add-expense KEEPS a save the server may have (Stage 4 review)', () => {
   const f = fn('function closeExpModal(');
-  ok(f.includes("if (id === 'addExpenseModal') _expSubmissionId = null;"), 'expense id not cleared on close');
   ok(f.includes("if (id === 'addPayrollModal') _paySubmissionId = null;"), 'payroll id not cleared on close');
+  ok(!/_expSubmissionId|DacsPendingSave/.test(f), 'closing Add Expense must not forget a save that may be on the server');
 });
 test('async function handleAddExpense( uploads files, then records ONE purchase through pur_record (0096)', () => {
   const f = fn('async function handleAddExpense(');
   ok(f.includes("_uploadReceiptFile('expense'"), 'no file upload');
-  ok(f.includes("rpc('pur_record', { p_op: _expSubmissionId, p_body: body })"), 'not recorded through pur_record with the Save id');
+  // Through the client bound to the account that pressed Save (Stage 4, R121): calls.record is pur_record.
+  ok(f.includes('record: calls.record') && f.includes('DacsPendingSave.submit(')
+     && fn('async function _expBoundCalls(').includes("record: (args) => c.rpc('pur_record', args)"),
+     'not recorded through pur_record with the kept id and body');
   ok(!f.includes("_saveRowsOnce('expenses'") && !f.includes('.addMany(') && !f.includes("collection('expenses')"), 'still writes expense rows itself');
-  ok(f.includes('_expSubmissionId = null'), 'operation id not cleared after success');
+  ok(!f.includes('_expSubmissionId'), 'the kept id is DacsPendingSave\'s, forgotten only once the server answered');
   const c = f.slice(f.lastIndexOf('} catch'));
   ok(!/\.reset\(\)/.test(c), 'the catch branch must keep the form and its attachments');
 });
```


- [x] **Step 1: Apply the files above** in Dacs Web (`js/portal-app.compiled.js` is edited directly; **never run `npm run build`**). **Done 3 Nov, by merge.** The blocks above were written against `f007a13`; the repo had moved on to `e875fc5` (PM sharing personal items). Rebuilt from these blocks on a fresh clone at `f007a13` (all 14 files byte-identical to the tested build), then: 10 files copied byte for byte (4 new, 6 unchanged since Task 1); `CLAUDE.md`, `docs/ARCHITECTURE.md` and `admin.html` merged three ways with no overlap (`admin.html` keeps the user's own edit); `package.json`: the two new suites inserted into the current `test` list. `CLAUDE.md`'s payment sentence was then updated for Task 5's closure.
- [x] **Step 2: Tests, on the final merged files (3 Nov).** `npm test` → exit 0, 46 suites in the script, **1,459 checks, 0 failed**, including the new `reconciliation-admin.test.js` (**21**), `expense-pending-save.test.js` (**42**) and `money-math.test.js` (**257**, §Y new). `npm run test:sql` → **50 suites, 1,473 checks, 0 failed**. `node --check` on `js/reconciliation-admin.js`, `js/expense-pending-save.js`, `js/expenses-module.js`, `js/purchasing-admin-list.js`, `js/portal-app.compiled.js`.
- [x] **Step 3: Browser check before committing, by the user** **Done 3 Nov, looking only; see *Execution notes*.** (owner account, on a local copy: `admin.html` from the working tree, signed in to the live project). **0109 is live, so the tab shows real figures and anything pressed writes to the live database: look only.** Expected as of 3 Nov (new entries will change the numbers). Requests → Purchasing → **Reconciliation**, five sections: *Waiting*: 2 lines waiting for a billing period, nothing else; *Where every purchase peso is*: it opens on this month, so set 1 Oct → today: 34 purchases, ₱229,108, all in their own projects, difference ₱0, **Adds up ✓**, 8 voided listed apart; *Waiting for a billing period*: the two Eagle Residence lines (₱344, ₱500), **do not press "Cover is right"**; *Money still out*: nothing owed, no credits, no Overpaid; *Bills to check*: none. Project Control → Add Expense → More details shows **Paid now? — Not paid yet / record later**, a supplier box and the line that "Paid with" alone never marks it paid; no waiting-save box. **Close the form without saving** (saving is tested on the live site in the ZZ pilot; a page opened as a local file may be refused tab locking, and then nothing is sent). Reports, the PM-sharing panel and the Profit Sharing dashboard open as before (the merge touched `admin.html`). `client_errors`: nothing new.
- [x] **Step 4: Stop for the user** to review and commit. **Reviewed 3 Nov; the user asked for the commit.**

### Task 3: Live — 0109 applied, checked, the web pushed

- [x] **Step 1: Before applying, check live** **Done before the user applied 0109.** (MCP `execute_sql`, read-only): no `rec_*` table or function exists, nor `pur_op_reservations`, `pur_op_reserve` or `pur_op_recover`; stock is on; note `select count(*), sum(amount) from expenses`, the counts of `purchases`, `purchase_lines`, `pur_payments`, `stk_cost_moves`, and the lines with `needs_funding_review` (expected: the two Eagle Residence lines, `8c78b328` and `7a03382a`).
- [x] **Step 2: The user applies the committed 0109** **Done 1 Nov, about 01:40, while Task 1 was still uncommitted and before Task 2: no screen used it until then, so nothing changed for anyone.** (Tasks 1–2 committed first): the whole file, unchanged, once, in the Supabase SQL editor.
- [x] **Step 3: Verify the live database ourselves** **Done 1 Nov 01:43: 20 of 20 function bodies match; grants, RLS and the 6 triggers as below; the log, marks, ticks and registrations empty.** (read-only): every function body of 0109 matches the file (`md5(replace(prosrc, chr(13), ''))`); the grants (the ten callable — the eight `rec_*` and `pur_op_reserve` / `pur_op_recover` — to `authenticated`, none to `anon`; the helpers to neither); the four tables (`pur_op_reservations` among them, empty) with RLS on and no policy; the triggers `rec_log_cost_rows_ins` / `_del` / `_upd` on `expenses` and the three history guards, enabled; `rec_cost_row_log` holds one back-filled row per existing cost-move row (0 expected); Step 1's counts, expense sum and the two flags unchanged.
- [x] **Step 4: Live acceptance.** **PASS 1 Nov; nothing left behind.** Run `supabase/tests/4_acceptance.sql` through MCP `execute_sql`. Expect `stage 4 acceptance: all checks passed` — its A1 also proves **every real purchase on record adds up**. It rolls itself back; afterwards no `ZZ 4 …` row, and `rec_cover_marks`, `rec_bill_checks`, `rec_cost_row_log` and `pur_op_reservations` as in Step 3.
- [x] **Step 5: The live check.** **C1–C6 ok, 1 Nov (34 purchases, ₱229,108; the two Eagle lines; 0 marks).** Run `supabase/tests/4_live_check.sql` (MCP, read-only). Expect C1–C5 `ok = true`; C6 lists the lines waiting (the two Eagle Residence lines) and 0 marks.
- [x] **Step 6: The user pushes Dacs Web** **Done 3 Nov: `4c1a79e`; all 6 files on the live site byte-identical to the commit (11:26).** (Tasks 1–2). Check the live site serves the committed `js/reconciliation-admin.js`, `js/expense-pending-save.js`, `js/expenses-module.js`, `js/purchasing-admin-list.js`, `js/portal-app.compiled.js` and `admin.html`.
- [x] **Step 7: Browser checks** **Passed 3 Nov, 11:29–11:30; see *Execution notes*.** (the user; nothing saved, nothing marked):
  - **admin@ → Requests → Purchasing → Reconciliation:** five sections, expected as of 3 Nov (new entries will change the numbers). *Waiting* lists "2 lines waiting for a billing period" and nothing else: no Unpaid purchases, since all 34 were entered as paid on 31 Oct. *Where every purchase peso is* opens on this month; set 1 Oct → today: 34 purchases, ₱229,108, **Adds up ✓**. *Waiting for a billing period* lists the two Eagle Residence lines (₱344, ₱500) — **do not press "Cover is right"**: whether Cover is correct is the user's pending decision (Q6). *Money still out*: nothing owed and nothing not tracked. *Bills to check*: none yet. The recorded payments' dates and sources are not checked here; that verification is the user's, pending.
  - **admin@ → Project Control → Add Expense → More details:** *Paid now?* reads **Not paid yet**; no waiting-save box. Close without saving.
  - **staff@:** no Reconciliation tab. **Corrected 3 Nov:** staff@ has the Buyer switch on (since 22 Oct), so Add Expense does show *Paid now?* and the supplier box, as designed. A staff account without the switch sees neither; no such account exists, so only the tests cover it.
  - `client_errors` since Step 6: nothing new.
- [x] **Step 8: Execution notes** in this plan; memory updated. Next: Task 4 when the user chooses.

### Task 4: The ZZ pilot (Q14), the clean-up

**Done 3 Nov, 13:09–16:58 (the user said to start); see *Execution notes*.** About an hour on Dacs Web. Money still out starts empty now (every real purchase was entered as paid on 31 Oct), so P2's "+₱80" and P13's "+₱50" are the whole balance. **No real record is touched**: every purchase, payment, mark and tick is on `ZZ 4 pilot…` projects and items, paid by the company only.

- [x] **Step 1: Before (MCP, read-only):** `select count(*), sum(amount) from expenses`; the counts of `purchases`, `pur_payments`, `pur_money_events`, `stk_records`, `stk_cost_moves`, `rec_cover_marks`, `rec_cost_row_log`, `rec_bill_checks`; no folder, item or supplier named `ZZ 4 pilot…`.
- [x] **Step 2: Set up (owner, Dacs Web).** Project **`ZZ 4 pilot A`** with one billing period **four months back** only (so a purchase today has no matching month). Project **`ZZ 4 pilot B`** with a billing period for **last month** and one for **this month**. Catalogue items (material): **`ZZ 4 pilot cement`** (bag), **`ZZ 4 pilot tiles`** (pc).
- [x] **Step 3: Pilot checks** (record each in *Execution notes*).

| # | Check | Expect |
|---|---|---|
| P1 | Add Expense on `ZZ 4 pilot A`: "ZZ 4 pilot paint" ₱344, Paid with GCash, **Paid now = Paid in full**, from Company, How GCash, supplier "ZZ 4 pilot supplier" | "… payment recorded (Paid)"; the row shows **Paid**; Purchasing → the purchase shows one payment, ₱344, GCash, company |
| P2 | Add Expense on pilot A: "ZZ 4 pilot nails" ₱80, Paid with **GCash**, Paid now **left at Not paid yet** | Saved **Unpaid** — "Paid with" did not pay it. Reconciliation → Money still out: "No supplier recorded" +₱80 |
| P2b | Add Expense on pilot A: "ZZ 4 pilot glue" ₱60, Paid in full. Browser DevTools → Network → **Offline**, then **Save**. Close the form; back **online** (corrected 3 Nov: an offline reload does not load the page); **reload** the page; open Add Expense again; **Send it again** | Offline: "No answer from the server…" and the form **locks** (fields greyed; the box with *Send it again* / *Cancel it*). After the reload the box is still there with the same item and amount. Sent again: saved **once** — one row, one payment, ₱60 |
| P2c | Same with "ZZ 4 pilot tape" ₱40 (Not paid yet): offline **Save**, back online, **Cancel it**; then enter it again and Save | "Cancelled — the server will never record it…"; the form unlocks; the second save records it **once** |
| P2d | "ZZ 4 pilot sealant" ₱30 (Not paid yet): offline **Save** (the form locks). DevTools → Application → Local Storage → this site: the key `dacs.addExpense.pending.` + your account id (**not** the one ending `.op`) — change its value to `{broken`. Back **online**; reload; open Add Expense; press **Save**; then **Cancel it** | After the reload the form is still **locked**: "…can no longer be read whole…" with **only** *Cancel it*; Save does nothing. *Cancel it* → "Cancelled — the server will never record it…"; the form unlocks; no "ZZ 4 pilot sealant" row anywhere |
| P2e | "ZZ 4 pilot primer" ₱20 (Not paid yet): offline **Save**. DevTools → Application → Local Storage → this site: set **both** keys — `dacs.addExpense.pending.` + your account id, and the one ending `.op` — to `{broken`. Back **online**; reload; open Add Expense; press **Save**; then **Check with the server** and confirm. **Only on the pilot account, and only while no other Add Expense save of that account is waiting on another device** | After the reload: locked, "…its ID cannot be read — and a missing row in the list does not prove it will not still arrive…", with **only** *Check with the server*; Save does nothing. After it: "Settled with the server: 0 save(s) that had not reached it are cancelled for good…" (corrected 3 Nov: an offline save never registered its id, so there is none to cancel; a registered one is counted, which `4_reconcile.pglite.mjs` covers); the form unlocks; no "ZZ 4 pilot primer" row anywhere |
| P2f | Project Control in **two tabs** on pilot A. Tab 1: DevTools → Network → **Slow 3G**; Add Expense "ZZ 4 pilot rag" ₱15 (Not paid yet) with a receipt photo → **Save**. While it is still saving, Tab 2: Add Expense "ZZ 4 pilot rag 2" ₱16 → **Save**; when Tab 1 has finished, Tab 2 **Save** again | Tab 2 first: "Not sent — Another tab or window is saving an expense for this account…", nothing sent. Then: one "rag" ₱15 and one "rag 2" ₱16 — each **once** |
| P2g | Two tabs. Tab 1 as admin@ on pilot A: DevTools → Network → **Slow 3G**; Add Expense "ZZ 4 pilot brush" ₱25 (Not paid yet) with a receipt photo → **Save**. While it is still uploading, Tab 2: **sign out, sign in as staff@**. Then Tab 2: sign out, sign in as admin@ again; Tab 1: reload; Add Expense "ZZ 4 pilot brush" ₱25 again → **Save** | Tab 1 first: "Not sent — The signed-in account changed (in another tab or window)…" (or the page leaves for the sign-in screen). **No** "ZZ 4 pilot brush" row — not as admin@, not as staff@. With admin@ back: saved **once**, entered by admin@ |
| P3 | Both rows carry **Office review** (no billing period this month). Reconciliation → *Waiting for a billing period*: both listed. **Cover is right…** on the paint, empty reason; then with a reason | First refused ("Please give a reason."); then the mark *Applies*; the paint row's Office review tag is gone in Project Control; pilot A's billing-periods page still says "office review needed" (the nails still wait); pilot A's Spent unchanged |
| P3b | **Cover is right…** on the nails too (a reason) | Pilot A's billing-periods page: "₱424.00 of Cover material has no billing period yet — it counts in Total Spent." — no "office review needed"; Reports (pilot A): the row reads "No billing period — Cover"; Spent unchanged |
| P4 | **Withdraw…** the mark (with a reason); then mark it again | Waiting again; then *Applies* again; the first mark reads *Withdrawn* |
| P5 | Project Control: edit the paint row (notes only, with a reason) | The line waits again; the mark reads *No longer applies (the line changed)* |
| P6 | Purchasing: record a warehouse purchase "ZZ 4 pilot cement" 10 bag ₱1,000 (Not paid yet); Stock: match it to `ZZ 4 pilot cement`, receive 10 | *Where every purchase peso is*: its row — company stock ₱1,000, **✓** |
| P7 | Stock: issue 4 to `ZZ 4 pilot B`; Owner approvals: **Approve** | Bills to check: **To check** — Approved, ZZ 4 pilot cement 4: Company stock → ZZ 4 pilot B, ₱400; *ZZ 4 pilot B · (this month) ₱400*. The purchase row: other ₱400, company ₱600, ✓. Waiting: "1 stock cost move to check on a client's bill" |
| P8 | **Bill checked…** with a note; then **Un-tick…**; then tick again | Checked (note, who, when) → To check → Checked; the waiting count follows |
| P9 | Requests → Stock: reverse that cost move (main owner, a reason) | Bills to check: a new **To check** — Reversed, −₱400 on the same month; the approval keeps its tick. The purchase row: company ₱1,000, ✓ |
| P10 | Stock: count the warehouse — one less than the books (corrected 3 Nov: the 4 issued stay at pilot B after P9, so the books say 6: 5 counted), reason damaged; main owner confirms | The purchase row: loss ₱100, company ₱900, ✓ |
| P11 | Add Expense on `ZZ 4 pilot B` dated **last month**: "ZZ 4 pilot tiles" 10 pc ₱500 (Not paid yet). Stock: match it to `ZZ 4 pilot tiles`; leftovers 2 to the warehouse; issue 2 to `ZZ 4 pilot A` (a reason); Owner approvals: approve | Bills to check: Approved, −₱100 on pilot B's **last month**, +₱100 on pilot A (Cover). Project Control → **Reports**, ZZ 4 pilot B, Monthly: under Billing Allocation Performance, **"Changed after the month ended — (last month): changed (today) by a stock cost move: −₱100.00 (ZZ 4 pilot tiles: ZZ 4 pilot B → ZZ 4 pilot A)"**; **Print** shows the same note |
| P11b | Requests → Stock: **reverse** that tiles cost move (main owner, a reason); Reports again; **Print** | Bills to check: a Reversed item, +₱100 on pilot B's last month. Reports and its print: **both** lines — "…changed (today) by a stock cost move: −₱100.00 (ZZ 4 pilot tiles: ZZ 4 pilot B → ZZ 4 pilot A)" and "…changed again (today) — a stock cost move was reversed: +₱100.00 (…)" |
| P12 | *Where every purchase peso is*: last month to today; **Print**; **CSV** | Every ZZ purchase **✓**; the print and the CSV list the same figures and the total |
| P13 | staff@: Requests → Purchasing; Project Control → Add Expense on pilot B ("ZZ 4 pilot sand" ₱50) | No Reconciliation tab. **Corrected 3 Nov:** staff@ has the Buyer switch on, so *Paid now?* shows; leave it at Not paid yet. Saved, Unpaid (owner's Money still out +₱50) |
| P14 | `client_errors` since Step 2 | Nothing new |

- [x] **Step 4: Clean-up (the user, SQL editor).** Open `supabase/tests/4_pilot_cleanup.sql`; run it **as is** (dry run): expect a red **DRY RUN OK** listing what it would remove, and nothing changed. If it says **GUARD: …**, stop and send the message. Then change `v_dry boolean := true;` to `false;` and run again: **CLEAN-UP DONE**.
- [x] **Step 5: Check (MCP, read-only):** no folder, item, supplier or purchase named `ZZ 4 pilot…`; Step 1's counts and expense sum back exactly; the history guards on; `4_live_check.sql` all ok.
- [x] **Step 6: Execution notes**; memory updated.

### Task 5: CLOSED — script not needed, payments entered manually (Q8)

**Closed by the user, 3 Nov 2026: "script not needed — payments entered manually."** On 31 Oct (14:58–15:02) `admin@` entered one payment for each of the 34 recorded purchases in the app: ₱229,108, each paid in full, all from Company, all dated 31 Oct (the purchases are dated 19–30 Oct). **This closure does not confirm that the recorded payment dates or sources are correct: that verification is pending with the user, and no payment is changed without the user's specific instruction.** `4_confirmed_payments.sql` stays in the repo, empty: it records nothing, and it refuses a purchase that already has a payment. Q8's confirmations table stays blank. The steps below were never run.

Nothing here decides the two Eagle Residence lines: the user marks "Cover is right" in the tab (with their own reason), or adds the month's billing period and saves the row again — their action, never a script's. Both stay pending.

- (not run) **Step 1: From the user's table only:** for each row answered **yes**, one entry in `v_confirm` — `ref`, `expect_total` (the sheet's amount), `paid_on`, `amount`, `source`, `method` and `person_email` exactly as the user gave them. A **no**, **not sure** or blank row gets **no** entry. If a row gives no method, ask the user; never take it from "Paid with".
- (not run) **Step 2: Show the filled list to the user for review** (and the diff to the committed file). Nothing runs until they approve it.
- (not run) **Step 3: The user runs it in the SQL editor**: dry run first (**DRY RUN OK** naming each purchase and its new state), then `v_dry := false` (**DONE**).
- (not run) **Step 4: Check (MCP, read-only):** each confirmed purchase has exactly its confirmed payment and reads Paid or Partly paid; every other purchase is unchanged; `select count(*), sum(amount) from expenses` unchanged; Reconciliation → Money still out shows the balance that is left.
- (not run) **Step 5: Execution notes**; the filled script is **not committed** (it carries the user's money details) unless the user asks.

---

## Self-review (against the answers)

| Answer | Where |
|---|---|
| Q1 small Stage 4, reads and points | Global Constraints; R106–R112; §Y fences it |
| Q2 one plan, server + web, no phone | Tasks 1–2; nothing in WorkMate |
| Q3 a Reconciliation tab, owner accounts | R105; `reconcileTab()`; tests "who" and "the tab is for owner accounts" |
| Q4 where every purchase peso is; print, CSV | R106; `rec_purchase_places`; the section A tests; the CSV test; the acceptance's A1 (every real purchase); the live check |
| Q5 waiting, counts and links | R111; `rec_waiting`; section B; `waitingItems` |
| Q6 "Cover is right" (feature only) | R107–R109; `rec_accept_cover` / `rec_withdraw_cover`; section C; races 1–3. The Eagle lines are left to the user (Task 3 Step 7, Task 5) |
| Q7 "Paid now?" + supplier on Add Expense | R113–R114, R119; tests "Paid with alone never…", "Paid in full / Paid part…", "only accounts that may record payments…", "the supplier…"; §Y; `expense-pending-save.test.js` (a lost reply then an edited retry; close and reload; Cancel it; two tabs; registration and recovery; blocked, full and damaged storage; another account; the signed-in account changing during an upload and between registration and recording; a later attempt refused); `4_reconcile` section I and race 4; pilot P1–P2g |
| Q8 individual review (approach only) | R116; `4_confirmed_payments.sql` (empty); section F; Task 5 closed 3 Nov (payments entered manually; dates and sources unverified) |
| Q9 money still out | R112; `rec_money_out`; section E |
| Q10 bills to check | R110; the log trigger; `rec_bills` / `rec_bill_check`; section D; acceptance C2–C6 |
| Q11 a month changed later | R110, R115; `_pcLateCostMoveNotes` from `rec_bills`; tests "an October cost moved in November and reversed in December…", "the printed Reports page carries both notes…", SQL "a cost from an earlier month, moved and then reversed later…"; pilot P11–P11b |
| Q12 company stock not in Reports | R117; §Y: no Reports total reads a Stage 4 helper |
| Q13 no sign-off, no lock | R117 — nothing built |
| Q14 proof: live check, money tests, ZZ pilot | `4_live_check.sql` (and its tests); §Y; Task 4 + `4_pilot_cleanup.sql` |
| Q15 the old inventory table stays | R117 — untouched |

No placeholders. Every task ends with its whole suite green on its own.

## Proof

**Final merged files (3 Nov 2026): Task 2 on `e875fc5`, with the user's one-space `admin.html` edit kept out of what is committed.** Task 2 was first rebuilt from this plan's own text on a fresh clone at `f007a13`: all 14 files byte-identical to the tested build, 44 suites / 1,405 checks (the scratch clone's git history had been partly lost to a temp clean-up; its files were intact). Then merged, and on the merged files: `npm test` exit 0, 46 suites, **1,459 checks, 0 failed**; every JS file passes `node --check`; `npm run test:sql` **50 suites, 1,473 checks, 0 failed**; the acceptance dry run passed, 0 rows left; the tab's render check OK; the breakage run **76 / 76 caught**, on a scratch copy of exactly these files; the account binding run with the **real** `supabase-js` (2.118) against a local stand-in server, 17 of 17: after B signs in, every request of A's save still carries A's sign-in while the shared client would send B's, and a dropped connection reads as no answer. Live, read-only (3 Nov, 02:26): 34 recorded purchases, ₱229,108; 34 payments, each paid in full; the two Eagle Residence lines the only ones waiting; 0 marks, ticks and registrations. The figures below are revision 4's, as reviewed on 31 October.

Built in a scratch clone of Dacs Web on `db0b4fe`: Task 1 = `4ba6831`, Task 2 = `9cf7e3a` (revision 4; Task 1 is unchanged since revision 3; revision 3 was `4ba6831` / `ab589db`, revision 2 `b4586c4` / `49857a4`, revision 1 `a668ef6` / `9df9489`).

- **Task 1:** `npm test` green (**42 suites, 1,339 checks** — Task 1 changes no screen). `npm run test:sql` green: **48 suites, 1,447 checks, 0 failed** — run on revision 3's rehearsed copy, whose SQL, scripts and `package.json` are byte-identical to this version (revision 4 changes no Task 1 file). New: `4_reconcile.pglite.mjs` **38**, `4_concurrency.mjs` **4** (15 rounds each on real PostgreSQL, no deadlock), `2c_cost.pglite.mjs --with-0109` **29** (every 2C behaviour holds with 0109's trigger on `expenses`); every earlier suite unchanged.
- **Task 2:** `npm test` green (**44 suites, 1,405 checks**): `expense-pending-save.test.js` **42**, `reconciliation-admin.test.js` **21**, `money-math.test.js` **257** (§Y's 3 new; its Add Expense fence follows the bound client), `receipt-save-paths.test.js` **10**, `purchase-server.test.js` **27** (their Add Expense fences follow R119 and R121 — still only `pur_record`); every changed JS file passes `node --check`.
- **Acceptance:** `4_acceptance.sql` run as written on a throwaway PostgreSQL with Supabase-style JWT claims (`_dry4.mjs`: 0096–0109 verbatim, stock on): `stage 4 acceptance: all checks passed`, **0 rows left** (revision 3, with its section G; Task 1 unchanged since).
- **The tab, rendered:** `js/reconciliation-admin.js`'s browser half run on a fake page with server-shaped data (`_s4_render_smoke.js`): five sections; every value escaped; the waiting links go to their section, tab or screen; each form sends **one** operation id; the Office review flags reload after a mark and a withdrawal; a server refusal reads in words.
- **Review finding (revision 4) — a save submitted as another account.** Every request of a save now goes through a client bound to the sign-in token of the account that pressed Save, and before each request the browser checks that account is still the one signed in (R121). Tested in the module and on Project Control's own Add Expense code, with a fake of the real shared client that runs as whoever is signed in at that moment:
  - **Another tab signs in as B while A's receipt uploads:** no request at all — not as A, not as B; nothing kept; the typed form stays; A, signed in again, saves it **once, as A**, with the receipt.
  - **B signs in between registration and recording:** registered as A, then stopped — **nothing recorded**; the save stays kept for A. B's page sees nothing of it; B's *Send it again* and *Cancel it* send nothing; A's own steps asked while B is signed in send nothing either. A, back, sends it again — recorded **once, as A**, exactly as first entered.
  - **B signs in while the request is on its way:** recorded as A (A's own sign-in), never as B; the shared client is never used for a save.
  - **A page still showing A while B is signed in** sends nothing — even when the sign-in flips back to A a moment later (a binding to "whoever is signed in" would have sent it as B: the test fails on exactly that).
  - *Check with the server*, *Cancel it* and the opening check while someone else is signed in: nothing asked, nothing changed; no way to tell who is signed in → nothing sent.
  - Run against revision 3's code, **11 of the 42** tests fail — among them the finding itself: with B signed in during the upload, the old code sent `pur_op_reserve` and `pur_record` **as B**, recorded the purchase and cleared the form.
  - **Found while doing this, and fixed:** a later attempt that the server refused for an unrelated reason (an expired sign-in, a permission changed) forgot the save, though its first request may have been recorded — a re-entry could then record it twice. Now it stays, locked, with the reason, and *Cancel it* settles it (recorded → once; never arrived → cancelled). A first sending's refusal, and a refusal because it was cancelled for good, still settle it.
- **Review findings (revision 3), unchanged:** tabs take turns per account and an answer clears only its own save (two tabs with slow uploads and lost replies: one body built and sent, and kept); every Add Expense id is registered before it is sent, and a save whose id the browser cannot read is settled only by *Check with the server* — the original arriving after the list was checked is refused (module, PGlite, real PostgreSQL with both orders forced, the acceptance's section G).
- **Review findings (revision 2), unchanged:** Add Expense keeps the exact id and body until the server answers (closing and reloading; blocked, full and damaged storage; another account); the Reports note reads `rec_bills` — approvals and reversals, on screen and printed.
- **Found while building, fixed before revision 1:** only a line's newest "Cover is right" mark applies; an approval and a reversal in one transaction are two bill items; the payments script's `case … then` inside `if … then`; "office review needed" for no-billing-period Cover follows the flag.
- **Live, read-only (31 Oct, 12:19 — unchanged since 30 Oct):** 28 recorded purchases, ₱204,376, all project lines, 0 warehouse lines; **0** stock records, **0** cost moves, **0** supplier payments; the two Eagle Residence lines (`8c78b328` ₱344, `7a03382a` ₱500) the only ones waiting for a billing period; stock and tools on; no `rec_*` or `pur_op_re*` table or function; no `client_errors` in 24 hours. The real purchase `24c8f261` (30 Oct 12:48, Sulit Residence · DaCs Delivery, ₱1,500, "Paid with" GCash) reads Unpaid and is **not** in question 8's table; nothing here touches it.
- **Breakage run: 76 / 76 caught (the run began on `7492248`; CLAUDE.md's working note gained one sentence while it ran, `9cf7e3a` — no code changed)** — each rule broken on purpose, one at a time, on this final version, and a suite must fail; every file restored byte for byte after each:
  - **0109 (19):** staff reading the tab; own project ignoring cost-move rows; a warehouse line not yet in stock counting nowhere; voided purchases counted; "Cover is right" not clearing the flag; a line not waiting marked; an older mark still applying after a newer one; a withdrawal not putting the flag back; a reversal's rows not logged; an approval and a reversal in one transaction merged (caught by the acceptance); cash figures for any owner account; another company ticking a bill; the log changeable; a line not on Cover marked; anon reading money still out; a bill item's sides losing their billing period; anyone registering an Add Expense id; anon registering one; the registrations readable directly.
  - **The payments script (4):** recording over a payment already there; running with nothing confirmed; ignoring a changed total; taking no stated method.
  - **The clean-up (2):** deleting a ZZ payment from a buyer's petty cash; forgetting the cost-move log.
  - **The screens (13):** "Paid with" alone sending a payment; staff without the Buyer switch sending one; the tab for every account; the Reports note for a move inside its own month; the tab recording a payment; the report totals reading the note; a difference reading "Adds up"; Add Expense opening as Paid in full; the billing-periods page always saying "office review needed"; the tab not reloading the flags after a mark; Reports keeping a fixed "office review"; the Reports note dropping reversals; the Reports print omitting the note.
  - **The kept save (36):** closing Add Expense forgetting it; sending again rebuilding the body from the form; no answer taken as a refusal; *Cancel it* forgetting without an answer; the opening check forgetting a save the server has not seen; one account seeing another's; the form letting Save through while a save waits or storage is blocked; Save while a save waits sending a new entry; blocked storage read as nothing waiting; a save the browser did not keep still sent; uploading before checking the browser can keep a save; damaged storage read as nothing waiting; a damaged save with two different ids settling one of them; *Send it again* with nothing waiting sending a new entry; the form staying open for blocked or damaged storage; signed out treated as an account; a resend the server refuses leaving the form locked; no lock between tabs; a browser without locks sending anyway; an answer clearing any save it finds; Save's answer clearing whatever is kept; a save sent before its id is registered; a refused registration on *Send it again* forgetting a save that was sent; *Check with the server* clearing without asking the server; the damaged copy cleared even if it changed meanwhile; *Check with the server* without the person's confirmation; recovery settling a save that has its own id; **no account check between registering and recording; no account check after the upload; an account check that cannot tell letting the save through; *Cancel it*, the opening check and *Check with the server* without the account check (3); the save sent through the shared client; the save bound to whoever is signed in; a later attempt refused for another reason forgetting the save.**
  - **Two sessions (2):** "Cover is right" without the purchase lock (two owner tabs → two marks); recovery cancelling without the operation's lock (a save recorded and cancelled at once).

## Rehearsal

The plan's own text — this revision 4 — was applied to two fresh clones of the real Dacs Web at `db0b4fe` (`_s4_rehearse.py`: every Create block written as given, every Modify block through `git apply --ignore-whitespace` after `--check`, then Task 1 Step 1's CRLF command) and every file compared with the tested build:

- **Clean clone:** Task 1 — 11 blocks, **all 11 files byte-identical** to the tested Task 1 (`4ba6831`), no other file touched; with Task 1 alone, `npm test` passes (**42 suites, 1,339 checks**). Task 2 — 14 blocks, **all 24 files byte-identical** to the tested Task 2 (`9cf7e3a`), no other file touched; `npm test` then passes there (**44 suites, 1,405 checks**), and the full `npm run test:sql` ran in revision 3's rehearsed copy, whose SQL, scripts and `package.json` are byte-identical to this one (see *Proof*).
- **With the user's own uncommitted one-space `admin.html` edit made first:** the same 11 + 14 blocks; every file identical (`admin.html` = the tested file plus that edit); no other file touched.

## Execution notes

- **31 Oct, the user, in the app (not this plan):** `admin@` entered 6 more Add Expense purchases (14:51–14:56) and one payment for each of the 34 recorded purchases (14:58–15:02). Dates and sources unverified; pending with the user.
- **1 Nov:** rev 4 approved for Task 1 only. The user accepted that server recovery may cancel their account's unsettled Add Expense saves on other devices, and that browsers without tab locking cannot submit. Applied to the real repo: 8 files byte-identical to the tested build; `package.json`, the migrations README and `docs/DATABASE_SCHEMA.md` merged with the PM-sharing work then uncommitted (0110, which had reserved 0109 for this stage). Committed by the user as `f007a13`. 0109 applied by the user and verified (Task 3, Steps 1–5).
- **2 Nov:** pushed by the user with `e875fc5` (PM sharing personal items). No Stage 4 screen was live yet.
- **3 Nov:** Task 2 approved and merged (Task 2, Steps 1–2): not committed, not pushed. Expected results brought up to date: the tab works at once because 0109 is live; no Unpaid balances remain. Task 5 closed by the user: script not needed, payments entered manually; recorded dates and sources still unverified. Both Eagle Cover decisions pending. The ZZ pilot not started.
- **3 Nov, the user's first browser check (layout only):** Show / Print / CSV, "Cover is right…" and "Bill checked…" stretched wide like input boxes, because `.pur-rec-row` is a grid for form fields. In `js/reconciliation-admin.js` the date row now uses `.att-toolbar` (as the Cash tab's Daily report does) and the two card buttons `.att-actions-row`; dates in the purchases table no longer wrap onto two lines; the script's `?v=` went to `20261103b`. These layout changes differ from Task 2's blocks above. No figure, wording or server call changed.
- **3 Nov, the user's browser check as owner, local server against the live database, looking only (all pass):** Reconciliation 1 Oct → today: 34 purchases, ₱229,108 all in their own projects, Adds up ✓, 8 voided. Reports for Eagle: Materials ₱117,977, Labor ₱12,026, Overhead ₱1,345, Cover ₱26,964, each equal to the database; no late-change note, because no cost move has ever been approved. Profit Sharing: 3 projects, ₱298,659.30 left to share, the 3 personal items on the right projects. Server logs: every `rec_*` read answered 200 and nothing was written. Not covered, and left to Task 3's staff check and the ZZ pilot: saving through "Paid now?", "Cover is right", "Bill checked", and the staff view.
- **3 Nov, live:** the user committed Task 2 as `4c1a79e` (16 files, byte-identical to the tree tested) and pushed; the live site served the 6 changed files byte-identical at 11:26. Browser checks 11:29–11:30, looking only. admin@: Reconciliation 1 Oct → today 34 purchases, ₱229,108, Adds up ✓, 2 lines waiting; Add Expense *Paid now?* Not paid yet, Save unlocked. staff@ (Buyer switch on since 22 Oct): no Reconciliation or Company stock tab; *Paid now?* and Supplier show; Overview without pesos. Since the push: 0 `client_errors`; only reads in the server logs; 34 purchases, 34 payments, 0 marks, 0 ticks, 0 registrations. Found, not changed, for the user: (1) whether staff@ should stay a Buyer; (2) the staff Overview still shows shares of the contract, which with the pesos in the Materials and Labor lists would let staff work out the contract value (not from this stage); (3) two warranty records read `WR-2026-0001`. Saving through "Paid now?", "Cover is right" and "Bill checked" waits for the ZZ pilot, not started.
- **3 Nov, the user decided:** staff@ stays a Buyer, and the staff Overview keeps its contract percentages. For the warranty number the user chose to fix the cause and correct System Plus to `WR-2026-0003` (`js/warranty-fund.js`, `tests/warranty-ref.test.js`, and `supabase/tests/wr_0003_correction.sql`, run by the user). A label only; outside this plan's money rules.
- **3 Nov, 12:31, the Eagle Residence decision (Q6):** the user confirmed both lines (`8c78b328` ₱344, `7a03382a` ₱500) were paid with the company's own money, so Cover is right, and pressed **Cover is right…** on each on the live site, with the reason "Paid with the company's own money. Owner confirmed 3 Nov 2026." Checked after: 2 marks, 0 lines waiting; Eagle's Materials ₱117,977 and Cover ₱26,964 unchanged; both rows untouched on May 2026; 34 purchases and 34 payments unchanged. This was the button's first real use, before the ZZ pilot, by the user's choice. The recorded payment dates and sources stay unverified.
- **3 Nov, 13:04, old test records removed (the user's decision):** the Stage 1c pilots' Work Plan records on Barlin, 8 tasks and 1 meeting with their history, were every Work Plan record on live. The user ran `supabase/tests/wp_test_leftovers_removal.sql` (dry run, then real). Not a Stage 4 record, and no money record was touched. The hidden catalogue items and the voided ₱60 "ZZ 2a1 bolts" stay as history.
- **3 Nov, 13:09–16:58, the ZZ pilot (Task 4), on the live site by the user, as admin@ and staff@:** P1, P2, P2b–P2g, P3, P3b, P4, P5, P6, P7, P8, P9, P10, P11, P11b, P12, P13 and P14 passed, each checked against the database or server logs, except as below. Differences from the table, corrected in it: an offline reload does not load the page, so go back online first; an offline save never registered its id, so *Check with the server* says 0 saves; 5 counted, not 9, because the 4 issued stay at pilot B after P9; staff@ is a Buyer, so *Paid now?* shows. Not seen on the real screen: the "Please give a reason." refusal in P3, and the note on the Reports print in P11 and P11b. Both are covered by `tests/reconciliation-admin.test.js`, which runs the real functions. P2g's first half ended on the sign-in screen, the other result the table allows. Clean-up: dry run, then real, by the user: 11 purchases, 2 payments, 9 expense rows, 8 marks, 4 cost moves, 6 stock records, 2 projects, 2 items. Checked at 16:58: 34 purchases ₱229,108, 34 payments, 34 money events, 597 expense rows ₱3,166,131.74, 269 payroll rows ₱2,888,123.51, 15 projects, 61 periods, 6 items, 26 categories, the 2 Eagle marks, 0 stock, 0 cost moves, 0 log, 0 ticks, 7 of 7 guards on, 0 saves unsettled, 0 `client_errors` since the push, `4_live_check.sql` C1–C6 ok. All equal to Step 1. Test images: the user attached personal images to the test rows, so the 10 files in `uploads/expenseReceipts/869c0be7…/2026-11/` were deleted by hand in Storage (no row pointed at them) and their 10 `receipt_uploads` rows marked `deleted`, 17:04. Supabase left a 0-byte `.emptyFolderPlaceholder` there; it is harmless.
- **3 Nov, what the pilot found (nothing changed; for the user to decide):** (1) **Reports can show old figures.** `loadRptData` uses `_ovAllExpenses`, one fetch at page load, refreshed only by Project Control saves in that tab; Stock, Purchasing, the phone and other accounts do not refresh it, and the project-card totals read it too. At 16:45 Reports still showed a row removed at 16:39, above a fresh note saying it was reversed, so "the figures above are today's" was untrue; Ctrl+F5 corrected it. Stored money was right throughout. Proposed: Reports fetches fresh when opened. (2) *Actual Costs by Period* groups rows by date, so a reduction taken off October's billing period shows under the month of the move; *Billing Allocation Performance* shows it on October. (3) Stock → Match on a line with no unit refuses with "Please give a reason.", which does not say why (Add Expense has no unit). (4) A kept save's receipt uploads use the shared client, not `_expBoundCalls`: after a sign-out they were refused, and the worst case is a stray file, never a purchase, but CLAUDE.md's "every request of a save" overstates it. (5) Looks only: Approve / Reject stretched on Owner approvals (`.pur-rec-row`); Save looks active while the form is locked; Withdraw not aligned in the marks list; "(Cover period) (Cover)".
