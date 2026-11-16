# WorkMate Redesign Phase 3 (Requests) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Requests tab gets chips with counts and cards with a 3-part bar (Saved · Sent · Received) and a status
line; a request's details become a tall swipe-down sheet — with every existing field, action and server call unchanged.

**Architecture:** My Work's chip, pill and edge-to-edge chip row move to one shared file (`lib/ui/wm_chips.dart`) that
both tabs use. A pure table (`request_stage.dart`) maps each request state to its bar colours and status line. The
details page becomes `RequestSheet` inside the Phase 1 `WmSheet`; the shared opener opens it. New request and the item
editor are not touched.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, Material 3, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-11-12-workmate-redesign-phase3-requests-design.md` (Dacs Web repo). Read it with
this plan; where they differ, the spec wins.

## Global Constraints

- Repository: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`, base `main` at `5eddf94` (0.13.1+1018, published).
  Run every command from that folder.
- **Never run `git commit`, `git push`, `git add`, `git stash`, `git checkout`, `git restore`, `git rm`, `git reset` or
  `git clean`.** The user commits by hand. Delete files with a normal file delete.
- **Never run `dart format`** (no page width is set; it would reflow ~150-column files).
- **No server change.** Every `RequestsApi` call, the offline queue, the filter rules of `RequestsController.rows`,
  `ComposeScreen` and `ItemEditorScreen` stay exactly as they are.
- Bar segments read **Saved · Sent · Received**. Status lines exactly: "Not sent yet · finish and send"; "Saved on this
  phone · sends when there is signal"; "Received by the office"; "Needs attention · open it to see why" (failed and
  needs resolution); "Cancelled". No segment animates.
- Every word on the old details page stays (line texts, dialogs, refusal notices "Edit and send again · I-edit at
  ipadala ulit" / "Dismiss · Isara", "This request is no longer on the list.").
- Keys kept: `new-request`, `find-previous`, `filter-all`, `filter-drafts`, `filter-pending`, `filter-attention`,
  `entry-<key>`, `line-<id>`, `change-<id>`, `cancel-<id>`, `line-from-stock-<id>`, `cancel-request`,
  `confirm-cancel`, `qty-field`, `qty-save`, `send-request`, My Work's `chip-<group>`, `open-notes`, `open-proposals`.
  New keys: `stage-seg-0|1|2`, `request-status`, `request-sheet`, `request-gone`.
- **Never delete a test to make the suite pass**: a test of the old page is rewritten to assert the same fact in the
  sheet (each task says where).
- Finish with `flutter test` passing and `flutter analyze` reporting `No issues found!`. Version after Phase 3:
  `0.14.0+1019`.

**Rulings made while planning (the user should know):**
- The request card gets a real tap ripple (white `Material` + `InkWell`, as the Phase 2 card fix did); the old card's
  `InkWell` sat under an opaque `Container`, so its ripple never showed.
- The details sheet asks for a fresh copy when it opens (as Meeting notes do), because the old page's pull-down
  refresh has no place in a sheet; the list is read again when it closes, as today.

---

### Task 1: Shared chips and pill (`lib/ui/wm_chips.dart`)

**Files:**
- Create: `lib/ui/wm_chips.dart`
- Create: `test/ui/wm_chips_test.dart`
- Modify: `lib/workplan/ui/my_work_screen.dart` (use the shared pieces; delete `_PillButton` and `_Chip`)

**Interfaces:**
- Produces: `WmCountChip({Key? key, required String label, required int count, required bool selected, required
  VoidCallback onTap})`; `WmPillButton({Key? key, required IconData icon, required String label, required VoidCallback?
  onTap, bool busy = false})`; `WmChipRow({Key? key, required List<Widget> children})`.

- [ ] **Step 1: Write the failing test**

Create `test/ui/wm_chips_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/ui/wm_chips.dart';

void main() {
  Widget page(Widget child) => MaterialApp(
        theme: workMateTheme(),
        home: Scaffold(body: ListView(padding: const EdgeInsets.symmetric(horizontal: 20), children: [child])),
      );

  Color materialColor(WidgetTester tester, String key) =>
      tester.widget<Material>(find.descendant(of: find.byKey(Key(key)), matching: find.byType(Material)).first).color!;

  testWidgets('a count chip shows its label and count; the selected one is dark', (tester) async {
    var taps = 0;
    await tester.pumpWidget(page(Row(children: [
      WmCountChip(key: const Key('a'), label: 'Today', count: 3, selected: true, onTap: () => taps++),
      WmCountChip(key: const Key('b'), label: 'Done', count: 0, selected: false, onTap: () {}),
    ])));
    expect(find.descendant(of: find.byKey(const Key('a')), matching: find.text('3')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('b')), matching: find.text('Done')), findsOneWidget);
    expect(materialColor(tester, 'a'), WmColors.text);
    expect(materialColor(tester, 'b'), Colors.white);
    await tester.tap(find.byKey(const Key('a')));
    expect(taps, 1);
  });

  testWidgets('a pill button taps; a busy one shows a spinner and ignores taps', (tester) async {
    var taps = 0;
    await tester.pumpWidget(page(WmPillButton(key: const Key('p'), icon: Icons.history, label: 'Find previous item', onTap: () => taps++)));
    await tester.tap(find.byKey(const Key('p')));
    expect(taps, 1);
    await tester.pumpWidget(page(WmPillButton(key: const Key('p'), icon: Icons.history, label: 'Find previous item', onTap: () => taps++, busy: true)));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byIcon(Icons.history), findsNothing);
    await tester.tap(find.byKey(const Key('p')));
    expect(taps, 1);
  });

  testWidgets('the chip row runs to the screen edges; its first chip lines up with the page padding', (tester) async {
    await tester.pumpWidget(page(WmChipRow(children: [
      for (var i = 0; i < 6; i++) WmCountChip(key: Key('c$i'), label: 'Chip $i', count: i, selected: i == 0, onTap: () {}),
    ])));
    expect(tester.getTopLeft(find.byKey(const Key('c0'))).dx, 20);
    expect(tester.getSize(find.byType(SingleChildScrollView)).width, tester.view.physicalSize.width / tester.view.devicePixelRatio);
    expect(tester.getTopLeft(find.byKey(const Key('c1'))).dx - tester.getTopRight(find.byKey(const Key('c0'))).dx, 8);
  });
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `flutter test test/ui/wm_chips_test.dart`
Expected: compile error — `package:workmate/ui/wm_chips.dart` does not exist.

- [ ] **Step 3: Implement**

Create `lib/ui/wm_chips.dart`:

```dart
import 'package:flutter/material.dart';

import 'theme.dart';

/// A filter chip with a count. My Work (Today · Upcoming · Waiting · Done) and
/// Requests (All · Drafts · Pending sync · Needs attention) both use it, so the
/// two tabs cannot drift apart (redesign Phase 3 spec §7).
class WmCountChip extends StatelessWidget {
  const WmCountChip({super.key, required this.label, required this.count, required this.selected, required this.onTap});

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

/// A white rounded button with a green icon and label (Meeting notes, My
/// proposals, Find previous item). [busy] shows a spinner and ignores taps.
class WmPillButton extends StatelessWidget {
  const WmPillButton({super.key, required this.icon, required this.label, required this.onTap, this.busy = false});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        shape: const StadiumBorder(side: BorderSide(color: WmColors.border)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: busy ? null : onTap,
          child: Container(
            height: 40,
            padding: const EdgeInsets.fromLTRB(10, 0, 14, 0),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              if (busy)
                const SizedBox(width: 20, height: 20, child: Padding(padding: EdgeInsets.all(2), child: CircularProgressIndicator(strokeWidth: 2)))
              else
                Icon(icon, size: 20, color: WmColors.green),
              const SizedBox(width: 6),
              Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: WmColors.green)),
            ]),
          ),
        ),
      );
}

