# DAC's — System Architecture

The one document that explains how the whole thing fits together. Per-module detail lives in
the other files in `docs/`; this one is the map you read first.

**Stack:** plain HTML + vanilla JS (no build step, no framework except React-via-CDN on one
screen) → a Firestore-compatibility shim → **Supabase** (Postgres + Auth + Storage + Realtime).
Deployed on Vercel. An Android TWA wrapper exists but is **not in use by clients** (confirmed
2026-07-12); treat it as dormant, not as a supported surface.

---

## 1. Entry points and audiences

Six HTML pages. Each is a separate app; they share `js/supabase-config.js` and little else.

| Page | Audience | Loads | Notes |
|---|---|---|---|
| `index.html` | Public | `script.js` | Marketing site, appointments, testimonials |
| `admin.html` | **Owner + Staff** | ~19 modules | The whole back office. By far the biggest surface |
| `client.html` | **Design client** | `client-app.js`, `client-payment.js` | BOQ / design-side client portal |
| `Client Management.html` | **Construction client** | `client-management-app.js`, `client-payment.js` | |
| `Dacs Partnership.html` | **Partner** | `client-management-app.js`, `client-payment.js` | Same JS as above, different HTML |
| `share-capture.html` | **Owner + Staff (phone)** | self-contained | PWA **share target** (`manifest-admin.json`). Share a receipt photo from any app → tag it → `expense_inbox` |

> **Client Management.html and Dacs Partnership.html are two live audiences sharing one JS
> file.** An HTML edit made for one usually has to be mirrored into the other. Forgetting is a
> recurring source of bugs.

**Roles.** `profiles.kind` is `admin` | `client` | `construction_client` (the shim splits one
table into three logical collections). Within `admin`, `profiles.role` is `owner` or `staff`.
Within `construction_client`, an `isPartner` flag selects the partner experience.

- **staff** — `window.currentUserRole === 'staff'`. Money is hidden from them across the app
  (`_staff()` in the portal, equivalent checks elsewhere). Percentages are shown instead of pesos.
- **allowed_modules** — narrows an admin account to specific nav sections on every screen.

---

## 2. The Supabase shim — read this before touching any data code

`js/supabase-config.js` exposes the **old Firebase globals** (`db`, `auth`, `storage`,
`firebase.firestore.FieldValue.serverTimestamp()`), so every module still reads like Firestore:

```js
db.collection('payroll').where('userId', '==', uid).onSnapshot(...)
```

…but underneath it is PostgREST. The mapping lives in one place — the **`REG` registry**:

- **collection → table** (`overheadExpenses` → `overhead_expenses`)
- **camelCase → snake_case columns**, automatically (`expenseName` → `expense_name`)
- `rename` overrides (`userId` → `owner_id`)
- `ts` — fields wrapped as Timestamps on read
- `kind` — the profiles split
- `jsonbData` — tables whose fields live in a single `data` jsonb blob
- `children` — nested arrays (e.g. `invoices.items` → `invoice_items`)
- `onSnapshot` is a real Postgres realtime subscription that re-runs the query on change

### The two rules this creates

1. **A new field needs a real column.** Fields map straight to snake_case columns. Write
   `foo: 1` to a table without a `foo` column and the save **fails**. (Unless the table is
   `jsonbData`, where everything goes into the blob.)
2. **A collection whose table is `jsonbData` must be registered as such**, or reads silently
   return empty objects.

---

## 3. The biggest structural fact: TWO parallel project systems

This surprises everyone. There are two unrelated notions of "project":

| | **Project Control** (design/build costing) | **Project Management** (site ops) |
|---|---|---|
| Project row | `folders` | `construction_projects` |
| Sub-unit | `projects` = **billing periods** (confusingly named) | `weekly_bills` (one row **per day**) |
| Costs | `payroll` + `expenses`, tied to a billing period | `weekly_bills.entries` (jsonb) |
| Contracts | `labor_contracts` | `pm_labor_contracts` |
| Overhead | `overhead_expenses.folder_id` | `weekly_bills.overhead` (a Daily Expenses category, since `0035`) |
| UI | `portal-app.compiled.js` (React) | `pm-admin.js` |

