# Quotations Module — Design

**Date:** 2026-08-05
**Status:** Approved design, not yet implemented
**Migration:** `0045_quotations.sql` (highest on disk is `0044`)

---

## 1. What this is

An **outgoing client quotation / project estimate builder** for `admin.html`. DAC's builds an
itemized estimate, prints or exports it as a PDF, sends it to the prospect by email or Viber, and
tracks the outcome through a win/loss pipeline. It is a **sales document**, produced before any
project exists.

It is a new top-level nav tab, **Quotations**.

### What it is not

It does **not** log quotations received from vendors or subcontractors. It has **no client-facing
surface** — the client never sees it inside the system. Approval comes back the way it does today
(a signed scan, an email reply) and an admin ticks *Won*.

### This is a new module, not a BOQ derivative

`js/boq-module.js` produces an **accomplishment report** — a record of work already done. Its data
model is shaped entirely around that purpose, and every one of those shapes is wrong here:

| BOQ line carries | Why a quotation must not have it |
|---|---|
| `percentCompletion` | A quote has no progress — nothing is built yet |
| `accomplishmentAmount` | Same: a measure of work done |
| Split `materialRate` / `laborRate` | **A client never sees your material-vs-labor split.** That is margin, exposed |
| Per-line photos as base64 | Progress evidence, not sales collateral |
| `folderId` binding | A quotation exists before any project does |
| `status: draft / submitted / approved` | Wrong vocabulary — a quote is sent, won, lost, expired |

Strip those and there is no BOQ left to reuse. **The quotation module is purpose-built**: its own
tables, its own line shape, its own terms model, its own print sheet.

What it does share is **house convention**, which is not BOQ-specific: the toast pattern, `Ctrl+S`,
the `beforeunload` dirty guard, `registerViewCleanup()`, lazy jsPDF loading from CDN, soft delete,
the append-only `history` jsonb trail, and owner-only RLS.

---

## 2. The isolation contract

> A quotation **never** writes to `folders`, `construction_projects`, `invoices`,
> `payment_requests`, `expenses`, `payroll` or `boq_documents`, and **no money-model function ever
> reads `quotations`**. Marking a quote *Won* changes a status string and nothing else — it creates
> no project, no contract value and no accounting entry.
>
> That isolation **is the feature**. A quotation is a proposal, not revenue. Nothing in it may feed
> Spent / Earned / Profit. Only `js/quotation-module.js` and `js/quotation-print.js` may read or
> write these tables.

This mirrors `reimbursements` (0041) and `warranty_retentions` / `warranty_fund_expenses` (0043)
exactly, and should be added to the same list in `CLAUDE.md` and `docs/ARCHITECTURE.md`.

**Deliberately no automatic conversion.** When a quote is won, the admin creates the project by
hand as they do today. Auto-creating a `folders` row with `totalBudget` from the quote would wire a
pre-sales document straight into the contract value the money model measures against, and would
pollute Project Control with every prospect that never converts.

### Access: owner only

Every meaningful column is a peso amount, and CLAUDE.md is unambiguous that staff must not see
peso amounts anywhere. Staff are blocked in **four** places, matching the 0041/0043 pattern:

1. `_visibleNav()` in `js/admin.js` — the tab is not rendered
2. The `switchView` guard in `admin.html` — the view is refused if reached another way
3. The module's own role check on init
4. RLS — `owner_id = auth.uid()`, which excludes staff (staff act as their owner through
   `data_owner_id()`)

---

## 3. Feature set (v1)

| Feature | Summary |
|---|---|
| **Itemized estimate builder** | 3-level tree; each section priced either per-line or as a lump sum |
| **Section reference images** | Renders/photos attached to a section, printed inside the sheet — like the kiosk renders on page 1 of the reference document |
| **Validity & expiry** | `valid_until` date, an *Expired* badge in the list, and a block-and-confirm warning when printing a lapsed quote |
| **Win/loss pipeline** | Status dashboard, pending value, won value, **win rate**, reason-for-loss |
| **Follow-up reminders** | A follow-up date per sent quote; overdue ones surface at the top of the list. **In-app flag only — the system sends no email** |
| **Client & scope presets** | Save a client's details, or a reusable scope block, and drop it into any new quote |
| **Revisions** | Every send freezes an immutable snapshot; line-level diff with peso deltas |
| **Print / PDF** | A4 sheet matching the reference document's structure |

