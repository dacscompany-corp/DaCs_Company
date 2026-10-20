# DAC's — Weekly Employee Reports MVP terms

Date: 14 October 2026 (Asia/Manila)

Status: **Draft for review.** This document records the recommended scope and conditions for the Weekly Employee Reports MVP. Creating this file does not start implementation, apply migrations, change storage policies, schedule jobs, commit, push or deploy. Recommended defaults below remain proposals until reviewed.

Source: `2026-10-09-weekly-employee-report-mvp.md`, supplied by the user, and the subsequent feature review. The original document is proposal material, not an instruction to execute its migration or implementation steps.

## 1. Purpose and success criteria

Give DAC's owner and office staff a clear weekly view of each worker's attendance, standing responsibilities and supporting photographs, with finalized reports available in an archive.

The feature must be easy to use, professionally presented and consistent with the company's existing Attendance, Workers, Sites & schedule, Work Plan and WorkMate experiences.

Success means the office can:

- Find an employee's week without opening individual daily attendance records.
- Identify missing attendance, missing Time Outs and records requiring review.
- Inspect the daily evidence and understand which hours are actually recorded.
- Retrieve a finalized report whose employee list and saved content have not silently changed.
- Print a readable, company-branded employee report and export a week to CSV.

This is an operational report. Standing duties are responsibilities, not proof of completed work. Attendance is not payroll or a measure of project accomplishment.

## 2. MVP scope

| Included | Required behaviour |
|---|---|
| Weekly overview | Select a week, search by employee name or worker number, filter by position or records needing review, and open an employee report. |
| Live report | Show the current week and any closed week still awaiting finalization as provisional. Future days are pending. |
| Employee detail | Identity, reporting dates, weekly summary, standing duties, daily attendance, site names, photographs and relevant notes. |
| General duties setup | Office-managed duties for positions in use, with an explicit unconfigured state. |
| Finalized archive | Fixed employee roster and saved reports, newest weeks first, with employee search, generation information and read-only detail. |
| Print / Save as PDF | A company-branded A4 employee report through browser printing. Multiple pages are allowed. |
| CSV | A finalized week's attendance data, without photographs, financial figures or signed URLs. |
| Historical integrity | Protected archived photo references, visible unavailable-photo states and visible differences when source attendance changes after finalization. |

The roster covers profiles with the `worker` or `teamLeader` role. It does not automatically include owner, staff, engineer or client accounts. Expanding the audience is a separate scope decision.

### Out of this release

- Work Plan task summaries, task photographs and task-based scoring.
- Employee-facing weekly reports in WorkMate or the office portal.
- A separate employee profile-photo upload system.
- Bonus amounts, bonus qualification, rates, wages or payment status.
- Payroll, invoices, purchasing, expense or journal side effects.
- AI summaries, face recognition, email delivery or push notifications.
- Editing a finalized report, silently regenerating it or implementing a correction workflow.
- Copying attendance photographs into a second archive bucket.

Automatic finalization is the recommended operating baseline in section 6; it is not an existing capability or an already authorized scheduled job.

## 3. Company ecosystem and visual standards

Use **Attendance → Weekly reports** inside the existing admin application. Keep the existing Attendance navigation and workflows usable.

Within Weekly reports, use **This week** and **Archive**. Put duty management behind a clearly labelled **Manage general duties** action. It does not need a new top-level navigation section.

Reuse the established Attendance styles: DAC's green, white surfaces, existing typography, buttons, spacing, borders, status treatment and photograph presentation. Work Plan already reuses Attendance styles; this module follows the same approach.

- Use readable sentence-case labels and familiar office language.
- Pair every status color with text; color alone must not communicate the result.
- Use green for successful/complete states, the existing brown/gold treatments where appropriate, neutral styling for pending states and clear review/error treatments.
- Preserve a clear heading hierarchy, visible keyboard focus, accessible field labels and comfortable touch targets.
- Keep desktop lists easy to scan; use readable employee cards on smaller screens.
- Provide useful loading, empty, error and retry states. A failed request must not look like an empty roster or zero attendance.
- Keep filters and the selected week when returning from employee detail.

