# PM Profit Sharing — Personal items (design)

Date: 2026-10-31 · Status: **design approved in chat, awaiting written review**
Builds on: [2026-10-18-pm-profit-sharing-mvp-terms.md](2026-10-18-pm-profit-sharing-mvp-terms.md) (Release 1, live)

## 1. Purpose

The owner or the partner sometimes buys an item **for themselves** out of a PM project's
money. That item should come off **that person's share only** — the other person's share
must not move.

Today the split is:

```
Sharing balance = paid − direct cost − warranty reserve
Owner share     = balance − partner share
Partner share   = balance × partner %
```

This adds one step at the very end:

```
Owner after items   = owner share   − owner's active personal items
Partner after items = partner share − partner's active personal items
```

**Worked example:** balance ₱100,000, split 50/50, the owner bought a ₱10,000 drill →
owner **₱40,000**, partner **₱50,000**. The balance stays ₱100,000.

## 2. Decisions (owner, 2026-10-31)

| # | Question | Answer |
|---|---|---|
| D1 | Whose share drops? | **Personal only** — each item is charged to one person (owner or partner), and only that share drops. No "shared" items. |
| D2 | Tied to what? | **One PM project** per item. |
| D3 | Also a project cost? | **Never.** An item lives only in Profit Sharing. It is never in a bill, expense, Spent or Profit. An item wrongly put in a bill is removed from the bill by hand. |
| D4 | Who may write? | **Main owner only** (role `owner`, `owner_id` null, active — the same test `pm_set_sharing` uses; never `allowed_modules`). Other owner-role accounts (e.g. admin-pm@) read only. Staff and workers see nothing. |
| D5 | Fields | Charged to, item name, amount, date bought, note, optional receipt photo. |
| D6 | Which projects | **Completed projects**, from PM → Profit Sharing → project page (owner decision 2026-10-31: panel moved there, removed from the Overview). |
| D7 | Items bigger than the share | **Allowed.** The amount after items shows as a minus with the flag "Items exceed share". The other person's figure is never touched. |
| D8 | Mistakes | **Corrected or voided with a reason, never deleted.** Every change is written to an append-only history. |

## 3. Money rules (outside the money model)

- A personal item is an **internal allocation adjustment**, like the split itself. It is
  never a payout, amount owed, invoice, expense, accounting entry or reimbursement.
- Nothing may feed items into Project Control's Spent / Earned / Profit, PM direct cost,
  the warranty reserve or the sharing balance. Items come off **after** the split only.
- A voided item counts **₱0**.
- All figures are in integer centavos, using the existing `toCents` in `js/pm-sharing.js`.
- Partner-side items always reduce the partner side, and owner-side items the owner side,
  **including** when the balance is a loss (negative shares).

## 4. Storage and server rules

Migration number: **next free number at build time** (0110 or later — 0109 is held by the
Stage 4 draft). Checked against `supabase/migrations/README.md` before writing.

### 4.1 `pm_sharing_items`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid pk | |
| `company_owner_id` | uuid | from `pm_project_companies`; never from the caller |
| `project_id` | uuid | must be mapped to the caller's company |
| `charged_to` | text | `'owner'` or `'partner'` |
| `item_name` | text | trimmed, 1–120 chars |
| `amount` | numeric(14,2) | > 0, ≤ 99,999,999.99 |
| `bought_on` | date | not in the future (PH date) |
| `note` | text | optional, ≤ 500 chars |
| `receipt_path` | text | optional, must be `pmSharing/<company>/<yyyy-mm>/<uuid>.jpg` |
| `status` | text | `'active'` or `'voided'` |
| `void_reason` | text | required when voided |
| `version` | int | starts at 1; each correction / void adds 1 |
| `created_by`, `created_at`, `updated_at` | | set by the server |

RLS on, **no direct table policies** for clients: reads and writes go through the functions
below (same as Release 1).

### 4.2 `pm_sharing_item_events` — append-only history

One row per record / correct / void: item id, company, kind, old and new values (jsonb),
reason, actor id and email, time. A trigger refuses UPDATE and DELETE (same pattern as
`pm_sharing_changes_immutable`).

### 4.3 `pm_sharing_item_ops` — run-once

`op_id` primary key, company, action, actor, stored result — the same pattern as
`pm_cash_advance_ops` (0100). The first call with an id does the work; a repeat returns the
stored result and records nothing.

### 4.4 Write functions (main owner only)

- `pm_si_record(p_op_id, p_project, p_charged_to, p_item_name, p_amount, p_bought_on, p_note, p_receipt_path)`
- `pm_si_correct(p_op_id, p_id, p_expected_version, p_charged_to, p_item_name, p_amount, p_bought_on, p_note, p_receipt_path, p_reason)`
- `pm_si_void(p_op_id, p_id, p_expected_version, p_reason)`

