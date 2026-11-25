# DAC's Weekly Employee Attendance and Work Report - MVP Terms

Original document: 9 October 2026  
Revised: 22 November 2026 (Asia/Manila)  
Status: Updated draft for implementation planning, with the owner decisions of 22 Nov 2026 recorded below. The reporting module and archive remain to be implemented.  
Replaces: the 14 Oct 2026 draft, [2026-10-14-weekly-employee-report-mvp-terms.md](2026-10-14-weekly-employee-report-mvp-terms.md). Where the two differ (week days, finalization trigger, work photos, project view), this version applies.

## Owner decisions, 22 Nov 2026

| Topic | Decision |
|---|---|
| Old DACS Attendance app | **Not in use** (owner). Its last record in the live database is 21 Oct 2026. It may still be installed on some phones. |
| Photo integrity | **Photo check code + photo lock** (§8). The archive says "changes detected", never "protected" or "immutable". |
| Timing | **Build now**, before the crew records attendance in WorkMate. The live database has no real attendance in November 2026, so checks use test accounts until real Time Outs exist. |
| Finalization grace | Not yet reviewed; keeps the proposed 12 hours (Monday noon). Trade-off: a Sunday Time Out that reaches the server after Monday noon misses the final report and shows the "changed after finalization" notice. |
| Project report (23 Nov 2026) | **The per-project report matters most.** Its reader is the **office** (keep worker names, numbers and source lines). Its print follows the owner's manual **De Leon Residence Nov 20 report** layout: header band, summary tiles, a "Work done" list with photo numbers, and a numbered photo grid three across. The automatic report still writes no task titles, percentages or design comparisons (§11): each work line is the worker's own Time Out note. |
| Projects list (23 Nov 2026) | **Every active project is listed**, even with no Time Outs that week ("No work submitted this week"). Active = every Attendance site that is **not completed**, **including sites hidden from workers**, which are tagged "Hidden from workers" (on 23 Nov 2026 De Leon Residence was hidden, so no Time Out can reach it until it is shown). A completed project appears only in a week where it has work. Weekly reports **opens on Projects**. |
| Project print banner (23 Nov 2026) | The project report prints **no "Not final" banner** (owner's request). Its header band still says when it was assembled ("Assembled <date, time>"). This overrides §9's "A live print must clearly say Not final" for the **project** report only; the employee print keeps its banner. |

### Before reports have real content

Each step below is its own approval:

1. Migration 0119 applied live. The report reads `timeout_extra_photo_paths`; without that column its read fails. **Done:** live, checked 23 Nov 2026.
2. WorkMate 1030 published. **Done:** published 22 Nov 2026 (`app_releases`, checked 23 Nov 2026).
3. The crew records attendance in WorkMate instead of Messenger. Not yet: no work-photo Time Out had been recorded as of 23 Nov 2026.

### Proposed build order

The implementation plan confirms or changes this order.

1. **Live reports:** weekly overview, employee detail, project view, live print marked **Not final**, general duties, and **eligibility history recorded from this first release**, so the archive has history when it ships.
2. **Finalization and archive:** saved weeks, photo check codes, archive search, final print and CSV.
3. **Photo lock** (§8): the WorkMate change first; then raising the minimum WorkMate version, blocking the old Attendance app and removing the overwrite permission, each live step with its own approval.

## 1. Purpose

Automatically assemble each employee's weekly attendance and work report from the information workers already submit through WorkMate.

Workers submit once during Time Out. Dacs Web reuses their project selection, explanation and work photographs. The office can review an employee's week or view the same work entries grouped by project and day, then print a report and retrieve finalized weeks from an archive.

The manual De Leon Residence progress report is the content reference: project, report date, work reported and supporting photographs. Employee reports additionally show identity and attendance.

Success means less manual copying of photographs and notes, clear source attribution, useful missing-record indicators and a reliable archive.

## 2. Existing WorkMate workflow to reuse

Checked against the local WorkMate source, version **0.19.0+1030**, and Dacs Web's matching Time Out changes. Source presence does not establish live database rollout or the version installed on workers' phones.

| Stage | Current behaviour |
|---|---|
| Time In | Existing attendance flow: select a project, take a face photograph, review it and optionally add a note. |
| Time Out - project | Worker selects the project for the Time Out submission. This can differ from the Time In project. |
| Time Out - photographs | Worker takes **3-6 work photographs** with the camera. The back camera opens by default; camera switching remains available. Photographs can be opened or deleted before submission. |
| Time Out - explanation | Worker answers **What did you do today?** At least **15 characters after trimming whitespace** are required. Time Out has no quick-tap trade chips. |
| Time Out - submission | The selected project, explanation and photograph set travel together. The Time Out timestamp is the last retained work photograph's capture time. Each photograph is prepared with its own capture-time caption. |
| Offline | The phone retains the submission and its photographs for retry. The office receives it after successful synchronization; upload time does not replace capture time. |
| Office viewing | The Attendance detail already reads the explanation, first Time Out photograph and additional work photographs. |

Time Out has three input steps: project, work photographs and explanation. Its confirmation screen follows submission.

The new photo/note rule is enforced by the updated WorkMate flow. Server validation checks work-photo submissions when additional-photo arguments are present. Older clients and Time Outs queued before the update remain compatible; they may contain only one Time Out photograph and an optional note.

Status on 23 Nov 2026: 0119 is live and 1030 was published on 22 Nov 2026, but no work-photo Time Out has been recorded yet, so every Time Out on record is the older kind. The old DACS Attendance app has not been used since 21 Oct 2026.

Each work photograph's own capture time is printed on the picture only. The database stores the photo paths and one Time Out time (the last photograph's), not a time per photograph. Reports and CSV therefore show per-photo times only through the picture itself.