Professional presentation means useful hierarchy, accurate labels and consistent behaviour as well as appearance.

## 4. User experience

### 4.1 Weekly overview

Show a compact employee list with photo/initials, name, worker number, position, attendance summary, review indicators and **View report**.

Use a plain-language summary above the list, for example:

> 20 employees this week. 3 have attendance records to review.

The example is illustrative, not a fixed count. Compute every displayed figure from the same report data as the employee list and exported output.

Controls: week selector, previous/next week, name/number search, position filter, **Needs review**, and **Download CSV** when a finalized week is available. Default sorting is employee name. The review filter must distinguish missing attendance, missing Time Out and verification concerns.

Do not load all daily photographs on the overview. Load photographs when their employee/day is opened, with bounded requests and cached signed links.

### 4.2 Employee report

Present information in this order:

1. Employee identity and reporting dates, with Live/Final status.
2. Weekly attendance summary and records requiring review.
3. General duties.
4. Daily attendance: date, site, Time In, Time Out, recorded duration, status and notes.
5. Finalization information and any later source differences.

Each day's two photographs must be clearly labelled **Time In** and **Time Out**. Opening one shows the full photograph with the event date/time and site context. Preserve different Time In and Time Out sites rather than combining them into one ambiguous project label.

Use a header photograph from the reported week where available and save the chosen path when finalizing. An older fallback must show its photograph date. If there is no photograph, use initials; do not substitute an unrelated employee or an unlabelled generic portrait.

### 4.3 Interface wording

| Situation | User-facing wording |
|---|---|
| Current week | This week — still updating |
| Ended week inside its grace period | Waiting for finalization |
| Finalized week | Final report |
| Finalization ran after its expected time | Finalized late, with expected and actual timestamps |
| A future day | Pending |
| A day not required by the reporting calendar | Not a required day |
| A past required day without a record | No attendance recorded |
| Time In without Time Out | Missing Time Out |
| Forgotten Time Out closed by the office | Closed by admin |
| Attendance verification has limitations | Needs verification review, with the available explanation |
| General duties missing | General duties not configured |
| Stored photo cannot be retrieved | Photo unavailable, with Retry where appropriate |
| Attendance changed after finalization | Attendance changed after this report was finalized |

Do not call a missing record an unauthorized absence, a disciplinary offence or zero hours worked.

## 5. Attendance and general-duty rules

### 5.1 Dates and calendar

The recommended first release covers **Monday–Friday**, matching the existing weekly attendance evaluation. All day/week boundaries and displayed times use Asia/Manila, including when the office user is abroad.

Use the latest server definitions of `attendance_week_days()` and the configured grace hours. Migration 0078 replaced the earlier classification with trusted-time and verification rules. Do not implement from 0066 alone.

Capture each day's required/pending/verification classification in the finalized report. The shared helper reads mutable site settings; calling it on different dates does not guarantee identical historical results. A report must retain the calendar evaluation it actually captured. If an existing frozen bonus has a different required-day count, show a calendar-review explanation without importing its monetary or qualification data.

Saturday/Sunday reporting requires a separately reviewed calendar change. It must not alter bonus eligibility merely to expand employee reporting.

### 5.2 Recorded hours

- Only saved server-computed durations count toward recorded hours.
- Missing Time Out and Closed by admin have unknown hours, shown as `—`.
- Distinguish days with Time In, days with recorded durations, missing Time Outs, admin-closed days and verification concerns.
- Future days are pending, not missing. Not-required days do not count as missing required attendance.
- A worker with no recorded durations shows **No hours recorded**, not a claim that they worked zero hours.
- Label a partial total as **Recorded hours** and display the incomplete-day count alongside it.

For example: **4 days recorded · 3 days with recorded hours · 1 missing Time Out**. This is not a full-hours or full-attendance claim.

### 5.3 General duties

General duties describe standing responsibilities for a job position. They do not create assignments, establish completion or change Work Plan tasks.

The setup lists positions actually in use. Match trimmed, case-insensitive position text within the company, but do not automatically merge similar labels. Account role and job position are different fields; the report's grouping/filter label is **Position**.

