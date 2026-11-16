# WorkMate Redesign Phase 2 (My Work) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** My Work gets chips with counts, a 4-step progress bar and a "Next:" line on every task, a swipe-left shortcut
to Report progress / Report a problem, and the task becomes a tall swipe-down sheet whose report forms open inside it —
with every existing rule, field and server call unchanged.

**Architecture:** A pure rule file (`wp_progress.dart`) turns a task entry into its 4 steps and Next line. A new
`TaskSheet` (Phase 1 `WmSheet`) shows the task and switches its body to a report form in place; a `PopScope` makes
Back / drag / outside-tap from a form return to the task. A new swipeable `TaskCard` and a stateful `MyWorkScreen`
build the list. The shared `openTask` opener opens the sheet, optionally straight on a form.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, Material 3, `flutter_test`, `shared_preferences`.

**Spec:** `docs/superpowers/specs/2026-11-12-workmate-redesign-phase2-my-work-design.md` (Dacs Web repo). Read it with
this plan; where they differ, the spec wins.

## Global Constraints

- Repository: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`, base `main` at `3fabf73` (0.12.1+1016, published).
  Run every command from that folder.
- **Never run `git commit`, `git push`, `git add`, `git stash`, `git checkout`, `git restore` or `git rm`.** The user
  commits by hand. Delete files with a normal file delete. Each task ends with a checkpoint listing the changed files.
- **Never run `dart format`** (the repo sets no page width; it would reflow ~150-column files).
- **No server change.** `actionsFor`, `groupOf`, `isLate`, every `WorkPlanApi` call, the offline queue and every form
  field/validation/photo rule stay exactly as they are.
- Progress steps are exactly **Read · Started · Reported done · Approved**; "Checked by the leader" is a line, not a step.
- Next-line words exactly as spec §5.2. Swipe button labels exactly "Progress" and "Problem". Hint exactly "Swipe a task
  left to report progress or a problem." Chips exactly "Today", "Upcoming", "Waiting", "Done".
- **Nothing is ever sent by a swipe or a swipe button**; they only open a form.
- From a form inside the task sheet, the back arrow, Android Back, dragging down and tapping outside all **return to the
  task view**; from the task view they close the sheet.
- Keys kept: `open-notes`, `open-proposals`, `task-<id>`, `ack`, `start`, `done`, `check`, `progress`, `problem`,
  `note-field`, `note-submit`, `problem-field`, `problem-submit`, `problem-request`, `make-request`, `add-photo`,
  `remove-photo`, `kind-<k>`, `wm-sheet-back`, `wm-sheet-close`, `wm-sheet-handle`.
- New keys: `chip-today`, `chip-upcoming`, `chip-waiting`, `chip-done`, `swipe-hint`, `swipe-progress-<id>`,
  `swipe-problem-<id>`, `step-tracker`, `step-<i>-done|current|todo`, `bar-<i>-on|off`, `leader-checked`,
  `task-gone`.
- **Never delete a test to make the suite pass**: a test of the old page is rewritten to assert the same fact in the
  sheet (each task names where).
- Finish with `flutter test` passing and `flutter analyze` reporting `No issues found!`. Version after Phase 2:
  `0.13.0+1017`.

**Rulings made while planning (the user should know):**
- The current-step ring in the tracker is `danger` / `brown` when the Next line is, otherwise **`green`** (the mockup's
  look); spec §7 said "the Next-line colour", whose normal tone is grey.
- When the main button is I'VE READ THIS and Start is locked only because of reading, the note under it shows the
  existing lock words "Read the task first: tap "I've read this"." (keeps today's fact visible).
- Meeting notes with no saved copy: the no-signal words of spec §9 when the failure is "no connection"; any other failure
  shows its real reason (`wpFailureCopy`) — "No signal" would be untrue for e.g. a refused account.
- Each report form shows the task's title at the top of its body (the mockup's form sheet does; the header shows the
  form's title).
- "Make a request instead" first returns to the task, then calls the shell's `_openRequests`, which already closes
  every open screen and sheet (`popUntil(isFirst)`) and opens Requests — so the sheet closes as spec §8 says, with no
  new code in the shell.

---

### Task 1: The progress rules (`wp_progress.dart`)

**Files:**
- Create: `lib/workplan/domain/wp_progress.dart`
- Create: `test/workplan/domain/wp_progress_test.dart`

**Interfaces:**
- Consumes: `WpEntry` (`toRead`, `toCheck`, `blocked`, `shownPending`, `effectiveStatus`, `task.myRole`), `WpStatus`,
  `WpRole`.
- Produces: `enum NextTone { danger, brown, green, normal }`; `class WpProgress { List<bool> reached; bool leaderChecked;
  String next; NextTone tone; int? get current; int get count; }`; `const wpStepLabels`; `WpProgress progressOf(WpEntry e)`.

- [ ] **Step 1: Write the failing test**

Create `test/workplan/domain/wp_progress_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/workplan/domain/wp_op.dart';
import 'package:workmate/workplan/domain/wp_progress.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';

import '../workplan_fakes.dart';

WpEntry entry(Map<String, dynamic> doc, {List<WpOp> pending = const []}) => WpEntry(task: task0(doc), pendingOps: pending);

WpOp waiting(WpOpKind kind) =>
    WpOp(opId: 'p-${kind.name}', workerId: 'u1', kind: kind, createdAt: DateTime.utc(2026, 11, 12), taskId: 't1');

