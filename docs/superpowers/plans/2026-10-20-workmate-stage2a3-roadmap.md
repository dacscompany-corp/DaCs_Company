# WorkMate Stage 2A-3 — Buying from the phone: roadmap

Date: 20 October 2026

Status: **Approved 20 October 2026** (R1–R8 as written). Plan 2A-3a written 20 Oct: [2026-10-20-workmate-stage2a3a-server-web.md](2026-10-20-workmate-stage2a3a-server-web.md) (adds R9–R15; R9 approved by the user 20 Oct). Plan 2A-3b written 21 Oct: [2026-10-21-workmate-stage2a3b-buyer-app.md](2026-10-21-workmate-stage2a3b-buyer-app.md) (adds R16–R27; R18–R21 approved 21 Oct). Where this roadmap and the plan differ, the plan is the as-tested version; the differences found on 20 Oct are corrected below.

Answers: [2A-3 questions](../specs/2026-10-20-workmate-stage2a3-questions.md) (Q1–Q22 = A; Q23 = A, answered 21 Oct) · Spec: [Mobile Purchasing](../specs/2026-09-30-workmate-mobile-purchasing-design.md) · Before: [2A-2 plan, as built](2026-10-16-workmate-stage2a2-purchasing-office.md)

2A-3 is split into **two plans**, like 1a (server → office → app → pilot):

| Plan | What | Repo | Goes live |
|---|---|---|---|
| **2A-3a** | Migration **0101**, the sign-in function, the Dacs Web fixes | Dacs Web | On its own, as soon as it passes. It helps today: Q17's void protection, Q18's Record again |
| **2A-3b** | WorkMate **0.7.0+1007**: buyer sign-in, Shopping list, Record purchase (offline), My purchases, then the pilot and publish | Dacs WorkMate | After 2A-3a is live |

Each plan is built in a scratch clone and tested first; the plan is then written from that tested code, as in 2A-2.

---

## What the code check found (20 Oct)

Read before planning, so the plans don't promise what the server can't do.

**Already done on the server: no change needed.**
- **Q5 claim / release:** `pur_assign_portion(portion, me, qty, note)` claims an unassigned portion (whole or part, split automatically), and `pur_assign_portion(portion, null, …)` releases one's own. Reassigning someone else's is refused (`ASSIGNED_TO_OTHER`) unless you are the owner.
- **Q6 Mark arranged:** `pr_office_set_arranged(portion, true/false)` is allowed for every office account, Buyer staff included. "Own portions only" is a **phone-screen** rule; the web keeps today's rule.
- **Q16 Withdraw:** `pur_change_requests('pending')` already returns a non-buyer's **own** change requests (without the purchase's other data), and `pur_withdraw_change(id)` works for whoever sent it. *Corrected while building:* a change request is keyed by purchase, while a Project Control row knows only its purchase **line**. So 0101 also adds `pur_my_pending_changes()`, which returns ids, kind and reason only, with no amounts (plan R11).
- **Q17:** `pur_purchases` already returns each purchase's `source` and `projects`, and filters by project. Columns, search and the typed confirmation are web-only.
- Phone purchases: `pur_record` already accepts `source: 'workmate'` (Buyer switch required). Receipts go to `uploads/purchases/<company owner id>/…`, which only buyers may write and read.

**Needs the server (migration 0101).**
1. **Sign-in (Q1).** `attendance-signin` refuses every account that is not a worker or team leader. **A refusal revokes ALL of that account's sessions** (`signOut(token, "global")`), so a staff member who tried the phone today would also be signed out of Dacs Web. The buyer check must therefore be exact: a new `pur_signin_can_buy(user)` (service role only) gives the function the same answer as `pur_buyer()`, before any refusal.
2. **AW job with no billing period (Q19).** Only `pur_fund` raises `AW_NO_PERIOD`, and only `pur_charge_rows` calls it. 0101 redefines `pur_fund` alone: instead of refusing, it creates the job's **one** hidden period under a per-job lock, then funds it in full, as today. *Ruling needed, see R4.*
3. **No receipt (Q8).** A new `purchases.no_receipt_reason` column. A phone purchase (`source = 'workmate'`) with no receipt photo and no reason is refused `NO_RECEIPT` by a BEFORE INSERT **or UPDATE** trigger (an update that would leave neither a photo nor a reason is refused too). `pur_insert` is redefined only to store the reason (one column added). Corrections never remove photos (`docs = docs || new`), so the rule cannot be bypassed later.
4. **My purchases (Q12).** A new `pur_my_purchases(p_days)`: what I bought **or** recorded, every status, the last 60 days.
5. **Where a phone purchase can go (Q11).** `pr_office_projects()` returns top-level projects only, with a count of AW jobs. A new `pur_destinations()` returns open projects **with their open AW jobs** (id, name) for the record form.

