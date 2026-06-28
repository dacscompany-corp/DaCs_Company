# Labor Contracts (Pakyaw & In-House Capped Pay) — Design Spec

> **Status:** Draft for approval · **Scope:** Project Control / Labor
> Plan only — no code written yet.

## Hard constraint

> Workers have **no portal or login**. All contract and payment data is **manually
> entered by the admin**. Worker records are **free-typed names, not user accounts**.
> All screens are **admin-only**, inside the existing admin app.

---

## 1. Summary

Add the ability to set an **agreed capped amount** for a worker's job, then **pay it
out in pieces over time** while always seeing **how much is left**, with a **warning
before overpaying**. Works for **pakyaw (contract) workers and in-house (regular)
workers alike** — same machinery, different label. Adds three lenses on labor:
**by project** (today), **by contract** (new), **by worker** (new).

## 2. Goals / Non-goals

**Goals**
- Track **Agreed -> Paid -> Remaining -> % paid** per worker job.
- Support **installment payments** (vale/advance, progress, final) drawing down to a cap.
- **Warn (not block)** when a payment would exceed the agreed amount.
- Allow **multiple contracts per worker** (e.g. Aerol: "Tiling" + "Extra masonry") and
  **raising a cap** when scope grows.
- A **per-worker tracker** (this project) summing all their contracts + daily-rate pay.
- **No friction for rush hires** — type the worker name, done.

**Non-goals**
- No change to profit/margin/budget-health math.
- No mandatory worker registry.
- No worker portal/login (admin manually inputs everything).
- No payroll/government-computation changes.

## 3. Concepts & terminology

| Term | Meaning |
|---|---|
| **Labor Contract** | A capped agreement: one worker, one job, on one project, with an **agreed amount**. |
| **Cap (agreed amount)** | The fixed total to be paid for that job (e.g. 100,000). |
| **Drawdown** | A payroll payment that counts against a contract. |
| **pay_type** | `pakyaw` (external contract) or `inhouse` (capped regular worker) — **label only**. |
| **Milestone** | Optional tag on a payment: `advance` (vale) · `progress` · `final`. |
| **Project** | The folder (e.g. "Barlin Residence"). Contracts attach here, spanning any billing period within it. |

## 4. How it connects to the current system

It **rides on the existing `payroll` pipeline** — a contract is just a **cap that groups
payroll rows**.

```
  Expenses module (entry)                    PAKYAW/CAPPED ADD-ON
   |- Add/Edit Payroll form  ----------->  + "Pay against contract" picker + remaining hint
   |- (new) Contracts manager screen
                | writes payroll rows (optionally with contract_id)
                v
   payroll (Supabase)  ----------------->  + labor_contracts table (new)
                |                           + payroll.contract_id, payroll.pay_milestone
                | loaded live (onSnapshot -> Supabase) — SAME loaders
                v
   Project Control portal
    buildProject -> Spent / Profit  <----- UNCHANGED (pakyaw pay already counts)
    LaborDrill  ------------------------>  + Agreed/Paid/Remaining display (existing data, grouped)
```

**~80% reuse.** Payments without a `contract_id` behave **exactly as today**.

## 5. Data model

### 5.1 New table — `labor_contracts`
| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | PK |
| `owner_id` | uuid | account scope (like all tables) |
| `folder_id` | uuid | the **project** the contract belongs to |
| `worker_name` | text | worker (free text + autocomplete) |
| `scope` | text | the job, e.g. "Tiling & masonry" |
| `agreed_amount` | numeric | **the cap** |
| `pay_type` | text | `pakyaw` \| `inhouse` |
| `status` | text | `ongoing` \| `completed` |
| `cap_history` | jsonb | `[{amount, at, note}]` when the cap is raised |
| `notes` | text | optional |
| `created_at` / `updated_at` | timestamptz | |

### 5.2 Changes to `payroll` (the drawdowns)
| New column | Meaning |
|---|---|
| `contract_id` | which contract this payment draws down (null = normal payroll) |
| `pay_milestone` | `advance` \| `progress` \| `final` (optional) |

### 5.3 Migration (matches existing style, e.g. `0010`)
```sql
create table labor_contracts (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  folder_id     uuid references folders(id) on delete cascade,
  worker_name   text,
  scope         text,
  agreed_amount numeric default 0,
  pay_type      text default 'pakyaw',
  status        text default 'ongoing',
  cap_history   jsonb default '[]'::jsonb,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index labor_contracts_owner_idx  on labor_contracts(owner_id);
create index labor_contracts_folder_idx on labor_contracts(folder_id);

alter table payroll add column if not exists contract_id   uuid references labor_contracts(id) on delete set null;
alter table payroll add column if not exists pay_milestone text;

alter table labor_contracts enable row level security;
create policy lc_admin on labor_contracts for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
```

### 5.4 Mapping (js/supabase-config.js)
Add a top-level collection (scoped by `owner_id`, like `folders`/`payroll`):
```js
laborContracts: { table: 'labor_contracts', rename: { userId: 'owner_id' },
                  ts: ['createdAt', 'updatedAt'] },
```
`payroll`'s new fields map automatically (`contractId -> contract_id`, `payMilestone -> pay_milestone`).

## 6. The three lenses on labor

| Lens | Question it answers | Where |
|---|---|---|
| **By project** (today) | What did this *job* cost? | Project Control dashboard |
| **By contract** (new) | Is this *agreement* paid up? | Contracts manager / Contract detail |
| **By worker** (new) | What does *this person* have agreed/paid/owed on this project? | Worker Tracker |

## 7. Features (by phase)

