# Project Management Profit Sharing — MVP Specification

Date: 18 October 2026
Status: **Design approved by the owner (18 Oct 2026), including the review corrections.** Ready
for an implementation plan. Implementation plan: `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`.
**Prerequisite for the mapping migration:** owner verification of the six projects in §4.6.

## 1. Purpose

Give the owner one dashboard showing the combined profit-sharing figures for completed Project
Management projects, with separate owner and partner amounts and a clear explanation of every
project's contribution.

This is an **internal allocation report** based on client collections. It is not Project
Control's earned-profit report, a payout ledger, a statement of amounts owed, or proof that either
party has received money.

## 2. Confirmed decisions

Confirmed by the owner on 18 October 2026.

**Business basis**

- The arrangement actually used with partners is: **remaining client cash after project costs and
  the warranty reserve, divided by each project's agreed percentages.**
- Each project has an owner percentage and a partner percentage totalling exactly 100%.
- Projects without a saved arrangement are 50% owner / 50% partner until the main owner changes it.
- Management fee remains a separate project setting controlling client billing only.

**Release shape**

- **Release 1 = Phase A + Phase B.** Phase A: sharing settings, change history and one shared
  calculation behind every existing screen. Phase B: the combined completed-project dashboard.
- **Phase C (partner portal display) is excluded** until a separate visibility decision is made.

**Authority**

- **Only the main owner changes percentages**, and only for a project mapped to that owner's
  company. **Main owner = `profiles.role = 'owner'` and `profiles.owner_id is null`.** Both fields
  are guarded against change by any signed-in caller (live `profiles_guard`, BEFORE UPDATE), and
  the design relies on them **only while that protection is verified** (§4.1 gate). The caller
  must also have a profile row and an **active** account (`status = 'active'`, null counts as
  active, the 0094 convention). `allowed_modules` is **never** used to decide authority, because
  any account can edit its own list and any owner or staff can edit others' (finding F5).
  Clearing `allowed_modules` never grants sharing-edit authority.
- PM-focused owner accounts (e.g. `admin-pm@`) **view** the split, dashboard and reports; they
  cannot edit.
- Staff are excluded from every new sharing and reserve display (see §9).
- The main owner may change a **completed** project's split, with a required reason and full
  history. That change never implies partner acceptance and never alters client billing.

**Reserve**

- Completed projects use the **recorded** Warranty Fund contribution on every screen (§5.3).

**Partner agreement**

- Release 1 is an internal report: **no partner acceptance workflow**, and nothing implies an
  allocation is a payout or an amount owed.
- Existing signatures stay separate and do not prove acceptance of a project's percentage.
- The Partnership Agreement text stays unchanged. Its wording mismatch is flagged for later review
  (§12, finding F1).

**Grouping**

- A project without a partner email groups under **Partner unassigned**. The client is never
  treated as the partner, even though older code falls back `partnerEmail || clientEmail`
  (`js/pm-admin.js` ~1599).

**Corrections to the current screens**

- Retention is floored at zero everywhere. Today four sites compute `netCash × 5%` unfloored, so a
  loss produces a negative retention that makes the shortfall look **smaller**: −₱100,000 cash
  shows −₱47,500 each today and −₱50,000 each once corrected. The changed figures are explained on
  screen (§7).

This document does not establish legal partnership or loss-sharing terms.

## 3. Scope

### Included in Release 1

1. Private, audited per-project sharing settings (Phase A).
2. One shared calculation used by PM Overview (initial render and refresh), Overview print and
   Reports (Phase A).
3. Project Management → **Profit Sharing** dashboard of completed projects, with project details,
   chart, Print/PDF and CSV (Phase B).

### Excluded

