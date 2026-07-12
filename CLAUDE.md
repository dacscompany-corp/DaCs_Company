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

## Verifying

**Run `npm test` after ANY change that touches money code** (`portal-app.compiled.js`,
`expenses-module.js`, `overhead-module.js`). It's `tests/money-math.test.js` — 42 checks that
extract the live functions and enforce every invariant above; exits 1 on breakage, runs in ~1s.
If it fails with "SLICE NOT FOUND", the source was restructured — update the extraction markers
in the test file, never delete the test.

`node --check <file>` catches syntax errors in files the test doesn't cover. Then check it in the
browser: `admin.html`, log in as owner.

CI (`.github/workflows/ci.yml`) runs both of the above on every push and PR — syntax-checks all
JS and runs the money tests. Red CI on a `salvs` merge usually means the merge reverted a money
rule or the staff amount-hiding; don't merge until green.

Staff accounts (`currentUserRole === 'staff'`) must not see peso amounts anywhere.