Explicitly **out of v1**: option/package pricing (Good/Better/Best), and a structured payment
schedule builder — payment terms remain free text.

---

## 4. Files

### New

| File | Purpose | Est. |
|---|---|---|
| `js/quotation-module.js` | State, list page + pipeline stats, editor, save/load, revisions, presets | ~1,300 lines |
| `js/quotation-print.js` | A4 print sheet + jsPDF export | ~700 lines |
| `css/quotation-module.css` | Editor + print styling | ~450 lines |
| `supabase/migrations/0045_quotations.sql` | Three tables, indexes, RLS, realtime | — |

Print is a separate file deliberately: it is the part most likely to be restyled, and it has no
reason to share a file with the editor.

### Modified

| File | Change |
|---|---|
| `js/admin.js` | `PRIMARY_NAV` entry, `_FOCUS_SUBVIEWS.quotations`, `_visibleNav()` role filter |
| `admin.html` | `QUOTE_VIEWS` group in `switchView()`, section markup, sidebar nav item, `<script>` × 2 + `<link>` × 1 |
| `js/supabase-config.js` | Three `REG` entries |
| `docs/DATABASE_SCHEMA.md` | New section documenting all three tables |
| `docs/ARCHITECTURE.md` | §4 module map row, §7 data model list |
| `CLAUDE.md` | Isolation rule alongside reimbursements and warranty retention |

**Not modified:** no portal HTML. The two-portal mirroring rule does not apply — there is no
client-facing surface.

---

## 5. Nav wiring

```js
// js/admin.js — PRIMARY_NAV
{ id: 'quotations', label: 'Quotations', sub: 'Estimates & Proposals',
  defaultView: 'quoteList',
  modules: [
    { view: 'quoteList', label: 'Quotations', icon: 'file-text' },
  ]
},

// _FOCUS_SUBVIEWS — the entry that always gets missed
quotations: ['quoteEditor', 'quoteRevision'],
```

`_visibleNav()` gains a filter dropping `quotations` for any role that is not `owner`.

`admin.html` gains `const QUOTE_VIEWS = ['quoteList', 'quoteEditor', 'quoteRevision'];` kept in
sync with `_FOCUS_SUBVIEWS`, plus an `initQuotationModule()` call in `switchView`.

A single-module tab is fine — `users` already is one. Presets are managed from a modal inside the
editor and list page, not a second nav entry.

---

## 6. Data model

Scalars are real columns; trees and repeated structures are jsonb. The migration is **idempotent** —
safe on the live DB and on a fresh database.

### `quotations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `owner_id` | uuid not null | FK `auth.users`, cascade |
| `quote_no` | text | `Q-2026-0001`. Generated app-side from the highest sequence used that year. Editable. Not a key |
| `rev_no` | int default 1 | Current revision |
| `quote_date` | date | |
| `valid_until` | date | Drives the computed *Expired* state |
| `client_name`, `client_email`, `client_address`, `client_tin` | text | Buyer block |
| `project_name`, `location`, `subject` | text | Header block |
| `scope_note` | text | Free text above the table |
| `sections` | jsonb not null default `'[]'` | The 3-level tree, incl. section images — see §7 |
| `discount` | numeric default 0 | |
| `discount_type` | text default `'amount'` | check `('amount','percent')` |
| `vat_mode` | text default `'none'` | check `('none','exclusive','inclusive')` |
| `vat_pct` | numeric default 12 | |
| `total_amount` | numeric default 0 | Denormalised final total; recomputed on every save |
| `status` | text default `'draft'` | check `('draft','sent','won','lost')` |
| `status_note` | text | Reason for loss, or any outcome note |
| `decided_at` | timestamptz | Set when status moves to won or lost — powers win-rate-over-time |
| `follow_up_date` | date | Optional reminder; overdue ones surface in the list |
| `follow_up_note` | text | |
| `terms` | jsonb not null default `'{}'` | See §7 |
| `prepared_by` | text | Name on the signature block |
| `history` | jsonb not null default `'[]'` | Append-only trail `[{at, by, status, from, note}]` — same convention as `reimbursements.history` |
| `deleted_at` | timestamptz | Soft delete. Every read filters `deleted_at is null` |
| `created_by`, `created_at`, `updated_at` | | |

