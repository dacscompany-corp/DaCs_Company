# DAC's Web — working notes

Read **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** first. It maps the entry points, the
Supabase shim, the two parallel project systems, the money model, and the lifecycle.

Plain HTML + vanilla JS, **no build step**. Open the file, edit it, refresh the browser.

---

## Hard rules

**Never run `npm run build`.** `js/portal-app.compiled.js` is the live source of truth for
Project Control and is edited **directly**. The script is a hard-fail stub and the stale JSX it
built from was deleted on 2026-07-28 — there is no `src/` and no JSX source. Don't recreate one.

**A new data field needs a real DB column.** `js/supabase-config.js` is a Firestore-compat shim
over Supabase: it maps camelCase fields straight to snake_case columns. Writing a field whose
column doesn't exist makes the save fail. Check the table (and add a migration) first. The live DB
has drifted from the migrations before — twice this year.

**Mirror portal HTML edits into both** `Client Management.html` **and** `Dacs Partnership.html`.
Two live audiences, one JS file.

**`folders.id` ≠ `construction_projects.id`.** Two different project systems, two id spaces.
Querying one with the other's id silently matches nothing.

**`projects` means "billing period"**, not project.

**Dates:** never `toISOString().slice(0,10)` for a local date key — PH is UTC+8 and it rolls back
a day. Build from local parts.

---

## Money invariants (don't "fix" these)

```
Labor    = direct + (liability − liabilityIndirect)
Overhead = indirect + liabilityIndirect + overhead_expenses
Spent    = Labor + Material + Overhead
Earned   = % complete × contract        (from the BOQ accomplishment report)
Profit   = Earned − Spent
```

- Indirect labor is **Overhead, not Labor** — counted once, never both.
- Statutory burden follows its worker: a coordinator's SSS is Overhead, a mason's is Labor.
- **Overhead pay never draws down a pakyaw contract.**
- Profit uses **earned** revenue. With no accomplishment data it falls back to the contract and
  must be labelled **"Forecast"**, never "Earned".
- Company overhead (G&A) is never charged to a job.
- **Cover money is Spent, and the Cover figure is a *subset* — never a fourth bucket.** A
  president-funded period, or a row flagged `coverExpense`, is the same work paid from the
  company's own pocket because the client's allocation ran out. It counts in Labor / Material
  like any other cost; "Cover Expenses" reports how much of that total was fronted, and is
  **never added on top of** Spent. Carving it out understates cost and overstates Profit.
  Allocated stays client-funded only, so utilisation still reads as spend-vs-allocation.
  Both filters must match — dropping the `coverExpense` **flag** from materials but the whole
  president **period** from labor is what made Reports and Project Control disagree (fixed
  2026-08-20; §I of `money-math.test.js` fences all six sites).
- **`reimbursements` (0041) is outside the money model.** It tracks expenses the owner/admin
  advanced and whether the client paid them back. Nothing may feed it into Spent / Earned /
  Profit, or turn a status change into an invoice, payment or accounting entry — that isolation
  *is* the feature. Owner-only; staff never see it.
- **Warranty retention (0043) is an internal company reserve, outside the money model.**
  On completion the company sets aside 5% of the project's remaining cash (`netCash × 5%`,
  `netCash = paid − directCost`) to fund warranty work, company expenses and project management.
  **Client billing is deliberately not involved** — this is the company reserving part of its own
  margin, not money withheld from a client. Don't "fix" it into a billing deduction. Closing a
  project as `completed` freezes it into `warranty_retentions`; draws sit in
  `warranty_fund_expenses`. **A draw charges no project's Spent** (it has no job to charge, and
  G&A is never charged to a job), and negative net cash contributes **zero** — only
  `contributed_amount` is ever summed. Only `js/warranty-fund.js` may touch those tables.
  Owner-only; staff never see it.
- **`quotations` (0045) is outside the money model.** A quotation is a *proposal*, not revenue.
  Nothing may feed it into Spent / Earned / Profit, and marking a quote **Won** must never create
  a folder, construction project, invoice or contract value — converting a won quote into a
  project is a manual admin action. Only `js/quotation-module.js` and `js/quotation-print.js` may
  touch those tables. Owner-only; staff never see it.
- **Purchasing (WorkMate Stage 2) — staff exception.** Staff with the **Buyer** switch may see
  purchase prices, totals, supplier payments and receipts **within their buying scope**, in
  Purchasing screens only. Project profit, reimbursements, warranty fund and quotations stay
  restricted, and Project Control stays amount-free for staff (apart from its Add/Edit forms —
  see *Verifying*). Approving cost moves between
  projects or from warehouse stock is **main owner only**. Workers and team leaders never see
  prices, receipts or payments. (Approved 2026-10-14; spec
  `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md`.)
