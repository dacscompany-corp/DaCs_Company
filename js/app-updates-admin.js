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

    // ── Screen helpers ──────────────────────────────────────────────

    const APP_ORDER = ['attendance', 'workmate'];

    function fmtDate(iso) {
        return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
    }
    function appLabel(app) { return (APPS[app] && APPS[app].label) || app; }

    async function render(container) {
        container.innerHTML =
            '<div class="att-stack au">' +
              '<div class="att-head"><div>' +
                '<h2 class="att-title">App updates</h2>' +
                '<div class="att-sub">Publish a new version of a worker app. Every phone on an older version of that app must update before it can Time In or Time Out.</div>' +
              '</div></div>' +

              // What is live right now, per app: the first thing an owner
              // wants to know, and it used to sit below the fold in a table.
              '<div class="au-live" id="auLive"></div>' +

              '<div class="att-card"><div class="att-card-head"><div>' +
                '<h3 class="att-card-title">Publish a new version</h3>' +
                '<p class="att-card-sub">Upload the signed release APK. The file itself says which app it is, and the version number is read from it.</p>' +
              '</div></div><div class="att-card-body">' +
                '<div class="att-info att-info--warn"><i data-lucide="key-round"></i><div>' +
                  '<strong>Use the same signing key every time.</strong> Phones refuse an update signed with a different key, ' +
                  'and a debug build cannot be installed over the real app.</div></div>' +

                '<div class="au-step"><div class="au-step-n">1</div><div class="au-step-main">' +
                  '<div class="au-step-title">Choose the APK</div>' +
                  '<label class="au-drop" id="auDrop" for="auFile">' +
                    '<i data-lucide="upload-cloud"></i>' +
                    '<span class="au-drop-text"><strong id="auDropTitle">Choose the release APK</strong>' +
                    '<span id="auDropSub">or drop the file here</span></span>' +
                  '</label>' +
                  '<input class="au-file-input" type="file" id="auFile" accept=".apk,' + APK_MIME + '">' +
                  '<div id="auError" class="att-error" style="display:none"></div>' +
                  '<div id="auFacts"></div>' +
                '</div></div>' +

                '<div class="au-step"><div class="au-step-n">2</div><div class="au-step-main">' +
                  '<label class="au-step-title" for="auNotes">What\'s new <span class="au-opt">optional, shown to workers</span></label>' +
                  '<textarea class="att-input" id="auNotes" rows="3" maxlength="500" placeholder="Fixed the camera on older phones"></textarea>' +
                  '<div class="au-counter" id="auCount">0 / 500</div>' +
                '</div></div>' +

                '<div class="au-actions">' +
                  '<span class="au-hint" id="auHint">Choose an APK to continue.</span>' +
                  '<button class="att-btn" type="button" id="auClear" style="display:none">Choose another file</button>' +
                  '<button class="att-btn att-btn--primary" type="button" id="auPublish" disabled>' +
                    '<i data-lucide="upload"></i>Publish update</button>' +
                '</div>' +
              '</div></div>' +

              '<div class="att-card"><div class="att-card-head au-hist-head"><div>' +
                '<h3 class="att-card-title">Published versions</h3>' +
                '<p class="att-card-sub">Each phone downloads the newest one once. Mind the size: every worker downloads it.</p>' +
              '</div><div class="att-seg" id="auFilter" role="group" aria-label="Show versions of"></div></div>' +
              '<div class="att-card-body" id="auHistory" style="padding:0">Loading…</div></div>' +
            '</div>';

        const fileInput = container.querySelector('#auFile');
        const drop = container.querySelector('#auDrop');
        const dropTitle = container.querySelector('#auDropTitle');
        const dropSub = container.querySelector('#auDropSub');
        const facts = container.querySelector('#auFacts');
        const notes = container.querySelector('#auNotes');
        const counter = container.querySelector('#auCount');
        const errorBox = container.querySelector('#auError');
        const hint = container.querySelector('#auHint');
        const clearBtn = container.querySelector('#auClear');
        const publishBtn = container.querySelector('#auPublish');
        const history = container.querySelector('#auHistory');
        const live = container.querySelector('#auLive');
        const filterBar = container.querySelector('#auFilter');

        let releases = [];
        let picked = null; // { file, buffer, manifest, sha }
        let histFilter = 'all';
        let readToken = 0;

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
        function currentRow(app) {
            let best = null;
            for (const r of releases) {
                if ((r.app || 'attendance') === app && (!best || r.version_code > best.version_code)) best = r;
            }
            return best;
        }

        function paintLive() {
            live.innerHTML = APP_ORDER.map(function (app) {
                const r = currentRow(app);
                return '<div class="au-app">' +
                    '<div class="au-app-top"><span class="au-app-name">' + esc(appLabel(app)) + '</span>' +
                      (r ? '<span class="att-pill att-pill--done">Live now</span>' : '<span class="att-pill att-pill--none">Nothing yet</span>') + '</div>' +
                    (r
                        ? '<div class="au-app-version">' + esc(r.version_name) + ' <span class="au-code">(' + esc(r.version_code) + ')</span></div>' +
                          '<div class="au-app-meta">' + esc(formatSize(r.size_bytes)) + ' · published ' + esc(fmtDate(r.published_at)) + '</div>'
                        : '<div class="au-app-meta">Nothing published yet. Phones keep the version they have until you publish one here.</div>') +
                    '</div>';
            }).join('');
        }

        function paintHistory() {
            const counts = { all: releases.length, attendance: 0, workmate: 0 };
            releases.forEach(r => { counts[r.app || 'attendance'] = (counts[r.app || 'attendance'] || 0) + 1; });
            filterBar.innerHTML =
                '<button type="button" class="att-seg-btn' + (histFilter === 'all' ? ' is-on' : '') + '" data-f="all">All <span class="au-n">' + counts.all + '</span></button>' +
                APP_ORDER.map(app => '<button type="button" class="att-seg-btn' + (histFilter === app ? ' is-on' : '') + '" data-f="' + app + '">' +
                    esc(appLabel(app)) + ' <span class="au-n">' + (counts[app] || 0) + '</span></button>').join('');

            if (!releases.length) {
                history.innerHTML = '<div class="att-empty">Nothing published yet. Phones keep the version they have until you publish one here.</div>';
                return;
            }
            const rows = releases.filter(r => histFilter === 'all' || (r.app || 'attendance') === histFilter);
            const top = latest();
            history.innerHTML = !rows.length
                ? '<div class="att-empty">No versions of this app yet.</div>'
                : '<div class="au-table-wrap"><table class="att-table"><thead><tr>' +
                  '<th>Version</th><th>App</th><th>What\'s new</th><th>Size</th><th>Published</th><th></th>' +
                  '</tr></thead><tbody>' +
                  rows.map(function (r) {
                      const app = r.app || 'attendance';
                      const current = r.version_code === top[app];
                      return '<tr class="' + (current ? 'au-row-current' : '') + '">' +
                          '<td><strong>' + esc(r.version_name) + '</strong> <span class="au-code">(' + esc(r.version_code) + ')</span></td>' +
                          '<td><span class="att-pill ' + (app === 'workmate' ? 'att-pill--pm' : 'att-pill--pc') + '">' + esc(appLabel(app)) + '</span></td>' +
                          '<td>' + (r.release_notes ? esc(r.release_notes) : '<span class="au-muted">—</span>') + '</td>' +
                          '<td>' + esc(formatSize(r.size_bytes)) + '</td>' +
                          '<td>' + esc(fmtDate(r.published_at)) + '</td>' +
                          '<td>' + (current ? '<span class="att-pill att-pill--done">Current</span>' : '') + '</td>' +
                          '</tr>';
                  }).join('') +
                  '</tbody></table></div>';
        }

        async function refresh() {
            try {
                releases = await loadReleases();
                paintLive();
                paintHistory();
            } catch (e) {
                live.innerHTML = '';
                history.innerHTML = '<div class="att-error" style="margin:18px">Could not load published versions: ' + esc(e.message || e) + '</div>';
            }
        }

        // Back to "nothing chosen" -- the state the page opens in.
        function reset(message) {
            picked = null;
            readToken++;
            fileInput.value = '';
            showError('');
            facts.innerHTML = message || '';
            dropTitle.textContent = 'Choose the release APK';
            dropSub.textContent = 'or drop the file here';
            drop.classList.remove('has-file');
            clearBtn.style.display = 'none';
            publishBtn.disabled = true;
            hint.textContent = 'Choose an APK to continue.';
        }

        async function handleFile(file) {
            const token = ++readToken;
            picked = null;
            publishBtn.disabled = true;
            showError('');
            facts.innerHTML = '';
            if (!file) { reset(); return; }

            dropTitle.textContent = file.name;
            dropSub.textContent = formatSize(file.size);
            drop.classList.add('has-file');
            clearBtn.style.display = '';
            hint.textContent = 'Reading the file…';
            try {
                const buffer = await file.arrayBuffer();
                const manifest = await readApkManifest(buffer);
                if (token !== readToken) return; // a newer pick took over
                const refusal = refusalFor(manifest, latest());
                if (refusal) { showError(refusal); hint.textContent = 'Fix the problem above to continue.'; return; }
                const sha = await sha256Hex(buffer);
                if (token !== readToken) return;
                picked = { file, buffer, manifest, sha };

                const app = appForPackage(manifest.packageName);
                const liveCode = latest()[app];
                facts.innerHTML =
                    '<div class="au-ready">' +
                      '<div class="au-ready-head"><span class="att-pill att-pill--done">Ready to publish</span>' +
                        '<strong>' + esc(appLabel(app)) + '</strong> · Version ' + esc(manifest.versionName || '?') +
                        ' <span class="au-code">(' + esc(manifest.versionCode) + ')</span> · ' + esc(formatSize(file.size)) + '</div>' +
                      '<ul class="au-checks">' +
                        '<li>Release build, not a debug build</li>' +
                        '<li>' + (liveCode ? 'Newer than the live version (' + esc(liveCode) + ')' : 'First version of this app: nothing is live yet') + '</li>' +
                      '</ul>' +
                      '<div class="au-consequence"><i data-lucide="triangle-alert"></i><span>Every phone on an older version of ' + esc(appLabel(app)) +
                        ' will be <strong>blocked from Time In and Time Out</strong> until it installs this update.</span></div>' +
                      '<details class="au-tech"><summary>Technical details</summary>' +
                        '<div class="au-sha">SHA-256 ' + esc(sha) + '</div></details>' +
                    '</div>';
                hint.textContent = '';
                publishBtn.disabled = false;
                icons();
            } catch (e) {
                if (token !== readToken) return;
                showError('This file could not be read as an Android app (' + (e.message || e) + ').');
                hint.textContent = 'Fix the problem above to continue.';
            }
        }

        fileInput.addEventListener('change', () => handleFile(fileInput.files && fileInput.files[0]));
        clearBtn.addEventListener('click', () => reset());

        // Drop the APK straight onto the box.
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
        ['dragleave', 'dragend'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            drop.classList.remove('is-over');
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (!f) return;
            try {
                const dt = new DataTransfer();
                dt.items.add(f);
                fileInput.files = dt.files;
            } catch (err) { /* an older browser: the file is still read below */ }
            handleFile(f);
        });

        notes.addEventListener('input', () => { counter.textContent = notes.value.length + ' / 500'; });
        filterBar.addEventListener('click', (e) => {
            const b = e.target.closest('[data-f]');
            if (!b) return;
            histFilter = b.dataset.f;
            paintHistory();
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
            hint.textContent = 'Publishing…';
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

                notes.value = '';
                counter.textContent = '0 / 500';
                reset('<div class="au-done"><i data-lucide="circle-check"></i><div><strong>Published.</strong> ' +
                      'Phones will show the update the next time the app is opened with internet.</div></div>');
                icons();
                await refresh();
            } catch (e) {
                showError(publishError(e));
                hint.textContent = '';
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