void main() {
  test('the four steps, in order', () {
    expect(wpStepLabels, ['Read', 'Started', 'Reported done', 'Approved']);
  });

  test('a new task: nothing reached; read it first', () {
    final p = progressOf(entry(taskDoc()));
    expect([p.reached, p.current, p.next, p.tone], [
      [false, false, false, false],
      0,
      'Next: read the task',
      NextTone.danger,
    ]);
  });

  test('read, not started, responsible: start work', () {
    final p = progressOf(entry(taskDoc(ackVersion: 1)));
    expect([p.reached, p.current, p.next, p.tone], [
      [true, false, false, false],
      1,
      'Next: start work',
      NextTone.normal,
    ]);
  });

  test('in progress: report done', () {
    final p = progressOf(entry(taskDoc(ackVersion: 1, status: 'in_progress')));
    expect([p.reached, p.next], [
      [true, true, false, false],
      'Next: report done',
    ]);
  });

  test('reported done: the office checks it next', () {
    final p = progressOf(entry(taskDoc(ackVersion: 1, status: 'reported_done')));
    expect([p.reached, p.current, p.leaderChecked, p.next], [
      [true, true, true, false],
      3,
      false,
      'Reported · the office checks it next',
    ]);
  });

  test('checked by the leader: step 3 reached and a line — not a step of its own', () {
    final p = progressOf(entry(taskDoc(ackVersion: 1, status: 'leader_checked')));
    expect([p.reached, p.leaderChecked, p.next], [
      [true, true, true, false],
      true,
      'Reported · the office checks it next',
    ]);
  });

  test('approved by the office: all four, Completed, green', () {
    final p = progressOf(entry(taskDoc(ackVersion: 1, status: 'completed')));
    expect([p.reached, p.current, p.count, p.next, p.tone], [
      [true, true, true, true],
      null,
      4,
      'Completed',
      NextTone.green,
    ]);
  });

  test('changed after reading: step 1 empty again, the later steps keep their state', () {
    final p = progressOf(entry(taskDoc(version: 2, ackVersion: 1, status: 'in_progress')));
    expect([p.reached, p.current, p.next], [
      [false, true, false, false],
      0,
      'Next: read the task',
    ]);
  });

  test('sent back by the office: back to Started', () {
    final p = progressOf(entry(taskDoc(ackVersion: 1, status: 'in_progress', sentBack: true)));
    expect([p.reached, p.next], [
      [true, true, false, false],
      'Next: report done',
    ]);
  });

  test('blocked: waiting for the office', () {
    final p = progressOf(entry(taskDoc(ackVersion: 1, blocked: true)));
    expect([p.next, p.tone], ['Waiting for the office to clear a problem', NextTone.brown]);
  });

  test('a leader with reported work to check', () {
    final p = progressOf(entry(taskDoc(role: 'leader', status: 'reported_done', canCheck: true)));
    expect([p.next, p.tone], ['Next: check this work', NextTone.danger]);
  });

  test('a helper: the responsible person reports', () {
    final p = progressOf(entry(taskDoc(role: 'helper', ackVersion: 1, status: 'in_progress')));
    expect([p.next, p.tone], ['The responsible person reports this work', NextTone.normal]);
  });

  test('anything still on the phone comes first; a pending Start counts as started', () {
    final p = progressOf(entry(taskDoc(ackVersion: 1), pending: [waiting(WpOpKind.start)]));
    expect([p.reached[1], p.next, p.tone], [true, 'Saved on this phone · sends when there is signal', NextTone.brown]);
  });
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `flutter test test/workplan/domain/wp_progress_test.dart`
Expected: compile error — `package:workmate/workplan/domain/wp_progress.dart` does not exist.

- [ ] **Step 3: Implement**

Create `lib/workplan/domain/wp_progress.dart`:

```dart
import 'wp_rules.dart';
import 'wp_task.dart';

/// How a task's Next line is coloured (redesign Phase 2 spec §5.2).
enum NextTone { danger, brown, green, normal }

/// The four steps every task goes through. The leader's check is optional in
/// the real flow (the office can approve from "Reported done"), so it is a
/// line under step 3, never a step (owner decision, 12 Nov 2026).
const wpStepLabels = ['Read', 'Started', 'Reported done', 'Approved'];

/// One task's steps and Next line (spec §5).
class WpProgress {
  const WpProgress({required this.reached, required this.leaderChecked, required this.next, required this.tone});

  /// Read · Started · Reported done · Approved.
  final List<bool> reached;

  /// Checked by the leader: shown under step 3.
  final bool leaderChecked;
  final String next;
  final NextTone tone;

  /// The first step not reached; null when all four are.
  int? get current {
    final i = reached.indexOf(false);
    return i < 0 ? null : i;
  }

  int get count => reached.where((r) => r).length;
}

WpProgress progressOf(WpEntry e) {
  final s = e.effectiveStatus;
  final started = s != WpStatus.notStarted;
  final reported = s == WpStatus.reportedDone || s == WpStatus.leaderChecked || s == WpStatus.completed;
  final (next, tone) = _next(e, s);
  return WpProgress(
    reached: [!e.toRead, started, reported, s == WpStatus.completed],
    leaderChecked: s == WpStatus.leaderChecked,
    next: next,
    tone: tone,
  );
}

/// The first rule of spec §5.2 that matches.
(String, NextTone) _next(WpEntry e, WpStatus s) {
  final responsible = e.task.myRole == WpRole.responsible;
  if (e.shownPending.isNotEmpty) return ('Saved on this phone · sends when there is signal', NextTone.brown);
  if (e.toRead) return ('Next: read the task', NextTone.danger);
  if (e.toCheck) return ('Next: check this work', NextTone.danger);
  if (e.blocked) return ('Waiting for the office to clear a problem', NextTone.brown);
  if (s == WpStatus.completed) return ('Completed', NextTone.green);
  if (s == WpStatus.reportedDone || s == WpStatus.leaderChecked) return ('Reported · the office checks it next', NextTone.normal);
  if (responsible && s == WpStatus.notStarted) return ('Next: start work', NextTone.normal);
  if (responsible && s == WpStatus.inProgress) return ('Next: report done', NextTone.normal);
  return ('The responsible person reports this work', NextTone.normal);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `flutter test test/workplan/domain/wp_progress_test.dart`
Expected: all pass.

- [ ] **Step 5: Checkpoint (no commit)** — report the 2 new files.

---

### Task 2: Sheet note line, 48-px buttons, Meeting notes with no signal

**Files:**
- Modify: `lib/ui/wm_sheet.dart`
- Modify: `lib/workplan/ui/notes_sheet.dart`
- Modify: `test/ui/wm_sheet_test.dart`
- Modify: `test/workplan/ui/notes_sheet_test.dart`

**Interfaces:**
- Produces: `WmSheetNote(String text, {bool warning = false})` in `lib/ui/wm_sheet.dart`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ui/wm_sheet_test.dart` inside `main()`:

```dart
  testWidgets('the round buttons look 36 px but take taps across 48 px', (tester) async {
    await open(tester);
    expect(tester.getSize(find.byKey(const Key('wm-sheet-close'))), const Size(48, 48));
    final center = tester.getCenter(find.byKey(const Key('wm-sheet-close')));
    await tester.tapAt(center + const Offset(21, 0)); // outside the 36-px circle, inside the 48-px area
    await tester.pumpAndSettle();
    expect(find.text('Body'), findsNothing);
  });

  testWidgets('a note under the main button: muted, or brown for a lock', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: const Scaffold(body: Column(children: [WmSheetNote('Saved.'), WmSheetNote('Locked.', warning: true)])),
    ));
    expect(tester.widget<Text>(find.text('Saved.')).style!.color, WmColors.textMuted);
    expect(tester.widget<Text>(find.text('Locked.')).style!.color, WmColors.brown);
    expect(tester.widget<Text>(find.text('Saved.')).style!.fontSize, 13);
  });
```

Append to `test/workplan/ui/notes_sheet_test.dart` inside `main()` (add `import 'dart:io';` and
`import 'package:workmate/workplan/data/workplan_api.dart';` at the top):

```dart
  Future<void> openNotes(WidgetTester tester, MyWorkController c) async {
    useTallPhone(tester);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: Builder(builder: (context) => TextButton(onPressed: () => showNotesSheet(context, c), child: const Text('open'))),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('no signal and nothing saved: it says so, not "no notes"', (tester) async {
    final api = FakeWorkPlanApi()..view = const WorkPlanView(error: SocketException('no signal'));
    final c = MyWorkController(api: api);
    await c.refresh();
    await openNotes(tester, c);
    expect(find.text('No signal right now. Open this again when there is signal.'), findsOneWidget);
    expect(find.text('No meeting notes for you yet.'), findsNothing);
  });

  testWidgets('no signal with a saved copy: the saved notes, and when they were saved', (tester) async {
    final api = FakeWorkPlanApi()
      ..view = WorkPlanView(notes: FakeWorkPlanApi().view.notes, error: const SocketException('no signal'), fetchedAt: DateTime.utc(2026, 11, 11, 1));
    final c = MyWorkController(api: api);
    await c.refresh();
    await openNotes(tester, c);
    expect(find.textContaining('No signal: showing what this phone saved on'), findsOneWidget);
    expect(find.text('Skim coat first, then cabinets.'), findsOneWidget);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/ui/wm_sheet_test.dart test/workplan/ui/notes_sheet_test.dart`
Expected: compile error (`WmSheetNote` missing); the size test and the no-signal tests fail.

- [ ] **Step 3: Implement**

In `lib/ui/wm_sheet.dart`:
- replace the whole `_RoundButton.build` with:

```dart
  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: label,
        // 36 px to look at, 48 px to hit (Phase 2 spec §9).
        child: SizedBox(
          width: 48,
          height: 48,
          child: InkResponse(
            onTap: onTap,
            radius: 24,
            child: Center(
              child: Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(color: WmColors.inert, shape: BoxShape.circle),
                child: Icon(icon, size: 20, color: WmColors.textSecondary),
              ),
            ),
          ),
        ),
      );
```

- in `_WmSheetFrameState.build`, change the title's `padding: const EdgeInsets.only(top: 4),` to
  `padding: const EdgeInsets.only(top: 10),` and both `const SizedBox(width: 10),` beside the round buttons to
  `const SizedBox(width: 4),`.
- add at the end of the file:

```dart
/// A short line under a sheet's main button (Phase 2 spec §9): muted, or
/// brown when it says why the button is locked.
class WmSheetNote extends StatelessWidget {
  const WmSheetNote(this.text, {super.key, this.warning = false});

  final String text;
  final bool warning;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text(text, style: TextStyle(fontSize: 13, color: warning ? WmColors.brown : WmColors.textMuted)),
      );
}
```

In `lib/workplan/ui/notes_sheet.dart`:
- add imports `import '../domain/wp_failure.dart';` and `import 'workplan_copy.dart';`
- replace the `builder:` body of `NotesSheet.build` with:

```dart
        builder: (context, _) {
          final c = controller;
          final notes = c.view.notes;
          final failure = c.failure;
          final saved = c.view.fetchedAt;
          return WmSheetFrame(title: 'Meeting notes', children: [
            if (failure != null && saved != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Text('No signal: showing what this phone saved on ${dayMonth(saved)}, ${clockTime(saved)}.',
                    style: const TextStyle(fontSize: 12.5, color: WmColors.brown)),
              ),
            if (notes.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  failure != null && saved == null ? _unread(failure) : 'No meeting notes for you yet.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: WmColors.textMuted),
                ),
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
```

- add below the class:

```dart
/// Nothing could be read: say why — never "no notes" (Phase 2 spec §9).
String _unread(WpFailure f) =>
    f == WpFailure.noConnection ? 'No signal right now. Open this again when there is signal.' : wpFailureCopy(f).english;
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/ui test/workplan/ui/notes_sheet_test.dart test/profile`
Expected: all pass (the Phase 1 sheet tests, including Change password, still pass).

- [ ] **Step 5: Checkpoint (no commit)** — report the 4 files.

---

### Task 3: The task sheet and the report forms inside it

**Files:**
- Create: `lib/workplan/ui/progress_widgets.dart`
- Create: `lib/workplan/ui/task_sheet.dart`
- Modify: `lib/workplan/ui/report_forms.dart`
- Modify: `lib/workplan/ui/task_openers.dart`
- Delete: `lib/workplan/ui/task_screen.dart`
- Modify: `test/workplan/ui/my_work_screens_test.dart` (the task and form tests)
- Modify: `test/ui/home_inbox_test.dart`, `test/ui/screens_test.dart` (`TaskScreen` → `TaskSheet`)
- Create: `test/workplan/ui/task_sheet_test.dart`

**Interfaces:**
- Consumes: `progressOf`, `WpProgress`, `NextTone`, `wpStepLabels` (Task 1); `showWmSheet`, `WmSheetFrame`,
  `WmSheetButton`, `WmSheetNote` (Phase 1 + Task 2).
- Produces:
  - `enum TaskForm { progress, problem, done, check }` and `class TaskSheet({required MyWorkController controller,
    required WorkPlanServices services, required String taskId, VoidCallback? onMakeRequest, TaskForm? initialForm})`
    in `task_sheet.dart`;
  - `Future<void> openTask(BuildContext context, MyWorkController controller, WorkPlanServices services, String taskId,
    {VoidCallback? onMakeRequest, TaskForm? form})`;
  - `Color nextToneColor(NextTone t)`, `TaskProgressBar({required WpProgress progress})`,
    `StepTracker({required WpProgress progress})` in `progress_widgets.dart`;
  - `NoteForm(...)` and `ProblemForm(...)` (sheet bodies) in `report_forms.dart`.

- [ ] **Step 1: Write the failing tests**

Create `test/workplan/ui/task_sheet_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/ui/wm_sheet.dart';
import 'package:workmate/workplan/data/workplan_api.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';
import 'package:workmate/workplan/ui/my_work_controller.dart';
import 'package:workmate/workplan/ui/task_openers.dart';
import 'package:workmate/workplan/ui/task_sheet.dart';
import 'package:workmate/workplan/workplan_services.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../workplan_fakes.dart';

void main() {
  late FakeWorkPlanApi api;
  late MyWorkController controller;
  late WorkPlanServices services;

  setUp(() {
    api = FakeWorkPlanApi();
    controller = MyWorkController(api: api, now: () => DateTime.utc(2026, 10, 14, 2));
    services = WorkPlanServices(api: api, takePhoto: (_) async => '/raw/shot.jpg');
  });

  Future<void> openSheet(WidgetTester tester, {TaskForm? form}) async {
    useTallPhone(tester);
    await controller.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: TextButton(onPressed: () => openTask(context, controller, services, 't1', form: form), child: const Text('open')),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('the task opens as a tall sheet with the step tracker', (tester) async {
    api.view = WorkPlanView(entries: [WpEntry(task: task0(taskDoc(ackVersion: 1, status: 'in_progress')))]);
    await openSheet(tester);
    expect(find.byType(TaskSheet), findsOneWidget);
    expect(find.text('Wall prep'), findsWidgets);
    expect(find.byKey(const Key('step-tracker')), findsOneWidget);
    expect(find.byKey(const Key('step-0-done')), findsOneWidget);
    expect(find.byKey(const Key('step-1-done')), findsOneWidget);
    expect(find.byKey(const Key('step-2-current')), findsOneWidget);
    expect(find.byKey(const Key('step-3-todo')), findsOneWidget);
    expect(find.byKey(const Key('done')), findsOneWidget, reason: 'REPORT DONE is the main button');
  });

  testWidgets('checked by the leader: a line under step 3; reported work says the office checks it', (tester) async {
    api.view = WorkPlanView(entries: [WpEntry(task: task0(taskDoc(ackVersion: 1, status: 'leader_checked')))]);
    await openSheet(tester);
    expect(find.byKey(const Key('leader-checked')), findsOneWidget);
    expect(find.text('Checked by the leader'), findsOneWidget);
    expect(find.text('The office checks the work before it counts as completed.'), findsOneWidget);
  });

  testWidgets('from a form, Back, dragging down and tapping outside return to the task — never close it', (tester) async {
    api.view = WorkPlanView(entries: [WpEntry(task: task0(taskDoc(ackVersion: 1, status: 'in_progress')))]);
    await openSheet(tester, form: TaskForm.progress);
    expect(find.byKey(const Key('note-field')), findsOneWidget, reason: 'opened straight on the form');

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('note-field')), findsNothing);
    expect(find.byKey(const Key('step-tracker')), findsOneWidget, reason: 'Back → the task');

    await tester.tap(find.byKey(const Key('progress')));
    await tester.pumpAndSettle();
    await tester.timedDrag(find.byKey(const Key('wm-sheet-handle')), const Offset(0, 160), const Duration(milliseconds: 800));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('step-tracker')), findsOneWidget, reason: 'drag → the task');

    await tester.tap(find.byKey(const Key('progress')));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(20, 20));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('step-tracker')), findsOneWidget, reason: 'outside tap → the task');

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(TaskSheet), findsNothing, reason: 'from the task, Back closes the sheet');
    expect(api.calls, isEmpty);
  });

  testWidgets('a task that left the list says so', (tester) async {
    api.view = WorkPlanView(entries: [WpEntry(task: task0(taskDoc(ackVersion: 1)))]);
    await openSheet(tester);
    api.view = const WorkPlanView();
    await controller.refresh();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('task-gone')), findsOneWidget);
    expect(find.text('This task is no longer on your list.'), findsOneWidget);
  });

  testWidgets('a completed task: no main button, "Completed." under the tracker', (tester) async {
    api.view = WorkPlanView(entries: [WpEntry(task: task0(taskDoc(ackVersion: 1, status: 'completed')))]);
    await openSheet(tester);
    expect(find.byType(WmSheetButton), findsNothing);
    expect(find.text('Completed.'), findsOneWidget);
  });
}
```

In `test/workplan/ui/my_work_screens_test.dart`:
- replace the import `package:workmate/workplan/ui/task_screen.dart` with
  `package:workmate/workplan/ui/task_openers.dart` and add `import 'package:workmate/ui/wm_sheet.dart';`
- add this helper inside `main()` after `open(...)`:

```dart
  /// The task opens as a sheet over a plain page (as from My Work or Home).
  Future<void> openTaskSheet(WidgetTester tester, {VoidCallback? onMakeRequest}) async {
    useTallPhone(tester);
    await controller.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: TextButton(
              onPressed: () => openTask(context, controller, services, 't1', onMakeRequest: onMakeRequest),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }
```

- in the tests from `'a changed task says what changed…'` through `'pending and refused actions…'`, replace every
  `await open(tester, TaskScreen(controller: controller, services: services, taskId: 't1'));` with
  `await openTaskSheet(tester);` and the one with `onMakeRequest: () => madeRequest++` with
  `await openTaskSheet(tester, onMakeRequest: () => madeRequest++);`
- replace every `tester.widget<FilledButton>(find.byKey(const Key('start')))`,
  `tester.widget<FilledButton>(find.byKey(const Key('note-submit')))` with
  `tester.widget<WmSheetButton>(find.byKey(const Key('start')))`, `tester.widget<WmSheetButton>(find.byKey(const Key('note-submit')))`.
- in `'a changed task says what changed…'` replace
  `expect(tester.widget<FilledButton>(find.byKey(const Key('start'))).onPressed, isNull);` with
  `expect(find.byKey(const Key('start')), findsNothing, reason: "I've read this comes first: Start is not offered yet");`
  (the lock words assertion on the next line stays).
- in `'backing out of a form deletes the photo taken there'` replace `await tester.pageBack();` with
  `await tester.tap(find.byKey(const Key('wm-sheet-back')));`.

In `test/ui/home_inbox_test.dart` and `test/ui/screens_test.dart`: replace the import of
`package:workmate/workplan/ui/task_screen.dart` with `package:workmate/workplan/ui/task_sheet.dart` and every
`find.byType(TaskScreen)` with `find.byType(TaskSheet)`. In `test/ui/screens_test.dart`, in the My Work test, the
`await tester.pageBack();` right after `expect(find.byType(TaskSheet), findsOneWidget);` becomes
`await tester.binding.handlePopRoute();`.

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/workplan/ui/task_sheet_test.dart test/workplan/ui/my_work_screens_test.dart`
Expected: compile errors — `task_sheet.dart`, `TaskForm`, `openTask(..., form:)` do not exist.

- [ ] **Step 3: Implement the progress widgets**

Create `lib/workplan/ui/progress_widgets.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../domain/wp_progress.dart';

Color nextToneColor(NextTone t) => switch (t) {
      NextTone.danger => WmColors.danger,
      NextTone.brown => WmColors.brown,
      NextTone.green => WmColors.green,
      NextTone.normal => WmColors.textSecondary,
    };

/// The card's 4-part bar (Phase 2 spec §4.6).
class TaskProgressBar extends StatelessWidget {
  const TaskProgressBar({super.key, required this.progress});

  final WpProgress progress;

  @override
  Widget build(BuildContext context) => Row(children: [
        for (var i = 0; i < 4; i++) ...[
          if (i > 0) const SizedBox(width: 4),
          Expanded(
            child: Container(
              key: Key('bar-$i-${progress.reached[i] ? 'on' : 'off'}'),
              height: 4,
              decoration: BoxDecoration(
                color: progress.reached[i] ? WmColors.green : WmColors.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        ],
      ]);
}

/// The sheet's step tracker (Phase 2 spec §7). The current step's ring is red
/// or brown when the Next line is, otherwise green.
class StepTracker extends StatelessWidget {
  const StepTracker({super.key, required this.progress});

  final WpProgress progress;

  @override
  Widget build(BuildContext context) {
    final p = progress;
    final ring = switch (p.tone) {
      NextTone.danger => WmColors.danger,
      NextTone.brown => WmColors.brown,
      _ => WmColors.green,
    };
    return Container(
      key: const Key('step-tracker'),
      padding: const EdgeInsets.fromLTRB(6, 14, 6, 12),
      decoration: BoxDecoration(color: Colors.white, border: Border.all(color: WmColors.border), borderRadius: BorderRadius.circular(16)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var i = 0; i < 4; i++)
          Expanded(
            child: _Step(
              index: i,
              reached: p.reached[i],
              current: p.current == i,
              ring: ring,
              leftOn: i > 0 && p.reached[i],
              rightOn: i < 3 && p.reached[i + 1],
              extra: i == 2 && p.leaderChecked ? 'Checked by the leader' : null,
            ),
          ),
      ]),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({
    required this.index,
    required this.reached,
    required this.current,
    required this.ring,
    required this.leftOn,
    required this.rightOn,
    this.extra,
  });

  final int index;
  final bool reached;
  final bool current;
  final Color ring;
  final bool leftOn;
  final bool rightOn;
  final String? extra;

  @override
  Widget build(BuildContext context) {
    Color line(bool on, bool exists) => !exists ? Colors.transparent : (on ? WmColors.green : WmColors.border);
    final state = reached ? 'done' : (current ? 'current' : 'todo');
    final extra = this.extra;
    return Column(key: Key('step-$index-$state'), children: [
      SizedBox(
        height: 28,
        child: Stack(alignment: Alignment.center, children: [
          Row(children: [
            Expanded(child: Container(height: 2, color: line(leftOn, index > 0))),
            Expanded(child: Container(height: 2, color: line(rightOn, index < 3))),
          ]),
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: reached ? WmColors.green : Colors.white,
              border: Border.all(color: reached ? WmColors.green : (current ? ring : WmColors.border), width: 2),
            ),
            alignment: Alignment.center,
            child: reached
                ? const Icon(Icons.check, size: 16, color: Colors.white)
                : Text('${index + 1}',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: current ? ring : WmColors.textDisabled)),
          ),
        ]),
      ),
      const SizedBox(height: 6),
      Text(
        wpStepLabels[index],
        textAlign: TextAlign.center,
        style: TextStyle(
          fontSize: 12,
          height: 1.2,
          fontWeight: current ? FontWeight.w800 : FontWeight.w600,
          color: reached || current ? WmColors.text : WmColors.textDisabled,
        ),
      ),
      if (extra != null)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(extra,
              key: const Key('leader-checked'),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 11.5, height: 1.2, color: WmColors.green, fontWeight: FontWeight.w700)),
        ),
    ]);
  }
}
```

- [ ] **Step 4: Turn the report forms into sheet bodies**

In `lib/workplan/ui/report_forms.dart`:
- add `import '../../ui/wm_sheet.dart';`
- rename `NoteFormScreen` → `NoteForm` and `_NoteFormScreenState` → `_NoteFormState`; give `NoteForm` three new required
  parameters and fields:

```dart
    required this.taskTitle,
    required this.onSubmit,
    required this.onLeave,
