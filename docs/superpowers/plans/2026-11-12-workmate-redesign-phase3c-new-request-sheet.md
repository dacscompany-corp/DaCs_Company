# WorkMate Redesign Phase 3c (New request sheet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New request becomes the mockup's tall sheet — projects listed as tappable cards, team chips, a quick-add row
(Item name · Qty · +) that opens Add item filled in, Find previous item, a note box, and SEND REQUEST pinned at the bottom —
with every field, rule, draft-saving behaviour and server call unchanged.

**Architecture:** `ComposeScreen` builds a `WmSheetFrame` instead of a `WmPage`; the opener shows it with `showWmSheet`.
The project picker's separate sheet goes away: its cards are drawn inline. Add item (`ItemEditorScreen`) gains an
`initialSearch` so the quick-add name lands in its search box. Find previous and Add item stay pages pushed over the sheet.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, Material 3, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-11-12-workmate-redesign-phase3-requests-design.md` §12 (Dacs Web repo).

## Global Constraints

- Repository: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`; Phases 3 + 3b (0.14.1+1020) are in the working
  tree, uncommitted; build on them.
- **Never run `git commit`, `git push`, `git add`, `git stash`, `git checkout`, `git restore`, `git rm`, `git reset` or
  `git clean`.** **Never run `dart format`.**
- Every field, validation (`DraftIssue`), draft save, send, delete-with-confirmation and server call of New request stays.
  Add item and Find previous stay full pages with every field.
- Words exactly: titles "New request" / "Draft request"; labels "PROJECT AND WORK", "TEAM", "ITEMS (N)",
  "NOTE (OPTIONAL)"; hints "Item name", "Qty", "Anything the office should know"; buttons "Find previous item",
  "Delete draft", "SEND REQUEST"; footer notes "Add at least one item." / "Saved on this phone as you type. It is sent as
  soon as there is signal."
- Keys: kept `dest-<workId>`, `team-none`, `team-<id>`, `line-<i>`, `add-item` (now the green +), `request-note`,
  `send-request`, `draft-delete`; new `quick-name`, `quick-qty`, `compose-find-previous`. The old `choose-destination`
  key goes away with the picker.
- **Never delete a test**; rewrite tests to the new facts (each change named below).
- Finish with `flutter test` passing and `flutter analyze` → `No issues found!`. Version `0.14.2+1021`.

---

### Task 1: New request as the mockup's sheet

**Files:**
- Modify: `lib/requests/compose/compose_screen.dart`
- Modify: `lib/requests/compose/item_editor_screen.dart` (`initialSearch`)
- Modify: `lib/requests/list/request_openers.dart`
- Modify: `pubspec.yaml` (`0.14.1+1020` → `0.14.2+1021`)
- Modify tests: `test/requests/compose/compose_test.dart`, `test/history/ui/request_again_test.dart`,
  `test/requests/detail/request_screens_test.dart`

- [ ] **Step 1: Rewrite the tests first**

`test/requests/compose/compose_test.dart`, `group('ComposeScreen')`:
- the `show` helper opens the sheet instead of a page, and can open a saved draft:

```dart
    Future<NavigatorState> show(WidgetTester tester, RequestDraft draft, List<Object?> popped, {bool resumed = false}) async {
      useTallPhone(tester);
      final nav = GlobalKey<NavigatorState>();
      await tester.pumpWidget(MaterialApp(
        navigatorKey: nav,
        theme: workMateTheme(),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async => popped.add(await showWmSheet<bool>(
                context,
                builder: (_) => ComposeScreen(
                  draft: draft,
                  services: RequestsServices(api: api, takePhoto: (_) async => '/raw/shot.jpg'),
                  now: () => DateTime(2026, 10, 5),
                  resumed: resumed,
                ),
              )),
              child: const Text('open'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      return nav.currentState!;
    }
```

  (keep the helper's existing `services` arguments if they differ from the above — e.g. history — and add
  `import 'package:workmate/ui/wm_sheet.dart';`).
- wherever a test taps `choose-destination` and then `dest-<workId>`, it now taps only `dest-<workId>` (it is a card in
  the sheet; use `ensureVisible` first if needed);
- every `tester.pageBack()` that closes New request becomes `await tester.binding.handlePopRoute();`
  (Add item / Find previous pages keep `pageBack()`);
- replace the Phase 3b test 'New request in the new look: big title, round Delete draft, SEND REQUEST pinned at the
  bottom' with:

```dart
    testWidgets('New request is a sheet: projects as cards, quick-add row, SEND REQUEST grey until an item', (tester) async {
      await show(tester, api.newDraft(), []);
      expect(find.text('New request'), findsOneWidget);
      expect(find.byKey(const Key('wm-sheet-close')), findsOneWidget);
      for (final d in api.refs.destinations) {
        expect(find.byKey(Key('dest-${d.workId}')), findsOneWidget, reason: d.workName);
      }
      expect(find.byKey(const Key('quick-name')), findsOneWidget);
      expect(find.byKey(const Key('quick-qty')), findsOneWidget);
      expect(find.byKey(const Key('add-item')), findsOneWidget);
      expect(tester.widget<WmSheetButton>(find.byKey(const Key('send-request'))).onPressed, isNull, reason: 'no item yet');
      expect(find.text('Add at least one item.'), findsOneWidget);
      expect(find.byKey(const Key('draft-delete')), findsNothing, reason: 'nothing saved yet');
      final first = api.refs.destinations.first;
      await tester.tap(find.byKey(Key('dest-${first.workId}')));
      await tester.pumpAndSettle();
      expect(api.savedDrafts.values.single.destination, first, reason: 'chosen in place, saved as before');
      expect(find.byKey(const Key('draft-delete')), findsOneWidget);
    });

    testWidgets('+ opens Add item with the typed name in its search and the quantity filled in', (tester) async {
      await show(tester, api.newDraft(), []);
      await tester.enterText(find.byKey(const Key('quick-name')), 'pipe');
      await tester.enterText(find.byKey(const Key('quick-qty')), '12');
      await tester.tap(find.byKey(const Key('add-item')));
      await tester.pumpAndSettle();
      expect(find.text('Add item'), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const Key('item-search'))).controller!.text, 'pipe');
      expect(tester.widget<TextField>(find.byKey(const Key('item-quantity'))).controller!.text, '12');
    });

    testWidgets('a saved draft reopens as Draft request', (tester) async {
      await show(tester, api.newDraft(), [], resumed: true);
      expect(find.text('Draft request'), findsOneWidget);
    });
```

  (If `item-quantity`'s `TextField` is wrapped, find it with `find.descendant(of: find.byKey(const Key('item-quantity')), matching: find.byType(TextField))`.)
- the test 'Send with nothing chosen says what is missing' now: (a) with no item, SEND REQUEST is grey and "Add at least
  one item." shows; (b) after adding one item from the list through + (as the neighbouring tests add items) and no
  project, tapping SEND REQUEST shows the "choose the project" issue text (`draftIssueText(DraftIssueKind.noDestination)`).
  Keep its name and add "(an item first)" to it.

`test/history/ui/request_again_test.dart`: the two `home: ComposeScreen(...)` hosts (≈ lines 36 and 150) become
`home: Scaffold(body: ComposeScreen(...))` (the sheet's frame needs a Material ancestor); nothing else changes.

`test/requests/detail/request_screens_test.dart`: in 'New request then straight back leaves no empty draft', the
`await tester.pageBack();` becomes `await tester.binding.handlePopRoute();`.

- [ ] **Step 2: Run to see them fail**

Run: `flutter test test/requests/compose/compose_test.dart`
Expected: compile errors (`resumed`, `showWmSheet` host) / failures (no `quick-name`, no inline `dest-` cards).

- [ ] **Step 3: Add item takes an initial search**

`lib/requests/compose/item_editor_screen.dart`: add the parameter and field

```dart
    this.initialSearch = '',
```

```dart
  /// Typed in New request's quick-add row: starts the list search here.
  final String initialSearch;
```

and change `late final _search = TextEditingController();` to
`late final _search = TextEditingController(text: widget.initialSearch);`. Nothing else changes.

- [ ] **Step 4: New request builds the sheet**

`lib/requests/compose/compose_screen.dart`:
- constructor: add `this.resumed = false` and the field

```dart
  /// Reopened from its draft card: titled "Draft request" (spec §12).
  final bool resumed;
```

- imports: drop `../../ui/wm_page.dart`; add `../../history/domain/history_models.dart` and
  `../../history/ui/find_previous_screen.dart` (keep the others analyze needs).
- state: add

```dart
  late final _quickName = TextEditingController();
  late final _quickQty = TextEditingController();
```

  and dispose both in `dispose()`.
- delete `_chooseDestination()` (the picker sheet) — the cards replace it.
- `_editLine` returns whether a line was saved and can pass a search to Add item:

```dart
  Future<bool> _editLine(DraftLine line, {required bool isNew, String search = ''}) async {
    final refs = _c.refs;
    final result = await Navigator.of(context).push<ItemEdit>(MaterialPageRoute(
      builder: (_) => ItemEditorScreen(
        line: line,
        isNew: isNew,
        catalog: refs?.catalog ?? const [],
        team: _c.team,
        iLead: _c.iLead,
        draftId: _c.draft.id,
        services: widget.services,
        destinations: refs?.destinations ?? const [],
        now: widget.now,
        initialSearch: search,
      ),
    ));
    // Backed out: the editor already deleted the photos it took.
    if (result == null) return false;
    if (result.remove) {
      await _c.removeLine(line.id);
      return false;
    }
    await _c.putLine(result.line!);
    return true;
  }

  /// The quick-add row: + opens Add item with the typed name in its search
  /// and the quantity filled in; a saved item clears the two boxes.
  Future<void> _quickAdd() async {
    final line = DraftLine(id: newEventId()).copyWith(quantity: _quickQty.text.trim());
    if (await _editLine(line, isNew: true, search: _quickName.text.trim()) && mounted) {
      _quickName.clear();
      _quickQty.clear();
    }
  }

  /// Find previous item from New request: the picked item opens in Add item
  /// as a new item of this draft.
  Future<void> _findPrevious(HistoryApi history) async {
    final refs = _c.refs;
    final pick = await Navigator.of(context).push<HistoryPick>(MaterialPageRoute(
      builder: (_) => FindPreviousScreen(
        history: history,
        projects: historyProjects(refs?.destinations ?? const []),
        categories: historyCategories(refs?.catalog ?? const []),
      ),
    ));
    if (pick == null || !mounted) return;
    await _editLine(DraftLine.fromHistory(newEventId(), pick), isNew: true);
  }
```

  (`_openLineOnLoad` and every other caller of `_editLine` ignore the new return value; if `DraftLine`'s constructor
  already takes `quantity:`, pass it there instead of `copyWith`.)
- replace the whole `build` with:

```dart
  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: _c,
        builder: (context, _) {
          final d = _c.draft;
          final refs = _c.refs;
          final lineIssues = {for (final i in _c.issues) if (i.line != null) i.line!};
          final hasItems = d.lines.isNotEmpty;
          final dests = refs?.destinations ?? [?d.destination];
          final history = widget.services.history;
          return WmSheetFrame(
            title: widget.resumed ? 'Draft request' : 'New request',
            tall: true,
            footer: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (_c.sendFailure != null) ...[
                FailureNotice(english: requestFailureCopy(_c.sendFailure!).english, tagalog: requestFailureCopy(_c.sendFailure!).tagalog),
                const SizedBox(height: 12),
              ],
              WmSheetButton(
                key: const Key('send-request'),
                label: 'SEND REQUEST',
                icon: Icons.send,
                onPressed: _c.sending || !hasItems ? null : _send,
              ),
              WmSheetNote(hasItems ? 'Saved on this phone as you type. It is sent as soon as there is signal.' : 'Add at least one item.'),
            ]),
            children: [
              // --- the notices exactly as before (loading line, list failure with Retry, no-signal lists note) ---
              const Text('PROJECT AND WORK', style: monoLabel),
              const SizedBox(height: 8),
              if (refs != null && refs.destinations.isEmpty && d.destination == null)
                FailureNotice(english: noDestinationsCopy.english, tagalog: noDestinationsCopy.tagalog)
              else
                for (final dest in dests)
                  _DestCard(
                    key: Key('dest-${dest.workId}'),
                    dest: dest,
                    selected: dest == d.destination,
                    onTap: refs == null ? null : () => _c.setDestination(dest),
                  ),
              if (_c.issues.contains(const DraftIssue(DraftIssueKind.noDestination)))
                Padding(
                  padding: const EdgeInsets.only(top: 2, bottom: 4),
                  child: Text(draftIssueText(DraftIssueKind.noDestination), style: const TextStyle(color: WmColors.danger)),
                ),
              // --- the project-closed notice exactly as before ---
              const SizedBox(height: 18),
              // --- TEAM exactly as in Phase 3b (label + WmChoiceChip wrap) ---
              const SizedBox(height: 18),
              Text('ITEMS (${d.lines.length})', style: monoLabel),
              const SizedBox(height: 8),
              // --- the _LineCard loop and the noLines / tooManyLines issue texts exactly as before ---
              _QuickAdd(name: _quickName, qty: _quickQty, onAdd: refs == null ? null : _quickAdd),
              if (history != null) ...[
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: WmPillButton(
                    key: const Key('compose-find-previous'),
                    icon: Icons.history,
                    label: 'Find previous item',
                    onTap: refs == null ? null : () => _findPrevious(history),
                  ),
                ),
              ],
              const SizedBox(height: 18),
              const Text('NOTE (OPTIONAL)', style: monoLabel),
              const SizedBox(height: 8),
              TextField(
                key: const Key('request-note'),
                controller: _note,
                minLines: 2,
                maxLines: 4,
                onChanged: (text) => unawaited(_saveNote(text)),
                decoration: const InputDecoration(hintText: 'Anything the office should know'),
              ),
              if (d.destination != null || hasItems || d.note.isNotEmpty) ...[
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    key: const Key('draft-delete'),
                    onPressed: _discard,
                    style: TextButton.styleFrom(foregroundColor: WmColors.danger),
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Delete draft'),
                  ),
                ),
              ],
            ],
          );
        },
      );
```

  Copy the three "exactly as before" blocks from the current `build` unchanged. Delete the old `_Choice` widget if
  nothing uses it any more (analyze will say). Add these widgets at the end of the file:

```dart
/// One project and work, chosen in place (spec §12): green when chosen.
class _DestCard extends StatelessWidget {
  const _DestCard({super.key, required this.dest, required this.selected, required this.onTap});

  final Destination dest;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Semantics(
          button: true,
          selected: selected,
          child: Material(
            color: selected ? WmColors.greenTint : Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: selected ? WmColors.green : WmColors.border, width: selected ? 1.5 : 1),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                child: Row(children: [
                  Icon(dest.isMain ? Icons.home_work_outlined : Icons.add_box_outlined, size: 22, color: selected ? WmColors.green : WmColors.textMuted),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(dest.projectName, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                      Text(dest.workName, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
                    ]),
                  ),
                  if (selected) const Icon(Icons.check_circle, size: 22, color: WmColors.green),
                ]),
              ),
            ),
          ),
        ),
      );
}

/// Item name · Qty · + (spec §12). + opens Add item filled in; nothing is
/// added to the request until Add item is saved.
class _QuickAdd extends StatelessWidget {
  const _QuickAdd({required this.name, required this.qty, required this.onAdd});

  final TextEditingController name;
  final TextEditingController qty;
  final VoidCallback? onAdd;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(children: [
          Expanded(
            child: TextField(
              key: const Key('quick-name'),
              controller: name,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(hintText: 'Item name'),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 84,
            child: TextField(
              key: const Key('quick-qty'),
              controller: qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => onAdd?.call(),
              decoration: const InputDecoration(hintText: 'Qty'),
            ),
          ),
          const SizedBox(width: 8),
          Semantics(
            button: true,
            label: 'Add item',
            child: SizedBox(
              width: 48,
              height: 48,
              child: Material(
                key: const Key('add-item'),
                color: onAdd == null ? WmColors.textDisabled : WmColors.green,
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: onAdd,
                  child: const Icon(Icons.add, color: Colors.white, size: 26),
                ),
              ),
            ),
          ),
        ]),
      );
}
```

- [ ] **Step 5: The opener shows the sheet**

`lib/requests/list/request_openers.dart`:

```dart
/// [draft] in the New request sheet (redesign Phase 3c), then the list is read
/// again. [resumed]: reopened from its draft card.
Future<void> composeRequest(
  BuildContext context,
  RequestsController controller,
  RequestsServices services,
  RequestDraft draft, {
  String? editLine,
  bool resumed = false,
}) async {
  await showWmSheet<bool>(
    context,
    builder: (_) => ComposeScreen(draft: draft, services: services, editLineOnOpen: editLine, resumed: resumed),
  );
  await controller.refresh();
}
```

  In `openRequestEntry`, the draft branch passes `resumed: true`, and `onEditDraft`'s
  `composeRequest(context, controller, services, draft)` also passes `resumed: true`. `newRequest` and the tab's Find
  previous flow stay `resumed: false`.

- [ ] **Step 6: Version** — `pubspec.yaml` `version: 0.14.1+1020` → `version: 0.14.2+1021`.

- [ ] **Step 7: Run everything**

`flutter analyze` → `No issues found!`; `flutter test test/requests test/history test/ui test/home`; then the full
`flutter test` (before: 1302) — report the count and `grep -c "Warning: A call to tap()"` (expected 0).

- [ ] **Step 8: Checkpoint (no commit, no build)** — report the files, the analyze result and the test count.