**`folders.id` and `construction_projects.id` are different id spaces.** Querying one with the
other's id silently matches nothing — that exact bug lived in the PM delete-cascade for months.
`overhead_expenses.folder_id` is a **`folders`** FK; it never points at a construction project.

The one bridge between them is `construction_projects.folder_id` (`0033`) — **nullable and
opt-in**, set by an admin so labor-contract "paid" totals can be reconciled across the two
ledgers. Most rows are null; it is not a general-purpose join.

PM overhead is a **billable direct cost**: it feeds `direct_cost_total` and the management fee is
charged on it, unlike Project Control overhead. Same word, different behaviour.

Also note: **`projects` means billing period**, not project. Read it that way everywhere.

---

## 4. Module map (admin.html)

| Module | File | What it owns |
|---|---|---|
| Project Control | `portal-app.compiled.js` | Folder grid, per-project cost/profit, drills (labor, material, overhead, periods, additional works) |
| Budget Overview / Expenses | `expenses-module.js` (8.1k lines — the biggest) | Folders, billing periods, payroll, expenses, pakyaw labor contracts |
| Overhead | `overhead-module.js` | Company + project overhead ([OVERHEAD_MODULE.md](OVERHEAD_MODULE.md)) |
| Reimbursement | `reimbursement-module.js` | Client Reimbursement Tracker (`0041`) — expenses the **owner/admin advanced** and whether the **client** paid them back. **Deliberately isolated:** no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Owner-only (staff blocked in nav, switchView and RLS) |
| Project Management | `pm-admin.js` | Construction projects, weekly bills, procurement, milestones, revolving fund |
| Project Closeout | `termination-requests.js` | Ends a construction project — **`completed`** (work finished) or **`terminated`** (stopped early). Same final bill either way (cost-plus: actual costs + fee; `budget` is an estimate, not a price); only the status, badge and client wording differ. Writes `termination_requests`, sets the project status, auto-issues the final invoice via `invGenerateFromCloseout`, notifies the client. **Admin-initiated only** since `0042` — the client's Termination Zone and its RLS insert policy are gone. Owner-only (staff blocked in the UI) |
| Warranty Fund | `warranty-fund.js` | Warranty Retention register + fund (`0043`) — an **internal company reserve**. On completion the company sets aside 5% of the project's remaining cash (`paid − directCost`) to fund warranty work, company expenses and project management; the figure is **frozen at closeout**, accumulates across projects, and draws are recorded against the pool. **Client billing is deliberately not involved** — the company reserves part of its own margin. Tracked, not banked: the pesos stay with normal company funds. Negative net cash contributes zero. **Deliberately isolated** like Reimbursement: no invoice, payment, expense, payroll or journal side effects, no money math reads it, and **a draw charges no project's Spent**. Owner-only (staff blocked in nav, switchView and RLS) |
| Quotations | quotation-module.js, quotation-print.js | Outgoing client quotations (0045) — itemized estimate, revisions, win/loss pipeline, print/PDF. **Deliberately isolated** like Reimbursement and Warranty Fund: no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Marking a quote Won changes a status string and nothing else. Owner-only; staff never see it |
| Accomplishment / BOQ | `boq-module.js` | BOQ + accomplishment reports (`percentCompletion` per line item) |
| Invoices | `invoice-module.js`, `labor-invoice-module.js` | Sales invoice has three outputs: `invPrint` (browser print sheet), `invExportPDF` (real file; jsPDF + autotable + Roboto lazy-loaded from CDN, ~630KB on the first export of a session, cached after), `invExportCSV`. Change the sheet and the PDF together — they are one document. **Roboto is embedded only because jsPDF's built-in faces are WinAnsi and have no `₱`**; if the font fetch fails the export still runs, in Helvetica with `PHP` instead of `₱`. |
| Payment Requests | `payment-requests.js` | |
| Construction (procurement) | `construction-module.js` | Batches, requests, inventory |
| Clients | `client-accounts.js`, `user-navigator.js` | |
| Expense Inbox | `expense-inbox.js` | Shared receipt photos awaiting encoding — serves **both** project systems (`system: 'pc'` / `'pm'`). No amounts stored |
| System Errors | `error-log.js` | **Owner-only** reader for `client_errors`. The reporter is `supabase-config.js` §13 |
| AI | `ai-summary.js`, `ai-assistant.js` | Folder briefings, health check |
| Attendance | `attendance-admin.js` | Construction worker Time In / Time Out (`0050`). **The worker client is a separate native Android app** (Kotlin + Compose, repo `Documents/Dacs Attendance`), **not** the Bubblewrap TWA in `android/` — that one wraps the *client portal* and is untouched. This module is the admin half only. Today's attendance (a LEFT JOIN against active workers, so a worker with no row shows as `No record` rather than vanishing), worker detail with both photos, **worker management** (`attWorkers` — the roster including **deactivated** workers, which Today deliberately hides; deactivating blocks sign-in via `attendance-signin` and is the only route back, so that screen must never filter them out. Shows `email`, which Today does not select, because two workers can share a display name and the email is the only thing that tells them apart), **creating a worker** (the `attOpenNewWorker` modal on that same screen — mints the auth account through the shared `adminCreateUser` helper and the `admin-create-user` Edge Function, never from the browser; `kind` is always `admin` and the role list is **worker / teamLeader only**, because staff, engineer and owner accounts belong to Users → Navigator and a second, less-guarded route to a privileged account is exactly what this must not become. `worker_no` is left out of the payload on purpose — `profiles_worker_no_trg` (0050) assigns it from `worker_no_seq`; `position` is written by a follow-up update because the Edge Function builds its profile row from a fixed whitelist. Terms are **not** pre-signed here: the worker accepts them in the Android app), the projects picker list (**deactivate, never delete** — records reference the project id), and reports with CSV export. The report roll-up and CSV escaping are pure functions guarded by `tests/attendance.test.js`, which extracts them from the live source. **Hours here are never a pay figure** and no rate column exists — do not add one. **Deliberately isolated** like Reimbursement, Warranty Fund and Quotations: no invoice, payment, expense, payroll or journal side effects, and no money math reads it. Attendance hours are **not** the basis of pay — labour is pakyaw, capped by `labor_contracts.agreed_amount`. There is no peso column, so the staff amount-hiding rule does not apply. Workers write only through the `attendance_time_in` / `attendance_time_out` RPCs; they hold no insert or update policy |

