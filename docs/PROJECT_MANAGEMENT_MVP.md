# Project Management & Procurement Module

## Overview
A module for DAC'S Building Design Services based on a **Cost-Plus** contract model.
Admin manages and inputs all data. Client views, tracks, and pays.

Each construction project opens into a **workspace** with five tabs (below). This doc
reflects the **current** workflow; the original spec had a weekly total-only summary,
which has since been replaced by the itemized **Daily Expenses** builder.

> **🆕 Recently added:** **Labor Contracts (pakyaw / capped pay)** in Daily Expenses — cap a
> worker's job and draw it down from the daily **Labor** lines, with a Worker Tracker + ledger ·
> per-category **Statements of Account** (Daily Expenses) — **click a category to view all its
> entries** on screen, plus PDF download · **module-focused accounts** (scope a login to a single
> module) · **mobile-responsive** workspace (bottom tab bar) · **client/partner portal parity**
> (Materials + Labor split · Net cash · tap to view past weeks) with **dark-mode** coverage.
> Items below tagged **🆕 New** are part of this batch.

---

## Navigation Structure

**Parent Menu: Project Management** has two sections:
1. **Projects** — the projects home (card grid) → open a project → workspace tabs.
2. **🆕 Termination Requests** — review client-submitted project terminations.

**Project workspace tabs** (after opening a project):
- Dashboard Overview
- Daily Expenses
- Procurements
- Progress
- Money

---

## Projects home (card grid)
The Project Management landing lists every construction project as a card. Each card shows the
**client / project**, **% complete**, **Balance due**, **This Friday**'s amount, an
on-track / overdue status, and an **Open Project** button into the workspace. Header + card actions:
- **Add Project** — create a project (client & project name, location, **management-fee %**, …).
- Per card: **Edit** and **Delete**.
- **QR Settings** — upload the **payment QR codes** (e.g. GCash / bank) shown to clients in the
  payment flow.

---

## Workspace Tabs

### 1. Dashboard Overview
Per-project read-only summary.
- Hero: client/project, % complete, total paid.
- KPI tiles: **Progress**, **Direct cost** (cumulative labor + materials), **Outstanding
  balance**, **Total paid**, **Net cash** (paid − direct cost), **Next payment due**.
- **Direct-cost breakdown** split into **Labor / Materials / Materials + Labor**, with a
  date-range filter.
- Charts: billing trend (bars) + payment-status donut.

---

### 2. Daily Expenses
The core bill builder. **Replaces the old "Weekly Summary."** Bills are now **daily and
itemized** (not a single weekly labor/materials total).

- The bill is keyed to a **single day** (defaults to **today**); navigate days with ← / →.
- Admin adds **itemized line entries** via a segmented control with **three categories**:
  - **Labor** — details + **No. of days** + amount paid
  - **Materials** — details + **quantity + unit** (pcs, bags, sack, kg, cu.m, sq.m, lot,
    set, sheet, roll) + amount paid
  - **Mat + Labor** (supply & install) — details + amount paid
- Each line can include an **optional receipt image** (stored in Supabase storage).
- Lines are **editable** and removable; they're **grouped by category** with per-category
  subtotals, and a colored tag/accent per category.
- A **view filter** (All / Labor / Materials / Mat + Labor) isolates one category.
- Totals auto-compute:
  - **Direct cost = Labor + Materials** (the Materials figure folds in the supply-&-install
    "Mat + Labor" amount so client/billing code stays correct)
  - **Management fee** — applied automatically (per-project %, see note)
  - **Grand total = Direct cost + Management fee**
- **Save & send to client.** Once saved, a bill becomes **read-only** (status pill,
  view-only lines, **Print this bill**).
- **History sidebar:** past bills (status pills **Sent / Partial / Paid**, tap to open
  read-only), a **"Sent this month"** total, and a **"Today so far"** summary
  (Labor / Materials / Mat + Labor / Grand total).
