// ════════════════════════════════════════════════════════════
// CLIENT PAYMENT MODULE
// Lets clients view and submit payment for payment requests.
// ════════════════════════════════════════════════════════════

(function () {
    'use strict';

    let _requests     = [];
    let _globalQR     = null;  // loaded from settings/paymentQR or settings/cmPaymentQR
    let _currentId    = null;  // id being paid (null = self-pay mode)
    let _selfPayData  = null;  // billing period data for self-initiated payment

    // Returns the best available admin/owner UID to send notifications to.
    // Checks (in order): current request's ownerUid, any loaded request's ownerUid,
    // then the global _clientOwnerUid derived from BOQ documents.
    function _getAdminUid() {
        if (_currentId) {
            const req = _requests.find(x => x.id === _currentId);
            if (req && req.ownerUid) return req.ownerUid;
        }
        const anyReq = _requests.find(r => r.ownerUid);
        if (anyReq) return anyReq.ownerUid;
        const profileOwner = (typeof currentProfile !== 'undefined' && currentProfile?.ownerUid) || null;
        return window._clientOwnerUid || profileOwner || null;
    }

    // Send an admin-side notification to the owner AND to every staff account
    // under that owner (each in their own separate inbox). Use this only for
    // events in modules staff can access (Payment Requests, Accomplishment/SOA,
    // Termination). For admin-only modules (Users, Clients), notify the owner
    // directly instead. Staff are found via users where ownerUid == owner.
    async function _notifyOwnerAndStaff(ownerUid, payload) {
        if (!ownerUid) return;
        const writes = [db.collection('notifications').doc(ownerUid).collection('items').add(payload)];
        try {
            const staff = await db.collection('users').where('ownerUid', '==', ownerUid).get();
            staff.forEach(d => {
                if (d.data().role === 'staff') {
                    writes.push(db.collection('notifications').doc(d.id).collection('items').add(payload));
                }
            });
        } catch (e) { console.warn('staff notify lookup failed:', e); }
        await Promise.allSettled(writes);
    }

    // ══════════════════════════════════════════════════════
    // PUBLIC ENTRY POINT
    // ══════════════════════════════════════════════════════

    window.initClientPayment = async function () {
        if (!currentUser || !currentUser.email) return;

        const listEl = document.getElementById('pr-client-list');
        if (!listEl) return;

        listEl.innerHTML = '<div style="color:#9ca3af;font-size:14px;padding:20px 0;"><div class="un-loading-spinner" style="display:inline-block;vertical-align:middle;margin-right:10px;"></div>Loading payment requests\u2026</div>';

        try {
            // Load global QR settings and payment requests in parallel
            const qrDocId = window._paymentQRDocId || 'paymentQR';
            const [qrSnap, snap] = await Promise.all([
                db.collection('settings').doc(qrDocId).get(),
                db.collection('paymentRequests')
                    .where('clientEmail', '==', currentUser.email)
                    .get()
            ]);

            _globalQR = qrSnap.exists ? qrSnap.data() : {};

            _requests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));

            // One client account can own SEVERAL construction projects. The query
            // above matches by clientEmail only, so it returns every project's
            // payment requests. Scope to the project currently open (cmProjectData)
            // — otherwise another project's billing (e.g. Dapitan) leaks into this
            // project's SOA (Total Billed, Billing Periods, Payment Requests list).
            // Non-construction portals leave cmProjectData undefined → no filter.
            const _consProjId = (typeof cmProjectData !== 'undefined' && cmProjectData) ? cmProjectData.id : null;
            if (_consProjId) {
                _requests = _requests.filter(r => r.constructionProjectId === _consProjId);
            }

            window._clientPayRequests = _requests;
            _renderList(listEl);
            _updateNavBadge();
            window.initClientSelfPay();
            if (typeof window.refreshBilledKPI === 'function') window.refreshBilledKPI();
            _checkSOWARequestState();
        } catch (e) {
            console.error('ClientPayment: load error', e);
            listEl.innerHTML = `<div style="color:#b91c1c;font-size:13.5px;padding:16px 0;">Could not load payment requests. ${_esc(e.message)}</div>`;
        }
    };

    // ══════════════════════════════════════════════════════
    // RENDER LIST
    // ══════════════════════════════════════════════════════

    function _renderOutstandingAlert() {
        const alertEl = document.getElementById('outstanding-balance-alert');
        if (!alertEl) return;
        const now = Date.now();
        const unpaid = _requests.filter(r => r.status !== 'verified' && r.status !== 'rejected');
        const overdue = unpaid.filter(r => _tsToMs(r.dueDate) && _tsToMs(r.dueDate) < now);
        const totalOutstanding = unpaid.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

        if (!unpaid.length) { alertEl.style.display = 'none'; return; }

        const overdueHtml = overdue.length
            ? `<span style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:8px;">${overdue.length} Overdue</span>`
            : '';
        alertEl.style.display = 'flex';
        alertEl.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:${overdue.length ? '#dc2626' : '#d97706'}">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style="flex:1;">
                <div style="font-weight:700;font-size:13.5px;color:${overdue.length ? '#b91c1c' : '#92400e'};">
                    Outstanding Balance: ${_formatAmount(totalOutstanding)}${overdueHtml}
                </div>
                <div style="font-size:12px;color:${overdue.length ? '#dc2626' : '#b45309'};margin-top:2px;">
                    ${unpaid.length} payment${unpaid.length > 1 ? 's' : ''} pending — please settle at your earliest convenience.
                </div>
            </div>
            <button onclick="window.showSection('billing')" style="flex-shrink:0;background:${overdue.length ? '#dc2626' : '#d97706'};color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">
                View
            </button>`;
    }

    function _renderList(listEl) {
        _renderOutstandingAlert();
        if (!_requests.length) {
            listEl.innerHTML = `<div style="padding:40px 24px;text-align:center;">
                <div style="font-size:32px;margin-bottom:10px;">🧾</div>
                <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">No payment requests yet</div>
                <div style="font-size:13px;color:#9ca3af;">Payment requests from your company will appear here.</div>
            </div>`;
            return;
        }

        listEl.innerHTML = `<div>${_requests.map(_buildRow).join('')}</div>`;

        // Init drag-and-drop on upload zones in the pay modal
        listEl.querySelectorAll('.pr-upload-zone').forEach(zone => {
            zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
            zone.addEventListener('drop', e => {
                e.preventDefault();
                zone.classList.remove('dragover');
                const file = e.dataTransfer.files?.[0];
                if (!file) return;
                const input = zone.querySelector('input[type="file"]');
                if (input) {
                    // Assign the dropped file to the input and trigger preview
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    input.files = dt.files;
                    prClientPreviewReceipt(input);
                }
            });
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function _buildCard(r) {
        const period  = _esc(r.billingPeriod || '—');
        const project = _esc(r.projectName   || '—');
        const amount  = _formatAmount(r.amount);
        const due     = _formatDate(r.dueDate);
        const statusBadge = _statusBadge(r.status);

        // Check if overdue
        const duMs = _tsToMs(r.dueDate);
        const overdue = duMs && duMs < Date.now() && r.status !== 'verified';

        let actionSection = '';
        if (r.status === 'partial_pending') {
            actionSection = `
                <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:12px;">
                    <div style="font-size:11.5px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Partial Payment Request Pending</div>
                    <div style="font-size:13px;color:#7c2d12;">Requested to pay <strong>${_formatAmount(r.requestedPartialAmount)}</strong> instead of <strong>${_formatAmount(r.amount)}</strong>.</div>
                    ${r.partialReason ? `<div style="font-size:12.5px;color:#9a3412;margin-top:5px;font-style:italic;">"${_esc(r.partialReason)}"</div>` : ''}
                    <div style="font-size:12px;color:#c2410c;margin-top:6px;">Waiting for admin approval.</div>
                    <div id="prCancelPartialWrap-${r.id}" style="margin-top:10px;">
                        <button onclick="prClientShowCancelPartial('${r.id}')" style="font-size:12px;color:#6b7280;background:none;border:1px solid #d1d5db;border-radius:6px;padding:5px 12px;cursor:pointer;">Cancel Request</button>
                    </div>
                    <div id="prCancelPartialConfirm-${r.id}" style="display:none;margin-top:10px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:8px;padding:10px 12px;">
                        <div style="font-size:12.5px;color:#b91c1c;margin-bottom:8px;">Cancel your partial payment request? The request will go back to pending full payment.</div>
                        <div style="display:flex;gap:8px;">
                            <button onclick="prClientCancelPartialRequest('${r.id}')" style="font-size:12px;color:#fff;background:#dc2626;border:none;border-radius:6px;padding:5px 14px;cursor:pointer;">Yes, Cancel</button>
                            <button onclick="prClientHideCancelPartial('${r.id}')" style="font-size:12px;color:#6b7280;background:none;border:1px solid #d1d5db;border-radius:6px;padding:5px 12px;cursor:pointer;">Keep Request</button>
                        </div>
                    </div>
                </div>`;
        } else if (r.status === 'pending' || r.status === 'rejected') {
            const rejectedNote = r.status === 'rejected' && r.rejectedReason ? `
                <div class="pr-client-rejected-note">
                    <strong>Rejected</strong>
                    ${_esc(r.rejectedReason)}
                </div>` : '';

            const partialDeclinedNote = r.partialDeclinedReason ? `
                <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                    <div style="font-size:11.5px;font-weight:700;color:#c2410c;margin-bottom:4px;">Partial Payment Request Declined</div>
                    <div style="font-size:12.5px;color:#7c2d12;">${_esc(r.partialDeclinedReason)}</div>
                    <div style="font-size:12px;color:#9a3412;margin-top:4px;">Please pay the full amount of ${_formatAmount(r.amount)}.</div>
                </div>` : '';

            const approvedNote = r.approvedPartialAmount ? `
                <div style="background:#f0fdf9;border:1.5px solid #6ee7b7;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                    <div style="font-size:11.5px;font-weight:700;color:#065f46;margin-bottom:4px;">Partial Payment Approved</div>
                    <div style="font-size:12.5px;color:#064e3b;">You may now pay <strong>${_formatAmount(r.approvedPartialAmount)}</strong>.</div>
                </div>` : '';

            actionSection = `
                ${partialDeclinedNote}
                ${approvedNote}
                ${rejectedNote}
                <button class="pr-client-pay-btn" onclick="prClientOpenPayModal('${r.id}')">
                    <i data-lucide="upload" style="width:16px;height:16px;"></i>
                    ${r.status === 'rejected' ? 'Resubmit Payment' : 'Submit Payment'}
                </button>`;
        } else if (r.status === 'submitted') {
            const paidAmt   = r.paidAmount != null && !isNaN(r.paidAmount) ? `<div style="font-size:12.5px;color:#374151;margin-top:4px;">Paid: <strong>${_formatAmount(r.paidAmount)}</strong></div>` : '';
            const refNo     = r.referenceNumber ? `<div style="font-size:12.5px;color:#374151;margin-top:4px;">Ref #: <strong>${_esc(r.referenceNumber)}</strong></div>` : '';
            const thumbHtml = r.proofBase64 ? `
                <img src="${_esc(r.proofBase64)}" alt="Your receipt"
                     style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1.5px solid #bfdbfe;flex-shrink:0;cursor:pointer;"
                     onclick="this.requestFullscreen && this.requestFullscreen()" title="View submitted receipt">` : '';
            actionSection = `
                <div class="pr-client-submitted-note" style="display:flex;align-items:flex-start;gap:12px;">
                    ${thumbHtml}
                    <div style="flex:1;">
                        <strong style="display:block;margin-bottom:4px;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px;">Payment Submitted</strong>
                        Waiting for admin verification.
                        ${paidAmt}
                        ${refNo}
                    </div>
                </div>`;
        } else if (r.status === 'verified') {
            const verifiedDate = r.verifiedAt ? _formatDate(r.verifiedAt) : '';
            actionSection = `
                <div class="pr-client-verified-badge">
                    <i data-lucide="check-circle" style="width:18px;height:18px;"></i>
                    Payment Verified${verifiedDate ? ' · ' + verifiedDate : ''}
                </div>`;
        }

        const issued = _formatDate(r.createdAt);

        return `
        <div class="pr-client-card">
            <div class="pr-client-card-header">
                <div>
                    <div class="pr-client-card-title">${period}</div>
                    <div class="pr-client-card-sub">${project}</div>
                </div>
                <div>${statusBadge}</div>
            </div>
            <div>
                <div class="pr-client-card-amount">${amount}</div>
                <div class="pr-client-card-due ${overdue ? 'overdue' : ''}">
                    Due: ${due}${overdue ? ' · Overdue' : ''}
                </div>
                <div style="font-size:11.5px;color:#9ca3af;margin-top:3px;">Issued: ${issued}</div>
            </div>
            ${actionSection}
        </div>`;
    }

    function _buildRow(r) {
        const duMs    = _tsToMs(r.dueDate);
        const overdue = duMs && duMs < Date.now() && r.status !== 'verified';

        const statusMap = {
            pending:         { color:'#d97706', bg:'#fffbeb', label:'Pending'          },
            partial_pending: { color:'#c2410c', bg:'#ffedd5', label:'Awaiting Approval' },
            submitted:       { color:'#1d4ed8', bg:'#eff6ff', label:'Under Review'     },
            verified:        { color:'#065f46', bg:'#d1fae5', label:'Paid'             },
            rejected:        { color:'#b91c1c', bg:'#fee2e2', label:'Rejected'         },
        };
        const st = statusMap[r.status] || { color:'#6b7280', bg:'#f3f4f6', label: r.status };

        // Icon background per status
        const iconBg = { pending:'#fef9ee', submitted:'#eff6ff', verified:'#ecfdf5', rejected:'#fff5f5', partial_pending:'#fff7ed' };
        const iconColor = { pending:'#f59e0b', submitted:'#3b82f6', verified:'#00a85e', rejected:'#ef4444', partial_pending:'#ea580c' };

        // Action
        let actionHtml = '';
        if (r.status === 'pending' || r.status === 'rejected') {
            actionHtml = `<button onclick="prClientOpenPayModal('${r.id}')"
                style="background:#00a85e;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:opacity .2s;"
                onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
                ${r.status === 'rejected' ? 'Resubmit' : 'Pay Now'}
            </button>`;
        } else if (r.status === 'partial_pending') {
            actionHtml = `<button onclick="prClientShowCancelPartial('${r.id}')"
                style="background:none;color:#c2410c;border:1.5px solid #fed7aa;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;">
                Cancel Request
            </button>`;
        } else if (r.status === 'verified') {
            actionHtml = `<button onclick="prPrintClientInvoice('${r.id}')"
                style="display:inline-flex;align-items:center;gap:6px;background:#f8fafc;color:#374151;border:1.5px solid #e5e7eb;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .2s;"
                onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#f8fafc'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                </svg>
                View Invoice
            </button>`;
        }

        // Note strip
        let noteHtml = '';
        if (r.status === 'rejected' && r.rejectedReason) {
            noteHtml = `<div style="padding:10px 22px 10px 80px;background:#fff5f5;border-top:1px solid #fee2e2;font-size:12.5px;color:#b91c1c;">
                <strong>Rejection reason:</strong> ${_esc(r.rejectedReason)}</div>`;
        } else if (r.status === 'partial_pending') {
            noteHtml = `<div style="padding:10px 22px 10px 80px;background:#fff7ed;border-top:1px solid #fed7aa;font-size:12.5px;color:#c2410c;">
                Partial payment of <strong>${_formatAmount(r.requestedPartialAmount)}</strong> pending admin approval.
                <div id="prCancelPartialConfirm-${r.id}" style="display:none;margin-top:8px;display:flex;gap:8px;align-items:center;">
                    <span style="font-size:12px;color:#374151;">Cancel this request?</span>
                    <button onclick="prClientCancelPartialRequest('${r.id}')" style="font-size:12px;color:#fff;background:#dc2626;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;">Yes, Cancel</button>
                    <button onclick="prClientHideCancelPartial('${r.id}')" style="font-size:12px;color:#6b7280;background:none;border:1px solid #d1d5db;border-radius:6px;padding:4px 10px;cursor:pointer;">Keep</button>
                </div>
            </div>`;
        } else if (r.approvedPartialAmount && r.status !== 'verified') {
            noteHtml = `<div style="padding:10px 22px 10px 80px;background:#f0fdf9;border-top:1px solid #6ee7b7;font-size:12.5px;color:#065f46;">
                Partial payment approved — please pay <strong>${_formatAmount(r.approvedPartialAmount)}</strong>.</div>`;
        } else if (r.status === 'submitted' && r.referenceNumber) {
            noteHtml = `<div style="padding:10px 22px 10px 22px;background:#eff6ff;border-top:1px solid #bfdbfe;font-size:12.5px;color:#1d4ed8;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <span>Ref #: <strong>${_esc(r.referenceNumber)}</strong>${r.paidAmount ? ` &nbsp;·&nbsp; Paid: <strong>${_formatAmount(r.paidAmount)}</strong>` : ''} &nbsp;·&nbsp; Awaiting admin verification.</span>
                <button onclick="navigator.clipboard.writeText('${_esc(r.referenceNumber)}').then(()=>{this.textContent='Copied!';setTimeout(()=>{this.innerHTML='<svg width=\\'11\\' height=\\'11\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><rect x=\\'9\\' y=\\'9\\' width=\\'13\\' height=\\'13\\' rx=\\'2\\'/><path d=\\'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\\'/></svg> Copy Ref #\\'};this.innerHTML=\\'<svg width=\\'11\\' height=\\'11\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><rect x=\\'9\\' y=\\'9\\' width=\\'13\\' height=\\'13\\' rx=\\'2\\'/><path d=\\'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\\'/></svg> Copy Ref #\\'},2000);})"
                    style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:#1d4ed8;background:#dbeafe;border:1px solid #bfdbfe;border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Copy Ref #
                </button>
            </div>`;
        } else if (r.status === 'verified') {
            const paid   = r.paidAmount != null ? r.paidAmount : r.amount;
            const billed = r.amount || 0;
            const bal    = billed - paid;
            noteHtml = `<div style="padding:10px 22px;background:#f0fdf9;border-top:1px solid #6ee7b7;font-size:12.5px;display:flex;gap:20px;flex-wrap:wrap;">
                <span style="color:#065f46;">Billed: <strong>${_formatAmount(billed)}</strong></span>
                <span style="color:#065f46;">Paid: <strong>${_formatAmount(paid)}</strong></span>
                <span style="color:${bal > 0.01 ? '#dc2626' : '#065f46'};">Balance: <strong>${_formatAmount(bal)}</strong></span>
                ${r.referenceNumber ? `<span style="color:#6b7280;">Ref #: <strong>${_esc(r.referenceNumber)}</strong></span>` : ''}
            </div>`;
        }

        // Due date countdown
        let countdownText = '';
        if (duMs && r.status !== 'verified') {
            const diffDays = Math.ceil((duMs - Date.now()) / 86400000);
            if (overdue) countdownText = `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? 's' : ''}`;
            else if (diffDays === 0) countdownText = 'Due today';
            else if (diffDays <= 7) countdownText = `Due in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
            else countdownText = `Due ${_formatDate(r.dueDate)}`;
        } else if (duMs && r.status === 'verified') {
            countdownText = _formatDate(r.dueDate);
        }
        const dueDisplay = duMs
            ? `<span style="color:${overdue ? '#dc2626' : (countdownText.startsWith('Due in') && parseInt(countdownText.split(' ')[2]) <= 3 ? '#d97706' : '#6b7280')};font-weight:${overdue ? '700' : '400'};">${countdownText}</span>`
            : '';

        // Payment timeline
        const steps = ['Pending', 'Under Review', 'Paid'];
        const stepIdx = { pending: 0, partial_pending: 0, rejected: 0, submitted: 1, verified: 2 };
        const currentStep = stepIdx[r.status] ?? 0;
        const timelineHtml = `
            <div style="display:flex;align-items:center;gap:0;padding:10px 22px 12px 22px;background:#fafafa;border-top:1px solid #f1f5f9;">
                ${steps.map((step, i) => {
                    const done = i < currentStep;
                    const active = i === currentStep && r.status !== 'rejected';
                    const rejected = r.status === 'rejected' && i === 0;
                    const color = rejected ? '#dc2626' : done ? '#00a85e' : active ? '#2563eb' : '#d1d5db';
                    const bgColor = rejected ? '#fee2e2' : done ? '#ecfdf5' : active ? '#eff6ff' : '#f3f4f6';
                    const label = rejected && i === 0 ? 'Rejected' : step;
                    return `
                        <div style="display:flex;align-items:center;flex:1;min-width:0;">
                            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
                                <div style="width:24px;height:24px;border-radius:50%;background:${bgColor};border:2px solid ${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                    ${done ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
                                           : `<div style="width:8px;height:8px;border-radius:50%;background:${active||rejected ? color : '#d1d5db'};"></div>`}
                                </div>
                                <span style="font-size:10.5px;font-weight:${active||done ? '700' : '400'};color:${color};white-space:nowrap;">${label}</span>
                            </div>
                            ${i < steps.length - 1 ? `<div style="height:2px;flex:1;background:${done ? '#00a85e' : '#e5e7eb'};margin:0 4px;margin-bottom:18px;"></div>` : ''}
                        </div>`;
                }).join('')}
            </div>`;


        return `
        <div style="border-bottom:1px solid #f3f4f6;">
            <div class="pr-client-row-inner">
                <div style="width:42px;height:42px;border-radius:10px;background:${iconBg[r.status]||'#f3f4f6'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor[r.status]||'#9ca3af'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                    </svg>
                </div>
                <div class="pr-client-row-text">
                    <div style="font-size:14px;font-weight:700;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(r.billingPeriod || '—')}</div>
                    <div style="font-size:12px;color:${overdue ? '#dc2626' : '#9ca3af'};margin-top:2px;font-weight:${overdue ? '600' : '400'};">${_esc(r.projectName || '')}${dueDisplay ? (r.projectName ? ' &nbsp;·&nbsp; ' : '') + dueDisplay.replace(/<[^>]*>/g,'').trim() : ''}</div>
                </div>
                <div class="pr-client-row-right">
                    <div style="font-size:15px;font-weight:800;color:#1f2937;white-space:nowrap;">${_formatAmount(r.amount)}</div>
                    <span style="display:inline-block;margin-top:4px;background:${st.bg};color:${st.color};font-size:11px;font-weight:700;padding:2px 10px;border-radius:99px;">${st.label}</span>
                </div>
                ${actionHtml ? `<div class="pr-client-row-action">${actionHtml}</div>` : ''}
            </div>
            ${timelineHtml}
            ${noteHtml}
        </div>`;
    }

    // ══════════════════════════════════════════════════════
    // PAY MODAL
    // ══════════════════════════════════════════════════════

    window.prClientOpenPayModal = function (id) {
        const r = _requests.find(x => x.id === id);
        if (!r) return;

        _currentId = id;

        const modal = document.getElementById('prClientPayModal');
        if (!modal) return;

        // Set up payment method tabs using global QR settings
        const hasGcash = !!(_globalQR?.gcashQrBase64);
        const hasBank  = !!(_globalQR?.bankQrBase64);
        const tabsWrap = document.getElementById('prMethodTabsWrap');
        const tabGcash = document.getElementById('prTabGcash');
        const tabBank  = document.getElementById('prTabBank');

        const tabsVisible = hasGcash && hasBank;
        if (tabsWrap) { tabsWrap.style.display = tabsVisible ? 'block' : 'none'; tabsWrap.dataset.hasQr = tabsVisible ? 'true' : 'false'; }
        if (tabGcash) tabGcash.style.display  = hasGcash ? '' : 'none';
        if (tabBank)  tabBank.style.display   = hasBank  ? '' : 'none';

        // Show first available method
        const defaultMethod = hasGcash ? 'gcash' : (hasBank ? 'bank' : 'any');
        _setQRForMethod(defaultMethod);

        // Reset tab active state
        if (tabGcash) tabGcash.classList.toggle('active', defaultMethod !== 'bank');
        if (tabBank)  tabBank.classList.toggle('active',  defaultMethod === 'bank');

        // Hide self-pay description field
        const descWrap = document.getElementById('prSelfPayDescWrap');
        if (descWrap) descWrap.style.display = 'none';

        // Set billing period heading
        const titleEl = document.getElementById('prClientPayTitle');
        if (titleEl) titleEl.textContent = r.billingPeriod || 'Payment';

        // Set requested amount display
        const amtEl = document.getElementById('prClientPayAmount');
        if (amtEl) amtEl.textContent = _formatAmount(r.amount);

        // Pre-fill amount input; handle admin-approved partial case
        const amtInput = document.getElementById('prClientAmountInput');
        const reqAmtEl = document.getElementById('prClientRequestedAmt');
        const btn      = document.getElementById('prClientSubmitBtn');
        if (amtInput) {
            if (r.approvedPartialAmount) {
                // Admin approved a specific partial — lock to that amount
                amtInput.value             = r.approvedPartialAmount;
                amtInput.dataset.requested = r.approvedPartialAmount; // matches entered → no partial trigger
                amtInput.readOnly          = true;
                amtInput.style.background  = '#f0fdf9';
                amtInput.style.borderColor = '#6ee7b7';
                if (reqAmtEl) reqAmtEl.innerHTML =
                    `<span style="color:#065f46;font-weight:600;">Admin approved: ${_formatAmount(r.approvedPartialAmount)}</span>` +
                    ` <span style="text-decoration:line-through;color:#9ca3af;">${_formatAmount(r.amount)}</span>`;
            } else {
                amtInput.value             = r.amount || '';
                amtInput.dataset.requested = r.amount || 0;
                amtInput.readOnly          = false;
                amtInput.style.background  = '';
                amtInput.style.borderColor = '';
                if (reqAmtEl) reqAmtEl.textContent = _formatAmount(r.amount);
            }
        }

        // Reset button mode and partial reason section
        if (btn) { btn.textContent = 'Submit Payment'; btn.dataset.mode = 'submit'; }
        const reasonWrap = document.getElementById('prPartialReasonWrap');
        const reasonTA   = document.getElementById('prPartialReason');
        if (reasonWrap) reasonWrap.style.display = 'none';
        if (reasonTA)   reasonTA.value = '';

        // Ensure QR and proof sections are visible (they may have been hidden in partial-request mode)
        const qrSection    = document.getElementById('prQRSection');
        const proofSection = document.getElementById('prPaymentProofSection');
        if (qrSection)    qrSection.style.display    = (hasGcash || hasBank) ? '' : 'none';
        if (proofSection) proofSection.style.display  = '';
        // Always start on Step 1 (details + terms).
        prSelfPaySetStep(1);

        // Reset form
        const refInput = document.getElementById('prClientRefInput');
        if (refInput) refInput.value = '';

        const fileInput = document.getElementById('prClientReceiptFile');
        if (fileInput) fileInput.value = '';

        const preview = document.getElementById('prClientReceiptPreview');
        if (preview) { preview.style.display = 'none'; preview.querySelector('img').src = ''; }
        const hint = document.getElementById('prUploadZoneHint');
        if (hint) hint.style.display = '';

        const errDiv = document.getElementById('prClientPayError');
        if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }

        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    function _setQRForMethod(method) {
        const qrImg = document.getElementById('prClientQRImg');
        if (!qrImg) return;
        let src = '';
        if (method === 'gcash')      src = _globalQR?.gcashQrBase64 || '';
        else if (method === 'bank')  src = _globalQR?.bankQrBase64  || '';
        else                         src = _globalQR?.gcashQrBase64 || _globalQR?.bankQrBase64 || '';
        qrImg.src = src;
        qrImg.style.display = src ? 'block' : 'none';
    }

    window.prSwitchPayMethod = function (method) {
        _setQRForMethod(method);
        document.getElementById('prTabGcash')?.classList.toggle('active', method === 'gcash');
        document.getElementById('prTabBank')?.classList.toggle('active',  method === 'bank');
    };

    // ── Pay modal wizard: Step 1 (pay via QR) → Step 2 (details + submit) ──
    // 3 steps: 1 = details + terms, 2 = pay (method + QR), 3 = proof (ref + receipt)
    function prSelfPaySetStep(n) {
        const set = (id, show) => { const e = document.getElementById(id); if (e) e.style.display = show ? '' : 'none'; };
        set('prPayStep1',        n === 1);
        set('prPayStep2',        n === 2);
        set('prPayStep3',        n === 3);
        set('prStep1NextBtn',    n === 1);   // footer: Continue (step 1)
        set('prStep2NextBtn',    n === 2);   // footer: Continue (step 2)
        set('prClientSubmitBtn', n === 3);   // footer: Submit Payment (step 3, gated by terms)
    }
    window.prSelfPayGoStep = function (n) { prSelfPaySetStep(n); };

    // Step 1 → 2: validate details + require the Terms agreement.
    // (A partial-approval request submits directly from step 1 — no QR/proof/terms.)
    window.prStep1Next = function () {
        const submitBtn = document.getElementById('prClientSubmitBtn');
        if (submitBtn && submitBtn.dataset.mode === 'partial') { prClientHandlePayment(); return; }
        const errDiv  = document.getElementById('prClientPayError');
        const mark    = (id, on) => { const e = document.getElementById(id); if (e) e.style.borderColor = on ? '#dc2626' : ''; };
        const showErr = (m, id) => { if (errDiv) { errDiv.textContent = m; errDiv.style.display = 'block'; } if (id) { mark(id, true); document.getElementById(id)?.focus?.(); } };
        // reset error state each attempt
        if (errDiv) errDiv.style.display = 'none';
        mark('prClientAmountInput', false); mark('prSelfPayDesc', false); mark('prTCAgreeBox', false);

        const amtRaw = (document.getElementById('prClientAmountInput')?.value || '').trim().replace(/,/g, '');
        const amt    = parseFloat(amtRaw);
        if (!amtRaw || isNaN(amt) || amt <= 0) return showErr('Please enter a valid payment amount.', 'prClientAmountInput');
        const descWrap = document.getElementById('prSelfPayDescWrap');
        if (descWrap && descWrap.style.display !== 'none') {
            const desc = (document.getElementById('prSelfPayDesc')?.value || '').trim();
            if (!desc) return showErr('Please enter a payment description.', 'prSelfPayDesc');
        }
        const cb = document.getElementById('prTCCheckbox');
        if (!cb || !cb.checked) return showErr('Please agree to the Terms & Conditions to continue.', 'prTCAgreeBox');
        prSelfPaySetStep(2);
    };
    // Step 2 → 3
    window.prStep2Next = function () { prSelfPaySetStep(3); };

    window.prCheckPartialAmount = function () {
        const input        = document.getElementById('prClientAmountInput');
        const reasonWrap   = document.getElementById('prPartialReasonWrap');
        const reasonTA     = document.getElementById('prPartialReason');
        const btn          = document.getElementById('prClientSubmitBtn');
        const qrSection    = document.getElementById('prQRSection');
        const proofSection = document.getElementById('prPaymentProofSection');
        const tabsWrap     = document.getElementById('prMethodTabsWrap');
        if (!input || !reasonWrap || !btn) return;
        const entered   = parseFloat((input.value || '').replace(/,/g, ''));
        const requested = parseFloat(input.dataset.requested || 0);
        const isPartial = !isNaN(entered) && requested > 0 && !isNaN(requested) && Math.abs(entered - requested) > 0.01;
        reasonWrap.style.display = isPartial ? 'block' : 'none';
        if (!isPartial && reasonTA) reasonTA.value = '';
        // In partial-request mode: hide QR and proof fields (not paying yet, just requesting approval)
        if (qrSection)    qrSection.style.display    = isPartial ? 'none' : '';
        if (proofSection) proofSection.style.display  = isPartial ? 'none' : '';
        if (tabsWrap) {
            tabsWrap.style.display = isPartial ? 'none' : (tabsWrap.dataset.hasQr === 'true' ? 'block' : 'none');
        }
        if (isPartial) {
            btn.textContent    = 'Request Partial Approval';
            btn.dataset.mode   = 'partial';
        } else {
            btn.textContent    = 'Submit Payment';
            btn.dataset.mode   = 'submit';
        }
    };

    // Routes to either submit or partial-request based on mode
    window.prClientHandlePayment = function () {
        const btn = document.getElementById('prClientSubmitBtn');
        if (btn?.dataset.mode === 'partial') {
            prClientRequestPartial();
        } else {
            prClientSubmitPayment();
        }
    };

    // Sends a partial payment approval request to admin (no proof upload needed yet)
    window.prClientRequestPartial = async function () {
        const errDiv = document.getElementById('prClientPayError');
        const btn    = document.getElementById('prClientSubmitBtn');
        function showErr(msg) { if (errDiv) { errDiv.textContent = msg; errDiv.style.display = 'block'; } }
        function clearErr()   { if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; } }
        clearErr();

        const paidAmountRaw = (document.getElementById('prClientAmountInput')?.value || '').trim().replace(/,/g, '');
        const paidAmount    = parseFloat(paidAmountRaw);
        if (!paidAmountRaw || isNaN(paidAmount) || paidAmount <= 0) return showErr('Please enter a valid amount.');
        const partialReason = (document.getElementById('prPartialReason')?.value || '').trim();
        if (!partialReason) return showErr('Please provide a reason for the partial payment.');

        if (btn) { btn.disabled = true; btn.textContent = 'Sending Request…'; }
        try {
            await db.collection('paymentRequests').doc(_currentId).update({
                status:                 'partial_pending',
                requestedPartialAmount: paidAmount,
                partialReason,
                partialRequestedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            const req = _requests.find(x => x.id === _currentId);
            if (req) {
                req.status                 = 'partial_pending';
                req.requestedPartialAmount = paidAmount;
                req.partialReason          = partialReason;
            }
            // Notify the admin about the partial payment request
            const _partialAdminUid = _getAdminUid();
            if (_partialAdminUid) {
                const _partialReq  = _requests.find(x => x.id === _currentId) || {};
                const _clientEmail = (typeof currentUser !== 'undefined' && currentUser?.email) || '';
                _notifyOwnerAndStaff(_partialAdminUid, {
                    type:      'partial_request',
                    message:   `${_clientEmail || 'A client'} requested a partial payment of ₱${paidAmount.toLocaleString('en-PH')}${_partialReq.billingPeriod ? ' for "' + _partialReq.billingPeriod + '"' : ''}`,
                    isRead:    false,
                    relatedId: _currentId || '',
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                }).catch(e => console.warn('Notification error:', e));
            }

            prClientClosePayModal();
            const listEl = document.getElementById('pr-client-list');
            if (listEl) _renderList(listEl);
            _updateNavBadge();
            _showClientToast('Partial payment request sent. Waiting for admin approval.');
        } catch (e) {
            console.error('ClientPayment: partial request error', e);
            showErr('Error sending request: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Request Partial Approval'; }
        }
    };

    window.prClientClosePayModal = function () {
        const modal = document.getElementById('prClientPayModal');
        if (modal) modal.style.display = 'none';
        _currentId   = null;
        _selfPayData = null;
    };

    // ── Self-initiated payment (no admin request needed) ──
    window.prClientOpenSelfPayModal = function (data) {
        // data is optional — if not provided, client fills everything in manually
        _currentId   = null;
        _selfPayData = data || {};

        const modal = document.getElementById('prClientPayModal');
        if (!modal) return;

        // QR setup
        const hasGcash = !!(_globalQR?.gcashQrBase64);
        const hasBank  = !!(_globalQR?.bankQrBase64);
        const tabsWrap = document.getElementById('prMethodTabsWrap');
        const tabGcash = document.getElementById('prTabGcash');
        const tabBank  = document.getElementById('prTabBank');
        const tabsVisible = hasGcash && hasBank;
        if (tabsWrap) { tabsWrap.style.display = tabsVisible ? 'block' : 'none'; }
        if (tabGcash) tabGcash.style.display = hasGcash ? '' : 'none';
        if (tabBank)  tabBank.style.display  = hasBank  ? '' : 'none';
        const defaultMethod = hasGcash ? 'gcash' : (hasBank ? 'bank' : 'any');
        _setQRForMethod(defaultMethod);
        if (tabGcash) tabGcash.classList.toggle('active', defaultMethod !== 'bank');
        if (tabBank)  tabBank.classList.toggle('active',  defaultMethod === 'bank');

        // Title & amount
        const titleEl = document.getElementById('prClientPayTitle');
        if (titleEl) titleEl.textContent = 'Self Payment';
        const amtEl = document.getElementById('prClientPayAmount');
        if (amtEl) amtEl.textContent = '';

        // Show self-pay fields, auto-fill month
        const descWrap = document.getElementById('prSelfPayDescWrap');
        const descInput = document.getElementById('prSelfPayDesc');
        const monthInput = document.getElementById('prSelfPayMonth');
        if (descWrap) descWrap.style.display = '';
        if (descInput) descInput.value = '';
        if (monthInput) {
            const now = new Date();
            monthInput.value = now.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
        }
        const reqAmtEl = document.getElementById('prClientRequestedAmt');
        if (reqAmtEl) reqAmtEl.closest?.('.pr-form-group') && (reqAmtEl.parentElement.parentElement.querySelector('div:last-child').style.display = 'none');

        // Amount input — blank, client fills in
        const amtInput = document.getElementById('prClientAmountInput');
        if (amtInput) {
            amtInput.value             = '';
            amtInput.dataset.requested = 0;
            amtInput.readOnly          = false;
            amtInput.style.background  = '';
            amtInput.style.borderColor = '';
        }

        // Reset
        const btn = document.getElementById('prClientSubmitBtn');
        if (btn) { btn.textContent = 'Submit Payment'; btn.dataset.mode = 'submit'; btn.disabled = false; }
        const reasonWrap = document.getElementById('prPartialReasonWrap');
        const reasonTA   = document.getElementById('prPartialReason');
        if (reasonWrap) reasonWrap.style.display = 'none';
        if (reasonTA)   reasonTA.value = '';
        const refInput  = document.getElementById('prClientRefInput');
        if (refInput) refInput.value = '';
        const fileInput = document.getElementById('prClientReceiptFile');
        if (fileInput) fileInput.value = '';
        const preview = document.getElementById('prClientReceiptPreview');
        if (preview) preview.style.display = 'none';
        const hint = document.getElementById('prUploadZoneHint');
        if (hint) hint.style.display = '';
        const errDiv = document.getElementById('prClientPayError');
        if (errDiv) errDiv.style.display = 'none';
        const qrSection    = document.getElementById('prQRSection');
        const proofSection = document.getElementById('prPaymentProofSection');
        // Only show the "Scan to Pay" QR block when a company QR is configured;
        // otherwise it's just an empty label.
        if (qrSection)    qrSection.style.display    = (hasGcash || hasBank) ? '' : 'none';
        if (proofSection) proofSection.style.display  = '';

        // Always start on Step 1 (details + terms).
        prSelfPaySetStep(1);

        modal.style.display = 'flex';
    };

    // ── Cancel Partial Request ──
    window.prClientShowCancelPartial = function (id) {
        document.getElementById(`prCancelPartialConfirm-${id}`).style.display = 'block';
    };

    window.prClientHideCancelPartial = function (id) {
        document.getElementById(`prCancelPartialConfirm-${id}`).style.display = 'none';
    };

    window.prClientCancelPartialRequest = async function (id) {
        try {
            await db.collection('paymentRequests').doc(id).update({
                status:                 'pending',
                requestedPartialAmount: null,
                partialReason:          null,
                partialRequestedAt:     null
            });
            const req = _requests.find(x => x.id === id);
            if (req) {
                req.status                 = 'pending';
                req.requestedPartialAmount = null;
                req.partialReason          = null;
            }
            const listEl = document.getElementById('pr-client-list');
            if (listEl) _renderList(listEl);
            _updateNavBadge();
            _showClientToast('Partial payment request cancelled.');
        } catch (e) {
            console.error('ClientPayment: cancel partial error', e);
            _showClientToast('Could not cancel request: ' + e.message, true);
        }
    };

    // ── Receipt Preview ──
    window.prClientPreviewReceipt = function (input) {
        const file    = input.files && input.files[0];
        const preview = document.getElementById('prClientReceiptPreview');
        const hint    = document.getElementById('prUploadZoneHint');
        if (!preview) return;
        const img = preview.querySelector('img');
        if (file) {
            const reader = new FileReader();
            reader.onload = e => {
                if (img) img.src = e.target.result;
                preview.style.display = 'flex';
                if (hint) hint.style.display = 'none';
            };
            reader.readAsDataURL(file);
        } else {
            if (img) img.src = '';
            preview.style.display = 'none';
            if (hint) hint.style.display = '';
        }
    };

    // ── Submit Payment ──
    window.prClientSubmitPayment = async function () {
        const errDiv = document.getElementById('prClientPayError');
        const btn    = document.getElementById('prClientSubmitBtn');

        function showErr(msg) {
            if (errDiv) { errDiv.textContent = msg; errDiv.style.display = 'block'; }
        }
        function clearErr() {
            if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }
        }
        clearErr();

        if (!_currentId && !_selfPayData) return showErr('No payment request selected.');

        const paidAmountRaw   = (document.getElementById('prClientAmountInput')?.value || '').trim().replace(/,/g, '');
        const referenceNumber = (document.getElementById('prClientRefInput')?.value || '').trim();
        const receiptFile     = document.getElementById('prClientReceiptFile')?.files?.[0];

        const paidAmount = parseFloat(paidAmountRaw);
        if (!paidAmountRaw || isNaN(paidAmount) || paidAmount <= 0) return showErr('Please enter a valid payment amount.');

        // If partial, reason is required
        const amtInput    = document.getElementById('prClientAmountInput');
        const requested   = parseFloat(amtInput?.dataset.requested || 0);
        const isPartial   = requested > 0 && Math.abs(paidAmount - requested) > 0.01;
        const partialReason = (document.getElementById('prPartialReason')?.value || '').trim();
        if (isPartial && !partialReason) return showErr('Please provide a reason for paying a different amount.');

        if (!referenceNumber) return showErr('Please enter your reference number.');
        if (!receiptFile)     return showErr('Please upload your receipt image.');

        if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

        try {
            // 1. Compress + convert receipt to base64 (avoids CORS/Storage issues)
            const proofBase64 = await _compressImageToBase64(receiptFile, 1200, 0.75);

            const now = firebase.firestore.FieldValue.serverTimestamp();

            if (_selfPayData !== null) {
                // Self-initiated: create a new payment request
                // currentProfile is the cost-plus portal's global; cmCurrentProfile is
                // the construction portal's. Use whichever this page defines.
                const profile  = (typeof currentProfile   !== 'undefined' && currentProfile)   ? currentProfile
                               : (typeof cmCurrentProfile !== 'undefined' && cmCurrentProfile) ? cmCurrentProfile
                               : {};
                const user     = typeof currentUser    !== 'undefined' ? currentUser    : {};
                const descVal  = (document.getElementById('prSelfPayDesc')?.value  || '').trim();
                const monthVal = (document.getElementById('prSelfPayMonth')?.value || '').trim();
                if (!descVal) { if (btn) { btn.disabled = false; btn.textContent = 'Submit Payment'; } return showErr('Please enter a payment description.'); }
                // client_uid + owner_id are uuid columns — must be null (not '') when unknown.
                // Owner falls back to the client's own profile owner so the payment isn't orphaned.
                const _ownerUid = window._clientOwnerUid || profile.ownerUid || null;
                // Construction portal (client-management-app.js defines cmProjectData):
                // link the self-payment to the project so it surfaces — and gets verified —
                // in the admin's Money → Payment table. The cost-plus portal leaves these unset.
                const _consProj       = (typeof cmProjectData !== 'undefined' && cmProjectData) ? cmProjectData : null;
                const _isConstruction = !!_consProj;
                const newReq  = {
                    kind:            _isConstruction ? 'construction' : 'cost_plus',
                    clientUid:       user.uid          || null,
                    clientEmail:     user.email        || '',
                    clientName:      (profile.firstName ? profile.firstName + ' ' + (profile.lastName || '') : user.email || '').trim(),
                    billingPeriod:   monthVal ? `${descVal} – ${monthVal}` : descVal,
                    projectName:     _selfPayData.projectName || '',
                    amount:          paidAmount,
                    dueDate:         null,
                    notes:           'Client-initiated payment',
                    status:          'submitted',
                    createdAt:       now,
                    createdBy:       user.email || '',
                    ownerUid:        _ownerUid,
                    proofBase64,
                    referenceNumber,
                    paidAmount,
                    partialReason:   isPartial ? partialReason : null,
                    submittedAt:     now,
                    verifiedAt:      null,
                    verifiedBy:      null,
                    rejectedReason:  null,
                    rejectedAt:      null,
                    // Construction-only: surface in the project's Money → Payment table.
                    // weekEndingDate gives the row a date + sort key (stand-alone, not tied
                    // to a weekly bill); amountPaid stays 0 until the admin approves the receipt.
                    ...(_isConstruction ? {
                        constructionProjectId: _consProj.id,
                        source:                'self_payment',
                        weekEndingDate:        _localDateKey(),
                        totalAmount:           paidAmount,
                        amountPaid:            0,
                        carryover:             0
                    } : {})
                };
                const ref = await db.collection('paymentRequests').add(newReq);
                _requests.unshift({ id: ref.id, ...newReq });
                window._clientPayRequests = _requests;
            } else {
                // Existing request: update it
                await db.collection('paymentRequests').doc(_currentId).update({
                    status:        'submitted',
                    proofBase64,
                    referenceNumber,
                    paidAmount,
                    partialReason: isPartial ? partialReason : null,
                    submittedAt:   now
                });
                const req = _requests.find(x => x.id === _currentId);
                if (req) {
                    req.status          = 'submitted';
                    req.proofBase64     = proofBase64;
                    req.referenceNumber = referenceNumber;
                    req.paidAmount      = paidAmount;
                    req.partialReason   = isPartial ? partialReason : null;
                    req.submittedAt     = new Date();
                }
            }

            // Notify the admin that a payment was submitted
            const _adminUid = _getAdminUid();
            const _payBillingPeriod = _selfPayData !== null
                ? (document.getElementById('prSelfPayDesc')?.value || '').trim()
                : (_requests.find(x => x.id === _currentId)?.billingPeriod || '');
            if (_adminUid) {
                const _clientEmail = (typeof currentUser !== 'undefined' && currentUser?.email) || '';
                _notifyOwnerAndStaff(_adminUid, {
                    type:      'payment_submitted',
                    message:   `${_clientEmail || 'A client'} submitted payment${_payBillingPeriod ? ' for "' + _payBillingPeriod + '"' : ''} — ₱${paidAmount.toLocaleString('en-PH')}`,
                    isRead:    false,
                    relatedId: _currentId || '',
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                }).catch(e => console.warn('Notification error:', e));
            }

            // Notify the client themselves that their payment was submitted
            const _clientUid = (typeof currentUser !== 'undefined' && currentUser?.uid) || null;
            if (_clientUid) {
                db.collection('notifications').doc(_clientUid).collection('items').add({
                    type:      'payment_submitted',
                    message:   `Your payment${_payBillingPeriod ? ' for "' + _payBillingPeriod + '"' : ''} of ₱${paidAmount.toLocaleString('en-PH')} has been submitted and is awaiting verification.`,
                    isRead:    false,
                    relatedId: _currentId || '',
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                }).catch(e => console.warn('Client notification error:', e));
            }

            prClientClosePayModal();

            const listEl = document.getElementById('pr-client-list');
            if (listEl) _renderList(listEl);
            _updateNavBadge();
            window.initClientSelfPay();
            _showClientToast('Payment submitted! Please wait for admin verification.');

        } catch (e) {
            console.error('ClientPayment: submit error', e);
            showErr('Error submitting payment: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Submit Payment'; }
        }
    };

    // ══════════════════════════════════════════════════════
    // NAV BADGE
    // ══════════════════════════════════════════════════════

    function _updateNavBadge() {
        const badge = document.getElementById('billing-badge');
        if (!badge) return;
        const pendingCount = _requests.filter(r =>
            r.status === 'pending' || r.status === 'rejected' || r.status === 'partial_pending'
        ).length;
        if (pendingCount > 0) {
            badge.textContent = pendingCount;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // ══════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════

    function _tsToMs(ts) {
        if (!ts) return 0;
        if (typeof ts.toDate === 'function') return ts.toDate().getTime();
        if (ts instanceof Date) return ts.getTime();
        if (typeof ts === 'number') return ts;
        return new Date(ts).getTime() || 0;
    }

    // Local YYYY-MM-DD. Never toISOString().slice(0,10) for date keys: that is
    // UTC, which in PH (UTC+8) is still YESTERDAY before 8:00 AM — a self-payment
    // made at 7am would land in the previous day/billing week.
    function _localDateKey(d) {
        d = d || new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function _compressImageToBase64(file, maxPx, quality) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = e => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    let w = img.width, h = img.height;
                    if (w > maxPx || h > maxPx) {
                        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
                        else       { w = Math.round(w * maxPx / h); h = maxPx; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function _formatDate(ts) {
        const ms = _tsToMs(ts);
        if (!ms) return '\u2014';
        return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function _formatAmount(val) {
        const n = parseFloat(val);
        if (isNaN(n)) return '\u20b10.00';
        return '\u20b1' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _showClientToast(msg, isError = false) {
        const existing = document.getElementById('prClientToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'prClientToast';
        toast.style.cssText = [
            'position:fixed;bottom:28px;right:28px;z-index:99999;',
            `background:${isError ? '#b91c1c' : '#065f46'};`,
            'color:#fff;padding:12px 20px;border-radius:10px;',
            'font-size:14px;font-weight:500;font-family:inherit;',
            'box-shadow:0 4px 20px rgba(0,0,0,.22);',
            'animation:pr-fadein .2s ease;max-width:320px;line-height:1.4;'
        ].join('');
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
    }

    function _statusBadge(status) {
        const map = {
            pending:         'pr-status-pending',
            partial_pending: 'pr-status-partial',
            submitted:       'pr-status-submitted',
            verified:        'pr-status-verified',
            rejected:        'pr-status-rejected'
        };
        const labels = {
            pending:         'Pending',
            partial_pending: 'Awaiting Approval',
            submitted:       'Under Review',
            verified:        'Paid',
            rejected:        'Rejected'
        };
        const cls   = map[status]    || 'pr-status-pending';
        const label = labels[status] || status;
        return `<span class="pr-status ${cls}"><span class="pr-status-dot"></span>${label}</span>`;
    }

    // ══════════════════════════════════════════════════════
    // CLIENT SELF-PAY (billing period cards)
    // ══════════════════════════════════════════════════════

    window.initClientSelfPay = function () {
        const el = document.getElementById('client-selfpay-list');
        if (!el) return;

        const projects = typeof currentProjects !== 'undefined' ? currentProjects : [];
        const folders  = typeof currentFolders  !== 'undefined' ? currentFolders  : [];

        if (!projects.length) {
            el.innerHTML = '<div style="color:#9ca3af;font-size:14px;padding:20px 0;text-align:center;">No billing periods available.</div>';
            return;
        }

        const cards = projects.map(p => {
            const folder  = folders.find(f => f.id === p.folderId);
            const period  = [(p.month || ''), (p.year || '')].filter(Boolean).join(' ');
            const project = folder?.name || '';
            const amount  = parseFloat(p.monthlyBudget) || 0;
            const desc    = typeof formatFundingType === 'function'
                ? formatFundingType(p.fundingType, p.billingNumber)
                : (p.fundingType || '');

            // Check if already has a matching payment request
            const req = _requests.find(r => Math.abs((parseFloat(r.amount) || 0) - amount) < 0.01);

            const statusMap = {
                pending:         ['#f59e0b', 'Pending Payment'],
                partial_pending: ['#d97706', 'Awaiting Approval'],
                submitted:       ['#2563eb', 'Under Review'],
                verified:        ['#00a85e', 'Paid'],
                rejected:        ['#dc2626', 'Rejected']
            };

            let actionHtml = '';
            let statusHtml = '';

            if (req) {
                const [color, label] = statusMap[req.status] || ['#6b7280', req.status];
                statusHtml = `<span style="font-size:11px;font-weight:700;color:${color};">● ${label}</span>`;

                if (req.status === 'pending' || req.status === 'rejected') {
                    actionHtml = `<button onclick="prClientOpenPayModal('${req.id}')"
                        class="pr-client-pay-btn" style="margin-top:12px;width:100%;">
                        ${req.status === 'rejected' ? 'Resubmit Payment' : 'Pay Now'}
                    </button>`;
                } else if (req.status === 'verified') {
                    actionHtml = `<div style="margin-top:12px;background:#ecfdf5;border-radius:8px;padding:10px;text-align:center;font-size:13px;font-weight:600;color:#00a85e;">
                        ✓ Payment Verified
                    </div>`;
                } else if (req.status === 'submitted') {
                    actionHtml = `<div style="margin-top:12px;background:#eff6ff;border-radius:8px;padding:10px;text-align:center;font-size:13px;font-weight:600;color:#2563eb;">
                        Awaiting Verification
                    </div>`;
                }
            } else {
                statusHtml = `<span style="font-size:11px;font-weight:700;color:#9ca3af;">● Unpaid</span>`;
                const data = JSON.stringify({ billingPeriod: period, projectName: project, amount }).replace(/"/g, '&quot;');
                actionHtml = `<button onclick="prClientOpenSelfPayModal(${data})"
                    class="pr-client-pay-btn" style="margin-top:12px;width:100%;">
                    Pay Now
                </button>`;
            }

            return `
            <div class="pr-client-card">
                <div class="pr-client-card-header">
                    <div>
                        <div class="pr-client-card-title">${_esc(period)}</div>
                        ${project ? `<div class="pr-client-card-sub">${_esc(project)}</div>` : ''}
                    </div>
                    ${statusHtml}
                </div>
                <div>
                    <div class="pr-client-card-amount">${_formatAmount(amount)}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:4px;">${_esc(desc)}</div>
                </div>
                ${actionHtml}
            </div>`;
        });

        el.innerHTML = `<div class="pr-client-cards-grid">${cards.join('')}</div>`;
    };

    // ══════════════════════════════════════════════════════
    // CLIENT INVOICES
    // ══════════════════════════════════════════════════════

    window.initClientInvoices = async function () {
        if (!currentUser || !currentUser.email) return;
        const el = document.getElementById('client-invoice-list');
        if (!el) return;

        el.innerHTML = '<div style="color:#9ca3af;font-size:14px;padding:20px 0;"><div class="un-loading-spinner" style="display:inline-block;vertical-align:middle;margin-right:10px;"></div>Loading invoices\u2026</div>';

        try {
            const snap = await db.collection('invoices')
                .where('clientEmail', '==', currentUser.email)
                .where('status', '==', 'issued')
                .get();

            let invoices = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));

            // Same multi-project guard as initClientPayment: the query above is
            // clientEmail-only, so inside a construction portal (cmProjectData set)
            // it would surface EVERY project's invoices. Keep only invoices tagged
            // to the open project; untagged ones stay hidden rather than leak.
            // client.html (design services) has no cmProjectData → no filter.
            const _invProjId = (typeof cmProjectData !== 'undefined' && cmProjectData) ? cmProjectData.id : null;
            if (_invProjId) {
                invoices = invoices.filter(inv => inv.constructionProjectId === _invProjId);
            }

            if (!invoices.length) {
                el.innerHTML = `<div style="padding:40px 24px;text-align:center;">
                    <div style="font-size:32px;margin-bottom:10px;">📄</div>
                    <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">No invoices yet</div>
                    <div style="font-size:13px;color:#9ca3af;">Invoices will appear here once your payments are verified.</div>
                </div>`;
                return;
            }

            el.innerHTML = `<div>${invoices.map(_buildInvoiceCard).join('')}</div>`;
        } catch (e) {
            console.error('ClientInvoices: load error', e);
            el.innerHTML = `<div style="color:#b91c1c;font-size:13.5px;padding:16px 0;">Could not load invoices. ${_esc(e.message)}</div>`;
        }
    };

    function _buildInvoiceCard(inv) {
        const dateStr = inv.date
            ? new Date(inv.date + 'T00:00:00').toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
            : '—';
        const desc = inv.items?.[0]?.description || '';
        const safeInv = JSON.stringify(inv).replace(/</g,'\\u003c');
        return `
        <div style="border-bottom:1px solid #f3f4f6;">
            <div style="display:flex;align-items:center;gap:16px;padding:16px 22px;">
                <div style="width:42px;height:42px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:14px;font-weight:700;color:#1f2937;">${_esc(inv.invoiceNo || '—')}</div>
                    <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${dateStr}${desc ? ' &nbsp;·&nbsp; ' + _esc(desc) : ''}</div>
                </div>
                <div style="text-align:right;flex-shrink:0;margin-right:12px;">
                    <div style="font-size:15px;font-weight:800;color:#00a85e;">${_formatAmount(inv.totalAmount)}</div>
                    <span style="font-size:11px;color:#065f46;background:#d1fae5;padding:2px 8px;border-radius:99px;font-weight:700;">Issued</span>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button onclick="clientPreviewInvoice(${safeInv})"
                        style="display:inline-flex;align-items:center;gap:5px;background:#eff6ff;color:#2563eb;border:1.5px solid #bfdbfe;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .2s;"
                        onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        Preview
                    </button>
                    <button onclick="clientPrintInvoice(${safeInv})"
                        style="display:inline-flex;align-items:center;gap:6px;background:#f8fafc;color:#374151;border:1.5px solid #e5e7eb;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .2s;"
                        onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#f8fafc'">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                        </svg>
                        Print
                    </button>
                </div>
            </div>
        </div>`;
    }

    window.prPrintClientInvoice = async function (reqId) {
        // Find the payment request from local cache
        const req = _requests.find(r => r.id === reqId);
        if (!req) { _showClientToast('Payment request not found.', true); return; }

        // 1. Best case: use snapshot embedded in the payment request document
        if (req.invoiceSnapshot) {
            window.clientPrintInvoice({ id: req.invoiceId || reqId, ...req.invoiceSnapshot });
            return;
        }

        // 2. Try reading from invoices collection (works if Firestore rules allow)
        if (req.invoiceId) {
            try {
                const doc = await db.collection('invoices').doc(req.invoiceId).get();
                if (doc.exists) {
                    window.clientPrintInvoice({ id: doc.id, ...doc.data() });
                    return;
                }
            } catch (_) {
                // Permission denied — fall through to minimal invoice build
            }
        }

        // 3. Last resort: build a minimal invoice from the payment request data
        // (no extra Firestore reads required — client already has access to this doc)
        try {
            let bizName = "DAC's Building Design Services", bizAddress = '', bizTin = '';
            try {
                const biz = await db.collection('settings').doc('businessInfo').get();
                if (biz.exists) {
                    bizName    = biz.data().businessName    || bizName;
                    bizAddress = biz.data().businessAddress || '';
                    bizTin     = biz.data().tin             || '';
                }
            } catch (_) {}

            const amount  = Number(req.amount || 0);
            const desc    = req.description || req.billingPeriod || 'Payment';
            // _localDateKey, not toISOString: a payment verified 00:00–07:59 PH
            // would otherwise print the PREVIOUS day's date on the invoice.
            const tsToDate = ts => ts
                ? _localDateKey(new Date(ts.seconds ? ts.seconds * 1000 : ts))
                : _localDateKey();

            window.clientPrintInvoice({
                id:              req.invoiceId || req.id,
                invoiceNo:       req.invoiceId || req.id,
                date:            tsToDate(req.verifiedAt || req.createdAt),
                businessName:    bizName,
                businessAddress: bizAddress,
                businessTin:     bizTin,
                clientName:      req.clientName  || req.clientEmail || '',
                clientEmail:     req.clientEmail || '',
                items: [{ description: desc, qty: 1, unitPrice: amount, discount: 0, amount }],
                subtotal:        amount,
                totalAmount:     amount,
            });
        } catch (e) {
            _showClientToast('Could not load invoice: ' + e.message, true);
        }
    };

    // ── Logo helpers (client-side, mirrors admin invoice-module.js) ──
    function _clientNormLogos(logos) {
        if (!logos) return [];
        return logos.map(l => (typeof l === 'string' ? { src: l, enabled: true } : l));
    }

    function _clientBuildLogoHtml(logos) {
        const enabled = _clientNormLogos(logos).filter(l => l.enabled !== false);
        if (!enabled.length) return '';
        const imgs = enabled.map(l =>
            `<img src="${l.src}" style="height:64px;max-width:140px;width:auto;object-fit:contain;flex-shrink:0;mix-blend-mode:multiply;" onerror="this.style.display='none'">`
        ).join('');
        const justify = enabled.length === 1 ? 'center' : 'space-evenly';
        return `<div style="display:flex;align-items:center;justify-content:${justify};gap:24px;padding:12px 0 16px;border-bottom:2.5px solid #1e3a5f;margin-bottom:18px;flex-wrap:nowrap;overflow:hidden;">${imgs}</div>`;
    }

    // Fetch invoice defaults (logos + business info) once and cache
    let _clientSettingsCache = null;
    async function _fetchClientSettings() {
        if (_clientSettingsCache !== null) return _clientSettingsCache;
        try {
            const doc = await db.collection('settings').doc('invoiceDefaults').get();
            _clientSettingsCache = doc.exists ? (doc.data() || {}) : {};
        } catch (_) {
            _clientSettingsCache = {};
        }
        return _clientSettingsCache;
    }

    // Build logo HTML for client print — always shows DACS logo,
    // plus any additional admin-configured logos from Firestore
    function _buildClientPrintLogoHtml(settings) {
        const base = window.location.origin + '/assets/images/DACS-TRANSPARENT.png';
        // Merge: DACS base logo first, then any enabled Firestore logos
        const extra = _clientNormLogos(settings.logos || []).filter(l => l.enabled !== false);
        // Avoid duplicating the base logo if admin already uploaded it
        const imgs = [
            `<img src="${base}" style="height:64px;max-width:160px;width:auto;object-fit:contain;flex-shrink:0;mix-blend-mode:multiply;" onerror="this.style.display='none'">`,
            ...extra.map(l => `<img src="${l.src}" style="height:64px;max-width:140px;width:auto;object-fit:contain;flex-shrink:0;mix-blend-mode:multiply;" onerror="this.style.display='none'">`)
        ].join('');
        const justify = extra.length > 0 ? 'space-evenly' : 'center';
        return `<div style="display:flex;align-items:center;justify-content:${justify};gap:24px;padding:12px 0 16px;border-bottom:2.5px solid #1e3a5f;margin-bottom:18px;flex-wrap:nowrap;overflow:hidden;">${imgs}</div>`;
    }

    async function _doClientPrint(inv, previewOnly) {
        const settings  = await _fetchClientSettings();
        const logoHtml  = _buildClientPrintLogoHtml(settings);

        // Fall back to stored settings when invoice fields are blank
        const bizName    = inv.businessName    || settings.businessName    || "DAC's Building Design Services";
        const bizTin     = inv.businessTin     || settings.businessTin     || '';
        const bizAddress = inv.businessAddress || settings.businessAddress || '';

        const _e = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const _m = n => '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 });
        const _d = s => { try { return new Date(s + 'T00:00:00').toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }); } catch(e) { return s || '—'; } };
        const pd = inv.paymentDetails || settings.paymentDetails || {};

        const itemRows = (inv.items || []).map((item, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${_e(item.description || '')}</td>
                <td style="text-align:center;">${item.qty}</td>
                <td style="text-align:right;">${_m(item.unitPrice)}</td>
                <td style="text-align:center;">${item.discount || 0}%</td>
                <td style="text-align:right;font-weight:600;">${_m(item.amount)}</td>
            </tr>`).join('');

        const w = window.open('', '_blank', 'width=870,height=1100');
        if (!w) { alert('Please allow pop-ups to print the invoice.'); return; }
        w.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${previewOnly ? 'Preview' : 'Print'} — Invoice ${_e(inv.invoiceNo || '')}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;background:#f5f5f5}
.page{width:210mm;min-height:297mm;margin:20px auto;padding:18mm 16mm 14mm;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.12)}
.preview-bar{display:flex;align-items:center;justify-content:space-between;background:#1e3a5f;color:#fff;padding:10px 20px;font-family:Arial,sans-serif;font-size:13px;}
.preview-bar button{background:#4AC84A;color:#fff;border:none;border-radius:6px;padding:7px 18px;font-size:13px;font-weight:700;cursor:pointer;}
.preview-bar button:hover{background:#3ab53a;}
.inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:14px;border-bottom:2.5px solid #1e3a5f}
.inv-biz{display:flex;align-items:center;gap:14px}
.inv-biz-logo{height:64px;max-width:150px;width:auto;object-fit:contain;mix-blend-mode:multiply;flex-shrink:0}
.inv-biz-text h1{font-size:20px;font-weight:800;color:#1a1a2e}
.inv-biz-text p{font-size:12px;color:#555;margin-top:4px;line-height:1.5}
.inv-title-block{text-align:right}
.inv-title-block h2{font-size:26px;font-weight:800;color:#1e3a5f;letter-spacing:2px}
.inv-meta{margin-top:8px;font-size:12px;color:#444;line-height:1.8}
.inv-meta strong{color:#111}
.bill-row{display:flex;gap:32px;margin-bottom:18px;padding:14px 0;border-bottom:1px solid #e5e7eb}
.bill-to h4{font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px}
.bill-to .name{font-size:15px;font-weight:700;color:#1a1a2e;margin-bottom:3px}
.bill-to p{font-size:12px;color:#555;line-height:1.5}
table.items{width:100%;border-collapse:collapse;margin-bottom:14px}
table.items thead tr{background:#1e3a5f;color:#fff}
table.items thead th{padding:9px 10px;font-size:11px;font-weight:700;text-align:left;letter-spacing:.4px}
table.items tbody tr:nth-child(even){background:#f8fafc}
table.items tbody td{padding:8px 10px;border-bottom:1px solid #e9ecef;vertical-align:top;font-size:12px}
.totals-wrap{display:flex;justify-content:flex-end;margin-bottom:20px}
table.totals{width:280px;border-collapse:collapse;font-size:13px}
table.totals td{padding:6px 10px}
table.totals td:first-child{color:#555}
table.totals td:last-child{text-align:right;font-weight:600;color:#111}
table.totals tr.grand td{font-size:15px;font-weight:800;color:#fff;background:#1e3a5f;padding:10px 12px}
.pay-box{background:#f1f5f9;border-radius:8px;padding:13px 16px;margin-bottom:18px}
.pay-box h4{font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px}
.pay-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 24px;font-size:12px}
.pay-grid .lbl{color:#6b7280}.pay-grid .val{font-weight:600;color:#111}
.footer{text-align:center;margin-top:24px;font-size:10px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:10px}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;padding:10mm 10mm;width:100%}.preview-bar{display:none!important}@page{size:A4 portrait;margin:8mm}}
</style></head><body>
${previewOnly ? `<div class="preview-bar"><span>Print Preview &mdash; Invoice ${_e(inv.invoiceNo || '')}</span><button onclick="window.print()">Print</button></div>` : ''}
<div class="page">
  <div class="inv-header">
    <div class="inv-biz">
      <img class="inv-biz-logo" src="${window.location.origin}/assets/images/DACS-TRANSPARENT.png" onerror="this.style.display='none'">
      <div class="inv-biz-text"><h1>${_e(bizName)}</h1>
        <p>${bizTin ? 'TIN: ' + _e(bizTin) + '<br>' : ''}${_e(bizAddress)}</p></div>
    </div>
    <div class="inv-title-block"><h2>ACKNOWLEDGEMENT RECEIPT</h2>
      <div class="inv-meta">Receipt No: <strong>${_e(inv.invoiceNo || '—')}</strong><br>Date: <strong>${_d(inv.date)}</strong></div></div>
  </div>
  <div class="bill-row"><div class="bill-to">
    <h4>Bill To</h4>
    <div class="name">${_e(inv.clientName || '—')}</div>
    <p>${_e(inv.clientAddress || '')}</p>
    ${inv.clientTin ? `<p>TIN: ${_e(inv.clientTin)}</p>` : ''}
  </div></div>
  <table class="items"><thead><tr>
    <th style="width:28px;">#</th><th>Item Description / Service</th>
    <th style="width:55px;text-align:center;">Qty</th>
    <th style="width:105px;text-align:right;">Unit Price</th>
    <th style="width:70px;text-align:center;">Disc.(%)</th>
    <th style="width:110px;text-align:right;">Amount</th>
  </tr></thead><tbody>${itemRows}</tbody></table>
  <div class="totals-wrap"><table class="totals">
    <tr><td>Total Sales</td><td>${_m(inv.subtotal)}</td></tr>
    <tr class="grand"><td>TOTAL AMOUNT DUE</td><td>${_m(inv.totalAmount)}</td></tr>
  </table></div>
  ${(pd.method === 'gcash') ? `<div class="pay-box"><h4>Payment Details</h4><div class="pay-grid">
    <div><span class="lbl">Payment Via: </span><span class="val">GCash</span></div>
    <div><span class="lbl">GCash No.: </span><span class="val">${_e(pd.gcashNumber || '—')}</span></div>
    <div><span class="lbl">Account Name: </span><span class="val">${_e(pd.gcashName || '—')}</span></div>
  </div></div>` : (pd.bank || pd.accountNo) ? `<div class="pay-box"><h4>Payment Details</h4><div class="pay-grid">
    <div><span class="lbl">Bank: </span><span class="val">${_e(pd.bank || '—')}</span></div>
    <div><span class="lbl">Account No.: </span><span class="val">${_e(pd.accountNo || '—')}</span></div>
    <div><span class="lbl">Account Name: </span><span class="val">${_e(pd.accountName || '—')}</span></div>
    <div><span class="lbl">Branch: </span><span class="val">${_e(pd.branch || '—')}</span></div>
  </div></div>` : ''}
  ${inv.notes ? `<p style="font-size:12px;color:#555;margin-bottom:16px;">${_e(inv.notes)}</p>` : ''}
  <div class="footer">${_e(bizName)}${bizAddress ? ' &bull; ' + _e(bizAddress) : ''}<br>This is an official acknowledgement receipt. Thank you for your payment.</div>
</div>${previewOnly ? '' : '<script>window.onload=()=>{window.print();}<\\/script>'}</body></html>`);
        w.document.close();
    }

    window.clientPrintInvoice   = function (inv) { _doClientPrint(inv, false); };
    window.clientPreviewInvoice = function (inv) { _doClientPrint(inv, true);  };

    // ══════════════════════════════════════════════════════
    // SOA REQUEST (client → admin)
    // ══════════════════════════════════════════════════════

    window.clientRequestSOWA = async function (btn) {
        const user = firebase.auth().currentUser;
        if (!user) return;

        const adminUid = _getAdminUid();
        if (!adminUid) {
            alert('Unable to send request — no admin linked. Please try again after your payment requests load.');
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

        try {
            // Check if a pending request already exists
            const existing = await db.collection('sowaRequests')
                .where('clientUid', '==', user.uid)
                .where('ownerUid', '==', adminUid)
                .where('status',   '==', 'pending')
                .get();

            if (!existing.empty) {
                _setSOWABtnPending(btn);
                return;
            }

            await db.collection('sowaRequests').add({
                clientEmail: user.email,
                clientName:  user.displayName || user.email,
                clientUid:   user.uid,
                ownerUid:    adminUid,
                status:      'pending',
                requestedAt: firebase.firestore.Timestamp.fromDate(new Date())
            });

            await _notifyOwnerAndStaff(adminUid, {
                type:      'sowa_request',
                message:   `${user.displayName || user.email} requested a Statement of Work Accomplished (SOA)`,
                isRead:    false,
                createdAt: firebase.firestore.Timestamp.fromDate(new Date())
            }).catch(e => console.warn('SOA notify error:', e));

            _setSOWABtnPending(btn);
        } catch (e) {
            console.error('SOA request error:', e);
            if (btn) { btn.disabled = false; btn.innerHTML = 'Request SOA'; }
            alert('Error sending SOA request. Please try again.');
        }
    };

    function _setSOWABtnPending(btn) {
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Request Sent`;
        btn.style.background    = '#d1fae5';
        btn.style.borderColor   = '#6ee7b7';
        btn.style.color         = '#059669';
        btn.style.cursor        = 'default';
    }

    async function _checkSOWARequestState() {
        const user = firebase.auth().currentUser;
        const requestBtn = document.getElementById('clientRequestSOWABtn');
        const viewBtn    = document.getElementById('clientViewSOWABtn');
        if (!user || !requestBtn) return;
        const adminUid = _getAdminUid();
        if (!adminUid) return;
        try {
            const snap = await db.collection('sowaRequests')
                .where('clientUid', '==', user.uid)
                .where('ownerUid', '==', adminUid)
                .get();

            if (snap.empty) return;

            // Find the most recent request
            let latest = null;
            snap.forEach(doc => {
                const d = doc.data();
                if (!latest || _tsToMs(d.requestedAt) > _tsToMs(latest.requestedAt)) latest = d;
            });

            if (latest.status === 'shared') {
                // Admin has shared — show View SOA, hide Request SOA
                requestBtn.style.display = 'none';
                if (viewBtn) viewBtn.style.display = 'inline-flex';
            } else if (latest.status === 'pending' || latest.status === 'viewed') {
                _setSOWABtnPending(requestBtn);
            }
        } catch (e) { /* silent */ }
    }

    // ══════════════════════════════════════════════════════
    // CLIENT SOA
    // ══════════════════════════════════════════════════════

    window.clientOpenSOWA = function () {
        const modal = document.getElementById('clientSowaModal');
        if (!modal) return;

        const requests = [..._requests].sort((a, b) => _tsToMs(a.createdAt) - _tsToMs(b.createdAt));
        const user     = firebase.auth().currentUser;
        const clientName = (user && (user.displayName || user.email)) || 'Client';

        const typeLabel   = { mobilization: 'Mobilization', downpayment: 'Downpayment', progress: 'Progress Billing', final: 'Final Payment', president: 'Cover Expenses' };
        const statusColor = { pending: '#f59e0b', partial_pending: '#f97316', partial_approved: '#3b82f6', submitted: '#3b82f6', verified: '#059669', rejected: '#dc2626' };

        const dateGenerated = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });

        // Does this SOA carry any invoices? (a request with a generated invoice)
        const hasInvoices = requests.some(r => r.invoiceId || r.invoiceSnapshot);

        // Group by project
        const hasProject = requests.some(r => r.projectName);
        const projects = {};
        requests.forEach(r => {
            const proj = hasProject ? (r.projectName || 'No Project') : '_all_';
            if (!projects[proj]) projects[proj] = [];
            projects[proj].push(r);
        });

        let tableRows = '';
        let grandBilled = 0, grandPaid = 0;
        let projNum = 0;

        Object.entries(projects).forEach(([proj, reqs]) => {
            projNum++;
            let projBilled = 0, projPaid = 0;

            // Red category row (project name)
            if (proj !== '_all_') {
                const roman = ['I','II','III','IV','V','VI','VII','VIII','IX','X'][projNum - 1] || projNum;
                tableRows += `<tr class="sowa-cat-row">
                    <td style="text-align:center;font-weight:700;">${roman}.</td>
                    <td colspan="5" style="font-weight:700;letter-spacing:.5px;text-transform:uppercase;">${_esc(proj)}</td>
                    <td></td>
                </tr>`;
            }

            reqs.forEach((r, idx) => {
                const type    = typeLabel[r.fundingType] || r.fundingType || '—';
                const billed  = r.amount || 0;
                const paid    = r.status === 'verified' ? (r.paidAmount != null ? r.paidAmount : billed) : 0;
                const balance = billed - paid;
                const pct     = billed > 0 ? Math.round((paid / billed) * 100) : 0;
                const st      = r.status || 'pending';
                const color   = statusColor[st] || '#6b7280';
                projBilled += billed;
                projPaid   += paid;

                tableRows += `<tr class="sowa-item-row">
                    <td style="text-align:center;color:#6b7280;">${idx + 1}</td>
                    <td>${_esc(r.billingPeriod || '—')}</td>
                    <td>${_esc(type)}</td>
                    <td style="text-align:right;font-weight:600;">${_formatAmount(billed)}</td>
                    <td style="text-align:right;font-weight:600;color:#059669;">${paid > 0 ? _formatAmount(paid) : '<span style="color:#9ca3af;">—</span>'}</td>
                    <td style="text-align:right;font-weight:600;color:${balance > 0.01 ? '#cc0000' : '#059669'};">${_formatAmount(balance)}</td>
                    <td style="text-align:center;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <div style="flex:1;background:#e5e7eb;border-radius:99px;height:8px;min-width:50px;">
                                <div style="width:${pct}%;background:#059669;height:8px;border-radius:99px;transition:width .3s;"></div>
                            </div>
                            <span style="font-size:11px;font-weight:700;color:${color};white-space:nowrap;">${pct}%</span>
                        </div>
                    </td>
                </tr>`;
            });

            grandBilled += projBilled;
            grandPaid   += projPaid;

            // Yellow subtotal row
            if (proj !== '_all_') {
                tableRows += `<tr class="sowa-subtotal-row">
                    <td colspan="3" style="font-style:italic;font-weight:600;color:#7a5a00;">Subtotal — ${_esc(proj)}</td>
                    <td style="text-align:right;font-weight:700;">${_formatAmount(projBilled)}</td>
                    <td style="text-align:right;font-weight:700;color:#059669;">${_formatAmount(projPaid)}</td>
                    <td style="text-align:right;font-weight:700;color:${(projBilled-projPaid)>0.01?'#cc0000':'#059669'};">${_formatAmount(projBilled-projPaid)}</td>
                    <td></td>
                </tr>`;
            }
        });

        document.getElementById('clientSowaContent').innerHTML = `
        <div class="sowa-header-block">
            <div class="sowa-company">DAC'S Building Design Services</div>
            <div class="sowa-doc-title">STATEMENT OF WORK ACCOMPLISHED</div>
            <div class="sowa-meta">
                <div><span class="sowa-meta-label">Client:</span> <strong>${_esc(clientName)}</strong></div>
                <div><span class="sowa-meta-label">Date Generated:</span> <strong>${dateGenerated}</strong></div>
            </div>
        </div>
        <table class="sowa-table">
            <thead>
                <tr class="sowa-thead-row">
                    <th style="width:44px;text-align:center;">NO.</th>
                    <th>BILLING PERIOD</th>
                    <th>TYPE</th>
                    <th style="text-align:right;">AMOUNT BILLED</th>
                    <th style="text-align:right;">AMOUNT PAID</th>
                    <th style="text-align:right;">BALANCE</th>
                    <th style="text-align:center;">% PAID</th>
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
            <tfoot>
                <tr class="sowa-grand-row">
                    <td colspan="3" style="font-weight:800;font-size:13px;letter-spacing:.5px;">GRAND TOTAL</td>
                    <td style="text-align:right;font-weight:800;font-size:13px;">${_formatAmount(grandBilled)}</td>
                    <td style="text-align:right;font-weight:800;font-size:13px;color:#6ee7b7;">${_formatAmount(grandPaid)}</td>
                    <td style="text-align:right;font-weight:800;font-size:13px;color:${(grandBilled-grandPaid)>0.01?'#fca5a5':'#6ee7b7'};">${_formatAmount(grandBilled-grandPaid)}</td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
        ${hasInvoices ? `
        <div class="sowa-ack-block" style="margin-top:32px;padding-top:18px;border-top:1px solid #e5e7eb;">
            <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">Acknowledgement</div>
            <div style="font-size:12.5px;color:#374151;line-height:1.7;margin-bottom:30px;">
                I, <strong>${_esc(clientName)}</strong>, hereby acknowledge receipt of the invoice(s) covered by this Statement of Account and confirm the amounts billed above as accurate and received.
            </div>
            <div style="display:flex;justify-content:space-between;gap:40px;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;">
                    <div style="border-top:1.5px solid #374151;padding-top:6px;font-size:11.5px;color:#6b7280;">Acknowledged by (Signature over Printed Name)</div>
                </div>
                <div style="flex:1;min-width:200px;">
                    <div style="border-top:1.5px solid #374151;padding-top:6px;font-size:11.5px;color:#6b7280;">Date</div>
                </div>
            </div>
        </div>` : ''}`;

        modal.style.display = 'flex';
    };

    window.clientCloseSOWA = function () {
        const modal = document.getElementById('clientSowaModal');
        if (modal) modal.style.display = 'none';
    };

    window.clientPrintSOWA = function () {
        // Make this callable without first opening the SOA modal. When the
        // user clicks Print straight from the Documents tab, the modal-content
        // div hasn't been populated — so we trigger clientOpenSOWA() to fill
        // it, then immediately hide the modal again so only the print dialog
        // is visible. Net result: one click on the Documents-tab Print button
        // opens the browser print dialog directly, no UI flicker.
        let content = document.getElementById('clientSowaContent');
        if (!content || !content.innerHTML.trim()) {
            if (typeof window.clientOpenSOWA === 'function') {
                window.clientOpenSOWA();
                const modal = document.getElementById('clientSowaModal');
                if (modal) modal.style.display = 'none';
                content = document.getElementById('clientSowaContent');
            }
        }
        if (!content) return;
        const w = window.open('', '_blank');
        if (!w) {
            // Popup blocker. Fall back to opening the modal so the user can
            // see the Print button there and try again with the affordance
            // they have come to expect.
            if (typeof window.clientOpenSOWA === 'function') window.clientOpenSOWA();
            alert('Allow popups for this site to download/print your SOA, or use the Print button inside the SOA modal.');
            return;
        }
        w.document.write(`<!DOCTYPE html><html><head><title>SOA</title>
        <style>
            body{font-family:Arial,sans-serif;font-size:13px;color:#111;padding:32px;}
            .sowa-company{font-size:18px;font-weight:700;color:#059669;}
            .sowa-doc-title{font-size:15px;font-weight:700;letter-spacing:1px;margin:4px 0 12px;text-transform:uppercase;}
            .sowa-meta{display:flex;gap:32px;margin-bottom:20px;font-size:13px;}
            .sowa-meta-label{color:#6b7280;}
            .sowa-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;}
            .sowa-thead-row th{background:#f5c518;color:#1a1a1a;padding:9px 12px;font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.5px;}
            .sowa-cat-row td{background:#cc0000;color:#fff;padding:8px 12px;font-size:12px;}
            .sowa-item-row td{background:#fff;padding:8px 12px;border-bottom:1px solid #f1f5f9;}
            .sowa-subtotal-row td{background:#fffde7;color:#7a5a00;padding:8px 12px;border-top:1.5px solid #f5c518;border-bottom:1.5px solid #f5c518;}
            .sowa-grand-row td{background:#1e3a2f;color:#fff;padding:10px 12px;}
        </style></head><body>${content.innerHTML}</body></html>`);
        w.document.close();
        setTimeout(() => w.print(), 400);
    };


    // ── Terms & Conditions ──────────────────────────────────
    window.prOpenTCModal = function () {
        const m = document.getElementById('prTCModal');
        if (m) m.style.display = 'flex';
    };
    window.prCloseTCModal = function () {
        const m = document.getElementById('prTCModal');
        if (m) m.style.display = 'none';
    };
    window.prAcceptTC = function () {
        const cb = document.getElementById('prTCCheckbox');
        if (cb) { cb.checked = true; prToggleTCSubmit(); }
        prCloseTCModal();
    };
    window.prToggleTCSubmit = function () {
        const cb  = document.getElementById('prTCCheckbox');
        const btn = document.getElementById('prClientSubmitBtn');
        const tcBox = document.getElementById('prTCAgreeBox');
        if (tcBox && cb && cb.checked) tcBox.style.borderColor = '';   // clear the red highlight on agree
        if (!btn) return;
        const agreed = cb && cb.checked;
        btn.disabled       = !agreed;
        btn.style.opacity  = agreed ? '1'            : '0.45';
        btn.style.cursor   = agreed ? 'pointer'      : 'not-allowed';
    };
    // Reset T&C checkbox whenever the payment modal opens
    const _origOpenPayModal = window.prClientOpenPayModal;
    window.prClientOpenPayModal = function (id) {
        const cb  = document.getElementById('prTCCheckbox');
        const btn = document.getElementById('prClientSubmitBtn');
        if (cb)  { cb.checked = false; }
        if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; btn.style.cursor = 'not-allowed'; }
        if (_origOpenPayModal) _origOpenPayModal(id);
    };
    const _origOpenSelfPay = window.prClientOpenSelfPayModal;
    window.prClientOpenSelfPayModal = function (data) {
        const cb  = document.getElementById('prTCCheckbox');
        const btn = document.getElementById('prClientSubmitBtn');
        if (cb)  { cb.checked = false; }
        if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; btn.style.cursor = 'not-allowed'; }
        if (_origOpenSelfPay) _origOpenSelfPay(data);
    };

})();
