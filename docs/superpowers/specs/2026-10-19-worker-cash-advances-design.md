# Worker Cash Advances — MVP design

**Status:** design approved in chat 2026-10-19; awaiting spec review.
**Section:** Project Management → **Cash Advances** (new tab, after Profit Sharing).
**Migration:** `0100_pm_cash_advances.sql` (highest applied is 0099).

## 1. Purpose

Track money advanced to workers on a Project Management project, and the repayments the owner
records by hand. It is a **tracking ledger only**: payroll, project totals and accounting are untouched.

## 2. Decisions taken in brainstorming

| # | Question | Decision |
|---|---|---|
| D1 | How an advance identifies its worker | **Typed name**, with suggestions from names already used on that project's Labor lines. PM payroll has no worker id — Labor lines in `weekly_bills.entries` carry a typed name in `details`. |
| D2 | Where the suggestion's payroll amount comes from | **Pick one of the worker's Labor lines on the project, or type an amount.** |
| D3 | Who may use it | **Every owner-role account in the same company** (main owner and focused owners such as admin-pm@). Staff, workers, team leaders and clients: none. |
| D4 | Fixing mistakes | **Void with a reason**, never delete. Advance details stay editable within the rules in §4. |
| D5 | Storage and enforcement | **Option A — server-checked ledger.** Private tables; every read and write goes through security-definer functions that hold a row lock on the advance. |
| D6 | Default suggested % | **30%**, editable per advance from 0% to 100% inclusive. |

## 3. Separation from payroll and the money model

- Nothing in the money model reads these tables. `_projSpent`, `_projEarned`, `_projMargin`,
  `_recognisedProfit`, the PM overview totals, Profit Sharing and the Warranty Fund stay free of
  every cash-advance symbol (fenced by a test — §9).
- Recording, editing or voiding an advance or repayment creates **no** payroll line, expense,
  invoice, payment request or accounting entry, and changes no `weekly_bills` row.
- A suggestion is a label. It is never stored as, or counted as, a repayment.
- The project link says **where the advance belongs**; it charges nothing to that project.
- Separate from the Client Reimbursement tracker (0041): different direction, table and module.
- Payroll is only ever **read**, to list a worker's Labor lines as a suggestion basis (§6.4).

## 4. Rules

**Amounts**
- R1. An advance amount and every repayment amount must be **greater than ₱0**. Amounts are stored
  as `numeric(12,2)` (to the centavo).
- R1a. An amount with **more than two decimal places is rejected, never rounded** (`BAD_PRECISION`:
  "Amounts can have at most two decimal places."). The server checks `amount = round(amount, 2)`
  on the value as received, before it is cast to `numeric(12,2)`; the browser checks the typed text first.
- R2. Suggested % must be **0 ≤ pct ≤ 100**, with at most two decimal places (rejected the same
  way as R1a). New advances default to **30**.

**Balance and status** (computed on read, never stored)
- R3. **Repaid** = sum of the advance's non-voided repayments.
  **Balance** = advance amount − Repaid.
- R4. **Status:** Repaid = 0 → **Unpaid**; 0 < Repaid < amount → **Partially Paid**;
  Balance = 0 → **Fully Paid**. A voided advance shows **Voided** and is excluded from every total.
- R5. A repayment may not exceed the current balance. Recording one when the balance is ₱0 is refused.

**Editing**
- R6. An advance's project, worker name, date issued, suggested % and notes are editable.
- R7. The advance amount is editable but may **not be reduced below Repaid**.
- R8. A voided advance or a voided repayment cannot be edited, voided again, or receive repayments.
  Repayments are never edited — a wrong one is voided and re-entered.

**Voiding**
- R9. Voiding needs a non-blank reason. The row is kept, with `voided_at`, `voided_by` and
  `void_reason`; it simply stops counting.
- R10. Voiding a repayment **restores the balance** by its amount.
- R11. Voiding an advance is **refused while it has any non-voided repayment**. Those repayments
  must be voided first.

**Payroll references**
- R12. A payroll reference is optional. When given it is a **snapshot** taken at save time: the
  bill id, entry id(s), day, description and amount. A later edit or deletion of that Labor line
  never changes the repayment or its displayed reference.