```

```dart
  /// The task this report is about, shown above the fields.
  final String taskTitle;

  /// The worker tapped the send button: the sheet queues it. Never called on back-out.
  final ValueChanged<NoteReport> onSubmit;

  /// Back to the task (the sheet's back arrow).
  final VoidCallback onLeave;
```

- replace `_NoteFormState.build` with:

```dart
  @override
  Widget build(BuildContext context) {
    final ok = !widget.required || _text.text.trim().isNotEmpty;
    return WmSheetFrame(
      title: widget.title,
      onBack: widget.onLeave,
      tall: true,
      footer: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        WmSheetButton(
          key: const Key('note-submit'),
          label: widget.submitLabel,
          icon: Icons.send,
          onPressed: ok
              ? () {
                  _done = true;
                  widget.onSubmit((note: _text.text.trim(), photo: _photo));
                }
              : null,
        ),
        const WmSheetNote(savedOnPhoneText),
      ]),
      children: [
        Text(widget.taskTitle, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        if (widget.explain != null) ...[const SizedBox(height: 4), Text(widget.explain!, style: const TextStyle(color: WmColors.textMuted))],
        const SizedBox(height: 12),
        TextField(
          key: const Key('note-field'),
          controller: _text,
          minLines: 3,
          maxLines: 8,
          maxLength: 2000,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(labelText: widget.label),
        ),
        if (widget.allowPhoto) ...[
          const SizedBox(height: 8),
          _PhotoRow(photo: _photo, onAdd: _addPhoto, onRemove: _removePhoto, failed: _photoFailed),
        ],
      ],
    );
  }
