# WorkMate Stage 1a-3 — Requests in the App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DAC'S WorkMate gains a **Requests** tab: a worker or team leader prepares a material/tool request on the phone (project → Main Contract or an Additional Works job → one team or just me → items picked from the office's list or described, with quantity, urgency, member and photos), sends it once even with no signal, follows each item's status and expected delivery, changes quantities or cancels, and sees request updates on Home.

**Architecture:** Offline-first, exactly like Attendance. Drafts and a **send-once operation queue** live in a new on-phone database (`workmate_requests.db`); each operation carries an id minted once, so the 0085 RPCs answer a retry with their first answer. The queue drains in the **same WorkManager task and live-app sync host as attendance** (attendance first; a request failure never fails attendance). Quantity edits carry the line version the worker saw, **chained** across edits still waiting on the phone, so an edit made against an outdated version reaches the office as a conflict instead of an overwrite. Screens read through a `RequestsApi` interface, so every controller and screen is tested with a fake.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, supabase_flutter 2.17.2, sqflite 2.4.2+1 (tests: sqflite_common_ffi), camera 0.12.0+2, permission_handler 12.0.1, Kotlin (one line).

**Spec:** `Dacs Web/docs/superpowers/specs/2026-09-29-unified-worker-app-design.md` — §3 (one team per request; leader = role AND assignment; completed work blocks requests; offline draft whose destination closed stays visible), §4A (items, catalogue/unlisted, weekly batches, per-item urgency, portions), §4B (quantity changes), §4E (offline states and send-once), §5 (Home "request updates", Requests tab). Roadmap: `Dacs Web/docs/superpowers/plans/2026-10-02-workmate-stage1a-roadmap.md` row **1a-3**. Server: `Dacs Web/supabase/migrations/0085_workmate_requests.sql` (live) — read §7–§10 before starting.

**This plan's code was compiled and tested before it was written down:** every file below was built in a scratch copy of the repo; `flutter analyze` → "No issues found!", `flutter test` → **505 passed** (433 existing + 72 new). Transcribe it exactly; where a step says "replace", the old text is quoted exactly.

## Global Constraints

- **Repo:** paths are relative to `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate` unless they start with `Dacs Web/`. Run every command from that folder.
- **NEVER run `git commit` or `git push`.** The user commits. Each task ends with "Stop — no commit".
- **Line endings LF**, like every existing file (`git ls-files --eol` shows `i/lf w/lf`). One trailing newline.
- **No new pub.dev dependencies.** Do not bump any pinned version (`permission_handler` stays **12.0.1**). No `image_picker`: request photos come from the in-app camera only.
- **No database change.** 1a-3 uses the live 0085 worker RPCs exactly: `pr_destinations()`, `pr_my_teams()`, `pr_catalog()`, `pr_my_requests(p_limit)`, `pr_submit_request(p_op, p_request)`, `pr_change_quantity(p_op, p_line, p_base_version, p_quantity)`, `pr_cancel_line(p_op, p_line)`, `pr_cancel_request(p_op, p_request)`, `pr_attach_photo(p_op, p_request, p_line, p_path)`; photos go to the private bucket **`request-photos`** at **`{worker}/{request}/{photo}.jpg`**. No task touches the database.
- **Copy rule:** screen copy is **English**; failure copy is **bilingual (English, then Tagalog)**. Attendance's existing words are reused where they exist (`failureCopy(...)`); new strings are marked NEW in `lib/requests/ui/requests_copy.dart`. A raw server/HTTP string never reaches the screen.
- **Time:** instants are shown in **Manila time** (`lib/attendance/ui/formats.dart`, `lib/attendance/domain/work_date.dart`); calendar dates (`purchase_on`, `delivery_on`, `needed_by`) are read as dates, never shifted. Never `toIso8601String().substring(0, 10)` for a local date.
- **No money anywhere.** The 0085 tables hold none; nothing here shows or stores a price, amount or cost.
- **Shared phones:** every local read and write is scoped to the worker the app let in (`currentWorkerId`, '' = nobody → `StateError('AUTH_REQUIRED')`). Every server write checks the session is that same worker.
- **Version:** ships as **`0.4.0+1004`** (versionCode ≥ 1000 and rising) — bumped in Task 11 only.
- **Verification:** `flutter analyze` → "No issues found!"; `flutter test` → all pass. Kotlin: `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; Push-Location android; .\gradlew.bat :app:testDebugUnitTest; Pop-Location` → `BUILD SUCCESSFUL`.

## Decisions (made while planning)

| Topic | Decision | Why |
|---|---|---|
| Where requests sync | The **same** WorkManager work (`attendance-submission`) and the same live-app `AttendanceSyncHost`; `syncWith` drains attendance, then requests | One token refresher per process (the reason `AttendanceSyncHost` exists); one backstop sweeper |
| Photo upload retry | `upsert: false`; "already exists" (409/Duplicate) counts as uploaded | 0085 gives workers no UPDATE on storage, so an upsert retry would be refused |
| Photos per item | Up to **3**, in-app back camera, no caption band (`PhotoPreparer` skips the band when the caption is empty) | Enough to show a part; light on site signal |
| Intended member | Picker shown only to the **current leader** of the chosen team, materials only | 0085: naming someone else needs the leader; tools name a person at issue (spec §4A) |
| Pending (sent, not yet received) | Read-only; no "stop sending" | Pulling back an op that may already be on the server would duplicate the request |
| Refused request | Stays visible as **Failed**; "Edit and send again" returns it to Drafts (new op id) | Spec §3: an offline draft whose destination closed stays visible for resolution |
| `unexpected` failures | Retried; given up after **10** attempts | One bad operation must not block the queue forever |
| Owner-less account | Empty destination list → "No project is open for requests right now. If this keeps happening, call the office." | 1a-1 carry-over; 0085 offers nothing to such an account |
| Requests tab position | Home · **Requests** · History · Profile | Spec §5 order |

## File map

| File | Task | Responsibility |
|---|---|---|
| `lib/requests/domain/quantity.dart` | 1 | Quantity rules (server bounds) and formatting |
| `lib/requests/domain/request_models.dart` | 1 | `ItemKind`, `Destination`, `MyTeam`, `TeamMember`, `CatalogItem` |
| `lib/requests/domain/remote_request.dart` | 1 | `RemoteRequest`, `RemoteLine`, `Portion`, `RemotePhoto` (pr_my_requests) |
| `lib/requests/domain/request_draft.dart` | 2 | `RequestDraft`, `DraftLine`, `draftIssues`, `submitPayload` |
| `lib/requests/domain/request_status.dart` | 2 | `SyncState`, `LineProgress`, edit rules, `calendarDay`, `nextDelivery` |
| `lib/requests/domain/request_failure.dart` | 2 | Server codes → `RequestFailure`, retryable or not |
| `lib/requests/domain/request_op.dart` | 2 | `RequestOp`, `predictedBase`, `rebaseAfter` (version chaining) |
| `lib/requests/ui/requests_copy.dart` | 2 | Every label and bilingual failure text |
| `lib/requests/data/requests_db.dart` | 3 | Drafts, queue, submit links, offline cache (sqflite) |
| `lib/requests/data/request_remote.dart` | 4 | RPC + storage calls, exact parameters |
| `lib/requests/sync/request_sync.dart` | 4 | The send-once drain |
| `lib/requests/data/requests_api.dart` | 5 | Interface + view models for the screens |
| `lib/requests/data/request_repository.dart` | 5 | Offline-first implementation |
| `lib/attendance/sync/background_sync.dart`, `sync_host.dart` | 6 | Drain requests in the same task; `drainNow()` |
| `android/.../PhotoPreparer.kt` | 6 | No caption band for an empty caption |
| `lib/requests/camera/request_camera_screen.dart`, `lib/requests/requests_services.dart` | 6 | Back-camera capture; what the screens need |
| `lib/requests/home/request_updates.dart`, `request_updates_card.dart`, `lib/requests/list/requests_controller.dart`, `lib/requests/ui/sync_chip.dart` | 7 | Shared list state, Home summary + card, state chips |
| `lib/requests/compose/compose_controller.dart`, `compose_screen.dart`, `item_editor_screen.dart` | 8 | New request + item editor |
| `lib/requests/detail/request_detail_screen.dart`, `lib/requests/list/requests_screen.dart` | 9 | One request; the Requests tab |
| `lib/attendance/home/home_screen.dart`, `lib/ui/home_shell.dart`, `lib/app.dart`, `lib/main.dart` | 10 | The tab, the Home card, startup wiring |
| `test/requests/**`, `test/ui/screens_test.dart` | 1–10 | Tests |
| `pubspec.yaml`, `Dacs Web/docs/...` | 11 | Version, release, device check, docs |

---

### Task 1: Request data shapes

**Files:**
- Create: `lib/requests/domain/quantity.dart`, `lib/requests/domain/request_models.dart`, `lib/requests/domain/remote_request.dart`
- Test: `test/requests/domain/request_models_test.dart`

**Interfaces:**
- Produces: `parseQuantity(String) → double?`, `formatQuantity(num) → String`, `maxQuantity`; `ItemKind {material, tool}` (`wire`, `label`, `parse`); `Destination(projectId, projectName, workId, workName, isMain)` (`fromRow`, `toRow`, `label`, equality by project+work); `TeamMember(id, name)`; `MyTeam(id, name, iLead, members)` (`fromRow`, `toRow`); `CatalogItem` (`static fromRow → CatalogItem?`, `toRow`, `label`); `RemoteRequest`, `RemoteLine`, `Portion`, `RemotePhoto` (`fromJson`). The test file also exports `requestDoc({id, status, mine, lines})` — a pr_my_requests document used by later tests.

- [ ] **Step 1: Write the failing test** — create `test/requests/domain/request_models_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/requests/domain/quantity.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_models.dart';

/// One pr_my_requests document, as the server sends it (0085 §10).
Map<String, dynamic> requestDoc({
  String id = 'r1',
  String status = 'submitted',
  bool mine = true,
  List<Map<String, dynamic>>? lines,
}) =>
    {
      'id': id,
      'status': status,
      'received_at': '2026-10-05T03:00:00+00:00',
      'drafted_at': '2026-10-05T01:00:00+00:00',
      'note': 'Back gate',
      'mine': mine,
      'requester_name': 'Juan dela Cruz',
      'project_id': 'f1',
      'project_name': 'Santos Townhouse',
      'work_id': 'f1',
      'work_name': 'Main Contract',
      'team_id': null,
      'team_name': null,
      'lines': lines ??
          [
            {
              'id': 'l1',
              'position': 0,
              'kind': 'material',
              'catalog_item_id': 'c1',
              'description': 'PVC pipe',
              'spec': '1/2 in',
              'unit': 'pc',
              'category': 'plumbing',
              'intended_member_id': null,
              'intended_member_name': null,
              'urgent': true,
              'urgent_reason': 'Leak',
              'needed_by': '2026-10-07',
              'notes': '',
              'status': 'open',
              'version': 2,
              'has_conflict': false,
              'needed': 12,
              'portions': [
                {
                  'quantity': 10,
                  'pending_reduction': 0,
                  'arranged': true,
                  'cutoff_at': '2026-10-10T04:00:00+00:00',
                  'purchase_on': '2026-10-12',
                  'delivery_on': '2026-10-14',
                },
                {
                  'quantity': 2.5,
                  'pending_reduction': 0.5,
                  'arranged': false,
                  'cutoff_at': '2026-10-17T04:00:00+00:00',
                  'purchase_on': '2026-10-19',
                  'delivery_on': '2026-10-21',
                },
              ],
            },
          ],
      'photos': [
        {'id': 'ph1', 'line_id': 'l1', 'path': 'u1/r1/ph1.jpg'},
      ],
    };

void main() {
  group('quantities', () {
    test('parseQuantity accepts exactly what the server accepts', () {
      expect(parseQuantity(' 12 '), 12);
      expect(parseQuantity('2.125'), 2.125);
      expect(parseQuantity('1000000'), 1000000);
      expect(parseQuantity('0'), isNull);
      expect(parseQuantity('-1'), isNull);
      expect(parseQuantity('1.2345'), isNull);
      expect(parseQuantity('1000001'), isNull);
      expect(parseQuantity('2.'), isNull);
      expect(parseQuantity('abc'), isNull);
      expect(parseQuantity(''), isNull);
    });

    test('formatQuantity drops trailing zeros and groups thousands', () {
      expect(formatQuantity(10), '10');
      expect(formatQuantity(2.5), '2.5');
      expect(formatQuantity(1.125), '1.125');
      expect(formatQuantity(100), '100');
      expect(formatQuantity(1000000), '1,000,000');
    });
  });

  group('choices', () {
    test('a destination reads both Main Contract and Additional Works rows', () {
      final main = Destination.fromRow({
        'project_id': 'f1',
        'project_name': 'Santos Townhouse',
        'work_id': 'f1',
        'work_name': 'Main Contract',
        'is_main': true,
      });
      final aw = Destination.fromRow({
        'project_id': 'f1',
        'project_name': 'Santos Townhouse',
        'work_id': 'f9',
        'work_name': 'AW-03 Fence',
        'is_main': false,
      });
      expect(main.isMain, isTrue);
      expect(aw.label, 'Santos Townhouse · AW-03 Fence');
      expect(Destination.fromRow(aw.toRow()), aw);
      expect(main == aw, isFalse);
    });

    test('a team carries whether I lead it and its members', () {
      final t = MyTeam.fromRow({
        'team_id': 't1',
        'team_name': 'Masonry A',
        'i_lead': true,
        'members': [
          {'id': 'u1', 'name': 'Juan'},
          {'id': 'u2', 'name': 'Pedro'},
        ],
      });
      expect(t.iLead, isTrue);
      expect(t.members.map((m) => m.name), ['Juan', 'Pedro']);
      expect(MyTeam.fromRow(t.toRow()).members.length, 2);
    });

    test('a catalogue item of an unknown kind is dropped, not guessed', () {
      final pipe = CatalogItem.fromRow({'id': 'c1', 'kind': 'material', 'name': 'PVC pipe', 'spec': '1/2 in', 'unit': 'pc', 'category': 'plumbing'});
      expect(pipe!.label, 'PVC pipe · 1/2 in (pc)');
      expect(CatalogItem.fromRow({'id': 'c2', 'kind': 'food', 'name': 'Rice', 'spec': '', 'unit': 'kg', 'category': ''}), isNull);
      expect(CatalogItem.fromRow(pipe.toRow())!.kind, ItemKind.material);
    });
  });

  group('a received request', () {
    test('parses every field the screens use', () {
      final r = RemoteRequest.fromJson(requestDoc());
      expect(r.title, 'Santos Townhouse · Main Contract');
      expect(r.mine, isTrue);
      expect(r.cancelled, isFalse);
      expect(r.receivedAt, DateTime.utc(2026, 10, 5, 3));
      final l = r.lines.single;
      expect(l.kind, ItemKind.material);
      expect(l.urgent, isTrue);
      expect(l.neededBy, '2026-10-07');
      expect(l.version, 2);
      expect(l.needed, 12);
      expect(l.portions.length, 2);
      expect(l.portions[1].quantity, 2.5);
      expect(l.portions[1].pendingReduction, 0.5);
      expect(l.portions[0].deliveryOn, '2026-10-14');
      expect(r.photos.single.path, 'u1/r1/ph1.jpg');
    });

    test('a cancelled request and a cancelled line read as cancelled', () {
      final doc = requestDoc(status: 'cancelled');
      (doc['lines'] as List).first['status'] = 'cancelled';
      final r = RemoteRequest.fromJson(doc);
      expect(r.cancelled, isTrue);
      expect(r.lines.single.cancelled, isTrue);
    });
  });
}
```

- [ ] **Step 2: Run it to verify it fails** — `flutter test test/requests/domain/request_models_test.dart` → compile errors (`Target of URI doesn't exist`).

- [ ] **Step 3: Write the code** — create the three files:

`lib/requests/domain/quantity.dart`:

```dart
/// Quantities exactly as the server takes them (0085 pr_submit_request and
/// pr_change_quantity): above 0, at most 1,000,000, at most 3 decimals.
const maxQuantity = 1000000;

/// The typed text as a quantity, or null when the server would refuse it.
double? parseQuantity(String text) {
  final t = text.trim();
  if (!RegExp(r'^\d+(\.\d{1,3})?$').hasMatch(t)) return null;
  final v = double.parse(t);
  return v > 0 && v <= maxQuantity ? v : null;
}

/// "10", "2.5", "1.125", "1,000,000": no trailing zeros, thousands grouped.
String formatQuantity(num value) {
  final fixed = value.toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
  final parts = fixed.split('.');
  final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return parts.length == 2 ? '$whole.${parts[1]}' : whole;
}
```

`lib/requests/domain/request_models.dart`:

```dart
/// What a worker chooses from when building a request (0085 pr_destinations,
/// pr_my_teams, pr_catalog). Names only — the server never sends contact
/// details or money to a worker.
library;

enum ItemKind {
  material('material', 'Material'),
  tool('tool', 'Tool');

  const ItemKind(this.wire, this.label);

  /// The value the server stores (pr_lines.kind).
  final String wire;
  final String label;

  static ItemKind? parse(String? value) => values.where((k) => k.wire == value).firstOrNull;
}

/// One place a request can be for: a Project Control project's Main Contract,
/// or one of its own open Additional Works jobs.
class Destination {
  const Destination({
    required this.projectId,
    required this.projectName,
    required this.workId,
    required this.workName,
    required this.isMain,
  });

  factory Destination.fromRow(Map<String, dynamic> row) => Destination(
        projectId: row['project_id'] as String,
        projectName: row['project_name'] as String,
        workId: row['work_id'] as String,
        workName: row['work_name'] as String,
        isMain: row['is_main'] == true,
      );

  final String projectId;
  final String projectName;
  final String workId;
  final String workName;
  final bool isMain;

  /// "Santos Townhouse · Main Contract".
  String get label => '$projectName · $workName';

  Map<String, dynamic> toRow() => {
        'project_id': projectId,
        'project_name': projectName,
        'work_id': workId,
        'work_name': workName,
        'is_main': isMain,
      };

  @override
  bool operator ==(Object other) => other is Destination && other.projectId == projectId && other.workId == workId;

  @override
  int get hashCode => Object.hash(projectId, workId);
}

class TeamMember {
  const TeamMember({required this.id, required this.name});

  factory TeamMember.fromRow(Map<String, dynamic> row) => TeamMember(id: row['id'] as String, name: row['name'] as String);

  final String id;
  final String name;

  Map<String, dynamic> toRow() => {'id': id, 'name': name};
}

/// A team the worker is a current member of. [iLead] is the server's answer
/// to "role teamLeader AND the current leader of THIS team" (spec §3).
class MyTeam {
  const MyTeam({required this.id, required this.name, required this.iLead, required this.members});

  factory MyTeam.fromRow(Map<String, dynamic> row) => MyTeam(
        id: row['team_id'] as String,
        name: row['team_name'] as String,
        iLead: row['i_lead'] == true,
        members: [
          for (final m in (row['members'] as List<dynamic>? ?? const []))
            TeamMember.fromRow(Map<String, dynamic>.from(m as Map)),
        ],
      );

  final String id;
  final String name;
  final bool iLead;
  final List<TeamMember> members;

  Map<String, dynamic> toRow() => {
        'team_id': id,
        'team_name': name,
        'i_lead': iLead,
        'members': [for (final m in members) m.toRow()],
      };
}

/// One defined item: name + spec + unit. A different size or unit is a
/// different item.
class CatalogItem {
  const CatalogItem({
    required this.id,
    required this.kind,
    required this.name,
    required this.spec,
    required this.unit,
    required this.category,
  });

  /// Null for a kind this build does not know: offering it would fail at send.
  static CatalogItem? fromRow(Map<String, dynamic> row) {
    final kind = ItemKind.parse(row['kind'] as String?);
    if (kind == null) return null;
    return CatalogItem(
      id: row['id'] as String,
      kind: kind,
      name: row['name'] as String,
      spec: (row['spec'] as String?) ?? '',
      unit: row['unit'] as String,
      category: (row['category'] as String?) ?? '',
    );
  }

  final String id;
  final ItemKind kind;
  final String name;
  final String spec;
  final String unit;
  final String category;

  /// "PVC pipe · 1/2 in (pc)".
  String get label => spec.isEmpty ? '$name ($unit)' : '$name · $spec ($unit)';

  Map<String, dynamic> toRow() => {
        'id': id,
        'kind': kind.wire,
        'name': name,
        'spec': spec,
        'unit': unit,
        'category': category,
      };
}
```

`lib/requests/domain/remote_request.dart`:

```dart
import 'request_models.dart';

/// A request as the server keeps it (0085 pr_my_requests). Quantities only —
/// no price, amount or cost exists in these tables.
double _num(Object? v) => (v as num?)?.toDouble() ?? 0;

/// One weekly-batch share of a line's quantity (spec §4A: 10 this week plus
/// 2 next week are two portions with their own dates).
class Portion {
  const Portion({
    required this.quantity,
    required this.pendingReduction,
    required this.arranged,
    required this.cutoffAt,
    required this.purchaseOn,
    required this.deliveryOn,
  });

  factory Portion.fromJson(Map<String, dynamic> j) => Portion(
        quantity: _num(j['quantity']),
        pendingReduction: _num(j['pending_reduction']),
        arranged: j['arranged'] == true,
        cutoffAt: DateTime.parse(j['cutoff_at'] as String),
        purchaseOn: j['purchase_on'] as String,
        deliveryOn: j['delivery_on'] as String,
      );

  final double quantity;

  /// Arranged quantity the worker no longer needs; the office resolves it.
  final double pendingReduction;

  /// The office has arranged this quantity for purchase.
  final bool arranged;
  final DateTime cutoffAt;

  /// Calendar dates ("2026-10-12"), never instants.
  final String purchaseOn;
  final String deliveryOn;
}

class RemoteLine {
  const RemoteLine({
    required this.id,
    required this.position,
    required this.kind,
    required this.description,
    required this.unit,
    required this.version,
    required this.needed,
    this.catalogItemId,
    this.spec = '',
    this.category = '',
    this.intendedMemberName,
    this.urgent = false,
    this.urgentReason,
    this.neededBy,
    this.notes = '',
    this.cancelled = false,
    this.hasConflict = false,
    this.portions = const [],
  });

  factory RemoteLine.fromJson(Map<String, dynamic> j) => RemoteLine(
        id: j['id'] as String,
        position: (j['position'] as num).toInt(),
        kind: ItemKind.parse(j['kind'] as String?) ?? ItemKind.material,
        catalogItemId: j['catalog_item_id'] as String?,
        description: j['description'] as String,
        spec: (j['spec'] as String?) ?? '',
        unit: j['unit'] as String,
        category: (j['category'] as String?) ?? '',
        intendedMemberName: j['intended_member_name'] as String?,
        urgent: j['urgent'] == true,
        urgentReason: j['urgent_reason'] as String?,
        neededBy: j['needed_by'] as String?,
        notes: (j['notes'] as String?) ?? '',
        cancelled: j['status'] == 'cancelled',
        version: (j['version'] as num).toInt(),
        hasConflict: j['has_conflict'] == true,
        needed: _num(j['needed']),
        portions: [
          for (final p in (j['portions'] as List<dynamic>? ?? const [])) Portion.fromJson(Map<String, dynamic>.from(p as Map)),
        ],
      );

  final String id;
  final int position;
  final ItemKind kind;
  final String? catalogItemId;
  final String description;
  final String spec;
  final String unit;
  final String category;
  final String? intendedMemberName;
  final bool urgent;
  final String? urgentReason;
  final String? neededBy;
  final String notes;
  final bool cancelled;

  /// Rises on every change; an edit made against an older version becomes a
  /// conflict for the office instead of an overwrite (spec §4E).
  final int version;
  final bool hasConflict;

  /// Still needed: Σ(quantity − pending reduction).
  final double needed;
  final List<Portion> portions;
}

class RemotePhoto {
  const RemotePhoto({required this.id, required this.path, this.lineId});

  factory RemotePhoto.fromJson(Map<String, dynamic> j) =>
      RemotePhoto(id: j['id'] as String, lineId: j['line_id'] as String?, path: j['path'] as String);

  final String id;
  final String? lineId;

  /// Inside the private request-photos bucket.
  final String path;
}

class RemoteRequest {
  const RemoteRequest({
    required this.id,
    required this.receivedAt,
    required this.mine,
    required this.requesterName,
    required this.projectId,
    required this.projectName,
    required this.workId,
    required this.workName,
    this.cancelled = false,
    this.draftedAt,
    this.note = '',
    this.teamId,
    this.teamName,
    this.lines = const [],
    this.photos = const [],
  });

  factory RemoteRequest.fromJson(Map<String, dynamic> j) => RemoteRequest(
        id: j['id'] as String,
        cancelled: j['status'] == 'cancelled',
        receivedAt: DateTime.parse(j['received_at'] as String),
        draftedAt: j['drafted_at'] == null ? null : DateTime.parse(j['drafted_at'] as String),
        note: (j['note'] as String?) ?? '',
        mine: j['mine'] == true,
        requesterName: (j['requester_name'] as String?) ?? '',
        projectId: j['project_id'] as String,
        projectName: (j['project_name'] as String?) ?? '',
        workId: j['work_id'] as String,
        workName: (j['work_name'] as String?) ?? '',
        teamId: j['team_id'] as String?,
        teamName: j['team_name'] as String?,
        lines: [for (final l in (j['lines'] as List<dynamic>? ?? const [])) RemoteLine.fromJson(Map<String, dynamic>.from(l as Map))],
        photos: [for (final p in (j['photos'] as List<dynamic>? ?? const [])) RemotePhoto.fromJson(Map<String, dynamic>.from(p as Map))],
      );

  final String id;
  final bool cancelled;
  final DateTime receivedAt;
  final DateTime? draftedAt;
  final String note;

  /// False for a team member's request a leader is shown (read-only to them).
  final bool mine;
  final String requesterName;
  final String projectId;
  final String projectName;
  final String workId;
  final String workName;
  final String? teamId;
  final String? teamName;
  final List<RemoteLine> lines;
  final List<RemotePhoto> photos;

  /// "Santos Townhouse · Main Contract".
  String get title => '$projectName · $workName';
}
```

- [ ] **Step 4: Run** — `flutter test test/requests/domain/request_models_test.dart` → all pass; `flutter analyze lib/requests` → "No issues found!".

- [ ] **Step 5: Stop — no commit.**

---

### Task 2: Draft rules, status, failures, edit chaining, wording

**Files:**
- Create: `lib/requests/domain/request_draft.dart`, `lib/requests/domain/request_status.dart`, `lib/requests/domain/request_failure.dart`, `lib/requests/domain/request_op.dart`, `lib/requests/ui/requests_copy.dart`
- Test: `test/requests/domain/request_rules_test.dart`

