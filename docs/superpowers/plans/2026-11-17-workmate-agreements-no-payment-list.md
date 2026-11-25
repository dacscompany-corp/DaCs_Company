# WorkMate Agreements: no payroll breakdown on the phone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A linked worker keeps seeing Agreed / Paid so far / Balance (or Over by) on each agreement, but never the list of payments. The server stops sending it.

**Architecture:**
- Migration `0115` redefines `ll_my_agreements()` (0113) without the `payments` key.
- WorkMate 0.18.1 (1028) stops drawing the payment list.
- The office side and every `lc_*` / money function are untouched.

**Tech Stack:**
- Dacs Web: PostgreSQL migration, PGlite tests (`npm run test:sql`), Node tests (`npm test`).
- Dacs WorkMate: Flutter/Dart (`flutter test`).

**Spec:** `docs/superpowers/specs/2026-11-17-workmate-agreements-no-payment-list-design.md`, approved by the user on 17 Nov 2026 together with their four answers.

## Global Constraints

- Migration file: `supabase/migrations/0115_agreements_no_payment_list.sql`. The owner applies it as a file, never through the SQL editor.
- `ll_my_agreements()` keeps 0113's checks, `security definer`, `search_path`, grants, order and every key **except `payments`**. `agreed`, `paid` and `balance` keep their exact values and rules.
- App version: `0.18.1+1028`. The money box and the footnote stay exactly as they are.
- **Untouched:**
  - `js/linked-labor.js`, every `lc_*` function, `portal-app.compiled.js` and payroll
  - `money-math.test.js` §Z
- No commit or push by the implementer. The user commits by hand.
- The WorkMate working tree has CRLF files. Keep each file's line endings.

## Review Focus

1. **A server still on 0113** sends `payments`. The new app must draw no list. → Task 2 test "a 0113 answer draws no list".
2. **A paid worker on any card**, closed or opened, never sees a Payments heading, a payment row, a method word (GCash, Cash, Bank) or "No payments recorded yet." → Task 2 test.
3. **The money box is unchanged** for fixed, daily, paid-in-full (Balance ₱0.00) and overpaid (Over by ₱500.00 in red) agreements. → Task 2 tests (kept or extended).
4. **Leaks:** the server's answer contains no `payments` key and no payment date or method, even after the office records split and dated payments. → Task 1, check H6.
5. **The totals still add up:** `paid` still excludes Overhead pay and counts split parts once, and `balance` = `agreed` − `paid`. → Task 1, checks H2 to H5 in the `--with-0115` run.

---

### Task 1: Server — `0115` drops the payment list (Dacs Web)

**Files:**
- Create: `supabase/migrations/0115_agreements_no_payment_list.sql`, `supabase/tests/0115_verify.sql`
- Modify:
  - `supabase/tests/ll_base.mjs`: export `M115`.
  - `supabase/tests/ll_linked_labor.pglite.mjs`: the `--with-0115` mode.
  - `package.json` → `test:sql`.
  - `tests/linked-labor-web.test.js`.
- Docs:
  - `CLAUDE.md` and `AGENTS.md`, the *Linked Labor* rule
  - `docs/DATABASE_SCHEMA.md` (`ll_my_agreements`)
  - `supabase/migrations/README.md` (the 0115 row)
  - `docs/superpowers/specs/2026-11-07-workmate-linked-labor-design.md` (an addendum line)
  - `docs/superpowers/specs/2026-11-14-financial-management-mvp-design.md`: Phase 2's planned 0115 becomes 0116

**Interfaces:**
- Produces: `ll_my_agreements()` returns `{ agreements: [ { id, project, main_project, project_completed, progress_pct, scope, trade, pay_basis, works, agreed, paid, balance, ended, ended_at } ] }`, the same as 0113 minus `payments`. Task 2 consumes this.

- [ ] **Step 1: Write the failing tests.**
  - `ll_base.mjs`: `export const M115 = mig('0115_agreements_no_payment_list.sql');`
  - `ll_linked_labor.pglite.mjs`: `const W115 = process.argv.includes('--with-0115');`
    - `fresh()` runs `await db.exec(M115)` after `M113` when `W115` is set.
    - H2, H4 and H5 keep their `agreed` / `paid` / `balance` assertions in both runs.
    - Their `payments` assertions run only when `!W115`.
    - When `W115` is set, each of H2, H4 and H5 asserts `!has(a, 'payments')`.
    - H6, when `W115`: the answer's JSON contains none of `'"payments"'`, `'gcash'`, `'bank_transfer'`, `'2026-10-08'`, `'2026-10-01'` or `'2026-10-21'`. These are phoneSetup's payment methods and dates.
  - `tests/linked-labor-web.test.js`: test `'0115: the phone gets no payment list'`. It reads the migration and asserts:
    - it contains `create or replace function ll_my_agreements()`
    - it has `'agreed'`, `'paid'` and `'balance'`
    - it has no `'payments'` key and no `jsonb_agg(` of payments
    - it creates or alters no table