- Partner portal display of shares (Phase C), and any partner acceptance workflow.
- Recording distributions, payout receipts, paid-out amounts or remaining partner payables.
- Multiple partners on one project; the MVP follows the existing single `partnerEmail`.
- Automatically creating payments, invoices, expenses or accounting entries from a share.
- Changing client management-fee billing rules or existing closeout invoice behavior.
- Changing Project Control's Spent / Earned / Profit calculations.
- Deducting company G&A or warranty-fund draws from project costs.
- Interpreting negative project cash as a collectible partner debt.
- Replacing, re-signing or editing existing partner terms, agreement text and PDFs.
- Active projects on the dashboard. They keep their labelled estimate on their own Overview.
- Fixing the broader staff exposure on PM Overview (finding F2, §12). It is a separate change.

## 4. Storage and server rules (Phase A)

Why a side table: `construction_projects` is readable **and writable** by every owner and staff
account (`cproj_admin … for all using (is_owner() or is_staff())`, `0002_rls.sql:162`), and
clients/partners read their own rows. A column on that row would expose and allow edits to the
split. Live check (18 Oct): all 6 projects have `owner_id` null, so the project row cannot prove
which company owns it.

The migration takes the next free number (highest + 1; local highest is 0097 at review — recheck
locally **and** live before assigning).

### 4.1 `pm_project_companies` — trusted project → company mapping

| Column | Notes |
|---|---|
| `project_id` | uuid PK, FK `construction_projects(id)` on delete cascade |
| `company_owner_id` | uuid not null — the main owner's account id |
| `mapped_by` | uuid, actor |
| `mapped_at` | timestamptz default now() |
| `source` | `'owner_verified'` (existing projects) or `'created'` (insert trigger) |

- "Company" means the main owner's account: for the main owner it is their own id; for a focused
  owner or staff it is `profiles.owner_id`, which must point to a main owner. Live (18 Oct): one
  full owner (no `owner_id`), one focused owner whose `owner_id` points to the main owner, one
  staff.
- **One server helper resolves the caller's company** (used by reads, `pm_set_sharing` and the
  insert trigger). It refuses when: there is no profile row (`PROFILE_MISSING`); the account is
  not active (`INACTIVE`); the role is not owner/staff; or the company link is invalid
  (`BAD_COMPANY_LINK`). The link is invalid when `owner_id` is set but its target profile is
  missing, is not `role = 'owner'`, itself has an `owner_id`, or is not active.
- **Existing projects:** the owner first verifies the six projects listed in §4.6. The migration
  then maps **those explicit IDs**, never "all projects". Owner verification is recorded only after
  it has actually happened. **This verification is a prerequisite for the mapping migration.**
- **New projects:** a `construction_projects` insert trigger maps the project to the creator's
  company, derived on the server from `auth.uid()` and the trusted `profiles` relationship. If the
  company is missing or ambiguous, **the insert is rejected**. The browser cannot supply or
  override the mapping. Before implementation, verify every current creation path (owner,
  admin-pm@, staff) derives a company. A staff account with null `owner_id` would now be refused.
- **Gate on the trigger:** it is built only after the plan re-verifies, live, that no
  unauthorized caller can change `profiles.role` or `profiles.owner_id`. That means checking the
  update guard (`profiles_guard`), the insert policy (self-insert limited to role null/`client`),
  and the service-role user-creation path. The 18 Oct check found both fields guarded on UPDATE
  for every signed-in caller. If that changes, the trigger is not a trusted ownership source and
  must not ship.
- `pm_set_sharing` **never creates** a mapping. An unmapped project is refused
  (`PROJECT_UNMAPPED`, UI: "Project not linked to a company — sharing locked").
- No direct insert, update or delete policy for clients. Select only for owner-role accounts of
  the same company.

### 4.2 `pm_sharing_agreements` — the current split

| Column | Notes |
|---|---|
| `project_id` | uuid PK, FK `construction_projects(id)` on delete cascade (current state only) |
| `company_owner_id` | uuid not null, server-stamped from the mapping |
| `partner_pct` | `numeric(5,2) not null check (partner_pct between 0 and 100)` |
| `version` | int not null, starts at 1, +1 on every change |
| `updated_by`, `updated_at` | server-stamped |

- One canonical stored value. Owner % = `100 − partner_pct`, derived on read.
- **No row means 50/50**, computed on read. Nothing is back-filled, so no history is invented.

