# DAC's Building Design Services — Web System

A construction and design-build management system: a public marketing site, an admin back
office, and three client-facing portals — all plain HTML + vanilla JS talking to Supabase
through a Firestore-compatibility shim.

**No build step.** Open the file, edit it, refresh the browser.

> New to the codebase? Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first — it is the
> conceptual map. This README is the complete inventory of *what exists*.

---

## Contents

1. [Stack & quick start](#1-stack--quick-start)
2. [Entry points](#2-entry-points)
3. [Roles & access control](#3-roles--access-control)
4. [Admin back office](#4-admin-back-office)
5. [Client-facing portals](#5-client-facing-portals)
6. [Public marketing site](#6-public-marketing-site)
7. [Cross-cutting features](#7-cross-cutting-features)
8. [Data layer](#8-data-layer)
9. [The money model](#9-the-money-model)
10. [Backend services](#10-backend-services)
11. [Repository layout](#11-repository-layout)
12. [Testing & CI](#12-testing--ci)
13. [Known traps](#13-known-traps)
14. [Documentation index](#14-documentation-index)

---

## 1. Stack & quick start

| Layer | Choice |
|---|---|
| Frontend | Plain HTML + vanilla JS. React 18 **via CDN** on one screen only (Project Control) |
| Data | **Supabase** — Postgres + Auth + Storage + Realtime |
| Compatibility | `js/supabase-config.js` — exposes the old Firebase globals over PostgREST |
| Libraries (all CDN) | `supabase-js@2` · `react@18.3.1` + `react-dom@18.3.1` · `chart.js@4.4.0` · Lucide · Cloudflare Turnstile |
| Hosting | Vercel (static, `outputDirectory: "."`) |
| Serverless | 2 Cloudflare Workers + 1 Supabase Edge Function |
| Mobile | PWA (installable, share target, web push). An Android TWA wrapper exists but is **dormant** |

```bash
# There is nothing to build. Serve the folder and open a page.
npx serve .          # or VS Code Live Server, or just open the file

npm test             # 46 money-math checks (~1s) — run after ANY money change
node --check js/x.js # syntax check
```

**`npm run build` is intentionally disabled** and exits 1. See [§13](#13-known-traps).

---

## 2. Entry points

Six HTML pages. Each is a separate app; they share `js/supabase-config.js` and little else.

| Page | Audience | Scripts loaded |
|---|---|---|
| [index.html](index.html) | Public | `supabase-config.js`, `script.js` |
| [admin.html](admin.html) | Owner · Staff · Worker · Team Leader | 20 scripts (the whole back office) |
| [client.html](client.html) | **Design client** | `supabase-config.js`, `print-utils.js`, `client-app.js`, `client-payment.js` |
| [Client Management.html](Client%20Management.html) | **Construction client** | `supabase-config.js`, `print-utils.js`, `client-management-app.js`, `client-payment.js` |
| [Dacs Partnership.html](Dacs%20Partnership.html) | **Partner** | same four as above |
| [share-capture.html](share-capture.html) | Owner · Staff (phone) | `supabase-config.js` |

> **Client Management.html and Dacs Partnership.html are two live audiences sharing one JS
> file.** Any HTML edit for one usually has to be mirrored into the other.

---

## 3. Roles & access control

`profiles.kind` splits one table into three logical collections; `profiles.role` sub-divides admins.

| Kind | Role | Where they log in |
|---|---|---|
| `admin` | `owner` | admin.html — sees everything |
| `admin` | `staff` | admin.html — **no peso amounts anywhere** |
| `admin` | `worker` / `teamLeader` | admin.html — Construction section only |
| `client` | — | client.html |
| `construction_client` | — | Client Management.html |
| `construction_client` + `isPartner` | — | Dacs Partnership.html |

**Three layers of gating**, all in [js/admin.js](js/admin.js) and [admin.html](admin.html):

1. **Role filter** — `_visibleNav()` decides which nav sections render.
   Staff lose *Users*, *Client Accounts*, *Reports*; workers/team leaders see only *Construction*.
2. **Route guard** — `switchView()` re-checks on every navigation, so a stale link or hash
   route cannot reach a blocked view.
3. **Module focus** — `profiles.allowed_modules` narrows an admin account to specific
   `PRIMARY_NAV` sections on every screen size (e.g. `admin-pm@` → Project Management only).
   Drill-down sub-views must be registered in `_FOCUS_SUBVIEWS` or they get bounced.

**Staff money-hiding** is enforced separately in each render path — `_staff()` in
`portal-app.compiled.js`, `.staff-budget-view` CSS in Budget Overview, `currentUserRole` checks
elsewhere. Staff see percentages instead of pesos.

Underneath all of it, **RLS is on for every table**, keyed on `can_access(owner_id)` /
`is_owner()` / `is_staff()`, with client policies matching on email.

---

## 4. Admin back office

`admin.html` — 20 content views across 5 primary nav sections plus 3 standalone views.
Registry: `PRIMARY_NAV` in [js/admin.js:2185](js/admin.js#L2185).

### 4.1 Project Control — design/build costing
*Section id `expenses` · default view `dacsPortal`*

| View | File | What it does |
|---|---|---|
| **Overview** (`dacsPortal`) | [portal-app.compiled.js](js/portal-app.compiled.js) | The React portal — folder grid, KPIs, cost/profit, all drills |
| **Reports** (`expReports`) | [expenses-module.js](js/expenses-module.js) | Charts by year/folder/period (monthly · quarterly · yearly). **Owner only** |
| **Overhead** (`expOverhead`) | [overhead-module.js](js/overhead-module.js) | Company + project overhead ledger |
| **Accomplishment** (`boqBuilder`) | [boq-module.js](js/boq-module.js) | BOQ builder + accomplishment reports |
| **Clients** (`clientAccounts`) | [client-accounts.js](js/client-accounts.js) | Design-client accounts. **Owner only** |
| **Payment Requests** (`paymentRequests`) | [payment-requests.js](js/payment-requests.js) | Client billing + SOA |
| **Invoice Receipt** (`invoices`) | [invoice-module.js](js/invoice-module.js) | Sales invoices |
| *Budget Overview* (`expOverview`) | expenses-module.js | Folder/period grid — reached from the portal |
| *Expenses* (`expExpenses`) | expenses-module.js | Per-period cost entry |

**The React portal** ([portal-app.compiled.js](js/portal-app.compiled.js)) — folder grid with
health badges → project page (KPI strip, flow cards, recent entries, contract rollup) → drills:

- **Labor Drill** — payroll transactions, worker tracker, pakyaw contract drawdown
- **Material Drill** — expenses with PO / DR / SI / Payment document pills, search, item detail modal
- **Overhead Drill** — indirect labor + overhead expenses, **OCM allowance** comparison
  (priced vs. spent, overrun flag)
- **Billing Periods Drill** — per-period budget/spent/remaining cards, create · edit · delete
- **Additional Works Drill** — child folders rolled up with their own revenue and costs
- **AI Summarize** — plain-English budget briefing per folder
- **Expense Inbox mount** — pending receipt count, routed per drill

**Budget Overview / Expenses** ([expenses-module.js](js/expenses-module.js), 8.5k lines — the
biggest file) — folders → billing periods → folder detail with three tabs:

- **Materials** — expense entry, search, receipt/document attachments
- **Payroll** — direct · indirect · liability lines, payment method (cash/GCash/bank/cheque),
  lamsam (lump-sum) payroll, worker receipt summary, period attribution
- **Cover** — expenses charged to the company because the period had no budget

Plus **pakyaw labor contracts**: capped folder-level contracts, drawdown math, per-contract
payment ledger, file attachments, worker agreement PDF upload, and an agreement template editor.

**Overhead** ([overhead-module.js](js/overhead-module.js)) — unified company + project overhead.
Every expense carries `scope` (`company` | `project`), category, status (`paid` | `pending`),
supplier/invoice/receipt, and an append-only `history` audit trail. Soft delete via `deletedAt`.
Filters by month, scope, project, category, status, search; charts included.

**Accomplishment / BOQ** ([boq-module.js](js/boq-module.js)) — cost-item tree (group headers →
line items → sub-items) with reordering, division templates, save/apply/delete templates,
photo attachments, `percentCompletion` per line item, status workflow, print + PDF export, and
fill-from-expense. Its % complete is what drives **earned revenue** everywhere else.

**Payment Requests** ([payment-requests.js](js/payment-requests.js)) — create/track requests,
QR payment settings, receipt verification, and **SOA** (Statement of Account) generation with a
client-request queue (`sowa_requests`).

**Invoices** — [invoice-module.js](js/invoice-module.js) (material/sales invoices, line items,
defaults, print) and [labor-invoice-module.js](js/labor-invoice-module.js) (labor invoices built
from PM weekly-bill entries).

### 4.2 Construction — materials & orders
*Section id `construction` · [construction-module.js](js/construction-module.js)*

| View | What it does |
|---|---|
| **Current Batch** | Open procurement batch, request cards, item status updates |
| **Urgent Requests** | Out-of-batch urgent requests, with a live badge |
| **Batch History** | Closed batches with detail view |
| **Inventory** | Stock levels, min-stock, add item, adjust stock (in/out), auto-update on delivery |

Includes its own notification bell/dropdown. This is the section workers and team leaders see.

### 4.3 Project Management — site operations
*Section id `pm` · [pm-admin.js](js/pm-admin.js), 7.3k lines*

| View | What it does |
|---|---|
| **Projects** (`pmProjects`) | Construction project cards, create/edit, per-project Terms PDF, expense-inbox marks |
| **Termination Requests** | [termination-requests.js](js/termination-requests.js) — review, approve, reject client termination requests |
| **Reports** (`pmReports`) | PM's own reports dashboard, reading weekly bills + labor contracts |

Opening a project enters the **Project Workspace** (`pmWorkspace`) — six tabs:

| Tab | Contents |
|---|---|
| **Dashboard Overview** | Per-project KPIs + direct-cost breakdown, with a drill-in data view |
| **Daily Expenses** | Day-by-day bill builder. Four categories: **Labor · Materials · Out Source · Overhead**. Receipt attachments, worker tracker panel, draft/final status, print |
| **Contracts** | PM pakyaw labor contracts + out-source contracts — create, edit, raise cap, delete, per-contract ledger, signed agreement PDF |
| **Procurements** | Item list with est. price vs. actual, bought-by (company/client), receipts, filters |
| **Progress** | Milestones (phase, planned date, weight %, status) + BOQ-style accomplishment reports with a builder |
| **Money** | Next-payment banner, payment requests, **revolving fund** (weekly fund collected from the partner), manual offline payment recording, client self-payment receipt review, per-category SOA |

Also here: **daily push notification** opt-in per project (11:59 PM PHT summary) via
[push-notify.js](js/push-notify.js).

### 4.4 Appointments — workflow
*Section id `appointments` · [admin.js](js/admin.js)*

**Dashboard** (KPI cards + pending counters) · **Appointments** (list, status workflow, client
linkage) · **Analytics** (charts) · **Feedback** (testimonial moderation).

### 4.5 Users — people
*Section id `users` · [user-navigator.js](js/user-navigator.js) — **owner only***

Three tabs: **Employees** (admin/staff/worker accounts) · **Client Management**
(construction clients, admin-provisioned) · **Client Portal** (design clients). Handles account
provisioning, project assignment, `allowed_modules`, and agreement status.

### 4.6 Standalone views

| View | File | Access |
|---|---|---|
| **System Errors** (`sysErrors`) | [error-log.js](js/error-log.js) | **Owner only** — reads the last 200 `client_errors` rows |
| **Labor Invoice** (`laborInvoices`) | [labor-invoice-module.js](js/labor-invoice-module.js) | Reached from the PM workspace |
| **Termination Requests** | [termination-requests.js](js/termination-requests.js) | In the PM nav |

---

## 5. Client-facing portals

### 5.1 Construction client — [Client Management.html](Client%20Management.html)

Nav: **KPI Dashboard · Accomplishment · Milestones · Weekly Billing · Billing ·
Procurement List · Revolving Fund** *(hidden by default)* **· Notifications · Profile**.

Features: multi-project picker (one account can own several projects) with a topbar switcher;
weekly billing grouped Sun–Sat from per-day bills, with a four-category breakdown
(Labor · Materials · **Out Source** — the combined supply-and-install category, stored as
`type: 'both'` / `combined` — · Overhead) plus the management fee; SOA request + print;
procurement item accept/decline and mark-as-bought
with receipt; self-payment with receipt upload; termination request; milestone and photo viewers;
weekly report print.

### 5.2 Partner — [Dacs Partnership.html](Dacs%20Partnership.html)

Same JS, different HTML and a dark theme. Nav drops *Billing* and *Revolving Fund*:
**KPI Dashboard · Accomplishment · Milestones · Weekly Billing · Procurement List ·
Notifications · Profile**. Adds the first-login **Partnership Agreement** e-sign gate with a
downloadable PDF.

### 5.3 Design client — [client.html](client.html)

Nav: **Dashboard · Accomplishment · Billing · Notifications · Documents · Profile**.
BOQ-driven: sees its accomplishment report, invoices, payment requests, and uploaded documents.

**Shared by all three**: [client-payment.js](js/client-payment.js) — payment requests, QR/manual
payment methods, receipt upload, T&C acceptance, and self-pay routing (construction self-pay →
Money → Payment; cost-plus → Payment Requests).

---

## 6. Public marketing site

[index.html](index.html) + [js/script.js](js/script.js) — sections: Home (hero slideshow),
Services (modal detail), Projects (gallery + lightbox), How It Works, About, Philosophy, Values,
Stats (animated counters), Testimonials (live from Supabase), FAQ, and an **Appointment booking
form** that writes to `appointments`. Feedback/testimonial submission included.

---

## 7. Cross-cutting features

**Agreements & e-signature** — six gates in total:
first-login employee agreement (non-owner admin roles) · construction-client agreement ·
**partner Partnership Agreement** · per-project terms *(legacy, clients only)* · per-contract
worker agreement PDF (both project systems) · payment terms & conditions.
Signature capture (tick + typed name + drawn signature), PDF generation via
[print-utils.js](js/print-utils.js), and an append-only `agreement_events` audit log.

**Private storage** — since migration `0027` the `uploads` bucket is private. The DB still stores
the public-format URL as a stable identifier; `supabase-config.js` §11b resolves it to a
short-lived signed URL transparently (click interceptor for `<a>`, MutationObserver for
`<img>`/`<iframe>`, wrapped `fetch`/`window.open`). New code can keep using the stored URL.
Migration `0032` prevents overwrite.

**Print & PDF** — ~20 generators across the app. `print-utils.js` wraps `window.open` once so
**every** printed document comes out grayscale, A4 portrait, with uniform margins — vouchers,
invoices, SOAs, agreements, weekly reports, BOQ reports.

**Expense Inbox** ([expense-inbox.js](js/expense-inbox.js) + [share-capture.html](share-capture.html))
— admin shares a receipt photo from the phone share sheet; it lands in `expense_inbox` tagged by
project and type, and shows as a pending count on the tab where staff encodes it. Stores **no
amounts** and writes nothing into the money tables. Serves both project systems.

**Notifications** — in-app bell (`notifications/items` per user) plus **web push** for the
nightly PM summary, delivered by a Cloudflare cron worker and shown by
[service-worker.js](service-worker.js) even when the app is closed.

**AI** — [ai-summary.js](js/ai-summary.js) (per-folder plain-English budget summary) and
[ai-assistant.js](js/ai-assistant.js) (company-wide daily health briefing: over-budget and
over-cover-limit projects). Facts are computed locally and always accurate; the model only
phrases them. Proxied through a Cloudflare Worker so no API key ships to the browser.

**Error telemetry** — production errors self-report into `client_errors` (`0028`). Query them
first when a user says "it broke":

```sql
select at, page, kind, message, source, line from client_errors order by at desc limit 100;
```

**Captcha** — Cloudflare Turnstile on the auth flows of `admin.html`, `client.html`,
`Client Management.html` and `Dacs Partnership.html`.

**PWA** — `manifest.json` (public) and `manifest-admin.json` (admin, with the `share_target`
declaration). The service worker handles the share POST, push, and notification clicks.

---

## 8. Data layer

### 8.1 The compatibility shim

[js/supabase-config.js](js/supabase-config.js) exposes the **old Firebase globals** (`db`, `auth`,
`storage`, `firebase.firestore.FieldValue.serverTimestamp()`), so every module still reads like
Firestore while PostgREST runs underneath:

```js
db.collection('payroll').where('userId', '==', uid).onSnapshot(...)
```

Fourteen sections: client · camel↔snake helpers · timestamp sentinels · **collection registry** ·
row↔doc conversion · snapshot wrappers · query/collection/doc refs · db facade + batch · auth
facade · firebase.* surface · storage wrapper · **private-URL signing (§11b)** · e-sign evidence
helpers · error telemetry (§13) · globals.

The **`REG` registry** maps collection → table, camelCase → snake_case, plus per-collection
`rename` / `ts` / `json` / `kind` / `children` / `jsonbData` / `kv`. `SUBREG` does the same for
subcollections. `onSnapshot` is a real Postgres realtime subscription.

**Two rules this creates:**

1. **A new field needs a real column.** Write `foo: 1` to a table without a `foo` column and the
   save *fails* — silently, from the caller's perspective.
2. **A `jsonbData` table must be registered as such**, or reads return empty objects.

### 8.2 Tables (46)

- **Identity** — `profiles` (3 logical collections), `agreement_events`, `push_subscriptions`
- **Project Control** — `folders`, `folder_budgets`, `projects` *(= billing periods)*,
  `project_budgets`, `expenses`, `payroll`, `labor_contracts`, `overhead_expenses`,
  `categories`, `additional_works`
- **Project Management** — `construction_projects`, `weekly_bills` *(one row per **day**)*,
  `procurement_items`, `pm_labor_contracts`, `milestones`, `accomplishment_reports`,
  `daily_logs`, `walkthroughs`, `partner_agreements`, `revolving_funds`,
  `revolving_fund_expenses`, `revolving_fund_replenishments`, `revolving_fund_requests`
- **Billing** — `boq_documents`, `boq_templates`, `invoices` + `invoice_items`,
  `labor_invoices` + `labor_invoice_items`, `payment_requests`
- **Procurement** — `requests` + `request_items`, `batches`, `inventory`
- **Intake / ops** — `expense_inbox` (`0031`), `client_errors` (`0028`)
- **Misc** — `notifications`, `appointments`, `testimonials`, `sowa_requests`,
  `termination_requests`, `settings`, `stats` (kv)

Field-by-field detail: [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md).

### 8.3 TWO parallel project systems

The single biggest structural fact. There are two unrelated notions of "project":

| | **Project Control** (costing) | **Project Management** (site ops) |
|---|---|---|
| Project row | `folders` | `construction_projects` |
| Sub-unit | `projects` = **billing periods** | `weekly_bills` (one row **per day**) |
| Costs | `payroll` + `expenses` | `weekly_bills.entries` (jsonb) |
| Contracts | `labor_contracts` | `pm_labor_contracts` |
| Overhead | `overhead_expenses.folder_id` | `weekly_bills.overhead` (billable direct cost) |
| UI | `portal-app.compiled.js` | `pm-admin.js` |

**`folders.id` and `construction_projects.id` are different id spaces.** Querying one with the
other's id silently matches nothing. The only bridge is `construction_projects.folder_id`
(`0033`) — nullable, opt-in, and used solely to reconcile labor-contract totals.

### 8.4 Migrations

`supabase/migrations/` — highest is **`0040`**; next number = highest + 1, never reuse, never a
SQL-editor one-off. Nine numbers are duplicated (audited; filename sort is safe) and **`0034` is
a deliberate gap**. Canonical order: [supabase/migrations/README.md](supabase/migrations/README.md).
RLS checks live in `supabase/tests/rls_checks.sql`.

---

## 9. The money model

```
Labor Cost   = direct + (liability − liabilityIndirect)
Overhead     = indirect + liabilityIndirect + overhead_expenses
Spent        = Labor + Material + Overhead
Earned       = % complete × contract          ← percentage-of-completion, from the BOQ
Gross Profit = Earned − Spent
Net Profit   = Σ recognised project profit − company overhead (G&A)
```

Four invariants — **do not "fix" these**:

1. **Every peso lands in exactly one bucket.** Indirect labor is Overhead, *not* Labor.
   Statutory burden follows its worker: a coordinator's SSS is Overhead, a mason's is Labor.
2. **Overhead pay never draws down a pakyaw contract.**
3. **Profit is measured on EARNED revenue.** With no accomplishment data it falls back to the
   contract and must be labelled **"Forecast"**, never "Earned".
4. **Company overhead (G&A) is never charged to a job.**

Also: **Cover Expenses** (`fundingType: 'president'`, ₱10,000 warning threshold) and the
**OCM allowance** (`folders.ocm_pct`) — a *budget to compare against*, never a cost.

Full reasoning: [docs/OVERHEAD_MODULE.md](docs/OVERHEAD_MODULE.md).

---

## 10. Backend services

| Service | Location | What it does |
|---|---|---|
| **AI proxy** | [cloudflare-worker/](cloudflare-worker/) | Cloudflare Workers AI behind an origin allowlist — keeps the API key out of the browser |
| **Nightly push** | [cloudflare-worker-notify/](cloudflare-worker-notify/) | Cron at 15:59 UTC (11:59 PM PHT): computes each opted-in project's numbers and sends Web Push (RFC 8291 + VAPID, no npm deps) |
| **Admin create user** | `supabase/functions/admin-create-user/` | Edge function for provisioning accounts with the service-role key |

---

## 11. Repository layout

```
├── index.html, admin.html, client.html,
│   Client Management.html, Dacs Partnership.html, share-capture.html
├── js/                 24 modules, ~45k lines (see §4–§5)
├── css/                21 stylesheets, one per module/screen
├── docs/               architecture + per-module documentation
├── supabase/
│   ├── migrations/     0001 … 0040 (+ README with the canonical order)
│   ├── functions/      admin-create-user edge function
│   └── tests/          rls_checks.sql
├── cloudflare-worker/          AI proxy
├── cloudflare-worker-notify/   nightly push cron
├── tests/              money-math.test.js
├── tools/
│   ├── migrate/        one-off Firebase→Supabase import + security check
│   └── boq-import/     BOQ seed scripts
├── android/            Android TWA — dormant, self-contained (see android/BUILD_APK.md)
└── service-worker.js, manifest.json, manifest-admin.json, vercel.json
```

There is **no `src/`**. The portal has no JSX source any more — see §13.

`.well-known/assetlinks.json` stays at the repo root even though it is Android-only: it has to be
served from that exact URL path to work at all.

**One thing worth cleaning up:**

- `admin.html` loads the **development** build of React DOM
  (`react-dom@18.3.1/umd/react-dom.development.js`) — larger and slower than
  `react-dom.production.min.js`, on the app's heaviest screen.

---

## 12. Testing & CI

| What | Command | Covers |
|---|---|---|
| Money math | `npm test` | 46 checks that extract the live functions from `portal-app.compiled.js`, `expenses-module.js` and `overhead-module.js` and enforce every invariant in §9. ~1s, exits 1 on breakage |
| Syntax | `node --check <file>` | Everything the test doesn't reach |
| CI | `.github/workflows/ci.yml` | Both of the above, on every push and PR |

If the test fails with **"SLICE NOT FOUND"**, the source was restructured — update the
extraction markers in the test file, **never delete the test**.

Then check it in the browser: `admin.html`, logged in as owner. Red CI on a `salvs` merge
usually means the merge reverted a money rule or the staff amount-hiding.

---

## 13. Known traps

**The portal build trap.** [js/portal-app.compiled.js](js/portal-app.compiled.js) is the **live
source of truth** and is edited **directly** (readable, non-minified JS). **Never run
`npm run build`** — the script is a hard-fail stub, and as of 2026-07-28 the stale JSX it used to
build from (`src/portal-app.jsx.stale-2026-06-03` and `js/dacs-portal/*.jsx`, both a month or more
behind the live portal) has been **deleted**, so there is nothing left to rebuild from. If a real
JSX pipeline is ever wanted again, the compiled file must first be back-ported into JSX and
verified feature-by-feature against the live portal.

**A new data field needs a real DB column.** The shim maps camelCase straight to snake_case.
Check the table first and add a migration. The live DB has drifted from the migrations before —
`weekly_bills.entries` / `combined` / `direct_cost_total` / `management_fee_pct` still exist only
in the live database.

**This repo fans out.** No imports, no type checker, nothing tells you about the fifth call site.
Before writing code, grep for every place the thing is **saved, rendered, printed and exported**.
Tracer: `payroll.payment_method` landed in seven files.

**Mirror portal HTML edits** into both `Client Management.html` and `Dacs Partnership.html`.

**`folders.id` ≠ `construction_projects.id`.** Two id spaces; the wrong one matches nothing.

**`projects` means "billing period"**, not project.

**PH timezone.** Never `toISOString().slice(0,10)` for a local date key — PH is UTC+8 and it
rolls back a day. Build from local parts.

**Staff must not see peso amounts anywhere** — and this specific rule has regressed on merges
before. Re-check after every merge.

**Adding a nav section?** `PRIMARY_NAV` → **`_FOCUS_SUBVIEWS`** *(the one that gets missed)* →
the `*_VIEWS` group in `admin.html` → `_visibleNav()` role filter → section markup + script tag →
RLS policies → the module map in `docs/ARCHITECTURE.md`.

---

## 14. Documentation index

| Topic | Doc |
|---|---|
| **Architecture — read first** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Working rules for this repo | [CLAUDE.md](CLAUDE.md) |
| Overhead, money rules, pakyaw interaction | [docs/OVERHEAD_MODULE.md](docs/OVERHEAD_MODULE.md) |
| Expenses / Budget Overview | [docs/EXPENSES_README.md](docs/EXPENSES_README.md) |
| Project Management module | [docs/PROJECT_MANAGEMENT_MVP.md](docs/PROJECT_MANAGEMENT_MVP.md) |
| Additional Works | [docs/ADDITIONAL_WORKS_ARCHITECTURE.md](docs/ADDITIONAL_WORKS_ARCHITECTURE.md) |
| Pakyaw labor contracts | [docs/labor-contracts-plan.md](docs/labor-contracts-plan.md) |
| Project Control cost/profit chart | [docs/project-control-chart.md](docs/project-control-chart.md) |
| Agreement gates | [docs/partnership-agreement-system-alignment.md](docs/partnership-agreement-system-alignment.md) |
| Staff accounts | [docs/STAFF_ACCOUNT_SETUP.md](docs/STAFF_ACCOUNT_SETUP.md) |
| Field-by-field schema | [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) |
| Migration order + duplicate audit | [supabase/migrations/README.md](supabase/migrations/README.md) |
| Folder structure | [§11](#11-repository-layout) of this README |
| Git workflow | [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) |
| Android build | [android/BUILD_APK.md](android/BUILD_APK.md) |

> Several docs predate the Supabase migration and still say "Firestore" — their *field maps and
> flows* remain accurate; the *storage layer* they describe does not.