## 3. MVP scope and operating defaults

| Included | Required behaviour |
|---|---|
| Weekly employee overview | Week selector; search by name/worker number; position, project and Needs review filters; compact employee summaries. |
| Employee report | Identity, recorded attendance, standing duties where configured, daily work explanations and supporting work photographs. |
| Project progress view | Group the same accepted Time Out entries by selected Time Out project and day, for a chosen day or reporting week. This is another report view, not a new Project Management module. |
| Automatic assembly | Read accepted attendance submissions and arrange their existing notes/photos. No second worker form, manual photo transfer, AI summary or mandatory foreman approval is required. |
| Live and finalized states | Live reports use current accepted data. Final reports use a saved snapshot and fixed roster. |
| Archive | Finalized reporting weeks, employee/project search, capture information and read-only reports. |
| General duties | Office-managed standing duties per position, shown separately from actual daily work. |
| Output | Company-branded A4 Print / Save as PDF and finalized CSV from the same report data. |

**Proposed document defaults:** the reporting week is **Monday-Sunday**, covering weekend submissions. Report finalization becomes eligible **12 hours after the week ends**: Monday noon Manila under the default. These are reporting settings, independent of the existing Monday-Friday bonus calendar and its 60-hour grace period. The implementation must display the reporting calendar and actual configured due time.

This MVP automatically assembles reports when an authorized office user opens or refreshes the report screen. Once a week is due, that action also requests server finalization. A genuinely unattended scheduler is a later enhancement. If nobody opens the screen, finalization waits; the interface must not promise an unattended scheduled report.

## 4. Source mapping and daily entry rules

| Report information | Authoritative source |
|---|---|
| Employee | Attendance record's worker identity and saved name/position; worker number captured for the report. |
| Reporting day | Attendance record's work date, using Asia/Manila. A Time Out after midnight belongs to its Time In's work date: the server closes the previous day's open record. Preserve actual event timestamps separately. |
| Work project | Time Out project system, project ID and saved project name. |
| Work reported | `timeout_description`, preserving the worker's wording and line breaks. |
| Work photographs | `timeout_photo_path` **followed by every path in** `timeout_extra_photo_paths`, in stored order. |
| Attendance evidence | Time In photograph, Time In/Out timestamps, saved status and available verification information. |
| Recorded hours | Saved server-computed `total_minutes`; never a second browser calculation. |
| Source trace | Attendance record ID, Time Out event ID where present, relevant source values and report capture time. |

