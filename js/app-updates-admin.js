// ════════════════════════════════════════════════════════════════════
// Attendance → App updates (migration 0079). Owner-only.
//
// The owner uploads a new worker APK here. Every phone on an older build
// then shows a required "New Update is Available" dialog that downloads
// and installs it (Dacs Attendance → ui/update/), and 0077 refuses that
// older build's Time In / Time Out until it does.
//
// The version is READ FROM THE APK, never typed: a hand-typed number that
// is one too high locks every phone out waiting for a build that does not
// exist. The SHA-256 computed here is what every phone checks its download
// against before installing.
//
// Works in a browser (window.initAppUpdatesModule) and in Node for
// tests/app-updates.test.js (module.exports), with no dependencies.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    const BUCKET = 'app-releases';
    const APK_MIME = 'application/vnd.android.package-archive';

    // Two worker apps on one backend (0082). The package name inside the APK
    // decides which stream a file is published into; the owner never picks.
    // Attendance versionCodes stay below 1000, WorkMate's start at 1000
    // (0078's trusted-time rule treats builds below 3 as legacy).
    const APPS = {
        attendance: {
            packageName: 'com.dacs.attendance',
            label: 'DACS Attendance',
            bump: 'Raise versionCode in build.gradle.kts',
            release: 'Build the signed release APK (assembleRelease) and upload that.',
            codeOk: (code) => code < 1000,
            codeRule: 'DACS Attendance version numbers must stay below 1000 (1000 and up belong to DAC\'S WorkMate).'
        },
        workmate: {
            packageName: 'com.dacs.workmate',
            label: 'DAC\'S WorkMate',
            bump: 'Raise the build number after "+" in pubspec.yaml',
            release: 'Build the signed release APK (flutter build apk --release) and upload that.',
            codeOk: (code) => code >= 1000,
            codeRule: 'DAC\'S WorkMate version numbers start at 1000. Set version: x.y.z+1000 (or higher) in pubspec.yaml.'
        }
    };

    function appForPackage(packageName) {
        for (const key of Object.keys(APPS)) if (APPS[key].packageName === packageName) return key;
        return null;
    }

    function storagePathFor(app, versionCode) {
        return app === 'attendance' ? versionCode + '.apk' : app + '/' + versionCode + '.apk';
    }

    // android.R.attr ids. aapt2 keeps the attribute NAMES too, but the id
    // is what Android itself reads, so it is what this trusts.
    const ATTR_VERSION_CODE = 0x0101021b;
    const ATTR_VERSION_NAME = 0x0101021c;

    // ── Reading the APK ─────────────────────────────────────────────

    /** Finds and inflates one entry of a zip (an APK is one). */
    async function zipEntry(buf, wanted) {
        const dv = new DataView(buf);
        // End of central directory: last 22 bytes, plus up to 64 KB of comment.
        let eocd = -1;
        for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('NOT_A_ZIP');

        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        const dec = new TextDecoder();

        for (let n = 0; n < count; n++) {
            if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('NOT_A_ZIP');
            const method = dv.getUint16(p + 10, true);
            const csize = dv.getUint32(p + 20, true);
            const nameLen = dv.getUint16(p + 28, true);
            const extraLen = dv.getUint16(p + 30, true);
            const commentLen = dv.getUint16(p + 32, true);
            const local = dv.getUint32(p + 42, true);
            const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));

            if (name === wanted) {
                const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
                const raw = new Uint8Array(buf, start, csize);
                if (method === 0) return raw.slice().buffer;
                if (method !== 8) throw new Error('UNSUPPORTED_ZIP');
                const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                return await new Response(stream).arrayBuffer();
            }
            p += 46 + nameLen + extraLen + commentLen;
        }
        throw new Error('NOT_AN_APK');
    }

    /** Android's binary XML string pool: UTF-8 or UTF-16. */
    function readStringPool(dv, at) {
        const count = dv.getUint32(at + 8, true);
        const flags = dv.getUint32(at + 16, true);
        const stringsStart = dv.getUint32(at + 20, true);
        const headerSize = dv.getUint16(at + 2, true);
        const utf8 = (flags & 0x100) !== 0;
        const u8 = new TextDecoder('utf-8');
        const u16 = new TextDecoder('utf-16le');
        const out = [];

        for (let i = 0; i < count; i++) {
            let s = at + stringsStart + dv.getUint32(at + headerSize + i * 4, true);
            if (utf8) {
                // char count, then byte count; each 1 or 2 bytes.
                if (dv.getUint8(s) & 0x80) s += 2; else s += 1;
                let len = dv.getUint8(s);
                if (len & 0x80) { len = ((len & 0x7f) << 8) | dv.getUint8(s + 1); s += 2; } else s += 1;
                out.push(u8.decode(new Uint8Array(dv.buffer, dv.byteOffset + s, len)));
            } else {
                let len = dv.getUint16(s, true);
                if (len & 0x8000) { len = ((len & 0x7fff) << 16) | dv.getUint16(s + 2, true); s += 4; } else s += 2;
                out.push(u16.decode(new Uint8Array(dv.buffer, dv.byteOffset + s, len * 2)));
            }
        }
        return out;
    }

    /**
     * { packageName, versionCode, versionName } from the APK's compiled
     * AndroidManifest.xml. Reads only the <manifest> element.
     */
    async function readApkManifest(apkBuffer) {
        const xml = await zipEntry(apkBuffer, 'AndroidManifest.xml');
        const dv = new DataView(xml);
        if (dv.getUint16(0, true) !== 0x0003) throw new Error('NOT_AN_APK');

        let strings = [];
        let resIds = [];
        let p = dv.getUint16(2, true);

        while (p < xml.byteLength) {
            const type = dv.getUint16(p, true);
            const headerSize = dv.getUint16(p + 2, true);
            const size = dv.getUint32(p + 4, true);

            if (type === 0x0001) {
                strings = readStringPool(dv, p);
            } else if (type === 0x0180) {
                for (let q = p + headerSize; q < p + size; q += 4) resIds.push(dv.getUint32(q, true));
            } else if (type === 0x0102) {
                const ext = p + headerSize;
                if (strings[dv.getUint32(ext + 4, true)] !== 'manifest') throw new Error('NOT_AN_APK');
                const attrStart = dv.getUint16(ext + 8, true);
                const attrSize = dv.getUint16(ext + 10, true);
                const attrCount = dv.getUint16(ext + 12, true);

                const result = { packageName: null, versionCode: null, versionName: null };
                for (let a = 0; a < attrCount; a++) {
                    const at = ext + attrStart + a * attrSize;
                    const nameIdx = dv.getUint32(at + 4, true);
                    const rawIdx = dv.getUint32(at + 8, true);
                    const dataType = dv.getUint8(at + 15);
                    const data = dv.getUint32(at + 16, true);
                    const id = resIds[nameIdx];
                    const name = strings[nameIdx];
                    const str = rawIdx !== 0xffffffff ? strings[rawIdx]
                        : (dataType === 0x03 ? strings[data] : null);

                    if (id === ATTR_VERSION_CODE || name === 'versionCode') {
                        // 0x10 decimal / 0x11 hex int. Anything else (a
                        // resource reference) cannot be trusted here.
                        if (dataType === 0x10 || dataType === 0x11) result.versionCode = data;
                    } else if (id === ATTR_VERSION_NAME || name === 'versionName') {
                        result.versionName = str;
                    } else if (name === 'package') {
                        result.packageName = str;
                    }
                }
                return result;
            }
            p += size;
        }
        throw new Error('NOT_AN_APK');
    }

    async function sha256Hex(buffer) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Why this file may not be published, in the owner's words -- or null.
     * [latest] is the highest version already published: a number (compared
     * with the file's own app), or { attendance: n, workmate: m }.
     */
    function refusalFor(manifest, latest) {
        if (!manifest || !manifest.packageName) return 'This file is not an Android app.';
        for (const key of Object.keys(APPS)) {
            if (manifest.packageName === APPS[key].packageName + '.debug') {
                return 'This is a DEBUG build. Phones cannot install it as an update. ' + APPS[key].release;
            }
        }
        const app = appForPackage(manifest.packageName);
        if (!app) {
            return 'This is not the DACS Attendance app or DAC\'S WorkMate (' + manifest.packageName + ').';
        }
        if (!manifest.versionCode) return 'Could not read the version number from this file.';
        if (!APPS[app].codeOk(manifest.versionCode)) return APPS[app].codeRule;
        const published = typeof latest === 'number' ? latest : ((latest && latest[app]) || 0);
        if (manifest.versionCode <= published) {
            return 'This is version ' + manifest.versionCode + ', but version ' + published +
                   ' is already published. ' + APPS[app].bump + ', rebuild, and upload again.';
        }
        return null;
    }

    function formatSize(bytes) {
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    const pure = { readApkManifest, sha256Hex, refusalFor, formatSize, appForPackage, storagePathFor, APPS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── The screen ──────────────────────────────────────────────────

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function icons() {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }

    /** Server codes → sentences an owner can act on. */
    function publishError(error) {
        const text = (error && (error.message || error.error || '')) + '';
        if (text.includes('VERSION_NOT_NEWER')) return 'A same or newer version is already published. Reload the page.';
        if (text.includes('OWNER_REQUIRED')) return 'Only the owner account can publish app updates.';
        if (text.includes('APK_SIZE_MISMATCH')) return 'The upload did not arrive complete. Try again.';
        if (text.includes('APK_NOT_UPLOADED')) return 'The upload did not arrive. Try again.';
        if (text.includes('APP_UNKNOWN')) return 'This app is not recognised by the server. Reload the page.';
        return 'Could not publish: ' + text;
    }

    async function loadReleases() {
        const { data, error } = await root.sbClient.rpc('app_list_releases');
        if (error) throw error;
        return data || [];
    }

    async function render(container) {
        container.innerHTML =
            '<div class="att-stack">' +
            '<div class="att-head"><div>' +
              '<h2 class="att-title">App updates</h2>' +
              '<div class="att-sub">Publish a new version of a worker app: DACS Attendance or DAC\'S WorkMate. The file itself says which app it is. Every phone on an older version of that app must update before it can Time In or Time Out.</div>' +
            '</div></div>' +

            '<div class="att-card"><div class="att-card-head"><div>' +
              '<h3 class="att-card-title">Publish a new version</h3>' +
              '<p class="att-card-sub">Upload the signed release APK. The version number is read from the file.</p>' +
            '</div></div><div class="att-card-body">' +
              '<div class="att-info att-info--warn" style="margin-bottom:16px">' +
                '<strong>Use the same signing key every time.</strong> Phones refuse an update signed with a different key, ' +
                'and a debug build cannot be installed over the real app.' +
              '</div>' +
              '<div class="att-field"><label for="auFile">APK file</label>' +
                '<input class="att-input" type="file" id="auFile" accept=".apk,' + APK_MIME + '"></div>' +
              '<div id="auFacts" class="att-note"></div>' +
              '<div class="att-field" style="margin-top:14px"><label for="auNotes">What\'s new (optional, shown to workers)</label>' +
                '<textarea class="att-input" id="auNotes" rows="3" maxlength="500" placeholder="Fixed the camera on older phones"></textarea></div>' +
              '<div id="auError" class="att-error" style="display:none"></div>' +
              '<div class="att-actions" style="margin-top:16px">' +
                '<button class="att-btn att-btn--primary" type="button" id="auPublish" disabled>' +
                  '<i data-lucide="upload"></i>Publish update</button>' +
              '</div>' +
            '</div></div>' +

            '<div class="att-card"><div class="att-card-head"><div>' +
              '<h3 class="att-card-title">Published versions</h3>' +
              '<p class="att-card-sub">Each phone downloads the newest one once. Mind the size: every worker downloads it.</p>' +
            '</div></div><div class="att-card-body" id="auHistory">Loading…</div></div>' +
            '</div>';

        const fileInput = container.querySelector('#auFile');
        const facts = container.querySelector('#auFacts');
        const notes = container.querySelector('#auNotes');
        const errorBox = container.querySelector('#auError');
        const publishBtn = container.querySelector('#auPublish');
        const history = container.querySelector('#auHistory');

        let releases = [];
        let picked = null; // { file, buffer, manifest, sha }

        function showError(msg) {
            errorBox.textContent = msg || '';
            errorBox.style.display = msg ? '' : 'none';
        }

        // Highest published version per app. Rows arrive ordered by app, then newest first.
        function latest() {
            const out = { attendance: 0, workmate: 0 };
            for (const r of releases) {
                const app = r.app || 'attendance';
                if (r.version_code > (out[app] || 0)) out[app] = r.version_code;
            }
            return out;
        }

        function paintHistory() {
            if (!releases.length) {
                history.innerHTML = '<div class="att-empty">Nothing published yet. Phones keep the version they have until you publish one here.</div>';
                return;
            }
            const seen = {};
            history.innerHTML =
                '<table class="att-table"><thead><tr>' +
                '<th>App</th><th>Version</th><th>What\'s new</th><th>Size</th><th>Published</th><th></th>' +
                '</tr></thead><tbody>' +
                releases.map((r) => {
                    const app = r.app || 'attendance';
                    const current = !seen[app];
                    seen[app] = true;
                    return '<tr>' +
                        '<td>' + esc((APPS[app] && APPS[app].label) || app) + '</td>' +
                        '<td><strong>' + esc(r.version_name) + '</strong> <span class="att-mono">(' + esc(r.version_code) + ')</span></td>' +
                        '<td>' + (r.release_notes ? esc(r.release_notes) : '<span class="att-note">—</span>') + '</td>' +
                        '<td class="att-mono">' + esc(formatSize(r.size_bytes)) + '</td>' +
                        '<td>' + esc(new Date(r.published_at).toLocaleString('en-PH',
                            { dateStyle: 'medium', timeStyle: 'short' })) + '</td>' +
                        '<td>' + (current ? '<span class="att-pill att-pill--done">Current</span>' : '') + '</td>' +
                        '</tr>';
                }).join('') +
                '</tbody></table>';
        }

        async function refresh() {
            try {
                releases = await loadReleases();
                paintHistory();
            } catch (e) {
                history.innerHTML = '<div class="att-error">Could not load published versions: ' + esc(e.message || e) + '</div>';
            }
        }

        fileInput.addEventListener('change', async function () {
            picked = null;
            publishBtn.disabled = true;
            showError('');
            facts.textContent = '';
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;

            facts.textContent = 'Reading ' + file.name + '…';
            try {
                const buffer = await file.arrayBuffer();
                const manifest = await readApkManifest(buffer);
                const refusal = refusalFor(manifest, latest());
                if (refusal) { facts.textContent = ''; showError(refusal); return; }
                const sha = await sha256Hex(buffer);
                picked = { file, buffer, manifest, sha };
                facts.innerHTML =
                    '<strong>' + esc(APPS[appForPackage(manifest.packageName)].label) + '</strong> · ' +
                    '<strong>Version ' + esc(manifest.versionName || '?') + '</strong> ' +
                    '<span class="att-mono">(versionCode ' + esc(manifest.versionCode) + ')</span> · ' +
                    esc(formatSize(file.size)) + '<br><span class="att-mono" style="font-size:11px">SHA-256 ' + esc(sha) + '</span>';
                publishBtn.disabled = false;
            } catch (e) {
                facts.textContent = '';
                showError('This file could not be read as an Android app (' + (e.message || e) + ').');
            }
        });

        publishBtn.addEventListener('click', async function () {
            if (!picked) return;
            const m = picked.manifest;
            const app = appForPackage(m.packageName);
            const ok = confirm(
                'Publish ' + APPS[app].label + ' version ' + (m.versionName || m.versionCode) + '?\n\n' +
                'Every phone on an older version of ' + APPS[app].label + ' will be BLOCKED from Time In and Time Out ' +
                'until it installs this update.\n\n' +
                'Make sure this APK is already on at least one phone and working before you publish.'
            );
            if (!ok) return;

            publishBtn.disabled = true;
            showError('');
            const path = storagePathFor(app, m.versionCode);
            const storage = root.sbClient.storage.from(BUCKET);

            try {
                let up = await storage.upload(path, picked.file, { contentType: APK_MIME, upsert: false });
                // Left behind by an earlier publish that was refused: it
                // never became a release, so the policy lets us replace it.
                if (up.error && /exists|duplicate/i.test(up.error.message || '')) {
                    await storage.remove([path]);
                    up = await storage.upload(path, picked.file, { contentType: APK_MIME, upsert: false });
                }
                if (up.error) throw up.error;

                const { error } = await root.sbClient.rpc('app_publish_release', {
                    p_version_code: m.versionCode,
                    p_version_name: m.versionName || String(m.versionCode),
                    p_release_notes: notes.value.trim() || null,
                    p_size_bytes: picked.file.size,
                    p_sha256: picked.sha,
                    p_app: app
                });
                if (error) {
                    await storage.remove([path]); // not a release; don't leave 5 MB behind
                    throw error;
                }

                fileInput.value = '';
                notes.value = '';
                facts.innerHTML = '<strong>Published.</strong> Phones will show the update the next time the app is opened with internet.';
                picked = null;
                await refresh();
            } catch (e) {
                showError(publishError(e));
                publishBtn.disabled = false;
            }
        });

        icons();
        await refresh();
    }

    root.initAppUpdatesModule = function (container) {
        if (container) render(container);
    };
    root.AppUpdatesApk = pure;
})(typeof window !== 'undefined' ? window : globalThis);