```

- rename `ProblemFormScreen` → `ProblemForm` and `_ProblemFormScreenState` → `_ProblemFormState`; add required
  `onSubmit` (`ValueChanged<ProblemReport>`) and `onLeave` (`VoidCallback`) parameters and fields with the same
  comments as above;
- replace `_ProblemFormState.build` with:

```dart
  @override
  Widget build(BuildContext context) {
    final linkable = _kind == 'materials' || _kind == 'tool';
    final ok = _text.text.trim().isNotEmpty;
    return WmSheetFrame(
      title: 'Report a problem',
      onBack: widget.onLeave,
      tall: true,
      footer: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        WmSheetButton(
          key: const Key('problem-submit'),
          label: 'Report the problem',
          icon: Icons.send,
          onPressed: ok
              ? () {
                  _done = true;
                  widget.onSubmit((kind: _kind, description: _text.text.trim(), requestId: linkable ? _requestId : null, photo: _photo));
                }
              : null,
        ),
        const WmSheetNote(savedOnPhoneText),
      ]),
      children: [
        Text(widget.task.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        const SizedBox(height: 4),
        const Text(
          'The task waits until the office checks and clears the problem. Reporting it does not order anything.',
          style: TextStyle(color: WmColors.textMuted),
        ),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final k in wpProblemKinds)
            ChoiceChip(
              key: Key('kind-$k'),
              label: Text(problemKindLabel(k)),
              selected: _kind == k,
              onSelected: (_) => setState(() {
                _kind = k;
                if (!(k == 'materials' || k == 'tool')) _requestId = null;
              }),
            ),
        ]),
        const SizedBox(height: 12),
        TextField(
          key: const Key('problem-field'),
          controller: _text,
          minLines: 3,
          maxLines: 8,
          maxLength: 2000,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(labelText: 'What is the problem?'),
        ),
        const SizedBox(height: 8),
        _PhotoRow(photo: _photo, onAdd: _addPhoto, onRemove: _removePhoto, failed: _photoFailed),
        if (linkable) ...[
          const SizedBox(height: 16),
          const Text('Is there already a request for it?', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          FutureBuilder<List<RemoteRequest>>(
            future: _requests,
            builder: (context, snap) {
              final list = snap.data ?? const <RemoteRequest>[];
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (list.isEmpty)
                  const Text('No open request of yours for this project.', style: TextStyle(color: WmColors.textMuted))
                else
                  DropdownButtonFormField<String?>(
                    key: const Key('problem-request'),
                    initialValue: _requestId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Link to a request'),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('No link')),
                      for (final r in list)
                        DropdownMenuItem(
                          value: r.id,
                          child: Text('${r.title} · ${r.lines.length} item${r.lines.length == 1 ? '' : 's'} · ${dayMonth(r.receivedAt)}',
                              overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (v) => setState(() => _requestId = v),
                  ),
                if (widget.onMakeRequest != null)
                  TextButton.icon(
                    key: const Key('make-request'),
                    onPressed: () {
                      widget.onLeave();
                      widget.onMakeRequest!();
                    },
                    icon: const Icon(Icons.add_shopping_cart),
                    label: const Text('Make a request instead (nothing is sent yet)'),
                  ),
              ]);
            },
          ),
        ],
      ],
    );
  }
```

Keep `_takePhoto`, `_PhotoRow`, every field, `dispose` (discards an unsent photo), `_addPhoto`, `_removePhoto` and
`_loadRequests` exactly as they are.

- [ ] **Step 5: Create the task sheet**

Create `lib/workplan/ui/task_sheet.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../../ui/wm_sheet.dart';
import '../data/workplan_api.dart';
import '../domain/wp_op.dart';
import '../domain/wp_progress.dart';
import '../domain/wp_rules.dart';
import '../domain/wp_task.dart';
import '../workplan_services.dart';
import 'my_work_controller.dart';
import 'progress_widgets.dart';
import 'report_forms.dart';
import 'workplan_copy.dart';
import 'workplan_widgets.dart';

/// Which report form the task sheet shows (Phase 2 spec §8).
enum TaskForm { progress, problem, done, check }

/// One task as a tall swipe-down sheet (Phase 2 spec §7): everything the old
/// task page showed, the step tracker, and the one main action at the bottom.
/// A report form replaces the body in place; from a form, the back arrow,
/// Back, a drag down or a tap outside return to the task (PopScope), never
/// close the sheet in one move. Reads its entry from the shared controller.
class TaskSheet extends StatefulWidget {
  const TaskSheet({super.key, required this.controller, required this.services, required this.taskId, this.onMakeRequest, this.initialForm});

  final MyWorkController controller;
  final WorkPlanServices services;
  final String taskId;

  /// Opens Requests (a materials problem's shortcut); null hides it.
  final VoidCallback? onMakeRequest;

  /// Open straight on this form (a swipe button).
  final TaskForm? initialForm;

  @override
  State<TaskSheet> createState() => _TaskSheetState();
}

class _TaskSheetState extends State<TaskSheet> {
  late TaskForm? _form = widget.initialForm;

  MyWorkController get _c => widget.controller;

  void _show(TaskForm? f) => setState(() => _form = f);

  Future<void> _sendNote(TaskForm f, WpTask t, NoteReport r) async {
    _show(null);
    await _c.act((a) => switch (f) {
          TaskForm.progress => a.reportProgress(t, r.note, photo: r.photo),
          TaskForm.done => a.reportDone(t, r.note),
          TaskForm.check => a.checkWork(t, r.note),
          TaskForm.problem => throw StateError('a problem has its own form'),
        });
  }

