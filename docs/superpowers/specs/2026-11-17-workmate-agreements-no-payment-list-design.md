# WorkMate Agreements: no payroll breakdown on the phone — design

**Date** · 17 Nov 2026 · **Owner decisions** (the user, 17 Nov: approach A; then the answers below)
**Changes** · Linked Labor (`0113`, spec `2026-11-07-workmate-linked-labor-design.md`): what the worker's phone receives and shows.

## Intent

On WorkMate's **Agreements** page a linked worker keeps seeing:

- the **agreed amount**
- **paid so far**
- the **balance left**, which reads **"Over by ₱X"** in red whenever they have been paid more than agreed

They **no longer see the breakdown of payroll**: the list of every payment with its date, amount and method (cash, GCash, bank). The hiding must be **reliable**. The server stops sending the list, so no app version and no download of the phone's data can show it.

## The owner's answers (17 Nov)

| Question | Answer |
|---|---|
| Paid so far total | **Show** (Agreed, Paid so far, Balance stay as today) |
| The breakdown to hide | **The whole payment list**: no dates, no amounts, no method |
| "Over by ₱X" | **Whenever it happens** (as today) |
| Daily-paid agreement (no agreed amount) | **Paid so far only**, with no list (as today, minus the list) |

## Goals

- The server function `ll_my_agreements()` stops returning the `payments` list. It keeps every other key, including `agreed`, `paid` and `balance`.
- A new WorkMate build draws no payment list.

## Non-goals (unchanged)

- **The money box** on each card: Agreed / Paid so far / Balance or Over by, and Paid so far only for a daily agreement.
- **The rest of each card:** project, Additional Works line, scope, trade, chips, BOQ progress, "Works covered", and the footnote.
- **The office side:** Project Control → Labor, statements, the agreement print, contract history and every `lc_*` function. The office still sees every payment.
- **The money model:** `lcPaid`, Spent, Earned and Profit. `money-math.test.js` §Z still holds.

## Anti-goals

- **No phone shows a payment list, or a wrong one.** That includes "No payments recorded yet." for a worker who has been paid.
- **The server never sends a payment's date, amount or method to the phone.**

## Approaches

| | Approach | Trade-off | |
|---|---|---|---|
| **A** | The server stops sending the list, and a new app stops drawing it | Reliable. Needs a migration and a new build. | **Picked** |
| B | Only the app hides the list | The data still reaches the phone, and build 1027 keeps showing it. | Ruled out |
| C | Only the server changes | Build 1027 would show "No payments recorded yet." to a paid worker. | Ruled out |

**Why A is safe now:** no real labor contract is linked to a worker's account yet. No phone shows agreements today.

## Design

**Server: migration `0115_agreements_no_payment_list.sql`.**
- `create or replace function ll_my_agreements()` keeps 0113's definition: the same checks, `security definer`, `search_path`, grants and order.
- The returned object drops only the `payments` key. `agreed`, `paid` and `balance` are computed exactly as before; the per-payment `jsonb_agg` is removed.
- No table, column or other function changes.

**Phone: WorkMate 0.18.1 (build 1028).**
- `MyAgreement` drops `payments`, and `AgreementPayment` is deleted.
- An opened card shows "Works covered" only. The Payments heading, its rows and "No payments recorded yet." are removed.
- The money box and the footnote are unchanged.

**Release order, each step with its own approval:**
1. Apply `0115` live and verify it.
2. Publish build 1028.
3. Raise `min_workmate` to 1028, so no 1027 phone can open Agreements against 0115.
4. Only then link real contracts.

**Records to update:**
- `CLAUDE.md` / `AGENTS.md` → *Linked Labor*: the phone shows agreed / paid / balance, and **no payment list** (owner decision 17 Nov 2026).
- `docs/DATABASE_SCHEMA.md`.
- The Linked Labor design spec: an addendum pointing here.

**Tests:**
- **Dacs Web:**
  - `ll_linked_labor.pglite.mjs --with-0115`: agreed, paid and balance are unchanged; there is no `payments` key; no payment's date or method appears in the answer.
  - A fence on 0115 in `tests/linked-labor-web.test.js`.
  - A read-only `0115_verify.sql`.
- **WorkMate:**
  - No Payments heading, rows or "No payments recorded yet." on any card, opened or not.
  - The money box is unchanged for fixed, daily, paid-in-full and overpaid agreements.
  - A 0113-style answer that still carries `payments` draws no list.

## My calls (the user can correct them)

- **The footnote "Payments are the company’s records…" stays.** The Paid so far total is still shown, so it still applies.
- **The migration is `0115`.** Financial MVP Phase 2, which has not been built and was planned as 0115, moves to `0116`.
- **The app version is 0.18.1 (1028).**

## Left to the builder

The exact SQL and its formatting, and the test file layout.
