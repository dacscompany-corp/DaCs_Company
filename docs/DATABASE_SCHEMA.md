# DAC's — Database Schema (Full Field Map)

> ⚠️ **The storage layer described below is out of date.** The app runs on **Supabase
> (Postgres)**, not Firestore. `js/supabase-config.js` is a Firestore-*compatibility shim*, which
> is why the code still reads `db.collection(...)` — collections are tables, camelCase fields are
> snake_case columns. **The field maps and document shapes here are still accurate**; the database
> they describe is not. The authoritative schema is `supabase/migrations/`, and even that has
> drifted (see `0020_schema_drift_catchup.sql`, `0025`, `0026`).
> See [ARCHITECTURE.md](ARCHITECTURE.md) §2.

> Generated from a full read of every `.add()` / `.set()` / `.update()` write across
> `js/` + `src/`, cross-checked against `firestore.rules`.
> Firestore is schemaless — these are the fields the **code actually writes**. A `?`
> means the field is conditional (only written in some branches).

## Storage access (`uploads` bucket, migration 0081)

The bucket is private (0027) and every read is a signed URL minted as the logged-in user.
Access is decided per **top folder** by `uploads_can_read(name, owner_id)` and
`uploads_can_write(name)`. The full folder-by-folder map is in
`docs/superpowers/plans/2026-09-29-uploads-storage-access-repair.md` ("Access map"). Project-scoped
folders put the `construction_projects.id` in the **second path segment**
(`weeklyBillReceipts/<project id>/…`); keep that shape for any new client-facing folder.

---

**Conventions**
- `userId` = the **owner's** Firebase UID. Staff write the owner's UID (via `ownerUid` indirection), so owner + staff share one dataset.
- `clientEmail` / `clientUid` = link to a customer; client read access is **email-matched**.
- `createdAt` / `updatedAt` = `serverTimestamp()` unless noted.

---

## 1. Identity & Accounts

### `users/{uid}` — admin-side accounts
| Field | Type | Set by | Notes |
|---|---|---|---|
| `displayName` | string | user-navigator | `first + last` |
| `email` | string | — | |
| `role` | string | user-navigator | `owner` \| `staff` \| `worker` \| `teamLeader` |
| `status` | string | user-navigator | `active` / inactive |
| `ownerUid` | string | user-navigator | for `staff`/workers → points to the owner whose data they share |
| `createdAt` | ts | — | |
| `position` | string | user-navigator | **(0050)** worker's trade ("Mason"). Shown on the worker's app profile and **snapshotted onto every attendance record** |
| `workerNo` | number | *trigger* | **(0050)** assigned by `profiles_worker_no_trg` for `worker`/`teamLeader` rows; displayed `W-0042`. **Never set by the client** |
| ~~`termsAccepted`~~ / ~~`termsAcceptedAt`~~ / ~~`termsSnapshot`~~ | — | — | **REMOVED.** Added by `0020_employee_terms.sql`, dropped by `0022_drop_terms_columns.sql` (verified against live 2026-07-03: the gate never fired, `terms_accepted` was `false` on every row). Acceptance evidence lives in `agreement_events` (0021). Listed here only so the columns are not "re-added" by someone reading an old copy of this doc |
| `agreementAccepted` / `agreementAcceptedAt` / `agreementSignature` / `agreementSignatureImage` | bool/ts/string | first-login agreement gate for non-owner admins (reuses migrations 0001/0016/0017 columns): starts `false`, flips true when the employee reads + e-signs on first login. The T&C document (text or one global PDF) lives in `settings/employeeTerms`. |
**Rules:** anyone signed-in can **read**; you may only create/update your **own** doc and **cannot set/modify `role`**.

### `clientUsers/{uid}` — customer portal profiles (`client.html`)
| Field | Type | Notes |
|---|---|---|
| `firstName`, `lastName`, `email` | string | self-set at signup |
| `createdAt` | ts | |
| (profile edits) | — | phone/address etc. added via profile editor |
| `termsPdfUrl` / `termsPdfName` | string | optional Terms PDF an admin attached (uploads bucket, `clientPortalTerms/{uid}/…`); if set, the client must open it + e-sign on next login (reuses migration 0022 columns) |
| `agreementAccepted` / `agreementAcceptedAt` / `agreementSignature` / `agreementSignatureImage` | bool/ts/string | set when the client signs the attached Terms PDF (reuses migrations 0001/0016/0017 columns); a new PDF resets `agreementAccepted` |
**Rules:** client reads/writes own; owner/staff read all.

### `constructionClientUsers/{uid}` — construction-side client profiles
| Field | Type | Notes |
|---|---|---|
| `firstName`, `lastName`, `email` | string | |
| `role` | string | `'client'` |
| `status` | string | `'active'` |
| `agreementAccepted` | bool | starts `false` |
| `agreementAcceptedAt` | ts | set when the client/partner accepts the Cost-Plus agreement |
| `agreementSignature` | string | typed full name (printed) (migration 0016) |
| `agreementSignatureImage` | string | URL of the hand-drawn signature PNG in the `uploads` bucket (migration 0017) |
| `agreementIp` | string | best-effort client IP at signing time (migration 0016) |
| `isPartner` | bool | flags a partner account (auto-set on partner-portal login, migration 0019). Enables the RLS gate: a partner can't read a project's data subtables until they've signed that project's `partnerAgreements`. Clients (is_partner=false) are unaffected. |
| `termsPdfUrl` | string | optional Terms & Policy PDF the admin attached to this client (uploads bucket, `clientTerms/{uid}/…`); the client must open + e-sign it on login before entering (migration 0022) |
| `termsPdfName` | string | display name of the attached Terms & Policy PDF (migration 0022) |
| `termsAccepted` | bool | client signed the Terms & Policy PDF (reuses migration 0020 column); re-set to false when the admin uploads a new PDF |
| `termsAcceptedAt` | ts | when the client signed (migration 0020) |
| `termsSignature` / `termsSignatureImage` / `termsIp` | string | typed name / drawn-signature URL / IP captured at signing |
| `createdAt` | ts | |

---

## 2. Expenses & Budgets (`expenses-module.js`) — **core financials**

Hierarchy: **`folders` → `projects` (a month) → `expenses` / `payroll`**. Money is split into confidential sibling collections.

### `folders/{id}` — project/client container
| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner |
| `name`, `description` | string | |
| `clientEmail` | string | synced **from the BOQ** on save — unlocks client read access |
| `createdAt` | ts | |
| `completedAt` | ts \| null | **NULL = active.** Set = the owner marked the project finished (migration 0064): it leaves Project Control's picker and carousel and moves into the collapsed "Completed" strip. A **view state only** — carries no pesos, gates no arithmetic, and is *not* the warranty reserve (that keys off `construction_projects.status`). Re-opening writes NULL back. |

### `projects/{id}` — a billing **month/period** inside a folder
| Field | Type | Notes |
|---|---|---|
| `userId` | string | |
| `folderId` | string\|null | parent |
| `month`, `year` | string/number | |
| `fundingType` | string | `progress` \| `president` (president = "cover/overflow" pool, hidden from clients) |
| `billingNumber?` | number | only for `progress` periods |
| `createdAt` | ts | |

### `folderBudgets/{folderId}` 🔒 — **confidential contract value**
| `userId` | string |
| `totalBudget` | number — the contract value |
**Rules:** **owner-only** + the assigned client. Staff are blocked. Code only writes if role ≠ staff.

### `projectBudgets/{projectId}` 🔒 — **confidential fund allocated**
| `userId` | string |
| `monthlyBudget` | number |
**Rules:** owner-only + assigned client.

### Project Control billing allocations 🔒 — migrations `0073` + `0074`, **owner-only**

Planning envelopes for a client-funded billing period: what share of the Fund Allocated was
*meant* for direct cost, indirect cost and margin. **Outside the money model** — nothing here is
revenue, expense, payment or profit, and `Spent` / `Earned` / `Profit` never read it. The reasoning
is in [OVERHEAD_MODULE.md](OVERHEAD_MODULE.md) § *Billing allocations*. Engine:
`js/billing-allocation.js`.

#### `projectControlAllocationPolicies/{folderId}` → `project_control_allocation_policies`
The folder's **default** for periods created from now on. Editing it never rewrites history.
| Field | Type | Notes |
|---|---|---|
| `userId` | string | `owner_id` |
| `directPct` | number | default `70` |
| `indirectPct` | number | default `20` |
| `targetMarginPct` | number | default `10` |
| `updatedAt` | ts | |

Check constraint: each ≥ 0 **and** the three total exactly 100 (±0.005). Same rule on every table
below and in `pcValidateAllocationPolicy()`.

**Owner test (`0074`).** Every policy and the RPC gate on `profiles.role = 'owner'` - the same
thing `is_owner()` (`0002`) and `js/admin.js` use. `0073` shipped with an extra
`profiles.kind = 'admin'` clause that exists nowhere else in the schema; a real owner whose `kind`
was not `admin` passed every other gate and was refused here alone, with
`P0001 'Owner access required'` reaching the UI as the generic *"Failed to update project."*
`kind` says which **portal** a person belongs to (`admin` / `client` / `construction_client`);
`role` says what they may **do**. Don't reintroduce the clause.

#### `projectControlBillingAllocations/{projectId}` → `project_control_billing_allocations`
The **snapshot** copied onto one billing period when it is created — same three percentage columns
plus `userId` / `updatedAt`, keyed by `projects.id` (one row per billing period).
- Created with a **true INSERT**, never the shim's `.set()` (which is an upsert) —
  `_pcInsertInitialAllocation()`. RLS grants SELECT + INSERT and nothing else.
- After creation it changes **only** through the RPC below. There is no UPDATE or DELETE policy.
- A `president` (cover) period gets **no** snapshot. Converting a configured period to cover leaves
  its row dormant rather than deleting it, so converting back restores the original history.

#### `billingAllocationAdjustments/{id}` → `billing_allocation_adjustments`
Append-only audit of every percentage change. **Written only by the RPC** — the table has no
client INSERT, UPDATE or DELETE policy at all, so a row here cannot be edited or erased from the
browser.
| Field | Type | Notes |
|---|---|---|
| `userId` | string | `owner_id` |
| `projectId` | string | the billing period |
| `oldDirectPct`, `oldIndirectPct`, `oldTargetMarginPct` | number\|null | **all three null together** when the period had no snapshot — a legacy period being configured for the first time |
| `newDirectPct`, `newIndirectPct`, `newTargetMarginPct` | number | must total 100 |
| `reason` | string | `check (btrim(reason) <> '')` — a blank reason is refused by the **database**, not only the form |
| `createdBy` | uuid | `auth.uid()`, server-side |
| `createdAt` | ts | server `now()` |

#### `update_project_control_billing_allocation(p_project_id, p_direct_pct, p_indirect_pct, p_target_margin_pct, p_reason)`
`security definer`, `search_path = ''`. The **only** way to change a snapshot. In one transaction it
locks the billing-period row (`select … for update`, so two owners cannot race), writes the
adjustment, then upserts the snapshot. It raises on: no session, a caller who is not
`kind='admin' and role='owner'` (staff included), a period the caller does not own, a blank reason,
and percentages that are null, negative or do not total 100. Callable by `authenticated` only.

#### `overheadExpenses.billingPeriodId` → `overhead_expenses.billing_period_id`
Nullable FK to `projects(id)`, `on delete set null`. Attributes one **project**-scope overhead row
to one billing period so it counts against that period's Indirect Budget. **Null is normal and
correct** — an unattributed row stays in the project's Spent as *Unallocated Indirect Cost*. The
migration adds the column only; existing rows keep `null` and behave exactly as before. A link that
points at another folder's period is treated as unallocated: it stays on its own job but consumes
no envelope.

### `expenses/{id}` — material / misc spend (written in batches, can **split** across funding sources)
| Field | Type | Notes |
|---|---|---|
| `projectId` | string | which period it's charged to |
| `userId` | string | |
| `expenseName` | string | `(1/2)` suffix when split |
| `category` | string | |
| `quantity`, `amount` | number | |
| `dateTime` | string | |
| `notes` | string | |
| `paymentMethod?` | string | |
| `poImageUrl?` `deliveryReceiptUrl?` `supplierInvoiceUrl?` `paymentReceiptUrl?` | base64 data URL (older rows) or stored-file URL `…/object/public/uploads/expenseReceipts/…` (0089+) | docs (PO/DR/SI/PR), only on first split |
| `inInventory?` | bool | mirrored to `inventory` |
| `coverExpense?` | bool | overflow charged to president fund |
| `splitGroup?` `splitIndex?` `splitTotal?` | — | multi-source split metadata |
| `clientSubmissionId?` | uuid | `client_submission_id` — one id per Save press; unique with `split_index` (0089), so a retry cannot duplicate |
| `purchaseLineId?` `purchaseChargeId?` | uuid | `purchase_line_id` / `purchase_charge_id` (0096): the row was written by a **purchase** (`pur_record`). It changes only through `pur_correct` / `pur_refund` / `pur_void` — the `expenses_purchase_guard` trigger refuses any other insert, update or delete |
| `stkCostMoveId?` | uuid | `stk_cost_move_id` (0105): the row was written by a stock cost move the main owner approved (`stk_cost_decide`); negative on the giving project. It leaves only through `stk_cost_reverse` — the same trigger refuses anything else (`STOCK_COST_ROW`). See *Stock cost moves (0105)* |
| `folderId?` | uuid | `folder_id` (0096): set ONLY on a purchase row for a project with **no billing period** for the purchase month and no Cover period (`projectId` null). It is that project's Cover Material — counted once in Material, Spent and Cover, in no period's envelope, shown as "No billing period" — until a re-fund moves it onto a period |
| `createdAt` | ts | |

### `payroll/{id}` — labor spend (also batch + split)
| Field | Type | Notes |
|---|---|---|
| `projectId`, `userId` | string | |
| `workerName`, `role`, `laborType` | string | |
| `daysWorked`, `dailyRate`, `totalSalary` | number | |
| `paymentDate`, `notes` | string | |
| `receiptImages` | base64 data URL[] (older rows) or stored-file URL `…/object/public/uploads/payrollReceipts/…` (0089+) | only on first split |
| `coverExpense?` / `splitGroup?` / `splitIndex?` / `splitTotal?` | — | as expenses |
| `clientSubmissionId?` | uuid | `client_submission_id` — one id per Save press; unique with `split_index` (0089), so a retry cannot duplicate |
| `createdAt` | ts | |

### `receipt_uploads` (migration 0089) — ledger of receipt photo files
One row per file uploaded to `expenseReceipts/` or `payrollReceipts/` (path `<folder>/<owner_id>/<yyyy-mm>/<uuid>.jpg`). Owner/staff of that company only.
| Column | Type | Notes |
|---|---|---|
| `path` | text PK | storage path; checked against the pattern above |
| `owner_id` | uuid | data owner (`profiles.id`); must equal path segment 2 |
| `kind` | text | `expense` or `payroll`; must match the folder |
| `uploaded_by` | uuid | default `auth.uid()` |
| `state` | text | `pending` → `attached` (set by trigger when an expenses/payroll row references the file); `migrated` and `deleted` come in plans 2–3 |
| `created_at`, `attached_at`, `deleted_at` | timestamptz | |

Insert is column-granted to (`path`, `owner_id`, `kind`) only; `uploaded_by`, `state` and the timestamps always take their defaults. The attach trigger only flips the SAME company's pending rows.