The first work photograph remains in the original Time Out photo field. Reading only the additional-photo list or only the original field produces an incomplete report.

### Work reporting

- A daily entry keeps one submission's worker, explanation, selected project and photographs together.
- Use the heading **Work reported**. An explanation/photo set records what the worker reported; it does not establish supervisor approval or BOQ completion.
- The current workflow stores one explanation for the whole photo set. Display that explanation with the set; do not invent separate task titles, quantities or photo-to-task matches.
- General duties describe standing responsibilities. They are not evidence that an activity was performed.
- If several workers describe the same activity, retain their attribution. Counts mean **submissions** and **contributors**, not a verified number of distinct completed tasks.
- Missing notes or unavailable photographs have visible states. Do not silently substitute another employee's evidence.

### Project grouping

Use the **Time Out** project's system and ID for work entries. Keep Time In project details separate when they differ. A project name alone is not a unique key.

For this MVP, show recorded hours in the employee report. Do not produce project-hour allocations from a day whose Time In and Time Out project differ: the submission does not say how the day's time was split.

Project contributor counts mean workers with recorded work submissions in the selected scope. They are not a verified site manpower headcount.

### Legacy records

Older single-photo Time Outs may contain a face photograph. Label them **Legacy Time Out photo - purpose not recorded**, rather than presenting them as confirmed work photographs.

Do not flag a valid older submission as an invalid attendance record because it lacks the new photo count or note length. App version alone cannot distinguish old queued submissions sent after an update. Use the stored submission fields and show evidence limitations.

## 5. Attendance, calendar and identity

All reporting dates, week boundaries and displayed times use **Asia/Manila**, including for an office user abroad.

- Include every accepted record within the selected reporting period, including Saturday/Sunday submissions.
- Distinguish days with attendance, completed Time Outs, missing Time Outs, admin-closed records and verification concerns.
- A future day is **Pending**. A past day without a record is **No attendance recorded**.
- Show **Not a required day** only when a reliable applicable schedule supports that classification.
- Do not label a missing record an unauthorized absence. Show an expected-attendance denominator only where historical eligibility and schedule information support it.
- Missing Time Out and admin-closed records have unknown duration, displayed as `-`. An employee without known durations shows **No hours recorded**.
- Partial totals read **Recorded hours**, with incomplete records shown alongside them.
- Never change the existing bonus evaluation or eligibility to make its Monday-Friday helper cover a seven-day employee report.

The roster covers workers and team leaders eligible during the reporting week, including eligible people with no attendance. Retain effective reporting eligibility from feature launch, including deactivation/reactivation and role changes. Today's active roster cannot reconstruct an older week.

Include an employee deactivated after participating in the week; exclude a later hire whose eligibility began afterward. Initially active employees start reporting eligibility at launch unless the office supplies an earlier effective date. Account creation time is not a hire date.

Full pre-launch roster backfill is outside this release. Existing older attendance may be viewed as historical source data with coverage limitations, without claiming a complete historical roster.

Use a Time In photo from the reported week for the employee header where available; otherwise use initials. Save the selected header-photo reference at finalization. Never use a newer Time Out work photo as an employee portrait.

**Correct example:** three saved durations of 9h 38m, 9h 31m and 9h 25m total **28h 34m**. A fourth day with a missing Time Out adds a recorded day, but no invented hours.

## 6. Screens and responsibilities

Use **Attendance > Weekly reports** in Dacs Web.

