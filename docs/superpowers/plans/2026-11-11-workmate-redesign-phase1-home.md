# WorkMate Redesign Phase 1 (Home and shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WorkMate Home's four status cards with one "Needs you" list, a sync badge and a shortcut row; move
My tools / My agreements into a Profile "Mine" section; restyle the bottom bar; add the shared swipe-down sheet
(used for Meeting notes and Change password) — with no server change.

**Architecture:** Two pure rule files (`lib/home/needs_you.dart`, `lib/home/sync_summary.dart`) turn what the
existing controllers already know into rows and a count; small widgets in `lib/home/` draw them; `HomeShell` wires
them in. The code that opens a task or a request moves out of the tabs into shared opener functions, so Home and the
tabs open things the same way. A new `WmSheet` (built on `showModalBottomSheet`) gives every later phase one sheet.

**Tech Stack:** Flutter (Dart SDK ^3.10.8, Material 3), `flutter_test`, existing fakes in `test/`.

**Spec:** `docs/superpowers/specs/2026-11-11-workmate-redesign-phase1-home-design.md` (Dacs Web repo). Read it with
this plan; where they differ, the spec wins and the plan is fixed.

## Global Constraints

- Repository: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`, base `main` at `56e59c4` (0.11.1+1014). Run every
  command from that folder.
- **Never `git commit` or `git push`.** Each task ends with a checkpoint that lists the changed files; the user commits.
- **No server change:** no Supabase function, migration, table, column, Edge Function or storage rule.
- **No field, check or server rule is removed** from any form (owner decision, 11 Nov 2026).
- **No peso amount on Home or Profile.** Agreements show only after this session's read found at least one (0113).
- An unresolved tool submission never sends by itself (0107/0111); Phase 1 only shows it.
- Sync badge words: exactly `All sent` and `N not sent yet`. Hidden until every source was read.
- "Needs you": at most **5** rows, then `Show N more` / `Show fewer`; the count bubble is always the full count.
- Keep existing keys: `hero-time-in`, `hero-time-out`, `my-work-badge`, `mine-badge`, `tab-stock`, `new-request`,
  `open-notes`, `open-proposals`, `profile-change-password`, `profile-terms`, `new-password`, `confirm-password`,
  `tools-parts`.
- New keys (tests rely on them): `needs-<kind>-<target>` (e.g. `needs-read-t1`, `needs-toolRecords-all`), `needs-count`,
  `needs-more`, `needs-caught-up`, `next-delivery`, `shortcut-tools`, `shortcut-agreements`, `shortcut-notes`,
  `shortcut-new-request`, `shortcut-proposals`, `sync-all-sent`, `sync-not-sent`, `requests-badge`,
  `ring-badge-bubble`, `wm-nav-bar`, `wm-sheet-handle`, `wm-sheet-close`, `wm-sheet-back`, `profile-tools`,
  `profile-agreements`.
- **Never delete a test to make the suite pass.** A test that checked an old card is rewritten to check the same fact
  in its new place (each task names where).
- Finish with `flutter test` (whole suite) passing and `flutter analyze` reporting `No issues found!`.
- Version after Phase 1: `0.12.0+1015`.

**Behaviour notes the user should know (all follow the spec):**
- The team leader's "Team: N tools" line was only on the old Home card. Phase 1 shows the team inside Tools only.
- "Saved copy from 9:28" (tools) and "Updated 9:28 AM" (agreements) leave Home with the old cards; Tools and
  Agreements still show their own times inside.
- A phone with none of My Work, Requests or Tools shows no NEEDS YOU block at all.

---

### Task 1: "Read once" flags and the attendance waiting count

**Files:**
- Modify: `lib/workplan/ui/my_work_controller.dart`
- Modify: `lib/requests/list/requests_controller.dart`
- Modify: `lib/tools/data/tool_submitter.dart`
- Modify: `lib/attendance/data/attendance_api.dart`
- Modify: `lib/attendance/data/attendance_repository.dart`
- Modify: `lib/widget/widget_aware_attendance.dart`
- Modify: `lib/attendance/home/home_controller.dart`
- Modify: `test/attendance/fakes.dart`
- Modify: `test/attendance/data/attendance_repository_test.dart`
- Create: `test/home/read_flags_test.dart`

**Interfaces:**
- Produces: `MyWorkController.read` (`bool`), `RequestsController.read` (`bool`), `ToolSubmitter.loaded` (`bool`),
  `AttendanceApi.waitingCount()` (`Future<int>`), `HomeController.waiting` (`int?`; null = not read or unreadable),
  `FakeAttendance.waiting` (`int`, default 0) and `FakeAttendance.waitingError` (`Object?`).

- [ ] **Step 1: Write the failing tests**

Create `test/home/read_flags_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/home/home_controller.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/list/requests_controller.dart';
import 'package:workmate/tools/data/tool_pending_store.dart';
import 'package:workmate/tools/data/tool_submitter.dart';
import 'package:workmate/tools/domain/tool_submission.dart';
import 'package:workmate/workplan/data/workplan_api.dart';
import 'package:workmate/workplan/ui/my_work_controller.dart';

import '../attendance/fakes.dart';
import '../requests/request_fakes.dart';
import '../tools/tool_fakes.dart';
import '../workplan/workplan_fakes.dart';

/// A tool store the phone cannot read at all.
class BrokenToolStore implements ToolPendingStore {
  @override
  Future<ToolPendingLoad> load() async => throw StateError('unreadable');
  @override
  Future<void> save(List<ToolSubmission> readable) async {}
  @override
  Future<void> dropUnreadable(String userId, String opId) async {}
}