**Interfaces:**
- Consumes: Task 1; `Bilingual`, `failureCopy` (`lib/attendance/ui/attendance_copy.dart`), `AttendanceFailure`, `WorkDate`.
- Produces: `DraftLine` (`fromCatalog`, `copyWith` — nullable fields cleared by passing `null`), `RequestDraft` (`copyWith`, `toJson`/`fromJson`), `DraftIssue(kind, [line])`, `DraftIssueKind`, `draftIssues(RequestDraft) → List<DraftIssue>`, `submitPayload(RequestDraft) → Map` (exact `p_request`), `maxLines = 100`; `SyncState {draft, pending, received, failed, needsResolution}`, `LineProgress`, `lineProgress`, `remoteState(r, pending:, failed:)`, `requestClosed`, `canChangeLine`, `canCancelRequest`, `calendarDay('2026-10-14') → 'Wed 14 Oct'`, `nextDelivery(requests, now) → String?`; `RequestFailure` (`of(error)`, `fromStored(name)`, `retryable`), `maxUnexpectedAttempts = 10`; `OpKind {submit, photo, quantity, cancelLine, cancelRequest}`, `RequestOp` (`toMap`/`fromMap`, `quantity`, `localPath`, `photoId`), `predictedBase(seen, queued, lineId)`, `rebaseAfter(later, lineId, result) → Map<opId, base>`; copy: `syncLabel`, `lineProgressLabel`, `draftIssueText`, `requestFailureCopy`, `notAcceptedLead`, `noDestinationsCopy`, `backToDraftsLabel`.

The version-chaining rule (1a-1 carry-over), in words: a new edit's base = the version the worker saw **plus** the edits of that line still waiting on the phone. When an edit is answered *applied*, the next waiting edit of that line takes the server's new version; when it is answered *conflict*, every later waiting edit of that line gets base **0** (versions start at 1, so it also arrives as a conflict — the office sees every value the worker typed).

- [ ] **Step 1: Write the failing test** — create `test/requests/domain/request_rules_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_failure.dart';
import 'package:workmate/requests/domain/request_models.dart';
import 'package:workmate/requests/domain/request_op.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/requests/ui/requests_copy.dart';

import 'request_models_test.dart' show requestDoc;

const site = Destination(projectId: 'f1', projectName: 'Santos Townhouse', workId: 'f1', workName: 'Main Contract', isMain: true);
const pipe = CatalogItem(id: 'c1', kind: ItemKind.material, name: 'PVC pipe', spec: '1/2 in', unit: 'pc', category: 'plumbing');

RequestDraft draft({List<DraftLine>? lines, String? teamId}) => RequestDraft(
      id: 'd1',
      createdAt: DateTime.utc(2026, 10, 5, 1),
      destination: site,
      teamId: teamId,
      lines: lines ?? [DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '10')],
    );

RemoteLine line({bool conflict = false, bool cancelled = false, List<Portion>? portions}) => RemoteLine(
      id: 'l1',
      position: 0,
      kind: ItemKind.material,
      description: 'PVC pipe',
      unit: 'pc',
      version: 1,
      needed: 10,
      hasConflict: conflict,
      cancelled: cancelled,
      portions: portions ?? [portion()],
    );

Portion portion({bool arranged = false, double pending = 0, String delivery = '2026-10-14'}) => Portion(
      quantity: 10,
      pendingReduction: pending,
      arranged: arranged,
      cutoffAt: DateTime.utc(2026, 10, 10, 4),
      purchaseOn: '2026-10-12',
      deliveryOn: delivery,
    );

RequestOp op(String id, OpKind kind, {String? lineId, int? base, bool failed = false}) => RequestOp(
      opId: id,
      workerId: 'u1',
      kind: kind,
      createdAt: DateTime.utc(2026),
      lineId: lineId,
      baseVersion: base,
      failedPermanently: failed,
    );

void main() {
  group('drafts', () {
    test('a complete draft has no issues and survives a round trip', () {
      final d = draft();
      expect(draftIssues(d), isEmpty);
      final back = RequestDraft.fromJson(d.toJson());
      expect(back.destination, site);
      expect(back.lines.single.catalogItemId, 'c1');
      expect(back.lines.single.quantity, '10');
      expect(back.createdAt, d.createdAt);
    });

    test('every server refusal is caught before sending', () {
      final d = RequestDraft(id: 'd1', createdAt: DateTime.utc(2026), lines: [
        const DraftLine(id: 'a', quantity: '0', urgent: true, memberId: 'u2'),
      ]);
      expect(draftIssues(d), [
        const DraftIssue(DraftIssueKind.noDestination),
        const DraftIssue(DraftIssueKind.noDescription, 0),
        const DraftIssue(DraftIssueKind.noUnit, 0),
        const DraftIssue(DraftIssueKind.badQuantity, 0),
        const DraftIssue(DraftIssueKind.urgentNeedsReason, 0),
        const DraftIssue(DraftIssueKind.urgentNeedsDate, 0),
        const DraftIssue(DraftIssueKind.memberNeedsTeam, 0),
      ]);
      expect(draftIssues(RequestDraft(id: 'd2', createdAt: DateTime.utc(2026), destination: site)),
          [const DraftIssue(DraftIssueKind.noLines)]);
      final many = draft(lines: [for (var i = 0; i < 101; i++) DraftLine.fromCatalog('x$i', pipe).copyWith(quantity: '1')]);
      expect(draftIssues(many), [const DraftIssue(DraftIssueKind.tooManyLines)]);
    });

    test('the payload is exactly pr_submit_request\'s', () {
      final d = draft(teamId: 't1', lines: [
        DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '10', memberId: 'u2', memberName: 'Pedro', urgent: true, urgentReason: ' Leak ', neededBy: '2026-10-07'),
        const DraftLine(id: 'x2', kind: ItemKind.tool, description: 'Drill', unit: 'pc', quantity: '1', memberId: 'u2', notes: 'cordless'),
      ]);
      final p = submitPayload(d);
      expect(p['folder_id'], 'f1');
      expect(p['work_id'], 'f1');
      expect(p['team_id'], 't1');
      expect(p['drafted_at'], '2026-10-05T01:00:00.000Z');
      final lines = p['lines'] as List;
      expect(lines[0], {
        'kind': 'material',
        'catalog_item_id': 'c1',
        'description': 'PVC pipe',
        'spec': '1/2 in',
        'unit': 'pc',
        'category': 'plumbing',
        'quantity': 10.0,
        'intended_member_id': 'u2',
        'urgent': true,
        'urgent_reason': 'Leak',
        'needed_by': '2026-10-07',
        'notes': '',
      });
      // A tool carries no intended member (spec §4A) and no catalogue id when unlisted.
      expect((lines[1] as Map).containsKey('intended_member_id'), isFalse);
      expect((lines[1] as Map).containsKey('catalog_item_id'), isFalse);
      expect(submitPayload(draft()).containsKey('team_id'), isFalse);
    });

    test('copyWith can clear what may be cleared', () {
      final l = DraftLine.fromCatalog('x1', pipe).copyWith(memberId: 'u2', neededBy: '2026-10-07');
      final cleared = l.copyWith(catalogItemId: null, memberId: null, neededBy: null);
      expect(cleared.catalogItemId, isNull);
      expect(cleared.memberId, isNull);
      expect(cleared.neededBy, isNull);
      expect(cleared.description, 'PVC pipe');
    });
  });

  group('status', () {
    test('a line reads its most pressing state first', () {
      expect(lineProgress(line(conflict: true)), LineProgress.needsResolution);
      expect(lineProgress(line(cancelled: true, portions: [portion(arranged: true, pending: 10)])), LineProgress.officeChecking);
      expect(lineProgress(line(cancelled: true, portions: [])), LineProgress.cancelled);
      expect(lineProgress(line()), LineProgress.waiting);
      expect(lineProgress(line(portions: [portion(arranged: true), portion()])), LineProgress.partlyArranged);
      expect(lineProgress(line(portions: [portion(arranged: true)])), LineProgress.arranged);
    });

    test('unsent or refused outranks what the server says', () {
      final r = RemoteRequest.fromJson(requestDoc());
      expect(remoteState(r, pending: false, failed: false), SyncState.received);
      expect(remoteState(r, pending: true, failed: false), SyncState.pending);
      expect(remoteState(r, pending: true, failed: true), SyncState.failed);
      final doc = requestDoc();
      (doc['lines'] as List).first['has_conflict'] = true;
      expect(remoteState(RemoteRequest.fromJson(doc), pending: false, failed: false), SyncState.needsResolution);
    });

    test('only the requester changes a request', () {
      final mine = RemoteRequest.fromJson(requestDoc());
      final team = RemoteRequest.fromJson(requestDoc(mine: false));
      expect(canChangeLine(mine, mine.lines.single), isTrue);
      expect(canChangeLine(team, team.lines.single), isFalse);
      expect(canCancelRequest(mine), isTrue);
      expect(canCancelRequest(team), isFalse);
      final cancelled = RemoteRequest.fromJson(requestDoc(status: 'cancelled'));
      expect(canCancelRequest(cancelled), isFalse);
      expect(requestClosed(cancelled), isTrue);
    });

    test('calendar dates are read as dates, never shifted', () {
      expect(calendarDay('2026-10-14'), 'Wed 14 Oct');
      expect(calendarDay('2026-10-12'), 'Mon 12 Oct');
      expect(calendarDay('nonsense'), 'nonsense');
    });

    test('the next delivery is the earliest one not yet past (Manila today)', () {
      final r = RemoteRequest.fromJson(requestDoc());
      // 2026-10-14 00:30 Manila = 2026-10-13 16:30 UTC: the 14 Oct delivery is today.
      expect(nextDelivery([r], DateTime.utc(2026, 10, 13, 16, 30)), '2026-10-14');
      expect(nextDelivery([r], DateTime.utc(2026, 10, 15)), '2026-10-21');
      expect(nextDelivery([r], DateTime.utc(2026, 11, 1)), isNull);
      expect(nextDelivery([RemoteRequest.fromJson(requestDoc(status: 'cancelled'))], DateTime.utc(2026, 10, 1)), isNull);
    });
  });

  group('failures', () {
    test('server codes map to failures and decide retrying', () {
      expect(RequestFailure.of(Exception('DESTINATION_CLOSED')), RequestFailure.destinationClosed);
      expect(RequestFailure.of(Exception('NOT_IN_TEAM')), RequestFailure.notInTeam);
      expect(RequestFailure.of(Exception('NOT_TEAM_LEADER')), RequestFailure.notTeamLeader);
      expect(RequestFailure.of(Exception('TOO_MANY_LINES')), RequestFailure.incomplete);
      expect(RequestFailure.of(Exception('NOT_YOUR_REQUEST')), RequestFailure.notYours);
      expect(RequestFailure.of(const SocketException('down')), RequestFailure.noConnection);
      expect(RequestFailure.of(StateError('AUTH_REQUIRED')), RequestFailure.sessionExpired);
      expect(RequestFailure.of(Exception('boom')), RequestFailure.unexpected);
      expect(RequestFailure.destinationClosed.retryable, isFalse);
      expect(RequestFailure.noConnection.retryable, isTrue);
      expect(RequestFailure.photoNotUploaded.retryable, isTrue);
      expect(RequestFailure.fromStored('lineClosed'), RequestFailure.lineClosed);
      expect(RequestFailure.fromStored('PHOTO_MISSING'), RequestFailure.unexpected);
    });

    test('every failure and every draft issue has words', () {
      for (final f in RequestFailure.values) {
        final c = requestFailureCopy(f);
        expect(c.english, isNotEmpty);
        expect(c.tagalog, isNotEmpty);
      }
      for (final k in DraftIssueKind.values) {
        expect(draftIssueText(k), isNotEmpty);
      }
      for (final s in SyncState.values) {
        expect(syncLabel(s), isNotEmpty);
      }
    });
  });

  group('queued edits of one line', () {
    test('a new edit sits on top of the edits still waiting', () {
      final queue = [op('a', OpKind.quantity, lineId: 'l1'), op('b', OpKind.cancelLine, lineId: 'l2'), op('c', OpKind.quantity, lineId: 'l1', failed: true)];
      expect(predictedBase(3, queue, 'l1'), 4);
      expect(predictedBase(3, queue, 'l2'), 4);
      expect(predictedBase(3, queue, 'l9'), 3);
    });

    test('an applied edit hands its version to the next edit only', () {
      final later = [op('b', OpKind.quantity, lineId: 'l1', base: 5), op('c', OpKind.photo), op('d', OpKind.quantity, lineId: 'l1', base: 6)];
      expect(rebaseAfter(later, 'l1', {'status': 'applied', 'version': 7}), {'b': 7});
      expect(rebaseAfter(later, 'l2', {'status': 'applied', 'version': 7}), isEmpty);
      expect(rebaseAfter(const [], 'l1', {'status': 'applied', 'version': 7}), isEmpty);
    });

    test('after a conflict every later edit of that line must conflict too', () {
      final later = [op('b', OpKind.quantity, lineId: 'l1', base: 5), op('d', OpKind.quantity, lineId: 'l1', base: 6)];
      expect(rebaseAfter(later, 'l1', {'status': 'conflict', 'version': 9}), {'b': 0, 'd': 0});
    });

    test('an op survives the database round trip', () {
      final o = RequestOp(
        opId: 'o1',
        workerId: 'u1',
        kind: OpKind.photo,
        createdAt: DateTime.utc(2026, 10, 5),
        draftId: 'd1',
        linePosition: 2,
        body: const {'local_path': '/p/x.jpg', 'photo_id': 'ph1'},
      );
      final back = RequestOp.fromMap(o.toMap());
      expect(back.kind, OpKind.photo);
      expect(back.localPath, '/p/x.jpg');
      expect(back.photoId, 'ph1');
      expect(back.linePosition, 2);
      expect(back.createdAt, o.createdAt);
    });
  });
}
```

- [ ] **Step 2: Run it to verify it fails** — `flutter test test/requests/domain/request_rules_test.dart` → compile errors.

- [ ] **Step 3: Write the code.**

`lib/requests/domain/request_draft.dart`:

```dart
import 'quantity.dart';
import 'request_models.dart';

const _keep = Object();

/// One item on a request being prepared on the phone. Quantity stays the
/// text the worker typed until sending, so a half-typed "2." is not lost.
class DraftLine {
  const DraftLine({
    required this.id,
    this.kind = ItemKind.material,
    this.catalogItemId,
    this.description = '',
    this.spec = '',
    this.unit = '',
    this.category = '',
    this.quantity = '',
    this.memberId,
    this.memberName,
    this.urgent = false,
    this.urgentReason = '',
    this.neededBy,
    this.notes = '',
    this.photos = const [],
  });

  /// A line copied from an official catalogue item (spec §4A).
  factory DraftLine.fromCatalog(String id, CatalogItem item) => DraftLine(
        id: id,
        kind: item.kind,
        catalogItemId: item.id,
        description: item.name,
        spec: item.spec,
        unit: item.unit,
        category: item.category,
      );

  factory DraftLine.fromJson(Map<String, dynamic> j) => DraftLine(
        id: j['id'] as String,
        kind: ItemKind.parse(j['kind'] as String?) ?? ItemKind.material,
        catalogItemId: j['catalog_item_id'] as String?,
        description: (j['description'] as String?) ?? '',
        spec: (j['spec'] as String?) ?? '',
        unit: (j['unit'] as String?) ?? '',
        category: (j['category'] as String?) ?? '',
        quantity: (j['quantity'] as String?) ?? '',
        memberId: j['member_id'] as String?,
        memberName: j['member_name'] as String?,
        urgent: j['urgent'] == true,
        urgentReason: (j['urgent_reason'] as String?) ?? '',
        neededBy: j['needed_by'] as String?,
        notes: (j['notes'] as String?) ?? '',
        photos: [for (final p in (j['photos'] as List<dynamic>? ?? const [])) p as String],
      );

  final String id;
  final ItemKind kind;

  /// Set when picked from the catalogue; null for an unlisted item the office
  /// matches later.
  final String? catalogItemId;
  final String description;
  final String spec;
  final String unit;
  final String category;
  final String quantity;

  /// The member a material is for (team requests; a leader may name anyone).
  final String? memberId;
  final String? memberName;
  final bool urgent;
  final String urgentReason;

  /// "2026-10-08" — a calendar date.
  final String? neededBy;
  final String notes;

  /// Prepared JPEGs in app-private storage, sent after the request lands.
  final List<String> photos;

  bool get fromCatalog => catalogItemId != null;

  DraftLine copyWith({
    ItemKind? kind,
    Object? catalogItemId = _keep,
    String? description,
    String? spec,
    String? unit,
    String? category,
    String? quantity,
    Object? memberId = _keep,
    Object? memberName = _keep,
    bool? urgent,
    String? urgentReason,
    Object? neededBy = _keep,
    String? notes,
    List<String>? photos,
  }) =>
      DraftLine(
        id: id,
        kind: kind ?? this.kind,
        catalogItemId: identical(catalogItemId, _keep) ? this.catalogItemId : catalogItemId as String?,
        description: description ?? this.description,
        spec: spec ?? this.spec,
        unit: unit ?? this.unit,
        category: category ?? this.category,
        quantity: quantity ?? this.quantity,
        memberId: identical(memberId, _keep) ? this.memberId : memberId as String?,
        memberName: identical(memberName, _keep) ? this.memberName : memberName as String?,
        urgent: urgent ?? this.urgent,
        urgentReason: urgentReason ?? this.urgentReason,
        neededBy: identical(neededBy, _keep) ? this.neededBy : neededBy as String?,
        notes: notes ?? this.notes,
        photos: photos ?? this.photos,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind.wire,
        'catalog_item_id': catalogItemId,
        'description': description,
        'spec': spec,
        'unit': unit,
        'category': category,
        'quantity': quantity,
        'member_id': memberId,
        'member_name': memberName,
        'urgent': urgent,
        'urgent_reason': urgentReason,
        'needed_by': neededBy,
        'notes': notes,
        'photos': photos,
      };
}

/// A request being prepared on the phone (spec §4E: works with no signal).
class RequestDraft {
  const RequestDraft({
    required this.id,
    required this.createdAt,
    this.destination,
    this.teamId,
    this.teamName,
    this.note = '',
    this.lines = const [],
  });

  factory RequestDraft.fromJson(Map<String, dynamic> j) => RequestDraft(
        id: j['id'] as String,
        createdAt: DateTime.parse(j['created_at'] as String),
        destination: j['destination'] == null ? null : Destination.fromRow(Map<String, dynamic>.from(j['destination'] as Map)),
        teamId: j['team_id'] as String?,
        teamName: j['team_name'] as String?,
        note: (j['note'] as String?) ?? '',
        lines: [for (final l in (j['lines'] as List<dynamic>? ?? const [])) DraftLine.fromJson(Map<String, dynamic>.from(l as Map))],
      );

  final String id;

  /// When the worker started it: sent as drafted_at, information only — the
  /// SERVER's received time decides the weekly batch (spec §4A).
  final DateTime createdAt;
  final Destination? destination;

  /// Null = an individual request (spec §7: no team needed).
  final String? teamId;
  final String? teamName;
  final String note;
  final List<DraftLine> lines;

  RequestDraft copyWith({
    Object? destination = _keep,
    Object? teamId = _keep,
    Object? teamName = _keep,
    String? note,
    List<DraftLine>? lines,
  }) =>
      RequestDraft(
        id: id,
        createdAt: createdAt,
        destination: identical(destination, _keep) ? this.destination : destination as Destination?,
        teamId: identical(teamId, _keep) ? this.teamId : teamId as String?,
        teamName: identical(teamName, _keep) ? this.teamName : teamName as String?,
        note: note ?? this.note,
        lines: lines ?? this.lines,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'created_at': createdAt.toUtc().toIso8601String(),
        'destination': destination?.toRow(),
        'team_id': teamId,
        'team_name': teamName,
        'note': note,
        'lines': [for (final l in lines) l.toJson()],
      };
}

/// The server refuses more than this many lines (0085 TOO_MANY_LINES).
const maxLines = 100;

enum DraftIssueKind {
  noDestination,
  noLines,
  tooManyLines,
  noDescription,
  noUnit,
  badQuantity,
  urgentNeedsReason,
  urgentNeedsDate,
  memberNeedsTeam,
}

/// Something to fix before sending; [line] is the item's index, or null.
class DraftIssue {
  const DraftIssue(this.kind, [this.line]);
  final DraftIssueKind kind;
  final int? line;

  @override
  bool operator ==(Object other) => other is DraftIssue && other.kind == kind && other.line == line;

  @override
  int get hashCode => Object.hash(kind, line);

  @override
  String toString() => line == null ? kind.name : '${kind.name}@$line';
}

/// Every rule the server would refuse the draft on, checked before it is
/// queued: a refusal after the worker left the site costs a second trip.
List<DraftIssue> draftIssues(RequestDraft d) {
  final out = <DraftIssue>[];
  if (d.destination == null) out.add(const DraftIssue(DraftIssueKind.noDestination));
  if (d.lines.isEmpty) out.add(const DraftIssue(DraftIssueKind.noLines));
  if (d.lines.length > maxLines) out.add(const DraftIssue(DraftIssueKind.tooManyLines));
  for (var i = 0; i < d.lines.length; i++) {
    final l = d.lines[i];
    if (l.description.trim().isEmpty) out.add(DraftIssue(DraftIssueKind.noDescription, i));
    if (l.unit.trim().isEmpty) out.add(DraftIssue(DraftIssueKind.noUnit, i));
    if (parseQuantity(l.quantity) == null) out.add(DraftIssue(DraftIssueKind.badQuantity, i));
    if (l.urgent && l.urgentReason.trim().isEmpty) out.add(DraftIssue(DraftIssueKind.urgentNeedsReason, i));
    if (l.urgent && l.neededBy == null) out.add(DraftIssue(DraftIssueKind.urgentNeedsDate, i));
    if (l.memberId != null && d.teamId == null) out.add(DraftIssue(DraftIssueKind.memberNeedsTeam, i));
  }
  return out;
}

/// The p_request argument of pr_submit_request (0085), exactly. Call only
/// when [draftIssues] is empty. An intended member travels on materials only:
/// a tool's responsible person is named at issue (spec §4A).
Map<String, dynamic> submitPayload(RequestDraft d) => {
      'folder_id': d.destination!.projectId,
      'work_id': d.destination!.workId,
      if (d.teamId != null) 'team_id': d.teamId,
      'note': d.note.trim(),
      'drafted_at': d.createdAt.toUtc().toIso8601String(),
      'lines': [
        for (final l in d.lines)
          {
            'kind': l.kind.wire,
            if (l.catalogItemId != null) 'catalog_item_id': l.catalogItemId,
            'description': l.description.trim(),
            'spec': l.spec.trim(),
            'unit': l.unit.trim(),
            'category': l.category.trim(),
            'quantity': parseQuantity(l.quantity),
            if (l.kind == ItemKind.material && l.memberId != null) 'intended_member_id': l.memberId,
            'urgent': l.urgent,
            if (l.urgent) 'urgent_reason': l.urgentReason.trim(),
            if (l.urgent) 'needed_by': l.neededBy,
            'notes': l.notes.trim(),
          },
      ],
    };
```

`lib/requests/domain/request_status.dart`:

```dart
import '../../attendance/domain/work_date.dart';
import 'remote_request.dart';

/// Where a request stands for the worker (spec §4E): every state is shown,
/// so nobody believes an unsent request reached the office.
enum SyncState { draft, pending, received, failed, needsResolution }

/// One line's progress, most urgent first.
enum LineProgress { needsResolution, officeChecking, cancelled, waiting, partlyArranged, arranged }

LineProgress lineProgress(RemoteLine l) {
  if (l.hasConflict) return LineProgress.needsResolution;
  // A reduction of arranged quantity waits on the office even on a cancelled
  // line: that order may already be placed.
  if (l.portions.any((p) => p.pendingReduction > 0)) return LineProgress.officeChecking;
  if (l.cancelled) return LineProgress.cancelled;
  final arranged = l.portions.where((p) => p.arranged).length;
  if (arranged == 0) return LineProgress.waiting;
  return arranged == l.portions.length ? LineProgress.arranged : LineProgress.partlyArranged;
}

/// A received request's state. Something not yet sent, or refused, outranks
/// what the server says.
SyncState remoteState(RemoteRequest r, {required bool pending, required bool failed}) {
  if (failed) return SyncState.failed;
  if (pending) return SyncState.pending;
  if (r.lines.any((l) => l.hasConflict)) return SyncState.needsResolution;
  return SyncState.received;
}

/// Nothing left open: cancelled whole, or every line cancelled.
bool requestClosed(RemoteRequest r) => r.cancelled || r.lines.every((l) => l.cancelled);

/// Only the requester changes a request (0085 NOT_YOUR_LINE): a leader reads
/// their team's requests but edits only their own.
bool canChangeLine(RemoteRequest r, RemoteLine l) => r.mine && !r.cancelled && !l.cancelled;

bool canCancelRequest(RemoteRequest r) => r.mine && !requestClosed(r);

const _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Wed 14 Oct" for a calendar date ("2026-10-14"), read as it is — a date
/// has no time zone to shift through.
String calendarDay(String iso) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(iso);
  if (m == null) return iso;
  final d = DateTime.utc(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
  return '${_days[d.weekday - 1]} ${d.day} ${_months[d.month - 1]}';
}

/// The earliest delivery still ahead (Manila today or later) on anything open,
/// or null.
String? nextDelivery(Iterable<RemoteRequest> requests, DateTime now) {
  final today = WorkDate.of(now).iso;
  String? best;
  for (final r in requests) {
    if (r.cancelled) continue;
    for (final l in r.lines) {
      if (l.cancelled) continue;
      for (final p in l.portions) {
        if (p.deliveryOn.compareTo(today) < 0) continue;
        if (best == null || p.deliveryOn.compareTo(best) < 0) best = p.deliveryOn;
      }
    }
  }
  return best;
}
```

`lib/requests/domain/request_failure.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart' show AuthRetryableFetchException;

/// Every way a request operation can be refused. The 0085 RPCs raise stable
/// codes; anything else is [unexpected], never a guess.
enum RequestFailure {
  destinationClosed,
  notInTeam,
  notTeamLeader,
  badMember,
  badCatalogItem,
  incomplete,
  badQuantity,
  urgentNeedsReason,
  lineClosed,
  notYours,
  notARequester,
  photoNotUploaded,
  appUpdateRequired,
  sessionExpired,
  noConnection,
  unexpected;

  // No code is a substring of another, so the first match is the only match.
  static const _byCode = <String, RequestFailure>{
    'DESTINATION_CLOSED': destinationClosed,
    'NOT_IN_TEAM': notInTeam,
    'NOT_TEAM_LEADER': notTeamLeader,
    'BAD_MEMBER': badMember,
    'BAD_CATALOG_ITEM': badCatalogItem,
    'BAD_LINE': incomplete,
    'NO_LINES': incomplete,
    'TOO_MANY_LINES': incomplete,
    'BAD_QUANTITY': badQuantity,
    'URGENT_NEEDS_REASON': urgentNeedsReason,
    'LINE_CLOSED': lineClosed,
    'NOT_YOUR_LINE': notYours,
    'NOT_YOUR_REQUEST': notYours,
    'NOT_A_REQUESTER': notARequester,
    'PHOTO_NOT_UPLOADED': photoNotUploaded,
    'APP_UPDATE_REQUIRED': appUpdateRequired,
    'AUTH_REQUIRED': sessionExpired,
  };

  static RequestFailure of(Object error) {
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

  /// A stored failure name back to the failure ('PHOTO_MISSING' and other
  /// local codes read as [unexpected]).
  static RequestFailure fromStored(String? name) => values.where((f) => f.name == name).firstOrNull ?? unexpected;

  /// Worth sending again later: the connection, the session or the moment —
  /// never the request's own content, which would be refused again.
  bool get retryable => switch (this) {
        noConnection || sessionExpired || appUpdateRequired || photoNotUploaded || unexpected => true,
        _ => false,
      };
}

/// An [RequestFailure.unexpected] answer this many times in a row is treated
/// as permanent, so one bad operation cannot block the queue forever.
const maxUnexpectedAttempts = 10;
```

