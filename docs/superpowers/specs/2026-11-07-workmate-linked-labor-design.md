# WorkMate — Linked Labor design

Date: 7 November 2026

Written for: the owner, and whoever builds and reviews Linked Labor.

**Status:** revision 2, for review. Nothing is applied or published. **Release timing is pending, and it is the owner's to choose.**

**Revision 2 (8 Nov, the owner's review):**
- **A merge never crosses projects.** A project's Additional Works counts as a project of its own.
- **The phone hides every amount the moment a fresh read starts,** and shows "Checking your agreements…" until the server answers.
- **Deployment order:** commit; apply and verify 0113; then push the web.
  - Between those steps, today's office runs against 0113. A blank box is not read as a change, so ordinary saves still work.
  - Changes the history protects are refused, with nothing changed and nothing skipped.

**Rests on:**
- The approved terms, `2026-11-04-workmate-linked-labor-contracts-mvp-terms.md` (4 Nov).
- The owner's answers of 7 Nov: Q1 to Q5 = A, with two additions:
  - **Q4:** a replacement contract keeps the old contract, its payments and any outstanding balance. Closing a contract never marks it paid and never moves payments.
  - **Q2:** the online-only money screens also clear their amounts when the account changes or access is removed.

---

## 1. In plain words

- The office can **link a Project Control labor contract to a worker's WorkMate account.** Only the main owner links, changes or removes a link. Nothing is ever linked automatically.
- **The linked worker sees, on the phone, only their own agreements:**
  - the project
  - its overall progress
  - the scope
  - the agreed amount, paid so far and the balance
  - each payment's date, amount and method
- It shows only while the phone can reach the server. **Nothing about money is saved on the phone.**
- **Contract history is kept for every Project Control labor contract,** linked or not. Once a contract has a signed agreement or a payment:
  - changing its terms needs a reason, and the old terms are kept
  - it can't switch between daily and fixed
  - it can be **ended** instead of deleted
- Ending a contract never marks it paid, and never moves a payment. A replacement is simply a new contract; the old one keeps its payments and balance.
- **No money moves.** Linking, editing, ending and history create no payroll, expense, payment or bill, and change no Spent, Earned or Profit.

## 2. What this changes for the office today

| Today | After Linked Labor |
|---|---|
| Edit contract / Raise cap save straight to the table | Same screens. Once a contract is signed or paid, **a reason box appears**, and the server keeps the old terms. |
| Delete removes any contract; its payments become "Other (uncapped)" | Unchanged for a contract with no signed agreement and no payment. A signed or paid one needs a reason, and its terms are kept in history. **A linked contract can't be deleted: end it, or unlink it first.** |
| Merge into one lumpsum: four separate saves, by typed name | **One server step, all or nothing.** Only contracts of the same person **on the same project** (Additional Works is a project of its own): the same linked account, or all unlinked with the same typed name. Not across daily and fixed. A reason is needed if any of them is signed or paid. |
| No way to end a contract | **End** (with a reason) and **Reopen**. An ended contract keeps its payments and balance, and can still be paid to settle it. |
| Worker cards, statements and the agreement print group by typed name | **Grouped by linked account first, then by typed name.** Two linked people who share a name never share a card, a statement or an agreement print. |
| Contract changes leave no trustworthy trail | **Every change is logged** in `lc_events`: who, when, before and after, and the reason. The log can't be edited or deleted. Owner accounts can read it; staff can't, because it holds amounts. |

Staff keep exactly what they have: they add contracts with a typed name, and never see the account picker, amounts or the history.

## 3. Data (migration `0113_linked_labor.sql`)

**`labor_contracts`, three new nullable columns:**
- `worker_id uuid references profiles(id)`: the linked account. Null means not linked, which is the normal state.
- `ended_at timestamptz`, `ended_by uuid references profiles(id)`: set and cleared only by `lc_end` / `lc_reopen`.

**`lc_events` (new, append-only):**
- `id bigserial`
- `owner_id uuid`
- `contract_id uuid`, with no foreign key, so the record outlives a deleted contract
- `kind`: one of `created`, `linked`, `relinked`, `unlinked`, `edited`, `ended`, `reopened`, `merged`, `deleted`
- `before jsonb`, `after jsonb`
- `reason text` (≤ 500 characters)
- `actor_id uuid`
- `at timestamptz default clock_timestamp()`

Access to `lc_events`:
- RLS select: an owner-role account of the same company.
- No insert, update or delete grant or policy. A guard trigger also refuses UPDATE and DELETE.

**"Established"** = `agreement_signed` is true, **or** at least one payroll row has this `contract_id`.

**Term fields:**
- `worker_name`, `scope`, `trade`
- `agreed_amount`, `pay_type`, `pay_basis`, `category`
- `works`, `folder_id`, `orientation_date`
- the agreement columns (`agreement_signed`, `_signed_at`, `_signature`, `_signature_image`, `_terms_snapshot`, `_pdf_url`, `_pdf_name`)

`notes`, `status` and `updated_at` stay free.

**Guard trigger on `labor_contracts`** (BEFORE INSERT / UPDATE / DELETE). The `lc_*` functions open it with the transaction-local flag `dacs.lc_fn = auth.uid()`, the same pattern as 0111's role switch.

| Write | Rule | Refusal |
|---|---|---|
| INSERT with a `worker_id` | Only the main owner (`pm_main_owner_id()`), for an eligible account, on a `labor` contract | `OWNER_ONLY`, `NOT_ELIGIBLE`, `LABOR_ONLY` |
| INSERT with `ended_at` | Never | `LC_FIELD_LOCKED` |
| UPDATE `owner_id` | Never | `LC_FIELD_LOCKED` |
| UPDATE `worker_id`, `ended_at`, `ended_by` | Only inside `lc_link` / `lc_end` / `lc_reopen` | `LC_USE_FUNCTION` |
| UPDATE `cap_history` | Append only: the old array must be the start of the new one. Every existing writer only appends. | `LC_HISTORY_APPEND_ONLY` |
| UPDATE a term field of an **established** contract | Only inside `lc_edit` / `lc_merge`, with a reason | `LC_REASON_NEEDED` |
| UPDATE `pay_basis` or `category` of an established contract | Never (Q4) | `LC_BASIS_LOCKED` |
| UPDATE `category` to outsource while linked | Never | `LABOR_ONLY` |
| DELETE a linked contract | Only inside `lc_merge`, into a keeper linked to the same account | `LC_LINKED` |
| DELETE an established contract | Only inside `lc_delete` / `lc_merge`, with a reason | `LC_REASON_NEEDED` |

**A blank box is not a change.** `''` and `[]` count as NULL when terms are compared (`lc_blank_free`).
- The office form sends `''` for an empty box, and today's office re-sends every field on each save.
- On live, 5 contracts have no trade and 2 have no agreement file.
- Without this, an ordinary save on one of them would be refused once paid.

**Logging (AFTER triggers):**
- `created`, plus `linked` if an account was chosen
- `edited`, with only the changed term fields before and after, and the reason
- `deleted` or `merged`, with the full term snapshot, the reason, and how many payments it had and their total

**Locking:**
- The trigger takes `FOR UPDATE` on the contract row before it decides whether the contract is established. A payroll insert's foreign-key check takes `FOR KEY SHARE`, which conflicts with that, so a payment saved at the same moment can't slip past the reason rule.
- `lc_link` locks the profile `FOR SHARE`, so an account switched off at the same moment can't be linked.

## 4. Server functions

All are `security definer`, with `search_path = public, pg_temp`, revoked from public and anon, and granted to authenticated. **Only `js/linked-labor.js` calls the office ones, and only WorkMate calls `ll_my_agreements`.**

| Function | Who | What |
|---|---|---|
| `lc_link_candidates()` | Main owner | Active worker and team-leader accounts of the company: id, name, worker number, role, main trade |
| `lc_link(contract, worker, worker_no, reason)` | Main owner | Links, relinks or unlinks (worker = null). The worker number must match the account (`WORKER_NO_MISMATCH`). Labor contracts only. A reason is required to relink or unlink. Logs it. Never touches money, payroll, names or other contracts. |
| `lc_edit(contract, changes jsonb, reason)` | Owner or staff of the company (today's access) | Applies term changes (snake_case keys). A reason is required if the contract is established. Refuses daily↔fixed and category changes once established, and folder, owner, link or end fields. `''`, `[]` and NULL count as the same blank, so an empty box the form sends is never a change of terms. |
| `lc_end(contract, reason)` / `lc_reopen(contract, reason)` | Owner-role account of the company | Sets or clears `ended_at`. Reason required. No money effect. |
| `lc_delete(contract, reason)` | Owner-role account of the company | Deletes. A reason is required if established. Refused while linked. Payments become "Other (uncapped)", exactly as today. |
| `lc_merge(contracts[], keeper, title, reason)` | Owner-role account of the company | All in one step. Same company, **same project** (`LC_MERGE_FOLDER`), same category, same pay basis, and the same identity: all linked to one account, or all unlinked with the same trimmed name. The keeper gets the summed cap (0 if daily), the works list and the title. Payments are repointed to the keeper, then the others are deleted. The money reads the same before and after. |
| `ll_my_agreements()` | An active worker or team leader (`pr_is_requester()`) | Only the caller's own linked labor contracts in their own company. Shape below. |
| `ll_folder_progress(folder)` | Internal: no grant | That folder's own BOQ progress, or null |

**`ll_my_agreements()` returns, for each agreement:**
- id, project name, whether the project is completed
- the main project's name, when the agreement is on an Additional Works project
- progress %, or null
- scope, trade, pay basis, the works names
- **fixed:** agreed, paid, balance (negative means over)
- **daily:** paid only, with no agreed amount and no balance
- whether it has ended, and when
- payments: one line per payment for this agreement, as date, amount and method. The split parts of one payment are summed under one line.

It never returns:
- notes, receipts, signatures or PDF links
- cap history, the recorded typed name or other people's payments
- the billing period, funding or Cover
- the contract value, budgets or anything about the company

**Paid so far** = the payroll rows with this `contract_id` that draw down. That is `lcPaid`'s rule: indirect pay and indirect burden are excluded. The terms name payroll as the source.

**Progress (Q1 = A):** `ll_folder_progress` copies `_folderCompletion` in `portal-app.compiled.js`:
- It reads that folder's own BOQ, choosing the one with the most cost items.
- line total = qty × (material rate unless overridden + labor rate unless overridden)
- accomplished = total × % complete ÷ 100
- % = accomplished ÷ total, kept between 0 and 1
- It returns null when the total or the accomplished amount is 0.

So:
- **An agreement on the main project** shows the main project's own % (the same figure on its dashboard, which already leaves Additional Works out).
- **An agreement on an Additional Works project** shows that Additional Works' own %. The phone labels it with its name and the main project's name.
- **No BOQ, or nothing accomplished:** "Progress not recorded yet". The main project's figure is never borrowed, and there is never a forecast or 100% stand-in.
- Only the % leaves the server, never the BOQ amounts.

Numbers are read the way `_billNum` reads them (commas dropped, leading number taken, anything else 0). A test runs the real `_folderCompletion` and `ll_folder_progress` on the same BOQs and requires the same answer.

## 5. Office screens (Dacs Web)

- **New `js/linked-labor.js`:** the account picker, the link dialog, the reason prompt, the history panel and the only callers of the `lc_*` functions. It reads `wk_me().is_main_owner` to decide whether to show the link controls; the server decides anyway.
- **New Labor Contract** (`admin.html`, `handleSaveLaborContract`). The main owner gets an optional "WorkMate account" picker, showing name and worker number.
  - Choosing an account fills in the name and the trade as defaults; both stay editable on the contract, and the profile isn't touched.
  - Before saving, it says: "**[Name] · W-00xx will see this agreement's amounts and payments in WorkMate.**"
  - Staff never see the picker.
- **Edit contract / Raise cap:** save through `lc_edit`. A reason box appears once the contract is signed or paid. The pay basis is locked after that, with a note to end the contract and make a new one.
- **Contract card** (Project Control → Labor, owner only):
  - "Linked: Name · W-00xx" or "Not linked"
  - for the main owner: Link account / Change / Unlink
  - End / Reopen, and History
  - an "Ended" badge
- **Grouping:** `lcWorkerContracts`, the worker tracker's `_lcByWorker` and the worker statement (`printWorkerLaborSOA`) use an identity key: `acct:<worker_id>` when linked, otherwise `name:<trimmed typed name>`. A linked card shows its worker number next to the recorded name. The payroll contract picker adds the worker number to a linked contract's label.
- **Unchanged:** the ledger, file attachments (they only add to history), the agreement template and PDF upload (which goes through `lc_edit` on an established contract), Project Management contracts, payroll save paths, and every money figure.

## 6. The phone (WorkMate)

- **"My agreements"**, a Home card. It appears only after this session's check finds at least one agreement. With no signal there's no card, because nothing is saved.
- **List:**
  - the project (and the Additional Works name)
  - "Overall project progress: 42.5%", or "Progress not recorded yet"
  - a "Completed" or "Ended" chip
  - **fixed:** Agreed / Paid / Balance, or "Over by ₱x"
  - **daily:** "Paid so far ₱x · Daily basis"
- **Detail:** the scope, the works names, and the payments (date · amount · method). It says: "**Payments are the company's records. Progress is the whole project's, not your own work.**"
- **Online only (Q2):**
  - Amounts live only in memory, inside the screen's controller, keyed to the account.
  - They're **cleared** when:
    - **a fresh read starts** (opening the screen, coming back to the app, pulling down). "Checking your agreements…" shows until the server answers, so no old figure is ever on screen while checking.
    - a refresh fails, which shows "Needs signal to show your agreements"
    - the server refuses (account switched off, not a worker, signed out)
    - the agreement list comes back without one shown before
    - the account changes or the person logs out
  - No SQLite, preferences or file is written.
- No new permission, and no change to Attendance, Tools, Requests or My Work.
- **A new version (0.11.0, 1013) is required.** Publishing it is the owner's decision, and the 0E publish pause applies once installs start.

## 7. Money invariants

**Unchanged:** `_projSpent`, `_projEarned`, `_projMargin`, `_recognisedProfit`, `lcPaid`, Cover, billing allocations and Overhead.

A new section of `money-math.test.js` reads their source and fails on any Linked Labor symbol (`worker_id`, `workerId`, `lc_events`, `ll_`, `lc_link`). The merge keeps agreed, paid and balance the same as before, which the tests check.

## 8. Found while designing, not changed

1. **Two "paid so far" figures exist.**
   - Project Control's worker tracker adds Project Management Daily Expenses entries tagged with a Project Control contract, and it counts indirect burden.
   - `lcPaid` counts neither.
   - Live today: no Project Management entry points at a Project Control contract, and every contract payment is direct pay. So the two agree.
   - The phone uses `lcPaid`'s rule, as the terms say. If they ever differ, the phone shows less than the tracker.
2. **`lc_admin` isn't scoped by company** (`is_owner() or is_staff()`). There's one company today. The new functions check the company themselves; the policy itself isn't changed here.
3. **`_folderCompletion`'s tie rule depends on load order** when a folder has two BOQs with the same number of cost items. The server picks the earliest-created one. Live has at most one BOQ per folder.

## 9. Tests and proof

**SQL (`supabase/tests/ll_linked_labor.pglite.mjs`, with 0098 and 0113 run verbatim):**
- who may link, and eligibility
- every guard row in §3, and the logs being append-only
- `ll_my_agreements` access refusals, covering:
  - helper, other worker, leader, client, partner, other company
  - deactivated account, unlinked contract, vendor contract
- fixed, daily and lumpsum figures, overhead pay excluded, split rows summed
- merge refusals, and merge money preserved
- progress parity with the real `_folderCompletion`
- grants and privileges

**Concurrency (`ll_concurrency.mjs`, real PostgreSQL):**
- a payment saved during a reasonless edit
- an account switched off during a link

**Web (`tests/linked-labor-web.test.js`):**
- only `linked-labor.js` calls `lc_*`
- staff see no picker, history or amounts
- grouping by identity
- the reason prompt appears exactly when established
- merge refuses mixed identities before calling the server

**Money:** the new section of `money-math.test.js`.

**Phone:** controller tests (clearing in every case, no storage writes), widget tests (fixed, daily, lumpsum, AW label, no progress, over cap, ended), and the API mapping.

**Live, each its own approval:**
- an after-check of 0113 (structure only, no data changed)
- a ZZ pilot with the test accounts W-0005 / W-0007 on a ZZ project, and a guarded clean-up
- **no real contract is linked by this work**

## 10. Out of scope

Everything §11 of the terms excludes. Also out:
- linking Project Management contracts
- a receipt or "I got paid" confirmation
- payment history beyond date, amount and method
- a saved offline copy
- notifications
- changing the `lc_admin` policy

Release timing and real linking stay the owner's decisions.
