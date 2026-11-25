# WorkMate Time Out: work photos and a required note — design

**Date:** 22 Nov 2026 · **Status:** approved in conversation (owner, 22 Nov 2026), awaiting doc approval
**Repos:** `Dacs WorkMate` (Flutter app) and `Dacs Web` (migration, office Attendance screen)

## Why

At Time Out, the owner wants every worker to **show and explain the work they did that day**. Today Time Out
takes one face photo and the note is "Optional — you can skip this", so a finished day carries no evidence of
the work itself.

## What changes (owner decisions, 22 Nov 2026)

- **Time Out takes no face photo.** It takes **at least 3 photos of the work** instead.
- **The Time Out note is required**: the worker must type what they did.
- **Time In is unchanged**: face photo, optional note, chips, four steps.
- Storage approach **A** (picked by the owner): the **first work photo goes in the existing
  `timeout_photo_path`**, the others in a **new list column** beside it.

Calls the owner accepted when the flow was played back ("no wrong or missing"):

- **Back camera by default** for Time Out; the camera-switch button stays.
- **3 to 6 photos.** Six is the cap, to keep uploads light on mobile data.
- **No quick-tap chips at Time Out.** The note must be **at least 15 characters** after trimming (any
  language, so Tagalog and Taglish count).
- **The Time Out time is the last photo's shutter time.** That's the same rule as today: the shutter, never
  the upload.
- **Offline works as today.** The photos and note wait on the phone and send when there's signal.
- **The office Attendance screen and the phone's History show every work photo.**
- **The server checks the rule whenever the app sends work photos.** It does not demand them otherwise (see
  Constraints).

## Goals / non-goals / anti-goals

- **Goal:** no new WorkMate Time Out can be submitted without 3+ work photos and a typed explanation.
- **Non-goal:** changing Time In, the reward, payroll, geofence or trusted-time rules. Attendance stays outside
  the money model.
- **Non-goal:** gallery uploads. Photos come from the camera only, stamped like today.
- **Anti-goal:** a worker who **cannot Time Out**, whether because of the old Attendance app, a phone still on an
  older WorkMate, or a Time Out saved offline before the update and sent after it. Each of those must still
  record exactly as it does today.
- **Anti-goal:** office screens showing WorkMate days as "Recorded without both photos". Approach A prevents
  this because `timeout_photo_path` is still filled.

## Constraints

- **The old DACS Attendance app cannot be updated** (CLAUDE.md, 0111). It calls `attendance_time_out` with
  today's named arguments and must keep working unchanged.
- **The version header describes the app sending the request, not the app that captured the Time Out.** A Time
  Out queued offline on 1029 and sent after updating to 1030 carries no work photos. So the server cannot use
  "WorkMate ≥ 1030" to demand them, or that queued day would be refused for good. The rule is therefore
  **"if work photos are sent, they must meet the rule"**, and the app is what guarantees they are always sent
  for a Time Out captured on 1030+.
- **PostgREST resolves RPCs by named arguments.** The old 13-argument `attendance_time_out` must be **dropped**
  before the 14-argument one is created, or calls become ambiguous (0078 did the same).
- **Release order:** migration 0119 applied and verified live **before** WorkMate 1030 is published. A 1030 Time
  Out sends the new argument and would fail against the old function. Publishing 1030 raises
  `min_workmate_version` as usual, which pushes everyone to update.
- **Next migration number: 0119.** 0118 exists in the working tree, not yet applied.

## Approaches considered

| | How | Trade-off |
|---|---|---|
| **A (picked)** | First work photo in `timeout_photo_path`, the rest in new `timeout_extra_photo_paths text[]` | Every existing reader (office thumbs, "Both photos received", phone History, old app) keeps working. Photos sit in two columns. |
| B | All work photos in a new list; `timeout_photo_path` empty for WorkMate | Tidier data, but every reader must change. A missed one shows "Recorded without both photos". |
| C | New `attendance_photos` table, one row per photo | Most flexible. More RLS and the most work, which isn't needed now. |

## The design

### Server — migration `0119_attendance_timeout_work_photos.sql` (Dacs Web)

- `alter table attendance_records add column if not exists timeout_extra_photo_paths text[]` (null = none; every
  existing row and every old-app Time Out stays null).
- Drop the 13-argument `attendance_time_out`, then recreate it **identical to 0078** plus one trailing argument
  `p_extra_photo_paths text[] default null`. Re-issue the revoke / grant on the new signature.
- When `p_extra_photo_paths` is **not null**, before the update:
  - `cardinality` must be 2–5 (3–6 photos with `p_photo_path`) → else `WORK_PHOTOS_REQUIRED` /
    `WORK_PHOTOS_TOO_MANY`;
  - `p_photo_path` and every extra path start with `auth.uid()::text || '/'`, end `.jpg`, with no duplicates
    and none equal to `p_photo_path` → else `WORK_PHOTO_PATH_INVALID`;
  - `char_length(btrim(p_description)) >= 15` → else `WORK_NOTE_REQUIRED`.
- The update also sets `timeout_extra_photo_paths = p_extra_photo_paths`. When `p_extra_photo_paths` is null, the
  behaviour is byte-for-byte today's.
