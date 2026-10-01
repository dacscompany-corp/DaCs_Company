# WorkMate Stage 0C-2 — Attendance Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workers can Time In and Time Out in DAC'S WorkMate exactly as in DACS Attendance — the four-step flow (project, photo, check, describe), Home with today's record and the week strip, History with photos — on top of the 0C-1 engine, verified on a real phone.

**Architecture:** Each screen gets a plain `ChangeNotifier` controller (a port of the Kotlin ViewModel) that talks to the engine through one interface, `AttendanceApi`, so every controller and screen is tested with fakes and no database. The flow is MODAL: while recording there are no tabs. The camera step is injected (`CameraStepBuilder`) so widget tests drive the whole flow with a fake shutter; the real step uses the `camera` plugin and asks for camera AND location permission together (`permission_handler`), like the old app.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, camera 0.12.0+2 (CameraX), permission_handler 13.0.2, the 0C-1 engine (`lib/attendance/**`), Kotlin bridge additions (mirror, open Location settings).

**Spec:** [docs/superpowers/specs/2026-09-29-unified-worker-app-design.md](../specs/2026-09-29-unified-worker-app-design.md) §3 ("Existing Time In, Time Out, photos, location checks, history and offline attendance continue working"). Roadmap row 0C: [2026-09-29-workmate-stage0-roadmap.md](2026-09-29-workmate-stage0-roadmap.md). Engine and its carry-over list: [2026-09-30-workmate-stage0c1-attendance-engine.md](2026-09-30-workmate-stage0c1-attendance-engine.md) "Execution notes".

**Behaviour reference (ported, not improved):** `Documents\Dacs Attendance\app\src\main\` — `res/values/strings.xml` (every word on these screens), `java/com/dacs/attendance/ui/timeflow/{TimeFlowViewModel,TimeFlowScreen,CameraCapture}.kt`, `ui/dashboard/{DashboardViewModel,DashboardScreen}.kt`, `ui/history/{HistoryViewModel,HistoryScreen}.kt`, `ui/components/AttendanceFailureNotice.kt`, `ui/AttendanceRoot.kt`. Design reference: `Downloads\MVP terms and interactive design layout (fixed 2026-09-30).zip` (WorkMate tabs: Home, Requests, Work, History, Profile — Requests and Work arrive in Stage 1).

## Global Constraints

- Repo: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate` (package `workmate`). Task 9 alone works in `C:\Users\John Aerol Tapales\Documents\Dacs Web`.
- **The user commits manually.** Never run `git commit`, `git push`, `git add`, `git stash`, `git reset` or `git checkout`. "Checkpoint" = stop and report `git status --short`.
- **Screen copy is English; failure copy is bilingual (English, then Tagalog).** Use DACS Attendance's exact strings (they are quoted in this plan). Only three strings are NEW and marked so: the Time Out variant of the camera give-up notice, the refused-submission lead line, and nothing else.
- **Time In is green `#1A5C3A`, Time Out brown `#7C5E2A`** — one flow, two colours (`accentFor`).
- Every time and date on screen is **Manila** (`lib/attendance/ui/formats.dart`), never the phone's zone.
- The flow is **modal** (no bottom bar while recording). Back from step 1 leaves the flow; back from later steps goes one step back.
- Camera and location permission are asked **together, at the camera step**. Only the camera result gates that step. The device never requires a geofence (`requireGeofence: false`); `minAccuracyMetres` is **50**.
- **Front camera by default, back one tap away; a front-camera photo is filed mirrored, as previewed.** No gallery picker anywhere.
- The event id is minted **once per flow** and reused on every retry; the shutter time and trusted time are frozen **at the shutter**.
- Package versions exactly: `camera: 0.12.0+2`, `permission_handler: 13.0.2`. No other new packages.
- No WorkMate-side migration. `versionCode` stays ≥ 1000; Task 8 sets `version: 0.2.0+1002`.
- After every task: `flutter test` all pass, `flutter analyze` → `No issues found!`; tasks touching Kotlin or plugins also run `flutter build apk --debug`. JDK 21: `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/attendance/data/attendance_api.dart` | The one interface every screen uses |
| `lib/attendance/data/attendance_photos.dart` | Signed photo links, cached for their hour |
| `lib/attendance/domain/event_id.dart` | A v4 UUID for each submission |
| `lib/attendance/ui/formats.dart` | Manila clock/date text |
| `lib/attendance/ui/attendance_copy.dart` | All bilingual failure copy, labels, chips, settings routes |
| `lib/attendance/ui/attendance_failure_notice.dart` | The refusal notice with TRY AGAIN / Open Settings / Dismiss |
| `lib/attendance/ui/status_pill.dart` | The small green/brown pill |
| `lib/ui/worker_header.dart` | Avatar, name, position · ID |
| `lib/attendance/flow/time_flow_controller.dart` | The four steps' state and SUBMIT |
| `lib/attendance/flow/time_flow_screen.dart` | Header, project, check, describe, confirmation; camera injected |
| `lib/attendance/flow/camera_step.dart` | The real camera, permissions, shutter |
| `lib/attendance/home/home_controller.dart` + `home_screen.dart` | Home |
| `lib/attendance/history/history_controller.dart` + `history_screen.dart` + `photo_viewer.dart` | History |
| `lib/attendance/attendance_services.dart` | What main.dart hands the screens |
| `lib/ui/home_shell.dart` | Tabs Home / History / Profile, and the modal flow |
| `test/attendance/fakes.dart` | Shared fakes for controller and widget tests |

---

### Task 1: Engine additions the screens need

**Files:**
- Create: `lib/attendance/data/attendance_api.dart`, `lib/attendance/data/attendance_photos.dart`, `lib/attendance/domain/event_id.dart`
- Modify: `lib/attendance/data/attendance_repository.dart`, `lib/attendance/device/device_bridge.dart`, `android/app/src/main/kotlin/com/dacs/workmate/AttendanceBridge.kt`, `android/app/src/main/kotlin/com/dacs/workmate/PhotoPreparer.kt`
- Modify tests: `test/attendance/data/attendance_repository_test.dart`, `test/attendance/device/clock_anchor_store_test.dart`, `test/attendance/device/device_bridge_test.dart`
- Test (new): `test/attendance/domain/event_id_test.dart`, `test/attendance/data/attendance_photos_test.dart`

**Interfaces:**
- Consumes: `AttendanceRepository`, `PendingSubmission`, `AttendanceDb.failed/pendingById/deletePending` (0C-1), `photoBucket` (`attendance_remote.dart`).
- Produces: `abstract interface class AttendanceApi { Future<List<AttendanceProject>> activeProjects(); Future<AttendanceRecord> submit(SubmissionRequest r, {bool mirrorPhoto = false}); Future<AttendanceRecord?> today(); Future<List<AttendanceRecord>> history(String from, String to); Future<List<PendingSubmission>> refusedSubmissions(); Future<void> dismissRefused(String eventId); }` (implemented by `AttendanceRepository`); `DeviceBridge.preparePhoto({required String source, required String target, required String caption, bool mirror = false})`; `DeviceBridge.openLocationSettings()`; `String newEventId([Random? random])`; `class AttendancePhotos { AttendancePhotos(Future<String> Function(String path, int expiresInSeconds) sign, {DateTime Function()? now}); factory AttendancePhotos.supabase(SupabaseClient client); static const lifetime = Duration(hours: 1); Future<String?> signedUrl(String? path); }`.

- [ ] **Step 1: Update the existing fakes for the widened DeviceBridge**

In `test/attendance/device/clock_anchor_store_test.dart`, replace `FakeBridge`'s `preparePhoto` override and add `openLocationSettings`:

```dart
  @override
  Future<String> preparePhoto({required String source, required String target, required String caption, bool mirror = false}) async => target;
  @override
  Future<void> openLocationSettings() async {}
```

In `test/attendance/data/attendance_repository_test.dart`, replace `FakeDevice` with:

```dart
class FakeDevice implements DeviceBridge {
  bool online = false;
  String? lastCaption;
  bool? lastMirror;
  @override
  Future<DeviceClockReading> clock() async => const DeviceClockReading(uptimeMillis: 0, bootCount: null);
  @override
  Future<bool> isOnline() async => online;
  @override
  Future<DeviceFix> currentFix() async => const DeviceFix();
  @override
  Future<String> preparePhoto({required String source, required String target, required String caption, bool mirror = false}) async {
    lastCaption = caption;
    lastMirror = mirror;
    await File(source).copy(target);
    await File(source).delete();
    return target;
  }

  @override
  Future<void> openLocationSettings() async {}
}
```

- [ ] **Step 2: Write the failing tests**

Append inside `main()` of `test/attendance/data/attendance_repository_test.dart`:

```dart
  test('a front-camera photo is filed mirrored, as the worker saw it', () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'), mirrorPhoto: true);
    expect(device.lastMirror, isTrue);
  });

  test('a back-camera photo is filed as taken', () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    expect(device.lastMirror, isFalse);
  });

  test("refused submissions are this worker's failed rows only", () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    expect(await repo.refusedSubmissions(), isEmpty);
    await db.markFailed('e1', 'outsideRadius');
    final refused = await repo.refusedSubmissions();
    expect(refused.single.eventId, 'e1');
    expect(refused.single.lastError, 'outsideRadius');
  });

  test('dismissing a refused submission deletes the row and its photo', () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    final photo = (await db.sendable('w1')).single.photoLocalPath;
    await db.markFailed('e1', 'outsideRadius');
    await repo.dismissRefused('e1');
    expect(await db.pendingById('e1'), isNull);
    expect(File(photo).existsSync(), isFalse);
  });

  test('a row still owed to the server cannot be dismissed', () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    await repo.dismissRefused('e1');
    expect(await db.pendingById('e1'), isNotNull);
  });

  test("another worker's refused row is neither listed nor dismissed", () async {
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    await db.markFailed('e1', 'outsideRadius');
    final other = AttendanceRepository(
      db: db,
      remote: remote,
      device: device,
      scheduler: scheduler,
      currentWorkerId: () => 'w2',
      photoDir: () async => tmp,
      now: () => now,
    );
    expect(await other.refusedSubmissions(), isEmpty);
    await other.dismissRefused('e1');
    expect(await db.pendingById('e1'), isNotNull);
  });
```

In `test/attendance/device/device_bridge_test.dart`: add `case 'openLocationSettings': return null;` to the mock handler's `switch`, change the expected arguments of the existing `preparePhoto` test to `{'source': '/c/raw.jpg', 'target': '/f/e.jpg', 'caption': 'A · 1 Sep 2026 · 3:00 PM', 'mirror': false}`, and append:

```dart
  test('a front-camera photo asks the phone to mirror it', () async {
    await MethodChannelDeviceBridge().preparePhoto(source: '/c/raw.jpg', target: '/f/e.jpg', caption: 'A', mirror: true);
    expect((calls.single.arguments as Map)['mirror'], isTrue);
  });

  test("the phone's Location switch screen is opened natively", () async {
    await MethodChannelDeviceBridge().openLocationSettings();
    expect(calls.single.method, 'openLocationSettings');
  });
```

`test/attendance/domain/event_id_test.dart`:

```dart
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/event_id.dart';

void main() {
  final v4 = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

  test('an event id is a version 4 UUID the server accepts', () {
    for (var i = 0; i < 200; i++) {
      expect(newEventId(), matches(v4));
    }
  });

  test('ids do not repeat', () {
    expect({for (var i = 0; i < 1000; i++) newEventId()}.length, 1000);
  });

  test('a seeded generator is repeatable (for tests)', () {
    expect(newEventId(Random(7)), newEventId(Random(7)));
  });
}
```

`test/attendance/data/attendance_photos_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/data/attendance_photos.dart';

void main() {
  late DateTime now;
  late List<String> signed;
  late bool fail;
  late AttendancePhotos photos;

  setUp(() {
    now = DateTime.utc(2026, 9, 30, 1);
    signed = [];
    fail = false;
    photos = AttendancePhotos((path, seconds) async {
      if (fail) throw Exception('offline');
      signed.add('$path@$seconds');
      return 'https://example.invalid/$path?n=${signed.length}';
    }, now: () => now);
  });

  test('no path asks for nothing', () async {
    expect(await photos.signedUrl(null), isNull);
    expect(await photos.signedUrl(''), isNull);
    expect(signed, isEmpty);
  });

  test('a link lasts an hour and is reused inside it', () async {
    final first = await photos.signedUrl('w/2026-09-30/in-e.jpg');
    now = now.add(const Duration(minutes: 50));
    expect(await photos.signedUrl('w/2026-09-30/in-e.jpg'), first);
    expect(signed, ['w/2026-09-30/in-e.jpg@3600']);
  });

  test('a link about to expire is signed again', () async {
    await photos.signedUrl('p');
    now = now.add(const Duration(minutes: 56));
    await photos.signedUrl('p');
    expect(signed.length, 2);
  });

  test('a failed signing is no photo, and is not remembered', () async {
    fail = true;
    expect(await photos.signedUrl('p'), isNull);
    fail = false;
    expect(await photos.signedUrl('p'), isNotNull);
  });
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `flutter test test/attendance`
Expected: FAIL — `mirrorPhoto`, `refusedSubmissions`, `openLocationSettings`, `event_id.dart`, `attendance_photos.dart` do not exist.

- [ ] **Step 4: Implement the Dart side**

`lib/attendance/data/attendance_api.dart`:

```dart
import '../domain/attendance_record.dart';
import 'submission_request.dart';

/// What the attendance screens need from the engine. An interface so every
/// controller and screen tests with a fake instead of a database and a server.
abstract interface class AttendanceApi {
  /// The worker's projects: fresh when online, the cached list offline.
  Future<List<AttendanceProject>> activeProjects();

  /// Saves a Time In / Time Out on the phone and queues its upload.
  /// [mirrorPhoto] files a front-camera capture as previewed (mirrored).
  Future<AttendanceRecord> submit(SubmissionRequest r, {bool mirrorPhoto = false});

  /// Today's record, null when there is none; throws when it cannot be known.
  Future<AttendanceRecord?> today();

  /// Records between two ISO dates, newest first.
  Future<List<AttendanceRecord>> history(String from, String to);

  /// This worker's submissions the server refused for good, oldest first.
  Future<List<PendingSubmission>> refusedSubmissions();