- **🆕 Statements of Account (per category):** the sidebar lists **Labor**, **Materials**, and
  **Mat + Labor**, each with its project-wide total across all bills.
  - **🆕 Click a category row** to open an **on-screen breakdown** — a modal listing **every
    entry** of that category (week · details · qty/days · amount), with the entry count and
    category total. (The **Generate** button still triggers the PDF directly.)
  - **Generate** (or the modal's **Generate PDF**) produces the printable **SOA** in the house
    style (green company name, dark-green header + total row) with **Print** and **Download PDF**
    (jsPDF; PDF amounts shown as `PHP …`).

**Management fee:** **per project & editable** (default **15%**, can be **0%**). Changing a
project's rate **re-bills its unpaid bills** at the new rate.

#### 🆕 Labor Contracts (pakyaw / capped pay)
For workers paid a **fixed agreed amount for a whole job** (*pakyaw*) or a **capped in-house**
arrangement — instead of open-ended daily labor. Everything lives **inside Daily Expenses** (no
separate tab):
- A **collapsible "Labor Contracts" panel** (Worker Tracker) at the top of the tab. Its header
  shows the **contract count + total remaining**; expand for the full list.
- **＋ New Contract:** worker name, **scope / job**, **pay type** (Pakyaw / In-house), **agreed
  amount (the cap)**, and notes. Contracts can be **edited**, have their **cap raised** (kept in a
  cap history), or **deleted**.
- Cards are **grouped by worker**, each showing **Agreed / Paid / Remaining**, a progress bar, and
  a **status badge** (**Ongoing · % / Completed / Over**), plus per-worker subtotals.
- **Drawdown from daily labor:** when adding a **Labor** line, a **"Pay against contract"** picker
  (Labor category only) tags that line to a contract. The contract's **Paid** rises and
  **Remaining** falls as bills are saved — the same daily labor entry is the **single source of
  truth** (no parallel payment system). Leaving the picker on **"None"** = ordinary labor.
- **Ledger:** per contract, lists **every labor line that drew it down** (date · line · amount ·
  running remaining).
- Contracts are **per project** and **admin-only**. *(Drawn down from Labor lines only; v1 has no
  payment milestones.)*

---

### 3. Procurements (Materials Procurement List)
- Admin creates a list of items to purchase (item name, quantity, estimated price).
- Each item can be purchased by either the **client** or the **company (admin)**.
- **Client buys:** client marks item bought, inputs actual amount paid, uploads receipt.
- **Company buys:** admin marks item bought, inputs actual amount paid, uploads receipt.
- All purchases (amount + receipt) visible to both parties for full transparency.
- Item status: `Pending` | `Bought by Client` | `Bought by Company`.
- Tab stats: **Total items**, **Pending**, **By company**, **By client**; filter pills
  (All / Pending / Bought) + search + **Add item**.

---

### 4. Progress
- **Milestones** — phases with a weight and status (`pending` | `in_progress` |
  `completed`); drives the project Completion KPI.
- **Accomplishment Reports** — a hierarchical **report builder** on the **quotation's line
  model**: **Cost Items → Sub-items → Line items**, columns
  `Item No. · Descriptions · QTY · Unit · Unit Price · Amount · % Complete · State · Actions`. Saved per project and **Print / Export-to-PDF** to share with the client.
  (Project folders must exist in the Expenses module first.)
  - **House BOQ styling.** The tree is one table using the **shared `boq-*` classes**
    (`css/boq-module.css`) — yellow head, red cost-item band, grey sub-item band, striped line
    rows, pale-yellow subtotal — the same palette `quotation-print.js` prints (head `#fbbf24`,
    section `#c81e1e`, group `#e5e7eb`). The BOQ, the Quotation editor and this builder therefore
    read as one system, and the screen matches the paper. **Do not fork these styles**; restyle
    `boq-module.css` if the house look changes.
  - Columns match the BOQ exactly: Item No. · Descriptions · QTY · Unit · Material &
    Consumables · Labor & Equipment · Total Amount · % Complete · Accomplishment · Actions.
    Cost items number **I, II, III…**, sub-items **A, B, C…**, lines **1, 2, 3…**
  - **Reorder** up/down at all three levels (`pmRpMoveCost` / `pmRpMoveSub` / `pmRpMoveLine`).
    Swaps happen in place so every id stays stable and the live total cells never go stale.
  - Rows stay **always editable** — deliberately *not* the BOQ's double-click-to-edit. After a
    PDF import there can be sixty rates to key in, and opening each row first would undo the
    point of importing.
  - **Staff see no peso amounts here.** Project Management is staff-visible (`js/admin.js` hides
    only Warranty Fund from them), so the builder blanks the rate inputs, Total, Accomplishment,
    the quoted box and the Summary card for `currentUserRole === 'staff'`; **% Complete stays
    editable** because progress is not money. The printed sheet enforces the same rule and the
    role **overrides** the document's own “Rates & line amounts” switch. Fenced by §H / §I of
    `tests/quotation-pdf-import.test.js`.

#### The line model and the money engine
One client-facing **Unit Price** per line plus a **State**, exactly as a quotation carries them —
**not** the BOQ's material/labor split. A cost item is priced one of two ways:

| Pricing | Total | Lines | Progress |
|---|---|---|---|
| **Rated** | sums from its lines | each carries a Unit Price | weighted by line amounts |
| **Lump sum (LOT)** | **is** the LOT amount | print as *scope only* | weighted by the **group amounts** |

- `optional` / `waived` / `removed` lines count **₱0**, the same way `qtLineAmount` totals them.
  A **removed** line is not scope and **never prints**; optional and waived print, labelled, at nothing.
- A LOT cost item's own amount **wins**; its group amounts are working figures that do **not** add
  to the total and are **not printed** for the client. They exist to weight progress — with none
  entered the groups weigh equally. The builder says this in an amber note under every LOT row,
  because group figures that look like money but don't add up are exactly the thing someone
  will misread.
- **Backward compatible.** `unitPrice` falls back to `materialRate + laborRate` (honouring the
  BOQ's `materialOverride` / `laborOverride`), so every report saved before this computes exactly
  what it always did. §J of `tests/quotation-pdf-import.test.js` pins that.

**The engine is duplicated, verbatim, in two files** — `js/pm-admin.js` (the admin editor) and
`js/client-management-app.js` (the client/partner portal). They are the only two that read
`accomplishment_reports`, and there is no module system to share code. Both copies sit between
`// ==== RP MATH ENGINE START/END ====` markers, and §J runs **both** over the same fixtures and
fails if one drifts. **Edit them together.**

> Do **not** copy this into `js/client-app.js` or `js/portal-app.compiled.js`. Those render
> `boqDocuments` — a different feature that keeps the material/labor split.

#### Document info (the Quotation editor's header, ported)
The report header is the same band + split + sticky-rail layout as the Quotation editor, reusing
its classes from `css/quotation-module.css` (already loaded by `admin.html`) rather than restating
them — the same call as the work-item tree reusing the BOQ's.

| Panel | Fields |
|---|---|
| **Client** | Client name · Address · Email, plus **Fill from project** |
| **Project** | Project name · Location · Area · Subject · Scope note |
| **Document & signatories** | Report no. · Report date · Period covered · Prepared by · Submitted by |
| **Rail — Printed sheet options** | Company logo · “Submitted by” column · “Prepared by” column · Rates & line amounts |
| **Rail — Reference images** | Up to 4, captioned and reorderable, uploaded to the `uploads` bucket |

- **Fill from project**, not saved presets. `quotation_presets` is owned by the quotation module
  alone (migration 0045), and a report already lives inside a construction project that knows its
  client — so the button copies `clientName` / `clientEmail` / `address` / `projectName` /
  `location` straight off `_pmActiveProject`. **Do not add a preset table for this.**
- Every switch card states what it is doing *right now* rather than what it would do if flipped,
  and warns when both signature columns are on with **Submitted by** blank (the same name would
  print twice).
- **No migration.** `accomplishment_reports` is a `jsonbData` collection, so all of these live in
  the one `data` jsonb column. `_RP_TEXT_FIELDS` / `_RP_SWITCHES` in `js/pm-admin.js` drive the
  form, the read-back and the save together — add a field there and all three follow.

#### Printed sheet & PDF — `js/pm-report-print.js`
The report had **no printed output at all** before this, so the switches above had nothing to act
on. `pmRpPrintSheet()` opens the A4 sheet and `pmRpExportPDF()` saves a PDF (jsPDF + autotable,
lazy-loaded, pinned versions), both from the toolbar.

- Shaped like `quotation-print.js` and the BOQ report on purpose: same letterhead, same black meta
  box, same yellow head / red section / grey sub-item table, same signature columns.
- **The money math is not re-implemented.** It reads `window.pmRpMath`, which `pm-admin.js`
  publishes from the single copy the builder uses, so the sheet can never disagree with the
  screen. There are already three copies of that BOQ math in the codebase — do not add a fourth.
- **Submitted by** falls back to **Prepared by**, then to the company name. **Conforme — Client**
  is always printed and is not switchable.
- Dates print from **local parts** (`prettyDate`), never `new Date('YYYY-MM-DD')` — PH is UTC+8
  and that parses as UTC, rendering the day before.
- Gotcha worth knowing: an autotable block given only `margin.left` falls back to autotable's
  *default* right margin and silently squeezes a column ("2 units width could not fit page").
  The totals block sets `right` explicitly. `js/quotation-print.js:893` still has that omission.
- **Import PDF** (builder toolbar) — reads a **quotation PDF exported by this app** back into the
  builder instead of retyping the scope. A quotation and a report have the same three levels, so
  section → cost item, group → sub-item, line → line item.
  - Parser: `window.dacsParseQuotationPdf` in `js/print-utils.js` (pdf.js 3.11.174, already
    loaded). Report-side mapping + preview: `pmRpImportPdf` / `_pmRpImportMap` in `js/pm-admin.js`.
  - **Unit price → Material Rate, Labor Rate blank, % Done 0.** A quotation carries one
    client-facing rate and no material/labor split (0045), and it states scope, not progress.
  - `[REMOVED]` lines are dropped; `(optional)` and `WAIVED` lines import at **zero**, matching how
    the quotation itself totals them, so the checksum against the PDF's printed
    `TOTAL PROJECT COST` lands exactly.
  - **LOT-priced (lump-sum) sections import AS lump sums.** When a quotation prices a section as
    a LOT, the PDF prints **no** unit price and **no** amount on any line (`quotation-print.js:825`)
    — the only money on the page is the section total. That total becomes the cost item's
    `lumpAmount` with `pricing: 'lump'`, so **the money survives the import** instead of the
    section arriving as ₱0. Its lines come in as scope.
  - A preview shows the tree, the counts, that checksum and any warnings before anything is
    inserted. **Nothing is written to the DB until Save Report.** The checksum counts line totals
    **plus** quoted amounts, so a lump-sum quotation does not read as a total mismatch.
  - It reads a **file the admin picks**, never the `quotations` tables — see the isolation note in
    [ARCHITECTURE.md](ARCHITECTURE.md) §4. Do not turn it into a quotation picker.

---

### 5. Money
Houses the **Revolving Fund** and the **Payment System**.

#### Revolving Fund
- Client provides an initial revolving fund to admin for minor/urgent purchases.
- Admin records expenses drawn from the fund.
- Fund is replenished alongside the weekly payment.
- Tracks: `Initial Fund` | `Total Spent` | `Remaining Balance` | `Replenishment Amount`.

#### Payment Requests — Triggers (3 ways)
1. **Admin manual** — admin sends a payment request anytime.
2. **Client self-pay** — client initiates payment without waiting for a request.
3. **Auto-generated** — system creates a payment request every Friday from the billed totals.

#### Payment Rules
- Partial payment allowed, maximum shortage is **₱5,000**.
- Unpaid balance carries over and is added to the next Friday's payment.
- If client made a partial payment → next Friday is **automatically strict**.
- Admin can manually mark any specific week as **strict**.
- **Strict mode** = exact amount only, no partial, no exceptions.
- No cover expenses ever — admin never advances any cost.

#### Amount
- Auto-computed from the billed totals.
- Editable by **admin only** before the client sees it.

#### Payment Reminders
- **Wednesday** — reminder notification sent to client (payment is coming Friday).
- **Friday** — automatic payment request generated.

---

## 🆕 Termination Requests
The admin counterpart to client-submitted project terminations (clients request from their own
portal). Lists requests with filter pills (**All / Pending / Approved / Rejected**). Opening one
shows the **final settlement breakdown** — total labor, total materials, management fee, grand
total, **already paid**, and **final balance due**. Admin can:
- **Approve Termination** → marks it **approved**, flips the project to **terminated**, and (if a
  balance remains) **auto-generates a final invoice**.
- **Reject** → marks it **rejected** with a **reason** shown back to the client.

---

## Design & layout
The workspace follows one **"PM Workspace" design system** (consistent across all tabs):
- **Typography:** IBM Plex Sans; tabular figures for amounts.
- **Color:** brand green `#157a52`, warm `#f1f0ed` canvas, rounded **white cards** with hairline
  borders; per-category accents — **Labor** green · **Materials** slate · **Mat + Labor** purple.
- **Components:** status pills, segmented controls, custom range dropdown, modal sheets, and a
  card → section → mini-stat elevation hierarchy.
- **🆕 Dark mode:** workspace, modals, and tables re-theme to a dark palette (page → card → inner
  elevation) via the topbar toggle.
- **🆕 Responsive:** collapses to a single column with a bottom tab bar on phones (see below).

---

## 🆕 Mobile view (responsive)
On phones (≤ 700px) the workspace switches to a mobile layout (desktop unchanged):
- A fixed **bottom tab bar** — **Overview · Expenses · Procure · Progress · Money** — replaces
  the top tabs and stays in sync with them.
- Panels stack into a single column; the **Daily Expenses** builder and its sidebar stack;
  Overview KPI tiles reflow to 2-up; the Procurements table scrolls horizontally.
- Keeps the brand-green theme.

---

## 🆕 Client & Partner Portal parity
The Dacs Partnership / Client portal mirrors the admin figures (shared portal JS):
- **Direct-cost breakdown** shows the same **Labor / Materials / Materials + Labor** split
  (combined amount no longer hidden inside Materials).
- **Net cash** KPI (paid − direct cost) on the partner overview, matching the admin.
- **Weekly Summary** splits out **Mat + Labor** (own KPI + table column) and lets you
  **tap any submitted week** to view its detail, with **← Back to latest**.

---

## 🆕 Module-focused accounts
Any admin account can be **scoped to one or more modules** via a `profiles.allowed_modules`
list (PRIMARY_NAV section ids, e.g. `["pm"]`). A scoped account sees **only** those sections in
the portal navigation, on **every screen size** (desktop + mobile); an empty/unset list = full
access. Example: the `admin-pm@dacsbuilding.com` owner account is set to `["pm"]`, so it opens
straight into **Project Management** and sees nothing else. This is a navigation/focus filter,
not a data-security boundary. Set it per account in the database (a checkbox UI in the Add/Edit
forms is the planned next step).

---

## Access Control

| Feature | Admin | Client |
|---|---|---|
| Input daily labor & materials lines | Yes | No |
| View daily bills & overview | Yes | Yes |
| Attach receipt to a bill line | Yes | No |
| Create / edit / raise-cap / delete labor contracts (pakyaw) | Yes | No |
| Tag a daily Labor line to a contract | Yes | No |
| Create materials procurement list | Yes | No |
| Mark item as bought (company) | Yes | No |
| Mark item as bought (client) | No | Yes |
| Upload proof of receipt (procurement) | Yes | Yes |
| View all receipts & transactions | Yes | Yes |
| Edit management-fee % (per project) | Yes | No |
| Edit payment request amount | Yes | No |
| Manually send payment request | Yes | No |
| Self-pay | No | Yes |
| Mark week as strict | Yes | No |
| View payment history | Yes | Yes |
| Add / edit / delete a project | Yes | No |
| Manage payment QR settings | Yes | No |
| Build accomplishment reports | Yes | No |
| Request project termination | No | Yes |
| Approve / reject termination | Yes | No |

---

## Payment Flow Summary

```
Each day            → Admin logs that day's labor / materials / mat+labor lines
                      (with receipts) and saves & sends the daily bill to the client
Wednesday           → System sends payment reminder to client
Friday              → System auto-generates a payment request from billed totals
                    → Admin can edit amount if needed
                    → Client pays (full or partial up to ₱5,000 short)
                    → Revolving fund replenished

If partial paid     → Next Friday is auto-strict (full amount required)
If admin marks strict → That Friday is strict regardless of history
```

---

## Out of Scope (Not in MVP)
- Full per-worker payroll / timesheets (daily labor is logged as itemized lines; **pakyaw /
  capped contracts** add per-worker **cap tracking** on top, but not a full payroll register)
- Payment-milestone tags on contract drawdowns (advance / progress / final)
- Cover expenses / cash advances by admin
- Partial payments beyond ₱5,000 shortage
- Client editing payment amounts or fee %