Owner and staff with Attendance access may maintain duties. Changes record the office actor and server timestamp. Deactivate duty definitions rather than deleting definitions referenced by finalized reports.

Save the selected duties and their definition/version timestamp into the final report. Label them as captured at finalization; do not claim an older duty version was recovered when no historical source exists.

## 6. Finalization, roster and archive integrity

### 6.1 Recommended finalization baseline

Use a server-controlled scheduled process to finalize each due week after the configured grace period. The default 60 hours after Saturday 00:00 Manila means Monday noon. Display the configured due time, not a hardcoded promise.

The scheduled process and an authorized office retry must call the same generation logic. The office must see a failed or pending generation state and have a clear retry action. Scheduler setup and its authorization belong in the later implementation plan.

If page-load generation is selected instead, revise these terms before implementation: explain that nobody opening the page delays finalization. Do not advertise it as an unattended weekly schedule.

### 6.2 What a final report means

A final report is an immutable snapshot of available source information **when finalization actually succeeds**. It is not a promise that every field has been reconstructed as of Friday.

Store and show reporting dates, expected finalization time, actual generation time and data capture time. Record the grace/configuration values used. If generation is delayed, label it and disclose that it includes information available at the later capture time.

Capture the week in one consistent database transaction. Preserve roster and employee snapshots together. A generation failure must leave no partially finalized week.

After finalization, do not append new employees, replace existing reports or recalculate saved values on page load. A unique worker/week constraint alone is insufficient: preserve a week-level finalization record and its roster, with consistent company ownership.

### 6.3 Employee eligibility

The roster must represent workers/team leaders eligible during the reporting week, including those with no attendance. Do not substitute today's active roster when finalizing an older week.

From feature launch, retain effective reporting eligibility dates, including deactivation/reactivation and relevant role changes. Initially active workers begin tracking at launch unless the office deliberately supplies an earlier effective reporting date. Account creation time is not automatically a hire date.

Include people deactivated after participating in the week. Exclude people whose eligibility started afterward. For midweek eligibility, only applicable required days count toward expected attendance.

Pre-launch attendance can support a separate, clearly labelled historical backfill, but it cannot establish the complete roster of people expected to attend. **Full pre-launch backfill is outside this MVP.** The archive must explain its coverage start; it must not invent historical eligibility or historical duties.

### 6.4 Changes after finalization

Attendance received before actual finalization is included. Attendance arriving afterward, including an offline record or an admin closure, does not silently rewrite the report.

Retain enough source record identity and capture information to detect relevant later additions/changes. Show the difference and provide **View latest attendance**. This opens current source information; it does not change the final report or introduce report editing.

Finalization retries and simultaneous office/scheduler calls must produce one consistent week. Bound catch-up work, disclose missed weeks and permit controlled retry; do not silently treat an arbitrary recent-week limit as complete archive coverage.

## 7. Photographs, retention and access

Use paths in the existing private `attendance` bucket. Sign them when viewing/printing; do not save public or signed URLs in report rows or CSV.

Current phone uploads use overwrite-capable retries, and migration 0083 permits workers to replace their own photographs. Storing a path or object `updated_at` alone does not preserve original image contents.

**Required before rollout:** protect photographs referenced by final reports from replacement/deletion through ordinary worker operations. Coordinate the change with both supported attendance upload clients and test retries against existing objects. A guard must not strand legitimate queued attendance submissions or cause a report to reference a failed upload.

Do not copy photographs into a new bucket for this MVP. If preserving the original objects cannot be made compatible with supported clients, record the concrete incompatibility and revise the design before shipping an evidence-preserving archive.

The proposed baseline introduces no automatic photo deletion. Retention duration and any later disposal process require an explicit company decision before promising a retention horizon. Existing cleanup outside the inspected repositories must be checked. Never promise permanent evidence from saved paths alone.

Owner and authorized staff read reports and supporting photographs. Workers/team leaders do not read office weekly reports or another employee's report evidence. Their existing access to their own attendance history and photographs remains available.

Client and partner portals do not receive this module. Enforce access on the server as well as in navigation. New privileged functions check an authenticated active office account, company access and valid parameters, with narrow execution grants and a controlled search path. Frozen report tables have office read access and no direct ordinary-client write policy.

