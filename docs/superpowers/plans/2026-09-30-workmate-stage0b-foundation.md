# WorkMate Stage 0B — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Flutter app, DAC'S WorkMate (`com.dacs.workmate`), that a worker can install, sign into with their existing Attendance account, pass the same Terms gate, stay signed in across restarts and offline launches, and update in-app from the WorkMate release stream. No Time In yet; that is 0C.

**Architecture:** A new sibling repo `Documents\Dacs WorkMate`. Pure Dart domain files (eligibility, login failures, session gate, startup gate, Terms text, update policy) are ports of the Kotlin app's rules, each with its own tests. Thin adapters (`AuthBackend`, `TermsBackend`, `ReleaseSource`, `InstallGateway`) wrap Supabase and Android so the domain and the `AppController` test without a device. One `WorkMateHttpClient` sits under every Supabase call and adds the 0082 app-identity headers.

**Tech Stack:** Flutter 3.38.9 / Dart 3.10.8, JDK 21 (Temurin), Android SDK 36, `supabase_flutter` 2.17.2, `http` 1.6.0, `crypto` 3.0.7, `shared_preferences` 2.5.5, `flutter_secure_storage` 11.2.0, `path_provider` 2.1.6, `device_info_plus` 13.2.0, `package_info_plus` 10.2.1.

**Spec:** [docs/superpowers/specs/2026-09-29-unified-worker-app-design.md](../specs/2026-09-29-unified-worker-app-design.md) §1 (Flutter/Dart, Android only, packaging), §3 (Attendance stays the same). Roadmap: [2026-09-29-workmate-stage0-roadmap.md](2026-09-29-workmate-stage0-roadmap.md) row 0B. Server contract: [2026-09-29-workmate-stage0a-server-support.md](2026-09-29-workmate-stage0a-server-support.md) (migration 0082, verified live 2026-09-30).

**Behaviour reference (read, never copy screens):** `C:\Users\John Aerol Tapales\Documents\Dacs Attendance\app\src\main\java\com\dacs\attendance\` — `data/remote/SignInApi.kt`, `data/remote/SupabaseModule.kt`, `data/repo/SupabaseAuthRepository.kt`, `data/local/WorkerCache.kt`, `domain/WorkerProfile.kt`, `domain/LoginFailure.kt`, `domain/SessionGate.kt`, `domain/StartupGate.kt`, `domain/TermsGate.kt`, `domain/AttendanceTerms.kt`, `data/repo/SupabaseTermsRepository.kt`, `domain/AppUpdate.kt`, `data/repo/AppUpdateRepository.kt`, `data/local/ApkInstaller.kt`, `res/values/strings.xml`.

## Global Constraints

- Android application id **`com.dacs.workmate`**; debug builds **`com.dacs.workmate.debug`**. Label "DAC'S WorkMate"; publisher line "By Dacs Building Design Services".
- **`versionCode` ≥ 1000** (pubspec `version: 0.1.0+1000` for the first build). The old app stays < 1000. 0082 enforces this on the server.
- Every request sends **`x-dacs-app: workmate`** and **`x-dacs-app-version: <versionCode>`** (lower-case header names).
- **Never build with `--split-per-abi`.** It rewrites versionCode per ABI and locks phones out. One universal APK. The `app-releases` bucket limit is **50 MB** (52,428,800 bytes).
- `minSdk` **24** (same as the Attendance app: cheap, older phones).
- Backend: Supabase project `hqbgduyonlbbsvjuapre`, same accounts, **no duplicate worker accounts**. Sign-in goes through the `attendance-signin` Edge Function (Turnstile blocks direct password sign-in); only `worker` and `teamLeader` with status `active` (null = active) get a session.
- Update stream: RPC **`app_latest_release_for('workmate')`**; APK URL = `https://hqbgduyonlbbsvjuapre.supabase.co/storage/v1/object/public/app-releases/<storage_path>`. Every published release is **required**.
- Terms: the **same** text and version as the Attendance app (`2026-09-v3`). `canonicalText()` must hash to **`80bb9d44274b77de8a2d6e11609f1b07d6b73245a6366ed2807b9d981584fbd5`** (3,079 characters, the live `agreement_events.doc_sha256`), so workers who accepted in the old app are not asked again.
- Copy rule from the old app: **screen copy English, failure copy bilingual** (English, then Tagalog).
- The anon key is public by design; **never put the service_role key in the app.**
- The **user commits manually.** "Checkpoint" steps mean: stop, show `git status`, let the user review and commit. Never run `git commit` or `git push`.
- Use JDK 21 for Android builds (`JAVA_HOME` on this PC points at JDK 25; Task 1 pins Flutter to 21).

---

## File Structure (new repo `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`)

| File | Responsibility |
|---|---|
| `pubspec.yaml` | Name `workmate`, version `0.1.0+1000`, dependencies, Barlow / IBM Plex Mono fonts |
| `android/app/build.gradle.kts` | Application id, `.debug` suffix, minSdk 24, upload-key signing, refuse release without key |
| `android/app/src/main/AndroidManifest.xml` | Label placeholder, INTERNET, REQUEST_INSTALL_PACKAGES, FileProvider |
| `android/app/src/main/res/xml/update_file_paths.xml` | Only `cache/updates/` is shareable (the downloaded APK) |
| `android/app/src/main/kotlin/com/dacs/workmate/MainActivity.kt` | `com.dacs.workmate/installer` channel: canInstall / openInstallPermission / install |
| `lib/config/app_config.dart` | URLs, anon key, header names, bucket |
| `lib/net/update_nudges.dart` | "Server says this build is too old" event stream |
| `lib/net/workmate_http_client.dart` | Adds app headers, reports Date header, nudges on APP_UPDATE_REQUIRED |
| `lib/auth/worker_profile.dart` | Profile row + eligibility rule + display helpers |
| `lib/auth/login_failure.dart` | Sign-in failure codes → one bilingual message |
| `lib/auth/session_gate.dart` | Session presence → ask server / use last known / signed out |
| `lib/auth/worker_cache.dart` | Last signed-in worker + their profile + their accepted Terms version (device memory) |
| `lib/auth/session_storage.dart` | Encrypted session store for supabase_flutter, retry before clear, plain fallback |
| `lib/auth/sign_in_api.dart` | POST to `attendance-signin` |
| `lib/auth/auth_backend.dart` | `AuthBackend` interface + Supabase implementation |
| `lib/auth/auth_repository.dart` | signIn / signOut / currentWorker |
| `lib/terms/attendance_terms.dart` | The Terms text, canonical text, SHA-256 |
| `lib/terms/terms_gates.dart` | `TermsGate` + `StartupGate` |
| `lib/terms/terms_repository.dart` | `TermsBackend` + accept (evidence first) + startup decision |
| `lib/update/app_release.dart` | `AppRelease`, `AppUpdatePolicy`, `ApkVerification` |
| `lib/update/app_update_repository.dart` | `ReleaseSource`, required release + cache, verified download |
| `lib/update/apk_installer.dart` | `InstallGateway` over the method channel |
| `lib/app_controller.dart` | Startup / sign-in / terms / update state machine |
| `lib/ui/theme.dart` | Colours and type from the Attendance app |
| `lib/ui/failure_notice.dart` | Red bilingual notice |
| `lib/ui/login_screen.dart`, `terms_screen.dart`, `gate_unavailable_screen.dart`, `home_shell.dart`, `update_overlay.dart` | Screens |
| `lib/app.dart`, `lib/main.dart` | Wiring |
| `test/…` | One test file per lib file with logic |
| `README.md` | Build, JDK, signing, release rules |

---

### Task 1: Create the repo and lock the app identity

**Files:**
- Create: the Flutter project `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`
- Modify: `pubspec.yaml`, `android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`, `.gitignore`
- Create: `README.md`, `assets/fonts/*.ttf`
- Test: `test/app_identity_test.dart`

**Interfaces:**
- Produces: a project named `workmate` (Dart imports are `package:workmate/...`), buildable debug APK `com.dacs.workmate.debug`, versionCode 1000, manifest placeholder `appLabel`.

- [ ] **Step 1: Pin Flutter to JDK 21 and create the project**

```powershell
flutter config --jdk-dir "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
Set-Location "C:\Users\John Aerol Tapales\Documents"
flutter create --org com.dacs --project-name workmate --platforms android --empty "Dacs WorkMate"
Set-Location "C:\Users\John Aerol Tapales\Documents\Dacs WorkMate"
git init
flutter pub add supabase_flutter:^2.17.2 http:^1.6.0 crypto:^3.0.7 shared_preferences:^2.5.5 flutter_secure_storage:^11.2.0 path_provider:^2.1.6 device_info_plus:^13.2.0 package_info_plus:^10.2.1
```

Expected: `Created project` and `Changed N dependencies!`. If `flutter create` reports the folder exists, stop and ask the user; never delete it. If a `test/widget_test.dart` was generated, delete it: it tests the template, which Task 9 replaces.

- [ ] **Step 2: Write the failing identity test**

`test/app_identity_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The identity 0082 depends on. A wrong value here is not a style issue:
/// a versionCode below 1000 falls into the server's legacy phone-clock
/// branch, and a changed application id can never update an installed app.
void main() {
  final gradle = File('android/app/build.gradle.kts').readAsStringSync();
  final pubspec = File('pubspec.yaml').readAsStringSync();
  final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();

  test('application id is com.dacs.workmate, debug builds get .debug', () {
    expect(gradle, contains('applicationId = "com.dacs.workmate"'));
    expect(gradle, contains('applicationIdSuffix = ".debug"'));
  });

  test('versionCode is 1000 or higher', () {
    final m = RegExp(r'^version:\s*\S+\+(\d+)\s*$', multiLine: true).firstMatch(pubspec);
    expect(m, isNotNull, reason: 'pubspec version must be name+code');
    expect(int.parse(m!.group(1)!), greaterThanOrEqualTo(1000));
  });

  test('minSdk stays 24 like the Attendance app', () {
    expect(gradle, contains('minSdk = 24'));
  });

  test('a release never builds without the upload key', () {
    expect(gradle, contains('keystore.properties is missing'));
  });

  test('release builds can reach the network and install updates', () {
    expect(manifest, contains('android.permission.INTERNET'));
    expect(manifest, contains('android.permission.REQUEST_INSTALL_PACKAGES'));
    expect(manifest, contains(r'android:label="${appLabel}"'));
  });

  test('the upload key never enters git', () {
    final ignore = File('.gitignore').readAsStringSync();
    expect(ignore, contains('keystore.properties'));
    expect(ignore, contains('*.jks'));
  });

  test('nothing tells anyone to split the APK per ABI', () {
    const banned = 'split' '-per-abi';
    for (final f in Directory('.').listSync(recursive: true).whereType<File>()) {
      final p = f.path.replaceAll(r'\', '/');
      if (p.contains('/build/') || p.contains('/.dart_tool/') || p.contains('/.git/')) continue;
      if (!RegExp(r'\.(md|ps1|sh|yaml|kts|gradle)$').hasMatch(p)) continue;
      expect(f.readAsStringSync().contains(banned), isFalse, reason: p);
    }
  });
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `flutter test test/app_identity_test.dart`
Expected: FAIL on `applicationIdSuffix`, `versionCode`, `minSdk = 24`, `keystore.properties is missing`, the manifest and `.gitignore` checks.

- [ ] **Step 4: Set the version and fonts in `pubspec.yaml`**

Set the version line to:

```yaml
version: 0.1.0+1000
```

Copy the fonts from the Attendance app:

```powershell
New-Item -ItemType Directory -Force assets\fonts
Copy-Item "C:\Users\John Aerol Tapales\Documents\Dacs Attendance\app\src\main\res\font\barlow_*.ttf","C:\Users\John Aerol Tapales\Documents\Dacs Attendance\app\src\main\res\font\ibm_plex_mono_*.ttf" assets\fonts\
```

Under the existing `flutter:` key in `pubspec.yaml` add:

```yaml
  fonts:
    - family: Barlow
      fonts:
        - asset: assets/fonts/barlow_regular.ttf
        - asset: assets/fonts/barlow_semibold.ttf
          weight: 600
        - asset: assets/fonts/barlow_bold.ttf
          weight: 700
        - asset: assets/fonts/barlow_extrabold.ttf
          weight: 800
    - family: IBM Plex Mono
      fonts:
        - asset: assets/fonts/ibm_plex_mono_regular.ttf
        - asset: assets/fonts/ibm_plex_mono_bold.ttf
          weight: 700
```

- [ ] **Step 5: Edit `android/app/build.gradle.kts`**

Keep the generated `plugins { … }`, `compileOptions`, Kotlin JVM-target block and `flutter { … }` exactly as generated. At the very top of the file add:

```kotlin
import java.io.FileInputStream
import java.util.Properties
```

Directly after the `plugins { … }` block add:

```kotlin
/**
 * The upload key, when this machine holds it. Kept in android/keystore.properties
 * (gitignored) pointing at a .jks OUTSIDE the repo: an upload key in git lets
 * anyone ship an update every installed phone accepts as genuine.
 * Absent is supported for debug builds and tests; a release refuses to build.
 */
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) FileInputStream(keystorePropertiesFile).use { load(it) }
}
```

Replace the generated `defaultConfig { … }` and `buildTypes { … }` blocks inside `android { … }` with:

```kotlin
    defaultConfig {
        applicationId = "com.dacs.workmate"
        // Construction workers are on cheap, older phones -- same floor as DACS Attendance.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        // From pubspec `version: name+code`. The code is ALSO a server gate
        // (0082): WorkMate must be >= 1000, every release must raise it.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["appLabel"] = "DAC'S WorkMate"
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // Installs beside the real app, so a test build never replaces a worker's install.
            applicationIdSuffix = ".debug"
            manifestPlaceholders["appLabel"] = "WorkMate debug"
        }
        release {
            signingConfig = signingConfigs.findByName("release")
        }
    }
```

At the end of the file, after `flutter { … }`, add:

```kotlin
dependencies {
    // FileProvider, for handing the verified update APK to the system installer.
    implementation("androidx.core:core-ktx:1.13.1")
}

// A release signed with the wrong key (or none) can never update an installed
// WorkMate. Fail loudly instead of producing one.
gradle.taskGraph.whenReady {
    if (!keystorePropertiesFile.exists() && allTasks.any { it.name.contains("Release") }) {
        throw GradleException(
            "keystore.properties is missing: refusing to build a WorkMate release with no upload key. See README.md."
        )
    }
}
```

- [ ] **Step 6: Edit `android/app/src/main/AndroidManifest.xml`**

Inside `<manifest …>` and before `<application`, add:

```xml
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <!-- In-app updates: the office publishes APKs from Dacs Web (0079/0082). -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

On the `<application` element, set `android:label="${appLabel}"` (replacing the generated label). Inside `<application>`, after the `<activity>` element, add:

```xml
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/update_file_paths" />
        </provider>
```

Create `android/app/src/main/res/xml/update_file_paths.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Only the downloaded update APK is ever shared, and only with the system installer. -->
<paths>
    <cache-path name="updates" path="updates/" />
</paths>
```

- [ ] **Step 7: `.gitignore` and `README.md`**

Append to `.gitignore`:

```
# Upload key: never in git (see README).
android/keystore.properties
*.jks
*.keystore
```

Create `README.md`:

````markdown
# DAC'S WorkMate

Worker app for Attendance, Material Requests and Tools. By Dacs Building Design Services.
Flutter/Dart, Android only. Backend: the shared DAC's Supabase project (`hqbgduyonlbbsvjuapre`).
Design and rules: `Dacs Web/docs/superpowers/specs/2026-09-29-unified-worker-app-design.md`.

## Build

- JDK 21: `flutter config --jdk-dir "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"`
- Tests: `flutter test`
- Debug APK (`com.dacs.workmate.debug`, installs beside the real app): `flutter build apk --debug`
- Release APK: `flutter build apk --release` — ONE universal APK. Never split it per ABI: that rewrites
  versionCode per ABI and the server then refuses those phones.

## Release rules

- Bump `version:` in `pubspec.yaml` on EVERY release. The number after `+` is the versionCode:
  it must be 1000 or higher and higher than the last published WorkMate build (server rule 0082).
- The release APK must stay under 50 MB (the `app-releases` bucket limit).
- Publish from Dacs Web → App Updates. It recognises `com.dacs.workmate` and files it under the
  WorkMate stream. Publishing makes the update REQUIRED for every WorkMate phone.

