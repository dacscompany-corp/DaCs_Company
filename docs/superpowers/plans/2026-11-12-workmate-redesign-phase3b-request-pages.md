# WorkMate Redesign Phase 3b (request pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New request, Add item / Edit item and Find previous item get the redesign's look — round back button, big
title, white cards, the shared chips and pill buttons, the main button pinned at the bottom — as full pages, with every
field, button, label, key, validation and server call unchanged.

**Architecture:** One shared page frame (`WmPage`) and one choice chip (`WmChoiceChip`); the three pages swap their
`Scaffold`/`AppBar` and a few widgets for them. The sheets' round button becomes public (`WmRoundButton`) so the page
header uses the same one.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, Material 3, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-11-12-workmate-redesign-phase3-requests-design.md` §11 (Dacs Web repo).

## Global Constraints

- Repository: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`. Phase 3 (0.14.0+1019) is in the working tree,
  uncommitted; build on it.
- **Never run `git commit`, `git push`, `git add`, `git stash`, `git checkout`, `git restore`, `git rm`, `git reset` or
  `git clean`.** **Never run `dart format`.**
- **Restyle only.** Every field, button, label, key, validation, draft-saving rule and server call of `ComposeScreen`,
  `ItemEditorScreen` and `FindPreviousScreen` stays. They stay full pages (`MaterialPageRoute`), not sheets.
- The page back button calls `Navigator.maybePop` (Android Back and any `PopScope` behave as today) and carries the
  tooltip "Back", so `tester.pageBack()` keeps working.
- Keys kept: `draft-delete`, `choose-destination`, `team-none`, `team-<id>`, `line-<i>`, `add-item`, `request-note`,
  `send-request`, `item-remove`, `item-remove-keep`, `item-remove-confirm`, `item-search`, `catalog-<id>`,
  `describe-item`, `item-find-previous`, `item-name`, `item-spec`, `item-unit`, `item-category`, `item-quantity`,
  `item-member`, `item-urgent`, `item-reason`, `item-needed-by`, `item-notes`, `item-add-photo`, `item-save`,
  `item-change`, `history-search`, `history-kind-all`, `history-kind-<wire>`, `history-project`, `history-category`,
  `history-period-<name>`, `history-more`, `history-empty`, `history-failure`, `history-saved-banner`,
  `history-refreshing`, `wm-sheet-back`, `wm-sheet-close`. New keys: `wm-page-back`, `item-kind-material`,
  `item-kind-tool`.
- **Never delete a test**; a test reading an old widget type asserts the same fact on the new one.
- Finish with `flutter test` passing and `flutter analyze` → `No issues found!`. Version: `0.14.1+1020`.

---

### Task 1: The page frame, the choice chip and the shared round button

**Files:**
- Modify: `lib/ui/wm_sheet.dart` (`_RoundButton` → public `WmRoundButton`, same code)
- Create: `lib/ui/wm_page.dart`
- Modify: `lib/ui/wm_chips.dart` (add `WmChoiceChip`)
- Create: `test/ui/wm_page_test.dart`
- Modify: `test/ui/wm_chips_test.dart` (one test)

**Interfaces:**
- Produces: `WmRoundButton({Key? key, required IconData icon, required String label, required VoidCallback onTap})`;
  `WmPage({Key? key, required String title, required List<Widget> children, Widget? action, Widget? footer})`;
  `WmChoiceChip({Key? key, required String label, required bool selected, required VoidCallback onTap})`.

- [ ] **Step 1: Write the failing tests**

Create `test/ui/wm_page_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/ui/wm_page.dart';
import 'package:workmate/ui/wm_sheet.dart';

import '../attendance/fakes.dart' show useTallPhone;

void main() {
  Future<void> open(WidgetTester tester, {Widget? action, Widget? footer, bool guard = false}) async {
    useTallPhone(tester);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => PopScope(
                canPop: !guard,
                child: WmPage(title: 'New request', action: action, footer: footer, children: [for (var i = 0; i < 40; i++) Text('Row $i')]),
              ),
            )),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('the title, the round back button (tooltip Back) and an action', (tester) async {
    var acted = 0;
    await open(tester, action: WmRoundButton(key: const Key('act'), icon: Icons.delete_outline, label: 'Delete draft', onTap: () => acted++));
    expect(find.text('New request'), findsOneWidget);
    expect(tester.widget<Text>(find.text('New request')).style!.fontSize, 24);
    expect(find.byKey(const Key('wm-page-back')), findsOneWidget);
    expect(find.byTooltip('Back'), findsOneWidget);
    await tester.tap(find.byKey(const Key('act')));
    expect(acted, 1);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('New request'), findsNothing, reason: 'back closes the page');
  });

  testWidgets('back respects a PopScope that says no', (tester) async {
    await open(tester, guard: true);
    await tester.tap(find.byKey(const Key('wm-page-back')));
    await tester.pumpAndSettle();
    expect(find.text('New request'), findsOneWidget);
  });

  testWidgets('the footer stays pinned at the bottom while the body scrolls', (tester) async {
    await open(tester, footer: const SizedBox(key: Key('foot'), height: 56));
    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    final before = tester.getBottomLeft(find.byKey(const Key('foot'))).dy;
    expect(before, lessThanOrEqualTo(screen.height));
    expect(before, greaterThan(screen.height - 100));
    await tester.drag(find.text('Row 5'), const Offset(0, -400));
    await tester.pumpAndSettle();
    expect(tester.getBottomLeft(find.byKey(const Key('foot'))).dy, before);
    expect(find.text('Row 0'), findsNothing, reason: 'the body scrolled');
  });
}
```