`lib/requests/domain/request_op.dart`:

```dart
import 'dart:convert';

/// One change waiting to reach the server (spec §4E: "send each operation
/// once"). [opId] is minted once, at enqueue, and reused on every retry; the
/// 0085 RPCs answer a repeated op id with their first answer.
enum OpKind {
  submit,
  photo,
  quantity,
  cancelLine,
  cancelRequest;

  static OpKind parse(String value) => values.byName(value);
}

class RequestOp {
  const RequestOp({
    required this.opId,
    required this.workerId,
    required this.kind,
    required this.createdAt,
    this.draftId,
    this.requestId,
    this.lineId,
    this.linePosition,
    this.body = const {},
    this.baseVersion,
    this.seq = 0,
    this.attempts = 0,
    this.lastError,
    this.failedPermanently = false,
  });

  factory RequestOp.fromMap(Map<String, Object?> m) => RequestOp(
        opId: m['op_id']! as String,
        workerId: m['worker_id']! as String,
        kind: OpKind.parse(m['kind']! as String),
        createdAt: DateTime.fromMillisecondsSinceEpoch(m['created_at']! as int, isUtc: true),
        draftId: m['draft_id'] as String?,
        requestId: m['request_id'] as String?,
        lineId: m['line_id'] as String?,
        linePosition: m['line_position'] as int?,
        body: Map<String, dynamic>.from(jsonDecode(m['body']! as String) as Map),
        baseVersion: m['base_version'] as int?,
        seq: (m['seq'] as int?) ?? 0,
        attempts: (m['attempts'] as int?) ?? 0,
        lastError: m['last_error'] as String?,
        failedPermanently: m['failed_permanently'] == 1,
      );

  final String opId;

  /// Who queued it. Every read and every send is scoped to ONE worker: site
  /// phones are shared (spec §4E).
  final String workerId;
  final OpKind kind;
  final DateTime createdAt;

  /// The draft a submit (and its photos) came from.
  final String? draftId;

  /// The server's request; set on a photo op once its submit has landed.
  final String? requestId;
  final String? lineId;

  /// A photo's item index in its draft, resolved to [lineId] at landing.
  final int? linePosition;

  /// submit: the pr_submit_request payload; photo: local_path + photo_id;
  /// quantity: quantity.
  final Map<String, dynamic> body;

  /// quantity: the line version this edit was made against.
  final int? baseVersion;

  /// Queue order (insertion order).
  final int seq;
  final int attempts;
  final String? lastError;
  final bool failedPermanently;

  double? get quantity => (body['quantity'] as num?)?.toDouble();
  String? get localPath => body['local_path'] as String?;
  String? get photoId => body['photo_id'] as String?;

  Map<String, Object?> toMap() => {
        'op_id': opId,
        'worker_id': workerId,
        'kind': kind.name,
        'created_at': createdAt.millisecondsSinceEpoch,
        'draft_id': draftId,
        'request_id': requestId,
        'line_id': lineId,
        'line_position': linePosition,
        'body': jsonEncode(body),
        'base_version': baseVersion,
        'seq': seq,
        'attempts': attempts,
        'last_error': lastError,
        'failed_permanently': failedPermanently ? 1 : 0,
      };
}

bool _bumpsVersion(RequestOp o) => o.kind == OpKind.quantity || o.kind == OpKind.cancelLine;

/// The base version for a new edit of [lineId]: the version the worker saw,
/// plus every edit of that line still waiting to be sent — the worker made
/// this edit on top of those (the 1a-1 carry-over: chain queued edits).
int predictedBase(int seenVersion, Iterable<RequestOp> queued, String lineId) =>
    seenVersion + queued.where((o) => !o.failedPermanently && o.lineId == lineId && _bumpsVersion(o)).length;

/// After an edit of [lineId] answered: the base the next waiting edit of that
/// line must carry, by op id. Applied → the next edit sits on the server's new
/// version. Conflict → every later edit was made on a value the office never
/// saw, so each must also arrive as a conflict (base 0 never matches: versions
/// start at 1). [later] is the queue after the answered op, in order.
Map<String, int> rebaseAfter(List<RequestOp> later, String lineId, Map<String, dynamic> result) {
  final edits = later.where((o) => o.kind == OpKind.quantity && o.lineId == lineId && !o.failedPermanently).toList();
  if (edits.isEmpty) return const {};
  if (result['status'] == 'conflict') return {for (final o in edits) o.opId: 0};
  final version = (result['version'] as num?)?.toInt();
  if (version == null) return const {};
  return {edits.first.opId: version};
}
```

`lib/requests/ui/requests_copy.dart`:

```dart
import '../../attendance/domain/attendance_failure.dart';
import '../../attendance/ui/attendance_copy.dart';
import '../domain/request_draft.dart';
import '../domain/request_failure.dart';
import '../domain/request_status.dart';

// Screen copy is English; FAILURE copy is bilingual (English, then Tagalog),
// the same rule as Attendance. Where Attendance already has the words, they
// are reused so a worker reads one voice. Everything else here is NEW.

String syncLabel(SyncState s) => switch (s) {
      SyncState.draft => 'Draft',
      SyncState.pending => 'Pending sync',
      SyncState.received => 'Received',
      SyncState.failed => 'Failed',
      SyncState.needsResolution => 'Needs resolution',
    };

String lineProgressLabel(LineProgress p) => switch (p) {
      LineProgress.needsResolution => 'Needs resolution',
      LineProgress.officeChecking => 'Office is checking a change',
      LineProgress.cancelled => 'Cancelled',
      LineProgress.waiting => 'Waiting for the office',
      LineProgress.partlyArranged => 'Partly arranged',
      LineProgress.arranged => 'Arranged for purchase',
    };

/// What to do about each draft problem, next to the field.
String draftIssueText(DraftIssueKind k) => switch (k) {
      DraftIssueKind.noDestination => 'Choose the project and the work.',
      DraftIssueKind.noLines => 'Add at least one item.',
      DraftIssueKind.tooManyLines => 'Split this into two requests (100 items at most).',
      DraftIssueKind.noDescription => 'Name the item.',
      DraftIssueKind.noUnit => 'Add the unit (pc, bag, m…).',
      DraftIssueKind.badQuantity => 'Enter a quantity above 0 (up to 3 decimals).',
      DraftIssueKind.urgentNeedsReason => 'Say why it is urgent.',
      DraftIssueKind.urgentNeedsDate => 'Pick the date it is needed by.',
      DraftIssueKind.memberNeedsTeam => 'Choose the team first.',
    };

Bilingual requestFailureCopy(RequestFailure f) => switch (f) {
      RequestFailure.destinationClosed => const Bilingual(
          'That project or job no longer accepts requests. Choose another, then send again.',
          'Hindi na tumatanggap ng request ang project o trabahong iyon. Pumili ng iba, tapos ipadala ulit.'),
      RequestFailure.notInTeam => const Bilingual(
          'You are no longer in that team. Choose another team, or send it as your own request.',
          'Wala ka na sa team na iyon. Pumili ng ibang team, o ipadala bilang sarili mong request.'),
      RequestFailure.notTeamLeader => const Bilingual(
          'Only the team leader can request for another member.',
          'Ang team leader lang ang puwedeng mag-request para sa ibang miyembro.'),
      RequestFailure.badMember => const Bilingual(
          'That member is no longer in the team. Choose someone else.', 'Wala na sa team ang miyembrong iyon. Pumili ng iba.'),
      RequestFailure.badCatalogItem => const Bilingual(
          'An item is no longer in the list. Choose it again or describe it.',
          'Wala na sa listahan ang isang item. Piliin ulit o ilarawan ito.'),
      RequestFailure.incomplete => const Bilingual(
          'Something in this request is incomplete. Check each item, then send again.',
          'May kulang sa request na ito. Suriin ang bawat item, tapos ipadala ulit.'),
      RequestFailure.badQuantity =>
        const Bilingual('Enter a quantity above 0.', 'Maglagay ng dami na higit sa 0.'),
      RequestFailure.urgentNeedsReason => const Bilingual(
          'An urgent item needs a reason and a needed-by date.', 'Kailangan ng dahilan at petsa ang urgent na item.'),
      RequestFailure.lineClosed =>
        const Bilingual('This item is already cancelled.', 'Naka-cancel na ang item na ito.'),
      RequestFailure.notYours => const Bilingual(
          'Only the person who sent this request can change it.', 'Ang nagpadala lang ng request ang puwedeng magbago nito.'),
      RequestFailure.notARequester => failureCopy(AttendanceFailure.notAWorker),
      RequestFailure.appUpdateRequired => failureCopy(AttendanceFailure.appUpdateRequired),
      RequestFailure.sessionExpired => failureCopy(AttendanceFailure.sessionExpired),
      RequestFailure.noConnection => failureCopy(AttendanceFailure.noConnection),
      RequestFailure.photoNotUploaded || RequestFailure.unexpected => failureCopy(AttendanceFailure.unexpected),
    };

/// NEW: the lead line over an operation the server refused for good.
const notAcceptedLead = Bilingual('This was not accepted.', 'Hindi ito tinanggap.');

/// NEW: an empty destination list — no project is open, or the account has no
/// company yet (0085 offers nothing to an owner-less account).
const noDestinationsCopy = Bilingual(
  'No project is open for requests right now. If this keeps happening, call the office.',
  'Walang project na bukas para sa request ngayon. Kung palaging ganito, tawagan ang opisina.',
);

const backToDraftsLabel = 'Edit and send again · I-edit at ipadala ulit';
```

- [ ] **Step 4: Run** — `flutter test test/requests/domain` → all pass (22); `flutter analyze lib/requests` → "No issues found!".

- [ ] **Step 5: Stop — no commit.**

---

### Task 3: The phone's request store

**Files:**
- Create: `lib/requests/data/requests_db.dart`
- Test: `test/requests/data/requests_db_test.dart`

**Interfaces:**
- Consumes: `RequestDraft` (Task 2), `RequestOp`, `OpKind` (Task 2).
- Produces: `RequestsDb.open(factory, path, {singleInstance})`, `openDeviceRequestsDb({singleInstance})` (file `workmate_requests.db`); drafts: `saveDraft(worker, draft, now)`, `drafts(worker, queued:)`, `draft(worker, id)`, `deleteDraft(worker, id)` (row only), `queueDraft(worker, draft, ops, now)` (one transaction), `unqueueDraft(worker, draftId) → bool`; queue: `addOps(ops)` (seq continues), `sendable(worker)`, `ops(worker)`, `op(id)`, `hasAnySendable()`, `recordAttempt`, `markFailed`, `failDraftOps(draftId, error)`, `setBase(opId, base)`, `deleteOp`; links: `link(worker, draftId, requestId, lineIds)` (also points the draft's photo ops at the request and each photo's line), `links(worker) → {draftId: requestId}`, `deleteLink`; cache: `putCache(worker, name, json, at)`, `cache(worker, name) → ({body, at})?`.

A separate file from the attendance database on purpose: neither can break the other's schema.

- [ ] **Step 1: Write the failing test** — create `test/requests/data/requests_db_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/requests/data/requests_db.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_op.dart';

final t0 = DateTime.utc(2026, 10, 5, 1);

RequestDraft draft(String id) => RequestDraft(id: id, createdAt: t0, lines: const [DraftLine(id: 'x1', description: 'Sand', unit: 'bag', quantity: '5')]);

RequestOp op(String id, OpKind kind, {String worker = 'u1', String? draftId, int? pos, String? lineId}) => RequestOp(
      opId: id,
      workerId: worker,
      kind: kind,
      createdAt: t0,
      draftId: draftId,
      linePosition: pos,
      lineId: lineId,
      body: kind == OpKind.photo ? {'local_path': '/p/$id.jpg', 'photo_id': 'ph-$id'} : const {},
    );

void main() {
  late RequestsDb db;
  setUpAll(sqfliteFfiInit);
  setUp(() async => db = await RequestsDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false));
  tearDown(() => db.close());

  test('drafts are per worker and split by queued', () async {
    await db.saveDraft('u1', draft('d1'), t0);
    await db.saveDraft('u2', draft('d2'), t0);
    expect((await db.drafts('u1', queued: false)).map((d) => d.id), ['d1']);
    expect(await db.drafts('u1', queued: true), isEmpty);
    expect(await db.draft('u2', 'd1'), isNull, reason: 'another worker never sees it');
    await db.deleteDraft('u1', 'd1');
    expect(await db.drafts('u1', queued: false), isEmpty);
  });

  test('queueing a draft writes the draft and its ops together, in order', () async {
    await db.addOps([op('old', OpKind.quantity)]);
    await db.queueDraft('u1', draft('d1'), [op('s', OpKind.submit, draftId: 'd1'), op('p', OpKind.photo, draftId: 'd1', pos: 0)], t0);
    expect((await db.drafts('u1', queued: true)).single.id, 'd1');
    final queue = await db.sendable('u1');
    expect(queue.map((o) => o.opId), ['old', 's', 'p']);
    expect(queue.map((o) => o.seq), [1, 2, 3]);
    expect(await db.sendable('u2'), isEmpty);
    expect(await db.hasAnySendable(), isTrue);
  });

  test('a landed submit links its photos to the request and their lines', () async {
    await db.queueDraft('u1', draft('d1'), [
      op('s', OpKind.submit, draftId: 'd1'),
      op('p0', OpKind.photo, draftId: 'd1', pos: 0),
      op('p1', OpKind.photo, draftId: 'd1', pos: 1),
    ], t0);
    await db.link('u1', 'd1', 'r1', ['l0', 'l1']);
    expect(await db.links('u1'), {'d1': 'r1'});
    final photos = (await db.sendable('u1')).where((o) => o.kind == OpKind.photo).toList();
    expect(photos.map((o) => (o.requestId, o.lineId)), [('r1', 'l0'), ('r1', 'l1')]);
    await db.deleteLink('d1');
    expect(await db.links('u1'), isEmpty);
  });

  test('attempts, refusals, rebases and deletes', () async {
    await db.addOps([op('a', OpKind.quantity, lineId: 'l1'), op('b', OpKind.quantity, lineId: 'l1')]);
    await db.recordAttempt('a', 'noConnection');
    await db.setBase('b', 7);
    expect((await db.op('a'))!.attempts, 1);
    expect((await db.op('b'))!.baseVersion, 7);
    await db.markFailed('a', 'lineClosed');
    expect((await db.sendable('u1')).map((o) => o.opId), ['b']);
    expect((await db.ops('u1')).map((o) => o.opId), ['a', 'b']);
    await db.deleteOp('b');
    expect(await db.sendable('u1'), isEmpty);
    expect(await db.hasAnySendable(), isFalse);
  });

  test('a refused draft goes back to editing only when nothing of it can still be sent', () async {
    await db.queueDraft('u1', draft('d1'), [op('s', OpKind.submit, draftId: 'd1'), op('p', OpKind.photo, draftId: 'd1', pos: 0)], t0);
    expect(await db.unqueueDraft('u1', 'd1'), isFalse);
    await db.markFailed('s', 'destinationClosed');
    await db.failDraftOps('d1', 'destinationClosed');
    expect((await db.op('p'))!.failedPermanently, isTrue);
    expect(await db.unqueueDraft('u1', 'd1'), isTrue);
    expect(await db.ops('u1'), isEmpty);
    expect((await db.drafts('u1', queued: false)).single.id, 'd1');
  });

  test('the cache keeps the last answer per worker', () async {
    await db.putCache('u1', 'requests', [
      {'id': 'r1'},
    ], t0);
    final c = await db.cache('u1', 'requests');
    expect(c!.body, [
      {'id': 'r1'},
    ]);
    expect(c.at, t0);
    expect(await db.cache('u2', 'requests'), isNull);
  });
}
```

- [ ] **Step 2: Run it to verify it fails** — `flutter test test/requests/data/requests_db_test.dart` → compile errors.

- [ ] **Step 3: Write** `lib/requests/data/requests_db.dart`:

```dart
import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../domain/request_draft.dart';
import '../domain/request_op.dart';

/// Drafts, the send-once queue, what each sent draft became on the server,
/// and the last answers the app read (for offline use) — every row scoped by
/// worker, because site phones are shared (spec §4E). Its own file, apart
/// from the attendance database, so neither can break the other.
class RequestsDb {
  RequestsDb._(this._db);

  final Database _db;

  static Future<RequestsDb> open(DatabaseFactory factory, String path, {bool singleInstance = true}) async {
    final db = await factory.openDatabase(
      path,
      options: OpenDatabaseOptions(version: 1, onCreate: _create, singleInstance: singleInstance),
    );
    return RequestsDb._(db);
  }

  static Future<void> _create(Database db, int version) async {
    await db.execute('''
      create table request_draft (
        id text primary key,
        worker_id text not null,
        body text not null,
        queued integer not null default 0,
        created_at integer not null,
        updated_at integer not null
      )''');
    await db.execute('''
      create table request_op (
        op_id text primary key,
        worker_id text not null,
        kind text not null,
        draft_id text,
        request_id text,
        line_id text,
        line_position integer,
        body text not null,
        base_version integer,
        seq integer not null,
        attempts integer not null default 0,
        last_error text,
        failed_permanently integer not null default 0,
        created_at integer not null
      )''');
    await db.execute('''
      create table request_link (
        draft_id text primary key,
        worker_id text not null,
        request_id text not null
      )''');
    await db.execute('''
      create table request_cache (
        worker_id text not null,
        name text not null,
        body text not null,
        fetched_at integer not null,
        primary key (worker_id, name)
      )''');
  }

  Future<void> close() => _db.close();

  // ── drafts ─────────────────────────────────────────────────────────────

  Future<void> saveDraft(String workerId, RequestDraft d, DateTime now) => _db.insert(
        'request_draft',
        {
          'id': d.id,
          'worker_id': workerId,
          'body': jsonEncode(d.toJson()),
          'queued': 0,
          'created_at': d.createdAt.millisecondsSinceEpoch,
          'updated_at': now.millisecondsSinceEpoch,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  /// [queued] false = still being edited; true = handed to the queue.
  Future<List<RequestDraft>> drafts(String workerId, {required bool queued}) async => (await _db.query('request_draft',
          where: 'worker_id = ? and queued = ?', whereArgs: [workerId, queued ? 1 : 0], orderBy: 'created_at desc'))
      .map((m) => RequestDraft.fromJson(Map<String, dynamic>.from(jsonDecode(m['body']! as String) as Map)))
      .toList();

  Future<RequestDraft?> draft(String workerId, String id) async {
    final rows = await _db.query('request_draft', where: 'worker_id = ? and id = ?', whereArgs: [workerId, id], limit: 1);
    return rows.isEmpty
        ? null
        : RequestDraft.fromJson(Map<String, dynamic>.from(jsonDecode(rows.first['body']! as String) as Map));
  }

  /// The row only; its photo files belong to the caller (they may still be
  /// owed to the server by a queued photo op).
  Future<void> deleteDraft(String workerId, String id) =>
      _db.delete('request_draft', where: 'worker_id = ? and id = ?', whereArgs: [workerId, id]);

  /// One transaction: the draft is marked queued AND its ops exist, or
  /// neither — a queued draft with no ops would sit "Pending" forever.
  Future<void> queueDraft(String workerId, RequestDraft d, List<RequestOp> ops, DateTime now) => _db.transaction((txn) async {
        await txn.insert(
          'request_draft',
          {
            'id': d.id,
            'worker_id': workerId,
            'body': jsonEncode(d.toJson()),
            'queued': 1,
            'created_at': d.createdAt.millisecondsSinceEpoch,
            'updated_at': now.millisecondsSinceEpoch,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
        await _insertOps(txn, ops);
      });

  /// A refused draft back to editing: its (all refused) ops go, it is no
  /// longer queued. Refused if any of its ops could still be sent.
  Future<bool> unqueueDraft(String workerId, String draftId) => _db.transaction((txn) async {
        final live = await txn.query('request_op',
            where: 'worker_id = ? and draft_id = ? and failed_permanently = 0', whereArgs: [workerId, draftId], limit: 1);
        if (live.isNotEmpty) return false;
        await txn.delete('request_op', where: 'worker_id = ? and draft_id = ?', whereArgs: [workerId, draftId]);
        await txn.update('request_draft', {'queued': 0}, where: 'worker_id = ? and id = ?', whereArgs: [workerId, draftId]);
        return true;
      });

  // ── the queue ──────────────────────────────────────────────────────────

  Future<void> addOps(List<RequestOp> ops) => _db.transaction((txn) => _insertOps(txn, ops));

  /// Appended in list order: seq continues from the highest in the table.
  Future<void> _insertOps(Transaction txn, List<RequestOp> ops) async {
    final top = (await txn.rawQuery('select coalesce(max(seq), 0) as s from request_op')).first['s']! as int;
    var seq = top;
    for (final o in ops) {
      seq++;
      await txn.insert('request_op', {...o.toMap(), 'seq': seq});
    }
  }

  /// This worker's ops that may still be sent, in queue order.
  Future<List<RequestOp>> sendable(String workerId) async => (await _db.query('request_op',
          where: 'worker_id = ? and failed_permanently = 0', whereArgs: [workerId], orderBy: 'seq asc'))
      .map(RequestOp.fromMap)
      .toList();

  /// Every op of this worker, refused ones included, in queue order.
  Future<List<RequestOp>> ops(String workerId) async =>
      (await _db.query('request_op', where: 'worker_id = ?', whereArgs: [workerId], orderBy: 'seq asc'))
          .map(RequestOp.fromMap)
          .toList();

  Future<RequestOp?> op(String opId) async {
    final rows = await _db.query('request_op', where: 'op_id = ?', whereArgs: [opId], limit: 1);
    return rows.isEmpty ? null : RequestOp.fromMap(rows.first);
  }

  /// Any worker: the app-closed sweeper asks this before it touches auth.
  Future<bool> hasAnySendable() async =>
      (await _db.query('request_op', columns: ['op_id'], where: 'failed_permanently = 0', limit: 1)).isNotEmpty;

  Future<void> recordAttempt(String opId, String error) =>
      _db.rawUpdate('update request_op set attempts = attempts + 1, last_error = ? where op_id = ?', [error, opId]);

  Future<void> markFailed(String opId, String error) =>
      _db.rawUpdate('update request_op set failed_permanently = 1, last_error = ? where op_id = ?', [error, opId]);

  /// A refused submit takes its photo ops with it: they can never land.
  Future<void> failDraftOps(String draftId, String error) => _db.rawUpdate(
      'update request_op set failed_permanently = 1, last_error = ? where draft_id = ? and failed_permanently = 0',
      [error, draftId]);

  Future<void> setBase(String opId, int base) =>
      _db.update('request_op', {'base_version': base}, where: 'op_id = ?', whereArgs: [opId]);

  Future<void> deleteOp(String opId) => _db.delete('request_op', where: 'op_id = ?', whereArgs: [opId]);

  // ── what a sent draft became ───────────────────────────────────────────

  /// The draft's submit landed: remember the request, and point its photo
  /// ops at the request and at each photo's line (by position). One
  /// transaction, so a photo op never waits on a link that half-exists.
  Future<void> link(String workerId, String draftId, String requestId, List<String> lineIds) => _db.transaction((txn) async {
        await txn.insert('request_link', {'draft_id': draftId, 'worker_id': workerId, 'request_id': requestId},
            conflictAlgorithm: ConflictAlgorithm.replace);
        final photos = await txn.query('request_op',
            where: "worker_id = ? and draft_id = ? and kind = 'photo'", whereArgs: [workerId, draftId]);
        for (final p in photos) {
          final pos = p['line_position'] as int?;
          await txn.update(
            'request_op',
            {'request_id': requestId, 'line_id': (pos != null && pos < lineIds.length) ? lineIds[pos] : null},
            where: 'op_id = ?',
            whereArgs: [p['op_id']],
          );
        }
      });

  /// draft id → request id, for this worker.
  Future<Map<String, String>> links(String workerId) async => {
        for (final m in await _db.query('request_link', where: 'worker_id = ?', whereArgs: [workerId]))
          m['draft_id']! as String: m['request_id']! as String,
      };

  Future<void> deleteLink(String draftId) => _db.delete('request_link', where: 'draft_id = ?', whereArgs: [draftId]);

  // ── last answers read, for offline ─────────────────────────────────────

  Future<void> putCache(String workerId, String name, Object json, DateTime at) => _db.insert(
        'request_cache',
        {'worker_id': workerId, 'name': name, 'body': jsonEncode(json), 'fetched_at': at.millisecondsSinceEpoch},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  Future<({Object? body, DateTime at})?> cache(String workerId, String name) async {
    final rows = await _db.query('request_cache', where: 'worker_id = ? and name = ?', whereArgs: [workerId, name], limit: 1);
    if (rows.isEmpty) return null;
    return (
      body: jsonDecode(rows.first['body']! as String),
      at: DateTime.fromMillisecondsSinceEpoch(rows.first['fetched_at']! as int, isUtc: true),
    );
  }
}

/// The database file on the phone, shared by the app and the background sync.
Future<RequestsDb> openDeviceRequestsDb({bool singleInstance = true}) async =>
    RequestsDb.open(databaseFactory, '${await getDatabasesPath()}/workmate_requests.db', singleInstance: singleInstance);
```

- [ ] **Step 4: Run** — `flutter test test/requests/data/requests_db_test.dart` → 6 passed.

- [ ] **Step 5: Stop — no commit.**

---

### Task 4: Server calls and the send-once drain

**Files:**
- Create: `lib/requests/data/request_remote.dart`, `lib/requests/sync/request_sync.dart`
- Create: `test/requests/request_fakes.dart` (the `FakeRequestRemote` half; Task 7 appends `FakeRequestsApi`)
- Test: `test/requests/sync/request_sync_test.dart`

**Interfaces:**
- Consumes: Tasks 1–3; `SyncResult` from `lib/attendance/sync/submission_sync.dart`.
- Produces: `requestPhotoBucket`, `requestPhotoPath({workerId, requestId, photoId})`, `submitParams`, `quantityParams`, `cancelLineParams`, `cancelRequestParams`, `attachParams`, `isAlreadyUploaded(error)`; `abstract class RequestRemote` (`destinations`, `myTeams`, `catalog`, `myRequests`, `submit(opId, payload, workerId:)`, `changeQuantity(opId, lineId, base, qty, workerId:)`, `cancelLine`, `cancelRequest`, `attachPhoto({opId, requestId, lineId, photoId, localPath, workerId})`, `signedUrl(path)`); `SupabaseRequestRemote(client)`; `RequestSync(db:, remote:)` with `drain(workerId) → SyncResult` and `settled`. Test fakes: `site`, `fence`, `pipe`, `drill`, `masonry`, `FakeRequestRemote`.

