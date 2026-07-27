# DAC's Web — working notes

Read **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** first. It maps the entry points, the
Supabase shim, the two parallel project systems, the money model, and the lifecycle.

Plain HTML + vanilla JS, **no build step**. Open the file, edit it, refresh the browser.

---

## Hard rules

**Never run `npm run build`.** `js/portal-app.compiled.js` is the live source of truth for
Project Control and is edited **directly**. `src/portal-app.jsx.stale-*` is stale — a build would
overwrite the live portal with old code.

**A new data field needs a real DB column.** `js/supabase-config.js` is a Firestore-compat shim
over Supabase: it maps camelCase fields straight to snake_case columns. Writing a field whose
column doesn't exist makes the save fail. Check the table (and add a migration) first. The live DB
has drifted from the migrations before — twice this year.

**Mirror portal HTML edits into both** `Client Management.html` **and** `Dacs Partnership.html`.
Two live audiences, one JS file.

**`folders.id` ≠ `construction_projects.id`.** Two different project systems, two id spaces.
Querying one with the other's id silently matches nothing.

**`projects` means "billing period"**, not project.

**Dates:** never `toISOString().slice(0,10)` for a local date key — PH is UTC+8 and it rolls back
a day. Build from local parts.

---

## Money invariants (don't "fix" these)

```
Labor    = direct + (liability − liabilityIndirect)
Overhead = indirect + liabilityIndirect + overhead_expenses
Spent    = Labor + Material + Overhead
Earned   = % complete × contract        (from the BOQ accomplishment report)
Profit   = Earned − Spent
```

- Indirect labor is **Overhead, not Labor** — counted once, never both.
- Statutory burden follows its worker: a coordinator's SSS is Overhead, a mason's is Labor.
- **Overhead pay never draws down a pakyaw contract.**
- Profit uses **earned** revenue. With no accomplishment data it falls back to the contract and
  must be labelled **"Forecast"**, never "Earned".
- Company overhead (G&A) is never charged to a job.

Full reasoning: [docs/OVERHEAD_MODULE.md](docs/OVERHEAD_MODULE.md).

---

## Finishing a change

This repo **fans out**: no imports, no type checker, nothing tells you about the fifth call site.
Before writing code, grep for every place the thing is **saved, rendered, printed and exported**,
and list the files. A change that touches only the file you opened is almost always incomplete.

### Adding a data field

| Leg | Where | When |
|---|---|---|
| DB column | new migration (see §Verifying for the number) | **Always** — missing column = silent save failure |
| Shim registry | `REG` in `js/supabase-config.js` | Only if it's a new collection, or needs `ts:` / `json:` / `rename:` / `jsonbData` |
| Form input | the owning module's edit form | Always |
| Save path | usually **two** — create *and* edit | Always |
| Render | the on-screen table or card | Always |
| Print / export | `js/print-utils.js`, `js/invoice-module.js` | If it lands on a voucher, invoice or report |
| Staff hiding | `_staff()` in `portal-app.compiled.js`, equivalents elsewhere | **If it is a peso amount** |
| Both portals | `Client Management.html` **and** `Dacs Partnership.html` | If a client or partner sees it |
| Schema doc | `docs/DATABASE_SCHEMA.md` | Always |

Tracer: `payroll.payment_method` (migrations 0037/0038) landed in seven files —
`expenses-module.js`, `print-utils.js`, `portal-app.compiled.js`, `invoice-module.js`,
`DATABASE_SCHEMA.md`, plus the two migrations.

### Adding a nav section / module

1. `PRIMARY_NAV` entry — `js/admin.js` (id, label, icon, `defaultView`, `modules[]`)
2. `_FOCUS_SUBVIEWS` — `js/admin.js` — **the one that gets missed.** Skip it and drill-down views
   are blocked for `allowed_modules` accounts (e.g. `admin-pm@`) while the owner account looks fine
3. The `*_VIEWS` group in `admin.html` (`EXP_VIEWS`, `PM_VIEWS`, …), in sync with `switchView()`
4. Role filter in `_visibleNav()` — `js/admin.js` — decide staff / worker / teamLeader access
5. Section markup + `<script>` tag in `admin.html`
6. RLS policies for any new table, in the same migration
7. Module map in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §4

---

## Verifying

**Run `npm test` after ANY change that touches money code** (`portal-app.compiled.js`,
`expenses-module.js`, `overhead-module.js`). It's `tests/money-math.test.js` — 46 checks that
extract the live functions and enforce every invariant above; exits 1 on breakage, runs in ~1s.
If it fails with "SLICE NOT FOUND", the source was restructured — update the extraction markers
in the test file, never delete the test.

`node --check <file>` catches syntax errors in files the test doesn't cover. Then check it in the
browser: `admin.html`, log in as owner.

Production errors self-report into the `client_errors` table (migration 0028, reporter in
supabase-config.js §13) — query it first when a user reports "it broke":
`select at, page, kind, message, source, line from client_errors order by at desc limit 100;`

Migrations: **next number = highest + 1, never reuse, never SQL-editor changes** — see
`supabase/migrations/README.md` for the canonical order and the audited duplicate pairs.

CI (`.github/workflows/ci.yml`) runs both of the above on every push and PR — syntax-checks all
JS and runs the money tests. Red CI on a `salvs` merge usually means the merge reverted a money
rule or the staff amount-hiding; don't merge until green.

Staff accounts (`currentUserRole === 'staff'`) must not see peso amounts anywhere.
