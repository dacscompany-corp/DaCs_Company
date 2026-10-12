# WorkMate Stage 1b-4 — Find Previous Item in the App (0.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WorkMate 0.5.0 lets a worker find an item their projects used before — search with filters, photo cards, the item's dated history — and **Request this item again** into the current draft or a new one, with the history link kept, plus a bounded per-worker offline copy; then a release build and a phone pilot.

**Architecture:** A new `lib/history/` feature beside `lib/requests/`, layered like Requests: `domain/` (plain models of what 0090 returns), `data/` (`HistoryRemote` RPC calls, `HistoryDb` sqflite offline copy, `HistoryRepository` behind the `HistoryApi` interface), `ui/` (two screens and a photo thumbnail). Requests gets one optional `history` service: the item editor gains a *Find previous item* link, the Requests tab a *Find previous item* button, and a draft line carries `refKind`/`refId` (sent) and `refCoverPath` (display only). `main.dart` builds the repository and keeps the offline copy for the signed-in worker only.

**Tech Stack:** Flutter (Dart ^3.10.8, flutter_lints 6), sqflite (+ `sqflite_common_ffi` in tests), supabase_flutter 2.17.2 (`rpc`, `storage.download`), the existing Requests/Attendance UI kit (`FailureNotice`, `noticeAction`, `Bilingual`, `WmColors`, `dayMonth`/`clockTime`).

**Spec:** `docs/superpowers/specs/2026-10-09-workmate-stage1b-item-history-design.md` (Dacs Web repo) — §4.3 WorkMate app, §4.4 Offline copy, §4.1 visibility rules. Server: `supabase/migrations/0090_workmate_item_history.sql` (live since 2026-10-09). Office screens: plan 1b-2 (done).

## Global Constraints

