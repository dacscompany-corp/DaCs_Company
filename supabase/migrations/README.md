# Migrations — apply order & rules

## The rule (as of 2026-07-12)

**Nothing touches the schema except a file in this folder.** No Supabase SQL-editor
one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
capture exist. Write the migration, apply the migration, commit the migration.

- **Next number = highest existing + 1** (**0097** — highest on disk is
  `0096_purchase_recording.sql`). Sort the folder before you pick; don't
  trust this line if it looks stale. Duplicate numbers are how we got into trouble.
- **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
  project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
  reached the live DB** — confirmed 2026-09-27: `project_cost_plans` exists live with
  `labor_pct` / `material_pct` / `overhead_pct`. Never reuse either number.
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

**`0057_labor_contract_category.sql` — applied by hand (2026-08-25), file written after the fact.**
Adds `labor_contracts.category` ('labor' | 'outsource') for Project Control Out Source contracts,
the twin of what 0016 did to `pm_labor_contracts`. The user ran the SQL in the editor before the
file existed, so it will NOT appear in `supabase_migrations.schema_migrations` — check the column
itself, not that table. Every statement is idempotent (`add column if not exists`, guarded
`update`, `create index if not exists`), so re-running the file over the hand-applied change is
safe. **Confirm the live column matches the file** (name `category`, `text`, default `'labor'`)
before trusting the Out Source screens.

**`0073_project_control_billing_allocations.sql` IS applied** — confirmed 2026-09-21 against live
(`hqbgduyonlbbsvjuapre`, branch `main`, PRODUCTION) with `supabase/tests/0073_verify.sql`, which is
read-only and parse-safe in both states. Verified directly: all three tables present, RLS enabled on
each, `update_project_control_billing_allocation()` present **and** `SECURITY DEFINER`,
`overhead_expenses.billing_period_id` present and **nullable**, the audit table carrying **zero**
write policies, and the snapshot table carrying no UPDATE/DELETE policy. The file is one
transaction, so the grants and the publication membership committed with the rest.

It is purely additive and every statement is idempotent, so re-running is safe:

- three owner-only tables — `project_control_allocation_policies` (per folder),
  `project_control_billing_allocations` (per billing period) and the append-only
  `billing_allocation_adjustments`;
- one nullable column, `overhead_expenses.billing_period_id`, plus its index. Existing rows keep
  `null` and behave exactly as before;
- `update_project_control_billing_allocation()`, a `security definer` RPC that is the **only**
  writer of the audit table and the only way to change a snapshot after creation;
- explicit `revoke` + `grant` on all three tables (SELECT+INSERT only on the snapshots, SELECT only
  on the adjustments) so the grants hold with or without automatic Data API exposure;
- publication membership, which the shim's `onSnapshot()` needs for live updates.

Nothing is dropped or rewritten. **The JS was still unmerged when this landed** — the migration went
first, which is the safe order: without the column, every overhead save fails (the shim maps
camelCase straight to a real column), and creating a billing period fails at
`_pcInsertInitialAllocation()` and rolls itself back.

**`0079_app_releases.sql` IS applied** — 2026-09-28, SQL editor on DaCs_Company, "Success. No
rows returned"; confirmed from outside with a signed-out call to `app_latest_release` (200, `[]`).
**`0080_app_releases_owner_check.sql` IS applied** — 2026-09-28. That same check had shown
`app_list_releases` answering a signed-out caller (anon grant + a NULL-unsafe owner check).
Confirmed after 0080 with the anon key: `app_latest_release` 200 `[]`; `app_list_releases` and
`app_publish_release` both 401 `42501 permission denied`.
0079 as written: Adds `app_releases`, the
public `app-releases` storage bucket (owner-only upload; a published APK cannot be deleted),
`app_latest_release()` (callable by `anon` -- the worker app asks before sign-in),
`app_list_releases()` and `app_publish_release()` (both owner-only). Applying it changes **no**
`min_app_version`; only a publish from admin.html → Attendance → App updates does, and that
publish raises `attendance_config.min_app_version` for every owner in the same transaction.
**Do not publish versionCode 4 until v4 is installed on every phone** -- v4 is the first build
with the update dialog; see the file's header.

**0081 (uploads access repair)** removed two hand-made storage policies that existed in no
migration, `uploads_read` and `uploads_insert`, both granted to PUBLIC (not-logged-in visitors
could list and download every file). Applied 2026-09-29 through the SQL editor, so it has no
`schema_migrations` row; live check `supabase/tests/uploads_access.sql` passed the same day.
Emergency undo: `supabase/rollback_0081_uploads_access.sql` (does not restore public access).

