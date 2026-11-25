# Weekly Reports, Part 1 (live reports, general duties, roster history) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **Attendance → Weekly reports** to the office, assembling each employee's week and each project's work entries live from accepted attendance records, with general duties per position, A4 print marked **Not final**, and roster history recorded from this release.

**Architecture:** One migration (0120) adds a roster-history table filled by a trigger on `profiles`, a position-duties table, and three office RPCs (`att_week_report`, `att_duty_list`, `att_duty_save`) that enforce company and Attendance-module access on the server. The browser gets one pure report engine (`js/weekly-report-data.js`) that turns the RPC payload into employee and project views. The same engine output feeds the screen and the print builder (`js/weekly-report-print.js`), so Part 2's final snapshot can feed the same engine. The screen (`js/weekly-report-admin.js`) uses the Office v5 frame (`window.SplitView`): cards plus a pop-up.

**Tech Stack:** Plain HTML + vanilla JS (no build step), Supabase Postgres (plpgsql RPCs, RLS), PGlite tests (`npm run test:sql`), zero-dependency Node tests (`npm test`).

**Spec:** [docs/superpowers/specs/2026-11-22-weekly-employee-report-mvp-terms.md](../specs/2026-11-22-weekly-employee-report-mvp-terms.md). This plan builds **Part 1** of its "Proposed build order". Part 2 (finalization, archive, photo check codes, CSV) and Part 3 (photo lock) get their own plans.

## Global Constraints

