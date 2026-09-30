# DAC'S WorkMate — Stage 0 Roadmap

**Spec:** [docs/superpowers/specs/2026-09-29-unified-worker-app-design.md](../specs/2026-09-29-unified-worker-app-design.md) §1 (name, Flutter/Dart, packaging), §3 (Attendance stays the same), §6 (build order).

**Stage 0 = WorkMate exists and does everything the current Attendance app does, and workers can switch
to it without losing a day.** No material requests yet: those are Stage 1a, on top of Stage 0.

Stage 0 spans five separate subsystems, so it is split into five plans. Each one ships something
testable on its own and is written **just before it is executed**, because later plans depend on the
real code the earlier ones produce.

| Plan | Delivers | Depends on | File |
|---|---|---|---|
| **0A. Server support** | The server tells the two apps apart: a per-app minimum version, per-app release streams, and a publisher that accepts both APKs | — | [2026-09-29-workmate-stage0a-server-support.md](2026-09-29-workmate-stage0a-server-support.md) |
| **0B. WorkMate foundation** | New Flutter project, signing and debug suffix, Supabase client sending the WorkMate headers, sign-in with the existing worker accounts and eligibility rules, session persistence, terms gate, home shell, in-app updater on the WorkMate stream | 0A applied | [2026-09-30-workmate-stage0b-foundation.md](2026-09-30-workmate-stage0b-foundation.md) — **done 2026-09-30**: repo `dacscompany-corp/DAC-S-Workmate`; verified on a Xiaomi (Android 14): worker sign-in with shared Terms, staff refused, offline launch, log out, and a real 0.1.0→0.1.1 in-app update (WorkMate stream min 1001; Attendance stream untouched) |
| **0C. Attendance core parity** | Time In / Time Out with tamper-proof trusted time, location and geofence checks (mock and location-off), camera photo with overlay and sampling, per-worker offline queue with background sync, today reconcile and history | 0B | written after 0B |
| **0D. Attendance extras parity** | Weekly reward view, home-screen widget, profile and password change, update nudges | 0C | written after 0C |
| **0E. Switch-over** | An update to the OLD app with a "Switch to DAC'S WorkMate" card: drains its offline queue first, then downloads and installs WorkMate from the WorkMate stream; a "moved to WorkMate" state; the rollout checklist and the criteria for retiring the old app | 0C (0D recommended) | written after 0C |

## Decisions carried into every Stage 0 plan

| Topic | Decision | Source |
|---|---|---|
| App | A **new, separate Android app** named **DAC'S WorkMate**, publisher line "By Dacs Building Design Services" | User, 2026-09-29 |
| Framework | **Flutter with Dart** | Spec §1 |
| Platforms | **Android only** for the first release | User, 2026-09-29 |
| Old app | `com.dacs.attendance` **keeps being maintained** during Stage 0; it is not frozen | User, 2026-09-29 |
| Android application id | **`com.dacs.workmate`** (debug builds: `com.dacs.workmate.debug`). Permanent once the first release is published | Proposed in 0A; change only before the first WorkMate publish |
| Version numbers | WorkMate `versionCode` is **1000 or higher**; the old app stays **below 1000** | 0A. Reason: 0078's `attendance_vouched_time` trusts the phone clock for any build below 3, and stored `timein_app_version` numbers must never be ambiguous between the two apps |
| App identity on requests | WorkMate sends **`x-dacs-app: workmate`** plus its own `x-dacs-app-version`; the old app sends no `x-dacs-app` and is treated as `attendance` | 0A |
| Repository | A new sibling folder and git repo: `C:\Users\John Aerol Tapales\Documents\Dacs WorkMate` (like `Dacs Attendance`) | 0B |
| Signing key | WorkMate gets its **own release keystore**, backed up next to the Attendance one; losing it means no update can ever be installed over WorkMate | 0B |
| Behaviour reference | The Kotlin app (`Documents/Dacs Attendance`, 98 source files, 14,539 lines, 294 unit tests) is the behavioural reference. Kotlin screens are not reusable; its **rules and test cases** are ported to Dart tests | Spec §1 |
| Backend | The same Supabase project `hqbgduyonlbbsvjuapre`, the same RPCs (`attendance_time_in`, `attendance_time_out`, …) and the same `attendance` photo bucket. **No duplicate worker accounts** | Spec §1 |

## Parity checklist (what "does everything the old app does" means)

Each row is ported with its Kotlin unit tests as the acceptance cases. Plan 0C/0D lists them per task.

| Area | Kotlin reference (`com.dacs.attendance…`) |
|---|---|
| Sign-in, eligibility (worker / teamLeader, active), session kept across restarts | `data/remote/SignInApi.kt`, `domain/WorkerProfile.kt`, `domain/SessionGate.kt`, `domain/StartupGate.kt`, `domain/LoginFailure.kt` |
| Terms gate | `domain/TermsGate.kt`, `domain/AttendanceTerms.kt`, `data/repo/SupabaseTermsRepository.kt` |
| Trusted time (uptime-anchored server time) | `domain/TrustedTime.kt`, `data/local/ClockAnchorStore.kt` |
| Location, geofence, mock location, location switched off | `domain/LocationVerification.kt`, `data/local/LocationProvider.kt` |
| Camera photo, overlay caption, orientation, sampling | `domain/PhotoOverlay.kt`, `domain/CaptionFit.kt`, `domain/PhotoSampling.kt`, `data/local/PhotoStore.kt` |
| Offline queue: per-worker, Time In before Time Out, retry vs drop vs fail | `domain/SubmissionQueue.kt`, `work/SubmissionWorker.kt`, `data/local/Entities.kt` (`pending_submission`) |
| Work date, total hours, today reconcile, history | `domain/WorkDate.kt`, `domain/TotalHours.kt`, `domain/TodayReconcile.kt`, `domain/History.kt` |
| Weekly reward | `domain/WeeklyReward.kt`, `data/repo/RewardRepository.kt` |
| Home-screen widget | `widget/DacsTimeWidget.kt`, `domain/WidgetState.kt` |
| In-app update + version gate | `domain/AppUpdate.kt`, `data/repo/AppUpdateRepository.kt`, `data/local/ApkInstaller.kt`, `data/remote/UpdateNudges.kt` |
| Password change, greeting, description chips | `domain/PasswordChange.kt`, `domain/Greeting.kt`, `domain/DescriptionChips.kt` |

## Stage 0 is done when

1. Plans 0A–0E are complete and their reviews are clean.
2. WorkMate passes every parity row above on a real phone, including one full offline day that syncs later.
3. At least one pilot worker has switched through the old app's card with no lost Time In.
4. The spec's §6 build order gains a "Stage 0" row. (The spec update is a separate, user-approved edit.)