Indexes: `(owner_id) where deleted_at is null`, `(status)`, `(quote_date)`, `(valid_until)`,
`(follow_up_date) where follow_up_date is not null`.

### `quotation_revisions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `quotation_id` | uuid | FK `quotations`, **on delete cascade** |
| `owner_id` | uuid not null | Denormalised so RLS is a single-table check |
| `rev_no` | int not null | |
| `snapshot` | jsonb not null | Full frozen copy of the quotation at send time |
| `total_amount` | numeric | The total as sent |
| `sent_at` | timestamptz | |
| `note` | text | Optional "what changed" note |
| `created_at` | timestamptz | |

Unique index on `(quotation_id, rev_no)`; index on `(owner_id)`.

Revisions are **immutable** — the module only ever inserts. No edit or delete path; they disappear
only with the parent quotation.

> **Storage trade-off, made knowingly:** each revision stores a *full* copy of the tree, so a quote
> revised eight times stores it eight times. At this volume — hundreds of quotes, not millions —
> that is cheap, and it makes a revision trivially printable on its own. Storing diffs instead
> would halve the storage and double the complexity.

### `quotation_presets`

One table serving both preset kinds.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `owner_id` | uuid not null | |
| `kind` | text not null | check `('client','scope')` |
| `name` | text not null | What it's listed as |
| `data` | jsonb not null | A client block, or an array of sections/lines to insert |
| `deleted_at` | timestamptz | Soft delete |
| `created_at`, `updated_at` | | |

Index on `(owner_id, kind) where deleted_at is null`.

### Shim registration

```js
// js/supabase-config.js — REG
quotations:         { table: 'quotations',          rename: OWNER, ts: ['createdAt','updatedAt'], json: ['sections','terms','history'] },
quotationRevisions: { table: 'quotation_revisions', rename: OWNER, ts: ['createdAt','sentAt'],    json: ['snapshot'] },
quotationPresets:   { table: 'quotation_presets',   rename: OWNER, ts: ['createdAt','updatedAt'], json: ['data'] },
```

### RLS and realtime

Owner-only on all three, mirroring `warranty_retentions_owner`:

```sql
create policy quotations_owner on quotations for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
```

No client-read policy — there is no client surface.

**All three tables must be added to the `supabase_realtime` publication.** New tables are not
auto-added (see `0004_realtime.sql`); without it the list only refreshes on reload, because the
module lists through `.onSnapshot()`.

---

## 7. The document

### Structure

```
Section (L1)   "REPAIR SERVICE"       pricing: 'rated' | 'lump'   images: []
  Group (L2)   "KIOSK" / "ELECTRICAL" optional heading, may carry its own lumpAmount
    Line (L3)  description, qty, unit, unitPrice, amount, state
```

Every node carries a stable client-generated `id` — the revision diff in §8 depends on it.

**A line has one client-facing rate.** `unitPrice` and `amount` only. There is deliberately no
material/labor split anywhere in this model: that breakdown is internal costing and belongs in the
BOQ, never on a document a client reads.

### Pricing modes, per section

- **`rated`** — `amount = qty × unitPrice`, computed. Section total = Σ line amounts.
- **`lump`** — one LOT price is typed. Lines underneath carry description, qty and unit but **no
  rates**.
  - If the **section** carries a `lumpAmount`, that is the section total, and group amounts beneath
    it are display-only sub-breakdowns that do not re-add.
  - Otherwise the section total is **Σ group `lumpAmount`s**.

  This is the reference document's exact shape: `REPAIR SERVICE 1 LOT 200,126.00` with
  `KIOSK 92,707.00` and `ELECTRICAL WORKS 107,419.00` beneath it as a breakdown, not as additional
  charges.

The mode is **per section, not per document**, so one quote can show detailed electrical rates
alongside a lump-sum kiosk price — which is how PH contractors actually quote.

### Line states