/// Lets unawaited reads (HomeController's side loads) finish.
Future<void> settle() async {
  for (var i = 0; i < 5; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  group('My Work is read once a load gave a list the phone can trust', () {
    test('not before the first load', () {
      expect(MyWorkController(api: FakeWorkPlanApi()).read, isFalse);
    });

    test('the server answered', () async {
      final c = MyWorkController(api: FakeWorkPlanApi());
      await c.refresh();
      expect(c.read, isTrue);
    });

    test('no signal, but a saved copy', () async {
      final api = FakeWorkPlanApi()..view = WorkPlanView(error: Exception('no signal'), fetchedAt: DateTime.utc(2026, 11, 10));
      final c = MyWorkController(api: api);
      await c.refresh();
      expect(c.read, isTrue);
    });

    test('no signal and nothing saved: not read', () async {
      final api = FakeWorkPlanApi()..view = WorkPlanView(error: Exception('no signal'));
      final c = MyWorkController(api: api);
      await c.refresh();
      expect(c.read, isFalse);
    });

    test('the phone could not load at all: not read', () async {
      final c = MyWorkController(api: FakeWorkPlanApi()..loadError = StateError('db'));
      await c.refresh();
      expect(c.read, isFalse);
    });
  });

  group('Requests is read the same way', () {
    test('not before the first load', () {
      expect(RequestsController(api: FakeRequestsApi()).read, isFalse);
    });

    test('the server answered', () async {
      final c = RequestsController(api: FakeRequestsApi());
      await c.refresh();
      expect(c.read, isTrue);
    });

    test('no signal, but a saved copy', () async {
      final api = FakeRequestsApi()
        ..view = RequestsView(entries: const [], error: Exception('no signal'), fetchedAt: DateTime.utc(2026, 11, 10));
      final c = RequestsController(api: api);
      await c.refresh();
      expect(c.read, isTrue);
    });

    test('no signal and nothing saved: not read', () async {
      final api = FakeRequestsApi()..view = RequestsView(entries: const [], error: Exception('no signal'));
      final c = RequestsController(api: api);
      await c.refresh();
      expect(c.read, isFalse);
    });

    test('the read threw: not read', () async {
      final c = RequestsController(api: FakeRequestsApi()..viewError = StateError('db'));
      await c.refresh();
      expect(c.read, isFalse);
    });
  });

  group('tool records on the phone', () {
    test('loaded only after the phone\'s store was read', () async {
      final s = ToolSubmitter(remote: FakeToolsRemote(), store: MemoryToolPendingStore());
      expect(s.loaded, isFalse);
      await s.load('u1');
      expect(s.loaded, isTrue);
    });

    test('an unreadable store: never loaded', () async {
      final s = ToolSubmitter(remote: FakeToolsRemote(), store: BrokenToolStore());
      await expectLater(s.load('u1'), throwsStateError);
      expect(s.loaded, isFalse);
    });
  });

  group('attendance waiting on the phone', () {
    test('unknown until read, then the count', () async {
      final a = FakeAttendance()..waiting = 2;
      final c = HomeController(attendance: a, scheduler: FakeScheduler());
      expect(c.waiting, isNull);
      await c.refresh();
      await settle();
      expect(c.waiting, 2);
    });

    test('a failed local read makes it unknown again', () async {
      final a = FakeAttendance()..waiting = 2;
      final c = HomeController(attendance: a, scheduler: FakeScheduler());
      await c.refresh();
      await settle();
      a.waitingError = StateError('db');
      await c.refresh();
      await settle();
      expect(c.waiting, isNull);
    });
  });
}
```

Add to `test/attendance/data/attendance_repository_test.dart`, after the test `'a failed enqueue does not fail a saved submit'`:

```dart
  test('waiting: this worker\'s rows still to send; a refused one is not waiting; nobody has none', () async {
    expect(await repo.waitingCount(), 0);
    await repo.submit(await request(TimeDirection.timeIn, '2026-08-18T23:45:00Z'));
    await repo.submit(await request(TimeDirection.timeOut, '2026-08-19T09:30:00Z', eventId: 'e2'));
    expect(await repo.waitingCount(), 2);
    await db.markFailed('e2', 'outsideRadius');
    expect(await repo.waitingCount(), 1, reason: 'refused for good: shown as a notice, not waiting');
    final anon = AttendanceRepository(
      db: db, remote: remote, device: device, scheduler: scheduler,
      currentWorkerId: () => '', photoDir: () async => tmp, now: () => now,
    );
    expect(await anon.waitingCount(), 0);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `flutter test test/home/read_flags_test.dart test/attendance/data/attendance_repository_test.dart`
Expected: compile errors — `read`, `loaded`, `waiting`, `waitingCount` and `FakeAttendance.waiting` do not exist.

- [ ] **Step 3: Implement**

`lib/attendance/data/attendance_api.dart` — add after `refusedSubmissions()`:

```dart
  /// How many of this worker's Time In / Time Out are still on the phone,
  /// waiting to be sent (refused ones are not waiting). Never asks the server.
  Future<int> waitingCount();
```

`lib/attendance/data/attendance_repository.dart` — add after `refusedSubmissions()`:

```dart
  @override
  Future<int> waitingCount() async {
    final workerId = currentWorkerId();
    if (workerId.isEmpty) return 0;
    return (await db.sendable(workerId)).length;
  }
```

`lib/widget/widget_aware_attendance.dart` — add after `refusedSubmissions()`:

```dart
  @override
  Future<int> waitingCount() => _inner.waitingCount();
```

`test/attendance/fakes.dart` — in `FakeAttendance`, after `final dismissed = <String>[];`:

```dart
  /// What [waitingCount] answers; [waitingError] is thrown instead while set.
  int waiting = 0;
  Object? waitingError;

  @override
  Future<int> waitingCount() async {
    if (waitingError != null) throw waitingError!;
    return waiting;
  }
```

`lib/attendance/home/home_controller.dart`:
- add the field after `bool _disposed = false;`:

```dart
  int? _waiting;
```

- add the getter after `List<PendingSubmission> get refused => _refused;`:

```dart
  /// This worker's Time In / Time Out still on the phone; null until the
  /// phone has been read, or when it could not be (Home's badge then shows
  /// nothing rather than a guess).
  int? get waiting => _waiting;
```

- in `refresh()`, after `unawaited(_loadRefused());` add `unawaited(_loadWaiting());`
- add after `_loadRefused()`:

```dart
  Future<void> _loadWaiting() async {
    try {
      _waiting = await _attendance.waitingCount();
    } catch (_) {
      _waiting = null;
    }
    _notify();
  }
```

`lib/workplan/ui/my_work_controller.dart`:
- add the field after `bool _again = false;`: `bool _read = false;`
- add the getter after `WpFailure? get failure => _failure;`:

```dart
  /// A load has given this phone a list it can trust: the server's, or its
  /// saved copy. Home says "all caught up" only after this (redesign §5.3).
  bool get read => _read;
```

- in `_load()`, right after `_view = view;` add:

```dart
      if (view.error == null || view.fetchedAt != null) _read = true;
```

`lib/requests/list/requests_controller.dart`:
- add the field after `bool _again = false;`: `bool _read = false;`
- add the getter after `RequestFailure? get failure => _failure;`:

```dart
  /// A load has given this phone a list it can trust: the server's, or its
  /// saved copy. Home says "all caught up" only after this (redesign §5.3).
  bool get read => _read;
```

- in `_load()`, right after `_view = view;` add:

```dart
      if (view.error == null || view.fetchedAt != null) _read = true;
```

`lib/tools/data/tool_submitter.dart`:
- add the field after `bool _disposed = false;`: `bool _loaded = false;`
- add the getter after `bool get blocked => …;`:

```dart
  /// The phone's saved tool records were read once for this account. Home's
  /// badge and "Needs you" wait for it.
  bool get loaded => _loaded;
```

- in `load(String userId)`, after `await _reload();` add `_loaded = true;`

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/home/read_flags_test.dart test/attendance/data/attendance_repository_test.dart test/attendance/home test/workplan test/requests test/tools`
Expected: all pass.

- [ ] **Step 5: Checkpoint (no commit)**

Report the 10 files above to the user for their commit.

---

### Task 2: The rules — "Needs you" rows and the sync count

**Files:**
- Create: `lib/home/needs_you.dart`
- Create: `lib/home/sync_summary.dart`
- Create: `test/home/needs_you_test.dart`
- Create: `test/home/sync_summary_test.dart`

**Interfaces:**
- Consumes: `WpEntry` (`toRead`, `toCheck`, `shownFailures`, `task.id/title/changedSinceRead`), `visibleFailures`,
  `opLabel(WpOp)`, `RequestEntry` (`state`, `remote?.mine/title`, `draft?.destination?.label/lines`, `key`),
  `ToolSubmission` (`opId`, `summary`).
- Produces:
  - `enum NeedsKind { read, check, notAccepted, fixRequest, finishDraft, toolUnresolved, toolRecords }`
  - `class NeedsRow { NeedsKind kind; String title; String line; String action; String? target; bool get quiet; String get id; }` — `id` is `'${kind.name}-${target ?? 'all'}'`
  - `class NeedsYou { List<NeedsRow> rows; bool allRead; bool get caughtUp; bool get hidden; }`
  - `NeedsYou needsYou({List<WpEntry>? work, List<WpOp> workOtherFailed, bool workRead, List<RequestEntry>? requests, bool requestsRead, List<ToolSubmission>? toolsUnresolved, bool toolRecordsNeedChecking, bool toolsRead})` — a null list means that module is off.
  - `bool isOwnRequest(RequestEntry e)`, `int ownToFix(List<RequestEntry> entries)`
  - `class SyncSummary { int waiting; bool hidden; bool get allSent; }`, `SyncSummary syncSummary(List<int?> counts)` (null = not read yet), `int toolsNotConfirmed(int unresolved, int unreadable, bool recoveryNeeded)`

- [ ] **Step 1: Write the failing tests**

Create `test/home/needs_you_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/home/needs_you.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/tools/domain/tool_submission.dart';
import 'package:workmate/workplan/domain/wp_op.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';
import 'package:workmate/workplan/ui/workplan_copy.dart' show opLabel;

import '../requests/domain/request_models_test.dart' show requestDoc;
import '../requests/request_fakes.dart';
import '../workplan/workplan_fakes.dart';

WpEntry entry(Map<String, dynamic> doc, {List<WpOp> pending = const [], List<WpOp> failed = const []}) =>
    WpEntry(task: task0(doc), pendingOps: pending, failedOps: failed);

WpOp op(WpOpKind kind, {String id = 'op1', String task = 't1', String? parent, bool refused = true}) => WpOp(
      opId: id,
      workerId: 'u1',
      kind: kind,
      createdAt: DateTime.utc(2026, 11, 11),
      taskId: task,
      parentOpId: parent,
      lastError: refused ? 'NOT_ALLOWED' : null,
      failedPermanently: refused,
    );

RequestEntry remote(String id, SyncState state, {bool mine = true}) =>
    RequestEntry(state: state, remote: RemoteRequest.fromJson(requestDoc(id: id, mine: mine)));

RequestEntry draft(String id, {int lines = 2, bool placed = true}) => RequestEntry(
      state: SyncState.draft,
      draft: RequestDraft(
        id: id,
        createdAt: DateTime.utc(2026, 11, 11),
        destination: placed ? site : null,
        lines: [for (var i = 0; i < lines; i++) DraftLine.fromCatalog('$id-l$i', pipe)],
      ),
    );

ToolSubmission toolRecord(String id) => ToolSubmission.create(
      opId: id,
      userId: 'u1',
      write: ToolWrite.giveBack,
      params: {'p_op': id},
      summary: 'Return TOOL-0001 · Grinder',
      now: DateTime.utc(2026, 11, 11),
    );

List<(NeedsKind, String, String, String, String?)> shape(NeedsYou n) =>
    [for (final r in n.rows) (r.kind, r.title, r.line, r.action, r.target)];

void main() {
  test('a new task and a changed task: Read, each with its own words', () {
    final n = needsYou(work: [
      entry(taskDoc(id: 't1', title: 'Skim coat')),
      entry(taskDoc(id: 't2', title: 'Ceiling', version: 2, ackVersion: 1)),
    ]);
    expect(shape(n), [
      (NeedsKind.read, 'Skim coat', 'New task · read it first', 'Read', 't1'),
      (NeedsKind.read, 'Ceiling', 'Changed by the office · read it again', 'Read', 't2'),
    ]);
  });

  test('reported work a leader can check: Check', () {
    final n = needsYou(work: [entry(taskDoc(id: 't3', title: 'Tiles', status: 'reported_done', canCheck: true, ackVersion: 1))]);
    expect(shape(n), [(NeedsKind.check, 'Tiles', 'Reported done · check the work', 'Check', 't3')]);
  });

  test('a refused My Work action, on a listed task or not: See', () {
    final start = op(WpOpKind.start);
    final gone = op(WpOpKind.progress, id: 'op2', task: 'gone');
    final n = needsYou(work: [entry(taskDoc(id: 't1', ackVersion: 1), failed: [start])], workOtherFailed: [gone]);
    expect(shape(n), [
      (NeedsKind.notAccepted, opLabel(start), 'Not accepted · see why', 'See', 'op1'),
      (NeedsKind.notAccepted, opLabel(gone), 'Not accepted · see why', 'See', 'op2'),
    ]);
  });

  test('a photo refused with its report is one row, not two', () {
    final report = op(WpOpKind.progress, id: 'op1');
    final photo = op(WpOpKind.photo, id: 'op1-photo', parent: 'op1');
    final n = needsYou(work: [entry(taskDoc(ackVersion: 1), failed: [report, photo])]);
    expect(n.rows.single.target, 'op1');
  });

  test('own requests to fix; a team member\'s request never', () {
    final requests = [
      remote('r1', SyncState.needsResolution),
      remote('r2', SyncState.needsResolution, mine: false),
      RequestEntry(state: SyncState.failed, draft: RequestDraft(id: 'd9', createdAt: DateTime.utc(2026, 11, 11), destination: site)),
      remote('r3', SyncState.pending),
      remote('r4', SyncState.received),
    ];
    expect(shape(needsYou(requests: requests)), [
      (NeedsKind.fixRequest, 'Request · Santos Townhouse · Main Contract', 'Needs resolution · check it and send again', 'Fix', 'r1'),
      (NeedsKind.fixRequest, 'Request · Santos Townhouse · Main Contract', 'Not accepted · check it and send again', 'Fix', 'd9'),
    ]);
    expect(ownToFix(requests), 2);
    expect(isOwnRequest(requests[1]), isFalse);
  });

  test('a draft: Finish, grey, with its item count', () {
    final n = needsYou(requests: [draft('d1'), draft('d2', lines: 1), draft('d3', lines: 0, placed: false)]);
    expect(shape(n), [
      (NeedsKind.finishDraft, 'Draft · Santos Townhouse · Main Contract', '2 items · not sent yet', 'Finish', 'd1'),
      (NeedsKind.finishDraft, 'Draft · Santos Townhouse · Main Contract', '1 item · not sent yet', 'Finish', 'd2'),
      (NeedsKind.finishDraft, 'Draft · New request', '0 items · not sent yet', 'Finish', 'd3'),
    ]);
    expect(n.rows.every((r) => r.quiet), isTrue);
  });

  test('things only waiting for signal are never rows (the badge says them)', () {
    final n = needsYou(
      work: [entry(taskDoc(ackVersion: 1), pending: [op(WpOpKind.progress, refused: false)])],
      requests: [remote('r3', SyncState.pending)],
    );
    expect(n.rows, isEmpty);
  });

  test('tool records not confirmed: one row each, and one for records the phone cannot read', () {
    final n = needsYou(toolsUnresolved: [toolRecord('op7')], toolRecordsNeedChecking: true);
    expect(shape(n), [
      (NeedsKind.toolUnresolved, 'Return TOOL-0001 · Grinder', 'Not confirmed · Send again or Check', 'Check', 'op7'),
      (NeedsKind.toolRecords, 'Saved tool records', 'Need checking', 'Check', null),
    ]);
    expect(n.rows.last.id, 'toolRecords-all');
  });

  test('the order: read, check, not accepted, fix, finish, tools', () {
    final n = needsYou(
      work: [
        entry(taskDoc(id: 't3', title: 'Tiles', status: 'reported_done', canCheck: true, ackVersion: 1)),
        entry(taskDoc(id: 't1', title: 'Skim coat'), failed: [op(WpOpKind.start)]),
      ],
      requests: [draft('d1'), remote('r1', SyncState.needsResolution)],
      toolsUnresolved: [toolRecord('op7')],
    );
    expect([for (final r in n.rows) r.kind], [
      NeedsKind.read,
      NeedsKind.check,
      NeedsKind.notAccepted,
      NeedsKind.fixRequest,
      NeedsKind.finishDraft,
      NeedsKind.toolUnresolved,
    ]);
  });

  test('"all caught up" only when every source was read', () {
    expect(needsYou(work: [], requests: [], toolsUnresolved: []).caughtUp, isTrue);
    final unread = needsYou(work: [], workRead: false, requests: []);
    expect([unread.caughtUp, unread.hidden], [false, true]);
    final partly = needsYou(work: [], workRead: false, requests: [draft('d1')]);
    expect([partly.caughtUp, partly.hidden, partly.rows.length], [false, false, 1]);
  });

  test('a module that is off counts as read, with nothing to show', () {
    final n = needsYou();
    expect([n.rows, n.caughtUp], [isEmpty, true]);
  });
}
```

Create `test/home/sync_summary_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/home/sync_summary.dart';

void main() {
  test('every source read and nothing waiting: All sent', () {
    final s = syncSummary([0, 0, 0, 0]);
    expect([s.hidden, s.allSent, s.waiting], [false, true, 0]);
  });

  test('the four sources add up', () {
    final s = syncSummary([1, 2, 3, 4]);
    expect([s.hidden, s.allSent, s.waiting], [false, false, 10]);
  });

  test('any source not read yet: hidden — never an early All sent', () {
    final s = syncSummary([0, null, 0, 0]);
    expect([s.hidden, s.allSent], [true, false]);
  });

  test('tool records not confirmed: unresolved + unreadable + one for a store needing recovery', () {
    expect(toolsNotConfirmed(2, 1, true), 4);
    expect(toolsNotConfirmed(0, 0, false), 0);
  });
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `flutter test test/home/needs_you_test.dart test/home/sync_summary_test.dart`
Expected: compile errors — `package:workmate/home/needs_you.dart` and `sync_summary.dart` do not exist.

- [ ] **Step 3: Implement**

Create `lib/home/needs_you.dart`:

```dart
import '../requests/data/requests_api.dart';
import '../requests/domain/request_status.dart';
import '../tools/domain/tool_submission.dart';
import '../workplan/domain/wp_op.dart';
import '../workplan/domain/wp_rules.dart';
import '../workplan/ui/workplan_copy.dart' show opLabel;

/// What a "Needs you" row asks for (redesign spec §5.2), in Home's order.
enum NeedsKind { read, check, notAccepted, fixRequest, finishDraft, toolUnresolved, toolRecords }

/// One thing the worker has to do, with the word on its button.
class NeedsRow {
  const NeedsRow({required this.kind, required this.title, required this.line, required this.action, this.target});

  final NeedsKind kind;
  final String title;
  final String line;

  /// Read, Check, See, Fix or Finish.
  final String action;

  /// The task id (read, check), request entry key (fixRequest, finishDraft)
  /// or operation id (notAccepted, toolUnresolved); null for toolRecords.
  final String? target;

  /// A draft is the worker's own unfinished work, not a problem: grey, not red.
  bool get quiet => kind == NeedsKind.finishDraft;

  /// Unique on Home; the row's key is 'needs-$id'.
  String get id => '${kind.name}-${target ?? 'all'}';
}

class NeedsYou {
  const NeedsYou({required this.rows, required this.allRead});

  final List<NeedsRow> rows;

  /// Every source finished at least one load it can trust (spec §5.3).
  final bool allRead;

  /// "You are all caught up" — only when everything was read.
  bool get caughtUp => allRead && rows.isEmpty;

  /// Nothing known yet: the whole block stays off Home.
  bool get hidden => !allRead && rows.isEmpty;
}

/// Still on this phone (draft, pending, refused send), or the server says it is theirs.
bool isOwnRequest(RequestEntry e) => e.remote == null || e.remote!.mine;

bool _toFix(RequestEntry e) => e.state == SyncState.failed || e.state == SyncState.needsResolution;

/// Own requests the office refused or wants fixed: the Requests tab's red number.
int ownToFix(List<RequestEntry> entries) => entries.where((e) => isOwnRequest(e) && _toFix(e)).length;

String _requestTitle(RequestEntry e) => e.remote?.title ?? e.draft?.destination?.label ?? 'New request';

/// Builds Home's rows from what the controllers already know. A null list
/// means that module is off: read, with nothing to show.
NeedsYou needsYou({
  List<WpEntry>? work,
  List<WpOp> workOtherFailed = const [],
  bool workRead = true,
  List<RequestEntry>? requests,
  bool requestsRead = true,
  List<ToolSubmission>? toolsUnresolved,
  bool toolRecordsNeedChecking = false,
  bool toolsRead = true,
}) {
  final rows = <NeedsRow>[];
  final tasks = work ?? const <WpEntry>[];
  for (final e in tasks) {
    if (!e.toRead) continue;
    rows.add(NeedsRow(
      kind: NeedsKind.read,
      title: e.task.title,
      line: e.task.changedSinceRead ? 'Changed by the office · read it again' : 'New task · read it first',
      action: 'Read',
      target: e.task.id,
    ));
  }
  for (final e in tasks) {
    if (!e.toCheck) continue;
    rows.add(NeedsRow(kind: NeedsKind.check, title: e.task.title, line: 'Reported done · check the work', action: 'Check', target: e.task.id));
  }
  if (work != null) {
    for (final o in [for (final e in tasks) ...e.shownFailures, ...visibleFailures(workOtherFailed)]) {
      rows.add(NeedsRow(kind: NeedsKind.notAccepted, title: opLabel(o), line: 'Not accepted · see why', action: 'See', target: o.opId));
    }
  }
  final entries = requests ?? const <RequestEntry>[];
  for (final e in entries) {
    if (!isOwnRequest(e) || !_toFix(e)) continue;
    rows.add(NeedsRow(
      kind: NeedsKind.fixRequest,
      title: 'Request · ${_requestTitle(e)}',
      line: e.state == SyncState.needsResolution ? 'Needs resolution · check it and send again' : 'Not accepted · check it and send again',
      action: 'Fix',
      target: e.key,
    ));
  }
  for (final e in entries) {
    if (e.state != SyncState.draft) continue;
    final n = e.draft?.lines.length ?? 0;
    rows.add(NeedsRow(
      kind: NeedsKind.finishDraft,
      title: 'Draft · ${e.draft?.destination?.label ?? 'New request'}',
      line: '$n item${n == 1 ? '' : 's'} · not sent yet',
      action: 'Finish',
      target: e.key,
    ));
  }
  for (final s in toolsUnresolved ?? const <ToolSubmission>[]) {
    rows.add(NeedsRow(
      kind: NeedsKind.toolUnresolved,
      title: s.summary.isEmpty ? 'Tool record' : s.summary,
      line: 'Not confirmed · Send again or Check',
      action: 'Check',
      target: s.opId,
    ));
  }
  if (toolRecordsNeedChecking) {
    rows.add(const NeedsRow(kind: NeedsKind.toolRecords, title: 'Saved tool records', line: 'Need checking', action: 'Check'));
  }
  final allRead = (work == null || workRead) && (requests == null || requestsRead) && (toolsUnresolved == null || toolsRead);
  return NeedsYou(rows: rows, allRead: allRead);
}
```

Create `lib/home/sync_summary.dart`:

```dart
/// What Home's sync badge says (redesign spec §6).
class SyncSummary {
  const SyncSummary.hidden()
      : waiting = 0,
        hidden = true;
  const SyncSummary.count(this.waiting) : hidden = false;

  /// Records still on this phone, all sources together.
  final int waiting;

  /// Some source has not been read yet: show nothing, never a guess.
  final bool hidden;

  bool get allSent => !hidden && waiting == 0;
}

/// [counts]: one per source (attendance, requests, My Work, tools); null =
/// not read yet. A source that is off passes 0.
SyncSummary syncSummary(List<int?> counts) {
  if (counts.any((c) => c == null)) return const SyncSummary.hidden();
  return SyncSummary.count(counts.fold<int>(0, (n, c) => n + c!));
}

/// Tool records the phone holds that are not confirmed: each unresolved one,
/// each unreadable one, and one more when the store itself needs recovery.
int toolsNotConfirmed(int unresolved, int unreadable, bool recoveryNeeded) => unresolved + unreadable + (recoveryNeeded ? 1 : 0);
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/home/needs_you_test.dart test/home/sync_summary_test.dart`
Expected: all pass.

- [ ] **Step 5: Checkpoint (no commit)**

Report the 4 new files.

---

### Task 3: Theme, bottom bar pieces and the shared sheet

**Files:**
- Modify: `lib/ui/theme.dart`
- Create: `lib/ui/wm_nav_bar.dart`
- Create: `lib/ui/wm_sheet.dart`
- Create: `test/ui/wm_nav_bar_test.dart`
- Create: `test/ui/wm_sheet_test.dart`

**Interfaces:**
- Produces: `WmNavBar({required int selectedIndex, required ValueChanged<int> onDestinationSelected, required List<Widget> destinations})`;
  `RingBadge({Key? key, required int count, required Widget child})`;
  `Future<T?> showWmSheet<T>(BuildContext context, {required WidgetBuilder builder})`;
  `WmSheetFrame({required String title, String? subtitle, VoidCallback? onBack, bool tall = false, required List<Widget> children, Widget? footer})`;
  `WmSheetButton({Key? key, required String label, required IconData icon, required VoidCallback? onPressed, String? tagalog, bool busy = false})`;
  `const wmSheetCloseDrag = 110.0`.

- [ ] **Step 1: Write the failing tests**

Create `test/ui/wm_nav_bar_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/ui/wm_nav_bar.dart';

void main() {
  testWidgets('a count shows in a red bubble with a white ring; none at 0', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: const Scaffold(
        body: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            RingBadge(key: Key('a'), count: 3, child: Icon(Icons.assignment)),
            SizedBox(height: 24),
            RingBadge(key: Key('b'), count: 0, child: Icon(Icons.inventory_2)),
          ]),
        ),
      ),
    ));
    expect(find.descendant(of: find.byKey(const Key('a')), matching: find.text('3')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('b')), matching: find.byType(Text)), findsNothing);
    final bubble = tester.widget<Container>(find.byKey(const Key('ring-badge-bubble')));
    final d = bubble.decoration! as BoxDecoration;
    final ring = (d.border! as Border).top;
    expect([d.color, ring.color, ring.width], [WmColors.danger, Colors.white, 2.0]);
  });

  test('the bar theme: white, a light-green pill, green selected labels, grey others', () {
    final t = workMateTheme().navigationBarTheme;
    expect([t.backgroundColor, t.indicatorColor], [Colors.white, WmColors.greenBorder]);
    expect(t.labelTextStyle!.resolve({WidgetState.selected})!.color, WmColors.green);
    expect(t.labelTextStyle!.resolve(<WidgetState>{})!.color, WmColors.textMuted);
  });

  testWidgets('the bar has a line on top and reports the tab tapped', (tester) async {
    var picked = -1;
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        bottomNavigationBar: WmNavBar(
          selectedIndex: 0,
          onDestinationSelected: (i) => picked = i,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.history), label: 'History'),
          ],
        ),
      ),
    ));
    expect(find.byType(NavigationBar), findsOneWidget);
    final box = tester.widget<DecoratedBox>(find.byKey(const Key('wm-nav-bar')));
    expect(((box.decoration as BoxDecoration).border! as Border).top.color, WmColors.border);
    await tester.tap(find.text('History'));
    expect(picked, 1);
  });

  test('pop-up messages float, dark and rounded', () {
    final s = workMateTheme().snackBarTheme;
    expect([s.behavior, s.backgroundColor], [SnackBarBehavior.floating, WmColors.text]);
  });
}
```

Create `test/ui/wm_sheet_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/ui/wm_sheet.dart';

import '../attendance/fakes.dart' show useTallPhone;

void main() {
  late int sends;

  Widget host({Widget? footer}) => MaterialApp(
        theme: workMateTheme(),
        home: Scaffold(
          body: Builder(
            builder: (context) => Center(
              child: TextButton(
                onPressed: () => showWmSheet<void>(
                  context,
                  builder: (_) => WmSheetFrame(title: 'Sheet', subtitle: 'Tagalog line', footer: footer, children: const [Text('Body')]),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );

  Future<void> open(WidgetTester tester, {Widget? footer}) async {
    useTallPhone(tester);
    sends = 0;
    await tester.pumpWidget(host(footer: footer));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Body'), findsOneWidget);
  }

  final handle = find.byKey(const Key('wm-sheet-handle'));

  testWidgets('title and Tagalog subtitle', (tester) async {
    await open(tester);
    expect(find.text('Sheet'), findsOneWidget);
    expect(find.text('Tagalog line'), findsOneWidget);
  });

  testWidgets('a short, slow drag springs back', (tester) async {
    await open(tester);
    await tester.timedDrag(handle, const Offset(0, 60), const Duration(milliseconds: 800));
    await tester.pumpAndSettle();
    expect(find.text('Body'), findsOneWidget);
  });

  testWidgets('dragged down past 110 px, it closes', (tester) async {
    await open(tester);
    await tester.timedDrag(handle, const Offset(0, 160), const Duration(milliseconds: 800));
    await tester.pumpAndSettle();
    expect(find.text('Body'), findsNothing);
  });

  testWidgets('a quick flick down closes it', (tester) async {
    await open(tester);
    await tester.fling(handle, const Offset(0, 80), 1500);
    await tester.pumpAndSettle();
    expect(find.text('Body'), findsNothing);
  });

  testWidgets('the × closes it', (tester) async {
    await open(tester);
    await tester.tap(find.byKey(const Key('wm-sheet-close')));
    await tester.pumpAndSettle();
    expect(find.text('Body'), findsNothing);
  });

  testWidgets('Android Back closes it', (tester) async {
    await open(tester);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Body'), findsNothing);
  });

  testWidgets('a tap outside closes it', (tester) async {
    await open(tester);
    await tester.tapAt(const Offset(20, 20));
    await tester.pumpAndSettle();
    expect(find.text('Body'), findsNothing);
  });

  testWidgets('the footer button, with its Tagalog line, does its job', (tester) async {
    await open(tester, footer: WmSheetButton(label: 'SEND', icon: Icons.send, tagalog: 'Ipadala', onPressed: () => sends++));
    expect(find.text('Ipadala'), findsOneWidget);
    await tester.tap(find.text('SEND'));
    expect(sends, 1);
  });

  testWidgets('a footer button with no action does nothing', (tester) async {
    await open(tester, footer: const WmSheetButton(label: 'SEND', icon: Icons.send, onPressed: null));
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
  });
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `flutter test test/ui/wm_nav_bar_test.dart test/ui/wm_sheet_test.dart`
Expected: compile errors — `wm_nav_bar.dart` and `wm_sheet.dart` do not exist.

- [ ] **Step 3: Implement**

`lib/ui/theme.dart` — inside `ThemeData(...)` in `workMateTheme()`, after `filledButtonTheme: …,` add:

```dart
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 68,
        indicatorColor: WmColors.greenBorder,
        indicatorShape: const StadiumBorder(),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final on = states.contains(WidgetState.selected);
          return TextStyle(
            fontFamily: 'Barlow',
            fontSize: 12,
            fontWeight: on ? FontWeight.w800 : FontWeight.w600,
            color: on ? WmColors.green : WmColors.textMuted,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(size: 24, color: states.contains(WidgetState.selected) ? WmColors.green : WmColors.textMuted),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: WmColors.text,
        contentTextStyle: const TextStyle(fontFamily: 'Barlow', color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        elevation: 6,
      ),
```

Create `lib/ui/wm_nav_bar.dart`:

```dart
import 'package:flutter/material.dart';

import 'theme.dart';

/// The bottom bar (redesign spec §7.1): Flutter's NavigationBar, themed in
/// workMateTheme(), with a thin line on top. Both shells use it.
class WmNavBar extends StatelessWidget {
  const WmNavBar({super.key, required this.selectedIndex, required this.onDestinationSelected, required this.destinations});

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<Widget> destinations;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        key: const Key('wm-nav-bar'),
        decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: WmColors.border))),
        child: NavigationBar(selectedIndex: selectedIndex, onDestinationSelected: onDestinationSelected, destinations: destinations),
      );
}

/// A red count bubble with a white ring at the icon's top right; nothing at 0.
class RingBadge extends StatelessWidget {
  const RingBadge({super.key, required this.count, required this.child});

  final int count;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return child;
    return Stack(clipBehavior: Clip.none, children: [
      child,
      Positioned(
        top: -7,
        right: -12,
        child: Container(
          key: const Key('ring-badge-bubble'),
          constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
          padding: const EdgeInsets.symmetric(horizontal: 4),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: WmColors.danger,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: Text('$count', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800, height: 1)),
        ),
      ),
    ]);
  }
}
```

Create `lib/ui/wm_sheet.dart`:

```dart
import 'package:flutter/material.dart';