  /// Forgets one refused submission (the worker has read why) and deletes its photo.
  Future<void> dismissRefused(String eventId);
}
```

In `lib/attendance/data/attendance_repository.dart`:
1. Add `import 'attendance_api.dart';` and change the class line to `class AttendanceRepository implements AttendanceApi {`.
2. Change the submit signature to:

```dart
  @override
  Future<AttendanceRecord> submit(SubmissionRequest r, {bool mirrorPhoto = false}) async {
```

3. Pass the flag to the bridge — the `preparePhoto` call becomes:

```dart
    final prepared = await device.preparePhoto(
      source: r.photoPath,
      target: '${dir.path}${Platform.pathSeparator}${r.eventId}.jpg',
      caption: photoOverlayCaption(projectName, r.capturedAt),
      mirror: mirrorPhoto,
    );
```

4. Add `@override` above `today()`, `history(...)` and `activeProjects()`.
5. Add, directly above `_mirrorAfter`:

```dart
  @override
  Future<List<PendingSubmission>> refusedSubmissions() async {
    final workerId = currentWorkerId();
    if (workerId.isEmpty) return const [];
    return db.failed(workerId);
  }

  @override
  Future<void> dismissRefused(String eventId) async {
    final row = await db.pendingById(eventId);
    // Only this worker's own, and only a refused row: a sendable one is still owed to the server.
    if (row == null || row.workerId != currentWorkerId() || !row.failedPermanently) return;
    await db.deletePending(eventId);
    try {
      await File(row.photoLocalPath).delete();
    } catch (_) {
      // Already gone; the row was the thing that mattered.
    }
  }
```

In `lib/attendance/device/device_bridge.dart`, replace the abstract `preparePhoto` declaration and add `openLocationSettings`:

```dart
  /// Upright, scaled to 1600 px, caption burned in, JPEG 80 at [target];
  /// deletes [source]. [mirror] flips a front-camera capture so the filed
  /// photo matches the mirrored preview the worker approved. Returns [target].
  Future<String> preparePhoto({required String source, required String target, required String caption, bool mirror = false});

  /// Opens the phone-wide Location switch screen — NOT the app's permission
  /// page: sending a worker to the wrong screen strands them.
  Future<void> openLocationSettings();
```

and in `MethodChannelDeviceBridge` replace `preparePhoto` and add the new method:

```dart
  @override
  Future<String> preparePhoto({required String source, required String target, required String caption, bool mirror = false}) async =>
      await _channel.invokeMethod<String>(
        'preparePhoto',
        {'source': source, 'target': target, 'caption': caption, 'mirror': mirror},
      ) ??
      target;

  @override
  Future<void> openLocationSettings() async {
    await _channel.invokeMethod<void>('openLocationSettings');
  }
```

`lib/attendance/domain/event_id.dart`:

```dart
import 'dart:math';

final _secure = Random.secure();

/// A random (version 4) UUID: the idempotency key of one Time In or Time Out,
/// minted once per flow and reused on every retry.
String newEventId([Random? random]) {
  final r = random ?? _secure;
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  String hex(int from, int to) => b.sublist(from, to).map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
}
```

`lib/attendance/data/attendance_photos.dart`:

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

import 'attendance_remote.dart';

/// Links to attendance photos in the PRIVATE `attendance` bucket. Each link
/// lasts an hour and is reused until shortly before it expires, so scrolling
/// History back and forth does not mint a link per frame.
class AttendancePhotos {
  AttendancePhotos(this._sign, {DateTime Function()? now}) : _now = now ?? DateTime.now;

  factory AttendancePhotos.supabase(SupabaseClient client) =>
      AttendancePhotos((path, seconds) => client.storage.from(photoBucket).createSignedUrl(path, seconds));

  static const lifetime = Duration(hours: 1);
  static const _renewBefore = Duration(minutes: 5);

  final Future<String> Function(String path, int expiresInSeconds) _sign;
  final DateTime Function() _now;
  final _cache = <String, (String, DateTime)>{};

  /// A link for [path], or null (no photo yet, or no signal right now).
  Future<String?> signedUrl(String? path) async {
    if (path == null || path.isEmpty) return null;
    final hit = _cache[path];
    if (hit != null && _now().isBefore(hit.$2.subtract(_renewBefore))) return hit.$1;
    try {
      final url = await _sign(path, lifetime.inSeconds);
      _cache[path] = (url, _now().add(lifetime));
      return url;
    } catch (_) {
      return null;
    }
  }
}
```

- [ ] **Step 5: Implement the Kotlin side**

In `PhotoPreparer.kt`, change `prepare`'s signature and its first line, and add `mirrored`:

```kotlin
    fun prepare(source: File, target: File, caption: String, mirror: Boolean = false) {
        val decoded = decodeUpright(source)
        // The front camera is filed AS PREVIEWED (mirrored), as DACS Attendance
        // files it: the worker approves the mirror image, so the record matches it.
        val upright = if (mirror) mirrored(decoded) else decoded
```

(the rest of `prepare` is unchanged), and inside the object:

```kotlin
    /** Flips an already-upright bitmap left to right. */
    private fun mirrored(bitmap: Bitmap): Bitmap {
        val flipped = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postScale(-1f, 1f) }, true)
        if (flipped !== bitmap) bitmap.recycle()
        return flipped
    }
```

In `AttendanceBridge.kt`: add `import android.content.Intent`; in the `"preparePhoto"` branch read `val mirror = call.argument<Boolean>("mirror") ?: false` beside the other arguments and call `PhotoPreparer.prepare(File(source), File(target), caption, mirror)`; and add this branch before `else`:

```kotlin
            "openLocationSettings" -> {
                try {
                    context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    result.success(null)
                } catch (e: Exception) {
                    result.error("NO_SETTINGS", e.message, null)
                }
            }
```

- [ ] **Step 6: Run all checks**

Run: `flutter test` → all pass. `flutter analyze` → `No issues found!`.
Run (PowerShell): `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location` → `BUILD SUCCESSFUL`.
Run: `flutter build apk --debug` → builds.

- [ ] **Step 7: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 2: Shared screen pieces — copy, formats, notices, pills, header

**Files:**
- Create: `lib/attendance/ui/formats.dart`, `lib/attendance/ui/attendance_copy.dart`, `lib/attendance/ui/attendance_failure_notice.dart`, `lib/attendance/ui/status_pill.dart`, `lib/ui/worker_header.dart`
- Modify: `lib/ui/theme.dart` (colours), `lib/ui/failure_notice.dart` (lead line + actions)
- Test: `test/attendance/ui/formats_test.dart`, `test/attendance/ui/attendance_copy_test.dart`, `test/attendance/ui/attendance_failure_notice_test.dart`

**Interfaces:**
- Consumes: `AttendanceFailure`, `TimeDirection`, `manilaFields` (0C-1); `WorkerProfile` (0B).
- Produces: `String clockTime(DateTime)`, `weekdayName(DateTime)`, `longDate(DateTime)`, `shortDate(DateTime)`, `dayMonth(DateTime)`, `dayHeading(DateTime calendarDate)`, `daysWorked(int)`; `class Bilingual { english, tagalog }`; `Bilingual failureCopy(AttendanceFailure)`; `bool worthRetrying(AttendanceFailure)`; `enum SettingsRoute { appPermissions, locationSwitch }`; `SettingsRoute? settingsRouteFor(AttendanceFailure)`; `AttendanceFailure failureFromStored(String?)`; `Bilingual flowCancelledByCamera(TimeDirection)`; `Bilingual refusedLead(TimeDirection, String day)`; consts `retryLabel`, `openSettingsLabel`, `notNowLabel`, `dismissLabel`, `descriptionChipOptions`; `AttendanceFailureNotice({required failure, Bilingual? lead, VoidCallback? onRetry, void Function(SettingsRoute)? onOpenSettings, VoidCallback? onDismiss})`; `FailureNotice({english, tagalog, leadEnglish, leadTagalog, actions})`; `Widget noticeAction(String label, VoidCallback onPressed)`; `StatusPill.green(text)`, `StatusPill.brown(text)`; `WorkerHeader({required worker})`; new `WmColors` members `greenDeep`, `greenPressed`, `greenBorder`, `brownLight`, `brownDeep`, `textDisabled`, `textFaint`, `vacant`, `previewBackdrop`, `viewerBackdrop`.

- [ ] **Step 1: Write the failing tests**

`test/attendance/ui/formats_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/ui/formats.dart';

void main() {
  final morning = DateTime.parse('2026-08-18T23:45:00Z'); // 7:45 AM, Wednesday 19 Aug, Manila

  test('clock times are Manila, 12-hour, never 0', () {
    expect(clockTime(morning), '7:45 AM');
    expect(clockTime(DateTime.parse('2026-08-19T09:30:00Z')), '5:30 PM');
    expect(clockTime(DateTime.parse('2026-08-19T04:05:00Z')), '12:05 PM');
    expect(clockTime(DateTime.parse('2026-08-19T16:05:00Z')), '12:05 AM');
  });

  test('dates are the Manila date, not the UTC one', () {
    expect(weekdayName(morning), 'Wednesday');
    expect(longDate(morning), '19 August 2026');
    expect(shortDate(morning), '19 Aug 2026');
    expect(dayMonth(morning), '19 Aug');
  });

  test('a history heading reads the calendar date as it is', () {
    expect(dayHeading(DateTime.utc(2026, 8, 26)), 'Wednesday, 26 Aug');
  });

  test('"1 days worked" never appears', () {
    expect(daysWorked(1), '1 day worked');
    expect(daysWorked(0), '0 days worked');
    expect(daysWorked(3), '3 days worked');
  });
}
```

`test/attendance/ui/attendance_copy_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_failure.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/ui/attendance_copy.dart';

void main() {
  test('every failure has words in both languages', () {
    for (final f in AttendanceFailure.values) {
      final c = failureCopy(f);
      expect(c.english, isNotEmpty, reason: f.name);
      expect(c.tagalog, isNotEmpty, reason: f.name);
      expect(c.english, isNot(c.tagalog), reason: f.name);
    }
  });

  test("the location refusals carry DACS Attendance's exact words", () {
    expect(failureCopy(AttendanceFailure.outsideRadius).english,
        'You are too far from the project to record attendance. Move closer to the site and try again.');
    expect(failureCopy(AttendanceFailure.locationDisabled).tagalog,
        'I-on ang Location sa telepono mo para makapagtala. Mag-swipe pababa, i-tap ang Location, tapos subukan ulit.');
    expect(failureCopy(AttendanceFailure.noConnection).english, 'No signal right now. Try again in a moment.');
  });

  test('TRY AGAIN is offered only where retrying can help', () {
    for (final f in [
      AttendanceFailure.noConnection,
      AttendanceFailure.unexpected,
      AttendanceFailure.deviceClockWrong,
      AttendanceFailure.outsideRadius,
      AttendanceFailure.projectGeofenceUnavailable,
      AttendanceFailure.locationDisabled,
    ]) {
      expect(worthRetrying(f), isTrue, reason: f.name);
    }
    for (final f in [
      AttendanceFailure.alreadyTimedIn,
      AttendanceFailure.mockLocation,
      AttendanceFailure.locationPermissionDenied,
      AttendanceFailure.accountInactive,
    ]) {
      expect(worthRetrying(f), isFalse, reason: f.name);
    }
  });

  test('the permission and the phone switch send the worker to different screens', () {
    expect(settingsRouteFor(AttendanceFailure.locationPermissionDenied), SettingsRoute.appPermissions);
    expect(settingsRouteFor(AttendanceFailure.locationDisabled), SettingsRoute.locationSwitch);
    expect(settingsRouteFor(AttendanceFailure.outsideRadius), isNull);
  });

  test('a stored refusal reads back; anything else is "something went wrong"', () {
    expect(failureFromStored('outsideRadius'), AttendanceFailure.outsideRadius);
    expect(failureFromStored('PHOTO_MISSING'), AttendanceFailure.unexpected);
    expect(failureFromStored(null), AttendanceFailure.unexpected);
  });

  test('the refused-day line names the half and the day', () {
    final lead = refusedLead(TimeDirection.timeOut, '19 Aug');
    expect(lead.english, 'Your Time Out on 19 Aug was not accepted.');
    expect(lead.tagalog, 'Hindi tinanggap ang Time Out mo noong 19 Aug.');
  });

  test('a camera give-up names the half of the day it cost', () {
    expect(flowCancelledByCamera(TimeDirection.timeIn).english,
        'Time In was not recorded. The camera permission is off, and the photo is the proof of attendance.');
    expect(flowCancelledByCamera(TimeDirection.timeOut).tagalog,
        'Hindi naitala ang Time Out. Naka-off ang camera permission, at ang litrato ang patunay ng pasok.');
  });
}
```

`test/attendance/ui/attendance_failure_notice_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_failure.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/ui/attendance_copy.dart';
import 'package:workmate/attendance/ui/attendance_failure_notice.dart';
import 'package:workmate/ui/theme.dart';

Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: Scaffold(body: w));

void main() {
  testWidgets('both languages, and TRY AGAIN where it can help', (tester) async {
    var retries = 0;
    await tester.pumpWidget(wrap(AttendanceFailureNotice(failure: AttendanceFailure.noConnection, onRetry: () => retries++)));
    expect(find.text('No signal right now. Try again in a moment.'), findsOneWidget);
    expect(find.text('Walang signal ngayon. Subukan ulit mamaya.'), findsOneWidget);
    await tester.tap(find.text(retryLabel));
    expect(retries, 1);
  });

  testWidgets('no TRY AGAIN where a second attempt cannot succeed', (tester) async {
    await tester.pumpWidget(wrap(AttendanceFailureNotice(failure: AttendanceFailure.alreadyTimedIn, onRetry: () {})));
    expect(find.text('You already timed in today.'), findsOneWidget);
    expect(find.text(retryLabel), findsNothing);
  });

  testWidgets('Location switched off offers the Location screen, not the app page', (tester) async {
    final routes = <SettingsRoute>[];
    await tester.pumpWidget(wrap(AttendanceFailureNotice(failure: AttendanceFailure.locationDisabled, onOpenSettings: routes.add)));
    await tester.tap(find.text(openSettingsLabel));
    expect(routes, [SettingsRoute.locationSwitch]);
  });

  testWidgets('a lead line and a Dismiss', (tester) async {
    var dismissed = 0;
    await tester.pumpWidget(wrap(AttendanceFailureNotice(
      failure: AttendanceFailure.outsideRadius,
      lead: refusedLead(TimeDirection.timeIn, '19 Aug'),
      onDismiss: () => dismissed++,
    )));
    expect(find.text('Your Time In on 19 Aug was not accepted.'), findsOneWidget);
    expect(find.text('Hindi tinanggap ang Time In mo noong 19 Aug.'), findsOneWidget);
    await tester.tap(find.text(dismissLabel));
    expect(dismissed, 1);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/attendance/ui`
Expected: FAIL — the files do not exist.

- [ ] **Step 3: Implement**

In `lib/ui/theme.dart`, add inside `class WmColors` (after `inert`):

```dart
  // Attendance (DACS Attendance ui/theme/Color.kt).
  static const greenDeep = Color(0xFF12482D);
  static const greenPressed = Color(0xFF134428);
  static const greenBorder = Color(0xFFCBE0D2);
  static const brownLight = Color(0xFF8A6A2F);
  static const brownDeep = Color(0xFF6B4F22);
  static const textDisabled = Color(0xFFA6A6A1);
  static const textFaint = Color(0xFFC9C9C4);
  static const vacant = Color(0xFFF0F0EB);
  static const previewBackdrop = Color(0xFF131513);
  static const viewerBackdrop = Color(0xFF0F110F);
```

Replace `lib/ui/failure_notice.dart` with:

```dart
import 'package:flutter/material.dart';

import 'theme.dart';

/// Screen copy is English; failure copy is bilingual (English, then Tagalog).
/// An optional lead line says what happened, then the reason, then the
/// actions a worker can take.
class FailureNotice extends StatelessWidget {
  const FailureNotice({
    super.key,
    required this.english,
    required this.tagalog,
    this.leadEnglish,
    this.leadTagalog,
    this.actions = const [],
  });

  final String english;
  final String tagalog;
  final String? leadEnglish;
  final String? leadTagalog;
  final List<Widget> actions;

  static const _bold = TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: WmColors.danger);
  static const _plain = TextStyle(fontSize: 13, color: WmColors.danger);

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: EdgeInsets.fromLTRB(16, 14, 16, actions.isEmpty ? 14 : 4),
        decoration: BoxDecoration(
          color: WmColors.dangerTint,
          border: Border.all(color: WmColors.dangerBorder),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (leadEnglish != null) ...[Text(leadEnglish!, style: _bold), const SizedBox(height: 2)],
          if (leadTagalog != null) ...[Text(leadTagalog!, style: _plain), const SizedBox(height: 8)],
          Text(english, style: _bold),
          const SizedBox(height: 3),
          Text(tagalog, style: _plain),
          if (actions.isNotEmpty) Wrap(spacing: 4, children: actions),
        ]),
      );
}

/// A text action inside a notice. Its label is bilingual ("Dismiss · Isara").
Widget noticeAction(String label, VoidCallback onPressed) => TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(foregroundColor: WmColors.danger, padding: const EdgeInsets.symmetric(horizontal: 4)),
      child: Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
    );
```

`lib/attendance/ui/formats.dart`:

```dart
import '../domain/work_date.dart';

const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const _monthsLong = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const _monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Every helper taking an INSTANT reads it as Manila wall time; the phone's
// zone is never used (PH is UTC+8 and a UTC date rolls most Time Ins back a day).

/// "7:45 AM".
String clockTime(DateTime instant) {
  final t = manilaFields(instant);
  final hour = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$hour:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}';
}

/// "Wednesday".
String weekdayName(DateTime instant) => _weekdays[manilaFields(instant).weekday - 1];

/// "19 August 2026".
String longDate(DateTime instant) {
  final t = manilaFields(instant);
  return '${t.day} ${_monthsLong[t.month - 1]} ${t.year}';
}

/// "19 Aug 2026".
String shortDate(DateTime instant) {
  final t = manilaFields(instant);
  return '${t.day} ${_monthsShort[t.month - 1]} ${t.year}';
}

/// "19 Aug".
String dayMonth(DateTime instant) {
  final t = manilaFields(instant);
  return '${t.day} ${_monthsShort[t.month - 1]}';
}

/// "Wednesday, 26 Aug" for a CALENDAR date (a UTC midnight, as History uses) —
/// read as it is, not shifted.
String dayHeading(DateTime calendarDate) =>
    '${_weekdays[calendarDate.weekday - 1]}, ${calendarDate.day} ${_monthsShort[calendarDate.month - 1]}';

/// "1 day worked" / "3 days worked".
String daysWorked(int n) => n == 1 ? '1 day worked' : '$n days worked';
```

`lib/attendance/ui/attendance_copy.dart`:

```dart
import '../domain/attendance_failure.dart';
import '../domain/work_date.dart';

/// Words in both languages: English first, then Tagalog.
class Bilingual {
  const Bilingual(this.english, this.tagalog);
  final String english;
  final String tagalog;
}

// Screen copy is English; FAILURE copy is bilingual — the moments something
// goes wrong are the ones where a worker most needs their own language. Every
// string below is DACS Attendance's own (res/values/strings.xml), so a worker
// switching apps reads the same words, except the ones marked NEW.

Bilingual failureCopy(AttendanceFailure f) => switch (f) {
      AttendanceFailure.alreadyTimedIn => const Bilingual('You already timed in today.', 'Naka-Time In ka na ngayong araw.'),
      AttendanceFailure.notTimedIn =>
        const Bilingual('You have not timed in today yet.', 'Hindi ka pa naka-Time In ngayong araw.'),
      AttendanceFailure.alreadyComplete =>
        const Bilingual('Today is already finished.', 'Tapos na ang record mo ngayong araw.'),
      AttendanceFailure.timeOutBeforeTimeIn => const Bilingual(
          'Your phone clock looks wrong. Tell the office.', 'Mali ang oras ng telepono mo. Sabihin sa opisina.'),
      AttendanceFailure.deviceClockWrong => const Bilingual(
          'Your phone clock is ahead. Fix the time, then try again.', 'Mauna ang oras ng telepono mo. Ayusin muna ang oras.'),
      AttendanceFailure.shiftTooLong => const Bilingual('This shift is too long to record. Tell the office.',
          'Masyadong mahaba ang shift na ito. Sabihin sa opisina.'),
      AttendanceFailure.projectUnavailable => const Bilingual(
          'That project is no longer available. Pick another.', 'Wala na ang project na iyon. Pumili ng iba.'),
      AttendanceFailure.noOwnerAssigned => const Bilingual('Your account is not linked to a company yet. Call the office.',
          'Hindi pa naka-link ang account mo. Tawagan ang opisina.'),
      AttendanceFailure.accountInactive => const Bilingual(
          'This account is turned off. Call the office.', 'Naka-off ang account na ito. Tawagan ang opisina.'),
      AttendanceFailure.notAWorker => const Bilingual('This is not a worker account.', 'Hindi ito worker account.'),
      AttendanceFailure.outsideRadius => const Bilingual(
          'You are too far from the project to record attendance. Move closer to the site and try again.',
          'Masyado kang malayo sa proyekto para makapagtala. Lumapit sa site at subukan ulit.'),
      AttendanceFailure.mockLocation => const Bilingual(
          'This phone is reporting a fake location. Turn off any mock location app, then try again.',
          'Nagre-report ang telepono na ito ng pekeng lokasyon. I-off ang anumang mock location app, tapos subukan ulit.'),
      AttendanceFailure.locationPermissionDenied => const Bilingual(
          'Attendance needs your location. Turn on Location permission for this app in Settings.',
          'Kailangan ng lokasyon mo para makapagtala. I-on ang Location permission para sa app na ito sa Settings.'),
      AttendanceFailure.locationDisabled => const Bilingual(
          'Turn on Location on your phone to record attendance. Swipe down and tap Location, then try again.',
          'I-on ang Location sa telepono mo para makapagtala. Mag-swipe pababa, i-tap ang Location, tapos subukan ulit.'),
      AttendanceFailure.projectGeofenceUnavailable => const Bilingual(
          'This project has no location set yet. Tell your admin — it cannot be fixed from the app.',
          'Wala pang nakatakdang lokasyon ang proyektong ito. Sabihan ang admin — hindi ito maaayos mula sa app.'),
      AttendanceFailure.appUpdateRequired => const Bilingual(
          'This app is out of date. Ask the office for the new version — your saved record will be sent after you update.',
          'Luma na ang app na ito. Humingi sa opisina ng bagong bersyon — maipapadala ang naka-save mong record pagkatapos mag-update.'),
      AttendanceFailure.sessionExpired => const Bilingual('Please log in again.', 'Mag-log in ulit.'),
      AttendanceFailure.noConnection =>
        const Bilingual('No signal right now. Try again in a moment.', 'Walang signal ngayon. Subukan ulit mamaya.'),
      AttendanceFailure.unexpected => const Bilingual('Something went wrong. Try again.', 'May nasira. Subukan ulit.'),
    };

/// Retrying helps only when the refusal was about the connection or the
/// moment, not the state of the day. A button that cannot work teaches the
/// worker the app is broken.
bool worthRetrying(AttendanceFailure f) => switch (f) {
      AttendanceFailure.noConnection ||
      AttendanceFailure.unexpected ||
      AttendanceFailure.deviceClockWrong ||
      // Walking a few metres into the open is exactly the fix for these two.
      AttendanceFailure.outsideRadius ||
      AttendanceFailure.projectGeofenceUnavailable ||
      // The phone-wide switch is two taps away; the retry then succeeds.
      AttendanceFailure.locationDisabled =>
        true,
      _ => false,
    };

/// The two refusals a worker can fix in Settings — on DIFFERENT screens.
enum SettingsRoute { appPermissions, locationSwitch }

SettingsRoute? settingsRouteFor(AttendanceFailure f) => switch (f) {
      AttendanceFailure.locationPermissionDenied => SettingsRoute.appPermissions,
      AttendanceFailure.locationDisabled => SettingsRoute.locationSwitch,
      _ => null,
    };

/// A refused queue row stores its failure's name; anything else (PHOTO_MISSING,
/// PROJECT_RETIRED, an older build's code) reads as "something went wrong".
AttendanceFailure failureFromStored(String? lastError) =>
    AttendanceFailure.values.asNameMap()[lastError] ?? AttendanceFailure.unexpected;

String _half(TimeDirection d) => d == TimeDirection.timeIn ? 'Time In' : 'Time Out';

/// Home, after the worker declined the camera. DACS Attendance's words for
/// Time In; the Time Out wording is NEW (the old app said "Time In" for both).
Bilingual flowCancelledByCamera(TimeDirection d) => Bilingual(
      '${_half(d)} was not recorded. The camera permission is off, and the photo is the proof of attendance.',
      'Hindi naitala ang ${_half(d)}. Naka-off ang camera permission, at ang litrato ang patunay ng pasok.',
    );

/// NEW: the line over a submission the server refused for good, so no worker
/// believes a refused day was recorded.
Bilingual refusedLead(TimeDirection d, String day) =>
    Bilingual('Your ${_half(d)} on $day was not accepted.', 'Hindi tinanggap ang ${_half(d)} mo noong $day.');

const retryLabel = 'TRY AGAIN';
const openSettingsLabel = 'Open Settings · Buksan ang Settings';
const notNowLabel = 'Not now · Sa ibang pagkakataon';
const dismissLabel = 'Dismiss · Isara';

/// The design's four. Tapping one is the point: this screen is used
/// one-handed, outdoors, often with gloves on.
const descriptionChipOptions = ['Block A', 'Masonry', 'Concrete pouring', 'Site clearing'];
```

`lib/attendance/ui/attendance_failure_notice.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/failure_notice.dart';
import '../domain/attendance_failure.dart';
import 'attendance_copy.dart';

/// Why a Time In or Time Out was refused, in both languages. TRY AGAIN only
/// where retrying can help; Open Settings only for the two settings a worker
/// can fix themselves; Dismiss when there is nothing left to do but read it.
class AttendanceFailureNotice extends StatelessWidget {
  const AttendanceFailureNotice({
    super.key,
    required this.failure,
    this.lead,
    this.onRetry,
    this.onOpenSettings,
    this.onDismiss,
  });

  final AttendanceFailure failure;
  final Bilingual? lead;
  final VoidCallback? onRetry;
  final void Function(SettingsRoute route)? onOpenSettings;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final copy = failureCopy(failure);
    final route = settingsRouteFor(failure);
    final retry = onRetry;
    final open = onOpenSettings;
    final dismiss = onDismiss;
    return FailureNotice(
      english: copy.english,
      tagalog: copy.tagalog,
      leadEnglish: lead?.english,
      leadTagalog: lead?.tagalog,
      actions: [
        if (route != null && open != null) noticeAction(openSettingsLabel, () => open(route)),
        if (retry != null && worthRetrying(failure)) noticeAction(retryLabel, retry),
        if (dismiss != null) noticeAction(dismissLabel, dismiss),
      ],
    );
  }
}
```

`lib/attendance/ui/status_pill.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/theme.dart';

/// "Saved", "Not sent yet", "Working", "9h 45m".
class StatusPill extends StatelessWidget {
  const StatusPill(this.text, {super.key, required this.background, required this.foreground});
  const StatusPill.green(this.text, {super.key})
      : background = WmColors.greenTint,
        foreground = WmColors.green;
  const StatusPill.brown(this.text, {super.key})
      : background = WmColors.brownTint,
        foreground = WmColors.brown;

  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(999)),
        child: Text(text, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: foreground)),
      );
}
```

`lib/ui/worker_header.dart`:

```dart
import 'package:flutter/material.dart';

import '../auth/worker_profile.dart';
import 'theme.dart';

/// Who is signed in: initials, name, position and worker ID.
class WorkerHeader extends StatelessWidget {
  const WorkerHeader({super.key, required this.worker});
  final WorkerProfile worker;

  @override
  Widget build(BuildContext context) => Row(children: [
        CircleAvatar(
          radius: 22,
          backgroundColor: WmColors.green,
          child: Text(worker.initials, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(worker.displayName ?? worker.firstName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
            Text(worker.positionAndId, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
          ]),
        ),
      ]);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test` → all pass (the existing login test still finds both failure lines). `flutter analyze` → `No issues found!`.

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 3: The flow's controller

**Files:**
- Create: `lib/attendance/flow/time_flow_controller.dart`, `test/attendance/fakes.dart`
- Test: `test/attendance/flow/time_flow_controller_test.dart`

**Interfaces:**
- Consumes: `AttendanceApi` (Task 1), `DeviceBridge`, `newEventId` (Task 1), `checkLocation`, `locationRefuses`, `failureForRefusal`, `toggleDescriptionChip`, `SubmissionRequest`, `AttendanceFailure.of` (0C-1).
- Produces: `enum FlowStep { pickProject, takePhoto, checkPhoto, describe, confirmed }`; `const minAccuracyMetres = 50.0`; `class CapturedPhoto { path, capturedAt, trustedAt, mirrored }`; `class TimeFlowController extends ChangeNotifier { TimeFlowController({required TimeDirection direction, required AttendanceApi attendance, required DeviceBridge device, required Future<DateTime?> Function() trustedNow, String Function()? newId}); direction; eventId; step; stepNumber; projects; loadingProjects; selectedKey; selectedProject; photo; description; submitting; failure; saved; Future<void> loadProjects(); void selectProject(String key); void confirmProject(); Future<void> photoTaken(String path, DateTime capturedAt, {required bool mirrored}); void retake(); void acceptPhoto(); void setDescription(String); void toggleChip(String); bool back(); Future<void> submit(); void abandon(); }`; test fakes `FakeAttendance`, `FakeDevice`, `FakeScheduler`, `refusedRow(...)`, `useTallPhone(tester)`, const `abc`.

- [ ] **Step 1: Write the shared fakes**

`test/attendance/fakes.dart`:

```dart
import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/data/attendance_api.dart';
import 'package:workmate/attendance/data/submission_request.dart';
import 'package:workmate/attendance/device/device_bridge.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/location_verification.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/sync/upload_scheduler.dart';

const abc = AttendanceProject(system: ProjectSystem.pc, id: 'p1', name: 'ABC Building Project');

/// An AttendanceApi whose every answer the test sets.
class FakeAttendance implements AttendanceApi {
  List<AttendanceProject> projects = [abc];
  Object? projectsError;
  int projectLoads = 0;

  final submitted = <SubmissionRequest>[];
  final mirrored = <bool>[];
  Object? submitError;
  Completer<void>? submitGate;
  int? savedMinutes;

  AttendanceRecord? todayRecord;
  Object? todayError;

  List<AttendanceRecord> historyRecords = [];
  Object? historyError;
  Completer<void>? historyGate;
  final historyCalls = <(String, String)>[];

  List<PendingSubmission> refused = [];
  final dismissed = <String>[];

  @override
  Future<List<AttendanceProject>> activeProjects() async {
    projectLoads++;
    if (projectsError != null) throw projectsError!;
    return projects;
  }

  @override
  Future<AttendanceRecord> submit(SubmissionRequest r, {bool mirrorPhoto = false}) async {
    submitted.add(r);
    mirrored.add(mirrorPhoto);
    final gate = submitGate;
    if (gate != null) await gate.future;
    if (submitError != null) throw submitError!;
    final workDate = WorkDate.of(r.capturedAt).iso;
    return r.direction == TimeDirection.timeIn
        ? AttendanceRecord(
            id: workDate,
            workDate: workDate,
            status: AttendanceStatus.working,
            timeInAt: r.capturedAt.toUtc(),
            timeInProjectName: abc.name,
            pending: true,
          )
        : AttendanceRecord(
            id: workDate,
            workDate: workDate,
            status: AttendanceStatus.complete,
            timeOutAt: r.capturedAt.toUtc(),
            timeOutProjectName: abc.name,
            totalMinutes: savedMinutes,
            pending: true,
          );
  }

  @override
  Future<AttendanceRecord?> today() async {
    if (todayError != null) throw todayError!;
    return todayRecord;
  }

  @override
  Future<List<AttendanceRecord>> history(String from, String to) async {
    historyCalls.add((from, to));
    final gate = historyGate;
    if (gate != null) await gate.future;
    if (historyError != null) throw historyError!;
    return historyRecords;
  }

  @override
  Future<List<PendingSubmission>> refusedSubmissions() async => refused;

  @override
  Future<void> dismissRefused(String eventId) async {
    dismissed.add(eventId);
    refused = refused.where((p) => p.eventId != eventId).toList();
  }
}

class FakeDevice implements DeviceBridge {
  DeviceFix fix = const DeviceFix(latitude: 14.5995, longitude: 120.9842, accuracyMetres: 8);
  int fixes = 0;
  int locationSettingsOpened = 0;

  @override
  Future<DeviceClockReading> clock() async => const DeviceClockReading(uptimeMillis: 0, bootCount: null);
  @override
  Future<bool> isOnline() async => true;
  @override
  Future<DeviceFix> currentFix() async {
    fixes++;
    return fix;
  }

  @override
  Future<String> preparePhoto({required String source, required String target, required String caption, bool mirror = false}) async =>
      target;

  @override
  Future<void> openLocationSettings() async {
    locationSettingsOpened++;
  }
}

class FakeScheduler implements UploadScheduler {
  int sendNows = 0;
  @override
  Future<void> enqueue(String eventId) async {}
  @override
  Future<void> sendNow() async {
    sendNows++;
  }

  @override
  Future<void> ensureSweeper() async {}
}

/// A row the server refused for good, as the queue stores it.
PendingSubmission refusedRow({
  String eventId = 'e9',
  TimeDirection direction = TimeDirection.timeIn,
  String capturedAt = '2026-08-18T23:45:00Z',
  String lastError = 'outsideRadius',
}) {
  final ms = DateTime.parse(capturedAt).millisecondsSinceEpoch;
  return PendingSubmission.fromMap({
    'event_id': eventId,
    'worker_id': 'u1',
    'direction': direction.wire,
    'project_system': 'pc',
    'project_id': 'p1',
    'project_name': abc.name,
    'captured_at': ms,
    'trusted_at': null,
    'photo_local_path': '/nope/$eventId.jpg',
    'description': null,
    'latitude': null,
    'longitude': null,
    'accuracy_metres': null,
    'was_offline': 0,
    'is_mock': 0,
    'permission_denied': 0,
    'location_status': null,
    'attempts': 1,
    'last_error': lastError,
    'failed_permanently': 1,
    'created_at': ms,
  });
}

/// A tall phone (400 x 1000 logical), so whole screens build in widget tests.
void useTallPhone(WidgetTester tester) {
  tester.view.physicalSize = const Size(1200, 3000);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
}
```

- [ ] **Step 2: Write the failing test**

`test/attendance/flow/time_flow_controller_test.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_failure.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/location_verification.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/flow/time_flow_controller.dart';

import '../fakes.dart';

void main() {
  late FakeAttendance attendance;
  late FakeDevice device;
  late DateTime? trusted;
  late int ids;
  final shutter = DateTime.parse('2026-08-18T23:45:00Z');

  TimeFlowController flow({TimeDirection d = TimeDirection.timeIn}) => TimeFlowController(
        direction: d,
        attendance: attendance,
        device: device,
        trustedNow: () async => trusted,
        newId: () => 'event-${++ids}',
      );

  Future<TimeFlowController> atDescribe({TimeDirection d = TimeDirection.timeIn, bool mirrored = false, String path = '/nope/raw.jpg'}) async {
    final c = flow(d: d);
    await c.loadProjects();
    c.selectProject(abc.key);
    c.confirmProject();
    await c.photoTaken(path, shutter, mirrored: mirrored);
    c.acceptPhoto();
    return c;
  }

  setUp(() {
    attendance = FakeAttendance();
    device = FakeDevice();
    trusted = DateTime.parse('2026-08-18T23:45:02Z');
    ids = 0;
  });

  test('the projects load, and a failed load says why instead of looking empty', () async {
    final c = flow();
    expect(c.loadingProjects, isTrue);
    await c.loadProjects();
    expect(c.projects, [abc]);
    expect(c.loadingProjects, isFalse);
    expect(c.failure, isNull);
    attendance.projectsError = const SocketException('down');
    await c.loadProjects();
    expect(c.failure, AttendanceFailure.noConnection);
    expect(c.loadingProjects, isFalse);
  });

  test('the camera opens only once a project is picked', () async {
    final c = flow();
    await c.loadProjects();
    c.confirmProject();
    expect(c.step, FlowStep.pickProject);
    c.selectProject(abc.key);
    c.confirmProject();
    expect(c.step, FlowStep.takePhoto);
    expect(c.stepNumber, 2);
  });

  test('the shutter time and the trusted time are frozen at the shutter', () async {
    final c = await atDescribe();
    expect(c.photo!.capturedAt, shutter);
    expect(c.photo!.trustedAt, DateTime.parse('2026-08-18T23:45:02Z'));
    expect(c.step, FlowStep.describe);
    expect(c.stepNumber, 4);
  });

  test('retake throws the rejected photo away', () async {
    final tmp = await Directory.systemTemp.createTemp('wmflow');
    addTearDown(() => tmp.delete(recursive: true));
    final raw = File('${tmp.path}/raw.jpg')..writeAsBytesSync([1]);
    final c = flow();
    await c.loadProjects();
    c.selectProject(abc.key);
    c.confirmProject();
    await c.photoTaken(raw.path, shutter, mirrored: false);
    c.retake();
    expect(c.step, FlowStep.takePhoto);
    expect(c.photo, isNull);
    expect(raw.existsSync(), isFalse);
  });

  test('back walks one step at a time and says so on the first step', () async {
    final c = await atDescribe();
    expect(c.back(), isTrue);
    expect(c.step, FlowStep.checkPhoto);
    expect(c.back(), isTrue);
    expect(c.step, FlowStep.takePhoto);
    expect(c.photo, isNull);
    expect(c.back(), isTrue);
    expect(c.step, FlowStep.pickProject);
    expect(c.back(), isFalse);
  });

  test('SUBMIT sends the frozen shutter, the fix, the note and the mirror flag', () async {
    final c = await atDescribe(mirrored: true);
    c.setDescription('  Block A  ');
    await c.submit();
    expect(c.step, FlowStep.confirmed);
    expect(c.saved!.status, AttendanceStatus.working);
    final r = attendance.submitted.single;
    expect(r.capturedAt, shutter);
    expect(r.trustedAt, DateTime.parse('2026-08-18T23:45:02Z'));
    expect(r.photoPath, '/nope/raw.jpg');
    expect(r.description, 'Block A');
    expect(r.projectSystem, ProjectSystem.pc);
    expect(r.projectId, 'p1');
    expect(r.latitude, 14.5995);
    expect(r.accuracyMetres, 8);
    expect(r.eventId, 'event-1');
    expect(r.locationStatus, 'project_geofence_unavailable');
    expect(attendance.mirrored.single, isTrue);
  });

  test('an empty note is sent as no note', () async {
    final c = await atDescribe();
    c.setDescription('   ');
    await c.submit();
    expect(attendance.submitted.single.description, isNull);
  });

  test('a retry reuses the same event id and keeps the photo', () async {
    final c = await atDescribe();
    attendance.submitError = const SocketException('down');
    await c.submit();
    expect(c.failure, AttendanceFailure.noConnection);
    expect(c.step, FlowStep.describe);
    expect(c.photo, isNotNull);
    attendance.submitError = null;
    await c.submit();
    expect(attendance.submitted.map((r) => r.eventId).toSet(), {'event-1'});
    expect(c.step, FlowStep.confirmed);
  });

  test('a fake location is refused on the phone and never sent', () async {
    device.fix = const DeviceFix(latitude: 14.5995, longitude: 120.9842, accuracyMetres: 8, isMock: true);
    final c = await atDescribe();
    await c.submit();
    expect(c.failure, AttendanceFailure.mockLocation);
    expect(attendance.submitted, isEmpty);
    expect(c.submitting, isFalse);
  });

  test('outside the cached fence is refused on the phone', () async {
    attendance.projects = [abc.withGeofence(const Geofence(latitude: 14.5995, longitude: 120.9842, radiusMetres: 150))];
    device.fix = const DeviceFix(latitude: 14.6095, longitude: 120.9842, accuracyMetres: 8);
    final c = await atDescribe();
    await c.submit();
    expect(c.failure, AttendanceFailure.outsideRadius);
    expect(attendance.submitted, isEmpty);
  });

  test('Location switched off is refused with its own reason', () async {
    device.fix = const DeviceFix(locationDisabled: true);
    final c = await atDescribe();
    await c.submit();
    expect(c.failure, AttendanceFailure.locationDisabled);
  });

  test('a vague fix is recorded and flagged, not refused', () async {
    device.fix = const DeviceFix(latitude: 14.5995, longitude: 120.9842, accuracyMetres: 300);
    final c = await atDescribe();
    await c.submit();
    expect(attendance.submitted.single.locationStatus, 'low_accuracy');
    expect(c.step, FlowStep.confirmed);
  });

  test('a second tap while sending does nothing', () async {
    final c = await atDescribe();
    attendance.submitGate = Completer();
    final first = c.submit();
    final second = c.submit();
    expect(c.submitting, isTrue);
    attendance.submitGate!.complete();
    await Future.wait([first, second]);
    expect(attendance.submitted.length, 1);
  });

  test('chips add to the note without losing typing', () async {
    final c = await atDescribe();
    c.setDescription('Gate 2');
    c.toggleChip('Masonry');
    expect(c.description, 'Gate 2, Masonry');
    c.toggleChip('Masonry');
    expect(c.description, 'Gate 2');
  });

  test('leaving the flow deletes a photo that was never submitted', () async {
    final tmp = await Directory.systemTemp.createTemp('wmflow');
    addTearDown(() => tmp.delete(recursive: true));
    final raw = File('${tmp.path}/raw.jpg')..writeAsBytesSync([1]);
    final c = await atDescribe(path: raw.path);
    c.abandon();
    expect(raw.existsSync(), isFalse);
  });

  test('leaving after a submit never deletes the filed photo', () async {
    final tmp = await Directory.systemTemp.createTemp('wmflow');
    addTearDown(() => tmp.delete(recursive: true));
    final raw = File('${tmp.path}/raw.jpg')..writeAsBytesSync([1]);
    final c = await atDescribe(path: raw.path);
    await c.submit();
    c.abandon();
    expect(raw.existsSync(), isTrue);
  });

  test('one event id per flow', () {
    final a = flow();
    final b = flow();
    expect(a.eventId, 'event-1');
    expect(b.eventId, 'event-2');
  });
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `flutter test test/attendance/flow/time_flow_controller_test.dart`
Expected: FAIL — `time_flow_controller.dart` does not exist.

- [ ] **Step 4: Implement**

`lib/attendance/flow/time_flow_controller.dart`:

```dart
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../data/attendance_api.dart';
import '../data/submission_request.dart';
import '../device/device_bridge.dart';
import '../domain/attendance_failure.dart';
import '../domain/attendance_record.dart';
import '../domain/description_chips.dart';
import '../domain/event_id.dart';
import '../domain/location_verification.dart';
import '../domain/work_date.dart';

/// The four steps of the design, plus the confirmation that ends them.
enum FlowStep { pickProject, takePhoto, checkPhoto, describe, confirmed }

/// The documented default (§36 / migration 0068). It only changes which label
/// a flagged record carries: low accuracy is recorded, never refused.
const minAccuracyMetres = 50.0;

/// A photo on disk and its shutter moment — by the phone's clock and by the
/// clock the worker cannot change (0078; null when it cannot vouch).
class CapturedPhoto {
  const CapturedPhoto({required this.path, required this.capturedAt, required this.trustedAt, required this.mirrored});
  final String path;
  final DateTime capturedAt;
  final DateTime? trustedAt;

  /// Front camera: shown and filed mirrored, as previewed.
  final bool mirrored;
}

/// ONE flow for both directions (Time Out is "the same five, in brown").
/// Ported from DACS Attendance's TimeFlowViewModel.
class TimeFlowController extends ChangeNotifier {
  TimeFlowController({
    required this.direction,
    required AttendanceApi attendance,
    required DeviceBridge device,
    required Future<DateTime?> Function() trustedNow,
    String Function()? newId,
  })  : _attendance = attendance,
        _device = device,
        _trustedNow = trustedNow,
        eventId = (newId ?? newEventId)();

  final TimeDirection direction;

  /// The idempotency key for THIS submission, minted once and reused for
  /// every retry: a fresh id per attempt would turn one retried Time In into two.
  final String eventId;

  final AttendanceApi _attendance;
  final DeviceBridge _device;
  final Future<DateTime?> Function() _trustedNow;

  FlowStep _step = FlowStep.pickProject;
  List<AttendanceProject> _projects = const [];
  bool _loadingProjects = true;
  String? _selectedKey;
  CapturedPhoto? _photo;
  String _description = '';
  bool _submitting = false;
  AttendanceFailure? _failure;
  AttendanceRecord? _saved;
  bool _disposed = false;

  FlowStep get step => _step;
  List<AttendanceProject> get projects => _projects;
  bool get loadingProjects => _loadingProjects;
  String? get selectedKey => _selectedKey;
  CapturedPhoto? get photo => _photo;
  String get description => _description;
  bool get submitting => _submitting;
  AttendanceFailure? get failure => _failure;
  AttendanceRecord? get saved => _saved;

  /// Matched on "system:id": since 0059 an id alone is ambiguous.
  AttendanceProject? get selectedProject => _projects.where((p) => p.key == _selectedKey).firstOrNull;

  /// "Step N of 4". Confirmation is not a step.
  int get stepNumber => switch (_step) {
        FlowStep.pickProject => 1,
        FlowStep.takePhoto => 2,
        FlowStep.checkPhoto => 3,
        FlowStep.describe || FlowStep.confirmed => 4,
      };

  Future<void> loadProjects() async {
    _loadingProjects = true;
    _failure = null;
    _notify();
    try {
      _projects = await _attendance.activeProjects();
    } catch (e) {
      // An empty picker and a failed fetch look identical, and only one is fixed by waiting.
      _failure = AttendanceFailure.of(e);
    }
    _loadingProjects = false;
    _notify();
  }

  void selectProject(String key) {
    _selectedKey = key;
    _failure = null;
    _notify();
  }

  void confirmProject() {
    if (selectedProject == null) return;
    _step = FlowStep.takePhoto;
    _notify();
  }

  /// The capture, frozen at the shutter: its time, and the trusted time now.
  Future<void> photoTaken(String path, DateTime capturedAt, {required bool mirrored}) async {
    DateTime? trusted;
    try {
      trusted = await _trustedNow();
    } catch (_) {
      // "Cannot vouch" is null, never a guess.
    }
    _photo = CapturedPhoto(path: path, capturedAt: capturedAt, trustedAt: trusted, mirrored: mirrored);
    _step = FlowStep.checkPhoto;
    _failure = null;
    _notify();
  }

  void retake() {
    _discardPhoto();
    _step = FlowStep.takePhoto;
    _notify();
  }

  void acceptPhoto() {
    if (_photo == null) return;
    _step = FlowStep.describe;
    _notify();
  }

  void setDescription(String value) {
    _description = value;
    _notify();
  }

  void toggleChip(String chip) {
    _description = toggleDescriptionChip(_description, chip);
    _notify();
  }

  /// One step back. False on the first step (and after confirming): the
  /// caller leaves the flow.
  bool back() {
    switch (_step) {
      case FlowStep.pickProject:
      case FlowStep.confirmed:
        return false;
      case FlowStep.takePhoto:
        _step = FlowStep.pickProject;
      case FlowStep.checkPhoto:
        _discardPhoto();
        _step = FlowStep.takePhoto;
      case FlowStep.describe:
        _step = FlowStep.checkPhoto;
    }
    _failure = null;
    _notify();
    return true;
  }

  Future<void> submit() async {
    // Guards the commonest duplicate: a slow phone and a second tap.
    if (_submitting) return;
    final project = selectedProject;
    final photo = _photo;
    if (project == null || photo == null) return;
    _submitting = true;
    _failure = null;
    _notify();

    // The location is read NOW, a few seconds after the shutter, standing in
    // the same place — the shutter itself never waits on GPS.
    final fix = await _device.currentFix();
    // The same rule the server applies (0069), with the fence the phone cached,
    // so an OFFLINE worker is told at the gate instead of days later.
    final check = checkLocation(fix, project.geofence, minAccuracyMetres: minAccuracyMetres);
    // requireGeofence stays FALSE on the device: whether a fence is mandatory
    // is the server's ruling, against config the phone does not hold.
    if (locationRefuses(check.status, requireGeofence: false)) {
      _failure = failureForRefusal(check.status) ?? AttendanceFailure.unexpected;
      _submitting = false;
      _notify();
      return;
    }

    try {
      final note = _description.trim();
      _saved = await _attendance.submit(
        SubmissionRequest(
          direction: direction,
          projectSystem: project.system,
          projectId: project.id,
          capturedAt: photo.capturedAt,
          trustedAt: photo.trustedAt,
          photoPath: photo.path,
          description: note.isEmpty ? null : note,
          eventId: eventId,
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyMetres: fix.accuracyMetres,
          isMock: fix.isMock,
          permissionDenied: fix.permissionDenied,
          locationStatus: check.status.wire,
        ),
        mirrorPhoto: photo.mirrored,
      );
      _step = FlowStep.confirmed;
    } catch (e) {
      // Stay on Describe with the photo intact: the photo is the evidence of when they arrived.
      _failure = AttendanceFailure.of(e);
    }
    _submitting = false;
    _notify();
  }

  /// The worker left the flow: a photo that was never submitted is deleted.
  void abandon() {
    if (_step != FlowStep.confirmed) _discardPhoto();
  }

  void _discardPhoto() {
    final p = _photo;
    _photo = null;
    if (p == null) return;
    try {
      File(p.path).deleteSync();
    } catch (_) {
      // Already gone.
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `flutter test test/attendance/flow/time_flow_controller_test.dart` → PASS. Then `flutter test` and `flutter analyze` → clean.

- [ ] **Step 6: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 4: The flow's screens (camera injected)

**Files:**
- Create: `lib/attendance/flow/time_flow_screen.dart`
- Test: `test/attendance/flow/time_flow_screen_test.dart`

**Interfaces:**
- Consumes: `TimeFlowController`, `FlowStep`, `CapturedPhoto` (Task 3); `AttendanceFailureNotice`, `SettingsRoute`, `descriptionChipOptions`, `openSettingsLabel`, formats (Task 2); `isChipSelected`, `formatMinutes` (0C-1); `WmColors`, `monoLabel`.
- Produces: `enum FlowExit { cameraPermission }`; `class CameraStepArgs { const CameraStepArgs({required String projectName, required void Function(String path, DateTime capturedAt, bool mirrored) onTaken, required VoidCallback onGiveUp}); }`; `typedef CameraStepBuilder = Widget Function(BuildContext context, CameraStepArgs args)`; `Color accentFor(TimeDirection)`; `class TimeFlowScreen extends StatefulWidget { const TimeFlowScreen({required TimeFlowController controller, required CameraStepBuilder cameraStep, required VoidCallback onFinished, required void Function(FlowExit? reason) onCancelled, required void Function(SettingsRoute route) openSettings}); }`; `class FlowHeader`; `class CapturedPhotoView`.

- [ ] **Step 1: Write the failing test**

`test/attendance/flow/time_flow_screen_test.dart`:

```dart
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/location_verification.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/flow/time_flow_controller.dart';
import 'package:workmate/attendance/flow/time_flow_screen.dart';
import 'package:workmate/attendance/ui/attendance_copy.dart';
import 'package:workmate/ui/theme.dart';

import '../fakes.dart';

void main() {
  late FakeAttendance attendance;
  late FakeDevice device;
  late int finished;
  late int cancelled;
  late FlowExit? cancelledWith;
  late List<SettingsRoute> routes;

  Widget fakeCamera(BuildContext context, CameraStepArgs a) => Column(children: [
        Text('camera for ${a.projectName}', style: const TextStyle(color: Colors.white)),
        ElevatedButton(
          onPressed: () => a.onTaken('/nope/raw.jpg', DateTime.parse('2026-08-18T23:45:00Z'), false),
          child: const Text('FAKE SHUTTER'),
        ),
        TextButton(onPressed: a.onGiveUp, child: const Text('GIVE UP')),
      ]);

  Future<TimeFlowController> open(WidgetTester tester, {TimeDirection d = TimeDirection.timeIn}) async {
    useTallPhone(tester);
    final c = TimeFlowController(direction: d, attendance: attendance, device: device, trustedNow: () async => null, newId: () => 'e1');
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: TimeFlowScreen(
        controller: c,
        cameraStep: fakeCamera,
        onFinished: () => finished++,
        onCancelled: (r) {
          cancelled++;
          cancelledWith = r;
        },
        openSettings: routes.add,
      ),
    ));
    await c.loadProjects();
    await tester.pumpAndSettle();
    return c;
  }

  Future<void> toDescribe(WidgetTester tester) async {
    await tester.tap(find.text(abc.name));
    await tester.pump();
    await tester.tap(find.text('NEXT · TAKE PHOTO'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('FAKE SHUTTER'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('YES, USE THIS PHOTO'));
    await tester.pumpAndSettle();
  }

  Future<void> submit(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
  }

  setUp(() {
    attendance = FakeAttendance();
    device = FakeDevice();
    finished = 0;
    cancelled = 0;
    cancelledWith = null;
    routes = [];
  });

  testWidgets('a whole Time In, tap by tap', (tester) async {
    await open(tester);
    expect(find.text('Which project today?'), findsOneWidget);
    expect(find.text('TIME IN'), findsOneWidget);
    expect(find.text('Step 1 of 4'), findsOneWidget);

    await tester.tap(find.text('NEXT · TAKE PHOTO'));
    await tester.pump();
    expect(find.text('Which project today?'), findsOneWidget, reason: 'no project picked yet');

    await tester.tap(find.text(abc.name));
    await tester.pump();
    await tester.tap(find.text('NEXT · TAKE PHOTO'));
    await tester.pumpAndSettle();
    expect(find.text('Take your photo'), findsOneWidget);
    expect(find.text('camera for ${abc.name}'), findsOneWidget);

    await tester.tap(find.text('FAKE SHUTTER'));
    await tester.pumpAndSettle();
    expect(find.text('Is this photo clear?'), findsOneWidget);

    await tester.tap(find.text('YES, USE THIS PHOTO'));
    await tester.pumpAndSettle();
    expect(find.text('What are you working on?'), findsOneWidget);

    await tester.tap(find.text('Masonry'));
    await tester.pump();
    expect(find.widgetWithText(TextField, 'Masonry'), findsOneWidget);

    await submit(tester);
    expect(find.text('All done!'), findsOneWidget);
    expect(find.text('Your Time In has been recorded'), findsOneWidget);
    expect(find.text('7:45 AM'), findsOneWidget);
    expect(find.text('19 Aug 2026'), findsOneWidget);
    expect(find.text('Saved on your phone'), findsOneWidget);
    expect(find.text('When you head home, time out and pick your project again.'), findsOneWidget);
    expect(attendance.submitted.single.description, 'Masonry');

    await tester.tap(find.text('BACK TO HOME'));
    await tester.pump();
    expect(finished, 1);
  });

  testWidgets('Time Out says so on every screen', (tester) async {
    attendance.savedMinutes = 585;
    await open(tester, d: TimeDirection.timeOut);
    expect(find.text('TIME OUT'), findsOneWidget);
    await toDescribe(tester);
    expect(find.text('SUBMIT TIME OUT'), findsOneWidget);
    await submit(tester);
    expect(find.text('Day complete!'), findsOneWidget);
    expect(find.text('Your Time Out has been recorded'), findsOneWidget);
    expect(find.text('Total hours'), findsOneWidget);
    expect(find.text('9h 45m'), findsOneWidget);
    expect(find.text('Thank you. See you tomorrow.'), findsOneWidget);
  });

  testWidgets('a refusal is shown in both languages and the photo is kept', (tester) async {
    device.fix = const DeviceFix(latitude: 14.5995, longitude: 120.9842, accuracyMetres: 8, isMock: true);
    await open(tester);
    await toDescribe(tester);
    await submit(tester);
    expect(find.text('This phone is reporting a fake location. Turn off any mock location app, then try again.'), findsOneWidget);
    expect(find.text('Nagre-report ang telepono na ito ng pekeng lokasyon. I-off ang anumang mock location app, tapos subukan ulit.'),
        findsOneWidget);
    expect(find.text(retryLabel), findsNothing);
    expect(find.text('What are you working on?'), findsOneWidget);
    expect(attendance.submitted, isEmpty);
  });

  testWidgets('Location switched off sends the worker to the Location switch, then TRY AGAIN works', (tester) async {
    device.fix = const DeviceFix(locationDisabled: true);
    await open(tester);
    await toDescribe(tester);
    await submit(tester);
    await tester.ensureVisible(find.text(openSettingsLabel));
    await tester.tap(find.text(openSettingsLabel));
    await tester.pump();
    expect(routes, [SettingsRoute.locationSwitch]);

    device.fix = const DeviceFix(latitude: 14.5995, longitude: 120.9842, accuracyMetres: 8);
    await tester.ensureVisible(find.text(retryLabel));
    await tester.tap(find.text(retryLabel));
    await tester.pumpAndSettle();
    expect(find.text('All done!'), findsOneWidget);
  });

  testWidgets('back from the first step leaves the flow with nothing to explain', (tester) async {
    await open(tester);
    await tester.tap(find.byKey(const Key('flow-back')));
    await tester.pump();
    expect(cancelled, 1);
    expect(cancelledWith, isNull);
  });

  testWidgets('back from a later step goes one step back', (tester) async {
    await open(tester);
    await toDescribe(tester);
    await tester.tap(find.byKey(const Key('flow-back')));
    await tester.pumpAndSettle();
    expect(find.text('Is this photo clear?'), findsOneWidget);
    expect(cancelled, 0);
  });

  testWidgets('giving up on the camera leaves with the reason', (tester) async {
    await open(tester);
    await tester.tap(find.text(abc.name));
    await tester.pump();
    await tester.tap(find.text('NEXT · TAKE PHOTO'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('GIVE UP'));
    await tester.pump();
    expect(cancelledWith, FlowExit.cameraPermission);
  });

  testWidgets('a failed project list says why and can be retried', (tester) async {
    attendance.projectsError = const SocketException('down');
    await open(tester);
    expect(find.text('No signal right now. Try again in a moment.'), findsOneWidget);
    attendance.projectsError = null;
    await tester.tap(find.text(retryLabel));
    await tester.pumpAndSettle();
    expect(find.text(abc.name), findsOneWidget);
  });

  testWidgets('no projects at all tells the worker who to call', (tester) async {
    attendance.projects = [];
    await open(tester);
    expect(find.text('No projects are listed. Call the office.'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `flutter test test/attendance/flow/time_flow_screen_test.dart`
Expected: FAIL — `time_flow_screen.dart` does not exist.

- [ ] **Step 3: Implement**

`lib/attendance/flow/time_flow_screen.dart`:

```dart
import 'dart:io';

import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../domain/attendance_record.dart';
import '../domain/description_chips.dart';
import '../domain/total_hours.dart';
import '../domain/work_date.dart';
import '../ui/attendance_copy.dart';
import '../ui/attendance_failure_notice.dart';
import '../ui/formats.dart';
import 'time_flow_controller.dart';

/// Why a flow ended without a record, worth telling Home about.
enum FlowExit { cameraPermission }

/// What the camera step is given. The real one is CameraStep; tests use a fake.
class CameraStepArgs {
  const CameraStepArgs({required this.projectName, required this.onTaken, required this.onGiveUp});

  /// Shown in the preview caption, exactly as it will be burned in.
  final String projectName;

  /// The capture, its shutter time, and whether it came from the front camera.
  final void Function(String path, DateTime capturedAt, bool mirrored) onTaken;

  /// The worker declined the camera: leave the flow (Home says why).
  final VoidCallback onGiveUp;
}

typedef CameraStepBuilder = Widget Function(BuildContext context, CameraStepArgs args);

/// Time In is green, Time Out brown: the same screens in two colours.
Color accentFor(TimeDirection d) => d == TimeDirection.timeIn ? WmColors.green : WmColors.brown;

Color _accentTint(TimeDirection d) => d == TimeDirection.timeIn ? WmColors.greenTint : WmColors.brownTint;

/// The headings are QUESTIONS, as the design writes them.
const _titles = {
  FlowStep.pickProject: ('Which project today?', 'Pick the site you are working on.'),
  FlowStep.takePhoto: ('Take your photo', 'Face the camera'),
  FlowStep.checkPhoto: ('Is this photo clear?', 'Check it before you submit'),
  FlowStep.describe: ('What are you working on?', 'Optional — you can skip this'),
};

/// The four-step Time In / Time Out flow and its confirmation. Modal: no tabs
/// while recording — a worker halfway through has one way forward and one back.
class TimeFlowScreen extends StatefulWidget {
  const TimeFlowScreen({
    super.key,
    required this.controller,
    required this.cameraStep,
    required this.onFinished,
    required this.onCancelled,
    required this.openSettings,
  });

  final TimeFlowController controller;
  final CameraStepBuilder cameraStep;
  final VoidCallback onFinished;
  final void Function(FlowExit? reason) onCancelled;
  final void Function(SettingsRoute route) openSettings;

  @override
  State<TimeFlowScreen> createState() => _TimeFlowScreenState();
}

class _TimeFlowScreenState extends State<TimeFlowScreen> {
  late final TextEditingController _note = TextEditingController(text: widget.controller.description);

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _back() {
    final c = widget.controller;
    if (c.step == FlowStep.confirmed) {
      widget.onFinished();
    } else if (!c.back()) {
      widget.onCancelled(null);
    }
  }

  void _toggleChip(String chip) {
    widget.controller.toggleChip(chip);
    _note.text = widget.controller.description;
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _back();
        },
        child: ListenableBuilder(
          listenable: widget.controller,
          builder: (context, _) {
            final c = widget.controller;
            if (c.step == FlowStep.confirmed) return _Confirmation(controller: c, onDone: widget.onFinished);
            final dark = c.step == FlowStep.takePhoto;
            final (title, subtitle) = _titles[c.step]!;
            return Scaffold(
              backgroundColor: dark ? WmColors.previewBackdrop : Colors.white,
              body: SafeArea(
                child: Column(children: [
                  FlowHeader(
                    direction: c.direction,
                    step: c.stepNumber,
                    title: title,
                    subtitle: subtitle,
                    dark: dark,
                    onBack: _back,
                  ),
                  Expanded(
                    child: switch (c.step) {
                      FlowStep.pickProject => _ProjectStep(controller: c),
                      FlowStep.takePhoto => widget.cameraStep(
                          context,
                          CameraStepArgs(
                            projectName: c.selectedProject?.name ?? '',
                            onTaken: (path, at, mirrored) => c.photoTaken(path, at, mirrored: mirrored),
                            onGiveUp: () => widget.onCancelled(FlowExit.cameraPermission),
                          ),
                        ),
                      FlowStep.checkPhoto => _CheckStep(controller: c),
                      FlowStep.describe =>
                        _DescribeStep(controller: c, note: _note, onToggleChip: _toggleChip, openSettings: widget.openSettings),
                      FlowStep.confirmed => const SizedBox.shrink(),
                    },
                  ),
                ]),
              ),
            );
          },
        ),
      );
}

/// Back, the TIME IN / TIME OUT pill, "Step N of 4", the bar, and the question.
class FlowHeader extends StatelessWidget {
  const FlowHeader({
    super.key,
    required this.direction,
    required this.step,
    required this.title,
    required this.subtitle,
    required this.onBack,
    this.dark = false,
  });

  final TimeDirection direction;
  final int step;
  final String title;
  final String subtitle;
  final VoidCallback onBack;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final accent = accentFor(direction);
    final fg = dark ? Colors.white : WmColors.text;
    final muted = dark ? Colors.white60 : WmColors.textMuted;
    final timeIn = direction == TimeDirection.timeIn;
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 20, 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          IconButton(key: const Key('flow-back'), tooltip: 'Back', onPressed: onBack, icon: Icon(Icons.arrow_back, color: fg)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: dark ? Colors.white12 : _accentTint(direction),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(timeIn ? Icons.south_west : Icons.north_east, size: 14, color: dark ? Colors.white : accent),
              const SizedBox(width: 5),
              Text(timeIn ? 'TIME IN' : 'TIME OUT', style: monoLabel.copyWith(color: dark ? Colors.white : accent)),
            ]),
          ),
          const Spacer(),
          Text('Step $step of 4', style: monoLabel.copyWith(color: muted, letterSpacing: 0.4)),
        ]),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 0, 0),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: step / 4,
                minHeight: 5,
                color: dark ? Colors.white : accent,
                backgroundColor: dark ? Colors.white24 : WmColors.hairline,
              ),
            ),
            const SizedBox(height: 14),
            Text(title, style: TextStyle(fontSize: 23, fontWeight: FontWeight.w800, color: fg)),
            const SizedBox(height: 2),
            Text(subtitle, style: TextStyle(fontSize: 14, color: muted)),
          ]),
        ),
      ]),
    );
  }
}

