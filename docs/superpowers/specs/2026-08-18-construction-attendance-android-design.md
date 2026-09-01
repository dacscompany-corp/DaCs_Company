# Construction Worker Attendance — Native Android App — Design

**Date:** 2026-08-18
**Status:** Design for review, not yet implemented
**Migration:** `0050_attendance.sql` (highest on disk is `0049`)
**New repo:** `Documents/Dacs Attendance` (Kotlin + Jetpack Compose)
**Source of truth for layout & flow:** Claude Design project `b059a7ff-b116-43fd-9637-04a28983cf89`
— *MVP terms application design*, file `Attendance App.dc.html`
**Source of truth for scope:** `MVP Terms and Scope — Construction Worker Attendance Application`

---

## 1. What this is

A **native Android app for construction workers to record their own attendance**, backed by the
existing DAC's Supabase project. A worker logs in with an admin-created account, accepts the Terms
once, then twice a day walks a four-step flow — pick project, take photo, check photo, add
description — to record Time In and Time Out. The system supplies the date and time; the worker
never types them.

The **admin side is not in the app.** Monitoring, worker management, project management and reports
are new sections inside the existing `admin.html`, because admins need a big screen for tables and
the account-creation machinery already lives there.

### What it is not

- **Not a PWA wrapper.** `Documents/Dacs Web/android/` already contains a Bubblewrap TWA for the
  *client portal* (`io.github.dacscompany_corp.twa`, versionCode 3, signed, notifications enabled).
  That app is a different product for a different audience and **is not touched by this work.**
- **Not a payroll feature.** See §2.
- **Not localized in the Android sense.** The UI is *simultaneously bilingual* — English label with
  a Tagalog line beneath it, both always visible. Tagalog strings do **not** go in `values-fil/`.
- **Not a geofence.** Location is recorded as corroborating metadata, never used to allow or block
  a Time In.

---

## 2. The isolation contract

> An attendance record **never** writes to `folders`, `projects`, `construction_projects`,
> `expenses`, `payroll`, `labor_contracts`, `invoices`, `payment_requests` or `boq_documents`, and
> **no money-model function ever reads it.**

Same rule as `reimbursements` (0041), the warranty retention fund (0043) and `quotations` (0045).
The reasoning is specific and worth stating, because "attendance hours" *look* like they belong in
payroll:

- DAC's labour is **pakyaw / in-house capped pay** (`labor_contracts.agreedAmount` drawn down by
  `payroll.contractId`). Hours are **not** the basis of pay. 9h45m of attendance is not 9h45m of
  wages, and the MVP doc's own example total includes the unpaid lunch break.
- `payroll.workerName` is **free text** and `labor_contracts` is **folder-scoped**. There is no
  existing link between a worker's *login account* and the money system, so no such link is being
  broken — one simply must not be invented here.
- Attendance has **no peso column**, so the staff amount-hiding rule (`_staff()` in
  `portal-app.compiled.js`) is not implicated. This is worth noting explicitly so nobody adds a
  rate field later "to make the report more useful".

Only `js/attendance-admin.js` (web) and the Android app may read or write these tables. If that
changes, the isolation rule in `CLAUDE.md` and `docs/ARCHITECTURE.md` has to be revisited **first**.

---

## 3. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| 1 | Worker-only Android app; admin stays in `admin.html` | Smallest native surface; admin tables want a big screen; `adminCreateUser` already exists on the web |
| 2 | **One record per worker per calendar day**, `session_seq` column reserved | Matches MVP §14/§18 exactly. Keying on `(worker_id, work_date, session_seq)` from day one makes split shifts a rule change later, not a data migration |
| 3 | **Offline-first** with trust markers | Sites lose signal; a worker who cannot time in at 07:45 will not retry. This is the main reason to go native |
| 4 | **Dedicated `attendance_projects` table** | The design's admin screen says *"Only a name is needed for the MVP"*. Keeps attendance out of both existing project id spaces (`folders.id` ≠ `construction_projects.id`) |
| 5 | **New sibling repo** `Documents/Dacs Attendance` | A Gradle build does not belong in a repo whose `CLAUDE.md` says "no build step" and whose CI syntax-checks plain JS |
| 6 | **Location captured silently, admin-only** | Photo alone does not prove location; adding the column later leaves history null. Never shown to the worker, never blocks an action |
| 7 | **Two Postgres RPCs**, not direct table writes | Idempotency is non-negotiable with an offline queue; the §14 status machine belongs next to the constraint backing it; total hours computed once so worker and admin cannot disagree |