  Future<void> _sendProblem(WpTask t, ProblemReport r) async {
    _show(null);
    await _c.act((a) => a.reportProblem(t, kind: r.kind, description: r.description, requestId: r.requestId, photo: r.photo));
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: _c,
        builder: (context, _) {
          final e = _c.entry(widget.taskId);
          // A task that left the list shows no form, so Back closes the sheet.
          final f = e == null ? null : _form;
          return PopScope(
            canPop: f == null,
            onPopInvokedWithResult: (didPop, _) {
              if (!didPop && _form != null) _show(null);
            },
            child: e == null
                ? const WmSheetFrame(title: 'Task', children: [
                    Padding(
                      key: Key('task-gone'),
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Text('This task is no longer on your list.', textAlign: TextAlign.center),
                    ),
                  ])
                : f != null
                    ? _formFor(f, e.task)
                    : WmSheetFrame(title: e.task.title, tall: true, footer: _footer(e), children: _body(e)),
          );
        },
      );

  Widget _formFor(TaskForm f, WpTask t) => switch (f) {
        TaskForm.progress => NoteForm(
            key: const ValueKey('form-progress'),
            services: widget.services,
            taskTitle: t.title,
            title: 'Report progress',
            label: 'What was done today?',
            submitLabel: 'Send progress',
            required: true,
            allowPhoto: true,
            onLeave: () => _show(null),
            onSubmit: (r) => _sendNote(f, t, r),
          ),
        TaskForm.done => NoteForm(
            key: const ValueKey('form-done'),
            services: widget.services,
            taskTitle: t.title,
            title: 'Report done',
            label: 'Anything the office should know? (optional)',
            submitLabel: 'Report done',
            explain: 'The office checks the work before it counts as completed.',
            onLeave: () => _show(null),
            onSubmit: (r) => _sendNote(f, t, r),
          ),
        TaskForm.check => NoteForm(
            key: const ValueKey('form-check'),
            services: widget.services,
            taskTitle: t.title,
            title: 'Check this work',
            label: 'Your note for the office (optional)',
            submitLabel: 'Mark as checked',
            explain: 'Your check is recorded. The office still gives the final approval.',
            onLeave: () => _show(null),
            onSubmit: (r) => _sendNote(f, t, r),
          ),
        TaskForm.problem => ProblemForm(
            key: const ValueKey('form-problem'),
            services: widget.services,
            task: t,
            onMakeRequest: widget.onMakeRequest,
            onLeave: () => _show(null),
            onSubmit: (r) => _sendProblem(t, r),
          ),
      };

  List<Widget> _body(WpEntry e) {
    final t = e.task;
    final change = t.latestChange;
    return [
      Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
        TaskPill(e),
        Text(
          [plannedLabel(t), roleLabel(t.myRole), if (t.teamName != null) 'Team ${t.teamName}', 'Version ${t.version}'].join(' · '),
          style: const TextStyle(color: WmColors.textMuted, fontSize: 13),
        ),
      ]),
      const SizedBox(height: 6),
      Text(t.where, style: const TextStyle(fontSize: 14, color: WmColors.textSecondary)),
      const SizedBox(height: 14),
      StepTracker(progress: progressOf(e)),
      const SizedBox(height: 12),
      if (e.toRead && t.changedSinceRead)
        WpBox(color: WmColors.dangerTint, border: WmColors.dangerBorder, children: [
          const Text('The office changed this task. Read it again.', style: TextStyle(fontWeight: FontWeight.w800, color: WmColors.danger)),
          if (change != null && change.isNotEmpty) ...[const SizedBox(height: 4), Text(change, style: const TextStyle(color: WmColors.danger))],
        ]),
      if (t.sentBack && t.status == WpStatus.inProgress)
        const WpBox(color: WmColors.brownTint, border: WmColors.brownTint, children: [
          Text('The office sent the work back. See the history for why.', style: TextStyle(fontWeight: FontWeight.w700, color: WmColors.brown)),
        ]),
      for (final op in e.shownFailures)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: FailureNotice(
            leadEnglish: '${opLabel(op)}: ${notAcceptedLead.english}',
            leadTagalog: notAcceptedLead.tagalog,
            english: opFailureCopy(op).english,
            tagalog: opFailureCopy(op).tagalog,
            actions: [noticeAction(dismissLabel, () => _c.dismissFailed(op))],
          ),
        ),
      for (final op in e.shownPending)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text('${opLabel(op)} · Pending sync', style: const TextStyle(color: WmColors.brown, fontWeight: FontWeight.w700)),
        ),
      WpBox(children: [
        const Text('Instructions', style: TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text(t.instructions.isEmpty ? 'No extra instructions.' : t.instructions, style: const TextStyle(fontSize: 15.5, height: 1.35)),
      ]),
      if (t.blockers.isNotEmpty || t.waitingFor.isNotEmpty)
        WpBox(children: [
          const Text('Waiting for', style: TextStyle(fontWeight: FontWeight.w800)),
          for (final b in t.blockers) ...[
            const SizedBox(height: 6),
            Text('${problemKindLabel(b.kind)}: ${b.description}', style: const TextStyle(fontWeight: FontWeight.w700)),
            Text('Reported by ${b.reportedBy}, ${dayMonth(b.reportedAt)}${b.requestId != null ? ' · linked to a request' : ''}',
                style: const TextStyle(color: WmColors.textMuted, fontSize: 13)),
          ],
          for (final w in t.waitingFor) ...[
            const SizedBox(height: 6),
            Text('Earlier task: ${w.title}', style: const TextStyle(fontWeight: FontWeight.w700)),
          ],
          const SizedBox(height: 6),
          const Text('Only the office clears these, after checking.', style: TextStyle(color: WmColors.textMuted, fontSize: 12.5)),
        ]),
      WpBox(children: [
        const Text('People', style: TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text('Responsible: ${t.responsible?.name ?? 'not chosen yet'}'),
        if (t.helpers.isNotEmpty) Text('Helpers: ${t.helpers.map((h) => h.name).join(', ')}'),
      ]),
      if (t.photos.isNotEmpty)
        WpBox(children: [
          const Text('Photos', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final p in t.photos) _TaskPhoto(key: ValueKey(p.path), api: widget.services.api, path: p.path),
          ]),
        ]),
      if (t.history.isNotEmpty)
        WpBox(children: [
          const Text('History', style: TextStyle(fontWeight: FontWeight.w800)),
          for (final h in t.history.reversed) ...[
            const SizedBox(height: 6),
            Text('${dayMonth(h.at)}, ${clockTime(h.at)} · ${h.by}', style: const TextStyle(color: WmColors.textMuted, fontSize: 12.5)),
            Text(_eventText(h)),
          ],
        ]),
    ];
  }

  /// One main action, the reason it is locked or what happens next, then the
  /// two reports this person may make (Phase 2 spec §7).
  Widget? _footer(WpEntry e) {
    final t = e.task;
    final a = actionsFor(e);
    final s = e.effectiveStatus;
    WmSheetButton? main;
    String? note;
    var warn = false;
    if (a.acknowledge) {
      main = WmSheetButton(key: const Key('ack'), label: "I'VE READ THIS", icon: Icons.done_all, onPressed: () => _c.acknowledge(t));
      if (a.start && a.startLock == WpLock.mustRead) {
        note = lockText(WpLock.mustRead);
        warn = true;
      }
    } else if (a.start) {
      final lock = a.startLock;
      main = WmSheetButton(
        key: const Key('start'),
        label: 'START WORK',
        icon: Icons.play_arrow,
        onPressed: lock == null && !e.pending(WpOpKind.start) ? () => _c.startWork(t) : null,
      );
      if (lock != null) {
        note = lockText(lock);
        warn = true;
      }
    } else if (a.done) {
      final lock = a.doneLock;
      main = WmSheetButton(key: const Key('done'), label: 'REPORT DONE', icon: Icons.task_alt, onPressed: lock == null ? () => _show(TaskForm.done) : null);
      if (lock != null) {
        note = lockText(lock);
        warn = true;
      }
    } else if (a.check) {
      main = WmSheetButton(key: const Key('check'), label: 'CHECK THIS WORK', icon: Icons.fact_check, onPressed: () => _show(TaskForm.check));
    }
    if (note == null && (s == WpStatus.reportedDone || s == WpStatus.leaderChecked)) {
      note = 'The office checks the work before it counts as completed.';
    }
    if (note == null && s == WpStatus.completed) note = 'Completed.';
    final second = <Widget>[
      if (a.progress)
        _SecondButton(key: const Key('progress'), label: 'Report progress', icon: Icons.edit_note, danger: false, onTap: () => _show(TaskForm.progress)),
      if (a.problem)
        _SecondButton(key: const Key('problem'), label: 'Report a problem', icon: Icons.report_outlined, danger: true, onTap: () => _show(TaskForm.problem)),
    ];
    if (main == null && note == null && second.isEmpty) return null;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      ?main,
      if (note != null) WmSheetNote(note, warning: warn),
      if (second.isNotEmpty)
        Padding(
          padding: EdgeInsets.only(top: main != null || note != null ? 10 : 0),
          child: Row(children: [
            for (var i = 0; i < second.length; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              Expanded(child: second[i]),
            ],
          ]),
        ),
    ]);
  }
}

class _SecondButton extends StatelessWidget {
  const _SecondButton({super.key, required this.label, required this.icon, required this.danger, required this.onTap});

  final String label;
  final IconData icon;
  final bool danger;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          foregroundColor: danger ? WmColors.danger : WmColors.green,
          backgroundColor: Colors.white,
          side: BorderSide(color: danger ? WmColors.dangerBorder : WmColors.border),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontFamily: 'Barlow', fontSize: 14.5, fontWeight: FontWeight.w800),
        ),
        icon: Icon(icon, size: 20),
        label: Text(label),
      );
}
```

Then move, unchanged, from `lib/workplan/ui/task_screen.dart` to the end of `task_sheet.dart`: the `_eventText` function
and the `_TaskPhoto` / `_TaskPhotoState` classes. Delete `lib/workplan/ui/task_screen.dart` (normal file delete).

- [ ] **Step 6: The opener opens the sheet**

Replace `lib/workplan/ui/task_openers.dart` with:

```dart
import 'package:flutter/material.dart';