Drain rules: one pass sends this worker's ops **in queue order** and stops at the first transient failure (later ops of the same request stay behind it). A submit that lands links the draft; its photos then upload to `{worker}/{request}/{photo}.jpg` and attach to their line; a photo file is deleted only after its attach lands. A refused submit fails its photo ops too (kept, never sent). A missing photo file fails that photo only.

- [ ] **Step 1: Write the fakes** — create `test/requests/request_fakes.dart`:

```dart
import 'package:workmate/requests/data/request_remote.dart';
import 'package:workmate/requests/domain/request_models.dart';

const site = Destination(projectId: 'f1', projectName: 'Santos Townhouse', workId: 'f1', workName: 'Main Contract', isMain: true);
const fence = Destination(projectId: 'f1', projectName: 'Santos Townhouse', workId: 'f9', workName: 'AW-03 Fence', isMain: false);
const pipe = CatalogItem(id: 'c1', kind: ItemKind.material, name: 'PVC pipe', spec: '1/2 in', unit: 'pc', category: 'plumbing');
const drill = CatalogItem(id: 'c2', kind: ItemKind.tool, name: 'Drill', spec: 'cordless', unit: 'pc', category: '');
const masonry = MyTeam(id: 't1', name: 'Masonry A', iLead: true, members: [
  TeamMember(id: 'u1', name: 'Juan'),
  TeamMember(id: 'u2', name: 'Pedro'),
]);

/// A RequestRemote whose every answer the test sets, recording every call.
class FakeRequestRemote implements RequestRemote {
  List<Destination> dests = [site, fence];
  List<MyTeam> teams = [masonry];
  List<CatalogItem> items = [pipe, drill];
  Object? readError;

  List<Map<String, dynamic>> requests = [];
  Object? requestsError;

  /// Thrown by the next write (then cleared), or by every write while [writeErrorSticky].
  Object? writeError;
  bool writeErrorSticky = false;

  final calls = <String>[];
  final quantityBases = <int>[];
  Map<String, dynamic> quantityResult = {'status': 'applied', 'version': 2, 'needed': 8};
  final attached = <String>[];
  int submits = 0;

  void _maybeFail() {
    final e = writeError;
    if (e == null) return;
    if (!writeErrorSticky) writeError = null;
    throw e;
  }

  @override
  Future<List<Destination>> destinations() async {
    if (readError != null) throw readError!;
    return dests;
  }

  @override
  Future<List<MyTeam>> myTeams() async {
    if (readError != null) throw readError!;
    return teams;
  }

  @override
  Future<List<CatalogItem>> catalog() async {
    if (readError != null) throw readError!;
    return items;
  }

  @override
  Future<List<Map<String, dynamic>>> myRequests() async {
    if (requestsError != null) throw requestsError!;
    return requests;
  }

  @override
  Future<Map<String, dynamic>> submit(String opId, Map<String, dynamic> payload, {required String workerId}) async {
    calls.add('submit:$opId');
    _maybeFail();
    submits++;
    final lines = payload['lines'] as List;
    return {
      'request_id': 'r$submits',
      'received_at': '2026-10-05T03:00:00+00:00',
      'line_ids': [for (var i = 0; i < lines.length; i++) 'r$submits-l$i'],
    };
  }

  @override
  Future<Map<String, dynamic>> changeQuantity(String opId, String lineId, int baseVersion, double quantity, {required String workerId}) async {
    calls.add('quantity:$lineId:$quantity');
    _maybeFail();
    quantityBases.add(baseVersion);
    return quantityResult;
  }

  @override
  Future<Map<String, dynamic>> cancelLine(String opId, String lineId, {required String workerId}) async {
    calls.add('cancelLine:$lineId');
    _maybeFail();
    return {'status': 'cancelled', 'version': 3};
  }

  @override
  Future<Map<String, dynamic>> cancelRequest(String opId, String requestId, {required String workerId}) async {
    calls.add('cancelRequest:$requestId');
    _maybeFail();
    return {'status': 'cancelled', 'lines': 1};
  }

  @override
  Future<void> attachPhoto({
    required String opId,
    required String requestId,
    required String? lineId,
    required String photoId,
    required String localPath,
    required String workerId,
  }) async {
    calls.add('photo:$requestId:$lineId');
    _maybeFail();
    attached.add(requestPhotoPath(workerId: workerId, requestId: requestId, photoId: photoId));
  }

  @override
  Future<String?> signedUrl(String path) async => 'https://signed/$path';
}
```

- [ ] **Step 2: Write the failing test** — create `test/requests/sync/request_sync_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/attendance/sync/submission_sync.dart' show SyncResult;
import 'package:workmate/requests/data/request_remote.dart';
import 'package:workmate/requests/data/requests_db.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_op.dart';
import 'package:workmate/requests/sync/request_sync.dart';

import '../request_fakes.dart';

final t0 = DateTime.utc(2026, 10, 5, 1);

void main() {
  late RequestsDb db;
  late FakeRequestRemote remote;
  late RequestSync sync;
  late Directory dir;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await RequestsDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    remote = FakeRequestRemote();
    sync = RequestSync(db: db, remote: remote);
    dir = await Directory.systemTemp.createTemp('req-sync');
  });
  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  Future<String> photo(String name) async {
    final f = File('${dir.path}/$name.jpg');
    await f.writeAsBytes([1, 2, 3]);
    return f.path;
  }

  Future<void> queueDraft({List<String> photos = const []}) async {
    final d = RequestDraft(id: 'd1', createdAt: t0, destination: site, lines: [
      DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '10', photos: photos),
    ]);
    await db.queueDraft('u1', d, [
      RequestOp(opId: 'sub', workerId: 'u1', kind: OpKind.submit, createdAt: t0, draftId: 'd1', body: submitPayload(d)),
      for (var i = 0; i < photos.length; i++)
        RequestOp(
          opId: 'ph$i',
          workerId: 'u1',
          kind: OpKind.photo,
          createdAt: t0,
          draftId: 'd1',
          linePosition: 0,
          body: {'local_path': photos[i], 'photo_id': 'pid$i'},
        ),
    ], t0);
  }

  RequestOp edit(String id, {String line = 'l1', double qty = 8, int base = 1, OpKind kind = OpKind.quantity}) =>
      RequestOp(opId: id, workerId: 'u1', kind: kind, createdAt: t0, requestId: 'r9', lineId: line, baseVersion: base, body: {'quantity': qty});

  test('a draft lands, then its photos attach to its line and leave the phone', () async {
    final p = await photo('a');
    await queueDraft(photos: [p]);
    expect(await sync.drain('u1'), SyncResult.done);
    expect(remote.calls, ['submit:sub', 'photo:r1:r1-l0']);
    expect(remote.attached, ['u1/r1/pid0.jpg']);
    expect(await db.links('u1'), {'d1': 'r1'});
    expect(await db.sendable('u1'), isEmpty);
    expect(sync.settled, 2);
    expect(File(p).existsSync(), isFalse, reason: 'deleted only after the attach landed');
  });

  test('no signal: everything waits, in order, and nothing is lost', () async {
    final p = await photo('a');
    await queueDraft(photos: [p]);
    remote.writeError = const SocketException('down');
    expect(await sync.drain('u1'), SyncResult.retry);
    expect((await db.sendable('u1')).map((o) => o.opId), ['sub', 'ph0']);
    expect(File(p).existsSync(), isTrue);
    expect(await sync.drain('u1'), SyncResult.done);
    expect(remote.submits, 1);
  });

  test('a refused draft is kept, with its photos, for the worker to fix', () async {
    final p = await photo('a');
    await queueDraft(photos: [p]);
    remote.writeError = Exception('DESTINATION_CLOSED');
    expect(await sync.drain('u1'), SyncResult.done);
    final ops = await db.ops('u1');
    expect(ops.every((o) => o.failedPermanently), isTrue);
    expect(ops.first.lastError, 'destinationClosed');
    expect(remote.calls, ['submit:sub'], reason: 'its photo is never sent');
    expect(File(p).existsSync(), isTrue);
  });

  test('a lost photo file fails that photo, not the request', () async {
    await queueDraft(photos: ['${dir.path}/gone.jpg']);
    expect(await sync.drain('u1'), SyncResult.done);
    final ops = await db.ops('u1');
    expect(ops.single.lastError, 'PHOTO_MISSING');
    expect(await db.links('u1'), {'d1': 'r1'});
  });

  test('two queued edits of one line: the second rides on the first answer', () async {
    await db.addOps([edit('e1', qty: 8, base: 1), edit('e2', qty: 6, base: 2)]);
    remote.quantityResult = {'status': 'applied', 'version': 5, 'needed': 8};
    await sync.drain('u1');
    expect(remote.quantityBases, [1, 5]);
  });

  test('after a conflict, the later edit of that line conflicts too', () async {
    await db.addOps([edit('e1', base: 1), edit('e2', qty: 6, base: 2), edit('e3', line: 'l2', base: 4)]);
    remote.quantityResult = {'status': 'conflict', 'version': 3, 'needed': 12};
    await sync.drain('u1');
    expect(remote.quantityBases, [1, 0, 4]);
  });

  test('another worker\'s ops are never sent under this session', () async {
    await db.addOps([RequestOp(opId: 'x', workerId: 'u2', kind: OpKind.cancelRequest, createdAt: t0, requestId: 'r9')]);
    expect(await sync.drain('u1'), SyncResult.done);
    expect(await sync.drain(''), SyncResult.done);
    expect(remote.calls, isEmpty);
  });

  test('an unexpected failure is retried, then given up so the queue moves', () async {
    await db.addOps([edit('e1'), RequestOp(opId: 'c', workerId: 'u1', kind: OpKind.cancelRequest, createdAt: t0, requestId: 'r9')]);
    remote
      ..writeError = Exception('boom')
      ..writeErrorSticky = true;
    for (var i = 0; i < 9; i++) {
      expect(await sync.drain('u1'), SyncResult.retry);
    }
    remote.writeErrorSticky = false;
    remote.writeError = Exception('boom');
    expect(await sync.drain('u1'), SyncResult.done);
    expect((await db.op('e1'))!.failedPermanently, isTrue);
    expect(remote.calls.last, 'cancelRequest:r9');
  });

  test('a photo path is exactly what the upload policy accepts', () {
    expect(requestPhotoPath(workerId: 'u1', requestId: 'r1', photoId: 'p1'), 'u1/r1/p1.jpg');
    expect(quantityParams('o', 'l', 3, 8), {'p_op': 'o', 'p_line': 'l', 'p_base_version': 3, 'p_quantity': 8.0});
    expect(attachParams('o', 'r', null, 'u1/r/p.jpg'), {'p_op': 'o', 'p_request': 'r', 'p_line': null, 'p_path': 'u1/r/p.jpg'});
  });
}
```

- [ ] **Step 3: Run it to verify it fails** — `flutter test test/requests/sync` → compile errors.

- [ ] **Step 4: Write the code.**

`lib/requests/data/request_remote.dart`:

```dart
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/request_models.dart';

/// The private bucket every request photo lives in (0085; never `uploads`).
const requestPhotoBucket = 'request-photos';

const _readTimeout = Duration(seconds: 15);
const _rpcTimeout = Duration(seconds: 20);
const _uploadTimeout = Duration(seconds: 60);

/// {requester}/{request}/{photo}.jpg — the only shape 0085's upload policy
/// and pr_attach_photo accept.
String requestPhotoPath({required String workerId, required String requestId, required String photoId}) =>
    '$workerId/$requestId/$photoId.jpg';

// The RPC arguments — exactly the 0085 signatures.
Map<String, dynamic> submitParams(String opId, Map<String, dynamic> payload) => {'p_op': opId, 'p_request': payload};

Map<String, dynamic> quantityParams(String opId, String lineId, int baseVersion, double quantity) =>
    {'p_op': opId, 'p_line': lineId, 'p_base_version': baseVersion, 'p_quantity': quantity};

Map<String, dynamic> cancelLineParams(String opId, String lineId) => {'p_op': opId, 'p_line': lineId};

Map<String, dynamic> cancelRequestParams(String opId, String requestId) => {'p_op': opId, 'p_request': requestId};

Map<String, dynamic> attachParams(String opId, String requestId, String? lineId, String path) =>
    {'p_op': opId, 'p_request': requestId, 'p_line': lineId, 'p_path': path};

/// A retry after the upload landed but the attach did not: the object is
/// already there. 0085 gives workers no UPDATE on storage, so an upsert would
/// be refused; "already exists" is success.
bool isAlreadyUploaded(Object error) =>
    error is StorageException &&
    (error.statusCode == '409' || error.message.toLowerCase().contains('exists') || error.message.contains('Duplicate'));

abstract class RequestRemote {
  Future<List<Destination>> destinations();
  Future<List<MyTeam>> myTeams();
  Future<List<CatalogItem>> catalog();

  /// The caller's requests plus, for a current leader, the team's (newest first).
  Future<List<Map<String, dynamic>>> myRequests();

  // Every write files under the CURRENT session: if it is not [workerId], it
  // throws AUTH_REQUIRED instead of sending another worker's change.
  Future<Map<String, dynamic>> submit(String opId, Map<String, dynamic> payload, {required String workerId});
  Future<Map<String, dynamic>> changeQuantity(String opId, String lineId, int baseVersion, double quantity, {required String workerId});
  Future<Map<String, dynamic>> cancelLine(String opId, String lineId, {required String workerId});
  Future<Map<String, dynamic>> cancelRequest(String opId, String requestId, {required String workerId});

  /// Uploads the photo, THEN links it (a row must never point at a missing file).
  Future<void> attachPhoto({
    required String opId,
    required String requestId,
    required String? lineId,
    required String photoId,
    required String localPath,
    required String workerId,
  });

  /// A 10-minute link to one private photo, or null.
  Future<String?> signedUrl(String path);
}

class SupabaseRequestRemote implements RequestRemote {
  SupabaseRequestRemote(this._client);

  final SupabaseClient _client;

  List<Map<String, dynamic>> _rows(Object? result) =>
      [for (final r in (result as List<dynamic>? ?? const [])) Map<String, dynamic>.from(r as Map)];

  void _sameWorker(String workerId) {
    final session = _client.auth.currentUser?.id;
    if (session == null || session != workerId) throw StateError('AUTH_REQUIRED');
  }

  Future<Map<String, dynamic>> _write(String fn, Map<String, dynamic> params, String workerId) async {
    _sameWorker(workerId);
    final result = await _client.rpc(fn, params: params).timeout(_rpcTimeout);
    return Map<String, dynamic>.from(result as Map);
  }

  @override
  Future<List<Destination>> destinations() async =>
      _rows(await _client.rpc('pr_destinations').timeout(_readTimeout)).map(Destination.fromRow).toList();

  @override
  Future<List<MyTeam>> myTeams() async => _rows(await _client.rpc('pr_my_teams').timeout(_readTimeout)).map(MyTeam.fromRow).toList();

  @override
  Future<List<CatalogItem>> catalog() async =>
      _rows(await _client.rpc('pr_catalog').timeout(_readTimeout)).map(CatalogItem.fromRow).whereType<CatalogItem>().toList();

  @override
  Future<List<Map<String, dynamic>>> myRequests() async =>
      _rows(await _client.rpc('pr_my_requests', params: {'p_limit': 100}).timeout(_readTimeout));

  @override
  Future<Map<String, dynamic>> submit(String opId, Map<String, dynamic> payload, {required String workerId}) =>
      _write('pr_submit_request', submitParams(opId, payload), workerId);

  @override
  Future<Map<String, dynamic>> changeQuantity(String opId, String lineId, int baseVersion, double quantity, {required String workerId}) =>
      _write('pr_change_quantity', quantityParams(opId, lineId, baseVersion, quantity), workerId);

  @override
  Future<Map<String, dynamic>> cancelLine(String opId, String lineId, {required String workerId}) =>
      _write('pr_cancel_line', cancelLineParams(opId, lineId), workerId);

  @override
  Future<Map<String, dynamic>> cancelRequest(String opId, String requestId, {required String workerId}) =>
      _write('pr_cancel_request', cancelRequestParams(opId, requestId), workerId);

  @override
  Future<void> attachPhoto({
    required String opId,
    required String requestId,
    required String? lineId,
    required String photoId,
    required String localPath,
    required String workerId,
  }) async {
    _sameWorker(workerId);
    final path = requestPhotoPath(workerId: workerId, requestId: requestId, photoId: photoId);
    try {
      await _client.storage
          .from(requestPhotoBucket)
          .upload(path, File(localPath), fileOptions: const FileOptions(upsert: false, contentType: 'image/jpeg'))
          .timeout(_uploadTimeout);
    } catch (e) {
      if (!isAlreadyUploaded(e)) rethrow;
    }
    await _client.rpc('pr_attach_photo', params: attachParams(opId, requestId, lineId, path)).timeout(_rpcTimeout);
  }

  @override
  Future<String?> signedUrl(String path) async {
    try {
      return await _client.storage.from(requestPhotoBucket).createSignedUrl(path, 600).timeout(_readTimeout);
    } catch (_) {
      return null;
    }
  }
}
```

`lib/requests/sync/request_sync.dart`:

```dart
import 'dart:io';

import '../../attendance/sync/submission_sync.dart' show SyncResult;
import '../data/request_remote.dart';
import '../data/requests_db.dart';
import '../domain/request_failure.dart';
import '../domain/request_op.dart';

/// A sane ceiling for one pass.
const _maxPerRun = 100;

/// Drains the request queue: ONE run sends this worker's ops in queue order,
/// stopping at the first transient failure (an op that must wait keeps every
/// later op of the same request behind it, so they land in the order made).
class RequestSync {
  RequestSync({required this.db, required this.remote});

  final RequestsDb db;
  final RequestRemote remote;

  /// Ops the last [drain] finished with: sent, or refused for good.
  int settled = 0;

  Future<SyncResult> drain(String workerId) async {
    settled = 0;
    // With no session nothing may be sent: it would file under whoever signs in next.
    if (workerId.isEmpty) return SyncResult.done;
    for (var i = 0; i < _maxPerRun; i++) {
      final queue = await db.sendable(workerId);
      if (queue.isEmpty) return SyncResult.done;
      if (await _send(queue.first, queue.sublist(1), workerId) == SyncResult.retry) return SyncResult.retry;
      settled++;
    }
    return SyncResult.done;
  }

  Future<SyncResult> _send(RequestOp op, List<RequestOp> later, String workerId) async {
    try {
      switch (op.kind) {
        case OpKind.submit:
          final result = await remote.submit(op.opId, op.body, workerId: workerId);
          final lineIds = [for (final id in (result['line_ids'] as List<dynamic>? ?? const [])) id as String];
          await db.link(workerId, op.draftId!, result['request_id'] as String, lineIds);
          await db.deleteOp(op.opId);
        case OpKind.photo:
          final requestId = op.requestId;
          final file = File(op.localPath ?? '');
          // Its submit never landed (it was refused, which fails this op too):
          // there is nothing to attach it to.
          if (requestId == null) {
            await db.markFailed(op.opId, 'PHOTO_ORPHAN');
            return SyncResult.done;
          }
          if (!file.existsSync()) {
            await db.markFailed(op.opId, 'PHOTO_MISSING');
            return SyncResult.done;
          }
          await remote.attachPhoto(
            opId: op.opId,
            requestId: requestId,
            lineId: op.lineId,
            photoId: op.photoId!,
            localPath: file.path,
            workerId: workerId,
          );
          await db.deleteOp(op.opId);
          _discard(file); // only now is the photo safe to delete
        case OpKind.quantity:
          final result = await remote.changeQuantity(op.opId, op.lineId!, op.baseVersion ?? 0, op.quantity!, workerId: workerId);
          await db.deleteOp(op.opId);
          await _rebase(later, op.lineId!, result);
        case OpKind.cancelLine:
          final result = await remote.cancelLine(op.opId, op.lineId!, workerId: workerId);
          await db.deleteOp(op.opId);
          await _rebase(later, op.lineId!, result);
        case OpKind.cancelRequest:
          await remote.cancelRequest(op.opId, op.requestId!, workerId: workerId);
          await db.deleteOp(op.opId);
      }
      return SyncResult.done;
    } catch (error) {
      final failure = RequestFailure.of(error);
      await db.recordAttempt(op.opId, failure.name);
      final givingUp = failure == RequestFailure.unexpected && op.attempts + 1 >= maxUnexpectedAttempts;
      if (failure.retryable && !givingUp) return SyncResult.retry;
      // Kept, flagged and shown: never let a worker believe it reached the office.
      await db.markFailed(op.opId, failure.name);
      if (op.kind == OpKind.submit && op.draftId != null) await db.failDraftOps(op.draftId!, failure.name);
      return SyncResult.done;
    }
  }

  Future<void> _rebase(List<RequestOp> later, String lineId, Map<String, dynamic> result) async {
    for (final e in rebaseAfter(later, lineId, result).entries) {
      await db.setBase(e.key, e.value);
    }
  }

  void _discard(File photo) {
    try {
      photo.deleteSync();
    } catch (_) {}
  }
}
```

- [ ] **Step 5: Run** — `flutter test test/requests/sync` → 9 passed; `flutter analyze lib/requests test/requests` → "No issues found!".

- [ ] **Step 6: Stop — no commit.**

---

### Task 5: The repository the screens use

**Files:**
- Create: `lib/requests/data/requests_api.dart`, `lib/requests/data/request_repository.dart`
- Test: `test/requests/data/request_repository_test.dart`

**Interfaces:**
- Consumes: Tasks 1–4; `DeviceBridge.preparePhoto` (`lib/attendance/device/device_bridge.dart`), `UploadScheduler` (`lib/attendance/sync/upload_scheduler.dart`), `newEventId()` (`lib/attendance/domain/event_id.dart`); test fakes `FakeDevice`, `FakeScheduler` (`test/attendance/fakes.dart`).
- Produces: `RequestReferences(destinations, teams, catalog, fromCache)`, `RequestEntry(state, remote?, draft?, pendingOps, failedOps)` (`key`, `sortTime`, `pendingQuantity(lineId)`, `cancelPending(lineId)`), `RequestsView(entries, fetchedAt, fromCache, error)`, `DraftInvalid(issues)`, `abstract interface class RequestsApi` (`references`, `drafts`, `newDraft`, `saveDraft`, `deleteDraft`, `keepPhoto(draftId, capturedPath)`, `discardPhoto`, `send`, `myRequests`, `changeQuantity`, `cancelLine`, `cancelRequest`, `returnToDrafts`, `dismissFailed`, `photoUrl`); `RequestRepository({db, remote, device, scheduler, currentWorkerId, photoDir, sendNow, now, newId})`.

`myRequests()` never throws for a network failure: it returns the server's list (fresh, or the cached copy with `fromCache` + `error`) merged with what is still on the phone — a sent draft shows **Pending** until the server's list contains its request (then the phone copy is forgotten), a refused one shows **Failed**.

- [ ] **Step 1: Write the failing test** — create `test/requests/data/request_repository_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/requests/data/request_repository.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/data/requests_db.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_op.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/requests/sync/request_sync.dart';

import '../../attendance/fakes.dart';
import '../domain/request_models_test.dart' show requestDoc;
import '../request_fakes.dart';

void main() {
  late RequestsDb db;
  late FakeRequestRemote remote;
  late Directory dir;
  late RequestRepository repo;
  var worker = 'u1';
  var ids = 0;
  var kicks = 0;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await RequestsDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    remote = FakeRequestRemote();
    dir = await Directory.systemTemp.createTemp('req-repo');
    worker = 'u1';
    ids = 0;
    kicks = 0;
    repo = RequestRepository(
      db: db,
      remote: remote,
      device: FakeDevice(),
      scheduler: FakeScheduler(),
      currentWorkerId: () => worker,
      photoDir: () async => dir,
      sendNow: () async => kicks++,
      now: () => DateTime.utc(2026, 10, 5, 2),
      newId: () => 'id${++ids}',
    );
  });
  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  RequestDraft ready() => repo.newDraft().copyWith(destination: site, lines: [DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '10')]);

  test('choices are cached, and served from the cache with no signal', () async {
    final fresh = await repo.references();
    expect(fresh.fromCache, isFalse);
    expect(fresh.destinations, [site, fence]);
    remote.readError = const SocketException('down');
    final cached = await repo.references();
    expect(cached.fromCache, isTrue);
    expect(cached.destinations, [site, fence]);
    expect(cached.teams.single.iLead, isTrue);
    expect(cached.catalog.map((c) => c.id), ['c1', 'c2']);
    worker = 'u2';
    await expectLater(repo.references(), throwsA(isA<SocketException>()), reason: 'never another worker\'s cache');
  });

  test('a draft is saved, listed, and discarded with its photos', () async {
    final raw = File('${dir.path}/raw.jpg')..writeAsBytesSync([1]);
    final kept = await repo.keepPhoto('d-x', raw.path);
    expect(kept, startsWith(dir.path));
    File(kept).writeAsBytesSync([1]); // FakeDevice returns the target without writing it
    final d = ready().copyWith(lines: [DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '1', photos: [kept])]);
    await repo.saveDraft(d);
    expect((await repo.drafts()).single.id, d.id);
    await repo.deleteDraft(d);
    expect(await repo.drafts(), isEmpty);
    expect(File(kept).existsSync(), isFalse);
  });

  test('an incomplete draft is refused before it is queued', () async {
    final d = repo.newDraft();
    await expectLater(repo.send(d), throwsA(isA<DraftInvalid>()));
    expect(await db.sendable('u1'), isEmpty);
  });

  test('sending queues the submit and one op per photo, then starts sending', () async {
    final d = ready().copyWith(lines: [DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '10', photos: ['/p/a.jpg', '/p/b.jpg'])]);
    await repo.send(d);
    final queue = await db.sendable('u1');
    expect(queue.map((o) => o.kind), [OpKind.submit, OpKind.photo, OpKind.photo]);
    expect(queue.first.body['folder_id'], 'f1');
    expect(queue[1].linePosition, 0);
    expect(queue[1].photoId, isNot(queue[2].photoId));
    expect(await repo.drafts(), isEmpty, reason: 'a queued draft is no longer editable');
    expect(kicks, 1);
  });

  test('the list shows a sent draft as Pending until the server has it', () async {
    await repo.send(ready());
    remote.requestsError = const SocketException('down');
    var view = await repo.myRequests();
    expect(view.entries.single.state, SyncState.pending);
    expect(view.entries.single.draft, isNotNull);
    expect(view.error, isA<SocketException>());

    remote.requestsError = null;
    await RequestSync(db: db, remote: remote).drain('u1');
    remote.requests = [requestDoc(id: 'r1')];
    view = await repo.myRequests();
    expect(view.entries.single.remote!.id, 'r1');
    expect(view.entries.single.state, SyncState.received);
    expect(await db.drafts('u1', queued: true), isEmpty, reason: 'the phone copy is forgotten once the server shows it');
  });

  test('a refused draft shows Failed and can go back to drafts', () async {
    await repo.send(ready());
    remote.writeError = Exception('DESTINATION_CLOSED');
    await RequestSync(db: db, remote: remote).drain('u1');
    final view = await repo.myRequests();
    expect(view.entries.single.state, SyncState.failed);
    expect(view.entries.single.failedOps.single.lastError, 'destinationClosed');
    await repo.returnToDrafts(view.entries.single.draft!.id);
    expect((await repo.drafts()).single.lines.single.quantity, '10');
    expect((await repo.myRequests()).entries, isEmpty);
  });

  test('edits chain their base versions and show as pending on the request', () async {
    remote.requests = [requestDoc(id: 'r1')];
    final r = RemoteRequest.fromJson(requestDoc(id: 'r1'));
    final l = r.lines.single; // version 2
    await repo.changeQuantity(r, l, 8);
    await repo.changeQuantity(r, l, 6);
    final queue = await db.sendable('u1');
    expect(queue.map((o) => o.baseVersion), [2, 3]);
    final entry = (await repo.myRequests()).entries.single;
    expect(entry.state, SyncState.pending);
    expect(entry.pendingQuantity(l.id), 6);
    await repo.cancelLine(r, l);
    await repo.cancelRequest(r);
    final entry2 = (await repo.myRequests()).entries.single;
    expect(entry2.cancelPending(l.id), isTrue);
    expect(kicks, 4);
  });

  test('a refused photo can be dismissed, and its file goes with it', () async {
    final f = File('${dir.path}/p.jpg')..writeAsBytesSync([1]);
    await db.addOps([
      RequestOp(
        opId: 'ph',
        workerId: 'u1',
        kind: OpKind.photo,
        createdAt: DateTime.utc(2026),
        requestId: 'r1',
        body: {'local_path': f.path, 'photo_id': 'p'},
      ),
    ]);
    await repo.dismissFailed((await db.op('ph'))!);
    expect(await db.op('ph'), isNotNull, reason: 'a sendable op is never dismissed');
    await db.markFailed('ph', 'unexpected');
    await repo.dismissFailed((await db.op('ph'))!);
    expect(await db.op('ph'), isNull);
    expect(f.existsSync(), isFalse);
  });

  test('nobody signed in: nothing is read or written', () async {
    worker = '';
    await expectLater(repo.myRequests(), throwsA(isA<StateError>()));
    await expectLater(repo.saveDraft(ready()), throwsA(isA<StateError>()));
  });
}
```

