// ════════════════════════════════════════════════════════════════════
// APP UPDATES TESTS: run with  node tests/app-updates.test.js
//
// Zero dependencies. Loads the REAL js/app-updates-admin.js (it exports
// its pure half under Node) and guards the rules that stop a bad publish:
//   1. The version comes from the APK, and only a HIGHER one publishes.
//      Every phone below it is locked out of attendance (0077/0079).
//   2. A debug build, or some other app, is refused before upload.
//   3. The SHA-256 is the plain lower-case hex every phone compares with.
//
// Section IV parses a real APK from the sibling Dacs Attendance checkout
// when one has been built, and says SKIP otherwise.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const au = require('../js/app-updates-admin.js');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }

const real = { packageName: 'com.dacs.attendance', versionCode: 5, versionName: '0.5.0' };

(async () => {
  console.log('\nI. Only a newer version of the real app publishes');
  await test('a newer release build is accepted', () => eq(au.refusalFor(real, 4), null));
  await test('first ever publish (nothing published) is accepted', () => eq(au.refusalFor(real, 0), null));
  await test('the same version is refused', () => ok(/already published/.test(au.refusalFor(real, 5))));
  await test('an older version is refused', () => ok(/already published/.test(au.refusalFor(real, 6))));
  await test('a missing versionCode is refused', () =>
    ok(/version number/.test(au.refusalFor({ ...real, versionCode: null }, 0))));

  console.log('\nII. The wrong file is refused before upload');
  await test('a debug build is refused by name', () =>
    ok(/DEBUG/.test(au.refusalFor({ ...real, packageName: 'com.dacs.attendance.debug' }, 0))));
  await test('another app is refused', () =>
    ok(/not the DACS Attendance app/.test(au.refusalFor({ ...real, packageName: 'com.example.other' }, 0))));
  await test('not an app at all is refused', () => ok(/not an Android app/.test(au.refusalFor(null, 0))));
  await test('garbage bytes do not parse as an APK', async () => {
    let threw = false;
    try { await au.readApkManifest(new Uint8Array(1000).buffer); } catch (e) { threw = true; }
    ok(threw, 'expected a throw');
  });

  console.log('\nIII. The hash every phone checks against');
  await test('sha256Hex is lower-case hex and matches Node', async () => {
    const bytes = crypto.randomBytes(4096);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    eq(await au.sha256Hex(ab), crypto.createHash('sha256').update(bytes).digest('hex'));
  });
  await test('size shows in MB with one decimal', () => eq(au.formatSize(5 * 1024 * 1024), '5.0 MB'));

  console.log('\nIV. A real APK');
  const apkDir = path.join(__dirname, '..', '..', 'Dacs Attendance', 'app', 'build', 'outputs', 'apk');
  const candidates = ['release/app-release.apk', 'debug/app-debug.apk'].map(p => path.join(apkDir, p)).filter(fs.existsSync);
  if (!candidates.length) {
    console.log('  SKIP no built APK next door (build Dacs Attendance to run this section)');
  }
  for (const file of candidates) {
    await test('reads the manifest of ' + path.basename(file), async () => {
      const b = fs.readFileSync(file);
      const m = await au.readApkManifest(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      ok(/^com\.dacs\.attendance(\.debug)?$/.test(m.packageName), 'package ' + m.packageName);
      ok(Number.isInteger(m.versionCode) && m.versionCode > 0, 'versionCode ' + m.versionCode);
      ok(typeof m.versionName === 'string' && m.versionName.length > 0, 'versionName ' + m.versionName);
    });
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
