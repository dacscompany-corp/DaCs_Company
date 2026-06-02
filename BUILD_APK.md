# DAC's Client Portal – Android APK Build Guide
## PWA → TWA → APK (Trusted Web Activity)

---

## What Was Added

| File | Purpose |
|------|---------|
| `manifest.json` | Web App Manifest – tells browsers/Android about the app |
| `sw.js` | Service Worker – enables offline caching |
| `icons/icon-192.png` | Standard launcher icon (192×192) |
| `icons/icon-192-maskable.png` | Maskable launcher icon (192×192) |
| `icons/icon-512.png` | Standard splash/store icon (512×512) |
| `icons/icon-512-maskable.png` | Maskable splash/store icon (512×512) |
| `twa-manifest.json` | Bubblewrap CLI config for Android TWA project |
| `.well-known/assetlinks.json` | Digital Asset Links (TWA domain verification) |
| `generate-icons.py` | Script that generated the icons above |

`client.html` was updated with:
- `<link rel="manifest">` tag
- PWA meta tags (theme-color, apple-touch-icon, etc.)
- Service worker registration script

---

## Step 1 – Push Changes to GitHub

Commit and push all new files to your `dacscompany-corp/Dacs-Company` repository.

```bash
git add manifest.json sw.js icons/ .well-known/ client.html twa-manifest.json
git commit -m "Add PWA support: manifest, service worker, icons"
git push
```

---

## Step 2 – Add assetlinks.json to the Domain Root

> **This is required for TWA verification.** It must live at:
> `https://dacscompany-corp.github.io/.well-known/assetlinks.json`

Since your site is a GitHub Project Page (not the root org page), you need to:

1. Go to GitHub and open (or create) the repo: `dacscompany-corp/dacscompany-corp.github.io`
2. Create the file: `.well-known/assetlinks.json`
3. Paste the content from your local `.well-known/assetlinks.json` *(but first complete Step 4 below to get the real SHA256 fingerprint)*

---

## Step 3 – Install Build Prerequisites

You need **Node.js**, **Java JDK 17+**, and **Android SDK**.

### 3a. Install Bubblewrap CLI
```bash
npm install -g @bubblewrap/cli
```

### 3b. Install JDK (if not already installed)
Download from: https://adoptium.net/ (Temurin 17 or 21)

### 3c. Android SDK
Bubblewrap will prompt to download the Android SDK automatically on first run.

---

## Step 4 – Generate the Android Project

Run this from the `Dacs Web` project folder:

```bash
bubblewrap init --manifest https://dacscompany-corp.github.io/Dacs-Company/manifest.json
```

Bubblewrap will:
- Read your online `manifest.json`
- Ask a few questions (package ID, app name, signing key)
- Generate an Android Gradle project in an `android/` subfolder

**Recommended answers when prompted:**
| Prompt | Answer |
|--------|--------|
| Package ID | `com.dacscompany.clientportal` |
| App name | `DAC's Client Portal` |
| Launcher name | `DACs Portal` |
| Start URL | `https://dacscompany-corp.github.io/Dacs-Company/client` |
| Key alias | `android` |
| Key store path | `android/signing-keystore.jks` |

---

## Step 5 – Build the APK

```bash
bubblewrap build
```

This produces:
- `android/app-release-unsigned.apk` – unsigned build
- `android/app-release-signed.apk` – signed & ready to install

---

## Step 6 – Get Your SHA256 Fingerprint

After the keystore is created (during `bubblewrap init`), get the fingerprint:

```bash
keytool -list -v -keystore android/signing-keystore.jks -alias android
```

Copy the **SHA256** fingerprint and paste it into:
- Your local `.well-known/assetlinks.json`
- The same file in `dacscompany-corp.github.io` repo (see Step 2)

---

## Step 7 – Verify TWA Linking

After pushing `assetlinks.json` to GitHub, verify it works:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://dacscompany-corp.github.io&relation=delegate_permission/common.handle_all_urls
```

Should return your `com.dacscompany.clientportal` package.

---

## Step 8 – Install on Android Device

Enable **Developer Options** → **Install via USB / ADB**:

```bash
adb install android/app-release-signed.apk
```

Or simply transfer the APK file to the Android device and tap to install (requires "Install from unknown sources" enabled in Settings).

---

## Alternative: PWABuilder (No-Code Option)

If you prefer not to use the CLI:

1. Go to https://www.pwabuilder.com
2. Enter: `https://dacscompany-corp.github.io/Dacs-Company/client`
3. Click **Build My PWA** → **Android** → **Download Package**
4. Follow the included instructions to sign and install the APK

---

## Notes

- The app requires an internet connection for Firebase authentication and data.
- Offline mode shows a cached shell (login screen) but cannot authenticate without connectivity.
- To publish on Google Play Store, you'll also need a Play Console account ($25 one-time fee).
- Icons in `icons/` can be replaced with custom branded artwork at any time.