### `laborContracts/{id}` → `labor_contracts` — pakyaw / in-house capped pay (migration 0014; `category` 0057; `works` 0062)
| Field | Type | Notes |
|---|---|---|
| `userId`, `folderId` | string | folder-scoped (spans every billing period inside it) |
| `workerName`, `scope`, `notes` | string | `scope` = the JOB ("Tiling & masonry") |
| `trade` | string | worker's **position / trade** ("Mason") — fills `ack_position_trade` on the policy manual (migration 0039) |
| `orientationDate` | string | migration 0040 — **column exists but nothing writes it**; the agreement fills `ack_orientation_date` with **today's date at print time** (no date picker) |
| `agreedAmount` | number | the cap; payroll rows draw it down via `payroll.contractId` |
| `payType` | string | `pakyaw` \| `inhouse` (label only) |
| `category` | string | migration 0057 — `labor` (in-house worker, the default) \| `outsource` (outside vendor, supply & install). **Same table, two kinds**, exactly as `pm_labor_contracts.category` (0016) splits the PM twin. Outsource rows are drawn down by the same `payroll.contractId` path and land in the **Labor** bucket — Out Source is *not* a fourth bucket, and the money invariants are unchanged. The in-house vs outsourced split in the Worker Tracker is derived at read time from this column, never stamped on the payroll row. Every list-render site must filter on it or vendor contracts leak into the labor screens |
| `status` | string | `ongoing` \| `completed` |
| `capHistory` | json | `[{amount, at, note}]` when the cap is raised |
| `works` | json | migration 0062 — **lumpsum contracts**. An array of work NAMES (`["Plumbing Works", "Civil Works"]`), never amounts. A **non-empty** array is the whole discriminator: the contract is ONE capped agreement covering several works, paid by a SINGLE payment stream instead of one tagged payment per job. Deliberately **not** a third `category` — a lumpsum is a *shape* either category can take, so every list filter, segment tab and `.find(x => x.id === id)` lookup keeps working untouched. **Money model unchanged**: the drawdown still runs through `payroll.contractId`, and a names-only list can never add or move a peso. §M of `tests/money-math.test.js` fences that five jobs totalling 200,000 and one lumpsum of 200,000 give the identical agreed / paid / remaining. Registered in the shim's `json:` list — without that it does not round-trip. Must be in the `json:` registry, the modal, **both** save paths, the card, the ledger and the printed agreement (which lists the works in place of the container title) |
| `payBasis` | string | migration 0063 — **`fixed` (default) \| `daily`**. `daily` is an **UNCAPPED** contract: a worker hired by the day has no agreed total, so `agreedAmount` is forced to **0** and is meaningless. Nothing may report a **remaining**, a **percentage** or an **"over cap"** on one — paid-to-date is the only honest figure; `lcStats` / `_pmContractStats` return `daily: true` with `remaining` and `pct` as inert 0s, and every reader must branch on the flag, never on the numbers. **Not a category and not a pay type** — `category` stays `labor`\|`outsource` and `payType` stays `pakyaw`\|`inhouse`. Daily is a **shape**, like `works`: `works` non-empty → Lumpsum; `payBasis='daily'` → Daily; otherwise Single job. The three are mutually exclusive in the modal (a daily contract saves an empty `works`). **Money model unchanged**: drawdown still runs through `payroll.contractId` (PC) / `weeklyBills.entries[].contractId` (PM), and `pay_basis` carries no pesos. **A daily job is TAGGED ALONE** — the pro-rata splitter weights by what a job still owes, which is undefined without a cap, so ticking one clears and disables every other pick (`lcApplyDailyPickLock` / `_pmApplyDailyPickLock`) and both allocators hand it the payment whole. **Capped and daily jobs are summed APART** on every worker card and tab total, or a daily payment gets subtracted from a cap it never drew on and the card reads a false "Over by". Out Source takes the daily shape too (2026-09-08): PC's shared modal always allowed it, and PM's Out Source modal gained it — a vendor hired by the DAY (own crew, own pace) had to be given an invented cap before that. `pmOcSave` lifts its cap guard for `daily` only, and `_pmOcStats` returns the same inert-zero shape as the labor twin. **Lumpsum** is still never typed for Out Source — a vendor lumpsum only ever arrives through `pmOpenMerge`. Unapplied migration reads as `fixed` = the old capped behaviour. §Q of `money-math.test.js` fences all of it |
| `agreementSigned`, `agreementSignedAt`, `agreementSignature`, `agreementPdfUrl`, `agreementPdfName` | — | signed Worker Agreement (migration 0023) |
| `createdAt`, `updatedAt` | ts | |

### `categories/{id}` — expense categories — **Project Control only**
`userId`, `name`, `color`, `createdAt`

Read by `expenses-module.js` for the Project Control materials category dropdown, alongside
labels derived from the folder's labor contracts. **Project Management does not read this
table** — it has its own list below.

### `pmCategories/{id}` (migration 0060) — material categories, **Project Management only**
`userId`, `name`, `createdAt`

PM's own hand-managed list for the Daily Expenses → Materials category. A deliberate twin of
`categories` rather than a shared table: the two modules are parallel systems with separate id
spaces and separate audiences, and PC's list carries PC's habits (payment methods, one-off items,
worker names, logistics lines). Sharing one table put another module's vocabulary in front of a
PM admin and let one team's cleanup break the other team's dropdown.

- **Owner-scoped, not project-scoped** — one list across every PM project, so a category typed on
  one job is offered on the next.
- No `color` column (unlike `categories`): the PM picker is a plain `<select>` with no chip dots.
- Unique on `(owner_id, lower(name))` — the UI dedupe check cannot survive two admins adding the
  same name at once.
- The **name**, not this row's id, is what gets stored on a materials line (inside the
  `weeklyBills.entries` jsonb). Deleting a category therefore leaves saved entries reading
  correctly; the picker's "Currently set" group keeps rendering the orphaned value so reopening
  such an entry cannot silently blank it.
- Outside the money model — a label on a line, never an amount.

### `overheadExpenses/{id}` (`overhead-module.js`) — company **and** project overhead
`0001_init` created only `userId`, `category`, `amount` (number), `date` (string), `description`,
`createdAt`. Everything since was added by migration:

| Added | Fields |
|---|---|
| `0006` | `folderId` — which job a project-scope cost belongs to |
| `0025` | `scope` (`'company'` \| `'project'`), `expenseName`, `supplier`, `invoiceNumber`, `receiptUrl`, `status`, `notes`, `history` (jsonb, append-only), `deletedAt`, `updatedAt`, `createdBy` |
| `0073` | `billingPeriodId` — optional attribution to one billing period (see above) |

- **Every read filters `!deletedAt`.** Deletes are soft.
- A NULL `scope` is **inferred** from `folderId` (set ⇒ project). Do not backfill it to
  `'company'` — every legacy per-project cost would change scope.
- No jsonb blob mode on this table: a new app field needs a real column or the save fails silently.

### `reimbursements/{id}` (`reimbursement-module.js`) — Client Reimbursement Tracker (migration 0041)
Expenses the **owner/admin (architect) advanced** for a project, and whether the **client** has
paid them back. Direction is Client → Owner/Admin (**not** employee reimbursement).
**Tracking only** — nothing here is read by the money model (Labor / Material / Overhead / Spent /
Earned / Profit), and no invoice, payment request, expense, payroll row or journal entry is ever
created from it. `status: 'reimbursed'` is a **label**, not a transaction.

| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner (`owner_id`) |
| `refNo` | string | display reference `RB-2026-0001`, generated app-side from the highest sequence loaded — **not a key** |
| `folderId` | string | parent **`folders`** row (Project Control), never `construction_projects` |
| `projectName` | string | folder name snapshotted at save time, display only |
| `clientEmail`, `clientName` | string | who owes the money back; pre-filled from `folders.clientEmail`, editable |
| `paidBy`, `paidByName` | string | the owner/admin who advanced the money (defaults to the signed-in account) |
| `expenseCategory` | string | free text with presets in a datalist |
| `description` | string | what was paid for |
| `amount` | number | amount advanced |
| `amountReimbursed` | number | paid back so far; only meaningful for `partially_reimbursed` / `reimbursed` |
| `expenseDate` | string | `YYYY-MM-DD` (a real `date` column), when the advance was paid out |
| `receiptUrl`, `receiptName` | string | optional receipt/invoice in the private `uploads` bucket under `reimbursementReceipts/` (signed on use) |
| `notes` | string | free-form note from the create/edit form |
| `remarks` | string | latest status remark (the Remarks column in the list) |
| `status` | string | `pending` \| `sent_to_client` \| `partially_reimbursed` \| `reimbursed` \| `cancelled` |
| `history` | json | append-only `[{ at, by, status, from, note }]` — status changes + edits |
| `deletedAt` | ts | soft delete; every read filters it. **No UI deletes** — the MVP cancels instead |
| `createdBy`, `createdAt`, `updatedAt` | — | |