/// One horizontal row of chips that runs to the screen edges while its first
/// chip lines up with the page's 20-px side padding. Put it straight into a
/// list whose side padding is 20.
class WmChipRow extends StatelessWidget {
  const WmChipRow({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 38,
        child: LayoutBuilder(
          builder: (context, box) => OverflowBox(
            maxWidth: box.maxWidth + 40,
            minWidth: box.maxWidth + 40,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(children: [
                for (var i = 0; i < children.length; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  children[i],
                ],
              ]),
            ),
          ),
        ),
      );
}
```

In `lib/workplan/ui/my_work_screen.dart`:
- add `import '../../ui/wm_chips.dart';`
- replace both `_PillButton(` with `WmPillButton(` (the arguments stay the same);
- replace the whole chip block — from `SizedBox(` with `height: 38,` down to its closing `),` (the `SizedBox` →
  `LayoutBuilder` → `OverflowBox` → `SingleChildScrollView` → `Row` that holds `for (final g in WpGroup.values)`) — with:

```dart
                WmChipRow(children: [
                  for (final g in WpGroup.values)
                    WmCountChip(
                      key: Key('chip-${g.name}'),
                      label: _chipLabels[g]!,
                      count: c.group(g).length,
                      selected: g == _chip,
                      onTap: () => setState(() {
                        _chip = g;
                        _openId = null;
                      }),
                    ),
                ]),
```

- delete the classes `_PillButton` and `_Chip` at the end of the file.

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/ui/wm_chips_test.dart test/workplan`
Expected: all pass (My Work's chip, hint and swipe tests unchanged).

- [ ] **Step 5: Checkpoint (no commit)** — report the 3 files.

---

### Task 2: The stage table and the filter counts

**Files:**
- Create: `lib/requests/ui/request_stage.dart`
- Create: `test/requests/ui/request_stage_test.dart`
- Modify: `lib/requests/list/requests_controller.dart` (add `count`)
- Modify: `test/requests/list/requests_controller_test.dart` (one new test)

**Interfaces:**
- Consumes: `SyncState` (`lib/requests/domain/request_status.dart`), `RequestEntry` (`lib/requests/data/requests_api.dart`;
  `state`, `remote` with `mine`, `draft`).
- Produces: `class RequestStage { List<Color> segments; IconData icon; String line; Color color; }`;
  `const requestStageLabels = ['Saved', 'Sent', 'Received']`; `RequestStage stageOf(SyncState s)`;
  `bool needsMe(RequestEntry e)`; widgets `RequestStageBar(RequestStage stage)` (segment keys `stage-seg-0|1|2`) and
  `RequestStageLine(RequestStage stage, {double size = 13, double iconSize = 17})`;
  `int RequestsController.count(RequestFilter f)`.

- [ ] **Step 1: Write the failing tests**

Create `test/requests/ui/request_stage_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/requests/ui/request_stage.dart';
import 'package:workmate/ui/theme.dart';

import '../domain/request_models_test.dart' show requestDoc;

void main() {
  test('the bar reads Saved · Sent · Received', () {
    expect(requestStageLabels, ['Saved', 'Sent', 'Received']);
  });

  test('each state: segments, icon, words, colour (spec §5)', () {
    final rows = {
      SyncState.draft: ([WmColors.textMuted, WmColors.border, WmColors.border], Icons.edit_note, 'Not sent yet · finish and send', WmColors.textSecondary),
      SyncState.pending: ([WmColors.green, WmColors.brown, WmColors.border], Icons.cloud_off, 'Saved on this phone · sends when there is signal', WmColors.brown),
      SyncState.received: ([WmColors.green, WmColors.green, WmColors.green], Icons.check_circle, 'Received by the office', WmColors.green),
      SyncState.failed: ([WmColors.green, WmColors.danger, WmColors.border], Icons.report, 'Needs attention · open it to see why', WmColors.danger),
      SyncState.needsResolution: ([WmColors.green, WmColors.danger, WmColors.border], Icons.report, 'Needs attention · open it to see why', WmColors.danger),
      SyncState.cancelled: ([WmColors.textDisabled, WmColors.textDisabled, WmColors.textDisabled], Icons.block, 'Cancelled', WmColors.textMuted),
    };
    expect(rows.keys.toSet(), SyncState.values.toSet(), reason: 'every state has a row');
    for (final MapEntry(key: s, value: (segs, icon, line, color)) in rows.entries) {
      final st = stageOf(s);
      expect([st.segments, st.icon, st.line, st.color], [segs, icon, line, color], reason: s.name);
    }
  });

  test('a red border only for the worker\'s own request that needs attention', () {
    RequestEntry remote(SyncState s, {bool mine = true}) => RequestEntry(state: s, remote: RemoteRequest.fromJson(requestDoc(mine: mine)));
    final onPhone = RequestEntry(state: SyncState.failed, draft: RequestDraft(id: 'd1', createdAt: DateTime.utc(2026, 10, 5)));
    expect(needsMe(remote(SyncState.needsResolution)), isTrue);
    expect(needsMe(remote(SyncState.failed)), isTrue);
    expect(needsMe(onPhone), isTrue);
    expect(needsMe(remote(SyncState.needsResolution, mine: false)), isFalse, reason: 'a leader reads a team member\'s request');
    expect(needsMe(remote(SyncState.received)), isFalse);
    expect(needsMe(remote(SyncState.pending)), isFalse);
  });

  testWidgets('the bar paints the three segments; the line shows icon and words', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(body: Column(children: [RequestStageBar(stageOf(SyncState.pending)), RequestStageLine(stageOf(SyncState.pending))])),
    ));
    Color seg(int i) => (tester.widget<Container>(find.byKey(Key('stage-seg-$i'))).decoration! as BoxDecoration).color!;
    expect([seg(0), seg(1), seg(2)], [WmColors.green, WmColors.brown, WmColors.border]);
    expect(find.text('Saved on this phone · sends when there is signal'), findsOneWidget);
    expect(find.byIcon(Icons.cloud_off), findsOneWidget);
  });
}
```

Append to `test/requests/list/requests_controller_test.dart` inside `main()`:

```dart
  test('each filter counts what it shows (the chips\' numbers), whatever filter is selected', () async {
    api.savedDrafts['d9'] = RequestDraft(id: 'd9', createdAt: DateTime.utc(2026, 10, 4));
    api.view = RequestsView(entries: [
      remoteEntry('r1', SyncState.received),
      remoteEntry('r2', SyncState.pending),
      remoteEntry('r3', SyncState.needsResolution, conflict: true),
      remoteEntry('r4', SyncState.failed),
    ]);
    final c = RequestsController(api: api, now: () => now);
    await c.refresh();
    expect([for (final f in RequestFilter.values) c.count(f)], [5, 1, 1, 2]);
    c.setFilter(RequestFilter.pending);
    expect([for (final f in RequestFilter.values) c.count(f)], [5, 1, 1, 2]);
    expect(c.rows.map((e) => e.key), ['r2']);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/requests/ui/request_stage_test.dart test/requests/list/requests_controller_test.dart`
Expected: compile errors — `request_stage.dart` missing; `count` not defined.

- [ ] **Step 3: Implement**

Create `lib/requests/ui/request_stage.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../data/requests_api.dart';
import '../domain/request_status.dart';

/// How far a request has come: the 3-part bar (Saved · Sent · Received) and
/// the status line on its card and in its sheet (redesign Phase 3 spec §5).
class RequestStage {
  const RequestStage({required this.segments, required this.icon, required this.line, required this.color});

  /// The three segments' colours, Saved · Sent · Received.
  final List<Color> segments;
  final IconData icon;
  final String line;
  final Color color;
}

const requestStageLabels = ['Saved', 'Sent', 'Received'];

RequestStage stageOf(SyncState s) => switch (s) {
      SyncState.draft => const RequestStage(
          segments: [WmColors.textMuted, WmColors.border, WmColors.border],
          icon: Icons.edit_note,
          line: 'Not sent yet · finish and send',
          color: WmColors.textSecondary,
        ),
      SyncState.pending => const RequestStage(
          segments: [WmColors.green, WmColors.brown, WmColors.border],
          icon: Icons.cloud_off,
          line: 'Saved on this phone · sends when there is signal',
          color: WmColors.brown,
        ),
      SyncState.received => const RequestStage(
          segments: [WmColors.green, WmColors.green, WmColors.green],
          icon: Icons.check_circle,
          line: 'Received by the office',
          color: WmColors.green,
        ),
      SyncState.failed || SyncState.needsResolution => const RequestStage(
          segments: [WmColors.green, WmColors.danger, WmColors.border],
          icon: Icons.report,
          line: 'Needs attention · open it to see why',
          color: WmColors.danger,
        ),
      SyncState.cancelled => const RequestStage(
          segments: [WmColors.textDisabled, WmColors.textDisabled, WmColors.textDisabled],
          icon: Icons.block,
          line: 'Cancelled',
          color: WmColors.textMuted,
        ),
    };

/// The worker's own request that needs them: its card gets a red border. A
/// leader only reads a team member's request, so theirs stays grey.
bool needsMe(RequestEntry e) =>
    (e.state == SyncState.failed || e.state == SyncState.needsResolution) && (e.remote?.mine ?? true);

/// Three equal segments, height 4, gap 4. Never animated.
class RequestStageBar extends StatelessWidget {
  const RequestStageBar(this.stage, {super.key});

  final RequestStage stage;

  @override
  Widget build(BuildContext context) => Row(children: [
        for (var i = 0; i < 3; i++) ...[
          if (i > 0) const SizedBox(width: 4),
          Expanded(
            child: Container(
              key: Key('stage-seg-$i'),
              height: 4,
              decoration: BoxDecoration(color: stage.segments[i], borderRadius: BorderRadius.circular(2)),
            ),
          ),
        ],
      ]);
}

/// The status line: icon + words in the state's colour.
class RequestStageLine extends StatelessWidget {
  const RequestStageLine(this.stage, {super.key, this.size = 13, this.iconSize = 17});

  final RequestStage stage;
  final double size;
  final double iconSize;

  @override
  Widget build(BuildContext context) => Row(children: [
        Icon(stage.icon, size: iconSize, color: stage.color),
        const SizedBox(width: 6),
        Flexible(child: Text(stage.line, style: TextStyle(fontSize: size, fontWeight: FontWeight.w700, color: stage.color))),
      ]);
}
```

In `lib/requests/list/requests_controller.dart` replace the `rows` getter with:

```dart
  List<RequestEntry> get rows => all.where((e) => _shows(_filter, e)).toList();

  /// How many requests [f] shows — the chip's number. The same rule as [rows].
  int count(RequestFilter f) => all.where((e) => _shows(f, e)).length;

  static bool _shows(RequestFilter f, RequestEntry e) => switch (f) {
        RequestFilter.all => true,
        RequestFilter.drafts => e.state == SyncState.draft,
        RequestFilter.pending => e.state == SyncState.pending,
        RequestFilter.attention => e.state == SyncState.failed || e.state == SyncState.needsResolution,
      };
```

- [ ] **Step 4: Run them to see them pass**

Run: `flutter test test/requests`
Expected: all pass.

- [ ] **Step 5: Checkpoint (no commit)** — report the 4 files.

---

### Task 3: The Requests tab

**Files:**
- Modify: `lib/requests/list/requests_screen.dart`
- Create: `test/requests/list/requests_screen_test.dart`
- Modify: `test/requests/detail/request_screens_test.dart` (only the test `'a cancelled request shows Cancelled on the
  list, not Received'`)

**Interfaces:**
- Consumes: `WmChipRow`, `WmCountChip`, `WmPillButton` (Task 1); `stageOf`, `needsMe`, `RequestStageBar`,
  `RequestStageLine` (Task 2); `RequestsController.count` (Task 2).
- Produces: nothing new for later tasks (the opener is unchanged here).

- [ ] **Step 1: Write the failing tests**

Create `test/requests/list/requests_screen_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/requests/list/requests_controller.dart';
import 'package:workmate/requests/list/requests_screen.dart';
import 'package:workmate/requests/requests_services.dart';
import 'package:workmate/ui/theme.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../domain/request_models_test.dart' show requestDoc;
import '../request_fakes.dart';

void main() {
  late FakeRequestsApi api;
  late RequestsController controller;

  setUp(() {
    api = FakeRequestsApi();
    controller = RequestsController(api: api, now: () => DateTime.utc(2026, 10, 5, 2));
  });

  RequestEntry remote(String id, SyncState state, {bool mine = true, bool conflict = false}) {
    final doc = requestDoc(id: id, mine: mine);
    if (conflict) (doc['lines'] as List).first['has_conflict'] = true;
    return RequestEntry(state: state, remote: RemoteRequest.fromJson(doc));
  }

  Future<void> show(WidgetTester tester) async {
    useTallPhone(tester);
    await controller.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(body: RequestsScreen(controller: controller, services: RequestsServices(api: api, takePhoto: (_) async => null))),
    ));
    await tester.pumpAndSettle();
  }

  void seed() {
    api.savedDrafts['d7'] = RequestDraft(id: 'd7', createdAt: DateTime.utc(2026, 10, 5), destination: site);
    api.view = RequestsView(entries: [
      remote('r1', SyncState.received),
      remote('r2', SyncState.pending),
      remote('r3', SyncState.needsResolution, conflict: true),
      remote('r4', SyncState.failed),
      remote('r5', SyncState.needsResolution, mine: false, conflict: true),
    ]);
  }

  Finder inCard(String key, Finder f) => find.descendant(of: find.byKey(Key('entry-$key')), matching: f);

  testWidgets('each chip shows its count; the title and New request are at the top', (tester) async {
    seed();
    await show(tester);
    expect(find.text('Requests'), findsOneWidget);
    expect(find.byKey(const Key('new-request')), findsOneWidget);
    for (final (key, n) in [('filter-all', '6'), ('filter-drafts', '1'), ('filter-pending', '1'), ('filter-attention', '3')]) {
      expect(find.descendant(of: find.byKey(Key(key)), matching: find.text(n)), findsOneWidget, reason: key);
    }
  });

  testWidgets('every card shows the 3-part bar and its status line', (tester) async {
    seed();
    await show(tester);
    for (final (key, line) in [
      ('d7', 'Not sent yet · finish and send'),
      ('r1', 'Received by the office'),
      ('r2', 'Saved on this phone · sends when there is signal'),
      ('r3', 'Needs attention · open it to see why'),
      ('r4', 'Needs attention · open it to see why'),
    ]) {
      await tester.ensureVisible(find.byKey(Key('entry-$key')));
      expect(inCard(key, find.text(line)), findsOneWidget, reason: key);
      expect(inCard(key, find.byKey(const Key('stage-seg-2'))), findsOneWidget, reason: key);
    }
  });

  testWidgets('the worker\'s own attention cards have a red border; a team member\'s does not', (tester) async {
    seed();
    await show(tester);
    Color border(String key) =>
        (tester.widget<Material>(inCard(key, find.byType(Material)).first).shape! as RoundedRectangleBorder).side.color;
    expect(border('r3'), WmColors.danger);
    expect(border('r4'), WmColors.danger);
    expect(border('r5'), WmColors.border);
    expect(border('r1'), WmColors.border);
  });

  testWidgets('switching chips filters the list', (tester) async {
    seed();
    await show(tester);
    await tester.ensureVisible(find.byKey(const Key('filter-attention')));
    await tester.tap(find.byKey(const Key('filter-attention')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('entry-r3')), findsOneWidget);
    expect(find.byKey(const Key('entry-r1')), findsNothing);
    expect(find.byKey(const Key('entry-d7')), findsNothing);
  });
}
```

In `test/requests/detail/request_screens_test.dart`, in `'a cancelled request shows Cancelled on the list, not
Received'`, the card now says "Cancelled" twice (pill and status line). Replace
`expect(find.descendant(of: find.byKey(const Key('entry-r1')), matching: find.text('Cancelled')), findsOneWidget);` with:

```dart
    final card = find.byKey(const Key('entry-r1'));
    expect(find.descendant(of: find.descendant(of: card, matching: find.byType(SyncChip)), matching: find.text('Cancelled')), findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('Cancelled')), findsNWidgets(2), reason: 'the pill and the status line');
```

and add `import 'package:workmate/requests/ui/sync_chip.dart';`.

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/requests/list/requests_screen_test.dart test/requests/detail/request_screens_test.dart`
Expected: FAIL — no counts in the chips, no bar / status line, no `Material` card; the cancelled test sees one
"Cancelled".

- [ ] **Step 3: Implement**

In `lib/requests/list/requests_screen.dart`:
- add imports `import '../../ui/wm_chips.dart';` and `import '../ui/request_stage.dart';`
- replace the `ListView(...)` children from the title `Row` down to (and including) the chips' `SingleChildScrollView`
  with:

```dart
              Row(children: [
                const Expanded(child: Text('Requests', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800))),
                FilledButton.icon(
                  key: const Key('new-request'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                  onPressed: () => newRequest(context, controller, services),
                  icon: const Icon(Icons.add),
                  label: const Text('New request'),
                ),
              ]),
              const SizedBox(height: 2),
              const Text('Materials and tools for your projects.', style: TextStyle(fontSize: 14, color: WmColors.textMuted)),
              if (services.history case final history?) ...[
                const SizedBox(height: 12),
                Align(alignment: Alignment.centerLeft, child: _FindPreviousButton(onPressed: () => _findPrevious(context, history))),
              ],
              const SizedBox(height: 12),
              if (failure != null) ...[
                if (view != null && view.fetchedAt != null)
                  Text(
                    'No signal: showing what this phone saved on ${dayMonth(view.fetchedAt!)}, ${clockTime(view.fetchedAt!)}. Pull down to try again.',
                    style: const TextStyle(fontSize: 12.5, color: WmColors.brown),
                  )
                else
                  FailureNotice(
                    english: requestFailureCopy(failure).english,
                    tagalog: requestFailureCopy(failure).tagalog,
                    actions: [noticeAction(retryLabel, c.refresh)],
                  ),
                const SizedBox(height: 12),
              ],
              WmChipRow(children: [
                for (final (f, label) in const [
                  (RequestFilter.all, 'All'),
                  (RequestFilter.drafts, 'Drafts'),
                  (RequestFilter.pending, 'Pending sync'),
                  (RequestFilter.attention, 'Needs attention'),
                ])
                  WmCountChip(key: Key('filter-${f.name}'), label: label, count: c.count(f), selected: c.filter == f, onTap: () => c.setFilter(f)),
              ]),
```

  (the `ListView`'s padding becomes `const EdgeInsets.fromLTRB(20, 16, 20, 28)`; everything after the chips — the
  spinner, the empty text and the `for (final e in rows) _EntryCard(...)` — stays as it is).
- replace the whole `_EntryCard.build` with:

```dart
  @override
  Widget build(BuildContext context) {
    final r = entry.remote;
    final d = entry.draft;
    final title = r?.title ?? d!.destination?.label ?? 'New request';
    final lines = r?.lines.length ?? d!.lines.length;
    final urgent = r != null ? r.lines.any((l) => l.urgent && !l.cancelled) : d!.lines.any((l) => l.urgent);
    final when = r?.receivedAt ?? d!.createdAt;
    final who = r != null && !r.mine ? 'From ${r.requesterName} · ' : '';
    final delivery = r == null ? null : nextDelivery([r], DateTime.now());
    final stage = stageOf(entry.state);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      // A white Material under the InkWell, so the tap ripple shows.
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: needsMe(entry) ? WmColors.danger : WmColors.border),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, height: 1.25))),
                const SizedBox(width: 8),
                SyncChip(entry.state),
              ]),
              const SizedBox(height: 4),
              Text('$who$lines item${lines == 1 ? '' : 's'} · ${dayMonth(when)}', style: const TextStyle(color: WmColors.textMuted, fontSize: 13)),
              const SizedBox(height: 12),
              RequestStageBar(stage),
              const SizedBox(height: 8),
              RequestStageLine(stage),
              if (urgent || delivery != null) ...[
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  if (urgent) const UrgentTag(),
                  if (delivery != null) Text('Next delivery ${calendarDay(delivery)}', style: const TextStyle(fontSize: 13, color: WmColors.green)),
                ]),
              ],
            ]),
          ),
        ),
      ),
    );
  }
