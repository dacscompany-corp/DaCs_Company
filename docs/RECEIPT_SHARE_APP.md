# Receipt Share app (`android-receipt-share/`)

A small Android app whose only job is to sit in the share sheet and hand a
receipt photo to [share-capture.html](../share-capture.html).

---

## Why it exists

The Expense Inbox was built on the **PWA Web Share Target** in
`manifest-admin-v2.json`: share a receipt → Chrome POSTs it to
`/share-capture.html` → [service-worker.js](../service-worker.js) intercepts the
POST and stashes the file → the wizard reads it back.

**That route is dead on MIUI/HyperOS (Xiaomi / Redmi / POCO).** Chrome launches
the app and honours the share target — correct action, method and enctype — then
posts a body of **exactly 75 bytes**, which is `--<boundary>--\r\n`: a multipart
form with **zero parts**. The photo is never attached.

Investigated end to end on 2026-09-23 and confirmed **not a bug in this repo**:

| Ruled out | Evidence |
|---|---|
| Service worker not running | `swActive: true`, `swRan: true`, `stage: "done"`, no error |
| Form field-name drift | `media` since the first commit; the worker now accepts *any* field name |
| `"multiple": true` in the share target | Removed — no change |
| Stale installed app | Forced a fresh build (manifest renamed to `-v2`, new `id`); `chrome://webapks` showed Version code 1 against the new manifest — still failed |
| Something specific to one phone | Two phones, both failed; Gallery and Messenger both failed |
| **Anything in this project** | **`squoosh.app` — Google's own reference PWA with an image share target — fails identically on the same phones** |

The break is in the Android → Chrome file handoff, upstream of every line here.
No manifest edit or service-worker change can fix it. A real app can, because the
file never crosses that boundary.

---

## What it does

1. Registers for `ACTION_SEND` / `ACTION_SEND_MULTIPLE` on `image/*` and
   `application/pdf`, appearing in the share sheet as **DAC's Admin — Receipt**.
2. Reads the shared file itself, natively.
3. Opens `share-capture.html?native=1` in a WebView and exposes
   `window.DacsNative` — `fileCount()`, `fileAt(i)`, `manifest()`.
4. The page pulls the receipt over that bridge in `scLoadNativeFiles()` and runs
   the **existing** wizard unchanged.

**It uploads nothing and knows nothing** about projects, expense types, Supabase
or the money model. That all stays in the web wizard, so the Expense Inbox has
one implementation rather than two — the same reason this repo keeps one JS file
behind two portal HTMLs.

When `window.DacsNative` is present the service-worker cache is skipped entirely
(`scLoadNativeFiles()` returns `true` and the boot path short-circuits): in this
flow there is no share-sheet POST at all. Sharing into **Chrome** still uses the
old service-worker route, so nothing regresses for a device where it works.

---

## Building

Needs **JDK 21** — AGP 8.9.1 supports 17–21 and fails on 25. `gradle.properties`
pins `org.gradle.java.home` to the Temurin 21 install for exactly this reason;
change that line if your JDK lives elsewhere.

```bash
cd android-receipt-share
# local.properties is gitignored — create it once, forward slashes:
echo 'sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk' > local.properties
./gradlew assembleRelease
```

Output: `app/build/outputs/apk/release/app-release.apk` (~2.5 MB).

Signed with the **debug key** on purpose — this is an internal tool that is
sideloaded, never a Play Store listing. It needs no keystore ceremony, but it
also means Android will warn about an unknown source on first install.

> Do not confuse this with [`android/`](../android/), the dormant bubblewrap TWA
> for the *client* portal. That one still points at `dacscompany-corp.github.io`,
> which is dead (every path 404s), and is not a base for this.

---

## Installing on a phone

1. Copy `app-release.apk` to the phone.
2. Tap it; allow "install unknown apps" for whatever app is doing the opening.
3. Share any receipt → pick **DAC's Admin — Receipt**.
4. Log in once inside the app. The WebView keeps its own session, separate from
   Chrome, and it persists.

---

## If a receipt does not come through

Open **Show details** on the photo step. `"native": true` means the app is
hosting the page; `nativeCount` is how many files it handed over. If that is `0`,
the share sheet gave the app nothing — rare, and the **Pick the photo** button
still works.

The old web-only diagnostics (`swRan`, `bodyBytes`, `entries`) only apply when
sharing into Chrome rather than this app.