import 'theme.dart';

/// Dragged down further than this, the sheet closes when let go (spec §8.1).
const wmSheetCloseDrag = 110.0;

/// A flick down faster than this (logical px/s) closes it too.
const _closeVelocity = 700.0;

/// Opens a WorkMate sheet; [builder] returns a [WmSheetFrame]. Android Back,
/// a tap outside, the × button or dragging the header down closes it.
Future<T?> showWmSheet<T>(BuildContext context, {required WidgetBuilder builder}) => showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      enableDrag: false,
      backgroundColor: Colors.transparent,
      elevation: 0,
      barrierColor: const Color(0x6B0F110F),
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.92),
      sheetAnimationStyle: const AnimationStyle(duration: Duration(milliseconds: 340), curve: Cubic(0.2, 0.8, 0.2, 1)),
      builder: builder,
    );

/// The sheet's chrome: grab handle, title (and Tagalog), optional back
/// arrow, close button, a scrolling body and an optional white footer.
class WmSheetFrame extends StatefulWidget {
  const WmSheetFrame({
    super.key,
    required this.title,
    this.subtitle,
    this.onBack,
    this.tall = false,
    required this.children,
    this.footer,
  });

  final String title;
  final String? subtitle;

  /// Shows a round back arrow (a form opened from another sheet).
  final VoidCallback? onBack;

  /// 92 % of the screen whatever the content; otherwise as tall as the content.
  final bool tall;
  final List<Widget> children;
  final Widget? footer;

  @override
  State<WmSheetFrame> createState() => _WmSheetFrameState();
}

class _WmSheetFrameState extends State<WmSheetFrame> {
  double _dy = 0;
  bool _dragging = false;

  void _drag(DragUpdateDetails d) => setState(() {
        _dragging = true;
        _dy = (_dy + d.delta.dy).clamp(0, double.infinity).toDouble();
      });

  void _release(DragEndDetails d) {
    if (_dy > wmSheetCloseDrag || (d.primaryVelocity ?? 0) > _closeVelocity) {
      Navigator.of(context).maybePop();
      return;
    }
    setState(() {
      _dragging = false;
      _dy = 0;
    });
  }

  void _close() => Navigator.of(context).maybePop();