```

- replace `_FindPreviousButtonState.build` with (the busy logic stays):

```dart
  @override
  Widget build(BuildContext context) => WmPillButton(
        key: const Key('find-previous'),
        icon: Icons.history,
        label: 'Find previous item',
        busy: _busy,
        onTap: _run,
      );
```

  and remove `key: const Key('find-previous')` from anywhere else (the key now lives on the pill).

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/requests test/history test/ui test/home`
Expected: all pass (the Find previous tests in `test/history/ui/request_again_test.dart` find `find-previous` on the
pill; the double-tap test still opens one search screen).

- [ ] **Step 5: Checkpoint (no commit)** — report the 3 files.

---

### Task 4: The request details sheet

**Files:**
- Create: `lib/requests/detail/request_sheet.dart`
- Delete: `lib/requests/detail/request_detail_screen.dart`
- Modify: `lib/requests/list/request_openers.dart`
- Modify: `test/requests/detail/request_screens_test.dart`
- Modify: `test/ui/home_inbox_test.dart`, `test/ui/screens_test.dart` (`RequestDetailScreen` → `RequestSheet`)

**Interfaces:**
- Consumes: `showWmSheet`, `WmSheetFrame` (Phase 1); `stageOf`, `requestStageLabels`, `RequestStageBar`,
  `RequestStageLine`, `RequestStage` (Task 2).
