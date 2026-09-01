/* ════════════════════════════════════════════════════════════════════
   ATTENDANCE ADMIN — the owner/staff view of worker attendance.

   Reads what the native Android app writes through the RPCs in
   migrations 0050/0051. DELIBERATELY ISOLATED, same rule as 0041 /
   0043 / 0045: nothing here writes to folders, construction_projects,
   invoices, payment_requests, expenses or payroll, and no money math
   reads attendance. There is no peso column in these tables.

   ATTENDANCE HOURS ARE NOT THE BASIS OF PAY. DAC's labour is pakyaw /
   capped contract pay (labor_contracts.agreed_amount drawn down by
   payroll.contract_id). Hours here are a record of attendance and
   nothing more — do NOT add a rate field "to make reports useful".

   Owner + staff. Workers never see this section (see _visibleNav).
   ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ==== ATT REPORT ENGINE START ====
    // Pure functions only -- no DOM, no network, no module state. They
    // are extracted and unit-tested by tests/attendance.test.js. Keep
    // them that way, or the tests stop being able to load this block.

    /** "9h 45m" from minutes. Null means nothing recorded, not zero. */
    function attFormatHours(minutes) {
        if (minutes === null || minutes === undefined) return '—';
        const m = Math.max(0, Number(minutes) | 0);
        return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    }

    /**
     * Rolls records up per worker for the report.
     *
     * daysWorked counts rows that EXIST; hours sum only what the server
     * computed. An open day (no Time Out yet) is a day worked with zero
     * hours -- inventing a figure from the clock would put a number in a
     * report that the database never agreed to.
     */
    function attRollUpByWorker(records) {
        const by = new Map();
        (records || []).forEach(r => {
            const key = r.worker_id;
            if (!by.has(key)) {
                by.set(key, {
                    workerId: key,
                    name: r.worker_name || '—',
                    position: r.worker_position || '',
                    daysWorked: 0,
                    totalMinutes: 0,
                    openDays: 0
                });
            }
            const row = by.get(key);
            row.daysWorked += 1;
            row.totalMinutes += Number(r.total_minutes || 0);
            if (r.total_minutes === null || r.total_minutes === undefined) row.openDays += 1;
        });
        return Array.from(by.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    /** The same roll-up, per project, keyed on the snapshotted name. */
    function attRollUpByProject(records) {
        const by = new Map();
        (records || []).forEach(r => {
            const key = r.timein_project_name || '—';
            if (!by.has(key)) by.set(key, { project: key, daysWorked: 0, totalMinutes: 0 });
            const row = by.get(key);
            row.daysWorked += 1;
            row.totalMinutes += Number(r.total_minutes || 0);
        });
        return Array.from(by.values()).sort((a, b) => a.project.localeCompare(b.project));
    }

    /**
     * One CSV cell.
     *
     * Excel treats a leading =, +, - or @ as a FORMULA, so a project
     * named "=cmd" would execute on open. Prefixing a quote neutralises
     * it -- the cell still reads correctly, and nothing runs.
     */
    function attCsvCell(value) {
        let out = (value === null || value === undefined) ? '' : String(value);
        if (/^[=+\-@\t\r]/.test(out)) out = "'" + out;
        if (/[",\n\r]/.test(out)) out = '"' + out.replace(/"/g, '""') + '"';
        return out;
    }

    // Excel is the destination for these files, and it is the one that
    // cares about CRLF.
    const CSV_EOL = '\r\n';

    function attToCsv(headers, rows) {
        // CRLF: Excel is the destination, and it is the one that cares.
        return [headers.map(attCsvCell).join(','),
                ...rows.map(r => r.map(attCsvCell).join(','))].join(CSV_EOL);
    }
    function attWorkerNo(n) {
        return (n === null || n === undefined) ? '—' : 'W-' + String(n).padStart(4, '0');
    }

    // ── A3 · Worker management roster ───────────────────────────────
    //
    // Inside the engine block on purpose: these are the rules, and the
    // rules are what tests/attendance.test.js pins. The rendering below
    // is just a table.

    /** The roles that record attendance -- the same pair attendance-signin accepts. */
    const ATT_WORKER_ROLES = ['worker', 'teamLeader'];

    /**
     * The key a worker sorts under.
     *
     * Deliberately the same precedence attWorkerName displays: display
     * name, then the email local-part, then the worker number. Sorting on
     * a field other than the one on screen produces a list that looks
     * unsorted to the person reading it.
     */
    function attWorkerNameKey(w) {
        const name = (w.display_name || '').trim();
        if (name) return name.toLowerCase();
        const local = (w.email || '').split('@')[0];
        if (local) return local.toLowerCase();
        if (w.worker_no === null || w.worker_no === undefined) return '';
        return attWorkerNo(w.worker_no).toLowerCase();
    }

    /**
     * Every worker on the books, active or not.
     *
     * NOT attLoadToday's filter, and the difference is the whole point of
     * the screen. A1 answers "who is on site today" and drops inactive
     * rows; A3 is where a worker is deactivated and reactivated, so
     * hiding the inactive ones would remove the only route back -- the
     * button lives on the screen that would refuse to show them.
     *
     * `_active` is resolved once, here: coalesce(status,'active'), the
     * same rule the RPCs and attendance-signin apply to older rows that
     * carry no status at all.
     */
    function attWorkerRoster(rows) {
        return (rows || [])
            .filter(w => ATT_WORKER_ROLES.indexOf(w.role) !== -1)
            .map(w => Object.assign({}, w, { _active: (w.status || 'active') === 'active' }))
            .sort((a, b) => {
                if (a._active !== b._active) return a._active ? -1 : 1;
                return attWorkerNameKey(a).localeCompare(attWorkerNameKey(b));
            });
    }

    // ── A4 · Create-worker validation ───────────────────────────────

    /**
     * Validates the A4 create-worker form.
     *
     * Pure, and in the engine block on purpose: these are the rules, and
     * the rules are what tests/attendance.test.js pins. The modal below
     * only paints the messages this returns.
     *
     * Roles are worker and teamLeader ONLY -- ATT_WORKER_ROLES, the same
     * pair A3 lists and attendance-signin accepts. Staff, engineer and
     * owner accounts are created in Users -> Navigator. Minting them from
     * here would put a second, less-guarded route to a privileged account
     * in the portal, and the Edge Function's owner/staff gate is the only
     * thing standing behind it.
     *
     * `position` is deliberately NOT required, matching the same call in
     * user-navigator: a worker whose trade has not been decided yet still
     * has to be able to time in.
     */
    function attValidateNewWorker(input) {
        const i = input || {};
        const firstName = String(i.firstName || '').trim();
        const lastName  = String(i.lastName  || '').trim();
        // Lowercased to match what auth stores -- login returns a
        // lowercased email, and a case mismatch orphans the profile from
        // the account it belongs to.
        const email     = String(i.email || '').trim().toLowerCase();
        const role      = String(i.role || '');
        const position  = String(i.position || '').trim();
        const password  = String(i.password || '');
        const confirm   = String(i.confirm  || '');

        const errors = {};
        if (!firstName) errors.firstName = 'First name is required.';
        if (!lastName)  errors.lastName  = 'Last name is required.';
        if (!email) errors.email = 'Email is required.';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
        if (ATT_WORKER_ROLES.indexOf(role) === -1) errors.role = 'Please select a role.';
        if (!password) errors.password = 'Password is required.';
        else if (password.length < 8) errors.password = 'Minimum 8 characters.';
        if (!confirm) errors.confirm = 'Please confirm the password.';
        else if (confirm !== password) errors.confirm = 'Passwords don\'t match.';

        return {
            valid: Object.keys(errors).length === 0,
            errors: errors,
            // worker_no is absent on purpose: the profiles_worker_no_trg
            // trigger (0050) assigns it from worker_no_seq on insert. A
            // number chosen in the browser would race every other admin
            // creating a worker at the same moment.
            payload: {
                firstName: firstName,
                lastName: lastName,
                displayName: (firstName + ' ' + lastName).trim(),
                email: email,
                role: role,
                position: position,
                password: password
            }
        };
    }

    // ==== ATT REPORT ENGINE END ====

    const PHOTO_BUCKET = 'attendance';

    // Anything above this between capture and arrival, on a record that
    // was NOT captured offline, means the device clock disagrees with the
    // server's. When was_offline is true the gap is legitimately hours
    // and proves nothing — see the clock-skew note in 0050.
    const SKEW_WARN_MINUTES = 10;

    function attEsc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Local date key. NEVER toISOString().slice(0,10) — PH is UTC+8 and
    // that rolls the key back a day, which would show yesterday's
    // attendance every morning before 08:00 (see CLAUDE.md).
    function attTodayKey() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function attTime(ts) {
        if (!ts) return '—';
        return new Date(ts).toLocaleTimeString('en-PH',
            { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    /** "9h 45m" — the same shape the worker sees in the app. */
    function attHours(minutes) {
        if (minutes === null || minutes === undefined) return '—';
        const m = Math.max(0, Number(minutes) | 0);
        return `${Math.floor(m / 60)}h ${m % 60}m`;
    }

    /**
     * Signed URL for an attendance photo.
     *
     * NOT window.dacsSignedUrl: that helper is hardcoded to the `uploads`
     * bucket. Attendance photos live in their own private `attendance`
     * bucket (0050 §7), so they need their own signer.
     */
    const _attSignCache = new Map();
    async function attSignedPhoto(path, expiresIn = 3600) {
        if (!path) return null;
        const hit = _attSignCache.get(path);
        if (hit && hit.exp > Date.now()) return hit.url;

        const { data, error } = await window.sbClient
            .storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresIn);
        if (error) { console.warn('attendance photo sign failed:', error.message); return null; }

        _attSignCache.set(path, {
            url: data.signedUrl,
            exp: Date.now() + Math.max(expiresIn - 600, 60) * 1000
        });
        return data.signedUrl;
    }

    /**
     * The name to show for a worker.
     *
     * Falls back to the email local-part, then the worker number. A row
     * an owner cannot identify is useless to them -- and profiles rows
     * created before display_name was collected really do exist (two of
     * them showed as "—" the first time this screen was opened).
     */
    function attWorkerName(w) {
        if (w.display_name && w.display_name.trim()) return w.display_name.trim();
        const local = (w.email || '').split('@')[0];
        if (local) return local;
        return attWorkerNo(w.worker_no);
    }

    /**
     * Redraw the lucide `<i data-lucide>` placeholders this module emits.
     *
     * Every screen here is innerHTML'd in one go, so the icons arrive
     * after lucide's own boot pass has already run. The house pattern
     * (boq-module, client-accounts, …) is to call this at the end of a
     * render; skipping it leaves empty squares where the icons should be.
     */
    function attIcons() {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }

    /** Up to two initials for the A2 avatar. */
    function attInitials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '—';
        return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    // ── A1 · Today's attendance ─────────────────────────────────────

    /**
     * Every ACTIVE worker, with today's record if they have one.
     *
     * A left join, not a plain select on attendance_records: a worker who
     * has not timed in has no row at all, and those are precisely the
     * people the owner opens this screen to find. Selecting only records
     * would show a tidy list that hides every absence.
     *
     * RLS does the tenant scoping (can_access(owner_id)), so neither
     * query filters by owner — a second copy of that rule here would be
     * one more thing to drift.
     */
    async function attLoadToday(workDate) {
        const sb = window.sbClient;

        const [{ data: workers, error: wErr }, { data: records, error: rErr }] = await Promise.all([
            sb.from('profiles')
              .select('id,display_name,position,worker_no,status,role')
              .in('role', ['worker', 'teamLeader'])
              .order('display_name'),
            sb.from('attendance_records')
              .select('id,worker_id,worker_name,worker_position,status,' +
                      'timein_at,timeout_at,timein_project_name,timeout_project_name,total_minutes,' +
                      'timein_photo_path,timeout_photo_path,' +
                      'timein_was_offline,timeout_was_offline,timein_received_at,timeout_received_at')
              .eq('work_date', workDate)
        ]);
        if (wErr) throw wErr;
        if (rErr) throw rErr;

        const byWorker = new Map((records || []).map(r => [r.worker_id, r]));

        return (workers || [])
            .filter(w => (w.status || 'active') === 'active')
            .map(w => ({ worker: w, record: byWorker.get(w.id) || null }));
    }

    function attStatusPill(record) {
        if (!record) {
            return '<span class="att-pill att-pill--none">No record</span>';
        }
        if (record.status === 'complete') {
            return '<span class="att-pill att-pill--done">Complete</span>';
        }
        if (record.status === 'abandoned') {
            // Set by an admin sweep, never by the app: a Time In with no
            // Time Out, closed after the fact. Named so it is obvious the
            // hours are not a measurement.
            return '<span class="att-pill att-pill--abandoned">Abandoned</span>';
        }
        return '<span class="att-pill att-pill--working">Working</span>';
    }

    /** Minutes between capture and the server receiving it. */
    function attSkewMinutes(capturedAt, receivedAt) {
        if (!capturedAt || !receivedAt) return null;
        return Math.round((new Date(receivedAt) - new Date(capturedAt)) / 60000);
    }

    /**
     * The badges an admin needs and a worker never sees.
     *
     * `offline` is a fact, not an accusation — it is why the gap exists.
     * The skew warning is deliberately suppressed for offline records,
     * because for those the gap is expected and flagging it would
     * manufacture suspicion of an honest worker.
     */
    function attBadges(record) {
        if (!record) return '';
        const out = [];

        if (record.timein_was_offline || record.timeout_was_offline) {
            out.push('<span class="att-badge att-badge--offline" ' +
                     'title="Captured with no signal and synced later">offline</span>');
        }

        const inSkew = record.timein_was_offline
            ? null : attSkewMinutes(record.timein_at, record.timein_received_at);
        const outSkew = record.timeout_was_offline
            ? null : attSkewMinutes(record.timeout_at, record.timeout_received_at);
        const worst = Math.max(inSkew || 0, outSkew || 0);

        if (worst >= SKEW_WARN_MINUTES) {
            out.push('<span class="att-badge att-badge--skew" title="Device clock is ' + worst +
                     ' min behind the server on an online capture">clock ' + worst + 'm</span>');
        }
        return out.join(' ');
    }

    /** One KPI card. `tone` picks the icon tile's gradient. */
    function attKpi(icon, tone, value, label, alert) {
        return `
            <div class="att-kpi${alert ? ' att-kpi--alert' : ''}">
              <div class="att-kpi-icon att-kpi-icon--${tone}"><i data-lucide="${icon}"></i></div>
              <div>
                <div class="att-kpi-num">${value}</div>
                <p class="att-kpi-label">${attEsc(label)}</p>
              </div>
            </div>`;
    }

    /** One A6 stat card. `alert` reddens the figure — used for open records. */
    function attStat(label, value, alert) {
        return '<div class="att-stat">' +
                 '<div class="att-stat-label">' + attEsc(label) + '</div>' +
                 '<div class="att-stat-value' + (alert ? ' att-stat-value--alert' : '') + '">' +
                   attEsc(value) + '</div>' +
               '</div>';
    }

    /**
     * Two thumbnails per row: Time In, then Time Out.
     *
     * Deliberately NOT signed URLs. A signed URL is a round trip per
     * photo, and a 25-worker day would fire 50 of them to draw squares
     * 34px wide. What the owner needs from this column is whether the
     * photo EXISTS -- the picture itself is one click away in A2.
     */
    function attPhotoCell(record) {
        const has = p => (record && p) ? '' : ' att-thumb--empty';
        return `
            <div class="att-photos">
              <span class="att-thumb${has(record && record.timein_photo_path)}"></span>
              <span class="att-thumb${has(record && record.timeout_photo_path)}"></span>
            </div>`;
    }

    async function attRenderToday(container) {
        let workDate = attTodayKey();
        let rows = [];

        container.innerHTML = `
            <div class="att-head">
              <div>
                <h2 class="att-title">Today's Attendance</h2>
                <div class="att-sub" id="attTodayDate"></div>
              </div>
              <div class="att-head-actions">
                <input class="att-input" type="date" id="attWorkDate"
                       value="${attEsc(workDate)}" aria-label="Attendance date">
                <button class="att-btn" type="button" id="attRefresh">
                  <i data-lucide="refresh-cw"></i>Refresh</button>
                <button class="att-btn" type="button" id="attTodayAddWorker">
                  <i data-lucide="user-plus"></i>Add worker</button>
                <button class="att-btn att-btn--primary" type="button" id="attExport">
                  <i data-lucide="download"></i>Export</button>
              </div>
            </div>
            <div id="attTodayBody">Loading…</div>
            <div id="attTodayModalHost"></div>`;

        const body = container.querySelector('#attTodayBody');
        const dateInput = container.querySelector('#attWorkDate');

        function stampDate() {
            const [y, m, d] = workDate.split('-').map(Number);
            const label = new Date(y, m - 1, d).toLocaleDateString('en-PH',
                { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            const at = new Date().toLocaleTimeString('en-PH',
                { hour: 'numeric', minute: '2-digit', hour12: true });
            // "loaded", never "live": this screen does not poll, and on a
            // past date there is nothing live about it.
            container.querySelector('#attTodayDate').textContent = `${label} · loaded ${at}`;
        }

        /** The rows the filters leave standing — what is drawn AND exported. */
        function visible() {
            const q = (container.querySelector('#attSearch') || {}).value || '';
            const proj = (container.querySelector('#attProjFilter') || {}).value || '';
            const needle = q.trim().toLowerCase();
            return rows.filter(({ worker, record }) => {
                const project = record ? (record.timein_project_name || '') : '';
                if (proj && project !== proj) return false;
                if (!needle) return true;
                return [attWorkerName(worker), worker.position, attWorkerNo(worker.worker_no), project]
                    .some(v => String(v || '').toLowerCase().includes(needle));
            });
        }

        function paintRows() {
            const shown = visible();
            const tbody = container.querySelector('#attTodayRows');
            if (!shown.length) {
                tbody.innerHTML = '<tr><td colspan="8" class="att-empty">' +
                                  'No worker matches this search.</td></tr>';
                return;
            }
            tbody.innerHTML = shown.map(({ worker, record }) => `
                <tr class="att-row${record ? '' : ' att-row--none'}" data-worker="${attEsc(worker.id)}">
                  <td>
                    <div class="att-worker">${attEsc(attWorkerName(worker))}</div>
                    <div class="att-meta">${attEsc(worker.position || '—')} · ${attWorkerNo(worker.worker_no)}</div>
                  </td>
                  <td>${attEsc(record ? (record.timein_project_name || '—') : '—')}</td>
                  <td class="att-mono">${attTime(record && record.timein_at)}</td>
                  <td class="att-mono">${attTime(record && record.timeout_at)}</td>
                  <td>${attPhotoCell(record)}</td>
                  <td class="att-mono">${attHours(record ? record.total_minutes : null)}</td>
                  <td>${attStatusPill(record)} ${attBadges(record)}</td>
                  <td class="att-right"><span class="att-link">View</span></td>
                </tr>`).join('');

            tbody.querySelectorAll('.att-row').forEach(tr => {
                tr.addEventListener('click', () => {
                    window.attendanceOpenWorker(tr.getAttribute('data-worker'), workDate);
                });
            });
        }

        function exportCsv() {
            const shown = visible();
            if (!shown.length) { alert('Nothing to export for this day.'); return; }
            const csv = attToCsv(
                ['Worker', 'Position', 'Worker no', 'Project', 'Time in', 'Time out',
                 'Hours', 'Status'],
                shown.map(({ worker, record }) => [
                    attWorkerName(worker), worker.position, attWorkerNo(worker.worker_no),
                    record ? record.timein_project_name : '',
                    attTime(record && record.timein_at), attTime(record && record.timeout_at),
                    attHours(record ? record.total_minutes : null),
                    record ? record.status : 'no record'
                ])
            );
            attDownloadCsv('attendance-' + workDate + '.csv', csv);
        }

        async function load() {
            stampDate();
            body.innerHTML = 'Loading…';
            try {
                rows = await attLoadToday(workDate);
            } catch (e) {
                body.innerHTML = `<div class="att-error">Could not load attendance: ${attEsc(e.message || e)}</div>`;
                return;
            }

            if (!rows.length) {
                body.innerHTML = '<div class="att-empty">No active workers yet. ' +
                                 'Add them in <strong>Workers</strong>, or in Users → Navigator.</div>';
                return;
            }

            const timedIn  = rows.filter(r => r.record).length;
            const timedOut = rows.filter(r => r.record && r.record.timeout_at).length;
            const working  = rows.filter(r => r.record && !r.record.timeout_at
                                              && r.record.status !== 'abandoned').length;

            const projects = [...new Set(rows
                .map(r => r.record && r.record.timein_project_name)
                .filter(Boolean))].sort();

            body.innerHTML = `
                <div class="att-kpis">
                  ${attKpi('users',    'total',   rows.length,           'Total Workers')}
                  ${attKpi('log-in',   'in',      timedIn,               'Timed In')}
                  ${attKpi('log-out',  'out',     timedOut,              'Timed Out')}
                  ${attKpi('hard-hat', 'working', working,               'Currently Working')}
                  ${attKpi('user-x',   'none',    rows.length - timedIn, 'No Attendance',
                           rows.length > timedIn)}
                </div>

                <div class="att-card">
                  <div class="att-card-head">
                    <h3 class="att-card-title">Worker records</h3>
                    <div class="att-card-tools">
                      <div class="att-search-wrap">
                        <i data-lucide="search"></i>
                        <input class="att-search" type="search" id="attSearch"
                               placeholder="Search worker or project…" aria-label="Search">
                      </div>
                      <select class="att-filter" id="attProjFilter" aria-label="Filter by project">
                        <option value="">All projects</option>
                        ${projects.map(p => `<option value="${attEsc(p)}">${attEsc(p)}</option>`).join('')}
                      </select>
                    </div>
                  </div>
                  <table class="att-table">
                    <thead>
                      <tr>
                        <th>Worker</th><th>Project</th><th>Time In</th><th>Time Out</th>
                        <th>Photos</th><th>Total</th><th>Status</th><th></th>
                      </tr>
                    </thead>
                    <tbody id="attTodayRows"></tbody>
                  </table>
                </div>`;

            container.querySelector('#attSearch').addEventListener('input', paintRows);
            container.querySelector('#attProjFilter').addEventListener('change', paintRows);
            paintRows();
            attIcons();
        }

        container.querySelector('#attRefresh').addEventListener('click', load);
        container.querySelector('#attExport').addEventListener('click', exportCsv);

        // The SAME A4 modal the Workers screen opens -- not a second copy
        // of the form. Account creation is one code path with one set of
        // validation rules, or the two screens drift and only one of them
        // stays in step with the admin-create-user Edge Function.
        //
        // `load` rather than a full re-render: it refetches the list while
        // leaving the chosen date and the header alone. The new worker
        // appears immediately as "No record", which is the honest state --
        // they exist, and they have not timed in.
        container.querySelector('#attTodayAddWorker').addEventListener('click', () => {
            attOpenNewWorker(container.querySelector('#attTodayModalHost'), load);
        });
        dateInput.addEventListener('change', () => {
            workDate = dateInput.value || attTodayKey();
            load();
        });

        attIcons();
        await load();
    }

    // ── A2 · Worker detail ──────────────────────────────────────────

    async function attRenderWorker(container, workerId, workDate) {
        container.innerHTML = `
            <div class="att-crumbs">
              <button class="att-link" type="button" id="attBack">Today's Attendance</button>
              <i data-lucide="chevron-right"></i>
              <span id="attCrumbName">Attendance detail</span>
            </div>
            <div id="attWorkerBody">Loading…</div>`;
        container.querySelector('#attBack')
            .addEventListener('click', () => switchView('attToday'));
        attIcons();

        const body = container.querySelector('#attWorkerBody');
        const sb = window.sbClient;

        // The profile is fetched alongside the record for one field the
        // record does not snapshot: worker_no. A1 shows it on every row,
        // so the drill-down that A1 opens must not drop it.
        const [{ data: rows, error }, { data: profiles }] = await Promise.all([
            sb.from('attendance_records')
              .select('*')
              .eq('worker_id', workerId)
              .eq('work_date', workDate)
              .limit(1),
            sb.from('profiles').select('worker_no').eq('id', workerId).limit(1)
        ]);
        if (error) {
            body.innerHTML = `<div class="att-error">Could not load record: ${attEsc(error.message)}</div>`;
            return;
        }

        const r = (rows || [])[0];
        if (!r) {
            body.innerHTML = '<div class="att-empty">This worker has no record for this day.</div>';
            return;
        }
        const workerNo = attWorkerNo(((profiles || [])[0] || {}).worker_no);

        const [inUrl, outUrl] = await Promise.all([
            attSignedPhoto(r.timein_photo_path),
            attSignedPhoto(r.timeout_photo_path)
        ]);

        const name = r.worker_name || '—';
        container.querySelector('#attCrumbName').textContent = name;

        const dayLabel = (() => {
            const [y, m, d] = String(r.work_date).split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('en-PH',
                { day: 'numeric', month: 'long', year: 'numeric' });
        })();

        // The span is stated from the two stamps, but the FIGURE is
        // total_minutes as the database computed it -- never recomputed
        // here, so the screen can never disagree with the report.
        const span = (r.timein_at && r.timeout_at)
            ? `${attTime(r.timein_at)} → ${attTime(r.timeout_at)} · computed by the system`
            : 'Time Out not recorded yet';

        body.innerHTML = `
            <div class="att-head">
              <div class="att-ident">
                <div class="att-avatar">${attEsc(attInitials(name))}</div>
                <div>
                  <h2 class="att-title">${attEsc(name)}</h2>
                  <div class="att-sub">${attEsc(r.worker_position || '—')} ·
                    ${attEsc(r.timein_project_name || '—')} · ${attEsc(dayLabel)}</div>
                </div>
              </div>
              <div class="att-head-actions">
                <button class="att-btn" type="button" id="attPrint">
                  <i data-lucide="printer"></i>Print</button>
              </div>
            </div>

            <div class="att-detail-grid">
              ${attHalf('Time In', 'in', 'log-in', r.timein_at, r.timein_project_name,
                        r.timein_description, inUrl, r.timein_photo_path)}
              ${attHalf('Time Out', 'out', 'log-out', r.timeout_at, r.timeout_project_name,
                        r.timeout_description, outUrl, r.timeout_photo_path)}

              <div class="att-side">
                <div class="att-total">
                  <div class="att-total-label">Total hours</div>
                  <div class="att-total-value">${attHours(r.total_minutes)}</div>
                  <div class="att-total-note">${attEsc(span)}</div>
                </div>
                <div class="att-facts">
                  <div class="att-fact">
                    <span class="att-fact-key">Status</span>
                    <span class="att-fact-val">${attStatusPill(r)} ${attBadges(r)}</span>
                  </div>
                  <div class="att-fact">
                    <span class="att-fact-key">Worker ID</span>
                    <span class="att-fact-val att-mono">${attEsc(workerNo)}</span>
                  </div>
                  <div class="att-fact">
                    <span class="att-fact-key">Position</span>
                    <span class="att-fact-val">${attEsc(r.worker_position || '—')}</span>
                  </div>
                  <div class="att-fact">
                    <span class="att-fact-key">Recorded by</span>
                    <span class="att-fact-val">Worker device</span>
                  </div>
                  <div class="att-fact-foot">Time In and Time Out projects are stored
                    separately. If they differ, both are shown as selected.</div>
                </div>
              </div>
            </div>`;

        container.querySelector('#attPrint').addEventListener('click', () => window.print());
        attIcons();
    }

    function attHalf(label, tone, icon, at, project, description, photoUrl, photoPath) {
        return `
            <div class="att-half">
              <div class="att-half-head">
                <div class="att-half-icon att-half-icon--${tone}"><i data-lucide="${icon}"></i></div>
                <h3 class="att-half-title">${attEsc(label)}</h3>
                <span class="att-half-time">${attTime(at)}</span>
              </div>
              <div class="att-photo-frame">
                ${photoUrl
                  ? `<a href="${attEsc(photoUrl)}" target="_blank" rel="noopener"
                        style="display:block;width:100%;height:100%;">
                       <img class="att-photo" src="${attEsc(photoUrl)}" alt="${attEsc(label)} photo">
                     </a>`
                  : `<div class="att-photo--missing">${photoPath ? 'Photo unavailable' : 'No ' + attEsc(label) + ' photo'}</div>`}
              </div>
              <div class="att-half-body">
                <div>
                  <div class="att-fact-label">Project selected at ${attEsc(label)}</div>
                  <div class="att-fact-strong">${attEsc(project || '—')}</div>
                </div>
                <div>
                  <div class="att-fact-label">Description</div>
                  <div class="att-fact-text">${attEsc(description || '—')}</div>
                </div>
              </div>
            </div>`;
    }

    // ── A3 · Worker management ──────────────────────────────────────

    /**
     * Every worker profile, deactivated ones included.
     *
     * `email` is selected here and NOT in attLoadToday, deliberately.
     * Two workers really can share a display name -- there were two
     * "John Tapales" rows the day this screen was written -- and the
     * email is the only thing on the row that tells them apart. Getting
     * that wrong deactivates the wrong person.
     *
     * RLS does the tenant scoping (can_access(owner_id)), so no owner
     * filter here: a second copy of that rule is one more thing to drift.
     */
    async function attLoadWorkers() {
        const { data, error } = await window.sbClient
            .from('profiles')
            .select('id,display_name,email,position,worker_no,status,role')
            .in('role', ATT_WORKER_ROLES);
        if (error) throw error;
        return attWorkerRoster(data || []);
    }

    async function attRenderWorkers(container) {
        container.innerHTML = `
            <div class="att-head">
              <div>
                <h2 class="att-title">Workers</h2>
                <div class="att-sub" id="attWorkersCount">Everyone who can time in from the app</div>
              </div>
              <div class="att-head-actions">
                <button class="att-btn" type="button" id="attWorkersRefresh">
                  <i data-lucide="refresh-cw"></i>Refresh</button>
                <button class="att-btn att-btn--primary" type="button" id="attAddWorker">
                  <i data-lucide="user-plus"></i>Add worker</button>
              </div>
            </div>
            <div id="attWorkersBody">Loading…</div>
            <div id="attWorkerModalHost"></div>`;

        container.querySelector('#attWorkersRefresh')
            .addEventListener('click', () => attRenderWorkers(container));

        container.querySelector('#attAddWorker').addEventListener('click', () => {
            attOpenNewWorker(container.querySelector('#attWorkerModalHost'),
                             () => attRenderWorkers(container));
        });
        attIcons();

        const body = container.querySelector('#attWorkersBody');
        let rows;
        try {
            rows = await attLoadWorkers();
        } catch (e) {
            body.innerHTML = `<div class="att-error">Could not load workers: ${attEsc(e.message || e)}</div>`;
            return;
        }

        if (!rows.length) {
            body.innerHTML = '<div class="att-empty">No workers yet. Use ' +
                             '<strong>Add worker</strong> above — staff and engineer ' +
                             'accounts are created in Users → Navigator.</div>';
            return;
        }

        const active = rows.filter(w => w._active).length;
        container.querySelector('#attWorkersCount').textContent =
            `${rows.length} account${rows.length === 1 ? '' : 's'} · ` +
            `${active} active · ${rows.length - active} deactivated`;

        body.innerHTML = `
            <div class="att-card">
              <table class="att-table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Position</th><th>Role</th>
                      <th>Account</th><th></th></tr>
                </thead>
                <tbody>
                  ${rows.map(w => `
                    <tr class="${w._active ? '' : 'att-row--none'}">
                      <td>
                        <div class="att-worker">${attEsc(attWorkerName(w))}</div>
                        <div class="att-meta att-mono">${attWorkerNo(w.worker_no)}</div>
                      </td>
                      <td>${attEsc(w.email || '—')}</td>
                      <td>${attEsc(w.position || '—')}</td>
                      <td>${w.role === 'teamLeader' ? 'Team Leader' : 'Worker'}</td>
                      <td>${w._active
                          ? '<span class="att-pill att-pill--done">Active</span>'
                          : '<span class="att-pill att-pill--none">Deactivated</span>'}</td>
                      <td class="att-right">
                        <div class="att-actions">
                          <button class="att-link ${w._active ? 'att-link--danger' : ''}"
                                  type="button" data-toggle="${attEsc(w.id)}"
                                  data-active="${w._active ? '1' : '0'}">
                            ${w._active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="att-note">Deactivating removes a worker from Today&rsquo;s
              list and stops them signing in to the app — attendance-signin
              refuses an inactive account before it issues any tokens.
              Records already recorded against them are untouched.</div>`;

        body.querySelectorAll('button[data-toggle]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-toggle');
                const nowActive = btn.getAttribute('data-active') === '1';
                const { error } = await window.sbClient.from('profiles')
                    .update({ status: nowActive ? 'inactive' : 'active' }).eq('id', id);
                if (error) { alert('Could not update worker: ' + error.message); return; }
                attRenderWorkers(container);
            });
        });
    }

    // ── A4 · Create worker account ──────────────────────────────────
    //
    // The account is minted by the admin-create-user Edge Function, never
    // from the browser: it holds the service_role key and gates the caller
    // to owner/staff. Three consequences shape everything below.
    //
    // 1. `kind` must be 'admin'. The function accepts admin, client and
    //    construction_client only, and a worker is internal, not a client.
    //    `role` is the field that separates a worker from an engineer.
    // 2. The function builds its profile row from a FIXED WHITELIST (id,
    //    kind, role, owner_id, email, names, status, agreement_accepted).
    //    `position` is not in it and cannot be passed through without a
    //    function deploy, so it is written afterwards -- the same
    //    follow-up user-navigator makes, for the same reason.
    // 3. A duplicate email is REFUSED outright (409) before a single row
    //    is written. Do not "helpfully" retry or reuse the existing uid:
    //    the function's own header explains that the reuse path handed
    //    people credentials that could never work, and setting the
    //    password on it would turn this form into account takeover.
    //
    // Terms are NOT pre-signed here. A worker accepts them on screen 02 of
    // the worker app, on their own device. Ticking a box on their behalf
    // from an admin desk records a signature nobody gave.

    function attCloseNewWorker(host) {
        if (host._attEsc) {
            document.removeEventListener('keydown', host._attEsc);
            host._attEsc = null;
        }
        host.innerHTML = '';
    }

    function attOpenNewWorker(host, onCreated) {
        host.innerHTML = `
            <div class="att-modal" id="attNewWorkerModal">
              <div class="att-modal-box" role="dialog" aria-modal="true"
                   aria-labelledby="attNewWorkerTitle">
                <div class="att-modal-head">
                  <div>
                    <h3 class="att-modal-title" id="attNewWorkerTitle">Add worker account</h3>
                    <p class="att-modal-sub">The worker signs in with the email and
                      password you set here.</p>
                  </div>
                  <button class="att-modal-x" type="button" id="attNwX" aria-label="Close">&times;</button>
                </div>
                <form class="att-modal-form" id="attNewWorkerForm" autocomplete="off">
                  <div class="att-modal-body">
                    <div class="att-field">
                      <label for="attNwFirst">First name <span class="att-req">*</span></label>
                      <input class="att-input" id="attNwFirst" type="text">
                      <div class="att-err" data-err="firstName"></div>
                    </div>
                    <div class="att-field">
                      <label for="attNwLast">Last name <span class="att-req">*</span></label>
                      <input class="att-input" id="attNwLast" type="text">
                      <div class="att-err" data-err="lastName"></div>
                    </div>
                    <div class="att-field att-span">
                      <label for="attNwEmail">Email address <span class="att-req">*</span></label>
                      <input class="att-input" id="attNwEmail" type="email"
                             placeholder="worker@dacsbuilding.com">
                      <div class="att-err" data-err="email"></div>
                    </div>
                    <div class="att-field">
                      <label for="attNwRole">Role <span class="att-req">*</span></label>
                      <select class="att-input" id="attNwRole">
                        <option value="worker">Worker</option>
                        <option value="teamLeader">Team Leader</option>
                      </select>
                      <div class="att-err" data-err="role"></div>
                    </div>
                    <div class="att-field">
                      <label for="attNwPosition">Position / Trade</label>
                      <input class="att-input" id="attNwPosition" type="text"
                             placeholder="e.g. Mason, Carpenter">
                      <div class="att-hint">Shown on every attendance record.</div>
                    </div>
                    <div class="att-field">
                      <label for="attNwPass">Password <span class="att-req">*</span></label>
                      <input class="att-input" id="attNwPass" type="password"
                             placeholder="Min. 8 characters" autocomplete="new-password">
                      <div class="att-err" data-err="password"></div>
                    </div>
                    <div class="att-field">
                      <label for="attNwConfirm">Confirm password <span class="att-req">*</span></label>
                      <input class="att-input" id="attNwConfirm" type="password"
                             autocomplete="new-password">
                      <div class="att-err" data-err="confirm"></div>
                    </div>
                    <div class="att-info att-span">
                      <i data-lucide="shield-check"></i>
                      <div>Passwords are stored hashed, never as plain text. The worker
                        number is assigned automatically, and the Terms are accepted by
                        the worker in the app on first sign-in — they are not signed here.</div>
                    </div>
                    <div class="att-err att-err--general att-span" id="attNwGeneral"></div>
                  </div>
                  <div class="att-modal-foot">
                    <button class="att-btn" type="button" id="attNwCancel">Cancel</button>
                    <button class="att-btn att-btn--primary" type="submit" id="attNwSubmit">
                      Create account
                    </button>
                  </div>
                </form>
              </div>
            </div>`;

        attIcons();

        const val = id => host.querySelector('#' + id).value;
        const general = host.querySelector('#attNwGeneral');
        const submitBtn = host.querySelector('#attNwSubmit');

        function clearErrors() {
            host.querySelectorAll('.att-err').forEach(el => {
                el.textContent = '';
                el.style.display = 'none';
            });
        }
        function showErrors(errors) {
            Object.keys(errors).forEach(k => {
                const el = host.querySelector('[data-err="' + k + '"]');
                if (el) { el.textContent = errors[k]; el.style.display = 'block'; }
            });
        }
        function showGeneral(msg) { general.textContent = msg; general.style.display = 'block'; }

        host.querySelector('#attNwX').addEventListener('click', () => attCloseNewWorker(host));
        host.querySelector('#attNwCancel').addEventListener('click', () => attCloseNewWorker(host));
        // Backdrop only -- a click inside the box must not close a form
        // someone has half-filled.
        host.querySelector('#attNewWorkerModal').addEventListener('click', e => {
            if (e.target.id === 'attNewWorkerModal') attCloseNewWorker(host);
        });
        host._attEsc = e => { if (e.key === 'Escape') attCloseNewWorker(host); };
        document.addEventListener('keydown', host._attEsc);
        host.querySelector('#attNwFirst').focus();

        host.querySelector('#attNewWorkerForm').addEventListener('submit', async e => {
            e.preventDefault();
            clearErrors();

            const check = attValidateNewWorker({
                firstName: val('attNwFirst'),   lastName: val('attNwLast'),
                email:     val('attNwEmail'),   role:     val('attNwRole'),
                position:  val('attNwPosition'),
                password:  val('attNwPass'),    confirm:  val('attNwConfirm')
            });
            if (!check.valid) { showErrors(check.errors); return; }

            const p = check.payload;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating…';
            try {
                const ownerUid = window.currentDataUserId ||
                                 (window.auth && auth.currentUser && auth.currentUser.uid) || '';
                const out = await adminCreateUser({
                    email: p.email, password: p.password, kind: 'admin',
                    role: p.role, ownerUid: ownerUid,
                    firstName: p.firstName, lastName: p.lastName, displayName: p.displayName
                });

                // The account EXISTS from here on. A failure below must
                // never read as "nothing happened" -- that invites a retry
                // straight into the duplicate-email refusal, leaving the
                // admin convinced they never created anyone.
                if (p.position) {
                    try {
                        await db.collection('users').doc(out.uid).update({ position: p.position });
                    } catch (posErr) {
                        console.error('att A4: position not saved', posErr);
                        attCloseNewWorker(host);
                        if (onCreated) onCreated();
                        alert(p.displayName + ' was created, but the position could not be ' +
                              'saved: ' + (posErr.message || posErr) +
                              '\n\nThe account works. Set the position in Users → Navigator.');
                        return;
                    }
                }
                attCloseNewWorker(host);
                if (onCreated) onCreated();
            } catch (err) {
                console.error('att A4: create worker', err);
                const m = String((err && err.message) || '');
                if (/exists|already|registered/i.test(m)) {
                    showErrors({ email: 'An account with this email already exists.' });
                } else if (/forbidden|owner/i.test(m)) {
                    showGeneral('Only an owner or staff account can create workers.');
                } else {
                    showGeneral(m || 'Could not create the worker. Please try again.');
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create account';
            }
        });
    }

    // ── A5 · Project management ─────────────────────────────────────

    /**
     * The picker list the workers' app reads.
     *
     * Until this screen existed these rows could only be created by
     * hand in the SQL editor, which blocked testing twice. Deactivating
     * rather than deleting is deliberate: attendance_records snapshot
     * the project NAME but also reference the id, and deleting a project
     * a worker has already timed in against would orphan real records.
     */
    async function attLoadProjects() {
        // The RPC, never a select on folders / construction_projects.
        // It returns only (project_system, project_id, project_name):
        // folders carries owner-confidential contract money, and a
        // three-column function cannot leak a fourth (migration 0059).
        const { data, error } = await window.sbClient.rpc('attendance_projects_for_worker');
        if (error) throw error;
        return data || [];
    }

    /** 'pc' / 'pm' → the label the rest of the portal uses. */
    function attSystemLabel(system) {
        return system === 'pc' ? 'Project Control'
             : system === 'pm' ? 'Project Management'
             : '—';
    }

    /** Stable key for a project across the two id spaces. */
    function attProjectKey(system, id) { return system + ':' + id; }

    /**
     * How many workers timed in against each project today.
     *
     * Counted on the Time In project, not Time Out: a worker still on
     * site has no Time Out yet, and they are exactly who "workers today"
     * is asking about. Failure is not fatal — the column falls back to
     * zero rather than taking the whole screen down with it.
     */
    async function attWorkersTodayByProject() {
        try {
            const { data, error } = await window.sbClient
                .from('attendance_records')
                .select('timein_project_system,timein_folder_id,timein_pm_project_id')
                .eq('work_date', attTodayKey());
            if (error) throw error;
            const counts = new Map();
            (data || []).forEach(r => {
                // Two id spaces, so the key carries the system with it —
                // a folders id and a construction_projects id could
                // otherwise be compared and silently match nothing.
                const id = r.timein_project_system === 'pc'
                    ? r.timein_folder_id : r.timein_pm_project_id;
                if (!id) return;
                const k = attProjectKey(r.timein_project_system, id);
                counts.set(k, (counts.get(k) || 0) + 1);
            });
            return counts;
        } catch (e) {
            console.warn('attendance: workers-today count failed:', e.message || e);
            return new Map();
        }
    }

    async function attRenderProjects(container) {
        container.innerHTML = `
            <div class="att-head">
              <div>
                <h2 class="att-title">Projects</h2>
                <div class="att-sub" id="attProjectsCount">The projects a worker picks
                  from at Time In and Time Out.</div>
              </div>
              <div class="att-head-actions">
                <button class="att-btn" type="button" id="attProjectsRefresh">
                  <i data-lucide="refresh-cw"></i>Refresh</button>
              </div>
            </div>

            <div class="att-proj-grid">
              <div id="attProjectsBody">Loading…</div>

              <div class="att-card">
                <div class="att-card-head">
                  <div>
                    <h3 class="att-card-title">Where these come from</h3>
                    <p class="att-card-sub">Attendance keeps no project list of its own.</p>
                  </div>
                </div>
                <div class="att-card-body" style="display:flex;flex-direction:column;gap:16px;">
                  <div class="att-info">
                    <i data-lucide="info"></i>
                    <div>This is a read-only view. A project appears here as soon as it
                      exists in <strong>Project Control</strong> or
                      <strong>Project Management</strong> — create, rename or close it
                      there and the worker's picker follows.</div>
                  </div>
                  <div class="att-info">
                    <i data-lucide="eye-off"></i>
                    <div>Workers see only the project's <strong>name</strong>. Contract
                      values and budgets are never sent to the app.</div>
                  </div>
                  <div class="att-info">
                    <i data-lucide="history"></i>
                    <div>Each record snapshots the project name at Time In, so past
                      attendance keeps the name it was saved with even after a rename.</div>
                  </div>
                </div>
              </div>
            </div>`;

        container.querySelector('#attProjectsRefresh')
            .addEventListener('click', () => attRenderProjects(container));

        const body = container.querySelector('#attProjectsBody');
        let rows, todayCounts;
        try {
            [rows, todayCounts] = await Promise.all([attLoadProjects(), attWorkersTodayByProject()]);
        } catch (e) {
            body.innerHTML = `<div class="att-error">Could not load projects: ${attEsc(e.message || e)}</div>`;
            attIcons();
            return;
        }

        if (!rows.length) {
            body.innerHTML = '<div class="att-card"><div class="att-empty">No projects yet. ' +
                             'Create one in <strong>Project Control</strong> or ' +
                             '<strong>Project Management</strong> — until a project exists ' +
                             'the workers&rsquo; app has nothing to pick, and a worker ' +
                             'cannot time in at all.</div></div>';
            attIcons();
            return;
        }

        const pc = rows.filter(p => p.project_system === 'pc').length;
        container.querySelector('#attProjectsCount').textContent =
            `${rows.length} project${rows.length === 1 ? '' : 's'} · ` +
            `${pc} from Project Control · ${rows.length - pc} from Project Management`;

        body.innerHTML = `
            <div class="att-card">
              <table class="att-table">
                <thead>
                  <tr><th>Project</th><th>From</th><th>Workers today</th></tr>
                </thead>
                <tbody>
                  ${rows.map(p => `
                    <tr>
                      <td><div class="att-worker">${attEsc(p.project_name)}</div></td>
                      <td><span class="att-pill att-pill--${attEsc(p.project_system)}">${
                          attEsc(attSystemLabel(p.project_system))}</span></td>
                      <td class="att-mono">${
                          todayCounts.get(attProjectKey(p.project_system, p.project_id)) || 0}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="att-note">Read-only on purpose. A project is created, renamed and
              closed in the module that owns it — attendance follows. Closing a Project
              Management job (status other than <em>active</em>) removes it from the
              worker&rsquo;s picker; records already saved against it are untouched.</div>`;

        attIcons();
    }

    // ── A6 · Attendance reports ─────────────────────────────────────

    /** Local date key. Never toISOString — PH is UTC+8 (see CLAUDE.md). */
    function attDateKey(d) {
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function attDefaultRange() {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 6);   // the last 7 days, inclusive
        return { from: attDateKey(from), to: attDateKey(to) };
    }

    async function attLoadRange(from, to) {
        const { data, error } = await window.sbClient
            .from('attendance_records')
            .select('worker_id,worker_name,worker_position,work_date,status,' +
                    'timein_at,timeout_at,timein_project_name,total_minutes,' +
                    'timein_was_offline,timeout_was_offline')
            .gte('work_date', from)
            .lte('work_date', to)
            .order('work_date', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    /**
     * Hands the browser a file.
     *
     * A Blob rather than a data: URI because a month of records exceeds
     * what some browsers accept in a URL, and the failure mode there is a
     * SILENTLY TRUNCATED report — worse than an error, because the
     * numbers that remain still look plausible.
     */
    function attDownloadCsv(filename, csv) {
        // BOM: without it Excel reads UTF-8 as Latin-1 and turns "ñ" into
        // mojibake. Filipino names have ñ in them.
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * The date range behind each preset on the period control.
     *
     * Built from LOCAL parts, never toISOString — PH is UTC+8 and the
     * UTC key rolls back a day (see CLAUDE.md). "Daily" is today alone;
     * weekly and monthly are the trailing 7 and 30 days, inclusive.
     */
    function attPresetRange(period) {
        const to = new Date();
        const from = new Date();
        if (period === 'daily')   from.setDate(from.getDate() - 0);
        if (period === 'weekly')  from.setDate(from.getDate() - 6);
        if (period === 'monthly') from.setDate(from.getDate() - 29);
        return { from: attDateKey(from), to: attDateKey(to) };
    }

    /** "Aug 10 – Aug 16, 2026" from two local date keys. */
    function attRangeLabel(from, to) {
        const fmt = (key, opts) => {
            const [y, m, d] = String(key).split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('en-PH', opts);
        };
        return fmt(from, { month: 'short', day: 'numeric' }) + ' – ' +
               fmt(to, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    async function attRenderReports(container) {
        const range = attDefaultRange();
        container.innerHTML =
            '<div class="att-head">' +
              '<div>' +
                '<h2 class="att-title">Attendance Reports</h2>' +
                '<div class="att-sub" id="attRangeLabel"></div>' +
              '</div>' +
              '<div class="att-head-actions">' +
                '<div class="att-seg" id="attPeriod">' +
                  '<button class="att-seg-btn" type="button" data-period="daily">Daily</button>' +
                  '<button class="att-seg-btn is-on" type="button" data-period="weekly">Weekly</button>' +
                  '<button class="att-seg-btn" type="button" data-period="monthly">Monthly</button>' +
                '</div>' +
                '<button class="att-btn" type="button" id="attCsvWorker">' +
                  '<i data-lucide="download"></i>CSV by worker</button>' +
                '<button class="att-btn att-btn--primary" type="button" id="attCsvDay">' +
                  '<i data-lucide="download"></i>CSV by day</button>' +
              '</div>' +
            '</div>' +
            '<form class="att-toolbar" id="attRangeForm">' +
              '<label for="attFrom">From</label>' +
              '<input class="att-input" type="date" id="attFrom" value="' + attEsc(range.from) + '">' +
              '<label for="attTo">To</label>' +
              '<input class="att-input" type="date" id="attTo" value="' + attEsc(range.to) + '">' +
              '<button class="att-btn" type="submit">Show</button>' +
            '</form>' +
            '<div id="attReportBody">Loading…</div>';

        const body = container.querySelector('#attReportBody');
        let rows = [];

        function stampRange(from, to) {
            container.querySelector('#attRangeLabel').textContent =
                attRangeLabel(from, to) +
                ' · hours recorded, NOT a payroll figure — labour is pakyaw, capped by contract.';
        }

        async function run() {
            const from = container.querySelector('#attFrom').value;
            const to = container.querySelector('#attTo').value;
            if (from > to) {
                body.innerHTML = '<div class="att-error">The start date is after the end date.</div>';
                return;
            }
            stampRange(from, to);
            body.innerHTML = 'Loading…';
            try {
                rows = await attLoadRange(from, to);
            } catch (e) {
                body.innerHTML = '<div class="att-error">Could not load: ' +
                                 attEsc(e.message || e) + '</div>';
                return;
            }

            if (!rows.length) {
                body.innerHTML = '<div class="att-empty">No attendance recorded in this range.</div>';
                return;
            }

            const byWorker = attRollUpByWorker(rows);
            const byProject = attRollUpByProject(rows);

            // Totals restate what the database already computed. The
            // average divides by DAYS THAT HAVE RECORDS, not by the
            // length of the range: a range covering two rest days would
            // otherwise report an average nobody worked.
            const totalMinutes = rows.reduce((s, r) => s + (Number(r.total_minutes) || 0), 0);
            const activeDays = new Set(rows.map(r => r.work_date)).size;
            const complete = rows.filter(r => r.status === 'complete').length;
            const openRecords = rows.filter(r => !r.timeout_at).length;

            body.innerHTML =
                '<div class="att-stats">' +
                  attStat('Total man-hours', attFormatHours(totalMinutes)) +
                  attStat('Average per day', attFormatHours(
                      activeDays ? Math.round(totalMinutes / activeDays) : null)) +
                  attStat('Complete records', complete) +
                  attStat('Missing time out', openRecords, openRecords > 0) +
                '</div>' +

                '<div class="att-card">' +
                  '<div class="att-card-head"><h3 class="att-subhead">Summary by worker</h3></div>' +
                  '<table class="att-table"><thead><tr>' +
                    '<th>Worker</th><th>Days present</th><th>Total hours</th><th>Incomplete</th>' +
                  '</tr></thead><tbody>' +
                  byWorker.map(function (w) {
                      return '<tr>' +
                          '<td><div class="att-worker">' + attEsc(w.name) + '</div>' +
                              '<div class="att-meta">' + attEsc(w.position || '—') + '</div></td>' +
                          '<td class="att-mono">' + w.daysWorked + '</td>' +
                          '<td class="att-mono">' + attFormatHours(w.totalMinutes) + '</td>' +
                          '<td>' + (w.openDays
                              ? '<span class="att-badge att-badge--skew" ' +
                                'title="Timed in but never timed out">' + w.openDays + ' not closed</span>'
                              : '<span class="att-mono">0</span>') + '</td>' +
                      '</tr>';
                  }).join('') +
                  '</tbody></table>' +
                '</div>' +

                '<div class="att-card">' +
                  '<div class="att-card-head"><h3 class="att-subhead">Summary by project</h3></div>' +
                  '<table class="att-table"><thead><tr>' +
                    '<th>Project</th><th>Days present</th><th>Total hours</th>' +
                  '</tr></thead><tbody>' +
                  byProject.map(function (p) {
                      return '<tr>' +
                          '<td><div class="att-worker">' + attEsc(p.project) + '</div></td>' +
                          '<td class="att-mono">' + p.daysWorked + '</td>' +
                          '<td class="att-mono">' + attFormatHours(p.totalMinutes) + '</td>' +
                      '</tr>';
                  }).join('') +
                  '</tbody></table>' +
                '</div>';
        }

        const period = container.querySelector('#attPeriod');
        period.addEventListener('click', function (e) {
            const btn = e.target.closest('.att-seg-btn');
            if (!btn) return;
            period.querySelectorAll('.att-seg-btn').forEach(b => b.classList.toggle('is-on', b === btn));
            const preset = attPresetRange(btn.getAttribute('data-period'));
            container.querySelector('#attFrom').value = preset.from;
            container.querySelector('#attTo').value = preset.to;
            run();
        });

        container.querySelector('#attRangeForm').addEventListener('submit', function (e) {
            e.preventDefault();
            run();
        });

        container.querySelector('#attCsvWorker').addEventListener('click', function () {
            const from = container.querySelector('#attFrom').value;
            const to = container.querySelector('#attTo').value;
            const csv = attToCsv(
                ['Worker', 'Position', 'Days worked', 'Hours', 'Days not closed'],
                attRollUpByWorker(rows).map(function (w) {
                    return [w.name, w.position, w.daysWorked, attFormatHours(w.totalMinutes), w.openDays];
                })
            );
            attDownloadCsv('attendance-by-worker-' + from + '-to-' + to + '.csv', csv);
        });

        container.querySelector('#attCsvDay').addEventListener('click', function () {
            const from = container.querySelector('#attFrom').value;
            const to = container.querySelector('#attTo').value;
            const csv = attToCsv(
                ['Work date', 'Worker', 'Position', 'Project', 'Time in', 'Time out',
                 'Hours', 'Status', 'Captured offline'],
                rows.map(function (r) {
                    return [
                        r.work_date, r.worker_name, r.worker_position, r.timein_project_name,
                        attTime(r.timein_at), attTime(r.timeout_at),
                        attFormatHours(r.total_minutes), r.status,
                        // was_offline is ADMIN-facing only; the worker is
                        // never shown it (design §6.3).
                        (r.timein_was_offline || r.timeout_was_offline) ? 'yes' : 'no'
                    ];
                })
            );
            attDownloadCsv('attendance-by-day-' + from + '-to-' + to + '.csv', csv);
        });

        attIcons();
        run();
    }

    // ── Entry points ────────────────────────────────────────────────

    let _attWorkerId = null;
    let _attWorkDate = null;

    /** Drill-down from the today list. */
    window.attendanceOpenWorker = function (workerId, workDate) {
        _attWorkerId = workerId;
        _attWorkDate = workDate || attTodayKey();
        switchView('attWorker');
    };

    /**
     * Called by switchView for every ATT_VIEWS view, matching the house
     * pattern (initPMModule, initQuotationModule, …).
     */
    window.initAttendanceModule = function (view) {
        if (view === 'attToday') {
            const el = document.getElementById('attTodayView');
            if (el) attRenderToday(el);
            return;
        }
        if (view === 'attWorker') {
            const el = document.getElementById('attWorkerView');
            if (el && _attWorkerId) attRenderWorker(el, _attWorkerId, _attWorkDate);
            return;
        }
        if (view === 'attWorkers') {
            const el = document.getElementById('attWorkersView');
            if (el) attRenderWorkers(el);
            return;
        }
        if (view === 'attProjects') {
            const el = document.getElementById('attProjectsView');
            if (el) attRenderProjects(el);
            return;
        }
        if (view === 'attReports') {
            const el = document.getElementById('attReportsView');
            if (el) attRenderReports(el);
        }
    };
})();
