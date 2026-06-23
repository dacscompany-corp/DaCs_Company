# Project Management & Procurement Module

## Overview
A module for DAC'S Building Design Services based on a **Cost-Plus** contract model.
Admin manages and inputs all data. Client views, tracks, and pays.

Each construction project opens into a **workspace** with five tabs (below). This doc
reflects the **current** workflow; the original spec had a weekly total-only summary,
which has since been replaced by the itemized **Daily Expenses** builder.

---

## Navigation Structure

**Parent Menu:** Project Management → pick a project → workspace tabs:
- Dashboard Overview
- Daily Expenses
- Procurements
- Progress
- Money

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

**Management fee:** **per project & editable** (default **15%**, can be **0%**). Changing a
project's rate **re-bills its unpaid bills** at the new rate.

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
- **Accomplishment Reports** — periodic progress reports tied to the project.

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

## Access Control

| Feature | Admin | Client |
|---|---|---|
| Input daily labor & materials lines | Yes | No |
| View daily bills & overview | Yes | Yes |
| Attach receipt to a bill line | Yes | No |
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
- Per-worker payroll breakdown (labor is logged as itemized lines, not per worker)
- Cover expenses / cash advances by admin
- Partial payments beyond ₱5,000 shortage
- Client editing payment amounts or fee %