### MVP
1. **Create a contract** — worker (autocomplete), scope, project, agreed amount, pay_type (pakyaw/in-house).
2. **Multiple contracts per worker** (per job) — Aerol can have "Tiling" + "Extra masonry".
3. **Link a payment to a contract** — payroll form gets a contract picker + **"Remaining: X"**.
4. **Drawdown math** — auto **Paid / Remaining / % paid** from linked payments.
5. **Over-cap warning** — "exceeds agreed 100,000 by 5,000 — save anyway?" (allows save).
6. **Status** — auto **Completed** at cap; **Over** badge if exceeded.
7. **Contracts list** (per project) — all workers' caps with paid/remaining + progress bar.
8. **Worker Tracker (this project)** — per worker: all contracts + uncapped daily-rate + **totals (agreed/paid/remaining)**.
9. **Worker autocomplete** — type-or-pick from names already used on the project (no registry).

### Phase 2
10. **Raise the cap** (variation) — edit agreed amount up, logged in `cap_history` with a note.
11. **Payment milestones** — tag drawdowns advance/progress/final.
12. **Per-contract running balance** ledger (wallet style, like the revolving fund).
13. **Project Control rollup** — dashboard line: "Contracted labor: X agreed · Y paid · Z outstanding."
14. **Receipts on drawdowns** — reuse existing receipt-image attachments.

### Later
15. **All-projects worker view** — a worker's standing company-wide.
16. **Work % vs paid %** — flag "paid 80% but only 50% done."
17. **Merge/rename worker** cleanup (only if duplicates appear).
18. **Print a contract statement** (admin prints paper copy; reuse the print pattern).

## 8. UX / screens

**A. Contracts list (per project)**
```
Labor Contracts — Barlin Residence                  [+ New Contract]
Worker · Scope --------- Type ----- Agreed -- Paid ---- Remaining -- Status
Aerol · Tiling           Pakyaw    100,000   100,000        0       Done
Aerol · Extra masonry    Pakyaw     30,000    12,000    18,000   Ongoing 40%
Mang Tonio · Finishing   In-house   80,000    50,000    30,000   Ongoing 63%
```

**B. Payroll form (capped worker)**
```
Worker: [Aerol v autocomplete]   Contract: [Tiling (100,000) v]
Remaining: 30,000
Amount: [ 35,000 ]   Over cap by 5,000 — save anyway?  [Save] [Cancel]
Milestone: ( ) advance   ( ) progress   (o) final
```

**C. Worker Tracker (this project)**
```
WORKER: Aerol — Barlin Residence
Contracts
  - Tiling           100,000   Paid 100,000   Completed
  - Extra masonry     30,000   Paid 12,000    Ongoing (40%)
Daily-rate (uncapped)          18,500   (5 days)
----------------------------------------------------
TOTALS   Agreed 130,000 · Paid 130,500 · Remaining 18,000
```

## 9. Calculations & rules

```
paidToDate = sum payroll.totalSalary where contract_id = this contract
remaining  = agreed_amount - paidToDate
pctPaid    = paidToDate / agreed_amount * 100
status     = paidToDate >= agreed_amount
               ? (paidToDate > agreed_amount ? 'Over' : 'Completed')
               : 'Ongoing'
```
- **Over-cap = warn but allow** (recoverable state, not an error).
- **Raising the cap** appends `{amount, at, note}` to `cap_history`; setting it below what's
  already paid -> flagged Over.
- **Profit/margin/health** keep using `totalSalary` exactly as today — **no change**.
- **"Already got the total but continues"** -> either **new contract** (new scope) or
  **raise cap** (same job grew).

## 10. Worker identity (no registry, no portal)
- Worker stays **free text** with **autocomplete** suggesting names already used **on this project**.
- Rush hire -> just type; repeat worker -> tap the suggestion (keeps spelling consistent).
- The list **builds itself**; nothing to set up. Disambiguate rare same-name people with a
  nickname ("Aerol (tiles)").
- Workers are **records, not accounts** — no login, no worker-facing screens; admin inputs all.

## 11. Edge cases
- Unlinked payroll = unchanged behavior (backward compatible).
- Deleting a drawdown recalculates remaining.
- A worker can mix **capped contract pay** + **uncapped daily-rate** freely.
- Contract spans multiple billing periods within the project — drawdown groups by
  `contract_id`, so periods don't matter.

## 12. Backward compatibility
- Existing payroll/projects untouched; pakyaw is **additive and opt-in**.
- The portal's money model is unchanged — capped pay already flows into Spent/Profit.

## 13. Suggested build order
1. **Migration** — `labor_contracts` + `payroll.contract_id`/`pay_milestone` + supabase-config mapping.
2. **Contracts manager** (create/list) in the Expenses module.
3. **Payroll form** — contract picker + remaining + over-cap warning + worker autocomplete.
4. **Drawdown math + status badges.**
5. **Worker Tracker (this project).**
6. **LaborDrill** display in Project Control.
7. Phase-2 extras (raise cap, milestones, rollup, receipts).

## 14. File-change map
| Area | File | Change |
|---|---|---|
| DB | `supabase/migrations/00XX_labor_contracts.sql` | new table + payroll columns + RLS |
| DB mapping | js/supabase-config.js | add `laborContracts` collection |
| Entry | js/expenses-module.js | Contracts manager; payroll form picker + autocomplete + warning; worker tracker |
| Reporting | js/portal-app.compiled.js | LaborDrill: agreed/paid/remaining; (Phase 2) rollup |
| Styling | css/admin-renovation.css | progress bars / status badges |
| HTML | admin.html | containers/modals for new screens |

## 15. Decisions locked (change anytime)
- Cap scope: **per worker, per job, within a project**
- Over-cap: **warn but allow**
- Payments: **installments** (single final also supported)
- Worker identity: **free text + autocomplete (no registry, no portal)**
- Worker Tracker default: **this project**
- Data entry: **admin-only, manual**
