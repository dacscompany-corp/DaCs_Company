# Weekly Reports, Part 1b (project report first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-project report the heart of **Attendance → Weekly reports**. List every active project, including ones with no work that week. Open the screen on Projects. Print a project's day or week in the layout of the owner's manual De Leon Residence Nov 20 report.

**Architecture:** Migration 0121 adds a `projects` list to the `att_week_report` payload. It reuses the live `attendance_projects_for_admin()` (0072) and adds each Project Control folder's completed flag. The engine (`js/weekly-report-data.js`) merges that list with the week's work entries and numbers photos for the report. The print builder (`js/weekly-report-print.js`) gets the new project layout. The screen (`js/weekly-report-admin.js`) opens on Projects, shows empty and hidden projects, and signs photos in batches.

**Tech Stack:** Plain HTML + vanilla JS (no build step), Supabase Postgres, PGlite tests (`npm run test:sql`), zero-dependency Node tests (`npm test`).

**Spec:** [docs/superpowers/specs/2026-11-22-weekly-employee-report-mvp-terms.md](../specs/2026-11-22-weekly-employee-report-mvp-terms.md): the "Owner decisions" rows *Project report (23 Nov 2026)* and *Projects list (23 Nov 2026)*. This plan extends [Part 1](2026-11-23-weekly-reports-part1.md), which is built, with 0120 live. Its Global Constraints still apply in full.

## Global Constraints

- Everything in Part 1's Global Constraints still binds, including: Asia/Manila; Monday–Sunday; no peso figure; read-only toward attendance; photos are paths, signed only when a pop-up or print opens; owner and active staff with Attendance; **no commits**; no `npm run build`; the copy strings `Work reported`, `Photo unavailable`, `Not final`, and `Legacy Time Out photo - purpose not recorded`.
- **Active project** = an Attendance site from `attendance_projects_for_admin()` that is **not completed**. Hidden sites are included and tagged **Hidden from workers**. A completed project appears only in a week (or day) where it has work.
- The project report is **office-only**. It keeps worker names, worker numbers and the source line.
- The report writes **no task titles, percentages or design comparisons**. Each work line is the worker's own Time Out note.
- Counts read **submissions** and **workers** (meaning contributors), never tasks or headcount.
- Migration **0121**: 0120 is live and stays unchanged. Applying 0121 live is the user's own approval.
- Forbidden in the three `js/weekly-report-*.js` files (code and comments): `₱`, `attPeso`, `attendance_weekly_rewards`, `reward_amount`, `payroll`.

## Review Focus

1. **A project name with quotes, `<`, `&` or a backslash** must be escaped in the HTML **and** in the `@page` footer CSS string. Tested in Task 9.
2. **A day filter** prints only that day, with photo numbers restarting at #1. Tested in Task 8 and Task 9.
3. **A busy week** (hundreds of photos) signs in batches rather than one request per photo, and never blocks the pop-up from opening. Tested in Task 10 (source fence); the browser check covers the rest.
4. **A hidden project** says why it is empty: workers can't pick it at Time In. Tested in Task 10.
5. **An old payload without `projects`** (a browser cached before 0121, or 0121 not yet applied) behaves exactly like Part 1. Tested in Task 8.

---

### Task 7: Migration 0121, projects in the week report

