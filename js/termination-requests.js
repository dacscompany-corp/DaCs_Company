/* ============================================================
   TERMINATION REQUESTS — Admin review screen
   --------------------------------------------------------------
   Clients submit termination requests from Client Management; this
   module is the admin counterpart that lists, reviews, approves
   and rejects them. Reads/writes the `terminationRequests`
   collection. Notifies the client when a decision is made.

   Public surface (called by admin.js / inline onclicks):
     • window.initTerminationRequests() — start the listener
     • window.trFilter(status)         — filter pills
     • window.trView(id)               — open detail modal
     • window.trCloseDetail()          — close detail modal
     • window.trApprove(id)            — approve current request
     • window.trReject(id)             — reject current request
============================================================ */
(function () {
    'use strict';

    let _trUnsub = null;
    let _allRequests = [];
    let _filter = 'all';
    let _currentId = null;
    let _currentReq = null;

    const _trUid = () =>
        (window.currentDataUserId)
        || (window.auth && window.auth.currentUser && window.auth.currentUser.uid)
        || null;

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

    const _statusPill = (s) => {
        const map = {
            pending:  { bg: '#fef3c7', fg: '#92400e', label: 'Pending' },
            approved: { bg: '#dcfce7', fg: '#166534', label: 'Approved' },
            rejected: { bg: '#fee2e2', fg: '#991b1b', label: 'Rejected' },
        };
        const m = map[s] || { bg: '#e5e7eb', fg: '#374151', label: s || '—' };
        return `<span style="display:inline-block;padding:3px 10px;border-radius:99px;font-size:11.5px;font-weight:600;background:${m.bg};color:${m.fg};letter-spacing:0.02em;">${m.label}</span>`;
    };

    // ────────────────────────────────────────────────────────
    // Listener
    // ────────────────────────────────────────────────────────
    window.initTerminationRequests = function () {
        const uid = _trUid();
        if (!uid || typeof db === 'undefined') {
            _renderEmpty('Sign in to view termination requests.');
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
                _renderEmpty('Could not load termination requests: ' + err.message);
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
            badge.textContent = pending;
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

        const filtered = _filter === 'all'
            ? _allRequests
            : _allRequests.filter(r => r.status === _filter);

        if (!filtered.length) {
            tbody.innerHTML = `
                <tr><td colspan="6" style="padding:36px 14px;text-align:center;color:#9ca3af;font-size:13.5px;">
                    No ${_filter === 'all' ? '' : _esc(_filter) + ' '}termination requests.
                </td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(r => `
            <tr style="border-top:1px solid #e5e7eb;cursor:pointer;" onclick="trView('${_esc(r.id)}')">
                <td style="padding:14px;font-size:13px;color:#374151;">${_fmtDate(r.requestedAt)}</td>
                <td style="padding:14px;font-size:13.5px;font-weight:600;color:#111827;">${_esc(r.clientName || '—')}<div style="font-size:11.5px;font-weight:400;color:#6b7280;margin-top:2px;">${_esc(r.clientEmail || '')}</div></td>
                <td style="padding:14px;font-size:13px;color:#374151;">${_esc(r.projectName || '—')}</td>
                <td style="padding:14px;font-size:13.5px;color:#111827;font-weight:600;text-align:right;">${_fmtPHP(r.grandTotal)}</td>
                <td style="padding:14px;font-size:13.5px;color:#15803d;font-weight:600;text-align:right;">${_fmtPHP(r.remainingBalance)}</td>
                <td style="padding:14px;text-align:right;">${_statusPill(r.status)}</td>
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
            <div style="margin-bottom:18px;">
                <div style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Requested</div>
                <div style="font-size:13.5px;color:#374151;">${_fmtDate(req.requestedAt)}</div>
            </div>

            <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:8px;">
                <div style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:10px;">Cost Breakdown</div>
                <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;"><span style="color:#374151;">Total Labor</span><span style="color:#111827;font-weight:600;">${_fmtPHP(req.totalLabor)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;"><span style="color:#374151;">Total Materials</span><span style="color:#111827;font-weight:600;">${_fmtPHP(req.totalMaterials)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;"><span style="color:#374151;">Management Fee (15%)</span><span style="color:#111827;font-weight:600;">${_fmtPHP(req.managementFee)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;border-top:1px solid #e5e7eb;margin-top:4px;"><span style="color:#111827;font-weight:700;font-family:'Playfair Display',serif;">Grand Total</span><span style="color:#111827;font-weight:700;">${_fmtPHP(req.grandTotal)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;"><span style="color:#374151;">Already Paid</span><span style="color:#15803d;font-weight:600;">− ${_fmtPHP(req.totalPaid)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:15px;border-top:2px solid #111827;margin-top:6px;"><span style="color:#111827;font-weight:700;font-family:'Playfair Display',serif;">Final Balance Due</span><span style="color:#1A5C3A;font-weight:700;">${_fmtPHP(req.remainingBalance)}</span></div>
            </div>

            <div style="margin-top:18px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Status</span>
                ${_statusPill(req.status)}
            </div>
            ${req.rejectedReason ? `<div style="margin-top:12px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:13px;color:#991b1b;"><b>Rejection reason:</b> ${_esc(req.rejectedReason)}</div>` : ''}
        `;

        // Toggle action buttons
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

    window.trCloseDetail = function () {
        const modal = document.getElementById('tr-detail-modal');
        if (modal) modal.style.display = 'none';
        _currentId = null; _currentReq = null;
    };

    // ────────────────────────────────────────────────────────
    // Approve / Reject
    // ────────────────────────────────────────────────────────
    async function _decide(id, decision, reason) {
        const req = _allRequests.find(r => r.id === id);
        if (!req) return;
        const status = decision === 'approve' ? 'approved' : 'rejected';
        const update = {
            status,
            decidedAt: firebase.firestore.FieldValue.serverTimestamp(),
            decidedBy: (window.auth && window.auth.currentUser && window.auth.currentUser.email) || '',
        };
        if (decision === 'reject') update.rejectedReason = reason || '';

        try {
            await db.collection('terminationRequests').doc(id).update(update);

            // On APPROVAL only: complete the workflow.
            //   1) Mark the construction project itself as 'terminated' so it
            //      stops being treated as active in pm-admin and any client view.
            //   2) Auto-generate a final invoice for the remaining balance, so
            //      the client sees what they owe (via the existing invoice_issued
            //      notification path in invoice-module.js).
            // Each side-effect is best-effort: if one fails we still confirm the
            // approval to the admin and log the failure to the console — we don't
            // want a partial failure to block the primary termination action.
            let finalInvoiceId = null;
            if (decision === 'approve') {
                if (req.projectId) {
                    try {
                        await db.collection('constructionProjects').doc(req.projectId).update({
                            status:          'terminated',
                            terminatedAt:    firebase.firestore.FieldValue.serverTimestamp(),
                            terminatedBy:    (window.auth && window.auth.currentUser && window.auth.currentUser.email) || '',
                            terminationRequestId: id,
                        });
                    } catch (e) {
                        console.warn('Could not flip project status to terminated:', e);
                    }
                }
                if (Number(req.remainingBalance) > 0 && typeof window.invGenerateFromTermination === 'function') {
                    try {
                        finalInvoiceId = await window.invGenerateFromTermination(req);
                    } catch (e) {
                        console.warn('Could not generate final termination invoice:', e);
                    }
                }
            }

            // Notify the client of the decision. The message reflects what
            // actually happened — if a final invoice was created, mention it.
            if (req.clientUid) {
                let message;
                if (decision === 'approve') {
                    const owed = _fmtPHP(req.remainingBalance);
                    message = finalInvoiceId
                        ? `Your project termination request has been approved. Final invoice for ${owed} has been issued — please settle to close out the project.`
                        : `Your project termination request has been approved. Final balance due: ${owed}.`;
                } else {
                    message = `Your project termination request was not approved.${reason ? ' Reason: ' + reason : ''}`;
                }
                await db.collection('notifications').doc(req.clientUid).collection('items').add({
                    type:      decision === 'approve' ? 'termination_approved' : 'termination_rejected',
                    message,
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
        if (!confirm('Approve this termination request? The client will be notified.')) return;
        _decide(id, 'approve');
    };

    window.trReject = function (id) {
        const reason = prompt('Reason for rejection (shown to client):', '');
        if (reason === null) return; // user cancelled
        _decide(id, 'reject', reason.trim());
    };

    // Auto-start once Firebase is ready and the user is signed in.
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof firebase === 'undefined' || !firebase.auth) return;
        firebase.auth().onAuthStateChanged(u => {
            if (u && typeof window.initTerminationRequests === 'function') {
                // small delay so admin.js can resolve currentDataUserId first
                setTimeout(() => window.initTerminationRequests(), 200);
            }
        });
    });
})();