### 4.3 `pm_sharing_changes` — append-only history

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `project_id` | uuid, **plain value, no foreign key**: survives project deletion and still identifies it |
| `project_name_snapshot`, `client_name_snapshot` | copied at change time |
| `company_owner_id` | server-stamped |
| `old_pct`, `new_pct` | numeric(5,2); `old_pct` = 50 when the old value was the implicit default |
| `old_was_default` | boolean |
| `reason` | text not null, non-blank after trim |
| `actor_id`, `actor_email` | server-stamped from the session |
| `changed_at` | timestamptz default now() |

Select only for owner-role accounts of the same company. **No insert, update or delete policy**;
rows are written only inside `pm_set_sharing`.

### 4.4 `pm_set_sharing(p_project uuid, p_partner_pct numeric, p_expected_version int, p_reason text)`

`security definer`, fixed `search_path`, executable by `authenticated` only. In order:

1. Caller must have a profile (`PROFILE_MISSING`), be active (`INACTIVE`), and be the **main
   owner**: `role = 'owner'` and `owner_id is null` (`OWNER_ONLY`). `allowed_modules` is not read.
2. **Lock the project row** (`select … from construction_projects … for update`) so a first save
   without an agreement row is serialised too. Then lock the agreement row if it exists.
3. The project must be mapped, and its `company_owner_id` must equal the caller's company → else
   `PROJECT_UNMAPPED` / `WRONG_COMPANY`.
4. Validate the **raw** `p_partner_pct` (unconstrained `numeric` parameter) **before** any
   storage: not null, finite, 0–100, and `p_partner_pct = round(p_partner_pct, 2)` → else
   `BAD_PCT`. `numeric(5,2)` would silently round 40.123 to 40.12, so the function rejects it
   before that can happen. The form rejects more than 2 decimals too, and sends the typed value
   unrounded.
5. Version check: current version (0 when no row) must equal `p_expected_version` → else `STALE`
   (UI: "This split was changed by someone else — reload.").
6. If the new value equals the current value (implicit 50 when no row): **no-op**. Return
   `{changed:false}` and write no history.
7. Otherwise require a non-blank `p_reason`, **including** moving away from the implicit 50/50 →
   else `REASON_REQUIRED`.
8. Upsert the agreement (version + 1) **and** insert the history row in the same transaction.
   Return `{changed:true, version}`.

The create form pre-fills the reason "Set when the project was created". The server still treats
it as a required reason.

### 4.5 Reads

- Agreements and history are read by owner-role accounts through RLS filtered by company mapping.
  Only `js/pm-sharing.js` (and the dashboard through it) reads them.
- Warranty data is read only through a new read-only function in `js/warranty-fund.js`,
  `WF.reserveFor(projectIds)`, returning per project: `contributedAmount` (rounded to centavos —
  live data holds values like `5724.900000000001`), `status`, `deleted`, `totalPaid` and
  `directCost` at closeout, `completedAt`, `refNo`. No other module queries warranty tables.
- Partner acceptance facts come from the partner's profile (`partnerAgreementAccepted`,
  `partnerAgreementAcceptedAt`, `partnerAgreementDocVersion`) — see §8.

### 4.6 Existing projects to verify before mapping (live, 18 Oct 2026)

| ID | Project | Client | Status | Closed | Created |
|---|---|---|---|---|---|
| `6236abf5-4f32-4bee-a0d0-8aa738a6a5b0` | Los Churreros | Vincent Cruz | completed | 2026-08-02 | 2026-06-17 |
| `4b22ede3-180f-415b-b793-9998d34e0aec` | Los Churreros | Vincent Cruz | completed | 2026-08-02 | 2026-06-29 |
| `732f858e-603d-477e-b88f-3049ca421bea` | Los Churreros System Plus | Vincent Cruz | ready | — | 2026-09-01 |
| `49426a37-cca0-4eba-ba5f-e6bb48729872` | Los Churreros Crossroad | Vincent Cruz | ready | — | 2026-09-05 |
| `f18d349b-133e-4908-9bdc-30c2741fbfca` | Los Churreros Baliuag | Vincent Cruz | pending_agreement | — | 2026-09-26 |
| `a62714db-fa03-47c9-81ef-6067f4adf6e5` | Los Churreros SM North Dining Extention | Vincent Cruz | pending_agreement | — | 2026-10-12 |