- **Buying a request (0097).** The Buyer switch is `pur_buyers`, set by the main owner only;
  who may buy is the server's `pur_buyer()` (owner / admin allowed Expenses / Buyer staff, own
  company). **Bought is never a counter**: `purchase_line_covers` is rebuilt from the stored
  purchase lines by `pur_cover_lines` on every record / correct / replace / void, and only
  recorded purchases count — so Still to buy is never negative. Actual quantity, quantity
  covering the request and extras stay separate; a different unit counts only after an
  audited office check (`pur_check_unit`). An extra's location (project / warehouse) never
  moves its cost — cost moves are Stage 2C (owner-confirmed cost moves), main owner only. Purchase receipts live in the
  buyer-only `purchases/` storage folder and are never given a signed link.
  Linking a purchase to a request needs the Buyer switch **whatever the source**; picked
  portions are the only ones covered, and a correction keeps the portions a line covered
  and the quantity of each; a portion newly picked in a correction is checked like a new one.
  Purchase rows are readable by buyers only — Project Control reads its one line through
  `pur_entry_row`; never add a direct purchase-table read for staff.
- **Petty cash, personal advances, supplier refunds and supplier credits stay outside Spent,
  Earned and Profit.** Issuing, returning or repaying that money never creates an expense.
  Project purchase costs enter Material/Spent once, after server acceptance through the shared
  recording operation. Warehouse purchases stay outside project Spent until owner-approved cost
  assignment; approved cost transfers follow their separate rules. Payroll and overhead remain
  unchanged.

Full reasoning: [docs/OVERHEAD_MODULE.md](docs/OVERHEAD_MODULE.md).

---

## Finishing a change

This repo **fans out**: no imports, no type checker, nothing tells you about the fifth call site.
Before writing code, grep for every place the thing is **saved, rendered, printed and exported**,
and list the files. A change that touches only the file you opened is almost always incomplete.

### Adding a data field

| Leg | Where | When |
|---|---|---|
| DB column | new migration (see §Verifying for the number) | **Always** — missing column = silent save failure |
| Shim registry | `REG` in `js/supabase-config.js` | Only if it's a new collection, or needs `ts:` / `json:` / `rename:` / `jsonbData` |
| Form input | the owning module's edit form | Always |
| Save path | usually **two** — create *and* edit | Always |
| Render | the on-screen table or card | Always |
| Print / export | `js/print-utils.js`, `js/invoice-module.js` | If it lands on a voucher, invoice or report |
| Staff hiding | `_staff()` in `portal-app.compiled.js`, equivalents elsewhere | **If it is a peso amount** |
| Both portals | `Client Management.html` **and** `Dacs Partnership.html` | If a client or partner sees it |
| Schema doc | `docs/DATABASE_SCHEMA.md` | Always |

Tracer: `payroll.payment_method` (migrations 0037/0038) landed in seven files —
`expenses-module.js`, `print-utils.js`, `portal-app.compiled.js`, `invoice-module.js`,
`DATABASE_SCHEMA.md`, plus the two migrations.

### Adding a nav section / module

1. `PRIMARY_NAV` entry — `js/admin.js` (id, label, icon, `defaultView`, `modules[]`)
2. `_FOCUS_SUBVIEWS` — `js/admin.js` — **the one that gets missed.** Skip it and drill-down views
   are blocked for `allowed_modules` accounts (e.g. `admin-pm@`) while the owner account looks fine
3. The `*_VIEWS` group in `admin.html` (`EXP_VIEWS`, `PM_VIEWS`, …), in sync with `switchView()`
4. Role filter in `_visibleNav()` — `js/admin.js` — decide staff / worker / teamLeader access
5. Section markup + `<script>` tag in `admin.html`
6. RLS policies for any new table, in the same migration
7. Module map in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §4

---

## Verifying

**Run `npm test` after ANY change that touches money code** (`portal-app.compiled.js`,
`expenses-module.js`, `overhead-module.js`). It's `tests/money-math.test.js` — 46 checks that
extract the live functions and enforce every invariant above; exits 1 on breakage, runs in ~1s.
If it fails with "SLICE NOT FOUND", the source was restructured — update the extraction markers
in the test file, never delete the test.

`node --check <file>` catches syntax errors in files the test doesn't cover. Then check it in the
browser: `admin.html`, log in as owner.

Production errors self-report into the `client_errors` table (migration 0028, reporter in
supabase-config.js §13) — query it first when a user reports "it broke":
`select at, page, kind, message, source, line from client_errors order by at desc limit 100;`

Migrations: **next number = highest + 1, never reuse, never SQL-editor changes** — see
`supabase/migrations/README.md` for the canonical order and the audited duplicate pairs.

CI (`.github/workflows/ci.yml`) runs both of the above on every push and PR — syntax-checks all
JS and runs the money tests. Red CI on a `salvs` merge usually means the merge reverted a money
rule or the staff amount-hiding; don't merge until green.

Staff accounts (`currentUserRole === 'staff'`) must not see peso amounts anywhere — two
exceptions: the Buyer purchasing rule under *Money invariants*, and **data entry in Project
Control** (owner decision 2026-10-15): staff add and edit material expenses and payroll there, so
the Add/Edit Expense and Payroll forms, and the Materials and Labor lists (rows, category
subtotals, paid so far), show staff the peso amounts. **Never a share of the contract** in those
screens — with the pesos it would reveal the contract value. Everything else in Project Control
stays amount-free for staff — profit, contract, actual cost, fund allocated, budget remaining,
cover, agreed contract totals, CSV, prints, receipts and contract management (caps, ledgers,
statements). Staff never see billing budgets, so their payroll goes to
the payment month's client-funded period (`_payStaffPeriodId`); their purchases are funded by the
server (`pur_record`). `tests/project-control-staff.test.js` fences both sides.