- Produces: `RequestSheet({Key? key, required RequestsController controller, required RequestsApi api, required String
  entryKey, required void Function(String draftId) onEditDraft})`; `openRequestEntry` (same signature) opens it.

- [ ] **Step 1: Write the failing tests**

In `test/requests/detail/request_screens_test.dart`:
- replace the import `package:workmate/requests/detail/request_detail_screen.dart` with
  `package:workmate/requests/detail/request_sheet.dart` and add `import 'package:workmate/requests/list/request_openers.dart';`,
  `import 'package:workmate/requests/ui/sync_chip.dart';` (if Task 3 has not added it) and
  `import 'package:workmate/ui/theme.dart';` (already there).
- replace the helper `showDetail` with:

```dart
  /// The request opens as a sheet over a plain page, as from the tab or Home.
  Future<void> showDetail(WidgetTester tester, String key) async {
    useTallPhone(tester);
    await controller.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: TextButton(
              onPressed: () => openRequestEntry(context, controller, RequestsServices(api: api, takePhoto: (_) async => null), controller.entry(key)!),
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

- in `'a received request shows each portion\'s expected delivery'` replace `expect(find.text('Received'), findsOneWidget);`
  with `expect(find.descendant(of: find.byType(SyncChip), matching: find.text('Received')), findsOneWidget);`
  (the sheet also shows "Received" under the bar).
- in `'2B-b: what the office sent from stock …'` replace the second `await showDetail(tester, 'r1');` with
  `await controller.refresh(); await tester.pumpAndSettle();` (the open sheet follows the controller).
- in the group `'a refused draft back to editing'`, replace `expect(find.byType(RequestDetailScreen), findsOneWidget);`
  with `expect(find.byType(RequestSheet), findsOneWidget);`.
- add these tests inside `main()`:

```dart
  testWidgets('the sheet: pill and meta, the status box with Saved · Sent · Received, then ITEMS', (tester) async {
    api.view = RequestsView(entries: [entry(requestDoc())]);
    await showDetail(tester, 'r1');
    expect(find.byKey(const Key('request-sheet')), findsOneWidget);
    expect(find.text('Santos Townhouse · Main Contract'), findsOneWidget, reason: 'the title');
    expect(find.text('Just me · Received 5 Oct, 11:00 AM'), findsOneWidget);
    expect(find.byKey(const Key('request-status')), findsOneWidget);
    for (final label in ['Saved', 'Sent']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('Received by the office'), findsOneWidget);
    expect(find.text('Back gate'), findsOneWidget, reason: 'the note');
    expect(find.text('ITEMS (1)'), findsOneWidget);
    expect(find.byKey(const Key('line-l1')), findsOneWidget);
    expect(find.byKey(const Key('cancel-request')), findsOneWidget, reason: 'in the footer');
  });

  testWidgets('a request still on the phone shows the saved-on-phone line and no cancel button', (tester) async {
    api.view = RequestsView(entries: [
      RequestEntry(state: SyncState.pending, draft: RequestDraft(id: 'd3', createdAt: DateTime.utc(2026, 10, 5), destination: site)),
    ]);
    await showDetail(tester, 'd3');
    expect(find.text('Santos Townhouse · Main Contract'), findsOneWidget);
    expect(find.text('Saved on this phone. It is sent as soon as there is signal.'), findsOneWidget);
    expect(find.text('Saved on this phone · sends when there is signal'), findsOneWidget, reason: 'the status line');
    expect(find.text('ITEMS (0)'), findsOneWidget);
    expect(find.byKey(const Key('cancel-request')), findsNothing);
  });

  testWidgets('dragging the sheet down closes it; a request that left the list says so', (tester) async {
    api.view = RequestsView(entries: [entry(requestDoc())]);
    await showDetail(tester, 'r1');
    api.view = const RequestsView(entries: []);
    await controller.refresh();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('request-gone')), findsOneWidget);
    expect(find.text('This request is no longer on the list.'), findsOneWidget);
    await tester.timedDrag(find.byKey(const Key('wm-sheet-handle')), const Offset(0, 160), const Duration(milliseconds: 800));
    await tester.pumpAndSettle();
    expect(find.byType(RequestSheet), findsNothing);
    expect(api.calls, isEmpty);
  });
