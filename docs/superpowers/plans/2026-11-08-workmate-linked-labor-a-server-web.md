# WorkMate Linked Labor, part A: server and office — plan for review

Date: 8 November 2026

Written for: the owner, and whoever applies, reviews and pilots it.

**Status:** Revision 2, for review. **Built and tested in a scratch copy only.** Nothing is applied to the repo, the live database or any phone. **Release timing is pending, and it is the owner's to choose.** Each step below that touches live needs its own approval.

**What changed in revision 2 (the owner's review, 8 Nov):**
1. **A merge never crosses projects.**
   - `lc_merge` refuses contracts on two projects (`LC_MERGE_FOLDER`); a project's Additional Works counts as its own project.
   - The office's pre-check says so before anything is sent.
   - Test G6 puts the same worker's contracts on two projects (and on a project and its Additional Works) and checks that **contracts, payments and history are unchanged.**
   - Before this fix, the scratch build merged them without complaint.
2. **Deployment order:** commit (don't push) → apply 0113 and verify it → **then** push the web. During that window the web live today runs against 0113, and section K replays its exact writes (below).
   - This found one thing to fix: today's office re-sends every field, with `''` for an empty box, so an ordinary save on a paid contract with an empty trade (5 live contracts) would have been refused.
   - **The guard now reads `''` and `[]` as blank** (`lc_blank_free`). Real changes of terms are still refused without a reason. **No fallback skips the history protection.**
3. The earlier offer of a fallback for the new web without 0113 is withdrawn; the new order makes it unnecessary.

**Rests on:**
- the terms, `docs/superpowers/specs/2026-11-04-workmate-linked-labor-contracts-mvp-terms.md` (approved 4 Nov)
- the owner's answers of 7 Nov (Q1–Q5 = A, with the Q4 and Q2 additions)
- the design, `docs/superpowers/specs/2026-11-07-workmate-linked-labor-design.md`

Part B (the phone) is `2026-11-08-workmate-linked-labor-b-phone.md`. Part B needs this part live first.

---

## What it does

- **Links a Project Control labor contract to a worker's WorkMate account,** by the main owner only, never by name.
- **Keeps a history of every contract.** Once a contract is signed or paid:
  - changing its terms needs a reason
  - daily↔fixed is locked
  - it's ended rather than deleted while linked
- **Ending marks nothing paid and moves no payment.**
- Worker cards, statements, the agreement print and merges group by **linked account first, then typed name.**
- **Moves no money:** no payroll, expense, payment or bill is created, and Spent, Earned and Profit are unchanged.

## Global constraints

- Migration number **0113**: the highest on disk is 0112.
- **No money moves.** `_projSpent`, `_projEarned`, `_projMargin`, `_recognisedProfit`, `lcPaid` and `lcStats` are untouched (§Z of `money-math.test.js`).
- **Staff see no picker, no link control, no history and no new amount.** The server refuses them anyway.
- **Only the main owner links** (`pm_main_owner_id()`: owner role, no `owner_id`, active).
- Only `js/linked-labor.js` calls the `lc_*` functions.
- **No real contract is linked by this work.** No mass linking. No name matching.
- The user commits and pushes. Never run `npm run build`. Keep the owner's own `admin.html` edit out of commits.

## Files (patch `ll_a.patch`, 19 files)

| File | What |
|---|---|
| `supabase/migrations/0113_linked_labor.sql` (new) | `labor_contracts.worker_id`, `ended_at`, `ended_by`; append-only `lc_events`; the `lc_guard` / `lc_log` triggers; `lc_link_candidates`, `lc_link`, `lc_edit`, `lc_end`, `lc_reopen`, `lc_delete`, `lc_merge`; `ll_my_agreements`; `ll_folder_progress` (internal). Grants: internals have none, the public eight go to `authenticated` only |
| `js/linked-labor.js` (new) | the office module (`window.LinkedLabor`): identity, the account picker, the link / reason / history dialogs, End / Reopen; the only `lc_*` caller |
| `js/expenses-module.js` | New contract sends the chosen account; Edit and Raise cap save through `lc_edit` with a reason; Delete through `lc_delete`; Merge is one `lc_merge`; `lcWorkerContracts` groups by account first; the payment picker shows the worker number |
| `js/portal-app.compiled.js` | worker cards and the statement list group by account first; the card label shows the worker number; on each job: an "Ended" badge, a "WorkMate: … sees this agreement" line (owner accounts), and Account (main owner) / End / Reopen / History |
| `js/invoice-module.js` | the worker statement: an account key takes that account's contracts only; a name statement leaves out linked contracts' payments |
| `admin.html` | `linked-labor.js` loaded before `expenses-module.js`; the account picker, reason box and basis-lock note in the contract form; script versions bumped |
| `css/expenses-mvp.css` | the "Ended" pill and the account line |
| `tests/money-math.test.js` | §N rewritten for the one-step server merge (the same purposes: one person's jobs only, the keeper, no browser writes, money unchanged proven on the database); §Z new: Linked Labor moves no money |
| `tests/linked-labor-web.test.js` (new) | identity, who calls what, staff, the form |
| `tests/payroll-fresh-read.test.js` | the script-version check accepts a later version than 4 Nov's (same intent) |
| `supabase/tests/ll_base.mjs`, `ll_linked_labor.pglite.mjs`, `ll_concurrency.mjs` (new) | the SQL behaviour suite and the races on real PostgreSQL |
| `supabase/tests/ll_acceptance.sql` (new) | T3's after-check on live: read only, 32 checks (columns, the history's guard and policy, every grant, the triggers, nothing linked yet) and the counts to compare with the snapshot taken before 0113. All 32 pass on the test database |
| `package.json` | the new suites in `npm test` and `npm run test:sql` (CI runs both) |
| `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `supabase/migrations/README.md` | the Linked Labor money rule, the module map, the columns and table, and the next migration number (0114) |

## Tasks

| # | Task | Who | Approval |
|---|---|---|---|
| T1 | **Apply the patch** to the Dacs Web working tree, keeping the owner's `admin.html` edit. Run `npm test` and `npm run test:sql` on the real tree | Me | **This review** |
| T2 | **Commit, but do not push.** Nothing on live changes: the site still serves today's web, and 0113 isn't applied | The user | The user |
| T3 | **Take the read-only snapshot,** then **apply 0113 on live** (SQL editor), then I verify it read-only with `ll_acceptance.sql` and compare the counts | Me, the user, me | **Its own approval** |
| T4 | **Push** (CI must pass), only after T3's check passes. The new web then meets the 0113 it was tested against | The user | The user |
| T5 | **Browser check on live**, owner and staff accounts: New / Edit / Raise cap / Delete / Merge / End / History on a **ZZ** project only | The user, with me | **Its own approval** |
| T6 | **ZZ pilot with the test accounts** W-0005 / W-0007 on a ZZ project (with part B's phone), then a guarded clean-up script, written and tested first | Both | **Its own approval** |

**Between T3 and T4: today's web on 0113.** Keep this window short; T3's check takes minutes. Section K replays today's exact office writes against 0113 (`js/expenses-module.js` at `68bc8ff`, through the shim).

| Today's office does | On 0113 | Test |
|---|---|---|
| New contract (typed name, any fields) | **Works**, and is logged as created | B1 |
| Edit contract, terms unchanged (notes only; empty boxes sent as `''`) | **Works**; nothing logged as a change | K1 |
| Edit contract of a draft (not signed, not paid) | **Works**, and the change is logged | K3 |
| Add file (adds a line to the cap history) | **Works** | K5 |
| Delete a draft | **Works**, its terms are logged | K6 |
| Record, change or delete a payment (owner or staff) | **Works**: 0113 doesn't touch payroll | K8 |
| Change the terms of a **signed or paid** contract (Edit, Raise cap) | **Refused, nothing changed**: today's office sends no reason. It shows "Error: LC_REASON_NEEDED". Try again after T4 | K2, K4 |
| Delete a signed or paid contract | **Refused**, and its payments stay on it | K6 |
| Merge into one lumpsum (paid jobs) | **Refused at its first save, so nothing moves** (today's merge saves the keeper first). Its message says "re-run it", but nothing was changed | K7 |
| Project Control, statements, prints, the phone (1012) | **Unchanged**: they only read contracts, and new columns are ignored | — |

So during the window, **nothing is lost and the protection is never skipped.** The only effect is that changing the terms of a signed or paid contract waits until T4. Tell the office not to edit, raise caps on, delete or merge signed or paid contracts during those minutes.

**Not the plan, but covered:** if the push came *before* 0113, the new web's Edit, Raise cap, Delete, Merge, End, History and Link would say "Linked Labor needs migration 0113 applied first", and nothing would change. New contracts and payments would work as today.

## How it was tested (scratch, 8 Nov, revision 2)

**SQL (`ll_linked_labor.pglite.mjs`, 0098 and 0113 run verbatim): 61 of 61.**
- A. Structure and privileges:
  - anon runs nothing, and internals have no grant
  - the history is select-only, and refuses update, delete and truncate even for the superuser
  - only owner accounts read it
- B. Creating:
  - staff create as today
  - only the main owner may choose an account; ineligible accounts and vendor contracts are refused
- C. Linking:
  - main owner only, and the worker number must match
  - relink and unlink need a reason
  - linking moves nothing (payroll, names, same-name contracts)
  - a direct write of the link is refused, even by the superuser
- D. Editing:
  - a draft edits freely and is logged
  - a paid or signed contract refuses a direct term change; `lc_edit` needs a reason
  - daily↔fixed and the category are locked once established
  - locked and unknown fields are refused
  - **a blank box is not a change:** `''` or `[]` against a NULL needs no reason and logs nothing
  - the cap history only grows
  - only the company's office may edit
- E. Ending:
  - owner accounts only, with a reason
  - ending marks nothing paid and moves no payment, and the contract can still be paid
  - **a replacement leaves the old contract, its payments and its balance as they were (Q4)**
- F. Deleting:
  - a draft as today
  - a paid contract only with a reason (payments become uncapped, as before)
  - a linked contract never
  - **deleting a project folder still works**, and is logged
- G. Merging:
  - one step, summed cap, works in order, payments repointed, money the same
  - never across people (linked + unlinked, two accounts with one name, two typed names), nor across daily and fixed
  - bad merges are refused before anything changes
  - **never across projects** (G6, new): the same linked worker on two projects, on a project and its Additional Works, on three projects, and one typed name on two projects are all refused (`LC_MERGE_FOLDER`), with **contracts, payments and history row for row unchanged**
- H. The phone's read:
  - exactly the caller's own linked agreements, refused for office, client, partner and switched-off accounts
  - other company: nothing
  - fixed / daily / over-cap figures
  - Overhead pay excluded
  - split parts are one payment
  - Additional Works shows its own progress (Q1)
  - nothing private leaves the server
  - a worker reads no table directly
- I. Progress: equal to the office's real `_folderCompletion` on 8 sample BOQs (commas, overrides, zeros, over 100%, garbage text, several BOQs).
- J. Link, edit, end and reopen leave payroll exactly as it was.
- **K. Today's office against 0113** (8, new): the deployment window, replayed write by write. See the table under *Tasks*.

**Races on real PostgreSQL (`ll_concurrency.mjs`): 6 of 6**, 5 rounds each, no deadlock:
- a payment saved during a reasonless edit: the edit waits, then is refused
- a draft edit, then a payment: both stand
- an account switched off during a link: refused
- two links at once: no silent overwrite
- a payment during a merge: it lands on the keeper

**Web:** `npm test` passes in full (every suite).
- `money-math.test.js`: **261 of 261**, with §N rewritten (now also: jobs on two projects never reach the server, and `lc_merge` refuses them) and the new §Z.
- `linked-labor-web.test.js`: **13 of 13** (the merge pre-check now covers two projects, and a project and its Additional Works).

**SQL, all 56 suites (`npm run test:sql`):** see *Results* below.

**Deliberate breaks: 27 of 27 caught.** Each one undid a single rule:
- **20 server rules**, including:
  - every finding below: the guard flag, the blank box in `lc_edit` and in the guard, and **merging across projects**
  - the reason, the basis lock, the worker number, eligibility, main-owner-only, cap history
  - the phone seeing only its own, Overhead pay, BOQ choice, overrides
  - deleting a linked contract, merging across people, the race lock, deleting a project folder, the history's guard, and a grant
- **7 web rules:**
  - identity in the agreement and merge, and identity on the cards
  - staff and the picker
  - the merge sending other contracts, and **the office letting a merge across projects reach the server**
  - a money function reading the link
  - a name statement taking a linked person's payments

**Found and fixed while testing:**
1. **The guard let direct writes through.** Its "opened by a function" check came out NULL (not false) when nothing had opened it, so direct writes slipped through in 9 of the first 51 checks. Fixed with `coalesce(…, false)`; break S1 re-creates it and is caught.
2. **A blank box looked like a change of terms.** On live, **5 contracts have no trade and 2 have no agreement file** (NULL). The Edit form sends `''` for an empty box, so saving any edit on one of them, once paid, would have demanded a reason and logged a false change. `lc_edit` now treats `''`, `[]` and NULL as the same blank (test D11, break S18).
3. **The same was true of the guard itself** (revision 2), which matters for **today's** office during the deployment window. `lc_blank_free` now makes the guard and the log read blanks alike (tests K1 and D3, break S20).
4. **A merge could cross projects** (revision 2, the owner's finding). It is now refused (G6, breaks S19 and W7).

## Results

Final runs on the scratch copy, 8 Nov (revision 2), with every file as it is in `ll_a.patch`:

| Check | Result |
|---|---|
| `npm test` (every web suite, including the two new ones) | **Passed** (exit 0, no failure) |
| `npm run test:sql`: all **56** suites (54 before + `ll_linked_labor` + `ll_concurrency`) | **1,710 checks passed, 0 failed** |
| `ll_concurrency.mjs` (real PostgreSQL) | 6 of 6, no deadlock |
| `node --check` on every file in `js/` | No error |
| `ll_acceptance.sql` on the test database | 33 of 33 (one more helper to check: `lc_blank_free`) |
| Deliberate breaks | 27 of 27 caught; every file restored |
| `git apply --check` of `ll_a.patch` on the real Dacs Web tree, with the owner's `admin.html` edit in place | Applies cleanly; `admin.html`'s own edit is kept |

## Found and not changed

1. **Two "paid so far" figures.**
   - The worker tracker adds Project Management Daily Expenses tagged with a Project Control contract, and counts indirect burden.
   - `lcPaid` counts neither. On live today both are zero, so they agree.
   - The phone uses `lcPaid`'s rule, as the terms say.
2. **`lc_admin` isn't scoped by company.** One company today; the new functions check the company themselves.
3. **`_folderCompletion`'s tie rule depends on load order** when a folder has two BOQs with the same number of cost items. The server picks the earliest-created one. Live has at most one BOQ per folder.
4. **Deleting a project folder takes its contracts** (an existing foreign key). The guard allows it and logs each one, so deleting a project works as before.

## Not in this part

- **The phone screen:** part B.
- **The ZZ pilot clean-up script:** written and tested before T5, with its own approval.
- Linking Project Management contracts, receipts or "I got paid", notifications, a saved offline copy, and changing `lc_admin`.
