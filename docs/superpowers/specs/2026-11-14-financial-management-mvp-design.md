# DAC's Financial Management System — MVP specification

**Version 1.2 · 14 November 2026** (supersedes v1.0 of 12 November 2026; v1.2 adds the owner's refinements of 14 Nov, marked ✱)
**Scope** · Priority 1 Financial Calculation Corrections, Priority 3 ETC/EAC Forecasting, Priority 4 Financial Reporting
**Where** · Project Control (`folders` and their billing periods). Project Management is out of scope.
**Users** · DAC owner accounts. Staff never see any figure in this document.
**First project** · **Sample Residence** (`folders.id 00000000-0000-4000-8000-000000000001`)

## What changed from v1.0

| v1.0 said | v1.1 says | Why |
| --- | --- | --- |
| The example project was a stand-in name. | The project is **Sample Residence** (an anonymised live project). | The ₱74,267 was seen on Sample Residence. |
| ₱74,267 came from the 70% billing allocation. | ₱74,267 came from **BOQ-based earned revenue** (₱4,620,000.00) less cost (₱4,545,733.23). The billing allocation played no part. | Traced to the formula and the live records on 14 Nov 2026 (§2). |
| Replace the legacy Net Profit wherever it came from the 70% allocation. | Keep **Earned − Spent**, relabel it **BOQ-based profit estimate**, show its basis and warnings, and lead with **Projected final profit** once a current forecast is approved (§3.2). | Owner decision, 14 Nov 2026 (option A). |
| Recognized project profit renders only with a verified accounting source. | Unchanged, and DAC has none, so it reads **Unavailable** everywhere. | No general ledger exists. The BOQ is a progress estimate, not an accounting source. |
| Collections, disbursements and net cash from completed cash records. | **Unavailable** until an authoritative Project Control source is verified. | Invoices and payment requests are keyed to Project Management projects, not folders (§9). |
| ETC open commitments from a commitment register. | Labor: the remaining unincurred part of eligible labor contracts. Materials: manual lines. | Labor contracts are the only priced commitments in Project Control (§4.1). |
| — | Budget Overview's "Overall Profit", period "P&L" and two "Profitable" badges are relabelled and recalculated to match what they measure (§3.4). | Found during the trace. ✱ They render into hidden legacy elements today (`admin.html` "Hidden legacy DOM IDs"), so no one currently sees them; they are corrected so they can never resurface wrong. |
| — | Duplicate billing numbers are flagged for reconciliation, never rewritten (§3.5). | Found during the trace: Sample #3 ×2, Crossroad #4 ×3. |

## 1. Objective and release boundaries

Correct the project financial figures DAC uses to manage construction work. Preserve the monthly 70% direct, 20% indirect, 10% Target Margin Reserve allocation (`0073`) and the existing billing, purchasing, expense and payment workflows. Add a reviewed cost-to-finish forecast, and reports that reconcile to their source records.

The allocation is an internal planning split and stays outside the money model. The 10% Target Margin Reserve is a planned share of the billing base and is never labelled profit. Projected profit comes from the reviewed forecast. The BOQ-based profit estimate stays visible, labelled as an estimate, with what it rests on. Allocation balances and project cash have their own measures.

**Unchanged money rules.** Every rule under *Money invariants* in `CLAUDE.md` still holds. In particular: Spent = Labor + Material + Overhead; indirect labor is Overhead; Cover money is a subset of Spent and never carved out; costs with no billing period stay in project totals; company G&A is never charged to a job; reimbursements, warranty retention, quotations, petty cash, advances and PM sharing stay outside Spent, Earned and Profit.

**Design decisions.** Incurred cost is the recorded cost, on its recorded date (DAC records most costs when paid). Each forecast revision is reviewed and approved, and approved forecasts are immutable snapshots. Reports print from the browser. The forecast margin target is configured independently of the 10% reserve. Pesos (PHP), Asia/Manila business dates.

**Delivery order.** Phase 1 (Priority 1) → Phase 2 (Priority 3) → Phase 3 (Priority 4). Each phase is planned, built and checked on its own.

**Excluded.** Priority 2 (approvals, evidence, internal controls, cash-advance redesign). Project Management, scheduling, procurement redesign, new accounting or revenue-recognition logic, statutory reporting, bank reconciliation, currency conversion, automated ETC models and accounting integrations. Forecast approval applies only to forecast revisions.

## 2. The verified cause of the ₱74,267 display — regression case

**What was on screen.** Project Control → Sample Residence, the green banner: **"Net Profit · Earned ₱ 74,267"**.

**The formula.** `_projMargin` in `js/portal-app.compiled.js`: profit = earned − spent, where earned = contract × BOQ % complete (`_projEarned`, `_folderCompletion`). The label read "Earned" because the BOQ had progress data. No billing-allocation symbol reaches this function: §R of `tests/money-math.test.js` reads its source and fails otherwise.

**The records.**

| Input | Source | Value |
| --- | --- | ---: |
| Contract | `folder_budgets.total_budget` | ₱6,600,000.00 |
| BOQ total | `boq_documents`, 6 divisions, 135 lines | ₱6,822,056.76 |
| BOQ accomplished | same; every priced line at exactly 70% | ₱4,775,439.72 |
| % complete | accomplished ÷ BOQ total | 70.00% |
| BOQ status / last saved | same | Draft · 7 Sep 2026 |
| Earned revenue | ₱6,600,000.00 × 70.00% | ₱4,620,000.00 |
| Spent | all payroll + expenses + project overhead rows, all time | ₱4,545,733.23 |
| **Profit shown** | ₱4,620,000.00 − ₱4,545,733.23 | **₱74,266.77 → "₱ 74,267"** |

Spent stood at ₱4,545,733.23 from **12 Nov 2026 12:16 PM** (after a ₱1,935 expense) until **13 Nov 2026 11:07 AM** (Manila). The hero rounds to whole pesos.

**Why the 70% looked like the allocation.** The BOQ's 70% complete equals the 70% Direct share by coincidence. 70% × contract = ₱4,620,000.00. 70% × the allocation base would be ₱4,158,000.00, which gives a different figure.

**What actually drove the figure.** When the 70% was entered (7 Sep), ₱2,630,294.73 of cost had been recorded. ₱1,981,345.50 has been recorded since, and the BOQ never moved. The estimate fell from about ₱1,989,705 to ₱8,359.77 (14 Nov) because costs kept arriving while progress was frozen. The defect is an unlabelled, stale, draft input, not the arithmetic.

**Regression assertions (kept forever).**
- R1. Contract ₱6,600,000.00, BOQ 70.00%, Spent ₱4,545,733.23 → BOQ-based profit estimate **₱74,266.77**, labelled **"BOQ-based profit estimate"**, never "Earned", "Net Profit" or "Recognized".
- R2. With that BOQ Draft and last saved 7 Sep 2026, on any date after 7 Oct 2026, the figure is **not the headline**. It appears in the breakdown with **Draft** and **Stale** warnings.
- R3. No combination of the 70/20/10 allocation produces ₱74,266.77 from these inputs.
- R4. Live snapshot, 14 Nov 2026: Spent ₱4,611,640.23 → estimate ₱8,359.77, same labels and warnings.

✱ Both cases are **frozen as dated snapshots** (`tests/fixtures/sample-residence-2026-11-12.json`, `…-2026-11-14.json`) with their exact inputs, aggregated per billing period (no names), and their expected outputs, and run in `npm test`. They never change when live data does. Live Sample is verified **separately** against its current records by a read-only tool (§7.1).

## 3. Priority 1 — Calculation and label corrections (Phase 1)

### 3.1 Source rules, as mapped for DAC

| Measure | DAC source | Notes |
| --- | --- | --- |
| Contract value | `folder_budgets.total_budget`, plus each Additional Works child folder's own | No change-order record exists. Approved signed changes are entered as Additional Works. No version history: as-of contract value is **Unavailable** for past dates. |
| Billing (billed amount) | Fund Allocated (`project_budgets.monthly_budget`) of each **client-funded** billing period | Acknowledgement Receipts (`0114`) and the Billing Request use the same figure. Effective date = the billing period's month (no day is stored). Cover (`president`) periods are not billing. |
| Allocation base | The same Fund Allocated, with the period's `0073` snapshot | Unchanged. A period with no snapshot reads "Allocation not configured". |
| Actual project cost | Every `payroll`, `expenses` and non-deleted project `overhead_expenses` row of the folder and its Additional Works, including rows with no billing period | One row = one cost line. Split rows partition one cost and each part counts once. Purchase rows (`0096`) and stock cost-move rows (`0105`, signed) count like any row. Reconciliation (`0109`) already proves purchase pesos land once. |
| Direct cost | Labor (direct pay + direct workers' burden) + Material | Existing buckets. |
| Indirect cost | Overhead (indirect pay + indirect workers' burden + project overhead rows) | Existing buckets. |
| Unclassified cost | Payroll rows with no `labor_type` (7 live rows company-wide on 14 Nov) | They keep today's keyword classification so totals don't move, and are flagged "classified by name" in breakdowns and reports. |
| Client collections, project disbursements, net cash | **None verified** | Shown as **Unavailable** (§9). |
| Recognized revenue and matched cost | **None** | Recognized Project Profit reads **Unavailable**. |

Drafts, voided purchases and soft-deleted rows contribute nothing, as today. Tax is as recorded: amounts are what was paid, with no separate tax basis.

### 3.2 The three profit figures

DAC shows up to three profit figures. They are never merged and never relabelled into each other.

| Figure | Calculation | Shown when |
| --- | --- | --- |
| **BOQ-based profit estimate** | Earned − Spent, earned = contract × BOQ % complete (today's `_projMargin`, unchanged) | The project has BOQ progress (> 0%). Always shown with its basis. |
| **Projected final profit** | Expected final contract revenue − EAC (§4.2) | A forecast revision is approved and **current** (not Review required). |
| **Recognized Project Profit** | Verified recognized revenue − verified matched cost | Never, until a verified accounting source exists. Reads **Unavailable**. |

**Basis shown next to the BOQ-based profit estimate:** the BOQ % complete (one decimal), the **progress date**, and a status.
- **Progress date** = the BOQ's last-saved time (`boq_documents.updated_at`), labelled **"BOQ last saved"**. The BOQ stores no separate progress date. Its header date is the document date (Sample's says 18 May 2026, before the 70% was entered). ✱ Shown with the note **"Saving a BOQ refreshes this date even when progress hasn't changed."** ✱ With no timestamp it reads **"BOQ date unavailable"**, and the BOQ can't be current.
- **Draft** when the BOQ's status is `draft`; **For review** when `submitted`. Both count as unapproved.
- **Stale** when the BOQ was last saved more than **30 days** before today (Manila calendar days). ✱ 30 days is the initial warning threshold, held in one constant. The badge says how old it is ("Stale · 68 days").
- **Current** = approved, dated, and not stale.

✱ **Date filter.** The estimate, Contract less cost to date and both allocation-remaining figures are cumulative. When Project Control's date filter is not **All Time**, they read **"All Time only"** instead of mixing all-time revenue or allocation with filtered cost.

**Headline order** (Project Control hero, project print, Project Financial Summary):
1. A **current approved forecast** exists → headline **Projected final profit**, with its version, approval date and cutoff.
2. Otherwise, a **current** BOQ → headline **BOQ-based profit estimate**.
3. Otherwise → headline **"Profit not confirmed"**, with the reason (no current forecast; BOQ draft or stale; or no BOQ progress). No headline figure.

In every case the breakdown under the headline lists:
- the BOQ-based profit estimate with its basis and warnings (or "No BOQ progress recorded");
- Projected final profit, or its status: Forecast pending, Review required (with the last approved figure in history), Revenue unavailable;
- **Recognized Project Profit — Unavailable**;
- **Contract less cost to date** = contract − Spent, labelled as what is left of the contract (never profit).

A project with no BOQ progress no longer shows "Net Profit · Forecast" (contract − cost). That number survives only as **Contract less cost to date**. The word "Forecast" is reserved for the reviewed forecast.

**Margin.** The BOQ estimate's rate is shown as **"% of BOQ-earned revenue"** (profit ÷ earned, unrounded until display).

**Company P&L** (Project Control top). Keep the arithmetic: unmeasured projects book zero profit and losses immediately (`_recognisedProfit`), less company overhead. Relabel "Company Profit · To Date" → **"Company profit estimate · BOQ-based"**, "Gross Profit · Projects" → **"BOQ-based estimate · all projects"**, "Net Profit / Net Loss" → **"After company overhead"**. Add "N of M projects measured · K draft or stale".

**Target Margin Reserve comparison** ("Ahead of plan / Short of plan"). Shown only against a **current** BOQ estimate or a current Projected final profit. Otherwise "No comparison — BOQ is draft or stale". This extends today's rule ("never against a Forecast").

### 3.3 Allocation measures

Integer centavos in the new calculation layer. Source amounts are converted once (half away from zero) and summed as integers. Percentages come from unrounded ratios. Money and percentages display to two decimals on every figure this work touches.

| Measure | Calculation | Who sees it |
| --- | --- | --- |
| Direct allocation | Σ client periods (base × direct %) | Owner accounts |
| Indirect allocation | Σ client periods (base × indirect %) | Owner accounts |
| Target Margin Reserve | Σ client periods (base × reserve %) | Owner accounts |
| Direct budget variance | Direct allocation − (Labor + Material) | Owner accounts |
| Indirect budget variance | Indirect allocation − Overhead | Owner accounts |
| **Operating allocation remaining** | Direct allocation + indirect allocation − Spent | Owner accounts. If any client period has no snapshot: **Incomplete** ("2 billing periods have no allocation"), no figure. |
| **Total allocation remaining, including reserve** | Fund Allocated (client periods) − Spent | Replaces "Budget Remaining". Same audience as today (not staff). Computable even without snapshots. |

Spent here is the full project Spent, Cover and no-period rows included, so utilisation reads as spend against allocation (unchanged rule). When classifications are complete, operating remaining = direct variance + indirect variance.

**Rounding.** Per period: direct = round(base × direct %), indirect = round(base × indirect %), reserve = base − direct − indirect (half away from zero, residual to the reserve). Cumulative totals sum period amounts. Stored `0073` snapshots are never rewritten.

### 3.4 Budget Overview (`js/expenses-module.js`)

| Today | What it measures | New label | New calculation |
| --- | --- | --- | --- |
| "Overall Profit / Loss" (stats row and grand-total block) = contract − (expenses + payroll) | What is left of the contract after cost, with overhead rows missing | **Contract less cost to date** | Contract − Spent, with the same Spent as Project Control: payroll + expenses (no-period rows included) + project overhead rows. Scope is the open folder only, as the screen already is. |
| Per-period "P&L" / balance = Fund Allocated − spending **dated** in that calendar month | What is left of that billing's fund | **Fund balance** | Fund Allocated − cost **charged to that billing period** (payroll and expenses with that `projectId`, plus overhead rows attributed to it). ✱ Periods are matched by **id**, never by number or month, so Sample's two #3 periods stay separate. Cover periods show **Company-fronted cost** instead of a balance. |
| — | Cost not charged to any billing | **Not charged to a billing period** (new line) | No-period expense rows + unattributed project overhead, so the list adds up. |
| Grand total | — | **Total allocation remaining, including reserve** | Σ fund balances − company-fronted − not charged = Fund Allocated − Spent. Must equal Project Control's figure. |
| "₱X received" on each billing | What was allocated (receipt is unverified) | **"₱X allocated"** | Unchanged amount. |
| Contract − Fund Allocated, badged **"Profitable / Loss"** (`expContractDeltaBadge`, `mvpOvKpiContractDelta1`) | Contract less what has been allocated | ✱ **Contract less allocated funds** (neutral badge, never profit wording) | Unchanged amount. ✱ **"Unbilled contract value"** is reserved for a figure built on verified billings, which Project Control doesn't have yet. |
| "Current Fund Spent" | All cost | **Cost to date** | Same Spent as above. |

✱ **Reports (`expenses-module.js`).**
- The Reports print's **"Receivable Balance"** (contract − Fund Allocated) becomes **Contract less allocated funds**.
- "Total Billed (Received)" becomes **"Total Billed (Fund Allocated)"**.
- The **Period Summary** table and the print's period breakdown group cost **by date** within each month or quarter. They keep that basis, captioned **"Costs by date"**, and their "Remaining" column becomes **"Allocated less cost (by date)"**.
- The KPI **"Funds Available"** reads **Total allocation remaining, including reserve** on All Time, and "Allocated less cost (by date)" for a year.
- The Billing Allocation Performance table (already per period, by id) labels its "Remaining" column **Fund balance**.

**AI Health Check** (`js/ai-assistant.js`). ✱ Both the label and the interpretation change:
- "Gross Profit" (contract − spent) becomes **Contract less cost to date**, in the card and in the prompt.
- The prompt states that this figure is not profit.
- The per-project "losing money" and "low margin" alerts stop treating (contract − spent) ÷ contract as a margin:
  - A loss alert comes only from a negative BOQ-based estimate (named as an estimate, with its Draft / Stale status) or from cost exceeding the contract ("cost exceeds the contract by ₱X").
  - A low-margin alert comes only from a **current** BOQ-based estimate.
- The per-project AI summary's "Remaining" (Fund Allocated − Spent) becomes **Total allocation remaining, including reserve**.

### 3.5 Reconciliation flags (display only, nothing rewritten)

- **Duplicate billing numbers.** Two or more client-funded periods of one folder with the same billing number > 0. Shown on Project Control → Billing Periods and in the Budget Overview list: "Billing #3 is used by 2 periods (September 2026, October 2026) — check and renumber". Visible to anyone who sees the list (no pesos). Unnumbered legacy periods are not flagged. Live today: Sample Residence #3 ×2, Crossroad #4 ×3.
- **No billing period.** Shown as its own line with count and amount (Sample: 17 expense rows, ₱111,093.00, plus 37 unattached overhead rows, ₱173,025.00). Still in every total.
- ✱ **Project reconciliation.** Σ (fund balance of each client period) − Σ (company-fronted cost of each Cover period) − not charged = Total allocation remaining, including reserve, to the centavo. Cover rows and no-period rows are in the reconciliation, never left out.
- **Classified by name.** Payroll rows without `labor_type`, counted where today's keyword rule puts them.
- **Over-cap labor contract.** A fixed contract paid beyond its agreed amount (Sample: one, by ₱17,454.00). Flagged on the forecast (§4.1).

### 3.6 Every surface Phase 1 touches

| Surface | File | Change |
| --- | --- | --- |
| Hero banner (`ProjectLedger`) | `portal-app.compiled.js` | §3.2 headline order, breakdown, basis badges; "Budget Remaining" → two allocation measures (§3.3) |
| Cost & budget card, reserve comparison (`CostBudget`) | `portal-app.compiled.js` | Labels, comparison rule (§3.2) |
| Company P&L strip | `portal-app.compiled.js` | Labels and counts (§3.2) |
| Folder cards, low-margin warnings, health-check payload | `portal-app.compiled.js` | "BOQ-based" wording; payload carries BOQ status; card "Remaining" → Total allocation remaining, including reserve |
| Additional Works list | `portal-app.compiled.js` | "Remaining" (contract − cost) → Contract less cost to date |
| Billing Periods | `portal-app.compiled.js` | Duplicate-number flag; header "Remaining" → Total allocation remaining, including reserve; card "Remaining" → Fund balance; All Time rule |
| Project financial print | `print-utils.js` | Same labels, basis and headline as the hero |
| Budget Overview stats, list, totals, KPI badges (hidden legacy elements) | `expenses-module.js` | §3.4 |
| Reports dashboard, KPIs, tables, print | `expenses-module.js`, `admin.html` | §3.4 labels, variance rule |
| AI Health Check, AI project summary | `ai-assistant.js`, `ai-summary.js` | §3.4 |
| Shared calculations | new `js/project-finance.js` | §8 |
| Docs | `CLAUDE.md`, `AGENTS.md`, `docs/ARCHITECTURE.md` §6, `docs/OVERHEAD_MODULE.md` | Replace "Earned / Forecast" wording with §3.2 |
| Tests | `money-math`, `billing-allocation`, `project-control-staff`, new `project-finance` | §7 |

Client and partner portals show no profit and need no change. Project Management's "Gross profit" is out of scope. Phase 1 adds no data field and no migration.

## 4. Priority 3 — ETC/EAC forecasting (Phase 2)

### 4.1 Inputs

An owner account prepares a bottom-up **Estimate to Complete (ETC)** for remaining labor, materials, direct subcontract (outsource) work and project overhead. Each line records category, kind (open commitment or uncommitted work), description, amount, basis note, and a commitment reference where applicable.

**Labor commitments (pre-filled, one line per eligible contract).**
- Eligible: a Project Control labor contract of the folder (`labor_contracts`) with a fixed agreed amount (not `pay_basis = 'daily'`) that has not ended. Outsource contracts (`category = 'outsource'`) are eligible and listed as direct subcontract.
- Open unincurred commitment = **max(0, agreed − paid to date)**, paid to date by `lcPaid`'s rule (payroll rows on the contract, overhead pay excluded).
- ✱ **Over-cap** (paid > agreed): the full amount paid stays in actual cost. Submission is blocked until the contract carries a documented explanation and resolution (for example the cap was raised through the contract's own history, or the overpayment was accepted with a reason). Its remaining commitment contributes **₱0** to ETC, unless an **approved adjustment** establishes additional work still to be incurred; that work is then its own line, referencing the adjustment.
- Daily-rate contracts have no ceiling, so they create no commitment. Their remaining work is a manual line.
- The pre-filled amount can't be edited. A preparer who expects a different remaining cost adds a separate uncommitted line with a note.

**Materials, overhead and other work.** Manual lines. Project Control has no priced purchase-order register (requests carry quantities only), so a material line needs a basis note and, where one exists, a traceable reference (supplier quote, request number). Each line must cover distinct remaining work.

**Sample Residence, 14 Nov 2026 (for the pilot):**
- 8 fixed contracts: ₱55,011.00 open across 4 of them, 3 fully paid, 1 over cap by ₱17,454.00 (blocks until explained and resolved).
- 1 daily contract (electrical): no commitment.

### 4.2 Calculations

| Metric | Calculation |
| --- | --- |
| Open unincurred commitment | §4.1 |
| ETC | Σ open commitments + Σ uncommitted estimates |
| Actual cost at cutoff | Spent from rows dated on or before the cutoff (§3.1) |
| EAC | Actual cost at cutoff + ETC |
| Expected final contract revenue | Contract + Additional Works contracts at the cutoff |
| Projected final profit | Expected final revenue − EAC. Negative = **Projected loss**. |
| Projected profit margin | Projected final profit ÷ expected final revenue × 100. Confirmed zero revenue: margin **N/A**. Missing revenue: profit and margin suppressed (**Revenue unavailable**). |
| Target margin gap | Projected margin − company target margin, in percentage points, compared unrounded. **Below target** if negative, **At target** at equality, **Projected loss** whenever profit < 0. |

The company target margin is a percentage from 0 to 100, set by the main owner. Unset: **Target not configured**, no gap. Billing allocations and their balances are never forecast inputs.

### 4.3 Workflow

1. **Prepare** (owner accounts). Pick the project and a cutoff no later than today. Labor commitments pre-fill. Save a **Draft** (author, timestamps, cutoff, notes). Drafts never affect the published forecast.
2. **Submit.** Checks: required fields; amounts ≥ 0; categories valid; references belong to this folder; no two lines claim the same commitment; over-cap contracts acknowledged; cutoff ≥ the latest approved cutoff. The preparer confirms the estimate covers all remaining work. Zero ETC needs an explicit confirmation and a reason. A blank estimate stays missing. The server captures an **input fingerprint**: the cost rows dated ≤ cutoff (ids, amounts, dates, types, periods), each eligible contract's agreed and paid, the contract values, and the target.
3. **Review** (main owner). Approve, or return with a reason. Immediately before approval the server recomputes the fingerprint and returns the revision for refresh if anything changed. Approval and its immutable snapshot are saved together, serialized per project; a retried approval (same operation id) records once. The snapshot holds author, approver, approval time, cutoff, lines, target, fingerprint, calculated outputs, reason for revision and prior version.
4. **Maintain.** On every read the current fingerprint is compared with the approved one, including late rows dated on or before the cutoff. If cost rows, commitments, contract values or the target changed: **Review required**. The figures stay visible in history, with approval date and cutoff, and leave current totals until a refreshed revision is approved. Nothing approved yet: **Forecast pending**.
5. **Overlap.** When committed or estimated work becomes incurred, the next revision drops that amount from its line (pre-filled commitments do this by themselves). Missing references or two lines on the same work block approval.

The server checks Spent independently: total Spent at the cutoff is the plain sum of the rows (no bucket rule needed), compared against the client's figure at submission and approval. Bucket splits come from the shared calculation layer.

### 4.4 Storage (one migration, next free number, today `0115`)

New tables:
- forecast revisions (folder, revision no., status, cutoff, author, approver, timestamps, fingerprint, snapshot, prior revision, return reason, operation ids);
- forecast lines;
- company finance settings (target margin, rollout switch §6);
- an append-only event log.

All writes go through RPCs, owner-only by RLS. Approval and settings are main-owner only (owner role, `owner_id` null, active; never `allowed_modules`). No UPDATE or DELETE on approved snapshots or events. Nothing in these tables feeds `_projSpent`, `_projEarned`, `_projMargin` or `_recognisedProfit` (a new § of `money-math.test.js` fences it). Only `js/project-forecast.js` calls the RPCs.

## 5. Priority 4 — Financial reporting (Phase 3)

Owner accounts filter by project and inclusive date range. The dashboard defaults to current balances, the monthly report to the current calendar month. Every report, drill-down and print uses the shared calculation layer and one fresh data read.

| Report | Content |
| --- | --- |
| Project Financial Summary | Contract, Additional Works, billed (Fund Allocated), **collections Unavailable**, **disbursements Unavailable**, **net cash movement Unavailable**, actual cost, operating allocation remaining, Target Margin Reserve, total allocation remaining incl. reserve, the §3.2 headline and breakdown, forecast status and figures. Recognized Project Profit: Unavailable. |
| Budget vs Actual | Direct and indirect allocations, incurred costs, signed variances, classified-by-name cost, flags. Period activity and cumulative balances, separately labelled. |
| Profitability Forecast | Approved version, cutoff, status, actual cost at cutoff, ETC by category and kind, EAC, expected revenue, projected profit and margin, target gap, warnings, history. |
| Billing Allocation Report | Monthly billing (Fund Allocated), allocation base, 70/20/10 rates, bucket amounts, the period list, duplicate-number flags. Cover periods listed with no allocation. |
| Expense Breakdown | Labor, materials, outsource where mapped, overhead, classified-by-name. Signed row values, effective dates, source references (row ref, purchase, cost move). |
| Monthly Financial Summary | One row per calendar month: billing, incurred cost, and collections / disbursements / net cash as **Unavailable**. Period-end balances labelled separately. A month only partly inside the range is labelled partial. |

**Dates.** Inclusive filters run from local start of the start day to the start of the day after the end day. Cost activity uses each row's date. Billing uses its period's month and is shown once that month has ended; a partial-month range flags it and never prorates. Cumulative balances run from inception to period-end and are closing balances, never added across months. Every report shows its generation time.

**Historical forecast.** The latest approved revision whose approval time and cutoff both fall on or before period-end, labelled **As approved** with version and date. If later backdated rows change the actuals, show restated actuals separately and flag the variance. None qualifies: **No approved forecast at period-end**. A field that can't be reconstructed as-of (contract value) reads Unavailable instead of today's figure.

**Totals and print.** Multi-project views sum additive amounts only; forecast rows stay per project. Print keeps the same filters, data, date basis, statuses, totals and generation time, repeats column headings across pages, and keeps signs and decimals legible.

## 6. Rollout

- **Phase 1** goes live for all projects once the Sample reconciliation (§7.1) passes on local code against live data, read-only. It is a set of label and calculation corrections. Running old and new labels side by side would keep the misleading label on every other project.
- **Phases 2–3** sit behind a main-owner switch in the finance settings: **Sample Residence only** (default) → **All projects**. While Sample-only, other projects show the Phase 1 screens with no forecast or report entry points. The switch moves to All only after the Sample forecast and reports reconcile (§7.3), by a separate owner decision.
- Every migration is applied by the owner and verified live before the screens that need it go live.

## 7. Verification and acceptance

### 7.1 Sample Residence regression fixture

| Input or expected result | 12 Nov snapshot | 14 Nov live |
| --- | ---: | ---: |
| Contract | ₱6,600,000.00 | ₱6,600,000.00 |
| BOQ % complete (Draft, saved 7 Sep 2026) | 70.00% | 70.00% |
| BOQ-earned revenue | ₱4,620,000.00 | ₱4,620,000.00 |
| Spent | ₱4,545,733.23 | ₱4,611,640.23 |
| — Labor / Material / Overhead | — | ₱1,802,943.00 / ₱2,481,333.00 / ₱327,364.23 |
| — of which no billing period | — | ₱111,093.00 (17 rows) |
| — of which Cover | — | ₱178,785.00 |
| BOQ-based profit estimate | ₱74,266.77 | ₱8,359.77 |
| Headline | Profit not confirmed | Profit not confirmed |
| Allocation base (5 client periods, all 70/20/10) | ₱5,940,000.00 | ₱5,940,000.00 |
| Direct / indirect / reserve | ₱4,158,000.00 / ₱1,188,000.00 / ₱594,000.00 | same |
| Direct variance | — | −₱126,276.00 |
| Indirect variance | — | ₱860,635.77 |
| Operating allocation remaining | ₱800,266.77 | ₱734,359.77 |
| Total allocation remaining, incl. reserve | ₱1,394,266.77 | ₱1,328,359.77 |
| Contract less cost to date | ₱2,054,266.77 | ₱1,988,359.77 |
| Contract less allocated funds | ₱660,000.00 | ₱660,000.00 |
| BOQ estimate margin (% of BOQ-earned) | 1.61% | 0.18% |
| BOQ age / status | 66 days · Draft · Stale | 68 days · Draft · Stale |
| Not charged to a billing period | ₱280,095.00 (14 expense + 37 overhead rows) | ₱284,118.00 (17 + 37) |
| Fund balance #3 September 2026 (by id) | ₱879,210.00 | ₱878,826.00 |
| Fund balance #3 October 2026 (by id) | −₱91,662.00 | −₱153,162.00 |
| Duplicate billing flag | #3: Sep 2026, Oct 2026 | same |
| Illustrative approved ETC | ₱900,000.00 | — |
| EAC / projected profit / margin | ₱5,445,733.23 / ₱1,154,266.77 / 17.49% | — |

Before any approval: Forecast pending, no Projected final profit.

**Phase 1 reconciliation (live, read-only, before push).** ✱ Run by `tools/finance/reconcile-folder.mjs`, which reads the folder's current rows through `npx supabase db query --linked` (SELECT only) and checks:
- Old and new Spent are identical, to the centavo.
- The new estimate equals the old "Earned" profit.
- The new total allocation remaining equals the old Budget Remaining.
- Budget Overview's total equals Project Control's.
- The fund balances plus the company-fronted and not-charged lines add up to it.
- Every Sample row is counted once.

### 7.2 Test cases

T01–T12 of v1.0 stand, with these adjustments:
- T03 and T04: cash results read Unavailable.
- T07: labor commitments follow §4.1.
- T11: billing effective date is the period month.

New cases:

| ID | Scenario | Expected |
| --- | --- | --- |
| T13 | No accounting source | Recognized Project Profit reads Unavailable on every surface. Billing, reserve, contract and the BOQ estimate never substitute. |
| T14 | Pre-release copy of live data | Every source row, id, amount, date, status and attachment is unchanged before and after. Phase 1 writes nothing. |
| T15 | Regression R1–R4 (§2) | As stated. |
| T16 | BOQ approved and saved ≤ 30 days ago | BOQ-based profit estimate is the headline, no warning. Day 31: Stale, demoted. |
| T17 | No BOQ progress | "No BOQ progress recorded". Contract less cost to date is shown, never as profit. |
| T18 | Budget Overview | Contract less cost to date = contract − Project Control Spent. Fund balances use period assignment. The list adds up to the total, which equals Project Control's. No "Profit"/"Profitable" wording remains. |
| T19 | Duplicate billing numbers | Sample #3 and Crossroad #4 flagged; unnumbered periods not flagged; nothing written. |
| T20 | Labor commitments | Fixed open contract → agreed − paid. Over-cap → ₱0 and blocks until acknowledged. Daily or ended → none. Overhead pay never reduces it. |
| T21 | Period without an allocation snapshot | Operating allocation remaining reads Incomplete. Total incl. reserve is still shown. |
| T22 | Staff account | No profit, estimate, forecast, allocation or report anywhere (`tests/project-control-staff.test.js`). |

### 7.3 Release acceptance

- **Phase 1**: §7.1 reconciliation passes on Sample; T13–T19, T21, T22 pass; `npm test` green; owner browser check on admin.html.
- **Phase 2**: T07–T10 and T20 pass; the illustrative Sample forecast reproduces in a test; a real Sample forecast is prepared and approved by the owner, and its trace shows who prepared and approved it.
- **Phase 3**: T11–T12 pass; all six reports work with filters, source traceability and print. The owner reviews Sample against its records, then one completed project, one ongoing project and one with Additional Works, before switching to All.

## 8. Implementation design

### 8.1 Approaches considered

**Where the shared calculations live.**
- **Chosen:** a new pure module `js/project-finance.js` (`window.ProjectFinance`). It takes the bucket totals the existing money functions already produce, plus BOQ status, allocation snapshots, contracts and the date. It returns labelled view models in centavos. No database, no roles. Loaded in `admin.html` before `expenses-module.js` and `portal-app.compiled.js`, and `require()`d by tests, like `billing-allocation.js`.
- Rejected: moving `_projSpent` / `_projMargin` into it. The money tests slice those functions from the portal file to fence the invariants; moving them is churn with no gain.
- Rejected: computing in each screen. That is how the Budget Overview drifted from Project Control.

**Forecast storage.**
- **Chosen:** server tables with RPC-only writes, append-only events and operation ids (the `0109` / `0113` / `0114` pattern).
- Rejected: jsonb on `folders`. No audit, no immutability, no serialization.

**Reports.**
- **Chosen:** a new module `js/financial-reports.js` with its own print, opened from Project Control (as `billing-receipts.js` is from Billing Periods), owner-only.
- Rejected: extending Budget Overview's Reports. `expenses-module.js` is the largest file and serves staff screens.
- Rejected: building inside the React portal. Heavier edits to the compiled file for no benefit.

### 8.2 Constraints from the repo

- Edit `portal-app.compiled.js` directly; never `npm run build`.
- Every new field needs a real column.
- `folders.id` ≠ `construction_projects.id`.
- Local date keys from local parts (never `toISOString().slice(0,10)`).
- Run `npm test` after every money-code change.
- Staff amount-hiding is fenced by tests.
- A label change that breaks a test updates that test's expected text. A test is never deleted.

### 8.3 Left to the builder

Exact component layout, copy within the labels fixed above, CSS, RPC names, and how a revision's lines are edited on screen.

## 9. Source mapping decisions (v1.0 §7), recorded 14 Nov 2026

| Item | Finding | Decision |
| --- | --- | --- |
| Billing base and period assignment | Fund Allocated per client period; month and year only; 0073 snapshots on all 5 Sample periods | Billing = allocation base = Fund Allocated |
| Finalized status and dates | No finalized flag on cost rows; a saved row is a recorded cost; dates as in §3.1 | Recorded = incurred |
| Cost identity and dedup | Row ids; split parts partition one cost; purchases and cost moves land once (0109 proves ₱0 difference) | No extra dedup key |
| Tax basis | Amounts as paid | As recorded |
| Collections and disbursements | `invoices` and `payment_requests` key on `construction_project_id`; Sample has no linked PM project; Acknowledgement Receipts record a document, not cash | **Unavailable** |
| Accounting source | None | Recognized Project Profit **Unavailable** |
| Commitment source | `labor_contracts` (agreed, pay basis, end); no priced material POs | §4.1 |
| Reviewer role | Main owner approves; owner accounts prepare | §4.3 |
| Opening and legacy coverage | 5 Sample periods all have snapshots; 7 untyped payroll rows company-wide; periods without numbers are common | §3.3, §3.5 |
| Margin target | Not provided | Target not configured until the main owner sets it |

### References

- U.S. Department of Energy, *Integrated Project Management Using the Earned Value Management System*, §6.2.12 (ETC/EAC basis).
- IFRS Foundation, *IFRS 15 Revenue from Contracts with Customers* (conceptual reference; DAC's accounting framework remains an input).
- Trace evidence, 14 Nov 2026: read-only queries against the live database and the live portal functions, with the reproduction script kept outside the repo.