```

In `test/ui/home_inbox_test.dart` and `test/ui/screens_test.dart`: replace the import of
`package:workmate/requests/detail/request_detail_screen.dart` with `package:workmate/requests/detail/request_sheet.dart`
and every `find.byType(RequestDetailScreen)` with `find.byType(RequestSheet)`. In `test/ui/screens_test.dart`, the
`await tester.pageBack();` right after that expectation becomes `await tester.binding.handlePopRoute();`.

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/requests/detail/request_screens_test.dart`
Expected: compile errors — `request_sheet.dart` and `RequestSheet` do not exist.

- [ ] **Step 3: Implement the sheet**

Create `lib/requests/detail/request_sheet.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../../ui/wm_sheet.dart';
import '../data/requests_api.dart';
import '../domain/quantity.dart';
import '../domain/remote_request.dart';
import '../domain/request_draft.dart';
import '../domain/request_op.dart';
import '../domain/request_status.dart';
import '../list/requests_controller.dart';
import '../ui/request_stage.dart';
import '../ui/requests_copy.dart';
import '../ui/sync_chip.dart';

/// One request as a tall swipe-down sheet (redesign Phase 3 spec §6): its
/// state at a glance (bar + status line), then everything the old page showed —
/// each item's progress and expected delivery per weekly batch, what is still
/// on the phone, what was refused, and — for the requester — quantity changes
/// and cancelling. Reads its entry from the shared controller by [entryKey], so
/// it follows every refresh.
class RequestSheet extends StatelessWidget {
  const RequestSheet({
    super.key,
    required this.controller,
    required this.api,
    required this.entryKey,
    required this.onEditDraft,
  });

  final RequestsController controller;
  final RequestsApi api;
  final String entryKey;

  /// A refused draft, back in the editor.
  final void Function(String draftId) onEditDraft;

  Future<void> _changeQuantity(BuildContext context, RemoteRequest r, RemoteLine l, double current) async {
    final qty = await showDialog<double>(context: context, builder: (_) => _QuantityDialog(line: l, current: current));
    if (qty == null || qty == current) return;
    await api.changeQuantity(r, l, qty);
    await controller.refresh();
  }

  Future<bool> _confirm(BuildContext context, String title, String body) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep')),
            TextButton(key: const Key('confirm-cancel'), onPressed: () => Navigator.of(context).pop(true), child: const Text('Cancel it')),
          ],
        ),
      ) ==
      true;

  Future<void> _cancelLine(BuildContext context, RemoteRequest r, RemoteLine l) async {
    if (!await _confirm(context, 'Cancel ${l.description}?', 'The office is told. Anything already arranged is sorted out by them.')) return;
    await api.cancelLine(r, l);
    await controller.refresh();
  }

  Future<void> _cancelRequest(BuildContext context, RemoteRequest r) async {
    if (!await _confirm(context, 'Cancel the whole request?', 'Every item still open is cancelled. Anything already arranged is sorted out by the office.')) {
      return;
    }
    await api.cancelRequest(r);
    await controller.refresh();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final e = controller.entry(entryKey);
          if (e == null) {
            return const WmSheetFrame(title: 'Request', children: [
              Padding(
                key: Key('request-gone'),
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('This request is no longer on the list.', textAlign: TextAlign.center),
              ),
            ]);
          }
          final r = e.remote;
          final d = e.draft;
          return WmSheetFrame(
            key: const Key('request-sheet'),
            title: r?.title ?? d?.destination?.label ?? 'New request',
            tall: true,
            footer: r == null ? null : _footer(context, e, r),
            children: r != null ? _remote(context, e, r) : _onPhone(e, d!),
          );
        },
      );

  /// Cancel the whole request: only the requester, only while something is
  /// open, and not twice (spec §6).
  Widget? _footer(BuildContext context, RequestEntry e, RemoteRequest r) {
    if (!canCancelRequest(r) || e.pendingOps.any((o) => o.kind == OpKind.cancelRequest)) return null;
    return OutlinedButton.icon(
      key: const Key('cancel-request'),
      onPressed: () => _cancelRequest(context, r),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        foregroundColor: WmColors.danger,
        backgroundColor: Colors.white,
        side: const BorderSide(color: WmColors.dangerBorder),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontFamily: 'Barlow', fontSize: 14.5, fontWeight: FontWeight.w800),
      ),
      icon: const Icon(Icons.cancel_outlined, size: 20),
      label: const Text('Cancel the whole request'),
    );
  }

  /// The pill and the meta line, then the status box.
  List<Widget> _head(RequestEntry e, String meta) => [
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          SyncChip(e.state),
          Text(meta, style: const TextStyle(color: WmColors.textMuted, fontSize: 13)),
        ]),
        const SizedBox(height: 14),
        _StatusBox(stage: stageOf(e.state)),
        const SizedBox(height: 12),
      ];

  Widget _itemsLabel(int n) => Padding(padding: const EdgeInsets.only(top: 4, bottom: 8), child: Text('ITEMS ($n)', style: monoLabel));

  List<Widget> _failures(RequestEntry e) => [
        for (final op in e.failedOps)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: FailureNotice(
              leadEnglish: '${_opLabel(op, _lineName(e, op))}: ${notAcceptedLead.english}',
              leadTagalog: notAcceptedLead.tagalog,
              english: opFailureCopy(op).english,
              tagalog: opFailureCopy(op).tagalog,
              actions: [
                if (op.kind == OpKind.submit && op.draftId != null)
                  noticeAction(backToDraftsLabel, () => onEditDraft(op.draftId!))
                else
                  noticeAction(dismissLabel, () => controller.dismissFailed(op)),
              ],
            ),
          ),
      ];

  /// Sent from this phone, not yet confirmed by the server (or refused).
  List<Widget> _onPhone(RequestEntry e, RequestDraft d) => [
        ..._head(e, d.teamName == null ? 'Just me' : 'Team ${d.teamName}'),
        if (e.state == SyncState.pending) ...[
          const Text('Saved on this phone. It is sent as soon as there is signal.', style: TextStyle(color: WmColors.brown)),
          const SizedBox(height: 8),
        ],
        ..._failures(e),
        _itemsLabel(d.lines.length),
        for (final l in d.lines)
          _Card(children: [
            Text(l.description, style: const TextStyle(fontWeight: FontWeight.w800)),
            Text(
              [l.kind.label, if (l.spec.isNotEmpty) l.spec, '${formatQuantity(parseQuantity(l.quantity) ?? 0)} ${l.unit}'].join(' · '),
              style: const TextStyle(color: WmColors.textMuted),
            ),
            if (l.urgent) ...[const SizedBox(height: 6), UrgentTag(neededBy: l.neededBy)],
          ]),
      ];

  List<Widget> _remote(BuildContext context, RequestEntry e, RemoteRequest r) => [
        ..._head(
          e,
          [
            if (!r.mine) 'From ${r.requesterName}',
            r.teamName == null ? 'Just me' : 'Team ${r.teamName}',
            'Received ${dayMonth(r.receivedAt)}, ${clockTime(r.receivedAt)}',
          ].join(' · '),
        ),
        if (r.note.isNotEmpty) ...[Text(r.note), const SizedBox(height: 8)],
        // The pill says it already, unless something unsent outranks it.
        if (r.cancelled && e.state != SyncState.cancelled) ...[
          const Text('Cancelled', style: TextStyle(color: WmColors.danger, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
        ],
        ..._failures(e),
        _itemsLabel(r.lines.length),
        for (final l in r.lines) _line(context, e, r, l),
      ];
```

