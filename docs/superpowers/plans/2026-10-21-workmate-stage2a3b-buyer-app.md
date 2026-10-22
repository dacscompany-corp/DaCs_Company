# WorkMate Stage 2A-3b — Buyer app (WorkMate 0.7.0+1007) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Office accounts allowed to buy sign in to DAC'S WorkMate and see Shopping list · My purchases · Profile: they claim and release request portions, mark their own portions arranged, record purchases (also with no signal), and correct their own purchases.

**Architecture:** A buyer is a separate signed-in state (`BuyerReady`), so no worker part of the app (attendance, the home-screen widget, Requests, My Work) ever runs for one. A new `lib/purchasing/` module follows the Requests module's pattern: its own SQLite file, a send-once queue drained by the existing background sync, a saved copy for use with no signal, an `Api` interface with a repository behind it, and controllers + screens. **No server change:** everything it calls is live since 0096/0097/0101 and `attendance-signin` v4.

**Tech stack:** Flutter 3.38.9 / Dart 3.10.8, supabase_flutter 2.17.2, sqflite 2.4.2+1, camera 0.12.0+2, **image_picker 1.2.1 (new, pinned)**.

**Spec:** [Mobile Purchasing](../specs/2026-09-30-workmate-mobile-purchasing-design.md) · answers: [2A-3 questions](../specs/2026-10-20-workmate-stage2a3-questions.md) (Q1–Q23 = A) · rulings R1–R8: [2A-3 roadmap](2026-10-20-workmate-stage2a3-roadmap.md) · server as built: [plan 2A-3a + execution notes](2026-10-20-workmate-stage2a3a-server-web.md) (R9–R15)

**Repo:** `Documents/Dacs WorkMate` (not Dacs Web). This plan file lives in Dacs Web with the other WorkMate plans.

## Global Constraints

- **No server change.** Migration 0101 and `attendance-signin` v4 are live (21 Oct). If a step seems to need SQL, stop: it is a plan error.
- `pubspec.yaml` **`version: 0.7.0+1007`** (Q20). versionCode ≥ 1000 and higher than every published WorkMate build (0082). **Never `--split-per-abi`.** The `app-releases` bucket takes 50 MB at most.
- **`image_picker: 1.2.1`**, pinned. `permission_handler` stays **12.0.1** (13.x needs AGP 9). No other dependency changes; `flutter pub get` adds image_picker's platform packages to `pubspec.lock` and changes no existing pin.
- Build with JDK 21: `$env:JAVA_HOME="$HOME\.jdks\jbr-21.0.11"`.
- Every purchase the phone sends has **`source: 'workmate'`**. The server decides money, funding, coverage and every check; the phone only says what was bought.
- Q22: key labels and every message in **English with the Tagalog line underneath**.
- Dates: the purchase date is **Manila's** date (`manilaDate`), never `toIso8601String().substring(0, 10)`.
- Site phones are shared: every row on the phone is scoped by account; nothing with a price is kept for anyone but the signed-in buyer.
- The user commits. Each task ends with `flutter test` and `flutter analyze` green.

## Rulings (2A-3b)

R1–R15 stand (roadmap, 2A-3a). New, found while building and testing this plan. **R18–R21 approved by the user on 21 October 2026.** Q23 = A was answered by the user in the planning session on 21 Oct ("go with recommended A"), so skipping the Attendance Terms for buyers follows that answer.

| # | Ruling |
|---|---|
| R16 | A buyer is its own app state, **`BuyerReady`** (also `BuyingOff`, `BuyerUnavailable`). Every worker part keys on `Ready`, so none of it runs for a buyer: no attendance queue, no widget, no Requests, no My Work. |
| R17 | Startup check (Q1): workers as before; an office account asks `pur_me()` and keeps the answer per account for offline launches. Server says yes → in. Server says no and this phone knew the account as a buyer → **Buying is turned off** (R2: not signed out, unsent purchases kept, TRY AGAIN). Server says no and the phone never knew it as a buyer → signed out, "This account has no WorkMate access". Offline with nothing known → "Connect once" screen; never assumed. A deactivated account is signed out as today. |
| **R18** | **Q6 "Mark arranged … optional note"** — `pr_office_set_arranged(portion, arranged)` has **no note** and 2A-3a added none. The phone marks arranged **without a note**. Keeping the note needs a small migration (a column + a new function argument) in a later stage. **Confirm.** |
| **R19** | **Q10 "optional photo of what was bought"** — the server has **no place** for a substitute or different-unit photo (a purchase keeps only its four receipt slots). The phone asks for the reason only. **A different unit's note goes into the purchase's Notes** as `Line N (different unit): …`, because only a substitute has a reason field on the server. A photo field needs a migration in a later stage. **Confirm.** |
| **R20** | Receipt photos use the **same four slots as the Purchasing tab** (supplier invoice / OR, payment receipt, delivery receipt, purchase order), camera or gallery each. At least one photo, or **No receipt** + a reason (Q8). Upload exactly as the web does: the `receipt_uploads` row first, then the file at `purchases/<company>/<yyyy-mm>/<id>.jpg` in the private `uploads` bucket; the purchase stores the public-format link. **Confirm.** |
| **R21** | Q9's total check: the buyer **types the receipt total as printed**, and the phone refuses to send unless items + fees − discounts equal it (the web computes the total instead). **Confirm.** |
| R22 | Corrections (Q13) are **online only**, change exactly Q13's fields (date, supplier, each line's quantity and amount, the receipt total, new photos for empty slots), and never the project, the request links or the number of lines. When the server answers OWNER_APPROVAL_NEEDED or COMPLETED_PROJECT, nothing changes and the same change is offered as **Send to the owner** (`pur_request_change`). A purchase waiting for the owner offers no second change. No void (Q13). |
| R23 | The shopping list is read once (`pur_shopping_list`, all open lines, every batch) and filtered on the phone: **This week** = the first batch whose cutoff is still ahead (the Purchasing tab's rule), or **All weeks**; a project filter. A portion with nothing left to buy is not shown. |
| R24 | A new line's category is the request's, else **Materials** (the Purchasing tab's default); the buyer may change it. |
| R25 | A refused purchase (**Needs attention**) is never retried. **Fix and send again** returns it to editing; sending it again is a **new** operation (the refused one recorded nothing). Receipt files uploaded by the refused attempt stay as pending `receipt_uploads` rows (harmless; the web leaves such rows too). |
| R26 | Any **BUYER_REQUIRED** answer wipes the phone's saved copy (shopping list, purchases, receipts read) and shows Buying is turned off at once. A queued purchase refused that way stays Needs attention and can be sent again once buying is turned back on (R2). |
| R27 | Receipts are shown by downloading them as the buyer (never a signed link, 0097) and kept **in memory only** for the session. |

## File structure

New module `lib/purchasing/`:

| File | Responsibility |
|---|---|
| `buyer_access.dart` | `pur_me()` + the company id, kept per account for offline launches (R17) |
| `purchasing_services.dart` | What the screens get from `main.dart`: the api, the change signal, camera and gallery pickers |
| `domain/pur_models.dart` | The server's JSON as the phone reads it: batches, shopping lines and portions, destinations, suppliers, purchases |
| `domain/purchase_draft.dart` | A purchase being recorded: its checks (`purchaseProblems`), the `pur_record` body, the server's split (`prorate`) |
| `domain/correction.dart` | A correction of a recorded purchase: its checks and the `pur_correct` body |
| `domain/pur_op.dart` | One queued purchase and its receipt uploads; the receipt path |
| `domain/pur_failure.dart` | Every refusal code → what the buyer can do, in both languages |
| `data/purchasing_db.dart` | Drafts, the send-once queue, the saved copy (`workmate_purchasing.db`) |
| `data/purchasing_remote.dart` | The server calls, receipt upload and download |
| `data/purchasing_api.dart` | The interface the screens use, and its view types |
| `data/purchasing_repository.dart` | Offline-first implementation; wipes on BUYER_REQUIRED (R26) |
| `data/purchasing_account_wipe.dart` | Only the signed-in buyer's saved copy is kept |
| `sync/purchasing_sync.dart` | Sends queued purchases: receipts once, then `pur_record` once |
| `list/shopping_controller.dart`, `list/shopping_list_screen.dart` | Shopping list (Q4–Q6) |
| `record/record_controller.dart`, `record/record_screen.dart` | Record purchase (Q7–Q11) |
| `mine/my_purchases_controller.dart`, `mine/my_purchases_screen.dart`, `mine/purchase_detail_screen.dart`, `mine/correct_screen.dart` | My purchases (Q12), one purchase, corrections (Q13) |
| `ui/buyer_shell.dart`, `ui/buying_off_screen.dart`, `ui/purchasing_copy.dart` | The buyer's tabs, the switch-off screen, bilingual labels |

Changed: `lib/auth/` (sign-in reads `access`; `NO_WORKMATE_ACCESS`; `SignedIn`), `lib/app_controller.dart` (buyer states), `lib/app.dart`, `lib/main.dart`, `lib/attendance/sync/background_sync.dart` (drains purchases too), `lib/profile/profile_screen.dart` and `lib/ui/worker_header.dart` (buyer variant), `lib/ui/gate_unavailable_screen.dart` (its words), `lib/requests/camera/request_camera_screen.dart` (a title), `pubspec.yaml`.

## Server calls the phone makes (all live)

| Call | Used for |
|---|---|
| `attendance-signin` (x-dacs-app: workmate) | Sign-in; answers `access: "buyer"` for a buyer (2A-3a R1) |
| `pur_me()`, `profiles(id,role,owner_id)` | Startup check; the company id (`data_owner_id()`) |
| `pr_office_batches()`, `pur_shopping_list(null, null, 'open')` | Shopping list |
| `pur_assign_portion(portion, me \| null, qty \| null, null)` | Claim (whole or part) / release (Q5) |
| `pr_office_set_arranged(portion, bool)` | Mark arranged, own portions only on the phone (Q6, R18) |
| `pur_destinations()`, `pur_suppliers()` | Record form choices (Q11) |
| `receipt_uploads` insert, storage `uploads` upload / download | Receipts (R20, R27) |
| `pur_record(op, body)` | Record, once per op id (Q7) |
| `pur_my_purchases(60)`, `pur_purchase(id)` | My purchases (Q12) |
| `pur_correct(op, id, body, reason)`, `pur_request_change(op, id, 'correct', body, reason)` | Corrections (Q13, R22) |

---

### Task 1: Buyer accounts

Sign-in reads `access`; `NO_WORKMATE_ACCESS` gets its words; the app learns `BuyerReady`, `BuyingOff` and `BuyerUnavailable`; buyers skip the Attendance Terms (Q23); Profile has a buyer variant; a first buyer shell (Profile only — tabs come in Tasks 3 and 5).

**Files:**
- Create: `lib/auth/workmate_access.dart`, `lib/purchasing/buyer_access.dart`, `lib/purchasing/ui/buyer_shell.dart`, `lib/purchasing/ui/buying_off_screen.dart`
- Modify: `lib/auth/sign_in_api.dart`, `lib/auth/login_failure.dart`, `lib/auth/auth_repository.dart`, `lib/auth/worker_profile.dart`, `lib/app_controller.dart`, `lib/app.dart`, `lib/main.dart`, `lib/profile/profile_screen.dart`, `lib/ui/worker_header.dart`, `lib/ui/gate_unavailable_screen.dart`
- Test: `test/purchasing/buyer_access_test.dart`, `test/purchasing/ui/buyer_screens_test.dart`; modify `test/app_controller_test.dart`, `test/auth/sign_in_api_test.dart`, `test/auth/login_failure_test.dart`, `test/auth/auth_repository_test.dart`

**Interfaces:**
- Produces: `enum WorkMateAccess { worker, buyer }` with `static WorkMateAccess parse(Object?)`; `SignInSuccess.access`; `class SignedIn(WorkerProfile worker, WorkMateAccess access)` returned by `AuthRepository.signIn`; `LoginFailure.noWorkMateAccess`; `WorkerProfile.isWorker`, `.isActive`.
- Produces: `class BuyerStatus({bool canBuy, String companyId})`; `String companyOf(Map<String,dynamic>? profile, String userId)`; `abstract class BuyerAccessBackend { Future<BuyerStatus> status(String userId); }`, `SupabaseBuyerAccessBackend`; `enum BuyerDecision { canBuy, turnedOff, neverABuyer, unknown }`; `class BuyerAccess({backend, prefs})` with `decide`, `letIn`, `markTurnedOff`, `companyOf`, `forget`.
- Produces: `class BuyerReady(WorkerProfile worker)`, `BuyingOff(worker)`, `BuyerUnavailable(worker)` (AppState); `AppController({..., BuyerAccess? buyers})`; `Future<void> AppController.buyingTurnedOff()`.
- Produces: `BuyerShell({buyer, versionName, onSignOut, account})` (Task 3 adds `purchasing`); `BuyingOffScreen({onRetry, onSignOut, int unsent = 0})`; `ProfileScreen(..., bool buyer = false)`; `WorkerHeader(..., String? subtitle)`; `GateUnavailableScreen(..., title, english, tagalog)` (defaults keep the Terms words).

- [ ] **Step 1: Write the failing tests** (the blocks below marked *Tests*).
- [ ] **Step 2: Run them; they fail to compile** (`WorkMateAccess`, `BuyerAccess`, `BuyerReady` do not exist yet).

Run: `flutter test test/auth test/app_controller_test.dart test/purchasing`
Expected: compilation errors naming the missing types.

- [ ] **Step 3: Write the code** (the blocks below marked *Code*).
- [ ] **Step 4: Run the whole suite and the analyzer.**

Run: `flutter test` → **695 passed** (670 + 25). `flutter analyze` → `No issues found!`

- [ ] **Step 5: The user commits** (`2A-3b Task 1: buyer accounts`).

<!-- Tests -->

**Modify:** `test/app_controller_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/app_controller_test.dart b/test/app_controller_test.dart
index 2eb2533..9e59080 100644
--- a/test/app_controller_test.dart
+++ b/test/app_controller_test.dart
@@ -12,9 +12,12 @@ import 'package:workmate/auth/login_failure.dart';
 import 'package:workmate/auth/session_gate.dart';
 import 'package:workmate/auth/sign_in_api.dart';
 import 'package:workmate/auth/worker_cache.dart';
+import 'package:workmate/purchasing/buyer_access.dart';
 import 'package:workmate/terms/terms_repository.dart';
 import 'package:workmate/update/app_update_repository.dart';
 
+import 'purchasing/buyer_access_test.dart' show FakeBuyerBackend;
+
 class ExplodingCache extends WorkerCache {
   ExplodingCache(super.prefs);
   @override
@@ -212,4 +215,140 @@ void main() {
     await c.start();
     expect((c.state as SignedOut).notice, LoginFailure.notAWorker);
   });
+
+  group('2A-3b buyers', () {
+    late FakeBuyerBackend buyerBackend;
+    late BuyerAccess buyers;
+    const buyerBody =
+        '{"session":{"access_token":"A","refresh_token":"R"},"worker":{"id":"s1","role":"staff","status":"active"},"access":"buyer"}';
+
+    Future<AppController> buildWithBuyers({String signInBody = buyerBody, int signInStatus = 200}) async {
+      final prefs = await SharedPreferences.getInstance();
+      final cache = WorkerCache(prefs);
+      buyers = BuyerAccess(backend: buyerBackend, prefs: prefs);
+      return AppController(
+        auth: AuthRepository(
+            api: SignInApi(MockClient((_) async => http.Response(signInBody, signInStatus))), backend: authBackend, cache: cache),
+        terms: TermsRepository(backend: termsBackend, cache: cache, userAgent: 'test'),
+        updates: AppUpdateRepository(
+            source: source, prefs: prefs, installedVersionCode: 1000,
+            download: MockClient((_) async => http.Response('', 404)), cacheDir: () async => Directory.systemTemp),
+        nudges: nudges.stream,
+        buyers: buyers,
+      );
+    }
+
+    setUp(() => buyerBackend = FakeBuyerBackend());
+
+    test('sign-in as a buyer: straight to the buyer app, never the Attendance Terms (Q23)', () async {
+      termsBackend.versions = {};
+      final c = await buildWithBuyers();
+      await c.start();
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 's1', 'role': 'staff', 'status': 'active'};
+      expect(await c.signIn('staff@x.com', 'pw'), isNull);
+      expect(c.state, isA<BuyerReady>());
+    });
+
+    test('sign-in as a buyer with no signal right after: still let in (the function said buyer)', () async {
+      buyerBackend.offline = true;
+      final c = await buildWithBuyers();
+      await c.start();
+      expect(await c.signIn('staff@x.com', 'pw'), isNull);
+      expect(c.state, isA<BuyerReady>());
+    });
+
+    test('restored buyer session: the server is asked again (Q1 startup re-check)', () async {
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 's1', 'role': 'staff', 'status': 'active'};
+      final c = await buildWithBuyers();
+      await c.start();
+      expect(c.state, isA<BuyerReady>());
+      expect(buyerBackend.asked, 1);
+    });
+
+    test('the switch was turned off since: Buying is turned off (R2), nobody is signed out', () async {
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 's1', 'role': 'staff', 'status': 'active'};
+      final c = await buildWithBuyers();
+      await c.start();
+      buyerBackend.answer = const BuyerStatus(canBuy: false, companyId: 'o1');
+      await c.retryStartup();
+      expect(c.state, isA<BuyingOff>());
+      expect(authBackend.signedOut, isFalse);
+      // Turned back on: TRY AGAIN lets them in.
+      buyerBackend.answer = const BuyerStatus(canBuy: true, companyId: 'o1');
+      await c.retryStartup();
+      expect(c.state, isA<BuyerReady>());
+    });
+
+    test('an office account never a buyer here: signed out, "no WorkMate access"', () async {
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 'a1', 'role': 'admin', 'status': 'active'};
+      buyerBackend.answer = const BuyerStatus(canBuy: false, companyId: 'a1');
+      final c = await buildWithBuyers();
+      await c.start();
+      expect((c.state as SignedOut).notice, LoginFailure.noWorkMateAccess);
+      expect(authBackend.signedOut, isTrue);
+    });
+
+    test('a deactivated buyer is told so and signed out', () async {
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 's1', 'role': 'staff', 'status': 'inactive'};
+      final c = await buildWithBuyers();
+      await c.start();
+      expect((c.state as SignedOut).notice, LoginFailure.accountInactive);
+      expect(buyerBackend.asked, 0);
+    });
+
+    test('first launch offline with nothing known: cannot be checked, never assumed', () async {
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 's1', 'role': 'staff', 'status': 'active'};
+      buyerBackend.offline = true;
+      final c = await buildWithBuyers();
+      await c.start();
+      expect(c.state, isA<BuyerUnavailable>());
+    });
+
+    test('a buying screen refused BUYER_REQUIRED: Buying is turned off at once', () async {
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 's1', 'role': 'staff', 'status': 'active'};
+      final c = await buildWithBuyers();
+      await c.start();
+      await c.buyingTurnedOff();
+      expect(c.state, isA<BuyingOff>());
+      buyerBackend.offline = true;
+      await c.retryStartup();
+      expect(c.state, isA<BuyingOff>(), reason: 'offline, the last answer (off) stands');
+    });
+
+    test('log out forgets the buyer: nothing about them outlives it', () async {
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 's1', 'role': 'staff', 'status': 'active'};
+      final c = await buildWithBuyers();
+      await c.start();
+      await c.signOut();
+      expect(c.state, isA<SignedOut>());
+      expect(buyers.companyOf('s1'), isNull);
+    });
+
+    test('workers are unaffected: the Terms gate still applies, the buyer check is never asked', () async {
+      authBackend
+        ..p = SessionPresence.confirmed
+        ..row = {'id': 'u1', 'role': 'worker', 'status': 'active'};
+      termsBackend.versions = {};
+      final c = await buildWithBuyers();
+      await c.start();
+      expect(c.state, isA<NeedsTerms>());
+      expect(buyerBackend.asked, 0);
+    });
+  });
 }
```

**Modify:** `test/auth/auth_repository_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/auth/auth_repository_test.dart b/test/auth/auth_repository_test.dart
index f0fce71..2770e1f 100644
--- a/test/auth/auth_repository_test.dart
+++ b/test/auth/auth_repository_test.dart
@@ -11,6 +11,7 @@ import 'package:workmate/auth/session_gate.dart';
 import 'package:workmate/auth/sign_in_api.dart';
 import 'package:workmate/auth/worker_cache.dart';
 import 'package:workmate/auth/worker_profile.dart';
+import 'package:workmate/auth/workmate_access.dart';
 
 class FakeBackend implements AuthBackend {
   SessionPresence presenceValue = SessionPresence.absent;
@@ -73,8 +74,9 @@ void main() {
 
     test('success adopts the session and remembers the worker for the first offline launch', () async {
       final repo = AuthRepository(api: apiReturning(200, okBody), backend: backend, cache: cache);
-      final w = await repo.signIn('juan@x.com', 'pw');
-      expect(w.id, 'u1');
+      final signedIn = await repo.signIn('juan@x.com', 'pw');
+      expect(signedIn.worker.id, 'u1');
+      expect(signedIn.access, WorkMateAccess.worker);
       expect(backend.adoptedRefresh, 'R');
       expect(cache.lastSignedInId, 'u1');
     });
```

**Modify:** `test/auth/login_failure_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/auth/login_failure_test.dart b/test/auth/login_failure_test.dart
index acc4c2d..9ea1750 100644
--- a/test/auth/login_failure_test.dart
+++ b/test/auth/login_failure_test.dart
@@ -12,6 +12,9 @@ void main() {
     expect(LoginFailure.forCode('NOT_A_WORKER'), LoginFailure.notAWorker);
     expect(LoginFailure.forCode('ACCOUNT_INACTIVE'), LoginFailure.accountInactive);
     expect(LoginFailure.forCode('TOO_MANY_ATTEMPTS'), LoginFailure.tooManyAttempts);
+    // 2A-3a R1: WorkMate's refusal of an account that is neither worker nor buyer.
+    expect(LoginFailure.forCode('NO_WORKMATE_ACCESS'), LoginFailure.noWorkMateAccess);
+    expect(LoginFailure.noWorkMateAccess.english, 'This account has no WorkMate access. Call the office.');
   });
 
   test('an unknown code is our problem, not the worker\'s password', () {
```

**Modify:** `test/auth/sign_in_api_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/auth/sign_in_api_test.dart b/test/auth/sign_in_api_test.dart
index ca3798b..02beff2 100644
--- a/test/auth/sign_in_api_test.dart
+++ b/test/auth/sign_in_api_test.dart
@@ -4,6 +4,7 @@ import 'package:flutter_test/flutter_test.dart';
 import 'package:http/http.dart' as http;
 import 'package:http/testing.dart';
 import 'package:workmate/auth/sign_in_api.dart';
+import 'package:workmate/auth/workmate_access.dart';
 
 void main() {
   test('posts to attendance-signin with the anon key and returns the session', () async {
@@ -24,6 +25,26 @@ void main() {
     expect(ok.accessToken, 'A');
     expect(ok.refreshToken, 'R');
     expect(ok.worker.id, 'u1');
+    // No `access` field (a function older than 0101): a worker.
+    expect(ok.access, WorkMateAccess.worker);
+  });
+
+  test('2A-3a: a buyer is let in as a buyer', () async {
+    final api = SignInApi(MockClient((_) async => http.Response(jsonEncode({
+          'session': {'access_token': 'A', 'refresh_token': 'R', 'expires_in': 3600, 'token_type': 'bearer'},
+          'worker': {'id': 's1', 'email': 'staff@x.com', 'role': 'staff', 'status': 'active'},
+          'access': 'buyer',
+        }), 200)));
+    final ok = await api.signIn('staff@x.com', 'pw') as SignInSuccess;
+    expect(ok.access, WorkMateAccess.buyer);
+    expect(ok.worker.role, 'staff');
+  });
+
+  test('2A-3a: an unknown access value is never a buyer', () {
+    expect(WorkMateAccess.parse('worker'), WorkMateAccess.worker);
+    expect(WorkMateAccess.parse('owner'), WorkMateAccess.worker);
+    expect(WorkMateAccess.parse(null), WorkMateAccess.worker);
+    expect(WorkMateAccess.parse('buyer'), WorkMateAccess.buyer);
   });
 
   test('a refusal carries the function\'s code', () async {
```

**Create:** `test/purchasing/buyer_access_test.dart`

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/purchasing/buyer_access.dart';

class FakeBuyerBackend implements BuyerAccessBackend {
  BuyerStatus answer = const BuyerStatus(canBuy: true, companyId: 'o1');
  bool offline = false;
  int asked = 0;

  @override
  Future<BuyerStatus> status(String userId) async {
    asked++;
    if (offline) throw const SocketException('down');
    return answer;
  }
}

void main() {
  late FakeBuyerBackend backend;
  late BuyerAccess access;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    backend = FakeBuyerBackend();
    access = BuyerAccess(backend: backend, prefs: await SharedPreferences.getInstance());
  });

  test('the company is the owner for staff, the account itself otherwise (data_owner_id)', () {
    expect(companyOf({'role': 'staff', 'owner_id': 'o1'}, 's1'), 'o1');
    expect(companyOf({'role': 'staff', 'owner_id': null}, 's1'), 's1');
    expect(companyOf({'role': 'owner', 'owner_id': null}, 'o1'), 'o1');
    expect(companyOf(null, 'x1'), 'x1');
  });

  test('online yes: may buy, and the answer and company are kept for offline', () async {
    expect(await access.decide('s1'), BuyerDecision.canBuy);
    expect(access.companyOf('s1'), 'o1');
    backend.offline = true;
    expect(await access.decide('s1'), BuyerDecision.canBuy);
  });

  test('online no, never a buyer on this phone: neverABuyer', () async {
    backend.answer = const BuyerStatus(canBuy: false, companyId: 'o1');
    expect(await access.decide('s1'), BuyerDecision.neverABuyer);
  });

  test('online no after being a buyer here: turnedOff, also offline afterwards (R2)', () async {
    expect(await access.decide('s1'), BuyerDecision.canBuy);
    backend.answer = const BuyerStatus(canBuy: false, companyId: 'o1');
    expect(await access.decide('s1'), BuyerDecision.turnedOff);
    backend.offline = true;
    expect(await access.decide('s1'), BuyerDecision.turnedOff);
  });

  test('turned back on: may buy again', () async {
    await access.letIn('s1');
    backend.answer = const BuyerStatus(canBuy: false, companyId: 'o1');
    expect(await access.decide('s1'), BuyerDecision.turnedOff);
    backend.answer = const BuyerStatus(canBuy: true, companyId: 'o1');
    expect(await access.decide('s1'), BuyerDecision.canBuy);
  });

  test('offline and never told: unknown, never assumed', () async {
    backend.offline = true;
    expect(await access.decide('s1'), BuyerDecision.unknown);
  });

  test('letIn (the sign-in said buyer) lets an offline launch in', () async {
    await access.letIn('s1');
    backend.offline = true;
    expect(await access.decide('s1'), BuyerDecision.canBuy);
  });

  test('markTurnedOff turns a known buyer off, and does nothing for an unknown one', () async {
    await access.markTurnedOff('x9');
    backend.offline = true;
    expect(await access.decide('x9'), BuyerDecision.unknown);
    await access.letIn('s1');
    await access.markTurnedOff('s1');
    expect(await access.decide('s1'), BuyerDecision.turnedOff);
  });

  test('forget leaves nothing behind', () async {
    expect(await access.decide('s1'), BuyerDecision.canBuy);
    await access.forget('s1');
    expect(access.companyOf('s1'), isNull);
    backend.offline = true;
    expect(await access.decide('s1'), BuyerDecision.unknown);
  });
}
```

**Create:** `test/purchasing/ui/buyer_screens_test.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/profile/account_services.dart';
import 'package:workmate/purchasing/ui/buyer_shell.dart';
import 'package:workmate/purchasing/ui/buying_off_screen.dart';
import 'package:workmate/ui/gate_unavailable_screen.dart';
import 'package:workmate/ui/theme.dart';

Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: w);

const staff = WorkerProfile(id: 's1', email: 'staff@dacsbuilding.com', displayName: 'Ana Reyes', role: 'staff', status: 'active');

final account = AccountServices(changePassword: (_) async {}, termsAcceptedAt: () async => null);

void main() {
  testWidgets('a buyer\'s Profile: Buyer, no worker ID, no Attendance Terms (Q23), Log out', (tester) async {
    var signedOut = 0;
    await tester.pumpWidget(wrap(BuyerShell(
      buyer: staff,
      versionName: '0.7.0',
      onSignOut: () async => signedOut++,
      account: account,
    )));
    expect(find.text('Ana Reyes'), findsOneWidget);
    expect(find.text('Buyer'), findsWidgets);
    expect(find.text('Worker ID'), findsNothing);
    expect(find.text('Terms & Conditions'), findsNothing);
    expect(find.text('Change password'), findsOneWidget);
    await tester.tap(find.text('Log out'));
    expect(signedOut, 1);
  });

  testWidgets('Buying is turned off: said in both languages, with TRY AGAIN and Log out (R2)', (tester) async {
    var retried = 0;
    await tester.pumpWidget(wrap(BuyingOffScreen(onRetry: () => retried++, onSignOut: () {}, unsent: 2)));
    expect(find.text('Buying is turned off for your account. Ask the owner if this is a mistake.'), findsOneWidget);
    expect(find.text('Naka-off ang pagbili sa account mo. Tanungin ang may-ari kung mali ito.'), findsOneWidget);
    expect(find.byKey(const Key('buying-off-unsent')), findsOneWidget);
    expect(find.textContaining('2 purchases not sent yet stay on this phone'), findsOneWidget);
    await tester.tap(find.text('TRY AGAIN'));
    expect(retried, 1);
  });

  testWidgets('with nothing unsent, no unsent line', (tester) async {
    await tester.pumpWidget(wrap(BuyingOffScreen(onRetry: () {}, onSignOut: () {})));
    expect(find.byKey(const Key('buying-off-unsent')), findsNothing);
  });

  testWidgets('the gate screen keeps its Terms words by default and takes the buying ones', (tester) async {
    await tester.pumpWidget(wrap(GateUnavailableScreen(onRetry: () {}, onSignOut: () {})));
    expect(find.text('Connect to the internet once so WorkMate can check your Terms.'), findsOneWidget);
    await tester.pumpWidget(wrap(GateUnavailableScreen(
      onRetry: () {},
      onSignOut: () {},
      title: 'Buying',
      english: 'Connect to the internet once so WorkMate can check your account.',
      tagalog: 'Kumonekta muna sa internet para ma-check ng WorkMate ang account mo.',
    )));
    expect(find.text('Buying'), findsOneWidget);
    expect(find.text('Connect to the internet once so WorkMate can check your account.'), findsOneWidget);
  });
}
```

<!-- Code -->

**Modify:** `lib/app.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/app.dart b/lib/app.dart
index b529f46..5c13bb0 100644
--- a/lib/app.dart
+++ b/lib/app.dart
@@ -4,6 +4,8 @@ import 'package:flutter/material.dart';
 import 'app_controller.dart';
 import 'attendance/attendance_services.dart';
 import 'profile/account_services.dart';
+import 'purchasing/ui/buyer_shell.dart';
+import 'purchasing/ui/buying_off_screen.dart';
 import 'requests/requests_services.dart';
 import 'ui/gate_unavailable_screen.dart';
 import 'ui/home_shell.dart';
@@ -135,6 +137,20 @@ class _WorkMateAppState extends State<WorkMateApp> with WidgetsBindingObserver {
                   requests: widget.requests,
                   workPlan: widget.workPlan,
                 ),
+              BuyerReady(:final worker) => BuyerShell(
+                  buyer: worker,
+                  versionName: widget.versionName,
+                  onSignOut: c.signOut,
+                  account: widget.account,
+                ),
+              BuyingOff() => BuyingOffScreen(onRetry: c.retryStartup, onSignOut: c.signOut),
+              BuyerUnavailable() => GateUnavailableScreen(
+                  onRetry: c.retryStartup,
+                  onSignOut: c.signOut,
+                  title: 'Buying',
+                  english: 'Connect to the internet once so WorkMate can check your account.',
+                  tagalog: 'Kumonekta muna sa internet para ma-check ng WorkMate ang account mo.',
+                ),
             };
             final update = c.requiredUpdate;
             return Stack(children: [
```

**Modify:** `lib/app_controller.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/app_controller.dart b/lib/app_controller.dart
index bafdd72..3a05395 100644
--- a/lib/app_controller.dart
+++ b/lib/app_controller.dart
@@ -5,6 +5,8 @@ import 'package:flutter/foundation.dart';
 import 'auth/auth_repository.dart';
 import 'auth/login_failure.dart';
 import 'auth/worker_profile.dart';
+import 'auth/workmate_access.dart';
+import 'purchasing/buyer_access.dart';
 import 'terms/terms_gates.dart';
 import 'terms/terms_repository.dart';
 import 'update/app_release.dart';
@@ -34,15 +36,46 @@ class Ready extends AppState {
   final WorkerProfile worker;
 }
 
+/// 2A-3b: an office account that may buy. Shopping list · My purchases ·
+/// Profile (Q2). Never the Attendance Terms (Q23), never attendance: every
+/// worker part of the app keys on [Ready] and so stays off.
+class BuyerReady extends AppState {
+  BuyerReady(this.worker);
+  final WorkerProfile worker;
+}
+
+/// 2A-3a R2: this phone knew the account as a buyer and the Buyer switch is
+/// now off. Unsent purchases stay on the phone.
+class BuyingOff extends AppState {
+  BuyingOff(this.worker);
+  final WorkerProfile worker;
+}
+
+/// First launch with no signal: whether the account may buy cannot be
+/// checked, and is never assumed.
+class BuyerUnavailable extends AppState {
+  BuyerUnavailable(this.worker);
+  final WorkerProfile worker;
+}
+
 /// Startup, sign-in, Terms and the required-update check.
 class AppController extends ChangeNotifier {
-  AppController({required this.auth, required this.terms, required this.updates, required Stream<void> nudges}) {
+  AppController({
+    required this.auth,
+    required this.terms,
+    required this.updates,
+    required Stream<void> nudges,
+    this.buyers,
+  }) {
     _nudgeSub = nudges.listen((_) => checkForUpdate());
   }
 
   final AuthRepository auth;
   final TermsRepository terms;
   final AppUpdateRepository updates;
+
+  /// 2A-3b. Null: an office account is turned away as before 0101.
+  final BuyerAccess? buyers;
   late final StreamSubscription<void> _nudgeSub;
 
   AppState _state = Starting();
@@ -66,7 +99,11 @@ class AppController extends ChangeNotifier {
     } catch (_) {
       // Never strand the worker on the spinner: a resolved worker gets the
       // screen with TRY AGAIN and Log out, otherwise the login screen.
-      _set(worker == null ? SignedOut() : TermsUnavailable(worker));
+      _set(worker == null
+          ? SignedOut()
+          : (!worker.isWorker && buyers != null)
+              ? BuyerUnavailable(worker)
+              : TermsUnavailable(worker));
     }
   }
 
@@ -75,7 +112,9 @@ class AppController extends ChangeNotifier {
     await start();
   }
 
-  Future<void> _afterWorker(WorkerProfile worker) async {
+  Future<void> _afterWorker(WorkerProfile worker, {WorkMateAccess access = WorkMateAccess.worker}) async {
+    final buyers = this.buyers;
+    if (!worker.isWorker && buyers != null) return _afterBuyer(worker, buyers, letIn: access == WorkMateAccess.buyer);
     // An account turned off since the last launch is told at the door.
     final eligibility = worker.eligibility();
     if (eligibility != Eligibility.allowed) {
@@ -93,12 +132,46 @@ class AppController extends ChangeNotifier {
     }
   }
 
+  /// An office account (2A-3a): the server's buying answer, or this phone's
+  /// last copy of it offline. Buyers skip the Attendance Terms (Q23).
+  Future<void> _afterBuyer(WorkerProfile worker, BuyerAccess buyers, {required bool letIn}) async {
+    if (!worker.isActive) {
+      await auth.signOut();
+      await buyers.forget(worker.id);
+      return _set(SignedOut(notice: LoginFailure.accountInactive));
+    }
+    // The function just let this account in as a buyer: a launch offline
+    // straight after still gets in.
+    if (letIn) await buyers.letIn(worker.id);
+    switch (await buyers.decide(worker.id)) {
+      case BuyerDecision.canBuy:
+        _set(BuyerReady(worker));
+      case BuyerDecision.turnedOff:
+        _set(BuyingOff(worker));
+      case BuyerDecision.neverABuyer:
+        await auth.signOut();
+        await buyers.forget(worker.id);
+        _set(SignedOut(notice: LoginFailure.noWorkMateAccess));
+      case BuyerDecision.unknown:
+        _set(BuyerUnavailable(worker));
+    }
+  }
+
+  /// A buying screen was refused BUYER_REQUIRED (R2): the switch went off
+  /// while the app was open. Nothing else changes; unsent purchases stay.
+  Future<void> buyingTurnedOff() async {
+    final s = _state;
+    if (s is! BuyerReady) return;
+    await buyers?.markTurnedOff(s.worker.id);
+    _set(BuyingOff(s.worker));
+  }
+
   /// Returns the failure to show, or null on success.
   Future<LoginFailure?> signIn(String email, String password) async {
     try {
-      final worker = await auth.signIn(email, password);
+      final signedIn = await auth.signIn(email, password);
       try {
-        await _afterWorker(worker);
+        await _afterWorker(signedIn.worker, access: signedIn.access);
       } catch (e) {
         return LoginFailure.of(e);
       }
@@ -123,9 +196,14 @@ class AppController extends ChangeNotifier {
   }
 
   Future<void> signOut() async {
+    final buyer = switch (_state) {
+      BuyerReady(:final worker) || BuyingOff(:final worker) || BuyerUnavailable(:final worker) => worker.id,
+      _ => null,
+    };
     // Immediate feedback, and whatever happens the worker ends signed out.
     _set(Starting());
     try {
+      if (buyer != null) await buyers?.forget(buyer);
       await auth.signOut();
     } catch (_) {
       // The local session is cleared first; a failure must not strand the UI.
```

**Modify:** `lib/auth/auth_repository.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/auth/auth_repository.dart b/lib/auth/auth_repository.dart
index 544367e..4a37ea2 100644
--- a/lib/auth/auth_repository.dart
+++ b/lib/auth/auth_repository.dart
@@ -4,6 +4,14 @@ import 'session_gate.dart';
 import 'sign_in_api.dart';
 import 'worker_cache.dart';
 import 'worker_profile.dart';
+import 'workmate_access.dart';
+
+/// Who signed in, and what `attendance-signin` let them in as.
+class SignedIn {
+  const SignedIn(this.worker, this.access);
+  final WorkerProfile worker;
+  final WorkMateAccess access;
+}
 
 class LoginRejected implements Exception {
   LoginRejected(this.failure);
@@ -20,8 +28,9 @@ class AuthRepository {
   final WorkerCache cache;
 
   /// The function checks credentials AND eligibility before any token
-  /// exists, so a success is always an active worker.
-  Future<WorkerProfile> signIn(String email, String password) async {
+  /// exists, so a success is always an active worker or (2A-3a) an account
+  /// that may buy.
+  Future<SignedIn> signIn(String email, String password) async {
     final trimmed = email.trim();
     if (trimmed.isEmpty || password.isEmpty) throw LoginRejected(LoginFailure.missingFields);
 
@@ -44,7 +53,7 @@ class AuthRepository {
         // Cached here: sign-in is the one moment there is surely signal, and
         // the FIRST offline launch needs this to not land on the login screen.
         await cache.remember(outcome.worker);
-        return outcome.worker;
+        return SignedIn(outcome.worker, outcome.access);
     }
   }
 
```

**Modify:** `lib/auth/login_failure.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/auth/login_failure.dart b/lib/auth/login_failure.dart
index c6f7353..d4cbcf3 100644
--- a/lib/auth/login_failure.dart
+++ b/lib/auth/login_failure.dart
@@ -11,6 +11,10 @@ enum LoginFailure {
   wrongCredentials('That email and password do not match.', 'Hindi tugma ang email at password.'),
   accountInactive('This account is turned off. Call the office.', 'Naka-off ang account na ito. Tawagan ang opisina.'),
   notAWorker('This is not a worker account.', 'Hindi ito worker account.'),
+
+  /// 2A-3a R1: WorkMate refuses an account that is neither a worker nor a buyer.
+  noWorkMateAccess('This account has no WorkMate access. Call the office.',
+      'Walang WorkMate access ang account na ito. Tawagan ang opisina.'),
   tooManyAttempts('Too many tries. Wait a minute, then try again.', 'Sobrang dami nang subok. Maghintay ng isang minuto.'),
   noConnection('No signal right now. Try again in a moment.', 'Walang signal ngayon. Subukan ulit mamaya.'),
   serverProblem('Something went wrong. Try again.', 'May nasira. Subukan ulit.');
@@ -24,6 +28,7 @@ enum LoginFailure {
   static LoginFailure forCode(String? code) => switch (code) {
         'INVALID_CREDENTIALS' => wrongCredentials,
         'NOT_A_WORKER' => notAWorker,
+        'NO_WORKMATE_ACCESS' => noWorkMateAccess,
         'ACCOUNT_INACTIVE' => accountInactive,
         'TOO_MANY_ATTEMPTS' => tooManyAttempts,
         // An unknown code means the function and the app drifted apart.
```

**Modify:** `lib/auth/sign_in_api.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/auth/sign_in_api.dart b/lib/auth/sign_in_api.dart
index ab38d6d..9125337 100644
--- a/lib/auth/sign_in_api.dart
+++ b/lib/auth/sign_in_api.dart
@@ -4,14 +4,23 @@ import 'package:http/http.dart' as http;
 
 import '../config/app_config.dart';
 import 'worker_profile.dart';
+import 'workmate_access.dart';
 
 sealed class SignInOutcome {}
 
 class SignInSuccess extends SignInOutcome {
-  SignInSuccess({required this.accessToken, required this.refreshToken, required this.worker});
+  SignInSuccess({
+    required this.accessToken,
+    required this.refreshToken,
+    required this.worker,
+    this.access = WorkMateAccess.worker,
+  });
   final String accessToken;
   final String refreshToken;
   final WorkerProfile worker;
+
+  /// What the function let this account in as (2A-3a R1).
+  final WorkMateAccess access;
 }
 
 class SignInRefused extends SignInOutcome {
@@ -48,6 +57,7 @@ class SignInApi {
         accessToken: session['access_token'] as String,
         refreshToken: session['refresh_token'] as String,
         worker: WorkerProfile.fromRow(body['worker'] as Map<String, dynamic>),
+        access: WorkMateAccess.parse(body['access']),
       );
     }
     // A body we cannot parse is still a refusal, never a network problem.
```

**Modify:** `lib/auth/worker_profile.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/auth/worker_profile.dart b/lib/auth/worker_profile.dart
index e87c416..e30f693 100644
--- a/lib/auth/worker_profile.dart
+++ b/lib/auth/worker_profile.dart
@@ -81,4 +81,10 @@ class WorkerProfile {
       ].join(' · ');
 
   Eligibility eligibility() => eligibilityOf(role, status);
+
+  /// A worker or team leader; anyone else in WorkMate is a buyer (2A-3a).
+  bool get isWorker => _workerRoles.contains(role);
+
+  /// SQL's coalesce(status, 'active').
+  bool get isActive => (status ?? 'active') == 'active';
 }
```

**Create:** `lib/auth/workmate_access.dart`

```dart
/// What `attendance-signin` let an account into WorkMate as (2A-3a, R1).
/// Workers and team leaders are `worker`; an office account the server's
/// pur_buyer() rule allows to buy is `buyer`.
enum WorkMateAccess {
  worker,
  buyer;

  /// The function's `access` field. An answer without one comes from a
  /// function older than 0101, which only ever let workers in.
  static WorkMateAccess parse(Object? value) => value == 'buyer' ? buyer : worker;
}
```

**Modify:** `lib/main.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/main.dart b/lib/main.dart
index 4b53f81..935c04a 100644
--- a/lib/main.dart
+++ b/lib/main.dart
@@ -37,6 +37,7 @@ import 'net/supabase_setup.dart';
 import 'net/update_nudges.dart';
 import 'net/workmate_http_client.dart';
 import 'profile/account_services.dart';
+import 'purchasing/buyer_access.dart';
 import 'requests/data/request_remote.dart';
 import 'requests/data/request_repository.dart';
 import 'requests/data/requests_db.dart';
@@ -137,7 +138,9 @@ Future<void> main() async {
   letInWorker = attendance.currentWorkerId;
   final auth = AuthRepository(api: SignInApi(httpClient), backend: SupabaseAuthBackend(client, sessionStorage), cache: cache);
   final terms = TermsRepository(backend: SupabaseTermsBackend(client), cache: cache, userAgent: userAgent);
-  controller = AppController(auth: auth, terms: terms, updates: updates, nudges: nudges.events);
+  // 2A-3b: office accounts that may buy (the server's pur_buyer() rule).
+  final buyers = BuyerAccess(backend: SupabaseBuyerAccessBackend(client), prefs: prefs);
+  controller = AppController(auth: auth, terms: terms, updates: updates, nudges: nudges.events, buyers: buyers);
   // The home-screen widget follows every change to today, and every sign-in / sign-out.
   Future<void> publishWidget() => widgets.publish(attendance.db, attendance.currentWorkerId());
   final widgetSync = WidgetAppSync(publishWidget);
```

**Modify:** `lib/profile/profile_screen.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/profile/profile_screen.dart b/lib/profile/profile_screen.dart
index c27be75..54fa76f 100644
--- a/lib/profile/profile_screen.dart
+++ b/lib/profile/profile_screen.dart
@@ -10,7 +10,8 @@ import 'account_services.dart';
 import 'change_password_sheet.dart';
 
 /// Profile: who is signed in, the password, the Terms they accepted, Log out.
-/// Ported from DACS Attendance's ProfileScreen.
+/// Ported from DACS Attendance's ProfileScreen. A buyer (2A-3b) has no
+/// worker ID and accepted no Attendance Terms (Q23): neither row is shown.
 class ProfileScreen extends StatefulWidget {
   const ProfileScreen({
     super.key,
@@ -18,12 +19,14 @@ class ProfileScreen extends StatefulWidget {
     required this.versionName,
     required this.onSignOut,
     required this.account,
+    this.buyer = false,
   });
 
   final WorkerProfile worker;
   final String versionName;
   final Future<void> Function() onSignOut;
   final AccountServices account;
+  final bool buyer;
 
   @override
   State<ProfileScreen> createState() => _ProfileScreenState();
@@ -35,7 +38,7 @@ class _ProfileScreenState extends State<ProfileScreen> {
   @override
   void initState() {
     super.initState();
-    _loadAcceptedAt();
+    if (!widget.buyer) _loadAcceptedAt();
   }
 
   Future<void> _loadAcceptedAt() async {
@@ -69,14 +72,15 @@ class _ProfileScreenState extends State<ProfileScreen> {
     return ListView(padding: const EdgeInsets.all(20), children: [
       const Text('Profile', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
       const SizedBox(height: 16),
-      WorkerHeader(worker: w),
+      WorkerHeader(worker: w, subtitle: widget.buyer ? 'Buyer' : null),
       const SizedBox(height: 10),
       const Align(alignment: Alignment.centerLeft, child: StatusPill.green('Active account')),
       const SizedBox(height: 18),
       _Card(children: [
         _InfoRow(label: 'Email', value: w.email ?? '--'),
-        _InfoRow(label: 'Position', value: position == null || position.isEmpty ? '--' : position),
-        _InfoRow(label: 'Worker ID', value: w.workerIdLabel),
+        if (widget.buyer) const _InfoRow(label: 'Role', value: 'Buyer'),
+        if (!widget.buyer) _InfoRow(label: 'Position', value: position == null || position.isEmpty ? '--' : position),
+        if (!widget.buyer) _InfoRow(label: 'Worker ID', value: w.workerIdLabel),
       ]),
       const SizedBox(height: 14),
       _Card(children: [
@@ -87,13 +91,14 @@ class _ProfileScreenState extends State<ProfileScreen> {
           subtitle: 'Update your login',
           onTap: _changePassword,
         ),
-        _ActionRow(
-          key: const Key('profile-terms'),
-          icon: Icons.description_outlined,
-          title: 'Terms & Conditions',
-          subtitle: at == null ? 'Read the terms you accepted' : 'Accepted ${shortDate(at)}',
-          onTap: _openTerms,
-        ),
+        if (!widget.buyer)
+          _ActionRow(
+            key: const Key('profile-terms'),
+            icon: Icons.description_outlined,
+            title: 'Terms & Conditions',
+            subtitle: at == null ? 'Read the terms you accepted' : 'Accepted ${shortDate(at)}',
+            onTap: _openTerms,
+          ),
       ]),
       const SizedBox(height: 24),
       OutlinedButton.icon(onPressed: widget.onSignOut, icon: const Icon(Icons.logout), label: const Text('Log out')),
```

**Create:** `lib/purchasing/buyer_access.dart`

```dart
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// What the server says about the signed-in office account: whether it may
/// buy (0097 `pur_me().can_buy`, the same rule as `pur_buyer()`) and the
/// company its purchases and receipts file under (`data_owner_id()`).
class BuyerStatus {
  const BuyerStatus({required this.canBuy, required this.companyId});
  final bool canBuy;
  final String companyId;
}

/// `data_owner_id()` (0002): a staff account files under its owner; every
/// other account under itself.
String companyOf(Map<String, dynamic>? profile, String userId) =>
    profile?['role'] == 'staff' ? ((profile?['owner_id'] as String?) ?? userId) : userId;

abstract class BuyerAccessBackend {
  /// Asked as the signed-in account. Throws when it cannot be asked (no
  /// signal, no session): never a guessed "cannot buy".
  Future<BuyerStatus> status(String userId);
}

class SupabaseBuyerAccessBackend implements BuyerAccessBackend {
  SupabaseBuyerAccessBackend(this._client);

  final SupabaseClient _client;

  @override
  Future<BuyerStatus> status(String userId) async {
    // Without a session pur_me would answer for nobody: can_buy false.
    if (_client.auth.currentSession == null) throw StateError('No session to check buying with');
    final me = Map<String, dynamic>.from(await _client.rpc('pur_me').timeout(const Duration(seconds: 15)) as Map);
    final row = await _client.from('profiles').select('id,role,owner_id').eq('id', userId).maybeSingle().timeout(const Duration(seconds: 15));
    return BuyerStatus(canBuy: me['can_buy'] == true, companyId: companyOf(row, userId));
  }
}

enum BuyerDecision {
  /// The Buyer switch is on (or, offline, was on the last time it was asked).
  canBuy,

  /// This phone knew the account as a buyer; the switch is now off (R2).
  turnedOff,

  /// The server says no, and this phone never knew the account as a buyer.
  neverABuyer,

  /// Offline, and this phone was never told. Never assumed either way.
  unknown,
}

/// Whether an office account may use WorkMate's buying screens, as the server
/// last said (Q1, R2). Kept per account on the phone so a buyer at a supplier
/// with no signal still gets in, exactly as workers' profiles are kept.
class BuyerAccess {
  BuyerAccess({required this.backend, required this.prefs});

  final BuyerAccessBackend backend;
  final SharedPreferences prefs;

  static String _key(String id) => 'buyer.$id';
  static String _companyKey(String id) => 'buyer_company.$id';

  /// Asks the server; falls back to what this phone was last told.
  Future<BuyerDecision> decide(String userId) async {
    final BuyerStatus status;
    try {
      status = await backend.status(userId);
    } catch (_) {
      return switch (prefs.getString(_key(userId))) {
        'on' => BuyerDecision.canBuy,
        'off' => BuyerDecision.turnedOff,
        _ => BuyerDecision.unknown,
      };
    }
    await prefs.setString(_companyKey(userId), status.companyId);
    if (status.canBuy) {
      await prefs.setString(_key(userId), 'on');
      return BuyerDecision.canBuy;
    }
    if (prefs.getString(_key(userId)) == null) return BuyerDecision.neverABuyer;
    await prefs.setString(_key(userId), 'off');
    return BuyerDecision.turnedOff;
  }

  /// The sign-in function itself just said "buyer".
  Future<void> letIn(String userId) => prefs.setString(_key(userId), 'on');

  /// A buying screen was refused BUYER_REQUIRED (R2).
  Future<void> markTurnedOff(String userId) async {
    if (prefs.getString(_key(userId)) != null) await prefs.setString(_key(userId), 'off');
  }

  /// The company this account's purchases file under, as last read; null
  /// until the server was asked once.
  String? companyOf(String userId) => prefs.getString(_companyKey(userId));

  /// Sign-out: nothing about a buyer outlives it (site phones are shared).
  Future<void> forget(String userId) async {
    await prefs.remove(_key(userId));
    await prefs.remove(_companyKey(userId));
  }
}
```

**Create:** `lib/purchasing/ui/buyer_shell.dart`

```dart
import 'package:flutter/material.dart';

import '../../auth/worker_profile.dart';
import '../../profile/account_services.dart';
import '../../profile/profile_screen.dart';

/// The signed-in app for a buyer (Q2): Shopping list · My purchases ·
/// Profile. No Time In, no worker Requests, no My Work.
class BuyerShell extends StatelessWidget {
  const BuyerShell({
    super.key,
    required this.buyer,
    required this.versionName,
    required this.onSignOut,
    required this.account,
  });

  final WorkerProfile buyer;
  final String versionName;
  final Future<void> Function() onSignOut;
  final AccountServices account;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: ProfileScreen(worker: buyer, versionName: versionName, onSignOut: onSignOut, account: account, buyer: true),
        ),
      );
}
```

**Create:** `lib/purchasing/ui/buying_off_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';

/// 2A-3a R2: the Buyer switch was turned off. No price screen is shown; the
/// phone's saved copy is wiped. Purchases not yet sent stay on the phone and
/// can still be sent if buying is turned on again.
class BuyingOffScreen extends StatelessWidget {
  const BuyingOffScreen({super.key, required this.onRetry, required this.onSignOut, this.unsent = 0});

  final VoidCallback onRetry;
  final VoidCallback onSignOut;

  /// Purchases waiting on this phone for this account.
  final int unsent;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Text('Buying', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
              const SizedBox(height: 16),
              const FailureNotice(
                english: 'Buying is turned off for your account. Ask the owner if this is a mistake.',
                tagalog: 'Naka-off ang pagbili sa account mo. Tanungin ang may-ari kung mali ito.',
              ),
              if (unsent > 0) ...[
                const SizedBox(height: 12),
                Text(
                  key: const Key('buying-off-unsent'),
                  '$unsent purchase${unsent == 1 ? '' : 's'} not sent yet stay on this phone. '
                  'They can be sent if buying is turned on again.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 14, color: WmColors.textSecondary),
                ),
              ],
              const SizedBox(height: 24),
              FilledButton(onPressed: onRetry, child: const Text('TRY AGAIN')),
              const SizedBox(height: 8),
              TextButton(onPressed: onSignOut, child: const Text('Log out')),
            ]),
          ),
        ),
      );
}
```

**Modify:** `lib/ui/gate_unavailable_screen.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/ui/gate_unavailable_screen.dart b/lib/ui/gate_unavailable_screen.dart
index 05ef549..ecd9006 100644
--- a/lib/ui/gate_unavailable_screen.dart
+++ b/lib/ui/gate_unavailable_screen.dart
@@ -3,11 +3,22 @@ import 'package:flutter/material.dart';
 import 'failure_notice.dart';
 
 /// First launch with no signal: the Terms acceptance cannot be checked and is
-/// never assumed. Accepting offline could not be written anywhere.
+/// never assumed. Accepting offline could not be written anywhere. Also used
+/// (2A-3b) when whether an office account may buy cannot be checked.
 class GateUnavailableScreen extends StatelessWidget {
-  const GateUnavailableScreen({super.key, required this.onRetry, required this.onSignOut});
+  const GateUnavailableScreen({
+    super.key,
+    required this.onRetry,
+    required this.onSignOut,
+    this.title = 'Terms & Conditions',
+    this.english = 'Connect to the internet once so WorkMate can check your Terms.',
+    this.tagalog = 'Kumonekta muna sa internet para ma-check ng WorkMate ang Terms mo.',
+  });
   final VoidCallback onRetry;
   final VoidCallback onSignOut;
+  final String title;
+  final String english;
+  final String tagalog;
 
   @override
   Widget build(BuildContext context) => Scaffold(
@@ -15,12 +26,9 @@ class GateUnavailableScreen extends StatelessWidget {
           child: Padding(
             padding: const EdgeInsets.all(24),
             child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
-              const Text('Terms & Conditions', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
+              Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
               const SizedBox(height: 16),
-              const FailureNotice(
-                english: 'Connect to the internet once so WorkMate can check your Terms.',
-                tagalog: 'Kumonekta muna sa internet para ma-check ng WorkMate ang Terms mo.',
-              ),
+              FailureNotice(english: english, tagalog: tagalog),
               const SizedBox(height: 24),
               FilledButton(onPressed: onRetry, child: const Text('TRY AGAIN')),
               const SizedBox(height: 8),
```

**Modify:** `lib/ui/worker_header.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/ui/worker_header.dart b/lib/ui/worker_header.dart
index b33935a..f1e0cb6 100644
--- a/lib/ui/worker_header.dart
+++ b/lib/ui/worker_header.dart
@@ -3,10 +3,12 @@ import 'package:flutter/material.dart';
 import '../auth/worker_profile.dart';
 import 'theme.dart';
 
-/// Who is signed in: initials, name, position and worker ID.
+/// Who is signed in: initials, name, position and worker ID ([subtitle]
+/// instead, for a buyer: an office account has no worker ID).
 class WorkerHeader extends StatelessWidget {
-  const WorkerHeader({super.key, required this.worker});
+  const WorkerHeader({super.key, required this.worker, this.subtitle});
   final WorkerProfile worker;
+  final String? subtitle;
 
   @override
   Widget build(BuildContext context) => Row(children: [
@@ -19,7 +21,7 @@ class WorkerHeader extends StatelessWidget {
         Expanded(
           child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
             Text(worker.displayName ?? worker.firstName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
-            Text(worker.positionAndId, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
+            Text(subtitle ?? worker.positionAndId, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
           ]),
         ),
       ]);
```


---

### Task 2: Purchasing data

Everything below the screens: the models, the purchase draft and its checks, the failure codes and their words, the phone's database, the server calls, the repository, the background sender, the account wipe, and the wiring in `main.dart`, `app.dart` and the background sync. No screen yet (the buying-off screen learns the unsent count).

**Files:**
- Create: `lib/purchasing/domain/pur_models.dart`, `domain/purchase_draft.dart`, `domain/pur_failure.dart`, `domain/pur_op.dart`, `data/purchasing_db.dart`, `data/purchasing_remote.dart`, `data/purchasing_api.dart`, `data/purchasing_repository.dart`, `data/purchasing_account_wipe.dart`, `sync/purchasing_sync.dart`, `purchasing_services.dart` (first version: api + changed; Task 4 adds the photo pickers)
- Modify: `lib/attendance/sync/background_sync.dart`, `lib/main.dart`, `lib/app.dart`
- Test: `test/purchasing/purchasing_fakes.dart`, `test/purchasing/purchasing_api_fake.dart`, `test/purchasing/domain/purchase_draft_test.dart`, `domain/pur_models_test.dart`, `data/purchasing_db_test.dart`, `data/purchasing_repository_test.dart`, `data/purchasing_account_wipe_test.dart`, `sync/purchasing_sync_test.dart`; modify `test/attendance/sync/background_sync_test.dart`

**Interfaces:**
- Consumes: `BuyerAccess.companyOf`, `AppController.buyingTurnedOff`, `BuyerReady` (Task 1).
- Produces (models): `PurBatch` (+ `static current(batches, now)`), `PurPortion`, `ShoppingLine` (+ `placeLabel`), `PurWork`, `PurDestination`, `Supplier` (+ `label`), `MyPurchase`, `PurchaseCharge`, `PurchaseLine`, `PurchaseChangeRequest`, `PurchaseDetail`, `const receiptSlots`.
- Produces (draft): `double? parseMoney(String)`, `round2`, `round3`, `List<double> prorate(double total, List<double> weights)`, `enum LineMatch { same, otherWords, substitute }`, `PortionPick`, `DraftPurchaseLine` (+ `.fromShopping(key, ShoppingLine, List<PurPortion>)`, `countsDirectly`, `differentUnit`, `pickedStill`, `extraQuantity`, `copyWith`), `DraftCharge`, `const paymentMethods`, `PurchaseDraft` (+ `computedTotal`, `copyWith`), `enum ProblemKind`, `PurchaseProblem(kind, {line, charge})`, `List<PurchaseProblem> purchaseProblems(PurchaseDraft)`, `Map<String,dynamic> purchaseBody(PurchaseDraft, {docs})`.
- Produces (failures): `enum PurFailure` (+ `of`, `fromStored`, `retryable`, `countsTowardCap`), `const maxPurchaseAttempts = 10`, `PurFailureException`, `Bilingual purFailureCopy(PurFailure)`.
- Produces (queue): `ReceiptUpload`, `PurOp` (+ `bodyJson`, `copyWith`), `String receiptPath({companyId, manilaNow, photoId})`.
- Produces (data): `PurchasingDb.open(factory, path, {singleInstance})`, `openDevicePurchasingDb()`; `abstract class PurchasingRemote` + `SupabasePurchasingRemote`; view types `ShoppingView`, `PurchaseChoices`, `QueuedState { waiting, needsAttention }`, `QueuedPurchase`, `MyPurchasesView`, `PurchaseInvalid`, `CorrectionOutcome { saved, needsOwner }`, `CorrectionResult`; `abstract interface class PurchasingApi` (see its file); `PurchasingRepository implements PurchasingApi`; `PurchasingAccountWipe(PurchasingApi)` with `onAppState`; `PurchasingSync({db, remote, now})` with `drain(userId)` and `settled`; `PurchasingServices({api, changed})`.
- Produces (sync): `syncWith(..., onPurchasesSettled)`, `drainInOrder(..., purchases, onPurchasesSettled)`.

- [ ] **Step 1: Write the failing tests** (*Tests* blocks).
- [ ] **Step 2: Run them; they fail to compile.**

Run: `flutter test test/purchasing test/attendance/sync/background_sync_test.dart`
Expected: compilation errors (`package:workmate/purchasing/domain/pur_models.dart` not found, …).

- [ ] **Step 3: Write the code** (*Code* blocks).
- [ ] **Step 4: Run the whole suite and the analyzer.**

Run: `flutter test` → **771 passed**. `flutter analyze` → `No issues found!`

- [ ] **Step 5: The user commits** (`2A-3b Task 2: purchasing data, queue and sync`).

<!-- Tests -->

**Modify:** `test/attendance/sync/background_sync_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/attendance/sync/background_sync_test.dart b/test/attendance/sync/background_sync_test.dart
index 52dede2..cffb416 100644
--- a/test/attendance/sync/background_sync_test.dart
+++ b/test/attendance/sync/background_sync_test.dart
@@ -125,6 +125,40 @@ void main() {
       expect(failed, isFalse, reason: 'WorkManager comes back for My Work');
     });
 
+    test('2A-3b: purchases drain after My Work; their failure only asks WorkManager to come back', () async {
+      final log = <String>[];
+      final ok = await drainInOrder(
+        attendance: () async => (result: SyncResult.done, settled: 0),
+        requests: () async => (result: SyncResult.done, settled: 0),
+        workPlan: () async {
+          log.add('workPlan');
+          return (result: SyncResult.done, settled: 0);
+        },
+        purchases: () async {
+          log.add('purchases');
+          return (result: SyncResult.done, settled: 1);
+        },
+        attendanceWaiting: () async => false,
+        onPurchasesSettled: () => log.add('onPurchasesSettled'),
+      );
+      expect(ok, isTrue);
+      expect(log, ['workPlan', 'purchases', 'onPurchasesSettled']);
+      final failed = await drainInOrder(
+        attendance: () async => (result: SyncResult.done, settled: 1),
+        requests: () async => (result: SyncResult.done, settled: 0),
+        purchases: () async => throw StateError('purchasing db broken'),
+        attendanceWaiting: () async => false,
+      );
+      expect(failed, isFalse, reason: 'WorkManager comes back for the purchases');
+      final retry = await drainInOrder(
+        attendance: () async => (result: SyncResult.done, settled: 0),
+        requests: () async => (result: SyncResult.done, settled: 0),
+        purchases: () async => (result: SyncResult.retry, settled: 0),
+        attendanceWaiting: () async => false,
+      );
+      expect(retry, isFalse);
+    });
+
     test('a failing screen notice changes nothing', () async {
       final result = await drainInOrder(
         attendance: () async => (result: SyncResult.done, settled: 1),
```

**Create:** `test/purchasing/data/purchasing_account_wipe_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/app_controller.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/purchasing/data/purchasing_account_wipe.dart';

import '../purchasing_api_fake.dart';

void main() {
  const s1 = WorkerProfile(id: 's1', role: 'staff');
  const s2 = WorkerProfile(id: 's2', role: 'staff');
  const w1 = WorkerProfile(id: 'w1', role: 'worker');

  test('a buyer keeps only their saved copy; signed out, a worker or buying off keeps none', () {
    final api = FakePurchasingApi();
    final wipe = PurchasingAccountWipe(api);
    wipe.onAppState(Starting());
    expect(api.calls, isEmpty, reason: 'startup decides nothing');
    wipe.onAppState(BuyerReady(s1));
    wipe.onAppState(BuyerReady(s1));
    expect(api.calls, ['keepOnly:s1'], reason: 'once per change');
    wipe.onAppState(BuyingOff(s1));
    expect(api.calls.last, 'keepOnly:', reason: 'R2: no prices once buying is off');
    wipe.onAppState(BuyerReady(s2));
    expect(api.calls.last, 'keepOnly:s2');
    wipe.onAppState(Ready(w1));
    expect(api.calls.last, 'keepOnly:', reason: 'a worker on the same phone sees no prices');
    wipe.onAppState(BuyerUnavailable(s1));
    wipe.onAppState(NeedsTerms(w1));
    expect(api.calls, ['keepOnly:s1', 'keepOnly:', 'keepOnly:s2', 'keepOnly:'], reason: 'gates decide nothing');
  });

  test('a failed wipe is tried again on the next state', () async {
    final api = FakePurchasingApi()..keepError = Exception('disk');
    final wipe = PurchasingAccountWipe(api);
    wipe.onAppState(BuyerReady(s1));
    await Future<void>.delayed(Duration.zero);
    api.keepError = null;
    wipe.onAppState(BuyerReady(s1));
    expect(api.calls, ['keepOnly:s1', 'keepOnly:s1']);
  });
}
```

**Create:** `test/purchasing/data/purchasing_db_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/purchasing/data/purchasing_db.dart';
import 'package:workmate/purchasing/domain/pur_op.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';

PurchaseDraft d(String id) => PurchaseDraft(id: id, createdAt: DateTime.utc(2026, 10, 21), purchaseDate: '2026-10-21');

PurOp op(String id, String draftId, {String user = 'u1'}) =>
    PurOp(opId: id, userId: user, createdAt: DateTime.utc(2026, 10, 21), draftId: draftId, purchase: const {'source': 'workmate'});

void main() {
  late PurchasingDb db;
  final now = DateTime.utc(2026, 10, 21, 3);

  setUpAll(sqfliteFfiInit);
  setUp(() async => db = await PurchasingDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false));
  tearDown(() => db.close());

  test('a draft is kept per account', () async {
    await db.saveDraft('u1', d('d1'), now);
    await db.saveDraft('u2', d('d2'), now);
    expect((await db.drafts('u1', queued: false)).map((x) => x.id), ['d1']);
    expect(await db.draft('u2', 'd1'), isNull);
  });

  test('a purchase is queued once: a second Send records nothing more', () async {
    expect(await db.queueDraft('u1', d('d1'), op('o1', 'd1'), now), isTrue);
    expect(await db.queueDraft('u1', d('d1'), op('o2', 'd1'), now), isFalse);
    expect((await db.sendable('u1')).map((o) => o.opId), ['o1']);
    // A queued draft can no longer be edited by a stray save.
    await db.saveDraft('u1', d('d1'), now);
    expect(await db.drafts('u1', queued: false), isEmpty);
  });

  test('back to editing only once refused; never while it could still be sent', () async {
    await db.queueDraft('u1', d('d1'), op('o1', 'd1'), now);
    expect(await db.unqueueDraft('u1', 'd1'), isFalse);
    await db.markFailed('o1', 'lineClosed');
    expect(await db.unqueueDraft('u1', 'd1'), isTrue);
    expect((await db.drafts('u1', queued: false)).map((x) => x.id), ['d1']);
    expect(await db.ops('u1'), isEmpty);
  });

  test('throwing a refused purchase away takes its op and draft; a sendable one stays', () async {
    await db.queueDraft('u1', d('d1'), op('o1', 'd1'), now);
    expect(await db.discardRefused('u1', 'd1'), isNull);
    await db.markFailed('o1', 'lineClosed');
    expect((await db.discardRefused('u1', 'd1'))!.id, 'd1');
    expect(await db.unsentCount('u1'), 0);
  });

  test('recorded: op and draft go together', () async {
    await db.queueDraft('u1', d('d1'), op('o1', 'd1'), now);
    await db.finishRecord('o1', 'd1');
    expect(await db.ops('u1'), isEmpty);
    expect(await db.drafts('u1', queued: true), isEmpty);
  });

  test('progress is kept between attempts', () async {
    await db.queueDraft('u1', d('d1'), op('o1', 'd1'), now);
    final o = (await db.sendable('u1')).single
        .copyWith(companyId: 'c1', receipts: {'supplier_invoice_url': const ReceiptUpload(local: '/a.jpg', photoId: 'x', url: 'https://u')});
    await db.updateOpBody('o1', o.bodyJson);
    final back = (await db.sendable('u1')).single;
    expect(back.companyId, 'c1');
    expect(back.receipts['supplier_invoice_url']!.url, 'https://u');
  });

  test('only unexpected failures count toward giving up', () async {
    await db.queueDraft('u1', d('d1'), op('o1', 'd1'), now);
    await db.recordAttempt('o1', 'unexpected');
    await db.recordAttempt('o1', 'unexpected');
    expect((await db.sendable('u1')).single.attempts, 2);
    await db.recordAttempt('o1', 'noConnection', countsTowardCap: false);
    expect((await db.sendable('u1')).single.attempts, 0);
  });

  test('unsent counts drafts being edited, waiting or refused', () async {
    await db.saveDraft('u1', d('d1'), now);
    await db.queueDraft('u1', d('d2'), op('o2', 'd2'), now);
    expect(await db.unsentCount('u1'), 2);
    expect(await db.unsentCount('u2'), 0);
    expect(await db.hasAnySendable(), isTrue);
  });

  test('the saved copy keeps only one account; drafts are never touched', () async {
    await db.putCache('u1', 'shopping', const [1], now);
    await db.putCache('u2', 'shopping', const [2], now);
    await db.saveDraft('u2', d('d2'), now);
    await db.keepCacheOnly('u1');
    expect(await db.cache('u2', 'shopping'), isNull);
    expect((await db.cache('u1', 'shopping'))!.body, [1]);
    await db.keepCacheOnly('');
    expect(await db.cache('u1', 'shopping'), isNull);
    expect(await db.unsentCount('u2'), 1);
  });
}
```

**Create:** `test/purchasing/data/purchasing_repository_test.dart`

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/purchasing/data/purchasing_api.dart';
import 'package:workmate/purchasing/data/purchasing_db.dart';
import 'package:workmate/purchasing/data/purchasing_repository.dart';
import 'package:workmate/purchasing/domain/pur_failure.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';
import 'package:workmate/purchasing/sync/purchasing_sync.dart';

import '../../attendance/fakes.dart';
import '../domain/purchase_draft_test.dart' show linked, unplanned;
import '../purchasing_fakes.dart';

void main() {
  late PurchasingDb db;
  late FakePurchasingRemote remote;
  late Directory dir;
  late PurchasingRepository repo;
  var user = 'u1';
  String? company = 'o1';
  var ids = 0;
  var kicks = 0;
  var turnedOff = 0;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await PurchasingDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    remote = FakePurchasingRemote();
    dir = await Directory.systemTemp.createTemp('pur-repo');
    user = 'u1';
    company = 'o1';
    ids = 0;
    kicks = 0;
    turnedOff = 0;
    repo = PurchasingRepository(
      db: db,
      remote: remote,
      device: FakeDevice(),
      scheduler: FakeScheduler(),
      currentUserId: () => user,
      companyOf: (_) => company,
      photoDir: () async => dir,
      sendNow: () async => kicks++,
      onBuyingOff: () async => turnedOff++,
      now: () => wednesday,
      newId: () => 'id${++ids}',
    );
  });
  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  Future<String> photo(String name) async {
    final f = File('${dir.path}/$name');
    await f.writeAsBytes([1, 2, 3]);
    return f.path;
  }

  Future<PurchaseDraft> ready() async =>
      repo.newDraft(lines: [unplanned()]).copyWith(receiptTotal: '500', photos: {'supplier_invoice_url': await photo('r.jpg')});

  group('the shopping list', () {
    test('is saved, and served from the saved copy with no signal', () async {
      final fresh = await repo.shoppingList();
      expect(fresh.fromCache, isFalse);
      expect(fresh.lines.single.description, 'Cement');
      expect(fresh.batches.map((b) => b.id), ['b1', 'b2']);
      remote.readError = const SocketException('down');
      final cached = await repo.shoppingList();
      expect(cached.fromCache, isTrue);
      expect(cached.lines.single.lineId, 'l1');
      expect(cached.error, isA<SocketException>());
    });

    test('with no signal and nothing saved: an empty list that says why', () async {
      remote.readError = const SocketException('down');
      final v = await repo.shoppingList();
      expect(v.lines, isEmpty);
      expect(v.error, isNotNull);
    });

    test('BUYER_REQUIRED wipes the saved copy and tells the app (R2)', () async {
      await repo.shoppingList();
      remote.readError = refusal('BUYER_REQUIRED');
      await expectLater(repo.shoppingList(), throwsA(isA<Object>()));
      expect(turnedOff, 1);
      expect(await db.cache('u1', 'shopping'), isNull);
    });
  });

  group('claim, release, Mark arranged (online, Q5 Q6)', () {
    test('claim all, or part; release mine', () async {
      await repo.claim(portion('p1'));
      await repo.claim(portion('p1'), quantity: 4);
      await repo.release(portion('p1', buyer: 'u1', mine: true));
      expect(remote.calls, ['assign:p1:u1:null', 'assign:p1:u1:4.0', 'assign:p1:null:null']);
    });

    test('Mark arranged only on my own portions (Q6)', () async {
      await repo.setArranged(portion('p1', buyer: 'u1', mine: true), true);
      expect(remote.calls, ['arranged:p1:true']);
      expect(() => repo.setArranged(portion('p2', buyer: 'u9'), true),
          throwsA(isA<PurFailureException>().having((e) => e.failure, 'failure', PurFailure.notYourPortion)));
    });

    test('a refusal reaches the screen', () async {
      remote.writeError = refusal('ASSIGNED_TO_OTHER');
      expect(() => repo.claim(portion('p1')), throwsA(predicate((e) => PurFailure.of(e!) == PurFailure.assignedToOther)));
    });

    test('nobody signed in: nothing is sent', () async {
      user = '';
      expect(() => repo.claim(portion('p1')), throwsA(isA<StateError>()));
      expect(remote.calls, isEmpty);
    });
  });

  group('recording', () {
    test('a new purchase is dated in Manila, never by the phone\'s UTC date', () {
      final late = PurchasingRepository(
        db: db,
        remote: remote,
        device: FakeDevice(),
        scheduler: FakeScheduler(),
        currentUserId: () => user,
        companyOf: (_) => company,
        photoDir: () async => dir,
        now: () => DateTime.utc(2026, 10, 21, 17),
      );
      expect(late.newDraft().purchaseDate, '2026-10-22');
    });

    test('a draft with problems is not queued', () async {
      final d = repo.newDraft(lines: [unplanned()]);
      await expectLater(repo.send(d), throwsA(isA<PurchaseInvalid>()));
      expect(await db.sendable('u1'), isEmpty);
    });

    test('Send queues once and starts sending; a double tap queues nothing more', () async {
      final d = await ready();
      await repo.send(d);
      await repo.send(d);
      expect((await db.sendable('u1')).length, 1);
      expect(kicks, 1);
      final op = (await db.sendable('u1')).single;
      expect(op.companyId, 'o1');
      expect(op.receipts.keys, ['supplier_invoice_url']);
      expect(op.purchase['source'], 'workmate');
    });

    test('"No receipt" sends no photo', () async {
      final d = (await ready()).copyWith(noReceipt: true, noReceiptReason: 'Store gave none');
      await repo.send(d);
      expect((await db.sendable('u1')).single.receipts, isEmpty);
    });

    test('deleting a draft deletes its photos', () async {
      final d = await ready();
      await repo.saveDraft(d);
      await repo.deleteDraft(d);
      expect(File(d.photos.values.single).existsSync(), isFalse);
      expect(await repo.drafts(), isEmpty);
    });
  });

  group('My purchases (Q12)', () {
    test('what is still on the phone, then the server\'s list (saved for offline)', () async {
      remote.mine = [
        {'id': 'pu1', 'status': 'recorded', 'receipt_total': 500, 'projects': ['Barlin Residence']},
      ];
      await repo.send(await ready());
      final v = await repo.myPurchases();
      expect(v.queued.single.state, QueuedState.waiting);
      expect(v.purchases.single.id, 'pu1');
      remote.readError = const SocketException('down');
      final offline = await repo.myPurchases();
      expect(offline.fromCache, isTrue);
      expect(offline.purchases.single.id, 'pu1');
    });

    test('a refused purchase shows why and can go back to editing (Q7)', () async {
      await repo.send(await ready());
      remote.writeError = refusal('LINE_CLOSED');
      await PurchasingSync(db: db, remote: remote, now: () => wednesday).drain('u1');
      final v = await repo.myPurchases();
      expect(v.queued.single.state, QueuedState.needsAttention);
      expect(v.queued.single.failure, PurFailure.lineClosed);
      expect(await repo.returnToDrafts(v.queued.single.draft.id), isTrue);
      expect((await repo.drafts()).single.id, v.queued.single.draft.id);
    });

    test('a refused purchase thrown away takes its photos', () async {
      final d = await ready();
      await repo.send(d);
      remote.writeError = refusal('LINE_CLOSED');
      await PurchasingSync(db: db, remote: remote, now: () => wednesday).drain('u1');
      await repo.discardRefused(d.id);
      expect((await repo.myPurchases()).queued, isEmpty);
      expect(File(d.photos.values.single).existsSync(), isFalse);
    });
  });

  group('corrections (Q13)', () {
    final p = PurchaseDetail.fromJson(const {'id': 'pu1', 'status': 'recorded'});

    test('new photos are uploaded first, then the correction goes with their links', () async {
      final r = await repo.correct(p, {'lines': []}, 'Wrong price', opId: 'op1', newPhotos: {'payment_receipt_url': await photo('n.jpg')});
      expect(r.outcome, CorrectionOutcome.saved);
      expect(remote.uploads.single, startsWith('purchases/o1/2026-10/'));
      expect(remote.calls.last, 'correct:op1:pu1:Wrong price');
      expect((r.body['docs'] as Map).keys, ['payment_receipt_url']);
    });

    test('only the owner may: nothing changes, and the same body can go to the owner', () async {
      remote.writeError = refusal('COMPLETED_PROJECT');
      final r = await repo.correct(p, {'lines': []}, 'Wrong price', opId: 'op1');
      expect(r.outcome, CorrectionOutcome.needsOwner);
      await repo.sendToOwner(p, r.body, 'Wrong price', opId: 'op2');
      expect(remote.calls.last, 'owner:op2:pu1:Wrong price');
    });

    test('the company is asked once when this phone does not know it', () async {
      company = null;
      await repo.correct(p, {'lines': []}, 'x', opId: 'op1', newPhotos: {'po_image_url': await photo('n.jpg')});
      expect(remote.calls, contains('company'));
    });
  });

  test('a receipt is read once per session', () async {
    await repo.receipt('https://x/a.jpg');
    await repo.receipt('https://x/a.jpg');
    expect(remote.calls.where((c) => c.startsWith('receipt:')).length, 1);
  });

  test('a linked line keeps its request through Send', () async {
    final d = repo.newDraft(lines: [linked()]).copyWith(receiptTotal: '500', photos: {'po_image_url': await photo('r.jpg')});
    await repo.send(d);
    final line = ((await db.sendable('u1')).single.purchase['lines'] as List).single as Map;
    expect(line['request_line_id'], 'l1');
  });
}
```

**Create:** `test/purchasing/domain/pur_models_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/domain/pur_failure.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/domain/pur_op.dart';

import '../purchasing_fakes.dart';

void main() {
  test('"this week" is the first batch whose cutoff is still ahead (the Purchasing tab\'s rule)', () {
    expect(PurBatch.current([nextWeek, thisWeek], wednesday)!.id, 'b1');
    expect(PurBatch.current([thisWeek, nextWeek], DateTime.utc(2026, 10, 24, 5))!.id, 'b2');
    expect(PurBatch.current([thisWeek], DateTime.utc(2026, 12)), isNull);
  });

  test('a shopping line reads numbers sent as numbers or numeric text', () {
    final l = ShoppingLine.fromJson({
      'line_id': 'l1',
      'request_id': 'r1',
      'description': 'Cement',
      'unit': 'bag',
      'project_name': 'Barlin Residence',
      'work_name': 'AW-02 Fence',
      'needed': '10.000',
      'bought': 4,
      'still_to_buy': 6,
      'portions': [
        {'id': 'p1', 'batch_id': 'b1', 'quantity': '6', 'still_to_buy': '6', 'buyer_id': null, 'mine': false, 'changed': true},
      ],
    });
    expect(l.needed, 10);
    expect(l.bought, 4);
    expect(l.placeLabel, 'Barlin Residence · AW-02 Fence');
    expect(l.portions.single.unassigned, isTrue);
    expect(l.portions.single.changed, isTrue);
    expect(ShoppingLine.fromJson(l.toJson()).toJson(), l.toJson());
  });

  test('the main contract shows the project alone', () {
    expect(cement().placeLabel, 'Barlin Residence');
  });

  test('a supplier reads as the server writes it on the purchase', () {
    expect(zzHardware.label, 'ZZ Hardware · Malolos');
    expect(const Supplier(id: 's', name: 'Wilcon').label, 'Wilcon');
  });

  test('a purchase keeps only the four receipt slots, and says what it waits for', () {
    final p = PurchaseDetail.fromJson({
      'id': 'pu1',
      'status': 'recorded',
      'receipt_total': '530.00',
      'docs': {'supplier_invoice_url': 'https://x/a.jpg', 'po_image_url': '', 'evil': 'javascript:x'},
      'lines': [
        {'line': 1, 'item_name': 'Cement', 'unit_check': 'pending', 'amount': '500'},
      ],
      'charges': [
        {'kind': 'delivery_fee', 'amount': 30, 'shares': [{'line': 1, 'amount': 30}]},
      ],
      'change_requests': [
        {'kind': 'correct', 'status': 'pending', 'reason': 'Wrong price'},
      ],
    });
    expect(p.receiptTotal, 530);
    expect(p.docs, {'supplier_invoice_url': 'https://x/a.jpg'});
    expect(p.needsOfficeCheck, isTrue);
    expect(p.waitingForOwner, isTrue);
    expect(p.charges.single.shares, {1: 30});
  });

  test('a receipt goes where 0097 lets a buyer put it, in Manila\'s month', () {
    expect(
      receiptPath(companyId: 'O1', manilaNow: DateTime.utc(2026, 11, 1, 1), photoId: 'AB'),
      'purchases/o1/2026-11/ab.jpg',
    );
  });

  group('failures', () {
    test('whole codes only: a longer code is never read as REASON_REQUIRED', () {
      expect(PurFailure.of(refusal('UNPLANNED_REASON_REQUIRED')), PurFailure.unplannedReasonRequired);
      expect(PurFailure.of(refusal('EXTRA_REASON_REQUIRED')), PurFailure.extraReasonRequired);
      expect(PurFailure.of(refusal('SUBSTITUTE_REASON_REQUIRED')), PurFailure.substituteReasonRequired);
      expect(PurFailure.of(refusal('REASON_REQUIRED')), PurFailure.reasonRequired);
    });

    test('the Buyer switch being off is one failure, whatever check found it (R2)', () {
      for (final code in ['BUYER_REQUIRED', 'NOT_OFFICE', 'NOT_ALLOWED', 'OFFICE_ONLY']) {
        expect(PurFailure.of(refusal(code)), PurFailure.buyingOff, reason: code);
      }
    });

    test('a refusal is never retried; signal, session and the unknown are', () {
      expect(PurFailure.of(refusal('LINE_CLOSED')).retryable, isFalse);
      expect(PurFailure.of(refusal('BUYER_REQUIRED')).retryable, isFalse);
      expect(PurFailure.of(StateError('AUTH_REQUIRED')), PurFailure.sessionExpired);
      expect(PurFailure.sessionExpired.retryable, isTrue);
      expect(PurFailure.of(Exception('weird')), PurFailure.unexpected);
      expect(PurFailure.unexpected.retryable, isTrue);
      expect(PurFailure.unexpected.countsTowardCap, isTrue);
      expect(PurFailure.noConnection.countsTowardCap, isFalse);
    });

    test('a stored name reads back; an unknown one is unexpected', () {
      expect(PurFailure.fromStored('lineClosed'), PurFailure.lineClosed);
      expect(PurFailure.fromStored('nope'), PurFailure.unexpected);
    });

    test('every failure has English and Tagalog copy (Q22)', () {
      for (final f in PurFailure.values) {
        final c = purFailureCopy(f);
        expect(c.english, isNotEmpty, reason: f.name);
        expect(c.tagalog, isNotEmpty, reason: f.name);
        expect(c.english, isNot(c.tagalog), reason: f.name);
      }
    });
  });
}
```

**Create:** `test/purchasing/domain/purchase_draft_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';

import '../purchasing_fakes.dart';

PurchaseDraft draft({
  List<DraftPurchaseLine>? lines,
  List<DraftCharge> charges = const [],
  String total = '500',
  Map<String, String> photos = const {'supplier_invoice_url': '/p/a.jpg'},
  bool noReceipt = false,
  String noReceiptReason = '',
}) =>
    PurchaseDraft(
      id: 'd1',
      createdAt: DateTime.utc(2026, 10, 21, 2),
      purchaseDate: '2026-10-21',
      supplierName: 'ZZ Hardware',
      receiptTotal: total,
      lines: lines ?? [unplanned()],
      charges: charges,
      photos: photos,
      noReceipt: noReceipt,
      noReceiptReason: noReceiptReason,
    );

DraftPurchaseLine unplanned({String amount = '500'}) => DraftPurchaseLine(
      key: 'k1',
      itemName: 'ZZ wire',
      quantity: '2',
      unit: 'roll',
      amount: amount,
      folderId: 'f1',
      folderLabel: 'Barlin Residence',
      unplannedReason: 'Site ran out',
    );

DraftPurchaseLine linked({String quantity = '10', String unit = 'bag', String amount = '500'}) =>
    DraftPurchaseLine.fromShopping('k2', cement(), [portion('p1', still: 10)]).copyWith(quantity: quantity, unit: unit, amount: amount);

void main() {
  group('money', () {
    test('two decimals at most, commas allowed while typing', () {
      expect(parseMoney('1,250.50'), 1250.5);
      expect(parseMoney('0'), 0);
      expect(parseMoney('12.345'), isNull);
      expect(parseMoney('-1'), isNull);
      expect(parseMoney(''), isNull);
    });

    test('the default split is the server\'s: centavos down, leftovers to the biggest remainders', () {
      expect(prorate(100, [1, 1, 1]), [33.34, 33.33, 33.33]);
      expect(prorate(10, [300, 100]), [7.5, 2.5]);
      expect(prorate(0.05, [1, 1]), [0.03, 0.02]);
      expect(prorate(10, [0, 0]), [5, 5]);
      for (final split in [prorate(99.99, [3, 7, 11]), prorate(1, [1, 1, 1, 1, 1, 1, 1])]) {
        expect(split.fold<double>(0, (a, b) => a + b), closeTo(split.length == 3 ? 99.99 : 1, 1e-9));
      }
    });
  });

  group('a line from the shopping list', () {
    test('takes the request\'s item, unit and place, and the Still to buy of the picked portions', () {
      final l = DraftPurchaseLine.fromShopping('k', cement(portions: [portion('p1', still: 4), portion('p2', still: 6)]),
          [portion('p1', still: 4), portion('p2', still: 6)]);
      expect(l.itemName, 'Cement');
      expect(l.unit, 'bag');
      expect(l.folderId, 'f1');
      expect(l.requestLineId, 'l1');
      expect(l.quantity, '10');
      expect(l.picks.map((p) => p.portionId), ['p1', 'p2']);
      expect(l.pickedStill, 10);
    });

    test('a portion with nothing left is not picked', () {
      final l = DraftPurchaseLine.fromShopping('k', cement(), [portion('p1', still: 0), portion('p2', still: 3)]);
      expect(l.picks.map((p) => p.portionId), ['p2']);
    });

    test('more than the picks still need is an extra; a different unit or a substitute never is', () {
      expect(linked(quantity: '12').extraQuantity, 2);
      expect(linked(quantity: '10').extraQuantity, 0);
      expect(linked(quantity: '12', unit: 'box').extraQuantity, 0);
      expect(linked(quantity: '12').copyWith(match: LineMatch.substitute).extraQuantity, 0);
    });

    test('same unit and not a substitute counts at once; otherwise it waits for the office check', () {
      expect(linked().countsDirectly, isTrue);
      expect(linked(unit: ' BAG ').countsDirectly, isTrue);
      expect(linked(unit: 'box').countsDirectly, isFalse);
      expect(linked().copyWith(match: LineMatch.substitute).countsDirectly, isFalse);
    });
  });

  group('problems before sending', () {
    test('a complete purchase has none', () {
      expect(purchaseProblems(draft()), isEmpty);
    });

    test('each line needs a name, a quantity, an amount and a place (Q11)', () {
      final d = draft(lines: [
        const DraftPurchaseLine(key: 'k', quantity: '0', amount: 'x', unplannedReason: 'r'),
      ]);
      expect(purchaseProblems(d), containsAll(const [
        PurchaseProblem(ProblemKind.badName, line: 1),
        PurchaseProblem(ProblemKind.badQuantity, line: 1),
        PurchaseProblem(ProblemKind.badAmount, line: 1),
        PurchaseProblem(ProblemKind.noProject, line: 1),
      ]));
    });

    test('the warehouse needs no project', () {
      final d = draft(lines: [unplanned().copyWith(destination: 'warehouse', folderId: null)]);
      expect(purchaseProblems(d), isEmpty);
    });

    test('an item with no request needs a reason (Q11)', () {
      final d = draft(lines: [unplanned().copyWith(unplannedReason: ' ')]);
      expect(purchaseProblems(d), [const PurchaseProblem(ProblemKind.unplannedReasonRequired, line: 1)]);
    });

    test('an extra needs a reason and a location (Q11)', () {
      final d = draft(lines: [linked(quantity: '12')]);
      expect(purchaseProblems(d), [const PurchaseProblem(ProblemKind.extraReasonRequired, line: 1)]);
      final ok = draft(lines: [linked(quantity: '12').copyWith(extraReason: 'Spare', extraLocation: 'warehouse')]);
      expect(purchaseProblems(ok), isEmpty);
    });

    test('a renamed item is either "other words" or a substitute — the buyer says which (Q10)', () {
      final renamed = linked().copyWith(itemName: 'Portland cement');
      expect(purchaseProblems(draft(lines: [renamed])), [const PurchaseProblem(ProblemKind.nameDiffers, line: 1)]);
      expect(purchaseProblems(draft(lines: [renamed.copyWith(match: LineMatch.otherWords)])), isEmpty);
      expect(purchaseProblems(draft(lines: [renamed.copyWith(match: LineMatch.substitute)])),
          [const PurchaseProblem(ProblemKind.substituteReasonRequired, line: 1)]);
      expect(purchaseProblems(draft(lines: [renamed.copyWith(match: LineMatch.substitute, substituteReason: '40 kg out')])), isEmpty);
    });

    test('a different unit needs a note (Q10, phone rule)', () {
      final box = linked(unit: 'box');
      expect(purchaseProblems(draft(lines: [box])), [const PurchaseProblem(ProblemKind.unitNoteRequired, line: 1)]);
      expect(purchaseProblems(draft(lines: [box.copyWith(unitNote: '1 box = 12 bags')])), isEmpty);
    });

    test('a receipt photo, or "No receipt" with a reason (Q8)', () {
      expect(purchaseProblems(draft(photos: const {})), [const PurchaseProblem(ProblemKind.noReceipt)]);
      expect(purchaseProblems(draft(photos: const {}, noReceipt: true)), [const PurchaseProblem(ProblemKind.noReceiptReason)]);
      expect(purchaseProblems(draft(photos: const {}, noReceipt: true, noReceiptReason: 'Sari-sari store')), isEmpty);
    });

    test('lines + fees − discounts must equal the receipt total (Q9)', () {
      final charges = [const DraftCharge(kind: 'delivery_fee', amount: '50'), const DraftCharge(kind: 'discount', amount: '20')];
      expect(purchaseProblems(draft(charges: charges, total: '530')), isEmpty);
      expect(purchaseProblems(draft(charges: charges, total: '500')), [const PurchaseProblem(ProblemKind.totalMismatch)]);
      expect(purchaseProblems(draft(total: '')), [const PurchaseProblem(ProblemKind.badTotal)]);
    });

    test('a fee needs an amount; an adjusted split must add up, one share per line', () {
      expect(purchaseProblems(draft(charges: [const DraftCharge(kind: 'delivery_fee', amount: '0')])),
          contains(const PurchaseProblem(ProblemKind.badChargeAmount, charge: 1)));
      final two = [unplanned(amount: '300'), unplanned(amount: '200')];
      expect(purchaseProblems(draft(lines: two, total: '550', charges: [const DraftCharge(kind: 'delivery_fee', amount: '50', shares: ['30', '10'])])),
          [const PurchaseProblem(ProblemKind.splitMismatch, charge: 1)]);
      expect(purchaseProblems(draft(lines: two, total: '550', charges: [const DraftCharge(kind: 'delivery_fee', amount: '50', shares: ['30', '20'])])),
          isEmpty);
    });

    test('no lines, or more than 50, is refused', () {
      expect(purchaseProblems(draft(lines: const [], total: '0')), contains(const PurchaseProblem(ProblemKind.noLines)));
      expect(purchaseProblems(draft(lines: List.filled(51, unplanned(amount: '1')), total: '51')),
          contains(const PurchaseProblem(ProblemKind.tooManyLines)));
    });
  });

  group('the pur_record body', () {
    test('a phone purchase: source workmate, the actual date, the typed total', () {
      final b = purchaseBody(draft(), docs: const {'supplier_invoice_url': 'https://x/u.jpg'});
      expect(b['source'], 'workmate');
      expect(b['purchase_date'], '2026-10-21');
      expect(b['date_time'], '2026-10-21');
      expect(b['receipt_total'], 500);
      expect(b['supplier'], 'ZZ Hardware');
      expect(b['docs'], {'supplier_invoice_url': 'https://x/u.jpg'});
      expect(b['no_receipt_reason'], '');
    });

    test('an unplanned line carries its reason and no request', () {
      final line = (purchaseBody(draft())['lines'] as List).single as Map;
      expect(line['request_line_id'], isNull);
      expect(line['unplanned_reason'], 'Site ran out');
      expect(line['folder_id'], 'f1');
      expect(line['quantity'], 2);
      expect(line['amount'], 500);
      expect(line.containsKey('portion_picks'), isFalse);
    });

    test('a linked line carries its request, the picked portions and the match', () {
      final line = (purchaseBody(draft(lines: [linked(quantity: '12').copyWith(extraReason: 'Spare', extraLocation: 'warehouse')]))['lines']
          as List)
          .single as Map;
      expect(line['request_line_id'], 'l1');
      expect(line['portion_picks'], [
        {'portion_id': 'p1', 'quantity': 10},
      ]);
      expect(line['extra_reason'], 'Spare');
      expect(line['extra_location'], 'warehouse');
      expect(line['substitute'], isFalse);
      expect(line.containsKey('unplanned_reason'), isFalse);
    });

    test('a warehouse line has no project', () {
      final line = (purchaseBody(draft(lines: [unplanned().copyWith(destination: 'warehouse')]))['lines'] as List).single as Map;
      expect(line['destination'], 'warehouse');
      expect(line['folder_id'], isNull);
    });

    test('an adjusted split goes by line number; a default one is left to the server', () {
      final two = [unplanned(amount: '300'), unplanned(amount: '200')];
      final b = purchaseBody(draft(lines: two, total: '600', charges: [
        const DraftCharge(kind: 'delivery_fee', amount: '50', shares: ['30', '20']),
        const DraftCharge(kind: 'delivery_fee', amount: '50'),
      ]));
      final charges = b['charges'] as List;
      expect((charges[0] as Map)['shares'], [
        {'line': 1, 'amount': 30},
        {'line': 2, 'amount': 20},
      ]);
      expect((charges[1] as Map).containsKey('shares'), isFalse);
    });

    test('No receipt keeps its reason; a different unit\'s note goes into the notes (Q8, Q10)', () {
      final b = purchaseBody(draft(
        photos: const {},
        noReceipt: true,
        noReceiptReason: 'Sari-sari store',
        lines: [linked(unit: 'box').copyWith(unitNote: '1 box = 12 bags')],
      ));
      expect(b['no_receipt_reason'], 'Sari-sari store');
      expect(b['notes'], 'Line 1 (different unit): 1 box = 12 bags');
    });

    test('a draft survives being saved and read back', () {
      final d = draft(lines: [linked(quantity: '12').copyWith(match: LineMatch.otherWords, extraLocation: 'project')]);
      final back = PurchaseDraft.fromJson(d.toJson());
      expect(back.toJson(), d.toJson());
      expect(back.lines.single.match, LineMatch.otherWords);
      expect(back.lines.single.picks.single.still, 10);
    });
  });
}
```

**Create:** `test/purchasing/purchasing_api_fake.dart`

```dart
import 'dart:typed_data';

import 'package:workmate/purchasing/data/purchasing_api.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';

import 'purchasing_fakes.dart';

/// A PurchasingApi for controllers and screens: answers the test sets, every
/// call recorded.
class FakePurchasingApi implements PurchasingApi {
  @override
  String me = 'u1';

  ShoppingView shopping = ShoppingView(lines: [cement()], batches: [thisWeek, nextWeek], fetchedAt: wednesday);
  PurchaseChoices choiceList = const PurchaseChoices(destinations: [barlin], suppliers: [zzHardware]);
  MyPurchasesView mine = const MyPurchasesView();
  PurchaseDetail detail = PurchaseDetail.fromJson(const {'id': 'pu1', 'status': 'recorded'});
  List<PurchaseDraft> draftList = [];
  CorrectionOutcome correctionOutcome = CorrectionOutcome.saved;

  /// Thrown by the next call that can fail (then cleared).
  Object? error;
  Object? keepError;

  final calls = <String>[];
  final sent = <PurchaseDraft>[];
  final saved = <PurchaseDraft>[];
  final bodies = <Map<String, dynamic>>[];
  var _ids = 0;

  void _maybeFail() {
    final e = error;
    if (e == null) return;
    error = null;
    throw e;
  }

  @override
  Future<ShoppingView> shoppingList() async {
    calls.add('shoppingList');
    _maybeFail();
    return shopping;
  }

  @override
  Future<void> claim(PurPortion portion, {double? quantity}) async {
    calls.add('claim:${portion.id}:$quantity');
    _maybeFail();
  }

  @override
  Future<void> release(PurPortion portion) async {
    calls.add('release:${portion.id}');
    _maybeFail();
  }

  @override
  Future<void> setArranged(PurPortion portion, bool arranged) async {
    calls.add('arranged:${portion.id}:$arranged');
    _maybeFail();
  }

  @override
  Future<PurchaseChoices> choices() async {
    _maybeFail();
    return choiceList;
  }

  @override
  PurchaseDraft newDraft({List<DraftPurchaseLine> lines = const []}) =>
      PurchaseDraft(id: 'draft${++_ids}', createdAt: wednesday, purchaseDate: '2026-10-21', lines: lines);

  @override
  String newLineKey() => 'line${++_ids}';

  @override
  Future<List<PurchaseDraft>> drafts() async => draftList;

  @override
  Future<void> saveDraft(PurchaseDraft draft) async => saved.add(draft);

  @override
  Future<void> deleteDraft(PurchaseDraft draft) async => calls.add('deleteDraft:${draft.id}');

  @override
  Future<String> keepPhoto(String draftId, String sourcePath) async => '/kept/$sourcePath';

  @override
  Future<void> discardPhoto(String path) async => calls.add('discardPhoto:$path');

  @override
  Future<void> send(PurchaseDraft draft) async {
    final problems = purchaseProblems(draft);
    if (problems.isNotEmpty) throw PurchaseInvalid(problems);
    _maybeFail();
    sent.add(draft);
  }

  @override
  Future<MyPurchasesView> myPurchases() async {
    calls.add('myPurchases');
    _maybeFail();
    return mine;
  }

  @override
  Future<bool> returnToDrafts(String draftId) async {
    calls.add('returnToDrafts:$draftId');
    return true;
  }

  @override
  Future<void> discardRefused(String draftId) async => calls.add('discardRefused:$draftId');

  @override
  Future<PurchaseDetail> purchase(String id) async {
    calls.add('purchase:$id');
    _maybeFail();
    return detail;
  }

  @override
  Future<CorrectionResult> correct(PurchaseDetail purchase, Map<String, dynamic> body, String reason,
      {required String opId, Map<String, String> newPhotos = const {}}) async {
    calls.add('correct:${purchase.id}:$reason:${newPhotos.keys.join(',')}');
    _maybeFail();
    bodies.add(body);
    return CorrectionResult(correctionOutcome, body);
  }

  @override
  Future<void> sendToOwner(PurchaseDetail purchase, Map<String, dynamic> body, String reason, {required String opId}) async {
    calls.add('owner:${purchase.id}:$reason');
    _maybeFail();
    bodies.add(body);
  }

  @override
  Future<Uint8List?> receipt(String url) async => null;

  @override
  Future<int> unsentFor(String userId) async => 0;

  @override
  Future<void> keepOnly(String userId) async {
    calls.add('keepOnly:$userId');
    final e = keepError;
    if (e != null) throw e;
  }
}
```

**Create:** `test/purchasing/purchasing_fakes.dart`

```dart
import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:workmate/purchasing/data/purchasing_remote.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';

/// A server refusal as supabase-js reports it.
PostgrestException refusal(String code) => PostgrestException(message: code, code: 'P0001');

/// The Saturday-noon Manila cutoffs of 24 Oct and 31 Oct 2026, in UTC.
final thisWeek = PurBatch(id: 'b1', cutoffAt: DateTime.utc(2026, 10, 24, 4), purchaseOn: '2026-10-26');
final nextWeek = PurBatch(id: 'b2', cutoffAt: DateTime.utc(2026, 10, 31, 4), purchaseOn: '2026-11-02');

/// Wednesday 21 Oct 2026, 10:00 Manila.
final wednesday = DateTime.utc(2026, 10, 21, 2);

PurPortion portion(String id, {String batch = 'b1', double still = 10, String? buyer, bool mine = false, bool arranged = false}) => PurPortion(
      id: id,
      batchId: batch,
      quantity: still,
      stillToBuy: still,
      buyerId: buyer,
      buyerName: buyer == null ? null : (mine ? 'Ana' : 'Ben'),
      mine: mine,
      arranged: arranged,
    );

ShoppingLine cement({List<PurPortion>? portions}) => ShoppingLine(
      lineId: 'l1',
      requestId: 'r1',
      description: 'Cement',
      spec: '40 kg',
      unit: 'bag',
      projectId: 'f1',
      projectName: 'Barlin Residence',
      workId: 'f1',
      workName: 'Main Contract',
      requesterName: 'Juan',
      needed: 10,
      stillToBuy: 10,
      portions: portions ?? [portion('p1')],
    );

const barlin = PurDestination(folderId: 'f1', name: 'Barlin Residence', works: [PurWork(folderId: 'f9', name: 'AW-02 Fence')]);
const zzHardware = Supplier(id: 's1', name: 'ZZ Hardware', branch: 'Malolos');

/// A PurchasingRemote whose every answer the test sets, recording every call.
class FakePurchasingRemote implements PurchasingRemote {
  List<PurBatch> batchList = [thisWeek, nextWeek];
  List<ShoppingLine> lines = [cement()];
  List<PurDestination> dests = [barlin];
  List<Supplier> supplierList = [zzHardware];
  List<Map<String, dynamic>> mine = [];
  Map<String, dynamic> detail = {'id': 'pu1', 'status': 'recorded'};
  String companyId = 'o1';

  /// Thrown by every read while set.
  Object? readError;

  /// Thrown by the next write (then cleared), or every write while [writeErrorSticky].
  Object? writeError;
  bool writeErrorSticky = false;

  /// Thrown by the next upload (then cleared).
  Object? uploadError;

  final calls = <String>[];
  final uploads = <String>[];
  final recorded = <Map<String, dynamic>>[];
  final recordOps = <String>[];

  void _read() {
    if (readError != null) throw readError!;
  }

  void _write() {
    final e = writeError;
    if (e == null) return;
    if (!writeErrorSticky) writeError = null;
    throw e;
  }

  @override
  Future<List<PurBatch>> batches() async {
    _read();
    return batchList;
  }

  @override
  Future<List<ShoppingLine>> shoppingList() async {
    _read();
    return lines;
  }

  @override
  Future<List<PurDestination>> destinations() async {
    _read();
    return dests;
  }

  @override
  Future<List<Supplier>> suppliers() async {
    _read();
    return supplierList;
  }

  @override
  Future<String> company(String userId) async {
    _read();
    calls.add('company');
    return companyId;
  }

  @override
  Future<Map<String, dynamic>> assign(String portionId, String? buyerId, double? quantity, {required String userId}) async {
    calls.add('assign:$portionId:$buyerId:$quantity');
    _write();
    return {'portion_id': portionId, 'changed': true};
  }

  @override
  Future<Map<String, dynamic>> setArranged(String portionId, bool arranged, {required String userId}) async {
    calls.add('arranged:$portionId:$arranged');
    _write();
    return {'portion_id': portionId, 'arranged': arranged};
  }

  @override
  Future<List<Map<String, dynamic>>> myPurchases() async {
    _read();
    return mine;
  }

  @override
  Future<Map<String, dynamic>> purchase(String id) async {
    _read();
    return detail;
  }

  @override
  Future<Map<String, dynamic>> record(String opId, Map<String, dynamic> body, {required String userId}) async {
    calls.add('record:$opId');
    _write();
    recordOps.add(opId);
    recorded.add(body);
    return {'purchase_id': 'pu${recorded.length}'};
  }

  @override
  Future<Map<String, dynamic>> correct(String opId, String purchaseId, Map<String, dynamic> body, String reason, {required String userId}) async {
    calls.add('correct:$opId:$purchaseId:$reason');
    _write();
    recorded.add(body);
    return {'purchase_id': purchaseId};
  }

  @override
  Future<Map<String, dynamic>> requestChange(String opId, String purchaseId, Map<String, dynamic> body, String reason,
      {required String userId}) async {
    calls.add('owner:$opId:$purchaseId:$reason');
    _write();
    recorded.add(body);
    return {'request_id': 'cr1', 'status': 'pending'};
  }

  @override
  Future<String> uploadReceipt({required String path, required String localPath, required String companyId, required String userId}) async {
    final e = uploadError;
    if (e != null) {
      uploadError = null;
      throw e;
    }
    uploads.add(path);
    return 'https://x.supabase.co/storage/v1/object/public/uploads/$path';
  }

  @override
  Future<Uint8List?> receipt(String url) async {
    calls.add('receipt:$url');
    return Uint8List.fromList([1, 2, 3]);
  }
}
```

**Create:** `test/purchasing/sync/purchasing_sync_test.dart`

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:workmate/attendance/sync/submission_sync.dart' show SyncResult;
import 'package:workmate/purchasing/data/purchasing_db.dart';
import 'package:workmate/purchasing/domain/pur_failure.dart';
import 'package:workmate/purchasing/domain/pur_op.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';
import 'package:workmate/purchasing/sync/purchasing_sync.dart';

import '../purchasing_fakes.dart';

void main() {
  late PurchasingDb db;
  late FakePurchasingRemote remote;
  late PurchasingSync sync;
  late Directory dir;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await PurchasingDb.open(databaseFactoryFfi, inMemoryDatabasePath, singleInstance: false);
    remote = FakePurchasingRemote();
    sync = PurchasingSync(db: db, remote: remote, now: () => wednesday);
    dir = await Directory.systemTemp.createTemp('pur-sync');
  });
  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  Future<String> queue({String user = 'u1', String opId = 'op1', String? company = 'o1', bool photo = true}) async {
    final f = File('${dir.path}/$opId.jpg')..writeAsBytesSync([1]);
    final draft = PurchaseDraft(id: 'd-$opId', createdAt: wednesday, purchaseDate: '2026-10-21');
    await db.queueDraft(
      user,
      draft,
      PurOp(
        opId: opId,
        userId: user,
        createdAt: wednesday,
        draftId: draft.id,
        purchase: const {'source': 'workmate', 'lines': []},
        companyId: company,
        receipts: {if (photo) 'supplier_invoice_url': ReceiptUpload(local: f.path, photoId: 'ph-$opId')},
      ),
      wednesday,
    );
    return f.path;
  }

  test('receipts first, then the purchase with their links, recorded once with the Send op id', () async {
    final local = await queue();
    expect(await sync.drain('u1'), SyncResult.done);
    expect(remote.uploads, ['purchases/o1/2026-10/ph-op1.jpg']);
    expect(remote.recordOps, ['op1']);
    expect(remote.recorded.single['docs'], {'supplier_invoice_url': 'https://x.supabase.co/storage/v1/object/public/uploads/purchases/o1/2026-10/ph-op1.jpg'});
    expect(await db.ops('u1'), isEmpty);
    expect(await db.unsentCount('u1'), 0);
    expect(File(local).existsSync(), isFalse, reason: 'the photo goes only once recorded');
    expect(sync.settled, 1);
  });

  test('no signal while recording: the uploaded receipt is not uploaded again, and the same op id retries', () async {
    final local = await queue();
    remote.writeError = const SocketException('down');
    expect(await sync.drain('u1'), SyncResult.retry);
    expect(remote.uploads.length, 1);
    expect(File(local).existsSync(), isTrue);
    expect(await sync.drain('u1'), SyncResult.done);
    expect(remote.uploads.length, 1);
    expect(remote.calls.where((c) => c == 'record:op1').length, 2);
    expect(remote.recordOps, ['op1']);
  });

  test('no signal while uploading: the path stays fixed for the retry', () async {
    await queue();
    remote.uploadError = const SocketException('down');
    expect(await sync.drain('u1'), SyncResult.retry);
    final kept = (await db.sendable('u1')).single.receipts['supplier_invoice_url']!;
    expect(kept.path, 'purchases/o1/2026-10/ph-op1.jpg');
    expect(kept.url, isNull);
    expect(await sync.drain('u1'), SyncResult.done);
    expect(remote.uploads, ['purchases/o1/2026-10/ph-op1.jpg']);
  });

  test('a company this phone did not know is asked once, then kept', () async {
    await queue(company: null);
    remote.writeError = const SocketException('down');
    await sync.drain('u1');
    expect((await db.sendable('u1')).single.companyId, 'o1');
    await sync.drain('u1');
    expect(remote.calls.where((c) => c == 'company').length, 1);
  });

  test('refused: kept and flagged, never retried, and the queue moves on (Q7)', () async {
    await queue(opId: 'op1');
    await queue(opId: 'op2');
    remote.writeError = refusal('LINE_CLOSED');
    expect(await sync.drain('u1'), SyncResult.done);
    final ops = await db.ops('u1');
    expect(ops.firstWhere((o) => o.opId == 'op1').failedPermanently, isTrue);
    expect(ops.firstWhere((o) => o.opId == 'op1').lastError, 'lineClosed');
    expect(remote.recordOps, ['op2']);
  });

  test('buying turned off: kept as Needs attention, sendable again once returned to editing (R2)', () async {
    await queue();
    remote.writeError = refusal('BUYER_REQUIRED');
    await sync.drain('u1');
    final op = (await db.ops('u1')).single;
    expect(op.failedPermanently, isTrue);
    expect(PurFailure.fromStored(op.lastError), PurFailure.buyingOff);
  });

  test('a receipt photo no longer on the phone: Needs attention, nothing recorded', () async {
    final local = await queue();
    File(local).deleteSync();
    await sync.drain('u1');
    expect((await db.ops('u1')).single.lastError, 'photoMissing');
    expect(remote.recordOps, isEmpty);
  });

  test('an unexpected failure ten times in a row stops being retried', () async {
    await queue();
    remote
      ..writeError = Exception('weird')
      ..writeErrorSticky = true;
    for (var i = 0; i < maxPurchaseAttempts - 1; i++) {
      expect(await sync.drain('u1'), SyncResult.retry);
    }
    expect(await sync.drain('u1'), SyncResult.done);
    expect((await db.ops('u1')).single.failedPermanently, isTrue);
  });

  test('only the signed-in account\'s purchases are sent; nobody, nothing', () async {
    await queue(user: 'u2');
    expect(await sync.drain(''), SyncResult.done);
    expect(await sync.drain('u1'), SyncResult.done);
    expect(remote.recordOps, isEmpty);
    await sync.drain('u2');
    expect(remote.recordOps, ['op1']);
  });
}
```

<!-- Code -->

**Modify:** `lib/app.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/app.dart b/lib/app.dart
index 5c13bb0..a47044c 100644
--- a/lib/app.dart
+++ b/lib/app.dart
@@ -4,6 +4,7 @@ import 'package:flutter/material.dart';
 import 'app_controller.dart';
 import 'attendance/attendance_services.dart';
 import 'profile/account_services.dart';
+import 'purchasing/purchasing_services.dart';
 import 'purchasing/ui/buyer_shell.dart';
 import 'purchasing/ui/buying_off_screen.dart';
 import 'requests/requests_services.dart';
@@ -31,6 +32,7 @@ class WorkMateApp extends StatefulWidget {
     this.launches,
     this.requests,
     this.workPlan,
+    this.purchasing,
   });
 
   final AppController controller;
@@ -56,6 +58,9 @@ class WorkMateApp extends StatefulWidget {
   /// The My Work tab (Stage 1c); null in tests that do not need it.
   final WorkPlanServices? workPlan;
 
+  /// A buyer's screens (Stage 2A-3b); null in tests that do not need them.
+  final PurchasingServices? purchasing;
+
   @override
   State<WorkMateApp> createState() => _WorkMateAppState();
 }
@@ -143,7 +148,11 @@ class _WorkMateAppState extends State<WorkMateApp> with WidgetsBindingObserver {
                   onSignOut: c.signOut,
                   account: widget.account,
                 ),
-              BuyingOff() => BuyingOffScreen(onRetry: c.retryStartup, onSignOut: c.signOut),
+              BuyingOff(:final worker) => FutureBuilder<int>(
+                  future: widget.purchasing?.api.unsentFor(worker.id) ?? Future.value(0),
+                  builder: (context, unsent) =>
+                      BuyingOffScreen(onRetry: c.retryStartup, onSignOut: c.signOut, unsent: unsent.data ?? 0),
+                ),
               BuyerUnavailable() => GateUnavailableScreen(
                   onRetry: c.retryStartup,
                   onSignOut: c.signOut,
```

**Modify:** `lib/attendance/sync/background_sync.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/attendance/sync/background_sync.dart b/lib/attendance/sync/background_sync.dart
index 2f37fb9..8d913f5 100644
--- a/lib/attendance/sync/background_sync.dart
+++ b/lib/attendance/sync/background_sync.dart
@@ -10,6 +10,9 @@ import '../../auth/session_storage.dart';
 import '../../net/supabase_setup.dart';
 import '../../net/update_nudges.dart';
 import '../../net/workmate_http_client.dart';
+import '../../purchasing/data/purchasing_db.dart';
+import '../../purchasing/data/purchasing_remote.dart';
+import '../../purchasing/sync/purchasing_sync.dart';
 import '../../requests/data/request_remote.dart';
 import '../../requests/data/requests_db.dart';
 import '../../requests/sync/request_sync.dart';
@@ -49,7 +52,9 @@ Future<bool> runBackgroundSync() async {
   // Nothing to send: never touch auth (a needless refresh can burn a rotating token).
   final probe = await openDeviceAttendanceDb(singleInstance: false);
   try {
-    if (!await probe.hasAnySendable() && !await _requestsWaiting() && !await _workPlanWaiting()) return true;
+    if (!await probe.hasAnySendable() && !await _requestsWaiting() && !await _workPlanWaiting() && !await _purchasesWaiting()) {
+      return true;
+    }
   } finally {
     await probe.close();
   }
@@ -94,18 +99,35 @@ Future<bool> _workPlanWaiting() async {
   }
 }
 
+/// Purchases waiting to be recorded (2A-3b). False when the purchasing
+/// database cannot be read: it must never stop attendance from going out.
+Future<bool> _purchasesWaiting() async {
+  try {
+    final db = await openDevicePurchasingDb(singleInstance: false);
+    try {
+      return await db.hasAnySendable();
+    } finally {
+      await db.close();
+    }
+  } catch (_) {
+    return false;
+  }
+}
+
 /// Refresh the session if needed, then drain this worker's queues: attendance
 /// first, then requests (0085), then My Work (0093). Shared by the background isolate and the live
 /// app's [AttendanceSyncHost]. [afterChange] (the widget and Home) runs as soon
 /// as the ATTENDANCE drain settled a row, with its own database — never held
 /// back by request photo uploads. [onRequestsSettled] runs when the requests
 /// drain settled one: it only tells the screens (the widget shows no requests).
-/// [onWorkPlanSettled] likewise for My Work.
+/// [onWorkPlanSettled] likewise for My Work, [onPurchasesSettled] for a
+/// buyer's purchases (2A-3b).
 Future<bool> syncWith(
   SupabaseClient client, {
   Future<void> Function(AttendanceDb db, String workerId)? afterChange,
   FutureOr<void> Function()? onRequestsSettled,
   FutureOr<void> Function()? onWorkPlanSettled,
+  FutureOr<void> Function()? onPurchasesSettled,
 }) async {
   // The stored session may be expired: join (or start) its refresh before sending.
   try {
@@ -149,10 +171,21 @@ Future<bool> syncWith(
           await workDb.close();
         }
       },
+      purchases: () async {
+        final purDb = await openDevicePurchasingDb(singleInstance: false);
+        try {
+          final purchases = PurchasingSync(db: purDb, remote: SupabasePurchasingRemote(client));
+          final result = await purchases.drain(workerId);
+          return (result: result, settled: purchases.settled);
+        } finally {
+          await purDb.close();
+        }
+      },
       attendanceWaiting: () async => workerId.isNotEmpty && (await db.sendable(workerId)).isNotEmpty,
       afterAttendance: afterChange == null ? null : () => afterChange(db, workerId),
       onRequestsSettled: onRequestsSettled,
       onWorkPlanSettled: onWorkPlanSettled,
+      onPurchasesSettled: onPurchasesSettled,
     );
   } finally {
     await db.close();
@@ -177,9 +210,11 @@ Future<bool> drainInOrder({
   required Future<DrainOutcome> Function() requests,
   required Future<bool> Function() attendanceWaiting,
   Future<DrainOutcome> Function()? workPlan,
+  Future<DrainOutcome> Function()? purchases,
   Future<void> Function()? afterAttendance,
   FutureOr<void> Function()? onRequestsSettled,
   FutureOr<void> Function()? onWorkPlanSettled,
+  FutureOr<void> Function()? onPurchasesSettled,
 }) async {
   var att = await attendance();
   if (att.settled > 0) await _tell(afterAttendance);
@@ -202,12 +237,26 @@ Future<bool> drainInOrder({
   }
   if (work.settled > 0) await _tell(onWorkPlanSettled);
 
+  // A buyer's purchases (2A-3b), the same way: never blocks attendance.
+  DrainOutcome pur = (result: SyncResult.done, settled: 0);
+  if (purchases != null) {
+    try {
+      pur = await purchases();
+    } catch (_) {
+      pur = (result: SyncResult.retry, settled: 0);
+    }
+  }
+  if (pur.settled > 0) await _tell(onPurchasesSettled);
+
   // A pass that must retry would only fail again: WorkManager comes back.
   if (att.result == SyncResult.done && await _waiting(attendanceWaiting)) {
     att = await attendance();
     if (att.settled > 0) await _tell(afterAttendance);
   }
-  return att.result == SyncResult.done && req.result == SyncResult.done && work.result == SyncResult.done;
+  return att.result == SyncResult.done &&
+      req.result == SyncResult.done &&
+      work.result == SyncResult.done &&
+      pur.result == SyncResult.done;
 }
 
 /// The rows are sent; telling the widget and the screens is best effort.
```

**Modify:** `lib/main.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/main.dart b/lib/main.dart
index 935c04a..98ce936 100644
--- a/lib/main.dart
+++ b/lib/main.dart
@@ -38,6 +38,11 @@ import 'net/update_nudges.dart';
 import 'net/workmate_http_client.dart';
 import 'profile/account_services.dart';
 import 'purchasing/buyer_access.dart';
+import 'purchasing/data/purchasing_account_wipe.dart';
+import 'purchasing/data/purchasing_db.dart';
+import 'purchasing/data/purchasing_remote.dart';
+import 'purchasing/data/purchasing_repository.dart';
+import 'purchasing/purchasing_services.dart';
 import 'requests/data/request_remote.dart';
 import 'requests/data/request_repository.dart';
 import 'requests/data/requests_db.dart';
@@ -95,9 +100,10 @@ Future<void> main() async {
         await widgets.publishIfCurrent(db, workerId, () => letInWorker());
         queueSettled.fire();
       },
-      // Requests and My Work are not on the widget: only the screens are told.
+      // Requests, My Work and purchases are not on the widget: only the screens are told.
       onRequestsSettled: queueSettled.fire,
       onWorkPlanSettled: queueSettled.fire,
+      onPurchasesSettled: queueSettled.fire,
     ),
   )..register();
 
@@ -245,6 +251,34 @@ Future<void> main() async {
     debugPrint('My Work unavailable: $e');
   }
 
+  // Buying (Stage 2A-3b): office accounts with the Buyer switch. If its
+  // database cannot open, a buyer gets Profile only: workers never depend on it.
+  PurchasingServices? purchasing;
+  try {
+    final repo = PurchasingRepository(
+      db: await openDevicePurchasingDb(),
+      remote: SupabasePurchasingRemote(client),
+      device: device,
+      scheduler: scheduler,
+      currentUserId: () => switch (controller.state) {
+        BuyerReady(:final worker) => worker.id,
+        _ => '',
+      },
+      companyOf: buyers.companyOf,
+      photoDir: () async => Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}receipt-photos'),
+      sendNow: () async {
+        await syncHost.drainNow();
+      },
+      onBuyingOff: controller.buyingTurnedOff,
+    );
+    final wipe = PurchasingAccountWipe(repo);
+    controller.addListener(() => wipe.onAppState(controller.state));
+    wipe.onAppState(controller.state);
+    purchasing = PurchasingServices(api: repo, changed: queueSettled);
+  } catch (e) {
+    debugPrint('Buying unavailable: $e');
+  }
+
   runApp(WorkMateApp(
     controller: controller,
     updates: updates,
@@ -256,5 +290,6 @@ Future<void> main() async {
     launches: const ChannelLaunchRequests(),
     requests: requests,
     workPlan: workPlan,
+    purchasing: purchasing,
   ));
 }
```

**Create:** `lib/purchasing/data/purchasing_account_wipe.dart`

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../app_controller.dart';
import 'purchasing_api.dart';

/// Site phones are shared, and prices are for buyers only. Fed every app
/// state: once a buyer is let in, only their saved copy is kept; signed out,
/// or with buying turned off (R2), none is. Startup and the gates decide
/// nothing. Unsent purchases are never touched — they wait for their buyer.
class PurchasingAccountWipe {
  PurchasingAccountWipe(this.api);

  final PurchasingApi api;
  String? _kept;

  void onAppState(AppState s) {
    final keep = switch (s) {
      BuyerReady(:final worker) => worker.id,
      SignedOut() || BuyingOff() || Ready() => '',
      _ => null,
    };
    if (keep == null || keep == _kept) return;
    _kept = keep;
    unawaited(api.keepOnly(keep).catchError((Object e) {
      debugPrint('Buying wipe failed: $e');
      if (_kept == keep) _kept = null; // try again on the next state
    }));
  }
}
```

**Create:** `lib/purchasing/data/purchasing_api.dart`

```dart
import 'dart:typed_data';

import '../domain/pur_failure.dart';
import '../domain/pur_models.dart';
import '../domain/purchase_draft.dart';

/// The shopping list as last read: fresh when online, the saved copy offline.
class ShoppingView {
  const ShoppingView({this.lines = const [], this.batches = const [], this.fetchedAt, this.fromCache = false, this.error});
  final List<ShoppingLine> lines;
  final List<PurBatch> batches;
  final DateTime? fetchedAt;
  final bool fromCache;

  /// Why the server could not be read just now; null when it was.
  final Object? error;
}

/// Where a purchase may go and who it may be from (Q11), fresh or saved.
class PurchaseChoices {
  const PurchaseChoices({this.destinations = const [], this.suppliers = const [], this.fromCache = false});
  final List<PurDestination> destinations;
  final List<Supplier> suppliers;
  final bool fromCache;
}

enum QueuedState {
  /// Saved on the phone, not yet counted anywhere (Q7).
  waiting,

  /// The server refused it; it stays here with the reason until the buyer
  /// fixes it or throws it away (Q7). Never silently dropped.
  needsAttention,
}

/// A purchase recorded on the phone that the server does not have yet.
class QueuedPurchase {
  const QueuedPurchase({required this.draft, required this.state, this.failure});
  final PurchaseDraft draft;
  final QueuedState state;
  final PurFailure? failure;
}

/// My purchases (Q12): what is still on the phone, then the server's list.
class MyPurchasesView {
  const MyPurchasesView({this.queued = const [], this.purchases = const [], this.fetchedAt, this.fromCache = false, this.error});
  final List<QueuedPurchase> queued;
  final List<MyPurchase> purchases;
  final DateTime? fetchedAt;
  final bool fromCache;
  final Object? error;
}

/// Thrown by [PurchasingApi.send] for a draft the server would refuse.
class PurchaseInvalid implements Exception {
  const PurchaseInvalid(this.problems);
  final List<PurchaseProblem> problems;
  @override
  String toString() => 'PurchaseInvalid($problems)';
}

enum CorrectionOutcome { saved, needsOwner }

/// What a correction did, and the body it sent (with any new receipt links),
/// to send to the owner unchanged when only the owner may make it (Q13).
class CorrectionResult {
  const CorrectionResult(this.outcome, this.body);
  final CorrectionOutcome outcome;
  final Map<String, dynamic> body;
}

/// What the buying screens need. An interface so every controller and screen
/// tests with a fake instead of a database and a server.
abstract interface class PurchasingApi {
  /// The signed-in buyer, or '' — the scope of every read and write.
  String get me;

  Future<ShoppingView> shoppingList();

  // Online only (Q5, Q6): each throws when the server cannot be reached.
  Future<void> claim(PurPortion portion, {double? quantity});
  Future<void> release(PurPortion portion);
  Future<void> setArranged(PurPortion portion, bool arranged);

  Future<PurchaseChoices> choices();

  PurchaseDraft newDraft({List<DraftPurchaseLine> lines = const []});
  String newLineKey();

  /// Unsent drafts still being edited, newest first.
  Future<List<PurchaseDraft>> drafts();
  Future<void> saveDraft(PurchaseDraft draft);

  /// Discards an unsent draft and its photos.
  Future<void> deleteDraft(PurchaseDraft draft);

  /// Files a camera or gallery photo for [draftId]: upright, scaled,
  /// compressed, in app-private storage. Returns the stored path.
  Future<String> keepPhoto(String draftId, String sourcePath);
  Future<void> discardPhoto(String path);

  /// Queues the draft (throws [PurchaseInvalid] first) and starts sending.
  Future<void> send(PurchaseDraft draft);

  Future<MyPurchasesView> myPurchases();

  /// A refused purchase back to editing. False while it could still be sent.
  Future<bool> returnToDrafts(String draftId);

  /// Throws a refused purchase away, with its photos.
  Future<void> discardRefused(String draftId);

  /// One purchase in full. Online only.
  Future<PurchaseDetail> purchase(String id);

  /// Corrects the buyer's own purchase (Q13), uploading [newPhotos] (slot →
  /// file) first. [opId] is minted once per correction form, so a retry
  /// corrects once. When only the owner may make the change, nothing is
  /// changed and [CorrectionOutcome.needsOwner] comes back.
  Future<CorrectionResult> correct(PurchaseDetail purchase, Map<String, dynamic> body, String reason,
      {required String opId, Map<String, String> newPhotos = const {}});

  /// Sends the change to the owner instead (pur_request_change).
  Future<void> sendToOwner(PurchaseDetail purchase, Map<String, dynamic> body, String reason, {required String opId});

  /// A stored receipt photo, or null.
  Future<Uint8List?> receipt(String url);

  /// Purchases on the phone for [userId] not yet recorded (R2's screen).
  Future<int> unsentFor(String userId);

  /// Keeps only [userId]'s saved copy ('' keeps none). Unsent purchases are
  /// never touched.
  Future<void> keepOnly(String userId);
}
```

**Create:** `lib/purchasing/data/purchasing_db.dart`

```dart
import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../domain/pur_op.dart';
import '../domain/purchase_draft.dart';

/// Purchases being recorded, the send-once queue and the last answers read
/// (for use with no signal) — every row scoped by account. Its own file, apart
/// from attendance, requests and My Work, so none can break the others.
class PurchasingDb {
  PurchasingDb._(this._db);

  final Database _db;

  static Future<PurchasingDb> open(DatabaseFactory factory, String path, {bool singleInstance = true}) async {
    final db = await factory.openDatabase(
      path,
      options: OpenDatabaseOptions(version: 1, onCreate: _create, singleInstance: singleInstance),
    );
    return PurchasingDb._(db);
  }

  static Future<void> _create(Database db, int version) async {
    await db.execute('''
      create table pur_draft (
        id text primary key,
        user_id text not null,
        body text not null,
        queued integer not null default 0,
        created_at integer not null,
        updated_at integer not null
      )''');
    await db.execute('''
      create table pur_op (
        op_id text primary key,
        user_id text not null,
        kind text not null,
        draft_id text,
        body text not null,
        seq integer not null,
        attempts integer not null default 0,
        last_error text,
        failed_permanently integer not null default 0,
        created_at integer not null
      )''');
    await db.execute('''
      create table pur_cache (
        user_id text not null,
        name text not null,
        body text not null,
        fetched_at integer not null,
        primary key (user_id, name)
      )''');
  }

  Future<void> close() => _db.close();

  PurchaseDraft _draft(Map<String, Object?> row) => PurchaseDraft.fromJson(Map<String, dynamic>.from(jsonDecode(row['body']! as String) as Map));

  // ── drafts ─────────────────────────────────────────────────────────────

  /// Never rewrites a queued draft: once handed to the queue it changes only
  /// through [unqueueDraft].
  Future<void> saveDraft(String userId, PurchaseDraft d, DateTime now) => _db.transaction((txn) async {
        final queued = await txn.query('pur_draft', columns: ['id'], where: 'id = ? and queued = 1', whereArgs: [d.id], limit: 1);
        if (queued.isNotEmpty) return;
        await txn.insert(
          'pur_draft',
          {
            'id': d.id,
            'user_id': userId,
            'body': jsonEncode(d.toJson()),
            'queued': 0,
            'created_at': d.createdAt.millisecondsSinceEpoch,
            'updated_at': now.millisecondsSinceEpoch,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      });

  /// [queued] false = still being edited; true = handed to the queue.
  Future<List<PurchaseDraft>> drafts(String userId, {required bool queued}) async => (await _db.query('pur_draft',
          where: 'user_id = ? and queued = ?', whereArgs: [userId, queued ? 1 : 0], orderBy: 'created_at desc'))
      .map(_draft)
      .toList();

  Future<PurchaseDraft?> draft(String userId, String id) async {
    final rows = await _db.query('pur_draft', where: 'user_id = ? and id = ?', whereArgs: [userId, id], limit: 1);
    return rows.isEmpty ? null : _draft(rows.first);
  }

  /// Deletes an UNSENT draft and returns it (so its photos can go too); null
  /// when it is queued or not this account's.
  Future<PurchaseDraft?> deleteUnsentDraft(String userId, String id) => _db.transaction((txn) async {
        final rows = await txn.query('pur_draft', where: 'user_id = ? and id = ? and queued = 0', whereArgs: [userId, id], limit: 1);
        if (rows.isEmpty) return null;
        await txn.delete('pur_draft', where: 'id = ?', whereArgs: [id]);
        return _draft(rows.first);
      });

  /// One transaction: the draft is marked queued AND its op exists, or
  /// neither. False (nothing written) when it is already queued: a second
  /// Send must never record a second purchase.
  Future<bool> queueDraft(String userId, PurchaseDraft d, PurOp op, DateTime now) => _db.transaction((txn) async {
        final already = await txn.query('pur_draft', columns: ['id'], where: 'id = ? and queued = 1', whereArgs: [d.id], limit: 1);
        if (already.isNotEmpty) return false;
        await txn.insert(
          'pur_draft',
          {
            'id': d.id,
            'user_id': userId,
            'body': jsonEncode(d.toJson()),
            'queued': 1,
            'created_at': d.createdAt.millisecondsSinceEpoch,
            'updated_at': now.millisecondsSinceEpoch,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
        final top = (await txn.rawQuery('select coalesce(max(seq), 0) as s from pur_op')).first['s']! as int;
        await txn.insert('pur_op', {...op.toMap(), 'seq': top + 1});
        return true;
      });

  /// A refused purchase back to editing: its op goes, it is no longer
  /// queued. Refused (false) while its op could still be sent.
  Future<bool> unqueueDraft(String userId, String draftId) => _db.transaction((txn) async {
        final live = await txn.query('pur_op',
            where: 'user_id = ? and draft_id = ? and failed_permanently = 0', whereArgs: [userId, draftId], limit: 1);
        if (live.isNotEmpty) return false;
        final queued = await txn.query('pur_draft', columns: ['id'], where: 'user_id = ? and id = ? and queued = 1', whereArgs: [userId, draftId]);
        if (queued.isEmpty) return false;
        await txn.delete('pur_op', where: 'user_id = ? and draft_id = ?', whereArgs: [userId, draftId]);
        await txn.update('pur_draft', {'queued': 0}, where: 'user_id = ? and id = ?', whereArgs: [userId, draftId]);
        return true;
      });

  /// A refused purchase the buyer chose to throw away: its op and draft go
  /// together; returns the draft (for its photos). Null while it could still be sent.
  Future<PurchaseDraft?> discardRefused(String userId, String draftId) => _db.transaction((txn) async {
        final live = await txn.query('pur_op',
            where: 'user_id = ? and draft_id = ? and failed_permanently = 0', whereArgs: [userId, draftId], limit: 1);
        if (live.isNotEmpty) return null;
        final rows = await txn.query('pur_draft', where: 'user_id = ? and id = ?', whereArgs: [userId, draftId], limit: 1);
        if (rows.isEmpty) return null;
        await txn.delete('pur_op', where: 'user_id = ? and draft_id = ?', whereArgs: [userId, draftId]);
        await txn.delete('pur_draft', where: 'id = ?', whereArgs: [draftId]);
        return _draft(rows.first);
      });

  /// Purchases on the phone not yet recorded: being edited, waiting to send
  /// or needing attention — for the Buying is turned off screen.
  Future<int> unsentCount(String userId) async =>
      Sqflite.firstIntValue(await _db.rawQuery('select count(*) from pur_draft where user_id = ?', [userId])) ?? 0;

  // ── the queue ──────────────────────────────────────────────────────────

  /// This account's ops that may still be sent, in queue order.
  Future<List<PurOp>> sendable(String userId) async => (await _db.query('pur_op',
          where: 'user_id = ? and failed_permanently = 0', whereArgs: [userId], orderBy: 'seq asc'))
      .map(PurOp.fromMap)
      .toList();

  /// Every op of this account, refused ones included, in queue order.
  Future<List<PurOp>> ops(String userId) async =>
      (await _db.query('pur_op', where: 'user_id = ?', whereArgs: [userId], orderBy: 'seq asc')).map(PurOp.fromMap).toList();

  /// Any account: the app-closed sweeper asks this before it touches auth.
  Future<bool> hasAnySendable() async =>
      (await _db.query('pur_op', columns: ['op_id'], where: 'failed_permanently = 0', limit: 1)).isNotEmpty;

  /// Progress kept between attempts (uploaded receipt links, the company).
  Future<void> updateOpBody(String opId, Map<String, dynamic> body) =>
      _db.update('pur_op', {'body': jsonEncode(body)}, where: 'op_id = ?', whereArgs: [opId]);

  /// [countsTowardCap]: an unexpected failure adds one; any other (no
  /// signal, a session, an update) starts again at zero.
  Future<void> recordAttempt(String opId, String error, {bool countsTowardCap = true}) => _db.rawUpdate(
      'update pur_op set attempts = case when ? then attempts + 1 else 0 end, last_error = ? where op_id = ?',
      [countsTowardCap ? 1 : 0, error, opId]);

  Future<void> markFailed(String opId, String error) =>
      _db.rawUpdate('update pur_op set failed_permanently = 1, last_error = ? where op_id = ?', [error, opId]);

  /// The purchase is recorded on the server: the op and its draft go
  /// together, so it is never shown twice.
  Future<void> finishRecord(String opId, String? draftId) => _db.transaction((txn) async {
        await txn.delete('pur_op', where: 'op_id = ?', whereArgs: [opId]);
        if (draftId != null) await txn.delete('pur_draft', where: 'id = ?', whereArgs: [draftId]);
      });

  // ── last answers read, for offline ─────────────────────────────────────

  Future<void> putCache(String userId, String name, Object json, DateTime at) => _db.insert(
        'pur_cache',
        {'user_id': userId, 'name': name, 'body': jsonEncode(json), 'fetched_at': at.millisecondsSinceEpoch},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  Future<({Object? body, DateTime at})?> cache(String userId, String name) async {
    final rows = await _db.query('pur_cache', where: 'user_id = ? and name = ?', whereArgs: [userId, name], limit: 1);
    if (rows.isEmpty) return null;
    return (body: jsonDecode(rows.first['body']! as String), at: DateTime.fromMillisecondsSinceEpoch(rows.first['fetched_at']! as int, isUtc: true));
  }

  /// Keeps only [userId]'s saved copy ('' keeps none). Drafts and the queue
  /// are never touched: an unsent purchase waits for its buyer.
  Future<void> keepCacheOnly(String userId) => _db.delete('pur_cache', where: 'user_id <> ?', whereArgs: [userId]);
}

/// The database file on the phone, shared by the app and the background sync.
Future<PurchasingDb> openDevicePurchasingDb({bool singleInstance = true}) async =>
    PurchasingDb.open(databaseFactory, '${await getDatabasesPath()}/workmate_purchasing.db', singleInstance: singleInstance);
```

**Create:** `lib/purchasing/data/purchasing_remote.dart`

```dart
import 'dart:io';
import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../buyer_access.dart';
import '../domain/pur_models.dart';

/// Receipts live in the private `uploads` bucket under `purchases/` (0097):
/// only those who may buy in that company read or write them.
const receiptBucket = 'uploads';

const _readTimeout = Duration(seconds: 15);
const _rpcTimeout = Duration(seconds: 30);
const _uploadTimeout = Duration(seconds: 60);

/// The storage path inside a stored receipt link (the web's storagePathOf).
String? receiptPathOf(String url) {
  final m = RegExp(r'/storage/v1/object/public/uploads/([^?#"\s]+)').firstMatch(url);
  return m == null ? null : Uri.decodeComponent(m.group(1)!);
}

/// A retry after the row or the file already landed: "already there" is success.
bool isDuplicate(Object error) {
  if (error is PostgrestException && error.code == '23505') return true;
  if (error is StorageException) {
    return error.statusCode == '409' || error.message.toLowerCase().contains('exists') || error.message.contains('Duplicate');
  }
  final text = error.toString().toLowerCase();
  return text.contains('23505') || text.contains('duplicate key');
}

abstract class PurchasingRemote {
  Future<List<PurBatch>> batches();

  /// Every open request line with something still to buy, every batch.
  Future<List<ShoppingLine>> shoppingList();
  Future<List<PurDestination>> destinations();
  Future<List<Supplier>> suppliers();

  /// The company the signed-in account files under (data_owner_id()).
  Future<String> company(String userId);

  // Every write files under the CURRENT session: if it is not [userId], it
  // throws AUTH_REQUIRED instead of acting for another account.

  /// Claim ([buyerId] = me), or release ([buyerId] null). [quantity] null = all of it.
  Future<Map<String, dynamic>> assign(String portionId, String? buyerId, double? quantity, {required String userId});
  Future<Map<String, dynamic>> setArranged(String portionId, bool arranged, {required String userId});
  Future<List<Map<String, dynamic>>> myPurchases();
  Future<Map<String, dynamic>> purchase(String id);
  Future<Map<String, dynamic>> record(String opId, Map<String, dynamic> body, {required String userId});
  Future<Map<String, dynamic>> correct(String opId, String purchaseId, Map<String, dynamic> body, String reason, {required String userId});
  Future<Map<String, dynamic>> requestChange(String opId, String purchaseId, Map<String, dynamic> body, String reason,
      {required String userId});

  /// The ledger row, THEN the file (0089: a file never exists without one).
  /// Returns the link stored on the purchase.
  Future<String> uploadReceipt({required String path, required String localPath, required String companyId, required String userId});

  /// The receipt's bytes, read as the buyer (never a signed link: 0097), or null.
  Future<Uint8List?> receipt(String url);
}

class SupabasePurchasingRemote implements PurchasingRemote {
  SupabasePurchasingRemote(this._client);

  final SupabaseClient _client;

  List<Map<String, dynamic>> _rows(Object? result) =>
      [for (final r in (result as List<dynamic>? ?? const [])) Map<String, dynamic>.from(r as Map)];

  void _same(String userId) {
    final session = _client.auth.currentUser?.id;
    if (session == null || session != userId) throw StateError('AUTH_REQUIRED');
  }

  Future<Object?> _read(String fn, [Map<String, dynamic>? params]) => _client.rpc(fn, params: params).timeout(_readTimeout);

  Future<Map<String, dynamic>> _write(String fn, Map<String, dynamic> params, String userId) async {
    _same(userId);
    final result = await _client.rpc(fn, params: params).timeout(_rpcTimeout);
    return Map<String, dynamic>.from(result as Map);
  }

  @override
  Future<List<PurBatch>> batches() async => _rows(await _read('pr_office_batches')).map(PurBatch.fromJson).toList();

  @override
  Future<List<ShoppingLine>> shoppingList() async => _rows(await _read('pur_shopping_list', {'p_batch': null, 'p_folder': null, 'p_scope': 'open'}))
      .map(ShoppingLine.fromJson)
      .toList();

  @override
  Future<List<PurDestination>> destinations() async => _rows(await _read('pur_destinations')).map(PurDestination.fromJson).toList();

  @override
  Future<List<Supplier>> suppliers() async => _rows(await _read('pur_suppliers')).map(Supplier.fromJson).toList();

  @override
  Future<String> company(String userId) async {
    _same(userId);
    final row = await _client.from('profiles').select('id,role,owner_id').eq('id', userId).maybeSingle().timeout(_readTimeout);
    return companyOf(row, userId);
  }

  @override
  Future<Map<String, dynamic>> assign(String portionId, String? buyerId, double? quantity, {required String userId}) =>
      _write('pur_assign_portion', {'p_portion': portionId, 'p_buyer': buyerId, 'p_quantity': quantity, 'p_note': null}, userId);

  @override
  Future<Map<String, dynamic>> setArranged(String portionId, bool arranged, {required String userId}) =>
      _write('pr_office_set_arranged', {'p_portion': portionId, 'p_arranged': arranged}, userId);

  @override
  Future<List<Map<String, dynamic>>> myPurchases() async => _rows(await _read('pur_my_purchases', {'p_days': 60}));

  @override
  Future<Map<String, dynamic>> purchase(String id) async => Map<String, dynamic>.from(await _read('pur_purchase', {'p_purchase': id}) as Map);

  @override
  Future<Map<String, dynamic>> record(String opId, Map<String, dynamic> body, {required String userId}) =>
      _write('pur_record', {'p_op': opId, 'p_body': body}, userId);

  @override
  Future<Map<String, dynamic>> correct(String opId, String purchaseId, Map<String, dynamic> body, String reason, {required String userId}) =>
      _write('pur_correct', {'p_op': opId, 'p_purchase': purchaseId, 'p_body': body, 'p_reason': reason}, userId);

  @override
  Future<Map<String, dynamic>> requestChange(String opId, String purchaseId, Map<String, dynamic> body, String reason,
          {required String userId}) =>
      _write('pur_request_change', {'p_op': opId, 'p_purchase': purchaseId, 'p_kind': 'correct', 'p_body': body, 'p_reason': reason}, userId);

  @override
  Future<String> uploadReceipt({required String path, required String localPath, required String companyId, required String userId}) async {
    _same(userId);
    try {
      await _client.from('receipt_uploads').insert({'path': path, 'owner_id': companyId, 'kind': 'purchase'}).timeout(_readTimeout);
    } catch (e) {
      if (!isDuplicate(e)) rethrow;
    }
    try {
      await _client.storage
          .from(receiptBucket)
          .upload(path, File(localPath), fileOptions: const FileOptions(upsert: false, contentType: 'image/jpeg'))
          .timeout(_uploadTimeout);
    } catch (e) {
      if (!isDuplicate(e)) rethrow;
    }
    return _client.storage.from(receiptBucket).getPublicUrl(path);
  }

  @override
  Future<Uint8List?> receipt(String url) async {
    final path = receiptPathOf(url);
    if (path == null) return null;
    try {
      return await _client.storage.from(receiptBucket).download(path).timeout(_uploadTimeout);
    } catch (_) {
      return null;
    }
  }
}
```

**Create:** `lib/purchasing/data/purchasing_repository.dart`

```dart
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import '../../attendance/device/device_bridge.dart';
import '../../attendance/domain/event_id.dart';
import '../../attendance/domain/work_date.dart';
import '../../attendance/sync/upload_scheduler.dart';
import '../domain/pur_failure.dart';
import '../domain/pur_models.dart';
import '../domain/pur_op.dart';
import '../domain/purchase_draft.dart';
import 'purchasing_api.dart';
import 'purchasing_db.dart';
import 'purchasing_remote.dart';

/// Offline-first buying (Q7). Recording happens on the phone first and is
/// sent once, whenever there is signal, from the app or the background task.
/// Claiming, releasing, Mark arranged and corrections need signal (Q5, Q6).
class PurchasingRepository implements PurchasingApi {
  PurchasingRepository({
    required this.db,
    required this.remote,
    required this.device,
    required this.scheduler,
    required this.currentUserId,
    required this.companyOf,
    required this.photoDir,
    this.sendNow,
    this.onBuyingOff,
    DateTime Function()? now,
    String Function()? newId,
  })  : _now = now ?? DateTime.now,
        _newId = newId ?? newEventId;

  final PurchasingDb db;
  final PurchasingRemote remote;
  final DeviceBridge device;

  /// The same WorkManager work as attendance: one background drain sends all.
  final UploadScheduler scheduler;

  /// The buyer the app let in, or ''.
  final String Function() currentUserId;

  /// The company the buyer files under, as last read (BuyerAccess); null
  /// until known — the first send then asks the server.
  final String? Function(String userId) companyOf;

  /// App-private folder for receipt photos (never the gallery).
  final Future<Directory> Function() photoDir;

  /// Drains the queue now in the live app (main.dart); null in tests.
  final Future<void> Function()? sendNow;

  /// The server said BUYER_REQUIRED (R2): the app shows Buying is turned off.
  final Future<void> Function()? onBuyingOff;
  final DateTime Function() _now;
  final String Function() _newId;

  /// Receipts read this session, by link. Kept in memory only.
  final _receipts = <String, Uint8List>{};

  @override
  String get me => currentUserId();

  String _user() {
    final u = currentUserId();
    if (u.isEmpty) throw StateError('AUTH_REQUIRED');
    return u;
  }

  /// R2: wipe the saved copy (shopping list, purchases, receipts) and tell
  /// the app. Unsent purchases stay.
  Future<void> _turnedOff() async {
    _receipts.clear();
    await db.keepCacheOnly('');
    final hook = onBuyingOff;
    if (hook != null) await hook();
  }

  /// Runs a server call; a BUYER_REQUIRED answer wipes and tells the app first.
  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } catch (e) {
      if (PurFailure.of(e) == PurFailure.buyingOff) await _turnedOff();
      rethrow;
    }
  }

  Future<void> _kick() async {
    try {
      await scheduler.enqueue('purchasing');
    } catch (_) {
      // Queued on disk; the periodic sweeper is the backstop.
    }
    final now = sendNow;
    if (now != null) unawaited(Future.sync(now).catchError((Object _) {}));
  }

  List<Map<String, dynamic>> _rows(Object? body) => [for (final r in body as List<dynamic>) Map<String, dynamic>.from(r as Map)];

  // ── the shopping list ──────────────────────────────────────────────────

  @override
  Future<ShoppingView> shoppingList() async {
    final u = _user();
    try {
      final (batches, lines) = await _guard(() async => (await remote.batches(), await remote.shoppingList()));
      final at = _now();
      await db.putCache(u, 'batches', [for (final b in batches) b.toJson()], at);
      await db.putCache(u, 'shopping', [for (final l in lines) l.toJson()], at);
      return ShoppingView(lines: lines, batches: batches, fetchedAt: at);
    } catch (e) {
      if (PurFailure.of(e) == PurFailure.buyingOff) rethrow;
      final b = await db.cache(u, 'batches');
      final l = await db.cache(u, 'shopping');
      if (b == null || l == null) return ShoppingView(error: e);
      return ShoppingView(
        batches: _rows(b.body).map(PurBatch.fromJson).toList(),
        lines: _rows(l.body).map(ShoppingLine.fromJson).toList(),
        fetchedAt: l.at,
        fromCache: true,
        error: e,
      );
    }
  }

  @override
  Future<void> claim(PurPortion portion, {double? quantity}) async {
    final u = _user();
    await _guard(() => remote.assign(portion.id, u, quantity, userId: u));
  }

  @override
  Future<void> release(PurPortion portion) async {
    final u = _user();
    await _guard(() => remote.assign(portion.id, null, null, userId: u));
  }

  @override
  Future<void> setArranged(PurPortion portion, bool arranged) async {
    final u = _user();
    // Q6: on the phone, a buyer marks only their own portions.
    if (!portion.mine) throw const PurFailureException(PurFailure.notYourPortion);
    await _guard(() => remote.setArranged(portion.id, arranged, userId: u));
  }

  // ── choices ────────────────────────────────────────────────────────────

  @override
  Future<PurchaseChoices> choices() async {
    final u = _user();
    try {
      final (destinations, suppliers) = await _guard(() async => (await remote.destinations(), await remote.suppliers()));
      final at = _now();
      await db.putCache(u, 'destinations', [for (final d in destinations) d.toJson()], at);
      await db.putCache(u, 'suppliers', [for (final s in suppliers) s.toJson()], at);
      return PurchaseChoices(destinations: destinations, suppliers: suppliers);
    } catch (e) {
      if (PurFailure.of(e) == PurFailure.buyingOff) rethrow;
      final d = await db.cache(u, 'destinations');
      final s = await db.cache(u, 'suppliers');
      if (d == null || s == null) rethrow;
      return PurchaseChoices(
        destinations: _rows(d.body).map(PurDestination.fromJson).toList(),
        suppliers: _rows(s.body).map(Supplier.fromJson).toList(),
        fromCache: true,
      );
    }
  }

  // ── drafts ─────────────────────────────────────────────────────────────

  @override
  PurchaseDraft newDraft({List<DraftPurchaseLine> lines = const []}) {
    final at = _now();
    // The Manila date, never the phone's UTC date (PH is UTC+8).
    return PurchaseDraft(id: _newId(), createdAt: at.toUtc(), purchaseDate: isoDate(manilaDate(at)), lines: lines);
  }

  @override
  String newLineKey() => _newId();

  @override
  Future<List<PurchaseDraft>> drafts() async => db.drafts(_user(), queued: false);

  @override
  Future<void> saveDraft(PurchaseDraft draft) async => db.saveDraft(_user(), draft, _now());

  @override
  Future<void> deleteDraft(PurchaseDraft draft) async {
    final stored = await db.deleteUnsentDraft(_user(), draft.id);
    // A queued draft's photos are still owed to the server: never touch them.
    for (final p in stored?.photos.values ?? const <String>[]) {
      await discardPhoto(p);
    }
  }

  @override
  Future<String> keepPhoto(String draftId, String sourcePath) async {
    final dir = Directory('${(await photoDir()).path}${Platform.pathSeparator}$draftId');
    await dir.create(recursive: true);
    // No caption: a receipt must stay readable.
    return device.preparePhoto(source: sourcePath, target: '${dir.path}${Platform.pathSeparator}${_newId()}.jpg', caption: '');
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
  Future<void> send(PurchaseDraft draft) async {
    final problems = purchaseProblems(draft);
    if (problems.isNotEmpty) throw PurchaseInvalid(problems);
    final u = _user();
    final op = PurOp(
      opId: _newId(),
      userId: u,
      createdAt: _now().toUtc(),
      draftId: draft.id,
      purchase: purchaseBody(draft),
      companyId: companyOf(u),
      receipts: {
        if (!draft.noReceipt)
          for (final e in draft.photos.entries) e.key: ReceiptUpload(local: e.value, photoId: _newId()),
      },
    );
    // A second Send of the same draft (a double tap) queues nothing.
    if (await db.queueDraft(u, draft, op, _now())) await _kick();
  }

  // ── my purchases ───────────────────────────────────────────────────────

  @override
  Future<MyPurchasesView> myPurchases() async {
    final u = _user();
    List<Map<String, dynamic>>? docs;
    Object? error;
    DateTime? fetchedAt;
    var fromCache = false;
    try {
      final fresh = await _guard(remote.myPurchases);
      docs = fresh;
      fetchedAt = _now();
      await db.putCache(u, 'my_purchases', fresh, fetchedAt);
    } catch (e) {
      if (PurFailure.of(e) == PurFailure.buyingOff) rethrow;
      error = e;
      final cached = await db.cache(u, 'my_purchases');
      if (cached != null) {
        docs = _rows(cached.body);
        fetchedAt = cached.at;
        fromCache = true;
      }
    }
    final ops = {for (final o in await db.ops(u)) o.draftId: o};
    final queued = [
      for (final d in await db.drafts(u, queued: true))
        if (ops[d.id] case final op?)
          QueuedPurchase(
            draft: d,
            state: op.failedPermanently ? QueuedState.needsAttention : QueuedState.waiting,
            failure: op.failedPermanently ? PurFailure.fromStored(op.lastError) : null,
          ),
    ];
    return MyPurchasesView(
      queued: queued,
      purchases: [for (final d in docs ?? const <Map<String, dynamic>>[]) MyPurchase.fromJson(d)],
      fetchedAt: fetchedAt,
      fromCache: fromCache,
      error: (docs == null || fromCache) ? error : null,
    );
  }

  @override
  Future<bool> returnToDrafts(String draftId) => db.unqueueDraft(_user(), draftId);

  @override
  Future<void> discardRefused(String draftId) async {
    final stored = await db.discardRefused(_user(), draftId);
    for (final p in stored?.photos.values ?? const <String>[]) {
      await discardPhoto(p);
    }
  }

  @override
  Future<PurchaseDetail> purchase(String id) async {
    _user();
    return PurchaseDetail.fromJson(await _guard(() => remote.purchase(id)));
  }

  /// New receipt photos of a correction, uploaded now (corrections are online).
  Future<Map<String, String>> _upload(String u, Map<String, String> photos) async {
    if (photos.isEmpty) return const {};
    final company = companyOf(u) ?? await remote.company(u);
    final out = <String, String>{};
    for (final e in photos.entries) {
      final path = receiptPath(companyId: company, manilaNow: manilaFields(_now()), photoId: _newId());
      out[e.key] = await remote.uploadReceipt(path: path, localPath: e.value, companyId: company, userId: u);
    }
    return out;
  }

  @override
  Future<CorrectionResult> correct(PurchaseDetail purchase, Map<String, dynamic> body, String reason,
      {required String opId, Map<String, String> newPhotos = const {}}) async {
    final u = _user();
    final docs = await _guard(() => _upload(u, newPhotos));
    final sent = {...body, 'docs': {...?(body['docs'] as Map<String, dynamic>?), ...docs}};
    try {
      await _guard(() => remote.correct(opId, purchase.id, sent, reason, userId: u));
    } catch (e) {
      final f = PurFailure.of(e);
      if (f == PurFailure.ownerApprovalNeeded || f == PurFailure.completedProject) {
        return CorrectionResult(CorrectionOutcome.needsOwner, sent);
      }
      rethrow;
    }
    for (final p in newPhotos.values) {
      await discardPhoto(p);
    }
    return CorrectionResult(CorrectionOutcome.saved, sent);
  }

  @override
  Future<void> sendToOwner(PurchaseDetail purchase, Map<String, dynamic> body, String reason, {required String opId}) async {
    final u = _user();
    await _guard(() => remote.requestChange(opId, purchase.id, body, reason, userId: u));
  }

  @override
  Future<Uint8List?> receipt(String url) async {
    final hit = _receipts[url];
    if (hit != null) return hit;
    final bytes = await remote.receipt(url);
    if (bytes != null) _receipts[url] = bytes;
    return bytes;
  }

  @override
  Future<int> unsentFor(String userId) => db.unsentCount(userId);

  @override
  Future<void> keepOnly(String userId) async {
    if (userId != currentUserId() || userId.isEmpty) _receipts.clear();
    await db.keepCacheOnly(userId);
  }
}
```

**Create:** `lib/purchasing/domain/pur_failure.dart`

```dart
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart' show AuthRetryableFetchException;

import '../../attendance/ui/attendance_copy.dart' show Bilingual;

/// Every way a purchasing call can be refused (0096, 0097, 0101), reduced to
/// what the buyer can do about it. Anything unknown is [unexpected], never a
/// guess.
enum PurFailure {
  /// BUYER_REQUIRED (and the account checks before it): the Buyer switch is off (R2).
  buyingOff,
  completedProject,
  ownerApprovalNeeded,
  lineClosed,
  assignedToOther,
  notYourPortion,
  nothingToBuy,
  reductionPending,
  requestLinkChanged,
  extraReasonRequired,
  unplannedReasonRequired,
  substituteReasonRequired,
  splitMismatch,
  discountTooLarge,
  totalMismatch,
  badProject,
  badSupplier,
  noReceipt,
  notFound,
  alreadyVoided,
  linesChanged,
  alreadyPending,
  reasonRequired,
  invalid,

  /// A receipt photo of an unsent purchase is no longer on the phone.
  photoMissing,

  /// The company to file receipts under is not known yet (needs signal).
  noCompany,
  appUpdateRequired,
  sessionExpired,
  noConnection,
  unexpected;

  static const _byCode = <String, PurFailure>{
    'BUYER_REQUIRED': buyingOff,
    'NOT_OFFICE': buyingOff,
    'NOT_ALLOWED': buyingOff,
    'OFFICE_ONLY': buyingOff,
    'COMPLETED_PROJECT': completedProject,
    'OWNER_APPROVAL_NEEDED': ownerApprovalNeeded,
    'LINE_CLOSED': lineClosed,
    'ASSIGNED_TO_OTHER': assignedToOther,
    'NOT_YOUR_PORTION': notYourPortion,
    'NOTHING_TO_BUY': nothingToBuy,
    'REDUCTION_PENDING': reductionPending,
    'BAD_REQUEST_LINK': requestLinkChanged,
    'BAD_PORTION': requestLinkChanged,
    'EXTRA_REASON_REQUIRED': extraReasonRequired,
    'UNPLANNED_REASON_REQUIRED': unplannedReasonRequired,
    'SUBSTITUTE_REASON_REQUIRED': substituteReasonRequired,
    'SPLIT_MISMATCH': splitMismatch,
    'DISCOUNT_TOO_LARGE': discountTooLarge,
    'TOTAL_MISMATCH': totalMismatch,
    'BAD_PROJECT': badProject,
    'BAD_DESTINATION': badProject,
    'AW_NO_PERIOD': badProject,
    'BAD_SUPPLIER': badSupplier,
    'NO_RECEIPT': noReceipt,
    'NOT_FOUND': notFound,
    'BAD_STATE': alreadyVoided,
    'LINES_CHANGED': linesChanged,
    'ALREADY_PENDING': alreadyPending,
    'REASON_REQUIRED': reasonRequired,
    'BAD_DATE': invalid,
    'BAD_AMOUNT': invalid,
    'BAD_LINES': invalid,
    'BAD_CHARGES': invalid,
    'BAD_QUANTITY': invalid,
    'BAD_NAME': invalid,
    'BAD_EXTRA': invalid,
    'BAD_DOCS': invalid,
    'BAD_REASON': invalid,
    'BAD_BUYER': invalid,
    'BAD_SOURCE': invalid,
    'BAD_KIND': invalid,
    'BAD_OP': invalid,
    'PHOTO_MISSING': photoMissing,
    'NO_COMPANY': noCompany,
    'APP_UPDATE_REQUIRED': appUpdateRequired,
    'AUTH_REQUIRED': sessionExpired,
  };

  static PurFailure of(Object error) {
    if (error is PurFailureException) return error.failure;
    if (error is IOException ||
        error is TimeoutException ||
        error is http.ClientException ||
        error is AuthRetryableFetchException) {
      return noConnection;
    }
    // Whole codes only: REASON_REQUIRED is part of three longer codes.
    for (final m in RegExp(r'[A-Z][A-Z_]{2,}[A-Z]').allMatches(error.toString())) {
      final f = _byCode[m.group(0)];
      if (f != null) return f;
    }
    return unexpected;
  }

  /// A stored failure name back to the failure.
  static PurFailure fromStored(String? name) => values.where((f) => f.name == name).firstOrNull ?? unexpected;

  /// Worth sending again later: the connection, the session or the moment —
  /// never the purchase's own content, which would be refused again.
  bool get retryable => switch (this) {
        noConnection || sessionExpired || appUpdateRequired || noCompany || unexpected => true,
        _ => false,
      };

  /// Only these count toward [maxPurchaseAttempts]: waiting for signal, a
  /// session or an update never gives a purchase up.
  bool get countsTowardCap => this == unexpected;
}

/// An [unexpected] failure this many times in a row stops being retried, so
/// one bad purchase cannot block the queue forever. It stays on the phone.
const maxPurchaseAttempts = 10;

/// A failure decided on the phone (no server code to read).
class PurFailureException implements Exception {
  const PurFailureException(this.failure);
  final PurFailure failure;
  @override
  String toString() => 'PurFailureException(${failure.name})';
}

/// English, then Tagalog (Q22).
Bilingual purFailureCopy(PurFailure f) => switch (f) {
      PurFailure.buyingOff => const Bilingual(
          'Buying is turned off for your account.', 'Naka-off ang pagbili sa account mo.'),
      PurFailure.completedProject => const Bilingual(
          'That project is completed. Only the owner can change it: send it to the owner.',
          'Tapos na ang project na iyon. Ang may-ari lang ang puwedeng magbago: ipadala sa may-ari.'),
      PurFailure.ownerApprovalNeeded => const Bilingual(
          'Only the owner can make this change: send it to the owner.',
          'Ang may-ari lang ang puwedeng gumawa ng pagbabagong ito: ipadala sa may-ari.'),
      PurFailure.lineClosed => const Bilingual(
          'That request was cancelled. Remove it from this purchase, or record it as unplanned.',
          'Kinansela ang request na iyon. Alisin ito sa purchase, o itala bilang hindi planado.'),
      PurFailure.assignedToOther => const Bilingual(
          'Another buyer has that item now. Refresh the list.', 'May ibang bumibili na niyan. I-refresh ang listahan.'),
      PurFailure.notYourPortion => const Bilingual(
          'Only the buyer who has it can release it.', 'Ang bumibili lang nito ang puwedeng mag-release.'),
      PurFailure.nothingToBuy => const Bilingual(
          'Nothing is left to buy on that item. Refresh the list.', 'Wala nang kulang na bibilhin diyan. I-refresh ang listahan.'),
      PurFailure.reductionPending => const Bilingual(
          'The office is checking a smaller quantity on this item. Try again later.',
          'Sinusuri ng opisina ang binawasang dami nito. Subukan ulit mamaya.'),
      PurFailure.requestLinkChanged => const Bilingual(
          'The request changed since you picked it. Refresh the list and record again.',
          'Nagbago ang request mula nang piliin mo. I-refresh ang listahan at itala ulit.'),
      PurFailure.extraReasonRequired => const Bilingual(
          'You bought more than is still needed. Say why, and where the extra goes.',
          'Sobra ang nabili sa kailangan. Sabihin kung bakit, at saan mapupunta ang sobra.'),
      PurFailure.unplannedReasonRequired => const Bilingual(
          'An item with no request needs a reason.', 'Kailangan ng dahilan ang item na walang request.'),
      PurFailure.substituteReasonRequired => const Bilingual(
          'A substitute needs a reason.', 'Kailangan ng dahilan ang pamalit.'),
      PurFailure.splitMismatch => const Bilingual(
          'The fee or discount split does not add up. Check the shares.',
          'Hindi tugma ang hati ng bayad o diskwento. Suriin ang mga hati.'),
      PurFailure.discountTooLarge => const Bilingual(
          'A discount is bigger than the item it is on. Check the split.',
          'Mas malaki ang diskwento kaysa sa item. Suriin ang hati.'),
      PurFailure.totalMismatch => const Bilingual(
          'The lines, fees and discounts do not add up to the receipt total.',
          'Hindi tugma ang kabuuan ng mga item, bayad at diskwento sa total ng resibo.'),
      PurFailure.badProject => const Bilingual(
          'That project or job is no longer open. Choose another.', 'Sarado na ang project o trabahong iyon. Pumili ng iba.'),
      PurFailure.badSupplier => const Bilingual(
          'That supplier is no longer on the list. Choose another or type the name.',
          'Wala na sa listahan ang supplier na iyon. Pumili ng iba o i-type ang pangalan.'),
      PurFailure.noReceipt => const Bilingual(
          'Add a receipt photo, or tap No receipt and say why.', 'Maglagay ng litrato ng resibo, o pindutin ang Walang resibo at sabihin kung bakit.'),
      PurFailure.notFound => const Bilingual(
          'That is no longer there. Refresh and try again.', 'Wala na iyon. I-refresh at subukan ulit.'),
      PurFailure.alreadyVoided => const Bilingual(
          'That purchase is no longer recorded (it was voided or replaced).',
          'Hindi na nakatala ang purchase na iyon (na-void o napalitan).'),
      PurFailure.linesChanged => const Bilingual(
          'The purchase changed on the office side. Open it again.', 'Nagbago ang purchase sa opisina. Buksan ulit.'),
      PurFailure.alreadyPending => const Bilingual(
          'A change for this purchase is already waiting for the owner.', 'May pagbabago nang naghihintay sa may-ari para dito.'),
      PurFailure.reasonRequired => const Bilingual(
          'Say why you are changing it.', 'Sabihin kung bakit mo ito binabago.'),
      PurFailure.invalid => const Bilingual(
          'Something on the purchase is not filled in correctly. Check each line.',
          'May mali sa pagkakapuno ng purchase. Suriin ang bawat linya.'),
      PurFailure.photoMissing => const Bilingual(
          'A receipt photo is no longer on this phone. Take it again.', 'Wala na sa phone ang litrato ng resibo. Kunan ulit.'),
      PurFailure.noCompany => const Bilingual(
          'Connect to the internet once so WorkMate can file your receipts.',
          'Kumonekta muna sa internet para mai-file ng WorkMate ang mga resibo mo.'),
      PurFailure.appUpdateRequired => const Bilingual(
          'Update WorkMate to send this.', 'I-update ang WorkMate para maipadala ito.'),
      PurFailure.sessionExpired => const Bilingual(
          'Sign in again to send this.', 'Mag-sign in ulit para maipadala ito.'),
      PurFailure.noConnection => const Bilingual(
          'No signal right now. Try again in a moment.', 'Walang signal ngayon. Subukan ulit mamaya.'),
      PurFailure.unexpected => const Bilingual(
          'Something went wrong. Try again.', 'May nasira. Subukan ulit.'),
    };
```

**Create:** `lib/purchasing/domain/pur_models.dart`

```dart
/// What the purchasing server functions (0097, 0101) return, as the phone
/// reads it. Numbers arrive as JSON numbers or numeric text; both are read.
library;

double _num(Object? v) => switch (v) {
      num n => n.toDouble(),
      String s => double.tryParse(s) ?? 0,
      _ => 0,
    };

String _str(Object? v) => v == null ? '' : v.toString();

DateTime? _time(Object? v) => v == null ? null : DateTime.tryParse(v.toString())?.toUtc();

List<Map<String, dynamic>> _rows(Object? v) => [for (final r in (v as List<dynamic>? ?? const [])) Map<String, dynamic>.from(r as Map)];

/// One weekly batch (0086 `pr_office_batches`).
class PurBatch {
  const PurBatch({required this.id, required this.cutoffAt, this.purchaseOn, this.deliveryOn});

  factory PurBatch.fromJson(Map<String, dynamic> j) => PurBatch(
        id: _str(j['id']),
        cutoffAt: _time(j['cutoff_at']) ?? DateTime.utc(1970),
        purchaseOn: j['purchase_on'] as String?,
        deliveryOn: j['delivery_on'] as String?,
      );

  final String id;
  final DateTime cutoffAt;
  final String? purchaseOn;
  final String? deliveryOn;

  Map<String, dynamic> toJson() =>
      {'id': id, 'cutoff_at': cutoffAt.toIso8601String(), 'purchase_on': purchaseOn, 'delivery_on': deliveryOn};

  /// "This week" (Q4): the first batch whose cutoff is still ahead — the
  /// rule the Purchasing tab uses for its default batch.
  static PurBatch? current(List<PurBatch> batches, DateTime now) {
    final ahead = batches.where((b) => b.cutoffAt.isAfter(now)).toList()..sort((a, b) => a.cutoffAt.compareTo(b.cutoffAt));
    return ahead.firstOrNull;
  }
}

/// One portion of a request line (0097 `pur_shopping_list` → portions).
class PurPortion {
  const PurPortion({
    required this.id,
    required this.batchId,
    this.cutoffAt,
    this.quantity = 0,
    this.pendingReduction = 0,
    this.bought = 0,
    this.stillToBuy = 0,
    this.arranged = false,
    this.buyerId,
    this.buyerName,
    this.mine = false,
    this.changed = false,
  });

  factory PurPortion.fromJson(Map<String, dynamic> j) => PurPortion(
        id: _str(j['id']),
        batchId: _str(j['batch_id']),
        cutoffAt: _time(j['cutoff_at']),
        quantity: _num(j['quantity']),
        pendingReduction: _num(j['pending_reduction']),
        bought: _num(j['bought']),
        stillToBuy: _num(j['still_to_buy']),
        arranged: j['arranged'] == true,
        buyerId: j['buyer_id'] as String?,
        buyerName: j['buyer_name'] as String?,
        mine: j['mine'] == true,
        changed: j['changed'] == true,
      );

  final String id;
  final String batchId;
  final DateTime? cutoffAt;
  final double quantity;
  final double pendingReduction;
  final double bought;
  final double stillToBuy;
  final bool arranged;
  final String? buyerId;
  final String? buyerName;
  final bool mine;

  /// The request's quantity changed after this portion was assigned.
  final bool changed;

  bool get unassigned => buyerId == null;

  Map<String, dynamic> toJson() => {
        'id': id,
        'batch_id': batchId,
        'cutoff_at': cutoffAt?.toIso8601String(),
        'quantity': quantity,
        'pending_reduction': pendingReduction,
        'bought': bought,
        'still_to_buy': stillToBuy,
        'arranged': arranged,
        'buyer_id': buyerId,
        'buyer_name': buyerName,
        'mine': mine,
        'changed': changed,
      };
}

/// One request line still to buy (0097 `pur_shopping_list`).
class ShoppingLine {
  const ShoppingLine({
    required this.lineId,
    required this.requestId,
    this.description = '',
    this.spec = '',
    this.unit = '',
    this.category = '',
    this.urgent = false,
    this.urgentReason = '',
    this.neededBy,
    this.notes = '',
    this.projectId = '',
    this.projectName = '',
    this.workId = '',
    this.workName = '',
    this.requesterName = '',
    this.needed = 0,
    this.bought = 0,
    this.stillToBuy = 0,
    this.unitChecks = 0,
    this.portions = const [],
  });

  factory ShoppingLine.fromJson(Map<String, dynamic> j) => ShoppingLine(
        lineId: _str(j['line_id']),
        requestId: _str(j['request_id']),
        description: _str(j['description']),
        spec: _str(j['spec']),
        unit: _str(j['unit']),
        category: _str(j['category']),
        urgent: j['urgent'] == true,
        urgentReason: _str(j['urgent_reason']),
        neededBy: j['needed_by'] as String?,
        notes: _str(j['notes']),
        projectId: _str(j['project_id']),
        projectName: _str(j['project_name']),
        workId: _str(j['work_id']),
        workName: _str(j['work_name']),
        requesterName: _str(j['requester_name']),
        needed: _num(j['needed']),
        bought: _num(j['bought']),
        stillToBuy: _num(j['still_to_buy']),
        unitChecks: _num(j['unit_checks']).toInt(),
        portions: _rows(j['portions']).map(PurPortion.fromJson).toList(),
      );

  final String lineId;
  final String requestId;
  final String description;
  final String spec;
  final String unit;
  final String category;
  final bool urgent;
  final String urgentReason;
  final String? neededBy;
  final String notes;
  final String projectId;
  final String projectName;

  /// The project or Additional Works job the request is for — where a
  /// purchase for it must go (0097 BAD_REQUEST_LINK otherwise).
  final String workId;
  final String workName;
  final String requesterName;
  final double needed;
  final double bought;
  final double stillToBuy;
  final int unitChecks;
  final List<PurPortion> portions;

  Map<String, dynamic> toJson() => {
        'line_id': lineId,
        'request_id': requestId,
        'description': description,
        'spec': spec,
        'unit': unit,
        'category': category,
        'urgent': urgent,
        'urgent_reason': urgentReason,
        'needed_by': neededBy,
        'notes': notes,
        'project_id': projectId,
        'project_name': projectName,
        'work_id': workId,
        'work_name': workName,
        'requester_name': requesterName,
        'needed': needed,
        'bought': bought,
        'still_to_buy': stillToBuy,
        'unit_checks': unitChecks,
        'portions': [for (final p in portions) p.toJson()],
      };

  /// "Santos Townhouse · AW-03 Fence"; the main contract shows the project alone.
  String get placeLabel => workName.isEmpty || workName == 'Main Contract' ? projectName : '$projectName · $workName';
}

/// An Additional Works job under an open project (0101 `pur_destinations`).
class PurWork {
  const PurWork({required this.folderId, required this.name});
  factory PurWork.fromJson(Map<String, dynamic> j) => PurWork(folderId: _str(j['folder_id']), name: _str(j['name']));
  final String folderId;
  final String name;
  Map<String, dynamic> toJson() => {'folder_id': folderId, 'name': name};
}

/// An open project a phone purchase may go to, with its open jobs (Q11).
class PurDestination {
  const PurDestination({required this.folderId, required this.name, this.works = const []});
  factory PurDestination.fromJson(Map<String, dynamic> j) => PurDestination(
        folderId: _str(j['folder_id']),
        name: _str(j['name']),
        works: _rows(j['works']).map(PurWork.fromJson).toList(),
      );
  final String folderId;
  final String name;
  final List<PurWork> works;
  Map<String, dynamic> toJson() => {'folder_id': folderId, 'name': name, 'works': [for (final w in works) w.toJson()]};
}

/// A supplier from the company's list (0097 `pur_suppliers`).
class Supplier {
  const Supplier({required this.id, required this.name, this.branch = '', this.active = true});
  factory Supplier.fromJson(Map<String, dynamic> j) =>
      Supplier(id: _str(j['id']), name: _str(j['name']), branch: _str(j['branch']), active: j['active'] != false);
  final String id;
  final String name;
  final String branch;
  final bool active;

  /// How the server writes it on the purchase: "Name · Branch".
  String get label => branch.isEmpty ? name : '$name · $branch';
  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'branch': branch, 'active': active};
}

/// One row of My purchases (0101 `pur_my_purchases` → `pur_list_doc`).
class MyPurchase {
  const MyPurchase({
    required this.id,
    required this.status,
    this.source = '',
    this.purchaseDate = '',
    this.supplier = '',
    this.receiptTotal = 0,
    this.projects = const [],
    this.warehouse = false,
    this.lines = 0,
    this.unplanned = false,
    this.extra = false,
    this.unitCheck = false,
    this.needsReview = false,
    this.pendingChange = false,
    this.noReceiptReason = '',
    this.replacedBy,
  });

  factory MyPurchase.fromJson(Map<String, dynamic> j) => MyPurchase(
        id: _str(j['id']),
        status: _str(j['status']),
        source: _str(j['source']),
        purchaseDate: _str(j['purchase_date']),
        supplier: _str(j['supplier']),
        receiptTotal: _num(j['receipt_total']),
        projects: [for (final p in (j['projects'] as List<dynamic>? ?? const [])) p.toString()],
        warehouse: j['warehouse'] == true,
        lines: _num(j['lines']).toInt(),
        unplanned: j['unplanned'] == true,
        extra: j['extra'] == true,
        unitCheck: j['unit_check'] == true,
        needsReview: j['needs_review'] == true,
        pendingChange: j['pending_change'] == true,
        noReceiptReason: _str(j['no_receipt_reason']),
        replacedBy: j['replaced_by'] as String?,
      );

  final String id;
  final String status;
  final String source;
  final String purchaseDate;
  final String supplier;
  final double receiptTotal;
  final List<String> projects;
  final bool warehouse;
  final int lines;
  final bool unplanned;
  final bool extra;
  final bool unitCheck;
  final bool needsReview;
  final bool pendingChange;
  final String noReceiptReason;
  final String? replacedBy;

  bool get voided => status == 'void';
}

/// A fee or discount on a stored purchase, with its split by line number.
class PurchaseCharge {
  const PurchaseCharge({required this.kind, required this.amount, this.shares = const {}});
  factory PurchaseCharge.fromJson(Map<String, dynamic> j) => PurchaseCharge(
        kind: _str(j['kind']),
        amount: _num(j['amount']),
        shares: {for (final s in _rows(j['shares'])) _num(s['line']).toInt(): _num(s['amount'])},
      );
  final String kind;
  final double amount;

  /// line number (1-based) → share.
  final Map<int, double> shares;
}

/// One line of a stored purchase (0097 `pur_doc` → lines).
class PurchaseLine {
  const PurchaseLine({
    required this.line,
    this.destination = 'project',
    this.folderId,
    this.folderName = '',
    this.itemName = '',
    this.category = '',
    this.quantity = 0,
    this.unit = '',
    this.amount = 0,
    this.requestLineId,
    this.covered = 0,
    this.extra = 0,
    this.unitCheck = 'none',
    this.unplannedReason = '',
    this.substitute = false,
  });

  factory PurchaseLine.fromJson(Map<String, dynamic> j) => PurchaseLine(
        line: _num(j['line']).toInt(),
        destination: _str(j['destination']).isEmpty ? 'project' : _str(j['destination']),
        folderId: j['folder_id'] as String?,
        folderName: _str(j['folder_name']),
        itemName: _str(j['item_name']),
        category: _str(j['category']),
        quantity: _num(j['quantity']),
        unit: _str(j['unit']),
        amount: _num(j['amount']),
        requestLineId: j['request_line_id'] as String?,
        covered: _num(j['covered']),
        extra: _num(j['extra']),
        unitCheck: _str(j['unit_check']).isEmpty ? 'none' : _str(j['unit_check']),
        unplannedReason: _str(j['unplanned_reason']),
        substitute: j['substitute'] == true,
      );

  final int line;
  final String destination;
  final String? folderId;
  final String folderName;
  final String itemName;
  final String category;
  final double quantity;
  final String unit;
  final double amount;
  final String? requestLineId;
  final double covered;
  final double extra;

  /// 'none' | 'pending' | 'confirmed' — a different unit or a substitute
  /// counts toward its request only after the office check.
  final String unitCheck;
  final String unplannedReason;
  final bool substitute;
}

/// A change sent to the owner about a purchase.
class PurchaseChangeRequest {
  const PurchaseChangeRequest({required this.kind, required this.status, this.reason = '', this.decisionNote = ''});
  factory PurchaseChangeRequest.fromJson(Map<String, dynamic> j) => PurchaseChangeRequest(
      kind: _str(j['kind']), status: _str(j['status']), reason: _str(j['reason']), decisionNote: _str(j['decision_note']));
  final String kind;
  final String status;
  final String reason;
  final String decisionNote;
}

/// The four receipt photo slots a purchase keeps (0096 docs) — the same four
/// the Purchasing tab offers.
const receiptSlots = ['supplier_invoice_url', 'payment_receipt_url', 'delivery_receipt_url', 'po_image_url'];

/// One purchase in full (0097 `pur_purchase` → `pur_purchase_view`, 0101).
class PurchaseDetail {
  const PurchaseDetail({
    required this.id,
    required this.status,
    this.source = '',
    this.purchaseDate = '',
    this.dateTime = '',
    this.supplier = '',
    this.supplierId,
    this.boughtBy,
    this.receiptTotal = 0,
    this.notes = '',
    this.paymentMethod = '',
    this.docs = const {},
    this.lines = const [],
    this.charges = const [],
    this.recordedByName = '',
    this.boughtByName = '',
    this.noReceiptReason = '',
    this.replacedBy,
    this.changeRequests = const [],
  });

  factory PurchaseDetail.fromJson(Map<String, dynamic> j) => PurchaseDetail(
        id: _str(j['id']),
        status: _str(j['status']),
        source: _str(j['source']),
        purchaseDate: _str(j['purchase_date']),
        dateTime: _str(j['date_time']),
        supplier: _str(j['supplier']),
        supplierId: j['supplier_id'] as String?,
        boughtBy: j['bought_by'] as String?,
        receiptTotal: _num(j['receipt_total']),
        notes: _str(j['notes']),
        paymentMethod: _str(j['payment_method']),
        docs: {
          for (final e in Map<String, dynamic>.from((j['docs'] as Map?) ?? const {}).entries)
            if (receiptSlots.contains(e.key) && e.value is String && (e.value as String).isNotEmpty) e.key: e.value as String,
        },
        lines: _rows(j['lines']).map(PurchaseLine.fromJson).toList(),
        charges: _rows(j['charges']).map(PurchaseCharge.fromJson).toList(),
        recordedByName: _str(j['recorded_by_name']),
        boughtByName: _str(j['bought_by_name']),
        noReceiptReason: _str(j['no_receipt_reason']),
        replacedBy: j['replaced_by'] as String?,
        changeRequests: _rows(j['change_requests']).map(PurchaseChangeRequest.fromJson).toList(),
      );

  final String id;
  final String status;
  final String source;
  final String purchaseDate;
  final String dateTime;
  final String supplier;
  final String? supplierId;
  final String? boughtBy;
  final double receiptTotal;
  final String notes;
  final String paymentMethod;

  /// slot → stored link (public-format URL in the private `uploads` bucket).
  final Map<String, String> docs;
  final List<PurchaseLine> lines;
  final List<PurchaseCharge> charges;
  final String recordedByName;
  final String boughtByName;
  final String noReceiptReason;
  final String? replacedBy;
  final List<PurchaseChangeRequest> changeRequests;

  bool get recorded => status == 'recorded';
  bool get waitingForOwner => changeRequests.any((r) => r.status == 'pending');
  bool get needsOfficeCheck => lines.any((l) => l.unitCheck == 'pending');
}
```

**Create:** `lib/purchasing/domain/pur_op.dart`

```dart
import 'dart:convert';

/// One receipt photo of a queued purchase: the file on the phone and, once
/// uploaded, where it went. [photoId] is minted once, at Send, so a retry
/// uploads to the same place.
class ReceiptUpload {
  const ReceiptUpload({required this.local, required this.photoId, this.path, this.url});

  factory ReceiptUpload.fromJson(Map<String, dynamic> j) => ReceiptUpload(
        local: j['local'] as String,
        photoId: j['photo_id'] as String,
        path: j['path'] as String?,
        url: j['url'] as String?,
      );

  final String local;
  final String photoId;

  /// `purchases/<company>/<yyyy-mm>/<photoId>.jpg`, fixed at the first attempt.
  final String? path;

  /// Set once the file is in storage.
  final String? url;

  ReceiptUpload withPath(String p) => ReceiptUpload(local: local, photoId: photoId, path: p, url: url);
  ReceiptUpload withUrl(String u) => ReceiptUpload(local: local, photoId: photoId, path: path, url: u);

  Map<String, dynamic> toJson() => {'local': local, 'photo_id': photoId, 'path': path, 'url': url};
}

/// One purchase waiting to be recorded (Q7: "Waiting to send"). [opId] is
/// minted once, at Send, and reused on every retry: pur_record answers a
/// repeated op id with its first answer, so it is recorded once.
class PurOp {
  const PurOp({
    required this.opId,
    required this.userId,
    required this.createdAt,
    required this.purchase,
    this.kind = 'record',
    this.draftId,
    this.companyId,
    this.receipts = const {},
    this.seq = 0,
    this.attempts = 0,
    this.lastError,
    this.failedPermanently = false,
  });

  factory PurOp.fromMap(Map<String, Object?> m) {
    final body = Map<String, dynamic>.from(jsonDecode(m['body']! as String) as Map);
    return PurOp(
      opId: m['op_id']! as String,
      userId: m['user_id']! as String,
      kind: m['kind']! as String,
      createdAt: DateTime.fromMillisecondsSinceEpoch(m['created_at']! as int, isUtc: true),
      draftId: m['draft_id'] as String?,
      purchase: Map<String, dynamic>.from(body['purchase'] as Map),
      companyId: body['company_id'] as String?,
      receipts: {
        for (final e in Map<String, dynamic>.from((body['receipts'] as Map?) ?? const {}).entries)
          e.key: ReceiptUpload.fromJson(Map<String, dynamic>.from(e.value as Map)),
      },
      seq: (m['seq'] as int?) ?? 0,
      attempts: (m['attempts'] as int?) ?? 0,
      lastError: m['last_error'] as String?,
      failedPermanently: m['failed_permanently'] == 1,
    );
  }

  final String opId;

  /// Who queued it. Every read and every send is scoped to ONE account.
  final String userId;
  final String kind;
  final DateTime createdAt;
  final String? draftId;

  /// The pur_record body, without its receipt links.
  final Map<String, dynamic> purchase;

  /// The company the receipts file under; resolved at the first attempt
  /// when this phone did not know it yet.
  final String? companyId;

  /// Receipt slot → its photo.
  final Map<String, ReceiptUpload> receipts;
  final int seq;
  final int attempts;
  final String? lastError;
  final bool failedPermanently;

  Map<String, dynamic> get bodyJson => {
        'purchase': purchase,
        'company_id': companyId,
        'receipts': {for (final e in receipts.entries) e.key: e.value.toJson()},
      };

  PurOp copyWith({String? companyId, Map<String, ReceiptUpload>? receipts}) => PurOp(
        opId: opId,
        userId: userId,
        createdAt: createdAt,
        purchase: purchase,
        kind: kind,
        draftId: draftId,
        companyId: companyId ?? this.companyId,
        receipts: receipts ?? this.receipts,
        seq: seq,
        attempts: attempts,
        lastError: lastError,
        failedPermanently: failedPermanently,
      );

  Map<String, Object?> toMap() => {
        'op_id': opId,
        'user_id': userId,
        'kind': kind,
        'draft_id': draftId,
        'body': jsonEncode(bodyJson),
        'seq': seq,
        'attempts': attempts,
        'last_error': lastError,
        'failed_permanently': failedPermanently ? 1 : 0,
        'created_at': createdAt.millisecondsSinceEpoch,
      };
}

/// `purchases/<company>/<yyyy-mm>/<photo>.jpg` — the only shape 0097's
/// receipt_uploads check and the buyer-only storage rule accept. The month is
/// Manila's ([manilaNow] already shifted), as the web's local-parts month.
String receiptPath({required String companyId, required DateTime manilaNow, required String photoId}) {
  final ym = '${manilaNow.year.toString().padLeft(4, '0')}-${manilaNow.month.toString().padLeft(2, '0')}';
  return 'purchases/${companyId.toLowerCase()}/$ym/${photoId.toLowerCase()}.jpg';
}
```

**Create:** `lib/purchasing/domain/purchase_draft.dart`

```dart
import '../../requests/domain/quantity.dart';
import 'pur_models.dart';

const _keep = Object();

/// Pesos as the server takes them (0096 pur_money): 0 or more, at most two
/// decimals. Commas are allowed while typing ("1,250.50").
double? parseMoney(String text) {
  final t = text.trim().replaceAll(',', '');
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(t)) return null;
  return double.parse(t);
}

double round2(num v) => (v * 100).roundToDouble() / 100;
double round3(num v) => (v * 1000).roundToDouble() / 1000;

/// The server's default split of a fee or discount (0096 pur_prorate, and the
/// Purchasing tab's prorate): each share rounded DOWN to the centavo, then
/// the centavos left over one each to the biggest remainders, the earliest
/// line on a tie. Always adds up to [total].
List<double> prorate(double total, List<double> weights) {
  final n = weights.length;
  if (n == 0) return const [];
  final ws = [for (final w in weights) w > 0 ? w : 0.0];
  final sum = ws.fold<double>(0, (a, b) => a + b);
  if (sum <= 0) return prorate(total, List.filled(n, 1));
  final cents = (total * 100).round();
  final exact = [for (final w in ws) cents * w / sum];
  final out = [for (final x in exact) (x + 1e-9).floor()];
  var left = cents - out.fold<int>(0, (a, b) => a + b);
  final order = List.generate(n, (i) => i)
    ..sort((a, b) {
      final ra = exact[a] - (exact[a] + 1e-9).floor();
      final rb = exact[b] - (exact[b] + 1e-9).floor();
      final c = rb.compareTo(ra);
      return c != 0 ? c : a.compareTo(b);
    });
  for (var k = 0; k < order.length && left > 0; k++, left--) {
    out[order[k]] += 1;
  }
  return [for (final c in out) c / 100];
}

String _norm(String s) => s.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();

/// Is the bought thing the item that was requested? (Q10)
enum LineMatch {
  /// The very item, as named on the request.
  same,

  /// The same item, named in other words.
  otherWords,

  /// An important specification differs. Needs a reason; counts only after
  /// the office check.
  substitute;

  static LineMatch parse(String? v) => values.where((m) => m.name == v).firstOrNull ?? same;
}

/// A portion of the request this line buys (0097 portion_picks), with the
/// Still to buy it had when picked (for the preview only — the server
/// decides).
class PortionPick {
  const PortionPick({required this.portionId, required this.quantity, required this.still});
  factory PortionPick.fromJson(Map<String, dynamic> j) => PortionPick(
        portionId: j['portion_id'] as String,
        quantity: (j['quantity'] as num).toDouble(),
        still: (j['still'] as num).toDouble(),
      );
  final String portionId;
  final double quantity;
  final double still;
  Map<String, dynamic> toJson() => {'portion_id': portionId, 'quantity': quantity, 'still': still};
}

/// One line of a purchase being recorded on the phone. Numbers stay the
/// text the buyer typed until sending.
class DraftPurchaseLine {
  const DraftPurchaseLine({
    required this.key,
    this.itemName = '',
    this.quantity = '',
    this.unit = '',
    this.amount = '',
    this.category = '',
    this.destination = 'project',
    this.folderId,
    this.folderLabel = '',
    this.requestLineId,
    this.requestName = '',
    this.requestUnit = '',
    this.picks = const [],
    this.match = LineMatch.same,
    this.substituteReason = '',
    this.unitNote = '',
    this.extraReason = '',
    this.extraLocation,
    this.unplannedReason = '',
  });

  /// A line for request portions picked from the shopping list: the item,
  /// unit and place come from the request; the quantity is what is still to
  /// buy on the picked portions.
  factory DraftPurchaseLine.fromShopping(String key, ShoppingLine line, List<PurPortion> portions) {
    final picks = [
      for (final p in portions)
        if (p.stillToBuy > 0) PortionPick(portionId: p.id, quantity: p.stillToBuy, still: p.stillToBuy),
    ];
    final qty = picks.fold<double>(0, (a, p) => a + p.quantity);
    return DraftPurchaseLine(
      key: key,
      itemName: line.description,
      quantity: qty > 0 ? formatQuantity(qty).replaceAll(',', '') : '',
      unit: line.unit,
      category: line.category,
      folderId: line.workId,
      folderLabel: line.placeLabel,
      requestLineId: line.lineId,
      requestName: line.description,
      requestUnit: line.unit,
      picks: picks,
    );
  }

  factory DraftPurchaseLine.fromJson(Map<String, dynamic> j) => DraftPurchaseLine(
        key: j['key'] as String,
        itemName: (j['item_name'] as String?) ?? '',
        quantity: (j['quantity'] as String?) ?? '',
        unit: (j['unit'] as String?) ?? '',
        amount: (j['amount'] as String?) ?? '',
        category: (j['category'] as String?) ?? '',
        destination: (j['destination'] as String?) ?? 'project',
        folderId: j['folder_id'] as String?,
        folderLabel: (j['folder_label'] as String?) ?? '',
        requestLineId: j['request_line_id'] as String?,
        requestName: (j['request_name'] as String?) ?? '',
        requestUnit: (j['request_unit'] as String?) ?? '',
        picks: [for (final p in (j['picks'] as List<dynamic>? ?? const [])) PortionPick.fromJson(Map<String, dynamic>.from(p as Map))],
        match: LineMatch.parse(j['match'] as String?),
        substituteReason: (j['substitute_reason'] as String?) ?? '',
        unitNote: (j['unit_note'] as String?) ?? '',
        extraReason: (j['extra_reason'] as String?) ?? '',
        extraLocation: j['extra_location'] as String?,
        unplannedReason: (j['unplanned_reason'] as String?) ?? '',
      );

  final String key;
  final String itemName;
  final String quantity;
  final String unit;
  final String amount;
  final String category;

  /// 'project' (a project or one of its jobs, [folderId]) or 'warehouse'.
  final String destination;
  final String? folderId;
  final String folderLabel;
  final String? requestLineId;
  final String requestName;
  final String requestUnit;
  final List<PortionPick> picks;
  final LineMatch match;
  final String substituteReason;

  /// Phone rule (Q10): why a different unit was bought. Kept in the
  /// purchase's notes — the server has no field for it.
  final String unitNote;
  final String extraReason;

  /// Where an extra goes: 'project' or 'warehouse'. Never moves the cost.
  final String? extraLocation;
  final String unplannedReason;

  bool get linked => requestLineId != null;

  /// Same unit as the request and not a substitute: it counts toward Bought
  /// at once; otherwise it waits for the office check (0097 pur_cover_lines).
  bool get countsDirectly => _norm(unit) == _norm(requestUnit) && match != LineMatch.substitute;

  bool get differentUnit => linked && _norm(unit) != _norm(requestUnit);

  /// What the picked portions can still take.
  double get pickedStill => round3(picks.fold<double>(0, (a, p) => a + (p.quantity < p.still ? p.quantity : p.still)));

  /// More than the picked portions still need: an extra (Q11).
  double get extraQuantity {
    if (!linked || !countsDirectly) return 0;
    final q = parseQuantity(quantity) ?? 0;
    return q > pickedStill ? round3(q - pickedStill) : 0;
  }

  DraftPurchaseLine copyWith({
    String? itemName,
    String? quantity,
    String? unit,
    String? amount,
    String? category,
    String? destination,
    Object? folderId = _keep,
    String? folderLabel,
    LineMatch? match,
    String? substituteReason,
    String? unitNote,
    String? extraReason,
    Object? extraLocation = _keep,
    String? unplannedReason,
  }) =>
      DraftPurchaseLine(
        key: key,
        itemName: itemName ?? this.itemName,
        quantity: quantity ?? this.quantity,
        unit: unit ?? this.unit,
        amount: amount ?? this.amount,
        category: category ?? this.category,
        destination: destination ?? this.destination,
        folderId: identical(folderId, _keep) ? this.folderId : folderId as String?,
        folderLabel: folderLabel ?? this.folderLabel,
        requestLineId: requestLineId,
        requestName: requestName,
        requestUnit: requestUnit,
        picks: picks,
        match: match ?? this.match,
        substituteReason: substituteReason ?? this.substituteReason,
        unitNote: unitNote ?? this.unitNote,
        extraReason: extraReason ?? this.extraReason,
        extraLocation: identical(extraLocation, _keep) ? this.extraLocation : extraLocation as String?,
        unplannedReason: unplannedReason ?? this.unplannedReason,
      );

  Map<String, dynamic> toJson() => {
        'key': key,
        'item_name': itemName,
        'quantity': quantity,
        'unit': unit,
        'amount': amount,
        'category': category,
        'destination': destination,
        'folder_id': folderId,
        'folder_label': folderLabel,
        'request_line_id': requestLineId,
        'request_name': requestName,
        'request_unit': requestUnit,
        'picks': [for (final p in picks) p.toJson()],
        'match': match.name,
        'substitute_reason': substituteReason,
        'unit_note': unitNote,
        'extra_reason': extraReason,
        'extra_location': extraLocation,
        'unplanned_reason': unplannedReason,
      };
}

/// A delivery fee or discount (Q9). [shares], when the buyer adjusted the
/// split, holds one typed share per line; otherwise the server splits it by
/// line amount.
class DraftCharge {
  const DraftCharge({required this.kind, this.amount = '', this.shares});
  factory DraftCharge.fromJson(Map<String, dynamic> j) => DraftCharge(
        kind: j['kind'] as String,
        amount: (j['amount'] as String?) ?? '',
        shares: (j['shares'] as List<dynamic>?)?.map((s) => s as String).toList(),
      );
  final String kind;
  final String amount;
  final List<String>? shares;

  bool get isFee => kind == 'delivery_fee';

  DraftCharge copyWith({String? amount, Object? shares = _keep}) => DraftCharge(
        kind: kind,
        amount: amount ?? this.amount,
        shares: identical(shares, _keep) ? this.shares : shares as List<String>?,
      );

  Map<String, dynamic> toJson() => {'kind': kind, 'amount': amount, 'shares': shares};
}

/// Payment methods the Purchasing tab offers ('' = not yet paid / not known).
const paymentMethods = ['Cash', 'GCash', 'Bank transfer', 'Check', 'On account', ''];

/// A purchase being recorded on the phone (Q7–Q11). Saved on the phone as
/// it is typed; sent once, when there is signal.
class PurchaseDraft {
  const PurchaseDraft({
    required this.id,
    required this.createdAt,
    required this.purchaseDate,
    this.supplierId,
    this.supplierName = '',
    this.paymentMethod = 'Cash',
    this.notes = '',
    this.receiptTotal = '',
    this.lines = const [],
    this.charges = const [],
    this.photos = const {},
    this.noReceipt = false,
    this.noReceiptReason = '',
  });

  factory PurchaseDraft.fromJson(Map<String, dynamic> j) => PurchaseDraft(
        id: j['id'] as String,
        createdAt: DateTime.parse(j['created_at'] as String).toUtc(),
        purchaseDate: j['purchase_date'] as String,
        supplierId: j['supplier_id'] as String?,
        supplierName: (j['supplier_name'] as String?) ?? '',
        paymentMethod: (j['payment_method'] as String?) ?? 'Cash',
        notes: (j['notes'] as String?) ?? '',
        receiptTotal: (j['receipt_total'] as String?) ?? '',
        lines: [for (final l in (j['lines'] as List<dynamic>? ?? const [])) DraftPurchaseLine.fromJson(Map<String, dynamic>.from(l as Map))],
        charges: [for (final c in (j['charges'] as List<dynamic>? ?? const [])) DraftCharge.fromJson(Map<String, dynamic>.from(c as Map))],
        photos: Map<String, String>.from((j['photos'] as Map?) ?? const {}),
        noReceipt: j['no_receipt'] == true,
        noReceiptReason: (j['no_receipt_reason'] as String?) ?? '',
      );

  final String id;
  final DateTime createdAt;

  /// The ACTUAL purchase date, "YYYY-MM-DD" (Manila). It decides which
  /// billing period pays (Stage 2 decision): never the sending date.
  final String purchaseDate;
  final String? supplierId;
  final String supplierName;
  final String paymentMethod;
  final String notes;

  /// The receipt total as printed, typed by the buyer (Q9).
  final String receiptTotal;
  final List<DraftPurchaseLine> lines;
  final List<DraftCharge> charges;

  /// Receipt slot → photo file on the phone (Q8).
  final Map<String, String> photos;
  final bool noReceipt;
  final String noReceiptReason;

  /// Lines + fees − discounts, from what is typed (blank counts as 0).
  double get computedTotal {
    double v(String s) => parseMoney(s) ?? 0;
    final items = lines.fold<double>(0, (a, l) => a + v(l.amount));
    final fees = charges.where((c) => c.isFee).fold<double>(0, (a, c) => a + v(c.amount));
    final discounts = charges.where((c) => !c.isFee).fold<double>(0, (a, c) => a + v(c.amount));
    return round2(items + fees - discounts);
  }

  PurchaseDraft copyWith({
    String? purchaseDate,
    Object? supplierId = _keep,
    String? supplierName,
    String? paymentMethod,
    String? notes,
    String? receiptTotal,
    List<DraftPurchaseLine>? lines,
    List<DraftCharge>? charges,
    Map<String, String>? photos,
    bool? noReceipt,
    String? noReceiptReason,
  }) =>
      PurchaseDraft(
        id: id,
        createdAt: createdAt,
        purchaseDate: purchaseDate ?? this.purchaseDate,
        supplierId: identical(supplierId, _keep) ? this.supplierId : supplierId as String?,
        supplierName: supplierName ?? this.supplierName,
        paymentMethod: paymentMethod ?? this.paymentMethod,
        notes: notes ?? this.notes,
        receiptTotal: receiptTotal ?? this.receiptTotal,
        lines: lines ?? this.lines,
        charges: charges ?? this.charges,
        photos: photos ?? this.photos,
        noReceipt: noReceipt ?? this.noReceipt,
        noReceiptReason: noReceiptReason ?? this.noReceiptReason,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'created_at': createdAt.toIso8601String(),
        'purchase_date': purchaseDate,
        'supplier_id': supplierId,
        'supplier_name': supplierName,
        'payment_method': paymentMethod,
        'notes': notes,
        'receipt_total': receiptTotal,
        'lines': [for (final l in lines) l.toJson()],
        'charges': [for (final c in charges) c.toJson()],
        'photos': photos,
        'no_receipt': noReceipt,
        'no_receipt_reason': noReceiptReason,
      };
}

/// Something the server would refuse, said before sending. The names follow
/// the server's codes where there is one.
enum ProblemKind {
  badDate,
  noLines,
  tooManyLines,
  badName,
  badQuantity,
  badAmount,
  noProject,
  extraReasonRequired,
  nameDiffers,
  substituteReasonRequired,
  unitNoteRequired,
  unplannedReasonRequired,
  badChargeAmount,
  splitMismatch,
  noReceipt,
  noReceiptReason,
  badTotal,
  totalMismatch,
}

class PurchaseProblem {
  const PurchaseProblem(this.kind, {this.line, this.charge});
  final ProblemKind kind;

  /// 1-based line or charge number, when the problem is about one.
  final int? line;
  final int? charge;

  @override
  bool operator ==(Object other) => other is PurchaseProblem && other.kind == kind && other.line == line && other.charge == charge;

  @override
  int get hashCode => Object.hash(kind, line, charge);

  @override
  String toString() => 'PurchaseProblem($kind, line: $line, charge: $charge)';
}

/// What would be refused, in form order. The Purchasing tab's formProblems,
/// plus the phone's own rules: a receipt photo or a reason (Q8), the typed
/// total matching the lines (Q9) and a note for a different unit (Q10).
List<PurchaseProblem> purchaseProblems(PurchaseDraft d) {
  final out = <PurchaseProblem>[];
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(d.purchaseDate)) out.add(const PurchaseProblem(ProblemKind.badDate));
  if (d.lines.isEmpty) out.add(const PurchaseProblem(ProblemKind.noLines));
  if (d.lines.length > 50) out.add(const PurchaseProblem(ProblemKind.tooManyLines));
  for (var i = 0; i < d.lines.length; i++) {
    final l = d.lines[i];
    final n = i + 1;
    if (l.itemName.trim().isEmpty || l.itemName.trim().length > 200) out.add(PurchaseProblem(ProblemKind.badName, line: n));
    if (parseQuantity(l.quantity) == null) out.add(PurchaseProblem(ProblemKind.badQuantity, line: n));
    if (parseMoney(l.amount) == null) out.add(PurchaseProblem(ProblemKind.badAmount, line: n));
    if (l.destination != 'warehouse' && (l.folderId ?? '').isEmpty) out.add(PurchaseProblem(ProblemKind.noProject, line: n));
    if (l.linked) {
      if (l.extraQuantity > 0 && (l.extraReason.trim().isEmpty || l.extraLocation == null)) {
        out.add(PurchaseProblem(ProblemKind.extraReasonRequired, line: n));
      }
      if (l.match == LineMatch.same && l.requestName.isNotEmpty && _norm(l.itemName) != _norm(l.requestName)) {
        out.add(PurchaseProblem(ProblemKind.nameDiffers, line: n));
      }
      if (l.match == LineMatch.substitute && l.substituteReason.trim().isEmpty) {
        out.add(PurchaseProblem(ProblemKind.substituteReasonRequired, line: n));
      }
      if (l.differentUnit && l.match != LineMatch.substitute && l.unitNote.trim().isEmpty) {
        out.add(PurchaseProblem(ProblemKind.unitNoteRequired, line: n));
      }
    } else if (l.unplannedReason.trim().isEmpty) {
      out.add(PurchaseProblem(ProblemKind.unplannedReasonRequired, line: n));
    }
  }
  for (var i = 0; i < d.charges.length; i++) {
    final c = d.charges[i];
    final amount = parseMoney(c.amount);
    if (amount == null || amount <= 0) out.add(PurchaseProblem(ProblemKind.badChargeAmount, charge: i + 1));
    final shares = c.shares;
    if (amount != null && shares != null && shares.isNotEmpty) {
      final sum = round2(shares.fold<double>(0, (a, s) => a + (parseMoney(s) ?? 0)));
      if (shares.length != d.lines.length || shares.any((s) => parseMoney(s) == null) || sum != round2(amount)) {
        out.add(PurchaseProblem(ProblemKind.splitMismatch, charge: i + 1));
      }
    }
  }
  if (d.noReceipt) {
    if (d.noReceiptReason.trim().isEmpty) out.add(const PurchaseProblem(ProblemKind.noReceiptReason));
  } else if (d.photos.isEmpty) {
    out.add(const PurchaseProblem(ProblemKind.noReceipt));
  }
  final total = parseMoney(d.receiptTotal);
  if (total == null) {
    out.add(const PurchaseProblem(ProblemKind.badTotal));
  } else if (round2(total) != d.computedTotal) {
    out.add(const PurchaseProblem(ProblemKind.totalMismatch));
  }
  return out;
}

/// The pur_record body (0096/0097/0101) for a draft that has no problems.
/// [docs]: receipt slot → uploaded link.
Map<String, dynamic> purchaseBody(PurchaseDraft d, {Map<String, String> docs = const {}}) {
  final lines = [
    for (final l in d.lines)
      {
        'destination': l.destination,
        'folder_id': l.destination == 'warehouse' ? null : l.folderId,
        'item_name': l.itemName.trim(),
        'category': l.category,
        'quantity': round3(parseQuantity(l.quantity) ?? 0),
        'unit': l.unit.trim(),
        'amount': round2(parseMoney(l.amount) ?? 0),
        'in_inventory': false,
        'min_stock': 0,
        if (l.linked) ...{
          'request_line_id': l.requestLineId,
          'portion_picks': [
            for (final p in l.picks)
              if (p.quantity > 0) {'portion_id': p.portionId, 'quantity': round3(p.quantity)},
          ],
          'extra_reason': l.extraReason.trim(),
          'extra_location': l.extraLocation,
          'substitute': l.match == LineMatch.substitute,
          'substitute_reason': l.match == LineMatch.substitute ? l.substituteReason.trim() : '',
        } else ...{
          'request_line_id': null,
          'unplanned_reason': l.unplannedReason.trim(),
        },
      },
  ];
  final charges = [
    for (final c in d.charges)
      {
        'kind': c.kind,
        'amount': round2(parseMoney(c.amount) ?? 0),
        if (c.shares != null && c.shares!.isNotEmpty)
          'shares': [for (var i = 0; i < c.shares!.length; i++) {'line': i + 1, 'amount': round2(parseMoney(c.shares![i]) ?? 0)}],
      },
  ];
  // Q10: a different unit's note goes where the office reads it.
  final unitNotes = [
    for (var i = 0; i < d.lines.length; i++)
      if (d.lines[i].differentUnit && d.lines[i].match != LineMatch.substitute && d.lines[i].unitNote.trim().isNotEmpty)
        'Line ${i + 1} (different unit): ${d.lines[i].unitNote.trim()}',
  ];
  final notes = [if (d.notes.trim().isNotEmpty) d.notes.trim(), ...unitNotes].join('\n');
  return {
    'source': 'workmate',
    'purchase_date': d.purchaseDate,
    'date_time': d.purchaseDate,
    'supplier': d.supplierName.trim(),
    'supplier_id': d.supplierId,
    'payment_method': d.paymentMethod.trim(),
    'notes': notes,
    'docs': docs,
    'no_receipt_reason': d.noReceipt ? d.noReceiptReason.trim() : '',
    'receipt_total': round2(parseMoney(d.receiptTotal) ?? 0),
    'lines': lines,
    'charges': charges,
  };
}
```

**Create:** `lib/purchasing/purchasing_services.dart`

```dart
import 'package:flutter/foundation.dart';

import 'data/purchasing_api.dart';

/// Everything the buying screens need, built once in main.dart.
class PurchasingServices {
  const PurchasingServices({required this.api, this.changed});

  final PurchasingApi api;

  /// Fires when the live app's background drain settled queued purchases.
  final Listenable? changed;
}
```

**Create:** `lib/purchasing/sync/purchasing_sync.dart`

```dart
import 'dart:io';

import '../../attendance/domain/work_date.dart';
import '../../attendance/sync/submission_sync.dart' show SyncResult;
import '../data/purchasing_db.dart';
import '../data/purchasing_remote.dart';
import '../domain/pur_failure.dart';
import '../domain/pur_op.dart';

/// A sane ceiling for one pass.
const _maxPerRun = 50;

/// Sends purchases recorded on the phone (Q7): for each, its receipt photos
/// (each once: the link is kept between attempts), then pur_record with the
/// op id minted at Send, so it is recorded once however often it is tried.
/// One account's queue, in order; stops at the first failure worth retrying.
class PurchasingSync {
  PurchasingSync({required this.db, required this.remote, DateTime Function()? now}) : _now = now ?? DateTime.now;

  final PurchasingDb db;
  final PurchasingRemote remote;
  final DateTime Function() _now;

  /// Purchases the last [drain] finished with: recorded, or refused for good.
  int settled = 0;

  Future<SyncResult> drain(String userId) async {
    settled = 0;
    // With no session nothing may be sent: it would file under whoever signs in next.
    if (userId.isEmpty) return SyncResult.done;
    for (var i = 0; i < _maxPerRun; i++) {
      final queue = await db.sendable(userId);
      if (queue.isEmpty) return SyncResult.done;
      if (await _send(queue.first, userId) == SyncResult.retry) return SyncResult.retry;
      settled++;
    }
    return SyncResult.done;
  }

  Future<SyncResult> _send(PurOp op, String userId) async {
    var o = op;
    try {
      if (o.companyId == null && o.receipts.isNotEmpty) {
        o = o.copyWith(companyId: await remote.company(userId));
        await db.updateOpBody(o.opId, o.bodyJson);
      }
      final docs = <String, String>{};
      for (final e in o.receipts.entries) {
        var r = e.value;
        final done = r.url;
        if (done != null) {
          docs[e.key] = done;
          continue;
        }
        final file = File(r.local);
        if (!file.existsSync()) throw const PurFailureException(PurFailure.photoMissing);
        if (r.path == null) {
          r = r.withPath(receiptPath(companyId: o.companyId!, manilaNow: manilaFields(_now()), photoId: r.photoId));
          o = o.copyWith(receipts: {...o.receipts, e.key: r});
          await db.updateOpBody(o.opId, o.bodyJson);
        }
        final url = await remote.uploadReceipt(path: r.path!, localPath: file.path, companyId: o.companyId!, userId: userId);
        o = o.copyWith(receipts: {...o.receipts, e.key: r.withUrl(url)});
        await db.updateOpBody(o.opId, o.bodyJson);
        docs[e.key] = url;
      }
      await remote.record(o.opId, {...o.purchase, 'docs': docs}, userId: userId);
      await db.finishRecord(o.opId, o.draftId);
      for (final r in o.receipts.values) {
        _discard(File(r.local)); // only now is the photo safe to delete
      }
      return SyncResult.done;
    } catch (error) {
      final failure = PurFailure.of(error);
      await db.recordAttempt(o.opId, failure.name, countsTowardCap: failure.countsTowardCap);
      final givingUp = failure.countsTowardCap && o.attempts + 1 >= maxPurchaseAttempts;
      if (failure.retryable && !givingUp) return SyncResult.retry;
      // Kept, flagged and shown ("Needs attention"): never let a buyer
      // believe it was recorded.
      await db.markFailed(o.opId, failure.name);
      return SyncResult.done;
    }
  }

  void _discard(File photo) {
    try {
      photo.deleteSync();
    } catch (_) {}
  }
}
```


---

### Task 3: Shopping list

This week first; Mine → Unassigned → other buyers (read-only, name shown); urgent / needed-by and "Quantity changed" marks; a project filter; Needed · Bought · Still to buy with the unit and specification; no prices (Q4). Claim (whole or part) and release, online only (Q5); Mark arranged on own portions (Q6, R18). The buyer shell gets its first tabs: Shopping list · Profile.

**Files:**
- Create: `lib/purchasing/ui/purchasing_copy.dart`, `lib/purchasing/list/shopping_controller.dart`, `lib/purchasing/list/shopping_list_screen.dart`
- Modify: `lib/purchasing/ui/buyer_shell.dart` (whole file replaced: tabs), `lib/app.dart` (passes `purchasing`)
- Test: `test/purchasing/list/shopping_controller_test.dart`, `test/purchasing/list/shopping_list_screen_test.dart`; modify `test/purchasing/ui/buyer_screens_test.dart`

**Interfaces:**
- Consumes: `PurchasingApi`, `ShoppingView`, `PurBatch.current`, `DraftPurchaseLine.fromShopping`, `purFailureCopy` (Task 2).
- Produces: `purchasing_copy.dart` — `Bilingual` constants (`stillToBuyLabel`, `neededLabel`, `boughtLabel`, `mineLabel`, `unassignedLabel`, `othersLabel`, `claimLabel`, `releaseLabel`, `arrangedLabel`, `notArrangedLabel`, `recordLabel`, `noReceiptLabel`, `waitingLabel`, `attentionLabel`, `needsSignal`), `String peso(num)`, `String qtyUnit(num, String)`, `BilingualText`, `Widget bilingualButton(Bilingual, VoidCallback?, {filled, key})`. (Task 4 adds `problemCopy` and `receiptSlotLabels`.)
- Produces: `ShoppingEntry(line, portion)`, `ShoppingSections({mine, unassigned, others})`, `enum BatchScope { thisWeek, all }`, `ShoppingController({api, now})` with `refresh`, `currentBatch`, `projects`, `sections`, `setScope`, `setProject`, `toggle`, `claim(entry, {quantity})`, `release`, `setArranged`, `linesForSelected()`, `clearSelection`, `selected`, `busy`, `notice`.
- Produces: `ShoppingListScreen({controller, onRecord})` — `onRecord` null hides picking (Task 4 wires it).

- [ ] **Step 1: Write the failing tests** (*Tests* blocks).
- [ ] **Step 2: Run them; they fail to compile.**

Run: `flutter test test/purchasing/list test/purchasing/ui`
Expected: compilation errors (`shopping_controller.dart` not found).

- [ ] **Step 3: Write the code** (*Code* blocks).
- [ ] **Step 4: Run the whole suite and the analyzer.**

Run: `flutter test` → **788 passed**. `flutter analyze` → `No issues found!`

- [ ] **Step 5: The user commits** (`2A-3b Task 3: shopping list`).

<!-- Tests -->

**Create:** `test/purchasing/list/shopping_controller_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/data/purchasing_api.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/list/shopping_controller.dart';

import '../purchasing_api_fake.dart';
import '../purchasing_fakes.dart';

ShoppingLine line(String id, String project, List<PurPortion> portions, {bool urgent = false}) => ShoppingLine(
      lineId: id,
      requestId: 'r-$id',
      description: 'Item $id',
      unit: 'pc',
      projectId: project,
      projectName: project == 'f1' ? 'Barlin Residence' : 'Sulit Residence',
      workId: project,
      workName: 'Main Contract',
      urgent: urgent,
      portions: portions,
    );

void main() {
  late FakePurchasingApi api;
  late ShoppingController c;

  setUp(() async {
    api = FakePurchasingApi();
    api.shopping = ShoppingView(batches: [thisWeek, nextWeek], lines: [
      line('a', 'f1', [portion('pa1', buyer: 'u1', mine: true), portion('pa2', batch: 'b2')]),
      line('b', 'f2', [portion('pb1'), portion('pb2', buyer: 'u9'), portion('pb3', still: 0)]),
    ]);
    c = ShoppingController(api: api, now: () => wednesday);
    await c.refresh();
  });

  test('Mine, then Unassigned, then other buyers — this week only by default (Q4)', () {
    final s = c.sections;
    expect(s.mine.map((e) => e.portion.id), ['pa1']);
    expect(s.unassigned.map((e) => e.portion.id), ['pb1']);
    expect(s.others.map((e) => e.portion.id), ['pb2']);
  });

  test('nothing left to buy is not shown', () {
    c.setScope(BatchScope.all);
    expect([...c.sections.unassigned, ...c.sections.others].map((e) => e.portion.id), isNot(contains('pb3')));
  });

  test('all weeks shows next week\'s portions too', () {
    c.setScope(BatchScope.all);
    expect(c.sections.unassigned.map((e) => e.portion.id), ['pa2', 'pb1']);
  });

  test('the project filter keeps one project; its list comes from the lines, by name', () {
    expect(c.projects, [('f1', 'Barlin Residence'), ('f2', 'Sulit Residence')]);
    c.setProject('f2');
    expect(c.sections.mine, isEmpty);
    expect(c.sections.unassigned.map((e) => e.portion.id), ['pb1']);
  });

  test('claim all sends no quantity; claim part sends it (Q5)', () async {
    final e = c.sections.unassigned.single;
    await c.claim(e);
    await c.claim(e, quantity: 4);
    await c.claim(e, quantity: 10);
    expect(api.calls.where((x) => x.startsWith('claim')), ['claim:pb1:null', 'claim:pb1:4.0', 'claim:pb1:null']);
  });

  test('after an action the list is read again', () async {
    api.calls.clear();
    await c.release(c.sections.mine.single);
    expect(api.calls, ['release:pa1', 'shoppingList']);
  });

  test('a refusal is said in both languages and nothing else changes', () async {
    api.error = refusal('ASSIGNED_TO_OTHER');
    await c.claim(c.sections.unassigned.single);
    expect(c.notice!.english, 'Another buyer has that item now. Refresh the list.');
    expect(c.busy, isEmpty);
    c.dismissNotice();
    expect(c.notice, isNull);
  });

  test('only my portions can be picked; picked ones become lines, one per request line', () async {
    c.toggle(c.sections.unassigned.single);
    expect(c.selected, isEmpty);
    c.toggle(c.sections.mine.single);
    final lines = c.linesForSelected();
    expect(lines.single.requestLineId, 'a');
    expect(lines.single.picks.single.portionId, 'pa1');
    expect(lines.single.folderId, 'f1');
  });

  test('releasing a picked portion un-picks it', () async {
    c.toggle(c.sections.mine.single);
    await c.release(c.sections.mine.single);
    expect(c.selected, isEmpty);
  });
}
```

**Create:** `test/purchasing/list/shopping_list_screen_test.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/data/purchasing_api.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';
import 'package:workmate/purchasing/list/shopping_controller.dart';
import 'package:workmate/purchasing/list/shopping_list_screen.dart';
import 'package:workmate/ui/theme.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../purchasing_api_fake.dart';
import '../purchasing_fakes.dart';

Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: Scaffold(body: w));

void main() {
  late FakePurchasingApi api;
  late ShoppingController c;

  setUp(() {
    api = FakePurchasingApi();
    api.shopping = ShoppingView(batches: [thisWeek, nextWeek], fetchedAt: wednesday, lines: [
      ShoppingLine(
        lineId: 'l1',
        requestId: 'r1',
        description: 'Cement',
        spec: '40 kg',
        unit: 'bag',
        projectId: 'f1',
        projectName: 'Barlin Residence',
        workId: 'f1',
        workName: 'Main Contract',
        requesterName: 'Juan',
        urgent: true,
        neededBy: '2026-10-23',
        needed: 10,
        bought: 0,
        stillToBuy: 10,
        portions: [
          portion('p1', still: 6),
          const PurPortion(id: 'p2', batchId: 'b1', stillToBuy: 4, buyerId: 'u1', mine: true, changed: true),
          const PurPortion(id: 'p3', batchId: 'b1', stillToBuy: 2, buyerId: 'u9', buyerName: 'Ben'),
        ],
      ),
    ]);
    c = ShoppingController(api: api, now: () => wednesday);
  });

  testWidgets('sections and numbers in English with Tagalog under them (Q4, Q22)', (tester) async {
    useTallPhone(tester);
    await c.refresh();
    await tester.pumpWidget(wrap(ShoppingListScreen(controller: c)));
    expect(find.text('Mine'), findsOneWidget);
    expect(find.text('Akin'), findsOneWidget);
    expect(find.text('Unassigned'), findsOneWidget);
    expect(find.text('Still to buy'), findsWidgets);
    expect(find.text('Kulang pang bilhin'), findsWidgets);
    expect(find.text('Cement · 40 kg'), findsWidgets);
    expect(find.byKey(const Key('urgent-p1')), findsOneWidget);
    expect(find.text('Urgent · needed by 2026-10-23'), findsWidgets);
    expect(find.byKey(const Key('changed-p2')), findsOneWidget);
    expect(find.text('6 bag'), findsOneWidget);
    expect(find.textContaining('₱'), findsNothing, reason: 'no prices on the list (Q4)');
    await tester.scrollUntilVisible(find.text('Buying: Ben'), 300);
    expect(find.text('Other buyers'), findsOneWidget);
    expect(find.text('Ibang bibili'), findsOneWidget);
    expect(find.textContaining('₱'), findsNothing);
  });

  testWidgets('another buyer\'s portion is read-only', (tester) async {
    useTallPhone(tester);
    await c.refresh();
    await tester.pumpWidget(wrap(ShoppingListScreen(controller: c)));
    expect(find.byKey(const Key('claim-p3')), findsNothing);
    expect(find.byKey(const Key('release-p3')), findsNothing);
    expect(find.byKey(const Key('claim-p1')), findsOneWidget);
    expect(find.byKey(const Key('release-p2')), findsOneWidget);
    expect(find.byKey(const Key('arranged-p2')), findsOneWidget);
  });

  testWidgets('"I\'ll buy this": all by default, or part (Q5)', (tester) async {
    useTallPhone(tester);
    await c.refresh();
    await tester.pumpWidget(wrap(ShoppingListScreen(controller: c)));
    await tester.tap(find.byKey(const Key('claim-p1')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('claim-qty')), '7');
    await tester.tap(find.byKey(const Key('claim-confirm')));
    await tester.pumpAndSettle();
    expect(find.text('Enter up to 6 bag.'), findsOneWidget, reason: 'never more than is still to buy');
    await tester.enterText(find.byKey(const Key('claim-qty')), '4');
    await tester.tap(find.byKey(const Key('claim-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('claim:p1:4.0'));
  });

  testWidgets('Mark arranged on my own portion (Q6)', (tester) async {
    useTallPhone(tester);
    await c.refresh();
    await tester.pumpWidget(wrap(ShoppingListScreen(controller: c)));
    await tester.tap(find.byKey(const Key('arranged-p2')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('arranged:p2:true'));
  });

  testWidgets('the saved copy says so: claiming needs signal', (tester) async {
    useTallPhone(tester);
    api.shopping = ShoppingView(lines: api.shopping.lines, batches: api.shopping.batches, fetchedAt: wednesday, fromCache: true);
    await c.refresh();
    await tester.pumpWidget(wrap(ShoppingListScreen(controller: c)));
    expect(find.byKey(const Key('shopping-saved-copy')), findsOneWidget);
  });

  testWidgets('picking my portions opens Record purchase with them', (tester) async {
    useTallPhone(tester);
    List<DraftPurchaseLine>? opened;
    await c.refresh();
    await tester.pumpWidget(wrap(ShoppingListScreen(controller: c, onRecord: (lines) => opened = lines)));
    expect(find.byKey(const Key('record-selected')), findsNothing);
    await tester.tap(find.byKey(const Key('pick-p2')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('record-selected')));
    await tester.pump();
    expect(opened!.single.picks.single.portionId, 'p2');
    expect(opened!.single.quantity, '4');
  });

  testWidgets('nothing to buy says so', (tester) async {
    api.shopping = ShoppingView(batches: [thisWeek]);
    await c.refresh();
    await tester.pumpWidget(wrap(ShoppingListScreen(controller: c)));
    expect(find.text('Nothing left to buy here.'), findsOneWidget);
  });
}
```

**Modify:** `test/purchasing/ui/buyer_screens_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/purchasing/ui/buyer_screens_test.dart b/test/purchasing/ui/buyer_screens_test.dart
index 8859dbd..dcae821 100644
--- a/test/purchasing/ui/buyer_screens_test.dart
+++ b/test/purchasing/ui/buyer_screens_test.dart
@@ -2,11 +2,14 @@ import 'package:flutter/material.dart';
 import 'package:flutter_test/flutter_test.dart';
 import 'package:workmate/auth/worker_profile.dart';
 import 'package:workmate/profile/account_services.dart';
+import 'package:workmate/purchasing/purchasing_services.dart';
 import 'package:workmate/purchasing/ui/buyer_shell.dart';
 import 'package:workmate/purchasing/ui/buying_off_screen.dart';
 import 'package:workmate/ui/gate_unavailable_screen.dart';
 import 'package:workmate/ui/theme.dart';
 
+import '../purchasing_api_fake.dart';
+
 Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: w);
 
 const staff = WorkerProfile(id: 's1', email: 'staff@dacsbuilding.com', displayName: 'Ana Reyes', role: 'staff', status: 'active');
@@ -31,6 +34,23 @@ void main() {
     expect(signedOut, 1);
   });
 
+  testWidgets('with buying available: Shopping list first, then Profile', (tester) async {
+    await tester.pumpWidget(wrap(BuyerShell(
+      buyer: staff,
+      versionName: '0.7.0',
+      onSignOut: () async {},
+      account: account,
+      purchasing: PurchasingServices(api: FakePurchasingApi()),
+    )));
+    await tester.pumpAndSettle();
+    expect(find.text('Shopping list'), findsWidgets);
+    expect(find.text('Profile'), findsOneWidget);
+    expect(find.text('Time In'), findsNothing);
+    await tester.tap(find.text('Profile'));
+    await tester.pumpAndSettle();
+    expect(find.text('Change password'), findsOneWidget);
+  });
+
   testWidgets('Buying is turned off: said in both languages, with TRY AGAIN and Log out (R2)', (tester) async {
     var retried = 0;
     await tester.pumpWidget(wrap(BuyingOffScreen(onRetry: () => retried++, onSignOut: () {}, unsent: 2)));
```

<!-- Code -->

**Modify:** `lib/app.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/app.dart b/lib/app.dart
index a47044c..beed979 100644
--- a/lib/app.dart
+++ b/lib/app.dart
@@ -147,6 +147,7 @@ class _WorkMateAppState extends State<WorkMateApp> with WidgetsBindingObserver {
                   versionName: widget.versionName,
                   onSignOut: c.signOut,
                   account: widget.account,
+                  purchasing: widget.purchasing,
                 ),
               BuyingOff(:final worker) => FutureBuilder<int>(
                   future: widget.purchasing?.api.unsentFor(worker.id) ?? Future.value(0),
```

**Create:** `lib/purchasing/list/shopping_controller.dart`

```dart
import 'package:flutter/foundation.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../data/purchasing_api.dart';
import '../domain/pur_failure.dart';
import '../domain/pur_models.dart';
import '../domain/purchase_draft.dart';

/// One portion as the list shows it, with its request line.
class ShoppingEntry {
  const ShoppingEntry(this.line, this.portion);
  final ShoppingLine line;
  final PurPortion portion;
}

/// The list as the screen shows it (Q4): Mine at the top, then Unassigned,
/// then other buyers' portions (read-only), each in the server's order —
/// urgent and needed-by first.
class ShoppingSections {
  const ShoppingSections({this.mine = const [], this.unassigned = const [], this.others = const []});
  final List<ShoppingEntry> mine;
  final List<ShoppingEntry> unassigned;
  final List<ShoppingEntry> others;
  bool get isEmpty => mine.isEmpty && unassigned.isEmpty && others.isEmpty;
}

/// Which batches the list shows: this week's (the default, Q4) or all.
enum BatchScope { thisWeek, all }

class ShoppingController extends ChangeNotifier {
  ShoppingController({required this.api, DateTime Function()? now}) : _now = now ?? DateTime.now;

  final PurchasingApi api;
  final DateTime Function() _now;

  ShoppingView _view = const ShoppingView();
  ShoppingView get view => _view;

  bool loading = false;
  BatchScope scope = BatchScope.thisWeek;

  /// A project id, or null for every project.
  String? project;

  /// Portions waiting on the server right now.
  final busy = <String>{};

  /// Mine portions picked for "Record purchase", by portion id.
  final selected = <String>{};

  /// What the last action could not do, in both languages.
  Bilingual? notice;

  Future<void> refresh() async {
    loading = true;
    notifyListeners();
    try {
      _view = await api.shoppingList();
    } catch (e) {
      // BUYER_REQUIRED: the app leaves this screen (R2). Anything else keeps
      // what is shown and says why.
      notice = purFailureCopy(PurFailure.of(e));
    } finally {
      loading = false;
      // A portion no longer mine is no longer picked.
      selected.retainWhere((id) => sections.mine.any((e) => e.portion.id == id));
      notifyListeners();
    }
  }

  PurBatch? get currentBatch => PurBatch.current(_view.batches, _now());

  /// Projects on the list, for the filter: (id, name), by name.
  List<(String, String)> get projects {
    final seen = <String, String>{};
    for (final l in _view.lines) {
      seen.putIfAbsent(l.projectId, () => l.projectName);
    }
    return seen.entries.map((e) => (e.key, e.value)).toList()..sort((a, b) => a.$2.toLowerCase().compareTo(b.$2.toLowerCase()));
  }

  ShoppingSections get sections {
    final batch = currentBatch;
    final mine = <ShoppingEntry>[];
    final unassigned = <ShoppingEntry>[];
    final others = <ShoppingEntry>[];
    for (final l in _view.lines) {
      if (project != null && l.projectId != project) continue;
      for (final p in l.portions) {
        if (p.stillToBuy <= 0) continue;
        if (scope == BatchScope.thisWeek && (batch == null || p.batchId != batch.id)) continue;
        final e = ShoppingEntry(l, p);
        if (p.mine) {
          mine.add(e);
        } else if (p.unassigned) {
          unassigned.add(e);
        } else {
          others.add(e);
        }
      }
    }
    return ShoppingSections(mine: mine, unassigned: unassigned, others: others);
  }

  void setScope(BatchScope s) {
    scope = s;
    notifyListeners();
  }

  void setProject(String? id) {
    project = id;
    notifyListeners();
  }

  void toggle(ShoppingEntry e) {
    if (!e.portion.mine) return;
    if (!selected.remove(e.portion.id)) selected.add(e.portion.id);
    notifyListeners();
  }

  void dismissNotice() {
    notice = null;
    notifyListeners();
  }

  Future<void> _act(ShoppingEntry e, Future<void> Function() call) async {
    if (busy.contains(e.portion.id)) return;
    busy.add(e.portion.id);
    notice = null;
    notifyListeners();
    try {
      await call();
      busy.remove(e.portion.id);
      await refresh();
    } catch (err) {
      busy.remove(e.portion.id);
      notice = purFailureCopy(PurFailure.of(err));
      notifyListeners();
    }
  }

  /// "I'll buy this" (Q5): all of it, or [quantity] of it. Online only.
  Future<void> claim(ShoppingEntry e, {double? quantity}) =>
      _act(e, () => api.claim(e.portion, quantity: quantity != null && quantity < e.portion.stillToBuy ? quantity : null));

  Future<void> release(ShoppingEntry e) => _act(e, () async {
        selected.remove(e.portion.id);
        await api.release(e.portion);
      });

  /// Q6: own portions only.
  Future<void> setArranged(ShoppingEntry e, bool arranged) => _act(e, () => api.setArranged(e.portion, arranged));

  /// The picked portions as purchase lines: one line per request line.
  List<DraftPurchaseLine> linesForSelected() {
    final byLine = <String, (ShoppingLine, List<PurPortion>)>{};
    for (final e in sections.mine) {
      if (!selected.contains(e.portion.id)) continue;
      byLine.putIfAbsent(e.line.lineId, () => (e.line, <PurPortion>[])).$2.add(e.portion);
    }
    return [for (final v in byLine.values) DraftPurchaseLine.fromShopping(api.newLineKey(), v.$1, v.$2)];
  }

  void clearSelection() {
    selected.clear();
    notifyListeners();
  }
}
```

**Create:** `lib/purchasing/list/shopping_list_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../attendance/ui/formats.dart';
import '../../requests/domain/quantity.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../domain/purchase_draft.dart';
import '../ui/purchasing_copy.dart';
import 'shopping_controller.dart';

/// The shopping list on the phone (Q4–Q6). Quantities and names only: the
/// prices of earlier purchases are never shown here.
class ShoppingListScreen extends StatelessWidget {
  const ShoppingListScreen({super.key, required this.controller, this.onRecord});

  final ShoppingController controller;

  /// Opens Record purchase with these lines; null hides the picking.
  final void Function(List<DraftPurchaseLine> lines)? onRecord;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final c = controller;
          final s = c.sections;
          final batch = c.currentBatch;
          final picking = onRecord != null && c.selected.isNotEmpty;
          return Column(children: [
            Expanded(
              child: RefreshIndicator(
                onRefresh: c.refresh,
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  const Text('Shopping list', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
                  const Text('Mga bibilhin', style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
                  const SizedBox(height: 12),
                  Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    ChoiceChip(
                      key: const Key('scope-week'),
                      label: Text(batch == null ? 'This week' : 'This week · cutoff ${shortDate(batch.cutoffAt)}'),
                      selected: c.scope == BatchScope.thisWeek,
                      onSelected: (_) => c.setScope(BatchScope.thisWeek),
                    ),
                    ChoiceChip(
                      key: const Key('scope-all'),
                      label: const Text('All weeks'),
                      selected: c.scope == BatchScope.all,
                      onSelected: (_) => c.setScope(BatchScope.all),
                    ),
                    DropdownButton<String?>(
                      key: const Key('project-filter'),
                      value: c.project,
                      hint: const Text('All projects'),
                      items: [
                        const DropdownMenuItem<String?>(value: null, child: Text('All projects')),
                        for (final (id, name) in c.projects) DropdownMenuItem<String?>(value: id, child: Text(name)),
                      ],
                      onChanged: c.setProject,
                    ),
                  ]),
                  if (c.view.fromCache) ...[
                    const SizedBox(height: 10),
                    _Banner(
                      key: const Key('shopping-saved-copy'),
                      text: Bilingual(
                        'Saved copy from ${c.view.fetchedAt == null ? 'earlier' : '${shortDate(c.view.fetchedAt!)} ${clockTime(c.view.fetchedAt!)}'}. '
                            'Claiming needs signal.',
                        'Lumang kopya. Kailangan ng signal para kumuha ng bibilhin.',
                      ),
                    ),
                  ],
                  if (c.notice != null) ...[
                    const SizedBox(height: 10),
                    FailureNotice(
                      english: c.notice!.english,
                      tagalog: c.notice!.tagalog,
                      actions: [noticeAction('Dismiss · Isara', c.dismissNotice)],
                    ),
                  ],
                  if (c.loading && c.view.lines.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
                  if (!c.loading && s.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 40),
                      child: BilingualText(Bilingual('Nothing left to buy here.', 'Wala nang bibilhin dito.'), align: CrossAxisAlignment.center),
                    ),
                  _section(context, mineLabel, s.mine, _Kind.mine),
                  _section(context, unassignedLabel, s.unassigned, _Kind.unassigned),
                  _section(context, othersLabel, s.others, _Kind.others),
                  const SizedBox(height: 24),
                ]),
              ),
            ),
            if (picking)
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                  child: bilingualButton(
                    Bilingual('${recordLabel.english} (${c.selected.length})', recordLabel.tagalog),
                    () {
                      final lines = c.linesForSelected();
                      c.clearSelection();
                      onRecord!(lines);
                    },
                    filled: true,
                    key: const Key('record-selected'),
                  ),
                ),
              ),
          ]);
        },
      );

  Widget _section(BuildContext context, Bilingual title, List<ShoppingEntry> entries, _Kind kind) {
    if (entries.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        BilingualText(title, style: monoLabel),
        const SizedBox(height: 6),
        for (final e in entries) _EntryCard(entry: e, kind: kind, controller: controller, canPick: onRecord != null),
      ]),
    );
  }
}

enum _Kind { mine, unassigned, others }

class _Banner extends StatelessWidget {
  const _Banner({super.key, required this.text});
  final Bilingual text;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: WmColors.brownTint, borderRadius: BorderRadius.circular(14)),
        child: BilingualText(text, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: WmColors.brownDeep)),
      );
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({required this.entry, required this.kind, required this.controller, required this.canPick});
  final ShoppingEntry entry;
  final _Kind kind;
  final ShoppingController controller;
  final bool canPick;

  Future<void> _claim(BuildContext context) async {
    final p = entry.portion;
    final qty = await showModalBottomSheet<double>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ClaimSheet(still: p.stillToBuy, unit: entry.line.unit),
    );
    if (qty != null) await controller.claim(entry, quantity: qty);
  }

  @override
  Widget build(BuildContext context) {
    final l = entry.line;
    final p = entry.portion;
    final busy = controller.busy.contains(p.id);
    final picked = controller.selected.contains(p.id);
    final title = l.spec.trim().isEmpty ? l.description : '${l.description} · ${l.spec}';
    return Card(
      key: Key('entry-${p.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: WmColors.border)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (kind == _Kind.mine && canPick)
              Checkbox(key: Key('pick-${p.id}'), value: picked, onChanged: busy ? null : (_) => controller.toggle(entry)),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                Text('${l.placeLabel} · for ${l.requesterName}', style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
              ]),
            ),
          ]),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (l.urgent)
              _Pill(
                  key: Key('urgent-${p.id}'),
                  text: l.neededBy == null ? 'Urgent' : 'Urgent · needed by ${l.neededBy}',
                  color: WmColors.danger,
                  tint: WmColors.dangerTint),
            if (!l.urgent && l.neededBy != null) _Pill(text: 'Needed by ${l.neededBy}', color: WmColors.brownDeep, tint: WmColors.brownTint),
            if (p.changed)
              _Pill(key: Key('changed-${p.id}'), text: 'Quantity changed', color: WmColors.brownDeep, tint: WmColors.brownTint),
            if (p.arranged) const _Pill(text: 'Arranged', color: WmColors.green, tint: WmColors.greenTint),
            if (kind == _Kind.others) _Pill(text: 'Buying: ${p.buyerName ?? 'another buyer'}', color: WmColors.textSecondary, tint: WmColors.inert),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: _Number(label: neededLabel, value: qtyUnit(l.needed, l.unit))),
            Expanded(child: _Number(label: boughtLabel, value: qtyUnit(l.bought, l.unit))),
            Expanded(child: _Number(label: stillToBuyLabel, value: qtyUnit(p.stillToBuy, l.unit), strong: true)),
          ]),
          if (l.notes.trim().isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(l.notes, style: const TextStyle(fontSize: 13, color: WmColors.textSecondary)),
          ],
          if (kind != _Kind.others) ...[
            const SizedBox(height: 10),
            if (busy)
              const LinearProgressIndicator()
            else if (kind == _Kind.unassigned)
              bilingualButton(claimLabel, () => _claim(context), key: Key('claim-${p.id}'))
            else
              Row(children: [
                Expanded(child: bilingualButton(releaseLabel, () => controller.release(entry), key: Key('release-${p.id}'))),
                const SizedBox(width: 8),
                Expanded(
                  child: bilingualButton(p.arranged ? notArrangedLabel : arrangedLabel, () => controller.setArranged(entry, !p.arranged),
                      key: Key('arranged-${p.id}')),
                ),
              ]),
          ],
        ]),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({super.key, required this.text, required this.color, required this.tint});
  final String text;
  final Color color;
  final Color tint;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(20)),
        child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color)),
      );
}

class _Number extends StatelessWidget {
  const _Number({required this.label, required this.value, this.strong = false});
  final Bilingual label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(value, style: TextStyle(fontWeight: strong ? FontWeight.w800 : FontWeight.w600, fontSize: strong ? 16 : 14.5)),
        Text(label.english, style: const TextStyle(fontSize: 11.5, color: WmColors.textMuted)),
        Text(label.tagalog, style: const TextStyle(fontSize: 10.5, color: WmColors.textMeta)),
      ]);
}

/// How much to claim (Q5): all of it by default, or part (e.g. 4 of 10).
class _ClaimSheet extends StatefulWidget {
  const _ClaimSheet({required this.still, required this.unit});
  final double still;
  final String unit;

  @override
  State<_ClaimSheet> createState() => _ClaimSheetState();
}

class _ClaimSheetState extends State<_ClaimSheet> {
  late final _qty = TextEditingController(text: formatQuantity(widget.still).replaceAll(',', ''));
  String? _error;

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  void _done() {
    final q = parseQuantity(_qty.text);
    if (q == null || q > widget.still) {
      setState(() => _error = 'Enter up to ${qtyUnit(widget.still, widget.unit)}.');
      return;
    }
    Navigator.of(context).pop(q);
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const BilingualText(claimLabel, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19)),
          const SizedBox(height: 6),
          Text('${stillToBuyLabel.english}: ${qtyUnit(widget.still, widget.unit)}. Take all of it, or part.',
              style: const TextStyle(color: WmColors.textMuted)),
          const SizedBox(height: 12),
          TextField(
            key: const Key('claim-qty'),
            controller: _qty,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: 'How much will you buy?', suffixText: widget.unit, errorText: _error),
          ),
          const SizedBox(height: 14),
          FilledButton(key: const Key('claim-confirm'), onPressed: _done, child: const Text('CLAIM')),
        ]),
      );
}
```

**Modify:** `lib/purchasing/ui/buyer_shell.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/ui/buyer_shell.dart b/lib/purchasing/ui/buyer_shell.dart
index dbfa5fe..61ff9f1 100644
--- a/lib/purchasing/ui/buyer_shell.dart
+++ b/lib/purchasing/ui/buyer_shell.dart
@@ -3,16 +3,22 @@ import 'package:flutter/material.dart';
 import '../../auth/worker_profile.dart';
 import '../../profile/account_services.dart';
 import '../../profile/profile_screen.dart';
+import '../list/shopping_controller.dart';
+import '../list/shopping_list_screen.dart';
+import '../purchasing_services.dart';
+
+enum _Tab { shopping, profile }
 
 /// The signed-in app for a buyer (Q2): Shopping list · My purchases ·
 /// Profile. No Time In, no worker Requests, no My Work.
-class BuyerShell extends StatelessWidget {
+class BuyerShell extends StatefulWidget {
   const BuyerShell({
     super.key,
     required this.buyer,
     required this.versionName,
     required this.onSignOut,
     required this.account,
+    this.purchasing,
   });
 
   final WorkerProfile buyer;
@@ -20,10 +26,75 @@ class BuyerShell extends StatelessWidget {
   final Future<void> Function() onSignOut;
   final AccountServices account;
 
+  /// The buying screens; null (its database could not open) leaves Profile only.
+  final PurchasingServices? purchasing;
+
+  @override
+  State<BuyerShell> createState() => _BuyerShellState();
+}
+
+class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
+  _Tab _tab = _Tab.shopping;
+  ShoppingController? _shopping;
+
+  List<_Tab> get _tabs => [if (widget.purchasing != null) _Tab.shopping, _Tab.profile];
+
+  @override
+  void initState() {
+    super.initState();
+    final p = widget.purchasing;
+    if (p != null) {
+      _shopping = ShoppingController(api: p.api)..refresh();
+      p.changed?.addListener(_onSettled);
+    } else {
+      _tab = _Tab.profile;
+    }
+    WidgetsBinding.instance.addObserver(this);
+  }
+
+  @override
+  void dispose() {
+    widget.purchasing?.changed?.removeListener(_onSettled);
+    WidgetsBinding.instance.removeObserver(this);
+    _shopping?.dispose();
+    super.dispose();
+  }
+
+  void _onSettled() => _shopping?.refresh();
+
+  @override
+  void didChangeAppLifecycleState(AppLifecycleState state) {
+    if (state == AppLifecycleState.resumed) _shopping?.refresh();
+  }
+
+  void _select(_Tab t) {
+    setState(() => _tab = t);
+    if (t == _Tab.shopping) _shopping?.refresh();
+  }
+
   @override
-  Widget build(BuildContext context) => Scaffold(
-        body: SafeArea(
-          child: ProfileScreen(worker: buyer, versionName: versionName, onSignOut: onSignOut, account: account, buyer: true),
-        ),
-      );
+  Widget build(BuildContext context) {
+    final profile =
+        ProfileScreen(worker: widget.buyer, versionName: widget.versionName, onSignOut: widget.onSignOut, account: widget.account, buyer: true);
+    final tabs = _tabs;
+    if (tabs.length < 2) return Scaffold(body: SafeArea(child: profile));
+    final body = switch (_tab) {
+      _Tab.shopping => ShoppingListScreen(controller: _shopping!),
+      _Tab.profile => profile,
+    };
+    return Scaffold(
+      body: SafeArea(child: body),
+      bottomNavigationBar: NavigationBar(
+        selectedIndex: tabs.indexOf(_tab),
+        onDestinationSelected: (i) => _select(tabs[i]),
+        destinations: [
+          for (final t in tabs)
+            switch (t) {
+              _Tab.shopping => const NavigationDestination(icon: Icon(Icons.shopping_cart_outlined), label: 'Shopping list'),
+              _Tab.profile => const NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
+            },
+        ],
+      ),
+    );
+  }
 }
```

**Create:** `lib/purchasing/ui/purchasing_copy.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../requests/domain/quantity.dart';
import '../../ui/theme.dart';

// Q22: English, with the Tagalog line underneath, on the key labels and
// every message. Screen titles and small field labels stay English.

const stillToBuyLabel = Bilingual('Still to buy', 'Kulang pang bilhin');
const neededLabel = Bilingual('Needed', 'Kailangan');
const boughtLabel = Bilingual('Bought', 'Nabili');
const mineLabel = Bilingual('Mine', 'Akin');
const unassignedLabel = Bilingual('Unassigned', 'Wala pang bibili');
const othersLabel = Bilingual('Other buyers', 'Ibang bibili');
const claimLabel = Bilingual("I'll buy this", 'Ako ang bibili');
const releaseLabel = Bilingual('Release', 'Bitawan');
const arrangedLabel = Bilingual('Mark arranged', 'Naayos na');
const notArrangedLabel = Bilingual('Not arranged', 'Hindi pa naayos');
const recordLabel = Bilingual('Record purchase', 'Itala ang binili');
const noReceiptLabel = Bilingual('No receipt', 'Walang resibo');
const waitingLabel = Bilingual('Waiting to send', 'Hinihintay maipadala');
const attentionLabel = Bilingual('Needs attention', 'Kailangang ayusin');
const needsSignal = Bilingual('This needs signal. Try again when you are online.', 'Kailangan ng signal. Subukan ulit kapag online ka na.');

/// "₱1,250.50".
String peso(num v) {
  final fixed = v.toStringAsFixed(2);
  final parts = fixed.split('.');
  final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return '₱$whole.${parts[1]}';
}

/// "6 bag".
String qtyUnit(num v, String unit) => unit.trim().isEmpty ? formatQuantity(v) : '${formatQuantity(v)} ${unit.trim()}';

/// A label in English with its Tagalog line under it.
class BilingualText extends StatelessWidget {
  const BilingualText(this.text, {super.key, this.style, this.align = CrossAxisAlignment.start});
  final Bilingual text;
  final TextStyle? style;
  final CrossAxisAlignment align;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: align, mainAxisSize: MainAxisSize.min, children: [
        Text(text.english, style: style ?? const TextStyle(fontWeight: FontWeight.w700)),
        Text(text.tagalog, style: const TextStyle(fontSize: 11.5, color: WmColors.textMuted)),
      ]);
}

/// A button whose label is bilingual.
Widget bilingualButton(Bilingual label, VoidCallback? onPressed, {bool filled = false, Key? key}) {
  final child = Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Column(mainAxisSize: MainAxisSize.min, children: [
      Text(label.english, style: const TextStyle(fontWeight: FontWeight.w800)),
      Text(label.tagalog, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w400)),
    ]),
  );
  return filled
      ? FilledButton(key: key, onPressed: onPressed, style: FilledButton.styleFrom(minimumSize: const Size(0, 52)), child: child)
      : OutlinedButton(key: key, onPressed: onPressed, child: child);
}
```


---

### Task 4: Record purchase

The form (Q7–Q11): the date (Manila, never in the future), supplier from the list or typed, paid with; lines from the shopping list (request link and picked portions, place fixed to the request's work) or with no request (a reason, and a project, a job or the warehouse); "Is this the same item?" — Same / Other words / Substitute (reason) — and a note for a different unit (R19); an extra's reason and location; delivery fees and discounts, split by amount or adjusted per item (Q9); four receipt slots by camera or gallery, or No receipt + reason (Q8, R20); the typed receipt total checked against the lines (R21). Saved on the phone as it is typed; Send queues it ("Waiting to send"). The buyer shell opens it from picked portions and from a **Record purchase** button.

**Files:**
- Create: `lib/purchasing/record/record_controller.dart`, `lib/purchasing/record/record_screen.dart`
- Modify: `pubspec.yaml` (image_picker 1.2.1), `lib/purchasing/purchasing_services.dart` (whole file replaced: photo pickers), `lib/purchasing/domain/purchase_draft.dart` (category default, R24), `lib/purchasing/ui/purchasing_copy.dart` (`problemCopy`, `receiptSlotLabels`), `lib/purchasing/ui/buyer_shell.dart` (opens the form), `lib/requests/camera/request_camera_screen.dart` (a title)
- Test: `test/purchasing/record/record_controller_test.dart`, `test/purchasing/record/record_screen_test.dart`

**Interfaces:**
- Consumes: `PurchasingApi`, `PurchaseDraft`, `DraftPurchaseLine`, `DraftCharge`, `prorate`, `purchaseProblems`, `receiptSlots` (Task 2); `purchasing_copy.dart` (Task 3).
- Produces: `typedef PickReceipt = Future<String?> Function(BuildContext)`, `realTakeReceipt`, `realPickReceipt`; `PurchasingServices({api, changed, takePhoto, pickPhoto})`.
- Produces: `PlaceOption(folderId, label)` (+ `warehouse`); `RecordController({api, draft})` with `load`, `places`, `suppliers`, `setDate`, `setSupplier(Supplier?)`, `setSupplierName`, `setPayment`, `setNotes`, `setTotal`, `addLine`, `updateLine`, `setPlace`, `removeLine`, `addCharge`, `updateCharge`, `removeCharge`, `adjustSplit(i, bool)`, `addPhoto(slot, path)`, `removePhoto`, `setNoReceipt`, `setNoReceiptReason`, `send() → Future<bool>`, `discard`, `problems`, `notice`, `sending`.
- Produces: `Future<bool> openRecord(BuildContext, PurchasingServices, {lines, draft})`; `RecordScreen({controller, services})`; `Bilingual problemCopy(ProblemKind)`; `const receiptSlotLabels`.

- [ ] **Step 1: Write the failing tests** (*Tests* blocks).
- [ ] **Step 2: Run them; they fail to compile.**

Run: `flutter test test/purchasing/record`
Expected: compilation errors (`record_controller.dart` not found).

- [ ] **Step 3: Write the code** (*Code* blocks), then `flutter pub get`: it adds `image_picker 1.2.1` and its platform packages (`image_picker_android 0.8.13+14`, …, `file_selector_*`) to `pubspec.lock` and changes no existing pin.
- [ ] **Step 4: Run the whole suite and the analyzer.**

Run: `flutter test` → **806 passed**. `flutter analyze` → `No issues found!`

- [ ] **Step 5: The user commits** (`2A-3b Task 4: record purchase`).

<!-- Tests -->

**Create:** `test/purchasing/record/record_controller_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';
import 'package:workmate/purchasing/record/record_controller.dart';

import '../domain/purchase_draft_test.dart' show unplanned;
import '../purchasing_api_fake.dart';
import '../purchasing_fakes.dart';

void main() {
  late FakePurchasingApi api;
  late RecordController c;

  setUp(() async {
    api = FakePurchasingApi();
    c = RecordController(api: api, draft: api.newDraft(lines: [unplanned(amount: '300')]));
    await c.load();
  });

  test('every change is saved on the phone at once (Q7)', () {
    c.setTotal('300');
    c.setNotes('Rush');
    expect(api.saved.map((d) => d.notes), ['', 'Rush']);
    expect(api.saved.last.receiptTotal, '300');
  });

  test('places: every open project and job, then the warehouse (Q11)', () {
    expect(c.places.map((p) => p.label), ['Barlin Residence', 'Barlin Residence · AW-02 Fence', 'Warehouse']);
    c.setPlace(0, c.places[1]);
    expect(c.draft.lines.single.folderId, 'f9');
    expect(c.draft.lines.single.destination, 'project');
    c.setPlace(0, c.places.last);
    expect(c.draft.lines.single.destination, 'warehouse');
    expect(c.draft.lines.single.folderId, isNull);
  });

  test('a supplier from the list, or typed', () {
    c.setSupplier(zzHardware);
    expect(c.draft.supplierId, 's1');
    expect(c.draft.supplierName, 'ZZ Hardware · Malolos');
    c.setSupplierName('Sari-sari');
    expect(c.draft.supplierId, isNull);
    expect(c.draft.supplierName, 'Sari-sari');
  });

  test('adjusting a split starts from the server\'s default one; a new item resets it (Q9)', () {
    c.addLine();
    c.updateLine(1, c.draft.lines[1].copyWith(amount: '100'));
    c.addCharge('delivery_fee');
    c.updateCharge(0, c.draft.charges[0].copyWith(amount: '40'));
    c.adjustSplit(0, true);
    expect(c.draft.charges[0].shares, ['30.00', '10.00']);
    c.addLine();
    expect(c.draft.charges[0].shares, isNull);
    c.adjustSplit(0, false);
    expect(c.draft.charges[0].shares, isNull);
  });

  test('a new photo replaces the old one in its slot, and the old file goes (Q8)', () async {
    await c.addPhoto('supplier_invoice_url', 'a.jpg');
    await c.addPhoto('supplier_invoice_url', 'b.jpg');
    expect(c.draft.photos, {'supplier_invoice_url': '/kept/b.jpg'});
    expect(api.calls, contains('discardPhoto:/kept/a.jpg'));
    await c.removePhoto('supplier_invoice_url');
    expect(c.draft.photos, isEmpty);
  });

  test('a photo turns "No receipt" off', () async {
    c.setNoReceipt(true);
    await c.addPhoto('po_image_url', 'a.jpg');
    expect(c.draft.noReceipt, isFalse);
  });

  test('problems show only after trying to send; a complete purchase is queued', () async {
    expect(c.problems, isEmpty);
    expect(await c.send(), isFalse);
    expect(c.problems.map((p) => p.kind), containsAll([ProblemKind.noReceipt, ProblemKind.badTotal]));
    await c.addPhoto('supplier_invoice_url', 'a.jpg');
    c.setTotal('300');
    expect(await c.send(), isTrue);
    expect(api.sent.single.id, c.draft.id);
  });

  test('a phone failure while queueing is said in both languages', () async {
    await c.addPhoto('supplier_invoice_url', 'a.jpg');
    c.setTotal('300');
    api.error = Exception('disk full');
    expect(await c.send(), isFalse);
    expect(c.notice!.english, 'Something went wrong. Try again.');
  });

  test('throwing away deletes the draft', () async {
    await c.discard();
    expect(api.calls.last, startsWith('deleteDraft:'));
  });

  test('the computed total is shown as typed amounts add up', () {
    c.addCharge('discount');
    c.updateCharge(0, c.draft.charges[0].copyWith(amount: '50'));
    expect(c.draft.computedTotal, 250);
  });
}
```

**Create:** `test/purchasing/record/record_screen_test.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';
import 'package:workmate/purchasing/purchasing_services.dart';
import 'package:workmate/purchasing/record/record_controller.dart';
import 'package:workmate/purchasing/record/record_screen.dart';
import 'package:workmate/ui/theme.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../domain/purchase_draft_test.dart' show linked;
import '../purchasing_api_fake.dart';

void main() {
  late FakePurchasingApi api;
  late PurchasingServices services;
  var shots = 0;

  setUp(() {
    api = FakePurchasingApi();
    shots = 0;
    services = PurchasingServices(
      api: api,
      takePhoto: (_) async => 'shot${++shots}.jpg',
      pickPhoto: (_) async => 'gallery.jpg',
    );
  });

  Future<bool?> open(WidgetTester tester, {List<DraftPurchaseLine>? lines}) async {
    useTallPhone(tester);
    bool? result;
    await tester.pumpWidget(MaterialApp(
      theme: workMateTheme(),
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async => result = await openRecord(context, services, lines: lines),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return result;
  }

  // The form's own list (every text field has a Scrollable of its own), then
  // all of the widget on screen: scrollUntilVisible stops at its first pixel.
  Future<void> scrollTo(WidgetTester tester, Finder f, {double step = 200}) async {
    await tester.scrollUntilVisible(f, step,
        scrollable: find.descendant(of: find.byKey(const Key('record-form')), matching: find.byType(Scrollable)).first);
    await tester.ensureVisible(f);
    await tester.pumpAndSettle();
  }

  testWidgets('an unplanned purchase, start to finish: item, place, reason, receipt, total (Q7–Q11)', (tester) async {
    await open(tester);
    expect(find.text('Record purchase'), findsWidgets);
    expect(find.text('Itala ang binili'), findsWidgets);
    await tester.enterText(find.byKey(const Key('supplier-name')), 'ZZ Hardware');
    await tester.enterText(find.byKey(const Key('item-1')), 'ZZ wire');
    await tester.enterText(find.byKey(const Key('qty-1')), '2');
    await tester.enterText(find.byKey(const Key('unit-1')), 'roll');
    await tester.enterText(find.byKey(const Key('amount-1')), '500');
    await tester.tap(find.byKey(const Key('place-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Barlin Residence').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('unplanned-1')), 'Site ran out');
    await scrollTo(tester, find.byKey(const Key('camera-supplier_invoice_url')));
    await tester.tap(find.byKey(const Key('camera-supplier_invoice_url')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-supplier_invoice_url')), findsOneWidget);
    await scrollTo(tester, find.byKey(const Key('receipt-total')));
    await tester.enterText(find.byKey(const Key('receipt-total')), '500');
    await tester.pump();
    expect(find.text('Items + fees − discounts: ₱500.00'), findsOneWidget);
    await scrollTo(tester, find.byKey(const Key('record-send')));
    await tester.tap(find.byKey(const Key('record-send')));
    await tester.pumpAndSettle();
    final sent = api.sent.single;
    expect(sent.lines.single.folderId, 'f1');
    expect(sent.lines.single.unplannedReason, 'Site ran out');
    expect(sent.photos.keys, ['supplier_invoice_url']);
    expect(sent.supplierName, 'ZZ Hardware');
    expect(find.text('open'), findsOneWidget, reason: 'back where it was opened from');
  });

  testWidgets('sending something incomplete names each problem, in both languages, next to its field', (tester) async {
    await open(tester);
    await scrollTo(tester, find.byKey(const Key('record-send')));
    await tester.tap(find.byKey(const Key('record-send')));
    await tester.pumpAndSettle();
    expect(api.sent, isEmpty);
    // The item card grew its own problems above: scroll to the general ones.
    await scrollTo(tester, find.byKey(const Key('problem-badTotal-0')));
    expect(find.text('Add a receipt photo, or tap No receipt and say why.'), findsOneWidget);
    expect(find.text('Ilagay ang total na nakasulat sa resibo.'), findsOneWidget);
    await scrollTo(tester, find.byKey(const Key('problem-unplannedReasonRequired-1')), step: -200);
    expect(find.byKey(const Key('problem-unplannedReasonRequired-1')), findsOneWidget);
  });

  testWidgets('a line from the shopping list asks "Is this the same item?" (Q10)', (tester) async {
    await open(tester, lines: [linked()]);
    expect(find.text('For the request: Cement · Barlin Residence'), findsOneWidget);
    expect(find.text('Is this the same item?'), findsOneWidget);
    expect(find.text('Ito ba ang parehong item?'), findsOneWidget);
    expect(find.byKey(const Key('place-1')), findsNothing, reason: 'a request line goes where its request is');
    await tester.tap(find.text('Substitute'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('substitute-1')), findsOneWidget);
  });

  testWidgets('a different unit asks how much it covers; an extra asks why and where (Q10, Q11)', (tester) async {
    await open(tester, lines: [linked()]);
    await tester.enterText(find.byKey(const Key('unit-1')), 'box');
    await tester.pump();
    expect(find.byKey(const Key('unit-note-1')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('unit-1')), 'bag');
    await tester.enterText(find.byKey(const Key('qty-1')), '12');
    await tester.pump();
    expect(find.byKey(const Key('unit-note-1')), findsNothing);
    expect(find.text('2 bag more than still needed: an extra.'), findsOneWidget);
    expect(find.byKey(const Key('extra-1')), findsOneWidget);
    await scrollTo(tester, find.text('To the warehouse'));
    await tester.tap(find.text('To the warehouse'));
    await tester.pump();
    expect(api.saved.last.lines.single.extraLocation, 'warehouse');
  });

  testWidgets('No receipt asks why (Q8)', (tester) async {
    await open(tester);
    await scrollTo(tester, find.byKey(const Key('no-receipt')));
    await tester.tap(find.byKey(const Key('no-receipt')));
    await tester.pump();
    expect(find.byKey(const Key('no-receipt-reason')), findsOneWidget);
    expect(find.byKey(const Key('camera-supplier_invoice_url')), findsNothing);
  });

  testWidgets('a photo from the gallery fills a slot (Q8)', (tester) async {
    await open(tester);
    await scrollTo(tester, find.byKey(const Key('gallery-payment_receipt_url')));
    await tester.tap(find.byKey(const Key('gallery-payment_receipt_url')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-payment_receipt_url')), findsOneWidget);
  });

  testWidgets('a delivery fee joins the total; its split can be adjusted per item (Q9)', (tester) async {
    await open(tester);
    await tester.enterText(find.byKey(const Key('amount-1')), '500');
    await scrollTo(tester, find.byKey(const Key('add-fee')));
    await tester.tap(find.byKey(const Key('add-fee')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('charge-amount-1')), '50');
    await tester.pump();
    await scrollTo(tester, find.byKey(const Key('computed-total')));
    expect(find.text('Items + fees − discounts: ₱550.00'), findsOneWidget);
    await scrollTo(tester, find.byKey(const Key('adjust-1')));
    await tester.tap(find.byKey(const Key('adjust-1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('share-1-1')), findsOneWidget);
  });

  test('openRecord\'s blank purchase has one item to fill', () {
    final c = RecordController(api: api, draft: api.newDraft(lines: [const DraftPurchaseLine(key: 'k', quantity: '1', category: 'Materials')]));
    expect(c.draft.lines.single.category, 'Materials');
  });
}
```

<!-- Code -->

**Modify:** `lib/purchasing/domain/purchase_draft.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/domain/purchase_draft.dart b/lib/purchasing/domain/purchase_draft.dart
index 5a4f9fe..7f3b5a6 100644
--- a/lib/purchasing/domain/purchase_draft.dart
+++ b/lib/purchasing/domain/purchase_draft.dart
@@ -113,7 +113,8 @@ class DraftPurchaseLine {
       itemName: line.description,
       quantity: qty > 0 ? formatQuantity(qty).replaceAll(',', '') : '',
       unit: line.unit,
-      category: line.category,
+      // The Purchasing tab's default: the request's category, else Materials.
+      category: line.category.trim().isEmpty ? 'Materials' : line.category,
       folderId: line.workId,
       folderLabel: line.placeLabel,
       requestLineId: line.lineId,
```

**Modify:** `lib/purchasing/purchasing_services.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/purchasing_services.dart b/lib/purchasing/purchasing_services.dart
index 1abee02..1c96a04 100644
--- a/lib/purchasing/purchasing_services.dart
+++ b/lib/purchasing/purchasing_services.dart
@@ -1,13 +1,36 @@
-import 'package:flutter/foundation.dart';
+import 'package:flutter/material.dart';
+import 'package:image_picker/image_picker.dart';
 
+import '../requests/camera/request_camera_screen.dart';
 import 'data/purchasing_api.dart';
 
+/// Opens the camera or the gallery; the chosen file's path, or null.
+typedef PickReceipt = Future<String?> Function(BuildContext context);
+
+Future<String?> realTakeReceipt(BuildContext context) => Navigator.of(context).push<String>(
+      MaterialPageRoute(builder: (_) => const RequestCameraScreen(title: 'Photo of the receipt'), fullscreenDialog: true),
+    );
+
+/// Q8: a photo already on the phone (a receipt sent by chat, a screenshot).
+/// image_picker hands back a COPY in the app's cache, which the repository
+/// then files and deletes.
+Future<String?> realPickReceipt(BuildContext context) async =>
+    (await ImagePicker().pickImage(source: ImageSource.gallery, requestFullMetadata: false))?.path;
+
 /// Everything the buying screens need, built once in main.dart.
 class PurchasingServices {
-  const PurchasingServices({required this.api, this.changed});
+  const PurchasingServices({
+    required this.api,
+    this.changed,
+    this.takePhoto = realTakeReceipt,
+    this.pickPhoto = realPickReceipt,
+  });
 
   final PurchasingApi api;
 
   /// Fires when the live app's background drain settled queued purchases.
   final Listenable? changed;
+
+  final PickReceipt takePhoto;
+  final PickReceipt pickPhoto;
 }
```

**Create:** `lib/purchasing/record/record_controller.dart`

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../requests/domain/quantity.dart';
import '../data/purchasing_api.dart';
import '../domain/pur_failure.dart';
import '../domain/pur_models.dart';
import '../domain/purchase_draft.dart';

/// A place a purchase line may go (Q11): a project, one of its open
/// Additional Works jobs, or the warehouse ([folderId] null).
class PlaceOption {
  const PlaceOption(this.folderId, this.label);
  final String? folderId;
  final String label;
  bool get warehouse => folderId == null;
}

/// The Record purchase form (Q7–Q11). Every change is saved on the phone at
/// once; Send queues it to be recorded when there is signal.
class RecordController extends ChangeNotifier {
  RecordController({required this.api, required PurchaseDraft draft}) : _draft = draft;

  final PurchasingApi api;
  PurchaseDraft _draft;
  PurchaseDraft get draft => _draft;

  PurchaseChoices? choices;

  /// Problems are shown once the buyer has tried to send.
  bool _tried = false;
  List<PurchaseProblem> get problems => _tried ? purchaseProblems(_draft) : const [];

  bool sending = false;
  Bilingual? notice;

  Future<void> load() async {
    try {
      choices = await api.choices();
    } catch (e) {
      notice = purFailureCopy(PurFailure.of(e));
    }
    notifyListeners();
  }

  void _set(PurchaseDraft d) {
    _draft = d;
    unawaited(api.saveDraft(d).catchError((Object _) {}));
    notifyListeners();
  }

  /// Where an unplanned line may go: every open project and job, then the warehouse.
  List<PlaceOption> get places => [
        for (final d in choices?.destinations ?? const <PurDestination>[]) ...[
          PlaceOption(d.folderId, d.name),
          for (final w in d.works) PlaceOption(w.folderId, '${d.name} · ${w.name}'),
        ],
        const PlaceOption(null, 'Warehouse'),
      ];

  List<Supplier> get suppliers => [for (final s in choices?.suppliers ?? const <Supplier>[]) if (s.active) s];

  // ── the purchase ───────────────────────────────────────────────────────

  void setDate(String iso) => _set(_draft.copyWith(purchaseDate: iso));

  /// A supplier from the list, or (null) one typed by name.
  void setSupplier(Supplier? s) => _set(_draft.copyWith(supplierId: s?.id, supplierName: s?.label ?? ''));

  void setSupplierName(String name) => _set(_draft.copyWith(supplierId: null, supplierName: name));

  void setPayment(String method) => _set(_draft.copyWith(paymentMethod: method));

  void setNotes(String notes) => _set(_draft.copyWith(notes: notes));

  void setTotal(String total) => _set(_draft.copyWith(receiptTotal: total));

  // ── lines ──────────────────────────────────────────────────────────────

  /// An item with no request (Q11): needs a reason and a place.
  void addLine() => _set(_draft.copyWith(
        lines: [..._draft.lines, DraftPurchaseLine(key: api.newLineKey(), quantity: '1', category: 'Materials')],
        // A new line changes the split: an adjusted one must be redone.
        charges: [for (final c in _draft.charges) c.copyWith(shares: null)],
      ));

  void updateLine(int i, DraftPurchaseLine line) {
    final lines = [..._draft.lines]..[i] = line;
    _set(_draft.copyWith(lines: lines));
  }

  void setPlace(int i, PlaceOption place) => updateLine(
        i,
        _draft.lines[i].copyWith(
          destination: place.warehouse ? 'warehouse' : 'project',
          folderId: place.folderId,
          folderLabel: place.label,
        ),
      );

  void removeLine(int i) {
    final lines = [..._draft.lines]..removeAt(i);
    _set(_draft.copyWith(lines: lines, charges: [for (final c in _draft.charges) c.copyWith(shares: null)]));
  }

  // ── fees and discounts (Q9) ────────────────────────────────────────────

  void addCharge(String kind) => _set(_draft.copyWith(charges: [..._draft.charges, DraftCharge(kind: kind)]));

  void updateCharge(int i, DraftCharge c) {
    final charges = [..._draft.charges]..[i] = c;
    _set(_draft.copyWith(charges: charges));
  }

  void removeCharge(int i) {
    final charges = [..._draft.charges]..removeAt(i);
    _set(_draft.copyWith(charges: charges));
  }

  /// The buyer adjusts the split, starting from the server's default one.
  void adjustSplit(int i, bool on) {
    final c = _draft.charges[i];
    if (!on) return updateCharge(i, c.copyWith(shares: null));
    final split = prorate(parseMoney(c.amount) ?? 0, [for (final l in _draft.lines) parseMoney(l.amount) ?? 0]);
    updateCharge(i, c.copyWith(shares: [for (final s in split) s.toStringAsFixed(2)]));
  }

  // ── receipt (Q8) ───────────────────────────────────────────────────────

  Future<void> addPhoto(String slot, String sourcePath) async {
    final kept = await api.keepPhoto(_draft.id, sourcePath);
    final old = _draft.photos[slot];
    _set(_draft.copyWith(photos: {..._draft.photos, slot: kept}, noReceipt: false));
    if (old != null) await api.discardPhoto(old);
  }

  Future<void> removePhoto(String slot) async {
    final old = _draft.photos[slot];
    _set(_draft.copyWith(photos: {..._draft.photos}..remove(slot)));
    if (old != null) await api.discardPhoto(old);
  }

  void setNoReceipt(bool on) => _set(_draft.copyWith(noReceipt: on));

  void setNoReceiptReason(String reason) => _set(_draft.copyWith(noReceiptReason: reason));

  /// "Items + fees − discounts", for the total check (Q9).
  String get computedTotalText => formatQuantity(_draft.computedTotal);

  // ── send ───────────────────────────────────────────────────────────────

  /// True once queued (it goes out when there is signal, Q7); false when the
  /// form still has problems, now shown.
  Future<bool> send() async {
    _tried = true;
    if (purchaseProblems(_draft).isNotEmpty || sending) {
      notifyListeners();
      return false;
    }
    sending = true;
    notice = null;
    notifyListeners();
    try {
      await api.send(_draft);
      return true;
    } on PurchaseInvalid {
      return false;
    } catch (e) {
      notice = purFailureCopy(PurFailure.of(e));
      return false;
    } finally {
      sending = false;
      notifyListeners();
    }
  }

  /// Throws the draft away, with its photos.
  Future<void> discard() => api.deleteDraft(_draft);
}
```

**Create:** `lib/purchasing/record/record_screen.dart`

```dart
import 'dart:io';

import 'package:flutter/material.dart';

import '../../attendance/domain/work_date.dart';
import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../requests/domain/quantity.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../domain/pur_models.dart';
import '../domain/purchase_draft.dart';
import '../purchasing_services.dart';
import '../ui/purchasing_copy.dart';
import 'record_controller.dart';

/// Opens Record purchase for [lines] (picked from the shopping list), or for
/// a saved [draft], or blank (an unplanned purchase, Q11). True once queued.
Future<bool> openRecord(BuildContext context, PurchasingServices services, {List<DraftPurchaseLine>? lines, PurchaseDraft? draft}) async {
  final api = services.api;
  final d = draft ??
      api.newDraft(
        lines: lines != null && lines.isNotEmpty ? lines : [DraftPurchaseLine(key: api.newLineKey(), quantity: '1', category: 'Materials')],
      );
  final queued = await Navigator.of(context).push<bool>(
    MaterialPageRoute(builder: (_) => RecordScreen(controller: RecordController(api: api, draft: d)..load(), services: services)),
  );
  return queued == true;
}

/// Record a purchase (Q7–Q11). Works with no signal: it is saved on the phone
/// as "Waiting to send" and recorded once, when there is signal.
class RecordScreen extends StatelessWidget {
  const RecordScreen({super.key, required this.controller, required this.services});

  final RecordController controller;
  final PurchasingServices services;

  Future<void> _send(BuildContext context) async {
    if (await controller.send() && context.mounted) Navigator.of(context).pop(true);
  }

  Future<void> _discard(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Throw this purchase away?'),
        content: const Text('Nothing was sent. Its photos are deleted from the phone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Throw away')),
        ],
      ),
    );
    if (ok == true) {
      await controller.discard();
      if (context.mounted) Navigator.of(context).pop(false);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final c = controller;
          final d = c.draft;
          final problems = c.problems;
          final general = [for (final p in problems) if (p.line == null && p.charge == null) p];
          return Scaffold(
            appBar: AppBar(
              title: const BilingualText(recordLabel, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
              actions: [IconButton(key: const Key('record-discard'), tooltip: 'Throw away', onPressed: () => _discard(context), icon: const Icon(Icons.delete_outline))],
            ),
            body: SafeArea(
              child: ListView(key: const Key('record-form'), padding: const EdgeInsets.all(16), children: [
                const Text('Saved on this phone as you type. It is sent when there is signal.',
                    style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
                if (c.notice != null) ...[
                  const SizedBox(height: 10),
                  FailureNotice(english: c.notice!.english, tagalog: c.notice!.tagalog),
                ],
                const SizedBox(height: 14),
                _heading('1', 'The purchase'),
                _DateField(value: d.purchaseDate, onChanged: c.setDate),
                const SizedBox(height: 10),
                _SupplierField(controller: c),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: const Key('payment'),
                  initialValue: paymentMethods.contains(d.paymentMethod) ? d.paymentMethod : 'Cash',
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Paid with'),
                  items: [
                    for (final m in paymentMethods)
                      DropdownMenuItem(value: m, child: Text(m.isEmpty ? 'Not yet paid / not known' : m, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (m) => c.setPayment(m ?? ''),
                ),
                const SizedBox(height: 18),
                _heading('2', 'What was bought'),
                for (var i = 0; i < d.lines.length; i++)
                  _LineCard(
                    key: ValueKey(d.lines[i].key),
                    index: i,
                    line: d.lines[i],
                    controller: c,
                    problems: [for (final p in problems) if (p.line == i + 1) p],
                  ),
                TextButton.icon(
                  key: const Key('add-line'),
                  onPressed: c.addLine,
                  icon: const Icon(Icons.add),
                  label: const Text('Add an item with no request'),
                ),
                const SizedBox(height: 18),
                _heading('3', 'Delivery fees and discounts'),
                const Text('Optional. Shared across the items by amount unless you adjust it.',
                    style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
                for (var i = 0; i < d.charges.length; i++)
                  _ChargeCard(
                    key: ValueKey('charge-$i-${d.charges[i].kind}'),
                    index: i,
                    controller: c,
                    problems: [for (final p in problems) if (p.charge == i + 1) p],
                  ),
                Wrap(spacing: 8, children: [
                  TextButton.icon(
                      key: const Key('add-fee'), onPressed: () => c.addCharge('delivery_fee'), icon: const Icon(Icons.add), label: const Text('Delivery fee')),
                  TextButton.icon(
                      key: const Key('add-discount'), onPressed: () => c.addCharge('discount'), icon: const Icon(Icons.add), label: const Text('Discount')),
                ]),
                const SizedBox(height: 18),
                _heading('4', 'Receipt'),
                _ReceiptPhotos(controller: c, services: services),
                const SizedBox(height: 18),
                TextFormField(
                  key: const Key('notes'),
                  initialValue: d.notes,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'Notes (optional)'),
                  onChanged: c.setNotes,
                ),
                const SizedBox(height: 18),
                _heading('5', 'Receipt total'),
                TextFormField(
                  key: const Key('receipt-total'),
                  initialValue: d.receiptTotal,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Total on the receipt', prefixText: '₱ '),
                  onChanged: c.setTotal,
                ),
                const SizedBox(height: 6),
                Text(
                  key: const Key('computed-total'),
                  'Items + fees − discounts: ${peso(d.computedTotal)}',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: parseMoney(d.receiptTotal) != null && round2(parseMoney(d.receiptTotal)!) == d.computedTotal ? WmColors.green : WmColors.textSecondary,
                  ),
                ),
                for (final p in general) ...[const SizedBox(height: 8), _ProblemText(p)],
                const SizedBox(height: 20),
                bilingualButton(recordLabel, c.sending ? null : () => _send(context), filled: true, key: const Key('record-send')),
                const SizedBox(height: 24),
              ]),
            ),
          );
        },
      );

  Widget _heading(String n, String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(children: [
          CircleAvatar(radius: 12, backgroundColor: WmColors.greenTint, child: Text(n, style: const TextStyle(fontSize: 12, color: WmColors.green))),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
        ]),
      );
}

class _ProblemText extends StatelessWidget {
  const _ProblemText(this.problem);
  final PurchaseProblem problem;

  @override
  Widget build(BuildContext context) {
    final b = problemCopy(problem.kind);
    return Column(key: Key('problem-${problem.kind.name}-${problem.line ?? problem.charge ?? 0}'), crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(b.english, style: const TextStyle(color: WmColors.danger, fontWeight: FontWeight.w700, fontSize: 13)),
      Text(b.tagalog, style: const TextStyle(color: WmColors.danger, fontSize: 12)),
    ]);
  }
}

class _DateField extends StatelessWidget {
  const _DateField({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => InkWell(
        key: const Key('purchase-date'),
        onTap: () async {
          final today = manilaDate(DateTime.now());
          final current = DateTime.tryParse(value) ?? today;
          final picked = await showDatePicker(
            context: context,
            initialDate: current.isAfter(today) ? today : current,
            firstDate: today.subtract(const Duration(days: 365)),
            lastDate: today,
          );
          if (picked != null) onChanged(isoDate(picked));
        },
        child: InputDecorator(
          decoration: const InputDecoration(labelText: 'Date bought (the date on the receipt)'),
          child: Text(value, style: const TextStyle(fontSize: 16)),
        ),
      );
}

class _SupplierField extends StatelessWidget {
  const _SupplierField({required this.controller});
  final RecordController controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final d = c.draft;
    final list = c.suppliers;
    final typed = d.supplierId == null;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      DropdownButtonFormField<String?>(
        key: const Key('supplier'),
        initialValue: list.any((s) => s.id == d.supplierId) ? d.supplierId : null,
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'Supplier'),
        items: [
          const DropdownMenuItem<String?>(value: null, child: Text('Not on the list — type the name', overflow: TextOverflow.ellipsis)),
          for (final s in list) DropdownMenuItem<String?>(value: s.id, child: Text(s.label, overflow: TextOverflow.ellipsis)),
        ],
        onChanged: (id) => c.setSupplier(id == null ? null : list.firstWhere((s) => s.id == id)),
      ),
      if (typed) ...[
        const SizedBox(height: 8),
        TextFormField(
          key: const Key('supplier-name'),
          initialValue: d.supplierName,
          decoration: const InputDecoration(labelText: 'Supplier name'),
          onChanged: c.setSupplierName,
        ),
      ],
    ]);
  }
}

class _LineCard extends StatelessWidget {
  const _LineCard({super.key, required this.index, required this.line, required this.controller, required this.problems});
  final int index;
  final DraftPurchaseLine line;
  final RecordController controller;
  final List<PurchaseProblem> problems;

  void _update(DraftPurchaseLine l) => controller.updateLine(index, l);

  @override
  Widget build(BuildContext context) {
    final l = line;
    final c = controller;
    final n = index + 1;
    final places = c.places;
    final placeIndex = l.destination == 'warehouse' ? places.indexWhere((p) => p.warehouse) : places.indexWhere((p) => p.folderId == l.folderId);
    return Card(
      key: Key('line-$n'),
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: WmColors.border)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('Item $n', style: monoLabel)),
            if (c.draft.lines.length > 1)
              IconButton(key: Key('remove-line-$n'), onPressed: () => c.removeLine(index), icon: const Icon(Icons.close), tooltip: 'Remove'),
          ]),
          if (l.linked) ...[
            Text('For the request: ${l.requestName} · ${l.folderLabel}', style: const TextStyle(fontWeight: FontWeight.w700)),
            Text('${stillToBuyLabel.english} on the picked part: ${qtyUnit(l.pickedStill, l.requestUnit)}',
                style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
            const SizedBox(height: 8),
          ],
          TextFormField(
            key: Key('item-$n'),
            initialValue: l.itemName,
            decoration: const InputDecoration(labelText: 'Item'),
            onChanged: (v) => _update(l.copyWith(itemName: v)),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: TextFormField(
                key: Key('qty-$n'),
                initialValue: l.quantity,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Quantity'),
                onChanged: (v) => _update(l.copyWith(quantity: v)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextFormField(
                key: Key('unit-$n'),
                initialValue: l.unit,
                decoration: const InputDecoration(labelText: 'Unit'),
                onChanged: (v) => _update(l.copyWith(unit: v)),
              ),
            ),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: TextFormField(
                key: Key('amount-$n'),
                initialValue: l.amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount paid', prefixText: '₱ '),
                onChanged: (v) => _update(l.copyWith(amount: v)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextFormField(
                key: Key('category-$n'),
                initialValue: l.category,
                decoration: const InputDecoration(labelText: 'Category'),
                onChanged: (v) => _update(l.copyWith(category: v)),
              ),
            ),
          ]),
          const SizedBox(height: 8),
          if (!l.linked) ...[
            DropdownButtonFormField<int>(
              key: Key('place-$n'),
              initialValue: placeIndex < 0 ? null : placeIndex,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'For (project, job or warehouse)'),
              items: [for (var i = 0; i < places.length; i++) DropdownMenuItem(value: i, child: Text(places[i].label, overflow: TextOverflow.ellipsis))],
              onChanged: (i) => i == null ? null : c.setPlace(index, places[i]),
            ),
            const SizedBox(height: 8),
            TextFormField(
              key: Key('unplanned-$n'),
              initialValue: l.unplannedReason,
              decoration: const InputDecoration(labelText: 'No request: why was it bought?'),
              onChanged: (v) => _update(l.copyWith(unplannedReason: v)),
            ),
          ] else ...[
            const BilingualText(Bilingual('Is this the same item?', 'Ito ba ang parehong item?')),
            const SizedBox(height: 6),
            SegmentedButton<LineMatch>(
              key: Key('match-$n'),
              segments: const [
                ButtonSegment(value: LineMatch.same, label: Text('Same')),
                ButtonSegment(value: LineMatch.otherWords, label: Text('Other words')),
                ButtonSegment(value: LineMatch.substitute, label: Text('Substitute')),
              ],
              selected: {l.match},
              onSelectionChanged: (s) => _update(l.copyWith(match: s.first)),
            ),
            if (l.match == LineMatch.substitute) ...[
              const SizedBox(height: 8),
              TextFormField(
                key: Key('substitute-$n'),
                initialValue: l.substituteReason,
                decoration: const InputDecoration(labelText: 'Why a substitute? (the office checks it)'),
                onChanged: (v) => _update(l.copyWith(substituteReason: v)),
              ),
            ],
            if (l.differentUnit && l.match != LineMatch.substitute) ...[
              const SizedBox(height: 8),
              Text('A different unit from the request (${l.requestUnit}): it counts after the office checks it.',
                  style: const TextStyle(fontSize: 13, color: WmColors.brownDeep)),
              TextFormField(
                key: Key('unit-note-$n'),
                initialValue: l.unitNote,
                decoration: const InputDecoration(labelText: 'How much does it cover? (e.g. 1 box = 12 pc)'),
                onChanged: (v) => _update(l.copyWith(unitNote: v)),
              ),
            ],
            if (l.extraQuantity > 0) ...[
              const SizedBox(height: 8),
              Text('${formatQuantity(l.extraQuantity)} ${l.unit} more than still needed: an extra.',
                  style: const TextStyle(fontSize: 13, color: WmColors.brownDeep)),
              TextFormField(
                key: Key('extra-$n'),
                initialValue: l.extraReason,
                decoration: const InputDecoration(labelText: 'Why the extra?'),
                onChanged: (v) => _update(l.copyWith(extraReason: v)),
              ),
              const SizedBox(height: 6),
              SegmentedButton<String>(
                key: Key('extra-location-$n'),
                emptySelectionAllowed: true,
                segments: const [
                  ButtonSegment(value: 'project', label: Text('Stays on the project')),
                  ButtonSegment(value: 'warehouse', label: Text('To the warehouse')),
                ],
                selected: {?l.extraLocation},
                onSelectionChanged: (s) => _update(l.copyWith(extraLocation: s.isEmpty ? null : s.first)),
              ),
            ],
          ],
          for (final p in problems) ...[const SizedBox(height: 6), _ProblemText(p)],
        ]),
      ),
    );
  }
}

class _ChargeCard extends StatelessWidget {
  const _ChargeCard({super.key, required this.index, required this.controller, required this.problems});
  final int index;
  final RecordController controller;
  final List<PurchaseProblem> problems;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final ch = c.draft.charges[index];
    final n = index + 1;
    final shares = ch.shares;
    return Card(
      key: Key('charge-$n'),
      color: Colors.white,
      margin: const EdgeInsets.only(top: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: WmColors.border)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: TextFormField(
                key: Key('charge-amount-$n'),
                initialValue: ch.amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: ch.isFee ? 'Delivery fee' : 'Discount', prefixText: '₱ '),
                onChanged: (v) => c.updateCharge(index, ch.copyWith(amount: v)),
              ),
            ),
            IconButton(key: Key('remove-charge-$n'), onPressed: () => c.removeCharge(index), icon: const Icon(Icons.close)),
          ]),
          SwitchListTile(
            key: Key('adjust-$n'),
            contentPadding: EdgeInsets.zero,
            title: const Text('Adjust the split'),
            value: shares != null,
            onChanged: (on) => c.adjustSplit(index, on),
          ),
          if (shares != null)
            for (var i = 0; i < shares.length && i < c.draft.lines.length; i++)
              TextFormField(
                key: Key('share-$n-${i + 1}'),
                initialValue: shares[i],
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: 'Item ${i + 1}: ${c.draft.lines[i].itemName}', prefixText: '₱ '),
                onChanged: (v) => c.updateCharge(index, ch.copyWith(shares: [...shares]..[i] = v)),
              ),
          for (final p in problems) ...[const SizedBox(height: 6), _ProblemText(p)],
        ]),
      ),
    );
  }
}

class _ReceiptPhotos extends StatelessWidget {
  const _ReceiptPhotos({required this.controller, required this.services});
  final RecordController controller;
  final PurchasingServices services;

  Future<void> _add(BuildContext context, String slot, PickReceipt pick) async {
    final path = await pick(context);
    if (path != null) await controller.addPhoto(slot, path);
  }

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final d = c.draft;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (!d.noReceipt)
        for (final slot in receiptSlots)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Expanded(child: Text(receiptSlotLabels[slot]!, style: const TextStyle(fontWeight: FontWeight.w600))),
              if (d.photos[slot] case final path?) ...[
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.file(File(path), key: Key('photo-$slot'), width: 52, height: 52, fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const Icon(Icons.receipt_long, size: 40)),
                ),
                IconButton(key: Key('remove-photo-$slot'), onPressed: () => c.removePhoto(slot), icon: const Icon(Icons.close)),
              ] else ...[
                IconButton(
                    key: Key('camera-$slot'), tooltip: 'Camera', onPressed: () => _add(context, slot, services.takePhoto), icon: const Icon(Icons.photo_camera_outlined)),
                IconButton(
                    key: Key('gallery-$slot'), tooltip: 'Gallery', onPressed: () => _add(context, slot, services.pickPhoto), icon: const Icon(Icons.photo_library_outlined)),
              ],
            ]),
          ),
      CheckboxListTile(
        key: const Key('no-receipt'),
        contentPadding: EdgeInsets.zero,
        value: d.noReceipt,
        onChanged: (v) => c.setNoReceipt(v == true),
        title: const BilingualText(noReceiptLabel),
      ),
      if (d.noReceipt)
        TextFormField(
          key: const Key('no-receipt-reason'),
          initialValue: d.noReceiptReason,
          decoration: const InputDecoration(labelText: 'Why is there no receipt?'),
          onChanged: c.setNoReceiptReason,
        ),
    ]);
  }
}
```

**Modify:** `lib/purchasing/ui/buyer_shell.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/ui/buyer_shell.dart b/lib/purchasing/ui/buyer_shell.dart
index 61ff9f1..b69a0e8 100644
--- a/lib/purchasing/ui/buyer_shell.dart
+++ b/lib/purchasing/ui/buyer_shell.dart
@@ -3,9 +3,11 @@ import 'package:flutter/material.dart';
 import '../../auth/worker_profile.dart';
 import '../../profile/account_services.dart';
 import '../../profile/profile_screen.dart';
+import '../domain/purchase_draft.dart';
 import '../list/shopping_controller.dart';
 import '../list/shopping_list_screen.dart';
 import '../purchasing_services.dart';
+import '../record/record_screen.dart';
 
 enum _Tab { shopping, profile }
 
@@ -72,6 +74,21 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     if (t == _Tab.shopping) _shopping?.refresh();
   }
 
+  /// Record purchase (Q7): picked lines, a saved draft, or blank (unplanned).
+  Future<void> _record({List<DraftPurchaseLine>? lines, PurchaseDraft? draft}) async {
+    final p = widget.purchasing;
+    if (p == null) return;
+    final queued = await openRecord(context, p, lines: lines, draft: draft);
+    if (!mounted) return;
+    _shopping?.refresh();
+    if (queued) {
+      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
+        key: Key('queued-snack'),
+        content: Text('Saved. It is sent when there is signal. · Nai-save. Ipapadala kapag may signal.'),
+      ));
+    }
+  }
+
   @override
   Widget build(BuildContext context) {
     final profile =
@@ -79,11 +96,19 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     final tabs = _tabs;
     if (tabs.length < 2) return Scaffold(body: SafeArea(child: profile));
     final body = switch (_tab) {
-      _Tab.shopping => ShoppingListScreen(controller: _shopping!),
+      _Tab.shopping => ShoppingListScreen(controller: _shopping!, onRecord: (lines) => _record(lines: lines)),
       _Tab.profile => profile,
     };
     return Scaffold(
       body: SafeArea(child: body),
+      floatingActionButton: _tab == _Tab.profile
+          ? null
+          : FloatingActionButton.extended(
+              key: const Key('record-unplanned'),
+              onPressed: () => _record(),
+              icon: const Icon(Icons.add),
+              label: const Text('Record purchase'),
+            ),
       bottomNavigationBar: NavigationBar(
         selectedIndex: tabs.indexOf(_tab),
         onDestinationSelected: (i) => _select(tabs[i]),
```

**Modify:** `lib/purchasing/ui/purchasing_copy.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/ui/purchasing_copy.dart b/lib/purchasing/ui/purchasing_copy.dart
index 9f7678d..c92a348 100644
--- a/lib/purchasing/ui/purchasing_copy.dart
+++ b/lib/purchasing/ui/purchasing_copy.dart
@@ -3,6 +3,7 @@ import 'package:flutter/material.dart';
 import '../../attendance/ui/attendance_copy.dart' show Bilingual;
 import '../../requests/domain/quantity.dart';
 import '../../ui/theme.dart';
+import '../domain/purchase_draft.dart';
 
 // Q22: English, with the Tagalog line underneath, on the key labels and
 // every message. Screen titles and small field labels stay English.
@@ -23,6 +24,45 @@ const waitingLabel = Bilingual('Waiting to send', 'Hinihintay maipadala');
 const attentionLabel = Bilingual('Needs attention', 'Kailangang ayusin');
 const needsSignal = Bilingual('This needs signal. Try again when you are online.', 'Kailangan ng signal. Subukan ulit kapag online ka na.');
 
+/// What to do about each problem, next to its field (Q22: both languages).
+Bilingual problemCopy(ProblemKind k) => switch (k) {
+      ProblemKind.badDate => const Bilingual('Pick the date you bought it.', 'Piliin ang petsa ng pagbili.'),
+      ProblemKind.noLines => const Bilingual('Add at least one item.', 'Magdagdag ng kahit isang item.'),
+      ProblemKind.tooManyLines =>
+        const Bilingual('Split this into two purchases (50 items at most).', 'Hatiin sa dalawang purchase (hanggang 50 item).'),
+      ProblemKind.badName => const Bilingual('Name the item.', 'Pangalanan ang item.'),
+      ProblemKind.badQuantity => const Bilingual('Enter a quantity above 0 (up to 3 decimals).', 'Ilagay ang dami na higit sa 0.'),
+      ProblemKind.badAmount => const Bilingual('Enter the amount paid for this item.', 'Ilagay ang halagang ibinayad sa item na ito.'),
+      ProblemKind.noProject => const Bilingual('Choose the project, the job or the warehouse.', 'Piliin ang project, trabaho o bodega.'),
+      ProblemKind.extraReasonRequired =>
+        const Bilingual('More than still needed: say why, and where the extra goes.', 'Sobra sa kailangan: sabihin kung bakit, at saan ilalagay ang sobra.'),
+      ProblemKind.nameDiffers => const Bilingual('The name differs from the request. Is it the same item in other words, or a substitute?',
+          'Iba ang pangalan sa request. Pareho bang item sa ibang salita, o pamalit?'),
+      ProblemKind.substituteReasonRequired =>
+        const Bilingual('Say why a substitute was bought.', 'Sabihin kung bakit pamalit ang binili.'),
+      ProblemKind.unitNoteRequired => const Bilingual('A different unit from the request: say how much it covers (e.g. 1 box = 12 pc).',
+          'Ibang unit sa request: sabihin kung gaano karami ito (hal. 1 box = 12 pc).'),
+      ProblemKind.unplannedReasonRequired =>
+        const Bilingual('No request for this item: say why it was bought.', 'Walang request ang item na ito: sabihin kung bakit binili.'),
+      ProblemKind.badChargeAmount => const Bilingual('Enter the amount.', 'Ilagay ang halaga.'),
+      ProblemKind.splitMismatch =>
+        const Bilingual('The shares must add up to the amount, one per item.', 'Dapat tugma ang kabuuan ng hati sa halaga.'),
+      ProblemKind.noReceipt =>
+        const Bilingual('Add a receipt photo, or tap No receipt and say why.', 'Maglagay ng litrato ng resibo, o pindutin ang Walang resibo at sabihin kung bakit.'),
+      ProblemKind.noReceiptReason => const Bilingual('Say why there is no receipt.', 'Sabihin kung bakit walang resibo.'),
+      ProblemKind.badTotal => const Bilingual('Enter the total printed on the receipt.', 'Ilagay ang total na nakasulat sa resibo.'),
+      ProblemKind.totalMismatch => const Bilingual('Items + fees − discounts do not match the receipt total.',
+          'Hindi tugma ang items + bayad − diskwento sa total ng resibo.'),
+    };
+
+/// The four receipt slots, as the Purchasing tab names them.
+const receiptSlotLabels = {
+  'supplier_invoice_url': 'Supplier invoice / official receipt',
+  'payment_receipt_url': 'Payment receipt',
+  'delivery_receipt_url': 'Delivery receipt',
+  'po_image_url': 'Purchase order',
+};
+
 /// "₱1,250.50".
 String peso(num v) {
   final fixed = v.toStringAsFixed(2);
```

**Modify:** `lib/requests/camera/request_camera_screen.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/requests/camera/request_camera_screen.dart b/lib/requests/camera/request_camera_screen.dart
index ffaf17e..03aae45 100644
--- a/lib/requests/camera/request_camera_screen.dart
+++ b/lib/requests/camera/request_camera_screen.dart
@@ -7,9 +7,12 @@ import '../../attendance/ui/attendance_copy.dart';
 import '../../ui/theme.dart';
 
 /// A photo of the item being requested: BACK camera, no overlay, no caption.
-/// Pops the raw capture's path (the repository files it), or nothing.
+/// Pops the raw capture's path (the repository files it), or nothing. Also a
+/// receipt photo (2A-3b), with its own [title].
 class RequestCameraScreen extends StatefulWidget {
-  const RequestCameraScreen({super.key});
+  const RequestCameraScreen({super.key, this.title = 'Photo of the item'});
+
+  final String title;
 
   @override
   State<RequestCameraScreen> createState() => _RequestCameraScreenState();
@@ -117,7 +120,7 @@ class _RequestCameraScreenState extends State<RequestCameraScreen> with WidgetsB
       appBar: AppBar(
         backgroundColor: WmColors.previewBackdrop,
         foregroundColor: Colors.white,
-        title: const Text('Photo of the item'),
+        title: Text(widget.title),
       ),
       body: Column(children: [
         Expanded(
```

**Modify:** `pubspec.yaml` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/pubspec.yaml b/pubspec.yaml
index 4616a1f..bd38d85 100644
--- a/pubspec.yaml
+++ b/pubspec.yaml
@@ -14,6 +14,9 @@ dependencies:
     sdk: flutter
   flutter_secure_storage: 11.2.0
   http: 1.6.0
+  # Receipt photos from the gallery (2A-3b, Q8). Pinned: its Android side
+  # needs the same Gradle plugin as camera_android_camerax, nothing newer.
+  image_picker: 1.2.1
   package_info_plus: 10.2.1
   path_provider: 2.1.6
   permission_handler: 12.0.1
```


---

### Task 5: My purchases and corrections

My purchases (Q12): what is still on the phone — Waiting to send, Needs attention with the reason in both languages, Fix and send again / Throw away (Q7, R25) — drafts being written, then the server's last 60 days of what this buyer bought or recorded, with Voided / Waiting for the owner / Needs office check / No receipt / Unplanned / Extra. One purchase in full, receipts included (R27). Correct my own recorded purchase (Q13, R22); Send to the owner when only the owner may; no void. The shell gets its final tabs: **Shopping list · My purchases · Profile** (Q2), with a red number for purchases that need attention.

**Files:**
- Create: `lib/purchasing/domain/correction.dart`, `lib/purchasing/mine/my_purchases_controller.dart`, `lib/purchasing/mine/my_purchases_screen.dart`, `lib/purchasing/mine/purchase_detail_screen.dart`, `lib/purchasing/mine/correct_screen.dart`
- Modify: `lib/purchasing/domain/pur_models.dart` (a line's `inInventory`, `minStock`), `lib/purchasing/ui/buyer_shell.dart` (whole file replaced: three tabs)
- Test: `test/purchasing/domain/correction_test.dart`, `test/purchasing/mine/my_purchases_test.dart`; modify `test/purchasing/ui/buyer_screens_test.dart`

**Interfaces:**
- Consumes: `PurchasingApi.myPurchases`, `drafts`, `returnToDrafts`, `discardRefused`, `deleteDraft`, `purchase`, `correct`, `sendToOwner`, `receipt`; `openRecord` (Task 4).
- Produces: `CorrectionDraft` (+ `.of(PurchaseDetail)`, `computedTotal`, `copyWith`), `enum CorrectionProblem`, `List<(CorrectionProblem, int?)> correctionProblems(PurchaseDetail, CorrectionDraft)`, `bool changed(...)`, `Map<String,dynamic> correctionBody(PurchaseDetail, CorrectionDraft)`.
- Produces: `MyPurchasesController({api})` with `refresh`, `edit(QueuedPurchase) → Future<PurchaseDraft?>`, `throwAway`, `deleteDraft`, `attention`; `MyPurchasesScreen({controller, onOpenDraft, onOpenPurchase})`; `purchaseFlags(MyPurchase)`; `PurchaseDetailScreen({purchaseId, services})`; `CorrectScreen({purchase, services})` (pops a snack-bar sentence); `correctionProblemCopy`.

- [ ] **Step 1: Write the failing tests** (*Tests* blocks).
- [ ] **Step 2: Run them; they fail to compile.**

Run: `flutter test test/purchasing/domain/correction_test.dart test/purchasing/mine`
Expected: compilation errors (`correction.dart` not found).

- [ ] **Step 3: Write the code** (*Code* blocks).
- [ ] **Step 4: Run the whole suite and the analyzer.**

Run: `flutter test` → **822 passed**. `flutter analyze` → `No issues found!`

- [ ] **Step 5: The user commits** (`2A-3b Task 5: my purchases and corrections`).

<!-- Tests -->

**Create:** `test/purchasing/domain/correction_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/domain/correction.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';

/// A recorded phone purchase: two lines, one fee split 30/10 by hand.
final stored = PurchaseDetail.fromJson(const {
  'id': 'pu1',
  'status': 'recorded',
  'source': 'workmate',
  'purchase_date': '2026-10-20',
  'date_time': '2026-10-20T09:30:00',
  'supplier': 'ZZ Hardware · Malolos',
  'supplier_id': 's1',
  'payment_method': 'Cash',
  'notes': 'Rush',
  'receipt_total': 440,
  'docs': {'supplier_invoice_url': 'https://x/a.jpg'},
  'lines': [
    {'line': 1, 'destination': 'project', 'folder_id': 'f1', 'folder_name': 'Barlin Residence', 'item_name': 'Cement', 'category': 'Materials',
      'quantity': 10, 'unit': 'bag', 'amount': 300, 'request_line_id': 'l1', 'in_inventory': false, 'min_stock': 0},
    {'line': 2, 'destination': 'warehouse', 'folder_id': null, 'folder_name': '', 'item_name': 'Wire', 'category': 'Materials',
      'quantity': 2, 'unit': 'roll', 'amount': 100, 'in_inventory': true, 'min_stock': 5},
  ],
  'charges': [
    {'kind': 'delivery_fee', 'amount': 40, 'shares': [{'line': 1, 'amount': 30}, {'line': 2, 'amount': 10}]},
  ],
});

void main() {
  test('starts from the purchase as stored', () {
    final c = CorrectionDraft.of(stored);
    expect(c.purchaseDate, '2026-10-20');
    expect(c.quantities, ['10', '2']);
    expect(c.amounts, ['300.00', '100.00']);
    expect(c.receiptTotal, '440.00');
    expect(c.computedTotal(stored), 440);
  });

  test('a reason is required, and something must change (Q13)', () {
    final c = CorrectionDraft.of(stored);
    expect(correctionProblems(stored, c).map((x) => x.$1), [CorrectionProblem.reasonRequired]);
    expect(correctionProblems(stored, c.copyWith(reason: 'x')).map((x) => x.$1), [CorrectionProblem.nothingChanged]);
    expect(correctionProblems(stored, c.copyWith(reason: 'Typo', purchaseDate: '2026-10-19')), isEmpty);
  });

  test('quantities, amounts and the total are checked; the stored fees count', () {
    final c = CorrectionDraft.of(stored).copyWith(reason: 'Price', amounts: ['320', '100']);
    expect(correctionProblems(stored, c), [(CorrectionProblem.totalMismatch, null)]);
    expect(correctionProblems(stored, c.copyWith(receiptTotal: '460')), isEmpty);
    expect(correctionProblems(stored, c.copyWith(quantities: ['0', '2'], receiptTotal: '460')), [(CorrectionProblem.badQuantity, 1)]);
  });

  test('the body keeps request links, reasons and the picked supplier by leaving them out (pur_inherit)', () {
    final b = correctionBody(stored, CorrectionDraft.of(stored).copyWith(quantities: ['12', '2'], reason: 'Count'));
    final lines = b['lines'] as List;
    expect((lines[0] as Map).containsKey('request_line_id'), isFalse);
    expect((lines[0] as Map).containsKey('portion_picks'), isFalse);
    expect(b.containsKey('supplier_id'), isFalse);
    expect((lines[0] as Map)['quantity'], 12);
    expect((lines[1] as Map)['folder_id'], isNull);
    expect((lines[1] as Map)['in_inventory'], isTrue, reason: 'stock settings stay as stored');
    expect((lines[1] as Map)['min_stock'], 5);
    expect(b['source'], 'workmate');
    expect(b['notes'], 'Rush');
    expect(b['payment_method'], 'Cash');
  });

  test('the time of day stays while the date is unchanged', () {
    expect(correctionBody(stored, CorrectionDraft.of(stored))['date_time'], '2026-10-20T09:30:00');
    expect(correctionBody(stored, CorrectionDraft.of(stored).copyWith(purchaseDate: '2026-10-19'))['date_time'], '2026-10-19');
  });

  test('a typed supplier drops the picked one', () {
    final b = correctionBody(stored, CorrectionDraft.of(stored).copyWith(supplier: 'Wilcon', supplierChanged: true));
    expect(b['supplier'], 'Wilcon');
    expect(b.containsKey('supplier_id'), isTrue);
    expect(b['supplier_id'], isNull);
  });

  test('fees keep their split while no amount changed; otherwise the server splits them again', () {
    final same = correctionBody(stored, CorrectionDraft.of(stored).copyWith(quantities: ['12', '2']));
    expect(((same['charges'] as List).single as Map)['shares'], [
      {'line': 1, 'amount': 30},
      {'line': 2, 'amount': 10},
    ]);
    final priced = correctionBody(stored, CorrectionDraft.of(stored).copyWith(amounts: ['320', '100']));
    expect(((priced['charges'] as List).single as Map).containsKey('shares'), isFalse);
  });

  test('new photos alone are a change', () {
    expect(changed(stored, CorrectionDraft.of(stored).copyWith(photos: {'payment_receipt_url': '/p.jpg'})), isTrue);
  });
}
```

**Create:** `test/purchasing/mine/my_purchases_test.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/purchasing/data/purchasing_api.dart';
import 'package:workmate/purchasing/domain/pur_failure.dart';
import 'package:workmate/purchasing/domain/pur_models.dart';
import 'package:workmate/purchasing/domain/purchase_draft.dart';
import 'package:workmate/purchasing/mine/my_purchases_controller.dart';
import 'package:workmate/purchasing/mine/my_purchases_screen.dart';
import 'package:workmate/purchasing/mine/purchase_detail_screen.dart';
import 'package:workmate/purchasing/purchasing_services.dart';
import 'package:workmate/ui/theme.dart';

import '../../attendance/fakes.dart' show useTallPhone;
import '../domain/correction_test.dart' show stored;
import '../purchasing_api_fake.dart';
import '../purchasing_fakes.dart';

Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: Scaffold(body: w));

PurchaseDraft draft(String id, {String supplier = 'ZZ Hardware', String total = '500'}) =>
    PurchaseDraft(id: id, createdAt: wednesday, purchaseDate: '2026-10-21', supplierName: supplier, receiptTotal: total);

void main() {
  late FakePurchasingApi api;
  late MyPurchasesController c;

  setUp(() {
    api = FakePurchasingApi();
    api.mine = MyPurchasesView(
      queued: [
        QueuedPurchase(draft: draft('q1'), state: QueuedState.waiting),
        QueuedPurchase(draft: draft('q2', supplier: 'Sari-sari'), state: QueuedState.needsAttention, failure: PurFailure.lineClosed),
      ],
      purchases: [
        MyPurchase.fromJson(const {'id': 'pu1', 'status': 'recorded', 'supplier': 'ZZ Hardware', 'receipt_total': 440, 'purchase_date': '2026-10-20',
          'projects': ['Barlin Residence'], 'pending_change': true, 'unit_check': true}),
        MyPurchase.fromJson(const {'id': 'pu2', 'status': 'void', 'supplier': 'Wilcon', 'receipt_total': 90, 'purchase_date': '2026-10-19',
          'projects': [], 'warehouse': true, 'no_receipt_reason': 'None given'}),
      ],
      fetchedAt: wednesday,
    );
    api.draftList = [draft('d1', supplier: '')];
    c = MyPurchasesController(api: api);
  });

  test('drafts, what waits on the phone, then the server\'s list; needing attention is counted', () async {
    await c.refresh();
    expect(c.drafts.single.id, 'd1');
    expect(c.view.queued.length, 2);
    expect(c.attention, 1);
  });

  test('a refused purchase goes back to editing, or is thrown away', () async {
    await c.refresh();
    final back = await c.edit(c.view.queued[1]);
    expect(back!.id, 'q2');
    await c.throwAway(c.view.queued[1]);
    expect(api.calls, containsAll(['returnToDrafts:q2', 'discardRefused:q2']));
  });

  testWidgets('the list: not sent yet (with why, in both languages), drafts, recorded with its status (Q7, Q12)', (tester) async {
    useTallPhone(tester);
    PurchaseDraft? opened;
    MyPurchase? shown;
    await c.refresh();
    await tester.pumpWidget(wrap(MyPurchasesScreen(controller: c, onOpenDraft: (d) => opened = d, onOpenPurchase: (p) => shown = p)));
    expect(find.text('Waiting to send'), findsOneWidget);
    expect(find.text('Hinihintay maipadala'), findsOneWidget);
    expect(find.text('Needs attention'), findsOneWidget);
    expect(find.text(purFailureCopy(PurFailure.lineClosed).english), findsOneWidget);
    expect(find.text(purFailureCopy(PurFailure.lineClosed).tagalog), findsOneWidget);
    await tester.tap(find.byKey(const Key('fix-q2')));
    await tester.pumpAndSettle();
    expect(opened!.id, 'q2');
    await tester.scrollUntilVisible(find.byKey(const Key('purchase-pu2')), 200);
    expect(find.text('Waiting for the owner'), findsOneWidget);
    expect(find.text('Needs office check'), findsOneWidget);
    expect(find.text('Voided'), findsOneWidget);
    expect(find.text('No receipt'), findsOneWidget);
    expect(find.textContaining('Warehouse'), findsOneWidget);
    await tester.tap(find.byKey(const Key('purchase-pu1')));
    expect(shown!.id, 'pu1');
  });

  group('one purchase', () {
    late PurchasingServices services;
    setUp(() {
      api.detail = stored;
      services = PurchasingServices(api: api, takePhoto: (_) async => 'shot.jpg', pickPhoto: (_) async => 'gallery.jpg');
    });

    Future<void> openDetail(WidgetTester tester) async {
      useTallPhone(tester);
      await tester.pumpWidget(MaterialApp(
        theme: workMateTheme(),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<bool>(builder: (_) => PurchaseDetailScreen(purchaseId: 'pu1', services: services))),
              child: const Text('open'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
    }

    Future<void> scrollTo(WidgetTester tester, Finder f) async {
      await tester.scrollUntilVisible(f, 200,
          scrollable: find.descendant(of: find.byKey(const Key('correct-form')), matching: find.byType(Scrollable)).first);
      await tester.ensureVisible(f);
      await tester.pumpAndSettle();
    }

    testWidgets('lines, fees, receipts; Correct for my recorded purchase; never a void (Q12, Q13)', (tester) async {
      await openDetail(tester);
      expect(find.text('Cement'), findsOneWidget);
      expect(find.text('Delivery fee'), findsOneWidget);
      expect(find.byKey(const Key('receipt-supplier_invoice_url')), findsOneWidget);
      expect(find.byKey(const Key('correct')), findsOneWidget);
      expect(find.textContaining('Void'), findsNothing);
      expect(find.text('A purchase is voided on Dacs Web only.'), findsOneWidget);
    });

    testWidgets('waiting for the owner: no second change from the phone', (tester) async {
      api.detail = PurchaseDetail.fromJson({
        ...{'id': 'pu1', 'status': 'recorded', 'lines': const [], 'charges': const []},
        'change_requests': const [{'kind': 'correct', 'status': 'pending', 'reason': 'Price'}],
      });
      await openDetail(tester);
      expect(find.byKey(const Key('waiting-owner')), findsOneWidget);
      expect(find.byKey(const Key('correct')), findsNothing);
    });

    testWidgets('a correction is saved with its reason and new photo (Q13)', (tester) async {
      await openDetail(tester);
      await tester.tap(find.byKey(const Key('correct')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('correct-qty-1')), '12');
      await scrollTo(tester, find.byKey(const Key('correct-camera-payment_receipt_url')));
      await tester.tap(find.byKey(const Key('correct-camera-payment_receipt_url')));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const Key('correct-reason')));
      await tester.enterText(find.byKey(const Key('correct-reason')), 'Counted again');
      await scrollTo(tester, find.byKey(const Key('correct-save')));
      await tester.tap(find.byKey(const Key('correct-save')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('correct:pu1:Counted again:payment_receipt_url'));
      expect(((api.bodies.single['lines'] as List).first as Map)['quantity'], 12);
      expect(find.text('Corrected. · Naitama na.'), findsOneWidget);
    });

    testWidgets('only the owner may: it is offered to the owner, the same change (Q13)', (tester) async {
      api.correctionOutcome = CorrectionOutcome.needsOwner;
      await openDetail(tester);
      await tester.tap(find.byKey(const Key('correct')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('correct-amount-1')), '320');
      await scrollTo(tester, find.byKey(const Key('correct-total')));
      await tester.enterText(find.byKey(const Key('correct-total')), '460');
      await scrollTo(tester, find.byKey(const Key('correct-reason')));
      await tester.enterText(find.byKey(const Key('correct-reason')), 'Price');
      await scrollTo(tester, find.byKey(const Key('correct-save')));
      await tester.tap(find.byKey(const Key('correct-save')));
      await tester.pumpAndSettle();
      expect(find.text('Send to the owner?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('send-owner')));
      await tester.pumpAndSettle();
      // Then the purchase is read again (now Waiting for the owner).
      expect(api.calls.where((x) => x.startsWith('owner:')), ['owner:pu1:Price']);
      expect(api.bodies.last, same(api.bodies.first));
      expect(find.text('Sent to the owner. · Naipadala sa may-ari.'), findsOneWidget);
    });

    testWidgets('no reason: the form says so and sends nothing', (tester) async {
      await openDetail(tester);
      await tester.tap(find.byKey(const Key('correct')));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const Key('correct-save')));
      await tester.tap(find.byKey(const Key('correct-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('cproblem-reasonRequired-0')), findsOneWidget);
      expect(api.calls.where((x) => x.startsWith('correct:')), isEmpty);
    });
  });
}
```

**Modify:** `test/purchasing/ui/buyer_screens_test.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/test/purchasing/ui/buyer_screens_test.dart b/test/purchasing/ui/buyer_screens_test.dart
index dcae821..f699b1a 100644
--- a/test/purchasing/ui/buyer_screens_test.dart
+++ b/test/purchasing/ui/buyer_screens_test.dart
@@ -44,8 +44,12 @@ void main() {
     )));
     await tester.pumpAndSettle();
     expect(find.text('Shopping list'), findsWidgets);
+    expect(find.text('My purchases'), findsOneWidget);
     expect(find.text('Profile'), findsOneWidget);
     expect(find.text('Time In'), findsNothing);
+    expect(find.text('Requests'), findsNothing);
+    expect(find.text('My Work'), findsNothing);
+    expect(find.byKey(const Key('record-unplanned')), findsOneWidget);
     await tester.tap(find.text('Profile'));
     await tester.pumpAndSettle();
     expect(find.text('Change password'), findsOneWidget);
```

<!-- Code -->

**Create:** `lib/purchasing/domain/correction.dart`

```dart
import '../../requests/domain/quantity.dart';
import 'pur_models.dart';
import 'purchase_draft.dart';

/// A buyer's correction of their own recorded purchase on the phone (Q13):
/// the date, the supplier, each line's quantity and amount, the receipt
/// total, and new receipt photos. Nothing else changes here — not the
/// project (that needs the owner), not the request links, never a void.
class CorrectionDraft {
  const CorrectionDraft({
    required this.purchaseDate,
    required this.supplier,
    required this.quantities,
    required this.amounts,
    required this.receiptTotal,
    this.supplierChanged = false,
    this.photos = const {},
    this.reason = '',
  });

  /// The purchase as stored, ready to edit.
  factory CorrectionDraft.of(PurchaseDetail p) => CorrectionDraft(
        purchaseDate: p.purchaseDate,
        supplier: p.supplier,
        quantities: [for (final l in p.lines) formatQuantity(l.quantity).replaceAll(',', '')],
        amounts: [for (final l in p.lines) l.amount.toStringAsFixed(2)],
        receiptTotal: p.receiptTotal.toStringAsFixed(2),
      );

  final String purchaseDate;
  final String supplier;

  /// The buyer typed a different supplier: the picked one from the list is dropped.
  final bool supplierChanged;

  /// One per stored line, in line order.
  final List<String> quantities;
  final List<String> amounts;
  final String receiptTotal;

  /// New receipt photos for empty slots only: slot → file on the phone.
  final Map<String, String> photos;
  final String reason;

  CorrectionDraft copyWith({
    String? purchaseDate,
    String? supplier,
    bool? supplierChanged,
    List<String>? quantities,
    List<String>? amounts,
    String? receiptTotal,
    Map<String, String>? photos,
    String? reason,
  }) =>
      CorrectionDraft(
        purchaseDate: purchaseDate ?? this.purchaseDate,
        supplier: supplier ?? this.supplier,
        supplierChanged: supplierChanged ?? this.supplierChanged,
        quantities: quantities ?? this.quantities,
        amounts: amounts ?? this.amounts,
        receiptTotal: receiptTotal ?? this.receiptTotal,
        photos: photos ?? this.photos,
        reason: reason ?? this.reason,
      );

  /// Lines + the stored fees − the stored discounts.
  double computedTotal(PurchaseDetail p) {
    final items = amounts.fold<double>(0, (a, s) => a + (parseMoney(s) ?? 0));
    final fees = p.charges.where((c) => c.kind == 'delivery_fee').fold<double>(0, (a, c) => a + c.amount);
    final discounts = p.charges.where((c) => c.kind == 'discount').fold<double>(0, (a, c) => a + c.amount);
    return round2(items + fees - discounts);
  }
}

enum CorrectionProblem { badDate, badQuantity, badAmount, badTotal, totalMismatch, reasonRequired, nothingChanged }

/// What the server would refuse, said first; with the line number when about one.
List<(CorrectionProblem, int?)> correctionProblems(PurchaseDetail p, CorrectionDraft c) {
  final out = <(CorrectionProblem, int?)>[];
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(c.purchaseDate)) out.add((CorrectionProblem.badDate, null));
  for (var i = 0; i < p.lines.length; i++) {
    if (parseQuantity(c.quantities[i]) == null) out.add((CorrectionProblem.badQuantity, i + 1));
    if (parseMoney(c.amounts[i]) == null) out.add((CorrectionProblem.badAmount, i + 1));
  }
  final total = parseMoney(c.receiptTotal);
  if (total == null) {
    out.add((CorrectionProblem.badTotal, null));
  } else if (round2(total) != c.computedTotal(p)) {
    out.add((CorrectionProblem.totalMismatch, null));
  }
  if (c.reason.trim().isEmpty) out.add((CorrectionProblem.reasonRequired, null));
  if (out.isEmpty && !changed(p, c)) out.add((CorrectionProblem.nothingChanged, null));
  return out;
}

/// Whether the correction changes anything at all.
bool changed(PurchaseDetail p, CorrectionDraft c) {
  if (c.purchaseDate != p.purchaseDate || c.supplierChanged || c.photos.isNotEmpty) return true;
  if (round2(parseMoney(c.receiptTotal) ?? -1) != round2(p.receiptTotal)) return true;
  for (var i = 0; i < p.lines.length; i++) {
    if (round3(parseQuantity(c.quantities[i]) ?? -1) != round3(p.lines[i].quantity)) return true;
    if (round2(parseMoney(c.amounts[i]) ?? -1) != round2(p.lines[i].amount)) return true;
  }
  return false;
}

/// The pur_correct body. Request links, reasons and the picked supplier are
/// left out on purpose: pur_inherit keeps them as stored. Fees keep their
/// split while no line amount changed; otherwise the server splits them by
/// the new amounts again (pur_prorate), which may differ from an adjusted one.
Map<String, dynamic> correctionBody(PurchaseDetail p, CorrectionDraft c) {
  final amountsChanged = [
    for (var i = 0; i < p.lines.length; i++) round2(parseMoney(c.amounts[i]) ?? 0) != round2(p.lines[i].amount),
  ].any((x) => x);
  return {
    'source': 'workmate',
    'purchase_date': c.purchaseDate,
    // The stored time of day stays while the date is unchanged (the web's rule).
    'date_time': p.dateTime.length >= 10 && p.dateTime.substring(0, 10) == c.purchaseDate ? p.dateTime : c.purchaseDate,
    'supplier': c.supplier.trim(),
    if (c.supplierChanged) 'supplier_id': null,
    'payment_method': p.paymentMethod,
    'notes': p.notes,
    'receipt_total': round2(parseMoney(c.receiptTotal) ?? 0),
    'docs': <String, dynamic>{},
    'lines': [
      for (var i = 0; i < p.lines.length; i++)
        {
          'destination': p.lines[i].destination,
          'folder_id': p.lines[i].folderId,
          'item_name': p.lines[i].itemName,
          'category': p.lines[i].category,
          'quantity': round3(parseQuantity(c.quantities[i]) ?? 0),
          'unit': p.lines[i].unit,
          'amount': round2(parseMoney(c.amounts[i]) ?? 0),
          'in_inventory': p.lines[i].inInventory,
          'min_stock': p.lines[i].minStock,
        },
    ],
    'charges': [
      for (final ch in p.charges)
        {
          'kind': ch.kind,
          'amount': round2(ch.amount),
          if (!amountsChanged && ch.shares.isNotEmpty)
            'shares': [for (final e in ch.shares.entries) {'line': e.key, 'amount': round2(e.value)}],
        },
    ],
  };
}
```

**Modify:** `lib/purchasing/domain/pur_models.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/domain/pur_models.dart b/lib/purchasing/domain/pur_models.dart
index f8d5e1e..c9e2db8 100644
--- a/lib/purchasing/domain/pur_models.dart
+++ b/lib/purchasing/domain/pur_models.dart
@@ -336,6 +336,8 @@ class PurchaseLine {
     this.unitCheck = 'none',
     this.unplannedReason = '',
     this.substitute = false,
+    this.inInventory = false,
+    this.minStock = 0,
   });
 
   factory PurchaseLine.fromJson(Map<String, dynamic> j) => PurchaseLine(
@@ -354,6 +356,8 @@ class PurchaseLine {
         unitCheck: _str(j['unit_check']).isEmpty ? 'none' : _str(j['unit_check']),
         unplannedReason: _str(j['unplanned_reason']),
         substitute: j['substitute'] == true,
+        inInventory: j['in_inventory'] == true,
+        minStock: _num(j['min_stock']),
       );
 
   final int line;
@@ -374,6 +378,10 @@ class PurchaseLine {
   final String unitCheck;
   final String unplannedReason;
   final bool substitute;
+
+  /// Kept as stored by a correction (stock is the office's, Stage 2B).
+  final bool inInventory;
+  final double minStock;
 }
 
 /// A change sent to the owner about a purchase.
```

**Create:** `lib/purchasing/mine/correct_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/domain/work_date.dart';
import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/purchasing_api.dart';
import '../domain/correction.dart';
import '../domain/pur_failure.dart';
import '../domain/pur_models.dart';
import '../purchasing_services.dart';
import '../ui/purchasing_copy.dart';

Bilingual correctionProblemCopy(CorrectionProblem k) => switch (k) {
      CorrectionProblem.badDate => const Bilingual('Pick the date you bought it.', 'Piliin ang petsa ng pagbili.'),
      CorrectionProblem.badQuantity => const Bilingual('Enter a quantity above 0.', 'Ilagay ang dami na higit sa 0.'),
      CorrectionProblem.badAmount => const Bilingual('Enter the amount paid.', 'Ilagay ang halagang ibinayad.'),
      CorrectionProblem.badTotal => const Bilingual('Enter the total printed on the receipt.', 'Ilagay ang total na nakasulat sa resibo.'),
      CorrectionProblem.totalMismatch => const Bilingual('Items + fees − discounts do not match the receipt total.',
          'Hindi tugma ang items + bayad − diskwento sa total ng resibo.'),
      CorrectionProblem.reasonRequired => const Bilingual('Say why you are changing it.', 'Sabihin kung bakit mo ito binabago.'),
      CorrectionProblem.nothingChanged => const Bilingual('Nothing was changed.', 'Walang binago.'),
    };

/// Correct my own recorded purchase (Q13): date, supplier, quantities,
/// amounts, the receipt total and new receipt photos. Online only. When
/// only the owner may make the change (a completed project), it is offered
/// to the owner instead. Pops a sentence for the snack bar, or nothing.
class CorrectScreen extends StatefulWidget {
  const CorrectScreen({super.key, required this.purchase, required this.services});
  final PurchaseDetail purchase;
  final PurchasingServices services;

  @override
  State<CorrectScreen> createState() => _CorrectScreenState();
}

class _CorrectScreenState extends State<CorrectScreen> {
  late CorrectionDraft _c = CorrectionDraft.of(widget.purchase);
  late final String _opCorrect = widget.services.api.newLineKey();
  late final String _opOwner = widget.services.api.newLineKey();
  bool _tried = false;
  bool _busy = false;
  Bilingual? _notice;

  PurchaseDetail get _p => widget.purchase;
  PurchasingApi get _api => widget.services.api;

  void _set(CorrectionDraft c) => setState(() => _c = c);

  Future<void> _photo(String slot, PickReceipt pick) async {
    final path = await pick(context);
    if (path == null) return;
    final kept = await _api.keepPhoto('correction-${_p.id}', path);
    _set(_c.copyWith(photos: {..._c.photos, slot: kept}));
  }

  Future<void> _save() async {
    setState(() => _tried = true);
    if (correctionProblems(_p, _c).isNotEmpty) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      final r = await _api.correct(_p, correctionBody(_p, _c), _c.reason.trim(), opId: _opCorrect, newPhotos: _c.photos);
      if (!mounted) return;
      if (r.outcome == CorrectionOutcome.saved) {
        Navigator.of(context).pop('Corrected. · Naitama na.');
        return;
      }
      final send = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Send to the owner?'),
          content: Text('${purFailureCopy(PurFailure.completedProject).english}\n\nThe owner sees exactly this change and approves or rejects it.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            TextButton(key: const Key('send-owner'), onPressed: () => Navigator.of(context).pop(true), child: const Text('Send to the owner')),
          ],
        ),
      );
      if (send != true || !mounted) return;
      await _api.sendToOwner(_p, r.body, _c.reason.trim(), opId: _opOwner);
      if (mounted) Navigator.of(context).pop('Sent to the owner. · Naipadala sa may-ari.');
    } catch (e) {
      if (mounted) setState(() => _notice = purFailureCopy(PurFailure.of(e)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final problems = _tried ? correctionProblems(_p, _c) : const <(CorrectionProblem, int?)>[];
    Widget problem((CorrectionProblem, int?) x) {
      final b = correctionProblemCopy(x.$1);
      return Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Text(key: Key('cproblem-${x.$1.name}-${x.$2 ?? 0}'), '${b.english}\n${b.tagalog}', style: const TextStyle(color: WmColors.danger)),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const BilingualText(Bilingual('Correct purchase', 'Itama ang purchase'), style: TextStyle(fontWeight: FontWeight.w800))),
      body: SafeArea(
        child: ListView(key: const Key('correct-form'), padding: const EdgeInsets.all(16), children: [
          if (_notice != null) ...[FailureNotice(english: _notice!.english, tagalog: _notice!.tagalog), const SizedBox(height: 10)],
          InkWell(
            key: const Key('correct-date'),
            onTap: () async {
              final today = manilaDate(DateTime.now());
              final picked = await showDatePicker(
                context: context,
                initialDate: DateTime.tryParse(_c.purchaseDate) ?? today,
                firstDate: today.subtract(const Duration(days: 366)),
                lastDate: today,
              );
              if (picked != null) _set(_c.copyWith(purchaseDate: isoDate(picked)));
            },
            child: InputDecorator(decoration: const InputDecoration(labelText: 'Date bought'), child: Text(_c.purchaseDate)),
          ),
          const SizedBox(height: 10),
          TextFormField(
            key: const Key('correct-supplier'),
            initialValue: _c.supplier,
            decoration: const InputDecoration(labelText: 'Supplier'),
            onChanged: (v) => _set(_c.copyWith(supplier: v, supplierChanged: v.trim() != _p.supplier.trim())),
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < _p.lines.length; i++) ...[
            Text('${_p.lines[i].itemName} · ${_p.lines[i].destination == 'warehouse' ? 'Warehouse' : _p.lines[i].folderName}',
                style: const TextStyle(fontWeight: FontWeight.w700)),
            Row(children: [
              Expanded(
                child: TextFormField(
                  key: Key('correct-qty-${i + 1}'),
                  initialValue: _c.quantities[i],
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: 'Quantity', suffixText: _p.lines[i].unit),
                  onChanged: (v) => _set(_c.copyWith(quantities: [..._c.quantities]..[i] = v)),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextFormField(
                  key: Key('correct-amount-${i + 1}'),
                  initialValue: _c.amounts[i],
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Amount', prefixText: '₱ '),
                  onChanged: (v) => _set(_c.copyWith(amounts: [..._c.amounts]..[i] = v)),
                ),
              ),
            ]),
            for (final x in problems.where((x) => x.$2 == i + 1)) problem(x),
            const SizedBox(height: 10),
          ],
          if (_p.charges.isNotEmpty)
            const Text('Fees and discounts stay as recorded. If an amount changes, they are split again by amount.',
                style: TextStyle(fontSize: 12.5, color: WmColors.textMuted)),
          const SizedBox(height: 10),
          const Text('Add receipt photos', style: TextStyle(fontWeight: FontWeight.w800)),
          for (final slot in receiptSlots.where((s) => !_p.docs.containsKey(s)))
            Row(children: [
              Expanded(child: Text(receiptSlotLabels[slot]!)),
              if (_c.photos.containsKey(slot))
                const Icon(Icons.check_circle, color: WmColors.green)
              else ...[
                IconButton(key: Key('correct-camera-$slot'), onPressed: () => _photo(slot, widget.services.takePhoto), icon: const Icon(Icons.photo_camera_outlined)),
                IconButton(key: Key('correct-gallery-$slot'), onPressed: () => _photo(slot, widget.services.pickPhoto), icon: const Icon(Icons.photo_library_outlined)),
              ],
            ]),
          const SizedBox(height: 10),
          TextFormField(
            key: const Key('correct-total'),
            initialValue: _c.receiptTotal,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Total on the receipt', prefixText: '₱ '),
            onChanged: (v) => _set(_c.copyWith(receiptTotal: v)),
          ),
          Text('Items + fees − discounts: ${peso(_c.computedTotal(_p))}', style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          TextFormField(
            key: const Key('correct-reason'),
            initialValue: _c.reason,
            decoration: const InputDecoration(labelText: 'Why the change? (kept in the history)'),
            onChanged: (v) => _set(_c.copyWith(reason: v)),
          ),
          for (final x in problems.where((x) => x.$2 == null)) problem(x),
          const SizedBox(height: 18),
          bilingualButton(const Bilingual('Save correction', 'I-save ang pagtatama'), _busy ? null : _save, filled: true, key: const Key('correct-save')),
        ]),
      ),
    );
  }
}
```

**Create:** `lib/purchasing/mine/my_purchases_controller.dart`

```dart
import 'package:flutter/foundation.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../data/purchasing_api.dart';
import '../domain/pur_failure.dart';
import '../domain/purchase_draft.dart';

/// My purchases (Q12): drafts still being written, purchases waiting on the
/// phone or needing attention (Q7), then what the server has — the last 60
/// days of what this buyer bought or recorded.
class MyPurchasesController extends ChangeNotifier {
  MyPurchasesController({required this.api});

  final PurchasingApi api;

  MyPurchasesView view = const MyPurchasesView();
  List<PurchaseDraft> drafts = const [];
  bool loading = false;
  Bilingual? notice;

  /// Needs attention: shown as a number on the tab.
  int get attention => view.queued.where((q) => q.state == QueuedState.needsAttention).length;

  Future<void> refresh() async {
    loading = true;
    notifyListeners();
    try {
      drafts = await api.drafts();
      view = await api.myPurchases();
    } catch (e) {
      notice = purFailureCopy(PurFailure.of(e));
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// A refused purchase back to editing; null when it could not be.
  Future<PurchaseDraft?> edit(QueuedPurchase q) async {
    if (!await api.returnToDrafts(q.draft.id)) return null;
    await refresh();
    return q.draft;
  }

  Future<void> throwAway(QueuedPurchase q) async {
    await api.discardRefused(q.draft.id);
    await refresh();
  }

  Future<void> deleteDraft(PurchaseDraft d) async {
    await api.deleteDraft(d);
    await refresh();
  }

  void dismissNotice() {
    notice = null;
    notifyListeners();
  }
}
```

**Create:** `lib/purchasing/mine/my_purchases_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../attendance/ui/formats.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../data/purchasing_api.dart';
import '../domain/pur_failure.dart';
import '../domain/pur_models.dart';
import '../domain/purchase_draft.dart';
import '../ui/purchasing_copy.dart';
import 'my_purchases_controller.dart';

/// The status words a buyer sees on a purchase (Q12).
List<(String, Color, Color)> purchaseFlags(MyPurchase p) => [
      if (p.voided) ('Voided', WmColors.textSecondary, WmColors.inert) else ('Recorded', WmColors.green, WmColors.greenTint),
      if (p.pendingChange) ('Waiting for the owner', WmColors.brownDeep, WmColors.brownTint),
      if (p.unitCheck) ('Needs office check', WmColors.brownDeep, WmColors.brownTint),
      if (p.noReceiptReason.isNotEmpty) ('No receipt', WmColors.danger, WmColors.dangerTint),
      if (p.unplanned) ('Unplanned', WmColors.textSecondary, WmColors.inert),
      if (p.extra) ('Extra', WmColors.textSecondary, WmColors.inert),
    ];

class MyPurchasesScreen extends StatelessWidget {
  const MyPurchasesScreen({super.key, required this.controller, required this.onOpenDraft, required this.onOpenPurchase});

  final MyPurchasesController controller;

  /// Continue a draft (or a refused purchase sent back to editing).
  final void Function(PurchaseDraft draft) onOpenDraft;
  final void Function(MyPurchase purchase) onOpenPurchase;

  Future<void> _fix(QueuedPurchase q) async {
    final d = await controller.edit(q);
    if (d != null) onOpenDraft(d);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final c = controller;
          final v = c.view;
          return RefreshIndicator(
            onRefresh: c.refresh,
            child: ListView(padding: const EdgeInsets.all(16), children: [
              const Text('My purchases', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
              const Text('Mga binili ko · last 60 days', style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
              if (c.notice != null) ...[
                const SizedBox(height: 10),
                FailureNotice(english: c.notice!.english, tagalog: c.notice!.tagalog, actions: [noticeAction('Dismiss · Isara', c.dismissNotice)]),
              ],
              if (v.fromCache) ...[
                const SizedBox(height: 10),
                Text(
                  key: const Key('mine-saved-copy'),
                  'Saved copy from ${v.fetchedAt == null ? 'earlier' : '${shortDate(v.fetchedAt!)} ${clockTime(v.fetchedAt!)}'}.',
                  style: const TextStyle(color: WmColors.brownDeep, fontWeight: FontWeight.w600),
                ),
              ],
              if (v.queued.isNotEmpty) ...[
                const SizedBox(height: 16),
                const BilingualText(Bilingual('Not sent yet', 'Hindi pa naipapadala'), style: monoLabel),
                for (final q in v.queued) _QueuedCard(q: q, onFix: () => _fix(q), onThrowAway: () => c.throwAway(q)),
              ],
              if (c.drafts.isNotEmpty) ...[
                const SizedBox(height: 16),
                const BilingualText(Bilingual('Drafts', 'Mga draft'), style: monoLabel),
                for (final d in c.drafts)
                  Card(
                    key: Key('draft-${d.id}'),
                    color: Colors.white,
                    child: ListTile(
                      title: Text(d.supplierName.isEmpty ? 'Purchase on ${d.purchaseDate}' : d.supplierName),
                      subtitle: Text('${d.lines.length} item${d.lines.length == 1 ? '' : 's'} · not sent'),
                      onTap: () => onOpenDraft(d),
                      trailing: IconButton(key: Key('delete-draft-${d.id}'), icon: const Icon(Icons.delete_outline), onPressed: () => c.deleteDraft(d)),
                    ),
                  ),
              ],
              const SizedBox(height: 16),
              const BilingualText(Bilingual('Recorded', 'Naitala na'), style: monoLabel),
              if (!c.loading && v.purchases.isEmpty)
                const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Text('No purchases in the last 60 days.')),
              for (final p in v.purchases)
                Card(
                  key: Key('purchase-${p.id}'),
                  color: Colors.white,
                  child: InkWell(
                    onTap: () => onOpenPurchase(p),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(p.supplier.isEmpty ? 'No supplier' : p.supplier, style: const TextStyle(fontWeight: FontWeight.w800))),
                          Text(peso(p.receiptTotal), style: const TextStyle(fontWeight: FontWeight.w800)),
                        ]),
                        Text('${p.purchaseDate} · ${[...p.projects, if (p.warehouse) 'Warehouse'].join(', ')}',
                            style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
                        const SizedBox(height: 6),
                        Wrap(spacing: 6, runSpacing: 6, children: [for (final f in purchaseFlags(p)) _Flag(f)]),
                      ]),
                    ),
                  ),
                ),
              const SizedBox(height: 80),
            ]),
          );
        },
      );
}

class _Flag extends StatelessWidget {
  const _Flag(this.flag);
  final (String, Color, Color) flag;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(color: flag.$3, borderRadius: BorderRadius.circular(20)),
        child: Text(flag.$1, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: flag.$2)),
      );
}

class _QueuedCard extends StatelessWidget {
  const _QueuedCard({required this.q, required this.onFix, required this.onThrowAway});
  final QueuedPurchase q;
  final VoidCallback onFix;
  final VoidCallback onThrowAway;

  @override
  Widget build(BuildContext context) {
    final d = q.draft;
    final attention = q.state == QueuedState.needsAttention;
    final why = attention ? purFailureCopy(q.failure ?? PurFailure.unexpected) : null;
    return Card(
      key: Key('queued-${d.id}'),
      color: attention ? WmColors.dangerTint : Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(d.supplierName.isEmpty ? 'Purchase on ${d.purchaseDate}' : d.supplierName, style: const TextStyle(fontWeight: FontWeight.w800))),
            Text(peso(parseMoney(d.receiptTotal) ?? 0), style: const TextStyle(fontWeight: FontWeight.w800)),
          ]),
          BilingualText(attention ? attentionLabel : waitingLabel,
              style: TextStyle(fontWeight: FontWeight.w700, color: attention ? WmColors.danger : WmColors.brownDeep)),
          if (why != null) ...[
            const SizedBox(height: 6),
            Text(why.english, style: const TextStyle(color: WmColors.danger, fontWeight: FontWeight.w600)),
            Text(why.tagalog, style: const TextStyle(color: WmColors.danger, fontSize: 12.5)),
            Wrap(children: [
              TextButton(key: Key('fix-${d.id}'), onPressed: onFix, child: const Text('Fix and send again')),
              TextButton(key: Key('throw-${d.id}'), onPressed: onThrowAway, child: const Text('Throw away')),
            ]),
          ],
        ]),
      ),
    );
  }
}
```

**Create:** `lib/purchasing/mine/purchase_detail_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../attendance/ui/attendance_copy.dart' show Bilingual;
import '../../requests/domain/quantity.dart';
import '../../ui/failure_notice.dart';
import '../../ui/theme.dart';
import '../domain/pur_failure.dart';
import '../domain/pur_models.dart';
import '../purchasing_services.dart';
import '../ui/purchasing_copy.dart';
import 'correct_screen.dart';

/// One purchase in full (Q12): lines, fees, receipts and where it stands.
/// The buyer may correct their own recorded purchase here (Q13); voiding
/// stays on Dacs Web.
class PurchaseDetailScreen extends StatefulWidget {
  const PurchaseDetailScreen({super.key, required this.purchaseId, required this.services});
  final String purchaseId;
  final PurchasingServices services;

  @override
  State<PurchaseDetailScreen> createState() => _PurchaseDetailScreenState();
}

class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
  PurchaseDetail? _p;
  Bilingual? _error;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final p = await widget.services.api.purchase(widget.purchaseId);
      if (mounted) setState(() => _p = p);
    } catch (e) {
      if (mounted) setState(() => _error = purFailureCopy(PurFailure.of(e)));
    }
  }

  Future<void> _correct(PurchaseDetail p) async {
    final done = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => CorrectScreen(purchase: p, services: widget.services)),
    );
    if (done == null || !mounted) return;
    _changed = true;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Purchase')),
        body: SafeArea(
          child: _error != null && p == null
              ? Padding(
                  padding: const EdgeInsets.all(16),
                  child: FailureNotice(english: _error!.english, tagalog: _error!.tagalog, actions: [noticeAction('Try again · Subukan ulit', _load)]),
                )
              : p == null
                  ? const Center(child: CircularProgressIndicator())
                  : _body(p),
        ),
      ),
    );
  }

  Widget _body(PurchaseDetail p) {
    final canCorrect = p.recorded && !p.waitingForOwner && p.replacedBy == null;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Row(children: [
        Expanded(child: Text(p.supplier.isEmpty ? 'No supplier' : p.supplier, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20))),
        Text(peso(p.receiptTotal), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
      ]),
      Text('${p.purchaseDate} · bought by ${p.boughtByName}${p.paymentMethod.isEmpty ? '' : ' · ${p.paymentMethod}'}',
          style: const TextStyle(color: WmColors.textMuted)),
      const SizedBox(height: 8),
      Wrap(spacing: 6, runSpacing: 6, children: [
        if (!p.recorded) const Chip(label: Text('Voided')),
        if (p.waitingForOwner) const Chip(key: Key('waiting-owner'), label: Text('Waiting for the owner')),
        if (p.needsOfficeCheck) const Chip(label: Text('Needs office check')),
        if (p.noReceiptReason.isNotEmpty) Chip(label: Text('No receipt: ${p.noReceiptReason}')),
      ]),
      const SizedBox(height: 14),
      for (final l in p.lines)
        Card(
          color: Colors.white,
          child: ListTile(
            title: Text(l.itemName, style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text([
              qtyUnit(l.quantity, l.unit),
              l.destination == 'warehouse' ? 'Warehouse' : l.folderName,
              if (l.unitCheck == 'pending') 'counts after the office check',
              if (l.unplannedReason.isNotEmpty) 'no request: ${l.unplannedReason}',
              if (l.extra > 0) 'extra ${formatQuantity(l.extra)}',
            ].join(' · ')),
            trailing: Text(peso(l.amount)),
          ),
        ),
      for (final c in p.charges)
        ListTile(
          dense: true,
          title: Text(c.kind == 'delivery_fee' ? 'Delivery fee' : 'Discount'),
          trailing: Text('${c.kind == 'discount' ? '−' : ''}${peso(c.amount)}'),
        ),
      const SizedBox(height: 12),
      const Text('Receipt photos', style: TextStyle(fontWeight: FontWeight.w800)),
      const SizedBox(height: 6),
      if (p.docs.isEmpty) Text(p.noReceiptReason.isEmpty ? 'None' : 'No receipt: ${p.noReceiptReason}'),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final e in p.docs.entries) _Receipt(key: Key('receipt-${e.key}'), url: e.value, services: widget.services),
      ]),
      for (final r in p.changeRequests)
        Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Text('Change sent to the owner (${r.status}): ${r.reason}${r.decisionNote.isEmpty ? '' : ' — ${r.decisionNote}'}',
              style: const TextStyle(color: WmColors.textSecondary)),
        ),
      const SizedBox(height: 20),
      if (canCorrect) bilingualButton(const Bilingual('Correct this purchase', 'Itama ang purchase'), () => _correct(p), key: const Key('correct')),
      const SizedBox(height: 8),
      const Text('A purchase is voided on Dacs Web only.', style: TextStyle(fontSize: 12.5, color: WmColors.textMeta)),
    ]);
  }
}

class _Receipt extends StatelessWidget {
  const _Receipt({super.key, required this.url, required this.services});
  final String url;
  final PurchasingServices services;

  @override
  Widget build(BuildContext context) => FutureBuilder(
        future: services.api.receipt(url),
        builder: (context, snap) {
          final bytes = snap.data;
          return ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: SizedBox(
              width: 96,
              height: 96,
              child: bytes == null
                  ? const ColoredBox(color: WmColors.inert, child: Icon(Icons.receipt_long))
                  : GestureDetector(
                      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                        builder: (_) => Scaffold(
                          backgroundColor: WmColors.viewerBackdrop,
                          appBar: AppBar(backgroundColor: WmColors.viewerBackdrop, foregroundColor: Colors.white),
                          body: InteractiveViewer(child: Center(child: Image.memory(bytes))),
                        ),
                      )),
                      child: Image.memory(bytes, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.receipt_long)),
                    ),
            ),
          );
        },
      );
}
```

**Modify:** `lib/purchasing/ui/buyer_shell.dart` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/lib/purchasing/ui/buyer_shell.dart b/lib/purchasing/ui/buyer_shell.dart
index b69a0e8..8596ad3 100644
--- a/lib/purchasing/ui/buyer_shell.dart
+++ b/lib/purchasing/ui/buyer_shell.dart
@@ -3,13 +3,17 @@ import 'package:flutter/material.dart';
 import '../../auth/worker_profile.dart';
 import '../../profile/account_services.dart';
 import '../../profile/profile_screen.dart';
+import '../domain/pur_models.dart';
 import '../domain/purchase_draft.dart';
 import '../list/shopping_controller.dart';
 import '../list/shopping_list_screen.dart';
+import '../mine/my_purchases_controller.dart';
+import '../mine/my_purchases_screen.dart';
+import '../mine/purchase_detail_screen.dart';
 import '../purchasing_services.dart';
 import '../record/record_screen.dart';
 
-enum _Tab { shopping, profile }
+enum _Tab { shopping, mine, profile }
 
 /// The signed-in app for a buyer (Q2): Shopping list · My purchases ·
 /// Profile. No Time In, no worker Requests, no My Work.
@@ -38,8 +42,9 @@ class BuyerShell extends StatefulWidget {
 class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
   _Tab _tab = _Tab.shopping;
   ShoppingController? _shopping;
+  MyPurchasesController? _mine;
 
-  List<_Tab> get _tabs => [if (widget.purchasing != null) _Tab.shopping, _Tab.profile];
+  List<_Tab> get _tabs => [if (widget.purchasing != null) ...[_Tab.shopping, _Tab.mine], _Tab.profile];
 
   @override
   void initState() {
@@ -47,7 +52,8 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     final p = widget.purchasing;
     if (p != null) {
       _shopping = ShoppingController(api: p.api)..refresh();
-      p.changed?.addListener(_onSettled);
+      _mine = MyPurchasesController(api: p.api)..refresh();
+      p.changed?.addListener(_refresh);
     } else {
       _tab = _Tab.profile;
     }
@@ -56,22 +62,28 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
 
   @override
   void dispose() {
-    widget.purchasing?.changed?.removeListener(_onSettled);
+    widget.purchasing?.changed?.removeListener(_refresh);
     WidgetsBinding.instance.removeObserver(this);
     _shopping?.dispose();
+    _mine?.dispose();
     super.dispose();
   }
 
-  void _onSettled() => _shopping?.refresh();
+  /// A purchase was recorded in the background, or the app came back.
+  void _refresh() {
+    _shopping?.refresh();
+    _mine?.refresh();
+  }
 
   @override
   void didChangeAppLifecycleState(AppLifecycleState state) {
-    if (state == AppLifecycleState.resumed) _shopping?.refresh();
+    if (state == AppLifecycleState.resumed) _refresh();
   }
 
   void _select(_Tab t) {
     setState(() => _tab = t);
     if (t == _Tab.shopping) _shopping?.refresh();
+    if (t == _Tab.mine) _mine?.refresh();
   }
 
   /// Record purchase (Q7): picked lines, a saved draft, or blank (unplanned).
@@ -80,7 +92,7 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     if (p == null) return;
     final queued = await openRecord(context, p, lines: lines, draft: draft);
     if (!mounted) return;
-    _shopping?.refresh();
+    _refresh();
     if (queued) {
       ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
         key: Key('queued-snack'),
@@ -89,6 +101,13 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     }
   }
 
+  Future<void> _open(MyPurchase purchase) async {
+    final p = widget.purchasing;
+    if (p == null) return;
+    await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => PurchaseDetailScreen(purchaseId: purchase.id, services: p)));
+    if (mounted) _refresh();
+  }
+
   @override
   Widget build(BuildContext context) {
     final profile =
@@ -97,6 +116,7 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     if (tabs.length < 2) return Scaffold(body: SafeArea(child: profile));
     final body = switch (_tab) {
       _Tab.shopping => ShoppingListScreen(controller: _shopping!, onRecord: (lines) => _record(lines: lines)),
+      _Tab.mine => MyPurchasesScreen(controller: _mine!, onOpenDraft: (d) => _record(draft: d), onOpenPurchase: _open),
       _Tab.profile => profile,
     };
     return Scaffold(
@@ -116,6 +136,7 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
           for (final t in tabs)
             switch (t) {
               _Tab.shopping => const NavigationDestination(icon: Icon(Icons.shopping_cart_outlined), label: 'Shopping list'),
+              _Tab.mine => NavigationDestination(icon: _MineIcon(controller: _mine!), label: 'My purchases'),
               _Tab.profile => const NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
             },
         ],
@@ -123,3 +144,23 @@ class _BuyerShellState extends State<BuyerShell> with WidgetsBindingObserver {
     );
   }
 }
+
+/// My purchases, with a red number for purchases that need attention (Q7).
+class _MineIcon extends StatelessWidget {
+  const _MineIcon({required this.controller});
+  final MyPurchasesController controller;
+
+  @override
+  Widget build(BuildContext context) => ListenableBuilder(
+        listenable: controller,
+        builder: (context, _) {
+          final n = controller.attention;
+          return Badge(
+            key: const Key('mine-badge'),
+            isLabelVisible: n > 0,
+            label: Text('$n'),
+            child: const Icon(Icons.receipt_long_outlined),
+          );
+        },
+      );
+}
```


---

### Task 6: Version, build, pilot and publish

**Files:**
- Modify: `pubspec.yaml` (`version: 0.7.0+1007`)

<!-- Code -->

**Modify:** `pubspec.yaml` — apply with `git apply --ignore-whitespace`

```diff
diff --git a/pubspec.yaml b/pubspec.yaml
index bd38d85..8a23e28 100644
--- a/pubspec.yaml
+++ b/pubspec.yaml
@@ -1,7 +1,7 @@
 name: workmate
 description: "A new Flutter project."
 publish_to: 'none'
-version: 0.6.0+1006
+version: 0.7.0+1007
 
 environment:
   sdk: ^3.10.8
```


- [x] **Step 1: Version.** Apply the diff above. `flutter test` → 822 passed; `flutter analyze` → no issues.
- [x] **Step 2: Release build** (PowerShell, in the WorkMate repo):

```powershell
$env:JAVA_HOME="$HOME\.jdks\jbr-21.0.11"; flutter build apk --release
```

Expected: `build\app\outputs\flutter-apk\app-release.apk`, **under 50 MB** (0.6.0 was about 37 MB; image_picker adds little). Never `--split-per-abi`. (A debug build of this plan's code was built on 21 Oct: the image_picker Android side compiles with the app's Gradle plugin 8.11.1, so the camera-only fallback the roadmap allowed is not needed.) Copy the APK to `Documents\WorkMate releases\dacs-workmate-0.7.0-1007.apk`.

- [x] **Step 3: Install on the test phone only** (`adb install -r`; adb at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`). Do **not** publish yet.

- [x] **Step 4: Set up the pilot (owner, Dacs Web).**
  - Project **`ZZ 2a3b pilot`** with one billing period and *Allow requests* on; an Additional Works job **`ZZ 2a3b job`**.
  - Supplier **`ZZ Pilot Hardware`**.
  - **staff@**'s Buyer switch **ON** (the test buyer). Prices are the Buyer staff exception (CLAUDE.md).
  - On the test phone as **W-0007**, request for `ZZ 2a3b pilot`: `ZZ pilot cement` 5 bag, `ZZ pilot wire` 2 roll, `ZZ pilot screws` 10 pc.

- [x] **Step 5: Pilot checks (test phone, staff@ unless stated).** Record each result in *Execution notes*.

| # | Check | Expect |
|---|---|---|
| B1 | staff@ signs in | Lands on **Shopping list**. No Terms screen (Q23). Tabs: Shopping list · My purchases · Profile only (Q2) |
| B2 | Log out; **W-0007** signs in | The worker app as in 0.6.0 (Home, Time In, Requests, My Work); no buying tab. Log out; staff@ back in |
| B3 | Shopping list | The three ZZ lines under **Unassigned**, This week; Needed · Bought · Still to buy in both languages; no ₱ anywhere (Q4) |
| B4 | **I'll buy this** on the cement, 2 of 5 | Mine: 2 bag; Unassigned: 3 bag (split, Q5). Dacs Web Requests shows staff@ on 2 |
| B5 | **Release** the 2 | Back to Unassigned 5. Claim all 5 again |
| B6 | **Mark arranged** on the cement | "Arranged" on the phone and in Dacs Web (Q6, R18: no note) |
| B7 | Airplane mode ON. Pick the cement → Record purchase: supplier ZZ Pilot Hardware, 5 bag, ₱1,250, receipt photo (camera), total 1250 → Send | "Saved. It is sent when there is signal." My purchases: **Waiting to send** (Q7) |
| B8 | Airplane mode OFF; wait or pull to refresh | Recorded **once**. Dacs Web Purchases: Source **Phone**, the receipt opens; Project Control shows ₱1,250 on ZZ 2a3b pilot; the cement's Still to buy is 0 |
| B9 | Record purchase (button), no request: `ZZ pilot gloves` 1 pair ₱80, **Warehouse**, reason "spare", photo from the **gallery**, total 80 | Recorded; Dacs Web shows Unplanned, warehouse (Q8, Q11) |
| B10 | Claim the wire; record it **2 roll** for ZZ 2a3b pilot + `ZZ pilot tape` 1 pc ₱20 for **ZZ 2a3b job**, delivery fee ₱50 **adjusted** 40/10, total = items + 50 | Recorded; Project Control shows the fee shares on each project as entered (Q9). The job had no billing period: the server made one (0101) |
| B11 | Claim the screws; record **1 box**, unit note "1 box = 10 pc" | Recorded; Dacs Web: **unit check pending**, Notes "Line 1 (different unit): 1 box = 10 pc" (Q10, R19) |
| B12 | Record a substitute: rename an item, **Substitute** + reason | Office check pending on the web; the reason shows (Q10) |
| B13 | Record **12** of something with 10 still to buy | Asks for the extra's reason and location; recorded with the extra (Q11) |
| B14 | **No receipt**: record with No receipt + "sari-sari store" | Dacs Web shows "No receipt: sari-sari store" (Q8) |
| B15 | Airplane ON: record a purchase for a line; on the web (owner) cancel that request line; airplane OFF | **Needs attention** with "That request was cancelled…" in both languages; **Fix and send again** opens it; Throw away removes it (Q7, R25) |
| B16 | My purchases → open B8's purchase → **Correct**: amount ₱1,200, total 1200, reason "price" | "Corrected." The web history shows *Corrected* (Q13) |
| B17 | Owner marks ZZ 2a3b pilot **completed**; correct B9's purchase | "Send to the owner?" → sent; the purchase shows **Waiting for the owner**; Owner approvals shows it; no second Correct (Q13, R22) |
| B18 | Owner turns staff@'s Buyer switch **OFF**; pull to refresh | **Buying is turned off**, in both languages; no prices left on the phone (R2, R26). Record something first while offline to see "1 purchase not sent yet" |
| B19 | Switch **ON**; TRY AGAIN | Back in; the unsent purchase can be sent (R2) |
| B20 | Sign in as an office account **without** the Buyer switch (or admin-pm@) | "This account has no WorkMate access. Call the office." — no longer the general message (R1) |
| B21 | Log out; W-0007 signs in on the same phone | No price, receipt or purchase anywhere (shared phones) |
| B22 | `client_errors` since the install | Nothing new from WorkMate |

- [x] **Step 6: Clean-up.** Purchases list **filtered to `ZZ 2a3b pilot`**, check every row is ZZ; void them on the web; the owner removes the ZZ project, job, requests and supplier with a guarded SQL transaction **run by the user in the SQL editor** (dry run first; refuses if any matched row is not ZZ). Turn staff@'s switch back to what the owner wants.

- [ ] **Step 7: One real buyer, one buying run (Q20).** The owner picks the buyer; their Buyer switch ON; install **0.7.1** on their phone from the test file (not published yet). One week's buying; note anything found.

- [ ] **Step 8: Publish (Q21).** Dacs Web → Attendance → **App updates** (owner): upload `dacs-workmate-0.7.1-1008.apk` (0.7.0 was the pilot build, never published). It files under the WorkMate stream and is **required** for every WorkMate phone. Workers are unaffected: only W-0007 has ever used WorkMate. The 1b-3 publish-day to-dos stay tied to the worker switch-over, not this publish.

- [ ] **Step 9: Close-out.** Append *Execution notes* to this plan; update memory `workmate-stage2-decisions.md` (2A-3 done; next 2A-4 payments / petty cash).

---

## Self-review (against the spec and the answers)

| Answer / ruling | Where |
|---|---|
| Q1, R1, R3 (sign-in, who may buy) | Task 1: `SignInApi` reads `access`; `AppController._afterBuyer`; `BuyerAccess.decide` (= `pur_buyer()` via `pur_me`) |
| Q2 (three tabs) | Task 5 `BuyerShell`; Task 1 checks no Time In / Requests / My Work |
| Q3 (no approvals on the phone) | Task 5: only "Waiting for the owner" is shown |
| Q4 (list order, marks, filter, numbers, no prices) | Task 3 `ShoppingController.sections`, screen test "no prices" |
| Q5 (claim whole/part, release, online) | Task 3 `claim` / `release`; Task 2 repository (online, no queue) |
| Q6 (Mark arranged, own portions) | Task 2 `setArranged` refuses not-mine; Task 3 button; **R18** |
| Q7 (offline record, once, Needs attention) | Task 2 db `queueDraft`, `PurchasingSync`; Task 5 Fix / Throw away |
| Q8 (receipt or No receipt + reason; camera or gallery) | Task 2 `purchaseProblems`; Task 4 slots + image_picker; **R20** |
| Q9 (multi-project receipt, fees, total check) | Task 2 `prorate`, body shares; Task 4 adjust split; **R21** |
| Q10 (same item?, substitute reason, office check) | Task 2 `LineMatch`, `countsDirectly`; Task 4 segmented choice; **R19** |
| Q11 (extras, warehouse, unplanned) | Task 2 problems; Task 4 places, extra reason + location |
| Q12 (my purchases, 60 days, statuses, receipts) | Task 5 list, flags, detail; R27 |
| Q13 (correct own, owner for the rest, no void) | Task 5 `correction.dart`, `CorrectScreen`; **R22** |
| Q20, Q21 (version, pilot, publish) | Task 6 |
| Q22 (English + Tagalog) | `purchasing_copy.dart`, `purFailureCopy`, `problemCopy` (tests check every failure has both) |
| Q23 (buyers skip the Terms) | Task 1 `_afterBuyer` never asks the Terms; test "never the Attendance Terms"; Profile has no Terms row |
| R2 / R26 (switch off) | Task 1 `BuyingOff`; Task 2 `_guard` wipe; Task 2 account wipe |
| R17 | Task 1 decisions and tests |
| R23, R24, R25, R27 | Tasks 3, 4, 5, 2 |

No placeholders. Every type a later task uses is produced by an earlier task (see each task's *Interfaces*). Each task ends with the whole suite green on its own.

## Proof

- Built and tested in a scratch clone of WorkMate `a77eb39` (branch `plan`, one commit per task): **695 / 771 / 788 / 806 / 822 / 822** tests after Tasks 1–6, `flutter analyze` clean after each.
- **20/20 mutations caught** (each breaks one rule; the named tests fail): buyers down the worker path; a buyer sent to the Terms; a turned-off buyer signed out; offline assumed a buyer; `access` ignored; failure codes matched as substrings; the receipt rule and the total check dropped; source `purchasing` from the phone; a double Send queued twice; an uploaded receipt not remembered; a refusal retried forever; BUYER_REQUIRED not wiping; Mark arranged on someone else's portion; buying off keeping prices; other buyers' portions shown as unassigned; all weeks by default; a correction sending the request links; the background run ignoring the purchases' failure; Profile showing buyers the Terms.
- A **debug APK** of Task 6 built (Gradle `assembleDebug`, AGP 8.11.1, JDK 21): image_picker 1.2.1 compiles with the app's tools.
- Layout overflows found by the screen tests at phone width were fixed in the code above (dropdowns expand with ellipsis; headings and the Needs-attention buttons wrap).

## Rehearsal

This text was re-applied, block by block, to two fresh clones of the real WorkMate repo at `a77eb39`: one with LF line endings and one with **every file CRLF** (the real working folder mixes both; `lib/app_controller.dart` and `test/app_controller_test.dart` are CRLF there). Create blocks were written as given, Modify blocks applied with `git apply --ignore-whitespace` in plan order, and `pubspec.lock` regenerated by `flutter pub get --offline`. Compared with the tested build (line endings normalised): **identical, all 330 files**, both clones. The CRLF clone then passed `flutter test` (**822**) and `flutter analyze` (no issues) on its own.

## Execution notes

**22 Oct 2026 — build.** Tasks 1–6 applied to the real WorkMate repo (on `a77eb39`, uncommitted; the user commits) and compared byte for byte with the tested scratch build: identical, all 60 files. `flutter test` 822 passed, `flutter analyze` clean. Release APK `dacs-workmate-0.7.0-1007.apk`, 37.4 MB, installed on the test phone only (Xiaomi, adb `E6W85TF6C65HXKOJ`).

**22 Oct — pilot (Step 5), staff@ as the test buyer, project `ZZ 2a3b pilot` + job `ZZ 2a3b job`, supplier `ZZ Pilot Hardware`.** **B1–B22 all passed.** B22: no `client_errors` and no failed sign-ins or function errors since the install. B21: W-0007 on the same phone got the worker app with no buying tab and no ₱.

Found during the pilot (none blocked a check):

| # | Finding | Fixed in 0.7.1 |
|---|---|---|
| F1 | Supplier / project / job lists empty when Record purchase is first opened offline: they were read only when the form opened | `BuyerShell` reads `choices()` on open and on resume (the read keeps the saved copy) |
| F2 | The round **Record purchase** button sat on top of the **Record purchase (N)** pick button | The round button hides while items are ticked |
| — | The round button covered the last shopping card | 88 px of room under the list (My purchases already had 80) |
| F3 | Back + ticking the same item again started a **second** draft; the ₱370 pilot purchase went out from that second draft with no supplier | Ticked items already in an unsent draft ask **Continue it / Start a new one**; Continue opens that draft and adds the newly ticked items (`draftWithSameItems`, `withPickedLines`; an adjusted split is redone) |
| F4 | Buying-off screen: "1 purchase … stay … They" | Singular wording for one |

Not done (optional, later): recording a cancelled request line as unplanned from the Needs-attention card.

**22 Oct — clean-up (Step 6).** The owner rejected the one pending approval ("discount given", ₱200 → ₱190), then voided all 8 test purchases on the web: 7 with the list filtered to `ZZ 2a3b pilot` (confirm word `ZZ`) and the ₱80 warehouse gloves (`VOID`). Checked: every ZZ expense row gone (Spent ₱0); the 3 cover rows left on voided purchases count nothing (`pr_portion_bought` sums recorded purchases only). The user then ran a guarded SQL transaction (13 guards; dry run first: purchases 8, request events 9, portions 3, request lines 3, folders 2, receipt records 8; real recorded purchases 5 and the expense total unchanged). The 8 receipt image files stay in Storage (SQL cannot delete Storage files; the month folder also holds 2 non-pilot files, so it must never be deleted as a whole). The ZZ catalogue items from 5 and 7 Oct were left alone. staff@'s Buyer switch left **OFF**.

**22 Oct — 0.7.1+1008.** F1–F4 and the padding fixed in the real repo (no scratch clone: small, screen-level changes). 9 new tests (buyer screens 6, draft matching 3); **8/8 mutations caught** (each fix broken on purpose, a test failed each time). `flutter test` **832 passed**, `flutter analyze` clean. APK `dacs-workmate-0.7.1-1008.apk`, 37.4 MB, SHA-256 `154BE0B2C2F7B96CA100EBF78769F2C4ADF270A3C436FD25D471885D59FA0F8B`, installed on the test phone. Re-check on the phone with project `ZZ 2a3b recheck` (one request, nothing sent): **R1–R4 passed**: lists present offline, round button hidden while ticked and the last card clear, *You already started this purchase* with the typed supplier kept, singular buying-off wording. The re-check project and request removed by a second guarded SQL.

**Still to do:** Step 7 (one real buyer, one buying run, with **0.7.1**, not 0.7.0), Step 8 (publish **0.7.1-1008**), Step 9 (memory). The user commits both repos.
