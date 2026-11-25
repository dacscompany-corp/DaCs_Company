# WorkMate Time Out: Work Photos and a Required Note — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WorkMate's Time Out takes 3–6 back-camera work photos instead of a face photo, plus a required typed note (15+ characters). The server and the office Attendance screen store and show every photo.

**Architecture:** The first work photo keeps using `attendance_records.timeout_photo_path`; the others go in the new
`timeout_extra_photo_paths text[]`, sent through a new trailing RPC argument `p_extra_photo_paths`. The server
checks the rule only when that argument is sent, so the old Attendance app and Time Outs queued before the update
behave exactly as today. On the phone, the extra photos travel through the same offline queue as the main one.

**Tech Stack:** PostgreSQL / Supabase (migration, PGlite tests), vanilla JS (`js/attendance-admin.js`), Flutter/Dart (WorkMate, sqflite queue, `camera` package).

**Spec:** `docs/superpowers/specs/2026-11-22-workmate-timeout-work-photos-design.md`

## Global Constraints

- Time In is unchanged: face photo, optional note, chips, "Step N of 4".
- Photos: **min 3, max 6** (`minWorkPhotos = 3`, `maxWorkPhotos = 6`). Note: **15+ characters after trimming** (`minWorkNoteChars = 15`). Server: extras `cardinality` 2–5.
- The Time Out time (`capturedAt` / `trustedAt`) is the **last** photo's shutter.
- Server error codes, verbatim: `WORK_PHOTOS_REQUIRED`, `WORK_PHOTOS_TOO_MANY`, `WORK_PHOTO_PATH_INVALID`, `WORK_NOTE_REQUIRED`.
- Storage paths: first photo `<uid>/<date>/out-<eventId>.jpg` (today's), extras `<uid>/<date>/out-<eventId>-<n>.jpg`, n = 2, 3, ….
- Migration number **0119**. WorkMate version **0.19.0+1030**.
- **The user commits by hand.** No task commits. Each task ends at a green checkpoint, and you list the files you changed.
- **Never run `npm run build`.** Don't touch the user's unrelated uncommitted edits (the 0117/0118 receipt work, `package.json`'s existing lines).
- Applying 0119 live, building the release APK beyond the debug check, and publishing are **separate approvals** from the user. They are not part of these tasks.

## Review Focus

1. **A Time Out queued offline on 1029 and sent after updating to 1030** must send no `p_extra_photo_paths` and be recorded as today → Task 3 (DB v1→v2 with an old row), Task 4 (params without extras), Task 1 (old-style call).
2. **A note of only spaces or newlines** ("               ") must not count → Task 5 (`noteReady` false), Task 1 (`WORK_NOTE_REQUIRED`).
3. **Deleting a photo after reaching 3** (Back from the note, delete one) must disable NEXT, and `submit()` must refuse under 3 even if called → Task 5.
4. **A retry after the 3rd upload failed** must re-upload to the same paths (upsert) and record once → Task 4 (deterministic paths, all files kept until success).
5. **Leaving the flow mid-way** must delete every unsent work photo; **a missing extra file** must mark the row `PHOTO_MISSING` → Task 5 (abandon), Task 4 (sync).

---

### Task 1: Migration 0119 — store and check work photos (Dacs Web)

**Files:**
- Create: `supabase/migrations/0119_attendance_timeout_work_photos.sql`
- Create: `supabase/tests/attendance_work_photos.pglite.mjs`
- Modify: `package.json` (append `&& node supabase/tests/attendance_work_photos.pglite.mjs` to the end of `test:sql`, and change nothing else)
- Modify: `supabase/tests/attendance_checks.sql` (append a 0119 block), `supabase/migrations/README.md` (add 0119 to the order), `docs/DATABASE_SCHEMA.md` (the new column on `attendance_records`)

**Interfaces:**
- Produces: `attendance_records.timeout_extra_photo_paths text[]` (null = none) and `attendance_time_out(p_project_system text, p_project_id uuid, p_captured_at timestamptz, p_photo_path text, p_event_id uuid, p_description text default null, p_lat double precision default null, p_lng double precision default null, p_accuracy_m double precision default null, p_was_offline boolean default false, p_is_mock boolean default false, p_permission_denied boolean default false, p_trusted_at timestamptz default null, p_extra_photo_paths text[] default null) returns attendance_records`. This is the only overload.

- [ ] **Step 0: Check for drift (read-only).** The live DB has drifted from the migrations before. Read
  `select pg_get_functiondef('attendance_time_out(text,uuid,timestamptz,text,uuid,text,double precision,double precision,double precision,boolean,boolean,boolean,timestamptz)'::regprocedure);`
  on live (Supabase MCP `execute_sql`, a read only) and compare the body with 0078 lines 275–423, ignoring
  whitespace and CR. Also confirm that only that one overload exists. **If they differ, stop and report**: 0119
  must be built from the live body.

- [ ] **Step 1: Write the failing PGlite test** `supabase/tests/attendance_work_photos.pglite.mjs`. Follow the
  `ll_base.mjs` pattern: the `LL_PRE`-style auth stub (`auth.uid()` reads `test.uid`), a minimal `profiles`, and a
  minimal `attendance_records`. That table needs `id, owner_id, worker_id, work_date, session_seq, status,
  timein_at`, every `timeout_*` column that 0078's UPDATE sets, `total_minutes`, a `timeout_event_id` unique index
  and `timeout_extra_photo_paths` **absent** (0119 adds it). Stub the helpers 0078 calls:
  `attendance_project_name` → `'Site A'`, `attendance_check_location` → one row (`status 'verified'`, nulls),
  `attendance_sane_trusted_at(t)` → `t`, `attendance_location_refuses` → `false`,
  `attendance_request_app_version()` → `1030`. Then create a 13-argument `attendance_time_out` stub with 0078's
  exact signature, and run 0119 **verbatim**. Seed a worker `W` (role `worker`, active, `owner_id` set) with a
  `working` record timed in at 07:00 Manila. Checks, each in its own savepoint:
  1. Exactly one `attendance_time_out` exists in `pg_proc`, with 14 arguments.
  2. An **old-style call** (no `p_extra_photo_paths`, note `null`) succeeds. The row is `complete`,
     `timeout_extra_photo_paths is null` and `timeout_description is null`.
  3. 2 extras + a 20-character note → succeeds, and stores the extras array in order.
  4. 5 extras succeed. 1 extra raises `WORK_PHOTOS_REQUIRED`. `'{}'` raises `WORK_PHOTOS_REQUIRED`. 6 extras raise
     `WORK_PHOTOS_TOO_MANY`.
  5. These raise `WORK_PHOTO_PATH_INVALID`: an extra under another uid's folder; one ending `.png`; one containing
     `..`; one equal to `p_photo_path`; two identical extras; and `p_photo_path` null with extras sent.
  6. With 2 extras: a note `'Laid blocks'` (11 characters) raises `WORK_NOTE_REQUIRED`; so do 20 spaces and
     `E'\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nabc'`.
  7. A replay with the same `p_event_id` and **no extras** returns the stored row, without raising
     `WORK_PHOTOS_REQUIRED`.

- [ ] **Step 2: Run it and see it fail**

  Run: `node supabase/tests/attendance_work_photos.pglite.mjs`
  Expected: FAIL. `0119_attendance_timeout_work_photos.sql` doesn't exist yet (ENOENT).

- [ ] **Step 3: Write `0119_attendance_timeout_work_photos.sql`.** The header explains the why: the rule is
  checked only when the app sends work photos, because the old app and pre-1030 queued rows send none. It also
  notes that the migration is outside the money model and idempotent. Then:
  - `alter table attendance_records add column if not exists timeout_extra_photo_paths text[];` plus a `comment on column`.
  - `drop function if exists attendance_time_out(text, uuid, timestamptz, text, uuid, text, double precision, double precision, double precision, boolean, boolean, boolean, timestamptz);`
  - `create or replace function attendance_time_out(...)` as **0078 lines 275–423, copied verbatim**, with exactly
    three edits: the trailing argument `p_extra_photo_paths text[] default null -- 0119`; the block below,
    inserted **immediately after the replay block** (`select * into v_row … where timeout_event_id = p_event_id;
    if found … end if;`); and `timeout_extra_photo_paths = p_extra_photo_paths,` added to the UPDATE.

    ```sql
      -- 0119: work photos. Checked ONLY when the app sends them (see header).
      if p_extra_photo_paths is not null then
        if cardinality(p_extra_photo_paths) < 2 then
          raise exception 'WORK_PHOTOS_REQUIRED' using errcode = 'P0001';
        end if;
        if cardinality(p_extra_photo_paths) > 5 then
          raise exception 'WORK_PHOTOS_TOO_MANY' using errcode = 'P0001';
        end if;
        if p_photo_path is null
           or exists (select 1 from unnest(array_prepend(p_photo_path, p_extra_photo_paths)) as x(p)
                       where x.p is null
                          or left(x.p, length(v_uid::text) + 1) <> v_uid::text || '/'
                          or right(x.p, 4) <> '.jpg'
                          or strpos(x.p, '..') > 0)
           or (select count(distinct x.p) from unnest(array_prepend(p_photo_path, p_extra_photo_paths)) as x(p))
              <> cardinality(p_extra_photo_paths) + 1 then
          raise exception 'WORK_PHOTO_PATH_INVALID' using errcode = 'P0001';
        end if;
        if char_length(btrim(coalesce(p_description, ''), E' \t\r\n')) < 15 then
          raise exception 'WORK_NOTE_REQUIRED' using errcode = 'P0001';
        end if;
      end if;
    ```
  - `revoke all … from public;` then `grant execute … to authenticated;` on the **14-argument** signature.

- [ ] **Step 4: Run it and see it pass**

  Run: `node supabase/tests/attendance_work_photos.pglite.mjs`
  Expected: every check prints ok, exit 0.

- [ ] **Step 5: Finish the legs.** Append a `-- 0119` block to `supabase/tests/attendance_checks.sql`. It
  asserts one `attendance_time_out` overload with `pronargs = 14`, and that
  `information_schema.columns` has `timeout_extra_photo_paths` with `data_type = 'ARRAY'`. It uses the file's
  existing pass/fail style and is read-only. Then add 0119 to `supabase/migrations/README.md`, add the column
  (one line, why + "null = none / old app") to `docs/DATABASE_SCHEMA.md`, and append the test to `test:sql`.

- [ ] **Step 6: Checkpoint**

  Run: `npm run test:sql` then `npm test`
  Expected: both exit 0, and `tests/attendance.test.js` is unchanged (its 0072 guard is about 0072 only).

---

### Task 2: Office pop-up shows every work photo (Dacs Web)

**Files:**
- Modify: `js/attendance-admin.js` (`attRenderWorker` around lines 1832–1836, the `attHalf(` call at ~1934, and `function attHalf` at ~2020)
- Modify: `css/attendance-admin.css` (next to `.att-photo-frame`, ~line 475)
- Test: `tests/attendance.test.js` (new section)

**Interfaces:**
- Consumes: `timeout_extra_photo_paths` from Task 1. The pop-up already reads `select('*')` (line ~1806), so **no select change**. The card list at ~797 stays as it is.
- Produces: `attHalf(label, short, tone, icon, at, project, description, photoUrl, photoPath, extras = [])`, where `extras` is `[{ url: string|null, path: string }]`.

- [ ] **Step 1: Write the failing tests** in a new section `'Work photos (0119)'`. Extract `attHalf` with
  `slice(src, 'function attHalf(', '// ── A7', 'attendance-admin.js')` and
  `evalWith(…, { attEsc: <html-escape>, attTime: () => '5:30 PM' }, ['attHalf'])`.
  - `test('no extras: the half looks exactly as before')`: `attHalf(…, 'u0', 'p0')` contains no `Work photos`.
  - `test('extras: titled with the count, including the first photo')`: with `extras = [{url:'u1',path:'p1'},{url:'u2',path:'p2'}]` it contains `Work photos (3)`, `src="u1"`, `src="u2"`, and two `target="_blank"` links inside `att-work-strip`.
  - `test('an extra that could not be signed says so')`: `extras = [{url:null,path:'p1'}]` contains `Photo unavailable` inside `att-work-strip`.
  - `test('the pop-up signs the extra photos')`: `slice(src, 'async function attRenderWorker(', 'function attHalf(')` contains `timeout_extra_photo_paths` and `attSignedPhoto`.

- [ ] **Step 2: Run them and see them fail**

  Run: `node tests/attendance.test.js`
  Expected: the 3 extras tests FAIL (no `Work photos`, no `att-work-strip`). The "no extras" test passes.

- [ ] **Step 3: Implement.** In `attRenderWorker`, sign
  `(Array.isArray(r.timeout_extra_photo_paths) ? r.timeout_extra_photo_paths : [])` with `attSignedPhoto` in
  the same `Promise.all` round as `inUrl` / `outUrl`. Pass `[{url, path}]` as the 10th argument of the Time Out
  `attHalf` only. In `attHalf`, when `extras.length > 0`, render this after `att-photo-frame`: a block with
  `<div class="att-fact-label">Work photos (${extras.length + 1})</div>` and
  `<div class="att-work-strip">` containing one `<a target="_blank" rel="noopener"><img class="att-work-thumb"
  alt="Work photo N"></a>` per signed extra. An unsigned extra renders `<div class="att-work-thumb
  att-photo--missing">Photo unavailable</div>`. Every value goes through `attEsc`. CSS: `.att-work-strip` is a
  wrapping flex row with a gap, and `.att-work-thumb` is a 72px square with `object-fit: cover` and the frame's
  radius.

- [ ] **Step 4: Run them and see them pass**

  Run: `node tests/attendance.test.js`
  Expected: all ok, exit 0.

- [ ] **Step 5: Checkpoint**

  Run: `npm test` and `node --check js/attendance-admin.js`
  Expected: exit 0. In the browser (admin.html, owner), an old record's pop-up looks unchanged.

---

### Task 3: The phone stores extra photos with a queued Time Out (WorkMate)

**Files:**
- Modify: `lib/attendance/data/submission_request.dart`, `lib/attendance/data/attendance_db.dart`, `lib/attendance/data/attendance_repository.dart`, `lib/attendance/domain/work_date.dart`
- Test: `test/attendance/data/attendance_db_test.dart`, `test/attendance/data/attendance_repository_test.dart`, `test/attendance/domain/work_date_test.dart`

**Interfaces:**
- Produces:
  - `class WorkPhoto { const WorkPhoto({required String path, required DateTime takenAt, bool mirrored = false}); }` in `submission_request.dart`.
  - `SubmissionRequest` gains `DateTime? photoTakenAt` (the caption time of `photoPath`; null means `capturedAt`) and `List<WorkPhoto> extraPhotos` (default `const []`). Both are optional constructor parameters, so every existing call compiles.
  - `SubmissionRequest withPhoto(String path, {required bool wasOffline, List<String> extraPaths = const []})`. The extras keep their `takenAt` and get `mirrored: false` (already prepared).
  - `PendingSubmission.extraPhotoLocalPaths` (`List<String>`, `const []` when none) and `List<String> get allPhotoLocalPaths` (main first). Map key `extra_photo_local_paths`: a JSON array string, or `null` when empty.
  - `String workPhotoPath({required String workerId, required WorkDate workDate, required String eventId, required int index})` → `'$workerId/$workDate/${TimeDirection.timeOut.slug}-$eventId-$index.jpg'`.

- [ ] **Step 1: Write the failing tests.**
  - `work_date_test`: `workPhotoPath(workerId:'w', workDate: WorkDate.of(<Manila 19 Aug>), eventId:'e', index:2)` == `'w/2026-08-19/out-e-2.jpg'`.
  - `attendance_db_test`: `test('a v1 queue upgrades to v2 and its old Time Out still reads, with no extras')`. Open a v1 database with the old `create table pending_submission` (copy the current DDL into the test), insert one row, reopen through `AttendanceDb.open`, and expect `extraPhotoLocalPaths` isEmpty and `allPhotoLocalPaths == [row.photoLocalPath]`. Also `test('extras survive the round trip, in order')`.
  - `attendance_repository_test`: `test('each work photo is prepared with its own time, and queued in order')`. A request with `photoTakenAt` T1, `capturedAt` T3, and two `extraPhotos` (T2, T3): a recording `FakeDevice` sees 3 `preparePhoto` calls, with targets `<dir>/<eventId>.jpg`, `<eventId>-2.jpg`, `<eventId>-3.jpg` and captions `photoOverlayCaption(name, T1/T2/T3)`. The pending row's `extraPhotoLocalPaths` holds the last two targets. Also: `test('dismissing a refused Time Out deletes every photo')`.

- [ ] **Step 2: Run them and see them fail**

  Run: `flutter test test/attendance/data test/attendance/domain/work_date_test.dart`
  Expected: compile errors (`WorkPhoto`, `workPhotoPath`, `extraPhotoLocalPaths` undefined).

- [ ] **Step 3: Implement.**
  - `AttendanceDb`: `version: 2`, add `onUpgrade` (`if (from < 2) alter table pending_submission add column extra_photo_local_paths text`), and put the column in `_create` too.
  - `PendingSubmission`: `fromRequest` / `fromMap` / `toMap` / `toRequest` carry the extras (`toRequest` → `WorkPhoto(path: p, takenAt: capturedAt)`).
  - `AttendanceRepository.submit`: prepare the main photo with `caption: photoOverlayCaption(projectName, r.photoTakenAt ?? r.capturedAt)`, then each extra `i` (n = i + 2) to `'<dir>/<eventId>-<n>.jpg'` with its own `takenAt` and `mirror: extra.mirrored`, then `r.withPhoto(prepared, wasOffline: …, extraPaths: [...])`.
  - `dismissRefused` deletes every path in `allPhotoLocalPaths`.

- [ ] **Step 4: Run them and see them pass**

  Run: `flutter test test/attendance/data test/attendance/domain`
  Expected: all pass.

- [ ] **Step 5: Checkpoint.** `flutter analyze` is clean, and `flutter test` passes in full.

---

### Task 4: Sending the extras, and the new refusals (WorkMate)

**Files:**
- Modify: `lib/attendance/data/attendance_remote.dart`, `lib/attendance/sync/submission_sync.dart`, `lib/attendance/domain/attendance_failure.dart`, `lib/attendance/domain/submission_queue.dart`, `lib/attendance/ui/attendance_copy.dart`
- Test: `test/attendance/data/attendance_remote_test.dart`, `test/attendance/sync/submission_sync_test.dart`, `test/attendance/domain/attendance_failure_test.dart`, `test/attendance/domain/submission_queue_test.dart`

**Interfaces:**
- Consumes: `SubmissionRequest.extraPhotos`, `PendingSubmission.allPhotoLocalPaths`, and `workPhotoPath` (Task 3).
- Produces: `Map<String, dynamic> rpcParams(SubmissionRequest r, String photoPath, {List<String> extraPaths = const []})`, which adds `'p_extra_photo_paths': extraPaths` **only when non-empty**. Also `AttendanceFailure.workProofRefused`.

- [ ] **Step 1: Write the failing tests.**
  - remote: `test('no extras: the RPC arguments are exactly today's')`. `rpcParams(r, 'p')` has no key `p_extra_photo_paths`. And `test('extras are sent in order')`: `rpcParams(r, 'p', extraPaths: ['a','b'])['p_extra_photo_paths'] == ['a','b']`.
  - failure: each of `'WORK_PHOTOS_REQUIRED'`, `'WORK_PHOTOS_TOO_MANY'`, `'WORK_PHOTO_PATH_INVALID'` and `'WORK_NOTE_REQUIRED'` in an exception's text → `AttendanceFailure.workProofRefused`. `outcomeFor(workProofRefused) == QueueOutcome.failPermanently`. `worthRetrying(workProofRefused)` is false.
  - sync: `test('a missing extra photo marks the row PHOTO_MISSING and sends nothing')`. `test('after success every photo file is deleted')`. `test('a retryable failure keeps every photo file')`.

- [ ] **Step 2: Run them and see them fail**

  Run: `flutter test test/attendance/data/attendance_remote_test.dart test/attendance/sync test/attendance/domain`
  Expected: compile errors (`workProofRefused`, the `extraPaths` parameter).

- [ ] **Step 3: Implement.**
  - `SupabaseAttendanceRemote.submit`: upload the main photo exactly as today. Then upload each extra `i` to `workPhotoPath(…, index: i + 2)` with the same `FileOptions(upsert: true, contentType: 'image/jpeg')` and `_uploadTimeout`, then the RPC with `rpcParams(r, path, extraPaths: [...])`.
  - `submission_sync._send`: check that every file in `row.allPhotoLocalPaths` exists (else `PHOTO_MISSING`), and `_discard` all of them wherever it discards one today.
  - Add `workProofRefused` to the enum, map the 4 codes in `_byCode`, put it in the `failPermanently` arm, and make it `false` in `worthRetrying`.
  - Copy: `Bilingual('The photos or note for this Time Out did not reach the office correctly. Tell the office.', 'Hindi naipadala nang tama ang mga litrato o note ng Time Out na ito. Sabihan ang office.')`.

- [ ] **Step 4: Run them and see them pass**

  Run: `flutter test test/attendance`
  Expected: all pass.

- [ ] **Step 5: Checkpoint.** `flutter analyze` is clean, and `flutter test` passes in full.

---

### Task 5: The Time Out flow keeps 3–6 work photos and requires the note (WorkMate controller)

**Files:**
- Create: `lib/attendance/domain/work_photos.dart`
- Modify: `lib/attendance/flow/time_flow_controller.dart`
- Test: `test/attendance/flow/time_flow_controller_test.dart`, `test/attendance/domain/work_photos_test.dart`

**Interfaces:**
- Consumes: `WorkPhoto` and the `SubmissionRequest` fields (Task 3).
- Produces:
  - `work_photos.dart`: `const minWorkPhotos = 3; const maxWorkPhotos = 6; const minWorkNoteChars = 15;` and `int workNoteCharsMissing(String note)` = `max(0, minWorkNoteChars - note.trim().runes.length)`.
  - On `TimeFlowController`: `bool get takesWorkPhotos` (direction is timeOut), `List<CapturedPhoto> get workPhotos` (unmodifiable), `bool get canAddWorkPhoto`, `bool get workPhotosReady`, `void removeWorkPhoto(int index)`, `void confirmWorkPhotos()`, `bool get noteReady` (always true for Time In), `int get noteCharsMissing`, `int get totalSteps` (4 / 3), and `CapturedPhoto? get shutterPhoto` (Time In: `photo`; Time Out: the last work photo).

- [ ] **Step 1: Write the failing tests.** Add a helper `atWorkPhotos(n)`: a Time Out flow taken through project → `photoTaken` n times with shutters 10:00, 10:01, ….
  - `work_photos_test`: `workNoteCharsMissing('Laid blocks')` == 4. `workNoteCharsMissing(' ' * 20)` == 15. `workNoteCharsMissing('Laid hollow blocks')` == 0.
  - `test('Time Out: photos stay on the photo step and count up')`: after 2 photos, `step == takePhoto`, `workPhotosReady` false, `confirmWorkPhotos()` does nothing; after the 3rd, ready, then `confirmWorkPhotos()` → `describe`, `stepNumber == 3`, `totalSteps == 3`.
  - `test('a 7th photo is refused and its file deleted')`: at 6, `canAddWorkPhoto` is false, `photoTaken` leaves 6, and the 7th's temp file is gone.
  - `test('Back from the note keeps the photos; deleting one closes the gate')`: at describe, `back()` → `takePhoto` with 3 photos; `removeWorkPhoto(0)` deletes the file, leaves 2, and `workPhotosReady` is false.
  - `test('Back to the project step keeps the photos')`.
  - `test('the note gates SUBMIT')`: `setDescription('Laid blocks')` → `noteReady` false and `noteCharsMissing == 4`; spaces only → false; `'Laid hollow blocks, 2F'` → true. `submit()` with a short note submits nothing.
  - `test('submit sends the last shutter as the time and the first photo as the main one')`: `submitted.single` has `capturedAt` = 3rd shutter, `trustedAt` = 3rd photo's, `photoPath` = 1st, `photoTakenAt` = 1st shutter, and `extraPhotos.map(path)` = [2nd, 3rd].
  - `test('abandon deletes every work photo')`.
  - Time In regression: the existing tests stay unchanged and pass; `totalSteps == 4`.

- [ ] **Step 2: Run them and see them fail**

  Run: `flutter test test/attendance/flow/time_flow_controller_test.dart test/attendance/domain/work_photos_test.dart`
  Expected: compile errors (the new members).

- [ ] **Step 3: Implement in `time_flow_controller.dart`.**
  - `photoTaken`: for Time Out, if `canAddWorkPhoto`, append a `CapturedPhoto` and **stay** on `takePhoto`; otherwise delete the file.
  - `back()`: for Time Out, `describe → takePhoto` and `takePhoto → pickProject`, both keeping photos.
  - `stepNumber`: Time Out is pick 1 / photos 2 / describe 3.
  - `submit()` (Time Out): return unless `workPhotosReady && noteReady`; build the request as the last test states; pass `mirrorPhoto: workPhotos.first.mirrored`.
  - `abandon` discards all work photos. Time In paths are unchanged.

- [ ] **Step 4: Run them and see them pass**

  Run: `flutter test test/attendance/flow test/attendance/domain`
  Expected: all pass.

- [ ] **Step 5: Checkpoint.** `flutter analyze` is clean, and `flutter test` passes in full.

---

### Task 6: Time Out screens — work camera, photo strip, required note (WorkMate UI)

**Files:**
- Modify: `lib/attendance/flow/camera_step.dart`, `lib/attendance/flow/time_flow_screen.dart`
- Test: `test/attendance/flow/time_flow_screen_test.dart`

**Interfaces:**
- Consumes: Task 5's controller members.
- Produces: `CameraStepArgs` gains `bool workPhotos = false` and `bool canShoot = true`. When `workPhotos` is true, the real `CameraStep` opens the **back** lens if there is one, shows no oval, shows the hint `'Point the camera at your work'`, and re-enables the shutter after each `onTaken`. The shutter is enabled only when `canShoot`.

- [ ] **Step 1: Write the failing widget tests.** Rework `'Time Out says so on every screen'` and add a `toTimeOutNote(tester)` helper (3 fake shutters, then `work-photos-next`). The fake camera honours `a.canShoot`.
  - `testWidgets('Time Out asks for work photos, not a face')`: `'Take photos of your work'`, `'At least 3 photos'`, `'Step 2 of 3'`; after 1 shutter, `'1 of 3 taken — take 2 more'` and `work-photos-next` disabled; after 3, `'3 photos taken'` and enabled.
  - `testWidgets('at 6 photos the shutter stops')`: `'6 photos taken · Maximum 6 photos'`, and the fake camera received `canShoot == false`.
  - `testWidgets('tapping a photo opens it large and DELETE PHOTO removes it')`: tap `Key('work-photo-0')` → `'DELETE PHOTO'` → back to `'2 of 3 taken — take 1 more'`.
  - `testWidgets('the Time Out note is required and has no chips')`: `'What did you do today?'`, `'Required — explain the work you did'`, no `'Masonry'` chip, `'SUBMIT TIME OUT'` disabled, `'15 more characters needed'`; type `'Laid blocks'` → `'4 more characters needed'`; type `'Laid hollow blocks, 2F'` → the counter is gone and SUBMIT is enabled.
  - `testWidgets('Time Out confirmation lists the photos')`: after submit, `'Day complete!'`, `'Photos'`, `'3 work photos'` and `'Total hours'`.
  - Time In tests stay unchanged: `'Step 2 of 4'`, chips and the optional subtitle.

- [ ] **Step 2: Run them and see them fail**

  Run: `flutter test test/attendance/flow/time_flow_screen_test.dart`
  Expected: FAIL (the old single-photo Time Out screens).

- [ ] **Step 3: Implement.**
  - Titles are picked by direction. Time Out uses `takePhoto: ('Take photos of your work', 'At least 3 photos')` and `describe: ('What did you do today?', 'Required — explain the work you did')`.
  - `FlowHeader` shows `'Step N of ${c.totalSteps}'` and the bar `step / totalSteps`.
  - The Time Out photo step is a `Column[Expanded(cameraStep(args with workPhotos: true, canShoot: c.canAddWorkPhoto)), _WorkPhotoStrip]`. The strip has thumbnails `Key('work-photo-$i')` (via `CapturedPhotoView`), the count line, and a `FilledButton(key: Key('work-photos-next'), 'NEXT · WRITE WHAT YOU DID')` enabled when `c.workPhotosReady`. Count copy: `n < 3` → `'$n of 3 taken — take ${3 - n} more'`; `3 ≤ n < 6` → `'$n photos taken'`; `n == 6` → `'6 photos taken · Maximum 6 photos'`.
  - A thumbnail tap opens a dialog with a large `CapturedPhotoView`, `DELETE PHOTO` (→ `c.removeWorkPhoto(i)`) and `Close`.
  - Time Out describe: the thumbnail row shows `'${n} work photos'`; there are no chips; the `TextField(key: Key('note'), minLines: 3, maxLines: 5, hintText: 'e.g. Laid hollow blocks, 2F wall')` has the line `'${c.noteCharsMissing} more characters needed'` under it while `!c.noteReady`; submit is enabled when `!c.submitting && c.noteReady`.
  - `_Confirmation` uses `c.shutterPhoto!` for the time and date, and adds `('Photos', '${c.workPhotos.length} work photos', false)` for Time Out.
  - `camera_step.dart`: honour `workPhotos` / `canShoot` as described in Interfaces (set the starting `_lens` from `args.workPhotos`; reset `_capturing` after `onTaken` when `workPhotos`; hide the oval and swap the hint).

- [ ] **Step 4: Run them and see them pass**

  Run: `flutter test test/attendance/flow`
  Expected: all pass.

- [ ] **Step 5: Checkpoint.** `flutter analyze` is clean, and `flutter test` passes in full.

---

### Task 7: History shows the work photos; version 0.19.0+1030 (WorkMate)

**Files:**
- Modify: `lib/attendance/domain/attendance_record.dart`, `lib/attendance/history/day_sheet.dart`, `pubspec.yaml` (`version: 0.19.0+1030`)
- Test: `test/attendance/domain/attendance_record_test.dart`, `test/attendance/history/history_screen_test.dart` (or the day-sheet test next to it)

**Interfaces:**
- Consumes: `timeout_extra_photo_paths` (Task 1).
- Produces: `AttendanceRecord.timeOutExtraPhotoPaths` (`List<String>`, `const []` when null), read in `fromRow`, kept by `copyWith`; `columns` gains `,timeout_extra_photo_paths`.

- [ ] **Step 1: Write the failing tests.**
  - record: `fromRow({... 'timeout_extra_photo_paths': ['a','b']})` gives `['a','b']`; a null or absent value gives `[]`; `columns` contains `timeout_extra_photo_paths`; `copyWith(pending: true)` keeps the list.
  - day sheet: with extras `['x2','x3']`, `find.text('More work photos')` and `Key('day-work-photo-0')`, `Key('day-work-photo-1')` are present, and tapping one opens `PhotoViewer`. Without extras, `'More work photos'` is absent.

- [ ] **Step 2: Run them and see them fail**

  Run: `flutter test test/attendance/domain/attendance_record_test.dart test/attendance/history`
  Expected: compile error (`timeOutExtraPhotoPaths`).

- [ ] **Step 3: Implement.** Add the field. In `DaySheet`, when extras exist, put the label `'More work photos'` under the In/Out row, followed by a `Wrap` of small photo tiles (`Key('day-work-photo-$i')`) that reuse `_PhotoCard`'s link-and-viewer behaviour (the signed link is asked for when the sheet opens, and a tap opens `PhotoViewer` with the heading and `'Time Out · work photo ${i + 2}'`). Bump `pubspec.yaml`.

- [ ] **Step 4: Run them and see them pass**

  Run: `flutter test test/attendance`
  Expected: all pass.

- [ ] **Step 5: Final checkpoint (both repos).**

  Run in `Dacs WorkMate`: `flutter analyze` and `flutter test`. Expected: no issues, all pass.
  Run in `Dacs Web`: `npm test` and `npm run test:sql`. Expected: exit 0.
  Build: `flutter build apk --release` (**never** `--split-per-abi`), and copy it to
  `Documents\WorkMate releases\dacs-workmate-0.19.0-1030.apk`. Report the size (the bucket cap is 50 MB) and the
  SHA-256. Then list every changed file in both repos for the user to commit.

---

## Rollout (the user's approvals, in this order — not executor tasks)

1. The user applies **0119** live, then runs `supabase/tests/attendance_checks.sql`. The 0119 block must pass, and an old-app Time Out on a test account must still work.
2. Test on a phone with a **test worker account**: Time In → Time Out with 3 photos + note, online and in airplane mode; check the office pop-up and phone History.
3. Publish 1030 from the office publisher. That raises `min_workmate_version` to 1030.
4. Order matters: **1030 before 0119** would make every Time Out and the Today/History reads fail (the unknown column and argument). That's why step 1 comes first.