import '../../ui/wm_sheet.dart';
import '../workplan_services.dart';
import 'my_work_controller.dart';
import 'task_sheet.dart';

/// Opens one task as a sheet — straight on [form] when given (a swipe
/// button) — then My Work is read again. The tab and Home's "Needs you" rows
/// both open tasks through this.
Future<void> openTask(
  BuildContext context,
  MyWorkController controller,
  WorkPlanServices services,
  String taskId, {
  VoidCallback? onMakeRequest,
  TaskForm? form,
}) async {
  await showWmSheet<void>(
    context,
    builder: (_) => TaskSheet(controller: controller, services: services, taskId: taskId, onMakeRequest: onMakeRequest, initialForm: form),
  );
  await controller.refresh();
}
```

Remove the `import 'task_screen.dart';` (or any import `flutter analyze` reports unused) from
`lib/workplan/ui/my_work_screen.dart`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `flutter test test/workplan test/ui test/home`
Expected: all pass — the rewritten task tests keep every fact they checked (lock words, blockers and earlier tasks,
start → progress with photo → report done, photo discarded on back-out, the request link limited to the worker's own
requests for this project, Make a request sends nothing, a leader's check, pending and refused actions with Dismiss).

- [ ] **Step 8: Checkpoint (no commit)** — report the files (one deleted).

---

### Task 4: The swipe-hint memory and the swipeable card

**Files:**
- Create: `lib/workplan/data/wp_hint_store.dart`
- Modify: `lib/workplan/workplan_services.dart`
- Modify: `lib/main.dart`
- Create: `lib/workplan/ui/task_card.dart`
- Create: `test/workplan/ui/task_card_test.dart`

**Interfaces:**
- Consumes: `progressOf` (Task 1), `TaskProgressBar`, `nextToneColor` (Task 3), `TaskForm` (Task 3), `TaskPill`,
  `plannedLabel`, `roleLabel`, `actionsFor`, `isLate`.
- Produces: `abstract interface class WpHintStore { bool get swipeSeen; Future<void> markSwipeSeen(); }`,
  `PrefsWpHintStore(SharedPreferences)`, `MemoryWpHintStore()`; `WorkPlanServices({…, WpHintStore? hints})`;
  `TaskCard({required WpEntry entry, required String today, required bool open, required ValueChanged<bool>
  onOpenChanged, required VoidCallback onTap, required ValueChanged<TaskForm> onReport})`; `bool canSwipe(WpEntry e)`.

- [ ] **Step 1: Write the failing tests**

Create `test/workplan/ui/task_card_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/workplan/data/wp_hint_store.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';
import 'package:workmate/workplan/ui/task_card.dart';
import 'package:workmate/workplan/ui/task_sheet.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../workplan_fakes.dart';