**Needs the app as well as the server (Q1, Q23).**
- The app checks the role itself after sign-in (`eligibilityOf` in `lib/auth/worker_profile.dart`, called by `AppController._afterWorker`) and would sign a buyer out as "not a worker".
- Startup re-check: a buyer's access is confirmed with `pur_me()` (`can_buy`). Offline, the last answer this phone saw is used, as workers' profiles are today.
- What buyers see at the Terms gate: **Q23 = A** (21 Oct). Buyers skip the Attendance Terms; workers still accept them as today.
- **Gallery photos (Q8 "camera or gallery"):** the app has the camera package only. Plan 2A-3b adds **`image_picker`**, version pinned. If it needs a newer Android build tool than the app uses (as `permission_handler` 13 did), 2A-3b falls back to **camera only** and says so; it does not upgrade the build tools.

---

## Rulings for you to confirm

**R1 — Sign-in answer.** The function answers a buyer with the same shape as today, plus `"access": "buyer"`. Workers get `"access": "worker"`. A non-worker, non-buyer signing in **from WorkMate** gets the new code **`NO_WORKMATE_ACCESS`** ("This account has no WorkMate access"). From the **old app** (no `x-dacs-app` header) every answer stays exactly as today: `NOT_A_WORKER`.

**R2 — Turning the Buyer switch off.** The server refuses at once. The phone finds out at its next server call (startup, pull-to-refresh, sending a draft). It then shows "Buying is turned off for your account" and **wipes its saved copy** of the shopping list, purchases and receipts. **Unsent drafts are kept, not deleted**, and stay "Needs attention" (BUYER_REQUIRED). If the switch is turned back on, they can still be sent; deleting them would lose a real purchase.

**R3 — Account scope on the phone.** Exactly `pur_buyer()`: the main owner, an admin account with the Expenses section (its own company), and Buyer staff. `admin-pm@` (PM only) cannot buy, so it gets `NO_WORKMATE_ACCESS`.

**R4 — The AW period the server creates (Q19).** Same as the web's *staff* path today: one `projects` row (`funding_type 'downpayment'`, the purchase's month and year), **no budget row and no allocation snapshot**. The cost is identical either way: an AW job is charged in full to its own period, with no cap. The only difference shows when the **owner** opens it from the web: the owner path also writes a ₱0 budget and an allocation snapshot. A server-made period reads **"Allocation not configured"**, as one a staff member created does today. CLAUDE.md forbids back-filling defaults, so the server writes none.

**R5 — "No receipt" is a phone rule.** The web form keeps receipts optional, as today. The reason is shown on the purchase (web and phone) as **"No receipt: …"**.

**R6 — Typed confirmation (Q17).** The person types the project's **first word** (case-ignored). For a purchase with several projects or the warehouse, the word "VOID". The confirmation is on the Purchasing tab's Void and the owner's approval of a void. Project Control's delete keeps its own dialog: it voids one row of that project, and the project name is already in front of the person.

**R7 — Record again (Q18).** It copies the lines, supplier, date, request links and receipt photos into a **new** form. Request links are re-checked when it is saved, never assumed. A portion that has since been bought by someone else is simply not covered again (Still to buy can never go negative). Nothing is saved until Save.

**R8 — Deploy order.** 0101 first, then the sign-in function, then the web push. The function only **adds** a path for WorkMate requests, so the old app is unaffected at every step. Plan 2A-3b needs all three live.

