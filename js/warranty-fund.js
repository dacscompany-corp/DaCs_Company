/* ══════════════════════════════════════════════════════════════════
   WARRANTY RETENTION REGISTER + FUND — Project Management  (migration 0043)

   When a construction project is closed out as COMPLETED, the warranty
   retention figure the Overview KPI has always shown is frozen into
   `warranty_retentions`. Those rows accumulate into a fund, and draws
   against the fund are recorded in `warranty_fund_expenses`.

   ── WHAT THIS IS ────────────────────────────────────────────────────
   An INTERNAL COMPANY RESERVE, by design. On completion the company sets
   aside 5% of the project's remaining cash to fund warranty work, future
   company expenses and project management. js/pm-admin.js computes
       netCash   = totalPaid - directCost
       retention = netCash * 5%
   Client billing is deliberately not involved: this is the company
   reserving part of its own margin, not money withheld from anyone. The
   reserve is TRACKED here but the pesos stay with normal company funds —
   there is no separate account, so the fund total is a running reserve
   balance rather than a cash balance. Every screen says so; keep it.

   netCash goes NEGATIVE when direct costs outran client payments. The raw
   signed figure is kept in `retentionAmount` for the record, but only the
   clamped `contributedAmount` (max(0, …)) is ever summed into the fund.

   ── ISOLATION (the whole point of the module) ───────────────────────
   This file WRITES exactly TWO tables, both its own:
     · `warrantyRetentions`
     · `warrantyFundExpenses`
   It READS `constructionProjects` (to find completed jobs missing from the
   register) and, through window.trComputeCloseout, that project's
   `weeklyBills` + `paymentRequests` — the same read the closeout already
   does, reused rather than reimplemented so the two can't drift.
   Those reads value a project; they never write to it.

   It creates NO invoice, NO payment_request, NO expense, NO payroll row
   and NO journal entry. Nothing here feeds Labor / Material / Overhead /
   Spent / Earned / Profit — the money invariants in CLAUDE.md never see
   this data. A fund draw does NOT charge any project's Spent: it has no
   job to charge, and company overhead is never charged to a job.
   If a future change makes another module read these tables, they stop
   being a register: revisit the isolation rule (CLAUDE.md,
   docs/ARCHITECTURE.md §4) before writing that code.

   Owner-only. RLS is `owner_id = auth.uid()` (staff excluded, like
   reimbursements), and admin.html blocks the view for staff as well —
   every column here is a peso amount or the context for one.
══════════════════════════════════════════════════════════════════ */

'use strict';