- All reporting dates, week boundaries and displayed times use **Asia/Manila**, including when the office browser is set to another timezone. Never `toISOString().slice(0,10)` for a date key (CLAUDE.md).
- The reporting week is **Monday–Sunday**. Saturday and Sunday records are included. The bonus calendar (`attendance_week_days`, `attendance_evaluate_week`) is not touched.
- "No wage, rate, bonus amount, payroll/payment status or peso figure" (spec §11). Nothing reads `attendance_weekly_rewards`.
- Read-only toward attendance. Nothing writes `attendance_records`, the `attendance` storage bucket, payroll, bonus or any money table. The only write is `att_duty_save`; roster history is written by its trigger.
- "Reports store paths, never public or signed URLs" (spec §8). Signed links are made only when an employee/project pop-up or a print is opened, through the `attendance` bucket, short-lived (3600 s). The overview loads no photo.
- Access: owner and **active** staff of the company, whose `allowed_modules` is null, empty or contains `attendance`. Enforced in every RPC and in navigation. Workers, team leaders, clients and partners get nothing. No change to `Client Management.html` or `Dacs Partnership.html`.
- Copy the spec fixes, verbatim: heading **Work reported**; **Legacy Time Out photo - purpose not recorded**; **Pending**; **No attendance recorded**; **No hours recorded**; **Recorded hours**; **Photo unavailable**; **Not final**. General duties are shown apart from actual work and never as proof of work. A missing record is never called an absence.
- Hours come from saved `total_minutes` only; unknown is `—`.
- Counts are **submissions** and **contributors**, never tasks or headcount.
- Work entries group by the **Time Out** project's system + id, never by name alone. No project-hour allocation.
- Migration number **0120**. Applied migrations stay unchanged. Applying 0120 live is a separate approval by the user. Never run `npm run build`.
- **No commits.** The user commits by hand. Each task ends with a checkpoint instead.
- Part 1 has **no** finalization, archive, CSV, photo check code, photo lock, or office-entered earlier roster start dates (spec §5's "unless the office supplies an earlier effective date"). Those all come in Part 2 or 3.

## Review Focus

1. **Office browser set to a non-Manila timezone** (an owner abroad): "today", Pending vs No attendance recorded, the week shown and every time must still be Manila. Tested in Task 3 (`wrManilaTodayKey`, `wrTime`).
2. **Time Out after midnight**: the entry and its hours stay on the Time In's work date. Tested in Task 3.
3. **Two workers with the same name** (live has two "John Tapales", W-0005 / W-0007): separate rows keyed by `worker_id`, worker number shown. Tested in Task 3.
4. **A photo that cannot be signed** (deleted file, network drop): **Photo unavailable** in its place, and print still opens, never stuck on "Preparing". Tested in Task 4.
5. **A note with line breaks, `<`, `&`, quotes or ñ**: shown exactly as written, with line breaks kept, and escaped in the screen and print. Tested in Task 3 (engine keeps it raw) and Task 4 (print escapes it).

---

### Task 1: Migration 0120, part A: roster history and office access

**Files:**
- Create: `supabase/migrations/0120_weekly_reports.sql`
- Create: `supabase/tests/weekly_reports.pglite.mjs`
- Modify: `package.json` (append `&& node supabase/tests/weekly_reports.pglite.mjs` to `test:sql`)

**Interfaces:**
- Consumes (live, unchanged): `profiles(id, role, owner_id, status, display_name, email, position, worker_no, allowed_modules jsonb)`; `auth_role()`, `is_owner()`, `is_staff()`, `data_owner_id()` (0002); `pr_is_office()` (0094).
- Produces:
  - Table `att_report_eligibility(id bigint generated always as identity primary key, owner_id uuid not null, worker_id uuid not null references profiles(id) on delete cascade, eligible boolean not null, effective_on date not null, role text, status text, source text not null check (source in ('launch','profile')), recorded_at timestamptz not null default now())`, index `(owner_id, worker_id, effective_on, id)`. RLS enabled, **no policies**, `revoke all ... from public, anon, authenticated`.
  - `att_report_eligible(p_role text, p_status text, p_owner uuid) returns boolean` (immutable): `p_role in ('worker','teamLeader') and coalesce(p_status,'active') = 'active' and p_owner is not null`.
  - Trigger `att_report_eligibility_trg` **after insert or update of role, status, owner_id on profiles for each row**, executing `att_report_eligibility_track()` (security definer).
  - `att_report_owner() returns uuid` (security definer, revoked from public/anon/authenticated: internal only). Raises `NOT_OFFICE` unless `pr_is_office()`. Raises `NO_ATTENDANCE_ACCESS` unless the caller's `allowed_modules` is not an array, is empty, or contains `attendance` (the 0104 `stk` pattern). Otherwise returns `data_owner_id()`.

- [ ] **Step 1: Write the failing PGlite test file**

Follow `supabase/tests/attendance_work_photos.pglite.mjs`: the same `test` / `eq` / `as` helpers, `ROOT` from `./ll_base.mjs`, and a fresh `PGlite` per test. The SETUP creates the `auth` schema, `auth.uid()`, the roles and a `profiles` table with the columns above. **Slice** the bodies of `auth_role`, `is_owner`, `is_staff` and `data_owner_id` from `0002_rls.sql`, and of `pr_is_office` from `0094_workmate_work_plan_office.sql`, the way that file slices `OLD_TIME_OUT`, so the test cannot drift from live. Add `asSuper(uid)`: `reset role` plus `test.uid` set, for calling internal functions and writing profiles the way an Edge Function or a security-definer RPC would. Seed profiles **before** running 0120, so the launch seed has something to find: company A's owner (role `owner`, owner_id null), an active worker, an active teamLeader, an inactive worker, a worker with null owner_id, and a staff account.

Tests and their assertions:
- `launch seed: one row per eligible worker/teamLeader, effective today (Manila), source launch`: exactly 2 rows (the active worker and the active teamLeader), each with `eligible = true`, `effective_on = (now() at time zone 'Asia/Manila')::date` and `source = 'launch'`.
- `running 0120 twice adds no rows`: the row count is unchanged after `db.exec(M120)` again.
- `deactivating writes false today; reactivating writes true`: update `status` to `inactive`, then `active`. The worker's last two rows are `(false, profile)` then `(true, profile)`.
- `worker→staff writes false; staff→worker writes true`.
- `a change that keeps eligibility writes nothing`: updating `position`, `display_name`, or role worker→teamLeader adds 0 rows.
- `moving company writes false for the old one and true for the new one`: changing `owner_id` A→B adds `(A, false)` then `(B, true)`.
- `a new active worker profile writes true on insert`; `a new staff profile writes nothing`.
- `att_report_owner`: the owner gets their own id; active staff get their owner_id; inactive staff get `NOT_OFFICE`; a worker gets `NOT_OFFICE`; staff with `allowed_modules = '["pm"]'` get `NO_ATTENDANCE_ACCESS`; staff with `'["attendance"]'` and with `'[]'` get their owner_id.
- `authenticated cannot call att_report_owner`: as `authenticated`, the call fails with `permission denied`.
- `authenticated cannot read att_report_eligibility`: a select fails with `permission denied`.

- [ ] **Step 2: Run it and see it fail**

Run: `node supabase/tests/weekly_reports.pglite.mjs`
Expected: it throws at the read of `0120_weekly_reports.sql` (ENOENT).

- [ ] **Step 3: Write part A of `0120_weekly_reports.sql`**

The header comment follows 0119's style: purpose, "outside the money model, reads attendance only", spec path, test path, "Idempotent: safe to re-run." Use `create table if not exists`, `create or replace function` and `drop trigger if exists` before `create trigger`. The trigger body is the one rule the test pins:

```sql
-- v_old: eligible before (UPDATE only; OLD is null on INSERT). v_new: eligible now.
-- v_moved: owner_id changed. Today = Manila date.
if v_old and (v_moved or not v_new) then
  insert into att_report_eligibility (owner_id, worker_id, eligible, effective_on, role, status, source)
  values (old.owner_id, new.id, false, v_today, new.role, new.status, 'profile');
end if;
if v_new and (v_moved or not v_old) then
  insert into att_report_eligibility (owner_id, worker_id, eligible, effective_on, role, status, source)
  values (new.owner_id, new.id, true, v_today, new.role, new.status, 'profile');
end if;
return null;
```

The launch seed inserts `(owner_id, id, true, Manila today, role, status, 'launch')` for every profile where `att_report_eligible(role, status, owner_id)` holds **and** no `att_report_eligibility` row exists for that worker. That makes it idempotent.

- [ ] **Step 4: Run it and see it pass**

Run: `node supabase/tests/weekly_reports.pglite.mjs`
Expected: every test prints `ok`, and the process exits 0.

- [ ] **Step 5: Checkpoint.** `git status --short` shows only the three files above as new or changed, plus the user's existing changes. Do not commit.

---

### Task 2: Migration 0120, part B: week report read and general duties

**Files:**
- Modify: `supabase/migrations/0120_weekly_reports.sql` (append)
- Modify: `supabase/tests/weekly_reports.pglite.mjs` (append tests; add a minimal `attendance_records` with the columns listed below)
- Modify: `supabase/tests/attendance_checks.sql` (add BLOCK 17; update the "Expected output" footer to eighteen notices)
- Modify: `supabase/migrations/README.md` (a **0120** paragraph after 0119's), `docs/DATABASE_SCHEMA.md` (§11 Attendance: the two tables and three RPCs)

**Interfaces:**
- Consumes: `att_report_owner()`, `att_report_eligibility` (Task 1); `attendance_records` (live).
- Produces:
  - `att_position_trade(p text) returns text` (immutable): `btrim(regexp_replace(btrim(coalesce(p,'')), '\s*\([^)]*\)\s*$', ''))`, so `'Helper (Marc Kelley)'` gives `'Helper'`. This mirrors `attSplitPosition` in `js/attendance-admin.js`.
  - Table `att_position_duties(id uuid primary key default gen_random_uuid(), owner_id uuid not null, position text not null, duties text not null, active boolean not null default true, updated_by uuid, updated_at timestamptz not null default now(), created_at timestamptz not null default now())`, unique index `(owner_id, lower(position))`, RLS on, no policies, revoked from public/anon/authenticated.
  - `att_duty_save(p_position text, p_duties text, p_active boolean default true) returns jsonb`: `{id, position, duties, active, updated_at}`. The stored position is `att_position_trade(p_position)`, which must be 1–80 characters, else `DUTY_POSITION_INVALID`. The duties are `btrim(p_duties)`, which must be 1–2000 characters, else `DUTY_TEXT_INVALID`. It upserts on `(owner_id, lower(position))` and sets `updated_by = auth.uid()`, `updated_at = now()`.
  - `att_duty_list() returns jsonb`: `{positions: text[] sorted case-insensitively, duties: [{id, position, duties, active, updated_at, updated_by_name}]}`. `positions` = the trades of this company's **active** workers and teamLeaders, plus every position that has a duty row, deduplicated case-insensitively, blanks dropped.
  - `att_week_report(p_week_start date) returns jsonb`. It raises `WEEK_START_NOT_MONDAY` unless `extract(isodow from p_week_start) = 1`. `v_end := p_week_start + 6`. The payload, with these exact keys:

```
{ week_start, week_end, generated_at,            -- dates as 'YYYY-MM-DD', generated_at = now()
  history_starts_on,                              -- min(effective_on) of this company's eligibility rows, or null
  roster:  [{ worker_id, worker_no, name, position, role, active, in_roster }],   -- in_roster: 'eligible' | 'records'
  records: [{ id, worker_id, worker_name, worker_position, work_date, status,
              timein_at, timein_project_system, timein_folder_id, timein_pm_project_id, timein_project_name,
              timein_photo_path, timein_description, timein_location_status, timein_is_mock, timein_was_offline,
              timeout_at, timeout_project_system, timeout_folder_id, timeout_pm_project_id, timeout_project_name,
              timeout_photo_path, timeout_extra_photo_paths, timeout_description, timeout_event_id,
              timeout_location_status, timeout_is_mock, timeout_was_offline,
              total_minutes, abandoned_at, abandoned_note }],      -- ordered by work_date, timein_at; NO lat/lng
  duties:  [{ position, duties, updated_at }] }   -- active rows only
```

  `name` = `coalesce(nullif(btrim(display_name),''), split_part(email,'@',1))`; `active` = `coalesce(status,'active') = 'active'`. The roster rule (spec §5), as SQL:

```sql
with ev as (select worker_id, eligible, effective_on, id from att_report_eligibility
             where owner_id = v_owner and effective_on <= v_end),
start_state as (select distinct on (worker_id) worker_id, eligible from ev
                 where effective_on < p_week_start order by worker_id, effective_on desc, id desc),
elig as (select worker_id from start_state where eligible
         union select worker_id from ev where eligible and effective_on between p_week_start and v_end),
recs as (select distinct worker_id from attendance_records
          where owner_id = v_owner and work_date between p_week_start and v_end)
select coalesce(e.worker_id, r.worker_id) as worker_id,
       case when e.worker_id is not null then 'eligible' else 'records' end as in_roster
  from elig e full join recs r on r.worker_id = e.worker_id
```

  All three RPCs are `security definer set search_path = public`, start with `v_owner := att_report_owner()`, and are granted execute to `authenticated`.

- [ ] **Step 1: Append the failing tests**

Add `attendance_records` to SETUP with exactly the columns the payload lists, plus `owner_id`, `timein_lat`, `timein_lng`, `timeout_lat` and `timeout_lng` (so the "no lat/lng" assertion means something). Seed company A and company B. Use week **2026-11-16 (Mon) to 2026-11-22 (Sun)**. Insert eligibility rows directly with `asSuper` to set chosen dates: launch on 2026-11-01 for the worker set, a deactivation on 2026-11-18 (Wed), a hire on 2026-11-25, and a deactivation on 2026-11-10 for someone with no records.

Duties:
- `save then list stores the trade`: saving `'Helper (Marc Kelley)'` stores the position `'Helper'`.
- `same trade in another case updates the same row`: `'helper'` updates the row; one row in total.
- `blank duties → DUTY_TEXT_INVALID`; `2001-char duties → DUTY_TEXT_INVALID`; `81-char position → DUTY_POSITION_INVALID`.
- `updated_by is the caller`.
- `positions = active trades + duty positions, deduplicated`: with active workers `Mason`, `mason`, `Helper (X)`, an inactive `Test`, and a duty row `Foreman`, the list is `['Foreman','Helper','Mason']`.
- `company B staff never see company A duties`; `a worker calling att_duty_save gets NOT_OFFICE`.

Week report:
- `Tuesday start → WEEK_START_NOT_MONDAY`.
- `records: this company only, Mon–Sun inclusive`: a Sunday 2026-11-22 record is in; Monday 2026-11-23, Sunday 2026-11-15 and company B's record are out.
- `record keeps extra photos in stored order and has no coordinates`: `timeout_extra_photo_paths` equals the inserted array, and `Object.keys(record)` contains no key ending in `_lat` or `_lng`.
- `roster: an eligible worker with no records is in (eligible)`.
- `roster: deactivated Wednesday is in; hired after the week is out; deactivated the week before with no records is out`.
- `roster: records without eligibility come in as records` (a worker with no eligibility rows and a record in the week).
- `history_starts_on is the company's first eligibility date, and null for a company with none`.
- `duties: active only`.
- `company B staff get company B only`; `a worker gets NOT_OFFICE`; `staff with ["pm"] get NO_ATTENDANCE_ACCESS`.

- [ ] **Step 2: Run them and see them fail**

Run: `node supabase/tests/weekly_reports.pglite.mjs`
Expected: the new tests FAIL (`function att_duty_save(...) does not exist` and similar). Task 1's tests still pass.

- [ ] **Step 3: Append part B to 0120** as the Interfaces block specifies.

- [ ] **Step 4: Run them and see them pass**

Run: `node supabase/tests/weekly_reports.pglite.mjs`
Expected: all tests `ok`, exit 0.

- [ ] **Step 5: Add BLOCK 17 to `attendance_checks.sql`**

It is read-only, inside `begin; ... rollback;`, in the style of BLOCK 16. It asserts:
- both tables exist with `relrowsecurity` and zero rows in `pg_policies`;
- trigger `att_report_eligibility_trg` exists on `profiles`;
- `has_function_privilege('authenticated', ...)` is true for `att_week_report(date)`, `att_duty_list()` and `att_duty_save(text,text,boolean)`, and false for `att_report_owner()`;
- every profile where `att_report_eligible(role,status,owner_id)` holds has a latest row (by `effective_on, id`) with `eligible = true`. The mismatch count must be 0.

It ends with `raise notice 'BLOCK 17 OK — weekly reports: roster history, duties, three office reads'`.

- [ ] **Step 6: Write the docs.** In the README, add a **0120** paragraph: what it adds, that it reads attendance only and writes nothing to it, that the trigger records roster changes from launch, and "Run after 0119." In `DATABASE_SCHEMA.md` §11, add `att_report_eligibility`, `att_position_duties` and the three RPCs, each with its purpose and access in one or two lines.

- [ ] **Step 7: Run the whole SQL suite**

Run: `npm run test:sql`
Expected: every file passes, including `weekly_reports.pglite.mjs`, and the process exits 0.

- [ ] **Step 8: Checkpoint.** No commit.

---

### Task 3: The report engine

**Files:**
- Create: `js/weekly-report-data.js`
- Create: `tests/weekly-report.test.js`
- Modify: `package.json` (`test`: append `&& node tests/weekly-report.test.js`)

**Interfaces:**
- Consumes: the `att_week_report` payload (Task 2), exactly as listed there.
- Produces: `window.WeeklyReportData`, and the same object as `module.exports` in Node (use split-view.js's wrapper: `(function (root) { ... })(typeof window !== 'undefined' ? window : globalThis)`). The object holds:
  - `wrManilaTodayKey(nowMs: number) → 'YYYY-MM-DD'`: take the UTC parts of `new Date(nowMs + 8 * 3600e3)`. It never reads the browser's timezone.
  - `wrAddDays(key, n) → key` and `wrWeekStart(key) → key of that week's Monday`: pure `Date.UTC` arithmetic. `wrWeekDays(weekStart) → string[7]`.
  - `wrTime(iso) → 'h:mm AM'`: `toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true })`; `null` gives `'—'`.
  - `wrDayLabel(key) → 'Mon 16 Nov'` and `wrWeekLabel(weekStart) → 'Mon 16 – Sun 22 Nov 2026'`: pure string math, no timezone. The first day carries its month only when the months differ, and its year only when the years differ.
  - `wrHoursText(minutes|null) → '28h 34m' | '—'`; `wrWorkerNo(n) → 'W-0007' | '—'` (the same format as `attWorkerNo`).
  - `wrTrade(position) → string`: the same rule as SQL `att_position_trade`.
  - `wrDayStatus(record|null, dayKey, todayKey) → 'pending' | 'none' | 'working' | 'complete' | 'missing_timeout' | 'admin_closed'`. No record: `dayKey >= todayKey` gives `pending`, otherwise `none`. `status 'complete'` gives `complete`. `'abandoned'` gives `admin_closed`. `'working'` gives `working` when `dayKey === todayKey`, otherwise `missing_timeout`.
  - `WR_DAY_LABEL = { pending: 'Pending', none: 'No attendance recorded', working: 'Still on site', complete: 'Finished the day', missing_timeout: 'No Time Out', admin_closed: 'Closed by the office' }`. These are Attendance's own words, plus the spec's.
  - `wrPhotos(record) → [{ path, label, legacy }]`. When `timeout_extra_photo_paths` is a non-empty array: `[timeout_photo_path, ...extras]`, labels `'Work photo 1 of N'` …, `legacy: false`. When it is null or empty and `timeout_photo_path` is set: one photo with label **`Legacy Time Out photo - purpose not recorded`**, `legacy: true`. No path gives `[]`. Null entries are kept as `{ path: null }` so the screen can say **Photo unavailable**.
  - `wrProjectKey(system, id) → 'pc:<id>' | 'pm:<id>'`.
  - `wrEntry(record, person) → Entry | null`. Null unless `status === 'complete'`. `Entry = { recordId, workerId, workerName, workerNo, date, project: { key, system, id, name }, timeInProject: { key, system, id, name } | null, projectsDiffer, note: string | null, photos, legacy, timeOutAt, timeoutEventId }`. `note` is `timeout_description` **unchanged** (no trimming, line breaks kept); an empty string becomes `null`. `id` = `timeout_folder_id ?? timeout_pm_project_id`, and the same for Time In.
  - `wrBuildEmployees(payload, todayKey) → Employee[]`: one per roster row, sorted by name, then worker number. `Employee = { workerId, workerNo, name, position, trade, active, inRoster, headerPhotoPath, days: Day[7], entries: Entry[], recordedDays, knownMinutes, incompleteDays, hoursText, reviewReasons: string[], needsReview, duties: { text, updatedAt } | null }`. `Day = { date, label, status, statusLabel, record }`. `name` and `position` prefer the week's newest record snapshot (`worker_name`, `worker_position`) over the roster. `headerPhotoPath` = the **Time In** photo of the earliest record in the week, else `null` (a Time Out photo is never used). `recordedDays` = days with a record. `knownMinutes` = the sum of non-null `total_minutes`. `incompleteDays` = records whose `total_minutes` is null. `hoursText` = `wrHoursText(knownMinutes)` when any minutes are known, else **`No hours recorded`**. `duties` = the payload duty whose `lower(position)` equals `lower(trade)`.
  - `WR_REASON = { missing_timeout: 'No Time Out', admin_closed: 'Closed by the office', verification: 'Location or clock concern', no_photo: 'Work photo missing' }`. `reviewReasons` keeps each key once, in that order. `verification` applies when either location status is in `outside_radius`, `mock_location` or `permission_denied`, or either `is_mock` is true. `no_photo` applies to a complete record with no photo path. A missing note is **not** a review reason: older Time Outs allowed an empty note, and the spec forbids flagging a valid older submission. The note's absence is shown as "No note written" instead.
  - `wrBuildProjects(payload) → Project[]`, sorted by name. `Project = { key, system, id, name, days: [{ date, label, entries }], submissions, contributors, photoCount }`, grouped by `wrProjectKey` of the **Time Out** project. `name` = the newest entry's saved name. `days` lists only days with entries, in date order.
  - `wrCoverage(payload) → { kind: 'full' | 'partial' | 'before_history', note: string }`. `before_history`: `history_starts_on` is null or after `week_end`. Its note: `'Roster history starts on <label>. This week lists only people with attendance records; others may be missing.'` (with `<label>` = `wrDayLabel`, or `'Roster history has not started yet.'` + the same tail when null). `partial`: history starts after `week_start` but on or before `week_end`. Its note: `'Roster history starts on <label>, during this week. People with no records before then may be missing.'` `full` has the note `''`.
  - `wrFilterEmployees(list, { q, trade, projectKey, needsReview }) → list`. `q` matches name or worker number, case-insensitively. `trade` matches case-insensitively. `projectKey` keeps employees with an entry on that project.

- [ ] **Step 1: Write the failing tests** (`require('../js/weekly-report-data.js')`, with the same `test` / `eq` / `ok` helpers as `tests/attendance.test.js`)

- `manila today ignores the browser: 2026-11-22T17:30:00Z → 2026-11-23`, and `2026-11-22T15:59:00Z → 2026-11-22`.
- `wrTime shows Manila: '2026-11-22T09:42:00Z' → '5:42 PM'`. Run this case with `process.env.TZ = 'America/Los_Angeles'` set before `require`.
- `week start: Sunday 2026-11-22 → 2026-11-16; Monday 2026-11-23 → 2026-11-23`; `wrWeekDays('2026-11-16')[6] === '2026-11-22'`; `wrWeekLabel('2026-11-16') === 'Mon 16 – Sun 22 Nov 2026'`.
- `day status`: no record on a future day gives `pending`; on today, `pending`; on a past day, `none`; `working` today gives `working`; `working` yesterday gives `missing_timeout`; `abandoned` gives `admin_closed`; and `WR_DAY_LABEL.none === 'No attendance recorded'`.
- `photos: first photo then extras, in order, once each`: `out-e1.jpg` + `['out-e1-2.jpg','out-e1-3.jpg']` gives three photos labelled `Work photo 1 of 3` … `3 of 3`.
- `photos: an old single-photo Time Out is labelled legacy`: label `'Legacy Time Out photo - purpose not recorded'`, `legacy === true`.
- `hours: 578 + 571 + 565 = 28h 34m; a fourth day with no Time Out adds a recorded day, not hours`: `recordedDays === 4`, `knownMinutes === 1714`, `hoursText === '28h 34m'`, `incompleteDays === 1`.
- `no known minutes → 'No hours recorded'`.
- `Time Out after midnight stays on the Time In day`: a record with `work_date '2026-11-18'`, `timein_at` 2026-11-18 20:00 Manila, `timeout_at` 2026-11-19 02:00 Manila and `total_minutes 360` puts the entry on `2026-11-18`, while `days[3]` (Thu) is `none`.
- `same name, two workers`: two roster rows named `John Tapales`, W-0005 and W-0007, give two employees with different `workerId` and `workerNo`.
- `eligible worker with no records appears, with every past day 'none'`.
- `header photo is the earliest Time In photo, never a Time Out photo`.
- `note kept exactly as written`: `'Laid blocks\n2F <east> & "west" — Señor'` comes back unchanged; `''` becomes `null`.
- `Time In and Time Out projects differ`: `projectsDiffer === true`, and the entry's `project` is the Time Out one.
- `projects group by system + id, not name`: `Site A` in PC and `Site A` in PM give two projects. Two workers with the same PC project on one day give `submissions 2`, `contributors 2`, and `photoCount` = the sum of their photos.
- `duties match by trade`: position `'Helper (Marc Kelley)'` with duty `'helper'` gives `duties.text`.
- `review reasons`: a missing Time Out, a mock location and a complete record without a photo give `['missing_timeout','verification','no_photo']` and `needsReview === true`.
- `an older Time Out with one photo and no note is not flagged`: `reviewReasons` is `[]` and its entry has `legacy === true` and `note === null`.
- `week labels across a month and a year`: `wrWeekLabel('2026-11-30') === 'Mon 30 Nov – Sun 6 Dec 2026'` and `wrWeekLabel('2026-12-28') === 'Mon 28 Dec 2026 – Sun 3 Jan 2027'`.
- `coverage`: `history_starts_on` null gives `before_history`; `'2026-11-19'` for week 11-16 gives `partial`; `'2026-11-01'` gives `full` and note `''`.
- `filter`: `q 'w-0007'` finds the worker; `needsReview: true` keeps only flagged ones; `projectKey` keeps workers with an entry there.

- [ ] **Step 2: Run them and see them fail**

Run: `node tests/weekly-report.test.js`
Expected: FAIL: `Cannot find module '../js/weekly-report-data.js'`.

- [ ] **Step 3: Implement `js/weekly-report-data.js`** to the Interfaces block: pure functions, no DOM, no network.

- [ ] **Step 4: Run them and see them pass**

Run: `node tests/weekly-report.test.js && node --check js/weekly-report-data.js`
Expected: all `ok`, exit 0.

- [ ] **Step 5: Checkpoint.** No commit.

---

### Task 4: Print / Save as PDF

**Files:**
- Create: `js/weekly-report-print.js`
- Create: `tests/weekly-report-print.test.js`
- Modify: `package.json` (`test`: append `&& node tests/weekly-report-print.test.js`)

**Interfaces:**
- Consumes: `Employee`, `Project` and `WeeklyReportData.wrTime` / `wrDayLabel` / `wrWeekLabel` / `WR_DAY_LABEL` (Task 3).
- Produces: `window.WeeklyReportPrint`, and `module.exports` in Node, holding:
  - `wrPrintEmployeeHtml(emp, ctx, urls) → string` and `wrPrintProjectHtml(project, ctx, urls, dayKey|null) → string`: a full `<!doctype html>` document. `ctx = { weekStart, weekEnd, generatedAt, live, coverageNote, origin }`. `urls` is a `Map` from photo path to a signed URL or `null`.
  - `WR_PRINT_CSS`: `@page { size: A4 portrait; margin: 14mm 12mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); } }`; a photo grid of two per row; `figure { break-inside: avoid; }`; `.wr-note { white-space: pre-wrap; }`.
  - `wrOpenPrint(buildHtml: (urls) => string, paths: string[], sign: (path) => Promise<string|null>, win = window) → Promise<'printed' | 'blocked'>`. It calls `win.open('', '_blank')` **synchronously, before any await**, and writes `Preparing report…`. A null window returns `'blocked'` without signing. It signs the distinct non-null paths, at most 4 at a time; a rejected or null result becomes `null`. Then it writes `buildHtml(urls)`. The document's own script waits until every `<img>` has loaded or failed (and `decode()` where available) before it calls `window.print()`.

  Document content. The letterhead is `ctx.origin + '/assets/images/DACS-LETTERHEAD.png'`, with print-utils' `DACS-TRANSPARENT.png` fallback on `onerror`. Then: report title, week label, and the status. A live report gets a banner **Not final — live report assembled <generatedAt in Manila>**. Then the coverage note when present. The employee document has: name, worker number, position; a summary (**Recorded hours** or **No hours recorded**, recorded days, incomplete days); General duties (when present) under the heading "General duties (standing responsibilities, not a record of work done)"; a 7-row daily attendance table (Day, Status, Time In, Time Out, Site, Hours); then **Work reported**. Each entry shows its date, project ("Time In at …" when the projects differ), note in `.wr-note` (or "No note written"), and one `<figure>` per photo. It ends with a small source line: `Source: attendance record <first 8 of recordId>` + ` · Time Out event <first 8 of timeoutEventId>` when present (spec §4 "Source trace"). A figure holds an `<img>` with a `<figcaption>` (the photo's label), or a box reading **Photo unavailable** when the URL is null. The project document has: project name and system, the day or week, submissions and contributors, then each day's entries with the worker's name and number, note and photos. Every piece of text goes through one `esc()` helper.

- [ ] **Step 1: Write the failing tests**

- `live employee print says Not final`, and contains `DACS-LETTERHEAD.png` and `counter(pages)`.
- `every signed photo appears exactly once`: 3 photos with 3 URLs give 3 `<img src="…">`, each URL counted once.
- `a null url prints Photo unavailable in its place`, and the photo's caption is still shown.
- `legacy photo keeps its label`: the `figcaption` text is `Legacy Time Out photo - purpose not recorded`.
- `note is escaped and keeps its line breaks`: the note `'a\n<script>x</script> & "q" ñ'` comes out containing `a\n&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot; ñ`, inside `class="wr-note"`.
- `no peso sign and no money words in either document`: `!/₱|\bamount\b|payroll|bonus/i.test(html)`.
- `each entry carries its source line`: the HTML contains `Source: attendance record ` followed by the record id's first 8 characters.
- `project print filtered to one day shows only that day`.
- `wrOpenPrint: a failed signature becomes Photo unavailable and the page is written`. With a fake window recording `document.write` calls and a `sign` that rejects for one path, the final written HTML contains `Photo unavailable` and does not contain `Preparing report`. The result is `'printed'`.
- `wrOpenPrint: a blocked popup signs nothing`: `open` returns `null`, so the result is `'blocked'` and `sign` is never called.
- `wrOpenPrint: open happens before the first await`: the fake `open` is called before the fake `sign` is called.

- [ ] **Step 2: Run them and see them fail**

Run: `node tests/weekly-report-print.test.js`
Expected: FAIL: `Cannot find module '../js/weekly-report-print.js'`.

- [ ] **Step 3: Implement `js/weekly-report-print.js`** to the Interfaces block.

- [ ] **Step 4: Run them and see them pass**

Run: `node tests/weekly-report-print.test.js && node --check js/weekly-report-print.js`
Expected: all `ok`, exit 0.

- [ ] **Step 5: Checkpoint.** No commit.

---

### Task 5: The Weekly reports screen and its wiring

**Files:**
- Create: `js/weekly-report-admin.js`, `css/weekly-report.css`
- Modify: `js/admin.js` (PRIMARY_NAV attendance `modules`, after `attReports`)
- Modify: `admin.html` (container div, `TITLES`, init line, one stylesheet link, three script tags)
- Modify: `tests/weekly-report.test.js` (a wiring-and-fence section)
- Modify: `docs/ARCHITECTURE.md` (§4 module map: a **Weekly reports** row), `CLAUDE.md` (one bullet under *Money invariants*, after the Tools bullets)

**Interfaces:**
- Consumes: `window.WeeklyReportData` (Task 3), `window.WeeklyReportPrint` (Task 4), `window.SplitView` (`render`, `page`, `form`, `closePop`), `window.sbClient.rpc('att_week_report', { p_week_start })`, `rpc('att_duty_list')` and `rpc('att_duty_save', { p_position, p_duties, p_active })` (Task 2).
- Produces: `window.initWeeklyReportModule(el)`, called by `switchView` for the view `attWeekly`.

Screen behaviour (cfg for `SplitView.render`, key `attWeekly`):
- Title **Weekly reports**; `live: 'Live · Not final'`; `seg` with **Employees** / **Projects** / **General duties**.
- The toolbar has the week controls: ‹ previous week, the `wrWeekLabel`, › next week (disabled at the current Manila week), and **This week**. The week opens on the current Manila week (`wrWeekStart(wrManilaTodayKey(Date.now()))`). Week, segment, tab, search and filters live in module state, so opening and closing the pop-up never resets them.
- The coverage note from `wrCoverage`, when present, goes in an `sv-strip`. So does the line "Live report — built from accepted attendance records. Data still on a phone is not included."
- **Employees** has tabs **Everyone** (count) and **Needs review** (count, `needs: true`), search "Search name or worker no.", a **Position** select (the week's trades) and a **Project** select (the week's projects). Each card: `title` = name; `sub` = `'W-0007 · Mason'`; `meta` = `'4 days recorded · Recorded hours 28h 34m · 1 incomplete'`, or **No attendance recorded** when `recordedDays === 0`, or `'… · No hours recorded'`. A needs-review card gets pill `{ text: 'Needs review', tone: 'red' }`, and its first reasons go in `meta`.
- **Employee pop-up** (`SplitView.page`, `wide: true`): kicker = the week label, title = name, pills `[{ text: 'Not final', tone: 'gold' }]`, actions = a **Print** button. The page shows: the header (a signed Time In photo, or initials); the summary; General duties (when present, with "standing responsibilities, not a record of work done"); the 7-day table with each day's `statusLabel`, times through `wrTime`, Time In / Time Out sites, and a **Time In photo** link per day with a record (signed only when clicked, so opening the pop-up signs no Time In photos beyond the header); then **Work reported**, each entry ending with the same source line as the print. Each entry shows the note in `white-space: pre-wrap` (or "No note written") and a photo grid that is signed **only now**, at most 4 at a time, through the module's own signer: bucket `attendance`, `createSignedUrl(path, 3600)`, cached until 10 minutes before expiry, the same as `attSignedPhoto`. An unsigned photo shows **Photo unavailable** with a **Try again** button.
- **Projects** has a **Day** select (All days + the week's 7 days). Cards: `title` = project name, `sub` = `Project Control` / `Project Management`, `meta` = `'5 submissions · 3 contributors · 18 photos'`. The pop-up groups entries by day: worker name and number, note, photos (signed on open), and a **Print** button that passes the chosen day.
- **General duties** is a `custom` tab (`cfg.custom` + `onCustom`). It lists `att_duty_list().positions` with each one's duty text (or "No duties written yet"), an **Inactive** tag, and "Updated <date> by <name>". Clicking a position opens `SplitView.form` with a textarea (`maxlength 2000`) and an **Active** checkbox. Save calls `att_duty_save`. Errors map as follows: `DUTY_TEXT_INVALID` → "Write the duties (up to 2,000 characters)."; `DUTY_POSITION_INVALID` → "This position name cannot be used."; `NOT_OFFICE` / `NO_ATTENDANCE_ACCESS` → "Your account cannot change general duties."
- States: loading ("Loading the week…"), empty (Employees: "No workers in this week's roster."; Projects: "No work submissions this week."), and an error notice with a **Try again** button that reruns the load. A stale response is dropped with a `ticket` counter, as `attRenderRewards` does.
- **Print** runs `WeeklyReportPrint.wrOpenPrint(...)` straight from the click handler (no await before it). It passes the employee's or project's photo paths and the module's signer. On `'blocked'`, it shows "Allow pop-ups for this site to print."

Wiring:
- `js/admin.js`: after `{ view: 'attReports', … }`, add `{ view: 'attWeekly', label: 'Weekly reports', icon: 'clipboard-list' },`. **No `_FOCUS_SUBVIEWS` change**: detail opens in the pop-up, never as its own view. **No `_visibleNav` change**: staff keep Attendance, and workers and team leaders never see it.
- `admin.html`: **not** added to `ATT_VIEWS`. That list routes to `initAttendanceModule`, which knows nothing of this view; `attAppUpdates` is the precedent for a separate Attendance module with its own init line. Add `<div id="attWeeklyView" class="content-view" style="display: none;"></div>` after `attReportsView`; `attWeekly: 'Weekly reports',` in `TITLES` after `attReports`; and `if (view === 'attWeekly' && typeof initWeeklyReportModule === 'function') initWeeklyReportModule(document.getElementById('attWeeklyView'));` next to the `attAppUpdates` line. Add `<link rel="stylesheet" href="css/weekly-report.css?v=20261123a">` after `split-view.css`. After the `split-view.js` script tag, add, in this order: `js/weekly-report-data.js`, `js/weekly-report-print.js`, `js/weekly-report-admin.js`, each `?v=20261123a`.

- [ ] **Step 1: Write the failing wiring-and-fence tests** (append to `tests/weekly-report.test.js`, reading files as text)

- `nav has Weekly reports under Attendance`: `js/admin.js` contains `view: 'attWeekly', label: 'Weekly reports'`, and it sits between `attReports` and `attRewards`.
- `admin.html wires the view`: it contains `id="attWeeklyView"`, `attWeekly:` with `'Weekly reports'`, and `initWeeklyReportModule(document.getElementById('attWeeklyView'))`. The three script tags appear after `js/split-view.js`, in the order data → print → admin.
- `staff are not blocked and workers cannot reach it`: the staff `blocked` list in `admin.html` does not contain `attWeekly`, and the worker branch's allowed list does not contain it.
- `the screen writes nothing but duties`: `js/weekly-report-admin.js` has no `.insert(`, `.update(`, `.delete(` or `.upsert(`, and its `rpc('…')` names are exactly `att_week_report`, `att_duty_list` and `att_duty_save`.
- `no money anywhere in the module`: none of the three JS files matches `/₱|attPeso|attendance_weekly_rewards|reward_amount|payroll/`.
- `photos are signed only from the attendance bucket`: `js/weekly-report-admin.js` contains `.from('attendance')` and no `getPublicUrl`.

- [ ] **Step 2: Run them and see them fail**

Run: `node tests/weekly-report.test.js`
Expected: the new wiring tests FAIL, and Task 3's tests still pass.

- [ ] **Step 3: Implement `js/weekly-report-admin.js` and `css/weekly-report.css`** to the screen behaviour above. Reuse the Attendance and v5 classes (`att-btn`, `att-pill`, `sv-*`, `att-work-strip` / `att-work-thumb`). The new CSS is only for the 7-day table, the photo grid and the duty list, and it works at 400 px width.

- [ ] **Step 4: Wire `js/admin.js` and `admin.html`** as listed above.

- [ ] **Step 5: Run the tests and syntax checks**

Run: `node tests/weekly-report.test.js && node --check js/weekly-report-admin.js && node --check js/admin.js`
Expected: all `ok`, exit 0.

- [ ] **Step 6: Write the docs.**
  - `ARCHITECTURE.md` §4 gets a row: **Weekly reports** | `weekly-report-admin.js` (+ `-data`, `-print`) | reads `att_week_report` (0120), duties through `att_duty_*`, roster history via the `profiles` trigger, photos signed on open, no money, Part 1 = live only.
  - `CLAUDE.md` gets one bullet: "**Weekly employee reports (0120) read attendance — they move no money and write no attendance.** Hours are saved `total_minutes` only; work entries group by the Time Out project's system + id; photos are paths signed on open. Roster history (`att_report_eligibility`) is written only by the `profiles` trigger; duties only through `att_duty_save`. Owner and active staff with Attendance access; workers never. Only `js/weekly-report-*.js` call the `att_week_report` / `att_duty_*` functions. Spec: `docs/superpowers/specs/2026-11-22-weekly-employee-report-mvp-terms.md`."

- [ ] **Step 7: Checkpoint.** No commit.

---

### Task 6: Full verification and hand-off

**Files:** none new.

- [ ] **Step 1: Run every suite**

Run: `npm test`, then `npm run test:sql`
Expected: both exit 0. `money-math.test.js` is unchanged and green; `weekly-report.test.js` and `weekly-report-print.test.js` pass.

- [ ] **Step 2: Syntax-check every touched script**

Run: `node --check js/weekly-report-data.js && node --check js/weekly-report-print.js && node --check js/weekly-report-admin.js && node --check js/admin.js`
Expected: no output, exit 0.

- [ ] **Step 3: Stop for the user's approval to apply 0120 live.** Report: the migration file, what it adds, that its launch seed writes one roster row per active worker/teamLeader (expected: as many as the live count of active worker + teamLeader profiles, which was 11 on 22 Nov 2026), and that it changes nothing in `attendance_records`, storage or money tables. Do not apply it without that approval.

- [ ] **Step 4: After the user applies it, verify live** (read-only, via the Supabase MCP `execute_sql`): run BLOCK 17 of `supabase/tests/attendance_checks.sql`.
Expected: `BLOCK 17 OK — …`. Also, `select count(*) from att_report_eligibility where source = 'launch'` equals the eligible-profile count.

- [ ] **Step 5: Browser check** (`admin.html`, local or live, as agreed with the user):
  1. Owner: Attendance → **Weekly reports** opens on this Manila week with "Live · Not final". Every active worker appears, including those with no records ("No attendance recorded" for past days, "Pending" for later ones).
  2. Prior week ‹ and This week work. Next › stops at this week. A week before 23 Nov 2026 shows the "Roster history starts on…" note.
  3. A worker with records: the pop-up shows the 7-day table and **Work reported** with the photos; a photo that fails shows **Photo unavailable** + Try again.
  4. **Projects**: cards group by project; the Day select narrows them; the counts read "submissions" / "contributors".
  5. **General duties**: add duties for `Mason`; the Mason workers' pop-ups show it under General duties; mark it Inactive and it disappears from them.
  6. **Print** from an employee and from a project: A4, letterhead, **Not final**, all photos, page numbers.
  7. Staff account (`staff@`): the same screens, no peso anywhere. An `allowed_modules` account without Attendance has no Weekly reports tab.
  8. The other Attendance screens (Today on site, Workers, Sites & schedule, Hours report, Weekly bonus) behave as before.

  Record the environment, the date, what passed, and every step **not** run.

- [ ] **Step 6: Hand-off.** Summarise for the user: the files changed, the test results, live status, browser results, and what is left for Part 2 (finalization, archive, photo check codes, CSV, office-supplied earlier start dates) and Part 3 (photo lock). Do not commit; the user commits.
