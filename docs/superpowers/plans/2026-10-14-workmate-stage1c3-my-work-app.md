# WorkMate Stage 1c-3 — My Work in the App (0.6.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WorkMate 0.6.0 gives workers a **My Work** tab:
- their published tasks by Today / Upcoming / Waiting / Done, with new and changed ones highlighted and a red number on the tab;
- "I've read this" for the exact version on screen;
- the responsible person's Start work, progress (with an optional photo) and Report done, locked while blocked;
- anyone on the task can report a problem (optional photo, optional link to one of their own requests, a shortcut to Requests);
- a leader can check reported work;
- shared meeting notes, and a team leader's **My proposals** with a propose form.

Everything works offline and is sent once. A release build and a phone pilot against the live server close it out.

**Architecture:** A new `lib/workplan/` feature beside `lib/requests/`, layered like it:
- `domain/`: plain models of what 0093/0094 send, the action/section rules and failures;
- `data/`: `WorkPlanRemote` RPC calls, `WorkPlanDb` (a sqflite send-once queue plus the last lists read) and `WorkPlanRepository` behind the `WorkPlanApi` interface;
- `sync/`: `WorkPlanSync`, which drains the queue in order and links each photo to the problem or progress note it belongs to;
- `ui/`: the controller, the screens and the Home card.

The existing background drain sends My Work after attendance and requests, in the same WorkManager work. `HomeShell` gains a **My Work** tab and card. `main.dart` builds the repository and keeps only the signed-in worker's saved copy.

**Tech Stack:** Flutter (Dart ^3.10.8, flutter_lints 6), sqflite (+ `sqflite_common_ffi` in tests), supabase_flutter 2.17.2 (`rpc`, `storage.upload`, `createSignedUrl`). It uses the existing UI kit: `FailureNotice`, `noticeAction`, `Bilingual`, `StatusPill`, `WmColors`, `dayMonth`/`clockTime`/`calendarDay`, `WorkDate`. **No new packages.**

**Spec:** `docs/superpowers/specs/2026-09-30-workmate-meetings-work-plan-design.md` (Dacs Web repo). The relevant parts are §6 (two views), §7 (acknowledgements), §8 (blockers), §11 (offline), §12 (screens), §13 (checks) and **§15 decisions**, including leader proposals.

**Server (live):**
- `supabase/migrations/0093_workmate_my_work.sql` (live 2026-10-12): worker RPCs §4–§5 and the `task-photos` bucket §3;
- `0094_workmate_work_plan_office.sql` (live 2026-10-13): `wp_my_proposals`;
- `0085` provides `pr_destinations` and `pr_my_teams`.

**Office screens:** plan 1c-2, live since 2026-10-14.

**User decisions (14 October 2026):**
- the version is **0.6.0+1006**;
- a new **My Work tab** between Home and Requests, with a red number, plus a Home card;
- a materials/tool problem may **link one of the worker's own open requests for that project**, and offers a **"Make a request" shortcut to Requests** that sends nothing by itself.

## Review findings this revision answers (14 October 2026, revision 3)

Codex ran revision 2 in an isolated copy. The 20 repository tests passed, but two more regression tests failed. Both failures were reproduced here before being fixed.