Then copy, **unchanged**, from `lib/requests/detail/request_detail_screen.dart` into the class: the `_line(...)` method;
and after the class: `_lineName`, `_opLabel`, `_Card`, `_RemotePhoto` / `_RemotePhotoState` and `_QuantityDialog` /
`_QuantityDialogState`. Then add at the end of the file:

```dart
/// The bar, its three labels and the status line, in a white card (spec §6).
class _StatusBox extends StatelessWidget {
  const _StatusBox({required this.stage});

  final RequestStage stage;

  static const _label = TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: WmColors.textMuted);

  @override
  Widget build(BuildContext context) => Container(
        key: const Key('request-status'),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: WmColors.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          RequestStageBar(stage),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: Text(requestStageLabels[0], style: _label)),
            Expanded(child: Text(requestStageLabels[1], textAlign: TextAlign.center, style: _label)),
            Expanded(child: Text(requestStageLabels[2], textAlign: TextAlign.right, style: _label)),
          ]),
          const SizedBox(height: 10),
          RequestStageLine(stage, size: 14, iconSize: 18),
        ]),
      );
}
```

Delete `lib/requests/detail/request_detail_screen.dart` (normal file delete).

- [ ] **Step 4: The opener opens the sheet**

Replace `openRequestEntry` in `lib/requests/list/request_openers.dart` (and its imports: drop
`../detail/request_detail_screen.dart`, add `import 'dart:async';`, `import '../../ui/wm_sheet.dart';`,
`import '../detail/request_sheet.dart';`) with:

```dart
/// A draft opens for editing; anything else opens its details as a sheet
/// (redesign Phase 3), which asks for a fresh copy as it opens.
Future<void> openRequestEntry(BuildContext context, RequestsController controller, RequestsServices services, RequestEntry e) async {
  if (e.state == SyncState.draft) return composeRequest(context, controller, services, e.draft!);
  unawaited(controller.refresh());
  await showWmSheet<void>(
    context,
    builder: (sheetContext) => RequestSheet(
      controller: controller,
      api: services.api,
      entryKey: e.key,
      onEditDraft: (draftId) async {
        final back = await controller.returnToDrafts(draftId);
        // Only a draft that is editable again: a queued one ignores every save.
        final again = controller.entry(draftId);
        final draft = again?.draft;
        if (!back || again?.state != SyncState.draft || draft == null || !sheetContext.mounted || !context.mounted) return;
        Navigator.of(sheetContext).pop();
        await composeRequest(context, controller, services, draft);
      },
    ),
  );
  await controller.refresh();
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `flutter test test/requests test/ui test/home test/history`
Expected: all pass — every old detail test keeps its fact (deliveries, From stock, a quantity change pending, cancel
asks first, a leader reads only, a refusal explained and dismissed, Edit and send again guarded and opening the editor).

- [ ] **Step 6: Checkpoint (no commit)** — report the files (one deleted).

---

### Task 5: Version and the full check

**Files:**
- Modify: `pubspec.yaml`

- [ ] **Step 1:** In `pubspec.yaml` change `version: 0.13.1+1018` to `version: 0.14.0+1019`.
- [ ] **Step 2:** Run `flutter analyze` → `No issues found!` (fix only unused imports, and say which).
- [ ] **Step 3:** Run `flutter test` → report the final line and the count (1277 before Phase 3; none deleted).
- [ ] **Step 4:** Map each spec §10 acceptance item to a passing test (real names and files):

| # | Acceptance | Test |
|---|---|---|
| 1 | Chips with counts; filters show the right requests | `requests_screen_test`: each chip shows its count; switching chips filters the list; `requests_controller_test`: each filter counts |
| 2 | Bar + status line on every card; red border on own attention cards | `requests_screen_test`: every card shows the 3-part bar…; own attention cards have a red border; `request_stage_test` |
| 3 | Find previous and New request still work | `request_again_test` (Find previous); `request_screens_test`: New request then straight back |
| 4 | Draft → New request; others → sheet | `request_screens_test`: the list shows each state and opens a draft in the editor; the sheet: pill and meta… |
| 5 | The sheet shows everything and every action works | `request_screens_test`: deliveries, From stock, change quantity, cancelling asks first, leader read-only, refusal dismissed, refused draft back to editing, still on the phone, left the list |
| 6 | Home's request rows open the sheet | `home_inbox_test`: Fix opens that request; `screens_test` |
| 7 | Tests + analyzer | Steps 2–3 |

- [ ] **Step 5: Hand over (no commit, no build, no pilot)** — report files changed per task, the test count, the analyze
  result, and that the APK build, the phone pilot and publishing build 1019 each need their own approval.
