# Additional Works — Architecture Study

A deep study of the Additional Works module: schema, data flow, the React
component, and how it plugs into the rest of the portal.

---

## 1. The core design decision (the thing to understand first)

**Additional Works is not its own free-standing entity. It's modeled as a
_child folder_ nested under the parent project.** This is the single most
important architectural choice, spelled out in the migration header
([`0024_additional_works.sql:2-8`](../supabase/migrations/0024_additional_works.sql#L2)):

> a contract extension… Modeled as a real **CHILD FOLDER** nested under the
> parent project (`parent_folder_id`) so it gets its own contract amount and its
> own Labor/Material/Billing Periods tracking **for free via the existing folder
> machinery**.

So instead of building a whole new subsystem, they **reused the "folder =
project" machinery**. An Additional Works item _is_ a mini-project hanging off
the main project. That reuse is why it instantly gets budgets, payroll, material
expenses, and billing periods with zero new code.

**Each Additional Works item = two linked records:**

| Record | Table | Holds |
|---|---|---|
| The **child folder** (+ its budget) | `folders` (`parent_folder_id` set) + `folder_budgets` | The contract amount, and the anchor for all labor/material/period tracking |
| The **priced breakdown** | `additional_works` | The BOQ detail (categories → line items, discount) that _justifies_ the contract amount |

The `additional_works` row is **just the pricing detail** behind the child
folder's contract number — one row per child folder.

---

## 2. Data model (persistence layer)

**Migration [`0024_additional_works.sql`](../supabase/migrations/0024_additional_works.sql):**

- Adds `folders.parent_folder_id` — a **self-referential foreign key** (a folder
  can point to a parent folder), `ON DELETE CASCADE`. Deleting a parent wipes its
  children.
- Creates `additional_works`:
  ```
  id, owner_id, folder_id (→ the child folder), title, work_date,
  categories jsonb, discount numeric, notes, created_at, updated_at
  ```
- **`categories` is a jsonb blob** shaped as
  `[{ label, items:[{description, qty, unit, materialCost, laborCost}] }]`.
- **RLS is admin-only** — `is_owner() OR is_staff()`, **no client policy**
  ([`line 32`](../supabase/migrations/0024_additional_works.sql#L32)). Clients
  never see this table directly. (Modeled on `labor_contracts`.)

**Compat layer** ([`supabase-config.js:86`](../js/supabase-config.js#L86)):
`additionalWorks → additional_works`, with `categories` marked as a passthrough
`json` field. The code calls it Firestore-style
(`db.collection("additionalWorks")`) and the shim rewrites to Supabase. Note
`parent_folder_id` needs **no explicit rename** — the automatic `camelToSnake`
converter ([`line 30`](../js/supabase-config.js#L30)) turns `parentFolderId` →
`parent_folder_id` for free.

---

## 3. The pricing math (pure helpers)

Four small pure functions at
[`portal-app.compiled.js:807-818`](../js/portal-app.compiled.js#L807) do all the
money math:

```
awLineTotal(item)      = materialCost + laborCost
awCategoryTotal(cat)   = Σ line totals
awSubtotal(categories) = Σ category totals
awDiscountedTotal(e)   = max(0, subtotal − discount)
```

That `awDiscountedTotal` is exactly the **"Discounted Total Project Cost"** at
the bottom of the printed report (e.g. ₱96,150). The `max(0, …)` guard prevents a
discount larger than the subtotal from going negative.

---

## 4. The UI component — `AdditionalWorksDrill`

Defined at
[`portal-app.compiled.js:957-1150`](../js/portal-app.compiled.js#L957). It's a
React component built with `React.createElement` (the portal is pre-compiled
JSX — **do not run the build**, per project rules).

**Props it receives** (wired at
[`line 2088`](../js/portal-app.compiled.js#L2088)):

| Prop | What it is |
|---|---|
| `childFolders` | `childFolderStats` — the child folders with computed revenue/labor/material |
| `additionalWorksRaw` | live list of `additional_works` rows |
| `onOpenChild` | `setProjectId` — **drilling in makes the child the active project** |
| `folderId` | the parent project's id |

**What it renders:**

- **KPI cards** ([`1062-1068`](../js/portal-app.compiled.js#L1062)): Total
  Additional Works (₱), Projects (count), Total Spent.
- **A table** of child folders
  ([`1073-1088`](../js/portal-app.compiled.js#L1073)): Name · Contract · Spent ·
  Remaining · actions (Open → / Edit / Delete).
- **Two modals:**
  1. **Create** ([`1094-1102`](../js/portal-app.compiled.js#L1094)) — quick: just
     Title + Date.
  2. **Edit** ([`1120-1138`](../js/portal-app.compiled.js#L1120)) — the full
     pricing editor: categories → line items (description, qty, unit, material,
     labor), live subtotal/discount/total footer.

**The staff-block pattern shows up again**
([`1066, 1076-1078`](../js/portal-app.compiled.js#L1066)): when `_staff()` is
true, all peso amounts render as `—`. This is the same amount-hiding behavior
flagged as regression-prone after merges.

---

## 5. The write flow (where it gets interesting)

**Two entry points create records, and both keep the folder and the pricing in
sync:**

**Quick create — `saveNew`**
([`971-991`](../js/portal-app.compiled.js#L971)):

1. `folders.add({ parentFolderId, name })` → new child folder
2. `folderBudgets.set({ totalBudget: 0 })`
3. `additionalWorks.add({ folderId: childId, categories: [], discount: 0 })`

**Full save — `save`** ([`1016-1056`](../js/portal-app.compiled.js#L1016)):

1. Validate + **clean categories** (drop empty line items, coerce `"1,000"`
   strings → numbers)
2. If child exists → update folder name +
   **`folderBudgets.set(totalBudget = draftTotal)`**; else create the folder
3. Upsert the `additionalWorks` row

**Key point:** the contract amount lives in **`folder_budgets`, not in
`additional_works`.** Saving the priced breakdown pushes `awDiscountedTotal` into
the child folder's budget. So the pricing detail and the contract number are
stored in two places and reconciled on every save.

**Delete — `deleteChild`**
([`1057-1060`](../js/portal-app.compiled.js#L1057)): deletes only the **folder**.
The `ON DELETE CASCADE` on `parent_folder_id` (and the folder-scoped
budgets/periods) cleans up the rest. ⚠️ It does **not** explicitly delete the
`additional_works` row — that FK is `on delete cascade` against `folders`, so the
DB handles it, but only if the cascade actually fires in the compat/Supabase
path.

---

## 6. How it rolls up into the parent project

This is the payoff of the child-folder design
([`1958-2005`](../js/portal-app.compiled.js#L1958)):

- `childFolders` = folders where `parentFolderId === projectId`
  ([`1959`](../js/portal-app.compiled.js#L1959))
- `childFolderStats` runs the **same `buildProject`**
  ([`244`](../js/portal-app.compiled.js#L244)) on each child, giving each its own
  revenue (= its `folderBudget`), labor, and material.
- The **parent project's totals absorb the children**
  ([`1991-2004`](../js/portal-app.compiled.js#L1991)):
  `revenue = base.revenue + childRevenue`, and the same for labor, material,
  allocated, and the labor breakdown.

So the main project dashboard automatically reflects Additional Works in its
headline numbers — **the extra scope is additive, exactly like a contract
extension should be.**

**Navigation model:** drilling into an Additional Works item (`onOpenChild` →
`setProjectId(childId)`) makes the **child folder the active "project."** You
then see the normal project UI (labor, material, billing periods) scoped to that
child. `parentFolder` ([`2006`](../js/portal-app.compiled.js#L2006)) is the
reverse lookup so a child screen can offer "back to parent."

---

## 7. ⚠️ Likely architectural gap — two parallel representations

The **`AdditionalWorksDrill` pricing editor has no print/PDF generator, and no
"% completion / accomplishment" columns.** It only captures material + labor +
discount.

But the **printed Additional Works report** (e.g. Barlin Additional Works) _does_
have `% of Completion`, `Accomplishment to Date`, VAT-exclusive totals,
disclaimer, and the print layout. That layout is produced by **`boq-module.js`
(`boqPrintReport`)**, not by this module.

**Interpretation:** there are effectively **two parallel representations** of an
Additional Works job:

1. **`AdditionalWorksDrill`** (this module) — lightweight pricing that backs the
   child folder's _budget_.
2. **A BOQ Accomplishment Report** in `boq-module.js`, created _for that same
   child folder_ — which generates the polished PDF.

If that's right, the same job's numbers can be entered in two places, which is a
real reconciliation risk worth designing around. **Confidence ~80%** — not yet
traced whether the boq-builder is explicitly pointed at Additional Works child
folders. Open follow-up: verify how a child folder gets its BOQ accomplishment
report, to confirm whether these two systems overlap or are meant to be used
together.

---

## Appendix — key references

| Concern | Location |
|---|---|
| Schema + RLS | [`supabase/migrations/0024_additional_works.sql`](../supabase/migrations/0024_additional_works.sql) |
| Compat mapping | [`js/supabase-config.js:86`](../js/supabase-config.js#L86) |
| Pricing helpers | [`js/portal-app.compiled.js:807-818`](../js/portal-app.compiled.js#L807) |
| `AdditionalWorksDrill` component | [`js/portal-app.compiled.js:957-1150`](../js/portal-app.compiled.js#L957) |
| Data subscription | [`js/portal-app.compiled.js:1906`](../js/portal-app.compiled.js#L1906) |
| Child rollup into parent | [`js/portal-app.compiled.js:1958-2005`](../js/portal-app.compiled.js#L1958) |
| View wiring | [`js/portal-app.compiled.js:2088`](../js/portal-app.compiled.js#L2088) |
| `buildProject` | [`js/portal-app.compiled.js:244`](../js/portal-app.compiled.js#L244) |
| Print/PDF report (separate system) | [`js/boq-module.js`](../js/boq-module.js) `boqPrintReport` |