The two completed "Los Churreros" rows are **treated as separate records pending owner
verification**. Different figures (WR-2026-0001: ₱280,000 collected, ₱188,950 cost; WR-2026-0002:
₱400,000 collected, ₱285,502 cost) do not prove both are intentional. Each is kept distinct by
UUID, and screens tell same-named projects apart (§7.2). **All six company mappings remain
unverified until the owner confirms them.** Re-query this list immediately before writing the
migration.

## 5. Calculation contract — `js/pm-sharing.js`

Pure functions, no database writes. Used by Overview, Overview print, Reports, the dashboard, its
print and its CSV. **Each project is calculated on its own first; only then are projects
combined** — on the dashboard and in Reports, including their review flags.

```text
Collected cash    = existing PM payment-receipt calculation (unchanged semantics)
Project costs     = existing PM direct-cost calculation, incl. billable site overhead
Remaining cash    = Collected − Costs
Reserve           = see §5.3 (never negative)
Sharing balance   = Remaining cash − Reserve
Partner amount    = round2(Sharing balance × partner_pct / 100)
Owner amount      = Sharing balance − Partner amount
```

### 5.1 Collections and costs

- The receipt and cost rules are **lifted from the existing Overview/Reports code without
  changing their meaning**. Audit those paths first. If Overview and Reports disagree today, record
  it and decide explicitly; never change it silently. Payment verification semantics do not change.
- Management fee is charged on billable direct costs, including site overhead. Historical bills
  keep their stored fee; nothing is repriced at the current %.
- Supply-and-install is already inside stored materials and is counted once.
- Honor legacy bill fallbacks; test bills without `directCostTotal`, including bills with overhead.
- Procurement and revolving-fund records are not added as costs or collections just because they
  exist. Trace their existing effect first.
- PM uses `construction_projects` ids. Never join them to `folders` ids.

### 5.2 Rounding

Work in integer centavos. Partner amount = the balance × % rounded half away from zero to the
centavo. Owner amount = balance − partner amount, so the two always equal the rounded balance.
Combined totals sum the rounded per-project amounts. Never apply an averaged % to a combined
balance.

### 5.3 Reserve

| Project state | Reserve used | Label / flag |
|---|---|---|
| Completed, recorded row, not void, not deleted | `contributedAmount` (₱0 is valid, not missing) | "Recorded at closeout" |
| Completed, no row / void / deleted | provisional `max(0, Remaining × 5%)` | **Reserve needs review**. Excluded from confirmed totals; the only exclusion reason |
| Not completed | `max(0, Remaining × 5%)` | **"Estimate"**. Never in completed totals |

- The recorded reserve is **frozen**. Collections or costs after closeout change the sharing
  balance, not the reserve. When current paid or cost differs from the closeout `totalPaid` /
  `directCost`, show **"Collections/costs changed since closeout"**.
- Warranty draws never become project costs and never reduce the contribution used here.

**"Needs review" defined once:** a completed, authorized project is excluded from confirmed totals
**only** when its reserve data is unresolved (no row, void or deleted). **Unpaid client balance,
Shortfall and Changed since closeout are warning chips only**; those projects stay in confirmed
totals.

### 5.4 Shortfalls

- A negative sharing balance is a **Shortfall**, shown in red, never "owed", "debt" or "payout".
- Positive balances add to **Available for sharing**, negative ones to **Cash shortfall**, and
  both, signed, to **Net sharing balance**. No offset or collection is created.

## 6. Phase A — screens

### 6.1 Project form (create and edit, `admin.html` PM project modal + `js/pm-admin.js`)

- A **new, separate "Financial agreement" section** after the existing Management fee box
  (`admin.html` ~5526). The fee box is untouched.