  @override
  Widget build(BuildContext context) {
    final subtitle = widget.subtitle;
    final footer = widget.footer;
    final safeBottom = MediaQuery.paddingOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: AnimatedContainer(
        duration: _dragging ? Duration.zero : const Duration(milliseconds: 250),
        curve: Curves.easeOut,
        transform: Matrix4.translationValues(0, _dy, 0),
        clipBehavior: Clip.antiAlias,
        decoration: const BoxDecoration(
          color: WmColors.canvas,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          boxShadow: [BoxShadow(color: Color(0x24000000), blurRadius: 30, offset: Offset(0, -8))],
        ),
        child: Column(
          mainAxisSize: widget.tall ? MainAxisSize.max : MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            GestureDetector(
              key: const Key('wm-sheet-handle'),
              behavior: HitTestBehavior.opaque,
              onVerticalDragUpdate: _drag,
              onVerticalDragEnd: _release,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 8),
                child: Column(children: [
                  Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(color: WmColors.textFaint, borderRadius: BorderRadius.circular(2)),
                  ),
                  const SizedBox(height: 12),
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    if (widget.onBack case final back?) ...[
                      _RoundButton(key: const Key('wm-sheet-back'), icon: Icons.arrow_back, label: 'Back', onTap: back),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(widget.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, height: 1.2)),
                          if (subtitle != null) ...[
                            const SizedBox(height: 2),
                            Text(subtitle, style: const TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
                          ],
                        ]),
                      ),
                    ),
                    const SizedBox(width: 10),
                    _RoundButton(key: const Key('wm-sheet-close'), icon: Icons.close, label: 'Close', onTap: _close),
                  ]),
                ]),
              ),
            ),
            Flexible(
              fit: widget.tall ? FlexFit.tight : FlexFit.loose,
              child: ListView(
                shrinkWrap: !widget.tall,
                padding: EdgeInsets.fromLTRB(20, 6, 20, 20 + (footer == null ? safeBottom : 0)),
                children: widget.children,
              ),
            ),
            if (footer != null)
              Container(
                padding: EdgeInsets.fromLTRB(20, 12, 20, 16 + safeBottom),
                decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: WmColors.border))),
                child: footer,
              ),
          ],
        ),
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({super.key, required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: label,
        child: Material(
          color: WmColors.inert,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(width: 36, height: 36, child: Icon(icon, size: 20, color: WmColors.textSecondary)),
          ),
        ),
      );
}

/// A sheet's main button (min height 56, green; grey and inert with no action).
class WmSheetButton extends StatelessWidget {
  const WmSheetButton({super.key, required this.label, required this.icon, required this.onPressed, this.tagalog, this.busy = false});

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final String? tagalog;

  /// A spinner instead of the label, and no second tap.
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final tagalog = this.tagalog;
    return FilledButton(
      onPressed: busy ? null : onPressed,
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        backgroundColor: WmColors.green,
        foregroundColor: Colors.white,
        disabledBackgroundColor: busy ? WmColors.green : WmColors.textDisabled,
        disabledForegroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      child: busy
          ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
          : Column(mainAxisSize: MainAxisSize.min, children: [
              Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(icon, size: 22),
                const SizedBox(width: 8),
                Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: 0.3)),
              ]),
              if (tagalog != null)
                Text(tagalog, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xBFFFFFFF))),
            ]),
    );
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/ui/wm_nav_bar_test.dart test/ui/wm_sheet_test.dart`
Expected: all pass. If `sheetAnimationStyle` or `AnimationStyle` is reported missing, run `flutter --version` and report it — do not drop the parameter silently.
If any test reports a `RenderFlex overflowed` error pointing at the bar, raise `height: 68` to `72` in the theme and say so in the checkpoint.

- [ ] **Step 5: Run the whole suite once (the theme changes every screen)**

Run: `flutter test`
Expected: all pass. A failure here is a snack bar or bar style that a test pinned. Fix the test only if it pinned the
old look, not the behaviour, and say which.

- [ ] **Step 6: Checkpoint (no commit)**

Report the 5 files.

---

### Task 4: Shared openers, Meeting notes and Change password as sheets

**Files:**
- Create: `lib/requests/list/request_openers.dart`
- Modify: `lib/requests/list/requests_screen.dart`
- Create: `lib/workplan/ui/task_openers.dart`
- Create: `lib/workplan/ui/notes_sheet.dart`
- Delete: `lib/workplan/ui/notes_screen.dart`
- Modify: `lib/workplan/ui/my_work_screen.dart`
- Modify: `lib/profile/change_password_sheet.dart`
- Modify: `lib/profile/profile_screen.dart` (only `_changePassword`)
- Create: `test/workplan/ui/notes_sheet_test.dart`

**Interfaces:**
- Consumes: `showWmSheet`, `WmSheetFrame`, `WmSheetButton` (Task 3).
- Produces:
  - `Future<void> composeRequest(BuildContext context, RequestsController controller, RequestsServices services, RequestDraft draft, {String? editLine})`
  - `Future<void> newRequest(BuildContext context, RequestsController controller, RequestsServices services)`
  - `Future<void> openRequestEntry(BuildContext context, RequestsController controller, RequestsServices services, RequestEntry e)`
  - `Future<void> openTask(BuildContext context, MyWorkController controller, WorkPlanServices services, String taskId, {VoidCallback? onMakeRequest})`
  - `Future<void> showNotesSheet(BuildContext context, MyWorkController controller)`; `class NotesSheet`

- [ ] **Step 1: Write the failing test**

Create `test/workplan/ui/notes_sheet_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/workplan/ui/my_work_controller.dart';
import 'package:workmate/workplan/ui/notes_sheet.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../workplan_fakes.dart';