class _ProjectStep extends StatelessWidget {
  const _ProjectStep({required this.controller});
  final TimeFlowController controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final failure = c.failure;
    return Column(children: [
      Expanded(
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 20), children: [
          if (c.loadingProjects)
            const Padding(padding: EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator()))
          else if (failure != null)
            AttendanceFailureNotice(failure: failure, onRetry: c.loadProjects)
          else if (c.projects.isEmpty)
            const Text('No projects are listed. Call the office.',
                style: TextStyle(fontSize: 15, color: WmColors.textSecondary))
          else
            for (final p in c.projects) ...[
              _ProjectTile(
                project: p,
                selected: p.key == c.selectedKey,
                direction: c.direction,
                onTap: () => c.selectProject(p.key),
              ),
              const SizedBox(height: 10),
            ],
          const SizedBox(height: 6),
          const Text('If your project is missing, tell the admin.',
              style: TextStyle(fontSize: 13, color: WmColors.textMeta)),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: FilledButton(
          style: FilledButton.styleFrom(backgroundColor: accentFor(c.direction)),
          onPressed: c.selectedProject == null ? null : c.confirmProject,
          child: const Text('NEXT · TAKE PHOTO'),
        ),
      ),
    ]);
  }
}

class _ProjectTile extends StatelessWidget {
  const _ProjectTile({required this.project, required this.selected, required this.direction, required this.onTap});
  final AttendanceProject project;
  final bool selected;
  final TimeDirection direction;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = accentFor(direction);
    return Material(
      color: selected ? _accentTint(direction) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: selected ? accent : WmColors.border, width: selected ? 1.5 : 1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(color: selected ? accent : WmColors.canvas, borderRadius: BorderRadius.circular(12)),
              child: Icon(Icons.apartment, color: selected ? Colors.white : WmColors.textMuted),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(project.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: WmColors.text)),
                const Text('Active', style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
              ]),
            ),
            Icon(selected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                color: selected ? accent : WmColors.textFaint),
          ]),
        ),
      ),
    );
  }
}