**0083 (attendance photo replace policy)** records `attendance: worker replaces own photo` (UPDATE on
`storage.objects`, bucket `attendance`, first folder = the worker's own id), which existed only in the live
database. Both worker apps upload with `upsert`, so re-sending a photo after a failed Time In RPC is an
UPDATE; without the policy a database rebuilt from migrations would refuse every such retry forever. The
file creates the policy only when it is missing, so applying it live changes nothing.

**0086 (WorkMate Requests — office)** adds the owner/staff RPCs behind Dacs Web → Requests (queue, arranged, reductions, conflicts, batches, teams, catalogue, Allow requests) and `pr_folder_request_count`, which Dacs Web calls before deleting a project. It also **drops** the direct insert/update policies on `pr_batches`, `pr_teams`, `pr_team_members`, `pr_catalog_items` and `pr_project_settings` — those change only through the office RPCs. Dry-run with `supabase/tests/0086_verify.sql` (self-wrapped in begin/rollback) before applying.

**0087 (Requests — office name)** changes only `pr_person_name`: owner/staff accounts with no display name now read **"Office"** instead of "Worker" in request history and the other office-facing names. Grants unchanged; no table or data changes.

**0088 (WorkMate Requests — worker cancel alignment)** aligns a worker's cancel with the office's: cancelling the last open line now closes the request (like `pr_office_cancel_line`), and a new cancel of something already cancelled succeeds without change and records no event (same-op retries were already safe through `pr_ops`). The three request-first cancels (`pr_cancel_line`, `pr_cancel_request`, `pr_office_cancel_line`) take the request lock `FOR NO KEY UPDATE`, so they cannot deadlock with line-first RPCs; `pr_office_cancel_line` is re-declared with only that lock change. Grants unchanged; no table or data changes. Dry-run with `supabase/tests/1a_acceptance.sql` (self-wrapped in begin/rollback) before applying.

**0089 (receipt photos as files)** tenant-locks two new upload folders `expenseReceipts/` and `payrollReceipts/` (owner/staff of THAT company only, also for overwrite), adds the `receipt_uploads` ledger with an attach trigger on `expenses`/`payroll`, and grants `authenticated` only `select` plus a column-level `insert (path, owner_id, kind)` on the ledger (state and timestamps always take their defaults), makes the attach trigger match the row's own company (`owner_id = new.owner_id`), and adds `client_submission_id` + a unique index so a retried save cannot duplicate. No data changes. Live check: `supabase/tests/0089_verify.sql` (self-rolling-back; safe in the SQL editor — the editor shows only the last result, so no error = passed).

**0090 (WorkMate Stage 1b-1 — item history server)** adds Find Previous Item: `pr_project_settings.allow_history` (per project, off by default, independent of Allow requests, kept after completion), catalogue `aliases`/`brand` (search aids, not identity), `pr_lines.ref_kind/ref_id` (Request Again link), `pr_photos.gallery_review*`, the tables `pr_item_refs` (hand-entered historical references; retired, never deleted; cascade with their project) and `pr_gallery_photos` (reviewed copies in the private `item-gallery` bucket, several per item, one cover), worker RPCs `pr_history_search/item/visible`, eleven new office RPCs, and re-declares `pr_submit_request`, `pr_request_doc`, `pr_office_catalog`, `pr_office_projects` by adding lines only; `pr_office_save_item` gains two optional arguments (the 7-argument form is dropped; the old call shape still works). One function, `pr_history_entries`, decides per entry what a worker may see. No money. Dry-run with `supabase/tests/1b_acceptance.sql` (self-wrapped in begin/rollback, editor-safe), then re-run `1a_acceptance.sql` through MCP `execute_sql` (it uses a temp table, which the SQL editor breaks). Also adds the `pr_lines_catalog_item` index (history lookups by item).

**0091 (Request Again source label)** re-declares only `pr_ref_label`: a request-line source now ends with `pr_entry_label(...)` ("Requested" or "Requested — cancelled", cancelled = the line or its request), matching what the worker's phone shows. Before, a cancelled source read "Requested" in Dacs Web (found in the 1b-4 pilot, 2026-10-12). Display text only — no table, data or permission change.

**0092 (catalogue kind/unit lock)** re-declares `pr_office_save_item` and `pr_office_catalog` (0090 copies, lines only added): once any request line (cancelled included) is matched to an item, changing its **Kind or Unit** is refused with `ITEM_IN_USE` — add a new item and deactivate the old one; name, spec, category, brand, other names and Active stay editable. `pr_office_catalog` gains `in_use` so Dacs Web locks the two fields before Save. Required before Stage 2 (stock counts in the item's unit). No table, data or permission change.

**0093 (WorkMate Stage 1c-1 — My Work server)** adds the work plan: `wp_meetings` (office-only `original_notes`) with published shared-note versions `wp_meeting_versions` + `wp_note_recipients`, `wp_tasks` (draft → not_started → in_progress → reported_done → leader_checked → completed, or cancelled; `sent_back`; `version` for re-acknowledgement), `wp_task_people` (one responsible + helpers, history kept), `wp_acks` (per version), `wp_blockers` (office clears with a note), `wp_dependencies` (same project, no cycles), `wp_events`, `wp_ops` (retry-safe worker writes) and `wp_photos` in the private `task-photos` bucket. Blocked is derived (`wp_task_blocked`) and locks Start work / Report done / approval. Worker RPCs `wp_my_work`, `wp_my_notes`, `wp_acknowledge`, `wp_start_work`, `wp_report_progress`, `wp_report_blocker`, `wp_report_done`, `wp_leader_check`, `wp_propose_task`, `wp_attach_photo`; office RPCs `wp_office_*`. No money; nothing feeds Spent, Attendance or payroll. Dry-run with `supabase/tests/1c_acceptance.sql` (self-wrapped, editor-safe).

**0094 (WorkMate Stage 1c-2 — office Work Plan server)** (1) `pr_is_office()` now also requires an active profile, so a deactivated owner/staff account loses every office RPC that calls it (Requests, Item History, Work Plan) — the role-only storage helpers `pr_office_gallery_path_ok` / `wp_office_task_path_ok` and the 0085 direct-read policies are a recorded follow-up; (2) adds the read-only worker RPC `wp_my_proposals()` — the caller's own proposals from the last 90 days as `sent` / `published` / `declined` / `cancelled` with the office's reason, never office-only fields; (3) replaces `wp_office_save_task` so a published task's version rises automatically for any change of responsible person, helpers, team or planned dates, and for a wording change unless `minor_text_only` (which never covers people, team or dates). 0093 is not edited. No money. Dry-run with `supabase/tests/1c2_acceptance.sql` and `supabase/tests/1c2_office_active.sql` (both self-wrapped, editor-safe).

**0095 (AI request gate)** adds `ai_requests` (who / feature / characters / when — never the text; no client access) and `ai_authorize(feature, chars)`, which the `dacs-ai` Cloudflare worker calls as the signed-in caller before running any model: active account; `work_plan_draft` for owner/staff (module-focused: `workplan`), `budget_summary` and `health_briefing` for owner (module-focused: `expenses`); input ≤ 40,000 / 4,000 / 12,000 characters; per person 10 per 10 min and 50 per rolling 24 h (drafts), 20 and 100 (budget summary and health briefing, each counted on its own); per company 300 per rolling 24 h (never a calendar day). Apply before deploying the worker. Dry-run with `supabase/tests/1c2_ai_gate.sql` (self-wrapped, editor-safe); simultaneous requests: `supabase/tests/1c2_ai_gate_concurrency.mjs` (two connections, after applying).

**0096 (WorkMate Stage 2A-1 — one purchase recording operation)** adds `purchases` (one receipt: actual `purchase_date`, `receipt_total`, docs, `recorded`/`void`), `purchase_lines` (project or AW folder — kept as history with `folder_name`, no foreign key, so a project whose purchases are all voided can be deleted — or warehouse), `purchase_charges` + `purchase_charge_shares` (delivery fee / discount, split by line to the centavo, largest remainder), `purchase_history` (recorded / corrected / refunded / voided / replaced, before and after), `pur_ops` (first answer per operation id) and `purchase_stock_moves` (one stock move per line, ever); `expenses.purchase_line_id` / `purchase_charge_id` / `folder_id`. `pur_record`, `pur_correct`, `pur_refund`, `pur_void`, `pur_replace` (void + record in one transaction, stock carried over) — active owner/staff accounts allowed the **Expenses** section only, for recording AND reading (module-focused accounts refused; source `workmate` refused until the 2A-2 Buyer switch) — write ORDINARY `expenses` rows funded by the ACTUAL purchase month: earliest billing number first, each period up to budget − expenses − payroll, shortage to Cover (`cover_expense`) on the project's Cover period, else a client period of **that month only** (never another month's — it would use up that month's client money), no eligible period that month → all Cover + `needs_funding_review`; no Cover period and no billing period in the purchase month → a Cover row tied to the project (`folder_id`, no `project_id`), flagged — no period is ever invented; Additional Works in full on their own period. Quantities and minimum stock take **at most 3 decimals** (more is refused, `BAD_QUANTITY`; Dacs Web rounds first). Every call locks its operation, then (for a change to an existing purchase) that purchase, then every project and stock item it touches, in one fixed order, before writing. The "track in inventory" stock update runs inside the recording, once per line, matched within the company. Trigger `expenses_purchase_guard` refuses any other write to a purchase-made or project-level row; triggers `folders_purchase_delete_guard` / `projects_purchase_delete_guard` refuse deleting a project or period with a live purchase BEFORE anything is removed (a fully discounted purchase counts), and Dacs Web asks `pur_live_purchases()` first — it counts the project's Additional Works jobs too, since they cascade-delete with it. Dacs Web Expenses → Add expense records through `pur_record` from this migration on: **apply 0096 before deploying the web change.** Prove with `npm run test:sql` (PGlite + two sessions on a throwaway real PostgreSQL; CI runs it too); live: `supabase/tests/2a1_acceptance.sql` (self-wrapped, rolls back).

Get the truth before relying on this line:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

Caveat: that table only records migrations pushed through the Supabase CLI. Anything
pasted into the SQL editor by hand is live but absent there — a missing row means
"check whether the column/table exists", not "not applied".