| State | Prints as | Counts toward total |
|---|---|---|
| `normal` | normal | ✅ |
| `optional` | *(optional)* | ❌ |
| `waived` | price shown, marked **WAIVED** | ❌ |
| `removed` | ~~struck through~~ | ❌ |

A `removed` line **keeps its price in the data** even though it prints struck and contributes zero.
This is deliberate: it is what lets the revision diff report exactly what a deletion was worth,
instead of a pen mark on a PDF with no credit attached.

### Section images

A section may carry `images: [{ url, name, caption }]`, printed beneath its heading — the reference
document's two kiosk renders.

**Uploaded to the `uploads` bucket; the stored value is the public-format URL.** Since migration
`0027` that bucket is private, and `supabase-config.js` §11b transparently resolves stored URLs to
short-lived signed URLs at the moment of use, so templates can use the URL directly. The one thing
that breaks the pattern is assigning a stored URL straight to `location.href` — use
`window.dacsMaybeSignUrl(url)` there.

**Not base64.** The BOQ stores line photos inline in jsonb; at quotation image sizes that would
bloat every row and every revision snapshot.

### Totals block

```
Project Cost      Σ section totals
Less: Discount    amount, or percent OF PROJECT COST
Sub-total         Project Cost − Discount
Plus: VAT         vat_pct OF SUB-TOTAL, per vat_mode
TOTAL
```

The order is fixed: **discount applies to Project Cost, VAT applies to the discounted sub-total.**
`total_amount` is this final figure, recomputed on every save so the list never disagrees with the
sheet.

`vat_mode` has three behaviours:

- **`none`** — the sheet prints *"VAT not applicable"*
- **`exclusive`** — VAT **is computed at `vat_pct` and added** to the sub-total
- **`inclusive`** — the total is unchanged; the VAT component is shown broken out

The sheet therefore can never print a dash in the VAT row next to a footnote claiming the price is
VAT-exclusive. That ambiguity is designed out.

### Terms

Quotation terms, not BOQ terms:

```js
terms: {
  validityNote,        // e.g. "Valid for thirty (30) calendar days from issuance"
  payment,             // free text — downpayment, progress, turnover
  deliveryTimeline,    // e.g. "14 to 21 days upon approval / payment, whichever comes last"
  warranty,            // scope and duration of warranty offered
  exclusions,          // what is not included
  conditions: [ { title, body, include } ],   // numbered T&C, the reference sheet's 14 clauses
  signOff: { preparedBy: true, clientApproval: true }
}
```

Defaults persist to `settings/quotationDefaults`, following the `settings/invoiceDefaults`
precedent in `labor-invoice-module.js`, so the standard clauses are typed once.

---

## 8. Lifecycle, revisions, follow-ups

```
draft ──Send──▶ sent ──▶ won
                  │
                  └────▶ lost
```

**Expired is computed, not stored** — `status === 'sent' && valid_until < today`. No cron job, and
it self-corrects if the validity date is extended. Date keys are built from **local parts**, never
`toISOString().slice(0,10)` — PH is UTC+8 and that rolls back a day.

Printing an expired quote shows a **confirm dialog** first. Reissuing is the intended path: bump
the validity date, which creates a revision.

`decided_at` is stamped when the status moves to won or lost, and cleared if it moves back.

### Revision rules

- While `draft`, edits are free and `rev_no` stays 1.
- **Send** inserts a full snapshot into `quotation_revisions` and sets `status = 'sent'`. The
  snapshot write happens **before** the status flip — if the insert fails, the status does not
  change and the user sees the error.
- Editing a `sent` quotation warns *"this creates Rev N+1"* and bumps `rev_no` on save.
- The next Send snapshots again.

### The diff

The history panel lists every revision with its total, and diffs any revision against the previous
one by matching node `id`s:

- **added** lines, with their amount
- **removed** lines, with the amount lost
- **changed** lines, old → new qty / unit price / amount
- a **net peso delta** for the revision

This is the concrete answer to the failure in the reference quotation that prompted this work: an
item struck through by hand, with no way to tell whether its removal was credited.

### Follow-ups

`follow_up_date` is an optional reminder on a sent quote. The list sorts overdue follow-ups to the
top with a badge and shows a count in the header. **Nothing is emailed** — this is an in-app flag,
so it introduces no delivery infrastructure and nothing can be sent to a client by accident.

