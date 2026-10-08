# WorkMate Stage 0C-1 — Attendance Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything DAC'S WorkMate needs to record a Time In / Time Out exactly the way DACS Attendance does — the rules, the tamper-proof clock, the location pre-check, the burned-in photo, the offline queue and background sending — built and tested with no screens yet.

**Architecture:** Pure-Dart domain files are line-for-line ports of the Kotlin rules, each with the Kotlin unit tests ported as its acceptance cases. Three things stay native Android because Flutter cannot match them (a Kotlin `AttendanceBridge` on channel `com.dacs.workmate/attendance`): the uptime counter + boot count (trusted time), the fused GPS fix with mock detection, and photo processing (EXIF-upright, sampled decode, 1600 px, burned-in caption, JPEG 80). A sqflite database holds the queue and the per-worker mirrors; a Workmanager task drains the queue in the background, one run at a time.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, Kotlin (Android, JDK 21), supabase_flutter 2.17.2, sqflite 2.4.2+1 (+ sqflite_common_ffi for tests), workmanager 0.10.10, Google Play Services Location 21.3.0, androidx.exifinterface 1.3.7.

**Spec:** [docs/superpowers/specs/2026-09-29-unified-worker-app-design.md](../specs/2026-09-29-unified-worker-app-design.md) §1, §3 ("Existing Time In, Time Out, photos, location checks, history and offline attendance continue working"). Roadmap: [2026-09-29-workmate-stage0-roadmap.md](2026-09-29-workmate-stage0-roadmap.md) row 0C (split: **0C-1 engine**, this plan; **0C-2 screens**, next plan).

**Behaviour reference (the rules are ported, never improved):** `C:\Users\John Aerol Tapales\Documents\Dacs Attendance\app\src\main\java\com\dacs\attendance\` — `domain/{TrustedTime,WorkDate,TotalHours,TodayReconcile,LocationVerification,PhotoOverlay,CaptionFit,PhotoSampling,SubmissionQueue,AttendanceFailure,AttendanceRecord,History,DescriptionChips}.kt`, `data/local/{ClockAnchorStore,Entities,AttendanceDao,PhotoStore,LocationProvider,Connectivity}.kt`, `data/repo/{AttendanceRepository,SupabaseAttendanceRepository,OfflineAttendanceRepository}.kt`, `data/remote/AttendanceDtos.kt`, `work/{SubmissionWorker,SubmissionScheduler}.kt`; tests in `app/src/test/java/com/dacs/attendance/domain/`.

## Global Constraints

- Repo: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate` (GitHub `dacscompany-corp/DAC-S-Workmate`). Dart imports are `package:workmate/...`.
- **The user commits manually.** Never run `git commit`, `git push`, `git add`, `git stash`, `git reset` or `git checkout`. "Checkpoint" = stop and report `git status --short`.
- Server contract (live, verified 2026-09-30): `attendance_time_in` / `attendance_time_out` take exactly `p_project_system text, p_project_id uuid, p_captured_at timestamptz, p_photo_path text, p_event_id uuid, p_description text, p_lat double precision, p_lng double precision, p_accuracy_m double precision, p_was_offline boolean, p_is_mock boolean, p_permission_denied boolean, p_trusted_at timestamptz` and return one `attendance_records` row. `attendance_projects_for_worker()` returns `(project_system text, project_id uuid, project_name text)`. Fences: table `attendance_project_geofence`. Photos: private bucket **`attendance`**, object path **`{worker_id}/{work_date}/{in|out}-{event_id}.jpg`** (RLS checks the first segment).
- Work dates are **Asia/Manila** (UTC+8, no daylight saving since 1978, so a fixed +8 h offset is exact). Never use the phone's zone and never a UTC date.
- `p_captured_at` is the **shutter** time, frozen at capture; `p_trusted_at` is sent only when known (omitted, not null, when the phone cannot vouch).
- The event id is the idempotency key: minted once per submission, reused on every retry.
- A queued row is only ever sent by **its own worker**; a row with an empty worker id is never sent.
- Location: refuse only `mock_location`, `permission_denied`, `location_disabled`, `outside_radius` (and a missing fence only if required — the device always passes `requireGeofence: false`). `minAccuracyMetres` is **50**. Low accuracy and no fix are recorded, never refused.
- Photo: longest edge **1600 px**, JPEG quality **80**, caption `"{project} · {d MMM yyyy} · {h:mm a}"` in Manila time, project name cut at **32** chars + `…`, stored app-private (`<app files>/attendance-photos/{event_id}.jpg`), deleted only after a confirmed upload.
- Background sending: **one** unique work name `attendance-submission` (enqueue = KEEP, send-now = REPLACE), exponential backoff from **30 s**, network required, periodic sweeper `attendance-submission-sweep` every **15 min**, at most **50** rows per run.
- No new migration. No Dacs Web change. WorkMate `versionCode` stays ≥ 1000 (currently `0.1.1+1001`).
- `flutter test` and `flutter analyze` must stay clean; `flutter build apk --debug` must succeed.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/attendance/domain/work_date.dart` | Manila date math, `WorkDate`, `TimeDirection`, `photoPath` |
| `lib/attendance/domain/trusted_time.dart` | `ClockAnchor`, `trustedTime`, `parseServerDate` |
| `lib/attendance/domain/total_hours.dart` | `formatMinutes`, `hoursSince` |
| `lib/attendance/domain/photo_overlay.dart` | Caption strings burned into the photo |
| `lib/attendance/domain/location_verification.dart` | `LocationStatus`, `Geofence`, `DeviceFix`, `checkLocation`, `locationRefuses` |
| `lib/attendance/domain/attendance_failure.dart` | RPC error code → `AttendanceFailure` |
| `lib/attendance/domain/submission_queue.dart` | `nextToSend`, `QueueOutcome`, `outcomeFor` |
| `lib/attendance/domain/attendance_record.dart` | `ProjectSystem`, `AttendanceProject`, `AttendanceStatus`, `AttendanceRecord` |
| `lib/attendance/domain/today_reconcile.dart` | Server vs mirror vs queue decision for today |
| `lib/attendance/domain/history.dart` | History range/days/summary, Home week strip |
| `lib/attendance/domain/description_chips.dart` | Additive description chips |
| `android/app/src/main/kotlin/com/dacs/workmate/PhotoMath.kt` | `photoSampleSize`, `fitTextSize` (pure Kotlin) |
| `android/app/src/main/kotlin/com/dacs/workmate/PhotoPreparer.kt` | Upright + scale + caption + JPEG |
| `android/app/src/main/kotlin/com/dacs/workmate/AttendanceBridge.kt` | Channel: `clock`, `isOnline`, `currentFix`, `preparePhoto` |
| `android/app/src/test/kotlin/com/dacs/workmate/PhotoMathTest.kt` | Ported Kotlin tests |
| `lib/attendance/device/device_bridge.dart` | Dart side of the channel + `deviceFixFromMap` |
| `lib/attendance/device/clock_anchor_store.dart` | Records server `Date` headers; answers trusted "now" |
| `lib/attendance/data/submission_request.dart` | One submission + `PendingSubmission` row model |
| `lib/attendance/data/attendance_db.dart` | sqflite schema + DAO methods |
| `lib/attendance/data/attendance_remote.dart` | Upload + RPC + reads; `rpcParams`, row mappers |
| `lib/attendance/data/attendance_repository.dart` | Offline-first submit / today / history / projects |
| `lib/attendance/sync/upload_scheduler.dart` | Workmanager policies behind `UploadScheduler` |
| `lib/attendance/sync/submission_sync.dart` | One drain of the queue |
| `lib/attendance/sync/background_sync.dart` | Workmanager entry point (background isolate) |
| `lib/net/supabase_setup.dart` | One `Supabase.initialize` used by the app and the background task |

---

### Task 1: Time and photo-caption rules

**Files:**
- Create: `lib/attendance/domain/work_date.dart`, `lib/attendance/domain/trusted_time.dart`, `lib/attendance/domain/total_hours.dart`, `lib/attendance/domain/photo_overlay.dart`
- Test: `test/attendance/domain/work_date_test.dart`, `test/attendance/domain/trusted_time_test.dart`, `test/attendance/domain/total_hours_test.dart`, `test/attendance/domain/photo_overlay_test.dart`

**Interfaces:**
- Produces: `const manilaOffset`; `DateTime manilaFields(DateTime instant)`; `DateTime manilaDate(DateTime instant)` (UTC-midnight date); `String isoDate(DateTime date)`; `class WorkDate { factory WorkDate.of(DateTime captured); factory WorkDate.today([DateTime? now]); final String iso; }`; `enum TimeDirection { timeIn, timeOut }` with `wire` (`'IN'`/`'OUT'`), `slug` (`'in'`/`'out'`), `static TimeDirection parse(String wire)`; `String photoPath({required String workerId, required WorkDate workDate, required TimeDirection direction, required String eventId})`; `class ClockAnchor { serverTime, uptimeMillis, bootCount }`; `const maxAnchorAge`; `DateTime? trustedTime(ClockAnchor? anchor, {required int uptimeNowMillis, required int? bootCountNow})`; `DateTime? parseServerDate(String? header)`; `const nothingYet = '--'`; `String formatMinutes(int? minutes)`; `String hoursSince(DateTime timeIn, DateTime now)`; `String photoOverlayStamp(DateTime capturedAt)`; `(String, String) photoOverlayCaptionLines(String projectName, DateTime capturedAt)`; `String photoOverlayCaption(String projectName, DateTime capturedAt)`.

- [ ] **Step 1: Write the failing tests**

`test/attendance/domain/work_date_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/work_date.dart';

void main() {
  test('an early morning capture lands on today, not yesterday', () {
    expect(WorkDate.of(DateTime.parse('2026-08-18T23:45:00Z')).iso, '2026-08-19');
  });

  test('late night and just after midnight are different work dates', () {
    final before = WorkDate.of(DateTime.parse('2026-08-19T15:50:00Z'));
    final after = WorkDate.of(DateTime.parse('2026-08-19T16:10:00Z'));
    expect(before.iso, '2026-08-19');
    expect(after.iso, '2026-08-20');
    expect(before == after, isFalse);
  });

  test('a capture at midday is on the obvious date', () {
    expect(WorkDate.of(DateTime.parse('2026-08-19T04:00:00Z')).iso, '2026-08-19');
  });

  test('the phone zone never matters: a local DateTime is read as its instant', () {
    final local = DateTime.parse('2026-08-18T23:45:00Z').toLocal();
    expect(WorkDate.of(local).iso, '2026-08-19');
  });

  test('the photo path follows the storage contract exactly', () {
    expect(
      photoPath(
        workerId: '11111111-1111-1111-1111-111111111111',
        workDate: WorkDate.of(DateTime.parse('2026-08-18T23:45:00Z')),
        direction: TimeDirection.timeIn,
        eventId: 'abcdefab-1234-5678-9abc-def012345678',
      ),
      '11111111-1111-1111-1111-111111111111/2026-08-19/in-abcdefab-1234-5678-9abc-def012345678.jpg',
    );
  });

  test('a time out photo is named out, not in', () {
    expect(
      photoPath(
        workerId: 'w',
        workDate: WorkDate.of(DateTime.parse('2026-08-19T09:30:00Z')),
        direction: TimeDirection.timeOut,
        eventId: 'e',
      ),
      'w/2026-08-19/out-e.jpg',
    );
  });

  test('direction wire values round-trip', () {
    expect(TimeDirection.parse('IN'), TimeDirection.timeIn);
    expect(TimeDirection.parse('OUT'), TimeDirection.timeOut);
    expect(TimeDirection.timeOut.wire, 'OUT');
  });
}
```

`test/attendance/domain/trusted_time_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/trusted_time.dart';

void main() {
  final server = DateTime.parse('2026-09-28T23:30:00Z'); // 07:30 Manila
  final anchor = ClockAnchor(serverTime: server, uptimeMillis: 1000000, bootCount: 12);

  test('trusted time follows uptime, not the wall clock', () {
    expect(
      trustedTime(anchor, uptimeNowMillis: 1000000 + 40 * 60000, bootCountNow: 12),
      server.add(const Duration(minutes: 40)),
    );
  });

  test('no anchor yet means no trusted time', () {
    expect(trustedTime(null, uptimeNowMillis: 5000, bootCountNow: 12), isNull);
  });

  test('a reboot since the anchor voids it', () {
    expect(trustedTime(anchor, uptimeNowMillis: 2000000, bootCountNow: 13), isNull);
  });

  test('uptime running backwards is a reboot the boot count did not reveal', () {
    final noBoot = ClockAnchor(serverTime: server, uptimeMillis: 1000000, bootCount: null);
    expect(trustedTime(noBoot, uptimeNowMillis: 500, bootCountNow: null), isNull);
  });

  test('an anchor older than a week is not paid on', () {
    final tooOld = 1000000 + maxAnchorAge.inMilliseconds + 1;
    expect(trustedTime(anchor, uptimeNowMillis: tooOld, bootCountNow: 12), isNull);
  });

  test('an unknown boot count falls back to the uptime check alone', () {
    final noBoot = ClockAnchor(serverTime: server, uptimeMillis: 1000000, bootCount: null);
    expect(
      trustedTime(noBoot, uptimeNowMillis: 1060000, bootCountNow: null),
      server.add(const Duration(seconds: 60)),
    );
  });

  test("the HTTP Date header parses to the server's instant", () {
    expect(parseServerDate('Sun, 27 Sep 2026 17:12:43 GMT'), DateTime.parse('2026-09-27T17:12:43Z'));
  });

  test('a missing or garbled Date header is no anchor, never a crash', () {
    expect(parseServerDate(null), isNull);
    expect(parseServerDate(''), isNull);
    expect(parseServerDate('yesterday-ish'), isNull);
  });
}
```

`test/attendance/domain/total_hours_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/total_hours.dart';

void main() {
  test("the MVP's own example formats as 9h 45m", () => expect(formatMinutes(585), '9h 45m'));
  test('a whole number of hours still shows the minutes', () => expect(formatMinutes(480), '8h 0m'));
  test('under an hour shows zero hours', () => expect(formatMinutes(20), '0h 20m'));
  test('a shift past midnight keeps counting up', () => expect(formatMinutes(1505), '25h 5m'));
  test('nothing recorded yet is a dash, not a zero', () => expect(formatMinutes(null), '--'));

  test('hours so far counts from time in to now', () {
    expect(hoursSince(DateTime.parse('2026-08-18T23:45:00Z'), DateTime.parse('2026-08-19T02:30:00Z')), '2h 45m');
  });

  test('a device clock behind the server never shows negative hours', () {
    expect(hoursSince(DateTime.parse('2026-08-19T02:30:00Z'), DateTime.parse('2026-08-19T02:25:00Z')), '0h 0m');
  });
}
```

`test/attendance/domain/photo_overlay_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/photo_overlay.dart';