(function () {

    // ── Canonical constants ────────────────────────────────────────
    // js/termination-requests.js reads these through window.WF_CONST so the
    // closeout dialog can never quote a different rate than the register
    // stores. `pct` mirrors the hard-coded 5% in js/pm-admin.js — if that
    // ever becomes configurable, this is the one place to change.
    const WF_CONST = { pct: 5, months: 12 };
    window.WF_CONST = WF_CONST;

    // ── State ──────────────────────────────────────────────────────
    let _wfRet      = [];      // live, non-deleted register rows
    let _wfExp      = [];      // live, non-deleted fund draws
    let _wfRetUnsub = null;
    let _wfExpUnsub = null;
    let _wfInitialized = false;

    let _wfTab      = 'register';  // 'register' | 'draws'
    let _wfStatus   = '';          // register status filter
    let _wfSearch   = '';
    let _wfExpTarget = null;       // id of the draw being edited

    // ── Status vocabulary ──────────────────────────────────────────
    // Only TWO stored statuses, and only one of them is a decision:
    //
    //   active — the normal state. Counts toward the reserve.
    //   void   — excluded. The one manual action, because it is the only
    //            one that changes a total: it drops the record out of the
    //            reserve entirely (a mis-entered project, a bad sync).
    //
    // Whether a project is still inside its warranty year is NOT stored.
    // It is derived from release_due vs today (see _wfWindow) — there is
    // nothing to click and nothing to keep up to date. An earlier build had
    // a manual Held → Released button; it gated nothing (every peso in the
    // reserve is spendable either way), so it was removed rather than left
    // as a badge the owner had to maintain by hand.
    const WF_STATUS = {
        active: { label: 'Active', cls: 'wf-b-released', hint: 'Counts toward the reserve.' },
        void:   { label: 'Void',   cls: 'wf-b-void',     hint: 'Excluded — contributes nothing to the reserve.' },
    };

    // The derived warranty window. Display only; nothing sums off it.
    const WF_WINDOW = {
        within: { label: 'Within warranty', cls: 'wf-w-within',
                  hint: 'Still inside the warranty period for this project.' },
        ended:  { label: 'Warranty ended',  cls: 'wf-w-ended',
                  hint: 'The warranty period has passed with nothing outstanding.' },
    };
    // A voided row has no meaningful window; everything else compares its
    // release date to today. Missing date reads as still within.
    function _wfWindow(r) {
        if (r.status === 'void') return null;
        const due = _wfParseDay(r.releaseDue);
        return (due && due <= new Date()) ? WF_WINDOW.ended : WF_WINDOW.within;
    }

    // Whole days from today to the cover-end date. Negative once past.
    // Both sides are floored to local midnight so the count doesn't wobble
    // with the time of day — and never via toISOString (UTC+8, CLAUDE.md).
    function _wfDaysLeft(r) {
        const due = _wfParseDay(r.releaseDue);
        if (!due) return null;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.round((due - today) / 86400000);
    }

    // "Cover ends" in words. Days while that is meaningful to act on,
    // months once it is far enough out that a day count is just noise.
    function _wfDuePhrase(r) {
        const d = _wfDaysLeft(r);
        if (d === null) return 'No date';
        if (d < 0)   return 'Cover ended';
        if (d === 0) return 'Ends today';
        if (d === 1) return 'In 1 day';
        if (d < 45)  return 'In ' + d + ' days';
        const months = Math.round(d / 30);
        return 'In ' + months + (months === 1 ? ' month' : ' months');
    }

    // Short form for the sidebar bars: "40d left" / "Ended".
    function _wfDueShort(r) {
        const d = _wfDaysLeft(r);
        if (d === null) return '—';
        return d < 0 ? 'Ended' : d + 'd left';
    }

    // Under 45 days is "soon" — the same threshold _wfDuePhrase switches to
    // a day count at, so the amber styling and the wording always agree.
    const WF_SOON_DAYS = 45;
    function _wfIsSoon(r) {
        if (r.status === 'void') return false;
        const d = _wfDaysLeft(r);
        return d !== null && d >= 0 && d < WF_SOON_DAYS;
    }

    // How far through its warranty period a project is, 0–100. Drives the
    // sidebar bars. Falls back to a full bar when the dates are unusable.
    function _wfProgressPct(r) {
        const months = Number(r.warrantyMonths) || WF_CONST.months;
        const total  = months * 30.44;              // mean month, good enough for a bar
        const left   = _wfDaysLeft(r);
        if (left === null || !(total > 0)) return 100;
        const done = ((total - left) / total) * 100;
        return Math.max(0, Math.min(100, done));
    }

    // Suggestions only — the category box is free text, same idea as the
    // Overhead and Reimbursement category boxes.
    const WF_CAT_PRESETS = [
        'Warranty Rectification', 'Repairs & Callbacks', 'Materials',
        'Labor', 'Transportation & Delivery', 'Professional Fees',
        'Equipment Rental', 'Office & Admin', 'Miscellaneous'
    ];

    // ── Small helpers ──────────────────────────────────────────────
    function _wfUid() {
        return (typeof _uid === 'function' ? _uid() : null)
            || window.currentDataUserId
            || (typeof currentUser !== 'undefined' && currentUser && currentUser.uid)
            || null;
    }
    function _wfEmail() {
        return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email) || '';
    }
    // Staff must never see peso amounts. admin.html blocks the view and RLS
    // blocks the rows, but guard the write paths too — defence in depth.
    function _wfStaff() {
        return typeof currentUserRole !== 'undefined' && currentUserRole === 'staff';
    }
    function _wfEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _wfAmt(n) {
        const v = parseFloat(n);
        if (isNaN(v)) return '₱0.00';
        return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function _wfNum(v) {
        const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
    }
    function _wfSafeUrl(u) {
        const s = String(u == null ? '' : u).trim();
        return /^https?:\/\//i.test(s) ? s : '';
    }
    // 'YYYY-MM-DD' → local Date. Built from parts on purpose: new Date(str)
    // parses as UTC and PH (UTC+8) would render the previous day.
    function _wfParseDay(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    // Local date key — never toISOString().slice(0,10) (see CLAUDE.md).
    function _wfTodayKey(d) {
        const t = d || new Date();
        return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0')
             + '-' + String(t.getDate()).padStart(2, '0');
    }
    function _wfDay(s) {
        const d = _wfParseDay(s);
        return d ? d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    }
    // No year — for the "Latest: tile re-grout, Jul 18" line, where the
    // year is noise and the space is tight.
    function _wfDayShort(s) {
        const d = _wfParseDay(s);
        return d ? d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '';
    }
    function _wfTs(ts) {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    // `.exp-notification` is opacity:0 until it also carries `show` — setting
    // display alone leaves the message invisible, which is exactly how a
    // failed sync used to look like nothing happening at all.
    function _wfToast(msg, type) {
        const el = document.getElementById('expNotification');
        if (!el) { if (type === 'error') alert(msg); return; }
        el.textContent = msg;
        el.className = 'exp-notification show ' + (type === 'error' ? 'error' : 'success');
        clearTimeout(_wfToastTimer);
        _wfToastTimer = setTimeout(() => { el.className = 'exp-notification'; }, 4500);
    }
    let _wfToastTimer = null;

    // An in-page result line for the sync. A toast disappears and can be
    // missed; a back-fill that valued nothing, or failed on a missing table,
    // needs to leave something on screen that can be read and reported.
    function _wfSyncStatus(msg, kind) {
        const el = document.getElementById('wfSyncStatus');
        if (!el) return;
        if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
        el.textContent = msg;
        el.className = 'wf-sync-status' + (kind ? ' wf-sync-' + kind : '');
        el.style.display = 'block';
    }
    function _wfVal(id) {
        const el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
    }
    function _wfSet(id, html) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }
    function _wfText(id, txt) {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    }
    // Rows written before the status model was simplified carry 'held' or
    // 'released'; both simply mean "counts", so they read as active.
    function _wfStatusMeta(s) { return WF_STATUS[s] || WF_STATUS.active; }
    function _wfBadge(s) {
        const m = _wfStatusMeta(s);
        return '<span class="wf-badge ' + m.cls + '">' + _wfEsc(m.label) + '</span>';
    }
    function _wfWindowBadge(r) {
        const w = _wfWindow(r);
        if (!w) return '<span class="wf-c2">—</span>';
        return '<span class="wf-window ' + w.cls + '">' + _wfEsc(w.label) + '</span>';
    }

    // Add whole months without JS's end-of-month rollover (Jan 31 + 1 month
    // must not land on Mar 3). Clamp the day to the target month's length.
    function _wfAddMonths(date, months) {
        const d = new Date(date.getFullYear(), date.getMonth(), 1);
        d.setMonth(d.getMonth() + months);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(date.getDate(), lastDay));
        return d;
    }

    // Human-readable reference: WR-2026-0001 / WF-2026-0001. Derived from the
    // rows already loaded, so it is a DISPLAY label — never a key, and two
    // records created in the same second on two devices could collide.
    // `id` stays the identity.
    //
    // `reserve` matters for the batch back-fill: `_wfRet` only refreshes when
    // onSnapshot echoes a write back, so a loop creating five rows would hand
    // all five the same number. Reserved refs are remembered here until the
    // snapshot catches up. Callers that merely PREVIEW a ref (the draw form
    // header) must leave `reserve` false, or opening the form would burn a
    // number every time.
    const _wfIssuedRefs = new Set();
    function _wfNextRefNo(prefix, rows, reserve) {
        const year = new Date().getFullYear();
        const re = new RegExp('^' + prefix + '-(\\d{4})-(\\d+)$');
        let max = 0;
        const scan = (v) => {
            const m = re.exec(String(v || ''));
            if (m && +m[1] === year) max = Math.max(max, +m[2]);
        };
        rows.forEach(r => scan(r.refNo));
        _wfIssuedRefs.forEach(scan);
        const next = prefix + '-' + year + '-' + String(max + 1).padStart(4, '0');
        if (reserve) _wfIssuedRefs.add(next);
        return next;
    }

    // ══════════════════════════════════════════════════════════════
    //  THE FUND ARITHMETIC — the only place these totals are computed
    // ══════════════════════════════════════════════════════════════
    // Accrued   = every contribution recorded, minus voided rows
    // Within    = the part still inside its project's warranty year
    // Drawn     = recorded (non-cancelled) draws
    // Available = accrued − drawn
    //
    // `within` is INFORMATION, not a gate: the whole reserve is spendable,
    // so it never subtracts from Available. It answers "how much of this is
    // still tied to a house that could come back?" and nothing more.
    function _wfTotals() {
        let accrued = 0, within = 0;
        _wfRet.forEach(r => {
            if (r.status === 'void') return;
            const c = _wfNum(r.contributedAmount);
            accrued += c;
            if (_wfWindow(r) === WF_WINDOW.within) within += c;
        });
        const drawn = _wfExp.reduce((s, e) =>
            s + (e.status === 'cancelled' ? 0 : _wfNum(e.amount)), 0);
        return { accrued, within, drawn, available: accrued - drawn };
    }

    // ══════════════════════════════════════════════════════════════
    //  CLOSEOUT HOOK — called by js/termination-requests.js
    // ══════════════════════════════════════════════════════════════
    // The ONLY write path into the register from outside this file, which is
    // what keeps the isolation rule true: termination-requests never touches
    // the tables itself.
    //
    // Idempotent by project: closing out the same project twice updates the
    // snapshot instead of stacking a second contribution into the fund
    // (there is a matching unique index in migration 0043).
    window.wfRecordCloseout = function (p) {
        return _wfWriteRetention(p);
    };

    // The single write path into the register — used by the closeout hook
    // above and by the back-fill below, so both produce identical rows.
    //
    // `p.completedAt` is optional: a live closeout leaves it unset and gets
    // the server timestamp (it is happening now), while the back-fill passes
    // the project's best-known completion date so the warranty clock starts
    // from roughly the right day rather than from the day of the back-fill.
    async function _wfWriteRetention(p) {
        if (typeof db === 'undefined' || !_wfUid() || !p || !p.projectId) return null;

        const totalPaid  = _wfNum(p.totalPaid);
        const directCost = _wfNum(p.directCost);
        const netCash    = totalPaid - directCost;
        const amount     = netCash * (WF_CONST.pct / 100);
        // Negative net cash means costs outran payments — nothing is set
        // aside. Keep the signed figure for the record, contribute zero.
        const contributed = Math.max(0, amount);

        // Resolve the completion date the warranty clock runs from. A
        // Firestore-style timestamp, an ISO string and a Date all turn up
        // here depending on the caller, so normalise before doing date math.
        let completedDate = new Date();
        if (p.completedAt) {
            const d = p.completedAt.toDate ? p.completedAt.toDate() : new Date(p.completedAt);
            if (!isNaN(d)) completedDate = d;
        }
        const due = _wfAddMonths(completedDate, WF_CONST.months);

        const payload = {
            // The shim renames userId → owner_id, and the RLS policy is
            // `owner_id = auth.uid()`. Omit it and the INSERT is rejected with
            // "new row violates row-level security policy".
            userId            : _wfUid(),
            projectId         : p.projectId,
            projectName       : p.projectName || '',
            clientName        : p.clientName || '',
            clientEmail       : p.clientEmail || '',
            closeoutId        : p.closeoutId || null,
            totalPaid, directCost,
            netCashAtCloseout : netCash,
            retentionPct      : WF_CONST.pct,
            retentionAmount   : amount,
            contributedAmount : contributed,
            // A live closeout is happening now, so let the server stamp it.
            completedAt       : p.completedAt
                                  ? completedDate.toISOString()
                                  : firebase.firestore.FieldValue.serverTimestamp(),
            warrantyMonths    : WF_CONST.months,
            releaseDue        : _wfTodayKey(due),
            updatedAt         : firebase.firestore.FieldValue.serverTimestamp(),
        };

        const origin = p.backfilled
            ? 'Back-filled from a project completed before the register existed'
            : 'Recorded at project completion';

        // Re-snapshot if this project is already in the register.
        const existing = await _wfFindByProject(p.projectId);
        if (existing) {
            const history = Array.isArray(existing.history) ? existing.history.slice() : [];
            history.push({ at: new Date().toISOString(), by: _wfEmail(), status: existing.status || 'held',
                           note: 'Re-snapshotted from a new closeout' });
            await db.collection('warrantyRetentions').doc(existing.id).update({ ...payload, history });
            return existing.id;
        }

        const refNo = _wfNextRefNo('WR', _wfRet, true);
        const ref = await db.collection('warrantyRetentions').add({
            ...payload,
            refNo,
            status   : 'active',
            notes    : p.backfilled ? 'Back-filled — completion date is the best available.' : '',
            history  : [{ at: new Date().toISOString(), by: _wfEmail(), status: 'held', note: origin }],
            createdBy: _wfEmail(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        return ref.id;
    }

    // ══════════════════════════════════════════════════════════════
    //  BACK-FILL — projects completed before this register existed
    // ══════════════════════════════════════════════════════════════
    // Retention is normally captured at the moment of closeout. Any project
    // already marked `completed` before migration 0043 landed therefore has
    // no row, and never would — it will not be closed out a second time.
    //
    // This scans construction_projects for completed jobs with no register
    // row and values each one through window.trComputeCloseout, the SAME
    // function the closeout uses, so a back-filled figure is identical to
    // the one a live closeout would have produced.
    //
    // `completedAt` is the honest catch: the original completion timestamp is
    // not reliably recorded on the project, so the back-fill uses
    // terminatedAt / updatedAt when present and falls back to now. The
    // warranty clock therefore starts from the best date available, and the
    // row is marked `backfilled` so a surprising release date is explainable.
    window.wfSyncCompleted = async function () {
        if (_wfStaff()) { alert('Only the owner can manage the warranty fund.'); return; }
        if (typeof db === 'undefined' || !_wfUid()) return;

        if (typeof window.trComputeCloseout !== 'function') {
            _wfToast('Cannot back-fill: the Project Closeout module is not loaded.', 'error');
            _wfSyncStatus('Cannot back-fill: js/termination-requests.js is not loaded, so there is '
                        + 'nothing to value the projects with.', 'bad');
            return;
        }

        const btn = document.getElementById('wfSyncBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
        _wfSyncStatus('Scanning construction projects…');

        try {
            const snap = await db.collection('constructionProjects').get();
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const completed = all.filter(p => p.status === 'completed');

            if (!completed.length) {
                // Report what the statuses actually ARE — "none found" is
                // useless when the projects visibly say FINISHED on screen.
                const seen = {};
                all.forEach(p => { const s = p.status || '(no status)'; seen[s] = (seen[s] || 0) + 1; });
                const summary = Object.keys(seen).map(k => k + ' × ' + seen[k]).join(', ') || 'none';
                _wfToast('No completed projects found to back-fill.', 'error');
                _wfSyncStatus('Scanned ' + all.length + ' project' + (all.length === 1 ? '' : 's') + ', '
                            + 'none with status "completed". Statuses found: ' + summary + '.', 'bad');
                return;
            }

            // Skip anything already registered — this is re-runnable by design.
            const have = new Set(_wfRet.map(r => r.projectId));
            const missing = completed.filter(p => !have.has(p.id));

            if (!missing.length) {
                _wfToast('Every completed project is already in the register.');
                _wfSyncStatus('All ' + completed.length + ' completed project'
                            + (completed.length === 1 ? ' is' : 's are') + ' already registered.', 'ok');
                return;
            }

            if (!confirm(
                    missing.length + ' completed project' + (missing.length === 1 ? '' : 's')
                  + ' ' + (missing.length === 1 ? 'is' : 'are') + ' missing from the register.\n\n'
                  + 'Add ' + (missing.length === 1 ? 'it' : 'them') + ' now? The retention is worked '
                  + 'out the same way a closeout would, from each project\'s bills and payments.')) return;

            let added = 0, failed = 0, lastError = '';
            for (const p of missing) {
                if (btn) btn.textContent = 'Adding ' + (added + failed + 1) + '/' + missing.length + '…';
                try {
                    const c = await window.trComputeCloseout(p.id);
                    await _wfWriteRetention({
                        projectId  : p.id,
                        projectName: p.projectName || '',
                        clientName : p.clientName || '',
                        clientEmail: p.clientEmail || '',
                        closeoutId : p.terminationRequestId || null,
                        totalPaid  : c.totalPaid,
                        directCost : c.directCost,
                        // Best available completion date; see the note above.
                        completedAt: p.terminatedAt || p.updatedAt || null,
                        backfilled : true,
                    });
                    added++;
                } catch (e) {
                    console.error('back-fill failed for project', p.id, e);
                    lastError = e.message || String(e);
                    failed++;
                }
            }

            _wfToast(added + ' project' + (added === 1 ? '' : 's') + ' added to the register.'
                   + (failed ? ' ' + failed + ' failed.' : ''),
                     failed ? 'error' : undefined);
            // Surface the actual failure text. A missing table (migration 0043
            // not applied) shows up here as the Postgres error, which is the
            // fastest way to tell "nothing happened" from "it can't save".
            _wfSyncStatus(
                added + ' added, ' + failed + ' failed of ' + missing.length + '.'
                + (lastError ? ' Last error: ' + lastError : ''),
                failed ? 'bad' : 'ok');
        } catch (err) {
            console.error('wfSyncCompleted:', err);
            _wfToast('Could not scan completed projects: ' + (err.message || err), 'error');
            _wfSyncStatus('Could not scan completed projects: ' + (err.message || err), 'bad');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Check for new'; }
        }
    };

    // Look up a register row by project. Prefers the already-loaded rows so a
    // closeout done while the screen is open needs no round trip.
    async function _wfFindByProject(projectId) {
        const local = _wfRet.find(r => r.projectId === projectId);
        if (local) return local;
        try {
            const snap = await db.collection('warrantyRetentions')
                .where('projectId', '==', projectId).get();
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !r.deletedAt);
            return rows[0] || null;
        } catch (e) {
            console.warn('_wfFindByProject:', e);
            return null;
        }
    }

    // ── Init ───────────────────────────────────────────────────────
    window.initWarrantyFundModule = function () {
        if (typeof db === 'undefined' || !_wfUid()) return;
        if (_wfStaff()) return;

        const d = document.getElementById('wfExpDate');
        if (d) d.max = _wfTodayKey();

        if (!_wfInitialized) {
            _wfInitialized = true;
            _wfSubscribe();
        } else {
            _wfRender();
        }
    };

    function _wfSubscribe() {
        const uid = _wfUid();
        if (!uid) return;
        if (_wfRetUnsub) { _wfRetUnsub(); _wfRetUnsub = null; }
        if (_wfExpUnsub) { _wfExpUnsub(); _wfExpUnsub = null; }

        const byCreated = (a, b) => {
            const am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            const bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return bm - am;
        };

        const applyRet = (snap) => {
            _wfRet = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !r.deletedAt);
            _wfRet.sort(byCreated);
            _wfRender();
        };
        const applyExp = (snap) => {
            _wfExp = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !r.deletedAt);
            _wfExp.sort(byCreated);
            _wfRender();
        };

        _wfListen('warrantyRetentions', uid, applyRet, (u) => { _wfRetUnsub = u; });
        _wfListen('warrantyFundExpenses', uid, applyExp, (u) => { _wfExpUnsub = u; });
    }

    // onSnapshot with a .get() fallback — same shape as the Reimbursement
    // module, so a realtime hiccup degrades to a one-shot read instead of a
    // blank screen.
    function _wfListen(collection, uid, apply, keep) {
        try {
            const unsub = db.collection(collection).where('userId', '==', uid)
                .onSnapshot(apply, (err) => {
                    console.warn(collection + ' onSnapshot error, falling back to .get():', err);
                    db.collection(collection).where('userId', '==', uid).get()
                        .then(apply)
                        .catch(e => {
                            console.error(collection + ' fallback .get() error:', e);
                            _wfRenderError(e.message || String(e));
                        });
                });
            keep(unsub);
        } catch (e) {
            console.error('_wfListen(' + collection + '):', e);
            _wfRenderError(e.message || String(e));
        }
    }

    // ── Filters ────────────────────────────────────────────────────
    window.wfSwitchTab = function (tab) {
        _wfTab = tab === 'draws' ? 'draws' : 'register';
        ['register', 'draws'].forEach(t => {
            const btn  = document.getElementById('wfTab-' + t);
            const pane = document.getElementById('wfPane-' + t);
            if (btn)  btn.classList.toggle('wf-tab-on', t === _wfTab);
            if (pane) pane.style.display = (t === _wfTab) ? '' : 'none';
        });
        _wfRender();
    };
    window.wfApplyFilters = function () {
        _wfStatus = _wfVal('wfFilterStatus');
        _wfSearch = _wfVal('wfSearch').toLowerCase();
        _wfRender();
    };
    window.wfClearFilters = function () {
        ['wfFilterStatus', 'wfSearch'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        _wfStatus = ''; _wfSearch = '';
        _wfRender();
    };

    // 'void' filters on the stored status; 'within' / 'ended' filter on the
    // derived warranty window, and both exclude voided rows (a record that
    // doesn't count has no meaningful warranty state).
    function _wfFilteredRet() {
        return _wfRet.filter(r => {
            if (_wfStatus === 'void') {
                if (r.status !== 'void') return false;
            } else if (_wfStatus === 'within' || _wfStatus === 'ended') {
                if (r.status === 'void') return false;
                if (_wfWindow(r) !== WF_WINDOW[_wfStatus]) return false;
            }
            if (_wfSearch) {
                const hay = [r.refNo, r.projectName, r.clientName, r.clientEmail]
                    .map(v => String(v || '').toLowerCase()).join(' ');
                if (hay.indexOf(_wfSearch) === -1) return false;
            }
            return true;
        });
    }

    // ── Render ─────────────────────────────────────────────────────
    function _wfRender() {
        if (_wfStaff()) return;
        _wfRenderAlert();
        _wfRenderTabCounts();
        _wfRenderMoneyCard();
        _wfRenderWarrantyBars();
        _wfRenderRegister();
        _wfRenderDraws();
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            try { window.lucide.createIcons(); } catch (e) { /* icons are cosmetic */ }
        }
    }

    // The soonest warranty about to end. Shown only when something is
    // genuinely close — a banner that is always on stops being a banner.
    function _wfRenderAlert() {
        const box = document.getElementById('wfAlert');
        if (!box) return;

        const soon = _wfRet.filter(_wfIsSoon)
            .sort((a, b) => (_wfDaysLeft(a) || 0) - (_wfDaysLeft(b) || 0));
        if (!soon.length) { box.style.display = 'none'; return; }

        const r = soon[0];
        const d = _wfDaysLeft(r);
        const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days';
        const more = soon.length > 1
            ? ' ' + (soon.length - 1) + ' other'
              + (soon.length === 2 ? ' project is' : ' projects are') + ' close too.'
            : '';

        _wfSet('wfAlertText',
            '<strong>' + _wfEsc(r.projectName || 'A project') + '’s warranty ends ' + _wfEsc(when)
          + '</strong> (' + _wfEsc(_wfDay(r.releaseDue)) + '). Worth a last check-in with the client.'
          + _wfEsc(more));
        box.style.display = '';
    }

    function _wfRenderTabCounts() {
        _wfText('wfTabNSet',   String(_wfRet.length));
        _wfText('wfTabNSpent', String(_wfExp.filter(e => e.status !== 'cancelled').length));
    }

    // The money card: what came in, what went out, what's left, as one
    // readable sentence per line rather than four abstract KPI tiles.
    function _wfRenderMoneyCard() {
        const t = _wfTotals();

        _wfText('wfKpiAvailable', _wfAmt(t.available));
        _wfText('wfKpiAccrued',   _wfAmt(t.accrued));
        _wfText('wfKpiDrawn',     (t.drawn > 0 ? '− ' : '') + _wfAmt(t.drawn));
        _wfText('wfKpiLeft',      _wfAmt(t.available));

        const n = _wfRet.filter(r => r.status !== 'void').length;
        _wfText('wfInLabel', 'Came in from ' + n + (n === 1 ? ' finished project' : ' finished projects'));

        // Latest non-cancelled spend, for the "Latest: …" line.
        const live = _wfExp.filter(e => e.status !== 'cancelled');
        _wfText('wfOutLabel', live.length
            ? 'Went out on ' + live.length + (live.length === 1 ? ' expense' : ' expenses')
            : 'Nothing spent yet');
        const latest = live.slice().sort((a, b) =>
            String(b.expenseDate || '').localeCompare(String(a.expenseDate || '')))[0];
        _wfText('wfOutLatest', latest
            ? 'Latest: ' + (latest.description || latest.category || 'expense')
              + (latest.expenseDate ? ', ' + _wfDayShort(latest.expenseDate) : '')
            : ' ');

        // Overdrawn is a real possibility — nothing stops a spend exceeding
        // the reserve. Flag it loudly rather than rendering a quiet negative.
        const avail = document.getElementById('wfKpiAvailable');
        if (avail) avail.classList.toggle('wf-kpi-negative', t.available < 0);
        _wfText('wfKpiAvailableSub', t.available < 0
            ? 'You have spent more than the fund has taken in.'
            : 'This is a running total you keep, not a separate bank account.');

        // Split bar: spent on the left, remaining on the right. Guard the
        // divide — with nothing in the fund there is no ratio to show.
        const outPct = t.accrued > 0
            ? Math.max(0, Math.min(100, (t.drawn / t.accrued) * 100))
            : (t.drawn > 0 ? 100 : 0);
        const so = document.getElementById('wfSplitOut');
        const si = document.getElementById('wfSplitIn');
        if (so) so.style.width = outPct.toFixed(1) + '%';
        if (si) si.style.width = (100 - outPct).toFixed(1) + '%';
    }

    // Per-project warranty countdown. Live projects first, soonest to
    // expire at the top, with ended ones dimmed at the bottom.
    function _wfRenderWarrantyBars() {
        const box = document.getElementById('wfWarrantyBars');
        if (!box) return;

        const rows = _wfRet.filter(r => r.status !== 'void');
        if (!rows.length) {
            box.innerHTML = '';
            _wfText('wfWarrantySub', 'Nothing recorded yet.');
            return;
        }

        const liveRows = rows.filter(r => _wfWindow(r) === WF_WINDOW.within);
        const total = liveRows.reduce((s, r) => s + _wfNum(r.contributedAmount), 0);
        _wfText('wfWarrantySub', liveRows.length
            ? _wfAmt(total) + ' across ' + liveRows.length
              + (liveRows.length === 1 ? ' project you could still be called back to.'
                                       : ' projects you could still be called back to.')
            : 'Every warranty period has ended.');

        const sorted = rows.slice().sort((a, b) => {
            const da = _wfDaysLeft(a), db = _wfDaysLeft(b);
            const aOver = da === null || da < 0, bOver = db === null || db < 0;
            if (aOver !== bOver) return aOver ? 1 : -1;   // ended sink
            return (da || 0) - (db || 0);                  // soonest first
        });

        box.innerHTML = sorted.map(r => {
            const over = _wfWindow(r) === WF_WINDOW.ended;
            const soon = _wfIsSoon(r);
            const fill = over ? 'wf-bar-over' : (soon ? 'wf-bar-soon' : 'wf-bar-ok');
            // A project can appear twice (two jobs, same name), so the ref
            // disambiguates — its tail is enough and stays narrow.
            const tail = String(r.refNo || '').split('-').pop();
            const name = (r.projectName || 'Untitled') + (tail ? ' · ' + tail : '');
            return '<div class="wf-bar-row' + (over ? ' wf-bar-row-over' : '') + '">'
                 +   '<span class="wf-bar-dot ' + fill + '"></span>'
                 +   '<div class="wf-bar-mid">'
                 +     '<div class="wf-bar-name" title="' + _wfEsc(name) + '">' + _wfEsc(name) + '</div>'
                 +     '<div class="wf-bar-track">'
                 +       '<div class="wf-bar-fill ' + fill + '" style="width:'
                 +         _wfProgressPct(r).toFixed(0) + '%"></div>'
                 +     '</div>'
                 +   '</div>'
                 +   '<span class="wf-bar-left' + (soon ? ' wf-bar-left-soon' : '') + '">'
                 +     _wfEsc(_wfDueShort(r)) + '</span>'
                 + '</div>';
        }).join('');
    }

    function _wfRenderRegister() {
        const body = document.getElementById('wfRegisterBody');
        if (!body) return;
        const rows = _wfFilteredRet();

        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="4" class="wf-empty">'
                + (_wfRet.length
                    ? 'Nothing matches what you searched for.'
                    : 'Nothing set aside yet. Finishing a project in Project Closeout adds it '
                      + 'here automatically — for projects you finished earlier, use '
                      + '“Check for new” above.')
                + '</td></tr>';
            return;
        }

        body.innerHTML = rows.map(r => {
            const id     = _wfEsc(r.id);
            const voided = r.status === 'void';
            const ended  = _wfWindow(r) === WF_WINDOW.ended;
            const soon   = _wfIsSoon(r);
            // Show the raw signed figure when it was negative, so a zero
            // set-aside is explainable rather than mysterious.
            const neg    = _wfNum(r.retentionAmount) < 0;

            const rowCls = voided ? ' class="wf-row-void"'
                         : soon   ? ' class="wf-row-soon"'
                         : ended  ? ' class="wf-row-ended"' : '';
            const dueCls = voided ? 'wf-due'
                         : soon   ? 'wf-due wf-due-soon'
                         : ended  ? 'wf-due wf-due-over' : 'wf-due';

            return '<tr' + rowCls + '>'
                + '<td data-label="Project">'
                +   '<div class="wf-c1">' + _wfEsc(r.projectName || 'Untitled') + '</div>'
                +   '<div class="wf-c2">' + _wfEsc(r.clientName || r.clientEmail || 'No client')
                +     (r.refNo ? ' · ' + _wfEsc(r.refNo) : '') + '</div>'
                + '</td>'
                + '<td data-label="Set aside" class="wf-num">'
                +   '<div class="wf-amt">' + _wfAmt(voided ? 0 : r.contributedAmount) + '</div>'
                +   '<div class="wf-amt-sub">'
                +     (voided ? 'not counted'
                             : neg ? 'nothing left over on this job'
                                   : 'of ' + _wfAmt(r.netCashAtCloseout))
                +   '</div>'
                + '</td>'
                + '<td data-label="Cover ends">'
                +   '<div class="' + dueCls + '">' + _wfEsc(voided ? 'Not counted' : _wfDuePhrase(r)) + '</div>'
                +   '<div class="wf-c2">' + _wfEsc(_wfDay(r.releaseDue)) + '</div>'
                + '</td>'
                + '<td data-label="" class="wf-actions">'
                +   '<button type="button" class="wf-link" onclick="wfOpenDetail(\'' + id + '\')">View</button>'
                +   (voided
                        ? '<button type="button" class="wf-link" onclick="wfRestore(\'' + id + '\')">Count it again</button>'
                        : '<button type="button" class="wf-link wf-link-danger" onclick="wfVoid(\'' + id + '\')">Don’t count</button>')
                + '</td>'
                + '</tr>';
        }).join('');
    }

    function _wfRenderDraws() {
        const body = document.getElementById('wfDrawsBody');
        if (!body) return;

        if (!_wfExp.length) {
            body.innerHTML = '<tr><td colspan="5" class="wf-empty">'
                + 'Nothing spent yet. Use “Record money spent” to log a repair or an expense '
                + 'paid out of the fund.'
                + '</td></tr>';
            return;
        }

        body.innerHTML = _wfExp.map(e => {
            const id = _wfEsc(e.id);
            const cancelled = e.status === 'cancelled';
            const url = _wfSafeUrl(e.receiptUrl);
            return '<tr' + (cancelled ? ' class="wf-row-cancelled"' : '') + '>'
                + '<td data-label="What it was for">'
                +   '<div class="wf-c1">' + _wfEsc(e.description || 'Expense') + '</div>'
                +   '<div class="wf-c2">' + _wfEsc(e.category || 'Uncategorised')
                +     (e.refNo ? ' · ' + _wfEsc(e.refNo) : '') + '</div>'
                + '</td>'
                + '<td data-label="Project">' + _wfEsc(e.sourceProjectName || 'Not tied to one') + '</td>'
                + '<td data-label="Amount" class="wf-num"><span class="wf-amt">' + _wfAmt(e.amount) + '</span></td>'
                + '<td data-label="Date">' + _wfEsc(_wfDay(e.expenseDate)) + '</td>'
                + '<td data-label="" class="wf-actions">'
                +   (url ? '<a class="wf-link" href="' + _wfEsc(url) + '" target="_blank" rel="noopener">Receipt</a>' : '')
                +   (cancelled
                        ? '<span class="wf-badge wf-b-void">Cancelled</span>'
                        : '<button type="button" class="wf-link" onclick="wfOpenDrawForm(\'' + id + '\')">Edit</button>'
                          + '<button type="button" class="wf-link wf-link-danger" onclick="wfCancelDraw(\'' + id + '\')">Cancel</button>')
                + '</td>'
                + '</tr>';
        }).join('');
    }

    function _wfRenderError(msg) {
        _wfSet('wfRegisterBody',
            '<tr><td colspan="4" class="wf-empty">Could not load the warranty fund: ' + _wfEsc(msg) + '</td></tr>');
    }

    // ── Void / restore a record ────────────────────────────────────
    // The ONE manual action on the register, and the only one that moves a
    // total: a voided row drops out of the reserve entirely. For a project
    // entered by mistake, a duplicate, or a job that shouldn't count.
    // Reversible — the row is never deleted, so the reason stays on file.
    window.wfVoid = async function (id) {
        if (_wfStaff()) { alert('Only the owner can manage the warranty fund.'); return; }
        const r = _wfRet.find(x => x.id === id);
        if (!r) return;

        const note = prompt(
            'Exclude "' + (r.projectName || 'this project') + '" from the reserve?\n\n'
          + _wfAmt(r.contributedAmount) + ' will be removed from your total. '
          + 'The record stays on file and you can restore it later.\n\nReason:', '');
        if (note === null) return;

        await _wfSetStatus(r, 'void', note || 'Voided', 'Removed from the reserve.');
    };

    window.wfRestore = async function (id) {
        if (_wfStaff()) { alert('Only the owner can manage the warranty fund.'); return; }
        const r = _wfRet.find(x => x.id === id);
        if (!r) return;
        if (!confirm('Put "' + (r.projectName || 'this project') + '" back into the reserve?\n\n'
                   + _wfAmt(r.contributedAmount) + ' will be added back to your total.')) return;

        await _wfSetStatus(r, 'active', 'Restored to the reserve', 'Back in the reserve.');
    };

    async function _wfSetStatus(r, status, note, okMsg) {
        try {
            const history = Array.isArray(r.history) ? r.history.slice() : [];
            history.push({ at: new Date().toISOString(), by: _wfEmail(), status,
                           from: r.status || 'active', note });
            await db.collection('warrantyRetentions').doc(r.id).update({
                status, history,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            _wfToast(okMsg);
        } catch (err) {
            console.error('_wfSetStatus:', err);
            _wfToast('Could not update the record: ' + (err.message || err), 'error');
        }
    }

    // The record's own trail — when it was added, and every void/restore
    // since, with who did it and why. This is the "sticky note": the reason
    // something happened lives here rather than in a status badge someone
    // has to maintain by hand.
    function _wfHistorySection(r) {
        const h = Array.isArray(r.history) ? r.history.slice().reverse() : [];
        if (!h.length) return '';
        return '<div class="wf-dsec">'
             +   '<div class="wf-dsec-title">History</div>'
             +   h.map(x => {
                    const when = x.at
                        ? new Date(x.at).toLocaleDateString('en-PH',
                              { month: 'short', day: 'numeric', year: 'numeric' })
                        : '';
                    return '<div class="wf-hist">'
                         +   '<div class="wf-hist-note">' + _wfEsc(x.note || '—') + '</div>'
                         +   '<div class="wf-hist-meta">' + _wfEsc(when)
                         +     (x.by ? ' · ' + _wfEsc(x.by) : '') + '</div>'
                         + '</div>';
                 }).join('')
             + '</div>';
    }

    // ── Detail drawer ──────────────────────────────────────────────
    window.wfOpenDetail = function (id) {
        const r = _wfRet.find(x => x.id === id);
        if (!r) return;
        const meta   = _wfStatusMeta(r.status);
        const voided = r.status === 'void';
        const row = (l, v) => '<div class="wf-drow"><span>' + _wfEsc(l) + '</span><span>' + v + '</span></div>';

        // Attributed draws — what has been spent against THIS project's
        // retention. Presentation only; it changes no total on this screen.
        const mine = _wfExp.filter(e => e.sourceRetentionId === id && e.status !== 'cancelled');
        const mineTotal = mine.reduce((s, e) => s + _wfNum(e.amount), 0);

        _wfSet('wfDetailBody',
            '<div class="wf-dsec">'
          +   '<div class="wf-dsec-title">How the figure was worked out</div>'
          +   row('Client has paid', _wfAmt(r.totalPaid))
          +   row('Direct cost', '&minus; ' + _wfAmt(r.directCost))
          +   row('<strong>Net cash at completion</strong>', '<strong>' + _wfAmt(r.netCashAtCloseout) + '</strong>')
          +   row('Retention rate', _wfEsc(String(r.retentionPct || WF_CONST.pct)) + '%')
          +   row('<strong>Set aside</strong>', '<strong>' + _wfAmt(r.contributedAmount) + '</strong>')
          +   (_wfNum(r.retentionAmount) < 0
                ? '<div class="wf-dnote">Net cash was negative on this job, so nothing was set aside. '
                  + 'The raw figure (' + _wfAmt(r.retentionAmount) + ') is kept for the record only.</div>'
                : '')
          + '</div>'
          + '<div class="wf-dsec">'
          +   '<div class="wf-dsec-title">Warranty</div>'
          +   row('Completed', _wfEsc(_wfTs(r.completedAt)))
          +   row('Warranty period', _wfEsc(String(r.warrantyMonths || WF_CONST.months)) + ' months')
          +   row('Warranty until', _wfEsc(_wfDay(r.releaseDue)))
          +   row('Warranty', voided ? _wfBadge('void') : _wfWindowBadge(r))
          +   '<div class="wf-dnote">'
          +     (voided
                  ? _wfEsc(meta.hint) + ' It is not counted in your reserve total.'
                  : _wfEsc((_wfWindow(r) || WF_WINDOW.within).hint))
          +   '</div>'
          + '</div>'
          + _wfHistorySection(r)
          + '<div class="wf-dsec">'
          +   '<div class="wf-dsec-title">Draws attributed to this project</div>'
          +   (mine.length
                ? mine.map(e => row(_wfDay(e.expenseDate) + ' · ' + (e.description || e.refNo || '—'),
                                    _wfAmt(e.amount))).join('')
                  + row('<strong>Total</strong>', '<strong>' + _wfAmt(mineTotal) + '</strong>')
                : '<div class="wf-dnote">None recorded.</div>')
          + '</div>'
          + '<div class="wf-dsec wf-dsec-warn">'
          +   'A reserve you track, not a separate bank account — the pesos stay with your '
          +   'normal company funds. No figure on this page affects any project cost, '
          +   'budget, invoice or report.'
          + '</div>');

        const el = document.getElementById('wfDetailDrawer');
        if (el) el.classList.add('wf-open');
    };
    window.wfCloseDetail = function () {
        const el = document.getElementById('wfDetailDrawer');
        if (el) el.classList.remove('wf-open');
    };

    // ── Draw form ──────────────────────────────────────────────────
    window.wfOpenDrawForm = function (id) {
        if (_wfStaff()) { alert('Only the owner can manage the warranty fund.'); return; }
        const e = id ? _wfExp.find(x => x.id === id) : null;
        _wfExpTarget = e ? e.id : null;

        _wfText('wfDrawTitle', e ? 'Edit what you spent' : 'Record money spent');
        _wfText('wfDrawRef', e ? (e.refNo || '') : _wfNextRefNo('WF', _wfExp));

        const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
        set('wfExpDescription', e ? (e.description || '') : '');
        set('wfExpCategory',    e ? (e.category || '') : '');
        set('wfExpAmount',      e ? (e.amount || '') : '');
        set('wfExpDate',        e ? (e.expenseDate || '') : _wfTodayKey());
        set('wfExpNotes',       e ? (e.notes || '') : '');
        set('wfExpReceiptUrl',  e ? (e.receiptUrl || '') : '');
        set('wfExpReceiptName', e ? (e.receiptName || '') : '');

        // Attribution picker — every register row that still has a balance,
        // plus the general-fund option.
        const sel = document.getElementById('wfExpSource');
        if (sel) {
            sel.innerHTML = '<option value="">General fund (no specific project)</option>'
                + _wfRet.filter(r => r.status !== 'void')
                    .map(r => '<option value="' + _wfEsc(r.id) + '">'
                        + _wfEsc(r.projectName || r.refNo || 'Untitled')
                        + ' — ' + _wfAmt(r.contributedAmount) + '</option>').join('');
            sel.value = e ? (e.sourceRetentionId || '') : '';
        }

        const dl = document.getElementById('wfCategoryList');
        if (dl) {
            const all = WF_CAT_PRESETS.slice();
            _wfExp.forEach(x => { if (x.category && all.indexOf(x.category) === -1) all.push(x.category); });
            dl.innerHTML = all.map(c => '<option value="' + _wfEsc(c) + '"></option>').join('');
        }

        // Show what is left, so a draw is not made blind.
        const t = _wfTotals();
        _wfText('wfDrawAvailable', _wfAmt(t.available) + ' available');

        const modal = document.getElementById('wfDrawModal');
        if (modal) modal.classList.add('wf-open');
    };
    window.wfCloseDrawForm = function () {
        _wfExpTarget = null;
        const modal = document.getElementById('wfDrawModal');
        if (modal) modal.classList.remove('wf-open');
    };

    window.wfSaveDraw = async function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (_wfStaff()) { alert('Only the owner can manage the warranty fund.'); return; }

        const description = _wfVal('wfExpDescription');
        const category    = _wfVal('wfExpCategory');
        const amount      = _wfNum(_wfVal('wfExpAmount'));
        const expenseDate = _wfVal('wfExpDate');
        const sourceId    = _wfVal('wfExpSource');

        if (!description)   { _wfToast('Please enter a description.', 'error'); return; }
        if (!category)      { _wfToast('Please enter a category.', 'error'); return; }
        if (!(amount > 0))  { _wfToast('Please enter an amount greater than zero.', 'error'); return; }
        if (!expenseDate)   { _wfToast('Please select the date.', 'error'); return; }
        if (expenseDate > _wfTodayKey()) { _wfToast('The date cannot be in the future.', 'error'); return; }

        // Overdrawing is allowed — the fund is an accrual and the owner may
        // know something the register doesn't — but never silently.
        const t = _wfTotals();
        const prior = _wfExpTarget ? _wfNum((_wfExp.find(x => x.id === _wfExpTarget) || {}).amount) : 0;
        const after = t.available + prior - amount;
        if (after < 0 && !confirm(
                'This is ' + _wfAmt(-after) + ' more than the fund has left.\n\n'
              + 'Record it anyway?')) return;

        const btn = document.getElementById('wfDrawSave');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        try {
            const src = sourceId ? _wfRet.find(r => r.id === sourceId) : null;
            const payload = {
                // See _wfWriteRetention: userId → owner_id, required by RLS.
                userId: _wfUid(),
                description, category, amount,
                expenseDate,
                sourceRetentionId : sourceId || null,
                sourceProjectName : src ? (src.projectName || '') : '',
                notes             : _wfVal('wfExpNotes'),
                receiptUrl        : _wfVal('wfExpReceiptUrl'),
                receiptName       : _wfVal('wfExpReceiptName'),
                updatedAt         : firebase.firestore.FieldValue.serverTimestamp(),
            };

            if (_wfExpTarget) {
                const existing = _wfExp.find(x => x.id === _wfExpTarget);
                const history = Array.isArray(existing && existing.history) ? existing.history.slice() : [];
                history.push({ at: new Date().toISOString(), by: _wfEmail(),
                               status: (existing && existing.status) || 'recorded', note: 'Edited' });
                await db.collection('warrantyFundExpenses').doc(_wfExpTarget).update({ ...payload, history });
                _wfToast('Draw updated.');
            } else {
                const refNo = _wfNextRefNo('WF', _wfExp, true);
                await db.collection('warrantyFundExpenses').add({
                    ...payload,
                    refNo,
                    status   : 'recorded',
                    history  : [{ at: new Date().toISOString(), by: _wfEmail(), status: 'recorded',
                                  note: 'Draw recorded' }],
                    createdBy: _wfEmail(),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                _wfToast('Draw ' + refNo + ' recorded.');
            }
            window.wfCloseDrawForm();
        } catch (err) {
            console.error('wfSaveDraw:', err);
            _wfToast('Error saving the draw: ' + (err.message || err), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Save Draw'; }
        }
    };

    // Cancelling reverses a draw's effect on the fund total. The row stays,
    // so the record of what happened is never lost.
    window.wfCancelDraw = async function (id) {
        if (_wfStaff()) { alert('Only the owner can manage the warranty fund.'); return; }
        const e = _wfExp.find(x => x.id === id);
        if (!e) return;
        const note = prompt('Cancel this ' + _wfAmt(e.amount) + ' expense?\n\n'
                          + 'The money goes back into the fund and the record stays.\n\nReason:', '');
        if (note === null) return;

        try {
            const history = Array.isArray(e.history) ? e.history.slice() : [];
            history.push({ at: new Date().toISOString(), by: _wfEmail(), status: 'cancelled',
                           from: e.status || 'recorded', note: note || 'Cancelled' });
            await db.collection('warrantyFundExpenses').doc(id).update({
                status: 'cancelled', history,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            _wfToast('Draw cancelled.');
        } catch (err) {
            console.error('wfCancelDraw:', err);
            _wfToast('Could not cancel it: ' + (err.message || err), 'error');
        }
    };

})();