/// A capture as the worker saw it in the preview: front-camera shots mirrored.
class CapturedPhotoView extends StatelessWidget {
  const CapturedPhotoView({super.key, required this.photo});
  final CapturedPhoto photo;

  @override
  Widget build(BuildContext context) => Transform.flip(
        flipX: photo.mirrored,
        child: Image.file(
          File(photo.path),
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => const ColoredBox(color: WmColors.inert),
        ),
      );
}

class _CheckStep extends StatelessWidget {
  const _CheckStep({required this.controller});
  final TimeFlowController controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    return Column(children: [
      Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: SizedBox.expand(child: CapturedPhotoView(photo: c.photo!)),
          ),
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        child: Column(children: [
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: accentFor(c.direction)),
            onPressed: c.acceptPhoto,
            child: const Text('YES, USE THIS PHOTO'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: c.retake,
            child: const Text('Retake photo', style: TextStyle(fontWeight: FontWeight.w700, color: WmColors.textSecondary)),
          ),
        ]),
      ),
    ]);
  }
}

class _DescribeStep extends StatelessWidget {
  const _DescribeStep({required this.controller, required this.note, required this.onToggleChip, required this.openSettings});
  final TimeFlowController controller;
  final TextEditingController note;
  final void Function(String chip) onToggleChip;
  final void Function(SettingsRoute route) openSettings;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final failure = c.failure;
    return Column(children: [
      Expanded(
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 20), children: [
          Row(children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(width: 56, height: 56, child: CapturedPhotoView(photo: c.photo!)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Photo taken', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                Text(c.selectedProject?.name ?? '', style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
              ]),
            ),
          ]),
          const SizedBox(height: 20),
          const Text('TAP ONE', style: monoLabel),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final chip in descriptionChipOptions)
              _NoteChip(
                label: chip,
                selected: isChipSelected(c.description, chip),
                direction: c.direction,
                onTap: () => onToggleChip(chip),
              ),
          ]),
          const SizedBox(height: 20),
          const Text('Or type your own', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
          const SizedBox(height: 8),
          TextField(
            key: const Key('note'),
            controller: note,
            onChanged: c.setDescription,
            minLines: 1,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(hintText: 'e.g. Gate 2, delivery came'),
          ),
          if (failure != null) ...[
            const SizedBox(height: 16),
            AttendanceFailureNotice(failure: failure, onRetry: c.submit, onOpenSettings: openSettings),
          ],
        ]),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: FilledButton(
          key: const Key('submit'),
          style: FilledButton.styleFrom(backgroundColor: accentFor(c.direction)),
          onPressed: c.submitting ? null : c.submit,
          child: c.submitting
              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
              : Text(c.direction == TimeDirection.timeIn ? 'SUBMIT TIME IN' : 'SUBMIT TIME OUT'),
        ),
      ),
    ]);
  }
}