- [ ] **Step 2: Run them.** Run `node supabase/tests/ll_linked_labor.pglite.mjs --with-0115` and `node tests/linked-labor-web.test.js`. Expected: FAIL (`ENOENT … 0115_agreements_no_payment_list.sql`).
- [ ] **Step 3: Write `0115_agreements_no_payment_list.sql`.**
  - A header names the owner decision of 17 Nov 2026 and the spec.
  - `create or replace function ll_my_agreements()` is 0113's body (`0113_linked_labor.sql`, around line 680) minus the `'payments', pd.payments` pair and the `jsonb_agg(...) as payments` column. The `sum(...) as paid` stays.
  - Repeat 0113's `revoke` / `grant` for it exactly.
- [ ] **Step 4: Write `supabase/tests/0115_verify.sql`.** It is read-only and returns one row of booleans:
  - `ll_my_agreements()` exists and is `security definer`
  - `authenticated` can execute it
  - its `prosrc` contains `'balance'` and `'paid'`, and not `'payments'`
  - every other `ll_*` / `lc_*` body is unchanged: compare the md5 of each `prosrc` with values the script records, read live before applying

  The full-body comparison with the file is done once after applying, with line endings ignored, as 0112 was verified.
- [ ] **Step 5: Add the run.** In `package.json` `test:sql`, add `node supabase/tests/ll_linked_labor.pglite.mjs --with-0115` right after the plain `ll_linked_labor` run.
- [ ] **Step 6: Run the tests.**
  - `npm run test:sql`: expected all PASS, including both `ll_linked_labor` runs.
  - `npm test`: expected exit 0.
  - `node --check tests/linked-labor-web.test.js`.
- [ ] **Step 7: Docs.**
  - The CLAUDE.md / AGENTS.md *Linked Labor* sentence becomes: "…agreed / paid / balance under `lcPaid`'s rule — **never the list of payments** (`0115`, owner decision 2026-11-17)."
  - Make the matching edits in DATABASE_SCHEMA, the migrations README, the Linked Labor spec addendum and the Financial MVP spec (0115 → 0116 for Phase 2).

### Task 2: WorkMate 0.18.1 (1028) — no payment list (Dacs WorkMate)

**Files:**
- Modify:
  - `lib/agreements/domain/my_agreement.dart`
  - `lib/agreements/ui/agreements_screen.dart`
  - `lib/agreements/ui/agreements_copy.dart`, only if `paymentMethodLabel` becomes unused
  - `pubspec.yaml` → `version: 0.18.1+1028`
- Test:
  - `test/agreements/agreement_fakes.dart`: the 0115 shape (no `payments`), plus `legacyJson` with 0113's `payments`.
  - `test/agreements/agreements_screens_test.dart`
  - `test/agreements/agreements_controller_test.dart`
  - `test/agreements/agreements_contract_test.dart`, if it asserts keys

**Interfaces:**
- Consumes: Task 1's shape.
- Produces: `MyAgreement` without `payments`. `AgreementPayment` and `_PaymentRow` are deleted. `agreed`, `paid`, `balance` and `overPaid` are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `testWidgets('no payment list on any card, closed or opened')`, for the fixed, Additional Works, daily and over-cap fakes, with each card tapped open:
    - `find.text('Payments')`, `find.textContaining('No payments recorded')`, `find.textContaining('GCash')` and `find.textContaining('Bank')` find nothing.
    - `find.text('Works covered')` is still found where the fake has works.
  - `test('a 0113 answer that still carries payments draws no list')`: `MyAgreement.fromJson(legacy)` builds. The screen built from `legacyJson` passes the test above, and `find.text('₱10,000.00')` (a single payment's amount) finds nothing. Review Focus 1.
  - Keep the money-box tests as they are: fixed Agreed / Paid so far / Balance, daily Paid so far only, and over-cap "Over by". Add `testWidgets('paid in full reads Balance ₱0.00')`. Review Focus 3.
  - Delete the payment-row tests ('the detail lists the works and each payment…', 'a payment date saved with its time…'). Keep their "Works covered" assertion in the new test.
- [ ] **Step 2: Run them.** Run `flutter test test/agreements`. Expected: FAIL (the Payments section is still drawn).
- [ ] **Step 3: Implement.**
  - Remove `payments` from `MyAgreement` and stop reading the key.
  - Delete `AgreementPayment`.
  - The opened card keeps "Works covered" and drops the Payments label, the empty text and the rows. Delete `_PaymentRow`.
  - Delete `paymentMethodLabel` only if nothing else uses it (grep first).
  - Bump `pubspec.yaml` to `0.18.1+1028`.
- [ ] **Step 4: Run all the app's tests.** Run `flutter test` (all) and `flutter analyze`. Expected: all pass and no new analyzer issue.

### Task 3: Release — each step is its own approval by the user

- [ ] Commit both repos by hand. Push Dacs Web and confirm CI is green.
- [ ] Apply `0115` live as a file, then run `supabase/tests/0115_verify.sql` read-only. Expected: every column `true`.
- [ ] Build the signed release APK `0.18.1+1028` into `Documents\WorkMate releases\dacs-workmate-0.18.1-1028.apk`, and look at it on the test phone.
- [ ] The user publishes 1028 from App updates.
- [ ] Raise `min_workmate` to 1028.
- [ ] Only after that, the main owner links the first real contract.