void main() {
  testWidgets('Meeting notes open as a sheet and close with a swipe down', (tester) async {
    useTallPhone(tester);
    final c = MyWorkController(api: FakeWorkPlanApi());
    await c.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: Builder(builder: (context) => TextButton(onPressed: () => showNotesSheet(context, c), child: const Text('open'))),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Meeting notes'), findsOneWidget);
    expect(find.text('Skim coat first, then cabinets.'), findsOneWidget);
    await tester.timedDrag(find.byKey(const Key('wm-sheet-handle')), const Offset(0, 160), const Duration(milliseconds: 800));
    await tester.pumpAndSettle();
    expect(find.text('Skim coat first, then cabinets.'), findsNothing);
  });
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `flutter test test/workplan/ui/notes_sheet_test.dart`
Expected: compile error — `notes_sheet.dart` does not exist.

- [ ] **Step 3: Implement the openers**

Create `lib/requests/list/request_openers.dart`:

```dart
import 'package:flutter/material.dart';

import '../compose/compose_screen.dart';
import '../data/requests_api.dart';
import '../detail/request_detail_screen.dart';
import '../domain/request_draft.dart';
import '../domain/request_status.dart';
import '../requests_services.dart';
import 'requests_controller.dart';

// The Requests tab and Home both open requests through these, so a row on
// Home opens a request exactly as the tab does (redesign spec §9).

/// [draft] in New request / Draft request, then the list is read again.
Future<void> composeRequest(
  BuildContext context,
  RequestsController controller,
  RequestsServices services,
  RequestDraft draft, {
  String? editLine,
}) async {
  await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => ComposeScreen(draft: draft, services: services, editLineOnOpen: editLine)));
  await controller.refresh();
}

/// The draft is stored on its first change (ComposeController saves every
/// change), so backing straight out leaves nothing behind.
Future<void> newRequest(BuildContext context, RequestsController controller, RequestsServices services) =>
    composeRequest(context, controller, services, services.api.newDraft());

/// A draft opens for editing; anything else opens its details.
Future<void> openRequestEntry(BuildContext context, RequestsController controller, RequestsServices services, RequestEntry e) async {
  if (e.state == SyncState.draft) return composeRequest(context, controller, services, e.draft!);
  await Navigator.of(context).push(MaterialPageRoute(
    builder: (detailContext) => RequestDetailScreen(
      controller: controller,
      api: services.api,
      entryKey: e.key,
      onEditDraft: (draftId) async {
        final back = await controller.returnToDrafts(draftId);
        // Only a draft that is editable again: a queued one ignores every save.
        final again = controller.entry(draftId);
        final draft = again?.draft;
        if (!back || again?.state != SyncState.draft || draft == null || !detailContext.mounted || !context.mounted) return;
        Navigator.of(detailContext).pop();
        await composeRequest(context, controller, services, draft);
      },
    ),
  ));
  await controller.refresh();
}
```

In `lib/requests/list/requests_screen.dart`:
- delete the methods `_compose`, `_newRequest` and `_open` (lines 29–33, 63–86 of 0.11.1);
- in `_findPrevious`, replace `if (context.mounted) await _compose(context, draft, editLine: line.id);` with
  `if (context.mounted) await composeRequest(context, controller, services, draft, editLine: line.id);`
- in `build`, replace `onPressed: () => _newRequest(context),` with `onPressed: () => newRequest(context, controller, services),`
- replace `_EntryCard(key: Key('entry-${e.key}'), entry: e, onTap: () => _open(context, e))` with
  `_EntryCard(key: Key('entry-${e.key}'), entry: e, onTap: () => openRequestEntry(context, controller, services, e))`
- add `import 'request_openers.dart';` and remove the imports `flutter analyze` then reports unused
  (`../compose/compose_screen.dart`, `../detail/request_detail_screen.dart`).

Create `lib/workplan/ui/task_openers.dart`:

```dart
import 'package:flutter/material.dart';

import '../workplan_services.dart';
import 'my_work_controller.dart';
import 'task_screen.dart';

/// Opens one task, then My Work is read again. The tab and Home's "Needs
/// you" rows both open tasks through this.
Future<void> openTask(
  BuildContext context,
  MyWorkController controller,
  WorkPlanServices services,
  String taskId, {
  VoidCallback? onMakeRequest,
}) async {
  await Navigator.of(context).push(MaterialPageRoute<void>(
    builder: (_) => TaskScreen(controller: controller, services: services, taskId: taskId, onMakeRequest: onMakeRequest),
  ));
  await controller.refresh();
}
```

- [ ] **Step 4: Implement the Meeting notes sheet**

Create `lib/workplan/ui/notes_sheet.dart`:

```dart
import 'dart:async';

import 'package:flutter/material.dart';

import '../../attendance/ui/formats.dart';
import '../../requests/domain/request_status.dart' show calendarDay;
import '../../ui/theme.dart';
import '../../ui/wm_sheet.dart';
import 'my_work_controller.dart';
import 'workplan_widgets.dart';

/// Shared meeting notes (spec §6) as a swipe-down sheet (redesign Phase 1):
/// the latest published version of each meeting this worker was chosen to
/// receive. Read-only; reading another team's plan gives no access to their
/// tasks. Opening it asks for a fresh copy (the sheet has no pull-down).
Future<void> showNotesSheet(BuildContext context, MyWorkController controller) {
  unawaited(controller.refresh());
  return showWmSheet<void>(context, builder: (_) => NotesSheet(controller: controller));
}

class NotesSheet extends StatelessWidget {
  const NotesSheet({super.key, required this.controller});

  final MyWorkController controller;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final notes = controller.view.notes;
          return WmSheetFrame(title: 'Meeting notes', children: [
            if (notes.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No meeting notes for you yet.', textAlign: TextAlign.center, style: TextStyle(color: WmColors.textMuted)),
              ),
            for (final n in notes)
              WpBox(key: Key('note-${n.meetingId}'), children: [
                Text(n.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                Text(
                  'Meeting ${calendarDay(n.heldOn)} · version ${n.version} · sent ${dayMonth(n.publishedAt)}, ${clockTime(n.publishedAt)}',
                  style: const TextStyle(color: WmColors.textMuted, fontSize: 13),
                ),
                if (n.changeNote.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text('What changed: ${n.changeNote}', style: const TextStyle(color: WmColors.brown, fontWeight: FontWeight.w700)),
                ],
                const SizedBox(height: 8),
                Text(n.sharedNotes.isEmpty ? 'No notes in this version.' : n.sharedNotes, style: const TextStyle(fontSize: 15, height: 1.35)),
              ]),
          ]);
        },
      );
}
```

Delete `lib/workplan/ui/notes_screen.dart`.

In `lib/workplan/ui/my_work_screen.dart`:
- replace the body of `_open` with a call to the opener:

```dart
  Future<void> _open(BuildContext context, String taskId) =>
      openTask(context, controller, services, taskId, onMakeRequest: onMakeRequest);
```

- replace `onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => NotesScreen(controller: c))),`
  with `onPressed: () => showNotesSheet(context, c),`
- replace `import 'notes_screen.dart';` with `import 'notes_sheet.dart';`, add `import 'task_openers.dart';`, remove
  `import 'task_screen.dart';` if `flutter analyze` reports it unused.

- [ ] **Step 5: Change password in the sheet**

Replace the `build` method of `_ChangePasswordSheetState` in `lib/profile/change_password_sheet.dart` with:

```dart
  @override
  Widget build(BuildContext context) {
    final failure = _failure;
    return WmSheetFrame(
      title: 'Change password',
      footer: WmSheetButton(label: 'SAVE PASSWORD', icon: Icons.lock_outline, busy: _busy, onPressed: _save),
      children: [
        const Text('Any 8 letters or numbers. Do not share it with anyone.', style: TextStyle(fontSize: 14, color: WmColors.textMuted)),
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
      ],
    );
  }
```

and add `import '../ui/wm_sheet.dart';`. `_save`, the fields and the pop-with-`true` stay as they are.

In `lib/profile/profile_screen.dart`, replace `_changePassword` with:

```dart
  Future<void> _changePassword() async {
    final changed = await showWmSheet<bool>(context, builder: (_) => ChangePasswordSheet(onSave: widget.account.changePassword));
    if (changed == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Your password has been changed.')));
    }
  }
```

and add `import '../ui/wm_sheet.dart';`.

- [ ] **Step 6: Run the tests**

Run: `flutter test test/workplan test/requests test/profile test/ui/home_tools_password_test.dart`
Expected: all pass — including the existing `my_work_screens_test` (notes open from `open-notes`),
`profile_screen_test` (`SAVE PASSWORD`, errors, "Your password has been changed.") and every Requests screen test
(they now go through the openers).

- [ ] **Step 7: Checkpoint (no commit)**

Report the 9 files (one deleted).

---

### Task 5: Home widgets — Needs you card, delivery line, shortcuts, sync badge

**Files:**
- Create: `lib/home/needs_you_card.dart`
- Create: `lib/home/shortcut_row.dart`
- Create: `lib/home/sync_badge.dart`
- Create: `test/home/home_widgets_test.dart`

**Interfaces:**
- Consumes: `NeedsYou`, `NeedsRow`, `NeedsKind` (Task 2), `SyncSummary`, `syncSummary` (Task 2).
- Produces: `NeedsYouCard({required NeedsYou needs, required void Function(NeedsRow row) onOpen})`, `const needsYouShown = 5`,
  `NextDeliveryLine({required String iso})`, `ShortcutTile({required String id, required IconData icon, required String label, required VoidCallback onTap})`,
  `ShortcutRow({required List<ShortcutTile?> tiles})`, `SyncBadge({required SyncSummary summary})`.

- [ ] **Step 1: Write the failing tests**

Create `test/home/home_widgets_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/home/needs_you.dart';
import 'package:workmate/home/needs_you_card.dart';
import 'package:workmate/home/shortcut_row.dart';
import 'package:workmate/home/sync_badge.dart';
import 'package:workmate/home/sync_summary.dart';
import 'package:workmate/ui/theme.dart';

import '../attendance/fakes.dart' show useTallPhone;

Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: Scaffold(body: ListView(padding: const EdgeInsets.all(20), children: [w])));

/// Animations off, as the phone's "remove animations" setting does: a
/// waiting badge's blinking dot then never holds pumpAndSettle open.
Widget still(Widget w) => MaterialApp(
      theme: workMateTheme(),
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(disableAnimations: true), child: child!),
      home: Scaffold(body: Center(child: w)),
    );

NeedsRow task(int i) => NeedsRow(kind: NeedsKind.read, title: 'Task $i', line: 'New task · read it first', action: 'Read', target: 't$i');

void main() {
  testWidgets('each row has its own button, and a tap opens that row', (tester) async {
    useTallPhone(tester);
    final opened = <String>[];
    await tester.pumpWidget(wrap(NeedsYouCard(
      needs: NeedsYou(allRead: true, rows: [
        task(1),
        const NeedsRow(kind: NeedsKind.finishDraft, title: 'Draft · Site', line: '2 items · not sent yet', action: 'Finish', target: 'd1'),
      ]),
      onOpen: (r) => opened.add(r.id),
    )));
    expect(find.text('NEEDS YOU'), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('needs-count')), matching: find.text('2')), findsOneWidget);
    expect(find.text('Read'), findsOneWidget);
    expect(find.text('Finish'), findsOneWidget);
    await tester.tap(find.byKey(const Key('needs-finishDraft-d1')));
    expect(opened, ['finishDraft-d1']);
  });

  testWidgets('six rows: five, then "Show 1 more", then "Show fewer"; the count is always six', (tester) async {
    useTallPhone(tester);
    await tester.pumpWidget(wrap(NeedsYouCard(needs: NeedsYou(allRead: true, rows: [for (var i = 1; i <= 6; i++) task(i)]), onOpen: (_) {})));
    expect(find.text('Task 5'), findsOneWidget);
    expect(find.text('Task 6'), findsNothing);
    expect(find.descendant(of: find.byKey(const Key('needs-count')), matching: find.text('6')), findsOneWidget);
    await tester.tap(find.text('Show 1 more'));
    await tester.pump();
    expect(find.text('Task 6'), findsOneWidget);
    await tester.tap(find.text('Show fewer'));
    await tester.pump();
    expect(find.text('Task 6'), findsNothing);
  });

  testWidgets('opening a row folds the list back to five', (tester) async {
    useTallPhone(tester);
    await tester.pumpWidget(wrap(NeedsYouCard(needs: NeedsYou(allRead: true, rows: [for (var i = 1; i <= 6; i++) task(i)]), onOpen: (_) {})));
    await tester.tap(find.text('Show 1 more'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('needs-read-t6')));
    await tester.pump();
    expect(find.text('Task 6'), findsNothing);
  });

  testWidgets('nothing to do and every source read: all caught up, and no count', (tester) async {
    await tester.pumpWidget(wrap(NeedsYouCard(needs: const NeedsYou(allRead: true, rows: []), onOpen: (_) {})));
    expect(find.text('You are all caught up'), findsOneWidget);
    expect(find.text('Nothing needs you right now.'), findsOneWidget);
    expect(find.byKey(const Key('needs-count')), findsNothing);
  });

  testWidgets('nothing known yet: the whole block is off Home', (tester) async {
    await tester.pumpWidget(wrap(NeedsYouCard(needs: const NeedsYou(allRead: false, rows: []), onOpen: (_) {})));
    expect(find.text('NEEDS YOU'), findsNothing);
    expect(find.text('You are all caught up'), findsNothing);
  });

  testWidgets('the next delivery line (moved from the old Requests card)', (tester) async {
    await tester.pumpWidget(wrap(const NextDeliveryLine(iso: '2026-10-14')));
    expect(find.text('Next delivery Wed 14 Oct'), findsOneWidget);
  });

  testWidgets('shortcuts: an empty column stays empty, a tap opens, no tile at all shows nothing', (tester) async {
    useTallPhone(tester);
    var taps = 0;
    await tester.pumpWidget(wrap(ShortcutRow(tiles: [
      null,
      ShortcutTile(id: 'notes', icon: Icons.forum_outlined, label: 'Meeting notes', onTap: () => taps++),
      null,
      null,
    ])));
    final row = tester.getRect(find.byType(ShortcutRow));
    expect(tester.getCenter(find.byKey(const Key('shortcut-notes'))).dx, greaterThan(row.left + row.width / 4),
        reason: 'it stays in the second column');
    await tester.tap(find.byKey(const Key('shortcut-notes')));
    expect(taps, 1);
    await tester.pumpWidget(wrap(const ShortcutRow(tiles: [null, null, null, null])));
    expect(find.byType(InkWell), findsNothing);
  });

  testWidgets('the sync badge: All sent, N not sent yet, or nothing at all', (tester) async {
    await tester.pumpWidget(still(SyncBadge(summary: syncSummary([0, 0, 0, 0]))));
    expect(find.text('All sent'), findsOneWidget);
    await tester.pumpWidget(still(SyncBadge(summary: syncSummary([1, 0, 0, 0]))));
    await tester.pumpAndSettle();
    expect(find.text('1 not sent yet'), findsOneWidget);
    await tester.pumpWidget(still(SyncBadge(summary: syncSummary([0, null, 0, 0]))));
    expect(find.text('All sent'), findsNothing);
    expect(find.textContaining('not sent yet'), findsNothing);
  });

  testWidgets('the waiting dot blinks when animations are allowed', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: SyncBadge(summary: syncSummary([2, 0, 0, 0]))))));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    final fade = tester.widget<FadeTransition>(
        find.descendant(of: find.byKey(const Key('sync-not-sent')), matching: find.byType(FadeTransition)));
    expect(fade.opacity.value, lessThan(1));
  });
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/home/home_widgets_test.dart`
Expected: compile errors — the three widget files do not exist.

- [ ] **Step 3: Implement**

Create `lib/home/needs_you_card.dart`:

```dart
import 'package:flutter/material.dart';

import '../requests/domain/request_status.dart' show calendarDay;
import '../ui/theme.dart';
import 'needs_you.dart';

/// Rows shown before "Show N more" (owner decision, 11 Nov 2026).
const needsYouShown = 5;

/// Home's "Needs you" (redesign spec §5): one row per thing to do, each with
/// its own button. Off Home while nothing is known; "all caught up" only
/// once every source was read.
class NeedsYouCard extends StatefulWidget {
  const NeedsYouCard({super.key, required this.needs, required this.onOpen});

  final NeedsYou needs;
  final void Function(NeedsRow row) onOpen;

  @override
  State<NeedsYouCard> createState() => _NeedsYouCardState();
}

class _NeedsYouCardState extends State<NeedsYouCard> {
  bool _all = false;

  void _open(NeedsRow row) {
    setState(() => _all = false);
    widget.onOpen(row);
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.needs;
    if (n.hidden) return const SizedBox.shrink();
    final rows = n.rows;
    final more = rows.length > needsYouShown;
    final shown = _all || !more ? rows : rows.take(needsYouShown).toList();
    final items = <Widget>[
      if (n.caughtUp) const _CaughtUp(),
      for (final r in shown) _NeedsRowView(key: Key('needs-${r.id}'), row: r, onTap: () => _open(r)),
      if (more)
        _MoreRow(
          key: const Key('needs-more'),
          label: _all ? 'Show fewer' : 'Show ${rows.length - needsYouShown} more',
          open: _all,
          onTap: () => setState(() => _all = !_all),
        ),
    ];
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Text('NEEDS YOU', style: monoLabel),
          if (rows.isNotEmpty) ...[const SizedBox(width: 8), _Count(rows.length)],
        ]),
        const SizedBox(height: 9),
        Material(
          color: Colors.white,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: const BorderSide(color: WmColors.border)),
          child: Column(children: [
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) const Divider(height: 1, thickness: 1, color: WmColors.hairline),
              items[i],
            ],
          ]),
        ),
      ]),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count(this.n);
  final int n;

  @override
  Widget build(BuildContext context) => Container(
        key: const Key('needs-count'),
        constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
        padding: const EdgeInsets.symmetric(horizontal: 6),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: WmColors.danger, borderRadius: BorderRadius.circular(10)),
        child: Text('$n', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w800, height: 1)),
      );
}

class _NeedsRowView extends StatelessWidget {
  const _NeedsRowView({super.key, required this.row, required this.onTap});

  final NeedsRow row;
  final VoidCallback onTap;

  static IconData _icon(NeedsKind k) => switch (k) {
        NeedsKind.read => Icons.fiber_new_outlined,
        NeedsKind.check => Icons.fact_check_outlined,
        NeedsKind.finishDraft => Icons.edit_note,
        NeedsKind.notAccepted || NeedsKind.fixRequest || NeedsKind.toolUnresolved || NeedsKind.toolRecords => Icons.report_outlined,
      };

  @override
  Widget build(BuildContext context) {
    final fg = row.quiet ? WmColors.textSecondary : WmColors.danger;
    final tint = row.quiet ? WmColors.inert : WmColors.dangerTint;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
        child: Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: tint, shape: BoxShape.circle),
            child: Icon(_icon(row.kind), size: 20, color: fg),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(row.title,
                  maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, height: 1.25)),
              const SizedBox(height: 2),
              Text(row.line, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: fg)),
            ]),
          ),
          const SizedBox(width: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(color: WmColors.green, borderRadius: BorderRadius.circular(999)),
            child: Text(row.action, style: const TextStyle(color: Colors.white, fontSize: 13.5, fontWeight: FontWeight.w800)),
          ),
        ]),
      ),
    );
  }
}

class _CaughtUp extends StatelessWidget {
  const _CaughtUp();

  @override
  Widget build(BuildContext context) => Padding(
        key: const Key('needs-caught-up'),
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: const BoxDecoration(color: WmColors.greenTint, shape: BoxShape.circle),
            child: const Icon(Icons.done_all, size: 20, color: WmColors.green),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('You are all caught up', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              Text('Nothing needs you right now.', style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
            ]),
          ),
        ]),
      );
}

class _MoreRow extends StatelessWidget {
  const _MoreRow({super.key, required this.label, required this.open, required this.onTap});

  final String label;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: WmColors.green))),
            Icon(open ? Icons.expand_less : Icons.expand_more, color: WmColors.green),
          ]),
        ),
      );
}

/// The quiet line under "Needs you" (owner decision: kept on Home).
class NextDeliveryLine extends StatelessWidget {
  const NextDeliveryLine({super.key, required this.iso});

  /// "2026-10-14".
  final String iso;

  @override
  Widget build(BuildContext context) => Padding(
        key: const Key('next-delivery'),
        padding: const EdgeInsets.only(top: 10),
        child: Row(children: [
          const Icon(Icons.local_shipping_outlined, size: 18, color: WmColors.green),
          const SizedBox(width: 8),
          Expanded(
            child: Text('Next delivery ${calendarDay(iso)}',
                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: WmColors.green)),
          ),
        ]),
      );
}
```

Create `lib/home/shortcut_row.dart`:

```dart
import 'package:flutter/material.dart';

import '../ui/theme.dart';

/// One Home shortcut (redesign spec §4.7). English only: the Tagalog title
/// stays inside the screen or sheet it opens.
class ShortcutTile {
  const ShortcutTile({required this.id, required this.icon, required this.label, required this.onTap});

  /// The tile's key is 'shortcut-$id'.
  final String id;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
}

/// Four equal columns. A null tile leaves its column empty so no tile ever
/// moves; no tile at all shows nothing.
class ShortcutRow extends StatelessWidget {
  const ShortcutRow({super.key, required this.tiles});

  final List<ShortcutTile?> tiles;

  @override
  Widget build(BuildContext context) {
    if (tiles.every((t) => t == null)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var i = 0; i < tiles.length; i++) ...[
          if (i > 0) const SizedBox(width: 4),
          Expanded(
            child: switch (tiles[i]) {
              final t? => _Tile(tile: t),
              null => const SizedBox.shrink(),
            },
          ),
        ],
      ]),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.tile});

  final ShortcutTile tile;

  @override
  Widget build(BuildContext context) => Material(
        type: MaterialType.transparency,
        child: InkWell(
          key: Key('shortcut-${tile.id}'),
          onTap: tile.onTap,
          borderRadius: BorderRadius.circular(14),
          highlightColor: WmColors.inert,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(children: [
              Icon(tile.icon, size: 24, color: WmColors.green),
              const SizedBox(height: 6),
              Text(tile.label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: WmColors.textSecondary, height: 1.2)),
            ]),
          ),
        ),
      );
}
```

Create `lib/home/sync_badge.dart`:

```dart
import 'package:flutter/material.dart';

import '../ui/theme.dart';
import 'sync_summary.dart';

/// The top of Home (redesign spec §6): "All sent", or "N not sent yet" with
/// a slowly blinking dot. Nothing until every source was read.
class SyncBadge extends StatelessWidget {
  const SyncBadge({super.key, required this.summary});

  final SyncSummary summary;

  @override
  Widget build(BuildContext context) {
    final s = summary;
    if (s.hidden) return const SizedBox.shrink();
    final sent = s.allSent;
    final fg = sent ? WmColors.green : WmColors.brown;
    final dot = Container(width: 7, height: 7, decoration: BoxDecoration(color: fg, shape: BoxShape.circle));
    return Container(
      key: Key(sent ? 'sync-all-sent' : 'sync-not-sent'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: sent ? WmColors.greenTint : WmColors.brownTint, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (sent) dot else _Blink(child: dot),
        const SizedBox(width: 6),
        Text(sent ? 'All sent' : '${s.waiting} not sent yet',
            maxLines: 1, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: fg)),
      ]),
    );
  }
}

/// 1 → 0.3 → 1 every 1.4 s. Still when the phone asks for no animations
/// (and in tests that set it), so a waiting badge never holds a test open.
class _Blink extends StatefulWidget {
  const _Blink({required this.child});

  final Widget child;

  @override
  State<_Blink> createState() => _BlinkState();
}

class _BlinkState extends State<_Blink> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));
  late final Animation<double> _opacity = TweenSequence<double>([
    TweenSequenceItem(tween: Tween<double>(begin: 1, end: 0.3), weight: 1),
    TweenSequenceItem(tween: Tween<double>(begin: 0.3, end: 1), weight: 1),
  ]).animate(CurvedAnimation(parent: _c, curve: Curves.easeInOut));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(opacity: _opacity, child: widget.child);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/home`
Expected: all pass.

- [ ] **Step 5: Checkpoint (no commit)**

Report the 4 files.

---

### Task 6: Profile — profile card, MINE and ACCOUNT sections, full-width Log out

**Files:**
- Modify: `lib/profile/profile_screen.dart`
- Modify: `test/profile/profile_screen_test.dart`

**Interfaces:**
- Consumes: `ToolsController` (`showCard`, `mine`, `openProblems`), `AgreementsController` (`showCard`, `agreements`).
- Produces: `ProfileScreen({…existing…, ToolsController? tools, VoidCallback? onOpenTools, AgreementsController? agreements, VoidCallback? onOpenAgreements})`; `String toolsLine(int tools, int problems)`.

- [ ] **Step 1: Write the failing tests**

In `test/profile/profile_screen_test.dart`:
- add imports:

```dart
import 'dart:convert';

import 'package:workmate/agreements/domain/my_agreement.dart';
import 'package:workmate/agreements/ui/agreements_controller.dart';
import 'package:workmate/tools/ui/tools_controller.dart';

import '../agreements/agreement_fakes.dart';
import '../tools/tool_fakes.dart';
```

- give `show` optional MINE arguments — replace it with:

```dart
  Future<void> show(WidgetTester tester,
      {ToolsController? tools, VoidCallback? onTools, AgreementsController? agreements, VoidCallback? onAgreements, bool buyer = false}) async {
    useTallPhone(tester);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: ProfileScreen(
          worker: juan,
          versionName: '0.3.0',
          onSignOut: () async {},
          buyer: buyer,
          tools: tools,
          onOpenTools: onTools,
          agreements: agreements,
          onOpenAgreements: onAgreements,
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
```

- append these tests inside `main()`:

```dart
  testWidgets('the profile card, the ACCOUNT section and a full-width Log out', (tester) async {
    await show(tester);
    expect(find.text('Profile'), findsOneWidget);
    expect(find.text('Mason · W-0042'), findsOneWidget);
    expect(find.text('ACCOUNT'), findsOneWidget);
    expect(find.text('MINE'), findsNothing, reason: 'nothing of theirs is on');
    final logout = tester.getSize(find.widgetWithText(OutlinedButton, 'Log out'));
    expect([logout.width, logout.height], [360.0, 52.0], reason: '400 wide phone, 20 each side');
  });

  test('the tools line', () {
    expect(toolsLine(0, 0), 'No tools with you');
    expect(toolsLine(1, 0), '1 tool with you');
    expect(toolsLine(2, 1), '2 tools with you · 1 problem reported');
    expect(toolsLine(3, 2), '3 tools with you · 2 problems reported');
  });

  testWidgets('MINE: My tools counts tools and problems, and opens Tools', (tester) async {
    final tools = ToolsController(remote: FakeToolsRemote(), userId: 'u7', isLeader: false);
    await tools.refresh();
    var opened = 0;
    await show(tester, tools: tools, onTools: () => opened++);
    expect(find.text('MINE'), findsOneWidget);
    expect(find.text('2 tools with you · 1 problem reported'), findsOneWidget);
    await tester.tap(find.byKey(const Key('profile-tools')));
    expect(opened, 1);
  });

  testWidgets('MINE: tools switched off — no row, and no MINE at all', (tester) async {
    final tools = ToolsController(remote: FakeToolsRemote()..failMine = refusal('TOOLS_OFF'), userId: 'u7', isLeader: false);
    await tools.refresh();
    await show(tester, tools: tools);
    expect(find.byKey(const Key('profile-tools')), findsNothing);
    expect(find.text('MINE'), findsNothing);
  });

  // Moved here from agreements_screens_test ("the Home card shows only after a read found agreements").
  testWidgets('MINE: My agreements shows only after a read found agreements — and never an amount', (tester) async {
    final remote = FakeAgreementsRemote();
    final a = AgreementsController(remote: remote, userId: 'w13', now: () => DateTime.utc(2026, 11, 8, 2, 30));
    await show(tester, agreements: a);
    expect(find.byKey(const Key('profile-agreements')), findsNothing);
    remote.answers.add([
      for (final x in (jsonDecode(myAgreementsJson)['agreements'] as List)) MyAgreement.fromJson(Map<String, dynamic>.from(x as Map)),
    ]);
    await a.refresh();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('profile-agreements')), findsOneWidget);
    expect(find.text('4 agreements'), findsOneWidget);
    expect(find.textContaining('₱'), findsNothing);
    remote.answers.add(noSignal);
    await a.refresh();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('profile-agreements')), findsNothing);
  });

  testWidgets('a buyer: no MINE and no Terms, even with tools wired in', (tester) async {
    final tools = ToolsController(remote: FakeToolsRemote(), userId: 'u7', isLeader: false);
    await tools.refresh();
    await show(tester, tools: tools, buyer: true);
    expect(find.text('MINE'), findsNothing);
    expect(find.byKey(const Key('profile-terms')), findsNothing);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/profile/profile_screen_test.dart`
Expected: compile errors — `tools`, `agreements`, `onOpenTools`, `onOpenAgreements`, `buyer` wiring and `toolsLine` do not exist yet.

- [ ] **Step 3: Implement**

Replace `lib/profile/profile_screen.dart` with:

```dart
import 'package:flutter/material.dart';

import '../agreements/ui/agreements_controller.dart';
import '../attendance/ui/formats.dart';
import '../attendance/ui/status_pill.dart';
import '../auth/worker_profile.dart';
import '../tools/ui/tools_controller.dart';
import '../ui/terms_screen.dart';
import '../ui/theme.dart';
import '../ui/wm_sheet.dart';
import 'account_services.dart';
import 'change_password_sheet.dart';

/// "2 tools with you · 1 problem reported" (redesign spec §7.2).
String toolsLine(int tools, int problems) {
  final base = tools == 0 ? 'No tools with you' : '$tools tool${tools == 1 ? '' : 's'} with you';
  return problems == 0 ? base : '$base · $problems problem${problems == 1 ? '' : 's'} reported';
}

/// Profile: who is signed in, what is theirs (My tools, My agreements), the
/// password, the Terms they accepted, Log out. A buyer (2A-3b) has no worker
/// ID, accepted no Attendance Terms (Q23) and has no MINE section.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    required this.worker,
    required this.versionName,
    required this.onSignOut,
    required this.account,
    this.buyer = false,
    this.tools,
    this.onOpenTools,
    this.agreements,
    this.onOpenAgreements,
  });

  final WorkerProfile worker;
  final String versionName;
  final Future<void> Function() onSignOut;
  final AccountServices account;
  final bool buyer;

  /// My tools (Stage 3b): its MINE row shows when tools are on for this worker.
  final ToolsController? tools;
  final VoidCallback? onOpenTools;

  /// Linked Labor (0113): its MINE row shows only after this session's read
  /// found an agreement. Never an amount.
  final AgreementsController? agreements;
  final VoidCallback? onOpenAgreements;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  DateTime? _acceptedAt;

  @override
  void initState() {
    super.initState();
    if (!widget.buyer) _loadAcceptedAt();
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
    final changed = await showWmSheet<bool>(context, builder: (_) => ChangePasswordSheet(onSave: widget.account.changePassword));
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
    final mine = <Listenable>[?widget.tools, ?widget.agreements];
    return ListView(padding: const EdgeInsets.fromLTRB(20, 16, 20, 28), children: [
      const Text('Profile', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 26)),
      const SizedBox(height: 14),
      _ProfileCard(worker: w, subtitle: widget.buyer ? 'Buyer' : w.positionAndId),
      if (!widget.buyer && mine.isNotEmpty) ListenableBuilder(listenable: Listenable.merge(mine), builder: (context, _) => _mineSection()),
      const SizedBox(height: 20),
      const Text('ACCOUNT', style: monoLabel),
      const SizedBox(height: 8),
      _Card(children: [
        _InfoRow(label: 'Email', value: w.email ?? '--'),
        if (widget.buyer) const _InfoRow(label: 'Role', value: 'Buyer'),
        if (!widget.buyer) _InfoRow(label: 'Position', value: position == null || position.isEmpty ? '--' : position),
        if (!widget.buyer) _InfoRow(label: 'Worker ID', value: w.workerIdLabel),
        _ActionRow(
          key: const Key('profile-change-password'),
          icon: Icons.lock_outline,
          title: 'Change password',
          subtitle: 'Update your login',
          onTap: _changePassword,
        ),
        if (!widget.buyer)
          _ActionRow(
            key: const Key('profile-terms'),
            icon: Icons.gavel,
            title: 'Terms & Conditions',
            subtitle: at == null ? 'Read the terms you accepted' : 'Accepted ${shortDate(at)}',
            onTap: _openTerms,
          ),
      ]),
      const SizedBox(height: 24),
      OutlinedButton.icon(
        onPressed: widget.onSignOut,
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          foregroundColor: WmColors.green,
          backgroundColor: Colors.white,
          side: const BorderSide(color: WmColors.border),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontFamily: 'Barlow', fontSize: 15, fontWeight: FontWeight.w800),
        ),
        icon: const Icon(Icons.logout, size: 20),
        label: const Text('Log out'),
      ),
      const SizedBox(height: 16),
      Text("DAC'S WorkMate ${widget.versionName} · By Dacs Building Design Services",
          style: const TextStyle(fontSize: 12.5, color: WmColors.textMeta)),
    ]);
  }

  Widget _mineSection() {
    final tools = widget.tools;
    final agreements = widget.agreements;
    final rows = <Widget>[
      if (tools != null && tools.showCard)
        _ActionRow(
          key: const Key('profile-tools'),
          icon: Icons.handyman_outlined,
          title: 'My tools',
          subtitle: toolsLine(tools.mine.length, tools.openProblems),
          onTap: widget.onOpenTools ?? () {},
        ),
      if (agreements != null && agreements.showCard)
        _ActionRow(
          key: const Key('profile-agreements'),
          icon: Icons.description_outlined,
          title: 'My agreements',
          subtitle: '${agreements.agreements.length} agreement${agreements.agreements.length == 1 ? '' : 's'}',
          onTap: widget.onOpenAgreements ?? () {},
        ),
    ];
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SizedBox(height: 20),
      const Text('MINE', style: monoLabel),
      const SizedBox(height: 8),
      _Card(children: rows),
    ]);
  }
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.worker, required this.subtitle});

  final WorkerProfile worker;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, border: Border.all(color: WmColors.border), borderRadius: BorderRadius.circular(20)),
        child: Row(children: [
          CircleAvatar(
            radius: 28,
            backgroundColor: WmColors.green,
            child: Text(worker.initials, style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(worker.displayName ?? worker.firstName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
              Text(subtitle, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
              const SizedBox(height: 6),
              const StatusPill.green('Active account'),
            ]),
          ),
        ]),
      );
}
```

Keep the existing `_Card`, `_InfoRow` and `_ActionRow` classes below it, unchanged.

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/profile test/purchasing/ui/buyer_screens_test.dart`
Expected: all pass (the buyer's Profile still shows Buyer, no worker ID, no Terms, Log out).

- [ ] **Step 5: Checkpoint (no commit)**

Report the 2 files.

---

### Task 7: Wire Home and both bottom bars; retire the four cards

**Files:**
- Modify: `lib/ui/worker_header.dart`
- Modify: `lib/attendance/home/home_screen.dart`
- Modify: `lib/ui/home_shell.dart`
- Modify: `lib/purchasing/ui/buyer_shell.dart`
- Delete: `lib/workplan/ui/my_work_card.dart`, `lib/requests/home/request_updates_card.dart`, `lib/tools/ui/tools_card.dart`, `lib/agreements/ui/agreements_card.dart`
- Modify: `test/ui/screens_test.dart`, `test/ui/home_tools_password_test.dart`, `test/ui/home_agreements_test.dart`, `test/agreements/agreements_screens_test.dart`, `test/requests/list/requests_controller_test.dart`
- Create: `test/ui/home_inbox_test.dart`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `WorkerHeader({…, Widget? trailing})`; `HomeScreen({…, Widget? inbox, Widget? headerTrailing, Future<void> Function()? onRefresh})` (the old `requestUpdates` parameter is gone).

- [ ] **Step 1: Write the failing acceptance tests**

Create `test/ui/home_inbox_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/attendance/attendance_services.dart';
import 'package:workmate/attendance/sync/queue_settled.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/profile/account_services.dart';
import 'package:workmate/requests/compose/compose_screen.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/detail/request_detail_screen.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/requests/requests_services.dart';
import 'package:workmate/ui/home_shell.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/workplan/data/workplan_api.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';
import 'package:workmate/workplan/ui/proposals_screen.dart';
import 'package:workmate/workplan/ui/task_screen.dart';
import 'package:workmate/workplan/workplan_services.dart';

import '../attendance/fakes.dart';
import '../requests/domain/request_models_test.dart' show requestDoc;
import '../requests/request_fakes.dart';
import '../workplan/workplan_fakes.dart';

/// Animations off (the phone's "remove animations" setting): a waiting
/// badge's blinking dot then never holds pumpAndSettle open.
Widget still(Widget w) => MaterialApp(
      theme: workMateTheme(),
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(disableAnimations: true), child: child!),
      home: w,
    );