Each one checks the main owner, the project's company, field limits and (for correct /
void) that the item is active and its version matches — otherwise `ITEM_CHANGED`. A reason
is required for correct and void. Each locks the item row, writes the event and returns the
item as JSON. Error codes: `OWNER_ONLY` (0098's main-owner check), `PROJECT_UNMAPPED`,
`WRONG_COMPANY`, `BAD_AMOUNT`, `BAD_PRECISION`, `BAD_NAME`, `BAD_NOTE`, `BAD_REASON`, `BAD_DATE`,
`BAD_CHARGED_TO`, `REASON_REQUIRED`, `ITEM_VOIDED`, `ITEM_CHANGED`, `NOT_FOUND`,
`BAD_RECEIPT_PATH`, `BAD_OP`, `OP_REUSED`.

### 4.5 Read

`pm_sharing_read` (0098) gains an `items` key: every item (active and voided) for the caller's
company and the requested projects, newest first, plus each item's events. Same callers, same
owner-company rule as today, so every screen that already calls `PMShare.load` gets the items
in the same fetch.

### 4.6 Receipt photos

New top storage folder `pmSharing/` (path `pmSharing/<company>/<yyyy-mm>/<uuid>.jpg`, built by
`DacsReceipts.receiptPath`). New rules in `uploads_can_read` / `uploads_can_write`:
write = main owner; read = owner-role accounts of that company; everyone else refused; never
overwritten. Added to `FOLDERS` in `tests/storage-access.test.js`. Photos are compressed like
other receipt photos and opened through a short-lived signed link.

## 5. Calculation — `js/pm-sharing.js`

`PMShare.project(input)` takes an optional `items` list. It adds to the result:

- `ownerItemsCents`, `partnerItemsCents` — sums of **active** items per side
- `ownerAfterCents = ownerCents − ownerItemsCents`
- `partnerAfterCents = partnerCents − partnerItemsCents`
- flag `items_exceed_share` when a side has active items **and** its "after" amount is below zero

`balanceCents`, `ownerCents`, `partnerCents`, the reserve and every other existing field stay
**exactly** as today. `PMShare.combine` adds the totals of the four new figures. The new
flag does **not** move a project out of the "confirmed" group.

## 6. Screens

### 6.1 Profit Sharing project page — "Personal items" panel, step 5 (`js/pm-sharing-items.js`)

Step 5 of the project page (after Left to share), owner-role accounts only (staff cannot open the dashboard; nothing fetched). The project Overview has no panel.

- Main owner: **Add item** opens a form — Charged to (You / Partner), Item, Amount, Date
  bought (default today, PH date), Note, Receipt photo (optional). Each row has **Correct**
  and **Void**, both asking for a reason.
- Other owner-role accounts: the same list, no buttons.
- Voided rows stay visible, greyed, "Voided — reason", counting ₱0.
- Saving disables the button until the server answers; a retry reuses the same operation id.

### 6.2 Everywhere the split is shown

| Place | Change |
|---|---|
| Overview Sharing card (`_pmShareTexts`) | Split line "You ₱40,000 (50%, after ₱10,000 items) · Partner ₱50,000 (50%)"; red + "Items exceed share" when below zero |
| Overview print | Same line, plus the item list |
| Reports sharing card | Combined line shows "after ₱X items" per person; the per-project "Items exceed share" warning appears on the Overview and the dashboard, not on this combined card |
| Profit Sharing dashboard — hero and table | Amounts after items, with an "after ₱X items" line under each share |
| Dashboard project page | Full Personal items panel (step 5) — main owner Add/Correct/Void, others list only |
| Overview (panel) | No panel; the split line and print still show items |
| Dashboard print / CSV | Columns: owner items, partner items, owner after items, partner after items |

The balance card's big number does not change. Every figure comes from `PMShare.project` /
`PMShare.combine`.

### 6.3 Not changed

Client portal and partner portal (`Client Management.html`, `Dacs Partnership.html`): no
change — the partner portal is excluded (Release 1 Phase C). Project Control, weekly bills,
expenses, warranty fund, cash advances: no change.

## 7. Tests and acceptance

### 7.1 `tests/pm-sharing.test.js` (npm test)

- Worked example (§1) gives owner ₱40,000 / partner ₱50,000, balance ₱100,000.
- An owner item never changes `partnerAfterCents`, and the other way round.
- Voided items count ₱0; ₱0.01 and many small items add up exactly.
- Items bigger than the share → negative "after" amount + `items_exceed_share`.
- Balance, reserve, paid, cost and pre-item shares are identical with and without items.
- No items passed → every existing figure is unchanged, and the "after" amounts equal the shares.

### 7.2 Fences

- Only `js/pm-sharing-items.js` calls `pm_si_*` (same style as `tests/cash-advance.test.js`).
- `_projSpent` / `_projEarned` / `_projMargin` / `_recognisedProfit` and PM direct cost contain
  no item symbol.

### 7.3 Server suite (new, modelled on `supabase/tests/pm_sharing.pglite.mjs`)

- Main owner: record, correct, void succeed; history rows written.
- admin-pm@ / other owner-role: writes refused `OWNER_ONLY`, reads allowed.
- Staff, worker, another company's owner: reads and writes refused.
- Bad amount / name / date / charged_to, missing reason, future date: refused with the right code.
- Correct or void a voided item → `ITEM_VOIDED`; a stale version → `ITEM_CHANGED`.
- The same op id twice records once; an op id reused for a different action → `OP_REUSED`.
- Two corrections racing on one item: one wins, the other gets `ITEM_CHANGED` (concurrency suite).
- Events cannot be updated or deleted.
- Storage: main owner writes `pmSharing/`, owner-role reads, staff refused.

### 7.4 Live acceptance

After the owner applies the migration: check the live DB has the tables, functions and storage
rules before going on; then a ZZ test item on a real project — record, correct, void —
checked on the Overview, dashboard, print and CSV, then cleaned up by its ZZ marker only.

## 8. Affected files

- New migration (§4) + acceptance SQL + pglite and concurrency suites
- `js/pm-sharing.js` — calculation (§5)
- `js/pm-sharing-items.js` — new: panel, form, server calls
- `js/pm-admin.js` — Overview card, Overview print, Reports
- `js/pm-sharing-dashboard.js` — hero, table, detail, print, CSV
- `admin.html` — script tag, panel holder, form modal
- `tests/pm-sharing.test.js`, `tests/storage-access.test.js`, a new fence test
- `docs/DATABASE_SCHEMA.md`, CLAUDE.md money-invariant line, an addendum note in the Release 1 spec