- [ ] **Step 2: Run it to verify it fails** — `flutter test test/requests/data/request_repository_test.dart` → compile errors.

- [ ] **Step 3: Write the code.**

`lib/requests/data/requests_api.dart`:

```dart
import '../domain/remote_request.dart';
import '../domain/request_draft.dart';
import '../domain/request_models.dart';
import '../domain/request_op.dart';
import '../domain/request_status.dart';

/// What a worker can choose from, fresh when online, the last copy offline.
class RequestReferences {
  const RequestReferences({
    required this.destinations,
    required this.teams,
    required this.catalog,
    this.fromCache = false,
  });

  final List<Destination> destinations;
  final List<MyTeam> teams;
  final List<CatalogItem> catalog;
  final bool fromCache;
}

/// One row of the Requests list: a request still on the phone ([draft]) or
/// one the server holds ([remote]) — with the operations about it still on
/// the phone, so its state never claims more than is true.
class RequestEntry {
  const RequestEntry({
    required this.state,
    this.remote,
    this.draft,
    this.pendingOps = const [],
    this.failedOps = const [],
  });

  final SyncState state;
  final RemoteRequest? remote;
  final RequestDraft? draft;
  final List<RequestOp> pendingOps;
  final List<RequestOp> failedOps;

  String get key => remote?.id ?? draft!.id;

  DateTime get sortTime => remote?.receivedAt ?? draft!.createdAt;

  /// The quantity a worker's still-unsent edit will set, or null.
  double? pendingQuantity(String lineId) {
    double? last;
    for (final o in pendingOps) {
      if (o.kind == OpKind.quantity && o.lineId == lineId) last = o.quantity;
    }
    return last;
  }

  bool cancelPending(String lineId) =>
      pendingOps.any((o) => o.kind == OpKind.cancelRequest || (o.kind == OpKind.cancelLine && o.lineId == lineId));
}

class RequestsView {
  const RequestsView({required this.entries, this.fetchedAt, this.fromCache = false, this.error});

  /// Newest first.
  final List<RequestEntry> entries;

  /// When the server's list was read (now, or the cached copy's time).
  final DateTime? fetchedAt;
  final bool fromCache;

  /// Why the server could not be read just now; null when it was.
  final Object? error;
}

/// Thrown by [RequestsApi.send] for a draft the server would refuse.
class DraftInvalid implements Exception {
  const DraftInvalid(this.issues);
  final List<DraftIssue> issues;

  @override
  String toString() => 'DraftInvalid($issues)';
}

/// What the Requests screens need. An interface so every controller and
/// screen tests with a fake instead of a database and a server.
abstract interface class RequestsApi {
  Future<RequestReferences> references();

  /// Unsent drafts still being edited, newest first.
  Future<List<RequestDraft>> drafts();
  RequestDraft newDraft();
  Future<void> saveDraft(RequestDraft draft);

  /// Discards an unsent draft and its photos.
  Future<void> deleteDraft(RequestDraft draft);

  /// Files a fresh capture for [draftId]: upright, scaled, compressed, in
  /// app-private storage (never the gallery). Returns the stored path.
  Future<String> keepPhoto(String draftId, String capturedPath);
  Future<void> discardPhoto(String path);

  /// Queues the draft (throws [DraftInvalid] first) and starts sending.
  Future<void> send(RequestDraft draft);

  Future<RequestsView> myRequests();
  Future<void> changeQuantity(RemoteRequest request, RemoteLine line, double quantity);
  Future<void> cancelLine(RemoteRequest request, RemoteLine line);
  Future<void> cancelRequest(RemoteRequest request);

  /// A refused draft back to editing (spec §3: an offline draft whose
  /// destination closed stays visible for resolution).
  Future<void> returnToDrafts(String draftId);

  /// Forgets a refused operation the worker has read.
  Future<void> dismissFailed(RequestOp op);

  Future<String?> photoUrl(String path);
}
```

`lib/requests/data/request_repository.dart`:

```dart
import 'dart:async';
import 'dart:io';

import '../../attendance/device/device_bridge.dart';
import '../../attendance/domain/event_id.dart';
import '../../attendance/sync/upload_scheduler.dart';
import '../domain/remote_request.dart';
import '../domain/request_draft.dart';
import '../domain/request_models.dart';
import '../domain/request_op.dart';
import '../domain/request_status.dart';
import 'request_remote.dart';
import 'requests_api.dart';
import 'requests_db.dart';

/// Offline-first requests (spec §4E). Drafting, sending and editing all
/// happen on the phone first; the queue reaches the server whenever there is
/// signal, from the app or from the background task.
class RequestRepository implements RequestsApi {
  RequestRepository({
    required this.db,
    required this.remote,
    required this.device,
    required this.scheduler,
    required this.currentWorkerId,
    required this.photoDir,
    this.sendNow,
    DateTime Function()? now,
    String Function()? newId,
  })  : _now = now ?? DateTime.now,
        _newId = newId ?? newEventId;

  final RequestsDb db;
  final RequestRemote remote;
  final DeviceBridge device;

  /// The same WorkManager work as attendance: one background drain sends both.
  final UploadScheduler scheduler;

  /// The worker the app let in, or '' — the scope of EVERY read and write.
  final String Function() currentWorkerId;

  /// App-private folder for request photos (never the gallery).
  final Future<Directory> Function() photoDir;

  /// Drains the queue now in the live app (main.dart); null in tests.
  final Future<void> Function()? sendNow;
  final DateTime Function() _now;
  final String Function() _newId;

  String _worker() {
    final w = currentWorkerId();
    // Nothing may be read or queued under nobody.
    if (w.isEmpty) throw StateError('AUTH_REQUIRED');
    return w;
  }

  Future<void> _kick() async {
    try {
      await scheduler.enqueue('requests');
    } catch (_) {
      // Queued on disk; the periodic sweeper is the backstop.
    }
    final now = sendNow;
    if (now != null) unawaited(now().catchError((Object _) {}));
  }

  // ── choices ────────────────────────────────────────────────────────────

  @override
  Future<RequestReferences> references() async {
    final w = _worker();
    try {
      final destinations = await remote.destinations();
      final teams = await remote.myTeams();
      final catalog = await remote.catalog();
      final at = _now();
      await db.putCache(w, 'destinations', [for (final d in destinations) d.toRow()], at);
      await db.putCache(w, 'teams', [for (final t in teams) t.toRow()], at);
      await db.putCache(w, 'catalog', [for (final c in catalog) c.toRow()], at);
      return RequestReferences(destinations: destinations, teams: teams, catalog: catalog);
    } catch (_) {
      final d = await db.cache(w, 'destinations');
      final t = await db.cache(w, 'teams');
      final c = await db.cache(w, 'catalog');
      if (d == null || t == null || c == null) rethrow;
      List<Map<String, dynamic>> rows(Object? body) => [for (final r in body as List<dynamic>) Map<String, dynamic>.from(r as Map)];
      return RequestReferences(
        destinations: rows(d.body).map(Destination.fromRow).toList(),
        teams: rows(t.body).map(MyTeam.fromRow).toList(),
        catalog: rows(c.body).map(CatalogItem.fromRow).whereType<CatalogItem>().toList(),
        fromCache: true,
      );
    }
  }

  // ── drafts ─────────────────────────────────────────────────────────────

  @override
  Future<List<RequestDraft>> drafts() async => db.drafts(_worker(), queued: false);

  @override
  RequestDraft newDraft() => RequestDraft(id: _newId(), createdAt: _now());

  @override
  Future<void> saveDraft(RequestDraft draft) async => db.saveDraft(_worker(), draft, _now());

  @override
  Future<void> deleteDraft(RequestDraft draft) async {
    await db.deleteDraft(_worker(), draft.id);
    for (final l in draft.lines) {
      for (final p in l.photos) {
        await discardPhoto(p);
      }
    }
  }

  @override
  Future<String> keepPhoto(String draftId, String capturedPath) async {
    final dir = Directory('${(await photoDir()).path}${Platform.pathSeparator}$draftId');
    await dir.create(recursive: true);
    // No caption: a request photo shows the item, not a time stamp.
    return device.preparePhoto(
      source: capturedPath,
      target: '${dir.path}${Platform.pathSeparator}${_newId()}.jpg',
      caption: '',
    );
  }

  @override
  Future<void> discardPhoto(String path) async {
    try {
      await File(path).delete();
    } catch (_) {
      // Already gone.
    }
  }

  @override
  Future<void> send(RequestDraft draft) async {
    final issues = draftIssues(draft);
    if (issues.isNotEmpty) throw DraftInvalid(issues);
    final w = _worker();
    final at = _now();
    final ops = <RequestOp>[
      RequestOp(opId: _newId(), workerId: w, kind: OpKind.submit, createdAt: at, draftId: draft.id, body: submitPayload(draft)),
      for (var i = 0; i < draft.lines.length; i++)
        for (final p in draft.lines[i].photos)
          RequestOp(
            opId: _newId(),
            workerId: w,
            kind: OpKind.photo,
            createdAt: at,
            draftId: draft.id,
            linePosition: i,
            body: {'local_path': p, 'photo_id': _newId()},
          ),
    ];
    await db.queueDraft(w, draft, ops, at);
    await _kick();
  }

  // ── the list ───────────────────────────────────────────────────────────

  @override
  Future<RequestsView> myRequests() async {
    final w = _worker();
    List<Map<String, dynamic>>? docs;
    Object? error;
    DateTime? fetchedAt;
    var fromCache = false;
    try {
      docs = await remote.myRequests();
      fetchedAt = _now();
      await db.putCache(w, 'requests', docs, fetchedAt);
    } catch (e) {
      error = e;
      final cached = await db.cache(w, 'requests');
      if (cached != null) {
        docs = [for (final d in cached.body as List<dynamic>) Map<String, dynamic>.from(d as Map)];
        fetchedAt = cached.at;
        fromCache = true;
      }
    }

    final remotes = [for (final d in docs ?? const <Map<String, dynamic>>[]) RemoteRequest.fromJson(d)];
    final remoteIds = {for (final r in remotes) r.id};
    final ops = await db.ops(w);
    final links = await db.links(w);
    final entries = <RequestEntry>[];

    for (final d in await db.drafts(w, queued: true)) {
      final requestId = links[d.id];
      if (requestId != null && remoteIds.contains(requestId)) {
        // The server's copy now shows it. Forget the phone's copy once that
        // copy is FRESH; its photo ops already point at the request.
        if (!fromCache) {
          await db.deleteDraft(w, d.id);
          await db.deleteLink(d.id);
        }
        continue;
      }
      final mine = ops.where((o) => o.draftId == d.id || (requestId != null && o.requestId == requestId)).toList();
      final pending = mine.where((o) => !o.failedPermanently).toList();
      final failed = mine.where((o) => o.failedPermanently).toList();
      final state = failed.isNotEmpty
          ? SyncState.failed
          : (requestId == null || pending.isNotEmpty)
              ? SyncState.pending
              : SyncState.received;
      entries.add(RequestEntry(state: state, draft: d, pendingOps: pending, failedOps: failed));
    }

    for (final r in remotes) {
      final mine = ops.where((o) => o.requestId == r.id).toList();
      final pending = mine.where((o) => !o.failedPermanently).toList();
      final failed = mine.where((o) => o.failedPermanently).toList();
      entries.add(RequestEntry(
        state: remoteState(r, pending: pending.isNotEmpty, failed: failed.isNotEmpty),
        remote: r,
        pendingOps: pending,
        failedOps: failed,
      ));
    }

    entries.sort((a, b) => b.sortTime.compareTo(a.sortTime));
    return RequestsView(entries: entries, fetchedAt: fetchedAt, fromCache: fromCache, error: (docs == null || fromCache) ? error : null);
  }

  // ── changes to received requests ───────────────────────────────────────

  @override
  Future<void> changeQuantity(RemoteRequest request, RemoteLine line, double quantity) async {
    final w = _worker();
    final base = predictedBase(line.version, await db.sendable(w), line.id);
    await db.addOps([
      RequestOp(
        opId: _newId(),
        workerId: w,
        kind: OpKind.quantity,
        createdAt: _now(),
        requestId: request.id,
        lineId: line.id,
        baseVersion: base,
        body: {'quantity': quantity},
      ),
    ]);
    await _kick();
  }

  @override
  Future<void> cancelLine(RemoteRequest request, RemoteLine line) async {
    final w = _worker();
    await db.addOps([
      RequestOp(opId: _newId(), workerId: w, kind: OpKind.cancelLine, createdAt: _now(), requestId: request.id, lineId: line.id),
    ]);
    await _kick();
  }

  @override
  Future<void> cancelRequest(RemoteRequest request) async {
    final w = _worker();
    await db.addOps([RequestOp(opId: _newId(), workerId: w, kind: OpKind.cancelRequest, createdAt: _now(), requestId: request.id)]);
    await _kick();
  }

  // ── refused operations ─────────────────────────────────────────────────

  @override
  Future<void> returnToDrafts(String draftId) async {
    await db.unqueueDraft(_worker(), draftId);
  }

  @override
  Future<void> dismissFailed(RequestOp op) async {
    final stored = await db.op(op.opId);
    // Only this worker's own, and only a refused one: a sendable op is still owed.
    if (stored == null || stored.workerId != _worker() || !stored.failedPermanently) return;
    await db.deleteOp(op.opId);
    final path = stored.localPath;
    if (stored.kind == OpKind.photo && path != null) await discardPhoto(path);
  }

  @override
  Future<String?> photoUrl(String path) async => remote.signedUrl(path);
}
```

- [ ] **Step 4: Run** — `flutter test test/requests` → all pass (46); `flutter analyze lib/requests test/requests` → "No issues found!".

- [ ] **Step 5: Stop — no commit.**

---

### Task 6: Background sending, the camera, and clean photos

**Files:**
- Modify: `lib/attendance/sync/background_sync.dart`, `lib/attendance/sync/sync_host.dart`
- Modify: `android/app/src/main/kotlin/com/dacs/workmate/PhotoPreparer.kt`
- Create: `lib/requests/camera/request_camera_screen.dart`, `lib/requests/requests_services.dart`

**Interfaces:**
- Consumes: `RequestSync`, `SupabaseRequestRemote`, `openDeviceRequestsDb` (Tasks 3–4); `RequestsApi` (Task 5).
- Produces: `AttendanceSyncHost.drainNow() → Future<bool>`; `syncWith` drains attendance then requests; `runBackgroundSync` wakes for either queue; `RequestCameraScreen` (pops the raw capture path or nothing); `typedef TakePhoto`, `realTakePhoto`, `RequestsServices({api, takePhoto = realTakePhoto, changed})`.

Why the same task: `AttendanceSyncHost` exists so only ONE engine refreshes the session token (a second refresher signs the worker out). Requests ride it instead of adding a second WorkManager job.

- [ ] **Step 1: `background_sync.dart`** — make these four edits.

  (a) After `import '../../net/workmate_http_client.dart';` add:

```dart
import '../../requests/data/request_remote.dart';
import '../../requests/data/requests_db.dart';
import '../../requests/sync/request_sync.dart';
```

  (b) Replace

```dart
  final probe = await openDeviceAttendanceDb(singleInstance: false);
  try {
    if (!await probe.hasAnySendable()) return true;
  } finally {
    await probe.close();
  }
```

  with

```dart
  final probe = await openDeviceAttendanceDb(singleInstance: false);
  final requestsProbe = await openDeviceRequestsDb(singleInstance: false);
  try {
    if (!await probe.hasAnySendable() && !await requestsProbe.hasAnySendable()) return true;
  } finally {
    await probe.close();
    await requestsProbe.close();
  }
```

  (c) Replace the doc comment above `Future<bool> syncWith(` with

```dart
/// Refresh the session if needed, then drain this worker's queues: attendance
/// first, then requests (0085). Shared by the background isolate and the live
/// app's [AttendanceSyncHost]. [afterChange] runs when either drain settled at
/// least one row, with the attendance drain's own database.
```

  (d) Replace the body from `final db = await openDeviceAttendanceDb(singleInstance: false);` to the end of the function with

```dart
  final db = await openDeviceAttendanceDb(singleInstance: false);
  final requestsDb = await openDeviceRequestsDb(singleInstance: false);
  try {
    final sync = SubmissionSync(db: db, remote: SupabaseAttendanceRemote(client));
    final result = await sync.drain(workerId);
    // Requests ride the same session and the same task. A request failure
    // never fails attendance: it only asks WorkManager to come back.
    var requestsResult = SyncResult.done;
    var requestsSettled = 0;
    try {
      final requests = RequestSync(db: requestsDb, remote: SupabaseRequestRemote(client));
      requestsResult = await requests.drain(workerId);
      requestsSettled = requests.settled;
    } catch (_) {
      requestsResult = SyncResult.retry;
    }
    if ((sync.settled > 0 || requestsSettled > 0) && afterChange != null) {
      try {
        await afterChange(db, workerId);
      } catch (_) {
        // The rows are sent; telling the screens is best effort.
      }
    }
    return result == SyncResult.done && requestsResult == SyncResult.done;
  } finally {
    await db.close();
    await requestsDb.close();
  }
}
```

  (Keep the two comment lines above `final db = …` — "Own connection: sqflite_android shares …" — unchanged.)

- [ ] **Step 2: `sync_host.dart`** — directly above `/// Concurrent requests share ONE drain: never two at once in this isolate.` add:

```dart
  /// A drain right now, from this isolate (a request was just queued): it
  /// shares the one in flight, if any.
  Future<bool> drainNow() => _run();

```

- [ ] **Step 3: `PhotoPreparer.kt`** — in `prepare(...)` replace the line `        drawCaption(scaled, caption)` with:

```kotlin
        // An empty caption (a request photo, 1a-3) leaves the image clean: no band.
        if (caption.isNotEmpty()) drawCaption(scaled, caption)
```

- [ ] **Step 4: The camera** — create `lib/requests/camera/request_camera_screen.dart`:

```dart
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../attendance/domain/attendance_failure.dart';
import '../../attendance/ui/attendance_copy.dart';
import '../../ui/theme.dart';

/// A photo of the item being requested: BACK camera, no overlay, no caption.
/// Pops the raw capture's path (the repository files it), or nothing.
class RequestCameraScreen extends StatefulWidget {
  const RequestCameraScreen({super.key});

  @override
  State<RequestCameraScreen> createState() => _RequestCameraScreenState();
}

class _RequestCameraScreenState extends State<RequestCameraScreen> with WidgetsBindingObserver {
  CameraController? _camera;
  bool? _granted;
  bool _failed = false;
  bool _capturing = false;
  bool _opening = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _askAndOpen();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _camera?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      final camera = _camera;
      _camera = null;
      camera?.dispose();
      if (mounted) setState(() {});
    } else if (state == AppLifecycleState.resumed) {
      _recheck();
    }
  }

  Future<void> _askAndOpen() async {
    bool granted;
    try {
      granted = (await Permission.camera.request()).isGranted;
    } catch (_) {
      granted = await Permission.camera.isGranted;
    }
    if (!mounted) return;
    setState(() => _granted = granted);
    if (granted) await _open();
  }

  Future<void> _recheck() async {
    if (_granted == null) return;
    final granted = await Permission.camera.isGranted;
    if (!mounted) return;
    setState(() => _granted = granted);
    if (granted && _camera == null) await _open();
  }

  Future<void> _open() async {
    if (_opening) return;
    _opening = true;
    CameraController? controller;
    try {
      final cameras = await availableCameras();
      final back = cameras.firstWhere((c) => c.lensDirection == CameraLensDirection.back, orElse: () => cameras.first);
      controller = CameraController(back, ResolutionPreset.veryHigh, enableAudio: false, imageFormatGroup: ImageFormatGroup.jpeg);
      await controller.initialize();
      if (!mounted || WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
        await controller.dispose();
        return;
      }
      setState(() {
        _camera = controller;
        _failed = false;
      });
    } catch (e) {
      debugPrint('Camera failed to open: $e');
      try {
        await controller?.dispose();
      } catch (_) {}
      if (mounted) setState(() => _failed = true);
    } finally {
      _opening = false;
    }
  }

  Future<void> _shoot() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized || _capturing) return;
    setState(() => _capturing = true);
    try {
      final file = await camera.takePicture();
      if (mounted) Navigator.of(context).pop(file.path);
    } catch (_) {
      if (mounted) setState(() => _capturing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    final ready = camera != null && camera.value.isInitialized;
    return Scaffold(
      backgroundColor: WmColors.previewBackdrop,
      appBar: AppBar(
        backgroundColor: WmColors.previewBackdrop,
        foregroundColor: Colors.white,
        title: const Text('Photo of the item'),
      ),
      body: Column(children: [
        Expanded(
          child: Center(
            child: _granted == false
                ? _message('The camera is needed for the photo. Allow it in Settings.', settings: true)
                : ready
                    ? CameraPreview(camera)
                    : _failed
                        ? _message(failureCopy(AttendanceFailure.unexpected).english)
                        : const CircularProgressIndicator(color: Colors.white),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 18),
          child: Semantics(
            button: true,
            label: 'Take photo',
            child: GestureDetector(
              key: const Key('request-shutter'),
              onTap: ready && !_capturing ? _shoot : null,
              child: Container(
                width: 76,
                height: 76,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: ready && !_capturing ? 1 : 0.3),
                  border: Border.all(color: Colors.white70, width: 4),
                ),
              ),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _message(String text, {bool settings = false}) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70, fontSize: 16)),
          if (settings)
            TextButton(
              onPressed: () => openAppSettings(),
              child: const Text(openSettingsLabel, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
            ),
        ]),
      );
}
```

- [ ] **Step 5: Services** — create `lib/requests/requests_services.dart`:

```dart
import 'package:flutter/material.dart';

import 'camera/request_camera_screen.dart';
import 'data/requests_api.dart';

/// Opens the camera; the raw capture's path, or null when the worker backed out.
typedef TakePhoto = Future<String?> Function(BuildContext context);

Future<String?> realTakePhoto(BuildContext context) => Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const RequestCameraScreen(), fullscreenDialog: true),
    );

/// Everything the Requests screens need, built once in main.dart.
class RequestsServices {
  const RequestsServices({required this.api, this.takePhoto = realTakePhoto, this.changed});

  final RequestsApi api;
  final TakePhoto takePhoto;

  /// Fires when the live app's background drain settled queued operations.
  final Listenable? changed;
}
```

- [ ] **Step 6: Check** — `flutter analyze` → "No issues found!"; `flutter test` → all pass (nothing new is unit-testable here: the camera needs a phone, and `syncWith` needs Supabase — both are covered by the Task 11 device check); Kotlin `:app:testDebugUnitTest` → `BUILD SUCCESSFUL`.

- [ ] **Step 7: Stop — no commit.**

---

### Task 7: Shared list state, Home's summary and card, state chips

**Files:**
- Create: `lib/requests/list/requests_controller.dart`, `lib/requests/home/request_updates.dart`, `lib/requests/home/request_updates_card.dart`, `lib/requests/ui/sync_chip.dart`
- Modify: `test/requests/request_fakes.dart` (add imports + `FakeRequestsApi`)
- Test: `test/requests/list/requests_controller_test.dart`

**Interfaces:**
- Consumes: Tasks 1–5; `StatusPill` (`lib/attendance/ui/status_pill.dart`), `WmColors`.
- Produces: `RequestFilter {all, drafts, pending, attention}`; `RequestsController({api, now})` — `loading`, `view`, `failure`, `filter`, `all` (drafts first), `rows` (filtered), `updates`, `entry(key)`, `setFilter`, `refresh()` (concurrent calls share one read), `dismissFailed(op)`, `returnToDrafts(draftId)`; `RequestUpdates(needsAction, pending, drafts, nextDelivery)` + `summarizeRequests(entries, now)`; `RequestUpdatesCard({updates, onOpen})` (key `request-updates`; nothing shown when empty); `SyncChip(state)`, `UrgentTag({neededBy})`; test fake `FakeRequestsApi`.

One `RequestsController` serves both the Requests tab and Home's card (Task 10), so the two never disagree.

- [ ] **Step 1: Extend the fakes** — in `test/requests/request_fakes.dart` replace the two import lines at the top with:

```dart
import 'package:workmate/requests/data/request_remote.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/domain/quantity.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_models.dart';
import 'package:workmate/requests/domain/request_op.dart';
```

  and append at the end of the file:

```dart

/// A RequestsApi for controllers and screens: in-memory, recording calls.
class FakeRequestsApi implements RequestsApi {
  RequestReferences refs = const RequestReferences(destinations: [site, fence], teams: [masonry], catalog: [pipe, drill]);
  Object? refsError;
  RequestsView view = const RequestsView(entries: []);
  Object? viewError;
  final savedDrafts = <String, RequestDraft>{};
  final sent = <RequestDraft>[];
  Object? sendError;
  final calls = <String>[];
  final discarded = <String>[];
  var _ids = 0;

  @override
  Future<RequestReferences> references() async {
    if (refsError != null) throw refsError!;
    return refs;
  }

  @override
  Future<List<RequestDraft>> drafts() async => savedDrafts.values.toList();

  @override
  RequestDraft newDraft() => RequestDraft(id: 'd${++_ids}', createdAt: DateTime.utc(2026, 10, 5, 1));

  @override
  Future<void> saveDraft(RequestDraft draft) async => savedDrafts[draft.id] = draft;

  @override
  Future<void> deleteDraft(RequestDraft draft) async {
    calls.add('deleteDraft:${draft.id}');
    savedDrafts.remove(draft.id);
  }

  @override
  Future<String> keepPhoto(String draftId, String capturedPath) async => '/kept/$draftId/${++_ids}.jpg';

  @override
  Future<void> discardPhoto(String path) async => discarded.add(path);

  @override
  Future<void> send(RequestDraft draft) async {
    if (sendError != null) throw sendError!;
    final issues = draftIssues(draft);
    if (issues.isNotEmpty) throw DraftInvalid(issues);
    sent.add(draft);
    savedDrafts.remove(draft.id);
  }

  @override
  Future<RequestsView> myRequests() async {
    if (viewError != null) throw viewError!;
    return view;
  }

  @override
  Future<void> changeQuantity(RemoteRequest request, RemoteLine line, double quantity) async =>
      calls.add('quantity:${line.id}:${formatQuantity(quantity)}');

  @override
  Future<void> cancelLine(RemoteRequest request, RemoteLine line) async => calls.add('cancelLine:${line.id}');

  @override
  Future<void> cancelRequest(RemoteRequest request) async => calls.add('cancelRequest:${request.id}');

  @override
  Future<void> returnToDrafts(String draftId) async => calls.add('returnToDrafts:$draftId');

  @override
  Future<void> dismissFailed(RequestOp op) async => calls.add('dismiss:${op.opId}');

  @override
  Future<String?> photoUrl(String path) async => null;
}
```

- [ ] **Step 2: Write the failing test** — create `test/requests/list/requests_controller_test.dart`:

```dart
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_failure.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/requests/home/request_updates.dart';
import 'package:workmate/requests/home/request_updates_card.dart';
import 'package:workmate/requests/list/requests_controller.dart';
import 'package:workmate/ui/theme.dart';

import '../domain/request_models_test.dart' show requestDoc;
import '../request_fakes.dart';

RequestEntry remoteEntry(String id, SyncState state, {bool conflict = false}) {
  final doc = requestDoc(id: id);
  if (conflict) (doc['lines'] as List).first['has_conflict'] = true;
  return RequestEntry(state: state, remote: RemoteRequest.fromJson(doc));
}

void main() {
  late FakeRequestsApi api;
  final now = DateTime.utc(2026, 10, 5, 2); // Mon 5 Oct, 10:00 Manila

  setUp(() => api = FakeRequestsApi());

  test('drafts come first, then the server\'s list, and filters narrow it', () async {
    api.savedDrafts['d9'] = RequestDraft(id: 'd9', createdAt: DateTime.utc(2026, 10, 4));
    api.view = RequestsView(entries: [
      remoteEntry('r1', SyncState.received),
      remoteEntry('r2', SyncState.pending),
      remoteEntry('r3', SyncState.needsResolution, conflict: true),
      remoteEntry('r4', SyncState.failed),
    ]);
    final c = RequestsController(api: api, now: () => now);
    await c.refresh();
    expect(c.loading, isFalse);
    expect(c.rows.map((e) => e.key), ['d9', 'r1', 'r2', 'r3', 'r4']);
    c.setFilter(RequestFilter.drafts);
    expect(c.rows.map((e) => e.key), ['d9']);
    c.setFilter(RequestFilter.pending);
    expect(c.rows.map((e) => e.key), ['r2']);
    c.setFilter(RequestFilter.attention);
    expect(c.rows.map((e) => e.key), ['r3', 'r4']);
    expect(c.entry('r2')!.state, SyncState.pending);
    expect(c.updates.needsAction, 2);
    expect(c.updates.pending, 1);
    expect(c.updates.drafts, 1);
    expect(c.updates.nextDelivery, '2026-10-14');
  });

  test('no signal: the phone\'s copy stays, with the reason', () async {
    api.view = RequestsView(entries: [remoteEntry('r1', SyncState.received)], fromCache: true, error: const SocketException('down'));
    final c = RequestsController(api: api, now: () => now);
    await c.refresh();
    expect(c.failure, RequestFailure.noConnection);
    expect(c.rows.single.key, 'r1');
  });

  test('a read that fails outright is a failure, not an empty list', () async {
    api.viewError = StateError('AUTH_REQUIRED');
    final c = RequestsController(api: api, now: () => now);
    await c.refresh();
    expect(c.failure, RequestFailure.sessionExpired);
  });

  test('summary counts and the next delivery', () {
    final u = summarizeRequests([remoteEntry('r1', SyncState.received)], now);
    expect(u.isEmpty, isFalse);
    expect(u.nextDelivery, '2026-10-14');
    expect(summarizeRequests(const [], now).isEmpty, isTrue);
  });

  testWidgets('Home\'s card says what needs the worker and opens Requests', (tester) async {
    var opened = 0;
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(
        body: RequestUpdatesCard(
          updates: const RequestUpdates(needsAction: 1, pending: 2, drafts: 1, nextDelivery: '2026-10-14'),
          onOpen: () => opened++,
        ),
      ),
    ));
    expect(find.text('1 needs your attention'), findsOneWidget);
    expect(find.text('2 waiting for signal'), findsOneWidget);
    expect(find.text('1 draft not sent'), findsOneWidget);
    expect(find.text('Next delivery Wed 14 Oct'), findsOneWidget);
    await tester.tap(find.byKey(const Key('request-updates')));
    expect(opened, 1);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: RequestUpdatesCard(updates: const RequestUpdates(), onOpen: () {}))));
    expect(find.byKey(const Key('request-updates')), findsNothing);
  });
}
```

- [ ] **Step 3: Run it to verify it fails** — compile errors.

- [ ] **Step 4: Write the code.**

`lib/requests/home/request_updates.dart`:

```dart
import '../data/requests_api.dart';
import '../domain/request_status.dart';

/// What Home says about requests (spec §5: "request updates and pending
/// actions"): what needs the worker, what is still on the phone, and the
/// next expected delivery.
class RequestUpdates {
  const RequestUpdates({this.needsAction = 0, this.pending = 0, this.drafts = 0, this.nextDelivery});

  /// Refused (Failed) or waiting on the office (Needs resolution).
  final int needsAction;

  /// Sent from this phone, not yet received by the office.
  final int pending;
  final int drafts;

  /// "2026-10-14", or null.
  final String? nextDelivery;

  bool get isEmpty => needsAction == 0 && pending == 0 && drafts == 0 && nextDelivery == null;
}

RequestUpdates summarizeRequests(List<RequestEntry> entries, DateTime now) => RequestUpdates(
      needsAction: entries.where((e) => e.state == SyncState.failed || e.state == SyncState.needsResolution).length,
      pending: entries.where((e) => e.state == SyncState.pending).length,
      drafts: entries.where((e) => e.state == SyncState.draft).length,
      nextDelivery: nextDelivery([for (final e in entries) ?e.remote], now),
    );
```

`lib/requests/list/requests_controller.dart`:

```dart
import 'package:flutter/foundation.dart';

import '../data/requests_api.dart';
import '../domain/request_draft.dart';
import '../domain/request_failure.dart';
import '../domain/request_op.dart';
import '../domain/request_status.dart';
import '../home/request_updates.dart';

enum RequestFilter { all, drafts, pending, attention }

/// The Requests tab and Home's request card share this one controller, so
/// both always tell the same story.
class RequestsController extends ChangeNotifier {
  RequestsController({required RequestsApi api, DateTime Function()? now})
      : _api = api,
        now = now ?? DateTime.now;

  final RequestsApi _api;
  final DateTime Function() now;

  bool _loading = true;
  bool _disposed = false;
  RequestsView? _view;
  List<RequestDraft> _drafts = const [];
  RequestFailure? _failure;
  RequestFilter _filter = RequestFilter.all;
  Future<void>? _inFlight;

  bool get loading => _loading;
  RequestsView? get view => _view;
  RequestFilter get filter => _filter;

  /// Why the server could not be read; the list may still show the phone's copy.
  RequestFailure? get failure => _failure;

  /// Drafts first (newest first), then everything else newest first.
  List<RequestEntry> get all => [
        for (final d in _drafts) RequestEntry(state: SyncState.draft, draft: d),
        ...?_view?.entries,
      ];

  List<RequestEntry> get rows => all.where((e) => switch (_filter) {
        RequestFilter.all => true,
        RequestFilter.drafts => e.state == SyncState.draft,
        RequestFilter.pending => e.state == SyncState.pending,
        RequestFilter.attention => e.state == SyncState.failed || e.state == SyncState.needsResolution,
      }).toList();

  RequestUpdates get updates => summarizeRequests(all, now());

  RequestEntry? entry(String key) => all.where((e) => e.key == key).firstOrNull;

  void setFilter(RequestFilter f) {
    if (f == _filter) return;
    _filter = f;
    _notify();
  }

  /// Concurrent calls share one read.
  Future<void> refresh() => _inFlight ??= _load().whenComplete(() => _inFlight = null);

  Future<void> _load() async {
    try {
      final drafts = await _api.drafts();
      final view = await _api.myRequests();
      _drafts = drafts;
      _view = view;
      _failure = view.error == null ? null : RequestFailure.of(view.error!);
    } catch (e) {
      _failure = RequestFailure.of(e);
    } finally {
      _loading = false;
      _notify();
    }
  }

  Future<void> dismissFailed(RequestOp op) async {
    await _api.dismissFailed(op);
    await refresh();
  }

  Future<void> returnToDrafts(String draftId) async {
    await _api.returnToDrafts(draftId);
    await refresh();
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

`lib/requests/ui/sync_chip.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/status_pill.dart';
import '../../ui/theme.dart';
import '../domain/request_status.dart';
import 'requests_copy.dart';

/// The design's state colours: grey draft, brown waiting, green received,
/// red for anything that needs someone.
class SyncChip extends StatelessWidget {
  const SyncChip(this.state, {super.key});
  final SyncState state;

  static const _draftFg = Color(0xFF5F5F5B);

  @override
  Widget build(BuildContext context) => switch (state) {
        SyncState.draft => StatusPill(syncLabel(state), background: WmColors.inert, foreground: _draftFg),
        SyncState.pending => StatusPill.brown(syncLabel(state)),
        SyncState.received => StatusPill.green(syncLabel(state)),
        SyncState.failed || SyncState.needsResolution =>
          StatusPill(syncLabel(state), background: WmColors.dangerTint, foreground: WmColors.danger),
      };
}

/// "URGENT · by Wed 7 Oct".
class UrgentTag extends StatelessWidget {
  const UrgentTag({super.key, this.neededBy});
  final String? neededBy;

  @override
  Widget build(BuildContext context) => StatusPill(
        neededBy == null ? 'URGENT' : 'URGENT · by ${calendarDay(neededBy!)}',
        background: WmColors.dangerTint,
        foreground: WmColors.danger,
      );
}
```

`lib/requests/home/request_updates_card.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../domain/request_status.dart';
import 'request_updates.dart';

/// Home's request card (spec §5): what needs the worker first, then what is
/// still on the phone, then the next delivery. Nothing to say → nothing shown.
class RequestUpdatesCard extends StatelessWidget {
  const RequestUpdatesCard({super.key, required this.updates, required this.onOpen});

  final RequestUpdates updates;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final u = updates;
    if (u.isEmpty) return const SizedBox.shrink();
    final lines = <(IconData, String, Color)>[
      if (u.needsAction > 0) (Icons.report_outlined, '${u.needsAction} need${u.needsAction == 1 ? 's' : ''} your attention', WmColors.danger),
      if (u.pending > 0) (Icons.cloud_off, '${u.pending} waiting for signal', WmColors.brown),
      if (u.drafts > 0) (Icons.edit_note, '${u.drafts} draft${u.drafts == 1 ? '' : 's'} not sent', WmColors.textSecondary),
      if (u.nextDelivery != null) (Icons.local_shipping_outlined, 'Next delivery ${calendarDay(u.nextDelivery!)}', WmColors.green),
    ];
    return InkWell(
      key: const Key('request-updates'),
      onTap: onOpen,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: WmColors.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Row(children: [
            Expanded(child: Text('Requests', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            Icon(Icons.chevron_right, color: WmColors.textMuted),
          ]),
          const SizedBox(height: 6),
          for (final (icon, text, color) in lines)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(children: [
                Icon(icon, size: 18, color: color),
                const SizedBox(width: 8),
                Expanded(child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w600))),
              ]),
            ),
        ]),
      ),
    );
  }
}
```

- [ ] **Step 5: Run** — `flutter test test/requests` → all pass; `flutter analyze lib/requests test/requests` → "No issues found!".

- [ ] **Step 6: Stop — no commit.**

---

### Task 8: New request and the item editor

**Files:**
- Create: `lib/requests/compose/compose_controller.dart`, `lib/requests/compose/item_editor_screen.dart`, `lib/requests/compose/compose_screen.dart`
- Test: `test/requests/compose/compose_test.dart`

**Interfaces:**
- Consumes: Tasks 1–7; `FailureNotice`, `noticeAction` (`lib/ui/failure_notice.dart`), `retryLabel`, `monoLabel`, `newEventId()`.
- Produces: `ComposeController({api, draft})` — `load`, `setDestination`, `setTeam(MyTeam?)` (clears members not in the new team), `putLine`, `removeLine` (discards its photos), `setNote`, `send() → bool`, `discard`, `issues`, `sendFailure`, `refsFailure`, `team`, `iLead`, `destinationClosed`; `ItemEdit.save(line)` / `ItemEdit.remove()`; `ItemEditorScreen(...)`, `maxPhotosPerItem = 3`; `ComposeScreen({draft, services, now})` (pops `true` when queued). Widget keys used by tests: `choose-destination`, `dest-<workId>`, `team-none`, `team-<id>`, `add-item`, `line-<i>`, `request-note`, `send-request`, `draft-delete`, `item-search`, `catalog-<id>`, `describe-item`, `item-change`, `item-name`, `item-spec`, `item-unit`, `item-category`, `item-quantity`, `item-member`, `item-urgent`, `item-reason`, `item-needed-by`, `item-notes`, `item-add-photo`, `item-save`.

Every change is saved on the phone at once (`saveDraft`), so a closed app or a dead battery never loses a typed item.

- [ ] **Step 1: Write the failing test** — create `test/requests/compose/compose_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/requests/compose/compose_controller.dart';
import 'package:workmate/requests/compose/compose_screen.dart';
import 'package:workmate/requests/compose/item_editor_screen.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_failure.dart';
import 'package:workmate/requests/domain/request_models.dart';
import 'package:workmate/requests/requests_services.dart';
import 'package:workmate/ui/theme.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../request_fakes.dart';