**Concurrency**
- R13. Recording a repayment, editing an advance and voiding (either kind) all take the **same lock**
  — `select … for update` on the `pm_cash_advances` row — before checking any balance rule. Two
  saves on one advance therefore run one after the other, and R5, R7 and R11 always see current figures.

**History**
- R14. The server appends an event for every issue, edit (field, old → new), repayment and void.
  Events are never updated or deleted.

**Deleted projects**
- R15. An existing advance is authorized through its saved `company_owner_id`, **not** through its
  project. After its PM project is deleted the advance still lists, shows its project-name snapshot
  with "(project deleted)", and still accepts repayments, edits (other than the project) and voids.
  The project is validated against `pm_project_companies` only when an advance is **created** or its
  project is **changed** — and a change must name a live project in the caller's company.

**Duplicate submissions**
- R16. Every write call carries an **operation id** (`p_op_id`, a uuid the browser creates when a form
  or void panel opens and keeps through retries). The first call with that id does the work and stores
  its result. **Any later call with the same id returns that stored result** and writes no row and no
  history event — so a double-click, a network retry or a resubmitted form can never record a second
  repayment. A fresh id is made only after a success or when the form is closed. An id already used
  for a different action or by another company is refused (`OP_CONFLICT`).

## 5. Data (migration 0100)

All three tables: RLS on, **no policies**, all privileges revoked from `anon` and `authenticated`.
Only the functions in §5.4 touch them. No shim `REG` entry — the module calls the RPCs directly.

### 5.1 `pm_cash_advances`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `company_owner_id` | uuid not null | from `pm_owner_company()` |
| `project_id` | uuid not null | a **PM** project id, never a `folders.id`. **Plain value, no foreign key** (as `pm_sharing_changes`, 0098): deleting a project must neither be blocked by nor erase this ledger. Validated against `pm_project_companies` **only when an advance is created or its project is changed** (R15). |
| `project_name_snapshot` | text | set when the project is validated (create / project change) and otherwise **retained**; shown with "(project deleted)" when the id no longer exists |
| `worker_name` | text not null | trimmed, non-blank |
| `issued_on` | date not null | |
| `amount` | numeric(12,2) not null | `check (amount > 0)` |
| `suggest_pct` | numeric(5,2) not null default 30 | `check (suggest_pct between 0 and 100)` |
| `notes` | text | agreement details |
| `created_by` / `created_at` | uuid / timestamptz | |
| `updated_by` / `updated_at` | uuid / timestamptz | |
| `voided_at` / `voided_by` / `void_reason` | timestamptz / uuid / text | all null, or all set with a non-blank reason |

Indexes: `(company_owner_id, issued_on desc)`, `(project_id)`.

### 5.2 `pm_cash_advance_repayments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `advance_id` | uuid not null → `pm_cash_advances(id)` | `on delete restrict` |
| `company_owner_id` | uuid not null | copied from the advance |
| `paid_on` | date not null | |
| `amount` | numeric(12,2) not null | `check (amount > 0)` |
| `payroll_ref` | jsonb | null, or `{ billId, entryIds[], day, details, amount }` — snapshot (R12) |
| `notes` | text | |
| `created_by` / `created_at` | uuid / timestamptz | |
| `voided_at` / `voided_by` / `void_reason` | | as above |

Index: `(advance_id)`.

### 5.3 `pm_cash_advance_events` (append-only)

`seq` (identity primary key — gives history a stable order even within one transaction),
`advance_id` (plain uuid, no FK), `company_owner_id`, `kind`
(`issued` / `edited` / `repaid` / `repayment_voided` / `voided`), `repayment_id` (nullable),
`changes` jsonb (`{ field: [old, new] }` for edits), `reason`, `actor_id`, `actor_email`, `at`.
A `BEFORE UPDATE OR DELETE` trigger raises `HISTORY_IMMUTABLE`, as `pm_sharing_changes` does in 0098.

### 5.3a `pm_cash_advance_ops` (operation ids, R16)

| Column | Type | Notes |
|---|---|---|
| `op_id` | uuid pk | from the browser |
| `company_owner_id` | uuid not null | |
| `action` | text not null | `record_advance` / `edit_advance` / `record_repayment` / `void_repayment` / `void_advance` |
| `result` | jsonb | the function's return value, written before commit |
| `actor_id` / `at` | uuid / timestamptz | |