const juan = WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42, role: 'worker');
const ramon = WorkerProfile(id: 'u5', displayName: 'Ramon Santos', position: 'Mason', workerNo: 5, role: 'teamLeader');

FakeRequestsApi requestsWith({List<RequestEntry> entries = const [], List<RequestDraft> drafts = const []}) {
  final api = FakeRequestsApi()..view = RequestsView(entries: entries);
  for (final d in drafts) {
    api.savedDrafts[d.id] = d;
  }
  return api;
}

RequestEntry toFix() => RequestEntry(state: SyncState.needsResolution, remote: RemoteRequest.fromJson(requestDoc()));
RequestDraft aDraft() => RequestDraft(id: 'd1', createdAt: DateTime.utc(2026, 11, 11), destination: site, lines: [DraftLine.fromCatalog('l1', pipe)]);

void main() {
  late FakeAttendance attendance;
  late QueueSettled settled;

  setUp(() {
    attendance = FakeAttendance();
    settled = QueueSettled();
  });

  Future<void> showShell(WidgetTester tester, {WorkerProfile who = juan, FakeWorkPlanApi? work, FakeRequestsApi? requests}) async {
    useTallPhone(tester);
    await tester.pumpWidget(still(HomeShell(
      worker: who,
      versionName: '0.12.0',
      onSignOut: () async {},
      services: AttendanceServices(
        attendance: attendance,
        device: FakeDevice(),
        scheduler: FakeScheduler(),
        trustedNow: () async => null,
        photoUrl: (_) async => null,
        openSettings: (_) async {},
        cameraStep: (context, args) => const Text('camera'),
        queueSettled: settled,
      ),
      account: AccountServices(changePassword: (_) async {}, termsAcceptedAt: () async => null),
      workPlan: work == null ? null : WorkPlanServices(api: work, takePhoto: (_) async => null),
      requests: requests == null ? null : RequestsServices(api: requests, takePhoto: (_) async => null),
    )));
    await tester.pumpAndSettle();
  }

  Future<void> showThree(WidgetTester tester) => showShell(tester,
      work: FakeWorkPlanApi()..view = viewWithUnread(), requests: requestsWith(entries: [toFix()], drafts: [aDraft()]));

  testWidgets('a new task, a request to fix and a draft: three rows, each with its own button, and red numbers', (tester) async {
    await showThree(tester);
    expect(find.descendant(of: find.byKey(const Key('needs-count')), matching: find.text('3')), findsOneWidget);
    expect(find.byKey(const Key('needs-read-t1')), findsOneWidget);
    expect(find.byKey(const Key('needs-fixRequest-r1')), findsOneWidget);
    expect(find.byKey(const Key('needs-finishDraft-d1')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('my-work-badge')), matching: find.text('1')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('requests-badge')), matching: find.text('1')), findsOneWidget);
  });

  testWidgets('Read opens that task', (tester) async {
    await showThree(tester);
    await tester.tap(find.byKey(const Key('needs-read-t1')));
    await tester.pumpAndSettle();
    expect(find.byType(TaskScreen), findsOneWidget);
  });

  testWidgets('Fix opens that request', (tester) async {
    await showThree(tester);
    await tester.tap(find.byKey(const Key('needs-fixRequest-r1')));
    await tester.pumpAndSettle();
    expect(find.byType(RequestDetailScreen), findsOneWidget);
  });

  testWidgets('Finish opens the draft', (tester) async {
    await showThree(tester);
    await tester.tap(find.byKey(const Key('needs-finishDraft-d1')));
    await tester.pumpAndSettle();
    expect(find.byType(ComposeScreen), findsOneWidget);
  });

  testWidgets('a worker: New request is a shortcut, and opens a new request', (tester) async {
    await showShell(tester, work: FakeWorkPlanApi(), requests: requestsWith());
    expect(find.byKey(const Key('shortcut-proposals')), findsNothing);
    await tester.tap(find.byKey(const Key('shortcut-new-request')));
    await tester.pumpAndSettle();
    expect(find.byType(ComposeScreen), findsOneWidget);
  });

  testWidgets('a team leader: a Check row, and My proposals instead of New request', (tester) async {
    final work = FakeWorkPlanApi()
      ..view = WorkPlanView(entries: [WpEntry(task: task0(taskDoc(id: 't3', title: 'Tiles', status: 'reported_done', canCheck: true, ackVersion: 1)))]);
    await showShell(tester, who: ramon, work: work, requests: requestsWith());
    expect(find.byKey(const Key('needs-check-t3')), findsOneWidget);
    expect(find.byKey(const Key('shortcut-new-request')), findsNothing);
    await tester.tap(find.byKey(const Key('shortcut-proposals')));
    await tester.pumpAndSettle();
    expect(find.byType(ProposalsScreen), findsOneWidget);
  });

  testWidgets('a Time In still on the phone: "1 not sent yet", never "All sent"', (tester) async {
    attendance.waiting = 1;
    await showShell(tester, work: FakeWorkPlanApi(), requests: requestsWith());
    expect(find.text('1 not sent yet'), findsOneWidget);
    expect(find.text('All sent'), findsNothing);
    attendance.waiting = 0;
    settled.fire();
    await tester.pumpAndSettle();
    expect(find.text('All sent'), findsOneWidget);
  });

  testWidgets('nothing waiting and every source read: All sent, and all caught up', (tester) async {
    await showShell(tester, work: FakeWorkPlanApi(), requests: requestsWith());
    expect(find.text('All sent'), findsOneWidget);
    expect(find.text('You are all caught up'), findsOneWidget);
  });

  testWidgets('no signal and no saved copy for My Work: never caught up, no badge — and Time In works', (tester) async {
    await showShell(tester, work: FakeWorkPlanApi()..view = WorkPlanView(error: Exception('no signal')), requests: requestsWith());
    expect(find.text('You are all caught up'), findsNothing);
    expect(find.text('NEEDS YOU'), findsNothing);
    expect(find.text('All sent'), findsNothing);
    expect(find.byKey(const Key('hero-time-in')), findsOneWidget);
  });

  testWidgets('Meeting notes open from Home as a sheet', (tester) async {
    await showShell(tester, work: FakeWorkPlanApi(), requests: requestsWith());
    await tester.tap(find.byKey(const Key('shortcut-notes')));
    await tester.pumpAndSettle();
    expect(find.text('Skim coat first, then cabinets.'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Skim coat first, then cabinets.'), findsNothing);
  });

  testWidgets('attendance, This week and the bar are where they were', (tester) async {
    await showThree(tester);
    expect(find.byKey(const Key('hero-time-in')), findsOneWidget);
    expect(find.text('THIS WEEK'), findsOneWidget);
    expect(find.byKey(const Key('wm-nav-bar')), findsOneWidget);
    for (final tab in ['Home', 'My Work', 'Requests', 'History', 'Profile']) {
      expect(find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)), findsOneWidget);
    }
  });
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/ui/home_inbox_test.dart`
Expected: FAIL — no `needs-…` keys, `requests-badge` or `wm-nav-bar` on Home yet.

- [ ] **Step 3: Header slot and Home layout**

`lib/ui/worker_header.dart` — add a `trailing` slot:

```dart
class WorkerHeader extends StatelessWidget {
  const WorkerHeader({super.key, required this.worker, this.subtitle, this.trailing});
  final WorkerProfile worker;
  final String? subtitle;