class _NoteChip extends StatelessWidget {
  const _NoteChip({required this.label, required this.selected, required this.direction, required this.onTap});
  final String label;
  final bool selected;
  final TimeDirection direction;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = accentFor(direction);
    return Material(
      color: selected ? _accentTint(direction) : Colors.white,
      shape: StadiumBorder(side: BorderSide(color: selected ? accent : WmColors.border)),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
          child: Text(label,
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5, color: selected ? accent : WmColors.textSecondary)),
        ),
      ),
    );
  }
}

/// The confirmation. A worker walks away from this screen and cannot check it
/// again until the record reaches the server, so it repeats every fact just
/// filed under their name.
class _Confirmation extends StatelessWidget {
  const _Confirmation({required this.controller, required this.onDone});
  final TimeFlowController controller;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final accent = accentFor(c.direction);
    final timeIn = c.direction == TimeDirection.timeIn;
    final photo = c.photo!;
    final saved = c.saved!;
    final note = c.description.trim();
    final rows = <(String, String, bool)>[
      (timeIn ? 'Time in' : 'Time out', clockTime(photo.capturedAt), true),
      ('Date', shortDate(photo.capturedAt), false),
      ('Project', c.selectedProject?.name ?? '—', false),
      ('Note', note.isEmpty ? '—' : note, false),
      if (!timeIn) ('Total hours', formatMinutes(saved.totalMinutes), true),
    ];
    return Scaffold(
      backgroundColor: accent,
      body: SafeArea(
        child: Column(children: [
          Expanded(
            child: ListView(padding: const EdgeInsets.fromLTRB(20, 32, 20, 20), children: [
              Center(
                child: Container(
                  width: 72,
                  height: 72,
                  decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                  child: Icon(Icons.check, size: 40, color: accent),
                ),
              ),
              const SizedBox(height: 18),
              Text(timeIn ? 'All done!' : 'Day complete!',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 4),
              Text(timeIn ? 'Your Time In has been recorded' : 'Your Time Out has been recorded',
                  textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: Colors.white70)),
              const SizedBox(height: 22),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
                child: Column(children: [
                  for (final (label, value, mono) in rows)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        SizedBox(width: 96, child: Text(label, style: const TextStyle(fontSize: 13.5, color: WmColors.textMuted))),
                        Expanded(
                          child: Text(
                            value,
                            textAlign: TextAlign.right,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: WmColors.text,
                              fontFamily: mono ? 'IBM Plex Mono' : null,
                            ),
                          ),
                        ),
                      ]),
                    ),
                  if (saved.pending) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(color: WmColors.greenTint, borderRadius: BorderRadius.circular(999)),
                      child: const Text('Saved on your phone',
                          style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: WmColors.green)),
                    ),
                  ],
                ]),
              ),
              const SizedBox(height: 18),
              Text(
                timeIn ? 'When you head home, time out and pick your project again.' : 'Thank you. See you tomorrow.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 14.5, color: Colors.white),
              ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: accent),
              onPressed: onDone,
              child: const Text('BACK TO HOME'),
            ),
          ),
        ]),
      ),
    );
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `flutter test test/attendance/flow/time_flow_screen_test.dart` → PASS (9 tests). Then `flutter test` and `flutter analyze` → clean.

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 5: The real camera step

**Files:**
- Create: `lib/attendance/flow/camera_step.dart`
- Modify: `pubspec.yaml` (packages), `android/app/src/main/AndroidManifest.xml` (CAMERA), `test/app_identity_test.dart`

**Interfaces:**
- Consumes: `CameraStepArgs` (Task 4); `photoOverlayCaptionLines` (0C-1); `failureCopy`, `openSettingsLabel`, `notNowLabel`, `retryLabel` (Task 2).
- Produces: `class CameraStep extends StatefulWidget { const CameraStep({super.key, required CameraStepArgs args}); }`.

This step talks to the camera plugin and the permission dialogs, which do not run under `flutter test`. It is verified by `flutter analyze`, the debug build, and on the phone in Task 10.

- [ ] **Step 1: Add the packages and the permission (identity test first)**

Append to `test/app_identity_test.dart` (inside `main`):

```dart
  test('attendance can ask for the camera and the location', () {
    expect(manifest, contains('android.permission.CAMERA'));
    expect(manifest, contains('android.permission.ACCESS_FINE_LOCATION'));
    expect(manifest, contains('android.permission.ACCESS_COARSE_LOCATION'));
  });
```

Run: `flutter test test/app_identity_test.dart` → FAIL (no CAMERA).

Then:

```powershell
flutter pub add camera:0.12.0+2 permission_handler:13.0.2
```

In `android/app/src/main/AndroidManifest.xml`, beside the location permissions, add:

```xml
    <!-- Attendance: the in-app photo that proves attendance (no gallery). -->
    <uses-permission android:name="android.permission.CAMERA" />
```

Run: `flutter test test/app_identity_test.dart` → PASS.

- [ ] **Step 2: Implement the camera step**

`lib/attendance/flow/camera_step.dart`:

```dart
import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../ui/theme.dart';
import '../domain/attendance_failure.dart';
import '../domain/photo_overlay.dart';
import '../ui/attendance_copy.dart';
import 'time_flow_screen.dart';

/// Step 2: the photo that proves attendance. In-app capture only — a photo
/// that must be taken now, at the site, is the cheapest anti-spoofing there is.
///
/// FRONT camera by default, BACK one tap away; a front photo is filed
/// mirrored, as previewed (see PhotoPreparer).
///
/// CAMERA AND LOCATION are asked for together, here: location is used at
/// SUBMIT, and asking there — photo taken, note typed — is where a denial
/// costs most. Only the CAMERA answer gates this screen; a refused location
/// is explained at SUBMIT in words the worker can act on.
class CameraStep extends StatefulWidget {
  const CameraStep({super.key, required this.args});
  final CameraStepArgs args;

  @override
  State<CameraStep> createState() => _CameraStepState();
}

class _CameraStepState extends State<CameraStep> with WidgetsBindingObserver {
  CameraController? _camera;
  List<CameraDescription> _cameras = const [];
  CameraLensDirection _lens = CameraLensDirection.front;

  /// Null while the first permission prompt is still on screen.
  bool? _granted;
  bool _opening = false;
  bool _failed = false;
  bool _capturing = false;
  DateTime _now = DateTime.now();
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // The preview caption must move, or it is wrong by the time the shutter fires.
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    _askAndOpen();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tick?.cancel();
    _camera?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      // Release the camera while away; it is re-opened on return.
      final camera = _camera;
      _camera = null;
      camera?.dispose();
      if (mounted) setState(() {});
    } else if (state == AppLifecycleState.resumed) {
      // Back from Settings: re-check, or a granted camera stays dead.
      _recheckAndOpen();
    }
  }

  Future<void> _askAndOpen() async {
    final statuses = await [Permission.camera, Permission.locationWhenInUse].request();
    final granted = statuses[Permission.camera]?.isGranted ?? false;
    if (!mounted) return;
    setState(() => _granted = granted);
    if (granted) await _open();
  }

  Future<void> _recheckAndOpen() async {
    if (_granted == null) return; // the first prompt is still being answered
    final granted = await Permission.camera.isGranted;
    if (!mounted) return;
    setState(() => _granted = granted);
    if (granted && _camera == null) await _open();
  }

  bool get _canSwitch =>
      _cameras.any((c) => c.lensDirection == CameraLensDirection.front) &&
      _cameras.any((c) => c.lensDirection == CameraLensDirection.back);

  Future<void> _open() async {
    if (_opening) return;
    _opening = true;
    try {
      if (_cameras.isEmpty) _cameras = await availableCameras();
      // Front unless the phone has none: a hard-coded front lens left such a phone staring at black.
      if (!_cameras.any((c) => c.lensDirection == CameraLensDirection.front)) _lens = CameraLensDirection.back;
      final description = _cameras.firstWhere((c) => c.lensDirection == _lens, orElse: () => _cameras.first);
      final controller = CameraController(
        description,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      final old = _camera;
      setState(() {
        _camera = controller;
        _lens = description.lensDirection;
        _failed = false;
      });
      await old?.dispose();
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      _opening = false;
    }
  }

  Future<void> _switch() async {
    _lens = _lens == CameraLensDirection.front ? CameraLensDirection.back : CameraLensDirection.front;
    final old = _camera;
    setState(() => _camera = null);
    await old?.dispose();
    await _open();
  }

  Future<void> _shoot() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized || _capturing) return;
    setState(() => _capturing = true);
    final at = DateTime.now(); // the shutter, frozen here
    try {
      final file = await camera.takePicture();
      widget.args.onTaken(file.path, at, _lens == CameraLensDirection.front);
    } catch (_) {
      if (mounted) setState(() => _capturing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    final ready = camera != null && camera.value.isInitialized;
    return Column(children: [
      Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: ColoredBox(
              color: const Color(0xFF1E211E),
              child: _granted == false
                  ? _denied()
                  : ready
                      ? _preview(camera)
                      : _waiting(),
            ),
          ),
        ),
      ),
      _ShutterRow(
        enabled: ready && !_capturing,
        capturing: _capturing,
        onShoot: _shoot,
        onSwitch: _canSwitch ? _switch : null,
      ),
    ]);
  }

  Widget _waiting() {
    if (!_failed) return const Center(child: CircularProgressIndicator(color: Colors.white));
    final copy = failureCopy(AttendanceFailure.unexpected);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(copy.english, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
          Text(copy.tagalog, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
          TextButton(
            onPressed: _open,
            child: const Text(retryLabel, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          ),
        ]),
      ),
    );
  }

  Widget _denied() => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text(
              'The camera is needed for the photo. Allow it in Settings.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70, fontSize: 16),
            ),
            const SizedBox(height: 14),
            // After a permanent denial the app cannot ask again; Settings is the
            // only way forward, and the resume re-check makes coming back work.
            TextButton(
              onPressed: () => openAppSettings(),
              child: const Text(openSettingsLabel, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
            ),
            TextButton(
              onPressed: widget.args.onGiveUp,
              child: const Text(notNowLabel, style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w600)),
            ),
          ]),
        ),
      );

  Widget _preview(CameraController camera) {
    final size = camera.value.previewSize;
    // The SAME text that gets burned into the file, shown before the shutter,
    // so a wrong project or a wrong phone clock is caught while it costs one tap.
    final (name, stamp) = photoOverlayCaptionLines(widget.args.projectName, _now);
    return Stack(fit: StackFit.expand, children: [
      if (size != null)
        FittedBox(
          fit: BoxFit.cover,
          // previewSize is landscape; the phone is held upright.
          child: SizedBox(width: size.height, height: size.width, child: CameraPreview(camera)),
        )
      else
        CameraPreview(camera),
      const IgnorePointer(
        child: Center(
          child: FractionallySizedBox(
            widthFactor: 0.62,
            heightFactor: 0.58,
            child: DecoratedBox(
              decoration: ShapeDecoration(shape: OvalBorder(side: BorderSide(color: Colors.white70, width: 3))),
            ),
          ),
        ),
      ),
      Align(
        alignment: Alignment.topCenter,
        child: Container(
          margin: const EdgeInsets.all(14),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(12)),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
            Text(stamp, style: const TextStyle(color: Colors.white, fontFamily: 'IBM Plex Mono', fontSize: 12)),
          ]),
        ),
      ),
      const Align(
        alignment: Alignment.bottomCenter,
        child: Padding(
          padding: EdgeInsets.all(14),
          child: Text(
            'Put your face inside the circle',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w600, fontSize: 14),
          ),
        ),
      ),
    ]);
  }
}

/// The shutter, with the camera switch beside it. No flash: on the front
/// camera of the phones this app targets it does nothing.
class _ShutterRow extends StatelessWidget {
  const _ShutterRow({required this.enabled, required this.capturing, required this.onShoot, required this.onSwitch});
  final bool enabled;
  final bool capturing;
  final VoidCallback onShoot;
  final VoidCallback? onSwitch;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 18),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          const SizedBox(width: 72),
          Semantics(
            button: true,
            label: 'Take photo',
            child: GestureDetector(
              key: const Key('shutter'),
              onTap: enabled ? onShoot : null,
              child: Container(
                width: 76,
                height: 76,
                padding: const EdgeInsets.all(5),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white.withValues(alpha: enabled ? 0.85 : 0.3), width: 4),
                ),
                child: Container(
                  decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: enabled ? 1 : 0.3)),
                  child: capturing
                      ? const Padding(
                          padding: EdgeInsets.all(18),
                          child: CircularProgressIndicator(strokeWidth: 3, color: WmColors.previewBackdrop),
                        )
                      : null,
                ),
              ),
            ),
          ),
          const SizedBox(width: 24),
          SizedBox(
            width: 48,
            child: onSwitch == null
                ? null
                : IconButton(
                    tooltip: 'Switch camera',
                    onPressed: onSwitch,
                    icon: const Icon(Icons.cameraswitch, color: Colors.white),
                  ),
          ),
        ]),
      );
}
```

- [ ] **Step 3: Run all checks**

Run: `flutter test` → all pass. `flutter analyze` → `No issues found!`. `flutter build apk --debug` → builds (this proves the camera and permission plugins merge into the Android build). If a plugin reports a `compileSdk`/`minSdk` mismatch, report the exact message rather than changing versions.

- [ ] **Step 4: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 6: Home

**Files:**
- Create: `lib/attendance/home/home_controller.dart`, `lib/attendance/home/home_screen.dart`
- Test: `test/attendance/home/home_controller_test.dart`, `test/attendance/home/home_screen_test.dart`

**Interfaces:**
- Consumes: `AttendanceApi`, `UploadScheduler`; `historyRange`, `weekStrip`, `WeekDayCell`, `hoursSince`, `formatMinutes`, `nothingYet`, `manilaDate`, `isoDate` (0C-1); Task 2's copy, notices, pills, formats, `WorkerHeader`, `FailureNotice`, `noticeAction`.
- Produces: `class HomeController extends ChangeNotifier { HomeController({required AttendanceApi attendance, required UploadScheduler scheduler, DateTime Function()? now}); final DateTime Function() now; bool loading; AttendanceRecord? record; AttendanceFailure? failure; List<PendingSubmission> refused; List<WeekDayCell> week; TimeDirection? nextAction; bool working; bool complete; int? minutes; String hoursLabel; Future<void> refresh(); Future<void> dismissRefused(String eventId); void tick(); }`; `class HomeScreen extends StatefulWidget { const HomeScreen({required WorkerProfile worker, required HomeController controller, required void Function(TimeDirection) onStartFlow, required VoidCallback onSeeHistory, required void Function(SettingsRoute) openSettings, Bilingual? exitNotice, VoidCallback? onDismissExit}); }`.

- [ ] **Step 1: Write the failing tests**

`test/attendance/home/home_controller_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:workmate/attendance/domain/attendance_failure.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/home/home_controller.dart';

import '../fakes.dart';

void main() {
  late FakeAttendance attendance;
  late FakeScheduler scheduler;
  final now = DateTime.parse('2026-08-19T02:00:00Z'); // 10:00 AM, Wednesday 19 Aug, Manila

  HomeController home() => HomeController(attendance: attendance, scheduler: scheduler, now: () => now);
  AttendanceRecord working({bool pending = false}) => AttendanceRecord(
        id: 'r',
        workDate: '2026-08-19',
        status: AttendanceStatus.working,
        timeInAt: DateTime.parse('2026-08-18T23:45:00Z'),
        timeInProjectName: abc.name,
        pending: pending,
      );
  Future<void> settle() => Future<void>.delayed(Duration.zero);

  setUp(() {
    attendance = FakeAttendance();
    scheduler = FakeScheduler();
  });

  test('nothing is offered while today is still being read', () {
    final c = home();
    expect(c.loading, isTrue);
    expect(c.nextAction, isNull);
  });

  test('no record yet: Time In', () async {
    final c = home();
    await c.refresh();
    expect(c.nextAction, TimeDirection.timeIn);
    expect(c.hoursLabel, '--');
    expect(c.minutes, isNull);
  });

  test('working: Time Out, with the hours so far', () async {
    attendance.todayRecord = working();
    final c = home();
    await c.refresh();
    expect(c.nextAction, TimeDirection.timeOut);
    expect(c.working, isTrue);
    expect(c.minutes, 135);
    expect(c.hoursLabel, '2h 15m');
  });

  test("a closed day offers nothing and shows the server's total", () async {
    attendance.todayRecord = const AttendanceRecord(id: 'r', workDate: '2026-08-19', status: AttendanceStatus.complete, totalMinutes: 585);
    final c = home();
    await c.refresh();
    expect(c.nextAction, isNull);
    expect(c.complete, isTrue);
    expect(c.hoursLabel, '9h 45m');
    expect(c.minutes, 585);
  });

  test('no signal and nothing on the phone still offers Time In', () async {
    attendance.todayError = const SocketException('down');
    final c = home();
    await c.refresh();
    expect(c.failure, AttendanceFailure.noConnection);
    expect(c.nextAction, TimeDirection.timeIn);
  });

  test('a server refusal offers nothing', () async {
    attendance.todayError = const PostgrestException(message: 'ACCOUNT_INACTIVE', code: 'P0001');
    final c = home();
    await c.refresh();
    expect(c.failure, AttendanceFailure.accountInactive);
    expect(c.nextAction, isNull);
  });

  test('opening Home sends the queue now and warms the project list', () async {
    final c = home();
    await c.refresh();
    await settle();
    expect(scheduler.sendNows, 1);
    expect(attendance.projectLoads, 1);
  });

  test('a failed week read never takes today down with it', () async {
    attendance.historyError = const SocketException('down');
    attendance.todayRecord = working();
    final c = home();
    await c.refresh();
    await settle();
    expect(c.record, isNotNull);
    expect(c.week.length, 6);
  });

  test('the strip turns today on as soon as the phone has a record', () async {
    attendance.todayRecord = working(pending: true);
    final c = home();
    await c.refresh();
    await settle();
    expect(c.week.firstWhere((d) => d.isToday).worked, isTrue);
  });

  test('refused submissions are listed and can be dismissed', () async {
    attendance.refused = [refusedRow()];
    final c = home();
    await c.refresh();
    await settle();
    expect(c.refused.single.eventId, 'e9');
    await c.dismissRefused('e9');
    expect(attendance.dismissed, ['e9']);
    expect(c.refused, isEmpty);
  });
}
```

