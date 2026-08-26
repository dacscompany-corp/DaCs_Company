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

    function attWorkerNo(n) {
        return (n === null || n === undefined) ? '—' : 'W-' + String(n).padStart(4, '0');
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

    async function attRenderToday(container) {
        const workDate = attTodayKey();
        container.innerHTML = `
            <div class="att-head">
              <div>
                <h2 class="att-title">Today's Attendance</h2>
                <div class="att-sub" id="attTodayDate"></div>
              </div>
              <button class="att-btn" id="attRefresh">Refresh</button>
            </div>
            <div id="attTodayBody" class="att-body">Loading…</div>`;

        container.querySelector('#attTodayDate').textContent =
            new Date().toLocaleDateString('en-PH',
                { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        container.querySelector('#attRefresh')
            .addEventListener('click', () => attRenderToday(container));

        const body = container.querySelector('#attTodayBody');
        let rows;
        try {
            rows = await attLoadToday(workDate);
        } catch (e) {
            body.innerHTML = `<div class="att-error">Could not load attendance: ${attEsc(e.message || e)}</div>`;
            return;
        }

        if (!rows.length) {
            body.innerHTML = '<div class="att-empty">No active workers yet. ' +
                             'Add them in Users → Navigator.</div>';
            return;
        }

        const present = rows.filter(r => r.record).length;
        body.innerHTML = `
            <div class="att-summary">
              <strong>${present}</strong> of <strong>${rows.length}</strong> workers have timed in today
            </div>
            <table class="att-table">
              <thead>
                <tr><th>Worker</th><th>Project</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${rows.map(({ worker, record }) => `
                  <tr class="att-row${record ? '' : ' att-row--none'}" data-worker="${attEsc(worker.id)}">
                    <td>
                      <div class="att-worker">${attEsc(worker.display_name || '—')}</div>
                      <div class="att-meta">${attEsc(worker.position || '—')} · ${attWorkerNo(worker.worker_no)}</div>
                    </td>
                    <td>${attEsc(record ? (record.timein_project_name || '—') : '—')}</td>
                    <td>${attTime(record && record.timein_at)}</td>
                    <td>${attTime(record && record.timeout_at)}</td>
                    <td>${attHours(record ? record.total_minutes : null)}</td>
                    <td>${attStatusPill(record)} ${attBadges(record)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>`;

        body.querySelectorAll('.att-row').forEach(tr => {
            tr.addEventListener('click', () => {
                const id = tr.getAttribute('data-worker');
                window.attendanceOpenWorker(id, workDate);
            });
        });
    }

    // ── A2 · Worker detail ──────────────────────────────────────────

    async function attRenderWorker(container, workerId, workDate) {
        container.innerHTML = `
            <div class="att-head">
              <button class="att-btn" id="attBack">← Today</button>
            </div>
            <div id="attWorkerBody" class="att-body">Loading…</div>`;
        container.querySelector('#attBack')
            .addEventListener('click', () => switchView('attToday'));

        const body = container.querySelector('#attWorkerBody');
        const sb = window.sbClient;

        const { data: rows, error } = await sb.from('attendance_records')
            .select('*')
            .eq('worker_id', workerId)
            .eq('work_date', workDate)
            .limit(1);
        if (error) {
            body.innerHTML = `<div class="att-error">Could not load record: ${attEsc(error.message)}</div>`;
            return;
        }

        const r = (rows || [])[0];
        if (!r) {
            body.innerHTML = '<div class="att-empty">This worker has no record for this day.</div>';
            return;
        }

        const [inUrl, outUrl] = await Promise.all([
            attSignedPhoto(r.timein_photo_path),
            attSignedPhoto(r.timeout_photo_path)
        ]);

        body.innerHTML = `
            <div class="att-detail-head">
              <h2 class="att-title">${attEsc(r.worker_name || '—')}</h2>
              <div class="att-sub">${attEsc(r.worker_position || '—')} · ${attEsc(r.work_date)}</div>
              <div>${attStatusPill(r)} ${attBadges(r)}</div>
            </div>

            <div class="att-total">
              <div class="att-total-label">TOTAL HOURS</div>
              <div class="att-total-value">${attHours(r.total_minutes)}</div>
            </div>

            <div class="att-halves">
              ${attHalf('Time In', r.timein_at, r.timein_project_name, r.timein_description, inUrl, r.timein_photo_path)}
              ${attHalf('Time Out', r.timeout_at, r.timeout_project_name, r.timeout_description, outUrl, r.timeout_photo_path)}
            </div>`;
    }

    function attHalf(label, at, project, description, photoUrl, photoPath) {
        return `
            <div class="att-half">
              <div class="att-half-label">${attEsc(label)}</div>
              <div class="att-half-time">${attTime(at)}</div>
              <div class="att-half-project">${attEsc(project || '—')}</div>
              ${photoUrl
                ? `<a href="${attEsc(photoUrl)}" target="_blank" rel="noopener">
                     <img class="att-photo" src="${attEsc(photoUrl)}" alt="${attEsc(label)} photo">
                   </a>`
                : `<div class="att-photo att-photo--missing">${photoPath ? 'Photo unavailable' : 'No photo'}</div>`}
              <div class="att-half-note">${attEsc(description || '')}</div>
            </div>`;
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
        }
    };
})();