### `warrantyRetentions/{id}` (`warranty-fund.js`) — Warranty Retention register (migration 0043)
The warranty retention **frozen when a construction project is closed out as `completed`**, one row
per project. Written only by `window.wfRecordCloseout()`, which `termination-requests.js` calls at
the end of a completion, or by `window.wfSyncCompleted()` — the **back-fill** for projects that were
already `completed` before this register existed and would otherwise never get a row. The back-fill
values each project through `window.trComputeCloseout` (the closeout's own function, reused so the
two can't drift), skips projects already registered, and is safely re-runnable. Back-filled rows
carry a `backfilled` note in `history` because their `completedAt` is the best date available
(`terminatedAt` / `updatedAt`), not a recorded completion timestamp.

**This is an internal company reserve, by design.** On completion the company sets aside 5% of the
project's remaining cash — `netCash = totalPaid − directCost`, `retention = netCash × 5%` — to fund
warranty work, company expenses and project management. **Client billing is deliberately not
involved:** the company is reserving part of its own margin, not withholding from a client. The
reserve is tracked here but the pesos stay with normal company funds, so a row is a **reserve
figure, not a separate account balance**. `totalPaid` / `directCost` / `netCashAtCloseout` are
stored so it stays re-derivable.

`netCash` goes **negative** when direct costs outran payments. `retentionAmount` keeps the raw
signed value for the record; **only `contributedAmount` (clamped to ≥ 0) is ever summed** into the
fund.

**Tracking only** — same isolation as `reimbursements` above: no money math reads it, and no
invoice, payment request, expense, payroll row or journal entry is ever created from it.

| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner (`owner_id`) |
| `refNo` | string | display reference `WR-2026-0001`, generated app-side — **not a key** |
| `projectId` | string | parent **`construction_projects`** row (PM), never `folders`. **Unique** among live rows — a re-closeout updates the snapshot instead of stacking a second contribution |
| `projectName`, `clientName`, `clientEmail` | string | snapshotted at closeout, display only |
| `closeoutId` | string | the `terminationRequests` row that produced this snapshot |
| `totalPaid` | number | cash actually received, as the closeout computed it |
| `directCost` | number | labor + materials + site overhead |
| `netCashAtCloseout` | number | `totalPaid − directCost`; **may be negative** |
| `retentionPct` | number | the rate applied, in percent (5) |
| `retentionAmount` | number | raw `netCashAtCloseout × pct/100`; **may be negative** — record only |
| `contributedAmount` | number | `max(0, retentionAmount)`. **The only column the fund totals** |
| `completedAt` | ts | when the project was closed out |
| `warrantyMonths` | number | defects liability period (12) |
| `releaseDue` | string | `YYYY-MM-DD` (a real `date` column — **not** in the shim's `ts` list, or UTC+8 would shift it), stamped at `completedAt + warrantyMonths`. Whether a project is **still inside its warranty year is derived from this vs today**, never stored |
| `status` | string | `active` (counts) \| `void` (excluded). **Void is the only manual action on the register** — it is the only one that changes a total. Legacy `held`/`released`/`consumed` from the first build stay valid in the check constraint and read as `active`; **0044** migrated existing rows and moved the default |
| `releasedAt`, `releasedBy`, `releaseNote` | — | written by the first build's Release button, which no longer exists. Kept so historical rows keep their data; nothing reads them |
| `notes` | string | free-form |
| `history` | json | append-only `[{ at, by, status, from, note }]` |
| `deletedAt` | ts | soft delete; every read filters it |
| `createdBy`, `createdAt`, `updatedAt` | — | |

### `warrantyFundExpenses/{id}` (`warranty-fund.js`) — draws against the fund (migration 0043)
Expenses recorded against the accumulated retention pool. **A draw charges no project's Spent** —
it has no job to charge, and company overhead is never charged to a job. Same isolation as above.

Fund arithmetic (computed only in `_wfTotals()`): `available = (held + released) − drawn`, where
`drawn` excludes `cancelled` rows. Overdrawing is permitted — the fund is an accrual — but the UI
confirms it first and flags the KPI red.

| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner (`owner_id`) |
| `refNo` | string | display reference `WF-2026-0001` — **not a key** |
| `sourceRetentionId` | string | optional `warrantyRetentions` row this draw is attributed to; `null` = general fund. `on delete set null`, so removing a register row never destroys the spend record |
| `sourceProjectName` | string | snapshotted for display |
| `category` | string | free text with presets in a datalist |
| `description` | string | what was spent on |
| `amount` | number | |
| `expenseDate` | string | `YYYY-MM-DD` (a real `date` column) |
| `receiptUrl`, `receiptName` | string | optional; public-format URL in `uploads` (signed on use, 0027) |
| `notes` | string | free-form |
| `status` | string | `recorded` \| `cancelled`. Cancelling reverses the draw's effect on the fund; the row stays |
| `history` | json | append-only `[{ at, by, status, from, note }]` |
| `deletedAt` | ts | soft delete; every read filters it |
| `createdBy`, `createdAt`, `updatedAt` | — | |

**Rules:** **owner-only** (`owner_id = auth.uid()`, like `folder_budgets`) — staff are blocked in
the sidebar, the top nav, `switchView` **and** RLS, because every column is a peso amount or the
context for one. No client-read policy: the MVP has no client-facing surface.

---

## 3. BOQ / Accomplishment Reports (`boq-module.js`)

### `boqDocuments/{id}` — Bill of Quantities / progress report
| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner |
| `folderId` | string | parent folder |
| `date`, `projectName`, `area`, `ownerName`, `location`, `subject` | string | header |
| `costItems` | array | **3-level nested** line items (item → sub-item → line) with qty/unit/price/% complete + photos (base64) |
| `discount` | number | |
| `clientEmail` | string | drives client access (also copied up to folder) |
| `status` | string | `draft` \| `submitted` \| `approved` |
| `terms` | object/string | |
| `createdAt`, `updatedAt` | ts | |
**On save:** copies `clientEmail` to the parent `folders` doc + pushes a notification to the client.
**Known quirk:** historically multiple docs per folder existed (save bug); code picks the "best" one. See `cleanup-boq-duplicates.js`.

### `boqTemplates/{id}` — reusable templates
`userId`, `name`, `costItems` (deep-copied), `createdAt`

---

## 4. Quotations (`quotation-module.js`, `quotation-print.js`) — migration 0045

A quotation is a **sales document produced before any project exists** — an itemized estimate
DAC's sends to a prospect, tracked draft → sent → won | lost.

**Deliberately isolated — same rule as `reimbursements` (0041) and `warrantyRetentions` (0043).**
**No money math reads these tables** (Labor / Material / Overhead / Spent / Earned / Profit all
ignore them). A row here creates no folder, no `constructionProjects` row, no invoice, no payment
request, no expense, no payroll row, no journal entry. **Marking a quote Won changes a status
string and nothing else** — converting a won quote into a real project is a manual admin action.
Nothing outside `js/quotation-module.js` and `js/quotation-print.js` may read or write these
tables.

**Rules:** **owner-only** (`owner_id = auth.uid()`, mirrors `warrantyRetentions`) — every
meaningful column is a peso amount or the context for one, and staff must not see peso amounts. No
client-read policy; the client never sees this inside the system.

### `quotations/{id}` — the quotation
| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner (`owner_id`) |
| `quoteNo` | string | display reference `Q-2026-0001`, generated app-side from the highest sequence used that year — **not a key** |
| `revNo` | number | current revision number, starts at 1 |
| `quoteDate` | string | `YYYY-MM-DD` (a real `date` column) |
| `validUntil` | string | `YYYY-MM-DD` (a real `date` column). Drives the **computed** `expired` state — nothing ever writes it; the app derives `status === 'sent' && validUntil < today` |
| `clientName`, `clientEmail`, `clientAddress` | string | |
| `clientTin` | string | **Retired by 0058** — Area took its cell on the printed sheet. The column is **not dropped** (old rows may hold a TIN) but nothing writes it: it is absent from the save payload, the revision snapshot, the client preset and the editor form. A client TIN belongs on an **invoice**, which has its own — see `invoices.clientTin`. Re-adding it is a UI change, not a migration |
| `projectName`, `location`, `subject`, `scopeNote` | string | header |
| `area` | string | **(0058)** floor area as it prints in the sheet header, in the cell TIN used to occupy. **Free-form text, not numeric** — real headers read `4 SQM`, `120 sqm (2 floors)`, `38 sqm GFA`. Nothing computes with it and **no rate is ever derived from it**; quotations stay outside the money model (0045). Absent on rows and revision snapshots written before 0058, and the header row is skipped when both it and `clientAddress` are empty, so older quotes print exactly as they always did — **no backfill needed**. Deliberately **not** part of a `client` preset: area describes the job, not the client |
| `images` | json | **(0046)** document-level reference renders/photos `[{ url, name, caption }]`, printed **once** above the itemized estimate. Capped at **4 by the UI** (`QT_MAX_IMAGES`), not by the DB — trimming a 5th belongs where the user can be told. Supersedes the per-section `images` from 0045; the module hoists legacy ones on open (`qtHoistLegacyImages`) and the print sheet falls back to them for revision snapshots frozen before 0046 |
| `sections` | json | 3-level tree: `[{ id, label, pricing, lumpAmount, groups:[{ id, label, qty, unit, lumpAmount, lines:[{ id, description, qty, unit, unitPrice, state }] }] }]`. One client-facing rate per line — deliberately **no** material/labor split; that is internal costing and belongs in the BOQ, never on a document a client reads. Rows written before 0046 may still carry a per-section `images:[]` — read-only legacy, see `images` above. **Group `qty` / `unit` (2026-08-26) are OPTIONAL and PRESENTATION ONLY** — they print in the QTY / UNIT columns beside the group label and are **never multiplied by anything**: a group's money is its `lumpAmount` (LOT) or the sum of its lines, so `qty: 5` on a ₱25,000 group is still ₱25,000. Absent on every group written before that date, and both render paths treat missing as blank — no backfill. Fenced by `tests/quotation.test.js`. No migration: groups live inside this jsonb blob, so extra fields cost nothing |
| *(group amounts, printed)* | — | A group prints its amount **only when the groups add up to their section** — i.e. a LOT section with no `lumpAmount` of its own, or a rated section. When the section carries its own figure the group cells stay blank, because a per-group number beside a different section total reads to clients as a charge stacked on top of it. Blanked outright 2026-08-06; restored with the adding-up condition 2026-08-26. Lives in `qtGroupPrintAmount` (`js/quotation-print.js`), which feeds **both** the HTML sheet and the PDF export |
| `showLinePricing` | bool | **(0047)** presentation only, default `true`. `false` → the print sheet and PDF drop the **Unit Price** column and leave each line's amount blank; section totals and the summary are unchanged. **No calculation ever reads it** — `qtGrandTotal` is identical either way. Absent on rows and revision snapshots written before 0047, so anything but an explicit `false` means true |
| `preparedBy` | string | **who built** the quotation. Prints as its own **Prepared By** signature column when `terms.signOff.prepared` is on, and is also the fallback name for the Submitted By column |
| `submittedBy` | string | **(0049)** **who signs it out** — the name on the **Submitted By** signature column. Print chain is `submittedBy \|\| preparedBy \|\| COMPANY.name`, so every row and revision snapshot written before 0049 has an empty value, falls through to `preparedBy` and prints exactly as it always did — **no backfill needed**. Whether the column prints at all is **not** stored here; see `terms.signOff` |
| `terms.signOff` | json | which of the three signature columns print. **`preparedBy` is a misnomer — it controls the SUBMITTED BY column**, frozen that way since 0045 when the sheet had one company column fed by the "Prepared by" field; renaming it would switch that column back on for every quotation that had it off. `prepared` (added 2026-08-11) controls the real **Prepared By** column and is **opt-in** — absent means off, so a quotation already sent cannot grow a signature column on reprint. `clientApproval` is opt-out. A snapshot with **no `signOff` object at all** prints **no** signature block, unchanged from 0045 |
| `showLogo` | bool | **(0048)** presentation only, default `true`. `false` → the print sheet and PDF omit the header logo (the sheet goes out on pre-printed letterhead that already carries it); the `PROJECT QUOTATION` label, the contact line and everything below the header are unchanged, and the PDF closes the 34mm logo band rather than leaving white space. **No calculation ever reads it.** Absent on rows and revision snapshots written before 0048, so anything but an explicit `false` means true |
| `discount` | number | |
| `discountType` | string | `amount` \| `percent` |
| `vatMode` | string | `none` (prints "VAT not applicable") \| `exclusive` (VAT at `vatPct` added to the sub-total) \| `inclusive` (total unchanged, VAT component shown broken out) |
| `vatPct` | number | default 12 |
| `totalAmount` | number | final total after discount and VAT; denormalised for list sorting and pipeline stats, recomputed by the app on every save |
| `status` | string | `draft` \| `sent` \| `won` \| `lost` |
| `statusNote` | string | |
| `decidedAt` | ts | stamped when status moves to `won`/`lost`, cleared if it moves back — powers win-rate-over-time without scanning `history` |
| `followUpDate` | string | `YYYY-MM-DD`; in-app reminder only, **nothing is emailed** |
| `followUpNote` | string | |
| `terms` | json | `{ validityNote, payment, deliveryTimeline, warranty, exclusions, conditions:[{title,body,include}], signOff:{preparedBy,clientApproval} }` |
| `preparedBy` | string | |
| `history` | json | append-only `[{ at, by, status, from, note }]`, same convention as `reimbursements.history` |
| `deletedAt` | ts | soft delete; every read filters it |
| `createdBy`, `createdAt`, `updatedAt` | — | |

### `quotationRevisions/{id}` — immutable revision snapshots
Every **send** freezes a full copy. The module only ever inserts here; there is no edit or delete
path. Rows disappear only with the parent quotation.

| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner (`owner_id`), denormalised so the RLS check stays single-table |
| `quotationId` | string | parent `quotations` row |
| `revNo` | number | unique per `quotationId` |
| `snapshot` | json | full copy of the quotation tree at send time |
| `totalAmount` | number | |
| `sentAt` | ts | |
| `note` | string | |
| `createdAt` | ts | |

### `quotationPresets/{id}` — reusable client and scope blocks
| Field | Type | Notes |
|---|---|---|
| `userId` | string | owner (`owner_id`) |
| `kind` | string | `client` → `data` is `{ clientName, clientEmail, clientAddress }` (`clientTin` dropped by **0058**; `area` deliberately **not** added — it describes the job, not the client, and a preset reused across three projects must not drag one project's area onto the others). `scope` → `data` is `{ sections: [ …same shape as quotations.sections ] }` |
| `name` | string | |
| `data` | json | see `kind` above |
| `deletedAt` | ts | soft delete; every read filters it |
| `createdAt`, `updatedAt` | — | |

---

## 5. Invoices (`invoice-module.js`, `labor-invoice-module.js`)

### `invoices/{id}` — sales/material invoices
| Field | Type | Notes |
|---|---|---|
| `userId` | string | |
| `invoiceNo`, `date` | string | |
| `businessName`, `businessTin`, `businessAddress` | string | seller |
| `clientName`, `clientTin`, `clientAddress` | string | buyer |
| `items` | array | `{description, qty, unitPrice, discount, amount}` |
| `subtotal`, `totalAmount` | number | |
| `paymentDetails` | object | `{method:'gcash', gcashNumber, gcashName}` **or** `{method:'bank', bank, accountNo, accountName, branch}` |
| `docTitle` | string | **0055.** Presentation only. The heading printed opposite the letterhead. Empty = the house default `SALES INVOICE`, which lives as `_DOC_TITLE` in `invoice-module.js` and nowhere else; pre-0055 rows are empty and print unchanged. Rendered uppercase by both the sheet (`text-transform`) and the PDF (`toUpperCase`) — the stored value keeps the typed case. Never affects `invoiceNo`, `status` or any total. |
| `partyLabel` | string | **0056.** Presentation only. The heading printed above the `clientName`/`clientTin`/`clientAddress` block. Empty = the house default `Bill To`, which lives as `_PARTY_LABEL` in `invoice-module.js` and nowhere else; pre-0056 rows are empty and print unchanged. The editor offers `Bill To` \| `Received From` (`_PARTY_LABELS`) and switches the three field labels to *Payer …* for the latter, but the column is free-form — a third heading is a one-line change, no migration. Read by the admin print sheet, the PDF export and the client-portal sheet in `client-payment.js`. Never affects `clientName`, `invoiceNo`, `status` or any total. |
| `showLogo` | bool | **0054.** Presentation only. `true` (default) prints the company logo strip in the header; `false` omits it — for invoices going out on pre-printed letterhead that already carries the mark. *Which* logos exist and their order stays global in `settings/invoiceDefaults.logos`; this is only the per-document on/off. Missing = `true`, so pre-0054 invoices print unchanged. Mirrors `quotations.show_logo` (0048). |
| `signatories` | object | **0053.** `{preparedBy, receivedBy, approvedBy}`, each `{name, org, esign, show}`. Presentation only. `name` + `org` (company or position) both print **above** the rule, the role label below it; `esign` stamps `assets/images/dacs-signature.png` above the name — for the company's own blocks, not the client's. A missing key or missing `show` reads as an unnamed line that prints, i.e. the blank line every pre-0053 invoice has, so nothing needed a backfill. Hiding all three drops the signature row entirely. Free-form jsonb — new keys need no migration. Never read by any money calculation. |
| `notes` | string | |
| `status` | string | `draft` \| issued |
| `clientEmail?`, `clientUid?` | string | for client read access |
| `createdAt`, `updatedAt` | ts | |

### `laborInvoices/{id}` — labor-only invoices
Same shape as `invoices`; `items` are labor lines auto-built from `weeklyBills` entries. Defaults persist to `settings/invoiceDefaults`.
**Exception:** no `signatories` — 0053 added named/hideable signature blocks to sales invoices only. The labor invoice still prints three fixed blank lines.

---

## 6. Payment Requests (`paymentRequests` — **one collection, TWO workflows**)

⚠️ This collection is shared by two different systems with **different status vocabularies**.

### A) Construction PM flow (`pm-admin.js`, created by admin)
| Field | Type | Notes |
|---|---|---|
| `weekEndingDate` | string | |
| `amount`, `carryover`, `totalAmount` | number | |
| `amountPaid` | number | starts 0 |
| `strict` | bool | exact-amount-only week |
| `notes`, `billingPeriod` | string | |
| `status` | string | `unpaid` \| `partial` \| `paid` |
| `source` | string | `'pm-admin'` |
| `clientEmail`, `clientName`, `projectName` | string | |
| `constructionProjectId` | string | links to `constructionProjects` |
| `createdAt`, `updatedAt` | ts | |

### B) Cost-Plus / client-submit flow (`client-payment.js`, `payment-requests.js`)
| Field | Type | Notes |
|---|---|---|
| `clientEmail`, `clientUid` | string | |
| `ownerUid` | string | |
| `status` | string | `pending` → `partial_pending` ↔ `pending` → `submitted` → (`partial_approved`) → `rejected`/verified |
| `paidAmount` | number | |
| `proofBase64` | base64 | payment screenshot |
| `referenceNumber` | string | |
| `partialReason?` | string | |
| `submittedAt`, `verifiedAt`, `verifiedBy`, `rejectedReason`, `rejectedAt` | mixed | lifecycle stamps |
| `createdBy`, `createdAt` | string/ts | |
**Rules (B):** clients may only perform **specific status transitions** (e.g. `rejected → submitted`), never arbitrary edits.

---

## 7. Construction Project Management

### `constructionProjects/{id}` (`pm-admin.js`)
| Field | Type | Notes |
|---|---|---|
| `clientName`, `clientEmail` | string | |
| `projectName`, `address` | string | |
| `status` | string | `active` \| `on-hold` \| `completed` \| `terminated` |
| `startDate` | string | |
| `partnerTerms` | string | admin-authored T&C text shown in the sign-gate (migration 0018) |
| `partnerTermsPdfUrl` | string | optional uploaded T&C PDF (uploads bucket, `projectTerms/{id}/…`); partner must scroll it to the end before signing (migration 0021) |
| `partnerTermsPdfName` | string | display name of the uploaded T&C PDF (migration 0021) |
| `createdAt` | ts | |

**Subcollections** (owner/staff full access; client read-only of own; client write **only** `procurementList`):

| Subcollection | Key fields |
|---|---|
| `weeklyBills/{id}` | `weekEndingDate`, `labor`, `materials`, `managementFee` (=15% of L+M), `grandTotal`, `notes`, `status` (`Submitted`/`Partial`/`Paid`), `createdAt`,`updatedAt` |
| `procurementList/{id}` | `item`, `qty`, `estPrice`, `notes`, `status` (`Pending`/`Assigned…`/`Bought…`), `boughtBy` (`client`/`company`/null), `actualAmount`, `receiptUrl`, timestamps |
| `laborContracts/{id}` → `pm_labor_contracts` | the PM twin of `labor_contracts` (migrations 0015; `category` 0016; `works` 0062): `workerName`, `scope`, `agreedAmount` (the cap), `payType`, `category` (`labor`\|`outsource`), `status`, `capHistory`, `notes`, `agreement*`, `works`. Drawn down by `weeklyBills.entries[]` labor lines carrying `contractId` — **not** by `payroll`, which is Project Control's path. `works` is the **lumpsum** list: work NAMES only, and a non-empty array means ONE cap covering several works paid by a single entry stream. Same rules as the PC column, and the two must stay in step. `pay_basis` (0063) is the PM twin of the PC column: `daily` = **uncapped**, drawn down by the same `weeklyBills.entries[]` labor lines, reporting no remaining / percentage / over-cap, and **tagged alone** so the pro-rata splitter never has to weight a job with no cap. Out Source (`category='outsource'`) takes the daily shape as well (2026-09-08) — §M of `money-math.test.js` asserts both modules print the identical works line |
| `revolvingFund/summary` | `initialFund`, `totalReplenished`, `notes`, `updatedAt` (single doc id `summary`) |
| `revolvingFundExpenses/{id}` | `date`, `amount`, `description`, `notes`, `createdAt` |
| `revolvingFundReplenishments/{id}` | `date`, `amount`, `notes`, `createdAt` |
| `dailyLogs`, `milestones`, `accomplishmentReports`, `walkthroughs` | site-progress docs (read by `client-management-app.js`) |
| `partnerAgreements/{id}` | per-project partner terms acceptance (migration 0018): `partnerUid`, `partnerEmail`, `signature`, `signatureImage` (uploads URL), `termsPdfUrl`/`termsPdfName` (the PDF version signed, if any), `ip`, `acceptedAt`. A partner must sign before viewing the project. The project's own `partnerTerms` field holds the admin-authored T&C text; `partnerTermsPdfUrl` holds an optional uploaded PDF the partner must scroll before signing. |

---

## 8. Construction Procurement / Inventory (`construction-module.js`)

### `requests/{id}` — material requests (created by **workers**)
| Field | Type | Notes |
|---|---|---|
| `requestedBy` | string | worker uid (rule-enforced) |
| `items` | array | each: `{id, name, unit, quantity, status (pending/purchased/delivered), purchasedDate?, deliveredDate?}` |
| `status` | string | overall: `pending`/`purchased`/`delivered` (derived) |
| `batchId` | string | groups into a batch |
| `isUrgent` | bool | surfaces in urgent list |
| `isEditable` | bool | |
| `createdAt`, `updatedAt` | ts | |
**Rules:** worker creates own (`status='pending'`, non-empty `items`); owner/staff manage.

### `batches/{id}` — delivery batches
`status` (`open`/`closed`/`delivered`), `deliveryDate` (Timestamp), `cutoffDate?`, `createdBy`, `createdAt`, `totalItems`, `closedAt?`, `closedBy?`

### `inventory/{id}` — stock (**owner/staff only**, workers blocked)
`itemName`, `unit`, `currentStock`, `minStock?`, `notes`, `lastUpdated`, `lastAdjustedBy`, `createdAt`. Auto-fed from delivered requests and from expenses flagged `inInventory`.

---

## 9. Requests from Clients

### `sowaRequests/{id}` — Statement of Work Accomplished request
`clientEmail`, `clientName`, `clientUid`, `ownerUid`, `status` (`pending`/viewed/shared), `requestedAt`

### `terminationRequests/{id}` — project **closeout** record (**admin-initiated**)
Despite the name, this table records a project ending **either way**:

| `outcome` | Meaning | Project status set to |
|---|---|---|
| `completed` | The good ending — the work finished | `completed` |
| `terminated` | Cut short — the work stopped early | `terminated` |

`clientUid`, `clientEmail`, `clientName`, `projectId`, `projectName`, `totalLabor`, `totalMaterials`, `directCost`, `managementFee`, `grandTotal`, `totalPaid`, `remainingBalance`, `status` (`pending`/approved/rejected), `outcome` (`completed`/`terminated`, default `terminated`), `initiatedBy` (`admin`/`client`, default `client`), `requestedAt`, `decidedAt`, `decidedBy`, `rejectedReason`

**The money is identical for both outcomes.** This is a cost-plus system: the client owes actual direct costs + the management fee, and `construction_projects.budget` is an estimate, never a fixed price. Completing a project does **not** bill the remaining contract. Only the status, the badge and the client-facing wording differ — and that wording matters, since nobody who finished a project should receive a document saying it was terminated.

**Rules:** owner-only in practice. The client may **read** their own rows (they see the record + final invoice) but **cannot insert** — the client INSERT policy was dropped in migration 0042. Closing out is an admin decision made from Project Management → Project Closeout (`js/termination-requests.js`); the portal's client-side Termination Zone was removed. Staff are blocked in the UI too (`_trStaff()`), since every figure here is a peso amount.

`project_name`, `direct_cost`, `decided_at`, `decided_by`, `rejected_reason`, `initiated_by`, `outcome` were added in **0042** — the code had been writing four of them since 0001 against columns that never existed, so every approval was failing on the missing column. Closing out also stamps `construction_projects.terminated_at` / `terminated_by` / `termination_request_id` (added in 0042; they double as the generic closeout stamp for both outcomes) and `invoices.created_by` / `termination_request_id`.

`status = 'pending'` only ever holds client requests raised **before** 0042; nothing new lands there, and approving one always resolves to `outcome = 'terminated'`.

---

## 10. Notifications, Public & Settings

### `notifications/{userId}/items/{id}` — cross-system messaging
`type` (e.g. `report_shared`, `report_approved`, `payment_*`, `sowa_request`, `termination_approved`), `message`, `isRead` (bool), `relatedId?`, `createdAt`.
**Rules:** anyone signed-in can **create** (for any recipient); only the **recipient** reads/updates/deletes theirs.

### `appointments/{id}` (public booking — `index.html` #/book, `js/booking.js`)
`fullname`, `email`, `contact`, `service`, `message`, `status` (`pending`), `createdAt`, `updatedAt`,
plus from the v2 booking wizard (migration 0084, all nullable — old rows lack them):
`meetingType` (`office` / `site` / `online`), `propertyType`, `budget` (a range label, e.g. `₱1M – ₱3M`;
**hidden from staff** in admin), `location`, `preferredDate` (`date`, the visitor's local calendar day),
`preferredTime` (e.g. `10:30 AM`). Preferred date/time is a request, not a confirmed booking.
The client's reference code is `DACS-` + the first 6 hex characters of `id` (`DacsBooking.refCode`).
**Rules:** anyone can insert (`appt_create`); only owner/staff can read or manage (`appt_admin`) —
`appt_read` (any signed-in account) was dropped in 0084. The public insert must **not** read the row
back (`insert().select()` / `db.collection().add()`): RLS then rejects the whole insert.


### `testimonials/{id}` (public feedback)
`name`, `location`, `rating` (1–5), `message`, `status` (always `pending` on public insert — an admin approves; RLS `testi_create` rejects anything else), `createdAt`.
**Rules:** public creates only as `pending`; public reads only `approved` + rating ≥4.

### `settings/{id}`
- `settings/paymentQR` — payment QR (clients can read)
- `settings/invoiceDefaults` — `businessName/Tin/Address`, `vatRate`, `paymentDetails`, `logos` (`{src, enabled}[]`, edited in the Business Settings modal), `signatories` + `showLogo` + `docTitle` (0053/0054/0055; all three pre-fill **new** sales invoices only — an existing one keeps whatever it was saved with)
- `settings/employeeTerms` — one global employee agreement: `text` (fallback terms), `pdfUrl`/`pdfName` (optional global Terms PDF in the uploads bucket, `employeeTermsGlobal/…`; if set, every employee opens + e-signs it on first login), `updatedAt`
- `settings/constructionClientTerms` — one global Client Management agreement: `text`, `pdfUrl`/`pdfName` (`constructionClientTermsGlobal/…`); if a PDF is set, every construction client opens + e-signs on next login
- `settings/clientPortalTerms` — one global Client Portal agreement: `text`, `pdfUrl`/`pdfName` (`clientPortalTermsGlobal/…`); if a PDF is set, every customer-portal client opens + e-signs on next login
- `settings/workerAgreement` — worker agreement template for labor contracts (Worker Tracker): `text` (piecework terms + company rules), `pdfUrl`/`pdfName` (optional comprehensive PDF form, `workerAgreementGlobal/…`). Signed per contract onto `labor_contracts.agreement_*` columns (migration 0023).
- `settings/outsourceAgreement` — **the Out Source twin** (2026-09-05), same shape:
  `text`, `pdfUrl`/`pdfName` (uploaded to `outsourceAgreementGlobal/…`). **No migration** —
  `settings` is a key/value collection in the shim (`REG.settings`, `kv: true`), so a new doc id
  is just another key. An Out Source contract is a **vendor subcontract**, not employment: the
  employee manual's pages (grace periods, official tools, orientation, per-page employee
  sign-offs) are meaningless to a supplier, which is why the two are separate documents rather
  than one shared template. **Keep them apart.** The pair is declared once in `LC_AGR_TPL`
  (`expenses-module.js`) — settings doc id, global-template folder, signed-copy folder, default
  text — and everything else reads through `lcAgrTplCfg(category)`.
  - Signed copies land on the **same** `labor_contracts.agreement_*` columns for both kinds, but
    in **different storage folders**: `workerAgreements/…` vs `outsourceAgreements/…`, so a
    supplier's subcontract is never filed as an employee record.
  - `js/pm-admin.js` has **no loader of its own** — it calls `window.lcLoadAgrTemplate(category)`,
    exported by `expenses-module.js` (loaded first in `admin.html`). One source of truth: the same
    agreement must print from Project Management and Project Control. PM falls back to the global
    blank template when no signed PDF is attached, so a brand-new contract can still print a sheet
    to sign.
  - The template editor is reachable from the **Labor → Worker template / Out Source template**
    button in the Project Control toolbar (`portal-app.compiled.js`). Owner-only — it rewrites a
    document every printed contract inherits. Before this it had **no UI entry point at all**.
  - **The uploaded PDFs carry 41 AcroForm fields, identical in both templates**
    (read from `assets/Worker-Agreement.pdf` and `assets/Outsource-Agreement.pdf`,
    2026-09-05; the PDFs are gitignored, so the names are pinned as `PDF_FIELDS` in
    `tests/money-math.test.js`). `js/print-utils.js` `_dacsFillWorkerForm()` fills them:
    `contract_ref_no`, `project`, `worker`, `pay_type`, `contract_amount`,
    `scope_of_work_1..3`, `cover_project`, `cover_effective_date`,
    `downpayment_amount`/`_date`/`_mode`, `ack_employee_name`, `ack_project_branch`,
    `ack_position_trade`, `ack_orientation_date`, every `*_printed_name`, and every
    signature date. **Still blank by design:** `grace_period_minutes` and
    `official_tools` — company policy blanks no contract supplies.
  - **Every "PETSA" over a signature line prints TODAY's date** (`p03_date`…`p12_date`,
    `ack_date`), from `d.printDate`. This **reversed** the earlier hand-dating rule on
    2026-09-05 — twelve hand-dated lines per worker was the thing being fixed. Be aware
    it asserts a signing date: print today, sign Thursday, the paper says today. One
    regex in `_dacsFillWorkerForm()` matches all twelve, so narrowing it is how you
    hand-date any subset again. It deliberately does **not** match `ack_orientation_date`
    (contract data) or `downpayment_date` (a recorded payment).
  - **Page 4, "10% DOWNPAYMENT — UNANG BAYAD", has NO columns of its own.** It is
    derived at print time from the worker's **first recorded payment**:
    `lcFirstPayment()` (`expenses-module.js`) reads the earliest `payroll` row
    whose `contract_id` is one of the worker's jobs; `_pmFirstPayment()`
    (`pm-admin.js`) reads the earliest `weeklyBills.entries[]` labor line. Owner's
    call (2026-09-05): **the first payment IS the downpayment, whatever it is** —
    the "10%" in the heading is fixed text in the uploaded PDF, so the printed
    figure can disagree with it. Don't "fix" that into a computed `cap × 10%`.
    Amount ← `total_salary` / entry `amount` (legs of one `splitGroup` re-added),
    date ← `payment_date` / the bill's `week_ending_date`, mode ←
    `payroll.payment_method` — **PM prints no mode**, its entries have no such
    field. Indirect (overhead) rows and non-labor lines are excluded, and an
    unpaid worker prints a **blank** block, never `0.00`. This is the one place
    the agreement reads payments: it states a single payment as fact and totals
    nothing, so it stays outside the money model. §M of `money-math.test.js`
    fences all of it.
- other config: owner/staff only.

### `stats/{…}` — read-only aggregates (no client writes).

---

## 11. Attendance (`0050`, `0059`, `0061`) — worker Time In / Time Out

> **Deliberately isolated**, like `reimbursements` (0041), the warranty fund (0043) and
> `quotations` (0045). No money math reads these tables; attendance hours are **not** the basis of
> pay (labour is pakyaw, capped by `labor_contracts.agreed_amount`). Written only by the native
> Android worker app (via RPC) and read by `js/attendance-admin.js` (phase C).
>
> **One peso column exists**, added by 0066: `attendance_weekly_rewards.amount`, the value of a
> qualifying week. It is a **reported figure only** — nothing writes it to payroll, expenses or a
> journal, and nothing may make it do so. Payment happens outside this system; `paid` records that
> somebody says it happened and moves no money. This section previously said "there is no peso
> column here, so the staff amount-hiding rule does not apply", which stopped being true at 0066.
>
> **Whether staff should see that amount is an open question, not a settled one.** The hiding rule
> exists for owner-confidential money — contract values, budgets, client allocations. A worker's own
> attendance bonus is a different kind of figure, and hiding it would make the payroll CSV useless
> to the staff who work from it. It is currently **visible to staff**. Decide deliberately rather
> than by default.

**All worker writes go through `attendance_time_in()` / `attendance_time_out()`.** Workers hold `select`
on their own rows and have **no** `insert`/`update` policy at all — that is what forces the RPC path.
Both functions are **idempotent on a client-generated `event_id`**, so the Android offline queue can
replay a submission without duplicating it.

### The picker list — the **real** projects (`0059`)

`attendance_projects` **was dropped in 0059.** Attendance kept a third notion of "project"
alongside `folders` and `construction_projects`; it now uses those two directly, with the same
`system` discriminator `0031_expense_inbox.sql` uses for the same problem:

| `projectSystem` | id column | points at | module |
|---|---|---|---|
| `pc` | `timeinFolderId` | `folders` | Project Control |
| `pm` | `timeinPmProjectId` | `construction_projects` | Project Management |

A check constraint enforces that exactly one id is set and matches the system. Both FKs are
**`on delete set null`, not cascade** — the opposite of 0031, on purpose: an inbox item is
meaningless without its project, but an attendance record is a person's work history and must
survive the project being deleted. `timeinProjectName` keeps the row readable afterwards.

**`attendance_projects_for_worker()`** returns `(projectSystem, projectId, projectName)` — and
only those three columns. Workers must **never** get a `select` policy on `folders`: that table
is the Project Control project row and the money hanging off it (`folder_budgets.total_budget`,
contract values) is owner-confidential. A three-column security-definer function cannot leak a
fourth. Additional Works (`folders.parent_folder_id is not null`) are excluded — an AW folder is
extra scope billed against the same physical site, not a second place a worker can stand.

The two systems are scoped **differently**, and the function mirrors each one's own rule rather
than inventing a stricter one: `folders` is owner-scoped (`folders_rw` uses `can_access(owner_id)`),
while `construction_projects` is **role**-scoped (`cproj_admin` is `is_owner() or is_staff()` with
no owner filter, and `owner_id` is nullable — many live rows carry NULL).

**Hiding a site from workers (`0072`).** `attendance_project_config.attendanceEnabled` (added in
0065, default `true`, unread until 0072) switched off removes that site from
`attendance_projects_for_worker()`. No config row means **shown**. It is a **picker rule, not a
refusal**: `attendance_time_in` / `attendance_time_out` and `attendance_project_name` are untouched,
so an offline Time In captured before the site was hidden still lands, and a worker on site can
always time out. Set via `attendance_project_set_hidden(system, projectId, hidden)` (owner/staff,
through the 0070 `attendance_schedule_owner` guard). Hiding a site with no config row creates one
with the default Mon–Fri `workingDays` — the same week an unconfigured site already had.

**`attendance_projects_for_admin()`** — owner/staff only (`NOT_ADMIN` otherwise). The same list plus
a `hidden` boolean, and it **ignores `require_geofence`**. The admin Sites screen reads this, never
the worker picker: reading the picker made a hidden site — or one still waiting for its geofence —
vanish from the one screen that can fix it. The Today by-site board still reads the worker picker
on purpose: a hidden site with nobody on it is not drawn, one with crew still is (from the records).

**Minimum worker-app version (`0077`).** `attendance_config.minAppVersion` (integer, default `0` =
off). From versionCode 2 the Android app sends `x-dacs-app-version` on every request; the
`attendance_records_app_version` BEFORE trigger raises `APP_UPDATE_REQUIRED` when the **worker
writing their own row** declares a lower version (no header = 0). Admin writes (`attendance_abandon`)
are never checked. **Ships off** — every pre-v2 phone sends no header, so raise it only after the new
APK is on every phone. A refused row stays queued on the phone and is sent after the update.
**Turn it on with an UPSERT, not an UPDATE** — as of 2026-09-27 `attendance_config` has **no rows**
(every setting runs on its defaults), so the `update` shown in 0077's header changes nothing:
`insert into attendance_config (owner_id, min_app_version) values ('<owner uuid>', 2) on conflict (owner_id) do update set min_app_version = excluded.min_app_version;`

**Two worker apps (`0082`).** DAC'S WorkMate (Flutter, Android id `com.dacs.workmate`) runs beside
the old DACS Attendance app (`com.dacs.attendance`) on the same backend. WorkMate sends
`x-dacs-app: workmate`; no header means `attendance`, so old phones are unaffected
(`dacs_request_app()`). Each app has its own minimum: `attendance_config.minAppVersion` (Attendance)
and `minWorkmateVersion` (WorkMate), chosen by `attendance_required_app_version(owner)` inside the
0077 trigger. **WorkMate versionCodes start at 1000; Attendance stays below 1000.** The database
enforces this, because 0078 trusts the phone clock for builds below 3 and `timeinAppVersion` stores
the number without an app name. The Time In / Time Out gate enforces the same floor: `attendance_required_app_version` never returns less than 1000 for WorkMate, even before its first publish (`minWorkmateVersion` = 0). `app_releases` has an `app` column and the key `(app, version_code)`;
Attendance files are `<code>.apk`, WorkMate files `workmate/<code>.apk`. Old phones call
`app_latest_release()` (Attendance stream only); WorkMate calls `app_latest_release_for('workmate')`.
`app_publish_release(..., p_app)` raises only that app's minimum. The publisher
(`js/app-updates-admin.js`) reads the package name from the APK and picks the stream itself.

**Trusted time and `unverified` reward days (`0078`).** From versionCode 3 the app sends
`p_trusted_at`: the shutter time measured on the phone's uptime counter from the last server `Date`
header, which changing the phone's clock cannot move (`TrustedTime.kt`). Stored as
`timeinTrustedAt` / `timeoutTrustedAt`, with the sending build in `timeinAppVersion` /
`timeoutAppVersion`. `attendance_week_days` judges lateness on `attendance_vouched_time()`: trusted
time → else (build < 3) the phone's time, as before → else the phone's time if it arrived within
3 minutes → else **`unverified`**. A Time In with a **known-bad** location (`outside_radius`,
`mock_location`, `permission_denied`) is also `unverified`. `unverified` = a day worked that cannot
earn the bonus; it disqualifies the week and is counted in `attendance_weekly_rewards.unverifiedDays`,
never as late or missing. A phone that claims offline but uploads within 3 minutes is judged live by
the geofence. **Apply 0078 before installing versionCode 3.**

### The location verdict, on screen (`0068` / `0069`)

`timeinLocationStatus` / `timeoutLocationStatus` are **shown in the admin screens**, not just
stored: a badge on the Today row and the report table, a sentence on the worker drill-down, and two
raw columns (`Location check`, `Metres from site`) in both CSV exports. Until 2026-09-15 nothing
read them, so a Time In that was never location-checked looked exactly like a verified one.

**Two colours, and the split is the server's own rule.** Red only where the phone could *prove* the
worker was elsewhere or the reading was refused outright (`outside_radius`, `mock_location`,
`permission_denied`, `location_disabled`); gold where it simply could not tell (`low_accuracy`,
`location_unavailable`, `project_geofence_unavailable`). Only the red half reaches the Today
screen's "needs you" list — a weak fix happens daily on cheap handsets, and a list full of it is a
list nobody reads. An **unrecognised** code is displayed, never swallowed: 0068 deliberately put no
check constraint on the column so later codes can arrive.

### `attendance_records/{id}` — one row per worker per work date
| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `ownerId`, `workerId` | uuid | |
| `workerName`, `workerPosition` | string | **snapshot** at Time In — a rename must not rewrite history |
| `workDate` | date | `(captured_at at time zone 'Asia/Manila')::date`, computed **server-side**. PH is UTC+8; a UTC date key rolls back a day |
| `sessionSeq` | number | always `1` in the MVP; reserved so split shifts need no data migration |
| `status` | string | `working` \| `complete` \| `abandoned`. **`no_record` is the absence of a row**, never stored |
| `timeinProjectSystem` | string | `pc` \| `pm` — which project system the id below belongs to |
| `timeinFolderId` / `timeinPmProjectId` | uuid | exactly one is set, matching `timeinProjectSystem`. `on delete set null`. **All three may be null** on a row recorded before `0059`, or one whose snapshotted name no longer resolves — `timeinProjectName` is then the only project reference. Rows written since always carry a system |
| `timeinProjectName` | string | **snapshot** at Time In — survives a rename or a deleted project |
| `timeinAt` | ts | the worker's captured instant |
| `timeinPhotoPath` | string | `attendance` bucket object path, **not** a URL |
| `timeinDescription` | string | optional |
| `timeinLat`, `timeinLng`, `timeinAccuracyM` | number | nullable, **admin-only** — never shown to the worker |
| `timeinEventId` | uuid | client-generated at tap; **unique**. The idempotency key |
| `timeinWasOffline` | boolean | captured with no signal |
| `timeinReceivedAt` | ts | server clock. Skew vs `timeinAt` is only meaningful when `wasOffline` is false |
| `timeout*` | — | same shape, all nullable (including the three project columns). **Stored independently** — the worker may change site mid-day |
| `totalMinutes` | number | computed **server-side** on Time Out, so worker and admin cannot disagree |
| `abandonedBy` | uuid | **(0061)** the admin who closed a forgotten Time Out. `on delete set null` — removing an admin account must not erase the record they closed. A **lookup**, not a snapshot like `workerName`: the closer's *current* name is the useful one, and A2 resolves it against `profiles` at render time |
| `abandonedAt` | ts | **(0061)** server `now()`, never a browser clock |
| `abandonedNote` | string | **(0061)** optional reason, trimmed; empty becomes null |

`unique (worker_id, work_date, session_seq)` is the one-record-per-day guarantee. A Time Out more
than **18 hours** after its Time In raises `SHIFT_TOO_LONG` rather than silently recording a
forgotten-clock-out as a 33-hour day.

`attendance_abandon_trail_ck` allows the three `abandoned*` columns only on a row whose status is
`abandoned`. Deliberately **not** the converse — a row may be `abandoned` with an empty trail. None
exists (nothing could set the status before `0061`), but `0059`'s header records what assuming an
attendance table was empty cost last time.

### `attendance_abandon(recordId, note)` — closing a forgotten Time Out (`0061`)
A worker who times in and never times out leaves a record on `working` **forever**: every report
shows `—` for that day and A1 counts them as still on site months later. This is the only thing that
writes `abandoned`.

**It invents no hours.** `timeoutAt` and `totalMinutes` stay null, so the day still reports `—`. The
record stops claiming the worker is on site; it never starts claiming when they left. There is
deliberately no way to type in a departure time — it would be indistinguishable from a captured one
in every report and export.

Guards, in order: `AUTH_REQUIRED` → `NOT_ADMIN` (owner/staff only — a worker cannot close their own
day) → `RECORD_NOT_FOUND` (also the answer for another tenant's record) → `NOT_OPEN` (status is not
`working`) → `STILL_TODAY` (`work_date >= ` the **Manila** date; that worker is probably on site, and
closing it would break their Time Out, which only closes rows on `working`).

> **Why an RPC when owner/staff already hold `attendance_records_admin_update`?** `abandoned_at`
> must be the server's `now()` and `abandoned_by` must be `auth.uid()`. A browser-supplied trail is
> a trail the caller *chose* — worthless exactly when it matters. The admin update policy is left
> as it is; `0061` adds the good route without breaking the old one.

### `attendance_terms_acceptances/{id}` — versioned T&C acceptance
| Field | Type | Notes |
|---|---|---|
| `workerId` | uuid | |
| `termsVersion` | string | unique with `workerId`; changing the Terms forces re-acceptance |
| `acceptedAt` | ts | the Profile screen shows the newest |

The fast "has accepted?" flag only. The **evidence** belongs in `agreement_events` (0021) with
`audience='worker'`, `doc_type='attendance_terms'` — same split that table's header prescribes.

### Storage
Private bucket `attendance`, path `{worker_id}/{work_date}/{in|out}-{event_id}.jpg`. Worker policies
are scoped to their own uuid prefix. A worker may **replace** their own photo (`attendance: worker
replaces own photo`, UPDATE, recorded in `0083` after it was found live-only): both worker apps upload
with `upsert`, so a retry after a failed Time In RPC overwrites the same path. There is **no `delete`
policy**. Photos are files, never base64.

---

## 12. ⚠️ Defined in rules but UNUSED by code (planned SOA module)
`soa_requests`, `soa_records`, `payments`, `billings` have full security rules in `firestore.rules` but **no JavaScript references them**. Either finish the module or remove the rules to shrink attack surface. (The live "SOWA" feature uses `sowaRequests` — camelCase — instead.)

---

## 13. WorkMate Requests (`0085`) — material/tool requests from DAC'S WorkMate

Stage 1a-1 server (plan `docs/superpowers/plans/2026-10-02-workmate-stage1a1-requests-server.md`). **Project Control only. No money anywhere** — no `pr_*` column holds a price, amount or cost. **Workers never read or write `pr_*` tables directly**: RLS is on and no `pr_*` policy grants a worker anything; every worker action is a `SECURITY DEFINER` RPC. Owner/staff read everything; they change everything only through the office RPCs (since 0086) (request data changes through RPCs).

| Table | What it is |
|---|---|
| `pr_teams`, `pr_team_members` | Teams; membership history (`removed_at`); one current leader per team (`is_leader`). Acting for a team needs the leader row **and** profile role `teamLeader` |
| `pr_catalog_items` | Official items: `kind` material/tool, `name`, `spec`, `unit`, `category`; one active row per identity; 0090: `aliases` text[] and `brand` (search aids, not identity) |
| `pr_project_settings` | `allow_requests` per top-level project folder (cascades with the folder) — opens a project to requests even with no geofence yet or when hidden from Time In. Without it, a project is requestable only if it is on today's Attendance picker list (geofence rule met and not hidden); 0090: `allow_history` (Find Previous Item, off by default, independent of allow_requests, survives completion) |
| `pr_batches` | One per weekly cutoff: **Saturday 12:00 noon Asia/Manila** (`cutoff_at`), default `purchase_on` = Monday, `delivery_on` = Wednesday; editable by the office |
| `pr_requests` | One destination (`folder_id` = project, `work_folder_id` = project itself for Main Contract or a child Additional Works folder), optional `team_id`, `client_op_id` (unique per requester), server `received_at` |
| `pr_lines` | Stable-id items: kind, optional `catalog_item_id`, description/spec/unit/category, optional `intended_member_id` (materials), per-line `urgent` + reason + `needed_by`, `version`, `has_conflict`; 0090: `ref_kind`/`ref_id` = the history entry a Request Again line came from (both or neither) |
| `pr_line_portions` | A line's quantity by batch. `arranged_at` set by the office; `pending_reduction` = quantity a worker reduced that was already arranged (office to act). **Still needed = Σ(quantity − pending_reduction)** |
| `pr_line_conflicts` | An edit made against an outdated `version` — both values kept for the office |
| `pr_events` | Append-only history (submitted, quantity_changed, quantity_conflict, line_cancelled, request_cancelled, photo_attached) |
| `pr_ops` | First result per `(actor_id, op_id)` — a retried phone operation returns it verbatim |
| `pr_photos` | Private request photos, bucket **`request-photos`** (`{requester}/{request}/{photo}.jpg`; requester, current team leader, owner/staff); 0090: `gallery_review` published / kept_private + who/when |
| `pr_item_refs` (0090) | Hand-entered **historical references**: item, project + Main Contract/AW, description, `ref_date` + `date_precision` exact/approximate/unknown, `source_note`. No expense, stock or purchase. Retired with a reason, never deleted; cascade with their project |
| `pr_gallery_photos` (0090) | Reviewed product photos in private bucket **`item-gallery`** (`<owner>/<item>/<uuid>.jpg`): source upload / request_photo (a COPY) / reference, `checklist_confirmed`, one approved `is_cover` per item; `cover_set_by/at` who made it the cover; approved/retired with who, when, why |

Every `pr_*` office policy is tenant-scoped with `can_access` (`pr_ops` via its actor's owner), and worker write RPCs serialise retries of the same operation with an advisory lock.

Worker RPCs: `pr_destinations()`, `pr_my_teams()`, `pr_catalog()`, `pr_submit_request(op, request)`, `pr_change_quantity(op, line, base_version, quantity)`, `pr_cancel_line(op, line)`, `pr_cancel_request(op, request)`, `pr_my_requests(limit)` (since 0106 each line and weekly portion also carries `from_stock`: what the office issued from stock for it — 0 while stock is off), `pr_attach_photo(op, request, line, path)`. Completed projects / Additional Works refuse new requests and quantity increases (decreases, cancels and reading stay). PM projects are never destinations. A worker's cancel of the last open line closes the request (0088); cancelling something already cancelled succeeds without change.

**Legacy `requests` / `request_items`** (Flutter-prototype era) are read-only history since `0085`: owner/staff full access; a worker reads only their own rows and writes nothing.

### Office RPCs (0086)

Every office write is a `SECURITY DEFINER` RPC that refuses non-office callers (`OFFICE_ONLY`) and other companies' rows (`NOT_FOUND`). Line and portion writes lock the `pr_lines` row before its portions (cancel locks the request first, the same order as the worker's `pr_cancel_request`) and record a `pr_events` row; batch, team, catalogue and project settings have no request to record against. Read RPCs return names only — no contact details, no money.

| RPC | What it does |
|---|---|
| `pr_office_queue(scope)` / `pr_office_request(id)` | Requests with lines, portions (with batch dates), open conflicts, photos; the single read adds the history. 'open' = an open line, a pending reduction or an unresolved conflict (a cancelled request with an order still to undo stays open). |
| `pr_office_set_arranged(portion, bool)` | Mark arranged / undo (undo refused while a reduction is pending) |
| `pr_office_resolve_reduction(portion, outcome, note)` | `order_reduced` or `kept_as_surplus`; the portion keeps only what is still needed |
| `pr_office_change_quantity(line, qty, reason)` / `pr_office_cancel_line(line, reason)` | Reason required; version rises so an older offline edit becomes a conflict |
| `pr_office_resolve_conflict(conflict, apply, note)` | Apply the worker's number or keep the current one |
| `pr_office_match_item(line, item)` | Match a line to an active catalogue item of the same kind (null unmatches) |
| `pr_office_move_portion(portion, batch, note)` | Move an **unarranged** portion to another weekly batch (merges with that batch's unarranged portion) |
| `pr_office_batches()` / `pr_office_set_batch_dates(batch, purchase, delivery)` | Batches from 35 days ago on (this week + next two always exist); only purchase/delivery dates change. **0086 dropped the direct insert/update policies on `pr_batches` and on the four setup tables (teams, members, catalogue, project settings)** |
| `pr_office_people/teams/save_team/add_member/remove_member/set_leader` | Teams; a leader must hold the teamLeader role and be a current member |
| `pr_office_catalog/save_item` | Catalogue; the same name + spec + unit is refused (`DUPLICATE_ITEM`). Since `0092`: once any request line uses an item, a Kind or Unit change is refused (`ITEM_IN_USE` — add a new item, deactivate the old); `pr_office_catalog` returns `in_use`. Since `0104`: stock counts as use too (a match, a lot or a stock record) |
| `pr_office_projects/set_allow_requests` | Top-level Project Control projects and the *Allow requests* switch |
| `pr_folder_request_count(folder)` | Requests on a folder or its children — Dacs Web refuses to delete a project / Additional Works that has any |

### Item history (0090)

Who sees what is decided in one place, `pr_history_entries(owner, viewer, office, item)`: a worker sees a request line matched to a catalogue item when it is **their own** or its project has **Allow item history** on, and a **non-retired** reference on such a project; Additional Works follow their parent. Workers never get requester names, line notes, raw request photos or retired items.

| RPC | Who | What it does |
|---|---|---|
| `pr_history_search(query, kind, category, folder, from, to, limit, offset)` | worker | Item cards with cover and latest visible entry; 30 per page (max 50) + `has_more` |
| `pr_history_item(item, folder)` | worker | Photos + dated entries (Requested / Requested — cancelled / Historical reference); `HISTORY_NOT_AVAILABLE` if none visible |
| `pr_history_visible(items[])` | worker | For each still-visible saved item: visible entry keys + approved photo ids (phone deletes the rest); max 500 |
| `pr_submit_request` (re-declared) | worker | Lines may carry `ref_kind/ref_id`: malformed or unknown → `BAD_REFERENCE`; no longer visible or now another item → saved without the link |
| `pr_office_set_allow_history`, `pr_office_history_search/item` | office | Switch; search including items with no history; detail with requester names and retired rows |
| `pr_office_save_item` (re-declared) | office | Gains optional `p_aliases` / `p_brand` (null = unchanged); 7-arg calls still work |
| `pr_request_doc`, `pr_office_projects`, `pr_office_catalog` (re-declared) | office | `pr_request_doc` lines gain `ref_kind`, `ref_id`, `ref_label` (from `pr_ref_label`; since `0091` a cancelled source line reads "Requested — cancelled"); `pr_office_projects` gains `allow_history`; `pr_office_catalog` gains `brand`, `aliases` |
| `pr_office_add_ref`, `pr_office_retire_ref` | office | Reference on a project or its own AW; retire needs a reason |
| `pr_office_photo_queue`, `pr_office_publish_photo`, `pr_office_keep_private` | office | Review private request photos on matched lines; publishing records an already-uploaded COPY after the checklist |
| `pr_office_add_gallery_photo`, `pr_office_set_cover`, `pr_office_retire_photo` | office | Direct uploads (optionally for a reference), cover, retire with reason (cover passes to the newest approved) |

Storage — `item-gallery`: the office of the company inserts/reads `<owner>/<item>/…`; a worker reads only an approved photo of an item with a visible entry; no update/delete for anyone.

## 14. WorkMate My Work (`0093`) — meetings, tasks and work checks

Stage 1c-1 server (plan `docs/superpowers/plans/2026-10-12-workmate-stage1c1-my-work-server.md`). **Project Control only. No money.** Workers reach nothing directly: every `wp_*` table is RLS-on with office SELECT policies only; workers use `SECURITY DEFINER` RPCs that re-check their role on the task when they run.

| Table | What it is |
|---|---|
| `wp_meetings` | Title, `held_on`, **office-only** `original_notes`, `current_version` (0 = never published) |
| `wp_meeting_versions`, `wp_note_recipients` | Each publish of shared notes is a version; recipients chosen by staff (default: people assigned in that meeting). Workers read only the latest version they received |
| `wp_tasks` | One project + Main Contract/AW (`folder_id`, `work_folder_id`), optional `meeting_id` (null = standalone) and `team_id`; status draft/not_started/in_progress/reported_done/leader_checked/completed/cancelled; `sent_back`; `version` (0 = draft, raised by an important revision); office-only `source_passage`, `office_flags`, `proposed_by` |
| `wp_task_people` | One current `responsible` + `helper`s; removal sets `removed_at` |
| `wp_acks` | Acknowledgement per person per task **version** |
| `wp_blockers` | materials/tool/preparation/other, optional `request_id`; cleared only by the office with `clear_note` |
| `wp_dependencies` | Task waits for another task of the same project; no cycles |
| `wp_events` | Append-only history (drafted, published, revised, acknowledged, started, progress, blocker_reported/cleared, reported_done, leader_checked, sent_back, approved, reopened, cancelled, proposed, photo_attached, notes_published) |
| `wp_ops` | First result per `(actor_id, op_id)` — a retried phone operation returns it verbatim |
| `wp_photos` | Private bucket **`task-photos`** (`<uploader>/<task>/<uuid>.jpg`): uploader, responsible, current team leader, office |

**Blocked** is derived (`wp_task_blocked`): an open blocker or a dependency not `completed`. It locks Start work, Report done and office approval.

| RPC | Who | What it does |
|---|---|---|
| `wp_my_work()`, `wp_my_notes()` | worker | Tasks with a role (responsible/helper/current leader); latest received shared notes |
| `wp_acknowledge(op, task, version)` | assigned | Outdated version → `stale` answer, nothing recorded |
| `wp_start_work`, `wp_report_progress`, `wp_report_done` | responsible | Start/Done refused while blocked (`TASK_BLOCKED`); Start also needs the current version acknowledged (`NOT_ACKNOWLEDGED`) |
| `wp_report_blocker(op, task, kind, description, request)` | any role | Never creates a purchase or moves a date |
| `wp_leader_check(op, task, note)` | current leader | Never work they are assigned to — responsible or helper (`OWN_WORK`); office approval still required |
| `wp_propose_task(op, team, folder, work, title, details)` | current leader | Arrives as a draft for the office |
| `wp_my_proposals()` (0094) | worker | The caller's own proposals (last 90 days): `sent` / `published` / `declined` / `cancelled`, the office's reason, when decided — no office-only fields |
| `wp_office_save_task` (replaced in 0094) | office | Full save; on a published task people / team / planned-date changes always raise `version`, wording changes unless `minor_text_only`; history note `Changed: …` |
| `wp_attach_photo(op, task, blocker, event, path)` | any role | Upload first, then attach |
| `wp_office_destinations/meetings/meeting/save_meeting/save_task/publish/board/task` | office | Plan, publish (version 1, recipients), board with `blocked` / `not_acknowledged_24h` / `overdue` |
| `wp_office_clear_blocker/approve/send_back/reopen/cancel` | office | Note/reason required where it matters; cancel refused while another task waits for it |

## Relationship map
```
users(owner) ──owns──> folders ──> projects ──> expenses / payroll
   │  ownerUid           │  └─ projectBudgets 🔒        
 staff/workers           └─ folderBudgets 🔒
                         │
boqDocuments ──folderId──┘   (clientEmail copied up to folder → client read unlock)
   └─ clientEmail ──────────────> clientUsers (email match)

constructionProjects ──> weeklyBills / procurementList / revolvingFund* / logs
   └─ clientEmail ─────> constructionClientUsers
   └─ id ──────────────> paymentRequests (constructionProjectId)

requests ──batchId──> batches ;  delivered items ──> inventory
notifications/{uid}/items  = glue between admin & client
```

## AI request gate (0095)

| Object | Purpose |
|---|---|
| `ai_requests` (`owner_id`, `user_id`, `feature` `budget_summary`/`work_plan_draft`/`health_briefing`, `input_chars`, `created_at`) | One row per allowed AI request; never the text; RLS on with no policy (no client access); rows older than 30 days removed |
| `ai_authorize(p_feature, p_chars)` | Called by the `dacs-ai` worker as the caller: active account, feature allowed for the role and `allowed_modules`, size, per-person and per-company limits; raises `AI_NOT_SIGNED_IN` / `AI_NOT_ALLOWED` / `AI_TOO_LARGE` / `AI_RATE_LIMITED` |

## Purchases (0096) — WorkMate Stage 2A-1

One recording operation for every purchase, shared by Dacs Web (Expenses → Add expense) and, later, the WorkMate buyer app. Spec `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md` §3; plan `docs/superpowers/plans/2026-10-14-workmate-stage2a1-purchase-recording.md`. RLS: owner and their staff read (`can_access`); nobody writes directly — only the functions. Callers: active owner/staff accounts allowed the **Expenses** section; source `workmate` is refused until the Buyer switch (2A-2).

| Object | Purpose |
|---|---|
| `purchases` (`owner_id`, `source` `expenses_form`/`workmate`, `purchase_date` = the ACTUAL purchase date, `date_time`, `supplier`, `receipt_total`, `notes`, `payment_method`, `docs` {po/dr/si/payment receipt URLs}, `status` `recorded`/`void`, `recorded_by`) | One receipt |
| `purchase_lines` (`purchase_id`, `line_no`, `destination` `project`/`warehouse`, `folder_id` + `folder_name` — history, **no foreign key**, `item_name`, `category`, `quantity` (up to 3 decimals), `unit`, `gross_amount`, `in_inventory`, `min_stock`, `needs_funding_review`) | What was bought, for which project (Main Contract or Additional Works folder). Warehouse lines write no expense rows |
| `purchase_charges` (`kind` `delivery_fee`/`discount`, `amount`) + `purchase_charge_shares` (`charge_id`, `line_id`, `amount`) | A shared fee or discount and how it is split across lines (default: by line amount, to the centavo by largest remainder — never a negative share, always exactly the charge) |
| `purchase_history` (`kind` `recorded`/`corrected`/`refunded`/`voided`/`replaced`, `reason`, `before`, `after`, `actor_id`) | Never edited |
| `pur_ops` (`actor_id`, `op_id`, `kind`, `result`) | First answer per operation id — a retry or an overlapping call returns it, nothing is recorded twice. Since 0106 a row of kind `cancelled` marks an id the phone cancelled (`pur_op_cancel`): every write refuses it (`OP_CANCELLED`) |
| `purchase_stock_moves` (`line_id` **primary key**, `inventory_id`, `quantity`, `moved_at`) | The "track in inventory" stock added for a line — once, ever. Stock items are matched within the company: its own item, else an unowned one (the old browser mirror wrote items with no owner), never another company's |
| `pur_record(p_op, p_body)` | Records a purchase and writes its `expenses` rows: per project line, the net amount (item − discount shares) funded by the **actual purchase month** — that month's client periods with a budget (this company's, this project's), **earliest billing number first**, each up to budget − expenses − payroll; shortage → Cover (`cover_expense = true`, on the project's Cover period, else a client period of **that month only** — never another month's); no eligible period that month → all Cover and `needs_funding_review`; **no Cover period and no billing period in the purchase month** → one Cover row tied to the project (`folder_id`), flagged. Additional Works → their own period in full. Fee shares → "Delivery fee (share)" rows, funded the same way. Adds stock for "track in inventory" lines. Refuses: totals ≠ receipt, shares ≠ charge, discount > line, sub-centavo or negative amounts, another company's project, staff on a completed project (or an Additional Works job under one) |
| `pur_correct(p_op, p_purchase, p_body, p_reason)` | Same lines, new content: the purchase's rows are replaced and re-funded in one transaction; reason required. Moving a line to another project, or any change on a completed project, is owner-only. Stock already moved is not moved again |
| `pur_refund(p_op, p_purchase, p_reason)` | Re-funds a purchase as it stands — e.g. after the office adds the billing period a "No billing period" line was waiting for. Same purchase date, same total; only where the pesos are charged changes |
| `pur_void(p_op, p_purchase, p_reason)` | Its rows leave Spent; purchase, docs and history stay. Not a return or a refund; stock is not taken back |
| `pur_replace(p_op, p_purchase, p_body, p_reason)` | A new version with a different number of lines: the old purchase is voided (`replaced_by`) and the new one recorded in ONE transaction; stock the old one moved is carried over to the new lines of the same item, never added twice. Same owner-only rules as a correction |
| `pur_live_purchases(p_folder, p_period)` | How many live purchases touch this project or any of its Additional Works jobs (any line, even discounted to zero) or this period — asked by Dacs Web before deleting anything |
| `folders_purchase_delete_guard`, `projects_purchase_delete_guard` (triggers) | Refuse deleting a project or period with a live purchase, BEFORE its cascade removes anything (`PURCHASES_LIVE`) |
| `pur_reader()` | The read rule of every purchase table: an active owner/staff account allowed the Expenses section (the same as recording). **Narrowed by 0097** to those who may buy — see below |

## Purchasing tab and Buyer switch (0097) — WorkMate Stage 2A-2

The office side of buying: who may buy, who is buying which part of a request, and what each purchase covered. Spec `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md`; answers `docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md`; plan `docs/superpowers/plans/2026-10-16-workmate-stage2a2-purchasing-office.md`. Nothing here changes how a purchase becomes Spent (0096). RLS: SELECT policies only; every write is a function.

| Object | Purpose |
|---|---|
| `pur_buyers` (`user_id` PK, `owner_id`, `is_buyer`, `updated_by`, `updated_at`) + `pur_buyer_events` | The per-staff **Buyer** switch and its history. Set only by the main owner (`pur_set_buyer`), for their own staff |
| `pur_buyer()` / `pur_can_buy(user, owner)` | Who may BUY: an active owner account, or that owner's active staff with the switch on (also an office account, `pr_is_office()`) — in both cases allowed the **Expenses** section (an account focused elsewhere, e.g. `admin-pm@`, cannot), inside its own company. Linking a purchase line to a request, picking portions or taking a portion over needs it **whatever the source** — the Expenses form included; so does dropping a link (`pur_links_dropped`). A NEW link to a cancelled request line is refused (`LINE_CLOSED`); a purchase already linked still corrects |
| `pur_reader()` (0096, narrowed) | Now `= pur_buyer()`: purchase rows (`purchases`, lines, charges, shares, history, covers) are read only by those who may buy. Staff without the switch read none — Project Control's entry reads its one line through `pur_entry_row` |
| `suppliers` (`owner_id`, `name`, `branch`, `contact`, `active`; unique per company by name + branch) | The supplier list. Buyers read and add (`pur_suppliers`, `pur_save_supplier`). Old purchases keep their typed supplier text |
| `pr_line_portions.buyer_id` / `assigned_by` / `assigned_at` | Who is buying a portion (null = unassigned). `pur_assign_portion(portion, buyer, quantity, note)`: the owner assigns or reassigns anything; a buyer claims an unassigned portion ("I'll buy this"), gives one to another buyer, or releases their own. Part of a portion is split off; a partly bought portion keeps its bought part with whoever bought it. Logged in `pr_events` (`portion_claimed` / `portion_assigned` / `portion_released`) |
| `purchases.bought_by` / `supplier_id`; `source` adds `purchasing` | Who actually bought (the encoder stays `recorded_by`; only the owner records for someone else) and the supplier picked from the list |
| `purchase_lines.request_line_id`, `portion_picks`, `covered_qty`, `extra_qty` / `extra_reason` / `extra_location`, `unit_check` (`none`/`pending`/`confirmed`) / `unit_covers` / `unit_checked_by` / `unit_checked_at` / `unit_note`, `unplanned_reason`, `substitute` / `substitute_reason` | A line's request (same project and work), what it covered, the extra beyond Still to buy (reason and location required; the location — same project or warehouse — never moves the cost), a different unit or a **substitute** (an important specification differs; reason required) waiting for an office check, or the reason for a purchase with no request |
| `purchase_line_covers` (`line_id` → cascade, `request_line_id`, `portion_id` → set null, `buyer_id`, `quantity`) | Which portions a line covers. Rebuilt from the stored lines by `pur_cover_lines` whenever the purchase is recorded, corrected, replaced, voided or unit-checked — in the same transaction as its expense rows. **Picked portions are authoritative** (only they are covered; the rest is extra). Otherwise a line's earlier covers (`pur_cover_history`) come first — the same portions and at most the same quantity of each — and other portions are covered only for quantity a change ADDS: a price fix, even after an earlier purchase is voided, never moves coverage between weeks. A portion newly picked in a correction is checked like one picked when recording (never another buyer's, except by the owner). Only RECORDED purchases count (`pr_portion_bought`, `pr_line_bought`), so Bought is never doubled and Still to buy never negative |
| `pur_check_unit(op, purchase, line_no, covers, note)` | The office confirms how much a different-unit or substitute line covers, in the request's unit. Never by its own buyer or recorder, except the owner; history kind `unit_checked`; counts as a change to the purchase (`updated_at`) |
| `purchase_change_requests` (`purchase_id`, `kind` `correct`/`replace`/`void`, `body`, `reason`, `base_updated_at`, `base_doc`, `requested_by`, `status` `pending`/`approved`/`rejected`/`withdrawn`/`stale`, `decided_by`, `decision_note`, `result`) | A staff change only the owner may make (another project, a completed project). One pending per purchase. `base_doc` = the purchase (`pur_doc`) as the requester saw it; `pur_decide_change` applies only while the purchase still reads exactly the same (any correction, unit check or receipt → `stale`) and runs the very same `pur_correct` / `pur_replace` / `pur_void` as the owner. Staff without the switch cannot ask for a new request link, or drop one (`pur_links_changed`, `pur_links_dropped`) |
| `pur_change_requests(scope)` | Each request with `base`, `current` and `proposed` in `pur_review_doc`'s words (every header field, line, pick, receipt and fee split — the automatic split when none is given) and `changed_since`. An account that is neither the owner nor a buyer gets no `base` / `current` (its own `proposed` only) |
| `pur_shopping_list(batch, folder, scope)` | Open request lines with something still to buy, with their portions and who is buying each. Quantities and names only |
| `pur_purchases(...)`, `pur_purchase(id)`, `pur_buyer_options()`, `pur_me()`, `pur_office_buyers()`, `pur_withdraw_change(id)` | What the Purchasing tab and the Buyer switch read |
| `pur_entry_row(line, charge)`, `pur_review_lines()` | Project Control's data entry for every account that may record: the ONE purchase line behind an expense row with its purchase header and line / charge counts; the ids of lines flagged for office review. Nothing else; for an account that may not buy, a purchase that is not one line without fees comes back as its id and status only |
| Storage `uploads/purchases/<company>/<yyyy-mm>/<uuid>.jpg` | One receipt per purchase, read and written only by `pur_buyer()` of that company — not by non-buyer staff, workers, clients or partners. Dacs Web never signs a link for this folder: it downloads with the viewer's session, so Storage checks the rule on every view (`supabase-config.js` §11b). `receipt_uploads` accepts kind `purchase` |
| Changed 0085/0086/0096 functions | `pr_apply_quantity` (bought quantity is protected like arranged: reduced only by flagging), `pr_office_move_portion` (`BOUGHT`), `pur_reader` (buyers only), `pur_actor_owner` (sources `purchasing`/`workmate` need the switch), `pur_store`, `pur_insert` (7 arguments), `pur_correct` (keeps a line's request link when the body leaves it out — Project Control's form — and its covers' portions), `pur_replace` (voids first, keeps covers' portions, the old buyer and the supplier), `pur_doc`, `pur_header_ok`, `pur_body_keys` / `pur_stored_keys` (`pr_line:` locks) |

## Phone purchasing (0101) — WorkMate Stage 2A-3a

What buying from the WorkMate phone needs from the server. Spec `docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md`; answers `docs/superpowers/specs/2026-10-20-workmate-stage2a3-questions.md`; plan `docs/superpowers/plans/2026-10-20-workmate-stage2a3a-server-web.md`.

| Table / object | Columns and rules |
|---|---|
| `pur_signin_can_buy(user)` | **Service role only.** The `attendance-signin` Edge Function's buyer check: `pur_can_buy` in that account's own company (worked out as `data_owner_id()` does) — the same answer `pur_buyer()` gives the account signed in |
| `pur_fund` (0096, redefined, now VOLATILE) | An Additional Works job with no billing period gets ONE hidden period (`funding_type 'downpayment'`, the purchase's month and year, no budget row, no allocation snapshot) instead of `AW_NO_PERIOD`. Charged in full to it, never Cover, as before. The job's `pur_folder:` lock keeps it to one |
| `purchases.no_receipt_reason` (text, ≤ 300, default `''`) | Why a phone purchase has no receipt photo. Trigger `purchases_require_receipt`: a `workmate` purchase must keep an https link in `docs` or a non-blank reason (`NO_RECEIPT`), on insert and on every update of `docs` / the reason / `source`. Web sources keep receipts optional |
| `pur_insert` (0097, redefined) | Stores `no_receipt_reason` (`BAD_REASON` over 300). Nothing else changed |
| `pur_list_doc(purchase)` | One purchases-list row: 0097's row plus `no_receipt_reason` and `replaced_by`. Used by `pur_purchases` and `pur_my_purchases` (internal) |
| `pur_my_purchases(days default 60)` | Buyers only: what the caller bought or recorded, every status, purchase date within the last 1–366 Philippine days (`BAD_DAYS`), newest first, at most 300 |
| `pur_destinations()` | Buyers only: the company's open projects (name not blank) with their open Additional Works jobs (`works`), for the phone's record form |
| `pur_my_pending_changes()` | Any account that may record (0096's rule), buyer or not: the caller's OWN pending change requests — `id`, `purchase_id`, `kind`, `reason`, `requested_at`, and the purchase's `line_ids` / `charge_ids`. No amounts. Project Control and Expenses show "Waiting for the owner" on those rows and offer Withdraw (`pur_withdraw_change`) |
| `pur_purchase_view` (0097, redefined) | Adds `no_receipt_reason` |

## Paying for purchases (0102) — WorkMate Stage 2A-4a

Supplier payments, Overpaid, refunds and supplier credit, petty cash and "Company owes buyer". **Outside the money model:** nothing here writes or reads `expenses` or `payroll`; Spent, Earned and Profit never read these tables (CLAUDE.md). Answers `docs/superpowers/specs/2026-10-22-workmate-stage2a4-questions.md`; plan `docs/superpowers/plans/2026-10-22-workmate-stage2a4a-payments-server-web.md`.

Every table has RLS on, **no policies** and every privilege revoked: the screens read and write only through the functions below. Every write takes an operation id (`pur_ops`, 0096: a retry returns the first answer). Mistakes are **voided with a reason**, never edited or deleted. "Main owner" = 0098's `pm_main_owner_id()` (owner role, no `owner_id`, active) with the Expenses section.

| Table / object | Columns and rules |
|---|---|
| `purchases.payments_tracked` (boolean) | `false` on every purchase recorded before 0102 ("Payment not tracked" until a payment is recorded on it); `true` on every purchase since |
| `pur_payments` (`purchase_id`, `first_purchase_id` (never changes: a replacement moves `purchase_id` only, with one `payment_moved` history entry per payment), `amount` > 0, `paid_on`, `method` `cash`/`gcash`/`bank_transfer`/`check`/`other`, `source`, `person_id`, `credit_id`, `authorized`, `accepted_by`/`accepted_at`, `rejected_by`/`rejected_at`/`reject_reason`, `proof_url` (https or ''), `note`, `created_by`, void fields) | One payment on the WHOLE purchase (never per project). `source`: `petty_cash` / `own_money` (`person_id` = the staff buyer whose money), `company` (paid directly; `person_id` = who handed it over), `credit` (`credit_id`; not cash). `authorized` = the buyer's own-money switch was on; an unauthorized one counts in "Company owes buyer" only once the main owner accepts it; rejected (with a reason, `pur_reject_own_money`) it is never owed. Either decision is kept |
| `pur_supplier_credits` (`supplier_id`, `purchase_id` = the overpaid purchase it came from, `amount`, `note`, void fields) | A balance with one supplier. Left = `amount` − non-voided `credit` payments using it (`pur_credit_left`). A used credit is not voided (`CREDIT_USED`) |
| `pur_refunds` (`purchase_id`, `amount`, `funded_by` `petty_cash`/`own_money`/`company`/`credit`, `received_by` `petty_cash`/`company`/`buyer`, `person_id`, `received_on`, `note`, void fields) | Tied to the money that paid. Routes (check constraint): petty cash → back into the buyer's petty cash (cash held up) or the company; own money → the buyer ("Company owes buyer" down) or the company; company or credit → the company, or the buyer (company cash now held by the buyer). A credit-funded excess normally goes back to the supplier's credit (a new `pur_supplier_credits` row); a `credit` refund is the supplier paying it back in cash instead. Each `funded_by` part ≤ what that money paid (`OVER_SOURCE`); refunds + credits ≤ what is over (`OVER_RESOLVED`) |
| `pur_cash_issues` (`buyer_id`, `amount`, `issued_on`, `method`, `note`, `disputed_at`/`dispute_note`, `dispute_cleared_*`, void fields) | Petty cash the main owner gave a staff buyer. Counts at once; "I did not receive this" flags it and changes nothing |
| `pur_cash_returns` (`buyer_id`, `amount`, `handed_on`, `handed_to`, `photo_url`, `note`, `status` `reported`/`withdrawn`/`confirmed`/`rejected`, `decided_at`/`decided_by`/`decision_note`, void fields — confirmed only) | The buyer reports; only the main owner's confirmation lowers the balance, on the **confirmation** day (Philippine date) |
| `pur_cash_counts` (`buyer_id`, `counted_on`, `counted` ≥ 0, `note`, void fields) | A cash count: a record only, shown against the balance recorded that day |
| `pur_own_money` (`user_id`, `owner_id`, `allowed`, `updated_by`, `updated_at`) | The "May use own money" switch (main owner); history in `pur_money_events` (`own_money_on` / `own_money_off`) |
| `pur_buyer_repayments` (`buyer_id`, `amount`, `paid_on`, `method`, `note`, void fields) | The company repaying a buyer's own money. Never more than owed (`OVER_OWED`) |
| `pur_money_events` (`seq`, `kind`, `purchase_id`, `person_id`, `ref_id`, `amount`, `detail`, `reason`, `actor_id`, `at`) | Append-only history of all of the above (`HISTORY_IMMUTABLE`) |
| `pur_pay_state(purchase)` (internal) | `{state, tracked, due, paid, balance, excess, resolved, unresolved, over_resolved}`. `due` = receipt total while recorded, ₱0 once voided. `state`: `not_tracked`, `unpaid`, `partial`, `paid`, `overpaid` (unresolved excess), `void`, `void_paid` (voided, money to recover) |
| `pur_cash_raw(owner, buyer, upto)` (internal) | Petty cash recorded at the end of a day: issues + refunds received into petty cash − petty-cash payments − confirmed returns. A voided entry counts until the day it was voided (`pur_stood`), so a past day's closing never changes; the daily report shows the void as a reversal on its own day. Below 0 = the screens show ₱0 held and an "Unreconciled shortfall" |
| `pur_owes(owner, buyer)` (internal) | Authorized or accepted own-money payments − own-money refunds the buyer received − repayments |
| `pur_record` (0096, redefined) | Body `payments` (≤ 5): "paid now", saved in the SAME transaction as the purchase; a refused payment refuses the purchase. Needs the Buyer switch when it carries payments |
| `pur_header_ok` (0097, redefined) | A correction or replacement carrying `payments` → `BAD_PAY` |
| `pur_list_doc` (0101, redefined) | Adds `pay` (the payment state) — shown in the Purchases list and My purchases |
| `receipt_mark_attached` (0097, redefined) | Also marks a payment's proof and a return's photo attached |
| Trigger `purchases_pay_follow_replace` | When a purchase is replaced, its payments, refunds and credits move to the new version, with "not tracked" |
| `pur_cash_detail(owner, buyer)` (internal) | One buyer's cash summary with the last 90 days of petty cash given, returns, cash counts and repayments. Read by `pur_my_cash` (the buyer) and `pur_cash_buyer` (the main owner) |
| `pur_cash_detail` (0103, redefined) | Each return also carries `photo_url`, so a buyer sees the photo of their own return in "My cash" (the phone and Dacs Web) and the main owner sees it in that buyer's view. Still internal |
| `pur_list_doc` (0103, redefined) | Also `supplier_id` (the listed supplier), so the phone can pay from that supplier's credit from its saved copy of My purchases. Still internal |
| `pur_my_ops_done(op ids)` (0103) | Which of the caller's own operation ids `pur_ops` already holds (at most 200 asked). The phone finishes those before reading fresh balances, so a payment whose answer was lost is never counted twice |
| `pur_op_cancel(op)` (0106) | The phone's "Cancel it" for a stock submission whose answer was lost: under the operation's own lock, `recorded` (it was — nothing changes) or `cancelled` (the id is cancelled for good; a late request with it is refused). Only then may the phone let the person change or drop it |
| `pur_op_state(op)` (0106) | Read only: `recorded`, `cancelled` or `none` for the caller's own operation id (the phone's "Check") |
| Buyer reads and writes | `pur_pay`, `pur_void_payment` (the recorder or the main owner; `RESOLVED_FIRST` if a refund or credit already relies on it), `pur_purchase_payments`, `pur_credits`, `pur_my_cash`, `pur_cash_dispute`, `pur_cash_report_return`, `pur_cash_withdraw_return` |
| Main-owner reads and writes | `pur_cash_give`, `pur_cash_clear_dispute`, `pur_cash_void_issue`, `pur_cash_decide_return`, `pur_cash_void_return`, `pur_cash_count`, `pur_cash_void_count`, `pur_set_own_money`, `pur_accept_own_money`, `pur_repay_buyer`, `pur_void_repayment`, `pur_resolve_overpaid`, `pur_void_refund`, `pur_void_credit`, `pur_cash_tracker`, `pur_cash_buyer(buyer)`, `pur_overpaid` (with a suggested split: the latest payments first), `pur_cash_report(buyer, from, to)` (≤ 92 days; voided entries listed apart) |
| `pettyCash/<company>/<yyyy-mm>/<id>.jpg` (storage, R13) | A return photo. `uploads_can_read` (0097's, plus this branch first): only the main owner and the buyer who uploaded it (`pur_petty_reader`, by the upload ledger); written by buyers of the company; never overwritten. Ledger kind `petty_cash`. Payment proofs stay in `purchases/` |
| `pur_payment_badges()` | Owner accounts only: `{line or charge id: state}` for Project Control's Unpaid / Partially paid / Paid / Overpaid badge |

## Stock (0104) — WorkMate Stage 2B-a

Quantities only, in catalogue units — **no peso amount anywhere** (the value of stock and every cost move are 0105, below — main owner). Private tables (RLS on, no policies): reads and writes only through the `stk_*` functions. Dormant until the main owner switches stock on (`stk_set_enabled`); until then every write is `STOCK_OFF`.

| Table | What it holds |
|---|---|
| `stk_settings` | `owner_id` (pk), `enabled`, `updated_by`, `updated_at` — the company's stock switch (main owner only) |
| `stk_locations` | `id`, `owner_id`, `kind` (`warehouse` \| `site`), `folder_id` (history, not a foreign key), `folder_name` — one warehouse per company, one site per project folder (Main Contract or Additional Works), made on first use |
| `stk_matches` | (`purchase_id`, `line_no`) pk, `item_id` (catalogue item), `line_unit`, `per`, `covers` (`per` line units = `covers` item units), `auto`, `note`, `matched_by`, `matched_at` — how a purchase line counts as stock. Keyed by line number, which a correction keeps |
| `stk_lots` | `id`, `item_id`, `purchase_id` + `line_no` (unique; null = untraced), `cost_folder_id` (null = company stock; a project = its leftovers), `untraced`, `since` (purchase date, or the day counted — display only) |
| `stk_records` | `id`, `kind` (`receive`, `not_delivered`, `leftover`, `issue`, `return`, `move`, `count`, `opening`), `status` (`done`, `pending`, `rejected`, `withdrawn`), `item_id`, `purchase_id` + `line_no`, `from_location`, `to_location`, `quantity` (item units; receive / not delivered in the line's unit; a count = counted), `book_quantity` (a count: the books), `lot_id`, `on_date`, `request_line_id`, `unplanned_reason`, `returns_record` (a return: its issue), `reason`, `note`, recorded / decided / reversed by + at + reason. Live = done and not reversed. Never edited |
| `stk_moves` | `record_id`, `lot_id`, `layer` (the record that brought these goods into stock — a receipt, leftover, opening or count; its `on_date` is the day received), `from_location` (null = enters stock, and then `layer = record_id`), `to_location` (null = leaves stock, a confirmed loss), `quantity` — append-only |
| `stk_covers` | `record_id`, `request_line_id`, `portion_id`, `quantity` — what goods entering a project filled on a request ("From stock"); append-only |
| `stk_events` | switched / matched / unmatched / confirmed / rejected / withdrawn / reversed — append-only |

A lot's balance at a place = live moves in − live moves out, kept per **layer** (one per delivery received — a part delivery is its own — leftover record, confirmed opening stock or goods found by a count); never below zero (checked under the item's lock). A matched warehouse line's receipt enters stock as its own layer: the converted total received (the receipts already in stock plus this one) less the item units already assigned to them — a receipt's quantity never changes afterwards, so the whole line adds up exactly whatever the receipt dates or the order they were entered in (3 boxes = 100 pieces: 33.333 + 33.334 + 33.333; a box reversed and received again brings it back to exactly 100). Receipts made before the match enter at the match, in the order received, each with its own received day. Issues, moves and losses take the **oldest received** layer first (`stk_layers`), never by purchase date, unless a lot is named.

| Function | Who | What |
|---|---|---|
| `stk_status()` | signed in | `enabled`, `can_record`, `is_main_owner`, `is_owner`, `user_id` |
| `stk_set_enabled(on)` | main owner | Switch stock on (launch) or off |
| `stk_match(op, purchase, line, item, covers, note)` | office | Match a line; another unit needs a note and never the buyer's own check; fixed once any of its goods are stock (reverse those receipts to change it) |
| `stk_receive(op, purchase, line, qty, on, note)` | office (incl. Buyer staff) | A warehouse line arrived, in parts if need be |
| `stk_not_delivered(op, purchase, line, qty, reason)` | office | The rest will not come (money: supplier refund / credit, 2A-4) |
| `stk_leftover(op, purchase, line, qty, where, on, note)` | office | Leftovers of a project line, at its site or in the warehouse; never more than it brought |
| `stk_move(op, body)` | office | Issue (warehouse → project), return (one issue's lots back), move (between sites / to the warehouse); fills a request line or is unplanned with a reason; oldest lot first unless named |
| `stk_count(op, body)` | office | A count; a difference waits for the main owner with a reason |
| `stk_opening(op, body)` | office | Opening stock, traced to a project purchase line or untraced; waits for the main owner |
| `stk_decide(op, record, approve, note)` | main owner | Confirm (a count only while the books still read what was counted) or reject with a reason |
| `stk_reverse(op, record, reason)` | recorder or an owner account (a confirmed count / opening: the main owner) | Reverse a record, or withdraw a pending one; refused while its goods have moved on |
| `stk_overview()`, `stk_item(item)`, `stk_project_lines(folder)`, `stk_choices()`, `stk_request_lines(folder)` | office, stock on | The Stock screens' reads — quantities only |
| `pr_portion_bought` / `pr_line_bought` (redefined) | internal | COVERED = recorded purchases + live stock records; `*_purchased` and `*_from_stock` are the parts |
| `pur_shopping_list` (redefined) | buyers | `bought` = purchases, plus `from_stock` and `in_warehouse` (a hint, no reservation) |

Guards: `stk_guard_line` (a purchase line may not undo its stock: destination, project, unit, quantity — `STOCK_IN_USE`), `stk_guard_void` (no void or replacement with stock records), `stk_inventory_frozen` (once stock is on, the old `inventory` table refuses writes — `STOCK_TICK_RETIRED`), `stk_item_fixed` (a catalogue item's kind and unit never change once a request line **or stock** uses it — `ITEM_IN_USE`).

Catalogue (0092 extended): `pr_item_in_use(item)` = a request line, a stock match, a lot or any stock record uses it. `pr_office_save_item` refuses a Kind or Unit change of such an item (`ITEM_IN_USE`), and `pr_office_catalog`'s `in_use` counts stock too, so the Catalogue form locks the two fields.

## Stock cost moves (0105) — WorkMate Stage 2C

Where the **cost** of stock sits, decided by the **main owner**. Moving goods never moves their cost by itself: every stock move row carries its `holder` (a project folder, or null = the company), and when goods arrive where someone else holds their cost the server opens a pending cost move. Approval writes **ordinary `expenses` rows** tied to the cost move (`stk_cost_move_id`) — so every Spent / Cover / report site reads them like any other row. Company stock is never in a project's Spent, nor in company overhead (G&A). Client billing is never changed.

| Table / column | What it holds |
|---|---|
| `stk_moves.holder` | Whose cost the moved goods are. Goods entering stock take their lot's `cost_folder_id` (trigger `stk_moves_holder`): a warehouse purchase = the company; leftovers / traced opening stock = their project, even in the warehouse |
| `stk_cost_moves` | `id`, `kind` (`assign` company → project, `transfer` project → project, `back` project → company, `loss` company stock → company stock loss), `status` (`pending`, `approved`, `rejected`, `withdrawn`), `record_id` + `move_id` (the physical record and move row), `lot_id`, `layer`, `location` (null for a loss), `from_folder` / `to_folder` (null = company), `quantity` (asked), `approved_quantity`, `value` (pesos), `basis_value` / `basis_quantity` (the lot's price and quantity it was valued at), `basis_alloc` (where its purchase's cost sat when approved — `stk_purchase_alloc`: its rows summed by billing period, project and Cover), `received_on` (the day the project received the goods — funding month), `resubmits` (the rejected / reversed one it asks again for), `note`, `requested_*`, `decided_*` + `decision_note`, `reversed_*` + `reverse_reason`. RLS on, no policies |
| `expenses.stk_cost_move_id` | The approved cost move that wrote the row (both sides). Changed only by the stock functions — `pur_guard_expense_row` refuses anything else (`STOCK_COST_ROW`) |
| `stk_events.cost_move_id` | `cost_requested`, `cost_approved`, `cost_rejected`, `cost_resubmitted`, `cost_withdrawn`, `cost_reversed` |

When a cost move is opened (`stk_cost_requests`, after every physical move, untraced lots never): goods arriving at a project site whose holder is not that project → `assign` (from the company) or `transfer` (from another project); a **company** lot's goods brought to the warehouse while a project holds them → `back`. A project's own leftovers keep their cost in the warehouse. A confirmed loss (`stk_decide` on a count) of company-held goods → an approved `loss` with the count (`stk_cost_losses`): value to company stock loss, **no expense row**; reversing the count reverses it.

Value (`stk_lot_basis`, `stk_held`, `stk_cost_value`): a lot is worth its purchase line's item amount − discount shares + delivery-fee shares, for the line's quantity in item units; its own holder starts with all of it. Each approved move takes the line's cost × quantity / the line's quantity, to the centavo; the **last** portion out of a holder takes what it holds, so the portions of a line always add up to it exactly (₱100 for 3 pieces → ₱33.33 + ₱33.33 + ₱33.34). A pending move covers only what the holder still has there after earlier pending requests (`stk_cost_effective`) — goods that left before approval are not charged; approval is whole, for that.

Rows (`stk_cost_rows`): the receiving project is funded like a purchase (`pur_fund`: its periods for the month in `received_on`, earliest billing number first, the rest Cover; Additional Works its own period) — "From warehouse — item" / "Moved from A — item"; the giving project gets negative rows on every (billing period, Cover) group that carried the lot's cost for it (its purchase line rows, its share of the delivery-fee rows, earlier cost-move rows — `stk_cost_carriers`), in proportion with `pur_prorate` — "Moved to B — item" / "Back to company stock — item". A split is one `split_group` (`stkcost:<id>:in|out`).

| Function | Who | What |
|---|---|---|
| `stk_cost_decide(op, cost, approve, note)` | main owner | Approve (refused `COMPLETED_PROJECT` into or out of a completed project or a job under one; `NOTHING_LEFT` when the goods are gone) or reject with a reason (the goods stay recorded, the cost stays) |
| `stk_cost_reverse(op, cost, reason)` | main owner | Its rows leave Spent; the record stays. Refused `LATER_MOVES_FIRST` while later movements or cost moves rely on it. A loss goes with its count instead |
| `stk_cost_resubmit(op, cost, note)` | stock recorders | Ask again for the same movement after a rejection or a reversal — no second physical record |
| `stk_cost_pending()` | main owner | The Owner approvals cards: what is still there, the estimate, the giving project's groups, the record and its evidence. Stock off: `[]` |
| `stk_company_stock()` | owner accounts | By item: in the warehouse, issued with the assignment pending, awaiting delivery, company stock loss — quantity and value |

Redefined: from 0104 `stk_take` (returns the holder; within a delivery, goods not yet the place's own leave first), `stk_check_record`, `stk_move` (holder on every row; a return takes the issue's goods as their cost now stands; then `stk_cost_requests`; answer + `cost_moves`), `stk_decide` (+ `stk_cost_losses`), `stk_reverse` (`COST_MOVED` while an approved cost move rides on the record; pending ones withdrawn), `stk_record_json` (`costs` — states for everyone who reads stock, `value` / `estimate` keys for owner accounts only); from 0096 `pur_guard_expense_row` and `pur_guard_delete` (a project with live stock records or open cost moves, or a billing period carrying cost-move rows: `STOCK_LIVE`). Guard `stk_guard_cost_basis` (after insert on `purchase_history`, kinds corrected / unit_checked / refunded — every 2A path that stores a purchase again, an approved change request included): a purchase line's price or quantity cannot change while approved cost moves value its lot (`STOCK_COST_IN_USE`), and neither can where the purchase's cost sits — its rows' billing periods and Cover (`STOCK_COST_FUNDING`; reverse those moves first). Locks: the lot's purchase first (as every purchase write), then the item and the projects charged in one sorted pass; a count's loss and a purchase correction meet on the lot row.

## Tools (0107) — WorkMate Stage 3a

Every real tool, numbered, and who answers for it — **no money**: a tool's cost stays where its purchase put it (a project's Spent, or company stock cost). A catalogue item of kind `tool` is tracked only here, never as quantity stock. Dormant until the main owner switches tools on (`tl_set_enabled`). Answers: `docs/superpowers/specs/2026-10-28-workmate-stage3-tools-questions.md` (all A).

| Table | What it holds |
|---|---|
| `tl_settings` | `owner_id`, `enabled` — the company's tools switch (main owner only) |
| `tl_tools` | `number` (TOOL-0001…, per company, never reused), `item_id` (kind `tool`), `purchase_id` + `line_no` (the purchase line it came from, or none — the opening register), `details` (brand / model / serial), `photo_path` (`tools/<company>/<yyyy-mm>/<uuid>.jpg` in `uploads`), `state` (`available`, `issued`, `repair`, `lost_pending`, `lost`, `retire_pending`, `retired`, `cancelled`), `condition` (`good`, `needs_repair`, `missing_parts`, `damaged`), `holder_id` + `folder_id` (who has it and on which project — an issued tool always has both; while lost, who had it last), `since` (when the current state began). Never deleted |
| `tl_records` | One action on one tool: `kind` (`register`, `issue`, `handover`, `return`, `repaired`, `lost`, `found`, `retire`), `status` (`done`; Lost / Retire also `pending`, `rejected`, `withdrawn`), `before` / `after` (the tool's custody around it), `holder_id` / `folder_id` (the custody it gave or ended), `request_line_id`, `condition`, `photo_path`, `note`, the decision and the reversal with their reasons. Never deleted |
| `tl_covers` | What an issue filled on a tool request line when the tool was **not** bought for it (`request_line_id`, `portion_id`, `quantity`); counts while its issue stands. Never changed |
| `tl_events` | Append-only: the switch, confirmations, rejections, withdrawals, reversals |

| Function | Who | What |
|---|---|---|
| `tl_register(op, body)` | office | 1–50 tools of one tool item, at the warehouse or with a **named person** on a project (`PERSON_REQUIRED`); from a purchase line never more than it bought (`MORE_THAN_BOUGHT`), never a line already received as stock (`LINE_IS_STOCK`) |
| `tl_issue(op, body)` | office | An `available` tool to a person on a project that is not completed; optionally for a tool request line — it fills the line only if the tool was not bought for it (`tl_bought_for`) |
| `tl_handover(op, body)` | office | Person to person (and project to project), never through the warehouse — only a tool in good condition (`NEEDS_REPAIR`) |
| `tl_return(op, body)` | office | With its condition: good → available; needs repair / missing parts → repair; damaged → repair + a pending Retire |
| `tl_repaired`, `tl_found` | office | Repaired: under repair → available, or an issued tool not in good condition → good, with the same person, project and days out; Found: lost → available or repair |
| `tl_report_lost`, `tl_request_retire` | office | Wait for the main owner; the tool cannot be issued, handed over or returned meanwhile |
| `tl_decide(op, record, approve, note)` | main owner | Confirm → lost / retired; reject (reason) → exactly where it was before (Retire: Under repair) |
| `tl_reverse(op, record, reason)` | recorder or owner | Withdraw a pending one, or reverse the tool's latest record (`LATER_RECORDS` otherwise); reversing a registration cancels the tool |
| `tl_overview`, `tl_tool`, `tl_choices`, `tl_request_lines` | office | The Tools screens |
| `tl_project_out(folder)`, `tl_line_tools(lines)` | owner / office / buyers | Tools still out on a project and its jobs (Mark as Complete); tools issued for request lines (the shopping list). Empty while off |

Covered (every Still to buy): `pr_line_bought` = purchases + stock + tools. A return or a handover keeps a line filled; reversing an issue reopens it only if that issue counted on its own.

Names: every person on these screens comes from `tl_person_name` — since **0108** the crew as "Name (W-0007)" (two crew members may share a name), or "W-0007" with no name; office and owner accounts by their name or e-mail.

## PM profit sharing (0098)

An internal owner/partner allocation per PM project - **outside the money model** (never a payout, invoice or accounting entry). Spec `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`; plan `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`. `project_id` is a `construction_projects.id` (never a `folders.id`). The three tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`: nothing reads or writes them directly. Read through `pm_sharing_read` (owner-role accounts of the company); write through `pm_set_sharing` (main owner only).

| Table / object | Columns and rules |
|---|---|
| `pm_project_companies` | `project_id` PK -> `construction_projects` (cascade), `company_owner_id`, `mapped_by`, `mapped_at`, `source` (`owner_verified` / `created`). The trusted project -> company map. Rows come only from `pm_map_new_project_trg` (`created`) or an owner-verified mapping migration (0099, applied 2026-10-19; it maps six explicit projects). A project with no row is **unmapped** and its sharing is locked |
| `pm_sharing_agreements` | `project_id` PK -> `construction_projects` (cascade), `company_owner_id`, `partner_pct` `numeric(5,2)` 0-100, `version` >= 1, `updated_by`, `updated_at`. Only `partner_pct` is stored (owner % = 100 - partner %). **No row = 50/50**, computed on read, never back-filled |
| `pm_sharing_changes` | Append-only history: `project_id` (plain value, **no foreign key**, so a deleted project cannot blank its history), `project_name_snapshot`, `client_name_snapshot`, `company_owner_id`, `old_pct`, `new_pct`, `old_was_default`, `reason` (non-blank), `actor_id`, `actor_email`, `changed_at`. UPDATE and DELETE are refused by `pm_sharing_changes_immutable_trg` |
| `pm_map_new_project_trg` (AFTER INSERT on `construction_projects`) | Maps the new project to the creator's company. A signed-in creator with no valid company link is **rejected**; an insert with no signed-in account (service role / SQL editor) is left unmapped |
| `pm_caller_company()` / `pm_owner_company()` / `pm_main_owner_id()` | Who is calling: any office account's company (the main owner's id); an owner-role account's company; the main owner only (role `owner`, `owner_id` null, active). `profiles.allowed_modules` is **never** read for authority |
| `pm_set_sharing(project, partner_pct, expected_version, reason)` | The only way to change a split. Main owner only; locks the project row; project must be mapped to the caller's company; rejects a raw `%` with more than 2 decimals (`BAD_PCT`) before storage; optimistic version check (`STALE`); same value = no-op with no history; reason required; upserts the agreement and inserts the history row together |
| `pm_sharing_read(projects uuid[] default null)` | Returns `{can_edit, projects[], history[], partners[]}` for the caller's company. Owner-role accounts only (staff get `OWNER_ONLY`); `can_edit` is true only for the main owner |
| `wf_reserves_for(projects uuid[])` | Recorded `warranty_retentions` rows for mapped projects of the caller's company (one per project, a live row preferred). Needed because `warranty_retentions` RLS is `owner_id = auth.uid()` and hides the main owner's rows from a focused owner such as `admin-pm@`. Called only by `WF.reserveFor` in `js/warranty-fund.js` |

## PM worker cash advances (0100)

A tracking ledger of money advanced to workers on a PM project and the repayments the owner records by hand - **outside the money model** (no payroll, expense, invoice or accounting entry; no Spent / Earned / Profit code reads it). Spec `docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md`. All four tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`. Everything goes through the `pm_ca_*` functions, for owner-role accounts of the company only (`pm_owner_company()`, 0098).

| Table / object | Columns and rules |
|---|---|
| `pm_cash_advances` | `id`, `company_owner_id`, `project_id` (a `construction_projects.id`, **plain value, no FK** - deleting a project neither blocks on nor erases the ledger), `project_name_snapshot`, `worker_name` (typed; 1-120 chars), `issued_on`, `amount numeric(12,2) > 0`, `suggest_pct numeric(5,2)` 0-100 default 30, `notes`, `created_by/at`, `updated_by/at`, `voided_at/by`, `void_reason` (all three set together). Never deleted |
| `pm_cash_advance_repayments` | `id`, `advance_id` -> advances (restrict), `company_owner_id`, `paid_on`, `amount numeric(12,2) > 0`, `payroll_ref` jsonb snapshot `{billId, entryIds[], day, details, amount}` or null (never a live link), `notes`, `created_by/at`, void fields as above |
| `pm_cash_advance_events` | Append-only history: `seq` identity, `advance_id` (plain), `company_owner_id`, `kind` (`issued`/`edited`/`repaid`/`repayment_voided`/`voided`), `repayment_id`, `changes` (`{field: [old, new]}`), `reason`, `actor_id`, `actor_email`, `at`. `pm_ca_events_immutable_trg` refuses UPDATE/DELETE |
| `pm_cash_advance_ops` | One row per submitted write: `op_id` PK (from the browser), `company_owner_id`, `action`, `result` jsonb, `actor_id`, `at`. A repeated `op_id` returns the stored `result` and writes nothing; another action/company -> `OP_CONFLICT` |
| `pm_ca_projects()` / `pm_ca_list()` | Reads: the company's mapped PM projects; every advance with repayments, events and `project_deleted` |
| `pm_ca_record_advance` / `pm_ca_edit_advance` / `pm_ca_record_repayment` / `pm_ca_void_repayment` / `pm_ca_void_advance` | Writes, each taking `p_op_id` first. Lock the advance row before any balance check. Refusals: `BAD_AMOUNT`, `BAD_PRECISION` (more than 2 decimals - rejected, never rounded), `BAD_PCT`, `BAD_WORKER`, `BAD_DATE`, `BAD_REF`, `BAD_REASON`, `OVER_BALANCE`, `BELOW_REPAID`, `HAS_REPAYMENTS`, `VOIDED`, `ALREADY_VOIDED`, `NOT_FOUND`, `BAD_OP`, `OP_CONFLICT`. The project is checked only on create or a project change |