void main() {
  const long = 'A Very Long Construction Project Name That Will Not Fit On One Line';

  test('the overlay carries project, date and time', () {
    expect(
      photoOverlayCaption('ABC Building Project', DateTime.parse('2026-08-18T23:45:00Z')),
      'ABC Building Project · 19 Aug 2026 · 7:45 AM',
    );
  });

  test('the time is Manila, not the device zone', () {
    expect(photoOverlayCaption('Site', DateTime.parse('2026-08-18T23:45:00Z')), contains('19 Aug 2026'));
  });

  test('an evening capture reads as PM', () {
    expect(photoOverlayCaption('Site', DateTime.parse('2026-08-19T09:30:00Z')), contains('5:30 PM'));
  });

  test('noon and midnight read as 12, not 0', () {
    expect(photoOverlayStamp(DateTime.parse('2026-08-19T04:05:00Z')), '19 Aug 2026 · 12:05 PM');
    expect(photoOverlayStamp(DateTime.parse('2026-08-19T16:05:00Z')), '20 Aug 2026 · 12:05 AM');
  });

  test('a long project name is truncated rather than overflowing the photo', () {
    final caption = photoOverlayCaption(long, DateTime.parse('2026-08-19T09:30:00Z'));
    expect(caption, startsWith('A Very Long Construction Project'));
    expect(caption, contains('…'));
    expect(caption, contains('5:30 PM'));
  });

  test('the split lines rejoin into exactly the burned-in caption', () {
    final at = DateTime.parse('2026-08-19T09:30:00Z');
    final (name, stamp) = photoOverlayCaptionLines('ABC Building Project', at);
    expect('$name · $stamp', photoOverlayCaption('ABC Building Project', at));
  });

  test('only the name line is ever truncated', () {
    final (name, stamp) = photoOverlayCaptionLines(long, DateTime.parse('2026-08-19T09:30:00Z'));
    expect(name, endsWith('…'));
    expect(stamp, '19 Aug 2026 · 5:30 PM');
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/attendance/domain`
Expected: FAIL — `package:workmate/attendance/domain/...` does not exist.

- [ ] **Step 3: Implement**

`lib/attendance/domain/work_date.dart`:

```dart
/// Asia/Manila is UTC+8 all year: the Philippines has observed no daylight
/// saving since 1978, so a fixed offset is exact and needs no tz database.
const manilaOffset = Duration(hours: 8);

/// [instant] shifted so its year/month/day/hour/minute read as Manila wall
/// time. The result is UTC-typed on purpose: read its fields, never convert
/// it again.
DateTime manilaFields(DateTime instant) => instant.toUtc().add(manilaOffset);

/// The Manila calendar date of [instant], as a UTC midnight — the one date
/// representation this package uses (UTC dates have no DST to trip on).
DateTime manilaDate(DateTime instant) {
  final f = manilaFields(instant);
  return DateTime.utc(f.year, f.month, f.day);
}

String _two(int n) => n.toString().padLeft(2, '0');

/// "2026-08-19". Lexical order is chronological, which the local mirror
/// relies on for BETWEEN queries.
String isoDate(DateTime date) => '${date.year.toString().padLeft(4, '0')}-${_two(date.month)}-${_two(date.day)}';

/// The calendar day an attendance record belongs to, derived exactly as
/// attendance_time_in derives it: (captured_at at time zone 'Asia/Manila')::date.
/// Never the phone's zone, never a UTC date (PH is UTC+8, so anything before
/// 08:00 local would roll back a day — which is most Time Ins).
class WorkDate {
  const WorkDate._(this.iso);

  factory WorkDate.of(DateTime captured) => WorkDate._(isoDate(manilaDate(captured)));

  factory WorkDate.today([DateTime? now]) => WorkDate.of(now ?? DateTime.now());

  final String iso;

  @override
  String toString() => iso;

  @override
  bool operator ==(Object other) => other is WorkDate && other.iso == iso;

  @override
  int get hashCode => iso.hashCode;
}

/// Which half of the day a capture is.
enum TimeDirection {
  timeIn('IN', 'in'),
  timeOut('OUT', 'out');

  const TimeDirection(this.wire, this.slug);

  /// Stored in the local queue ("IN"/"OUT"), as the Kotlin app stores it.
  final String wire;

  /// The `in` / `out` token in the storage path contract.
  final String slug;

  static TimeDirection parse(String wire) => values.firstWhere((d) => d.wire == wire);
}

/// The Storage object path fixed by migration 0050 §7:
/// {worker_id}/{work_date}/{in|out}-{event_id}.jpg — the bucket's RLS compares
/// the FIRST segment to auth.uid(), so this shape is a permission check.
String photoPath({
  required String workerId,
  required WorkDate workDate,
  required TimeDirection direction,
  required String eventId,
}) =>
    '$workerId/$workDate/${direction.slug}-$eventId.jpg';
```

`lib/attendance/domain/trusted_time.dart`:

```dart
import 'dart:io' show HttpDate;

/// A time the worker cannot move by changing the phone's clock (0078).
///
/// Whenever the server answers, its clock (the HTTP Date header) is written
/// down next to the phone's UPTIME counter, which nothing in Settings can
/// change. At the shutter: trusted = serverTimeAtAnchor + (uptimeNow - uptimeAtAnchor).
/// Returns null — never a guess — with no anchor, after a reboot, or when the
/// anchor is older than [maxAnchorAge]. The server then falls back to the
/// phone's time only if it arrived within 3 minutes.
class ClockAnchor {
  const ClockAnchor({required this.serverTime, required this.uptimeMillis, this.bootCount});

  final DateTime serverTime;
  final int uptimeMillis;

  /// Settings.Global.BOOT_COUNT then, or null if the phone does not say.
  final int? bootCount;
}

const maxAnchorAge = Duration(days: 7);

DateTime? trustedTime(ClockAnchor? anchor, {required int uptimeNowMillis, required int? bootCountNow}) {
  if (anchor == null) return null;
  // Rebooted since the anchor: uptime restarted, the anchor is void.
  if (anchor.bootCount != null && bootCountNow != null && anchor.bootCount != bootCountNow) return null;
  final elapsed = uptimeNowMillis - anchor.uptimeMillis;
  // Uptime never runs backwards within one boot; if it has, it was a reboot.
  if (elapsed < 0) return null;
  if (elapsed > maxAnchorAge.inMilliseconds) return null;
  return anchor.serverTime.toUtc().add(Duration(milliseconds: elapsed));
}

/// The server clock from an HTTP Date header, or null when absent or unreadable.
DateTime? parseServerDate(String? header) {
  if (header == null || header.trim().isEmpty) return null;
  try {
    return HttpDate.parse(header.trim()).toUtc();
  } catch (_) {
    return null;
  }
}
```

`lib/attendance/domain/total_hours.dart`:

```dart
/// Hours as the worker reads them. The authoritative total is computed once,
/// server-side, into attendance_records.total_minutes; this only formats it.
const nothingYet = '--';

/// "9h 45m". Null means nothing is recorded yet.
String formatMinutes(int? minutes) {
  if (minutes == null) return nothingYet;
  final safe = minutes < 0 ? 0 : minutes;
  return '${safe ~/ 60}h ${safe % 60}m';
}

/// The live "Hours so far", clamped at zero: a phone clock a few minutes
/// behind the server must never render "-0h 5m".
String hoursSince(DateTime timeIn, DateTime now) {
  final minutes = now.difference(timeIn).inMinutes;
  return formatMinutes(minutes < 0 ? 0 : minutes);
}
```

`lib/attendance/domain/photo_overlay.dart`:

```dart
import 'work_date.dart';

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// Beyond this the caption stops fitting on one line across the photo.
const maxProjectChars = 32;

/// "1 Sep 2026 · 3:00 PM", Manila time — matching the work_date the record
/// files under.
String photoOverlayStamp(DateTime capturedAt) {
  final t = manilaFields(capturedAt);
  final hour12 = t.hour % 12 == 0 ? 12 : t.hour % 12;
  final amPm = t.hour < 12 ? 'AM' : 'PM';
  return '${t.day} ${_months[t.month - 1]} ${t.year} · $hour12:${t.minute.toString().padLeft(2, '0')} $amPm';
}

/// The caption split where it is safe to break: the project name (truncated,
/// never the timestamp), then the stamp.
(String, String) photoOverlayCaptionLines(String projectName, DateTime capturedAt) {
  final project = projectName.length <= maxProjectChars
      ? projectName
      : '${projectName.substring(0, maxProjectChars).trimRight()}…';
  return (project, photoOverlayStamp(capturedAt));
}

/// The one-line caption burned into the attendance photo:
/// "ABC Building Project · 19 Aug 2026 · 7:45 AM".
String photoOverlayCaption(String projectName, DateTime capturedAt) {
  final (project, stamp) = photoOverlayCaptionLines(projectName, capturedAt);
  return '$project · $stamp';
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/attendance/domain`
Expected: PASS (all four files).

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 2: Location, failure and queue rules

**Files:**
- Create: `lib/attendance/domain/location_verification.dart`, `lib/attendance/domain/attendance_failure.dart`, `lib/attendance/domain/submission_queue.dart`
- Test: `test/attendance/domain/location_verification_test.dart`, `test/attendance/domain/attendance_failure_test.dart`, `test/attendance/domain/submission_queue_test.dart`

**Interfaces:**
- Consumes: `TimeDirection` (Task 1).
- Produces: `enum LocationStatus { verified, outsideRadius, lowAccuracy, locationUnavailable, mockLocation, permissionDenied, locationDisabled, projectGeofenceUnavailable }` with `wire`; `class Geofence { latitude, longitude, radiusMetres, enabled }`; `class DeviceFix { latitude, longitude, accuracyMetres, isMock, permissionDenied, locationDisabled }`; `class LocationCheck { status, distanceMetres, geofence }`; `double distanceMetres(double lat1, double lng1, double lat2, double lng2)`; `LocationCheck checkLocation(DeviceFix fix, Geofence? fence, {required double minAccuracyMetres})`; `bool locationRefuses(LocationStatus status, {required bool requireGeofence})`; `AttendanceFailure? failureForRefusal(LocationStatus status)`; `enum AttendanceFailure {...}` with `static AttendanceFailure of(Object error)`; `class QueuedSubmission { eventId, direction, createdAt, workerId }`; `QueuedSubmission? nextToSend(List<QueuedSubmission> queue, String currentWorkerId)`; `enum QueueOutcome { retry, dropAndReconcile, failPermanently }`; `QueueOutcome outcomeFor(AttendanceFailure failure)`.

- [ ] **Step 1: Write the failing tests**

`test/attendance/domain/location_verification_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_failure.dart';
import 'package:workmate/attendance/domain/location_verification.dart';

void main() {
  const fence = Geofence(latitude: 14.5995, longitude: 120.9842, radiusMetres: 150);
  DeviceFix fixAt(double lat, double lng, {double accuracy = 12}) =>
      DeviceFix(latitude: lat, longitude: lng, accuracyMetres: accuracy);

  test('one degree of latitude is about 111 kilometres', () {
    final m = distanceMetres(14.0, 121.0, 15.0, 121.0);
    expect(m, inInclusiveRange(110000, 112000));
  });

  test('location switched off is refused, not merely treated as no fix', () {
    final check = checkLocation(const DeviceFix(locationDisabled: true), fence, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.locationDisabled);
    expect(locationRefuses(check.status, requireGeofence: false), isTrue);
    expect(check.status.wire, 'location_disabled');
  });

  test('a phone that is ON but cannot get a fix is still recorded', () {
    final check = checkLocation(const DeviceFix(), fence, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.locationUnavailable);
    expect(check.distanceMetres, isNull);
    expect(locationRefuses(check.status, requireGeofence: true), isFalse);
  });

  test('a denied permission and a switched-off phone stay separate', () {
    expect(checkLocation(const DeviceFix(permissionDenied: true), fence, minAccuracyMetres: 50).status,
        LocationStatus.permissionDenied);
    expect(checkLocation(const DeviceFix(locationDisabled: true), fence, minAccuracyMetres: 50).status,
        LocationStatus.locationDisabled);
  });

  test('standing on the site verifies', () {
    final check = checkLocation(fixAt(14.5995, 120.9842), fence, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.verified);
    expect(check.distanceMetres!, lessThan(1));
    expect(locationRefuses(check.status, requireGeofence: true), isFalse);
  });

  test('just inside the fence still verifies', () {
    final check = checkLocation(fixAt(14.6004, 120.9842), fence, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.verified);
    expect(check.distanceMetres!, inInclusiveRange(90, 110));
  });

  test('a worker somewhere else is refused', () {
    final check = checkLocation(fixAt(14.6095, 120.9842), fence, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.outsideRadius);
    expect(check.distanceMetres!, greaterThan(1000));
    expect(locationRefuses(check.status, requireGeofence: false), isTrue);
  });

  test('a vague fix is recorded, never refused', () {
    final check = checkLocation(fixAt(14.5995, 120.9842, accuracy: 300), fence, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.lowAccuracy);
    expect(locationRefuses(check.status, requireGeofence: true), isFalse);
  });

  test('a mock location is refused however good it looks', () {
    const fix = DeviceFix(latitude: 14.5995, longitude: 120.9842, accuracyMetres: 12, isMock: true);
    final check = checkLocation(fix, fence, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.mockLocation);
    expect(locationRefuses(check.status, requireGeofence: false), isTrue);
  });

  test('an unconfigured project is refused only once geofences are required', () {
    final check = checkLocation(fixAt(14.5995, 120.9842), null, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.projectGeofenceUnavailable);
    expect(check.distanceMetres, isNull);
    expect(locationRefuses(check.status, requireGeofence: false), isFalse);
    expect(locationRefuses(check.status, requireGeofence: true), isTrue);
  });

  test('a disabled fence behaves as no fence', () {
    const off = Geofence(latitude: 14.5995, longitude: 120.9842, radiusMetres: 150, enabled: false);
    expect(checkLocation(fixAt(14.5995, 120.9842), off, minAccuracyMetres: 50).status,
        LocationStatus.projectGeofenceUnavailable);
  });

  test("permission and mock beat everything, in the server's order", () {
    const fix = DeviceFix(
        latitude: 14.7, longitude: 120.9842, accuracyMetres: 5, isMock: true, permissionDenied: true);
    expect(checkLocation(fix, fence, minAccuracyMetres: 50).status, LocationStatus.permissionDenied);
  });

  test('distance is kept even when the status was settled by something else', () {
    final check = checkLocation(fixAt(14.6095, 120.9842, accuracy: 400), fence, minAccuracyMetres: 50);
    expect(check.status, LocationStatus.lowAccuracy);
    expect(check.distanceMetres!, greaterThan(1000));
  });

  test("the fence used is carried back for the record's snapshot", () {
    expect(checkLocation(fixAt(14.5995, 120.9842), fence, minAccuracyMetres: 50).geofence, same(fence));
  });

  test('wire values match the codes the server stores', () {
    expect(LocationStatus.values.map((s) => s.wire), [
      'verified', 'outside_radius', 'low_accuracy', 'location_unavailable',
      'mock_location', 'permission_denied', 'location_disabled', 'project_geofence_unavailable',
    ]);
  });

  test('each refusal the device makes has a failure the screen can render', () {
    expect(failureForRefusal(LocationStatus.mockLocation), AttendanceFailure.mockLocation);
    expect(failureForRefusal(LocationStatus.permissionDenied), AttendanceFailure.locationPermissionDenied);
    expect(failureForRefusal(LocationStatus.locationDisabled), AttendanceFailure.locationDisabled);
    expect(failureForRefusal(LocationStatus.outsideRadius), AttendanceFailure.outsideRadius);
    expect(failureForRefusal(LocationStatus.verified), isNull);
  });
}
```

`test/attendance/domain/attendance_failure_test.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:workmate/attendance/domain/attendance_failure.dart';

PostgrestException rpcError(String code) => PostgrestException(message: code, code: 'P0001');

void main() {
  test('the whole documented error surface is mapped', () {
    const expected = {
      'ALREADY_TIMED_IN': AttendanceFailure.alreadyTimedIn,
      'NOT_TIMED_IN': AttendanceFailure.notTimedIn,
      'ALREADY_COMPLETE': AttendanceFailure.alreadyComplete,
      'TIMEOUT_BEFORE_TIMEIN': AttendanceFailure.timeOutBeforeTimeIn,
      'CAPTURED_IN_FUTURE': AttendanceFailure.deviceClockWrong,
      'SHIFT_TOO_LONG': AttendanceFailure.shiftTooLong,
      'PROJECT_UNAVAILABLE': AttendanceFailure.projectUnavailable,
      'NO_OWNER_ASSIGNED': AttendanceFailure.noOwnerAssigned,
      'ACCOUNT_INACTIVE': AttendanceFailure.accountInactive,
      'NOT_A_WORKER': AttendanceFailure.notAWorker,
      'AUTH_REQUIRED': AttendanceFailure.sessionExpired,
      'OUTSIDE_RADIUS': AttendanceFailure.outsideRadius,
      'MOCK_LOCATION': AttendanceFailure.mockLocation,
      'PERMISSION_DENIED': AttendanceFailure.locationPermissionDenied,
      'LOCATION_DISABLED': AttendanceFailure.locationDisabled,
      'PROJECT_GEOFENCE_UNAVAILABLE': AttendanceFailure.projectGeofenceUnavailable,
      'APP_UPDATE_REQUIRED': AttendanceFailure.appUpdateRequired,
      'EVENT_ID_CONFLICT': AttendanceFailure.unexpected,
      'EVENT_ID_REQUIRED': AttendanceFailure.unexpected,
    };
    expected.forEach((code, failure) => expect(AttendanceFailure.of(rpcError(code)), failure, reason: code));
  });

  test('PROJECT_GEOFENCE_UNAVAILABLE is not mistaken for PROJECT_UNAVAILABLE', () {
    expect(AttendanceFailure.of(rpcError('PROJECT_GEOFENCE_UNAVAILABLE')),
        AttendanceFailure.projectGeofenceUnavailable);
  });

  test('no signal is never reported as a rejected submission', () {
    expect(AttendanceFailure.of(const SocketException('dns')), AttendanceFailure.noConnection);
    expect(AttendanceFailure.of(TimeoutException('slow')), AttendanceFailure.noConnection);
    expect(AttendanceFailure.of(http.ClientException('closed')), AttendanceFailure.noConnection);
    expect(AttendanceFailure.of(AuthRetryableFetchException(message: 'offline')), AttendanceFailure.noConnection);
  });

  test('an unrecognised database error does not masquerade as a known one', () {
    expect(AttendanceFailure.of(rpcError('SOME_NEW_CODE_FROM_A_LATER_MIGRATION')), AttendanceFailure.unexpected);
  });
}
```

`test/attendance/domain/submission_queue_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_failure.dart';
import 'package:workmate/attendance/domain/submission_queue.dart';
import 'package:workmate/attendance/domain/work_date.dart';

void main() {
  const me = 'worker-a';
  QueuedSubmission pending(String id, TimeDirection d, String created, {String workerId = me}) =>
      QueuedSubmission(eventId: id, direction: d, createdAt: DateTime.parse(created), workerId: workerId);

  test('the queue drains oldest first', () {
    final out = pending('b', TimeDirection.timeOut, '2026-08-19T09:30:00Z');
    final timeIn = pending('a', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    expect(nextToSend([out, timeIn], me), same(timeIn));
  });

  test('a time out waits for its own time in even when it was queued first', () {
    final out = pending('b', TimeDirection.timeOut, '2026-08-18T23:00:00Z');
    final timeIn = pending('a', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    expect(nextToSend([out, timeIn], me), same(timeIn));
  });

  test('an empty queue has nothing to send', () => expect(nextToSend([], me), isNull));

  test('a lone time out is still sent', () {
    final out = pending('b', TimeDirection.timeOut, '2026-08-19T09:30:00Z');
    expect(nextToSend([out], me), same(out));
  });

  test("another worker's queued submission is never sent under my session", () {
    expect(nextToSend([pending('b', TimeDirection.timeIn, '2026-08-18T23:00:00Z', workerId: 'worker-b')], me), isNull);
  });

  test('my own submission is still sent when someone else\'s is queued too', () {
    final theirs = pending('b', TimeDirection.timeIn, '2026-08-18T23:00:00Z', workerId: 'worker-b');
    final mine = pending('a', TimeDirection.timeIn, '2026-08-19T00:00:00Z');
    expect(nextToSend([theirs, mine], me), same(mine));
  });

  test('a row with no owner is not sent to anyone', () {
    expect(nextToSend([pending('c', TimeDirection.timeIn, '2026-08-19T00:00:00Z', workerId: '')], me), isNull);
  });

  test('a refusal about the state of the day drops the row instead of retrying', () {
    expect(outcomeFor(AttendanceFailure.alreadyTimedIn), QueueOutcome.dropAndReconcile);
    expect(outcomeFor(AttendanceFailure.alreadyComplete), QueueOutcome.dropAndReconcile);
  });

  test('transient and fixable-elsewhere refusals are retried', () {
    for (final f in [
      AttendanceFailure.noConnection,
      AttendanceFailure.notTimedIn,
      AttendanceFailure.projectGeofenceUnavailable,
      AttendanceFailure.appUpdateRequired,
      AttendanceFailure.sessionExpired,
      AttendanceFailure.unexpected,
    ]) {
      expect(outcomeFor(f), QueueOutcome.retry, reason: f.name);
    }
  });

  test('a refusal the worker must act on is surfaced, not silently dropped', () {
    for (final f in [
      AttendanceFailure.outsideRadius,
      AttendanceFailure.mockLocation,
      AttendanceFailure.locationPermissionDenied,
      AttendanceFailure.locationDisabled,
      AttendanceFailure.deviceClockWrong,
      AttendanceFailure.timeOutBeforeTimeIn,
      AttendanceFailure.shiftTooLong,
      AttendanceFailure.projectUnavailable,
      AttendanceFailure.noOwnerAssigned,
      AttendanceFailure.accountInactive,
      AttendanceFailure.notAWorker,
    ]) {
      expect(outcomeFor(f), QueueOutcome.failPermanently, reason: f.name);
    }
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/attendance/domain`
Expected: FAIL on the three new files (missing sources); Task 1 files still pass.

- [ ] **Step 3: Implement**

`lib/attendance/domain/location_verification.dart`:

```dart
import 'dart:math';

import 'attendance_failure.dart';

/// Where the worker is, judged against where the project is. A PRE-CHECK: the
/// server verifies again (0069) and its answer is the one stored. Every rule
/// here matches 0069's attendance_check_location exactly. Refusals are only for
/// what is known bad; uncertainty is recorded and flagged, never refused.
enum LocationStatus {
  verified('verified'),
  outsideRadius('outside_radius'),
  lowAccuracy('low_accuracy'),
  locationUnavailable('location_unavailable'),
  mockLocation('mock_location'),
  permissionDenied('permission_denied'),

  /// Location switched OFF on the phone — a switch somebody flipped, not
  /// weather. Refused at the shutter, so never sent to the server.
  locationDisabled('location_disabled'),
  projectGeofenceUnavailable('project_geofence_unavailable');

  const LocationStatus(this.wire);
  final String wire;
}

/// A project's CURRENT fence as the device last cached it (the server keeps
/// them effective-dated and re-checks against the one in force at capture).
class Geofence {
  const Geofence({required this.latitude, required this.longitude, required this.radiusMetres, this.enabled = true});
  final double latitude;
  final double longitude;
  final double radiusMetres;
  final bool enabled;
}

/// What the device managed to observe at the shutter.
class DeviceFix {
  const DeviceFix({
    this.latitude,
    this.longitude,
    this.accuracyMetres,
    this.isMock = false,
    this.permissionDenied = false,
    this.locationDisabled = false,
  });
  final double? latitude;
  final double? longitude;
  final double? accuracyMetres;
  final bool isMock;
  final bool permissionDenied;
  final bool locationDisabled;
}

class LocationCheck {
  const LocationCheck({required this.status, this.distanceMetres, this.geofence});
  final LocationStatus status;
  final double? distanceMetres;
  final Geofence? geofence;
}

/// Mean earth radius, matching attendance_distance_m (0068).
const _earthRadiusM = 6371000.0;

double _rad(double degrees) => degrees * pi / 180;

/// Haversine in metres — the same formula and radius as the SQL, on purpose.
double distanceMetres(double lat1, double lng1, double lat2, double lng2) {
  final dLat = _rad(lat2 - lat1);
  final dLng = _rad(lng2 - lng1);
  final a = pow(sin(dLat / 2), 2) + cos(_rad(lat1)) * cos(_rad(lat2)) * pow(sin(dLng / 2), 2);
  return 2 * _earthRadiusM * asin(sqrt(a));
}

/// The check, in the same order the server applies it. Distance is computed
/// whenever there is a fix and a fence, even when the status is settled
/// otherwise — it is evidence for the admin.
LocationCheck checkLocation(DeviceFix fix, Geofence? fence, {required double minAccuracyMetres}) {
  final lat = fix.latitude;
  final lng = fix.longitude;
  final distance = (fence != null && lat != null && lng != null)
      ? distanceMetres(fence.latitude, fence.longitude, lat, lng)
      : null;

  final LocationStatus status;
  if (fix.permissionDenied) {
    status = LocationStatus.permissionDenied;
  } else if (fix.locationDisabled) {
    // BEFORE the null-coordinate branch: a phone with location off also has
    // no coordinates, and must not read as locationUnavailable.
    status = LocationStatus.locationDisabled;
  } else if (fix.isMock) {
    status = LocationStatus.mockLocation;
  } else if (lat == null || lng == null) {
    status = LocationStatus.locationUnavailable;
  } else if (fix.accuracyMetres == null || fix.accuracyMetres! > minAccuracyMetres) {
    status = LocationStatus.lowAccuracy;
  } else if (fence == null || !fence.enabled) {
    status = LocationStatus.projectGeofenceUnavailable;
  } else if (distance != null && distance > fence.radiusMetres) {
    status = LocationStatus.outsideRadius;
  } else {
    status = LocationStatus.verified;
  }
  return LocationCheck(status: status, distanceMetres: distance, geofence: fence);
}

/// Whether the app refuses to record this at all — the STRICT rule, with no
/// offline softening (the server softens outside_radius only for rows the
/// device already accepted). The device always passes requireGeofence: false.
bool locationRefuses(LocationStatus status, {required bool requireGeofence}) => switch (status) {
      LocationStatus.mockLocation ||
      LocationStatus.permissionDenied ||
      LocationStatus.locationDisabled ||
      LocationStatus.outsideRadius =>
        true,
      LocationStatus.projectGeofenceUnavailable => requireGeofence,
      LocationStatus.verified || LocationStatus.lowAccuracy || LocationStatus.locationUnavailable => false,
    };

/// The device's refusal as something the screen can render; null for statuses
/// that are recorded rather than refused.
AttendanceFailure? failureForRefusal(LocationStatus status) => switch (status) {
      LocationStatus.mockLocation => AttendanceFailure.mockLocation,
      LocationStatus.permissionDenied => AttendanceFailure.locationPermissionDenied,
      LocationStatus.locationDisabled => AttendanceFailure.locationDisabled,
      LocationStatus.outsideRadius => AttendanceFailure.outsideRadius,
      LocationStatus.projectGeofenceUnavailable => AttendanceFailure.projectGeofenceUnavailable,
      LocationStatus.verified || LocationStatus.lowAccuracy || LocationStatus.locationUnavailable => null,
    };
```

`lib/attendance/domain/attendance_failure.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart' show AuthRetryableFetchException;

/// Every way a Time In or Time Out can be refused. The RPCs raise stable codes
/// (0050/0051/0069/0077) precisely so this mapping can exist; anything else is
/// [unexpected], never a guess.
enum AttendanceFailure {
  alreadyTimedIn,
  notTimedIn,
  alreadyComplete,
  timeOutBeforeTimeIn,
  deviceClockWrong,
  shiftTooLong,
  projectUnavailable,
  noOwnerAssigned,
  accountInactive,
  notAWorker,
  outsideRadius,
  mockLocation,
  locationPermissionDenied,
  locationDisabled,
  projectGeofenceUnavailable,
  appUpdateRequired,
  sessionExpired,
  noConnection,
  unexpected;

  // EVENT_ID_CONFLICT / EVENT_ID_REQUIRED are deliberately absent: both mean
  // the app generated a bad event id — our bug, not something to tell a worker.
  // PROJECT_GEOFENCE_UNAVAILABLE does not contain PROJECT_UNAVAILABLE, so the
  // two cannot shadow each other.
  static const _byCode = <String, AttendanceFailure>{
    'ALREADY_TIMED_IN': alreadyTimedIn,
    'NOT_TIMED_IN': notTimedIn,
    'ALREADY_COMPLETE': alreadyComplete,
    'TIMEOUT_BEFORE_TIMEIN': timeOutBeforeTimeIn,
    'CAPTURED_IN_FUTURE': deviceClockWrong,
    'SHIFT_TOO_LONG': shiftTooLong,
    'PROJECT_UNAVAILABLE': projectUnavailable,
    'NO_OWNER_ASSIGNED': noOwnerAssigned,
    'ACCOUNT_INACTIVE': accountInactive,
    'NOT_A_WORKER': notAWorker,
    'AUTH_REQUIRED': sessionExpired,
    'OUTSIDE_RADIUS': outsideRadius,
    'MOCK_LOCATION': mockLocation,
    'PERMISSION_DENIED': locationPermissionDenied,
    'LOCATION_DISABLED': locationDisabled,
    'PROJECT_GEOFENCE_UNAVAILABLE': projectGeofenceUnavailable,
    'APP_UPDATE_REQUIRED': appUpdateRequired,
  };

  static AttendanceFailure of(Object error) {
    if (error is IOException ||
        error is TimeoutException ||
        error is http.ClientException ||
        error is AuthRetryableFetchException) {
      return noConnection;
    }
    final text = error.toString();
    for (final entry in _byCode.entries) {
      if (text.contains(entry.key)) return entry.value;
    }
    return unexpected;
  }
}
```

`lib/attendance/domain/submission_queue.dart`:

```dart
import 'attendance_failure.dart';
import 'work_date.dart';

/// A submission waiting to reach the server.
class QueuedSubmission {
  const QueuedSubmission({required this.eventId, required this.direction, required this.createdAt, required this.workerId});
  final String eventId;
  final TimeDirection direction;
  final DateTime createdAt;

  /// Who queued it. Empty for rows nobody can be identified for.
  final String workerId;
}

int _compare(QueuedSubmission a, QueuedSubmission b) {
  final byDirection = (a.direction == TimeDirection.timeIn ? 0 : 1) - (b.direction == TimeDirection.timeIn ? 0 : 1);
  return byDirection != 0 ? byDirection : a.createdAt.compareTo(b.createdAt);
}

/// Which queued submission to send next: an unsent Time In always before a Time
/// Out, otherwise oldest first — and only ever [currentWorkerId]'s own rows
/// (phones are shared; the RPC files each record against auth.uid()).
QueuedSubmission? nextToSend(List<QueuedSubmission> queue, String currentWorkerId) {
  QueuedSubmission? best;
  for (final q in queue) {
    if (q.workerId.isEmpty || q.workerId != currentWorkerId) continue;
    if (best == null || _compare(q, best) < 0) best = q;
  }
  return best;
}

enum QueueOutcome {
  /// Transient. Keep the row and try again later.
  retry,

  /// The server already holds this day. Reconcile to the server's row, drop ours.
  dropAndReconcile,

  /// Will never succeed; keep it visible so nobody believes the day was recorded.
  failPermanently,
}

QueueOutcome outcomeFor(AttendanceFailure failure) => switch (failure) {
      AttendanceFailure.alreadyTimedIn || AttendanceFailure.alreadyComplete => QueueOutcome.dropAndReconcile,
      // NotTimedIn: its Time In may still be one row ahead in this very queue.
      // ProjectGeofenceUnavailable: fixed by the office configuring the site.
      // AppUpdateRequired: the queue survives the APK update and sends the same row.
      AttendanceFailure.noConnection ||
      AttendanceFailure.notTimedIn ||
      AttendanceFailure.projectGeofenceUnavailable ||
      AttendanceFailure.appUpdateRequired ||
      AttendanceFailure.sessionExpired ||
      AttendanceFailure.unexpected =>
        QueueOutcome.retry,
      // Coordinates and captured_at are frozen at the shutter: a retry sends the
      // same values and earns the same refusal.
      AttendanceFailure.outsideRadius ||
      AttendanceFailure.mockLocation ||
      AttendanceFailure.locationPermissionDenied ||
      AttendanceFailure.locationDisabled ||
      AttendanceFailure.deviceClockWrong ||
      AttendanceFailure.timeOutBeforeTimeIn ||
      AttendanceFailure.shiftTooLong ||
      AttendanceFailure.projectUnavailable ||
      AttendanceFailure.noOwnerAssigned ||
      AttendanceFailure.accountInactive ||
      AttendanceFailure.notAWorker =>
        QueueOutcome.failPermanently,
    };
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/attendance/domain`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 3: Records, today's decision, history and description chips

**Files:**
- Create: `lib/attendance/domain/attendance_record.dart`, `lib/attendance/domain/today_reconcile.dart`, `lib/attendance/domain/history.dart`, `lib/attendance/domain/description_chips.dart`
- Test: `test/attendance/domain/attendance_record_test.dart`, `test/attendance/domain/today_reconcile_test.dart`, `test/attendance/domain/history_test.dart`, `test/attendance/domain/description_chips_test.dart`

**Interfaces:**
- Consumes: `Geofence` (Task 2), `TimeDirection`, `isoDate` (Task 1), `formatMinutes` (Task 1).
- Produces: `enum ProjectSystem { pc, pm }` with `wire`, `static ProjectSystem? of(String? wire)`; `class AttendanceProject { system, id, name, geofence; String get key; AttendanceProject withGeofence(Geofence? g) }`; `enum AttendanceStatus { working, complete, abandoned, unknown }` with `static parse(String?)`; `class AttendanceRecord { id, workDate, status, timeInAt, timeOutAt, timeInProjectName, timeOutProjectName, totalMinutes, timeInPhotoPath, timeOutPhotoPath, pending; TimeDirection? get nextAction; AttendanceRecord copyWith({bool? pending}); factory AttendanceRecord.fromRow(Map<String, dynamic>); static const columns }`; `sealed class TodayDecision` with `TodayUse(record)`, `TodayClear()`, `TodayUnknown()`; `TodayDecision reconcileToday({required bool serverAnswered, required AttendanceRecord? server, required AttendanceRecord? cached, required bool hasPending})`; `enum HistorySpan { week, month }`; `class DateRange { start, end }`; `DateRange historyRange(HistorySpan span, DateTime today)`; `class HistoryDay { workDate, date, record }`; `List<HistoryDay> historyDays(DateRange range, List<AttendanceRecord> records)`; `class HistorySummary { daysWorked, totalMinutes }`; `HistorySummary historySummary(List<HistoryDay> days)`; `class WeekDayCell { date, label, worked, isToday, future }`; `List<WeekDayCell> weekStrip(List<AttendanceRecord> records, DateTime today)`; `List<String> descriptionParts(String)`; `bool isChipSelected(String, String)`; `String toggleDescriptionChip(String, String)`.

- [ ] **Step 1: Write the failing tests**

`test/attendance/domain/attendance_record_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/work_date.dart';

void main() {
  test('a project is identified by the pair, never the id alone', () {
    const pc = AttendanceProject(system: ProjectSystem.pc, id: 'x', name: 'A');
    const pm = AttendanceProject(system: ProjectSystem.pm, id: 'x', name: 'B');
    expect(pc.key, 'pc:x');
    expect(pc.key == pm.key, isFalse);
  });

  test('an unknown project system is null, not a guess', () {
    expect(ProjectSystem.of('pc'), ProjectSystem.pc);
    expect(ProjectSystem.of('PM'), ProjectSystem.pm);
    expect(ProjectSystem.of('xx'), isNull);
    expect(ProjectSystem.of(null), isNull);
  });

  test('status parsing never crashes on a new value', () {
    expect(AttendanceStatus.parse('working'), AttendanceStatus.working);
    expect(AttendanceStatus.parse('ABANDONED'), AttendanceStatus.abandoned);
    expect(AttendanceStatus.parse('something'), AttendanceStatus.unknown);
  });

  test('a server row maps, including Postgres timestamps with microseconds and offsets', () {
    final r = AttendanceRecord.fromRow({
      'id': 'r1',
      'work_date': '2026-08-19',
      'status': 'complete',
      'timein_at': '2026-08-19T07:45:00.123456+08:00',
      'timeout_at': '2026-08-19T17:30:00+08:00',
      'timein_project_name': 'ABC',
      'timeout_project_name': 'ABC',
      'total_minutes': 585,
      'timein_photo_path': 'w/2026-08-19/in-e.jpg',
      'extra_admin_column': 'ignored',
    });
    expect(r.timeInAt, DateTime.parse('2026-08-18T23:45:00.123456Z'));
    expect(r.timeOutAt!.isUtc, isTrue);
    expect(r.totalMinutes, 585);
    expect(r.timeOutPhotoPath, isNull);
    expect(r.pending, isFalse);
  });

  test('only a working day offers Time Out; a closed day offers nothing', () {
    AttendanceRecord r(AttendanceStatus s) => AttendanceRecord(id: 'r', workDate: '2026-08-19', status: s);
    expect(r(AttendanceStatus.working).nextAction, TimeDirection.timeOut);
    expect(r(AttendanceStatus.complete).nextAction, isNull);
    expect(r(AttendanceStatus.abandoned).nextAction, isNull);
  });
}
```

`test/attendance/domain/today_reconcile_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/today_reconcile.dart';

void main() {
  final cached = AttendanceRecord(
    id: 'local',
    workDate: '2026-08-25',
    status: AttendanceStatus.working,
    timeInAt: DateTime.parse('2026-08-24T23:45:00Z'),
    timeInProjectName: 'ABC Building Project',
    pending: true,
  );
  final server = cached.copyWith(pending: false);

  test("the server's row wins whenever the server answers", () {
    final d = reconcileToday(serverAnswered: true, server: server, cached: cached, hasPending: false);
    expect(d, isA<TodayUse>().having((u) => u.record, 'record', same(server)));
  });

  test('offline falls back to what the phone remembers', () {
    final d = reconcileToday(serverAnswered: false, server: null, cached: cached, hasPending: true);
    expect(d, isA<TodayUse>().having((u) => u.record, 'record', same(cached)));
  });

  test('a queued submission survives the server saying there is nothing yet', () {
    final d = reconcileToday(serverAnswered: true, server: null, cached: cached, hasPending: true);
    expect(d, isA<TodayUse>().having((u) => u.record, 'record', same(cached)));
  });

  test('with nothing queued, the server saying no record clears a stale mirror', () {
    expect(reconcileToday(serverAnswered: true, server: null, cached: cached, hasPending: false), isA<TodayClear>());
  });

  test('offline with nothing cached is unknown, not empty', () {
    expect(reconcileToday(serverAnswered: false, server: null, cached: null, hasPending: false), isA<TodayUnknown>());
  });

  test('no record anywhere and nothing queued really is an empty day', () {
    expect(reconcileToday(serverAnswered: true, server: null, cached: null, hasPending: false), isA<TodayClear>());
  });
}
```

`test/attendance/domain/history_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/history.dart';
import 'package:workmate/attendance/domain/total_hours.dart';

void main() {
  final today = DateTime.utc(2026, 8, 26); // a Wednesday
  AttendanceRecord rec(String id, String day, AttendanceStatus s, {int? minutes}) =>
      AttendanceRecord(id: id, workDate: day, status: s, totalMinutes: minutes);

  test('this week runs Monday to today, not seven days back', () {
    final r = historyRange(HistorySpan.week, today);
    expect(r.start, DateTime.utc(2026, 8, 24));
    expect(r.end, today);
  });

  test('this month runs from the first, not thirty days back', () {
    final r = historyRange(HistorySpan.month, today);
    expect(r.start, DateTime.utc(2026, 8, 1));
    expect(r.end, today);
  });

  test('a day with no record still appears, newest first', () {
    final worked = rec('r1', '2026-08-25', AttendanceStatus.complete, minutes: 585);
    final days = historyDays(historyRange(HistorySpan.week, today), [worked]);
    expect(days.map((d) => d.workDate), ['2026-08-26', '2026-08-25', '2026-08-24']);
    expect(days[0].record, isNull);
    expect(days[1].record, same(worked));
    expect(days[2].record, isNull);
  });

  test('a record outside the range is not shown', () {
    final days = historyDays(historyRange(HistorySpan.week, today), [rec('old', '2026-08-01', AttendanceStatus.complete)]);
    expect(days.length, 3);
    expect(days.every((d) => d.record == null), isTrue);
  });

  test('the totals summarise only the days that were worked', () {
    final s = historySummary(historyDays(historyRange(HistorySpan.week, today), [
      rec('a', '2026-08-25', AttendanceStatus.complete, minutes: 585),
      rec('b', '2026-08-24', AttendanceStatus.complete, minutes: 480),
    ]));
    expect(s.daysWorked, 2);
    expect(s.totalMinutes, 1065);
    expect(formatMinutes(s.totalMinutes), '17h 45m');
  });

  test('a still-open day contributes no hours to the total', () {
    final s = historySummary(historyDays(historyRange(HistorySpan.week, today), [rec('a', '2026-08-26', AttendanceStatus.working)]));
    expect(s.daysWorked, 1);
    expect(s.totalMinutes, 0);
  });

  test('the week strip is Monday to Saturday, six cells', () {
    final cells = weekStrip([rec('a', '2026-08-24', AttendanceStatus.complete)], today);
    expect(cells.map((c) => c.label), ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
    expect(cells[0].worked, isTrue);
    expect(cells[2].isToday, isTrue);
    expect(cells[3].future, isTrue);
    expect(cells[1].worked, isFalse);
  });
}
```

`test/attendance/domain/description_chips_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/description_chips.dart';

void main() {
  test('tapping a chip on an empty box fills it', () => expect(toggleDescriptionChip('', 'Masonry'), 'Masonry'));
  test('a second chip is added, not substituted',
      () => expect(toggleDescriptionChip('Masonry', 'Concrete pouring'), 'Masonry, Concrete pouring'));
  test('tapping a chip that is already there removes it',
      () => expect(toggleDescriptionChip('Masonry, Concrete pouring', 'Masonry'), 'Concrete pouring'));
  test('removing the only chip empties the box', () => expect(toggleDescriptionChip('Masonry', 'Masonry'), ''));
  test('typed text survives a chip being added',
      () => expect(toggleDescriptionChip('Gate 2, may delivery', 'Masonry'), 'Gate 2, may delivery, Masonry'));
  test('typed text survives a chip being removed',
      () => expect(toggleDescriptionChip('Gate 2, may delivery, Masonry', 'Masonry'), 'Gate 2, may delivery'));

  test('a newline stays inside its part instead of splitting it', () {
    const typed = 'Gate 2\nmay delivery';
    expect(descriptionParts(typed), [typed]);
    expect(toggleDescriptionChip(typed, 'Masonry'), '$typed, Masonry');
  });

  test('a chip already typed by hand is not duplicated', () {
    expect(isChipSelected('masonry', 'Masonry'), isTrue);
    expect(toggleDescriptionChip('masonry', 'Masonry'), '');
  });

  test('selection only matches a whole part', () {
    expect(isChipSelected('Masonry work', 'Masonry'), isFalse);
    expect(toggleDescriptionChip('Masonry work', 'Masonry'), 'Masonry work, Masonry');
  });

  test('stray separators do not become empty parts', () {
    expect(descriptionParts('Masonry, , '), ['Masonry']);
    expect(toggleDescriptionChip('Masonry, , ', 'Masonry'), '');
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/attendance/domain`
Expected: FAIL on the four new files.

- [ ] **Step 3: Implement**

`lib/attendance/domain/attendance_record.dart`:

```dart
import 'location_verification.dart';
import 'work_date.dart';

/// WHICH project list a project came from (0059): PC -> folders,
/// PM -> construction_projects. Ids are only unique within a system.
enum ProjectSystem {
  pc('pc'),
  pm('pm');

  const ProjectSystem(this.wire);
  final String wire;

  /// Null for anything the server has not taught us about yet.
  static ProjectSystem? of(String? wire) {
    final w = wire?.toLowerCase();
    for (final s in values) {
      if (s.wire == w) return s;
    }
    return null;
  }
}

class AttendanceProject {
  const AttendanceProject({required this.system, required this.id, required this.name, this.geofence});
  final ProjectSystem system;
  final String id;
  final String name;

  /// Null = the phone has never seen a fence; the server still checks.
  final Geofence? geofence;

  /// "pc:<uuid>" for list keys. Never sent to the server.
  String get key => '${system.wire}:$id';

  AttendanceProject withGeofence(Geofence? g) => AttendanceProject(system: system, id: id, name: name, geofence: g);
}

/// The §14 status machine. `abandoned` is set by an admin sweep; the app must
/// render it rather than crash on an unknown value.
enum AttendanceStatus {
  working,
  complete,
  abandoned,
  unknown;

  static AttendanceStatus parse(String? raw) => switch (raw?.toLowerCase()) {
        'working' => working,
        'complete' => complete,
        'abandoned' => abandoned,
        _ => unknown,
      };
}

DateTime? _instant(Object? raw) => raw == null ? null : DateTime.tryParse(raw.toString())?.toUtc();

class AttendanceRecord {
  const AttendanceRecord({
    required this.id,
    required this.workDate,
    required this.status,
    this.timeInAt,
    this.timeOutAt,
    this.timeInProjectName,
    this.timeOutProjectName,
    this.totalMinutes,
    this.timeInPhotoPath,
    this.timeOutPhotoPath,
    this.pending = false,
  });

  /// Only the columns the app renders; location columns are admin-only.
  static const columns = 'id,work_date,status,timein_at,timeout_at,'
      'timein_project_name,timeout_project_name,total_minutes,'
      'timein_photo_path,timeout_photo_path';

  factory AttendanceRecord.fromRow(Map<String, dynamic> row) => AttendanceRecord(
        id: row['id'] as String,
        workDate: row['work_date'] as String,
        status: AttendanceStatus.parse(row['status'] as String?),
        timeInAt: _instant(row['timein_at']),
        timeOutAt: _instant(row['timeout_at']),
        timeInProjectName: row['timein_project_name'] as String?,
        timeOutProjectName: row['timeout_project_name'] as String?,
        totalMinutes: (row['total_minutes'] as num?)?.toInt(),
        timeInPhotoPath: row['timein_photo_path'] as String?,
        timeOutPhotoPath: row['timeout_photo_path'] as String?,
      );

  final String id;
  final String workDate;
  final AttendanceStatus status;
  final DateTime? timeInAt;
  final DateTime? timeOutAt;
  final String? timeInProjectName;
  final String? timeOutProjectName;
  final int? totalMinutes;
  final String? timeInPhotoPath;
  final String? timeOutPhotoPath;

  /// True while this day is still only on the phone ("will sync").
  final bool pending;

  /// What the worker may do next. Complete or abandoned: the day is closed
  /// (one record per worker per day), so Time In is never offered again.
  TimeDirection? get nextAction => status == AttendanceStatus.working ? TimeDirection.timeOut : null;

  AttendanceRecord copyWith({bool? pending}) => AttendanceRecord(
        id: id,
        workDate: workDate,
        status: status,
        timeInAt: timeInAt,
        timeOutAt: timeOutAt,
        timeInProjectName: timeInProjectName,
        timeOutProjectName: timeOutProjectName,
        totalMinutes: totalMinutes,
        timeInPhotoPath: timeInPhotoPath,
        timeOutPhotoPath: timeOutPhotoPath,
        pending: pending ?? this.pending,
      );
}
```

`lib/attendance/domain/today_reconcile.dart`:

```dart
import 'attendance_record.dart';

sealed class TodayDecision {}

/// Show this record.
final class TodayUse extends TodayDecision {
  TodayUse(this.record);
  final AttendanceRecord record;
}

/// There is genuinely no record today; drop any stale mirror.
final class TodayClear extends TodayDecision {}

/// We could not find out. Not the same as "no record".
final class TodayUnknown extends TodayDecision {}

/// Reconciles the server, the local mirror and the queue. "The server has no
/// record" and "the server could not be reached" demand opposite behaviour, and
/// a still-queued submission makes "no server row" the EXPECTED state.
TodayDecision reconcileToday({
  required bool serverAnswered,
  required AttendanceRecord? server,
  required AttendanceRecord? cached,
  required bool hasPending,
}) {
  if (serverAnswered) {
    if (server != null) return TodayUse(server);
    if (hasPending && cached != null) return TodayUse(cached);
    return TodayClear();
  }
  return cached != null ? TodayUse(cached) : TodayUnknown();
}
```

`lib/attendance/domain/history.dart`:

```dart
import 'attendance_record.dart';
import 'work_date.dart';

enum HistorySpan { week, month }

/// Inclusive range of calendar dates (UTC midnights).
class DateRange {
  const DateRange(this.start, this.end);
  final DateTime start;
  final DateTime end;
}

/// "This week" is Monday-to-today and "this month" is the 1st-to-today — the
/// week the worker is standing in, not a rolling window. [today] is a UTC
/// midnight in Manila terms (use manilaDate(DateTime.now())).
DateRange historyRange(HistorySpan span, DateTime today) {
  final start = span == HistorySpan.week
      ? today.subtract(Duration(days: today.weekday - DateTime.monday))
      : DateTime.utc(today.year, today.month, 1);
  return DateRange(start, today);
}

class HistoryDay {
  const HistoryDay({required this.workDate, required this.date, required this.record});
  final String workDate;
  final DateTime date;
  final AttendanceRecord? record;
}

/// Every day in the range, newest first, WITH the days that have no record —
/// the gaps are what a worker checking their attendance needs to see.
List<HistoryDay> historyDays(DateRange range, List<AttendanceRecord> records) {
  final byDate = {for (final r in records) r.workDate: r};
  final days = <HistoryDay>[];
  for (var d = range.end; !d.isBefore(range.start); d = d.subtract(const Duration(days: 1))) {
    final key = isoDate(d);
    days.add(HistoryDay(workDate: key, date: d, record: byDate[key]));
  }
  return days;
}

class HistorySummary {
  const HistorySummary({required this.daysWorked, required this.totalMinutes});
  final int daysWorked;
  final int totalMinutes;
}

/// An open day counts as worked but adds ZERO minutes: total_minutes is the
/// server's to compute.
HistorySummary historySummary(List<HistoryDay> days) {
  final worked = days.where((d) => d.record != null).toList();
  return HistorySummary(
    daysWorked: worked.length,
    totalMinutes: worked.fold(0, (sum, d) => sum + (d.record!.totalMinutes ?? 0)),
  );
}

class WeekDayCell {
  const WeekDayCell({required this.date, required this.label, required this.worked, required this.isToday, required this.future});
  final DateTime date;
  final String label;
  final bool worked;
  final bool isToday;
  final bool future;
}

const _weekLabels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/// Monday to Saturday of [today]'s week: SIX cells — DACs does not schedule
/// Sunday work, and an always-empty seventh column would read as a missed day.
List<WeekDayCell> weekStrip(List<AttendanceRecord> records, DateTime today) {
  final monday = today.subtract(Duration(days: today.weekday - DateTime.monday));
  final worked = records.map((r) => r.workDate).toSet();
  return [
    for (var i = 0; i < 6; i++)
      () {
        final day = monday.add(Duration(days: i));
        return WeekDayCell(
          date: day,
          label: _weekLabels[i],
          worked: worked.contains(isoDate(day)),
          isToday: day == today,
          future: day.isAfter(today),
        );
      }(),
  ];
}
```

`lib/attendance/domain/description_chips.dart`:

```dart
/// The "Or tap a common one" chips as a pure operation on the description.
/// ADDITIVE: nothing a worker typed is ever discarded.
const _separator = ', ';

/// Split on commas only (a newline stays inside its part), blanks dropped.
List<String> descriptionParts(String description) =>
    description.split(',').map((p) => p.trim()).where((p) => p.isNotEmpty).toList();

bool isChipSelected(String description, String chip) =>
    descriptionParts(description).any((p) => p.toLowerCase() == chip.toLowerCase());

/// Adds [chip], or removes it if already there (case-insensitive match; the
/// chip's own capitalisation is what gets stored).
String toggleDescriptionChip(String description, String chip) {
  final parts = descriptionParts(description);
  final without = parts.where((p) => p.toLowerCase() != chip.toLowerCase()).toList();
  return without.length == parts.length ? [...parts, chip].join(_separator) : without.join(_separator);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/attendance/domain`
Expected: PASS (all Task 1-3 domain tests).

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 4: The native bridge (clock, connectivity, GPS fix, photo) and the trusted clock

**Files:**
- Create: `android/app/src/main/kotlin/com/dacs/workmate/PhotoMath.kt`, `android/app/src/main/kotlin/com/dacs/workmate/PhotoPreparer.kt`, `android/app/src/main/kotlin/com/dacs/workmate/AttendanceBridge.kt`, `android/app/src/test/kotlin/com/dacs/workmate/PhotoMathTest.kt`, `lib/attendance/device/device_bridge.dart`, `lib/attendance/device/clock_anchor_store.dart`
- Modify: `android/app/src/main/kotlin/com/dacs/workmate/MainActivity.kt`, `android/app/build.gradle.kts` (dependencies), `android/app/src/main/AndroidManifest.xml` (location permissions), `lib/main.dart` (wire the Date header into the anchor store)
- Test: `test/attendance/device/device_bridge_test.dart`, `test/attendance/device/clock_anchor_store_test.dart`

**Interfaces:**
- Consumes: `DeviceFix` (Task 2), `ClockAnchor`, `trustedTime`, `parseServerDate` (Task 1), `WorkMateHttpClient.onServerDate` (0B).
- Produces: native channel `com.dacs.workmate/attendance` with methods `clock` → `{uptimeMillis: Long, bootCount: Int?}`, `isOnline` → `Boolean`, `currentFix` → `{latitude?, longitude?, accuracyMetres?, isMock?, permissionDenied?, locationDisabled?}`, `preparePhoto({source, target, caption})` → target path; Dart `class DeviceClockReading { uptimeMillis, bootCount }`; `abstract class DeviceBridge { Future<DeviceClockReading> clock(); Future<bool> isOnline(); Future<DeviceFix> currentFix(); Future<String> preparePhoto({required String source, required String target, required String caption}); }`; `class MethodChannelDeviceBridge implements DeviceBridge`; `DeviceFix deviceFixFromMap(Map<Object?, Object?> map)`; `class ClockAnchorStore { ClockAnchorStore(SharedPreferences, DeviceBridge); Future<void> recordServerDate(String header); Future<DateTime?> now(); }`.

- [ ] **Step 1: Write the failing Dart tests**

`test/attendance/device/device_bridge_test.dart`:

```dart
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/device/device_bridge.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.dacs.workmate/attendance');
  final calls = <MethodCall>[];

  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      switch (call.method) {
        case 'clock':
          return {'uptimeMillis': 123456789, 'bootCount': 7};
        case 'isOnline':
          return true;
        case 'currentFix':
          return {'latitude': 14.5, 'longitude': 121.0, 'accuracyMetres': 8.5, 'isMock': false};
        case 'preparePhoto':
          return (call.arguments as Map)['target'];
      }
      return null;
    });
  });

  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));

  test('clock reads uptime and boot count', () async {
    final c = await MethodChannelDeviceBridge().clock();
    expect(c.uptimeMillis, 123456789);
    expect(c.bootCount, 7);
  });

  test('a fix map becomes a DeviceFix', () async {
    final f = await MethodChannelDeviceBridge().currentFix();
    expect(f.latitude, 14.5);
    expect(f.accuracyMetres, 8.5);
    expect(f.permissionDenied, isFalse);
  });

  test('refusal flags and missing coordinates map faithfully', () {
    expect(deviceFixFromMap({'permissionDenied': true}).permissionDenied, isTrue);
    expect(deviceFixFromMap({'locationDisabled': true}).locationDisabled, isTrue);
    final none = deviceFixFromMap({});
    expect(none.latitude, isNull);
    expect(none.isMock, isFalse);
    expect(deviceFixFromMap({'latitude': 14, 'longitude': 121, 'accuracyMetres': 5}).latitude, 14.0);
  });

  test('preparePhoto passes source, target and caption', () async {
    final out = await MethodChannelDeviceBridge().preparePhoto(source: '/c/raw.jpg', target: '/f/e.jpg', caption: 'A · 1 Sep 2026 · 3:00 PM');
    expect(out, '/f/e.jpg');
    expect(calls.single.arguments, {'source': '/c/raw.jpg', 'target': '/f/e.jpg', 'caption': 'A · 1 Sep 2026 · 3:00 PM'});
  });
}
```

`test/attendance/device/clock_anchor_store_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/attendance/device/clock_anchor_store.dart';
import 'package:workmate/attendance/device/device_bridge.dart';
import 'package:workmate/attendance/domain/location_verification.dart';

class FakeBridge implements DeviceBridge {
  int uptime = 1000000;
  int? boot = 3;
  @override
  Future<DeviceClockReading> clock() async => DeviceClockReading(uptimeMillis: uptime, bootCount: boot);
  @override
  Future<bool> isOnline() async => true;
  @override
  Future<DeviceFix> currentFix() async => const DeviceFix();
  @override
  Future<String> preparePhoto({required String source, required String target, required String caption}) async => target;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('no Date header seen yet: no trusted time', () async {
    final store = ClockAnchorStore(await SharedPreferences.getInstance(), FakeBridge());
    expect(await store.now(), isNull);
  });

  test('trusted now = server Date + uptime elapsed since it arrived', () async {
    final bridge = FakeBridge();
    final store = ClockAnchorStore(await SharedPreferences.getInstance(), bridge);
    await store.recordServerDate('Sun, 27 Sep 2026 17:12:43 GMT');
    bridge.uptime += 90000;
    expect(await store.now(), DateTime.parse('2026-09-27T17:14:13Z'));
  });

  test('a reboot since the anchor voids it', () async {
    final bridge = FakeBridge();
    final store = ClockAnchorStore(await SharedPreferences.getInstance(), bridge);
    await store.recordServerDate('Sun, 27 Sep 2026 17:12:43 GMT');
    bridge.boot = 4;
    expect(await store.now(), isNull);
  });

  test('an unreadable Date header leaves the previous anchor alone', () async {
    final bridge = FakeBridge();
    final store = ClockAnchorStore(await SharedPreferences.getInstance(), bridge);
    await store.recordServerDate('Sun, 27 Sep 2026 17:12:43 GMT');
    await store.recordServerDate('garbage');
    expect(await store.now(), DateTime.parse('2026-09-27T17:12:43Z'));
  });

  test('an unknown boot count is stored as unknown, not as zero', () async {
    final bridge = FakeBridge()..boot = null;
    final store = ClockAnchorStore(await SharedPreferences.getInstance(), bridge);
    await store.recordServerDate('Sun, 27 Sep 2026 17:12:43 GMT');
    bridge.boot = 9;
    expect(await store.now(), isNotNull);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/attendance/device`
Expected: FAIL — `package:workmate/attendance/device/...` does not exist.

- [ ] **Step 3: Implement the Dart side**

`lib/attendance/device/device_bridge.dart`:

```dart
import 'package:flutter/services.dart';

import '../domain/location_verification.dart';

class DeviceClockReading {
  const DeviceClockReading({required this.uptimeMillis, required this.bootCount});

  /// SystemClock.elapsedRealtime(): counts forward from boot, untouchable from Settings.
  final int uptimeMillis;

  /// Settings.Global.BOOT_COUNT, or null when the phone does not say.
  final int? bootCount;
}

/// What only Android can do for attendance. An interface so the rules and
/// repositories test without a phone. Not available in the background sync
/// isolate (nothing there needs it).
abstract class DeviceBridge {
  Future<DeviceClockReading> clock();

  /// A VALIDATED internet connection right now (fills was_offline).
  Future<bool> isOnline();

  /// One fresh fix at the shutter. Never throws: every failure is a DeviceFix.
  Future<DeviceFix> currentFix();

  /// Upright, scaled to 1600 px, caption burned in, JPEG 80 at [target];
  /// deletes [source]. Returns [target].
  Future<String> preparePhoto({required String source, required String target, required String caption});
}

double? _double(Object? v) => (v as num?)?.toDouble();

DeviceFix deviceFixFromMap(Map<Object?, Object?> map) => DeviceFix(
      latitude: _double(map['latitude']),
      longitude: _double(map['longitude']),
      accuracyMetres: _double(map['accuracyMetres']),
      isMock: map['isMock'] == true,
      permissionDenied: map['permissionDenied'] == true,
      locationDisabled: map['locationDisabled'] == true,
    );

class MethodChannelDeviceBridge implements DeviceBridge {
  static const _channel = MethodChannel('com.dacs.workmate/attendance');

  @override
  Future<DeviceClockReading> clock() async {
    final m = await _channel.invokeMapMethod<Object?, Object?>('clock') ?? const {};
    return DeviceClockReading(
      uptimeMillis: (m['uptimeMillis'] as num).toInt(),
      bootCount: (m['bootCount'] as num?)?.toInt(),
    );
  }

  @override
  Future<bool> isOnline() async => await _channel.invokeMethod<bool>('isOnline') ?? false;

  @override
  Future<DeviceFix> currentFix() async {
    try {
      return deviceFixFromMap(await _channel.invokeMapMethod<Object?, Object?>('currentFix') ?? const {});
    } catch (_) {
      // "The phone could not tell" is flagged, never a lockout.
      return const DeviceFix();
    }
  }

  @override
  Future<String> preparePhoto({required String source, required String target, required String caption}) async =>
      await _channel.invokeMethod<String>('preparePhoto', {'source': source, 'target': target, 'caption': caption}) ??
      target;
}
```

`lib/attendance/device/clock_anchor_store.dart`:

```dart
import 'package:shared_preferences/shared_preferences.dart';

import '../domain/trusted_time.dart';
import 'device_bridge.dart';

/// Where the last server clock reading lives (plain prefs: nothing secret, and
/// a keystore hiccup must never cost the anchor).
class ClockAnchorStore {
  ClockAnchorStore(this._prefs, this._bridge);

  final SharedPreferences _prefs;
  final DeviceBridge _bridge;

  static const _server = 'clock.server_ms';
  static const _uptime = 'clock.uptime_ms';
  static const _boot = 'clock.boot_count';

  /// Called for every server response; the newest reading wins.
  Future<void> recordServerDate(String header) async {
    final server = parseServerDate(header);
    if (server == null) return;
    final clock = await _bridge.clock();
    await _prefs.setInt(_server, server.millisecondsSinceEpoch);
    await _prefs.setInt(_uptime, clock.uptimeMillis);
    await _prefs.setInt(_boot, clock.bootCount ?? -1);
  }

  /// The trusted time now, or null when it cannot be vouched for.
  Future<DateTime?> now() async {
    final serverMs = _prefs.getInt(_server);
    if (serverMs == null) return null;
    final boot = _prefs.getInt(_boot) ?? -1;
    final anchor = ClockAnchor(
      serverTime: DateTime.fromMillisecondsSinceEpoch(serverMs, isUtc: true),
      uptimeMillis: _prefs.getInt(_uptime) ?? 0,
      bootCount: boot >= 0 ? boot : null,
    );
    final clock = await _bridge.clock();
    return trustedTime(anchor, uptimeNowMillis: clock.uptimeMillis, bootCountNow: clock.bootCount);
  }
}
```

- [ ] **Step 4: Run the Dart tests to verify they pass**

Run: `flutter test test/attendance/device`
Expected: PASS.

- [ ] **Step 5: Write the Kotlin test (ported from DACS Attendance)**

`android/app/src/test/kotlin/com/dacs/workmate/PhotoMathTest.kt`:

```kotlin
package com.dacs.workmate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoMathTest {
    private val budget = 1600

    private fun measurer(charWidthAt1pt: Float, text: String): (Float) -> Float =
        { size -> text.length * charWidthAt1pt * size }

    @Test fun `text that already fits is left alone`() {
        assertEquals(40f, fitTextSize(40f, 1000f, measurer(0.5f, "short")), 0.01f)
    }

    @Test fun `text that overflows is shrunk until it fits`() {
        val caption = "ABC Building Project · 25 Aug 2026 · 8:45 PM"
        val measure = measurer(0.6f, caption)
        val size = fitTextSize(40f, 600f, measure)
        assertTrue(size < 40f)
        assertTrue(measure(size) <= 600f)
    }

    @Test fun `shrinking stops at a floor rather than becoming unreadable`() {
        val size = fitTextSize(40f, 10f, measurer(1f, "an extremely long caption that cannot fit"))
        assertEquals(MIN_CAPTION_TEXT_SIZE_RATIO * 40f, size, 0.01f)
    }

    @Test fun `a capture already inside the budget is decoded whole`() {
        assertEquals(1, photoSampleSize(1600, 1200, budget))
        assertEquals(1, photoSampleSize(800, 600, budget))
    }

    @Test fun `orientation does not matter`() {
        assertEquals(photoSampleSize(4000, 3000, budget), photoSampleSize(3000, 4000, budget))
    }

    @Test fun `a 12 MP capture halves once and a 32 MP capture quarters`() {
        assertEquals(2, photoSampleSize(4000, 3000, budget))
        assertEquals(4, photoSampleSize(6528, 4896, budget))
    }

    @Test fun `sampling never takes a capture below the budget and is a power of two`() {
        for (longest in listOf(1600, 1601, 2400, 3200, 4000, 6528, 9000, 12000, 20000)) {
            val sample = photoSampleSize(longest, longest / 2, budget)
            assertTrue(longest / sample >= budget)
            assertTrue(sample > 0 && sample and (sample - 1) == 0)
        }
    }

    @Test fun `a bitmap that could not be measured decodes whole`() {
        assertEquals(1, photoSampleSize(-1, -1, budget))
        assertEquals(1, photoSampleSize(0, 0, budget))
    }
}
```

- [ ] **Step 6: Implement the Kotlin side**

`android/app/src/main/kotlin/com/dacs/workmate/PhotoMath.kt`:

```kotlin
package com.dacs.workmate

/** Below this the caption is unreadable on a phone, no better than cut off. */
const val MIN_CAPTION_TEXT_SIZE_RATIO = 0.55f

/**
 * The largest text size at or below [preferred] whose width fits [maxWidth].
 * The timestamp ("PM") is the part that must never be lost off the edge.
 */
fun fitTextSize(preferred: Float, maxWidth: Float, measure: (Float) -> Float): Float {
    if (measure(preferred) <= maxWidth) return preferred
    val floor = preferred * MIN_CAPTION_TEXT_SIZE_RATIO
    var size = preferred
    while (size > floor) {
        size -= preferred * 0.05f
        if (measure(size) <= maxWidth) return size
    }
    return floor
}

/**
 * How far down to sample while decoding, so a 13 MP selfie (52 MB as ARGB_8888)
 * never exists at full size on a phone capped at 96 MB. Powers of two only,
 * and never below [maxEdge]; an unmeasurable file decodes whole.
 */
fun photoSampleSize(width: Int, height: Int, maxEdge: Int): Int {
    val longest = maxOf(width, height)
    if (longest <= 0 || maxEdge <= 0) return 1
    var sample = 1
    while (longest / (sample * 2) >= maxEdge) sample *= 2
    return sample
}
```

`android/app/src/main/kotlin/com/dacs/workmate/PhotoPreparer.kt`:

```kotlin
package com.dacs.workmate

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import androidx.exifinterface.media.ExifInterface
import java.io.File

/** Longest edge and quality of a filed attendance photo (DACS Attendance PhotoStore). */
private const val MAX_EDGE_PX = 1600
private const val JPEG_QUALITY = 80

/**
 * Turns a fresh capture into the file that gets uploaded: upright, caption
 * burned in (it must survive export and download), compressed to ~300 KB,
 * app-private. Ported from DACS Attendance PhotoStore.prepare.
 */
object PhotoPreparer {

    fun prepare(source: File, target: File, caption: String) {
        val upright = decodeUpright(source)
        val scaled = scaleToBudget(upright)
        if (scaled !== upright) upright.recycle()
        drawCaption(scaled, caption)
        target.parentFile?.mkdirs()
        target.outputStream().use { out -> scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out) }
        scaled.recycle()
        // The raw capture has no caption and must never be the thing that is sent.
        source.delete()
    }

    /** EXIF rotation AND mirror (front camera), sampled so the full-size bitmap never exists. */
    private fun decodeUpright(source: File): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        val bitmap = BitmapFactory.decodeFile(
            source.absolutePath,
            BitmapFactory.Options().apply {
                inMutable = true
                inSampleSize = photoSampleSize(bounds.outWidth, bounds.outHeight, MAX_EDGE_PX)
            }
        ) ?: error("Could not decode captured photo")

        val exif = ExifInterface(source.absolutePath)
        val degrees = exif.rotationDegrees
        val flipped = exif.isFlipped
        if (degrees == 0 && !flipped) return bitmap

        // Flip FIRST, then rotate: the order rotationDegrees assumes.
        val matrix = Matrix().apply {
            if (flipped) postScale(-1f, 1f)
            postRotate(degrees.toFloat())
        }
        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (rotated !== bitmap) bitmap.recycle()
        return rotated
    }

    private fun scaleToBudget(bitmap: Bitmap): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= MAX_EDGE_PX) return bitmap
        val factor = MAX_EDGE_PX.toFloat() / longest
        return Bitmap.createScaledBitmap(bitmap, (bitmap.width * factor).toInt(), (bitmap.height * factor).toInt(), true)
    }

    /** Bottom gradient + monospaced bold text, shrunk until the WHOLE caption fits. */
    private fun drawCaption(bitmap: Bitmap, caption: String) {
        val canvas = Canvas(bitmap)
        val bandHeight = bitmap.height * 0.14f
        val top = bitmap.height - bandHeight
        canvas.drawRect(
            0f, top, bitmap.width.toFloat(), bitmap.height.toFloat(),
            Paint().apply {
                shader = LinearGradient(
                    0f, top, 0f, bitmap.height.toFloat(),
                    Color.TRANSPARENT, Color.argb(190, 0, 0, 0), Shader.TileMode.CLAMP
                )
            }
        )
        val margin = bitmap.width * 0.04f
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            setShadowLayer(bitmap.width * 0.006f, 0f, 0f, Color.BLACK)
        }
        text.textSize = fitTextSize(
            preferred = bitmap.width * 0.038f,
            maxWidth = bitmap.width - margin * 2,
            measure = { size ->
                text.textSize = size
                text.measureText(caption)
            }
        )
        canvas.drawText(caption, margin, bitmap.height - bandHeight * 0.32f, text)
    }
}
```

`android/app/src/main/kotlin/com/dacs/workmate/AttendanceBridge.kt`:

```kotlin
package com.dacs.workmate

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.concurrent.Executors

/** Wait at most this long for a fix: no fix flags the record, it never refuses it. */
private const val FIX_TIMEOUT_MS = 15_000L

/** A fix older than this is treated as no fix (a stale fix could verify the wrong place). */
private const val FIX_MAX_AGE_MS = 2 * 60 * 1000L

/**
 * The attendance channel. Ported from DACS Attendance ClockAnchorStore,
 * Connectivity, LocationProvider and PhotoStore — same rules, same order.
 */
class AttendanceBridge(private val context: Context) : MethodChannel.MethodCallHandler {

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "clock" -> result.success(mapOf("uptimeMillis" to SystemClock.elapsedRealtime(), "bootCount" to bootCount()))
            "isOnline" -> result.success(isOnline())
            "currentFix" -> currentFix { result.success(it) }
            "preparePhoto" -> {
                val source = call.argument<String>("source")
                val target = call.argument<String>("target")
                val caption = call.argument<String>("caption")
                if (source == null || target == null || caption == null) {
                    result.error("BAD_ARGS", "source, target and caption are required", null)
                    return
                }
                io.execute {
                    try {
                        PhotoPreparer.prepare(File(source), File(target), caption)
                        main.post { result.success(target) }
                    } catch (e: Exception) {
                        main.post { result.error("PHOTO_FAILED", e.message, null) }
                    }
                }
            }
            else -> result.notImplemented()
        }
    }

    /** Global since API 24 (our minSdk); some OEM builds still omit it. */
    private fun bootCount(): Int? =
        runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()

    private fun isOnline(): Boolean {
        val manager = ContextCompat.getSystemService(context, ConnectivityManager::class.java) ?: return false
        val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** A missing LocationManager answers TRUE: being unable to ask must not become an accusation. */
    private fun isLocationEnabled(): Boolean {
        val manager = ContextCompat.getSystemService(context, LocationManager::class.java) ?: return true
        return LocationManagerCompat.isLocationEnabled(manager)
    }

    /** Every failure path answers with a map, never an exception. Runs its callback once, on the main thread. */
    private fun currentFix(callback: (Map<String, Any?>) -> Unit) {
        if (!hasPermission()) return callback(mapOf("permissionDenied" to true))
        // Switched off is somebody's decision; checked BEFORE asking for a fix.
        if (!isLocationEnabled()) return callback(mapOf("locationDisabled" to true))

        var done = false
        fun finish(fix: Map<String, Any?>) {
            if (done) return
            done = true
            callback(fix)
        }

        val cancel = CancellationTokenSource()
        main.postDelayed({
            cancel.cancel()
            finish(emptyMap())
        }, FIX_TIMEOUT_MS)

        try {
            LocationServices.getFusedLocationProviderClient(context)
                .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancel.token)
                .addOnSuccessListener { location -> finish(location?.let(::toFix) ?: emptyMap()) }
                .addOnFailureListener { finish(emptyMap()) }
        } catch (e: SecurityException) {
            // Revoked between the check and the request: a denial, which is what it is.
            finish(mapOf("permissionDenied" to true))
        } catch (e: Exception) {
            // Play Services missing or broken: an unverified record, not a lockout.
            finish(emptyMap())
        }
    }

    private fun toFix(location: Location): Map<String, Any?> {
        val ageMs = (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000
        if (ageMs > FIX_MAX_AGE_MS) return emptyMap()
        val isMock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            location.isMock
        } else {
            @Suppress("DEPRECATION")
            location.isFromMockProvider
        }
        return mapOf(
            "latitude" to location.latitude,
            "longitude" to location.longitude,
            // No accuracy is a location we cannot place: left null so it reads as low accuracy.
            "accuracyMetres" to if (location.hasAccuracy()) location.accuracy.toDouble() else null,
            "isMock" to isMock
        )
    }
}
```

In `android/app/src/main/kotlin/com/dacs/workmate/MainActivity.kt`, inside `configureFlutterEngine`, after the installer channel registration, add:

```kotlin
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.dacs.workmate/attendance")
            .setMethodCallHandler(AttendanceBridge(applicationContext))
```

In `android/app/build.gradle.kts`, extend the existing `dependencies { … }` block to:

```kotlin
dependencies {
    // FileProvider, for handing the verified update APK to the system installer.
    implementation("androidx.core:core-ktx:1.13.1")
    // Fresh fused fixes with mock detection (AttendanceBridge.currentFix).
    implementation("com.google.android.gms:play-services-location:21.3.0")
    // EXIF rotation + mirror of front-camera captures (PhotoPreparer).
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    testImplementation("junit:junit:4.13.2")
}
```

In `android/app/src/main/AndroidManifest.xml`, next to the existing `<uses-permission>` lines, add:

```xml
    <!-- Attendance: one fix at Time In / Time Out, never tracking (Terms clause 4). -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

- [ ] **Step 7: Wire the server Date header into the anchor store**

In `lib/main.dart`, after `final prefs = await SharedPreferences.getInstance();` and before the `WorkMateHttpClient` is created, add:

```dart
  final device = MethodChannelDeviceBridge();
  final clockAnchors = ClockAnchorStore(prefs, device);
```

and change the client construction to:

```dart
  final httpClient = WorkMateHttpClient(
    versionCode: versionCode,
    nudges: nudges,
    // Every server answer re-anchors the tamper-proof clock (0078). Never let
    // a failure here fail the request itself.
    onServerDate: (date) => clockAnchors.recordServerDate(date).catchError((_) {}),
  );
```

with imports `import 'attendance/device/clock_anchor_store.dart';` and `import 'attendance/device/device_bridge.dart';`.

- [ ] **Step 8: Run all checks**

Run: `flutter test` → Expected: all pass.
Run: `flutter analyze` → Expected: `No issues found!`
Run (PowerShell, from the repo root):

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location
```

Expected: `BUILD SUCCESSFUL`, PhotoMathTest 8 tests passed.
Run: `flutter build apk --debug` → Expected: builds.

- [ ] **Step 9: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 5: The local database (queue, record mirror, project cache)

**Files:**
- Create: `lib/attendance/data/submission_request.dart`, `lib/attendance/data/attendance_db.dart`
- Modify: `pubspec.yaml` (add `sqflite: ^2.4.2+1`; dev `sqflite_common_ffi: ^2.4.0+3`)
- Test: `test/attendance/data/attendance_db_test.dart`

**Interfaces:**
- Consumes: `TimeDirection`, `WorkDate` (Task 1); `AttendanceRecord`, `AttendanceProject`, `ProjectSystem`, `AttendanceStatus` (Task 3); `Geofence` (Task 2).
- Produces: `class SubmissionRequest { direction, projectSystem, projectId, capturedAt, trustedAt, photoPath, description, eventId, latitude, longitude, accuracyMetres, wasOffline, isMock, permissionDenied, locationStatus; SubmissionRequest withPhoto(String path, {required bool wasOffline}) }`; `class PendingSubmission { …all columns…; SubmissionRequest? toRequest() (null when the project system is unknown); QueuedSubmission toQueued() }` with `factory PendingSubmission.fromRequest(SubmissionRequest r, {required String workerId, required String projectName, required DateTime createdAt})`; `class AttendanceDb { static Future<AttendanceDb> open(DatabaseFactory factory, String path, {bool singleInstance = true}); Future<void> close(); insertPending(PendingSubmission); Future<List<PendingSubmission>> sendable(String workerId); Future<List<PendingSubmission>> failed(String workerId); Future<PendingSubmission?> pendingById(String eventId); Future<bool> hasPendingFor(String workerId); recordAttempt(String eventId, String error); markFailed(String eventId, String error); deletePending(String eventId); upsertRecord(String workerId, AttendanceRecord r, {required bool pending}); Future<AttendanceRecord?> recordFor(String workerId, String workDate); clearRecord(String workerId, String workDate); Future<List<AttendanceRecord>> recordsBetween(String workerId, String from, String to); Future<List<AttendanceProject>> projects(String workerId); replaceProjects(String workerId, List<AttendanceProject> projects); }`; `Future<AttendanceDb> openDeviceAttendanceDb()`.

- [ ] **Step 1: Add the packages**

```powershell
flutter pub add sqflite:^2.4.2+1
flutter pub add --dev sqflite_common_ffi:^2.4.0+3
```

- [ ] **Step 2: Write the failing test**

`test/attendance/data/attendance_db_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/attendance/data/attendance_db.dart';
import 'package:workmate/attendance/data/submission_request.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/location_verification.dart';
import 'package:workmate/attendance/domain/work_date.dart';

SubmissionRequest request({String eventId = 'e1', TimeDirection d = TimeDirection.timeIn, String captured = '2026-08-18T23:45:00Z'}) =>
    SubmissionRequest(
      direction: d,
      projectSystem: ProjectSystem.pc,
      projectId: 'p1',
      capturedAt: DateTime.parse(captured),
      trustedAt: DateTime.parse('2026-08-18T23:45:03Z'),
      photoPath: '/files/attendance-photos/$eventId.jpg',
      description: 'Block A',
      eventId: eventId,
      latitude: 14.5,
      longitude: 121.0,
      accuracyMetres: 9,
      wasOffline: true,
      isMock: false,
      permissionDenied: false,
      locationStatus: 'verified',
    );

void main() {
  late AttendanceDb db;
  setUpAll(sqfliteFfiInit);
  setUp(() async => db = await AttendanceDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false));
  tearDown(() => db.close());

  test('a queued submission round-trips every field the upload needs', () async {
    await db.insertPending(PendingSubmission.fromRequest(request(), workerId: 'w1', projectName: 'ABC', createdAt: DateTime.parse('2026-08-18T23:46:00Z')));
    final row = (await db.sendable('w1')).single;
    final back = row.toRequest()!;
    expect(back.capturedAt, DateTime.parse('2026-08-18T23:45:00Z'));
    expect(back.trustedAt, DateTime.parse('2026-08-18T23:45:03Z'));
    expect(back.projectSystem, ProjectSystem.pc);
    expect(back.wasOffline, isTrue);
    expect(back.description, 'Block A');
    expect(row.projectName, 'ABC');
    expect(row.toQueued().workerId, 'w1');
  });

  test("the queue is per worker: another worker's rows are invisible", () async {
    await db.insertPending(PendingSubmission.fromRequest(request(), workerId: 'w1', projectName: 'A', createdAt: DateTime.now()));
    expect(await db.sendable('w2'), isEmpty);
    expect(await db.hasPendingFor('w2'), isFalse);
    expect(await db.hasPendingFor('w1'), isTrue);
  });

  test('re-inserting the same event id replaces, never duplicates', () async {
    final p = PendingSubmission.fromRequest(request(), workerId: 'w1', projectName: 'A', createdAt: DateTime.now());
    await db.insertPending(p);
    await db.insertPending(p);
    expect((await db.sendable('w1')).length, 1);
  });

  test('attempts count up; a failed row leaves the sendable queue but stays visible', () async {
    await db.insertPending(PendingSubmission.fromRequest(request(), workerId: 'w1', projectName: 'A', createdAt: DateTime.now()));
    await db.recordAttempt('e1', 'noConnection');
    expect((await db.pendingById('e1'))!.attempts, 1);
    await db.markFailed('e1', 'outsideRadius');
    expect(await db.sendable('w1'), isEmpty);
    expect(await db.hasPendingFor('w1'), isFalse);
    expect((await db.failed('w1')).single.lastError, 'outsideRadius');
  });

  test('sendable is oldest first', () async {
    await db.insertPending(PendingSubmission.fromRequest(request(eventId: 'late'), workerId: 'w1', projectName: 'A', createdAt: DateTime.parse('2026-08-19T01:00:00Z')));
    await db.insertPending(PendingSubmission.fromRequest(request(eventId: 'early'), workerId: 'w1', projectName: 'A', createdAt: DateTime.parse('2026-08-19T00:00:00Z')));
    expect((await db.sendable('w1')).map((p) => p.eventId), ['early', 'late']);
  });

  test('a row whose project system is unknown cannot become a request', () async {
    final p = PendingSubmission.fromRequest(request(), workerId: 'w1', projectName: 'A', createdAt: DateTime.now());
    expect(p.copyWithSystem('').toRequest(), isNull);
  });

  test('the record mirror is per worker and per Manila date', () async {
    final r = AttendanceRecord(id: 'r1', workDate: '2026-08-19', status: AttendanceStatus.working, timeInAt: DateTime.parse('2026-08-18T23:45:00Z'), timeInProjectName: 'ABC');
    await db.upsertRecord('w1', r, pending: true);
    final back = (await db.recordFor('w1', '2026-08-19'))!;
    expect(back.pending, isTrue);
    expect(back.timeInAt, DateTime.parse('2026-08-18T23:45:00Z'));
    expect(await db.recordFor('w2', '2026-08-19'), isNull);
    await db.clearRecord('w1', '2026-08-19');
    expect(await db.recordFor('w1', '2026-08-19'), isNull);
  });

  test('history between two dates is newest first', () async {
    for (final d in ['2026-08-17', '2026-08-19', '2026-08-18', '2026-08-25']) {
      await db.upsertRecord('w1', AttendanceRecord(id: d, workDate: d, status: AttendanceStatus.complete, totalMinutes: 480), pending: false);
    }
    expect((await db.recordsBetween('w1', '2026-08-17', '2026-08-19')).map((r) => r.workDate), ['2026-08-19', '2026-08-18', '2026-08-17']);
  });

  test('the project cache replaces (a deactivated project disappears) and keeps fences', () async {
    await db.replaceProjects('w1', [
      const AttendanceProject(system: ProjectSystem.pc, id: 'a', name: 'Alpha', geofence: Geofence(latitude: 14.5, longitude: 121, radiusMetres: 150)),
      const AttendanceProject(system: ProjectSystem.pc, id: 'b', name: 'Beta'),
    ]);
    await db.replaceProjects('w1', [const AttendanceProject(system: ProjectSystem.pc, id: 'a', name: 'Alpha', geofence: Geofence(latitude: 14.5, longitude: 121, radiusMetres: 150))]);
    final list = await db.projects('w1');
    expect(list.map((p) => p.id), ['a']);
    expect(list.single.geofence!.radiusMetres, 150);
    expect(await db.projects('w2'), isEmpty);
  });
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `flutter test test/attendance/data/attendance_db_test.dart`
Expected: FAIL — missing `attendance_db.dart` / `submission_request.dart`.

- [ ] **Step 4: Implement**

`lib/attendance/data/submission_request.dart`:

```dart
import '../domain/attendance_record.dart';
import '../domain/submission_queue.dart';
import '../domain/work_date.dart';

/// Everything needed to record one Time In or Time Out. [eventId] is minted
/// once when the worker first taps SUBMIT and reused for every retry (the RPCs
/// are idempotent on it). [capturedAt] is the SHUTTER, never the upload time.
class SubmissionRequest {
  const SubmissionRequest({
    required this.direction,
    required this.projectSystem,
    required this.projectId,
    required this.capturedAt,
    required this.trustedAt,
    required this.photoPath,
    required this.description,
    required this.eventId,
    this.latitude,
    this.longitude,
    this.accuracyMetres,
    this.wasOffline = false,
    this.isMock = false,
    this.permissionDenied = false,
    this.locationStatus,
  });

  final TimeDirection direction;
  final ProjectSystem projectSystem;
  final String projectId;
  final DateTime capturedAt;

  /// The shutter by the clock the worker cannot change (0078), or null.
  final DateTime? trustedAt;
  final String photoPath;
  final String? description;
  final String eventId;
  final double? latitude;
  final double? longitude;
  final double? accuracyMetres;
  final bool wasOffline;

  /// The two things only the device can observe (both arrive as null coordinates).
  final bool isMock;
  final bool permissionDenied;

  /// The device's own verdict, kept LOCAL so a queued row can explain itself.
  final String? locationStatus;

  SubmissionRequest withPhoto(String path, {required bool wasOffline}) => SubmissionRequest(
        direction: direction,
        projectSystem: projectSystem,
        projectId: projectId,
        capturedAt: capturedAt,
        trustedAt: trustedAt,
        photoPath: path,
        description: description,
        eventId: eventId,
        latitude: latitude,
        longitude: longitude,
        accuracyMetres: accuracyMetres,
        wasOffline: wasOffline,
        isMock: isMock,
        permissionDenied: permissionDenied,
        locationStatus: locationStatus,
      );
}

/// One row of pending_submission: the worker's day until the upload succeeds.
class PendingSubmission {
  const PendingSubmission({
    required this.eventId,
    required this.workerId,
    required this.direction,
    required this.projectSystem,
    required this.projectId,
    required this.projectName,
    required this.capturedAtMs,
    required this.trustedAtMs,
    required this.photoLocalPath,
    required this.description,
    required this.latitude,
    required this.longitude,
    required this.accuracyMetres,
    required this.wasOffline,
    required this.isMock,
    required this.permissionDenied,
    required this.locationStatus,
    required this.attempts,
    required this.lastError,
    required this.failedPermanently,
    required this.createdAtMs,
  });

  factory PendingSubmission.fromRequest(SubmissionRequest r,
          {required String workerId, required String projectName, required DateTime createdAt}) =>
      PendingSubmission(
        eventId: r.eventId,
        workerId: workerId,
        direction: r.direction.wire,
        projectSystem: r.projectSystem.wire,
        projectId: r.projectId,
        projectName: projectName,
        capturedAtMs: r.capturedAt.millisecondsSinceEpoch,
        trustedAtMs: r.trustedAt?.millisecondsSinceEpoch,
        photoLocalPath: r.photoPath,
        description: r.description,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracyMetres: r.accuracyMetres,
        wasOffline: r.wasOffline,
        isMock: r.isMock,
        permissionDenied: r.permissionDenied,
        locationStatus: r.locationStatus,
        attempts: 0,
        lastError: null,
        failedPermanently: false,
        createdAtMs: createdAt.millisecondsSinceEpoch,
      );

  factory PendingSubmission.fromMap(Map<String, Object?> m) => PendingSubmission(
        eventId: m['event_id']! as String,
        workerId: m['worker_id']! as String,
        direction: m['direction']! as String,
        projectSystem: m['project_system']! as String,
        projectId: m['project_id']! as String,
        projectName: m['project_name']! as String,
        capturedAtMs: m['captured_at']! as int,
        trustedAtMs: m['trusted_at'] as int?,
        photoLocalPath: m['photo_local_path']! as String,
        description: m['description'] as String?,
        latitude: (m['latitude'] as num?)?.toDouble(),
        longitude: (m['longitude'] as num?)?.toDouble(),
        accuracyMetres: (m['accuracy_metres'] as num?)?.toDouble(),
        wasOffline: m['was_offline'] == 1,
        isMock: m['is_mock'] == 1,
        permissionDenied: m['permission_denied'] == 1,
        locationStatus: m['location_status'] as String?,
        attempts: m['attempts']! as int,
        lastError: m['last_error'] as String?,
        failedPermanently: m['failed_permanently'] == 1,
        createdAtMs: m['created_at']! as int,
      );

  final String eventId;
  final String workerId;
  final String direction;
  final String projectSystem;
  final String projectId;
  final String projectName;
  final int capturedAtMs;
  final int? trustedAtMs;
  final String photoLocalPath;
  final String? description;
  final double? latitude;
  final double? longitude;
  final double? accuracyMetres;
  final bool wasOffline;
  final bool isMock;
  final bool permissionDenied;
  final String? locationStatus;
  final int attempts;
  final String? lastError;
  final bool failedPermanently;
  final int createdAtMs;

  DateTime get capturedAt => DateTime.fromMillisecondsSinceEpoch(capturedAtMs, isUtc: true);

  Map<String, Object?> toMap() => {
        'event_id': eventId,
        'worker_id': workerId,
        'direction': direction,
        'project_system': projectSystem,
        'project_id': projectId,
        'project_name': projectName,
        'captured_at': capturedAtMs,
        'trusted_at': trustedAtMs,
        'photo_local_path': photoLocalPath,
        'description': description,
        'latitude': latitude,
        'longitude': longitude,
        'accuracy_metres': accuracyMetres,
        'was_offline': wasOffline ? 1 : 0,
        'is_mock': isMock ? 1 : 0,
        'permission_denied': permissionDenied ? 1 : 0,
        'location_status': locationStatus,
        'attempts': attempts,
        'last_error': lastError,
        'failed_permanently': failedPermanently ? 1 : 0,
        'created_at': createdAtMs,
      };

  /// Null when the row names a project system this build does not know: there
  /// is nothing to send it against.
  SubmissionRequest? toRequest() {
    final system = ProjectSystem.of(projectSystem);
    if (system == null) return null;
    return SubmissionRequest(
      direction: TimeDirection.parse(direction),
      projectSystem: system,
      projectId: projectId,
      capturedAt: capturedAt,
      trustedAt: trustedAtMs == null ? null : DateTime.fromMillisecondsSinceEpoch(trustedAtMs!, isUtc: true),
      photoPath: photoLocalPath,
      description: description,
      eventId: eventId,
      latitude: latitude,
      longitude: longitude,
      accuracyMetres: accuracyMetres,
      wasOffline: wasOffline,
      isMock: isMock,
      permissionDenied: permissionDenied,
      locationStatus: locationStatus,
    );
  }

  QueuedSubmission toQueued() => QueuedSubmission(
        eventId: eventId,
        direction: TimeDirection.parse(direction),
        createdAt: DateTime.fromMillisecondsSinceEpoch(createdAtMs, isUtc: true),
        workerId: workerId,
      );

  /// Test/support helper: the same row with another project system value.
  PendingSubmission copyWithSystem(String system) => PendingSubmission.fromMap({...toMap(), 'project_system': system});
}
```

`lib/attendance/data/attendance_db.dart`:

```dart
import 'package:sqflite/sqflite.dart';

import '../domain/attendance_record.dart';
import '../domain/location_verification.dart';
import 'submission_request.dart';

/// The queue, the worker's record mirror and the project cache — all scoped by
/// worker, because site phones are shared. Same tables as DACS Attendance's
/// Room database (pending_submission, cached_record, cached_project).
class AttendanceDb {
  AttendanceDb._(this._db);

  final Database _db;

  static Future<AttendanceDb> open(DatabaseFactory factory, String path, {bool singleInstance = true}) async {
    final db = await factory.openDatabase(
      path,
      options: OpenDatabaseOptions(version: 1, onCreate: _create, singleInstance: singleInstance),
    );
    return AttendanceDb._(db);
  }

  static Future<void> _create(Database db, int version) async {
    await db.execute('''
      create table pending_submission (
        event_id text primary key,
        worker_id text not null,
        direction text not null,
        project_system text not null,
        project_id text not null,
        project_name text not null,
        captured_at integer not null,
        trusted_at integer,
        photo_local_path text not null,
        description text,
        latitude real,
        longitude real,
        accuracy_metres real,
        was_offline integer not null,
        is_mock integer not null default 0,
        permission_denied integer not null default 0,
        location_status text,
        attempts integer not null default 0,
        last_error text,
        failed_permanently integer not null default 0,
        created_at integer not null
      )''');
    await db.execute('''
      create table cached_record (
        worker_id text not null,
        work_date text not null,
        id text,
        status text not null,
        time_in_at integer,
        time_out_at integer,
        time_in_project_name text,
        time_out_project_name text,
        total_minutes integer,
        pending integer not null default 0,
        primary key (worker_id, work_date)
      )''');
    await db.execute('''
      create table cached_project (
        worker_id text not null,
        system text not null,
        id text not null,
        name text not null,
        geofence_lat real,
        geofence_lng real,
        geofence_radius_m real,
        geofence_enabled integer not null default 1,
        primary key (worker_id, system, id)
      )''');
  }

  Future<void> close() => _db.close();

  // ── queue ──────────────────────────────────────────────────────────────

  Future<void> insertPending(PendingSubmission p) =>
      _db.insert('pending_submission', p.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);

  /// Scoped to ONE worker: an unscoped read is how another worker's queued day
  /// would be uploaded under this session.
  Future<List<PendingSubmission>> sendable(String workerId) async => (await _db.query('pending_submission',
          where: 'failed_permanently = 0 and worker_id = ?', whereArgs: [workerId], orderBy: 'created_at asc'))
      .map(PendingSubmission.fromMap)
      .toList();

  Future<List<PendingSubmission>> failed(String workerId) async => (await _db.query('pending_submission',
          where: 'failed_permanently = 1 and worker_id = ?', whereArgs: [workerId], orderBy: 'created_at asc'))
      .map(PendingSubmission.fromMap)
      .toList();

  Future<PendingSubmission?> pendingById(String eventId) async {
    final rows = await _db.query('pending_submission', where: 'event_id = ?', whereArgs: [eventId], limit: 1);
    return rows.isEmpty ? null : PendingSubmission.fromMap(rows.first);
  }

  /// Failed rows are left out: "not sent YET" would promise they will be.
  Future<bool> hasPendingFor(String workerId) async =>
      (await _db.query('pending_submission',
              columns: ['event_id'], where: 'worker_id = ? and failed_permanently = 0', whereArgs: [workerId], limit: 1))
          .isNotEmpty;

  Future<void> recordAttempt(String eventId, String error) => _db.rawUpdate(
      'update pending_submission set attempts = attempts + 1, last_error = ? where event_id = ?', [error, eventId]);

  Future<void> markFailed(String eventId, String error) => _db.rawUpdate(
      'update pending_submission set failed_permanently = 1, last_error = ? where event_id = ?', [error, eventId]);

  Future<void> deletePending(String eventId) =>
      _db.delete('pending_submission', where: 'event_id = ?', whereArgs: [eventId]);

  // ── record mirror ───────────────────────────────────────────────────────

  Future<void> upsertRecord(String workerId, AttendanceRecord r, {required bool pending}) => _db.insert(
        'cached_record',
        {
          'worker_id': workerId,
          'work_date': r.workDate,
          'id': r.id,
          'status': r.status.name,
          'time_in_at': r.timeInAt?.millisecondsSinceEpoch,
          'time_out_at': r.timeOutAt?.millisecondsSinceEpoch,
          'time_in_project_name': r.timeInProjectName,
          'time_out_project_name': r.timeOutProjectName,
          'total_minutes': r.totalMinutes,
          'pending': pending ? 1 : 0,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  static DateTime? _ms(Object? v) => v == null ? null : DateTime.fromMillisecondsSinceEpoch(v as int, isUtc: true);

  static AttendanceRecord _record(Map<String, Object?> m) => AttendanceRecord(
        id: (m['id'] as String?) ?? (m['work_date']! as String),
        workDate: m['work_date']! as String,
        status: AttendanceStatus.parse(m['status'] as String?),
        timeInAt: _ms(m['time_in_at']),
        timeOutAt: _ms(m['time_out_at']),
        timeInProjectName: m['time_in_project_name'] as String?,
        timeOutProjectName: m['time_out_project_name'] as String?,
        totalMinutes: m['total_minutes'] as int?,
        pending: m['pending'] == 1,
      );

  Future<AttendanceRecord?> recordFor(String workerId, String workDate) async {
    final rows = await _db.query('cached_record',
        where: 'worker_id = ? and work_date = ?', whereArgs: [workerId, workDate], limit: 1);
    return rows.isEmpty ? null : _record(rows.first);
  }

  Future<void> clearRecord(String workerId, String workDate) =>
      _db.delete('cached_record', where: 'worker_id = ? and work_date = ?', whereArgs: [workerId, workDate]);

  /// work_date is ISO yyyy-MM-dd text, so lexical BETWEEN is chronological.
  Future<List<AttendanceRecord>> recordsBetween(String workerId, String from, String to) async =>
      (await _db.query('cached_record',
              where: 'worker_id = ? and work_date between ? and ?',
              whereArgs: [workerId, from, to],
              orderBy: 'work_date desc'))
          .map(_record)
          .toList();

  // ── project cache ───────────────────────────────────────────────────────

  Future<List<AttendanceProject>> projects(String workerId) async {
    final rows = await _db.query('cached_project', where: 'worker_id = ?', whereArgs: [workerId], orderBy: 'name asc');
    final out = <AttendanceProject>[];
    for (final m in rows) {
      final system = ProjectSystem.of(m['system'] as String?);
      if (system == null) continue; // a system this build does not know is dropped, not guessed
      final lat = (m['geofence_lat'] as num?)?.toDouble();
      final lng = (m['geofence_lng'] as num?)?.toDouble();
      final radius = (m['geofence_radius_m'] as num?)?.toDouble();
      out.add(AttendanceProject(
        system: system,
        id: m['id']! as String,
        name: m['name']! as String,
        // Rebuilt only when all three parts are present: a half fence is a circle nobody drew.
        geofence: (lat != null && lng != null && radius != null)
            ? Geofence(latitude: lat, longitude: lng, radiusMetres: radius, enabled: m['geofence_enabled'] == 1)
            : null,
      ));
    }
    return out;
  }

  /// Clear + insert in one transaction, so a project deactivated on the server
  /// disappears from the picker instead of lingering.
  Future<void> replaceProjects(String workerId, List<AttendanceProject> projects) => _db.transaction((txn) async {
        await txn.delete('cached_project', where: 'worker_id = ?', whereArgs: [workerId]);
        for (final p in projects) {
          await txn.insert(
            'cached_project',
            {
              'worker_id': workerId,
              'system': p.system.wire,
              'id': p.id,
              'name': p.name,
              'geofence_lat': p.geofence?.latitude,
              'geofence_lng': p.geofence?.longitude,
              'geofence_radius_m': p.geofence?.radiusMetres,
              'geofence_enabled': (p.geofence?.enabled ?? true) ? 1 : 0,
            },
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
        }
      });
}

/// The database file on the phone, shared by the app and the background sync.
Future<AttendanceDb> openDeviceAttendanceDb() async =>
    AttendanceDb.open(databaseFactory, '${await getDatabasesPath()}/workmate_attendance.db');
```

- [ ] **Step 5: Run it to verify it passes**

Run: `flutter test test/attendance/data/attendance_db_test.dart`
Expected: PASS (9 tests).

- [ ] **Step 6: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 6: The server side — photo upload, the two RPCs and the reads

**Files:**
- Create: `lib/attendance/data/attendance_remote.dart`
- Test: `test/attendance/data/attendance_remote_test.dart`

**Interfaces:**
- Consumes: `SubmissionRequest` (Task 5); `AttendanceRecord`, `AttendanceProject`, `ProjectSystem` (Task 3); `Geofence` (Task 2); `photoPath`, `WorkDate`, `TimeDirection` (Task 1).
- Produces: `const photoBucket = 'attendance'`; `Map<String, dynamic> rpcParams(SubmissionRequest r, String photoPath)`; `AttendanceProject? projectFromRow(Map<String, dynamic> row)`; `Map<String, Geofence> newestFences(List<Map<String, dynamic>> rows)`; `abstract class AttendanceRemote { Future<AttendanceRecord> submit(SubmissionRequest r); Future<AttendanceRecord?> today(String workDate); Future<List<AttendanceRecord>> history(String from, String to); Future<List<AttendanceProject>> activeProjects(); }`; `class SupabaseAttendanceRemote implements AttendanceRemote { SupabaseAttendanceRemote(SupabaseClient client); }`.

- [ ] **Step 1: Write the failing test**

`test/attendance/data/attendance_remote_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/data/attendance_remote.dart';
import 'package:workmate/attendance/data/submission_request.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/work_date.dart';

SubmissionRequest req({DateTime? trusted, String? description = 'Block A'}) => SubmissionRequest(
      direction: TimeDirection.timeIn,
      projectSystem: ProjectSystem.pc,
      projectId: 'a1b2c3d4-0000-4000-8000-000000000001',
      capturedAt: DateTime.parse('2026-08-19T07:45:00+08:00'),
      trustedAt: trusted,
      photoPath: '/files/e.jpg',
      description: description,
      eventId: 'e0000000-0000-4000-8000-000000000001',
      latitude: 14.5,
      longitude: 121.0,
      accuracyMetres: 9.5,
      wasOffline: true,
      isMock: false,
      permissionDenied: false,
      locationStatus: 'verified',
    );

void main() {
  test('the RPC gets exactly the live signature, the shutter time in UTC', () {
    final p = rpcParams(req(trusted: DateTime.parse('2026-08-18T23:45:02Z')), 'w/2026-08-19/in-e.jpg');
    expect(p.keys.toSet(), {
      'p_project_system', 'p_project_id', 'p_captured_at', 'p_photo_path', 'p_event_id', 'p_description',
      'p_lat', 'p_lng', 'p_accuracy_m', 'p_was_offline', 'p_is_mock', 'p_permission_denied', 'p_trusted_at',
    });
    expect(p['p_project_system'], 'pc');
    expect(p['p_captured_at'], '2026-08-18T23:45:00.000Z');
    expect(p['p_trusted_at'], '2026-08-18T23:45:02.000Z');
    expect(p['p_was_offline'], isTrue);
  });

  test('no trusted time is OMITTED, not sent as null; no description IS null', () {
    final p = rpcParams(req(description: null), 'x');
    expect(p.containsKey('p_trusted_at'), isFalse);
    expect(p.containsKey('p_description'), isTrue);
    expect(p['p_description'], isNull);
  });

  test('the location verdict is never uploaded (the server computes its own)', () {
    expect(rpcParams(req(), 'x').values, isNot(contains('verified')));
  });

  test('project rows: a system this build does not know is dropped', () {
    expect(projectFromRow({'project_system': 'pc', 'project_id': 'id1', 'project_name': 'Alpha'})!.key, 'pc:id1');
    expect(projectFromRow({'project_system': 'zz', 'project_id': 'id1', 'project_name': 'X'}), isNull);
  });

  test('only the newest fence per project is kept (append-only history)', () {
    final fences = newestFences([
      {'project_system': 'pc', 'folder_id': 'a', 'effective_from': '2026-08-01T00:00:00Z', 'latitude': 1, 'longitude': 1, 'radius_m': 100, 'enabled': true},
      {'project_system': 'pc', 'folder_id': 'a', 'effective_from': '2026-09-01T00:00:00Z', 'latitude': 2, 'longitude': 2, 'radius_m': 200, 'enabled': true},
      {'project_system': 'pm', 'pm_project_id': 'b', 'effective_from': null, 'latitude': 3, 'longitude': 3, 'radius_m': 300, 'enabled': false},
      {'project_system': 'pc', 'effective_from': '2026-09-01T00:00:00Z', 'latitude': 9, 'longitude': 9, 'radius_m': 9, 'enabled': true},
    ]);
    expect(fences.keys.toSet(), {'pc:a', 'pm:b'});
    expect(fences['pc:a']!.radiusMetres, 200);
    expect(fences['pm:b']!.enabled, isFalse);
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `flutter test test/attendance/data/attendance_remote_test.dart`
Expected: FAIL — missing `attendance_remote.dart`.

- [ ] **Step 3: Implement**

`lib/attendance/data/attendance_remote.dart`:

```dart
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/attendance_record.dart';
import '../domain/location_verification.dart';
import '../domain/work_date.dart';
import 'submission_request.dart';

/// The private bucket every attendance photo lives in (0050).
const photoBucket = 'attendance';

const _readTimeout = Duration(seconds: 15);
const _rpcTimeout = Duration(seconds: 20);
const _uploadTimeout = Duration(seconds: 60);

/// The RPC arguments — exactly the live signature (verified 2026-09-30).
/// p_trusted_at is OMITTED when unknown (the server default says the same).
/// The device's location verdict is never sent: the server computes its own.
Map<String, dynamic> rpcParams(SubmissionRequest r, String photoPath) => {
      'p_project_system': r.projectSystem.wire,
      'p_project_id': r.projectId,
      'p_captured_at': r.capturedAt.toUtc().toIso8601String(),
      'p_photo_path': photoPath,
      'p_event_id': r.eventId,
      'p_description': r.description,
      'p_lat': r.latitude,
      'p_lng': r.longitude,
      'p_accuracy_m': r.accuracyMetres,
      'p_was_offline': r.wasOffline,
      'p_is_mock': r.isMock,
      'p_permission_denied': r.permissionDenied,
      if (r.trustedAt != null) 'p_trusted_at': r.trustedAt!.toUtc().toIso8601String(),
    };

/// One row of attendance_projects_for_worker(); null for a system this build
/// does not know (offering it would fail four screens later).
AttendanceProject? projectFromRow(Map<String, dynamic> row) {
  final system = ProjectSystem.of(row['project_system'] as String?);
  if (system == null) return null;
  return AttendanceProject(system: system, id: row['project_id'].toString(), name: row['project_name'] as String);
}

/// The newest fence per "system:id" from the append-only fence table.
Map<String, Geofence> newestFences(List<Map<String, dynamic>> rows) {
  final keyed = rows.where((r) => (r['folder_id'] ?? r['pm_project_id']) != null).toList()
    ..sort((a, b) => ((a['effective_from'] as String?) ?? '').compareTo((b['effective_from'] as String?) ?? ''));
  return {
    for (final r in keyed)
      '${r['project_system']}:${r['folder_id'] ?? r['pm_project_id']}': Geofence(
        latitude: (r['latitude'] as num).toDouble(),
        longitude: (r['longitude'] as num).toDouble(),
        radiusMetres: (r['radius_m'] as num).toDouble(),
        enabled: r['enabled'] != false,
      ),
  };
}

abstract class AttendanceRemote {
  /// Uploads the photo, THEN calls the matching RPC (a record must never point
  /// at a photo that never uploaded).
  Future<AttendanceRecord> submit(SubmissionRequest r);

  /// Today's record for the Manila [workDate], or null.
  Future<AttendanceRecord?> today(String workDate);

  Future<List<AttendanceRecord>> history(String from, String to);

  Future<List<AttendanceProject>> activeProjects();
}

class SupabaseAttendanceRemote implements AttendanceRemote {
  SupabaseAttendanceRemote(this._client);

  final SupabaseClient _client;

  @override
  Future<AttendanceRecord> submit(SubmissionRequest r) async {
    final workerId = _client.auth.currentUser?.id;
    if (workerId == null) throw StateError('AUTH_REQUIRED');
    final path = photoPath(workerId: workerId, workDate: WorkDate.of(r.capturedAt), direction: r.direction, eventId: r.eventId);

    // upsert: a retry re-uploads over the same path instead of failing on "already exists".
    await _client.storage
        .from(photoBucket)
        .upload(path, File(r.photoPath), fileOptions: const FileOptions(upsert: true, contentType: 'image/jpeg'))
        .timeout(_uploadTimeout);

    final fn = r.direction == TimeDirection.timeIn ? 'attendance_time_in' : 'attendance_time_out';
    final result = await _client.rpc(fn, params: rpcParams(r, path)).timeout(_rpcTimeout);
    final row = result is List ? result.first : result;
    return AttendanceRecord.fromRow(Map<String, dynamic>.from(row as Map));
  }

  @override
  Future<AttendanceRecord?> today(String workDate) async {
    final row = await _client
        .from('attendance_records')
        .select(AttendanceRecord.columns)
        .eq('work_date', workDate)
        .limit(1)
        .maybeSingle()
        .timeout(_readTimeout);
    return row == null ? null : AttendanceRecord.fromRow(row);
  }

  @override
  Future<List<AttendanceRecord>> history(String from, String to) async {
    final rows = await _client
        .from('attendance_records')
        .select(AttendanceRecord.columns)
        .gte('work_date', from)
        .lte('work_date', to)
        .order('work_date', ascending: false)
        .timeout(_readTimeout);
    return rows.map(AttendanceRecord.fromRow).toList();
  }

  /// An RPC, not a table read: workers have no select on folders (contract
  /// values are owner-confidential); the function exposes exactly 3 columns.
  @override
  Future<List<AttendanceProject>> activeProjects() async {
    final rows = await _client.rpc('attendance_projects_for_worker').timeout(_readTimeout) as List<dynamic>;
    final projects = rows
        .map((r) => projectFromRow(Map<String, dynamic>.from(r as Map)))
        .whereType<AttendanceProject>()
        .toList();
    return _attachGeofences(projects);
  }

  /// Fences fetched separately and merged; a failure here costs a pre-check,
  /// not the flow (the server still verifies).
  Future<List<AttendanceProject>> _attachGeofences(List<AttendanceProject> projects) async {
    try {
      final rows = await _client
          .from('attendance_project_geofence')
          .select('project_system,folder_id,pm_project_id,effective_from,latitude,longitude,radius_m,enabled')
          .timeout(_readTimeout);
      final fences = newestFences(rows);
      return [for (final p in projects) fences.containsKey(p.key) ? p.withGeofence(fences[p.key]) : p];
    } catch (_) {
      return projects;
    }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `flutter test test/attendance/data/attendance_remote_test.dart`
Expected: PASS (5 tests).

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 7: The offline-first repository

**Files:**
- Create: `lib/attendance/data/attendance_repository.dart`, `lib/attendance/sync/upload_scheduler.dart` (interface only in this task — the Workmanager class is added in Task 8)
- Test: `test/attendance/data/attendance_repository_test.dart`

**Interfaces:**
- Consumes: `AttendanceDb`, `PendingSubmission`, `SubmissionRequest` (Task 5); `AttendanceRemote` (Task 6); `DeviceBridge` (Task 4); `photoOverlayCaption`, `WorkDate`, `TimeDirection` (Task 1); `reconcileToday` + `TodayUse/TodayClear/TodayUnknown` (Task 3).
- Produces: `abstract class UploadScheduler { Future<void> enqueue(String eventId); Future<void> sendNow(); Future<void> ensureSweeper(); }`; `class AttendanceRepository { AttendanceRepository({required AttendanceDb db, required AttendanceRemote remote, required DeviceBridge device, required UploadScheduler scheduler, required String Function() currentWorkerId, required Future<Directory> Function() photoDir, DateTime Function()? now}); Future<AttendanceRecord> submit(SubmissionRequest r); Future<AttendanceRecord?> today(); Future<List<AttendanceRecord>> history(String from, String to); Future<List<AttendanceProject>> activeProjects(); }`.

- [ ] **Step 1: Write the scheduler interface**

`lib/attendance/sync/upload_scheduler.dart`:

```dart
/// "Send what is waiting" — an interface so the repository and screens test
/// without WorkManager. See WorkmanagerUploadScheduler for the policies.
abstract class UploadScheduler {
  /// Queue an upload attempt (KEEP: an attempt already scheduled drains this row too).
  Future<void> enqueue(String eventId);

  /// A fresh attempt NOW, restarting any accrued backoff (REPLACE).
  Future<void> sendNow();

  /// The 15-minute backstop for a row whose enqueue never happened.
  Future<void> ensureSweeper();
}
```

- [ ] **Step 2: Write the failing test**

`test/attendance/data/attendance_repository_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/attendance/data/attendance_db.dart';
import 'package:workmate/attendance/data/attendance_remote.dart';
import 'package:workmate/attendance/data/attendance_repository.dart';
import 'package:workmate/attendance/data/submission_request.dart';
import 'package:workmate/attendance/device/device_bridge.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/location_verification.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/sync/upload_scheduler.dart';

class FakeDevice implements DeviceBridge {
  bool online = false;
  String? lastCaption;
  @override
  Future<DeviceClockReading> clock() async => const DeviceClockReading(uptimeMillis: 0, bootCount: null);
  @override
  Future<bool> isOnline() async => online;
  @override
  Future<DeviceFix> currentFix() async => const DeviceFix();
  @override
  Future<String> preparePhoto({required String source, required String target, required String caption}) async {
    lastCaption = caption;
    await File(source).copy(target);
    await File(source).delete();
    return target;
  }
}

class FakeRemote implements AttendanceRemote {
  Object? todayError;
  AttendanceRecord? todayRow;
  Object? historyError;
  List<AttendanceRecord> historyRows = [];
  Object? projectsError;
  List<AttendanceProject> projectRows = [];
  @override
  Future<AttendanceRecord> submit(SubmissionRequest r) => throw UnimplementedError();
  @override
  Future<AttendanceRecord?> today(String workDate) async {
    if (todayError != null) throw todayError!;
    return todayRow;
  }
  @override
  Future<List<AttendanceRecord>> history(String from, String to) async {
    if (historyError != null) throw historyError!;
    return historyRows;
  }
  @override
  Future<List<AttendanceProject>> activeProjects() async {
    if (projectsError != null) throw projectsError!;
    return projectRows;
  }
}

class FakeScheduler implements UploadScheduler {
  final enqueued = <String>[];
  @override
  Future<void> enqueue(String eventId) async => enqueued.add(eventId);
  @override
  Future<void> sendNow() async {}
  @override
  Future<void> ensureSweeper() async {}
}

void main() {
  late AttendanceDb db;
  late Directory tmp;
  late FakeDevice device;
  late FakeRemote remote;
  late FakeScheduler scheduler;
  late AttendanceRepository repo;
  var now = DateTime.parse('2026-08-19T02:00:00Z'); // 10:00 Manila, 19 Aug

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await AttendanceDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    tmp = await Directory.systemTemp.createTemp('wmrepo');
    device = FakeDevice();
    remote = FakeRemote();
    scheduler = FakeScheduler();
    now = DateTime.parse('2026-08-19T02:00:00Z');
    repo = AttendanceRepository(
      db: db,
      remote: remote,
      device: device,
      scheduler: scheduler,
      currentWorkerId: () => 'w1',
      photoDir: () async => tmp,
      now: () => now,
    );
    await db.replaceProjects('w1', [const AttendanceProject(system: ProjectSystem.pc, id: 'p1', name: 'ABC Building Project')]);
  });
  tearDown(() async {
    await db.close();
    await tmp.delete(recursive: true);
  });

  Future<SubmissionRequest> request(TimeDirection d, String captured, {String eventId = 'e1'}) async {
    final raw = File('${tmp.path}/raw-$eventId.jpg')..writeAsBytesSync([1, 2, 3]);
    return SubmissionRequest(
      direction: d,
      projectSystem: ProjectSystem.pc,
      projectId: 'p1',
      capturedAt: DateTime.parse(captured),
      trustedAt: null,
      photoPath: raw.path,
      description: null,
      eventId: eventId,
    );
  }

  test('SUBMIT is durable on the phone before anything leaves it', () async {
    final mirror = await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    expect(mirror.pending, isTrue);
    expect(mirror.status, AttendanceStatus.working);
    expect(mirror.workDate, '2026-08-19');
    final row = (await db.sendable('w1')).single;
    expect(row.photoLocalPath, endsWith('e1.jpg'));
    expect(File(row.photoLocalPath).existsSync(), isTrue);
    expect(row.wasOffline, isTrue, reason: 'decided at capture, not at upload');
    expect(device.lastCaption, 'ABC Building Project · 19 Aug 2026 · 7:45 AM');
    expect(scheduler.enqueued, ['e1']);
  });

  test('a Time Out completes the mirror with optimistic minutes', () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    final out = await repo.submit(await request(TimeDirection.timeOut, '2026-08-19T09:30:00Z', eventId: 'e2'));
    expect(out.status, AttendanceStatus.complete);
    expect(out.totalMinutes, 585);
    expect(out.timeOutProjectName, 'ABC Building Project');
  });

  test("today: the server's row wins and is mirrored", () async {
    remote.todayRow = AttendanceRecord(id: 's1', workDate: '2026-08-19', status: AttendanceStatus.complete, totalMinutes: 480);
    final t = (await repo.today())!;
    expect(t.id, 's1');
    expect((await db.recordFor('w1', '2026-08-19'))!.totalMinutes, 480);
  });

  test('today offline: what the phone remembers, still marked pending', () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    remote.todayError = const SocketException('down');
    final t = (await repo.today())!;
    expect(t.status, AttendanceStatus.working);
    expect(t.pending, isTrue);
  });

  test('today: a queued Time In survives the server saying "nothing yet"', () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    remote.todayRow = null;
    expect((await repo.today())!.pending, isTrue);
  });

  test('today offline with nothing cached is an error, not an empty day', () async {
    remote.todayError = const SocketException('down');
    await expectLater(repo.today(), throwsA(isA<SocketException>()));
  });

  test('today: no row anywhere and nothing queued clears a stale mirror', () async {
    await db.upsertRecord('w1', AttendanceRecord(id: 'x', workDate: '2026-08-19', status: AttendanceStatus.working), pending: false);
    expect(await repo.today(), isNull);
    expect(await db.recordFor('w1', '2026-08-19'), isNull);
  });

  test('history is mirrored when fetched and served offline', () async {
    remote.historyRows = [AttendanceRecord(id: 'h', workDate: '2026-08-18', status: AttendanceStatus.complete, totalMinutes: 500)];
    expect((await repo.history('2026-08-17', '2026-08-19')).single.id, 'h');
    remote.historyError = const SocketException('down');
    expect((await repo.history('2026-08-17', '2026-08-19')).single.totalMinutes, 500);
  });

  test('history offline with an empty mirror is an error, never "you never worked"', () async {
    remote.historyError = const SocketException('down');
    await expectLater(repo.history('2026-08-01', '2026-08-02'), throwsA(isA<SocketException>()));
  });

  test('projects: a fresh list replaces the cache; offline serves the cache', () async {
    remote.projectRows = [const AttendanceProject(system: ProjectSystem.pc, id: 'p2', name: 'New Site')];
    expect((await repo.activeProjects()).single.id, 'p2');
    remote.projectsError = const SocketException('down');
    expect((await repo.activeProjects()).single.name, 'New Site');
  });
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `flutter test test/attendance/data/attendance_repository_test.dart`
Expected: FAIL — missing `attendance_repository.dart`.

- [ ] **Step 4: Implement**

`lib/attendance/data/attendance_repository.dart`:

```dart
import 'dart:io';

import '../device/device_bridge.dart';
import '../domain/attendance_record.dart';
import '../domain/photo_overlay.dart';
import '../domain/today_reconcile.dart';
import '../domain/work_date.dart';
import '../sync/upload_scheduler.dart';
import 'attendance_db.dart';
import 'attendance_remote.dart';
import 'submission_request.dart';

/// Offline-first attendance. The UI never waits on the network to confirm
/// attendance: SUBMIT writes the photo, queues the row, updates the mirror and
/// returns — all on the phone. The upload happens afterwards in the background.
class AttendanceRepository {
  AttendanceRepository({
    required this.db,
    required this.remote,
    required this.device,
    required this.scheduler,
    required this.currentWorkerId,
    required this.photoDir,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final AttendanceDb db;
  final AttendanceRemote remote;
  final DeviceBridge device;
  final UploadScheduler scheduler;

  /// The signed-in worker (session id, else the last signed-in id; offline the
  /// session can report nobody). Scope for EVERY local read and write.
  final String Function() currentWorkerId;

  /// App-private directory for queued photos (never the gallery).
  final Future<Directory> Function() photoDir;
  final DateTime Function() _now;

  Future<AttendanceRecord> submit(SubmissionRequest r) async {
    final workerId = currentWorkerId();
    final workDate = WorkDate.of(r.capturedAt).iso;
    // Matched on the PAIR — an id alone is ambiguous across systems.
    final projectName = (await db.projects(workerId))
            .where((p) => p.id == r.projectId && p.system == r.projectSystem)
            .map((p) => p.name)
            .firstOrNull ??
        '';

    // Caption burned in and compressed BEFORE the row is queued: a pending row
    // must point at the exact bytes that will be uploaded.
    final dir = await photoDir();
    await dir.create(recursive: true);
    final prepared = await device.preparePhoto(
      source: r.photoPath,
      target: '${dir.path}${Platform.pathSeparator}${r.eventId}.jpg',
      caption: photoOverlayCaption(projectName, r.capturedAt),
    );
    // Decided HERE, at capture time — the upload happens later, with signal by definition.
    final queued = r.withPhoto(prepared, wasOffline: !await device.isOnline());

    await db.insertPending(PendingSubmission.fromRequest(queued, workerId: workerId, projectName: projectName, createdAt: _now()));
    final mirror = await _mirrorAfter(workerId, queued, workDate, projectName);
    await db.upsertRecord(workerId, mirror, pending: true);
    await scheduler.enqueue(r.eventId);
    return mirror;
  }

  /// Today from the mirror; the network only CORRECTS it. Throws the network
  /// error only when there is genuinely nothing to show (Unknown).
  Future<AttendanceRecord?> today() async {
    final workerId = currentWorkerId();
    final workDate = WorkDate.of(_now()).iso;
    final cached = await db.recordFor(workerId, workDate);
    final hasPending = (await db.sendable(workerId)).any((p) => WorkDate.of(p.capturedAt).iso == workDate);

    AttendanceRecord? fresh;
    Object? error;
    var answered = false;
    try {
      fresh = await remote.today(workDate);
      answered = true;
    } catch (e) {
      error = e;
    }

    switch (reconcileToday(serverAnswered: answered, server: fresh, cached: cached, hasPending: hasPending)) {
      case TodayUse(:final record):
        // Only write back what the SERVER said; a mirror rewritten from itself just churns the disk.
        if (answered && fresh != null) await db.upsertRecord(workerId, record, pending: hasPending);
        return record.copyWith(pending: hasPending);
      case TodayClear():
        await db.clearRecord(workerId, workDate);
        return null;
      case TodayUnknown():
        throw error!;
    }
  }

  /// History, mirrored as it is fetched; served from the mirror offline. An
  /// empty mirror and an unreachable server are different answers.
  Future<List<AttendanceRecord>> history(String from, String to) async {
    final workerId = currentWorkerId();
    try {
      final records = await remote.history(from, to);
      for (final r in records) {
        await db.upsertRecord(workerId, r, pending: false);
      }
      return records;
    } catch (_) {
      final cached = await db.recordsBetween(workerId, from, to);
      if (cached.isNotEmpty) return cached;
      rethrow;
    }
  }

  /// Projects, cached per worker (a different worker may have a different owner).
  Future<List<AttendanceProject>> activeProjects() async {
    final workerId = currentWorkerId();
    try {
      final projects = await remote.activeProjects();
      if (projects.isNotEmpty) await db.replaceProjects(workerId, projects);
      return projects;
    } catch (_) {
      final cached = await db.projects(workerId);
      if (cached.isNotEmpty) return cached;
      rethrow;
    }
  }

  Future<AttendanceRecord> _mirrorAfter(String workerId, SubmissionRequest r, String workDate, String projectName) async {
    final existing = await db.recordFor(workerId, workDate);
    if (r.direction == TimeDirection.timeIn) {
      return AttendanceRecord(
        id: existing?.id ?? workDate,
        workDate: workDate,
        status: AttendanceStatus.working,
        timeInAt: r.capturedAt.toUtc(),
        timeInProjectName: projectName,
        pending: true,
      );
    }
    final timeIn = existing?.timeInAt;
    return AttendanceRecord(
      id: existing?.id ?? workDate,
      workDate: workDate,
      status: AttendanceStatus.complete,
      timeInAt: timeIn,
      timeOutAt: r.capturedAt.toUtc(),
      timeInProjectName: existing?.timeInProjectName,
      timeOutProjectName: projectName,
      // Optimistic; replaced by the server's own calculation when the upload lands.
      totalMinutes: timeIn == null ? null : r.capturedAt.difference(timeIn).inMinutes,
      pending: true,
    );
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `flutter test test/attendance/data/attendance_repository_test.dart`
Expected: PASS (10 tests).

- [ ] **Step 6: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 8: Draining the queue in the background

**Files:**
- Create: `lib/attendance/sync/submission_sync.dart`, `lib/attendance/sync/background_sync.dart`, `lib/net/supabase_setup.dart`
- Modify: `lib/attendance/sync/upload_scheduler.dart` (add `WorkmanagerUploadScheduler`), `lib/main.dart` (use `initWorkMateSupabase`, initialize Workmanager, ensure the sweeper), `pubspec.yaml` (add `workmanager: ^0.10.10`)
- Test: `test/attendance/sync/submission_sync_test.dart`, `test/attendance/sync/upload_scheduler_test.dart`

**Interfaces:**
- Consumes: `AttendanceDb`, `PendingSubmission` (Task 5); `AttendanceRemote` (Task 6); `nextToSend`, `outcomeFor`, `QueueOutcome` (Task 2); `AttendanceFailure` (Task 2); `WorkDate` (Task 1); `WorkMateSessionStorage`, `SecureBox` (0B); `WorkMateHttpClient`, `UpdateNudges`, `AppConfig` (0B).
- Produces: `enum SyncResult { done, retry }`; `class SubmissionSync { SubmissionSync({required AttendanceDb db, required AttendanceRemote remote}); Future<SyncResult> drain(String workerId); }`; `abstract class WorkRegistrar { Future<void> oneOff({required String uniqueName, required bool replace}); Future<void> periodic({required String uniqueName, required Duration frequency}); }`; `class WorkmanagerUploadScheduler implements UploadScheduler { WorkmanagerUploadScheduler([WorkRegistrar? registrar]); }`; `const submitWork = 'attendance-submission'`; `const sweepWork = 'attendance-submission-sweep'`; `@pragma('vm:entry-point') void attendanceCallbackDispatcher()`; `Future<SupabaseClient> initWorkMateSupabase({required WorkMateHttpClient httpClient, required LocalStorage localStorage})`.

- [ ] **Step 1: Add the package**

```powershell
flutter pub add workmanager:^0.10.10
```

- [ ] **Step 2: Write the failing tests**

`test/attendance/sync/submission_sync_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/attendance/data/attendance_db.dart';
import 'package:workmate/attendance/data/attendance_remote.dart';
import 'package:workmate/attendance/data/submission_request.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/sync/submission_sync.dart';

class ScriptedRemote implements AttendanceRemote {
  final sent = <String>[];
  final Map<String, Object> failures = {};
  AttendanceRecord? todayRow;
  @override
  Future<AttendanceRecord> submit(SubmissionRequest r) async {
    sent.add('${r.direction.wire}:${r.eventId}');
    final f = failures[r.eventId];
    if (f != null) throw f;
    return AttendanceRecord(
        id: 'srv-${r.eventId}', workDate: WorkDate.of(r.capturedAt).iso, status: r.direction == TimeDirection.timeIn ? AttendanceStatus.working : AttendanceStatus.complete, totalMinutes: r.direction == TimeDirection.timeOut ? 585 : null);
  }
  @override
  Future<AttendanceRecord?> today(String workDate) async => todayRow;
  @override
  Future<List<AttendanceRecord>> history(String from, String to) async => [];
  @override
  Future<List<AttendanceProject>> activeProjects() async => [];
}

void main() {
  late AttendanceDb db;
  late Directory tmp;
  late ScriptedRemote remote;
  late SubmissionSync sync;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await AttendanceDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    tmp = await Directory.systemTemp.createTemp('wmsync');
    remote = ScriptedRemote();
    sync = SubmissionSync(db: db, remote: remote);
  });
  tearDown(() async {
    await db.close();
    await tmp.delete(recursive: true);
  });

  Future<String> queue(String eventId, TimeDirection d, String created, {String workerId = 'w1', bool photo = true}) async {
    final path = '${tmp.path}/$eventId.jpg';
    if (photo) File(path).writeAsBytesSync([1]);
    await db.insertPending(PendingSubmission.fromRequest(
      SubmissionRequest(
          direction: d, projectSystem: ProjectSystem.pc, projectId: 'p1', capturedAt: DateTime.parse(created),
          trustedAt: null, photoPath: path, description: null, eventId: eventId),
      workerId: workerId,
      projectName: 'ABC',
      createdAt: DateTime.parse(created),
    ));
    return path;
  }

  test('one run drains everything, Time In before Time Out, and cleans up', () async {
    final outPhoto = await queue('out', TimeDirection.timeOut, '2026-08-18T23:00:00Z');
    final inPhoto = await queue('in', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    expect(await sync.drain('w1'), SyncResult.done);
    expect(remote.sent, ['IN:in', 'OUT:out']);
    expect(await db.sendable('w1'), isEmpty);
    expect(File(inPhoto).existsSync(), isFalse);
    expect(File(outPhoto).existsSync(), isFalse);
    expect((await db.recordFor('w1', '2026-08-19'))!.totalMinutes, 585);
  });

  test("another worker's rows are never sent", () async {
    await queue('theirs', TimeDirection.timeIn, '2026-08-18T23:00:00Z', workerId: 'w2');
    expect(await sync.drain('w1'), SyncResult.done);
    expect(remote.sent, isEmpty);
    expect((await db.sendable('w2')).length, 1);
  });

  test('no signal keeps the row and asks WorkManager to retry', () async {
    await queue('e1', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    remote.failures['e1'] = const SocketException('down');
    expect(await sync.drain('w1'), SyncResult.retry);
    final row = (await db.sendable('w1')).single;
    expect(row.attempts, 1);
    expect(row.lastError, 'noConnection');
  });

  test('the server already having the day drops the row and adopts its record', () async {
    final photo = await queue('e1', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    remote.failures['e1'] = const PostgrestException(message: 'ALREADY_TIMED_IN', code: 'P0001');
    remote.todayRow = AttendanceRecord(id: 'other-phone', workDate: '2026-08-19', status: AttendanceStatus.working);
    expect(await sync.drain('w1'), SyncResult.done);
    expect(await db.pendingById('e1'), isNull);
    expect(File(photo).existsSync(), isFalse);
    expect((await db.recordFor('w1', '2026-08-19'))!.id, 'other-phone');
  });

  test('a permanent refusal is kept and flagged, and the rest of the queue still goes', () async {
    await queue('bad', TimeDirection.timeIn, '2026-08-18T23:00:00Z');
    await queue('good', TimeDirection.timeIn, '2026-08-19T23:00:00Z');
    remote.failures['bad'] = const PostgrestException(message: 'OUTSIDE_RADIUS', code: 'P0001');
    expect(await sync.drain('w1'), SyncResult.done);
    expect((await db.failed('w1')).single.lastError, 'outsideRadius');
    expect(remote.sent, ['IN:bad', 'IN:good']);
  });

  test('a missing photo fails the row permanently instead of recording no evidence', () async {
    await queue('e1', TimeDirection.timeIn, '2026-08-18T23:45:00Z', photo: false);
    expect(await sync.drain('w1'), SyncResult.done);
    expect((await db.failed('w1')).single.lastError, 'PHOTO_MISSING');
    expect(remote.sent, isEmpty);
  });

  test('a row with no project system fails permanently (PROJECT_RETIRED)', () async {
    await queue('e1', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    final row = (await db.sendable('w1')).single;
    await db.insertPending(row.copyWithSystem(''));
    expect(await sync.drain('w1'), SyncResult.done);
    expect((await db.failed('w1')).single.lastError, 'PROJECT_RETIRED');
  });

  test('no worker, nothing sent', () async {
    await queue('e1', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    expect(await sync.drain(''), SyncResult.done);
    expect(remote.sent, isEmpty);
  });
}
```

`test/attendance/sync/upload_scheduler_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/sync/upload_scheduler.dart';

class RecordingRegistrar implements WorkRegistrar {
  final calls = <String>[];
  @override
  Future<void> oneOff({required String uniqueName, required bool replace}) async =>
      calls.add('oneOff $uniqueName ${replace ? 'REPLACE' : 'KEEP'}');
  @override
  Future<void> periodic({required String uniqueName, required Duration frequency}) async =>
      calls.add('periodic $uniqueName ${frequency.inMinutes}m');
}

void main() {
  test('every upload attempt shares ONE unique name, so only one is ever in flight', () async {
    final r = RecordingRegistrar();
    final s = WorkmanagerUploadScheduler(r);
    await s.enqueue('e1');
    await s.enqueue('e2');
    await s.sendNow();
    await s.ensureSweeper();
    expect(r.calls, [
      'oneOff attendance-submission KEEP',
      'oneOff attendance-submission KEEP',
      'oneOff attendance-submission REPLACE',
      'periodic attendance-submission-sweep 15m',
    ]);
  });
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `flutter test test/attendance/sync`
Expected: FAIL — missing `submission_sync.dart`, `WorkRegistrar`, `WorkmanagerUploadScheduler`.

- [ ] **Step 4: Implement the drain**

`lib/attendance/sync/submission_sync.dart`:

```dart
import 'dart:io';

import '../data/attendance_db.dart';
import '../data/attendance_remote.dart';
import '../data/submission_request.dart';
import '../domain/attendance_failure.dart';
import '../domain/submission_queue.dart';
import '../domain/work_date.dart';

enum SyncResult {
  /// Queue empty or everything settled.
  done,

  /// A transient failure: WorkManager should retry with backoff.
  retry,
}

/// A sane ceiling for one pass; a real queue is a handful of rows.
const _maxPerRun = 50;

/// Drains the queue: ONE run sends every row in order (Time In before Time Out,
/// oldest first, only this worker's), stopping at the first transient failure.
class SubmissionSync {
  SubmissionSync({required this.db, required this.remote});

  final AttendanceDb db;
  final AttendanceRemote remote;

  Future<SyncResult> drain(String workerId) async {
    // With no session nothing may be sent: the RPC would file it under whoever signs in next.
    if (workerId.isEmpty) return SyncResult.done;
    for (var i = 0; i < _maxPerRun; i++) {
      final queue = await db.sendable(workerId);
      final next = nextToSend(queue.map((p) => p.toQueued()).toList(), workerId);
      if (next == null) return SyncResult.done;
      final row = queue.firstWhere((p) => p.eventId == next.eventId);
      if (await _send(row, workerId) == SyncResult.retry) return SyncResult.retry;
    }
    return SyncResult.done;
  }

  Future<SyncResult> _send(PendingSubmission row, String workerId) async {
    final photo = File(row.photoLocalPath);
    if (!photo.existsSync()) {
      // Inventing a path would record attendance with no evidence.
      await db.markFailed(row.eventId, 'PHOTO_MISSING');
      return SyncResult.done;
    }
    final request = row.toRequest();
    if (request == null) {
      await db.markFailed(row.eventId, 'PROJECT_RETIRED');
      return SyncResult.done;
    }

    try {
      // The SHUTTER time travels with the row; the upload time is never used.
      final record = await remote.submit(request);
      await db.upsertRecord(workerId, record, pending: false);
      await db.deletePending(row.eventId);
      _discard(photo); // only now is the photo safe to delete
      return SyncResult.done;
    } catch (error) {
      final failure = AttendanceFailure.of(error);
      await db.recordAttempt(row.eventId, failure.name);
      switch (outcomeFor(failure)) {
        case QueueOutcome.retry:
          return SyncResult.retry;
        case QueueOutcome.dropAndReconcile:
          // The server already holds this day (usually another phone). Its version wins.
          try {
            final server = await remote.today(WorkDate.of(row.capturedAt).iso);
            if (server != null) await db.upsertRecord(workerId, server, pending: false);
          } catch (_) {}
          await db.deletePending(row.eventId);
          _discard(photo);
          return SyncResult.done;
        case QueueOutcome.failPermanently:
          // Kept, flagged and surfaced: never let a worker believe the day was recorded.
          await db.markFailed(row.eventId, failure.name);
          return SyncResult.done;
      }
    }
  }

  void _discard(File photo) {
    try {
      photo.deleteSync();
    } catch (_) {}
  }
}
```

- [ ] **Step 5: Implement the scheduler, the shared Supabase setup and the background entry point**

Replace `lib/attendance/sync/upload_scheduler.dart` with:

```dart
import 'package:workmanager/workmanager.dart';

/// "Send what is waiting" — an interface so the repository and screens test
/// without WorkManager.
abstract class UploadScheduler {
  /// Queue an upload attempt (KEEP: an attempt already scheduled drains this row too).
  Future<void> enqueue(String eventId);

  /// A fresh attempt NOW, restarting any accrued backoff (REPLACE): the moment a
  /// human opens the app and can see "Not sent yet".
  Future<void> sendNow();

  /// The 15-minute backstop for a row whose enqueue never happened.
  Future<void> ensureSweeper();
}

/// ONE name for every upload attempt, so WorkManager serialises them (the
/// Kotlin app once sent the same photo three times in two seconds with a
/// per-event name).
const submitWork = 'attendance-submission';
const sweepWork = 'attendance-submission-sweep';

/// The WorkManager calls, behind a seam so the policies are testable.
abstract class WorkRegistrar {
  Future<void> oneOff({required String uniqueName, required bool replace});
  Future<void> periodic({required String uniqueName, required Duration frequency});
}

class _WorkmanagerRegistrar implements WorkRegistrar {
  final _constraints = Constraints(networkType: NetworkType.connected);

  @override
  Future<void> oneOff({required String uniqueName, required bool replace}) => Workmanager().registerOneOffTask(
        uniqueName,
        submitWork,
        constraints: _constraints,
        existingWorkPolicy: replace ? ExistingWorkPolicy.replace : ExistingWorkPolicy.keep,
        // Exponential from 30 s: a site with intermittent signal is not hammered.
        backoffPolicy: BackoffPolicy.exponential,
        backoffPolicyDelay: const Duration(seconds: 30),
      );

  @override
  Future<void> periodic({required String uniqueName, required Duration frequency}) => Workmanager().registerPeriodicTask(
        uniqueName,
        submitWork,
        frequency: frequency,
        constraints: _constraints,
        existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
      );
}

class WorkmanagerUploadScheduler implements UploadScheduler {
  WorkmanagerUploadScheduler([WorkRegistrar? registrar]) : _registrar = registrar ?? _WorkmanagerRegistrar();

  final WorkRegistrar _registrar;

  @override
  Future<void> enqueue(String eventId) => _registrar.oneOff(uniqueName: submitWork, replace: false);

  @override
  Future<void> sendNow() => _registrar.oneOff(uniqueName: submitWork, replace: true);

  @override
  Future<void> ensureSweeper() => _registrar.periodic(uniqueName: sweepWork, frequency: const Duration(minutes: 15));
}
```

(Verified against workmanager 0.10.10 / platform_interface 0.10.5: `ExistingWorkPolicy`, `ExistingPeriodicWorkPolicy`, `BackoffPolicy` and `Constraints({NetworkType? networkType, …})` are exported under these names.)

`lib/net/supabase_setup.dart`:

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import 'workmate_http_client.dart';

/// The ONE Supabase configuration, used by the app and by the background sync
/// (which runs in its own isolate and must build the same client). Initialize
/// is a no-op when the engine is already initialized.
Future<SupabaseClient> initWorkMateSupabase({
  required WorkMateHttpClient httpClient,
  required LocalStorage localStorage,
}) async {
  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    publishableKey: AppConfig.supabaseAnonKey,
    httpClient: httpClient,
    authOptions: FlutterAuthClientOptions(localStorage: localStorage),
    // postgrest's default 3 retries with 2/4/8 s back-off held the offline
    // launch on a spinner for ~15 s; the app has its own fallbacks.
    postgrestOptions: const PostgrestClientOptions(retryEnabled: false),
  );
  return Supabase.instance.client;
}
```

`lib/attendance/sync/background_sync.dart`:

```dart
import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:workmanager/workmanager.dart';

import '../../auth/session_storage.dart';
import '../../net/supabase_setup.dart';
import '../../net/update_nudges.dart';
import '../../net/workmate_http_client.dart';
import '../data/attendance_db.dart';
import '../data/attendance_remote.dart';
import 'submission_sync.dart';

/// WorkManager's entry point. Runs in a background isolate (or on the main
/// engine when the app is alive), so it builds its own client and database —
/// the platform channels of MainActivity are NOT available here and nothing
/// below needs them.
@pragma('vm:entry-point')
void attendanceCallbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    try {
      return await runBackgroundSync();
    } catch (_) {
      // false = retry with backoff; the rows are still on disk.
      return false;
    }
  });
}

/// True when the queue is settled (or nothing may be sent), false to retry.
Future<bool> runBackgroundSync() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final info = await PackageInfo.fromPlatform();
  final client = await initWorkMateSupabase(
    httpClient: WorkMateHttpClient(versionCode: int.parse(info.buildNumber), nudges: UpdateNudges()),
    localStorage: WorkMateSessionStorage(secure: SecureBox(), plain: prefs),
  );

  // The stored session may be expired: join (or start) its refresh before sending.
  try {
    await client.auth.getSession().timeout(const Duration(seconds: 10));
  } on AuthRetryableFetchException {
    return false;
  } on TimeoutException {
    return false;
  } on AuthException {
    return true; // signed out (e.g. token revoked): nothing may be sent under nobody
  }

  final workerId = client.auth.currentUser?.id ?? '';
  final db = await openDeviceAttendanceDb();
  try {
    final result = await SubmissionSync(db: db, remote: SupabaseAttendanceRemote(client)).drain(workerId);
    return result == SyncResult.done;
  } finally {
    await db.close();
  }
}
```

(Verified in gotrue 2.27.2: `getSession()` returns a still-valid session as-is, refreshes an expired one through the same de-duplicated refresh the app uses, returns null with no session, and throws `AuthException` when the refresh fails. With no session the drain sends nothing and the 15-minute sweeper tries again later.)

- [ ] **Step 6: Wire it into the app**

In `lib/main.dart`:
1. Replace the inline `await Supabase.initialize(...)` + `final client = Supabase.instance.client;` with:

```dart
  final client = await initWorkMateSupabase(httpClient: httpClient, localStorage: sessionStorage);
```

2. After the client is created, add:

```dart
  // Background sending of queued Time Ins / Time Outs (0C). The sweeper is the
  // backstop for a row whose enqueue never happened (process killed mid-submit).
  await Workmanager().initialize(attendanceCallbackDispatcher);
  await WorkmanagerUploadScheduler().ensureSweeper();
```

3. Add imports: `import 'package:workmanager/workmanager.dart';`, `import 'attendance/sync/background_sync.dart';`, `import 'attendance/sync/upload_scheduler.dart';`, `import 'net/supabase_setup.dart';` (remove the now-unused imports the analyzer reports).

- [ ] **Step 7: Run all checks**

Run: `flutter test` → all pass.
Run: `flutter analyze` → `No issues found!`
Run: `flutter build apk --debug` → builds.
Run (PowerShell): `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location` → `BUILD SUCCESSFUL`.

- [ ] **Step 8: Checkpoint**

Report `git status --short`. Do not commit.

---

## After 0C-1

0C-1 ends with a tested engine and no new screens: the app behaves exactly as 0B for the worker. **0C-2 (screens)** is planned next and wires this engine into: the four-step Time In / Time Out flow (project picker, in-app camera, check photo, describe with chips, submit, confirmation), the bilingual refusal notices, the location-permission request, Home's today card and week strip with "Not sent yet" / "couldn't send" states and `sendNow()` on resume, History (week/month, photos through signed URLs), and on-device verification of the native bridge, the background sync and the Kotlin parity rows. Device checks deferred to 0C-2: a real fix and a real mock-location app; the burned-in caption on a front-camera photo; an offline Time In that uploads after the app is swiped away; two engines refreshing the same session (app alive + periodic sweep) without signing the worker out.

## Self-review notes

- Parity rows covered here: trusted time, location/geofence/mock/location-off, photo overlay + sampling + caption fit, offline queue (per worker, IN before OUT, retry/drop/fail), work date, total hours, today reconcile, history range/days/summary, week strip, description chips. Camera capture, the flow UI and History UI are 0C-2.
- Kotlin tests ported: TrustedTime, WorkDate, TotalHours, PhotoOverlay, LocationVerification, AttendanceFailure, SubmissionQueue, TodayReconcile, HistoryRange, DescriptionChips (Dart); CaptionFit, PhotoSampling (Kotlin JUnit).
- Deliberate differences from the Kotlin app: the queue's `wasOffline` comes from the same VALIDATED-internet check via the bridge; the background task opens its own Supabase client (Flutter isolate) instead of sharing a Hilt singleton — the same session storage and the server's refresh-token reuse window make this safe, verified on device in 0C-2.

## Execution notes (done 2026-10-01)

Built with subagent-driven development; 242 tests pass, `flutter analyze` clean, Gradle unit tests and a debug APK build pass. Uncommitted in `Dacs WorkMate` (the user commits). Deliberate deviations from the code above, each reviewed:

- **Clock anchor** is one prefs value `clock.anchor` = `serverMs|uptimeMs|boot` (one atomic write), not three keys — a torn anchor could skew `p_trusted_at` by days.
- **`preparePhoto`** catches `Throwable` (out-of-memory answers `PHOTO_FAILED`); `compress()`'s result is checked and a partial target is deleted — the raw capture is deleted only after a good encode.
- **The phone's mirror wins while a queue row for that day is still unsent** — in `reconcileToday`, `today()`, `history()` and the sync's success/drop paths. The Kotlin app let the server's older row overwrite a queued Time Out.
- **One token refresher per process.** Workmanager runs every task in a NEW Flutter engine (a second gotrue client over the same stored session; `Supabase.initialize` alone refreshes a stale token). The live app registers an `IsolateNameServer` port (`lib/attendance/sync/sync_host.dart`); the background task hands the drain to it before any Supabase init, and only initializes Supabase itself when no app answers AND something is queued (`hasAnySendable`).
- **Sync opens its own DB connection** (`singleInstance: false`): sqflite's single-instance handles are shared by all engines and a background `close()` would close the app's.
- **`submit(r, workerId:)`** refuses to send when the signed-in user is not the row's worker (retry, never filed under someone else). Repository `submit()` refuses an empty worker; an `enqueue` failure no longer fails a saved submit; `ClockAnchorStore.now()` never throws; Workmanager setup can never stop the app from starting.

Carried into 0C-2 (device checks and small follow-ups):
- Device-verify: real fix + a mock-location app; front-camera caption; full-disk photo failure; offline Time In that uploads after the app is swiped away; app-closed sweeper with an expired session does NOT sign the worker out; app-alive delegation through the sync host; plugins available in the background engine.
- Re-register the sync host on app resume (a >3 s ack drops the mapping until restart).
- Runtime location-permission request (the bridge answers `permissionDenied` until then).
- Consider: sweeper only re-enqueues the one-off (no concurrent drains); store the first line of `unexpected` errors in `last_error`; `Error.throwWithStackTrace` in `today()`; a transaction around queue insert + mirror write.
- **Dacs Web:** the storage policy "attendance: worker replaces own photo" (UPDATE, needed for upload retries) exists only in the live DB — capture it in a migration.