`test/attendance/home/home_screen_test.dart`:

```dart
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/attendance/home/home_controller.dart';
import 'package:workmate/attendance/home/home_screen.dart';
import 'package:workmate/attendance/ui/attendance_copy.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/ui/theme.dart';

import '../fakes.dart';

void main() {
  late FakeAttendance attendance;
  late FakeScheduler scheduler;
  late List<TimeDirection> started;
  late int seeAll;
  late int exitDismissed;
  final now = DateTime.parse('2026-08-19T02:00:00Z'); // 10:00 AM, Wednesday 19 Aug, Manila
  const worker = WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42);

  Future<void> show(WidgetTester tester, {Bilingual? exit}) async {
    useTallPhone(tester);
    final c = HomeController(attendance: attendance, scheduler: scheduler, now: () => now);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: HomeScreen(
          worker: worker,
          controller: c,
          onStartFlow: started.add,
          onSeeHistory: () => seeAll++,
          openSettings: (_) {},
          exitNotice: exit,
          onDismissExit: () => exitDismissed++,
        ),
      ),
    ));
    await c.refresh();
    await tester.pumpAndSettle();
  }

  setUp(() {
    attendance = FakeAttendance();
    scheduler = FakeScheduler();
    started = [];
    seeAll = 0;
    exitDismissed = 0;
  });

  testWidgets('a fresh day offers Time In and says nothing is recorded yet', (tester) async {
    await show(tester);
    expect(find.text('Juan dela Cruz'), findsOneWidget);
    expect(find.text('WEDNESDAY'), findsOneWidget);
    expect(find.text('19 August 2026'), findsOneWidget);
    expect(find.text('STEP 1 OF 4'), findsOneWidget);
    expect(find.text('Tap to start your day'), findsOneWidget);
    expect(find.text('project · photo · check · submit'), findsOneWidget);
    expect(find.text('You have not timed in yet'), findsOneWidget);
    await tester.tap(find.byKey(const Key('hero-time-in')));
    expect(started, [TimeDirection.timeIn]);
  });

  testWidgets('while working: Time Out, the hours so far, and an honest "not sent yet"', (tester) async {
    attendance.todayRecord = AttendanceRecord(
      id: 'r',
      workDate: '2026-08-19',
      status: AttendanceStatus.working,
      timeInAt: DateTime.parse('2026-08-18T23:45:00Z'),
      timeInProjectName: abc.name,
      pending: true,
    );
    await show(tester);
    expect(find.text('Timed in at 7:45 AM'), findsOneWidget);
    expect(find.text('Not sent yet'), findsOneWidget);
    expect(find.text('Saved on this phone. It will send when there is signal.'), findsOneWidget);
    expect(find.text('Hours so far'), findsOneWidget);
    expect(find.text('2h 15m'), findsOneWidget);
    expect(find.text('Since 7:45 AM'), findsOneWidget);
    expect(find.text('You have not timed in yet'), findsNothing);
    await tester.tap(find.byKey(const Key('hero-time-out')));
    expect(started, [TimeDirection.timeOut]);
  });

  testWidgets("a closed day shows the server's total and no button", (tester) async {
    attendance.todayRecord = AttendanceRecord(
      id: 'r',
      workDate: '2026-08-19',
      status: AttendanceStatus.complete,
      timeInAt: DateTime.parse('2026-08-18T23:45:00Z'),
      timeOutAt: DateTime.parse('2026-08-19T09:30:00Z'),
      totalMinutes: 585,
    );
    await show(tester);
    expect(find.text('Saved'), findsOneWidget);
    expect(find.text('Total hours'), findsOneWidget);
    expect(find.text('9h 45m'), findsOneWidget);
    expect(find.text('Day complete'), findsOneWidget);
    expect(find.byKey(const Key('hero-time-in')), findsNothing);
    expect(find.byKey(const Key('hero-time-out')), findsNothing);
  });

  testWidgets('no signal and nothing on the phone: Time In is still offered', (tester) async {
    attendance.todayError = const SocketException('down');
    await show(tester);
    expect(find.text('No signal right now. Try again in a moment.'), findsOneWidget);
    expect(find.text('Walang signal ngayon. Subukan ulit mamaya.'), findsOneWidget);
    expect(find.byKey(const Key('hero-time-in')), findsOneWidget);
    expect(find.text('You have not timed in yet'), findsNothing);
  });

  testWidgets('a server refusal hides the button', (tester) async {
    attendance.todayError = const PostgrestException(message: 'ACCOUNT_INACTIVE', code: 'P0001');
    await show(tester);
    expect(find.text('This account is turned off. Call the office.'), findsOneWidget);
    expect(find.byKey(const Key('hero-time-in')), findsNothing);
  });

  testWidgets('a refused submission is explained until dismissed', (tester) async {
    attendance.refused = [refusedRow()];
    await show(tester);
    expect(find.text('Your Time In on 19 Aug was not accepted.'), findsOneWidget);
    expect(find.text('You are too far from the project to record attendance. Move closer to the site and try again.'),
        findsOneWidget);
    await tester.tap(find.text(dismissLabel));
    await tester.pumpAndSettle();
    expect(attendance.dismissed, ['e9']);
    expect(find.text('Your Time In on 19 Aug was not accepted.'), findsNothing);
  });

  testWidgets('the exit notice explains a cancelled flow', (tester) async {
    await show(tester, exit: flowCancelledByCamera(TimeDirection.timeIn));
    expect(find.text('Time In was not recorded. The camera permission is off, and the photo is the proof of attendance.'),
        findsOneWidget);
    await tester.tap(find.text(dismissLabel));
    expect(exitDismissed, 1);
  });

  testWidgets('See all opens History', (tester) async {
    await show(tester);
    await tester.tap(find.text('See all'));
    expect(seeAll, 1);
  });

  testWidgets('today is marked worked on the strip as soon as the phone has a record', (tester) async {
    attendance.todayRecord = AttendanceRecord(
      id: 'r',
      workDate: '2026-08-19',
      status: AttendanceStatus.working,
      timeInAt: DateTime.parse('2026-08-18T23:45:00Z'),
      pending: true,
    );
    await show(tester);
    expect(find.byKey(const Key('week-dot-2026-08-19-worked')), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/attendance/home`
Expected: FAIL — the home files do not exist.

- [ ] **Step 3: Implement**

`lib/attendance/home/home_controller.dart`:

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/attendance_api.dart';
import '../data/submission_request.dart';
import '../domain/attendance_failure.dart';
import '../domain/attendance_record.dart';
import '../domain/history.dart';
import '../domain/total_hours.dart';
import '../domain/work_date.dart';
import '../sync/upload_scheduler.dart';

/// Home's state. Ported from DACS Attendance's DashboardViewModel: today's
/// record decides the one hero action.
class HomeController extends ChangeNotifier {
  HomeController({required AttendanceApi attendance, required UploadScheduler scheduler, DateTime Function()? now})
      : _attendance = attendance,
        _scheduler = scheduler,
        now = now ?? DateTime.now;

  final AttendanceApi _attendance;
  final UploadScheduler _scheduler;

  /// The clock the screen reads (fixed in tests).
  final DateTime Function() now;

  bool _loading = true;
  AttendanceRecord? _record;
  AttendanceFailure? _failure;
  List<WeekDayCell> _week = const [];
  List<PendingSubmission> _refused = const [];
  bool _disposed = false;

  bool get loading => _loading;
  AttendanceRecord? get record => _record;
  AttendanceFailure? get failure => _failure;
  List<PendingSubmission> get refused => _refused;
  bool get working => _record?.status == AttendanceStatus.working;
  bool get complete => _record?.status == AttendanceStatus.complete;

  /// The single decision this screen makes. Null = no hero button.
  TimeDirection? get nextAction {
    // "Not loaded yet" and "no record today" are different facts: offering an
    // action before the read resolves invites a double Time In.
    if (_loading) return null;
    final r = _record;
    if (r != null) return r.nextAction;
    // No signal and nothing on the phone: a worker at 07:45 with no bars must
    // still be able to start the day. A double Time In is refused by the RPC
    // (ALREADY_TIMED_IN) and the queue drops and reconciles it.
    if (_failure == AttendanceFailure.noConnection) return TimeDirection.timeIn;
    // Any other failure is the server refusing, not unreachable.
    if (_failure != null) return null;
    return TimeDirection.timeIn;
  }

  /// Monday to Saturday. The week comes from the server's history and the
  /// record from the phone (which knows about a queued Time In): the record
  /// only ever turns today ON.
  List<WeekDayCell> get week {
    final today = manilaDate(now());
    final cells = _week.isEmpty ? weekStrip(const [], today) : _week;
    if (_record == null) return cells;
    return [
      for (final c in cells)
        c.isToday && !c.worked ? WeekDayCell(date: c.date, label: c.label, worked: true, isToday: true, future: c.future) : c,
    ];
  }

  /// Minutes for the meter; null means "no figure" (an empty track, not zero hours).
  int? get minutes {
    final r = _record;
    if (r == null) return null;
    final timeIn = r.timeInAt;
    if (r.status == AttendanceStatus.working && timeIn != null) {
      final m = now().difference(timeIn).inMinutes;
      return m < 0 ? 0 : m;
    }
    return r.totalMinutes;
  }

  /// Live while working; once closed, the SERVER's total, never recomputed.
  String get hoursLabel {
    final r = _record;
    if (r == null) return nothingYet;
    final timeIn = r.timeInAt;
    if (r.status == AttendanceStatus.working && timeIn != null) return hoursSince(timeIn, now());
    return formatMinutes(r.totalMinutes);
  }

  Future<void> refresh() async {
    _loading = true;
    _failure = null;
    _notify();
    // Opening Home is the clearest sign a human is present and probably back
    // in coverage: queued records get a fresh attempt now.
    unawaited(_quietly(_scheduler.sendNow));
    // Warm the project cache while there is signal; the picker reads it offline.
    unawaited(_quietly(_attendance.activeProjects));
    // Read separately so a failure here cannot take the hero button down.
    unawaited(_loadWeek());
    unawaited(_loadRefused());
    try {
      _record = await _attendance.today();
    } catch (e) {
      // Deliberately NOT "no record yet": that reads as "you have not timed in".
      _failure = AttendanceFailure.of(e);
    }
    _loading = false;
    _notify();
  }

  Future<void> dismissRefused(String eventId) async {
    try {
      await _attendance.dismissRefused(eventId);
    } catch (_) {
      // Left listed; the worker can dismiss it again.
    }
    await _loadRefused();
  }

  /// Re-draws the live "Hours so far".
  void tick() => _notify();

  Future<void> _loadWeek() async {
    final today = manilaDate(now());
    final range = historyRange(HistorySpan.week, today);
    try {
      final records = await _attendance.history(isoDate(range.start), isoDate(range.end));
      _week = weekStrip(records, today);
      _notify();
    } catch (_) {
      // The strip is a glance; six empty cells until it can be read.
    }
  }

  Future<void> _loadRefused() async {
    try {
      _refused = await _attendance.refusedSubmissions();
      _notify();
    } catch (_) {
      // Shown next time.
    }
  }

  static Future<void> _quietly(Future<void> Function() action) async {
    try {
      await action();
    } catch (_) {
      // Best effort.
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
```

`lib/attendance/home/home_screen.dart`:

```dart
import 'dart:async';

import 'package:flutter/material.dart';

import '../../auth/worker_profile.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../../ui/worker_header.dart';
import '../domain/attendance_failure.dart';
import '../domain/attendance_record.dart';
import '../domain/history.dart';
import '../domain/work_date.dart';
import '../ui/attendance_copy.dart';
import '../ui/attendance_failure_notice.dart';
import '../ui/formats.dart';
import '../ui/status_pill.dart';
import 'home_controller.dart';

/// Home: today's record and the one thing to do next. Ported from DACS
/// Attendance's DashboardScreen (the weekly reward strip arrives in 0D).
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.worker,
    required this.controller,
    required this.onStartFlow,
    required this.onSeeHistory,
    required this.openSettings,
    this.exitNotice,
    this.onDismissExit,
  });

  final WorkerProfile worker;
  final HomeController controller;
  final void Function(TimeDirection direction) onStartFlow;
  final VoidCallback onSeeHistory;
  final void Function(SettingsRoute route) openSettings;

  /// Why the last flow recorded nothing (a declined camera), until dismissed.
  final Bilingual? exitNotice;
  final VoidCallback? onDismissExit;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    // The live "Hours so far". A minute is the smallest unit anyone reads.
    _tick = Timer.periodic(const Duration(seconds: 30), (_) {
      if (widget.controller.working) widget.controller.tick();
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: widget.controller,
        builder: (context, _) {
          final c = widget.controller;
          final now = c.now();
          final failure = c.failure;
          final exit = widget.exitNotice;
          return RefreshIndicator(
            onRefresh: c.refresh,
            child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
              WorkerHeader(worker: widget.worker),
              const SizedBox(height: 18),
              Text(weekdayName(now).toUpperCase(),
                  style: const TextStyle(fontSize: 12.5, letterSpacing: 0.6, color: WmColors.textMuted, fontWeight: FontWeight.w600)),
              Text(longDate(now), style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800)),
              const SizedBox(height: 16),
              if (exit != null) ...[
                FailureNotice(
                  english: exit.english,
                  tagalog: exit.tagalog,
                  actions: [noticeAction(dismissLabel, widget.onDismissExit ?? () {})],
                ),
                const SizedBox(height: 12),
              ],
              for (final p in c.refused) ...[
                AttendanceFailureNotice(
                  failure: failureFromStored(p.lastError),
                  lead: refusedLead(TimeDirection.parse(p.direction), dayMonth(p.capturedAt)),
                  onDismiss: () => c.dismissRefused(p.eventId),
                ),
                const SizedBox(height: 12),
              ],
              if (failure != null) ...[
                AttendanceFailureNotice(failure: failure, onRetry: c.refresh, onOpenSettings: widget.openSettings),
                const SizedBox(height: 12),
              ],
              ..._today(c, failure),
              const SizedBox(height: 20),
              _WeekStrip(cells: c.week, onSeeAll: widget.onSeeHistory),
            ]),
          );
        },
      );

  List<Widget> _today(HomeController c, AttendanceFailure? failure) {
    if (c.loading) {
      return const [Padding(padding: EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator()))];
    }
    final record = c.record;
    if (record == null) {
      return [
        // The BUTTON follows nextAction (still offered with no signal); the
        // CARD claims "not timed in" only once the day was actually read.
        if (c.nextAction != null) ...[
          _HeroAction(direction: TimeDirection.timeIn, onTap: () => widget.onStartFlow(TimeDirection.timeIn)),
          const SizedBox(height: 12),
        ],
        if (failure == null)
          const _NoticeCard(icon: Icons.schedule, title: 'You have not timed in yet', subtitle: 'Tap Time In when you arrive'),
      ];
    }
    return [
      _TimedInCard(controller: c, record: record),
      const SizedBox(height: 12),
      if (c.nextAction == TimeDirection.timeOut)
        _HeroAction(direction: TimeDirection.timeOut, onTap: () => widget.onStartFlow(TimeDirection.timeOut))
      // A closed day (or one we could not read): offering Time In could only fail.
      else if (failure == null)
        const _NoticeCard(
          icon: Icons.check,
          title: 'Day complete',
          subtitle: 'Thank you. See you tomorrow.',
          tint: WmColors.greenTint,
          iconColor: WmColors.green,
        ),
    ];
  }
}

class _HeroAction extends StatelessWidget {
  const _HeroAction({required this.direction, required this.onTap});
  final TimeDirection direction;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final timeIn = direction == TimeDirection.timeIn;
    return Material(
      borderRadius: BorderRadius.circular(24),
      clipBehavior: Clip.antiAlias,
      child: Ink(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: timeIn ? const [WmColors.green, WmColors.greenDeep] : const [WmColors.brownLight, WmColors.brownDeep],
          ),
        ),
        child: InkWell(
          key: Key(timeIn ? 'hero-time-in' : 'hero-time-out'),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (timeIn) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(999)),
                  child: Text('STEP 1 OF 4', style: monoLabel.copyWith(color: Colors.white, fontSize: 11)),
                ),
                const SizedBox(height: 14),
              ],
              Row(children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: const BoxDecoration(color: Colors.white24, shape: BoxShape.circle),
                  child: Icon(timeIn ? Icons.south_west : Icons.north_east, color: Colors.white, size: 28),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(timeIn ? 'Time In' : 'Time Out',
                        style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
                    Text(timeIn ? 'Tap to start your day' : 'Tap when you are heading home',
                        style: const TextStyle(color: Colors.white70, fontSize: 14.5)),
                  ]),
                ),
              ]),
              if (timeIn) ...[
                const SizedBox(height: 14),
                Text('project · photo · check · submit', style: monoLabel.copyWith(color: Colors.white70, letterSpacing: 0.3)),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.tint = WmColors.canvas,
    this.iconColor = WmColors.textMuted,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final Color tint;
  final Color iconColor;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: WmColors.border),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: tint, shape: BoxShape.circle),
            child: Icon(icon, color: iconColor),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              Text(subtitle, style: const TextStyle(fontSize: 13.5, color: WmColors.textMuted)),
            ]),
          ),
        ]),
      );
}

class _TimedInCard extends StatelessWidget {
  const _TimedInCard({required this.controller, required this.record});
  final HomeController controller;
  final AttendanceRecord record;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final timeIn = record.timeInAt;
    final minutes = c.minutes;
    final project = record.timeInProjectName;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: WmColors.border),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(timeIn != null ? 'Timed in at ${clockTime(timeIn)}' : 'Working',
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
              if (project != null) Text(project, style: const TextStyle(fontSize: 13.5, color: WmColors.textMuted)),
            ]),
          ),
          record.pending ? const StatusPill.brown('Not sent yet') : const StatusPill.green('Saved'),
        ]),
        const SizedBox(height: 14),
        Text(c.complete ? 'Total hours' : 'Hours so far', style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
        Text(c.hoursLabel, style: const TextStyle(fontFamily: 'IBM Plex Mono', fontSize: 30, fontWeight: FontWeight.w700)),
        if (c.working && timeIn != null)
          Text('Since ${clockTime(timeIn)}', style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            // An 8-hour day fills the bar.
            value: minutes == null ? 0 : (minutes / 480).clamp(0, 1).toDouble(),
            minHeight: 8,
            color: c.complete ? WmColors.brown : WmColors.green,
            backgroundColor: WmColors.hairline,
          ),
        ),
        if (record.pending) ...[
          const SizedBox(height: 10),
          // Reassurance, not a warning: the record is safe on the phone.
          const Text('Saved on this phone. It will send when there is signal.',
              style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
        ],
      ]),
    );
  }
}

class _WeekStrip extends StatelessWidget {
  const _WeekStrip({required this.cells, required this.onSeeAll});
  final List<WeekDayCell> cells;
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Text('THIS WEEK', style: monoLabel),
          const Spacer(),
          TextButton(onPressed: onSeeAll, child: const Text('See all', style: TextStyle(fontWeight: FontWeight.w700))),
        ]),
        Row(children: [for (final cell in cells) Expanded(child: _WeekCell(cell: cell))]),
      ]);
}