**Project Control is compiled React.** See the build trap in §8.

---

## 5. The project lifecycle, end to end

```
1. Folder created                 folders                 (contract amount = folders.totalBudget)
2. BOQ / cost estimate            boq_documents           (costItems tree, jsonb)
3. Billing periods opened         projects                (monthly fund allocations)
   └─ funded by client, or 'president' = cover expense
4. Costs recorded against a period
   ├─ payroll     (labor: direct | indirect | liability)
   ├─ expenses    (materials, with PO/DR/SI/Payment docs)
   └─ labor_contracts  (pakyaw caps; payroll draws down via contractId)
5. Project overhead                overhead_expenses      (folder-level; no billing period)
6. Work accomplished               boq_documents.costItems[].percentCompletion
                                   → % complete → EARNED revenue
7. Billed                          invoices / labor_invoices
8. Client pays                     payment_requests → verified
9. Additional works                child folders (parentFolderId) — extra scope after contract
```

**Additional Works** are child `folders` under a parent folder. They carry their own revenue,
costs and overhead, and roll up into the parent. They deliberately hide billing periods.

---

## 6. The money model

This is the part most likely to be "fixed" wrongly later. All of it lives in
`portal-app.compiled.js`; the rules are stated in full in [OVERHEAD_MODULE.md](OVERHEAD_MODULE.md).

```
Labor Cost   = direct + (liability − liabilityIndirect)
Overhead     = indirect + liabilityIndirect + overhead_expenses
Spent        = Labor + Material + Overhead
Earned       = % complete × contract          ← percentage-of-completion
Gross Profit = Earned − Spent
Net Profit   = Σ recognised project profit − company overhead (G&A)
```

Four invariants, each of which cost real debugging to establish:

1. **Every peso lands in exactly one bucket.** Indirect labor is Overhead, *not* Labor. Statutory
   burden follows the worker it was paid for (a coordinator's SSS is Overhead; a mason's is Labor).
2. **Overhead pay never draws down a pakyaw contract.** Enforced in three places — `lcPaid()`,
   both payroll save paths, and the form.
3. **Profit is measured on EARNED revenue.** Contract-minus-cost-to-date reports a ~90% margin on
   a job that is 10% built. Where there is no accomplishment data the figure falls back to the
   full contract and **must be labelled "Forecast"**, never "Earned".
4. **Company overhead (G&A) is never charged to a job.** It is subtracted once, at company level.
   Projects with no accomplishment data recognise **zero profit** (but losses immediately).

**Cover Expenses** are a separate concept: costs charged to the company because a billing period
had no budget (`fundingType: 'president'`), with a ₱10,000 warning threshold (`COVER_LIMIT`).

**OCM allowance** (`folders.ocm_pct`, `0030`) is what the *contract priced* for overhead — OCM =
Overhead, Contingencies & Miscellaneous, typically 8–12% of the contract in a PH BOQ. It is a
**budget to compare against, not a cost**: the Overhead drill shows "priced ₱X · spent ₱Y (Z%
used)" and flags overruns. It never enters Spent, Earned or Profit. Null/0 = not configured.

---

## 7. Data model at a glance

~48 tables. Grouped:

- **Identity** — `profiles` (3 logical collections), `agreement_events`, `push_subscriptions`
- **Project Control** — `folders`, `folder_budgets`, `projects`, `project_budgets`, `expenses`,
  `payroll`, `labor_contracts`, `overhead_expenses`, `categories`, `additional_works`,
  `reimbursements` (tracking only, `0041` — never read by the money model)
- **Project Management** — `construction_projects`, `weekly_bills`, `procurement_items`,
  `pm_labor_contracts`, `milestones`, `accomplishment_reports`, `daily_logs`, `walkthroughs`,
  `revolving_fund*`, `partner_agreements`,
  `warranty_retentions` + `warranty_fund_expenses` (tracking only, `0043` — never read by the
  money model)
- **Billing** — `boq_documents`, `boq_templates`, `invoices`(+`items`), `labor_invoices`(+`items`),
  `payment_requests`
- **Quotations** — `quotations`, `quotation_revisions`, `quotation_presets` (tracking only, `0045`
  — never read by the money model)
- **Procurement** — `requests`(+`items`), `batches`, `inventory`
- **Intake / ops** — `expense_inbox` (shared receipts pending encoding, `0031`),
  `client_errors` (production error self-reports, `0028`)
- **Misc** — `notifications`, `appointments`, `testimonials`, `sowa_requests`,
  `termination_requests`, `settings`, `stats` (kv tables)

**RLS** is on for every table (`0002_rls.sql`), keyed on `can_access(owner_id)` / `is_owner()` /
`is_staff()`, with client policies matching on email where clients need read access.

---

## 8. Known traps

**The portal build trap.** `js/portal-app.compiled.js` is the **live source of truth** and is
edited **directly**. **Never run `npm run build`** — the `build` script in `package.json` is a
hard-fail stub that refuses to run, and as of 2026-07-28 the stale JSX it built from
(`src/portal-app.jsx.stale-2026-06-03`, `js/dacs-portal/*.jsx`) has been deleted, so there is no
source left to rebuild from.

**Schema drift.** The live database has been patched by hand beyond the migrations more than
once. `0020_schema_drift_catchup.sql` captured one round; `0025` (overhead columns) and `0026`
(`payroll.liability_for`) captured another. Known *uncaptured* drift: `weekly_bills.entries` /
`combined` / `direct_cost_total` / `management_fee_pct` are written by `pm-admin.js` but exist
only in the live DB. **Before adding a field, check the table actually has the column** — the shim
maps camelCase straight to snake_case and the save fails otherwise.