---

## 4. Data model — `0050_attendance.sql`

Follows house convention: heavily commented header, `create table if not exists`, idempotent, safe
on the live DB and on a fresh one. `owner_id` carries the tenant so the existing
`can_access(p_owner)` helper gives owner **and** their staff access, while
`auth_role()` / `data_owner_id()` (0002) keep workers to their own rows.

### 4.1 `attendance_projects`

The list workers pick from. Deactivating hides it from the picker; **past records keep the name they
were saved with.**

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` identity PK | Displayed as `P-0004` in the admin table |
| `owner_id` | `uuid not null` → `auth.users(id)` | Tenant |
| `name` | `text not null` | Unique per owner, case-insensitive |
| `is_active` | `boolean not null default true` | `false` hides it from the worker picker only |
| `created_at`, `updated_at` | `timestamptz` | |

### 4.2 `attendance_records`

One row per worker per work date. `id` is a uuid so the client can reference a record it has not
yet synced.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK `default gen_random_uuid()` | |
| `owner_id` | `uuid not null` | Tenant, for `can_access()` |
| `worker_id` | `uuid not null` → `auth.users(id)` | |
| `worker_name`, `worker_position` | `text` | **Snapshot** at Time In — a later rename must not rewrite history |
| `work_date` | `date not null` | Derived **server-side** as `(captured_at at time zone 'Asia/Manila')::date` |
| `session_seq` | `smallint not null default 1` | Reserved for split shifts; always `1` in the MVP |
| `status` | `text not null` | `working` \| `complete` \| `abandoned`. **`no_record` is the absence of a row**, never a stored value |
| `timein_project_id` | `bigint` → `attendance_projects(id)` | |
| `timein_project_name` | `text not null` | Snapshot |
| `timein_at` | `timestamptz not null` | Worker's captured instant |
| `timein_photo_path` | `text not null` | Storage object path, not a URL |
| `timein_description` | `text` | Optional per the design |
| `timein_lat`, `timein_lng`, `timein_accuracy_m` | `double precision` | Nullable; admin-only |
| `timein_event_id` | `uuid not null unique` | Client-generated at tap. **The idempotency key** |
| `timein_was_offline` | `boolean not null default false` | |
| `timein_received_at` | `timestamptz not null default now()` | Server clock |
| `timeout_*` | same shape, all nullable | `timeout_event_id` separately `unique` |
| `total_minutes` | `integer` | Computed **server-side** on Time Out |
| `created_at`, `updated_at` | `timestamptz` | |

**Constraints**

```sql
unique (worker_id, work_date, session_seq)          -- decision #2
check (timeout_at is null or timeout_at >= timein_at) -- no negative durations
check (status <> 'complete' or timeout_at is not null)
```

**Indexes:** `(owner_id, work_date desc)` for the admin's daily view and reports;
`(worker_id, work_date desc)` for the worker's own history.

**Why `work_date` is a stored column and not derived at read time:** `CLAUDE.md` warns that PH is
UTC+8 and `toISOString().slice(0,10)` rolls the date back a day. Deriving the key once, server-side,
in `Asia/Manila`, means neither the Kotlin client nor the JS admin can get it wrong independently.
It also makes the unique constraint enforceable.

### 4.3 `attendance_terms_acceptances`

MVP §6 requires recording acceptance. Versioned, because changing the Terms must be able to force
re-acceptance.

| Column | Type |
|---|---|
| `id` | `uuid` PK |
| `worker_id` | `uuid not null` → `auth.users(id)` |
| `terms_version` | `text not null` |
| `accepted_at` | `timestamptz not null default now()` |

`unique (worker_id, terms_version)`. The app gates on "is there a row for the *current* version".
The design's Profile screen reads the newest `accepted_at` ("Accepted Aug 3, 2026").

**Why a new table rather than the existing `profiles.terms_*` columns.**
*(Corrected 2026-08-18 during phase A execution — the original reasoning here was wrong.)*

Those columns **no longer exist**. `0020_employee_terms.sql` added `terms_accepted`,
`terms_accepted_at` and `terms_snapshot`; `0022_drop_terms_columns.sql` dropped the whole cluster
after verifying against live on 2026-07-03 that the gate had never fired and `terms_accepted` was
`false` on every row. `supabase/migrations/README.md` confirms the add→drop replay order matches
live. There is nothing to reuse.

**The relationship to `agreement_events` matters more.** `0021_agreement_events.sql` is the
append-only, cross-portal acceptance audit log, immutable even to `service_role` via a guard trigger.
Its header states the house division of labour: the per-feature record is the fast *"has accepted?"*
flag a gate reads, and `agreement_events` is the **evidence**. So the two are complementary:

- `attendance_terms_acceptances` — the versioned flag, `unique (worker_id, terms_version)`, answering
  "has this worker accepted the *current* version?" in one indexed lookup.
- `agreement_events` — the evidence row phase B must **also** append on acceptance, with
  `audience = 'worker'`, `doc_type = 'attendance_terms'`, plus `doc_text`/`doc_sha256`, `ip` and
  `user_agent`.

This table must not duplicate the audit trail.

### 4.4 Two new `profiles` columns

`profiles` (the table the shim exposes as the `users` collection) is missing two fields this feature
requires. Both are added in `0050`:

| Column | Type | Why |
|---|---|---|
| `worker_no` | `integer` unique, nullable | The design's Profile screen shows `Worker ID · W-0042`. Assigned from a sequence when an account is created with `role='worker'`; displayed zero-padded |
| `position` | `text`, nullable | MVP §3 requires Position at account creation, and both the Profile screen and the §16 attendance record display it. **`profiles` has no position column today** — the `position int default 0` columns elsewhere in `0001_init.sql` are list-ordering fields on unrelated tables |

Per `CLAUDE.md`: a new data field needs a real DB column, and the shim maps camelCase to snake_case,
so the web reads these as `workerNo` and `position`. Both also need adding to the employee create and
edit forms in `js/user-navigator.js` — **two save paths, create *and* edit** — and to
`docs/DATABASE_SCHEMA.md`, in the same change.

### 4.5 The two RPCs

Both `security definer`, both idempotent on their event id.

```
attendance_time_in(
  p_project_id bigint, p_captured_at timestamptz, p_photo_path text,
  p_description text, p_lat/p_lng/p_accuracy_m double precision,
  p_event_id uuid, p_was_offline boolean
) returns attendance_records
```

1. If a row already has `timein_event_id = p_event_id` → **return it unchanged** (the retry case).
2. Reject `p_captured_at` more than 2 minutes in the future → `CAPTURED_IN_FUTURE`.
3. Derive `work_date`. If a row already exists for `(worker, work_date, 1)` → `ALREADY_TIMED_IN`.
4. Verify the project belongs to the worker's owner and is active → `PROJECT_UNAVAILABLE`.
5. Insert with `status='working'`, snapshotting worker name/position and project name.

```
attendance_time_out(… same shape …) returns attendance_records
```

1. Idempotent return on `timeout_event_id`.
2. No open row for today → `NOT_TIMED_IN`. Row already `complete` → `ALREADY_COMPLETE`.
3. `timeout_at < timein_at` → `TIMEOUT_BEFORE_TIMEIN`.
4. Update, set `status='complete'`, `total_minutes = extract(epoch from (timeout_at - timein_at))/60`.

Errors are raised with stable `errcode`/message pairs so the Kotlin layer can map them to the exact
bilingual copy in the design rather than showing a raw Postgres string.

**Clock-skew semantics.** `timein_received_at - timein_at` is only meaningful when
`timein_was_offline = false` — then a large gap means a tampered device clock and the admin sees a
badge. When the record *was* captured offline the gap is legitimately hours, so it proves nothing;
`was_offline` is what the admin is told. The only hard rule that applies in both cases is
`CAPTURED_IN_FUTURE`.

### 4.6 RLS

| Table | Worker | Owner + staff |
|---|---|---|
| `attendance_projects` | `select` where `is_active` and `owner_id = data_owner_id()` | full via `can_access(owner_id)` |
| `attendance_records` | `select` own (`worker_id = auth.uid()`). **No direct insert/update** — writes go only through the RPCs | `select`/`update` via `can_access(owner_id)` |
| `attendance_terms_acceptances` | `select`/`insert` own | `select` via owner |

Deactivating an account must **block login**, not just hide UI — the RPCs check the worker's
`profiles` row is still active, so a deactivated worker with a live session cannot record attendance.

### 4.7 Storage

Private bucket `attendance`, path `{worker_id}/{work_date}/{in|out}-{event_id}.jpg`.

Policies: a worker may `insert` and `select` only under their own `{worker_id}/` prefix; owner and
staff may `select` all of their tenant's. Admin display uses the existing signed-URL resolver in
`js/supabase-config.js` §11b.

**Photos are files, never base64.** The repo stores `costItems` and quotation images as base64 in
JSONB, which is fine for four renders per quote and fatal here: 20 workers × 2 photos × 250 workdays
≈ 10,000 photos/year.

---

## 5. Android app architecture

Single Gradle module. Eleven screens does not justify multi-module; packages carry the boundaries.

```
com.dacs.attendance/
  data/
    local/     Room — AppDatabase, PendingSubmissionDao, CachedRecordDao, CachedProjectDao
    remote/    SupabaseClientProvider, AttendanceRpc, ProjectApi, PhotoStorage
    repo/      AuthRepository, AttendanceRepository, ProjectRepository
  domain/      AttendanceRecord, AttendanceStatus, PendingSubmission, TotalHours, WorkDate
  sync/        SubmissionWorker (WorkManager), SyncScheduler
  camera/      CameraController (CameraX), PhotoWatermarker, PhotoCompressor
  ui/
    theme/     Color.kt, Type.kt, Dimens.kt, AttendanceTheme.kt
    components/ PrimaryActionButton, BilingualLabel, StepProgressBar, DayStepper,
                ProjectRow, StatusPill, BottomNav
    login/ terms/ dashboard/ timeflow/ history/ profile/
  MainActivity.kt