- **Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate` (clean at `2fc428e`, version `0.4.0+1004`). Paths below are relative to it. This plan file lives in the Dacs Web repo.
- **NEVER `git commit` / `git push`** in either repo. The user commits. Every task ends "Stop — no commit".
- **Write files with the Edit tool or Python** (`open(p, 'w', encoding='utf-8', newline='')`), **never PowerShell text output**. All WorkMate files are **LF, UTF-8, no BOM** — keep them so.
- **Done means:** the task's tests pass, the whole `flutter test` passes, and `flutter analyze` prints `No issues found!`.
- **No database changes.** 0090 is live. Worker calls, verbatim: `pr_history_search(p_query, p_kind, p_category, p_folder, p_from, p_to, p_limit, p_offset)` → `{items, has_more}`; `pr_history_item(p_item)` → item + `photos` + `entries`; `pr_history_visible(p_items)` (≤ 500 ids) → `[{item_id, entries:['kind:id'], photo_ids}]`; photos from private bucket **`item-gallery`** via `storage.download` (never a stored signed link). Server codes: `HISTORY_NOT_AVAILABLE`, `NOT_A_REQUESTER`, `APP_UPDATE_REQUIRED`, `AUTH_REQUIRED`, `BAD_REFERENCE`.
- **Offline copy (spec §4.4):** every saved row scoped by `worker_id` (site phones are shared); at most **200 items** and **200 photos / 20 MB**, least recently viewed evicted first; a saved item older than **14 days** is not shown; `pr_history_visible` cleanup on every online open of Find Previous Item (per entry and per photo, not just per item); only the signed-in worker's copy is kept — signed out keeps nothing.
- **Request Again never sends** and copies only the catalogue item (id, name, spec, unit, category) and the `(ref_kind, ref_id)` link. The cover path is display-only: never sent, never a request photo. A line sends the link only together with its `catalog_item_id`; picking another item drops it.
- **The worker never sees** who asked, prices, payments, stock or "in stock". (0090 already returns `requester_name: null` to workers; request-line entries carry no note.)
- **Copy:** screen text English; failure text bilingual — English, then Tagalog — like Attendance and Requests.
- **Dates:** never `toIso8601String().substring(0, 10)` for a local day; build `yyyy-mm-dd` from local parts (PH is UTC+8).
- **Release:** `flutter build apk --release` (never `--split-per-abi`), `JAVA_HOME` = JDK 21. The keystore and its passwords never go to git and are never printed.

## Rulings made while planning

- **Own database file** `workmate_history.db`, like Requests' own `workmate_requests.db` (spec §4.4 says "the app's existing sqflite database"). Same app-private storage and per-worker rows; a separate file means a history problem can never break Requests or Attendance. Cost if wrong: a one-file move later.
- **Date filter as presets** — Any time / Last 30 days / Last 3 months / Last 12 months — instead of a calendar range picker: finger-sized, and the server takes any `from`. Cost if wrong: add a range picker later; nothing else changes.
- **Cleanup runs when Find Previous Item opens** (spec: "on each online refresh"), quietly, never blocking the search; offline it does nothing.
- **Standalone Request Again** opens the new draft *on the item editor* (quantity, needed-by) and then the draft (project, work, team). Spec §4.3 asks for all four; only the order is chosen here.
- **Wipe = keep only the current worker** on every app-state change (`Ready` keeps that worker, `SignedOut` keeps nobody; startup and Terms screens decide nothing). This also cleans an account switch that happened while the app was closed.
- **"No longer listed"** items show their history but hide every Request again button (spec §4.3).

## File structure

| File | Responsibility |
|---|---|
| `lib/history/domain/history_models.dart` (C) | `HistoryCard`, `HistoryPage`, `HistoryItem`, `HistoryEntry`, `HistoryPhoto`, `HistoryLatest`, `HistoryPick`, `HistoryQuery`, `historyDateLabel`, `historyWhere` |
| `lib/history/domain/history_failure.dart` (C) | `HistoryFailure` + `HistoryUnavailable`; server codes and network errors → what the worker is told |
| `lib/history/data/history_remote.dart` (C) | `HistoryRemote` + `SupabaseHistoryRemote` (three RPCs + gallery download), `searchParams` |
| `lib/history/data/history_db.dart` (C) | `HistoryDb`: `saved_item`, `saved_photo` (per worker) |
| `lib/history/data/history_api.dart` (C) | `HistoryApi` interface + `HistoryItemView` |
| `lib/history/data/history_repository.dart` (C) | Online/offline search and item, saving, limits, `refreshSaved`, `photo`, `keepOnly` |
| `lib/history/data/history_account_wipe.dart` (C) | Keeps only the signed-in worker's copy |
| `lib/history/ui/history_copy.dart` (C) | Screen strings + bilingual failure copy |
| `lib/history/ui/history_thumb.dart` (C) | A gallery photo from the phone, else placeholder |
| `lib/history/ui/find_previous_screen.dart` (C) | Search + filters + cards + states; `historyProjects`, `historyCategories`, `HistoryPeriod` |
| `lib/history/ui/history_item_screen.dart` (C) | Photos, details, entries, Request again |
| `lib/requests/domain/request_draft.dart` (M) | `DraftLine.refKind/refId/refCoverPath`, `fromHistory`, `withoutRef`; payload sends the link |
| `lib/requests/domain/request_failure.dart`, `lib/requests/ui/requests_copy.dart` (M) | `RequestFailure.badReference` + its copy |
| `lib/requests/requests_services.dart` (M) | Optional `history` |
| `lib/requests/compose/item_editor_screen.dart` (M) | *Find previous item* link, link kept honest, cover on the picked item |
| `lib/requests/compose/compose_screen.dart` (M) | Cover on line cards; `editLineOnOpen` |
| `lib/requests/list/requests_screen.dart` (M) | *Find previous item* button → new draft |
| `lib/main.dart`, `pubspec.yaml` (M) | Build the repository + wipe; version `0.5.0+1005` |
| `test/history/**` (C) | Samples, fakes, model / repository / wipe / screen / Request-again tests |

---
### Task 1: History models, failures, and the draft line's link

**Files:**
- Create: `lib/history/domain/history_models.dart`, `lib/history/domain/history_failure.dart`
- Modify: `lib/requests/domain/request_draft.dart`, `lib/requests/domain/request_failure.dart`, `lib/requests/ui/requests_copy.dart`
- Test: `test/history/history_samples.dart` (shared JSON samples), `test/history/domain/history_models_test.dart`

**Interfaces:**
- Consumes: `ItemKind` (`lib/requests/domain/request_models.dart`: `material`/`tool`, `.wire`, `.label`, `ItemKind.parse`); `RequestDraft`, `DraftLine`, `submitPayload` (`request_draft.dart`); `RequestFailure.of` (`request_failure.dart`); `failureCopy`, `Bilingual`, `AttendanceFailure` (`attendance/ui/attendance_copy.dart`).
- Produces:
  - `historyDateLabel(String? date, String precision) → String` — `'3 Oct 2026'` / `'around Aug 2026'` / `'Date unknown'`; `historyWhere(projectName, workName) → 'Barlin Residence · Main Contract'`.
  - `HistoryLatest {entryKind, entryId, label, projectName, workName, date, datePrecision}`, `.summary → 'Latest: Requested · 3 Oct 2026 · Barlin Residence'`.
  - `HistoryCard.fromJson(Map) → HistoryCard?` (null for an unknown kind), `.toJson()`; fields `id, kind, name, spec, unit, category, brand, aliases, active, coverPath, latest`.
  - `HistoryPage({items, hasMore, savedAt})`, `HistoryPage.fromJson`, `.fromSaved`.
  - `HistoryPhoto {id, path, isCover}`; `HistoryEntry {entryKind, entryId, label, projectId, projectName, workName, date, datePrecision, quantity, unit, description, note}`, `.key → 'request_line:<id>'`.
  - `HistoryItem.fromJson → HistoryItem?`, `.toJson`, `.copyWith(photos:, entries:)`, `.toCard()`; fields as the card plus `photos`, `entries`.
  - `HistoryPick.of(HistoryItem, HistoryEntry)` → `{itemId, kind, name, spec, unit, category, refKind, refId, coverPath}`.
  - `HistoryQuery({text='', kind, category, projectId, from, to})`, `.copyWith(...)` (can clear a filter by passing null), `.hasFilters`.
  - `HistoryFailure {notAvailable, noConnection, savedTooOld, sessionExpired, notARequester, appUpdateRequired, unexpected}`, `HistoryFailure.of(Object) → HistoryFailure`, `HistoryUnavailable(HistoryFailure)` (an exception).
  - `DraftLine.refKind`, `.refId`, `.refCoverPath`, `.fromHistory` (bool getter), `DraftLine.fromHistory(id, HistoryPick)`, `.withoutRef()`; JSON keys `ref_kind`, `ref_id`, `ref_cover_path`; `submitPayload` line gains `ref_kind`/`ref_id` only when `catalogItemId != null && fromHistory`.
  - `RequestFailure.badReference` (`'BAD_REFERENCE'`) with bilingual copy.

- [ ] **Step 1: Write the failing tests**

#### Create `test/history/history_samples.dart`

```dart
// What 0090's worker RPCs return, as the phone receives it (JSON).

Map<String, dynamic> cardJson({
  String id = 'i1',
  String kind = 'material',
  String name = 'Outlet',
  bool active = true,
  String? cover = 'o1/i1/p1.jpg',
  Map<String, dynamic>? latest,
}) =>
    {
      'id': id,
      'kind': kind,
      'name': name,
      'spec': '2-gang',
      'unit': 'pc',
      'category': 'electrical',
      'brand': 'Omni',
      'aliases': ['saksakan'],
      'active': active,
      'cover_path': cover,
      'latest': latest ??
          {
            'entry_kind': 'request_line',
            'entry_id': 'l1',
            'label': 'Requested',
            'project_id': 'f1',
            'project_name': 'Barlin Residence',
            'work_id': 'f1',
            'work_name': 'Main Contract',
            'date': '2026-10-03',
            'date_precision': 'exact',
          },
    };

Map<String, dynamic> entryJson({
  String kind = 'request_line',
  String id = 'l1',
  String label = 'Requested',
  String projectId = 'f1',
  String project = 'Barlin Residence',
  String work = 'Main Contract',
  String? date = '2026-10-03',
  String precision = 'exact',
  num? quantity = 6,
  String? description,
  String? note,
}) =>
    {
      'entry_kind': kind,
      'entry_id': id,
      'label': label,
      'project_id': projectId,
      'project_name': project,
      'work_id': projectId,
      'work_name': work,
      'date': date,
      'date_precision': precision,
      'quantity': quantity,
      'unit': kind == 'request_line' ? 'pc' : null,
      'description': description,
      'note': note,
      'retired': false,
      'requester_name': null,
    };

Map<String, dynamic> itemJson({
  String id = 'i1',
  bool active = true,
  List<Map<String, dynamic>>? photos,
  List<Map<String, dynamic>>? entries,
}) =>
    {
      'id': id,
      'kind': 'material',
      'name': 'Outlet',
      'spec': '2-gang',
      'unit': 'pc',
      'category': 'electrical',
      'brand': 'Omni',
      'aliases': ['saksakan'],
      'active': active,
      'photos': photos ??
          [
            {'id': 'p1', 'path': 'o1/$id/p1.jpg', 'is_cover': true, 'status': 'approved'},
            {'id': 'p2', 'path': 'o1/$id/p2.jpg', 'is_cover': false, 'status': 'approved'},
          ],
      'entries': entries ??
          [
            entryJson(),
            entryJson(kind: 'reference', id: 'r1', label: 'Historical reference', date: '2026-08-01', precision: 'approximate',
                quantity: null, description: 'Kitchen outlets', note: 'old Messenger photo'),
          ],
    };
```

#### Create `test/history/domain/history_models_test.dart`

```dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/history/domain/history_failure.dart';
import 'package:workmate/history/domain/history_models.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_failure.dart';
import 'package:workmate/requests/domain/request_models.dart';

import '../history_samples.dart';

const site = Destination(projectId: 'f1', projectName: 'Barlin Residence', workId: 'f1', workName: 'Main Contract', isMain: true);

void main() {
  group('dates', () {
    test('an exact day, "around" a month, or Date unknown — never shifted a day', () {
      expect(historyDateLabel('2026-10-03', 'exact'), '3 Oct 2026');
      expect(historyDateLabel('2026-08-01', 'approximate'), 'around Aug 2026');
      expect(historyDateLabel(null, 'unknown'), 'Date unknown');
      expect(historyDateLabel(null, 'exact'), 'Date unknown');
      expect(historyDateLabel('2026-13-01', 'exact'), 'Date unknown');
    });
  });

  group('search results', () {
    test('a card reads the 0090 shape, with its latest visible entry', () {
      final page = HistoryPage.fromJson({'items': [cardJson()], 'has_more': true});
      expect(page.hasMore, isTrue);
      expect(page.fromSaved, isFalse);
      final c = page.items.single;
      expect([c.id, c.name, c.spec, c.unit, c.brand, c.coverPath], ['i1', 'Outlet', '2-gang', 'pc', 'Omni', 'o1/i1/p1.jpg']);
      expect(c.aliases, ['saksakan']);
      expect(c.latest!.summary, 'Latest: Requested · 3 Oct 2026 · Barlin Residence');
    });

    test('a kind this build does not know is left out, not shown broken', () {
      final page = HistoryPage.fromJson({'items': [cardJson(kind: 'vehicle'), cardJson(id: 'i2')], 'has_more': false});
      expect(page.items.map((c) => c.id), ['i2']);
    });

    test('an item with no visible history has no latest line', () {
      final j = cardJson()..['latest'] = null;
      expect(HistoryCard.fromJson(j)!.latest, isNull);
    });
  });

  group('one item', () {
    test('photos cover first, entries newest first, labels and quantities as sent', () {
      final item = HistoryItem.fromJson(itemJson())!;
      expect(item.photos.first.isCover, isTrue);
      expect(item.entries.map((e) => e.key), ['request_line:l1', 'reference:r1']);
      expect(item.entries.first.quantity, 6);
      expect(item.entries.last.quantity, isNull);
      expect(historyDateLabel(item.entries.last.date, item.entries.last.datePrecision), 'around Aug 2026');
    });

    test('saved and read back unchanged (the offline copy)', () {
      final item = HistoryItem.fromJson(itemJson())!;
      final back = HistoryItem.fromJson(jsonDecode(jsonEncode(item.toJson())) as Map<String, dynamic>)!;
      expect(back.toJson(), item.toJson());
    });

    test('its offline card shows the cover and the newest entry', () {
      final card = HistoryItem.fromJson(itemJson())!.toCard();
      expect(card.coverPath, 'o1/i1/p1.jpg');
      expect(card.latest!.entryId, 'l1');
    });
  });

  group('Request Again', () {
    final item = HistoryItem.fromJson(itemJson())!;

    test('the pick carries the item and the entry — never a quantity', () {
      final pick = HistoryPick.of(item, item.entries.last);
      final line = DraftLine.fromHistory('x1', pick);
      expect([line.catalogItemId, line.description, line.spec, line.unit, line.category], ['i1', 'Outlet', '2-gang', 'pc', 'electrical']);
      expect([line.refKind, line.refId, line.refCoverPath], ['reference', 'r1', 'o1/i1/p1.jpg']);
      expect(line.quantity, '', reason: 'the worker types the quantity');
      expect(line.fromHistory, isTrue);
    });

    test('the link survives saving and reopening the draft', () {
      final line = DraftLine.fromHistory('x1', HistoryPick.of(item, item.entries.first));
      final back = DraftLine.fromJson(jsonDecode(jsonEncode(line.toJson())) as Map<String, dynamic>);
      expect([back.refKind, back.refId, back.refCoverPath], ['request_line', 'l1', 'o1/i1/p1.jpg']);
    });

    test('the link is sent with the line; a plain line sends none', () {
      final linked = DraftLine.fromHistory('x1', HistoryPick.of(item, item.entries.first)).copyWith(quantity: '4');
      const plain = DraftLine(id: 'x2', description: 'Sand', unit: 'bag', quantity: '2');
      final d = RequestDraft(id: 'd1', createdAt: DateTime.utc(2026, 10, 9), destination: site, lines: [linked, plain]);
      final lines = (submitPayload(d)['lines'] as List).cast<Map<String, dynamic>>();
      expect(lines[0]['ref_kind'], 'request_line');
      expect(lines[0]['ref_id'], 'l1');
      expect(lines[0].containsKey('ref_cover_path'), isFalse, reason: 'the cover is for the screen only');
      expect(lines[1].containsKey('ref_kind'), isFalse);
      expect(lines[1].containsKey('ref_id'), isFalse);
    });

    test('withoutRef drops the whole link', () {
      final line = DraftLine.fromHistory('x1', HistoryPick.of(item, item.entries.first)).withoutRef();
      expect([line.refKind, line.refId, line.refCoverPath], [null, null, null]);
      expect(line.catalogItemId, 'i1');
    });
  });

  group('failures', () {
    test('server codes map to what the worker is told', () {
      expect(HistoryFailure.of(Exception('HISTORY_NOT_AVAILABLE')), HistoryFailure.notAvailable);
      expect(HistoryFailure.of(Exception('NOT_A_REQUESTER')), HistoryFailure.notARequester);
      expect(HistoryFailure.of(const HistoryUnavailable(HistoryFailure.savedTooOld)), HistoryFailure.savedTooOld);
      expect(HistoryFailure.of(Exception('boom')), HistoryFailure.unexpected);
      expect(RequestFailure.of(Exception('BAD_REFERENCE')), RequestFailure.badReference);
    });
  });
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/history/domain`
Expected: FAIL — compile error, `lib/history/domain/history_models.dart` not found.

- [ ] **Step 3: Create the domain files**

#### Create `lib/history/domain/history_models.dart`

```dart
import '../../requests/domain/request_models.dart';

// Find Previous Item (Stage 1b, migration 0090). The shapes of what
// pr_history_search / pr_history_item return. No price, amount or cost
// exists anywhere in them: workers never see procurement money.

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "3 Oct 2026", "around Aug 2026" or "Date unknown". A history date is a
/// calendar day (or a month, or unknown): its parts are read, never passed
/// through a time zone (PH is UTC+8 — a shift would move it a day).
String historyDateLabel(String? date, String precision) {
  if (precision == 'unknown' || date == null) return 'Date unknown';
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(date);
  if (m == null) return 'Date unknown';
  final month = int.parse(m.group(2)!);
  if (month < 1 || month > 12) return 'Date unknown';
  if (precision == 'approximate') return 'around ${_months[month - 1]} ${m.group(1)}';
  return '${int.parse(m.group(3)!)} ${_months[month - 1]} ${m.group(1)}';
}

/// Main Contract, or the Additional Works job's name.
String historyWhere(String projectName, String workName) => '$projectName · $workName';

/// The newest entry the worker may see for an item (inside the filters).
class HistoryLatest {
  const HistoryLatest({
    required this.entryKind,
    required this.entryId,
    required this.label,
    required this.projectName,
    required this.workName,
    required this.date,
    required this.datePrecision,
  });

  factory HistoryLatest.fromJson(Map<String, dynamic> j) => HistoryLatest(
        entryKind: j['entry_kind'] as String,
        entryId: j['entry_id'] as String,
        label: j['label'] as String,
        projectName: (j['project_name'] as String?) ?? '',
        workName: (j['work_name'] as String?) ?? 'Main Contract',
        date: j['date'] as String?,
        datePrecision: (j['date_precision'] as String?) ?? 'unknown',
      );

  final String entryKind;
  final String entryId;

  /// 'Requested', 'Requested — cancelled' or 'Historical reference'.
  final String label;
  final String projectName;
  final String workName;
  final String? date;
  final String datePrecision;

  Map<String, dynamic> toJson() => {
        'entry_kind': entryKind,
        'entry_id': entryId,
        'label': label,
        'project_name': projectName,
        'work_name': workName,
        'date': date,
        'date_precision': datePrecision,
      };

  /// "Latest: Requested · 3 Oct 2026 · Barlin Residence"
  String get summary => 'Latest: $label · ${historyDateLabel(date, datePrecision)} · $projectName';
}

/// One search result: a catalogue item with history the worker may see.
class HistoryCard {
  const HistoryCard({
    required this.id,
    required this.kind,
    required this.name,
    required this.spec,
    required this.unit,
    required this.category,
    required this.brand,
    required this.aliases,
    required this.active,
    required this.coverPath,
    required this.latest,
  });

  /// Null for a kind this build does not know (it could not be requested).
  static HistoryCard? fromJson(Map<String, dynamic> j) {
    final kind = ItemKind.parse(j['kind'] as String?);
    if (kind == null) return null;
    final latest = j['latest'];
    return HistoryCard(
      id: j['id'] as String,
      kind: kind,
      name: j['name'] as String,
      spec: (j['spec'] as String?) ?? '',
      unit: j['unit'] as String,
      category: (j['category'] as String?) ?? '',
      brand: (j['brand'] as String?) ?? '',
      aliases: [for (final a in (j['aliases'] as List<dynamic>? ?? const [])) a as String],
      active: j['active'] != false,
      coverPath: j['cover_path'] as String?,
      latest: latest == null ? null : HistoryLatest.fromJson(Map<String, dynamic>.from(latest as Map)),
    );
  }

  final String id;
  final ItemKind kind;
  final String name;
  final String spec;
  final String unit;
  final String category;
  final String brand;
  final List<String> aliases;

  /// False: no longer listed — it cannot be requested again.
  final bool active;
  final String? coverPath;
  final HistoryLatest? latest;

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind.wire,
        'name': name,
        'spec': spec,
        'unit': unit,
        'category': category,
        'brand': brand,
        'aliases': aliases,
        'active': active,
        'cover_path': coverPath,
        'latest': latest?.toJson(),
      };
}

/// One page of search results.
class HistoryPage {
  const HistoryPage({required this.items, required this.hasMore, this.savedAt});

  factory HistoryPage.fromJson(Map<String, dynamic> j) => HistoryPage(
        items: [
          for (final i in (j['items'] as List<dynamic>? ?? const []))
            ?HistoryCard.fromJson(Map<String, dynamic>.from(i as Map)),
        ],
        hasMore: j['has_more'] == true,
      );

  final List<HistoryCard> items;
  final bool hasMore;

  /// Set when the page came from what this phone saved (no signal): the
  /// oldest save time among the shown items.
  final DateTime? savedAt;

  bool get fromSaved => savedAt != null;
}

/// An approved product photo (private bucket item-gallery).
class HistoryPhoto {
  const HistoryPhoto({required this.id, required this.path, required this.isCover});

  factory HistoryPhoto.fromJson(Map<String, dynamic> j) =>
      HistoryPhoto(id: j['id'] as String, path: j['path'] as String, isCover: j['is_cover'] == true);

  final String id;
  final String path;
  final bool isCover;

  Map<String, dynamic> toJson() => {'id': id, 'path': path, 'is_cover': isCover};
}

/// One dated line of an item's history.
class HistoryEntry {
  const HistoryEntry({
    required this.entryKind,
    required this.entryId,
    required this.label,
    required this.projectId,
    required this.projectName,
    required this.workName,
    required this.date,
    required this.datePrecision,
    required this.quantity,
    required this.unit,
    required this.description,
    required this.note,
  });

  factory HistoryEntry.fromJson(Map<String, dynamic> j) => HistoryEntry(
        entryKind: j['entry_kind'] as String,
        entryId: j['entry_id'] as String,
        label: j['label'] as String,
        projectId: (j['project_id'] as String?) ?? '',
        projectName: (j['project_name'] as String?) ?? '',
        workName: (j['work_name'] as String?) ?? 'Main Contract',
        date: j['date'] as String?,
        datePrecision: (j['date_precision'] as String?) ?? 'unknown',
        quantity: (j['quantity'] as num?)?.toDouble(),
        unit: j['unit'] as String?,
        description: j['description'] as String?,
        note: j['note'] as String?,
      );

  /// 'request_line' or 'reference' — with [entryId], the Request Again link.
  final String entryKind;
  final String entryId;
  final String label;
  final String projectId;
  final String projectName;
  final String workName;
  final String? date;
  final String datePrecision;

  /// Still-needed quantity of a requested line; null for a cancelled line or a reference.
  final double? quantity;
  final String? unit;

  /// Staff text of a historical reference (null for requests).
  final String? description;
  final String? note;

  /// `request_line:<id>` — the key pr_history_visible returns.
  String get key => '$entryKind:$entryId';

  Map<String, dynamic> toJson() => {
        'entry_kind': entryKind,
        'entry_id': entryId,
        'label': label,
        'project_id': projectId,
        'project_name': projectName,
        'work_name': workName,
        'date': date,
        'date_precision': datePrecision,
        'quantity': quantity,
        'unit': unit,
        'description': description,
        'note': note,
      };
}

/// One item's page: photos (cover first) and entries (newest first).
class HistoryItem {
  const HistoryItem({
    required this.id,
    required this.kind,
    required this.name,
    required this.spec,
    required this.unit,
    required this.category,
    required this.brand,
    required this.aliases,
    required this.active,
    required this.photos,
    required this.entries,
  });

  static HistoryItem? fromJson(Map<String, dynamic> j) {
    final kind = ItemKind.parse(j['kind'] as String?);
    if (kind == null) return null;
    return HistoryItem(
      id: j['id'] as String,
      kind: kind,
      name: j['name'] as String,
      spec: (j['spec'] as String?) ?? '',
      unit: j['unit'] as String,
      category: (j['category'] as String?) ?? '',
      brand: (j['brand'] as String?) ?? '',
      aliases: [for (final a in (j['aliases'] as List<dynamic>? ?? const [])) a as String],
      active: j['active'] != false,
      photos: [for (final p in (j['photos'] as List<dynamic>? ?? const [])) HistoryPhoto.fromJson(Map<String, dynamic>.from(p as Map))],
      entries: [for (final e in (j['entries'] as List<dynamic>? ?? const [])) HistoryEntry.fromJson(Map<String, dynamic>.from(e as Map))],
    );
  }

  final String id;
  final ItemKind kind;
  final String name;
  final String spec;
  final String unit;
  final String category;
  final String brand;
  final List<String> aliases;
  final bool active;
  final List<HistoryPhoto> photos;
  final List<HistoryEntry> entries;

  HistoryItem copyWith({List<HistoryPhoto>? photos, List<HistoryEntry>? entries}) => HistoryItem(
        id: id,
        kind: kind,
        name: name,
        spec: spec,
        unit: unit,
        category: category,
        brand: brand,
        aliases: aliases,
        active: active,
        photos: photos ?? this.photos,
        entries: entries ?? this.entries,
      );

  /// The card search shows for this item when offline.
  HistoryCard toCard() => HistoryCard(
        id: id,
        kind: kind,
        name: name,
        spec: spec,
        unit: unit,
        category: category,
        brand: brand,
        aliases: aliases,
        active: active,
        coverPath: photos.isEmpty ? null : photos.first.path,
        latest: entries.isEmpty
            ? null
            : HistoryLatest(
                entryKind: entries.first.entryKind,
                entryId: entries.first.entryId,
                label: entries.first.label,
                projectName: entries.first.projectName,
                workName: entries.first.workName,
                date: entries.first.date,
                datePrecision: entries.first.datePrecision,
              ),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind.wire,
        'name': name,
        'spec': spec,
        'unit': unit,
        'category': category,
        'brand': brand,
        'aliases': aliases,
        'active': active,
        'photos': [for (final p in photos) p.toJson()],
        'entries': [for (final e in entries) e.toJson()],
      };
}

/// What "Request this item again" hands to the request being written: the
/// item and the entry the worker recognised. Never a quantity, a price, a
/// purchase or anyone's stock (spec §4.3).
class HistoryPick {
  const HistoryPick({
    required this.itemId,
    required this.kind,
    required this.name,
    required this.spec,
    required this.unit,
    required this.category,
    required this.refKind,
    required this.refId,
    this.coverPath,
  });

  factory HistoryPick.of(HistoryItem item, HistoryEntry entry) => HistoryPick(
        itemId: item.id,
        kind: item.kind,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        category: item.category,
        refKind: entry.entryKind,
        refId: entry.entryId,
        coverPath: item.photos.isEmpty ? null : item.photos.first.path,
      );

  final String itemId;
  final ItemKind kind;
  final String name;
  final String spec;
  final String unit;
  final String category;
  final String refKind;
  final String refId;
  final String? coverPath;
}

/// The filters of one search (spec §4.3).
class HistoryQuery {
  const HistoryQuery({this.text = '', this.kind, this.category, this.projectId, this.from, this.to});

  final String text;
  final ItemKind? kind;
  final String? category;
  final String? projectId;

  /// "2026-10-01" — calendar days.
  final String? from;
  final String? to;

  HistoryQuery copyWith({
    String? text,
    Object? kind = _keep,
    Object? category = _keep,
    Object? projectId = _keep,
    Object? from = _keep,
    Object? to = _keep,
  }) =>
      HistoryQuery(
        text: text ?? this.text,
        kind: identical(kind, _keep) ? this.kind : kind as ItemKind?,
        category: identical(category, _keep) ? this.category : category as String?,
        projectId: identical(projectId, _keep) ? this.projectId : projectId as String?,
        from: identical(from, _keep) ? this.from : from as String?,
        to: identical(to, _keep) ? this.to : to as String?,
      );

  bool get hasFilters => kind != null || category != null || projectId != null || from != null || to != null;
}

const _keep = Object();
```

#### Create `lib/history/domain/history_failure.dart`

```dart
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart' show AuthRetryableFetchException;

/// Thrown by the history repository when the phone has no fresh copy to show.
class HistoryUnavailable implements Exception {
  const HistoryUnavailable(this.failure);
  final HistoryFailure failure;

  @override
  String toString() => 'HistoryUnavailable(${failure.name})';
}

/// Every way Find Previous Item can fail. The 0090 RPCs raise stable codes;
/// anything else is [unexpected], never a guess.
enum HistoryFailure {
  /// HISTORY_NOT_AVAILABLE: no entry of this item is visible (switched off, retired).
  notAvailable,

  /// No signal and nothing saved on this phone (or saved more than 14 days ago).
  noConnection,

  /// Offline, and this phone's copy is older than the 14-day limit.
  savedTooOld,
  sessionExpired,
  notARequester,
  appUpdateRequired,
  unexpected;

  static const _byCode = <String, HistoryFailure>{
    'HISTORY_NOT_AVAILABLE': notAvailable,
    'NOT_A_REQUESTER': notARequester,
    'APP_UPDATE_REQUIRED': appUpdateRequired,
    'AUTH_REQUIRED': sessionExpired,
  };

  static HistoryFailure of(Object error) {
    if (error is HistoryUnavailable) return error.failure;
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

- [ ] **Step 4: Give the draft line its link, and the new server code**

**Edit `lib/requests/domain/request_draft.dart` (1/8).** Find:

```dart
import 'quantity.dart';
import 'request_models.dart';

```

Replace with:

```dart
import '../../history/domain/history_models.dart';
import 'quantity.dart';
import 'request_models.dart';

```

**Edit `lib/requests/domain/request_draft.dart` (2/8).** Find:

```dart
    this.notes = '',
    this.photos = const [],
  });

  /// A line copied from an official catalogue item (spec §4A).
```

Replace with:

```dart
    this.notes = '',
    this.photos = const [],
    this.refKind,
    this.refId,
    this.refCoverPath,
  });

  /// Request Again (spec 1b §4.3): the item and the history entry the worker
  /// recognised. Quantity and needed-by stay for the worker to fill in.
  factory DraftLine.fromHistory(String id, HistoryPick pick) => DraftLine(
        id: id,
        kind: pick.kind,
        catalogItemId: pick.itemId,
        description: pick.name,
        spec: pick.spec,
        unit: pick.unit,
        category: pick.category,
        refKind: pick.refKind,
        refId: pick.refId,
        refCoverPath: pick.coverPath,
      );

  /// A line copied from an official catalogue item (spec §4A).
```

**Edit `lib/requests/domain/request_draft.dart` (3/8).** Find:

```dart
        photos: [for (final p in (j['photos'] as List<dynamic>? ?? const [])) p as String],
      );
```

Replace with:

```dart
        photos: [for (final p in (j['photos'] as List<dynamic>? ?? const [])) p as String],
        refKind: j['ref_kind'] as String?,
        refId: j['ref_id'] as String?,
        refCoverPath: j['ref_cover_path'] as String?,
      );
```

**Edit `lib/requests/domain/request_draft.dart` (4/8).** Find:

```dart
  /// Prepared JPEGs in app-private storage, sent after the request lands.
  final List<String> photos;

```

Replace with:

```dart
  /// Prepared JPEGs in app-private storage, sent after the request lands.
  final List<String> photos;

  /// The history entry this line was requested again from ('request_line' or
  /// 'reference' + its id), or null. Both or neither; tied to [catalogItemId].
  final String? refKind;
  final String? refId;

  /// The item's gallery cover (bucket item-gallery), shown for recognition only —
  /// never sent and never attached as a request photo.
  final String? refCoverPath;

  bool get fromHistory => refKind != null && refId != null;

```

**Edit `lib/requests/domain/request_draft.dart` (5/8).** Find:

```dart
    String? notes,
    List<String>? photos,
  }) =>
```

Replace with:

```dart
    String? notes,
    List<String>? photos,
    Object? refKind = _keep,
    Object? refId = _keep,
    Object? refCoverPath = _keep,
  }) =>
```

**Edit `lib/requests/domain/request_draft.dart` (6/8).** Find:

```dart
        notes: notes ?? this.notes,
        photos: photos ?? this.photos,
      );
```

Replace with:

```dart
        notes: notes ?? this.notes,
        photos: photos ?? this.photos,
        refKind: identical(refKind, _keep) ? this.refKind : refKind as String?,
        refId: identical(refId, _keep) ? this.refId : refId as String?,
        refCoverPath: identical(refCoverPath, _keep) ? this.refCoverPath : refCoverPath as String?,
      );

  /// The same line with no Request Again link (another item was picked).
  DraftLine withoutRef() => copyWith(refKind: null, refId: null, refCoverPath: null);
```

**Edit `lib/requests/domain/request_draft.dart` (7/8).** Find:

```dart
        'notes': notes,
        'photos': photos,
      };
}
```

Replace with:

```dart
        'notes': notes,
        'photos': photos,
        'ref_kind': refKind,
        'ref_id': refId,
        'ref_cover_path': refCoverPath,
      };
}
```

**Edit `lib/requests/domain/request_draft.dart` (8/8).** Find:

```dart
            'notes': l.notes.trim(),
          },
      ],
    };
```

Replace with:

```dart
            'notes': l.notes.trim(),
            // 0090: the server keeps the link only while the worker may still see
            // that entry of the same item; otherwise it saves the line without it.
            if (l.catalogItemId != null && l.fromHistory) 'ref_kind': l.refKind,
            if (l.catalogItemId != null && l.fromHistory) 'ref_id': l.refId,
          },
      ],
    };
```

**Edit `lib/requests/domain/request_failure.dart` (1/2).** Find:

```dart
  badCatalogItem,

```

Replace with:

```dart
  badCatalogItem,

  /// 0090 BAD_REFERENCE: a Request Again link the server cannot use.
  badReference,

```

**Edit `lib/requests/domain/request_failure.dart` (2/2).** Find:

```dart
    'BAD_CATALOG_ITEM': badCatalogItem,

```

Replace with:

```dart
    'BAD_CATALOG_ITEM': badCatalogItem,
    'BAD_REFERENCE': badReference,

```

**Edit `lib/requests/ui/requests_copy.dart` (1/1).** Find:

```dart
          'Wala na sa listahan ang isang item. Piliin ulit o ilarawan ito.'),

```

Replace with:

```dart
          'Wala na sa listahan ang isang item. Piliin ulit o ilarawan ito.'),
      RequestFailure.badReference => const Bilingual(
          'An item picked from Find Previous Item could not be matched. Pick it again, then send again.',
          'Hindi maitugma ang isang item na pinili sa Find Previous Item. Piliin ulit, tapos ipadala ulit.'),

```

- [ ] **Step 5: Run the tests**

Run: `flutter test test/history/domain` → Expected: `All tests passed!` (12 tests).
Run: `flutter test` → Expected: `All tests passed!` (nothing else broke: old drafts without `ref_*` keys still load).
Run: `flutter analyze` → Expected: `No issues found!`

- [ ] **Step 6: Stop — no commit.** Report to the controller.

---

### Task 2: Server calls and the offline copy

**Files:**
- Create: `lib/history/data/history_remote.dart`, `lib/history/data/history_db.dart`, `lib/history/data/history_api.dart`, `lib/history/data/history_repository.dart`
- Test: `test/history/history_fakes.dart` (`FakeHistoryRemote`, `FakeHistoryApi`), `test/history/data/history_repository_test.dart`

**Interfaces:**
- Consumes (Task 1): `HistoryCard`, `HistoryPage`, `HistoryItem`, `HistoryEntry`, `HistoryPhoto`, `HistoryQuery`, `HistoryFailure`, `HistoryUnavailable`.
- Produces:
  - `galleryBucket = 'item-gallery'`; `searchParams(HistoryQuery, {offset, limit}) → Map` (the exact 0090 arguments, words trimmed, empty → null).
  - `abstract HistoryRemote { search(q, {offset, limit}) → Map; item(itemId) → Map; visible(List<String> itemIds) → List<Map>; download(path) → Uint8List }`; `SupabaseHistoryRemote(SupabaseClient)`.
  - `HistoryDb.open(DatabaseFactory, path, {singleInstance})`; `putItem/item/items/touchItem/deleteItem`, `putPhoto/photo/photos/touchPhoto/deletePhoto`, `workerIds()`, `forgetWorker(w) → files`, `close()`; `openDeviceHistoryDb()`.
  - `HistoryItemView({item, savedAt})`, `.fromSaved`.
  - `abstract interface HistoryApi { search(q, {offset = 0}) → HistoryPage; item(id) → HistoryItemView; refreshSaved(); photo(path) → File?; keepOnly(workerId) }`.
  - `HistoryRepository({db, remote, currentWorkerId, photoDir, now})` implements `HistoryApi`; constants `historyPageSize = 30`, `maxSavedItems = 200`, `maxSavedPhotos = 200`, `maxSavedPhotoBytes = 20 MB`, `maxSavedAge = 14 days`.

- [ ] **Step 1: Write the failing tests**

#### Create `test/history/history_fakes.dart`

```dart
import 'dart:io';
import 'dart:typed_data';

import 'package:workmate/history/data/history_api.dart';
import 'package:workmate/history/data/history_remote.dart';
import 'package:workmate/history/domain/history_models.dart';

import 'history_samples.dart';

/// A HistoryRemote whose answers the test sets, recording every call.
class FakeHistoryRemote implements HistoryRemote {
  Map<String, dynamic> searchAnswer = {'items': [cardJson()], 'has_more': false};
  final items = <String, Map<String, dynamic>>{'i1': itemJson()};
  List<Map<String, dynamic>>? visibleAnswer;

  /// Thrown by every call while set (e.g. a SocketException for "no signal").
  Object? error;
  final calls = <String>[];
  final downloads = <String>[];
  int photoBytes = 10;

  void _maybeFail() {
    if (error != null) throw error!;
  }

  @override
  Future<Map<String, dynamic>> search(HistoryQuery q, {required int offset, required int limit}) async {
    calls.add('search:${q.text}:$offset');
    _maybeFail();
    return searchAnswer;
  }

  @override
  Future<Map<String, dynamic>> item(String itemId) async {
    calls.add('item:$itemId');
    _maybeFail();
    final j = items[itemId];
    if (j == null) throw Exception('HISTORY_NOT_AVAILABLE');
    return j;
  }

  @override
  Future<List<Map<String, dynamic>>> visible(List<String> itemIds) async {
    calls.add('visible:${itemIds.join(',')}');
    _maybeFail();
    return visibleAnswer ?? const [];
  }

  @override
  Future<Uint8List> download(String path) async {
    downloads.add(path);
    _maybeFail();
    return Uint8List(photoBytes);
  }
}

/// A HistoryApi for screen tests.
class FakeHistoryApi implements HistoryApi {
  HistoryPage page = HistoryPage.fromJson({'items': [cardJson()], 'has_more': false});
  final items = <String, HistoryItemView>{'i1': HistoryItemView(item: HistoryItem.fromJson(itemJson())!)};

  /// Thrown by search / item while set.
  Object? error;
  final queries = <HistoryQuery>[];
  int refreshes = 0;
  final kept = <String>[];

  @override
  Future<HistoryPage> search(HistoryQuery q, {int offset = 0}) async {
    queries.add(q);
    if (error != null) throw error!;
    return page;
  }

  @override
  Future<HistoryItemView> item(String itemId) async {
    if (error != null) throw error!;
    final v = items[itemId];
    if (v == null) throw Exception('HISTORY_NOT_AVAILABLE');
    return v;
  }

  @override
  Future<void> refreshSaved() async => refreshes++;

  @override
  Future<File?> photo(String path) async => null;

  @override
  Future<void> keepOnly(String workerId) async => kept.add(workerId);
}
```

#### Create `test/history/data/history_repository_test.dart`

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/history/data/history_db.dart';
import 'package:workmate/history/data/history_remote.dart';
import 'package:workmate/history/data/history_repository.dart';
import 'package:workmate/history/domain/history_failure.dart';
import 'package:workmate/history/domain/history_models.dart';
import 'package:workmate/requests/domain/request_models.dart';

import '../history_fakes.dart';
import '../history_samples.dart';

void main() {
  late HistoryDb db;
  late FakeHistoryRemote remote;
  late Directory dir;
  late DateTime now;
  var worker = 'u1';
  late HistoryRepository repo;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await HistoryDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    remote = FakeHistoryRemote();
    dir = await Directory.systemTemp.createTemp('history-test');
    now = DateTime.utc(2026, 10, 9, 2);
    worker = 'u1';
    repo = HistoryRepository(db: db, remote: remote, currentWorkerId: () => worker, photoDir: () async => dir, now: () => now);
  });
  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  const offline = SocketException('no signal');

  test('search asks the server with the exact 0090 arguments', () async {
    final page = await repo.search(const HistoryQuery(text: ' outlet ', kind: ItemKind.material, projectId: 'f1', from: '2026-10-01'));
    expect(page.items.single.id, 'i1');
    expect(page.fromSaved, isFalse);
    expect(searchParams(const HistoryQuery(text: ' outlet ', kind: ItemKind.material, projectId: 'f1', from: '2026-10-01'),
        offset: 30, limit: historyPageSize), {
      'p_query': 'outlet', 'p_kind': 'material', 'p_category': null, 'p_folder': 'f1',
      'p_from': '2026-10-01', 'p_to': null, 'p_limit': 30, 'p_offset': 30,
    });
  });

  test('nothing is read or saved under nobody', () async {
    worker = '';
    expect(() => repo.search(const HistoryQuery()), throwsA(isA<StateError>()));
  });

  test('opening an item saves it; offline it comes back marked saved', () async {
    final fresh = await repo.item('i1');
    expect(fresh.fromSaved, isFalse);
    remote.error = offline;
    now = now.add(const Duration(days: 3));
    final saved = await repo.item('i1');
    expect(saved.fromSaved, isTrue);
    expect(saved.savedAt, DateTime.utc(2026, 10, 9, 2));
    expect(saved.item.entries.length, 2);
  });

  test('a saved copy older than 14 days is not shown offline', () async {
    await repo.item('i1');
    remote.error = offline;
    now = now.add(const Duration(days: 15));
    expect(() => repo.item('i1'), throwsA(predicate((e) => HistoryFailure.of(e!) == HistoryFailure.savedTooOld)));
  });

  test('offline with nothing saved says so, never shows an empty list as if searched', () async {
    remote.error = offline;
    expect(() => repo.search(const HistoryQuery()), throwsA(predicate((e) => HistoryFailure.of(e!) == HistoryFailure.noConnection)));
  });

  test('offline search filters the saved copy by words, kind and project', () async {
    await repo.item('i1');
    remote.error = offline;
    final hit = await repo.search(const HistoryQuery(text: 'saksakan'));
    expect(hit.items.single.id, 'i1');
    expect(hit.fromSaved, isTrue);
    expect((await repo.search(const HistoryQuery(text: 'drill'))).items, isEmpty);
    expect((await repo.search(const HistoryQuery(kind: ItemKind.tool))).items, isEmpty);
    expect((await repo.search(const HistoryQuery(projectId: 'f9'))).items, isEmpty);
    expect((await repo.search(const HistoryQuery(from: '2026-08-01', to: '2026-08-31'))).items.single.id, 'i1');
  });

  test('another worker on the same phone never sees the saved copy', () async {
    await repo.item('i1');
    worker = 'u2';
    remote.error = offline;
    expect(() => repo.item('i1'), throwsA(predicate((e) => HistoryFailure.of(e!) == HistoryFailure.noConnection)));
  });

  test('an item no longer visible is forgotten, photos included', () async {
    await repo.item('i1');
    expect(await repo.photo('o1/i1/p1.jpg'), isNotNull);
    remote.items.remove('i1');
    await expectLater(repo.item('i1'), throwsA(predicate((e) => HistoryFailure.of(e!) == HistoryFailure.notAvailable)));
    expect(await db.item('u1', 'i1'), isNull);
    expect(await db.photos('u1'), isEmpty);
  });

  test('cleanup is per entry: a switched-off project\'s entries go while the item stays', () async {
    await repo.item('i1');
    await repo.photo('o1/i1/p1.jpg');
    await repo.photo('o1/i1/p2.jpg');
    remote.visibleAnswer = [
      {'item_id': 'i1', 'entries': ['request_line:l1'], 'photo_ids': ['p1']},
    ];
    await repo.refreshSaved();
    final s = (await db.item('u1', 'i1'))!;
    expect(s.item.entries.map((e) => e.key), ['request_line:l1']);
    expect(s.item.photos.map((p) => p.id), ['p1']);
    expect((await db.photos('u1')).map((p) => p.path), ['o1/i1/p1.jpg'], reason: 'the retired photo file is deleted');
  });

  test('cleanup forgets an item no longer visible at all', () async {
    await repo.item('i1');
    remote.visibleAnswer = const [];
    await repo.refreshSaved();
    expect(await db.items('u1'), isEmpty);
  });

  test('cleanup does nothing offline (keeps the saved copy)', () async {
    await repo.item('i1');
    remote.error = offline;
    await repo.refreshSaved();
    expect(await db.item('u1', 'i1'), isNotNull);
  });

  test('a photo is downloaded once, then read from the phone', () async {
    final f = await repo.photo('o1/i1/p1.jpg');
    expect(await f!.exists(), isTrue);
    await repo.photo('o1/i1/p1.jpg');
    expect(remote.downloads, ['o1/i1/p1.jpg']);
    remote.error = offline;
    expect(await repo.photo('o1/i1/p2.jpg'), isNull, reason: 'no signal and not saved: a placeholder shows');
  });

  test('at most 200 items: the least recently opened goes first', () async {
    for (var i = 0; i < maxSavedItems; i++) {
      remote.items['x$i'] = itemJson(id: 'x$i');
      now = now.add(const Duration(minutes: 1));
      await repo.item('x$i');
    }
    now = now.add(const Duration(minutes: 1));
    await repo.item('i1');
    final ids = (await db.items('u1')).map((s) => s.item.id).toList();
    expect(ids.length, maxSavedItems);
    expect(ids, isNot(contains('x0')));
    expect(ids, contains('i1'));
  });

  test('photos are capped by count and by size, least recently shown first', () async {
    remote.photoBytes = 8 * 1024 * 1024;
    await repo.photo('o1/i1/a.jpg');
    now = now.add(const Duration(minutes: 1));
    await repo.photo('o1/i1/b.jpg');
    now = now.add(const Duration(minutes: 1));
    await repo.photo('o1/i1/c.jpg');
    expect((await db.photos('u1')).map((p) => p.path), ['o1/i1/b.jpg', 'o1/i1/c.jpg'], reason: '24 MB > 20 MB: the oldest goes');
  });

  test('sign-out deletes everything saved for that worker, files included', () async {
    await repo.item('i1');
    final f = await repo.photo('o1/i1/p1.jpg');
    await repo.keepOnly('');
    expect(await db.items('u1'), isEmpty);
    expect(await db.photos('u1'), isEmpty);
    expect(await f!.exists(), isFalse);
  });

  test('an account switch keeps only the new worker\'s copy', () async {
    await repo.item('i1');
    worker = 'u2';
    await repo.item('i1');
    await repo.keepOnly('u2');
    expect(await db.items('u1'), isEmpty);
    expect(await db.items('u2'), hasLength(1));
  });
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/history/data`
Expected: FAIL — compile error, `lib/history/data/history_api.dart` not found.

- [ ] **Step 3: Create the data files**

#### Create `lib/history/data/history_remote.dart`

```dart
import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/history_models.dart';

/// The private bucket of reviewed product photos (0090). Workers may read
/// only APPROVED photos of items with history they may see.
const galleryBucket = 'item-gallery';

const _readTimeout = Duration(seconds: 15);
const _downloadTimeout = Duration(seconds: 60);

/// pr_history_search's arguments, exactly (0090).
Map<String, dynamic> searchParams(HistoryQuery q, {required int offset, required int limit}) => {
      'p_query': q.text.trim(),
      'p_kind': q.kind?.wire,
      'p_category': q.category,
      'p_folder': q.projectId,
      'p_from': q.from,
      'p_to': q.to,
      'p_limit': limit,
      'p_offset': offset,
    };

abstract class HistoryRemote {
  /// {items: [...], has_more: bool}
  Future<Map<String, dynamic>> search(HistoryQuery q, {required int offset, required int limit});

  /// One item's photos and entries; throws HISTORY_NOT_AVAILABLE when none is visible.
  Future<Map<String, dynamic>> item(String itemId);

  /// For each of [itemIds] still visible: {item_id, entries: ['kind:id'], photo_ids: [...]}.
  Future<List<Map<String, dynamic>>> visible(List<String> itemIds);

  /// The photo's bytes (an approved gallery photo the worker may read).
  Future<Uint8List> download(String path);
}

class SupabaseHistoryRemote implements HistoryRemote {
  SupabaseHistoryRemote(this._client);

  final SupabaseClient _client;

  @override
  Future<Map<String, dynamic>> search(HistoryQuery q, {required int offset, required int limit}) async =>
      Map<String, dynamic>.from(
          await _client.rpc('pr_history_search', params: searchParams(q, offset: offset, limit: limit)).timeout(_readTimeout) as Map);

  @override
  Future<Map<String, dynamic>> item(String itemId) async =>
      Map<String, dynamic>.from(await _client.rpc('pr_history_item', params: {'p_item': itemId}).timeout(_readTimeout) as Map);

  @override
  Future<List<Map<String, dynamic>>> visible(List<String> itemIds) async => [
        for (final r in (await _client.rpc('pr_history_visible', params: {'p_items': itemIds}).timeout(_readTimeout) as List<dynamic>? ??
            const []))
          Map<String, dynamic>.from(r as Map),
      ];

  @override
  Future<Uint8List> download(String path) => _client.storage.from(galleryBucket).download(path).timeout(_downloadTimeout);
}
```

#### Create `lib/history/data/history_db.dart`

```dart
import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../domain/history_models.dart';

/// One saved item: what the server last sent, when, and when it was last opened.
typedef SavedItem = ({HistoryItem item, DateTime savedAt, DateTime viewedAt});

/// One saved photo file.
typedef SavedPhoto = ({String path, String itemId, String file, int bytes, DateTime viewedAt});

/// The offline copy of Find Previous Item (spec 1b §4.4): items the worker
/// opened and their photo files — every row scoped by worker, because site
/// phones are shared. Its own file, apart from the requests and attendance
/// databases, so none can break another.
class HistoryDb {
  HistoryDb._(this._db);

  final Database _db;

  static Future<HistoryDb> open(DatabaseFactory factory, String path, {bool singleInstance = true}) async {
    final db = await factory.openDatabase(
      path,
      options: OpenDatabaseOptions(version: 1, onCreate: _create, singleInstance: singleInstance),
    );
    return HistoryDb._(db);
  }

  static Future<void> _create(Database db, int version) async {
    await db.execute('''
      create table saved_item (
        worker_id text not null,
        item_id text not null,
        body text not null,
        saved_at integer not null,
        viewed_at integer not null,
        primary key (worker_id, item_id)
      )''');
    await db.execute('''
      create table saved_photo (
        worker_id text not null,
        path text not null,
        item_id text not null,
        file text not null,
        bytes integer not null,
        viewed_at integer not null,
        primary key (worker_id, path)
      )''');
  }

  Future<void> close() => _db.close();

  static DateTime _t(Object? ms) => DateTime.fromMillisecondsSinceEpoch(ms! as int, isUtc: true);

  // ── items ──────────────────────────────────────────────────────────────

  Future<void> putItem(String workerId, HistoryItem item, {required DateTime savedAt, required DateTime viewedAt}) => _db.insert(
        'saved_item',
        {
          'worker_id': workerId,
          'item_id': item.id,
          'body': jsonEncode(item.toJson()),
          'saved_at': savedAt.millisecondsSinceEpoch,
          'viewed_at': viewedAt.millisecondsSinceEpoch,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  SavedItem? _item(Map<String, Object?> row) {
    final item = HistoryItem.fromJson(Map<String, dynamic>.from(jsonDecode(row['body']! as String) as Map));
    if (item == null) return null;
    return (item: item, savedAt: _t(row['saved_at']), viewedAt: _t(row['viewed_at']));
  }

  Future<SavedItem?> item(String workerId, String itemId) async {
    final rows = await _db.query('saved_item', where: 'worker_id = ? and item_id = ?', whereArgs: [workerId, itemId], limit: 1);
    return rows.isEmpty ? null : _item(rows.first);
  }

  /// Least recently opened first.
  Future<List<SavedItem>> items(String workerId) async => [
        for (final r in await _db.query('saved_item', where: 'worker_id = ?', whereArgs: [workerId], orderBy: 'viewed_at asc'))
          ?_item(r),
      ];

  Future<void> touchItem(String workerId, String itemId, DateTime at) => _db.update(
      'saved_item', {'viewed_at': at.millisecondsSinceEpoch},
      where: 'worker_id = ? and item_id = ?', whereArgs: [workerId, itemId]);

  Future<void> deleteItem(String workerId, String itemId) =>
      _db.delete('saved_item', where: 'worker_id = ? and item_id = ?', whereArgs: [workerId, itemId]);

  // ── photos ─────────────────────────────────────────────────────────────

  Future<void> putPhoto(String workerId, {required String path, required String itemId, required String file, required int bytes, required DateTime at}) =>
      _db.insert(
        'saved_photo',
        {'worker_id': workerId, 'path': path, 'item_id': itemId, 'file': file, 'bytes': bytes, 'viewed_at': at.millisecondsSinceEpoch},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  SavedPhoto _photo(Map<String, Object?> r) => (
        path: r['path']! as String,
        itemId: r['item_id']! as String,
        file: r['file']! as String,
        bytes: r['bytes']! as int,
        viewedAt: _t(r['viewed_at']),
      );

  Future<SavedPhoto?> photo(String workerId, String path) async {
    final rows = await _db.query('saved_photo', where: 'worker_id = ? and path = ?', whereArgs: [workerId, path], limit: 1);
    return rows.isEmpty ? null : _photo(rows.first);
  }

  /// Least recently shown first.
  Future<List<SavedPhoto>> photos(String workerId) async => [
        for (final r in await _db.query('saved_photo', where: 'worker_id = ?', whereArgs: [workerId], orderBy: 'viewed_at asc')) _photo(r),
      ];

  Future<void> touchPhoto(String workerId, String path, DateTime at) => _db.update(
      'saved_photo', {'viewed_at': at.millisecondsSinceEpoch},
      where: 'worker_id = ? and path = ?', whereArgs: [workerId, path]);

  Future<void> deletePhoto(String workerId, String path) =>
      _db.delete('saved_photo', where: 'worker_id = ? and path = ?', whereArgs: [workerId, path]);

  // ── a worker leaves ────────────────────────────────────────────────────

  /// Every worker with something saved on this phone.
  Future<List<String>> workerIds() async => [
        for (final r in await _db.rawQuery('SELECT worker_id FROM saved_item UNION SELECT worker_id FROM saved_photo'))
          r['worker_id']! as String,
      ];

  /// Deletes everything saved for [workerId]; returns the photo files to delete.
  Future<List<String>> forgetWorker(String workerId) => _db.transaction((txn) async {
        final files = [
          for (final r in await txn.query('saved_photo', columns: ['file'], where: 'worker_id = ?', whereArgs: [workerId])) r['file']! as String,
        ];
        await txn.delete('saved_photo', where: 'worker_id = ?', whereArgs: [workerId]);
        await txn.delete('saved_item', where: 'worker_id = ?', whereArgs: [workerId]);
        return files;
      });
}

/// The database file on the phone.
Future<HistoryDb> openDeviceHistoryDb() async => HistoryDb.open(databaseFactory, '${await getDatabasesPath()}/workmate_history.db');
```

#### Create `lib/history/data/history_api.dart`

```dart
import 'dart:io';

import '../domain/history_models.dart';

/// One item's page, fresh ([savedAt] null) or this phone's saved copy.
class HistoryItemView {
  const HistoryItemView({required this.item, this.savedAt});
  final HistoryItem item;
  final DateTime? savedAt;

  bool get fromSaved => savedAt != null;
}

/// What the Find Previous Item screens need. An interface so screens test
/// with a fake instead of a database and a server.
abstract interface class HistoryApi {
  /// One page of items (30). With no signal: the items saved on this phone
  /// that match, all at once, marked with [HistoryPage.savedAt].
  Future<HistoryPage> search(HistoryQuery q, {int offset = 0});

  /// One item. With no signal: the saved copy, if it is 14 days old or newer.
  Future<HistoryItemView> item(String itemId);

  /// Deletes every saved item, entry and photo the worker may no longer see
  /// (spec §4.4: per entry, not just per item). Quietly does nothing offline.
  Future<void> refreshSaved();

  /// The photo as a file on this phone (downloaded and kept on first use),
  /// or null when it cannot be shown now.
  Future<File?> photo(String path);

  /// Deletes everything saved for every worker but [workerId]; '' deletes
  /// it all (spec §4.4: wiped on sign-out or account switch).
  Future<void> keepOnly(String workerId);
}
```

#### Create `lib/history/data/history_repository.dart`

```dart
import 'dart:io';

import '../domain/history_failure.dart';
import '../domain/history_models.dart';
import 'history_api.dart';
import 'history_db.dart';
import 'history_remote.dart';

/// Results per page (the server caps at 50).
const historyPageSize = 30;

/// The offline copy's limits (spec 1b §4.4).
const maxSavedItems = 200;
const maxSavedPhotos = 200;
const maxSavedPhotoBytes = 20 * 1024 * 1024;
const maxSavedAge = Duration(days: 14);

/// Find Previous Item: the server first; this phone's bounded, per-worker
/// copy when there is no signal. Nothing here claims stock: it is history.
class HistoryRepository implements HistoryApi {
  HistoryRepository({
    required this.db,
    required this.remote,
    required this.currentWorkerId,
    required this.photoDir,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final HistoryDb db;
  final HistoryRemote remote;

  /// The worker the app let in, or '' — the scope of every read and write.
  final String Function() currentWorkerId;

  /// App-private folder for saved gallery photos (never the phone's gallery).
  final Future<Directory> Function() photoDir;
  final DateTime Function() _now;

  String _worker() {
    final w = currentWorkerId();
    if (w.isEmpty) throw StateError('AUTH_REQUIRED');
    return w;
  }

  bool _tooOld(DateTime savedAt) => _now().difference(savedAt) > maxSavedAge;

  static bool _offline(Object e) => HistoryFailure.of(e) == HistoryFailure.noConnection;

  // ── search ─────────────────────────────────────────────────────────────

  @override
  Future<HistoryPage> search(HistoryQuery q, {int offset = 0}) async {
    final w = _worker();
    try {
      return HistoryPage.fromJson(await remote.search(q, offset: offset, limit: historyPageSize));
    } catch (e) {
      if (!_offline(e)) rethrow;
      final saved = [for (final s in await db.items(w)) if (!_tooOld(s.savedAt)) s];
      if (saved.isEmpty) throw const HistoryUnavailable(HistoryFailure.noConnection);
      // Offline everything matching shows at once: there is no next page.
      if (offset > 0) return HistoryPage(items: const [], hasMore: false, savedAt: saved.first.savedAt);
      final hits = saved.where((s) => _matches(s.item, q)).toList()
        ..sort((a, b) => a.item.name.toLowerCase().compareTo(b.item.name.toLowerCase()));
      final oldest = saved.map((s) => s.savedAt).reduce((a, b) => a.isBefore(b) ? a : b);
      return HistoryPage(items: [for (final s in hits) s.item.toCard()], hasMore: false, savedAt: oldest);
    }
  }

  /// The server's search rules, on the saved copy: name, size, brand,
  /// category or another name; kind; category; project; date range.
  static bool _matches(HistoryItem i, HistoryQuery q) {
    final t = q.text.trim().toLowerCase();
    if (t.isNotEmpty && ![i.name, i.spec, i.brand, i.category, ...i.aliases].any((s) => s.toLowerCase().contains(t))) return false;
    if (q.kind != null && i.kind != q.kind) return false;
    if (q.category != null && i.category.toLowerCase() != q.category!.toLowerCase()) return false;
    bool inRange(HistoryEntry e) {
      if (q.projectId != null && e.projectId != q.projectId) return false;
      if (q.from == null && q.to == null) return true;
      final d = e.date;
      if (d == null) return false;
      return (q.from == null || d.compareTo(q.from!) >= 0) && (q.to == null || d.compareTo(q.to!) <= 0);
    }

    return (q.projectId == null && q.from == null && q.to == null) || i.entries.any(inRange);
  }

  // ── one item ───────────────────────────────────────────────────────────

  @override
  Future<HistoryItemView> item(String itemId) async {
    final w = _worker();
    try {
      final item = HistoryItem.fromJson(await remote.item(itemId));
      if (item == null) throw StateError('unknown item kind');
      final now = _now();
      await db.putItem(w, item, savedAt: now, viewedAt: now);
      await _keepItemLimit(w);
      return HistoryItemView(item: item);
    } catch (e) {
      final f = HistoryFailure.of(e);
      // No longer visible to this worker: the saved copy goes too.
      if (f == HistoryFailure.notAvailable) await _forgetItem(w, itemId);
      if (f != HistoryFailure.noConnection) rethrow;
      final saved = await db.item(w, itemId);
      if (saved == null) throw const HistoryUnavailable(HistoryFailure.noConnection);
      if (_tooOld(saved.savedAt)) throw const HistoryUnavailable(HistoryFailure.savedTooOld);
      await db.touchItem(w, itemId, _now());
      return HistoryItemView(item: saved.item, savedAt: saved.savedAt);
    }
  }

  // ── cleanup ────────────────────────────────────────────────────────────

  @override
  Future<void> refreshSaved() async {
    final w = _worker();
    final saved = await db.items(w);
    if (saved.isEmpty) return;
    final List<Map<String, dynamic>> answer;
    try {
      answer = await remote.visible([for (final s in saved) s.item.id]);
    } catch (e) {
      if (_offline(e)) return;
      rethrow;
    }
    final byItem = {for (final v in answer) v['item_id'] as String: v};
    for (final s in saved) {
      final v = byItem[s.item.id];
      if (v == null || _tooOld(s.savedAt)) {
        await _forgetItem(w, s.item.id);
        continue;
      }
      final keys = {for (final k in (v['entries'] as List<dynamic>? ?? const [])) k as String};
      final photoIds = {for (final p in (v['photo_ids'] as List<dynamic>? ?? const [])) p as String};
      final kept = s.item.copyWith(
        entries: [for (final e in s.item.entries) if (keys.contains(e.key)) e],
        photos: [for (final p in s.item.photos) if (photoIds.contains(p.id)) p],
      );
      if (kept.entries.length != s.item.entries.length || kept.photos.length != s.item.photos.length) {
        await db.putItem(w, kept, savedAt: s.savedAt, viewedAt: s.viewedAt);
      }
      // A photo file of this item that is no longer approved goes.
      final keepPaths = {for (final p in kept.photos) p.path};
      for (final p in await db.photos(w)) {
        if (p.itemId == s.item.id && !keepPaths.contains(p.path)) await _deletePhoto(w, p);
      }
    }
  }

  // ── photos ─────────────────────────────────────────────────────────────

  @override
  Future<File?> photo(String path) async {
    final w = _worker();
    final saved = await db.photo(w, path);
    if (saved != null) {
      final f = File(saved.file);
      if (await f.exists()) {
        await db.touchPhoto(w, path, _now());
        return f;
      }
      await db.deletePhoto(w, path);
    }
    try {
      final bytes = await remote.download(path);
      final dir = Directory('${(await photoDir()).path}${Platform.pathSeparator}$w');
      await dir.create(recursive: true);
      final file = File('${dir.path}${Platform.pathSeparator}${path.replaceAll('/', '_')}');
      await file.writeAsBytes(bytes, flush: true);
      // <company>/<item>/<uuid>.jpg — the item is the second segment.
      final parts = path.split('/');
      await db.putPhoto(w, path: path, itemId: parts.length > 1 ? parts[1] : '', file: file.path, bytes: bytes.length, at: _now());
      await _keepPhotoLimit(w);
      return file;
    } catch (_) {
      return null;
    }
  }

  // ── limits and forgetting ──────────────────────────────────────────────

  /// Least recently opened items go first (with their photos).
  Future<void> _keepItemLimit(String w) async {
    final items = await db.items(w);
    for (var i = 0; i < items.length - maxSavedItems; i++) {
      await _forgetItem(w, items[i].item.id);
    }
  }

  /// Least recently shown photos go first, until both limits hold.
  Future<void> _keepPhotoLimit(String w) async {
    final photos = await db.photos(w);
    var count = photos.length;
    var bytes = photos.fold<int>(0, (sum, p) => sum + p.bytes);
    for (final p in photos) {
      if (count <= maxSavedPhotos && bytes <= maxSavedPhotoBytes) break;
      await _deletePhoto(w, p);
      count--;
      bytes -= p.bytes;
    }
  }

  Future<void> _forgetItem(String w, String itemId) async {
    await db.deleteItem(w, itemId);
    for (final p in await db.photos(w)) {
      if (p.itemId == itemId) await _deletePhoto(w, p);
    }
  }

  Future<void> _deletePhoto(String w, SavedPhoto p) async {
    await db.deletePhoto(w, p.path);
    try {
      await File(p.file).delete();
    } catch (_) {
      // Already gone.
    }
  }

  @override
  Future<void> keepOnly(String workerId) async {
    for (final w in await db.workerIds()) {
      if (w != workerId) await _forget(w);
    }
  }

  Future<void> _forget(String workerId) async {
    for (final f in await db.forgetWorker(workerId)) {
      try {
        await File(f).delete();
      } catch (_) {
        // Already gone.
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `flutter test test/history` → Expected: `All tests passed!` (28 tests: 12 + 16).
Run: `flutter test` → Expected: `All tests passed!`
Run: `flutter analyze` → Expected: `No issues found!`

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 3: The two screens

**Files:**
- Create: `lib/history/ui/history_copy.dart`, `lib/history/ui/history_thumb.dart`, `lib/history/ui/history_item_screen.dart`, `lib/history/ui/find_previous_screen.dart`
- Test: `test/history/ui/history_screens_test.dart`

**Interfaces:**
- Consumes (Tasks 1–2): `HistoryApi`, `HistoryItemView`, the models, `HistoryFailure`; `ItemKind`, `Destination`, `CatalogItem` (`request_models.dart`); `FailureNotice`, `noticeAction` (`lib/ui/failure_notice.dart`), `retryLabel`, `failureCopy`, `Bilingual` (`attendance_copy.dart`), `dayMonth`, `clockTime` (`attendance/ui/formats.dart`), `WmColors` (`lib/ui/theme.dart`).
- Produces:
  - `FindPreviousScreen({history, projects = const {}, categories = const [], now = DateTime.now})` — pops a `HistoryPick`. Keys: `history-search`, `history-kind-all`, `history-kind-material`, `history-kind-tool`, `history-project`, `history-category`, `history-period-<any|month|quarter|year>`, `history-card-<itemId>`, `history-more`, `history-empty`, `history-failure`, `history-saved-banner`.
  - `HistoryItemScreen({history, itemId})` — pops a `HistoryPick`. Keys: `history-photos`, `history-photo-<i>`, `history-not-listed`, `history-request-again`, `history-entry-<entryId>`, `history-again-<entryId>`, `history-item-saved`, `history-item-failure`.
  - `HistoryThumb({history, path, size = 56, height})`.
  - `historyProjects(List<Destination>) → Map<String, String>`, `historyCategories(List<CatalogItem>) → List<String>`, `HistoryPeriod {any, month, quarter, year}` with `.fromKey(DateTime today)`.
  - `history_copy.dart`: `findPreviousTitle`, `requestAgainLabel`, `requestAgainShort`, `notListedTitle`, `noMatchesText`, `noPhotoText`, `savedBanner(when)`, `historyFailureCopy(HistoryFailure) → Bilingual`.

- [ ] **Step 1: Write the failing tests**

#### Create `test/history/ui/history_screens_test.dart`

```dart
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/history/data/history_api.dart';
import 'package:workmate/history/domain/history_models.dart';
import 'package:workmate/history/ui/find_previous_screen.dart';
import 'package:workmate/history/ui/history_copy.dart';
import 'package:workmate/history/ui/history_item_screen.dart';
import 'package:workmate/requests/domain/request_models.dart';
import 'package:workmate/ui/theme.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../history_fakes.dart';
import '../history_samples.dart';

void main() {
  late FakeHistoryApi api;
  HistoryPick? picked;
  setUp(() {
    api = FakeHistoryApi();
    picked = null;
  });

  /// A host page that opens [screen] and keeps what it pops.
  Future<void> open(WidgetTester tester, Widget screen) async {
    useTallPhone(tester);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            key: const Key('host-open'),
            onPressed: () async => picked = await Navigator.of(context).push<HistoryPick>(MaterialPageRoute(builder: (_) => screen)),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.byKey(const Key('host-open')));
    await tester.pumpAndSettle();
  }

  Future<void> openFind(WidgetTester tester) => open(
      tester,
      FindPreviousScreen(
        history: api,
        projects: const {'f1': 'Barlin Residence', 'f2': 'Santos Townhouse'},
        categories: const ['electrical'],
        now: () => DateTime(2026, 10, 11, 9),
      ));

  group('Find previous item', () {
    testWidgets('shows cards with the latest entry, and cleans the saved copy on open', (tester) async {
      await openFind(tester);
      expect(find.byKey(const Key('history-card-i1')), findsOneWidget);
      expect(find.text('Outlet'), findsOneWidget);
      expect(find.text('2-gang · pc · Omni'), findsOneWidget);
      expect(find.text('Latest: Requested · 3 Oct 2026 · Barlin Residence'), findsOneWidget);
      expect(api.refreshes, 1);
    });

    testWidgets('typing searches after a pause; filters narrow the next search', (tester) async {
      await openFind(tester);
      await tester.enterText(find.byKey(const Key('history-search')), 'saksakan');
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pumpAndSettle();
      expect(api.queries.last.text, 'saksakan');

      await tester.tap(find.byKey(const Key('history-kind-tool')));
      await tester.pumpAndSettle();
      expect(api.queries.last.kind, ItemKind.tool);
      expect(api.queries.last.text, 'saksakan', reason: 'filters keep the words');

      await tester.tap(find.byKey(const Key('history-period-month')));
      await tester.pumpAndSettle();
      expect(api.queries.last.from, '2026-09-11', reason: 'a local calendar date, 30 days back');

      await tester.tap(find.byKey(const Key('history-kind-all')));
      await tester.pumpAndSettle();
      expect(api.queries.last.kind, isNull);
      expect(api.queries.last.from, '2026-09-11');
    });

    testWidgets('the project filter lists only the worker\'s own projects', (tester) async {
      await openFind(tester);
      await tester.tap(find.byKey(const Key('history-project')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Santos Townhouse').last);
      await tester.pumpAndSettle();
      expect(api.queries.last.projectId, 'f2');
    });

    testWidgets('no matches says so', (tester) async {
      api.page = HistoryPage.fromJson({'items': [], 'has_more': false});
      await openFind(tester);
      expect(find.text(noMatchesText), findsOneWidget);
    });

    testWidgets('show more asks for the next page and appends it', (tester) async {
      api.page = HistoryPage.fromJson({'items': [cardJson()], 'has_more': true});
      await openFind(tester);
      api.page = HistoryPage.fromJson({'items': [cardJson(id: 'i2', name: 'Pipe')], 'has_more': false});
      await tester.tap(find.byKey(const Key('history-more')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('history-card-i1')), findsOneWidget);
      expect(find.byKey(const Key('history-card-i2')), findsOneWidget);
      expect(find.byKey(const Key('history-more')), findsNothing);
    });

    testWidgets('offline with saved results shows them under a dated banner', (tester) async {
      api.page = HistoryPage(items: [HistoryCard.fromJson(cardJson())!], hasMore: false, savedAt: DateTime(2026, 10, 9, 10, 42));
      await openFind(tester);
      expect(find.byKey(const Key('history-saved-banner')), findsOneWidget);
      expect(find.textContaining('showing saved results from'), findsOneWidget);
      expect(find.byKey(const Key('history-card-i1')), findsOneWidget);
    });

    testWidgets('offline with nothing saved shows the bilingual notice and retries', (tester) async {
      api.error = const SocketException('no signal');
      await openFind(tester);
      expect(find.byKey(const Key('history-failure')), findsOneWidget);
      expect(find.byKey(const Key('history-card-i1')), findsNothing);
      api.error = null;
      await tester.tap(find.text('TRY AGAIN'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('history-card-i1')), findsOneWidget);
    });

    testWidgets('an item no longer listed is marked on its card', (tester) async {
      api.page = HistoryPage.fromJson({'items': [cardJson(active: false)], 'has_more': false});
      await openFind(tester);
      expect(find.text('No longer listed'), findsOneWidget);
    });

    testWidgets('opening a card and choosing Request again returns the pick', (tester) async {
      await openFind(tester);
      await tester.tap(find.byKey(const Key('history-card-i1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('history-request-again')));
      await tester.pumpAndSettle();
      expect(picked!.itemId, 'i1');
      expect(picked!.refKind, 'request_line');
      expect(picked!.refId, 'l1');
      expect(find.byKey(const Key('host-open')), findsOneWidget, reason: 'both screens closed');
    });
  });

  group('Item history', () {
    testWidgets('shows photos, details and each dated entry — never who asked', (tester) async {
      await open(tester, HistoryItemScreen(history: api, itemId: 'i1'));
      expect(find.byKey(const Key('history-photos')), findsOneWidget);
      expect(find.text('2 photos — swipe'), findsOneWidget);
      expect(find.text('Also called: saksakan'), findsOneWidget);
      expect(find.text('Requested'), findsOneWidget);
      expect(find.text('Historical reference'), findsOneWidget);
      expect(find.text('3 Oct 2026 · 6 pc'), findsOneWidget);
      expect(find.text('around Aug 2026'), findsOneWidget);
      expect(find.text('Kitchen outlets — old Messenger photo'), findsOneWidget);
    });

    testWidgets('Request again on a reference row links that reference', (tester) async {
      await open(tester, HistoryItemScreen(history: api, itemId: 'i1'));
      await tester.tap(find.byKey(const Key('history-again-r1')));
      await tester.pumpAndSettle();
      expect(picked!.refKind, 'reference');
      expect(picked!.refId, 'r1');
    });

    testWidgets('an item no longer listed cannot be requested again', (tester) async {
      api.items['i1'] = HistoryItemView(item: HistoryItem.fromJson(itemJson(active: false))!);
      await open(tester, HistoryItemScreen(history: api, itemId: 'i1'));
      expect(find.byKey(const Key('history-not-listed')), findsOneWidget);
      expect(find.byKey(const Key('history-request-again')), findsNothing);
      expect(find.byKey(const Key('history-again-l1')), findsNothing);
    });

    testWidgets('no photos shows a placeholder', (tester) async {
      api.items['i1'] = HistoryItemView(item: HistoryItem.fromJson(itemJson(photos: []))!);
      await open(tester, HistoryItemScreen(history: api, itemId: 'i1'));
      expect(find.text(noPhotoText), findsOneWidget);
      expect(find.byKey(const Key('history-photos')), findsNothing);
    });

    testWidgets('a saved copy is labelled with when it was saved', (tester) async {
      api.items['i1'] = HistoryItemView(item: HistoryItem.fromJson(itemJson())!, savedAt: DateTime(2026, 10, 9, 10, 42));
      await open(tester, HistoryItemScreen(history: api, itemId: 'i1'));
      expect(find.byKey(const Key('history-item-saved')), findsOneWidget);
    });

    testWidgets('history switched off shows the bilingual notice', (tester) async {
      api.items.remove('i1');
      await open(tester, HistoryItemScreen(history: api, itemId: 'i1'));
      expect(find.byKey(const Key('history-item-failure')), findsOneWidget);
      expect(find.textContaining('switched it off for this project'), findsOneWidget);
    });
  });
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/history/ui/history_screens_test.dart`
Expected: FAIL — compile error, `lib/history/ui/find_previous_screen.dart` not found.

- [ ] **Step 3: Create the screen files**

#### Create `lib/history/ui/history_copy.dart`

```dart
import '../../attendance/domain/attendance_failure.dart';
import '../../attendance/ui/attendance_copy.dart';
import '../domain/history_failure.dart';

// Screen copy is English; FAILURE copy is bilingual (English, then Tagalog),
// the same rule as Attendance and Requests. Shared failures reuse their words.

const findPreviousTitle = 'Find previous item';
const requestAgainLabel = 'REQUEST THIS ITEM AGAIN';
const requestAgainShort = 'Request again';
const notListedTitle = 'No longer listed — ask the office';
const noMatchesText = 'No matches. Try other words, or clear the filters.';
const noPhotoText = 'No photo yet';

/// "Can't connect — showing saved results from 9 Oct, 10:42"
String savedBanner(String when) => 'Can\'t connect — showing saved results from $when. They may be out of date.';

Bilingual historyFailureCopy(HistoryFailure f) => switch (f) {
      HistoryFailure.notAvailable => const Bilingual(
          'History isn\'t available for this item. The office may have switched it off for this project.',
          'Walang makitang history para sa item na ito. Maaaring pinatay ito ng opisina para sa project na ito.'),
      HistoryFailure.savedTooOld => const Bilingual(
          'This phone\'s copy is more than 14 days old. Connect to the internet to refresh it.',
          'Mahigit 14 na araw na ang kopya sa teleponong ito. Kumonekta sa internet para ma-refresh.'),
      HistoryFailure.noConnection => failureCopy(AttendanceFailure.noConnection),
      HistoryFailure.sessionExpired => failureCopy(AttendanceFailure.sessionExpired),
      HistoryFailure.notARequester => const Bilingual(
          'You don\'t have access to this. Ask the office.', 'Wala kang access dito. Magtanong sa opisina.'),
      HistoryFailure.appUpdateRequired => failureCopy(AttendanceFailure.appUpdateRequired),
      HistoryFailure.unexpected => failureCopy(AttendanceFailure.unexpected),
    };
```

#### Create `lib/history/ui/history_thumb.dart`

```dart
import 'dart:io';

import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../data/history_api.dart';

/// A gallery photo, from this phone when saved, else downloaded once and
/// kept. A placeholder while loading, and when it cannot be shown.
class HistoryThumb extends StatefulWidget {
  const HistoryThumb({super.key, required this.history, required this.path, this.size = 56, this.height});

  final HistoryApi history;
  final String? path;
  final double size;

  /// Taller than wide (the item page's photo strip); defaults to [size].
  final double? height;

  @override
  State<HistoryThumb> createState() => _HistoryThumbState();
}

class _HistoryThumbState extends State<HistoryThumb> {
  late Future<File?> _file = _load();

  Future<File?> _load() async {
    final p = widget.path;
    if (p == null) return null;
    try {
      return await widget.history.photo(p);
    } catch (_) {
      return null;
    }
  }

  @override
  void didUpdateWidget(HistoryThumb old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path) _file = _load();
  }

  @override
  Widget build(BuildContext context) {
    final h = widget.height ?? widget.size;
    final gap = Container(
      width: widget.size,
      height: h,
      decoration: BoxDecoration(color: WmColors.inert, borderRadius: BorderRadius.circular(10)),
      child: const Icon(Icons.image_outlined, color: WmColors.textMuted),
    );
    return FutureBuilder<File?>(
      future: _file,
      builder: (context, snap) {
        final f = snap.data;
        if (f == null) return gap;
        return ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.file(f, width: widget.size, height: h, fit: BoxFit.cover, errorBuilder: (_, _, _) => gap),
        );
      },
    );
  }
}
```

#### Create `lib/history/ui/history_item_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/history_api.dart';
import '../domain/history_failure.dart';
import '../domain/history_models.dart';
import 'history_copy.dart';
import 'history_thumb.dart';

/// One item: its approved photos and its dated history (spec 1b §4.3).
/// Pops a [HistoryPick] when the worker taps Request again. Never shows
/// who asked, request notes, prices or "in stock".
class HistoryItemScreen extends StatefulWidget {
  const HistoryItemScreen({super.key, required this.history, required this.itemId});

  final HistoryApi history;
  final String itemId;

  @override
  State<HistoryItemScreen> createState() => _HistoryItemScreenState();
}

class _HistoryItemScreenState extends State<HistoryItemScreen> {
  HistoryItemView? _view;
  HistoryFailure? _failure;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failure = null;
    });
    try {
      final v = await widget.history.item(widget.itemId);
      if (mounted) setState(() => _view = v);
    } catch (e) {
      if (mounted) setState(() => _failure = HistoryFailure.of(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _again(HistoryItem item, HistoryEntry entry) => Navigator.of(context).pop(HistoryPick.of(item, entry));

  @override
  Widget build(BuildContext context) {
    final v = _view;
    return Scaffold(
      appBar: AppBar(title: const Text('Item history')),
      body: SafeArea(
        child: _loading && v == null
            ? const Center(child: CircularProgressIndicator())
            : v == null
                ? ListView(padding: const EdgeInsets.all(20), children: [
                    FailureNotice(
                      key: const Key('history-item-failure'),
                      english: historyFailureCopy(_failure ?? HistoryFailure.unexpected).english,
                      tagalog: historyFailureCopy(_failure ?? HistoryFailure.unexpected).tagalog,
                      actions: [noticeAction(retryLabel, _load)],
                    ),
                  ])
                : _body(v),
      ),
    );
  }

  Widget _body(HistoryItemView v) {
    final item = v.item;
    final details = [if (item.spec.isNotEmpty) item.spec, item.unit, if (item.brand.isNotEmpty) item.brand, if (item.category.isNotEmpty) item.category];
    return ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: [
      if (v.fromSaved)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text(savedBanner('${dayMonth(v.savedAt!)}, ${clockTime(v.savedAt!)}'),
              key: const Key('history-item-saved'), style: const TextStyle(fontSize: 12.5, color: WmColors.brown)),
        ),
      SizedBox(
        height: 220,
        child: item.photos.isEmpty
            ? Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  HistoryThumb(history: widget.history, path: null, size: 96),
                  const SizedBox(height: 6),
                  const Text(noPhotoText, style: TextStyle(color: WmColors.textMuted)),
                ]),
              )
            : PageView(
                key: const Key('history-photos'),
                children: [
                  for (var i = 0; i < item.photos.length; i++)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: LayoutBuilder(
                        builder: (context, box) => HistoryThumb(
                          key: Key('history-photo-$i'),
                          history: widget.history,
                          path: item.photos[i].path,
                          size: box.maxWidth,
                          height: 220,
                        ),
                      ),
                    ),
                ],
              ),
      ),
      if (item.photos.length > 1)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text('${item.photos.length} photos — swipe', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: WmColors.textMuted)),
        ),
      const SizedBox(height: 14),
      Text(item.name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
      Text(details.join(' · '), style: const TextStyle(color: WmColors.textMuted)),
      if (item.aliases.isNotEmpty) Text('Also called: ${item.aliases.join(', ')}', style: const TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
      const SizedBox(height: 14),
      if (!item.active)
        Container(
          key: const Key('history-not-listed'),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: WmColors.brownTint, borderRadius: BorderRadius.circular(14)),
          child: const Text(notListedTitle, style: TextStyle(fontWeight: FontWeight.w700, color: WmColors.brownDeep)),
        )
      else if (item.entries.isNotEmpty)
        FilledButton.icon(
          key: const Key('history-request-again'),
          onPressed: () => _again(item, item.entries.first),
          icon: const Icon(Icons.replay),
          label: const Text(requestAgainLabel),
        ),
      const SizedBox(height: 18),
      const Text('History', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
      const SizedBox(height: 6),
      for (final e in item.entries) _EntryCard(entry: e, onAgain: item.active ? () => _again(item, e) : null),
    ]);
  }
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({required this.entry, required this.onAgain});
  final HistoryEntry entry;
  final VoidCallback? onAgain;

  @override
  Widget build(BuildContext context) {
    final e = entry;
    final cancelled = e.label != 'Requested' && e.entryKind == 'request_line';
    final qty = e.quantity == null ? null : '${_qty(e.quantity!)} ${e.unit ?? ''}'.trim();
    final words = [e.description, e.note].whereType<String>().where((s) => s.trim().isNotEmpty).join(' — ');
    return Container(
      key: Key('history-entry-${e.entryId}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: WmColors.border)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(e.label,
                style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: cancelled ? WmColors.textMuted : (e.entryKind == 'reference' ? WmColors.brown : WmColors.green))),
            Text(historyWhere(e.projectName, e.workName)),
            Text([historyDateLabel(e.date, e.datePrecision), ?qty].join(' · '), style: const TextStyle(color: WmColors.textMuted)),
            if (words.isNotEmpty) Text(words, style: const TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
          ]),
        ),
        if (onAgain != null)
          TextButton(key: Key('history-again-${e.entryId}'), onPressed: onAgain, child: const Text(requestAgainShort)),
      ]),
    );
  }

  static String _qty(double q) => q == q.roundToDouble() ? q.toStringAsFixed(0) : q.toString();
}
```

#### Create `lib/history/ui/find_previous_screen.dart`

```dart
import 'dart:async';

import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../requests/domain/request_models.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/history_api.dart';
import '../domain/history_failure.dart';
import '../domain/history_models.dart';
import 'history_copy.dart';
import 'history_item_screen.dart';
import 'history_thumb.dart';

/// The project filter: the worker's own projects, from the Requests list.
Map<String, String> historyProjects(List<Destination> destinations) => {for (final d in destinations) d.projectId: d.projectName};

/// The category filter: the catalogue's categories, sorted.
List<String> historyCategories(List<CatalogItem> catalog) =>
    {for (final c in catalog) if (c.category.trim().isNotEmpty) c.category.trim()}.toList()..sort();

/// The date filter, as finger-sized presets (spec 1b §4.3 "a date filter").
enum HistoryPeriod {
  any('Any time', null),
  month('Last 30 days', 30),
  quarter('Last 3 months', 91),
  year('Last 12 months', 365);

  const HistoryPeriod(this.label, this.days);
  final String label;
  final int? days;

  /// The local date [days] before [today], as yyyy-mm-dd — built from local
  /// parts, never toISOString (PH is UTC+8).
  String? fromKey(DateTime today) {
    final d = days;
    if (d == null) return null;
    final t = DateTime(today.year, today.month, today.day).subtract(Duration(days: d));
    return '${t.year.toString().padLeft(4, '0')}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
  }
}

/// Find Previous Item: search what this worker's projects used before.
/// Pops a [HistoryPick] when the worker chooses Request again.
class FindPreviousScreen extends StatefulWidget {
  const FindPreviousScreen({
    super.key,
    required this.history,
    this.projects = const {},
    this.categories = const [],
    this.now = DateTime.now,
  });

  final HistoryApi history;

  /// Project id → name, for the project filter (the worker's own projects).
  final Map<String, String> projects;
  final List<String> categories;
  final DateTime Function() now;

  @override
  State<FindPreviousScreen> createState() => _FindPreviousScreenState();
}

class _FindPreviousScreenState extends State<FindPreviousScreen> {
  final _text = TextEditingController();
  Timer? _debounce;
  var _query = const HistoryQuery();
  var _period = HistoryPeriod.any;
  final _items = <HistoryCard>[];
  bool _hasMore = false;
  DateTime? _savedAt;
  HistoryFailure? _failure;
  bool _loading = true;
  bool _loadingMore = false;
  int _asked = 0;

  @override
  void initState() {
    super.initState();
    // Drop saved items the worker may no longer see; never blocks the search.
    unawaited(widget.history.refreshSaved().catchError((_) {}));
    _search();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _text.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final ask = ++_asked;
    setState(() {
      _loading = true;
      _failure = null;
    });
    try {
      final page = await widget.history.search(_query);
      if (!mounted || ask != _asked) return;
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _hasMore = page.hasMore;
        _savedAt = page.savedAt;
      });
    } catch (e) {
      if (!mounted || ask != _asked) return;
      setState(() {
        _items.clear();
        _hasMore = false;
        _failure = HistoryFailure.of(e);
      });
    } finally {
      if (mounted && ask == _asked) setState(() => _loading = false);
    }
  }

  Future<void> _more() async {
    final ask = _asked;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.history.search(_query, offset: _items.length);
      if (!mounted || ask != _asked) return;
      setState(() {
        _items.addAll(page.items);
        _hasMore = page.hasMore;
      });
    } catch (_) {
      // Keep what is shown; the button stays for another try.
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _set(HistoryQuery q) {
    _query = q;
    _search();
  }

  void _typed(String s) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _set(_query.copyWith(text: s)));
  }

  void _setPeriod(HistoryPeriod p) {
    _period = p;
    _set(_query.copyWith(from: p.fromKey(widget.now())));
  }

  Future<void> _open(HistoryCard card) async {
    final pick = await Navigator.of(context).push<HistoryPick>(
      MaterialPageRoute(builder: (_) => HistoryItemScreen(history: widget.history, itemId: card.id)),
    );
    if (pick != null && mounted) Navigator.of(context).pop(pick);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(findPreviousTitle)),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
          TextField(
            key: const Key('history-search'),
            controller: _text,
            onChanged: _typed,
            onSubmitted: (s) {
              _debounce?.cancel();
              _set(_query.copyWith(text: s));
            },
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Name, size, brand…'),
          ),
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: [
            ChoiceChip(
              key: const Key('history-kind-all'),
              label: const Text('All'),
              selected: _query.kind == null,
              onSelected: (_) => _set(_query.copyWith(kind: null)),
            ),
            for (final k in ItemKind.values)
              ChoiceChip(
                key: Key('history-kind-${k.wire}'),
                label: Text(k.label),
                selected: _query.kind == k,
                onSelected: (_) => _set(_query.copyWith(kind: k)),
              ),
          ]),
          const SizedBox(height: 10),
          if (widget.projects.length > 1)
            DropdownButtonFormField<String?>(
              key: const Key('history-project'),
              initialValue: _query.projectId,
              decoration: const InputDecoration(labelText: 'Project'),
              items: [
                const DropdownMenuItem(value: null, child: Text('All my projects')),
                for (final p in widget.projects.entries) DropdownMenuItem(value: p.key, child: Text(p.value)),
              ],
              onChanged: (id) => _set(_query.copyWith(projectId: id)),
            ),
          if (widget.categories.isNotEmpty) ...[
            const SizedBox(height: 10),
            DropdownButtonFormField<String?>(
              key: const Key('history-category'),
              initialValue: _query.category,
              decoration: const InputDecoration(labelText: 'Category'),
              items: [
                const DropdownMenuItem(value: null, child: Text('All categories')),
                for (final c in widget.categories) DropdownMenuItem(value: c, child: Text(c)),
              ],
              onChanged: (c) => _set(_query.copyWith(category: c)),
            ),
          ],
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final p in HistoryPeriod.values)
              ChoiceChip(
                key: Key('history-period-${p.name}'),
                label: Text(p.label),
                selected: _period == p,
                onSelected: (_) => _setPeriod(p),
              ),
          ]),
          const SizedBox(height: 14),
          ..._results(),
        ]),
      ),
    );
  }

  List<Widget> _results() {
    if (_loading && _items.isEmpty) {
      return const [Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))];
    }
    final f = _failure;
    if (f != null) {
      final copy = historyFailureCopy(f);
      return [
        FailureNotice(
          key: const Key('history-failure'),
          english: copy.english,
          tagalog: copy.tagalog,
          actions: [noticeAction(retryLabel, _search)],
        ),
      ];
    }
    final saved = _savedAt;
    return [
      if (saved != null)
        Container(
          key: const Key('history-saved-banner'),
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: WmColors.brownTint, borderRadius: BorderRadius.circular(12)),
          child: Text(savedBanner('${dayMonth(saved)}, ${clockTime(saved)}'),
              style: const TextStyle(fontSize: 12.5, color: WmColors.brownDeep)),
        ),
      if (_items.isEmpty)
        const Padding(
          key: Key('history-empty'),
          padding: EdgeInsets.all(24),
          child: Text(noMatchesText, textAlign: TextAlign.center, style: TextStyle(color: WmColors.textMuted)),
        ),
      for (final c in _items) _Card(card: c, history: widget.history, onTap: () => _open(c)),
      if (_hasMore)
        OutlinedButton(
          key: const Key('history-more'),
          onPressed: _loadingMore ? null : _more,
          child: Text(_loadingMore ? 'Loading…' : 'SHOW MORE'),
        ),
    ];
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.card, required this.history, required this.onTap});
  final HistoryCard card;
  final HistoryApi history;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = card;
    final sub = [if (c.spec.isNotEmpty) c.spec, c.unit, if (c.brand.isNotEmpty) c.brand].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          key: Key('history-card-${c.id}'),
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), border: Border.all(color: WmColors.border)),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              HistoryThumb(history: history, path: c.coverPath),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(c.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  Text(sub, style: const TextStyle(color: WmColors.textMuted)),
                  if (c.latest != null)
                    Text(c.latest!.summary, style: const TextStyle(fontSize: 12.5, color: WmColors.textSecondary)),
                  if (!c.active)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text('No longer listed', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: WmColors.brown)),
                    ),
                ]),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `flutter test test/history` → Expected: `All tests passed!` (43 tests: 12 + 16 + 15).
Run: `flutter test` → Expected: `All tests passed!`
Run: `flutter analyze` → Expected: `No issues found!`

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 4: Wire it into Requests, sign-out wipe, version 0.5.0

**Files:**
- Create: `lib/history/data/history_account_wipe.dart`
- Modify: `lib/requests/requests_services.dart`, `lib/requests/compose/item_editor_screen.dart`, `lib/requests/compose/compose_screen.dart`, `lib/requests/list/requests_screen.dart`, `lib/main.dart`, `pubspec.yaml`
- Test: `test/history/data/history_account_wipe_test.dart`, `test/history/ui/request_again_test.dart`

**Interfaces:**
- Consumes (Tasks 1–3): `HistoryApi`, `HistoryRepository`, `openDeviceHistoryDb`, `SupabaseHistoryRemote`, `FindPreviousScreen`, `HistoryThumb`, `historyProjects`, `historyCategories`, `HistoryPick`, `DraftLine.fromHistory`, `.withoutRef()`; `AppState` (`Ready`, `SignedOut`, `Starting`, `NeedsTerms`, `TermsUnavailable` in `lib/app_controller.dart`); `newEventId()` (`lib/attendance/domain/event_id.dart`); test helpers `tapKey` (`test/requests/compose/compose_test.dart`), `FakeRequestsApi`, `pipe` (`test/requests/request_fakes.dart`), `useTallPhone`.
- Produces:
  - `RequestsServices.history` (`HistoryApi?`, null hides every Find Previous Item entry point).
  - `ItemEditorScreen.destinations` (for the project filter); keys `item-find-previous`, `item-from-history`, `item-cover`.
  - `ComposeScreen.editLineOnOpen` (opens that line's editor once the lists load); key `line-cover` on a line card.
  - Requests tab key `find-previous`.
  - `HistoryAccountWipe(HistoryApi).onAppState(AppState)`.

- [ ] **Step 1: Write the failing tests**

#### Create `test/history/data/history_account_wipe_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/app_controller.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/history/data/history_account_wipe.dart';

import '../history_fakes.dart';

void main() {
  const u1 = WorkerProfile(id: 'u1');
  const u2 = WorkerProfile(id: 'u2');

  test('signed in keeps only that worker; signed out keeps nothing; switching keeps the new one', () {
    final api = FakeHistoryApi();
    final wipe = HistoryAccountWipe(api);
    wipe.onAppState(Starting());
    expect(api.kept, isEmpty, reason: 'startup decides nothing');
    wipe.onAppState(Ready(u1));
    wipe.onAppState(Ready(u1));
    expect(api.kept, ['u1'], reason: 'once per change');
    wipe.onAppState(SignedOut());
    expect(api.kept, ['u1', '']);
    wipe.onAppState(NeedsTerms(u2));
    expect(api.kept, ['u1', ''], reason: 'not let in yet');
    wipe.onAppState(Ready(u2));
    expect(api.kept, ['u1', '', 'u2']);
  });
}
```

#### Create `test/history/ui/request_again_test.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/history/ui/find_previous_screen.dart';
import 'package:workmate/requests/compose/compose_screen.dart';
import 'package:workmate/requests/compose/item_editor_screen.dart';
import 'package:workmate/requests/list/requests_controller.dart';
import 'package:workmate/requests/list/requests_screen.dart';
import 'package:workmate/requests/requests_services.dart';
import 'package:workmate/ui/theme.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../../requests/compose/compose_test.dart' show tapKey;
import '../../requests/request_fakes.dart';
import '../history_fakes.dart';

void main() {
  late FakeRequestsApi api;
  late FakeHistoryApi history;
  setUp(() {
    api = FakeRequestsApi();
    history = FakeHistoryApi();
  });

  RequestsServices services({bool withHistory = true}) =>
      RequestsServices(api: api, takePhoto: (_) async => null, history: withHistory ? history : null);

  Future<void> openCompose(WidgetTester tester, {bool withHistory = true}) async {
    useTallPhone(tester);
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: ComposeScreen(draft: api.newDraft(), services: services(withHistory: withHistory), now: () => DateTime(2026, 10, 11)),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('add-item')));
    await tester.pumpAndSettle();
  }

  Future<void> requestAgainFromHistory(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('history-card-i1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('history-request-again')));
    await tester.pumpAndSettle();
  }

  testWidgets('mid-request: the picked item comes back filled in with its link; the worker sets the quantity', (tester) async {
    await openCompose(tester);
    await tapKey(tester, 'item-find-previous');
    await requestAgainFromHistory(tester);
    expect(find.byType(ItemEditorScreen), findsOneWidget);
    expect(find.byKey(const Key('item-from-history')), findsOneWidget);
    expect(find.text('Outlet'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('item-quantity')), '4');
    await tapKey(tester, 'item-save');
    final line = api.savedDrafts.values.single.lines.single;
    expect(line.catalogItemId, 'i1');
    expect(line.refKind, 'request_line');
    expect(line.refId, 'l1');
    expect(line.refCoverPath, 'o1/i1/p1.jpg');
    expect(line.quantity, '4');
    expect(line.photos, isEmpty, reason: 'the cover is for recognition, never a request photo');
    expect(find.byKey(const Key('line-cover')), findsOneWidget);
    expect(api.sent, isEmpty, reason: 'never sends by itself');
  });

  testWidgets('choosing another item from the list drops the history link', (tester) async {
    await openCompose(tester);
    await tapKey(tester, 'item-find-previous');
    await requestAgainFromHistory(tester);
    await tapKey(tester, 'item-change');
    await tapKey(tester, 'catalog-${pipe.id}');
    await tester.enterText(find.byKey(const Key('item-quantity')), '2');
    await tapKey(tester, 'item-save');
    final line = api.savedDrafts.values.single.lines.single;
    expect(line.catalogItemId, pipe.id);
    expect(line.refKind, isNull);
    expect(line.refId, isNull);
    expect(line.refCoverPath, isNull);
  });

  testWidgets('without Find Previous Item the link is not offered', (tester) async {
    await openCompose(tester, withHistory: false);
    expect(find.byKey(const Key('item-find-previous')), findsNothing);
  });

  testWidgets('standalone: from the Requests tab, a new draft opens on the picked item', (tester) async {
    useTallPhone(tester);
    final controller = RequestsController(api: api, now: () => DateTime.utc(2026, 10, 11, 2));
    await controller.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(body: RequestsScreen(controller: controller, services: services())),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('find-previous')));
    await tester.pumpAndSettle();
    final screen = tester.widget<FindPreviousScreen>(find.byType(FindPreviousScreen));
    expect(screen.projects, {for (final d in api.refs.destinations) d.projectId: d.projectName}, reason: 'the worker\'s own projects');
    expect(screen.categories, ['plumbing']);

    await requestAgainFromHistory(tester);
    expect(find.byType(ComposeScreen, skipOffstage: false), findsOneWidget, reason: 'under the item editor');
    expect(find.byType(ItemEditorScreen), findsOneWidget, reason: 'opened on the item, for quantity and date');
    final draft = api.savedDrafts.values.single;
    expect(draft.destination, isNull, reason: 'the worker chooses the project and work');
    expect(draft.lines.single.refId, 'l1');
    expect(api.sent, isEmpty);
  });

  testWidgets('the Requests tab hides the button without Find Previous Item', (tester) async {
    useTallPhone(tester);
    final controller = RequestsController(api: api, now: () => DateTime.utc(2026, 10, 11, 2));
    await controller.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(body: RequestsScreen(controller: controller, services: services(withHistory: false))),
    ));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('find-previous')), findsNothing);
  });
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/history/data/history_account_wipe_test.dart test/history/ui/request_again_test.dart`
Expected: FAIL — compile errors: `history_account_wipe.dart` not found; `RequestsServices` has no parameter `history`.

- [ ] **Step 3: Create the wipe**

#### Create `lib/history/data/history_account_wipe.dart`

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../app_controller.dart';
import 'history_api.dart';

/// Spec 1b §4.4: the offline copy is wiped on sign-out or account switch.
/// Fed every app state: once a worker is let in, only their copy is kept;
/// signed out, nothing is. Startup and the Terms screens decide nothing.
/// Keeping "only this worker" (not forgetting "the last one") also cleans a
/// switch that happened while the app was closed.
class HistoryAccountWipe {
  HistoryAccountWipe(this.history);

  final HistoryApi history;
  String? _kept;

  void onAppState(AppState s) {
    final keep = switch (s) {
      Ready(:final worker) => worker.id,
      SignedOut() => '',
      _ => null,
    };
    if (keep == null || keep == _kept) return;
    _kept = keep;
    unawaited(history.keepOnly(keep).catchError((Object e) => debugPrint('History wipe failed: $e')));
  }
}
```

- [ ] **Step 4: Give Requests the history service**

**Edit `lib/requests/requests_services.dart` (1/3).** Find:

```dart
import 'camera/request_camera_screen.dart';
```

Replace with:

```dart
import '../history/data/history_api.dart';
import 'camera/request_camera_screen.dart';
```

**Edit `lib/requests/requests_services.dart` (2/3).** Find:

```dart
  const RequestsServices({required this.api, this.takePhoto = realTakePhoto, this.changed});
```

Replace with:

```dart
  const RequestsServices({required this.api, this.takePhoto = realTakePhoto, this.changed, this.history});
```

**Edit `lib/requests/requests_services.dart` (3/3).** Find:

```dart
  final Listenable? changed;
}
```

Replace with:

```dart
  final Listenable? changed;

  /// Find Previous Item (Stage 1b); null hides it, e.g. when its database
  /// could not open.
  final HistoryApi? history;
}
```

- [ ] **Step 5: The item editor — the link, and the link kept honest**

A pick from the list, *Change*, and switching Material/Tool all drop the history link; only a Find Previous Item pick sets it.

**Edit `lib/requests/compose/item_editor_screen.dart` (1/10).** Find:

```dart
import '../../ui/theme.dart';
```

Replace with:

```dart
import '../../history/data/history_api.dart';
import '../../history/domain/history_models.dart';
import '../../history/ui/find_previous_screen.dart';
import '../../history/ui/history_thumb.dart';
import '../../ui/theme.dart';
```

**Edit `lib/requests/compose/item_editor_screen.dart` (2/10).** Find:

```dart
    required this.services,
    this.now = DateTime.now,
  });

  final DraftLine line;
```

Replace with:

```dart
    required this.services,
    this.destinations = const [],
    this.now = DateTime.now,
  });

  final DraftLine line;
```

**Edit `lib/requests/compose/item_editor_screen.dart` (3/10).** Find:

```dart
  final RequestsServices services;
  final DateTime Function() now;

  @override
  State<ItemEditorScreen> createState()
```

Replace with:

```dart
  final RequestsServices services;

  /// The worker's projects, for Find Previous Item's project filter.
  final List<Destination> destinations;
  final DateTime Function() now;

  @override
  State<ItemEditorScreen> createState()
```

**Edit `lib/requests/compose/item_editor_screen.dart` (4/10).** Find:

```dart
  void _pick(CatalogItem item) {
    final picked = DraftLine.fromCatalog(_line.id, item);
    setState(() {
      _line = _current.copyWith(
        kind: picked.kind,
        catalogItemId: picked.catalogItemId,
        description: picked.description,
        spec: picked.spec,
        unit: picked.unit,
        category: picked.category,
```

Replace with:

```dart
  void _pick(CatalogItem item) => _take(DraftLine.fromCatalog(_line.id, item));

  /// Find Previous Item: the item comes back filled in with its link to the
  /// history row; the worker still sets quantity and needed-by (spec 1b §4.3).
  Future<void> _findPrevious(HistoryApi history) async {
    final pick = await Navigator.of(context).push<HistoryPick>(MaterialPageRoute(
      builder: (_) => FindPreviousScreen(
        history: history,
        projects: historyProjects(widget.destinations),
        categories: historyCategories(widget.catalog),
        now: widget.now,
      ),
    ));
    if (pick != null && mounted) _take(DraftLine.fromHistory(_line.id, pick));
  }

  /// Takes a picked item's fields AND its history link: a pick from the
  /// list carries none, so it clears a link left from an earlier pick.
  void _take(DraftLine picked) {
    setState(() {
      _line = _current.copyWith(
        kind: picked.kind,
        catalogItemId: picked.catalogItemId,
        description: picked.description,
        spec: picked.spec,
        unit: picked.unit,
        category: picked.category,
        refKind: picked.refKind,
        refId: picked.refId,
        refCoverPath: picked.refCoverPath,
```

**Edit `lib/requests/compose/item_editor_screen.dart` (5/10).** Find:

```dart
  void _unpick() => setState(() {
        _line = _current.copyWith(catalogItemId: null);
```

Replace with:

```dart
  void _unpick() => setState(() {
        _line = _current.withoutRef().copyWith(catalogItemId: null);
```

**Edit `lib/requests/compose/item_editor_screen.dart` (6/10).** Find:

```dart
              _line = _current.copyWith(
                kind: s.first,
                catalogItemId: null,
```

Replace with:

```dart
              _line = _current.withoutRef().copyWith(
                kind: s.first,
                catalogItemId: null,
```

**Edit `lib/requests/compose/item_editor_screen.dart` (7/10).** Find:

```dart
            _Picked(line: _current, onChange: _unpick),
```

Replace with:

```dart
            _Picked(line: _current, history: widget.services.history, onChange: _unpick),
```

**Edit `lib/requests/compose/item_editor_screen.dart` (8/10).** Find:

```dart
              label: const Text('Not in the list? Describe it'),
            ),
```

Replace with:

```dart
              label: const Text('Not in the list? Describe it'),
            ),
            if (widget.services.history case final history?)
              TextButton.icon(
                key: const Key('item-find-previous'),
                onPressed: () => _findPrevious(history),
                icon: const Icon(Icons.history),
                label: const Text('Find previous item'),
              ),
```

**Edit `lib/requests/compose/item_editor_screen.dart` (9/10).** Find:

```dart
class _Picked extends StatelessWidget {
  const _Picked({required this.line, required this.onChange});
  final DraftLine line;
  final VoidCallback onChange;
```

Replace with:

```dart
class _Picked extends StatelessWidget {
  const _Picked({required this.line, required this.history, required this.onChange});
  final DraftLine line;
  final HistoryApi? history;
  final VoidCallback onChange;
```

**Edit `lib/requests/compose/item_editor_screen.dart` (10/10).** Find:

```dart
          const Icon(Icons.inventory_2_outlined, color: WmColors.green),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(line.description, style: const TextStyle(fontWeight: FontWeight.w800)),
              Text([if (line.spec.isNotEmpty) line.spec, line.unit].join(' · '), style: const TextStyle(color: WmColors.textMuted)),
            ]),
```

Replace with:

```dart
          if (history != null && line.refCoverPath != null)
            HistoryThumb(key: const Key('item-cover'), history: history!, path: line.refCoverPath, size: 48)
          else
            const Icon(Icons.inventory_2_outlined, color: WmColors.green),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(line.description, style: const TextStyle(fontWeight: FontWeight.w800)),
              Text([if (line.spec.isNotEmpty) line.spec, line.unit].join(' · '), style: const TextStyle(color: WmColors.textMuted)),
              if (line.fromHistory)
                const Text('From Find Previous Item', key: Key('item-from-history'), style: TextStyle(fontSize: 12.5, color: WmColors.green)),
            ]),
```

- [ ] **Step 6: The draft — cover on the line card, open on a picked line**

`load()` moves from the field initialiser into `initState` so the screen can open the picked line's editor once the lists are in.

**Edit `lib/requests/compose/compose_screen.dart` (1/8).** Find:

```dart
import '../../attendance/ui/attendance_copy.dart';
```

Replace with:

```dart
import '../../attendance/ui/attendance_copy.dart';
import '../../history/data/history_api.dart';
import '../../history/ui/history_thumb.dart';
```

**Edit `lib/requests/compose/compose_screen.dart` (2/8).** Find:

```dart
  const ComposeScreen({super.key, required this.draft, required this.services, this.now = DateTime.now});

  final RequestDraft draft;
  final RequestsServices services;
  final DateTime Function() now;
```

Replace with:

```dart
  const ComposeScreen({super.key, required this.draft, required this.services, this.editLineOnOpen, this.now = DateTime.now});

  final RequestDraft draft;
  final RequestsServices services;

  /// Opens this line's editor once the lists load: Request Again from the
  /// Requests tab lands on the quantity (spec 1b §4.3 "standalone").
  final String? editLineOnOpen;
  final DateTime Function() now;
```

**Edit `lib/requests/compose/compose_screen.dart` (3/8).** Find:

```dart
  late final ComposeController _c = ComposeController(api: widget.services.api, draft: widget.draft)..load();
  late final _note = TextEditingController(text: widget.draft.note);

```

Replace with:

```dart
  late final ComposeController _c = ComposeController(api: widget.services.api, draft: widget.draft);
  late final _note = TextEditingController(text: widget.draft.note);

  @override
  void initState() {
    super.initState();
    unawaited(_c.load().then((_) => _openLineOnLoad()));
  }

  void _openLineOnLoad() {
    final id = widget.editLineOnOpen;
    if (id == null || !mounted) return;
    final line = _c.draft.lines.where((l) => l.id == id).firstOrNull;
    if (line != null) unawaited(_editLine(line, isNew: false));
  }

```

**Edit `lib/requests/compose/compose_screen.dart` (4/8).** Find:

```dart
        draftId: _c.draft.id,
        services: widget.services,
        now: widget.now,
```

Replace with:

```dart
        draftId: _c.draft.id,
        services: widget.services,
        destinations: refs?.destinations ?? const [],
        now: widget.now,
```

**Edit `lib/requests/compose/compose_screen.dart` (5/8).** Find:

```dart
                      line: d.lines[i],
                      hasIssue: lineIssues.contains(i),
```

Replace with:

```dart
                      line: d.lines[i],
                      history: widget.services.history,
                      hasIssue: lineIssues.contains(i),
```

**Edit `lib/requests/compose/compose_screen.dart` (6/8).** Find:

```dart
  const _LineCard({super.key, required this.line, required this.hasIssue, required this.onTap});
  final DraftLine line;
  final bool hasIssue;
```

Replace with:

```dart
  const _LineCard({super.key, required this.line, required this.history, required this.hasIssue, required this.onTap});
  final DraftLine line;

  /// Shows a Find Previous Item line's cover photo, for recognition only:
  /// it is not one of the request's photos (spec 1b §4.3).
  final HistoryApi? history;
  final bool hasIssue;
```

**Edit `lib/requests/compose/compose_screen.dart` (7/8).** Find:

```dart
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text(line.description.isEmpty ? 'Unnamed item' : line.description,
```

Replace with:

```dart
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (history != null && line.refCoverPath != null) ...[
              HistoryThumb(key: const Key('line-cover'), history: history!, path: line.refCoverPath, size: 44),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text(line.description.isEmpty ? 'Unnamed item' : line.description,
```

**Edit `lib/requests/compose/compose_screen.dart` (8/8).** Find:

```dart
            if (hasIssue) const Text('Check this item.', style: TextStyle(color: WmColors.danger, fontSize: 12.5)),
          ]),
        ),
```

Replace with:

```dart
            if (hasIssue) const Text('Check this item.', style: TextStyle(color: WmColors.danger, fontSize: 12.5)),
              ]),
            ),
          ]),
        ),
```

- [ ] **Step 7: The Requests tab — Find previous item starts a new draft**

**Edit `lib/requests/list/requests_screen.dart` (1/4).** Find:

```dart
import '../../attendance/ui/attendance_copy.dart';
```

Replace with:

```dart
import '../../attendance/domain/event_id.dart';
import '../../attendance/ui/attendance_copy.dart';
```

**Edit `lib/requests/list/requests_screen.dart` (2/4).** Find:

```dart
import '../../ui/failure_notice.dart';
```

Replace with:

```dart
import '../../history/data/history_api.dart';
import '../../history/domain/history_models.dart';
import '../../history/ui/find_previous_screen.dart';
import '../../ui/failure_notice.dart';
```

**Edit `lib/requests/list/requests_screen.dart` (3/4).** Find:

```dart
  Future<void> _compose(BuildContext context, RequestDraft draft) async {
    await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ComposeScreen(draft: draft, services: services)));
    await controller.refresh();
  }
```

Replace with:

```dart
  Future<void> _compose(BuildContext context, RequestDraft draft, {String? editLine}) async {
    await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => ComposeScreen(draft: draft, services: services, editLineOnOpen: editLine)));
    await controller.refresh();
  }

  /// Request Again from the tab (spec 1b §4.3 "standalone"): a new draft
  /// holding the picked item, opened on that item for quantity and date;
  /// the worker then chooses the project, work and team. Never sends.
  Future<void> _findPrevious(BuildContext context, HistoryApi history) async {
    // The filter lists; a slow signal must not hold the screen back.
    RequestReferences? refs;
    try {
      refs = await services.api.references().timeout(const Duration(seconds: 3));
    } catch (_) {}
    if (!context.mounted) return;
    final pick = await Navigator.of(context).push<HistoryPick>(MaterialPageRoute(
      builder: (_) => FindPreviousScreen(
        history: history,
        projects: historyProjects(refs?.destinations ?? const []),
        categories: historyCategories(refs?.catalog ?? const []),
      ),
    ));
    if (pick == null || !context.mounted) return;
    final line = DraftLine.fromHistory(newEventId(), pick);
    final draft = services.api.newDraft().copyWith(lines: [line]);
    try {
      await services.api.saveDraft(draft);
    } catch (_) {
      // Compose saves again on the first change.
    }
    if (context.mounted) await _compose(context, draft, editLine: line.id);
  }
```

**Edit `lib/requests/list/requests_screen.dart` (4/4).** Find:

```dart
              const SizedBox(height: 4),
              const Text('Materials and tools for your projects.', style: TextStyle(color: WmColors.textMuted)),
              const SizedBox(height: 12),
```

Replace with:

```dart
              const SizedBox(height: 4),
              const Text('Materials and tools for your projects.', style: TextStyle(color: WmColors.textMuted)),
              if (services.history case final history?) ...[
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  key: const Key('find-previous'),
                  onPressed: () => _findPrevious(context, history),
                  icon: const Icon(Icons.history),
                  label: const Text('Find previous item'),
                ),
              ],
              const SizedBox(height: 12),
```

- [ ] **Step 8: main.dart and the version**

Find Previous Item is optional like Requests: if its database cannot open, the app starts without it.

**Edit `lib/main.dart` (1/3).** Find:

```dart
import 'auth/worker_cache.dart';
```

Replace with:

```dart
import 'auth/worker_cache.dart';
import 'history/data/history_account_wipe.dart';
import 'history/data/history_db.dart';
import 'history/data/history_remote.dart';
import 'history/data/history_repository.dart';
```

**Edit `lib/main.dart` (2/3).** Find:

```dart
  RequestsServices? requests;
  try {
    requests = RequestsServices(
```

Replace with:

```dart
  // Find Previous Item (Stage 1b): optional like Requests — if its database
  // cannot open, Requests works without it. The saved copy is kept for the
  // signed-in worker only (spec 1b §4.4).
  HistoryRepository? history;
  try {
    final repo = HistoryRepository(
      db: await openDeviceHistoryDb(),
      remote: SupabaseHistoryRemote(client),
      currentWorkerId: attendance.currentWorkerId,
      photoDir: () async =>
          Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}history-photos'),
    );
    final wipe = HistoryAccountWipe(repo);
    controller.addListener(() => wipe.onAppState(controller.state));
    wipe.onAppState(controller.state);
    history = repo;
  } catch (e) {
    debugPrint('Find Previous Item unavailable: $e');
  }

  RequestsServices? requests;
  try {
    requests = RequestsServices(
```

**Edit `lib/main.dart` (3/3).** Find:

```dart
      changed: queueSettled,
    );
```

Replace with:

```dart
      changed: queueSettled,
      history: history,
    );
```

**Edit `pubspec.yaml` (1/1).** Find:

```yaml
version: 0.4.0+1004
```

Replace with:

```yaml
version: 0.5.0+1005
```

- [ ] **Step 9: Run the tests**

Run: `flutter test test/history` → Expected: `All tests passed!` (49 tests: 12 + 16 + 15 + 1 + 5).
Run: `flutter test` → Expected: `All tests passed!` (591 tests at the time of planning).
Run: `flutter analyze` → Expected: `No issues found!`

- [ ] **Step 10: Stop — no commit.** Report to the controller.

---

### Task 5: Release build and phone pilot (controller + user)

**Files:**
- Modify (close-out only): this plan — append `## Execution notes (YYYY-MM-DD)`; memory `workmate-requests-0085.md` and its `MEMORY.md` line.

**Pilot accounts:** W-0007, W-0019, W-0021 (test workers). **Project:** Barlin Residence (Allow item history **ON**). **Item:** *ZZ test pipe* (brand ZZBrand, aliases saksakan, plug). Check the database after every step through MCP `execute_sql` (read-only queries); never edit pilot data by SQL.

- [ ] **Step 1: Final checks.** In the WorkMate repo: `flutter analyze` → `No issues found!`; `flutter test` → `All tests passed!`.
- [ ] **Step 2: Build.** With `JAVA_HOME` = JDK 21: `flutter build apk --release` (never `--split-per-abi`). Expected: `build/app/outputs/flutter-apk/app-release.apk`, **under 50 MB** (the updates bucket limit). Never print or commit the keystore or its passwords.
- [ ] **Step 3: Install** on the test phone: `adb install -r build/app/outputs/flutter-apk/app-release.apk`. `adb shell dumpsys package com.dacs.workmate | grep versionName` shows **0.5.0**.
- [ ] **Step 4: Office setup (user, in Dacs Web).** Requests → Item history → *ZZ test pipe*: upload **one product-only photo** (all three checklist ticks; no face, price or receipt) and make it the cover; add one historical reference for Barlin Residence, Main Contract, *approximate* date in Aug 2026. Controller confirms: `select allow_history from pr_project_settings where allow_history;` lists Barlin's row, and `pr_office_history_item` (or the Dacs Web page) shows the approved photo and the reference.
- [ ] **Step 5: Pilot — run each check, note PASS/FAIL with a screenshot when it fails.**
  1. **Search (W-0007).** Requests → *Find previous item*. Typing `saksakan`, then `ZZBrand`, finds *ZZ test pipe* with its cover and a "Latest: …" line. The other kind chip hides it. *Last 30 days* still shows it when its latest entry is recent.
  2. **Item page.** Photos swipe (cover first); entries newest first, each with project · work, date and label; the reference reads "around Aug 2026". **No requester name, price or stock anywhere.**
  3. **Standalone Request Again.** From the item page, *REQUEST THIS ITEM AGAIN* opens a new draft on the item editor with quantity empty and "From Find Previous Item". Enter 1, choose Barlin · Main Contract, send. DB: `select description, ref_kind, ref_id from pr_lines where ref_kind is not null;` shows the new line with `ref_kind = 'request_line'` and the entry's id.
  4. **Mid-request.** New request → Add item → *Find previous item* → *Request again* on the **reference** row → save; the line card shows the cover. Send. DB: that line has `ref_kind = 'reference'`. No request photo was attached (`pr_photos` has none for it).
  5. **Link dropped on change.** Add an item through Find Previous Item, tap *Change*, pick a catalogue item, send. DB: that line's `ref_kind` and `ref_id` are null.
  6. **Offline.** Open the item once online. Airplane mode → reopen: the search shows "Can't connect — showing saved results from …" and finds the item by alias; the item page shows the saved banner; *Request again* works into a draft. Reconnect → send. DB: the line's link is kept.
  7. **History switched off.** Office turns Barlin's *Allow item history* **OFF**. Online, reopen Find Previous Item: Barlin's entries **from other workers and its historical references** are gone — the worker's **own** Barlin requests stay visible (0090 rule: a worker always sees their own request lines; an item vanishes only if nothing of theirs remains). Airplane mode: the saved copy has lost the same entries. Turn it back **ON**. *(Corrected during the pilot, 2026-10-12: the first wording expected the worker's own items to vanish too.)*
  8. **Shared phone.** W-0007 signs out; W-0019 signs in. In airplane mode, Find Previous Item shows the no-connection notice — **none of W-0007's saved items**. Online, W-0019 sees only history from their own projects.
  9. **A link that went stale.** Make a draft through Request again on the reference row; before sending, the office retires that reference. Send: the request is accepted and DB shows the line **without** a link (0090 drops a link the worker may no longer see).
  10. **Retired photo (added by the final review).** Open the item once online so it is saved. The office retires that gallery photo. Reopen Find Previous Item online, then open the item in airplane mode: the retired photo is gone from the saved copy.
  11. **Office sees the source (added by the final review).** For the line sent in check 3, Dacs Web → Requests shows "Requested again from …" on that line.
  12. **Slow signal (added by the final review).** On weak signal, double-tap *Find previous item* on the Requests tab: one search screen opens (the button shows a spinner while busy). In a standalone Request Again, tap the line card before the lists finish loading: only one item editor opens.
- [ ] **Step 6: Findings.** A failing check is fixed TDD-style in the WorkMate repo (`test/history/**` or `test/requests/**`), then `flutter analyze` + `flutter test`, bump to **0.5.1+1006**, rebuild, reinstall, and re-run only that check. A server finding needs a new migration (next free number) with the dry-run → apply → verify cycle — stop and ask the user first.
- [ ] **Step 7: Close-out.** Ask the user about the pilot test requests (leave them, or close the open ones with the office **Cancel item**; **never delete**). Append the execution notes (each check's outcome, findings, rulings). Update memory `workmate-requests-0085.md` and its `MEMORY.md` line: 1b-4 done; next 1b-3 seeding.
- [ ] **Step 8: Publishing (only if the user asks, after the pilot passes):** upload the APK in Dacs Web → Attendance → App updates, stream `com.dacs.workmate`. Workers stay on the old Attendance app until the current project ends (0E deferred).
- [ ] **Step 9: Stop — the user commits both repos.**

---

## Execution notes (2026-10-12)

Executed subagent-driven on WorkMate `main` (no worktree, **nothing committed by the agent**). Every task's files matched the controller-simulated build byte for byte before review. Final state: `flutter test` **602 passed**, `flutter analyze` clean, version **0.5.0+1005**; release APK **36.1 MB** (JDK 21), installed on the test phone.

**Review rounds (beyond the plan text):**
- Task 2 — cleanup now also asks `pr_history_visible` about items whose cover was only cached from a search card, and deletes those photos when the item is no longer visible; cleanup re-reads each saved item and skips one opened meanwhile (fresh copy wins); offline search with only >14-day copies says "savedTooOld". (+4 tests)
- Task 3 — Show more is off and a refresh bar shows while a refined search runs; a failed Show more shows a bilingual notice. (+2 tests)
- Final review wave — Requests-tab *Find previous item* button has a busy guard + spinner (no double screens); the auto-opened editor does not open over something the worker already opened; sign-out also removes photo folders the database never recorded; cleanup failures are logged; thumbnails decode at display size; an offline next page says "no connection"; a failed wipe retries on the next state change. (+5 tests)

**Rulings (cost if wrong):**
- Executed on `main`, no commits — the user commits (one large uncommitted diff to review).
- Cached cover of a still-visible item is kept even if retired (its photo id can't be read from the path) — a retired product photo can linger in app storage until the limits or sign-out remove it.
- Parked: retired cover can still show on that worker's own draft line in a narrow case; project filter lists only currently requestable projects and offline "Latest" ignores filters; backing out of standalone Request Again leaves a one-line draft; the double-tap test proves "disabled while busy", not the synchronous guard.

**Phone pilot — 12/12 PASS (W-0007, W-0019; Barlin Residence; ZZ test pipe), each checked against the DB:**
1. Search by alias (`saksakan`) and brand (`ZZBrand`) with cover + "Latest"; Tool chip → No matches.
2. Item page: cover, details, aliases, entries newest first with labels, reference "around Aug 2026"; no names/prices/stock.
3. Standalone Request Again → line `ref_kind = request_line` to the newest entry; 0 request photos.
4. Mid-request via the reference row → `ref_kind = reference` ("Kitchen outlets"); cover on the line card; 0 photos.
5. Editor showed "From Find Previous Item" + empty Quantity; *Change* → catalogue item sent with no link.
6. Offline: dated banner, alias search on the saved copy, Request Again → Pending sync → sent with the link.
7. History switched off: the reference and other workers' entries vanished online and from the saved copy; the worker's **own** lines stay (0090 rule — this check's wording was corrected during the pilot).
8. Shared phone: after switching W-0007 → W-0019, offline shows the bilingual no-signal notice and none of W-0007's saved items.
9. Reference retired between draft and send → request accepted, line arrived with no link.
10. Cover retired → placeholder online; saved item page offline says "No photo yet".
11. Dacs Web shows "Requested again from …" for both a request-line and a reference source (kept after the reference was retired).
12. Double tap on *Find previous item* → one screen; one back → Requests tab. (The "tap the line before the lists load" half needs real weak signal — not exercised.)

**Pilot finding (deferred, server):** `pr_ref_label` (0090) hard-codes " · Requested", so a source line that was later cancelled reads "Requested" in Dacs Web while the phone says "Requested — cancelled". Fix in a new migration using `pr_entry_label`; no app change.

**Pilot data left:** test requests by W-0007/W-0019 in Barlin (10:19, 10:25, 10:29 RAM, 10:33, 10:47 on 12 Oct); ZZ test pipe's pilot cover photo and the "Kitchen outlets" reference are **retired** (office record kept). Barlin's Item history is **On**. APK **not published**.
