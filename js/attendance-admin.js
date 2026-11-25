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
     *
     * hoursDays counts the records that actually CARRY hours. A worker
     * whose every day is open or closed by the office has totalMinutes
     * 0, but that is "nothing recorded", not "worked zero hours" -- the
     * screen reads hoursDays to print '—' instead of "0h 0m".
     */
    function attHasHours(r) {
        return r.total_minutes !== null && r.total_minutes !== undefined;
    }

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
                    hoursDays: 0,
                    totalMinutes: 0,
                    openDays: 0,
                    abandonedDays: 0
                });
            }
            const row = by.get(key);
            row.daysWorked += 1;
            if (attHasHours(r)) row.hoursDays += 1;
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
            if (!by.has(key)) by.set(key, { project: key, daysWorked: 0, hoursDays: 0, totalMinutes: 0 });
            const row = by.get(key);
            row.daysWorked += 1;
            if (attHasHours(r)) row.hoursDays += 1;
            row.totalMinutes += Number(r.total_minutes || 0);
        });
        return Array.from(by.values()).sort((a, b) => a.project.localeCompare(b.project));
    }

    /**
     * A roll-up's hours as the report prints them: '—' when not one of
     * its days carries hours, so an all-open worker never reads "0h 0m".
     */
    function attRollUpHours(row) {
        return row && row.hoursDays ? attFormatHours(row.totalMinutes) : attFormatHours(null);
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
            missingDays: 0, unverifiedDays: 0, pendingDays: 0, completedDays: 0,
            status: 'in_progress'
        };
        (days || []).forEach(d => {
            const future = String(d.work_date) > String(todayKey);
            // 'unverified' (0078) is a day WORKED that cannot earn the bonus:
            // a known-bad location, or a Time In no clock can vouch for.
            if (d.day_status === 'on_time' || d.day_status === 'late' ||
                d.day_status === 'unverified') out.completedDays++;
            if (!d.required) return;
            out.requiredDays++;
            if (d.day_status === 'on_time') out.onTimeDays++;
            else if (d.day_status === 'late') out.lateDays++;
            else if (d.day_status === 'unverified') out.unverifiedDays++;
            else if (future) out.pendingDays++;
            else out.missingDays++;
        });
        out.status = (out.lateDays > 0 || out.missingDays > 0 || out.unverifiedDays > 0)
                   ? 'disqualified'
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
                         'On Time', 'Late', 'Missing', 'Unverified', 'Status', 'Reward', 'Paid'];
        const body = (rows || []).map(r => [
            r.worker_name || '—',
            r.worker_position || '',
            r.week_start, r.week_end,
            r.required_days, r.on_time_days, r.late_days, r.missing_days,
            Number(r.unverified_days) || 0,
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

    // The Team Leader role only makes someone eligible; being named leader of a
    // team gives the powers (0085, 0111).
    function attLeaderButtonLabel(worker) {
        return worker.role === 'teamLeader' ? 'Remove Team Leader' : 'Make Team Leader';
    }
    function attLeaderNote(worker) {
        return worker.role === 'teamLeader' ? 'Can lead a team' : '';
    }

    // A reset is confirmed by the worker number: W-0007, 0007 or 7.
    function attTempPasswordConfirmed(typed, workerNo) {
        if (workerNo === null || workerNo === undefined) return false;
        const m = String(typed === null || typed === undefined ? '' : typed).trim().match(/^(?:w-)?0*([0-9]+)$/i);
        return !!m && Number(m[1]) === Number(workerNo);
    }

    function attWorkerAdminMessage(code, detail) {
        const words = {
            OWNER_ONLY: 'Only the main owner can do that.',
            AUTH_REQUIRED: 'Your sign-in has ended. Sign in again and retry.',
            NOT_A_WORKER: 'That account is not a worker of this company.',
            ACCOUNT_INACTIVE: 'That worker is switched off. Switch them back on first.',
            BAD_SWITCH: 'Something went wrong. Reload the page.',
            BAD_REQUEST: 'Something went wrong. Reload the page.',
            RESET_FAILED: 'The password was not changed. Try again in a moment.',
            SERVER_ERROR: 'The server could not do that just now. Nothing was reported as changed. Try again in a moment.',
        };
        if (code === 'LEADS_A_TEAM') {
            return 'This person still leads ' + (detail || 'a team') + '. Pick another leader on Requests → Teams first.';
        }
        return words[code] || 'That could not be done. Try again in a moment.';
    }

    // ── Office v5 (cards) ───────────────────────────────────────────

    // Today's red count (D8, 16 Nov 2026): what the office can settle -- a
    // day that never timed out once it is over, a location problem. A worker
    // who recorded nothing stays listed under Absent? with no red number:
    // the crew still records attendance in Messenger, so every worker would
    // read Absent? every day.
    function attNeedsCount(attn) {
        return (attn || []).filter(a => a && a.kind !== 'none').length;
    }

    // Which of Today's tabs a worker belongs to. `tone` is attTone(record);
    // `isNeeds` = one of the count's items is about this worker.
    function attTodayTab(tab, tone, isNeeds, started) {
        switch (tab) {
            // The same items the red count holds (attnIds never names an
            // absentee), so the tab and the badge always agree.
            case 'needs': return !!isNeeds;
            case 'on':    return tone === 'working';
            case 'abs':   return tone === 'none';
            case 'fin':   return tone === 'done' || tone === 'abandoned';
            default:      return true;
        }
    }

    // attBadges' words as card chips (text; the frame escapes them).
    // `skew` = the worst online clock gap in minutes (attSkewMinutes, null
    // for offline captures); `loc` = [{ side: 'in'|'out', badge, tone }]
    // from attLocationFlag. Tones: n = neutral, r = bad, w = could not tell.
    function attBadgeChips(record, skew, loc) {
        if (!record) return [];
        const out = [];
        if (record.timein_was_offline || record.timeout_was_offline) out.push({ text: 'offline', tone: 'n' });
        if (Number(skew) >= 10) out.push({ text: 'clock ' + Number(skew) + 'm', tone: 'n' });
        (loc || []).forEach(f => {
            if (f && f.badge) out.push({ text: f.side + ': ' + f.badge, tone: f.tone === 'bad' ? 'r' : 'w' });
        });
        return out;
    }

    // A bonus card's five Mon–Fri dots (SplitView `dots` letters) from
    // attBonusDayCells' tones: on time, late, missed, unverified, not a
    // working day; "not yet" and a day with no row both read as not yet.
    function attBonusDots(cells) {
        const L = { ok: 'o', late: 'l', missed: 'm', unv: 'u', off: 'x', pending: 't', unknown: 't' };
        return (cells || []).map(c => L[c && c.tone] || 't').join('');
    }

    // A worker's-day id ("<worker id>|YYYY-MM-DD"): window.attendanceOpenWorker
    // opens it in the pop-up of whichever Attendance screen is showing, so
    // every screen that links to a day routes this id to attWorkerPanel.
    function attIsDayId(id) {
        return /^[^|]+\|\d{4}-\d{2}-\d{2}$/.test(String(id || ''));
    }

    // A date box applies after a pause. Loading redraws the box (the frame
    // rebuilds its toolbar), and a typed date fires `change` per segment:
    // applying each one loaded the wrong day and dropped the next digits.
    // `timers` is { set, clear } (setTimeout / clearTimeout; tests pass fakes).
    function attDateDebounce(fn, ms, timers) {
        const tm = timers || { set: (f, d) => setTimeout(f, d), clear: id => clearTimeout(id) };
        let pending = null;
        return function (value) {
            if (pending !== null) tm.clear(pending);
            pending = tm.set(() => { pending = null; fn(value); }, ms);
        };
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
                      'timein_was_offline,timeout_was_offline,timein_received_at,timeout_received_at,' +
                      // The location verdict (0068/0069). Without these the
                      // row cannot say a Time In was never checked, and an
                      // unchecked stamp looks exactly like a verified one.
                      'timein_location_status,timein_distance_m,timein_geofence_radius_m,' +
                      'timeout_location_status,timeout_distance_m,timeout_geofence_radius_m')
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

    /**
     * The sentence that opens a screen. Green by default; `warn` turns it
     * amber when the sentence is a task, so the colour says "act" before
     * the words are read.
     */
    function attBanner(lead, body, warn) {
        return '<div class="att-banner' + (warn ? ' att-banner--warn' : '') + '">' +
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

        // The location check, per stamp. Time In and Time Out are judged
        // separately (the worker may change site mid-day), so a badge
        // that merged them would hide which half was flagged.
        [['in', record.timein_location_status, record.timein_distance_m,
                record.timein_geofence_radius_m],
         ['out', record.timeout_location_status, record.timeout_distance_m,
                 record.timeout_geofence_radius_m]
        ].forEach(function (pair) {
            const flag = attLocationFlag(pair[1], pair[2], pair[3]);
            if (!flag) return;
            out.push('<span class="att-badge att-badge--loc-' + flag.tone + '" title="' +
                     attEsc(pair[0] === 'in' ? 'Time in: ' : 'Time out: ') + attEsc(flag.say) +
                     '">' + attEsc(pair[0] + ': ' + flag.badge) + '</span>');
        });
        return out.join(' ');
    }

    /**
     * What the location check said, in the owner's words (0068 / 0069).
     *
     * THE SPLIT THAT MATTERS, and it is the server's rule, not a new one
     * invented here: a `bad` status means the phone could PROVE the
     * worker was not where they claimed. A `warn` means it could not
     * tell. Colouring "the GPS was weak" the same red as "they were
     * somewhere else" would turn a cheap handset into an accusation --
     * which is exactly the outcome migration 0069 is arranged to avoid.
     *
     * Returns null for `verified` and for a record with no status at all
     * (everything written before 0069). Nothing to say is said with
     * nothing: a badge reading "ok" on every row trains an owner to stop
     * reading badges.
     */
    const ATT_LOC = {
        outside_radius: { badge: 'off site', tone: 'bad',
            say: 'Recorded away from the site' },
        mock_location: { badge: 'fake GPS', tone: 'bad',
            say: 'The phone reported a made-up location' },
        permission_denied: { badge: 'location blocked', tone: 'bad',
            say: 'The app was not allowed to read the location' },
        // 0073. A choice, like blocking the permission -- the phone knows
        // the difference between "switched off" and "no signal".
        location_disabled: { badge: 'location off', tone: 'bad',
            say: 'Location was switched off on the phone' },
        low_accuracy: { badge: 'weak GPS', tone: 'warn',
            say: 'The phone could not get a clear fix, so this was not checked' },
        location_unavailable: { badge: 'no location', tone: 'warn',
            say: 'The phone sent no location, so this was not checked' },
        project_geofence_unavailable: { badge: 'no site pin', tone: 'warn',
            say: 'This site had no saved location to check against' }
    };

    function attLocationFlag(status, distanceM, radiusM) {
        const key = String(status || '');
        if (!key || key === 'verified') return null;
        // An unrecognised code is shown, never swallowed. A future status
        // this build has not heard of is still something the owner has to
        // know happened -- and 0068 deliberately put no check constraint
        // on the column so that new codes can arrive.
        const found = ATT_LOC[key] ||
            { badge: key.replace(/_/g, ' '), tone: 'warn',
              say: 'The phone reported "' + key.replace(/_/g, ' ') + '"' };
        const d = Number(distanceM), r = Number(radiusM);
        // The distance is the whole argument on an off-site record, so it
        // is stated rather than left for someone to ask about.
        const detail = isFinite(d)
            ? found.say + ' — ' + Math.round(d) + ' m away' +
              (isFinite(r) ? ', and this site allows ' + Math.round(r) + ' m' : '')
            : found.say;
        return { badge: found.badge, tone: found.tone, say: detail };
    }

    /**
     * The whole day's location story in one sentence, for the drill-down.
     *
     * A record from before 0069 carries no status at all, and says so
     * plainly rather than implying it passed a check that did not exist
     * when it was written.
     */
    function attLocationSentence(record) {
        if (!record) return '—';
        const inFlag = attLocationFlag(record.timein_location_status,
            record.timein_distance_m, record.timein_geofence_radius_m);
        const outFlag = record.timeout_at
            ? attLocationFlag(record.timeout_location_status,
                record.timeout_distance_m, record.timeout_geofence_radius_m)
            : null;
        if (!record.timein_location_status && !record.timeout_location_status) {
            return 'Not checked — recorded before location checking';
        }
        const parts = [];
        if (inFlag) parts.push('Time in: ' + inFlag.say);
        if (outFlag) parts.push('Time out: ' + outFlag.say);
        if (!parts.length) return 'On site, both stamps verified';
        return parts.join(' · ');
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
        const unverified = Number(r.unverified_days) || 0;
        const pending = Number(r.pending_days) || 0;
        if (r.status === 'qualified') return 'On time every expected day';
        if (r.status !== 'disqualified') {
            return pending
                ? 'On time so far · ' + pending + (pending === 1 ? ' day to go' : ' days to go')
                : 'The week is not finished yet';
        }
        const parts = [];
        if (missing) parts.push('missed ' + missing + (missing === 1 ? ' expected day' : ' expected days'));
        if (late) parts.push('was late on ' + late + (late === 1 ? ' day' : ' days'));
        // 0078: say WHY, so it is not read as "late" or as a bug.
        if (unverified) parts.push('had ' + unverified +
            (unverified === 1 ? ' day that could not be verified' : ' days that could not be verified') +
            ' (outside the site, or a time no clock could confirm)');
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

    /**
     * One A6 stat card. `alert` turns the figure amber -- used for open
     * records. Amber, not red: an open day is a task waiting, and red is
     * kept for a state the office has already closed.
     */
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
        const SV = window.SplitView;
        _attScreen = 'attToday';
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
        // Office v5: the open tab (needs / all / on / abs / fin), the search,
        // the site filter and the worker's day open in the pop-up.
        let tab = null;
        let q = '';
        let proj = '';
        let sel = null;
        // What attention() lists, and the workers the red count is about
        // (D8: never a worker who simply recorded nothing).
        let attn = [];
        let attnIds = new Set();
        // Each load takes a ticket: an answer for a date the owner has
        // already moved away from is dropped instead of drawn.
        let ticket = 0;
        let state = 'loading';
        let errorText = '';
        let loadedAt = '';
        // The day box applies after a pause (a typed date fires `change` per
        // segment, and loading redraws the box).
        const applyDate = attDateDebounce(v => {
            workDate = v || attTodayKey();
            sel = null;
            load();
        }, 800);

        /** Today reads "today"; any other day is named. */
        function isToday() { return workDate === attTodayKey(); }

        /** The attention items about one worker (D8: never "recorded nothing"). */
        function attnFor(workerId) {
            return attn.filter(a => a.id === workerId && a.kind !== 'none');
        }

        function dateLine() {
            const [y, m, d] = workDate.split('-').map(Number);
            const label = new Date(y, m - 1, d).toLocaleDateString('en-PH',
                { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            // "last loaded", never "live": this screen does not poll, and
            // on a past date there is nothing live about it.
            return loadedAt ? `${label} · last loaded ${loadedAt}` : label;
        }

        /** Which tab a worker belongs to (attTodayTab, D8). */
        function inTab(key, entry) {
            return attTodayTab(key, attTone(entry.record), attnIds.has(entry.worker.id), dayHasStarted());
        }

        /**
         * Problem workers first. Only the order changes -- every worker is
         * still listed, and the CSV keeps the order it always had.
         */
        function sortRank({ worker, record }) {
            const tone = attTone(record);
            if (attnIds.has(worker.id)) return 0;
            if (tone === 'working') return 1;
            if (tone === 'none') return 2;
            if (tone === 'abandoned') return 3;
            return 4;
        }

        /** The rows the tab, search and site leave standing — what is drawn AND exported. */
        function visible() {
            const needle = q.trim().toLowerCase();
            return rows.filter(entry => {
                const { worker, record } = entry;
                const project = record ? (record.timein_project_name || '') : '';
                if (proj && project !== proj) return false;
                if (!inTab(tab, entry)) return false;
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
         * D8 (16 Nov 2026): the red count leaves the second kind out while
         * the crew records attendance in Messenger; it stays listed under
         * Absent? (attNeedsCount).
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
                        kind: 'open', id: worker.id,
                        title: `${name} never timed out`,
                        body: `Timed in at ${attTime(record.timein_at)}` +
                              (record.timein_project_name
                                ? ` at ${record.timein_project_name}` : '') +
                              ', and the day ended with no time out. Close it so the ' +
                              'hours report stops waiting. Closing a day records no ' +
                              'hours and changes no pay.'
                    });
                } else if (!record) {
                    // Nobody is absent before they are due.
                    if (!started) return;
                    out.push({
                        kind: 'none', id: worker.id,
                        title: `${name} recorded nothing` + (isToday() ? ' today' : ' that day'),
                        body: 'No time in came from the phone. Check whether this is ' +
                              'leave, an absence, or simply no signal — a record saved ' +
                              'offline can arrive later in the day.'
                    });
                }

                // The location verdict, separately -- a worker can both
                // be missing a Time Out AND have timed in from somewhere
                // else, and those are two different things to do.
                //
                // ONLY the `bad` half reaches this list. A weak fix is on
                // the card as a chip but not here: it happens on cheap
                // phones every day, it is nobody's fault, and a list that
                // fills with it is a list an owner stops reading.
                if (record) {
                    const loc = attLocationFlag(record.timein_location_status,
                        record.timein_distance_m, record.timein_geofence_radius_m);
                    if (loc && loc.tone === 'bad') {
                        out.push({
                            kind: 'location', id: worker.id,
                            title: `${name} timed in with a location problem`,
                            body: loc.say + '. The record was kept, not thrown away — ' +
                                  'check it with them before the week is paid.'
                        });
                    }
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

        /** The sentence at the top, built from what actually loaded. */
        function ledeText() {
            const total = rows.length;
            const present = rows.filter(r => r.record).length;
            const sites = new Set(rows
                .map(r => r.record && r.record.timein_project_name)
                .filter(Boolean)).size;
            const absent = total - present;
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
            return lead + (bits.length ? ' ' + attAnd(bits) + '.' : '');
        }

        // Card words and tones (the frame escapes them).
        const PILL_TONE = { done: 'done', working: 'gold', abandoned: 'red', none: 'none' };
        const CHIP_TONE = { n: 'none', r: 'red', w: 'gold' };

        /** attBadges' words as chips: offline, clock, the location check per stamp. */
        function chipsOf(record) {
            if (!record) return [];
            const skew = Math.max(
                record.timein_was_offline ? 0 : (attSkewMinutes(record.timein_at, record.timein_received_at) || 0),
                record.timeout_was_offline ? 0 : (attSkewMinutes(record.timeout_at, record.timeout_received_at) || 0));
            const loc = [
                ['in', record.timein_location_status, record.timein_distance_m, record.timein_geofence_radius_m],
                ['out', record.timeout_location_status, record.timeout_distance_m, record.timeout_geofence_radius_m]
            ].map(p => {
                const f = attLocationFlag(p[1], p[2], p[3]);
                return f ? { side: p[0], badge: f.badge, tone: f.tone } : null;
            }).filter(Boolean);
            return attBadgeChips(record, skew, loc).map(c => ({ text: c.text, tone: CHIP_TONE[c.tone] }));
        }

        /** One worker's card: name, job and number, site, times, status. */
        function cardOf({ worker, record }) {
            const tone = attTone(record);
            const site = record && record.timein_project_name;
            const hours = record && record.total_minutes !== null && record.total_minutes !== undefined
                ? attHours(record.total_minutes) : '';
            const closable = !!record && attCanAbandon(record, attTodayKey()).can;
            return {
                id: worker.id + '|' + workDate,
                title: attWorkerName(worker),
                // A worker number beside the name, so two people called the
                // same thing can still be told apart.
                sub: [worker.position || '—', attWorkerNo(worker.worker_no),
                      site || (isToday() ? 'No site today' : 'No site that day')].join(' · '),
                // A worker who needs the office says so ("… never timed out");
                // everyone else carries the status note.
                meta: (attnFor(worker.id).map(a => a.title).join(' · ') || attStatusNote(record)) +
                      (hours ? ' · ' + hours : ''),
                right: record
                    ? attTime(record.timein_at) + (record.timeout_at ? ' – ' + attTime(record.timeout_at) : '')
                    : 'No record',
                pill: { text: record ? attStatusShort(record) : (dayHasStarted() ? 'Absent?' : 'Not in yet'),
                        tone: PILL_TONE[tone] },
                chips: chipsOf(record),
                stripe: attnIds.has(worker.id) ? 'red' : '',
                dim: !record && !dayHasStarted(),
                nextLabel: closable ? 'Close this day' : '',
            };
        }

        /** 'pc' / 'pm' → the word the owner reads it by. */
        function sourceWord(system) {
            return system === 'pc' ? 'Costing job' : system === 'pm' ? 'Site works' : '';
        }

        /**
         * By site: one group per site with crew, then everyone who is not
         * on one. Full list: one list, problem workers first.
         */
        function groupsOf(list) {
            if (mode !== 'sites') {
                return [{ title: '', rows: list.slice().sort((x, y) => sortRank(x) - sortRank(y)).map(cardOf) }];
            }
            const started = dayHasStarted();
            const dueAt = attClock(dayStart) || '9:00 AM';
            const sites = new Map();
            // Keyed on the SNAPSHOT name the record carries. A site renamed
            // after the fact therefore keeps its own group under the old
            // name, which is the name on the record.
            rows.forEach(entry => {
                const site = entry.record && entry.record.timein_project_name;
                if (!site) return;
                if (!sites.has(site)) sites.set(site, { name: site, system: entry.record.timein_project_system, crew: [] });
                sites.get(site).crew.push(entry);
            });
            const shown = new Set(list);
            const groups = [...sites.values()]
                .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                .map(g => {
                    const inCount = g.crew.length;
                    const closed = g.crew.filter(c => attTone(c.record) === 'abandoned').length;
                    // Named, as the board names Jayson. "One worker" makes the
                    // owner re-scan the group for which one.
                    const openCrew = g.crew.filter(c => attTone(c.record) === 'working');
                    const openNames = attAnd(openCrew.map(c => attWorkerName(c.worker)));
                    // A day still running cannot be closed at all (attCanAbandon
                    // refuses today), so the note must not send the owner to
                    // a button that is not there.
                    const closable = openCrew.some(c => attCanAbandon(c.record, attTodayKey()).can);
                    const foot = openCrew.length
                        ? (closable
                            ? `${openNames} never timed out. Close the day on their card — it records no hours and changes no pay.`
                            : `${openNames} ${openCrew.length === 1 ? 'has' : 'have'} not ` +
                              'timed out yet. Nothing to do until the day is over.')
                        : closed
                            ? 'The office closed a day here because no time out was ever recorded. No hours were counted for it.'
                            : '';
                    // The crew ON the group: this screen groups BY the site a
                    // worker timed in at, so it always reads "N of N" -- the
                    // group confirms the crew is complete. Anyone posted here
                    // who never timed in is in the "not on site" group instead.
                    const meta = [`${inCount} of ${inCount} crew timed in`, sourceWord(g.system), foot].filter(Boolean).join(' · ');
                    return { title: g.name, meta: attEsc(meta), rows: g.crew.filter(c => shown.has(c)).map(cardOf) };
                });
            const absent = rows.filter(entry => !(entry.record && entry.record.timein_project_name) && shown.has(entry));
            if (absent.length) {
                groups.push({
                    title: !started ? 'Workers not timed in yet'
                                    : isToday() ? 'Workers not on site today' : 'Workers not on site that day',
                    tone: 'muted',
                    badge: { text: started ? 'No record' : 'Not due yet', tone: 'none' },
                    meta: attEsc(started
                        ? 'Check whether this is leave or an absence. A record saved without signal can still arrive later.'
                        : `Workers are due at ${dueAt}. Nothing is late and nothing is missing — the day has not started.`),
                    rows: absent.map(cardOf),
                });
            }
            return groups;
        }

        /**
         * Sites nobody is on, as one line of names. Still on screen --
         * "Tanauan is quiet" and "Tanauan is not on my screen" stay
         * different -- but they no longer push the workers who need
         * chasing below the fold.
         */
        function quietLine() {
            const busy = new Set(rows.map(r => r.record && r.record.timein_project_name).filter(Boolean));
            const quiet = allSites.filter(p => !busy.has(p.project_name)).map(p => p.project_name)
                .sort((a, b) => String(a).localeCompare(String(b)));
            if (!quiet.length) return '';
            const started = dayHasStarted();
            const dueAt = attClock(dayStart) || '9:00 AM';
            return `${quiet.length} ${quiet.length === 1 ? 'site' : 'sites'} with ` +
                (started ? (isToday() ? 'nobody timed in today' : 'nobody timed in that day')
                         : `no crew yet · due at ${dueAt}`) + ': ' + quiet.join(' · ');
        }

        function exportCsv() {
            const shown = state === 'ready' ? visible() : [];
            if (!shown.length) { alert('Nothing to export for this day.'); return; }
            const csv = attToCsv(
                ['Worker', 'Position', 'Worker no', 'Project', 'Time in', 'Time out',
                 'Hours', 'Status', 'Location check', 'Metres from site'],
                shown.map(({ worker, record }) => [
                    attWorkerName(worker), worker.position, attWorkerNo(worker.worker_no),
                    record ? record.timein_project_name : '',
                    attTime(record && record.timein_at), attTime(record && record.timeout_at),
                    attHours(record ? record.total_minutes : null),
                    // The RAW status, not the redesign's wording. A
                    // spreadsheet built on "complete" keeps working, and
                    // the file stays comparable with every export before
                    // this one.
                    record ? record.status : 'no record',
                    // The RAW status here too, for the same reason: the
                    // file is filtered and pivoted, and a sentence cannot
                    // be. The screen is where the words belong.
                    record ? (record.timein_location_status || '') : '',
                    record && record.timein_distance_m !== null &&
                        record.timein_distance_m !== undefined
                        ? Math.round(record.timein_distance_m) : ''
                ])
            );
            attDownloadCsv('attendance-' + workDate + '.csv', csv);
        }

        function draw(o) {
            const started = dayHasStarted();
            const projects = [...new Set(rows
                .map(r => r.record && r.record.timein_project_name)
                .filter(Boolean))].sort();
            // A site picked on another day may not be in this one: the box
            // would read "All sites" while still filtering everyone out.
            if (proj && projects.indexOf(proj) < 0) proj = '';
            const cfg = {
                key: 'attToday',
                title: 'Today on site',
                sub: dateLine(),
                seg: { options: [{ id: 'sites', label: 'By site' }, { id: 'list', label: 'Full list' }],
                       value: mode, onChange: v => { mode = v; draw(); } },
                primary: { label: 'Download for Excel', icon: 'download', onClick: exportCsv },
                more: [
                    { label: 'Refresh', icon: 'refresh-cw', onClick: () => load() },
                    // The SAME modal the Workers screen opens -- one code path,
                    // one set of rules. The new worker appears as "Not on site",
                    // the honest state: they exist, and they have not timed in.
                    { label: 'Add a worker', icon: 'user-plus', onClick: () => attOpenNewWorker(attBodyHost(), load) },
                ],
                toolbar:
                    '<select class="sv-select" data-att-site aria-label="Filter by site">' +
                      '<option value="">All sites</option>' +
                      projects.map(p => '<option value="' + attEsc(p) + '"' + (p === proj ? ' selected' : '') + '>' + attEsc(p) + '</option>').join('') +
                    '</select>' +
                    '<label class="sv-date">Day <input type="date" data-att-date value="' + attEsc(workDate) + '" aria-label="Pick a day"></label>',
                onToolbar: el => {
                    el.querySelector('[data-att-site]').addEventListener('change', e => { proj = e.target.value; draw(); });
                    el.querySelector('[data-att-date]').addEventListener('change', e => applyDate(e.target.value));
                },
                selectedId: sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel, opts) => {
                    sel = id;
                    // What the office has to do about this worker, said in the
                    // pop-up's What to do now (the old "N things need you" panel).
                    const wid = id.slice(0, id.lastIndexOf('|'));
                    attWorkerPanel(panel, id, Object.assign({}, opts, { notes: attnFor(wid).map(a => a.body) }),
                                   () => load({ quiet: true }));
                },
                onClose: () => { sel = null; },
            };
            if (state !== 'ready') {
                SV.render(container, Object.assign(cfg, {
                    search: false, tabs: [], groups: [],
                    empty: state === 'loading' ? 'Loading…'
                        : state === 'error' ? 'Could not load attendance: ' + attEsc(errorText)
                        : 'No active workers yet. Add them in <strong>Workers</strong>, or in Users → Navigator.',
                }));
                return;
            }

            const count = key => rows.filter(entry => inTab(key, entry)).length;
            const needs = attNeedsCount(attn);
            const tabs = [
                { id: 'needs', label: 'Needs you', count: needs, needs: true,
                  help: 'Clear these and the day is finished. Nothing here changes anyone’s pay.' },
                { id: 'all', label: 'Everyone', count: rows.length,
                  help: 'Everyone’s day. Click any card to see the two photos the worker took.' },
                { id: 'on', label: 'On site', count: count('on'),
                  help: 'Workers who timed in and have not timed out yet.' },
                { id: 'abs', label: started ? 'Absent?' : 'Not in yet', count: count('abs'),
                  help: started
                      ? 'No record came from the phone. Check whether this is leave, an absence, or simply no signal — a record saved offline can arrive later in the day.'
                      : 'Workers are due at ' + (attClock(dayStart) || '9:00 AM') + '. Nothing is late and nothing is missing — the day has not started.' },
                { id: 'fin', label: 'Finished', count: count('fin'),
                  help: 'Workers who timed in and timed out.' },
            ];
            if (!tab) tab = SV.pickDefaultTab(tabs, null);
            const shown = visible();
            const quiet = mode === 'sites' ? quietLine() : '';
            SV.render(container, Object.assign(cfg, {
                tiles: [
                    { n: rows.length, label: 'Expected', tab: 'all' },
                    { n: count('on'), label: 'On site', tab: 'on', tone: count('on') ? 'gold' : '' },
                    { n: count('fin'), label: 'Finished', tab: 'fin', tone: count('fin') ? 'green' : '' },
                    { n: count('abs'), label: started ? 'Absent?' : 'Not in yet', tab: 'abs' },
                    { n: needs, label: 'Needs you', tab: 'needs', tone: needs ? 'red' : '' },
                ],
                lede: ledeText(),
                strips: [quiet,
                    'Hours here are attendance only. Nobody is paid by the hour — labour is contract-based (pakyaw), ' +
                    'so these figures never move money. They are a record of who was on site.'].filter(Boolean),
                how: {
                    title: 'What the words and small badges mean',
                    rows: [['Finished the day', 'Timed in and timed out'],
                           ['Still on site', 'Timed in, no time out yet'],
                           ['Closed by the office', 'No time out, so the day records no hours'],
                           ['Not on site', 'Nothing came from the phone today'],
                           ['offline', 'Captured with no signal and synced later'],
                           ['clock', 'Device clock is N min behind the server on an online capture']]
                        .concat(Object.keys(ATT_LOC).map(k => [ATT_LOC[k].badge, ATT_LOC[k].say])),
                },
                tabs: tabs,
                tab: tab,
                onTab: id => { tab = id; draw(); },
                search: { placeholder: 'Search a name or a site…', value: q, onInput: v => { q = v; draw(); } },
                showing: (q.trim() || proj) ? 'Showing ' + shown.length + ' of ' + rows.filter(e => inTab(tab, e)).length : '',
                groups: groupsOf(shown),
                empty: (q.trim() || proj) ? 'No worker matches this search or filter.'
                    : tab === 'needs' ? 'Nothing needs you.' : 'Nobody in this tab.',
            }));
        }

        async function load(o) {
            const mine = ++ticket;
            if (!(o && o.quiet)) { state = 'loading'; draw(); }
            let got;
            try {
                // Once per screen. A missing config is not fatal -- the
                // rule falls back to 9:00 rather than taking the day down.
                if (dayStart === null) {
                    const cfg = await attLoadRewardConfig().catch(() => null);
                    dayStart = (cfg && cfg.default_start_time) || '';
                }
                // Not fatal: without it the board still draws every site
                // that has crew, which is what it did before.
                if (!allSites.length) {
                    allSites = await attLoadProjects().catch(() => []);
                }
                got = await attLoadToday(workDate);
            } catch (e) {
                if (mine !== ticket) return;
                state = 'error';
                errorText = e.message || String(e);
                draw();
                return;
            }
            if (mine !== ticket) return;
            rows = got;
            loadedAt = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true });
            attn = attention();
            attnIds = new Set(attn.filter(a => a.kind !== 'none').map(a => a.id));
            // D5 + D8: the red count on Today on site — what the office can
            // settle today (never an absentee), and only while today shows.
            if (window.NavCounts && workDate === attTodayKey()) window.NavCounts.set('attToday', attNeedsCount(attn));
            state = rows.length ? 'ready' : 'empty';
            draw(o);
        }

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
    async function attRenderWorker(container, workerId, workDate, opts) {
        // Office v5: in the pop-up the day leads with "What to do now", and
        // its Close this day button sits in that box (opts.start presses it,
        // opts.onChanged redraws the screen behind after a close).
        const inPop = !!(container.closest && container.closest('#svPop'));
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
        const resolveHtml = `<button class="att-btn att-btn--warn" type="button" id="attResolve">
                    <i data-lucide="clock"></i>Close this day</button>`;
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
                  ${resolve.can && !inPop ? resolveHtml : ''}
                  <button class="att-btn" type="button" id="attPrint">
                    <i data-lucide="printer"></i>Print this day</button>
                </div>
              </div>

              ${inPop ? window.SplitView.nextStep(
                  opts && opts.notes && opts.notes.length ? opts.notes.join(' ') : leadBody,
                  resolve.can ? resolveHtml : '') : ''}

              <div class="att-banner att-banner--split">
                <div>
                  <div class="att-banner-lead">${attEsc(lead)}</div>
                  ${inPop ? '' : `<div class="att-banner-body">${attEsc(leadBody)}</div>`}
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
                    <span class="att-fact-key">Where they were</span>
                    <span class="att-fact-val">${attEsc(attLocationSentence(r))}</span>
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
                attOpenResolve(attFormHost(container, '#attDetailModalHost'), r,
                    // A full re-render, not a patch: the trail, the pill,
                    // the banner sentence and the button's own absence all
                    // have to move together, and re-reading is the only way
                    // the screen shows what was actually stored.
                    () => {
                        attRenderWorker(container, workerId, workDate, { onChanged: opts && opts.onChanged });
                        if (opts && opts.onChanged) opts.onChanged();
                    });
            });
            // The card's "Close this day" opened this day to close it.
            if (opts && opts.start) resolveBtn.click();
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
                submitBtn.textContent = 'Close this day';
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
        const SV = window.SplitView;
        _attScreen = 'attWorkers';
        const ui = attRenderWorkers.ui || (attRenderWorkers.ui = { tab: 'on', q: '', sel: null });
        let rows = [];
        let isMainOwner = false;
        let state = 'loading';
        let errorText = '';

        const reload = () => load({ refreshPanel: true });

        function draw(o) {
            const cfg = {
                key: 'attWorkers',
                title: 'Workers',
                sub: 'Everyone who can time in from the app',
                primary: { label: 'Add a worker', onClick: () => attOpenNewWorker(attBodyHost(), reload) },
                more: [{ label: 'Refresh', icon: 'refresh-cw', onClick: () => load() }],
                selectedId: ui.sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel) => { ui.sel = id; workerPanel(panel, id); },
                onClose: () => { ui.sel = null; },
            };
            if (state !== 'ready') {
                SV.render(container, Object.assign(cfg, {
                    search: false, tabs: [], groups: [],
                    empty: state === 'loading' ? 'Loading…'
                        : state === 'error' ? 'Could not load workers: ' + attEsc(errorText)
                        : 'No workers yet. Use <strong>Add a worker</strong> above — staff and engineer ' +
                          'accounts are created in Users → Navigator.',
                }));
                return;
            }
            const active = rows.filter(w => w._active).length;
            const off = rows.length - active;
            const inTab = w => ui.tab === 'all' || (ui.tab === 'on' ? w._active : !w._active);
            const needle = ui.q.trim().toLowerCase();
            const hit = w => !needle || [attWorkerName(w), attWorkerNo(w.worker_no), w.email, w.position]
                .some(v => String(v || '').toLowerCase().includes(needle));
            const inThisTab = rows.filter(inTab);
            const shown = inThisTab.filter(hit);
            SV.render(container, Object.assign(cfg, {
                lede: `${active} ${active === 1 ? 'worker' : 'workers'} can time in from the phone app.` +
                      (off ? ` ${off} ${off === 1 ? 'has' : 'have'} been switched off.` : ''),
                strips: ['Switching a worker off is safe. They disappear from today’s list and can no longer time in — ' +
                    'attendance-signin refuses an inactive account before it issues any tokens — but every day already ' +
                    'recorded stays exactly as it is. Switch them back on any time. Office, engineer and staff accounts ' +
                    'are made in Users, not here.'],
                tabs: [['on', 'Can use the app', active, 'These workers appear in today’s list.'],
                       ['off', 'Switched off', off, 'Cannot time in; old records kept.'],
                       ['all', 'All', rows.length, '']]
                    .map(([id, label, count, help]) => ({ id, label, count, help })),
                tab: ui.tab,
                onTab: id => { ui.tab = id; draw(); },
                search: { placeholder: 'Search a name or worker number…', value: ui.q, onInput: v => { ui.q = v; draw(); } },
                showing: needle ? 'Showing ' + shown.length + ' of ' + inThisTab.length : '',
                groups: [{ title: '', rows: shown.map(w => ({
                    id: w.id,
                    title: attWorkerName(w),
                    sub: [attWorkerNo(w.worker_no), w.position || '—', attLeaderNote(w)].filter(Boolean).join(' · '),
                    meta: 'Signs in with ' + (w.email || '—'),
                    pill: w._active ? { text: 'Yes', tone: 'done' } : { text: 'Switched off', tone: 'none' },
                    dim: !w._active,
                })) }],
                empty: needle ? 'No worker matches this search.'
                    : ui.tab === 'off' ? 'Nobody is switched off.' : 'No workers in this tab.',
            }));
        }

        // One worker in the pop-up: the facts and every button the old row had.
        function workerPanel(panel, id) {
            const w = rows.find(x => x.id === id);
            if (!w) { SV.error(panel, 'This worker is no longer listed.'); return; }
            const body = SV.page(panel, {
                kicker: 'Worker', title: attWorkerName(w),
                pills: [w._active ? { text: 'Can use the app', tone: 'done' } : { text: 'Switched off', tone: 'none' }]
                    .concat(attLeaderNote(w) ? [{ text: attLeaderNote(w), tone: 'check' }] : []),
                nextLabel: 'Next worker',
            });
            body.innerHTML = SV.facts([
                    ['Worker number', attEsc(attWorkerNo(w.worker_no))],
                    ['Signs in with', attEsc(w.email || '—')],
                    ['Job on site', attEsc(w.position || '—')],
                    ['Can use the app', w._active ? 'Yes — Appears in today&rsquo;s list'
                                                  : 'Switched off — Cannot time in; old records kept'],
                ]) +
                '<div class="wp-actions">' +
                  '<button class="att-btn" type="button" data-act="edit">Edit details</button>' +
                  '<button class="att-btn' + (w._active ? ' att-btn--warn' : '') + '" type="button" data-act="toggle"' +
                    ' data-active="' + (w._active ? '1' : '0') + '">' +
                    (w._active ? 'Switch off app access' : 'Switch back on') + '</button>' +
                  // The main owner's two buttons (0111). The server decides; this only shows them.
                  (isMainOwner && (w._active || w.role === 'teamLeader') ?
                    '<button class="att-btn" type="button" data-act="leader">' + attEsc(attLeaderButtonLabel(w)) + '</button>' : '') +
                  (isMainOwner && w._active ?
                    '<button class="att-btn" type="button" data-act="password">Set temporary password</button>' : '') +
                '</div>';
            body.querySelector('[data-act="edit"]').addEventListener('click', () =>
                attOpenEditWorker(attBodyHost(), w, reload));
            const leader = body.querySelector('[data-act="leader"]');
            if (leader) leader.addEventListener('click', () => attOpenLeaderSwitch(attBodyHost(), w, reload));
            const pw = body.querySelector('[data-act="password"]');
            if (pw) pw.addEventListener('click', () => attOpenTempPassword(attBodyHost(), w, reload));
            const toggle = body.querySelector('[data-act="toggle"]');
            toggle.addEventListener('click', async () => {
                const nowActive = toggle.getAttribute('data-active') === '1';
                toggle.disabled = true;
                const { data, error } = await window.sbClient.from('profiles')
                    .update({ status: nowActive ? 'inactive' : 'active' })
                    .eq('id', w.id).select('id');
                if (error) { toggle.disabled = false; alert('Could not update worker: ' + error.message); return; }
                // Same zero-row trap the edit form guards against: an RLS
                // refusal returns no error, just nothing changed.
                if (!data || !data.length) {
                    toggle.disabled = false;
                    alert('Nothing was changed — the database refused the update. ' +
                          'Check you are signed in as owner or staff.');
                    return;
                }
                SV.toast(nowActive ? 'Switched off. Old records kept.' : 'Switched back on');
                reload();
            });
            attIcons();
        }

        async function load(o) {
            if (!(o && o.refreshPanel)) { state = 'loading'; draw(); }
            try {
                rows = await attLoadWorkers();
            } catch (e) {
                state = 'error';
                errorText = e.message || String(e);
                draw();
                return;
            }
            // The main owner's two buttons (0111). The server decides; this only shows them.
            try {
                const { data: me } = await window.sbClient.rpc('wk_me');
                isMainOwner = !!(me && me.is_main_owner);
            } catch (e) { /* no buttons */ }
            state = rows.length ? 'ready' : 'empty';
            draw(o);
        }

        await load();
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

    // Team Leader on or off: main owner only, logged by the server (0111). It joins,
    // removes and names nobody, and a labor contract has nothing to do with it.
    function attOpenLeaderSwitch(host, worker, onSaved) {
        const turnOn = worker.role !== 'teamLeader';
        const name = attWorkerName(worker);
        host.innerHTML = `
            <div class="att-modal">
              <div class="att-modal-box" role="dialog" aria-modal="true" aria-labelledby="attLsTitle">
                <div class="att-modal-head">
                  <div>
                    <h3 class="att-modal-title" id="attLsTitle">${attEsc(attLeaderButtonLabel(worker))}</h3>
                    <p class="att-modal-sub">${attEsc(name)} · ${attWorkerNo(worker.worker_no)}</p>
                  </div>
                  <button class="att-modal-x" type="button" id="attLsX" aria-label="Close">&times;</button>
                </div>
                <form class="att-modal-form" id="attLsForm" autocomplete="off">
                  <div class="att-modal-body">
                    <div class="att-info att-span">
                      <i data-lucide="info"></i>
                      <div>${turnOn
                        ? '<strong>This only makes them eligible.</strong> They get a leader&rsquo;s powers when the office names them leader of a team on Requests → Teams.'
                        : '<strong>They stop being able to lead.</strong> This is refused while they lead an active team. Any old leader mark on a turned-off team is cleared.'}
                        Their teams, attendance, rewards and own requests do not change.</div>
                    </div>
                    <div class="att-err att-err--general att-span" id="attLsGeneral"></div>
                  </div>
                  <div class="att-modal-foot">
                    <button class="att-btn" type="button" id="attLsCancel">Cancel</button>
                    <button class="att-btn att-btn--primary" type="submit" id="attLsSubmit">${attEsc(attLeaderButtonLabel(worker))}</button>
                  </div>
                </form>
              </div>
            </div>`;
        attIcons();
        const close = () => { host.innerHTML = ''; };
        host.querySelector('#attLsX').addEventListener('click', close);
        host.querySelector('#attLsCancel').addEventListener('click', close);
        host.querySelector('#attLsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submit = host.querySelector('#attLsSubmit');
            const general = host.querySelector('#attLsGeneral');
            general.style.display = 'none';
            submit.disabled = true;
            try {
                const { error } = await window.sbClient.rpc('wk_set_team_leader', { p_worker: worker.id, p_on: turnOn });
                if (error) {
                    general.textContent = attWorkerAdminMessage(error.message, error.details);
                    general.style.display = 'block';
                    submit.disabled = false;
                    return;
                }
                close();
                onSaved();
            } catch (err) {
                general.textContent = attWorkerAdminMessage('SERVER_ERROR');
                general.style.display = 'block';
                submit.disabled = false;
            }
        });
    }

    // A temporary password for one worker: main owner only. The owner confirms by the
    // worker number; the password is shown once here and kept nowhere.
    function attOpenTempPassword(host, worker, onSaved) {
        const name = attWorkerName(worker);
        host.innerHTML = `
            <div class="att-modal">
              <div class="att-modal-box" role="dialog" aria-modal="true" aria-labelledby="attTpTitle">
                <div class="att-modal-head">
                  <div>
                    <h3 class="att-modal-title" id="attTpTitle">Set temporary password</h3>
                    <p class="att-modal-sub">${attEsc(name)} · ${attWorkerNo(worker.worker_no)}</p>
                  </div>
                  <button class="att-modal-x" type="button" id="attTpX" aria-label="Close">&times;</button>
                </div>
                <form class="att-modal-form" id="attTpForm" autocomplete="off">
                  <div class="att-modal-body">
                    <div class="att-info att-info--warn att-span">
                      <i data-lucide="alert-triangle"></i>
                      <div><strong>Their old password stops working.</strong> They&rsquo;ll need to sign in again when their
                        phone&rsquo;s current access expires.
                        First check &ldquo;Not sent yet&rdquo; in the old app on their phone. Attendance waiting to send
                        stays on the phone. It can sync before the worker signs in again if the phone&rsquo;s current
                        access is still valid. Otherwise, the same worker needs to sign in again.</div>
                    </div>
                    <div class="att-field att-span">
                      <label for="attTpNumber">Type the worker number to confirm <span class="att-req">*</span></label>
                      <input class="att-input" id="attTpNumber" type="text" autocomplete="off" placeholder="${attWorkerNo(worker.worker_no)}">
                    </div>
                    <div class="att-err att-err--general att-span" id="attTpGeneral"></div>
                  </div>
                  <div class="att-modal-foot">
                    <button class="att-btn" type="button" id="attTpCancel">Cancel</button>
                    <button class="att-btn att-btn--primary" type="submit" id="attTpSubmit">Set temporary password</button>
                  </div>
                </form>
              </div>
            </div>`;
        attIcons();
        const close = () => { host.innerHTML = ''; };
        host.querySelector('#attTpX').addEventListener('click', close);
        host.querySelector('#attTpCancel').addEventListener('click', close);
        host.querySelector('#attTpForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submit = host.querySelector('#attTpSubmit');
            const general = host.querySelector('#attTpGeneral');
            general.style.display = 'none';
            if (!attTempPasswordConfirmed(host.querySelector('#attTpNumber').value, worker.worker_no)) {
                general.textContent = 'That is not this worker\'s number. Nothing was changed.';
                general.style.display = 'block';
                return;
            }
            submit.disabled = true;
            let out;
            try {
                out = await window.adminSetWorkerPassword(worker.id);
            } catch (err) {
                general.textContent = attWorkerAdminMessage(err && err.message);
                general.style.display = 'block';
                submit.disabled = false;
                return;
            }
            const box = host.querySelector('.att-modal-box');
            box.innerHTML = `
                <div class="att-modal-head">
                  <div>
                    <h3 class="att-modal-title">Temporary password set</h3>
                    <p class="att-modal-sub">${attEsc(name)} · ${attWorkerNo(worker.worker_no)}</p>
                  </div>
                </div>
                <div class="att-modal-body">
                  <div class="att-info att-span">
                    <i data-lucide="key-round"></i>
                    <div><strong>Shown once.</strong> Tell it to the worker directly. WorkMate asks them to change it when they sign in.</div>
                  </div>
                  <div class="att-field att-span"><div class="att-mono" id="attTpShown" style="font-size:20px"></div></div>
                  ${out.marked === false ? '<div class="att-info att-info--warn att-span"><i data-lucide="alert-triangle"></i><div>The password is set, but WorkMate may not ask them to change it. Ask them to change it in Profile.</div></div>' : ''}
                </div>
                <div class="att-modal-foot">
                  <button class="att-btn att-btn--primary" type="button" id="attTpDone">Done</button>
                </div>`;
            box.querySelector('#attTpShown').textContent = out.temporary_password;
            attIcons();
            box.querySelector('#attTpDone').addEventListener('click', () => { close(); onSaved(); });
        });
    }

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
                      <div><strong>Email is not editable here.</strong> It lives on the login
                        account. Role and temporary password have their own buttons on the
                        Workers list, for the main owner.</div>
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
     * opening every one. A site never configured runs the default
     * Mon–Fri, and the card says so rather than "not set".
     *
     * The card states all three settings up front and says so in words
     * when one is missing. The LIST is still read-only: sites arrive
     * from the module that owns them, and only the schedule is editable
     * here.
     */
    // What the admin last typed or picked on this page. Kept outside the
    // render so that toggling one site (which re-reads from the server)
    // does not throw away the search and filter they were working in.
    const ATT_SITES_UI = { q: '', filter: 'all', sel: null };

    async function attRenderProjects(container) {
        const SV = window.SplitView;
        _attScreen = 'attProjects';
        let rows = [], todayCounts, configs, closures, cfg, infos = [], defaultStart = '';
        let state = 'loading';
        let errorText = '';

        const reload = () => load({ refreshPanel: true });

        const HOW = `You cannot add or rename a site here — sites arrive on
            their own from the module that owns them. Project Control
            owns the ones you cost and bill; Project Management owns the ones you run day to day. What you do
            set here is the schedule: the working days, the time workers are due, and any day the site was closed. You can also
            hide a site from workers so it stops appearing on their phone. Workers only ever see a site’s
            name — contract values and budgets are never sent to the app.`.replace(/\s+/g, ' ');

        function matches() {
            const needle = ATT_SITES_UI.q.trim().toLowerCase();
            return infos.filter(function (i) {
                if (needle && String(i.p.project_name || '').toLowerCase().indexOf(needle) === -1) {
                    return false;
                }
                switch (ATT_SITES_UI.filter) {
                    case 'custom': return i.custom;
                    case 'hidden': return i.hidden;
                    case 'closed': return i.closed > 0;
                    default: return true;
                }
            });
        }

        function draw(o) {
            const base = {
                key: 'attProjects',
                title: 'Sites & schedule',
                sub: 'The sites a worker can choose from on the phone, and the days each one expects them.',
                more: [{ label: 'Refresh', icon: 'refresh-cw', onClick: () => load() }],
                how: { title: 'How this page works', text: HOW },
                selectedId: ATT_SITES_UI.sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel) => { ATT_SITES_UI.sel = id; sitePanel(panel, id); },
                onClose: () => { ATT_SITES_UI.sel = null; },
            };
            if (state !== 'ready') {
                SV.render(container, Object.assign(base, {
                    search: false, tabs: [], groups: [],
                    empty: state === 'loading' ? 'Loading…'
                        : state === 'error' ? 'Could not load sites: ' + attEsc(errorText)
                        : 'No sites yet. Create one in <strong>Project Control</strong> or ' +
                          '<strong>Project Management</strong> — until a site exists the workers&rsquo; app has ' +
                          'nothing to pick, and a worker cannot time in at all.',
                }));
                return;
            }
            const pc = infos.filter(i => i.p.project_system === 'pc').length;
            const hiddenCount = infos.filter(i => i.hidden).length;
            const counts = {
                all: infos.length,
                custom: infos.filter(i => i.custom).length,
                hidden: hiddenCount,
                closed: infos.filter(i => i.closed > 0).length
            };
            const list = matches();
            const inTab = ATT_SITES_UI.q.trim() ? infos.filter(i => {
                const f = ATT_SITES_UI.filter;
                return f === 'all' || (f === 'custom' ? i.custom : f === 'hidden' ? i.hidden : i.closed > 0);
            }).length : 0;
            SV.render(container, Object.assign(base, {
                lede: `${infos.length} site${infos.length === 1 ? '' : 's'} · ` +
                      `${pc} from Project Control · ${infos.length - pc} from Project Management` +
                      (hiddenCount ? ` · ${hiddenCount} hidden from workers` : ''),
                tabs: [['all', 'All', ''],
                       ['custom', 'Custom schedule', 'Sites whose working days or due time differ from the company default.'],
                       ['hidden', 'Hidden', 'Workers cannot pick these sites on their phone.'],
                       ['closed', 'Has closed days', 'Sites with a day recorded as closed.']]
                    .map(([id, label, help]) => ({ id, label, count: counts[id], help })),
                tab: ATT_SITES_UI.filter,
                onTab: id => { ATT_SITES_UI.filter = id; draw(); },
                search: { placeholder: 'Search sites', value: ATT_SITES_UI.q, onInput: v => { ATT_SITES_UI.q = v; draw(); } },
                showing: ATT_SITES_UI.q.trim() ? 'Showing ' + list.length + ' of ' + inTab : '',
                groups: [{ title: '', rows: list.map(i => ({
                    id: i.key,
                    title: i.p.project_name,
                    sub: i.days + ' · due ' + i.due,
                    meta: (i.closed ? i.closed + (i.closed === 1 ? ' closed day' : ' closed days') : 'No closed days') +
                          (i.here ? ' · ' + i.here + (i.here === 1 ? ' worker' : ' workers') + ' here today' : ''),
                    chips: [{ text: i.p.project_system === 'pc' ? 'Costing job' : 'Site works',
                              tone: i.p.project_system === 'pc' ? 'check' : 'pm' }],
                    pill: i.hidden ? { text: 'Hidden from workers', tone: 'none' } : { text: 'Visible', tone: 'done' },
                    dim: i.hidden,
                })) }],
                empty: 'No sites match' + (ATT_SITES_UI.q.trim() ? ' “' + attEsc(ATT_SITES_UI.q.trim()) + '”' : '') + ' in this filter.',
            }));
        }

        // One site in the pop-up: its schedule, its note, and its four buttons.
        function sitePanel(panel, key) {
            const i = infos.find(x => x.key === key);
            if (!i) { SV.error(panel, 'This site is no longer listed.'); return; }
            const p = i.p;
            const body = SV.page(panel, {
                kicker: 'Site', title: p.project_name,
                pills: [{ text: p.project_system === 'pc' ? 'Costing job' : 'Site works', tone: p.project_system === 'pc' ? 'check' : 'pm' },
                        i.hidden ? { text: 'Hidden from workers', tone: 'none' } : { text: 'Visible to workers', tone: 'done' }],
                nextLabel: 'Next site',
            });
            const project = rows.find(x => attProjectKey(x.project_system, x.project_id) === key);
            const schedule = startTab => attOpenSchedule(attBodyHost(), project, configs.get(key) || null,
                                                         reload, defaultStart, startTab);
            body.innerHTML =
                (i.daysSet ? '' : SV.nextStep('No working days are set yet for this site. It counts Mon–Fri, the default, until you set them.',
                    '<button class="att-btn att-btn--primary" type="button" data-sched-tab="days">Set the schedule</button>')) +
                '<div class="sv-panel-sub">' + attEsc(p.project_system === 'pc'
                    ? 'From Project Control (you cost and bill it)'
                    : 'From Project Management (you run it day to day)') + '</div>' +
                SV.facts([
                    ['Working days', attEsc(i.days) + (i.daysIsDefault ? ' <span class="att-meta">The default — not changed yet</span>' : '')],
                    ['Workers due at', attEsc(i.due) + (i.dueIsDefault ? ' <span class="att-meta">The company default</span>'
                        : i.hasOverride ? ' <span class="att-meta">Custom time for this site</span>' : '')],
                    ['Closed days', i.closed ? String(i.closed) : 'none'],
                    ['Here today', i.here ? i.here + (i.here === 1 ? ' worker' : ' workers') : 'Nobody'],
                ]) +
                '<div class="att-site-note">' + attEsc(i.note) + '</div>' +
                '<div class="wp-actions">' +
                  '<button class="att-btn" type="button" data-sched-tab="days"><i data-lucide="calendar-check"></i>' +
                    (i.daysSet ? 'Change the schedule' : 'Set the schedule') + '</button>' +
                  '<button class="att-btn" type="button" data-sched-tab="location"><i data-lucide="map-pin"></i>Location…</button>' +
                  '<button class="att-btn" type="button" data-sched-tab="closed"><i data-lucide="calendar-x"></i>Closed dates…</button>' +
                  '<button class="att-btn" type="button" data-hide><i data-lucide="' + (i.hidden ? 'eye' : 'eye-off') + '"></i>' +
                    (i.hidden ? 'Show to workers' : 'Hide from workers') + '</button>' +
                '</div>';
            if (project) {
                body.querySelectorAll('[data-sched-tab]').forEach(b => b.addEventListener('click', () => {
                    const t = b.getAttribute('data-sched-tab');
                    schedule(t === 'location' ? 'location' : t === 'closed' ? 'closed' : 'days');
                }));
            }
            const btn = body.querySelector('[data-hide]');
            btn.addEventListener('click', async () => {
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
                    SV.toast(hide ? 'Hidden from workers' : 'Shown to workers again');
                    reload();
                } catch (e) {
                    console.error('att A5: set hidden', e);
                    btn.disabled = false;
                    alert('Could not ' + (hide ? 'hide' : 'show') + ' this site.\n\n' +
                          [e.message, e.hint, e.details, e.code].filter(Boolean).join(' | '));
                }
            });
            attIcons();
        }

        async function load(o) {
            if (!(o && o.refreshPanel)) { state = 'loading'; draw(); }
            try {
                [rows, todayCounts, configs, closures, cfg] = await Promise.all([
                    attLoadAdminProjects(), attWorkersTodayByProject(), attLoadProjectConfigs(),
                    attClosureCounts(),
                    // The company default, so a site with no override can name
                    // the time it actually uses instead of saying "default".
                    attLoadRewardConfig().catch(() => null)
                ]);
            } catch (e) {
                state = 'error';
                errorText = e.message || String(e);
                draw();
                return;
            }
            defaultStart = attClock(cfg && cfg.default_start_time);

            // Hidden sites sink to the bottom; the RPC's name order holds
            // within each half (Array sort is stable).
            rows = rows.slice().sort((a, b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0));

            // Everything a card or the pop-up says about a site, worked out once.
            infos = rows.map(function (p) {
                const key = attProjectKey(p.project_system, p.project_id);
                const conf = configs.get(key) || null;
                const here = todayCounts.get(key) || 0;
                const closed = closures.get(key) || 0;
                const hidden = !!p.hidden;

                // No config row is NOT "nobody is required". The database reads
                // a missing row as the default Mon–Fri (attendance_is_required_day,
                // 0065: `coalesce(..., true)`), and working_days can never be
                // empty (its check constraint). The card used to say "Not set
                // yet" and warn that nobody here could earn the bonus -- the
                // opposite of what the evaluator actually does.
                const daysSet = !!(conf && Array.isArray(conf.working_days) && conf.working_days.length);
                const days = daysSet ? attWorkingDaysLabel(conf.working_days) : 'Mon–Fri';
                const hasOverride = !!(conf && conf.start_time_override);
                const due = attClock(conf && conf.start_time_override) || defaultStart || 'Not set yet';

                // Hidden outranks the schedule notes: nobody can pick this
                // site, so what its bonus week looks like is not the point.
                const note = hidden
                    ? 'Workers cannot pick this site on their phone. Anyone already timed ' +
                      'in here can still time out, and a Time In saved offline before you ' +
                      'hid it still counts.'
                    : closed
                        ? `${closed} closed ${closed === 1 ? 'day is' : 'days are'} set. ` +
                          'A closed day is required of nobody, so it shrinks the bonus week ' +
                          'instead of failing it.'
                        : 'Every working day counts towards the weekly bonus.';

                return {
                    p: p, key: key, conf: conf, here: here, closed: closed, hidden: hidden,
                    daysSet: daysSet, days: days, daysIsDefault: !daysSet,
                    due: due, dueIsDefault: !hasOverride && !!defaultStart, hasOverride: hasOverride,
                    // "Custom" = the admin has changed something from the default.
                    custom: daysSet || hasOverride,
                    note: note
                };
            });
            state = infos.length ? 'ready' : 'empty';
            draw(o);
        }

        await load();
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
                    'timein_location_status,timein_distance_m,timein_geofence_radius_m,' +
                    'timeout_location_status,timeout_distance_m,timeout_geofence_radius_m,' +
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
     * The "Waiting for a time out" tab — the only place stale records surface.
     *
     * A1 shows ONE day at a time, so a record stuck since August is
     * invisible unless somebody happens to navigate to that date. That
     * is the whole reason a forgotten Time Out could sit open for
     * months: nothing was ever wrong on screen, because the screen was
     * never looking.
     *
     * Office v5: the tab is always there, with its count; empty, it says
     * "Nothing here. You're done." -- the truth, which is that there is none.
     */

    /**
     * A6 -- Hours report.
     *
     * Same query, same roll-ups, same exports. The screen is ordered by
     * what needs doing: the sentence at the top says how many days are
     * waiting, the "Waiting for a time out" tab puts a Close this day on
     * each of those days, and the totals sit in the tiles above.
     *
     * The pakyaw disclaimer sits beside the totals, not in the header:
     * an hours total that looks like a payroll basis is exactly the
     * misreading this module exists to prevent, so it belongs next to
     * the numbers it qualifies.
     */
    async function attRenderReports(container) {
        const SV = window.SplitView;
        _attScreen = 'attReports';
        const range = attDefaultRange();
        const ui = attRenderReports.ui || (attRenderReports.ui = { tab: null, sel: null });
        // The boxes, and the rows on screen with the range they were loaded
        // for. Exports read `shown`, never the boxes: a date typed but still
        // loading must not name a file after a range it does not contain.
        let from = range.from, to = range.to;
        let rows = [];
        let shown = { from: range.from, to: range.to };
        // Each run takes a ticket; a slower, older response that lands
        // after a newer one is dropped instead of overwriting it.
        let ticket = 0;
        let state = 'loading';
        let errorText = '';
        let t = null;
        // One debouncer for both date boxes, for the life of the screen.
        const applyDate = attDateDebounce(() => run(), 800);

        function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
        function dayLabel(key) {
            const [y, m, d] = String(key).split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short' });
        }

        // Totals restate what the database already computed.
        function compute() {
            const totalMinutes = rows.reduce((s, r) => s + (Number(r.total_minutes) || 0), 0);
            // The average is ONE WORKER'S finished day: total hours over the
            // records that actually carry hours. Dividing by calendar days
            // instead summed the whole crew into one "day" -- six workers
            // on 8h each read as "48h average each day". Open and closed-
            // by-office days have no hours, so they stay out of both sides.
            const daysWithHours = rows.filter(attHasHours).length;
            // Counted on STATUS, not on a null timeout_at. An abandoned
            // record keeps timeout_at null forever, so the old test kept
            // counting records the admin had already resolved.
            const openRows = attOpenRecords(rows, attTodayKey());
            return {
                totalMinutes: totalMinutes,
                daysWithHours: daysWithHours,
                // With no finished day the total is '—', not "0h 0m":
                // nothing recorded is not zero hours worked.
                totalHours: attRollUpHours({ hoursDays: daysWithHours, totalMinutes: totalMinutes }),
                complete: rows.filter(r => r.status === 'complete').length,
                openRows: openRows,
                abandoned: rows.filter(r => r.status === 'abandoned').length,
                workers: new Set(rows.map(r => r.worker_id)).size,
                // Days whose Time In was never confirmed on site. Counted
                // over the RANGE, because one unchecked day is weather and
                // fifteen in a month is a pattern.
                unchecked: rows.filter(r => !!attLocationFlag(r.timein_location_status,
                    r.timein_distance_m, r.timein_geofence_radius_m)).length,
                byWorker: attRollUpByWorker(rows),
                byProject: attRollUpByProject(rows),
            };
        }

        /** The sentence at the top: the task first when there is one. */
        function ledeText() {
            if (!rows.length) return 'Nobody was recorded on site in these days.';
            const onSite = plural(t.workers, 'worker', 'workers') + ' on site, ' + attRangeLabel(shown.from, shown.to) + '.';
            if (t.openRows.length) {
                return plural(t.openRows.length, 'day is', 'days are') + ' waiting for a time out. ' + onSite;
            }
            const tail = attAnd([
                t.complete ? plural(t.complete, 'day was', 'days were') + ' finished properly' : '',
                t.abandoned ? plural(t.abandoned, 'was', 'were') + ' closed by the office' : ''
            ]);
            return (t.daysWithHours
                    ? plural(t.workers, 'worker', 'workers') + ' recorded ' + t.totalHours + '.'
                    : plural(t.workers, 'worker', 'workers') + ' on site, with no finished day yet.') +
                ' ' + onSite + (tail ? ' ' + tail.charAt(0).toUpperCase() + tail.slice(1) + '.' : '');
        }

        function exportWorker() {
            if (!rows.length) { alert('Nothing to export for these days.'); return; }
            const csv = attToCsv(
                // "Days abandoned" is its own column, not folded into
                // "Days not closed" -- the two mean different things on
                // screen and must not merge on the way out.
                ['Worker', 'Position', 'Days worked', 'Hours', 'Days not closed', 'Days abandoned'],
                attRollUpByWorker(rows).map(function (w) {
                    return [w.name, w.position, w.daysWorked, attRollUpHours(w),
                            w.openDays, w.abandonedDays];
                })
            );
            attDownloadCsv('attendance-by-worker-' + shown.from + '-to-' + shown.to + '.csv', csv);
        }

        function exportDay() {
            if (!rows.length) { alert('Nothing to export for these days.'); return; }
            const csv = attToCsv(
                ['Work date', 'Worker', 'Position', 'Project', 'Time in', 'Time out',
                 'Hours', 'Status', 'Captured offline', 'Location check',
                 'Metres from site', 'Closed by admin', 'Reason'],
                rows.map(function (r) {
                    return [
                        r.work_date, r.worker_name, r.worker_position, r.timein_project_name,
                        attTime(r.timein_at), attTime(r.timeout_at),
                        attFormatHours(r.total_minutes), r.status,
                        // was_offline is ADMIN-facing only; the worker is
                        // never shown it (design §6.3).
                        (r.timein_was_offline || r.timeout_was_offline) ? 'yes' : 'no',
                        // The location verdict travels with the export
                        // too: the CSV is where an owner counts how often
                        // one worker's phone "had no location".
                        r.timein_location_status || '',
                        r.timein_distance_m !== null && r.timein_distance_m !== undefined
                            ? Math.round(r.timein_distance_m) : '',
                        // The trail travels with the export. A row whose
                        // hours read '—' because an admin closed it must
                        // say so in the file too, or the spreadsheet
                        // becomes the one place that cannot explain it.
                        r.abandoned_at ? attStamp(r.abandoned_at) : '',
                        r.abandoned_note || ''
                    ];
                })
            );
            attDownloadCsv('attendance-by-day-' + shown.from + '-to-' + shown.to + '.csv', csv);
        }

        // One row: presets and the two dates they rewrite. Dates apply as
        // soon as they change -- a separate Show button let the screen sit
        // showing a range other than the one in the boxes.
        // v5 pills: the three presets (the one the dates match is ticked)
        // and the two dates they rewrite.
        function toolbarHtml() {
            const preset = p => { const r = attPresetRange(p); return r.from === from && r.to === to; };
            return '<button class="sv-chip' + (preset('daily') ? ' is-on' : '') + '" type="button" data-period="daily">Just today</button>' +
                '<button class="sv-chip' + (preset('weekly') ? ' is-on' : '') + '" type="button" data-period="weekly">Last 7 days</button>' +
                '<button class="sv-chip' + (preset('monthly') ? ' is-on' : '') + '" type="button" data-period="monthly">Last 30 days</button>' +
                '<label class="sv-date" for="attFrom">From <input type="date" id="attFrom" value="' + attEsc(from) + '"></label>' +
                '<label class="sv-date" for="attTo">To <input type="date" id="attTo" value="' + attEsc(to) + '"></label>';
        }

        function wireToolbar(el) {
            el.querySelectorAll('[data-period]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const r = attPresetRange(btn.getAttribute('data-period'));
                    from = r.from; to = r.to;
                    run();
                });
            });
            // A date applies on change, after a pause: typing a date fires a
            // change per segment, and each run redraws the boxes (applyDate).
            [['#attFrom', v => { from = v; }], ['#attTo', v => { to = v; }]].forEach(function (pair) {
                const input = el.querySelector(pair[0]);
                input.addEventListener('change', function () {
                    pair[1](input.value);
                    applyDate();
                });
            });
        }

        function cardsFor(tab) {
            if (tab === 'needs') {
                return t.openRows.map(r => ({
                    id: 'o:' + r.id,
                    title: r.worker_name || '—',
                    sub: (r.timein_project_name || '—') + ' · ' + dayLabel(r.work_date),
                    meta: 'Arrived ' + attTime(r.timein_at) + ' · never timed out' + (r._closable ? '' : ' · ' + r._reason),
                    right: attTime(r.timein_at),
                    pill: { text: 'Needs a time out', tone: 'gold' },
                    nextLabel: r._closable ? 'Close this day' : '',
                }));
            }
            if (tab === 'site') {
                return t.byProject.map(p => ({
                    id: 's:' + p.project,
                    title: p.project,
                    sub: plural(p.daysWorked, 'day worked', 'days worked'),
                    right: attRollUpHours(p),
                }));
            }
            return t.byWorker.map(w => ({
                id: 'w:' + w.workerId,
                title: w.name,
                sub: w.position || '—',
                meta: plural(w.daysWorked, 'day on site', 'days on site'),
                right: attRollUpHours(w),
                // Two flags, never one total. An open day still needs the
                // admin's attention; a closed one is a decision already
                // taken, and merging them would mean resolving a record
                // changed nothing here.
                pill: w.openDays
                    ? { text: w.openDays + (w.openDays === 1 ? ' day needs' : ' days need') + ' a time out', tone: 'gold' }
                    : w.abandonedDays
                        ? { text: w.abandonedDays + (w.abandonedDays === 1 ? ' day closed' : ' days closed') + ' by the office', tone: 'red' }
                        : { text: 'Nothing', tone: 'none' },
                chips: w.openDays && w.abandonedDays
                    ? [{ text: w.abandonedDays + (w.abandonedDays === 1 ? ' day closed' : ' days closed') + ' by the office', tone: 'red' }]
                    : [],
            }));
        }

        function itemPanel(panel, id, opts) {
            const kind = id.slice(0, 2), key = id.slice(2);
            if (kind === 'o:') {
                const rec = t.openRows.find(r => String(r.id) === key);
                if (!rec) { SV.error(panel, 'This day is no longer waiting for a time out.'); return; }
                const body = SV.page(panel, { kicker: 'Waiting for a time out', title: rec.worker_name || '—',
                    pills: [{ text: 'Needs a time out', tone: 'gold' }], nextLabel: 'Next' });
                body.innerHTML =
                    SV.nextStep(rec._closable
                        ? 'Timed in but never timed out, so the day records no hours. Closing a day records no hours and changes no pay.'
                        : rec._reason,
                        rec._closable ? '<button class="att-btn att-btn--warn" type="button" data-resolve><i data-lucide="clock"></i>Close this day</button>' : '') +
                    SV.facts([['Day', attEsc(dayLabel(rec.work_date))], ['Site', attEsc(rec.timein_project_name || '—')],
                              ['Arrived', attEsc(attTime(rec.timein_at))], ['Job on site', attEsc(rec.worker_position || '—')]]) +
                    '<div class="wp-actions"><button class="att-btn" type="button" data-open-day>Open this worker’s day</button></div>';
                const resolve = body.querySelector('[data-resolve]');
                // Re-runs the whole query after a close rather than patching
                // the row: every tile, both roll-ups, the sentence and the
                // tab's own membership shift together.
                if (resolve) resolve.addEventListener('click', () => attOpenResolve(attBodyHost(), rec, run));
                body.querySelector('[data-open-day]').addEventListener('click', () =>
                    window.attendanceOpenWorker(rec.worker_id, String(rec.work_date).slice(0, 10)));
                if (opts && opts.start && resolve) resolve.click();
                attIcons();
                return;
            }
            if (kind === 's:') {
                const p = t.byProject.find(x => x.project === key);
                if (!p) { SV.error(panel, 'This site is no longer in the report.'); return; }
                const body = SV.page(panel, { kicker: 'By site · ' + attRangeLabel(shown.from, shown.to), title: p.project, nextLabel: 'Next' });
                body.innerHTML = SV.facts([['Days worked', String(p.daysWorked)], ['Hours recorded', attEsc(attRollUpHours(p))]]);
                return;
            }
            // A worker is keyed by worker_id, never by name.
            if (kind === 'w:') {
                const w = t.byWorker.find(x => String(x.workerId) === key);
                if (!w) { SV.error(panel, 'This worker is no longer in the report.'); return; }
                const body = SV.page(panel, { kicker: 'Hours report · ' + attRangeLabel(shown.from, shown.to), title: w.name, nextLabel: 'Next' });
                body.innerHTML = SV.facts([
                        ['Job on site', attEsc(w.position || '—')],
                        ['Days on site', String(w.daysWorked)],
                        ['Hours recorded', attEsc(attRollUpHours(w))],
                        ['Anything to fix', attEsc([
                            w.openDays ? w.openDays + (w.openDays === 1 ? ' day needs' : ' days need') + ' a time out' : '',
                            w.abandonedDays ? w.abandonedDays + (w.abandonedDays === 1 ? ' day closed' : ' days closed') + ' by the office' : '',
                        ].filter(Boolean).join(' · ') || 'Nothing')],
                    ]) +
                    '<p class="att-paynote"><i data-lucide="info"></i>Hours record attendance — <strong>not a basis for pay</strong>. ' +
                    'Labour is pakyaw, capped by contract.</p>';
                attIcons();
            }
        }

        function draw(o) {
            const base = {
                key: 'attReports',
                title: 'Hours report',
                sub: 'Who was on site, and for how long · ' + attRangeLabel(from, to),
                more: [{ label: 'Excel — one row per worker', icon: 'download', onClick: exportWorker },
                       { label: 'Excel — one row per day', icon: 'download', onClick: exportDay }],
                toolbar: toolbarHtml(),
                onToolbar: wireToolbar,
                search: state === 'ready'
                    ? { placeholder: 'Search a worker or a site…', value: ui.q || '', onInput: v => { ui.q = v; draw(); } }
                    : false,
                selectedId: ui.sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel, opts) => {
                    ui.sel = id;
                    // "Open this worker's day" opens the day in this pop-up.
                    if (attIsDayId(id)) { attWorkerPanel(panel, id, opts); return; }
                    itemPanel(panel, id, opts);
                },
                onClose: () => { ui.sel = null; },
            };
            if (state !== 'ready') {
                SV.render(container, Object.assign(base, {
                    tabs: [], groups: [],
                    empty: state === 'loading' ? 'Loading…'
                        : state === 'bad-range' ? 'The start date is after the end date.'
                        : state === 'error' ? 'Could not load: ' + attEsc(errorText)
                        : 'Nobody was recorded on site in these days.',
                }));
                return;
            }
            const open = t.openRows.length;
            // Red only for what the office can do now (D5): a day still
            // running cannot be closed yet, so it reads amber, as it always did.
            const closable = t.openRows.filter(r => r._closable).length;
            const allLine = 'All ' + plural(t.byWorker.length, 'worker', 'workers') + ' · ' +
                plural(rows.length, 'day', 'days') + ' · ' + t.totalHours;
            const tabs = [['needs', 'Waiting for a time out', open,
                           'These workers timed in but never timed out, ' +
                           'so the day records no hours. Closing a day tells the report to stop waiting — it does not invent hours, and it changes no pay.'],
                          ['worker', 'By worker', t.byWorker.length, 'Days on site and hours recorded for each worker. Total: ' + allLine],
                          ['site', 'By site', t.byProject.length, 'Days worked and hours recorded at each site. Total: All ' +
                           plural(t.byProject.length, 'site', 'sites') + ' · ' + plural(rows.length, 'day', 'days') + ' · ' + t.totalHours]]
                .map(([id, label, count, help]) => ({ id, label, count, help, needs: id === 'needs' && closable > 0 }));
            if (!ui.tab) ui.tab = open ? 'needs' : 'worker';
            // Rare counts ride along only when there is something to count --
            // a row of zeros is noise the eye still has to read. Not-confirmed
            // is never amber: most are a weak fix on a cheap phone.
            const notes = [
                t.unchecked ? plural(t.unchecked, 'time in', 'time ins') + ' not confirmed on site.' : '',
                t.abandoned ? plural(t.abandoned, 'day', 'days') + ' closed by the office.' : '',
            ].filter(Boolean).join(' ');
            // The search narrows the open tab's cards by worker, site or day.
            const needle = String(ui.q || '').trim().toLowerCase();
            const allCards = cardsFor(ui.tab);
            const shownCards = needle
                ? allCards.filter(c => (c.title + ' ' + (c.sub || '') + ' ' + (c.meta || '')).toLowerCase().includes(needle))
                : allCards;
            SV.render(container, Object.assign(base, {
                tiles: [
                    { n: t.totalHours, label: 'Total hours', tab: 'worker' },
                    { n: attFormatHours(t.daysWithHours ? Math.round(t.totalMinutes / t.daysWithHours) : null), label: 'Average day', tab: 'worker' },
                    { n: t.complete, label: 'Days finished', tab: 'worker' },
                    { n: open, label: 'Needs a time out', tab: 'needs', tone: closable ? 'red' : open ? 'gold' : '' },
                ],
                lede: ledeText(),
                strips: ['Hours record attendance — not a basis for pay. Labour is pakyaw, capped by contract.', notes].filter(Boolean),
                tabs: tabs,
                tab: ui.tab,
                onTab: id => { ui.tab = id; draw(); },
                showing: needle ? 'Showing ' + shownCards.length + ' of ' + allCards.length : '',
                groups: [{ title: '', rows: shownCards }],
                empty: needle ? 'Nothing matches the search.'
                    : !rows.length ? 'Nobody was recorded on site in these days.'
                    : ui.tab === 'needs' ? 'Nothing here. You’re done.' : 'Nobody was recorded on site in these days.',
            }));
        }

        async function run() {
            if (!from || !to) return;
            if (from > to) { state = 'bad-range'; draw(); return; }
            const mine = ++ticket;
            const want = { from: from, to: to };
            state = 'loading';
            draw();
            let loaded;
            try {
                loaded = await attLoadRange(want.from, want.to);
            } catch (e) {
                if (mine !== ticket) return;
                state = 'error';
                errorText = e.message || String(e);
                draw();
                return;
            }
            if (mine !== ticket) return;
            rows = loaded;
            shown = want;
            t = compute();
            // A day just closed (or closed elsewhere) leaves the tab: its pop-up
            // closes and says so, instead of showing a day that is not there.
            if (ui.sel && ui.sel.slice(0, 2) === 'o:' && !t.openRows.some(r => 'o:' + r.id === ui.sel)) {
                ui.sel = null;
                SV.closePop();
                SV.toast('Day closed by the office');
            }
            // An empty range still draws the tiles, the note and the tabs
            // (zeros), with the message in the list — v5 keeps the screen's shape.
            state = 'ready';
            draw({ refreshPanel: true });
        }

        await run();
    }

    // ── Entry points ────────────────────────────────────────────────

    let _attWorkerId = null;
    let _attWorkDate = null;
    // Office redesign v5: the Attendance screen now showing in the frame.
    let _attScreen = null;

    // One worker's day in the pop-up: the same page (attRenderWorker), through
    // the frame's page shell; its "Today on site" back link is hidden there
    // (✕ replaces it) and it redraws itself in place after Close this day.
    // Where a page's form opens. In the pop-up it goes on <body>, like every
    // other office form: the pop-up's box is hidden under an open form
    // (split-view.css), and a form inside the box would be hidden with it.
    function attFormHost(container, sel) {
        if (!container.closest('#svPop')) return container.querySelector(sel);
        return attBodyHost();
    }

    // The one <body> host every framed Attendance screen opens its forms on
    // (a screen drawn by the frame has no form host of its own).
    function attBodyHost() {
        let host = document.getElementById('attPopFormHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'attPopFormHost';
            document.body.appendChild(host);
        }
        return host;
    }

    function attWorkerPanel(panel, id, opts, onChanged) {
        const SV = window.SplitView;
        const cut = id.lastIndexOf('|');
        const body = SV.page(panel, { kicker: "One worker's day" });
        body.classList.add('att-in-pop');
        attRenderWorker(body, id.slice(0, cut), id.slice(cut + 1),
                        { start: !!(opts && opts.start), onChanged: onChanged, notes: opts && opts.notes });
    }

    /** Drill-down from the today list (and Hours report, Weekly bonus). */
    window.attendanceOpenWorker = function (workerId, workDate) {
        _attWorkerId = workerId;
        _attWorkDate = workDate || attTodayKey();
        // v5: in the pop-up of the screen it came from, when that screen is showing.
        const view = _attScreen && document.getElementById(_attScreen + 'View');
        if (view && view.style.display !== 'none' && window.SplitView && window.SplitView.open &&
            window.SplitView.open(_attScreen, workerId + '|' + _attWorkDate)) return;
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

    // startTab (office v5): which of the three tabs opens — days, location
    // or closed — so a site's Location… and Closed dates… go straight there.
    function attOpenSchedule(host, project, config, onSaved, defaultStart, startTab) {
        const system = project.project_system;
        const id = project.project_id;
        const days = (config && config.working_days) || [1, 2, 3, 4, 5];

        const startNow = (config && config.start_time_override) || '';
        const defaultLabel = defaultStart
            ? 'Company default (' + attEsc(defaultStart) + ')' : 'Company default';

        host.innerHTML =
            '<div class="att-modal" id="attSchedModal">' +
              '<div class="att-modal-box att-sched" role="dialog" aria-modal="true" ' +
                   'aria-labelledby="attSchedTitle">' +
                '<div class="att-modal-head">' +
                  '<div>' +
                    '<h3 class="att-modal-title" id="attSchedTitle">Schedule</h3>' +
                    '<p class="att-modal-sub">' + attEsc(project.project_name) + '</p>' +
                  '</div>' +
                  '<button class="att-modal-x" type="button" id="attScX" ' +
                          'aria-label="Close">&times;</button>' +
                '</div>' +
                '<div class="att-tabs" role="tablist">' +
                  '<button class="att-tab is-on" type="button" role="tab" data-tab="days">' +
                    'Working days &amp; time</button>' +
                  '<button class="att-tab" type="button" role="tab" data-tab="location">' +
                    'Location</button>' +
                  '<button class="att-tab" type="button" role="tab" data-tab="closed">' +
                    'Closed dates</button>' +
                '</div>' +
                '<form class="att-modal-form" id="attSchedForm" autocomplete="off">' +
                  '<div class="att-modal-body att-modal-body--single">' +

                    // ── Tab 1: working days & time ────────────────────
                    '<section class="att-pane" data-pane="days">' +
                      '<div class="att-info">' +
                        '<i data-lucide="calendar-check"></i>' +
                        '<div>The reward only ever counts <strong>Monday to Friday</strong>. ' +
                          'Marking Saturday here records that the site works it — it does ' +
                          'not add a sixth day to the reward.</div>' +
                      '</div>' +
                      '<div class="att-field">' +
                        '<label>Working days</label>' +
                        '<div class="att-seg att-days" id="attScDays">' +
                          ATT_DOW.map(function (d) {
                            const on = days.indexOf(d.n) !== -1;
                            return '<button class="att-seg-btn' + (on ? ' is-on' : '') +
                                   '" type="button" aria-pressed="' + (on ? 'true' : 'false') +
                                   '" data-dow="' + d.n + '">' + d.label + '</button>';
                          }).join('') +
                        '</div>' +
                        '<div class="att-presets">' +
                          '<span>Quick pick:</span>' +
                          '<button class="att-linkbtn" type="button" data-preset="1,2,3,4,5">Mon–Fri</button>' +
                          '<button class="att-linkbtn" type="button" data-preset="1,2,3,4,5,6">Mon–Sat</button>' +
                          '<button class="att-linkbtn" type="button" data-preset="1,2,3,4,5,6,7">Every day</button>' +
                        '</div>' +
                        '<div class="att-hint">A day outside this pattern is never required, ' +
                          'so it shrinks the reward week instead of failing it.</div>' +
                      '</div>' +
                      '<div class="att-field">' +
                        '<label>Workers due at</label>' +
                        '<label class="att-choice" id="attScModeDefault">' +
                          '<input type="radio" name="attScMode" value="default"' +
                            (startNow ? '' : ' checked') + '> ' + defaultLabel + '</label>' +
                        '<label class="att-choice" id="attScModeCustom">' +
                          '<input type="radio" name="attScMode" value="custom"' +
                            (startNow ? ' checked' : '') + '> Custom time for this site' +
                          '<input class="att-input" type="time" id="attScStart" ' +
                            'aria-label="Custom time" value="' + attEsc(startNow) + '"></label>' +
                        '<div class="att-hint">A Time In after this is late, and one late day ' +
                          'forfeits the whole week.</div>' +
                      '</div>' +
                      '<div class="att-sched-summary" id="attScSummary" aria-live="polite"></div>' +
                      '<div><button class="att-linkbtn" type="button" id="attScReset">' +
                        'Reset to company default</button></div>' +
                    '</section>' +

                    // ── Tab 2: location ───────────────────────────────
                    '<section class="att-pane" data-pane="location" hidden>' +
                      '<label class="att-choice att-choice--toggle">' +
                        '<input type="checkbox" id="attScFenceOn" checked> ' +
                        'Check attendance against this location</label>' +
                      '<div class="att-info">' +
                        '<i data-lucide="map-pin"></i>' +
                        '<div>A worker standing outside the radius is refused; one whose phone ' +
                          'cannot get a clear fix is <strong>recorded and flagged</strong>, ' +
                          'never refused.</div>' +
                      '</div>' +
                      '<div class="att-fence-grid">' +
                        '<div class="att-field">' +
                          '<label for="attScLat">Latitude</label>' +
                          '<input class="att-input" type="number" step="any" id="attScLat" ' +
                                 'placeholder="14.6788638"></div>' +
                        '<div class="att-field">' +
                          '<label for="attScLng">Longitude</label>' +
                          '<input class="att-input" type="number" step="any" id="attScLng" ' +
                                 'placeholder="121.018953"></div>' +
                        '<div class="att-field">' +
                          '<label for="attScRadius">Radius (metres)</label>' +
                          '<input class="att-input" type="number" id="attScRadius" ' +
                                 'min="10" max="5000" placeholder="150" value="150"></div>' +
                      '</div>' +
                      '<div class="att-hint">Radius runs 10 to 5000 m. 150 m suits most sites.</div>' +
                      '<div class="att-actions-row">' +
                        '<button class="att-btn" type="button" id="attScHere">' +
                          '<i data-lucide="crosshair"></i>Use my location</button>' +
                        '<button class="att-btn att-btn--primary" type="button" ' +
                                'id="attScSaveFence">Save location</button>' +
                      '</div>' +
                      '<div class="att-hint" id="attScFenceNow"></div>' +
                      '<div class="att-hint">Editing appends a new location rather than ' +
                        'replacing the old one, so attendance already recorded keeps ' +
                        'being judged against the location that was in force when it ' +
                        'was captured.</div>' +
                    '</section>' +

                    // ── Tab 3: closed dates ───────────────────────────
                    '<section class="att-pane" data-pane="closed" hidden>' +
                      '<div class="att-field">' +
                        '<label for="attScClosed">Add a closed date</label>' +
                        '<div class="att-actions-row">' +
                          '<input class="att-input att-input--auto" type="date" id="attScClosed">' +
                          '<input class="att-input att-input--grow" type="text" id="attScReason" ' +
                                 'maxlength="120" placeholder="Reason, e.g. Independence Day">' +
                          '<button class="att-btn" type="button" id="attScAdd">Add</button>' +
                        '</div>' +
                        '<div class="att-hint">A closed day is not required of anyone posted ' +
                          'here, so the week shrinks and four on-time days out of four still ' +
                          'earn the full reward.</div>' +
                      '</div>' +
                      '<div id="attScList"></div>' +
                    '</section>' +

                    '<div class="att-err att-err--general att-span" id="attScGeneral"></div>' +
                  '</div>' +
                  '<div class="att-modal-foot">' +
                    '<span class="att-foot-note" id="attScFootNote"></span>' +
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
            // A row with no coordinates is "no location set", not 0, 0 at
            // a radius of 0 m -- which is what Number(null) would paint.
            if (!g || g.latitude == null || g.longitude == null) {
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
            host.querySelector('#attScRadius').value = Number(g.radius_m) || 150;
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

        // ── Working days & time: state, summary, unsaved changes ──
        const dayBtns = host.querySelectorAll('#attScDays [data-dow]');
        const startEl = host.querySelector('#attScStart');
        const saveBtn = host.querySelector('#attScSave');
        const summaryEl = host.querySelector('#attScSummary');
        const modeEls = host.querySelectorAll('input[name="attScMode"]');

        function chosenDays() {
            return Array.prototype.slice.call(dayBtns)
                .filter(function (b) { return b.classList.contains('is-on'); })
                .map(function (b) { return Number(b.getAttribute('data-dow')); })
                .sort();
        }
        function customMode() {
            return host.querySelector('input[name="attScMode"]:checked').value === 'custom';
        }
        function scheduleSnapshot() {
            return chosenDays().join(',') + '|' + (customMode() ? startEl.value : '');
        }
        const startSnapshot = scheduleSnapshot();

        function refreshSchedule() {
            const custom = customMode();
            startEl.disabled = !custom;
            host.querySelector('#attScModeDefault').classList.toggle('is-on', !custom);
            host.querySelector('#attScModeCustom').classList.toggle('is-on', custom);

            const chosen = chosenDays();
            const counted = chosen.filter(function (n) { return n <= 5; }).length;
            const time = custom ? (attClock(startEl.value) || null) : (defaultStart || null);
            summaryEl.innerHTML = !chosen.length
                ? 'Pick at least one working day.'
                : '<strong>' + attEsc(attWorkingDaysLabel(chosen)) + '</strong>' +
                  (time ? ', workers due by <strong>' + attEsc(time) + '</strong>' +
                          (custom ? '' : ' (company default)')
                        : custom ? ', pick a time' : '') + '. ' +
                  (counted
                      ? counted + (counted === 1 ? ' day counts' : ' days count') +
                        ' towards the weekly bonus.'
                      : 'None of these days count towards the weekly bonus.');

            // A site that has never been configured can still be saved
            // as-is (that is how it stops reading "not changed yet");
            // one that has a config only needs saving when it changed.
            saveBtn.disabled = !!config && scheduleSnapshot() === startSnapshot;
        }

        host.querySelector('#attScDays').addEventListener('click', function (ev) {
            const btn = ev.target.closest('[data-dow]');
            if (!btn) return;
            btn.classList.toggle('is-on');
            btn.setAttribute('aria-pressed', btn.classList.contains('is-on') ? 'true' : 'false');
            refreshSchedule();
        });

        function setDays(list) {
            dayBtns.forEach(function (b) {
                const on = list.indexOf(Number(b.getAttribute('data-dow'))) !== -1;
                b.classList.toggle('is-on', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        }
        host.querySelectorAll('[data-preset]').forEach(function (b) {
            b.addEventListener('click', function () {
                setDays(b.getAttribute('data-preset').split(',').map(Number));
                refreshSchedule();
            });
        });
        host.querySelector('#attScReset').addEventListener('click', function () {
            setDays([1, 2, 3, 4, 5]);
            host.querySelector('input[name="attScMode"][value="default"]').checked = true;
            refreshSchedule();
        });
        modeEls.forEach(function (r) {
            r.addEventListener('change', function () {
                refreshSchedule();
                if (customMode() && !startEl.value) startEl.focus();
            });
        });
        startEl.addEventListener('input', refreshSchedule);

        // ── Tabs ──────────────────────────────────────────────────
        const footNote = host.querySelector('#attScFootNote');
        const TAB_NOTES = {
            days: '',
            location: 'This tab saves with its own Save location button.',
            closed: 'Closed dates save as soon as you add them.'
        };
        function showTab(name) {
            host.querySelectorAll('[data-tab]').forEach(function (t) {
                const on = t.getAttribute('data-tab') === name;
                t.classList.toggle('is-on', on);
                t.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            host.querySelectorAll('[data-pane]').forEach(function (pane) {
                pane.hidden = pane.getAttribute('data-pane') !== name;
            });
            // The footer Save belongs to the first tab only; the other two
            // save themselves, so a second "Save" here would lie about
            // what it covers.
            saveBtn.style.display = name === 'days' ? '' : 'none';
            footNote.textContent = TAB_NOTES[name] || '';
            general.style.display = 'none';
        }
        host.querySelectorAll('[data-tab]').forEach(function (t) {
            t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
        });
        showTab(startTab || 'days');
        refreshSchedule();

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

        function closeGuarded() {
            if (scheduleSnapshot() !== startSnapshot && config &&
                    !confirm('Discard the changes to working days and time?')) {
                return;
            }
            close();
        }
        host.querySelector('#attScX').addEventListener('click', closeGuarded);
        host.querySelector('#attScCancel').addEventListener('click', closeGuarded);

        host.querySelector('#attSchedForm').addEventListener('submit', async function (ev) {
            ev.preventDefault();
            // Enter in a Location or Closed-dates field must not quietly
            // save working days the admin is not looking at.
            if (host.querySelector('[data-pane="days"]').hidden) return;
            general.style.display = 'none';
            const btn = host.querySelector('#attScSave');
            btn.disabled = true;

            const chosen = chosenDays();

            if (!chosen.length) {
                btn.disabled = false;
                fail('A project has to work at least one day.');
                return;
            }

            // "Company default" saves no override at all (null), which is
            // what the old empty box meant.
            const start = customMode() ? startEl.value : '';
            if (customMode() && !start) {
                btn.disabled = false;
                fail('Pick a time, or choose the company default.');
                return;
            }

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

    /**
     * A week that has not been frozen yet, worked out live.
     *
     * Before this, the page showed ONLY frozen rows, so the week in
     * progress -- the one with real Time Ins in it -- read "Nothing has
     * been worked out" until Monday noon after it ended.
     *
     * Reads through attendance_reward_progress (0066), the SAME day
     * breakdown the freeze uses, so what shows here mid-week is what the
     * frozen row will say. Writes nothing. The roster matches the
     * evaluator's: active worker / teamLeader profiles (RLS scopes the
     * tenant). Rows carry `_live: true` and no `id`, so nothing can be
     * marked as handed over before the week is final.
     */
    async function attLoadLiveWeek(weekStart) {
        const sb = window.sbClient;
        const { data: workers, error } = await sb.from('profiles')
            .select('id,display_name,email,position,status,role')
            .in('role', ATT_WORKER_ROLES);
        if (error) throw error;

        const roster = (workers || []).filter(w => (w.status || 'active') === 'active');
        const todayKey = attTodayKey();

        const rows = await Promise.all(roster.map(async w => {
            const res = await sb.rpc('attendance_reward_progress', {
                p_worker: w.id,
                p_week_start: weekStart
            });
            if (res.error) throw res.error;
            const s = attRewardSummary(res.data || [], todayKey);
            return {
                _live: true,
                _days: res.data || [],
                worker_id: w.id,
                worker_name: attWorkerName(w),
                worker_position: w.position || '',
                week_start: weekStart,
                week_end: attWeekEndOf(weekStart),
                required_days: s.requiredDays,
                completed_days: s.completedDays,
                on_time_days: s.onTimeDays,
                late_days: s.lateDays,
                missing_days: s.missingDays,
                unverified_days: s.unverifiedDays,
                pending_days: s.pendingDays,
                status: s.status,
                amount: 0,
                paid: false
            };
        }));
        return rows.sort((a, b) => String(a.worker_name).localeCompare(String(b.worker_name)));
    }

    async function attLoadRewards(weekStart) {
        const { data, error } = await window.sbClient
            .from('attendance_weekly_rewards')
            .select('id,worker_id,worker_name,worker_position,week_start,week_end,' +
                    'required_days,completed_days,on_time_days,late_days,missing_days,' +
                    'unverified_days,status,amount,paid,paid_at')
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

    /**
     * "Helper (Marc Kelley)" -> the trade and the supervisor it names.
     * There is no supervisor column on a profile; the position text is
     * where the office already writes it down.
     */
    function attSplitPosition(position) {
        const text = String(position || '').trim();
        const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(text);
        return m ? { trade: m[1].trim() || '—', supervisor: m[2].trim() }
                 : { trade: text || '—', supervisor: '' };
    }

    /**
     * Which group a worker sits in on the Weekly bonus page.
     *
     * One late, missed or unverified day forfeits the week, so "at risk"
     * can only mean one thing here: the week is still running and the
     * ONLY problem is an unverified day -- the one case that can still
     * clear, because an offline record may yet arrive and vouch for it.
     */
    function attBonusGroup(r) {
        const n = v => Number(v) || 0;
        if (r._live && n(r.unverified_days) > 0 &&
            !n(r.late_days) && !n(r.missing_days)) return 'risk';
        return r.status === 'disqualified' ? 'no' : 'on';
    }

    /**
     * The five Mon-Fri cells for one worker, from the per-day rows. The
     * rule for "missed" is attRewardSummary's own: a day is only pending
     * once it is LATER than today, so the cells and the status never
     * disagree.
     */
    function attBonusDayCells(days, weekStart, todayKey) {
        const byDate = new Map((days || []).map(d => [String(d.work_date).slice(0, 10), d]));
        const out = [];
        for (let i = 0; i < 5; i++) {
            const date = attKeyFromDayNum(attDayNum(weekStart) + i);
            const d = byDate.get(date);
            let tone;
            if (!d) tone = 'unknown';
            else if (!d.required) tone = 'off';
            else if (d.day_status === 'on_time') tone = 'ok';
            else if (d.day_status === 'late') tone = 'late';
            else if (d.day_status === 'unverified') tone = 'unv';
            else if (date > todayKey) tone = 'pending';
            else tone = 'missed';
            out.push({ date: date, tone: tone });
        }
        return out;
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
        const SV = window.SplitView;
        _attScreen = 'attRewards';
        const thisMonday = attWeekStartOf(attTodayKey());
        // Open on the CURRENT week. It used to land on the week just gone
        // because an unfrozen week drew an empty table; attLoadLiveWeek
        // now shows it as it stands, so today's week is the useful one.
        let week = thisMonday;
        const hideMoney = attIsStaff();
        let rows = [];
        let config = null;
        // The time in / out and site behind each day's dot.
        let recs = new Map();

        // Filters. Search, trade and supervisor narrow WHO is listed; the
        // tabs (groups) and the Day filter narrow by outcome. They combine.
        let q = '', trade = '', sup = '';
        let groupF = null;    // on | risk | no | owed | all (null: the default tab)
        let dayF = 'all';     // all | ontime | late | missed | unv
        let sel = null;
        let state = 'loading';
        let errorText = '';
        let ticket = 0;
        // The week box applies after a pause (a typed date fires `change` per
        // segment, and each run redraws the box).
        const applyDate = attDateDebounce(v => { week = v || attTodayKey(); run(); }, 800);

        const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const SVG = {
            ok:     '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
            late:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.3"/></svg>',
            missed: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
            unv:    '?'
        };
        const TONE_WORD = {
            ok: 'On time', late: 'Late', missed: 'Missed',
            unv: 'Could not be verified', pending: 'Not yet',
            off: 'Not a working day', unknown: ''
        };

        function weekLine() {
            const end = attWeekEndOf(week);
            const pretty = key => {
                const [y, m, d] = String(key).split('-').map(Number);
                return new Date(y, m - 1, d).toLocaleDateString('en-PH',
                    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            };
            return pretty(week) + ' to ' + pretty(end);
        }

        /** Per-day rows for every worker, and the records behind the dots. */
        async function loadDetail() {
            const sb = window.sbClient;
            recs = new Map();
            try {
                await Promise.all(rows.map(async r => {
                    if (r._days) return;
                    const res = await sb.rpc('attendance_reward_progress',
                        { p_worker: r.worker_id, p_week_start: week });
                    r._days = res.error ? [] : (res.data || []);
                }));
            } catch (e) { console.error('att A8: day detail', e); }
            try {
                const res = await sb.from('attendance_records')
                    .select('worker_id,work_date,timein_at,timeout_at,timein_project_name')
                    .gte('work_date', week).lte('work_date', attWeekEndOf(week));
                (res.data || []).forEach(x =>
                    recs.set(x.worker_id + '|' + String(x.work_date).slice(0, 10), x));
            } catch (e) { console.error('att A8: records', e); }

            const today = attTodayKey();
            rows.forEach(r => {
                const sp = attSplitPosition(r.worker_position);
                r._trade = sp.trade;
                r._sup = sp.supervisor;
                r._cells = attBonusDayCells(r._days, week, today);
                r._group = attBonusGroup(r);
            });
        }

        const hasTone = (r, t) => r._cells.some(c => c.tone === t);

        /** Does this worker pass the Day filter? */
        function inDayFilter(r) {
            switch (dayF) {
                case 'ontime': return hasTone(r, 'ok') && !hasTone(r, 'late') &&
                                      !hasTone(r, 'missed') && !hasTone(r, 'unv');
                case 'late':   return hasTone(r, 'late');
                case 'missed': return hasTone(r, 'missed');
                case 'unv':    return hasTone(r, 'unv');
                default:       return true;
            }
        }

        function inGroup(r, key) {
            if (key === 'all') return true;
            if (key === 'owed') return !r._live && r.status === 'qualified' && !r.paid;
            return r._group === key;
        }

        function passes(r) {
            if (trade && r._trade !== trade) return false;
            if (sup && r._sup !== sup) return false;
            const needle = q.trim().toLowerCase();
            if (needle && ![r.worker_name, r.worker_position]
                    .some(v => String(v || '').toLowerCase().includes(needle))) return false;
            return inDayFilter(r);
        }

        /** The status, as the old Status column said it. */
        function statusPill(r) {
            const n = v => Number(v) || 0;
            if (r._group === 'on') return { text: r._live ? 'On track' : 'Earned', tone: 'done' };
            if (r._group === 'risk') {
                return { text: n(r.unverified_days) + (n(r.unverified_days) === 1 ? ' day' : ' days') + ' to verify', tone: 'gold' };
            }
            const parts = [];
            if (n(r.late_days)) parts.push(n(r.late_days) + ' late');
            if (n(r.missing_days)) parts.push('Missed ' + n(r.missing_days) + (n(r.missing_days) === 1 ? ' day' : ' days'));
            if (n(r.unverified_days)) parts.push(n(r.unverified_days) + ' unverified');
            return parts.length ? { text: parts.join(', '), tone: 'red' } : { text: 'No day required', tone: 'none' };
        }

        function reasonText(r) {
            return (r._live && r.status === 'disqualified' ? 'So far: ' : '') + attBonusReason(r);
        }

        function amountText(r) {
            if (r._live) {
                const potential = Number(config && config.reward_amount) || 500;
                return r._group === 'on' ? attPeso(potential)
                     : r._group === 'risk' ? attPeso(potential) + '?'
                     : '—';
            }
            return r.status === 'qualified' ? attPeso(r.amount) : '—';
        }

        const canHandOver = r => !r._live && !!r.id && r.status === 'qualified';

        async function togglePaid(row, btn) {
            // The full disclaimer lives here, where it matters --
            // everywhere else it is a one-line note.
            if (!row.paid && !window.confirm(
                    'Mark ' + (row.worker_name || 'this worker') + '\u2019s bonus as ' +
                    'handed over?\n\nThis page only keeps a record. No money moves, ' +
                    'and nothing here touches payroll or a contract.')) return;
            btn.disabled = true;
            try {
                const res = await window.sbClient.rpc('attendance_reward_mark_paid', {
                    p_reward_id: row.id,
                    p_paid: !row.paid
                });
                if (res.error) throw res.error;
                const updated = Array.isArray(res.data) ? res.data[0] : res.data;
                row.paid = updated ? updated.paid : !row.paid;
                SV.toast(row.paid ? 'Marked as handed over' : 'Marked as not handed over yet');
                draw({ refreshPanel: true });
            } catch (e) {
                console.error('att A8: mark paid', e);
                btn.disabled = false;
                alert('Could not update: ' + (e.message || e));
            }
        }

        /** One day of the week in the pop-up; a day with a record opens it. */
        function dayHtml(r, c, idx) {
            const rec = recs.get(r.worker_id + '|' + c.date);
            const [y, m, d] = c.date.split('-').map(Number);
            const label = new Date(y, m - 1, d).toLocaleDateString('en-PH',
                { weekday: 'short', day: 'numeric', month: 'short' });
            let tip = label + (TONE_WORD[c.tone] ? ' · ' + TONE_WORD[c.tone] : '');
            if (rec) {
                tip += ' · In ' + attTime(rec.timein_at);
                if (rec.timeout_at) tip += ' · Out ' + attTime(rec.timeout_at);
                if (rec.timein_project_name) tip += ' · ' + rec.timein_project_name;
            }
            const glyph = SVG[c.tone] || '';
            const cls = 'att-day att-day--' + c.tone;
            const inner = rec
                ? '<button type="button" class="' + cls + '" data-open="' + attEsc(r.worker_id) +
                  '" data-date="' + attEsc(c.date) + '" title="' + attEsc(tip) +
                  '" aria-label="' + attEsc(tip) + '">' + glyph + '</button>'
                : '<span class="' + cls + '" title="' + attEsc(tip) + '" aria-label="' +
                  attEsc(tip) + '">' + glyph + '</span>';
            return '<div class="att-rw-pday"><div class="att-rw-dayth">' + DAY_NAMES[idx] + '</div>' + inner +
                   '<div class="att-meta">' + attEsc(TONE_WORD[c.tone] || '—') + '</div></div>';
        }

        function bonusPanel(panel, id, opts) {
            const r = rows.find(x => x.worker_id === id);
            if (!r) { SV.error(panel, 'This worker is no longer listed for this week.'); return; }
            const live = r._live;
            const pill = statusPill(r);
            const body = SV.page(panel, {
                kicker: 'Weekly bonus · week of ' + (() => {
                    const [y, m, d] = week.split('-').map(Number);
                    return new Date(y, m - 1, d).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' });
                })() + (live ? ' (not final yet)' : ' (final)'),
                title: r.worker_name || '—',
                pills: [pill],
                nextLabel: 'Next worker',
            });
            const owed = canHandOver(r) && !r.paid;
            body.innerHTML =
                (owed ? SV.nextStep('This bonus has not been handed over yet. This page only keeps a record. No money moves, ' +
                        'and nothing here touches payroll or a contract.',
                        '<button class="att-btn att-btn--primary" type="button" data-paid>Mark as handed over</button>') : '') +
                '<div class="sv-panel-sub">' + attEsc(r._trade + (r._sup ? ' · ' + r._sup : '')) + '</div>' +
                SV.section('Monday to Friday', '<div class="att-rw-pdays">' + r._cells.map((c, i) => dayHtml(r, c, i)).join('') + '</div>') +
                SV.facts([
                        ['Status', attEsc(pill.text)],
                        ['Why', attEsc(reasonText(r))],
                    ].concat(hideMoney ? [] : [['Amount', attEsc(amountText(r))]])
                     .concat(live ? [] : [['Handed over', canHandOver(r) ? (r.paid ? 'Handed over' : 'Not yet') : '—']])) +
                '<p class="att-paynote"><i data-lucide="info"></i>Record only, no payments — This page keeps a record, it does ' +
                  'not pay anyone. No money moves, and nothing here touches payroll or a contract.</p>' +
                (canHandOver(r) && r.paid ? '<div class="wp-actions"><button class="att-btn" type="button" data-paid>Handed over</button></div>' : '');
            body.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () =>
                window.attendanceOpenWorker(btn.getAttribute('data-open'), btn.getAttribute('data-date'))));
            const paid = body.querySelector('[data-paid]');
            if (paid) paid.addEventListener('click', () => togglePaid(r, paid));
            if (opts && opts.start && paid && owed) paid.click();
            attIcons();
        }

        function draw(o) {
            const live = rows.some(r => r._live);
            const base = {
                key: 'attRewards',
                title: 'Weekly bonus',
                sub: weekLine() + ' · Record only, no payments',
                // Staff never see the amounts on screen, so they must not be
                // able to fetch them in a file either.
                more: hideMoney ? [] : [{ label: 'Download the list', icon: 'download', onClick: downloadList }],
                toolbar:
                    '<button class="sv-chip" type="button" data-rw-prev><i data-lucide="chevron-left"></i>Week before</button>' +
                    '<label class="sv-date">Week of <input type="date" data-rw-week value="' + attEsc(week) + '"></label>' +
                    '<button class="sv-chip" type="button" data-rw-next>Week after<i data-lucide="chevron-right"></i></button>',
                onToolbar: el => {
                    el.querySelector('[data-rw-prev]').addEventListener('click', () => { week = attKeyFromDayNum(attDayNum(week) - 7); run(); });
                    el.querySelector('[data-rw-next]').addEventListener('click', () => { week = attKeyFromDayNum(attDayNum(week) + 7); run(); });
                    el.querySelector('[data-rw-week]').addEventListener('change', e => applyDate(e.target.value));
                    const t = el.querySelector('[data-rw-trade]');
                    if (t) t.addEventListener('change', () => { trade = t.value; draw(); });
                    const s = el.querySelector('[data-rw-sup]');
                    if (s) s.addEventListener('change', () => { sup = s.value; draw(); });
                    const d = el.querySelector('[data-rw-day]');
                    if (d) d.addEventListener('change', () => { dayF = d.value; draw(); });
                },
                selectedId: sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel, opts) => {
                    sel = id;
                    // A day with a record opens that worker's day in this pop-up.
                    if (attIsDayId(id)) { attWorkerPanel(panel, id, opts); return; }
                    bonusPanel(panel, id, opts);
                },
                onClose: () => { sel = null; },
            };
            if (state !== 'ready') {
                SV.render(container, Object.assign(base, {
                    search: false, tabs: [], groups: [],
                    empty: state === 'loading' ? 'Loading…'
                        : state === 'error' ? 'Could not load: ' + attEsc(errorText)
                        : 'Nothing has been worked out for this week yet. ' +
                          'A week is frozen once it has ended and its grace period has passed, so attendance captured offline has time to arrive first.',
                }));
                return;
            }

            // A live week is a forecast of the frozen one, never a result:
            // nobody has "earned" anything and nothing can be handed over.
            const t = attRewardTotals(rows);
            let lede;
            if (live) {
                const onTrack = rows.filter(r => r.status !== 'disqualified').length;
                const finalAt = attKeyFromDayNum(attDayNum(week) + 7);
                const [fy, fm, fd] = finalAt.split('-').map(Number);
                const finalLabel = new Date(fy, fm - 1, fd).toLocaleDateString('en-PH',
                    { weekday: 'long', month: 'long', day: 'numeric' });
                lede = `${onTrack} of ${t.workers} ` +
                    `${t.workers === 1 ? 'worker is' : 'workers are'} still on track for the bonus. ` +
                    'This week is not final yet — these are the numbers so far. ' +
                    'It becomes final around noon on ' + finalLabel +
                    ', once late offline records have had time to arrive.';
            } else {
                // Nobody qualified: "₱0 in total. All of it has been handed
                // over." read as if something had been paid.
                const money = `${attPeso(t.totalAmount)} in total.` +
                    (t.unpaidAmount > 0
                        ? ` ${attPeso(t.unpaidAmount)} of it has not been handed out yet.`
                        : ' All of it has been handed over.');
                lede = `${t.qualified} of ${t.workers} ` +
                    `${t.workers === 1 ? 'worker' : 'workers'} earned the bonus this week. ` +
                    (!t.qualified
                        ? 'Nobody earned it this week, so nothing is owed.'
                        : hideMoney
                        ? (t.unpaid
                            ? `${t.unpaid} of them ${t.unpaid === 1 ? 'has' : 'have'} not been handed the bonus yet.`
                            : 'Every bonus earned has been handed over.')
                        : money);
            }

            const countGroup = key => rows.filter(r => inGroup(r, key)).length;
            const potential = Number(config && config.reward_amount) || 500;
            const tabs = (live
                ? [['on', 'On track', 'On time every expected day so far.'],
                   ['risk', 'At risk', 'A day could not be verified yet — an offline record may still arrive and vouch for it.'],
                   ['no', 'No bonus', 'One late, missed or unverified day forfeits the week.'],
                   ['all', 'Everyone', '']]
                : [['owed', 'Not handed over yet', 'Earned the bonus; the office has not recorded handing it over.'],
                   ['on', 'Earned', 'On time every expected day.'],
                   ['no', 'No bonus', 'One late, missed or unverified day forfeits the week.'],
                   ['all', 'Everyone', '']])
                .map(([id, label, help]) => ({ id, label, help, count: countGroup(id), needs: id === 'owed' }));
            if (!groupF || !tabs.some(x => x.id === groupF)) groupF = SV.pickDefaultTab(tabs, null);

            const uniq = f => [...new Set(rows.map(f).filter(Boolean))].sort();
            const opts = (list, cur, all) =>
                '<option value="">' + all + '</option>' +
                list.map(v => '<option value="' + attEsc(v) + '"' +
                              (v === cur ? ' selected' : '') + '>' + attEsc(v) + '</option>').join('');
            const dayOpts = [['all', 'Day: Everyone'], ['ontime', 'All on time'],
                             ['late', 'Late'], ['missed', 'Missed'], ['unv', 'Unverified']]
                .map(c => {
                    const save = dayF; dayF = c[0];
                    const n = rows.filter(inDayFilter).length;
                    dayF = save;
                    return '<option value="' + c[0] + '"' + (dayF === c[0] ? ' selected' : '') + '>' +
                           attEsc(c[1]) + ' (' + n + ')</option>';
                }).join('');

            const shown = rows.filter(r => inGroup(r, groupF) && passes(r));
            const name = (x, y) => String(x.worker_name).localeCompare(String(y.worker_name));
            const card = r => ({
                id: r.worker_id,
                title: r.worker_name || '—',
                sub: r._trade + (r._sup ? ' · ' + r._sup : ''),
                meta: reasonText(r),
                dots: attBonusDots(r._cells),
                pill: statusPill(r),
                right: hideMoney ? '' : amountText(r),
                nextLabel: canHandOver(r) && !r.paid ? 'Mark as handed over' : '',
            });
            // Everyone: the groups the old table drew (risk / on track / no
            // bonus, or earned / no bonus); every other tab is one list.
            const groups = groupF === 'all'
                ? (live ? [['risk', 'At risk'], ['on', 'On track'], ['no', 'No bonus']]
                        : [['on', 'Earned'], ['no', 'No bonus']])
                    .map(([key, label]) => ({ title: label, rows: shown.filter(r => r._group === key).sort(name).map(card) }))
                : [{ title: '', rows: shown.slice().sort(name).map(card) }];

            SV.render(container, Object.assign(base, {
                toolbar: base.toolbar +
                    '<select class="sv-select" data-rw-trade aria-label="Filter by trade">' +
                      opts(uniq(r => r._trade), trade, 'All trades') + '</select>' +
                    '<select class="sv-select" data-rw-sup aria-label="Filter by supervisor">' +
                      opts(uniq(r => r._sup), sup, 'All supervisors') + '</select>' +
                    '<select class="sv-select" data-rw-day aria-label="Filter by day">' + dayOpts + '</select>',
                tiles: (live
                    ? [{ n: countGroup('on'), label: 'On track', tab: 'on', tone: countGroup('on') ? 'green' : '' },
                       { n: countGroup('risk'), label: 'At risk', tab: 'risk', tone: countGroup('risk') ? 'gold' : '' },
                       { n: countGroup('no'), label: 'No bonus', tab: 'no', tone: countGroup('no') ? 'red' : '' }]
                    : [{ n: countGroup('on'), label: 'Earned', tab: 'on', tone: countGroup('on') ? 'green' : '' },
                       { n: countGroup('no'), label: 'No bonus', tab: 'no', tone: countGroup('no') ? 'red' : '' },
                       { n: countGroup('owed'), label: 'Not handed over yet', tab: 'owed', tone: countGroup('owed') ? 'gold' : '' }])
                    .concat(hideMoney ? [] : [{ n: attPeso(live ? countGroup('on') * potential : t.totalAmount),
                                                label: live ? 'Bonus if all hold' : 'Total bonus', tab: 'all' }]),
                lede: lede,
                legend: [{ tone: 'o', label: 'On time' }, { tone: 'l', label: 'Late' }, { tone: 'm', label: 'Missed' },
                         { tone: 'u', label: 'Unverified' }, { tone: 't', label: 'Today / upcoming' }],
                strips: ['Record only, no payments — This page keeps a record, it does not pay anyone. No money moves, ' +
                         'and nothing here touches payroll or a contract.'],
                tabs: tabs,
                tab: groupF,
                onTab: id => { groupF = id; draw(); },
                search: { placeholder: 'Search worker…', value: q, onInput: v => { q = v; draw(); } },
                showing: (q.trim() || trade || sup || dayF !== 'all')
                    ? 'Showing ' + shown.length + ' of ' + rows.filter(r => inGroup(r, groupF)).length : '',
                groups: groups,
                empty: 'No worker matches these filters.',
            }));
        }

        function downloadList() {
            if (!rows.length) return;
            // The list is what payroll works from. A week still
            // running would hand it numbers that can still change.
            if (rows.some(r => r._live)) {
                alert('This week is not final yet, so there is no list to download. ' +
                      'It can be downloaded once the week has been worked out.');
                return;
            }
            attDownloadCsv('weekly-reward-' + week + '.csv', attRewardCsv(rows));
        }

        async function run() {
            const mine = ++ticket;
            week = attWeekStartOf(week || attTodayKey());
            groupF = null; dayF = 'all'; sel = null;
            state = 'loading';
            draw();
            let got;
            try {
                if (!config) config = await attLoadRewardConfig();
                await attRunDueEvaluations(config && config.evaluation_grace_hours);
                got = await attLoadRewards(week);
                // Not frozen yet, and not in the future: show it live
                // rather than an empty page over a week with real Time Ins.
                if (!got.length && week <= thisMonday) {
                    got = await attLoadLiveWeek(week);
                }
                if (mine !== ticket) return;
                rows = got;
                await loadDetail();
            } catch (e) {
                if (mine !== ticket) return;
                console.error('att A8: load', e);
                state = 'error';
                errorText = e.message || String(e);
                draw();
                return;
            }
            if (mine !== ticket) return;
            state = rows.length ? 'ready' : 'empty';
            draw();
        }

        await run();
    }

    /**
     * Called by switchView for every ATT_VIEWS view, matching the house
     * pattern (initPMModule, initQuotationModule, …).
     */
    window.initAttendanceModule = function (view) {
        if (view === 'attToday') {
            // Office v5 cards: the screen draws its own frame (attRenderToday).
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
            // Office v5 cards: the screen draws its own frame.
            if (el) attRenderWorkers(el);
            return;
        }
        if (view === 'attProjects') {
            const el = document.getElementById('attProjectsView');
            // Office v5 cards: the screen draws its own frame.
            if (el) attRenderProjects(el);
            return;
        }
        if (view === 'attReports') {
            const el = document.getElementById('attReportsView');
            // Office v5 cards: the screen draws its own frame.
            if (el) attRenderReports(el);
            return;
        }
        if (view === 'attRewards') {
            const el = document.getElementById('attRewardsView');
            // Office v5 cards: the screen draws its own frame.
            if (el) attRenderRewards(el);
        }
    };
})();