## Upload key

`android/keystore.properties` (gitignored) points at
`C:\Users\John Aerol Tapales\keystores\dacs-workmate-upload.jks`:

```
storeFile=C:/Users/John Aerol Tapales/keystores/dacs-workmate-upload.jks
storePassword=...
keyAlias=workmate-upload
keyPassword=...
```

Losing this key means no update can ever be installed over WorkMate. Back it up with the Attendance key.
A release build refuses to run without it; debug builds and tests do not need it.
````

- [ ] **Step 8: Run the tests and a debug build**

Run: `flutter test test/app_identity_test.dart`
Expected: PASS (7 tests).

Run: `flutter build apk --debug`
Expected: `√ Built build\app\outputs\flutter-apk\app-debug.apk`.

- [ ] **Step 9: Checkpoint**

Show `git status`. Stop for the user to review and commit ("chore: create DAC'S WorkMate app with its identity").

---

### Task 2: App config and the HTTP client every request goes through

**Files:**
- Create: `lib/config/app_config.dart`, `lib/net/update_nudges.dart`, `lib/net/workmate_http_client.dart`
- Test: `test/net/workmate_http_client_test.dart`

**Interfaces:**
- Produces: `AppConfig` constants; `class UpdateNudges { Stream<void> get events; void nudge(); }`; `class WorkMateHttpClient extends http.BaseClient { WorkMateHttpClient({required int versionCode, required UpdateNudges nudges, http.Client? inner, void Function(String date)? onServerDate}); }`; top-level `const appUpdateRequired = 'APP_UPDATE_REQUIRED';`

- [ ] **Step 1: Write the failing test**

`test/net/workmate_http_client_test.dart`:

```dart
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:workmate/net/update_nudges.dart';
import 'package:workmate/net/workmate_http_client.dart';

void main() {
  test('every request carries x-dacs-app: workmate and the versionCode', () async {
    late http.BaseRequest seen;
    final client = WorkMateHttpClient(
      versionCode: 1000,
      nudges: UpdateNudges(),
      inner: MockClient((req) async {
        seen = req;
        return http.Response('[]', 200);
      }),
    );
    await client.get(Uri.parse('https://example.test/rest/v1/profiles'));
    expect(seen.headers['x-dacs-app'], 'workmate');
    expect(seen.headers['x-dacs-app-version'], '1000');
  });

  test('a 4xx APP_UPDATE_REQUIRED nudges, and the body still reaches the caller', () async {
    final nudges = UpdateNudges();
    var fired = 0;
    final sub = nudges.events.listen((_) => fired++);
    final client = WorkMateHttpClient(
      versionCode: 1000,
      nudges: nudges,
      inner: MockClient((_) async => http.Response('{"message":"APP_UPDATE_REQUIRED"}', 400)),
    );
    final res = await client.get(Uri.parse('https://example.test/rest/v1/rpc/x'));
    await Future<void>.delayed(Duration.zero);
    expect(fired, 1);
    expect(res.statusCode, 400);
    expect(res.body, contains('APP_UPDATE_REQUIRED'));
    await sub.cancel();
  });

  test('other failures do not nudge', () async {
    final nudges = UpdateNudges();
    var fired = 0;
    final sub = nudges.events.listen((_) => fired++);
    final client = WorkMateHttpClient(
      versionCode: 1000,
      nudges: nudges,
      inner: MockClient((req) async => req.url.path.endsWith('a')
          ? http.Response('APP_UPDATE_REQUIRED', 500)
          : http.Response('{"message":"permission denied"}', 403)),
    );
    await client.get(Uri.parse('https://example.test/a'));
    await client.get(Uri.parse('https://example.test/b'));
    await Future<void>.delayed(Duration.zero);
    expect(fired, 0);
    await sub.cancel();
  });

  test('the server Date header is reported (0C anchors trusted time on it)', () async {
    String? date;
    final client = WorkMateHttpClient(
      versionCode: 1000,
      nudges: UpdateNudges(),
      onServerDate: (d) => date = d,
      inner: MockClient((_) async =>
          http.Response('[]', 200, headers: {'date': 'Wed, 30 Sep 2026 07:00:00 GMT'})),
    );
    await client.get(Uri.parse('https://example.test/'));
    expect(date, 'Wed, 30 Sep 2026 07:00:00 GMT');
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `flutter test test/net/workmate_http_client_test.dart`
Expected: FAIL, `Target of URI doesn't exist: 'package:workmate/net/update_nudges.dart'`.

- [ ] **Step 3: Implement**

`lib/config/app_config.dart`:

```dart
/// Where WorkMate finds the shared DAC's backend.
///
/// The anon key is PUBLIC by design: js/supabase-config.js ships the same
/// string to every browser. It grants nothing on its own; every table is
/// behind RLS. Never put the service_role key in this app.
class AppConfig {
  static const supabaseUrl = 'https://hqbgduyonlbbsvjuapre.supabase.co';
  static const supabaseAnonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxYmdkdXlvbmxiYnN2anVhcHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2Mjc3NDEsImV4cCI6MjA5NjIwMzc0MX0.sDKSroNIm-1Lip6ueq2lN1VTsvO1g4mT7Rf_WZ5AxWo';

  /// Sign-in runs server-side: Turnstile guards the auth endpoint and has no
  /// native Android SDK. The function also refuses non-workers.
  static const signInFunctionUrl = '$supabaseUrl/functions/v1/attendance-signin';

  static const releaseBucket = 'app-releases';

  /// 0082: how the server tells WorkMate from the old Attendance app.
  static const appHeader = 'x-dacs-app';
  static const appName = 'workmate';
  static const appVersionHeader = 'x-dacs-app-version';
}
```

`lib/net/update_nudges.dart`:

```dart
import 'dart:async';

/// "The server just said this build is too old." Fired by
/// [WorkMateHttpClient] on APP_UPDATE_REQUIRED (0077) so the update screen
/// appears the moment the office publishes, not at the next launch.
class UpdateNudges {
  final _events = StreamController<void>.broadcast();

  Stream<void> get events => _events.stream;

  void nudge() => _events.add(null);
}
```

`lib/net/workmate_http_client.dart`:

```dart
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import 'update_nudges.dart';

/// 0077's refusal code for a build the server no longer accepts.
const appUpdateRequired = 'APP_UPDATE_REQUIRED';

/// The client under every Supabase call and the sign-in function.
///
/// - Adds the identity headers 0082 reads: `x-dacs-app: workmate` and the
///   versionCode. Without them WorkMate would be taken for the old app.
/// - Reports each response's Date header (0C anchors trusted time on it).
/// - Peeks a 4xx body for APP_UPDATE_REQUIRED and hands it back intact.
class WorkMateHttpClient extends http.BaseClient {
  WorkMateHttpClient({
    required this.versionCode,
    required this.nudges,
    http.Client? inner,
    this.onServerDate,
  }) : _inner = inner ?? http.Client();

  final int versionCode;
  final UpdateNudges nudges;
  final void Function(String date)? onServerDate;
  final http.Client _inner;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    request.headers[AppConfig.appHeader] = AppConfig.appName;
    request.headers[AppConfig.appVersionHeader] = versionCode.toString();

    final response = await _inner.send(request);

    final date = response.headers['date'];
    if (date != null) onServerDate?.call(date);

    if (response.statusCode < 400 || response.statusCode > 499) return response;

    final bytes = await response.stream.toBytes();
    if (utf8.decode(bytes, allowMalformed: true).contains(appUpdateRequired)) {
      nudges.nudge();
    }
    return http.StreamedResponse(
      Stream.value(bytes),
      response.statusCode,
      contentLength: bytes.length,
      request: response.request,
      headers: response.headers,
      isRedirect: response.isRedirect,
      persistentConnection: response.persistentConnection,
      reasonPhrase: response.reasonPhrase,
    );
  }

  @override
  void close() => _inner.close();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `flutter test test/net/workmate_http_client_test.dart`
Expected: PASS (4 tests).

- [ ] **Step 5: Checkpoint**

Show `git status`. Stop for the user to commit ("feat: send WorkMate identity headers on every request").

---

### Task 3: Worker profile, eligibility, login failures and the session gate

**Files:**
- Create: `lib/auth/worker_profile.dart`, `lib/auth/login_failure.dart`, `lib/auth/session_gate.dart`
- Test: `test/auth/worker_profile_test.dart`, `test/auth/login_failure_test.dart`, `test/auth/session_gate_test.dart`

**Interfaces:**
- Produces:
  - `enum Eligibility { allowed, accountInactive, notAWorker }`, `Eligibility eligibilityOf(String? role, String? status)`
  - `class WorkerProfile { id, email, displayName, position, workerNo, role, status; factory WorkerProfile.fromRow(Map<String, dynamic>); Map<String, dynamic> toRow(); static const columns; workerIdLabel; initials; positionAndId; firstName; Eligibility eligibility(); }`
  - `enum LoginFailure { missingFields, wrongCredentials, accountInactive, notAWorker, tooManyAttempts, noConnection, serverProblem }` with `static LoginFailure forCode(String?)`, `static LoginFailure of(Object error)`, `String get english`, `String get tagalog`
  - `enum SessionPresence { confirmed, unverifiable, absent }`, `enum SessionDecision { askTheServer, useLastKnown, signedOut }`, `SessionDecision decideSession(SessionPresence presence, {required bool hasLastKnownWorker})`

- [ ] **Step 1: Write the failing tests**

`test/auth/worker_profile_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/auth/worker_profile.dart';

void main() {
  group('eligibilityOf — the rule attendance-signin and the RPCs enforce', () {
    test('worker and teamLeader are allowed', () {
      expect(eligibilityOf('worker', 'active'), Eligibility.allowed);
      expect(eligibilityOf('teamLeader', 'active'), Eligibility.allowed);
    });
    test('a missing status counts as active (coalesce(status, active))', () {
      expect(eligibilityOf('worker', null), Eligibility.allowed);
    });
    test('an inactive worker is refused as inactive', () {
      expect(eligibilityOf('worker', 'inactive'), Eligibility.accountInactive);
    });
    test('staff, owner, client and null are not workers', () {
      for (final r in ['staff', 'owner', 'client', null]) {
        expect(eligibilityOf(r, 'active'), Eligibility.notAWorker, reason: '$r');
      }
    });
  });

  group('display', () {
    const juan = WorkerProfile(
        id: 'u1', email: 'juan@x.com', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42);
    test('worker id label', () {
      expect(juan.workerIdLabel, 'W-0042');
      expect(const WorkerProfile(id: 'u').workerIdLabel, '--');
    });
    test('initials, first name and position line', () {
      expect(juan.initials, 'JD');
      expect(juan.firstName, 'Juan');
      expect(juan.positionAndId, 'Mason · W-0042');
    });
    test('falls back to the email, then "Worker"', () {
      expect(const WorkerProfile(id: 'u', email: 'pedro@x.com').firstName, 'pedro');
      expect(const WorkerProfile(id: 'u').firstName, 'Worker');
      expect(const WorkerProfile(id: 'u', email: 'pedro@x.com').initials, 'P');
    });
    test('blank position is left out', () {
      expect(const WorkerProfile(id: 'u', position: '  ', workerNo: 7).positionAndId, 'W-0007');
    });
  });

  test('row round-trip', () {
    final row = {
      'id': 'u1', 'email': 'a@b.c', 'display_name': 'A B', 'position': 'Mason',
      'worker_no': 3, 'role': 'worker', 'status': 'active',
    };
    expect(WorkerProfile.fromRow(row).toRow(), row);
  });
}
```

`test/auth/login_failure_test.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:workmate/auth/login_failure.dart';

void main() {
  test('stable codes from attendance-signin', () {
    expect(LoginFailure.forCode('INVALID_CREDENTIALS'), LoginFailure.wrongCredentials);
    expect(LoginFailure.forCode('NOT_A_WORKER'), LoginFailure.notAWorker);
    expect(LoginFailure.forCode('ACCOUNT_INACTIVE'), LoginFailure.accountInactive);
    expect(LoginFailure.forCode('TOO_MANY_ATTEMPTS'), LoginFailure.tooManyAttempts);
  });

  test('an unknown code is our problem, not the worker\'s password', () {
    expect(LoginFailure.forCode('SOMETHING_NEW'), LoginFailure.serverProblem);
    expect(LoginFailure.forCode(null), LoginFailure.serverProblem);
  });

  test('no signal is never reported as a wrong password', () {
    expect(LoginFailure.of(const SocketException('no route')), LoginFailure.noConnection);
    expect(LoginFailure.of(TimeoutException('slow')), LoginFailure.noConnection);
    expect(LoginFailure.of(http.ClientException('Connection closed')), LoginFailure.noConnection);
  });

  test('every failure has English and Tagalog copy', () {
    for (final f in LoginFailure.values) {
      expect(f.english, isNotEmpty);
      expect(f.tagalog, isNotEmpty);
    }
    expect(LoginFailure.wrongCredentials.english, 'That email and password do not match.');
    expect(LoginFailure.wrongCredentials.tagalog, 'Hindi tugma ang email at password.');
  });
}
```

`test/auth/session_gate_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/auth/session_gate.dart';