**Migration numbering.** Highest on disk is `0040`; **next number = highest + 1**, never reuse,
never a Supabase SQL-editor one-off. Nine numbers are duplicated (two 0006s, 0016s, 0017s, 0018s,
0019s, 0020s, 0021s, 0022s, 0023s) — each pair was audited and plain filename sort is safe.
**`0034` is a deliberate gap** (written and withdrawn in the same session; see the header of
`0035`). The canonical order and the full duplicate audit live in
[`supabase/migrations/README.md`](../supabase/migrations/README.md).

**Two HTML files, one JS.** Mirror portal HTML edits into both `Client Management.html` and
`Dacs Partnership.html`.

**Staff amount-hiding regresses on merges.** Historically, merges from the `salvs` branch have
reverted the staff money-hiding in portal footers. Re-check after every merge.

**PH timezone.** Never build a local date key with `toISOString().slice(0,10)` — UTC+8 rolls it
back a day. Build from local parts.

**Storage is PRIVATE — don't render stored URLs directly.** Since migration `0027` the
`uploads` bucket is private. The DB still stores the public-format URL as a stable identifier,
and §11b of `js/supabase-config.js` resolves it to a short-lived signed URL transparently — a
global click interceptor for `<a>`, a MutationObserver for `<img>`/`<iframe>` src, and wrapped
`fetch`/`window.open`. New code can just keep using the stored URL in templates; the shim signs
it at the moment of use. What breaks the pattern: assigning a stored URL straight to
`location.href` (use `window.dacsMaybeSignUrl(url)` first — see `print-utils.js` for examples)
or fetching it from a **worker/server** context where the shim isn't loaded.

---

## 9. Verifying a change

No imports, no type checker, no framework — **nothing tells you about the fifth call site.** The
safety net is small and manual:

| Tool | When | What it does |
|---|---|---|
| `npm test` | **After any change to money code** — `portal-app.compiled.js`, `expenses-module.js`, `overhead-module.js` | `tests/money-math.test.js` — 46 checks that extract the live functions and enforce every invariant in §6. Exits 1 on breakage, ~1s |
| `node --check <file>` | Any JS edit | Syntax errors in files the test doesn't cover |
| Browser | Always | `admin.html`, logged in as owner |
| CI | Every push + PR | `.github/workflows/ci.yml` runs both of the above |

If the test fails with **"SLICE NOT FOUND"**, the source was restructured — update the extraction
markers in the test file, **never delete the test**. Red CI on a `salvs` merge usually means the
merge reverted a money rule or the staff amount-hiding.

**When a user says "it broke", query the errors first.** Production errors self-report into
`client_errors` (migration `0028`, reporter in `supabase-config.js` §13), readable in the
**System Errors** panel (`error-log.js`, owner-only) or directly:

```sql
select at, page, kind, message, source, line from client_errors order by at desc limit 100;
```

---

## 10. Where to look next

| Topic | Doc |
|---|---|
| Overhead, the money rules, pakyaw interaction | [OVERHEAD_MODULE.md](OVERHEAD_MODULE.md) |
| Expenses / Budget Overview | [EXPENSES_README.md](EXPENSES_README.md) |
| Project Management module | [PROJECT_MANAGEMENT_MVP.md](PROJECT_MANAGEMENT_MVP.md) |
| Additional Works | [ADDITIONAL_WORKS_ARCHITECTURE.md](ADDITIONAL_WORKS_ARCHITECTURE.md) |
| Pakyaw labor contracts | [labor-contracts-plan.md](labor-contracts-plan.md) |
| Agreement gates (6 of them) | [partnership-agreement-system-alignment.md](partnership-agreement-system-alignment.md) |
| Staff accounts | [STAFF_ACCOUNT_SETUP.md](STAFF_ACCOUNT_SETUP.md) |
| Project Control cost/profit chart | [project-control-chart.md](project-control-chart.md) |
| Field-by-field schema | [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) |
| Migration order + duplicate audit | [../supabase/migrations/README.md](../supabase/migrations/README.md) |
| Android build | [../android/BUILD_APK.md](../android/BUILD_APK.md) |

> Several of those predate the Supabase migration and still say "Firestore" — the *field maps and
> flows* remain accurate; the *storage layer* described in them does not.
