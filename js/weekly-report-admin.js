// ════════════════════════════════════════════════════════════════════
// Attendance → Weekly reports (0120) — the office screen.
//
// One Monday–Sunday week of attendance and the work each person
// reported, per employee or per project, and the general duties written
// once per position. Reads att_week_report and att_duty_list; the only
// write is att_duty_save. Nothing here touches attendance records,
// storage files or any money table, and no amount of any kind is shown:
// days, hours, submissions, workers and photos only.
//
// Photos are storage paths. They are signed only when a pop-up or a
// print asks for them, from the private 'attendance' bucket, in batches
// of 50 with at most two requests at a time; the overview loads no photo.
//
// Uses window.WeeklyReportData (engine), window.WeeklyReportPrint (print)
// and window.SplitView (the office frame). Called by switchView for the
// view attWeekly: window.initWeeklyReportModule(el).
// Spec: docs/superpowers/specs/2026-11-22-weekly-employee-report-mvp-terms.md
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    const KEY = 'attWeekly';
    const LIVE_LINE = 'Live report — built from accepted attendance records. Data still on a phone is not included.';
    const DUTY_LINE = 'General duties are standing responsibilities, not a record of work done.';
    const DAY_TONE = { complete: 'done', working: 'gold', missing_timeout: 'red', admin_closed: 'gold', pending: 'none', none: 'none' };

    let W = null, PR = null, SV = null;

    // Everything the screen remembers. Opening or closing the pop-up never
    // touches it, so the week, segment, tab, search and filters survive.
    const S = {
        host: null,
        week: '', seg: 'projects', tab: 'all', ptab: 'all',
        q: '', trade: '', projectKey: '', pq: '', day: '',
        sel: null,
        state: 'loading', error: null, ticket: 0, weekStale: false,
        payload: null, todayKey: '', employees: [], projects: [], coverage: null,
        duty: { state: 'idle', error: null, ticket: 0, data: null },
    };

    // ── Small helpers ───────────────────────────────────────────────
    function esc(v) {
        return String(v === null || v === undefined ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function icons() { if (root.lucide && root.lucide.createIcons) root.lucide.createIcons(); }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    function first8(s) { return String(s === null || s === undefined ? '' : s).slice(0, 8); }
    function currentWeek() { return W.wrWeekStart(W.wrManilaTodayKey(Date.now())); }
    function sysLabel(system) { return system === 'pm' ? 'Project Management' : 'Project Control'; }
    function lower(s) { return String(s === null || s === undefined ? '' : s).toLowerCase(); }
    function errText(e) { return String((e && (e.message || e.error_description)) || e || ''); }
    function missingFn(e) {
        const code = e && e.code;
        return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(errText(e));
    }
    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(p => /[A-Za-z0-9]/.test(p));
        if (!parts.length) return '?';
        return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }
    // 'Mon 16 Nov 2026' in Manila, whatever the browser's timezone.
    function manilaDate(iso) {
        const ms = Date.parse(iso);
        if (!iso || isNaN(ms)) return '—';
        const key = W.wrManilaTodayKey(ms);
        return W.wrDayLabel(key) + ' ' + key.slice(0, 4);
    }
    function sourceLine(en) {
        return 'Source: attendance record ' + first8(en.recordId) +
            (en.timeoutEventId ? ' · Time Out event ' + first8(en.timeoutEventId) : '');
    }

    // ── Photo signing ───────────────────────────────────────────────
    // The attendance bucket is private; a link lasts an hour and is reused
    // until ten minutes before it runs out (as attSignedPhoto does). Links
    // are made in batches (createSignedUrls), SIGN_CHUNK paths per request
    // and at most SIGN_FLIGHT requests at a time, so a busy week costs a
    // handful of requests instead of one per photo.
    const SIGN_CHUNK = 50, SIGN_FLIGHT = 2;
    const signCache = new Map();
    function cachedUrl(path) {
        const hit = signCache.get(path);
        return hit && hit.url && hit.exp > Date.now() ? hit.url : null;
    }
    // One request for up to SIGN_CHUNK paths. Resolves a Map path → url|null;
    // an error entry, a missing entry or a failed request all read as null
    // (Photo unavailable), and never reject.
    async function signBatch(paths) {
        const out = new Map();
        const need = [];
        paths.forEach(p => {
            if (!p || out.has(p)) return;
            const u = cachedUrl(p);
            out.set(p, u);
            if (!u) need.push(p);
        });
        if (!need.length) return out;
        try {
            const res = await root.sbClient.storage.from('attendance').createSignedUrls(need, 3600);
            if (!res || res.error || !Array.isArray(res.data)) {
                console.warn('weekly reports: photo sign failed:', res && res.error ? errText(res.error) : 'no answer');
                return out;
            }
            res.data.forEach(item => {
                if (!item || !item.path || item.error || !item.signedUrl || need.indexOf(item.path) < 0) return;
                signCache.set(item.path, { url: item.signedUrl, exp: Date.now() + (3600 - 600) * 1000 });
                out.set(item.path, item.signedUrl);
            });
        } catch (e) {
            console.warn('weekly reports: photo sign failed:', errText(e));
        }
        return out;
    }
    function forgetPhoto(path) { signCache.set(path, { url: null, exp: 0 }); }

    // limitSign(path, wanted) → Promise<url|null>. Jobs asked for in the same
    // moment are grouped into chunks. wanted(): false once the photo's place
    // has left the page (the pop-up closed or moved on), so a queued photo is
    // never signed for nothing.
    const signQueue = [];
    let signActive = 0, signPending = false;
    function limitSign(path, wanted) {
        return new Promise(resolve => {
            signQueue.push({ path: path, wanted: wanted, resolve: resolve });
            if (!signPending) { signPending = true; Promise.resolve().then(() => { signPending = false; pump(); }); }
        });
    }
    function pump() {
        while (signActive < SIGN_FLIGHT && signQueue.length) {
            const jobs = [];
            while (signQueue.length && jobs.length < SIGN_CHUNK) {
                const job = signQueue.shift();
                if (job.wanted && !job.wanted()) { job.resolve(null); continue; }
                jobs.push(job);
            }
            if (!jobs.length) continue;
            signActive++;
            signBatch(jobs.map(j => j.path)).then(m => m, () => new Map()).then(m => {
                signActive--;
                jobs.forEach(j => j.resolve((m && m.get(j.path)) || null));
                pump();
            });
        }
    }

    // Fill one photo place: a signed image, or Photo unavailable with Try again.
    function fillPhoto(slot, path, alt, thumb) {
        if (!path) { slot.innerHTML = '<span class="att-photo--missing">Photo unavailable</span>'; return; }
        slot.innerHTML = '<span class="wr-ph-wait">Loading photo…</span>';
        limitSign(path, () => slot.isConnected).then(url => {
            if (!slot.isConnected) return;
            if (!url) { missing(); return; }
            slot.innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img class="' +
                (thumb ? 'att-work-thumb' : 'wr-ph-img') + '" src="' + esc(url) + '" alt="' + esc(alt) + '" loading="lazy"></a>';
            const img = slot.querySelector('img');
            // A link that signs but does not load (file gone, network drop).
            img.addEventListener('error', () => { forgetPhoto(path); if (slot.isConnected) missing(); }, { once: true });
        });
        function missing() {
            slot.innerHTML = '<span class="att-photo--missing">Photo unavailable</span>' +
                '<button type="button" class="att-link">Try again</button>';
            slot.querySelector('button').addEventListener('click', ev => { ev.stopPropagation(); fillPhoto(slot, path, alt, thumb); });
        }
    }

    // ── Loading ─────────────────────────────────────────────────────
    function loadMessage(e) {
        const t = errText(e);
        if (/NOT_OFFICE|NO_ATTENDANCE_ACCESS/.test(t)) return 'Your account cannot open weekly reports.';
        if (/WEEK_START_NOT_MONDAY/.test(t)) return 'That week does not start on a Monday. Use This week.';
        if (missingFn(e)) return 'Weekly reports are not set up on the server yet.';
        return 'Check the connection and try again.';
    }

    async function loadWeek() {
        const mine = ++S.ticket;
        S.state = 'loading'; S.error = null; S.weekStale = false;
        if (S.sel && S.sel.indexOf('duty:') !== 0) S.sel = null;
        if (S.seg !== 'duties') draw();
        let payload = null;
        try {
            if (!root.sbClient) throw new Error('No connection to the server.');
            const res = await root.sbClient.rpc('att_week_report', { p_week_start: S.week });
            if (res.error) throw res.error;
            payload = res.data;
            if (!payload || !Array.isArray(payload.roster) || !Array.isArray(payload.records)) {
                throw new Error('The server sent an answer this screen cannot read.');
            }
            if (mine !== S.ticket) return;
            S.payload = payload;
            S.todayKey = W.wrManilaTodayKey(Date.now());
            S.employees = W.wrBuildEmployees(payload, S.todayKey);
            S.projects = W.wrBuildProjects(payload);
            S.projectsKnown = Array.isArray(payload.projects);
            S.coverage = W.wrCoverage(payload);
        } catch (e) {
            if (mine !== S.ticket) return;
            console.error('weekly reports: load', e);
            S.state = 'error'; S.error = e;
            if (S.seg !== 'duties') draw();
            return;
        }
        // A filter pointing at something this week does not have is cleared,
        // or the list would be empty with no visible reason.
        if (S.trade && !trades().some(t => lower(t) === lower(S.trade))) S.trade = '';
        if (S.projectKey && !S.projects.some(p => p.hasWork && p.key === S.projectKey)) S.projectKey = '';
        if (S.day && W.wrWeekDays(S.week).indexOf(S.day) < 0) S.day = '';
        S.state = 'ready';
        if (S.seg !== 'duties') draw();
    }

    async function loadDuties() {
        const mine = ++S.duty.ticket;
        S.duty.state = 'loading'; S.duty.error = null;
        if (S.seg === 'duties') draw();
        try {
            if (!root.sbClient) throw new Error('No connection to the server.');
            const res = await root.sbClient.rpc('att_duty_list');
            if (res.error) throw res.error;
            const d = res.data || {};
            if (mine !== S.duty.ticket) return;
            S.duty.data = {
                positions: Array.isArray(d.positions) ? d.positions.filter(p => p) : [],
                duties: Array.isArray(d.duties) ? d.duties : [],
            };
            S.duty.state = 'ready';
        } catch (e) {
            if (mine !== S.duty.ticket) return;
            console.error('weekly reports: duties', e);
            S.duty.state = 'error'; S.duty.error = e;
        }
        if (S.seg === 'duties') draw();
    }

    function goWeek(week) {
        const now = currentWeek();
        S.week = week > now ? now : week;
        loadWeek();
    }

    function changeSeg(id) {
        S.seg = id;
        if (id === 'duties') {
            if (S.duty.state === 'ready') draw(); else loadDuties();
        } else if (S.weekStale) {
            loadWeek();
        } else {
            draw();
        }
    }

    // ── The screen ──────────────────────────────────────────────────
    function trades() {
        const seen = {}, out = [];
        S.employees.forEach(e => {
            const t = e.trade;
            if (t && !seen[lower(t)]) { seen[lower(t)] = true; out.push(t); }
        });
        return out.sort((a, b) => lower(a) < lower(b) ? -1 : (lower(a) > lower(b) ? 1 : 0));
    }

    function weekControls() {
        const atNow = S.week >= currentWeek();
        return '<span class="wr-week" role="group" aria-label="Week">' +
            '<button type="button" class="sv-chip wr-week-btn" data-wr-prev aria-label="Previous week" title="Previous week">‹</button>' +
            '<span class="wr-week-label">' + esc(W.wrWeekLabel(S.week)) + '</span>' +
            '<button type="button" class="sv-chip wr-week-btn" data-wr-next aria-label="Next week" title="Next week"' +
              (atNow ? ' disabled' : '') + '>›</button>' +
            '<button type="button" class="sv-chip" data-wr-this>This week</button>' +
            '</span>';
    }

    function selectHtml(attr, label, allText, options, current) {
        return '<select class="sv-select" ' + attr + ' aria-label="' + esc(label) + '"><option value="">' + esc(allText) + '</option>' +
            options.map(o => '<option value="' + esc(o.value) + '"' + (o.value === current ? ' selected' : '') + '>' +
                esc(o.label) + '</option>').join('') + '</select>';
    }

    function strips() {
        const out = [];
        if (S.state === 'ready' && S.coverage && S.coverage.note) out.push(S.coverage.note);
        out.push(LIVE_LINE);
        return out;
    }

    function bindToolbar(el) {
        const on = (sel, ev, fn) => { const x = el.querySelector(sel); if (x) x.addEventListener(ev, fn); };
        on('[data-wr-prev]', 'click', () => goWeek(W.wrAddDays(S.week, -7)));
        on('[data-wr-next]', 'click', () => goWeek(W.wrAddDays(S.week, 7)));
        on('[data-wr-this]', 'click', () => goWeek(currentWeek()));
        on('[data-wr-trade]', 'change', e => { S.trade = e.target.value; draw(); });
        on('[data-wr-project]', 'change', e => { S.projectKey = e.target.value; draw(); });
        on('[data-wr-day]', 'change', e => { S.day = e.target.value; draw(); });
    }

    function draw() {
        if (!S.host || !SV) return;
        const cfg = {
            key: KEY,
            title: 'Weekly reports',
            seg: {
                options: [{ id: 'employees', label: 'Employees' }, { id: 'projects', label: 'Projects' }, { id: 'duties', label: 'General duties' }],
                value: S.seg,
                onChange: changeSeg,
            },
            selectedId: S.sel,
            onSelect: select,
            onClose: () => { S.sel = null; },
            onToolbar: bindToolbar,
        };
        if (S.seg === 'duties') {
            SV.render(S.host, Object.assign(cfg, dutiesCfg()));
            return;
        }
        cfg.live = 'Live · Not final';
        cfg.sub = 'Attendance and the work each person reported, Monday to Sunday. Times are Manila time.';
        if (S.state !== 'ready') {
            SV.render(S.host, Object.assign(cfg, {
                strips: strips(), tabs: [], search: false, toolbar: weekControls(), custom: true,
                onCustom: el => {
                    if (S.state !== 'error') {
                        el.innerHTML = '<div class="sv-empty wr-state" role="status">Loading the week…</div>';
                        return;
                    }
                    el.innerHTML = errorBox('The week could not be loaded.', loadMessage(S.error), S.error);
                    el.querySelector('[data-wr-retry]').addEventListener('click', loadWeek);
                    icons();
                },
            }));
            return;
        }
        SV.render(S.host, Object.assign(cfg, S.seg === 'projects' ? projectsCfg() : employeesCfg()));
    }

    function errorBox(title, friendly, e) {
        const raw = errText(e);
        return SV.notice('red', 'alert-triangle', title,
            esc(friendly) + (raw && raw !== friendly ? '<div class="wr-muted">' + esc(raw) + '</div>' : '') +
            '<div class="wr-retry"><button type="button" class="att-btn" data-wr-retry>Try again</button></div>');
    }

    // ── Employees ───────────────────────────────────────────────────
    function empMeta(e) {
        const noneText = (e.days || []).some(d => d.status === 'none') ? 'No attendance recorded' : 'No attendance recorded yet';
        let meta = e.recordedDays === 0 ? noneText
            : plural(e.recordedDays, 'day', 'days') + ' recorded · ' +
              (e.hoursText === 'No hours recorded' ? 'No hours recorded' : 'Recorded hours ' + e.hoursText) +
              (e.incompleteDays ? ' · ' + e.incompleteDays + ' incomplete' : '');
        if (e.needsReview) {
            const reasons = e.reviewReasons.map(k => W.WR_REASON[k] || k);
            meta = reasons.slice(0, 2).join(', ') + (reasons.length > 2 ? ' +' + (reasons.length - 2) + ' more' : '') + ' · ' + meta;
        }
        return meta;
    }

    function employeesCfg() {
        const all = S.employees;
        const filtered = W.wrFilterEmployees(all, { q: S.q, trade: S.trade, projectKey: S.projectKey });
        const shown = S.tab === 'review' ? filtered.filter(e => e.needsReview) : filtered;
        const reviewCount = all.filter(e => e.needsReview).length;
        const filtering = !!(S.q.trim() || S.trade || S.projectKey);
        const names = {};
        const workProjects = S.projects.filter(p => p.hasWork);
        workProjects.forEach(p => { names[lower(p.name)] = (names[lower(p.name)] || 0) + 1; });
        const projectOpts = workProjects.map(p => ({
            value: p.key,
            label: (p.name || '—') + (names[lower(p.name)] > 1 ? ' · ' + sysLabel(p.system) : ''),
        }));
        let empty = "No workers in this week's roster.";
        if (all.length) empty = S.tab === 'review' && !filtering ? 'Nobody needs review this week.' : 'No worker matches these filters.';
        return {
            strips: strips(),
            tabs: [
                { id: 'all', label: 'Everyone', count: all.length },
                { id: 'review', label: 'Needs review', count: reviewCount, needs: true,
                  help: 'A day with no Time Out, a day closed by the office, a location or clock concern, or a Time Out with no work photo.' },
            ],
            tab: S.tab,
            onTab: id => { S.tab = id; draw(); },
            search: { placeholder: 'Search name or worker no.', value: S.q, onInput: v => { S.q = v; draw(); } },
            toolbar: weekControls() +
                selectHtml('data-wr-trade', 'Filter by position', 'All positions',
                    trades().map(t => ({ value: t, label: t })), trades().find(t => lower(t) === lower(S.trade)) || '') +
                selectHtml('data-wr-project', 'Filter by project', 'All projects', projectOpts, S.projectKey),
            showing: filtering ? 'Showing ' + shown.length + ' of ' + (S.tab === 'review' ? reviewCount : all.length) : '',
            groups: [{ title: '', rows: shown.map(e => ({
                id: e.workerId,
                title: e.name,
                sub: W.wrWorkerNo(e.workerNo) + ' · ' + (e.position || '—'),
                meta: empMeta(e),
                pill: e.needsReview ? { text: 'Needs review', tone: 'red' } : null,
                chips: e.active === false ? [{ text: 'Account off', tone: 'none' }] : [],
            })) }],
            empty: esc(empty),
        };
    }

    function printActions() {
        return '<button type="button" class="att-btn att-btn--primary" data-wr-print><i data-lucide="printer"></i>Print</button>' +
            '<span class="wr-print-msg" data-wr-msg role="status" aria-live="polite"></span>';
    }

    function printCtx() {
        return {
            weekStart: S.week,
            weekEnd: S.payload.week_end,
            generatedAt: S.payload.generated_at,
            live: true,
            coverageNote: (S.coverage && S.coverage.note) || '',
            origin: root.location ? root.location.origin : '',
        };
    }

    // The popup must open inside the click itself (pop-up blockers), so
    // wrOpenPrint is called straight from the handler, before any wait.
    function bindPrint(panel, build, paths) {
        const btn = panel.querySelector('[data-wr-print]');
        const msg = panel.querySelector('[data-wr-msg]');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            btn.disabled = true;
            if (msg) msg.textContent = '';
            const ctx = printCtx();
            // Every photo of the report is signed in batches on the first
            // request from the print (only once its window really opened);
            // the print's own workers then just collect their link.
            let signed = null;
            const sign = p => {
                if (!signed) {
                    signed = Promise.all(paths.map(x => limitSign(x, null))).then(list => {
                        const m = new Map();
                        paths.forEach((x, i) => m.set(x, list[i]));
                        return m;
                    });
                }
                return signed.then(m => m.get(p) || null);
            };
            PR.wrOpenPrint(urls => build(ctx, urls), paths, sign)
                .then(r => r, () => 'error')
                .then(r => {
                    btn.disabled = false;
                    if (!msg) return;
                    if (r === 'blocked') msg.textContent = 'Allow pop-ups for this site to print.';
                    else if (r === 'error') msg.textContent = 'The report could not be prepared. Try again.';
                });
        });
    }

    function photoPaths(entries) {
        const out = [];
        entries.forEach(en => en.photos.forEach(p => { if (p.path && out.indexOf(p.path) < 0) out.push(p.path); }));
        return out;
    }

    // One work entry. Photo places are filled after the html is in place;
    // jobs collects what each place shows.
    function entryHtml(en, jobs, withWorker) {
        let head = '<strong>' + esc(W.wrDayLabel(en.date)) + '</strong>';
        if (withWorker) {
            head += ' · ' + esc(en.workerName) + ' (' + esc(W.wrWorkerNo(en.workerNo)) + ')';
        } else {
            head += ' · ' + esc(en.project ? en.project.name : '—');
            if (en.projectsDiffer && en.timeInProject) head += ' <span class="wr-muted">(Time In at ' + esc(en.timeInProject.name) + ')</span>';
        }
        const photos = en.photos.map(p => {
            jobs.push({ path: p.path, alt: p.label + ' · ' + en.workerName + ' · ' + W.wrDayLabel(en.date) });
            return '<figure class="wr-ph"><div class="wr-ph-box" data-wr-ph="' + (jobs.length - 1) + '"></div>' +
                '<figcaption>' + esc(p.label) + '</figcaption></figure>';
        }).join('');
        return '<article class="wr-entry">' +
            '<div class="wr-entry-head">' + head + '</div>' +
            '<div class="wr-note">' + (en.note ? esc(en.note) : '<span class="wr-muted">No note written</span>') + '</div>' +
            (photos ? '<div class="wr-photos">' + photos + '</div>' : '<div class="wr-muted">No work photo</div>') +
            '<div class="wr-source">' + esc(sourceLine(en)) + '</div>' +
            '</article>';
    }

    function fillJobs(body, jobs) {
        body.querySelectorAll('[data-wr-ph]').forEach(slot => {
            const j = jobs[+slot.getAttribute('data-wr-ph')];
            if (j) fillPhoto(slot, j.path, j.alt, false);
        });
    }

    function cell(label, html) { return '<td data-label="' + esc(label) + '"><div class="wr-cell">' + html + '</div></td>'; }

    function daysTable(e) {
        const rows = e.days.map((d, i) => {
            const r = d.record;
            const timeIn = r ? esc(W.wrTime(r.timein_at)) + (r.timein_project_name ? '<div class="wr-site">' + esc(r.timein_project_name) + '</div>' : '') : '—';
            const timeOut = r && r.timeout_at ? esc(W.wrTime(r.timeout_at)) +
                (r.timeout_project_name ? '<div class="wr-site">' + esc(r.timeout_project_name) + '</div>' : '') : '—';
            const hours = r && r.total_minutes !== null && r.total_minutes !== undefined ? esc(W.wrHoursText(r.total_minutes)) : '—';
            let photo = '—';
            if (r) photo = r.timein_photo_path ? '<button type="button" class="att-link" data-wr-tin="' + i + '">Time In photo</button>'
                                               : '<span class="wr-muted">No photo</span>';
            return '<tr>' + cell('Day', esc(d.label)) +
                cell('Status', SV.pills([{ text: d.statusLabel, tone: DAY_TONE[d.status] || 'none' }])) +
                cell('Time In', timeIn) + cell('Time Out', timeOut) + cell('Hours', hours) +
                cell('Time In photo', '<div class="wr-tin">' + photo + '</div>') + '</tr>';
        }).join('');
        return '<div class="wr-days-wrap"><table class="wr-days"><thead><tr><th>Day</th><th>Status</th><th>Time In</th>' +
            '<th>Time Out</th><th>Hours</th><th>Time In photo</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function employeePanel(panel, id) {
        const e = S.employees.find(x => x.workerId === id);
        if (!e) { SV.error(panel, "This worker is not in this week's report."); return; }
        const body = SV.page(panel, {
            wide: true,
            kicker: W.wrWeekLabel(S.week),
            title: e.name,
            pills: [{ text: 'Not final', tone: 'gold' }],
            actions: printActions(),
            nextLabel: 'Next worker',
        });
        const jobs = [];
        const reasons = e.reviewReasons.map(k => W.WR_REASON[k] || k);
        body.innerHTML =
            '<div class="wr-emp-head"><div class="wr-avatar" data-wr-avatar aria-hidden="true">' + esc(initials(e.name)) + '</div>' +
              '<div class="wr-emp-id"><div class="wr-emp-no">' + esc(W.wrWorkerNo(e.workerNo) + ' · ' + (e.position || '—')) + '</div>' +
              (e.active === false ? '<div class="wr-muted">This account is switched off now.</div>' : '') + '</div></div>' +
            SV.section('This week',
                (e.needsReview ? SV.notice('red', 'alert-triangle', 'Needs review', esc(reasons.join(' · '))) : '') +
                SV.facts([
                    ['Recorded hours', esc(e.hoursText)],
                    ['Recorded days', esc(e.recordedDays)],
                    ['Incomplete days', esc(e.incompleteDays)],
                ])) +
            (e.duties && e.duties.text
                ? SV.section('General duties (standing responsibilities, not a record of work done)',
                    '<div class="wr-note">' + esc(e.duties.text) + '</div>') : '') +
            SV.section('Daily attendance', daysTable(e)) +
            SV.section('Work reported', e.entries.length
                ? e.entries.map(en => entryHtml(en, jobs, false)).join('')
                : '<p class="sv-empty-inline">No work reported this week.</p>');
        icons();

        // The header: a Time In photo from this week, or the initials.
        const avatar = body.querySelector('[data-wr-avatar]');
        if (e.headerPhotoPath && avatar) {
            limitSign(e.headerPhotoPath, () => avatar.isConnected).then(url => {
                if (!url || !avatar.isConnected) return;
                const img = document.createElement('img');
                img.alt = '';
                img.src = url;
                img.addEventListener('load', () => { if (avatar.isConnected) { avatar.textContent = ''; avatar.appendChild(img); } }, { once: true });
            });
        }
        // A day's Time In photo is signed only when asked for.
        body.querySelectorAll('[data-wr-tin]').forEach(btn => btn.addEventListener('click', () => {
            const d = e.days[+btn.getAttribute('data-wr-tin')];
            const slot = btn.parentNode;
            if (d && d.record) fillPhoto(slot, d.record.timein_photo_path, 'Time In photo · ' + e.name + ' · ' + d.label, true);
        }));
        fillJobs(body, jobs);
        bindPrint(panel, (ctx, urls) => PR.wrPrintEmployeeHtml(e, ctx, urls), photoPaths(e.entries));
    }

    // ── Projects ────────────────────────────────────────────────────
    const NO_WORK_WEEK = 'No work submitted this week';
    const NO_WORK_DAY = 'No work submitted on this day';
    const HIDDEN_NOTE = 'Workers cannot pick this site at Time In while it is hidden. Show it in Attendance → Sites & schedule.';

    // What a project shows under the chosen Day filter (none: the whole week).
    function scopeOf(p) {
        const days = p.days.filter(d => !S.day || d.date === S.day);
        const who = {};
        let submissions = 0, photos = 0;
        days.forEach(d => d.entries.forEach(en => { submissions++; photos += en.photos.length; who[en.workerId] = true; }));
        return { days: days, submissions: submissions, workers: Object.keys(who).length, photos: photos };
    }

    function projectsCfg() {
        const needle = S.pq.trim().toLowerCase();
        // A completed project is listed only where it has work (the chosen day, or the week).
        const scoped = S.projects.map(p => ({ p: p, s: scopeOf(p) }))
            .filter(x => !(x.p.completed && x.s.submissions === 0));
        const withWork = scoped.filter(x => x.s.submissions > 0);
        const tab = S.ptab === 'with' ? 'with' : 'all';
        const pool = tab === 'with' ? withWork : scoped;
        const shown = pool.filter(x => !needle || lower(x.p.name).indexOf(needle) >= 0);
        const noWork = S.day ? NO_WORK_DAY : NO_WORK_WEEK;
        let empty = tab === 'with' ? noWork + '.' : S.projectsKnown ? 'No active projects.' : NO_WORK_WEEK + '.';
        if (pool.length && needle) empty = 'No project matches this search.';
        return {
            strips: strips(),
            tabs: [
                { id: 'all', label: 'All projects', count: scoped.length,
                  help: 'Every active project, with or without work. Counts are submissions and workers, not tasks or a headcount.' },
                { id: 'with', label: 'With work', count: withWork.length,
                  help: S.day ? 'Projects with work submitted on the chosen day.' : 'Projects with work submitted this week.' },
            ],
            tab: tab,
            onTab: id => { S.ptab = id; draw(); },
            search: { placeholder: 'Search project', value: S.pq, onInput: v => { S.pq = v; draw(); } },
            toolbar: weekControls() + selectHtml('data-wr-day', 'Filter by day', 'All days',
                W.wrWeekDays(S.week).map(d => ({ value: d, label: W.wrDayLabel(d) })), S.day),
            showing: needle ? 'Showing ' + shown.length + ' of ' + pool.length : '',
            groups: [{ title: '', rows: shown.map(x => ({
                id: x.p.key,
                title: x.p.name || '—',
                sub: sysLabel(x.p.system),
                meta: x.s.submissions > 0
                    ? plural(x.s.submissions, 'submission', 'submissions') + ' · ' +
                      plural(x.s.workers, 'worker', 'workers') + ' · ' + plural(x.s.photos, 'photo', 'photos')
                    : noWork,
                chips: x.p.hidden ? [{ text: 'Hidden from workers', tone: 'none' }] : [],
            })) }],
            empty: esc(empty),
        };
    }

    function photoRange(r) {
        if (r.from === null || r.from === undefined) return 'No photos';
        return r.from === r.to ? 'Photos #' + r.from : 'Photos #' + r.from + '–#' + r.to;
    }

    // One line of the Work done list: who, their own note, the photo numbers.
    function workCard(r) {
        const en = r.entry;
        return '<div class="wr-pcard"><div class="wr-pcard-main">' +
            '<div class="wr-pcard-who">' + esc(en.workerName) + ' (' + esc(W.wrWorkerNo(en.workerNo)) + ')</div>' +
            '<div class="wr-note">' + (en.note ? esc(en.note) : '<span class="wr-muted">No note written</span>') + '</div>' +
            (en.projectsDiffer && en.timeInProject ? '<div class="wr-source">Time In at ' + esc(en.timeInProject.name) + '</div>' : '') +
            '<div class="wr-source">' + esc(sourceLine(en)) + '</div></div>' +
            '<div class="wr-pcard-range">' + esc(photoRange(r)) + '</div></div>';
    }

    function projectPanel(panel, key) {
        const p = S.projects.find(x => x.key === key);
        if (!p) { SV.error(panel, "This project is not in this week's report."); return; }
        const dayKey = S.day || null;
        const num = W.wrNumberPhotos(p, dayKey);
        const rows = num.rows;
        const who = {}, dates = {}, order = [];
        rows.forEach(r => {
            who[r.entry.workerId] = true;
            if (!dates[r.entry.date]) { dates[r.entry.date] = []; order.push(r.entry.date); }
            dates[r.entry.date].push(r);
        });
        const pills = [{ text: 'Not final', tone: 'gold' }];
        if (p.hidden) pills.push({ text: 'Hidden from workers', tone: 'none' });
        const hasWork = rows.length > 0;
        const body = SV.page(panel, {
            wide: true,
            kicker: W.wrWeekLabel(S.week),
            title: p.name || '—',
            pills: pills,
            sub: sysLabel(p.system) + ' · ' + (dayKey ? 'Day: ' + W.wrDayLabel(dayKey) : 'Whole week'),
            actions: hasWork ? printActions() : '',
            nextLabel: 'Next project',
        });
        const jobs = [];
        if (!hasWork) {
            body.innerHTML = '<p class="sv-empty-inline wr-empty-note">' + esc(dayKey ? NO_WORK_DAY : NO_WORK_WEEK) + '</p>' +
                (p.hidden ? '<p class="wr-muted">' + esc(HIDDEN_NOTE) + '</p>' : '');
            return;
        }
        const tiles = [[rows.length, 'Submissions'], [Object.keys(who).length, 'Workers'], [num.photos.length, 'Photos'], [order.length, 'Days with work']];
        body.innerHTML =
            '<div class="wr-tiles">' + tiles.map((t, i) =>
                '<div class="wr-tile' + (i === 0 ? ' wr-tile--dark' : '') + '"><div class="wr-tile-n">' + esc(t[0]) +
                '</div><div class="wr-tile-l">' + esc(t[1]) + '</div></div>').join('') + '</div>' +
            '<p class="wr-muted">Counts are submissions and workers, not tasks or a headcount.</p>' +
            SV.section('Work done', order.map(d =>
                '<div class="wr-pday">' + esc(W.wrDayLabel(d)) + '</div>' + dates[d].map(workCard).join('')).join('')) +
            (num.photos.length
                ? SV.section('Progress photos', '<div class="wr-pgrid">' + num.photos.map(ph => {
                    jobs.push({ path: ph.path, alt: '#' + ph.n + ' · ' + W.wrDayLabel(ph.entry.date) + ' · ' + ph.entry.workerName });
                    return '<figure class="wr-pg"><span class="wr-badge">#' + esc(ph.n) + '</span>' +
                        '<div class="wr-ph-box" data-wr-ph="' + (jobs.length - 1) + '"></div>' +
                        '<figcaption>' + esc(W.wrDayLabel(ph.entry.date) + ' · ' + ph.entry.workerName +
                            (ph.legacy ? ' · ' + ph.label : '')) + '</figcaption></figure>';
                }).join('') + '</div>')
                : '');
        icons();
        fillJobs(body, jobs);
        bindPrint(panel, (ctx, urls) => PR.wrPrintProjectHtml(p, ctx, urls, dayKey), photoPaths(rows.map(r => r.entry)));
    }

    // ── General duties ──────────────────────────────────────────────
    function dutyRow(position) {
        const list = (S.duty.data && S.duty.data.duties) || [];
        for (let i = 0; i < list.length; i++) if (lower(list[i].position) === lower(position)) return list[i];
        return null;
    }

    function dutiesCfg() {
        const ready = S.duty.state === 'ready';
        return {
            sub: "Written once per position and shown on that position's weekly reports.",
            strips: [DUTY_LINE],
            tabs: [{ id: 'positions', label: 'Positions', count: ready ? S.duty.data.positions.length : null }],
            tab: 'positions',
            onTab: () => {},
            search: false,
            custom: true,
            onCustom: fillDuties,
        };
    }

    function fillDuties(el) {
        if (S.duty.state === 'error') {
            const t = errText(S.duty.error);
            const friendly = /NOT_OFFICE|NO_ATTENDANCE_ACCESS/.test(t) ? 'Your account cannot open general duties.'
                : missingFn(S.duty.error) ? 'General duties are not set up on the server yet.'
                : 'Check the connection and try again.';
            el.innerHTML = errorBox('General duties could not be loaded.', friendly, S.duty.error);
            el.querySelector('[data-wr-retry]').addEventListener('click', loadDuties);
            icons();
            return;
        }
        if (S.duty.state !== 'ready') {
            el.innerHTML = '<div class="sv-empty wr-state" role="status">Loading general duties…</div>';
            return;
        }
        const positions = S.duty.data.positions;
        if (!positions.length) {
            el.innerHTML = '<div class="sv-empty wr-state">No positions in use yet.</div>';
            return;
        }
        el.innerHTML = '<div class="wr-duties">' + positions.map(pos => {
            const row = dutyRow(pos);
            return '<button type="button" class="wr-duty" data-wr-duty="' + esc(pos) + '">' +
                '<span class="wr-duty-top"><span class="wr-duty-pos">' + esc(pos) + '</span>' +
                  (row && row.active === false ? '<span class="att-pill att-pill--none">Inactive</span>' : '') + '</span>' +
                '<span class="wr-duty-text' + (row ? '' : ' wr-muted') + '">' + (row ? esc(row.duties) : 'No duties written yet') + '</span>' +
                (row ? '<span class="wr-duty-meta">Updated ' + esc(manilaDate(row.updated_at)) + ' by ' + esc(row.updated_by_name || '—') + '</span>' : '') +
                '<span class="wr-duty-open">Edit ›</span>' +
                '</button>';
        }).join('') + '</div>';
        el.querySelectorAll('[data-wr-duty]').forEach(b => b.addEventListener('click', () => {
            SV.open(KEY, 'duty:' + b.getAttribute('data-wr-duty'));
        }));
    }

    function dutySaveMessage(e) {
        const t = errText(e);
        if (/DUTY_TEXT_INVALID/.test(t)) return 'Write the duties (up to 2,000 characters).';
        if (/DUTY_POSITION_INVALID/.test(t)) return 'This position name cannot be used.';
        if (/NOT_OFFICE|NO_ATTENDANCE_ACCESS/.test(t)) return 'Your account cannot change general duties.';
        if (missingFn(e)) return 'General duties are not set up on the server yet.';
        return 'The duties could not be saved. Check the connection and try again.';
    }

    function dutyForm(panel, position) {
        const row = dutyRow(position);
        SV.form(panel, {
            kicker: 'General duties',
            title: position,
            sub: "Standing responsibilities, not a record of work done. Active duties appear on this position's weekly reports.",
            body:
                '<div class="att-field"><label for="wrDutyText">Duties</label>' +
                  '<textarea id="wrDutyText" name="duties" class="att-input wr-duty-input" maxlength="2000" rows="8">' +
                    esc(row ? row.duties : '') + '</textarea>' +
                  '<div class="att-hint" data-wr-count></div></div>' +
                '<label class="wr-check"><input type="checkbox" name="active"' + (!row || row.active !== false ? ' checked' : '') + '>Active</label>',
            submitLabel: 'Save',
            onOpen: f => {
                const ta = f.elements.duties, out = f.querySelector('[data-wr-count]');
                const count = () => { out.textContent = ta.value.length.toLocaleString('en-PH') + ' of 2,000 characters'; };
                ta.addEventListener('input', count);
                count();
            },
            onSubmit: async f => {
                const text = f.elements.duties.value;
                if (!text.trim() || text.trim().length > 2000) throw new Error('DUTY_TEXT_INVALID');
                const res = await root.sbClient.rpc('att_duty_save',
                    { p_position: position, p_duties: text, p_active: !!f.elements.active.checked });
                if (res.error) throw res.error;
            },
            errorMessage: dutySaveMessage,
            doneText: 'General duties saved',
            onCancel: () => SV.closePop(),
            onDone: () => {
                SV.closePop();
                // The week's reports carry the active duties: read them again
                // the next time a report segment is opened.
                S.weekStale = true;
                loadDuties();
            },
        });
    }

    // ── The pop-up ──────────────────────────────────────────────────
    function select(id, panel) {
        S.sel = id;
        if (String(id).indexOf('duty:') === 0) { dutyForm(panel, String(id).slice(5)); return; }
        if (S.seg === 'projects') projectPanel(panel, id);
        else employeePanel(panel, id);
    }

    // Called by switchView for the view attWeekly. Each visit opens on the
    // current Manila week, Projects, All projects, with no filters.
    root.initWeeklyReportModule = function (el) {
        if (!el) return;
        W = root.WeeklyReportData; PR = root.WeeklyReportPrint; SV = root.SplitView;
        if (!W || !PR || !SV) {
            el.innerHTML = '<div class="sv-error">Weekly reports could not start. Reload the page and try again.</div>';
            return;
        }
        S.host = el;
        S.week = currentWeek();
        S.seg = 'projects'; S.tab = 'all'; S.ptab = 'all';
        S.q = ''; S.trade = ''; S.projectKey = ''; S.pq = ''; S.day = '';
        S.sel = null;
        S.duty.state = 'idle'; S.duty.data = null; S.duty.error = null;
        S.duty.ticket++; // an answer still on its way from an earlier visit is dropped
        loadWeek();
    };
})(window);
