# Migrations — apply order & rules

## The rule (as of 2026-07-12)

**Nothing touches the schema except a file in this folder.** No Supabase SQL-editor
one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
capture exist. Write the migration, apply the migration, commit the migration.

- **Next number = highest existing + 1** (**0053** — highest on disk is
  `0052_attendance_signin_throttle.sql`). Sort the folder before you pick; don't
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

**Unverified past 0027.** 0028–0040 exist on disk and were presumably applied as they
were written, but nobody has confirmed it against the live DB since 2026-07-12.
**`0041_reimbursements.sql` (Client Reimbursement Tracker) is NOT applied yet** — the
Reimbursement tab in Project Control cannot save until it is.
**`0043_warranty_retention_fund.sql` IS applied** — confirmed 2026-08-03, when a write
came back with an RLS rejection rather than a missing-table error. **`0044_warranty_status_simplify.sql`
is NOT applied yet**: until it lands, the register's check constraint still rejects
`status = 'active'`, so voiding or restoring a record will fail.

**`0050_attendance.sql` IS applied** — confirmed 2026-08-18, pasted into the SQL editor and
returned "Success. No rows returned" through the final `grant` on line 552. It is purely additive —
three new `attendance_*` tables, two new nullable `profiles` columns (`position`, `worker_no`),
a private `attendance` storage bucket, and the `attendance_time_in` / `attendance_time_out`
RPCs. Nothing is dropped or rewritten, and every statement is idempotent, so re-running is safe.
**VERIFIED 2026-08-18** — all 15 blocks of `supabase/tests/attendance_checks.sql` pass against live.
Assertion failures raise, so a clean run *is* the pass. Proven: the one-record-per-day constraint,
idempotent replay on `event_id`, the UTC+8 midnight boundary, 7:45→17:30 = 585 minutes, the 18-hour
`SHIFT_TOO_LONG` cap with night shifts still working, worker/staff RLS, and workers being unable to
write `attendance_records` directly.

**Caveat:** block 12 (cross-tenant) passed but proves little on this database — the only other
profile available shares the same tenant root. Re-run with a genuinely separate owner before
trusting that one.

**`0051_attendance_worker_owner.sql` IS applied** — confirmed 2026-08-18. Fixes a defect in 0050
(the worker project policy used `data_owner_id()`, which resolves only staff, so every worker saw an
empty project picker) and backfills `profiles.owner_id` on worker rows that had NULL. Adds the
attendance-local `attendance_data_owner()` helper and the `NO_OWNER_ASSIGNED` error.

**`0052_attendance_signin_throttle.sql` IS applied** — confirmed 2026-08-19 against live: the table
exists (RLS hides every row from `anon`), and both functions return `42501 permission denied` for
`anon`, so the REVOKEs took and workers cannot probe which emails are locked out.
Adds `attendance_signin_attempts` plus `attendance_signin_is_throttled()` /
`attendance_signin_record()`, which the `attendance-signin` Edge Function calls. That function signs
the Android worker app in server-side with the service_role key, because service-role callers skip
this project's Turnstile captcha check — Turnstile has no native Android SDK. The throttle is what
stands in for the captcha on that path; note GoTrue's own per-IP limit is useless there, since it
sees the Edge Function's IP for every worker. Apply this **before** deploying the function.

Get the truth before relying on this line:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

Caveat: that table only records migrations pushed through the Supabase CLI. Anything
pasted into the SQL editor by hand is live but absent there — a missing row means
"check whether the column/table exists", not "not applied".