class _WeekCell extends StatelessWidget {
  const _WeekCell({required this.cell});
  final WeekDayCell cell;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.symmetric(horizontal: 3),
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: cell.isToday ? WmColors.greenTint : Colors.white,
          border: Border.all(color: cell.isToday ? WmColors.green : WmColors.border, width: cell.isToday ? 1.5 : 1),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(children: [
          Text(
            cell.label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: cell.isToday ? FontWeight.w800 : FontWeight.w600,
              color: cell.isToday
                  ? WmColors.green
                  : cell.future
                      ? WmColors.textDisabled
                      : WmColors.textMuted,
            ),
          ),
          const SizedBox(height: 6),
          Container(
            key: Key('week-dot-${isoDate(cell.date)}-${cell.worked ? 'worked' : 'empty'}'),
            width: 8,
            height: 8,
            decoration: BoxDecoration(shape: BoxShape.circle, color: cell.worked ? WmColors.green : WmColors.border),
          ),
        ]),
      );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/attendance/home` → PASS. Then `flutter test` and `flutter analyze` → clean.

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 7: History and the photo viewer

**Files:**
- Create: `lib/attendance/history/history_controller.dart`, `lib/attendance/history/history_screen.dart`, `lib/attendance/history/photo_viewer.dart`
- Test: `test/attendance/history/history_controller_test.dart`, `test/attendance/history/history_screen_test.dart`

**Interfaces:**
- Consumes: `AttendanceApi`; `HistorySpan`, `historyRange`, `historyDays`, `historySummary`, `HistoryDay`, `HistorySummary`, `manilaDate`, `isoDate`, `formatMinutes` (0C-1); Task 2 formats, `StatusPill`, `AttendanceFailureNotice`.
- Produces: `class HistoryController extends ChangeNotifier { HistoryController({required AttendanceApi attendance, DateTime Function()? now}); HistorySpan span; bool loading; List<HistoryDay> days; HistorySummary summary; AttendanceFailure? failure; Future<void> setSpan(HistorySpan span); Future<void> refresh(); }`; `typedef PhotoUrl = Future<String?> Function(String? path)`; `class HistoryScreen extends StatelessWidget { const HistoryScreen({required HistoryController controller, required PhotoUrl photoUrl}); }`; `class PhotoViewer extends StatelessWidget { const PhotoViewer({required ImageProvider image, required String heading, required String caption}); }`.

- [ ] **Step 1: Write the failing tests**

`test/attendance/history/history_controller_test.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_failure.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/history.dart';
import 'package:workmate/attendance/history/history_controller.dart';

import '../fakes.dart';

void main() {
  late FakeAttendance attendance;
  final now = DateTime.parse('2026-08-26T02:00:00Z'); // Wednesday 26 Aug, Manila

  HistoryController history() => HistoryController(attendance: attendance, now: () => now);

  setUp(() => attendance = FakeAttendance());

  test('the week runs Monday to today and keeps the gaps', () async {
    attendance.historyRecords = [
      const AttendanceRecord(id: 'a', workDate: '2026-08-24', status: AttendanceStatus.complete, totalMinutes: 585),
    ];
    final c = history();
    await c.refresh();
    expect(attendance.historyCalls.single, ('2026-08-24', '2026-08-26'));
    expect(c.days.map((d) => d.workDate), ['2026-08-26', '2026-08-25', '2026-08-24']);
    expect(c.summary.daysWorked, 1);
    expect(c.summary.totalMinutes, 585);
    expect(c.loading, isFalse);
  });

  test('Month reads from the first of the month', () async {
    final c = history();
    await c.refresh();
    await c.setSpan(HistorySpan.month);
    expect(attendance.historyCalls.last, ('2026-08-01', '2026-08-26'));
    expect(c.span, HistorySpan.month);
    expect(c.days.length, 26);
  });

  test('choosing the span already shown does not read again', () async {
    final c = history();
    await c.refresh();
    await c.setSpan(HistorySpan.week);
    expect(attendance.historyCalls.length, 1);
  });

  test('no signal and nothing saved says so, instead of an empty history', () async {
    attendance.historyError = const SocketException('down');
    final c = history();
    await c.refresh();
    expect(c.failure, AttendanceFailure.noConnection);
    expect(c.days, isEmpty);
  });

  test('a slow answer for Week cannot overwrite the Month the worker switched to', () async {
    final gate = Completer<void>();
    attendance.historyGate = gate;
    final c = history();
    final week = c.refresh();
    attendance.historyGate = null;
    await c.setSpan(HistorySpan.month);
    gate.complete();
    await week;
    expect(c.span, HistorySpan.month);
    expect(c.days.length, 26);
  });
}
```

`test/attendance/history/history_screen_test.dart`:

```dart
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/history/history_controller.dart';
import 'package:workmate/attendance/history/history_screen.dart';
import 'package:workmate/attendance/history/photo_viewer.dart';
import 'package:workmate/attendance/ui/attendance_copy.dart';
import 'package:workmate/ui/theme.dart';

import '../fakes.dart';

void main() {
  late FakeAttendance attendance;
  final now = DateTime.parse('2026-08-26T02:00:00Z'); // Wednesday 26 Aug, Manila

  Future<HistoryController> show(WidgetTester tester) async {
    useTallPhone(tester);
    final c = HistoryController(attendance: attendance, now: () => now);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(body: HistoryScreen(controller: c, photoUrl: (_) async => null)),
    ));
    await c.refresh();
    await tester.pumpAndSettle();
    return c;
  }

  setUp(() => attendance = FakeAttendance());

  testWidgets('a week with a closed day, a gap and an open day', (tester) async {
    attendance.historyRecords = [
      AttendanceRecord(
        id: 'b',
        workDate: '2026-08-26',
        status: AttendanceStatus.working,
        timeInAt: DateTime.parse('2026-08-25T23:45:00Z'),
        timeInProjectName: abc.name,
      ),
      AttendanceRecord(
        id: 'a',
        workDate: '2026-08-24',
        status: AttendanceStatus.complete,
        timeInAt: DateTime.parse('2026-08-24T00:00:00Z'),
        timeOutAt: DateTime.parse('2026-08-24T09:45:00Z'),
        timeInProjectName: abc.name,
        timeOutProjectName: abc.name,
        totalMinutes: 585,
      ),
    ];
    await show(tester);
    expect(find.text('My attendance'), findsOneWidget);
    expect(find.text('2 days worked'), findsOneWidget);
    expect(find.text('this week'), findsOneWidget);
    expect(find.text('9h 45m'), findsNWidgets(2)); // the total, and the closed day's pill
    expect(find.text('Wednesday, 26 Aug'), findsOneWidget);
    expect(find.text('Working'), findsOneWidget);
    expect(find.text('7:45 AM'), findsOneWidget);
    expect(find.text('not yet'), findsOneWidget);
    expect(find.text('Tuesday, 25 Aug'), findsOneWidget);
    expect(find.text('No record'), findsOneWidget);
    expect(find.text('Monday, 24 Aug'), findsOneWidget);
    expect(find.text('8:00 AM'), findsOneWidget);
    expect(find.text('5:45 PM'), findsOneWidget);
  });

  testWidgets('a day still on the phone says so', (tester) async {
    attendance.historyRecords = [
      AttendanceRecord(
        id: 'b',
        workDate: '2026-08-26',
        status: AttendanceStatus.working,
        timeInAt: DateTime.parse('2026-08-25T23:45:00Z'),
        pending: true,
      ),
    ];
    await show(tester);
    expect(find.text('Not sent yet'), findsOneWidget);
  });

  testWidgets('Month asks for the whole month', (tester) async {
    await show(tester);
    await tester.tap(find.text('Month'));
    await tester.pumpAndSettle();
    expect(attendance.historyCalls.last, ('2026-08-01', '2026-08-26'));
    expect(find.text('this month'), findsOneWidget);
  });

  testWidgets('offline with nothing saved says so, and can be retried', (tester) async {
    attendance.historyError = const SocketException('down');
    await show(tester);
    expect(find.text('No signal right now. Try again in a moment.'), findsOneWidget);
    await tester.tap(find.text(retryLabel));
    await tester.pumpAndSettle();
    expect(attendance.historyCalls.length, 2);
  });

  testWidgets('the photo viewer says whose proof it is, and closes', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
            builder: (_) => PhotoViewer(image: MemoryImage(Uint8List(0)), heading: 'Wednesday, 26 Aug', caption: 'Time In · 7:45 AM'),
          )),
          child: const Text('open'),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('PROOF'), findsOneWidget);
    expect(find.text('Wednesday, 26 Aug'), findsOneWidget);
    expect(find.text('Time In · 7:45 AM'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.text('PROOF'), findsNothing);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/attendance/history`
Expected: FAIL — the history files do not exist.

- [ ] **Step 3: Implement**

`lib/attendance/history/history_controller.dart`:

```dart
import 'package:flutter/foundation.dart';

import '../data/attendance_api.dart';
import '../domain/attendance_failure.dart';
import '../domain/history.dart';
import '../domain/work_date.dart';

/// History's state: the span, its days (gaps included) and the totals.
/// Ported from DACS Attendance's HistoryViewModel.
class HistoryController extends ChangeNotifier {
  HistoryController({required AttendanceApi attendance, DateTime Function()? now})
      : _attendance = attendance,
        _now = now ?? DateTime.now;

  final AttendanceApi _attendance;
  final DateTime Function() _now;

  HistorySpan _span = HistorySpan.week;
  bool _loading = true;
  List<HistoryDay> _days = const [];
  HistorySummary _summary = const HistorySummary(daysWorked: 0, totalMinutes: 0);
  AttendanceFailure? _failure;
  int _generation = 0;
  bool _disposed = false;

  HistorySpan get span => _span;
  bool get loading => _loading;
  List<HistoryDay> get days => _days;
  HistorySummary get summary => _summary;
  AttendanceFailure? get failure => _failure;

  Future<void> setSpan(HistorySpan span) async {
    if (span == _span) return;
    await _load(span);
  }

  Future<void> refresh() => _load(_span);

  Future<void> _load(HistorySpan span) async {
    // A newer request makes an older answer stale: quick Week/Month taps
    // must never show one span's days under the other's label.
    final generation = ++_generation;
    _span = span;
    _loading = true;
    _failure = null;
    _notify();
    final range = historyRange(span, manilaDate(_now()));
    try {
      final records = await _attendance.history(isoDate(range.start), isoDate(range.end));
      if (generation != _generation) return;
      // The days come from the RANGE, not the records: a day with no record
      // has to appear as a gap.
      _days = historyDays(range, records);
      _summary = historySummary(_days);
    } catch (e) {
      if (generation != _generation) return;
      _days = const [];
      _failure = AttendanceFailure.of(e);
    }
    _loading = false;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
```

`lib/attendance/history/photo_viewer.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/theme.dart';

/// One attendance photo, full screen: the proof, with whose day and which leg.
class PhotoViewer extends StatelessWidget {
  const PhotoViewer({super.key, required this.image, required this.heading, required this.caption});
  final ImageProvider image;
  final String heading;
  final String caption;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: WmColors.viewerBackdrop,
        body: SafeArea(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              IconButton(
                tooltip: 'Close',
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close, color: Colors.white),
              ),
              const Spacer(),
              Padding(
                padding: const EdgeInsets.only(right: 16),
                child: Text('PROOF', style: monoLabel.copyWith(color: Colors.white70)),
              ),
            ]),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(heading, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                Text(caption, style: const TextStyle(color: Colors.white70, fontSize: 14)),
              ]),
            ),
            Expanded(
              child: InteractiveViewer(
                child: Center(
                  child: Image(
                    image: image,
                    fit: BoxFit.contain,
                    errorBuilder: (_, _, _) => const Text('No photo yet', style: TextStyle(color: Colors.white70)),
                  ),
                ),
              ),
            ),
          ]),
        ),
      );
}
```

`lib/attendance/history/history_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../domain/attendance_record.dart';
import '../domain/history.dart';
import '../domain/total_hours.dart';
import '../ui/attendance_failure_notice.dart';
import '../ui/formats.dart';
import '../ui/status_pill.dart';
import 'history_controller.dart';
import 'photo_viewer.dart';

/// A link for one attendance photo, or null (no photo yet / no signal).
typedef PhotoUrl = Future<String?> Function(String? path);

/// History: the worker's own days, week or month, with the gaps showing.
class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key, required this.controller, required this.photoUrl});
  final HistoryController controller;
  final PhotoUrl photoUrl;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final c = controller;
          final failure = c.failure;
          return RefreshIndicator(
            onRefresh: c.refresh,
            child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
              const Text('My attendance', style: TextStyle(fontSize: 23, fontWeight: FontWeight.w800)),
              const Text('Your recorded days', style: TextStyle(fontSize: 14, color: WmColors.textMuted)),
              const SizedBox(height: 14),
              Row(children: [
                _SpanButton(label: 'Week', selected: c.span == HistorySpan.week, onTap: () => c.setSpan(HistorySpan.week)),
                const SizedBox(width: 8),
                _SpanButton(label: 'Month', selected: c.span == HistorySpan.month, onTap: () => c.setSpan(HistorySpan.month)),
              ]),
              const SizedBox(height: 14),
              if (failure != null)
                AttendanceFailureNotice(failure: failure, onRetry: c.refresh)
              else if (c.loading)
                const Padding(padding: EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator()))
              else ...[
                _SummaryCard(summary: c.summary, span: c.span),
                const SizedBox(height: 12),
                for (final day in c.days) ...[
                  _DayCard(day: day, photoUrl: photoUrl),
                  const SizedBox(height: 10),
                ],
              ],
            ]),
          );
        },
      );
}

class _SpanButton extends StatelessWidget {
  const _SpanButton({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: selected ? WmColors.text : Colors.white,
        shape: StadiumBorder(side: BorderSide(color: selected ? WmColors.text : WmColors.border)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 9),
            child: Text(label,
                style: TextStyle(fontWeight: FontWeight.w700, color: selected ? Colors.white : WmColors.textSecondary)),
          ),
        ),
      );
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.summary, required this.span});
  final HistorySummary summary;
  final HistorySpan span;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: WmColors.border),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(daysWorked(summary.daysWorked), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
              Text(span == HistorySpan.week ? 'this week' : 'this month',
                  style: const TextStyle(fontSize: 13.5, color: WmColors.textMuted)),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(formatMinutes(summary.totalMinutes),
                style: const TextStyle(fontFamily: 'IBM Plex Mono', fontSize: 22, fontWeight: FontWeight.w700)),
            const Text('total', style: TextStyle(fontSize: 13.5, color: WmColors.textMuted)),
          ]),
        ]),
      );
}

/// A finished day shows its hours; an open one "Working"; one an admin
/// closed without a Time Out, "Not closed".
Widget? _dayPill(AttendanceRecord r) => switch (r.status) {
      AttendanceStatus.working => const StatusPill.green('Working'),
      AttendanceStatus.abandoned => const StatusPill.brown('Not closed'),
      _ when r.totalMinutes != null => StatusPill.green(formatMinutes(r.totalMinutes)),
      _ => null,
    };

class _DayCard extends StatelessWidget {
  const _DayCard({required this.day, required this.photoUrl});
  final HistoryDay day;
  final PhotoUrl photoUrl;

  @override
  Widget build(BuildContext context) {
    final heading = dayHeading(day.date);
    final record = day.record;
    if (record == null) {
      // A filled block, not an empty card: it reads as a gap in the list.
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(color: WmColors.vacant, borderRadius: BorderRadius.circular(18)),
        child: Row(children: [
          Text(heading, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: WmColors.textMuted)),
          const Spacer(),
          const Text('No record', style: TextStyle(fontSize: 14, color: WmColors.textDisabled)),
        ]),
      );
    }
    final open = record.status == AttendanceStatus.working;
    final timeOutAt = record.timeOutAt;
    final pill = _dayPill(record);
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        // The open day wears a green edge: it is the one still in play.
        border: Border.all(color: open ? WmColors.greenBorder : WmColors.border, width: open ? 1.5 : 1),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(heading, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          if (record.pending) ...[const StatusPill.brown('Not sent yet'), const SizedBox(width: 6)],
          if (pill != null) pill,
        ]),
        const SizedBox(height: 11),
        _LegRow(
          label: 'Time In',
          icon: Icons.south_west,
          accent: WmColors.green,
          time: record.timeInAt,
          project: record.timeInProjectName,
          photoPath: record.timeInPhotoPath,
          heading: heading,
          photoUrl: photoUrl,
        ),
        const SizedBox(height: 8),
        _LegRow(
          label: 'Time Out',
          icon: Icons.north_east,
          accent: WmColors.brown,
          time: timeOutAt,
          // A leg that has not happened must not name a place.
          project: timeOutAt == null ? null : record.timeOutProjectName,
          photoPath: record.timeOutPhotoPath,
          heading: heading,
          photoUrl: photoUrl,
        ),
      ]),
    );
  }
}

class _LegRow extends StatelessWidget {
  const _LegRow({
    required this.label,
    required this.icon,
    required this.accent,
    required this.time,
    required this.project,
    required this.photoPath,
    required this.heading,
    required this.photoUrl,
  });

  final String label;
  final IconData icon;
  final Color accent;
  final DateTime? time;
  final String? project;
  final String? photoPath;
  final String heading;
  final PhotoUrl photoUrl;

  @override
  Widget build(BuildContext context) {
    final t = time;
    final place = project;
    final path = photoPath;
    return Row(children: [
      Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(color: t != null ? accent.withValues(alpha: 0.12) : WmColors.canvas, shape: BoxShape.circle),
        child: Icon(icon, size: 18, color: t != null ? accent : WmColors.textFaint),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: TextStyle(fontSize: 13, color: t != null ? WmColors.textSecondary : WmColors.textDisabled)),
          Text(
            t != null ? clockTime(t) : 'not yet',
            style: t != null
                ? const TextStyle(fontFamily: 'IBM Plex Mono', fontSize: 15, fontWeight: FontWeight.w700)
                : const TextStyle(fontSize: 14, color: WmColors.textDisabled),
          ),
          if (place != null) Text(place, style: const TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
        ]),
      ),
      if (path != null)
        _Thumb(path: path, photoUrl: photoUrl, heading: heading, caption: t == null ? label : '$label · ${clockTime(t)}'),
    ]);
  }
}

/// A photo thumbnail, its link resolved once as the card is built — so a
/// month of history costs only the days the worker scrolls past.
class _Thumb extends StatefulWidget {
  const _Thumb({required this.path, required this.photoUrl, required this.heading, required this.caption});
  final String path;
  final PhotoUrl photoUrl;
  final String heading;
  final String caption;

  @override
  State<_Thumb> createState() => _ThumbState();
}

class _ThumbState extends State<_Thumb> {
  late Future<String?> _url = widget.photoUrl(widget.path);

  @override
  void didUpdateWidget(covariant _Thumb old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path) _url = widget.photoUrl(widget.path);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<String?>(
        future: _url,
        builder: (context, snapshot) {
          final url = snapshot.data;
          final box = ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 52,
              height: 52,
              child: url == null
                  ? const ColoredBox(color: WmColors.canvas, child: Icon(Icons.photo_outlined, color: WmColors.textFaint))
                  : Image.network(url, fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: WmColors.canvas)),
            ),
          );
          if (url == null) return box;
          return InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => PhotoViewer(image: NetworkImage(url), heading: widget.heading, caption: widget.caption),
            )),
            child: box,
          );
        },
      );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/attendance/history` → PASS. Then `flutter test` and `flutter analyze` → clean.

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 8: Wire it into the app

**Files:**
- Create: `lib/attendance/attendance_services.dart`
- Modify (replace): `lib/ui/home_shell.dart`, `lib/main.dart`
- Modify: `lib/app.dart`, `pubspec.yaml` (version), `README.md`, `test/ui/screens_test.dart`

**Interfaces:**
- Consumes: everything above; `AttendanceRepository`, `AttendancePhotos.supabase`, `openDeviceAttendanceDb`, `SupabaseAttendanceRemote`, `AttendanceSyncHost`, `syncWith`, `WorkmanagerUploadScheduler`, `ClockAnchorStore.now`, `MethodChannelDeviceBridge` (0C-1/Task 1); `Ready` (`app_controller.dart`).
- Produces: `class AttendanceServices { const AttendanceServices({required AttendanceApi attendance, required DeviceBridge device, required UploadScheduler scheduler, required Future<DateTime?> Function() trustedNow, required Future<String?> Function(String? path) photoUrl, required Future<void> Function(SettingsRoute route) openSettings, CameraStepBuilder cameraStep = realCameraStep}); }`; `HomeShell({required worker, required versionName, required onSignOut, required AttendanceServices services})`; `WorkMateApp({..., required AttendanceServices attendance, VoidCallback? onResumed})`.

- [ ] **Step 1: Write the failing test**

In `test/ui/screens_test.dart`: add the imports

```dart
import 'package:workmate/attendance/attendance_services.dart';