---

## Plan 2A-3a: server, sign-in, Dacs Web (Dacs Web repo)

| Task | Deliverable | Tests |
|---|---|---|
| **1. Migration 0101** | `pur_signin_can_buy`, `pur_fund` (AW period), `purchases.no_receipt_reason` + trigger + `pur_insert`, `pur_my_purchases`, `pur_destinations`, `pur_my_pending_changes`, `pur_purchases` / `pur_purchase_view` showing `no_receipt_reason`; grants; README; DATABASE_SCHEMA.md | New `supabase/tests/2a3_server.pglite.mjs` (0096 + 0097 + 0101 verbatim), `2a3_concurrency.mjs` (two AW purchases at once → one period), `2a3_acceptance.sql` (live, rolled back), static `tests/purchasing-phone-server.test.js`; `npm run test:sql`; `npm test` (money suite untouched: Spent identical) |
| **2. Sign-in function** | `supabase/functions/attendance-signin/eligibility.mjs`, plain JS (pure decision: role, status, app header, can-buy → allow-worker / allow-buyer / refusal code; which sessions a refusal revokes, R9). `index.ts` calls it and `pur_signin_can_buy`. `.gitignore` gains `!supabase/functions/*/*.mjs`, else the file is silently not committed (plan R10) | `tests/signin-eligibility.test.js` under **Node 20, as the repo's CI runs** (`.github/workflows/ci.yml`). Node 20 cannot load TypeScript and reads a `.js` file with `export` as CommonJS, hence `.mjs`. Old app unchanged for every role; WorkMate admits buyers, refuses others with `NO_WORKMATE_ACCESS`; inactive always refused. `index.ts` type-checked with `npx deno check` |
| **3. Dacs Web** | Purchases list: Source + Project columns, project filter, search, typed Void confirm (R6); Record again (R7); "No receipt" shown; Project Control: "Waiting for the owner" + Withdraw for the sender (Q16), still amount-free for staff | `purchasing-admin.test.js` extended (11 tests); `project-control-staff.test.js` and `purchase-screens.test.js` unchanged and still passing; browser checks list |
| **4. Live** | You apply 0101 (I hand you the file, then check), deploy the function, push the web | Live checks + acceptance script; browser checks with ZZ-prefixed test rows and a **project filter before any void** |

## Plan 2A-3b: WorkMate 0.7.0+1007 (Dacs WorkMate repo)

| Task | Deliverable |
|---|---|
| **1. Buyer accounts** | Sign-in reads `access`; `WorkMateAccount` (worker / buyer); startup re-check with `pur_me()`; buyers skip the Attendance Terms gate (Q23 = A); buyer shell: **Shopping list · My purchases · Profile** (Q2); Buyer switch off → wipe (R2) |
| **2. Purchasing data** | Its own local database (drafts, send-once queue, saved copy), the server calls, receipt upload to `purchases/<owner>/…`, sync with "Waiting to send" / "Needs attention" (Q7), bilingual error copy (Q22) |
| **3. Shopping list** | This week first; Mine → Unassigned → others (Q4); urgent and changed marks; project filter; claim (whole/part), release, Mark arranged on own portions, online only (Q5, Q6) |
| **4. Record purchase** | Lines with request picks; project/AW/warehouse; unplanned with reason; extra with reason + location; "Is this the same item?" with reason + optional photo (Q10, Q11); fee/discount split; receipt photos or "No receipt" + reason (Q8); total check (Q9); works offline (Q7) |
| **5. My purchases** | 60-day list with status and receipts (Q12); correct own purchase on the same open project; anything else is sent to the owner; **no void on the phone** (Q13) |
| **6. Pilot + publish** | Test Buyer staff account + **ZZ test project** on the test phone, then one real buyer for one buying run (Q20); publish to the WorkMate stream (Q21). Workers are unaffected: in the live database only W-0007 has ever used WorkMate |

**Not in 2A-3:** payments, deposits, Unpaid/Paid, Overpaid, petty cash, daily report and "Company owes buyer" stay in **2A-4**; stock and cost moves are **2B + 2C**.