- The idempotent replay (`timeout_event_id` already recorded) still returns the stored row first, before any new
  check.
- Live checks appended to `supabase/tests/attendance_checks.sql`. Column added to `docs/DATABASE_SCHEMA.md`.

### WorkMate app (version 0.19.0+1030)

**Shared rule constants** (one place, e.g. `attendance/domain/work_photos.dart`): `minWorkPhotos = 3`,
`maxWorkPhotos = 6`, `minWorkNoteChars = 15`. These are the same numbers the server uses.

**Flow (`time_flow_controller.dart`, `time_flow_screen.dart`, `camera_step.dart`).** Time Out runs 3 steps:

1. **Which project today?** Unchanged.
2. **Take photos of your work** ("At least 3 photos"). The camera opens on the **back** lens and stays open after
   each shot. Below the preview is a strip of thumbnails, the count ("2 of 3 taken — take 1 more"), and
   **NEXT**, which stays disabled below 3. The shutter is disabled at 6 ("Maximum 6 photos"). Tapping a
   thumbnail opens it large with **Delete**. There is no separate "Is this photo clear?" step for Time Out.
   Each photo keeps its own shutter time, trusted time and `mirrored` flag.
3. **What did you do today?** ("Required — explain the work you did"). It has a text box with no chips, the hint
   "e.g. Laid hollow blocks, 2F wall", and **SUBMIT TIME OUT**, which stays disabled until the trimmed note has
   15+ characters. A short line under the box says how many more characters are needed.

The header reads "Step N of 3" for Time Out and "Step N of 4" for Time In. **Back** from step 3 returns to the
photos with them intact. Back from step 2 returns to the project step **with the photos kept**: the stamp is
burned in at submit with the project chosen then. Leaving the flow deletes every unsent photo, as today.

**The request.** `capturedAt` / `trustedAt` = the **last** photo's. `photoPath` = the first photo.
`SubmissionRequest` gains `extraPhotoPaths` (default empty) with matching shutter times for stamping. The location
is still read at SUBMIT.

**Preparing (`attendance_repository.dart`).** Each photo goes through `device.preparePhoto` with **its own**
caption time and mirror flag. They are stored as `<eventId>.jpg`, `<eventId>-2.jpg`, and so on, in the
app-private folder, before the row is queued.

**Queue (`attendance_db.dart`, `submission_request.dart`).** The DB version goes from 1 to 2.
`onUpgrade` runs `alter table pending_submission add column extra_photo_local_paths text` (a JSON array, null for
none). Rows queued by 1029 read as "no extras" and send exactly as today.

**Sending (`attendance_remote.dart`, `submission_sync.dart`).** The first photo goes to today's path
`<uid>/<date>/out-<eventId>.jpg`. The extras go to `<uid>/<date>/out-<eventId>-<n>.jpg` (n = 2…), each uploaded
with upsert. Then the RPC is called. `p_extra_photo_paths` is sent **only when there are extras**. If **any** of
the row's photo files is missing, the row is marked `PHOTO_MISSING`, as today. Every photo file is deleted after
success, after drop-and-reconcile, and when a refused row is dismissed.

**Errors (`attendance_failure.dart`, `attendance_copy.dart`).** The four new server codes are permanent refusals
with plain messages. The app enforces the same rules, so they appear only if something is broken.

**Showing.** `AttendanceRecord` reads `timeout_extra_photo_paths`. The History day sheet shows the Time Out photo
large plus the other work photos in a row; tapping one opens the existing photo viewer. The confirmation screen
adds a "Photos — 3 work photos" row. `cached_record` is unchanged: offline History has no photos today either.

### Office — `js/attendance-admin.js` (Dacs Web)

- Add `timeout_extra_photo_paths` to the select at line ~797.
- In the record pop-up, the Time Out side shows **all** work photos (signed links, as `attSignedPhoto` does now),
  titled **"Work photos (N)"** when extras exist. Old records and old-app days look exactly as they do now.
- "Both photos received" and the card thumbnails need no change, because `timeout_photo_path` is filled.
- Only `admin.html` shows attendance. No portal HTML is involved.

## Tests

- **WorkMate:** controller (step counts, NEXT / SUBMIT gating, 3/6 limits, Back keeps photos, abandon deletes
  all), screen, repository (each photo prepared with its own time), DB v1→v2 upgrade with an old row, remote
  (`p_extra_photo_paths` sent only with extras; paths), sync (missing extra → `PHOTO_MISSING`; all files
  deleted), history day sheet.
- **Dacs Web:** `tests/attendance.test.js` for the pop-up's work photos. A PGlite test of the new RPC: old-style
  call unchanged; 1/2 photos refused; 7 refused; bad paths refused; short note refused; replay returns the stored
  row. **No attendance PGlite harness exists yet.** This test is the first, so it has to load the attendance
  migration chain (0050 → 0082) on the shared stubs, and it is appended to `test:sql` in `package.json`, which
  already holds the user's uncommitted edits. Run `npm test`, `npm run test:sql` and `flutter test`.

## Left to the builder

The exact widget layout of the thumbnail strip and the large-view sheet, the copy for the four error messages,
and the test file names.