1. **A late refresh overwrote an accepted action.** A refresh asked the server before a problem was accepted, then saved its older answer after the accepted task had been saved, which unlocked Report done again.
   - **Fix:** `settle` now also records the server's answer in `wp_accepted`, numbered per worker (`wp_accepted_seq`).
   - A read takes the newest number (`acceptedSeq`) **before** asking the server. When it saves, every task with an answer numbered above it keeps that answer: the read is older than the action. Answers at or below it are already in the server's list, so they are forgotten.
   - It lives in the database, so it also holds for the background sync, which uses its own connection.
   - **Tests:**
     - "an older refresh cannot overwrite an accepted problem" (the review's test);
     - the same through a second connection, as the WorkManager engine;
     - "an accepted answer never hides a later office change: a newer read wins".
2. **Proposal choices survived an account switch during the database saves.**
   - **Fix:** every save of read lists goes through `saveLists`, ONE transaction that first checks the worker is unchanged. A sign-out's cleanup (`keepCacheOnly`, now also one transaction) therefore either ran first and refuses the save, or runs after and removes it.
   - `choices()` checks again after the save.
   - `putCache` is gone, so no unguarded save remains.
   - **Tests:**
     - "choices reject a switch during the awaited saves, and never write back a wiped copy" (the review's test, plus the wiped-copy assertion);
     - "choices reject a switch that lands while the save commits".
3. **Pilot check 12.** C was already read in check 3. Now the office revises C first, then, offline, the worker reads that revision and taps Start, then the office revises C again before the phone reconnects.

**Put-back checks for revision 3.** Each fix was removed in turn to see whether the tests catch it:

| Fix removed | Caught? |
|---|---|
| The accepted answer is no longer saved | ✅ by 4 tests |
| An older read may overwrite an accepted answer | ✅ by 2 tests |
| The save is not checked inside its transaction | ✅ by 3 tests |
| `choices()` has no check after the save | ✅ by the commit-switch test |
| `load()` has no account checks | ✅ by 3 tests |
| A leftover photo is not counted | ✅ |
| Old accepted answers are never forgotten | ❌ not caught |

The last one is not caught, by design. Forgetting old answers is housekeeping that keeps the table small; showing them already depends on the number comparison, so nothing a worker sees changes. It is recorded here instead of adding a test-only hook.

## Revision 2 (14 October 2026)

1. **Accepted actions discarded the server's updated task.** A later failed refresh could restore the old saved copy and unlock buttons after a problem was accepted.
   - **Fix:** `WorkPlanDb.settle` saves the returned task, in the same transaction, before the action leaves the queue.
   - **Tests:** "an accepted problem keeps the server's task…" and "an outdated read keeps the server's newer task…".
2. **Late reads could recreate a previous worker's saved copy after sign-out, and proposal choices could mix two workers' answers.**
   - **Fix:** the repository checks that the worker is unchanged right before every save and after the last wait of a read (`AUTH_REQUIRED` otherwise).
   - **Tests:** four (sign-out, a switch online, a switch offline, choices).
3. **A photo still waiting after its report landed vanished from the pending count.**
   - **Fix:** `visiblePending` counts a report and its photo once, and a leftover photo on its own.
   - **Tests:** one repository test and one rules test.
4. **Pilot corrections.** Check 3 now reads C before expecting it under Waiting. Check 13 switches accounts online (sign-in needs signal), then checks the offline copy.

Each code fix was checked by putting the bug back. Every new test failed against the old code: tests for 1 caught it, tests for 2 caught it (the sign-out save, the account switch and the choices), and tests for 3 caught it.

## Global Constraints

**Repo and files**
- **Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`, clean at `b018f53`, version `0.5.0+1005`. Paths below are relative to it; this plan file lives in the Dacs Web repo.
- **NEVER `git commit` / `git push`** in either repo. The user commits. Every task ends "Stop — no commit".
- **Write files with the Edit tool or Python** (`open(p, 'w', encoding='utf-8', newline='')`), **never PowerShell text output**. All WorkMate files are **LF, UTF-8, no BOM**; keep them so. (`core.autocrlf` is `true` on this PC; files are still checked out LF.)
- **Done means:** the task's tests pass, the whole `flutter test` passes, and `flutter analyze` prints `No issues found!`.

**Server contract (no database changes; 0093/0094 are live)**
- **Worker reads, verbatim:** `wp_my_work()` → task docs; `wp_my_notes()`; `wp_my_proposals()`; `pr_destinations()`; `pr_my_teams()`.
- **Worker writes, verbatim (each takes a client-made `p_op` uuid, minted once and reused on every retry):**
  - `wp_acknowledge(p_op, p_task, p_version)` → `{stale, task}`
  - `wp_start_work(p_op, p_task)`
  - `wp_report_progress(p_op, p_task, p_note)` → `{event_id, task}`
  - `wp_report_blocker(p_op, p_task, p_kind, p_description, p_request)` → `{blocker_id, task}`; kind ∈ materials / tool / preparation / other
  - `wp_report_done(p_op, p_task, p_note)`
  - `wp_leader_check(p_op, p_task, p_note)`
  - `wp_propose_task(p_op, p_team, p_folder, p_work, p_title, p_details)`
  - `wp_attach_photo(p_op, p_task, p_blocker, p_event, p_path)`
- **Server codes:**
  - `NOT_A_REQUESTER`, `NOT_ASSIGNED`, `NOT_RESPONSIBLE`, `BAD_STATE`, `TASK_BLOCKED`, `NOT_ACKNOWLEDGED`;
  - `NOTE_REQUIRED`, `BAD_KIND`, `BAD_REQUEST`, `OWN_WORK`, `NOT_LEADER`, `BAD_DESTINATION`, `TITLE_REQUIRED`;
  - `BAD_LINK`, `BAD_PATH`, `PHOTO_NOT_UPLOADED`, `BAD_OPERATION`, `APP_UPDATE_REQUIRED`, `AUTH_REQUIRED`.

**Photos**
- They go to the private bucket **`task-photos`** at `<worker>/<task>/<photo>.jpg`.
- **Upload first, then `wp_attach_photo`.** Workers have no storage UPDATE, so "already exists" on a retry is success.
- Each photo is linked to its problem (`blocker_id`) or progress note (`event_id`) once that report has landed.
- **The phone copy is deleted only after the attach succeeded.**

**Shared phones (spec §11)**
- Every read, cache row and queued action is scoped to the worker the app let in. Nothing is read, queued or sent under nobody.
- Every write first checks that the current session is the queued worker (`AUTH_REQUIRED` otherwise).
- Only the let-in worker's saved lists are kept. **Unsent actions are never deleted by cleanup.**
- **An answer that arrives after a sign-out or an account switch is neither saved nor shown** (`AUTH_REQUIRED`).
  - The check runs **inside** each save's transaction (`WorkPlanDb.saveLists`), so it is ordered against the sign-out cleanup.
  - It runs again after the last wait of a read, and after the proposal-choices save.
  - A copy wiped at sign-out is never written back, and proposal choices never mix two workers' answers.

**Rules the phone applies (the server re-checks all of them at send)**
- Start work needs the **current version read** (0093 `NOT_ACKNOWLEDGED`).
- **Start work and Report done stay locked while blocked**, which includes a problem reported from this phone and not yet cleared.
- Only the responsible person starts, reports progress or reports done. Anyone on the task reports a problem.
- A leader checks only work they are not assigned to (`can_check`), and **the office still gives the final approval**.
- A reported problem **never creates a purchase** and only the office clears it.

**Content and wording**
- **What the worker never sees:** office notes, the AI source passage, office flags, anyone's acknowledgements, prices or amounts. 0093 already filters these, and the app shows only what it gets. **No money anywhere.**
- **Copy:** screen text is English; failure text is bilingual, English then Tagalog, like Attendance and Requests.
- **Dates:** "today" is Manila's (`WorkDate.of(now).iso`). Planned dates are calendar strings shown with `calendarDay`. Never use `toIso8601String().substring(0, 10)` for a local day.
- **No phone push** (spec §15). The app shows what is new when it opens: the tab number and the Home card.

**Release**
- `flutter build apk --release` (never `--split-per-abi`), with `JAVA_HOME` set to JDK 21.
- The keystore and its passwords never go to git and are never printed.

## Rulings made while planning

- **Own database file** `workmate_workplan.db`, like Requests' `workmate_requests.db` and History's `workmate_history.db`. A My Work problem can then never break Attendance or Requests. *Cost if wrong: a one-file move later.*
- **Sections:**
  - **Today**: anything to read or to check (whatever its dates), work in progress, and not-started work whose start is today or earlier or has no date.
  - **Upcoming**: not started, with a later start.
  - **Waiting**: blocked, or reported done / checked by the leader (waiting for the office).
  - **Done**: completed in the last 14 days (0093 keeps them 14 days).
  - **Late** is flagged on a card when the planned end has passed and the work is not reported yet.
  - *Cost if wrong: one function (`groupOf`).*
- **The tab's number** counts tasks to read, plus work to check, plus actions the server refused. Pending (unsent) actions are shown on Home and in the tab, not counted in the number.
- **Proposals offer the same project list as Requests** (`pr_destinations`, so only projects open for requests) and only the teams the leader currently leads. The office can still create tasks anywhere. *Cost if wrong: a project closed for requests cannot get a proposal from the phone.*
- **Problem → request link** offers only the worker's **own** received, not-cancelled requests for the task's project. 0093 would accept any request of that project; "their own" is what the user chose. The shortcut opens the Requests tab and prefills nothing.
- **One optional photo per report.** Spec §15 says "optional photo"; the server would take more.
- **Offline order:**
  - Start may be queued right after a queued "I've read this" of the same version, and Report done after a queued Start. The queue sends in that order.
  - If the office revised the task meanwhile, the read is answered "stale" (not an error) and the task shows as Changed again. The queued Start is refused (`NOT_ACKNOWLEDGED`) and shown with its reason.
- **A refused report's photo is part of that refusal.** It is shown and dismissed with it, and counted once.
- **Counting what is still on the phone:**
  - A report and its photo waiting together are one item.
  - A photo still waiting after its report landed (for example, the upload failed) is an item of its own. It stays in Home's and the tab's pending count until it is sent.
- **An accepted action keeps the server's answer** (review finding, 14 Oct). 0093 answers each accepted action with the task as it now stands. In one transaction, the phone:
  1. links the action's photos;
  2. replaces that task in the saved list with the answer;
  3. only then removes the action from the queue.

  A refresh that fails afterwards can then never bring back the state from before the action, for example unlocking Report done after a problem was accepted. The saved list is only patched, never created, so a copy wiped at sign-out stays wiped.
- **A read that started before an accepted action never overwrites its answer** (revision 3). Accepted answers are numbered per worker in the database, and each read remembers the number from before it asked the server. This holds across the app and the background engine. A read that started after the action wins, so a later office change (for example, clearing the problem) is never hidden.
- **The three lists are read in parallel**, so a weak signal costs one timeout, not three. When the task list cannot be read, the screen says so; notes and proposals fall back to the saved copy on their own.

## File structure

| File | Responsibility |
|---|---|
| `lib/workplan/domain/wp_task.dart` (C) | `WpTask` (+ `WpStatus`, `WpRole`, `WpPerson`, `WpBlocker`, `WpWaiting`, `WpPhoto`, `WpEvent`), `WpNote`, `WpProposal` (+ `WpProposalState`) |
| `lib/workplan/domain/wp_op.dart` (C) | `WpOp` + `WpOpKind`: one queued action |
| `lib/workplan/domain/wp_failure.dart` (C) | `WpFailure` (server codes and network errors → what the worker is told), `maxWpAttempts` |
| `lib/workplan/domain/wp_rules.dart` (C) | `WpEntry`, `WpActions`/`actionsFor`, `WpLock`, `WpGroup`/`groupOf`, `isLate`, `WpUpdates`/`summarizeWork`, `visibleFailures` |
| `lib/workplan/ui/workplan_copy.dart` (C) | Labels and bilingual failure copy |
| `lib/workplan/data/workplan_remote.dart` (C) | `WorkPlanRemote` + `SupabaseWorkPlanRemote`, param builders, `taskPhotoPath` |
| `lib/workplan/data/workplan_db.dart` (C) | `WorkPlanDb`: `wp_op` queue, `wp_cache` (per worker) |
| `lib/workplan/data/workplan_api.dart` (C) | `WorkPlanApi` interface, `WorkPlanView`, `WpChoices`, `WpInvalid`, `wpProblemKinds` |
| `lib/workplan/data/workplan_repository.dart` (C) | Offline-first reads and actions |
| `lib/workplan/data/workplan_account_wipe.dart` (C) | Keeps only the signed-in worker's saved copy |
| `lib/workplan/sync/workplan_sync.dart` (C) | Drains the queue in order; links photos |
| `lib/attendance/sync/background_sync.dart` (M) | My Work drained after requests; its own probe |
| `lib/workplan/workplan_services.dart` (C) | `WorkPlanServices` (api, camera, changed, requests) |
| `lib/workplan/ui/*.dart` (C) | Controller, My Work list, task screen, report forms, notes, proposals, Home card, shared widgets |
| `lib/ui/home_shell.dart`, `lib/app.dart`, `lib/main.dart`, `pubspec.yaml` (M) | My Work tab, badge and card; wiring; version `0.6.0+1006` |
| `test/workplan/**` (C), `test/attendance/sync/background_sync_test.dart`, `test/ui/screens_test.dart` (M) | Samples, fakes, rules / repository / sync / wipe / screen tests |

---

### Task 1: Models, rules, failures and wording

**Files:**
- Create: `lib/workplan/domain/wp_task.dart`, `lib/workplan/domain/wp_op.dart`, `lib/workplan/domain/wp_failure.dart`, `lib/workplan/domain/wp_rules.dart`, `lib/workplan/ui/workplan_copy.dart`
- Test: `test/workplan/workplan_samples.dart` (shared JSON samples), `test/workplan/domain/wp_rules_test.dart`

**Interfaces:**
- Consumes:
  - `Destination`, `MyTeam`, `TeamMember` (`lib/requests/domain/request_models.dart`);
  - `Bilingual`, `failureCopy`, `AttendanceFailure` (`lib/attendance/ui/attendance_copy.dart`, `lib/attendance/domain/attendance_failure.dart`).
- Produces (later tasks rely on these exact names):
  - `WpStatus {notStarted, inProgress, reportedDone, leaderChecked, completed}` (`.wire`, `parse`); `WpRole {responsible, helper, leader}` (`parse`).
  - `WpTask.fromJson(Map) → WpTask?` (null for an unknown status or role). Fields: `id, meetingId, title, instructions, projectId, projectName, workId, workName, teamId, teamName, status, sentBack, blocked, plannedStart, plannedEnd, version, versionAt, completedAt, responsible (WpPerson?), helpers, blockers (WpBlocker), waitingFor (WpWaiting), photos (WpPhoto), history (WpEvent), myRole, myAckVersion, canCheck`. Getters: `where`, `assigned`, `needsReading`, `changedSinceRead`, `latestChange`.
  - `WpNote.fromJson`: `meetingId, title, heldOn, version, sharedNotes, changeNote, publishedAt`.
  - `WpProposal.fromJson`: `id, title, projectName, workName, proposedAt, state (WpProposalState {sent, published, declined, cancelled}), reason, decidedAt, where`.
  - `WpOpKind {acknowledge, start, progress, blocker, done, check, propose, photo}`.
  - `WpOp`:
    - fields `opId, workerId, kind, createdAt, taskId, parentOpId, blockerId, eventId, body, seq, attempts, lastError, failedPermanently`;
    - getters `version, note, localPath, photoId`;
    - `toMap`, `WpOp.fromMap`.
  - `WpFailure`: values `{notAssigned, notResponsible, badState, taskBlocked, notAcknowledged, noteRequired, badRequest, ownWork, notLeader, badDestination, titleRequired, photoNotUploaded, notARequester, appUpdateRequired, sessionExpired, noConnection, unexpected}`; functions `.of(Object)`, `.fromStored(String?)`; getters `.retryable`, `.countsTowardCap`. Constant `maxWpAttempts = 10`.
  - `WpEntry({task, pendingOps, failedOps})`:
    - `pending(kind)`, `ackPending`, `toRead`, `toCheck`, `effectiveStatus`, `blocked`, `shownFailures`, `shownPending`.
  - Rules:
    - `actionsFor(WpEntry) → WpActions{acknowledge, start, startLock, progress, problem, done, doneLock, check}` and `WpLock {blocked, mustRead}`;
    - `WpGroup {today, upcoming, waiting, done}`, `groupOf(WpEntry, String today)`, `isLate(WpEntry, String today)`;
    - `WpUpdates{toRead, toCheck, pending, failed, notes, badge, isEmpty}`, `summarizeWork(entries, {notes, otherPending, otherFailed})`;
    - `visibleFailures(List<WpOp>)` and `visiblePending(List<WpOp>)`: a report and its photo count as one item; a photo left after its report landed counts on its own.
  - Copy (`workplan_copy.dart`):
    - labels: `statusLabel(WpStatus, {sentBack})`, `roleLabel`, `groupLabel`, `problemKindLabel`, `proposalStateLabel`, `opLabel(WpOp)`, `lockText(WpLock)`;
    - failure copy: `wpFailureCopy(WpFailure) → Bilingual`, `opFailureCopy(WpOp)`, `photoNotSentCopy`, `notAcceptedLead`, `photoNotKeptCopy`;
    - `savedOnPhoneText`.

- [ ] **Step 1: Write the samples and the failing test**

Create `test/workplan/workplan_samples.dart`:

```dart
import 'package:workmate/requests/domain/request_models.dart';
import 'package:workmate/workplan/domain/wp_task.dart';

/// One task as 0093 wp_task_doc sends it to a worker. Override any field.
Map<String, dynamic> taskDoc({
  String id = 't1',
  String title = 'Wall prep',
  String status = 'not_started',
  String role = 'responsible',
  int version = 1,
  int? ackVersion,
  bool blocked = false,
  bool canCheck = false,
  bool sentBack = false,
  String? start = '2026-10-14',
  String? end = '2026-10-16',
  List<Map<String, dynamic>> blockers = const [],
  List<Map<String, dynamic>> waitingFor = const [],
  List<Map<String, dynamic>> history = const [],
  List<Map<String, dynamic>> photos = const [],
  String folder = 'f1',
}) =>
    {
      'id': id,
      'meeting_id': 'm1',
      'title': title,
      'instructions': 'Skim coat the master bedroom.',
      'folder_id': folder,
      'project_name': 'Barlin Residence',
      'work_id': folder,
      'work_name': 'Main Contract',
      'team_id': 'tm1',
      'team_name': 'Team pilot B',
      'status': status,
      'sent_back': sentBack,
      'blocked': blocked,
      'planned_start': start,
      'planned_end': end,
      'version': version,
      'version_at': '2026-10-14T01:00:00+00:00',
      'published_at': '2026-10-14T01:00:00+00:00',
      'completed_at': status == 'completed' ? '2026-10-15T09:00:00+00:00' : null,
      'updated_at': '2026-10-14T01:00:00+00:00',
      'responsible': {'id': 'u1', 'name': 'John Tapales'},
      'helpers': [
        {'id': 'u2', 'name': 'Danilo Tapales'},
      ],
      'blockers': blockers,
      'waiting_for': waitingFor,
      'photos': photos,
      'history': history,
      'my_role': role,
      'my_ack_version': ackVersion,
      'can_check': canCheck,
    };

WpTask task0([Map<String, dynamic>? doc]) => WpTask.fromJson(doc ?? taskDoc())!;

Map<String, dynamic> noteDoc({String id = 'm1', int version = 1}) => {
      'meeting_id': id,
      'title': 'Site meeting',
      'held_on': '2026-10-14',
      'version': version,
      'shared_notes': 'Skim coat first, then cabinets.',
      'change_note': '',
      'published_at': '2026-10-14T02:00:00+00:00',
    };

Map<String, dynamic> proposalDoc({String id = 'p1', String status = 'sent', String? reason}) => {
      'id': id,
      'title': 'Fix the gate',
      'project_name': 'Barlin Residence',
      'work_name': 'Main Contract',
      'proposed_at': '2026-10-13T02:00:00+00:00',
      'status': status,
      'reason': reason,
      'decided_at': status == 'sent' ? null : '2026-10-14T02:00:00+00:00',
    };

const barlin = Destination(projectId: 'f1', projectName: 'Barlin Residence', workId: 'f1', workName: 'Main Contract', isMain: true);
const pilotB = MyTeam(id: 'tm1', name: 'Team pilot B', iLead: true, members: [TeamMember(id: 'u1', name: 'John Tapales')]);
const otherTeam = MyTeam(id: 'tm2', name: 'Masonry A', iLead: false, members: []);
```

Create `test/workplan/domain/wp_rules_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:workmate/workplan/domain/wp_failure.dart';
import 'package:workmate/workplan/domain/wp_op.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';
import 'package:workmate/workplan/domain/wp_task.dart';

import '../workplan_samples.dart';

WpOp op(WpOpKind kind, {int? version, String task = 't1'}) => WpOp(
      opId: 'o-${kind.name}',
      workerId: 'u1',
      kind: kind,
      createdAt: DateTime.utc(2026, 10, 14),
      taskId: task,
      body: {'version': ?version},
    );

void main() {
  const today = '2026-10-14';

  group('reading a task', () {
    test('every worker field is read; office-only fields do not exist', () {
      final t = task0(taskDoc(
        history: [
          {'id': 1, 'kind': 'published', 'note': '', 'by': 'Office', 'at': '2026-10-14T01:00:00+00:00'},
          {'id': 2, 'kind': 'revised', 'note': 'Changed: planned dates', 'by': 'Office', 'at': '2026-10-14T02:00:00+00:00'},
        ],
        blockers: [
          {'id': 'b1', 'kind': 'materials', 'description': 'No cement', 'request_id': 'r1', 'reported_at': '2026-10-14T03:00:00+00:00', 'reported_by': 'Danilo'},
        ],
        photos: [
          {'id': 'p1', 'path': 'u1/t1/x.jpg', 'blocker_id': 'b1', 'event_id': null, 'created_at': '2026-10-14T03:00:00+00:00'},
        ],
      ));
      expect(t.where, 'Barlin Residence · Main Contract');
      expect(t.responsible!.name, 'John Tapales');
      expect(t.helpers.single.name, 'Danilo Tapales');
      expect(t.blockers.single.requestId, 'r1');
      expect(t.photos.single.blockerId, 'b1');
      expect(t.latestChange, 'Changed: planned dates');
      expect(t.myRole, WpRole.responsible);
    });

    test('an unknown state or role is skipped, never guessed', () {
      expect(WpTask.fromJson(taskDoc(status: 'draft')), isNull);
      expect(WpTask.fromJson(taskDoc(role: 'owner')), isNull);
    });

    test('new, changed and read', () {
      expect(task0(taskDoc(version: 1)).needsReading, isTrue);
      expect(task0(taskDoc(version: 1)).changedSinceRead, isFalse, reason: 'never read: New, not Changed');
      expect(task0(taskDoc(version: 2, ackVersion: 1)).changedSinceRead, isTrue);
      expect(task0(taskDoc(version: 2, ackVersion: 2)).needsReading, isFalse);
      expect(task0(taskDoc(role: 'leader')).needsReading, isFalse, reason: 'a leader not on the task does not acknowledge');
    });
  });

  group('actions', () {
    test('the responsible person must read before starting', () {
      final a = actionsFor(WpEntry(task: task0()));
      expect(a.acknowledge, isTrue);
      expect(a.start, isTrue);
      expect(a.startLock, WpLock.mustRead);
    });

    test('a queued "I\'ve read this" for THIS version unlocks Start', () {
      final e = WpEntry(task: task0(), pendingOps: [op(WpOpKind.acknowledge, version: 1)]);
      expect(e.toRead, isFalse);
      expect(actionsFor(e).startLock, isNull);
      final old = WpEntry(task: task0(taskDoc(version: 2, ackVersion: 1)), pendingOps: [op(WpOpKind.acknowledge, version: 1)]);
      expect(old.toRead, isTrue, reason: 'reading version 1 never acknowledges version 2');
    });

    test('blocked locks Start and Report done; reading and problems stay open', () {
      final e = WpEntry(task: task0(taskDoc(blocked: true, ackVersion: 1)));
      final a = actionsFor(e);
      expect(a.startLock, WpLock.blocked);
      expect(a.problem, isTrue);
      final working = actionsFor(WpEntry(task: task0(taskDoc(status: 'in_progress', blocked: true, ackVersion: 1))));
      expect(working.done, isTrue);
      expect(working.doneLock, WpLock.blocked);
    });

    test('a problem reported from this phone locks Report done until the office clears it', () {
      final e = WpEntry(task: task0(taskDoc(status: 'in_progress', ackVersion: 1)), pendingOps: [op(WpOpKind.blocker)]);
      expect(actionsFor(e).doneLock, WpLock.blocked);
    });

    test('a queued Start lets the worker report done next, in order', () {
      final e = WpEntry(task: task0(taskDoc(ackVersion: 1)), pendingOps: [op(WpOpKind.start)]);
      expect(e.effectiveStatus, WpStatus.inProgress);
      final a = actionsFor(e);
      expect(a.start, isFalse);
      expect(a.done, isTrue);
    });

    test('helpers read and report problems; only the responsible person starts or reports', () {
      final a = actionsFor(WpEntry(task: task0(taskDoc(role: 'helper', ackVersion: 1))));
      expect(a.problem, isTrue);
      expect(a.start || a.progress || a.done, isFalse);
    });

    test('a leader checks reported work once; completed work offers nothing', () {
      final e = WpEntry(task: task0(taskDoc(role: 'leader', status: 'reported_done', canCheck: true)));
      expect(actionsFor(e).check, isTrue);
      expect(actionsFor(WpEntry(task: e.task, pendingOps: [op(WpOpKind.check)])).check, isFalse);
      final done = actionsFor(WpEntry(task: task0(taskDoc(status: 'completed', ackVersion: 1))));
      expect(done.problem || done.start || done.progress || done.done || done.check, isFalse);
    });
  });

  group('sections', () {
    WpGroup g(Map<String, dynamic> doc, {List<WpOp> pending = const []}) => groupOf(WpEntry(task: task0(doc), pendingOps: pending), today);

    test('what needs the worker is Today, whatever its dates', () {
      expect(g(taskDoc(start: '2026-10-20')), WpGroup.today, reason: 'unread');
      expect(g(taskDoc(role: 'leader', status: 'reported_done', canCheck: true)), WpGroup.today);
    });

    test('later start → Upcoming; blocked or reported → Waiting; completed → Done', () {
      expect(g(taskDoc(start: '2026-10-20', ackVersion: 1)), WpGroup.upcoming);
      expect(g(taskDoc(start: null, ackVersion: 1)), WpGroup.today);
      expect(g(taskDoc(blocked: true, ackVersion: 1)), WpGroup.waiting);
      expect(g(taskDoc(status: 'reported_done', ackVersion: 1)), WpGroup.waiting);
      expect(g(taskDoc(ackVersion: 1, status: 'in_progress'), pending: [op(WpOpKind.done)]), WpGroup.waiting);
      expect(g(taskDoc(status: 'completed', ackVersion: 1)), WpGroup.done);
    });

    test('late = planned end passed and not reported yet (Manila dates)', () {
      expect(isLate(WpEntry(task: task0(taskDoc(end: '2026-10-13', ackVersion: 1))), today), isTrue);
      expect(isLate(WpEntry(task: task0(taskDoc(end: '2026-10-14', ackVersion: 1))), today), isFalse);
      expect(isLate(WpEntry(task: task0(taskDoc(end: '2026-10-13', status: 'reported_done'))), today), isFalse);
    });
  });

  test('the badge counts what needs the worker; a waiting report and its photo are one pending item', () {
    final report = op(WpOpKind.blocker, task: 't3');
    final photo = WpOp(
        opId: 'o-photo3', workerId: 'u1', kind: WpOpKind.photo, createdAt: DateTime.utc(2026), taskId: 't3', parentOpId: report.opId);
    final u = summarizeWork([
      WpEntry(task: task0()),
      WpEntry(task: task0(taskDoc(id: 't2', role: 'leader', status: 'reported_done', canCheck: true))),
      WpEntry(task: task0(taskDoc(id: 't3', ackVersion: 1)), pendingOps: [report, photo]),
    ], otherFailed: 1);
    expect([u.toRead, u.toCheck, u.pending, u.failed, u.badge], [1, 1, 1, 1, 3]);
  });

  test('a photo refused with its report is one refusal, not two', () {
    final report = op(WpOpKind.blocker);
    final photo = WpOp(
        opId: 'o-photo', workerId: 'u1', kind: WpOpKind.photo, createdAt: DateTime.utc(2026), taskId: 't1', parentOpId: report.opId);
    expect(visibleFailures([report, photo]), [report]);
    expect(visibleFailures([photo]), [photo], reason: 'a photo refused on its own is shown');
    expect(summarizeWork([WpEntry(task: task0(taskDoc(ackVersion: 1)), failedOps: [report, photo])]).failed, 1);
  });

  test('a report and its photo wait as one item; a photo left after its report landed is its own', () {
    final report = op(WpOpKind.progress);
    final photo = WpOp(
        opId: 'o-photo2', workerId: 'u1', kind: WpOpKind.photo, createdAt: DateTime.utc(2026), taskId: 't1', parentOpId: report.opId);
    expect(visiblePending([report, photo]), [report]);
    expect(visiblePending([photo]), [photo]);
    expect(summarizeWork([WpEntry(task: task0(taskDoc(ackVersion: 1)), pendingOps: [photo])]).pending, 1);
  });

  group('failures', () {
    test('server codes', () {
      expect(WpFailure.of(const PostgrestException(message: 'NOT_ACKNOWLEDGED')), WpFailure.notAcknowledged);
      expect(WpFailure.of(const PostgrestException(message: 'TASK_BLOCKED')), WpFailure.taskBlocked);
      expect(WpFailure.of(const PostgrestException(message: 'NOT_A_REQUESTER')), WpFailure.notARequester);
      expect(WpFailure.of(const PostgrestException(message: 'NOT_ASSIGNED')), WpFailure.notAssigned);
      expect(WpFailure.of(StateError('AUTH_REQUIRED')), WpFailure.sessionExpired);
      expect(WpFailure.of(const SocketException('down')), WpFailure.noConnection);
      expect(WpFailure.of(StateError('something else')), WpFailure.unexpected);
    });

    test('only the moment is worth retrying, never the content', () {
      expect(WpFailure.noConnection.retryable, isTrue);
      expect(WpFailure.notAcknowledged.retryable, isFalse);
      expect(WpFailure.taskBlocked.retryable, isFalse);
      expect(WpFailure.fromStored('PHOTO_MISSING'), WpFailure.unexpected);
    });
  });
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `flutter test test/workplan/domain`
Expected: FAIL to compile, because `package:workmate/workplan/domain/...` does not exist yet.

- [ ] **Step 3: Write the models**

Create `lib/workplan/domain/wp_task.dart`:

```dart
/// A task as the worker is shown it (0093 wp_task_doc, worker part): never
/// the office's notes, source passage, flags or anyone's acknowledgements.
/// Quantities and money do not exist here.
library;

enum WpStatus {
  notStarted('not_started'),
  inProgress('in_progress'),
  reportedDone('reported_done'),
  leaderChecked('leader_checked'),
  completed('completed');

  const WpStatus(this.wire);
  final String wire;

  /// Null for a state this build does not know (drafts and cancelled tasks
  /// never reach a worker).
  static WpStatus? parse(String? value) => values.where((s) => s.wire == value).firstOrNull;
}

/// The caller's part in a task. A leader who is also assigned is
/// responsible or helper — the server answers the assignment first.
enum WpRole {
  responsible,
  helper,
  leader;

  static WpRole? parse(String? value) => values.where((r) => r.name == value).firstOrNull;
}

DateTime? _instant(Object? v) => v == null ? null : DateTime.parse(v as String);

List<Map<String, dynamic>> _list(Object? v) => [for (final e in (v as List<dynamic>? ?? const [])) Map<String, dynamic>.from(e as Map)];

class WpPerson {
  const WpPerson({required this.id, required this.name});

  factory WpPerson.fromJson(Map<String, dynamic> j) => WpPerson(id: j['id'] as String, name: (j['name'] as String?) ?? '');

  final String id;
  final String name;
}

/// An open problem. Only the office clears it, after checking (spec §8).
class WpBlocker {
  const WpBlocker({
    required this.id,
    required this.kind,
    required this.description,
    required this.reportedAt,
    required this.reportedBy,
    this.requestId,
  });

  factory WpBlocker.fromJson(Map<String, dynamic> j) => WpBlocker(
        id: j['id'] as String,
        kind: (j['kind'] as String?) ?? 'other',
        description: (j['description'] as String?) ?? '',
        requestId: j['request_id'] as String?,
        reportedAt: DateTime.parse(j['reported_at'] as String),
        reportedBy: (j['reported_by'] as String?) ?? '',
      );

  final String id;

  /// materials / tool / preparation / other.
  final String kind;
  final String description;
  final String? requestId;
  final DateTime reportedAt;
  final String reportedBy;
}

/// An earlier task this one waits for (only unfinished ones are sent).
class WpWaiting {
  const WpWaiting({required this.taskId, required this.title, required this.status});

  factory WpWaiting.fromJson(Map<String, dynamic> j) =>
      WpWaiting(taskId: j['task_id'] as String, title: (j['title'] as String?) ?? '', status: (j['status'] as String?) ?? '');

  final String taskId;
  final String title;
  final String status;
}

/// A photo the server lets THIS worker see (0093 filters them).
class WpPhoto {
  const WpPhoto({required this.id, required this.path, required this.createdAt, this.blockerId, this.eventId});

  factory WpPhoto.fromJson(Map<String, dynamic> j) => WpPhoto(
        id: j['id'] as String,
        path: j['path'] as String,
        blockerId: j['blocker_id'] as String?,
        eventId: (j['event_id'] as num?)?.toInt(),
        createdAt: DateTime.parse(j['created_at'] as String),
      );

  final String id;

  /// Inside the private task-photos bucket.
  final String path;
  final String? blockerId;
  final int? eventId;
  final DateTime createdAt;
}

/// One history line. A worker never sees acknowledgements or proposals here.
class WpEvent {
  const WpEvent({required this.id, required this.kind, required this.note, required this.by, required this.at});

  factory WpEvent.fromJson(Map<String, dynamic> j) => WpEvent(
        id: (j['id'] as num).toInt(),
        kind: (j['kind'] as String?) ?? '',
        note: (j['note'] as String?) ?? '',
        by: (j['by'] as String?) ?? '',
        at: DateTime.parse(j['at'] as String),
      );

  final int id;
  final String kind;
  final String note;
  final String by;
  final DateTime at;
}

class WpTask {
  const WpTask({
    required this.id,
    required this.title,
    required this.instructions,
    required this.projectId,
    required this.projectName,
    required this.workId,
    required this.workName,
    required this.status,
    required this.version,
    required this.myRole,
    this.meetingId,
    this.teamId,
    this.teamName,
    this.sentBack = false,
    this.blocked = false,
    this.plannedStart,
    this.plannedEnd,
    this.versionAt,
    this.completedAt,
    this.responsible,
    this.helpers = const [],
    this.blockers = const [],
    this.waitingFor = const [],
    this.photos = const [],
    this.history = const [],
    this.myAckVersion,
    this.canCheck = false,
  });

  /// Null for a task this build cannot show (an unknown state or role).
  static WpTask? fromJson(Map<String, dynamic> j) {
    final status = WpStatus.parse(j['status'] as String?);
    final role = WpRole.parse(j['my_role'] as String?);
    if (status == null || role == null) return null;
    final resp = j['responsible'];
    return WpTask(
      id: j['id'] as String,
      meetingId: j['meeting_id'] as String?,
      title: (j['title'] as String?) ?? '',
      instructions: (j['instructions'] as String?) ?? '',
      projectId: j['folder_id'] as String,
      projectName: (j['project_name'] as String?) ?? '',
      workId: j['work_id'] as String,
      workName: (j['work_name'] as String?) ?? '',
      teamId: j['team_id'] as String?,
      teamName: j['team_name'] as String?,
      status: status,
      sentBack: j['sent_back'] == true,
      blocked: j['blocked'] == true,
      plannedStart: j['planned_start'] as String?,
      plannedEnd: j['planned_end'] as String?,
      version: (j['version'] as num?)?.toInt() ?? 1,
      versionAt: _instant(j['version_at']),
      completedAt: _instant(j['completed_at']),
      responsible: resp == null ? null : WpPerson.fromJson(Map<String, dynamic>.from(resp as Map)),
      helpers: _list(j['helpers']).map(WpPerson.fromJson).toList(),
      blockers: _list(j['blockers']).map(WpBlocker.fromJson).toList(),
      waitingFor: _list(j['waiting_for']).map(WpWaiting.fromJson).toList(),
      photos: _list(j['photos']).map(WpPhoto.fromJson).toList(),
      history: _list(j['history']).map(WpEvent.fromJson).toList(),
      myRole: role,
      myAckVersion: (j['my_ack_version'] as num?)?.toInt(),
      canCheck: j['can_check'] == true,
    );
  }

  final String id;
  final String? meetingId;
  final String title;
  final String instructions;
  final String projectId;
  final String projectName;
  final String workId;
  final String workName;
  final String? teamId;
  final String? teamName;
  final WpStatus status;

  /// The office sent the reported work back; cleared when it is reported again.
  final bool sentBack;

  /// An open problem or an unfinished earlier task (the server derives it).
  final bool blocked;

  /// Calendar dates ("2026-10-14"), never instants.
  final String? plannedStart;
  final String? plannedEnd;

  /// Rises with every change the people on it must read again.
  final int version;
  final DateTime? versionAt;
  final DateTime? completedAt;
  final WpPerson? responsible;
  final List<WpPerson> helpers;
  final List<WpBlocker> blockers;
  final List<WpWaiting> waitingFor;
  final List<WpPhoto> photos;

  /// Oldest first, as the server sends it.
  final List<WpEvent> history;
  final WpRole myRole;

  /// The newest version this worker acknowledged, or null.
  final int? myAckVersion;

  /// The server's "you may check this reported work" (a current leader, not
  /// assigned to it).
  final bool canCheck;

  /// "Barlin Residence · Main Contract".
  String get where => '$projectName · $workName';

  bool get assigned => myRole == WpRole.responsible || myRole == WpRole.helper;

  /// Assigned and the current version not yet acknowledged.
  bool get needsReading => assigned && (myAckVersion ?? 0) < version;

  /// Read before, but the office has changed it since (spec §7: highlight it).
  bool get changedSinceRead => assigned && myAckVersion != null && myAckVersion! < version;

  /// What the office wrote about the newest revision ("Changed: planned
  /// dates — …"), or null.
  String? get latestChange => history.where((e) => e.kind == 'revised').lastOrNull?.note;
}

/// The latest shared meeting notes this worker was chosen to receive.
class WpNote {
  const WpNote({
    required this.meetingId,
    required this.title,
    required this.heldOn,
    required this.version,
    required this.sharedNotes,
    required this.changeNote,
    required this.publishedAt,
  });

  factory WpNote.fromJson(Map<String, dynamic> j) => WpNote(
        meetingId: j['meeting_id'] as String,
        title: (j['title'] as String?) ?? '',
        heldOn: (j['held_on'] as String?) ?? '',
        version: (j['version'] as num?)?.toInt() ?? 1,
        sharedNotes: (j['shared_notes'] as String?) ?? '',
        changeNote: (j['change_note'] as String?) ?? '',
        publishedAt: DateTime.parse(j['published_at'] as String),
      );

  final String meetingId;
  final String title;

  /// A calendar date.
  final String heldOn;
  final int version;
  final String sharedNotes;
  final String changeNote;
  final DateTime publishedAt;
}

/// A leader's own proposal (0094 wp_my_proposals).
enum WpProposalState {
  sent,
  published,
  declined,
  cancelled;

  static WpProposalState parse(String? value) => values.where((s) => s.name == value).firstOrNull ?? sent;
}

class WpProposal {
  const WpProposal({
    required this.id,
    required this.title,
    required this.projectName,
    required this.workName,
    required this.proposedAt,
    required this.state,
    this.reason,
    this.decidedAt,
  });

  factory WpProposal.fromJson(Map<String, dynamic> j) => WpProposal(
        id: j['id'] as String,
        title: (j['title'] as String?) ?? '',
        projectName: (j['project_name'] as String?) ?? '',
        workName: (j['work_name'] as String?) ?? '',
        proposedAt: DateTime.parse(j['proposed_at'] as String),
        state: WpProposalState.parse(j['status'] as String?),
        reason: j['reason'] as String?,
        decidedAt: _instant(j['decided_at']),
      );

  final String id;
  final String title;
  final String projectName;
  final String workName;
  final DateTime proposedAt;
  final WpProposalState state;

  /// The office's reason, when it declined or cancelled it.
  final String? reason;
  final DateTime? decidedAt;

  String get where => '$projectName · $workName';
}
```

Create `lib/workplan/domain/wp_op.dart`:

```dart
import 'dart:convert';

/// One My Work change waiting to reach the server (spec §11: acknowledge,
/// report progress and report problems offline; send each once). [opId] is
/// minted once, at enqueue, and reused on every retry: the 0093 RPCs answer a
/// repeated operation id with their first answer.
enum WpOpKind {
  acknowledge,
  start,
  progress,
  blocker,
  done,
  check,
  propose,

  /// A photo for the progress note or problem report [WpOp.parentOpId] made.
  photo;

  static WpOpKind parse(String value) => values.byName(value);
}

class WpOp {
  const WpOp({
    required this.opId,
    required this.workerId,
    required this.kind,
    required this.createdAt,
    this.taskId,
    this.parentOpId,
    this.blockerId,
    this.eventId,
    this.body = const {},
    this.seq = 0,
    this.attempts = 0,
    this.lastError,
    this.failedPermanently = false,
  });

  factory WpOp.fromMap(Map<String, Object?> m) => WpOp(
        opId: m['op_id']! as String,
        workerId: m['worker_id']! as String,
        kind: WpOpKind.parse(m['kind']! as String),
        createdAt: DateTime.fromMillisecondsSinceEpoch(m['created_at']! as int, isUtc: true),
        taskId: m['task_id'] as String?,
        parentOpId: m['parent_op_id'] as String?,
        blockerId: m['blocker_id'] as String?,
        eventId: m['event_id'] as int?,
        body: Map<String, dynamic>.from(jsonDecode(m['body']! as String) as Map),
        seq: (m['seq'] as int?) ?? 0,
        attempts: (m['attempts'] as int?) ?? 0,
        lastError: m['last_error'] as String?,
        failedPermanently: m['failed_permanently'] == 1,
      );

  final String opId;

  /// Who queued it. Every read and every send is scoped to ONE worker: site
  /// phones are shared.
  final String workerId;
  final WpOpKind kind;
  final DateTime createdAt;

  /// The task it is about (null for a proposal).
  final String? taskId;

  /// photo: the progress / problem op it belongs to.
  final String? parentOpId;

  /// photo: filled in when its parent landed — the problem it shows, or the
  /// progress note's history line.
  final String? blockerId;
  final int? eventId;

  /// acknowledge: version; progress / done / check: note; blocker: kind,
  /// description, request_id; propose: team_id, folder_id, work_id, title,
  /// details, project_name, work_name; photo: local_path, photo_id.
  final Map<String, dynamic> body;

  /// Queue order (insertion order).
  final int seq;
  final int attempts;
  final String? lastError;
  final bool failedPermanently;

  int? get version => (body['version'] as num?)?.toInt();
  String get note => (body['note'] as String?) ?? '';
  String? get localPath => body['local_path'] as String?;
  String? get photoId => body['photo_id'] as String?;

  Map<String, Object?> toMap() => {
        'op_id': opId,
        'worker_id': workerId,
        'kind': kind.name,
        'created_at': createdAt.millisecondsSinceEpoch,
        'task_id': taskId,
        'parent_op_id': parentOpId,
        'blocker_id': blockerId,
        'event_id': eventId,
        'body': jsonEncode(body),
        'seq': seq,
        'attempts': attempts,
        'last_error': lastError,
        'failed_permanently': failedPermanently ? 1 : 0,
      };
}
```

Create `lib/workplan/domain/wp_failure.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart' show AuthRetryableFetchException;

/// Every way a My Work operation can be refused. The 0093 RPCs raise stable
/// codes; anything else is [unexpected], never a guess.
enum WpFailure {
  /// No longer on the task, or the task was cancelled / taken back as a draft.
  notAssigned,
  notResponsible,

  /// The task moved on meanwhile (started, reported, approved…).
  badState,
  taskBlocked,

  /// The office changed the task after this phone read it: read the new
  /// version first (0093 wp_start_work).
  notAcknowledged,
  noteRequired,
  badRequest,
  ownWork,
  notLeader,
  badDestination,
  titleRequired,
  photoNotUploaded,
  notARequester,
  appUpdateRequired,
  sessionExpired,
  noConnection,
  unexpected;

  // No code is a substring of another, so the first match is the only match.
  static const _byCode = <String, WpFailure>{
    'NOT_ASSIGNED': notAssigned,
    'NOT_RESPONSIBLE': notResponsible,
    'BAD_STATE': badState,
    'TASK_BLOCKED': taskBlocked,
    'NOT_ACKNOWLEDGED': notAcknowledged,
    'NOTE_REQUIRED': noteRequired,
    'BAD_REQUEST': badRequest,
    'OWN_WORK': ownWork,
    'NOT_LEADER': notLeader,
    'BAD_DESTINATION': badDestination,
    'TITLE_REQUIRED': titleRequired,
    'PHOTO_NOT_UPLOADED': photoNotUploaded,
    'NOT_A_REQUESTER': notARequester,
    'APP_UPDATE_REQUIRED': appUpdateRequired,
    'AUTH_REQUIRED': sessionExpired,
  };

  static WpFailure of(Object error) {
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

  /// A stored failure name back to the failure (local codes such as
  /// 'PHOTO_MISSING' read as [unexpected]).
  static WpFailure fromStored(String? name) => values.where((f) => f.name == name).firstOrNull ?? unexpected;

  /// Worth sending again later: the connection, the session or the moment —
  /// never the operation's own content, which would be refused again.
  bool get retryable => switch (this) {
        noConnection || sessionExpired || appUpdateRequired || photoNotUploaded || unexpected => true,
        _ => false,
      };

  /// Counts toward [maxWpAttempts]: one bad operation must not hold the
  /// worker's queue forever. Waiting for signal, a session or an update never counts.
  bool get countsTowardCap => this == unexpected || this == photoNotUploaded;
}

/// A failure that [WpFailure.countsTowardCap] this many times in a row is
/// treated as permanent.
const maxWpAttempts = 10;
```

Create `lib/workplan/domain/wp_rules.dart`:

```dart
import 'wp_op.dart';
import 'wp_task.dart';

/// Refused operations as the worker reads them: a photo refused only because
/// its report was refused is part of that report, not a second refusal.
List<WpOp> visibleFailures(List<WpOp> failed) =>
    failed.where((o) => o.kind != WpOpKind.photo || !failed.any((p) => p.opId == o.parentOpId)).toList();

/// Unsent operations as the worker reads them: a report and its photo are
/// one item while both wait; a photo still waiting after its report landed
/// is an item of its own.
List<WpOp> visiblePending(List<WpOp> pending) =>
    pending.where((o) => o.kind != WpOpKind.photo || !pending.any((p) => p.opId == o.parentOpId)).toList();

/// One My Work row: the server's task plus what this phone still owes the
/// server about it — so the screen never claims more than is true.
class WpEntry {
  const WpEntry({required this.task, this.pendingOps = const [], this.failedOps = const []});

  final WpTask task;
  final List<WpOp> pendingOps;
  final List<WpOp> failedOps;

  bool pending(WpOpKind kind) => pendingOps.any((o) => o.kind == kind);

  /// What to show as refused (see [visibleFailures]).
  List<WpOp> get shownFailures => visibleFailures(failedOps);

  /// What to show as still on the phone (see [visiblePending]).
  List<WpOp> get shownPending => visiblePending(pendingOps);

  /// "I've read this" is waiting to be sent for THIS version.
  bool get ackPending => pendingOps.any((o) => o.kind == WpOpKind.acknowledge && o.version == task.version);

  /// The current version still needs this worker's "I've read this".
  bool get toRead => task.needsReading && !ackPending;

  /// Reported work this leader may check, not already checked from this phone.
  bool get toCheck => task.canCheck && task.status == WpStatus.reportedDone && !pending(WpOpKind.check);

  /// The state this phone's queued actions will lead to, for the buttons.
  WpStatus get effectiveStatus {
    if (pending(WpOpKind.check)) return WpStatus.leaderChecked;
    if (pending(WpOpKind.done)) return WpStatus.reportedDone;
    if (pending(WpOpKind.start) && task.status == WpStatus.notStarted) return WpStatus.inProgress;
    return task.status;
  }

  /// Blocked as last read, or a problem reported from this phone that the
  /// office has not cleared yet (spec §14: a new problem locks Report done).
  bool get blocked => task.blocked || pending(WpOpKind.blocker);
}

/// Why Start work / Report done is locked, or null when it is not.
enum WpLock { blocked, mustRead }

/// What the worker can do now.
class WpActions {
  const WpActions({
    this.acknowledge = false,
    this.start = false,
    this.startLock,
    this.progress = false,
    this.problem = false,
    this.done = false,
    this.doneLock,
    this.check = false,
  });

  final bool acknowledge;

  /// Shown (enabled or locked) to the responsible person of a not-started task.
  final bool start;
  final WpLock? startLock;
  final bool progress;
  final bool problem;

  /// Shown (enabled or locked) to the responsible person of a task in progress.
  final bool done;
  final WpLock? doneLock;
  final bool check;
}

/// The rules of 0093, applied on the phone so a worker is never offered an
/// action the server would refuse. The server re-checks every one at send.
WpActions actionsFor(WpEntry e) {
  final t = e.task;
  final status = e.effectiveStatus;
  final responsible = t.myRole == WpRole.responsible;
  // Reading comes first: an offline Start after a revision must show the new
  // instructions before anything else (0093 NOT_ACKNOWLEDGED).
  final mustRead = e.toRead;
  final open = status != WpStatus.completed;
  return WpActions(
    acknowledge: e.toRead,
    start: responsible && status == WpStatus.notStarted,
    startLock: e.blocked ? WpLock.blocked : (mustRead ? WpLock.mustRead : null),
    progress: responsible && (status == WpStatus.notStarted || status == WpStatus.inProgress),
    // Anyone with a role, until the office approves it (0093 wp_report_blocker).
    problem: open,
    done: responsible && status == WpStatus.inProgress,
    doneLock: e.blocked ? WpLock.blocked : null,
    check: e.toCheck,
  );
}

/// The My Work sections (spec §12: Today / Upcoming / Waiting).
enum WpGroup { today, upcoming, waiting, done }

/// [today] is Manila's calendar date ("2026-10-14").
WpGroup groupOf(WpEntry e, String today) {
  final t = e.task;
  final status = e.effectiveStatus;
  if (status == WpStatus.completed) return WpGroup.done;
  if (e.toRead || e.toCheck) return WpGroup.today;
  if (e.blocked || status == WpStatus.reportedDone || status == WpStatus.leaderChecked) return WpGroup.waiting;
  final start = t.plannedStart;
  if (status == WpStatus.notStarted && start != null && start.compareTo(today) > 0) return WpGroup.upcoming;
  return WpGroup.today;
}

/// Planned end has passed and the work is not reported yet.
bool isLate(WpEntry e, String today) {
  final end = e.task.plannedEnd;
  final status = e.effectiveStatus;
  return end != null && end.compareTo(today) < 0 && (status == WpStatus.notStarted || status == WpStatus.inProgress);
}

/// What the My Work tab's number and Home's card say.
class WpUpdates {
  const WpUpdates({this.toRead = 0, this.toCheck = 0, this.pending = 0, this.failed = 0, this.notes = 0});

  /// New or changed tasks waiting for "I've read this".
  final int toRead;

  /// Reported work this leader can check.
  final int toCheck;

  /// Actions saved on this phone, not yet sent.
  final int pending;

  /// Actions the server refused (shown on the task).
  final int failed;

  /// Shared meeting notes this worker receives.
  final int notes;

  /// The tab's red number: what needs this worker.
  int get badge => toRead + toCheck + failed;

  bool get isEmpty => toRead == 0 && toCheck == 0 && pending == 0 && failed == 0;
}

WpUpdates summarizeWork(List<WpEntry> entries, {int notes = 0, int otherPending = 0, int otherFailed = 0}) => WpUpdates(
      toRead: entries.where((e) => e.toRead).length,
      toCheck: entries.where((e) => e.toCheck).length,
      pending: entries.fold(otherPending, (n, e) => n + e.shownPending.length),
      failed: entries.fold(otherFailed, (n, e) => n + e.shownFailures.length),
      notes: notes,
    );
```

Create `lib/workplan/ui/workplan_copy.dart`:

```dart
import '../../attendance/domain/attendance_failure.dart';
import '../../attendance/ui/attendance_copy.dart';
import '../domain/wp_failure.dart';
import '../domain/wp_op.dart';
import '../domain/wp_rules.dart';
import '../domain/wp_task.dart';

// Screen copy is English; FAILURE copy is bilingual (English, then Tagalog),
// the same rule as Attendance and Requests. Where those already have the
// words, they are reused so a worker reads one voice.

String statusLabel(WpStatus s, {bool sentBack = false}) => switch (s) {
      WpStatus.notStarted => 'Not started',
      WpStatus.inProgress => sentBack ? 'Sent back' : 'In progress',
      WpStatus.reportedDone => 'Reported done',
      WpStatus.leaderChecked => 'Checked by leader',
      WpStatus.completed => 'Completed',
    };

String roleLabel(WpRole r) => switch (r) {
      WpRole.responsible => 'Responsible',
      WpRole.helper => 'Helper',
      WpRole.leader => 'Team leader',
    };

String groupLabel(WpGroup g) => switch (g) {
      WpGroup.today => 'Today',
      WpGroup.upcoming => 'Upcoming',
      WpGroup.waiting => 'Waiting',
      WpGroup.done => 'Done (last 14 days)',
    };

String problemKindLabel(String kind) => switch (kind) {
      'materials' => 'Materials',
      'tool' => 'Tool',
      'preparation' => 'Preparation',
      _ => 'Other',
    };

String proposalStateLabel(WpProposalState s) => switch (s) {
      WpProposalState.sent => 'Sent',
      WpProposalState.published => 'Published',
      WpProposalState.declined => 'Declined',
      WpProposalState.cancelled => 'Cancelled',
    };

/// What a queued or refused operation was, for its line on the task.
String opLabel(WpOp op) => switch (op.kind) {
      WpOpKind.acknowledge => "I've read this",
      WpOpKind.start => 'Start work',
      WpOpKind.progress => 'Progress report',
      WpOpKind.blocker => 'Problem report',
      WpOpKind.done => 'Report done',
      WpOpKind.check => 'Check this work',
      WpOpKind.propose => 'Proposal: ${(op.body['title'] as String?) ?? ''}',
      WpOpKind.photo => 'A photo',
    };

const lockBlockedText = 'Waiting: the problems and earlier tasks below must be cleared by the office first.';
const lockMustReadText = 'Read the task first: tap "I\'ve read this".';

String lockText(WpLock l) => switch (l) {
      WpLock.blocked => lockBlockedText,
      WpLock.mustRead => lockMustReadText,
    };

Bilingual wpFailureCopy(WpFailure f) => switch (f) {
      WpFailure.notAssigned => const Bilingual(
          'You are no longer on this task, or the office took it back. Ask the office.',
          'Wala ka na sa task na ito, o binawi ito ng opisina. Magtanong sa opisina.'),
      WpFailure.notResponsible => const Bilingual(
          'Only the person responsible for this task can do that.', 'Ang responsable lang sa task na ito ang puwedeng gumawa niyan.'),
      WpFailure.badState => const Bilingual(
          'The task changed meanwhile, so this no longer applies. Pull down to see it now.',
          'Nagbago ang task habang naghihintay, kaya hindi na ito puwede. Hilahin pababa para makita ang bago.'),
      WpFailure.taskBlocked => const Bilingual(
          'This task is still waiting: a problem or an earlier task must be cleared by the office first.',
          'Naghihintay pa ang task na ito: kailangan munang ayusin ng opisina ang problema o ang naunang task.'),
      WpFailure.notAcknowledged => const Bilingual(
          'The office changed this task. Read the new version, tap "I\'ve read this", then try again.',
          'Binago ng opisina ang task na ito. Basahin ang bago, pindutin ang "I\'ve read this", tapos subukan ulit.'),
      WpFailure.noteRequired => const Bilingual('Write a short note first.', 'Sumulat muna ng maikling paliwanag.'),
      WpFailure.badRequest => const Bilingual(
          'That request is not for this project. Report the problem again without it.',
          'Hindi para sa project na ito ang request na iyon. I-report ulit ang problema nang wala ito.'),
      WpFailure.ownWork => const Bilingual(
          'You cannot check work you are part of. The office checks it.',
          'Hindi mo puwedeng i-check ang trabahong kasama ka. Ang opisina ang magche-check.'),
      WpFailure.notLeader => const Bilingual(
          'Only the current leader of this team can do that.', 'Ang kasalukuyang leader lang ng team ang puwedeng gumawa niyan.'),
      WpFailure.badDestination => const Bilingual(
          'That project or job is closed. Choose another, then send again.',
          'Sarado na ang project o trabahong iyon. Pumili ng iba, tapos ipadala ulit.'),
      WpFailure.titleRequired => const Bilingual('Give the task a title.', 'Lagyan ng pamagat ang task.'),
      WpFailure.notARequester => failureCopy(AttendanceFailure.notAWorker),
      WpFailure.appUpdateRequired => failureCopy(AttendanceFailure.appUpdateRequired),
      WpFailure.sessionExpired => failureCopy(AttendanceFailure.sessionExpired),
      WpFailure.noConnection => failureCopy(AttendanceFailure.noConnection),
      WpFailure.photoNotUploaded || WpFailure.unexpected => failureCopy(AttendanceFailure.unexpected),
    };

/// A photo the phone could not send (its file is gone, or its report was refused).
const photoNotSentCopy = Bilingual('A photo could not be sent.', 'Hindi naipadala ang isang litrato.');

Bilingual opFailureCopy(WpOp op) {
  if (op.kind == WpOpKind.photo && (op.lastError == 'PHOTO_MISSING' || op.lastError == 'PHOTO_ORPHAN')) return photoNotSentCopy;
  return wpFailureCopy(WpFailure.fromStored(op.lastError));
}

/// The lead line over an operation the server refused for good.
const notAcceptedLead = Bilingual('This was not accepted.', 'Hindi ito tinanggap.');

const photoNotKeptCopy = Bilingual('The photo could not be kept. Try again.', 'Hindi naitabi ang litrato. Subukan ulit.');

/// Shown under the form while the phone has no signal.
const savedOnPhoneText = 'Saved on this phone. It is sent as soon as there is signal.';
```

- [ ] **Step 4: Run the test**

Run: `flutter test test/workplan/domain`
Expected: `+18: All tests passed!`

- [ ] **Step 5: Whole suite and analyzer**

Run: `flutter analyze` → `No issues found!`; `flutter test` → `+620: All tests passed!` (602 before + 18).

- [ ] **Step 6: Stop — no commit.** Report to the controller.

---

### Task 2: Server calls, the phone's queue, and sending

**Files:**
- Create: `lib/workplan/data/workplan_remote.dart`, `lib/workplan/data/workplan_db.dart`, `lib/workplan/data/workplan_api.dart`, `lib/workplan/data/workplan_repository.dart`, `lib/workplan/data/workplan_account_wipe.dart`, `lib/workplan/sync/workplan_sync.dart`
- Modify: `lib/attendance/sync/background_sync.dart` (whole file given), `test/attendance/sync/background_sync_test.dart` (one insertion)
- Test: `test/workplan/workplan_fakes.dart`, `test/workplan/data/workplan_repository_test.dart`, `test/workplan/sync/workplan_sync_test.dart`, `test/workplan/data/workplan_account_wipe_test.dart`

**Interfaces:**
- Consumes:
  - from Task 1: `WpTask`, `WpNote`, `WpProposal`, `WpOp`/`WpOpKind`, `WpFailure`/`maxWpAttempts`, `WpEntry`;
  - from the app: `isAlreadyUploaded` (`lib/requests/data/request_remote.dart`), `Destination`, `MyTeam`, `DeviceBridge.preparePhoto`, `UploadScheduler.enqueue`, `newEventId`, `SyncResult` (`lib/attendance/sync/submission_sync.dart`), `AppState` (`Ready`, `SignedOut`).
- Produces:
  - **Remote:** `taskPhotoBucket = 'task-photos'`, `taskPhotoPath({workerId, taskId, photoId})`. `abstract class WorkPlanRemote` with `myWork(), myNotes(), myProposals()` (raw docs), `destinations()`, `myTeams()`, plus the writes:
    - `acknowledge(opId, taskId, version, {workerId})`
    - `startWork(opId, taskId, {workerId})`
    - `reportProgress(opId, taskId, note, {workerId})`
    - `reportBlocker(opId, taskId, kind, description, requestId, {workerId})`
    - `reportDone(opId, taskId, note, {workerId})`
    - `leaderCheck(opId, taskId, note, {workerId})`
    - `propose(opId, body, {workerId})`
    - `attachPhoto({opId, taskId, blockerId, eventId, photoId, localPath, workerId})`
    - `signedUrl(path)`

    `SupabaseWorkPlanRemote(SupabaseClient)` implements it.
  - **Database:** `WorkPlanDb.open(factory, path, {singleInstance})` with:
    - queue: `addOps, sendable, ops, op, hasAnySendable, recordAttempt, markFailed, failChildren, children, deleteOp`;
    - accepted answers and saved lists: `settle(op, {task, blockerId, eventId})`, `acceptedSeq(workerId)`, `saveLists(workerId, lists, at, {stillValid, readSince})`, `cache`, `keepCacheOnly`;
    - `close`.

    Also `openDeviceWorkPlanDb({singleInstance})`. Tables: `wp_op`, `wp_cache`, `wp_accepted`, `wp_accepted_seq`.
    - `settle` runs in ONE transaction:
      1. links the action's photos;
      2. records the server's answer in `wp_accepted` with the worker's next number;
      3. replaces that task in the saved list (patch only, never create);
      4. deletes the action.
    - `saveLists` runs in ONE transaction:
      1. refuses (`AUTH_REQUIRED`) unless `stillValid()`;
      2. in `'work'`, keeps each accepted answer numbered above `readSince`;
      3. forgets answers at or below it;
      4. saves.

      It returns what it saved. There is **no unguarded `putCache`**.
    - `keepCacheOnly` is one transaction over `wp_cache`, `wp_accepted` and `wp_accepted_seq`.
  - **API types:**
    - `WorkPlanView{entries, notes, proposals, pendingProposals, otherFailed, otherPending, fetchedAt, fromCache, error, entry(taskId)}`;
    - `WpChoices{teams, destinations, fromCache}`, `WpInvalid(field)`, `wpProblemKinds`.
  - **`abstract interface class WorkPlanApi`:**
    - `load()`
    - `acknowledge(task)`, `startWork(task)`
    - `reportProgress(task, note, {photo})`, `reportProblem(task, {kind, description, requestId, photo})`, `reportDone(task, note)`, `checkWork(task, note)`
    - `choices()`, `propose({team, destination, title, details})`
    - `keepPhoto(capturedPath)`, `discardPhoto(path)`
    - `dismissFailed(op)`, `photoUrl(path)`, `keepOnly(workerId)`
  - `WorkPlanRepository({db, remote, device, scheduler, currentWorkerId, photoDir, sendNow, now, newId})` implements `WorkPlanApi`.
  - `WorkPlanAccountWipe(WorkPlanApi)` with `.onAppState(AppState)`.
  - `WorkPlanSync({db, remote})` with `.drain(workerId) → Future<SyncResult>` and `.settled`.
  - In `background_sync.dart`: `syncWith(..., onWorkPlanSettled)` and `drainInOrder(..., workPlan, onWorkPlanSettled)`, both new **optional** parameters.
  - **Test fakes:** `FakeWorkPlanRemote` (with `failOn[kind]`, `writeError`, `writeErrorSticky`, `readGate`, `taskAnswer`, `calls`, `attached`, `ackResult`), `FakeWorkPlanApi` (with `view`, `loadGate`, `choicesResult`, `calls`, `discarded`, `keepError`) and `viewWithUnread()`.

- [ ] **Step 1: Write the fakes and the failing tests**

Create `test/workplan/workplan_fakes.dart`:

```dart
import 'dart:async';

import 'package:workmate/requests/domain/request_models.dart';
import 'package:workmate/workplan/data/workplan_api.dart';
import 'package:workmate/workplan/data/workplan_remote.dart';
import 'package:workmate/workplan/domain/wp_op.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';
import 'package:workmate/workplan/domain/wp_task.dart';

import 'workplan_samples.dart';

export 'workplan_samples.dart';

/// One unread task, as My Work shows it.
WorkPlanView viewWithUnread() => WorkPlanView(entries: [WpEntry(task: task0())], notes: [WpNote.fromJson(noteDoc())]);

/// A WorkPlanRemote whose every answer the test sets, recording every call.
class FakeWorkPlanRemote implements WorkPlanRemote {
  List<Map<String, dynamic>> work = [taskDoc()];
  List<Map<String, dynamic>> notes = [noteDoc()];
  List<Map<String, dynamic>> proposals = [];
  List<Destination> dests = [barlin];
  List<MyTeam> teams = [pilotB, otherTeam];
  Object? readError;

  /// Every read waits for it while set (an answer still travelling).
  Completer<void>? readGate;

  /// The task every accepted action answers with (0093 returns it); null
  /// answers an empty map.
  Map<String, dynamic>? taskAnswer;

  /// Thrown by the next write (then cleared), or by every write while [writeErrorSticky].
  Object? writeError;
  bool writeErrorSticky = false;

  final calls = <String>[];
  final attached = <String>[];
  Map<String, dynamic> ackResult = {'stale': false, 'task': {}};
  int events = 0;
  int blockerIds = 0;

  /// Thrown by every write of that kind ('ack', 'start', 'progress',
  /// 'blocker', 'done', 'check', 'propose', 'photo').
  final failOn = <String, Object>{};

  void _maybeFail([String? kind]) {
    final own = failOn[kind];
    if (own != null) throw own;
    final e = writeError;
    if (e == null) return;
    if (!writeErrorSticky) writeError = null;
    throw e;
  }

  Future<List<Map<String, dynamic>>> _read(List<Map<String, dynamic>> v) async {
    final gate = readGate;
    if (gate != null) await gate.future;
    if (readError != null) throw readError!;
    return v;
  }

  Map<String, dynamic> get _answer => {'task': taskAnswer ?? {}};

  @override
  Future<List<Map<String, dynamic>>> myWork() => _read(work);

  @override
  Future<List<Map<String, dynamic>>> myNotes() => _read(notes);

  @override
  Future<List<Map<String, dynamic>>> myProposals() => _read(proposals);

  @override
  Future<List<Destination>> destinations() async {
    final gate = readGate;
    if (gate != null) await gate.future;
    if (readError != null) throw readError!;
    return dests;
  }

  @override
  Future<List<MyTeam>> myTeams() async {
    final gate = readGate;
    if (gate != null) await gate.future;
    if (readError != null) throw readError!;
    return teams;
  }

  @override
  Future<Map<String, dynamic>> acknowledge(String opId, String taskId, int version, {required String workerId}) async {
    calls.add('ack:$taskId:$version');
    _maybeFail('ack');
    return ackResult;
  }

  @override
  Future<Map<String, dynamic>> startWork(String opId, String taskId, {required String workerId}) async {
    calls.add('start:$taskId');
    _maybeFail('start');
    return _answer;
  }

  @override
  Future<Map<String, dynamic>> reportProgress(String opId, String taskId, String note, {required String workerId}) async {
    calls.add('progress:$taskId:$note');
    _maybeFail('progress');
    return {'event_id': ++events, ..._answer};
  }

  @override
  Future<Map<String, dynamic>> reportBlocker(String opId, String taskId, String kind, String description, String? requestId,
      {required String workerId}) async {
    calls.add('blocker:$taskId:$kind:$description:$requestId');
    _maybeFail('blocker');
    return {'blocker_id': 'b${++blockerIds}', ..._answer};
  }

  @override
  Future<Map<String, dynamic>> reportDone(String opId, String taskId, String note, {required String workerId}) async {
    calls.add('done:$taskId');
    _maybeFail('done');
    return _answer;
  }

  @override
  Future<Map<String, dynamic>> leaderCheck(String opId, String taskId, String note, {required String workerId}) async {
    calls.add('check:$taskId');
    _maybeFail('check');
    return _answer;
  }

  @override
  Future<Map<String, dynamic>> propose(String opId, Map<String, dynamic> body, {required String workerId}) async {
    calls.add('propose:${body['title']}:${body['team_id']}:${body['folder_id']}:${body['work_id']}');
    _maybeFail('propose');
    return {'task_id': 'new'};
  }

  @override
  Future<void> attachPhoto({
    required String opId,
    required String taskId,
    required String? blockerId,
    required int? eventId,
    required String photoId,
    required String localPath,
    required String workerId,
  }) async {
    calls.add('photo:$taskId:$blockerId:$eventId');
    _maybeFail('photo');
    attached.add(taskPhotoPath(workerId: workerId, taskId: taskId, photoId: photoId));
  }

  @override
  Future<String?> signedUrl(String path) async => 'https://signed/$path';
}

/// A WorkPlanApi for controllers and screens: in-memory, recording calls.
class FakeWorkPlanApi implements WorkPlanApi {
  WorkPlanView view = WorkPlanView(entries: [], notes: [WpNote.fromJson(noteDoc())]);
  Object? loadError;
  Completer<void>? loadGate;
  int loads = 0;
  WpChoices choicesResult = const WpChoices(teams: [pilotB], destinations: [barlin]);
  Object? choicesError;
  final calls = <String>[];
  final discarded = <String>[];
  var _ids = 0;

  @override
  Future<WorkPlanView> load() async {
    loads++;
    final snapshot = view;
    final gate = loadGate;
    if (gate != null) await gate.future;
    if (loadError != null) throw loadError!;
    return snapshot;
  }

  @override
  Future<void> acknowledge(WpTask task) async => calls.add('ack:${task.id}:${task.version}');

  @override
  Future<void> startWork(WpTask task) async => calls.add('start:${task.id}');

  @override
  Future<void> reportProgress(WpTask task, String note, {String? photo}) async => calls.add('progress:${task.id}:$note:$photo');

  @override
  Future<void> reportProblem(WpTask task, {required String kind, required String description, String? requestId, String? photo}) async =>
      calls.add('problem:${task.id}:$kind:$description:$requestId:$photo');

  @override
  Future<void> reportDone(WpTask task, String note) async => calls.add('done:${task.id}:$note');

  @override
  Future<void> checkWork(WpTask task, String note) async => calls.add('check:${task.id}:$note');

  @override
  Future<WpChoices> choices() async {
    if (choicesError != null) throw choicesError!;
    return choicesResult;
  }

  @override
  Future<void> propose({required MyTeam team, required Destination destination, required String title, required String details}) async =>
      calls.add('propose:${team.id}:${destination.workId}:$title:$details');

  @override
  Future<String> keepPhoto(String capturedPath) async => '/kept/${++_ids}.jpg';

  @override
  Future<void> discardPhoto(String path) async => discarded.add(path);

  @override
  Future<void> dismissFailed(WpOp op) async => calls.add('dismiss:${op.opId}');

  @override
  Future<String?> photoUrl(String path) async => null;

  /// Thrown by [keepOnly] while set.
  Object? keepError;

  @override
  Future<void> keepOnly(String workerId) async {
    calls.add('keepOnly:$workerId');
    if (keepError != null) throw keepError!;
  }
}
```

Create `test/workplan/data/workplan_repository_test.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/workplan/data/workplan_api.dart';
import 'package:workmate/workplan/data/workplan_db.dart';
import 'package:workmate/workplan/data/workplan_repository.dart';
import 'package:workmate/workplan/domain/wp_op.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';
import 'package:workmate/workplan/domain/wp_task.dart';
import 'package:workmate/workplan/sync/workplan_sync.dart';

import '../../attendance/fakes.dart';
import '../workplan_fakes.dart';

void main() {
  late WorkPlanDb db;
  late FakeWorkPlanRemote remote;
  late Directory dir;
  late WorkPlanRepository repo;
  var worker = 'u1';
  var ids = 0;
  var kicks = 0;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await WorkPlanDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    remote = FakeWorkPlanRemote();
    dir = await Directory.systemTemp.createTemp('wp-repo');
    worker = 'u1';
    ids = 0;
    kicks = 0;
    repo = WorkPlanRepository(
      db: db,
      remote: remote,
      device: FakeDevice(),
      scheduler: FakeScheduler(),
      currentWorkerId: () => worker,
      photoDir: () async => dir,
      sendNow: () async => kicks++,
      now: () => DateTime.utc(2026, 10, 14, 2),
      newId: () => 'id${++ids}',
    );
  });
  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  WorkPlanSync sync() => WorkPlanSync(db: db, remote: remote);

  test('the lists are saved, and shown from the phone with no signal — only to their own worker', () async {
    remote.proposals = [proposalDoc()];
    final fresh = await repo.load();
    expect(fresh.fromCache, isFalse);
    expect(fresh.entries.single.task.title, 'Wall prep');
    expect(fresh.notes.single.title, 'Site meeting');
    expect(fresh.proposals.single.state, WpProposalState.sent);
    remote.readError = const SocketException('down');
    final saved = await repo.load();
    expect(saved.fromCache, isTrue);
    expect(saved.error, isA<SocketException>());
    expect(saved.entries.single.task.id, 't1');
    expect(saved.fetchedAt, DateTime.utc(2026, 10, 14, 2));
    worker = 'u2';
    final other = await repo.load();
    expect(other.entries, isEmpty, reason: 'never another worker\'s saved tasks');
    expect(other.error, isNotNull);
  });

  test('keepOnly drops other workers\' saved copies but never unsent actions', () async {
    await repo.load();
    await repo.acknowledge(task0());
    await repo.keepOnly('u2');
    remote.readError = const SocketException('down');
    final v = await repo.load();
    expect(v.entries, isEmpty, reason: 'u1\'s saved tasks are gone');
    expect(await db.sendable('u1'), hasLength(1), reason: 'u1\'s "I\'ve read this" still waits for them');
  });

  test('"I\'ve read this" is queued once per version and sent', () async {
    final t = task0();
    await repo.acknowledge(t);
    await repo.acknowledge(t); // double tap
    expect(await db.sendable('u1'), hasLength(1));
    expect(kicks, 1);
    final v = await repo.load();
    expect(v.entries.single.ackPending, isTrue);
    expect(v.entries.single.toRead, isFalse);
    await sync().drain('u1');
    expect(remote.calls, ['ack:t1:1']);
    expect(await db.sendable('u1'), isEmpty);
  });

  test('a problem and its photo go in order; the photo is linked to the new problem', () async {
    final raw = File('${dir.path}/raw.jpg')..writeAsBytesSync([1]);
    final kept = await repo.keepPhoto(raw.path);
    File(kept).writeAsBytesSync([1]); // FakeDevice returns the target without writing it
    await repo.reportProblem(task0(), kind: 'materials', description: ' No cement ', requestId: 'r1', photo: kept);
    final queued = await db.sendable('u1');
    expect(queued.map((o) => o.kind), [WpOpKind.blocker, WpOpKind.photo]);
    expect(queued.last.parentOpId, queued.first.opId);
    await sync().drain('u1');
    expect(remote.calls, ['blocker:t1:materials:No cement:r1', 'photo:t1:b1:null']);
    expect(remote.attached.single, startsWith('u1/t1/'));
    expect(File(kept).existsSync(), isFalse, reason: 'sent: the phone copy goes');
  });

  test('a progress note\'s photo is linked to its history line', () async {
    final kept = File('${dir.path}/p.jpg')..writeAsBytesSync([1]);
    await repo.reportProgress(task0(), 'Half done', photo: kept.path);
    await sync().drain('u1');
    expect(remote.calls, ['progress:t1:Half done', 'photo:t1:null:1']);
  });

  test('a refused report takes its photo with it, shown and dismissed together', () async {
    final kept = File('${dir.path}/p.jpg')..writeAsBytesSync([1]);
    remote.writeError = Exception('NOT_ASSIGNED');
    await repo.reportProblem(task0(), kind: 'tool', description: 'No drill', photo: kept.path);
    await sync().drain('u1');
    expect(remote.calls, ['blocker:t1:tool:No drill:null'], reason: 'the photo is never sent');
    final v = await repo.load();
    final failed = v.entries.single.failedOps;
    expect(failed.map((o) => o.kind), [WpOpKind.blocker, WpOpKind.photo]);
    expect(failed.every((o) => o.lastError == 'notAssigned'), isTrue);
    await repo.dismissFailed(failed.first);
    expect(await db.ops('u1'), isEmpty);
    expect(kept.existsSync(), isFalse);
  });

  test('no signal: the queue waits and keeps its order', () async {
    remote.writeError = const SocketException('down');
    remote.writeErrorSticky = true;
    await repo.acknowledge(task0());
    await repo.startWork(task0());
    await sync().drain('u1');
    expect(remote.calls, ['ack:t1:1'], reason: 'Start never goes before the read');
    expect((await db.sendable('u1')).map((o) => o.kind), [WpOpKind.acknowledge, WpOpKind.start]);
    remote.writeErrorSticky = false;
    remote.writeError = null;
    await sync().drain('u1');
    expect(remote.calls, ['ack:t1:1', 'ack:t1:1', 'start:t1']);
  });

  test('an outdated read is answered, not refused; the Start after it is refused and shown', () async {
    remote.ackResult = {'stale': true, 'task': {}};
    remote.failOn['start'] = Exception('NOT_ACKNOWLEDGED');
    await repo.acknowledge(task0());
    await repo.startWork(task0());
    await sync().drain('u1');
    expect(remote.calls, ['ack:t1:1', 'start:t1']);
    final failed = (await repo.load()).entries.single.failedOps;
    expect(failed.single.kind, WpOpKind.start, reason: 'the read itself is not an error');
    expect(failed.single.lastError, 'notAcknowledged');
  });

  test('an accepted problem keeps the server\'s task: a failed refresh never unlocks Report done', () async {
    remote.work = [taskDoc(status: 'in_progress', ackVersion: 1)];
    await repo.load();
    await repo.reportProblem(task0(remote.work.single), kind: 'materials', description: 'No cement');
    remote.taskAnswer = taskDoc(status: 'in_progress', ackVersion: 1, blocked: true, blockers: [
      {'id': 'b1', 'kind': 'materials', 'description': 'No cement', 'request_id': null, 'reported_at': '2026-10-14T03:00:00+00:00', 'reported_by': 'John'},
    ]);
    await sync().drain('u1');
    expect(await db.sendable('u1'), isEmpty);
    remote.readError = const SocketException('down');
    final e = (await repo.load()).entries.single;
    expect(e.pendingOps, isEmpty);
    expect(e.task.blocked, isTrue, reason: 'the saved copy is the server\'s answer, not the list from before');
    expect(actionsFor(e).doneLock, WpLock.blocked);
  });

  test('an outdated read keeps the server\'s newer task: it stays Changed offline', () async {
    await repo.load();
    await repo.acknowledge(task0());
    remote.ackResult = {'stale': true, 'task': taskDoc(version: 2)};
    await sync().drain('u1');
    remote.readError = const SocketException('down');
    final t = (await repo.load()).entries.single.task;
    expect([t.version, t.needsReading], [2, isTrue]);
  });

  test('a list that arrives after sign-out is neither saved nor shown', () async {
    remote.readGate = Completer<void>();
    final reading = repo.load();
    worker = '';
    await repo.keepOnly('');
    remote.readGate!.complete();
    await expectLater(reading, throwsA(isA<StateError>()));
    expect(await db.cache('u1', 'work'), isNull, reason: 'the wiped copy is not written back');
  });

  test('a switch while a list travels never shows or saves it for either worker', () async {
    remote.readGate = Completer<void>();
    final reading = repo.load();
    worker = 'u2';
    remote.readGate!.complete();
    await expectLater(reading, throwsA(isA<StateError>()));
    expect(await db.cache('u1', 'work'), isNull);
    expect(await db.cache('u2', 'work'), isNull);
  });

  test('offline, a switch while the saved copy is read never shows it to the next worker', () async {
    await repo.load();
    remote.readError = const SocketException('down');
    remote.readGate = Completer<void>();
    final reading = repo.load();
    worker = 'u2';
    remote.readGate!.complete();
    await expectLater(reading, throwsA(isA<StateError>()));
  });

  test('proposal choices never mix two workers\' answers', () async {
    remote.readGate = Completer<void>();
    final choosing = repo.choices();
    worker = 'u2';
    remote.readGate!.complete();
    await expectLater(choosing, throwsA(isA<StateError>()));
    expect(await db.cache('u1', 'teams'), isNull);
    expect(await db.cache('u2', 'teams'), isNull);
  });

  test('a photo still waiting after its problem landed stays counted, once', () async {
    final kept = File('${dir.path}/p.jpg')..writeAsBytesSync([1]);
    await repo.reportProblem(task0(), kind: 'tool', description: 'No drill', photo: kept.path);
    expect(summarizeWork((await repo.load()).entries).pending, 1, reason: 'a report and its photo are one item');
    remote.failOn['photo'] = const SocketException('down');
    await sync().drain('u1');
    final e = (await repo.load()).entries.single;
    expect(e.pendingOps.single.kind, WpOpKind.photo);
    expect(e.shownPending.single.kind, WpOpKind.photo);
    expect(summarizeWork([e]).pending, 1, reason: 'the photo is still owed and still counted');
  });

  test('an older refresh cannot overwrite an accepted problem', () async {
    remote.work = [taskDoc(status: 'in_progress', ackVersion: 1)];
    await repo.load();
    remote.readGate = Completer<void>();
    final oldRead = repo.load(); // asked the server BEFORE the problem was accepted
    await repo.reportProblem(task0(remote.work.single), kind: 'materials', description: 'No cement');
    remote.taskAnswer = taskDoc(status: 'in_progress', ackVersion: 1, blocked: true, blockers: [
      {'id': 'b1', 'kind': 'materials', 'description': 'No cement', 'request_id': null, 'reported_at': '2026-10-14T03:00:00+00:00', 'reported_by': 'John'},
    ]);
    await sync().drain('u1');
    expect(await db.sendable('u1'), isEmpty);
    remote.readGate!.complete();
    final shown = (await oldRead).entries.single;
    expect(shown.task.blocked, isTrue, reason: 'the late old answer is not even shown');
    remote.readGate = null;
    remote.readError = const SocketException('down');
    final offline = (await repo.load()).entries.single;
    expect(offline.task.blocked, isTrue, reason: 'late old reads must not undo the accepted problem');
    expect(actionsFor(offline).doneLock, WpLock.blocked);
  });

  test('an action accepted by the background sync (its own connection) is not overwritten by an older read', () async {
    final file = '${dir.path}/shared.db';
    final appDb = await WorkPlanDb.open(databaseFactoryFfi, file, singleInstance: false);
    final bgDb = await WorkPlanDb.open(databaseFactoryFfi, file, singleInstance: false);
    addTearDown(() async {
      await appDb.close();
      await bgDb.close();
    });
    final app = WorkPlanRepository(
      db: appDb,
      remote: remote,
      device: FakeDevice(),
      scheduler: FakeScheduler(),
      currentWorkerId: () => worker,
      photoDir: () async => dir,
      newId: () => 'x${++ids}',
    );
    remote.work = [taskDoc(status: 'in_progress', ackVersion: 1)];
    await app.load();
    remote.readGate = Completer<void>();
    final oldRead = app.load();
    await app.reportProblem(task0(remote.work.single), kind: 'materials', description: 'No cement');
    remote.taskAnswer = taskDoc(status: 'in_progress', ackVersion: 1, blocked: true, blockers: [
      {'id': 'b1', 'kind': 'materials', 'description': 'No cement', 'request_id': null, 'reported_at': '2026-10-14T03:00:00+00:00', 'reported_by': 'John'},
    ]);
    await WorkPlanSync(db: bgDb, remote: remote).drain('u1'); // the WorkManager engine
    remote.readGate!.complete();
    await oldRead;
    remote.readGate = null;
    remote.readError = const SocketException('down');
    expect((await app.load()).entries.single.task.blocked, isTrue);
  });

  test('an accepted answer never hides a later office change: a newer read wins', () async {
    remote.work = [taskDoc(status: 'in_progress', ackVersion: 1)];
    await repo.load();
    await repo.reportProblem(task0(remote.work.single), kind: 'materials', description: 'No cement');
    remote.taskAnswer = taskDoc(status: 'in_progress', ackVersion: 1, blocked: true, blockers: [
      {'id': 'b1', 'kind': 'materials', 'description': 'No cement', 'request_id': null, 'reported_at': '2026-10-14T03:00:00+00:00', 'reported_by': 'John'},
    ]);
    await sync().drain('u1');
    // The office clears the problem; a read started after the problem landed shows it.
    remote.work = [taskDoc(status: 'in_progress', ackVersion: 1)];
    expect((await repo.load()).entries.single.task.blocked, isFalse);
    remote.readError = const SocketException('down');
    expect((await repo.load()).entries.single.task.blocked, isFalse, reason: 'the saved copy follows the newer read');
  });

  test('choices reject a switch during the awaited saves, and never write back a wiped copy', () async {
    var checks = 0;
    Future<void>? wiping;
    repo = WorkPlanRepository(
      db: db,
      remote: remote,
      device: FakeDevice(),
      scheduler: FakeScheduler(),
      currentWorkerId: () {
        final current = worker;
        if (++checks == 2) {
          scheduleMicrotask(() {
            worker = 'u2';
            wiping = repo.keepOnly('u2');
          });
        }
        return current;
      },
      photoDir: () async => dir,
    );
    await expectLater(repo.choices(), throwsA(isA<StateError>()), reason: 'a switch during database waits invalidates the result');
    await wiping;
    expect(await db.cache('u1', 'teams'), isNull, reason: 'the cleanup is not undone by a late save');
  });

  test('choices reject a switch that lands while the save commits', () async {
    var checks = 0;
    repo = WorkPlanRepository(
      db: db,
      remote: remote,
      device: FakeDevice(),
      scheduler: FakeScheduler(),
      currentWorkerId: () {
        final current = worker;
        // The third look is the one inside the save: the switch lands right after it.
        if (++checks == 3) scheduleMicrotask(() => worker = 'u2');
        return current;
      },
      photoDir: () async => dir,
    );
    await expectLater(repo.choices(), throwsA(isA<StateError>()));
  });

  test('nothing is read or queued under nobody', () async {
    worker = '';
    await expectLater(repo.load(), throwsA(isA<StateError>()));
    await expectLater(repo.acknowledge(task0()), throwsA(isA<StateError>()));
  });

  test('incomplete reports are refused before anything is queued', () async {
    await expectLater(repo.reportProgress(task0(), '  '), throwsA(isA<WpInvalid>()));
    await expectLater(repo.reportProblem(task0(), kind: 'materials', description: ''), throwsA(isA<WpInvalid>()));
    await expectLater(repo.reportProblem(task0(), kind: 'money', description: 'x'), throwsA(isA<WpInvalid>()));
    await expectLater(repo.propose(team: pilotB, destination: barlin, title: ' ', details: ''), throwsA(isA<WpInvalid>()));
    expect(await db.ops('u1'), isEmpty);
  });

  test('a proposal waits as Pending, then is sent with the 0093 arguments', () async {
    final choices = await repo.choices();
    expect(choices.teams.map((t) => t.id), ['tm1'], reason: 'only teams this leader leads');
    await repo.propose(team: pilotB, destination: barlin, title: ' Fix the gate ', details: 'Hinge broken');
    final v = await repo.load();
    expect(v.pendingProposals.single.body['title'], 'Fix the gate');
    await sync().drain('u1');
    expect(remote.calls, ['propose:Fix the gate:tm1:f1:f1']);
  });

  test('choices come from the phone with no signal', () async {
    await repo.choices();
    remote.readError = const SocketException('down');
    final saved = await repo.choices();
    expect(saved.fromCache, isTrue);
    expect(saved.teams.single.id, 'tm1');
  });

  test('a refused action for a task no longer on the list is still shown', () async {
    remote.writeError = Exception('NOT_ASSIGNED');
    await repo.startWork(task0());
    await sync().drain('u1');
    remote.work = [];
    final v = await repo.load();
    expect(v.entries, isEmpty);
    expect(v.otherFailed.single.kind, WpOpKind.start);
  });
}
```

Create `test/workplan/sync/workplan_sync_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/attendance/sync/submission_sync.dart';
import 'package:workmate/workplan/data/workplan_db.dart';
import 'package:workmate/workplan/domain/wp_failure.dart';
import 'package:workmate/workplan/domain/wp_op.dart';
import 'package:workmate/workplan/sync/workplan_sync.dart';
import 'package:workmate/workplan/ui/workplan_copy.dart';

import '../workplan_fakes.dart';

void main() {
  late WorkPlanDb db;
  late FakeWorkPlanRemote remote;
  var n = 0;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await WorkPlanDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    remote = FakeWorkPlanRemote();
    n = 0;
  });
  tearDown(() => db.close());

  WpOp op(WpOpKind kind, {String worker = 'u1', String? parent, Map<String, dynamic> body = const {}}) => WpOp(
        opId: 'o${++n}',
        workerId: worker,
        kind: kind,
        createdAt: DateTime.utc(2026, 10, 14),
        taskId: 't1',
        parentOpId: parent,
        body: body,
      );

  test('nothing is sent under nobody, nor another worker\'s actions', () async {
    await db.addOps([op(WpOpKind.start, worker: 'u2')]);
    final s = WorkPlanSync(db: db, remote: remote);
    expect(await s.drain(''), SyncResult.done);
    expect(await s.drain('u1'), SyncResult.done);
    expect(remote.calls, isEmpty);
    expect(await db.sendable('u2'), hasLength(1));
  });

  test('a session problem waits; it never gives the action up', () async {
    remote.failOn['start'] = StateError('AUTH_REQUIRED');
    await db.addOps([op(WpOpKind.start)]);
    final s = WorkPlanSync(db: db, remote: remote);
    for (var i = 0; i < 15; i++) {
      expect(await s.drain('u1'), SyncResult.retry);
    }
    expect((await db.sendable('u1')).single.attempts, 0);
  });

  test('ten unexpected failures in a row give one action up, so the queue moves on', () async {
    remote.failOn['start'] = StateError('weird');
    await db.addOps([op(WpOpKind.start), op(WpOpKind.done)]);
    final s = WorkPlanSync(db: db, remote: remote);
    for (var i = 0; i < maxWpAttempts - 1; i++) {
      expect(await s.drain('u1'), SyncResult.retry);
    }
    expect(await s.drain('u1'), SyncResult.done);
    expect(remote.calls.last, 'done:t1');
    final failed = (await db.ops('u1')).where((o) => o.failedPermanently).single;
    expect(failed.kind, WpOpKind.start);
    expect(WpFailure.fromStored(failed.lastError), WpFailure.unexpected);
  });

  test('a photo whose file is gone is flagged, with its own words', () async {
    final report = op(WpOpKind.progress, body: {'note': 'x'});
    await db.addOps([report, op(WpOpKind.photo, parent: report.opId, body: {'local_path': '/nope.jpg', 'photo_id': 'p1'})]);
    await WorkPlanSync(db: db, remote: remote).drain('u1');
    final photo = (await db.ops('u1')).single;
    expect(photo.lastError, 'PHOTO_MISSING');
    expect(opFailureCopy(photo), photoNotSentCopy);
  });
}
```

Create `test/workplan/data/workplan_account_wipe_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/app_controller.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/workplan/data/workplan_account_wipe.dart';

import '../workplan_fakes.dart';

void main() {
  const u1 = WorkerProfile(id: 'u1');
  const u2 = WorkerProfile(id: 'u2');

  test('signed in keeps only that worker; signed out keeps nothing; switching keeps the new one', () {
    final api = FakeWorkPlanApi();
    final wipe = WorkPlanAccountWipe(api);
    wipe.onAppState(Starting());
    expect(api.calls, isEmpty, reason: 'startup decides nothing');
    wipe.onAppState(Ready(u1));
    wipe.onAppState(Ready(u1));
    expect(api.calls, ['keepOnly:u1'], reason: 'once per change');
    wipe.onAppState(SignedOut());
    wipe.onAppState(NeedsTerms(u2));
    expect(api.calls, ['keepOnly:u1', 'keepOnly:'], reason: 'not let in yet');
    wipe.onAppState(Ready(u2));
    expect(api.calls, ['keepOnly:u1', 'keepOnly:', 'keepOnly:u2']);
  });

  test('a failed wipe is tried again on the next state', () async {
    final api = FakeWorkPlanApi()..keepError = Exception('disk');
    final wipe = WorkPlanAccountWipe(api);
    wipe.onAppState(Ready(u1));
    await Future<void>.delayed(Duration.zero);
    api.keepError = null;
    wipe.onAppState(Ready(u1));
    expect(api.calls, ['keepOnly:u1', 'keepOnly:u1']);
  });
}
```

In `test/attendance/sync/background_sync_test.dart`, insert the new test before the last one:

**Edit 1.** Find:

```dart
    test('a failing screen notice changes nothing', () async {
```

Replace with:

```dart
    test('My Work drains after requests; its failure only asks WorkManager to come back', () async {
      final log = <String>[];
      final ok = await drainInOrder(
        attendance: () async => (result: SyncResult.done, settled: 0),
        requests: () async {
          log.add('requests');
          return (result: SyncResult.done, settled: 0);
        },
        workPlan: () async {
          log.add('workPlan');
          return (result: SyncResult.done, settled: 2);
        },
        attendanceWaiting: () async => false,
        onWorkPlanSettled: () => log.add('onWorkPlanSettled'),
      );
      expect(ok, isTrue);
      expect(log, ['requests', 'workPlan', 'onWorkPlanSettled']);
      final failed = await drainInOrder(
        attendance: () async => (result: SyncResult.done, settled: 1),
        requests: () async => (result: SyncResult.done, settled: 0),
        workPlan: () async => throw StateError('workplan db broken'),
        attendanceWaiting: () async => false,
      );
      expect(failed, isFalse, reason: 'WorkManager comes back for My Work');
    });

    test('a failing screen notice changes nothing', () async {
```


- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/workplan test/attendance/sync`
Expected: FAIL to compile, because `workplan/data/...`, `workplan/sync/...` and the `workPlan:` parameter do not exist yet.

- [ ] **Step 3: Write the server calls, the database, the repository, the wipe and the sync**

Create `lib/workplan/data/workplan_remote.dart`:

```dart
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../requests/data/request_remote.dart' show isAlreadyUploaded;
import '../../requests/domain/request_models.dart';

/// The private bucket every task photo lives in (0093; never `uploads`).
const taskPhotoBucket = 'task-photos';

const _readTimeout = Duration(seconds: 15);
const _rpcTimeout = Duration(seconds: 20);
const _uploadTimeout = Duration(seconds: 60);

/// {uploader}/{task}/{photo}.jpg — the only shape 0093's upload policy and
/// wp_attach_photo accept.
String taskPhotoPath({required String workerId, required String taskId, required String photoId}) =>
    '$workerId/$taskId/$photoId.jpg';

// The RPC arguments — exactly the 0093 signatures.
Map<String, dynamic> ackParams(String opId, String taskId, int version) => {'p_op': opId, 'p_task': taskId, 'p_version': version};

Map<String, dynamic> taskParams(String opId, String taskId) => {'p_op': opId, 'p_task': taskId};

Map<String, dynamic> noteParams(String opId, String taskId, String note) => {'p_op': opId, 'p_task': taskId, 'p_note': note};

Map<String, dynamic> blockerParams(String opId, String taskId, String kind, String description, String? requestId) =>
    {'p_op': opId, 'p_task': taskId, 'p_kind': kind, 'p_description': description, 'p_request': requestId};

Map<String, dynamic> proposeParams(String opId, String teamId, String folderId, String workId, String title, String details) =>
    {'p_op': opId, 'p_team': teamId, 'p_folder': folderId, 'p_work': workId, 'p_title': title, 'p_details': details};

Map<String, dynamic> attachTaskPhotoParams(String opId, String taskId, String? blockerId, int? eventId, String path) =>
    {'p_op': opId, 'p_task': taskId, 'p_blocker': blockerId, 'p_event': eventId, 'p_path': path};

abstract class WorkPlanRemote {
  /// wp_my_work: every published task the caller has a role on (raw docs).
  Future<List<Map<String, dynamic>>> myWork();

  /// wp_my_notes: the latest shared notes the caller receives.
  Future<List<Map<String, dynamic>>> myNotes();

  /// wp_my_proposals: the caller's own proposals (90 days).
  Future<List<Map<String, dynamic>>> myProposals();

  /// For proposing: open projects / works, and the teams the caller is in.
  Future<List<Destination>> destinations();
  Future<List<MyTeam>> myTeams();

  // Every write files under the CURRENT session: if it is not [workerId], it
  // throws AUTH_REQUIRED instead of sending another worker's change.
  Future<Map<String, dynamic>> acknowledge(String opId, String taskId, int version, {required String workerId});
  Future<Map<String, dynamic>> startWork(String opId, String taskId, {required String workerId});
  Future<Map<String, dynamic>> reportProgress(String opId, String taskId, String note, {required String workerId});
  Future<Map<String, dynamic>> reportBlocker(String opId, String taskId, String kind, String description, String? requestId,
      {required String workerId});
  Future<Map<String, dynamic>> reportDone(String opId, String taskId, String note, {required String workerId});
  Future<Map<String, dynamic>> leaderCheck(String opId, String taskId, String note, {required String workerId});
  Future<Map<String, dynamic>> propose(String opId, Map<String, dynamic> body, {required String workerId});

  /// Uploads the photo, THEN links it (a row must never point at a missing file).
  Future<void> attachPhoto({
    required String opId,
    required String taskId,
    required String? blockerId,
    required int? eventId,
    required String photoId,
    required String localPath,
    required String workerId,
  });

  /// A 10-minute link to one private photo, or null.
  Future<String?> signedUrl(String path);
}

class SupabaseWorkPlanRemote implements WorkPlanRemote {
  SupabaseWorkPlanRemote(this._client);

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
  Future<List<Map<String, dynamic>>> myWork() async => _rows(await _client.rpc('wp_my_work').timeout(_readTimeout));

  @override
  Future<List<Map<String, dynamic>>> myNotes() async => _rows(await _client.rpc('wp_my_notes').timeout(_readTimeout));

  @override
  Future<List<Map<String, dynamic>>> myProposals() async => _rows(await _client.rpc('wp_my_proposals').timeout(_readTimeout));

  @override
  Future<List<Destination>> destinations() async =>
      _rows(await _client.rpc('pr_destinations').timeout(_readTimeout)).map(Destination.fromRow).toList();

  @override
  Future<List<MyTeam>> myTeams() async => _rows(await _client.rpc('pr_my_teams').timeout(_readTimeout)).map(MyTeam.fromRow).toList();

  @override
  Future<Map<String, dynamic>> acknowledge(String opId, String taskId, int version, {required String workerId}) =>
      _write('wp_acknowledge', ackParams(opId, taskId, version), workerId);

  @override
  Future<Map<String, dynamic>> startWork(String opId, String taskId, {required String workerId}) =>
      _write('wp_start_work', taskParams(opId, taskId), workerId);

  @override
  Future<Map<String, dynamic>> reportProgress(String opId, String taskId, String note, {required String workerId}) =>
      _write('wp_report_progress', noteParams(opId, taskId, note), workerId);

  @override
  Future<Map<String, dynamic>> reportBlocker(String opId, String taskId, String kind, String description, String? requestId,
          {required String workerId}) =>
      _write('wp_report_blocker', blockerParams(opId, taskId, kind, description, requestId), workerId);

  @override
  Future<Map<String, dynamic>> reportDone(String opId, String taskId, String note, {required String workerId}) =>
      _write('wp_report_done', noteParams(opId, taskId, note), workerId);

  @override
  Future<Map<String, dynamic>> leaderCheck(String opId, String taskId, String note, {required String workerId}) =>
      _write('wp_leader_check', noteParams(opId, taskId, note), workerId);

  @override
  Future<Map<String, dynamic>> propose(String opId, Map<String, dynamic> body, {required String workerId}) => _write(
        'wp_propose_task',
        proposeParams(opId, body['team_id'] as String, body['folder_id'] as String, body['work_id'] as String,
            body['title'] as String, (body['details'] as String?) ?? ''),
        workerId,
      );

  @override
  Future<void> attachPhoto({
    required String opId,
    required String taskId,
    required String? blockerId,
    required int? eventId,
    required String photoId,
    required String localPath,
    required String workerId,
  }) async {
    _sameWorker(workerId);
    final path = taskPhotoPath(workerId: workerId, taskId: taskId, photoId: photoId);
    try {
      await _client.storage
          .from(taskPhotoBucket)
          .upload(path, File(localPath), fileOptions: const FileOptions(upsert: false, contentType: 'image/jpeg'))
          .timeout(_uploadTimeout);
    } catch (e) {
      // 0093 gives workers no UPDATE on storage: a retry after the upload
      // landed sees "already exists", which is success.
      if (!isAlreadyUploaded(e)) rethrow;
    }
    // The upload can take a minute: a sign-out and another sign-in meanwhile
    // must not link the photo under someone else.
    _sameWorker(workerId);
    await _client.rpc('wp_attach_photo', params: attachTaskPhotoParams(opId, taskId, blockerId, eventId, path)).timeout(_rpcTimeout);
  }

  @override
  Future<String?> signedUrl(String path) async {
    try {
      return await _client.storage.from(taskPhotoBucket).createSignedUrl(path, 600).timeout(_readTimeout);
    } catch (_) {
      return null;
    }
  }
}
```

Create `lib/workplan/data/workplan_db.dart`:

```dart
import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../domain/wp_op.dart';

/// My Work's send-once queue and the last answers the app read (for offline
/// use) — every row scoped by worker, because site phones are shared. Its own
/// file, apart from attendance and requests, so none can break another.
class WorkPlanDb {
  WorkPlanDb._(this._db);

  final Database _db;

  static Future<WorkPlanDb> open(DatabaseFactory factory, String path, {bool singleInstance = true}) async {
    final db = await factory.openDatabase(
      path,
      options: OpenDatabaseOptions(version: 1, onCreate: _create, singleInstance: singleInstance),
    );
    return WorkPlanDb._(db);
  }

  static Future<void> _create(Database db, int version) async {
    await db.execute('''
      create table wp_op (
        op_id text primary key,
        worker_id text not null,
        kind text not null,
        task_id text,
        parent_op_id text,
        blocker_id text,
        event_id integer,
        body text not null,
        seq integer not null,
        attempts integer not null default 0,
        last_error text,
        failed_permanently integer not null default 0,
        created_at integer not null
      )''');
    await db.execute('''
      create table wp_cache (
        worker_id text not null,
        name text not null,
        body text not null,
        fetched_at integer not null,
        primary key (worker_id, name)
      )''');
    // The server's answer to each accepted action, numbered per worker, so a
    // read that started BEFORE the action can never overwrite it.
    await db.execute('''
      create table wp_accepted (
        worker_id text not null,
        task_id text not null,
        seq integer not null,
        body text not null,
        primary key (worker_id, task_id)
      )''');
    await db.execute('''
      create table wp_accepted_seq (
        worker_id text primary key,
        seq integer not null
      )''');
  }

  Future<void> close() => _db.close();

  // ── the queue ──────────────────────────────────────────────────────────

  /// Appended in list order (one transaction: a report and its photo are
  /// queued together or not at all).
  Future<void> addOps(List<WpOp> ops) => _db.transaction((txn) async {
        var seq = (await txn.rawQuery('select coalesce(max(seq), 0) as s from wp_op')).first['s']! as int;
        for (final o in ops) {
          seq++;
          await txn.insert('wp_op', {...o.toMap(), 'seq': seq});
        }
      });

  /// This worker's ops that may still be sent, in queue order.
  Future<List<WpOp>> sendable(String workerId) async =>
      (await _db.query('wp_op', where: 'worker_id = ? and failed_permanently = 0', whereArgs: [workerId], orderBy: 'seq asc'))
          .map(WpOp.fromMap)
          .toList();

  /// Every op of this worker, refused ones included, in queue order.
  Future<List<WpOp>> ops(String workerId) async =>
      (await _db.query('wp_op', where: 'worker_id = ?', whereArgs: [workerId], orderBy: 'seq asc')).map(WpOp.fromMap).toList();

  Future<WpOp?> op(String opId) async {
    final rows = await _db.query('wp_op', where: 'op_id = ?', whereArgs: [opId], limit: 1);
    return rows.isEmpty ? null : WpOp.fromMap(rows.first);
  }

  /// Any worker: the app-closed sweeper asks this before it touches auth.
  Future<bool> hasAnySendable() async =>
      (await _db.query('wp_op', columns: ['op_id'], where: 'failed_permanently = 0', limit: 1)).isNotEmpty;

  /// [countsTowardCap]: an unexpected failure adds one; any other failure
  /// starts the run again at zero, so only such failures IN A ROW give up.
  Future<void> recordAttempt(String opId, String error, {bool countsTowardCap = true}) => _db.rawUpdate(
      'update wp_op set attempts = case when ? then attempts + 1 else 0 end, last_error = ? where op_id = ?',
      [countsTowardCap ? 1 : 0, error, opId]);

  Future<void> markFailed(String opId, String error) =>
      _db.rawUpdate('update wp_op set failed_permanently = 1, last_error = ? where op_id = ?', [error, opId]);

  /// A refused report takes its photos with it: they can never be linked.
  Future<void> failChildren(String parentOpId, String error) => _db.rawUpdate(
      'update wp_op set failed_permanently = 1, last_error = ? where parent_op_id = ? and failed_permanently = 0',
      [error, parentOpId]);

  /// The photos queued with a report.
  Future<List<WpOp>> children(String parentOpId) async =>
      (await _db.query('wp_op', where: 'parent_op_id = ?', whereArgs: [parentOpId], orderBy: 'seq asc')).map(WpOp.fromMap).toList();

  Future<void> deleteOp(String opId) => _db.delete('wp_op', where: 'op_id = ?', whereArgs: [opId]);

  /// An action the server accepted, in ONE transaction: its photos are
  /// pointed at what it created, the task the server answered with replaces
  /// the saved copy of that task, and only then does the action leave the
  /// queue. A refresh that fails afterwards can then never bring back the
  /// state from before the action (e.g. unlock Report done after a problem
  /// was accepted).
  Future<void> settle(WpOp op, {Map<String, dynamic>? task, String? blockerId, int? eventId}) => _db.transaction((txn) async {
        if (blockerId != null || eventId != null) {
          await txn.update('wp_op', {'blocker_id': blockerId, 'event_id': eventId},
              where: 'parent_op_id = ?', whereArgs: [op.opId]);
        }
        final id = task?['id'];
        if (id is String) {
          final seq = await _nextAccepted(txn, op.workerId);
          await txn.insert('wp_accepted', {'worker_id': op.workerId, 'task_id': id, 'seq': seq, 'body': jsonEncode(task)},
              conflictAlgorithm: ConflictAlgorithm.replace);
          await _patchSavedTask(txn, op.workerId, id, task!);
        }
        await txn.delete('wp_op', where: 'op_id = ?', whereArgs: [op.opId]);
      });

  Future<int> _nextAccepted(Transaction txn, String workerId) async {
    final rows = await txn.query('wp_accepted_seq', columns: ['seq'], where: 'worker_id = ?', whereArgs: [workerId], limit: 1);
    final next = (rows.isEmpty ? 0 : rows.first['seq']! as int) + 1;
    await txn.insert('wp_accepted_seq', {'worker_id': workerId, 'seq': next}, conflictAlgorithm: ConflictAlgorithm.replace);
    return next;
  }

  /// The number of [workerId]'s newest accepted answer. A read takes it
  /// BEFORE asking the server: everything up to it is already in what the
  /// server will answer; anything above it arrived while the read travelled.
  Future<int> acceptedSeq(String workerId) async {
    final rows = await _db.query('wp_accepted_seq', columns: ['seq'], where: 'worker_id = ?', whereArgs: [workerId], limit: 1);
    return rows.isEmpty ? 0 : rows.first['seq']! as int;
  }

  /// Replaces one task in [workerId]'s saved task list. Never creates a list:
  /// a copy wiped at sign-out stays wiped.
  Future<void> _patchSavedTask(Transaction txn, String workerId, String taskId, Map<String, dynamic> doc) async {
    final rows =
        await txn.query('wp_cache', columns: ['body'], where: 'worker_id = ? and name = ?', whereArgs: [workerId, 'work'], limit: 1);
    if (rows.isEmpty) return;
    final list = [for (final d in jsonDecode(rows.first['body']! as String) as List<dynamic>) Map<String, dynamic>.from(d as Map)];
    final i = list.indexWhere((d) => d['id'] == taskId);
    if (i < 0) return;
    list[i] = doc;
    await txn.update('wp_cache', {'body': jsonEncode(list)}, where: 'worker_id = ? and name = ?', whereArgs: [workerId, 'work']);
  }

  // ── last answers read, for offline ─────────────────────────────────────

  /// Saves lists read from the server for [workerId], in ONE transaction that
  /// first asks [stillValid] — so a sign-out's cleanup (also a transaction)
  /// either ran before and refuses this save, or runs after and removes it.
  /// Throws AUTH_REQUIRED when the worker changed.
  ///
  /// [readSince] (the [acceptedSeq] taken before the read): in the task list
  /// ('work'), every task with an accepted answer numbered above it keeps that
  /// answer — the read is older than the action. Answers at or below it are
  /// in the server's list already and are forgotten. Returns the lists as
  /// saved (what the screen should show).
  Future<Map<String, List<Map<String, dynamic>>>> saveLists(
    String workerId,
    Map<String, List<Map<String, dynamic>>> lists,
    DateTime at, {
    required bool Function() stillValid,
    int? readSince,
  }) =>
      _db.transaction((txn) async {
        if (!stillValid()) throw StateError('AUTH_REQUIRED');
        final out = <String, List<Map<String, dynamic>>>{};
        for (final e in lists.entries) {
          var docs = e.value;
          if (e.key == 'work' && readSince != null) {
            final newer = {
              for (final r in await txn.query('wp_accepted', where: 'worker_id = ? and seq > ?', whereArgs: [workerId, readSince]))
                r['task_id']! as String: Map<String, dynamic>.from(jsonDecode(r['body']! as String) as Map),
            };
            docs = [for (final d in docs) newer[d['id']] ?? d];
            await txn.delete('wp_accepted', where: 'worker_id = ? and seq <= ?', whereArgs: [workerId, readSince]);
          }
          await txn.insert(
            'wp_cache',
            {'worker_id': workerId, 'name': e.key, 'body': jsonEncode(docs), 'fetched_at': at.millisecondsSinceEpoch},
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
          out[e.key] = docs;
        }
        return out;
      });

  Future<({Object? body, DateTime at})?> cache(String workerId, String name) async {
    final rows = await _db.query('wp_cache', where: 'worker_id = ? and name = ?', whereArgs: [workerId, name], limit: 1);
    if (rows.isEmpty) return null;
    return (
      body: jsonDecode(rows.first['body']! as String),
      at: DateTime.fromMillisecondsSinceEpoch(rows.first['fetched_at']! as int, isUtc: true),
    );
  }

  /// Spec §11: another worker's saved tasks and notes are never shown on this
  /// phone — only [workerId]'s copy is kept ('' keeps none). Queued ops stay:
  /// cleanup must never delete unsent work; they wait for their own worker.
  Future<void> keepCacheOnly(String workerId) => _db.transaction((txn) async {
        for (final table in ['wp_cache', 'wp_accepted', 'wp_accepted_seq']) {
          await txn.delete(table, where: 'worker_id <> ?', whereArgs: [workerId]);
        }
      });
}

/// The database file on the phone, shared by the app and the background sync.
Future<WorkPlanDb> openDeviceWorkPlanDb({bool singleInstance = true}) async =>
    WorkPlanDb.open(databaseFactory, '${await getDatabasesPath()}/workmate_workplan.db', singleInstance: singleInstance);
```

Create `lib/workplan/data/workplan_api.dart`:

```dart
import '../../requests/domain/request_models.dart';
import '../domain/wp_op.dart';
import '../domain/wp_rules.dart';
import '../domain/wp_task.dart';

/// Everything My Work shows, fresh when online, the phone's last copy offline.
class WorkPlanView {
  const WorkPlanView({
    this.entries = const [],
    this.notes = const [],
    this.proposals = const [],
    this.pendingProposals = const [],
    this.otherFailed = const [],
    this.otherPending = const [],
    this.fetchedAt,
    this.fromCache = false,
    this.error,
  });

  /// Every task this worker has a role on, with what the phone still owes.
  final List<WpEntry> entries;
  final List<WpNote> notes;
  final List<WpProposal> proposals;

  /// Proposals made on this phone, not yet received by the office.
  final List<WpOp> pendingProposals;

  /// Refused operations whose task is no longer on this worker's list (taken
  /// off it, or cancelled) and refused proposals — shown so nobody believes
  /// they reached the office.
  final List<WpOp> otherFailed;

  /// Still-unsent operations whose task is not on the list just read.
  final List<WpOp> otherPending;

  /// When the server's list was read (now, or the saved copy's time).
  final DateTime? fetchedAt;
  final bool fromCache;

  /// Why the server could not be read just now; null when it was.
  final Object? error;

  WpEntry? entry(String taskId) => entries.where((e) => e.task.id == taskId).firstOrNull;
}

/// What a leader proposes from: the teams they currently lead and the open
/// projects / works.
class WpChoices {
  const WpChoices({required this.teams, required this.destinations, this.fromCache = false});

  final List<MyTeam> teams;
  final List<Destination> destinations;
  final bool fromCache;
}

/// Thrown before anything is queued when a report is incomplete.
class WpInvalid implements Exception {
  const WpInvalid(this.field);

  /// 'note', 'description', 'kind', 'title', 'team' or 'destination'.
  final String field;

  @override
  String toString() => 'WpInvalid($field)';
}

/// The problem kinds 0093 accepts, in the order the form offers them.
const wpProblemKinds = ['materials', 'tool', 'preparation', 'other'];

/// What the My Work screens need. An interface so every controller and
/// screen tests with a fake instead of a database and a server.
abstract interface class WorkPlanApi {
  Future<WorkPlanView> load();

  /// "I've read this" for the version on screen.
  Future<void> acknowledge(WpTask task);
  Future<void> startWork(WpTask task);

  /// [photo] is a path [keepPhoto] returned.
  Future<void> reportProgress(WpTask task, String note, {String? photo});
  Future<void> reportProblem(WpTask task, {required String kind, required String description, String? requestId, String? photo});
  Future<void> reportDone(WpTask task, String note);
  Future<void> checkWork(WpTask task, String note);

  Future<WpChoices> choices();
  Future<void> propose({required MyTeam team, required Destination destination, required String title, required String details});

  /// Files a fresh capture: upright, scaled, compressed, in app-private
  /// storage (never the gallery). Returns the stored path.
  Future<String> keepPhoto(String capturedPath);
  Future<void> discardPhoto(String path);

  /// Forgets a refused operation the worker has read.
  Future<void> dismissFailed(WpOp op);

  Future<String?> photoUrl(String path);

  /// Keeps only [workerId]'s saved copy ('' keeps none).
  Future<void> keepOnly(String workerId);
}
```

Create `lib/workplan/data/workplan_repository.dart`:

```dart
import 'dart:async';
import 'dart:io';

import '../../attendance/device/device_bridge.dart';
import '../../attendance/domain/event_id.dart';
import '../../attendance/sync/upload_scheduler.dart';
import '../../requests/domain/request_models.dart';
import '../domain/wp_op.dart';
import '../domain/wp_rules.dart';
import '../domain/wp_task.dart';
import 'workplan_api.dart';
import 'workplan_db.dart';
import 'workplan_remote.dart';

/// Offline-first My Work (spec §11). Every action is saved on the phone
/// first and reaches the server whenever there is signal, from the app or
/// from the background task. The server re-checks role, assignment, version
/// and state when it arrives.
class WorkPlanRepository implements WorkPlanApi {
  WorkPlanRepository({
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

  final WorkPlanDb db;
  final WorkPlanRemote remote;
  final DeviceBridge device;

  /// The same WorkManager work as attendance and requests: one background
  /// drain sends all three.
  final UploadScheduler scheduler;

  /// The worker the app let in, or '' — the scope of EVERY read and write.
  final String Function() currentWorkerId;

  /// App-private folder for task photos (never the gallery).
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

  /// Still the worker a read started for? A sign-out or a switch while the
  /// answer travelled means the answer is not theirs to keep or show.
  bool _still(String w) => currentWorkerId() == w;

  void _stillOrThrow(String w) {
    if (!_still(w)) throw StateError('AUTH_REQUIRED');
  }

  Future<void> _kick() async {
    try {
      await scheduler.enqueue('workplan');
    } catch (_) {
      // Queued on disk; the periodic sweeper is the backstop.
    }
    final now = sendNow;
    if (now != null) unawaited(Future.sync(now).catchError((Object _) {}));
  }

  WpOp _op(String w, WpOpKind kind, {String? taskId, Map<String, dynamic> body = const {}, String? parent}) =>
      WpOp(opId: _newId(), workerId: w, kind: kind, createdAt: _now(), taskId: taskId, parentOpId: parent, body: body);

  Future<void> _queue(List<WpOp> ops) async {
    await db.addOps(ops);
    await _kick();
  }

  // ── reading ────────────────────────────────────────────────────────────

  /// One list, fresh or saved. The saved copy is used only for the list that
  /// could not be read, and only this worker's.
  Future<({List<Map<String, dynamic>> docs, DateTime? at, bool cached, Object? error})> _read(
      String w, String name, Future<List<Map<String, dynamic>>> Function() fetch, int readSince) async {
    try {
      final docs = await fetch();
      final at = _now();
      // Checked inside the save's transaction: a copy wiped at sign-out is
      // never written back by an answer that arrives late, and an action
      // accepted while this read travelled keeps the server's newer answer.
      final saved = await db.saveLists(w, {name: docs}, at, stillValid: () => _still(w), readSince: readSince);
      return (docs: saved[name]!, at: at, cached: false, error: null);
    } catch (e) {
      _stillOrThrow(w);
      final saved = await db.cache(w, name);
      if (saved == null) return (docs: const <Map<String, dynamic>>[], at: null, cached: false, error: e);
      return (
        docs: [for (final d in saved.body as List<dynamic>) Map<String, dynamic>.from(d as Map)],
        at: saved.at,
        cached: true,
        error: e,
      );
    }
  }

  @override
  Future<WorkPlanView> load() async {
    final w = _worker();
    // Taken BEFORE asking the server (see WorkPlanDb.saveLists).
    final since = await db.acceptedSeq(w);
    // All three at once: on a weak signal the wait is one timeout, not three.
    final reads = await Future.wait([
      _read(w, 'work', remote.myWork, since),
      _read(w, 'notes', remote.myNotes, since),
      _read(w, 'proposals', remote.myProposals, since),
    ]);
    final (work, notes, proposals) = (reads[0], reads[1], reads[2]);
    final ops = await db.ops(w);
    // The last wait is over: if the app let someone else in meanwhile, this
    // view is not theirs.
    _stillOrThrow(w);

    final tasks = [for (final d in work.docs) ?WpTask.fromJson(d)];
    final ids = {for (final t in tasks) t.id};
    final entries = [
      for (final t in tasks)
        WpEntry(
          task: t,
          pendingOps: ops.where((o) => o.taskId == t.id && !o.failedPermanently).toList(),
          failedOps: ops.where((o) => o.taskId == t.id && o.failedPermanently).toList(),
        ),
    ];
    return WorkPlanView(
      entries: entries,
      notes: [for (final n in notes.docs) WpNote.fromJson(n)],
      proposals: [for (final p in proposals.docs) WpProposal.fromJson(p)],
      pendingProposals: ops.where((o) => o.kind == WpOpKind.propose && !o.failedPermanently).toList(),
      otherFailed: ops.where((o) => o.failedPermanently && (o.taskId == null || !ids.contains(o.taskId))).toList(),
      otherPending: ops
          .where((o) => !o.failedPermanently && o.kind != WpOpKind.propose && o.taskId != null && !ids.contains(o.taskId))
          .toList(),
      fetchedAt: work.at,
      fromCache: work.cached,
      // The task list decides what the screen says about the connection.
      error: work.error,
    );
  }

  // ── actions ────────────────────────────────────────────────────────────

  @override
  Future<void> acknowledge(WpTask task) async {
    final w = _worker();
    // A second tap for the same version queues nothing.
    final queued = await db.sendable(w);
    if (queued.any((o) => o.kind == WpOpKind.acknowledge && o.taskId == task.id && o.version == task.version)) return;
    await _queue([_op(w, WpOpKind.acknowledge, taskId: task.id, body: {'version': task.version})]);
  }

  @override
  Future<void> startWork(WpTask task) async {
    final w = _worker();
    final queued = await db.sendable(w);
    if (queued.any((o) => o.kind == WpOpKind.start && o.taskId == task.id)) return;
    await _queue([_op(w, WpOpKind.start, taskId: task.id)]);
  }

  /// The report, then its photo (linked once the report lands).
  List<WpOp> _withPhoto(String w, WpOp report, String? photo) => [
        report,
        if (photo != null)
          _op(w, WpOpKind.photo, taskId: report.taskId, parent: report.opId, body: {'local_path': photo, 'photo_id': _newId()}),
      ];

  @override
  Future<void> reportProgress(WpTask task, String note, {String? photo}) async {
    final text = note.trim();
    if (text.isEmpty) throw const WpInvalid('note');
    final w = _worker();
    await _queue(_withPhoto(w, _op(w, WpOpKind.progress, taskId: task.id, body: {'note': text}), photo));
  }

  @override
  Future<void> reportProblem(WpTask task, {required String kind, required String description, String? requestId, String? photo}) async {
    if (!wpProblemKinds.contains(kind)) throw const WpInvalid('kind');
    final text = description.trim();
    if (text.isEmpty) throw const WpInvalid('description');
    final w = _worker();
    final report = _op(w, WpOpKind.blocker, taskId: task.id, body: {'kind': kind, 'description': text, 'request_id': requestId});
    await _queue(_withPhoto(w, report, photo));
  }

  @override
  Future<void> reportDone(WpTask task, String note) async {
    final w = _worker();
    final queued = await db.sendable(w);
    if (queued.any((o) => o.kind == WpOpKind.done && o.taskId == task.id)) return;
    await _queue([_op(w, WpOpKind.done, taskId: task.id, body: {'note': note.trim()})]);
  }

  @override
  Future<void> checkWork(WpTask task, String note) async {
    final w = _worker();
    final queued = await db.sendable(w);
    if (queued.any((o) => o.kind == WpOpKind.check && o.taskId == task.id)) return;
    await _queue([_op(w, WpOpKind.check, taskId: task.id, body: {'note': note.trim()})]);
  }

  // ── proposals ──────────────────────────────────────────────────────────

  @override
  Future<WpChoices> choices() async {
    final w = _worker();
    try {
      final teams = await remote.myTeams();
      final destinations = await remote.destinations();
      final at = _now();
      // Both answers belong to the worker the form opened for, or neither is
      // used: checked before, inside the save's transaction, and after it.
      _stillOrThrow(w);
      await db.saveLists(
        w,
        {'teams': [for (final t in teams) t.toRow()], 'destinations': [for (final d in destinations) d.toRow()]},
        at,
        stillValid: () => _still(w),
      );
      _stillOrThrow(w);
      return WpChoices(teams: teams.where((t) => t.iLead).toList(), destinations: destinations);
    } catch (_) {
      _stillOrThrow(w);
      final t = await db.cache(w, 'teams');
      final d = await db.cache(w, 'destinations');
      if (t == null || d == null) rethrow;
      List<Map<String, dynamic>> rows(Object? body) => [for (final r in body as List<dynamic>) Map<String, dynamic>.from(r as Map)];
      return WpChoices(
        teams: rows(t.body).map(MyTeam.fromRow).where((t) => t.iLead).toList(),
        destinations: rows(d.body).map(Destination.fromRow).toList(),
        fromCache: true,
      );
    }
  }

  @override
  Future<void> propose({required MyTeam team, required Destination destination, required String title, required String details}) async {
    final text = title.trim();
    if (text.isEmpty) throw const WpInvalid('title');
    final w = _worker();
    await _queue([
      _op(w, WpOpKind.propose, body: {
        'team_id': team.id,
        'folder_id': destination.projectId,
        'work_id': destination.workId,
        'title': text,
        'details': details.trim(),
        // Display only, while it waits for signal.
        'team_name': team.name,
        'where': destination.label,
      }),
    ]);
  }

  // ── photos and refused operations ──────────────────────────────────────

  @override
  Future<String> keepPhoto(String capturedPath) async {
    final dir = await photoDir();
    await dir.create(recursive: true);
    // No caption: a task photo shows the work, not a time stamp.
    return device.preparePhoto(source: capturedPath, target: '${dir.path}${Platform.pathSeparator}${_newId()}.jpg', caption: '');
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
  Future<void> dismissFailed(WpOp op) async {
    final stored = await db.op(op.opId);
    // Only this worker's own, and only a refused one: a sendable op is still owed.
    if (stored == null || stored.workerId != _worker() || !stored.failedPermanently) return;
    // A refused report's photos were refused with it: they go together.
    final gone = [stored, for (final c in await db.children(stored.opId)) if (c.failedPermanently) c];
    for (final o in gone) {
      await db.deleteOp(o.opId);
      final path = o.localPath;
      if (o.kind == WpOpKind.photo && path != null) await discardPhoto(path);
    }
  }

  @override
  Future<String?> photoUrl(String path) => remote.signedUrl(path);

  @override
  Future<void> keepOnly(String workerId) => db.keepCacheOnly(workerId);
}
```

Create `lib/workplan/data/workplan_account_wipe.dart`:

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../app_controller.dart';
import 'workplan_api.dart';

/// Spec §11: account switching must not reveal another worker's tasks or
/// notes. Fed every app state: once a worker is let in, only their saved copy
/// is kept; signed out, none is. Startup and the Terms screens decide
/// nothing. Unsent actions are never touched — they wait for their worker.
class WorkPlanAccountWipe {
  WorkPlanAccountWipe(this.work);

  final WorkPlanApi work;
  String? _kept;

  void onAppState(AppState s) {
    final keep = switch (s) {
      Ready(:final worker) => worker.id,
      SignedOut() => '',
      _ => null,
    };
    if (keep == null || keep == _kept) return;
    _kept = keep;
    unawaited(work.keepOnly(keep).catchError((Object e) {
      debugPrint('My Work wipe failed: $e');
      if (_kept == keep) _kept = null; // try again on the next state
    }));
  }
}
```

Create `lib/workplan/sync/workplan_sync.dart`:

```dart
import 'dart:io';

import '../../attendance/sync/submission_sync.dart' show SyncResult;
import '../data/workplan_db.dart';
import '../data/workplan_remote.dart';
import '../domain/wp_failure.dart';
import '../domain/wp_op.dart';

/// A sane ceiling for one pass.
const _maxPerRun = 100;

/// Drains the My Work queue: ONE run sends this worker's ops in queue order,
/// stopping at the first transient failure, so "I've read this" always lands
/// before the Start made after it, and a report before its photo.
class WorkPlanSync {
  WorkPlanSync({required this.db, required this.remote});

  final WorkPlanDb db;
  final WorkPlanRemote remote;

  /// Ops the last [drain] finished with: sent, or refused for good.
  int settled = 0;

  Future<SyncResult> drain(String workerId) async {
    settled = 0;
    // With no session nothing may be sent: it would file under whoever signs in next.
    if (workerId.isEmpty) return SyncResult.done;
    for (var i = 0; i < _maxPerRun; i++) {
      final queue = await db.sendable(workerId);
      if (queue.isEmpty) return SyncResult.done;
      if (await _send(queue.first, workerId) == SyncResult.retry) return SyncResult.retry;
      settled++;
    }
    return SyncResult.done;
  }

  Future<SyncResult> _send(WpOp op, String workerId) async {
    try {
      final task = op.taskId;
      Map<String, dynamic>? answer;
      switch (op.kind) {
        case WpOpKind.acknowledge:
          // An outdated version is answered with the current task and recorded
          // nowhere (0093): the saved task then shows it as still to read.
          answer = await remote.acknowledge(op.opId, task!, op.version ?? 0, workerId: workerId);
        case WpOpKind.start:
          answer = await remote.startWork(op.opId, task!, workerId: workerId);
        case WpOpKind.progress:
          final result = await remote.reportProgress(op.opId, task!, op.note, workerId: workerId);
          await db.settle(op, task: _task(result), eventId: (result['event_id'] as num?)?.toInt());
          return SyncResult.done;
        case WpOpKind.blocker:
          final b = op.body;
          final result = await remote.reportBlocker(
              op.opId, task!, b['kind'] as String, b['description'] as String, b['request_id'] as String?,
              workerId: workerId);
          await db.settle(op, task: _task(result), blockerId: result['blocker_id'] as String?);
          return SyncResult.done;
        case WpOpKind.done:
          answer = await remote.reportDone(op.opId, task!, op.note, workerId: workerId);
        case WpOpKind.check:
          answer = await remote.leaderCheck(op.opId, task!, op.note, workerId: workerId);
        case WpOpKind.propose:
          await remote.propose(op.opId, op.body, workerId: workerId);
        case WpOpKind.photo:
          final file = File(op.localPath ?? '');
          // Its report never landed (refused, which fails this op too): there
          // is nothing to link it to.
          if (op.blockerId == null && op.eventId == null) {
            await db.markFailed(op.opId, 'PHOTO_ORPHAN');
            return SyncResult.done;
          }
          if (!file.existsSync()) {
            await db.markFailed(op.opId, 'PHOTO_MISSING');
            return SyncResult.done;
          }
          await remote.attachPhoto(
            opId: op.opId,
            taskId: task!,
            blockerId: op.blockerId,
            eventId: op.eventId,
            photoId: op.photoId!,
            localPath: file.path,
            workerId: workerId,
          );
          await db.deleteOp(op.opId);
          _discard(file); // only now is the photo safe to delete
          return SyncResult.done;
      }
      await db.settle(op, task: _task(answer));
      return SyncResult.done;
    } catch (error) {
      final failure = WpFailure.of(error);
      await db.recordAttempt(op.opId, failure.name, countsTowardCap: failure.countsTowardCap);
      final givingUp = failure.countsTowardCap && op.attempts + 1 >= maxWpAttempts;
      if (failure.retryable && !givingUp) return SyncResult.retry;
      // Kept, flagged and shown: never let a worker believe it reached the office.
      await db.markFailed(op.opId, failure.name);
      await db.failChildren(op.opId, failure.name);
      return SyncResult.done;
    }
  }

  /// The task the server answered with (0093 returns it after each action).
  Map<String, dynamic>? _task(Map<String, dynamic>? result) {
    final t = result?['task'];
    return t is Map ? Map<String, dynamic>.from(t) : null;
  }

  void _discard(File photo) {
    try {
      photo.deleteSync();
    } catch (_) {}
  }
}
```

Replace the whole of `lib/attendance/sync/background_sync.dart` with this. It is the existing file plus: the workplan imports, `_workPlanWaiting()` in the app-closed probe, `onWorkPlanSettled` on `syncWith`, and an optional `workPlan` drain after requests in `drainInOrder`. Every existing behaviour stays.

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
import '../../requests/data/request_remote.dart';
import '../../requests/data/requests_db.dart';
import '../../requests/sync/request_sync.dart';
import '../../workplan/data/workplan_db.dart';
import '../../workplan/data/workplan_remote.dart';
import '../../workplan/sync/workplan_sync.dart';
import '../data/attendance_db.dart';
import '../data/attendance_remote.dart';
import '../../widget/widget_bridge.dart';
import '../../widget/widget_publisher.dart';
import 'submission_sync.dart';
import 'sync_host.dart';

/// WorkManager's entry point. The task ALWAYS runs in a new engine (platform
/// channels of MainActivity are NOT available and nothing below needs them).
/// When the app is alive the work is handed to it; otherwise this isolate builds
/// its own client and database.
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
  // A live app owns the session's token refresh: hand the work to it.
  final delegated = await delegateToLiveApp();
  if (delegated != null) return delegated;

  // Nothing to send: never touch auth (a needless refresh can burn a rotating token).
  final probe = await openDeviceAttendanceDb(singleInstance: false);
  try {
    if (!await probe.hasAnySendable() && !await _requestsWaiting() && !await _workPlanWaiting()) return true;
  } finally {
    await probe.close();
  }

  final prefs = await SharedPreferences.getInstance();
  final info = await PackageInfo.fromPlatform();
  final client = await initWorkMateSupabase(
    httpClient: WorkMateHttpClient(versionCode: int.parse(info.buildNumber), nudges: UpdateNudges()),
    localStorage: WorkMateSessionStorage(secure: SecureBox(), plain: prefs),
  );
  // No live app: this engine updates the widget itself (the plugin works here).
  return syncWith(client, afterChange: WidgetPublisher(const ChannelWidgetBridge()).publish);
}

/// Requests waiting to be sent. False when the requests database cannot be
/// read: a request problem must never stop attendance from going out.
Future<bool> _requestsWaiting() async {
  try {
    final db = await openDeviceRequestsDb(singleInstance: false);
    try {
      return await db.hasAnySendable();
    } finally {
      await db.close();
    }
  } catch (_) {
    return false;
  }
}

/// My Work actions waiting to be sent. False when its database cannot be
/// read: a My Work problem must never stop attendance from going out.
Future<bool> _workPlanWaiting() async {
  try {
    final db = await openDeviceWorkPlanDb(singleInstance: false);
    try {
      return await db.hasAnySendable();
    } finally {
      await db.close();
    }
  } catch (_) {
    return false;
  }
}

/// Refresh the session if needed, then drain this worker's queues: attendance
/// first, then requests (0085), then My Work (0093). Shared by the background isolate and the live
/// app's [AttendanceSyncHost]. [afterChange] (the widget and Home) runs as soon
/// as the ATTENDANCE drain settled a row, with its own database — never held
/// back by request photo uploads. [onRequestsSettled] runs when the requests
/// drain settled one: it only tells the screens (the widget shows no requests).
/// [onWorkPlanSettled] likewise for My Work.
Future<bool> syncWith(
  SupabaseClient client, {
  Future<void> Function(AttendanceDb db, String workerId)? afterChange,
  FutureOr<void> Function()? onRequestsSettled,
  FutureOr<void> Function()? onWorkPlanSettled,
}) async {
  // The stored session may be expired: join (or start) its refresh before sending.
  try {
    await client.auth.getSession().timeout(const Duration(seconds: 60));
  } on AuthRetryableFetchException {
    return false;
  } on TimeoutException {
    return false;
  } on AuthException {
    return true; // signed out (e.g. token revoked): nothing may be sent under nobody
  }

  final workerId = client.auth.currentUser?.id ?? '';
  // Own connection: sqflite_android shares singleInstance handles across engines,
  // so closing one here would close another engine's database.
  final db = await openDeviceAttendanceDb(singleInstance: false);
  try {
    final sync = SubmissionSync(db: db, remote: SupabaseAttendanceRemote(client));
    return await drainInOrder(
      attendance: () async {
        final result = await sync.drain(workerId);
        return (result: result, settled: sync.settled);
      },
      requests: () async {
        final requestsDb = await openDeviceRequestsDb(singleInstance: false);
        try {
          final requests = RequestSync(db: requestsDb, remote: SupabaseRequestRemote(client));
          final result = await requests.drain(workerId);
          return (result: result, settled: requests.settled);
        } finally {
          await requestsDb.close();
        }
      },
      workPlan: () async {
        final workDb = await openDeviceWorkPlanDb(singleInstance: false);
        try {
          final work = WorkPlanSync(db: workDb, remote: SupabaseWorkPlanRemote(client));
          final result = await work.drain(workerId);
          return (result: result, settled: work.settled);
        } finally {
          await workDb.close();
        }
      },
      attendanceWaiting: () async => workerId.isNotEmpty && (await db.sendable(workerId)).isNotEmpty,
      afterAttendance: afterChange == null ? null : () => afterChange(db, workerId),
      onRequestsSettled: onRequestsSettled,
      onWorkPlanSettled: onWorkPlanSettled,
    );
  } finally {
    await db.close();
  }
}

/// One drain's answer: whether to come back, and how many rows it finished.
typedef DrainOutcome = ({SyncResult result, int settled});

/// [syncWith]'s order, apart from the session and the databases:
/// 1. attendance, and at once [afterAttendance] if it settled a row;
/// 2. requests — any failure, even opening its database, only asks WorkManager
///    to come back; it never fails or blocks attendance — then
///    [onRequestsSettled] if they settled one; then My Work ([workPlan]) the
///    same way, then [onWorkPlanSettled];
/// 3. attendance ONCE more when a row is waiting again: a Time In queued while
///    request photos uploaded goes now, not at the next sweep.
/// An attendance failure propagates exactly as before (the caller retries).
@visibleForTesting
Future<bool> drainInOrder({
  required Future<DrainOutcome> Function() attendance,
  required Future<DrainOutcome> Function() requests,
  required Future<bool> Function() attendanceWaiting,
  Future<DrainOutcome> Function()? workPlan,
  Future<void> Function()? afterAttendance,
  FutureOr<void> Function()? onRequestsSettled,
  FutureOr<void> Function()? onWorkPlanSettled,
}) async {
  var att = await attendance();
  if (att.settled > 0) await _tell(afterAttendance);

  DrainOutcome req;
  try {
    req = await requests();
  } catch (_) {
    req = (result: SyncResult.retry, settled: 0);
  }
  if (req.settled > 0) await _tell(onRequestsSettled);

  DrainOutcome work = (result: SyncResult.done, settled: 0);
  if (workPlan != null) {
    try {
      work = await workPlan();
    } catch (_) {
      work = (result: SyncResult.retry, settled: 0);
    }
  }
  if (work.settled > 0) await _tell(onWorkPlanSettled);

  // A pass that must retry would only fail again: WorkManager comes back.
  if (att.result == SyncResult.done && await _waiting(attendanceWaiting)) {
    att = await attendance();
    if (att.settled > 0) await _tell(afterAttendance);
  }
  return att.result == SyncResult.done && req.result == SyncResult.done && work.result == SyncResult.done;
}

/// The rows are sent; telling the widget and the screens is best effort.
Future<void> _tell(FutureOr<void> Function()? notify) async {
  if (notify == null) return;
  try {
    await notify();
  } catch (_) {}
}

/// Unreadable counts as nothing waiting: the first pass's answer stands.
Future<bool> _waiting(Future<bool> Function() probe) async {
  try {
    return await probe();
  } catch (_) {
    return false;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `flutter test test/workplan test/attendance/sync`
Expected: `All tests passed!`. That covers 18 + 25 + 4 + 2 in `test/workplan`, plus the sync suites, which now include the new `drainInOrder` test. Among the 25 repository tests are the review regressions from revisions 2 and 3:
- an accepted problem keeps the server's task, so a failed refresh never unlocks Report done;
- an outdated read keeps the server's newer task;
- **an older refresh cannot overwrite an accepted problem**, including when the background sync accepted it on its own connection;
- an accepted answer never hides a later office change;
- a list arriving after sign-out is neither saved nor shown;
- a switch while a list travels, online and offline;
- proposal choices never mix two workers, including **a switch during the awaited saves** (without writing back a wiped copy) and one landing as the save commits;
- a photo left after its problem landed stays counted, once.

- [ ] **Step 5: Whole suite and analyzer**

Run: `flutter analyze` → `No issues found!`; `flutter test` → `+652: All tests passed!` (620 + 32).

- [ ] **Step 6: Stop — no commit.** Report to the controller.

---

### Task 3: The screens

**Files:**
- Create: `lib/workplan/workplan_services.dart`; in `lib/workplan/ui/`: `workplan_widgets.dart`, `my_work_controller.dart`, `report_forms.dart`, `task_screen.dart`, `notes_screen.dart`, `proposals_screen.dart`, `my_work_screen.dart`, `my_work_card.dart`
- Test: `test/workplan/ui/my_work_screens_test.dart`

**Interfaces:**
- Consumes:
  - Tasks 1–2: everything above;
  - from the app: `TakePhoto`, `realTakePhoto` (`lib/requests/requests_services.dart`), `RequestsApi.myRequests()` / `RequestsView` / `RemoteRequest` (`.mine, .projectId, .cancelled, .title, .lines, .receivedAt`), `calendarDay` (`lib/requests/domain/request_status.dart`), `StatusPill`, `FailureNotice`, `noticeAction`, `retryLabel`, `dismissLabel`, `monoLabel`, `WmColors`, `dayMonth`, `clockTime`, `WorkDate`.
- Produces:
  - `WorkPlanServices({api, takePhoto = realTakePhoto, changed, requests})`.
  - `MyWorkController({api, now})`:
    - state: `loading`, `view`, `failure`, `today`, `api`;
    - reads: `group(WpGroup)`, `entry(taskId)`, `updates`, `refresh()`;
    - actions: `act(action)`, `acknowledge`, `startWork`, `dismissFailed`.
  - Screens:
    - `MyWorkScreen({controller, services, isLeader, onMakeRequest})`
    - `TaskScreen({controller, services, taskId, onMakeRequest})`
    - `NoteFormScreen` / `ProblemFormScreen` (return `NoteReport` / `ProblemReport` records)
    - `NotesScreen({controller})`
    - `ProposalsScreen({controller})`, `ProposeFormScreen({controller})`
    - `MyWorkCard({updates, onOpen})`
    - `plannedLabel(WpTask)`, `WpBox`, `TaskPill`
  - Keys the tests and pilot use:
    - lists: `open-notes`, `open-proposals`, `task-<id>`, `note-<meetingId>`, `proposal-<id>`;
    - task actions: `ack`, `start`, `done`, `check`, `progress`, `problem`;
    - forms: `note-field`, `note-submit`, `add-photo`, `remove-photo`, `problem-field`, `problem-request`, `problem-submit`, `make-request`, `kind-<kind>`;
    - proposals: `propose`, `propose-team`, `propose-destination`, `propose-title`, `propose-details`, `propose-send`;
    - Home: `my-work-card`.

- [ ] **Step 1: Write the failing screen tests**

Create `test/workplan/ui/my_work_screens_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/requests/data/requests_api.dart';
import 'package:workmate/requests/domain/remote_request.dart';
import 'package:workmate/requests/domain/request_status.dart';
import 'package:workmate/ui/theme.dart';
import 'package:workmate/workplan/data/workplan_api.dart';
import 'package:workmate/workplan/domain/wp_op.dart';
import 'package:workmate/workplan/domain/wp_rules.dart';
import 'package:workmate/workplan/domain/wp_task.dart';
import 'package:workmate/workplan/ui/my_work_controller.dart';
import 'package:workmate/workplan/ui/my_work_screen.dart';
import 'package:workmate/workplan/ui/proposals_screen.dart';
import 'package:workmate/workplan/ui/task_screen.dart';
import 'package:workmate/workplan/workplan_services.dart';

import '../../attendance/fakes.dart';
import '../../requests/domain/request_models_test.dart' show requestDoc;
import '../../requests/request_fakes.dart';
import '../workplan_fakes.dart';

Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: Scaffold(body: w));

WorkPlanView viewOf(List<Map<String, dynamic>> docs, {List<WpOp> pending = const [], List<WpOp> failed = const []}) => WorkPlanView(
      entries: [
        for (final d in docs)
          WpEntry(
            task: task0(d),
            pendingOps: pending.where((o) => o.taskId == d['id']).toList(),
            failedOps: failed.where((o) => o.taskId == d['id']).toList(),
          ),
      ],
      notes: [WpNote.fromJson(noteDoc())],
    );

WpOp anOp(WpOpKind kind, {String task = 't1', String? error}) => WpOp(
      opId: 'op-${kind.name}',
      workerId: 'u1',
      kind: kind,
      createdAt: DateTime.utc(2026, 10, 14),
      taskId: task,
      lastError: error,
      failedPermanently: error != null,
    );

void main() {
  late FakeWorkPlanApi api;
  late MyWorkController controller;
  late WorkPlanServices services;

  setUp(() {
    api = FakeWorkPlanApi();
    controller = MyWorkController(api: api, now: () => DateTime.utc(2026, 10, 14, 2));
    services = WorkPlanServices(api: api, takePhoto: (_) async => '/raw/shot.jpg');
  });

  Future<void> open(WidgetTester tester, Widget screen) async {
    useTallPhone(tester);
    await controller.refresh();
    await tester.pumpWidget(wrap(screen));
    await tester.pumpAndSettle();
  }

  testWidgets('My Work: sections, what needs the worker first, notes; no proposals for a worker', (tester) async {
    api.view = viewOf([
      taskDoc(id: 't1', title: 'Skim coat', ackVersion: null),
      taskDoc(id: 't2', title: 'Cabinets', ackVersion: 1, start: '2026-10-20', end: '2026-10-21'),
      taskDoc(id: 't3', title: 'Garage', ackVersion: 1, blocked: true),
    ]);
    await open(tester, MyWorkScreen(controller: controller, services: services, isLeader: false));
    expect(find.text('TODAY · 1'), findsOneWidget);
    expect(find.text('UPCOMING · 1'), findsOneWidget);
    expect(find.text('WAITING · 1'), findsOneWidget);
    expect(find.text('New'), findsOneWidget);
    expect(find.text('Meeting notes (1)'), findsOneWidget);
    expect(find.byKey(const Key('open-proposals')), findsNothing);
    await tester.tap(find.byKey(const Key('open-notes')));
    await tester.pumpAndSettle();
    expect(find.text('Skim coat first, then cabinets.'), findsOneWidget);
  });

  testWidgets('a changed task says what changed; "I\'ve read this" is the first thing to do', (tester) async {
    api.view = viewOf([
      taskDoc(version: 2, ackVersion: 1, history: [
        {'id': 5, 'kind': 'revised', 'note': 'Changed: planned dates', 'by': 'Office', 'at': '2026-10-14T01:00:00+00:00'},
      ]),
    ]);
    await open(tester, TaskScreen(controller: controller, services: services, taskId: 't1'));
    expect(find.text('Changed'), findsOneWidget);
    expect(find.text('The office changed this task. Read it again.'), findsOneWidget);
    expect(find.text('Changed: planned dates'), findsWidgets);
    expect(tester.widget<FilledButton>(find.byKey(const Key('start'))).onPressed, isNull);
    expect(find.text('Read the task first: tap "I\'ve read this".'), findsOneWidget);
    await tester.tap(find.byKey(const Key('ack')));
    await tester.pumpAndSettle();
    expect(api.calls, ['ack:t1:2']);
  });

  testWidgets('blocked: Start is locked and the problems are listed; only the office clears them', (tester) async {
    api.view = viewOf([
      taskDoc(ackVersion: 1, blocked: true, blockers: [
        {'id': 'b1', 'kind': 'materials', 'description': 'No cement', 'request_id': null, 'reported_at': '2026-10-14T03:00:00+00:00', 'reported_by': 'Danilo'},
      ], waitingFor: [
        {'task_id': 't0', 'title': 'Wall prep', 'status': 'in_progress'},
      ]),
    ]);
    await open(tester, TaskScreen(controller: controller, services: services, taskId: 't1'));
    expect(tester.widget<FilledButton>(find.byKey(const Key('start'))).onPressed, isNull);
    expect(find.textContaining('must be cleared by the office first'), findsOneWidget);
    expect(find.text('Materials: No cement'), findsOneWidget);
    expect(find.text('Earlier task: Wall prep'), findsOneWidget);
    expect(find.byKey(const Key('problem')), findsOneWidget, reason: 'problems can still be reported');
  });

  testWidgets('Start, then progress with a photo, then report done', (tester) async {
    api.view = viewOf([taskDoc(ackVersion: 1)]);
    await open(tester, TaskScreen(controller: controller, services: services, taskId: 't1'));
    await tester.tap(find.byKey(const Key('start')));
    await tester.pumpAndSettle();
    expect(api.calls, ['start:t1']);

    await tester.tap(find.byKey(const Key('progress')));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.byKey(const Key('note-submit'))).onPressed, isNull, reason: 'a note is required');
    await tester.enterText(find.byKey(const Key('note-field')), 'Half done');
    await tester.tap(find.byKey(const Key('add-photo')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('note-submit')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'progress:t1:Half done:/kept/1.jpg');

    api.view = viewOf([taskDoc(ackVersion: 1, status: 'in_progress')]);
    await controller.refresh();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('done')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('note-submit')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'done:t1:');
  });

  testWidgets('backing out of a form deletes the photo taken there', (tester) async {
    api.view = viewOf([taskDoc(ackVersion: 1, status: 'in_progress')]);
    await open(tester, TaskScreen(controller: controller, services: services, taskId: 't1'));
    await tester.tap(find.byKey(const Key('progress')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('add-photo')));
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(api.discarded, ['/kept/1.jpg']);
    expect(api.calls, isEmpty);
  });

  testWidgets('a materials problem links one of the worker\'s own requests for this project, or opens Requests', (tester) async {
    final requests = FakeRequestsApi()
      ..view = RequestsView(entries: [
        RequestEntry(state: SyncState.received, remote: RemoteRequest.fromJson(requestDoc(id: 'r1'))),
        RequestEntry(state: SyncState.received, remote: RemoteRequest.fromJson(requestDoc(id: 'r2', mine: false))),
        RequestEntry(state: SyncState.received, remote: RemoteRequest.fromJson({...requestDoc(id: 'r3'), 'project_id': 'f9'})),
      ]);
    services = WorkPlanServices(api: api, takePhoto: (_) async => null, requests: requests);
    var madeRequest = 0;
    api.view = viewOf([taskDoc(role: 'helper', ackVersion: 1)]);
    await open(tester, TaskScreen(controller: controller, services: services, taskId: 't1', onMakeRequest: () => madeRequest++));
    await tester.tap(find.byKey(const Key('problem')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('problem-field')), 'No cement');
    await tester.tap(find.byKey(const Key('problem-request')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Santos Townhouse · Main Contract'), findsWidgets);
    final options = tester.widgetList<DropdownMenuItem<String?>>(find.byType(DropdownMenuItem<String?>)).map((i) => i.value).toSet();
    expect(options, {null, 'r1'}, reason: 'not a team member\'s request, not another project\'s');
    await tester.tap(find.textContaining('1 item').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('problem-submit')));
    await tester.pumpAndSettle();
    expect(api.calls.single, 'problem:t1:materials:No cement:r1:null');

    await tester.tap(find.byKey(const Key('problem')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('make-request')));
    await tester.pumpAndSettle();
    expect(madeRequest, 1);
    expect(api.calls, hasLength(1), reason: 'nothing is reported or ordered by the shortcut');
  });

  testWidgets('a leader checks reported work; the office still approves', (tester) async {
    api.view = viewOf([taskDoc(role: 'leader', status: 'reported_done', canCheck: true)]);
    await open(tester, TaskScreen(controller: controller, services: services, taskId: 't1'));
    expect(find.text('To check'), findsOneWidget);
    expect(find.byKey(const Key('ack')), findsNothing, reason: 'a leader not on the task does not acknowledge');
    await tester.tap(find.byKey(const Key('check')));
    await tester.pumpAndSettle();
    expect(find.text('Your check is recorded. The office still gives the final approval.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('note-submit')));
    await tester.pumpAndSettle();
    expect(api.calls.single, 'check:t1:');
  });

  testWidgets('pending and refused actions are shown on the task, never as sent', (tester) async {
    api.view = viewOf([taskDoc(ackVersion: 1)],
        pending: [anOp(WpOpKind.blocker)], failed: [anOp(WpOpKind.start, error: 'notAcknowledged')]);
    await open(tester, TaskScreen(controller: controller, services: services, taskId: 't1'));
    expect(find.text('Problem report · Pending sync'), findsOneWidget);
    expect(find.text('Start work: This was not accepted.'), findsOneWidget);
    expect(find.textContaining('The office changed this task. Read the new version'), findsOneWidget);
    await tester.tap(find.text('Dismiss · Isara'));
    await tester.pumpAndSettle();
    expect(api.calls, ['dismiss:op-start']);
  });

  testWidgets('a leader proposes a task; nothing is live until the office publishes it', (tester) async {
    api.view = WorkPlanView(proposals: [
      WpProposal.fromJson(proposalDoc(id: 'p1', status: 'declined', reason: 'Already planned')),
    ]);
    await open(tester, ProposalsScreen(controller: controller));
    expect(find.text('Declined'), findsOneWidget);
    expect(find.text('Office: Already planned'), findsOneWidget);
    await tester.tap(find.byKey(const Key('propose')));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.byKey(const Key('propose-send'))).onPressed, isNull);
    await tester.tap(find.byKey(const Key('propose-destination')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Barlin Residence · Main Contract').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('propose-title')), 'Fix the gate');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('propose-send')));
    await tester.pumpAndSettle();
    expect(api.calls.single, 'propose:tm1:f1:Fix the gate:');
    expect(find.byKey(const Key('propose')), findsOneWidget, reason: 'back on the list');
  });

  testWidgets('a worker who leads no team is told, not shown an empty form', (tester) async {
    api.choicesResult = const WpChoices(teams: [], destinations: [barlin]);
    await open(tester, ProposalsScreen(controller: controller));
    await tester.tap(find.byKey(const Key('propose')));
    await tester.pumpAndSettle();
    expect(find.text('You are not leading a team right now, so you cannot propose tasks.'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `flutter test test/workplan/ui`
Expected: FAIL to compile, because `workplan/ui/...` and `workplan_services.dart` do not exist yet.

- [ ] **Step 3: Write the services, the controller and the screens**

Create `lib/workplan/workplan_services.dart`:

```dart
import 'package:flutter/foundation.dart';

import '../requests/data/requests_api.dart';
import '../requests/requests_services.dart' show TakePhoto, realTakePhoto;
import 'data/workplan_api.dart';

/// Everything the My Work screens need, built once in main.dart.
class WorkPlanServices {
  const WorkPlanServices({required this.api, this.takePhoto = realTakePhoto, this.changed, this.requests});

  final WorkPlanApi api;
  final TakePhoto takePhoto;

  /// Fires when the live app's background drain settled queued operations.
  final Listenable? changed;

  /// The worker's own requests, to link a materials problem to one (spec §8);
  /// null when Requests is unavailable.
  final RequestsApi? requests;
}
```

Create `lib/workplan/ui/workplan_widgets.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/status_pill.dart';
import '../../requests/domain/request_status.dart' show calendarDay;
import '../../ui/theme.dart';
import '../domain/wp_rules.dart';
import '../domain/wp_task.dart';
import 'workplan_copy.dart';

/// "Wed 14 Oct – Fri 16 Oct", "From Wed 14 Oct", "Until Fri 16 Oct", or
/// "No date yet". Calendar dates, read as they are.
String plannedLabel(WpTask t) {
  final s = t.plannedStart, e = t.plannedEnd;
  if (s != null && e != null) return s == e ? calendarDay(s) : '${calendarDay(s)} – ${calendarDay(e)}';
  if (s != null) return 'From ${calendarDay(s)}';
  if (e != null) return 'Until ${calendarDay(e)}';
  return 'No date yet';
}

/// A white card, the app's one card shape.
class WpBox extends StatelessWidget {
  const WpBox({super.key, required this.children, this.color = Colors.white, this.border = WmColors.border});

  final List<Widget> children;
  final Color color;
  final Color border;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(16), border: Border.all(color: border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
      );
}

/// The task's state as the worker should read it now — what needs them
/// first, then what is still on the phone, then the server's state.
class TaskPill extends StatelessWidget {
  const TaskPill(this.entry, {super.key});
  final WpEntry entry;

  static const _greyFg = Color(0xFF5F5F5B);

  @override
  Widget build(BuildContext context) {
    final e = entry;
    if (e.failedOps.isNotEmpty) return const StatusPill('Not accepted', background: WmColors.dangerTint, foreground: WmColors.danger);
    if (e.toRead) {
      return StatusPill(e.task.changedSinceRead ? 'Changed' : 'New', background: WmColors.dangerTint, foreground: WmColors.danger);
    }
    if (e.toCheck) return const StatusPill('To check', background: WmColors.dangerTint, foreground: WmColors.danger);
    if (e.pendingOps.isNotEmpty) return const StatusPill.brown('Pending sync');
    if (e.blocked) return const StatusPill.brown('Waiting');
    final status = e.effectiveStatus;
    return switch (status) {
      WpStatus.completed => StatusPill.green(statusLabel(status)),
      WpStatus.notStarted => StatusPill(statusLabel(status), background: WmColors.inert, foreground: _greyFg),
      _ => StatusPill.green(statusLabel(status, sentBack: e.task.sentBack)),
    };
  }
}
```

Create `lib/workplan/ui/my_work_controller.dart`:

```dart
import 'package:flutter/foundation.dart';

import '../../attendance/domain/work_date.dart';
import '../data/workplan_api.dart';
import '../domain/wp_failure.dart';
import '../domain/wp_op.dart';
import '../domain/wp_rules.dart';
import '../domain/wp_task.dart';

/// The My Work tab, its task screens and Home's card share this one
/// controller, so all of them always tell the same story.
class MyWorkController extends ChangeNotifier {
  MyWorkController({required WorkPlanApi api, DateTime Function()? now})
      : _api = api,
        now = now ?? DateTime.now;

  final WorkPlanApi _api;
  final DateTime Function() now;

  bool _loading = true;
  bool _disposed = false;
  WorkPlanView _view = const WorkPlanView();
  WpFailure? _failure;
  Future<void>? _inFlight;
  bool _again = false;

  WorkPlanApi get api => _api;
  bool get loading => _loading;
  WorkPlanView get view => _view;

  /// Why the server could not be read; the list may still show the phone's copy.
  WpFailure? get failure => _failure;

  /// Manila's calendar date: "today" on a site is never the phone's UTC day.
  String get today => WorkDate.of(now()).iso;

  /// The tasks of one section, the most pressing first: to read / to check,
  /// then by planned start (undated last), then title.
  List<WpEntry> group(WpGroup g) {
    final rows = _view.entries.where((e) => groupOf(e, today) == g).toList();
    int rank(WpEntry e) => (e.toRead || e.toCheck) ? 0 : 1;
    rows.sort((a, b) {
      final r = rank(a).compareTo(rank(b));
      if (r != 0) return r;
      final sa = a.task.plannedStart ?? '9999', sb = b.task.plannedStart ?? '9999';
      final s = sa.compareTo(sb);
      return s != 0 ? s : a.task.title.compareTo(b.task.title);
    });
    return rows;
  }

  WpEntry? entry(String taskId) => _view.entry(taskId);

  WpUpdates get updates => summarizeWork(
        _view.entries,
        notes: _view.notes.length,
        otherPending: visiblePending(_view.otherPending).length + _view.pendingProposals.length,
        otherFailed: visibleFailures(_view.otherFailed).length,
      );

  /// Concurrent calls share one read — and a call made DURING a read runs it
  /// once more afterwards, so an action just taken is never shown from a
  /// read that started before it.
  Future<void> refresh() {
    final running = _inFlight;
    if (running != null) {
      _again = true;
      return running;
    }
    return _inFlight = _loop().whenComplete(() => _inFlight = null);
  }

  Future<void> _loop() async {
    do {
      _again = false;
      await _load();
    } while (_again);
  }

  Future<void> _load() async {
    try {
      final view = await _api.load();
      _view = view;
      _failure = view.error == null ? null : WpFailure.of(view.error!);
    } catch (e) {
      _failure = WpFailure.of(e);
    } finally {
      _loading = false;
      _notify();
    }
  }

  /// Runs an action (queued on the phone first) and re-reads.
  Future<void> act(Future<void> Function(WorkPlanApi api) action) async {
    await action(_api);
    await refresh();
  }

  Future<void> acknowledge(WpTask t) => act((a) => a.acknowledge(t));
  Future<void> startWork(WpTask t) => act((a) => a.startWork(t));
  Future<void> dismissFailed(WpOp op) => act((a) => a.dismissFailed(op));

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

Create `lib/workplan/ui/report_forms.dart`:

```dart
import 'dart:io';

import 'package:flutter/material.dart';

import '../../attendance/ui/formats.dart';
import '../../requests/data/requests_api.dart';
import '../../requests/domain/remote_request.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/workplan_api.dart';
import '../domain/wp_task.dart';
import '../workplan_services.dart';
import 'workplan_copy.dart';

/// What a note form returns: the text, and a kept photo path or null.
typedef NoteReport = ({String note, String? photo});

/// What the problem form returns.
typedef ProblemReport = ({String kind, String description, String? requestId, String? photo});

/// Takes one photo and files it in app-private storage; null when the worker
/// backed out. A capture that cannot be filed says so.
Future<String?> _takePhoto(BuildContext context, WorkPlanServices services, void Function(bool) onFailure) async {
  final raw = await services.takePhoto(context);
  if (raw == null) return null;
  try {
    final kept = await services.api.keepPhoto(raw);
    onFailure(false);
    return kept;
  } catch (_) {
    onFailure(true);
    return null;
  } finally {
    try {
      File(raw).deleteSync();
    } catch (_) {}
  }
}

/// The photo row of a form: Add photo, or the photo with Remove.
class _PhotoRow extends StatelessWidget {
  const _PhotoRow({required this.photo, required this.onAdd, required this.onRemove, required this.failed});

  final String? photo;
  final VoidCallback onAdd;
  final VoidCallback onRemove;
  final bool failed;

  @override
  Widget build(BuildContext context) {
    final p = photo;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (p == null)
        OutlinedButton.icon(key: const Key('add-photo'), onPressed: onAdd, icon: const Icon(Icons.photo_camera_outlined), label: const Text('Add a photo (optional)'))
      else
        Row(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.file(File(p), width: 72, height: 72, fit: BoxFit.cover, errorBuilder: (_, _, _) => Container(width: 72, height: 72, color: WmColors.inert)),
          ),
          const SizedBox(width: 12),
          TextButton(key: const Key('remove-photo'), onPressed: onRemove, child: const Text('Remove photo')),
        ]),
      if (failed) ...[
        const SizedBox(height: 8),
        FailureNotice(english: photoNotKeptCopy.english, tagalog: photoNotKeptCopy.tagalog),
      ],
    ]);
  }
}

/// A short note (progress, report done, a leader's check), with an optional
/// photo where 0093 accepts one. Returns null when the worker backed out —
/// and then any photo taken here is deleted.
class NoteFormScreen extends StatefulWidget {
  const NoteFormScreen({
    super.key,
    required this.services,
    required this.title,
    required this.label,
    required this.submitLabel,
    this.required = false,
    this.allowPhoto = false,
    this.explain,
  });

  final WorkPlanServices services;
  final String title;
  final String label;
  final String submitLabel;
  final bool required;
  final bool allowPhoto;
  final String? explain;

  @override
  State<NoteFormScreen> createState() => _NoteFormScreenState();
}

class _NoteFormScreenState extends State<NoteFormScreen> {
  final _text = TextEditingController();
  String? _photo;
  bool _photoFailed = false;
  bool _done = false;

  @override
  void dispose() {
    _text.dispose();
    // Backed out: the photo is not owed to anyone.
    final p = _photo;
    if (!_done && p != null) widget.services.api.discardPhoto(p);
    super.dispose();
  }

  Future<void> _addPhoto() async {
    final kept = await _takePhoto(context, widget.services, (f) => _photoFailed = f);
    if (!mounted) {
      if (kept != null) await widget.services.api.discardPhoto(kept);
      return;
    }
    setState(() => _photo = kept ?? _photo);
  }

  void _removePhoto() {
    final p = _photo;
    if (p != null) widget.services.api.discardPhoto(p);
    setState(() => _photo = null);
  }

  @override
  Widget build(BuildContext context) {
    final ok = !widget.required || _text.text.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
          if (widget.explain != null) ...[Text(widget.explain!, style: const TextStyle(color: WmColors.textMuted)), const SizedBox(height: 12)],
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
          const SizedBox(height: 20),
          FilledButton(
            key: const Key('note-submit'),
            onPressed: ok
                ? () {
                    _done = true;
                    Navigator.of(context).pop<NoteReport>((note: _text.text.trim(), photo: _photo));
                  }
                : null,
            child: Text(widget.submitLabel),
          ),
          const SizedBox(height: 8),
          const Text(savedOnPhoneText, style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
        ]),
      ),
    );
  }
}

/// Report a problem (spec §8): what kind, what is wrong, an optional photo,
/// and — for missing materials or a tool — an optional link to one of the
/// worker's own requests for this project. It never creates a purchase.
class ProblemFormScreen extends StatefulWidget {
  const ProblemFormScreen({super.key, required this.services, required this.task, this.onMakeRequest});

  final WorkPlanServices services;
  final WpTask task;

  /// Opens Requests; null hides the shortcut.
  final VoidCallback? onMakeRequest;

  @override
  State<ProblemFormScreen> createState() => _ProblemFormScreenState();
}

class _ProblemFormScreenState extends State<ProblemFormScreen> {
  final _text = TextEditingController();
  String _kind = wpProblemKinds.first;
  String? _requestId;
  String? _photo;
  bool _photoFailed = false;
  bool _done = false;
  late final Future<List<RemoteRequest>> _requests = _loadRequests();

  /// The worker's open requests for this task's project (0093 accepts only those).
  Future<List<RemoteRequest>> _loadRequests() async {
    final api = widget.services.requests;
    if (api == null) return const [];
    try {
      final RequestsView view = await api.myRequests();
      return [
        for (final r in [for (final e in view.entries) ?e.remote])
          if (r.mine && r.projectId == widget.task.projectId && !r.cancelled) r,
      ];
    } catch (_) {
      return const [];
    }
  }

  @override
  void dispose() {
    _text.dispose();
    final p = _photo;
    if (!_done && p != null) widget.services.api.discardPhoto(p);
    super.dispose();
  }

  Future<void> _addPhoto() async {
    final kept = await _takePhoto(context, widget.services, (f) => _photoFailed = f);
    if (!mounted) {
      if (kept != null) await widget.services.api.discardPhoto(kept);
      return;
    }
    setState(() => _photo = kept ?? _photo);
  }

  void _removePhoto() {
    final p = _photo;
    if (p != null) widget.services.api.discardPhoto(p);
    setState(() => _photo = null);
  }

  @override
  Widget build(BuildContext context) {
    final linkable = _kind == 'materials' || _kind == 'tool';
    final ok = _text.text.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: const Text('Report a problem')),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
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
                        Navigator.of(context).pop();
                        widget.onMakeRequest!();
                      },
                      icon: const Icon(Icons.add_shopping_cart),
                      label: const Text('Make a request instead (nothing is sent yet)'),
                    ),
                ]);
              },
            ),
          ],
          const SizedBox(height: 20),
          FilledButton(
            key: const Key('problem-submit'),
            onPressed: ok
                ? () {
                    _done = true;
                    Navigator.of(context).pop<ProblemReport>(
                        (kind: _kind, description: _text.text.trim(), requestId: linkable ? _requestId : null, photo: _photo));
                  }
                : null,
            child: const Text('Report the problem'),
          ),
          const SizedBox(height: 8),
          const Text(savedOnPhoneText, style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
        ]),
      ),
    );
  }
}
```

Create `lib/workplan/ui/task_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/workplan_api.dart';
import '../domain/wp_op.dart';
import '../domain/wp_rules.dart';
import '../domain/wp_task.dart';
import '../workplan_services.dart';
import 'my_work_controller.dart';
import 'report_forms.dart';
import 'workplan_copy.dart';
import 'workplan_widgets.dart';

/// One task (spec §12): the instructions, what changed, "I've read this",
/// and what this worker may do now — start, report progress, report a
/// problem, report done, or (a leader) check the work. Reads its entry from
/// the shared controller by [taskId], so it follows every refresh.
class TaskScreen extends StatelessWidget {
  const TaskScreen({super.key, required this.controller, required this.services, required this.taskId, this.onMakeRequest});

  final MyWorkController controller;
  final WorkPlanServices services;
  final String taskId;
  final VoidCallback? onMakeRequest;

  WorkPlanApi get _api => services.api;

  Future<void> _progress(BuildContext context, WpTask t) async {
    final r = await Navigator.of(context).push<NoteReport>(MaterialPageRoute(
      builder: (_) => NoteFormScreen(
        services: services,
        title: 'Report progress',
        label: 'What was done today?',
        submitLabel: 'Send progress',
        required: true,
        allowPhoto: true,
      ),
    ));
    if (r == null) return;
    await controller.act((a) => a.reportProgress(t, r.note, photo: r.photo));
  }

  Future<void> _problem(BuildContext context, WpTask t) async {
    final r = await Navigator.of(context).push<ProblemReport>(MaterialPageRoute(
      builder: (_) => ProblemFormScreen(services: services, task: t, onMakeRequest: onMakeRequest),
    ));
    if (r == null) return;
    await controller.act((a) => a.reportProblem(t, kind: r.kind, description: r.description, requestId: r.requestId, photo: r.photo));
  }

  Future<void> _done(BuildContext context, WpTask t) async {
    final r = await Navigator.of(context).push<NoteReport>(MaterialPageRoute(
      builder: (_) => NoteFormScreen(
        services: services,
        title: 'Report done',
        label: 'Anything the office should know? (optional)',
        submitLabel: 'Report done',
        explain: 'The office checks the work before it counts as completed.',
      ),
    ));
    if (r == null) return;
    await controller.act((a) => a.reportDone(t, r.note));
  }

  Future<void> _check(BuildContext context, WpTask t) async {
    final r = await Navigator.of(context).push<NoteReport>(MaterialPageRoute(
      builder: (_) => NoteFormScreen(
        services: services,
        title: 'Check this work',
        label: 'Your note for the office (optional)',
        submitLabel: 'Mark as checked',
        explain: 'Your check is recorded. The office still gives the final approval.',
      ),
    ));
    if (r == null) return;
    await controller.act((a) => a.checkWork(t, r.note));
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final e = controller.entry(taskId);
          return Scaffold(
            appBar: AppBar(title: const Text('Task')),
            body: SafeArea(
              child: e == null
                  ? const Center(child: Padding(padding: EdgeInsets.all(24), child: Text('This task is no longer on your list.')))
                  : RefreshIndicator(
                      onRefresh: controller.refresh,
                      child: ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                        children: _body(context, e),
                      ),
                    ),
            ),
          );
        },
      );

  List<Widget> _body(BuildContext context, WpEntry e) {
    final t = e.task;
    final a = actionsFor(e);
    final change = t.latestChange;
    return [
      Row(children: [
        Expanded(child: Text(t.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
        TaskPill(e),
      ]),
      const SizedBox(height: 4),
      Text(t.where, style: const TextStyle(color: WmColors.textMuted)),
      Text(
        [plannedLabel(t), roleLabel(t.myRole), if (t.teamName != null) 'Team ${t.teamName}', 'Version ${t.version}'].join(' · '),
        style: const TextStyle(color: WmColors.textMuted, fontSize: 13),
      ),
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
            actions: [noticeAction(dismissLabel, () => controller.dismissFailed(op))],
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
      if (a.acknowledge) ...[
        FilledButton.icon(
          key: const Key('ack'),
          onPressed: () => controller.acknowledge(t),
          icon: const Icon(Icons.done_all),
          label: const Text("I'VE READ THIS"),
        ),
        const SizedBox(height: 12),
      ],
      ..._actions(context, e, a),
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
          Wrap(spacing: 8, runSpacing: 8, children: [for (final p in t.photos) _TaskPhoto(key: ValueKey(p.path), api: _api, path: p.path)]),
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

  List<Widget> _actions(BuildContext context, WpEntry e, WpActions a) {
    final t = e.task;
    Widget lock(WpLock l) => Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 8),
          child: Text(lockText(l), style: const TextStyle(color: WmColors.brown, fontSize: 13)),
        );
    return [
      if (a.start) ...[
        FilledButton(
          key: const Key('start'),
          onPressed: a.startLock == null && !e.pending(WpOpKind.start) ? () => controller.startWork(t) : null,
          child: const Text('START WORK'),
        ),
        if (a.startLock != null) lock(a.startLock!) else const SizedBox(height: 8),
      ],
      if (a.done) ...[
        FilledButton(
          key: const Key('done'),
          onPressed: a.doneLock == null ? () => _done(context, t) : null,
          child: const Text('REPORT DONE'),
        ),
        if (a.doneLock != null) lock(a.doneLock!) else const SizedBox(height: 8),
      ],
      if (a.check) ...[
        FilledButton(key: const Key('check'), onPressed: () => _check(context, t), child: const Text('CHECK THIS WORK')),
        const SizedBox(height: 8),
      ],
      Wrap(spacing: 8, runSpacing: 8, children: [
        if (a.progress)
          OutlinedButton.icon(
            key: const Key('progress'),
            onPressed: () => _progress(context, t),
            icon: const Icon(Icons.edit_note),
            label: const Text('Report progress'),
          ),
        if (a.problem)
          OutlinedButton.icon(
            key: const Key('problem'),
            onPressed: () => _problem(context, t),
            style: OutlinedButton.styleFrom(foregroundColor: WmColors.danger),
            icon: const Icon(Icons.report_outlined),
            label: const Text('Report a problem'),
          ),
      ]),
      const SizedBox(height: 12),
    ];
  }
}

/// A history line in plain words. The office's note follows when there is one.
String _eventText(WpEvent h) {
  final what = switch (h.kind) {
    'drafted' => 'Created by the office',
    'published' => 'Sent to the team',
    'revised' => 'Changed by the office',
    'edited' => 'Corrected by the office',
    'started' => 'Work started',
    'progress' => 'Progress',
    'blocker_reported' => 'Problem reported',
    'blocker_cleared' => 'Problem cleared by the office',
    'reported_done' => 'Reported done',
    'leader_checked' => 'Checked by the leader',
    'approved' => 'Approved by the office',
    'sent_back' => 'Sent back by the office',
    'reopened' => 'Reopened by the office',
    'photo_attached' => 'Photo added',
    _ => h.kind.replaceAll('_', ' '),
  };
  return h.note.isEmpty ? what : '$what — ${h.note}';
}

/// A private photo through a short-lived link; a grey box when it cannot load.
/// The link is asked for once per photo, not on every rebuild.
class _TaskPhoto extends StatefulWidget {
  const _TaskPhoto({super.key, required this.api, required this.path});
  final WorkPlanApi api;
  final String path;

  @override
  State<_TaskPhoto> createState() => _TaskPhotoState();
}

class _TaskPhotoState extends State<_TaskPhoto> {
  late Future<String?> _url = widget.api.photoUrl(widget.path);

  @override
  void didUpdateWidget(_TaskPhoto old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path) _url = widget.api.photoUrl(widget.path);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<String?>(
        future: _url,
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
```

Create `lib/workplan/ui/notes_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/formats.dart';
import '../../requests/domain/request_status.dart' show calendarDay;
import '../../ui/theme.dart';
import 'my_work_controller.dart';
import 'workplan_widgets.dart';

/// Shared meeting notes (spec §6): the latest published version of each
/// meeting this worker was chosen to receive. Read-only; reading another
/// team's plan gives no access to their tasks.
class NotesScreen extends StatelessWidget {
  const NotesScreen({super.key, required this.controller});

  final MyWorkController controller;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Meeting notes')),
        body: SafeArea(
          child: ListenableBuilder(
            listenable: controller,
            builder: (context, _) {
              final notes = controller.view.notes;
              return RefreshIndicator(
                onRefresh: controller.refresh,
                child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: [
                  if (notes.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 32),
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
                ]),
              );
            },
          ),
        ),
      );
}
```

Create `lib/workplan/ui/proposals_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../attendance/ui/status_pill.dart';
import '../../requests/domain/request_models.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/workplan_api.dart';
import '../domain/wp_failure.dart';
import '../domain/wp_task.dart';
import 'my_work_controller.dart';
import 'workplan_copy.dart';
import 'workplan_widgets.dart';

/// A team leader's own proposals (spec §15, decided 13 October 2026): Sent
/// (still an office draft), Published, or Declined with the office's reason.
/// A proposal is never live by itself: the office edits, publishes or declines it.
class ProposalsScreen extends StatelessWidget {
  const ProposalsScreen({super.key, required this.controller});

  final MyWorkController controller;

  Future<void> _propose(BuildContext context) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProposeFormScreen(controller: controller)));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('My proposals')),
        body: SafeArea(
          child: ListenableBuilder(
            listenable: controller,
            builder: (context, _) {
              final view = controller.view;
              return RefreshIndicator(
                onRefresh: controller.refresh,
                child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: [
                  FilledButton.icon(
                    key: const Key('propose'),
                    onPressed: () => _propose(context),
                    icon: const Icon(Icons.add),
                    label: const Text('Propose a task'),
                  ),
                  const SizedBox(height: 8),
                  const Text('The office reviews each proposal. Nothing reaches the team until the office publishes it.',
                      style: TextStyle(color: WmColors.textMuted)),
                  const SizedBox(height: 12),
                  for (final op in view.pendingProposals)
                    WpBox(children: [
                      Row(children: [
                        Expanded(child: Text((op.body['title'] as String?) ?? '', style: const TextStyle(fontWeight: FontWeight.w800))),
                        const StatusPill.brown('Pending sync'),
                      ]),
                      Text('${op.body['where'] ?? ''} · Team ${op.body['team_name'] ?? ''}', style: const TextStyle(color: WmColors.textMuted, fontSize: 13)),
                    ]),
                  if (view.proposals.isEmpty && view.pendingProposals.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 24),
                      child: Text('No proposals in the last 90 days.', textAlign: TextAlign.center, style: TextStyle(color: WmColors.textMuted)),
                    ),
                  for (final p in view.proposals)
                    WpBox(key: Key('proposal-${p.id}'), children: [
                      Row(children: [
                        Expanded(child: Text(p.title, style: const TextStyle(fontWeight: FontWeight.w800))),
                        _StatePill(p.state),
                      ]),
                      Text('${p.where} · sent ${dayMonth(p.proposedAt)}', style: const TextStyle(color: WmColors.textMuted, fontSize: 13)),
                      if (p.reason != null && p.reason!.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text('Office: ${p.reason}', style: const TextStyle(color: WmColors.danger, fontWeight: FontWeight.w700)),
                      ],
                      if (p.state == WpProposalState.published)
                        const Text('If you are on it, it is in My Work.', style: TextStyle(color: WmColors.green, fontSize: 13)),
                    ]),
                ]),
              );
            },
          ),
        ),
      );
}

class _StatePill extends StatelessWidget {
  const _StatePill(this.state);
  final WpProposalState state;

  @override
  Widget build(BuildContext context) => switch (state) {
        WpProposalState.published => StatusPill.green(proposalStateLabel(state)),
        WpProposalState.sent => StatusPill.brown(proposalStateLabel(state)),
        WpProposalState.declined || WpProposalState.cancelled =>
          StatusPill(proposalStateLabel(state), background: WmColors.dangerTint, foreground: WmColors.danger),
      };
}

/// Propose a task for a team this leader currently leads, on an open project.
class ProposeFormScreen extends StatefulWidget {
  const ProposeFormScreen({super.key, required this.controller});

  final MyWorkController controller;

  @override
  State<ProposeFormScreen> createState() => _ProposeFormScreenState();
}

class _ProposeFormScreenState extends State<ProposeFormScreen> {
  final _title = TextEditingController();
  final _details = TextEditingController();
  late Future<WpChoices> _choices = widget.controller.api.choices();
  MyTeam? _team;
  Destination? _destination;
  bool _sending = false;

  @override
  void dispose() {
    _title.dispose();
    _details.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final team = _team, destination = _destination;
    if (team == null || destination == null || _title.text.trim().isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.controller.act((a) => a.propose(team: team, destination: destination, title: _title.text, details: _details.text));
      if (mounted) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Propose a task')),
        body: SafeArea(
          child: FutureBuilder<WpChoices>(
            future: _choices,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
              final choices = snap.data;
              if (choices == null) {
                final copy = wpFailureCopy(WpFailure.of(snap.error ?? StateError('no choices')));
                return Padding(
                  padding: const EdgeInsets.all(20),
                  child: FailureNotice(
                    english: copy.english,
                    tagalog: copy.tagalog,
                    actions: [noticeAction(retryLabel, () => setState(() => _choices = widget.controller.api.choices()))],
                  ),
                );
              }
              if (choices.teams.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.all(20),
                  child: Text('You are not leading a team right now, so you cannot propose tasks.', style: TextStyle(color: WmColors.textMuted)),
                );
              }
              _team ??= choices.teams.length == 1 ? choices.teams.single : null;
              final ok = _team != null && _destination != null && _title.text.trim().isNotEmpty && !_sending;
              return ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
                DropdownButtonFormField<MyTeam>(
                  key: const Key('propose-team'),
                  initialValue: _team,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Team'),
                  items: [for (final t in choices.teams) DropdownMenuItem(value: t, child: Text(t.name))],
                  onChanged: (t) => setState(() => _team = t),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<Destination>(
                  key: const Key('propose-destination'),
                  initialValue: _destination,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Project and work'),
                  items: [
                    for (final d in choices.destinations) DropdownMenuItem(value: d, child: Text(d.label, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (d) => setState(() => _destination = d),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('propose-title'),
                  controller: _title,
                  maxLength: 200,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(labelText: 'Task title'),
                ),
                TextField(
                  key: const Key('propose-details'),
                  controller: _details,
                  minLines: 3,
                  maxLines: 8,
                  maxLength: 2000,
                  decoration: const InputDecoration(labelText: 'Details (optional)'),
                ),
                const SizedBox(height: 12),
                FilledButton(key: const Key('propose-send'), onPressed: ok ? _send : null, child: const Text('Send to the office')),
                if (choices.fromCache) ...[
                  const SizedBox(height: 8),
                  const Text('No signal: these lists are the ones this phone saved.', style: TextStyle(fontSize: 12.5, color: WmColors.brown)),
                ],
                const SizedBox(height: 8),
                const Text(savedOnPhoneText, style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
              ]);
            },
          ),
        ),
      );
}
```

Create `lib/workplan/ui/my_work_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart';
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../domain/wp_rules.dart';
import '../workplan_services.dart';
import 'my_work_controller.dart';
import 'notes_screen.dart';
import 'proposals_screen.dart';
import 'task_screen.dart';
import 'workplan_copy.dart';
import 'workplan_widgets.dart';

/// The My Work tab (spec §12): the worker's tasks by Today / Upcoming /
/// Waiting, what needs them highlighted, shared meeting notes, and — for a
/// team leader — their own proposals.
class MyWorkScreen extends StatelessWidget {
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

  Future<void> _open(BuildContext context, String taskId) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => TaskScreen(controller: controller, services: services, taskId: taskId, onMakeRequest: onMakeRequest),
    ));
    await controller.refresh();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final c = controller;
          final view = c.view;
          final failure = c.failure;
          final updates = c.updates;
          final sections = [
            for (final g in WpGroup.values)
              if (c.group(g) case final rows when rows.isNotEmpty) (g, rows),
          ];
          return RefreshIndicator(
            onRefresh: c.refresh,
            child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
              const Text('My Work', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              const Text('Your tasks from the office. Read each one, then report as you work.', style: TextStyle(color: WmColors.textMuted)),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                OutlinedButton.icon(
                  key: const Key('open-notes'),
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => NotesScreen(controller: c))),
                  icon: const Icon(Icons.forum_outlined),
                  label: Text('Meeting notes (${view.notes.length})'),
                ),
                if (isLeader)
                  OutlinedButton.icon(
                    key: const Key('open-proposals'),
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProposalsScreen(controller: c))),
                    icon: const Icon(Icons.lightbulb_outline),
                    label: const Text('My proposals'),
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
              for (final (g, rows) in sections) ...[
                Padding(
                  padding: const EdgeInsets.only(top: 8, bottom: 8),
                  child: Text('${groupLabel(g).toUpperCase()} · ${rows.length}', style: monoLabel),
                ),
                for (final e in rows) _TaskCard(key: Key('task-${e.task.id}'), entry: e, today: c.today, onTap: () => _open(context, e.task.id)),
              ],
            ]),
          );
        },
      );
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({super.key, required this.entry, required this.today, required this.onTap});

  final WpEntry entry;
  final String today;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = entry.task;
    final late = isLate(entry, today);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: (entry.toRead || entry.toCheck) ? WmColors.danger : WmColors.border),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(t.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              TaskPill(entry),
            ]),
            const SizedBox(height: 4),
            Text(t.where, style: const TextStyle(color: WmColors.textMuted, fontSize: 13)),
            const SizedBox(height: 4),
            Text(
              '${plannedLabel(t)} · ${roleLabel(t.myRole)}${late ? ' · Late' : ''}',
              style: TextStyle(fontSize: 13, color: late ? WmColors.danger : WmColors.textSecondary, fontWeight: late ? FontWeight.w700 : FontWeight.w400),
            ),
          ]),
        ),
      ),
    );
  }
}
```

Create `lib/workplan/ui/my_work_card.dart`:

```dart
import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../domain/wp_rules.dart';

/// Home's My Work card (spec §15: no phone push in 1c — the app shows what
/// is new when it opens). Nothing to say → nothing shown.
class MyWorkCard extends StatelessWidget {
  const MyWorkCard({super.key, required this.updates, required this.onOpen});

  final WpUpdates updates;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final u = updates;
    if (u.isEmpty) return const SizedBox.shrink();
    final lines = <(IconData, String, Color)>[
      if (u.toRead > 0) (Icons.fiber_new_outlined, '${u.toRead} task${u.toRead == 1 ? '' : 's'} to read', WmColors.danger),
      if (u.toCheck > 0) (Icons.fact_check_outlined, '${u.toCheck} to check', WmColors.danger),
      if (u.failed > 0) (Icons.report_outlined, '${u.failed} not accepted', WmColors.danger),
      if (u.pending > 0) (Icons.cloud_off, '${u.pending} waiting for signal', WmColors.brown),
    ];
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: InkWell(
        key: const Key('my-work-card'),
        onTap: onOpen,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: WmColors.border)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [
              Expanded(child: Text('My Work', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
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
      ),
    );
  }
}
```

- [ ] **Step 4: Run the screen tests**

Run: `flutter test test/workplan/ui`
Expected: `+10: All tests passed!`

- [ ] **Step 5: Whole suite and analyzer**

Run: `flutter analyze` → `No issues found!`; `flutter test` → `+662: All tests passed!` (652 + 10).

- [ ] **Step 6: Stop — no commit.** Report to the controller.

---

### Task 4: The My Work tab, wiring and version 0.6.0

**Files:**
- Modify: `lib/ui/home_shell.dart` (whole file given), `lib/app.dart`, `lib/main.dart`, `pubspec.yaml`, `test/ui/screens_test.dart`

**Interfaces:**
- Consumes: `WorkPlanServices`, `MyWorkController`, `MyWorkScreen`, `MyWorkCard` (Task 3); `WorkPlanRepository`, `WorkPlanAccountWipe`, `openDeviceWorkPlanDb`, `SupabaseWorkPlanRemote` (Task 2); `FakeWorkPlanApi`, `viewWithUnread` (Task 2 test fakes).
- Produces:
  - `HomeShell(..., workPlan: WorkPlanServices?)`: the My Work tab (between Home and Requests) with the `my-work-badge` number, the Home card above the Requests card, and Requests opening from a problem's shortcut.
  - `WorkMateApp(..., workPlan:)`.
  - `main.dart` builds My Work, optional like Requests: if its database cannot open, the app starts without the tab.
  - Version `0.6.0+1006`.

- [ ] **Step 1: Write the failing shell test**

In `test/ui/screens_test.dart`:

**Edit 1.** Find:

```dart
import 'package:workmate/widget/start_flow.dart';
```

Replace with:

```dart
import 'package:workmate/widget/start_flow.dart';
import 'package:workmate/workplan/workplan_services.dart';
```

**Edit 2.** Find:

```dart
import '../requests/request_fakes.dart';
```

Replace with:

```dart
import '../requests/request_fakes.dart';
import '../workplan/workplan_fakes.dart';
```

**Edit 3.** Find:

```dart
    expect(find.text('My attendance'), findsOneWidget);
  });
}
```

Replace with:

```dart
    expect(find.text('My attendance'), findsOneWidget);
  });

  testWidgets('with My Work: a My Work tab with a number, and the Home card opens it', (tester) async {
    useTallPhone(tester);
    final work = FakeWorkPlanApi()..view = viewWithUnread();
    await tester.pumpWidget(wrap(HomeShell(
      worker: const WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42),
      versionName: '0.6.0',
      onSignOut: () async {},
      services: fakeServices(),
      account: AccountServices(changePassword: (_) async {}, termsAcceptedAt: () async => null),
      requests: RequestsServices(api: FakeRequestsApi(), takePhoto: (_) async => null),
      workPlan: WorkPlanServices(api: work, takePhoto: (_) async => null),
    )));
    await tester.pumpAndSettle();
    expect(find.text('My Work'), findsWidgets);
    expect(find.text('1 task to read'), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('my-work-badge')), matching: find.text('1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('my-work-card')));
    await tester.pumpAndSettle();
    expect(find.text('TODAY · 1'), findsOneWidget);
    // Requests still has its own tab.
    await tester.tap(find.text('Requests').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('new-request')), findsOneWidget);
  });
}
```


- [ ] **Step 2: Run it to see it fail**

Run: `flutter test test/ui/screens_test.dart`
Expected: FAIL to compile, because `HomeShell` has no `workPlan` parameter yet.

- [ ] **Step 3: The tab, the card and the wiring**

Replace the whole of `lib/ui/home_shell.dart` with the following. It is the existing file plus:
- the `_Tab.work` tab and the `_work` controller;
- `_changeSources`, so each "settled" source is listened to once;
- the My Work card on Home;
- `_openRequests` for the problem shortcut;
- the `_WorkIcon` badge.

```dart
import 'package:flutter/material.dart';

import '../app_controller.dart';
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
import '../profile/account_services.dart';
import '../profile/profile_screen.dart';
import '../requests/home/request_updates_card.dart';
import '../requests/list/requests_controller.dart';
import '../requests/list/requests_screen.dart';
import '../requests/requests_services.dart';
import '../widget/start_flow.dart';
import '../workplan/ui/my_work_card.dart';
import '../workplan/ui/my_work_controller.dart';
import '../workplan/ui/my_work_screen.dart';
import '../workplan/workplan_services.dart';

enum _Tab { home, work, requests, history, profile }

/// The signed-in app: Home, My Work (Stage 1c), Requests (Stage 1a), History
/// and Profile, and the
/// four-step Time In / Time Out flow launched from Home. The flow is MODAL (no
/// tabs while recording).
class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.worker,
    required this.versionName,
    required this.onSignOut,
    required this.services,
    required this.account,
    this.startRequests,
    this.requests,
    this.workPlan,
  });

  final WorkerProfile worker;
  final String versionName;
  final Future<void> Function() onSignOut;
  final AttendanceServices services;
  final AccountServices account;

  /// Widget taps waiting for Home to decide them.
  final StartFlowInbox? startRequests;

  /// The Requests tab's services; null shows no Requests tab.
  final RequestsServices? requests;

  /// The My Work tab's services; null shows no My Work tab.
  final WorkPlanServices? workPlan;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  _Tab _tab = _Tab.home;
  TimeFlowController? _flow;
  Bilingual? _exitNotice;
  late final HomeController _home;
  late final HistoryController _history;
  RequestsController? _requests;
  MyWorkController? _work;

  List<_Tab> get _tabs => [
        _Tab.home,
        if (widget.workPlan != null) _Tab.work,
        if (widget.requests != null) _Tab.requests,
        _Tab.history,
        _Tab.profile,
      ];

  @override
  void initState() {
    super.initState();
    final s = widget.services;
    _home = HomeController(attendance: s.attendance, scheduler: s.scheduler, rewards: s.rewards);
    _history = HistoryController(attendance: s.attendance);
    final r = widget.requests;
    if (r != null) _requests = RequestsController(api: r.api)..refresh();
    final w = widget.workPlan;
    if (w != null) _work = MyWorkController(api: w.api)..refresh();
    WidgetsBinding.instance.addObserver(this);
    _home.refresh();
    // main.dart passes the same QueueSettled to all of them: listen once each.
    for (final l in _changeSources) {
      l.addListener(_onQueueSettled);
    }
    widget.startRequests?.addListener(_consumeStart);
    _home.addListener(_consumeStart);
    WidgetsBinding.instance.addPostFrameCallback((_) => _consumeStart());
  }

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
    if (_tab != _Tab.home) setState(() => _tab = _Tab.home);
  }

  /// Every "the background drain settled something" source, each once.
  Set<Listenable> get _changeSources => {
        ?widget.services.queueSettled,
        ?widget.requests?.changed,
        ?widget.workPlan?.changed,
      };

  void _onQueueSettled() {
    // Not while recording: the flow owns the screen, and _endFlow refreshes anyway.
    if (_flow == null) _home.refresh(sendQueued: false);
    if (_tab == _Tab.history) _history.refresh();
    _requests?.refresh();
    _work?.refresh();
  }

  @override
  void dispose() {
    for (final l in _changeSources) {
      l.removeListener(_onQueueSettled);
    }
    WidgetsBinding.instance.removeObserver(this);
    widget.startRequests?.removeListener(_consumeStart);
    _home.removeListener(_consumeStart);
    _flow?.abandon();
    _flow?.dispose();
    _home.dispose();
    _history.dispose();
    _requests?.dispose();
    _work?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back in the app is when a worker can see "Not sent yet": re-read today and
    // send what waits. Not while recording — the camera's permission prompts
    // pause and resume the app too.
    if (state == AppLifecycleState.resumed && _flow == null) {
      _home.refresh();
      _requests?.refresh();
      _work?.refresh();
    }
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

  void _selectTab(_Tab tab) {
    setState(() => _tab = tab);
    if (tab == _Tab.history) _history.refresh();
    if (tab == _Tab.requests) _requests?.refresh();
    if (tab == _Tab.work) _work?.refresh();
  }

  /// A materials problem's "Make a request": back to the tabs, on Requests.
  void _openRequests() {
    Navigator.of(context).popUntil((route) => route.isFirst);
    _selectTab(_Tab.requests);
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
    final requests = _requests;
    final work = _work;
    final cards = [
      if (work != null)
        ListenableBuilder(
          listenable: work,
          builder: (context, _) => MyWorkCard(updates: work.updates, onOpen: () => _selectTab(_Tab.work)),
        ),
      if (requests != null)
        ListenableBuilder(
          listenable: requests,
          builder: (context, _) => RequestUpdatesCard(updates: requests.updates, onOpen: () => _selectTab(_Tab.requests)),
        ),
    ];
    final body = switch (_tab) {
      _Tab.home => HomeScreen(
          worker: widget.worker,
          controller: _home,
          onStartFlow: _startFlow,
          onSeeHistory: () => _selectTab(_Tab.history),
          openSettings: s.openSettings,
          exitNotice: _exitNotice,
          onDismissExit: () => setState(() => _exitNotice = null),
          requestUpdates: cards.isEmpty ? null : Column(children: cards),
        ),
      _Tab.work => MyWorkScreen(
          controller: work!,
          services: widget.workPlan!,
          isLeader: widget.worker.role == 'teamLeader',
          onMakeRequest: requests == null ? null : _openRequests,
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
              _Tab.work => NavigationDestination(icon: _WorkIcon(controller: work!), label: 'My Work'),
              _Tab.requests => const NavigationDestination(icon: Icon(Icons.inventory_2_outlined), label: 'Requests'),
              _Tab.history => const NavigationDestination(icon: Icon(Icons.history), label: 'History'),
              _Tab.profile => const NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
            },
        ],
      ),
    );
  }
}

/// The My Work tab's icon, with a red number for what needs the worker
/// (tasks to read or check, actions not accepted).
class _WorkIcon extends StatelessWidget {
  const _WorkIcon({required this.controller});
  final MyWorkController controller;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final n = controller.updates.badge;
          return Badge(
            key: const Key('my-work-badge'),
            isLabelVisible: n > 0,
            label: Text('$n'),
            child: const Icon(Icons.assignment_outlined),
          );
        },
      );
}
```

`lib/app.dart`:

**Edit 1.** Find:

```dart
import 'widget/start_flow.dart';
```

Replace with:

```dart
import 'widget/start_flow.dart';
import 'workplan/workplan_services.dart';
```

**Edit 2.** Find:

```dart
    this.launches,
    this.requests,
  });
```

Replace with:

```dart
    this.launches,
    this.requests,
    this.workPlan,
  });
```

**Edit 3.** Find:

```dart
  /// The Requests tab (Stage 1a); null in tests that do not need it.
  final RequestsServices? requests;
```

Replace with:

```dart
  /// The Requests tab (Stage 1a); null in tests that do not need it.
  final RequestsServices? requests;

  /// The My Work tab (Stage 1c); null in tests that do not need it.
  final WorkPlanServices? workPlan;
```

**Edit 4.** Find:

```dart
                  requests: widget.requests,
                ),
```

Replace with:

```dart
                  requests: widget.requests,
                  workPlan: widget.workPlan,
                ),
```


`lib/main.dart` (My Work is built after Requests, because a problem's request picker reads Requests):

**Edit 1.** Find:

```dart
import 'widget/widget_publisher.dart';
```

Replace with:

```dart
import 'widget/widget_publisher.dart';
import 'workplan/data/workplan_account_wipe.dart';
import 'workplan/data/workplan_db.dart';
import 'workplan/data/workplan_remote.dart';
import 'workplan/data/workplan_repository.dart';
import 'workplan/workplan_services.dart';
```

**Edit 2.** Find:

```dart
      // Requests are not on the widget: only the screens are told.
      onRequestsSettled: queueSettled.fire,
```

Replace with:

```dart
      // Requests and My Work are not on the widget: only the screens are told.
      onRequestsSettled: queueSettled.fire,
      onWorkPlanSettled: queueSettled.fire,
```

**Edit 3.** Find:

```dart
  runApp(WorkMateApp(
```

Replace with:

```dart
  // My Work (Stage 1c): the same worker scope, the same background task. If
  // its database cannot open, the app starts without the My Work tab:
  // attendance must never depend on it. The saved copy is kept for the
  // signed-in worker only (spec §11); unsent actions always wait.
  WorkPlanServices? workPlan;
  try {
    final repo = WorkPlanRepository(
      db: await openDeviceWorkPlanDb(),
      remote: SupabaseWorkPlanRemote(client),
      device: device,
      scheduler: scheduler,
      currentWorkerId: attendance.currentWorkerId,
      photoDir: () async => Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}task-photos'),
      sendNow: () async {
        await syncHost.drainNow();
      },
    );
    final wipe = WorkPlanAccountWipe(repo);
    controller.addListener(() => wipe.onAppState(controller.state));
    wipe.onAppState(controller.state);
    workPlan = WorkPlanServices(api: repo, changed: queueSettled, requests: requests?.api);
  } catch (e) {
    debugPrint('My Work unavailable: $e');
  }

  runApp(WorkMateApp(
```

**Edit 4.** Find:

```dart
    requests: requests,
  ));
```

Replace with:

```dart
    requests: requests,
    workPlan: workPlan,
  ));
```


`pubspec.yaml`:

**Edit 1.** Find:

```yaml
version: 0.5.0+1005
```

Replace with:

```yaml
version: 0.6.0+1006
```


- [ ] **Step 4: Run the shell test**

Run: `flutter test test/ui/screens_test.dart`
Expected: `+12: All tests passed!`

- [ ] **Step 5: Whole suite and analyzer**

Run: `flutter analyze` → `No issues found!`; `flutter test` → `+663: All tests passed!` (662 + 1).

- [ ] **Step 6: Stop — no commit.** Report to the controller.

---

### Task 5: Release build and phone pilot (controller + user)

**Files:**
- Modify (close-out only): this plan, where the execution notes are appended; memory `workmate-stage1c-my-work.md` and its `MEMORY.md` line.

**Pilot accounts (live, checked 2026-10-14):**

| Account | Role | Teams |
|---|---|---|
| **W-0007** John Tapales | worker | Team test |
| **W-0019** Danilo Tapales | worker | Team pilot B |
| **W-0021** Mark Frias | teamLeader | **leads Team test**; member of Team pilot B |

**Project:** Barlin Residence, Main Contract.

**Database checks:** after every step, check the database through MCP `execute_sql`, read-only (for example `select kind, note, created_at from wp_events where task_id = '<id>' order by id;`). Never edit pilot data by SQL; the office acts in Dacs Web, the worker on the phone.

- [ ] **Step 1: Final checks.** In the WorkMate repo, `flutter analyze` → `No issues found!` and `flutter test` → `All tests passed!` (670 after the final fix wave; see Execution notes).
- [ ] **Step 2: Build.** With `JAVA_HOME` set to JDK 21: `flutter build apk --release`. Expected: `build/app/outputs/flutter-apk/app-release.apk`, **under 50 MB** (the updates bucket limit).
- [ ] **Step 3: Install** on the test phone: `adb install -r build/app/outputs/flutter-apk/app-release.apk`. `adb shell dumpsys package com.dacs.workmate | grep versionName` should show **0.6.0**.
- [ ] **Step 4: Office setup (user, in Dacs Web → Work Plan).**
  - Meeting **"ZZ 1c3 pilot"** with these drafts, then publish with shared notes to everyone assigned:
    - **A** "ZZ 1c3 A – skim coat": Team test, responsible **W-0007**, dates today → +2 days.
    - **B** "ZZ 1c3 B – cabinets": Team pilot B, responsible **W-0019**, helper **W-0021**.
    - **C** "ZZ 1c3 C – paint": Team test, responsible **W-0007**, **waits for A**.
  - The controller confirms that all three are `not_started`, version 1, with the right people.
- [ ] **Step 5: Pilot.** Run each check and note PASS or FAIL, with a screenshot when it fails.
  1. **Tab and card (W-0007).**
     - Bottom bar: Home · **My Work** · Requests · History · Profile.
     - My Work shows a red **2**, and the Home card says "2 tasks to read".
     - A and C are under Today, both **New**.
     - Meeting notes (1) opens the shared notes.
     - **No "My proposals"** for a worker.
  2. **Read.**
     - On A, Start is locked with "Read the task first".
     - Tap **I'VE READ THIS** → Start unlocks.
     - Database: `wp_acks` has A version 1 for W-0007.
     - In Dacs Web, A's People shows W-0007 as read.
  3. **Waiting for an earlier task.**
     - Before reading, C is under **Today**, because reading comes first.
     - Open C: it shows "Earlier task: ZZ 1c3 A – skim coat", and Start is locked with the waiting text ("…must be cleared by the office first").
     - Tap **I'VE READ THIS** on C. Back on the list, C is now under **Waiting**, and Start is still locked with the waiting text.
  4. **Revision.**
     - Office changes A's planned end. The phone shows A as **Changed**, with the office's "Changed: planned dates" line, and the badge is back.
     - Read again.
     - Office fixes one letter and ticks "Only a spelling correction": **no** new reading on the phone.
  5. **Start and progress.**
     - Start A.
     - Report progress "Test – half done" **with a photo**.
     - Database: the `progress` event, and one `wp_photos` row with that `event_id`, path `<W-0007 id>/<A id>/…jpg`.
     - Dacs Web shows the photo on A.
  6. **Problem with a request link.**
     - W-0007 first sends a small request for Barlin in Requests.
     - On A → Report a problem → **Materials**, "Test – no cement", link that request, add a photo.
     - A moves to **Waiting**, and Report done is **locked**.
     - Database: `wp_blockers` row with `request_id` set, plus a photo with `blocker_id`.
     - The **Make a request instead** shortcut opens Requests and sends nothing.
  7. **The office clears it.** In Dacs Web, clear A's problem with a note → after pulling down, A is back in Today and Report done unlocks.
  8. **Offline.**
     - Airplane mode on. On A, report progress "Test – offline", then kill the app (swipe away) and reopen. Still shown as "Progress report · Pending sync" and counted on Home.
     - Turn airplane mode off and **wait**, or switch away from the app and back. Pulling down only re-reads; sending happens in the background, or when the app comes back to the screen. → Sent **once**. Database: exactly one new `progress` event.
  9. **Report done and the leader's check.**
     - W-0007 reports A done → A is in Waiting.
     - Sign out, then sign in as **W-0021**: A shows **To check**, with the badge.
     - Check this work. Database: status `leader_checked`.
     - Office approves in Dacs Web → A is **Completed**, under Done.
     - **C** is no longer waiting for A: it moves to Today for W-0007.
  10. **Helper (W-0021 on B).**
      - B shows under Today as **New**; read it.
      - No Start / progress / done buttons; **Report a problem** is there.
      - No "To check" on B (W-0021 is assigned to it, and does not lead Team pilot B).
  11. **Proposals (W-0021).**
      - My proposals → Propose a task for Team test, Barlin · Main Contract, "ZZ 1c3 proposal 1" → shows Pending sync, then Sent.
      - Office declines it with "test decline" → the phone shows **Declined** with "Office: test decline".
      - Propose "ZZ 1c3 proposal 2"; the office publishes it → **Published**.
  12. **An outdated read (W-0007, on C).** C was read in check 3, and A was approved in check 9, so C no longer waits.
      - **Online:** the office changes C's instructions → on the phone, after pulling down, C shows **Changed** with the badge. **Do not read it yet.**
      - **Airplane on.** Read C (tap I'VE READ THIS on that revision), then tap Start. Both show "· Pending sync".
      - While the phone is still offline, the office changes C's instructions **again**.
      - **Airplane off**, then wait or switch back to the app → the read is answered as outdated (not an error). The Start shows **"Start work: This was not accepted"** with the "office changed this task" reason.
        - While that refusal is shown, C's label reads **"Not accepted"**. The task screen shows the red **"The office changed this task. Read it again."** box, and the badge counts it.
        - Tap **Dismiss** and C's label reads **Changed**.
      - Database: `wp_acks` has **no** row for C's two newest versions; there is no `started` event for C.
      - Read it, then Start works (database: `started`).
  13. **Shared phone.** Signing in needs signal, so the switch happens online and the offline part comes after.
      - As W-0007, online: open My Work, so the phone saves W-0007's tasks (A, C).
      - Sign out, then sign in as **W-0019**, online. My Work shows **only B**, with W-0019 as responsible.
      - Turn airplane mode on and pull down on My Work: the no-signal line shows W-0019's saved copy (B only), and **none of W-0007's tasks** appear.
      - Database (read-only): nothing to check; this is about what the phone shows.
      - Airplane mode off. Sign back in as W-0007 for the next check.
  14. **Sent back.**
      - W-0019 starts B (after reading it) and reports done.
      - The office sends it back with "test send back" → B shows **Sent back** and the banner, and history shows the reason.
- [ ] **Step 6: Findings.**
  - A failing check is fixed TDD-style in `test/workplan/**`, then `flutter analyze` and `flutter test`.
  - Bump to **0.6.1+1007**, rebuild, reinstall, and re-run only that check.
  - A server finding needs a new migration (next free number) with the dry-run → apply → verify cycle. Stop and ask the user first.
- [ ] **Step 7: Clean-up.** The office cancels every remaining "ZZ 1c3" task and proposal with reason "test" (history stays). Ask the user about W-0007's pilot request (leave it, or cancel it from the app; **never delete**).
- [ ] **Step 8: Close-out.**
  - Append `## Execution notes (YYYY-MM-DD)`: each check's outcome, findings and rulings.
  - Update memory `workmate-stage1c-my-work.md` and its `MEMORY.md` line: 1c-3 done; next is 1c-4, the pilot with real crews when the switch-over happens.
- [ ] **Step 9: Publishing (only if the user asks, after the pilot passes):** upload the APK in Dacs Web → Attendance → App updates, stream `com.dacs.workmate`. Workers stay on the old Attendance app until the current project ends (0E deferred).
- [ ] **Step 10: Stop — the user commits both repos.**

---

## Execution notes (14 October 2026) — Tasks 1–4

**How it was built:**
- Subagent-driven, on WorkMate `main`, with no worktree and **nothing committed by the agent**.
- Each task was transcribed from this plan, then reviewed for spec and quality: Tasks 1, 3 and 4 by a mid-tier model, Task 2 (concurrency) by the most capable one. All four were **Approved** with no Critical or Important findings.
- After every task, the working tree was byte-identical to the pre-tested scratch copy. Test counts per task: 620 / 652 / 662 / 663.

**Final whole-branch review (most capable model):**
- 0 Critical, 0 Important. Verdict: "Ready for the phone pilot".
- It triaged the deferred minors from the task reviews.

**Final fix wave.** One fix dispatch, plus one round after a controller finding, plus one scoped re-review that found all four addressed. Four small guards, each with a regression test that fails without it:
- **A.** A disposed `MyWorkController` never runs another `load()`. Before this, a re-run queued during a read could start a second, concurrent reader after an account switch.
- **B.** `keepCacheOnly` keeps `wp_accepted_seq`, a counter with no private data. A worker's accepted-answer numbering never restarts, so a read already in flight cannot forget a newer accepted answer.
- **C.** `WpFailure.of` maps `FileSystemException` to `unexpected`, which counts toward the 10-try cap. One unreadable photo is given up instead of blocking the worker's queue forever.
- **D.** `startWork`, `reportDone` and `checkWork` queue nothing when the saved task is already **later** in the order than the action needs. This catches a second tap after a fast accept, which would otherwise show a false "not accepted".
  - The controller caught a regression in the first version, which compared "different" instead of "later": an offline Report done right after a queued Start was being dropped. It was fixed, and pinned by a test.

**Final state:**
- `flutter analyze`: `No issues found!`
- `flutter test`: **670 passed** (663 + 7 fix-wave tests)
- Version `0.6.0+1006`; `pubspec.lock` unchanged.
- Task 5 Step 1 now expects **670**.

**Pilot wording corrected (rulings):**
- **Check 8:** "wait, or switch away and back". Pull-down only re-reads.
- **Check 12:** while a refusal is shown, the label reads "Not accepted", with the red "office changed this task" box. After Dismiss, it reads "Changed".

**Follow-ups (not blocking the pilot):**
- A non-retryable `badOperation` failure for uncoded server errors.
- Catching errors around `act()` and the form buttons, with a bilingual message and the kept photo discarded.
- A last-updated line on the notes and proposals screens (spec §11).
- Faster feedback than waiting for a full `load()` on weak signal.
- Pull-down that also sends.

**Fix-wave diff (lib only; tests are in `test/workplan/**`, including `test/workplan/ui/my_work_controller_test.dart`):**

```diff
diff --git a/lib/workplan/data/workplan_db.dart b/lib/workplan/data/workplan_db.dart
index cec3323..fcd6835 100644
--- a/lib/workplan/data/workplan_db.dart
+++ b/lib/workplan/data/workplan_db.dart
@@ -218,8 +218,11 @@ class WorkPlanDb {
   /// Spec §11: another worker's saved tasks and notes are never shown on this
   /// phone — only [workerId]'s copy is kept ('' keeps none). Queued ops stay:
   /// cleanup must never delete unsent work; they wait for their own worker.
+  /// The accepted-answer counter ([wp_accepted_seq]) is kept — it holds no
+  /// private data, and restarting a worker's numbering could let a read
+  /// already in flight forget a newer accepted answer.
   Future<void> keepCacheOnly(String workerId) => _db.transaction((txn) async {
-        for (final table in ['wp_cache', 'wp_accepted', 'wp_accepted_seq']) {
+        for (final table in ['wp_cache', 'wp_accepted']) {
           await txn.delete(table, where: 'worker_id <> ?', whereArgs: [workerId]);
         }
       });
diff --git a/lib/workplan/data/workplan_repository.dart b/lib/workplan/data/workplan_repository.dart
index 2722072..615080a 100644
--- a/lib/workplan/data/workplan_repository.dart
+++ b/lib/workplan/data/workplan_repository.dart
@@ -168,9 +168,36 @@ class WorkPlanRepository implements WorkPlanApi {
     final w = _worker();
     final queued = await db.sendable(w);
     if (queued.any((o) => o.kind == WpOpKind.start && o.taskId == task.id)) return;
+    if (await _movedPast(w, task.id, 'not_started')) return;
     await _queue([_op(w, WpOpKind.start, taskId: task.id)]);
   }
 
+  /// The status of [taskId] in this worker's SAVED task list, or null when
+  /// there is no list or the task is not in it. `settle` patches it in the same
+  /// transaction that removes an accepted action.
+  Future<String?> _savedStatus(String w, String taskId) async {
+    final saved = await db.cache(w, 'work');
+    final body = saved?.body;
+    if (body is! List) return null;
+    for (final d in body) {
+      if (d is Map && d['id'] == taskId) return d['status'] as String?;
+    }
+    return null;
+  }
+
+  /// True when the saved task is already later than [needs] in the task's
+  /// life (not started < in progress < reported < checked < completed). A
+  /// status that merely differs is not enough: offline, Report done after a
+  /// queued Start sees the saved task still not started and must be queued.
+  /// The button can still be enabled for a moment after the quick send was
+  /// accepted, and a second tap would queue an action the server refuses (BAD_STATE) and show
+  /// a false "not accepted".
+  Future<bool> _movedPast(String w, String taskId, String needs) async {
+    final status = await _savedStatus(w, taskId);
+    final saved = WpStatus.parse(status)?.index, wanted = WpStatus.parse(needs)?.index;
+    return saved != null && wanted != null && saved > wanted;
+  }
+
   /// The report, then its photo (linked once the report lands).
   List<WpOp> _withPhoto(String w, WpOp report, String? photo) => [
         report,
@@ -201,6 +228,7 @@ class WorkPlanRepository implements WorkPlanApi {
     final w = _worker();
     final queued = await db.sendable(w);
     if (queued.any((o) => o.kind == WpOpKind.done && o.taskId == task.id)) return;
+    if (await _movedPast(w, task.id, 'in_progress')) return;
     await _queue([_op(w, WpOpKind.done, taskId: task.id, body: {'note': note.trim()})]);
   }
 
@@ -209,6 +237,7 @@ class WorkPlanRepository implements WorkPlanApi {
     final w = _worker();
     final queued = await db.sendable(w);
     if (queued.any((o) => o.kind == WpOpKind.check && o.taskId == task.id)) return;
+    if (await _movedPast(w, task.id, 'reported_done')) return;
     await _queue([_op(w, WpOpKind.check, taskId: task.id, body: {'note': note.trim()})]);
   }
 
diff --git a/lib/workplan/domain/wp_failure.dart b/lib/workplan/domain/wp_failure.dart
index f828a44..f2044da 100644
--- a/lib/workplan/domain/wp_failure.dart
+++ b/lib/workplan/domain/wp_failure.dart
@@ -51,6 +51,10 @@ enum WpFailure {
   };
 
   static WpFailure of(Object error) {
+    // A file problem is not a missing signal: [unexpected] counts toward
+    // [maxWpAttempts], so one unreadable photo is given up after 10 tries
+    // instead of blocking the worker's queue.
+    if (error is FileSystemException) return unexpected;
     if (error is IOException ||
         error is TimeoutException ||
         error is http.ClientException ||
diff --git a/lib/workplan/ui/my_work_controller.dart b/lib/workplan/ui/my_work_controller.dart
index a99340c..427f3ad 100644
--- a/lib/workplan/ui/my_work_controller.dart
+++ b/lib/workplan/ui/my_work_controller.dart
@@ -74,7 +74,7 @@ class MyWorkController extends ChangeNotifier {
     do {
       _again = false;
       await _load();
-    } while (_again);
+    } while (_again && !_disposed);
   }
 
   Future<void> _load() async {
```

---

## Execution notes (14 October 2026) — Task 5, phone pilot

**Setup.**
- WorkMate **0.6.0+1006** release APK, installed on the Xiaomi test phone.
- Office side on Dacs Web: localhost for checks 1–9, then the live `dacs-company.vercel.app`.
- Pilot accounts: W-0007, W-0019, W-0021.
- The Supabase MCP was disconnected, so the read-only database checks were replaced by the Dacs Web task history and People panels. Those show the same events, reads and versions.

**Result: all 14 checks PASS. No app finding, so no 0.6.1 rebuild and no new migration.**

| # | Check | Outcome |
|---|---|---|
| 1 | Tab and card | PASS. Tab order, red 2, Home "2 tasks to read", A + C New, no My proposals for a worker. "Meeting notes (0)" instead of (1): the pilot meeting never published notes (setup gap). See the notes ruling below. |
| 2 | Read | PASS. Start locked until I'VE READ THIS; Dacs Web shows "Read version 1". |
| 3 | Waiting for an earlier task | PASS. Unread C under Today with the waiting text; after reading, it moves to Waiting and Start stays locked. |
| 4 | Revision | PASS. Date change → Changed + "Changed: planned dates", read again. Spelling-only save → no new reading. |
| 5 | Start and progress + photo | PASS. The photo shows on the phone and in Dacs Web. |
| 6 | Problem linked to a request | PASS. A moves to Waiting, Report done locked. "Make a request instead" opens Requests and sends nothing. |
| 7 | Office clears the problem | PASS. A is back in Today, Report done unlocked. |
| 8 | Offline progress | PASS. "Pending sync" in airplane mode; sent **once** on reconnect (one history line in Dacs Web). |
| 9 | Report done → leader check → office approve | PASS. W-0021 sees "To check"; Leader checked → Approved; A is Completed; C leaves Waiting. |
| 10 | Helper (W-0021 on B) | PASS. Only Report a problem; no To check. |
| 11 | Proposals | PASS. Declined + "Office: test decline"; proposal 2 published (the office must set a responsible person first) and appears as New in W-0021's My Work. |
| 12 | Outdated read offline | PASS on the redo, on "ZZ 1c3 proposal 2" as W-0021: read + Start offline, office revised, reconnect → "Not accepted", bilingual red box; re-read + Start → In progress. Dacs Web history has no read of the old version and one Started, after the revision. |
| 13 | Shared phone | PASS. W-0019 online and offline sees only B. |
| 14 | Sent back | PASS. Read + Start + Report done were all queued **offline** and arrived in order, once each. Send back → "Sent back" pill, banner, reason in history. |

**Rulings made during the pilot:**
- **Check 12, first try (on C), did not exercise the outdated path.** Both office edits landed before airplane mode; the offline screens already showed Version 3. Read + Start of the current version were accepted, which is correct. The check was redone on proposal 2, which W-0021 had not read and not started.
- **Check 12 wording.** After Dismiss, the label reads **"New"** when the worker never had a read accepted, and **"Changed"** only when an older version was read. Both are correct; the plan's "Changed" assumed C.
- **Check 12 badge.** One refused task counts **2** (to read + refused), by design: `badge = toRead + toCheck + failed`.
- **Meeting notes.** Two accounts are named John Tapales (**W-0005** and **W-0007**). The 1c-2 meeting's version 2 went to Danilo + W-0005, so W-0007 (0) and W-0019 (1) are both right. W-0019's notes screen showed the meeting, version and text. The notes path passes; the pilot meeting simply had no notes.
- **Report progress before Start** is allowed by design (`wp_rules`: progress allows `not_started`).
- **Publishing a proposal** is refused until the office sets a responsible person ("Choose the responsible person first."). This is the correct guard.

**Follow-ups found in the pilot (none blocking):**
- "Team Team test": the task header puts "Team" in front of a team name that already starts with "Team".
- The Photos card is blank while the signed links load; it needs a placeholder.
- Dacs Web labels a declined proposal **"Cancelled"**; "Declined" would match the phone.
- A published proposal's phone history starts at "Corrected by the office"; the server returns no "proposed" line to the worker. Dacs Web shows "Proposed by a team leader".
- The minor-correction box is easy to miss (known from 1c-2).
- Two workers share the name "John Tapales": AI drafting and the recipient lists need the W- number.
- Still open from Tasks 1–4: `badOperation` failure, `act()` catch, notes last-updated line, faster feedback, pull-down that also sends.

**Clean-up (Step 7, 19:45).** The office cancelled B, C and proposal 2 with reason "test". The board now shows only ZZ 1c3 A, under "Completed in the last 30 days"; a completed task has no Cancel, so it drops off by itself. Proposal 1 was already declined. History is kept and nothing was deleted.
