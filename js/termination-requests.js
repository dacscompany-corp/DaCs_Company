/* ============================================================
   PROJECT CLOSEOUT — admin-initiated
   --------------------------------------------------------------
   Ending a construction project is an ADMIN decision. Clients cannot
   raise one: the Termination Zone was removed from both portals and
   the client INSERT policy on `termination_requests` was dropped in
   migration 0042.

   A project can end TWO ways, and the difference is meaning, not money:

     COMPLETED   the good ending — the work finished. Settle what's owed.
     TERMINATED  cut short — the work stopped early. Settle what was
                 consumed up to that point.

   The final bill is the SAME arithmetic for both, because this is a
   cost-plus system: the client owes actual direct costs + management
   fee, and `budget` is an estimate, never a fixed price. What differs
   is the project's status, the badge, and every word the client reads —
   nobody who finished a project should get a letter saying it was
   terminated.

   Either way the flow is:
     • pick a project → compute its final balance → confirm
     • write the closeout record (`terminationRequests`, `outcome` says which)
     • flip the project to `completed` / `terminated`
     • auto-issue the final invoice for the remaining balance
     • notify the client

   The approve / reject path is KEPT so any client request still sitting
   at `pending` from before the change can be closed out.

   Public surface (called by admin.js / inline onclicks):
     • window.initTerminationRequests() — start the listener
     • window.trFilter(status)          — filter pills
     • window.trView(id)                — open detail modal
     • window.trCloseDetail()           — close detail modal
     • window.trApprove(id)             — approve a legacy request
     • window.trReject(id)              — reject a legacy request
     • window.trOpenCloseout(mode)      — open the picker ('complete'|'terminate')
     • window.trCloseCloseout()         — close the picker
     • window.trPickProject(id)         — compute + show confirm step
     • window.trBackToPicker()          — return to the project list
     • window.trConfirmCloseout()       — execute it
============================================================ */
(function () {
    'use strict';

    let _trUnsub = null;
    let _allRequests = [];
    let _filter = 'all';
    let _currentId = null;
    let _currentReq = null;

    // Warranty-retention constants. js/warranty-fund.js OWNS these values —
    // read lazily through window so script load order can't freeze a stale
    // fallback, and so this file keeps working if that module isn't loaded.
    const _wfConst = () => (window.WF_CONST || { pct: 5, months: 12 });

    // Closeout-flow state
    let _termMode     = 'complete';  // 'complete' | 'terminate'
    let _termProjects = [];    // pickable projects (not already closed out)
    let _termProject  = null;  // the project chosen in the picker
    let _termCalc     = null;  // its computed final-balance breakdown
    let _termBusy     = false;

    // Everything that differs between the two endings, in one place, so no
    // screen can drift into calling a finished project "terminated".
    const MODES = {
        complete: {
            outcome:      'completed',
            projStatus:   'completed',
            past:         'completed',
            notifType:    'project_completed',
            // Picker step
            title:        'Complete a project',
            pickSub:      'Pick the job that has finished.',
            blurb:        'Choose the project below to see its final balance.',
            // Confirm step — wording from the imported design
            confirmTitle: 'Ready to close out this project?',
            confirmSub:   'Have a last look, then mark it complete.',
            confirmVerb:  'Mark as complete',
            footNote:     'You can reopen this project later from Edit Project. Any invoice already issued stays.',
            clientMsg:    (p, owed, inv) => inv
                ? `Your project "${p}" is now complete. Final invoice for ${owed} has been issued — please settle it to close out the project.`
                : `Your project "${p}" is now complete. Nothing further is due — thank you.`,
        },
        terminate: {
            outcome:      'terminated',
            projStatus:   'terminated',
            past:         'terminated',
            notifType:    'termination_approved',
            title:        'Terminate a project early',
            pickSub:      'Pick the job that stopped before it was finished.',
            blurb:        'Choose the project below to see what it consumed before it stopped.',
            confirmTitle: 'Stop this project early?',
            confirmSub:   'Have a last look, then mark it terminated.',
            confirmVerb:  'Mark as terminated',
            footNote:     'You can reopen this project later from Edit Project. Any invoice already issued stays.',
            clientMsg:    (p, owed, inv) => inv
                ? `Your project "${p}" has been terminated. Final invoice for ${owed} has been issued — please settle to close out the project.`
                : `Your project "${p}" has been terminated. Final balance due: ${owed}.`,
        },
    };
    const _mode = () => MODES[_termMode] || MODES.terminate;

    const _trUid = () =>
        (window.currentDataUserId)
        || (window.auth && window.auth.currentUser && window.auth.currentUser.uid)
        || null;

    const _trEmail = () =>
        (window.auth && window.auth.currentUser && window.auth.currentUser.email) || '';

    // Terminating closes a project and issues an invoice off the back of peso
    // figures staff are not allowed to see. Owner-only, enforced on both the
    // button and the action itself so it can't be reached from the console.
    const _trStaff = () => window.currentUserRole === 'staff';

    const _esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const _fmtPHP = (n) =>
        '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const _fmtDate = (ts) => {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const _pill = (bg, fg, label) =>
        `<span style="display:inline-block;padding:3px 10px;border-radius:99px;font-size:11.5px;font-weight:600;background:${bg};color:${fg};letter-spacing:0.02em;">${_esc(label)}</span>`;

    // A closed-out row reads by its OUTCOME, not by "approved" — that word
    // says nothing about whether the project finished or was cut short.
    // Rows written before 0042 have no outcome and default to terminated.
    const _statusPill = (r) => {
        if (r.status === 'pending')  return _pill('#fef3c7', '#92400e', 'Pending');
        if (r.status === 'rejected') return _pill('#fee2e2', '#991b1b', 'Rejected');
        if (r.status === 'approved') {
            return r.outcome === 'completed'
                ? _pill('#dcfce7', '#166534', 'Completed')
                : _pill('#fee2e2', '#991b1b', 'Terminated');
        }
        return _pill('#e5e7eb', '#374151', r.status || '—');
    };

    // Rows written before this change have no initiatedBy; they were all
    // client-raised, which is exactly what the column default says too.
    const _raisedBy = (r) => (r.initiatedBy === 'admin' ? 'Admin' : 'Client');

    // ────────────────────────────────────────────────────────
    // Listener
    // ────────────────────────────────────────────────────────
    window.initTerminationRequests = function () {
        const actions = document.getElementById('tr-closeout-actions');
        if (actions) actions.style.display = _trStaff() ? 'none' : 'flex';

        const uid = _trUid();
        if (!uid || typeof db === 'undefined') {
            _renderEmpty('Sign in to view project terminations.');
            return;
        }
        if (_trUnsub) { _trUnsub(); _trUnsub = null; }

        _trUnsub = db.collection('terminationRequests')
            .orderBy('requestedAt', 'desc')
            .limit(100)
            .onSnapshot(snap => {
                _allRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                _renderList();
                _updatePendingBadge();
            }, err => {
                console.warn('terminationRequests listener:', err.message);
                _renderEmpty('Could not load project terminations: ' + err.message);
            });

        // Register with switchView()'s cleanup hook so leaving this view
        // tears the listener down. (We also defensively re-init from
        // onAuthStateChanged below, so this is belt-and-suspenders.)
        if (typeof window.registerViewCleanup === 'function') {
            window.registerViewCleanup(() => {
                if (_trUnsub) { _trUnsub(); _trUnsub = null; }
            });
        }
    };

    function _updatePendingBadge() {
        const badge = document.getElementById('tr-pending-badge');
        if (!badge) return;
        const pending = _allRequests.filter(r => r.status === 'pending').length;
        if (pending > 0) {
            badge.textContent = pending + ' pending';
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // ────────────────────────────────────────────────────────
    // Render — list / filter / empty state
    // ────────────────────────────────────────────────────────
    window.trFilter = function (status) {
        _filter = status || 'all';
        document.querySelectorAll('.tr-filter-pill').forEach(el => {
            el.classList.toggle('tr-filter-active', el.dataset.filter === _filter);
        });
        _renderList();
    };

    function _renderList() {
        const tbody = document.getElementById('tr-tbody');
        if (!tbody) return;

        // 'completed' / 'terminated' filter on outcome; 'pending' / 'rejected'
        // on status. Legacy rows have no outcome and read as terminated.
        const filtered = _filter === 'all' ? _allRequests : _allRequests.filter(r => {
            if (_filter === 'completed')  return r.status === 'approved' && r.outcome === 'completed';
            if (_filter === 'terminated') return r.status === 'approved' && r.outcome !== 'completed';
            return r.status === _filter;
        });

        if (!filtered.length) {
            tbody.innerHTML = `
                <tr><td colspan="6" style="padding:36px 14px;text-align:center;color:#9ca3af;font-size:13.5px;">
                    No ${_filter === 'all' ? 'closed-out projects' : _esc(_filter) + ' projects'} yet.
                </td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(r => `
            <tr style="border-top:1px solid #e5e7eb;cursor:pointer;" onclick="trView('${_esc(r.id)}')">
                <td style="padding:14px;font-size:13px;color:#374151;">${_fmtDate(r.requestedAt)}<div style="font-size:11px;color:#9ca3af;margin-top:2px;">by ${_esc(_raisedBy(r))}</div></td>
                <td style="padding:14px;font-size:13.5px;font-weight:600;color:#111827;">${_esc(r.clientName || '—')}<div style="font-size:11.5px;font-weight:400;color:#6b7280;margin-top:2px;">${_esc(r.clientEmail || '')}</div></td>
                <td style="padding:14px;font-size:13px;color:#374151;">${_esc(r.projectName || '—')}</td>
                <td style="padding:14px;font-size:13.5px;color:#111827;font-weight:600;text-align:right;">${_fmtPHP(r.grandTotal)}</td>
                <td style="padding:14px;font-size:13.5px;color:#15803d;font-weight:600;text-align:right;">${_fmtPHP(r.remainingBalance)}</td>
                <td style="padding:14px;text-align:right;">${_statusPill(r)}</td>
            </tr>`).join('');
    }

    function _renderEmpty(msg) {
        const tbody = document.getElementById('tr-tbody');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="6" style="padding:36px 14px;text-align:center;color:#9ca3af;font-size:13.5px;">${_esc(msg)}</td></tr>`;
    }

    // ────────────────────────────────────────────────────────
    // Detail modal
    // ────────────────────────────────────────────────────────
    window.trView = function (id) {
        const req = _allRequests.find(r => r.id === id);
        if (!req) return;
        _currentId = id; _currentReq = req;

        const body = document.getElementById('tr-detail-body');
        if (!body) return;

        const isPending = req.status === 'pending';
        body.innerHTML = `
            <div style="margin-bottom:18px;">
                <div style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:4px;">Client</div>
                <div style="font-size:16px;font-weight:600;color:#111827;font-family:'Playfair Display',serif;">${_esc(req.clientName || '—')}</div>
                <div style="font-size:13px;color:#6b7280;">${_esc(req.clientEmail || '')}</div>
            </div>
            <div style="margin-bottom:18px;">
                <div style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:4px;">Project</div>
                <div style="font-size:15px;font-weight:600;color:#111827;">${_esc(req.projectName || '—')}</div>
            </div>
            <div style="margin-bottom:18px;display:flex;gap:28px;flex-wrap:wrap;">
                <div>
                    <div style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Raised</div>
                    <div style="font-size:13.5px;color:#374151;">${_fmtDate(req.requestedAt)}</div>
                </div>
                <div>
                    <div style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Raised by</div>
                    <div style="font-size:13.5px;color:#374151;">${_esc(_raisedBy(req))}${req.decidedBy ? ' · ' + _esc(req.decidedBy) : ''}</div>
                </div>
            </div>

            <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:8px;">
                <div style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:10px;">Cost Breakdown</div>
                ${_breakdownRows(req)}
            </div>

            <div style="margin-top:18px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Status</span>
                ${_statusPill(req)}
            </div>
            ${req.rejectedReason ? `<div style="margin-top:12px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:13px;color:#991b1b;"><b>Rejection reason:</b> ${_esc(req.rejectedReason)}</div>` : ''}
        `;

        // Action buttons — approve/reject exist ONLY for legacy client
        // requests still sitting at `pending`. Admin-raised terminations are
        // already final when they're written, so there is nothing to decide.
        const footer = document.getElementById('tr-detail-footer');
        if (footer) {
            footer.innerHTML = isPending
                ? `<button onclick="trReject('${_esc(id)}')" style="padding:10px 18px;border:1.5px solid #fecaca;border-radius:8px;background:#fff;color:#991b1b;font-weight:600;font-size:13.5px;cursor:pointer;">Reject</button>
                   <button onclick="trApprove('${_esc(id)}')" style="padding:10px 18px;border:none;border-radius:8px;background:#1A5C3A;color:#fff;font-weight:600;font-size:13.5px;cursor:pointer;">Approve Termination</button>`
                : `<button onclick="trCloseDetail()" style="padding:10px 18px;border:1.5px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-weight:600;font-size:13.5px;cursor:pointer;">Close</button>`;
        }

        const modal = document.getElementById('tr-detail-modal');
        if (modal) modal.style.display = 'flex';
    };

    // Shared cost table — same shape for the stored record and the live
    // pre-termination preview.
    function _breakdownRows(c) {
        const row = (label, val, opts) => {
            const o = opts || {};
            return `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;">
                <span style="color:#374151;">${_esc(label)}</span>
                <span style="color:${o.color || '#111827'};font-weight:600;">${o.prefix || ''}${_fmtPHP(val)}</span></div>`;
        };
        // Direct cost can exceed labor + materials because site overhead is
        // folded into directCostTotal. Show the remainder rather than let the
        // column silently not add up.
        const other = Math.max(0, (Number(c.directCost) || 0) - (Number(c.totalLabor) || 0) - (Number(c.totalMaterials) || 0));

        // If the client paid MORE than the project came to, remainingBalance
        // clamps to zero — correct for invoicing (you can't bill a negative)
        // but it would otherwise hide the overpayment completely. At closeout
        // that gap is money owed BACK, so it gets its own line. Derived from
        // stored fields, so saved records show it too.
        const over = Math.max(0, (Number(c.totalPaid) || 0) - (Number(c.grandTotal) || 0));

        return `
            ${row('Total Labor', c.totalLabor)}
            ${row('Total Materials', c.totalMaterials)}
            ${other > 0 ? row('Site Overhead & Other', other) : ''}
            ${row('Management Fee', c.managementFee)}
            <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;border-top:1px solid #e5e7eb;margin-top:4px;"><span style="color:#111827;font-weight:700;font-family:'Playfair Display',serif;">Grand Total</span><span style="color:#111827;font-weight:700;">${_fmtPHP(c.grandTotal)}</span></div>
            ${row('Already Paid', c.totalPaid, { color: '#15803d', prefix: '− ' })}
            <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:15px;border-top:2px solid #111827;margin-top:6px;"><span style="color:#111827;font-weight:700;font-family:'Playfair Display',serif;">Final Balance Due</span><span style="color:#1A5C3A;font-weight:700;">${_fmtPHP(c.remainingBalance)}</span></div>
            ${over > 0 ? `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-top:10px;padding:11px 13px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
                <span style="font-size:12.5px;color:#9a3412;line-height:1.5;"><b>Client has overpaid.</b> They paid more than this project came to — this amount is refundable or creditable, and is <b>not</b> invoiced.</span>
                <span style="flex:none;font-size:15px;font-weight:700;color:#9a3412;">${_fmtPHP(over)}</span>
            </div>` : ''}`;
    }

    window.trCloseDetail = function () {
        const modal = document.getElementById('tr-detail-modal');
        if (modal) modal.style.display = 'none';
        _currentId = null; _currentReq = null;
    };

    // ════════════════════════════════════════════════════════
    // ADMIN-INITIATED TERMINATION
    // ════════════════════════════════════════════════════════

    // Final balance for a project, computed the same way the PM Overview
    // KPIs are (see _pmOvHtml / _pmOvPaid in pm-admin.js) so the number the
    // admin confirms here matches the number on the project dashboard.
    async function _computeCloseout(projectId) {
        const base = db.collection('constructionProjects').doc(projectId);
        const [billsSnap, paySnap] = await Promise.all([
            base.collection('weeklyBills').get(),
            db.collection('paymentRequests').where('constructionProjectId', '==', projectId).get(),
        ]);
        const bills = billsSnap.docs.map(d => d.data());
        const reqs  = paySnap.docs.map(d => d.data());

        const num = (v) => Number(v) || 0;

        const totalLabor = bills.reduce((s, b) => s + num(b.labor), 0);
        const totalMaterials = bills.reduce((s, b) =>
            s + num(b.materials) + num(b.delivery) + num(b.consumables) + num(b.other), 0);

        // Same fallback ladder as the Overview's Direct cost KPI: prefer
        // directCostTotal, then labor+materials, then grandTotal − fee.
        // Treat 0 as "missing" — a default-0 column can hide real costs.
        const directCost = bills.reduce((s, b) => {
            const dct = num(b.directCostTotal);
            if (dct) return s + dct;
            const lm = num(b.labor) + num(b.materials);
            if (lm) return s + lm;
            return s + (num(b.grandTotal) - num(b.managementFee));
        }, 0);

        // Use the fee actually billed each week, not a recomputed rate — the
        // project's rate is editable and past weeks keep the rate they carried.
        const managementFee = bills.reduce((s, b) => s + num(b.managementFee), 0);
        const grandTotal    = directCost + managementFee;

        // Cash actually received — mirrors _pmOvPaid in pm-admin.js.
        const totalPaid = reqs.reduce((s, r) => {
            if (r.status === 'verified') return s + num(r.amountPaid || r.paidAmount || r.totalAmount);
            return s + num(r.amountPaid);
        }, 0);

        return {
            totalLabor, totalMaterials, directCost, managementFee, grandTotal, totalPaid,
            remainingBalance: Math.max(0, grandTotal - totalPaid),
            weekCount: bills.length,
        };
    }

    // Exposed for js/warranty-fund.js, whose back-fill has to value a project
    // that was completed BEFORE the register existed. It must produce the same
    // totalPaid / directCost the closeout would have, so this is deliberately
    // the one implementation rather than a second copy of the ladder above —
    // a duplicate would drift the moment either side changed.
    window.trComputeCloseout = _computeCloseout;

    // The client's auth uid, needed to notify them and to stamp the final
    // invoice. Projects only store clientEmail, so match on that.
    async function _resolveClientUid(email) {
        if (!email) return '';
        try {
            const snap = await db.collection('constructionClientUsers').get();
            const want = String(email).trim().toLowerCase();
            const hit = snap.docs.find(d => String((d.data() || {}).email || '').trim().toLowerCase() === want);
            return hit ? hit.id : '';
        } catch (e) {
            console.warn('Could not resolve client uid:', e.message);
            return '';
        }
    }

    window.trOpenCloseout = function (mode) {
        if (_trStaff()) { alert('Only the owner can close out a project.'); return; }
        _termMode = (mode === 'complete' || mode === 'terminate') ? mode : 'terminate';
        _termProject = null; _termCalc = null;
        const modal = document.getElementById('tr-terminate-modal');
        if (modal) modal.style.display = 'flex';
        _renderPicker('loading');

        db.collection('constructionProjects').orderBy('clientName').get()
            .then(snap => {
                // A project that is already closed out either way can't be
                // closed out again.
                _termProjects = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(p => p.status !== 'terminated' && p.status !== 'completed');
                _renderPicker('list');
            })
            .catch(e => {
                console.warn('closeout: load projects', e.message);
                _renderPicker('error', e.message);
            });
    };

    window.trCloseCloseout = function () {
        const modal = document.getElementById('tr-terminate-modal');
        if (modal) modal.style.display = 'none';
        _termProject = null; _termCalc = null; _termBusy = false;
    };

    window.trBackToPicker = function () {
        _termProject = null; _termCalc = null;
        _renderPicker('list');
    };

    // ── Card shell ──────────────────────────────────────────
    // The whole dialog is rendered per step so each one owns its title,
    // body and footer. Layout/palette come from css/closeout-dialog.css,
    // ported from the "Complete Project Dialog - Final" design.
    function _renderCard(o) {
        const card = document.getElementById('tr-terminate-card');
        if (!card) return;
        card.className = 'trdc-card' + (_termMode === 'terminate' ? ' is-terminate' : '');
        card.innerHTML = `
            <div class="trdc-head">
              <div class="trdc-head-text">
                <div class="trdc-title" id="tr-terminate-title">${_esc(o.title)}</div>
                <div class="trdc-sub">${_esc(o.subtitle || '')}</div>
              </div>
              <button class="trdc-x" type="button" onclick="trCloseCloseout()" aria-label="Close">&times;</button>
            </div>
            ${o.body || ''}
            <div class="trdc-foot">
              <div class="trdc-foot-note">${o.note || ''}</div>
              <div class="trdc-actions">${o.actions || ''}</div>
            </div>`;
    }

    const _ghostBtn = (label, onclick) =>
        `<button type="button" class="trdc-btn trdc-btn-ghost" onclick="${onclick}">${_esc(label)}</button>`;

    function _renderPicker(state, msg) {
        const m = _mode();

        if (state === 'loading' || state === 'error' || !_termProjects.length) {
            const text = state === 'loading' ? 'Loading projects…'
                : state === 'error'         ? 'Could not load projects: ' + (msg || '')
                : 'No open projects left to close out.';
            _renderCard({
                title:    m.title,
                subtitle: m.pickSub,
                body:     `<div class="trdc-state${state === 'error' ? ' trdc-state-bad' : ''}">${_esc(text)}</div>`,
                actions:  _ghostBtn(state === 'loading' ? 'Cancel' : 'Close', 'trCloseCloseout()'),
            });
            return;
        }

        _renderCard({
            title:    m.title,
            subtitle: m.pickSub,
            body: `
              <div class="trdc-pick-intro">${_esc(m.blurb)}</div>
              <div class="trdc-pick">
                ${_termProjects.map(p => `
                  <button type="button" class="trdc-pick-row" onclick="trPickProject('${_esc(p.id)}')">
                    <span class="trdc-pick-main">
                      <span class="trdc-pick-client">${_esc(p.clientName || p.projectName || 'Untitled')}</span>
                      <span class="trdc-pick-proj">${_esc(p.projectName || '—')}</span>
                      <span class="trdc-pick-where">${_esc(p.address || 'No address on file')}</span>
                    </span>
                    <span class="trdc-pick-side">
                      <span class="trdc-pick-status">${_esc(p.status || 'active')}</span>
                      ${p.budget ? `<span class="trdc-pick-budget">${_fmtPHP(p.budget)}</span>` : ''}
                    </span>
                  </button>`).join('')}
              </div>`,
            note:    'Nothing is committed until you confirm on the next step.',
            actions: _ghostBtn('Cancel', 'trCloseCloseout()'),
        });
    }

    // The picker rows use nested <span>s so they can live inside a <button>
    // (a <div> inside a button is invalid and Safari drops the click).
    // css/closeout-dialog.css sets them to display:block where needed.

    // 'YYYY-MM-DD' → long form, built from LOCAL parts. Never `new Date(str)`
    // on a bare date: that parses as UTC and renders a day early in PH.
    //
    // The design mock reads "22 June 2026" (day-first), but en-PH — the locale
    // every other date in this app uses — renders "June 22, 2026". Matching the
    // app beats matching the mock: mixing both orders across one admin screen
    // is worse than differing from a static comp.
    const _fmtDay = (s) => {
        const mm = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!mm) return s ? String(s) : '—';
        const d = new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]));
        return isNaN(d.getTime()) ? String(s)
            : d.toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    // `mono` = tabular figures, for anything that reads as a number.
    const _field = (label, value, mono) => `
        <div class="trdc-field">
          <span class="trdc-label">${_esc(label)}</span>
          <span class="trdc-value${mono ? ' trdc-value-mono' : ''}">${_esc(value || '—')}</span>
        </div>`;

    // ── "The job" column ────────────────────────────────────
    // Client name and project name are NOT unique — the same client routinely
    // has two projects with the same project name, and then the SITE ADDRESS
    // is the only thing telling them apart. Closing out the wrong one issues a
    // real invoice to a real client, so the design's four fields are kept and
    // the client email + a short project id are added as further tiebreakers.
    function _jobColumn(p, m) {
        const shortId = String(p.id || '').slice(-6);
        return `
            <div class="trdc-job">
              <div class="trdc-eyebrow">The job</div>
              <div class="trdc-who">
                <div class="trdc-client">${_esc(p.clientName || p.projectName || 'Untitled')}</div>
                <div class="trdc-project">${_esc(p.projectName || '—')}</div>
              </div>
              <div class="trdc-fields">
                ${_field('Where', p.address)}
                ${_field('Started', _fmtDay(p.startDate))}
                ${_field('Agreed budget', p.budget ? _fmtPHP(p.budget) : '', true)}
                ${_field('Work billed', _termCalc.weekCount + ' ' + (_termCalc.weekCount === 1 ? 'entry' : 'entries'))}
                ${_field('Client', p.clientEmail)}
                ${_field('Project ID', shortId ? '…' + shortId : '')}
              </div>
            </div>`;
    }

    // ── "The money" column ──────────────────────────────────
    function _moneyColumn(c, m) {
        const owed     = Number(c.remainingBalance) || 0;
        const overpaid = Math.max(0, (Number(c.totalPaid) || 0) - (Number(c.grandTotal) || 0));
        // Site overhead sits inside directCost but not in labor or materials,
        // so it needs its own line or the breakdown won't add up.
        const other = Math.max(0, (Number(c.directCost) || 0) - (Number(c.totalLabor) || 0) - (Number(c.totalMaterials) || 0));

        const brow = (label, val) =>
            `<div class="trdc-brow"><span>${_esc(label)}</span><span class="trdc-brow-amt">${_fmtPHP(val)}</span></div>`;

        return `
            <div class="trdc-money">
              <div class="trdc-eyebrow">The money</div>

              <div class="trdc-hero">
                <div class="trdc-hero-label">Still to collect</div>
                <div class="trdc-hero-amount">${_fmtPHP(owed)}</div>
                <div class="trdc-hero-note">${owed > 0
                    ? 'A final invoice goes out for this.'
                    : 'Fully paid — no final invoice needed.'}</div>
              </div>

              <div class="trdc-rows">
                <div class="trdc-row"><span>Total cost of work</span><span class="trdc-row-amt">${_fmtPHP(c.grandTotal)}</span></div>
                <div class="trdc-row"><span>Client has paid</span><span class="trdc-row-amt">${_fmtPHP(c.totalPaid)}</span></div>
                <button type="button" class="trdc-toggle" id="trdc-toggle" onclick="trToggleBreakdown()"
                        aria-expanded="false" aria-controls="trdc-breakdown">What made up the cost?</button>
                <div class="trdc-breakdown" id="trdc-breakdown" hidden>
                  ${brow('Labour', c.totalLabor)}
                  ${brow('Materials', c.totalMaterials)}
                  ${other > 0 ? brow('Site overhead', other) : ''}
                  ${brow('Management fee', c.managementFee)}
                </div>
              </div>

              ${overpaid > 0 ? `
              <div class="trdc-warn">
                <div class="trdc-warn-icon">!</div>
                <div class="trdc-warn-text">Overpaid by <strong>${_fmtPHP(overpaid)}</strong>. Handle the refund or credit separately.</div>
              </div>` : ''}

              ${m.outcome === 'completed' ? _retentionNote(c) : ''}
            </div>`;
    }

    // Warranty retention preview — completion only. A terminated project never
    // reached the warranty stage, so it contributes nothing.
    //
    // This is the SAME derived figure the Overview KPI shows (5% of paid −
    // direct cost), and confirming the closeout freezes it into the register
    // (migration 0043). It is an accrual, not cash withheld: the client is
    // still invoiced the full amount above. Say so on the card, so nobody
    // reads it as money being held back from this final bill.
    function _retentionNote(c) {
        const { pct, months } = _wfConst();
        const net = (Number(c.totalPaid) || 0) - (Number(c.directCost) || 0);
        const amt = net * (pct / 100);
        // Negative net cash means costs outran payments. Nothing is set aside,
        // and the register stores 0 as the contribution — flag it rather than
        // print a negative "retention" the owner might read as a debt.
        if (amt <= 0) {
            return `
              <div class="trdc-retention trdc-retention-none">
                <div class="trdc-retention-label">Warranty retention</div>
                <div class="trdc-retention-note">Nothing to set aside — costs ran ahead of payments on this job.</div>
              </div>`;
        }
        return `
              <div class="trdc-retention">
                <div class="trdc-retention-label">Warranty retention (${pct}%)</div>
                <div class="trdc-retention-amount">${_fmtPHP(amt)}</div>
                <div class="trdc-retention-note">
                  Set aside to the company warranty reserve for ${months} months.
                  Recorded for tracking — it is not deducted from the final invoice above.
                </div>
              </div>`;
    }

    // Collapsible cost breakdown — the design's <sc-if> binding, in plain DOM.
    window.trToggleBreakdown = function () {
        const panel = document.getElementById('trdc-breakdown');
        const btn   = document.getElementById('trdc-toggle');
        if (!panel || !btn) return;
        const open = panel.hasAttribute('hidden');
        if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
        btn.textContent = open ? 'Hide breakdown' : 'What made up the cost?';
        btn.setAttribute('aria-expanded', String(open));
    };

    window.trPickProject = async function (id) {
        const p = _termProjects.find(x => x.id === id);
        if (!p) return;
        _termProject = p;

        const m = _mode();
        _renderCard({
            title:    m.confirmTitle,
            subtitle: m.confirmSub,
            body:     `<div class="trdc-state">Working out the final balance…</div>`,
            actions:  _ghostBtn('Back', 'trBackToPicker()'),
        });

        try {
            _termCalc = await _computeCloseout(id);
        } catch (e) {
            _renderCard({
                title:    m.confirmTitle,
                subtitle: m.confirmSub,
                body:     `<div class="trdc-state trdc-state-bad">Could not work out the final balance: ${_esc(e.message || e)}</div>`,
                actions:  _ghostBtn('Back', 'trBackToPicker()'),
            });
            return;
        }

        _renderCard({
            title:    m.confirmTitle,
            subtitle: m.confirmSub,
            body:     `<div class="trdc-split">${_jobColumn(p, m)}${_moneyColumn(_termCalc, m)}</div>`,
            note:     m.footNote,
            actions:  _ghostBtn('Not yet', 'trBackToPicker()') +
                      `<button type="button" class="trdc-btn trdc-btn-go" id="tr-terminate-go" onclick="trConfirmCloseout()">${_esc(m.confirmVerb)}</button>`,
        });
    };

    window.trConfirmCloseout = async function () {
        if (_trStaff()) { alert('Only the owner can close out a project.'); return; }
        if (_termBusy || !_termProject || !_termCalc) return;
        const m = _mode(), p = _termProject, c = _termCalc;
        const label = p.projectName || p.clientName || 'this project';
        if (!confirm(`Mark "${label}" as ${m.past}? This cannot be undone from here.`)) return;

        _termBusy = true;
        const go = document.getElementById('tr-terminate-go');
        if (go) { go.disabled = true; go.textContent = 'Working…'; }

        try {
            const clientUid = p.clientUid || await _resolveClientUid(p.clientEmail);
            const now = firebase.firestore.FieldValue.serverTimestamp();

            // The closeout record. Admin-raised, so it lands already decided —
            // there is no review step to wait on. `outcome` is what makes this
            // a completion rather than a termination.
            const ref = await db.collection('terminationRequests').add({
                clientUid,
                clientEmail      : p.clientEmail || '',
                clientName       : p.clientName || '',
                projectId        : p.id,
                projectName      : p.projectName || '',
                totalLabor       : c.totalLabor,
                totalMaterials   : c.totalMaterials,
                directCost       : c.directCost,
                managementFee    : c.managementFee,
                grandTotal       : c.grandTotal,
                totalPaid        : c.totalPaid,
                remainingBalance : c.remainingBalance,
                status           : 'approved',
                outcome          : m.outcome,
                initiatedBy      : 'admin',
                requestedAt      : now,
                decidedAt        : now,
                decidedBy        : _trEmail(),
            });

            await _applyCloseout({
                id: ref.id,
                projectId       : p.id,
                projectName     : p.projectName || '',
                clientName      : p.clientName || '',
                clientEmail     : p.clientEmail || '',
                clientUid,
                remainingBalance: c.remainingBalance,
                outcome         : m.outcome,
            });

            // Freeze the warranty retention into the register (0043) — only on
            // a COMPLETED project; a terminated one never reached warranty.
            //
            // Delegated to js/warranty-fund.js because that module is the only
            // thing allowed to write those tables (the isolation rule in
            // CLAUDE.md). Deliberately NOT awaited into the failure path: the
            // project is already closed out and the client already notified by
            // this point, so a register hiccup must not surface as "closeout
            // failed" or roll anything back. It is a tracking record, and the
            // Warranty Fund screen can re-snapshot a missing project later.
            if (m.outcome === 'completed' && typeof window.wfRecordCloseout === 'function') {
                try {
                    await window.wfRecordCloseout({
                        projectId  : p.id,
                        projectName: p.projectName || '',
                        clientName : p.clientName || '',
                        clientEmail: p.clientEmail || '',
                        closeoutId : ref.id,
                        totalPaid  : c.totalPaid,
                        directCost : c.directCost,
                    });
                } catch (e) {
                    console.error('warranty retention snapshot failed:', e);
                }
            }

            window.trCloseCloseout();
            alert(`Project ${m.past}.${c.remainingBalance > 0 ? ' Final invoice for ' + _fmtPHP(c.remainingBalance) + ' issued to the client.' : ''}`);
        } catch (e) {
            console.error('closeout error:', e);
            alert(`Could not close out the project: ` + (e.message || e));
        } finally {
            _termBusy = false;
            if (go) { go.disabled = false; go.textContent = m.confirmVerb; }
        }
    };

    // ────────────────────────────────────────────────────────
    // Shared side-effects of a closeout taking effect
    // ────────────────────────────────────────────────────────
    // Used by both admin flows above and the legacy approve path below.
    //   1) Set the project to 'completed' / 'terminated' so it stops being
    //      treated as active in pm-admin and in the client view.
    //   2) Auto-generate a final invoice for the remaining balance, so the
    //      client sees what they owe (via the existing invoice_issued
    //      notification path in invoice-module.js).
    //   3) Notify the client, in the wording that matches the outcome.
    // Each side-effect is best-effort: a partial failure must not leave the
    // caller thinking nothing happened, so failures are logged, not thrown.
    //
    // `req.outcome` drives all three. It is absent on legacy rows, which
    // were terminations, so that is the fallback.
    async function _applyCloseout(req) {
        const m = req.outcome === 'completed' ? MODES.complete : MODES.terminate;
        let finalInvoiceId = null;

        if (req.projectId) {
            const ref = db.collection('constructionProjects').doc(req.projectId);
            try {
                // terminatedAt/By double as the generic closeout stamp — the
                // columns predate completions and renaming them would break
                // every existing terminated project.
                await ref.update({
                    status:               m.projStatus,
                    terminatedAt:         firebase.firestore.FieldValue.serverTimestamp(),
                    terminatedBy:         _trEmail(),
                    terminationRequestId: req.id,
                });
            } catch (e) {
                // Migration 0042 adds terminated_at / terminated_by /
                // termination_request_id. Until it is applied, Postgres rejects
                // the WHOLE update on the unknown column — so the project stays
                // ACTIVE and the closeout looks like it worked while the card in
                // the grid never changes. The status flip is the part that
                // actually matters, so retry with just that.
                console.warn('Closeout stamp failed (' + (e.message || e) + ') — retrying with status only. Apply migration 0042 to keep the audit stamp.');
                try {
                    await ref.update({ status: m.projStatus });
                } catch (e2) {
                    console.warn('Could not set project status to ' + m.projStatus + ':', e2);
                }
            }
        }

        if (Number(req.remainingBalance) > 0 && typeof window.invGenerateFromCloseout === 'function') {
            try {
                finalInvoiceId = await window.invGenerateFromCloseout(req);
            } catch (e) {
                console.warn('Could not generate final closeout invoice:', e);
            }
        }

        if (req.clientUid) {
            await db.collection('notifications').doc(req.clientUid).collection('items').add({
                type:      m.notifType,
                message:   m.clientMsg(req.projectName || '', _fmtPHP(req.remainingBalance), !!finalInvoiceId),
                isRead:    false,
                relatedId: req.id,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            }).catch(e => console.warn('client notify error:', e));
        }

        return finalInvoiceId;
    }

    // ────────────────────────────────────────────────────────
    // Legacy approve / reject — for client requests raised before
    // termination became admin-only. No new rows arrive at `pending`.
    // ────────────────────────────────────────────────────────
    async function _decide(id, decision, reason) {
        const req = _allRequests.find(r => r.id === id);
        if (!req) return;
        const status = decision === 'approve' ? 'approved' : 'rejected';
        const update = {
            status,
            decidedAt: firebase.firestore.FieldValue.serverTimestamp(),
            decidedBy: _trEmail(),
        };
        if (decision === 'reject') update.rejectedReason = reason || '';

        try {
            await db.collection('terminationRequests').doc(id).update(update);

            if (decision === 'approve') {
                // Legacy rows are always terminations — a client request was
                // only ever "I want out", never "this finished".
                await _applyCloseout({ ...req, id, outcome: 'terminated' });
            } else if (req.clientUid) {
                await db.collection('notifications').doc(req.clientUid).collection('items').add({
                    type:      'termination_rejected',
                    message:   `Your project termination request was not approved.${reason ? ' Reason: ' + reason : ''}`,
                    isRead:    false,
                    relatedId: id,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                }).catch(e => console.warn('client notify error:', e));
            }

            window.trCloseDetail();
        } catch (e) {
            alert('Failed to update request: ' + (e.message || e));
        }
    }

    window.trApprove = function (id) {
        if (_trStaff()) { alert('Only the owner can approve a termination.'); return; }
        if (!confirm('Approve this termination request? The client will be notified.')) return;
        _decide(id, 'approve');
    };

    window.trReject = function (id) {
        if (_trStaff()) { alert('Only the owner can decide a termination.'); return; }
        const reason = prompt('Reason for rejection (shown to client):', '');
        if (reason === null) return; // user cancelled
        _decide(id, 'reject', reason.trim());
    };

    // NO auto-start on DOMContentLoaded.
    //
    // There used to be one here, and it was the reason this screen sat on
    // "Loading…" forever. It fired ~200ms after boot, while the view was still
    // hidden, and started a listener whose first get() was still in flight when
    // the boot navigation called switchView(). switchView() runs
    // runViewCleanups(), which set `cancelled = true` on that subscription — so
    // onNext never ran, the static "Loading…" row was never replaced, and the
    // cleanup had also emptied the registry, so nothing restarted it.
    //
    // The listener is view-scoped, so it is started on view ENTRY instead:
    // switchView() in admin.html calls initTerminationRequests() for
    // `terminationRequests`, pairing every teardown with a restart.
})();