- Fields: **Your share %** and **Partner share %**, linked so typing one updates the other.
  Help text: *"Fee changes what the client is billed. Shares divide the cash left after costs and
  the warranty reserve."*
- On edit, changing the % shows a required **Reason**. The change history appears below: date,
  who, old → new, reason.
- Main owner (`role = 'owner'`, no `owner_id`): editable. Owner with an `owner_id` (PM-focused):
  read-only. The server decides either way. **Staff: the section is not rendered** (not
  just hidden with CSS); their existing form and fee workflow is unchanged.
- Save order: save the project as today, then call `pm_set_sharing` **only if the % changed**.
  The sharing save never runs fee rebilling. On sharing failure: *"Project saved; sharing not
  saved — still X/Y."* After success, refresh the active project and any open report state.

### 6.2 Overview, Overview refresh, Overview print, Reports

The four sites (`js/pm-admin.js` ~522, ~958, ~1075, ~9193 on 18 Oct) all switch to `pm-sharing.js`:

- **Warranty reserve** card: recorded / provisional / estimate per §5.3, with its flags.
- **"Profit Share" (one party's half) is replaced by "Sharing balance"**: *Your share ₱ (x%)* and
  *Partner ₱ (y%)*, with Shortfall labelling. Caption, also in print: *"Internal allocation — not
  a payout."*
- A short note on screen explains that retention is now floored at zero, for projects where that
  changes the figure.
- Reports calculates each project separately, then combines amounts **and** review flags.
- Staff never receive the new sharing or reserve cards. They are not rendered for staff. Reports'
  KPI row and print are already staff-blocked (`pm-admin.js` ~9045, ~9395).

## 7. Phase B — Profit Sharing dashboard

### 7.1 Placement and access

- `PRIMARY_NAV` → Project Management → **Profit Sharing** (view `pmSharing`). Added to
  `_FOCUS_SUBVIEWS` so PM-focused owners can open it. Hidden for staff in `_visibleNav` (like
  `warrantyFund`), and the view **refuses to render for staff** if reached directly. Matching
  `*_VIEWS` entry in `admin.html` and the `switchView()` path.
- Project details open in a side panel inside the same view, so there is no extra view to guard.

### 7.2 Loading

1. Read the caller's **authorized project mappings** first (RLS-filtered).
2. Fetch projects, bills, payment requests, reserves (`WF.reserveFor`), agreements and history
   **only for those mapped projects**.
3. Compute per project, then combine.

- Every request carries a request number. A response that arrives after a newer one started is
  discarded, so rapid filter changes never show stale results.
- Any failed read shows an error panel with Retry. **Totals are never drawn from partial data**,
  and a failure never looks like a ₱0 report. Empty and loading states are distinct.
- Same-named projects are distinguished by completion date and a short id (e.g. `· 6236ab`).

### 7.3 Filters

Default: **Completed · All completion dates · All partners.** Completed projects only.

- Completion date (`terminatedAt`): All / range / **Undated only**. It selects projects, not
  transactions, so each project's lifetime receipts and costs are kept. Undated projects stay
  visible under All. `updatedAt` or the start date are never used instead.
- Partner: All / each partner email / **Partner unassigned**.
- Search: project or client name.

### 7.4 Summary cards — confirmed projects only

Projects (*n confirmed · m with reserve needing review*) · Client cash collected · Project costs · Recorded
warranty reserve · **Available for sharing** · **Cash shortfall** · **Net sharing balance** ·
**Your allocation** · **Partner allocation** (shortfall portions shown separately) · Outstanding
client balance. Caption on every card group: *"Internal allocation — not a payout or amount owed."*

### 7.5 Project table

| Column | Meaning |
|---|---|
| Project / client | Name, plus completion date and short id when names repeat |
| Partner | `partnerEmail`, or **Partner unassigned** |
| Completion date | `terminatedAt`, or "Undated" |
| Collected | Lifetime eligible client receipts |
| Costs | Lifetime project costs |
| Remaining cash | Collected − costs |
| Warranty reserve | Recorded, or provisional (marked) |
| Sharing balance | Remaining − reserve |
| Your % / amount | Project-specific |
| Partner % / amount | Project-specific |
| Client balance | Existing PM outstanding balance, definition shown |
| Review status | **One or more chips:** Ready · Unpaid client balance · Shortfall · Reserve needs review · Changed since closeout |

- Chips **can coexist** (e.g. *Unpaid client balance* + *Changed since closeout*). *Ready* appears
  only when no other chip applies.
- **Reserve-needs-review projects sit in their own section below** with figures marked
  *Provisional*, and never count in the summary cards. Projects with only warning chips (Unpaid
  client balance, Shortfall, Changed since closeout) stay in the main table and the totals (§5.3).

### 7.6 Chart

One horizontal bar per confirmed project, split into your part and the partner's part. Shortfalls
extend left of zero in red. Drawn from the same result object as the table and cards.

### 7.7 Project details panel (read-only)

1. Collected, with the payment records.
2. Costs: labor, pure materials, supply & install (counted once), billable site overhead.
3. Remaining cash.
4. Reserve: recorded amount, closeout cash and cost, "changed since closeout" when it applies.
5. Sharing balance, both percentages, both amounts.
6. Outstanding client balance.
7. Split history: old → new, who, when, reason.
8. Partner acceptance facts (§8).

No control in the panel creates any financial record.

### 7.8 Print / PDF and CSV

- Both are built from the **same result object** as the screen.
- Header: filters, basis line, as-of date and time, and the internal-allocation label. The
  needs-review section is included and marked.
- CSV: one row per project, a totals row, and a short header with the same information.
  **Formula protection applies to text cells only** (a text cell starting with `= + - @`, tab or
  CR is prefixed with `'`). **Monetary cells stay real numbers**, so negative values are kept
  as negative numbers.

### 7.9 Worked example

Both projects have valid recorded reserves:

| Project | Remaining cash | Reserve | Sharing balance | Owner % | Owner amount | Partner % | Partner amount |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | ₱800,000 | ₱40,000 | ₱760,000 | 60% | ₱456,000 | 40% | ₱304,000 |
| B | ₱500,000 | ₱25,000 | ₱475,000 | 50% | ₱237,500 | 50% | ₱237,500 |
| **Total** | **₱1,300,000** | **₱65,000** | **₱1,235,000** | — | **₱693,500** | — | **₱541,500** |

These are allocations based on collections, not evidence of distributions.

## 8. Partner acceptance facts

- Acceptance is stored **per partner account, not per project**, and never records a percentage.
  It is held in `partnerAgreementAccepted`, `partnerAgreementAcceptedAt` and
  `partnerAgreementDocVersion` (`js/client-management-app.js` ~4883).
- Show only what those records support, e.g. *"Partnership Agreement v3 accepted 12 Aug 2026.
  This acceptance record does not capture a project sharing percentage."* Never claim what the
  signed document itself contains; the live agreement text was not checked. If nothing is
  recorded, show *"No Partnership Agreement acceptance on record."*
- When the split's last change is after the latest recorded signature, show *"Split changed after
  last signed agreement."*
- Never word any of these as acceptance of the split.

## 9. Permissions summary

| Who | Settings | Dashboard / Reports sharing | History |
|---|---|---|---|
| Main owner | View + edit (own company) | View, print, CSV | View |
| PM-focused owner (admin-pm@) | View only | View, print, CSV | View |
| Staff | Not rendered; no DB access | Not rendered; nav hidden; direct view refused; no DB access | No access |
| Client / partner | No access | No access (Phase C excluded) | No access |

Staff restrictions hold through navigation, direct view entry, export handlers **and** database
requests. The Buyer purchasing exception does not apply here.

## 10. Affected files

| File / area | Change |
|---|---|
| New migration (next free number) | `pm_project_companies` + insert trigger, `pm_sharing_agreements`, `pm_sharing_changes`, RLS, `pm_set_sharing`, explicit mapping of the §4.6 ids |
| `js/pm-sharing.js` (new) | Pure calculation, aggregation, rounding, flags; reads of agreements/history |
| `js/pm-sharing-dashboard.js` (new) + styles | Dashboard, filters, details, chart, print, CSV |
| `js/warranty-fund.js` | `WF.reserveFor(ids)`, read-only; closeout writes unchanged |
| `js/pm-admin.js` | Form section, save path, four calculation sites, Reports per-project combine |
| `admin.html` | Form markup, dashboard view markup, script tags, `*_VIEWS` entry |
| `js/admin.js` | `PRIMARY_NAV`, `_FOCUS_SUBVIEWS`, `_visibleNav` staff filter |
| `js/termination-requests.js` | Review only (closeout stamp and reserve hand-off). No sharing math there today |
| `js/supabase-config.js` | `REG` entries only if the new tables are read through the shim |
| `tests/pm-sharing.test.js` (new) + `package.json` | See §11 |
| SQL check script (run via MCP `execute_sql`) | Server function and policy checks, §11 |
| `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md` §4, `docs/PROJECT_MANAGEMENT_MVP.md` | New tables, module, sharing basis |
| `CLAUDE.md` money invariants | One entry: sharing is an internal allocation outside Spent/Earned/Profit |

`js/client-management-app.js`, `Client Management.html` and `Dacs Partnership.html` are **not
changed** in Release 1 (Phase C). Repeat repository searches immediately before editing.

## 11. Tests and acceptance criteria

**Calculation tests (`tests/pm-sharing.test.js`)**

- [ ] Worked example gives exactly ₱693,500 owner and ₱541,500 partner.
- [ ] −₱100,000 remaining cash → reserve ₱0, −₱50,000 each, labelled Shortfall.
- [ ] Mixed percentages are calculated per project before combining; 0/100, 100/0 and decimal %
  work.
- [ ] Centavo amounts reconcile per project and across the report; float-noisy reserves round
  cleanly.
- [ ] Recorded ₱0 reserve accepted; missing / void / deleted reserve → needs review, excluded from
  totals.
- [ ] Changed-since-closeout flag; chips coexist. Projects with only Unpaid client balance,
  Shortfall or Changed-since-closeout chips **stay in** confirmed totals.
- [ ] Legacy bills (no `directCostTotal`, with overhead) and supply-and-install are counted once.
- [ ] **All four existing calculation sites produce the correct actual results** on shared
  fixtures, driven by executing the live functions (money-math.test.js style extraction). A source
  check alone is not enough.
- [ ] The extracted receipt/cost rules match the old Overview and Reports results on the same
  fixtures.
- [ ] Dashboard: undated and partner-unassigned filters; a stale response is discarded; a failed
  read never yields ₱0 totals; CSV escapes text cells only and keeps negative numbers numeric;
  staff get nothing from the loader.

**Server checks (SQL script)**

- [ ] **Write:** staff, focused owner, client and partner calls to `pm_set_sharing` are refused,
  and none of them can insert, update or delete agreements, history or mappings directly.
- [ ] **Read:** the main owner and the focused owner **can** read agreements and history for
  their own company's mapped projects. Staff, client and partner read nothing. An owner of another
  company reads nothing.
- [ ] A focused owner who clears its own `allowed_modules` is **still** refused writes (authority
  comes from `owner_id`, not the module list).
- [ ] Missing profile, inactive main owner, and focused owner / staff whose `owner_id` points to
  a missing, non-owner, linked or inactive profile are refused, for reads, writes and project
  creation.
- [ ] Wrong company and unmapped project are refused. `pm_set_sharing` never creates a mapping.
- [ ] Project insert with no derivable company is rejected. The browser cannot set the mapping.
- [ ] Stale version is refused. Two concurrent first saves on a project with no row cannot both
  succeed.
- [ ] Same-% save writes no history. Blank reason is refused, including from the implicit 50/50.
- [ ] Invalid % (null, NaN, Infinity, <0, >100) is refused by the database, and **40.123 is
  refused, never stored as 40.12**. 40.12, 0, 100 and 33.33 are accepted.
- [ ] The creation trigger's trust gate holds: a signed-in caller cannot change
  `profiles.role` or `profiles.owner_id` (re-verified before the trigger ships).
- [ ] History rows cannot be updated, deleted or inserted directly, and survive project deletion
  with their project UUID and name snapshot.

**Behavior**

- [ ] Projects with no saved arrangement show 50/50 and no history.
- [ ] Changing sharing changes no fee, bill, invoice or payment record.
- [ ] Active, ready, pending, on-hold and terminated projects never enter dashboard totals.
- [ ] Overview, Overview print, Reports and the dashboard agree for the same project.
- [ ] Print/PDF and CSV reproduce the selected report: filters, basis, review flags, as-of time.
- [ ] Partner acceptance facts appear only when stored, and never as acceptance of the split.
- [ ] PM-focused owner can open the dashboard and details, and cannot edit.
- [ ] Staff keep their existing project form and fee workflow, and see no new sharing or reserve
  figure.
- [ ] `npm test` (all suites), `node --check` on touched files, browser check as owner, as
  admin-pm@ and as staff.

Never run `npm run build`. This application has no build step.

## 12. Open findings (recorded, not fixed in Release 1)

- **F1 — Partnership Agreement wording.** The built-in partner agreement text
  (`js/print-utils.js` `DACS_AGR_DEFAULT_SECTIONS.partner`) describes a commission and
  revolving-fund remittance model ("the Partner retains the balance of collections as their share")
  and a 20% deferred holdback. It does not describe the confirmed remaining-cash split. The live,
  admin-edited text was not checked. Review separately; Release 1 does not change it.
- **F2 — Staff see PM Overview money today.** `_pmLoadOverview` (`js/pm-admin.js` ~159) has no
  staff check. Staff appear to see Remaining cash, Warranty retention and Profit Share, and other
  amounts, on a project Overview. Not yet confirmed in the browser. Release 1 removes the new
  sharing and reserve cards for staff. The rest of the Overview exposure needs its own change.
- **F3 — Projects are not company-scoped.** `construction_projects.owner_id` is null on every live
  row, and project RLS is role-only. Release 1 scopes only the new sharing tables through
  `pm_project_companies`. Scoping projects themselves is a separate decision.
- **F4 — Out-of-date portal comments.** `js/client-management-app.js` calls the partner view
  "monitoring only, no payments", but partners already see Total and Remaining cash receipt. Any
  future Phase C must also check that the partner's Remaining cash (`paid − direct`, ~3415)
  matches the owner's figure.

- **F5 — `allowed_modules` is not protected.** Live policies `profiles_update` (own row) and
  `profiles_admin_update` (any owner or staff, any row) allow editing `allowed_modules`, and
  `profiles_guard` checks only `role` and `owner_id`. A focused account can lift its own
  focus, and staff can change an owner's focus. **`profiles.status` is not guarded either**: an
  account can rewrite its own status, so the "active" check is only as strong as the login-time
  refusal of inactive accounts. Release 1 does not rely on `allowed_modules` for authority (§2). Server checks elsewhere that do rely on it (e.g. the Expenses check in
  0096/0097 purchasing functions) need a separate review.

- **F6 — Legacy direct-cost fallback omits overhead.** The ladder used by Overview, Reports and
  closeout (`directCostTotal` -> `labor + materials` -> `grandTotal - fee`) leaves out overhead at the
  middle step. 0 of 88 live bills use any fallback (18 Oct). Kept unchanged so closeout snapshots stay
  comparable; fix all three call sites together if a fallback bill ever appears.

## 13. Verification basis

Grounded in local source review and **read-only live queries on 18 Oct 2026**: profile roles,
project list and statuses, warranty rows for completed projects, the `construction_projects` RLS
policy, and the `profiles` policies and `profiles_guard` trigger. No live data or schema was changed. This document does not
assert that anything is implemented, tested or deployed.