void main() {
  test('a confirmed session asks the server', () {
    expect(decideSession(SessionPresence.confirmed, hasLastKnownWorker: false), SessionDecision.askTheServer);
  });

  test('a session that cannot be checked is still a session (offline morning)', () {
    expect(decideSession(SessionPresence.unverifiable, hasLastKnownWorker: true), SessionDecision.useLastKnown);
  });

  test('unverifiable with nobody remembered cannot show a worker', () {
    expect(decideSession(SessionPresence.unverifiable, hasLastKnownWorker: false), SessionDecision.signedOut);
  });

  test('no session means signed out, even with a cached profile', () {
    expect(decideSession(SessionPresence.absent, hasLastKnownWorker: true), SessionDecision.signedOut);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/auth`
Expected: FAIL, missing `package:workmate/auth/...` files.

- [ ] **Step 3: Implement**

`lib/auth/worker_profile.dart`:

```dart
/// Who may use WorkMate. The same rule `attendance-signin` and the
/// attendance RPCs enforce; applied here so a deactivated worker is told at
/// the door. The database stays the authority.
enum Eligibility { allowed, accountInactive, notAWorker }

const _workerRoles = {'worker', 'teamLeader'};

Eligibility eligibilityOf(String? role, String? status) {
  if (!_workerRoles.contains(role)) return Eligibility.notAWorker;
  // SQL says coalesce(status, 'active'): older rows carry no status.
  if ((status ?? 'active') != 'active') return Eligibility.accountInactive;
  return Eligibility.allowed;
}

/// The worker's `profiles` row, as the app needs it.
class WorkerProfile {
  const WorkerProfile({
    required this.id,
    this.email,
    this.displayName,
    this.position,
    this.workerNo,
    this.role,
    this.status,
  });

  static const columns = 'id,email,display_name,position,worker_no,role,status';

  factory WorkerProfile.fromRow(Map<String, dynamic> row) => WorkerProfile(
        id: row['id'] as String,
        email: row['email'] as String?,
        displayName: row['display_name'] as String?,
        position: row['position'] as String?,
        workerNo: (row['worker_no'] as num?)?.toInt(),
        role: row['role'] as String?,
        status: row['status'] as String?,
      );

  final String id;
  final String? email;
  final String? displayName;
  final String? position;
  final int? workerNo;
  final String? role;
  final String? status;

  Map<String, dynamic> toRow() => {
        'id': id,
        'email': email,
        'display_name': displayName,
        'position': position,
        'worker_no': workerNo,
        'role': role,
        'status': status,
      };

  /// "W-0042", the format the Profile screen shows.
  String get workerIdLabel => workerNo == null ? '--' : 'W-${workerNo.toString().padLeft(4, '0')}';

  /// First name only; falls back to the email's local part, then "Worker".
  String get firstName {
    final d = displayName?.trim();
    if (d != null && d.isNotEmpty) return d.split(' ').first;
    final e = email;
    if (e != null) return e.split('@').first;
    return 'Worker';
  }

  /// "JD" for Juan dela Cruz: first letters of the first two words.
  String get initials {
    final parts = (displayName ?? firstName).trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0].substring(0, 1).toUpperCase();
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }

  /// "Mason · W-0042".
  String get positionAndId => [
        if (position != null && position!.trim().isNotEmpty) position!,
        workerIdLabel,
      ].join(' · ');

  Eligibility eligibility() => eligibilityOf(role, status);
}
```

`lib/auth/login_failure.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Every way signing in can fail, reduced to one sentence the worker sees.
/// A raw HTTP or Postgres string never reaches the screen.
enum LoginFailure {
  missingFields('Fill in your email and password.', 'Punan ang email at password.'),
  wrongCredentials('That email and password do not match.', 'Hindi tugma ang email at password.'),
  accountInactive('This account is turned off. Call the office.', 'Naka-off ang account na ito. Tawagan ang opisina.'),
  notAWorker('This is not a worker account.', 'Hindi ito worker account.'),
  tooManyAttempts('Too many tries. Wait a minute, then try again.', 'Sobrang dami nang subok. Maghintay ng isang minuto.'),
  noConnection('No signal right now. Try again in a moment.', 'Walang signal ngayon. Subukan ulit mamaya.'),
  serverProblem('Something went wrong. Try again.', 'May nasira. Subukan ulit.');

  const LoginFailure(this.english, this.tagalog);

  final String english;
  final String tagalog;

  /// The stable codes `attendance-signin` returns.
  static LoginFailure forCode(String? code) => switch (code) {
        'INVALID_CREDENTIALS' => wrongCredentials,
        'NOT_A_WORKER' => notAWorker,
        'ACCOUNT_INACTIVE' => accountInactive,
        'TOO_MANY_ATTEMPTS' => tooManyAttempts,
        // An unknown code means the function and the app drifted apart.
        _ => serverProblem,
      };

  /// Transport failures. No signal is not a wrong password: on site the
  /// two mean "try again in a minute" versus "walk to the office".
  static LoginFailure of(Object error) {
    if (error is SocketException || error is TimeoutException || error is http.ClientException) {
      return noConnection;
    }
    final text = error.toString().toLowerCase();
    if (text.contains('invalid_credentials') || text.contains('invalid login credentials')) {
      return wrongCredentials;
    }
    return serverProblem;
  }
}
```

`lib/auth/session_gate.dart`:

```dart
/// What the auth client can say about the session on this device.
/// "No session" and "a session I cannot check right now" are different
/// facts; only the first means the worker is signed out.
enum SessionPresence { confirmed, unverifiable, absent }

enum SessionDecision {
  /// Read the profile as this worker; its answer is authoritative.
  askTheServer,

  /// Cannot verify: stand on the last profile this device saw.
  useLastKnown,

  /// Nothing to resolve: the login screen is correct.
  signedOut,
}

/// Decided BEFORE anything is read. A read made with no session does not
/// fail: it succeeds as the anon role and returns zero rows, and believing
/// that "nobody" is what signed Attendance workers out of an app they
/// never left (see the Kotlin SessionGate).
SessionDecision decideSession(SessionPresence presence, {required bool hasLastKnownWorker}) =>
    switch (presence) {
      SessionPresence.confirmed => SessionDecision.askTheServer,
      SessionPresence.unverifiable =>
        hasLastKnownWorker ? SessionDecision.useLastKnown : SessionDecision.signedOut,
      SessionPresence.absent => SessionDecision.signedOut,
    };
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/auth`
Expected: PASS (all tests in the three files).

- [ ] **Step 5: Checkpoint**

Show `git status`. Stop for the user to commit ("feat: port worker eligibility, login failures and session gate").

---

### Task 4: The Terms text and the two gates

**Files:**
- Create: `lib/terms/attendance_terms.dart`, `lib/terms/terms_gates.dart`
- Test: `test/terms/attendance_terms_test.dart`, `test/terms/terms_gates_test.dart`

**Interfaces:**
- Produces: `class TermsClause { heading, english, tagalog }`; `class AttendanceTerms { static const version = '2026-09-v3'; static const title; static const clauses; static String canonicalText(); static String sha256Hex(); }`; `enum TermsDecision { mustAccept, alreadyAccepted }`, `TermsDecision decideTerms(Set<String> accepted, String current)`; `enum StartupDecision { ready, mustAccept, unavailable }`, `StartupDecision decideStartup({required Set<String>? acceptedVersions, required String? cachedVersion, required String currentVersion})` (null `acceptedVersions` = the server could not be asked).

- [ ] **Step 1: Write the failing tests**

`test/terms/attendance_terms_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/terms/attendance_terms.dart';

/// WorkMate shows the SAME Terms the Attendance app shows, so a worker who
/// accepted there is not asked again. The hash below is the live
/// agreement_events.doc_sha256 for version 2026-09-v3 (checked 2026-09-30).
/// If this fails, the wording drifted: do not "fix" the hash.
void main() {
  test('same version as the Attendance app', () {
    expect(AttendanceTerms.version, '2026-09-v3');
  });

  test('canonical text is byte-identical to what workers already accepted', () {
    expect(AttendanceTerms.canonicalText().length, 3079);
    expect(AttendanceTerms.sha256Hex(), '80bb9d44274b77de8a2d6e11609f1b07d6b73245a6366ed2807b9d981584fbd5');
  });

  test('seven numbered clauses, English then Tagalog', () {
    final text = AttendanceTerms.canonicalText();
    expect(AttendanceTerms.clauses.length, 7);
    expect(text, startsWith("DAC's Attendance -- Terms & Conditions\nVersion: 2026-09-v3\n\n1. Recording attendance. "));
    expect(text.endsWith('\n'), isFalse);
  });
}
```

`test/terms/terms_gates_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/terms/terms_gates.dart';

void main() {
  test('terms gate: current version accepted or not', () {
    expect(decideTerms({'2026-09-v3'}, '2026-09-v3'), TermsDecision.alreadyAccepted);
    expect(decideTerms({'2026-08-v2'}, '2026-09-v3'), TermsDecision.mustAccept);
  });

  group('startup gate', () {
    test('the server answer wins', () {
      expect(decideStartup(acceptedVersions: {'2026-09-v3'}, cachedVersion: null, currentVersion: '2026-09-v3'),
          StartupDecision.ready);
      // A cached acceptance the server does not have does not count.
      expect(decideStartup(acceptedVersions: <String>{}, cachedVersion: '2026-09-v3', currentVersion: '2026-09-v3'),
          StartupDecision.mustAccept);
    });

    test('offline falls back to what this device recorded', () {
      expect(decideStartup(acceptedVersions: null, cachedVersion: '2026-09-v3', currentVersion: '2026-09-v3'),
          StartupDecision.ready);
    });

    test('offline with nothing recorded never guesses "not accepted"', () {
      expect(decideStartup(acceptedVersions: null, cachedVersion: null, currentVersion: '2026-09-v3'),
          StartupDecision.unavailable);
      expect(decideStartup(acceptedVersions: null, cachedVersion: '2026-08-v2', currentVersion: '2026-09-v3'),
          StartupDecision.unavailable);
    });
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/terms`
Expected: FAIL, missing `package:workmate/terms/...` files.

- [ ] **Step 3: Implement**

`lib/terms/attendance_terms.dart`:

```dart
import 'dart:convert';

import 'package:crypto/crypto.dart';

class TermsClause {
  const TermsClause({required this.heading, required this.english, required this.tagalog});
  final String heading;
  final String english;
  final String tagalog;
}

/// The Terms a worker accepts on first sign-in. SHARED with the Attendance
/// app (domain/AttendanceTerms.kt): same wording, same version, so an
/// acceptance there counts here.
///
/// This text is EVIDENCE: accepting writes it, and its SHA-256, into the
/// append-only agreement_events table. CHANGING ANY CHARACTER REQUIRES A NEW
/// VERSION, agreed with the owner, and the same change in the Attendance app.
class AttendanceTerms {
  static const version = '2026-09-v3';

  static const title = "DAC's Attendance -- Terms & Conditions";

  static const clauses = <TermsClause>[
    TermsClause(
      heading: 'Recording attendance.',
      english: 'You record your own Time In and Time Out using this app. The date and time are set by the system, not typed by you.',
      tagalog: 'Ikaw mismo ang magta-Time In at Time Out. Ang petsa at oras ay galing sa sistema, hindi ito tina-type.',
    ),
    TermsClause(
      heading: 'Project selection.',
      english: 'You choose the project you are working on each time you time in and time out.',
      tagalog: 'Pipiliin mo ang project na pinagtatrabahuhan mo sa tuwing magta-Time In at Time Out ka.',
    ),
    TermsClause(
      heading: 'Photo documentation.',
      english: 'A photo is taken at Time In and at Time Out as proof of attendance and is stored with your record.',
      tagalog: 'May kukunang litrato tuwing Time In at Time Out bilang patunay ng pagpasok, at itatago ito kasama ng iyong record.',
    ),
    TermsClause(
      heading: 'Location check.',
      english: 'Your location is checked when you Time In and Time Out, to confirm you are at the project you selected. It is taken only at those two moments; the app does not follow you at any other time. If your phone cannot get a clear location, your attendance is still recorded and marked for the Admin to check. If it shows you are away from the site, or location is turned off, the attendance cannot be recorded.',
      tagalog: 'Titingnan ang lokasyon mo tuwing Time In at Time Out, para makumpirma na nasa project ka na iyong pinili. Sa dalawang sandaling iyon lang ito kinukuha; hindi ka sinusundan ng app sa ibang oras. Kung hindi makakuha ng malinaw na lokasyon ang telepono mo, maitatala pa rin ang pasok mo at mamarkahan para tingnan ng Admin. Kung malayo ka sa site ayon dito, o naka-off ang lokasyon, hindi maitatala ang pasok.',
    ),
    TermsClause(
      heading: 'Honest use.',
      english: 'Your account is yours alone. Do not let another person time in or out for you.',
      tagalog: 'Sa iyo lang ang account mo. Huwag hayaang may ibang tao ang mag-Time In o Time Out para sa iyo.',
    ),
    TermsClause(
      heading: 'Who can see your records.',
      english: 'Your attendance records, photos and location may be viewed by the Admin and the Owner to check attendance and site activity. These records are not used to compute your pay.',
      tagalog: 'Ang iyong mga record, litrato at lokasyon ay maaaring makita ng Admin at ng May-ari para tingnan ang pasok at ang trabaho sa site. Hindi ito ang batayan ng sahod mo.',
    ),
    TermsClause(
      heading: 'Weekly attendance reward.',
      english: 'The Owner may give a weekly attendance reward for a complete, on-time week. It is based on your Time In on each required day from Monday to Friday, compared against the start time set for your project: one late day, or one required day with no Time In, means no reward for that week, and there is no partial amount. Days the site is closed are not counted against you. This reward is separate from your pay and is not computed from your hours.',
      tagalog: 'Maaaring magbigay ang May-ari ng lingguhang reward para sa kumpleto at hindi nahuling pasok. Nakabatay ito sa Time In mo sa bawat araw na kailangan mula Lunes hanggang Biyernes, ayon sa oras ng simula na nakatakda para sa project mo: isang araw na late, o isang araw na walang Time In, ay walang reward para sa linggong iyon, at walang bahagyang halaga. Hindi bibilangin laban sa iyo ang mga araw na sarado ang site. Hiwalay ito sa sahod mo at hindi ito kinukuwenta mula sa oras mo.',
    ),
  ];

  /// The exact text hashed and stored. Built FROM [clauses], so the wording
  /// shown and the wording hashed cannot drift apart.
  static String canonicalText() {
    final b = StringBuffer()
      ..write(title)
      ..write('\n')
      ..write('Version: ')
      ..write(version)
      ..write('\n\n');
    for (var i = 0; i < clauses.length; i++) {
      final c = clauses[i];
      b
        ..write('${i + 1}. ${c.heading} ${c.english}\n')
        ..write('${c.tagalog}\n\n');
    }
    return b.toString().trimRight();
  }

  /// Lower-case hex, the format agreement_events.doc_sha256 holds.
  static String sha256Hex() => sha256.convert(utf8.encode(canonicalText())).toString();
}
```

`lib/terms/terms_gates.dart`:

```dart
enum TermsDecision { mustAccept, alreadyAccepted }

/// Whether a signed-in worker sees the Terms screen. Pure, so the one gate
/// between a worker and the app is provable without a network.
TermsDecision decideTerms(Set<String> accepted, String current) =>
    accepted.contains(current) ? TermsDecision.alreadyAccepted : TermsDecision.mustAccept;

enum StartupDecision { ready, mustAccept, unavailable }

/// What to show a worker who already has a session. Trust the server when it
/// answers; fall back to what this device recorded when it cannot be asked
/// ([acceptedVersions] is null); never guess "not accepted" offline, because
/// accepting again offline cannot be written anywhere.
StartupDecision decideStartup({
  required Set<String>? acceptedVersions,
  required String? cachedVersion,
  required String currentVersion,
}) {
  if (acceptedVersions != null) {
    return decideTerms(acceptedVersions, currentVersion) == TermsDecision.alreadyAccepted
        ? StartupDecision.ready
        : StartupDecision.mustAccept;
  }
  return cachedVersion == currentVersion ? StartupDecision.ready : StartupDecision.unavailable;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/terms`
Expected: PASS. If the hash test fails, compare the clause strings character by character with `domain/AttendanceTerms.kt`; never edit the expected hash.

- [ ] **Step 5: Checkpoint**

Show `git status`. Stop for the user to commit ("feat: share the Attendance Terms text and gates").

---

### Task 5: Device memory and the encrypted session store

**Files:**
- Create: `lib/auth/worker_cache.dart`, `lib/auth/session_storage.dart`
- Test: `test/auth/worker_cache_test.dart`, `test/auth/session_storage_test.dart`

**Interfaces:**
- Consumes: `WorkerProfile` (Task 3).
- Produces:
  - `class WorkerCache { WorkerCache(SharedPreferences); String? get lastSignedInId; Future<void> remember(WorkerProfile); WorkerProfile? recall(String id); String? acceptedTermsVersion(String id); Future<void> recordTermsAccepted(String id, String version); Future<void> forget(String id); }`
  - `abstract class SecretBox { Future<String?> read(String key); Future<void> write(String key, String value); Future<void> delete(String key); }`, `class SecureBox implements SecretBox`
  - `class WorkMateSessionStorage extends LocalStorage { WorkMateSessionStorage({required SecretBox secure, required SharedPreferences plain}); }` (supabase_flutter's `LocalStorage`)

- [ ] **Step 1: Write the failing tests**

`test/auth/worker_cache_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/auth/worker_cache.dart';
import 'package:workmate/auth/worker_profile.dart';

void main() {
  const juan = WorkerProfile(id: 'u1', email: 'juan@x.com', displayName: 'Juan dela Cruz', role: 'worker', status: 'active', workerNo: 42);

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('remembers who signed in and their profile', () async {
    final cache = WorkerCache(await SharedPreferences.getInstance());
    await cache.remember(juan);
    expect(cache.lastSignedInId, 'u1');
    expect(cache.recall('u1')!.toRow(), juan.toRow());
  });

  test('records the Terms version this device saw accepted', () async {
    final cache = WorkerCache(await SharedPreferences.getInstance());
    await cache.recordTermsAccepted('u1', '2026-09-v3');
    expect(cache.acceptedTermsVersion('u1'), '2026-09-v3');
  });

  test('forget clears everything about that worker (shared site phones)', () async {
    final cache = WorkerCache(await SharedPreferences.getInstance());
    await cache.remember(juan);
    await cache.recordTermsAccepted('u1', '2026-09-v3');
    await cache.forget('u1');
    expect(cache.lastSignedInId, isNull);
    expect(cache.recall('u1'), isNull);
    expect(cache.acceptedTermsVersion('u1'), isNull);
  });
}
```

`test/auth/session_storage_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/auth/session_storage.dart';

/// A keystore that fails its first [failures] calls, like cheap phones do
/// right after boot.
class FlakyBox implements SecretBox {
  FlakyBox({this.failures = 0});
  int failures;
  final data = <String, String>{};
  void _maybeFail() {
    if (failures > 0) {
      failures--;
      throw Exception('keystore busy');
    }
  }

  @override
  Future<String?> read(String key) async { _maybeFail(); return data[key]; }
  @override
  Future<void> write(String key, String value) async { _maybeFail(); data[key] = value; }
  @override
  Future<void> delete(String key) async { _maybeFail(); data.remove(key); }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('persists and restores the session', () async {
    final box = FlakyBox();
    final s = WorkMateSessionStorage(secure: box, plain: await SharedPreferences.getInstance());
    await s.persistSession('{"s":1}');
    expect(await s.hasAccessToken(), isTrue);
    expect(await s.accessToken(), '{"s":1}');
  });

  test('one keystore hiccup does NOT sign the worker out', () async {
    final box = FlakyBox()..data[WorkMateSessionStorage.key] = '{"s":1}';
    box.failures = 1;
    final s = WorkMateSessionStorage(secure: box, plain: await SharedPreferences.getInstance());
    expect(await s.accessToken(), '{"s":1}');
    expect(box.data.containsKey(WorkMateSessionStorage.key), isTrue);
  });

  test('a store unreadable twice is treated as corrupt: session gone, no crash', () async {
    final box = FlakyBox()..data[WorkMateSessionStorage.key] = '{"s":1}';
    box.failures = 2;
    final s = WorkMateSessionStorage(secure: box, plain: await SharedPreferences.getInstance());
    expect(await s.accessToken(), isNull);
  });

  test('a keystore that cannot write degrades to app-private storage instead of losing sign-in', () async {
    final box = FlakyBox(failures: 99);
    final prefs = await SharedPreferences.getInstance();
    final s = WorkMateSessionStorage(secure: box, plain: prefs);
    await s.persistSession('{"s":2}');
    expect(await s.accessToken(), '{"s":2}');
  });

  test('remove clears both stores', () async {
    final box = FlakyBox(failures: 99);
    final s = WorkMateSessionStorage(secure: box, plain: await SharedPreferences.getInstance());
    await s.persistSession('{"s":2}');
    box.failures = 0;
    await s.removePersistedSession();
    expect(await s.hasAccessToken(), isFalse);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/auth/worker_cache_test.dart test/auth/session_storage_test.dart`
Expected: FAIL, missing files.

- [ ] **Step 3: Implement**

`lib/auth/worker_cache.dart`:

```dart
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'worker_profile.dart';

/// What this device witnessed: who signed in, their profile, and the Terms
/// version it saw them accept. Offline, the auth client can report nobody
/// for a session it holds; this is what keeps a worker signed in on a
/// no-signal site. Set at sign-in, cleared at sign-out, nowhere else.
class WorkerCache {
  WorkerCache(this._prefs);

  final SharedPreferences _prefs;

  static const _lastKey = 'last_signed_in_id';
  static String _profileKey(String id) => 'worker.$id';
  static String _termsKey(String id) => 'terms.$id';

  String? get lastSignedInId => _prefs.getString(_lastKey);

  Future<void> remember(WorkerProfile worker) async {
    await _prefs.setString(_lastKey, worker.id);
    await _prefs.setString(_profileKey(worker.id), jsonEncode(worker.toRow()));
  }

  WorkerProfile? recall(String id) {
    final raw = _prefs.getString(_profileKey(id));
    return raw == null ? null : WorkerProfile.fromRow(jsonDecode(raw) as Map<String, dynamic>);
  }

  String? acceptedTermsVersion(String id) => _prefs.getString(_termsKey(id));

  Future<void> recordTermsAccepted(String id, String version) => _prefs.setString(_termsKey(id), version);

  /// Site phones are shared: nothing about a worker outlives their sign-out.
  Future<void> forget(String id) async {
    await _prefs.remove(_profileKey(id));
    await _prefs.remove(_termsKey(id));
    if (lastSignedInId == id) await _prefs.remove(_lastKey);
  }
}
```

`lib/auth/session_storage.dart`:

```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

abstract class SecretBox {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Android keystore-backed storage. resetOnError is OFF: the library's
/// default wipes everything on the first error, and on these phones the
/// first error is usually a keystore that is busy just after boot.
class SecureBox implements SecretBox {
  static const _storage = FlutterSecureStorage(aOptions: AndroidOptions(resetOnError: false));

  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// supabase_flutter's session store: holds the REFRESH TOKEN, so losing it
/// is a silent sign-out. Same rules as the Attendance app's store:
/// retry a failed read before deciding anything; only a store unreadable
/// twice is treated as corrupt; a keystore that cannot write at all
/// degrades to app-private storage rather than locking the worker out.
class WorkMateSessionStorage extends LocalStorage {
  WorkMateSessionStorage({required this.secure, required this.plain});

  final SecretBox secure;
  final SharedPreferences plain;

  static const key = 'workmate_session';
  static const _plainFlag = 'workmate_session_plain';

  bool get _degraded => plain.getBool(_plainFlag) ?? false;

  @override
  Future<void> initialize() async {}

  Future<String?> _read() async {
    if (_degraded) return plain.getString(key);
    try {
      return await secure.read(key);
    } catch (_) {
      try {
        return await secure.read(key);
      } catch (_) {
        try {
          await secure.delete(key);
        } catch (_) {}
        return null;
      }
    }
  }

  @override
  Future<bool> hasAccessToken() async => (await _read()) != null;

  @override
  Future<String?> accessToken() => _read();

  @override
  Future<void> persistSession(String persistSessionString) async {
    if (!_degraded) {
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          await secure.write(key, persistSessionString);
          return;
        } catch (_) {}
      }
      await plain.setBool(_plainFlag, true);
    }
    await plain.setString(key, persistSessionString);
  }

  @override
  Future<void> removePersistedSession() async {
    await plain.remove(key);
    await plain.remove(_plainFlag);
    try {
      await secure.delete(key);
    } catch (_) {}
  }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/auth/worker_cache_test.dart test/auth/session_storage_test.dart`
Expected: PASS (8 tests).

- [ ] **Step 5: Checkpoint**

Show `git status`. Stop for the user to commit ("feat: device memory and encrypted session store").

---

### Task 6: Sign-in, sign-out and "who is signed in"

**Files:**
- Create: `lib/auth/sign_in_api.dart`, `lib/auth/auth_backend.dart`, `lib/auth/auth_repository.dart`
- Test: `test/auth/sign_in_api_test.dart`, `test/auth/auth_repository_test.dart`

**Interfaces:**
- Consumes: `WorkerProfile`, `LoginFailure`, `SessionPresence`/`decideSession` (Task 3); `WorkerCache`, `LocalStorage` impl (Task 5); `AppConfig` (Task 2).
- Produces:
  - `sealed class SignInOutcome`; `class SignInSuccess extends SignInOutcome { String accessToken, refreshToken; WorkerProfile worker; }`; `class SignInRefused extends SignInOutcome { String? code; }`; `class SignInApi { SignInApi(http.Client); Future<SignInOutcome> signIn(String email, String password); }`
  - `abstract class AuthBackend { Future<void> adopt({required String accessToken, required String refreshToken}); Future<SessionPresence> presence(); String? get currentUserId; Future<Map<String, dynamic>?> readProfile(String userId); Future<void> signOut(); }`; `class SupabaseAuthBackend implements AuthBackend { SupabaseAuthBackend(SupabaseClient, LocalStorage); }`
  - `class LoginRejected implements Exception { final LoginFailure failure; }`; `class AuthRepository { AuthRepository({required SignInApi api, required AuthBackend backend, required WorkerCache cache}); Future<WorkerProfile> signIn(String email, String password); Future<void> signOut(); Future<WorkerProfile?> currentWorker(); }`

- [ ] **Step 1: Write the failing tests**

`test/auth/sign_in_api_test.dart`:

```dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:workmate/auth/sign_in_api.dart';

void main() {
  test('posts to attendance-signin with the anon key and returns the session', () async {
    late http.Request seen;
    final api = SignInApi(MockClient((req) async {
      seen = req;
      return http.Response(jsonEncode({
        'session': {'access_token': 'A', 'refresh_token': 'R', 'expires_in': 3600, 'token_type': 'bearer'},
        'worker': {'id': 'u1', 'email': 'juan@x.com', 'role': 'worker', 'status': 'active'},
      }), 200);
    }));
    final out = await api.signIn('juan@x.com', 'pw');
    expect(seen.url.toString(), 'https://hqbgduyonlbbsvjuapre.supabase.co/functions/v1/attendance-signin');
    expect(seen.headers['apikey'], isNotEmpty);
    expect(jsonDecode(seen.body), {'email': 'juan@x.com', 'password': 'pw'});
    expect(out, isA<SignInSuccess>());
    final ok = out as SignInSuccess;
    expect(ok.accessToken, 'A');
    expect(ok.refreshToken, 'R');
    expect(ok.worker.id, 'u1');
  });

  test('a refusal carries the function\'s code', () async {
    final api = SignInApi(MockClient((_) async => http.Response('{"error":"ACCOUNT_INACTIVE"}', 403)));
    final out = await api.signIn('a', 'b');
    expect((out as SignInRefused).code, 'ACCOUNT_INACTIVE');
  });

  test('an unreadable refusal is still a refusal, with no code', () async {
    final api = SignInApi(MockClient((_) async => http.Response('<html>502</html>', 502)));
    expect((await api.signIn('a', 'b') as SignInRefused).code, isNull);
  });
}
```

`test/auth/auth_repository_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/auth/auth_backend.dart';
import 'package:workmate/auth/auth_repository.dart';
import 'package:workmate/auth/login_failure.dart';
import 'package:workmate/auth/session_gate.dart';
import 'package:workmate/auth/sign_in_api.dart';
import 'package:workmate/auth/worker_cache.dart';

class FakeBackend implements AuthBackend {
  SessionPresence presenceValue = SessionPresence.absent;
  String? userId;
  Map<String, dynamic>? profileRow;
  Object? profileError;
  Object? adoptError;
  bool signedOut = false;
  String? adoptedRefresh;

  @override
  Future<void> adopt({required String accessToken, required String refreshToken}) async {
    if (adoptError != null) throw adoptError!;
    adoptedRefresh = refreshToken;
  }

  @override
  Future<SessionPresence> presence() async => presenceValue;
  @override
  String? get currentUserId => userId;
  @override
  Future<Map<String, dynamic>?> readProfile(String userId) async {
    if (profileError != null) throw profileError!;
    return profileRow;
  }

  @override
  Future<void> signOut() async => signedOut = true;
}

SignInApi apiReturning(int status, String body) => SignInApi(MockClient((_) async => http.Response(body, status)));

const okBody = '{"session":{"access_token":"A","refresh_token":"R","expires_in":3600},'
    '"worker":{"id":"u1","display_name":"Juan dela Cruz","role":"worker","status":"active"}}';

void main() {
  late WorkerCache cache;
  late FakeBackend backend;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    cache = WorkerCache(await SharedPreferences.getInstance());
    backend = FakeBackend();
  });

  group('signIn', () {
    test('empty fields never reach the server', () async {
      final repo = AuthRepository(api: apiReturning(500, ''), backend: backend, cache: cache);
      expect(() => repo.signIn(' ', 'x'),
          throwsA(isA<LoginRejected>().having((e) => e.failure, 'failure', LoginFailure.missingFields)));
    });

    test('success adopts the session and remembers the worker for the first offline launch', () async {
      final repo = AuthRepository(api: apiReturning(200, okBody), backend: backend, cache: cache);
      final w = await repo.signIn('juan@x.com', 'pw');
      expect(w.id, 'u1');
      expect(backend.adoptedRefresh, 'R');
      expect(cache.lastSignedInId, 'u1');
    });

    test('a refusal code becomes its message', () async {
      final repo = AuthRepository(api: apiReturning(401, '{"error":"INVALID_CREDENTIALS"}'), backend: backend, cache: cache);
      expect(() => repo.signIn('a@b.c', 'x'),
          throwsA(isA<LoginRejected>().having((e) => e.failure, 'failure', LoginFailure.wrongCredentials)));
    });

    test('no signal is reported as no signal', () async {
      final repo = AuthRepository(
          api: SignInApi(MockClient((_) async => throw const SocketException('down'))), backend: backend, cache: cache);
      expect(() => repo.signIn('a@b.c', 'x'),
          throwsA(isA<LoginRejected>().having((e) => e.failure, 'failure', LoginFailure.noConnection)));
    });
  });

  group('currentWorker', () {
    test('confirmed session: the server row wins and is cached', () async {
      backend
        ..presenceValue = SessionPresence.confirmed
        ..userId = 'u1'
        ..profileRow = {'id': 'u1', 'role': 'worker', 'status': 'inactive'};
      final repo = AuthRepository(api: apiReturning(500, ''), backend: backend, cache: cache);
      final w = await repo.currentWorker();
      expect(w!.status, 'inactive');
      expect(cache.recall('u1')!.status, 'inactive');
    });

    test('confirmed session but the read fails (no signal): last known profile', () async {
      await cache.remember(const WorkerProfileForTest().profile);
      backend
        ..presenceValue = SessionPresence.confirmed
        ..userId = 'u1'
        ..profileError = const SocketException('down');
      final repo = AuthRepository(api: apiReturning(500, ''), backend: backend, cache: cache);
      expect((await repo.currentWorker())!.id, 'u1');
    });

    test('unverifiable session: last known profile, no read made', () async {
      await cache.remember(const WorkerProfileForTest().profile);
      backend
        ..presenceValue = SessionPresence.unverifiable
        ..profileError = StateError('must not read without a session');
      final repo = AuthRepository(api: apiReturning(500, ''), backend: backend, cache: cache);
      expect((await repo.currentWorker())!.id, 'u1');
    });

    test('no session: signed out even with a cached profile', () async {
      await cache.remember(const WorkerProfileForTest().profile);
      backend.presenceValue = SessionPresence.absent;
      final repo = AuthRepository(api: apiReturning(500, ''), backend: backend, cache: cache);
      expect(await repo.currentWorker(), isNull);
    });
  });

  test('signOut forgets the worker BEFORE the session goes', () async {
    await cache.remember(const WorkerProfileForTest().profile);
    backend.userId = null; // offline: the client reports nobody
    final repo = AuthRepository(api: apiReturning(500, ''), backend: backend, cache: cache);
    await repo.signOut();
    expect(cache.lastSignedInId, isNull);
    expect(cache.recall('u1'), isNull);
    expect(backend.signedOut, isTrue);
  });
}
```

Add this helper at the bottom of the same test file:

```dart
class WorkerProfileForTest {
  const WorkerProfileForTest();
  WorkerProfile get profile => const WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', role: 'worker', status: 'active');
}
```

and add `import 'package:workmate/auth/worker_profile.dart';` to its imports.

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/auth/sign_in_api_test.dart test/auth/auth_repository_test.dart`
Expected: FAIL, missing files.

- [ ] **Step 3: Implement**

`lib/auth/sign_in_api.dart`:

```dart
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import 'worker_profile.dart';

sealed class SignInOutcome {}

class SignInSuccess extends SignInOutcome {
  SignInSuccess({required this.accessToken, required this.refreshToken, required this.worker});
  final String accessToken;
  final String refreshToken;
  final WorkerProfile worker;
}

class SignInRefused extends SignInOutcome {
  SignInRefused(this.code);
  final String? code;
}

/// Sign-in through the `attendance-signin` Edge Function. Turnstile guards
/// the auth endpoint and has no native Android SDK; the function signs in
/// with the service role and refuses non-workers before any token exists.
class SignInApi {
  SignInApi(this._http);

  final http.Client _http;

  Future<SignInOutcome> signIn(String email, String password) async {
    final response = await _http
        .post(
          Uri.parse(AppConfig.signInFunctionUrl),
          headers: {
            'apikey': AppConfig.supabaseAnonKey,
            'Authorization': 'Bearer ${AppConfig.supabaseAnonKey}',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'email': email, 'password': password}),
        )
        // A worker in the sun needs "no signal" quickly, not a spinner.
        .timeout(const Duration(seconds: 20));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final session = body['session'] as Map<String, dynamic>;
      return SignInSuccess(
        accessToken: session['access_token'] as String,
        refreshToken: session['refresh_token'] as String,
        worker: WorkerProfile.fromRow(body['worker'] as Map<String, dynamic>),
      );
    }
    // A body we cannot parse is still a refusal, never a network problem.
    String? code;
    try {
      code = (jsonDecode(response.body) as Map<String, dynamic>)['error'] as String?;
    } catch (_) {}
    return SignInRefused(code);
  }
}
```

`lib/auth/auth_backend.dart`:

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

import 'session_gate.dart';
import 'worker_profile.dart';

/// The parts of Supabase auth the app relies on, behind an interface so the
/// sign-in and startup rules test without a server.
abstract class AuthBackend {
  /// Make the session from attendance-signin the client's own.
  Future<void> adopt({required String accessToken, required String refreshToken});

  Future<SessionPresence> presence();

  String? get currentUserId;

  /// The worker's profiles row, read AS the worker. Throws when it cannot be
  /// asked (no session, no signal); returns null only for "no such row".
  Future<Map<String, dynamic>?> readProfile(String userId);

  Future<void> signOut();
}

class SupabaseAuthBackend implements AuthBackend {
  SupabaseAuthBackend(this._client, this._storage);

  final SupabaseClient _client;
  final LocalStorage _storage;

  @override
  Future<void> adopt({required String accessToken, required String refreshToken}) async {
    // With an access token this validates it (one getUser call) and keeps
    // the pair; it only refreshes when the token is already expired.
    await _client.auth.setSession(refreshToken, accessToken: accessToken);
  }

  @override
  Future<SessionPresence> presence() async {
    final session = _client.auth.currentSession;
    if (session != null && !session.isExpired) return SessionPresence.confirmed;
    // Offline with an expired access token, gotrue cannot refresh and leaves
    // currentSession null, but the refresh token is still stored. That is a
    // session we cannot check right now, not a sign-out.
    if (session != null || await _storage.hasAccessToken()) return SessionPresence.unverifiable;
    return SessionPresence.absent;
  }

  @override
  String? get currentUserId => _client.auth.currentUser?.id;

  @override
  Future<Map<String, dynamic>?> readProfile(String userId) async {
    // Without a session the client would send the anon key and RLS would
    // answer "no rows" -- a lie that looks like a missing worker.
    if (_client.auth.currentSession == null) throw StateError('No session to read the profile with');
    return _client.from('profiles').select(WorkerProfile.columns).eq('id', userId).maybeSingle();
  }

  @override
  Future<void> signOut() async {
    try {
      // gotrue clears the local session first, then calls the server; offline
      // the server call throws, which must not keep the worker signed in.
      await _client.auth.signOut();
    } catch (_) {}
    await _storage.removePersistedSession();
  }
}
```

`lib/auth/auth_repository.dart`:

```dart
import 'auth_backend.dart';
import 'login_failure.dart';
import 'session_gate.dart';
import 'sign_in_api.dart';
import 'worker_cache.dart';
import 'worker_profile.dart';

class LoginRejected implements Exception {
  LoginRejected(this.failure);
  final LoginFailure failure;
  @override
  String toString() => 'LoginRejected(${failure.name})';
}

class AuthRepository {
  AuthRepository({required this.api, required this.backend, required this.cache});

  final SignInApi api;
  final AuthBackend backend;
  final WorkerCache cache;

  /// The function checks credentials AND eligibility before any token
  /// exists, so a success is always an active worker.
  Future<WorkerProfile> signIn(String email, String password) async {
    final trimmed = email.trim();
    if (trimmed.isEmpty || password.isEmpty) throw LoginRejected(LoginFailure.missingFields);

    final SignInOutcome outcome;
    try {
      outcome = await api.signIn(trimmed, password);
    } catch (e) {
      throw LoginRejected(LoginFailure.of(e));
    }

    switch (outcome) {
      case SignInRefused(:final code):
        throw LoginRejected(LoginFailure.forCode(code));
      case SignInSuccess():
        try {
          await backend.adopt(accessToken: outcome.accessToken, refreshToken: outcome.refreshToken);
        } catch (e) {
          throw LoginRejected(LoginFailure.of(e));
        }
        // Cached here: sign-in is the one moment there is surely signal, and
        // the FIRST offline launch needs this to not land on the login screen.
        await cache.remember(outcome.worker);
        return outcome.worker;
    }
  }

  /// Forgets the worker BEFORE the session goes, while the id is readable.
  /// Offline the client reports nobody, so the cached id is the fallback.
  Future<void> signOut() async {
    final id = backend.currentUserId ?? cache.lastSignedInId;
    if (id != null) await cache.forget(id);
    await backend.signOut();
  }

  /// Who is signed in: the server's answer when it can be asked as the
  /// worker, otherwise the last profile this device saw, otherwise nobody.
  Future<WorkerProfile?> currentWorker() async {
    final lastId = cache.lastSignedInId;
    final decision = decideSession(await backend.presence(), hasLastKnownWorker: lastId != null);
    switch (decision) {
      case SessionDecision.askTheServer:
        final id = backend.currentUserId ?? lastId;
        if (id == null) return null;
        try {
          final row = await backend.readProfile(id);
          if (row == null) return null;
          final worker = WorkerProfile.fromRow(row);
          await cache.remember(worker);
          return worker;
        } catch (_) {
          // No signal, or a token the server rejects while the client still
          // believes in it (a phone with a badly wrong clock): not a sign-out.
          return cache.recall(id);
        }
      case SessionDecision.useLastKnown:
        return lastId == null ? null : cache.recall(lastId);
      case SessionDecision.signedOut:
        return null;
    }
  }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `flutter test test/auth`
Expected: PASS (all auth tests).

- [ ] **Step 5: Checkpoint**

Show `git status`. Stop for the user to commit ("feat: sign in through attendance-signin and keep workers signed in offline").

---

### Task 7: Accepting the Terms and the startup decision

**Files:**
- Create: `lib/terms/terms_repository.dart`
- Test: `test/terms/terms_repository_test.dart`

**Interfaces:**
- Consumes: `AttendanceTerms`, `decideStartup`, `StartupDecision` (Task 4); `WorkerCache` (Task 5); `WorkerProfile` (Task 3).
- Produces: `abstract class TermsBackend { Future<Set<String>> acceptedVersions(String workerId); Future<void> insertEvidence(Map<String, dynamic> row); Future<void> insertAcceptance(Map<String, dynamic> row); }`; `class SupabaseTermsBackend implements TermsBackend { SupabaseTermsBackend(SupabaseClient); }`; `class TermsRepository { TermsRepository({required TermsBackend backend, required WorkerCache cache, required String userAgent}); Future<StartupDecision> startupDecision(WorkerProfile); Future<void> accept(WorkerProfile); }`; `bool isUniqueViolation(Object error)`.

- [ ] **Step 1: Write the failing test**

`test/terms/terms_repository_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:workmate/auth/worker_cache.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/terms/attendance_terms.dart';
import 'package:workmate/terms/terms_gates.dart';
import 'package:workmate/terms/terms_repository.dart';

class FakeTermsBackend implements TermsBackend {
  Set<String>? versions;
  Object? readError;
  Object? acceptanceError;
  final calls = <String>[];
  Map<String, dynamic>? evidence;

  @override
  Future<Set<String>> acceptedVersions(String workerId) async {
    if (readError != null) throw readError!;
    return versions ?? {};
  }

  @override
  Future<void> insertEvidence(Map<String, dynamic> row) async {
    calls.add('evidence');
    evidence = row;
  }

  @override
  Future<void> insertAcceptance(Map<String, dynamic> row) async {
    calls.add('acceptance');
    if (acceptanceError != null) throw acceptanceError!;
  }
}

void main() {
  const juan = WorkerProfile(id: 'u1', email: 'juan@x.com', role: 'worker');
  late WorkerCache cache;
  late FakeTermsBackend backend;
  late TermsRepository repo;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    cache = WorkerCache(await SharedPreferences.getInstance());
    backend = FakeTermsBackend();
    repo = TermsRepository(backend: backend, cache: cache, userAgent: 'DacsWorkMate/0.1.0 (Android 14; X Y)');
  });

  test('accepted on the server (e.g. in the Attendance app): ready, and remembered', () async {
    backend.versions = {'2026-09-v3'};
    expect(await repo.startupDecision(juan), StartupDecision.ready);
    expect(cache.acceptedTermsVersion('u1'), '2026-09-v3');
  });

  test('offline and never recorded here: unavailable, not "must accept"', () async {
    backend.readError = Exception('no signal');
    expect(await repo.startupDecision(juan), StartupDecision.unavailable);
  });

  test('accept writes the evidence FIRST, then the flag, then remembers', () async {
    await repo.accept(juan);
    expect(backend.calls, ['evidence', 'acceptance']);
    expect(backend.evidence, {
      'user_id': 'u1',
      'email': 'juan@x.com',
      'audience': 'worker',
      'doc_type': 'attendance_terms',
      'doc_title': AttendanceTerms.title,
      'doc_sha256': AttendanceTerms.sha256Hex(),
      'doc_text': AttendanceTerms.canonicalText(),
      'user_agent': 'DacsWorkMate/0.1.0 (Android 14; X Y)',
    });
    expect(cache.acceptedTermsVersion('u1'), '2026-09-v3');
  });

  test('a duplicate acceptance (retry after a dropped response) is success', () async {
    backend.acceptanceError = const PostgrestException(message: 'duplicate key value', code: '23505');
    await repo.accept(juan);
    expect(cache.acceptedTermsVersion('u1'), '2026-09-v3');
  });

  test('any other acceptance failure is reported and nothing is remembered', () async {
    backend.acceptanceError = Exception('network');
    await expectLater(repo.accept(juan), throwsException);
    expect(cache.acceptedTermsVersion('u1'), isNull);
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `flutter test test/terms/terms_repository_test.dart`
Expected: FAIL, missing `terms_repository.dart`.

- [ ] **Step 3: Implement**

`lib/terms/terms_repository.dart`:

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

import '../auth/worker_cache.dart';
import '../auth/worker_profile.dart';
import 'attendance_terms.dart';
import 'terms_gates.dart';

abstract class TermsBackend {
  /// Throws when it cannot be asked. Never returns an empty set for
  /// "could not ask": that would send an accepted worker back to the Terms.
  Future<Set<String>> acceptedVersions(String workerId);
  Future<void> insertEvidence(Map<String, dynamic> row);
  Future<void> insertAcceptance(Map<String, dynamic> row);
}

class SupabaseTermsBackend implements TermsBackend {
  SupabaseTermsBackend(this._client);

  final SupabaseClient _client;

  @override
  Future<Set<String>> acceptedVersions(String workerId) async {
    // Rows are readable only by their worker. Asked without a session, RLS
    // returns none and that looks like "never accepted" -- so refuse.
    if (_client.auth.currentSession == null) throw StateError('No session to read the Terms acceptance with');
    final rows = await _client.from('attendance_terms_acceptances').select('terms_version').eq('worker_id', workerId);
    return rows.map((r) => r['terms_version'] as String).toSet();
  }

  @override
  Future<void> insertEvidence(Map<String, dynamic> row) => _client.from('agreement_events').insert(row);

  @override
  Future<void> insertAcceptance(Map<String, dynamic> row) => _client.from('attendance_terms_acceptances').insert(row);
}

bool isUniqueViolation(Object error) {
  if (error is PostgrestException && error.code == '23505') return true;
  final text = error.toString().toLowerCase();
  return text.contains('23505') || text.contains('duplicate key');
}

class TermsRepository {
  TermsRepository({required this.backend, required this.cache, required this.userAgent});

  final TermsBackend backend;
  final WorkerCache cache;
  final String userAgent;

  Future<StartupDecision> startupDecision(WorkerProfile worker) async {
    Set<String>? versions;
    try {
      versions = await backend.acceptedVersions(worker.id);
    } catch (_) {
      versions = null;
    }
    if (versions != null && versions.contains(AttendanceTerms.version)) {
      await cache.recordTermsAccepted(worker.id, AttendanceTerms.version);
    }
    return decideStartup(
      acceptedVersions: versions,
      cachedVersion: cache.acceptedTermsVersion(worker.id),
      currentVersion: AttendanceTerms.version,
    );
  }

  /// Evidence FIRST (agreement_events, append-only), then the flag the gate
  /// reads. A failure in between costs a harmless duplicate evidence row;
  /// the other order could mark a worker accepted with no record of what.
  Future<void> accept(WorkerProfile worker) async {
    await backend.insertEvidence({
      'user_id': worker.id,
      'email': worker.email,
      'audience': 'worker',
      'doc_type': 'attendance_terms',
      'doc_title': AttendanceTerms.title,
      'doc_sha256': AttendanceTerms.sha256Hex(),
      'doc_text': AttendanceTerms.canonicalText(),
      'user_agent': userAgent,
    });
    try {
      await backend.insertAcceptance({'worker_id': worker.id, 'terms_version': AttendanceTerms.version});
    } catch (e) {
      if (!isUniqueViolation(e)) rethrow;
    }
    await cache.recordTermsAccepted(worker.id, AttendanceTerms.version);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `flutter test test/terms`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Show `git status`. Stop for the user to commit ("feat: Terms acceptance with evidence first").

---

### Task 8: The in-app updater on the WorkMate stream

**Files:**
- Create: `lib/update/app_release.dart`, `lib/update/app_update_repository.dart`, `lib/update/apk_installer.dart`, `android/app/src/main/kotlin/com/dacs/workmate/MainActivity.kt` (replace the generated one)
- Test: `test/update/app_release_test.dart`, `test/update/app_update_repository_test.dart`

**Interfaces:**
- Consumes: `AppConfig` (Task 2), `UpdateNudges` (Task 2).
- Produces:
  - `class AppRelease { int versionCode; String versionName; String? releaseNotes; String downloadUrl; int sizeBytes; String sha256; factory AppRelease.fromRow(Map<String, dynamic>); factory AppRelease.fromJson(Map<String, dynamic>); Map<String, dynamic> toJson(); }`
  - `AppRelease? requiredRelease({required int installedVersionCode, required bool fetchedOk, required AppRelease? fetched, required AppRelease? cached})`
  - `enum CopyResult { verified, wrongSize, wrongHash }`, `Future<CopyResult> copyVerifying(Stream<List<int>> input, IOSink output, {required int expectedSize, required String expectedSha256, void Function(double)? onProgress})`
  - `enum UpdateFailure { downloadFailed, fileDamaged }` with `english`/`tagalog`; `sealed class DownloadResult`, `DownloadReady(File file)`, `DownloadFailed(UpdateFailure reason)`
  - `abstract class ReleaseSource { Future<Map<String, dynamic>?> latestWorkMate(); }`, `class SupabaseReleaseSource implements ReleaseSource`
  - `class AppUpdateRepository { AppUpdateRepository({required ReleaseSource source, required SharedPreferences prefs, required int installedVersionCode, required http.Client download, required Future<Directory> Function() cacheDir}); Future<AppRelease?> requiredRelease(); Future<DownloadResult> download(AppRelease, void Function(double) onProgress); Future<void> discardDownloads(); }`
  - `abstract class InstallGateway { Future<bool> canInstall(); Future<void> openInstallPermission(); Future<void> install(File apk); }`, `class ApkInstaller implements InstallGateway`

- [ ] **Step 1: Write the failing tests**

`test/update/app_release_test.dart`:

```dart
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/update/app_release.dart';

AppRelease rel(int code) => AppRelease(
    versionCode: code, versionName: 'v$code', releaseNotes: null,
    downloadUrl: 'https://x/$code.apk', sizeBytes: 3, sha256: 'x');

void main() {
  group('requiredRelease', () {
    test('a newer published build is required', () {
      expect(requiredRelease(installedVersionCode: 1000, fetchedOk: true, fetched: rel(1001), cached: null)!.versionCode, 1001);
    });
    test('the same or older build is not', () {
      expect(requiredRelease(installedVersionCode: 1001, fetchedOk: true, fetched: rel(1001), cached: null), isNull);
    });
    test('the server answer beats a stale cache', () {
      expect(requiredRelease(installedVersionCode: 1001, fetchedOk: true, fetched: null, cached: rel(1002)), isNull);
    });
    test('offline, the cache keeps the update screen up', () {
      expect(requiredRelease(installedVersionCode: 1000, fetchedOk: false, fetched: null, cached: rel(1001))!.versionCode, 1001);
    });
    test('offline with no cache never blocks the worker', () {
      expect(requiredRelease(installedVersionCode: 1000, fetchedOk: false, fetched: null, cached: null), isNull);
    });
  });

  test('fromRow builds the public download URL from storage_path', () {
    final r = AppRelease.fromRow({
      'version_code': 1001, 'version_name': '0.1.1', 'release_notes': '  ',
      'storage_path': 'workmate/1001.apk', 'size_bytes': 123, 'sha256': 'ab',
    });
    expect(r.downloadUrl, 'https://hqbgduyonlbbsvjuapre.supabase.co/storage/v1/object/public/app-releases/workmate/1001.apk');
    expect(r.releaseNotes, isNull);
    expect(AppRelease.fromJson(r.toJson()).toJson(), r.toJson());
  });

  group('copyVerifying', () {
    final bytes = utf8.encode('hello apk');
    final good = sha256.convert(bytes).toString();

    Future<CopyResult> run(List<List<int>> chunks, int size, String hash) async {
      final dir = await Directory.systemTemp.createTemp('wm');
      final sink = File('${dir.path}/a.part').openWrite();
      final r = await copyVerifying(Stream.fromIterable(chunks), sink, expectedSize: size, expectedSha256: hash);
      await sink.close();
      await dir.delete(recursive: true);
      return r;
    }

    test('exact size and hash is verified', () async {
      expect(await run([bytes.sublist(0, 4), bytes.sublist(4)], bytes.length, good), CopyResult.verified);
    });
    test('a cut-off download is the wrong size', () async {
      expect(await run([bytes.sublist(0, 4)], bytes.length, good), CopyResult.wrongSize);
    });
    test('a longer download stops early as the wrong size', () async {
      expect(await run([bytes, bytes], bytes.length, good), CopyResult.wrongSize);
    });
    test('a swapped file is the wrong hash', () async {
      expect(await run([bytes], bytes.length, '0' * 64), CopyResult.wrongHash);
    });
  });
}
```

`test/update/app_update_repository_test.dart`:

```dart
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/update/app_release.dart';
import 'package:workmate/update/app_update_repository.dart';

class FakeSource implements ReleaseSource {
  FakeSource(this.row, {this.error});
  Map<String, dynamic>? row;
  Object? error;
  @override
  Future<Map<String, dynamic>?> latestWorkMate() async {
    if (error != null) throw error!;
    return row;
  }
}

Map<String, dynamic> row(int code, List<int> bytes) => {
      'version_code': code, 'version_name': '0.1.$code', 'release_notes': 'Fixes',
      'storage_path': 'workmate/$code.apk', 'size_bytes': bytes.length,
      'sha256': sha256.convert(bytes).toString(),
    };

void main() {
  final apk = List<int>.generate(1000, (i) => i % 256);
  late Directory tmp;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    tmp = await Directory.systemTemp.createTemp('wmupd');
  });
  tearDown(() => tmp.delete(recursive: true));

  Future<AppUpdateRepository> repo(ReleaseSource source, {http.Client? download}) async => AppUpdateRepository(
        source: source,
        prefs: await SharedPreferences.getInstance(),
        installedVersionCode: 1000,
        download: download ?? MockClient((_) async => http.Response.bytes(apk, 200)),
        cacheDir: () async => tmp,
      );

  test('learns of 1001 online, still knows offline', () async {
    final source = FakeSource(row(1001, apk));
    final r = await repo(source);
    expect((await r.requiredRelease())!.versionCode, 1001);
    source.error = const SocketException('down');
    expect((await r.requiredRelease())!.versionCode, 1001);
  });

  test('downloads, verifies and keeps one APK under cache/updates', () async {
    final r = await repo(FakeSource(row(1001, apk)));
    final release = (await r.requiredRelease())!;
    final result = await r.download(release, (_) {});
    expect(result, isA<DownloadReady>());
    final file = (result as DownloadReady).file;
    expect(file.path.replaceAll(r'\', '/'), endsWith('/updates/dacs-workmate-1001.apk'));
    expect(await file.readAsBytes(), apk);
  });

  test('a damaged download is refused and deleted', () async {
    final r = await repo(FakeSource(row(1001, apk)),
        download: MockClient((_) async => http.Response.bytes(List<int>.filled(1000, 7), 200)));
    final result = await r.download((await r.requiredRelease())!, (_) {});
    expect((result as DownloadFailed).reason, UpdateFailure.fileDamaged);
    expect(Directory('${tmp.path}/updates').listSync(), isEmpty);
  });

  test('no signal during download is a download failure', () async {
    final r = await repo(FakeSource(row(1001, apk)),
        download: MockClient((_) async => throw const SocketException('down')));
    final result = await r.download((await r.requiredRelease())!, (_) {});
    expect((result as DownloadFailed).reason, UpdateFailure.downloadFailed);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `flutter test test/update`
Expected: FAIL, missing `package:workmate/update/...` files.

- [ ] **Step 3: Implement**

`lib/update/app_release.dart`:

```dart
import 'dart:io';

import 'package:crypto/crypto.dart';

import '../config/app_config.dart';

/// One APK the office published from Dacs Web (app_releases, 0079/0082).
/// sizeBytes and sha256 were computed from the uploaded file, so a download
/// that does not reproduce both is not that file.
class AppRelease {
  const AppRelease({
    required this.versionCode,
    required this.versionName,
    required this.releaseNotes,
    required this.downloadUrl,
    required this.sizeBytes,
    required this.sha256,
  });

  factory AppRelease.fromRow(Map<String, dynamic> row) {
    final notes = (row['release_notes'] as String?)?.trim();
    return AppRelease(
      versionCode: (row['version_code'] as num).toInt(),
      versionName: row['version_name'] as String,
      releaseNotes: (notes == null || notes.isEmpty) ? null : notes,
      downloadUrl: '${AppConfig.supabaseUrl}/storage/v1/object/public/${AppConfig.releaseBucket}/${row['storage_path']}',
      sizeBytes: (row['size_bytes'] as num).toInt(),
      sha256: row['sha256'] as String,
    );
  }

  factory AppRelease.fromJson(Map<String, dynamic> j) => AppRelease(
        versionCode: j['versionCode'] as int,
        versionName: j['versionName'] as String,
        releaseNotes: j['releaseNotes'] as String?,
        downloadUrl: j['downloadUrl'] as String,
        sizeBytes: j['sizeBytes'] as int,
        sha256: j['sha256'] as String,
      );

  final int versionCode;
  final String versionName;
  final String? releaseNotes;
  final String downloadUrl;
  final int sizeBytes;
  final String sha256;

  Map<String, dynamic> toJson() => {
        'versionCode': versionCode,
        'versionName': versionName,
        'releaseNotes': releaseNotes,
        'downloadUrl': downloadUrl,
        'sizeBytes': sizeBytes,
        'sha256': sha256,
      };
}

/// The release this build must install, or null. Every published release is
/// required: publishing raises min_workmate_version, so the server refuses
/// older builds anyway. The server's answer wins when there is one; the cache
/// speaks only when the check failed; with neither, never block the worker.
AppRelease? requiredRelease({
  required int installedVersionCode,
  required bool fetchedOk,
  required AppRelease? fetched,
  required AppRelease? cached,
}) {
  final known = fetchedOk ? fetched : cached;
  return (known != null && known.versionCode > installedVersionCode) ? known : null;
}

enum CopyResult { verified, wrongSize, wrongHash }

class _DigestSink implements Sink<Digest> {
  Digest? value;
  @override
  void add(Digest data) => value = data;
  @override
  void close() {}
}

/// Streams [input] into [output], hashing as it goes: one pass, so an APK is
/// never held in memory on a 2 GB phone.
Future<CopyResult> copyVerifying(
  Stream<List<int>> input,
  IOSink output, {
  required int expectedSize,
  required String expectedSha256,
  void Function(double fraction)? onProgress,
}) async {
  final digestSink = _DigestSink();
  final hasher = sha256.startChunkedConversion(digestSink);
  var copied = 0;
  var lastPercent = -1;
  await for (final chunk in input) {
    output.add(chunk);
    hasher.add(chunk);
    copied += chunk.length;
    // Longer than promised is already wrong: stop pulling bytes.
    if (copied > expectedSize) return CopyResult.wrongSize;
    final percent = expectedSize > 0 ? (copied * 100) ~/ expectedSize : 0;
    if (percent != lastPercent) {
      lastPercent = percent;
      onProgress?.call(percent / 100);
    }
  }
  await output.flush();
  hasher.close();
  if (copied != expectedSize) return CopyResult.wrongSize;
  return digestSink.value.toString() == expectedSha256.toLowerCase() ? CopyResult.verified : CopyResult.wrongHash;
}
```

`lib/update/app_update_repository.dart`:

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app_release.dart';

abstract class ReleaseSource {
  /// The newest WorkMate release row, null when none is published. Throws
  /// when the server cannot be asked.
  Future<Map<String, dynamic>?> latestWorkMate();
}

class SupabaseReleaseSource implements ReleaseSource {
  SupabaseReleaseSource(this._client);
  final SupabaseClient _client;

  /// 0082: WorkMate's own stream. `app_latest_release()` is the OLD app's.
  @override
  Future<Map<String, dynamic>?> latestWorkMate() async {
    final rows = await _client.rpc('app_latest_release_for', params: {'p_app': 'workmate'}) as List<dynamic>;
    return rows.isEmpty ? null : Map<String, dynamic>.from(rows.first as Map);
  }
}

enum UpdateFailure {
  downloadFailed('Download failed. Check your internet and try again.',
      'Hindi natapos ang pag-download. Tingnan ang internet at subukan ulit.'),
  fileDamaged('The update file was damaged. Try again.', 'Sira ang update file. Subukan ulit.');

  const UpdateFailure(this.english, this.tagalog);
  final String english;
  final String tagalog;
}

sealed class DownloadResult {}

class DownloadReady extends DownloadResult {
  DownloadReady(this.file);
  final File file;
}

class DownloadFailed extends DownloadResult {
  DownloadFailed(this.reason);
  final UpdateFailure reason;
}

class AppUpdateRepository {
  AppUpdateRepository({
    required this.source,
    required this.prefs,
    required this.installedVersionCode,
    required this.download,
    required this.cacheDir,
  });

  final ReleaseSource source;
  final SharedPreferences prefs;
  final int installedVersionCode;

  /// A plain client: the APK is a public Storage object.
  final http.Client download;

  /// Must be the app cache dir: res/xml/update_file_paths.xml shares only cache/updates/.
  final Future<Directory> Function() cacheDir;

  static const _cacheKey = 'update.required';

  AppRelease? _readCache() {
    final raw = prefs.getString(_cacheKey);
    return raw == null ? null : AppRelease.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  Future<void> _writeCache(AppRelease? r) =>
      r == null ? prefs.remove(_cacheKey) : prefs.setString(_cacheKey, jsonEncode(r.toJson()));

  /// Never throws: see [requiredRelease] in app_release.dart.
  Future<AppRelease?> requiredRelease() async {
    AppRelease? fetched;
    var ok = true;
    try {
      final row = await source.latestWorkMate();
      fetched = row == null ? null : AppRelease.fromRow(row);
    } catch (_) {
      ok = false;
    }
    final required = requiredRelease(
      installedVersionCode: installedVersionCode,
      fetchedOk: ok,
      fetched: fetched,
      cached: _readCache(),
    );
    await _writeCache(required);
    return required;
  }

  Future<Directory> _updatesDir() async {
    final dir = Directory('${(await cacheDir()).path}${Platform.pathSeparator}updates');
    await dir.create(recursive: true);
    return dir;
  }

  Future<DownloadResult> download(AppRelease release, void Function(double) onProgress) async {
    final dir = await _updatesDir();
    // One APK on disk at a time.
    for (final f in dir.listSync()) {
      await f.delete();
    }
    final sep = Platform.pathSeparator;
    final target = File('${dir.path}${sep}dacs-workmate-${release.versionCode}.apk');
    final partial = File('${target.path}.part');
    try {
      final response = await download
          .send(http.Request('GET', Uri.parse(release.downloadUrl)))
          .timeout(const Duration(seconds: 30));
      if (response.statusCode != 200) throw http.ClientException('HTTP ${response.statusCode}');
      final sink = partial.openWrite();
      final CopyResult result;
      try {
        result = await copyVerifying(response.stream, sink,
            expectedSize: release.sizeBytes, expectedSha256: release.sha256, onProgress: onProgress);
      } finally {
        await sink.close();
      }
      if (result != CopyResult.verified) {
        await partial.delete();
        return DownloadFailed(UpdateFailure.fileDamaged);
      }
      await partial.rename(target.path);
      return DownloadReady(target);
    } on Object catch (e) {
      if (e is! SocketException && e is! http.ClientException && e is! TimeoutException && e is! IOException) rethrow;
      if (await partial.exists()) await partial.delete();
      return DownloadFailed(UpdateFailure.downloadFailed);
    }
  }

  Future<void> discardDownloads() async {
    final dir = await _updatesDir();
    for (final f in dir.listSync()) {
      await f.delete();
    }
  }
}
```

`lib/update/apk_installer.dart`:

```dart
import 'dart:io';

import 'package:flutter/services.dart';

/// Hands a verified APK to Android. An interface so the update flow tests
/// without a device.
abstract class InstallGateway {
  /// Whether Android lets WorkMate open the installer ("Install unknown apps"
  /// is per-app from Android 8; below that the system installer asks).
  Future<bool> canInstall();

  /// Opens the "Install unknown apps" switch for WorkMate.
  Future<void> openInstallPermission();

  Future<void> install(File apk);
}

class ApkInstaller implements InstallGateway {
  static const _channel = MethodChannel('com.dacs.workmate/installer');

  @override
  Future<bool> canInstall() async => await _channel.invokeMethod<bool>('canInstall') ?? false;

  @override
  Future<void> openInstallPermission() => _channel.invokeMethod<void>('openInstallPermission');

  @override
  Future<void> install(File apk) => _channel.invokeMethod<void>('install', {'path': apk.path});
}
```

Replace `android/app/src/main/kotlin/com/dacs/workmate/MainActivity.kt` with:

```kotlin
package com.dacs.workmate

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

private const val APK_MIME = "application/vnd.android.package-archive"

/** The installer channel for lib/update/apk_installer.dart. */
class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.dacs.workmate/installer")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "canInstall" -> result.success(
                        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()
                    )
                    "openInstallPermission" -> {
                        openInstallPermission()
                        result.success(null)
                    }
                    "install" -> {
                        val path = call.argument<String>("path")
                        if (path == null) result.error("NO_PATH", "path is required", null)
                        else {
                            install(File(path))
                            result.success(null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun openInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        try {
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
        } catch (e: ActivityNotFoundException) {
            // Some vendor ROMs drop the per-app screen; the list is one tap further.
            Log.w("WorkMateInstaller", "No per-app unknown-sources screen, opening the list", e)
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))
        }
    }

    private fun install(apk: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apk)
        startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
```

- [ ] **Step 4: Run the tests and a debug build**

Run: `flutter test test/update`
Expected: PASS.

Run: `flutter build apk --debug`
Expected: build succeeds (the Kotlin channel and FileProvider compile).

- [ ] **Step 5: Checkpoint**

Show `git status`. Stop for the user to commit ("feat: required in-app updates from the WorkMate stream").

---

### Task 9: The app: controller, screens and wiring

**Files:**
- Create: `lib/app_controller.dart`, `lib/ui/theme.dart`, `lib/ui/failure_notice.dart`, `lib/ui/login_screen.dart`, `lib/ui/terms_screen.dart`, `lib/ui/gate_unavailable_screen.dart`, `lib/ui/home_shell.dart`, `lib/ui/update_overlay.dart`, `lib/app.dart`
- Modify: `lib/main.dart` (replace)
- Test: `test/app_controller_test.dart`, `test/ui/screens_test.dart`

**Interfaces:**
- Consumes: `AuthRepository`, `LoginRejected`, `LoginFailure`, `Eligibility` (Tasks 3, 6); `TermsRepository`, `StartupDecision`, `AttendanceTerms` (Tasks 4, 7); `AppUpdateRepository`, `AppRelease`, `DownloadResult`, `InstallGateway`, `UpdateFailure` (Task 8); `UpdateNudges` (Task 2).
- Produces:
  - `sealed class AppState`: `Starting`, `SignedOut({LoginFailure? notice})`, `NeedsTerms(WorkerProfile)`, `TermsUnavailable(WorkerProfile)`, `Ready(WorkerProfile)`
  - `class AppController extends ChangeNotifier { AppController({required AuthRepository auth, required TermsRepository terms, required AppUpdateRepository updates, required Stream<void> nudges}); AppState get state; AppRelease? get requiredUpdate; Future<void> start(); Future<LoginFailure?> signIn(String, String); Future<LoginFailure?> acceptTerms(); Future<void> signOut(); Future<void> retryStartup(); Future<void> checkForUpdate(); }`
  - `class WorkMateApp extends StatelessWidget { WorkMateApp({required AppController controller, required AppUpdateRepository updates, required InstallGateway installer, required String versionName}); }`

- [ ] **Step 1: Write the failing controller test**

`test/app_controller_test.dart`:

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmate/app_controller.dart';
import 'package:workmate/auth/auth_backend.dart';
import 'package:workmate/auth/auth_repository.dart';
import 'package:workmate/auth/login_failure.dart';
import 'package:workmate/auth/session_gate.dart';
import 'package:workmate/auth/sign_in_api.dart';
import 'package:workmate/auth/worker_cache.dart';
import 'package:workmate/terms/terms_repository.dart';
import 'package:workmate/update/app_update_repository.dart';

class FakeAuth implements AuthBackend {
  SessionPresence p = SessionPresence.absent;
  Map<String, dynamic>? row;
  bool signedOut = false;
  @override
  Future<void> adopt({required String accessToken, required String refreshToken}) async {}
  @override
  Future<SessionPresence> presence() async => p;
  @override
  String? get currentUserId => row?['id'] as String?;
  @override
  Future<Map<String, dynamic>?> readProfile(String userId) async => row;
  @override
  Future<void> signOut() async => signedOut = true;
}

class FakeTerms implements TermsBackend {
  Set<String>? versions = {};
  bool offline = false;
  @override
  Future<Set<String>> acceptedVersions(String workerId) async {
    if (offline) throw const SocketException('down');
    return versions!;
  }
  @override
  Future<void> insertEvidence(Map<String, dynamic> row) async {}
  @override
  Future<void> insertAcceptance(Map<String, dynamic> row) async {}
}

class FakeSource implements ReleaseSource {
  Map<String, dynamic>? row;
  @override
  Future<Map<String, dynamic>?> latestWorkMate() async => row;
}

void main() {
  late FakeAuth authBackend;
  late FakeTerms termsBackend;
  late FakeSource source;
  late StreamController<void> nudges;

  Future<AppController> build({String signInBody = '{"error":"INVALID_CREDENTIALS"}', int signInStatus = 401}) async {
    final prefs = await SharedPreferences.getInstance();
    final cache = WorkerCache(prefs);
    return AppController(
      auth: AuthRepository(
          api: SignInApi(MockClient((_) async => http.Response(signInBody, signInStatus))),
          backend: authBackend,
          cache: cache),
      terms: TermsRepository(backend: termsBackend, cache: cache, userAgent: 'test'),
      updates: AppUpdateRepository(
          source: source, prefs: prefs, installedVersionCode: 1000,
          download: MockClient((_) async => http.Response('', 404)), cacheDir: () async => Directory.systemTemp),
      nudges: nudges.stream,
    );
  }

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    authBackend = FakeAuth();
    termsBackend = FakeTerms();
    source = FakeSource();
    nudges = StreamController<void>.broadcast();
  });

  test('no session: the login screen', () async {
    final c = await build();
    await c.start();
    expect(c.state, isA<SignedOut>());
  });

  test('restored session, accepted Terms (e.g. in the Attendance app): straight to home', () async {
    authBackend
      ..p = SessionPresence.confirmed
      ..row = {'id': 'u1', 'role': 'worker', 'status': 'active'};
    termsBackend.versions = {'2026-09-v3'};
    final c = await build();
    await c.start();
    expect(c.state, isA<Ready>());
  });

  test('restored session for a worker turned off since: signed out, told why', () async {
    authBackend
      ..p = SessionPresence.confirmed
      ..row = {'id': 'u1', 'role': 'worker', 'status': 'inactive'};
    final c = await build();
    await c.start();
    expect((c.state as SignedOut).notice, LoginFailure.accountInactive);
    expect(authBackend.signedOut, isTrue);
  });

  test('first launch offline with nothing recorded: the Terms cannot be checked, never assumed', () async {
    authBackend
      ..p = SessionPresence.confirmed
      ..row = {'id': 'u1', 'role': 'worker', 'status': 'active'};
    termsBackend.offline = true;
    final c = await build();
    await c.start();
    expect(c.state, isA<TermsUnavailable>());
  });

  test('sign-in, then Terms, then home', () async {
    final c = await build(
      signInStatus: 200,
      signInBody: '{"session":{"access_token":"A","refresh_token":"R"},"worker":{"id":"u1","role":"worker","status":"active"}}',
    );
    await c.start();
    authBackend.p = SessionPresence.confirmed;
    expect(await c.signIn('juan@x.com', 'pw'), isNull);
    expect(c.state, isA<NeedsTerms>());
    expect(await c.acceptTerms(), isNull);
    expect(c.state, isA<Ready>());
  });

  test('a wrong password stays on login with its message', () async {
    final c = await build();
    await c.start();
    expect(await c.signIn('a@b.c', 'x'), LoginFailure.wrongCredentials);
    expect(c.state, isA<SignedOut>());
  });

  test('a published newer build puts the update up; a server nudge re-checks', () async {
    final c = await build();
    await c.start();
    expect(c.requiredUpdate, isNull);
    source.row = {
      'version_code': 1001, 'version_name': '0.1.1', 'release_notes': null,
      'storage_path': 'workmate/1001.apk', 'size_bytes': 1, 'sha256': 'a',
    };
    nudges.add(null);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(c.requiredUpdate!.versionCode, 1001);
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `flutter test test/app_controller_test.dart`
Expected: FAIL, missing `app_controller.dart`.

- [ ] **Step 3: Implement the controller**

`lib/app_controller.dart`:

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';

import 'auth/auth_repository.dart';
import 'auth/login_failure.dart';
import 'auth/worker_profile.dart';
import 'terms/terms_gates.dart';
import 'terms/terms_repository.dart';
import 'update/app_release.dart';
import 'update/app_update_repository.dart';

sealed class AppState {}

class Starting extends AppState {}

class SignedOut extends AppState {
  SignedOut({this.notice});
  final LoginFailure? notice;
}

class NeedsTerms extends AppState {
  NeedsTerms(this.worker);
  final WorkerProfile worker;
}

class TermsUnavailable extends AppState {
  TermsUnavailable(this.worker);
  final WorkerProfile worker;
}

class Ready extends AppState {
  Ready(this.worker);
  final WorkerProfile worker;
}

/// Startup, sign-in, Terms and the required-update check.
class AppController extends ChangeNotifier {
  AppController({required this.auth, required this.terms, required this.updates, required Stream<void> nudges}) {
    _nudgeSub = nudges.listen((_) => checkForUpdate());
  }

  final AuthRepository auth;
  final TermsRepository terms;
  final AppUpdateRepository updates;
  late final StreamSubscription<void> _nudgeSub;

  AppState _state = Starting();
  AppState get state => _state;

  AppRelease? _requiredUpdate;
  AppRelease? get requiredUpdate => _requiredUpdate;

  void _set(AppState s) {
    _state = s;
    notifyListeners();
  }

  Future<void> start() async {
    unawaited(checkForUpdate());
    final worker = await auth.currentWorker();
    if (worker == null) return _set(SignedOut());
    await _afterWorker(worker);
  }

  Future<void> retryStartup() async {
    _set(Starting());
    await start();
  }

  Future<void> _afterWorker(WorkerProfile worker) async {
    // An account turned off since the last launch is told at the door.
    final eligibility = worker.eligibility();
    if (eligibility != Eligibility.allowed) {
      await auth.signOut();
      return _set(SignedOut(
          notice: eligibility == Eligibility.accountInactive ? LoginFailure.accountInactive : LoginFailure.notAWorker));
    }
    switch (await terms.startupDecision(worker)) {
      case StartupDecision.ready:
        _set(Ready(worker));
      case StartupDecision.mustAccept:
        _set(NeedsTerms(worker));
      case StartupDecision.unavailable:
        _set(TermsUnavailable(worker));
    }
  }

  /// Returns the failure to show, or null on success.
  Future<LoginFailure?> signIn(String email, String password) async {
    try {
      final worker = await auth.signIn(email, password);
      await _afterWorker(worker);
      return null;
    } on LoginRejected catch (e) {
      return e.failure;
    }
  }

  Future<LoginFailure?> acceptTerms() async {
    final s = _state;
    if (s is! NeedsTerms) return null;
    try {
      await terms.accept(s.worker);
      _set(Ready(s.worker));
      return null;
    } catch (e) {
      return LoginFailure.of(e);
    }
  }

  Future<void> signOut() async {
    await auth.signOut();
    _set(SignedOut());
  }

  Future<void> checkForUpdate() async {
    final r = await updates.requiredRelease();
    if (r?.versionCode != _requiredUpdate?.versionCode) {
      _requiredUpdate = r;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _nudgeSub.cancel();
    super.dispose();
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `flutter test test/app_controller_test.dart`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing screen tests**

`test/ui/screens_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workmate/auth/login_failure.dart';
import 'package:workmate/auth/worker_profile.dart';
import 'package:workmate/terms/attendance_terms.dart';
import 'package:workmate/ui/home_shell.dart';
import 'package:workmate/ui/login_screen.dart';
import 'package:workmate/ui/terms_screen.dart';
import 'package:workmate/ui/theme.dart';

Widget wrap(Widget w) => MaterialApp(theme: workMateTheme(), home: w);

void main() {
  testWidgets('login shows the failure in English and Tagalog', (tester) async {
    await tester.pumpWidget(wrap(LoginScreen(
      initialNotice: null,
      onSignIn: (_, __) async => LoginFailure.wrongCredentials,
    )));
    await tester.enterText(find.byKey(const Key('email')), 'a@b.c');
    await tester.enterText(find.byKey(const Key('password')), 'x');
    await tester.tap(find.text('SIGN IN'));
    await tester.pumpAndSettle();
    expect(find.text('That email and password do not match.'), findsOneWidget);
    expect(find.text('Hindi tugma ang email at password.'), findsOneWidget);
  });

  testWidgets('terms cannot be accepted until the box is ticked', (tester) async {
    var accepted = 0;
    await tester.pumpWidget(wrap(TermsScreen(onAccept: () async {
      accepted++;
      return null;
    })));
    expect(find.text(AttendanceTerms.clauses.first.english), findsOneWidget);
    await tester.tap(find.text('ACCEPT & CONTINUE'));
    await tester.pump();
    expect(accepted, 0);
    await tester.tap(find.text('I have read and I agree.'));
    await tester.pump();
    await tester.tap(find.text('ACCEPT & CONTINUE'));
    await tester.pump();
    expect(accepted, 1);
  });

  testWidgets('home greets the worker and says Attendance is still in the old app', (tester) async {
    await tester.pumpWidget(wrap(HomeShell(
      worker: const WorkerProfile(id: 'u1', displayName: 'Juan dela Cruz', position: 'Mason', workerNo: 42),
      versionName: '0.1.0',
      onSignOut: () async {},
    )));
    expect(find.text('Juan dela Cruz'), findsOneWidget);
    expect(find.text('Mason · W-0042'), findsOneWidget);
    expect(find.textContaining('DACS Attendance'), findsWidgets);
  });
}
```

- [ ] **Step 6: Run them to verify they fail**

Run: `flutter test test/ui/screens_test.dart`
Expected: FAIL, missing `package:workmate/ui/...` files.

- [ ] **Step 7: Implement the theme and screens**

`lib/ui/theme.dart`:

```dart
import 'package:flutter/material.dart';

/// Colours and type from DACS Attendance (ui/theme/Color.kt), so the two
/// apps look like one company while workers switch over.
class WmColors {
  static const green = Color(0xFF1A5C3A);
  static const greenTint = Color(0xFFEAF2EC);
  static const brown = Color(0xFF7C5E2A);
  static const brownTint = Color(0xFFF5EFE3);
  static const danger = Color(0xFFC0392B);
  static const dangerBorder = Color(0xFFF2DFDC);
  static const dangerTint = Color(0xFFFDF5F4);
  static const canvas = Color(0xFFF6F7F4);
  static const field = Color(0xFFF4F5F1);
  static const border = Color(0xFFE6E7E1);
  static const hairline = Color(0xFFF0F0EB);
  static const text = Color(0xFF1B1B19);
  static const textSecondary = Color(0xFF3A3A37);
  static const textMuted = Color(0xFF7A7A75);
  static const textMeta = Color(0xFF8A8A86);
  static const inert = Color(0xFFEDEDE8);
}

ThemeData workMateTheme() => ThemeData(
      useMaterial3: true,
      fontFamily: 'Barlow',
      scaffoldBackgroundColor: WmColors.canvas,
      colorScheme: ColorScheme.fromSeed(seedColor: WmColors.green, primary: WmColors.green, surface: WmColors.canvas),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: WmColors.field,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: WmColors.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: WmColors.border)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: WmColors.green,
          minimumSize: const Size.fromHeight(58),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontFamily: 'Barlow', fontWeight: FontWeight.w800, fontSize: 16),
        ),
      ),
    );

const monoLabel = TextStyle(fontFamily: 'IBM Plex Mono', fontWeight: FontWeight.w700, fontSize: 12, letterSpacing: 1.2, color: WmColors.textMeta);
```

`lib/ui/failure_notice.dart`:

```dart
import 'package:flutter/material.dart';

import 'theme.dart';

/// Screen copy is English; failure copy is bilingual (English, then Tagalog).
class FailureNotice extends StatelessWidget {
  const FailureNotice({super.key, required this.english, required this.tagalog});
  final String english;
  final String tagalog;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: WmColors.dangerTint,
          border: Border.all(color: WmColors.dangerBorder),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(english, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: WmColors.danger)),
          const SizedBox(height: 3),
          Text(tagalog, style: const TextStyle(fontSize: 13, color: WmColors.danger)),
        ]),
      );
}
```

`lib/ui/login_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../auth/login_failure.dart';
import 'failure_notice.dart';
import 'theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.onSignIn, this.initialNotice});

  /// Returns the failure to show, or null when signed in.
  final Future<LoginFailure?> Function(String email, String password) onSignIn;
  final LoginFailure? initialNotice;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _show = false;
  bool _busy = false;
  LoginFailure? _failure;

  @override
  void initState() {
    super.initState();
    _failure = widget.initialNotice;
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final failure = await widget.onSignIn(_email.text, _password.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.fromLTRB(24, 30, 24, 26), children: [
            const Row(children: [
              Icon(Icons.apartment, color: WmColors.green, size: 40),
              SizedBox(width: 12),
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('WorkMate', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                Text("DAC's Building Design Services", style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
              ]),
            ]),
            const SizedBox(height: 22),
            const Text('Welcome back', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
            const Text('Use the email your admin gave you. It is the same account as Attendance.',
                style: TextStyle(fontSize: 15, color: WmColors.textMuted)),
            const SizedBox(height: 22),
            const Text('Email', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: WmColors.textSecondary)),
            const SizedBox(height: 7),
            TextField(key: const Key('email'), controller: _email, keyboardType: TextInputType.emailAddress, autocorrect: false),
            const SizedBox(height: 16),
            const Text('Password', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: WmColors.textSecondary)),
            const SizedBox(height: 7),
            TextField(
              key: const Key('password'),
              controller: _password,
              obscureText: !_show,
              decoration: InputDecoration(
                suffixIcon: TextButton(onPressed: () => setState(() => _show = !_show), child: Text(_show ? 'Hide' : 'Show')),
              ),
            ),
            if (_failure != null) ...[
              const SizedBox(height: 16),
              FailureNotice(english: _failure!.english, tagalog: _failure!.tagalog),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                  : const Text('SIGN IN'),
            ),
            const SizedBox(height: 14),
            const Center(child: Text('No account? Call the office.', style: TextStyle(fontSize: 14, color: WmColors.textMuted))),
          ]),
        ),
      );
}
```

`lib/ui/terms_screen.dart`:

```dart
import 'package:flutter/material.dart';

import '../auth/login_failure.dart';
import '../terms/attendance_terms.dart';
import 'failure_notice.dart';
import 'theme.dart';

class TermsScreen extends StatefulWidget {
  const TermsScreen({super.key, required this.onAccept});

  /// Returns the failure to show, or null when accepted.
  final Future<LoginFailure?> Function() onAccept;

  @override
  State<TermsScreen> createState() => _TermsScreenState();
}

class _TermsScreenState extends State<TermsScreen> {
  bool _agreed = false;
  bool _busy = false;
  LoginFailure? _failure;

  Future<void> _accept() async {
    if (!_agreed || _busy) return;
    setState(() => _busy = true);
    final failure = await widget.onAccept();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Column(children: [
            Expanded(
              child: ListView(padding: const EdgeInsets.fromLTRB(20, 20, 20, 12), children: [
                const Text('Terms & Conditions', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
                const Text('You only need to do this once, on your first log in.',
                    style: TextStyle(fontSize: 15, color: WmColors.textMuted)),
                const SizedBox(height: 16),
                for (var i = 0; i < AttendanceTerms.clauses.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${i + 1}. ${AttendanceTerms.clauses[i].heading}',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      const SizedBox(height: 4),
                      Text(AttendanceTerms.clauses[i].english, style: const TextStyle(fontSize: 14.5, height: 1.4)),
                      const SizedBox(height: 4),
                      Text(AttendanceTerms.clauses[i].tagalog,
                          style: const TextStyle(fontSize: 13.5, height: 1.4, color: WmColors.textMuted)),
                    ]),
                  ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: Column(children: [
                if (_failure != null) ...[
                  FailureNotice(english: _failure!.english, tagalog: _failure!.tagalog),
                  const SizedBox(height: 12),
                ],
                InkWell(
                  onTap: () => setState(() => _agreed = !_agreed),
                  child: Row(children: [
                    Icon(_agreed ? Icons.check_box : Icons.check_box_outline_blank, color: WmColors.green),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('I have read and I agree.', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                        Text('Required before you continue.', style: TextStyle(fontSize: 13, color: WmColors.textMuted)),
                      ]),
                    ),
                  ]),
                ),
                const SizedBox(height: 12),
                FilledButton(onPressed: _agreed && !_busy ? _accept : null, child: const Text('ACCEPT & CONTINUE')),
              ]),
            ),
          ]),
        ),
      );
}
```

`lib/ui/gate_unavailable_screen.dart`:

```dart
import 'package:flutter/material.dart';