**How a write function uses it** — after the caller check and before anything else:

1. `insert into pm_cash_advance_ops (op_id, company_owner_id, action, actor_id) values (…)
   on conflict (op_id) do nothing returning op_id`.
2. If a row came back, this call owns the operation: do the work (taking the advance lock, R13), then
   `update pm_cash_advance_ops set result = …` and return it.
3. If no row came back, the id was already used. The unique index makes this insert **wait** for a
   concurrent call holding the same id to commit or roll back, so the stored row is final. If its
   company or action differs → `OP_CONFLICT`; otherwise return its stored `result` unchanged.
4. A call that raises rolls back its ops row too, so a refused or failed attempt can be retried with
   the same id.

Rows are kept (small, and they double as an audit of submissions). Same lock-down as the other tables.

### 5.4 Functions (security definer, `search_path = public, pg_temp`, granted to `authenticated`)

Every function starts with `pm_owner_company()` (0098), which refuses with `NOT_SIGNED_IN`,
`INACTIVE`, `OWNER_ONLY` or `BAD_COMPANY_LINK`. An existing advance or repayment must have that
`company_owner_id`; a project being newly assigned (create / project change) must have a
`pm_project_companies` row for that company. Otherwise `NOT_FOUND`, so other companies' ids leak
nothing. Every write function takes `p_op_id uuid` as its first argument and follows §5.3a;
`BAD_OP` if it is null.

| Function | Does | Refuses with |
|---|---|---|
| `pm_ca_projects()` | Company PM projects open to advances: `pm_project_companies` rows for the caller's company, joined to `construction_projects` for the name. | — |
| `pm_ca_list()` | Every advance for the company with its repayments and events, voided included (the screen filters them), each with `project_deleted` (no `construction_projects` row). Repaid / balance / status are computed in JS (§7), not here. | — |
| `pm_ca_record_advance(p_op_id, p_project, p_worker, p_issued_on, p_amount, p_pct, p_notes)` | Validates the project (R15), snapshots its name, inserts the advance and an `issued` event. | `BAD_AMOUNT`, `BAD_PRECISION`, `BAD_PCT`, `BAD_WORKER`, `BAD_DATE`, `NOT_FOUND` (project not in the company) |
| `pm_ca_edit_advance(p_op_id, p_id, p_project, p_worker, p_issued_on, p_amount, p_pct, p_notes)` | Locks the advance (R13), checks R1/R1a/R2/R7/R8; validates and re-snapshots the project **only if `p_project` differs** (R15); updates it and writes an `edited` event listing only the changed fields. A no-change edit writes no event. | `BAD_AMOUNT`, `BAD_PRECISION`, `BAD_PCT`, `BAD_WORKER`, `BAD_DATE`, `BELOW_REPAID`, `VOIDED`, `NOT_FOUND` |
| `pm_ca_record_repayment(p_op_id, p_advance, p_paid_on, p_amount, p_payroll_ref, p_notes)` | Locks the advance, checks R1/R1a/R5/R8, inserts the repayment and a `repaid` event. `p_payroll_ref` is stored as given after a shape check. The project is not checked (R15). | `BAD_AMOUNT`, `BAD_PRECISION`, `OVER_BALANCE`, `VOIDED`, `BAD_REF`, `BAD_DATE`, `NOT_FOUND` |
| `pm_ca_void_repayment(p_op_id, p_repayment, p_reason)` | Locks the **parent advance**, then the repayment; sets the void fields, writes a `repayment_voided` event. | `BAD_REASON`, `ALREADY_VOIDED`, `NOT_FOUND` |
| `pm_ca_void_advance(p_op_id, p_id, p_reason)` | Locks the advance, refuses if any repayment is live (R11), sets the void fields, writes a `voided` event. | `BAD_REASON`, `HAS_REPAYMENTS`, `ALREADY_VOIDED`, `NOT_FOUND` |

All write functions also raise `BAD_OP` / `OP_CONFLICT` (R16). A retried call returns the first
call's result, even if a later call has since changed the advance.

Function bodies use `amount`, `suggest_pct` and the balance as `numeric` — never float.