**Files:**
- Create: `supabase/migrations/0121_weekly_reports_projects.sql`
- Modify: `supabase/tests/weekly_reports.pglite.mjs` (run 0121 after 0120 in `fresh()`; add tests), `supabase/tests/attendance_checks.sql` (BLOCK 18 + footer: nineteen notices), `supabase/migrations/README.md` (0121 paragraph after 0120's; next-number line becomes **0122** / `0121_weekly_reports_projects.sql`), `docs/DATABASE_SCHEMA.md` (the `att_week_report` payload gains `projects`)

**Interfaces:**
- Consumes: 0120's `att_week_report` (copy its body **verbatim**); live `attendance_projects_for_admin() returns table (project_system text, project_id uuid, project_name text, hidden boolean)` (0072, unchanged); `folders.completed_at` (0064).
- Produces: `att_week_report(p_week_start date)` with one new payload key, `projects: [{ project_system, project_id, project_name, hidden, completed }]`, ordered by `lower(project_name)`. `completed` = `f.completed_at is not null` for `pc`, and always `false` for `pm` (0072 already lists only active PM projects). Grants are restated as in 0120.

- [ ] **Step 1: Failing tests.** In SETUP, add a `folders(id uuid primary key, completed_at timestamptz)` table and a **stub** `attendance_projects_for_admin()` that returns rows from a test table `t_sites(owner_id, project_system, project_id, project_name, hidden)` where `owner_id = data_owner_id()`. The stub's comment says 0072's function is not what 0121 changes. Tests:
  - `projects lists the company's sites with hidden and completed flags`: three company-A sites (shown; hidden; completed + hidden) give exactly those three with the right flags, ordered by name.
  - `company B staff get only company B sites`.
  - `every 0120 key is still in the payload`: `week_start`, `week_end`, `generated_at`, `history_starts_on`, `roster`, `records`, `duties`.
  - `no sites → projects is []`.
- [ ] **Step 2:** Run `node supabase/tests/weekly_reports.pglite.mjs`. Expected: the new tests FAIL (no `projects` key, or 0121 missing), and the 28 old tests pass.
- [ ] **Step 3:** Write 0121: header comment in 0120's style (purpose, spec rows, "Run after 0120. Idempotent."), then `create or replace function att_week_report` with 0120's body plus the `projects` key.
- [ ] **Step 4:** Run the same command. Expected: all pass.
- [ ] **Step 5:** BLOCK 18, read-only like BLOCK 17: exactly one `att_week_report`; its `prosrc` contains `attendance_projects_for_admin` and `'projects'`; execute is granted to `authenticated`. Notice text: `BLOCK 18 OK — weekly reports list every site`. Then the README / schema docs.
- [ ] **Step 6:** Checkpoint, no commit. (Do not run the hour-long `npm run test:sql`.)

### Task 8: Engine, all projects plus photo numbering

**Files:** Modify `js/weekly-report-data.js`, `tests/weekly-report.test.js`

**Interfaces:**
- `wrBuildProjects(payload)`: as in Part 1, plus every `payload.projects` row with `completed === false` that has no entries this week, added as an empty project. Every project gains `hidden: boolean`, `completed: boolean` and `hasWork: boolean`. A project with entries takes `hidden` / `completed` from its matching `projects` row by `wrProjectKey(system, id)`; with no match, both are `false`. A completed project with entries is kept. When `payload.projects` is missing, the output is exactly Part 1's. Sort by `lower(name)`.
- `wrNumberPhotos(project, dayKey|null) → { rows: [{ entry, from, to }], photos: [{ n, path, label, legacy, entry }] }`: only that day's entries when `dayKey` is given. Entries are ordered by date, then worker name. Photos are numbered from 1 in that order. `from` / `to` are the entry's first and last numbers, or `null` when it has no photos.

- [ ] **Step 1: Failing tests:**
  - `empty active projects are listed`: a payload with one entry on site A plus `projects` [A shown, B hidden, C completed] gives A (hasWork, 1 submission) and B (empty, `hidden: true`). C is absent.
  - `a completed project with work this week is listed`.
  - `no projects key → same output as Part 1`: deep-equal against a payload without the key, comparing the Part 1 fields only.
  - `numbering runs across entries`: 3 entries with 3 photos each give rows `#1–3`, `#4–6`, `#7–9` and photos `n` = 1…9 in order.
  - `day filter restarts numbering`: only Fri's 2 entries, numbered from 1.
  - `an entry without photos has from/to null and takes no number`.
- [ ] **Step 2:** `node tests/weekly-report.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command, plus `node --check js/weekly-report-data.js`. Expected: all pass.
- [ ] **Step 5:** Checkpoint, no commit.

### Task 9: The project print in the Nov 20 layout

**Files:** Modify `js/weekly-report-print.js`, `tests/weekly-report-print.test.js`

**Interfaces:** `wrPrintProjectHtml(project, ctx, urls, dayKey|null)` keeps its signature and rebuilds its body using `WeeklyReportData.wrNumberPhotos`. `wrPrintEmployeeHtml` and `wrOpenPrint` are unchanged.

Layout, from top to bottom (A4 portrait):
- **Header band**: background `#1f2a44`, white text. A small spaced-caps line `<PROJECT NAME> · OFFICE REPORT`. The title is **Weekly Progress Report**, or **Daily Progress Report** when `dayKey` is given, with the second word in gold `#c9a227`. A sub-line reads `<Project Control | Project Management> · <week label or day label> · Assembled <Manila date time>`. On the right, a rounded white box holds the DAC logo (`ctx.origin + '/assets/images/DACS-LETTERHEAD.png'`, falling back to `DACS-TRANSPARENT.png`).
- The **Not final** banner when `ctx.live`, then the coverage note when present.
- **Four tiles**, the first dark: Submissions · Workers · Photos · Days with work.
- **Work done**: one row per `rows[]` entry, grouped under day headings (`wrDayLabel`). Each row shows the worker's name and number, the note (`white-space: pre-wrap`, or "No note written"), "Time In at <site>" when the projects differ, `Photos #a–#b` on the right (or `#a` alone, or "No photos"), and the small grey source line from Part 1.
- **Progress photos**: a grid three across (`grid-template-columns: repeat(3, 1fr)`). Each `<figure>` has a `#n` badge and an `<img>` (`object-fit: cover`, fixed height about 62mm), or a **Photo unavailable** box that keeps its `#n`. The caption reads `<day label> · <worker name>`, plus the legacy label on legacy photos. Figures avoid page breaks.
- **Footer**: `@page { @bottom-left { content: "<project name> · <period>" } @bottom-right { content: "Page " counter(page) " of " counter(pages) } }`. The bottom-left string goes through a `cssString()` helper that escapes `\`, `"` and newlines.
- A project with no entries prints one line: "No work submitted for this period." (The screen never offers Print for one; this is defensive.)

- [ ] **Step 1: Failing tests:**
  - `weekly vs daily title`.
  - `tiles show 3 submissions, 2 workers, 9 photos, 2 days` (for the 3-entry sample).
  - `work rows carry their photo ranges`: `Photos #1–#3` … `#7–#9`.
  - `the grid is three across and each signed URL appears once`.
  - `a null URL keeps its #n with Photo unavailable`.
  - `legacy caption`.
  - `the project name is escaped in HTML and in the @page string`: the name `Bob's "Shop" <A&B> \ 2` appears HTML-escaped in the body, and with `\"` and `\\` in the CSS string.
  - `the day print restarts at #1 and shows only that day`.
  - `no money words`.
  - `an empty project prints "No work submitted for this period."`
- [ ] **Step 2:** `node tests/weekly-report-print.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command, plus `node --check js/weekly-report-print.js`. Expected: all pass. Then run `node .superpowers/sdd/2026-11-23-weekly-reports-part1/sample/build-sample.js` (it writes `de-leon-sample.html` beside itself; print it to PDF with headless Chrome `--print-to-pdf`) and look at the rendered pages.
- [ ] **Step 5:** Checkpoint, no commit.

### Task 10: The screen opens on Projects

**Files:** Modify `js/weekly-report-admin.js`, `css/weekly-report.css`, `tests/weekly-report.test.js` (fence section)

- The segment starts on **Projects**. The Projects tabs are **All projects** (count) and **With work** (count); **All projects** is the default. Search reads "Search project".
- Card: `title` = name; `sub` = system label; `meta` = `'5 submissions · 3 workers · 18 photos'`, or **No work submitted this week**. When a Day filter is set, it reads **No work submitted on this day**. A hidden project gets the chip `{ text: 'Hidden from workers', tone: 'none' }`.
- **Pop-up, with work**: the same structure as the print. A Work done list carries photo ranges from `wrNumberPhotos`, followed by a photo grid three across with `#n` badges, signed on open. **Print** passes the Day filter.
- **Pop-up, empty**: "No work submitted this week" (or "on this day") and no Print button. When hidden, add: "Workers cannot pick this site at Time In while it is hidden. Show it in Attendance → Sites & schedule."
- **Batch signing**: the module's signer uses `storage.from('attendance').createSignedUrls(paths, 3600)` in chunks of 50, at most 2 chunks in flight, keeping the per-path cache and the "dropped when the pop-up closed" rule. A path missing from the result, or carrying an error, signs as `null`, which shows **Photo unavailable**. The print uses the same signer.
- Employees keeps working as before; only its position as the default changes.

- [ ] **Step 1: Failing fence tests:**
  - `Weekly reports opens on Projects`: the module state initialises the segment to `'projects'`.
  - `signing is batched`: the source contains `createSignedUrls(`, and no longer calls `createSignedUrl(` per photo.
  - `hidden projects explain themselves`: the source contains `Hidden from workers` and `Sites & schedule`.
  - `the rpc names are still exactly the three`.
- [ ] **Step 2:** `node tests/weekly-report.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. Reuse the print's look for the pop-up where it fits (CSS classes in `css/weekly-report.css`), and keep the 400 px layout working.
- [ ] **Step 4:** `node tests/weekly-report.test.js && node --check js/weekly-report-admin.js`, then the full `npm test`. Expected: all pass.
- [ ] **Step 5:** Checkpoint, no commit.

### Task 11: Verification and hand-off

- [ ] `npm test` exits 0, and `node supabase/tests/weekly_reports.pglite.mjs` passes.
- [ ] **Stop for the user's approval to apply 0121.** After they apply it: BLOCK 18 live, plus an owner smoke test that `projects` lists 11 non-completed sites (as of 23 Nov 2026), including De Leon Residence with `hidden: true`.
- [ ] Browser check by the user: Weekly reports opens on Projects; De Leon Residence is listed with **Hidden from workers** and the explanation; a daily and a weekly print of a project with work (a WorkMate 1030 test Time Out) match the Nov 20 layout.