---

## 9. UI

### List page (`quoteList`)

**Pipeline header** — Draft / Sent / Won / Lost counts, pending value (sent and not expired), won
value this year, **win rate** (`won / (won + lost)`), and an overdue-follow-up count. Owner-only, so
peso figures are unconditional.

**Table** — quote no + rev, client, project, quote date, valid until, total, status pill, follow-up
badge. Actions: open · duplicate · print · PDF · mark won/lost · delete (soft).

Filters: status, year, free-text search. Overdue follow-ups pinned to the top.

### Editor (`quoteEditor`)

- **Header form** — client block (with *Insert client preset* / *Save as preset*), project block,
  quote date, valid-until, subject, scope note
- **Section tree** — add section / group / line, reorder with up/down buttons (no drag in v1),
  per-section **Rated | Lump** toggle, per-line state selector, per-section image uploader
- **Scope presets** — insert a saved scope block into the tree, or save the current section as one
- **Totals panel** — discount (amount or %), VAT mode, live totals
- **Terms panel** — validity, payment, delivery timeline, warranty, exclusions, numbered
  conditions, sign-off toggles
- **Outcome panel** — status, reason for loss, follow-up date
- **Revision history** — list, view a frozen revision, diff against previous

`Ctrl+S` to save and a `beforeunload` dirty guard, with the `_handlersWired` guard — `init*` runs on
every view switch, and without it the handlers stack. Listeners register with
`window.registerViewCleanup()` so leaving the view tears down the `onSnapshot` subscriptions.

### Print / PDF (`quotation-print.js`)

An A4 sheet mirroring the reference document:

1. Header — logo, company details, TIN · client / project / location block · date · **quote no and
   Rev N**
2. Scope note and section reference images
3. Itemized table — section, group, line, with the state styling from §7
4. Exclusions and numbered terms & conditions
5. Totals block · payment terms · delivery timeline · signature blocks

**Rev N** prints on every page. A frozen revision prints from its snapshot, not the live record.
jsPDF and jspdf-autotable load lazily from CDN on first use.

---

## 10. Error handling

- **Save failures surface a toast carrying the real Postgres message.** The shim maps camelCase
  straight to snake_case, so a missing column fails the entire save; migration 0045 fixes the
  column set, making this a guard rather than an expectation.
- Uncaught errors self-report to `client_errors` via `supabase-config.js` §13, readable in the
  System Errors panel.
- The dirty-state guard blocks navigation away from unsaved edits.
- The revision snapshot is written before the status transition; a failed snapshot aborts the send.
- Image upload failures are reported per-file and never block saving the quotation.
- Deletes are **soft** (`deleted_at`), so a mis-click is recoverable.

---

## 11. Verification

| Check | Expectation |
|---|---|
| `node --check js/quotation-module.js js/quotation-print.js` | Clean |
| `npm test` | **Stays green — all 46 checks.** Quotations touch no money code, so a red result means something got coupled that shouldn't be. That is the regression signal this module needs |
| Browser — owner | Tab renders; quote saves; images upload and print; revision snapshots; diff reports the right delta; print and PDF both produce the sheet |
| Browser — staff | Tab absent; `switchView('quoteList')` refused |
| SQL — staff JWT | `select * from quotations` returns zero rows |
| Realtime | A second tab sees a new quote without a reload (confirms the publication step) |
| Expiry | A quote with `valid_until` in the past reads *Expired* and warns before printing |

---

## 12. Deferred

- **Vendor / subcontractor quotations (incoming).** A separate concern; would live nearer
  Construction procurement.
- **Client portal visibility and digital approval.** Would need a client-read RLS policy, portal
  markup mirrored into both `Client Management.html` and `Dacs Partnership.html`, and an acceptance
  audit trail.
- **Automatic conversion of a won quote into a `folders` or `construction_projects` row.** Rejected
  for v1; revisit only with the isolation contract in §2 reopened first.
- **Option / package pricing** (Good / Better / Best, where only the chosen option counts).
- **Structured payment schedule builder** (rows validating to 100%). Payment terms stay free text.
- **Emailed follow-up reminders.** In-app flag only.
- **Multi-currency.** PHP only.