## 8. Print, CSV and business boundaries

### Print / Save as PDF

Use the DAC's logo, report title, employee identity, reporting dates, Live/Final label, finalization information and page numbering. Keep day sections/photos readable across A4 pages; do not squeeze ten photographs onto one page.

Load/sign the selected report's photographs before printing. Wait for image loading or decoding to finish; show missing-photo states explicitly. A long-open screen must obtain usable links at print time.

The MVP uses browser **Print / Save as PDF**. A direct one-click PDF file generator is separate scope. Print a provisional report only with a visible Not final label.

### CSV

Export finalized data from the same saved report used by the screen and print output. Include employee identity, reporting dates, daily sites/events, recorded minutes, relevant statuses and generation information. Preserve unknown durations as blank/unknown, not zero. Exclude photographs, signed links, precise location coordinates and all financial data.

Escape CSV fields and prevent spreadsheet formula execution from employee-entered names/notes. Use UTF-8 suitable for Filipino names. Make the export's filtered scope clear in its label and output.

### Isolation

No report action creates or changes payroll, expenses, bonuses, contracts, invoices, payments, quotations, reimbursement or warranty records. Reports do not enter Spent, Earned, Profit, allocation envelopes or BOQ accomplishment percentages. No peso amount or rate appears for any audience.

Project references retain their system discriminator: `folders` and `construction_projects` are separate identifier spaces. `projects` remains a billing-period table, not the employee report's project catalogue.

## 9. Later Work Plan connection

My Work server support and the office Work Plan already exist in migrations 0093/0094. Do not recreate task assignment data or describe My Work as entirely absent.

Task reporting is deferred from this release. The implementation may reserve a versioned optional task snapshot structure, but it must not populate old final reports later. Hide the task section until reporting is enabled; avoid a permanent empty "Coming with My work" block in printed reports.

A later design must define planned tasks, carryover tasks, weekly activity, employee responsibility/helper membership and status timing. **Reported done**, **Leader checked** and **Approved complete** remain distinct. Current task rows and change descriptions are not automatically a complete historical task reconstruction.

Future task snapshots must retain task identity/version, assignment role, project/Main Contract/Additional Works identity, relevant dates, displayed status and capture time. Older reports without task snapshots remain readable.

## 10. Repository integration and implementation conditions

| Surface | Required coverage |
|---|---|
| Report module | A focused `js/attendance-weekly-report.js` or equivalent, with shared live/final rendering and testable helpers. |
| Existing Attendance module | A deliberate interface for needed private helpers, photo signing and detail links; no uncontrolled duplication. |
| Navigation | `PRIMARY_NAV`, permitted detail views in `_FOCUS_SUBVIEWS`, role filtering, `ATT_VIEWS`, title maps, `switchView()` initialization, markup and script loading. |
| Styling | Reuse Attendance styles; scoped additions only. |
| Database | New real tables/columns, constraints, indexes, office read policies, protected generation writes, reporting eligibility and photo protections. |
| Supabase shim | Register new collections only if shim access is used; RPC/direct `sbClient` access does not automatically require a new shim collection. |
| Output | Employee print, finalized CSV and shared print rules where necessary. |
| Documentation | Architecture module map, database schema and migration README. |
| Verification | Behaviour tests, SQL acceptance checks, supported phone retry checks and complete office browser checks. |

Search every affected save, render, print and export path before implementation. Recheck current migrations and live columns before creating new fields. The next number at document creation is **0096**, because 0095 is highest on disk; reserve nothing by this statement.

Never run `npm run build`. Do not edit applied migrations or use unrecorded SQL-editor schema changes. No client/partner HTML change is planned; if scope later touches shared portal markup, mirror both live portal files.

This document does not select a delegation method, authorize code changes or establish a deployment procedure. Prepare the implementation plan after these terms are reviewed.

## 11. Acceptance and completion evidence