void main() {
  late bool open;
  late int taps;
  late List<TaskForm> reported;
  late List<bool> changes;

  setUp(() {
    open = false;
    taps = 0;
    reported = [];
    changes = [];
  });

  Future<void> show(WidgetTester tester, Map<String, dynamic> doc) async {
    useTallPhone(tester);
    final e = WpEntry(task: task0(doc));
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: StatefulBuilder(
          builder: (context, setState) => ListView(padding: const EdgeInsets.all(20), children: [
            TaskCard(
              key: const Key('task-t1'),
              entry: e,
              today: '2026-10-14',
              open: open,
              onOpenChanged: (o) => setState(() {
                changes.add(o);
                open = o;
              }),
              onTap: () => taps++,
              onReport: reported.add,
            ),
          ]),
        ),
      ),
    ));
    await tester.pumpAndSettle();
  }

  final card = find.byKey(const Key('task-t1'));

  testWidgets('a responsible person in progress: a swipe past 64 px shows Progress and Problem', (tester) async {
    await show(tester, taskDoc(ackVersion: 1, status: 'in_progress'));
    await tester.timedDrag(card, const Offset(-120, 0), const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(open, isTrue);
    await tester.tap(find.byKey(const Key('swipe-progress-t1')));
    await tester.pumpAndSettle();
    expect(reported, [TaskForm.progress]);
    expect(open, isFalse, reason: 'the card closes as the form opens');
  });

  testWidgets('a short swipe springs back', (tester) async {
    await show(tester, taskDoc(ackVersion: 1, status: 'in_progress'));
    await tester.timedDrag(card, const Offset(-40, 0), const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(open, isFalse);
  });

  testWidgets('a helper sees only Problem', (tester) async {
    await show(tester, taskDoc(role: 'helper', ackVersion: 1, status: 'in_progress'));
    expect(find.byKey(const Key('swipe-progress-t1')), findsNothing);
    expect(find.byKey(const Key('swipe-problem-t1')), findsOneWidget);
    expect(canSwipe(WpEntry(task: task0(taskDoc(role: 'helper', ackVersion: 1, status: 'in_progress')))), isTrue);
  });

  testWidgets('a completed task does not move; a tap opens it', (tester) async {
    await show(tester, taskDoc(ackVersion: 1, status: 'completed'));
    expect(find.byKey(const Key('swipe-problem-t1')), findsNothing);
    await tester.timedDrag(card, const Offset(-120, 0), const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(changes, isEmpty);
    await tester.tap(card);
    expect(taps, 1);
  });

  testWidgets('a tap on an open card closes it instead of opening the task', (tester) async {
    await show(tester, taskDoc(ackVersion: 1, status: 'in_progress'));
    await tester.timedDrag(card, const Offset(-120, 0), const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    await tester.tapAt(tester.getTopLeft(card) + const Offset(30, 30));
    await tester.pumpAndSettle();
    expect([open, taps], [false, 0]);
  });

  testWidgets('the 4-part bar and the Next line', (tester) async {
    await show(tester, taskDoc(ackVersion: 1, status: 'in_progress'));
    for (final k in ['bar-0-on', 'bar-1-on', 'bar-2-off', 'bar-3-off']) {
      expect(find.byKey(Key(k)), findsOneWidget, reason: k);
    }
    expect(find.text('Next: report done'), findsOneWidget);
    expect(find.text('Wall prep'), findsOneWidget);
  });

  test('the swipe hint is remembered on the phone', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final a = PrefsWpHintStore(prefs);
    expect(a.swipeSeen, isFalse);
    await a.markSwipeSeen();
    expect(PrefsWpHintStore(prefs).swipeSeen, isTrue);
    final m = MemoryWpHintStore();
    await m.markSwipeSeen();
    expect(m.swipeSeen, isTrue);
  });
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `flutter test test/workplan/ui/task_card_test.dart`
Expected: compile error — `task_card.dart` and `wp_hint_store.dart` do not exist.

- [ ] **Step 3: Implement the hint store and wire it**

Create `lib/workplan/data/wp_hint_store.dart`:

```dart
import 'package:shared_preferences/shared_preferences.dart';

/// Remembers, per phone, that the worker has swiped a My Work card once, so
/// the hint stops showing (Phase 2 spec §4.5). Not per account: it teaches a
/// gesture, it holds no work data.
abstract interface class WpHintStore {
  bool get swipeSeen;
  Future<void> markSwipeSeen();
}

class PrefsWpHintStore implements WpHintStore {
  PrefsWpHintStore(this._prefs);

  static const key = 'wm.mywork.swipeHintSeen';
  final SharedPreferences _prefs;

  @override
  bool get swipeSeen => _prefs.getBool(key) ?? false;

  @override
  Future<void> markSwipeSeen() async {
    await _prefs.setBool(key, true);
  }
}

/// In memory: tests, or no settings file.
class MemoryWpHintStore implements WpHintStore {
  bool _seen = false;

  @override
  bool get swipeSeen => _seen;

  @override
  Future<void> markSwipeSeen() async => _seen = true;
}
```

In `lib/workplan/workplan_services.dart`: add `import 'data/wp_hint_store.dart';`, the constructor parameter
`this.hints` after `this.requests`, and the field:

```dart
  /// Remembers that the swipe hint was seen; null keeps it for this screen only.
  final WpHintStore? hints;
```

In `lib/main.dart`: add `import 'workplan/data/wp_hint_store.dart';` and change
`workPlan = WorkPlanServices(api: repo, changed: queueSettled, requests: requests?.api);` to
`workPlan = WorkPlanServices(api: repo, changed: queueSettled, requests: requests?.api, hints: PrefsWpHintStore(prefs));`.

- [ ] **Step 4: Implement the card**

Create `lib/workplan/ui/task_card.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../domain/wp_progress.dart';
import '../domain/wp_rules.dart';
import 'progress_widgets.dart';
import 'task_sheet.dart';
import 'workplan_copy.dart';
import 'workplan_widgets.dart';

/// The reports a swipe reveals for this person (Phase 2 spec §6).
List<TaskForm> swipeForms(WpEntry e) {
  final a = actionsFor(e);
  return [if (a.progress) TaskForm.progress, if (a.problem) TaskForm.problem];
}

bool canSwipe(WpEntry e) => swipeForms(e).isNotEmpty;

/// Let go past this (logical px to the left) and the buttons stay open.
const _snapOpen = 64.0;

/// One My Work card (spec §4.6 and §6): the task, its 4-part bar and Next
/// line. Swiping left reveals the reports this person may make; a button only
/// opens that form — nothing is ever sent from here. The screen decides which
/// card is open, one at a time.
class TaskCard extends StatefulWidget {
  const TaskCard({
    super.key,
    required this.entry,
    required this.today,
    required this.open,
    required this.onOpenChanged,
    required this.onTap,
    required this.onReport,
  });

  final WpEntry entry;

  /// Manila's calendar date ("2026-10-14"), for "Late".
  final String today;

  /// This card's buttons are showing.
  final bool open;
  final ValueChanged<bool> onOpenChanged;
  final VoidCallback onTap;

  /// A revealed button was tapped: open the task on that form.
  final ValueChanged<TaskForm> onReport;

  @override
  State<TaskCard> createState() => _TaskCardState();
}

class _TaskCardState extends State<TaskCard> {
  /// The finger's offset while dragging; null when not dragging.
  double? _drag;

  List<TaskForm> get _forms => swipeForms(widget.entry);
  double get _max => _forms.isEmpty ? 0 : 6.0 + _forms.length * 76;
  double get _offset => _drag ?? (widget.open ? -_max : 0);

  void _update(DragUpdateDetails d) => setState(() => _drag = (_offset + d.delta.dx).clamp(-_max, 0).toDouble());

  void _end(DragEndDetails d) {
    final drag = _drag;
    if (drag == null) return;
    setState(() => _drag = null);
    final open = drag < -_snapOpen;
    if (open != widget.open) widget.onOpenChanged(open);
  }

  void _tap() {
    if (widget.open) {
      widget.onOpenChanged(false);
      return;
    }
    widget.onTap();
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.entry;
    final t = e.task;
    final p = progressOf(e);
    final late = isLate(e, widget.today);
    final forms = _forms;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(children: [
          if (forms.isNotEmpty)
            Positioned.fill(
              child: Align(
                alignment: Alignment.centerRight,
                child: Padding(
                  padding: const EdgeInsets.all(6),
                  child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    for (var i = 0; i < forms.length; i++) ...[
                      if (i > 0) const SizedBox(width: 6),
                      _SwipeButton(
                        form: forms[i],
                        taskId: t.id,
                        onTap: () {
                          widget.onOpenChanged(false);
                          widget.onReport(forms[i]);
                        },
                      ),
                    ],
                  ]),
                ),
              ),
            ),
          AnimatedContainer(
            duration: _drag == null ? const Duration(milliseconds: 220) : Duration.zero,
            curve: const Cubic(0.2, 0.8, 0.2, 1),
            transform: Matrix4.translationValues(_offset, 0, 0),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: _tap,
              onHorizontalDragUpdate: forms.isEmpty ? null : _update,
              onHorizontalDragEnd: forms.isEmpty ? null : _end,
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: (e.toRead || e.toCheck) ? WmColors.danger : WmColors.border),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(child: Text(t.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, height: 1.25))),
                    const SizedBox(width: 8),
                    TaskPill(e),
                  ]),
                  const SizedBox(height: 4),
                  Text(t.where, style: const TextStyle(color: WmColors.textMuted, fontSize: 13)),
                  const SizedBox(height: 2),
                  Text(
                    '${plannedLabel(t)} · ${roleLabel(t.myRole)}${late ? ' · Late' : ''}',
                    style: TextStyle(
                      fontSize: 13,
                      color: late ? WmColors.danger : WmColors.textSecondary,
                      fontWeight: late ? FontWeight.w700 : FontWeight.w400,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TaskProgressBar(progress: p),
                  const SizedBox(height: 7),
                  Text(p.next, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: nextToneColor(p.tone))),
                ]),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _SwipeButton extends StatelessWidget {
  const _SwipeButton({required this.form, required this.taskId, required this.onTap});

  final TaskForm form;
  final String taskId;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final progress = form == TaskForm.progress;
    return SizedBox(
      width: 70,
      child: Material(
        key: Key(progress ? 'swipe-progress-$taskId' : 'swipe-problem-$taskId'),
        color: progress ? WmColors.greenTint : WmColors.dangerTint,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(progress ? Icons.edit_note : Icons.report_outlined, size: 22, color: progress ? WmColors.green : WmColors.danger),
            const SizedBox(height: 4),
            Text(progress ? 'Progress' : 'Problem',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: progress ? WmColors.green : WmColors.danger)),
          ]),
        ),
      ),
    );
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `flutter test test/workplan`
Expected: all pass.

- [ ] **Step 6: Checkpoint (no commit)** — report the 5 files.

---

### Task 5: The My Work tab

**Files:**
- Modify: `lib/workplan/ui/my_work_screen.dart`
- Modify: `test/workplan/ui/my_work_screens_test.dart` (the first test, and new tests)
- Modify: `test/ui/screens_test.dart` (`'TODAY · 1'`)

**Interfaces:**
- Consumes: `TaskCard`, `canSwipe` (Task 4), `openTask(..., form:)`, `TaskForm` (Task 3), `WpHintStore` via
  `WorkPlanServices.hints` (Task 4), `showNotesSheet` (Phase 1).
- Produces: `MyWorkScreen` (same constructor: `controller`, `services`, `isLeader`, `onMakeRequest`), now stateful.

- [ ] **Step 1: Write the failing tests**

In `test/workplan/ui/my_work_screens_test.dart` replace the first test (`'My Work: sections, what needs the worker
first, notes; no proposals for a worker'`) with:

```dart
  testWidgets('My Work: chips with counts, Today first, notes; no proposals for a worker', (tester) async {
    api.view = viewOf([
      taskDoc(id: 't1', title: 'Skim coat', ackVersion: null),
      taskDoc(id: 't2', title: 'Cabinets', ackVersion: 1, start: '2026-10-20', end: '2026-10-21'),
      taskDoc(id: 't3', title: 'Garage', ackVersion: 1, blocked: true),
    ]);
    await open(tester, MyWorkScreen(controller: controller, services: services, isLeader: false));
    for (final (chip, n) in [('chip-today', '1'), ('chip-upcoming', '1'), ('chip-waiting', '1'), ('chip-done', '0')]) {
      expect(find.descendant(of: find.byKey(Key(chip)), matching: find.text(n)), findsOneWidget, reason: chip);
    }
    expect(find.text('Skim coat'), findsOneWidget, reason: 'Today is selected when the tab opens');
    expect(find.text('Cabinets'), findsNothing);
    expect(find.text('New'), findsOneWidget);
    expect(find.text('Next: read the task'), findsOneWidget);
    await tester.tap(find.byKey(const Key('chip-upcoming')));
    await tester.pumpAndSettle();
    expect(find.text('Cabinets'), findsOneWidget);
    expect(find.text('Skim coat'), findsNothing);
    await tester.tap(find.byKey(const Key('chip-done')));
    await tester.pumpAndSettle();
    expect(find.text('No tasks here right now.'), findsOneWidget);
    expect(find.text('Meeting notes (1)'), findsOneWidget);
    expect(find.byKey(const Key('open-proposals')), findsNothing);
    await tester.tap(find.byKey(const Key('open-notes')));
    await tester.pumpAndSettle();
    expect(find.text('Skim coat first, then cabinets.'), findsOneWidget);
  });

  testWidgets('a swipe opens the task on that form and sends nothing; the hint goes and stays gone', (tester) async {
    final hints = MemoryWpHintStore();
    services = WorkPlanServices(api: api, takePhoto: (_) async => '/raw/shot.jpg', hints: hints);
    api.view = viewOf([taskDoc(ackVersion: 1, status: 'in_progress')]);
    await open(tester, MyWorkScreen(controller: controller, services: services, isLeader: false));
    expect(find.byKey(const Key('swipe-hint')), findsOneWidget);
    await tester.timedDrag(find.byKey(const Key('task-t1')), const Offset(-120, 0), const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('swipe-hint')), findsNothing);
    expect(hints.swipeSeen, isTrue);
    await tester.tap(find.byKey(const Key('swipe-problem-t1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('problem-field')), findsOneWidget, reason: 'the sheet opened on Report a problem');
    expect(api.calls, isEmpty, reason: 'nothing is sent by a swipe');
    await tester.binding.handlePopRoute(); // form → task
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute(); // task → closed
    await tester.pumpAndSettle();
    // A fresh screen (new state), as when the tab is opened again: only the store remembers.
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(wrap(MyWorkScreen(controller: controller, services: services, isLeader: false)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('swipe-hint')), findsNothing, reason: 'remembered');
  });

  testWidgets('a tap on a card opens the task sheet', (tester) async {
    api.view = viewOf([taskDoc(ackVersion: 1, status: 'in_progress')]);
    await open(tester, MyWorkScreen(controller: controller, services: services, isLeader: false));
    await tester.tap(find.byKey(const Key('task-t1')));
    await tester.pumpAndSettle();
    expect(find.byType(TaskSheet), findsOneWidget);
  });
```

Add imports `package:workmate/workplan/data/wp_hint_store.dart` and `package:workmate/workplan/ui/task_sheet.dart`.

In `test/ui/screens_test.dart`, in the My Work test, replace `expect(find.text('TODAY · 1'), findsOneWidget);` with
`expect(find.descendant(of: find.byKey(const Key('chip-today')), matching: find.text('1')), findsOneWidget);`.

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/workplan/ui/my_work_screens_test.dart`
Expected: FAIL — no `chip-…`, `swipe-hint` or swipe buttons yet.

- [ ] **Step 3: Implement**

Replace `lib/workplan/ui/my_work_screen.dart` with:

```dart
import 'dart:async';

import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../domain/wp_rules.dart';
import '../workplan_services.dart';
import 'my_work_controller.dart';
import 'notes_sheet.dart';
import 'proposals_screen.dart';
import 'task_card.dart';
import 'task_openers.dart';
import 'task_sheet.dart';
import 'workplan_copy.dart';

/// The My Work tab (spec §12; redesign Phase 2): chips with counts, cards with
/// a 4-step bar and a Next line, a swipe-left shortcut to the reports, shared
/// meeting notes and — for a team leader — their own proposals.
class MyWorkScreen extends StatefulWidget {
  const MyWorkScreen({
    super.key,
    required this.controller,
    required this.services,
    required this.isLeader,
    this.onMakeRequest,
  });

  final MyWorkController controller;
  final WorkPlanServices services;

  /// The profile role is teamLeader: show My proposals. (Which teams they
  /// currently lead, the server decides.)
  final bool isLeader;

  /// Opens Requests (a materials problem's shortcut); null hides it.
  final VoidCallback? onMakeRequest;

  @override
  State<MyWorkScreen> createState() => _MyWorkScreenState();
}

const _chipLabels = {WpGroup.today: 'Today', WpGroup.upcoming: 'Upcoming', WpGroup.waiting: 'Waiting', WpGroup.done: 'Done'};

class _MyWorkScreenState extends State<MyWorkScreen> {
  WpGroup _chip = WpGroup.today;
  String? _openId;
  late bool _hintSeen = widget.services.hints?.swipeSeen ?? false;

  Future<void> _open(String taskId, {TaskForm? form}) =>
      openTask(context, widget.controller, widget.services, taskId, onMakeRequest: widget.onMakeRequest, form: form);

  void _openChanged(String id, bool open) {
    setState(() {
      _openId = open ? id : (_openId == id ? null : _openId);
      if (open) _hintSeen = true;
    });
    if (open) unawaited(widget.services.hints?.markSwipeSeen() ?? Future<void>.value());
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: widget.controller,
        builder: (context, _) {
          final c = widget.controller;
          final view = c.view;
          final failure = c.failure;
          final updates = c.updates;
          final rows = c.group(_chip);
          return RefreshIndicator(
            onRefresh: c.refresh,
            child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(20, 16, 20, 28), children: [
              const Text('My Work', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
              const SizedBox(height: 2),
              const Text('Your tasks from the office. Read each one, then report as you work.',
                  style: TextStyle(fontSize: 14, color: WmColors.textMuted)),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                _PillButton(
                  key: const Key('open-notes'),
                  icon: Icons.forum_outlined,
                  label: 'Meeting notes (${view.notes.length})',
                  onTap: () => showNotesSheet(context, c),
                ),
                if (widget.isLeader)
                  _PillButton(
                    key: const Key('open-proposals'),
                    icon: Icons.lightbulb_outline,
                    label: 'My proposals',
                    onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ProposalsScreen(controller: c))),
                  ),
              ]),
              const SizedBox(height: 12),
              if (failure != null) ...[
                if (view.fetchedAt != null)
                  Text(
                    'No signal: showing what this phone saved on ${dayMonth(view.fetchedAt!)}, ${clockTime(view.fetchedAt!)}. Pull down to try again.',
                    style: const TextStyle(fontSize: 12.5, color: WmColors.brown),
                  )
                else
                  FailureNotice(
                    english: wpFailureCopy(failure).english,
                    tagalog: wpFailureCopy(failure).tagalog,
                    actions: [noticeAction(retryLabel, c.refresh)],
                  ),
                const SizedBox(height: 12),
              ],
              for (final op in visibleFailures(view.otherFailed))
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: FailureNotice(
                    leadEnglish: '${opLabel(op)}: ${notAcceptedLead.english}',
                    leadTagalog: notAcceptedLead.tagalog,
                    english: opFailureCopy(op).english,
                    tagalog: opFailureCopy(op).tagalog,
                    actions: [noticeAction(dismissLabel, () => c.dismissFailed(op))],
                  ),
                ),
              if (updates.pending > 0)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    '${updates.pending} action${updates.pending == 1 ? '' : 's'} saved on this phone, waiting for signal.',
                    style: const TextStyle(color: WmColors.brown, fontWeight: FontWeight.w600),
                  ),
                ),
              if (c.loading && view.entries.isEmpty) const Padding(padding: EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator())),
              if (!c.loading && view.entries.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 32),
                  child: Text('No tasks for you right now.', textAlign: TextAlign.center, style: TextStyle(color: WmColors.textMuted)),
                ),
              if (view.entries.isNotEmpty) ...[
                const SizedBox(height: 4),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(children: [
                    for (final g in WpGroup.values) ...[
                      if (g != WpGroup.values.first) const SizedBox(width: 8),
                      _Chip(
                        key: Key('chip-${g.name}'),
                        label: _chipLabels[g]!,
                        count: c.group(g).length,
                        selected: g == _chip,
                        onTap: () => setState(() {
                          _chip = g;
                          _openId = null;
                        }),
                      ),
                    ],
                  ]),
                ),
                if (!_hintSeen && rows.any(canSwipe))
                  const Padding(
                    key: Key('swipe-hint'),
                    padding: EdgeInsets.only(top: 12),
                    child: Row(children: [
                      Icon(Icons.swipe_left, size: 18, color: WmColors.textMuted),
                      SizedBox(width: 6),
                      Expanded(
                        child: Text('Swipe a task left to report progress or a problem.',
                            style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
                      ),
                    ]),
                  ),
                const SizedBox(height: 12),
                if (rows.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 32),
                    child: Text('No tasks here right now.', textAlign: TextAlign.center, style: TextStyle(color: WmColors.textMuted)),
                  ),
                for (final e in rows)
                  TaskCard(
                    key: Key('task-${e.task.id}'),
                    entry: e,
                    today: c.today,
                    open: _openId == e.task.id,
                    onOpenChanged: (o) => _openChanged(e.task.id, o),
                    onTap: () => _open(e.task.id),
                    onReport: (f) => _open(e.task.id, form: f),
                  ),
              ],
            ]),
          );
        },
      );
}