```

**Stack**

| Concern | Choice |
|---|---|
| Language / UI | Kotlin, Jetpack Compose, Material 3 |
| minSdk / target | **24** with core library desugaring (`java.time` on old devices) / latest stable |
| DI | Hilt |
| Navigation | Navigation Compose, type-safe routes |
| State | ViewModel + `StateFlow`, unidirectional data flow |
| Backend | **supabase-kt v3** — `auth`, `postgrest`, `storage` |
| Local DB | Room |
| Background upload | WorkManager |
| Camera | CameraX (`ImageCapture`) |
| Images | Coil |

Versions are pinned at scaffold time from current stable releases, not guessed here.

**Session persistence.** supabase-kt session in encrypted storage; workers stay logged in across
restarts, matching the web's deliberate `persistSession: true`.

### 5.1 Screens → composables

| # | Design screen | Composable | Notes |
|---|---|---|---|
| 01 | Log in | `LoginScreen` | Email + password, show/hide eye. "Only the admin can create an account" copy |
| 02 | Terms & Conditions | `TermsScreen` | Scrollable, agree checkbox, `ACCEPT & CONTINUE`. Writes §4.3 |
| 03 | Dashboard (idle) | `DashboardScreen(state = NoRecord)` | Greeting, date, 1-2-3 stepper, big green `TIME IN` |
| 04 | Select project | `ProjectPickScreen` | Step 1/4. Last-used project pre-selected |
| 05 | Take photo | `CameraScreen` | Step 2/4. Front camera, burned-in overlay |
| 06 | Check photo | `PhotoReviewScreen` | Step 3/4. `RETAKE` / `USE THIS PHOTO` |
| 07 | Description | `DescriptionScreen` | Step 4/4. Optional text + quick-pick chips |
| 08 | Confirmation | `ConfirmationScreen` | Full-bleed green (brown for Out); repeats what was saved |
| 09 | Dashboard (working) | `DashboardScreen(state = Working)` | "Timed in at 7:45 AM", live "Hours so far", brown `TIME OUT` |
| 10 | History | `HistoryScreen` | This week / This month; per-day cards; `No record` state |
| 11 | Profile | `ProfileScreen` | Email, Position, Worker ID, change password, T&C date, log out |

Screens 04–08 are **one flow parameterised by direction** (`TimeDirection.IN` / `.OUT`) — the design
states Time Out is "the same five, in brown". One `TimeFlowViewModel`, one nav graph, colour and
copy from the direction. Building it twice is how the two halves drift.

### 5.2 Design tokens

```
green   #1A5C3A   pressed #134428   tint #EAF2EC   subtle #F7FBF8   border #CBE0D2
brown   #7C5E2A   pressed #63491F
danger  #C0392B   dangerBorder #F0DAD7   dangerTint #FDF5F4
surface #FFFFFF   raised #F7F7F5   canvas #F0F0EE   field #FAFAFA
text    #1C1C1E   secondary #3A3A3C   muted #6C6C70   disabled #9A9A9E
border  #E5E5E5   hairline #F0F0EE
```

Type: **Playfair Display** (screen titles, worker name, confirmation headline), **Barlow** (body,
buttons), **IBM Plex Mono** (times, totals, Worker ID, step counters). All three bundled as assets —
no network font fetch, since the app must work offline.

`Dimens.kt` carries the deliberately large targets: primary action `min 76.dp`, input `62.dp`,
project row `74.dp`, corner radii 12/14/16/22.dp. These are an accessibility decision for gloved
hands in daylight, not a style preference — they do not get "tightened up" later.

**Bilingual copy.** `BilingualLabel(en, tl)` renders the English label and the Tagalog line together.
`strings.xml` holds paired keys (`action_sign_in` / `action_sign_in_tl`). Some strings are
Tagalog-only by design ("Magandang umaga,", "Naka-lock", "Wala pang naitalang oras ngayon") and stay
that way.

---

## 6. Offline & sync

The heart of the app. **The UI never waits on the network to confirm attendance.**

### 6.1 Room

| Table | Purpose |
|---|---|
| `pending_submission` | `event_id` (PK, uuid), `kind` (IN/OUT), `project_id`, `project_name`, `captured_at`, `photo_local_path`, `description`, `lat`/`lng`/`accuracy`, `was_offline`, `attempts`, `last_error`, `created_at` |
| `cached_record` | Local mirror of the worker's own records so Dashboard and History render with no signal |
| `cached_project` | Last-known active project list — **without this the picker is empty offline and the whole flow is dead** |

### 6.2 The submit path

1. On `SUBMIT`, generate `event_id = UUID.randomUUID()` **once**, write the photo to app-private
   storage, insert `pending_submission`, and return to the Dashboard immediately with the local
   mirror already updated. The worker is done.
2. Enqueue a `OneTimeWorkRequest` with `NetworkType.CONNECTED`, exponential backoff, and
   `uniqueWorkName = "submit-$event_id"` (`ExistingWorkPolicy.KEEP`) so double-enqueue is a no-op.
3. `SubmissionWorker`: upload the photo to Storage, then call the RPC with the stored `event_id`.
   On success, replace the mirror row with the server's returned record and delete the pending row.
4. A periodic sweeper (15-minute minimum interval) re-enqueues anything stranded — belt and braces
   for a process death between step 1 and step 2.

**Why `event_id` is generated at tap time and persisted:** it is what makes step 3 safe to run any
number of times. A regenerated id on retry would create a duplicate record; that is the classic
offline-queue bug and the reason the write path is an RPC rather than an insert.

### 6.3 What the worker sees

Pending records show a small "Will sync when online" marker in History. `was_offline` is recorded but
**never shown to the worker** — it is not their problem and implying suspicion would be wrong. The
admin sees it.

### 6.4 Conflict cases

| Case | Resolution |
|---|---|
| Queued Time In, server already has one for that date (worker used a second device) | RPC returns `ALREADY_TIMED_IN`; worker's mirror is reconciled to the server row and the pending row is dropped with a plain-language notice |
| Time Out queued while Time In still pending | Queue is drained **in `created_at` order** per worker; Time Out waits for its Time In |
| Photo upload succeeds, RPC fails | Retry reuses the same path; an orphaned object is harmless and swept later. This is why the photo goes first |

---

## 7. Camera & photo pipeline

1. CameraX `ImageCapture`, **front camera default** — the design's instruction is *"Ituro ang camera
   sa iyong sarili"*.
2. **No gallery picker anywhere.** The photo must be taken now, at the site. This is the single
   cheapest anti-spoofing measure available and it is a deliberate omission, not a missing feature.
3. After capture, burn in the overlay the design specifies — `{project} · {date} · {time}` — bottom
   gradient, IBM Plex Mono, drawn onto the bitmap so it survives export.
4. Compress: longest edge 1600px, JPEG q≈80, target ≈300 KB. Verified against the storage budget in
   §4.7.
5. Write to app-private storage (not `MediaStore`) — attendance photos are not the worker's gallery.
6. Delete the local file only after the upload is confirmed.

`CAMERA` permission is required and requested in-flow with a bilingual rationale.
`ACCESS_COARSE_LOCATION` is requested once, is **optional**, and a denial never blocks attendance —
the record simply carries null coordinates.

---

## 8. Admin additions in `Dacs Web`

New nav section, following the seven-step checklist in `CLAUDE.md` exactly — including step 2,
`_FOCUS_SUBVIEWS`, which is the one that gets missed and which silently breaks drill-downs for
`allowed_modules` accounts while the owner account looks fine.

1. `PRIMARY_NAV` entry — `js/admin.js`
2. `_FOCUS_SUBVIEWS` — `js/admin.js`
3. `ATT_VIEWS` group in `admin.html`, in sync with `switchView()`
4. Role filter in `_visibleNav()` — owner and staff; **workers never see it**
5. Section markup + `<script>` tag in `admin.html`
6. RLS policies — in migration `0050`, same change
7. Module map — `docs/ARCHITECTURE.md` §4

New file `js/attendance-admin.js`, plus a `docs/DATABASE_SCHEMA.md` entry.

| Design | Screen | Content |
|---|---|---|
| A1 | Today's Attendance | Worker · Project · Time In · Time Out · Status, with `Complete` / `Working` / `No record`. Workers with no row appear as `No record` — a left join against active workers, not a plain select |
| A2 | Worker detail | Both photos, both project names, both descriptions, total hours, status. `offline-captured` and clock-skew badges |
| A3 | Workers | List, add (reuses the existing `adminCreateUser` Edge Function), activate/deactivate |
| A4 | Create account | Modal: names, email, role, position, password. Minted by the admin-create-user Edge Function |
| A5 | Projects | **Read-only** (`0059`). Name · which system it came from · workers today. Attendance keeps no project list of its own — it reads `folders` (Project Control) and `construction_projects` (Project Management) through `attendance_projects_for_worker()`. Create/rename/close happens in the owning module |
| A6 | Reports | Daily / weekly / monthly by worker and project; CSV export |

**Not in the MVP but needed soon:** the MVP doc gives the admin no way to correct attendance. A
forgotten Time Out leaves a record `working` forever and every report shows `—`. §9 records this as a
known gap; the `abandoned` status and a nightly sweep are the intended fix.

---

## 9. Testing

**SQL** — extends `supabase/tests/rls_checks.sql`:

- Time In twice with the **same** `event_id` → one row, second call returns it unchanged
- Time In twice with **different** event ids → `ALREADY_TIMED_IN`, still one row
- A capture at 23:50 and one at 00:10 Manila time land on **different** `work_date`s
- A capture at 07:45 Manila on a UTC date boundary lands on the **local** date
- `total_minutes` for 07:45 → 17:30 is **585** (9h45m — the MVP doc's own example)
- `timeout_at < timein_at` → `TIMEOUT_BEFORE_TIMEIN`, no row written
- A worker cannot select another worker's records; a deactivated worker cannot call the RPCs
- Staff can read their owner's records; a worker cannot read the project list of another owner

**Kotlin** — unit: status mapping, `TotalHours` formatting ("9h 45m"), `WorkDate` derivation at
UTC+8, RPC error → bilingual message mapping. Room DAO instrumented tests. Repository tests against
a fake `AttendanceRpc`. **The queue-replay test is the important one:** enqueue → fail the RPC →
retry → assert exactly one server record and an empty queue.

**Manual, on a real device:** airplane-mode Time In, then restore signal and confirm a single record
syncs with the correct `captured_at`.

**Web** — `npm test` must stay green. Attendance touches no money code, so an attendance change that
breaks `tests/money-math.test.js` means something crossed the §2 isolation line.

---

## 10. Out of scope for the MVP

Named so they are choices, not oversights: split shifts / multiple sessions per day (schema is ready,
rule is not), admin editing of attendance beyond `abandoned`, break/lunch deduction, late/undertime
flags, geofence enforcement, push notification reminders, iOS, worker-to-project assignment
(any worker may pick any active project), and linking attendance to `labor_contracts` or payroll —
which §2 forbids outright.

---

## 11. Open risks

| Risk | Mitigation |
|---|---|
| Device clock tampering on offline records | `CAPTURED_IN_FUTURE` hard rejection; `was_offline` badge; the burned-in photo overlay is corroborating evidence. Fully solving this needs a trusted time source — post-MVP |
| Worker shares credentials | T&C clause 3 addresses it; the selfie photo is the practical deterrent. Not technically preventable in the MVP |
| A forgotten Time Out | §8 — known gap; `abandoned` status plus a nightly sweep |
| Storage growth | ≈300 KB × 2 × workers × workdays. 20 workers ≈ 3 GB/year. Needs a retention decision before year two |
| Cheap devices killing background work | WorkManager plus a foreground refresh on app open; the periodic sweeper is the backstop |

---

## 12. Implementation order

This design is **too large for one implementation plan**. It decomposes into three pieces with a
strict dependency order, each getting its own plan and its own review:

**A — Backend foundation** (`Dacs Web`). Migration `0050`: the three tables, the two `profiles`
columns, the two RPCs, RLS, the Storage bucket and its policies. Tests in
`supabase/tests/rls_checks.sql`. The `worker_no` / `position` fields wired into both save paths in
`js/user-navigator.js`. `docs/DATABASE_SCHEMA.md` updated.

*Ships independently and is verifiable on its own* — the RPC test suite proves the status machine,
the idempotency guarantee and the UTC+8 date boundary before a line of Kotlin exists. Everything
else depends on it, and getting the date key or the unique constraint wrong here is the one mistake
that would be expensive to correct later.

**B — Android worker app** (`Dacs Attendance`, new repo). Scaffold, theme and design tokens, the
eleven screens, the shared four-step flow, Room, WorkManager, CameraX. Built against the RPCs from A.

**C — Admin web sections** (`Dacs Web`). `js/attendance-admin.js` and the seven-step nav wiring, A1–A6.

B and C are independent of each other and could run in parallel — they share only the tables from A.
Recommended sequence is A → B → C, since B is the risky half and finding a schema problem while
building the app is cheaper than finding it after the admin views are written on top of it.
