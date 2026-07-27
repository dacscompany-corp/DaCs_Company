# Migrations — apply order & rules

## The rule (as of 2026-07-12)

**Nothing touches the schema except a file in this folder.** No Supabase SQL-editor
one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
capture exist. Write the migration, apply the migration, commit the migration.

- **Next number = highest existing + 1** (**0039** — highest on disk is
  `0038_payroll_payment_method_cheque.sql`). Sort the folder before you pick; don't
  trust this line if it looks stale. Duplicate numbers are how we got into trouble.
- Migrations are **immutable once applied**: never edit or rename an applied file
  (docs and code comments reference them by name). Fix mistakes with a new migration.
- Write everything **idempotent** (`if not exists` / `drop … if exists`) so replaying
  is always safe.

## Canonical apply order

Plain filename sort (`ls`). Nine numbers are duplicated (history: parallel branches);
each pair was audited 2026-07-12 and filename order is **safe**:

| Pair | Verdict |
|---|---|
| 0006 folder_budgets_staff / overhead_folder | Independent tables |
| 0016 agreement_signature / pm_contract_category | Independent (profiles vs pm_labor_contracts) |
| 0017 agreement_signature_image / partner_agreement_fields | Same table, disjoint columns |
| 0018 partner_agreements / project_partner_email | Independent |
| 0019 admin_profile_updates / partner_gate_enforcement | Independent |
| 0020 employee_terms / schema_drift_catchup | Disjoint columns |
| 0021 agreement_events / partner_terms_pdf | Independent |
| **0022 client_terms_pdf / drop_terms_columns** | **Conflicting on purpose** — see below |
| 0023 agreement_doc_versions / worker_agreement | Independent |

Numbers 0024 onward are unique — no new duplicates since the audit.

**There is no 0034.** It was written and withdrawn in the same session (it added a
column that was reworked before anything shipped). `0035_weekly_bill_overhead.sql`
took the next number rather than reusing 0034, so it still applies cleanly on a
database where the withdrawn file happened to run — the reasoning is in that file's
header comment. The gap is intentional; nothing is missing.

**The 0022 pair:** `client_terms_pdf` ADDs five `profiles.terms_*` columns that
`drop_terms_columns` DROPs. The per-client-terms-PDF feature was abandoned the week it
was written; verified against the live DB (2026-07-12): the columns **do not exist**
and no JS reads or writes them. Filename order replays add→drop, ending with the
columns dropped — which matches live. Do not "fix" the order: dropped is correct.

## Status ledger

Everything through **0027** is applied to the live database
(hqbgduyonlbbsvjuapre) — 0025/0026 applied 2026-07-12; 0027 pending the JS deploy
(see the deploy-order warning inside 0027 itself).

**Unverified past 0027.** 0028–0038 exist on disk and were presumably applied as they
were written, but nobody has confirmed it against the live DB since 2026-07-12. Get the
truth before relying on this line:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

Caveat: that table only records migrations pushed through the Supabase CLI. Anything
pasted into the SQL editor by hand is live but absent there — a missing row means
"check whether the column/table exists", not "not applied".