/// Scrolls the item editor's list until [key] is on screen, then taps it.
Future<void> tapKey(WidgetTester tester, String key) async {
  final f = find.byKey(Key(key));
  final list = find.descendant(of: find.byType(ItemEditorScreen), matching: find.byType(Scrollable)).first;
  await tester.scrollUntilVisible(f, 200, scrollable: list);
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  late FakeRequestsApi api;
  setUp(() => api = FakeRequestsApi());

  group('ComposeController', () {
    test('every change is saved on the phone at once', () async {
      final c = ComposeController(api: api, draft: api.newDraft());
      await c.load();
      await c.setDestination(fence);
      await c.putLine(DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '4'));
      expect(api.savedDrafts.values.single.destination, fence);
      expect(api.savedDrafts.values.single.lines.single.quantity, '4');
    });

    test('changing the team clears members of the old team', () async {
      final c = ComposeController(api: api, draft: api.newDraft());
      await c.load();
      await c.setTeam(masonry);
      expect(c.iLead, isTrue);
      await c.putLine(DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '4', memberId: 'u2', memberName: 'Pedro'));
      await c.setTeam(null);
      expect(c.draft.lines.single.memberId, isNull);
      expect(c.iLead, isFalse);
    });

    test('Send checks first and names what to fix', () async {
      final c = ComposeController(api: api, draft: api.newDraft());
      await c.load();
      expect(await c.send(), isFalse);
      expect(c.issues, contains(const DraftIssue(DraftIssueKind.noDestination)));
      expect(api.sent, isEmpty);
      await c.setDestination(site);
      expect(c.issues, isEmpty, reason: 'any change clears the old list');
      await c.putLine(DraftLine.fromCatalog('x1', pipe).copyWith(quantity: '10'));
      expect(await c.send(), isTrue);
      expect(api.sent.single.lines.single.catalogItemId, 'c1');
    });

    test('a removed item takes its photos with it', () async {
      final c = ComposeController(api: api, draft: api.newDraft());
      await c.putLine(DraftLine.fromCatalog('x1', pipe).copyWith(photos: ['/p/a.jpg']));
      await c.removeLine('x1');
      expect(c.draft.lines, isEmpty);
      expect(api.discarded, ['/p/a.jpg']);
    });

    test('a destination the server no longer offers is flagged (fresh lists only)', () async {
      final c = ComposeController(api: api, draft: api.newDraft().copyWith(destination: site));
      api.refs = const RequestReferences(destinations: [fence], teams: [], catalog: []);
      await c.load();
      expect(c.destinationClosed, isTrue);
      api.refs = const RequestReferences(destinations: [fence], teams: [], catalog: [], fromCache: true);
      await c.load();
      expect(c.destinationClosed, isFalse);
    });

    test('no lists and no copy: a failure to show, with retry', () async {
      api.refsError = StateError('AUTH_REQUIRED');
      final c = ComposeController(api: api, draft: api.newDraft());
      await c.load();
      expect(c.refsFailure, RequestFailure.sessionExpired);
    });
  });

  group('ComposeScreen', () {
    Future<NavigatorState> show(WidgetTester tester, RequestDraft draft, List<Object?> popped) async {
      useTallPhone(tester);
      final nav = GlobalKey<NavigatorState>();
      await tester.pumpWidget(MaterialApp(
        navigatorKey: nav,
        theme: workMateTheme(),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async => popped.add(await Navigator.of(context).push<bool>(MaterialPageRoute(
                builder: (_) => ComposeScreen(
                  draft: draft,
                  services: RequestsServices(api: api, takePhoto: (_) async => '/raw/shot.jpg'),
                  now: () => DateTime(2026, 10, 5),
                ),
              ))),
              child: const Text('open'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      return nav.currentState!;
    }

    testWidgets('project → team → an item from the list → Send', (tester) async {
      final popped = <Object?>[];
      await show(tester, api.newDraft(), popped);
      await tester.tap(find.byKey(const Key('choose-destination')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('dest-f9')));
      await tester.pumpAndSettle();
      expect(find.text('AW-03 Fence'), findsOneWidget);

      await tester.tap(find.byKey(const Key('team-t1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('add-item')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('item-search')), 'pvc');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('catalog-c1')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('item-quantity')), '12');
      await tester.tap(find.byKey(const Key('item-member')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pedro').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('item-add-photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('item-save')));
      await tester.pumpAndSettle();

      expect(find.text('PVC pipe'), findsOneWidget);
      expect(find.textContaining('For Pedro'), findsOneWidget);
      await tester.tap(find.byKey(const Key('send-request')));
      await tester.pumpAndSettle();

      expect(popped, [true]);
      final sent = api.sent.single;
      expect(sent.destination, fence);
      expect(sent.teamId, 't1');
      expect(sent.lines.single.quantity, '12');
      expect(sent.lines.single.memberId, 'u2');
      expect(sent.lines.single.photos.single, startsWith('/kept/'));
    });

    testWidgets('an unlisted item is described, and urgency needs a reason and a date', (tester) async {
      final popped = <Object?>[];
      await show(tester, api.newDraft().copyWith(destination: site), popped);
      await tester.tap(find.byKey(const Key('add-item')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('item-search')), 'elbow 45');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('describe-item')));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byKey(const Key('item-name'))).controller!.text, 'elbow 45');
      await tester.enterText(find.byKey(const Key('item-unit')), 'pc');
      await tester.enterText(find.byKey(const Key('item-quantity')), '3');
      await tapKey(tester, 'item-urgent');
      await tapKey(tester, 'item-save');
      expect(find.text('Say why it is urgent.'), findsOneWidget);
      expect(find.text('Pick the date it is needed by.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('item-reason')), 'Leak at the kitchen');
      await tapKey(tester, 'item-needed-by');
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tapKey(tester, 'item-save');
      expect(find.textContaining('Not in the list'), findsOneWidget);
      expect(find.textContaining('URGENT'), findsOneWidget);
      final line = api.savedDrafts.values.single.lines.single;
      expect(line.catalogItemId, isNull);
      expect(line.neededBy, '2026-10-05');
      expect(line.kind, ItemKind.material);
    });

    testWidgets('Send with nothing chosen says what is missing', (tester) async {
      await show(tester, api.newDraft(), []);
      await tester.tap(find.byKey(const Key('send-request')));
      await tester.pumpAndSettle();
      expect(find.text('Choose the project and the work.'), findsOneWidget);
      expect(find.text('Add at least one item.'), findsOneWidget);
      expect(api.sent, isEmpty);
    });

    testWidgets('no project open: the worker is told, not shown an empty picker', (tester) async {
      api.refs = const RequestReferences(destinations: [], teams: [], catalog: []);
      await show(tester, api.newDraft(), []);
      expect(find.textContaining('No project is open for requests'), findsOneWidget);
    });
  });
}
```

- [ ] **Step 2: Run it to verify it fails** — compile errors.

- [ ] **Step 3: Write the code.**

`lib/requests/compose/compose_controller.dart`:

```dart
import 'package:flutter/foundation.dart';

import '../data/requests_api.dart';
import '../domain/request_draft.dart';
import '../domain/request_failure.dart';
import '../domain/request_models.dart';

/// One draft being written. Every change is saved on the phone at once, so
/// closing the app or losing signal never loses a typed item (spec §4E).
class ComposeController extends ChangeNotifier {
  ComposeController({required RequestsApi api, required RequestDraft draft})
      : _api = api,
        _draft = draft;

  final RequestsApi _api;
  RequestDraft _draft;
  RequestReferences? _refs;
  RequestFailure? _refsFailure;
  bool _loading = true;
  List<DraftIssue> _issues = const [];
  bool _sending = false;
  RequestFailure? _sendFailure;
  bool _disposed = false;

  RequestDraft get draft => _draft;
  RequestReferences? get refs => _refs;
  RequestFailure? get refsFailure => _refsFailure;
  bool get loading => _loading;

  /// Shown after a Send that was refused on the phone; cleared by any change.
  List<DraftIssue> get issues => _issues;
  bool get sending => _sending;
  RequestFailure? get sendFailure => _sendFailure;

  MyTeam? get team => _refs?.teams.where((t) => t.id == _draft.teamId).firstOrNull;

  /// Naming another member needs the leader of THIS team (spec §3).
  bool get iLead => team?.iLead ?? false;

  /// The chosen place is no longer offered by the server (completed, closed).
  /// Only claimed from a fresh list: a cached one may simply be old.
  bool get destinationClosed {
    final refs = _refs;
    final d = _draft.destination;
    return refs != null && !refs.fromCache && d != null && !refs.destinations.contains(d);
  }

  Future<void> load() async {
    _loading = true;
    _notify();
    try {
      _refs = await _api.references();
      _refsFailure = null;
    } catch (e) {
      _refsFailure = RequestFailure.of(e);
    } finally {
      _loading = false;
      _notify();
    }
  }

  Future<void> setDestination(Destination d) => _change(_draft.copyWith(destination: d));

  /// A member chosen for another team (or with no team) is cleared: the server
  /// accepts only members of the request's own team.
  Future<void> setTeam(MyTeam? t) {
    final keep = {for (final m in t?.members ?? const <TeamMember>[]) m.id};
    return _change(_draft.copyWith(
      teamId: t?.id,
      teamName: t?.name,
      lines: [
        for (final l in _draft.lines) keep.contains(l.memberId) ? l : l.copyWith(memberId: null, memberName: null),
      ],
    ));
  }

  /// Adds the line, or replaces the one with the same id.
  Future<void> putLine(DraftLine line) {
    final i = _draft.lines.indexWhere((l) => l.id == line.id);
    final lines = [..._draft.lines];
    if (i < 0) {
      lines.add(line);
    } else {
      lines[i] = line;
    }
    return _change(_draft.copyWith(lines: lines));
  }

  Future<void> removeLine(String id) async {
    final line = _draft.lines.where((l) => l.id == id).firstOrNull;
    if (line == null) return;
    await _change(_draft.copyWith(lines: _draft.lines.where((l) => l.id != id).toList()));
    for (final p in line.photos) {
      await _api.discardPhoto(p);
    }
  }

  Future<void> setNote(String note) => _change(_draft.copyWith(note: note));

  Future<void> _change(RequestDraft next) async {
    _draft = next;
    _issues = const [];
    _sendFailure = null;
    _notify();
    await _api.saveDraft(next);
  }

  /// True once the draft is queued (the screen then closes). False when
  /// something must be fixed first — [issues] or [sendFailure] say what.
  Future<bool> send() async {
    final issues = draftIssues(_draft);
    if (issues.isNotEmpty) {
      _issues = issues;
      _notify();
      return false;
    }
    _sending = true;
    _notify();
    try {
      await _api.send(_draft);
      return true;
    } on DraftInvalid catch (e) {
      _issues = e.issues;
      return false;
    } catch (e) {
      _sendFailure = RequestFailure.of(e);
      return false;
    } finally {
      _sending = false;
      _notify();
    }
  }

  Future<void> discard() => _api.deleteDraft(_draft);

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

`lib/requests/compose/item_editor_screen.dart`:

```dart
import 'dart:io';

import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../domain/quantity.dart';
import '../domain/request_draft.dart';
import '../domain/request_models.dart';
import '../domain/request_status.dart';
import '../requests_services.dart';
import '../ui/requests_copy.dart';

/// Up to this many photos per item: enough to show the part, small enough
/// to send on a weak site connection.
const maxPhotosPerItem = 3;

/// The answer of the item editor: the edited line, or a request to remove it.
class ItemEdit {
  const ItemEdit.save(DraftLine this.line) : remove = false;
  const ItemEdit.remove()
      : line = null,
        remove = true;
  final DraftLine? line;
  final bool remove;
}

/// One item: pick it from the office's list, or describe it when it is
/// missing (spec §4A: the request still goes through; the office matches it).
class ItemEditorScreen extends StatefulWidget {
  const ItemEditorScreen({
    super.key,
    required this.line,
    required this.isNew,
    required this.catalog,
    required this.team,
    required this.iLead,
    required this.draftId,
    required this.services,
    this.now = DateTime.now,
  });

  final DraftLine line;
  final bool isNew;
  final List<CatalogItem> catalog;

  /// The request's team (null for an individual request).
  final MyTeam? team;
  final bool iLead;
  final String draftId;
  final RequestsServices services;
  final DateTime Function() now;

  @override
  State<ItemEditorScreen> createState() => _ItemEditorScreenState();
}

class _ItemEditorScreenState extends State<ItemEditorScreen> {
  late DraftLine _line = widget.line;
  late final _search = TextEditingController();
  late final _description = TextEditingController(text: widget.line.description);
  late final _spec = TextEditingController(text: widget.line.spec);
  late final _unit = TextEditingController(text: widget.line.unit);
  late final _category = TextEditingController(text: widget.line.category);
  late final _quantity = TextEditingController(text: widget.line.quantity);
  late final _reason = TextEditingController(text: widget.line.urgentReason);
  late final _notes = TextEditingController(text: widget.line.notes);
  late bool _describing = !widget.line.fromCatalog && widget.line.description.isNotEmpty;
  bool _tried = false;
  bool _addingPhoto = false;

  @override
  void dispose() {
    for (final c in [_search, _description, _spec, _unit, _category, _quantity, _reason, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  DraftLine get _current => _line.copyWith(
        description: _description.text,
        spec: _spec.text,
        unit: _unit.text,
        category: _category.text,
        quantity: _quantity.text,
        urgentReason: _reason.text,
        notes: _notes.text,
      );

  List<DraftIssueKind> get _problems {
    final l = _current;
    return [
      if (l.description.trim().isEmpty) DraftIssueKind.noDescription,
      if (l.unit.trim().isEmpty) DraftIssueKind.noUnit,
      if (parseQuantity(l.quantity) == null) DraftIssueKind.badQuantity,
      if (l.urgent && l.urgentReason.trim().isEmpty) DraftIssueKind.urgentNeedsReason,
      if (l.urgent && l.neededBy == null) DraftIssueKind.urgentNeedsDate,
    ];
  }

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
        // A tool's responsible person is named at issue, not here (spec §4A).
        memberId: picked.kind == ItemKind.tool ? null : _line.memberId,
        memberName: picked.kind == ItemKind.tool ? null : _line.memberName,
      );
      _description.text = picked.description;
      _spec.text = picked.spec;
      _unit.text = picked.unit;
      _category.text = picked.category;
      _describing = false;
    });
  }

  /// Back to the list to pick another item.
  void _unpick() => setState(() {
        _line = _current.copyWith(catalogItemId: null);
        _describing = false;
      });

  Future<void> _pickDate() async {
    final now = widget.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 1, now.month, now.day),
      initialDate: DateTime(now.year, now.month, now.day),
    );
    if (picked == null) return;
    final iso = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    setState(() => _line = _current.copyWith(neededBy: iso));
  }

  Future<void> _addPhoto() async {
    setState(() => _addingPhoto = true);
    try {
      final raw = await widget.services.takePhoto(context);
      if (raw == null) return;
      final kept = await widget.services.api.keepPhoto(widget.draftId, raw);
      if (mounted) setState(() => _line = _current.copyWith(photos: [..._line.photos, kept]));
    } finally {
      if (mounted) setState(() => _addingPhoto = false);
    }
  }

  void _removePhoto(String path) => setState(() => _line = _current.copyWith(photos: _line.photos.where((p) => p != path).toList()));

  void _save() {
    setState(() => _tried = true);
    if (_problems.isNotEmpty) return;
    Navigator.of(context).pop(ItemEdit.save(_current));
  }

  @override
  Widget build(BuildContext context) {
    final kind = _line.kind;
    final q = _search.text.trim().toLowerCase();
    final matches = widget.catalog
        .where((c) => c.kind == kind && (q.isEmpty || '${c.name} ${c.spec} ${c.category}'.toLowerCase().contains(q)))
        .take(30)
        .toList();
    final showMember = kind == ItemKind.material && widget.team != null && widget.iLead;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isNew ? 'Add item' : 'Edit item'),
        actions: [
          if (!widget.isNew)
            IconButton(
              tooltip: 'Remove item',
              icon: const Icon(Icons.delete_outline),
              onPressed: () => Navigator.of(context).pop(const ItemEdit.remove()),
            ),
        ],
      ),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: [
          SegmentedButton<ItemKind>(
            segments: [for (final k in ItemKind.values) ButtonSegment(value: k, label: Text(k.label))],
            selected: {kind},
            onSelectionChanged: (s) => setState(() {
              _line = _current.copyWith(
                kind: s.first,
                catalogItemId: null,
                memberId: s.first == ItemKind.tool ? null : _line.memberId,
                memberName: s.first == ItemKind.tool ? null : _line.memberName,
              );
            }),
          ),
          const SizedBox(height: 16),
          if (_line.fromCatalog) ...[
            _Picked(line: _current, onChange: _unpick),
          ] else if (!_describing) ...[
            TextField(
              key: const Key('item-search'),
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(labelText: 'Find it in the list', prefixIcon: Icon(Icons.search)),
            ),
            const SizedBox(height: 8),
            for (final c in matches)
              ListTile(
                key: Key('catalog-${c.id}'),
                contentPadding: EdgeInsets.zero,
                title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text([if (c.spec.isNotEmpty) c.spec, c.unit, if (c.category.isNotEmpty) c.category].join(' · ')),
                onTap: () => _pick(c),
              ),
            if (matches.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('Nothing in the list matches.')),
            TextButton.icon(
              key: const Key('describe-item'),
              onPressed: () => setState(() {
                _describing = true;
                if (_description.text.isEmpty) _description.text = _search.text.trim();
              }),
              icon: const Icon(Icons.edit_note),
              label: const Text('Not in the list? Describe it'),
            ),
          ] else ...[
            const Text('Describe the item. The office will match it to the list.',
                style: TextStyle(color: WmColors.textMuted, fontSize: 13)),
            const SizedBox(height: 10),
            _field(_description, 'Item name', 'item-name', error: _error(DraftIssueKind.noDescription)),
            _field(_spec, 'Size / type (optional)', 'item-spec'),
            _field(_unit, 'Unit (pc, bag, m…)', 'item-unit', error: _error(DraftIssueKind.noUnit)),
            _field(_category, 'Trade (optional, e.g. plumbing)', 'item-category'),
            if (widget.catalog.isNotEmpty)
              TextButton(onPressed: () => setState(() => _describing = false), child: const Text('Pick from the list instead')),
          ],
          const SizedBox(height: 8),
          _field(_quantity, 'Quantity${_unit.text.trim().isEmpty ? '' : ' (${_unit.text.trim()})'}', 'item-quantity',
              keyboard: const TextInputType.numberWithOptions(decimal: true), error: _error(DraftIssueKind.badQuantity)),
          if (showMember)
            DropdownButtonFormField<String?>(
              key: const Key('item-member'),
              initialValue: _line.memberId,
              decoration: const InputDecoration(labelText: 'For (optional)'),
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('The team')),
                for (final m in widget.team!.members) DropdownMenuItem<String?>(value: m.id, child: Text(m.name)),
              ],
              onChanged: (id) => setState(() => _line = _current.copyWith(
                    memberId: id,
                    memberName: widget.team!.members.where((m) => m.id == id).firstOrNull?.name,
                  )),
            ),
          const SizedBox(height: 8),
          SwitchListTile(
            key: const Key('item-urgent'),
            contentPadding: EdgeInsets.zero,
            title: const Text('Urgent', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: const Text('Goes to the office at once, without waiting for the weekly batch.'),
            value: _line.urgent,
            onChanged: (v) => setState(() => _line = _current.copyWith(urgent: v)),
          ),
          if (_line.urgent) ...[
            _field(_reason, 'Why is it urgent?', 'item-reason', error: _error(DraftIssueKind.urgentNeedsReason)),
            ListTile(
              key: const Key('item-needed-by'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event),
              title: Text(_line.neededBy == null ? 'Needed by…' : 'Needed by ${calendarDay(_line.neededBy!)}'),
              subtitle: _error(DraftIssueKind.urgentNeedsDate) == null
                  ? null
                  : Text(_error(DraftIssueKind.urgentNeedsDate)!, style: const TextStyle(color: WmColors.danger)),
              onTap: _pickDate,
            ),
          ],
          _field(_notes, 'Notes (optional)', 'item-notes'),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final p in _line.photos)
              Stack(children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.file(File(p), width: 84, height: 84, fit: BoxFit.cover, errorBuilder: (_, _, _) => _photoGap()),
                ),
                Positioned(
                  right: 0,
                  top: 0,
                  child: IconButton(
                    tooltip: 'Remove photo',
                    icon: const Icon(Icons.close, color: Colors.white),
                    style: IconButton.styleFrom(backgroundColor: Colors.black54),
                    onPressed: () => _removePhoto(p),
                  ),
                ),
              ]),
            if (_line.photos.length < maxPhotosPerItem)
              OutlinedButton.icon(
                key: const Key('item-add-photo'),
                onPressed: _addingPhoto ? null : _addPhoto,
                icon: const Icon(Icons.photo_camera_outlined),
                label: const Text('Add photo'),
              ),
          ]),
          const SizedBox(height: 20),
          FilledButton(key: const Key('item-save'), onPressed: _save, child: const Text('SAVE ITEM')),
        ]),
      ),
    );
  }

  String? _error(DraftIssueKind k) => _tried && _problems.contains(k) ? draftIssueText(k) : null;

  Widget _field(TextEditingController c, String label, String key, {TextInputType? keyboard, String? error}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextField(
          key: Key(key),
          controller: c,
          keyboardType: keyboard,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(labelText: label, errorText: error),
        ),
      );

  Widget _photoGap() => Container(width: 84, height: 84, color: WmColors.inert, child: const Icon(Icons.broken_image_outlined));
}

class _Picked extends StatelessWidget {
  const _Picked({required this.line, required this.onChange});
  final DraftLine line;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: WmColors.greenTint, borderRadius: BorderRadius.circular(14)),
        child: Row(children: [
          const Icon(Icons.inventory_2_outlined, color: WmColors.green),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(line.description, style: const TextStyle(fontWeight: FontWeight.w800)),
              Text([if (line.spec.isNotEmpty) line.spec, line.unit].join(' · '), style: const TextStyle(color: WmColors.textMuted)),
            ]),
          ),
          TextButton(key: const Key('item-change'), onPressed: onChange, child: const Text('Change')),
        ]),
      );
}
```

`lib/requests/compose/compose_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/domain/event_id.dart';
import '../../attendance/ui/attendance_copy.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../domain/quantity.dart';
import '../domain/request_draft.dart';
import '../domain/request_failure.dart';
import '../domain/request_models.dart';
import '../requests_services.dart';
import '../ui/requests_copy.dart';
import '../ui/sync_chip.dart';
import 'compose_controller.dart';
import 'item_editor_screen.dart';

/// New request (spec §4A): project → Main Contract or one Additional Works
/// job → one team for the whole request (or just me) → items. Pops true when
/// the request was queued.
class ComposeScreen extends StatefulWidget {
  const ComposeScreen({super.key, required this.draft, required this.services, this.now = DateTime.now});

  final RequestDraft draft;
  final RequestsServices services;
  final DateTime Function() now;

  @override
  State<ComposeScreen> createState() => _ComposeScreenState();
}

class _ComposeScreenState extends State<ComposeScreen> {
  late final ComposeController _c = ComposeController(api: widget.services.api, draft: widget.draft)..load();
  late final _note = TextEditingController(text: widget.draft.note);

  @override
  void dispose() {
    _c.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _chooseDestination() async {
    final refs = _c.refs;
    if (refs == null) return;
    final picked = await showModalBottomSheet<Destination>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.symmetric(vertical: 12), children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text('Which project and work?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            ),
            for (final d in refs.destinations)
              ListTile(
                key: Key('dest-${d.workId}'),
                title: Text(d.projectName, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(d.workName),
                leading: Icon(d.isMain ? Icons.home_work_outlined : Icons.add_box_outlined),
                selected: d == _c.draft.destination,
                onTap: () => Navigator.of(context).pop(d),
              ),
          ]),
        ),
      ),
    );
    if (picked != null) await _c.setDestination(picked);
  }

  Future<void> _editLine(DraftLine line, {required bool isNew}) async {
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
        now: widget.now,
      ),
    ));
    if (result == null) {
      // Backed out of a new item: photos taken for it are not kept.
      if (isNew) {
        for (final p in line.photos) {
          await widget.services.api.discardPhoto(p);
        }
      }
      return;
    }
    if (result.remove) {
      await _c.removeLine(line.id);
    } else {
      await _c.putLine(result.line!);
    }
  }

  Future<void> _send() async {
    await _c.setNote(_note.text);
    if (await _c.send() && mounted) Navigator.of(context).pop(true);
  }

  Future<void> _discard() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this draft?'),
        content: const Text('Its items and photos are removed from this phone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Delete')),
        ],
      ),
    );
    if (yes != true) return;
    await _c.discard();
    if (mounted) Navigator.of(context).pop(false);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: _c,
        builder: (context, _) {
          final d = _c.draft;
          final refs = _c.refs;
          final lineIssues = {for (final i in _c.issues) if (i.line != null) i.line!};
          return PopScope(
            // Leaving saves the note: nothing typed is lost.
            onPopInvokedWithResult: (didPop, _) {
              if (didPop && _note.text != d.note) _c.setNote(_note.text);
            },
            child: Scaffold(
              appBar: AppBar(
                title: const Text('New request'),
                actions: [
                  IconButton(key: const Key('draft-delete'), tooltip: 'Delete draft', icon: const Icon(Icons.delete_outline), onPressed: _discard),
                ],
              ),
              body: SafeArea(
                child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: [
                  if (_c.loading) const LinearProgressIndicator(),
                  if (refs == null && _c.refsFailure != null) ...[
                    FailureNotice(
                      english: requestFailureCopy(_c.refsFailure!).english,
                      tagalog: requestFailureCopy(_c.refsFailure!).tagalog,
                      actions: [noticeAction(retryLabel, _c.load)],
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (refs != null && refs.fromCache) ...[
                    const _Note('No signal: using the lists saved on this phone. They are checked again when the request is sent.'),
                    const SizedBox(height: 12),
                  ],
                  const Text('PROJECT AND WORK', style: monoLabel),
                  const SizedBox(height: 6),
                  if (refs != null && refs.destinations.isEmpty && d.destination == null)
                    FailureNotice(english: noDestinationsCopy.english, tagalog: noDestinationsCopy.tagalog)
                  else
                    _Choice(
                      key: const Key('choose-destination'),
                      title: d.destination?.projectName ?? 'Choose the project',
                      subtitle: d.destination?.workName ?? 'Main Contract or an Additional Works job',
                      error: _c.issues.contains(const DraftIssue(DraftIssueKind.noDestination))
                          ? draftIssueText(DraftIssueKind.noDestination)
                          : null,
                      onTap: refs == null ? null : _chooseDestination,
                    ),
                  if (_c.destinationClosed) ...[
                    const SizedBox(height: 8),
                    FailureNotice(
                      english: requestFailureCopy(RequestFailure.destinationClosed).english,
                      tagalog: requestFailureCopy(RequestFailure.destinationClosed).tagalog,
                    ),
                  ],
                  const SizedBox(height: 18),
                  const Text('TEAM', style: monoLabel),
                  const SizedBox(height: 6),
                  Wrap(spacing: 8, runSpacing: 4, children: [
                    ChoiceChip(
                      key: const Key('team-none'),
                      label: const Text('Just me'),
                      selected: d.teamId == null,
                      onSelected: (_) => _c.setTeam(null),
                    ),
                    for (final t in refs?.teams ?? const <MyTeam>[])
                      ChoiceChip(
                        key: Key('team-${t.id}'),
                        label: Text(t.iLead ? '${t.name} (you lead)' : t.name),
                        selected: d.teamId == t.id,
                        onSelected: (_) => _c.setTeam(t),
                      ),
                  ]),
                  const SizedBox(height: 18),
                  Text('ITEMS (${d.lines.length})', style: monoLabel),
                  const SizedBox(height: 6),
                  for (var i = 0; i < d.lines.length; i++)
                    _LineCard(
                      key: Key('line-$i'),
                      line: d.lines[i],
                      hasIssue: lineIssues.contains(i),
                      onTap: () => _editLine(d.lines[i], isNew: false),
                    ),
                  if (_c.issues.contains(const DraftIssue(DraftIssueKind.noLines)))
                    Text(draftIssueText(DraftIssueKind.noLines), style: const TextStyle(color: WmColors.danger)),
                  OutlinedButton.icon(
                    key: const Key('add-item'),
                    onPressed: refs == null ? null : () => _editLine(DraftLine(id: newEventId()), isNew: true),
                    icon: const Icon(Icons.add),
                    label: const Text('Add item'),
                  ),
                  const SizedBox(height: 18),
                  TextField(
                    key: const Key('request-note'),
                    controller: _note,
                    maxLines: 2,
                    decoration: const InputDecoration(labelText: 'Note for the office (optional)'),
                  ),
                  const SizedBox(height: 18),
                  if (_c.sendFailure != null) ...[
                    FailureNotice(english: requestFailureCopy(_c.sendFailure!).english, tagalog: requestFailureCopy(_c.sendFailure!).tagalog),
                    const SizedBox(height: 12),
                  ],
                  FilledButton(
                    key: const Key('send-request'),
                    onPressed: _c.sending ? null : _send,
                    child: const Text('SEND REQUEST'),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'No signal? It is saved on this phone and sent as soon as there is signal.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12.5, color: WmColors.textMuted),
                  ),
                ]),
              ),
            ),
          );
        },
      );
}

class _Note extends StatelessWidget {
  const _Note(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: WmColors.brownTint, borderRadius: BorderRadius.circular(12)),
        child: Text(text, style: const TextStyle(fontSize: 13, color: WmColors.brownDeep)),
      );
}

class _Choice extends StatelessWidget {
  const _Choice({super.key, required this.title, required this.subtitle, required this.onTap, this.error});
  final String title;
  final String subtitle;
  final String? error;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: error == null ? WmColors.border : WmColors.danger),
          ),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                Text(subtitle, style: const TextStyle(color: WmColors.textMuted)),
                if (error != null) Text(error!, style: const TextStyle(color: WmColors.danger, fontSize: 12.5)),
              ]),
            ),
            const Icon(Icons.chevron_right),
          ]),
        ),
      );
}

class _LineCard extends StatelessWidget {
  const _LineCard({super.key, required this.line, required this.hasIssue, required this.onTap});
  final DraftLine line;
  final bool hasIssue;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final qty = parseQuantity(line.quantity);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: hasIssue ? WmColors.danger : WmColors.border),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text(line.description.isEmpty ? 'Unnamed item' : line.description,
                    style: const TextStyle(fontWeight: FontWeight.w800)),
              ),
              Text(qty == null ? '—' : '${formatQuantity(qty)} ${line.unit}', style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
            Text(
              [
                line.kind.label,
                if (line.spec.isNotEmpty) line.spec,
                if (!line.fromCatalog) 'Not in the list',
                if (line.memberName != null) 'For ${line.memberName}',
                if (line.photos.isNotEmpty) '${line.photos.length} photo${line.photos.length == 1 ? '' : 's'}',
              ].join(' · '),
              style: const TextStyle(color: WmColors.textMuted, fontSize: 13),
            ),
            if (line.urgent) ...[const SizedBox(height: 6), UrgentTag(neededBy: line.neededBy)],
            if (hasIssue) const Text('Check this item.', style: TextStyle(color: WmColors.danger, fontSize: 12.5)),
          ]),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run** — `flutter test test/requests/compose` → all pass; `flutter analyze` → "No issues found!".

- [ ] **Step 5: Stop — no commit.**

---

### Task 9: One request, and the Requests tab

**Files:**
- Create: `lib/requests/detail/request_detail_screen.dart`, `lib/requests/list/requests_screen.dart`
- Test: `test/requests/detail/request_screens_test.dart`

**Interfaces:**
- Consumes: Tasks 1–8; `dayMonth`, `clockTime` (`lib/attendance/ui/formats.dart`), `dismissLabel`, `retryLabel`.
- Produces: `RequestDetailScreen({controller, api, entryKey, onEditDraft})` (reads its entry from the shared controller, so it follows every refresh); `RequestsScreen({controller, services})`. Keys: `change-<lineId>`, `cancel-<lineId>`, `cancel-request`, `confirm-cancel`, `qty-field`, `qty-save`, `new-request`, `filter-<all|drafts|pending|attention>`, `entry-<key>`.

What the requester may do (0085 enforces it again): change or cancel an item only on their own, open line; cancel the request while something is open. A leader sees their team's requests read-only ("From Juan dela Cruz"). Each portion shows `"<qty> <unit> · [Arranged · ]Expected <Wed 14 Oct>"`; an unsent edit shows `"Changing to 8 pc · Pending sync"`.

- [ ] **Step 1: Write the failing test** — create `test/requests/detail/request_screens_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/detail/request_detail_screen.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_draft.dart';
import 'package:workmate/requests/domain/request_op.dart';
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

  RequestEntry entry(Map<String, dynamic> doc, {SyncState state = SyncState.received, List<RequestOp> pending = const [], List<RequestOp> failed = const []}) =>
      RequestEntry(state: state, remote: RemoteRequest.fromJson(doc), pendingOps: pending, failedOps: failed);

  Future<void> showDetail(WidgetTester tester, String key) async {
    useTallPhone(tester);
    await controller.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: RequestDetailScreen(controller: controller, api: api, entryKey: key, onEditDraft: (_) {}),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('a received request shows each portion\'s expected delivery', (tester) async {
    api.view = RequestsView(entries: [entry(requestDoc())]);
    await showDetail(tester, 'r1');
    expect(find.text('Santos Townhouse · Main Contract'), findsOneWidget);
    expect(find.text('Received'), findsOneWidget);
    expect(find.text('10 pc · Arranged · Expected Wed 14 Oct'), findsOneWidget);
    expect(find.text('2.5 pc · Expected Wed 21 Oct'), findsOneWidget);
    expect(find.text('Office is checking a change'), findsOneWidget);
    expect(find.textContaining('URGENT · by Wed 7 Oct'), findsOneWidget);
  });

  testWidgets('the requester changes a quantity; it shows as pending sync', (tester) async {
    api.view = RequestsView(entries: [entry(requestDoc())]);
    await showDetail(tester, 'r1');
    await tester.tap(find.byKey(const Key('change-l1')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('qty-field')), '8');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('qty-save')));
    await tester.pumpAndSettle();
    expect(api.calls, ['quantity:l1:8']);

    api.view = RequestsView(entries: [
      entry(requestDoc(), state: SyncState.pending, pending: [
        RequestOp(opId: 'o', workerId: 'u1', kind: OpKind.quantity, createdAt: DateTime.utc(2026), lineId: 'l1', body: const {'quantity': 8}),
      ]),
    ]);
    await controller.refresh();
    await tester.pumpAndSettle();
    expect(find.text('Changing to 8 pc · Pending sync'), findsOneWidget);
  });

  testWidgets('cancelling asks first', (tester) async {
    api.view = RequestsView(entries: [entry(requestDoc())]);
    await showDetail(tester, 'r1');
    await tester.tap(find.byKey(const Key('cancel-l1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Keep'));
    await tester.pumpAndSettle();
    expect(api.calls, isEmpty);
    await tester.tap(find.byKey(const Key('cancel-request')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-cancel')));
    await tester.pumpAndSettle();
    expect(api.calls, ['cancelRequest:r1']);
  });

  testWidgets('a team member\'s request is read-only for the leader', (tester) async {
    api.view = RequestsView(entries: [entry(requestDoc(mine: false))]);
    await showDetail(tester, 'r1');
    expect(find.textContaining('From Juan dela Cruz'), findsOneWidget);
    expect(find.byKey(const Key('change-l1')), findsNothing);
    expect(find.byKey(const Key('cancel-request')), findsNothing);
  });

  testWidgets('a refused change is explained in both languages and can be dismissed', (tester) async {
    final op = RequestOp(
      opId: 'o9',
      workerId: 'u1',
      kind: OpKind.quantity,
      createdAt: DateTime.utc(2026),
      lineId: 'l1',
      body: const {'quantity': 3},
      lastError: 'lineClosed',
      failedPermanently: true,
    );
    api.view = RequestsView(entries: [entry(requestDoc(), state: SyncState.failed, failed: [op])]);
    await showDetail(tester, 'r1');
    expect(find.text('This item is already cancelled.'), findsOneWidget);
    expect(find.text('Naka-cancel na ang item na ito.'), findsOneWidget);
    await tester.tap(find.text('Dismiss · Isara'));
    await tester.pumpAndSettle();
    expect(api.calls, ['dismiss:o9']);
  });

  testWidgets('the list shows each state and opens a draft in the editor', (tester) async {
    useTallPhone(tester);
    api.savedDrafts['d7'] = RequestDraft(id: 'd7', createdAt: DateTime.utc(2026, 10, 5), destination: site);
    api.view = RequestsView(entries: [entry(requestDoc()), entry(requestDoc(id: 'r2'), state: SyncState.pending)]);
    await controller.refresh();
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Scaffold(body: RequestsScreen(controller: controller, services: RequestsServices(api: api, takePhoto: (_) async => null))),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Draft'), findsOneWidget);
    expect(find.text('Received'), findsOneWidget);
    expect(find.text('Pending sync'), findsWidgets);
    await tester.tap(find.byKey(const Key('filter-pending')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('entry-r2')), findsOneWidget);
    expect(find.byKey(const Key('entry-r1')), findsNothing);
    await tester.tap(find.byKey(const Key('filter-all')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('entry-d7')));
    await tester.pumpAndSettle();
    expect(find.text('New request'), findsWidgets);
    expect(find.byKey(const Key('send-request')), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run it to verify it fails** — compile errors.

- [ ] **Step 3: Write the code.**

`lib/requests/detail/request_detail_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/requests_api.dart';
import '../domain/quantity.dart';
import '../domain/remote_request.dart';
import '../domain/request_draft.dart';
import '../domain/request_failure.dart';
import '../domain/request_op.dart';
import '../domain/request_status.dart';
import '../list/requests_controller.dart';
import '../ui/requests_copy.dart';
import '../ui/sync_chip.dart';

/// One request: each item's progress and expected delivery per weekly batch,
/// what is still on the phone, what was refused, and — for the requester —
/// quantity changes and cancelling. Reads its entry from the shared
/// controller by [entryKey], so it follows every refresh.
class RequestDetailScreen extends StatelessWidget {
  const RequestDetailScreen({
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
          return Scaffold(
            appBar: AppBar(title: const Text('Request')),
            body: SafeArea(
              child: e == null
                  ? const Center(child: Text('This request is no longer on the list.'))
                  : RefreshIndicator(
                      onRefresh: controller.refresh,
                      child: ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                        children: e.remote != null ? _remote(context, e, e.remote!) : _onPhone(e, e.draft!),
                      ),
                    ),
            ),
          );
        },
      );

  List<Widget> _failures(RequestEntry e) => [
        for (final op in e.failedOps)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: FailureNotice(
              leadEnglish: '${_opLabel(op)}: ${notAcceptedLead.english}',
              leadTagalog: notAcceptedLead.tagalog,
              english: requestFailureCopy(RequestFailure.fromStored(op.lastError)).english,
              tagalog: requestFailureCopy(RequestFailure.fromStored(op.lastError)).tagalog,
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
        Row(children: [
          Expanded(child: Text(d.destination?.label ?? '', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
          SyncChip(e.state),
        ]),
        const SizedBox(height: 4),
        Text(d.teamName == null ? 'Just me' : 'Team ${d.teamName}', style: const TextStyle(color: WmColors.textMuted)),
        const SizedBox(height: 12),
        if (e.state == SyncState.pending)
          const Text('Saved on this phone. It is sent as soon as there is signal.', style: TextStyle(color: WmColors.brown)),
        ..._failures(e),
        const SizedBox(height: 8),
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
        Row(children: [
          Expanded(child: Text(r.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
          SyncChip(e.state),
        ]),
        const SizedBox(height: 4),
        Text(
          [
            if (!r.mine) 'From ${r.requesterName}',
            r.teamName == null ? 'Just me' : 'Team ${r.teamName}',
            'Received ${dayMonth(r.receivedAt)}, ${clockTime(r.receivedAt)}',
          ].join(' · '),
          style: const TextStyle(color: WmColors.textMuted),
        ),
        if (r.note.isNotEmpty) ...[const SizedBox(height: 6), Text(r.note)],
        if (r.cancelled) ...[const SizedBox(height: 8), const Text('Cancelled', style: TextStyle(color: WmColors.danger, fontWeight: FontWeight.w700))],
        const SizedBox(height: 12),
        ..._failures(e),
        for (final l in r.lines) _line(context, e, r, l),
        if (canCancelRequest(r) && !e.pendingOps.any((o) => o.kind == OpKind.cancelRequest))
          TextButton(
            key: const Key('cancel-request'),
            onPressed: () => _cancelRequest(context, r),
            style: TextButton.styleFrom(foregroundColor: WmColors.danger),
            child: const Text('Cancel the whole request'),
          ),
      ];

  Widget _line(BuildContext context, RequestEntry e, RemoteRequest r, RemoteLine l) {
    final pendingQty = e.pendingQuantity(l.id);
    final cancelPending = e.cancelPending(l.id);
    final progress = lineProgress(l);
    final photos = r.photos.where((p) => p.lineId == l.id).toList();
    return _Card(key: Key('line-${l.id}'), children: [
      Row(children: [
        Expanded(child: Text(l.description, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
        Text('${formatQuantity(l.needed)} ${l.unit}', style: const TextStyle(fontWeight: FontWeight.w800)),
      ]),
      Text(
        [
          l.kind.label,
          if (l.spec.isNotEmpty) l.spec,
          if (l.catalogItemId == null) 'Not in the list',
          if (l.intendedMemberName != null) 'For ${l.intendedMemberName}',
        ].join(' · '),
        style: const TextStyle(color: WmColors.textMuted, fontSize: 13),
      ),
      const SizedBox(height: 6),
      Wrap(spacing: 6, runSpacing: 6, children: [
        Text(lineProgressLabel(progress),
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: progress == LineProgress.needsResolution || progress == LineProgress.officeChecking ? WmColors.danger : WmColors.green,
            )),
        if (l.urgent) UrgentTag(neededBy: l.neededBy),
      ]),
      if (pendingQty != null)
        Text('Changing to ${formatQuantity(pendingQty)} ${l.unit} · ${syncLabel(SyncState.pending)}',
            style: const TextStyle(color: WmColors.brown, fontWeight: FontWeight.w700)),
      if (cancelPending) Text('Cancelling · ${syncLabel(SyncState.pending)}', style: const TextStyle(color: WmColors.brown, fontWeight: FontWeight.w700)),
      if (progress == LineProgress.needsResolution)
        const Text('Your change and the office\'s change differ. The office will decide and tell you.',
            style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
      const SizedBox(height: 6),
      for (final p in l.portions)
        Text(
          '${formatQuantity(p.quantity)} ${l.unit} · ${p.arranged ? 'Arranged · ' : ''}Expected ${calendarDay(p.deliveryOn)}',
          style: const TextStyle(fontSize: 13),
        ),
      if (photos.isNotEmpty) ...[
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: [for (final p in photos) _RemotePhoto(api: api, path: p.path)]),
      ],
      if (canChangeLine(r, l) && !cancelPending) ...[
        const SizedBox(height: 4),
        Wrap(children: [
          TextButton(
            key: Key('change-${l.id}'),
            onPressed: () => _changeQuantity(context, r, l, pendingQty ?? l.needed),
            child: const Text('Change quantity'),
          ),
          TextButton(
            key: Key('cancel-${l.id}'),
            onPressed: () => _cancelLine(context, r, l),
            style: TextButton.styleFrom(foregroundColor: WmColors.danger),
            child: const Text('Cancel item'),
          ),
        ]),
      ],
    ]);
  }
}

String _opLabel(RequestOp op) => switch (op.kind) {
      OpKind.submit => 'Sending the request',
      OpKind.photo => 'A photo',
      OpKind.quantity => 'Changing to ${formatQuantity(op.quantity ?? 0)}',
      OpKind.cancelLine => 'Cancelling an item',
      OpKind.cancelRequest => 'Cancelling the request',
    };

class _Card extends StatelessWidget {
  const _Card({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: WmColors.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
      );
}

/// A private photo through a short-lived link; a grey box when it cannot load.
class _RemotePhoto extends StatelessWidget {
  const _RemotePhoto({required this.api, required this.path});
  final RequestsApi api;
  final String path;

  @override
  Widget build(BuildContext context) => FutureBuilder<String?>(
        future: api.photoUrl(path),
        builder: (context, snap) {
          final url = snap.data;
          final box = Container(width: 72, height: 72, color: WmColors.inert);
          if (url == null) return box;
          return ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.network(url, width: 72, height: 72, fit: BoxFit.cover, errorBuilder: (_, _, _) => box),
          );
        },
      );
}

/// The new "still needed" number. Owns its text field, so the field lives
/// exactly as long as the dialog (closing animation included).
class _QuantityDialog extends StatefulWidget {
  const _QuantityDialog({required this.line, required this.current});
  final RemoteLine line;
  final double current;

  @override
  State<_QuantityDialog> createState() => _QuantityDialogState();
}

class _QuantityDialogState extends State<_QuantityDialog> {
  late final _text = TextEditingController(text: formatQuantity(widget.current).replaceAll(',', ''));

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final parsed = parseQuantity(_text.text);
    return AlertDialog(
      title: Text('Change ${widget.line.description}'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        TextField(
          key: const Key('qty-field'),
          controller: _text,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: 'Still needed (${widget.line.unit})',
            errorText: parsed == null ? draftIssueText(DraftIssueKind.badQuantity) : null,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'What the office already arranged is never erased: a smaller number is flagged for them to sort out.',
          style: TextStyle(fontSize: 12.5, color: WmColors.textMuted),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        TextButton(
          key: const Key('qty-save'),
          onPressed: parsed == null ? null : () => Navigator.of(context).pop(parsed),
          child: const Text('Save'),
        ),
      ],
    );
  }
}
```

`lib/requests/list/requests_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../compose/compose_screen.dart';
import '../data/requests_api.dart';
import '../detail/request_detail_screen.dart';
import '../domain/request_draft.dart';
import '../domain/request_status.dart';
import '../requests_services.dart';
import '../ui/requests_copy.dart';
import '../ui/sync_chip.dart';
import 'requests_controller.dart';

/// The Requests tab (spec §5): create, edit and track requests. A leader also
/// sees the requests of the teams they currently lead, read-only.
class RequestsScreen extends StatelessWidget {
  const RequestsScreen({super.key, required this.controller, required this.services});

  final RequestsController controller;
  final RequestsServices services;

  Future<void> _compose(BuildContext context, RequestDraft draft) async {
    await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ComposeScreen(draft: draft, services: services)));
    await controller.refresh();
  }

  Future<void> _newRequest(BuildContext context) async {
    final draft = services.api.newDraft();
    await services.api.saveDraft(draft);
    if (context.mounted) await _compose(context, draft);
  }

  Future<void> _open(BuildContext context, RequestEntry e) async {
    if (e.state == SyncState.draft) return _compose(context, e.draft!);
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (detailContext) => RequestDetailScreen(
        controller: controller,
        api: services.api,
        entryKey: e.key,
        onEditDraft: (draftId) async {
          await controller.returnToDrafts(draftId);
          final draft = controller.entry(draftId)?.draft;
          if (draft == null || !detailContext.mounted) return;
          Navigator.of(detailContext).pop();
          await _compose(context, draft);
        },
      ),
    ));
    await controller.refresh();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final c = controller;
          final rows = c.rows;
          final failure = c.failure;
          final view = c.view;
          return RefreshIndicator(
            onRefresh: c.refresh,
            child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
              Row(children: [
                const Expanded(child: Text('Requests', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800))),
                FilledButton.icon(
                  key: const Key('new-request'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                  onPressed: () => _newRequest(context),
                  icon: const Icon(Icons.add),
                  label: const Text('New request'),
                ),
              ]),
              const SizedBox(height: 4),
              const Text('Materials and tools for your projects.', style: TextStyle(color: WmColors.textMuted)),
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
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(children: [
                  for (final (f, label) in const [
                    (RequestFilter.all, 'All'),
                    (RequestFilter.drafts, 'Drafts'),
                    (RequestFilter.pending, 'Pending sync'),
                    (RequestFilter.attention, 'Needs attention'),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(key: Key('filter-${f.name}'), label: Text(label), selected: c.filter == f, onSelected: (_) => c.setFilter(f)),
                    ),
                ]),
              ),
              const SizedBox(height: 12),
              if (c.loading && rows.isEmpty) const Padding(padding: EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator())),
              if (!c.loading && rows.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 32),
                  child: Text('Nothing here yet. Tap New request to ask for materials or tools.',
                      textAlign: TextAlign.center, style: TextStyle(color: WmColors.textMuted)),
                ),
              for (final e in rows) _EntryCard(key: Key('entry-${e.key}'), entry: e, onTap: () => _open(context, e)),
            ]),
          );
        },
      );
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({super.key, required this.entry, required this.onTap});
  final RequestEntry entry;
  final VoidCallback onTap;

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
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: WmColors.border)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              SyncChip(entry.state),
            ]),
            const SizedBox(height: 4),
            Text('$who$lines item${lines == 1 ? '' : 's'} · ${dayMonth(when)}', style: const TextStyle(color: WmColors.textMuted, fontSize: 13)),
            if (urgent || delivery != null) ...[
              const SizedBox(height: 6),
              Wrap(spacing: 8, children: [
                if (urgent) const UrgentTag(),
                if (delivery != null) Text('Next delivery ${calendarDay(delivery)}', style: const TextStyle(fontSize: 13, color: WmColors.green)),
              ]),
            ],
          ]),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run** — `flutter test test/requests` → all pass (67); `flutter analyze` → "No issues found!".

- [ ] **Step 5: Stop — no commit.**

---

### Task 10: The Requests tab in the app, Home's card, startup wiring

**Files:**
- Modify: `lib/attendance/home/home_screen.dart`, `lib/ui/home_shell.dart`, `lib/app.dart`, `lib/main.dart`
- Test: `test/ui/screens_test.dart` (one new test)

**Interfaces:**
- Consumes: everything above.
- Produces: `HomeScreen(..., requestUpdates: Widget?)`; `HomeShell(..., requests: RequestsServices?)` — tabs Home · Requests · History · Profile (Requests only when `requests` is given, so every existing test keeps passing unchanged); `WorkMateApp(..., requests: RequestsServices?)`; main.dart builds the live `RequestRepository`.

- [ ] **Step 1: Write the failing test** — in `test/ui/screens_test.dart`:
  (a) after `import 'package:workmate/profile/account_services.dart';` add

```dart
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/requests/requests_services.dart';
```

  (b) after `import '../attendance/fakes.dart';` add

```dart
import '../requests/domain/request_models_test.dart' show requestDoc;
import '../requests/request_fakes.dart';
```

  (c) add this test as the last one inside `main()`:

```dart
  testWidgets('with Requests: a Requests tab, and the Home card opens it', (tester) async {
    useTallPhone(tester);
    final api = FakeRequestsApi()
      ..view = RequestsView(entries: [RequestEntry(state: SyncState.needsResolution, remote: RemoteRequest.fromJson(requestDoc()))]);
    await tester.pumpWidget(wrap(HomeShell(
      worker: const WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42),
      versionName: '0.4.0',
      onSignOut: () async {},
      services: fakeServices(),
      account: AccountServices(changePassword: (_) async {}, termsAcceptedAt: () async => null),
      requests: RequestsServices(api: api, takePhoto: (_) async => null),
    )));
    await tester.pumpAndSettle();
    expect(find.text('Requests'), findsWidgets);
    expect(find.text('1 needs your attention'), findsOneWidget);
    await tester.tap(find.byKey(const Key('request-updates')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('new-request')), findsOneWidget);
    expect(find.text('Needs resolution'), findsOneWidget);
    // History still works from its own tab.
    await tester.tap(find.text('History'));
    await tester.pumpAndSettle();
    expect(find.text('My attendance'), findsOneWidget);
  });
```

- [ ] **Step 2: Run it to verify it fails** — `flutter test test/ui/screens_test.dart` → compile error (`requests` is not a parameter of `HomeShell`).

- [ ] **Step 3: `home_screen.dart`** — (a) add `this.requestUpdates,` after `this.onDismissExit,` in the constructor; (b) after the field `final VoidCallback? onDismissExit;` add

```dart

  /// The Requests card (lib/requests/home), below today; null when the app
  /// has no Requests tab.
  final Widget? requestUpdates;
```

  (c) directly after the line `..._today(c, failure),` add

```dart
              if (widget.requestUpdates != null) ...[const SizedBox(height: 16), widget.requestUpdates!],
```

- [ ] **Step 4: `home_shell.dart`** — apply these replacements in order (old text exact):

  (1) Replace

```dart
import '../profile/profile_screen.dart';
import '../widget/start_flow.dart';
```

  with

```dart
import '../profile/profile_screen.dart';
import '../requests/home/request_updates_card.dart';
import '../requests/list/requests_controller.dart';
import '../requests/list/requests_screen.dart';
import '../requests/requests_services.dart';
import '../widget/start_flow.dart';
```

  (2) Replace

```dart
/// The signed-in app: Home, History and Profile, and the four-step Time In /
/// Time Out flow launched from Home. The flow is MODAL (no tabs while
/// recording). Requests and Work tabs arrive with Stage 1.
```

  with

```dart
enum _Tab { home, requests, history, profile }

/// The signed-in app: Home, Requests (Stage 1a), History and Profile, and the
/// four-step Time In / Time Out flow launched from Home. The flow is MODAL (no
/// tabs while recording).
```

  (3) Replace

```dart
    this.startRequests,
  });
```

  with

```dart
    this.startRequests,
    this.requests,
  });
```

  (4) Replace

```dart
  /// Widget taps waiting for Home to decide them.
  final StartFlowInbox? startRequests;
```

  with

```dart
  /// Widget taps waiting for Home to decide them.
  final StartFlowInbox? startRequests;

  /// The Requests tab's services; null shows no Requests tab.
  final RequestsServices? requests;
```

  (5) Replace

```dart
  int _tab = 0;
  TimeFlowController? _flow;
  Bilingual? _exitNotice;
  late final HomeController _home;
  late final HistoryController _history;
```

  with

```dart
  _Tab _tab = _Tab.home;
  TimeFlowController? _flow;
  Bilingual? _exitNotice;
  late final HomeController _home;
  late final HistoryController _history;
  RequestsController? _requests;

  List<_Tab> get _tabs => [_Tab.home, if (widget.requests != null) _Tab.requests, _Tab.history, _Tab.profile];
```

  (6) Replace

```dart
    _history = HistoryController(attendance: s.attendance);
    WidgetsBinding.instance.addObserver(this);
    _home.refresh();
    s.queueSettled?.addListener(_onQueueSettled);
```

  with

```dart
    _history = HistoryController(attendance: s.attendance);
    final r = widget.requests;
    if (r != null) _requests = RequestsController(api: r.api)..refresh();
    WidgetsBinding.instance.addObserver(this);
    _home.refresh();
    s.queueSettled?.addListener(_onQueueSettled);
    // main.dart passes the same QueueSettled to both: listen once.
    final changed = r?.changed;
    if (changed != null && changed != s.queueSettled) changed.addListener(_onQueueSettled);
```

  (7) Replace

```dart
    Navigator.of(context).popUntil((route) => route.isFirst);
    if (_tab != 0) setState(() => _tab = 0);
```

  with

```dart
    Navigator.of(context).popUntil((route) => route.isFirst);
    if (_tab != _Tab.home) setState(() => _tab = _Tab.home);
```

  (8) Replace

```dart
    if (_flow == null) _home.refresh(sendQueued: false);
    if (_tab == 1) _history.refresh();
  }
```

  with

```dart
    if (_flow == null) _home.refresh(sendQueued: false);
    if (_tab == _Tab.history) _history.refresh();
    _requests?.refresh();
  }
```

  (9) Replace

```dart
    widget.services.queueSettled?.removeListener(_onQueueSettled);
    WidgetsBinding.instance.removeObserver(this);
```

  with

```dart
    widget.services.queueSettled?.removeListener(_onQueueSettled);
    final changed = widget.requests?.changed;
    if (changed != null && changed != widget.services.queueSettled) changed.removeListener(_onQueueSettled);
    WidgetsBinding.instance.removeObserver(this);
```

  (10) Replace

```dart
    _home.dispose();
    _history.dispose();
    super.dispose();
```

  with

```dart
    _home.dispose();
    _history.dispose();
    _requests?.dispose();
    super.dispose();
```

  (11) Replace

```dart
    if (state == AppLifecycleState.resumed && _flow == null) _home.refresh();
  }
```

  with

```dart
    if (state == AppLifecycleState.resumed && _flow == null) {
      _home.refresh();
      _requests?.refresh();
    }
  }
