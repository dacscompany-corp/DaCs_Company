// ════════════════════════════════════════════════════════════
// PAYMENT REQUESTS MODULE (Admin)
// Manages payment requests for clients.
// ════════════════════════════════════════════════════════════

(function () {
    'use strict';

    let _allRequests       = [];
    let _loading           = false;
    let _currentId         = null;   // id in detail modal
    let _qrSettings        = null;   // cached global QR from settings/paymentQR
    let _pendingSOWAEmails = new Set(); // client emails with pending SOWA requests
    let _sowaClientEmail   = null;   // client email for currently open SOWA modal
    let _sowaClientName    = null;   // client name for currently open SOWA modal

    // ══════════════════════════════════════════════════════
    // PUBLIC ENTRY POINT
    // ══════════════════════════════════════════════════════

    window.initPaymentRequests = function () {
        if (_loading) return;
        _loadQRSettings();
        _loadRequests();
        _loadPendingSOWARequests();
    };

    // ══════════════════════════════════════════════════════
    // PENDING SOWA REQUESTS
    // ══════════════════════════════════════════════════════

    async function _loadPendingSOWARequests() {
        try {
            const uid  = window.currentDataUserId || firebase.auth().currentUser?.uid;
            if (!uid) return;
            const snap = await db.collection('sowaRequests')
                .where('ownerUid', '==', uid)
                .where('status',   '==', 'pending')
                .get();
            _pendingSOWAEmails.clear();
            snap.forEach(doc => _pendingSOWAEmails.add(doc.data().clientEmail));
        } catch (e) {
            console.warn('PaymentRequests: could not load SOWA requests', e);
        }
    }

    // ══════════════════════════════════════════════════════
    // GLOBAL QR SETTINGS
    // ══════════════════════════════════════════════════════

    async function _loadQRSettings() {
        try {
            const snap = await db.collection('settings').doc('paymentQR').get();
            _qrSettings = snap.exists ? snap.data() : {};
            _renderQRSettingsPreview();
        } catch (e) {
            console.warn('PaymentRequests: could not load QR settings', e);
            _qrSettings = {};
        }
    }

    function _renderQRSettingsPreview() {
        const gcashImg  = document.getElementById('prQSGcashCurrent');
        const gcashNone = document.getElementById('prQSGcashNone');
        const bankImg   = document.getElementById('prQSBankCurrent');
        const bankNone  = document.getElementById('prQSBankNone');
        const hasGcash  = !!_qrSettings?.gcashQrBase64;
        const hasBank   = !!_qrSettings?.bankQrBase64;
        if (gcashImg)  { gcashImg.src = _qrSettings?.gcashQrBase64 || ''; gcashImg.style.display = hasGcash ? 'block' : 'none'; }
        if (gcashNone) { gcashNone.style.display = hasGcash ? 'none' : 'block'; }
        if (bankImg)   { bankImg.src  = _qrSettings?.bankQrBase64  || ''; bankImg.style.display  = hasBank  ? 'block' : 'none'; }
        if (bankNone)  { bankNone.style.display  = hasBank  ? 'none' : 'block'; }
    }

    window.prOpenQRSettings = function () {
        const modal = document.getElementById('prQRSettingsModal');
        if (!modal) return;
        // Reset file inputs and new previews
        const gcashFile = document.getElementById('prQSGcashFile');
        const bankFile  = document.getElementById('prQSBankFile');
        if (gcashFile) gcashFile.value = '';
        if (bankFile)  bankFile.value  = '';
        const gcashNew = document.getElementById('prQSGcashNewPreview');
        const bankNew  = document.getElementById('prQSBankNewPreview');
        if (gcashNew) { gcashNew.src = ''; gcashNew.style.display = 'none'; }
        if (bankNew)  { bankNew.src  = ''; bankNew.style.display  = 'none'; }
        const errDiv = document.getElementById('prQSError');
        if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }
        _renderQRSettingsPreview();
        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.prCloseQRSettings = function () {
        const modal = document.getElementById('prQRSettingsModal');
        if (modal) modal.style.display = 'none';
    };

    window.prPreviewQRNew = function (input, imgId) {
        const file = input.files && input.files[0];
        const img  = document.getElementById(imgId);
        if (!img) return;
        if (file) {
            const reader = new FileReader();
            reader.onload = e => { img.src = e.target.result; img.style.display = 'block'; };
            reader.readAsDataURL(file);
        } else {
            img.src = ''; img.style.display = 'none';
        }
    };

    window.prSaveQRSettings = async function () {
        const btn    = document.getElementById('prQSSaveBtn');
        const errDiv = document.getElementById('prQSError');
        function showErr(msg) { if (errDiv) { errDiv.textContent = msg; errDiv.style.display = 'block'; } }
        function clearErr()   { if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; } }
        clearErr();

        const gcashFile = document.getElementById('prQSGcashFile')?.files?.[0];
        const bankFile  = document.getElementById('prQSBankFile')?.files?.[0];

        if (!gcashFile && !bankFile) {
            return showErr('Select at least one QR image to update.');
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        try {
            const updates = { updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                              updatedBy: auth.currentUser?.email || '' };
            if (gcashFile) updates.gcashQrBase64 = await _compressToBase64(gcashFile, 500, 0.82);
            if (bankFile)  updates.bankQrBase64  = await _compressToBase64(bankFile,  500, 0.82);

            await db.collection('settings').doc('paymentQR').set(updates, { merge: true });

            // Update cache
            _qrSettings = { ..._qrSettings, ...updates };
            _renderQRSettingsPreview();

            // Reset file inputs
            const gf = document.getElementById('prQSGcashFile');
            const bf = document.getElementById('prQSBankFile');
            if (gf) gf.value = '';
            if (bf) bf.value = '';
            const gn = document.getElementById('prQSGcashNewPreview');
            const bn = document.getElementById('prQSBankNewPreview');
            if (gn) { gn.src = ''; gn.style.display = 'none'; }
            if (bn) { bn.src = ''; bn.style.display = 'none'; }

            prCloseQRSettings();
        } catch (e) {
            console.error('PaymentRequests: save QR error', e);
            showErr('Error saving QR: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Save QR Codes'; }
        }
    };

    // ══════════════════════════════════════════════════════
    // LOAD FROM FIRESTORE
    // ══════════════════════════════════════════════════════

    async function _loadRequests() {
        _loading = true;
        _showLoading(true);

        try {
            // Scope to this owner's data only. Without the ownerUid filter
            // the query loads every payment request the user has permission
            // to read — which for owner/staff roles is the WHOLE collection
            // including other owners' clients. At 10k docs that's a 10k-doc
            // read on every page-load. The .where filter cuts it to the
            // owner's own requests (typically <100). Pattern matches the
            // other queries in this file (e.g. _loadPendingSOWARequests).
            const uid = window.currentDataUserId || firebase.auth().currentUser?.uid;
            if (!uid) {
                _loading = false;
                _showLoading(false);
                _allRequests = [];
                _renderStats(_allRequests);
                _renderTable(_allRequests);
                return;
            }
            // No composite index needed — single .where + client-side sort.
            const snap = await db.collection('paymentRequests')
                .where('ownerUid', '==', uid)
                .get();
            _allRequests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));

            _loading = false;
            _showLoading(false);
            _renderStats(_allRequests);
            _renderTable(_allRequests);
        } catch (e) {
            _loading = false;
            _showLoading(false);
            console.error('PaymentRequests: load error', e);
            _showError(e.message);
        }
    }

    // ══════════════════════════════════════════════════════
    // STATS
    // ══════════════════════════════════════════════════════

    function _renderStats(requests) {
        const pending  = requests.filter(r => r.status === 'pending').length;
        const partial  = requests.filter(r => r.status === 'partial_pending').length;
        const submitted = requests.filter(r => r.status === 'submitted').length;
        const verified  = requests.filter(r => r.status === 'verified').length;
        _setText('prPendingCount',   pending);
        _setText('prPartialCount',   partial);
        _setText('prSubmittedCount', submitted);
        _setText('prVerifiedCount',  verified);
        const actionable = requests.filter(r =>
            r.status === 'submitted' || r.status === 'partial_pending'
        ).length;
        _updateAdminBadge(actionable);
    }

    function _updateAdminBadge(urgentCount) {
        const badge = document.getElementById('pr-admin-badge');
        if (badge) {
            if (urgentCount > 0) { badge.textContent = urgentCount; badge.style.display = 'inline-flex'; }
            else { badge.style.display = 'none'; }
        }
        // Update shared billing group badge via admin.js controller
        if (typeof window._pendingPaymentCount !== 'undefined') window._pendingPaymentCount = urgentCount;
        if (typeof window.syncBillingGroupBadge === 'function') window.syncBillingGroupBadge();
    }

    // ══════════════════════════════════════════════════════
    // TABLE
    // ══════════════════════════════════════════════════════

    function _renderTable(requests) {
        const tbody = document.getElementById('prTableBody');
        const wrap  = document.getElementById('prTableWrap');
        const empty = document.getElementById('prEmptyState');
        const load  = document.getElementById('prLoadingState');
        if (!tbody) return;

        if (load) load.style.display = 'none';

        if (!requests.length) {
            if (wrap)  wrap.style.display  = 'none';
            if (empty) empty.style.display = 'flex';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        if (wrap)  wrap.style.display  = 'block';
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = requests.map(_buildRow).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function _buildRow(r) {
        const name     = _esc(r.clientName || _nameFromEmail(r.clientEmail));
        const email    = _esc(r.clientEmail || '');
        const period   = _esc(r.billingPeriod || '—');
        const project  = _esc(r.projectName  || '—');
        const isPartial = r.paidAmount && r.paidAmount < r.amount;
        const amount   = isPartial
            ? `${_formatAmount(r.paidAmount)} <span style="font-size:11px;font-weight:600;color:#d97706;background:#fffbeb;border:1px solid #fde68a;border-radius:99px;padding:1px 7px;">Partial</span><br><span style="font-size:11px;color:#9ca3af;font-weight:400;">of ${_formatAmount(r.amount)}</span>`
            : _formatAmount(r.amount);
        const due      = _formatDate(r.dueDate);
        const statusBadge = _statusBadge(r.status);

        return `
        <tr data-id="${r.id}">
            <td>
                <div class="un-user-cell">
                    <div class="un-avatar un-avatar-client">${(name[0] || 'C').toUpperCase()}</div>
                    <div>
                        <div class="un-user-name">${name}</div>
                        <div class="un-user-email-sub">${email}</div>
                    </div>
                </div>
            </td>
            <td style="font-size:13px;">${period}</td>
            <td style="font-size:13px;">${project}</td>
            <td style="font-weight:600;color:#00a85e;">${amount}</td>
            <td style="font-size:13px;color:#6b7280;">${due}</td>
            <td>${statusBadge}</td>
            <td>
                <div class="un-actions">
                    <button class="un-btn-view" onclick="prViewRequest('${r.id}')" style="position:relative;">
                        <i data-lucide="eye" style="width:13px;height:13px;"></i> View
                        ${(r.status === 'submitted' || r.status === 'partial_pending')
                            ? '<span style="position:absolute;top:-5px;right:-5px;width:10px;height:10px;border-radius:50%;background:#ef4444;border:2px solid #fff;"></span>'
                            : ''}
                    </button>
                    <button class="un-btn-sowa" onclick="prOpenSOWA('${_esc(r.clientEmail)}','${_esc(r.clientName || _nameFromEmail(r.clientEmail))}','${_esc(r.projectName || '')}')">
                        <i data-lucide="file-text" style="width:13px;height:13px;"></i> SOWA
                        ${_pendingSOWAEmails.has(r.clientEmail) ? '<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#ef4444;color:#fff;font-size:9px;font-weight:800;margin-left:2px;">!</span>' : ''}
                    </button>
                    <button class="un-btn-toggle un-btn-deactivate" onclick="prDeleteRequest('${r.id}')">
                        <i data-lucide="trash-2" style="width:13px;height:13px;"></i> Delete
                    </button>
                </div>
            </td>
        </tr>`;
    }

    // ══════════════════════════════════════════════════════
    // FILTER
    // ══════════════════════════════════════════════════════

    window.prFilterRequests = function () {
        const q      = (document.getElementById('prSearchInput')?.value  || '').toLowerCase().trim();
        const status = (document.getElementById('prStatusFilter')?.value || '');

        const filtered = _allRequests.filter(r => {
            const name    = (r.clientName || _nameFromEmail(r.clientEmail)).toLowerCase();
            const email   = (r.clientEmail  || '').toLowerCase();
            const period  = (r.billingPeriod || '').toLowerCase();
            const project = (r.projectName   || '').toLowerCase();
            const matchQ  = !q || name.includes(q) || email.includes(q) || period.includes(q) || project.includes(q);
            const matchS  = !status || r.status === status;
            return matchQ && matchS;
        });

        _renderTable(filtered);
    };

    // ══════════════════════════════════════════════════════
    // CREATE MODAL
    // ══════════════════════════════════════════════════════

    window.prOpenCreateModal = async function () {
        const modal = document.getElementById('prCreateModal');
        if (!modal) return;

        // Reset form
        const form = document.getElementById('prCreateForm');
        if (form) form.reset();
        const errDiv = document.getElementById('prCreateError');
        if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }

        // Load client dropdown
        const select = document.getElementById('prClientSelect');
        if (select) {
            select.innerHTML = '<option value="">Loading clients…</option>';
            try {
                const snap = await db.collection('clientUsers').get();
                const clients = snap.docs.map(doc => {
                    const d = doc.data();
                    const name = ((d.firstName || '') + ' ' + (d.lastName || '')).trim();
                    return { uid: doc.id, name, email: d.email || '' };
                }).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

                select.innerHTML = '<option value="">— Select Client —</option>' +
                    clients.map(c => {
                        const label = c.name ? `${_esc(c.name)} — ${_esc(c.email)}` : _esc(c.email || c.uid);
                        return `<option value="${_esc(c.uid)}" data-email="${_esc(c.email)}" data-name="${_esc(c.name)}">${label}</option>`;
                    }).join('');
            } catch (e) {
                select.innerHTML = '<option value="">Error loading clients</option>';
            }
        }

        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.prCloseCreateModal = function () {
        const modal = document.getElementById('prCreateModal');
        if (modal) modal.style.display = 'none';
    };

    // ── Submit Create ──
    window.prSubmitCreate = async function () {
        const errDiv = document.getElementById('prCreateError');
        const btn    = document.getElementById('prCreateSubmitBtn');

        function showErr(msg) {
            if (errDiv) { errDiv.textContent = msg; errDiv.style.display = 'block'; }
        }
        function clearErr() {
            if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }
        }
        clearErr();

        // Gather values
        const clientSelect = document.getElementById('prClientSelect');
        const selectedOpt  = clientSelect?.options[clientSelect.selectedIndex];
        const clientUid    = clientSelect?.value || '';
        const clientEmail  = selectedOpt?.dataset.email || '';
        const clientName   = selectedOpt?.dataset.name  || '';

        const billingPeriod = (document.getElementById('prBillingPeriod')?.value || '').trim();
        const projectName   = (document.getElementById('prProjectName')?.value   || '').trim();
        const amountRaw     = (document.getElementById('prAmount')?.value         || '').trim();
        const dueDateStr    = (document.getElementById('prDueDate')?.value         || '').trim();
        const notes         = (document.getElementById('prNotes')?.value           || '').trim();

        // Validate
        if (!clientUid)     return showErr('Please select a client.');
        if (!billingPeriod) return showErr('Billing period is required.');
        if (!projectName)   return showErr('Project name is required.');
        if (!amountRaw)     return showErr('Amount is required.');
        const amount = parseFloat(amountRaw.replace(/,/g, ''));
        if (isNaN(amount) || amount <= 0) return showErr('Enter a valid amount.');
        if (!dueDateStr)    return showErr('Due date is required.');

        // Disable button
        if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

        try {
            // Create Firestore document (QR codes are global — stored in settings/paymentQR)
            const dueDate   = firebase.firestore.Timestamp.fromDate(new Date(dueDateStr));
            const createdBy = auth.currentUser ? auth.currentUser.email : '';

            const newReqRef = await db.collection('paymentRequests').add({
                clientUid,
                clientEmail,
                clientName,
                billingPeriod,
                projectName,
                amount,
                dueDate,
                notes,
                status:    'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy,
                ownerUid:  auth.currentUser?.uid || '',
                proofBase64:     null,
                referenceNumber: null,
                submittedAt:     null,
                verifiedAt:      null,
                verifiedBy:      null,
                rejectedReason:  null,
                rejectedAt:      null
            });

            // Notify the client about the new payment request
            if (clientUid) {
                const dueDateLabel = dueDateStr
                    ? new Date(dueDateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '';
                db.collection('notifications').doc(clientUid).collection('items').add({
                    type:      'payment_request',
                    message:   `New payment request: ${billingPeriod} — ₱${amount.toLocaleString('en-PH')}${dueDateLabel ? ' due ' + dueDateLabel : ''}`,
                    isRead:    false,
                    relatedId: newReqRef.id,
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                }).catch(e => console.warn('Notification error:', e));
            }

            prCloseCreateModal();
            _loadRequests();
            _showToast('Payment request created successfully.');

        } catch (e) {
            console.error('PaymentRequests: create error', e);
            showErr('Error creating request: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Create Request'; }
        }
    };

    // ══════════════════════════════════════════════════════
    // DELETE REQUEST
    // ══════════════════════════════════════════════════════

    // Remove red dot from a row's View button
    function _clearRequestBadge(id) {
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (row) { const dot = row.querySelector('.un-btn-view span'); if (dot) dot.remove(); }
    }

    window.prDeleteRequest = async function (id) {
        if (!await window.showDeleteConfirm('Are you sure you want to delete this payment request? This cannot be undone.')) return;
        try {
            _clearRequestBadge(id);
            await db.collection('paymentRequests').doc(id).delete();
            _allRequests = _allRequests.filter(r => r.id !== id);
            _renderStats(_allRequests);
            prFilterRequests();
        } catch (e) {
            console.error('prDeleteRequest error', e);
            alert('Could not delete payment request. Please try again.');
        }
    };

    // ══════════════════════════════════════════════════════
    // DETAIL MODAL
    // ══════════════════════════════════════════════════════

    window.prViewRequest = function (id) {
        const r = _allRequests.find(x => x.id === id);
        if (!r) return;

        // (badge clears only on action: verify, reject, or delete)

        _currentId = id;

        const modal = document.getElementById('prDetailModal');
        const body  = document.getElementById('prDetailBody');
        if (!modal || !body) return;

        const statusBadge    = _statusBadge(r.status);
        const formattedAmt   = _formatAmount(r.amount);
        const createdDate    = _formatDate(r.createdAt);
        const dueDate        = _formatDate(r.dueDate);
        const submittedDate  = r.submittedAt ? _formatDate(r.submittedAt) : '—';
        const verifiedDate   = r.verifiedAt  ? _formatDate(r.verifiedAt)  : '—';

        const hasGcash = !!_qrSettings?.gcashQrBase64;
        const hasBank  = !!_qrSettings?.bankQrBase64;
        const qrSection = (hasGcash || hasBank) ? `
            <div style="display:flex;gap:16px;flex-wrap:wrap;">
                ${hasGcash ? `<div style="text-align:center;">
                    <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">GCash</div>
                    <img src="${_esc(_qrSettings.gcashQrBase64)}" alt="GCash QR" style="width:140px;height:140px;object-fit:contain;border-radius:8px;border:1px solid #e5e7eb;">
                </div>` : ''}
                ${hasBank ? `<div style="text-align:center;">
                    <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Bank Transfer</div>
                    <img src="${_esc(_qrSettings.bankQrBase64)}" alt="Bank QR" style="width:140px;height:140px;object-fit:contain;border-radius:8px;border:1px solid #e5e7eb;">
                </div>` : ''}
            </div>` : '<p style="color:#9ca3af;font-size:13px;">No global QR codes set. <a href="#" onclick="prCloseDetailModal();prOpenQRSettings();return false;" style="color:#3b82f6;">Set up QR codes →</a></p>';

        const rejectedHtml = (r.status === 'rejected' && r.rejectedReason) ? `
            <div class="pr-rejected-note">
                <strong>Reason for Rejection</strong>
                ${_esc(r.rejectedReason)}
            </div>` : '';

        // Proof section — only if submitted or verified
        let proofSection = '';
        if (r.proofBase64) {
            const hasPaidAmount  = r.paidAmount != null && !isNaN(r.paidAmount);
            const isPartial      = hasPaidAmount && Math.abs(r.paidAmount - r.amount) > 0.01;
            const paidAmountHtml = hasPaidAmount ? `
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Amount Paid</span>
                    <span class="pr-detail-value" style="font-weight:700;font-size:15px;color:${isPartial ? '#d97706' : '#00a85e'};">
                        ${_formatAmount(r.paidAmount)}
                        ${isPartial ? `<span style="font-size:12px;font-weight:500;color:#d97706;margin-left:8px;background:#fef3c7;padding:2px 8px;border-radius:20px;">Partial &middot; requested ${_formatAmount(r.amount)}</span>` : ''}
                    </span>
                </div>
                ${isPartial && r.partialReason ? `
                <div class="pr-detail-row" style="background:#fffbeb;border-radius:8px;padding:10px 14px;margin-top:4px;border:1.5px solid #fcd34d;">
                    <span class="pr-detail-label" style="color:#d97706;">Client&rsquo;s Reason</span>
                    <span class="pr-detail-value" style="color:#92400e;font-style:italic;">&ldquo;${_esc(r.partialReason)}&rdquo;</span>
                </div>` : ''}` : '';

            proofSection = `
            <div class="pr-detail-section">
                <div class="pr-detail-section-title">Payment Proof</div>
                ${paidAmountHtml}
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Reference No.</span>
                    <span class="pr-detail-value">${_esc(r.referenceNumber || '—')}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Submitted At</span>
                    <span class="pr-detail-value">${submittedDate}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Receipt</span>
                    <span class="pr-detail-value">
                        <img src="${_esc(r.proofBase64)}" class="pr-receipt-thumb" alt="Receipt"
                             onclick="prOpenReceiptViewer('${_esc(r.proofBase64)}')">
                    </span>
                </div>
            </div>`;
        }

        // Action buttons — inline multi-state (no browser dialogs)
        let actionButtons = '';
        if (r.status === 'submitted') {
            actionButtons = `
            <div class="pr-detail-section" style="margin-top:10px;">
                <div class="pr-detail-section-title">Admin Actions</div>
                <div id="prActionMain" style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
                    <button class="pr-btn-verify" onclick="prShowVerifyConfirm()">
                        <i data-lucide="check-circle" style="width:15px;height:15px;"></i> Verify Payment
                    </button>
                    <button class="pr-btn-reject" onclick="prShowRejectInput()">
                        <i data-lucide="x-circle" style="width:15px;height:15px;"></i> Reject
                    </button>
                    <button class="pr-btn-delete" onclick="prShowDeleteConfirm()">
                        <i data-lucide="trash-2" style="width:15px;height:15px;"></i> Delete
                    </button>
                </div>
                <div id="prVerifyConfirm" style="display:none;margin-top:14px;background:#f0fdf9;border:1.5px solid #6ee7b7;border-radius:10px;padding:14px;">
                    <p style="font-size:13.5px;color:#065f46;font-weight:500;margin:0 0 12px;">Confirm that payment has been received and verified?</p>
                    <div style="display:flex;gap:8px;">
                        <button class="pr-btn-verify" onclick="prConfirmVerify('${id}')">
                            <i data-lucide="check" style="width:14px;height:14px;"></i> Yes, Verify Payment
                        </button>
                        <button class="pr-btn-cancel" onclick="prCancelAction()">Cancel</button>
                    </div>
                </div>
                <div id="prRejectForm" style="display:none;margin-top:14px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px;padding:14px;">
                    <label style="font-size:12.5px;font-weight:600;color:#b91c1c;display:block;margin-bottom:8px;">Reason for Rejection <span style="color:#ef4444;">*</span></label>
                    <textarea id="prRejectReason" class="pr-form-textarea" placeholder="Enter the reason for rejection…" style="border-color:#fca5a5;min-height:70px;resize:vertical;"></textarea>
                    <div id="prRejectError" style="display:none;color:#b91c1c;font-size:12.5px;margin-top:6px;"></div>
                    <div style="display:flex;gap:8px;margin-top:10px;">
                        <button class="pr-btn-reject" onclick="prConfirmReject('${id}')">
                            <i data-lucide="x-circle" style="width:14px;height:14px;"></i> Confirm Rejection
                        </button>
                        <button class="pr-btn-cancel" onclick="prCancelAction()">Cancel</button>
                    </div>
                </div>
                <div id="prDeleteConfirm" style="display:none;margin-top:14px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px;padding:14px;">
                    <p style="font-size:13.5px;color:#b91c1c;font-weight:500;margin:0 0 12px;">Permanently delete this payment request?</p>
                    <div style="display:flex;gap:8px;">
                        <button class="pr-btn-delete" onclick="prConfirmDelete('${id}')">Yes, Delete</button>
                        <button class="pr-btn-cancel" onclick="prCancelAction()">Cancel</button>
                    </div>
                </div>
            </div>`;
        } else if (r.status === 'partial_pending') {
            actionButtons = `
            <div class="pr-detail-section" style="margin-top:10px;">
                <div class="pr-detail-section-title">Partial Payment Request</div>
                <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:14px;margin-top:10px;">
                    <div style="font-size:13.5px;color:#7c2d12;margin-bottom:4px;">
                        Client requests to pay <strong style="font-size:15px;">${_formatAmount(r.requestedPartialAmount)}</strong>
                        instead of the requested <strong>${_formatAmount(r.amount)}</strong>.
                    </div>
                    ${r.partialReason ? `<div style="font-size:13px;color:#9a3412;font-style:italic;margin-top:6px;">"${_esc(r.partialReason)}"</div>` : ''}
                    ${r.partialRequestedAt ? `<div style="font-size:11.5px;color:#c2410c;margin-top:8px;">Requested on: ${_formatDate(r.partialRequestedAt)}</div>` : ''}
                </div>
                <div id="prPartialActionMain" style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;">
                    <button class="pr-btn-verify" onclick="prShowApprovePartialConfirm()">
                        <i data-lucide="check-circle" style="width:15px;height:15px;"></i> Approve Partial
                    </button>
                    <button class="pr-btn-reject" onclick="prShowDeclinePartialInput()">
                        <i data-lucide="x-circle" style="width:15px;height:15px;"></i> Reject
                    </button>
                    <button class="pr-btn-delete" onclick="prShowDeleteConfirm()">
                        <i data-lucide="trash-2" style="width:15px;height:15px;"></i> Delete
                    </button>
                </div>
                <div id="prApprovePartialConfirm" style="display:none;margin-top:14px;background:#f0fdf9;border:1.5px solid #6ee7b7;border-radius:10px;padding:14px;">
                    <p style="font-size:13.5px;color:#065f46;font-weight:500;margin:0 0 12px;">
                        Approve client to pay <strong>${_formatAmount(r.requestedPartialAmount)}</strong>? The client will be notified to proceed with payment.
                    </p>
                    <div style="display:flex;gap:8px;">
                        <button class="pr-btn-verify" onclick="prConfirmApprovePartial('${id}')">
                            <i data-lucide="check" style="width:14px;height:14px;"></i> Yes, Approve
                        </button>
                        <button class="pr-btn-cancel" onclick="prCancelPartialAction()">Cancel</button>
                    </div>
                </div>
                <div id="prDeclinePartialForm" style="display:none;margin-top:14px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px;padding:14px;">
                    <label style="font-size:12.5px;font-weight:600;color:#b91c1c;display:block;margin-bottom:8px;">Reason for Rejection <span style="color:#ef4444;">*</span></label>
                    <textarea id="prDeclinePartialReason" class="pr-form-textarea" placeholder="e.g. Full payment is required per contract terms…" style="border-color:#fca5a5;min-height:70px;"></textarea>
                    <div id="prDeclinePartialError" style="display:none;color:#b91c1c;font-size:12.5px;margin-top:6px;"></div>
                    <div style="display:flex;gap:8px;margin-top:10px;">
                        <button class="pr-btn-reject" onclick="prConfirmDeclinePartial('${id}')">
                            <i data-lucide="x-circle" style="width:14px;height:14px;"></i> Confirm Rejection
                        </button>
                        <button class="pr-btn-cancel" onclick="prCancelPartialAction()">Cancel</button>
                    </div>
                </div>
                <div id="prDeleteConfirm" style="display:none;margin-top:14px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px;padding:14px;">
                    <p style="font-size:13.5px;color:#b91c1c;font-weight:500;margin:0 0 12px;">Permanently delete this payment request?</p>
                    <div style="display:flex;gap:8px;">
                        <button class="pr-btn-delete" onclick="prConfirmDelete('${id}')">Yes, Delete</button>
                        <button class="pr-btn-cancel" onclick="prCancelDelete()">Cancel</button>
                    </div>
                </div>
            </div>`;
        } else if (r.status === 'pending' || r.status === 'rejected') {
            actionButtons = `
            <div class="pr-detail-section" style="margin-top:10px;">
                <div class="pr-detail-section-title">Admin Actions</div>
                <div id="prSingleAction" style="margin-top:10px;">
                    <button class="pr-btn-delete" onclick="prShowDeleteConfirm()">
                        <i data-lucide="trash-2" style="width:15px;height:15px;"></i> Delete
                    </button>
                </div>
                <div id="prDeleteConfirm" style="display:none;margin-top:14px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px;padding:14px;">
                    <p style="font-size:13.5px;color:#b91c1c;font-weight:500;margin:0 0 12px;">Permanently delete this payment request?</p>
                    <div style="display:flex;gap:8px;">
                        <button class="pr-btn-delete" onclick="prConfirmDelete('${id}')">Yes, Delete</button>
                        <button class="pr-btn-cancel" onclick="prCancelDelete()">Cancel</button>
                    </div>
                </div>
            </div>`;
        }

        const verifiedSection = r.status === 'verified' ? `
            <div class="pr-detail-row">
                <span class="pr-detail-label">Verified At</span>
                <span class="pr-detail-value">${verifiedDate}</span>
            </div>
            <div class="pr-detail-row">
                <span class="pr-detail-label">Verified By</span>
                <span class="pr-detail-value">${_esc(r.verifiedBy || '—')}</span>
            </div>
            ${r.invoiceId ? `<div class="pr-detail-row" style="margin-top:12px;">
                <button onclick="prPrintInvoice('${_esc(r.invoiceId)}')"
                    style="display:inline-flex;align-items:center;gap:7px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;">
                    <i data-lucide="printer" style="width:15px;height:15px;"></i> Print Invoice
                </button>
            </div>` : ''}` : '';

        body.innerHTML = `
            <div class="pr-detail-section">
                <div class="pr-detail-section-title">Request Info</div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Client</span>
                    <span class="pr-detail-value">${_esc(r.clientName || _nameFromEmail(r.clientEmail))}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Email</span>
                    <span class="pr-detail-value">${_esc(r.clientEmail || '—')}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Billing Period</span>
                    <span class="pr-detail-value">${_esc(r.billingPeriod || '—')}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Project</span>
                    <span class="pr-detail-value">${_esc(r.projectName || '—')}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Amount</span>
                    <span class="pr-detail-value" style="font-weight:700;color:#00a85e;font-size:15px;">${formattedAmt}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Due Date</span>
                    <span class="pr-detail-value">${dueDate}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Status</span>
                    <span class="pr-detail-value">${statusBadge}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Created At</span>
                    <span class="pr-detail-value">${createdDate}</span>
                </div>
                <div class="pr-detail-row">
                    <span class="pr-detail-label">Created By</span>
                    <span class="pr-detail-value">${_esc(r.createdBy || '—')}</span>
                </div>
                ${r.notes ? `<div class="pr-detail-row">
                    <span class="pr-detail-label">Notes</span>
                    <span class="pr-detail-value">${_esc(r.notes)}</span>
                </div>` : ''}
                ${verifiedSection}
            </div>

            <div class="pr-detail-section">
                <div class="pr-detail-section-title">QR Code</div>
                ${qrSection}
            </div>

            ${rejectedHtml}
            ${proofSection}
            ${actionButtons}
        `;

        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();

    };

    window.prCloseDetailModal = function () {
        const modal = document.getElementById('prDetailModal');
        if (modal) modal.style.display = 'none';
        _currentId = null;
    };

    window.prPrintInvoice = async function (invoiceId) {
        try {
            const doc = await db.collection('invoices').doc(invoiceId).get();
            if (!doc.exists) { _showToast('Invoice not found.', true); return; }
            if (typeof window.invPrintById === 'function') {
                window.invPrintById({ id: doc.id, ...doc.data() });
            }
        } catch (e) {
            _showToast('Could not load invoice: ' + e.message, true);
        }
    };

    // ══════════════════════════════════════════════════════
    // RECEIPT VIEWER
    // ══════════════════════════════════════════════════════

    window.prOpenReceiptViewer = function (url) {
        const viewer = document.getElementById('prReceiptViewer');
        const img    = document.getElementById('prReceiptViewerImg');
        if (!viewer || !img) return;
        img.src = url;
        viewer.style.display = 'flex';
    };

    window.prCloseReceiptViewer = function () {
        const viewer = document.getElementById('prReceiptViewer');
        if (viewer) viewer.style.display = 'none';
    };

    // ══════════════════════════════════════════════════════
    // INLINE ACTION CONTROLS (Verify / Reject / Delete)
    // ══════════════════════════════════════════════════════

    // ── Partial Payment Approval ──

    window.prCancelPartialAction = function () {
        const main = document.getElementById('prPartialActionMain');
        if (main) main.style.display = 'flex';
        ['prApprovePartialConfirm', 'prDeclinePartialForm', 'prDeleteConfirm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    };

    window.prShowApprovePartialConfirm = function () {
        document.getElementById('prPartialActionMain').style.display = 'none';
        document.getElementById('prApprovePartialConfirm').style.display = 'block';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.prShowDeclinePartialInput = function () {
        document.getElementById('prPartialActionMain').style.display = 'none';
        document.getElementById('prDeclinePartialForm').style.display = 'block';
        document.getElementById('prDeclinePartialReason')?.focus();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.prConfirmApprovePartial = async function (id) {
        const r   = _allRequests.find(x => x.id === id);
        if (!r) return;
        const btn = document.querySelector('#prApprovePartialConfirm .pr-btn-verify');
        if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
        try {
            const approvedBy = auth.currentUser?.email || '';
            await db.collection('paymentRequests').doc(id).update({
                status:                'pending',
                approvedPartialAmount: r.requestedPartialAmount,
                partialApprovedBy:     approvedBy,
                partialApprovedAt:     firebase.firestore.FieldValue.serverTimestamp(),
                partialDeclinedReason: null
            });
            // Notify client their partial payment request was approved
            if (r.clientUid) {
                db.collection('notifications').doc(r.clientUid).collection('items').add({
                    type:      'partial_approved',
                    message:   `Your partial payment of ${_formatAmount(r.requestedPartialAmount)} for "${r.billingPeriod || 'a billing period'}" has been approved. You can now submit your payment.`,
                    isRead:    false,
                    relatedId: id,
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                }).catch(e => console.warn('Notification error:', e));
            }

            prCloseDetailModal();
            _loadRequests();
            _showToast(`Partial payment of ${_formatAmount(r.requestedPartialAmount)} approved. Client can now submit payment.`);
        } catch (e) {
            console.error('PaymentRequests: approve partial error', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Yes, Approve'; }
            prCancelPartialAction();
            _showToast('Could not approve: ' + e.message, true);
        }
    };

    window.prConfirmDeclinePartial = async function (id) {
        const reason = (document.getElementById('prDeclinePartialReason')?.value || '').trim();
        const errEl  = document.getElementById('prDeclinePartialError');
        if (!reason) {
            if (errEl) { errEl.textContent = 'Please enter a reason.'; errEl.style.display = 'block'; }
            return;
        }
        if (errEl) errEl.style.display = 'none';
        const btn = document.querySelector('#prDeclinePartialForm .pr-btn-reject');
        if (btn) { btn.disabled = true; btn.textContent = 'Declining…'; }
        try {
            await db.collection('paymentRequests').doc(id).update({
                status:                'pending',
                approvedPartialAmount: null,
                requestedPartialAmount: null,
                partialReason:         null,
                partialDeclinedReason: reason
            });
            // Notify client their partial payment request was declined
            const _decReq = _allRequests.find(x => x.id === id) || {};
            if (_decReq.clientUid) {
                db.collection('notifications').doc(_decReq.clientUid).collection('items').add({
                    type:      'partial_declined',
                    message:   `Your partial payment request for "${_decReq.billingPeriod || 'a billing period'}" was rejected. Reason: ${reason}`,
                    isRead:    false,
                    relatedId: id,
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                }).catch(e => console.warn('Notification error:', e));
            }

            prCloseDetailModal();
            _loadRequests();
            _showToast('Partial payment request rejected. Client must pay full amount.');
        } catch (e) {
            console.error('PaymentRequests: decline partial error', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Confirm Rejection'; }
            if (errEl) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
        }
    };

    window.prShowVerifyConfirm = function () {
        document.getElementById('prActionMain').style.display  = 'none';
        document.getElementById('prVerifyConfirm').style.display = 'block';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.prShowRejectInput = function () {
        document.getElementById('prActionMain').style.display = 'none';
        document.getElementById('prRejectForm').style.display  = 'block';
        document.getElementById('prRejectReason')?.focus();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.prShowDeleteConfirm = function () {
        const main   = document.getElementById('prActionMain');
        const single = document.getElementById('prSingleAction');
        if (main)   main.style.display   = 'none';
        if (single) single.style.display = 'none';
        document.getElementById('prDeleteConfirm').style.display = 'block';
    };

    window.prCancelAction = function () {
        const main = document.getElementById('prActionMain');
        if (main) main.style.display = 'flex';
        ['prVerifyConfirm', 'prRejectForm', 'prDeleteConfirm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    };

    window.prCancelDelete = function () {
        const single = document.getElementById('prSingleAction');
        if (single) single.style.display = 'block';
        const conf = document.getElementById('prDeleteConfirm');
        if (conf) conf.style.display = 'none';
    };

    window.prConfirmVerify = async function (id) {
        const btn = document.querySelector('#prVerifyConfirm .pr-btn-verify');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        try {
            _clearRequestBadge(id);
            const verifiedBy = auth.currentUser ? auth.currentUser.email : '';
            await db.collection('paymentRequests').doc(id).update({
                status:     'verified',
                verifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
                verifiedBy
            });

            // Auto-generate invoice from this verified payment request
            const req = _allRequests.find(x => x.id === id) || { id };
            if (typeof window.invGenerateFromPaymentRequest === 'function') {
                const invoiceId = await window.invGenerateFromPaymentRequest(req);
                if (invoiceId) {
                    // Fetch the generated invoice data and embed a snapshot in the payment request
                    // so clients can view their invoice without needing direct invoices collection access
                    let invoiceSnapshot = null;
                    try {
                        const invDoc = await db.collection('invoices').doc(invoiceId).get();
                        if (invDoc.exists) invoiceSnapshot = invDoc.data();
                    } catch (snapErr) {
                        console.warn('PaymentRequests: could not fetch invoice snapshot', snapErr);
                    }
                    const updateData = { invoiceId };
                    if (invoiceSnapshot) updateData.invoiceSnapshot = invoiceSnapshot;
                    await db.collection('paymentRequests').doc(id).update(updateData);
                    const r = _allRequests.find(x => x.id === id);
                    if (r) { r.invoiceId = invoiceId; if (invoiceSnapshot) r.invoiceSnapshot = invoiceSnapshot; }
                }
            }

            // Notify the client their payment has been verified
            const _verReq = _allRequests.find(x => x.id === id) || {};
            if (_verReq.clientUid) {
                db.collection('notifications').doc(_verReq.clientUid).collection('items').add({
                    type:      'payment_verified',
                    message:   `Your payment for "${_verReq.billingPeriod || 'a billing period'}" has been verified and marked as paid. Your invoice has been generated and is available under Invoice Receipt.`,
                    isRead:    false,
                    relatedId: id,
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                }).catch(e => console.warn('Notification error:', e));
            }

            prCloseDetailModal();
            _loadRequests();
            _showToast('Payment marked as paid. Invoice generated.');
        } catch (e) {
            console.error('PaymentRequests: verify error', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Yes, Verify Payment'; }
            prCancelAction();
            _showToast('Could not verify payment: ' + e.message, true);
        }
    };

    window.prConfirmReject = async function (id) {
        const reason = (document.getElementById('prRejectReason')?.value || '').trim();
        const errEl  = document.getElementById('prRejectError');
        if (!reason) {
            if (errEl) { errEl.textContent = 'Please enter a rejection reason.'; errEl.style.display = 'block'; }
            return;
        }
        if (errEl) errEl.style.display = 'none';

        const btn = document.querySelector('#prRejectForm .pr-btn-reject');
        if (btn) { btn.disabled = true; btn.textContent = 'Rejecting…'; }
        try {
            _clearRequestBadge(id);
            await db.collection('paymentRequests').doc(id).update({
                status:         'rejected',
                rejectedReason: reason,
                rejectedAt:     firebase.firestore.FieldValue.serverTimestamp()
            });

            // Notify the client their payment was rejected
            const _rejReq = _allRequests.find(x => x.id === id) || {};
            if (_rejReq.clientUid) {
                db.collection('notifications').doc(_rejReq.clientUid).collection('items').add({
                    type:      'payment_rejected',
                    message:   `Your payment for "${_rejReq.billingPeriod || 'a billing period'}" was rejected. Reason: ${reason}`,
                    isRead:    false,
                    relatedId: id,
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                }).catch(e => console.warn('Notification error:', e));
            }

            prCloseDetailModal();
            _loadRequests();
            _showToast('Payment request rejected.');
        } catch (e) {
            console.error('PaymentRequests: reject error', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Confirm Rejection'; }
            if (errEl) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
        }
    };

    window.prConfirmDelete = async function (id) {
        const btn = document.querySelector('#prDeleteConfirm .pr-btn-delete');
        if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
        try {
            await db.collection('paymentRequests').doc(id).delete();
            prCloseDetailModal();
            _loadRequests();
            _showToast('Payment request deleted.');
        } catch (e) {
            console.error('PaymentRequests: delete error', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Yes, Delete'; }
            prCancelDelete();
            _showToast('Could not delete request: ' + e.message, true);
        }
    };

    // ══════════════════════════════════════════════════════
    // PRINT ALL REQUESTS
    // ══════════════════════════════════════════════════════

    window.prPrintAllRequests = function () {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Please allow popups to print the payment requests.');
            return;
        }

        const now = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
        const totalBilled = _allRequests.reduce((sum, r) => sum + (r.amount || 0), 0);
        const totalVerified = _allRequests.filter(r => r.status === 'verified')
            .reduce((sum, r) => sum + (r.paidAmount != null ? r.paidAmount : (r.amount || 0)), 0);
        const totalOutstanding = totalBilled - totalVerified;

        const rows = _allRequests.map((r, idx) => {
            const name = _esc(r.clientName || _nameFromEmail(r.clientEmail));
            const period = _esc(r.billingPeriod || '—');
            const project = _esc(r.projectName || '—');
            const isPartial = r.paidAmount && r.paidAmount < r.amount;
            const amount = isPartial
                ? `${_formatAmount(r.paidAmount)} (Partial of ${_formatAmount(r.amount)})`
                : _formatAmount(r.amount);
            const due = _formatDate(r.dueDate);
            const status = r.status.charAt(0).toUpperCase() + r.status.slice(1).replace('_', ' ');

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${name}</td>
                    <td>${period}</td>
                    <td>${project}</td>
                    <td style="text-align:right;">${amount}</td>
                    <td>${due}</td>
                    <td><span class="status-${r.status}">${status}</span></td>
                </tr>`;
        }).join('');

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Payment Requests - ${now}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #1f2937; }
        .header { margin-bottom: 30px; }
        .summary { display: flex; justify-content: space-around; margin-bottom: 30px; }
        .summary-card { text-align: center; padding: 15px; background: #f9fafb; border-radius: 8px; flex: 1; margin: 0 10px; }
        .summary-card .label { font-size: 12px; color: #6b7280; text-transform: uppercase; margin-bottom: 5px; }
        .summary-card .value { font-size: 20px; font-weight: 700; color: #1f2937; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: #f3f4f6; padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; }
        td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
        tr:hover { background: #f9fafb; }
        .status-pending { color: #d97706; font-weight: 600; }
        .status-partial_pending { color: #f97316; font-weight: 600; }
        .status-submitted { color: #3b82f6; font-weight: 600; }
        .status-verified { color: #00a85e; font-weight: 600; }
        .status-rejected { color: #ef4444; font-weight: 600; }
        .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 20px; }
        @media print {
            body { padding: 20px; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="header">
        ${window.dacsPrintHeader('Payment Requests', `Generated: ${now}`)}
    </div>

    <div class="summary">
        <div class="summary-card">
            <div class="label">Total Requests</div>
            <div class="value">${_allRequests.length}</div>
        </div>
        <div class="summary-card">
            <div class="label">Total Billed</div>
            <div class="value">${_formatAmount(totalBilled)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Total Collected</div>
            <div class="value" style="color:#00a85e;">${_formatAmount(totalVerified)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Outstanding</div>
            <div class="value" style="color:#ef4444;">${_formatAmount(totalOutstanding)}</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Client</th>
                <th>Billing Period</th>
                <th>Project</th>
                <th style="text-align:right;">Amount</th>
                <th>Due Date</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>

    <div class="footer">
        <p>DAC's Building Design Services &mdash; Payment Requests Report</p>
        <p>This is a computer-generated document.</p>
    </div>

    <script>
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 500);
        };
    </script>
</body>
</html>`;

        printWindow.document.write(html);
        printWindow.document.close();
    };

    // ══════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════

    function _showLoading(on) {
        const load  = document.getElementById('prLoadingState');
        const wrap  = document.getElementById('prTableWrap');
        const empty = document.getElementById('prEmptyState');
        if (on) {
            if (load)  { load.style.display = 'flex'; load.innerHTML = '<div class="un-loading-spinner"></div><span>Loading payment requests\u2026</span>'; }
            if (wrap)  wrap.style.display  = 'none';
            if (empty) empty.style.display = 'none';
        } else {
            if (load) load.style.display = 'none';
        }
    }

    function _showError(msg) {
        const load = document.getElementById('prLoadingState');
        if (load) {
            load.style.display = 'flex';
            load.innerHTML = `
                <div style="text-align:center;">
                    <div style="font-size:28px;margin-bottom:8px;">&#9888;&#65039;</div>
                    <p style="color:#b91c1c;font-weight:600;margin-bottom:4px;">Could not load payment requests.</p>
                    <p style="color:#6b7280;font-size:13px;">${_esc(msg || '')}</p>
                </div>`;
        }
    }

    function _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    // Compress image to fit within Firestore's 1MB field limit
    // QR codes need max ~500px — compresses large photos down aggressively
    function _compressToBase64(file, maxPx, quality) {
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

    function _tsToMs(ts) {
        if (!ts) return 0;
        if (typeof ts.toDate === 'function') return ts.toDate().getTime();
        if (ts instanceof Date) return ts.getTime();
        if (typeof ts === 'number') return ts;
        return new Date(ts).getTime() || 0;
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

    function _nameFromEmail(email) {
        if (!email) return 'Unknown';
        return email.split('@')[0].replace(/[._-]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    function _esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _showToast(msg, isError = false) {
        const existing = document.getElementById('prToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'prToast';
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
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3500);
    }

    function _statusBadge(status) {
        const map = {
            pending:         ['pr-status-pending',  'clock',        'Pending'],
            partial_pending: ['pr-status-partial',  'help-circle',  'Awaiting Approval'],
            submitted:       ['pr-status-submitted', 'upload',      'Under Review'],
            verified:        ['pr-status-verified',  'check-circle','Paid'],
            rejected:        ['pr-status-rejected',  'x-circle',   'Rejected']
        };
        const [cls, icon, label] = map[status] || ['pr-status-pending', 'clock', status];
        return `<span class="pr-status ${cls}"><span class="pr-status-dot"></span>${label}</span>`;
    }

    // ══════════════════════════════════════════════════════
    // SOWA — Statement of Work Accomplished
    // ══════════════════════════════════════════════════════

    window.prOpenSOWA = function (clientEmail, clientName, projectName) {
        const modal = document.getElementById('sowaModal');
        if (!modal) return;

        // If clientName is an email address or empty, try to find the proper name
        if (!clientName || clientName.includes('@')) {
            const found = _allRequests.find(r => r.clientEmail === clientEmail && r.clientName && !r.clientName.includes('@'));
            clientName = found ? found.clientName : _nameFromEmail(clientEmail);
        }

        // Filter requests for this client (and project if specified)
        const requests = _allRequests
            .filter(r => r.clientEmail === clientEmail && (!projectName || r.projectName === projectName))
            .sort((a, b) => _tsToMs(a.createdAt) - _tsToMs(b.createdAt));

        // Group by project — only group if at least one request has a projectName
        const hasProject = requests.some(r => r.projectName);
        const projects = {};
        requests.forEach(r => {
            const proj = hasProject ? (r.projectName || 'No Project') : '_all_';
            if (!projects[proj]) projects[proj] = [];
            projects[proj].push(r);
        });

        const fundingOrder = { mobilization: 1, downpayment: 2, progress: 3, final: 4, president: 5 };
        const typeLabel    = { mobilization: 'Mobilization', downpayment: 'Downpayment', progress: 'Progress Billing', final: 'Final Payment', president: 'Cover Expenses' };
        const statusLabel  = { pending: 'Pending', partial_pending: 'Awaiting Approval', partial_approved: 'Partial Approved', submitted: 'Under Review', verified: 'Paid', rejected: 'Rejected' };
        const statusColor  = { pending: '#f59e0b', partial_pending: '#f97316', partial_approved: '#3b82f6', submitted: '#3b82f6', verified: '#059669', rejected: '#dc2626' };

        const dateGenerated = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });

        let projectsHtml = '';
        let grandBilled = 0, grandPaid = 0;

        // Build one combined table across all projects
        let tableRows = '';
        let projNum   = 0;

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
                const label   = statusLabel[st]  || st;
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

        document.getElementById('sowaContent').innerHTML = `
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
        </table>`;

        _sowaClientEmail = clientEmail;
        _sowaClientName  = clientName;

        // Reset Send button state
        const sendBtn = document.getElementById('sowaSendBtn');
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send to Client`;
            sendBtn.style.background  = '#eff6ff';
            sendBtn.style.borderColor = '#bfdbfe';
            sendBtn.style.color       = '#1d4ed8';
            sendBtn.style.cursor      = 'pointer';
        }

        modal.style.display = 'flex';

        // Mark any pending SOWA requests from this client as viewed
        if (_pendingSOWAEmails.has(clientEmail)) {
            _pendingSOWAEmails.delete(clientEmail);
            // Remove the badge dot from all SOWA buttons for this client in the DOM
            document.querySelectorAll('.un-btn-sowa').forEach(btn => {
                if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(_esc(clientEmail))) {
                    btn.querySelectorAll('span').forEach(s => s.remove());
                }
            });
            const uid = window.currentDataUserId || firebase.auth().currentUser?.uid;
            db.collection('sowaRequests')
                .where('clientEmail', '==', clientEmail)
                .where('ownerUid',    '==', uid)
                .where('status',      '==', 'pending')
                .get()
                .then(snap => snap.forEach(doc => doc.ref.update({
                    status:   'viewed',
                    viewedAt: firebase.firestore.Timestamp.fromDate(new Date())
                })))
                .catch(e => console.warn('SOWA request update error:', e));
        }
    };

    window.prPrintSOWA = function () {
        const content = document.getElementById('sowaContent');
        if (!content) return;
        const w = window.open('', '_blank');
        w.document.write(`<!DOCTYPE html><html><head><title>SOWA</title>
        <style>
            body { font-family: Arial, sans-serif; font-size: 13px; color: #111; padding: 32px; }
            .sowa-company { font-size: 18px; font-weight: 700; color: #059669; }
            .sowa-doc-title { font-size: 15px; font-weight: 700; letter-spacing: 1px; margin: 4px 0 12px; text-transform: uppercase; }
            .sowa-meta { display: flex; gap: 32px; margin-bottom: 20px; font-size: 13px; }
            .sowa-meta-label { color: #6b7280; }
            .sowa-project-title { font-weight: 700; font-size: 13px; background: #f0fdf4; padding: 7px 12px; border-left: 4px solid #059669; margin: 18px 0 8px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #1e3a2f; color: #fff; padding: 8px 10px; text-align: left; }
            td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
            .sowa-cat-row td { background: #cc0000; color: #fff; font-weight: 700; border: 1px solid #a80000; }
            .sowa-subtotal-row td { background: #fffde7; color: #7a5a00; font-weight: 700; border: 1px solid #f5c518; }
            .sowa-grand-row td { background: #1e3a2f; color: #fff; font-weight: 800; padding: 12px 10px; border: 1px solid #0f2018; }
            @media print { body { padding: 16px; } }
        </style></head><body>${content.innerHTML}</body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 400);
    };

    window.prCloseSOWA = function () {
        const modal = document.getElementById('sowaModal');
        if (modal) modal.style.display = 'none';
        _sowaClientEmail = null;
        _sowaClientName  = null;
    };

    window.prShareSOWA = async function (btn) {
        if (!_sowaClientEmail) return;

        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

        try {
            // Find client UID from loaded requests
            const req = _allRequests.find(r => r.clientEmail === _sowaClientEmail && r.clientUid);
            const clientUid = req?.clientUid || null;

            // Notify the client
            if (clientUid) {
                await db.collection('notifications').doc(clientUid).collection('items').add({
                    type:      'sowa_ready',
                    message:   `Your Statement of Work Accomplished (SOWA) has been reviewed and is ready for you to view.`,
                    isRead:    false,
                    createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                });
            }

            // Update sowaRequests status to 'shared'
            const uid  = window.currentDataUserId || firebase.auth().currentUser?.uid;
            const snap = await db.collection('sowaRequests')
                .where('clientEmail', '==', _sowaClientEmail)
                .where('ownerUid',    '==', uid)
                .where('status', 'in', ['pending', 'viewed'])
                .get();
            const batch = db.batch();
            snap.forEach(doc => batch.update(doc.ref, {
                status:   'shared',
                sharedAt: firebase.firestore.Timestamp.fromDate(new Date())
            }));
            if (!snap.empty) await batch.commit();

            if (btn) {
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Sent`;
                btn.style.background  = '#d1fae5';
                btn.style.borderColor = '#6ee7b7';
                btn.style.color       = '#059669';
                btn.style.cursor      = 'default';
            }
        } catch (e) {
            console.error('prShareSOWA error:', e);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'Send to Client';
                btn.style.background  = '#eff6ff';
                btn.style.borderColor = '#bfdbfe';
                btn.style.color       = '#1d4ed8';
                btn.style.cursor      = 'pointer';
            }
            alert('Error sending SOWA to client. Please try again.');
        }
    };

})();