  /// At the right end of the row (Home's sync badge).
  final Widget? trailing;

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
            Text(subtitle ?? worker.positionAndId, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
          ]),
        ),
        if (trailing case final t?) ...[const SizedBox(width: 8), t],
      ]);
}
```

`lib/attendance/home/home_screen.dart`:
- in the constructor replace `this.requestUpdates,` with `this.inbox, this.headerTrailing, this.onRefresh,`
- replace the `requestUpdates` field and its comment with:

```dart
  /// Home's "Needs you", next delivery and shortcuts (lib/home); null when
  /// the app has none of their modules.
  final Widget? inbox;

  /// The sync badge, at the right of the header.
  final Widget? headerTrailing;

  /// Pull-to-refresh; null re-reads today's attendance only.
  final Future<void> Function()? onRefresh;
```

- in `build`: `onRefresh: c.refresh,` → `onRefresh: widget.onRefresh ?? c.refresh,`;
  `WorkerHeader(worker: widget.worker),` → `WorkerHeader(worker: widget.worker, trailing: widget.headerTrailing),`;
  `?widget.requestUpdates,` → `?widget.inbox,`

- [ ] **Step 4: Wire the shell**

`lib/ui/home_shell.dart`:
- remove the imports `../agreements/ui/agreements_card.dart`, `../requests/home/request_updates_card.dart`,
  `../tools/ui/tools_card.dart`, `../workplan/ui/my_work_card.dart`; add:

```dart
import '../home/needs_you.dart';
import '../home/needs_you_card.dart';
import '../home/shortcut_row.dart';
import '../home/sync_badge.dart';
import '../home/sync_summary.dart';
import '../requests/list/request_openers.dart';
import '../workplan/ui/notes_sheet.dart';
import '../workplan/ui/proposals_screen.dart';
import '../workplan/ui/task_openers.dart';
import 'wm_nav_bar.dart';
```

- add these members after `_openTools()`:

```dart
  bool get _isLeader => widget.worker.role == 'teamLeader';

  void _openProposals(MyWorkController work) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ProposalsScreen(controller: work)));

  /// A "Needs you" row's button: opens exactly what the tab would.
  Future<void> _openNeed(NeedsRow row) async {
    switch (row.kind) {
      case NeedsKind.read || NeedsKind.check:
        final work = _work;
        final services = widget.workPlan;
        if (work == null || services == null) return;
        await openTask(context, work, services, row.target!, onMakeRequest: _requests == null ? null : _openRequests);
      case NeedsKind.notAccepted:
        _selectTab(_Tab.work);
      case NeedsKind.fixRequest || NeedsKind.finishDraft:
        final requests = _requests;
        final services = widget.requests;
        final entry = requests?.entry(row.target!);
        if (requests == null || services == null || entry == null) return;
        await openRequestEntry(context, requests, services, entry);
      case NeedsKind.toolUnresolved || NeedsKind.toolRecords:
        _openTools();
    }
  }

  /// Home's four shortcut columns (spec §4.7); null leaves a column empty.
  List<ShortcutTile?> _shortcuts() {
    final work = _work;
    final requests = _requests;
    final requestServices = widget.requests;
    final tools = _tools;
    final agreements = _agreements;
    return [
      tools != null && tools.showCard ? ShortcutTile(id: 'tools', icon: Icons.handyman_outlined, label: 'My tools', onTap: _openTools) : null,
      agreements != null && agreements.showCard
          ? ShortcutTile(id: 'agreements', icon: Icons.description_outlined, label: 'My agreements', onTap: _openAgreements)
          : null,
      work != null ? ShortcutTile(id: 'notes', icon: Icons.forum_outlined, label: 'Meeting notes', onTap: () => showNotesSheet(context, work)) : null,
      if (_isLeader)
        work != null ? ShortcutTile(id: 'proposals', icon: Icons.lightbulb_outline, label: 'My proposals', onTap: () => _openProposals(work)) : null
      else
        requests != null && requestServices != null
            ? ShortcutTile(id: 'new-request', icon: Icons.add, label: 'New request', onTap: () => newRequest(context, requests, requestServices))
            : null,
    ];
  }

  /// "Needs you", the next delivery and the shortcuts; null when no module is on.
  Widget? _inbox() {
    final work = _work;
    final requests = _requests;
    final submitter = _toolSubmitter;
    final sources = <Listenable>[?work, ?requests, ?submitter, ?_tools, ?_agreements];
    if (sources.isEmpty) return null;
    return ListenableBuilder(
      listenable: Listenable.merge(sources),
      builder: (context, _) {
        final delivery = requests?.updates.nextDelivery;
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (work != null || requests != null || submitter != null)
            NeedsYouCard(
              needs: needsYou(
                work: work?.view.entries,
                workOtherFailed: work?.view.otherFailed ?? const [],
                workRead: work?.read ?? true,
                requests: requests?.all,
                requestsRead: requests?.read ?? true,
                toolsUnresolved: submitter?.unresolved,
                toolRecordsNeedChecking: submitter != null && (submitter.unreadable.isNotEmpty || submitter.recoveryNeeded),
                toolsRead: submitter?.loaded ?? true,
              ),
              onOpen: _openNeed,
            ),
          if (delivery != null) NextDeliveryLine(iso: delivery),
          ShortcutRow(tiles: _shortcuts()),
        ]);
      },
    );
  }

  /// The badge at the top of Home: everything still on this phone (spec §6).
  Widget _syncBadge() {
    final work = _work;
    final requests = _requests;
    final submitter = _toolSubmitter;
    return ListenableBuilder(
      listenable: Listenable.merge([_home, ?work, ?requests, ?submitter]),
      builder: (context, _) => SyncBadge(
        summary: syncSummary([
          _home.waiting,
          requests == null ? 0 : (requests.read ? requests.updates.pending : null),
          work == null ? 0 : (work.read ? work.updates.pending : null),
          submitter == null
              ? 0
              : (submitter.loaded ? toolsNotConfirmed(submitter.unresolved.length, submitter.unreadable.length, submitter.recoveryNeeded) : null),
        ]),
      ),
    );
  }

  /// Home's pull-to-refresh: today's attendance and every module Home shows.
  Future<void> _refreshAll() async {
    final submitter = _toolSubmitter;
    await Future.wait<void>([
      _home.refresh(),
      ?_requests?.refresh(),
      ?_work?.refresh(),
      ?_tools?.refresh(),
      if (submitter != null) submitter.load(widget.worker.id).catchError((Object _) {}),
    ]);
  }