```

  (12) Replace

```dart
  void _selectTab(int tab) {
    setState(() => _tab = tab);
    if (tab == 1) _history.refresh();
  }
```

  with

```dart
  void _selectTab(_Tab tab) {
    setState(() => _tab = tab);
    if (tab == _Tab.history) _history.refresh();
    if (tab == _Tab.requests) _requests?.refresh();
  }
```

  (13) Replace

```dart
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
      _ => ProfileScreen(worker: widget.worker, versionName: widget.versionName, onSignOut: widget.onSignOut, account: widget.account),
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
```

  with

```dart
    final requests = _requests;
    final body = switch (_tab) {
      _Tab.home => HomeScreen(
          worker: widget.worker,
          controller: _home,
          onStartFlow: _startFlow,
          onSeeHistory: () => _selectTab(_Tab.history),
          openSettings: s.openSettings,
          exitNotice: _exitNotice,
          onDismissExit: () => setState(() => _exitNotice = null),
          requestUpdates: requests == null
              ? null
              : ListenableBuilder(
                  listenable: requests,
                  builder: (context, _) => RequestUpdatesCard(updates: requests.updates, onOpen: () => _selectTab(_Tab.requests)),
                ),
        ),
      _Tab.requests => RequestsScreen(controller: requests!, services: widget.requests!),
      _Tab.history => HistoryScreen(controller: _history, photoUrl: s.photoUrl),
      _Tab.profile => ProfileScreen(worker: widget.worker, versionName: widget.versionName, onSignOut: widget.onSignOut, account: widget.account),
    };
    final tabs = _tabs;
    return Scaffold(
      body: SafeArea(child: body),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tabs.indexOf(_tab),
        onDestinationSelected: (i) => _selectTab(tabs[i]),
        destinations: [
          for (final t in tabs)
            switch (t) {
              _Tab.home => const NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
              _Tab.requests => const NavigationDestination(icon: Icon(Icons.inventory_2_outlined), label: 'Requests'),
              _Tab.history => const NavigationDestination(icon: Icon(Icons.history), label: 'History'),
              _Tab.profile => const NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
            },
        ],
      ),
    );
```


- [ ] **Step 5: `app.dart`** — (a) after `import 'profile/account_services.dart';` add `import 'requests/requests_services.dart';`; (b) add `this.requests,` after `this.launches,` in the constructor; (c) after the field `final LaunchRequests? launches;` add

```dart

  /// The Requests tab (Stage 1a); null in tests that do not need it.
  final RequestsServices? requests;
```

  (d) in the `Ready(:final worker) => HomeShell(` call add `requests: widget.requests,` after `startRequests: _inbox,`.

- [ ] **Step 6: `main.dart`** — (a) after `import 'profile/account_services.dart';` add

```dart
import 'requests/data/request_remote.dart';
import 'requests/data/request_repository.dart';
import 'requests/data/requests_db.dart';
import 'requests/requests_services.dart';
```

  (b) directly above `  runApp(WorkMateApp(` add

```dart
  // Requests (Stage 1a): the same worker scope, the same background task.
  final requests = RequestsServices(
    api: RequestRepository(
      db: await openDeviceRequestsDb(),
      remote: SupabaseRequestRemote(client),
      device: device,
      scheduler: scheduler,
      currentWorkerId: attendance.currentWorkerId,
      photoDir: () async =>
          Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}request-photos'),
      sendNow: () async {
        await syncHost.drainNow();
      },
    ),
    changed: queueSettled,
  );

```

  (c) add `requests: requests,` after `launches: const ChannelLaunchRequests(),` in the `WorkMateApp(` call.

- [ ] **Step 7: Run** — `flutter analyze` → "No issues found!"; `flutter test` → **505 passed** (or more), 0 failed.

- [ ] **Step 8: Stop — no commit.**

---

### Task 11: Release build and phone check (controller + user)

**Not for a subagent** — it needs the phone and the user.

- [ ] **Step 1: Version** — in `pubspec.yaml` change `version: 0.3.0+1003` to `version: 0.4.0+1004`.
- [ ] **Step 2: Build** — `flutter build apk --release` (the ARM-only split set up in 0B; signing from `android/key.properties`, never printed). Note the APK path and size.
- [ ] **Step 3: Server prerequisites (read-only check by the controller)** — at least one Project Control project has *Allow requests* on or is on today's Time In list (Barlin Residence was switched on 2026-10-05); the test team ("Team test": W-0021 leader, W-0007 member) and one catalogue item exist (Dacs Web → Requests).
- [ ] **Step 4: Install on the test phone** (`adb install -r <apk>`; the user's phone is connected) and run, signed in as **W-0007**:
  1. A **Requests** tab sits between Home and History; Home shows no Requests card while there is nothing to say.
  2. **New request** → choose the project → Main Contract → **Team test** → Add item → find the catalogue item → quantity 10 → Save item → **Send**. It shows **Pending sync**, then **Received** with "Expected <Wednesday>".
  3. **Airplane mode on** → New request → describe an unlisted item ("ZZ elbow 45", pc, 3) with **one photo** and **Urgent** (reason + date) → Send → **Pending sync** survives closing and reopening the app → airplane mode off → it becomes **Received** without opening the app (background) or on return; the photo appears on the request; Dacs Web shows the request with the photo and the urgent line on top.
  4. Change the first item 10 → 8 → shows "Changing to 8 pc · Pending sync" until sent, then 8.
  5. In Dacs Web change the same line to 12 (reason "test"); on the phone, **airplane mode on**, change it to 6 (the phone still shows the old version), airplane off → the line shows **Needs resolution**; Dacs Web shows the conflict (6 vs 12).
  6. Cancel one item, then cancel the request → **Cancelled**; Dacs Web shows both.
  7. Sign in as **W-0021** (leader): sees W-0007's team request read-only ("From John Tapales"), can name a member on a material line in their own request.
  8. Home shows the Requests card (attention / waiting / next delivery) and tapping it opens Requests.
  9. Attendance unchanged: Time In and Time Out still work and upload (the drain sends attendance first).
- [ ] **Step 5: Docs** — `Dacs Web/docs/superpowers/plans/2026-10-02-workmate-stage1a-roadmap.md` row 1a-3 → "(built YYYY-MM-DD, 0.4.0+1004)"; add an "Execution notes" section to this plan; update the memory file `workmate-requests-0085.md`. No commit — the user commits both repos.
- [ ] **Step 6: Publishing** — only if the user asks: Dacs Web → Attendance → App updates → upload the WorkMate APK (stream `com.dacs.workmate`). Workers stay on DACS Attendance until the current project ends (0E deferred), so publishing only reaches test phones.

---

## Execution notes (2026-10-06)

Executed subagent-driven; every task reviewed, then a final whole-change review (opus) and one fix wave. **Released as 0.4.0+1004** (release APK, 35.9 MB) and **phone-verified 2026-10-06** on the test phone with W-0007 and W-0021: all 9 checks of Step 4 passed, each confirmed in the database (`pr_events`, `pr_lines`, `pr_photos`, `attendance_records`). `flutter analyze` clean; **542** tests.

**The shipped code differs from the task text above in these ways (the code is authoritative):**
- Quantity edits: `rebaseAfterRefusal` — after a refused edit, the next waiting edit of that line takes the refused edit's base.
- `attempts` = run of consecutive *unexpected* failures (offline waits reset it); `photoNotUploaded` also counts toward the 10-try cap; app-update / session / no-connection never do.
- `RequestsDb`: `saveDraft` never rewrites a queued draft; `queueDraft` refuses an already-queued draft (double Send = one request); `unqueueDraft` refuses a landed draft; `deleteUnsentDraft` replaces deleting by the caller's copy.
- Repository: `dismissFailed` refuses submits (they go back via `returnToDrafts`, which returns whether it worked); attach re-checks the signed-in worker after the upload.
- **Attendance is never worse:** the requests DB is opened lazily inside its own try/finally after the attendance drain, and a failure only asks WorkManager to come back; `main.dart` builds the Requests services in try/catch (no Requests tab on failure). `afterChange` (widget + Home "sent") fires right after the attendance pass, not after requests; requests notify screens via `onRequestsSettled`. `AttendanceSyncHost._run` does one trailing re-run when called during a drain, and `syncWith` re-drains attendance if a row was queued during the requests phase.
- UI: `RequestsController.refresh` trailing re-run; item editor owns its photos (no orphans); note saved as typed, untouched New request stores nothing; team cleared when a fresh team list lacks it; member picker only for the team's leader, a member who left is dropped; Remove item asks first; cancelled requests show a grey **Cancelled** chip; edit refusals for a closed site have their own copy; failure copy bilingual.
- Dacs Web (found in the phone test): **0087_pr_person_name_office.sql** — owner/staff with no display name read "Office", not "Worker", in request history. **Applied live 2026-10-06** (verified).

**Phone check (2026-10-06):** normal send; offline urgent send with photo went out on its own when signal returned; clean edit 3 → 2; offline edit vs office change → Needs resolution → resolved in Dacs Web; office cancel and worker cancel (item alone keeps the request open; whole request); leader sees team requests read-only "From John Tapales" and can name a member (server accepted W-0007); Home card; Time In / Time Out reached the server in 6–7 s with app version 1004.

**Carry-overs / polish (deferred):**
- A cancelled line's status text is green on the phone (grey would read better).
- Unlisted item: the unit box accepted "6 pc" — add a hint ("e.g. pc, bag, m").
- The trailing re-run also re-drains requests, so a failing request can use 2 of its 10 tries per send.
- Still from the reviews: half-typed item lost on app kill (parked); catalogue item with empty unit; needed-by picker opens on today; detail actions lack try/catch for local-store errors; Change quantity offered on a conflicted line; some screen copy English-only; no 360dp test (looked fine on the phone).
- **1a-4 Pilot** next: two workers + a leader, permission checks, spec §9 acceptance rows. Publishing the APK (Attendance → App updates, stream `com.dacs.workmate`) only when the user asks.