- [ ] Owner and permitted staff can open overview, employee detail, Archive and duty setup; an Attendance-restricted account can use permitted detail views.
- [ ] Worker, team leader, client, partner, inactive office and unrelated-company access are refused where appropriate, including direct function calls.
- [ ] A live/current or grace-period report is visibly provisional; future days are pending.
- [ ] The due time follows company configuration and Manila time, including with the browser set to another timezone.
- [ ] Finalization is refused before the due time and happens unattended under the proposed schedule.
- [ ] Eligible employees with no records appear; deactivation, reactivation, role changes, midweek starts and later hires produce the correct roster/days.
- [ ] Reopening or retrying a final week changes neither its saved roster nor reports; concurrent calls cannot partly finalize or duplicate it.
- [ ] Delayed/failed generation is visible and retryable; archive coverage begins at the documented launch date.
- [ ] A Friday offline record arriving before actual finalization is included; later attendance changes produce a visible difference without altering the saved report.
- [ ] Not-required, missing, open, admin-closed and unverified records remain distinguishable. Unknown hours remain unknown.
- [ ] Worker renaming, position/duty changes, project renaming and calendar edits do not silently alter a finalized report.
- [ ] General duties never imply completed work; missing duties have an explicit state.
- [ ] Header photos do not change to a newer photo when reopening an archive.
- [ ] Protected photos cannot be overwritten through worker operations after finalization; supported app retries still recover correctly.
- [ ] Workers retain their own attendance-photo access but cannot read another employee's report evidence.
- [ ] A 20-worker week opens without loading all 200 daily photographs. Missing/expired-photo and network failures have clear states.
- [ ] Filters survive returning from detail. Desktop/mobile, keyboard use and status readability are checked.
- [ ] Print and CSV agree with the selected saved report; print waits for photographs and handles page breaks without clipping.
- [ ] CSV preserves unknown durations, handles commas/quotes/newlines and formula-like text, and contains no photos, signed URLs or money.
- [ ] Attendance, Hours report, Weekly bonus, Workers, Sites & schedule, Requests and Work Plan retain their existing behaviour.
- [ ] Full `npm test` and applicable JavaScript syntax checks pass after implementation; no build command is run.

Completion requires the implemented features, applicable database/storage checks, supported phone retry checks and final owner/staff browser workflow to pass in the intended environment. Source-text tests alone do not establish database permissions or photo preservation.

Maintain a verification record with environment, date, actual results, failures/fixes, scheduler evidence, test-data cleanup and checks not performed. Use controlled fixtures and self-rolling-back SQL checks where possible. Do not report production readiness, successful rollout or deferred task integration without evidence.

## 12. Review decisions before the implementation plan

| Decision | Recommended baseline for review |
|---|---|
| Week coverage | Monday–Friday for workers and team leaders; applicable eligibility days only. |
| Automation | Scheduled server finalization after configured grace, with visible failure and office retry. |
| Snapshot meaning | Information available at successful finalization, with expected/actual times and delayed-generation disclosure. |
| Archive launch | Track eligibility from launch; full pre-launch backfill excluded. |
| General duties authority | Owner and staff with Attendance access maintain duties, with an audit trail. |
| Photo policy | Protect final-report references while preserving supported upload retries; introduce no automatic deletion. Company retention duration remains a separate policy decision. |
| Output | Browser Print / Save as PDF and finalized CSV. |
| Tasks | Integrate existing Work Plan in a later reviewed release; do not update old final reports. |

Review these terms as one coherent MVP baseline. Changes to these choices must be reflected in scope, UI wording, data rules and acceptance checks before implementation planning.

## References

- [System architecture](../../ARCHITECTURE.md)
- [Database schema](../../DATABASE_SCHEMA.md)
- [Migration order and rules](../../../supabase/migrations/README.md)
- [Attendance administration](../../../js/attendance-admin.js)
- [Attendance visual styles](../../../css/attendance-admin.css)
- [Trusted-time and weekly classification](../../../supabase/migrations/0078_attendance_trusted_time.sql)
- [Attendance photo replacement policy](../../../supabase/migrations/0083_attendance_photo_replace_policy.sql)
- [My Work server](../../../supabase/migrations/0093_workmate_my_work.sql)
- [Work Plan office server](../../../supabase/migrations/0094_workmate_work_plan_office.sql)
- [Work Plan office verification record](2026-10-13-workmate-stage1c2-verification-record.md)