| Screen/action | Contents |
|---|---|
| This week | Employee list, live status, recorded-day/hour summaries and review indicators. |
| Employee detail | Identity; weekly summary; general duties; daily attendance; Work reported; all associated work photos; capture/finalization information. |
| Project view | Selected project/date range, contributors, attributed work entries and their photo sets. |
| Archive | Final weeks newest first, with employee/project search and saved report detail. |
| Manage general duties | Positions actually in use; duty text; active/inactive state; office actor and update time. |

Owner and active staff with Attendance access may read reports and maintain duties. Workers and team leaders submit through their existing WorkMate flow and retain their own attendance history; office weekly reports are not added to their app in this release.

A foreman/team-lead approval stage is not part of this MVP. Office inspection of evidence is available without creating a new worker submission or task-completion approval workflow.

Reuse the current Attendance styles, responsive cards and office pop-up pattern. Keep lists compact; open detailed notes/photos only when requested. Preserve filters when returning from detail. Provide clear loading, empty, error and retry states; color always has a text label.

## 7. Finalization and archive

### Lifecycle

| State | Meaning |
|---|---|
| Still updating | Current report assembled from accepted source records. |
| Waiting for finalization | Week has ended but the reporting grace period has not elapsed. |
| Ready to finalize | Due week awaits an authorized office page request. |
| Final report | Week and its employee reports were saved successfully together. |
| Finalization failed | No partial final week; office can retry. |
| Attendance changed after finalization | Saved report is intact; relevant later source data differs. |

Finalization runs on the server and refuses requests before the report's due time. Save the week and eligible roster in one consistent transaction. Concurrent/repeated calls must return the same finalized week without duplication, replacement or appending new employees.

Store reporting dates, calendar/configuration used, expected finalization time, actual generation time and data capture time. Mark delayed finalization clearly. A final report captures information available when generation actually succeeds; it does not promise reconstruction of every value as it stood on Sunday.

Attendance received before actual finalization is included. Data still only on a phone cannot be included. Later offline arrivals, admin closures or source edits do not silently rewrite the archive. Detect relevant later changes, show **Attendance changed after this report was finalized**, and offer **View latest attendance**.

Save employee/project names, position, selected general duties and their definition timestamp, attendance values, explanations, ordered photo references and source identities. Duties read **Captured at finalization**, rather than claiming historical duty versions that do not exist.

Archive project views and exports must derive from those same saved entries. A project view must not reread current notes/photos and present them as the final report.

Corrections to finalized reports require a separate future revision workflow. Reopening, refreshing or changing filters never edits saved content.

## 8. Photograph integrity and access

Keep photographs in the existing private `attendance` bucket. Reports store paths, never public or signed URLs. Obtain authorized short-lived links when viewing or printing.

Finalization must preserve the original photographs referenced by the report. Current upload retries can overwrite an existing path; a saved path or storage timestamp alone does not preserve image contents.

**Decided approach (owner, 22 Nov 2026): photo check code + photo lock.**

**Photo check code (ships with finalization).** For every file, storage already keeps a content code (`eTag`) that changes when the picture changes, plus its size and last-changed time. When a week is finalized, save the content code and size of every referenced photo with the report: the first photo, every extra photo and the header photo. When a final report is viewed, printed or exported:

| Found | Shown |
|---|---|
| Same content code and size | The photo |
| Different content code or size | **Photo changed after this report was finalized** |
| No file | **Photo unavailable** |

Compare the content code and size, **never the last-changed time**. A phone that lost the server's answer re-uploads the identical file, which changes the time but not the content. The implementation plan must test that an identical re-upload keeps the same content code. The check detects a change; it does not restore the original. Wording says "changes detected", never "protected" or "immutable".

**Photo lock (follow-on).** Stops a worker overwriting an uploaded photo at all:

1. WorkMate treats "file already exists" as a successful upload instead of overwriting. This is safe because a retry sends the identical prepared file: the caption is burned in and the photo compressed before the submission is queued.
2. Raise the minimum WorkMate version, so older WorkMate copies (which overwrite) update first.
3. Block the old Attendance app (unused since 21 Oct 2026). Blocking it once locked the crew out (26 Sep – 2 Oct 2026), so this step needs its own approval and notice to the crew.
4. A new migration removes the worker overwrite permission (0083's "attendance: worker replaces own photo").

The lock does not stop deletions or replacements made with dashboard or service access. The photo check code still catches those.

**Finalization/upload race.** WorkMate uploads every photo before it records the Time Out, so an accepted record never points at a photo that has not arrived. Finalization reads accepted records only.

Do not introduce a second archive bucket.

This release introduces no automatic photograph deletion. Retention duration and any later disposal process require a company policy decision. Missing evidence always shows **Photo unavailable**, with retry where useful.

Enforce active office/company/module access on the server and in navigation. Workers retain access to their own existing attendance evidence, not another employee's report evidence. Client/partner portals receive no report access.

Load photos on employee/day detail, with bounded requests. A weekly overview must not preload every full-size photo from every worker.

## 9. Print and CSV

### Print / Save as PDF

Use DAC's branding, clear employee/project identity, report dates, live/final status, work entries, readable photographs and accurate page numbering.

Employee output includes attendance and work evidence. Project output follows the manual report's project/date/work/photos structure, with worker attribution added. Preserve the original notes and source context.

Include all associated work photographs across as many A4 pages as needed. Keep captions readable; do not squeeze the entire week onto one page. Obtain usable photo links and wait for image loading/decoding before opening print. Show unavailable-photo placeholders explicitly.

Browser **Print / Save as PDF** is included. Direct one-click PDF generation is later scope. A live print must clearly say **Not final**.

### CSV

Export finalized entries from the same saved report used on screen and in print. Include scope, worker identity, date, project, original explanation, attendance times, known minutes, relevant statuses, photo count and capture information.

Exclude photographs, photo paths, signed links, precise coordinates and all financial data. Unknown durations remain blank/unknown. Support Filipino names, commas, quotes and newlines; prevent spreadsheet formula execution from entered text. State whether filters limit the export.

## 10. Implementation alignment

The following are implementation requirements, not migration SQL or already-created tables.

| Area | Required work |
|---|---|
| Data | Company reporting settings/eligibility history, position duties, week-level finalization record and employee snapshots with source traces. |
| Constraints | Unique company/reporting-week header; unique worker within the saved week; consistent company ownership and protected generation writes. |
| Reads | One shared report-data contract for live/final employee views, project grouping, print and CSV. |
| Writes | Validated server generation/retry; audited office duty and eligibility maintenance; no direct ordinary-client archive writes. |
| Navigation | Existing Attendance routes, `PRIMARY_NAV`, `_FOCUS_SUBVIEWS`, role filters, `ATT_VIEWS`, title/view initialization, markup and script loading. |
| Frame | Reuse current Attendance styles and office pop-up behaviour. |
| Photos | Reuse signing/detail capabilities deliberately; test preservation with phone synchronization and storage rules. |
| Documentation | Architecture module map, database schema and canonical migration README when implementation changes them. |

Before implementation, trace all save/read/render/print/export paths. Inspect current live columns and migrations; every new field needs a real database column. Choose the next migration number then. **This document reserves no migration number.** At the time of writing the next free number is 0120: 0117–0119 are local work not yet applied.

The Supabase shim maps camelCase fields to snake_case columns. Register new collections only where shim access requires it. Preserve project-system discriminators: `folders.id` differs from `construction_projects.id`; `projects` means billing periods.

My Work/office Work Plan already exist. This MVP reads actual daily work from Time Out without depending on task integration. A later release may add versioned task snapshots, but cannot populate or silently change old final reports.

Never run `npm run build`. Keep applied migrations unchanged. No client/partner portal HTML changes are planned.

## 11. Boundaries

- No wage, rate, bonus amount, payroll/payment status or peso figure.
- No change to payroll, bonus evaluation, purchasing, expenses, invoices, contracts or accounting.
- No contribution to Spent, Earned, Profit, allocation envelopes or BOQ completion.
- No automatic completion percentages, productivity scores, inferred quantities or AI summaries.
- No duplicate WorkMate reporting form, gallery-upload workflow or mandatory new approval stage.
- No employee-facing weekly report, separate profile-photo upload, email/push delivery or unattended scheduler.
- No finalized-report editor, full historical roster reconstruction or new Project Management functionality.

## 12. Acceptance checklist

- [ ] A current WorkMate Time Out supplies its worker, project, explanation and all 3-6 work photographs to the report without re-entry.
- [ ] The first photograph and every additional photograph appear once, in order, with the original explanation.
- [ ] Old single-photo/queued submissions render with honest legacy evidence labels and keep existing attendance behaviour.
- [ ] Offline evidence appears only after server acceptance and remains associated with the original work date/capture times.
- [ ] Time In and Time Out projects remain distinct; work entries group by Time Out system/ID, not by name alone.
- [ ] Saturday/Sunday records appear in the report; bonus calendar/evaluation remain unchanged.
- [ ] Employee totals use saved minutes, preserve unknown hours and show incomplete records.
- [ ] Eligible employees with no records appear; deactivation, role changes and later hires produce the correct weekly roster.
- [ ] Overview, employee detail, project view and archive respect active office/company/module access.
- [ ] No worker, leader, client or partner gains office-report access; workers retain their own history/photo access.
- [ ] Reporting due time follows its own saved calendar/grace settings and Manila time.
- [ ] Early finalization is refused; simultaneous calls finalize one whole week, with no partial roster or duplicates.
- [ ] Reopening a final week changes neither its roster, wording, totals nor saved project/employee details.
- [ ] Later source changes show a visible notice and latest-attendance link without altering final data.
- [ ] Final reports save a photo check code for every referenced photo. A changed photo shows **Photo changed after this report was finalized**, a missing one **Photo unavailable**, and an identical retry upload raises no false notice.
- [ ] After the photo lock, a worker cannot overwrite an uploaded photo, and WorkMate retries (including after a lost server response) still record once.
- [ ] Header portraits use appropriate Time In evidence or initials.
- [ ] Missing photo/note, loading, network failure and empty states are distinct; overview photo requests stay bounded.
- [ ] Print and CSV agree with selected final data; print waits for photos, spans pages cleanly and numbers them correctly.
- [ ] CSV preserves unknowns, supports entered text safely and excludes financial/location/photo-link data.
- [ ] Current Attendance, Requests, Work Plan, Hours report and Weekly bonus retain their behaviour.
- [ ] Applicable tests, JavaScript syntax checks, database/storage checks, phone retry checks and owner/staff browser workflows pass.

Completion evidence must identify environment, date, actual results and checks not performed. Local source review alone does not establish successful deployment or photo preservation.

## 13. Source references

- Original submitted plan: `2026-10-09-weekly-employee-report-mvp.md`.
- Manual content reference: `De_Leon_Residence_Progress_Report_Nov20-2026.pdf`.
- Replaced draft (kept for history): `docs/superpowers/specs/2026-10-14-weekly-employee-report-mvp-terms.md`.
- Current Time Out design: `docs/superpowers/specs/2026-11-22-workmate-timeout-work-photos-design.md`.
- Dacs Web: `docs/ARCHITECTURE.md`, `js/attendance-admin.js`, migrations `0078`, `0083`, `0093/0094` and local `0119_attendance_timeout_work_photos.sql`.
- WorkMate: `pubspec.yaml`, `lib/attendance/domain/work_photos.dart`, `flow/time_flow_controller.dart`, `flow/time_flow_screen.dart`, `flow/camera_step.dart`, `data/attendance_repository.dart`, `data/attendance_remote.dart`, `sync/submission_sync.dart` and `domain/attendance_record.dart` under `lib/attendance/`.

