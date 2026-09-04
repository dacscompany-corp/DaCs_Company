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
| `poImageUrl?` `deliveryReceiptUrl?` `supplierInvoiceUrl?` `paymentReceiptUrl?` | base64 | docs (PO/DR/SI/PR), only on first split |
| `inInventory?` | bool | mirrored to `inventory` |
| `coverExpense?` | bool | overflow charged to president fund |
| `splitGroup?` `splitIndex?` `splitTotal?` | — | multi-source split metadata |
| `createdAt` | ts | |

### `payroll/{id}` — labor spend (also batch + split)
| Field | Type | Notes |
|---|---|---|
| `projectId`, `userId` | string | |
| `workerName`, `role`, `laborType` | string | |
| `daysWorked`, `dailyRate`, `totalSalary` | number | |
| `paymentDate`, `notes` | string | |
| `receiptImages` | base64[] | only on first split |
| `coverExpense?` / `splitGroup?` / `splitIndex?` / `splitTotal?` | — | as expenses |
| `createdAt` | ts | |

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

### `overheadExpenses/{id}` (`overhead-module.js`) — company overhead
`userId`, `category`, `amount` (number), `date` (string), `description`, `createdAt`

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
| `laborContracts/{id}` → `pm_labor_contracts` | the PM twin of `labor_contracts` (migrations 0015; `category` 0016; `works` 0062): `workerName`, `scope`, `agreedAmount` (the cap), `payType`, `category` (`labor`\|`outsource`), `status`, `capHistory`, `notes`, `agreement*`, `works`. Drawn down by `weeklyBills.entries[]` labor lines carrying `contractId` — **not** by `payroll`, which is Project Control's path. `works` is the **lumpsum** list: work NAMES only, and a non-empty array means ONE cap covering several works paid by a single entry stream. Same rules as the PC column, and the two must stay in step — §M of `money-math.test.js` asserts both modules print the identical works line |
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

### `appointments/{id}` (public booking, `script.js`)
`fullname`, `email`, `contact`, `service`, `message`, `status` (`pending`), `createdAt`, `updatedAt`.
**Rules:** anyone can create; admins read/manage.

### `testimonials/{id}` (public feedback)
`name`, `location`, `rating` (1–5), `message`, `status` (`approved` if rating ≥4 else `pending`), `createdAt`.
**Rules:** public creates only as `pending`; public reads only `approved` + rating ≥4.

### `settings/{id}`
- `settings/paymentQR` — payment QR (clients can read)
- `settings/invoiceDefaults` — `businessName/Tin/Address`, `vatRate`, `paymentDetails`, `logos` (`{src, enabled}[]`, edited in the Business Settings modal), `signatories` + `showLogo` + `docTitle` (0053/0054/0055; all three pre-fill **new** sales invoices only — an existing one keeps whatever it was saved with)
- `settings/employeeTerms` — one global employee agreement: `text` (fallback terms), `pdfUrl`/`pdfName` (optional global Terms PDF in the uploads bucket, `employeeTermsGlobal/…`; if set, every employee opens + e-signs it on first login), `updatedAt`
- `settings/constructionClientTerms` — one global Client Management agreement: `text`, `pdfUrl`/`pdfName` (`constructionClientTermsGlobal/…`); if a PDF is set, every construction client opens + e-signs on next login
- `settings/clientPortalTerms` — one global Client Portal agreement: `text`, `pdfUrl`/`pdfName` (`clientPortalTermsGlobal/…`); if a PDF is set, every customer-portal client opens + e-signs on next login
- `settings/workerAgreement` — worker agreement template for labor contracts (Worker Tracker): `text` (piecework terms + company rules), `pdfUrl`/`pdfName` (optional comprehensive PDF form, `workerAgreementGlobal/…`). Signed per contract onto `labor_contracts.agreement_*` columns (migration 0023).
- other config: owner/staff only.

### `stats/{…}` — read-only aggregates (no client writes).

---

## 11. Attendance (`0050`, `0059`, `0061`) — worker Time In / Time Out

> **Deliberately isolated**, like `reimbursements` (0041), the warranty fund (0043) and
> `quotations` (0045). No money math reads these tables; attendance hours are **not** the basis of
> pay (labour is pakyaw, capped by `labor_contracts.agreed_amount`). There is no peso column here,
> so the staff amount-hiding rule does not apply. Written only by the native Android worker app
> (via RPC) and read by `js/attendance-admin.js` (phase C).

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
are scoped to their own uuid prefix; there is **no `update` or `delete` policy**, so a photo is
write-once. Photos are files, never base64.

---

## 12. ⚠️ Defined in rules but UNUSED by code (planned SOA module)
`soa_requests`, `soa_records`, `payments`, `billings` have full security rules in `firestore.rules` but **no JavaScript references them**. Either finish the module or remove the rules to shrink attack surface. (The live "SOWA" feature uses `sowaRequests` — camelCase — instead.)

---

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