import 'failure_notice.dart';

/// First launch with no signal: the Terms acceptance cannot be checked and is
/// never assumed. Accepting offline could not be written anywhere.
class GateUnavailableScreen extends StatelessWidget {
  const GateUnavailableScreen({super.key, required this.onRetry, required this.onSignOut});
  final VoidCallback onRetry;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Text('Terms & Conditions', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
              const SizedBox(height: 16),
              const FailureNotice(
                english: 'Connect to the internet once so WorkMate can check your Terms.',
                tagalog: 'Kumonekta muna sa internet para ma-check ng WorkMate ang Terms mo.',
              ),
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

`lib/ui/home_shell.dart`:

```dart
import 'package:flutter/material.dart';

import '../auth/worker_profile.dart';
import 'theme.dart';

/// 0B's shell: Home and Profile. Attendance, Requests and Work tabs arrive
/// with their stages; until 0C, Time In stays in DACS Attendance.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.worker, required this.versionName, required this.onSignOut});
  final WorkerProfile worker;
  final String versionName;
  final Future<void> Function() onSignOut;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final w = widget.worker;
    final header = Row(children: [
      CircleAvatar(
        radius: 22,
        backgroundColor: WmColors.green,
        child: Text(w.initials, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(w.displayName ?? w.firstName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
          Text(w.positionAndId, style: const TextStyle(fontSize: 13, color: WmColors.textMuted)),
        ]),
      ),
    ]);

    final home = ListView(padding: const EdgeInsets.all(20), children: [
      header,
      const SizedBox(height: 20),
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: WmColors.brownTint,
          borderRadius: BorderRadius.circular(20),
        ),
        child: const Text(
          'Keep using DACS Attendance for Time In and Time Out for now. '
          'It moves into WorkMate in a coming update, and the office will tell you when.',
          style: TextStyle(fontSize: 14.5, height: 1.4, color: Color(0xFF63491F)),
        ),
      ),
    ]);

    final profile = ListView(padding: const EdgeInsets.all(20), children: [
      const Text('Profile', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
      const SizedBox(height: 16),
      header,
      const SizedBox(height: 24),
      OutlinedButton.icon(
        onPressed: widget.onSignOut,
        icon: const Icon(Icons.logout),
        label: const Text('Log out'),
      ),
      const SizedBox(height: 16),
      Text("DAC'S WorkMate ${widget.versionName} · By Dacs Building Design Services",
          style: const TextStyle(fontSize: 12.5, color: WmColors.textMeta)),
    ]);

    return Scaffold(
      body: SafeArea(child: _tab == 0 ? home : profile),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
  }
}
```

`lib/ui/update_overlay.dart`:

```dart
import 'package:flutter/material.dart';

import '../update/apk_installer.dart';
import '../update/app_release.dart';
import '../update/app_update_repository.dart';
import 'failure_notice.dart';
import 'theme.dart';

/// Full-screen and not dismissible: every published release is required and
/// the server refuses older builds anyway. This is the explanation.
class UpdateOverlay extends StatefulWidget {
  const UpdateOverlay({super.key, required this.release, required this.updates, required this.installer});
  final AppRelease release;
  final AppUpdateRepository updates;
  final InstallGateway installer;

  @override
  State<UpdateOverlay> createState() => _UpdateOverlayState();
}

class _UpdateOverlayState extends State<UpdateOverlay> with WidgetsBindingObserver {
  double? _progress;
  DownloadReady? _ready;
  UpdateFailure? _failure;
  bool _needsPermission = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back from the "Install unknown apps" switch.
    if (state == AppLifecycleState.resumed && _needsPermission) _install();
  }

  Future<void> _download() async {
    setState(() {
      _failure = null;
      _progress = 0;
    });
    final result = await widget.updates.download(widget.release, (p) {
      if (mounted) setState(() => _progress = p);
    });
    if (!mounted) return;
    setState(() {
      _progress = null;
      switch (result) {
        case DownloadReady():
          _ready = result;
        case DownloadFailed(:final reason):
          _failure = reason;
      }
    });
  }

  Future<void> _install() async {
    final ready = _ready;
    if (ready == null) return;
    if (!await widget.installer.canInstall()) {
      setState(() => _needsPermission = true);
      await widget.installer.openInstallPermission();
      return;
    }
    setState(() => _needsPermission = false);
    await widget.installer.install(ready.file);
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.release;
    final String label;
    final VoidCallback? action;
    if (_progress != null) {
      label = 'DOWNLOADING… ${(_progress! * 100).round()}%';
      action = null;
    } else if (_needsPermission) {
      label = 'ALLOW INSTALLS';
      action = _install;
    } else if (_ready != null) {
      label = 'INSTALL';
      action = _install;
    } else if (_failure != null) {
      label = 'TRY AGAIN';
      action = _download;
    } else {
      label = 'UPDATE NOW!';
      action = _download;
    }

    return Material(
      color: WmColors.canvas,
      child: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const Icon(Icons.system_update, size: 48, color: WmColors.green),
          const SizedBox(height: 16),
          const Text('New Update is Available', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 23)),
          const SizedBox(height: 6),
          const Text('A new version is released, please update to get new features',
              style: TextStyle(fontSize: 15, color: WmColors.textMuted)),
          const SizedBox(height: 16),
          Text('Version ${r.versionName}', style: monoLabel),
          if (r.releaseNotes != null) ...[
            const SizedBox(height: 16),
            const Text("WHAT'S NEW", style: monoLabel),
            const SizedBox(height: 6),
            Text(r.releaseNotes!, style: const TextStyle(fontSize: 14.5, height: 1.4)),
          ],
          if (_needsPermission) ...[
            const SizedBox(height: 16),
            const Text('One more step', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
            const Text('Allow DAC\'S WorkMate to install updates. Turn on the switch, then come back here.',
                style: TextStyle(fontSize: 14, color: WmColors.textMuted)),
          ],
          if (_ready != null && !_needsPermission) ...[
            const SizedBox(height: 12),
            const Text('Tap Install on the next screen.', style: TextStyle(fontSize: 14, color: WmColors.textMuted)),
          ],
          if (_failure != null) ...[
            const SizedBox(height: 16),
            FailureNotice(english: _failure!.english, tagalog: _failure!.tagalog),
          ],
          const SizedBox(height: 24),
          FilledButton(onPressed: action, child: Text(label)),
        ]),
      ),
    );
  }
}
```

- [ ] **Step 8: Wire the app**

`lib/app.dart`:

```dart
import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'ui/gate_unavailable_screen.dart';
import 'ui/home_shell.dart';
import 'ui/login_screen.dart';
import 'ui/terms_screen.dart';
import 'ui/theme.dart';
import 'ui/update_overlay.dart';
import 'update/apk_installer.dart';
import 'update/app_update_repository.dart';

class WorkMateApp extends StatefulWidget {
  const WorkMateApp({
    super.key,
    required this.controller,
    required this.updates,
    required this.installer,
    required this.versionName,
  });

  final AppController controller;
  final AppUpdateRepository updates;
  final InstallGateway installer;
  final String versionName;

  @override
  State<WorkMateApp> createState() => _WorkMateAppState();
}

class _WorkMateAppState extends State<WorkMateApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.controller.start();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) widget.controller.checkForUpdate();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: "DAC'S WorkMate",
        debugShowCheckedModeBanner: false,
        theme: workMateTheme(),
        home: ListenableBuilder(
          listenable: widget.controller,
          builder: (context, _) {
            final c = widget.controller;
            final Widget screen = switch (c.state) {
              Starting() => const Scaffold(body: Center(child: CircularProgressIndicator())),
              SignedOut(:final notice) => LoginScreen(key: ValueKey(notice), initialNotice: notice, onSignIn: c.signIn),
              NeedsTerms() => TermsScreen(onAccept: c.acceptTerms),
              TermsUnavailable() => GateUnavailableScreen(onRetry: c.retryStartup, onSignOut: c.signOut),
              Ready(:final worker) => HomeShell(worker: worker, versionName: widget.versionName, onSignOut: c.signOut),
            };
            final update = c.requiredUpdate;
            return Stack(children: [
              screen,
              if (update != null)
                Positioned.fill(
                  child: UpdateOverlay(
                    key: ValueKey(update.versionCode),
                    release: update,
                    updates: widget.updates,
                    installer: widget.installer,
                  ),
                ),
            ]);
          },
        ),
      );
}
```

Replace `lib/main.dart`:

```dart
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'app_controller.dart';
import 'auth/auth_backend.dart';
import 'auth/auth_repository.dart';
import 'auth/session_storage.dart';
import 'auth/sign_in_api.dart';
import 'auth/worker_cache.dart';
import 'config/app_config.dart';
import 'net/update_nudges.dart';
import 'net/workmate_http_client.dart';
import 'terms/terms_repository.dart';
import 'update/apk_installer.dart';
import 'update/app_update_repository.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final info = await PackageInfo.fromPlatform();
  final versionCode = int.parse(info.buildNumber);
  final android = await DeviceInfoPlugin().androidInfo;
  final userAgent =
      'DacsWorkMate/${info.version} (Android ${android.version.release}; ${android.manufacturer} ${android.model})';

  final prefs = await SharedPreferences.getInstance();
  final nudges = UpdateNudges();
  final httpClient = WorkMateHttpClient(versionCode: versionCode, nudges: nudges);
  final sessionStorage = WorkMateSessionStorage(secure: SecureBox(), plain: prefs);

  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    publishableKey: AppConfig.supabaseAnonKey,
    httpClient: httpClient,
    authOptions: FlutterAuthClientOptions(localStorage: sessionStorage),
  );
  final client = Supabase.instance.client;

  final cache = WorkerCache(prefs);
  final updates = AppUpdateRepository(
    source: SupabaseReleaseSource(client),
    prefs: prefs,
    installedVersionCode: versionCode,
    download: http.Client(),
    cacheDir: getTemporaryDirectory,
  );
  final controller = AppController(
    auth: AuthRepository(api: SignInApi(httpClient), backend: SupabaseAuthBackend(client, sessionStorage), cache: cache),
    terms: TermsRepository(backend: SupabaseTermsBackend(client), cache: cache, userAgent: userAgent),
    updates: updates,
    nudges: nudges.events,
  );

  runApp(WorkMateApp(controller: controller, updates: updates, installer: ApkInstaller(), versionName: info.version));
}
```

- [ ] **Step 9: Run every test and analyze**

Run: `flutter test`
Expected: PASS (all files).

Run: `flutter analyze`
Expected: `No issues found!` Fix anything it reports before continuing.

Run: `flutter build apk --debug`
Expected: build succeeds.

- [ ] **Step 10: Checkpoint**

Show `git status`. Stop for the user to commit ("feat: sign-in, Terms and home shell").

---

### Task 10: On a real phone, upload key, and the first WorkMate release

This task is done WITH the user; several steps are theirs (passwords, publishing). Nothing here changes the database schema.

**Files:**
- Create (user): `C:\Users\John Aerol Tapales\keystores\dacs-workmate-upload.jks`, `android/keystore.properties`
- Modify: `pubspec.yaml` (version bump in Step 6), `Dacs Web/docs/superpowers/plans/2026-09-29-workmate-stage0-roadmap.md`

- [ ] **Step 1: Debug build on a phone, online**

```powershell
flutter build apk --debug
adb install -r build\app\outputs\flutter-apk\app-debug.apk
```

On the phone ("WorkMate debug"): sign in with a test worker account that already accepted the Terms in DACS Attendance.
Expected: **no Terms screen** (shared acceptance), Home shows their name and `Position · W-####`.

- [ ] **Step 2: Refusals**

Sign in with a staff account → "This is not a worker account." / "Hindi ito worker account." Wrong password → the wrong-credentials pair. Airplane mode then sign in → the no-signal pair.

- [ ] **Step 3: Offline restart keeps the worker signed in**

Signed in, force-stop the app, switch on airplane mode, wait until the access token has expired (1 hour), open WorkMate.
Expected: Home, not the login screen. Turn airplane mode off; Home stays. Then Log out → login screen; reopen offline → login screen (nothing about the worker remains).

- [ ] **Step 4: Server saw WorkMate**

Ask Claude to run, on project `hqbgduyonlbbsvjuapre`:

```sql
select user_agent, accepted_at from agreement_events
where doc_type = 'attendance_terms' and user_agent like 'DacsWorkMate/%' order by accepted_at desc limit 5;
```

after signing in on the phone with a test worker who has NOT accepted `2026-09-v3` and accepting in WorkMate.
Expected: one row with `DacsWorkMate/0.1.0 (Android …)`. (The x-dacs-app header itself is proven by Task 2's tests and by 0C's first Time In, which stores `timein_app_version = 1000`.)

- [ ] **Step 5: The user creates the upload key**

The user runs (and chooses and stores the passwords; Claude never sees them):

```powershell
keytool -genkeypair -v -keystore "C:\Users\John Aerol Tapales\keystores\dacs-workmate-upload.jks" -alias workmate-upload -keyalg RSA -keysize 2048 -validity 10000
```

and writes `android/keystore.properties` as in README.md. Back up the `.jks` and its passwords next to the Attendance key. Then:

```powershell
flutter test test/app_identity_test.dart
git status
```

Expected: tests pass, `keystore.properties` and the `.jks` do NOT appear in `git status`.

- [ ] **Step 6: Release 1000, then prove the updater with 1001**

```powershell
flutter build apk --release
(Get-Item build\app\outputs\flutter-apk\app-release.apk).Length
```

Expected: under 52,428,800 bytes. Install it (`adb install -r …app-release.apk`), sign in.

Change `pubspec.yaml` to `version: 0.1.1+1001`, rebuild the release APK, and have the user publish it from Dacs Web → App Updates (it must be filed under WorkMate). Reopen the installed 1000 build.
Expected: "New Update is Available", Version 0.1.1 → UPDATE NOW! → (Allow installs once) → INSTALL → the app restarts as 0.1.1 with the worker still signed in. The old DACS Attendance app on the same phone shows **no** update prompt.

- [ ] **Step 7: Close out**

In `Dacs Web/docs/superpowers/plans/2026-09-29-workmate-stage0-roadmap.md`, change the 0B row's File column to `[2026-09-30-workmate-stage0b-foundation.md](2026-09-30-workmate-stage0b-foundation.md) — done <date>`. Show `git status` in both repos and stop for the user to commit.

---

## Self-review notes

- Roadmap 0B scope → Task 1 (project, signing, debug suffix), Task 2 (headers), Tasks 3/5/6 (sign-in, eligibility, session persistence), Tasks 4/7 (Terms gate), Task 9 (home shell), Task 8 (updater on the WorkMate stream). Attendance parity is 0C/0D; switch-over is 0E.
- Offline startup: `SupabaseAuthBackend.presence()` treats "no in-memory session but a stored one" as unverifiable, because gotrue leaves `currentSession` null when an expired session cannot be refreshed offline. This is the Dart form of the Kotlin sign-out bug fix; Task 10 Step 3 checks it on a device.
- `flutter_secure_storage` defaults to `resetOnError: true` (wipes on first error); Task 5 turns it off, matching the Kotlin "retry before clear" rule.
