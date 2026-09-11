/* ════════════════════════════════════════════════════════════════════
   ATTENDANCE ADMIN — the owner/staff view of worker attendance.

   Reads what the native Android app writes through the RPCs in
   migrations 0050/0051. DELIBERATELY ISOLATED, same rule as 0041 /
   0043 / 0045: nothing here writes to folders, construction_projects,
   invoices, payment_requests, expenses or payroll, and no money math
   reads attendance.

   ATTENDANCE HOURS ARE NOT THE BASIS OF PAY. DAC's labour is pakyaw /
   capped contract pay (labor_contracts.agreed_amount drawn down by
   payroll.contract_id). Hours here are a record of attendance and
   nothing more — do NOT add a rate field "to make reports useful".

   ONE PESO COLUMN EXISTS, and it is not an exception to the isolation
   above. attendance_weekly_rewards.amount (0066) records what a
   qualifying week was worth. It is a REPORTED FIGURE ONLY: nothing
   writes it to payroll, expenses or any journal, nothing may make it
   do so, and payment happens outside this system entirely. The `paid`
   flag records that somebody says it happened; it moves no money.

   The rule this replaces said flatly "there is no peso column in these
   tables". That was true until 0066 and is not any more, and a rule the
   code visibly breaks is worse than no rule -- the next person has to
   guess which half is wrong. The PURPOSE is unchanged: nothing here
   feeds Spent / Earned / Profit, and no bonus draws down a contract.

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
     *
     * openDays and abandonedDays are counted SEPARATELY though both have
     * null hours (0061). They are different facts: an open day is
     * waiting to be resolved, an abandoned one has been. Reporting them
     * under one heading would mean closing a record changed nothing on
     * screen, and the admin would have no way to see their own work.
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
                    openDays: 0,
                    abandonedDays: 0
                });
            }
            const row = by.get(key);
            row.daysWorked += 1;
            row.totalMinutes += Number(r.total_minutes || 0);
            if (r.status === 'abandoned') row.abandonedDays += 1;
            else if (r.total_minutes === null || r.total_minutes === undefined) row.openDays += 1;
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

    /**
     * The rules for EDITING an existing worker.
     *
     * Deliberately a smaller field set than attValidateNewWorker, and the
     * omissions are all forced by the database rather than chosen:
     *
     * - NO role. The profiles_guard trigger (0019) refuses any role change
     *   from an authenticated client unless BOTH the old and new values
     *   are 'client' or 'partner'. worker and teamLeader are privileged,
     *   so a Role dropdown here would throw "role may only be changed
     *   between client and partner" on every save. Offering a control
     *   that cannot work is worse than not offering it.
     * - NO email. That lives on the auth user, not the profile; changing
     *   it needs the service-role key, which the browser must never hold.
     * - NO password. Same reason -- resetting one is an auth-admin call.
     *
     * Name and position ARE editable: profiles_admin_update (0019) lets
     * owner/staff write other people's rows, and the guard only fires
     * when role or owner_id actually change.
     */
    function attValidateEditWorker(input) {
        const i = input || {};
        const firstName = String(i.firstName || '').trim();
        const lastName  = String(i.lastName  || '').trim();
        const position  = String(i.position  || '').trim();
        const status    = String(i.status || 'active');

        const errors = {};
        if (!firstName) errors.firstName = 'First name is required.';
        if (!lastName)  errors.lastName  = 'Last name is required.';
        if (status !== 'active' && status !== 'inactive') errors.status = 'Pick a status.';

        return {
            valid: Object.keys(errors).length === 0,
            errors: errors,
            // first_name / last_name / display_name move together. A row
            // whose display_name disagrees with its parts is exactly how
            // the nameless W-000n rows came to render as a worker number.
            payload: {
                first_name:   firstName,
                last_name:    lastName,
                display_name: (firstName + ' ' + lastName).trim(),
                position:     position || null,
                status:       status
            }
        };
    }

    /**
     * Best-effort split of a display_name back into two fields.
     *
     * Only used when first_name/last_name are missing -- legacy rows.
     * Anything created through A4 already has both stored, so this is a
     * fallback, not the normal path.
     *
     * Everything but the LAST token becomes the first name, which suits
     * "John Aerol Tapales" (given + middle + surname) and gets compound
     * surnames wrong: "Juan Dela Cruz" splits as "Juan Dela" / "Cruz".
     * No heuristic gets both right, and swapping the rule just moves the
     * error onto the other name. This is a PREFILL the admin sees and
     * corrects in the form before saving, so a wrong guess costs one
     * edit -- guessing silently at save time would cost a wrong record.
     */
    function attSplitName(worker) {
        const w = worker || {};
        const first = String(w.first_name || '').trim();
        const last  = String(w.last_name  || '').trim();
        if (first || last) return { firstName: first, lastName: last };
        const parts = String(w.display_name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return { firstName: '', lastName: '' };
        if (parts.length === 1) return { firstName: parts[0], lastName: '' };
        return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
    }

    // ── A7 · Closing a forgotten Time Out (0061) ────────────────────
    //
    // These two mirror the guards inside attendance_abandon. The RPC is
    // the authority -- it re-checks every one of these server-side, and
    // it also checks the two things a browser cannot be trusted with
    // (that the caller is owner/staff, and that the record belongs to a
    // tenant they can access). What these do is stop the screen from
    // OFFERING a button the database would refuse, because a button
    // that always errors is worse than no button.

    /**
     * May this record be closed as abandoned, and if not, why not?
     *
     * The reason is user-facing copy, not a code: it is rendered next to
     * the row that has no button, so the admin is never left guessing
     * what is different about it.
     */
    function attCanAbandon(record, todayKey) {
        if (!record) return { can: false, reason: 'There is no record to close.' };
        if (record.status === 'complete') {
            return { can: false, reason: 'This day is already complete — it has a real Time Out.' };
        }
        if (record.status === 'abandoned') {
            return { can: false, reason: 'This record has already been closed.' };
        }
        if (record.status !== 'working') {
            return { can: false, reason: 'Only an open record can be closed.' };
        }
        // `>=`, not `>`. A future-dated row should not exist at all
        // (attendance_time_in rejects CAPTURED_IN_FUTURE), but if clock
        // skew ever produced one, being AHEAD of today must not be what
        // makes it closable.
        if (String(record.work_date) >= String(todayKey)) {
            return { can: false, reason: 'Still today — this worker may be on site right now.' };
        }
        return { can: true, reason: '' };
    }

    /**
     * The records the A6 panel lists: every one still on 'working'.
     *
     * Filtered on STATUS, never on a null timeout_at. Abandoning leaves
     * timeout_at null forever, so a timeout_at test would keep every
     * record the admin had already resolved on the list and the panel
     * would never empty -- the screen would report the work as undone.
     *
     * Today's open records ARE included, flagged `_closable: false`.
     * Dropping them would make the panel disagree with the "Missing
     * time out" stat directly above it; listing them with the reason
     * showing explains the missing button instead.
     *
     * Oldest first: a record stuck since August is more stale than one
     * from yesterday, and staleness is the thing this screen is for.
     */
    function attOpenRecords(records, todayKey) {
        return (records || [])
            .filter(r => r.status === 'working')
            .map(r => {
                const v = attCanAbandon(r, todayKey);
                return Object.assign({}, r, { _closable: v.can, _reason: v.reason });
            })
            .sort((a, b) => String(a.work_date).localeCompare(String(b.work_date))
                          || String(a.worker_name || '').localeCompare(String(b.worker_name || '')));
    }

    // ── Weekly reward ───────────────────────────────────────────────
    //
    // The ₱ figure that appears below is a REPORTED amount and nothing
    // else. It creates no accounting entry, and no function here may
    // ever make one: payment happens outside the system entirely (see
    // 0066's header). There is still no rate anywhere in this file, and
    // attendance hours are still not the basis of pay.

    /**
     * Days since the epoch from a YYYY-MM-DD key, and back again.
     *
     * All week arithmetic goes through these two, in UTC, so it never
     * touches the browser's local zone. That is not fussiness: a
     * Monday computed with local getters on a machine set to UTC-5
     * lands on the previous Sunday, and the whole reward week shifts.
     * Working in UTC on a date-only key has no such failure mode.
     */
    function attDayNum(key) {
        const p = String(key).split('-');
        return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
    }

    function attKeyFromDayNum(n) {
        const d = new Date(n * 86400000);
        const p = x => String(x).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    }

    /** ISO weekday, 1 = Monday … 7 = Sunday. Epoch day 0 was a Thursday. */
    function attIsoDow(key) {
        return ((attDayNum(key) + 3) % 7) + 1;
    }

    /** The Monday of the week [key] falls in. */
    function attWeekStartOf(key) {
        const n = attDayNum(key);
        return attKeyFromDayNum(n - (attIsoDow(key) - 1));
    }

    /** The Friday of that week. The reward week is Mon–Fri. */
    function attWeekEndOf(weekStart) {
        return attKeyFromDayNum(attDayNum(weekStart) + 4);
    }

    /**
     * Rolls the per-day rows from attendance_reward_progress() into the
     * week's standing.
     *
     * A day LATER THAN TODAY is pending, never missing. The server
     * returns all five days of the week whether or not they have
     * happened, so without this Wednesday's screen would report Thursday
     * and Friday as missed and tell every worker they were already
     * disqualified.
     *
     * Disqualification is reported as soon as it is certain — one late
     * day settles the week — which is what §37's mid-week example shows.
     */
    function attRewardSummary(days, todayKey) {
        const out = {
            requiredDays: 0, onTimeDays: 0, lateDays: 0,
            missingDays: 0, pendingDays: 0, completedDays: 0,
            status: 'in_progress'
        };
        (days || []).forEach(d => {
            const future = String(d.work_date) > String(todayKey);
            if (d.day_status === 'on_time' || d.day_status === 'late') out.completedDays++;
            if (!d.required) return;
            out.requiredDays++;
            if (d.day_status === 'on_time') out.onTimeDays++;
            else if (d.day_status === 'late') out.lateDays++;
            else if (future) out.pendingDays++;
            else out.missingDays++;
        });
        out.status = (out.lateDays > 0 || out.missingDays > 0) ? 'disqualified'
                   : out.pendingDays > 0 ? 'in_progress'
                   : out.requiredDays > 0 ? 'qualified'
                   : 'disqualified';
        return out;
    }

    /**
     * Totals across one week's reward rows, for the admin header.
     *
     * unpaidAmount is what payroll still owes — the number the export
     * exists to produce, since nothing in this system pays anybody.
     */
    function attRewardTotals(rows) {
        const t = { workers: 0, qualified: 0, disqualified: 0,
                    paid: 0, unpaid: 0, totalAmount: 0, unpaidAmount: 0 };
        (rows || []).forEach(r => {
            t.workers++;
            const amount = Number(r.amount) || 0;
            if (r.status === 'qualified') {
                t.qualified++;
                t.totalAmount += amount;
                if (r.paid) { t.paid++; } else { t.unpaid++; t.unpaidAmount += amount; }
            } else {
                t.disqualified++;
            }
        });
        return t;
    }

    /** §43's statuses, as the screen words them. */
    function attRewardStatusLabel(status) {
        return status === 'qualified'   ? 'Qualified'
             : status === 'disqualified' ? 'Disqualified'
             : 'In Progress';
    }

    /**
     * §40's export. Goes through attToCsv, so worker names and any other
     * attacker-adjacent text are still neutralised against Excel formula
     * injection — this file's rule 3, which applies no less to a sheet
     * that payroll opens.
     */
    function attRewardCsv(rows) {
        const headers = ['Worker', 'Position', 'Week Start', 'Week End', 'Required',
                         'On Time', 'Late', 'Missing', 'Status', 'Reward', 'Paid'];
        const body = (rows || []).map(r => [
            r.worker_name || '—',
            r.worker_position || '',
            r.week_start, r.week_end,
            r.required_days, r.on_time_days, r.late_days, r.missing_days,
            attRewardStatusLabel(r.status),
            Number(r.amount) || 0,
            r.paid ? 'Yes' : 'No'
        ]);
        return attToCsv(headers, body);
    }

    /**
     * Which past weeks still need evaluating.
     *
     * Evaluation happens when an admin opens the Rewards view: the RPC
     * is idempotent and refuses anything inside its grace period, so
     * calling it on page load is safe and needs no pg_cron.
     *
     * A week becomes due `graceHours` after it ENDS — Saturday 00:00
     * Manila, which is UTC+8 with no daylight saving, so the instant is
     * exact arithmetic rather than a guess. The grace is why a Friday
     * Time In captured with no signal and synced on Monday still counts.
     *
     * The current week is never returned: it has not finished.
     */
    function attWeeksNeedingEvaluation(nowMs, evaluatedStarts, graceHours, weeksBack) {
        const done = new Set(evaluatedStarts || []);
        const grace = Number(graceHours);
        const hours = isFinite(grace) && grace >= 0 ? grace : 60;
        const back = Number(weeksBack) > 0 ? Number(weeksBack) : 8;

        // Today in Manila, derived from the instant rather than the
        // browser's zone — an admin abroad must still see PH weeks.
        const todayKey = attKeyFromDayNum(Math.floor((nowMs + 8 * 3600000) / 86400000));
        const thisMonday = attDayNum(attWeekStartOf(todayKey));

        const out = [];
        for (let i = 1; i <= back; i++) {
            const startNum = thisMonday - i * 7;
            const start = attKeyFromDayNum(startNum);
            if (done.has(start)) continue;
            const dueMs = (startNum + 5) * 86400000 - 8 * 3600000 + hours * 3600000;
            if (nowMs >= dueMs) out.push(start);
        }
        return out.sort();
    }

    // ==== ATT REPORT ENGINE END ====

    const PHOTO_BUCKET = 'attendance';

    // Anything above this between capture and arrival, on a record that
    // was NOT captured offline, means the device clock disagrees with the
    // server's. When was_offline is true the gap is legitimately hours
    // and proves nothing — see the clock-skew note in 0050.
    // ==== ATT VOCABULARY START ====
    //
    // Everything the redesign says OUT LOUD, in one block the tests can
    // extract. These functions carry no data access and no DOM: they
    // turn a record into the words an owner reads, and the words are the
    // thing most likely to drift back towards the database's own
    // ("Complete", "Abandoned") the next time someone edits a screen in
    // a hurry. tests/attendance.test.js section XI pins them.
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
                      'timein_project_system,' +
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

    /**
     * The four states a day can be in, as one word the code switches on.
     *
     * Everything downstream -- the pill, the row's left rule, the legend,
     * the crew card -- reads its colour and its label from HERE, so a
     * state cannot be green in one place and gold in another. That did
     * happen: the table said "Working" while the KPI counted the same
     * record under "No Attendance".
     */
    function attTone(record) {
        if (!record) return 'none';
        if (record.status === 'complete') return 'done';
        // Set by an admin sweep, never by the app: a Time In with no Time
        // Out, closed after the fact.
        if (record.status === 'abandoned') return 'abandoned';
        return 'working';
    }

    /**
     * What that state is CALLED on screen.
     *
     * The redesign's central move. "Complete" and "Abandoned" are the
     * database's words for a row; an owner opening this screen at seven
     * in the morning is asking a different question, and these are the
     * answers to it. The database values are untouched -- only the
     * reading of them changed, and the CSV export still ships the raw
     * status so a spreadsheet built on the old words keeps working.
     */
    const ATT_WORD = {
        done:      'Finished the day',
        working:   'Still on site',
        abandoned: 'Closed by the office',
        none:      'Not on site'
    };

    function attStatusWord(record) { return ATT_WORD[attTone(record)]; }

    /**
     * The same four states, abbreviated.
     *
     * A crew card gives a pill about 90px of room beside a name and a
     * pair of stamps; "Closed by the office" wraps to three lines in it
     * and pushes the hours out of alignment. The table has the width for
     * the full sentence and uses ATT_WORD; the cards use these.
     *
     * "Absent?" keeps its question mark on purpose. Before anyone has
     * checked, an absence is a question about a worker, not a finding
     * against him -- and the phone may simply have had no signal.
     */
    const ATT_WORD_SHORT = {
        done:      'Finished',
        working:   'On site',
        abandoned: 'Closed',
        none:      'Absent?'
    };

    function attStatusShort(record) { return ATT_WORD_SHORT[attTone(record)]; }

    function attStatusPill(record) {
        const tone = attTone(record);
        const cls = tone === 'done' ? 'done' : tone === 'working' ? 'working'
                  : tone === 'abandoned' ? 'abandoned' : 'none';
        return '<span class="att-pill att-pill--' + cls + '">' +
               attEsc(ATT_WORD[tone]) + '</span>';
    }

    /**
     * The crew-card pill. `noneLabel` overrides the "Absent?" wording for
     * a day that has not started, where nobody is absent yet.
     */
    function attStatusPillShort(record, noneLabel) {
        const tone = attTone(record);
        const cls = tone === 'done' ? 'done' : tone === 'working' ? 'working'
                  : tone === 'abandoned' ? 'abandoned' : 'none';
        const word = (tone === 'none' && noneLabel) ? noneLabel : ATT_WORD_SHORT[tone];
        return '<span class="att-pill att-pill--' + cls + '">' + attEsc(word) + '</span>';
    }

    /**
     * The one line under the status that says what actually happened.
     *
     * Every branch is a FACT the record carries, never an inference about
     * the worker. "Saved without signal" is why a stamp arrived late; it
     * is not an accusation, and the copy is written so it cannot be read
     * as one (design section 6.3, and the same reasoning as attBadges).
     */
    function attStatusNote(record) {
        if (!record) return 'Nothing came from the phone today';
        if (record.status === 'abandoned') {
            return 'No time out, so the day records no hours';
        }

        const offline = record.timein_was_offline || record.timeout_was_offline;
        if (record.status !== 'complete') {
            return offline ? 'Saved without signal, arrived later'
                           : 'Timed in, no time out yet';
        }

        // A clock gap is only worth mentioning on an ONLINE capture --
        // for an offline one the gap IS the offline period, and saying
        // so twice would manufacture a second problem out of one fact.
        if (offline) return 'Saved without signal, arrived later';
        const worst = Math.max(
            attSkewMinutes(record.timein_at, record.timein_received_at) || 0,
            attSkewMinutes(record.timeout_at, record.timeout_received_at) || 0);
        if (worst >= SKEW_WARN_MINUTES) {
            return 'Phone clock was ' + worst + ' min behind';
        }
        return (record.timein_photo_path && record.timeout_photo_path)
            ? 'Both photos received'
            : 'Recorded without both photos';
    }

    /** The green sentence that opens a screen. */
    function attBanner(lead, body) {
        return '<div class="att-banner">' +
                 '<div class="att-banner-lead">' + attEsc(lead) + '</div>' +
                 (body ? '<div class="att-banner-body">' + body + '</div>' : '') +
               '</div>';
    }

    /**
     * "N things need you" -- or, when there are none, the all-clear.
     *
     * Both are drawn, and drawn the same size. A card that vanishes when
     * the work is done leaves the owner unsure whether he cleared it or
     * the screen simply failed to load it.
     */
    function attFlag(count, body, actionId, actionLabel) {
        if (!count) {
            return '<div class="att-flag att-flag--clear">' +
                     '<div class="att-flag-icon"><i data-lucide="check"></i></div>' +
                     '<div class="att-flag-text">' +
                       '<div class="att-flag-title">Nothing needs you</div>' +
                       '<div class="att-flag-body">' + body + '</div>' +
                     '</div>' +
                   '</div>';
        }
        return '<div class="att-flag">' +
                 '<div class="att-flag-icon"><i data-lucide="clock"></i></div>' +
                 '<div class="att-flag-text">' +
                   '<div class="att-flag-title">' + count +
                     (count === 1 ? ' thing needs you' : ' things need you') + '</div>' +
                   '<div class="att-flag-body">' + body + '</div>' +
                 '</div>' +
                 (actionId
                   ? '<button class="att-btn" type="button" id="' + actionId + '">' +
                     attEsc(actionLabel) + '</button>'
                   : '') +
               '</div>';
    }

    /** The grey one-liner that closes a screen. */
    function attStrip(icon, html) {
        return '<div class="att-strip"><i data-lucide="' + icon + '"></i><div>' +
               html + '</div></div>';
    }

    /** A list read as a sentence: "a, b and c". */
    function attAnd(parts) {
        const p = parts.filter(Boolean);
        if (!p.length) return '';
        if (p.length === 1) return p[0];
        return p.slice(0, -1).join(', ') + ' and ' + p[p.length - 1];
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

    /** "07:00" / "07:00:00" → "7:00 AM". */
    function attClock(hhmm) {
        const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
        if (!m) return null;
        const h = Number(m[1]);
        const suffix = h < 12 ? 'AM' : 'PM';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return h12 + ':' + m[2] + ' ' + suffix;
    }

    /**
     * Why a week did or did not earn the bonus, in one line.
     *
     * Built from THIS system's rule, which is stricter than most people
     * assume: attRewardSummary disqualifies on `lateDays > 0 ||
     * missingDays > 0`, so a single late day forfeits the whole week.
     * The sentence has to say that, because a reader who assumes one
     * late day is forgiven will read every disqualification as a bug.
     */
    function attBonusReason(r) {
        const late = Number(r.late_days) || 0;
        const missing = Number(r.missing_days) || 0;
        if (r.status === 'qualified') return 'On time every expected day';
        if (r.status !== 'disqualified') return 'The week is not finished yet';
        const parts = [];
        if (missing) parts.push('missed ' + missing + (missing === 1 ? ' expected day' : ' expected days'));
        if (late) parts.push('was late on ' + late + (late === 1 ? ' day' : ' days'));
        if (!parts.length) return 'No day was ever required this week';
        const sentence = attAnd(parts);
        return sentence.charAt(0).toUpperCase() + sentence.slice(1) +
               (late ? ' — one late day forfeits the week' : '');
    }

    /**
     * Has the working day actually begun?
     *
     * Nobody has timed in at half past midnight, and that is not a
     * problem -- it is the day not having started. The first cut of the
     * redesign treated every worker without a record as something
     * needing the owner, so opening the screen before dawn announced
     * "7 things need you" about a day in which nothing had yet had the
     * chance to go wrong.
     *
     * A day in the past is over, so an absence in it is real. A day in
     * the future cannot have absences at all. Today's absences only
     * become real once the hour workers are due has passed.
     *
     * `nowMinutes` is passed in rather than read here so the rule can be
     * tested at any hour without touching the clock.
     */
    function attDayHasStarted(workDate, todayKey, startTime, nowMinutes) {
        const day = String(workDate), today = String(todayKey);
        if (day > today) return false;
        if (day < today) return true;
        const m = /^(\d{1,2}):(\d{2})/.exec(String(startTime || ''));
        // 09:00 when the company has set no default -- the SAME fallback
        // the database uses. attendance_start_time() (0065) and the reward
        // evaluator (0066) both coalesce to '09:00'::time, and §36 of the
        // MVP terms is where that hour comes from. A different number here
        // would have the screen say "due at 8:00" about a worker the
        // bonus does not count as late until 9:00.
        const due = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
        return nowMinutes >= due;
    }

    // ==== ATT VOCABULARY END ====

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

    /**
     * A1 -- Today on site.
     *
     * The redesign replaced a five-tile KPI strip with a sentence. The
     * strip reported "Total 6 / In 5 / Out 3 / Working 1 / No Attendance
     * 1" and left the owner to work out that one man never showed up;
     * the sentence says so. The numbers are all still on the screen, in
     * the rows underneath, where they can be acted on.
     *
     * Two ways to read the same day:
     *   By site   -- one card per site. The morning question is "who is
     *                at Villa Ysabel", and a site COLUMN is a worse
     *                answer than a site HEADING.
     *   Full list -- the whole table, with the search, the site filter
     *                and the things that need doing at the top of it.
     */
    async function attRenderToday(container) {
        let workDate = attTodayKey();
        let mode = 'sites';
        let rows = [];
        // The hour workers are due, so the screen can tell "nobody has
        // arrived yet" apart from "nobody turned up". Fetched once and
        // reused across date changes; a failure falls back to 09:00, the
        // same hour the database uses.
        let dayStart = null;
        // Every site a worker could pick, whether or not anyone did. The
        // by-site board is a board of SITES: seeding it only from records
        // meant that before the first Time In of the day it had nothing
        // to draw and quietly turned into a list of workers.
        let allSites = [];

        container.innerHTML = `
            <div class="att-stack">
              <div class="att-head">
                <div>
                  <h2 class="att-title">Today on site</h2>
                  <div class="att-sub" id="attTodayDate"></div>
                </div>
                <div class="att-head-actions">
                  <div class="att-seg" id="attTodayMode">
                    <button class="att-seg-btn is-on" type="button" data-mode="sites">By site</button>
                    <button class="att-seg-btn" type="button" data-mode="list">Full list</button>
                  </div>
                  <input class="att-input" type="date" id="attWorkDate"
                         value="${attEsc(workDate)}" aria-label="Pick a day">
                  <button class="att-btn" type="button" id="attRefresh">
                    <i data-lucide="refresh-cw"></i>Refresh</button>
                  <button class="att-btn" type="button" id="attTodayAddWorker">
                    <i data-lucide="user-plus"></i>Add a worker</button>
                  <button class="att-btn att-btn--primary" type="button" id="attExport">
                    <i data-lucide="download"></i>Download for Excel</button>
                </div>
              </div>
              <div id="attTodayBody">Loading…</div>
            </div>
            <div id="attTodayModalHost"></div>`;

        const body = container.querySelector('#attTodayBody');
        const dateInput = container.querySelector('#attWorkDate');

        /** Today reads "today"; any other day is named. */
        function isToday() { return workDate === attTodayKey(); }

        function stampDate() {
            const [y, m, d] = workDate.split('-').map(Number);
            const label = new Date(y, m - 1, d).toLocaleDateString('en-PH',
                { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            const at = new Date().toLocaleTimeString('en-PH',
                { hour: 'numeric', minute: '2-digit', hour12: true });
            // "last loaded", never "live": this screen does not poll, and
            // on a past date there is nothing live about it.
            container.querySelector('#attTodayDate').textContent =
                `${label} · last loaded ${at}`;
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

        /**
         * The things that need the owner, as sentences.
         *
         * Only two kinds exist, and both are states the SYSTEM cannot
         * resolve on its own: a day with no Time Out (someone has to say
         * whether he went home) and a worker who recorded nothing (only
         * the office knows whether that is leave, absence or no signal).
         * Nothing else is ever promoted to this list -- an owner who is
         * shown five items every morning stops reading any of them.
         */
        function attention() {
            const out = [];
            const started = dayHasStarted();
            const todayKey = attTodayKey();

            rows.forEach(({ worker, record }) => {
                const name = attWorkerName(worker);

                if (record && attTone(record) === 'working') {
                    // A worker on site in the middle of his shift is the
                    // ordinary case, not an exception -- flagging it put
                    // every present worker on the list by mid-morning.
                    // attCanAbandon already draws the only line that
                    // matters: a missing Time Out is the owner's problem
                    // once the day is OVER, and not before.
                    if (!attCanAbandon(record, todayKey).can) return;
                    out.push({
                        kind: 'open', tone: 'work', icon: 'clock', id: worker.id,
                        title: `${name} never timed out`,
                        body: `Timed in at ${attTime(record.timein_at)}` +
                              (record.timein_project_name
                                ? ` at ${record.timein_project_name}` : '') +
                              ', and the day ended with no time out. Close it so the ' +
                              'hours report stops waiting. Closing a day records no ' +
                              'hours and changes no pay.',
                        action: 'Open the record'
                    });
                } else if (!record) {
                    // Nobody is absent before they are due.
                    if (!started) return;
                    out.push({
                        kind: 'none', tone: 'none', icon: 'user-x', id: worker.id,
                        title: `${name} recorded nothing` + (isToday() ? ' today' : ' that day'),
                        body: 'No time in came from the phone. Check whether this is ' +
                              'leave, an absence, or simply no signal — a record saved ' +
                              'offline can arrive later in the day.',
                        action: 'Open the record'
                    });
                }
            });
            return out;
        }

        /** Today's absences are only real once workers are actually due. */
        function dayHasStarted() {
            const now = new Date();
            return attDayHasStarted(workDate, attTodayKey(), dayStart,
                                    now.getHours() * 60 + now.getMinutes());
        }

        /** The green sentence at the top, built from what actually loaded. */
        function lede(attn) {
            const total = rows.length;
            const present = rows.filter(r => r.record).length;
            const sites = new Set(rows
                .map(r => r.record && r.record.timein_project_name)
                .filter(Boolean)).size;
            const absent = total - present;
            const open = rows.filter(r => r.record && attTone(r.record) === 'working').length;
            const closed = rows.filter(r => r.record && attTone(r.record) === 'abandoned').length;

            const when = isToday() ? 'today' : 'that day';
            const started = dayHasStarted();
            const dueAt = attClock(dayStart) || '9:00 AM';

            // Before anyone is due, "Nobody timed in today" reads as an
            // alarm about a day that has not happened yet.
            const lead = (present === 0 && !started)
                ? (isToday() ? 'The day has not started yet.' : 'That day has not started yet.')
                : present === 0
                    ? `Nobody timed in ${when}.`
                    : present === total
                        ? `All ${total} of your workers ${isToday() ? 'are' : 'were'} on site ${when}.`
                        : `${present} of your ${total} workers ${isToday() ? 'are' : 'were'} ` +
                          `on site ${when}.`;

            const bits = [];
            if (present === 0 && !started) {
                bits.push(`Workers are due at ${dueAt}` +
                          (total ? `, and ${total} can time in from the app` : ''));
            }
            if (sites === 1) bits.push('All at one site');
            else if (sites > 1) bits.push(`Spread across ${sites} sites`);
            // An absence is only worth stating once it IS one.
            if (absent && started) {
                bits.push(absent === 1
                    ? 'one worker did not time in at all'
                    : `${absent} workers did not time in at all`);
            }
            if (closed) {
                bits.push(closed === 1
                    ? 'one day was closed by the office'
                    : `${closed} days were closed by the office`);
            }
            const sentence = bits.length ? attEsc(attAnd(bits)) + '.' : '';

            const flagBody = attn.length
                ? attEsc(attAnd([
                    open ? (open === 1 ? 'a missing time out'
                                      : `${open} missing time outs`) : '',
                    (attn.length - open) ? ((attn.length - open) === 1
                        ? 'a worker with nothing recorded'
                        : `${attn.length - open} workers with nothing recorded`) : ''
                  ])) + '.'
                : !started
                    // attFlag's own title already says "Nothing needs you";
                    // the body's job is to say why, not to repeat it.
                    ? `The first workers are due at ${attEsc(dueAt)}.`
                    : 'Every worker is accounted for, and no day is waiting on a time out.';

            return '<div class="att-lede">' +
                     attBanner(lead, sentence) +
                     attFlag(attn.length, flagBody, 'attReviewAll', 'Review them') +
                   '</div>';
        }

        /** 'pc' / 'pm' → the pill the owner reads it by. */
        function sourcePill(system) {
            if (system === 'pc') return '<span class="att-pill att-pill--pc">Costing job</span>';
            if (system === 'pm') return '<span class="att-pill att-pill--pm">Site works</span>';
            return '';
        }

        /**
         * One card per site, plus a final card for everyone who is not on
         * one. The absent card is dashed, because it describes a gap
         * rather than a place.
         */
        function bySite() {
            const groups = new Map();
            const absent = [];

            // Every site first, empty. A site with nobody on it today is
            // a fact the owner wants to see -- it is the difference
            // between "Tanauan is quiet" and "Tanauan is not on my screen".
            allSites.forEach(p => {
                groups.set(p.project_name, {
                    name: p.project_name,
                    system: p.project_system,
                    crew: []
                });
            });

            rows.forEach(entry => {
                const site = entry.record && entry.record.timein_project_name;
                if (!site) { absent.push(entry); return; }
                // Keyed on the SNAPSHOT name the record carries. A site
                // renamed after the fact therefore keeps its own card
                // under the old name, which is the name on the record.
                if (!groups.has(site)) {
                    groups.set(site, {
                        name: site,
                        system: entry.record.timein_project_system,
                        crew: []
                    });
                }
                groups.get(site).crew.push(entry);
            });

            // `quiet` = a site nobody is on. It renders as a header and
            // stops there: a sub-line AND a footer both saying "nobody,
            // due at nine" is the same sentence twice, and across ten
            // empty sites it drowns the two cards that have people on them.
            const card = (title, sub, pill, crew, foot, none, noneLabel, quiet, wide) => `
                <div class="att-crew-card${none ? ' att-crew-card--none' : ''}${
                    quiet ? ' att-crew-card--quiet' : ''}${
                    wide ? ' att-crew-card--wide' : ''}">
                  <div class="att-crew-head">
                    <div style="min-width:0">
                      <h3 class="att-crew-title">${attEsc(title)}</h3>
                      <p class="att-crew-sub">${attEsc(sub)}</p>
                    </div>
                    ${pill}
                  </div>
                  ${quiet ? '' : `<div class="att-crew-list">
                    ${crew.map(({ worker, record }) => {
                        const tone = attTone(record);
                        // The hatch is a placeholder, never a signed URL.
                        // Signing every thumbnail would fire two round
                        // trips per worker to draw a 56px square; the
                        // photo itself is one click away on the detail.
                        const shot = p => `<span class="att-crew-photo${
                            (record && p) ? '' : ' att-crew-photo--empty'}"></span>`;
                        const times = !record
                            ? 'Nothing recorded on the phone'
                            : record.timeout_at
                                ? `In ${attTime(record.timein_at)} · Out ${attTime(record.timeout_at)}`
                                : tone === 'abandoned'
                                    ? `In ${attTime(record.timein_at)} · no time out`
                                    : `In ${attTime(record.timein_at)} · still working`;
                        return `
                        <div class="att-crew-row" data-worker="${attEsc(worker.id)}">
                          ${shot(record && record.timein_photo_path)}
                          <div class="att-crew-body">
                            <div class="att-crew-name">${attEsc(attWorkerName(worker))}</div>
                            <div class="att-crew-position">${attEsc(worker.position || '—')}</div>
                            <div class="att-crew-times">${attEsc(times)}</div>
                          </div>
                          <div class="att-crew-right">
                            ${attStatusPillShort(record, noneLabel)}
                            <div class="att-crew-hours">${
                                record && record.total_minutes !== null
                                    ? attEsc(attHours(record.total_minutes)) : '—'}</div>
                          </div>
                        </div>`;
                    }).join('')}
                  </div>`}
                  ${foot ? `<div class="att-crew-foot">${attEsc(foot)}</div>` : ''}
                </div>`;

            const started = dayHasStarted();
            const dueAt = attClock(dayStart) || '9:00 AM';

            // Sites with crew lead; the quiet ones follow in name order,
            // so the board reads top-left to bottom-right as "here is
            // where the work is happening, and here is where it is not".
            const ordered = [...groups.values()].sort((a, b) => {
                if (!!a.crew.length !== !!b.crew.length) return a.crew.length ? -1 : 1;
                return String(a.name).localeCompare(String(b.name));
            });

            const cards = ordered.map(g => {
                const inCount = g.crew.length;
                const open = g.crew.filter(c => attTone(c.record) === 'working').length;
                const closed = g.crew.filter(c => attTone(c.record) === 'abandoned').length;
                // The board's wording, verbatim. Both halves are the crew
                // ON the card: this screen groups BY the site a worker
                // timed in at, so a site cannot carry anyone who did not.
                // It therefore always reads "N of N" -- which is the
                // design's intent (the card confirms the crew is complete)
                // and not a figure to go looking for a denominator for.
                // Anyone posted here who never timed in is on the
                // "Not on site" card instead, where the owner can act.
                const sub = `${inCount} of ${inCount} crew timed in`;

                // Named, as the board names Jayson. "One worker" makes the
                // owner re-scan the card for which one.
                const openCrew = g.crew.filter(c => attTone(c.record) === 'working');
                const openNames = attAnd(openCrew.map(c => attWorkerName(c.worker)));
                // A day still running cannot be closed at all (attCanAbandon
                // refuses today), so the footer must not send the owner to a
                // panel that is not listing them.
                const closable = openCrew.some(
                    c => attCanAbandon(c.record, attTodayKey()).can);

                const foot = openCrew.length
                    ? (closable
                        ? `${openNames} never timed out. Close the day from the panel ` +
                          'above — it records no hours and changes no pay.'
                        : `${openNames} ${openCrew.length === 1 ? 'has' : 'have'} not ` +
                          'timed out yet. Nothing to do until the day is over.')
                    : closed
                        ? 'The office closed a day here because no time out was ever recorded. No hours were counted for it.'
                        : '';

                if (!g.crew.length) {
                    // Said once, in the sub-line, and phrased about the
                    // SITE. The workers card below is about people and
                    // must not read as one more empty site.
                    return card(g.name,
                                started ? 'No crew timed in here today'
                                        : `No crew yet · due at ${dueAt}`,
                                sourcePill(g.system), [], '', false, null, true);
                }
                return card(g.name, sub, sourcePill(g.system), g.crew, foot, false);
            });

            // NOT a card in the site grid. It is a list of people, it can
            // hold every worker on the books, and in a 320px site-sized
            // cell it became one tall column with three-line wraps beside
            // an empty half-screen. Full width, below the sites, with the
            // names flowing into as many columns as fit.
            const absentCard = absent.length ? card(
                !started ? 'Workers not timed in yet'
                         : isToday() ? 'Workers not on site today'
                                     : 'Workers not on site that day',
                `${absent.length} ${absent.length === 1 ? 'worker' : 'workers'}`,
                started
                  ? '<span class="att-pill att-pill--none">No record</span>'
                  : '<span class="att-pill att-pill--none">Not due yet</span>',
                absent,
                started
                  ? 'Check whether this is leave or an absence. A record saved ' +
                    'without signal can still arrive later.'
                  : `Workers are due at ${dueAt}. Nothing is late and nothing is ` +
                    'missing — the day has not started.',
                true,
                started ? 'Absent?' : 'Not in yet',
                false, true) : '';

            return '<div class="att-crew-grid">' + cards.join('') + '</div>' + absentCard;
        }

        /** The attention panel above the full list. */
        function attnPanel(attn) {
            if (!attn.length) return '';
            return '<div class="att-card att-card--flag">' +
                     '<div class="att-card-head"><div>' +
                       '<h3 class="att-card-title">' + attn.length +
                         (attn.length === 1 ? ' thing needs you' : ' things need you') + '</h3>' +
                       '<p class="att-card-sub">Clear these and the day is finished. ' +
                         'Nothing here changes anyone&rsquo;s pay.</p>' +
                     '</div></div>' +
                     attn.map(a =>
                       '<div class="att-attn-row">' +
                         '<div class="att-attn-icon' +
                           (a.tone === 'work' ? ' att-attn-icon--work' : '') + '">' +
                           '<i data-lucide="' + a.icon + '"></i></div>' +
                         '<div class="att-attn-text">' +
                           '<div class="att-attn-title">' + attEsc(a.title) + '</div>' +
                           '<div class="att-attn-body">' + attEsc(a.body) + '</div>' +
                         '</div>' +
                         '<button class="att-btn' +
                           (a.tone === 'work' ? ' att-btn--warn' : '') +
                           '" type="button" data-attn="' + attEsc(a.id) + '">' +
                           attEsc(a.action) + '</button>' +
                       '</div>').join('') +
                   '</div>';
        }

        function paintRows() {
            const shown = visible();
            const tbody = container.querySelector('#attTodayRows');
            if (!tbody) return;
            if (!shown.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="att-empty">' +
                                  'No worker matches this search.</td></tr>';
                return;
            }
            tbody.innerHTML = shown.map(({ worker, record }) => {
                const tone = attTone(record);
                return `
                <tr class="att-row att-row--${tone}" data-worker="${attEsc(worker.id)}">
                  <td>
                    <div class="att-worker">${attEsc(attWorkerName(worker))}</div>
                    <div class="att-meta">${attEsc(worker.position || '—')} · ${attWorkerNo(worker.worker_no)}</div>
                  </td>
                  <td>${attEsc(record ? (record.timein_project_name || '—') : '—')}</td>
                  <td class="att-mono">${attTime(record && record.timein_at)}</td>
                  <td class="att-mono">${attTime(record && record.timeout_at)}</td>
                  <td class="att-mono">${record && record.total_minutes !== null
                      ? attHours(record.total_minutes) : '—'}</td>
                  <td>${attPhotoCell(record)}</td>
                  <td>
                    <div class="att-status-word${
                        tone === 'abandoned' ? ' att-status-word--abandoned'
                      : tone === 'none' ? ' att-status-word--none' : ''}">${
                        attEsc(attStatusWord(record))}</div>
                    <div class="att-meta">${attEsc(attStatusNote(record))} ${attBadges(record)}</div>
                  </td>
                </tr>`;
            }).join('');

            tbody.querySelectorAll('.att-row').forEach(tr => {
                tr.addEventListener('click', () => {
                    window.attendanceOpenWorker(tr.getAttribute('data-worker'), workDate);
                });
            });
        }

        function fullList(attn) {
            const projects = [...new Set(rows
                .map(r => r.record && r.record.timein_project_name)
                .filter(Boolean))].sort();

            return attnPanel(attn) + `
                <div class="att-card">
                  <div class="att-card-head">
                    <div>
                      <h3 class="att-card-title">Everyone&rsquo;s day</h3>
                      <p class="att-card-sub">Click any row to see the two photos the
                        worker took.</p>
                    </div>
                    <div class="att-card-tools">
                      <div class="att-search-wrap">
                        <i data-lucide="search"></i>
                        <input class="att-search" type="search" id="attSearch"
                               placeholder="Search a name or a site…" aria-label="Search">
                      </div>
                      <select class="att-filter" id="attProjFilter" aria-label="Filter by site">
                        <option value="">All sites</option>
                        ${projects.map(p => `<option value="${attEsc(p)}">${attEsc(p)}</option>`).join('')}
                      </select>
                    </div>
                  </div>
                  <div class="att-legend">
                    <span class="att-legend-title">The colour on the left means</span>
                    <span class="att-legend-item">
                      <span class="att-legend-dot att-legend-dot--done"></span>Finished the day</span>
                    <span class="att-legend-item">
                      <span class="att-legend-dot att-legend-dot--working"></span>Still on site</span>
                    <span class="att-legend-item">
                      <span class="att-legend-dot att-legend-dot--abandoned"></span>Closed by the office</span>
                    <span class="att-legend-item">
                      <span class="att-legend-dot att-legend-dot--none"></span>Not on site</span>
                  </div>
                  <table class="att-table">
                    <thead>
                      <tr>
                        <th>Worker</th><th>Which site</th><th>Arrived</th><th>Left</th>
                        <th>Hours</th><th>Photos</th><th>What happened</th>
                      </tr>
                    </thead>
                    <tbody id="attTodayRows"></tbody>
                  </table>
                </div>`;
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
                    // The RAW status, not the redesign's wording. A
                    // spreadsheet built on "complete" keeps working, and
                    // the file stays comparable with every export before
                    // this one.
                    record ? record.status : 'no record'
                ])
            );
            attDownloadCsv('attendance-' + workDate + '.csv', csv);
        }

        function paint() {
            const attn = attention();

            body.innerHTML =
                lede(attn) +
                (mode === 'sites' ? bySite() : fullList(attn)) +
                attStrip('info', '<strong>Hours here are attendance only.</strong> ' +
                    'Nobody is paid by the hour — labour is contract-based (pakyaw), ' +
                    'so these figures never move money. They are a record of who was ' +
                    'on site.');

            // The all-clear card has no button, so this is absent as often
            // as it is present.
            const review = container.querySelector('#attReviewAll');
            if (review) {
                review.addEventListener('click', () => {
                    mode = 'list';
                    container.querySelectorAll('#attTodayMode .att-seg-btn')
                        .forEach(b => b.classList.toggle('is-on',
                                                         b.getAttribute('data-mode') === 'list'));
                    paint();
                });
            }

            if (mode === 'sites') {
                body.querySelectorAll('.att-crew-row').forEach(row => {
                    row.addEventListener('click', () => {
                        window.attendanceOpenWorker(row.getAttribute('data-worker'), workDate);
                    });
                });
            } else {
                const search = container.querySelector('#attSearch');
                const filter = container.querySelector('#attProjFilter');
                if (search) search.addEventListener('input', paintRows);
                if (filter) filter.addEventListener('change', paintRows);
                body.querySelectorAll('button[data-attn]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        window.attendanceOpenWorker(btn.getAttribute('data-attn'), workDate);
                    });
                });
                paintRows();
            }
            attIcons();
        }

        async function load() {
            stampDate();
            body.innerHTML = 'Loading…';
            try {
                // Once per screen. A missing config is not fatal -- the
                // rule falls back to 8am rather than taking the day down.
                if (dayStart === null) {
                    const cfg = await attLoadRewardConfig().catch(() => null);
                    dayStart = (cfg && cfg.default_start_time) || '';
                }
                // Not fatal: without it the board still draws every site
                // that has crew, which is what it did before.
                if (!allSites.length) {
                    allSites = await attLoadProjects().catch(() => []);
                }
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
            paint();
        }

        const modeSeg = container.querySelector('#attTodayMode');
        modeSeg.addEventListener('click', e => {
            const btn = e.target.closest('.att-seg-btn');
            if (!btn) return;
            mode = btn.getAttribute('data-mode');
            modeSeg.querySelectorAll('.att-seg-btn')
                   .forEach(b => b.classList.toggle('is-on', b === btn));
            // Repaint only. Re-fetching to switch how the SAME rows are
            // grouped would put a spinner over a decision the owner has
            // already made.
            if (rows.length) paint();
        });

        container.querySelector('#attRefresh').addEventListener('click', load);
        container.querySelector('#attExport').addEventListener('click', exportCsv);

        // The SAME A4 modal the Workers screen opens -- not a second copy
        // of the form. Account creation is one code path with one set of
        // validation rules, or the two screens drift and only one of them
        // stays in step with the admin-create-user Edge Function.
        //
        // `load` rather than a full re-render: it refetches the list while
        // leaving the chosen date and the header alone. The new worker
        // appears immediately as "Not on site", which is the honest state
        // -- they exist, and they have not timed in.
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

    /**
     * A2 -- one worker's day.
     *
     * The redesign leads with the sentence the owner came for ("On site
     * from 7:02 AM to 5:11 PM") and puts the figure beside it, instead
     * of a "Total hours" tile the reader had to assemble a story around.
     * The two photos, the facts and the trail are unchanged -- they are
     * evidence, and evidence does not get reworded.
     *
     * The copy avoids "he". Roughly a third of these accounts are not
     * men, the profile carries no pronoun, and guessing one on a record
     * that goes in front of the worker is worse than writing around it.
     */
    async function attRenderWorker(container, workerId, workDate) {
        container.innerHTML = `
            <div class="att-crumbs">
              <button class="att-link" type="button" id="attBack">Today on site</button>
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
            // The honest empty state, and the reason it is not an error:
            // A1 links here for a worker with NO record precisely so the
            // owner can confirm there is nothing to see.
            body.innerHTML = '<div class="att-stack">' +
                attBanner('Nothing was recorded for this day.',
                    'No time in came from the phone, so there is no record to open. ' +
                    'Check whether this is leave, an absence, or simply no signal — ' +
                    'a record saved offline can still arrive later.') +
                '</div>';
            attIcons();
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

        const tone = attTone(r);
        const offline = r.timein_was_offline || r.timeout_was_offline;
        const bothPhotos = !!(r.timein_photo_path && r.timeout_photo_path);

        // The sentence states the two stamps, but the FIGURE beside it is
        // total_minutes as the database computed it -- never recomputed
        // here, so this screen can never disagree with the report.
        const lead = tone === 'done'
            ? `On site from ${attTime(r.timein_at)} to ${attTime(r.timeout_at)}.`
            : tone === 'working'
                ? `Timed in at ${attTime(r.timein_at)}, and still on site.`
                : `Timed in at ${attTime(r.timein_at)}. The office closed the day.`;

        const leadBody = tone === 'done'
            ? (bothPhotos
                ? 'Both photos came through and the day is finished. Nothing needs your attention.'
                : 'The day is finished, but one of the two photos never arrived.')
            : tone === 'working'
                ? 'No time out yet, so no hours are recorded for this day. If the day ' +
                  'is over, close it below — closing records no hours and changes no pay.'
                : 'No time out was ever recorded, so the day counts no hours. This has ' +
                  'already been dealt with; nothing further is needed.';

        const resolve = attCanAbandon(r, attTodayKey());
        const closer = r.status === 'abandoned' ? await attCloserName(r.abandoned_by) : null;

        // The trail only renders on a record that HAS one. A record
        // closed before 0061 shipped could carry the status without the
        // columns (nothing could set it then, so none exist -- but the
        // constraint permits it, so the render must too).
        const trail = r.status === 'abandoned' && r.abandoned_at ? `
                  <div class="att-fact">
                    <span class="att-fact-key">Who closed it</span>
                    <span class="att-fact-val">${attEsc(closer || 'account since removed')}</span>
                  </div>
                  <div class="att-fact">
                    <span class="att-fact-key">When it was closed</span>
                    <span class="att-fact-val">${attEsc(attStamp(r.abandoned_at))}</span>
                  </div>
                  ${r.abandoned_note ? `
                  <div class="att-fact">
                    <span class="att-fact-key">Reason given</span>
                    <span class="att-fact-val">${attEsc(r.abandoned_note)}</span>
                  </div>` : ''}` : '';

        body.innerHTML = `
            <div class="att-stack">
              <div class="att-head">
                <div class="att-ident">
                  <div class="att-avatar">${attEsc(attInitials(name))}</div>
                  <div>
                    <h2 class="att-title">${attEsc(name)}</h2>
                    <div class="att-sub">${attEsc(r.worker_position || '—')} ·
                      ${attEsc(workerNo)} ·
                      ${attEsc(r.timein_project_name || '—')} · ${attEsc(dayLabel)}</div>
                  </div>
                </div>
                <div class="att-head-actions">
                  ${resolve.can ? `<button class="att-btn att-btn--warn" type="button" id="attResolve">
                    <i data-lucide="clock"></i>Close this day</button>` : ''}
                  <button class="att-btn" type="button" id="attPrint">
                    <i data-lucide="printer"></i>Print this day</button>
                </div>
              </div>

              <div class="att-banner att-banner--split">
                <div>
                  <div class="att-banner-lead">${attEsc(lead)}</div>
                  <div class="att-banner-body">${attEsc(leadBody)}</div>
                </div>
                <div class="att-banner-figure">
                  <div class="att-banner-figure-label">Hours recorded</div>
                  <div class="att-banner-figure-value">${
                      r.total_minutes !== null && r.total_minutes !== undefined
                        ? attEsc(attHours(r.total_minutes)) : 'none'}</div>
                </div>
              </div>

              <div class="att-detail-grid">
                ${attHalf('When they arrived', 'time in', 'in', 'log-in',
                          r.timein_at, r.timein_project_name,
                          r.timein_description, inUrl, r.timein_photo_path)}
                ${attHalf('When they left', 'time out', 'out', 'log-out',
                          r.timeout_at, r.timeout_project_name,
                          r.timeout_description, outUrl, r.timeout_photo_path)}
              </div>

              <div class="att-detail-foot">
                <div class="att-facts">
                  <div class="att-fact">
                    <span class="att-fact-key">How the day ended</span>
                    <span class="att-fact-val">${attStatusPill(r)} ${attBadges(r)}</span>
                  </div>
                  <div class="att-fact">
                    <span class="att-fact-key">Worker number</span>
                    <span class="att-fact-val att-mono">${attEsc(workerNo)}</span>
                  </div>
                  <div class="att-fact">
                    <span class="att-fact-key">Job on site</span>
                    <span class="att-fact-val">${attEsc(r.worker_position || '—')}</span>
                  </div>
                  <div class="att-fact">
                    <span class="att-fact-key">Who recorded it</span>
                    <span class="att-fact-val">The worker, on their own phone</span>
                  </div>
                  <div class="att-fact">
                    <span class="att-fact-key">Reached the office</span>
                    <span class="att-fact-val">${offline
                        ? 'Saved without signal, sent later' : 'Straight away'}</span>
                  </div>
                  ${trail}
                </div>

                <div class="att-explain">
                  <div class="att-info">
                    <i data-lucide="camera"></i>
                    <div>The worker takes both photos personally, in the app. They cannot
                      be added or replaced from this screen.</div>
                  </div>
                  <div class="att-info">
                    <i data-lucide="map-pin"></i>
                    <div>A site is picked twice — once arriving, once leaving. If the two
                      differ, both are shown, so a move between sites is visible rather
                      than averaged away.</div>
                  </div>
                  <div class="att-info">
                    <i data-lucide="wifi-off"></i>
                    <div>&ldquo;Saved without signal&rdquo; means the phone had no data and
                      sent the record later. It is normal on remote sites, not a warning.</div>
                  </div>
                </div>
              </div>
            </div>
            <div id="attDetailModalHost"></div>`;

        container.querySelector('#attPrint').addEventListener('click', () => window.print());

        const resolveBtn = container.querySelector('#attResolve');
        if (resolveBtn) {
            resolveBtn.addEventListener('click', () => {
                attOpenResolve(container.querySelector('#attDetailModalHost'), r,
                    // A full re-render, not a patch: the trail, the pill,
                    // the banner sentence and the button's own absence all
                    // have to move together, and re-reading is the only way
                    // the screen shows what was actually stored.
                    () => attRenderWorker(container, workerId, workDate));
            });
        }
        attIcons();
    }

    /**
     * One half of the detail: a stamp, the photo behind it, and the two
     * things the worker typed.
     *
     * `label` heads the card; `short` is the same moment named inside the
     * card's own body ("Site picked at time in"), where the heading's
     * phrasing would not fit the sentence.
     */
    function attHalf(label, short, tone, icon, at, project, description, photoUrl, photoPath) {
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
                       <img class="att-photo" src="${attEsc(photoUrl)}"
                            alt="Photo taken at ${attEsc(short)}">
                     </a>`
                  : `<div class="att-photo--missing">${photoPath
                       ? 'Photo unavailable'
                       : 'No photo taken at ' + attEsc(short)}</div>`}
              </div>
              <div class="att-half-body">
                <div>
                  <div class="att-fact-label">Site picked at ${attEsc(short)}</div>
                  <div class="att-fact-strong">${attEsc(project || '—')}</div>
                </div>
                <div>
                  <div class="att-fact-label">What they wrote</div>
                  <div class="att-fact-text">${attEsc(description || '—')}</div>
                </div>
              </div>
            </div>`;
    }

    // ── A7 · Resolve a forgotten Time Out ───────────────────────────
    //
    // Shared by A2 (one record, from its detail screen) and A6 (the
    // open-records panel). One modal and one call site, for the same
    // reason A4 is shared between A1 and A3: two copies of a write drift,
    // and only one of them stays in step with the RPC's guards.

    /**
     * Names the admin who closed a record.
     *
     * A LOOKUP, not a snapshot -- the opposite of worker_name, and the
     * difference is deliberate (see 0061 §1). The worker's name is
     * snapshotted because the record is evidence of what was shown at
     * the time; the closer is an internal admin whose CURRENT name is
     * the useful one.
     *
     * A null result is rendered as the plain fact that it is: the row
     * says a record was closed, and by whom is no longer resolvable
     * (the account was deleted -- abandoned_by is `on delete set null`).
     */
    async function attCloserName(uid) {
        if (!uid) return null;
        const { data, error } = await window.sbClient
            .from('profiles').select('display_name,email').eq('id', uid).limit(1);
        if (error) { console.warn('attendance: closer lookup failed:', error.message); return null; }
        const p = (data || [])[0];
        if (!p) return null;
        return (p.display_name || '').trim() || (p.email || '').split('@')[0] || null;
    }

    /** "5 September 2026, 1:02 PM" — local, like every other stamp here. */
    function attStamp(ts) {
        if (!ts) return '—';
        return new Date(ts).toLocaleString('en-PH', {
            day: 'numeric', month: 'long', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    /**
     * The confirm dialog.
     *
     * States the consequence in the sentence the admin reads, not in a
     * tooltip: the day will report NO hours. An admin who expected this
     * to let them enter 5pm needs to find that out before they click,
     * not when the report still shows a dash.
     *
     * `onDone` is called only after the RPC returns, and is handed the
     * updated row so the caller repaints from the database's own copy
     * rather than patching its local one.
     */
    function attOpenResolve(host, record, onDone) {
        const dayLabel = (() => {
            const [y, m, d] = String(record.work_date).split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('en-PH',
                { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        })();

        host.innerHTML = `
            <div class="att-modal" id="attResolveModal">
              <div class="att-modal-box att-modal-box--narrow" role="dialog" aria-modal="true"
                   aria-labelledby="attResolveTitle">
                <div class="att-modal-head">
                  <div>
                    <h3 class="att-modal-title" id="attResolveTitle">Close this record</h3>
                    <p class="att-modal-sub">${attEsc(record.worker_name || '—')} ·
                      ${attEsc(dayLabel)}</p>
                  </div>
                  <button class="att-modal-x" type="button" id="attRvX" aria-label="Close">&times;</button>
                </div>
                <form class="att-modal-form" id="attResolveForm" autocomplete="off">
                  <div class="att-modal-body att-modal-body--single">
                    <div class="att-info">
                      <i data-lucide="clock"></i>
                      <div>Timed in at <strong>${attTime(record.timein_at)}</strong> on
                        ${attEsc(record.timein_project_name || '—')}, and never timed out.
                        Closing marks the day <strong>Closed by the office</strong>
                        so it stops counting as still on site.</div>
                    </div>
                    <div class="att-info att-info--warn">
                      <i data-lucide="minus-circle"></i>
                      <div><strong>The day will still report no hours.</strong> Nobody knows
                        when this worker left, so the record never says — closing it does not
                        add a Time Out, and there is no way to type one in.</div>
                    </div>
                    <div class="att-field att-span">
                      <label for="attRvNote">Reason <span class="att-hint-inline">(optional)</span></label>
                      <input class="att-input" id="attRvNote" type="text" maxlength="200"
                             placeholder="e.g. Forgot to time out; crew left around 5pm">
                      <div class="att-hint">Saved on the record with your name and the time,
                        so this edit can be explained later.</div>
                    </div>
                    <div class="att-err att-err--general att-span" id="attRvGeneral"></div>
                  </div>
                  <div class="att-modal-foot">
                    <button class="att-btn" type="button" id="attRvCancel">Cancel</button>
                    <button class="att-btn att-btn--primary" type="submit" id="attRvSubmit">
                      Close this day
                    </button>
                  </div>
                </form>
              </div>
            </div>`;

        attIcons();

        const general = host.querySelector('#attRvGeneral');
        const submitBtn = host.querySelector('#attRvSubmit');

        function close() {
            if (host._attEsc) { document.removeEventListener('keydown', host._attEsc); host._attEsc = null; }
            host.innerHTML = '';
        }
        host._attEsc = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', host._attEsc);

        host.querySelector('#attRvX').addEventListener('click', close);
        host.querySelector('#attRvCancel').addEventListener('click', close);
        host.querySelector('#attResolveModal').addEventListener('click', e => {
            if (e.target.id === 'attResolveModal') close();
        });
        host.querySelector('#attRvNote').focus();

        host.querySelector('#attResolveForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            general.textContent = '';
            general.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Closing…';
            try {
                // The RPC, never an update on attendance_records -- even
                // though owner/staff hold a policy that would allow one.
                // abandoned_at must be the SERVER's now() and abandoned_by
                // must be auth.uid(); a browser-supplied trail is a trail
                // the caller chose. See 0061 §2.
                const { data, error } = await window.sbClient.rpc('attendance_abandon', {
                    p_record_id: record.id,
                    p_note: host.querySelector('#attRvNote').value
                });
                if (error) throw error;
                close();
                if (onDone) onDone(Array.isArray(data) ? data[0] : data);
            } catch (err) {
                console.error('att A7: abandon', err);
                general.textContent = attAbandonMessage(err);
                general.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Close as abandoned';
            }
        });
    }

    /**
     * The RPC's error codes, in the words an admin can act on.
     *
     * Each of these means the screen offered something the database
     * refused, so the copy says what to do next rather than restating
     * the code. NOT_OPEN and STILL_TODAY are both reachable from a stale
     * page -- someone else resolved the record, or midnight passed.
     */
    function attAbandonMessage(err) {
        const m = String((err && (err.message || err.code)) || '');
        if (/NOT_ADMIN/.test(m))        return 'Only an owner or staff account can close a record.';
        if (/RECORD_NOT_FOUND/.test(m)) return 'That record no longer exists. Refresh and try again.';
        if (/NOT_OPEN/.test(m))         return 'This record is no longer open — someone may have ' +
                                               'closed it already. Refresh to see its current state.';
        if (/STILL_TODAY/.test(m))      return 'This record is on today\'s date and cannot be closed ' +
                                               'yet — the worker may still be on site.';
        if (/AUTH_REQUIRED/.test(m))    return 'Your session has expired. Sign in again.';
        return m || 'Could not close the record. Please try again.';
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

    /**
     * A3 -- Workers.
     *
     * The redesign renames every column to the question it answers.
     * "Email" became "Signs in with", because that is the only thing the
     * address is FOR here; "Account / Active" became "Can use the app",
     * because deactivating is not an accounting state, it is a door.
     */
    async function attRenderWorkers(container) {
        container.innerHTML = `
            <div class="att-stack">
              <div class="att-head">
                <div>
                  <h2 class="att-title">Workers</h2>
                  <div class="att-sub" id="attWorkersCount">Everyone who can time in from the app</div>
                </div>
                <div class="att-head-actions">
                  <button class="att-btn" type="button" id="attWorkersRefresh">
                    <i data-lucide="refresh-cw"></i>Refresh</button>
                  <button class="att-btn att-btn--primary" type="button" id="attAddWorker">
                    <i data-lucide="user-plus"></i>Add a worker</button>
                </div>
              </div>
              <div id="attWorkersBody">Loading…</div>
            </div>
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
                             '<strong>Add a worker</strong> above — staff and engineer ' +
                             'accounts are created in Users → Navigator.</div>';
            return;
        }

        const active = rows.filter(w => w._active).length;
        const off = rows.length - active;
        container.querySelector('#attWorkersCount').textContent =
            `${active} ${active === 1 ? 'worker' : 'workers'} can time in from the phone app.` +
            (off ? ` ${off} ${off === 1 ? 'has' : 'have'} been switched off.` : '');

        body.innerHTML = `
            <div class="att-card">
              <table class="att-table">
                <thead>
                  <tr><th>Worker</th><th>Signs in with</th><th>Job on site</th>
                      <th>Can use the app</th><th></th></tr>
                </thead>
                <tbody>
                  ${rows.map(w => `
                    <tr class="${w._active ? '' : 'att-row--none'}">
                      <td>
                        <div class="att-worker">${attEsc(attWorkerName(w))}</div>
                        <div class="att-meta att-mono">${attWorkerNo(w.worker_no)}</div>
                      </td>
                      <td>${attEsc(w.email || '—')}</td>
                      <td>
                        <div>${attEsc(w.position || '—')}</div>
                        ${w.role === 'teamLeader'
                          ? '<div class="att-meta">Leads a team on site</div>' : ''}
                      </td>
                      <td>
                        ${w._active
                          ? '<span class="att-pill att-pill--done">Yes</span>'
                          : '<span class="att-pill att-pill--none">Switched off</span>'}
                        <div class="att-meta">${w._active
                          ? 'Appears in today&rsquo;s list'
                          : 'Cannot time in; old records kept'}</div>
                      </td>
                      <td class="att-right">
                        <div class="att-actions">
                          <button class="att-link" type="button"
                                  data-edit="${attEsc(w.id)}">Edit details</button>
                          <button class="att-link ${w._active ? 'att-link--danger' : ''}"
                                  type="button" data-toggle="${attEsc(w.id)}"
                                  data-active="${w._active ? '1' : '0'}">
                            ${w._active ? 'Switch off app access' : 'Switch back on'}
                          </button>
                        </div>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            ${attStrip('info', '<strong>Switching a worker off is safe.</strong> They ' +
                'disappear from today&rsquo;s list and can no longer time in — ' +
                'attendance-signin refuses an inactive account before it issues any ' +
                'tokens — but every day already recorded stays exactly as it is. Switch ' +
                'them back on any time. Office, engineer and staff accounts are made in ' +
                '<strong>Users</strong>, not here.')}`;

        body.querySelectorAll('button[data-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                const w = rows.find(x => x.id === btn.getAttribute('data-edit'));
                if (!w) return;
                attOpenEditWorker(container.querySelector('#attWorkerModalHost'), w,
                                  () => attRenderWorkers(container));
            });
        });

        body.querySelectorAll('button[data-toggle]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-toggle');
                const nowActive = btn.getAttribute('data-active') === '1';
                const { data, error } = await window.sbClient.from('profiles')
                    .update({ status: nowActive ? 'inactive' : 'active' })
                    .eq('id', id).select('id');
                if (error) { alert('Could not update worker: ' + error.message); return; }
                // Same zero-row trap the edit form guards against: an RLS
                // refusal returns no error, just nothing changed.
                if (!data || !data.length) {
                    alert('Nothing was changed — the database refused the update. ' +
                          'Check you are signed in as owner or staff.');
                    return;
                }
                attRenderWorkers(container);
            });
        });
        attIcons();
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

    // ── A3b · Edit an existing worker ───────────────────────────────
    //
    // Writes straight to profiles, no Edge Function: this changes no auth
    // credential, and profiles_admin_update (0019) already lets owner and
    // staff update other people's rows. See attValidateEditWorker for why
    // role, email and password are absent.

    function attOpenEditWorker(host, worker, onSaved) {
        const nm = attSplitName(worker);
        const active = (worker.status || 'active') === 'active';

        host.innerHTML = `
            <div class="att-modal" id="attEditWorkerModal">
              <div class="att-modal-box" role="dialog" aria-modal="true"
                   aria-labelledby="attEditWorkerTitle">
                <div class="att-modal-head">
                  <div>
                    <h3 class="att-modal-title" id="attEditWorkerTitle">Edit worker</h3>
                    <p class="att-modal-sub">${attEsc(worker.email || 'no email on this account')}
                      · ${attWorkerNo(worker.worker_no)}</p>
                  </div>
                  <button class="att-modal-x" type="button" id="attEwX" aria-label="Close">&times;</button>
                </div>
                <form class="att-modal-form" id="attEditWorkerForm" autocomplete="off">
                  <div class="att-modal-body">
                    <div class="att-field">
                      <label for="attEwFirst">First name <span class="att-req">*</span></label>
                      <input class="att-input" id="attEwFirst" type="text"
                             value="${attEsc(nm.firstName)}">
                      <div class="att-err" data-err="firstName"></div>
                    </div>
                    <div class="att-field">
                      <label for="attEwLast">Last name <span class="att-req">*</span></label>
                      <input class="att-input" id="attEwLast" type="text"
                             value="${attEsc(nm.lastName)}">
                      <div class="att-err" data-err="lastName"></div>
                    </div>
                    <div class="att-field">
                      <label for="attEwPosition">Position / Trade</label>
                      <input class="att-input" id="attEwPosition" type="text"
                             placeholder="e.g. Mason, Carpenter"
                             value="${attEsc(worker.position || '')}">
                      <div class="att-hint">Shown on every future attendance record.</div>
                    </div>
                    <div class="att-field">
                      <label>Status</label>
                      <div class="att-seg" id="attEwStatus">
                        <button class="att-seg-btn${active ? ' is-on' : ''}" type="button"
                                data-status="active" style="flex:1;">Active</button>
                        <button class="att-seg-btn${active ? '' : ' is-on'}" type="button"
                                data-status="inactive" style="flex:1;">Deactivated</button>
                      </div>
                      <div class="att-err" data-err="status"></div>
                    </div>
                    <div class="att-info att-span">
                      <i data-lucide="history"></i>
                      <div>Renaming changes the roster from here on. Attendance already
                        recorded keeps the name it was saved with — those are snapshots,
                        and rewriting them would rewrite history.</div>
                    </div>
                    <div class="att-info att-span">
                      <i data-lucide="lock"></i>
                      <div><strong>Role, email and password are not editable here.</strong>
                        Role is locked by a database guard that only permits
                        client&nbsp;↔&nbsp;partner changes; email and password live on the
                        login account and need the server-side admin key.</div>
                    </div>
                    <div class="att-err att-err--general att-span" id="attEwGeneral"></div>
                  </div>
                  <div class="att-modal-foot">
                    <button class="att-btn" type="button" id="attEwCancel">Cancel</button>
                    <button class="att-btn att-btn--primary" type="submit" id="attEwSubmit">
                      Save changes
                    </button>
                  </div>
                </form>
              </div>
            </div>`;

        attIcons();

        const general = host.querySelector('#attEwGeneral');
        const submitBtn = host.querySelector('#attEwSubmit');
        const seg = host.querySelector('#attEwStatus');

        seg.addEventListener('click', (e) => {
            const btn = e.target.closest('.att-seg-btn');
            if (!btn) return;
            seg.querySelectorAll('.att-seg-btn').forEach(b => b.classList.toggle('is-on', b === btn));
        });

        function close() {
            if (host._attEsc) { document.removeEventListener('keydown', host._attEsc); host._attEsc = null; }
            host.innerHTML = '';
        }
        host._attEsc = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', host._attEsc);

        host.querySelector('#attEwX').addEventListener('click', close);
        host.querySelector('#attEwCancel').addEventListener('click', close);

        host.querySelector('#attEditWorkerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            host.querySelectorAll('.att-err').forEach(el => { el.textContent = ''; el.style.display = 'none'; });

            const check = attValidateEditWorker({
                firstName: host.querySelector('#attEwFirst').value,
                lastName:  host.querySelector('#attEwLast').value,
                position:  host.querySelector('#attEwPosition').value,
                status:    seg.querySelector('.att-seg-btn.is-on').getAttribute('data-status')
            });
            if (!check.valid) {
                Object.keys(check.errors).forEach(k => {
                    const el = host.querySelector('[data-err="' + k + '"]');
                    if (el) { el.textContent = check.errors[k]; el.style.display = 'block'; }
                });
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving…';
            try {
                // .select() so a row count comes back. Without it an update
                // that RLS silently matched ZERO rows returns no error, and
                // the form would report success over a save that never
                // happened -- the exact failure 0019 was written to fix.
                const { data, error } = await window.sbClient.from('profiles')
                    .update(check.payload).eq('id', worker.id).select('id');
                if (error) throw error;
                if (!data || !data.length) {
                    throw new Error('The database accepted the request but changed no row. ' +
                                    'That usually means RLS refused it — check you are signed in as owner or staff.');
                }
                close();
                if (onSaved) onSaved();
            } catch (err) {
                console.error('att A3b: edit worker', err);
                general.textContent = (err && err.message) || 'Could not save the changes.';
                general.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Save changes';
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

    /**
     * Every site, INCLUDING the ones hidden from workers, each with a
     * `hidden` flag (0072). The Sites screen must not read the worker
     * picker: a hidden site would vanish from the only screen that can
     * un-hide it. Same narrow shape as the picker plus that one boolean.
     */
    async function attLoadAdminProjects() {
        const { data, error } = await window.sbClient.rpc('attendance_projects_for_admin');
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

    /**
     * How many closed days each site has set.
     *
     * ONE query for every project rather than attLoadClosures per card:
     * the card only needs the count, and a portfolio of thirty sites
     * would otherwise open thirty round trips to draw thirty numbers.
     * Failure is not fatal -- the card falls back to "none" rather than
     * taking the screen down with it.
     */
    async function attClosureCounts() {
        try {
            const { data, error } = await window.sbClient
                .from('attendance_project_closure')
                .select('project_system,folder_id,pm_project_id');
            if (error) throw error;
            const counts = new Map();
            (data || []).forEach(function (c) {
                // Two id spaces, so the key carries the system with it.
                const id = c.project_system === 'pc' ? c.folder_id : c.pm_project_id;
                if (!id) return;
                const k = attProjectKey(c.project_system, id);
                counts.set(k, (counts.get(k) || 0) + 1);
            });
            return counts;
        } catch (e) {
            console.warn('attendance: closure counts failed:', e.message || e);
            return new Map();
        }
    }

    /**
     * A5 -- Sites & schedule.
     *
     * Was a table whose last column was a button reading "Mon–Fri", with
     * the start time and the closed days hidden behind it. An owner
     * could not tell which sites still had no schedule at all without
     * opening every one -- and a site with no working days silently
     * qualifies nobody for the weekly bonus.
     *
     * The card states all three settings up front and says so in words
     * when one is missing. The LIST is still read-only: sites arrive
     * from the module that owns them, and only the schedule is editable
     * here.
     */
    async function attRenderProjects(container) {
        container.innerHTML = `
            <div class="att-stack">
              <div class="att-head">
                <div>
                  <h2 class="att-title">Sites &amp; schedule</h2>
                  <div class="att-sub" id="attProjectsCount">The sites a worker can choose
                    from on the phone, and the days each one expects them.</div>
                </div>
                <div class="att-head-actions">
                  <button class="att-btn" type="button" id="attProjectsRefresh">
                    <i data-lucide="refresh-cw"></i>Refresh</button>
                </div>
              </div>

              ${attStrip('info', 'You cannot add or rename a site here — sites arrive on ' +
                  'their own from the module that owns them. <strong>Project Control</strong> ' +
                  'owns the ones you cost and bill; <strong>Project Management</strong> owns ' +
                  'the ones you run day to day. What you <em>do</em> set here is the ' +
                  'schedule: the working days, the time workers are due, and any day the ' +
                  'site was closed. You can also <strong>hide a site from workers</strong> ' +
                  'so it stops appearing on their phone. Workers only ever see a site&rsquo;s ' +
                  'name — contract values and budgets are never sent to the app.')}

              <div id="attProjectsBody">Loading…</div>
            </div>
            <div id="attSchedHost"></div>`;

        container.querySelector('#attProjectsRefresh')
            .addEventListener('click', () => attRenderProjects(container));
        attIcons();

        const body = container.querySelector('#attProjectsBody');
        let rows, todayCounts, configs, closures, cfg;
        try {
            [rows, todayCounts, configs, closures, cfg] = await Promise.all([
                attLoadAdminProjects(), attWorkersTodayByProject(), attLoadProjectConfigs(),
                attClosureCounts(),
                // The company default, so a site with no override can name
                // the time it actually uses instead of saying "default".
                attLoadRewardConfig().catch(() => null)
            ]);
        } catch (e) {
            body.innerHTML = `<div class="att-error">Could not load sites: ${attEsc(e.message || e)}</div>`;
            attIcons();
            return;
        }

        if (!rows.length) {
            body.innerHTML = '<div class="att-card"><div class="att-empty">No sites yet. ' +
                             'Create one in <strong>Project Control</strong> or ' +
                             '<strong>Project Management</strong> — until a site exists ' +
                             'the workers&rsquo; app has nothing to pick, and a worker ' +
                             'cannot time in at all.</div></div>';
            attIcons();
            return;
        }

        const defaultStart = attClock(cfg && cfg.default_start_time);
        const pc = rows.filter(p => p.project_system === 'pc').length;
        const hiddenCount = rows.filter(p => p.hidden).length;
        container.querySelector('#attProjectsCount').textContent =
            `${rows.length} site${rows.length === 1 ? '' : 's'} · ` +
            `${pc} from Project Control · ${rows.length - pc} from Project Management` +
            (hiddenCount ? ` · ${hiddenCount} hidden from workers` : '');

        // Hidden sites sink to the bottom; the RPC's name order holds
        // within each half (Array sort is stable).
        rows = rows.slice().sort((a, b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0));

        body.innerHTML = '<div class="att-site-grid">' + rows.map(function (p) {
            const key = attProjectKey(p.project_system, p.project_id);
            const conf = configs.get(key) || null;
            const here = todayCounts.get(key) || 0;
            const closed = closures.get(key) || 0;
            const hidden = !!p.hidden;

            // An EMPTY working_days is not the same as an unset one: the
            // config row may not exist at all. Both mean "nobody here is
            // ever required", which is the sentence the card has to say.
            const daysSet = !!(conf && Array.isArray(conf.working_days) && conf.working_days.length);
            const days = daysSet ? attWorkingDaysLabel(conf.working_days) : 'Not set yet';
            const due = attClock(conf && conf.start_time_override) || defaultStart || 'Not set yet';
            const dueIsDefault = !(conf && conf.start_time_override) && !!defaultStart;

            // Hidden outranks the schedule notes: nobody can pick this
            // site, so what its bonus week looks like is not the point.
            const note = hidden
                ? 'Workers cannot pick this site on their phone. Anyone already timed ' +
                  'in here can still time out, and a Time In saved offline before you ' +
                  'hid it still counts.'
                : !daysSet
                ? 'Until you set the working days, nobody posted here can qualify for ' +
                  'the weekly bonus — no day is ever required of them.'
                : closed
                    ? `${closed} closed ${closed === 1 ? 'day is' : 'days are'} set. ` +
                      'A closed day is required of nobody, so it shrinks the bonus week ' +
                      'instead of failing it.'
                    : 'Every working day counts towards the weekly bonus.';

            return `
                <div class="att-site-card${hidden ? ' is-hidden' : ''}">
                  <div class="att-crew-head">
                    <div style="min-width:0">
                      <h3 class="att-crew-title">${attEsc(p.project_name)}</h3>
                      <p class="att-crew-sub">${here
                          ? `${here} ${here === 1 ? 'worker' : 'workers'} here today`
                          : 'No workers here today'}</p>
                    </div>
                    <div class="att-site-pills">
                      <span class="att-pill att-pill--${attEsc(p.project_system)}">${
                          p.project_system === 'pc' ? 'Costing job' : 'Site works'}</span>
                      ${hidden ? '<span class="att-pill att-pill--hidden">Hidden from workers</span>' : ''}
                    </div>
                  </div>
                  <div class="att-site-body">
                    <div class="att-site-facts">
                      <div>
                        <div class="att-site-key">Working days</div>
                        <div class="att-site-val">${attEsc(days)}</div>
                      </div>
                      <div>
                        <div class="att-site-key">Workers due at</div>
                        <div class="att-site-val att-site-val--mono">${attEsc(due)}</div>
                        ${dueIsDefault
                          ? '<div class="att-meta">The company default</div>' : ''}
                      </div>
                      <div>
                        <div class="att-site-key">Closed days set</div>
                        <div class="att-site-val">${closed || 'none'}</div>
                      </div>
                    </div>
                    <div class="att-site-note${daysSet || hidden ? '' : ' att-site-note--warn'}">${
                        attEsc(note)}</div>
                    <div class="att-site-actions">
                      <button class="att-btn" type="button" data-sched="${attEsc(key)}">
                        <i data-lucide="calendar-check"></i>${
                          daysSet ? 'Change the schedule' : 'Set the schedule'}</button>
                      <button class="att-btn" type="button" data-hide="${attEsc(key)}">
                        <i data-lucide="${hidden ? 'eye' : 'eye-off'}"></i>${
                          hidden ? 'Show to workers' : 'Hide from workers'}</button>
                    </div>
                  </div>
                </div>`;
        }).join('') + '</div>';

        const schedHost = container.querySelector('#attSchedHost');
        body.querySelectorAll('[data-sched]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-sched');
                const project = rows.find(
                    p => attProjectKey(p.project_system, p.project_id) === key);
                if (!project) return;
                attOpenSchedule(schedHost, project, configs.get(key) || null,
                                () => attRenderProjects(container));
            });
        });

        body.querySelectorAll('[data-hide]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const key = btn.getAttribute('data-hide');
                const project = rows.find(
                    p => attProjectKey(p.project_system, p.project_id) === key);
                if (!project) return;
                const hide = !project.hidden;
                if (hide && !confirm('Hide "' + project.project_name + '" from workers?\n\n' +
                        'It stops appearing on their phone. Anyone already timed in ' +
                        'there can still time out. You can show it again any time.')) {
                    return;
                }
                btn.disabled = true;
                try {
                    // Through the RPC: the browser names the project and the
                    // server derives the tenant (0070's rule, reused by 0072).
                    const res = await window.sbClient.rpc('attendance_project_set_hidden', {
                        p_system: project.project_system,
                        p_project_id: project.project_id,
                        p_hidden: hide
                    });
                    if (res.error) throw res.error;
                    const saved = Array.isArray(res.data) ? res.data[0] : res.data;
                    // No row back means nothing was written. Say so, rather
                    // than repaint a card that the next refresh contradicts.
                    if (!saved) throw new Error('the database returned no row');
                    attRenderProjects(container);
                } catch (e) {
                    console.error('att A5: set hidden', e);
                    btn.disabled = false;
                    alert('Could not ' + (hide ? 'hide' : 'show') + ' this site.\n\n' +
                          [e.message, e.hint, e.details, e.code].filter(Boolean).join(' | '));
                }
            });
        });

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
        // `id` is selected because the open-records panel resolves rows
        // through attendance_abandon(p_record_id), and the abandoned_*
        // columns because the panel and the CSV both report the trail.
        const { data, error } = await window.sbClient
            .from('attendance_records')
            .select('id,worker_id,worker_name,worker_position,work_date,status,' +
                    'timein_at,timeout_at,timein_project_name,total_minutes,' +
                    'timein_was_offline,timeout_was_offline,' +
                    'abandoned_by,abandoned_at,abandoned_note')
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

    /**
     * The open-records panel — the only place stale records surface.
     *
     * A1 shows ONE day at a time, so a record stuck since August is
     * invisible unless somebody happens to navigate to that date. That
     * is the whole reason a forgotten Time Out could sit open for
     * months: nothing was ever wrong on screen, because the screen was
     * never looking.
     *
     * Renders nothing at all when there is nothing open. An empty panel
     * headed "Open records" reads as a problem the admin has to check;
     * absence reads as the truth, which is that there is none.
     */
    function attOpenPanel(openRows) {
        if (!openRows.length) return '';
        const n = openRows.length;
        return '<div class="att-card att-card--flag">' +
                 '<div class="att-card-head">' +
                   '<div>' +
                     '<h3 class="att-card-title">' + n +
                       (n === 1 ? ' day is waiting for a time out'
                                : ' days are waiting for a time out') + '</h3>' +
                     '<p class="att-card-sub">These workers timed in but never timed out, ' +
                       'so the day records no hours. Closing a day tells the report to stop ' +
                       'waiting — it does not invent hours, and it changes no pay.</p>' +
                   '</div>' +
                 '</div>' +
                 '<table class="att-table"><thead><tr>' +
                   '<th>Day</th><th>Worker</th><th>Site</th><th>Arrived</th><th></th>' +
                 '</tr></thead><tbody>' +
                 openRows.map(function (r) {
                     const [y, m, d] = String(r.work_date).split('-').map(Number);
                     const day = new Date(y, m - 1, d).toLocaleDateString('en-PH',
                         { weekday: 'short', day: 'numeric', month: 'short' });
                     return '<tr>' +
                        '<td class="att-mono">' + attEsc(day) + '</td>' +
                        '<td><div class="att-worker">' + attEsc(r.worker_name || '—') + '</div>' +
                            '<div class="att-meta">' + attEsc(r.worker_position || '—') + '</div></td>' +
                        '<td>' + attEsc(r.timein_project_name || '—') + '</td>' +
                        '<td class="att-mono">' + attTime(r.timein_at) + '</td>' +
                        '<td class="att-right">' + (r._closable
                            ? '<button class="att-btn att-btn--warn" type="button" ' +
                              'data-resolve="' + attEsc(r.id) + '">' +
                              '<i data-lucide="clock"></i>Close this day</button>'
                            // No button, and the reason in its place: a
                            // row that simply lacked one would read as a
                            // bug rather than a rule.
                            : '<span class="att-meta">' + attEsc(r._reason) + '</span>') +
                        '</td>' +
                     '</tr>';
                 }).join('') +
                 '</tbody></table>' +
               '</div>';
    }

    /**
     * A6 -- Hours report.
     *
     * Same query, same roll-ups, same exports. What changed is the
     * opening: five stat tiles used to be the first thing on the screen,
     * and "Missing time out: 3" is a number, not an instruction. The
     * sentence above them now says what the range contains, and the
     * things that need doing are a panel with a button on every row.
     *
     * The header still carries the pakyaw disclaimer. It is the single
     * most important sentence on the screen -- an hours total that looks
     * like a payroll basis is exactly the misreading this module exists
     * to prevent.
     */
    async function attRenderReports(container) {
        const range = attDefaultRange();
        container.innerHTML =
            '<div class="att-stack">' +
            '<div class="att-head">' +
              '<div>' +
                '<h2 class="att-title">Hours report</h2>' +
                '<div class="att-sub" id="attRangeLabel"></div>' +
              '</div>' +
            '</div>' +
            // Every control that shapes the report sits in ONE row: the
            // presets, the two dates those presets rewrite, and the
            // exports that carry the same range out. Splitting them
            // between the header and a second bar put "Last 7 days" and
            // the dates it fills in two different places on the screen.
            //
            // The seg and CSV buttons are type="button" on purpose --
            // inside a form, a bare <button> submits, and the exports
            // would re-run the query before writing the file.
            '<form class="att-toolbar" id="attRangeForm">' +
              '<div class="att-seg" id="attPeriod">' +
                '<button class="att-seg-btn" type="button" data-period="daily">Just today</button>' +
                '<button class="att-seg-btn is-on" type="button" data-period="weekly">Last 7 days</button>' +
                '<button class="att-seg-btn" type="button" data-period="monthly">Last 30 days</button>' +
              '</div>' +
              '<label for="attFrom">From</label>' +
              '<input class="att-input" type="date" id="attFrom" value="' + attEsc(range.from) + '">' +
              '<label for="attTo">To</label>' +
              '<input class="att-input" type="date" id="attTo" value="' + attEsc(range.to) + '">' +
              '<button class="att-btn att-btn--primary" type="submit">Show</button>' +
              '<button class="att-btn" type="button" id="attCsvWorker">' +
                '<i data-lucide="download"></i>Excel: one row per worker</button>' +
              '<button class="att-btn" type="button" id="attCsvDay">' +
                '<i data-lucide="download"></i>Excel: one row per day</button>' +
            '</form>' +
            '<div id="attReportBody">Loading…</div>' +
            '</div>' +
            '<div id="attReportModalHost"></div>';

        const body = container.querySelector('#attReportBody');
        let rows = [];

        function stampRange(from, to) {
            container.querySelector('#attRangeLabel').textContent =
                'Pick any stretch of days and see who was on site. ' +
                attRangeLabel(from, to) +
                ' · hours are a record of attendance, NOT a basis for pay — labour is ' +
                'pakyaw, capped by contract.';
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
                body.innerHTML = '<div class="att-empty">Nobody was recorded on site ' +
                                 'in these days.</div>';
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
            // Counted on STATUS, not on a null timeout_at. An abandoned
            // record keeps timeout_at null forever, so the old test kept
            // counting records the admin had already resolved -- the
            // figure would never fall and the work would look undone.
            const openRows = attOpenRecords(rows, attTodayKey());
            const openRecords = openRows.length;
            const abandoned = rows.filter(r => r.status === 'abandoned').length;
            const workers = new Set(rows.map(r => r.worker_id)).size;

            const tail = attAnd([
                complete ? `${complete} ${complete === 1 ? 'day was' : 'days were'} finished properly` : '',
                openRecords ? `${openRecords} ${openRecords === 1 ? 'is' : 'are'} still waiting for a time out` : '',
                abandoned ? `${abandoned} ${abandoned === 1 ? 'was' : 'were'} closed by the office` : ''
            ]);

            body.innerHTML =
                '<div class="att-stack">' +

                attBanner(
                    `${workers} ${workers === 1 ? 'worker' : 'workers'} recorded ` +
                    `${attFormatHours(totalMinutes)} across ${attRangeLabel(from, to)}.`,
                    tail ? attEsc(tail.charAt(0).toUpperCase() + tail.slice(1)) + '.' : '') +

                '<div class="att-stats">' +
                  attStat('Total hours on site', attFormatHours(totalMinutes)) +
                  attStat('Average each day', attFormatHours(
                      activeDays ? Math.round(totalMinutes / activeDays) : null)) +
                  attStat('Days finished properly', complete) +
                  attStat('Days waiting for a time out', openRecords, openRecords > 0) +
                  // Shown even at zero, so resolving a record moves a
                  // figure the admin can see rather than making one
                  // quietly disappear from the screen.
                  attStat('Days closed by the office', abandoned) +
                '</div>' +

                attOpenPanel(openRows) +

                '<div class="att-card">' +
                  '<div class="att-card-head"><h3 class="att-subhead">Each worker over these days</h3></div>' +
                  '<table class="att-table"><thead><tr>' +
                    '<th>Worker</th><th>Days on site</th><th>Hours recorded</th>' +
                    '<th>Anything to fix</th>' +
                  '</tr></thead><tbody>' +
                  byWorker.map(function (w) {
                      // Two badges, never one total. An open day still
                      // needs the admin's attention; a closed one is a
                      // decision already taken, and merging them would
                      // mean resolving a record changed nothing here.
                      const flags = [];
                      if (w.openDays) {
                          flags.push('<span class="att-pill att-pill--working">' +
                              w.openDays + (w.openDays === 1 ? ' day needs' : ' days need') +
                              ' a time out</span>');
                      }
                      if (w.abandonedDays) {
                          flags.push('<span class="att-pill att-pill--abandoned">' +
                              w.abandonedDays +
                              (w.abandonedDays === 1 ? ' day closed' : ' days closed') +
                              ' by the office</span>');
                      }
                      return '<tr>' +
                          '<td><div class="att-worker">' + attEsc(w.name) + '</div>' +
                              '<div class="att-meta">' + attEsc(w.position || '—') + '</div></td>' +
                          '<td class="att-mono">' + w.daysWorked + '</td>' +
                          '<td class="att-mono">' + attFormatHours(w.totalMinutes) + '</td>' +
                          '<td>' + (flags.length ? flags.join(' ')
                              : '<span class="att-meta">Nothing</span>') + '</td>' +
                      '</tr>';
                  }).join('') +
                  '</tbody></table>' +
                '</div>' +

                '<div class="att-card">' +
                  '<div class="att-card-head"><h3 class="att-subhead">Each site over these days</h3></div>' +
                  '<table class="att-table"><thead><tr>' +
                    '<th>Site</th><th>Days worked</th><th>Hours recorded</th>' +
                  '</tr></thead><tbody>' +
                  byProject.map(function (p) {
                      return '<tr>' +
                          '<td><div class="att-worker">' + attEsc(p.project) + '</div></td>' +
                          '<td class="att-mono">' + p.daysWorked + '</td>' +
                          '<td class="att-mono">' + attFormatHours(p.totalMinutes) + '</td>' +
                      '</tr>';
                  }).join('') +
                  '</tbody></table>' +
                '</div>' +
                '</div>';

            // Re-runs the whole query after a close rather than patching
            // the row: every stat, both roll-ups, the banner sentence and
            // the panel's own membership all shift together, and
            // re-reading is the only way the screen shows what was stored.
            body.querySelectorAll('button[data-resolve]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const rec = rows.find(x => x.id === btn.getAttribute('data-resolve'));
                    if (!rec) return;
                    attOpenResolve(container.querySelector('#attReportModalHost'), rec, run);
                });
            });
            attIcons();
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
                // "Days abandoned" is its own column, not folded into
                // "Days not closed" -- the two mean different things on
                // screen and must not merge on the way out.
                ['Worker', 'Position', 'Days worked', 'Hours', 'Days not closed', 'Days abandoned'],
                attRollUpByWorker(rows).map(function (w) {
                    return [w.name, w.position, w.daysWorked, attFormatHours(w.totalMinutes),
                            w.openDays, w.abandonedDays];
                })
            );
            attDownloadCsv('attendance-by-worker-' + from + '-to-' + to + '.csv', csv);
        });

        container.querySelector('#attCsvDay').addEventListener('click', function () {
            const from = container.querySelector('#attFrom').value;
            const to = container.querySelector('#attTo').value;
            const csv = attToCsv(
                ['Work date', 'Worker', 'Position', 'Project', 'Time in', 'Time out',
                 'Hours', 'Status', 'Captured offline', 'Closed by admin', 'Reason'],
                rows.map(function (r) {
                    return [
                        r.work_date, r.worker_name, r.worker_position, r.timein_project_name,
                        attTime(r.timein_at), attTime(r.timeout_at),
                        attFormatHours(r.total_minutes), r.status,
                        // was_offline is ADMIN-facing only; the worker is
                        // never shown it (design §6.3).
                        (r.timein_was_offline || r.timeout_was_offline) ? 'yes' : 'no',
                        // The trail travels with the export. A row whose
                        // hours read '—' because an admin closed it must
                        // say so in the file too, or the spreadsheet
                        // becomes the one place that cannot explain it.
                        r.abandoned_at ? attStamp(r.abandoned_at) : '',
                        r.abandoned_note || ''
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

    // ── A7b · Per-project schedule (0065) ───────────────────────────
    //
    // WHY THIS SCREEN EXISTS. The reward asks whether every REQUIRED day
    // carried an on-time Time In, and a day the site was closed is not
    // required -- it drops out, so four on-time days in a four-day week
    // still earn the full amount.
    //
    // Without somewhere to record that a site was closed, a weekday
    // holiday disqualifies every worker in the company, eight to ten
    // times a year, through no fault of their own. This is that
    // somewhere.
    //
    // Per PROJECT, not company-wide, because that is how the business
    // runs: one site works a regular holiday on premium pay while
    // another shuts, and a local charter day closes one city only.

    const ATT_DOW = [
        { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
        { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' },
        { n: 7, label: 'Sun' }
    ];

    /** The column that holds a project id, which differs per system. */
    function attProjCol(system) {
        return system === 'pc' ? 'folder_id' : 'pm_project_id';
    }

    async function attLoadProjectConfigs() {
        const { data, error } = await window.sbClient
            .from('attendance_project_config')
            .select('id,project_system,folder_id,pm_project_id,working_days,' +
                    'start_time_override,attendance_enabled');
        if (error) throw error;
        const by = new Map();
        (data || []).forEach(function (c) {
            by.set(attProjectKey(c.project_system, c.folder_id || c.pm_project_id), c);
        });
        return by;
    }

    async function attLoadClosures(system, id) {
        const { data, error } = await window.sbClient
            .from('attendance_project_closure')
            .select('id,closed_on,reason')
            .eq('project_system', system)
            .eq(attProjCol(system), id)
            .order('closed_on', { ascending: false })
            .limit(100);
        if (error) throw error;
        return data || [];
    }

    /** "Mon-Fri", or the days themselves when it is not the usual week. */
    function attWorkingDaysLabel(days) {
        const set = Array.isArray(days) && days.length ? days.slice().sort() : [1, 2, 3, 4, 5];
        if (String(set) === String([1, 2, 3, 4, 5])) return 'Mon–Fri';
        if (String(set) === String([1, 2, 3, 4, 5, 6])) return 'Mon–Sat';
        return set.map(function (n) {
            const d = ATT_DOW.find(function (x) { return x.n === n; });
            return d ? d.label : n;
        }).join(' ');
    }

    function attOpenSchedule(host, project, config, onSaved) {
        const system = project.project_system;
        const id = project.project_id;
        const days = (config && config.working_days) || [1, 2, 3, 4, 5];

        host.innerHTML =
            '<div class="att-modal" id="attSchedModal">' +
              '<div class="att-modal-box" role="dialog" aria-modal="true" ' +
                   'aria-labelledby="attSchedTitle">' +
                '<div class="att-modal-head">' +
                  '<div>' +
                    '<h3 class="att-modal-title" id="attSchedTitle">Schedule</h3>' +
                    '<p class="att-modal-sub">' + attEsc(project.project_name) + '</p>' +
                  '</div>' +
                  '<button class="att-modal-x" type="button" id="attScX" ' +
                          'aria-label="Close">&times;</button>' +
                '</div>' +
                '<form class="att-modal-form" id="attSchedForm" autocomplete="off">' +
                  '<div class="att-modal-body att-modal-body--single">' +
                    '<div class="att-info">' +
                      '<i data-lucide="calendar-check"></i>' +
                      '<div>The reward only ever counts <strong>Monday to Friday</strong>. ' +
                        'Marking Saturday here records that the site works it — it does ' +
                        'not add a sixth day to the reward.</div>' +
                    '</div>' +
                    '<div class="att-field att-span">' +
                      '<label>Working days</label>' +
                      '<div class="att-seg" id="attScDays">' +
                        ATT_DOW.map(function (d) {
                          return '<button class="att-seg-btn' +
                                 (days.indexOf(d.n) !== -1 ? ' is-on' : '') +
                                 '" type="button" data-dow="' + d.n + '">' + d.label + '</button>';
                        }).join('') +
                      '</div>' +
                      '<div class="att-hint">A day outside this pattern is never required, ' +
                        'so it shrinks the reward week instead of failing it.</div>' +
                    '</div>' +
                    '<div class="att-field att-span">' +
                      '<label for="attScStart">Start time</label>' +
                      '<input class="att-input" type="time" id="attScStart" value="' +
                        attEsc((config && config.start_time_override) || '') + '">' +
                      '<div class="att-hint">Leave empty to use the company default. ' +
                        'A Time In after this is late, and one late day forfeits the ' +
                        'whole week.</div>' +
                    '</div>' +
                    '<div class="att-field att-span">' +
                      '<label>Site location</label>' +
                      '<div class="att-info">' +
                        '<i data-lucide="map-pin"></i>' +
                        '<div>Attendance is checked against this point. A worker ' +
                          'standing outside the radius is refused; one whose phone ' +
                          'cannot get a clear fix is <strong>recorded and flagged</strong>, ' +
                          'never refused.</div>' +
                      '</div>' +
                      '<div class="att-fence-grid" style="display:flex;gap:10px;' +
                                  'flex-wrap:wrap;align-items:flex-end;">' +
                        '<div style="display:flex;flex-direction:column;gap:4px;">' +
                          '<label for="attScLat" style="font-size:12px;color:#6b7280;">' +
                            'Latitude</label>' +
                          '<input class="att-input" type="number" step="any" id="attScLat" ' +
                                 'placeholder="14.6788638">' +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;gap:4px;">' +
                          '<label for="attScLng" style="font-size:12px;color:#6b7280;">' +
                            'Longitude</label>' +
                          '<input class="att-input" type="number" step="any" id="attScLng" ' +
                                 'placeholder="121.018953">' +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;gap:4px;">' +
                          '<label for="attScRadius" style="font-size:12px;color:#6b7280;">' +
                            'Radius in metres (10 to 5000)</label>' +
                          '<input class="att-input" type="number" id="attScRadius" ' +
                                 'min="10" max="5000" placeholder="150" value="150">' +
                        '</div>' +
                      '</div>' +
                      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;' +
                                  'margin-top:8px;">' +
                        '<button class="att-btn" type="button" id="attScHere">' +
                          '<i data-lucide="crosshair"></i>Use my location</button>' +
                        '<button class="att-btn att-btn--primary" type="button" ' +
                                'id="attScSaveFence">Save location</button>' +
                        '<label style="display:flex;gap:6px;align-items:center;font-size:13px;">' +
                          '<input type="checkbox" id="attScFenceOn" checked> Enabled</label>' +
                      '</div>' +
                      '<div class="att-hint" id="attScFenceNow"></div>' +
                      '<div class="att-hint">Editing appends a new location rather than ' +
                        'replacing the old one, so attendance already recorded keeps ' +
                        'being judged against the location that was in force when it ' +
                        'was captured.</div>' +
                    '</div>' +
                    '<div class="att-field att-span">' +
                      '<label for="attScClosed">Closed dates</label>' +
                      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<input class="att-input" type="date" id="attScClosed">' +
                        '<input class="att-input" type="text" id="attScReason" ' +
                               'maxlength="120" placeholder="Reason, e.g. Independence Day">' +
                        '<button class="att-btn" type="button" id="attScAdd">Add</button>' +
                      '</div>' +
                      '<div class="att-hint">A closed day is not required of anyone posted ' +
                        'here, so the week shrinks and four on-time days out of four still ' +
                        'earn the full reward.<br><strong>Closed dates save as soon as you add ' +
                        'them</strong> — Close does not undo them.</div>' +
                    '</div>' +
                    '<div id="attScList"></div>' +
                    '<div class="att-err att-err--general att-span" id="attScGeneral"></div>' +
                  '</div>' +
                  '<div class="att-modal-foot">' +
                    '<button class="att-btn" type="button" id="attScCancel">Close</button>' +
                    '<button class="att-btn att-btn--primary" type="submit" id="attScSave">' +
                      'Save working days &amp; time</button>' +
                  '</div>' +
                '</form>' +
              '</div>' +
            '</div>';

        attIcons();

        const general = host.querySelector('#attScGeneral');
        const listEl = host.querySelector('#attScList');
        let closures = [];

        function close() { host.innerHTML = ''; }
        function fail(msg) {
            general.textContent = msg;
            general.style.display = 'block';
        }

        function paintClosures() {
            if (!closures.length) {
                listEl.innerHTML = '<div class="att-empty">No closed dates recorded.</div>';
                return;
            }
            listEl.innerHTML =
                '<table class="att-table"><tbody>' +
                closures.map(function (c) {
                    return '<tr>' +
                      '<td class="att-mono">' + attEsc(c.closed_on) + '</td>' +
                      '<td>' + attEsc(c.reason || '—') + '</td>' +
                      '<td><button class="att-btn" type="button" data-drop="' +
                        attEsc(c.id) + '">Remove</button></td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table>';

            listEl.querySelectorAll('[data-drop]').forEach(function (b) {
                b.addEventListener('click', async function () {
                    b.disabled = true;
                    try {
                        const res = await window.sbClient
                            .rpc('attendance_project_closure_remove', {
                                p_closure_id: b.getAttribute('data-drop')
                            });
                        if (res.error) throw res.error;
                        // Re-read, for the same reason as Add: a delete
                        // that RLS silently dropped would otherwise
                        // disappear from this list and come back on the
                        // next open.
                        closures = await attLoadClosures(system, id);
                        paintClosures();
                    } catch (e) {
                        console.error('att A7b: remove closure', e);
                        b.disabled = false;
                        fail('Could not remove: ' + (e.message || e.hint || e.details || e));
                    }
                });
            });
        }

        // ── Geofence ──────────────────────────────────────────────
        const fenceNow = host.querySelector('#attScFenceNow');

        function paintFence(g) {
            if (!g) {
                fenceNow.textContent = 'No location set. Attendance here is recorded ' +
                                       'unverified until one is.';
                return;
            }
            fenceNow.textContent = 'Current: ' + Number(g.latitude).toFixed(6) + ', ' +
                Number(g.longitude).toFixed(6) + ' · ' + Number(g.radius_m) + ' m · ' +
                (g.enabled ? 'enabled' : 'disabled') +
                (g.effective_from ? ' · set ' + String(g.effective_from).slice(0, 10) : '');
            host.querySelector('#attScLat').value = g.latitude;
            host.querySelector('#attScLng').value = g.longitude;
            host.querySelector('#attScRadius').value = Number(g.radius_m);
            host.querySelector('#attScFenceOn').checked = !!g.enabled;
        }

        window.sbClient.rpc('attendance_project_geofence_current', {
            p_system: system, p_project_id: id
        }).then(function (res) {
            if (res.error) throw res.error;
            paintFence(Array.isArray(res.data) ? res.data[0] : res.data);
        }).catch(function (e) {
            console.error('att A7c: read fence', e);
            fenceNow.textContent = 'Could not read the current location.';
        });

        host.querySelector('#attScHere').addEventListener('click', function () {
            if (!navigator.geolocation) {
                fail('This browser cannot report a location.');
                return;
            }
            fenceNow.textContent = 'Reading this device location…';
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    host.querySelector('#attScLat').value = pos.coords.latitude;
                    host.querySelector('#attScLng').value = pos.coords.longitude;
                    fenceNow.textContent = 'Filled from this device. Press Save location ' +
                                           'to store it.';
                },
                function (err) {
                    // Only useful standing ON the site, and an admin at a
                    // desk should be told that rather than left guessing
                    // why the numbers did not change.
                    fail('Could not read this device location: ' + (err.message || err));
                },
                { enableHighAccuracy: true, timeout: 15000 }
            );
        });

        host.querySelector('#attScSaveFence').addEventListener('click', async function () {
            general.style.display = 'none';
            const lat = parseFloat(host.querySelector('#attScLat').value);
            const lng = parseFloat(host.querySelector('#attScLng').value);
            const rad = parseInt(host.querySelector('#attScRadius').value, 10);

            if (!isFinite(lat) || !isFinite(lng)) {
                fail('Enter both a latitude and a longitude.');
                return;
            }
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                fail('That is not a point on earth. Latitude runs -90 to 90, ' +
                     'longitude -180 to 180.');
                return;
            }
            // An empty box means "use the default"; a number outside the
            // range is a mistake worth naming. Passing either straight to
            // the server returned a bare error code that said neither.
            const radius = isFinite(rad) ? rad : 150;
            if (radius < 10 || radius > 5000) {
                fail('The radius must be between 10 and 5000 metres. ' +
                     '150 m suits most sites; anything larger starts accepting ' +
                     'workers who are nowhere near it.');
                return;
            }
            try {
                const res = await window.sbClient.rpc('attendance_project_geofence_set', {
                    p_system: system,
                    p_project_id: id,
                    p_latitude: lat,
                    p_longitude: lng,
                    p_radius_m: radius,
                    p_enabled: host.querySelector('#attScFenceOn').checked
                });
                if (res.error) throw res.error;
                const saved = Array.isArray(res.data) ? res.data[0] : res.data;
                if (!saved) throw new Error('the database returned no row');
                paintFence(saved);
            } catch (e) {
                console.error('att A7c: save fence', e);
                fail('Could not save the location: ' + attFenceMessage(e));
            }
        });

        host.querySelector('#attScDays').addEventListener('click', function (ev) {
            const btn = ev.target.closest('[data-dow]');
            if (btn) btn.classList.toggle('is-on');
        });

        host.querySelector('#attScAdd').addEventListener('click', async function () {
            const date = host.querySelector('#attScClosed').value;
            if (!date) {
                fail('Pick a date first.');
                return;
            }
            general.style.display = 'none';

            try {
                // Through the RPC, like every other write in this module.
                // The browser does NOT say whose row this is -- it names
                // the project and the server derives the tenant. That is
                // 0050's rule, and skipping it is what made this button
                // fail silently: a client-supplied owner_id that missed
                // WITH CHECK looked identical to a button doing nothing.
                const res = await window.sbClient.rpc('attendance_project_closure_add', {
                    p_system: system,
                    p_project_id: id,
                    p_closed_on: date,
                    p_reason: host.querySelector('#attScReason').value || null
                });
                if (res.error) throw res.error;

                const saved = Array.isArray(res.data) ? res.data[0] : res.data;
                if (!saved) {
                    throw new Error('the database returned no row');
                }

                host.querySelector('#attScClosed').value = '';
                host.querySelector('#attScReason').value = '';

                // Re-read rather than splicing the returned row into a
                // local array. The server is the only thing that knows
                // what is actually stored, and if it disagrees with this
                // screen the screen should lose.
                closures = await attLoadClosures(system, id);
                paintClosures();
            } catch (e) {
                console.error('att A7b: add closure', e);
                const detail = [e.message, e.hint, e.details, e.code]
                    .filter(Boolean).join(' | ') || String(e);
                fail('Could not add: ' + detail);
                // Deliberately loud. The in-dialog message sits at the
                // bottom of a scrolling body and this failure has already
                // been missed several times; a refusal that nobody sees
                // is indistinguishable from a button that does nothing.
                alert('Could not add the closed date.\n\n' + detail);
            }
        });

        host.querySelector('#attScX').addEventListener('click', close);
        host.querySelector('#attScCancel').addEventListener('click', close);

        host.querySelector('#attSchedForm').addEventListener('submit', async function (ev) {
            ev.preventDefault();
            general.style.display = 'none';
            const btn = host.querySelector('#attScSave');
            btn.disabled = true;

            const chosen = Array.prototype.slice
                .call(host.querySelectorAll('#attScDays .is-on'))
                .map(function (b) { return Number(b.getAttribute('data-dow')); })
                .sort();

            if (!chosen.length) {
                btn.disabled = false;
                fail('A project has to work at least one day.');
                return;
            }

            const start = host.querySelector('#attScStart').value;

            try {
                // Same RPC treatment as the closures above. This path
                // happens to work with a client-supplied owner_id today,
                // but only because the value the browser guesses is
                // currently the right one -- which is not a guarantee, it
                // is a coincidence waiting to break for a staff account.
                const res = await window.sbClient.rpc('attendance_project_config_save', {
                    p_system: system,
                    p_project_id: id,
                    p_working_days: chosen,
                    p_start_time: start || null
                });
                if (res.error) throw res.error;
                close();
                if (onSaved) onSaved(Array.isArray(res.data) ? res.data[0] : res.data);
            } catch (e) {
                console.error('att A7b: save config', e);
                btn.disabled = false;
                fail('Could not save: ' +
                     [e.message, e.hint, e.details, e.code].filter(Boolean).join(' | '));
            }
        });

        attLoadClosures(system, id)
            .then(function (rows) { closures = rows; paintClosures(); })
            .catch(function (e) { fail('Could not load closed dates: ' + (e.message || e)); });
    }

    // ── A8 · Weekly reward (0065 / 0066) ────────────────────────────
    //
    // REPORTING ONLY. Nothing in this section writes to payroll,
    // expenses or any money table, and the peso figure it shows creates
    // no accounting entry. Payment happens outside this system; the
    // export below is what payroll actually works from, and `paid` only
    // records that somebody says it happened.

    /** The tenant whose data we are looking at. Staff act as their owner. */
    /** The geofence RPC's refusals, as sentences rather than codes. */
    function attFenceMessage(err) {
        const raw = (err && (err.message || err.details || '')) + '';
        if (/RADIUS_OUT_OF_RANGE/.test(raw)) {
            return 'the radius must be between 10 and 5000 metres.';
        }
        if (/COORDINATES_INVALID/.test(raw)) {
            return 'those coordinates are not a point on earth.';
        }
        if (/COORDINATES_REQUIRED/.test(raw)) {
            return 'a latitude and a longitude are both needed.';
        }
        if (/PROJECT_UNAVAILABLE/.test(raw)) {
            return 'this project is not one you can set a location for.';
        }
        if (/NOT_ADMIN/.test(raw)) {
            return 'your account is not allowed to change site locations.';
        }
        return raw || 'unknown error';
    }

    function attOwnerUid() {
        return window.currentDataUserId ||
               (window.auth && auth.currentUser && auth.currentUser.uid) || '';
    }

    async function attLoadRewardConfig() {
        const { data, error } = await window.sbClient
            .from('attendance_config')
            .select('reward_amount,evaluation_grace_hours,default_start_time')
            .limit(1);
        if (error) throw error;
        return (data || [])[0] || null;
    }

    /** The week_starts already frozen, so evaluation is never re-run. */
    async function attEvaluatedWeekStarts() {
        const { data, error } = await window.sbClient
            .from('attendance_weekly_rewards')
            .select('week_start')
            .order('week_start', { ascending: false })
            .limit(500);
        if (error) throw error;
        return Array.from(new Set((data || []).map(r => r.week_start)));
    }

    /**
     * Evaluate every past week that is due and not yet frozen.
     *
     * This is how evaluation actually happens -- there is no pg_cron
     * dependency. The RPC is idempotent and REFUSES anything still
     * inside its grace period, so calling it on page load is safe: a
     * week that is not ready raises WEEK_NOT_READY and is skipped.
     *
     * That grace is why a Friday Time In captured on a site with no
     * signal, and synced on Monday, still counts.
     */
    async function attRunDueEvaluations(graceHours) {
        const owner = attOwnerUid();
        if (!owner) return [];

        const done = await attEvaluatedWeekStarts();
        const due = attWeeksNeedingEvaluation(Date.now(), done, graceHours, 8);

        const frozen = [];
        for (let i = 0; i < due.length; i++) {
            try {
                await window.sbClient.rpc('attendance_evaluate_week', {
                    p_owner: owner,
                    p_week_start: due[i]
                });
                frozen.push(due[i]);
            } catch (e) {
                // WEEK_NOT_READY is the expected, healthy answer for a
                // week still inside its grace. Anything else is worth
                // seeing, and neither is worth blocking the screen for.
                if (!/WEEK_NOT_READY/.test((e && e.message) || '')) {
                    console.error('att A8: evaluate ' + due[i], e);
                }
            }
        }
        return frozen;
    }

    async function attLoadRewards(weekStart) {
        const { data, error } = await window.sbClient
            .from('attendance_weekly_rewards')
            .select('id,worker_id,worker_name,worker_position,week_start,week_end,' +
                    'required_days,completed_days,on_time_days,late_days,missing_days,' +
                    'status,amount,paid,paid_at')
            .eq('week_start', weekStart)
            .order('worker_name');
        if (error) throw error;
        return data || [];
    }

    /**
     * Is the signed-in account staff?
     *
     * Staff never see a peso amount anywhere in this portal, and this
     * screen is the one place in attendance that carries any. Same test
     * warranty-fund.js uses -- currentUserRole is declared in admin.js
     * and may not exist if a screen is opened in isolation.
     */
    function attIsStaff() {
        return typeof currentUserRole !== 'undefined' && currentUserRole === 'staff';
    }

    function attPeso(n) {
        const v = Number(n) || 0;
        return '\u20b1' + v.toLocaleString('en-PH', {
            minimumFractionDigits: v % 1 === 0 ? 0 : 2,
            maximumFractionDigits: 2
        });
    }

    function attRewardPill(status) {
        const cls = status === 'qualified' ? 'att-pill--done'
                  : status === 'disqualified' ? 'att-pill--none'
                  : 'att-pill--working';
        const word = status === 'qualified' ? 'Gets the bonus'
                   : status === 'disqualified' ? 'No bonus'
                   : 'Week still running';
        return '<span class="att-pill ' + cls + '">' + attEsc(word) + '</span>';
    }

    /**
     * A8 -- Weekly bonus.
     *
     * "Reward" became "bonus" because that is what everyone on site calls
     * it, and the four KPI tiles became one sentence for the same reason
     * as A1: "Unpaid ₱1,000" is a figure, and "₱1,000 of it has not been
     * handed out yet" is the thing the owner has to act on.
     *
     * The page still keeps a record and pays nobody. Marking a bonus as
     * handed over writes one boolean; no money moves, and nothing here
     * touches payroll, a contract or the money model.
     */
    async function attRenderRewards(container) {
        const thisMonday = attWeekStartOf(attTodayKey());
        // Default to the week just gone: the current one cannot be frozen
        // yet, so landing on it would always show an empty table.
        let week = attKeyFromDayNum(attDayNum(thisMonday) - 7);
        const hideMoney = attIsStaff();

        container.innerHTML =
            '<div class="att-stack">' +
            '<div class="att-head">' +
              '<div>' +
                '<h2 class="att-title">Weekly bonus</h2>' +
                '<div class="att-sub" id="attRwSub"></div>' +
              '</div>' +
            '</div>' +
            '<form class="att-toolbar" id="attRwForm">' +
              '<button class="att-btn" type="button" id="attRwPrev">' +
                '<i data-lucide="chevron-left"></i>Week before</button>' +
              '<label for="attRwWeek">Week of</label>' +
              '<input class="att-input" type="date" id="attRwWeek" value="' + attEsc(week) + '">' +
              '<button class="att-btn" type="button" id="attRwNext">' +
                'Week after<i data-lucide="chevron-right"></i></button>' +
              '<button class="att-btn att-btn--primary" type="submit">Show</button>' +
              // Staff never see the amounts on screen, so they must not be
              // able to fetch them in a file either.
              (hideMoney ? '' :
              '<button class="att-btn" type="button" id="attRwCsv">' +
                '<i data-lucide="download"></i>Download the list</button>') +
            '</form>' +
            '<div id="attRwBody">Loading…</div>' +
            '</div>';

        const body = container.querySelector('#attRwBody');
        const input = container.querySelector('#attRwWeek');
        let rows = [];
        let config = null;

        function stamp() {
            const end = attWeekEndOf(week);
            const pretty = key => {
                const [y, m, d] = String(key).split('-').map(Number);
                return new Date(y, m - 1, d).toLocaleDateString('en-PH',
                    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            };
            container.querySelector('#attRwSub').textContent =
                pretty(week) + ' to ' + pretty(end);
        }

        function paint() {
            if (!rows.length) {
                body.innerHTML =
                    '<div class="att-empty">Nothing has been worked out for this week yet. ' +
                    'A week is frozen once it has ended and its grace period has passed, ' +
                    'so attendance captured offline has time to arrive first.</div>';
                return;
            }

            const t = attRewardTotals(rows);
            const lead = `${t.qualified} of ${t.workers} ` +
                `${t.workers === 1 ? 'worker' : 'workers'} earned the bonus this week.`;
            const money = hideMoney ? ''
                : `${attPeso(t.totalAmount)} in total.` +
                  (t.unpaidAmount > 0
                    ? ` ${attPeso(t.unpaidAmount)} of it has not been handed out yet.`
                    : ' All of it has been handed over.');
            const bodyText = hideMoney
                ? (t.unpaid
                    ? `${t.unpaid} of them ${t.unpaid === 1 ? 'has' : 'have'} not been handed the bonus yet.`
                    : 'Every bonus earned has been handed over.')
                : attEsc(money);

            body.innerHTML =
                '<div class="att-stack">' +

                '<div class="att-lede">' +
                  attBanner(lead, bodyText) +
                  '<div class="att-explain"><div class="att-info">' +
                    '<i data-lucide="info"></i>' +
                    '<div><strong>This page keeps a record, it does not pay anyone.</strong> ' +
                      'Marking a bonus as handed over only notes that you gave it. No money ' +
                      'moves, and nothing here touches payroll or a contract.</div>' +
                  '</div></div>' +
                '</div>' +

                '<div class="att-card">' +
                '<table class="att-table"><thead><tr>' +
                  '<th>Worker</th><th>Days expected</th><th>On time</th><th>Late</th>' +
                  '<th>Missed</th><th>Result</th>' +
                  (hideMoney ? '' : '<th>Amount</th>') +
                  '<th>Handed over</th>' +
                '</tr></thead><tbody>' +
                rows.map(function (r) {
                    const tone = r.status === 'qualified' ? 'done'
                               : r.status === 'disqualified' ? 'none' : 'working';
                    return '<tr class="att-row--' + tone + '">' +
                        '<td>' +
                          '<div class="att-worker">' + attEsc(r.worker_name || '—') + '</div>' +
                          '<div class="att-meta">' + attEsc(r.worker_position || '—') + '</div>' +
                        '</td>' +
                        '<td class="att-mono">' + r.required_days + '</td>' +
                        '<td class="att-mono">' + r.on_time_days + '</td>' +
                        '<td class="att-mono">' + r.late_days + '</td>' +
                        '<td class="att-mono">' + r.missing_days + '</td>' +
                        '<td>' + attRewardPill(r.status) +
                          '<div class="att-meta">' + attEsc(attBonusReason(r)) + '</div></td>' +
                        (hideMoney ? '' : '<td class="att-mono">' + attPeso(r.amount) + '</td>') +
                        '<td>' + (r.status === 'qualified'
                          ? '<button class="att-btn' + (r.paid ? '' : ' att-btn--primary') +
                            '" type="button" data-paid="' + attEsc(r.id) + '">' +
                            (r.paid ? 'Handed over' : 'Mark as handed over') + '</button>'
                          : '<span class="att-meta">—</span>') + '</td>' +
                      '</tr>';
                }).join('') +
                '</tbody></table>' +
                '</div>' +
                '</div>';

            body.querySelectorAll('[data-paid]').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    const id = btn.getAttribute('data-paid');
                    const row = rows.find(function (r) { return r.id === id; });
                    if (!row) return;
                    btn.disabled = true;
                    try {
                        const res = await window.sbClient.rpc('attendance_reward_mark_paid', {
                            p_reward_id: id,
                            p_paid: !row.paid
                        });
                        if (res.error) throw res.error;
                        const updated = Array.isArray(res.data) ? res.data[0] : res.data;
                        row.paid = updated ? updated.paid : !row.paid;
                        paint();
                    } catch (e) {
                        console.error('att A8: mark paid', e);
                        btn.disabled = false;
                        alert('Could not update: ' + (e.message || e));
                    }
                });
            });

            attIcons();
        }

        async function run() {
            week = attWeekStartOf(input.value || attTodayKey());
            input.value = week;
            stamp();
            body.innerHTML = 'Loading…';
            try {
                if (!config) config = await attLoadRewardConfig();
                await attRunDueEvaluations(config && config.evaluation_grace_hours);
                rows = await attLoadRewards(week);
            } catch (e) {
                console.error('att A8: load', e);
                body.innerHTML = '<div class="att-error">Could not load: ' +
                                 attEsc(e.message || e) + '</div>';
                return;
            }
            paint();
        }

        container.querySelector('#attRwForm').addEventListener('submit', function (ev) {
            ev.preventDefault();
            run();
        });
        container.querySelector('#attRwPrev').addEventListener('click', function () {
            input.value = attKeyFromDayNum(attDayNum(week) - 7);
            run();
        });
        container.querySelector('#attRwNext').addEventListener('click', function () {
            input.value = attKeyFromDayNum(attDayNum(week) + 7);
            run();
        });
        const csvBtn = container.querySelector('#attRwCsv');
        if (csvBtn) {
            csvBtn.addEventListener('click', function () {
                if (!rows.length) return;
                attDownloadCsv('weekly-reward-' + week + '.csv', attRewardCsv(rows));
            });
        }

        attIcons();
        await run();
    }

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
            return;
        }
        if (view === 'attRewards') {
            const el = document.getElementById('attRewardsView');
            if (el) attRenderRewards(el);
        }
    };
})();