```

- replace the `build` method's middle and end — from `final requests = _requests;` down to the end of `build` — with:

```dart
    final requests = _requests;
    final work = _work;
    final body = switch (_tab) {
      _Tab.home => HomeScreen(
          worker: widget.worker,
          controller: _home,
          onStartFlow: _startFlow,
          onSeeHistory: () => _selectTab(_Tab.history),
          openSettings: s.openSettings,
          exitNotice: _exitNotice,
          onDismissExit: () => setState(() => _exitNotice = null),
          inbox: _inbox(),
          headerTrailing: _syncBadge(),
          onRefresh: _refreshAll,
        ),
      _Tab.work => MyWorkScreen(
          controller: work!,
          services: widget.workPlan!,
          isLeader: _isLeader,
          onMakeRequest: requests == null ? null : _openRequests,
        ),
      _Tab.requests => RequestsScreen(controller: requests!, services: widget.requests!),
      _Tab.history => HistoryScreen(controller: _history, photoUrl: s.photoUrl),
      _Tab.profile => ProfileScreen(
          worker: widget.worker,
          versionName: widget.versionName,
          onSignOut: widget.onSignOut,
          account: widget.account,
          tools: _tools,
          onOpenTools: _openTools,
          agreements: _agreements,
          onOpenAgreements: _openAgreements,
        ),
    };
    final tabs = _tabs;
    return Scaffold(
      body: SafeArea(child: body),
      bottomNavigationBar: WmNavBar(
        selectedIndex: tabs.indexOf(_tab),
        onDestinationSelected: (i) => _selectTab(tabs[i]),
        destinations: [
          for (final t in tabs)
            switch (t) {
              _Tab.home => NavigationDestination(icon: Icon(_tab == t ? Icons.home : Icons.home_outlined), label: 'Home'),
              _Tab.work => NavigationDestination(icon: _WorkIcon(controller: work!, selected: _tab == t), label: 'My Work'),
              _Tab.requests => NavigationDestination(icon: _RequestsIcon(controller: requests!, selected: _tab == t), label: 'Requests'),
              _Tab.history => const NavigationDestination(icon: Icon(Icons.history), label: 'History'),
              _Tab.profile => NavigationDestination(icon: Icon(_tab == t ? Icons.person : Icons.person_outline), label: 'Profile'),
            },
        ],
      ),
    );
  }
}
```

- replace the `_WorkIcon` class at the end of the file with:

```dart
/// The My Work tab's icon, with a red number for what needs the worker
/// (tasks to read or check, actions not accepted).
class _WorkIcon extends StatelessWidget {
  const _WorkIcon({required this.controller, required this.selected});
  final MyWorkController controller;
  final bool selected;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) => RingBadge(
          key: const Key('my-work-badge'),
          count: controller.updates.badge,
          child: Icon(selected ? Icons.assignment : Icons.assignment_outlined),
        ),
      );
}

/// The Requests tab's icon, with a red number for the worker's own requests
/// the office refused or wants fixed (redesign spec §7.1).
class _RequestsIcon extends StatelessWidget {
  const _RequestsIcon({required this.controller, required this.selected});
  final RequestsController controller;
  final bool selected;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) => RingBadge(
          key: const Key('requests-badge'),
          count: ownToFix(controller.all),
          child: Icon(selected ? Icons.inventory_2 : Icons.inventory_2_outlined),
        ),
      );
}
```

- update the class comment of `HomeShell`: "Tools (Stage 3b) open from a card on Home" → "Tools and Agreements open from
  Home's shortcuts and from Profile".

- [ ] **Step 5: The buyer's bar**

`lib/purchasing/ui/buyer_shell.dart`:
- add `import '../../ui/wm_nav_bar.dart';`
- replace `bottomNavigationBar: NavigationBar(` … its closing `),` with:

```dart
      bottomNavigationBar: WmNavBar(
        selectedIndex: tabs.indexOf(_tab),
        onDestinationSelected: (i) => _select(tabs[i]),
        destinations: [
          for (final t in tabs)
            switch (t) {
              _Tab.shopping =>
                NavigationDestination(icon: Icon(_tab == t ? Icons.shopping_cart : Icons.shopping_cart_outlined), label: 'Shopping list'),
              _Tab.mine => NavigationDestination(icon: _MineIcon(controller: _mine!, selected: _tab == t), label: 'My purchases'),
              _Tab.stock => NavigationDestination(
                  key: const Key('tab-stock'), icon: Icon(_tab == t ? Icons.inventory_2 : Icons.inventory_2_outlined), label: 'Stock'),
              _Tab.profile => NavigationDestination(icon: Icon(_tab == t ? Icons.person : Icons.person_outline), label: 'Profile'),
            },
        ],
      ),
```

- replace `_MineIcon` with:

```dart
/// My purchases, with a red number for purchases that need attention (Q7).
class _MineIcon extends StatelessWidget {
  const _MineIcon({required this.controller, required this.selected});
  final MyPurchasesController controller;
  final bool selected;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) => RingBadge(
          key: const Key('mine-badge'),
          count: controller.attention,
          child: Icon(selected ? Icons.receipt_long : Icons.receipt_long_outlined),
        ),
      );
}
```

- [ ] **Step 6: Retire the four cards**

Delete `lib/workplan/ui/my_work_card.dart`, `lib/requests/home/request_updates_card.dart`, `lib/tools/ui/tools_card.dart`
and `lib/agreements/ui/agreements_card.dart`. Keep `lib/requests/home/request_updates.dart`.

- [ ] **Step 7: Rewrite the tests that checked the old cards (same facts, new places)**

`test/agreements/agreements_screens_test.dart`: delete the test `'the Home card shows only after a read found
agreements — and never an amount'` (moved to `profile_screen_test` in Task 6, with the same assertions) and the import
`package:workmate/agreements/ui/agreements_card.dart`.

`test/requests/list/requests_controller_test.dart`: delete the test `'Home\'s card says what needs the worker and opens
Requests'` and the import of `request_updates_card.dart`. Its facts now live in: needs → `needs_you_test` (fix rows),
drafts → `needs_you_test` (finish rows), waiting → `sync_summary_test` + `home_inbox_test` (badge), next delivery →
`home_widgets_test` (`Next delivery Wed 14 Oct`). Remove any import `flutter analyze` then reports unused.

`test/ui/home_agreements_test.dart`: replace every `Key('agreements-card')` with `Key('shortcut-agreements')`, then in
the first test replace

```dart
    expect(find.byKey(const Key('agreements-card')), findsOneWidget);
    expect(find.text('4 agreements'), findsOneWidget);
```

(after the key swap: `shortcut-agreements`) with

```dart
    expect(find.byKey(const Key('shortcut-agreements')), findsOneWidget);
    expect(find.textContaining('₱'), findsNothing, reason: 'no amount on Home');
    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    expect(find.text('4 agreements'), findsOneWidget);
    expect(find.textContaining('₱'), findsNothing, reason: 'no amount on Profile');
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
```

and rename the tests' "card" wording to "shortcut" (`'a linked worker gets the My agreements shortcut and a Profile
row, and it opens their agreements'`, `'no linked agreement, or no signal: no shortcut, and nothing else on Home
changes'`, `'without the service (an older setup), Home shows no shortcut at all'`).

`test/ui/home_tools_password_test.dart`: replace the group `'the My tools card'` with:

```dart
  group('My tools on Home and on Profile', () {
    ToolsServices tools(FakeToolsRemote remote) =>
        ToolsServices(remote: remote, store: MemoryToolPendingStore(), saved: ToolsSavedCopy(prefs));

    testWidgets('a worker: Profile counts their tools and reported problems; the shortcut opens Tools', (tester) async {
      final remote = FakeToolsRemote();
      await showShell(tester, tools: tools(remote));
      expect(find.byKey(const Key('shortcut-tools')), findsOneWidget);
      expect(remote.teamCalls, 0, reason: 'a worker is never asked for a team');
      await tester.tap(find.text('Profile'));
      await tester.pumpAndSettle();
      expect(find.text('2 tools with you · 1 problem reported'), findsOneWidget);
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('shortcut-tools')));
      await tester.pumpAndSettle();
      expect(find.text('Tools'), findsOneWidget);
      expect(find.text('TOOL-0001 · Grinder'), findsOneWidget);
      expect(find.byKey(const Key('tools-parts')), findsNothing, reason: 'no Team for a worker');
    });

    testWidgets('a team leader: the shortcut opens Tools with Mine, Team and My records', (tester) async {
      server.session = leader.id;
      await showShell(tester, who: leader, tools: tools(FakeToolsRemote()));
      await tester.tap(find.byKey(const Key('shortcut-tools')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tools-parts')), findsOneWidget);
    });

    testWidgets('tools switched off: no shortcut, no Profile row, and Home is as before', (tester) async {
      final remote = FakeToolsRemote()..failMine = refusal('TOOLS_OFF');
      await showShell(tester, tools: tools(remote));
      expect(find.byKey(const Key('shortcut-tools')), findsNothing);
      await timeInWorks(tester);
      await tester.tap(find.text('Profile'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('profile-tools')), findsNothing);
    });

    testWidgets('no signal on the first open, nothing saved: no shortcut, attendance as always', (tester) async {
      final remote = FakeToolsRemote()..failReads = refusal('no signal');
      await showShell(tester, tools: tools(remote));
      expect(find.byKey(const Key('shortcut-tools')), findsNothing);
      await timeInWorks(tester);
    });
  });
```

`test/ui/screens_test.dart`:
- add imports `package:workmate/requests/detail/request_detail_screen.dart` and `package:workmate/workplan/ui/task_screen.dart`;
- replace the test `'with Requests: a Requests tab, and the Home card opens it'` body after `await tester.pumpAndSettle();` with:

```dart
    expect(find.text('Requests'), findsWidgets);
    expect(find.text('Request · Santos Townhouse · Main Contract'), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('requests-badge')), matching: find.text('1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('needs-fixRequest-r1')));
    await tester.pumpAndSettle();
    expect(find.byType(RequestDetailScreen), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Requests').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('new-request')), findsOneWidget);
    expect(find.text('Needs resolution'), findsOneWidget);
    // History still works from its own tab.
    await tester.tap(find.text('History'));
    await tester.pumpAndSettle();
    expect(find.text('My attendance'), findsOneWidget);
```

  and rename it `'with Requests: a Requests tab with a red number, and the Fix row opens the request'`;
- replace the test `'with My Work: a My Work tab with a number, and the Home card opens it'` body after
  `await tester.pumpAndSettle();` with:

```dart
    expect(find.text('My Work'), findsWidgets);
    expect(find.text('Wall prep'), findsOneWidget);
    expect(find.text('New task · read it first'), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('my-work-badge')), matching: find.text('1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('needs-read-t1')));
    await tester.pumpAndSettle();
    expect(find.byType(TaskScreen), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('My Work').last);
    await tester.pumpAndSettle();
    expect(find.text('TODAY · 1'), findsOneWidget);
    // Requests still has its own tab.
    await tester.tap(find.text('Requests').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('new-request')), findsOneWidget);
```

  and rename it `'with My Work: a My Work tab with a number, and the Read row opens the task'`.

- [ ] **Step 8: Run the affected tests**

Run: `flutter test test/ui test/profile test/agreements test/requests test/workplan test/purchasing test/stock test/home`
Expected: all pass. If a stock or buyer test fails on the bar, it must be the bar's look (icon variant), never a tab,
its order or its key — fix the code, not the expectation, unless the test pinned the old look.

- [ ] **Step 9: Checkpoint (no commit)**

Report the changed, created and deleted files.

---

### Task 8: Version and the full check

**Files:**
- Modify: `pubspec.yaml`

- [ ] **Step 1: Bump the version**

In `pubspec.yaml` replace `version: 0.11.1+1014` with `version: 0.12.0+1015`.

- [ ] **Step 2: Analyzer**

Run: `flutter analyze`
Expected: `No issues found!` Fix every issue (unused imports left by Tasks 4 and 7 are the likely ones).

- [ ] **Step 3: The whole suite**

Run: `flutter test`
Expected: every test passes. Report the count (0.11.1 had 1158) and the new total; the difference is the tests added
here, minus none deleted (the two card tests were moved, not dropped).

- [ ] **Step 4: Spec acceptance walk (spec §12)**

Tick each against a passing test and name it in the report:

| # | Acceptance | Test |
|---|---|---|
| 1 | Three rows, each opens its thing | `home_inbox_test`: three rows; Read / Fix / Finish |
| 2 | Leader: Check row and My proposals | `home_inbox_test`: team leader |
| 3 | Time In waiting → "1 not sent yet" | `home_inbox_test`: a Time In still on the phone |
| 4 | Nothing waiting → All sent + caught up | `home_inbox_test`: nothing waiting |
| 5 | No signal, no copy → never caught up | `home_inbox_test`: no signal and no saved copy |
| 6 | Tools off / no agreements / no amount | `home_tools_password_test`, `home_agreements_test`, `profile_screen_test` |
| 7 | Attendance, This week, Weekly reward unchanged | `home_screen_test`, `home_reward_test`, `screens_test`, `home_inbox_test` last test |
| 8 | Notes and password as sheets; swipe / outside / Back | `wm_sheet_test`, `notes_sheet_test`, `profile_screen_test`, `home_inbox_test` notes |
| 9 | New bar in both shells, Requests number | `wm_nav_bar_test`, `home_inbox_test`, `buyer_screens_test`, `stock_screens_test` |
| 10 | Tests and analyzer pass | Steps 2–3 |

- [ ] **Step 5: Hand over (no commit, no build, no pilot)**

Report to the user: files changed per task, the test count, `flutter analyze` result, and that building the APK, the
phone pilot (worker and team-leader accounts) and publishing build 1015 each need their own approval.