## 6. Screens

Files: `js/cash-advance.js` (pure logic, §7, plus the thin `pm_ca_*` RPC wrappers — the only file that
names them), `js/cash-advance-admin.js` (list, detail, payroll loading) and `js/cash-advance-forms.js`
(the advance, repayment and void pop-ups).
Dates are local PH dates built from local parts — never `toISOString().slice(0,10)`.

### 6.1 Access and navigation

- `PRIMARY_NAV` (`js/admin.js`): `{ view: 'pmCashAdvances', label: 'Cash Advances', icon: 'wallet' }`
  in the `pm` section after `pmSharing`. The advance detail opens **inside the same view** (as a
  Profit Sharing project does), so there is no second view to route, focus-list or strand on reload.
- Shown **only when `currentUserRole === 'owner'`**: filtered in `_visibleNav()`, hidden in the staff
  sidebar list, and `admin.html`'s `switchView` bounces any non-owner from `pmCashAdvances` to
  `pmProjects`. The server refuses every other role anyway.
- `admin.html`: sidebar item, the view container (list/detail holder + modal holder), view titles,
  the `<script>` tags, and an
  init line in `switchView` beside `pmSharing`'s. **Not** in `PM_VIEWS` — that group starts
  `initPMModule`, the projects grid. No change to `Client Management.html` or `Dacs Partnership.html` — clients and
  partners never see this.

### 6.1a Loading payroll data on its own

