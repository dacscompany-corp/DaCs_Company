# Migrations — apply order & rules

## The rule (as of 2026-07-12)

**Nothing touches the schema except a file in this folder.** No Supabase SQL-editor
one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
capture exist. Write the migration, apply the migration, commit the migration.

- **Next number = highest existing + 1** (0029 at the time of writing). Check this
  README's table first — duplicate numbers are how we got into trouble.
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

**The 0022 pair:** `client_terms_pdf` ADDs five `profiles.terms_*` columns that
`drop_terms_columns` DROPs. The per-client-terms-PDF feature was abandoned the week it
was written; verified against the live DB (2026-07-12): the columns **do not exist**
and no JS reads or writes them. Filename order replays add→drop, ending with the
columns dropped — which matches live. Do not "fix" the order: dropped is correct.

## Status ledger

Everything through **0027** is applied to the live database
(hqbgduyonlbbsvjuapre) — 0025/0026 applied 2026-07-12; 0027 pending the JS deploy
(see the deploy-order warning inside 0027 itself).