class _PillButton extends StatelessWidget {
  const _PillButton({super.key, required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        shape: const StadiumBorder(side: BorderSide(color: WmColors.border)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Container(
            height: 40,
            padding: const EdgeInsets.fromLTRB(10, 0, 14, 0),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 20, color: WmColors.green),
              const SizedBox(width: 6),
              Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: WmColors.green)),
            ]),
          ),
        ),
      );
}

class _Chip extends StatelessWidget {
  const _Chip({super.key, required this.label, required this.count, required this.selected, required this.onTap});

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: selected ? WmColors.text : Colors.white,
        shape: StadiumBorder(side: BorderSide(color: selected ? WmColors.text : WmColors.border)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Container(
            height: 38,
            padding: const EdgeInsets.fromLTRB(16, 0, 8, 0),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: selected ? Colors.white : WmColors.textSecondary)),
              const SizedBox(width: 8),
              Container(
                constraints: const BoxConstraints(minWidth: 22, minHeight: 22),
                padding: const EdgeInsets.symmetric(horizontal: 6),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected ? const Color(0x33FFFFFF) : WmColors.inert,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Text('$count',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, height: 1, color: selected ? Colors.white : WmColors.textSecondary)),
              ),
            ]),
          ),
        ),
      );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/workplan test/ui test/home`
Expected: all pass.

- [ ] **Step 5: Checkpoint (no commit)** — report the 3 files.

---

### Task 6: Version and the full check

**Files:**
- Modify: `pubspec.yaml`

- [ ] **Step 1:** In `pubspec.yaml` change `version: 0.12.1+1016` to `version: 0.13.0+1017`.
- [ ] **Step 2:** Run `flutter analyze` → `No issues found!` (fix only unused imports, and say which).
- [ ] **Step 3:** Run `flutter test` → report the final line and the count (1239 before Phase 2; none deleted).
- [ ] **Step 4:** Map each spec §12 acceptance item to a passing test (real names and files):

| # | Acceptance | Test |
|---|---|---|
| 1 | Today first, chip counts, switching | `my_work_screens_test`: chips with counts |
| 2 | 4-part bar + Next line | `task_card_test`: the 4-part bar; `wp_progress_test` |
| 3 | Changed task: step 1 empty, read first | `wp_progress_test`: changed after reading; `my_work_screens_test`: a changed task |
| 4 | Leader check line; approved fills step 4 | `task_sheet_test`: checked by the leader; `wp_progress_test`: approved |
| 5 | Swipe buttons by role; nothing sent | `task_card_test`: responsible / helper / completed; `my_work_screens_test`: a swipe … sends nothing |
| 6 | Sheet shows everything; main button + lock note | `my_work_screens_test`: changed / blocked / pending-refused; `task_sheet_test`: completed |
| 7 | Forms in the sheet; Back returns; Send → Pending | `task_sheet_test`: from a form, Back …; `my_work_screens_test`: Start, then progress … |
| 8 | Home's Read / Check rows open the sheet | `home_inbox_test`: Read opens that task; leader Check row |
| 9 | Meeting notes no signal | `notes_sheet_test`: no signal … |
| 10 | Tests + analyzer | Steps 2–3 |

- [ ] **Step 5: Hand over (no commit, no build, no pilot)** — report files changed per task, the test count, the analyze
  result, and that the APK build, the phone pilot and publishing build 1017 each need their own approval.