Cash Advances must work when opened **directly** — from a bookmark, a refresh on the view, or the
sidebar — without the projects grid (`initPMModule`) ever having run. So it never reads pm-admin.js
state (`_pmActiveProject`, `_pmWeekEntries`, the grid's cached bills).

- **Data:** `cash-advance-admin.js` loads the Labor data itself, per project, on demand:
  `db.collection('constructionProjects').doc(projectId).collection('weeklyBills').get()` — the same
  subcollection pm-admin.js reads. It is fetched when a project is picked in the advance form (for
  name suggestions) and when the repayment form opens (for payroll lines), cached per project for
  the life of the view, and dropped when the view is left so a re-open sees fresh payroll.
- **Name helpers:** `_pmNamesSimilar` and `_pmLaborNameGroups` are top-level functions in
  `js/pm-admin.js`, defined as soon as that script loads — no PM screen needs to be open. The new
  script tags go **after** `pm-admin.js`. If either helper is missing at runtime, matching falls back
  to an exact, case- and space-insensitive comparison, and the fallback is reported to `client_errors`
  once.
- **Old bills without entries:** a bill that carries only a `labor` total and no `entries` has no
  worker name, so it offers no payroll line (the "Type an amount" basis still works).
- **Failure:** if the bills can't load, the form says "Payroll lines couldn't load — type an amount
  instead" and stays usable. Name suggestions simply don't appear.

### 6.2 List (`pmCashAdvances`)

- **Totals:** Total advanced, Total repaid, Outstanding — over the advances the filters show,
  voided ones excluded.
- **Filters:** worker (text search, matches the same way as the name suggestions), project (dropdown
  from `pm_ca_projects`), status chips All / Unpaid / Partially Paid / Fully Paid, and a
  **Show voided** switch (off by default).
- **Rows:** worker · project · date issued · advanced · repaid · balance · % · status badge,
  newest issue first. A row opens the detail view. A deleted project shows its snapshot name with
  "(project deleted)"; the project filter lists such names too, taken from the advances themselves.
- **+ New advance** opens the form (§6.3).
- Empty state: "No cash advances yet."

### 6.3 New / edit advance (pop-up)

- **Project** — from `pm_ca_projects()`.
- **Worker name** — a text box with suggestions: the project's Labor-line names grouped with
  `_pmLaborNameGroups` (pm-admin.js), canonical spelling shown. Any name may be typed.
- **Date issued** — defaults to today (local). **Amount**. **Suggested %** — defaults to 30.
  **Notes / agreement**.
- On edit with repayments recorded, the amount shows a hint "Can't go below ₱X already repaid".
- Browser checks mirror R1, R2 and R7; server error codes map to plain messages.

### 6.4 Advance detail (inside `pmCashAdvances`)

- **Summary:** Advanced, Repaid, Balance, Status, Suggested %, project, worker, notes.
- **History:** the events in time order — issued, edits (old → new), repayments with their payroll
  reference snapshot, voids. Voided items stay listed, struck through, with who, when and why.
- **Actions:** Record repayment (hidden when Balance = 0 or the advance is voided), Edit advance,
  Void advance, and Void on each live repayment. **Void advance is disabled while live repayments
  exist**, with the note "Void its repayments first."
- Voiding asks for a reason in an in-page panel (no `confirm()`/`prompt()`).

### 6.5 Record repayment (pop-up, with the suggestion)

**Suggestion calculator** — kept visually separate from the repayment fields:

- **Payroll basis** — a choice of:
  - the worker's **Labor lines on this project**, newest first, shown as day · description · amount.
    Matching uses `_pmNamesSimilar` against the advance's worker name, over `type === 'labor'`
    entries of that project's `weeklyBills`. Legs of one split payment (`splitGroup`) show as **one
    line** with their summed amount; or
  - **Type an amount** — a number box used **only** to calculate the suggestion. It is not the
    repayment amount.
- **Result:** "₱6,450 × 30% = **₱1,935** suggested". When that exceeds the balance:
  "capped at the balance, **₱1,200**". The line "Suggestion only — nothing is deducted" is always shown.
- **At 0%** the result reads **"No suggestion"** and the **Use amount** button is hidden.
- **Use ₱1,935** copies the (capped) suggestion into the actual amount field. That is the only link
  between the two.

**Repayment fields:**

- **Payment date** — defaults to today (local).
- **Actual amount** — **starts empty**. May be lower or higher than the suggestion, up to the balance.
- **Notes**.
- **Payroll reference** — if a Labor line was picked as the basis, a "Link this payroll line"
  checkbox (on by default) saves its snapshot (R12). A typed basis saves no reference.
- Save is refused in the browser for ≤ ₱0, more than two decimals, or > balance; the server's locked
  check is final.
- **Submitting:** the form holds one operation id (R16) from opening until success or close. While a
  save is in flight the button is disabled and reads "Saving…". On a network error the button
  re-enables and a retry **re-sends the same id**, so it can only ever record once. The same applies
  to the advance form and both void panels.

## 7. Pure logic — `js/cash-advance.js`

Exposed as `window.CashAdvance` and loadable by Node tests. No DOM, no database.

- `totals(advance)` → `{ repaid, balance, status }` per R3/R4, in centavos internally to avoid float error.
- `suggestion(basis, pct, balance)` → `{ raw, capped, isCapped, none }`.
  `raw = round2(basis × pct / 100)` (half-up); `capped = min(raw, balance)`; `none` when pct = 0,
  basis ≤ 0 or balance = 0.
- `laborLines(bills, workerName, similarFn)` → day-sorted lines, split legs merged.
- `listSummary(advances, filters)` → filtered rows plus the three totals.

## 8. Error messages

| Code | Message shown |
|---|---|
| `OWNER_ONLY`, `NOT_OFFICE` | "Only owner accounts can use Cash Advances." |
| `OVER_BALANCE` | "That's more than the remaining balance of ₱X." (screen reloads first) |
| `BELOW_REPAID` | "The amount can't be lower than the ₱X already repaid." |
| `HAS_REPAYMENTS` | "Void this advance's repayments first." |
| `BAD_AMOUNT` / `BAD_PCT` | "Enter an amount above ₱0." / "Suggested % must be 0 to 100." |
| `BAD_PRECISION` | "Amounts can have at most two decimal places." |
| `OP_CONFLICT` | "This form was already used for something else — close it and try again." |
| `BAD_REASON` | "Give a reason for voiding." |
| `VOIDED` / `ALREADY_VOIDED` | "This was already voided." (screen reloads) |
| other | the code, reported through the existing `client_errors` reporter |

## 9. Tests

- **`tests/cash-advance.test.js`** (added to `npm test`):
  - `totals` — unpaid / partial / fully paid, voided repayments ignored, centavo rounding.
  - `suggestion` — ₱6,450 × 30% = ₱1,935; capped at the balance; 0% → none; 100%.
  - `laborLines` — fuzzy name match, split legs merged, other projects' and non-labor entries ignored.
  - **Isolation fence** — reads the source of `_projSpent`, `_projEarned`, `_projMargin`,
    `_recognisedProfit` (portal-app.compiled.js), PM totals in `pm-admin.js`, `js/pm-sharing.js` and
    `js/warranty-fund.js`, and fails on any `pm_ca_` / `CashAdvance` / `cash_advance` reference.
    Also checks no other file calls a `pm_ca_*` RPC or names the three tables.
  - **Access wiring** — `pmCashAdvances` present in `PRIMARY_NAV`, the `_visibleNav` owner-only
    filter, the staff sidebar hide list, the `switchView` owner-only bounce and init hook.
- **`supabase/tests/pm_cash_advances.pglite.mjs`** (added to `npm run test:sql`): every rule R1–R16,
  every refusal code, staff / worker / other-company callers refused, history immutable,
  "repayment saves never touch `weekly_bills`", and:
  - **deleted project (R15):** deleting a project with advances succeeds; its advances still list
    with the snapshot name and `project_deleted`; repayments, edits and both voids still work; but
    creating an advance on it, or changing an advance's project to it, is refused (`NOT_FOUND`).
  - **precision (R1a/R2):** 100.005 and a pct of 30.125 are rejected with `BAD_PRECISION`, not rounded.
  - **operation ids (R16):** the same `p_op_id` sent twice for a repayment records one repayment and
    one event and returns identical results; the same for every other write; a reused id on a
    different action → `OP_CONFLICT`; a refused call (e.g. `OVER_BALANCE`) leaves no ops row, so a
    corrected retry with that id succeeds.
- **`supabase/tests/pm_cash_advances_concurrency.mjs`**: two repayments racing for the last of a
  balance — exactly one succeeds; a repayment racing an amount reduction; a repayment racing a void;
  **two concurrent calls with the same op id** — one repayment, both return the same result.
- `node --check` on the two new JS files.
- **Browser pass** (owner, then staff):
  1. **Direct open:** sign in, go straight to Project Management → Cash Advances (and separately,
     reload the browser while on it) **without opening the projects grid**. Create an advance —
     worker-name suggestions appear for the picked project. Open Record repayment — that worker's
     Labor lines are listed and picking one shows the suggestion.
  2. Double-click Save on a repayment → exactly one repayment in the history.
  3. Record, void and re-record a repayment; balance and status follow each step.
  4. As staff: no tab, and the view's URL bounces to Projects.

## 10. Files touched

| File | Change |
|---|---|
| `supabase/migrations/0100_pm_cash_advances.sql` | four tables (incl. ops), trigger, functions, grants |
| `js/cash-advance.js` | new — pure logic |
| `js/cash-advance-admin.js` | new — list, detail, payroll loading |
| `js/cash-advance-forms.js` | new — advance, repayment and void pop-ups |
| `css/pm-admin.css` | list, detail, calculator styles |
| `admin.html` | nav item, two view containers, titles, `switchView` init line, staff block, script tags |
| `js/admin.js` | `PRIMARY_NAV`, `_visibleNav` owner-only filter, staff sidebar hide, view title |
| `tests/cash-advance.test.js`, `package.json` | new suite, wired into `npm test` |
| `supabase/tests/pm_cash_advances*.mjs`, `package.json` | SQL suites, wired into `test:sql` |
| `docs/DATABASE_SCHEMA.md` | three tables |
| `docs/ARCHITECTURE.md` §4 | module map row |
| `CLAUDE.md` | money-invariant bullet: cash advances are outside the money model, owner-role only |
| `supabase/migrations/README.md` | 0100 in the canonical order |

## 11. Outside the MVP

Automatic deductions, automatic payment recording, worker self-service, interest, penalties, payroll
recalculation, printing / CSV, and any client or partner portal surface.

## 12. Completion criteria

The owner can: (1) record an advance against a worker and project; (2) set its suggested %
(default 30); (3) see the calculated suggestion for a payroll line or a typed amount; (4) record any
agreed repayment on any day, up to the balance; (5) review history and accurate balances, including
voids; (6) do all of it without any change to payroll or project financial totals — proven by the
isolation fence and by `npm test` staying green.