import '../attendance/fakes.dart';
```

and replace the test `'home greets the worker and says Attendance is still in the old app'` with:

```dart
  AttendanceServices fakeServices() => AttendanceServices(
        attendance: FakeAttendance(),
        device: FakeDevice(),
        scheduler: FakeScheduler(),
        trustedNow: () async => null,
        photoUrl: (_) async => null,
        openSettings: (_) async {},
        cameraStep: (context, args) => const Text('camera'),
      );

  Future<void> showShell(WidgetTester tester) async {
    useTallPhone(tester);
    await tester.pumpWidget(wrap(HomeShell(
      worker: const WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42),
      versionName: '0.2.0',
      onSignOut: () async {},
      services: fakeServices(),
    )));
    await tester.pumpAndSettle();
  }

  testWidgets('home greets the worker and offers Time In, with History and Profile tabs', (tester) async {
    await showShell(tester);
    expect(find.text('Juan dela Cruz'), findsOneWidget);
    expect(find.text('Mason · W-0042'), findsOneWidget);
    expect(find.byKey(const Key('hero-time-in')), findsOneWidget);
    expect(find.text('History'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
    expect(find.textContaining('DACS Attendance'), findsNothing);
  });

  testWidgets('Time In opens the flow full screen, and Back returns home', (tester) async {
    await showShell(tester);
    await tester.tap(find.byKey(const Key('hero-time-in')));
    await tester.pumpAndSettle();
    expect(find.text('Which project today?'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    await tester.tap(find.byKey(const Key('flow-back')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('hero-time-in')), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets('the History tab shows the worker\'s days', (tester) async {
    await showShell(tester);
    await tester.tap(find.text('History'));
    await tester.pumpAndSettle();
    expect(find.text('My attendance'), findsOneWidget);
  });

  testWidgets('Profile keeps Log out and the version', (tester) async {
    await showShell(tester);
    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    expect(find.text('Log out'), findsOneWidget);
    expect(find.textContaining("DAC'S WorkMate 0.2.0"), findsOneWidget);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `flutter test test/ui/screens_test.dart`
Expected: FAIL — `attendance_services.dart` does not exist; `HomeShell` has no `services`.

- [ ] **Step 3: Implement**

`lib/attendance/attendance_services.dart`:

```dart
import 'package:flutter/widgets.dart';

import 'data/attendance_api.dart';
import 'device/device_bridge.dart';
import 'flow/camera_step.dart';
import 'flow/time_flow_screen.dart';
import 'sync/upload_scheduler.dart';
import 'ui/attendance_copy.dart';

/// The real camera step (tests pass a fake builder instead).
Widget realCameraStep(BuildContext context, CameraStepArgs args) => CameraStep(args: args);

/// Everything the attendance screens need, built once in main.dart.
class AttendanceServices {
  const AttendanceServices({
    required this.attendance,
    required this.device,
    required this.scheduler,
    required this.trustedNow,
    required this.photoUrl,
    required this.openSettings,
    this.cameraStep = realCameraStep,
  });

  final AttendanceApi attendance;
  final DeviceBridge device;
  final UploadScheduler scheduler;

  /// The time the worker cannot change (0078), or null when it cannot vouch.
  final Future<DateTime?> Function() trustedNow;

  /// A link for one stored photo, or null.
  final Future<String?> Function(String? path) photoUrl;

  /// The app's permission page, or the phone's Location switch.
  final Future<void> Function(SettingsRoute route) openSettings;

  final CameraStepBuilder cameraStep;
}
```

Replace `lib/ui/home_shell.dart` with:

```dart
import 'package:flutter/material.dart';

import '../attendance/attendance_services.dart';
import '../attendance/domain/work_date.dart';
import '../attendance/flow/time_flow_controller.dart';
import '../attendance/flow/time_flow_screen.dart';
import '../attendance/history/history_controller.dart';
import '../attendance/history/history_screen.dart';
import '../attendance/home/home_controller.dart';
import '../attendance/home/home_screen.dart';
import '../attendance/ui/attendance_copy.dart';
import '../auth/worker_profile.dart';
import 'theme.dart';
import 'worker_header.dart';

/// The signed-in app: Home, History and Profile, and the four-step Time In /
/// Time Out flow launched from Home. The flow is MODAL (no tabs while
/// recording). Requests and Work tabs arrive with Stage 1.
class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.worker,
    required this.versionName,
    required this.onSignOut,
    required this.services,
  });

  final WorkerProfile worker;
  final String versionName;
  final Future<void> Function() onSignOut;
  final AttendanceServices services;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _tab = 0;
  TimeFlowController? _flow;
  Bilingual? _exitNotice;
  late final HomeController _home;
  late final HistoryController _history;

  @override
  void initState() {
    super.initState();
    final s = widget.services;
    _home = HomeController(attendance: s.attendance, scheduler: s.scheduler);
    _history = HistoryController(attendance: s.attendance);
    WidgetsBinding.instance.addObserver(this);
    _home.refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _flow?.dispose();
    _home.dispose();
    _history.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back in the app is when a worker can see "Not sent yet": re-read today and
    // send what waits. Not while recording — the camera's permission prompts
    // pause and resume the app too.
    if (state == AppLifecycleState.resumed && _flow == null) _home.refresh();
  }

  void _startFlow(TimeDirection direction) {
    final s = widget.services;
    setState(() {
      _exitNotice = null;
      _flow = TimeFlowController(direction: direction, attendance: s.attendance, device: s.device, trustedNow: s.trustedNow)
        ..loadProjects();
    });
  }

  void _endFlow({Bilingual? notice}) {
    final ended = _flow;
    setState(() {
      _flow = null;
      _exitNotice = notice;
    });
    // After this frame: the flow screen listens to it until it is gone.
    WidgetsBinding.instance.addPostFrameCallback((_) => ended?.dispose());
    _home.refresh();
  }

  void _cancelled(FlowExit? reason) {
    final flow = _flow;
    if (flow == null) return;
    flow.abandon();
    // Landing on an unchanged Home with no word about why is how a worker
    // concludes the app lost their Time In.
    _endFlow(notice: reason == FlowExit.cameraPermission ? flowCancelledByCamera(flow.direction) : null);
  }

  void _selectTab(int tab) {
    setState(() => _tab = tab);
    if (tab == 1) _history.refresh();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.services;
    final flow = _flow;
    if (flow != null) {
      return TimeFlowScreen(
        key: ObjectKey(flow),
        controller: flow,
        cameraStep: s.cameraStep,
        onFinished: _endFlow,
        onCancelled: _cancelled,
        openSettings: s.openSettings,
      );
    }
    final body = switch (_tab) {
      0 => HomeScreen(
          worker: widget.worker,
          controller: _home,
          onStartFlow: _startFlow,
          onSeeHistory: () => _selectTab(1),
          openSettings: s.openSettings,
          exitNotice: _exitNotice,
          onDismissExit: () => setState(() => _exitNotice = null),
        ),
      1 => HistoryScreen(controller: _history, photoUrl: s.photoUrl),
      _ => _ProfileTab(worker: widget.worker, versionName: widget.versionName, onSignOut: widget.onSignOut),
    };
    return Scaffold(
      body: SafeArea(child: body),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: _selectTab,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.history), label: 'History'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
  }
}

/// 0B's profile, unchanged; password change and the rest arrive in 0D.
class _ProfileTab extends StatelessWidget {
  const _ProfileTab({required this.worker, required this.versionName, required this.onSignOut});
  final WorkerProfile worker;
  final String versionName;
  final Future<void> Function() onSignOut;

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(20), children: [
        const Text('Profile', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
        const SizedBox(height: 16),
        WorkerHeader(worker: worker),
        const SizedBox(height: 24),
        OutlinedButton.icon(onPressed: onSignOut, icon: const Icon(Icons.logout), label: const Text('Log out')),
        const SizedBox(height: 16),
        Text("DAC'S WorkMate $versionName · By Dacs Building Design Services",
            style: const TextStyle(fontSize: 12.5, color: WmColors.textMeta)),
      ]);
}
```

In `lib/app.dart`:
1. Add `import 'attendance/attendance_services.dart';`.
2. Add constructor parameters `required this.attendance,` and `this.onResumed,` and the fields:

```dart
  /// The attendance engine and its device services, for the signed-in app.
  final AttendanceServices attendance;

  /// Runs on every return to the app (main.dart re-registers the sync host).
  final VoidCallback? onResumed;
```

3. Replace `didChangeAppLifecycleState` with:

```dart
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      widget.controller.checkForUpdate();
      widget.onResumed?.call();
    }
  }
```

4. Change the `Ready` arm to:

```dart
              Ready(:final worker) => HomeShell(
                  worker: worker,
                  versionName: widget.versionName,
                  onSignOut: c.signOut,
                  services: widget.attendance,
                ),
```

Replace `lib/main.dart` with:

```dart
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import 'app.dart';
import 'app_controller.dart';
import 'attendance/attendance_services.dart';
import 'attendance/data/attendance_db.dart';
import 'attendance/data/attendance_photos.dart';
import 'attendance/data/attendance_remote.dart';
import 'attendance/data/attendance_repository.dart';
import 'attendance/device/clock_anchor_store.dart';
import 'attendance/device/device_bridge.dart';
import 'attendance/sync/background_sync.dart';
import 'attendance/sync/sync_host.dart';
import 'attendance/sync/upload_scheduler.dart';
import 'attendance/ui/attendance_copy.dart';
import 'auth/auth_backend.dart';
import 'auth/auth_repository.dart';
import 'auth/session_storage.dart';
import 'auth/sign_in_api.dart';
import 'auth/worker_cache.dart';
import 'net/supabase_setup.dart';
import 'net/update_nudges.dart';
import 'net/workmate_http_client.dart';
import 'terms/terms_repository.dart';
import 'update/apk_installer.dart';
import 'update/app_update_repository.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final info = await PackageInfo.fromPlatform();
  final versionCode = int.parse(info.buildNumber);
  final android = await DeviceInfoPlugin().androidInfo;
  final userAgent =
      'DacsWorkMate/${info.version} (Android ${android.version.release}; ${android.manufacturer} ${android.model})';

  final prefs = await SharedPreferences.getInstance();
  final nudges = UpdateNudges();
  final device = MethodChannelDeviceBridge();
  final clockAnchors = ClockAnchorStore(prefs, device);
  final httpClient = WorkMateHttpClient(
    versionCode: versionCode,
    nudges: nudges,
    // Every server answer re-anchors the tamper-proof clock (0078). Never let
    // a failure here fail the request itself.
    onServerDate: (date) => clockAnchors.recordServerDate(date).catchError((_) {}),
  );
  final sessionStorage = WorkMateSessionStorage(secure: SecureBox(), plain: prefs);

  final client = await initWorkMateSupabase(httpClient: httpClient, localStorage: sessionStorage);

  // The live app is the one token refresher: background tasks delegate here.
  // Registered again on every resume (a slow answer can drop the mapping).
  final syncHost = AttendanceSyncHost(drain: () => syncWith(client))..register();

  // Background sending of queued Time Ins / Time Outs. The sweeper is the
  // backstop for a row whose enqueue never happened. The app must start even
  // if background setup fails.
  final scheduler = WorkmanagerUploadScheduler();
  try {
    await Workmanager().initialize(attendanceCallbackDispatcher);
    await scheduler.ensureSweeper();
  } catch (e) {
    debugPrint('Background sync setup failed: $e');
  }

  final cache = WorkerCache(prefs);
  final updates = AppUpdateRepository(
    source: SupabaseReleaseSource(client),
    prefs: prefs,
    installedVersionCode: versionCode,
    download: http.Client(),
    cacheDir: getTemporaryDirectory,
  );

  late final AppController controller;
  final attendance = AttendanceRepository(
    db: await openDeviceAttendanceDb(),
    remote: SupabaseAttendanceRemote(client),
    device: device,
    scheduler: scheduler,
    // The worker the app let in (eligible, Terms accepted); nobody otherwise.
    currentWorkerId: () => switch (controller.state) {
      Ready(:final worker) => worker.id,
      _ => '',
    },
    photoDir: () async =>
        Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}attendance-photos'),
  );
  controller = AppController(
    auth: AuthRepository(api: SignInApi(httpClient), backend: SupabaseAuthBackend(client, sessionStorage), cache: cache),
    terms: TermsRepository(backend: SupabaseTermsBackend(client), cache: cache, userAgent: userAgent),
    updates: updates,
    nudges: nudges.events,
  );

  final photos = AttendancePhotos.supabase(client);
  final services = AttendanceServices(
    attendance: attendance,
    device: device,
    scheduler: scheduler,
    trustedNow: clockAnchors.now,
    photoUrl: photos.signedUrl,
    openSettings: (route) async {
      try {
        if (route == SettingsRoute.locationSwitch) {
          await device.openLocationSettings();
        } else {
          await openAppSettings();
        }
      } catch (e) {
        debugPrint('Could not open Settings: $e');
      }
    },
  );

  runApp(WorkMateApp(
    controller: controller,
    updates: updates,
    installer: ApkInstaller(),
    versionName: info.version,
    attendance: services,
    onResumed: syncHost.register,
  ));
}
```

In `pubspec.yaml` set `version: 0.2.0+1002`.

In `README.md`, add after the "Build" section:

```markdown
## Attendance (Stage 0C)

Time In and Time Out live in WorkMate: the four-step flow (project, photo, check, describe), Home and History,
with the same rules and words as DACS Attendance.

- Camera and location permission are asked for together at the photo step. A refused location refuses the
  Time In with an Open Settings button; Location switched off refuses it with a button to the phone's
  Location switch.
- Photos are taken in the app only (no gallery), front camera by default, filed mirrored as previewed, with
  the project, date and time burned in.
- A Time In made with no signal says "Not sent yet" and sends itself when signal returns, even after the app
  is closed.
```

- [ ] **Step 4: Run all checks**

Run: `flutter test` → all pass. `flutter analyze` → `No issues found!`. `flutter build apk --debug` → builds.

- [ ] **Step 5: Checkpoint**

Report `git status --short`. Do not commit.

---

### Task 9: Dacs Web — record the live-only photo-replace policy (migration 0083)

**Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs Web`.

**Files:**
- Create: `supabase/migrations/0083_attendance_photo_replace_policy.sql`
- Modify: `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md`

**Why:** both worker apps upload attendance photos with `upsert`, so re-sending a photo after a failed Time In RPC is an UPDATE of `storage.objects`. The policy that allows it, `attendance: worker replaces own photo`, exists in the live database (found 2026-09-30) but in no migration, and `DATABASE_SCHEMA.md` says the opposite ("no `update` policy, write-once"). A database rebuilt from migrations would turn every such retry into a permanent failure. Applying this migration live changes nothing: it only creates the policy when it is missing.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0083_attendance_photo_replace_policy.sql`:

```sql
-- 0083: record the storage policy that lets a worker REPLACE their own attendance photo.
--
-- Both worker apps (DACS Attendance and DAC'S WorkMate) upload with upsert=true, so a
-- retry after a failed Time In / Time Out RPC overwrites the same object path -- an UPDATE
-- on storage.objects. This policy existed only in the live database (found 2026-09-30);
-- 0050 created INSERT and SELECT only. Applying this file live is a no-op.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'attendance: worker replaces own photo'
  ) then
    create policy "attendance: worker replaces own photo" on storage.objects
      for update to authenticated
      using (bucket_id = 'attendance' and (storage.foldername(name))[1] = (auth.uid())::text)
      with check (bucket_id = 'attendance' and (storage.foldername(name))[1] = (auth.uid())::text);
  end if;
end $$;
```

- [ ] **Step 2: Document it**

In `supabase/migrations/README.md`, add after the paragraph that starts with `**0081 (uploads access repair)**`:

```markdown
**0083 (attendance photo replace policy)** records `attendance: worker replaces own photo` (UPDATE on
`storage.objects`, bucket `attendance`, first folder = the worker's own id), which existed only in the live
database. Both worker apps upload with `upsert`, so re-sending a photo after a failed Time In RPC is an
UPDATE; without the policy a database rebuilt from migrations would refuse every such retry forever. The
file creates the policy only when it is missing, so applying it live changes nothing.
```

In `docs/DATABASE_SCHEMA.md`, replace the storage paragraph under `### Storage` (the one starting "Private bucket `attendance`") with:

```markdown
Private bucket `attendance`, path `{worker_id}/{work_date}/{in|out}-{event_id}.jpg`. Worker policies
are scoped to their own uuid prefix. A worker may **replace** their own photo (`attendance: worker
replaces own photo`, UPDATE, recorded in `0083` after it was found live-only): both worker apps upload
with `upsert`, so a retry after a failed Time In RPC overwrites the same path. There is **no `delete`
policy**. Photos are files, never base64.
```

- [ ] **Step 3: Verify the repo's own checks**

Run (in Dacs Web): `npm test` → all suites pass (nothing here touches money code; this proves nothing else broke).

- [ ] **Step 4: Checkpoint — the user applies it**

Report `git status --short` for Dacs Web. Do not commit. The user applies 0083 the way they applied 0082; afterwards the controller verifies with:

```sql
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname = 'attendance: worker replaces own photo';
```

Expected: one row, `UPDATE` (it was already there; the point is that it is now in a migration).

---

### Task 10: On a real phone (with the user)

Nothing here is code. The user runs these on the Xiaomi test phone with a **test worker account** assigned to a test project (real attendance rows are created on the live database; the owner removes them afterwards in Dacs Web → Attendance, or asks Claude for a reviewed cleanup query). adb: `C:\Android\Sdk\platform-tools\adb.exe`.

- [ ] **Step 1: Build and install the debug app**

```powershell
flutter build apk --debug
& "C:\Android\Sdk\platform-tools\adb.exe" install -r build\app\outputs\flutter-apk\app-debug.apk
```

- [ ] **Step 2: Walk the checklist and record each result**

| # | Check | Pass when |
|---|---|---|
| 1 | Sign in as the test worker | Home shows the name, today's date (Manila) and the green **Time In** card |
| 2 | Tap Time In | Project list loads; NEXT is disabled until a project is picked |
| 3 | Camera step, first time | ONE system prompt sequence asks for camera and location; the front camera preview shows, mirrored, with the project/date/time caption chip and the face oval |
| 4 | Switch camera | Back camera shows; switching back works |
| 5 | Shutter → check photo | The photo is **upright** and looks like the preview (mirrored for the front camera) |
| 6 | Describe → chip + typed note → SUBMIT TIME IN | "All done!" with time, date, project, note, "Saved on your phone" |
| 7 | Back to Home | "Timed in at …", hours counting, "Not sent yet" turns to "Saved" within a minute or two (pull down to refresh) |
| 8 | Dacs Web admin → Attendance | The record is there; the photo is upright, mirrored like the preview, caption burned in |
| 9 | Time Out (brown) | Same flow in brown; confirmation shows Total hours; Home shows "Day complete" |
| 10 | Airplane mode, then Time In (next day or a second test worker) | "All done!" offline; Home says "Not sent yet" |
| 11 | Swipe the app away, turn signal on, wait ~5–15 min | The record and photo reach the server without opening the app |
| 12 | A mock-location app on | SUBMIT is refused with the bilingual fake-location text, no TRY AGAIN |
| 13 | Location switched off | Refused with "Turn on Location…"; **Open Settings** opens the phone's Location switch; turning it on and **TRY AGAIN** succeeds |
| 14 | Deny the camera (and "don't ask again") | The step shows "The camera is needed…" with Open Settings and "Not now"; Not now → Home explains the Time In was not recorded |
| 15 | History | Week and Month show days with gaps, times, pills; a thumbnail opens the full-screen PROOF viewer |
| 16 | Leave the app closed overnight (expired session), next morning open it | Still signed in (the background sweeper did not sign the worker out) |

- [ ] **Step 3: Release build (only after every row passes)**

The user runs `flutter build apk --release` (it needs `android/keystore.properties`) and decides when to publish 0.2.0 (1002) from Dacs Web → App Updates. Publishing makes it required for every WorkMate phone; moving workers off DACS Attendance is Stage 0E, not this plan.

---

## Self-review notes

- Spec §3 parity rows covered: Time In / Time Out flow (Tasks 3–5), photos with overlay and orientation (Tasks 1, 4, 5, device rows 5 and 8), location checks and the two settings routes (Tasks 2–4, rows 12–13), offline attendance and background sending (row 10–11, engine from 0C-1), today reconcile and history (Tasks 6–7).
- 0C-1 carry-overs closed here: runtime location permission (Task 5), sync-host re-registration on resume (Task 8), the storage-policy migration (Task 9), and every device check (Task 10). Still deferred to 0D: sweeper-only re-enqueue, `last_error` first line, `Error.throwWithStackTrace`, a transaction around queue insert + mirror write.
- Deliberate differences from DACS Attendance: Home lists submissions the server refused for good (the old app never told the worker); the camera give-up notice names Time Out when it was a Time Out. Both copy lines are marked NEW in `attendance_copy.dart`.
- `CameraStep` has no widget test (the plugins do not run under `flutter test`); it is covered by analyze, the debug build and device rows 3–5 and 14.
