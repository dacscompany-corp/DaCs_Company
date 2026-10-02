# WorkMate Stage 0D — Attendance Extras Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WorkMate gains the four parity rows still missing after 0C — the weekly reward strip, the home-screen widget (glance + one-tap Time In / Time Out), the Profile screen with password change and the accepted Terms, and the greeting — plus Home refreshing itself when a background send lands.

**Architecture:** Every rule is a pure Dart (or, for the widget's drawing, pure Kotlin) function ported from DACS Attendance with its Kotlin unit tests as the acceptance cases. The widget is drawn natively with `RemoteViews` from a small *snapshot* the app pushes after every change to today; a tiny in-repo Flutter plugin (`packages/workmate_widget_bridge`) carries that push so WorkManager's background engine can update the widget too. A widget tap launches `MainActivity` with an extra; Dart takes it and opens the flow only when Home agrees (`resolveStartFlow`).

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, supabase_flutter 2.17.2, sqflite 2.4.2+1 (tests: sqflite_common_ffi), Kotlin 2.2.20 / AGP 8.11.1 / JUnit 4.13.2, Android `AppWidgetProvider` + `RemoteViews` (no Glance, no Compose).

**Spec:** `docs/superpowers/specs/2026-09-29-unified-worker-app-design.md` (§1 parity, Profile row in the screen table) and the roadmap `docs/superpowers/plans/2026-09-29-workmate-stage0-roadmap.md` (row **0D**, parity checklist rows *Weekly reward*, *Home-screen widget*, *In-app update + version gate*, *Password change, greeting*).

**Behaviour reference (read-only):** `C:\Users\John Aerol Tapales\Documents\Dacs Attendance\app\src\` — Kotlin sources under `main/java/com/dacs/attendance/`, tests under `test/java/com/dacs/attendance/`, copy in `main/res/values/strings.xml`.

## Global Constraints

- **Repo:** all paths below are relative to `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate` unless they start with `Dacs Web/`. Run every command from that folder.
- **NEVER run `git commit` or `git push`.** The user commits. Each task ends with a "Stop — no commit" step: leave the changes in the working tree.
- **Line endings LF**, matching the existing files.
- **No new pub.dev dependencies.** The only new dependency is the local path plugin `packages/workmate_widget_bridge` (Task 10). `permission_handler` stays pinned at **12.0.1** (13.x needs AGP 9). Do not bump any pinned version.
- **Android:** `minSdk` stays **24** and the app has **no core-library desugaring**, so app Kotlin code must **not use `java.time`** (unit tests run on the desktop JVM and may). JDK 21 for Gradle: `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"`.
- **Copy rule:** screen copy is **English**; failure copy is **bilingual (English, then Tagalog)**, quoted **exactly** from DACS Attendance `strings.xml` (quoted in each task). A raw server/HTTP string never reaches the screen.
- **Time:** every date or hour a worker sees is **Manila time** (UTC+8, fixed offset, `lib/attendance/domain/work_date.dart`). Never the phone's zone; never `toIso8601String().substring(0, 10)` for a local date.
- **The widget never shows who:** no name, no project, no photo (a site phone lies on a table in front of everyone).
- **Reward rules must match migration 0066** (`attendance_week_days`): port `WeeklyReward.kt` exactly; do not "improve" a rule.
- **Database:** 0D needs **no migration**. Verified live on 2026-10-02: `attendance_reward_progress(p_worker uuid, p_week_start date)` returns `(work_date date, required boolean, timein_at timestamptz, start_time time, day_status text)`; `attendance_config.reward_amount numeric` is readable by workers (`is_worker()` = `worker` or `teamLeader`, scoped to `attendance_data_owner()`); `attendance_terms_acceptances` has `accepted_at timestamptz not null`.
- **Version:** this stage ships as **`0.3.0+1003`** (versionCode must stay ≥ 1000 and rise every release) — bumped in Task 12 only.
- **Verification commands:** `flutter analyze` (expect "No issues found!"), `flutter test` (all pass), Kotlin: `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location` (expect `BUILD SUCCESSFUL`).

## Already at parity (no task)

- **Update nudges.** `lib/net/update_nudges.dart` is the port of `data/remote/UpdateNudges.kt`: `WorkMateHttpClient` fires it on `APP_UPDATE_REQUIRED` and `AppController` re-checks (0B). Task 12's checklist re-confirms it on the phone.

## File map

| File | Task | Responsibility |
|---|---|---|
| `lib/attendance/domain/weekly_reward.dart` | 1 | Reward rules (port of `WeeklyReward.kt`) |
| `lib/attendance/data/reward_remote.dart` | 2 | `RewardApi` + Supabase reads (RPC, `attendance_config`) |
| `lib/attendance/home/home_controller.dart` | 2, 8 | Reward state; `refresh(sendQueued:)` |
| `lib/attendance/domain/greeting.dart` | 3 | Greeting by Manila hour |
| `lib/attendance/home/home_screen.dart` | 3 | Greeting line + reward strip |
| `lib/attendance/ui/formats.dart` | 3 | `pesos()` |
| `lib/attendance/attendance_services.dart` | 3, 8 | `rewards`, `queueSettled` |
| `lib/profile/password_change.dart` | 4 | Password rules + bilingual failures |
| `lib/auth/auth_backend.dart`, `lib/auth/auth_repository.dart` | 5 | `changePassword` |
| `lib/terms/terms_repository.dart`, `lib/auth/worker_cache.dart` | 5 | Terms `acceptedAt` (cache first) |
| `lib/profile/account_services.dart` | 6 | What Profile needs from the account |
| `lib/profile/profile_screen.dart`, `lib/profile/change_password_sheet.dart` | 6 | Profile + password sheet |
| `lib/ui/terms_screen.dart` | 6 | Shared clause list + read-only `TermsReaderScreen` |
| `lib/ui/home_shell.dart`, `lib/app.dart`, `lib/main.dart` | 3, 6, 7, 8, 11 | Wiring |
| `lib/widget/widget_snapshot.dart`, `widget_bridge.dart`, `widget_publisher.dart`, `widget_aware_attendance.dart`, `widget_app_sync.dart` | 7 | What the widget is told, and when |
| `lib/attendance/sync/submission_sync.dart`, `background_sync.dart`, `queue_settled.dart` | 8 | Background sends update the widget and Home |
| `android/app/src/main/kotlin/com/dacs/workmate/widget/WidgetRules.kt` | 9 | Pure widget rules (port of `WidgetState.kt`, `WidgetCard.kt`, `typeScale`) |
| `android/app/src/main/res/values/widget_strings.xml` | 9 | Widget copy |
| `android/app/src/main/kotlin/com/dacs/workmate/widget/TimeWidgetProvider.kt` + layouts/drawables/xml | 10 | Drawing the widget |
| `packages/workmate_widget_bridge/**` | 10 | Plugin: snapshot push from any engine |
| `android/app/src/main/kotlin/com/dacs/workmate/MainActivity.kt` | 11 | Start-flow extra → Dart |
| `lib/widget/start_flow.dart` | 11 | `resolveStartFlow` + inbox + launch channel |

---

### Task 1: Weekly reward rules

**Files:**
- Create: `lib/attendance/domain/weekly_reward.dart`
- Test: `test/attendance/domain/weekly_reward_test.dart`

**Interfaces:**
- Consumes: `isoDate(DateTime)` from `lib/attendance/domain/work_date.dart`.
- Produces (used by Tasks 2–3): `enum RewardDayStatus { onTime, late, missing, notRequired, unverified, unknown }` with `static RewardDayStatus parse(String?)`; `enum RewardStatus { inProgress, qualified, disqualified }`; `class RewardDay({required DateTime date, required bool required, required RewardDayStatus status})`; `enum RewardCellState { onTime, late, missing, notRequired, unverified, pending }`; `class RewardCell({date, label, state, isToday})`; `class RewardSummary({requiredDays, onTimeDays, lateDays, missingDays, unverifiedDays, pendingDays, completedDays, status})`; `DateTime rewardWeekStart(DateTime date)`; `List<DateTime> rewardWeekDates(DateTime weekStart)`; `RewardSummary rewardSummary(List<RewardDay> days, DateTime today)`; `List<RewardCell> rewardCells(DateTime weekStart, List<RewardDay> days, DateTime today)`. **All dates are calendar dates as UTC midnights** (the package convention, see `manilaDate`).

- [ ] **Step 1: Write the failing test** — the 18 cases of `WeeklyRewardTest.kt`, ported.

```dart
// test/attendance/domain/weekly_reward_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/weekly_reward.dart';

/// Ported from DACS Attendance WeeklyRewardTest.kt. These must stay in step
/// with 0066's attendance_week_days: if the two disagree, the reward a worker
/// was shown all week is not the reward they get.
void main() {
  // 2026-09-07 is a Monday; the reward week runs to Friday the 11th.
  final monday = DateTime.utc(2026, 9, 7);
  final tuesday = DateTime.utc(2026, 9, 8);
  final wednesday = DateTime.utc(2026, 9, 9);
  final thursday = DateTime.utc(2026, 9, 10);
  final friday = DateTime.utc(2026, 9, 11);

  RewardDay day(DateTime date, RewardDayStatus status, {bool required = true}) =>
      RewardDay(date: date, required: required, status: status);

  List<RewardDay> fullWeek(List<RewardDayStatus> statuses) {
    final dates = rewardWeekDates(monday);
    return [for (var i = 0; i < 5; i++) day(dates[i], statuses[i])];
  }

  const onTime = RewardDayStatus.onTime;
  const late = RewardDayStatus.late;
  const missing = RewardDayStatus.missing;
  const unverified = RewardDayStatus.unverified;

  test('the week starts on Monday, from any day inside it', () {
    expect(rewardWeekStart(wednesday), monday);
    expect(rewardWeekStart(monday), monday);
    // The Sunday at the end of the week still belongs to it.
    expect(rewardWeekStart(DateTime.utc(2026, 9, 13)), monday);
  });

  test('an unverified day disqualifies, but is neither late nor missing', () {
    final s = rewardSummary(fullWeek([onTime, unverified, onTime, onTime, onTime]), DateTime.utc(2026, 9, 14));
    expect(s.status, RewardStatus.disqualified);
    expect(s.unverifiedDays, 1);
    expect(s.lateDays, 0);
    expect(s.missingDays, 0);
    expect(s.completedDays, 5);
  });

  test("the server's unverified status is understood, not left as unknown", () {
    expect(RewardDayStatus.parse('unverified'), RewardDayStatus.unverified);
    final cells = rewardCells(monday, [day(tuesday, unverified)], friday);
    expect(cells[1].state, RewardCellState.unverified);
  });

  test('the reward week is five days, not the six the strip draws', () {
    final dates = rewardWeekDates(monday);
    expect(dates.length, 5);
    expect(dates.first, monday);
    expect(dates.last, friday);
  });

  test('a day later than today is pending, never missing', () {
    final s = rewardSummary(fullWeek([onTime, onTime, onTime, missing, missing]), wednesday);
    expect(s.pendingDays, 2);
    expect(s.missingDays, 0);
    expect(s.status, RewardStatus.inProgress);
  });

  test('one late day settles the week immediately', () {
    final s = rewardSummary(fullWeek([onTime, late, onTime, missing, missing]), wednesday);
    expect(s.lateDays, 1);
    expect(s.status, RewardStatus.disqualified);
  });

  test('five on-time days qualify', () {
    final s = rewardSummary(fullWeek([onTime, onTime, onTime, onTime, onTime]), friday);
    expect(s.requiredDays, 5);
    expect(s.onTimeDays, 5);
    expect(s.status, RewardStatus.qualified);
  });

  test('a closed day shrinks the week, so four of four still qualifies', () {
    final days = [
      day(monday, onTime),
      day(tuesday, onTime),
      day(wednesday, RewardDayStatus.notRequired, required: false),
      day(thursday, onTime),
      day(friday, onTime),
    ];
    final s = rewardSummary(days, friday);
    expect(s.requiredDays, 4);
    expect(s.onTimeDays, 4);
    expect(s.missingDays, 0);
    expect(s.status, RewardStatus.qualified);
  });

  test('a past day with no Time In disqualifies', () {
    final s = rewardSummary(fullWeek([onTime, missing, onTime, onTime, onTime]), friday);
    expect(s.missingDays, 1);
    expect(s.status, RewardStatus.disqualified);
  });

  test('a whole week of closed days is not a free reward', () {
    final days = [for (final d in rewardWeekDates(monday)) day(d, RewardDayStatus.notRequired, required: false)];
    final s = rewardSummary(days, friday);
    expect(s.requiredDays, 0);
    expect(s.status, RewardStatus.disqualified);
  });

  test('an unknown day status says in progress, never disqualified', () {
    final s = rewardSummary(fullWeek([onTime, onTime, RewardDayStatus.unknown, onTime, onTime]), friday);
    expect(s.status, RewardStatus.inProgress);
  });

  test('an unrecognised status string parses to unknown rather than throwing', () {
    expect(RewardDayStatus.parse('on_time'), RewardDayStatus.onTime);
    expect(RewardDayStatus.parse('not_required'), RewardDayStatus.notRequired);
    expect(RewardDayStatus.parse('excused'), RewardDayStatus.unknown);
    expect(RewardDayStatus.parse(null), RewardDayStatus.unknown);
  });

  test('the strip always draws five cells, even on a short answer', () {
    final cells = rewardCells(monday, [day(monday, onTime), day(tuesday, late)], wednesday);
    expect(cells.length, 5);
    expect(cells.map((c) => c.label), ['Mo', 'Tu', 'We', 'Th', 'Fr']);
    expect(cells[0].state, RewardCellState.onTime);
    expect(cells[1].state, RewardCellState.late);
    // Today, unrecorded: PENDING, not missed.
    expect(cells[2].state, RewardCellState.pending);
    expect(cells[3].state, RewardCellState.pending);
    expect(cells[4].state, RewardCellState.pending);
  });

  test('a closed day draws as not required, not as a miss', () {
    final cells = rewardCells(monday, [day(wednesday, RewardDayStatus.notRequired, required: false)], friday);
    expect(cells[2].state, RewardCellState.notRequired);
  });

  test('today is marked, and only today', () {
    final cells = rewardCells(monday, const [], wednesday);
    expect(cells.where((c) => c.isToday).length, 1);
    expect(cells.singleWhere((c) => c.isToday).date, wednesday);
  });

  test('a late day still counts as a day worked', () {
    final s = rewardSummary(fullWeek([late, onTime, onTime, onTime, onTime]), friday);
    expect(s.completedDays, 5);
    expect(s.status, RewardStatus.disqualified);
  });

  test('today with no Time In yet is pending, not a miss', () {
    final s = rewardSummary(fullWeek([onTime, missing, missing, missing, missing]), tuesday);
    expect(s.missingDays, 0);
    expect(s.pendingDays, 4);
    expect(s.status, RewardStatus.inProgress);
  });

  test('today draws as pending, and yesterday as missed', () {
    final cells = rewardCells(monday, [day(monday, missing), day(tuesday, missing)], tuesday);
    expect(cells[0].state, RewardCellState.missing);
    expect(cells[1].state, RewardCellState.pending);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/attendance/domain/weekly_reward_test.dart`
Expected: FAIL — `Error: Couldn't resolve the package 'workmate' ... weekly_reward.dart` / undefined names.

- [ ] **Step 3: Write the implementation**

```dart
// lib/attendance/domain/weekly_reward.dart
import 'work_date.dart';

// The weekly attendance reward, as the worker's own screen shows it. Ported
// from DACS Attendance domain/WeeklyReward.kt.
//
// NOTHING HERE IS AUTHORITATIVE. The reward that gets paid is frozen
// server-side by attendance_evaluate_week after the week ends (0066). This
// renders the week the worker is standing in, from the server's day rows, so
// the rules match 0066's attendance_week_days exactly rather than being
// re-derived.
//
// NO TIME OUT ANYWHERE: qualification reads the Time In and nothing else. A
// forgotten Time Out, or a day an admin closed, must not move anyone's money.
//
// FIVE DAYS, NOT SIX: the reward week is Monday to Friday, while Home's week
// strip draws six cells because DACs works Saturdays. Two true things, two rows.

/// A day's outcome, exactly as attendance_week_days reports it.
enum RewardDayStatus {
  onTime,
  late,
  missing,
  notRequired,

  /// A day WORKED that cannot earn the bonus (0078): a known-bad location, or
  /// a time no clock could vouch for. Not late, not missing.
  unverified,

  /// An outcome the server learned after this build shipped. Never folded
  /// into [missing]: see [rewardSummary].
  unknown;

  static RewardDayStatus parse(String? raw) => switch (raw?.toLowerCase()) {
        'on_time' => onTime,
        'late' => late,
        'missing' => missing,
        'not_required' => notRequired,
        'unverified' => unverified,
        _ => unknown,
      };
}

enum RewardStatus { inProgress, qualified, disqualified }

/// One row from attendance_reward_progress.
class RewardDay {
  const RewardDay({required this.date, required this.required, required this.status});

  /// Calendar date (UTC midnight).
  final DateTime date;
  final bool required;
  final RewardDayStatus status;
}

enum RewardCellState {
  onTime,
  late,
  missing,
  notRequired,

  /// Worked, but could not be verified (0078). Disqualifying, not a miss.
  unverified,

  /// Later this week. Nothing is wrong yet, and it must not look as if it is.
  pending,
}

class RewardCell {
  const RewardCell({required this.date, required this.label, required this.state, required this.isToday});
  final DateTime date;

  /// Two letters, matching the week strip: Mo Tu We Th Fr.
  final String label;
  final RewardCellState state;
  final bool isToday;
}

class RewardSummary {
  const RewardSummary({
    required this.requiredDays,
    required this.onTimeDays,
    required this.lateDays,
    required this.missingDays,
    required this.unverifiedDays,
    required this.pendingDays,
    required this.completedDays,
    required this.status,
  });

  final int requiredDays;
  final int onTimeDays;
  final int lateDays;
  final int missingDays;

  /// Days worked that could not be verified (0078). Disqualifying.
  final int unverifiedDays;

  /// Required days still ahead of the worker. Never counted as missed.
  final int pendingDays;

  /// Days with a Time In, on time or late. Reporting only.
  final int completedDays;
  final RewardStatus status;
}

const _labels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/// The Monday of the week [date] falls in (a Sunday belongs to the week before it).
DateTime rewardWeekStart(DateTime date) => DateTime.utc(date.year, date.month, date.day - (date.weekday - 1));

/// Monday to Friday of that week, in order.
List<DateTime> rewardWeekDates(DateTime weekStart) =>
    [for (var i = 0; i < 5; i++) DateTime.utc(weekStart.year, weekStart.month, weekStart.day + i)];

/// The week's standing, from the server's day rows.
///
/// A DAY LATER THAN TODAY IS PENDING, NEVER MISSING: the server reports a day
/// with no Time In as `missing` whether or not it has happened. Only a day
/// strictly in the PAST can be a miss; today is still winnable.
///
/// DISQUALIFICATION IS REPORTED AS SOON AS IT IS CERTAIN: one late day settles
/// the week.
///
/// AN UNKNOWN STATUS YIELDS inProgress, never disqualified: guessing would
/// show a worker a zero the database never agreed to.
RewardSummary rewardSummary(List<RewardDay> days, DateTime today) {
  var required = 0, onTime = 0, late = 0, missing = 0, unverified = 0, pending = 0, completed = 0, unknown = 0;

  for (final day in days) {
    // An unverified day (0078) was still a day worked.
    if (day.status == RewardDayStatus.onTime || day.status == RewardDayStatus.late || day.status == RewardDayStatus.unverified) {
      completed++;
    }
    if (!day.required) continue;

    required++;
    switch (day.status) {
      case RewardDayStatus.onTime:
        onTime++;
      case RewardDayStatus.late:
        late++;
      case RewardDayStatus.unverified:
        unverified++;
      case RewardDayStatus.unknown:
        unknown++;
      // A required day the server calls not_required is a contradiction:
      // counted with the ones we cannot read, never as a silent pass.
      case RewardDayStatus.notRequired:
        unknown++;
      case RewardDayStatus.missing:
        if (day.date.isBefore(today)) {
          missing++;
        } else {
          pending++;
        }
    }
  }

  final RewardStatus status;
  if (late > 0 || missing > 0 || unverified > 0) {
    status = RewardStatus.disqualified;
  } else if (unknown > 0 || pending > 0) {
    status = RewardStatus.inProgress;
  } else if (required > 0) {
    status = RewardStatus.qualified;
  } else {
    // Every day closed: nothing to be on time for, nothing to reward (0066 agrees).
    status = RewardStatus.disqualified;
  }

  return RewardSummary(
    requiredDays: required,
    onTimeDays: onTime,
    lateDays: late,
    missingDays: missing,
    unverifiedDays: unverified,
    pendingDays: pending,
    completedDays: completed,
    status: status,
  );
}

/// The five cells of the reward strip. Built from [rewardWeekDates], not from
/// [days], so an incomplete answer still draws five columns; a date with no
/// row is treated as required and unrecorded, which is what the server says.
List<RewardCell> rewardCells(DateTime weekStart, List<RewardDay> days, DateTime today) {
  final byDate = {for (final d in days) isoDate(d.date): d};
  return [
    for (final date in rewardWeekDates(weekStart))
      () {
        final day = byDate[isoDate(date)];
        final RewardCellState state;
        if (day != null && !day.required) {
          state = RewardCellState.notRequired;
        } else if (day?.status == RewardDayStatus.onTime) {
          state = RewardCellState.onTime;
        } else if (day?.status == RewardDayStatus.late) {
          state = RewardCellState.late;
        } else if (day?.status == RewardDayStatus.unverified) {
          state = RewardCellState.unverified;
        } else if (!date.isBefore(today)) {
          // Same rule as the summary: today is still running.
          state = RewardCellState.pending;
        } else {
          state = RewardCellState.missing;
        }
        return RewardCell(date: date, label: _labels[date.weekday - 1], state: state, isToday: date == today);
      }(),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/attendance/domain/weekly_reward_test.dart`
Expected: PASS — `+18: All tests passed!`

- [ ] **Step 5: Stop — no commit.** Run `flutter analyze` (expect no issues) and leave the changes uncommitted.

---

### Task 2: Reward data and Home state

**Files:**
- Create: `lib/attendance/data/reward_remote.dart`
- Modify: `lib/attendance/home/home_controller.dart`
- Modify: `test/attendance/fakes.dart` (add `FakeRewards`)
- Test: `test/attendance/data/reward_remote_test.dart`, `test/attendance/home/home_reward_test.dart`

**Interfaces:**
- Consumes: Task 1 (`RewardDay`, `RewardDayStatus.parse`, `rewardWeekStart`, `rewardCells`, `rewardSummary`, `RewardCell`, `RewardSummary`); `isoDate`, `manilaDate` from `work_date.dart`.
- Produces: `abstract interface class RewardApi { Future<List<RewardDay>> weekProgress(DateTime weekStart); Future<double?> rewardAmount(); }`; `RewardDay? rewardDayFromRow(Map<String, dynamic> row)`; `class SupabaseRewardRemote implements RewardApi` (ctor `SupabaseRewardRemote(SupabaseClient client)`); `HomeController({..., RewardApi? rewards, ...})` with getters `List<RewardCell> rewardCells`, `RewardSummary? reward`, `bool rewardUnavailable`, `double? rewardAmount`; test fake `FakeRewards implements RewardApi` (fields `days`, `error`, `amount`, `amountError`, `weekStarts`).

- [ ] **Step 1: Write the failing tests**

Append to `test/attendance/fakes.dart` (and add the two imports at the top: `import 'package:workmate/attendance/data/reward_remote.dart';` and `import 'package:workmate/attendance/domain/weekly_reward.dart';`):

```dart
/// A RewardApi whose answers the test sets.
class FakeRewards implements RewardApi {
  List<RewardDay> days = [];
  Object? error;
  double? amount;
  Object? amountError;
  final weekStarts = <DateTime>[];

  @override
  Future<List<RewardDay>> weekProgress(DateTime weekStart) async {
    weekStarts.add(weekStart);
    if (error != null) throw error!;
    return days;
  }

  @override
  Future<double?> rewardAmount() async {
    if (amountError != null) throw amountError!;
    return amount;
  }
}
```

```dart
// test/attendance/data/reward_remote_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/data/reward_remote.dart';
import 'package:workmate/attendance/domain/weekly_reward.dart';

void main() {
  test('a server row becomes a reward day on its calendar date', () {
    final d = rewardDayFromRow({'work_date': '2026-09-08', 'required': true, 'day_status': 'on_time', 'timein_at': null, 'start_time': '08:00:00'})!;
    expect(d.date, DateTime.utc(2026, 9, 8));
    expect(d.required, isTrue);
    expect(d.status, RewardDayStatus.onTime);
  });

  test('a closed day keeps required false', () {
    final d = rewardDayFromRow({'work_date': '2026-09-09', 'required': false, 'day_status': 'not_required'})!;
    expect(d.required, isFalse);
    expect(d.status, RewardDayStatus.notRequired);
  });

  test('a row whose date cannot be read is dropped, not guessed', () {
    expect(rewardDayFromRow({'work_date': 'soon', 'required': true, 'day_status': 'late'}), isNull);
    expect(rewardDayFromRow({'work_date': null, 'required': true, 'day_status': 'late'}), isNull);
  });

  test('a missing required flag counts the day, as the server would', () {
    // rewardCells treats a date with no row as required; a row with no flag gets the same benefit of the doubt.
    expect(rewardDayFromRow({'work_date': '2026-09-10', 'day_status': 'missing'})!.required, isTrue);
  });
}
```

```dart
// test/attendance/home/home_reward_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/weekly_reward.dart';
import 'package:workmate/attendance/home/home_controller.dart';

import '../fakes.dart';

void main() {
  late FakeAttendance attendance;
  late FakeScheduler scheduler;
  late FakeRewards rewards;
  final now = DateTime.parse('2026-09-09T02:00:00Z'); // 10:00 AM, Wednesday 9 Sep, Manila
  Future<void> settle() => Future<void>.delayed(Duration.zero);

  HomeController home() => HomeController(attendance: attendance, scheduler: scheduler, rewards: rewards, now: () => now);

  setUp(() {
    attendance = FakeAttendance();
    scheduler = FakeScheduler();
    rewards = FakeRewards();
  });

  test('the reward week is asked from its Monday, Manila time', () async {
    final c = home();
    await c.refresh();
    await settle();
    expect(rewards.weekStarts, [DateTime.utc(2026, 9, 7)]);
  });

  test('the server days become five cells and a summary', () async {
    rewards.days = [
      RewardDay(date: DateTime.utc(2026, 9, 7), required: true, status: RewardDayStatus.onTime),
      RewardDay(date: DateTime.utc(2026, 9, 8), required: true, status: RewardDayStatus.onTime),
      RewardDay(date: DateTime.utc(2026, 9, 9), required: true, status: RewardDayStatus.missing),
    ];
    final c = home();
    await c.refresh();
    await settle();
    expect(c.rewardCells.length, 5);
    expect(c.rewardCells[2].isToday, isTrue);
    expect(c.reward!.status, RewardStatus.inProgress);
    expect(c.rewardUnavailable, isFalse);
  });

  test('no signal says the reward cannot be checked, with no cells to misread', () async {
    rewards.error = const SocketException('no route');
    final c = home();
    await c.refresh();
    await settle();
    expect(c.rewardUnavailable, isTrue);
    expect(c.rewardCells, isEmpty);
    expect(c.reward, isNull);
  });

  test('the amount is read separately, and its failure costs nothing else', () async {
    rewards.amount = 500;
    final c = home();
    await c.refresh();
    await settle();
    expect(c.rewardAmount, 500);

    rewards.amountError = const SocketException('no route');
    final d = home();
    await d.refresh();
    await settle();
    expect(d.rewardAmount, isNull);
    expect(d.rewardUnavailable, isFalse);
  });

  test('without a reward source Home still works', () async {
    final c = HomeController(attendance: attendance, scheduler: scheduler, now: () => now);
    await c.refresh();
    await settle();
    expect(c.rewardCells, isEmpty);
    expect(c.rewardUnavailable, isFalse);
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/attendance/data/reward_remote_test.dart test/attendance/home/home_reward_test.dart`
Expected: FAIL — `reward_remote.dart` not found; `No named parameter with the name 'rewards'`.

- [ ] **Step 3: Write `lib/attendance/data/reward_remote.dart`**

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/weekly_reward.dart';
import '../domain/work_date.dart';

/// The weekly reward reads. Deliberately NO offline mirror (as in DACS
/// Attendance's RewardRepository): a stale week could show "Qualified" for a
/// week already lost, so without signal the strip says it cannot check.
abstract interface class RewardApi {
  /// The server's day rows for the Monday-to-Friday week starting [weekStart].
  Future<List<RewardDay>> weekProgress(DateTime weekStart);

  /// The owner's configured reward, or null when none is set.
  Future<double?> rewardAmount();
}

/// One attendance_reward_progress row; null when its date cannot be read.
RewardDay? rewardDayFromRow(Map<String, dynamic> row) {
  final raw = row['work_date'];
  final parsed = raw == null ? null : DateTime.tryParse(raw.toString());
  if (parsed == null) return null;
  return RewardDay(
    date: DateTime.utc(parsed.year, parsed.month, parsed.day),
    // Only an explicit false is a closed day.
    required: row['required'] != false,
    status: RewardDayStatus.parse(row['day_status'] as String?),
  );
}

class SupabaseRewardRemote implements RewardApi {
  SupabaseRewardRemote(this._client);

  final SupabaseClient _client;
  static const _timeout = Duration(seconds: 15);

  @override
  Future<List<RewardDay>> weekProgress(DateTime weekStart) async {
    // Always THIS worker. The RPC refuses anyone else's id unless the caller
    // is an admin, but the app is never the thing that tries.
    final workerId = _client.auth.currentUser?.id;
    if (workerId == null) throw StateError('AUTH_REQUIRED');
    final rows = await _client
        .rpc('attendance_reward_progress', params: {'p_worker': workerId, 'p_week_start': isoDate(weekStart)})
        .timeout(_timeout);
    return (rows as List)
        .map((r) => rewardDayFromRow(Map<String, dynamic>.from(r as Map)))
        .whereType<RewardDay>()
        .toList();
  }

  @override
  Future<double?> rewardAmount() async {
    // RLS returns the worker's own owner's row only.
    final rows = await _client.from('attendance_config').select('reward_amount').limit(1).timeout(_timeout);
    if (rows.isEmpty) return null;
    return (rows.first['reward_amount'] as num?)?.toDouble();
  }
}
```

- [ ] **Step 4: Add the reward state to `HomeController`**

In `lib/attendance/home/home_controller.dart`:

1. Add imports: `import '../data/reward_remote.dart';` and `import '../domain/weekly_reward.dart';`.
2. Replace the constructor and fields block:

```dart
  HomeController({
    required AttendanceApi attendance,
    required UploadScheduler scheduler,
    RewardApi? rewards,
    DateTime Function()? now,
  })  : _attendance = attendance,
        _scheduler = scheduler,
        _rewards = rewards,
        now = now ?? DateTime.now;

  final AttendanceApi _attendance;
  final UploadScheduler _scheduler;
  final RewardApi? _rewards;
```

3. Next to the other private state (`List<PendingSubmission> _refused = const [];`), add:

```dart
  List<RewardCell> _rewardCells = const [];
  RewardSummary? _reward;
  bool _rewardUnavailable = false;
  double? _rewardAmount;
```

4. Next to the other getters (`List<PendingSubmission> get refused => _refused;`), add:

```dart
  /// Monday to FRIDAY: five cells, where [week] has six (DACs works Saturdays,
  /// the reward only asks about Mon-Fri). Empty until the server answered.
  List<RewardCell> get rewardCells => _rewardCells;
  RewardSummary? get reward => _reward;

  /// The reward could not be read. Distinct from empty [rewardCells], which
  /// only means "not read yet".
  bool get rewardUnavailable => _rewardUnavailable;

  /// The owner's reward, or null; shown only beside "Qualified".
  double? get rewardAmount => _rewardAmount;
```

5. In `refresh()`, after `unawaited(_loadRefused());` add `unawaited(_loadReward());`.
6. After `_loadRefused()` add:

```dart
  Future<void> _loadReward() async {
    final rewards = _rewards;
    if (rewards == null) return;
    final today = manilaDate(now());
    final weekStart = rewardWeekStart(today);
    unawaited(() async {
      try {
        _rewardAmount = await rewards.rewardAmount();
        _notify();
      } catch (_) {
        // The pill reads "Qualified" without a figure.
      }
    }());
    try {
      final days = await rewards.weekProgress(weekStart);
      _rewardCells = rewardCells(weekStart, days, today);
      _reward = rewardSummary(days, today);
      _rewardUnavailable = false;
    } catch (_) {
      // No offline copy on purpose: five grey cells would read as five missed days.
      _rewardCells = const [];
      _reward = null;
      _rewardUnavailable = true;
    }
    _notify();
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test test/attendance/data/reward_remote_test.dart test/attendance/home/`
Expected: PASS (the new tests and every existing Home test).

- [ ] **Step 6: Stop — no commit.** `flutter analyze` → no issues.

---

### Task 3: Home shows the reward strip and the greeting

**Files:**
- Create: `lib/attendance/domain/greeting.dart`
- Modify: `lib/attendance/ui/formats.dart` (add `pesos`)
- Modify: `lib/attendance/home/home_screen.dart`
- Modify: `lib/attendance/attendance_services.dart` (add `rewards`)
- Modify: `lib/ui/home_shell.dart` (pass `rewards` to `HomeController`)
- Modify: `lib/main.dart` (build `SupabaseRewardRemote`)
- Test: `test/attendance/domain/greeting_test.dart`, `test/attendance/ui/formats_test.dart` (append), `test/attendance/home/reward_strip_test.dart`

**Interfaces:**
- Consumes: Task 2 (`HomeController.rewardCells/reward/rewardUnavailable/rewardAmount`, `RewardApi`, `SupabaseRewardRemote`, `FakeRewards`); `manilaFields` from `work_date.dart`; `StatusPill` (`lib/attendance/ui/status_pill.dart`); `WmColors`, `monoLabel` (`lib/ui/theme.dart`).
- Produces: `enum Greeting { morning, afternoon, evening }` with `final String text` ("Good morning" / "Good afternoon" / "Good evening"); `Greeting greetingAtHour(int hour)`; `Greeting greetingAt(DateTime instant)`; `String pesos(double amount)`; `AttendanceServices.rewards` (`RewardApi?`); copy constant `rewardUnverifiedNote`.

**Copy (English, from strings.xml):** `WEEKLY REWARD`, `Qualified`, `Disqualified`, `In progress`, `Needs signal to check`, `%d of %d on time`, and the unverified note: `A brown day could not be verified and does not count. Time In at the site, and open the app once with signal after restarting your phone.`

- [ ] **Step 1: Write the failing tests**

```dart
// test/attendance/domain/greeting_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/greeting.dart';

/// Ported from GreetingTest.kt: it once said good morning to a worker timing
/// out at half past one.
void main() {
  test('morning until noon', () {
    expect(greetingAtHour(5), Greeting.morning);
    expect(greetingAtHour(11), Greeting.morning);
  });

  test('afternoon from noon', () {
    expect(greetingAtHour(12), Greeting.afternoon);
    expect(greetingAtHour(17), Greeting.afternoon);
  });

  test('evening from six, and through the night', () {
    expect(greetingAtHour(18), Greeting.evening);
    expect(greetingAtHour(23), Greeting.evening);
    expect(greetingAtHour(4), Greeting.evening);
  });

  test('the hour is Manila, whatever the phone says', () {
    // 04:30 UTC is 12:30 in Manila: afternoon, not "morning" from a UTC reading.
    expect(greetingAt(DateTime.parse('2026-09-09T04:30:00Z')), Greeting.afternoon);
    expect(greetingAt(DateTime.parse('2026-09-08T22:00:00Z')).text, 'Good morning'); // 06:00 Manila
  });
}
```

Append to `test/attendance/ui/formats_test.dart` inside its `main()`:

```dart
  test('pesos shows centavos only when they are real', () {
    expect(pesos(500), '₱500');
    expect(pesos(500.5), '₱500.50');
    expect(pesos(1250.25), '₱1250.25');
  });
```

```dart
// test/attendance/home/reward_strip_test.dart
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/domain/weekly_reward.dart';
import 'package:workmate/attendance/home/home_controller.dart';
import 'package:workmate/attendance/home/home_screen.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/ui/theme.dart';

import '../fakes.dart';

void main() {
  late FakeRewards rewards;
  final now = DateTime.parse('2026-09-11T02:00:00Z'); // 10:00 AM, Friday 11 Sep, Manila
  const worker = WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42);

  RewardDay day(int d, RewardDayStatus s) => RewardDay(date: DateTime.utc(2026, 9, d), required: true, status: s);

  Future<void> show(WidgetTester tester) async {
    useTallPhone(tester);
    final c = HomeController(attendance: FakeAttendance(), scheduler: FakeScheduler(), rewards: rewards, now: () => now);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: HomeScreen(
          worker: worker,
          controller: c,
          onStartFlow: (_) {},
          onSeeHistory: () {},
          openSettings: (_) {},
        ),
      ),
    ));
    await c.refresh();
    await tester.pumpAndSettle();
  }

  setUp(() => rewards = FakeRewards());

  testWidgets('a qualifying week shows the pill with the amount and the count', (tester) async {
    rewards.days = [for (var d = 7; d <= 11; d++) day(d, RewardDayStatus.onTime)];
    rewards.amount = 500;
    await show(tester);
    expect(find.text('WEEKLY REWARD'), findsOneWidget);
    expect(find.text('Qualified · ₱500'), findsOneWidget);
    expect(find.text('5 of 5 on time'), findsOneWidget);
    expect(find.byKey(const Key('reward-dot-2026-09-08-onTime')), findsOneWidget);
  });

  testWidgets('a lost week never shows a peso figure', (tester) async {
    rewards.days = [day(7, RewardDayStatus.late), for (var d = 8; d <= 11; d++) day(d, RewardDayStatus.onTime)];
    rewards.amount = 500;
    await show(tester);
    expect(find.text('Disqualified'), findsOneWidget);
    expect(find.textContaining('₱'), findsNothing);
  });

  testWidgets('an unverified day explains itself', (tester) async {
    rewards.days = [day(7, RewardDayStatus.unverified), for (var d = 8; d <= 11; d++) day(d, RewardDayStatus.onTime)];
    await show(tester);
    expect(find.textContaining('A brown day could not be verified'), findsOneWidget);
  });

  testWidgets('no signal says so instead of drawing five empty days', (tester) async {
    rewards.error = const SocketException('no route');
    await show(tester);
    expect(find.text('WEEKLY REWARD'), findsOneWidget);
    expect(find.text('Needs signal to check'), findsOneWidget);
    expect(find.byKey(const Key('reward-dot-2026-09-07-missing')), findsNothing);
  });

  testWidgets('Home greets by the Manila hour', (tester) async {
    await show(tester);
    expect(find.text('Good morning, Juan'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/attendance/domain/greeting_test.dart test/attendance/ui/formats_test.dart test/attendance/home/reward_strip_test.dart`
Expected: FAIL — `greeting.dart` not found, `pesos` undefined, strip text not found.

- [ ] **Step 3: Write `lib/attendance/domain/greeting.dart`**

```dart
import 'work_date.dart';

/// How Home opens. Not decoration: the old app said "good morning" to a
/// worker timing out at half past one. Ported from Greeting.kt.
enum Greeting {
  morning('Good morning'),
  afternoon('Good afternoon'),
  evening('Good evening');

  const Greeting(this.text);
  final String text;
}

Greeting greetingAtHour(int hour) {
  if (hour >= 5 && hour <= 11) return Greeting.morning;
  if (hour >= 12 && hour <= 17) return Greeting.afternoon;
  return Greeting.evening;
}

/// By the MANILA hour: the greeting should match the worker's day.
Greeting greetingAt(DateTime instant) => greetingAtHour(manilaFields(instant).hour);
```

- [ ] **Step 4: Add `pesos` to `lib/attendance/ui/formats.dart`** (append at the end):

```dart
/// "₱500", and "₱500.50" only when the centavos are real.
String pesos(double amount) => amount % 1 == 0 ? '₱${amount.toInt()}' : '₱${amount.toStringAsFixed(2)}';
```

- [ ] **Step 5: Add the greeting and the strip to `lib/attendance/home/home_screen.dart`**

1. Add imports: `import '../domain/greeting.dart';` and `import '../domain/weekly_reward.dart';`.
2. Change the class doc comment's last line to `/// Attendance's DashboardScreen, weekly reward strip included.`
3. In `build`, replace

```dart
              WorkerHeader(worker: widget.worker),
              const SizedBox(height: 18),
```

with

```dart
              WorkerHeader(worker: widget.worker),
              const SizedBox(height: 18),
              Text('${greetingAt(now).text}, ${widget.worker.firstName}',
                  key: const Key('greeting'),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: WmColors.green)),
              const SizedBox(height: 4),
```

4. Replace `_WeekStrip(cells: c.week, onSeeAll: widget.onSeeHistory),` with

```dart
              _WeekStrip(cells: c.week, onSeeAll: widget.onSeeHistory),
              const SizedBox(height: 20),
              _RewardStrip(controller: c),
```

5. Append these classes at the end of the file:

```dart
/// The unverified line (0078): the one outcome a worker can PREVENT next
/// time, so it says how rather than only that it happened.
const rewardUnverifiedNote =
    'A brown day could not be verified and does not count. Time In at the site, and open the app once with signal after restarting your phone.';

/// The Monday-to-Friday reward. Renders nothing until the server answered:
/// the reward is the one read here with no offline copy, and five grey cells
/// shown for "not read yet" would read as five missed days.
class _RewardStrip extends StatelessWidget {
  const _RewardStrip({required this.controller});
  final HomeController controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final cells = c.rewardCells;
    final unavailable = c.rewardUnavailable;
    if (cells.isEmpty && !unavailable) return const SizedBox.shrink();
    final summary = c.reward;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        const Text('WEEKLY REWARD', style: monoLabel),
        const Spacer(),
        if (unavailable)
          const Text('Needs signal to check',
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: WmColors.textMuted))
        else if (summary != null)
          _rewardPill(summary, c.rewardAmount),
      ]),
      if (!unavailable) ...[
        const SizedBox(height: 9),
        Row(children: [for (final cell in cells) Expanded(child: _RewardCellView(cell: cell))]),
        if (summary != null) ...[
          const SizedBox(height: 9),
          Text('${summary.onTimeDays} of ${summary.requiredDays} on time',
              style: const TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
          if (summary.unverifiedDays > 0) ...[
            const SizedBox(height: 4),
            const Text(rewardUnverifiedNote, style: TextStyle(fontSize: 12.5, color: WmColors.brown)),
          ],
        ],
      ],
    ]);
  }

  /// The amount appears only BESIDE "Qualified", and only when the office set
  /// one: a peso figure next to "Disqualified" reads as a promise.
  static Widget _rewardPill(RewardSummary s, double? amount) => switch (s.status) {
        RewardStatus.qualified => StatusPill.green(amount == null ? 'Qualified' : 'Qualified · ${pesos(amount)}'),
        RewardStatus.disqualified =>
          const StatusPill('Disqualified', background: WmColors.dangerTint, foreground: WmColors.danger),
        RewardStatus.inProgress => const StatusPill.brown('In progress'),
      };
}

class _RewardCellView extends StatelessWidget {
  const _RewardCellView({required this.cell});
  final RewardCell cell;

  @override
  Widget build(BuildContext context) {
    // Pending and not-required are the QUIETEST states: one has not happened
    // yet, the other is a day the company chose not to open. Red would blame
    // a worker for the calendar. Unverified is brown: the worker WAS there.
    final (dot, border, fill) = switch (cell.state) {
      RewardCellState.onTime => (WmColors.green, WmColors.border, Colors.white),
      RewardCellState.late => (WmColors.danger, WmColors.dangerBorder, WmColors.dangerTint),
      RewardCellState.missing => (WmColors.danger, WmColors.dangerBorder, WmColors.dangerTint),
      RewardCellState.unverified => (WmColors.brown, WmColors.brown, WmColors.brownTint),
      RewardCellState.pending => (WmColors.border, WmColors.border, Colors.white),
      RewardCellState.notRequired => (WmColors.vacant, WmColors.hairline, WmColors.canvas),
    };
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 3),
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: cell.isToday ? WmColors.greenTint : fill,
        border: Border.all(color: cell.isToday ? WmColors.green : border, width: cell.isToday ? 1.5 : 1),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(children: [
        Text(
          cell.label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: cell.isToday ? FontWeight.w800 : FontWeight.w600,
            color: cell.isToday
                ? WmColors.green
                : switch (cell.state) {
                    RewardCellState.pending => WmColors.textDisabled,
                    RewardCellState.notRequired => WmColors.textFaint,
                    _ => WmColors.textMuted,
                  },
          ),
        ),
        const SizedBox(height: 5),
        Container(
          key: Key('reward-dot-${isoDate(cell.date)}-${cell.state.name}'),
          width: 8,
          height: 8,
          decoration: BoxDecoration(shape: BoxShape.circle, color: dot),
        ),
      ]),
    );
  }
}
```

6. If `StatusPill`'s default constructor is not `const`-capable with those arguments, it already is (`const StatusPill(this.text, {super.key, required this.background, required this.foreground})`) — no change needed.

- [ ] **Step 6: Wire the reward source**

1. `lib/attendance/attendance_services.dart`: add `import 'data/reward_remote.dart';`, the constructor parameter `this.rewards,` (after `required this.openSettings,`), and the field

```dart
  /// The weekly reward reads; null in tests that do not need them.
  final RewardApi? rewards;
```

2. `lib/ui/home_shell.dart`, `initState`: `_home = HomeController(attendance: s.attendance, scheduler: s.scheduler, rewards: s.rewards);`
3. `lib/main.dart`: add `import 'attendance/data/reward_remote.dart';` and in the `AttendanceServices(...)` call add `rewards: SupabaseRewardRemote(client),`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `flutter test`
Expected: PASS — all tests, including the existing `home greets the worker...` shell test.

- [ ] **Step 8: Stop — no commit.** `flutter analyze` → no issues.

---
### Task 4: Password change rules

**Files:**
- Create: `lib/profile/password_change.dart`
- Test: `test/profile/password_change_test.dart`

**Interfaces:**
- Produces: `const minPasswordLength = 8;` and `enum PasswordChangeFailure { tooShort, mismatch, reused, sessionExpired, noConnection, unexpected }` with `final String english`, `final String tagalog`, `static PasswordChangeFailure? validate(String password, String confirmation)`, `static PasswordChangeFailure of(Object error)`.

**Copy (bilingual, exactly from strings.xml):**

| Failure | English | Tagalog |
|---|---|---|
| tooShort | `Use at least 8 characters.` | `Kailangan ng 8 letra o numero pataas.` |
| mismatch | `The two passwords do not match.` | `Hindi pareho ang dalawang password.` |
| reused | `That is your current password. Pick a different one.` | `Iyan din ang password mo ngayon. Pumili ng iba.` |
| sessionExpired | `Please log in again.` | `Mag-log in ulit.` |
| noConnection | `No signal right now. Try again in a moment.` | `Walang signal ngayon. Subukan ulit mamaya.` |
| unexpected | `Something went wrong. Try again.` | `May nasira. Subukan ulit.` |

- [ ] **Step 1: Write the failing test** — the 9 cases of `PasswordChangeTest.kt` plus the Supabase error shapes WorkMate actually receives.

```dart
// test/profile/password_change_test.dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:workmate/profile/password_change.dart';

/// Ported from PasswordChangeTest.kt. The worker doing this stands on a site
/// with one bar of signal: everything decidable without the network is decided first.
void main() {
  test('a good password and a matching confirmation passes', () {
    expect(PasswordChangeFailure.validate('bagongpass1', 'bagongpass1'), isNull);
  });

  test('too short is caught before the network', () {
    expect(PasswordChangeFailure.validate('abc123', 'abc123'), PasswordChangeFailure.tooShort);
  });

  test('eight spaces is not a password', () {
    expect(PasswordChangeFailure.validate('        ', '        '), PasswordChangeFailure.tooShort);
  });

  test('a mistyped confirmation is caught locally', () {
    expect(PasswordChangeFailure.validate('bagongpass1', 'bagongpass2'), PasswordChangeFailure.mismatch);
  });

  test('length is reported before the mismatch', () {
    expect(PasswordChangeFailure.validate('abc', 'abcd'), PasswordChangeFailure.tooShort);
  });

  test('no signal is not a rejected password', () {
    expect(PasswordChangeFailure.of(const SocketException('Unable to resolve host')), PasswordChangeFailure.noConnection);
    expect(PasswordChangeFailure.of(TimeoutException('slow')), PasswordChangeFailure.noConnection);
    expect(PasswordChangeFailure.of(AuthRetryableFetchException()), PasswordChangeFailure.noConnection);
  });

  test('the server refusing a reused password says so', () {
    expect(PasswordChangeFailure.of(Exception('New password should be different from the old password.')),
        PasswordChangeFailure.reused);
    expect(PasswordChangeFailure.of(const AuthException('nope', statusCode: '422', code: 'same_password')),
        PasswordChangeFailure.reused);
  });

  test('the server calling it weak is too short', () {
    expect(PasswordChangeFailure.of(const AuthException('Password should be at least 6 characters.', code: 'weak_password')),
        PasswordChangeFailure.tooShort);
  });

  test('an expired session is not a password problem', () {
    expect(PasswordChangeFailure.of(Exception('401: invalid JWT')), PasswordChangeFailure.sessionExpired);
    expect(PasswordChangeFailure.of(StateError('No session to change the password with')), PasswordChangeFailure.sessionExpired);
  });

  test('an unrecognised refusal never guesses', () {
    expect(PasswordChangeFailure.of(Exception('boom')), PasswordChangeFailure.unexpected);
  });

  test('every failure speaks English and Tagalog', () {
    for (final f in PasswordChangeFailure.values) {
      expect(f.english, isNotEmpty);
      expect(f.tagalog, isNotEmpty);
    }
    expect(PasswordChangeFailure.reused.tagalog, 'Iyan din ang password mo ngayon. Pumili ng iba.');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/profile/password_change_test.dart`
Expected: FAIL — `password_change.dart` not found.

- [ ] **Step 3: Write `lib/profile/password_change.dart`**

```dart
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException, AuthRetryableFetchException;

/// Supabase's own floor is 6; 8 is the project's, and the stricter wins.
const minPasswordLength = 8;

/// Every way changing a password can fail, local checks and server refusals
/// in ONE type, so the sheet renders one thing whichever side said no.
/// Ported from DACS Attendance domain/PasswordChange.kt.
enum PasswordChangeFailure {
  tooShort('Use at least 8 characters.', 'Kailangan ng 8 letra o numero pataas.'),
  mismatch('The two passwords do not match.', 'Hindi pareho ang dalawang password.'),

  /// The server refused it as identical to the current password.
  reused('That is your current password. Pick a different one.', 'Iyan din ang password mo ngayon. Pumili ng iba.'),

  /// The session died while the sheet was open; they must log in again.
  sessionExpired('Please log in again.', 'Mag-log in ulit.'),
  noConnection('No signal right now. Try again in a moment.', 'Walang signal ngayon. Subukan ulit mamaya.'),
  unexpected('Something went wrong. Try again.', 'May nasira. Subukan ulit.');

  const PasswordChangeFailure(this.english, this.tagalog);

  final String english;
  final String tagalog;

  /// Checked BEFORE the network: a too-short password should not cost a round
  /// trip on site signal, and the server never sees the confirmation box.
  static PasswordChangeFailure? validate(String password, String confirmation) {
    // Blank first: eight spaces passes a length check and nobody can retype it tomorrow.
    if (password.trim().isEmpty || password.length < minPasswordLength) return tooShort;
    if (password != confirmation) return mismatch;
    return null;
  }

  static PasswordChangeFailure of(Object error) {
    if (error is SocketException || error is TimeoutException || error is http.ClientException ||
        error is AuthRetryableFetchException) {
      return noConnection;
    }
    final text = (error is AuthException ? '${error.message} ${error.code ?? ''} ${error.statusCode ?? ''}' : error.toString())
        .toLowerCase();
    if (text.contains('should be different') || text.contains('same_password')) return reused;
    if (text.contains('at least') || text.contains('weak_password')) return tooShort;
    if (text.contains('401') || text.contains('jwt') || text.contains('session')) return sessionExpired;
    return unexpected;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/profile/password_change_test.dart`
Expected: PASS — `+11: All tests passed!`

- [ ] **Step 5: Stop — no commit.** `flutter analyze` → no issues.

---

### Task 5: Account data — change password, Terms accepted date

**Files:**
- Modify: `lib/auth/auth_backend.dart` (add `changePassword`)
- Modify: `lib/auth/auth_repository.dart` (add `changePassword`)
- Modify: `lib/auth/worker_cache.dart` (accepted-at date)
- Modify: `lib/terms/terms_repository.dart` (`TermsBackend.acceptedAt`, `TermsRepository.acceptedAt`)
- Modify fakes: `test/app_controller_test.dart` (`FakeAuth`, `FakeTerms`), `test/auth/auth_repository_test.dart` (`FakeBackend`), `test/terms/terms_repository_test.dart` (`FakeTermsBackend`)
- Test: append to `test/auth/auth_repository_test.dart`, `test/auth/worker_cache_test.dart`, `test/terms/terms_repository_test.dart`

**Interfaces:**
- Produces: `AuthBackend.changePassword(String newPassword) → Future<void>`; `AuthRepository.changePassword(String newPassword) → Future<void>`; `TermsBackend.acceptedAt(String workerId, String version) → Future<DateTime?>`; `TermsRepository.acceptedAt(String workerId) → Future<DateTime?>` (never throws); `WorkerCache.termsAcceptedAt(String id) → DateTime?`, `WorkerCache.recordTermsAcceptedAt(String id, DateTime at) → Future<void>`.

- [ ] **Step 1: Add the new members to every fake** (so the suite compiles once the interfaces grow)

`test/app_controller_test.dart`, inside `class FakeAuth`:

```dart
  @override
  Future<void> changePassword(String newPassword) async {}
```

inside `class FakeTerms`:

```dart
  @override
  Future<DateTime?> acceptedAt(String workerId, String version) async => null;
```

`test/auth/auth_repository_test.dart`, inside `class FakeBackend`:

```dart
  final passwords = <String>[];
  Object? passwordError;

  @override
  Future<void> changePassword(String newPassword) async {
    if (passwordError != null) throw passwordError!;
    passwords.add(newPassword);
  }
```

`test/terms/terms_repository_test.dart`, inside `class FakeTermsBackend`:

```dart
  DateTime? acceptedAtValue;
  Object? acceptedAtError;
  int acceptedAtReads = 0;

  @override
  Future<DateTime?> acceptedAt(String workerId, String version) async {
    acceptedAtReads++;
    if (acceptedAtError != null) throw acceptedAtError!;
    return acceptedAtValue;
  }
```

- [ ] **Step 2: Write the failing tests**

Append inside `main()` of `test/auth/auth_repository_test.dart` (construct the repository the same way the file's other tests do; the variables there are `backend` and a repository built with `AuthRepository(api: ..., backend: backend, cache: ...)` — reuse that file's own setup helper):

```dart
  test('a password change goes to the signed-in session, unchanged', () async {
    final backend = FakeBackend();
    SharedPreferences.setMockInitialValues({});
    final repo = AuthRepository(api: apiReturning(200, '{}'), backend: backend, cache: WorkerCache(await SharedPreferences.getInstance()));
    await repo.changePassword('bagongpass1');
    expect(backend.passwords, ['bagongpass1']);
  });

  test('a refused password change reaches the caller to be explained', () async {
    final backend = FakeBackend()..passwordError = const SocketException('down');
    SharedPreferences.setMockInitialValues({});
    final repo = AuthRepository(api: apiReturning(200, '{}'), backend: backend, cache: WorkerCache(await SharedPreferences.getInstance()));
    expect(() => repo.changePassword('bagongpass1'), throwsA(isA<SocketException>()));
  });
```

Append inside `main()` of `test/auth/worker_cache_test.dart`:

```dart
  test('remembers when the Terms were accepted, and forgets it at sign-out', () async {
    final cache = WorkerCache(await SharedPreferences.getInstance());
    final at = DateTime.utc(2026, 8, 2, 17);
    await cache.recordTermsAcceptedAt('u1', at);
    expect(cache.termsAcceptedAt('u1'), at);
    await cache.forget('u1');
    expect(cache.termsAcceptedAt('u1'), isNull);
  });
```

Append inside `main()` of `test/terms/terms_repository_test.dart`:

```dart
  test('the accepted date comes from the server once, then from the phone', () async {
    backend.acceptedAtValue = DateTime.utc(2026, 8, 2, 17);
    expect(await repo.acceptedAt('u1'), DateTime.utc(2026, 8, 2, 17));
    expect(await repo.acceptedAt('u1'), DateTime.utc(2026, 8, 2, 17));
    expect(backend.acceptedAtReads, 1);
  });

  test('no signal and nothing remembered: no date, never an invented one', () async {
    backend.acceptedAtError = const SocketException('down');
    expect(await repo.acceptedAt('u1'), isNull);
  });

  test('no acceptance row: no date, and nothing cached', () async {
    expect(await repo.acceptedAt('u1'), isNull);
    expect(cache.termsAcceptedAt('u1'), isNull);
  });
```

(Add `import 'dart:io';` to `terms_repository_test.dart` if it is not already imported.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `flutter test test/auth test/terms test/app_controller_test.dart`
Expected: FAIL — `changePassword`, `acceptedAt`, `termsAcceptedAt` are not defined (and `@override` on members the interfaces lack).

- [ ] **Step 4: Implement**

`lib/auth/auth_backend.dart` — in `abstract class AuthBackend`, after `readProfile`:

```dart
  /// Changes THIS session's password. Only ever the worker signed in on this
  /// phone: there is no way to name anyone else.
  Future<void> changePassword(String newPassword);
```

and in `SupabaseAuthBackend`, after `readProfile`:

```dart
  @override
  Future<void> changePassword(String newPassword) async {
    // Without a session gotrue would fail with a message that reads as a password problem.
    if (_client.auth.currentSession == null) throw StateError('No session to change the password with');
    await _client.auth.updateUser(UserAttributes(password: newPassword)).timeout(const Duration(seconds: 20));
  }
```

`lib/auth/auth_repository.dart` — after `signOut()`:

```dart
  /// The rules (length, the second box) are checked on the phone first
  /// (PasswordChangeFailure.validate); this only asks the server. Failures
  /// are thrown for PasswordChangeFailure.of to explain.
  Future<void> changePassword(String newPassword) => backend.changePassword(newPassword);
```

`lib/auth/worker_cache.dart`:
- add `static String _termsAtKey(String id) => 'terms_at.$id';` beside the other key helpers;
- after `recordTermsAccepted`, add

```dart
  /// When the server recorded this worker's acceptance of the current Terms
  /// (Profile shows it). Never invented: absent until the server said.
  DateTime? termsAcceptedAt(String id) {
    final ms = _prefs.getInt(_termsAtKey(id));
    return ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
  }

  Future<void> recordTermsAcceptedAt(String id, DateTime at) => _prefs.setInt(_termsAtKey(id), at.millisecondsSinceEpoch);
```

- in `forget`, after `await _prefs.remove(_termsKey(id));` add `await _prefs.remove(_termsAtKey(id));`.

`lib/terms/terms_repository.dart`:
- in `abstract class TermsBackend`, after `acceptedVersions`:

```dart
  /// When [workerId] accepted [version], or null when there is no such row.
  /// Throws when it cannot be asked.
  Future<DateTime?> acceptedAt(String workerId, String version);
```

- in `SupabaseTermsBackend`, after `acceptedVersions`:

```dart
  @override
  Future<DateTime?> acceptedAt(String workerId, String version) async {
    // Asked without a session RLS returns nothing, which would read as "never accepted".
    if (_client.auth.currentSession == null) throw StateError('No session to read the Terms acceptance with');
    final rows = await _client
        .from('attendance_terms_acceptances')
        .select('accepted_at')
        .eq('worker_id', workerId)
        .eq('terms_version', version)
        .limit(1)
        .timeout(const Duration(seconds: 15));
    if (rows.isEmpty) return null;
    return DateTime.tryParse(rows.first['accepted_at'].toString())?.toUtc();
  }
```

- in `TermsRepository`, after `accept`:

```dart
  /// When this worker accepted the CURRENT Terms, as the server recorded it.
  /// The phone's copy first (it never changes for a version); null when it
  /// cannot be known -- an invented acceptance date is worse than none.
  Future<DateTime?> acceptedAt(String workerId) async {
    final cached = cache.termsAcceptedAt(workerId);
    if (cached != null) return cached;
    try {
      final at = await backend.acceptedAt(workerId, AttendanceTerms.version);
      if (at != null) await cache.recordTermsAcceptedAt(workerId, at);
      return at;
    } catch (_) {
      return null;
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test`
Expected: PASS — everything.

- [ ] **Step 6: Stop — no commit.** `flutter analyze` → no issues.

---

### Task 6: Profile screen, password sheet, read-only Terms

**Files:**
- Create: `lib/profile/account_services.dart`, `lib/profile/profile_screen.dart`, `lib/profile/change_password_sheet.dart`
- Modify: `lib/ui/terms_screen.dart` (extract `termsClauseWidgets()`, add `TermsReaderScreen`)
- Modify: `lib/ui/home_shell.dart` (Profile tab → `ProfileScreen`; new required `account` parameter; delete `_ProfileTab`)
- Modify: `lib/app.dart` (new required `account` parameter, passed to `HomeShell`)
- Modify: `lib/main.dart` (build `AccountServices`)
- Modify: `test/ui/screens_test.dart` (`showShell` passes `account`)
- Test: `test/profile/profile_screen_test.dart`

**Interfaces:**
- Consumes: Task 4 (`PasswordChangeFailure`), Task 5 (`AuthRepository.changePassword`, `TermsRepository.acceptedAt`); `shortDate` (`formats.dart`), `StatusPill`, `WorkerHeader`, `FailureNotice`, `AttendanceTerms`.
- Produces: `class AccountServices { const AccountServices({required Future<void> Function(String) changePassword, required Future<DateTime?> Function() termsAcceptedAt}); }`; `ProfileScreen({required WorkerProfile worker, required String versionName, required Future<void> Function() onSignOut, required AccountServices account})`; `ChangePasswordSheet({required Future<void> Function(String) onSave})` (pops `true` on success); `List<Widget> termsClauseWidgets()`; `TermsReaderScreen({DateTime? acceptedAt})`; `HomeShell(..., required AccountServices account)`; `WorkMateApp(..., required AccountServices account)`.

**Copy (English, from strings.xml):** `Active account`, `Email`, `Position`, `Worker ID`, `Change password` / `Update your login`, `Terms & Conditions` with subtitle `Accepted %s` (Manila date, e.g. `Accepted 3 Aug 2026`) or `Read the terms you accepted`, `Log out`, sheet: `New password`, `Type it again`, `SAVE PASSWORD`, `Any 8 letters or numbers. Do not share it with anyone.`, success: `Your password has been changed.`

- [ ] **Step 1: Write the failing test**

```dart
// test/profile/profile_screen_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/profile/account_services.dart';
import 'package:workmate/profile/profile_screen.dart';
import 'package:workmate/terms/attendance_terms.dart';
import 'package:workmate/ui/theme.dart';

import '../attendance/fakes.dart';

void main() {
  const juan = WorkerProfile(
      id: 'u1', email: 'juan@x.com', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42, role: 'worker', status: 'active');
  late List<String> saved;
  Object? saveError;
  DateTime? acceptedAt;

  Future<void> show(WidgetTester tester) async {
    useTallPhone(tester);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: ProfileScreen(
          worker: juan,
          versionName: '0.3.0',
          onSignOut: () async {},
          account: AccountServices(
            changePassword: (p) async {
              if (saveError != null) throw saveError!;
              saved.add(p);
            },
            termsAcceptedAt: () async => acceptedAt,
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
  }

  setUp(() {
    saved = [];
    saveError = null;
    acceptedAt = null;
  });

  testWidgets('shows the account: email, position, worker ID, active', (tester) async {
    await show(tester);
    expect(find.text('Active account'), findsOneWidget);
    expect(find.text('juan@x.com'), findsOneWidget);
    expect(find.text('Mason'), findsWidgets);
    expect(find.text('W-0042'), findsOneWidget);
    expect(find.text('Log out'), findsOneWidget);
    expect(find.textContaining("DAC'S WorkMate 0.3.0"), findsOneWidget);
  });

  testWidgets('the Terms row shows the Manila date they were accepted', (tester) async {
    acceptedAt = DateTime.utc(2026, 8, 2, 17); // 01:00 on 3 Aug in Manila
    await show(tester);
    expect(find.text('Accepted 3 Aug 2026'), findsOneWidget);
  });

  testWidgets('with no known date the Terms row still offers them', (tester) async {
    await show(tester);
    expect(find.text('Read the terms you accepted'), findsOneWidget);
    await tester.tap(find.byKey(const Key('profile-terms')));
    await tester.pumpAndSettle();
    expect(find.text(AttendanceTerms.clauses.first.english), findsOneWidget);
  });

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('profile-change-password')));
    await tester.pumpAndSettle();
  }

  testWidgets('a short password is refused on the phone, in both languages', (tester) async {
    await show(tester);
    await openSheet(tester);
    await tester.enterText(find.byKey(const Key('new-password')), 'abc');
    await tester.enterText(find.byKey(const Key('confirm-password')), 'abc');
    await tester.tap(find.text('SAVE PASSWORD'));
    await tester.pumpAndSettle();
    expect(find.text('Use at least 8 characters.'), findsOneWidget);
    expect(find.text('Kailangan ng 8 letra o numero pataas.'), findsOneWidget);
    expect(saved, isEmpty);
  });

  testWidgets('a mismatch is refused on the phone', (tester) async {
    await show(tester);
    await openSheet(tester);
    await tester.enterText(find.byKey(const Key('new-password')), 'bagongpass1');
    await tester.enterText(find.byKey(const Key('confirm-password')), 'bagongpass2');
    await tester.tap(find.text('SAVE PASSWORD'));
    await tester.pumpAndSettle();
    expect(find.text('The two passwords do not match.'), findsOneWidget);
    expect(saved, isEmpty);
  });

  testWidgets('the server refusing a reused password is explained', (tester) async {
    saveError = const AuthException('New password should be different from the old password.', code: 'same_password');
    await show(tester);
    await openSheet(tester);
    await tester.enterText(find.byKey(const Key('new-password')), 'bagongpass1');
    await tester.enterText(find.byKey(const Key('confirm-password')), 'bagongpass1');
    await tester.tap(find.text('SAVE PASSWORD'));
    await tester.pumpAndSettle();
    expect(find.text('That is your current password. Pick a different one.'), findsOneWidget);
    expect(find.text('SAVE PASSWORD'), findsOneWidget); // still open
  });

  testWidgets('a saved password closes the sheet and says so', (tester) async {
    await show(tester);
    await openSheet(tester);
    await tester.enterText(find.byKey(const Key('new-password')), 'bagongpass1');
    await tester.enterText(find.byKey(const Key('confirm-password')), 'bagongpass1');
    await tester.tap(find.text('SAVE PASSWORD'));
    await tester.pumpAndSettle();
    expect(saved, ['bagongpass1']);
    expect(find.text('SAVE PASSWORD'), findsNothing);
    expect(find.text('Your password has been changed.'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/profile/profile_screen_test.dart`
Expected: FAIL — `account_services.dart` / `profile_screen.dart` not found.

- [ ] **Step 3: Write `lib/profile/account_services.dart`**

```dart
/// What Profile needs from the signed-in account, built once in main.dart.
class AccountServices {
  const AccountServices({required this.changePassword, required this.termsAcceptedAt});

  /// Throws on refusal; PasswordChangeFailure.of explains it.
  final Future<void> Function(String newPassword) changePassword;

  /// When the current Terms were accepted; null when unknown. Never throws.
  final Future<DateTime?> Function() termsAcceptedAt;
}
```

- [ ] **Step 4: Share the clause list and add the reader, in `lib/ui/terms_screen.dart`**

1. Add `import '../attendance/ui/formats.dart';`.
2. Add this top-level function (above `class TermsScreen`):

```dart
/// The numbered clauses, English then Tagalog. One list for the first-login
/// screen and the read-only copy on Profile, so the two can never differ.
List<Widget> termsClauseWidgets() => [
      for (var i = 0; i < AttendanceTerms.clauses.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${i + 1}. ${AttendanceTerms.clauses[i].heading}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
            const SizedBox(height: 4),
            Text(AttendanceTerms.clauses[i].english, style: const TextStyle(fontSize: 14.5, height: 1.4)),
            const SizedBox(height: 4),
            Text(AttendanceTerms.clauses[i].tagalog, style: const TextStyle(fontSize: 13.5, height: 1.4, color: WmColors.textMuted)),
          ]),
        ),
    ];
```

3. In `TermsScreen.build`, replace the whole `for (var i = 0; ...) Padding(...)` element with `...termsClauseWidgets(),`.
4. Append:

```dart
/// The Terms the worker accepted, read-only, from Profile.
class TermsReaderScreen extends StatelessWidget {
  const TermsReaderScreen({super.key, this.acceptedAt});
  final DateTime? acceptedAt;

  @override
  Widget build(BuildContext context) {
    final at = acceptedAt;
    return Scaffold(
      appBar: AppBar(title: const Text('Terms & Conditions', style: TextStyle(fontWeight: FontWeight.w800))),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: [
        if (at != null) ...[
          Text('Accepted ${shortDate(at)}', style: const TextStyle(fontSize: 14, color: WmColors.textMuted)),
          const SizedBox(height: 14),
        ],
        ...termsClauseWidgets(),
      ]),
    );
  }
}
```

- [ ] **Step 5: Write `lib/profile/change_password_sheet.dart`**

```dart
import 'package:flutter/material.dart';

import '../ui/failure_notice.dart';
import '../ui/theme.dart';
import 'password_change.dart';

/// Changing the password (design screen 11). Everything decidable without
/// the network is decided first; pops `true` once the server accepted.
class ChangePasswordSheet extends StatefulWidget {
  const ChangePasswordSheet({super.key, required this.onSave});
  final Future<void> Function(String newPassword) onSave;

  @override
  State<ChangePasswordSheet> createState() => _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends State<ChangePasswordSheet> {
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  PasswordChangeFailure? _failure;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    final local = PasswordChangeFailure.validate(_password.text, _confirm.text);
    if (local != null) return setState(() => _failure = local);
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      await widget.onSave(_password.text);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _failure = PasswordChangeFailure.of(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final failure = _failure;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Change password', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 21)),
            const SizedBox(height: 6),
            const Text('Any 8 letters or numbers. Do not share it with anyone.',
                style: TextStyle(fontSize: 14, color: WmColors.textMuted)),
            const SizedBox(height: 16),
            TextField(
              key: const Key('new-password'),
              controller: _password,
              obscureText: true,
              autofillHints: const [AutofillHints.newPassword],
              decoration: const InputDecoration(labelText: 'New password'),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('confirm-password'),
              controller: _confirm,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Type it again'),
              onSubmitted: (_) => _save(),
            ),
            if (failure != null) ...[
              const SizedBox(height: 12),
              FailureNotice(english: failure.english, tagalog: failure.tagalog),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                  : const Text('SAVE PASSWORD'),
            ),
          ]),
        ),
      ),
    );
  }
}
```

- [ ] **Step 6: Write `lib/profile/profile_screen.dart`**

```dart
import 'package:flutter/material.dart';

import '../attendance/ui/formats.dart';
import '../attendance/ui/status_pill.dart';
import '../auth/worker_profile.dart';
import '../ui/terms_screen.dart';
import '../ui/theme.dart';
import '../ui/worker_header.dart';
import 'account_services.dart';
import 'change_password_sheet.dart';

/// Profile: who is signed in, the password, the Terms they accepted, Log out.
/// Ported from DACS Attendance's ProfileScreen.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    required this.worker,
    required this.versionName,
    required this.onSignOut,
    required this.account,
  });

  final WorkerProfile worker;
  final String versionName;
  final Future<void> Function() onSignOut;
  final AccountServices account;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  DateTime? _acceptedAt;

  @override
  void initState() {
    super.initState();
    _loadAcceptedAt();
  }

  Future<void> _loadAcceptedAt() async {
    try {
      final at = await widget.account.termsAcceptedAt();
      if (mounted) setState(() => _acceptedAt = at);
    } catch (_) {
      // The row then simply offers the terms, with no date.
    }
  }

  Future<void> _changePassword() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => ChangePasswordSheet(onSave: widget.account.changePassword),
    );
    if (changed == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Your password has been changed.')));
    }
  }

  void _openTerms() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TermsReaderScreen(acceptedAt: _acceptedAt)));

  @override
  Widget build(BuildContext context) {
    final w = widget.worker;
    final at = _acceptedAt;
    final position = w.position?.trim();
    return ListView(padding: const EdgeInsets.all(20), children: [
      const Text('Profile', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
      const SizedBox(height: 16),
      WorkerHeader(worker: w),
      const SizedBox(height: 10),
      const Align(alignment: Alignment.centerLeft, child: StatusPill.green('Active account')),
      const SizedBox(height: 18),
      _Card(children: [
        _InfoRow(label: 'Email', value: w.email ?? '--'),
        _InfoRow(label: 'Position', value: position == null || position.isEmpty ? '--' : position),
        _InfoRow(label: 'Worker ID', value: w.workerIdLabel),
      ]),
      const SizedBox(height: 14),
      _Card(children: [
        _ActionRow(
          key: const Key('profile-change-password'),
          icon: Icons.lock_outline,
          title: 'Change password',
          subtitle: 'Update your login',
          onTap: _changePassword,
        ),
        _ActionRow(
          key: const Key('profile-terms'),
          icon: Icons.description_outlined,
          title: 'Terms & Conditions',
          subtitle: at == null ? 'Read the terms you accepted' : 'Accepted ${shortDate(at)}',
          onTap: _openTerms,
        ),
      ]),
      const SizedBox(height: 24),
      OutlinedButton.icon(onPressed: widget.onSignOut, icon: const Icon(Icons.logout), label: const Text('Log out')),
      const SizedBox(height: 16),
      Text("DAC'S WorkMate ${widget.versionName} · By Dacs Building Design Services",
          style: const TextStyle(fontSize: 12.5, color: WmColors.textMeta)),
    ]);
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: WmColors.border),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: WmColors.hairline),
            children[i],
          ],
        ]),
      );
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        child: Row(children: [
          Text(label, style: const TextStyle(fontSize: 14, color: WmColors.textMuted)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(value,
                textAlign: TextAlign.end, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
          ),
        ]),
      );
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({super.key, required this.icon, required this.title, required this.subtitle, required this.onTap});
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
          child: Row(children: [
            Icon(icon, color: WmColors.green),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                Text(subtitle, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
              ]),
            ),
            const Icon(Icons.chevron_right, color: WmColors.textMuted),
          ]),
        ),
      );
}
```

- [ ] **Step 7: Wire Profile into the shell, the app and main**

1. `lib/ui/home_shell.dart`:
   - add imports `import '../profile/account_services.dart';` and `import '../profile/profile_screen.dart';`;
   - add constructor parameter `required this.account,` and field `final AccountServices account;`;
   - replace `_ => _ProfileTab(worker: widget.worker, versionName: widget.versionName, onSignOut: widget.onSignOut),` with
     `_ => ProfileScreen(worker: widget.worker, versionName: widget.versionName, onSignOut: widget.onSignOut, account: widget.account),`;
   - delete the whole `_ProfileTab` class (and its doc comment). Remove `import 'worker_header.dart';` / `import 'theme.dart';` only if `flutter analyze` reports them unused.
2. `lib/app.dart`: add `import 'profile/account_services.dart';`, constructor parameter `required this.account,`, field

```dart
  /// Password change and the Terms date, for Profile.
  final AccountServices account;
```

   and pass `account: widget.account,` to `HomeShell(...)`.
3. `lib/main.dart`: keep the two repositories in variables so Profile can use them. Replace the `controller = AppController(...)` statement with:

```dart
  final auth = AuthRepository(api: SignInApi(httpClient), backend: SupabaseAuthBackend(client, sessionStorage), cache: cache);
  final terms = TermsRepository(backend: SupabaseTermsBackend(client), cache: cache, userAgent: userAgent);
  controller = AppController(auth: auth, terms: terms, updates: updates, nudges: nudges.events);
  final account = AccountServices(
    changePassword: auth.changePassword,
    termsAcceptedAt: () async => switch (controller.state) {
      Ready(:final worker) => terms.acceptedAt(worker.id),
      _ => null,
    },
  );
```

   add `import 'profile/account_services.dart';`, and pass `account: account,` to `WorkMateApp(...)`.
4. `test/ui/screens_test.dart`: add `import 'package:workmate/profile/account_services.dart';` and in `showShell` pass

```dart
      account: AccountServices(changePassword: (_) async {}, termsAcceptedAt: () async => null),
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `flutter test`
Expected: PASS — including the existing `Profile keeps Log out and the version` and the Terms screen test.

- [ ] **Step 9: Stop — no commit.** `flutter analyze` → no issues.

---
### Task 7: What the widget is told, and when (Dart)

The widget reads only a **snapshot** the app pushes; it never touches the network or the database itself (as in DACS Attendance, whose loader read the mirror only). The snapshot is taken from the phone's mirror after every change to today, and on sign-in / sign-out.

**Files:**
- Create: `lib/widget/widget_snapshot.dart`, `lib/widget/widget_bridge.dart`, `lib/widget/widget_publisher.dart`, `lib/widget/widget_aware_attendance.dart`, `lib/widget/widget_app_sync.dart`
- Modify: `lib/main.dart`
- Test: `test/widget/widget_publisher_test.dart`, `test/widget/widget_aware_attendance_test.dart`, `test/widget/widget_app_sync_test.dart`

**Interfaces:**
- Consumes: `AttendanceDb.recordFor(String workerId, String workDate)`, `AttendanceDb.hasPendingFor(String workerId)`, `WorkDate.today([DateTime? now])`, `AttendanceApi`, `AppState` / `Ready` / `SignedOut` (`lib/app_controller.dart`).
- Produces: `class WidgetSnapshot` (`signedIn`, `workDate`, `status`, `timeInAt`, `timeOutAt`, `notSentYet`, `readFailed`; `const WidgetSnapshot.signedOut()`; `Map<String, Object?> toMap()` with keys `signedIn, workDate, status, timeInAt, timeOutAt, notSentYet, readFailed`, times as epoch **milliseconds**); `abstract interface class WidgetBridge { Future<void> push(WidgetSnapshot snapshot); }`; `class ChannelWidgetBridge implements WidgetBridge` on channel **`com.dacs.workmate/widget`**, method **`push`** (Task 10 implements the native side); `class WidgetPublisher(WidgetBridge bridge, {DateTime Function()? now})` with `Future<WidgetSnapshot> snapshotFor(AttendanceDb db, String workerId)` and `Future<void> publish(AttendanceDb db, String workerId)` (never throws); `class WidgetAwareAttendance implements AttendanceApi` (`WidgetAwareAttendance(AttendanceApi inner, {required Future<void> Function() onTodayChanged})`); `class WidgetAppSync(Future<void> Function() publish)` with `void onAppState(AppState state)`.

- [ ] **Step 1: Write the failing tests**

```dart
// test/widget/widget_publisher_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/attendance/data/attendance_db.dart';
import 'package:workmate/attendance/data/submission_request.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/widget/widget_bridge.dart';
import 'package:workmate/widget/widget_publisher.dart';
import 'package:workmate/widget/widget_snapshot.dart';

class RecordingBridge implements WidgetBridge {
  final pushed = <Map<String, Object?>>[];
  Object? error;
  @override
  Future<void> push(WidgetSnapshot snapshot) async {
    if (error != null) throw error!;
    pushed.add(snapshot.toMap());
  }
}

void main() {
  late AttendanceDb db;
  late RecordingBridge bridge;
  final now = DateTime.parse('2026-09-11T02:00:00Z'); // 10:00, Friday 11 Sep, Manila
  final timeIn = DateTime.parse('2026-09-11T00:52:00Z');

  WidgetPublisher publisher() => WidgetPublisher(bridge, now: () => now);

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await AttendanceDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    bridge = RecordingBridge();
  });
  tearDown(() async {
    try {
      await db.close();
    } catch (_) {}
  });

  test('nobody signed in: the sign-in state, and nothing about the last worker', () async {
    await db.upsertRecord('w1', AttendanceRecord(id: 'r', workDate: '2026-09-11', status: AttendanceStatus.working, timeInAt: timeIn), pending: false);
    final s = await publisher().snapshotFor(db, '');
    expect(s.toMap(), {
      'signedIn': false,
      'workDate': null,
      'status': null,
      'timeInAt': null,
      'timeOutAt': null,
      'notSentYet': false,
      'readFailed': false,
    });
  });

  test('no record today: today, no status', () async {
    final s = await publisher().snapshotFor(db, 'w1');
    expect(s.signedIn, isTrue);
    expect(s.workDate, '2026-09-11');
    expect(s.status, isNull);
    expect(s.notSentYet, isFalse);
  });

  test("an open day carries its Time In, and a queued row says not sent yet", () async {
    await db.upsertRecord('w1', AttendanceRecord(id: 'r', workDate: '2026-09-11', status: AttendanceStatus.working, timeInAt: timeIn), pending: true);
    await db.insertPending(PendingSubmission.fromRequest(
      SubmissionRequest(
          direction: TimeDirection.timeIn, projectSystem: ProjectSystem.pc, projectId: 'p1', capturedAt: timeIn,
          trustedAt: null, photoPath: '/x/e1.jpg', description: null, eventId: 'e1'),
      workerId: 'w1',
      projectName: 'ABC',
      createdAt: timeIn,
    ));
    final m = (await publisher().snapshotFor(db, 'w1')).toMap();
    expect(m['status'], 'working');
    expect(m['timeInAt'], timeIn.millisecondsSinceEpoch);
    expect(m['notSentYet'], isTrue);
  });

  test("another worker's day is not this worker's", () async {
    await db.upsertRecord('w2', AttendanceRecord(id: 'r', workDate: '2026-09-11', status: AttendanceStatus.complete), pending: false);
    expect((await publisher().snapshotFor(db, 'w1')).status, isNull);
  });

  test('a mirror that cannot be read says so, rather than "not timed in"', () async {
    await db.close();
    final s = await publisher().snapshotFor(db, 'w1');
    expect(s.signedIn, isTrue);
    expect(s.readFailed, isTrue);
  });

  test('publish pushes the snapshot, and a bridge failure never escapes', () async {
    await publisher().publish(db, 'w1');
    expect(bridge.pushed.single['workDate'], '2026-09-11');
    bridge.error = StateError('no widget host');
    await publisher().publish(db, 'w1'); // must not throw
  });
}
```

```dart
// test/widget/widget_aware_attendance_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/data/submission_request.dart';
import 'package:workmate/attendance/domain/attendance_record.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/widget/widget_aware_attendance.dart';

import '../attendance/fakes.dart';

SubmissionRequest req() => SubmissionRequest(
    direction: TimeDirection.timeIn, projectSystem: ProjectSystem.pc, projectId: 'p1',
    capturedAt: DateTime.parse('2026-09-11T00:52:00Z'), trustedAt: null, photoPath: '/x.jpg', description: null, eventId: 'e1');

void main() {
  late FakeAttendance inner;
  late int told;
  late WidgetAwareAttendance api;

  setUp(() {
    inner = FakeAttendance();
    told = 0;
    api = WidgetAwareAttendance(inner, onTodayChanged: () async => told++);
  });

  test('a submit tells the widget, so it flips the moment the worker submits', () async {
    await api.submit(req());
    expect(inner.submitted.length, 1);
    expect(told, 1);
  });

  test('a failed submit still tells the widget, and still fails', () async {
    inner.submitError = StateError('AUTH_REQUIRED');
    await expectLater(api.submit(req()), throwsStateError);
    expect(told, 1);
  });

  test("reading today tells the widget: that is where the server's corrections land", () async {
    inner.todayRecord = const AttendanceRecord(id: 'r', workDate: '2026-09-11', status: AttendanceStatus.complete);
    expect((await api.today())!.status, AttendanceStatus.complete);
    expect(told, 1);
  });

  test('history and projects do not', () async {
    await api.history('2026-09-07', '2026-09-11');
    await api.activeProjects();
    expect(told, 0);
  });

  test('a widget that cannot be told never breaks a Time In', () async {
    api = WidgetAwareAttendance(inner, onTodayChanged: () async => throw StateError('boom'));
    await api.submit(req());
    expect(inner.submitted.length, 1);
  });
}
```

```dart
// test/widget/widget_app_sync_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/app_controller.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/widget/widget_app_sync.dart';

void main() {
  const juan = WorkerProfile(id: 'u1');

  test('sign-in and sign-out each update the widget once', () {
    var published = 0;
    final sync = WidgetAppSync(() async => published++);
    sync.onAppState(Starting());
    expect(published, 0);
    sync.onAppState(Ready(juan));
    sync.onAppState(Ready(juan)); // a re-notify (update check) is not a change
    expect(published, 1);
    sync.onAppState(Starting());
    sync.onAppState(SignedOut());
    expect(published, 2);
  });

  test('the Terms screens leave the widget as it was', () {
    var published = 0;
    final sync = WidgetAppSync(() async => published++);
    sync.onAppState(NeedsTerms(juan));
    sync.onAppState(TermsUnavailable(juan));
    expect(published, 0);
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/widget`
Expected: FAIL — `lib/widget/...` files not found.

- [ ] **Step 3: Write the five files**

```dart
// lib/widget/widget_snapshot.dart

/// What the home-screen widget is told about today. Deliberately says nothing
/// about WHO -- no name, no project: a site phone lies on a table in front of
/// everyone, and the widget is readable without unlocking it.
///
/// The native side (TimeWidgetProvider, WidgetRules.kt) turns this into the
/// card, and decides "is this still today?" itself at every redraw, so a
/// snapshot from yesterday rolls over at Manila midnight with no app running.
class WidgetSnapshot {
  const WidgetSnapshot({
    required this.signedIn,
    this.workDate,
    this.status,
    this.timeInAt,
    this.timeOutAt,
    this.notSentYet = false,
    this.readFailed = false,
  });

  const WidgetSnapshot.signedOut() : this(signedIn: false);

  final bool signedIn;

  /// The day the snapshot describes (ISO, Manila).
  final String? workDate;

  /// The record's status name ('working', 'complete', 'abandoned', 'unknown'); null = no record that day.
  final String? status;
  final DateTime? timeInAt;
  final DateTime? timeOutAt;

  /// This worker still has a submission queued on the phone.
  final bool notSentYet;

  /// The phone's own copy could not be read: the widget says so and guesses nothing.
  final bool readFailed;

  Map<String, Object?> toMap() => {
        'signedIn': signedIn,
        'workDate': workDate,
        'status': status,
        'timeInAt': timeInAt?.millisecondsSinceEpoch,
        'timeOutAt': timeOutAt?.millisecondsSinceEpoch,
        'notSentYet': notSentYet,
        'readFailed': readFailed,
      };
}
```

```dart
// lib/widget/widget_bridge.dart
import 'package:flutter/services.dart';

import 'widget_snapshot.dart';

/// Hands a snapshot to the native widget.
abstract interface class WidgetBridge {
  Future<void> push(WidgetSnapshot snapshot);
}

/// The packages/workmate_widget_bridge plugin. A PLUGIN, not a MainActivity
/// channel: WorkManager's background engine has plugins but no activity, and a
/// background send must update the widget too.
class ChannelWidgetBridge implements WidgetBridge {
  const ChannelWidgetBridge();

  static const _channel = MethodChannel('com.dacs.workmate/widget');

  @override
  Future<void> push(WidgetSnapshot snapshot) => _channel.invokeMethod<void>('push', snapshot.toMap());
}
```

```dart
// lib/widget/widget_publisher.dart
import 'package:flutter/foundation.dart';

import '../attendance/data/attendance_db.dart';
import '../attendance/domain/work_date.dart';
import 'widget_bridge.dart';
import 'widget_snapshot.dart';

/// Takes today's snapshot from the phone's mirror and hands it to the widget.
/// The mirror only -- never the network: the app has already reconciled it.
class WidgetPublisher {
  WidgetPublisher(this._bridge, {DateTime Function()? now}) : _now = now ?? DateTime.now;

  final WidgetBridge _bridge;
  final DateTime Function() _now;

  /// [workerId] is '' when nobody is let in: the widget then asks for a sign-in.
  Future<WidgetSnapshot> snapshotFor(AttendanceDb db, String workerId) async {
    if (workerId.isEmpty) return const WidgetSnapshot.signedOut();
    try {
      final today = WorkDate.today(_now()).iso;
      final record = await db.recordFor(workerId, today);
      final pending = await db.hasPendingFor(workerId);
      return WidgetSnapshot(
        signedIn: true,
        workDate: today,
        status: record?.status.name,
        timeInAt: record?.timeInAt,
        timeOutAt: record?.timeOutAt,
        notSentYet: pending,
      );
    } catch (_) {
      return const WidgetSnapshot(signedIn: true, readFailed: true);
    }
  }

  /// Never throws: a widget that cannot be told must not break a Time In.
  Future<void> publish(AttendanceDb db, String workerId) async {
    try {
      await _bridge.push(await snapshotFor(db, workerId));
    } catch (e) {
      debugPrint('Widget update failed: $e');
    }
  }
}
```

```dart
// lib/widget/widget_aware_attendance.dart
import '../attendance/data/attendance_api.dart';
import '../attendance/data/submission_request.dart';
import '../attendance/domain/attendance_record.dart';

/// The attendance engine, telling the widget whenever today may have changed.
/// A decorator rather than calls sprinkled through the repository (ported from
/// DACS Attendance's WidgetAwareAttendanceRepository): submit is the optimistic
/// write, so the widget flips the moment the worker submits, signal or not;
/// today() is where Home reconciles with the server, so an admin correction
/// reaches the widget too.
class WidgetAwareAttendance implements AttendanceApi {
  WidgetAwareAttendance(this._inner, {required Future<void> Function() onTodayChanged}) : _onTodayChanged = onTodayChanged;

  final AttendanceApi _inner;
  final Future<void> Function() _onTodayChanged;

  @override
  Future<AttendanceRecord> submit(SubmissionRequest r, {bool mirrorPhoto = false}) async {
    try {
      return await _inner.submit(r, mirrorPhoto: mirrorPhoto);
    } finally {
      await _tell();
    }
  }

  @override
  Future<AttendanceRecord?> today() async {
    try {
      return await _inner.today();
    } finally {
      await _tell();
    }
  }

  @override
  Future<List<AttendanceRecord>> history(String from, String to) => _inner.history(from, to);

  @override
  Future<List<AttendanceProject>> activeProjects() => _inner.activeProjects();

  @override
  Future<List<PendingSubmission>> refusedSubmissions() => _inner.refusedSubmissions();

  @override
  Future<void> dismissRefused(String eventId) => _inner.dismissRefused(eventId);

  Future<void> _tell() async {
    try {
      await _onTodayChanged();
    } catch (_) {
      // Never let the widget break attendance.
    }
  }
}
```

```dart
// lib/widget/widget_app_sync.dart
import 'dart:async';

import '../app_controller.dart';

/// Sign-in and sign-out reach the widget. Sign-out matters most: site phones
/// are shared, and a widget still showing the last worker's day after they
/// signed out is exactly the leak the worker cache is careful to avoid.
class WidgetAppSync {
  WidgetAppSync(this._publish);

  final Future<void> Function() _publish;
  Type? _last;

  void onAppState(AppState state) {
    // Starting and the Terms screens are passing states: leave the widget alone.
    if (state is! Ready && state is! SignedOut) return;
    if (state.runtimeType == _last) return;
    _last = state.runtimeType;
    unawaited(_publish());
  }
}
```

- [ ] **Step 4: Wire it in `lib/main.dart`**

Add imports:

```dart
import 'widget/widget_app_sync.dart';
import 'widget/widget_aware_attendance.dart';
import 'widget/widget_bridge.dart';
import 'widget/widget_publisher.dart';
```

Directly after the `controller = AppController(...)` statement (and before `final account = ...`), add:

```dart
  // The home-screen widget follows every change to today, and every sign-in / sign-out.
  final widgets = WidgetPublisher(const ChannelWidgetBridge());
  Future<void> publishWidget() => widgets.publish(attendance.db, attendance.currentWorkerId());
  final widgetSync = WidgetAppSync(publishWidget);
  controller.addListener(() => widgetSync.onAppState(controller.state));
```

In the `AttendanceServices(...)` call, change `attendance: attendance,` to

```dart
    attendance: WidgetAwareAttendance(attendance, onTodayChanged: publishWidget),
```

(Until Task 10 adds the plugin the push fails with `MissingPluginException`; `publish` swallows it, so the app behaves exactly as before.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test`
Expected: PASS — everything.

- [ ] **Step 6: Stop — no commit.** `flutter analyze` → no issues.

---

### Task 8: Background sends update the widget and Home

Today a Time In sent by WorkManager leaves Home showing "Not sent yet" until pull-to-refresh (the 0C-2 gap), and would leave the widget showing `QUEUED · WILL UPLOAD`. After this task, whichever engine drains the queue reports it.

**Files:**
- Create: `lib/attendance/sync/queue_settled.dart`
- Modify: `lib/attendance/sync/submission_sync.dart` (count settled rows)
- Modify: `lib/attendance/sync/background_sync.dart` (`syncWith(..., afterChange:)`; background engine publishes the widget)
- Modify: `lib/attendance/home/home_controller.dart` (`refresh({bool sendQueued = true})`)
- Modify: `lib/attendance/attendance_services.dart` (`queueSettled`)
- Modify: `lib/ui/home_shell.dart` (listen to `queueSettled`)
- Modify: `lib/main.dart`
- Test: append to `test/attendance/sync/submission_sync_test.dart`, `test/attendance/home/home_controller_test.dart`, `test/ui/screens_test.dart`

**Interfaces:**
- Consumes: Task 7 (`WidgetPublisher.publish(AttendanceDb, String)`, `ChannelWidgetBridge`).
- Produces: `SubmissionSync.settled` (`int`, rows sent, dropped or refused for good in the last `drain`); `Future<bool> syncWith(SupabaseClient client, {Future<void> Function(AttendanceDb db, String workerId)? afterChange})`; `class QueueSettled extends ChangeNotifier { void fire(); }`; `HomeController.refresh({bool sendQueued = true})`; `AttendanceServices.queueSettled` (`Listenable?`).

- [ ] **Step 1: Write the failing tests**

Append inside `main()` of `test/attendance/sync/submission_sync_test.dart` (it already has `queue(eventId, direction, created)`, `remote`, `sync`, `db`):

```dart
  test('settled counts every row the drain finished with', () async {
    await queue('e1', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    await queue('e2', TimeDirection.timeOut, '2026-08-19T09:30:00Z');
    expect(await sync.drain('w1'), SyncResult.done);
    expect(sync.settled, 2);
  });

  test('a drain stopped by no signal settled nothing', () async {
    await queue('e1', TimeDirection.timeIn, '2026-08-18T23:45:00Z');
    remote.failures['e1'] = const SocketException('down');
    expect(await sync.drain('w1'), SyncResult.retry);
    expect(sync.settled, 0);
  });
```

Append inside `main()` of `test/attendance/home/home_controller_test.dart`:

```dart
  test('a refresh after a background send does not ask to send again', () async {
    final c = home();
    await c.refresh(sendQueued: false);
    await settle();
    expect(scheduler.sendNows, 0);
    await c.refresh();
    await settle();
    expect(scheduler.sendNows, 1);
  });
```

Append inside `main()` of `test/ui/screens_test.dart` (add `import 'package:workmate/attendance/domain/attendance_record.dart';` and `import 'package:workmate/attendance/sync/queue_settled.dart';` at the top):

```dart
  testWidgets('Home shows "Saved" as soon as a background send lands', (tester) async {
    useTallPhone(tester);
    final attendance = FakeAttendance()
      ..todayRecord = AttendanceRecord(
          id: 'r', workDate: '2026-10-02', status: AttendanceStatus.working, timeInAt: DateTime.now().toUtc(), pending: true);
    final scheduler = FakeScheduler();
    final settled = QueueSettled();
    await tester.pumpWidget(wrap(HomeShell(
      worker: const WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42),
      versionName: '0.3.0',
      onSignOut: () async {},
      account: AccountServices(changePassword: (_) async {}, termsAcceptedAt: () async => null),
      services: AttendanceServices(
        attendance: attendance,
        device: FakeDevice(),
        scheduler: scheduler,
        trustedNow: () async => null,
        photoUrl: (_) async => null,
        openSettings: (_) async {},
        cameraStep: (context, args) => const Text('camera'),
        queueSettled: settled,
      ),
    )));
    await tester.pumpAndSettle();
    expect(find.text('Not sent yet'), findsOneWidget);
    final sendsBefore = scheduler.sendNows;

    attendance.todayRecord = AttendanceRecord(
        id: 'r', workDate: '2026-10-02', status: AttendanceStatus.working, timeInAt: DateTime.now().toUtc());
    settled.fire();
    await tester.pumpAndSettle();
    expect(find.text('Saved'), findsOneWidget);
    expect(scheduler.sendNows, sendsBefore); // no send loop
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/attendance/sync/submission_sync_test.dart test/attendance/home/home_controller_test.dart test/ui/screens_test.dart`
Expected: FAIL — `settled`, `sendQueued`, `queue_settled.dart`, `queueSettled` undefined.

- [ ] **Step 3: Implement**

`lib/attendance/sync/queue_settled.dart`:

```dart
import 'package:flutter/foundation.dart';

/// "The live app's drain just sent (or settled) queued rows." Home re-reads
/// today on it, so "Not sent yet" turns into "Saved" without a pull.
class QueueSettled extends ChangeNotifier {
  void fire() => notifyListeners();
}
```

`lib/attendance/sync/submission_sync.dart`:
- add the field after `final AttendanceRemote remote;`:

```dart
  /// Rows the last [drain] finished with: sent, dropped for the server's
  /// version, or refused for good. Zero means nothing on the phone changed.
  int settled = 0;
```

- replace the body of `drain` with:

```dart
  Future<SyncResult> drain(String workerId) async {
    settled = 0;
    // With no session nothing may be sent: the RPC would file it under whoever signs in next.
    if (workerId.isEmpty) return SyncResult.done;
    for (var i = 0; i < _maxPerRun; i++) {
      final queue = await db.sendable(workerId);
      final next = nextToSend(queue.map((p) => p.toQueued()).toList(), workerId);
      if (next == null) return SyncResult.done;
      final row = queue.firstWhere((p) => p.eventId == next.eventId);
      if (await _send(row, workerId) == SyncResult.retry) return SyncResult.retry;
      settled++;
    }
    return SyncResult.done;
  }
```

`lib/attendance/sync/background_sync.dart`:
- add imports `import '../../widget/widget_bridge.dart';` and `import '../../widget/widget_publisher.dart';`;
- in `runBackgroundSync`, replace `return syncWith(client);` with

```dart
  // No live app: this engine updates the widget itself (the plugin works here).
  return syncWith(client, afterChange: WidgetPublisher(const ChannelWidgetBridge()).publish);
```

- replace `syncWith`'s signature and its `try { ... } finally { ... }` block:

```dart
/// Refresh the session if needed, then drain this worker's queue. Shared by the
/// background isolate and the live app's [AttendanceSyncHost]. [afterChange]
/// runs when the drain settled at least one row, with the drain's own database.
Future<bool> syncWith(SupabaseClient client, {Future<void> Function(AttendanceDb db, String workerId)? afterChange}) async {
```

```dart
  try {
    final sync = SubmissionSync(db: db, remote: SupabaseAttendanceRemote(client));
    final result = await sync.drain(workerId);
    if (sync.settled > 0 && afterChange != null) {
      try {
        await afterChange(db, workerId);
      } catch (_) {
        // The rows are sent; telling the screens is best effort.
      }
    }
    return result == SyncResult.done;
  } finally {
    await db.close();
  }
```

`lib/attendance/home/home_controller.dart` — change `Future<void> refresh() async {` to

```dart
  /// [sendQueued] false when the refresh is BECAUSE a send just finished:
  /// asking to send again would loop.
  Future<void> refresh({bool sendQueued = true}) async {
```

and wrap the send line: `if (sendQueued) unawaited(_quietly(_scheduler.sendNow));`.
Note: `RefreshIndicator(onRefresh: c.refresh)` still type-checks (all parameters optional).

`lib/attendance/attendance_services.dart` — add constructor parameter `this.queueSettled,` and field

```dart
  /// Fires when the live app's background drain settled rows (main.dart).
  final Listenable? queueSettled;
```

`lib/ui/home_shell.dart`:
- in `initState`, after `_home.refresh();` add `s.queueSettled?.addListener(_onQueueSettled);`
- in `dispose`, first line: `widget.services.queueSettled?.removeListener(_onQueueSettled);`
- add the method:

```dart
  void _onQueueSettled() {
    // Not while recording: the flow owns the screen, and _endFlow refreshes anyway.
    if (_flow == null) _home.refresh(sendQueued: false);
    if (_tab == 1) _history.refresh();
  }
```

`lib/main.dart`:
- add `import 'attendance/sync/queue_settled.dart';`;
- move the line `final widgets = WidgetPublisher(const ChannelWidgetBridge());` (from Task 7) up to just before the `syncHost` line, and replace the `syncHost` line with:

```dart
  // The live app is the one token refresher: background tasks delegate here.
  // Registered again on every resume (a slow answer can drop the mapping).
  // What it sends reaches the widget and Home at once.
  final queueSettled = QueueSettled();
  final syncHost = AttendanceSyncHost(
    drain: () => syncWith(client, afterChange: (db, workerId) async {
      await widgets.publish(db, workerId);
      queueSettled.fire();
    }),
  )..register();
```

- pass `queueSettled: queueSettled,` to `AttendanceServices(...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test`
Expected: PASS — everything.

- [ ] **Step 5: Stop — no commit.** `flutter analyze` → no issues.

---

### Task 9: Widget rules in Kotlin

The card is decided by pure Kotlin, ported from `domain/WidgetState.kt`, `widget/WidgetCard.kt` and `typeScale` with their JUnit tests. `java.time` is used **only in the tests** (desktop JVM); app code uses epoch milliseconds.

**Files:**
- Create: `android/app/src/main/kotlin/com/dacs/workmate/widget/WidgetRules.kt`
- Create: `android/app/src/main/res/values/widget_strings.xml`
- Test: `android/app/src/test/kotlin/com/dacs/workmate/widget/WidgetStateTest.kt`, `WidgetCardTest.kt`, `WidgetTypeScaleTest.kt`

**Interfaces:**
- Consumes: the snapshot fields of Task 7 (`signedIn`, `workDate`, `status`, `timeInAt`/`timeOutAt` epoch ms, `notSentYet`, `readFailed`).
- Produces (package `com.dacs.workmate.widget`): `data class WidgetSnapshot(signedIn, workDate, status, timeInAt: Long?, timeOutAt: Long?, notSentYet, readFailed)`; `enum class TimeDirection { IN, OUT }`; `sealed interface WidgetState` (`SignedOut`, `NotTimedIn`, `Working(timeInAt: Long?)`, `Complete(timeInAt, timeOutAt)`, `Abandoned`, `Unknown`, each with `notSentYet`; `val action: TimeDirection?`); `fun manilaIsoDate(epochMillis: Long): String`; `fun widgetStateFor(snapshot: WidgetSnapshot?, today: String): WidgetState`; `enum class WidgetTone`; `sealed interface WidgetPill` (`None`, `Label(@StringRes text)`, `Elapsed(since: Long)`); `sealed interface WidgetSubtitle` (`Label`, `DaySpan(timeIn: Long, timeOut: Long)`); `data class WidgetCard(tone, pill, title, subtitle, breadcrumb, queued, done, action)`; `fun widgetCardFor(state: WidgetState): WidgetCard`; `data class CardType(title, subtitle, pill, footer, arrow: Float)`; `fun typeScale(widthDp: Float, heightDp: Float, titleLength: Int): CardType`; `const val FULL_CARD_MIN_HEIGHT_DP = 100f`, `const val SUBTITLE_MIN_HEIGHT_DP = 138f`.

- [ ] **Step 1: Write the strings** — `android/app/src/main/res/values/widget_strings.xml` (copied from DACS Attendance; only the signed-out title names WorkMate):

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The home-screen widget's words. English, like every screen label.
     From DACS Attendance strings.xml; the signed-out title names this app. -->
<resources>
    <string name="widget_label">Time In / Out</string>
    <string name="widget_description">Today\'s status, and Time In or Time Out in one tap.</string>
    <string name="widget_done_no_times">Done for today</string>

    <string name="widget_pill_step_one">STEP 1 OF 4</string>
    <string name="widget_pill_on_site">ON SITE</string>
    <string name="widget_pill_all_done">ALL DONE</string>
    <string name="widget_pill_no_time_out">NO TIME OUT</string>
    <string name="widget_pill_sign_in">SIGN IN</string>
    <string name="widget_pill_queued">QUEUED · WILL UPLOAD</string>

    <string name="widget_card_time_in">Time In</string>
    <string name="widget_card_time_out">Time Out</string>
    <string name="widget_card_complete">Complete</string>
    <string name="widget_card_day_closed">Day closed</string>
    <string name="widget_card_open_app">Open the app</string>
    <string name="widget_card_sign_in">DAC\'S WorkMate</string>

    <string name="widget_sub_start_day">Tap to start your day</string>
    <string name="widget_sub_close_day">Tap to close out your day</string>
    <string name="widget_sub_sort_out">Open the app to sort today out</string>
    <string name="widget_sub_unavailable">Today\'s status isn\'t available here</string>
    <string name="widget_sub_sign_in">Sign in to time in</string>
    <string name="widget_sub_day_span">%1$s – %2$s</string>

    <string name="widget_flow_in">project · photo · check · submit</string>
    <string name="widget_flow_out">photo · check · submit</string>
</resources>
```

- [ ] **Step 2: Write the failing tests**

```kotlin
// android/app/src/test/kotlin/com/dacs/workmate/widget/WidgetStateTest.kt
package com.dacs.workmate.widget

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Ported from DACS Attendance WidgetStateTest. The widget is a glance at the
 * home screen, so what it claims has to be exactly what the app would say --
 * and nothing about anyone else.
 */
class WidgetStateTest {

    private val today = "2026-09-11"
    /** 8:52 AM in Manila. */
    private val timeIn = Instant.parse("2026-09-11T00:52:00Z").toEpochMilli()
    /** 5:10 PM in Manila. */
    private val timeOut = Instant.parse("2026-09-11T09:10:00Z").toEpochMilli()

    private fun snap(
        status: String?,
        workDate: String? = today,
        signedIn: Boolean = true,
        timeInAt: Long? = timeIn,
        timeOutAt: Long? = null,
        notSentYet: Boolean = false,
        readFailed: Boolean = false
    ) = WidgetSnapshot(signedIn, workDate, status, timeInAt, timeOutAt, notSentYet, readFailed)

    @Test
    fun `nobody signed in shows the sign-in state even when times are lying around`() {
        val state = widgetStateFor(snap("working", signedIn = false, notSentYet = true), today)
        assertEquals(WidgetState.SignedOut, state)
        assertNull(state.action)
    }

    @Test
    fun `a widget the app never told says it cannot say`() {
        assertEquals(WidgetState.Unknown(), widgetStateFor(null, today))
    }

    @Test
    fun `no record today offers Time In`() {
        val state = widgetStateFor(snap(null), today)
        assertEquals(WidgetState.NotTimedIn(notSentYet = false), state)
        assertEquals(TimeDirection.IN, state.action)
    }

    @Test
    fun `yesterday's record is not today's`() {
        // The snapshot is from before midnight. Showing yesterday's "Complete"
        // this morning would hide the Time In button.
        val state = widgetStateFor(snap("complete", workDate = "2026-09-10", timeOutAt = timeOut), today)
        assertEquals(WidgetState.NotTimedIn(notSentYet = false), state)
    }

    @Test
    fun `an open day offers Time Out`() {
        val state = widgetStateFor(snap("working"), today)
        assertEquals(WidgetState.Working(timeInAt = timeIn, notSentYet = false), state)
        assertEquals(TimeDirection.OUT, state.action)
    }

    @Test
    fun `a finished day offers nothing`() {
        val state = widgetStateFor(snap("complete", timeOutAt = timeOut), today)
        assertEquals(WidgetState.Complete(timeIn, timeOut, notSentYet = false), state)
        assertNull(state.action)
    }

    @Test
    fun `an abandoned day offers nothing`() {
        val state = widgetStateFor(snap("abandoned"), today)
        assertEquals(WidgetState.Abandoned(notSentYet = false), state)
        assertNull(state.action)
    }

    @Test
    fun `a status this build does not know offers nothing rather than guessing`() {
        val state = widgetStateFor(snap("excused"), today)
        assertEquals(WidgetState.Unknown(notSentYet = false), state)
        assertNull(state.action)
    }

    @Test
    fun `a queued submission is flagged not sent yet`() {
        assertEquals(
            WidgetState.Working(timeInAt = timeIn, notSentYet = true),
            widgetStateFor(snap("working", notSentYet = true), today)
        )
    }

    @Test
    fun `a queued row with no record today is still flagged`() {
        assertEquals(WidgetState.NotTimedIn(notSentYet = true), widgetStateFor(snap(null, notSentYet = true), today))
    }

    @Test
    fun `an unreadable mirror is not "not timed in"`() {
        assertEquals(WidgetState.Unknown(), widgetStateFor(snap(null, workDate = null, readFailed = true), today))
    }

    @Test
    fun `today is Manila's date, not UTC's`() {
        // 16:30 UTC on the 10th is 00:30 on the 11th in Manila.
        assertEquals("2026-09-11", manilaIsoDate(Instant.parse("2026-09-10T16:30:00Z").toEpochMilli()))
        assertEquals("2026-09-10", manilaIsoDate(Instant.parse("2026-09-10T15:59:00Z").toEpochMilli()))
    }
}
```

```kotlin
// android/app/src/test/kotlin/com/dacs/workmate/widget/WidgetCardTest.kt
package com.dacs.workmate.widget

import com.dacs.workmate.R
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ported from DACS Attendance WidgetCardTest. The card is the whole widget,
 * so these pin every phrase the home screen can show.
 */
class WidgetCardTest {

    /** 7:52 AM in Manila. */
    private val timeIn = Instant.parse("2026-09-14T23:52:00Z").toEpochMilli()
    /** 4:56 PM in Manila. */
    private val timeOut = Instant.parse("2026-09-15T08:56:00Z").toEpochMilli()

    @Test
    fun `nothing recorded yet offers Time In and warns of four steps`() {
        val card = widgetCardFor(WidgetState.NotTimedIn())
        assertEquals(WidgetTone.START, card.tone)
        assertEquals(WidgetPill.Label(R.string.widget_pill_step_one), card.pill)
        assertEquals(R.string.widget_card_time_in, card.title)
        assertEquals(WidgetSubtitle.Label(R.string.widget_sub_start_day), card.subtitle)
        assertEquals(R.string.widget_flow_in, card.breadcrumb)
        assertEquals(TimeDirection.IN, card.action)
        assertFalse(card.done)
    }

    @Test
    fun `on site counts up from the recorded time in`() {
        val card = widgetCardFor(WidgetState.Working(timeIn))
        assertEquals(WidgetTone.WORKING, card.tone)
        assertEquals(WidgetPill.Elapsed(timeIn), card.pill)
        assertEquals(R.string.widget_card_time_out, card.title)
        assertEquals(WidgetSubtitle.Label(R.string.widget_sub_close_day), card.subtitle)
        assertEquals(R.string.widget_flow_out, card.breadcrumb)
        assertEquals(TimeDirection.OUT, card.action)
    }

    @Test
    fun `on site without a recorded time in shows no live count`() {
        val card = widgetCardFor(WidgetState.Working(timeInAt = null))
        assertEquals(WidgetPill.Label(R.string.widget_pill_on_site), card.pill)
        assertEquals(TimeDirection.OUT, card.action)
    }

    @Test
    fun `a closed day shows both stamps and a tick`() {
        val card = widgetCardFor(WidgetState.Complete(timeIn, timeOut))
        assertEquals(WidgetTone.COMPLETE, card.tone)
        assertEquals(WidgetPill.Label(R.string.widget_pill_all_done), card.pill)
        assertEquals(R.string.widget_card_complete, card.title)
        assertEquals(WidgetSubtitle.DaySpan(timeIn, timeOut), card.subtitle)
        assertTrue(card.done)
        assertNull(card.breadcrumb)
        assertNull(card.action)
    }

    @Test
    fun `a closed day missing a stamp says so rather than printing a gap`() {
        val card = widgetCardFor(WidgetState.Complete(timeIn, timeOutAt = null))
        assertEquals(WidgetSubtitle.Label(R.string.widget_done_no_times), card.subtitle)
        assertTrue(card.done)
    }

    @Test
    fun `a day closed without a Time Out asks for a person`() {
        val card = widgetCardFor(WidgetState.Abandoned())
        assertEquals(WidgetTone.ATTENTION, card.tone)
        assertEquals(WidgetPill.Label(R.string.widget_pill_no_time_out), card.pill)
        assertEquals(R.string.widget_card_day_closed, card.title)
        assertEquals(WidgetSubtitle.Label(R.string.widget_sub_sort_out), card.subtitle)
        assertNull(card.action)
        assertFalse(card.done)
    }

    @Test
    fun `a status this build cannot name guesses nothing`() {
        val card = widgetCardFor(WidgetState.Unknown())
        assertEquals(WidgetTone.NEUTRAL, card.tone)
        assertEquals(WidgetPill.None, card.pill)
        assertEquals(R.string.widget_card_open_app, card.title)
        assertEquals(WidgetSubtitle.Label(R.string.widget_sub_unavailable), card.subtitle)
        assertNull(card.breadcrumb)
        assertNull(card.action)
    }

    @Test
    fun `signed out invites a sign-in and starts no flow`() {
        val card = widgetCardFor(WidgetState.SignedOut)
        assertEquals(WidgetPill.Label(R.string.widget_pill_sign_in), card.pill)
        assertEquals(R.string.widget_card_sign_in, card.title)
        assertEquals(WidgetSubtitle.Label(R.string.widget_sub_sign_in), card.subtitle)
        assertNull(card.action)
        assertFalse(card.queued)
    }

    @Test
    fun `a queued stamp still leaves Time Out reachable`() {
        val card = widgetCardFor(WidgetState.Working(timeIn, notSentYet = true))
        assertTrue(card.queued)
        assertEquals(WidgetTone.WORKING, card.tone)
        assertEquals(TimeDirection.OUT, card.action)
        assertEquals(WidgetPill.Elapsed(timeIn), card.pill)
    }

    @Test
    fun `a queued stamp before timing in keeps the Time In card`() {
        val card = widgetCardFor(WidgetState.NotTimedIn(notSentYet = true))
        assertTrue(card.queued)
        assertEquals(TimeDirection.IN, card.action)
    }

    @Test
    fun `nothing queued leaves the breadcrumb alone`() {
        assertFalse(widgetCardFor(WidgetState.Working(timeIn)).queued)
    }
}
```

```kotlin
// android/app/src/test/kotlin/com/dacs/workmate/widget/WidgetTypeScaleTest.kt
package com.dacs.workmate.widget

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ported from DACS Attendance WidgetTypeScaleTest. Widget text does not shrink
 * to fit and the title is one line, so a title too big for the cell is
 * ellipsised. These pin the geometry: the longest title must fit.
 */
class WidgetTypeScaleTest {

    private val cardPadding = 32f
    /** Deliberately tighter than the implementation's 0.58em: production may be more cautious, never less. */
    private val perCharEm = 0.55f
    /** The longest title in widget_strings.xml. */
    private val longestTitle = "DAC'S WorkMate"

    private fun drawnWidth(fontSizeSp: Float, title: String) = fontSizeSp * title.length * perCharEm

    @Test
    fun `the longest title fits the card at the default widget size`() {
        val type = typeScale(250f, 110f, longestTitle.length)
        val available = 250f - cardPadding
        val drawn = drawnWidth(type.title, longestTitle)
        assertTrue("\"$longestTitle\" at ${type.title}sp draws ${drawn}dp in ${available}dp", drawn <= available)
    }

    @Test
    fun `a short title is allowed to grow larger than a long one on the same card`() {
        val short = typeScale(250f, 110f, "Time In".length).title
        val long = typeScale(250f, 110f, longestTitle.length).title
        assertTrue("7 chars got ${short}sp, 14 chars got ${long}sp", short > long)
    }

    @Test
    fun `a long title on a narrow card still stops at the legibility floor`() {
        assertTrue(typeScale(100f, 110f, 40).title >= 18f)
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location`
Expected: FAIL — `Unresolved reference: widgetStateFor` (compileDebugUnitTestKotlin).

- [ ] **Step 4: Write `android/app/src/main/kotlin/com/dacs/workmate/widget/WidgetRules.kt`**

```kotlin
package com.dacs.workmate.widget

import androidx.annotation.StringRes
import com.dacs.workmate.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.min

/*
 * The home-screen widget's rules, pure on purpose: no Context, no RemoteViews,
 * so every phrase and colour the home screen can show is settled by a JUnit
 * test. Ported from DACS Attendance domain/WidgetState.kt and
 * widget/WidgetCard.kt. No java.time: minSdk 24 without desugaring.
 */

/** What the app last pushed (lib/widget/widget_snapshot.dart). Never names who. */
data class WidgetSnapshot(
    val signedIn: Boolean,
    val workDate: String?,
    val status: String?,
    val timeInAt: Long?,
    val timeOutAt: Long?,
    val notSentYet: Boolean,
    val readFailed: Boolean
)

enum class TimeDirection { IN, OUT }

sealed interface WidgetState {
    /** This worker still has a submission queued on the phone. */
    val notSentYet: Boolean

    data object SignedOut : WidgetState {
        override val notSentYet: Boolean = false
    }

    data class NotTimedIn(override val notSentYet: Boolean = false) : WidgetState

    /** [timeInAt] is null only for a record that lost it; no live count then. */
    data class Working(val timeInAt: Long?, override val notSentYet: Boolean = false) : WidgetState

    data class Complete(val timeInAt: Long?, val timeOutAt: Long?, override val notSentYet: Boolean = false) : WidgetState

    data class Abandoned(override val notSentYet: Boolean = false) : WidgetState

    /** A status this build cannot name, or nothing readable. No button: guessing IN or OUT costs a refused photo. */
    data class Unknown(override val notSentYet: Boolean = false) : WidgetState

    /** The one action the widget offers. Same rule as Home's. */
    val action: TimeDirection?
        get() = when (this) {
            is NotTimedIn -> TimeDirection.IN
            is Working -> TimeDirection.OUT
            else -> null
        }
}

private const val MANILA_OFFSET_MS = 8L * 60 * 60 * 1000

/** "2026-09-11": the Manila calendar date of an instant (UTC+8 all year, no DST since 1978). */
fun manilaIsoDate(epochMillis: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(Date(epochMillis + MANILA_OFFSET_MS))

/**
 * Today's widget. [today] is decided HERE at every redraw, not by the app, so a
 * snapshot from yesterday rolls over at Manila midnight with nothing running.
 */
fun widgetStateFor(snapshot: WidgetSnapshot?, today: String): WidgetState {
    if (snapshot == null) return WidgetState.Unknown()
    if (!snapshot.signedIn) return WidgetState.SignedOut
    val pending = snapshot.notSentYet
    if (snapshot.readFailed) return WidgetState.Unknown(pending)
    val status = snapshot.status
    if (snapshot.workDate != today || status == null) return WidgetState.NotTimedIn(pending)
    return when (status.lowercase(Locale.US)) {
        "working" -> WidgetState.Working(snapshot.timeInAt, pending)
        "complete" -> WidgetState.Complete(snapshot.timeInAt, snapshot.timeOutAt, pending)
        "abandoned" -> WidgetState.Abandoned(pending)
        else -> WidgetState.Unknown(pending)
    }
}

/** The card's colour, carrying the app's usual meaning. */
enum class WidgetTone {
    /** Green: nothing recorded yet, the day is ahead. */
    START,
    /** Deep green: on site, the stamp accepted. */
    WORKING,
    /** Deepest green: the day is closed and correct. */
    COMPLETE,
    /** Brown: a day closed without a Time Out needs a person. */
    ATTENTION,
    /** Grey-green: the widget cannot say, and will not guess. */
    NEUTRAL
}

sealed interface WidgetPill {
    data object None : WidgetPill
    data class Label(@StringRes val text: Int) : WidgetPill
    /** A live count since [since] (epoch ms), drawn by a system Chronometer. */
    data class Elapsed(val since: Long) : WidgetPill
}

sealed interface WidgetSubtitle {
    data class Label(@StringRes val text: Int) : WidgetSubtitle
    /** Today's two stamps (epoch ms). */
    data class DaySpan(val timeIn: Long, val timeOut: Long) : WidgetSubtitle
}

data class WidgetCard(
    val tone: WidgetTone,
    val pill: WidgetPill,
    @StringRes val title: Int,
    val subtitle: WidgetSubtitle,
    /** The flow's step list, or null where tapping starts no flow. */
    @StringRes val breadcrumb: Int?,
    /** A stamp is still on the phone; the footer says so instead. */
    val queued: Boolean,
    /** Draw a tick rather than an arrow. */
    val done: Boolean,
    /** What the tap starts. Null opens the app instead. */
    val action: TimeDirection?
)

fun widgetCardFor(state: WidgetState): WidgetCard = when (state) {
    WidgetState.SignedOut -> WidgetCard(
        tone = WidgetTone.START,
        pill = WidgetPill.Label(R.string.widget_pill_sign_in),
        title = R.string.widget_card_sign_in,
        subtitle = WidgetSubtitle.Label(R.string.widget_sub_sign_in),
        breadcrumb = null,
        queued = false,
        done = false,
        action = null
    )

    is WidgetState.NotTimedIn -> WidgetCard(
        tone = WidgetTone.START,
        pill = WidgetPill.Label(R.string.widget_pill_step_one),
        title = R.string.widget_card_time_in,
        subtitle = WidgetSubtitle.Label(R.string.widget_sub_start_day),
        breadcrumb = R.string.widget_flow_in,
        queued = state.notSentYet,
        done = false,
        action = TimeDirection.IN
    )

    is WidgetState.Working -> WidgetCard(
        tone = WidgetTone.WORKING,
        // Without a recorded Time In there is nothing to count from; counting
        // from now would read 00:00:00 in the afternoon.
        pill = state.timeInAt?.let { WidgetPill.Elapsed(it) } ?: WidgetPill.Label(R.string.widget_pill_on_site),
        title = R.string.widget_card_time_out,
        subtitle = WidgetSubtitle.Label(R.string.widget_sub_close_day),
        // Three steps out, not four: the project is already known.
        breadcrumb = R.string.widget_flow_out,
        queued = state.notSentYet,
        done = false,
        action = TimeDirection.OUT
    )

    is WidgetState.Complete -> WidgetCard(
        tone = WidgetTone.COMPLETE,
        pill = WidgetPill.Label(R.string.widget_pill_all_done),
        title = R.string.widget_card_complete,
        subtitle = if (state.timeInAt != null && state.timeOutAt != null) {
            WidgetSubtitle.DaySpan(state.timeInAt, state.timeOutAt)
        } else {
            WidgetSubtitle.Label(R.string.widget_done_no_times)
        },
        breadcrumb = null,
        queued = state.notSentYet,
        done = true,
        action = null
    )

    is WidgetState.Abandoned -> WidgetCard(
        tone = WidgetTone.ATTENTION,
        pill = WidgetPill.Label(R.string.widget_pill_no_time_out),
        title = R.string.widget_card_day_closed,
        subtitle = WidgetSubtitle.Label(R.string.widget_sub_sort_out),
        breadcrumb = null,
        queued = state.notSentYet,
        // Closed, but not correctly.
        done = false,
        action = null
    )

    is WidgetState.Unknown -> WidgetCard(
        tone = WidgetTone.NEUTRAL,
        pill = WidgetPill.None,
        title = R.string.widget_card_open_app,
        subtitle = WidgetSubtitle.Label(R.string.widget_sub_unavailable),
        breadcrumb = null,
        queued = state.notSentYet,
        done = false,
        action = null
    )
}

/** Below this the card drops to one row. */
const val FULL_CARD_MIN_HEIGHT_DP = 100f

/** Below this the subtitle goes, so the title keeps its size. */
const val SUBTITLE_MIN_HEIGHT_DP = 138f

/** The card's type sizes, in sp. */
data class CardType(val title: Float, val subtitle: Float, val pill: Float, val footer: Float, val arrow: Float)

private fun Float.clamp(lo: Float, hi: Float) = max(lo, min(hi, this))

/**
 * Type scaled to the cell, bounded by width as well as height: widget text does
 * not shrink to fit, so the title actually drawn has to survive on one line.
 * 0.58em per character is a little generous for bold sans, erring smaller.
 */
fun typeScale(widthDp: Float, heightDp: Float, titleLength: Int): CardType {
    // A small widget must stay legible at arm's length in sunlight.
    val byHeight = if (heightDp < SUBTITLE_MIN_HEIGHT_DP) heightDp * 0.30f else heightDp * 0.24f
    val perChar = max(titleLength, 1) * 0.58f
    val byWidth = (widthDp - 32f) / perChar
    val title = min(byHeight, byWidth).clamp(18f, 44f)
    return CardType(
        title = title,
        subtitle = (title * 0.52f).clamp(12f, 19f),
        pill = (title * 0.42f).clamp(10f, 14f),
        footer = (title * 0.46f).clamp(11f, 16f),
        arrow = (title * 0.60f).clamp(15f, 26f)
    )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location`
Expected: `BUILD SUCCESSFUL` (PhotoMathTest + the three new classes).

- [ ] **Step 6: Stop — no commit.**

---
### Task 10: Drawing the widget, and the bridge plugin

**Files:**
- Create: `packages/workmate_widget_bridge/pubspec.yaml`, `packages/workmate_widget_bridge/analysis_options.yaml`, `packages/workmate_widget_bridge/lib/workmate_widget_bridge.dart`, `packages/workmate_widget_bridge/android/build.gradle`, `packages/workmate_widget_bridge/android/settings.gradle`, `packages/workmate_widget_bridge/android/src/main/AndroidManifest.xml`, `packages/workmate_widget_bridge/android/src/main/kotlin/com/dacs/workmate_widget_bridge/WorkmateWidgetBridgePlugin.kt`
- Create: `android/app/src/main/kotlin/com/dacs/workmate/widget/TimeWidgetProvider.kt`
- Create: `android/app/src/main/res/layout/widget_full.xml`, `android/app/src/main/res/layout/widget_compact.xml`
- Create: `android/app/src/main/res/drawable/widget_bg_start.xml`, `widget_bg_working.xml`, `widget_bg_complete.xml`, `widget_bg_attention.xml`, `widget_bg_neutral.xml`, `widget_pill_bg.xml`
- Create: `android/app/src/main/res/xml/time_widget_info.xml`
- Modify: `android/app/src/main/AndroidManifest.xml` (receiver), `pubspec.yaml` (path dependency)

**Interfaces:**
- Consumes: Task 7's channel `com.dacs.workmate/widget` method `push` with map keys `signedIn, workDate, status, timeInAt, timeOutAt, notSentYet, readFailed`; Task 9's `WidgetRules.kt`.
- Produces: the storage contract shared by the plugin and the provider — SharedPreferences file **`workmate_widget`**, keys **`present`** (bool), **`signed_in`** (bool), **`work_date`** (string), **`status`** (string), **`time_in_at`** / **`time_out_at`** (long, `-1` = none), **`not_sent_yet`** (bool), **`read_failed`** (bool); the provider class **`com.dacs.workmate.widget.TimeWidgetProvider`**; `TimeWidgetProvider.EXTRA_START_FLOW = "com.dacs.workmate.extra.START_FLOW"` (value `"IN"` / `"OUT"`, used by Task 11).

**Why a plugin:** WorkManager runs background sends in a *new* Flutter engine with every plugin registered but no `MainActivity`, so a `MainActivity` channel would be missing there. The plugin writes the app's private prefs and then sends the standard `APPWIDGET_UPDATE` to the provider; a forged update from another app can only make the widget redraw from those private prefs.

- [ ] **Step 1: Create the plugin package**

`packages/workmate_widget_bridge/pubspec.yaml`:

```yaml
name: workmate_widget_bridge
description: "WorkMate's home-screen widget bridge: the snapshot push, from any Flutter engine. Android only, in-repo."
version: 1.0.0
publish_to: 'none'

environment:
  sdk: ^3.10.8
  flutter: '>=3.38.0'

dependencies:
  flutter:
    sdk: flutter

flutter:
  plugin:
    platforms:
      android:
        package: com.dacs.workmate_widget_bridge
        pluginClass: WorkmateWidgetBridgePlugin
```

`packages/workmate_widget_bridge/analysis_options.yaml`:

```yaml
# The plugin has no Dart logic; the app's own lints apply to lib/widget/.
```

`packages/workmate_widget_bridge/lib/workmate_widget_bridge.dart`:

```dart
/// Android only. The native half is WorkmateWidgetBridgePlugin.kt; the Dart
/// half lives in the app (lib/widget/widget_bridge.dart), next to its tests.
library;
```

`packages/workmate_widget_bridge/android/settings.gradle`:

```groovy
rootProject.name = 'workmate_widget_bridge'
```

`packages/workmate_widget_bridge/android/build.gradle` (from `flutter create --template=plugin` on Flutter 3.38.9, test setup removed — the logic it would test lives in the app module):

```groovy
group = "com.dacs.workmate_widget_bridge"
version = "1.0"

buildscript {
    ext.kotlin_version = "2.2.20"
    repositories {
        google()
        mavenCentral()
    }

    dependencies {
        classpath("com.android.tools.build:gradle:8.11.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

apply plugin: "com.android.library"
apply plugin: "kotlin-android"

android {
    namespace = "com.dacs.workmate_widget_bridge"

    compileSdk = 36

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17
    }

    sourceSets {
        main.java.srcDirs += "src/main/kotlin"
    }

    defaultConfig {
        minSdk = 24
    }
}
```

`packages/workmate_widget_bridge/android/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android" />
```

`packages/workmate_widget_bridge/android/src/main/kotlin/com/dacs/workmate_widget_bridge/WorkmateWidgetBridgePlugin.kt`:

```kotlin
package com.dacs.workmate_widget_bridge

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Hands the home-screen widget its snapshot from ANY Flutter engine: the app's,
 * and WorkManager's background one (which has plugins but no MainActivity).
 *
 * Writes the app's private widget prefs, then asks the provider to redraw.
 * KEEP IN STEP with com.dacs.workmate.widget.TimeWidgetProvider (app module):
 * the file name, the keys and the provider class name below.
 */
class WorkmateWidgetBridgePlugin : FlutterPlugin, MethodChannel.MethodCallHandler {
    private lateinit var channel: MethodChannel
    private lateinit var context: Context

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "com.dacs.workmate/widget")
        channel.setMethodCallHandler(this)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (call.method != "push") return result.notImplemented()
        try {
            save(call)
            redraw()
            result.success(null)
        } catch (e: Exception) {
            result.error("WIDGET", e.message, null)
        }
    }

    /** Every key, every time: a sign-out must leave nothing of the last worker's day. */
    private fun save(call: MethodCall) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("present", true)
            .putBoolean("signed_in", call.argument<Boolean>("signedIn") == true)
            .putString("work_date", call.argument<String>("workDate"))
            .putString("status", call.argument<String>("status"))
            .putLong("time_in_at", call.argument<Number>("timeInAt")?.toLong() ?: -1L)
            .putLong("time_out_at", call.argument<Number>("timeOutAt")?.toLong() ?: -1L)
            .putBoolean("not_sent_yet", call.argument<Boolean>("notSentYet") == true)
            .putBoolean("read_failed", call.argument<Boolean>("readFailed") == true)
            .commit()
    }

    private fun redraw() {
        val provider = ComponentName(context.packageName, PROVIDER)
        val ids = AppWidgetManager.getInstance(context).getAppWidgetIds(provider)
        // Most phones never place the widget: nothing to draw.
        if (ids.isEmpty()) return
        context.sendBroadcast(
            Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                .setComponent(provider)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        )
    }

    private companion object {
        const val PREFS = "workmate_widget"
        const val PROVIDER = "com.dacs.workmate.widget.TimeWidgetProvider"
    }
}
```

In the app's `pubspec.yaml`, under `dependencies:` (keep alphabetical order, after `workmanager: 0.10.10`), add:

```yaml
  # The home-screen widget's push, usable from WorkManager's engine too (0D).
  workmate_widget_bridge:
    path: packages/workmate_widget_bridge
```

Run: `flutter pub get` → expect `Got dependencies!`.

- [ ] **Step 2: Create the drawables** (`android/app/src/main/res/drawable/`)

`widget_bg_start.xml` (and the four siblings, identical except the colour — `widget_bg_working.xml` `#FF134428`, `widget_bg_complete.xml` `#FF0F3A24`, `widget_bg_attention.xml` `#FF6B4F22`, `widget_bg_neutral.xml` `#FF3A4A42`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The widget card, START tone (WmColors.green). One colour in day and night:
     a "dark variant" of green would make one state look like two. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FF1A5C3A" />
    <corners android:radius="20dp" />
</shape>
```

`widget_pill_bg.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#2BFFFFFF" />
    <corners android:radius="12dp" />
</shape>
```

- [ ] **Step 3: Create the layouts** (`android/app/src/main/res/layout/`; only RemoteViews-safe classes: `LinearLayout`, `FrameLayout`, `TextView`, `Chronometer`)

`widget_full.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- The full card: pill + arrow, title, subtitle, rule, footer. Tappable anywhere. -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_card"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg_start"
    android:orientation="vertical"
    android:paddingStart="16dp"
    android:paddingTop="13dp"
    android:paddingEnd="16dp"
    android:paddingBottom="13dp">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal">

        <FrameLayout
            android:id="@+id/widget_pill"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:background="@drawable/widget_pill_bg"
            android:paddingStart="9dp"
            android:paddingTop="4dp"
            android:paddingEnd="9dp"
            android:paddingBottom="4dp">

            <TextView
                android:id="@+id/widget_pill_text"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:includeFontPadding="false"
                android:letterSpacing="0.08"
                android:maxLines="1"
                android:textColor="#FFFFFFFF"
                android:textSize="11sp"
                android:textStyle="bold" />

            <!-- The live "ON SITE 04:13:32": the platform ticks it, no wakeups charged to the app. -->
            <Chronometer
                android:id="@+id/widget_elapsed"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:includeFontPadding="false"
                android:letterSpacing="0.08"
                android:textColor="#FFFFFFFF"
                android:textSize="11sp"
                android:textStyle="bold"
                android:visibility="gone" />
        </FrameLayout>

        <FrameLayout
            android:layout_width="0dp"
            android:layout_height="0dp"
            android:layout_weight="1" />

        <TextView
            android:id="@+id/widget_arrow"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:includeFontPadding="false"
            android:textColor="#FFFFFFFF"
            android:textSize="20sp" />
    </LinearLayout>

    <TextView
        android:id="@+id/widget_title"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:ellipsize="end"
        android:includeFontPadding="false"
        android:maxLines="1"
        android:textColor="#FFFFFFFF"
        android:textSize="26sp"
        android:textStyle="bold" />

    <TextView
        android:id="@+id/widget_subtitle"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="2dp"
        android:maxLines="2"
        android:textColor="#D1FFFFFF"
        android:textSize="14sp" />

    <!-- Takes the slack, pinning the footer to the bottom edge. -->
    <FrameLayout
        android:id="@+id/widget_slack"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:minHeight="8dp" />

    <FrameLayout
        android:id="@+id/widget_rule"
        android:layout_width="match_parent"
        android:layout_height="1dp"
        android:background="#38FFFFFF" />

    <TextView
        android:id="@+id/widget_footer"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="9dp"
        android:maxLines="1"
        android:textColor="#D1FFFFFF"
        android:textSize="12sp" />
</LinearLayout>
```

`widget_compact.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Under 100dp: the same card in one row. The second line is the queued
     notice, else the live count, else the subtitle. -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_card"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg_start"
    android:gravity="center_vertical"
    android:orientation="horizontal"
    android:paddingStart="14dp"
    android:paddingTop="9dp"
    android:paddingEnd="14dp"
    android:paddingBottom="9dp">

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:orientation="vertical">

        <TextView
            android:id="@+id/widget_title"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="#FFFFFFFF"
            android:textSize="16sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/widget_subtitle"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="#D1FFFFFF"
            android:textSize="11sp" />

        <Chronometer
            android:id="@+id/widget_elapsed"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:textColor="#FFFFFFFF"
            android:textSize="11sp"
            android:textStyle="bold"
            android:visibility="gone" />
    </LinearLayout>

    <TextView
        android:id="@+id/widget_arrow"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:textColor="#FFFFFFFF"
        android:textSize="15sp" />
</LinearLayout>
```

- [ ] **Step 4: Create `android/app/src/main/res/xml/time_widget_info.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<!--
  4x3 by default, resizable (DACS Attendance's proportions). Under 138dp the
  subtitle drops; under 100dp the card becomes one row (WidgetRules.kt).

  updatePeriodMillis is only the BACKSTOP: the app pushes on every change.
  This is what rolls yesterday's "Complete" over to "Time In" after Manila
  midnight on a phone where nothing else runs.
-->
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/widget_description"
    android:initialLayout="@layout/widget_full"
    android:minWidth="250dp"
    android:minHeight="150dp"
    android:minResizeWidth="180dp"
    android:minResizeHeight="48dp"
    android:resizeMode="horizontal|vertical"
    android:targetCellWidth="4"
    android:targetCellHeight="3"
    android:updatePeriodMillis="1800000"
    android:widgetCategory="home_screen" />
```

- [ ] **Step 5: Write `android/app/src/main/kotlin/com/dacs/workmate/widget/TimeWidgetProvider.kt`**

```kotlin
package com.dacs.workmate.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.text.format.DateFormat
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.RemoteViews
import com.dacs.workmate.MainActivity
import com.dacs.workmate.R
import java.util.Date
import java.util.TimeZone

/**
 * The home-screen widget: one solid card, tappable anywhere, opening the same
 * flow Home would. It records nothing itself, and reads only the snapshot the
 * app pushed (WorkmateWidgetBridgePlugin) -- never the network.
 */
class TimeWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { draw(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        draw(context, manager, appWidgetId)
    }

    companion object {
        private const val TAG = "TimeWidget"

        /** KEEP IN STEP with WorkmateWidgetBridgePlugin. */
        private const val PREFS = "workmate_widget"

        /** The intent extra a widget tap sets: "IN" or "OUT" (MainActivity reads it). */
        const val EXTRA_START_FLOW = "com.dacs.workmate.extra.START_FLOW"

        private const val ON_CARD_MUTED = 0xD1FFFFFF.toInt()
        /** Gold on a dark card, not the brown tone. */
        private const val QUEUED = 0xFFE9CE9A.toInt()

        fun draw(context: Context, manager: AppWidgetManager, id: Int) {
            try {
                val state = widgetStateFor(readSnapshot(context), manilaIsoDate(System.currentTimeMillis()))
                val card = widgetCardFor(state)
                val options = manager.getAppWidgetOptions(id)
                val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).takeIf { it > 0 } ?: 250
                val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT).takeIf { it > 0 } ?: 150
                val views = if (height < FULL_CARD_MIN_HEIGHT_DP) {
                    compactViews(context, card)
                } else {
                    fullViews(context, card, width.toFloat(), height.toFloat())
                }
                views.setOnClickPendingIntent(R.id.widget_card, tapIntent(context, card.action))
                manager.updateAppWidget(id, views)
            } catch (e: Exception) {
                // A widget that cannot draw stays as it was; it must never crash the app's process.
                Log.w(TAG, "widget draw failed", e)
            }
        }

        private fun readSnapshot(context: Context): WidgetSnapshot? {
            val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (!p.getBoolean("present", false)) return null
            return WidgetSnapshot(
                signedIn = p.getBoolean("signed_in", false),
                workDate = p.getString("work_date", null),
                status = p.getString("status", null),
                timeInAt = p.getLong("time_in_at", -1L).takeIf { it >= 0 },
                timeOutAt = p.getLong("time_out_at", -1L).takeIf { it >= 0 },
                notSentYet = p.getBoolean("not_sent_yet", false),
                readFailed = p.getBoolean("read_failed", false)
            )
        }

        private fun background(tone: WidgetTone) = when (tone) {
            WidgetTone.START -> R.drawable.widget_bg_start
            WidgetTone.WORKING -> R.drawable.widget_bg_working
            WidgetTone.COMPLETE -> R.drawable.widget_bg_complete
            WidgetTone.ATTENTION -> R.drawable.widget_bg_attention
            WidgetTone.NEUTRAL -> R.drawable.widget_bg_neutral
        }

        private fun fullViews(context: Context, card: WidgetCard, width: Float, height: Float): RemoteViews {
            val title = context.getString(card.title)
            val type = typeScale(width, height, title.length)
            val v = RemoteViews(context.packageName, R.layout.widget_full)
            v.setInt(R.id.widget_card, "setBackgroundResource", background(card.tone))

            when (val pill = card.pill) {
                WidgetPill.None -> v.setViewVisibility(R.id.widget_pill, View.GONE)
                is WidgetPill.Label -> {
                    v.setViewVisibility(R.id.widget_pill, View.VISIBLE)
                    v.setViewVisibility(R.id.widget_elapsed, View.GONE)
                    v.setViewVisibility(R.id.widget_pill_text, View.VISIBLE)
                    v.setTextViewText(R.id.widget_pill_text, context.getString(pill.text))
                    v.setTextViewTextSize(R.id.widget_pill_text, TypedValue.COMPLEX_UNIT_SP, type.pill)
                }
                is WidgetPill.Elapsed -> {
                    v.setViewVisibility(R.id.widget_pill, View.VISIBLE)
                    v.setViewVisibility(R.id.widget_pill_text, View.GONE)
                    setElapsed(context, v, pill.since, type.pill)
                }
            }

            v.setTextViewText(R.id.widget_arrow, if (card.done) "✓" else "→")
            v.setTextViewTextSize(R.id.widget_arrow, TypedValue.COMPLEX_UNIT_SP, type.arrow)
            v.setTextViewText(R.id.widget_title, title)
            v.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, type.title)

            // A short card cannot carry every row: the subtitle repeats what the
            // title and arrow already say, so it is the one that goes.
            if (height >= SUBTITLE_MIN_HEIGHT_DP) {
                v.setViewVisibility(R.id.widget_subtitle, View.VISIBLE)
                v.setTextViewText(R.id.widget_subtitle, subtitleText(context, card.subtitle))
                v.setTextViewTextSize(R.id.widget_subtitle, TypedValue.COMPLEX_UNIT_SP, type.subtitle)
            } else {
                v.setViewVisibility(R.id.widget_subtitle, View.GONE)
            }

            // The footer is the flow breadcrumb, unless a stamp still waits on the
            // phone -- then it says so, and the action stays reachable.
            val footer = when {
                card.queued -> context.getString(R.string.widget_pill_queued)
                card.breadcrumb != null -> context.getString(card.breadcrumb)
                else -> null
            }
            if (footer == null) {
                // Nothing to pin to the bottom: centre the block instead of stranding colour under it.
                v.setViewVisibility(R.id.widget_slack, View.GONE)
                v.setViewVisibility(R.id.widget_rule, View.GONE)
                v.setViewVisibility(R.id.widget_footer, View.GONE)
                v.setInt(R.id.widget_card, "setGravity", Gravity.CENTER_VERTICAL)
            } else {
                v.setViewVisibility(R.id.widget_slack, View.VISIBLE)
                v.setViewVisibility(R.id.widget_rule, View.VISIBLE)
                v.setViewVisibility(R.id.widget_footer, View.VISIBLE)
                v.setTextViewText(R.id.widget_footer, footer)
                v.setTextColor(R.id.widget_footer, if (card.queued) QUEUED else ON_CARD_MUTED)
                v.setTextViewTextSize(R.id.widget_footer, TypedValue.COMPLEX_UNIT_SP, type.footer)
                v.setInt(R.id.widget_card, "setGravity", Gravity.TOP)
            }
            return v
        }

        private fun compactViews(context: Context, card: WidgetCard): RemoteViews {
            val v = RemoteViews(context.packageName, R.layout.widget_compact)
            v.setInt(R.id.widget_card, "setBackgroundResource", background(card.tone))
            v.setTextViewText(R.id.widget_title, context.getString(card.title))
            v.setTextViewText(R.id.widget_arrow, if (card.done) "✓" else "→")
            val pill = card.pill
            when {
                card.queued -> {
                    v.setViewVisibility(R.id.widget_elapsed, View.GONE)
                    v.setViewVisibility(R.id.widget_subtitle, View.VISIBLE)
                    v.setTextViewText(R.id.widget_subtitle, context.getString(R.string.widget_pill_queued))
                    v.setTextColor(R.id.widget_subtitle, QUEUED)
                }
                pill is WidgetPill.Elapsed -> {
                    v.setViewVisibility(R.id.widget_subtitle, View.GONE)
                    setElapsed(context, v, pill.since, 11f)
                }
                else -> {
                    v.setViewVisibility(R.id.widget_elapsed, View.GONE)
                    v.setViewVisibility(R.id.widget_subtitle, View.VISIBLE)
                    v.setTextViewText(R.id.widget_subtitle, subtitleText(context, card.subtitle))
                    v.setTextColor(R.id.widget_subtitle, ON_CARD_MUTED)
                }
            }
            return v
        }

        /**
         * A Chronometer counting up from [since]. It measures against
         * elapsedRealtime (uptime) while a Time In is a wall-clock instant, so
         * the base is now's uptime minus how long ago the stamp was.
         */
        private fun setElapsed(context: Context, v: RemoteViews, since: Long, sizeSp: Float) {
            val agoMillis = System.currentTimeMillis() - since
            v.setViewVisibility(R.id.widget_elapsed, View.VISIBLE)
            v.setChronometer(
                R.id.widget_elapsed,
                SystemClock.elapsedRealtime() - agoMillis,
                context.getString(R.string.widget_pill_on_site) + " %s",
                true
            )
            v.setTextViewTextSize(R.id.widget_elapsed, TypedValue.COMPLEX_UNIT_SP, sizeSp)
        }

        private fun subtitleText(context: Context, subtitle: WidgetSubtitle): String = when (subtitle) {
            is WidgetSubtitle.Label -> context.getString(subtitle.text)
            is WidgetSubtitle.DaySpan -> context.getString(
                R.string.widget_sub_day_span,
                clock(context, subtitle.timeIn),
                clock(context, subtitle.timeOut)
            )
        }

        /** Manila time, in the phone's own 12- or 24-hour style. */
        private fun clock(context: Context, epochMillis: Long): String {
            val format = DateFormat.getTimeFormat(context)
            format.timeZone = TimeZone.getTimeZone("Asia/Manila")
            return format.format(Date(epochMillis))
        }

        /**
         * A distinct ACTION and request code per direction: two intents that
         * differ only in extras are the same PendingIntent to Android, and the
         * Time Out tap would be handed the Time In one.
         */
        private fun tapIntent(context: Context, action: TimeDirection?): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (action == null) {
                intent.action = Intent.ACTION_MAIN
            } else {
                intent.action = "com.dacs.workmate.action.START_FLOW_${action.name}"
                intent.putExtra(EXTRA_START_FLOW, action.name)
            }
            val requestCode = action?.let { it.ordinal + 1 } ?: 0
            return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        }
    }
}
```

- [ ] **Step 6: Register the receiver** — in `android/app/src/main/AndroidManifest.xml`, inside `<application>`, after the `</activity>` that closes `.MainActivity`:

```xml
        <!-- The home-screen widget: today at a glance, Time In / Time Out in one
             tap. It records nothing; it opens the app's own flow. -->
        <receiver
            android:name=".widget.TimeWidgetProvider"
            android:exported="true"
            android:label="@string/widget_label">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/time_widget_info" />
        </receiver>
```

- [ ] **Step 7: Verify everything still builds and passes**

Run, in order:
1. `flutter analyze` → `No issues found!`
2. `flutter test` → all pass.
3. `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location` → `BUILD SUCCESSFUL`.
4. `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; flutter build apk --debug` → `√ Built build\app\outputs\flutter-apk\app-debug.apk`.

If the build reports the plugin's Gradle/Kotlin versions as incompatible, copy the exact `classpath` versions from `android/settings.gradle.kts` (`com.android.application` / `org.jetbrains.kotlin.android` plugin versions) into the plugin's `build.gradle` — they must match the app (AGP 8.11.1, Kotlin 2.2.20 at the time of writing).

- [ ] **Step 8: Stop — no commit.** (The phone check of the widget happens in Task 12, after taps work.)

---

### Task 11: A widget tap opens the flow — when Home agrees

A tap is a **request, not a command**: the widget can be behind the truth (a Time In made moments ago, an admin correction), and the worker may be halfway through a capture. Ported from `ui/StartFlowRequest.kt` with its tests.

**Files:**
- Create: `lib/widget/start_flow.dart`
- Modify: `android/app/src/main/kotlin/com/dacs/workmate/MainActivity.kt`
- Modify: `lib/app.dart`, `lib/ui/home_shell.dart`, `lib/main.dart`
- Test: `test/widget/start_flow_test.dart`; append to `test/ui/screens_test.dart`

**Interfaces:**
- Consumes: `TimeDirection` (`work_date.dart`, `wire` = `"IN"`/`"OUT"`), `AppState` classes, `HomeController.loading` / `nextAction`, `TimeWidgetProvider.EXTRA_START_FLOW` (Task 10).
- Produces: `TimeDirection? startFlowFromExtra(String? raw)`; `enum StartFlowDecision { open, stayOnHome, drop, wait }`; `typedef HomeGlance = ({bool loading, TimeDirection? nextAction});`; `StartFlowDecision resolveStartFlow(TimeDirection request, AppState appState, {required bool flowOpen, HomeGlance? home})`; `class StartFlowInbox extends ChangeNotifier { TimeDirection? get pending; void put(TimeDirection d); void clear(); }`; `abstract interface class LaunchRequests { Future<TimeDirection?> take(); }`; `class ChannelLaunchRequests implements LaunchRequests` on channel **`com.dacs.workmate/launch`**, method **`takeStartFlow`**; `WorkMateApp(..., LaunchRequests? launches)`; `HomeShell(..., StartFlowInbox? startRequests)`.

- [ ] **Step 1: Write the failing tests**

```dart
// test/widget/start_flow_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/app_controller.dart';
import 'package:workmate/attendance/domain/work_date.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/widget/start_flow.dart';

/// Ported from StartFlowRequestTest.kt. A widget tap is a request, not a
/// command: the widget may show a day that has moved on, and the worker may
/// be halfway through a capture.
void main() {
  const worker = WorkerProfile(id: 'w1', email: 'w1@example.com', displayName: 'Juan', workerNo: 42, role: 'worker', status: 'active');
  final signedIn = Ready(worker);
  const homeNoRecord = (loading: false, nextAction: TimeDirection.timeIn);
  const homeWorking = (loading: false, nextAction: TimeDirection.timeOut);
  const homeClosed = (loading: false, nextAction: null);

  test('the extra names a direction exactly', () {
    expect(startFlowFromExtra('IN'), TimeDirection.timeIn);
    expect(startFlowFromExtra('OUT'), TimeDirection.timeOut);
  });

  test('anything else is no request', () {
    expect(startFlowFromExtra(null), isNull);
    expect(startFlowFromExtra(''), isNull);
    expect(startFlowFromExtra('in'), isNull);
    expect(startFlowFromExtra('SIDEWAYS'), isNull);
  });

  test('still starting waits', () {
    expect(resolveStartFlow(TimeDirection.timeIn, Starting(), flowOpen: false), StartFlowDecision.wait);
  });

  test('signed out, Terms, or the offline gate drop the request', () {
    for (final state in [SignedOut(), NeedsTerms(worker), TermsUnavailable(worker)]) {
      expect(resolveStartFlow(TimeDirection.timeIn, state, flowOpen: false, home: homeNoRecord), StartFlowDecision.drop);
    }
  });

  test('a flow already open is never replaced', () {
    expect(resolveStartFlow(TimeDirection.timeOut, signedIn, flowOpen: true, home: homeNoRecord), StartFlowDecision.drop);
  });

  test('Home not read yet waits', () {
    expect(resolveStartFlow(TimeDirection.timeIn, signedIn, flowOpen: false), StartFlowDecision.wait);
    expect(resolveStartFlow(TimeDirection.timeIn, signedIn, flowOpen: false, home: (loading: true, nextAction: null)),
        StartFlowDecision.wait);
  });

  test('Time In on a fresh day opens the flow', () {
    expect(resolveStartFlow(TimeDirection.timeIn, signedIn, flowOpen: false, home: homeNoRecord), StartFlowDecision.open);
  });

  test('Time Out on an open day opens the flow', () {
    expect(resolveStartFlow(TimeDirection.timeOut, signedIn, flowOpen: false, home: homeWorking), StartFlowDecision.open);
  });

  test('a stale Time In on an open day stays on Home', () {
    // A photo taken now would only be refused as ALREADY_TIMED_IN.
    expect(resolveStartFlow(TimeDirection.timeIn, signedIn, flowOpen: false, home: homeWorking), StartFlowDecision.stayOnHome);
  });

  test('a stale Time Out on a fresh day stays on Home', () {
    expect(resolveStartFlow(TimeDirection.timeOut, signedIn, flowOpen: false, home: homeNoRecord), StartFlowDecision.stayOnHome);
  });

  test('a closed day stays on Home whatever was asked', () {
    for (final d in TimeDirection.values) {
      expect(resolveStartFlow(d, signedIn, flowOpen: false, home: homeClosed), StartFlowDecision.stayOnHome);
    }
  });

  test('offline with nothing mirrored still opens Time In, as Home does', () {
    // HomeController.nextAction is timeIn on noConnection with no record.
    expect(resolveStartFlow(TimeDirection.timeIn, signedIn, flowOpen: false, home: homeNoRecord), StartFlowDecision.open);
  });

  test('the inbox holds one request until taken', () {
    final inbox = StartFlowInbox();
    var told = 0;
    inbox.addListener(() => told++);
    inbox.put(TimeDirection.timeIn);
    expect(inbox.pending, TimeDirection.timeIn);
    inbox.clear();
    expect(inbox.pending, isNull);
    inbox.clear(); // already empty: no news
    expect(told, 2);
  });
}
```

Append to `test/ui/screens_test.dart` (add `import 'package:workmate/widget/start_flow.dart';`), and give `showShell` an optional inbox:

```dart
  Future<void> showShell(WidgetTester tester, {StartFlowInbox? inbox}) async {
```

passing `startRequests: inbox,` to `HomeShell(...)`. Then the tests:

```dart
  testWidgets('a widget Time In tap on a fresh day opens the flow', (tester) async {
    final inbox = StartFlowInbox()..put(TimeDirection.timeIn);
    await showShell(tester, inbox: inbox);
    expect(find.text('Which project today?'), findsOneWidget);
    expect(inbox.pending, isNull);
  });

  testWidgets('a stale widget Time Out stays on Home and is forgotten', (tester) async {
    final inbox = StartFlowInbox()..put(TimeDirection.timeOut);
    await showShell(tester, inbox: inbox);
    expect(find.byKey(const Key('hero-time-in')), findsOneWidget);
    expect(find.text('Which project today?'), findsNothing);
    expect(inbox.pending, isNull);
  });

  testWidgets('a widget tap while on Profile comes back to Home first', (tester) async {
    final inbox = StartFlowInbox();
    await showShell(tester, inbox: inbox);
    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    inbox.put(TimeDirection.timeIn);
    await tester.pumpAndSettle();
    expect(find.text('Which project today?'), findsOneWidget);
  });
```

(`TimeDirection` comes from `package:workmate/attendance/domain/work_date.dart`; add that import if `screens_test.dart` lacks it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/widget/start_flow_test.dart test/ui/screens_test.dart`
Expected: FAIL — `start_flow.dart` not found; `startRequests` not a parameter.

- [ ] **Step 3: Write `lib/widget/start_flow.dart`**

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../app_controller.dart';
import '../attendance/domain/work_date.dart';

/// Exact names only ("IN" / "OUT", TimeDirection.wire). Anything else is no
/// request, never a guess.
TimeDirection? startFlowFromExtra(String? raw) => switch (raw) {
      'IN' => TimeDirection.timeIn,
      'OUT' => TimeDirection.timeOut,
      _ => null,
    };

/// What to do with a Time In / Time Out asked for from the home screen.
enum StartFlowDecision {
  open,

  /// Home already shows the true state; the widget was behind.
  stayOnHome,

  /// Not now, and not later either: forget it.
  drop,

  /// Not enough known yet to decide.
  wait,
}

/// What Home knows: still loading, and the one action its big button offers.
typedef HomeGlance = ({bool loading, TimeDirection? nextAction});

/// A widget tap, resolved against what the app knows NOW. The flow opens only
/// when Home's nextAction (the same decision Home's big button makes) agrees;
/// otherwise the worker lands on Home, which already shows the right thing,
/// instead of taking a photo the server will refuse. [home] is null wherever
/// Home has not been read yet.
StartFlowDecision resolveStartFlow(TimeDirection request, AppState appState, {required bool flowOpen, HomeGlance? home}) {
  if (appState is Starting) return StartFlowDecision.wait;
  // Login, Terms or the offline gate. Dropped rather than held: after signing
  // in the worker should arrive on Home, not in a camera.
  if (appState is! Ready) return StartFlowDecision.drop;
  // The capture in progress is the worker's: a tap must not throw away a photo.
  if (flowOpen) return StartFlowDecision.drop;
  if (home == null || home.loading) return StartFlowDecision.wait;
  return home.nextAction == request ? StartFlowDecision.open : StartFlowDecision.stayOnHome;
}

/// The one pending widget tap, between the app (which receives it) and Home
/// (which decides it).
class StartFlowInbox extends ChangeNotifier {
  TimeDirection? _pending;
  TimeDirection? get pending => _pending;

  void put(TimeDirection direction) {
    _pending = direction;
    notifyListeners();
  }

  void clear() {
    if (_pending == null) return;
    _pending = null;
    notifyListeners();
  }
}

/// The tap MainActivity received, taken once.
abstract interface class LaunchRequests {
  Future<TimeDirection?> take();
}

class ChannelLaunchRequests implements LaunchRequests {
  const ChannelLaunchRequests();

  static const _channel = MethodChannel('com.dacs.workmate/launch');

  @override
  Future<TimeDirection?> take() async {
    try {
      return startFlowFromExtra(await _channel.invokeMethod<String>('takeStartFlow'));
    } catch (e) {
      debugPrint('No widget request: $e');
      return null;
    }
  }
}
```

- [ ] **Step 4: Hand the tap to Dart — `MainActivity.kt`**

1. Add imports `import android.os.Bundle` and `import com.dacs.workmate.widget.TimeWidgetProvider`.
2. Inside `class MainActivity`, before `configureFlutterEngine`, add:

```kotlin
    /** The widget's "IN" / "OUT", held until Dart takes it (once). */
    private var pendingStartFlow: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A restore after the process died replays the ORIGINAL intent: that tap
        // was already handled (or was hours ago), so only a fresh launch counts.
        if (savedInstanceState == null) takeStartFlowFrom(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        takeStartFlowFrom(intent)
    }

    private fun takeStartFlowFrom(intent: Intent?) {
        if (intent == null) return
        // Reopened from Recents, Android hands back the intent that first
        // started the task -- a widget tap from yesterday must not start today's flow.
        val fromHistory = (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        val raw = intent.getStringExtra(TimeWidgetProvider.EXTRA_START_FLOW)
        intent.removeExtra(TimeWidgetProvider.EXTRA_START_FLOW)
        if (!fromHistory && raw != null) pendingStartFlow = raw
    }
```

3. At the end of `configureFlutterEngine`, add:

```kotlin
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.dacs.workmate/launch")
            .setMethodCallHandler { call, result ->
                if (call.method == "takeStartFlow") {
                    result.success(pendingStartFlow)
                    pendingStartFlow = null
                } else {
                    result.notImplemented()
                }
            }
```

4. Change the class doc comment to `/** The installer, attendance and widget-launch channels for the Dart side. */`.

- [ ] **Step 5: The app-level half — `lib/app.dart`**

1. Add `import 'widget/start_flow.dart';`, constructor parameter `this.launches,` and field

```dart
  /// Widget taps MainActivity received; null in tests.
  final LaunchRequests? launches;
```

2. In `_WorkMateAppState`, add the field `final _inbox = StartFlowInbox();`.
3. `initState` becomes:

```dart
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.controller.addListener(_gateStartFlow);
    widget.controller.start();
    _takeLaunch();
  }
```

4. `dispose` becomes:

```dart
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.removeListener(_gateStartFlow);
    _inbox.dispose();
    super.dispose();
  }
```

5. In `didChangeAppLifecycleState`, inside the `resumed` branch, add `_takeLaunch();` (a tap on a running app arrives through `onNewIntent`, then resume).
6. Add the methods:

```dart
  Future<void> _takeLaunch() async {
    final request = await widget.launches?.take();
    if (request == null || !mounted) return;
    _inbox.put(request);
    _gateStartFlow();
  }

  /// The app-level half of resolveStartFlow: a tap that arrives at the login or
  /// Terms screen is dropped; one that arrives while starting up waits; Home
  /// decides the rest.
  void _gateStartFlow() {
    final request = _inbox.pending;
    if (request == null) return;
    if (resolveStartFlow(request, widget.controller.state, flowOpen: false) == StartFlowDecision.drop) _inbox.clear();
  }
```

7. Pass `startRequests: _inbox,` to `HomeShell(...)`.

- [ ] **Step 6: The Home half — `lib/ui/home_shell.dart`**

1. Add imports `import '../app_controller.dart';` and `import '../widget/start_flow.dart';`.
2. Add constructor parameter `this.startRequests,` and field

```dart
  /// Widget taps waiting for Home to decide them.
  final StartFlowInbox? startRequests;
```

3. In `initState`, after the `queueSettled` listener line, add:

```dart
    widget.startRequests?.addListener(_consumeStart);
    _home.addListener(_consumeStart);
    WidgetsBinding.instance.addPostFrameCallback((_) => _consumeStart());
```

4. In `dispose`, before `_home.dispose();`, add:

```dart
    widget.startRequests?.removeListener(_consumeStart);
    _home.removeListener(_consumeStart);
```

5. Add the methods:

```dart
  void _consumeStart() {
    final inbox = widget.startRequests;
    final request = inbox?.pending;
    if (inbox == null || request == null || !mounted) return;
    final decision = resolveStartFlow(
      request,
      Ready(widget.worker),
      flowOpen: _flow != null,
      home: (loading: _home.loading, nextAction: _home.nextAction),
    );
    switch (decision) {
      case StartFlowDecision.wait:
        return;
      case StartFlowDecision.drop:
        inbox.clear();
      case StartFlowDecision.stayOnHome:
        inbox.clear();
        _showHome();
      case StartFlowDecision.open:
        inbox.clear();
        _showHome();
        _startFlow(request);
    }
  }

  /// Back to Home from wherever the worker left the app: a tab, the Terms
  /// reader, the password sheet.
  void _showHome() {
    Navigator.of(context).popUntil((route) => route.isFirst);
    if (_tab != 0) setState(() => _tab = 0);
  }
```

- [ ] **Step 7: Wire it in `lib/main.dart`** — add `import 'widget/start_flow.dart';` and pass `launches: const ChannelLaunchRequests(),` to `WorkMateApp(...)`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `flutter test` → all pass. Then the Kotlin tests and a debug build exactly as in Task 10 Step 7 (items 3–4) → `BUILD SUCCESSFUL`, APK built.

- [ ] **Step 9: Stop — no commit.** `flutter analyze` → no issues.

---

### Task 12: Version, release build, phone check, roadmap

**Files:**
- Modify: `pubspec.yaml` (`version: 0.3.0+1003`)
- Modify: `Dacs Web/docs/superpowers/plans/2026-09-29-workmate-stage0-roadmap.md` (row 0D)
- Modify: this plan (append "Execution notes")

- [ ] **Step 1: Bump the version** — in `pubspec.yaml` change `version: 0.2.0+1002` to `version: 0.3.0+1003`.

- [ ] **Step 2: Full verification**

Run, in order (all must pass):
1. `flutter analyze` → `No issues found!`
2. `flutter test` → `All tests passed!`
3. `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location` → `BUILD SUCCESSFUL`
4. `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; flutter build apk --release` → `√ Built build\app\outputs\flutter-apk\app-release.apk` (must stay **under 50 MB**, the `app-releases` bucket limit; 0.2.0 was 37 MB).
5. Copy it: `Copy-Item build\app\outputs\flutter-apk\app-release.apk "C:\Users\John Aerol Tapales\Documents\WorkMate releases\dacs-workmate-0.3.0-1003.apk"`.

The release build needs `android/keystore.properties` (present on this machine). Never print, log or copy the keystore password.

- [ ] **Step 3: Phone checklist (with the user, on the Xiaomi)** — install the release APK over 0.2.0 (`adb install -r`), stay signed in, then:

| # | Check | Expected |
|---|---|---|
| 1 | Home | "Good morning/afternoon/evening, <first name>" by Manila hour; WEEKLY REWARD strip with five Mo–Fr cells, today outlined, a status pill and "N of M on time" |
| 2 | Airplane mode, pull to refresh | The strip says **Needs signal to check** and shows no cells |
| 3 | Profile | Active account, email, position, worker ID, "Accepted <date>" on the Terms row; the Terms open read-only |
| 4 | Change password: `abc` / `abc` | Bilingual "Use at least 8 characters." with no network call |
| 5 | Change password to the same one | Bilingual "That is your current password…" |
| 6 | Change password to a new one, then log out and in with it | "Your password has been changed."; the new one works. (Change it back afterwards if the account is shared.) |
| 7 | Long-press home screen → Widgets → DAC'S WorkMate "Time In / Out" | Card shows today's state: Time In (STEP 1 OF 4), or Time Out with a live ON SITE count, or Complete with both times |
| 8 | Tap the widget's Time In / Time Out | The app opens straight on the flow; after submitting, the widget changes within a second or two |
| 9 | Airplane mode, Time In or Out | Widget footer reads **QUEUED · WILL UPLOAD**; turn signal back on with the app closed → after the background send the footer clears and Home (when opened) says **Saved** without a pull |
| 10 | Tap a stale widget (e.g. Time In after already timing in elsewhere) | App opens on Home, no flow |
| 11 | Log out | Widget shows **SIGN IN** / "DAC'S WorkMate" and no times |
| 12 | Resize the widget small (one row) | Title + second line + arrow, nothing clipped |
| 13 | Update reminder (0B, unchanged code) | Only if the user chooses to publish 0.3.0 in Dacs Web → Attendance → App updates: a phone still on 0.2.0 shows the update screen on its next server call or resume |

Record any failure in Execution notes, fix, and repeat the affected rows.

- [ ] **Step 4: Roadmap** — in `Dacs Web/docs/superpowers/plans/2026-09-29-workmate-stage0-roadmap.md`, change row **0D**'s last cell from `written after 0C` to `0D done <date> — plan 2026-10-02-workmate-stage0d-extras.md; 0.3.0+1003 device-verified`.

- [ ] **Step 5: Execution notes** — append a `## Execution notes` section to this plan listing every deviation from the plan and why.

- [ ] **Step 6: Stop — no commit.** Tell the user both repos have changes ready to commit (WorkMate, and Dacs Web for the roadmap and this plan), and that publishing 0.3.0 in Dacs Web → Attendance → App updates is their decision.

---

## Self-review (done while writing)

- **Roadmap 0D coverage:** weekly reward view → Tasks 1–3; home-screen widget → Tasks 7–11; profile and password change → Tasks 4–6; update nudges → already at parity (stated above, re-checked in Task 12 row 13); greeting (parity checklist) → Task 3. The 0C-2 gap "Home doesn't auto-refresh after a background send" → Task 8.
- **Kotlin tests ported:** `WeeklyRewardTest` (18, Task 1), `GreetingTest` (3, Task 3), `PasswordChangeTest` (9, Task 4), `StartFlowRequestTest` (11, Task 11), `WidgetStateTest` (10, Task 9), `WidgetCardTest` (11, Task 9), `WidgetTypeScaleTest` (3, Task 9), `WidgetAwareRepositoriesTest` (as `widget_aware_attendance_test` + `widget_app_sync_test`, Task 7).
- **Names used across tasks:** `RewardApi` / `SupabaseRewardRemote` / `FakeRewards` (2→3); `AccountServices` (6→8, 11 tests); `WidgetPublisher.publish(AttendanceDb, String)` (7→8); `QueueSettled` (8); `TimeWidgetProvider.EXTRA_START_FLOW` (10→11); channels `com.dacs.workmate/widget` (7↔10) and `com.dacs.workmate/launch` (11).

## Execution notes (2026-10-02)

Run subagent-driven, no commits (the user commits); every task reviewed (spec + quality), then a whole-stage review on Opus, then the phone test on the Xiaomi. Final: 437 Dart tests, 34 Kotlin tests, analyze clean, release APK 37.4 MB (`WorkMate releases\dacs-workmate-0.3.0-1003.apk`).

Deviations from the plan text, and why:

- **Task 2** — the HomeController getter `rewardCells` shadows the top-level `rewardCells()`; home_controller.dart imports weekly_reward.dart with `hide rewardCells` plus `as wr show rewardCells`.
- **Task 3 → phone fix** — the reward header Row (label + Spacer + pill) overflowed in widget tests; a Wrap replaced it, but on the phone the Wrap shrink-wrapped and glued "WEEKLY REWARDNeeds signal to check". Final form: `Row([Expanded(label), SizedBox(12), status])` — the label gives way, the status stays at the right edge; a layout test pins it.
- **Task 5** — review finding: the cached Terms accepted date was not tied to the Terms version. `WorkerCache.termsAcceptedAt(id, version)` / `recordTermsAcceptedAt(id, version, at)` store `"<version>|<ms>"` under `terms_at.$id`; a date for another version reads as null.
- **Task 7** — review finding: unordered widget publishes could let an older worker push land after the sign-out push. `WidgetPublisher.publish` now runs in request order (one queue per publisher).
- **Final review** — a sign-out during a live-app background send could re-push the previous worker's day. `WidgetPublisher.publishIfCurrent(db, workerId, currentWorkerId)` guards the drain's push (`letInWorker = attendance.currentWorkerId`, set lazily). The background engine is unguarded across engines (accepted residual risk).
- **Line endings** — `core.autocrlf=true`: pre-existing files show CRLF in the working tree and some new files were written CRLF; git stores LF.

Phone results (Xiaomi 22041216G, 0.3.0+1003): greeting by Manila hour; reward strip matches `attendance_reward_progress` (Mon–Wed missing, Thu/Fri late vs 09:00 → Disqualified, 0 of 5) and offline says "Needs signal to check"; Profile shows Accepted 8 Sep 2026 (only after a load with signal — first load in airplane mode shows the plain row, by design); password: too short / reused / changed, bilingual; widget: Time Out with live ON SITE count, QUEUED while offline then cleared after the background send (12:16:40–44, app closed), SIGN IN with no times after log-out; widget Time In tap opened the flow (START_FLOW_IN 12:15:23 → Time In 12:15:53). No app errors in logcat.

Left for later (watch items): a widget tap while the password sheet is saving closes the sheet without the confirmation; `reauthentication_needed` (old session) or a timeout after the server applied the change gives a vague message; widget clock follows the phone's 12/24-hour setting; midnight roll-over can lag up to ~30 min; overlapping Home refreshes can land out of order; draw() uses the portrait width/height pair; KT-73255 annotation warnings.