Append to `test/ui/wm_chips_test.dart` inside `main()`:

```dart
  testWidgets('a choice chip: label only; the selected one is dark and says so to TalkBack', (tester) async {
    var taps = 0;
    await tester.pumpWidget(page(Row(children: [
      WmChoiceChip(key: const Key('x'), label: 'Just me', selected: true, onTap: () => taps++),
      WmChoiceChip(key: const Key('y'), label: 'Team A', selected: false, onTap: () {}),
    ])));
    expect(materialColor(tester, 'x'), WmColors.text);
    expect(materialColor(tester, 'y'), Colors.white);
    expect(find.text('Just me'), findsOneWidget);
    await tester.tap(find.byKey(const Key('x')));
    expect(taps, 1);
    final handle = tester.ensureSemantics();
    expect(tester.getSemantics(find.byKey(const Key('x'))), containsSemantics(isSelected: true));
    expect(tester.getSemantics(find.byKey(const Key('y'))), containsSemantics(isSelected: false));
    handle.dispose();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/ui/wm_page_test.dart test/ui/wm_chips_test.dart`
Expected: compile errors — `wm_page.dart`, `WmRoundButton`, `WmChoiceChip` do not exist.

- [ ] **Step 3: Implement**

In `lib/ui/wm_sheet.dart`: rename the class `_RoundButton` to `WmRoundButton` (its constructor and every use inside the
file); add above it the doc comment `/// The round 36-px button of the sheets and pages, with a 48-px tap area.` Nothing
else changes.

Create `lib/ui/wm_page.dart`:

```dart
import 'package:flutter/material.dart';

import 'theme.dart';
import 'wm_sheet.dart';

/// A full page in the redesign's look (Phase 3 spec §11): the round back
/// button, a big title, an optional round action on the right, a scrolling
/// body with 20-px sides and an optional footer pinned at the bottom for the
/// main button and its note. Back goes through `maybePop`, so Android Back and
/// any `PopScope` behave as before; the tooltip "Back" keeps `pageBack` working.
class WmPage extends StatelessWidget {
  const WmPage({super.key, required this.title, required this.children, this.action, this.footer});

  final String title;
  final List<Widget> children;

  /// A round button on the right of the title (Delete draft, Remove item).
  final Widget? action;

  /// Pinned under the scrolling body: the main button and its note.
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final action = this.action;
    final footer = this.footer;
    return Scaffold(
      backgroundColor: WmColors.canvas,
      body: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Tooltip(
                message: 'Back',
                excludeFromSemantics: true,
                child: WmRoundButton(
                  key: const Key('wm-page-back'),
                  icon: Icons.arrow_back,
                  label: 'Back',
                  onTap: () => Navigator.of(context).maybePop(),
                ),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(title, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, height: 1.2)),
                ),
              ),
              if (action != null) ...[const SizedBox(width: 4), action],
            ]),
          ),
          Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: children)),
          if (footer != null)
            Container(
              decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: WmColors.hairline))),
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
              child: footer,
            ),
        ]),
      ),
    );
  }
}
```

Add to `lib/ui/wm_chips.dart`:

```dart
/// A choice chip without a count (Team, Material / Tool, the Find previous
/// filters): the same look as [WmCountChip] (Phase 3 spec §11).
class WmChoiceChip extends StatelessWidget {
  const WmChoiceChip({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        selected: selected,
        child: Material(
          color: selected ? WmColors.text : Colors.white,
          shape: StadiumBorder(side: BorderSide(color: selected ? WmColors.text : WmColors.border)),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: onTap,
            child: Container(
              height: 38,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.center,
              child: Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: selected ? Colors.white : WmColors.textSecondary)),
            ),
          ),
        ),
      );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `flutter test test/ui test/workplan test/requests`
Expected: all pass (the sheets' round buttons look and behave the same).

- [ ] **Step 5: Checkpoint (no commit)** — report the 5 files.

---

### Task 2: New request and Add item / Edit item

**Files:**
- Modify: `lib/requests/compose/compose_screen.dart`
- Modify: `lib/requests/compose/item_editor_screen.dart`
- Modify: `test/requests/compose/compose_test.dart` (line ~252: `ChoiceChip` → `WmChoiceChip`)

**Interfaces:**
- Consumes: `WmPage`, `WmRoundButton`, `WmChoiceChip`, `WmPillButton`, `WmSheetButton`, `WmSheetNote` (Task 1, Phase 1–3).

- [ ] **Step 1: Write the failing test change**

In `test/requests/compose/compose_test.dart` replace
`expect(tester.widget<ChoiceChip>(find.byKey(const Key('team-none'))).selected, isTrue);` with
`expect(tester.widget<WmChoiceChip>(find.byKey(const Key('team-none'))).selected, isTrue);` and add
`import 'package:workmate/ui/wm_chips.dart';`. Add this test inside `group('ComposeScreen', …)` (it uses that group's
`show(tester, draft, popped)` helper and the file's `api`):

```dart
    testWidgets('New request in the new look: big title, round Delete draft, SEND REQUEST pinned at the bottom', (tester) async {
    await show(tester, api.newDraft(), []);
    expect(find.text('New request'), findsOneWidget);
    expect(find.byKey(const Key('wm-page-back')), findsOneWidget);
    expect(find.byKey(const Key('draft-delete')), findsOneWidget);
    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    expect(tester.getBottomLeft(find.byKey(const Key('send-request'))).dy, greaterThan(screen.height - 140), reason: 'pinned footer');
    expect(find.text('No signal? It is saved on this phone and sent as soon as there is signal.'), findsOneWidget);
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `flutter test test/requests/compose/compose_test.dart`
Expected: FAIL / compile error (`WmChoiceChip` on `team-none`, no `wm-page-back`).

- [ ] **Step 3: Restyle New request**

In `lib/requests/compose/compose_screen.dart` (imports: add `../../ui/wm_chips.dart`, `../../ui/wm_page.dart`,
`../../ui/wm_sheet.dart`):
- replace `return Scaffold(appBar: AppBar(…), body: SafeArea(child: ListView(padding: …, children: [` … `]),),);` with
  `return WmPage(title: 'New request', action: …, footer: …, children: [` … `]);` where

```dart
              action: WmRoundButton(key: const Key('draft-delete'), icon: Icons.delete_outline, label: 'Delete draft', onTap: _discard),
              footer: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (_c.sendFailure != null) ...[
                  FailureNotice(english: requestFailureCopy(_c.sendFailure!).english, tagalog: requestFailureCopy(_c.sendFailure!).tagalog),
                  const SizedBox(height: 12),
                ],
                WmSheetButton(key: const Key('send-request'), label: 'SEND REQUEST', icon: Icons.send, onPressed: _c.sending ? null : _send),
                const WmSheetNote('No signal? It is saved on this phone and sent as soon as there is signal.'),
              ]),
```

  and `children` is the old `ListView` children **without** the last block (the send-failure notice, the
  `FilledButton` `send-request`, the `SizedBox(height: 8)` and the "No signal?…" `Text`), ending after the note
  `TextField` (drop the `SizedBox(height: 18)` that followed it);
- in TEAM, replace each `ChoiceChip(key: …, label: Text(X), selected: S, onSelected: (_) => F)` with
  `WmChoiceChip(key: …, label: X, selected: S, onTap: () => F)` (same keys, labels — "Just me", "<name> (you lead)" /
  "<name>" — and actions);
- give the `add-item` `OutlinedButton.icon` a white background:
  `style: OutlinedButton.styleFrom(backgroundColor: Colors.white),` (nothing else changes).

- [ ] **Step 4: Restyle Add item / Edit item**

In `lib/requests/compose/item_editor_screen.dart` (imports: add `../../ui/wm_chips.dart`, `../../ui/wm_page.dart`,
`../../ui/wm_sheet.dart`):
- add to the state class:

```dart
  /// Material or Tool. Picking the kind already chosen changes nothing (the
  /// old segmented button only fired on a change).
  void _setKind(ItemKind k) {
    if (k == _line.kind) return;
    setState(() {
      final wasPicked = _line.fromCatalog;
      _line = _current.withoutRef().copyWith(
        kind: k,
        catalogItemId: null,
        memberId: k == ItemKind.tool ? null : _line.memberId,
        memberName: k == ItemKind.tool ? null : _line.memberName,
      );
      if (wasPicked) _clearItemFields();
    });
  }
```

  (this is the old `SegmentedButton.onSelectionChanged` body with `s.first` → `k`; keep any argument the old body
  passed exactly as it was).
- replace `return Scaffold(appBar: AppBar(…), body: SafeArea(child: ListView(padding: …, children: [` … `]),),);` with

```dart
    return WmPage(
      title: widget.isNew ? 'Add item' : 'Edit item',
      action: widget.isNew ? null : WmRoundButton(key: const Key('item-remove'), icon: Icons.delete_outline, label: 'Remove item', onTap: _remove),
      footer: WmSheetButton(key: const Key('item-save'), label: 'SAVE ITEM', icon: Icons.check, onPressed: _save),
      children: [
        // … the old ListView children, changed as below …
      ],
    );
```

  and in the children:
  - replace the `SegmentedButton<ItemKind>(…)` with

```dart
          Row(children: [
            for (final k in ItemKind.values) ...[
              if (k != ItemKind.values.first) const SizedBox(width: 8),
              Expanded(child: WmChoiceChip(key: Key('item-kind-${k.wire}'), label: k.label, selected: kind == k, onTap: () => _setKind(k))),
            ],
          ]),
```

  - replace each catalog `ListTile(key: Key('catalog-${c.id}'), …, onTap: () => _pick(c))` with

```dart
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Material(
                  key: Key('catalog-${c.id}'),
                  color: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: WmColors.border)),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () => _pick(c),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                        const SizedBox(height: 2),
                        Text([if (c.spec.isNotEmpty) c.spec, c.unit, if (c.category.isNotEmpty) c.category].join(' · '),
                            style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
                      ]),
                    ),
                  ),
                ),
              ),
```

  - replace the two `TextButton.icon`s `describe-item` and `item-find-previous` with one
    `Wrap(spacing: 8, runSpacing: 8, children: [WmPillButton(key: const Key('describe-item'), icon: Icons.edit_note, label: 'Not in the list? Describe it', onTap: () => setState(() { …same body… })), if (widget.services.history case final history?) WmPillButton(key: const Key('item-find-previous'), icon: Icons.history, label: 'Find previous item', onTap: () => _findPrevious(history))])`;
  - replace the `item-add-photo` `OutlinedButton.icon` with
    `WmPillButton(key: const Key('item-add-photo'), icon: Icons.photo_camera_outlined, label: 'Add photo', busy: _addingPhoto, onTap: _addPhoto)`;
  - delete the last two children: `const SizedBox(height: 20)` and the `FilledButton` `item-save` (now in the footer).
  Everything else (search field, "Nothing in the list matches.", the describe fields, "Pick from the list instead",
  quantity, For, Urgent, reason, Needed by, notes, photos) stays as it is.

- [ ] **Step 5: Run the tests to see them pass**

Run: `flutter test test/requests test/history test/ui test/home`
Expected: all pass; `tester.pageBack()` in `compose_test.dart` and `request_screens_test.dart` works through the
"Back" tooltip. If a test taps a key now under the pinned footer, use `tester.ensureVisible` and say so.

- [ ] **Step 6: Checkpoint (no commit)** — report the 3 files.

---

### Task 3: Find previous item, version and the full check

**Files:**
- Modify: `lib/history/ui/find_previous_screen.dart`
- Modify: `pubspec.yaml`

- [ ] **Step 1: Restyle**

In `lib/history/ui/find_previous_screen.dart` (imports: add `../../ui/wm_chips.dart`, `../../ui/wm_page.dart`):
- replace `return Scaffold(appBar: AppBar(title: const Text(findPreviousTitle)), body: SafeArea(child: ListView(padding: …, children: [` … `]),),);`
  with `return WmPage(title: findPreviousTitle, children: [` … `]);` (same children);
- replace each `ChoiceChip(key: K, label: Text(L), selected: S, onSelected: (_) => F)` (kind chips and period chips)
  with `WmChoiceChip(key: K, label: L, selected: S, onTap: () => F)`.
Everything else stays (search field, drop-downs, results, banner, notices, SHOW MORE).

- [ ] **Step 2: Version** — in `pubspec.yaml` change `version: 0.14.0+1019` to `version: 0.14.1+1020`.

- [ ] **Step 3: Checks** — `flutter analyze` → `No issues found!`; `flutter test test/history` then the full
  `flutter test` (before Phase 3b: 1293; report the count; none deleted). If a history test reads `ChoiceChip`, assert
  the same fact on `WmChoiceChip` and say which.

- [ ] **Step 4: Checkpoint (no commit, no build)** — report the files, the analyze result and the test count.
